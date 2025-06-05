import { Router } from 'express'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getTranscription } from '../services/openai'
import { processMessage } from '../core/aiHandler'

const router = Router()
const prisma = new PrismaClient()
const { VoiceResponse } = twilio.twiml

// POST /incoming - Handle incoming Twilio voice calls
router.post('/incoming', async (req, res) => {
  try {
    console.log('[VOICE DEBUG] Incoming Twilio request body:', req.body)
    
    const twiml = new VoiceResponse()
    
    // Extract the Twilio phone number that was called
    const toPhoneNumber = req.body.To
    
    // Fetch business information based on the called phone number
    let businessName = 'our business'
    
    if (toPhoneNumber) {
      try {
        const business = await prisma.business.findFirst({
          where: {
            notificationPhoneNumber: toPhoneNumber
          }
        })
        
        if (business) {
          businessName = business.name || 'our business'
        }
      } catch (dbError) {
        console.error('[VOICE DEBUG] Error fetching business by phone number:', dbError)
      }
    }
    
    // Create welcome message with business name
    const welcomeMessage = `Hey! Thank you for calling ${businessName}. Please tell me how I can help you after the beep. Recording will stop after 30 seconds of speech or a period of silence.`
    
    // Say the welcome message
    twiml.say(welcomeMessage)
    
    // Start recording the caller's speech
    twiml.record({
      action: '/api/voice/handle-recording',
      method: 'POST',
      maxLength: 30,
      playBeep: true,
      transcribe: false,
      timeout: 5
    })
    
    // If no input is received, provide a fallback message
    twiml.say('We did not receive any input. Goodbye.')
    twiml.hangup()
    
    // Set response content type and send TwiML
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[VOICE DEBUG] Error in /incoming route:', error)
    
    // Create fallback TwiML response
    const twiml = new VoiceResponse()
    twiml.say('Sorry, we are experiencing technical difficulties. Please try again later or contact us directly.')
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /handle-recording - Handle recorded audio from Twilio
router.post('/handle-recording', async (req, res) => {
  try {
    console.log('[VOICE DEBUG] Handle recording request body:', req.body)
    
    // Extract data from Twilio request
    const RecordingUrl = req.body.RecordingUrl
    const Caller = req.body.From
    const TwilioNumberCalled = req.body.To
    
    console.log('[VOICE DEBUG] RecordingUrl:', RecordingUrl)
    console.log('[VOICE DEBUG] Caller:', Caller)
    console.log('[VOICE DEBUG] TwilioNumberCalled:', TwilioNumberCalled)
    
    // Find business by Twilio phone number
    const business = await prisma.business.findFirst({
      where: {
        twilioPhoneNumber: TwilioNumberCalled
      }
    })
    
    if (!business) {
      console.error('[VOICE DEBUG] No business found for Twilio number:', TwilioNumberCalled)
      const twiml = new VoiceResponse()
      twiml.say('This number is not configured for our service. Please contact support.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    console.log('[VOICE DEBUG] Found business:', business.name)
    
    // Check if recording URL is present
    if (!RecordingUrl || RecordingUrl.trim() === '') {
      console.log('[VOICE DEBUG] No recording URL found')
      const twiml = new VoiceResponse()
      twiml.say('Sorry, I didn\'t catch that. Please call back if you need assistance.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Download the audio file
    console.log('[VOICE DEBUG] Downloading audio from:', RecordingUrl)
    const response = await axios.get(RecordingUrl, {
      responseType: 'stream'
    })
    
    // Create temporary file path
    const tempFilePath = path.join(os.tmpdir(), `twilio_audio_${Date.now()}.wav`)
    console.log('[VOICE DEBUG] Saving audio to:', tempFilePath)
    
    // Save the audio file
    const writeStream = fs.createWriteStream(tempFilePath)
    response.data.pipe(writeStream)
    
    // Wait for file to be written
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve())
      writeStream.on('error', reject)
    })
    
    console.log('[VOICE DEBUG] Audio file saved successfully')
    
    // Transcribe the audio
    let transcribedText: string | null
    try {
      console.log('[VOICE DEBUG] Starting transcription...')
      transcribedText = await getTranscription(tempFilePath)
      console.log('[VOICE DEBUG] Transcription result:', transcribedText)
    } catch (transcriptionError) {
      console.error('[VOICE DEBUG] Transcription failed:', transcriptionError)
      const twiml = new VoiceResponse()
      twiml.say('I had trouble understanding. Could you please try again or call back later?')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Check if transcription is empty
    if (!transcribedText || transcribedText.trim() === '') {
      console.log('[VOICE DEBUG] Empty transcription result')
      const twiml = new VoiceResponse()
      twiml.say('I had trouble understanding. Could you please try again or call back later?')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Process with AI handler
    console.log('[VOICE DEBUG] Processing message with AI handler...')
    const aiResponse = await processMessage(
      transcribedText,
      [], // Empty conversation history for first interaction
      business.id,
      null // No current flow
    )
    
    console.log('[VOICE DEBUG] AI response:', aiResponse.reply)
    
    // Create TwiML response
    const twiml = new VoiceResponse()
    twiml.say(aiResponse.reply)
    
    // Continue conversation with another recording
    twiml.record({
      action: '/api/voice/handle-recording',
      method: 'POST',
      maxLength: 30,
      playBeep: true,
      transcribe: false,
      timeout: 5
    })
    
    // Fallback if no response
    twiml.say('We did not receive any input. Goodbye.')
    twiml.hangup()
    
    // Send TwiML response
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[VOICE DEBUG] Error in /handle-recording route:', error)
    
    // Create fallback TwiML response
    const twiml = new VoiceResponse()
    twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.')
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

export default router 