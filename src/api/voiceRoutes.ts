import { Router } from 'express'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createClient, RedisClientType } from 'redis'
import { getTranscription } from '../services/openai'
import { processMessage } from '../core/aiHandler'
import VoiceSessionService, { 
  ExtractedEntities, 
  ConversationMessage, 
  DetailedFlowState,
  SessionMetadata 
} from '../services/voiceSessionService'

const router = Router()
const prisma = new PrismaClient()
const { VoiceResponse } = twilio.twiml

// Initialize voice session service
const voiceSessionService = VoiceSessionService.getInstance()

// Redis client singleton and fallback storage
let redisClient: RedisClientType | undefined;
let redisReconnectAttempts = 0;
const maxRedisReconnectAttempts = 5;
const voiceSessions = new Map<string, { history: any[], currentFlow: string | null, lastAccessed: number }>(); // Enhanced with lastAccessed

// Memory monitoring and cleanup configuration
const MEMORY_CHECK_INTERVAL = 60000; // 1 minute
const SESSION_CLEANUP_INTERVAL = 300000; // 5 minutes
const MAX_SESSION_AGE_MS = 1800000; // 30 minutes
const MAX_MEMORY_USAGE_MB = 1536; // Alert threshold - increased for 2GB RAM instance (75% of 2GB)
const MAX_CONVERSATION_HISTORY_LENGTH = 50; // Prevent unbounded growth

// Memory monitoring
function logMemoryUsage(context: string = ''): void {
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  console.log(`[Memory ${context}] RSS: ${formatBytes(usage.rss)}MB, Heap Used: ${formatBytes(usage.heapUsed)}MB, Heap Total: ${formatBytes(usage.heapTotal)}MB, External: ${formatBytes(usage.external)}MB`);
  
  // Alert on high memory usage
  if (formatBytes(usage.heapUsed) > MAX_MEMORY_USAGE_MB) {
    console.warn(`[Memory Alert] High memory usage detected: ${formatBytes(usage.heapUsed)}MB > ${MAX_MEMORY_USAGE_MB}MB threshold`);
  }
}

