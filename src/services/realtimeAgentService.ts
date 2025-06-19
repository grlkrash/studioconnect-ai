import { WebSocket } from 'ws';
import twilio from 'twilio';
import { PrismaClient, LeadPriority } from '@prisma/client';
import { processMessage } from '../core/aiHandler';
import { getChatCompletion } from '../services/openai';
import { cleanVoiceResponse } from '../utils/voiceHelpers';
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from './notificationService';
import OpenAI from 'openai';
import { generateSpeechFromText, getTranscription } from './openai';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getBusinessWelcomeMessage } from './businessService';
import { getClientByPhoneNumber } from './clientService';
import crypto from 'crypto';
import { normalizePhoneNumber } from '../utils/phoneHelpers';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { OpenAIRealtimeClient } from './openaiRealtimeClient';
import { createVoiceSystemPrompt } from '../core/aiHandler';
import { LeadQualifier } from '../core/leadQualifier';
import { getPrimaryUrl } from '../utils/env';
import { ElevenLabsStreamingClient } from './elevenlabsStreamingClient'

const prisma = new PrismaClient();
const openai = new OpenAI();
const execFileAsync = promisify(execFile);

// Prisma enums are emitted as string union types, so we'll use string literals for values

// Initialize Twilio REST client for fetching call details
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface ConnectionState {
  ws: WebSocket;
  isTwilioReady: boolean;
  isAiReady: boolean;
  streamSid: string | null;
  audioQueue: string[];
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }>;
  businessId: string | null;
  leadCaptureTriggered: boolean;
  hasCollectedLeadInfo: boolean;
  isCallActive: boolean;
  welcomeMessageDelivered: boolean;
  welcomeMessageAttempts: number;
  isCleaningUp: boolean;
  callSid: string | null;
  lastActivity: number;
  fromNumber: string | null;
  toNumber: string | null;
  clientId?: string;
  currentFlow: string | null;
  ttsProvider: 'openai' | 'polly' | 'realtime' | 'elevenlabs';
  openaiVoice: string;
  openaiModel: string;
  personaPrompt?: string;
  lastSpeechMs: number;
  vadCalibrated: boolean;
  vadSamples: number;
  vadNoiseFloor: number;
  vadThreshold: number;
  /** Indicates we have received at least one non-empty user transcript this turn */
  hasUserTranscript: boolean;
  /** Indicates that we are currently recording an utterance */
  isRecording: boolean;
  isProcessing: boolean;
  __configLoaded?: boolean;
  openaiClient?: OpenAIRealtimeClient;
  isSpeaking: boolean;
  pendingAudioGeneration: boolean;
  /** internal idle follow-up prompt counter */
  idlePromptCount?: number;
  idlePromptTimer?: NodeJS.Timeout | null;
  callStartTime?: number;
  /** true if current recording chunk is linear16 */
  isLinear16Recording?: boolean;
  /** lead qualification */
  leadQualifier?: LeadQualifier
  qualAnswers?: Record<string, string>
  currentMissingQuestionId?: string;
  qualQuestionMap?: Record<string, { questionText: string; mapsToLeadField?: string }>
  sttClient?: ElevenLabsStreamingClient;
}

interface AgentSession {
  ws: WebSocket;
  businessId: string;
  conversationId: string;
  isActive: boolean;
  lastActivity: Date;
}

interface Question {
  questionText: string;
  order: number;
}

interface TwilioMedia {
  payload?: string;
  event?: string;
  streamSid?: string;
}

// Types
interface AgentState {
  callSid: string;
  businessId: string;
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }>;
  currentFlow: string | null;
  isProcessing: boolean;
  lastActivity: number;
  metadata: {
    callerNumber: string;
    twilioCallSid: string;
    voiceSettings: {
      voice: string;
      language: string;
    };
  };
}

interface AgentConfig {
  useOpenaiTts: boolean;
  openaiVoice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
  openaiModel: 'tts-1' | 'tts-1-hd';
  welcomeMessage: string;
  voiceGreetingMessage: string;
}

// Constants
const MAX_CONVERSATION_HISTORY = 50;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_MEMORY_USAGE_MB = 1536; // 75% of 2GB RAM
const VAD_THRESHOLD = 25; // Increased µ-law sample energy threshold
const VAD_SILENCE_MS = 2000; // flush after 2 s of silence for natural pauses
const IDLE_PROMPT_DELAYS_MS: [number, number] = [20000, 35000]

// State management
const activeAgents = new Map<string, ConnectionState>();
let cleanupInterval: NodeJS.Timeout;

// -----------------------------------
//  Voice-config cache (per business)
// -----------------------------------
type VoiceConfigCacheEntry = {
  ttsProvider: 'openai' | 'polly' | 'realtime' | 'elevenlabs'
  openaiVoice: string
  openaiModel: string
  personaPrompt?: string
  cachedAt: number
}

// In-memory cache; TTL keeps things fresh across config edits while preventing DB spam during a call
const VOICE_CFG_TTL_MS = 10 * 60 * 1000 // 10 minutes
const voiceConfigCache = new Map<string, VoiceConfigCacheEntry>()

// --- New: cache to remember realtime failures per business ---
const REALTIME_FAILURE_CACHE = new Map<string, number>()
const REALTIME_FAILURE_TTL_MS = 30 * 60 * 1000 // 30 minutes

// Helper to check if realtime is temporarily disabled for a business
function isRealtimeTemporarilyDisabled(businessId: string): boolean {
  const ts = REALTIME_FAILURE_CACHE.get(businessId)
  if (!ts) return false
  return (Date.now() - ts) < REALTIME_FAILURE_TTL_MS
}

function markRealtimeFailure(businessId: string): void {
  REALTIME_FAILURE_CACHE.set(businessId, Date.now())
}

