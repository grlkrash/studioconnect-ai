import { Router, Response, Request } from 'express'
import twilio from 'twilio'
import { realtimeAgentService } from '../services/realtimeAgentService'
import { processMessage } from '../core/aiHandler'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()
const { VoiceResponse } = twilio.twiml

// Custom Twilio request validation middleware
const customValidateTwilioRequest = (req: Request, res: Response, next: () => void) => {
  // Only validate in production
  if (process.env.NODE_ENV !== 'production') return next()

  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const twilioSignature = req.header('X-Twilio-Signature')!
  const url = new URL(req.originalUrl, `https://${req.header('host')}`).toString()
  const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body)
  if (isValid) {
    console.log('[Twilio Validation] Signature is valid.')
    return next()
  }
  
  console.warn('[Twilio Validation] Invalid signature.')
  res.status(403).send('Forbidden')
  return
}

// POST /incoming - Handle incoming Twilio voice calls (Real-time Media Stream)
router.post('/incoming', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const callSid = req.body.CallSid
    console.log(`[VOICE STREAM] Incoming call received: ${callSid}`)

    // Determine WebSocket URL - prioritize APP_PRIMARY_URL if available
    const host = process.env.APP_PRIMARY_URL || `https://${req.hostname}`
    const wsUrl = host.replace(/^https?:\/\//, 'wss://')
    
    console.log(`[VOICE STREAM] Directing Twilio to connect to WebSocket: ${wsUrl}`)

    const response = new VoiceResponse()
    const connect = response.connect()
    const stream = connect.stream({ url: wsUrl })
    
    // Add the CallSid as a parameter
    stream.parameter({
      name: 'callSid',
      value: callSid
    })

    // Add business ID if available
    if (req.body.businessId) {
      stream.parameter({
        name: 'businessId',
        value: req.body.businessId
      })
    }
    
    // Add pause to keep the call active
    response.pause({ length: 14400 }) // Pause for 4 hours (Twilio's max call duration)
    
    res.type('text/xml')
    res.send(response.toString()); return;
    
  } catch (error) {
    console.error('[VOICE STREAM] Critical error in /incoming route:', error)
    const response = new VoiceResponse()
    response.say('We are sorry, but there was an error connecting your call. Please try again later.')
    response.hangup()
    res.type('text/xml')
    res.status(500).send(response.toString()); return;
  }
}))

// GET /status - Check voice system status
router.get('/status', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    // Use the imported instance directly
    const status = realtimeAgentService.getConnectionStatus()
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      voiceSystem: {
        status,
        activeCalls: realtimeAgentService.getActiveConnections()
      }
    }); return;
  } catch (error) {
    console.error('[VOICE STREAM] Error checking status:', error)
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }); return;
  }
}))

// POST /fallback-handler - Standard Twilio TwiML fallback handler
router.post('/fallback-handler', customValidateTwilioRequest, asyncHandler(async (req: Request, res: Response) => {
  try {
    const twiml = new VoiceResponse()
    const speechResult = req.body.SpeechResult
    const businessId = req.body.businessId

    if (speechResult) {
      // Process the speech input with AI
      const response = await processMessage(
        speechResult,
        [], // Empty conversation history for now
        businessId,
        null,
        req.body.CallSid,
        'VOICE'
      )

      // Speak the AI response
      twiml.say({ voice: 'alice' }, response.reply)
    } else {
      // First time being redirected here
      twiml.say({ voice: 'alice' }, 'Now connecting to our standard service.')
    }

    // Add Gather verb to collect user input
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/fallback-handler',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
      enhanced: true
    })

    // Add a fallback message if no speech is detected
    gather.say({ voice: 'alice' }, 'I didn\'t catch that. Could you please repeat?')

    res.type('text/xml')
    res.send(twiml.toString()); return;
  } catch (error) {
    console.error('[FALLBACK HANDLER] Error:', error)
    const twiml = new VoiceResponse()
    twiml.say({ voice: 'alice' }, 'We\'re experiencing technical difficulties. Please try your call again later.')
    res.type('text/xml')
    res.status(500).send(twiml.toString()); return;
  }
}))

export default router 