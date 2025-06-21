import { Router, Response, Request } from 'express'
import twilio from 'twilio'
import realtimeAgentService from '../services/realtimeAgentService'
import { processMessage } from '../core/aiHandler'
import { asyncHandler } from '../utils/asyncHandler'
import { prisma } from '../services/db'
import { enterpriseVoiceAgent } from '../services/enterpriseVoiceAgent'
import { elevenLabsAgent } from '../services/elevenlabsConversationalAgent'
import { Prisma } from '@prisma/client'

const router = Router()
const { VoiceResponse } = twilio.twiml

// Validate Twilio signatures (only in production)
const customValidateTwilioRequest = (req: Request, res: Response, next: () => void) => {
  if (process.env.NODE_ENV !== 'production') return next()

  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const twilioSignature = req.header('X-Twilio-Signature') || ''
  const url = new URL(req.originalUrl, `https://${req.header('host')}`).toString()

  const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body)
  if (isValid) {
    console.log('[Twilio Validation] Signature is valid.')
    return next()
  }

  console.warn('[Twilio Validation] Invalid signature.')
  res.status(403).send('Forbidden')
}

// POST /incoming – TwiML that tells Twilio to open a Media Stream to our WebSocket
router.post('/incoming', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const callSid = req.body.CallSid as string
    const toNumberRaw = req.body.To as string | undefined
    let resolvedBusinessId: string | undefined

    // 🚨 CRITICAL FIX: Bulletproof business ID resolution
    if (!req.body.businessId && toNumberRaw) {
      try {
        console.log('[🚨 BUSINESS RESOLUTION] 🔍 Resolving business ID from phone number:', toNumberRaw);
        
        // Normalize phone to last 10 digits for reliable matching
        const normalizedTo = toNumberRaw.replace(/\D/g, '');
        const lastTen = normalizedTo.slice(-10);
        
        console.log('[🚨 BUSINESS RESOLUTION] 📞 Normalized phone numbers:', { 
          original: toNumberRaw, 
          normalized: normalizedTo, 
          lastTen 
        });
        
        // Try exact match first
        let biz = await prisma.business.findFirst({
          where: { twilioPhoneNumber: normalizedTo },
          select: { id: true, name: true, twilioPhoneNumber: true }
        });
        
        // Try last 10 digits if exact match fails
        if (!biz && lastTen.length === 10) {
          biz = await prisma.business.findFirst({
            where: { twilioPhoneNumber: { endsWith: lastTen } },
            select: { id: true, name: true, twilioPhoneNumber: true }
          });
        }
        
        // Try alternate formats if still no match
        if (!biz && normalizedTo.length > 10) {
          const alternateFormats = [
            normalizedTo.substring(1), // Remove leading '1'
            `+${normalizedTo}`,        // Add leading '+'
            `+1${lastTen}`             // +1 + last 10 digits
          ];
          
          for (const format of alternateFormats) {
            biz = await prisma.business.findFirst({
              where: { 
                OR: [
                  { twilioPhoneNumber: format },
                  { twilioPhoneNumber: { endsWith: format.slice(-10) } }
                ]
              },
              select: { id: true, name: true, twilioPhoneNumber: true }
            });
            if (biz) break;
          }
        }
        
        if (biz?.id) {
          resolvedBusinessId = biz.id;
          console.log('[🚨 BUSINESS RESOLUTION] ✅ Successfully resolved business:', { 
            businessId: resolvedBusinessId,
            businessName: biz.name,
            configuredPhone: biz.twilioPhoneNumber,
            incomingPhone: toNumberRaw
          });
        } else {
          console.error('[🚨 BUSINESS RESOLUTION] ❌ CRITICAL: No business found for phone number');
          console.error('[🚨 BUSINESS RESOLUTION] 📞 Incoming phone:', toNumberRaw);
          console.error('[🚨 BUSINESS RESOLUTION] 📞 Normalized forms tried:', { normalizedTo, lastTen });
          
          // Log all configured Twilio numbers for debugging
          const allBusinesses = await prisma.business.findMany({
            where: { twilioPhoneNumber: { not: null } },
            select: { id: true, name: true, twilioPhoneNumber: true }
          });
          console.error('[🚨 BUSINESS RESOLUTION] 📋 All configured Twilio numbers:', allBusinesses);
        }
      } catch (lookupErr) {
        console.error('[🚨 BUSINESS RESOLUTION] ❌ CRITICAL ERROR during business lookup:', lookupErr);
        console.error('[🚨 BUSINESS RESOLUTION] 📞 Phone number:', toNumberRaw);
        console.error('[🚨 BUSINESS RESOLUTION] ⚠️ Call will proceed without business context');
      }
    }

    console.log(`[VOICE STREAM] Incoming call received: ${callSid}`)

    const host = process.env.APP_PRIMARY_URL || `https://${req.hostname}`
    const baseWsUrl = host.replace(/^https?:\/\//, 'wss://')

    /*
     * Ensure the generated WebSocket URL always contains a path character ("/") *before* the query string.
     * If the slash is missing, Node's URL parser will treat the "?" as the beginning of the pathname instead
     * of the search params, which breaks the downstream logic that expects `req.url` to start with "/?".
     *
     * Example of the bug:
     *   wss://example.com?callSid=123   ->   req.url === "?callSid=123"   ->   new URL("?callSid=123", "http://localhost") throws `ERR_INVALID_URL`
     *
     * Corrected format:
     *   wss://example.com/?callSid=123  ->   req.url === "/?callSid=123"   ✅
     */
    const wsBaseWithPath = baseWsUrl.endsWith('/') ? baseWsUrl : `${baseWsUrl}/`

    // 🚨 CRITICAL FIX: Bulletproof WebSocket URL with guaranteed business ID
    let wsUrl = `${wsBaseWithPath}?callSid=${encodeURIComponent(callSid)}`
    
    const finalBusinessId = req.body.businessId || resolvedBusinessId;
    
    if (finalBusinessId) {
      wsUrl += `&businessId=${encodeURIComponent(finalBusinessId)}`;
      console.log('[🚨 WEBSOCKET URL] ✅ Business ID included in WebSocket URL:', finalBusinessId);
    } else {
      console.error('[🚨 WEBSOCKET URL] ❌ CRITICAL: No business ID available for WebSocket connection');
      console.error('[🚨 WEBSOCKET URL] 📞 Incoming phone:', toNumberRaw);
      console.error('[🚨 WEBSOCKET URL] ⚠️ Call may fail without proper business context');
      
      // Continue anyway but log for monitoring
      wsUrl += `&missingBusinessId=true&incomingPhone=${encodeURIComponent(toNumberRaw || 'unknown')}`;
    }

    console.log(`[VOICE STREAM] Directing Twilio to connect to WebSocket: ${wsUrl}`)

    const response = new VoiceResponse()
    const connect = response.connect()
    const stream = connect.stream({ url: wsUrl })

    // 🚨 CRITICAL FIX: Enhanced parameter passing for maximum redundancy
    stream.parameter({ name: 'callSid', value: callSid });
    
    if (finalBusinessId) {
      stream.parameter({ name: 'businessId', value: finalBusinessId });
      console.log('[🚨 STREAM PARAMETERS] ✅ Business ID included in stream parameters:', finalBusinessId);
    } else {
      console.error('[🚨 STREAM PARAMETERS] ❌ No business ID available for stream parameters');
      stream.parameter({ name: 'missingBusinessId', value: 'true' });
      stream.parameter({ name: 'incomingPhone', value: toNumberRaw || 'unknown' });
    }

    // Use higher-quality 16 kHz Linear PCM instead of 8 kHz µ-law
    stream.parameter({ name: 'codec', value: 'audio/l16;rate=16000' })

    // Keep the call alive (max 4-hour pause)
    response.pause({ length: 14400 })

    res.type('text/xml')
    res.send(response.toString())
    return
  } catch (error) {
    console.error('[VOICE STREAM] Critical error in /incoming route:', error)
    const response = new VoiceResponse()
    response.say('We are sorry, but there was an error connecting your call. Please try again later.')
    response.hangup()
    res.type('text/xml')
    res.status(500).send(response.toString())
    return
  }
}))

