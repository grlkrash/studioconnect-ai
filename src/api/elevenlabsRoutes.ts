import express from 'express'
import axios from 'axios'

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