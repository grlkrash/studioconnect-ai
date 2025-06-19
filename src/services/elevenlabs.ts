import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { getEnterpriseVoiceSettings } from '../config/enterpriseDefaults'

/**
 * 🎯 BULLETPROOF ENTERPRISE ELEVENLABS TTS GENERATOR 🎯
 * Generates Fortune 500 quality MP3 speech files using ElevenLabs premium TTS
 * Features enterprise-grade caching, error handling, and voice optimization
 *
 * Environment variables required:
 *  - ELEVENLABS_API_KEY (CRITICAL for Fortune 500 quality)
 *  - ELEVENLABS_VOICE_ID (optional – defaults to premium Adam voice)
 *  - ELEVENLABS_MODEL_ID (optional – defaults to "eleven_turbo_v2_5")
 */
export async function generateSpeechWithElevenLabs(
  text: string,
  voiceId?: string,
  modelId: string = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
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

  // Clean text - remove SSML tags for ElevenLabs (they have their own format)
  const cleanText = text.replace(/<[^>]*>/g, '').trim()

  // ------------------------------------------------------------------
  //  Determine whether the provided value is already a **voice ID** or
  //  a **friendly name** (e.g. "Josh", "Rachel").  A voice ID can now
  //  contain mixed-case alphanumerics as well as dashes/underscores and
  //  is typically 20+ characters long (e.g. "kdmDKE6EkgrWrrykO9Qt").
  // ------------------------------------------------------------------

  const rawVoice = voiceId || process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB' // Adam voice

  // Broadened regex: allow letters **beyond** hex as well as hyphens/underscores.
  const voiceIdPattern = /^[a-zA-Z0-9_-]{20,}$/
  const looksLikeVoiceId = voiceIdPattern.test(rawVoice)

  // Preserve original casing for IDs — ElevenLabs IDs are case-sensitive.
  const finalVoice = looksLikeVoiceId ? rawVoice : rawVoice.toLowerCase()

  // ----------------------------------------------------------------------------------
  //  If the caller supplied a friendly name we resolve it to the
  //  corresponding voice ID once and cache the mapping.
  // ----------------------------------------------------------------------------------

  let voiceIdForRequest = finalVoice

  if (!looksLikeVoiceId) {
    // Simple in-memory cache so we only hit the /voices endpoint once per process
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
        const match = (data?.voices || []).find((v: any) => v.name.toLowerCase() === finalVoice.toLowerCase())
        if (match?.voice_id) {
          cache[finalVoice] = match.voice_id
          voiceIdForRequest = match.voice_id
          console.log(`[ElevenLabs] Resolved voice "${finalVoice}" → ${voiceIdForRequest}`)
        } else {
          console.warn(`[ElevenLabs] Voice name "${finalVoice}" not found – using default Adam voice ID`)
          voiceIdForRequest = 'pNInz6obpgDQGcFmaJgB' // Adam voice
        }
      } catch (err) {
        console.error('[ElevenLabs] Voice list fetch failed – falling back to default Adam voice ID', err instanceof Error ? err.message : err)
        voiceIdForRequest = 'pNInz6obpgDQGcFmaJgB' // Adam voice
      }
    }
  }

  // Build deterministic cache key
  let cachedPath: string | null = null
  try {
    const cacheDir = path.join(os.tmpdir(), 'scai_tts_cache')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const hash = crypto.createHash('sha256').update(`11labs|${modelId}|${voiceIdForRequest}|${cleanText}|${JSON.stringify(voiceSettings || {})}`).digest('hex')
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

    // 🎯 BULLETPROOF REQUEST BODY WITH ENTERPRISE DEFAULTS 🎯
    const enterpriseDefaults = getEnterpriseVoiceSettings();
    const requestBody = {
      text: cleanText,
      model_id: modelId,
      voice_settings: {
        stability: voiceSettings?.stability ?? enterpriseDefaults.stability,
        similarity_boost: voiceSettings?.similarity ?? enterpriseDefaults.similarity,
        style: voiceSettings?.style ?? enterpriseDefaults.style,
        use_speaker_boost: voiceSettings?.use_speaker_boost ?? enterpriseDefaults.use_speaker_boost,
      }
    }

    // Add enterprise-optimized speed
    if (voiceSettings?.speed !== undefined) {
      (requestBody.voice_settings as any).speed = voiceSettings.speed
    } else if (enterpriseDefaults.speed !== undefined) {
      (requestBody.voice_settings as any).speed = enterpriseDefaults.speed
    }

    console.log(`[🎯 BULLETPROOF ELEVENLABS] 🚀 Generating Fortune 500 quality TTS with voice ${voiceIdForRequest} and model ${modelId}`)

    const response = await axios.post(url, requestBody, {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    })

    const buffer = Buffer.from(response.data as ArrayBuffer)
    const targetPath = cachedPath || path.join(os.tmpdir(), `11labs_speech_${Date.now()}.mp3`)
    await fs.promises.writeFile(targetPath, buffer)
    
    console.log(`[ElevenLabs] Successfully generated speech: ${targetPath}`)
    return targetPath
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[ElevenLabs] API Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        voiceId: voiceIdForRequest,
        modelId,
        textLength: cleanText.length
      })
      
      // Log specific error details for debugging
      if (error.response?.status === 400) {
        console.error('[ElevenLabs] Bad Request - Check voice ID and model compatibility')
      } else if (error.response?.status === 401) {
        console.error('[ElevenLabs] Authentication failed - Check API key')
      } else if (error.response?.status === 422) {
        console.error('[ElevenLabs] Validation error - Check request parameters')
      }
    } else {
      console.error('[ElevenLabs] Error generating speech:', error)
    }
    return null
  }
} 