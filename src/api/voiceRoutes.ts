import { Router, Response, Request } from 'express'
import twilio from 'twilio'
import { realtimeAgentService } from '../services/realtimeAgentService'
import { processMessage } from '../core/aiHandler'
import { asyncHandler } from '../utils/asyncHandler'
import { prisma } from '../services/db'

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

export default router 