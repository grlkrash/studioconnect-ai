import { Router } from 'express'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createClient, RedisClientType } from 'redis'
import { getTranscription, generateSpeechFromText } from '../services/openai'
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
const MEMORY_CHECK_INTERVAL = parseInt(process.env.MEMORY_CHECK_INTERVAL || '300000') // Default 5 minutes (increased from 1 minute)
const SESSION_CLEANUP_INTERVAL = 300000; // 5 minutes
const MAX_SESSION_AGE_MS = 1800000; // 30 minutes
const MAX_MEMORY_USAGE_MB = 1536; // Alert threshold - increased for 2GB RAM instance (75% of 2GB)
const MAX_CONVERSATION_HISTORY_LENGTH = 50; // Prevent unbounded growth

// Enhanced in-memory session bounds and cleanup configuration
const MAX_IN_MEMORY_SESSIONS = 100; // Max number of call sessions to keep in memory
const IN_MEMORY_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for inactive in-memory sessions

// Health check configuration
const REDIS_HEALTH_CHECK_INTERVAL = parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL || '60000') // Default 1 minute (increased from 30 seconds)
const ENABLE_MEMORY_MONITORING = process.env.NODE_ENV === 'development' || process.env.ENABLE_MEMORY_MONITORING === 'true'
const ENABLE_VERBOSE_LOGGING = process.env.NODE_ENV === 'development' || process.env.ENABLE_VERBOSE_LOGGING === 'true'

// Memory monitoring
function logMemoryUsage(context: string = ''): void {
  // Only log in development or when explicitly enabled
  if (!ENABLE_MEMORY_MONITORING) return
  
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  const memoryInfo = {
    context,
    rss: formatBytes(usage.rss),
    heapUsed: formatBytes(usage.heapUsed),
    heapTotal: formatBytes(usage.heapTotal),
    external: formatBytes(usage.external)
  }
  
  if (ENABLE_VERBOSE_LOGGING) {
    console.log(`[Memory ${context}] RSS: ${memoryInfo.rss}MB, Heap Used: ${memoryInfo.heapUsed}MB, Heap Total: ${memoryInfo.heapTotal}MB, External: ${memoryInfo.external}MB`);
  }
  
  // Always alert on high memory usage regardless of logging settings
  if (memoryInfo.heapUsed > MAX_MEMORY_USAGE_MB) {
    console.warn(`[Memory Alert] High memory usage detected: ${memoryInfo.heapUsed}MB > ${MAX_MEMORY_USAGE_MB}MB threshold`);
  }
}

