import { Router, Request, Response, NextFunction } from 'express'
import twilio from 'twilio'

const router = Router()
const { VoiceResponse } = twilio.twiml

// Custom Twilio request validation middleware
const customValidateTwilioRequest = (req: Request, res: Response, next: NextFunction) => {
  // Only validate in production
  if (process.env.NODE_ENV !== 'production') return next()

  const authToken = process.env.TWILIO_AUTH_TOKEN
  const twilioSignature = req.header('X-Twilio-Signature')
  const url = new URL(req.originalUrl, `https://${req.header('host')}`).toString()
  const params = req.body

  try {
    const isValid = twilio.validateRequest(authToken!, twilioSignature!, url, params)
    if (isValid) {
      console.log('[Twilio Validation] Signature is valid.')
      return next()
    }
  } catch (e) {
    console.error('[Twilio Validation] Error during validation:', e)
    return res.status(403).send('Forbidden')
  }
  
  console.warn('[Twilio Validation] Invalid signature.')
  return res.status(403).send('Forbidden')
}

// POST /incoming - Handle incoming Twilio voice calls (Real-time Media Stream)
router.post('/incoming', customValidateTwilioRequest, async (req, res) => {
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
    
    // Add pause to keep the call active
    response.pause({ length: 14400 }) // Pause for 4 hours (Twilio's max call duration)
    
    res.type('text/xml')
    res.send(response.toString())
    
  } catch (error) {
    console.error('[VOICE STREAM] Critical error in /incoming route:', error)
    const response = new VoiceResponse()
    response.say('We are sorry, but there was an error connecting your call. Please try again later.')
    response.hangup()
    res.type('text/xml')
    res.status(500).send(response.toString())
  }
})

export default router 