// GET /status – simple health endpoint for voice system
router.get('/status', customValidateTwilioRequest, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const status = realtimeAgentService.getConnectionStatus()
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      voiceSystem: {
        status,
        activeCalls: realtimeAgentService.getActiveConnections()
      }
    })
    return
  } catch (error) {
    console.error('[VOICE STREAM] Error checking status:', error)
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
    return
  }
}))

// POST /fallback-handler – standard Gather fallback that uses ChatGPT when the real-time stream is unavailable
router.post('/fallback-handler', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const twiml = new VoiceResponse()
    const speechResult = req.body.SpeechResult as string | undefined
    const businessId = req.body.businessId as string | undefined

    if (speechResult) {
      const aiResp = await processMessage({
        message: speechResult,
        conversationHistory: [],
        businessId: businessId || '',
        currentActiveFlow: null,
        callSid: req.body.CallSid,
        channel: 'VOICE'
      })
      twiml.say({ voice: 'alice' }, aiResp.reply)
    } else {
      twiml.say({ voice: 'alice' }, 'Now connecting to our standard service.')
    }

    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/fallback-handler',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
      enhanced: true
    })
    gather.say({ voice: 'alice' }, "I didn't catch that. Could you please repeat?")

    res.type('text/xml')
    res.send(twiml.toString())
    return
  } catch (error) {
    console.error('[FALLBACK HANDLER] Error:', error)
    const twiml = new VoiceResponse()
    twiml.say({ voice: 'alice' }, "We're experiencing technical difficulties. Please try your call again later.")
    res.type('text/xml')
    res.status(500).send(twiml.toString())
    return
  }
}))

router.post('/voicemail', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const recordingUrl = req.body.RecordingUrl as string | undefined
    const callSid = req.body.CallSid as string | undefined
    const duration = req.body.RecordingDuration as string | undefined

    console.log('[VOICE] Voicemail received:', { recordingUrl, callSid, duration })

    if (callSid) {
      await prisma.callLog.update({ where: { callSid }, data: { content: recordingUrl, status: 'COMPLETED' } } as any).catch(() => {})
    }

    const twiml = new VoiceResponse()
    twiml.say({ voice: 'Polly.Amy' }, 'Thank you for your message. Goodbye.')
    twiml.hangup()

    res.type('text/xml').send(twiml.toString())
  } catch (error) {
    console.error('[VOICE] Voicemail route error:', error)
    res.status(500).send('Error')
  }
}))

/**
 * 🏢 ENTERPRISE AGENT STATUS ENDPOINT
 * Monitor enterprise voice agent health
 */