// Enhanced cleanup function for in-memory sessions
function cleanupOldInMemorySessions(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  // First pass: Remove sessions that exceed timeout
  for (const [callSid, session] of voiceSessions.entries()) {
    if (now - session.lastAccessed > IN_MEMORY_SESSION_TIMEOUT_MS) {
      voiceSessions.delete(callSid);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[Voice Session] Cleaned up ${cleanedCount} old in-memory voice sessions.`);
  }
  
  // Second pass: If map still exceeds max size after cleaning old ones, remove oldest to enforce hard limit
  if (voiceSessions.size > MAX_IN_MEMORY_SESSIONS) {
    const sessionsArray = Array.from(voiceSessions.entries());
    sessionsArray.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed); // Sort by oldest
    let removedToFit = 0;
    
    while (voiceSessions.size > MAX_IN_MEMORY_SESSIONS && sessionsArray.length > 0) {
      const oldestSession = sessionsArray.shift();
      if (oldestSession) {
        voiceSessions.delete(oldestSession[0]);
        removedToFit++;
      }
    }
    
    if (removedToFit > 0) {
      console.log(`[Voice Session] Removed ${removedToFit} oldest in-memory sessions to enforce MAX_IN_MEMORY_SESSIONS limit.`);
    }
  }
  
  if (ENABLE_VERBOSE_LOGGING) {
    console.log(`[Voice Session] Current in-memory session count: ${voiceSessions.size}`);
  }
  
  // Only log memory after cleanup if there was significant activity or in verbose mode
  if ((cleanedCount > 0 || voiceSessions.size > 10) && ENABLE_MEMORY_MONITORING) {
    logMemoryUsage('After Session Cleanup');
  }
}

// Enhanced temp file cleanup with error handling
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      if (ENABLE_VERBOSE_LOGGING) {
        console.log(`[File Cleanup] Successfully deleted temp file: ${filePath}`);
      }
    }
  } catch (error) {
    console.error(`[File Cleanup] Failed to delete temp file ${filePath}:`, error);
  }
}

// Start memory monitoring - only if enabled
let memoryMonitoringInterval: NodeJS.Timeout | undefined;
if (ENABLE_MEMORY_MONITORING) {
  memoryMonitoringInterval = setInterval(() => {
    logMemoryUsage('Periodic Check');
  }, MEMORY_CHECK_INTERVAL);
  
  if (ENABLE_VERBOSE_LOGGING) {
    console.log(`[Memory Monitor] Started memory monitoring with ${MEMORY_CHECK_INTERVAL}ms interval`);
  }
}

// Start session cleanup - always enabled but with optimized logging
const sessionCleanupInterval = setInterval(cleanupOldInMemorySessions, SESSION_CLEANUP_INTERVAL);

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

// Enhanced periodic health check with smart backoff and connection status awareness
let healthCheckInterval: NodeJS.Timeout | undefined;
let lastRedisCheckTime = 0;
let consecutiveFailures = 0;

function startRedisHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(() => {
    const now = Date.now();
    
    // Skip check if Redis is connected and healthy
    if (isRedisClientReady()) {
      consecutiveFailures = 0;
      lastRedisCheckTime = now;
      return;
    }
    
    // Skip check if no Redis URL configured
    if (!process.env.REDIS_URL) {
      return;
    }
    
    // Skip check if max reconnection attempts reached
    if (redisReconnectAttempts >= maxRedisReconnectAttempts) {
      if (ENABLE_VERBOSE_LOGGING && now - lastRedisCheckTime > 300000) { // Log once every 5 minutes
        console.log(`[Redis Health Check] Max reconnection attempts reached. Redis health checking suspended.`);
        lastRedisCheckTime = now;
      }
      return;
    }
    
    // Implement exponential backoff for consecutive failures
    const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveFailures), 60000); // Max 1 minute backoff
    if (consecutiveFailures > 0 && now - lastRedisCheckTime < backoffDelay) {
      return; // Skip this check due to backoff
    }
    
    lastRedisCheckTime = now;
    
    if (ENABLE_VERBOSE_LOGGING || consecutiveFailures === 0) {
      console.log(`[Redis Health Check] Attempting to reconnect to Redis (attempt ${redisReconnectAttempts + 1}/${maxRedisReconnectAttempts})...`);
    }
    
    initializeRedis().catch(err => {
      consecutiveFailures++;
      if (ENABLE_VERBOSE_LOGGING || consecutiveFailures <= 3) {
        console.error('[Redis Health Check] Reconnection failed:', err);
      }
    });
  }, REDIS_HEALTH_CHECK_INTERVAL);
  
  if (ENABLE_VERBOSE_LOGGING) {
    console.log(`[Redis Health Check] Started Redis health monitoring with ${REDIS_HEALTH_CHECK_INTERVAL}ms interval`);
  }
}

startRedisHealthCheck();

// Graceful shutdown handler for all resources
async function gracefulShutdown(signal: string) {
  console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);
  
  // Clear all intervals
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    console.log('[Shutdown] Redis health check timer cleared.');
  }
  
  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    console.log('[Shutdown] Session cleanup timer cleared.');
  }
  
  if (memoryMonitoringInterval) {
    clearInterval(memoryMonitoringInterval);
    console.log('[Shutdown] Memory monitoring timer cleared.');
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
  // Log memory before session retrieval (only in verbose mode)
  if (ENABLE_VERBOSE_LOGGING) {
    logMemoryUsage(`Getting Session ${callSid}`);
  }
  
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

// Helper function to generate OpenAI TTS audio and create TwiML Play verb
async function generateAndPlayTTS(
  text: string, 
  twimlResponse: typeof VoiceResponse.prototype, 
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
  fallbackTwilioVoice: any = 'alice',
  fallbackLanguage: any = 'en-US',
  useOpenaiTts: boolean = true,
  openaiModel: 'tts-1' | 'tts-1-hd' = 'tts-1'
): Promise<void> {
  if (!text || text.trim() === '') {
    console.warn('[TTS] Empty text provided, skipping TTS generation');
    return;
  }

  // If OpenAI TTS is disabled, use Twilio TTS directly
  if (!useOpenaiTts) {
    console.log('[TTS] OpenAI TTS disabled, using Twilio TTS directly');
    const twilioMessage = createSSMLMessage(text, { isConversational: true });
    twimlResponse.say({ voice: fallbackTwilioVoice, language: fallbackLanguage }, twilioMessage);
    return;
  }

  try {
    // Generate OpenAI TTS audio with specified model
    const tempAudioPath = await generateSpeechFromText(text, openaiVoice, openaiModel);
    
    if (tempAudioPath) {
      // Extract filename and construct public URL
      const audioFileName = path.basename(tempAudioPath);
      const audioUrl = `${process.env.APP_PRIMARY_URL}/api/voice/play-audio/${audioFileName}`;
      
      console.log(`[OpenAI TTS] Playing AI-generated audio from URL: ${audioUrl}`);
      twimlResponse.play(audioUrl);
    } else {
      // Fallback to Twilio TTS if OpenAI TTS fails
      console.warn(`[OpenAI TTS Fallback] generateSpeechFromText returned null. Falling back to Twilio TTS for text: "${text}"`);
      const fallbackMessage = createSSMLMessage(text, { isConversational: true });
      twimlResponse.say({ voice: fallbackTwilioVoice, language: fallbackLanguage }, fallbackMessage);
    }
  } catch (error) {
    console.error(`[OpenAI TTS Fallback] An exception occurred in generateSpeechFromText. Falling back to Twilio TTS. Error:`, error);
    // Fallback to Twilio TTS
    const fallbackMessage = createSSMLMessage(text, { isConversational: true });
    twimlResponse.say({ voice: fallbackTwilioVoice, language: fallbackLanguage }, fallbackMessage);
  }
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
      `<speak><prosody rate="medium">Hey! <break time="300ms"/> Thank you for calling ${businessNameForSpeech}. <break time="300ms"/> How can I help you today?</prosody></speak>`
    
    console.log('[VOICE DEBUG] EXACT SSML STRING being passed to twiml.say():', finalWelcomeMessageSSML)
    console.log('[VOICE DEBUG] SSML string length:', finalWelcomeMessageSSML.length)
    
    // Say the welcome message with explicit voice settings
    twiml.say({ 
      voice: 'alice', 
      language: 'en-US' 
    }, finalWelcomeMessageSSML)
    
    // Use gather() for real-time speech input instead of record()
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/handle-speech',
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 10
    })
    
    // If no input is received after gather timeout, provide fallback message
    const fallbackMessageSSML = 
      `<speak>I didn't hear anything. <break time="300ms"/> If you still need help, please call back. <break time="200ms"/> Goodbye.</speak>`
    
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

// POST /handle-speech - Handle real-time speech input from Twilio Gather
router.post('/handle-speech', async (req, res) => {
  try {
    console.log('[VOICE DEBUG] Handle speech request body:', req.body)
    
    // Extract data from Twilio request
    const SpeechResult = req.body.SpeechResult
    const Caller = req.body.From
    const TwilioNumberCalled = req.body.To
    const callSid = req.body.CallSid
    
    console.log('[VOICE DEBUG] SpeechResult:', SpeechResult)
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
    let currentActiveFlow = session.currentFlow
    
    console.log('[VOICE DEBUG] Current session state:', { 
      historyLength: currentConversationHistory.length, 
      currentFlow: currentActiveFlow 
    })
    
    // Check if we have speech result from gather
    if (!SpeechResult || SpeechResult.trim() === '') {
      console.log('[VOICE DEBUG] No speech result found - gather timed out')
      const twiml = new VoiceResponse()
      
      // Give them another chance with a more encouraging message
      await generateAndPlayTTS(
        "I didn't hear a response. Is there anything else I can help with?",
        twiml,
        'nova',
        voiceToUse,
        languageToUse,
        true, // useOpenaiTts
        'tts-1' // openaiModel
      );
      
      // Continue the conversation loop with another gather
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 10
      })
      
      // Final fallback if still no response
      const fallbackMessage = createSSMLMessage(
        "Thank you for calling. Have a great day. Goodbye.",
        { isConversational: true }
      )
      twiml.say({ voice: voiceToUse, language: languageToUse }, fallbackMessage)
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // We have speech input - use it directly (no file download/transcription needed)
    const transcribedText = SpeechResult
    console.log('[VOICE DEBUG] Using speech result directly:', transcribedText)
    
    if (ENABLE_VERBOSE_LOGGING) {
      logMemoryUsage('Processing Speech Input')
    }
    
    // Update conversation history with user's message
    currentConversationHistory.push({ role: 'user', content: transcribedText })
    console.log('[VOICE DEBUG] Updated conversation history with user message')
    
    // Process with AI handler using full context
    console.log('[VOICE DEBUG] Processing message with AI handler...')
    const aiResponse = await processEnhancedMessage(
      transcribedText,
      currentConversationHistory,
      business.id,
      currentActiveFlow,
      callSid
    )
    
    console.log('[Handle Speech] AI Handler response:', aiResponse)
    
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
    
    // Add enhanced session data
    await addEnhancedMessage(callSid, 'user', transcribedText, {
      entities: aiResponse.entities
    })
    
    await addEnhancedMessage(callSid, 'assistant', aiResponse.reply, {
      intent: aiResponse.intent,
      confidence: aiResponse.confidence
    })
    
    if (aiResponse.flowState) {
      await updateSessionFlow(callSid, aiResponse.flowState)
    }
    
    if (aiResponse.entities && Object.keys(aiResponse.entities).length > 0) {
      await voiceSessionService.updateEntities(callSid, aiResponse.entities)
    }
    
    if (aiResponse.intent && aiResponse.confidence) {
      await voiceSessionService.addIntent(callSid, aiResponse.intent, aiResponse.confidence, transcribedText)
    }
    
    // Create TwiML response
    const twimlResponse = new VoiceResponse()
    
    // Determine voice configuration from agentConfig
    const useOpenaiTts = agentConfig?.useOpenaiTts !== false // Default to true if not set
    const openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 
      (agentConfig?.openaiVoice as any) || 'nova'
    const openaiModel: 'tts-1' | 'tts-1-hd' = 
      (agentConfig?.openaiModel as 'tts-1' | 'tts-1-hd') || 'tts-1'
    
    console.log(`[Voice Config] OpenAI TTS enabled: ${useOpenaiTts}, Voice: ${openaiVoice}, Model: ${openaiModel}`)
    
    // Generate AI response
    if (aiResponse && aiResponse.reply) {
      await generateAndPlayTTS(
        aiResponse.reply, 
        twimlResponse, 
        openaiVoice, 
        voiceToUse, 
        languageToUse,
        useOpenaiTts,
        openaiModel
      );
    } else {
      await generateAndPlayTTS(
        "I'm sorry, I encountered an issue. Let me try to help you differently.",
        twimlResponse,
        openaiVoice,
        voiceToUse,
        languageToUse,
        useOpenaiTts,
        openaiModel
      );
    }
    
    // Handle next action based on AI response
    const nextAction = aiResponse.nextVoiceAction || 'HANGUP'
    console.log('[VOICE DEBUG] Next voice action determined:', nextAction)
    
    switch (nextAction) {
      case 'CONTINUE':
        // Continue conversation with another gather
        const continueGather = twimlResponse.gather({
          input: ['speech'],
          action: '/api/voice/handle-speech',
          method: 'POST',
          speechTimeout: 'auto',
          timeout: 10
        })
        
        // Fallback if no response
        const continueMessage = createSSMLMessage(
          "Thank you for calling. Have a great day. Goodbye.",
          { isConversational: true }
        )
        twimlResponse.say({ voice: voiceToUse, language: languageToUse }, continueMessage)
        twimlResponse.hangup()
        break

      case 'HANGUP':
        // End the call gracefully
        twimlResponse.hangup()
        await clearVoiceSession(callSid)
        console.log('[VOICE DEBUG] Call ended with HANGUP action, session cleared for CallSid:', callSid)
        break

      case 'TRANSFER':
        // TODO: Implement transfer logic
        await generateAndPlayTTS(
          "I apologize, but our transfer system isn't configured yet. Please call our main number directly for immediate assistance.",
          twimlResponse,
          openaiVoice,
          voiceToUse,
          languageToUse,
          useOpenaiTts,
          openaiModel
        );
        twimlResponse.hangup()
        await clearVoiceSession(callSid)
        break

      case 'VOICEMAIL':
        // TODO: Implement voicemail logic
        await generateAndPlayTTS(
          "Thank you for your message. Our team will review it and get back to you as soon as possible.",
          twimlResponse,
          openaiVoice,
          voiceToUse,
          languageToUse,
          useOpenaiTts,
          openaiModel
        );
        twimlResponse.hangup()
        await clearVoiceSession(callSid)
        break

      default:
        // Fallback to HANGUP
        twimlResponse.hangup()
        await clearVoiceSession(callSid)
        break
    }
    
    // Send TwiML response
    res.setHeader('Content-Type', 'application/xml')
    res.send(twimlResponse.toString())
    
    if (ENABLE_VERBOSE_LOGGING) {
      logMemoryUsage('End of Speech Processing')
    }
    
  } catch (error) {
    console.error('[VOICE DEBUG] Error in /handle-speech route:', error)
    
    // Create fallback TwiML response
    const twiml = new VoiceResponse()
    await generateAndPlayTTS(
      'Sorry, we\'re experiencing some technical difficulties right now. Please try calling back in a few minutes.',
      twiml,
      'nova',
      'alice',
      'en-US',
      true, // useOpenaiTts
      'tts-1' // openaiModel
    );
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
    await generateAndPlayTTS(
      "Thank you for your detailed message. Our team will review it and contact you soon. Goodbye.",
      twiml,
      'nova', // Default voice
      'alice', // Fallback Twilio voice
      'en-US', // Fallback language
      true, // useOpenaiTts
      'tts-1' // openaiModel
    );
    twiml.hangup()
    
    // Clear the session after voicemail
    await clearVoiceSession(callSid)
    console.log('[VOICEMAIL DEBUG] Voicemail processed, session cleared for CallSid:', callSid)
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[VOICEMAIL DEBUG] Error in /handle-voicemail-recording route:', error)
    
    const twiml = new VoiceResponse()
    await generateAndPlayTTS(
      'Sorry, we had trouble processing your voicemail. Please try calling back later.',
      twiml,
      'nova', // Default voice
      'alice', // Fallback Twilio voice
      'en-US', // Fallback language
      true, // useOpenaiTts
      'tts-1' // openaiModel
    );
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// GET /play-audio/:fileName - Serve temporary audio files for Twilio Play verb
router.get('/play-audio/:fileName', (req, res) => {
  const { fileName } = req.params;

  // Basic security check to prevent path traversal attacks
  if (fileName.includes('..') || fileName.includes('/')) {
    console.warn(`[Play Audio] Security violation attempt with fileName: ${fileName}`);
    return res.status(400).send('Invalid filename.');
  }

  const filePath = path.join(os.tmpdir(), fileName);
  console.log(`[Play Audio] Attempting to serve audio file: ${filePath}`);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Play Audio] Error sending file ${filePath}:`, err);
        res.status(500).end();
      } else {
        console.log(`[Play Audio] Successfully sent file: ${filePath}`);
      }
      
      // Ensure cleanup happens regardless of success or error
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[Play Audio] Error deleting temp audio file ${filePath}:`, unlinkErr);
        } else {
          console.log(`[Play Audio] Cleaned up temp audio file: ${filePath}`);
        }
      });
    });
  } else {
    console.error(`[Play Audio] File not found: ${filePath}`);
    res.status(404).send('Audio not found.');
  }
});

