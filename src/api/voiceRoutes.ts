import { Router, Request, Response, NextFunction } from 'express'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createClient, RedisClientType } from 'redis'
import { getTranscription, generateSpeechFromText } from '../services/openai'
import OpenAI from 'openai'
import { processMessage, generateRecoveryResponse } from '../core/aiHandler'
import VoiceSessionService, { 
  ExtractedEntities, 
  ConversationMessage, 
  DetailedFlowState,
  SessionMetadata 
} from '../services/voiceSessionService'

const router = Router()
const prisma = new PrismaClient()
const { VoiceResponse } = twilio.twiml

// Initialize Twilio REST client for updating calls
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
  // Construct the full URL, which is more reliable on platforms like Render
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

// Initialize voice session service
const voiceSessionService = VoiceSessionService.getInstance()

// Initialize OpenAI client for health checks
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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

// Temporary storage for background processing results
const backgroundProcessingResults = new Map<string, {
  audioUrl?: string | null,
  nextAction?: string,
  voiceToUse?: string,
  languageToUse?: string,
  useOpenaiTts?: boolean,
  openaiVoice?: string,
  openaiModel?: string,
  fallbackText?: string,
  shouldClearSession?: boolean,
  timestamp: number
}>();

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
  let backgroundResultsCleanedCount = 0;
  
  // First pass: Remove sessions that exceed timeout
  for (const [callSid, session] of voiceSessions.entries()) {
    if (now - session.lastAccessed > IN_MEMORY_SESSION_TIMEOUT_MS) {
      voiceSessions.delete(callSid);
      cleanedCount++;
    }
  }
  
  // Clean up old background processing results (5 minutes timeout)
  for (const [callSid, result] of backgroundProcessingResults.entries()) {
    if (now - result.timestamp > 5 * 60 * 1000) { // 5 minutes
      backgroundProcessingResults.delete(callSid);
      backgroundResultsCleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[Voice Session] Cleaned up ${cleanedCount} old in-memory voice sessions.`);
  }
  
  if (backgroundResultsCleanedCount > 0) {
    console.log(`[Background Results] Cleaned up ${backgroundResultsCleanedCount} old background processing results.`);
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
    console.log(`[Background Results] Current background results count: ${backgroundProcessingResults.size}`);
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
  
  // Check for active voice sessions and delay shutdown if needed
  const activeCallsCount = voiceSessions.size + backgroundProcessingResults.size;
  if (activeCallsCount > 0) {
    console.warn(`[Shutdown] ${activeCallsCount} active voice sessions detected. Delaying shutdown for 30 seconds to allow calls to complete.`);
    
    // Set a maximum wait time of 30 seconds
    const shutdownTimeout = setTimeout(() => {
      console.warn('[Shutdown] Shutdown timeout reached. Forcing shutdown despite active calls.');
      performShutdown();
    }, 30000);
    
    // Check every 2 seconds if all calls are complete
    const checkInterval = setInterval(() => {
      const remaining = voiceSessions.size + backgroundProcessingResults.size;
      if (remaining === 0) {
        console.log('[Shutdown] All voice sessions completed. Proceeding with shutdown.');
        clearTimeout(shutdownTimeout);
        clearInterval(checkInterval);
        performShutdown();
      } else {
        console.log(`[Shutdown] Waiting for ${remaining} active voice sessions to complete...`);
      }
    }, 2000);
    
    return;
  }
  
  performShutdown();
}

async function performShutdown() {
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
  
  // Clear background processing results
  backgroundProcessingResults.clear();
  console.log('[Shutdown] Background processing results cleared.');
  
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

// Helper function to generate audio URL for background processing
async function generateAudioUrl(
  text: string, 
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
  useOpenaiTts: boolean = true,
  openaiModel: 'tts-1' | 'tts-1-hd' = 'tts-1'
): Promise<string | null> {
  if (!text || text.trim() === '') {
    console.warn('[TTS URL] Empty text provided, skipping TTS generation');
    return null;
  }

  // If OpenAI TTS is disabled, return null (will fallback to Twilio TTS)
  if (!useOpenaiTts) {
    console.log('[TTS URL] OpenAI TTS disabled, returning null for fallback');
    return null;
  }

  try {
    // Generate OpenAI TTS audio with specified model
    const tempAudioPath = await generateSpeechFromText(text, openaiVoice, openaiModel);
    
    if (tempAudioPath) {
      // Extract filename and construct public URL
      const audioFileName = path.basename(tempAudioPath);
      const audioUrl = `${process.env.APP_PRIMARY_URL}/api/voice/play-audio/${audioFileName}`;
      
      console.log(`[TTS URL] Generated audio URL: ${audioUrl}`);
      return audioUrl;
    } else {
      console.warn(`[TTS URL] generateSpeechFromText returned null`);
      return null;
    }
  } catch (error) {
    console.error(`[TTS URL] Error generating audio:`, error);
    return null;
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
      currentActiveFlow,
      callSid
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
    const aiResponse = await processMessage(transcribedText, conversationHistory, businessId, currentActiveFlow, callSid)
    return {
      reply: aiResponse.reply,
      currentFlow: aiResponse.currentFlow,
      nextVoiceAction: aiResponse.nextVoiceAction
    }
  }
}



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
    const response = new VoiceResponse()
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
    
    // Debug: Log the generated TwiML
    const twimlString = response.toString()
    console.log('[VOICE STREAM] Generated TwiML:', twimlString)
    
    res.type('text/xml')
    res.send(twimlString)
    
    console.log('[VOICE STREAM] Successfully initiated media stream for CallSid:', callSid)
    
  } catch (error) {
    console.error('[VOICE STREAM] Error handling incoming call:', error)
    
    // Send error response
    const response = new VoiceResponse()
    response.say({ voice: 'alice' }, 'We are experiencing technical difficulties. Please try your call again later.')
    response.hangup()
    
    res.type('text/xml')
    res.send(response.toString())
  }
})

// POST /start-conversation - Handle initial greeting with high-quality OpenAI voice (Async)
router.post('/start-conversation', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[START CONVERSATION] Processing initial greeting for CallSid:', req.body.CallSid)
    
    const callSid = req.body.CallSid
    const toPhoneNumber = req.body.To
    const caller = req.body.From
    
    // Define the background greeting generation function
    const generateGreetingAndStart = async () => {
      try {
        console.log('[GREETING GENERATION] Starting background greeting generation for CallSid:', callSid)
        
        // Find business and agent config
        let business = null
        let agentConfig = null
        let welcomeMessage = 'Thank you for calling. How can I help you?'
        
        if (toPhoneNumber) {
          business = await prisma.business.findFirst({
            where: { twilioPhoneNumber: toPhoneNumber }
          })
          
          if (business) {
            console.log('[GREETING GENERATION] Found business:', business.name)
            
            agentConfig = await prisma.agentConfig.findUnique({
              where: { businessId: business.id }
            })
            
            // Determine welcome message
            if (agentConfig?.voiceGreetingMessage?.trim()) {
              welcomeMessage = agentConfig.voiceGreetingMessage
              console.log('[GREETING GENERATION] Using custom voice greeting')
            } else if (agentConfig?.welcomeMessage?.trim()) {
              welcomeMessage = agentConfig.welcomeMessage
              console.log('[GREETING GENERATION] Using general welcome message')
            }
            
            // Replace {businessName} template variable if present
            welcomeMessage = welcomeMessage.replace(/\{businessName\}/gi, business.name)
          }
        }
        
        // Initialize session with business info
        await updateSessionMetadata(callSid, {
          callerNumber: caller,
          twilioCallSid: callSid,
          businessId: business?.id,
          voiceSettings: {
            voice: 'alice', // Using hardcoded default since we've migrated to OpenAI for voice customization
            language: 'en-US'
          }
        })
        
        // Generate high-quality greeting audio
        const useOpenaiTts = agentConfig?.useOpenaiTts !== false
        const openaiVoice = (agentConfig?.openaiVoice as any) || 'nova'
        const openaiModel = (agentConfig?.openaiModel as 'tts-1' | 'tts-1-hd') || 'tts-1'
        
        console.log(`[GREETING GENERATION] Voice config - OpenAI TTS: ${useOpenaiTts}, Voice: ${openaiVoice}`)
        
        // Generate the audio URL for the high-quality OpenAI-generated welcome message
        const generatedAudioUrl = await generateAudioUrl(welcomeMessage, openaiVoice, useOpenaiTts, openaiModel)
        
        console.log('[GREETING GENERATION] Audio URL generated:', generatedAudioUrl)
        
                 // Use Twilio REST API client to update the live call
         try {
           const playAndGatherUrl = new URL(`${process.env.APP_PRIMARY_URL}/api/voice/play-and-gather`)
           if (generatedAudioUrl) {
             playAndGatherUrl.searchParams.append('audioUrl', generatedAudioUrl)
           }
           
           await twilioClient.calls(callSid).update({
             url: playAndGatherUrl.toString(),
             method: 'POST'
           })
           
           console.log('[GREETING GENERATION] Successfully updated live call to play greeting')
          
        } catch (updateError) {
          console.error('[GREETING GENERATION] Failed to update call, redirecting to error handler:', updateError)
          
          // Redirect the call to the error handler route
          await twilioClient.calls(callSid).update({
            url: `${process.env.APP_PRIMARY_URL}/api/voice/handle-error`,
            method: 'POST'
          })
        }
        
      } catch (error) {
        console.error('[GREETING GENERATION] Error in generateGreetingAndStart:', error)
        
        try {
          // Redirect the call to the error handler route
          await twilioClient.calls(callSid).update({
            url: `${process.env.APP_PRIMARY_URL}/api/voice/handle-error`,
            method: 'POST'
          })
        } catch (fallbackError) {
          console.error('[GREETING GENERATION] Failed to redirect to error handler:', fallbackError)
        }
      }
    }
    
    // Call generateGreetingAndStart() without await to let it run in the background
    generateGreetingAndStart().catch(error => {
      console.error('[START CONVERSATION] Unhandled error in greeting generation:', error)
    })
    
    // Immediately respond to Twilio with TwiML that plays a "hold" sound to keep the line open
    const twiml = new VoiceResponse()
    
    // Play a brief, pleasant "connecting" sound
    const connectingSoundUrl = `${process.env.APP_PRIMARY_URL}/sounds/thinking-sound-fx.mp3`
    twiml.play(connectingSoundUrl)
    
    // Add a brief pause for processing
    twiml.pause({ length: 3 })
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
    console.log('[START CONVERSATION] Sent hold response, greeting generation started in background')
    
  } catch (error) {
    console.error('[START CONVERSATION] Critical error:', error)
    
    // Simple fallback
    const twiml = new VoiceResponse()
    twiml.say({ voice: 'alice' }, 'Thank you for calling. How can I help you?')
    
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/handle-speech',
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 10
    })
    
    twiml.say({ voice: 'alice' }, 'Thank you for calling. Goodbye.')
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /deliver-greeting - Deliver the generated high-quality greeting
router.post('/deliver-greeting', customValidateTwilioRequest, async (req, res) => {
  try {
    const callSid = req.body.CallSid
    console.log('[DELIVER GREETING] Delivering greeting for CallSid:', callSid)
    
    // Retrieve greeting data
    const greetingData = backgroundProcessingResults.get(callSid)
    
    if (!greetingData) {
      console.error('[DELIVER GREETING] No greeting data found, using fallback')
      
      const twiml = new VoiceResponse()
      twiml.say({ voice: 'alice' }, 'Thank you for calling. How can I help you?')
      
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 10
      })
      
      twiml.say({ voice: 'alice' }, 'Thank you for calling. Goodbye.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Clean up after retrieval
    backgroundProcessingResults.delete(callSid)
    
    const twiml = new VoiceResponse()
    
    // Play the high-quality greeting
    if (greetingData.audioUrl) {
      console.log('[DELIVER GREETING] Playing OpenAI TTS greeting:', greetingData.audioUrl)
      twiml.play(greetingData.audioUrl)
    } else {
      console.log('[DELIVER GREETING] Using fallback TTS greeting')
      const greetingSSML = createSSMLMessage(greetingData.fallbackText || 'Thank you for calling. How can I help you?', {
        isGreeting: true,
        isConversational: true
      })
      twiml.say({ 
        voice: greetingData.voiceToUse as any || 'alice',
        language: greetingData.languageToUse as any || 'en-US'
      }, greetingSSML)
    }
    
    // Gather the user's first input
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/handle-speech',
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 10
    })
    
    // Fallback if no response
    twiml.say({ 
      voice: greetingData.voiceToUse as any || 'alice',
      language: greetingData.languageToUse as any || 'en-US'
    }, 'I didn\'t hear a response. Thank you for calling. Goodbye.')
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
    console.log('[DELIVER GREETING] Successfully delivered greeting')
    
  } catch (error) {
    console.error('[DELIVER GREETING] Error delivering greeting:', error)
    
    const twiml = new VoiceResponse()
    twiml.say({ voice: 'alice' }, 'Thank you for calling. How can I help you?')
    
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/handle-speech',
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 10
    })
    
    twiml.say({ voice: 'alice' }, 'Thank you for calling. Goodbye.')
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /handle-speech - Handle real-time speech input from Twilio Gather (Async Version)
router.post('/handle-speech', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[HANDLE SPEECH] Processing speech input for CallSid:', req.body.CallSid)
    
    const speechResult = req.body.SpeechResult
    const caller = req.body.From
    const twilioNumberCalled = req.body.To
    const callSid = req.body.CallSid
    
    // Handle empty or unclear speech result
    if (!speechResult || speechResult.trim() === '' || speechResult.trim().length < 3) {
      console.log('[HANDLE SPEECH] No speech detected or speech too short, giving second chance')
      
      const twiml = new VoiceResponse()
      const retryMessage = createSSMLMessage(
        "I'm sorry, I didn't catch that. Could you please speak a bit louder and tell me how I can help you today?",
        { isQuestion: true, isConversational: true }
      )
      twiml.say({ voice: 'alice', language: 'en-US' }, retryMessage)
      
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 12,
        hints: 'plumbing, water heater, emergency, repair, appointment, quote, estimate'
      })
      
      twiml.say({ voice: 'alice', language: 'en-US' }, 
        createSSMLMessage("Thank you for calling. Have a great day. Goodbye.", { isConversational: true })
      )
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }

    // Validate speech input quality 
    const potentialTranscriptionIssues = [
      'you are here',
      'your ear',
      'you air', 
      'hear here',
      'year here'
    ]
    
    const lowerSpeech = speechResult.toLowerCase().trim()
    const hasTranscriptionIssue = potentialTranscriptionIssues.some(issue => 
      lowerSpeech.includes(issue) && lowerSpeech.length < 20
    )
    
    if (hasTranscriptionIssue) {
      console.log('[HANDLE SPEECH] Potential transcription issue detected:', speechResult)
      
      const twiml = new VoiceResponse()
      const clarifyMessage = createSSMLMessage(
        "I want to make sure I understand you correctly. Could you please tell me specifically what you need help with today?",
        { isQuestion: true, isConversational: true }
      )
      twiml.say({ voice: 'alice', language: 'en-US' }, clarifyMessage)
      
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 12,
        hints: 'plumbing, water heater, emergency, repair, appointment, quote, estimate, drain, toilet, sink, pipe'
      })
      
      twiml.say({ voice: 'alice', language: 'en-US' }, 
        createSSMLMessage("Thank you for calling. Have a great day. Goodbye.", { isConversational: true })
      )
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }

    // Background AI processing function
    const processAiResponse = async () => {
      try {
        console.log('[AI PROCESSING] Starting AI processing for CallSid:', callSid)
        console.log('[AI PROCESSING] User said:', speechResult)
        
        // Find business by Twilio phone number
        const business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: twilioNumberCalled }
        })
        
        if (!business) {
          console.error('[AI PROCESSING] No business found for phone:', twilioNumberCalled)
          throw new Error('Business not found')
        }
        
        console.log('[AI PROCESSING] Found business:', business.name)
        
        // Get agent configuration
        const agentConfig = await prisma.agentConfig.findUnique({
          where: { businessId: business.id }
        }).catch(() => null)
        
        // Get conversation history
        const session = await getVoiceSession(callSid)
        const conversationHistory = [...session.history]
        
        // Add user message to history
        conversationHistory.push({ role: 'user', content: speechResult })
        
        // Process with AI handler
        console.log('[AI PROCESSING] Calling AI Handler for business:', business.id)
        const aiResponse = await processEnhancedMessage(
          speechResult,
          conversationHistory,
          business.id,
          session.currentFlow,
          callSid
        )
        
        console.log('[AI PROCESSING] AI response received:', aiResponse.reply)
        
        // Add AI response to history
        conversationHistory.push({ role: 'assistant', content: aiResponse.reply })
        
        // Save updated session state
        await updateVoiceSession(callSid, conversationHistory, aiResponse.currentFlow ?? null);
        console.log('[AI PROCESSING] Session state updated.');

        // Determine voice configuration from agentConfig
        const useOpenaiTts = agentConfig?.useOpenaiTts !== false;
        const openaiVoice = (agentConfig?.openaiVoice as any) || 'nova';
        const openaiModel = (agentConfig?.openaiModel as 'tts-1' | 'tts-1-hd') || 'tts-1';
        
        // Generate the audio URL for the AI's reply
        console.log('[AI PROCESSING] Generating audio for AI reply...');
        const audioUrl = await generateAudioUrl(
            aiResponse.reply, 
            openaiVoice,
            useOpenaiTts,
            openaiModel
        );

        if (!audioUrl) {
            throw new Error('Failed to generate audio URL for AI response.');
        }
        console.log('[AI PROCESSING] Audio URL generated:', audioUrl);

        // Prepare the URL for the TwiML to execute next
        const nextTwiMLUrl = new URL(`${process.env.APP_PRIMARY_URL}/api/voice/continue-conversation`);
        nextTwiMLUrl.searchParams.append('audioUrl', audioUrl);
        nextTwiMLUrl.searchParams.append('nextAction', aiResponse.nextVoiceAction || 'CONTINUE');

        // Use the Twilio REST API to redirect the live call to the new TwiML URL
        console.log(`[AI PROCESSING] Updating live call ${callSid} to redirect to: ${nextTwiMLUrl.toString()}`);
        try {
            await twilioClient.calls(callSid).update({
                url: nextTwiMLUrl.toString(),
                method: 'POST'
            });
            console.log(`[AI PROCESSING] Successfully updated live call ${callSid}.`);
        } catch (updateError) {
            console.error(`[AI PROCESSING] CRITICAL FAILURE: Could not update live call ${callSid}. Error:`, updateError);
            // If we can't update the call, we can't continue. The call will hang up.
        }
        
    } catch (error) {
       console.error('[AI PROCESSING] Error in background AI processing:', error);
       // Attempt a graceful recovery by redirecting the call to an error handler TwiML
       try {
         const errorTwiMLUrl = new URL(`${process.env.APP_PRIMARY_URL}/api/voice/handle-error`);
         await twilioClient.calls(callSid).update({ url: errorTwiMLUrl.toString(), method: 'POST' });
       } catch (recoveryError) {
         console.error(`[AI PROCESSING] Failed to redirect call to error handler:`, recoveryError);
       }
    }
}
    
    // Start background processing (non-blocking)
    processAiResponse().catch(error => {
      console.error('[HANDLE SPEECH] Unhandled error in background processing:', error)
    })
    
    // Respond immediately with thinking sound
    const twiml = new VoiceResponse()
    
    // Play a random thinking sound
    const thinkingSounds = [
      'thinking-sound-fx.mp3',
      'thinking-sound-fx-2.mp3', 
      'thinking-sound-fx-3.mp3',
      'thinking-sound-fx-4.mp3'
    ]
    const randomSound = thinkingSounds[Math.floor(Math.random() * thinkingSounds.length)]
    const thinkingSoundUrl = `${process.env.APP_PRIMARY_URL}/sounds/${randomSound}`
    
    console.log('[HANDLE SPEECH] Playing thinking sound:', thinkingSoundUrl)
    twiml.play(thinkingSoundUrl)
    
    // Add processing pause
    twiml.pause({ length: 8 })
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
    console.log('[HANDLE SPEECH] Sent immediate response, AI processing started')
    
  } catch (error) {
    console.error('[HANDLE SPEECH] Critical error:', error)
    
    // Graceful error recovery
    try {
      const twiml = new VoiceResponse()
      const recoveryMessage = generateRecoveryResponse()
      twiml.say({ voice: 'alice', language: 'en-US' }, 
        createSSMLMessage(recoveryMessage, { isConversational: true, addEmphasis: true })
      )
      
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 8
      })
      
      twiml.say({ voice: 'alice', language: 'en-US' }, 'Thank you for calling. Goodbye.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      
    } catch (fallbackError) {
      console.error('[HANDLE SPEECH] Fallback error handling failed:', fallbackError)
      
      // Last resort response
      res.setHeader('Content-Type', 'application/xml')
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">I'm sorry, there seems to be an issue. Please call back in a moment.</Say>
          <Hangup/>
        </Response>`)
    }
  }
})