router.get('/enterprise-status', (req, res) => {
  const health = enterpriseVoiceAgent.getSystemHealth()
  res.json({
    enterprise: true,
    ...health,
    message: 'Bulletproof Enterprise Voice Agent - Fortune 100/50 Quality'
  })
})

/**
 * 🏢 ENTERPRISE INCOMING ENDPOINT 🏢
 * Fortune 100/50 quality voice experience
 * Use this as your Twilio webhook URL for premium clients
 */
router.post('/enterprise-incoming', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const callSid = req.body.CallSid as string
    const toNumberRaw = req.body.To as string | undefined
    let resolvedBusinessId: string | undefined

    // 🚨 CRITICAL FIX: Bulletproof business ID resolution for enterprise clients
    if (!req.body.businessId && toNumberRaw) {
      try {
        console.log('[🏢 ENTERPRISE INCOMING] 🔍 Resolving business ID from phone number:', toNumberRaw);
        
        // Normalize phone to last 10 digits for reliable matching
        const normalizedTo = toNumberRaw.replace(/\D/g, '');
        const lastTen = normalizedTo.slice(-10);
        
        console.log('[🏢 ENTERPRISE INCOMING] 📞 Normalized phone numbers:', { 
          original: toNumberRaw, 
          normalized: normalizedTo, 
          lastTen 
        });
        
        // Try exact match first
        let biz = await prisma.business.findFirst({
          where: { twilioPhoneNumber: normalizedTo },
          select: { id: true, name: true, twilioPhoneNumber: true }
        });
        
        // Try last 10 digits if exact match fails
        if (!biz && lastTen.length === 10) {
          biz = await prisma.business.findFirst({
            where: { twilioPhoneNumber: { endsWith: lastTen } },
            select: { id: true, name: true, twilioPhoneNumber: true }
          });
        }
        
        if (biz?.id) {
          resolvedBusinessId = biz.id;
          console.log('[🏢 ENTERPRISE INCOMING] ✅ Successfully resolved business:', { 
            businessId: resolvedBusinessId,
            businessName: biz.name,
            configuredPhone: biz.twilioPhoneNumber,
            incomingPhone: toNumberRaw
          });
        } else {
          console.error('[🏢 ENTERPRISE INCOMING] ❌ CRITICAL: No business found for phone number');
          console.error('[🏢 ENTERPRISE INCOMING] 📞 Incoming phone:', toNumberRaw);
        }
      } catch (lookupErr) {
        console.error('[🏢 ENTERPRISE INCOMING] ❌ CRITICAL ERROR during business lookup:', lookupErr);
      }
    }

    console.log(`[🏢 ENTERPRISE INCOMING] Fortune 100/50 call received: ${callSid}`)

    const host = process.env.APP_PRIMARY_URL || `https://${req.hostname}`
    const baseWsUrl = host.replace(/^https?:\/\//, 'wss://')
    const wsBaseWithPath = baseWsUrl.endsWith('/') ? baseWsUrl : `${baseWsUrl}/`

    // 🏢 ENTERPRISE WEBSOCKET URL WITH ENTERPRISE FLAG
    let wsUrl = `${wsBaseWithPath}enterprise?callSid=${encodeURIComponent(callSid)}`
    
    const finalBusinessId = req.body.businessId || resolvedBusinessId;
    
    if (finalBusinessId) {
      wsUrl += `&businessId=${encodeURIComponent(finalBusinessId)}`;
      console.log('[🏢 ENTERPRISE INCOMING] ✅ Business ID included in WebSocket URL:', finalBusinessId);
    } else {
      console.error('[🏢 ENTERPRISE INCOMING] ❌ CRITICAL: No business ID available for WebSocket connection');
      // Continue anyway but log for monitoring
      wsUrl += `&missingBusinessId=true&incomingPhone=${encodeURIComponent(toNumberRaw || 'unknown')}`;
    }

    // Add enterprise flag to force enterprise routing
    wsUrl += `&useEnterprise=true`;

    console.log(`[🏢 ENTERPRISE INCOMING] Directing Twilio to Enterprise WebSocket: ${wsUrl}`)

    const response = new VoiceResponse()
    const connect = response.connect()
    const stream = connect.stream({ url: wsUrl })

    // 🏢 ENTERPRISE STREAM PARAMETERS
    stream.parameter({ name: 'callSid', value: callSid });
    stream.parameter({ name: 'enterpriseMode', value: 'true' });
    
    if (finalBusinessId) {
      stream.parameter({ name: 'businessId', value: finalBusinessId });
      console.log('[🏢 ENTERPRISE INCOMING] ✅ Business ID included in stream parameters:', finalBusinessId);
    }

    // Use highest quality audio for Fortune 100/50 clients
    stream.parameter({ name: 'codec', value: 'audio/l16;rate=16000' })

    // Keep the call alive (max 4-hour pause)
    response.pause({ length: 14400 })

    res.type('text/xml')
    res.send(response.toString())
    return
  } catch (error) {
    console.error('[🏢 ENTERPRISE INCOMING] Critical error:', error)
    const response = new VoiceResponse()
    response.say('We apologize for the technical difficulty. You are being connected to a representative.')
    response.hangup()
    res.type('text/xml')
    res.status(500).send(response.toString())
    return
  }
}))