// GET /health - System health and monitoring endpoint
router.get('/health', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage()
    const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100
    
    // Get session statistics
    const sessionStats = await voiceSessionService.getSessionStats()
    
    // Get active voice sessions count
    const activeVoiceSessions = voiceSessions.size
    
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      memory: {
        rss: formatBytes(memoryUsage.rss),
        heapUsed: formatBytes(memoryUsage.heapUsed),
        heapTotal: formatBytes(memoryUsage.heapTotal),
        external: formatBytes(memoryUsage.external),
        heapUsedPercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      redis: {
        connected: isRedisClientReady(),
        reconnectAttempts: redisReconnectAttempts,
        maxReconnectAttempts: maxRedisReconnectAttempts,
        consecutiveFailures
      },
      sessions: {
        activeVoiceSessions,
        ...sessionStats
      },
      timers: {
        memoryMonitoringEnabled: ENABLE_MEMORY_MONITORING,
        memoryCheckInterval: MEMORY_CHECK_INTERVAL,
        sessionCleanupInterval: SESSION_CLEANUP_INTERVAL,
        redisHealthCheckInterval: REDIS_HEALTH_CHECK_INTERVAL
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        verboseLogging: ENABLE_VERBOSE_LOGGING,
        redisConfigured: !!process.env.REDIS_URL
      }
    }
    
    // Check if memory usage is high
    if (formatBytes(memoryUsage.heapUsed) > MAX_MEMORY_USAGE_MB) {
      healthData.status = 'warning'
    }
    
    // Force memory logging if requested
    if (req.query.logMemory === 'true') {
      logMemoryUsage('Health Check Request')
    }
    
    res.json(healthData)
    
  } catch (error) {
    console.error('[Health Check] Error:', error)
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

export default router 