// POST /play-and-gather - Play audio and gather user response
router.post('/play-and-gather', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[PLAY AND GATHER] Processing request for CallSid:', req.body.CallSid)
    
    // Get audioUrl from query parameters (since twilioClient.calls().update() can't pass body)
    const audioUrl = req.query.audioUrl as string
    
    if (!audioUrl) {
      console.error('[PLAY AND GATHER] No audioUrl provided in query parameters')
      return res.status(400).json({ error: 'audioUrl is required' })
    }
    
    console.log('[PLAY AND GATHER] Playing audio URL:', audioUrl)
    
    const twiml = new VoiceResponse()
    
    // Play the provided audio
    twiml.play(audioUrl)
    
    // Gather the user's response
    const gather = twiml.gather({
      input: ['speech'],
      action: '/api/voice/handle-speech',
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 10
    })
    
    // Fallback if no response
    twiml.say({ voice: 'alice', language: 'en-US' }, 
      createSSMLMessage("Thank you for calling. Have a great day. Goodbye.", { isConversational: true })
    )
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
    console.log('[PLAY AND GATHER] Successfully created TwiML response')
    
  } catch (error) {
    console.error('[PLAY AND GATHER] Error in /play-and-gather route:', error)
    
    // Fallback to error handler
    const twiml = new VoiceResponse()
    twiml.say({ voice: 'alice', language: 'en-US' }, 
      "I'm sorry, an application error occurred. Please try your call again later."
    )
    twiml.hangup()
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
  }
})

