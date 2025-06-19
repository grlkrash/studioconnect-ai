import express from 'express'
import axios from 'axios'
import { generateSpeechWithElevenLabs } from '../services/elevenlabs'

export const elevenLabsRouter = express.Router()

elevenLabsRouter.get('/voices', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'ELEVENLABS_API_KEY missing' })
    const { data } = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    })
    res.json(data)
  } catch (err: any) {
    console.error('[11Labs] voice list error', err.message)
    res.status(500).json({ error: 'Failed to fetch voices' })
  }
})

// Voice preview endpoint for admin UI
elevenLabsRouter.post('/preview', async (req, res) => {
  try {
    const { text, voiceId, voiceSettings } = req.body
    
    if (!text || !voiceId) {
      return res.status(400).json({ error: 'Text and voiceId are required' })
    }

    const audioPath = await generateSpeechWithElevenLabs(
      text,
      voiceId,
      'eleven_turbo_v2_5',
      voiceSettings
    )

    if (!audioPath) {
      return res.status(500).json({ error: 'Failed to generate speech' })
    }

    // Stream the audio file
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Disposition', 'inline; filename="voice-preview.mp3"')
    
    const fs = require('fs')
    const stream = fs.createReadStream(audioPath)
    stream.pipe(res)
    
    // Clean up file after streaming
    stream.on('end', () => {
      fs.unlink(audioPath, (err: any) => {
        if (err) console.error('Failed to cleanup preview file:', err)
      })
    })
    
  } catch (err: any) {
    console.error('[11Labs] voice preview error', err.message)
    res.status(500).json({ error: 'Failed to generate voice preview' })
  }
}) 