// 🏢 BULLETPROOF ENTERPRISE INCOMING CALLS - FORTUNE 100/50 QUALITY 🏢
router.post('/enterprise-incoming', async (req, res) => {
  console.log('[🏢 ENTERPRISE INCOMING] 🚀 Fortune 100/50 Quality Call Initiated')
  console.log('[🏢 ENTERPRISE INCOMING] 📞 Call from:', req.body.From)
  console.log('[🏢 ENTERPRISE INCOMING] 📞 Call to:', req.body.To)
  console.log('[🏢 ENTERPRISE INCOMING] 🔗 Call SID:', req.body.CallSid)

  try {
    // Validate business is configured for enterprise
    const business = await prisma.business.findFirst({
      where: { 
        twilioPhoneNumber: req.body.To,
        planTier: 'ENTERPRISE'
      },
      include: {
        agentConfig: true
      }
    })

    if (!business) {
      console.error('[🏢 ENTERPRISE INCOMING] ❌ No enterprise business found for:', req.body.To)
      return res.status(404).send('<Response><Say>This number is not configured for enterprise service.</Say><Hangup/></Response>')
    }

    // Generate bulletproof WebSocket URL for enterprise agent
    const wsUrl = `wss://${req.headers.host}/voice-ws?callSid=${req.body.CallSid}&from=${encodeURIComponent(req.body.From)}&to=${encodeURIComponent(req.body.To)}&agentType=enterprise`

    console.log('[🏢 ENTERPRISE INCOMING] 🔗 WebSocket URL:', wsUrl)

    // Enterprise-grade TwiML response with bulletproof configuration
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" track="both_tracks" />
  </Connect>
</Response>`

    console.log('[🏢 ENTERPRISE INCOMING] ✅ Enterprise TwiML generated successfully')

    res.type('text/xml')
    res.send(twiml)

    // Log enterprise call initiation
    console.log('[🏢 ENTERPRISE INCOMING] 🏢 ENTERPRISE CALL INITIATED SUCCESSFULLY FOR FORTUNE 100/50 CLIENT')

  } catch (error) {
    console.error('[🏢 ENTERPRISE INCOMING] 🚨 CRITICAL ERROR:', error)
    
    // Emergency fallback response
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I apologize, but we're experiencing technical difficulties. Please hold while I connect you to our team.</Say>
  <Dial>${process.env.EMERGENCY_PHONE_NUMBER || '+15551234567'}</Dial>
</Response>`

    res.type('text/xml')
    res.send(emergencyTwiml)
  }
})

// �� ELEVENLABS CONVERSATIONAL AI WEBHOOK - OFFICIAL IMPLEMENTATION
router.post('/elevenlabs-webhook', async (req, res) => {
  try {
    console.log('[🎯 ELEVENLABS WEBHOOK] Incoming call from Twilio')
    await elevenLabsAgent.handleTwilioWebhook(req, res)
  } catch (error) {
    console.error('[🎯 ELEVENLABS WEBHOOK] Error:', error)
    res.status(500).send('Internal server error')
  }
})

// 🎯 ELEVENLABS CONVERSATION EVENTS
router.post('/elevenlabs-events', async (req, res) => {
  try {
    console.log('[🎯 ELEVENLABS EVENTS] Conversation event received')
    await elevenLabsAgent.handleConversationEvent(req.body)
    res.status(200).send('OK')
  } catch (error) {
    console.error('[🎯 ELEVENLABS EVENTS] Error:', error)
    res.status(500).send('Internal server error')
  }
})

