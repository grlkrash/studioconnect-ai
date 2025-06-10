import { Router, Request, Response, NextFunction } from 'express'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import { WebSocket } from 'ws'
import { RealtimeAgentService } from '../services/realtimeAgentService'

const router = Router()
const prisma = new PrismaClient()

// Initialize Twilio REST client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// Custom Twilio request validation middleware
const customValidateTwilioRequest = (req: Request, res: Response, next: NextFunction) => {
  // Only validate in production
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioSignature = req.header('X-Twilio-Signature');
  const url = new URL(req.originalUrl, `https://${req.header('host')}`).toString();
  const params = req.body;

  try {
    const isValid = twilio.validateRequest(authToken!, twilioSignature!, url, params);
    if (isValid) {
      console.log('[Twilio Validation] Signature is valid.');
      return next();
    }
  } catch (e) {
     console.error('[Twilio Validation] Error during validation:', e);
     return res.status(403).send('Forbidden');
  }
  
  console.warn('[Twilio Validation] Invalid signature.');
  return res.status(403).send('Forbidden');
};

// POST /incoming - Handle incoming Twilio voice calls (Real-time Media Stream)
router.post('/incoming', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[VOICE STREAM] Incoming call received for real-time streaming:', req.body.CallSid)
    
    // Debug: Log all relevant environment variables
    console.log('[VOICE STREAM] Environment variables check:')
    console.log('[VOICE STREAM] HOSTNAME:', process.env.HOSTNAME)
    console.log('[VOICE STREAM] HOST:', process.env.HOST)
    console.log('[VOICE STREAM] APP_PRIMARY_URL:', process.env.APP_PRIMARY_URL)
    console.log('[VOICE STREAM] NODE_ENV:', process.env.NODE_ENV)
    
    // Determine WebSocket URL - prioritize APP_PRIMARY_URL if available
    let wsUrl: string;
    if (process.env.APP_PRIMARY_URL) {
      wsUrl = process.env.APP_PRIMARY_URL.replace('http://', 'wss://').replace('https://', 'wss://');
    } else if (process.env.HOSTNAME) {
      wsUrl = `wss://${process.env.HOSTNAME}`;
    } else {
      throw new Error('Neither APP_PRIMARY_URL nor HOSTNAME environment variables are set for WebSocket streaming');
    }
    
    // Extract CallSid from request body
    const callSid = req.body.CallSid
    
    // Create VoiceResponse for bidirectional media streaming
    const response = new twilio.twiml.VoiceResponse()
    const connect = response.connect()
    
    // Create stream connection to WebSocket server
    const stream = connect.stream({
      url: wsUrl
    })
    
    // Add the CallSid as a parameter
    stream.parameter({
      name: 'callSid',
      value: callSid
    })
    
    // Add pause to keep the call active
    response.pause({ length: 14400 }) // Pause for 4 hours (Twilio's max call duration)
    
    console.log('[VOICE STREAM] Connecting to WebSocket URL:', wsUrl)
    console.log('[VOICE STREAM] CallSid will be passed as parameter:', callSid)
    
    // Send the TwiML response
    res.setHeader('Content-Type', 'application/xml')
    res.send(response.toString())
    
  } catch (error) {
    console.error('[VOICE STREAM] Error handling incoming call:', error)
    res.status(500).send('Internal Server Error')
  }
})

export default router 