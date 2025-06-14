import { Router, Response, Request } from 'express'
import twilio from 'twilio'
import { realtimeAgentService } from '../services/realtimeAgentService'
import { processMessage } from '../core/aiHandler'
import { asyncHandler } from '../utils/asyncHandler'

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
    console.log(`[VOICE STREAM] Incoming call received: ${callSid}`)

    // Build WebSocket URL — prefer primary URL if set
    const host = process.env.APP_PRIMARY_URL || `https://${req.hostname}`
    const wsUrl = host.replace(/^https?:\/\//, 'wss://')
    console.log(`[VOICE STREAM] Directing Twilio to connect to WebSocket: ${wsUrl}`)

    const response = new VoiceResponse()
    const connect = response.connect()
    const stream = connect.stream({ url: wsUrl })

    // Pass CallSid to the websocket server
    stream.parameter({ name: 'callSid', value: callSid })

    // Forward optional businessId from the original call
    if (req.body.businessId) {
      stream.parameter({ name: 'businessId', value: req.body.businessId })
    }

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
      const aiResp = await processMessage(
        speechResult,
        [],
        businessId || '',
        null,
        req.body.CallSid,
        'VOICE'
      )
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

export default router 