// POST /handle-error - Handle errors gracefully by providing user-friendly response
router.post('/handle-error', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[HANDLE ERROR] Processing error handler for CallSid:', req.body.CallSid)
    
    const twiml = new VoiceResponse()
    const errorMessage = createSSMLMessage(
      "I'm sorry, an application error occurred. Please try your call again later.",
      { isConversational: true, addEmphasis: true }
    )
    
    twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage)
    twiml.hangup()
    
    // Clear any existing session
    await clearVoiceSession(req.body.CallSid)
    
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
  } catch (error) {
    console.error('[HANDLE ERROR] Error in error handler:', error)
    
    // Last resort simple response
    res.setHeader('Content-Type', 'application/xml')
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice">I'm sorry, an application error occurred. Please try your call again later.</Say>
        <Hangup/>
      </Response>`)
  }
})

// POST /handle-voicemail-recording - Future endpoint for processing voicemail messages
router.post('/handle-voicemail-recording', customValidateTwilioRequest, async (req, res) => {
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

// POST /continue-conversation - Play AI response and continue conversation loop (Enhanced)
router.post('/continue-conversation', customValidateTwilioRequest, async (req, res) => {
  try {
    console.log('[CONTINUE CONVERSATION] Request received')
    
    // Extract CallSid from Twilio request
    const callSid = req.body.CallSid
    
    if (!callSid) {
      console.error('[CONTINUE CONVERSATION] No CallSid provided in request body')
      return res.status(400).json({ error: 'CallSid is required' })
    }
    
    console.log('[CONTINUE CONVERSATION] Processing for CallSid:', callSid)
    
    // Extract parameters from URL (new approach)
    const audioUrl = req.query.audioUrl as string
    const urlNextAction = (req.query.nextAction as string) || 'CONTINUE'
    
    console.log('[CONTINUE CONVERSATION] URL Parameters:', {
      hasAudioUrl: !!audioUrl,
      nextAction: urlNextAction,
      audioUrl: audioUrl ? audioUrl.substring(0, 50) + '...' : 'none'
    })
    
    // Fallback to background processing results if URL parameters not found
    let processingResult = null
    if (!audioUrl) {
      console.log('[CONTINUE CONVERSATION] No URL parameters, checking background processing results')
      processingResult = backgroundProcessingResults.get(callSid)
      
      if (processingResult) {
        console.log('[CONTINUE CONVERSATION] Found background processing result')
        backgroundProcessingResults.delete(callSid)
      }
    }
    
    if (!audioUrl && !processingResult) {
      console.error('[CONTINUE CONVERSATION] No audio URL or processing result found for CallSid:', callSid)
      // Send fallback response
      const twiml = new VoiceResponse()
      twiml.say({ voice: 'alice', language: 'en-US' }, 
        'I apologize, but I need to process your request again. Please repeat what you said.')
      
      const gather = twiml.gather({
        input: ['speech'],
        action: '/api/voice/handle-speech',
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 10
      })
      
      twiml.say({ voice: 'alice', language: 'en-US' }, 'Thank you for calling. Goodbye.')
      twiml.hangup()
      
      res.setHeader('Content-Type', 'application/xml')
      res.send(twiml.toString())
      return
    }
    
    // Create TwiML response
    const twiml = new VoiceResponse()
    
    // Determine which data source to use (URL parameters take precedence)
    const finalAudioUrl = audioUrl || (processingResult?.audioUrl)
    const finalNextAction = urlNextAction !== 'CONTINUE' ? urlNextAction : (processingResult?.nextAction || 'CONTINUE')
    
    console.log('[CONTINUE CONVERSATION] Final parameters:', {
      hasAudioUrl: !!finalAudioUrl,
      nextAction: finalNextAction,
      dataSource: audioUrl ? 'URL parameters' : 'background processing'
    })
    
    // Voice settings from processing result or defaults (only if using background processing)
    const voiceToUse = processingResult?.voiceToUse || 'alice'
    const languageToUse = processingResult?.languageToUse || 'en-US'
    const useOpenaiTts = processingResult?.useOpenaiTts !== false
    const openaiVoice = processingResult?.openaiVoice || 'nova'
    const openaiModel = (processingResult?.openaiModel || 'tts-1') as 'tts-1' | 'tts-1-hd'
    
    // Play the AI response
    if (finalAudioUrl) {
      console.log('[CONTINUE CONVERSATION] Playing AI-generated audio:', finalAudioUrl)
      twiml.play(finalAudioUrl)
    } else if (processingResult?.fallbackText) {
      console.log('[CONTINUE CONVERSATION] Using fallback text for TTS')
      await generateAndPlayTTS(
        processingResult.fallbackText,
        twiml,
        openaiVoice as any,
        voiceToUse,
        languageToUse,
        useOpenaiTts,
        openaiModel
      );
    } else {
      console.log('[CONTINUE CONVERSATION] No audio or fallback text, using default message')
      await generateAndPlayTTS(
        "I'm sorry, I encountered an issue. Let me try to help you differently.",
        twiml,
        'nova' as any,
        'alice',
        'en-US',
        true,
        'tts-1'
      );
    }
    
    // Handle next action
    console.log('[CONTINUE CONVERSATION] Next action:', finalNextAction)
    
    switch (finalNextAction) {
      case 'CONTINUE':
        // Continue conversation with another gather
        const continueGather = twiml.gather({
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
        twiml.say({ voice: voiceToUse as any, language: languageToUse as any }, continueMessage)
        twiml.hangup()
        break

      case 'HANGUP':
        // End the call gracefully
        twiml.hangup()
        if (processingResult?.shouldClearSession) {
          await clearVoiceSession(callSid)
          console.log('[CONTINUE CONVERSATION] Call ended with HANGUP action, session cleared for CallSid:', callSid)
        }
        break

      case 'TRANSFER':
        // TODO: Implement transfer logic
        await generateAndPlayTTS(
          "I apologize, but our transfer system isn't configured yet. Please call our main number directly for immediate assistance.",
          twiml,
          openaiVoice as any,
          voiceToUse,
          languageToUse,
          useOpenaiTts,
          openaiModel
        );
        twiml.hangup()
        if (processingResult?.shouldClearSession) {
          await clearVoiceSession(callSid)
        }
        break

      case 'VOICEMAIL':
        // TODO: Implement voicemail logic
        await generateAndPlayTTS(
          "Thank you for your message. Our team will review it and get back to you as soon as possible.",
          twiml,
          openaiVoice as any,
          voiceToUse,
          languageToUse,
          useOpenaiTts,
          openaiModel
        );
        twiml.hangup()
        if (processingResult?.shouldClearSession) {
          await clearVoiceSession(callSid)
        }
        break

      default:
        // Fallback to HANGUP
        twiml.hangup()
        if (processingResult?.shouldClearSession) {
          await clearVoiceSession(callSid)
        }
        break
    }
    
    // Send TwiML response
    res.setHeader('Content-Type', 'application/xml')
    res.send(twiml.toString())
    
    console.log('[CONTINUE CONVERSATION] Successfully sent TwiML response for action:', finalNextAction)
    
  } catch (error) {
    console.error('[CONTINUE CONVERSATION] Error in /continue-conversation route:', error)
    
    // Create fallback TwiML response
    const twiml = new VoiceResponse()
    const errorMessage = createSSMLMessage(
      'Sorry, we encountered an issue. Please try calling back in a moment.',
      { addEmphasis: true }
    )
    twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage)
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
    
    // Check OpenAI API status with timeout
    let openAIStatus = 'operational'
    let openAIError = null
    try {
      // Make a lightweight API call to check OpenAI availability with timeout
      const healthCheckTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('OpenAI API health check timeout')), 5000) // 5 second timeout
      })
      
      await Promise.race([
        openai.models.list(),
        healthCheckTimeout
      ])
      console.log('[Health Check] OpenAI API check successful')
    } catch (error) {
      openAIStatus = 'degraded'
      openAIError = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Health Check] OpenAI API check failed:', error)
    }
    
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
      dependencies: {
        openAI: {
          status: openAIStatus,
          ...(openAIError && { error: openAIError })
        }
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
        redisConfigured: !!process.env.REDIS_URL,
        openaiConfigured: !!process.env.OPENAI_API_KEY
      }
    }
    
    // Check if memory usage is high or dependencies are degraded
    if (formatBytes(memoryUsage.heapUsed) > MAX_MEMORY_USAGE_MB) {
      healthData.status = 'warning'
    }
    
    // Update overall status based on dependency health
    if (openAIStatus === 'degraded') {
      healthData.status = healthData.status === 'warning' ? 'warning' : 'degraded'
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