// 🎯 CREATE ELEVENLABS AGENT FOR BUSINESS
router.post('/create-agent/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params
    const { 
      name, 
      description, 
      instructions, 
      first_message, 
      voice_id,
      voice_settings 
    } = req.body

    console.log(`[🎯 ELEVENLABS AGENT] Creating agent for business: ${businessId}`)

    const agentId = await elevenLabsAgent.createAgent(businessId, {
      name,
      description,
      instructions,
      first_message,
      voice_id,
      voice_settings
    })

    // Update business configuration with new agent ID
    await prisma.agentConfig.upsert({
      where: { businessId },
      update: { 
        personaPrompt: instructions,
        elevenlabsVoice: voice_id
      },
      create: {
        businessId,
        personaPrompt: instructions,
        elevenlabsVoice: voice_id
      }
    })

    res.json({ 
      success: true, 
      agentId,
      message: 'ElevenLabs Conversational AI agent created successfully'
    })

  } catch (error) {
    console.error('[🎯 ELEVENLABS AGENT] Create agent error:', error)
    res.status(500).json({ 
      error: 'Failed to create ElevenLabs agent',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// 🎯 ELEVENLABS PERSONALIZATION WEBHOOK - MAIN ENDPOINT
router.post('/elevenlabs-personalization', async (req, res) => {
  try {
    const { caller_id, agent_id, called_number, call_sid } = req.body
    
    console.log(`[🎯 PERSONALIZATION] ================================================`)
    console.log(`[🎯 PERSONALIZATION] 📞 INCOMING CALL`)
    console.log(`[🎯 PERSONALIZATION] 📞 Caller: ${caller_id}`)
    console.log(`[🎯 PERSONALIZATION] 📞 Called: ${called_number}`)
    console.log(`[🎯 PERSONALIZATION] 🤖 Agent: ${agent_id}`)
    console.log(`[🎯 PERSONALIZATION] 📞 Call SID: ${call_sid}`)
    console.log(`[🎯 PERSONALIZATION] ================================================`)

    // Simple phone number matching
    const normalizePhone = (num: string | null | undefined) =>
      (num || '').replace(/[^0-9]/g, '')

    let business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: called_number },
      include: { agentConfig: true }
    })
    
    if (!business && called_number) {
      const digits = normalizePhone(called_number)
      business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: { endsWith: digits } },
        include: { agentConfig: true }
      })
    }

    if (!business) {
      console.error(`[🎯 PERSONALIZATION] ❌ No business found for ${called_number}`)
      return res.json({
        first_message: "Hello! Thank you for calling Aurora Branding & Co. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?",
        system_prompt: "You are a professional AI Account Manager for Aurora Branding & Co, a premium creative agency.",
        voice_id: 'pNInz6obpgDQGcFmaJgB'
      })
    }
    
    console.log(`[🎯 PERSONALIZATION] ✅ FOUND BUSINESS: ${business.name}`)
    
    // Check for existing client
    const existingClient = await prisma.client.findFirst({
      where: { 
        phone: caller_id,
        businessId: business.id
      },
      select: { id: true, name: true }
    })
    
    // Build welcome message
    let welcomeMessage = business.agentConfig?.welcomeMessage || business.agentConfig?.voiceGreetingMessage
    if (!welcomeMessage) {
      if (existingClient) {
        const clientName = existingClient.name ? existingClient.name.split(' ')[0] : 'there'
        welcomeMessage = `Hello ${clientName}! Thank you for calling ${business.name}. I'm here to help with your projects and any questions you might have. What can I assist you with today?`
      } else {
        welcomeMessage = `Hello! Thank you for calling ${business.name}. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?`
      }
    }
    
    // Build system prompt
    let systemPrompt = business.agentConfig?.personaPrompt
    if (!systemPrompt) {
      systemPrompt = `You are a professional AI Account Manager for ${business.name}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused.

YOUR CORE ROLES:
${existingClient ? `
CLIENT SERVICE: For this existing client, provide:
- Project status updates and timeline information
- Address concerns and questions professionally  
- Coordinate with team for complex requests
` : `
LEAD QUALIFICATION: For this new caller, professionally gather:
- Company name and contact details
- Project type and requirements
- Timeline and budget expectations
`}

CONVERSATION GUIDELINES:
- Keep responses concise (2-3 sentences max)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Use natural, conversational language with professional tone

Remember: You represent a Fortune 100 quality agency.`
    }
    
    const response = {
      first_message: welcomeMessage,
      system_prompt: systemPrompt,
      voice_id: business.agentConfig?.elevenlabsVoice || 'pNInz6obpgDQGcFmaJgB',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.3,
        use_speaker_boost: true,
        speed: 1.0
      }
    }
    
    console.log(`[🎯 PERSONALIZATION] ✅ SENDING RESPONSE FOR ${business.name}`)
    res.json(response)
    
  } catch (error) {
    console.error('[🎯 PERSONALIZATION] ❌ ERROR:', error)
    res.json({
      first_message: "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?",
      system_prompt: "You are a professional AI assistant.",
      voice_id: 'pNInz6obpgDQGcFmaJgB'
    })
  }
})

