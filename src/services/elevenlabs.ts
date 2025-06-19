import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'

/**
 * Generates an MP3 speech file using ElevenLabs TTS.
 * Caches identical requests on disk under os.tmpdir()/scai_tts_cache.
 *
 * Environment variables required:
 *  - ELEVENLABS_API_KEY
 *  - ELEVENLABS_VOICE_ID (optional – defaults to "Rachel")
 *  - ELEVENLABS_MODEL_ID (optional – defaults to "eleven_monolingual_v2")
 */
export async function generateSpeechWithElevenLabs(
  text: string,
  voiceId?: string,
  modelId: string = process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v2'
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.error('[ElevenLabs] ELEVENLABS_API_KEY is not set')
    return null
  }

  if (!text || !text.trim()) {
    console.warn('[ElevenLabs] Empty text input – skipping TTS')
    return null
  }

  const finalVoice = (voiceId || process.env.ELEVENLABS_VOICE_ID || 'Josh').toLowerCase()

  // Build deterministic cache key
  let cachedPath: string | null = null
  try {
    const cacheDir = path.join(os.tmpdir(), 'scai_tts_cache')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const hash = crypto.createHash('sha256').update(`11labs|${modelId}|${finalVoice}|${text}`).digest('hex')
    cachedPath = path.join(cacheDir, `${hash}.mp3`)
    if (fs.existsSync(cachedPath)) {
      console.log(`[ElevenLabs] Returning cached speech (hash=${hash.slice(0,8)})`)
      return cachedPath
    }
  } catch (err) {
    console.warn('[ElevenLabs] Cache access error – continuing without cache', err)
  }

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(finalVoice)}`

    const response = await axios.post(
      url,
      {
        model_id: modelId,
        text,
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.8,
          style: 0.5,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    )

    const buffer = Buffer.from(response.data as ArrayBuffer)
    const targetPath = cachedPath || path.join(os.tmpdir(), `11labs_speech_${Date.now()}.mp3`)
    await fs.promises.writeFile(targetPath, buffer)
    return targetPath
  } catch (error) {
    console.error('[ElevenLabs] Error generating speech:', error)
    return null
  }
} 