/**
 * 🎯 BULLETPROOF ENTERPRISE CONFIGURATION 🎯
 * Fortune 500 quality defaults and settings
 * ZERO TOLERANCE FOR FAILURE
 */

export const ENTERPRISE_VOICE_CONFIG = {
  // 🎯 BULLETPROOF TTS SETTINGS
  TTS: {
    PRIMARY_PROVIDER: 'elevenlabs' as const,
    FALLBACK_CHAIN: ['elevenlabs', 'openai', 'polly'] as const,
    
    // ElevenLabs Fortune 500 Settings
    ELEVENLABS: {
      DEFAULT_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam - Premium
      DEFAULT_MODEL: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
      VOICE_SETTINGS: {
        stability: 0.75,        // Higher stability for Fortune 500 consistency
        similarity: 0.85,       // Maximum voice consistency
        style: 0.10,            // Professional, not dramatic
        use_speaker_boost: true,
        speed: 0.95             // Slightly slower for executive clarity
      }
    },
    
    // OpenAI Fallback Settings
    OPENAI: {
      DEFAULT_VOICE: 'nova' as const,
      DEFAULT_MODEL: 'tts-1-hd' as const,
      SPEED: 0.95
    }
  },

  // 🎯 BULLETPROOF VAD SETTINGS
  VAD: {
    THRESHOLD: 45,              // INCREASED - Eliminates phantom speech
    SILENCE_MS: 2000,           // INCREASED - Better sentence completion
    MAX_UTTERANCE_MS: 10000,    // INCREASED - Complex business discussions
    CALIBRATION_SAMPLES: 200,   // INCREASED - More accurate calibration
    NOISE_MARGIN: 35            // INCREASED - Bulletproof phantom elimination
  },

  // 🎯 BULLETPROOF AUDIO PROCESSING
  AUDIO: {
    CHUNK_SIZE: 320,            // 40ms chunks for real-time streaming
    SAMPLE_RATE: 8000,          // Twilio standard
    MIN_DURATION_MS: 300,       // Minimum audio for transcription
    FFMPEG_FILTERS: 'volume=0.85,highpass=f=100,lowpass=f=3400', // Professional audio processing
  },

  // 🎯 BULLETPROOF TIMING
  TIMING: {
    IDLE_PROMPTS: [30000, 45000] as [number, number], // Fortune 500 professional timing
    WELCOME_RETRY_DELAY: 1000,                         // Delay between welcome message attempts
    MAX_WELCOME_ATTEMPTS: 3,                           // Maximum welcome message attempts
    TRANSCRIPTION_RETRY_DELAY: 500,                    // Delay between transcription attempts
    MAX_TRANSCRIPTION_ATTEMPTS: 3                      // Maximum transcription attempts
  },

  // 🎯 BULLETPROOF PHANTOM SPEECH FILTERING
  PHANTOM_FILTER: {
    PHANTOM_WORDS: ['you', 'uh', 'um', 'ah', 'er', 'mmm', 'hmm', 'hm', 'mm', 'mhm', 'uhm', 'em'],
    SINGLE_LETTERS: ['a', 'i', 'o', 'e', 'u', 'y', 'h', 'm', 'n', 's', 't', 'r', 'l', 'd'],
    MIN_WORD_LENGTH: 3,         // Minimum length for single words
    MIN_WORDS_REQUIRED: 2,      // Require at least 2 words for most cases
    
    // Business vocabulary patterns
    BUSINESS_PATTERNS: [
      /\b(thank you|go ahead|not yet|right now|of course|sounds good|that works|makes sense|got it|i see|no problem|sounds great)\b/,
      /\b(kickoff call|project status|design review|final approval|first round|second round|third round|next phase)\b/,
      /\b(brand identity|motion graphics|print ready|web ready|high res|low res|vector file|raster file)\b/,
      /\b(can you|could you|would you|will you|please help|i need|we need|looking for|interested in)\b/
    ],
    
    CREATIVE_INDUSTRY_TERMS: [
      'brand', 'creative', 'design', 'digital', 'web', 'print', 'logo', 'identity', 'package',
      'motion', 'video', 'graphics', 'illustration', 'photo', 'shoot', 'campaign', 'strategy',
      'social', 'media', 'content', 'copy', 'script', 'storyboard', 'wireframe', 'mockup',
      'prototype', 'concept', 'pitch', 'presentation', 'deliverable', 'asset', 'file',
      'format', 'resolution', 'color', 'font', 'typography', 'layout', 'composition',
      'project', 'client', 'business', 'company', 'agency', 'studio', 'marketing',
      'advertising', 'commercial'
    ]
  },

  // 🎯 BULLETPROOF ERROR MESSAGES
  ERROR_MESSAGES: {
    RECOVERY: [
      "I apologize for the brief technical difficulty. Could you please repeat that for me?",
      "I'm sorry, I didn't catch that clearly. Could you please say that again?",
      "My apologies - could you repeat your last message? I want to ensure I provide you with accurate information.",
      "I experienced a momentary technical issue. Please repeat what you said so I can assist you properly.",
      "Sorry about that technical glitch. Could you please rephrase your question?"
    ],
    
    EMERGENCY_FALLBACK: "Hello! Thank you for calling. I apologize for any technical difficulties. How may I help you today?",
    
    TRANSCRIPTION_RECOVERY: "I'm sorry, I didn't catch that. Could you please repeat what you said?"
  },

  // 🎯 BULLETPROOF WELCOME MESSAGES
  WELCOME_MESSAGES: {
    GENERIC_ENTERPRISE: "Good day! Thank you for calling StudioConnect AI. I'm your dedicated AI Account Manager, ready to provide immediate assistance with your creative projects and strategic business initiatives. How may I help you today?",
    
    BUSINESS_TEMPLATE: (businessName: string) => 
      `Good day! Thank you for calling ${businessName}. I'm your dedicated AI Account Manager, here to provide immediate assistance with your creative projects and strategic initiatives. How may I help you today?`,
    
    RETURNING_CLIENT_TEMPLATE: (businessName: string) =>
      `Welcome back! Thank you for calling ${businessName}. I'm your dedicated AI Account Manager, here to provide immediate assistance with your creative projects and strategic initiatives. How may I help you today?`
  }
}

// 🎯 BULLETPROOF VALIDATION FUNCTIONS
export const validateEnterpriseConfig = (): boolean => {
  const requiredEnvVars = [
    'ELEVENLABS_API_KEY',
    'OPENAI_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN'
  ]

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar])
  
  if (missing.length > 0) {
    console.error('[🎯 ENTERPRISE CONFIG] ❌ CRITICAL: Missing required environment variables:', missing)
    return false
  }

  console.log('[🎯 ENTERPRISE CONFIG] ✅ All required environment variables present')
  return true
}

export const getEnterpriseVoiceSettings = () => ENTERPRISE_VOICE_CONFIG.TTS.ELEVENLABS.VOICE_SETTINGS

export const getEnterpriseVADSettings = () => ENTERPRISE_VOICE_CONFIG.VAD

export const getEnterprisePhantomFilter = () => ENTERPRISE_VOICE_CONFIG.PHANTOM_FILTER

export const getEnterpriseErrorMessages = () => ENTERPRISE_VOICE_CONFIG.ERROR_MESSAGES

export default ENTERPRISE_VOICE_CONFIG 