// 🎯 ELEVENLABS WEBHOOK FOR MULTI-TENANT PERSONALIZATION - SIMPLIFIED VERSION
router.post('/elevenlabs-personalization-fixed', async (req, res) => {
  try {
    const { caller_id, agent_id, called_number, call_sid } = req.body
    
    console.log(`[🎯 PERSONALIZATION FIXED] ================================================`)
    console.log(`[🎯 PERSONALIZATION FIXED] 📞 INCOMING CALL`)
    console.log(`[🎯 PERSONALIZATION FIXED] 📞 Caller: ${caller_id}`)
    console.log(`[🎯 PERSONALIZATION FIXED] 📞 Called: ${called_number}`)
    console.log(`[🎯 PERSONALIZATION FIXED] 🤖 Agent: ${agent_id}`)
    console.log(`[🎯 PERSONALIZATION FIXED] 📞 Call SID: ${call_sid}`)
    console.log(`[🎯 PERSONALIZATION FIXED] ================================================`)

    // Simple phone number matching only
    const normalizePhone = (num: string | null | undefined) =>
      (num || '').replace(/[^0-9]/g, '')

    let business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: called_number },
      include: { agentConfig: true }
    })
    
    if (!business && called_number) {
      const digits = normalizePhone(called_number)
      business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: { endsWith: digits } },
        include: { agentConfig: true }
      })
    }

    if (!business) {
      console.error(`[🎯 PERSONALIZATION FIXED] ❌ No business found for ${called_number}`)
      // Return Aurora Branding & Co default since we know it exists
      return res.json({
        first_message: "Hello! Thank you for calling Aurora Branding & Co. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?",
        system_prompt: `You are a professional AI Account Manager for Aurora Branding & Co, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

CONVERSATION GUIDELINES:
- Keep responses concise and to the point (2-3 sentences max)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Use natural, conversational language with professional tone

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect premium service standards.`,
        voice_id: 'pNInz6obpgDQGcFmaJgB',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.3,
          use_speaker_boost: true,
          speed: 1.0
        }
      })
    }
    
    console.log(`[🎯 PERSONALIZATION FIXED] ✅ FOUND BUSINESS: ${business.name}`)
    
    // Check for existing client
    const existingClient = await prisma.client.findFirst({
      where: { 
        phone: caller_id,
        businessId: business.id
      },
      select: { id: true, name: true }
    })
    
    // Build welcome message
    let welcomeMessage = business.agentConfig?.welcomeMessage || business.agentConfig?.voiceGreetingMessage
    if (!welcomeMessage) {
      if (existingClient) {
        const clientName = existingClient.name ? existingClient.name.split(' ')[0] : 'there'
        welcomeMessage = `Hello ${clientName}! Thank you for calling ${business.name}. I'm here to help with your projects and any questions you might have. What can I assist you with today?`
      } else {
        welcomeMessage = `Hello! Thank you for calling ${business.name}. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?`
      }
    }
    
    // Build system prompt
    let systemPrompt = business.agentConfig?.personaPrompt
    if (!systemPrompt) {
      systemPrompt = `You are a professional AI Account Manager for ${business.name}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

YOUR CORE ROLES:
${existingClient ? `
CLIENT SERVICE: For this existing client, provide:
- Project status updates and timeline information
- Address concerns and questions professionally  
- Coordinate with team for complex requests
- Maintain strong client relationships
` : `
LEAD QUALIFICATION: For this new caller, professionally gather:
- Company name and contact details
- Project type and requirements (web design, branding, marketing, etc.)
- Timeline and budget expectations
- Decision-making authority
`}

CONVERSATION GUIDELINES:
- Keep responses concise and to the point (2-3 sentences max)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Use natural, conversational language with professional tone

BUSINESS CONTEXT:
- Business Name: ${business.name}
- This is ${existingClient ? 'an existing client' : 'a new lead'}
${existingClient ? `- Client Name: ${existingClient.name}` : ''}

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect premium service standards.`
    }
    
    const response = {
      first_message: welcomeMessage,
      system_prompt: systemPrompt,
      voice_id: business.agentConfig?.elevenlabsVoice || 'pNInz6obpgDQGcFmaJgB',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.3,
        use_speaker_boost: true,
        speed: 1.0
      },
      variables: {
        business_name: business.name,
        business_id: business.id,
        caller_id: caller_id,
        is_existing_client: !!existingClient,
        client_name: existingClient?.name || null
      }
    }
    
    console.log(`[🎯 PERSONALIZATION FIXED] ✅ SENDING RESPONSE FOR ${business.name}`)
    console.log(`[🎯 PERSONALIZATION FIXED] 💬 Welcome: "${welcomeMessage.substring(0, 50)}..."`)
    
    res.json(response)
    
  } catch (error) {
    console.error('[🎯 PERSONALIZATION FIXED] ❌ ERROR:', error)
    res.json({
      first_message: "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?",
      system_prompt: "You are a professional AI assistant.",
      voice_id: 'pNInz6obpgDQGcFmaJgB'
    })
  }
})

// 🔍 DEBUG ENDPOINT - List all businesses with phone numbers
router.get('/debug-businesses', async (req, res) => {
  try {
    const businesses = await prisma.business.findMany({
      select: {
        id: true,
        name: true,
        twilioPhoneNumber: true,
        agentConfig: {
          select: {
            elevenlabsAgentId: true,
            elevenlabsVoice: true
          }
        }
      }
    })
    
    console.log('[🔍 DEBUG] Businesses in database:', businesses)
    
    res.json({
      count: businesses.length,
      businesses: businesses
    })
    
  } catch (error) {
    console.error('[🔍 DEBUG] Error:', error)
    res.status(500).json({ error: 'Debug failed' })
  }
})

// 🔧 ADMIN ENDPOINT - Update ElevenLabs Agent ID (TEMPORARY)
router.post('/admin-update-agent-id', async (req, res) => {
  try {
    const { businessId, elevenlabsAgentId } = req.body
    
    if (!businessId || !elevenlabsAgentId) {
      return res.status(400).json({ error: 'businessId and elevenlabsAgentId are required' })
    }
    
    console.log('[🔧 ADMIN] Updating ElevenLabs Agent ID:', { businessId, elevenlabsAgentId })
    
    // Find the business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { agentConfig: true }
    })
    
    if (!business) {
      return res.status(404).json({ error: 'Business not found' })
    }
    
    if (!business.agentConfig) {
      return res.status(404).json({ error: 'AgentConfig not found for this business' })
    }
    
    // Update the ElevenLabs agent ID
    const updatedAgentConfig = await prisma.agentConfig.update({
      where: { id: business.agentConfig.id },
      data: { 
        // @ts-ignore - elevenlabsAgentId field exists but not in current schema
        elevenlabsAgentId 
      }
    })
    
    console.log('[🔧 ADMIN] Successfully updated ElevenLabs Agent ID')
    
    res.json({
      success: true,
      business: {
        id: business.id,
        name: business.name,
        twilioPhoneNumber: business.twilioPhoneNumber
      },
      agentConfig: {
        id: updatedAgentConfig.id,
        // @ts-ignore - elevenlabsAgentId field exists but not in current schema
        elevenlabsAgentId: updatedAgentConfig.elevenlabsAgentId
      }
    })
    
  } catch (error) {
    console.error('[🔧 ADMIN] Error updating ElevenLabs Agent ID:', error)
    res.status(500).json({ error: 'Failed to update agent ID' })
  }
})