// Initialize cleanup interval
function startCleanupInterval(): void {
  if (cleanupInterval) clearInterval(cleanupInterval);
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [callSid, state] of activeAgents.entries()) {
      if (now - state.lastActivity > SESSION_TIMEOUT_MS) {
        activeAgents.delete(callSid);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[Agent Cleanup] Removed ${cleanedCount} inactive sessions`);
    }
    
    // Memory check
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > MAX_MEMORY_USAGE_MB) {
      console.warn(`[Memory Alert] High memory usage: ${heapUsedMB}MB > ${MAX_MEMORY_USAGE_MB}MB threshold`);
    }
  }, CLEANUP_INTERVAL_MS);
}

// Start cleanup on module load
startCleanupInterval();

// Helper functions
function logMemoryUsage(context: string): void {
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number): number => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  console.log(`[Memory ${context}] RSS: ${formatBytes(usage.rss)}MB, Heap Used: ${formatBytes(usage.heapUsed)}MB`);
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    // Do not delete shared cache files
    if (filePath.includes('scai_tts_cache')) return
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`[File Cleanup] Deleted temp file: ${filePath}`);
    }
  } catch (error) {
    console.error(`[File Cleanup] Error deleting temp file ${filePath}:`, error);
  }
}

/**
 * RealtimeAgentService - Two-way audio bridge between Twilio and OpenAI
 * Handles real-time bidirectional voice conversations with lead capture integration
 */
class RealtimeAgentService {
  private static instance: RealtimeAgentService;
  private connections: Map<string, ConnectionState>;
  private twilioClient: twilio.Twilio;
  private callSid: string | null = null;
  private onCallSidReceived?: (callSid: string) => void;
  private connectToOpenAI?: () => void;

  private constructor() {
    this.connections = new Map();
    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  public static getInstance(): RealtimeAgentService {
    if (!RealtimeAgentService.instance) {
      RealtimeAgentService.instance = new RealtimeAgentService();
    }
    return RealtimeAgentService.instance;
  }

  public getCallSid(): string | null {
    return this.callSid;
  }

  public async handleNewConnection(ws: WebSocket, params: URLSearchParams): Promise<void> {
    const callSid = params.get('callSid');
    const businessId = params.get('businessId');
    const fromNumber = params.get('fromPhoneNumber');

    // Allow connections even if callSid or businessId is missing – they can be
    // derived from the Twilio START event that follows the websocket upgrade.
    if (!callSid || !businessId) {
      console.warn('[REALTIME AGENT] Missing callSid or businessId in WebSocket URL – will derive from START event', {
        callSid,
        businessId
      })
    }

    // Twilio sometimes omits the query string when establishing the WebSocket – do *not* close
    // the connection here. We rely on the subsequent START event to provide the definitive
    // CallSid and will derive the business context at that point.

    this.callSid = callSid;
    console.log(`[REALTIME AGENT] New connection for call ${callSid} to business ${businessId}`);

    // Initialize connection state
    const state: ConnectionState = {
      ws,
      callSid,
      businessId,
      fromNumber: fromNumber || null,
      conversationHistory: [],
      currentFlow: null,
      isTwilioReady: false,
      isAiReady: false,
      streamSid: null,
      audioQueue: [],
      leadCaptureTriggered: false,
      hasCollectedLeadInfo: false,
      isCallActive: false,
      welcomeMessageDelivered: false,
      welcomeMessageAttempts: 0,
      isCleaningUp: false,
      lastActivity: Date.now(),
      toNumber: null,
      ttsProvider: 'elevenlabs',
      openaiVoice: (process.env.ELEVENLABS_VOICE_ID || 'josh').toLowerCase(),
      openaiModel: 'tts-1',
      personaPrompt: undefined,
      lastSpeechMs: Date.now(),
      vadCalibrated: false,
      vadSamples: 0,
      vadNoiseFloor: 0,
      vadThreshold: 25,
      /** start with no active recording */
      isRecording: false,
      isProcessing: false,
      __configLoaded: false,
      openaiClient: undefined,
      isSpeaking: false,
      pendingAudioGeneration: false,
      idlePromptCount: 0,
      idlePromptTimer: null,
      callStartTime: Date.now(),
      hasUserTranscript: false
    };

    // Try to identify client if phone number is available
    if (fromNumber) {
      try {
        const client = await getClientByPhoneNumber(fromNumber);
        if (client) {
          state.clientId = client.id;
          console.log(`[REALTIME AGENT] Identified client ${client.id} for call ${callSid}`);
        }
      } catch (error) {
        console.error(`[REALTIME AGENT] Error identifying client:`, error);
      }
    }

    const connectionKey = callSid ?? crypto.randomUUID();
    this.connections.set(connectionKey, state);

    // Register lifecycle listeners for this WebSocket so we can clean up if the
    // client disconnects before the START event arrives.
    this.setupWebSocketListeners(state);

    // Send a welcome message and log the call only when we already have the essential identifiers
    // (typically available for outbound calls or local tests).  For inbound calls we wait until the
    // first START event provides the details.
    if (callSid && businessId) {
      try {
        if (!state.welcomeMessageDelivered) {
          const welcomeMessage = await this.getWelcomeMessage(state)
          await this.streamTTS(state, welcomeMessage)
          state.welcomeMessageDelivered = true
        }
      } catch (error) {
        console.error('[REALTIME AGENT] Error sending welcome message:', error)
        if (!state.welcomeMessageDelivered) {
          await this.streamTTS(state, 'Welcome to StudioConnect AI. How can I help you today?')
          state.welcomeMessageDelivered = true
        }
      }

      await prisma.callLog.create({
        data: {
          businessId,
          conversationId: crypto.randomUUID(),
          callSid,
          from: fromNumber ?? '',
          to: '',
          direction: 'INBOUND',
          type: 'VOICE',
          status: 'INITIATED',
          source: 'TWILIO'
        }
      })
    }

    // -----------------------------
    // OpenAI Realtime Voice Session
    // -----------------------------
    // We will now initialize the OpenAI client only in `handleStartEvent` once we
    // have the full business context, preventing race conditions and multiple
    // client instances.

    // ---- Idle follow-up scheduler (first at 2 s, then every 8 s, max 3) ----
    this._scheduleIdlePrompt(state)
  }

  private async getWelcomeMessage(state: ConnectionState): Promise<string> {
    if (!state.businessId) {
      return 'Welcome to StudioConnect AI. How can I help you today?';
    }

    try {
      const welcomeMessage = await getBusinessWelcomeMessage(state.businessId);
      if (state.clientId) {
        return `Welcome back! ${welcomeMessage}`;
      }
      return welcomeMessage;
    } catch (error) {
      console.error(`[REALTIME AGENT] Error getting welcome message:`, error);
      return 'Welcome to StudioConnect AI. How can I help you today?';
    }
  }

  private setupTwilioListeners(state: ConnectionState): void {
    const { callSid, businessId } = state;

    if (!callSid || !businessId) {
      console.error('[REALTIME AGENT] Missing required state:', { callSid, businessId });
      return;
    }

    // The Node Twilio helper library does not emit 'start'/'media' events – those are only sent
    // over the WebSocket stream.  We keep this method for future expansions (e.g. call status
    // callbacks) but no longer attempt to attach stream listeners here.
  }

  private setupWebSocketListeners(state: ConnectionState): void {
    const { ws, callSid } = state;

    if (!callSid) {
      console.error('[REALTIME AGENT] Missing callSid in state');
      return;
    }

    ws.on('close', () => {
      console.log(`[REALTIME AGENT] WebSocket closed for call ${callSid}`);
      this.cleanup(callSid);
    });

    ws.on('error', (error) => {
      console.error(`[REALTIME AGENT] WebSocket error for call ${callSid}:`, error);
      this.cleanup(callSid);
    });
  }

  public async cleanup(reason: string): Promise<void> {
    if (this.callSid) {
      const state = this.connections.get(this.callSid);
      if (state) {
        // ---- update callLog with duration / status ----
        const durationMs = Date.now() - (state.callStartTime || Date.now())
        const status = durationMs < 15000 ? 'ERROR' : 'COMPLETED'

        if (state.callSid) {
          await prisma.callLog.update({ where: { callSid: state.callSid }, data: { updatedAt: new Date(), metadata: { endReason: status } } } as any).catch(() => {})
        }

        // ---- send call summary email ----
        if (state.businessId) {
          try {
            const biz = await prisma.business.findUnique({ where: { id: state.businessId }, select: { id: true, name: true, notificationEmails: true, notificationPhoneNumber: true } })
            if (biz?.notificationEmails && biz.notificationEmails.length) {
              const transcriptText = state.conversationHistory
                .map((m) => `${m.role === 'user' ? 'Client' : 'Agent'}: ${m.content}`)
                .join('\n')

              const { sendCallSummaryEmail } = await import('./notificationService')
              await sendCallSummaryEmail(biz.notificationEmails, {
                businessName: biz.name,
                caller: state.fromNumber || 'Unknown',
                callee: state.toNumber || undefined,
                durationSec: Math.round(durationMs / 1000),
                transcript: transcriptText,
              })
            }
          } catch (err) {
            console.error('[REALTIME AGENT] Failed to send call summary email', err)
          }
        }

        try {
          state.ws.close();
        } catch (error) {
          console.error(`[REALTIME AGENT] Error closing WebSocket:`, error);
        }

        // Gracefully close realtime voice session
        if (state.openaiClient) {
          try { state.openaiClient.close() } catch {}
        }
        this.connections.delete(this.callSid);
        console.log(`[REALTIME AGENT] Cleaned up connection for call ${this.callSid}: ${reason}`);
      }
    }
    this.callSid = null;
  }

  /**
   * Sends a TTS message to the caller **without** terminating the existing media stream.
   * The strategy is:
   * 1.  Issue a `Call.update()` with TwiML that first <Say>s the message.
   * 2.  Immediately after the <Say>, we <Connect><Stream> back to **the same** WebSocket
   *     endpoint so Twilio re-establishes the media stream once playback is finished.
   * 3.  We keep a long <Pause> at the end of the TwiML so the call remains open for
   *     additional interactions.
   *
   * This avoids the premature hang-ups the user experienced where updating TwiML with only
   * a <Say> caused Twilio to drop the stream (and therefore the call) once playback ended.
   */
  private sendTwilioMessage(state: ConnectionState, message: string): void {
    const { callSid, businessId } = state

    if (!callSid) {
      console.error('[REALTIME AGENT] Attempted to send Twilio message without CallSid')
      return
    }

    try {
      // Build the WebSocket URL that Twilio should reconnect to after speaking
      const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
      const host = base.replace(/\/$/, '') || `https://${process.env.HOST || 'localhost'}`
      const wsBase = host.replace(/^https?:\/\//, 'wss://')
      const wsUrl = `${wsBase}/?callSid=${encodeURIComponent(callSid)}${businessId ? `&businessId=${encodeURIComponent(businessId)}` : ''}`

      const twiml = new twilio.twiml.VoiceResponse()

      // Use a higher-quality Amazon Polly voice for a more natural sound
      twiml.say({ voice: 'Polly.Amy', language: 'en-US' }, message)

      const connect = twiml.connect()
      const stream = connect.stream({ url: wsUrl })
      stream.parameter({ name: 'callSid', value: callSid })
      if (businessId) {
        stream.parameter({ name: 'businessId', value: businessId })
      }

      // Keep the call alive for up to 4 hours
      twiml.pause({ length: 14400 })

      this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
    } catch (error) {
      console.error('[REALTIME AGENT] Error sending Twilio message:', error)
    }
  }

  private async streamTTS(state: ConnectionState, text: string): Promise<void> {
    if (!state.streamSid) {
      console.warn('[REALTIME AGENT] No streamSid available, cannot stream audio yet')
      return
    }

    if (state.isSpeaking || state.pendingAudioGeneration) {
      console.warn('[REALTIME AGENT] Already generating/playing audio, skipping TTS request')
      return
    }

    // Validate text input
    if (!text || text.trim().length === 0) {
      console.warn('[REALTIME AGENT] Empty text provided, skipping TTS')
      return
    }

    state.pendingAudioGeneration = true

    try {
      /**
       * Load the Agent-level voice configuration with bulletproof error handling
       */
      if (state.businessId && !state.__configLoaded) {
        try {
          const cfg = await prisma.agentConfig.findUnique({
            where: { businessId: state.businessId },
            select: {
              useOpenaiTts: true,
              openaiVoice: true,
              openaiModel: true,
              personaPrompt: true,
              ttsProvider: true,
            },
          })

          if (cfg) {
            const provider = (cfg as any).ttsProvider
            if (provider && ['openai', 'polly', 'realtime', 'elevenlabs'].includes(provider)) {
              state.ttsProvider = provider
            } else if (cfg.useOpenaiTts !== undefined) {
              state.ttsProvider = cfg.useOpenaiTts ? 'openai' : 'polly'
            }
            
            // Default to ElevenLabs for premium quality
            if (!state.ttsProvider) state.ttsProvider = 'elevenlabs'
            
            state.openaiVoice = (cfg.openaiVoice || 'NOVA').toLowerCase()
            state.openaiModel = cfg.openaiModel || 'tts-1-hd' // Use HD model for better quality
            state.personaPrompt = cfg.personaPrompt
            
            console.log(`[REALTIME AGENT] Voice config loaded: ${state.ttsProvider} with voice ${state.openaiVoice}`)
          }
        } catch (err) {
          console.error('[REALTIME AGENT] Failed to load agentConfig – using high-quality defaults:', (err as Error).message)
          state.ttsProvider = 'openai'
          state.openaiVoice = 'nova'
          state.openaiModel = 'tts-1-hd'
        } finally {
          state.__configLoaded = true
        }
      }

      // If realtime client is active and working, use it exclusively
      if (state.openaiClient && state.ttsProvider === 'realtime') {
        try {
          console.log(`[REALTIME AGENT] Using realtime client for: ${text.substring(0, 50)}...`)
          this.addToConversationHistory(state, 'user', text)
          state.openaiClient.sendUserText(text)
          state.openaiClient.requestAssistantResponse()
          return
        } catch (error) {
          console.error('[REALTIME AGENT] Realtime client failed, falling back to TTS:', error)
          // Fall through to TTS generation
          state.ttsProvider = 'openai'
          state.openaiClient = undefined
        }
      }

      // --- Provider-specific voice validation ---
      if (state.ttsProvider === 'elevenlabs') {
        // ElevenLabs expects a valid voice ID (usually a UUID). If the configured voice
        // does not resemble an ID, fall back to the default voice or env-configured ID.
        const voiceLooksValid = /^[a-f0-9]{20,}$/i.test(state.openaiVoice)
        if (!voiceLooksValid) {
          const fallbackVoice = (process.env.ELEVENLABS_VOICE_ID || 'Rachel').toLowerCase()
          console.warn(`[REALTIME AGENT] Invalid ElevenLabs voice "${state.openaiVoice}", using fallback "${fallbackVoice}"`)
          state.openaiVoice = fallbackVoice
        }
      }

      // Generate high-quality TTS audio (with automatic provider fallback)
      console.log(`[REALTIME AGENT] Generating TTS with ${state.ttsProvider} for: ${text.substring(0, 50)}...`)

      const modelForProvider = state.ttsProvider === 'elevenlabs'
        ? (process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v2')
        : state.openaiModel

      let mp3Path = await generateSpeechFromText(
        text,
        state.openaiVoice,
        modelForProvider as any,
        state.ttsProvider as 'openai' | 'polly' | 'elevenlabs'
      )

      // --- Automatic multi-provider fallback chain ---
      if (!mp3Path) {
        console.warn(`[REALTIME AGENT] ${state.ttsProvider} TTS failed – attempting fallbacks`) 

        // 1️⃣  Fallback to OpenAI TTS (premium quality)
        if (state.ttsProvider !== 'openai') {
          try {
            mp3Path = await generateSpeechFromText(text, 'nova', 'tts-1-hd', 'openai')
            if (mp3Path) {
              state.ttsProvider = 'openai'
              state.openaiVoice = 'nova'
              state.openaiModel = 'tts-1-hd'
              console.log('[REALTIME AGENT] Successfully fell back to OpenAI TTS')
            }
          } catch { /* ignore */ }
        }

        // 2️⃣  Fallback to Amazon Polly if OpenAI also fails
        if (!mp3Path && state.ttsProvider !== 'polly') {
          try {
            mp3Path = await generateSpeechFromText(text, 'Amy', 'tts-1', 'polly')
            if (mp3Path) {
              state.ttsProvider = 'polly'
              state.openaiVoice = 'Amy'
              state.openaiModel = 'tts-1'
              console.log('[REALTIME AGENT] Successfully fell back to Amazon Polly')
            }
          } catch { /* ignore */ }
        }

        if (!mp3Path) {
          console.error('[REALTIME AGENT] All TTS providers failed – aborting speech for this turn')
          return
        }
      }

      // Mark as speaking before streaming
      state.isSpeaking = true

      const ulawPath = path.join(os.tmpdir(), `${path.basename(mp3Path, path.extname(mp3Path))}.ulaw`)

      // Convert MP3 to 8kHz mono µ-law with optimized settings
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-i', mp3Path,
        '-ar', '8000',
        '-ac', '1',
        '-f', 'mulaw',
        '-af', 'volume=0.8', // Slightly reduce volume for clarity
        ulawPath
      ])

      const ulawBuffer = await fs.promises.readFile(ulawPath)
      const CHUNK_SIZE = 320 // 40ms of audio at 8kHz µ-law

      // Stream audio in real-time with proper pacing
      for (let offset = 0; offset < ulawBuffer.length; offset += CHUNK_SIZE) {
        const chunk = ulawBuffer.subarray(offset, offset + CHUNK_SIZE)
        const payload = chunk.toString('base64')
        
        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.ws.send(JSON.stringify({
            event: 'media',
            streamSid: state.streamSid,
            media: { payload }
          }))
        } else {
          console.warn('[REALTIME AGENT] WebSocket not ready, stopping audio stream')
          break
        }
        
        // Precise timing for natural speech
        await new Promise((resolve) => setTimeout(resolve, 40))
      }

      // Signal end of message
      if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
        state.ws.send(JSON.stringify({ 
          event: 'mark', 
          streamSid: state.streamSid, 
          mark: { name: 'speech_complete' } 
        }))
      }

      console.log('[REALTIME AGENT] TTS streaming completed successfully')

      // Clean up temp files
      await cleanupTempFile(mp3Path)
      await cleanupTempFile(ulawPath)

    } catch (error) {
      console.error('[REALTIME AGENT] Critical error in TTS streaming:', error)
      
      // Attempt emergency fallback with simple message
      try {
        const fallbackText = "I apologize, I'm having some technical difficulties. Let me try again."
        const emergencyMp3 = await generateSpeechFromText(fallbackText, 'nova', 'tts-1', 'openai')
        if (emergencyMp3) {
          // Simple emergency playback without conversion
          const buffer = await fs.promises.readFile(emergencyMp3)
          // Send as base64 - Twilio can handle MP3
          const payload = buffer.toString('base64')
          if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
            state.ws.send(JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload }
            }))
          }
          await cleanupTempFile(emergencyMp3)
        }
      } catch (emergencyError) {
        console.error('[REALTIME AGENT] Emergency fallback also failed:', emergencyError)
      }
    } finally {
      // Always reset state flags
      state.isSpeaking = false
      state.pendingAudioGeneration = false
    }
  }

  private async flushAudioQueue(state: ConnectionState): Promise<void> {
    if (state.audioQueue.length === 0) {
      state.isProcessing = false
      return
    }

    const audioToProcess = [...state.audioQueue]
    state.audioQueue = []
    state.isRecording = false

    let rawPath: string | null = null
    let wavPath: string | null = null

    try {
      console.log(`[REALTIME AGENT] Processing ${audioToProcess.length} audio chunks for transcription`)

      const rawBuffers = audioToProcess.map((b64) => Buffer.from(b64, 'base64'))
      const isLinear16 = state.isLinear16Recording ?? false
      const rawData = Buffer.concat(rawBuffers)

      // Enhanced duration check for professional quality
      const MIN_DURATION_MS = 300 // Increased minimum for better accuracy
      const bytesPerMs = isLinear16 ? 32 : 8 // adjust for codec
      const durationMs = rawData.length / bytesPerMs

      if (durationMs < MIN_DURATION_MS) {
        console.log(`[REALTIME AGENT] Audio too short (${durationMs.toFixed(0)}ms), skipping transcription`)
        return
      }

      console.log(`[REALTIME AGENT] Processing ${durationMs.toFixed(0)}ms of audio`)

      const baseName = `${state.callSid || 'unknown'}_${Date.now()}`
      rawPath = path.join(os.tmpdir(), `${baseName}.ulaw`)
      wavPath = path.join(os.tmpdir(), `${baseName}.wav`)

      await fs.promises.writeFile(rawPath, rawData)

      // Enhanced audio conversion with noise reduction
      const inputFormat = isLinear16 ? 's16le' : 'mulaw'
      const inputRate = isLinear16 ? '16000' : '8000'
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-f', inputFormat,
        '-ar', inputRate,
        '-ac', '1',
        '-i', rawPath,
        '-af', 'highpass=f=80,lowpass=f=3400,volume=1.2',
        '-ar', '16000',
        wavPath
      ])

      console.log('[REALTIME AGENT] Starting professional transcription...')
      const transcriptRaw = await getTranscription(wavPath)

      if (!transcriptRaw || transcriptRaw.trim().length === 0) {
        console.log('[REALTIME AGENT] No transcription received')
        return
      }

      const transcript = transcriptRaw.trim()
      console.log(`[REALTIME AGENT] Transcription: "${transcript}"`)

      // -------------------- Deterministic Lead Qualification --------------------
      if (state.leadQualifier) {
        try {
          // Store answer for previous question
          if (state.currentMissingQuestionId) {
            state.qualAnswers = state.qualAnswers || {}
            state.qualAnswers[state.currentMissingQuestionId] = transcript
          }

          const { nextPrompt, finished, missingKey } = state.leadQualifier.getNextPrompt(state.qualAnswers!)

          if (!finished) {
            // Ask next question
            state.currentMissingQuestionId = missingKey
            if (nextPrompt) await this.streamTTS(state, nextPrompt)
            // Reset flags for next utterance
            state.isProcessing = false
            return
          } else {
            // Lead qualification complete -> create lead record and proceed to AI flow
            try {
              const capturedData: any = {}
              let contactName: string | undefined
              let contactEmail: string | undefined
              let contactPhone: string | undefined
              let address: string | undefined
              let notes: string | undefined

              Object.entries(state.qualAnswers || {}).forEach(([qid, answer]) => {
                const meta = state.qualQuestionMap?.[qid]
                if (!meta) return
                capturedData[meta.questionText] = answer
                switch ((meta.mapsToLeadField || '').toLowerCase()) {
                  case 'contactname':
                  case 'name':
                    contactName = answer
                    break
                  case 'contactemail':
                  case 'email':
                    contactEmail = answer
                    break
                  case 'contactphone':
                  case 'phone':
                    contactPhone = answer
                    break
                  case 'address':
                    address = answer
                    break
                  case 'notes':
                  case 'description':
                    notes = answer
                    break
                  default:
                    break
                }
              })

              // Determine priority – mark URGENT if any answer contains keywords or an explicit emergency question exists
              let leadPriority: LeadPriority = 'NORMAL'
              const emergencyKeywords = /(urgent|emergency|asap|immediately|right away|straight away|crisis)/i
              const answersConcat = Object.values(capturedData).join(' ').toLowerCase()
              if (emergencyKeywords.test(answersConcat)) {
                leadPriority = 'URGENT'
              }

              const newLead = await prisma.lead.create({
                data: {
                  businessId: state.businessId!,
                  capturedData,
                  conversationTranscript: JSON.stringify(state.conversationHistory),
                  contactEmail,
                  contactPhone,
                  contactName,
                  address,
                  notes,
                  priority: leadPriority,
                },
              })

              // Notification email
              const biz = await prisma.business.findUnique({
                where: { id: state.businessId! },
                select: { id: true, name: true, notificationEmails: true, notificationPhoneNumber: true },
              })

              if (biz?.notificationEmails?.length) {
                await sendLeadNotificationEmail(biz.notificationEmails as any, newLead, leadPriority, biz.name)
              }

              // Trigger emergency voice alert if URGENT and phone configured
              if (leadPriority === 'URGENT' && biz && biz.notificationEmails?.length) {
                if (biz.notificationPhoneNumber) {
                  const summary = `${contactName || 'Unknown'} – ${notes?.slice(0, 120) || 'urgent request'}`
                  initiateEmergencyVoiceCall(biz.notificationPhoneNumber, biz.name, summary, biz.id).catch(() => {})
                }
              }

              await this.streamTTS(state, 'Thanks for those details! Someone from our team will reach out shortly. How else can I assist you today?')
            } catch (err) {
              console.error('[REALTIME AGENT] Failed to process lead qualification completion:', err)
            }

            // Clear qualifier and continue normal flow
            state.leadQualifier = undefined
            state.currentMissingQuestionId = undefined
            state.currentFlow = null
            // Continue to AI processing if user said something else
          }
        } catch (err) {
          console.error('[REALTIME AGENT] Lead qualification error:', err)
        }
      }

      // Enhanced validation for professional business conversations
      const txt = transcript.toLowerCase().trim()
      const words = txt.split(/\s+/).filter(w => w.length > 0)
      
      // Creative agency & professional business conversation patterns
      const validSingleWords = [
        // Basic responses
        'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'hello', 'hi', 
        'great', 'perfect', 'correct', 'right', 'help', 'urgent', 'rush',
        // Business terms
        'project', 'status', 'update', 'billing', 'invoice', 'payment',
        'deadline', 'timeline', 'budget', 'quote', 'estimate', 'contract',
        // Creative industry terms
        'design', 'branding', 'website', 'logo', 'identity', 'marketing',
        'creative', 'concept', 'mockup', 'prototype', 'wireframe', 'layout',
        'animation', 'video', 'motion', 'graphics', 'illustration', 'photography',
        // Packaging & print
        'packaging', 'print', 'brochure', 'catalog', 'poster', 'signage',
        'storyboard', 'boards', 'presentation', 'pitch', 'proposal',
        // Project management terms
        'kickoff', 'launch', 'delivery', 'revision', 'feedback', 'approval',
        'milestone', 'phase', 'iteration', 'round', 'final', 'proofs',
        // Client communication
        'meeting', 'call', 'email', 'follow', 'followup', 'discuss',
        'review', 'changes', 'edits', 'tweaks', 'adjustments'
      ]
      
      const validPhrases = txt.match(/\b(thank you|go ahead|not yet|right now|of course|sounds good|that works|makes sense|got it|i see|no problem|sounds great|kickoff call|project status|design review|final approval|first round|second round|third round|next phase|brand identity|motion graphics|print ready|web ready|high res|low res|vector file|raster file|pdf proof|color proof|press ready)\b/)
      
      // Creative industry & business-focused validation
      const isValid = words.length > 1 || 
                     validSingleWords.includes(txt) || 
                     validPhrases ||
                     txt.match(/\b(brand|creative|design|digital|web|print|logo|identity|package|motion|video|graphics|illustration|photo|shoot|campaign|strategy|social|media|content|copy|script|storyboard|wireframe|mockup|prototype|concept|pitch|presentation|deliverable|asset|file|format|resolution|color|font|typography|layout|composition)\b/) ||
                     (words.length === 1 && words[0].length > 2 && !/^(um|uh|ah|er|mmm|hmm|like|just|well|you|know)$/.test(txt))

      if (!isValid) {
        console.log(`[REALTIME AGENT] Transcription not suitable for creative business processing: "${transcript}"`)
        return
      }

      const callSid = state.callSid ?? 'UNKNOWN_CALLSID'

      console.log('[REALTIME AGENT] Processing message with AI handler...')
      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid,
        channel: 'VOICE'
      })

      // Update conversation history
      this.addToConversationHistory(state, 'user', transcript)
      if (response.reply) {
        this.addToConversationHistory(state, 'assistant', response.reply)
      }
      state.currentFlow = response.currentFlow || null
      
      // Manage conversation history size
      if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
      }

      if (response.reply) {
        console.log(`[REALTIME AGENT] AI Response: "${response.reply.substring(0, 100)}..."`)
        await this.streamTTS(state, response.reply)
      }

      // Handle escalation request (warm transfer)
      if (response.nextAction === 'TRANSFER') {
        console.log('[REALTIME AGENT] AI requested live escalation – initiating warm transfer')
        // Use business notification phone if available
        let targetNum: string | undefined
        if (state.businessId) {
          const biz = await prisma.business.findUnique({ where: { id: state.businessId }, select: { notificationPhoneNumber: true } })
          targetNum = biz?.notificationPhoneNumber || undefined
        }
        this.escalateToHuman(state, targetNum)
      } else if (response.nextAction === 'VOICEMAIL') {
        console.log('[REALTIME AGENT] AI requested voicemail – redirecting caller')
        this.sendToVoicemail(state)
      }

    } catch (error) {
      console.error('[REALTIME AGENT] Critical error in audio processing pipeline:', error)
      
      // Professional creative industry error recovery
      const errorMessages = [
        "I apologize, but I didn't catch that clearly. Could you please repeat your question about the project?",
        "I'm sorry, I'm having trouble with the audio. Could you rephrase your question for me?",
        "I apologize for the technical difficulty. Please try again - I'm here to help with your project needs.",
        "Sorry about that - could you repeat what you said? I want to make sure I get you the right information.",
        "I didn't quite catch that. Could you tell me again how I can help with your creative project?"
      ]
      
      const randomMessage = errorMessages[Math.floor(Math.random() * errorMessages.length)]
      
      try {
        await this.streamTTS(state, randomMessage)
      } catch (fallbackError) {
        console.error('[REALTIME AGENT] Even error recovery failed:', fallbackError)
      }
      
    } finally {
      // Always clean up temp files
      if (rawPath) await cleanupTempFile(rawPath)
      if (wavPath) await cleanupTempFile(wavPath)
      
      // Reset processing state
      state.isProcessing = false
      state.audioQueue = [] // Ensure queue is clear
    }
  }

  public getConnectionStatus(): string {
    return this.connections.size > 0 ? 'active' : 'idle';
  }

  public getActiveConnections(): number {
    return this.connections.size;
  }

  private async handleStartEvent(state: ConnectionState, data: any): Promise<void> {
    console.log('[REALTIME AGENT] Processing call start event with professional voice configuration...');
    const callSid = data.start?.callSid;
    state.streamSid = data.start?.streamSid;
    state.isTwilioReady = true;
    state.callSid = callSid;
    this.callSid = callSid ?? this.callSid;

    // Initialize state flags
    state.isSpeaking = false;
    state.pendingAudioGeneration = false;

    if (this.onCallSidReceived && callSid) this.onCallSidReceived(callSid);

    if (!callSid) {
      console.error('[REALTIME AGENT] CallSid not found in start message');
      this.cleanup('Missing CallSid');
      return;
    }

    try {
      const callDetails = await twilioClient.calls(callSid).fetch();
      const toNumberRaw = callDetails.to ?? '';
      const fromNumberRaw = callDetails.from ?? '';

      const toNumber = normalizePhoneNumber(toNumberRaw);
      const fromNumber = normalizePhoneNumber(fromNumberRaw);

      console.log('[REALTIME AGENT] Call details:', { toNumber, fromNumber });

      const digitsOnly = toNumber.replace(/[^0-9]/g, '');
      let business: { id: string; twilioPhoneNumber: string | null } | null = null;

      if (digitsOnly) {
        console.log(`[REALTIME AGENT] Looking up business for phone number: ${toNumber}`);
        // Exact match first
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: toNumber },
          select: { id: true, twilioPhoneNumber: true },
        });

        // Fallback: try matching last 10 digits
        if (!business && digitsOnly.length >= 10) {
          const lastTen = digitsOnly.slice(-10);
          const businesses = await prisma.business.findMany({
            where: { twilioPhoneNumber: { endsWith: lastTen } },
            select: { id: true, twilioPhoneNumber: true },
          });
          if (businesses.length > 0) {
            business = businesses[0];
          }
        }
      }

      if (business) {
        console.log(`[REALTIME AGENT] Found business: ${business.id} - Initializing professional voice service`);
        
        state.businessId = business.id;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Create conversation record
        const conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            sessionId: crypto.randomUUID(),
            messages: [],
          },
        });

        // Log call with proper status
        await prisma.callLog.upsert({
          where: { callSid },
          create: {
            businessId: business.id,
            callSid,
            from: fromNumber,
            to: toNumber,
            direction: 'INBOUND',
            type: 'VOICE',
            status: 'IN_PROGRESS',
            source: 'VOICE_CALL',
            conversationId: conversation.id,
            metadata: { streamSid: state.streamSid },
          },
          update: {
            status: 'IN_PROGRESS',
            metadata: { streamSid: state.streamSid },
            updatedAt: new Date(),
          },
        });

        // Load configuration and initialize voice systems
        await this.loadAgentConfig(state);
        const systemPrompt = await this.buildSystemPrompt(state);

        // Initialize realtime client if configured
        if (state.ttsProvider === 'realtime' && !state.openaiClient) {
          await this.initializeOpenAIRealtimeClient(state, systemPrompt);
        }

        // Update instructions for existing realtime client
        if (state.openaiClient) {
          console.log('[REALTIME AGENT] Updating realtime client with business context');
          state.openaiClient.updateInstructions(systemPrompt);
        }

        // Deliver professional greeting
        if (!state.welcomeMessageDelivered) {
          try {
            if (!(state.openaiClient && state.ttsProvider === 'realtime')) {
              console.log('[REALTIME AGENT] Delivering professional greeting via TTS')
              const welcome = await this.getWelcomeMessage(state)
              await this.streamTTS(state, welcome)
              state.welcomeMessageDelivered = true
            }
          } catch (err) {
            console.error('[REALTIME AGENT] Failed to deliver greeting:', err)
            // Emergency fallback
            await this.streamTTS(state, 'Hello! Thank you for calling. How may I assist you today?')
            state.welcomeMessageDelivered = true
          }
        }

      } else {
        console.warn('[REALTIME AGENT] Business not found for phone number:', toNumber);
        
        state.businessId = null;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Generic professional greeting
        if (!state.welcomeMessageDelivered) {
          await this.streamTTS(state, 'Hello! Thank you for calling StudioConnect AI. How may I assist you today?');
          state.welcomeMessageDelivered = true;
        }
      }

      // ---------------- Lead Qualification Engine ----------------
      let lcQuestions: any[] = []
      if (state.businessId) {
        const _agentCfg: any = await prisma.agentConfig.findUnique({
          where: { businessId: state.businessId },
          include: { questions: { orderBy: { order: 'asc' } } },
        })
        lcQuestions = _agentCfg?.questions || []
      }

      if (!state.clientId && lcQuestions.length > 0) {
        try {
          state.leadQualifier = new LeadQualifier(
            lcQuestions.map((q: any) => ({
              id: q.id,
              order: q.order,
              questionText: q.questionText,
              expectedFormat: q.expectedFormat || undefined,
              isRequired: q.isRequired,
              mapsToLeadField: q.mapsToLeadField || undefined,
            }))
          )
          state.qualAnswers = {}
          state.currentFlow = 'LEAD_QUAL'
          state.qualQuestionMap = lcQuestions.reduce((acc: any, q: any) => {
            acc[q.id] = { questionText: q.questionText, mapsToLeadField: q.mapsToLeadField || undefined }
            return acc
          }, {})

          const { nextPrompt, missingKey } = state.leadQualifier.getNextPrompt({})
          if (nextPrompt) {
            await this.streamTTS(state, nextPrompt)
            state.currentMissingQuestionId = missingKey
          }
        } catch (err) {
          console.error('[REALTIME AGENT] LeadQualifier init failed:', err)
        }
      }

      // ---- NEW: preload last conversation history for smoother multi-turn across calls ----
      if (state.clientId) {
        try {
          const lastConv = await prisma.conversation.findFirst({
            where: { clientId: state.clientId },
            orderBy: { updatedAt: 'desc' },
            select: { messages: true },
          })
          if (lastConv?.messages && Array.isArray(lastConv.messages)) {
            for (const mRaw of lastConv.messages.slice(-20)) {
              const m = mRaw as any
              if (m && typeof m === 'object' && 'role' in m && 'content' in m) {
                state.conversationHistory.push({
                  role: m.role as 'user' | 'assistant',
                  content: String(m.content),
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (histErr) {
          console.error('[REALTIME AGENT] Failed to preload prior conversation', histErr)
        }
      }

    } catch (error) {
      console.error('[REALTIME AGENT] Error handling start event:', error);
      
      // Emergency recovery - still try to provide service
      if (!state.welcomeMessageDelivered) {
        try {
          await this.streamTTS(state, 'Hello! Thank you for calling. I apologize, but I\'m experiencing some technical difficulties. How may I help you?');
          state.welcomeMessageDelivered = true;
        } catch (emergencyError) {
          console.error('[REALTIME AGENT] Emergency greeting also failed:', emergencyError);
        }
      }
    }
  }

  private async buildSystemPrompt(state: ConnectionState): Promise<string> {
    if (!state.businessId) return createVoiceSystemPrompt('this creative agency', undefined, undefined, state.personaPrompt);

    const business = await prisma.business.findUnique({
      where: { id: state.businessId },
      select: { name: true }
    });
    
    let context = '';
    let clientContext = '';
    let projectContext = '';
    let knowledgeContext = '';

    // 1. Fetch Knowledge Base
    const knowledgeBaseEntries = await prisma.knowledgeBase.findMany({
      where: { businessId: state.businessId },
      select: { content: true },
    });
    if (knowledgeBaseEntries.length > 0) {
      knowledgeContext = '--- KNOWLEDGE BASE ---\n' + knowledgeBaseEntries.map((e: { content: string }) => `- ${e.content}`).join('\n');
    }

    // 2. Fetch Client and Project info
    if (state.fromNumber) {
      const client = await getClientByPhoneNumber(state.fromNumber);
      if (client && client.businessId === state.businessId) {
        clientContext = `--- CALLER INFORMATION ---\nThis call is from an existing client: ${client.name}.`;

        // ---- NEW: preload last conversation history for smoother multi-turn across calls ----
        try {
          const lastConv = await prisma.conversation.findFirst({
            where: { clientId: client.id },
            orderBy: { updatedAt: 'desc' },
            select: { messages: true },
          })
          if (lastConv?.messages && Array.isArray(lastConv.messages)) {
            for (const mRaw of lastConv.messages.slice(-20)) {
              const m = mRaw as any
              if (m && typeof m === 'object' && 'role' in m && 'content' in m) {
                state.conversationHistory.push({
                  role: m.role as 'user' | 'assistant',
                  content: String(m.content),
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (histErr) {
          console.error('[REALTIME AGENT] Failed to preload prior conversation', histErr)
        }
      }
    }

    // 3. Assemble final context
    const contextParts = [clientContext, projectContext, knowledgeContext].filter(Boolean);
    if (contextParts.length > 0) {
      context = contextParts.join('\n\n');
    }

    // 4. Fetch Lead Capture Questions
    const agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        include: { questions: { orderBy: { order: 'asc' } } }
    });
    const leadCaptureQuestions = agentConfig?.questions || [];

    return createVoiceSystemPrompt(business?.name || 'this creative agency', context, leadCaptureQuestions, state.personaPrompt);
  }

  private async loadAgentConfig(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.__configLoaded) return

    // --- Global override for ops ---
    const forcedProvider = process.env.AGENT_FORCE_TTS?.toLowerCase() as 'openai' | 'polly' | 'realtime' | 'elevenlabs' | undefined
    if (forcedProvider && ['openai', 'polly', 'realtime', 'elevenlabs'].includes(forcedProvider)) {
      state.ttsProvider = forcedProvider
      state.__configLoaded = true
      console.log(`[RealtimeAgent] AGENT_FORCE_TTS override → ${forcedProvider}`)
    }

    // 1. Try cache first
    const cached = voiceConfigCache.get(state.businessId)
    const now = Date.now()
    if (cached && now - cached.cachedAt < VOICE_CFG_TTL_MS) {
      state.ttsProvider = cached.ttsProvider
      state.openaiVoice = cached.openaiVoice
      state.openaiModel = cached.openaiModel
      state.personaPrompt = cached.personaPrompt
      state.__configLoaded = true
      console.log(`[RealtimeAgent] Voice config served from cache for business ${state.businessId}`)
      return
    }

    // 2. Fetch from DB
    try {
      const cfg = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        select: {
          useOpenaiTts: true,
          openaiVoice: true,
          openaiModel: true,
          personaPrompt: true,
          ttsProvider: true,
        },
      })

      if (cfg) {
        const provider = (cfg as any).ttsProvider
        if (provider) {
          state.ttsProvider = provider
        } else if (cfg.useOpenaiTts !== undefined) {
          state.ttsProvider = cfg.useOpenaiTts ? 'openai' : 'polly'
        }
        if (!state.ttsProvider) state.ttsProvider = 'elevenlabs'
        state.openaiVoice = (cfg.openaiVoice || 'nova').toLowerCase()
        state.openaiModel = cfg.openaiModel || 'tts-1'
        state.personaPrompt = cfg.personaPrompt

        // Cache it
        voiceConfigCache.set(state.businessId, {
          ttsProvider: state.ttsProvider,
          openaiVoice: state.openaiVoice,
          openaiModel: state.openaiModel,
          personaPrompt: state.personaPrompt,
          cachedAt: now,
        })

        console.log(`[RealtimeAgent] Voice config loaded & cached for business ${state.businessId}`)
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to load agentConfig – using high-quality defaults:', (err as Error).message)
    } finally {
      state.__configLoaded = true
    }
  }

  private async initializeOpenAIRealtimeClient(state: ConnectionState, initialPrompt: string): Promise<void> {
    if (state.openaiClient || !process.env.OPENAI_API_KEY) return

    // Respect temporary failure cache
    if (state.businessId && isRealtimeTemporarilyDisabled(state.businessId)) {
      console.log(`[REALTIME AGENT] Realtime voice temporarily disabled for business ${state.businessId} – falling back to OpenAI TTS`)
      state.ttsProvider = 'openai'
      return
    }

    // --- New: ensure the selected voice is supported by the realtime API ---
    const ALLOWED_REALTIME_VOICES = ['shimmer', 'echo', 'alloy', 'ash', 'ballad', 'coral', 'sage', 'verse'] as const
    const realtimeVoice = ALLOWED_REALTIME_VOICES.includes(state.openaiVoice as any)
      ? state.openaiVoice
      : 'shimmer' // prefer Shimmer for more natural tone

    if (realtimeVoice !== state.openaiVoice) {
      console.warn(`[REALTIME AGENT] Voice "${state.openaiVoice}" not supported for realtime – using "${realtimeVoice}" for realtime session`)
    }

    console.log('[REALTIME AGENT] Initializing OpenAI Realtime Client with professional settings...')
    try {
      const client = new OpenAIRealtimeClient(
        process.env.OPENAI_API_KEY,
        realtimeVoice,
        initialPrompt,
        process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
      );
      
      // Set longer timeout for initial connection
      const connectionPromise = client.connect();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Realtime client connection timeout')), 15000)
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      // Enhanced event handlers with professional voice quality
      client.on('assistantAudio', (b64) => {
        if (!state.welcomeMessageDelivered) {
          state.welcomeMessageDelivered = true
          console.log('[REALTIME AGENT] First audio received, welcome message delivered via realtime')
        }
        
        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.isSpeaking = true // Mark as speaking
          state.ws.send(
            JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload: b64 },
            }),
          )
        }
      })

      // Handle text responses to maintain conversation history
      client.on('assistantMessage', (text) => {
        this.addToConversationHistory(state, 'assistant', text);
        console.log(`[REALTIME AGENT] Assistant response: ${text.substring(0, 100)}...`);
      });

      // Capture user transcripts to decide when to trigger assistant replies
      client.on('userTranscript', (text) => {
        state.hasUserTranscript = true
        this.addToConversationHistory(state, 'user', text)
        console.log(`[REALTIME AGENT] User transcript received (${text.length} chars)`)
      })

      // Enhanced error handling - bulletproof fallback system
      client.on('error', async (error) => {
        console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error.message)
        
        // Detect invalid model explicitly so we can mark failure cache
        if (error.message?.includes('invalid_model')) {
          if (state.businessId) markRealtimeFailure(state.businessId)
        }

        // Graceful degradation to high-quality TTS fallback
        console.log('[REALTIME AGENT] Switching to bulletproof TTS fallback for reliability')
        state.openaiClient = undefined
        state.ttsProvider = 'openai' // Use high-quality OpenAI TTS
        state.openaiVoice = 'nova' // Premium voice
        state.openaiModel = 'tts-1-hd' // HD quality

        if (!state.welcomeMessageDelivered) {
          try {
            const fallbackGreeting = await this.getWelcomeMessage(state)
            await this.streamTTS(state, fallbackGreeting)
            state.welcomeMessageDelivered = true
            console.log('[REALTIME AGENT] Successfully delivered greeting via TTS fallback')
          } catch (fallbackErr) {
            console.error('[REALTIME AGENT] Critical error in fallback system:', fallbackErr)
            // Emergency simple greeting
            await this.streamTTS(state, 'Hello! Thank you for calling. How may I assist you today?')
            state.welcomeMessageDelivered = true
          }
        }
      });

      // Dedicated invalidModel event emitted by client – mark cache immediately
      client.on('invalidModel', (err: Error) => {
        console.error('[REALTIME AGENT] Realtime client reported invalid model:', err.message)
        if (state.businessId) markRealtimeFailure(state.businessId)
      })

      client.on('close', async () => {
        console.log('[REALTIME AGENT] OpenAI Realtime Client connection closed gracefully')
        
        // Don't immediately switch to fallback - connection might recover
        if (state.openaiClient === client) {
          console.log('[REALTIME AGENT] Realtime client closed, will use TTS fallback for new requests')
          state.ttsProvider = 'openai'
          state.openaiClient = undefined
        }
        if (state.businessId) markRealtimeFailure(state.businessId) // hard-failover for 60 min
      });

      // Handle speech events for better turn-taking
      client.on('speechStarted', () => {
        console.log('[REALTIME AGENT] User speech started (realtime VAD)')
        state.isRecording = true
      });

      client.on('speechStopped', () => {
        console.log('[REALTIME AGENT] User speech stopped (realtime VAD)')
        state.isRecording = false
        state.isSpeaking = false // User stopped, we can speak
        // Give the user a short grace period before assistant replies to avoid overlap
        setTimeout(() => {
          if (state.openaiClient && state.ttsProvider === 'realtime') {
            if (state.hasUserTranscript) {
              try {
                state.openaiClient.requestAssistantResponse()
              } catch { /* ignore */ }
              // Reset flag to wait for next user turn
              state.hasUserTranscript = false
            } else {
              console.log('[REALTIME AGENT] Skipping assistant response – no user transcript yet')
            }
          }
        }, 500)
        this._scheduleIdlePrompt(state)
      });

      client.on('responseComplete', () => {
        console.log('[REALTIME AGENT] Response complete')
        state.isSpeaking = false // Response finished
        this._scheduleIdlePrompt(state)
      });

      state.openaiClient = client
      console.log('[REALTIME AGENT] OpenAI Realtime Client connected successfully with professional voice settings')
      
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to establish OpenAI realtime session:', err.message)
      console.log('[REALTIME AGENT] Falling back to high-quality TTS pipeline')
      state.ttsProvider = 'openai' // Use OpenAI TTS as fallback for quality
      state.openaiVoice = 'nova' // Ensure we use a high-quality voice
      state.openaiModel = 'tts-1-hd' // Use HD model for better quality
    }
  }

  // Example: when adding to conversationHistory, always include timestamp
  private addToConversationHistory(state: ConnectionState, role: 'user' | 'assistant', content: string) {
    state.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  /** Schedules the idle prompt timer. This should only be called when the agent is finished speaking. */
  private _scheduleIdlePrompt(state: ConnectionState): void {
    // Do not schedule idle prompts until the initial greeting has been delivered.
    if (!state.welcomeMessageDelivered) return

    this._clearIdlePrompt(state); // Always clear previous before setting a new one

    // Pick delay based on how many prompts we have already sent
    const promptIdx = state.idlePromptCount ?? 0
    const delay = IDLE_PROMPT_DELAYS_MS[Math.min(promptIdx, IDLE_PROMPT_DELAYS_MS.length - 1)]

    state.idlePromptTimer = setTimeout(async () => {
      // Check for any activity before firing the prompt
      if (state.isRecording || state.isSpeaking || !this.connections.has(state.callSid || '')) {
        return; // Bail out if there's activity
      }
      
      state.idlePromptCount = (state.idlePromptCount || 0) + 1;

      // Reduce from 3 to 2 prompts before hanging up to be less repetitive
      if (state.idlePromptCount > 2) { 
        await this.streamTTS(state, 'It seems we got disconnected. Please call back anytime. Goodbye.');
        this.cleanup(state.callSid || 'Caller inactive');
        return;
      }
      
      const followUp = 'Are you still there?';
      console.log(`[IDLE_PROMPT] Firing idle prompt #${state.idlePromptCount}: "${followUp}"`);
      
      try {
        // Always use TTS directly (bypassing realtime pipeline) to avoid the model replying "Yes, I'm still here".
        if (state.openaiClient && state.ttsProvider === 'realtime') {
          const backupClient = state.openaiClient
          const backupProvider = state.ttsProvider

          // Temporarily switch to OpenAI TTS fallback
          state.openaiClient = undefined
          state.ttsProvider = 'openai'

          await this.streamTTS(state, followUp)

          // Restore realtime settings after the prompt
          state.openaiClient = backupClient
          state.ttsProvider = backupProvider
        } else {
          await this.streamTTS(state, followUp)
        }
      } catch (e) {
        console.warn('[REALTIME AGENT] Failed to send idle follow-up prompt:', e);
      }
    }, delay);
  }

  /** Clears the idle prompt timer. This should be called whenever there is any activity. */
  private _clearIdlePrompt(state: ConnectionState): void {
    if (state.idlePromptTimer) {
      clearTimeout(state.idlePromptTimer);
      state.idlePromptTimer = null;
    }
    state.idlePromptCount = 0;
  }

  /**
   * Entry-point for WebSocketServer to forward every Twilio media-stream message (JSON string).
   * This keeps all Twilio-specific parsing logic inside the RealtimeAgentService.
   */
  public handleTwilioStreamEvent(ws: WebSocket, payload: Record<string, unknown>): void {
    // Locate the connection state for this WebSocket instance.
    const state = [...this.connections.values()].find((s) => s.ws === ws);

    if (!state) {
      console.warn('[REALTIME AGENT] Received stream event for unknown WebSocket');
      return;
    }

    const eventType = payload.event as string | undefined;

    switch (eventType) {
      case 'start': {
        // The START event provides the definitive CallSid – remap the state so future look-ups are cheap
        try {
          // Redundant client initialization removed. This is now handled exclusively
          // within handleStartEvent to prevent race conditions and ensure stability.
          this.handleStartEvent(state, payload);

          const startCallSid = (payload as any).start?.callSid as string | undefined;
          if (startCallSid) {
            // If the state is stored under a temporary key, move it under the real CallSid
            const existingKey = [...this.connections.entries()].find(([_, val]) => val === state)?.[0];
            if (existingKey && existingKey !== startCallSid) {
              this.connections.delete(existingKey);
              this.connections.set(startCallSid, state);
            }
            state.callSid = startCallSid;
          }
        } catch (error) {
          console.error('[REALTIME AGENT] Error processing START event:', error);
        }
        break;
      }
      case 'media': {
        const mediaPayload = (payload as any).media?.payload as string | undefined
        if (!mediaPayload) return

        // Skip processing if we're currently speaking to prevent interruption
        if (state.isSpeaking || state.pendingAudioGeneration) {
          return
        }

        // --- Audio pre-processing for VAD & fallback pipeline ---
        const buf = Buffer.from(mediaPayload, 'base64')

        // Determine if payload is 16-bit Linear PCM (even length → 2-byte samples)
        const isLinear16 = buf.length % 2 === 0

        // Calculate average absolute energy (0-255 scale)
        let energy = 0
        if (isLinear16) {
          for (let i = 0; i < buf.length; i += 2) {
            const sample = buf.readInt16LE(i)
            energy += Math.abs(sample)
          }
          energy = energy / (buf.length / 2) / 256 // normalise to 8-bit scale
        } else {
          for (let i = 0; i < buf.length; i++) energy += Math.abs(buf[i] - 128)
          energy = energy / buf.length
        }

        // Improved noise-floor calibration with more samples
        if (!state.vadCalibrated) {
          state.vadNoiseFloor += energy
          state.vadSamples += 1
          if (state.vadSamples >= 100) { // More samples for better calibration
            state.vadNoiseFloor = state.vadNoiseFloor / state.vadSamples
            state.vadThreshold = state.vadNoiseFloor + 15 // Increased margin for better accuracy
            state.vadCalibrated = true
            console.log(`[REALTIME AGENT] VAD calibrated - noise floor: ${state.vadNoiseFloor.toFixed(2)}, threshold: ${state.vadThreshold.toFixed(2)}`)
          }
        }

        const now = Date.now()
        const threshold = state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD

        // ----------------------------------
        // Realtime pipeline (OpenAI client)
        // ----------------------------------
        if (state.openaiClient && state.ttsProvider === 'realtime') {
          try {
            // Forward raw caller audio to the realtime client.
            // We now rely entirely on OpenAI's server-side VAD, eliminating local
            // energy-based heuristics that caused premature turn-taking.
            state.openaiClient.sendAudio(mediaPayload)

            // Activity heartbeat – prevents premature idle prompts.
            state.lastActivity = Date.now()
          } catch (error) {
            console.error('[REALTIME AGENT] Error with realtime client audio processing:', error)
            // Graceful degradation to fallback pipeline
            state.ttsProvider = 'openai'
            state.openaiClient = undefined
          }
          return
        }

        // --- High-quality fallback pipeline with professional Whisper transcription ---

        // Wait for business context before processing
        if (!state.businessId) return

        // Professional speech detection with reduced false positives
        if (energy > threshold) {
          if (!state.isRecording) {
            console.log('[REALTIME AGENT] Professional speech detection: Recording started')
            this._clearIdlePrompt(state);
            state.isRecording = true
            state.audioQueue = [] // Clear any previous audio
          }
          state.lastSpeechMs = now
          state.audioQueue.push(mediaPayload)
        } else if (state.isRecording) {
          // Continue capturing trailing audio for complete sentences
          state.audioQueue.push(mediaPayload)
        }

        // Process complete utterances with professional timing
        if (state.isRecording && !state.isProcessing && now - state.lastSpeechMs > VAD_SILENCE_MS && state.audioQueue.length > 0) {
          state.isLinear16Recording = isLinear16
          console.log('[REALTIME AGENT] Processing complete utterance via professional Whisper pipeline')
          state.isProcessing = true
          this.flushAudioQueue(state)
        }

        // inside case 'media' after buf defined and before VAD detection
        if (state.sttClient && state.sttClient.isReady()) {
          try {
            state.sttClient.sendAudio(buf)
          } catch {}
        }
        break
      }
      case 'stop':
      case 'end': {
        // Clean-up when Twilio signals the end of the stream.
        this.cleanup('Twilio STOP event');
        if (!state.callSid) ws.close();
        break;
      }
      default:
        console.warn('[REALTIME AGENT] Unhandled Twilio stream event type:', eventType);
    }
  }

  private escalateToHuman(state: ConnectionState, targetNumber?: string): void {
    const { callSid, businessId } = state
    if (!callSid) {
      console.error('[REALTIME AGENT] Attempted escalation without CallSid')
      return
    }

    // Determine fallback voicemail URL
    const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
    const host = base.replace(/\/$/, '') || `https://${process.env.HOST || 'localhost'}`
    const voicemailUrl = `${host}/api/voice/voicemail` // must be implemented as POST returning TwiML <Record>

    // Pick escalation number (ENV overrides > business setting > explicit parameter)
    const dialNumber = targetNumber || process.env.DEFAULT_ESCALATION_NUMBER || undefined

    // If we still do not have a valid destination, gracefully route to voicemail
    if (!dialNumber) {
      console.warn('[REALTIME AGENT] No escalation number configured – routing caller to voicemail instead')
      // Inform the caller politely before recording
      try {
        const twiml = new twilio.twiml.VoiceResponse()
        twiml.say({ voice: 'Polly.Amy' }, 'I\'m transferring you to voicemail so our team can follow up shortly. Please leave your message after the beep.')
        twiml.record({ action: voicemailUrl, maxLength: 120, playBeep: true, trim: 'trim-silence' })
        twiml.say({ voice: 'Polly.Amy' }, 'Thank you. Goodbye.')
        twiml.hangup()

        this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
      } catch (err) {
        console.error('[REALTIME AGENT] Failed to redirect to voicemail during escalation fallback:', err)
      }

      prisma.callLog.update({ where: { callSid }, data: { status: 'VOICEMAIL', metadata: { reason: 'ESCALATION_FALLBACK' } } } as any).catch(() => {})
      return
    }

    try {
      const twiml = new twilio.twiml.VoiceResponse()
      const dial = twiml.dial({ action: voicemailUrl, timeout: 20, callerId: state.fromNumber || undefined })
      dial.number(dialNumber)
      twiml.say({ voice: 'Polly.Amy' }, 'Connecting you now, please hold.')

      this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
      console.log(`[REALTIME AGENT] Warm transfer initiated to ${dialNumber} for call ${callSid}`)

      // Update callLog status
      prisma.callLog.update({ where: { callSid }, data: { status: 'TRANSFERRED', metadata: { transferredTo: dialNumber } } } as any).catch(() => {})

    } catch (error) {
      console.error('[REALTIME AGENT] Failed to initiate warm transfer:', error)
      // As a last resort, fall back to voicemail so the caller is never left hanging
      this.sendToVoicemail(state)
    }
  }

  /** Directs the caller to leave a voicemail, recording up to 120 seconds. */
  private sendToVoicemail(state: ConnectionState): void {
    if (!state.callSid) {
      console.error('[REALTIME AGENT] Attempted voicemail without CallSid')
      return
    }

    const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
    const recordUrl = `${base}/api/voice/voicemail` // will store recording

    try {
      const twiml = new twilio.twiml.VoiceResponse()
      twiml.say({ voice: 'Polly.Amy' }, 'Please leave a detailed message after the beep. When you are done, simply hang up.')
      twiml.record({ action: recordUrl, maxLength: 120, playBeep: true, trim: 'trim-silence' })
      twiml.say({ voice: 'Polly.Amy' }, 'Thank you. Goodbye.')
      twiml.hangup()

      this.twilioClient.calls(state.callSid).update({ twiml: twiml.toString() })
      console.log('[REALTIME AGENT] Redirected caller to voicemail.')

      prisma.callLog.update({ where: { callSid: state.callSid }, data: { status: 'VOICEMAIL' } } as any).catch(() => {})

    } catch (error) {
      console.error('[REALTIME AGENT] Failed to start voicemail recording:', error)
    }
  }

  private async _handleTranscript(state: ConnectionState, transcript: string): Promise<void> {
    transcript = transcript.trim()
    if (!transcript) return

    console.log('[STT] >>', transcript)

    // Update conversation history + process message (reusing existing logic)
    try {
      // Lead qualification branch or normal processing identical to flushAudioQueue path
      // Reuse existing flushAudioQueue logic by calling processMessage directly
      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid: state.callSid ?? undefined,
        channel: 'VOICE'
      })

      this.addToConversationHistory(state, 'user', transcript)
      if (response.reply) this.addToConversationHistory(state, 'assistant', response.reply)
      state.currentFlow = response.currentFlow || null
      if (response.reply) {
        await this.streamTTS(state, response.reply)
      }
    } catch (err) {
      console.error('[STT] processing error', err)
    }
  }
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance();

// Export helpers for testing purposes (tree-shaken in production builds)
export { isRealtimeTemporarilyDisabled, markRealtimeFailure } 