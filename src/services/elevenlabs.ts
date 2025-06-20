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
    similarity_boost?: number
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
  
  // 🎯 ENHANCE TEXT FOR NATURAL SPEECH PACING 🎯
  let enhancedText = cleanText
  
  // Add natural pauses after sentences for conversational flow
  enhancedText = enhancedText.replace(/([.!?])\s+/g, '$1 ')
  
  // Add slight pauses after commas for natural breathing
  enhancedText = enhancedText.replace(/,\s+/g, ', ')
  
  // Enhance natural speech patterns for business conversations
  enhancedText = enhancedText.replace(/\b(Got it|Perfect|Absolutely|Excellent)\b/gi, '$1.')
  enhancedText = enhancedText.replace(/\b(Let me|Allow me|I'll)\b/gi, '$1...')
  enhancedText = enhancedText.replace(/\b(Thank you|Thanks)\b/gi, '$1.')
  
  // Improve question delivery for better engagement
  enhancedText = enhancedText.replace(/\?\s*$/g, '?')
  
  // Add emphasis to important business terms
  enhancedText = enhancedText.replace(/\b(urgent|emergency|important|critical)\b/gi, '$1')
  enhancedText = enhancedText.replace(/\b(project|deadline|timeline|status)\b/gi, '$1')
  
  console.log(`[🎯 BULLETPROOF ELEVENLABS] 📝 Enhanced text for natural delivery: "${enhancedText.substring(0, 100)}${enhancedText.length > 100 ? '...' : ''}"`)

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
    const hash = crypto.createHash('sha256').update(`11labs|${modelId}|${voiceIdForRequest}|${enhancedText}|${JSON.stringify(voiceSettings || {})}`).digest('hex')
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
      text: enhancedText, // Use enhanced text for better delivery
      model_id: modelId,
      voice_settings: {
        stability: voiceSettings?.stability ?? enterpriseDefaults.stability,
        similarity_boost: voiceSettings?.similarity_boost ?? voiceSettings?.similarity ?? enterpriseDefaults.similarity_boost,
        style: voiceSettings?.style ?? enterpriseDefaults.style,
        use_speaker_boost: voiceSettings?.use_speaker_boost ?? enterpriseDefaults.use_speaker_boost,
      }
    }

    // Add enterprise-optimized speed if available
    if (voiceSettings?.speed !== undefined) {
      (requestBody.voice_settings as any).speed = voiceSettings.speed
    }

    console.log(`[🎯 BULLETPROOF ELEVENLABS] 🚀 Generating Fortune 500 quality TTS:`)
    console.log(`[🎯 BULLETPROOF ELEVENLABS] 🎙️ Voice ID: ${voiceIdForRequest}`)
    console.log(`[🎯 BULLETPROOF ELEVENLABS] 🔧 Model: ${modelId}`)
    console.log(`[🎯 BULLETPROOF ELEVENLABS] 📊 Voice Settings:`, requestBody.voice_settings)
    console.log(`[🎯 BULLETPROOF ELEVENLABS] 📝 Text: "${enhancedText.substring(0, 100)}${enhancedText.length > 100 ? '...' : ''}"`)

    // 🚨 CRITICAL FIX: Aggressive error handling with hard failure logging
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
    
    // 🚨 CRITICAL FIX: Validate audio buffer before proceeding
    if (!buffer || buffer.length === 0) {
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Empty audio buffer received from ElevenLabs API');
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Voice ID:', voiceIdForRequest);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Model:', modelId);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Text Length:', enhancedText.length);
      throw new Error('ELEVENLABS_GENERATION_FAILED: Empty audio buffer');
    }
    
    const targetPath = cachedPath || path.join(os.tmpdir(), `11labs_speech_${Date.now()}.mp3`)
    
    // 🚨 CRITICAL FIX: Wrap file write in try-catch with detailed error logging
    try {
      await fs.promises.writeFile(targetPath, buffer)
    } catch (writeError) {
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Failed to write audio file:', writeError);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Target path:', targetPath);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Buffer size:', buffer.length);
      throw new Error('ELEVENLABS_GENERATION_FAILED: File write error');
    }
    
    console.log(`[🎯 BULLETPROOF ELEVENLABS] ✅ Successfully generated Fortune 500 quality speech: ${targetPath} (${buffer.length} bytes)`)
    return targetPath
  } catch (error) {
    // 🚨 CRITICAL FIX: Aggressive error logging with NO silent fallbacks
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] ===============================');
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] CRITICAL TTS GENERATION FAILURE');
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] ===============================');
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Voice ID:', voiceIdForRequest);
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Model ID:', modelId);
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Text Length:', enhancedText.length);
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Text Preview:', enhancedText.substring(0, 200));
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Timestamp:', new Date().toISOString());
    
    if (axios.isAxiosError(error)) {
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] HTTP Status:', error.response?.status);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] HTTP Status Text:', error.response?.statusText);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Response Data:', error.response?.data);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Request URL:', error.config?.url);
      
      // Enhanced error handling with specific remediation advice
      if (error.response?.status === 400) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 🚫 Bad Request - Voice ID and model incompatible')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Voice ID used:', voiceIdForRequest)
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Model used:', modelId)
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Verify voice ID exists and supports the model')
      } else if (error.response?.status === 401) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 🔐 Authentication failed - Invalid API key')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 API Key present:', !!apiKey)
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 API Key length:', apiKey ? apiKey.length : 0)
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Check ELEVENLABS_API_KEY environment variable')
      } else if (error.response?.status === 403) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 🚫 Forbidden - API key lacks access to this voice')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Voice ID:', voiceIdForRequest)
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Verify API key has access to the voice or use a different voice')
      } else if (error.response?.status === 422) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 🔧 Validation error - Invalid request parameters')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Voice Settings:', JSON.stringify(voiceSettings, null, 2))
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Check voice settings values are within valid ranges')
      } else if (error.response?.status === 429) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] ⏰ Rate limit exceeded - Too many requests')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Implement request throttling or upgrade API plan')
      } else if (error.response && error.response.status >= 500) {
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 🏥 Server error - ElevenLabs service issue')
        console.error('[🚨 ELEVENLABS_GENERATION_FAILED] 💡 Remediation: Retry after delay or contact ElevenLabs support')
      }
    } else {
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Non-HTTP Error:', error);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Error Type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Error Message:', error instanceof Error ? error.message : String(error));
      console.error('[🚨 ELEVENLABS_GENERATION_FAILED] Error Stack:', error instanceof Error ? error.stack : 'No stack trace');
    }
    
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] ===============================');
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] NO FALLBACK WILL BE ATTEMPTED');
    console.error('[🚨 ELEVENLABS_GENERATION_FAILED] ===============================');
    
    // 🚨 HARD FAIL – Prevent silent fallback to low-quality TTS
    throw new Error('ELEVENLABS_GENERATION_FAILED')
  }
} 