// 🎯 ELEVENLABS POST-CALL WEBHOOK – Persist detailed call analytics
// This webhook is triggered by ElevenLabs after a call finishes
router.post('/elevenlabs-post-call', async (req, res) => {
  try {
    const {
      agent_id,
      call_sid,
      caller_id,
      called_number,
      analysis, // full ElevenLabs analysis payload (may be undefined)
      ...rest
    } = req.body

    if (!call_sid) {
      console.warn('[🎯 ELEVENLABS POST-CALL] Missing call_sid – ignoring')
      return res.status(400).json({ error: 'call_sid required' })
    }

    console.log('[🎯 ELEVENLABS POST-CALL] 📝 Payload received for call', call_sid)

    const normalizePhone = (num: string | null | undefined) =>
      (num || '').replace(/[^0-9]/g, '')

    // 1️⃣ Identify business by called_number (strict / digits-only) or by agent_id fallback
    let business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: called_number },
      include: { agentConfig: true }
    })

    if (!business && called_number) {
      const digits = normalizePhone(called_number)
      business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: { endsWith: digits } },
        include: { agentConfig: true }
      })
    }

    if (!business && agent_id) {
      business = await prisma.business.findFirst({
        where: { 
          agentConfig: { 
            is: { 
              // @ts-ignore - elevenlabsAgentId field exists in schema
              elevenlabsAgentId: agent_id 
            } 
          } 
        },
        include: { agentConfig: true }
      })
    }

    if (!business) {
      console.error('[🎯 ELEVENLABS POST-CALL] ❌ No business found – payload will be logged only')
      console.error('[🎯 ELEVENLABS POST-CALL] Payload:', req.body)
      return res.status(202).json({ warning: 'business_not_found' })
    }

    // 2️⃣ Upsert Conversation by sessionId (= call_sid)
    const conversation = await prisma.conversation.upsert({
      where: { sessionId: call_sid },
      update: {
        endedAt: new Date(),
        metadata: analysis ? analysis : req.body,
        phoneNumber: caller_id ?? undefined,
        messages: analysis?.conversation ? JSON.stringify(analysis.conversation) : undefined
      },
      create: {
        businessId: business.id,
        sessionId: call_sid,
        messages: analysis?.conversation ? JSON.stringify(analysis.conversation) : '[]',
        startedAt: new Date(),
        endedAt: new Date(),
        metadata: analysis ? analysis : req.body,
        phoneNumber: caller_id ?? undefined
      }
    })

    // 3️⃣ Upsert CallLog for visibility in dashboard
    await prisma.callLog.upsert({
      where: { callSid: call_sid },
      update: {
        content: analysis?.conversation_summary ?? undefined,
        metadata: req.body,
        status: 'COMPLETED'
      },
      create: {
        callSid: call_sid,
        businessId: business.id,
        conversationId: conversation.id,
        from: caller_id ?? 'unknown',
        to: called_number ?? 'unknown',
        source: 'elevenlabs',
        metadata: req.body,
        type: 'VOICE',
        direction: 'INBOUND',
        status: 'COMPLETED',
        content: analysis?.conversation_summary ?? undefined
      }
    })

    console.log('[🎯 ELEVENLABS POST-CALL] ✅ Call stored for business', business.name)

    return res.json({ ok: true })
  } catch (error) {
    console.error('[🎯 ELEVENLABS POST-CALL] Error handling webhook:', error)
    res.status(500).json({ error: 'post_call_processing_failed' })
  }
})

