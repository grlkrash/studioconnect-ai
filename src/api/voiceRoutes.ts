import { Router, Response, Request } from 'express'
import twilio from 'twilio'
import realtimeAgentService from '../services/realtimeAgentService'
import { processMessage } from '../core/aiHandler'
import { asyncHandler } from '../utils/asyncHandler'
import { prisma } from '../services/db'
import { enterpriseVoiceAgent } from '../services/enterpriseVoiceAgent'
import { elevenLabsAgent } from '../services/elevenlabsConversationalAgent'

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
      update: { elevenlabsAgentId: agentId },
      create: {
        businessId,
        elevenlabsAgentId: agentId,
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

export default router 