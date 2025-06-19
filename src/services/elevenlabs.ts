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
  modelId: string = process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v2',
  voiceSettings?: {
    stability?: number
    similarity?: number
    style?: number
    use_speaker_boost?: boolean
    speed?: number
  }
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

  // ----------------------------------------------------------------------------------
  //  ElevenLabs expects a voice *ID* (UUID-like).  Many configs still use the friendly
  //  voice *name* (e.g. "Josh", "Rachel").  When the supplied value doesn't look like
  //  a UUID we transparently resolve it to an ID via the /v1/voices endpoint once and
  //  cache the mapping for the lifetime of the process.
  // ----------------------------------------------------------------------------------

  const looksLikeVoiceId = /^[a-f0-9]{20,}$/i.test(finalVoice)
  let voiceIdForRequest = finalVoice

  if (!looksLikeVoiceId) {
    // Simple in-memory cache
    const cache: Record<string, string> = (global as any).__scaiVoiceCache ?? {}
    if (!(global as any).__scaiVoiceCache) (global as any).__scaiVoiceCache = cache

    if (cache[finalVoice]) {
      voiceIdForRequest = cache[finalVoice]
    } else {
      try {
        const { data } = await axios.get('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': apiKey },
          timeout: 10000,
        })
        const match = (data?.voices || []).find((v: any) => v.name.toLowerCase() === finalVoice)
        if (match?.voice_id) {
          cache[finalVoice] = match.voice_id
          voiceIdForRequest = match.voice_id
          console.log(`[ElevenLabs] Resolved voice "${finalVoice}" → ${voiceIdForRequest}`)
        } else {
          console.warn(`[ElevenLabs] Voice name "${finalVoice}" not found – using default voice ID`)
          voiceIdForRequest = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' // Rachel
        }
      } catch (err) {
        console.error('[ElevenLabs] Voice list fetch failed – falling back to default voice ID', err instanceof Error ? err.message : err)
        voiceIdForRequest = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
      }
    }
  }

  // Build deterministic cache key
  let cachedPath: string | null = null
  try {
    const cacheDir = path.join(os.tmpdir(), 'scai_tts_cache')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const hash = crypto.createHash('sha256').update(`11labs|${modelId}|${voiceIdForRequest}|${text}|${JSON.stringify(voiceSettings || {})}`).digest('hex')
    cachedPath = path.join(cacheDir, `${hash}.mp3`)
    if (fs.existsSync(cachedPath)) {
      console.log(`[ElevenLabs] Returning cached speech (hash=${hash.slice(0,8)})`)
      return cachedPath
    }
  } catch (err) {
    console.warn('[ElevenLabs] Cache access error – continuing without cache', err)
  }

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceIdForRequest)}`

    const response = await axios.post(
      url,
      {
        model_id: modelId,
        text,
        voice_settings: {
          stability: voiceSettings?.stability ?? 0.3,
          similarity_boost: voiceSettings?.similarity ?? 0.8,
          style: voiceSettings?.style ?? 0.5,
          use_speaker_boost: voiceSettings?.use_speaker_boost ?? true,
          speed: voiceSettings?.speed ?? undefined,
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