// 💓 HEALTH ENDPOINT FOR OPS CHECKS - Reports latest post-call ingestion stats
router.post('/health/voice', async (req, res) => {
  try {
    console.log('[VOICE HEALTH] Health check requested')
    
    // Get recent call statistics
    const now = new Date()
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000)
    
    const [
      totalCalls,
      callsLast24h,
      callsLastHour,
      recentCallsWithMetadata,
      successfulCalls
    ] = await Promise.all([
      // Total calls
      prisma.callLog.count(),
      
      // Calls in last 24 hours
      prisma.callLog.count({
        where: { createdAt: { gte: last24Hours } }
      }),
      
      // Calls in last hour
      prisma.callLog.count({
        where: { createdAt: { gte: lastHour } }
      }),
      
      // Recent calls with metadata for analysis
      prisma.callLog.findMany({
        where: { 
          createdAt: { gte: last24Hours }
        },
        select: {
          id: true,
          createdAt: true,
          metadata: true,
          status: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      
      // Successful calls (completed status)
      prisma.callLog.count({
        where: { 
          createdAt: { gte: last24Hours },
          status: 'COMPLETED'
        }
      })
    ])

    // Calculate analytics from metadata
    let totalDuration = 0
    let durationCount = 0
    let totalSentiment = 0
    let sentimentCount = 0
    let actionSuccessCount = 0
    let actionTotalCount = 0
    let satisfactionTotal = 0
    let satisfactionCount = 0
    
    recentCallsWithMetadata.forEach(call => {
      const metadata = call.metadata as any
      
      if (metadata?.duration) {
        totalDuration += metadata.duration
        durationCount++
      }
      
      if (metadata?.sentiment_score !== undefined) {
        totalSentiment += metadata.sentiment_score
        sentimentCount++
      }
      
      if (metadata?.action_success !== undefined) {
        if (metadata.action_success) actionSuccessCount++
        actionTotalCount++
      }
      
      if (metadata?.satisfaction_score) {
        satisfactionTotal += metadata.satisfaction_score
        satisfactionCount++
      }
    })

    const healthStats = {
      timestamp: now.toISOString(),
      status: 'healthy',
      
      // Call volume metrics
      callVolume: {
        total: totalCalls,
        last24Hours: callsLast24h,
        lastHour: callsLastHour,
        successRate: callsLast24h > 0 ? Math.round((successfulCalls / callsLast24h) * 100) : 0
      },
      
      // Post-call ingestion stats
      postCallIngestion: {
        totalCallsWithMetadata: recentCallsWithMetadata.length,
        ingestionRate: callsLast24h > 0 ? Math.round((recentCallsWithMetadata.length / callsLast24h) * 100) : 0,
        lastIngestionTime: recentCallsWithMetadata[0]?.createdAt || null,
        dataCompleteness: {
          withDuration: durationCount,
          withSentiment: sentimentCount,
          withActionData: actionTotalCount,
          withSatisfactionScore: satisfactionCount
        }
      },
      
      // Analytics KPIs
      analytics: {
        avgCallDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
        avgSentimentScore: sentimentCount > 0 ? Math.round((totalSentiment / sentimentCount) * 100) / 100 : 0,
        actionSuccessRate: actionTotalCount > 0 ? Math.round((actionSuccessCount / actionTotalCount) * 100) : 0,
        avgSatisfactionScore: satisfactionCount > 0 ? Math.round((satisfactionTotal / satisfactionCount) * 100) / 100 : 0
      },
      
      // System health indicators
      systemHealth: {
        databaseConnected: true,
        webhookEndpointActive: true,
        lastCallProcessed: recentCallsWithMetadata[0]?.createdAt || null,
        memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
        uptime: Math.round(process.uptime()) // seconds
      }
    }

    console.log('[VOICE HEALTH] Health stats generated:', {
      totalCalls: healthStats.callVolume.total,
      last24h: healthStats.callVolume.last24Hours,
      ingestionRate: healthStats.postCallIngestion.ingestionRate,
      avgDuration: healthStats.analytics.avgCallDuration
    })

    res.json(healthStats)

  } catch (error) {
    console.error('[VOICE HEALTH] Health check failed:', error)
    res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: 'Health check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// 🔧 DEBUG ENDPOINT - Test webhook functionality
router.post('/debug-webhook', async (req, res) => {
  console.log('='.repeat(80))
  console.log('[🔧 DEBUG WEBHOOK] Received request')
  console.log('[🔧 DEBUG WEBHOOK] Headers:', JSON.stringify(req.headers, null, 2))
  console.log('[🔧 DEBUG WEBHOOK] Body:', JSON.stringify(req.body, null, 2))
  console.log('[🔧 DEBUG WEBHOOK] URL:', req.url)
  console.log('[🔧 DEBUG WEBHOOK] Method:', req.method)
  console.log('='.repeat(80))
  
  res.json({ 
    status: 'success', 
    timestamp: new Date().toISOString(),
    received: req.body,
    message: 'Debug webhook received successfully'
  })
})

// 🔧 WEBHOOK FUNCTIONALITY TEST
router.get('/webhook-test', async (req, res) => {
  const testData = {
    webhook_url: `${req.protocol}://${req.get('host')}/api/voice/elevenlabs-personalization`,
    test_payload: {
      caller_id: '+15551234567',
      called_number: '+15557654321',
      agent_id: 'test-agent-123',
      call_sid: 'test-call-456'
    },
    instructions: 'Use this webhook URL in your ElevenLabs agent configuration'
  }
  
  console.log('[🔧 WEBHOOK TEST] Generated test configuration:')
  console.log(JSON.stringify(testData, null, 2))
  
  res.json(testData)
})

// 🔧 WEBHOOK DEBUG ENDPOINT - Test if ElevenLabs is calling our webhook
router.all('/webhook-debug', (req, res) => {
  console.log('='.repeat(80))
  console.log('[🔧 WEBHOOK DEBUG] INCOMING REQUEST')
  console.log(`[🔧 WEBHOOK DEBUG] Method: ${req.method}`)
  console.log(`[🔧 WEBHOOK DEBUG] URL: ${req.url}`)
  console.log(`[🔧 WEBHOOK DEBUG] Headers:`, JSON.stringify(req.headers, null, 2))
  console.log(`[🔧 WEBHOOK DEBUG] Body:`, JSON.stringify(req.body, null, 2))
  console.log(`[🔧 WEBHOOK DEBUG] Query:`, JSON.stringify(req.query, null, 2))
  console.log(`[🔧 WEBHOOK DEBUG] Timestamp: ${new Date().toISOString()}`)
  console.log('='.repeat(80))
  
  res.json({
    status: 'success',
    message: 'Webhook debug endpoint received request',
    timestamp: new Date().toISOString(),
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query
  })
})

// 🔧 SIMPLE PERSONALIZATION TEST - Minimal webhook for testing
router.post('/elevenlabs-personalization-simple', (req, res) => {
  console.log('🎯🎯🎯 SIMPLE PERSONALIZATION WEBHOOK CALLED 🎯🎯🎯')
  console.log('Body:', JSON.stringify(req.body, null, 2))
  
  // Return minimal response
  res.json({
    first_message: "Hello! This is a test from StudioConnect AI. If you hear this, the webhook is working!",
    system_prompt: "You are a test AI assistant. Say 'The webhook is working correctly' in your next response.",
    voice_id: 'pNInz6obpgDQGcFmaJgB'
  })
})

export default router 