// Cleanup old in-memory sessions
function cleanupOldSessions(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [callSid, session] of voiceSessions.entries()) {
    if (now - session.lastAccessed > MAX_SESSION_AGE_MS) {
      voiceSessions.delete(callSid);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[Session Cleanup] Removed ${cleanedCount} expired sessions. Active sessions: ${voiceSessions.size}`);
    logMemoryUsage('After Session Cleanup');
  }
}

// Enhanced temp file cleanup with error handling
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`[File Cleanup] Successfully deleted temp file: ${filePath}`);
    }
  } catch (error) {
    console.error(`[File Cleanup] Failed to delete temp file ${filePath}:`, error);
  }
}

// Start memory monitoring
setInterval(() => {
  logMemoryUsage('Periodic Check');
}, MEMORY_CHECK_INTERVAL);

// Start session cleanup
setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);

// Helper function to safely check if Redis client is ready for operations
function isRedisClientReady(): boolean {
  return !!(redisClient && redisClient.isOpen && redisClient.isReady);
}

async function initializeRedis() {
  if (!process.env.REDIS_URL) {
    console.warn('[Redis Init] REDIS_URL not found in ENV. Voice sessions will be in-memory.');
    return;
  }

  // Prevent multiple initialization attempts and limit reconnect attempts
  if (redisClient && redisClient.isOpen) {
    console.log('[Redis Init] Redis client already connected, skipping initialization.');
    return;
  }
  
  if (redisReconnectAttempts >= maxRedisReconnectAttempts) {
    console.warn(`[Redis Init] Max reconnection attempts (${maxRedisReconnectAttempts}) reached. Stopping reconnection attempts.`);
    return;
  }

  console.log(`[Redis Init] Attempting to connect to Redis (attempt ${redisReconnectAttempts + 1}/${maxRedisReconnectAttempts})`);
  
  try {
    // Properly close existing client if it exists but isn't connected
    if (redisClient && !redisClient.isOpen) {
      try {
        await redisClient.quit();
      } catch (err) {
        console.warn('[Redis Init] Error closing previous client:', err);
      }
      redisClient = undefined;
    }

    const client = createClient({ 
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('[Redis] Max reconnection retries reached, giving up');
            return false; // Stop reconnecting
          }
          return Math.min(retries * 50, 500); // Exponential backoff, max 500ms
        }
      }
    });

    // Set up event handlers before connecting - avoid duplicate handlers
    client.removeAllListeners(); // Clear any existing listeners
    
    client.on('error', (err) => {
      console.error('[Redis Client Error]:', err);
      redisClient = undefined;
      redisReconnectAttempts++;
    });

    client.on('connect', () => {
      console.log('[Redis Client Connect] Connecting to Redis server...');
      redisReconnectAttempts = 0; // Reset on successful connection
    });

    client.on('reconnecting', () => {
      console.log('[Redis Client Reconnecting] Reconnecting to Redis server...');
      redisClient = undefined; // Mark as not ready during reconnection
    });

    client.on('ready', () => {
      console.log('[Redis Client Ready] Redis client is ready.');
      redisClient = client as RedisClientType;
      redisReconnectAttempts = 0; // Reset counter on success
    });

    client.on('end', () => {
      console.log('[Redis Client End] Connection to Redis has ended.');
      redisClient = undefined;
    });

    client.on('disconnect', () => {
      console.log('[Redis Client Disconnect] Disconnected from Redis server.');
      redisClient = undefined;
    });

    // Attempt to connect
    await client.connect();
    console.log('[Redis Init] Connection attempt completed.');

  } catch (err) {
    console.error('[Redis Init] Failed to connect during explicit initialization:', err);
    redisClient = undefined;
    redisReconnectAttempts++;
    console.warn('[Voice Session] Defaulting to in-memory session due to Redis connection failure.');
  }
}

// Initialize Redis on module load
initializeRedis().catch(err => {
  console.error('[Redis Init] Failed to initialize Redis on module load:', err);
});

// Improved periodic health check with backoff
let healthCheckInterval: NodeJS.Timeout | undefined;

function startRedisHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(() => {
    if (!isRedisClientReady() && process.env.REDIS_URL && redisReconnectAttempts < maxRedisReconnectAttempts) {
      console.log(`[Redis Health Check] Attempting to reconnect to Redis (attempt ${redisReconnectAttempts + 1}/${maxRedisReconnectAttempts})...`);
      initializeRedis().catch(err => {
        console.error('[Redis Health Check] Reconnection failed:', err);
      });
    }
  }, 30000); // Check every 30 seconds
}

startRedisHealthCheck();

// Graceful shutdown handler for all resources
async function gracefulShutdown(signal: string) {
  console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);
  
  // Clear intervals
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  // Close Redis connection
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.quit();
      console.log('[Shutdown] Redis connection closed gracefully.');
    } catch (err) {
      console.error('[Shutdown] Error closing Redis connection:', err);
    }
  }
  
  // Clear in-memory sessions
  voiceSessions.clear();
  console.log('[Shutdown] In-memory sessions cleared.');
  
  // Final memory log
  logMemoryUsage('Final Shutdown');
  
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Helper function for XML escaping text content only (preserves apostrophes as literals)
function escapeTextForSSML(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')  // Must be first to avoid double-escaping
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Explicitly do NOT escape apostrophes to prevent "&apos;" being spoken as "apos"
}

// Helper function to create SSML-enhanced messages with improved naturalness
function createSSMLMessage(message: string, options: { 
  isGreeting?: boolean, 
  isQuestion?: boolean, 
  isUrgent?: boolean,
  addPause?: boolean, 
  addEmphasis?: boolean, 
  pauseDuration?: string,
  isConversational?: boolean
} = {}): string {
  // Start with the plain text message - DO NOT escape it yet
  let ssmlMessage = message
  
  // Add greeting-specific enhancements
  if (options.isGreeting) {
    // Add a warm, welcoming tone to greetings
    ssmlMessage = ssmlMessage.replace(/(Hey!|Hello!?|Hi!?)/gi, 
      '<prosody rate="medium" pitch="+5%">$1</prosody>')
    // Add a pause after greeting
    ssmlMessage = ssmlMessage.replace(/(Hey!|Hello!?|Hi!?)(\s*)/, 
      '$1<break time="400ms"/>$2')
  }
  
  // Add emphasis to urgent or important words
  if (options.addEmphasis || options.isUrgent) {
    ssmlMessage = ssmlMessage.replace(/\b(urgent|important|emergency|attention|help|assist|service|problem|issue)\b/gi, 
      '<emphasis level="moderate">$1</emphasis>')
    
    if (options.isUrgent) {
      ssmlMessage = ssmlMessage.replace(/\b(urgent|emergency)\b/gi, 
        '<emphasis level="strong">$1</emphasis>')
    }
  }
  
  // Add natural pauses for questions
  if (options.isQuestion || ssmlMessage.includes('?')) {
    // Add pause before the question itself
    ssmlMessage = ssmlMessage.replace(/([.!])\s*([^.!?]*\?)/g, 
      '$1<break time="400ms"/>$2')
    // Add a slight pause at the end of questions
    ssmlMessage = ssmlMessage.replace(/\?/g, '?<break time="300ms"/>')
  }
  
  // Add conversational pauses and flow
  if (options.isConversational) {
    // Add natural pauses after transitional phrases
    ssmlMessage = ssmlMessage.replace(/\b(Now|So|Alright|Okay|Perfect|Great|Got it|Thanks)\b,?/gi, 
      '<prosody rate="medium">$1</prosody><break time="300ms"/>')
    
    // Add slight pauses after commas for better flow
    ssmlMessage = ssmlMessage.replace(/,\s+/g, ',<break time="200ms"/>')
    
    // Add emphasis to "please" and "thank you" for politeness
    ssmlMessage = ssmlMessage.replace(/\b(please|thank you|thanks)\b/gi, 
      '<emphasis level="moderate">$1</emphasis>')
  }
  
  // Add strategic pauses based on options
  if (options.addPause) {
    const pauseDuration = options.pauseDuration || '300ms'
    if (!ssmlMessage.includes('<break')) {
      ssmlMessage = `<break time="${pauseDuration}"/>${ssmlMessage}`
    }
  }
  
  // Now escape only the text content between tags, preserving SSML tags
  ssmlMessage = ssmlMessage.replace(/>([^<]+)</g, (match, textContent) => {
    return `>${escapeTextForSSML(textContent)}<`
  })
  
  // Also escape any remaining text that's not within tags
  ssmlMessage = ssmlMessage.replace(/^([^<]+)/, (match, textContent) => {
    return escapeTextForSSML(textContent)
  })
  ssmlMessage = ssmlMessage.replace(/>([^<]+)$/, (match, textContent) => {
    return `>${escapeTextForSSML(textContent)}`
  })
  
  return ssmlMessage
}

// Enhanced helper functions for voice session management with Redis support and memory optimization
async function getVoiceSession(callSid: string): Promise<{ history: any[], currentFlow: string | null, lastAccessed?: number }> {
  // Log memory before session retrieval
  logMemoryUsage(`Getting Session ${callSid}`);
  
  // Robust Redis client readiness check
  if (isRedisClientReady()) {
    try {
      const sessionData = await redisClient!.get(`voiceSession:${callSid}`);
      if (sessionData) {
        console.log(`[Voice Session] Retrieved session from Redis for CallSid: ${callSid}`);
        const parsedData = JSON.parse(sessionData);
        
        // Ensure conversation history doesn't grow unbounded
        if (parsedData.history && parsedData.history.length > MAX_CONVERSATION_HISTORY_LENGTH) {
          console.log(`[Voice Session] Trimming conversation history from ${parsedData.history.length} to ${MAX_CONVERSATION_HISTORY_LENGTH} messages`);
          parsedData.history = parsedData.history.slice(-MAX_CONVERSATION_HISTORY_LENGTH);
        }
        
        return parsedData;
      }
      console.log(`[Voice Session] No existing Redis session found for CallSid: ${callSid}, creating new session`);
      // If not found in Redis, it will fall through to in-memory below
    } catch (err) {
      console.error(`[Redis] Error getting session for ${callSid} (falling back to in-memory):`, err);
      // Don't immediately mark as undefined - let health check handle reconnection
    }
  } else {
    console.log(`[Voice Session] Redis client not ready, using in-memory session for ${callSid}`);
  }

  // Fallback to in-memory storage with timestamp tracking
  if (!voiceSessions.has(callSid)) {
    console.log(`[Voice Session] Creating new in-memory session for CallSid: ${callSid}`);
    voiceSessions.set(callSid, { 
      history: [], 
      currentFlow: null, 
      lastAccessed: Date.now() 
    });
  } else {
    // Update last accessed time
    const session = voiceSessions.get(callSid)!;
    session.lastAccessed = Date.now();
  }
  
  const session = voiceSessions.get(callSid)!;
  
  // Ensure in-memory history doesn't grow unbounded
  if (session.history.length > MAX_CONVERSATION_HISTORY_LENGTH) {
    console.log(`[Voice Session] Trimming in-memory conversation history from ${session.history.length} to ${MAX_CONVERSATION_HISTORY_LENGTH} messages`);
    session.history = session.history.slice(-MAX_CONVERSATION_HISTORY_LENGTH);
  }
  
  return { 
    history: session.history, 
    currentFlow: session.currentFlow,
    lastAccessed: session.lastAccessed 
  };
}

async function updateVoiceSession(callSid: string, history: any[], currentFlow: string | null): Promise<void> {
  // Trim history to prevent unbounded growth
  const trimmedHistory = history.length > MAX_CONVERSATION_HISTORY_LENGTH 
    ? history.slice(-MAX_CONVERSATION_HISTORY_LENGTH) 
    : history;
    
  const sessionData = JSON.stringify({ history: trimmedHistory, currentFlow });
  
  // Robust Redis client readiness check
  if (isRedisClientReady()) {
    try {
      await redisClient!.set(`voiceSession:${callSid}`, sessionData, { EX: 3600 * 2 }); // Expire in 2 hours
      console.log(`[Voice Session] Updated session in Redis for CallSid: ${callSid}`);
      
      // Also update in-memory as backup/cache with timestamp
      voiceSessions.set(callSid, { 
        history: trimmedHistory, 
        currentFlow, 
        lastAccessed: Date.now() 
      });
      return; // Success with Redis
    } catch (err) {
      console.error(`[Redis] Error setting session for ${callSid} (falling back to in-memory):`, err);
      // Don't immediately mark as undefined - let health check handle reconnection
    }
  } else {
    console.log(`[Voice Session] Redis client not ready, using in-memory session for ${callSid}`);
  }
  
  // Fallback to in-memory storage with timestamp
  voiceSessions.set(callSid, { 
    history: trimmedHistory, 
    currentFlow, 
    lastAccessed: Date.now() 
  });
  console.log(`[Voice Session] Updated in-memory session for CallSid: ${callSid}`);
}

async function clearVoiceSession(callSid: string): Promise<void> {
  // Robust Redis client readiness check
  if (isRedisClientReady()) {
    try {
      await redisClient!.del(`voiceSession:${callSid}`);
      console.log(`[Voice Session] Cleared session from Redis for CallSid: ${callSid}`);
    } catch (err) {
      console.error(`[Redis] Error deleting session for ${callSid}:`, err);
      // Mark client as potentially unusable on Redis operation errors
      redisClient = undefined;
    }
  } else {
    console.log(`[Voice Session] Redis client not ready, clearing in-memory session for ${callSid}`);
  }
  
  // Always clear from in-memory map (works as fallback and cleanup)
  voiceSessions.delete(callSid);
  console.log(`[Voice Session] Cleared in-memory session for CallSid: ${callSid}`);
}

// Enhanced session management functions
async function addEnhancedMessage(
  callSid: string,
  role: 'user' | 'assistant',
  content: string,
  options: {
    intent?: string
    confidence?: number
    entities?: ExtractedEntities
  } = {}
): Promise<void> {
  try {
    await voiceSessionService.addConversationMessage(callSid, role, content, options)
  } catch (error) {
    console.error('[Voice Session] Error adding enhanced message:', error)
  }
}

async function updateSessionFlow(
  callSid: string,
  flowUpdate: Partial<DetailedFlowState>
): Promise<void> {
  try {
    await voiceSessionService.updateDetailedFlow(callSid, flowUpdate)
  } catch (error) {
    console.error('[Voice Session] Error updating flow:', error)
  }
}

async function updateSessionMetadata(
  callSid: string,
  metadata: Partial<SessionMetadata>
): Promise<void> {
  try {
    await voiceSessionService.updateMetadata(callSid, metadata)
  } catch (error) {
    console.error('[Voice Session] Error updating metadata:', error)
  }
}

async function extractEntitiesFromText(text: string): Promise<ExtractedEntities> {
  const entities: ExtractedEntities = {}
  
  // Simple regex-based entity extraction (can be enhanced with NLP libraries)
  
  // Extract email addresses
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const emails = text.match(emailRegex)
  if (emails) entities.emails = emails
  
  // Extract phone numbers (US format)
  const phoneRegex = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g
  const phones = text.match(phoneRegex)
  if (phones) entities.phoneNumbers = phones
  
  // Extract potential names (capitalized words, basic heuristic)
  const nameRegex = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g
  const names = text.match(nameRegex)
  if (names) entities.names = names
  
  // Extract potential dates
  const dateRegex = /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi
  const dates = text.match(dateRegex)
  if (dates) entities.dates = dates
  
  // Extract amounts/currency
  const amountRegex = /\$[\d,]+(?:\.\d{2})?|\b\d+\s*(?:dollars?|bucks?)\b/gi
  const amounts = text.match(amountRegex)
  if (amounts) entities.amounts = amounts
  
  return entities
}

// Enhanced AI response processing
interface EnhancedAIResponse {
  reply: string
  intent?: string
  confidence?: number
  entities?: ExtractedEntities
  flowState?: {
    primaryFlow?: string
    subFlow?: string
    flowData?: Record<string, any>
    completedSteps?: string[]
    nextExpectedInputs?: string[]
  }
  currentFlow?: string | null
  nextVoiceAction?: 'CONTINUE' | 'HANGUP' | 'TRANSFER' | 'VOICEMAIL'
}

async function processEnhancedMessage(
  transcribedText: string,
  conversationHistory: any[],
  businessId: string,
  currentActiveFlow: string | null,
  callSid: string
): Promise<EnhancedAIResponse> {
  try {
    // Extract entities from user input
    const extractedEntities = await extractEntitiesFromText(transcribedText)
    
    // Get existing session for context
    const session = await voiceSessionService.getVoiceSession(callSid)
    
    // Process message with AI handler (existing logic)
    const aiResponse = await processMessage(
      transcribedText,
      conversationHistory,
      businessId,
      currentActiveFlow
    )
    
    // Basic intent classification (can be enhanced with ML models)
    let intent = 'general_inquiry'
    let confidence = 0.7
    
    const lowerText = transcribedText.toLowerCase()
    if (lowerText.includes('appointment') || lowerText.includes('schedule') || lowerText.includes('book')) {
      intent = 'book_appointment'
      confidence = 0.9
    } else if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('quote')) {
      intent = 'pricing_inquiry'
      confidence = 0.85
    } else if (lowerText.includes('help') || lowerText.includes('support') || lowerText.includes('problem')) {
      intent = 'support_request'
      confidence = 0.8
    } else if (extractedEntities.emails?.length || extractedEntities.phoneNumbers?.length) {
      intent = 'contact_information'
      confidence = 0.9
    }
    
    // Determine flow state based on current conversation
    let flowState = {}
    if (intent === 'book_appointment') {
      flowState = {
        primaryFlow: 'appointment_booking',
        subFlow: extractedEntities.emails?.length ? 'asking_date' : 'asking_contact',
        completedSteps: extractedEntities.emails?.length ? ['contact_collection'] : [],
        nextExpectedInputs: extractedEntities.emails?.length ? ['preferred_date', 'preferred_time'] : ['email', 'phone']
      }
    } else if (intent === 'pricing_inquiry') {
      flowState = {
        primaryFlow: 'lead_capture',
        subFlow: 'providing_information',
        nextExpectedInputs: ['follow_up_questions', 'contact_information']
      }
    }
    
    return {
      reply: aiResponse.reply,
      intent,
      confidence,
      entities: extractedEntities,
      flowState,
      currentFlow: aiResponse.currentFlow,
      nextVoiceAction: aiResponse.nextVoiceAction
    }
    
  } catch (error) {
    console.error('[Enhanced AI Processing] Error:', error)
    // Fallback to basic processing
    const aiResponse = await processMessage(transcribedText, conversationHistory, businessId, currentActiveFlow)
    return {
      reply: aiResponse.reply,
      currentFlow: aiResponse.currentFlow,
      nextVoiceAction: aiResponse.nextVoiceAction
    }
  }
}

// POST /incoming - Handle incoming Twilio voice calls
router.post('/incoming', async (req, res) => {
  try {
    console.log('[VOICE DEBUG] Incoming Twilio request body:', req.body)
    
    const twiml = new VoiceResponse()
    
    // Extract the Twilio phone number that was called
    const toPhoneNumber = req.body.To
    
    // Fetch business information based on the called phone number
    let businessName = 'our business'
    
    if (toPhoneNumber) {
      try {
        const business = await prisma.business.findFirst({
          where: {
            twilioPhoneNumber: toPhoneNumber  // Fixed: should match twilioPhoneNumber field
          }
        })
        
        if (business) {
          businessName = business.name || 'our business'
          console.log('[VOICE DEBUG] Found business:', business.name, 'for phone:', toPhoneNumber)
        } else {
          console.log('[VOICE DEBUG] No business found for phone:', toPhoneNumber)
        }
      } catch (dbError) {
        console.error('[VOICE DEBUG] Error fetching business by phone number:', dbError)
      }
    } else {
      console.log('[VOICE DEBUG] No toPhoneNumber provided in request')
    }
    
    // Add debugging for business name before processing
    console.log('[VOICE DEBUG] Original business name:', businessName)
    
    // Handle business name for SSML - use our helper function that preserves apostrophes
    const businessNameForSpeech = escapeTextForSSML(businessName)
    
    console.log('[VOICE DEBUG] Business name after XML escaping (keeping apostrophes literal):', businessNameForSpeech)
    
    // Create well-formed SSML welcome message wrapped in <speak> tags
    const finalWelcomeMessageSSML = 
      `<speak><prosody rate="medium">Hey! <break time="300ms"/> Thank you for calling ${businessNameForSpeech}. <break time="300ms"/> Please tell me how I can help you after the beep. <break time="200ms"/> Recording will stop after 30 seconds of speech or a period of silence.</prosody></speak>`
    
    console.log('[VOICE DEBUG] EXACT SSML STRING being passed to twiml.say():', finalWelcomeMessageSSML)
    console.log('[VOICE DEBUG] SSML string length:', finalWelcomeMessageSSML.length)
    
    // Say the welcome message with explicit voice settings
    twiml.say({ 
      voice: 'alice', 
      language: 'en-US' 
    }, finalWelcomeMessageSSML)
    
    // Start recording the caller's speech
    twiml.record({
      action: '/api/voice/handle-recording',
      method: 'POST',
      maxLength: 30,
      playBeep: true,
      transcribe: false,
      timeout: 5
    })
    
    // If no input is received after record timeout, provide fallback message
    const fallbackMessageSSML = 
      `<speak>We didn't receive any input. <break time="300ms"/> If you still need help, please call back. <break time="200ms"/> Goodbye.</speak>`
    
    twiml.say({ 
      voice: 'alice', 
      language: 'en-US' 
    }, fallbackMessageSSML)
    twiml.hangup()
    
    // Set response content type and send TwiML
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[VOICE DEBUG] Error in /incoming route:', error)
    
    // Create fallback TwiML response with SSML
    const twiml = new VoiceResponse()
    const errorMessage = createSSMLMessage(
      'Sorry, we\'re experiencing some technical difficulties right now. Please try calling back in a few minutes, or contact us directly.',
      { isConversational: true, addEmphasis: true, addPause: true }
    )
    twiml.say(errorMessage)
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /handle-recording - Handle recorded audio from Twilio
router.post('/handle-recording', async (req, res) => {
  try {
    console.log('[VOICE DEBUG] Handle recording request body:', req.body)
    
    // Extract data from Twilio request
    const RecordingUrl = req.body.RecordingUrl
    const Caller = req.body.From
    const TwilioNumberCalled = req.body.To
    const callSid = req.body.CallSid // Extract CallSid for session management
    
    console.log('[VOICE DEBUG] RecordingUrl:', RecordingUrl)
    console.log('[VOICE DEBUG] Caller:', Caller)
    console.log('[VOICE DEBUG] TwilioNumberCalled:', TwilioNumberCalled)
    console.log('[VOICE DEBUG] CallSid:', callSid)
    
    // Update session metadata with call information
    await updateSessionMetadata(callSid, {
      callerNumber: Caller,
      twilioCallSid: callSid
    })
    
    // Find business by Twilio phone number
    const business = await prisma.business.findFirst({
      where: {
        twilioPhoneNumber: TwilioNumberCalled
      }
    })
    
    if (!business) {
      console.error('[VOICE DEBUG] No business found for Twilio number:', TwilioNumberCalled)
      const twiml = new VoiceResponse()
      const errorMessage = createSSMLMessage(
        'This number is not configured for our service. <break time="300ms"/> Please contact support.',
        { addEmphasis: true }
      )
      twiml.say(errorMessage)
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    console.log('[VOICE DEBUG] Found business:', business.name)
    
    // Update session metadata with business information
    await updateSessionMetadata(callSid, {
      businessId: business.id
    })
    
    // Fetch AgentConfig for voice settings
    let agentConfig = null
    try {
      agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: business.id }
      })
      console.log('[VOICE DEBUG] Found AgentConfig:', agentConfig ? 'Yes' : 'No')
    } catch (configError) {
      console.error('[VOICE DEBUG] Error fetching AgentConfig:', configError)
    }
    
    // Configure voice settings with fallbacks
    const voiceToUse = (agentConfig?.twilioVoice || 'alice') as any
    const languageToUse = (agentConfig?.twilioLanguage || 'en-US') as any
    console.log('[VOICE DEBUG] Voice settings:', { voice: voiceToUse, language: languageToUse })
    
    // Update session metadata with voice settings
    await updateSessionMetadata(callSid, {
      voiceSettings: {
        voice: voiceToUse,
        language: languageToUse
      }
    })
    
    // Retrieve session state
    const session = await getVoiceSession(callSid)
    let currentConversationHistory = session.history
    let currentActiveFlow = session.currentFlow // Flow state before processing new message
    
    console.log('[VOICE DEBUG] Current session state:', { 
      historyLength: currentConversationHistory.length, 
      currentFlow: currentActiveFlow 
    })
    
    // Check if recording URL is present
    if (!RecordingUrl || RecordingUrl.trim() === '') {
      console.log('[VOICE DEBUG] No recording URL found')
      const twiml = new VoiceResponse()
      const noRecordingMessage = createSSMLMessage(
        'I didn\'t catch anything in that recording. Please call back if you need assistance. Thanks for calling!',
        { isConversational: true, addEmphasis: true }
      )
      twiml.say({ voice: voiceToUse, language: languageToUse }, noRecordingMessage)
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Download the audio file with proper cleanup
    console.log('[VOICE DEBUG] Downloading audio from:', RecordingUrl)
    logMemoryUsage('Before Audio Download')
    
    let tempFilePath: string | null = null;
    
    try {
      const response = await axios({
        method: 'get',
        url: RecordingUrl,
        responseType: 'stream',
        timeout: 30000, // 30 second timeout
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID!,
          password: process.env.TWILIO_AUTH_TOKEN!
        }
      })
      
      // Create temporary file path with unique identifier
      tempFilePath = path.join(os.tmpdir(), `twilio_audio_${callSid}_${Date.now()}.wav`)
      console.log('[VOICE DEBUG] Saving audio to:', tempFilePath)
      
      // Save the audio file with proper error handling and cleanup
      const writeStream = fs.createWriteStream(tempFilePath)
      let streamError: Error | null = null
      
      // Set up proper stream error handling
      writeStream.on('error', (error) => {
        streamError = error
        console.error('[VOICE DEBUG] Write stream error:', error)
      })
      
      response.data.on('error', (error: Error) => {
        streamError = error
        console.error('[VOICE DEBUG] Response stream error:', error)
      })
      
      // Pipe the data
      response.data.pipe(writeStream)
      
      // Wait for file to be written with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          writeStream.destroy()
          reject(new Error('File write timeout'))
        }, 30000) // 30 second timeout
        
        writeStream.on('finish', () => {
          clearTimeout(timeout)
          if (streamError) {
            reject(streamError)
          } else {
            resolve()
          }
        })
        
        writeStream.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })
      
      console.log('[VOICE DEBUG] Audio file saved successfully')
      logMemoryUsage('After Audio Download')
      
      // Transcribe the audio
      let transcribedText: string | null
      try {
        console.log('[VOICE DEBUG] Starting transcription...')
        transcribedText = await getTranscription(tempFilePath)
        console.log('[VOICE DEBUG] Transcription result:', transcribedText)
        logMemoryUsage('After Transcription')
      } catch (transcriptionError) {
        console.error('[VOICE DEBUG] Transcription failed:', transcriptionError)
        
        // Clean up temp file before returning
        await cleanupTempFile(tempFilePath)
        
        const twiml = new VoiceResponse()
        const transcriptionErrorMessage = createSSMLMessage(
          'I had trouble understanding. <break time="300ms"/> Could you please try again or call back later?',
          { addEmphasis: true }
        )
        twiml.say({ voice: voiceToUse, language: languageToUse }, transcriptionErrorMessage)
        twiml.hangup()
        
        res.setHeader('Content-Type', 'application/xml')
        res.send(twiml.toString())
        return
      }
      
      // Clean up temp file after successful transcription
      await cleanupTempFile(tempFilePath)
      
      // Check if transcription is empty
      if (!transcribedText || transcribedText.trim() === '') {
        console.log('[VOICE DEBUG] Empty transcription result')
        const twiml = new VoiceResponse()
        const emptyTranscriptionMessage = createSSMLMessage(
          'I had trouble understanding. <break time="300ms"/> Could you please try again or call back later?',
          { addEmphasis: true }
        )
        twiml.say({ voice: voiceToUse, language: languageToUse }, emptyTranscriptionMessage)
        twiml.hangup()
        
        res.setHeader('Content-Type', 'application/xml')
        res.send(twiml.toString())
        return
      }
      
      // Update conversation history with user's message
      currentConversationHistory.push({ role: 'user', content: transcribedText })
      console.log('[VOICE DEBUG] Updated conversation history with user message')
      
      // Process with AI handler using full context
      console.log('[VOICE DEBUG] Processing message with AI handler...')
      const aiResponse = await processEnhancedMessage(
        transcribedText, // The latest transcribed message
        currentConversationHistory, // Full conversation history
        business.id,
        currentActiveFlow, // Current flow state before this turn
        callSid // Add the missing callSid parameter
      )
      
      console.log('[Handle Recording] AI Handler response:', aiResponse)
      
      // Update conversation history with AI's response
      currentConversationHistory.push({ role: 'assistant', content: aiResponse.reply })
      
      // Update current active flow based on AI response
      currentActiveFlow = aiResponse.currentFlow || null
      
      // Save updated session state
      await updateVoiceSession(callSid, currentConversationHistory, currentActiveFlow)
      console.log('[VOICE DEBUG] Updated session state:', { 
        historyLength: currentConversationHistory.length, 
        newFlow: currentActiveFlow 
      })
      
      // After successful AI processing, update session with enhanced data
      console.log('[VOICE DEBUG] AI Response with enhanced data:', {
        intent: aiResponse.intent,
        confidence: aiResponse.confidence,
        entitiesFound: Object.keys(aiResponse.entities || {}).length,
        flowState: aiResponse.flowState,
        nextVoiceAction: aiResponse.nextVoiceAction
      })
      
      // Add user message with extracted entities and intent
      await addEnhancedMessage(callSid, 'user', transcribedText, {
        entities: aiResponse.entities
      })
      
      // Add AI response with intent information
      await addEnhancedMessage(callSid, 'assistant', aiResponse.reply, {
        intent: aiResponse.intent,
        confidence: aiResponse.confidence
      })
      
      // Update session flow state if provided
      if (aiResponse.flowState) {
        await updateSessionFlow(callSid, aiResponse.flowState)
      }
      
      // Update entities in session
      if (aiResponse.entities && Object.keys(aiResponse.entities).length > 0) {
        await voiceSessionService.updateEntities(callSid, aiResponse.entities)
      }
      
      // Add intent to session if identified
      if (aiResponse.intent && aiResponse.confidence) {
        await voiceSessionService.addIntent(callSid, aiResponse.intent, aiResponse.confidence, transcribedText)
      }
      
      // Update legacy session for backwards compatibility
      currentConversationHistory.push({ role: 'user', content: transcribedText })
      currentConversationHistory.push({ role: 'assistant', content: aiResponse.reply })
      currentActiveFlow = aiResponse.currentFlow || null
      
      await updateVoiceSession(callSid, currentConversationHistory, currentActiveFlow)
      
      // Create TwiML response using nextVoiceAction for dynamic generation
      const twimlResponse = new VoiceResponse()
      
      if (aiResponse && aiResponse.reply) {
        // Analyze the AI response to determine appropriate SSML enhancements
        const isQuestion = aiResponse.reply.includes('?')
        const isGreeting = /^(hey|hello|hi|welcome)/i.test(aiResponse.reply)
        const isConfirmation = /^(got it|okay|alright|perfect|great|thanks)/i.test(aiResponse.reply)
        const isInformational = !isQuestion && !isGreeting && !isConfirmation
        
        // Create enhanced SSML based on response type
        let enhancedReply: string
        
        if (isQuestion) {
          // This is likely a lead capture question - make it conversational and clear
          enhancedReply = createSSMLMessage(aiResponse.reply, { 
            isQuestion: true, 
            isConversational: true, 
            addEmphasis: true 
          })
        } else if (isGreeting) {
          // Handle greeting responses
          enhancedReply = createSSMLMessage(aiResponse.reply, { 
            isGreeting: true, 
            isConversational: true 
          })
        } else if (isConfirmation) {
          // Handle confirmations and acknowledgments
          enhancedReply = createSSMLMessage(aiResponse.reply, { 
            isConversational: true, 
            addPause: true, 
            pauseDuration: '200ms' 
          })
        } else {
          // Handle informational responses (FAQ answers, final confirmations)
          enhancedReply = createSSMLMessage(aiResponse.reply, { 
            isConversational: true, 
            addEmphasis: true,
            addPause: true,
            pauseDuration: '300ms'
          })
        }
        
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, enhancedReply)
      } else {
        const fallbackMessage = createSSMLMessage(
          "I'm sorry, I encountered an issue. Let me try to help you differently.",
          { addPause: true, pauseDuration: '300ms', isConversational: true }
        )
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, fallbackMessage)
      }
      
      // Use switch statement on nextVoiceAction for dynamic TwiML generation
      const nextAction = aiResponse.nextVoiceAction || 'HANGUP' // Default to HANGUP if not specified
      console.log('[VOICE DEBUG] Next voice action determined:', nextAction)
      
      switch (nextAction) {
        case 'CONTINUE':
          // Continue conversation - prompt for more input with natural conversational flow
          const continuePrompt = createSSMLMessage(
            "What else can I help you with? Or, say 'goodbye' to end the call.",
            { isQuestion: true, isConversational: true, addPause: true, pauseDuration: '500ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, continuePrompt)
          twimlResponse.record({
            action: '/api/voice/handle-recording',
            method: 'POST',
            maxLength: 30,
            playBeep: true,
            timeout: 7, // Seconds of silence before completing recording
            transcribe: false
          })
          
          // Fallback if no response with conversational flow
          const noResponseMessage = createSSMLMessage(
            "We did not receive any input. Thank you for calling. Goodbye.",
            { isConversational: true, addPause: true, pauseDuration: '300ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, noResponseMessage)
          twimlResponse.hangup()
          break

        case 'HANGUP':
          // End the call gracefully and clear session
          const endCallMessage = createSSMLMessage(
            "Thank you for calling. We'll be in touch soon. Goodbye.",
            { isConversational: true, addPause: true, pauseDuration: '300ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, endCallMessage)
          twimlResponse.hangup()
          
          // Clear session for ended call
          await clearVoiceSession(callSid)
          console.log('[VOICE DEBUG] Call ended with HANGUP action, session cleared for CallSid:', callSid)
          break

        case 'TRANSFER':
          // Future: Transfer call to human agent or business number
          const transferMessage = createSSMLMessage(
            "Let me transfer you to someone who can help you directly. Please hold on.",
            { isConversational: true, addPause: true, pauseDuration: '300ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, transferMessage)
          
          // TODO: Implement actual transfer logic when business phone numbers are configured
          // For now, fall back to hangup with a message
          const transferFallbackMessage = createSSMLMessage(
            "I apologize, but our transfer system isn't configured yet. Please call our main number directly for immediate assistance. Thank you for calling.",
            { isConversational: true, addEmphasis: true }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, transferFallbackMessage)
          twimlResponse.hangup()
          
          // Clear session after transfer attempt
          await clearVoiceSession(callSid)
          console.log('[VOICE DEBUG] Call ended with TRANSFER action, session cleared for CallSid:', callSid)
          break

        case 'VOICEMAIL':
          // Future: Take a voicemail message
          const voicemailMessage = createSSMLMessage(
            "I'd like to take a detailed message for our team. Please speak after the beep, and take your time.",
            { isConversational: true, addPause: true, pauseDuration: '500ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, voicemailMessage)
          
          // Record a longer voicemail message
          twimlResponse.record({
            action: '/api/voice/handle-voicemail-recording', // Future endpoint for voicemail processing
            method: 'POST',
            maxLength: 120, // Allow up to 2 minutes for voicemail
            playBeep: true,
            timeout: 3, // Shorter timeout for voicemail silence detection
            transcribe: false
          })
          
          // Fallback after voicemail recording
          const voicemailCompleteMessage = createSSMLMessage(
            "Thank you for your message. Our team will review it and get back to you as soon as possible. Goodbye.",
            { isConversational: true, addPause: true, pauseDuration: '300ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, voicemailCompleteMessage)
          twimlResponse.hangup()
          
          // Note: Session will be cleared after voicemail processing
          console.log('[VOICE DEBUG] Voicemail recording initiated for CallSid:', callSid)
          break

        default:
          // Fallback to HANGUP for any unexpected action
          console.warn('[VOICE DEBUG] Unexpected nextVoiceAction:', nextAction, 'falling back to HANGUP')
          const defaultEndMessage = createSSMLMessage(
            "Thank you for calling. Have a great day.",
            { isConversational: true, addPause: true, pauseDuration: '300ms' }
          )
          twimlResponse.say({ voice: voiceToUse, language: languageToUse }, defaultEndMessage)
          twimlResponse.hangup()
          
          await clearVoiceSession(callSid)
          console.log('[VOICE DEBUG] Call ended with default action, session cleared for CallSid:', callSid)
          break
      }
      
      // Send TwiML response
      res.setHeader('Content-Type', 'application/xml')
      res.send(twimlResponse.toString())
      
      // Log final memory usage for this request
      logMemoryUsage('End of Request Processing')
      
    } catch (downloadError: any) {
      console.error('[VOICE DEBUG] Error downloading audio:', downloadError.isAxiosError ? downloadError.toJSON() : downloadError)
      
      // Clean up temp file if it was created
      if (tempFilePath) {
        await cleanupTempFile(tempFilePath)
      }
      
      logMemoryUsage('After Download Error')
      
      const twiml = new VoiceResponse()
      const downloadErrorMessage = createSSMLMessage(
        'Sorry, I had trouble accessing your message recording. <break time="300ms"/> Please try again.',
        { addEmphasis: true }
      )
      twiml.say({ voice: voiceToUse, language: languageToUse }, downloadErrorMessage)
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
  } catch (error) {
    console.error('[VOICE DEBUG] Error in /handle-recording route:', error)
    
    // Create fallback TwiML response
    const twiml = new VoiceResponse()
    const generalErrorMessage = createSSMLMessage(
      'Sorry, we\'re experiencing some technical difficulties right now. Please try calling back in a few minutes.',
      { isConversational: true, addEmphasis: true, addPause: true }
    )
    twiml.say(generalErrorMessage)
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /handle-voicemail-recording - Future endpoint for processing voicemail messages
router.post('/handle-voicemail-recording', async (req, res) => {
  try {
    console.log('[VOICEMAIL DEBUG] Handle voicemail recording request body:', req.body)
    
    const RecordingUrl = req.body.RecordingUrl
    const Caller = req.body.From
    const TwilioNumberCalled = req.body.To
    const callSid = req.body.CallSid
    
    console.log('[VOICEMAIL DEBUG] RecordingUrl:', RecordingUrl)
    console.log('[VOICEMAIL DEBUG] Caller:', Caller)
    console.log('[VOICEMAIL DEBUG] CallSid:', callSid)
    
    // TODO: Implement voicemail processing logic
    // 1. Download and transcribe the voicemail recording
    // 2. Create a lead or ticket with the voicemail content
    // 3. Send notification to business with voicemail details
    // 4. Store voicemail for future reference
    
    // For now, just acknowledge and hang up
    const twiml = new VoiceResponse()
    const acknowledgmentMessage = createSSMLMessage(
      "Thank you for your detailed message. Our team will review it and contact you soon. Goodbye.",
      { isConversational: true, addPause: true, pauseDuration: '300ms' }
    )
    twiml.say(acknowledgmentMessage)
    twiml.hangup()
    
    // Clear the session after voicemail
    await clearVoiceSession(callSid)
    console.log('[VOICEMAIL DEBUG] Voicemail processed, session cleared for CallSid:', callSid)
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[VOICEMAIL DEBUG] Error in /handle-voicemail-recording route:', error)
    
    const twiml = new VoiceResponse()
    const errorMessage = createSSMLMessage(
      'Sorry, we had trouble processing your voicemail. Please try calling back later.',
      { addEmphasis: true }
    )
    twiml.say(errorMessage)
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

export default router 