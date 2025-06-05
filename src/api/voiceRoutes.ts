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

// In-memory session store for voice calls
const voiceSessions = new Map<string, { history: any[], currentFlow: string | null }>()

// Helper functions for voice session management
function getVoiceSession(callSid: string): { history: any[], currentFlow: string | null } {
  if (!voiceSessions.has(callSid)) {
    voiceSessions.set(callSid, { history: [], currentFlow: null })
  }
  return voiceSessions.get(callSid)!
}

function updateVoiceSession(callSid: string, history: any[], currentFlow: string | null) {
  voiceSessions.set(callSid, { history, currentFlow })
}

function clearVoiceSession(callSid: string) {
  voiceSessions.delete(callSid)
  console.log(`[Voice Session] Cleared session for CallSid: ${callSid}`)
}

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
    const callSid = req.body.CallSid // Extract CallSid for session management
    
    console.log('[VOICE DEBUG] RecordingUrl:', RecordingUrl)
    console.log('[VOICE DEBUG] Caller:', Caller)
    console.log('[VOICE DEBUG] TwilioNumberCalled:', TwilioNumberCalled)
    console.log('[VOICE DEBUG] CallSid:', callSid)
    
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
    
    // Fetch AgentConfig for voice settings
    let agentConfig = null
    try {
      agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: business.id }
      })
      console.log('[VOICE DEBUG] Found AgentConfig:', agentConfig ? 'Yes' : 'No')
    } catch (configError) {
      console.error('[VOICE DEBUG] Error fetching AgentConfig:', configError)
    }
    
    // Configure voice settings with fallbacks
    const voiceToUse = (agentConfig?.twilioVoice || 'alice') as any
    const languageToUse = (agentConfig?.twilioLanguage || 'en-US') as any
    console.log('[VOICE DEBUG] Voice settings:', { voice: voiceToUse, language: languageToUse })
    
    // Retrieve session state
    const session = getVoiceSession(callSid)
    let currentConversationHistory = session.history
    let currentActiveFlow = session.currentFlow // Flow state before processing new message
    
    console.log('[VOICE DEBUG] Current session state:', { 
      historyLength: currentConversationHistory.length, 
      currentFlow: currentActiveFlow 
    })
    
    // Check if recording URL is present
    if (!RecordingUrl || RecordingUrl.trim() === '') {
      console.log('[VOICE DEBUG] No recording URL found')
      const twiml = new VoiceResponse()
      twiml.say({ voice: voiceToUse, language: languageToUse }, 'Sorry, I didn\'t catch that. Please call back if you need assistance.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Download the audio file
    console.log('[VOICE DEBUG] Downloading audio from:', RecordingUrl)
    
    try {
      const response = await axios({
        method: 'get',
        url: RecordingUrl,
        responseType: 'stream',
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID!,
          password: process.env.TWILIO_AUTH_TOKEN!
        }
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
        twiml.say({ voice: voiceToUse, language: languageToUse }, 'I had trouble understanding. Could you please try again or call back later?')
        twiml.hangup()
        
        res.setHeader('Content-Type', 'application/xml')
        res.send(twiml.toString())
        return
      }
      
      // Check if transcription is empty
      if (!transcribedText || transcribedText.trim() === '') {
        console.log('[VOICE DEBUG] Empty transcription result')
        const twiml = new VoiceResponse()
        twiml.say({ voice: voiceToUse, language: languageToUse }, 'I had trouble understanding. Could you please try again or call back later?')
        twiml.hangup()
        
        res.setHeader('Content-Type', 'application/xml')
        res.send(twiml.toString())
        return
      }
      
      // Update conversation history with user's message
      currentConversationHistory.push({ role: 'user', content: transcribedText })
      console.log('[VOICE DEBUG] Updated conversation history with user message')
      
      // Process with AI handler using full context
      console.log('[VOICE DEBUG] Processing message with AI handler...')
      const aiResponse = await processMessage(
        transcribedText, // The latest transcribed message
        currentConversationHistory, // Full conversation history
        business.id,
        currentActiveFlow // Current flow state before this turn
      )
      
      console.log('[Handle Recording] AI Handler response:', aiResponse)
      
      // Update conversation history with AI's response
      currentConversationHistory.push({ role: 'assistant', content: aiResponse.reply })
      
      // Update current active flow based on AI response
      currentActiveFlow = aiResponse.currentFlow || null
      
      // Save updated session state
      updateVoiceSession(callSid, currentConversationHistory, currentActiveFlow)
      console.log('[VOICE DEBUG] Updated session state:', { 
        historyLength: currentConversationHistory.length, 
        newFlow: currentActiveFlow 
      })
      
      // Create TwiML response based on flow state
      const twimlResponse = new VoiceResponse()
      
      if (aiResponse && aiResponse.reply) {
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, aiResponse.reply)
      } else {
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, "I'm sorry, I encountered an issue.")
      }
      
      // Continue conversation if flow is active, otherwise end call
      if (currentActiveFlow !== null) {
        // Flow should continue - prompt for more input
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, "Is there anything else, or say 'goodbye' to end.")
        twimlResponse.record({
          action: '/api/voice/handle-recording',
          method: 'POST',
          maxLength: 30,
          playBeep: true,
          timeout: 7, // Seconds of silence before completing recording
          transcribe: false
        })
        
        // Fallback if no response
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, 'We did not receive any input. Goodbye.')
        twimlResponse.hangup()
      } else {
        // Flow is complete - end the call
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, "Thank you for calling. Goodbye.")
        twimlResponse.hangup()
        clearVoiceSession(callSid) // Clean up session for ended call
        console.log('[VOICE DEBUG] Call ended, session cleared for CallSid:', callSid)
      }
      
      // Send TwiML response
      res.setHeader('Content-Type', 'application/xml')
      res.send(twimlResponse.toString())
      
    } catch (downloadError: any) {
      console.error('[VOICE DEBUG] Error downloading audio:', downloadError.isAxiosError ? downloadError.toJSON() : downloadError)
      
      const twiml = new VoiceResponse()
      twiml.say({ voice: voiceToUse, language: languageToUse }, 'Sorry, I had trouble accessing your message recording. Please try again.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
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