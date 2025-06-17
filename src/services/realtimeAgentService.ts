import { WebSocket } from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
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
  ttsProvider: 'openai' | 'polly' | 'realtime';
  openaiVoice: string;
  openaiModel: string;
  personaPrompt?: string;
  lastSpeechMs: number;
  vadCalibrated: boolean;
  vadSamples: number;
  vadNoiseFloor: number;
  vadThreshold: number;
  /** Indicates that we are currently recording an utterance */
  isRecording: boolean;
  isProcessing: boolean;
  __configLoaded?: boolean;
  openaiClient?: OpenAIRealtimeClient;
  isSpeaking: boolean;
  pendingAudioGeneration: boolean;
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
const VAD_THRESHOLD = 20; // µ-law sample energy threshold
const VAD_SILENCE_MS = 600; // flush after 600 ms silence

// State management
const activeAgents = new Map<string, ConnectionState>();
let cleanupInterval: NodeJS.Timeout;

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
      ttsProvider: 'realtime',
      openaiVoice: 'nova',
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
      pendingAudioGeneration: false
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
    if (!state.openaiClient && process.env.OPENAI_API_KEY && state.ttsProvider === 'realtime') {
      try {
        const client = new OpenAIRealtimeClient(
          process.env.OPENAI_API_KEY,
          state.openaiVoice,
          state.personaPrompt || undefined, // Pass prompt; fallback to default
        )
        await client.connect()

        // Relay assistant audio back to Twilio in real time
        client.on('assistantAudio', (b64) => {
          if (!state.welcomeMessageDelivered) state.welcomeMessageDelivered = true
          if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
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
          console.log(`[REALTIME AGENT] Assistant: ${text}`);
        });

        // Handle errors
        client.on('error', async (error) => {
          console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error)
          state.openaiClient = undefined
          state.ttsProvider = 'openai'

          if (!state.welcomeMessageDelivered) {
            try {
              const fallbackGreeting = await this.getWelcomeMessage(state)
              await this.streamTTS(state, fallbackGreeting)
              state.welcomeMessageDelivered = true
            } catch (fallbackErr) {
              console.error('[REALTIME AGENT] Failed to stream fallback greeting (streamTTS):', fallbackErr)
            }
          }
        });

        client.on('close', async () => {
          console.log('[REALTIME AGENT] OpenAI Realtime Client connection closed.')
          state.openaiClient = undefined
          state.ttsProvider = 'openai'

          if (!state.welcomeMessageDelivered) {
            try {
              const fallbackGreeting = await this.getWelcomeMessage(state)
              await this.streamTTS(state, fallbackGreeting)
              state.welcomeMessageDelivered = true
            } catch (fallbackErr) {
              console.error('[REALTIME AGENT] Failed to stream fallback greeting after close (streamTTS):', fallbackErr)
            }
          }
        });

        state.openaiClient = client

        // Trigger greeting via realtime if not yet delivered
        if (!state.welcomeMessageDelivered) {
          const welcome = await this.getWelcomeMessage(state)
          client.sendUserText(welcome)
          client.requestAssistantResponse()
          // Delivery flag will be set upon first audio chunk
        }
      } catch (err) {
        console.error('[REALTIME AGENT] Failed to establish OpenAI realtime session – reverting to local pipeline', err)
      }
    }
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

  public cleanup(reason: string): void {
    if (this.callSid) {
      const state = this.connections.get(this.callSid);
      if (state) {
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
      const host = (process.env.APP_PRIMARY_URL || '').replace(/\/$/, '') || `https://${process.env.HOST || 'localhost'}`
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
            if (provider && ['openai', 'polly', 'realtime'].includes(provider)) {
              state.ttsProvider = provider
            } else if (cfg.useOpenaiTts !== undefined) {
              state.ttsProvider = cfg.useOpenaiTts ? 'openai' : 'polly'
            }
            
            // Default to OpenAI for better quality if realtime fails
            if (!state.ttsProvider) state.ttsProvider = 'openai'
            
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

      // Generate high-quality TTS audio
      console.log(`[REALTIME AGENT] Generating TTS with ${state.ttsProvider} for: ${text.substring(0, 50)}...`)
      
      const mp3Path = await generateSpeechFromText(
        text, 
        state.openaiVoice, 
        state.openaiModel as any, 
        state.ttsProvider as 'openai' | 'polly'
      )
      
      if (!mp3Path) {
        console.error('[REALTIME AGENT] Failed to generate TTS audio')
        return
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
      const rawData = Buffer.concat(rawBuffers)

      // Enhanced duration check for professional quality
      const MIN_DURATION_MS = 300 // Increased minimum for better accuracy
      const bytesPerMs = 8 // 8000 samples/sec * 1 byte/sample / 1000ms
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
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', rawPath,
        '-af', 'highpass=f=80,lowpass=f=3400,volume=1.2', // Professional audio filtering
        '-ar', '16000', // Upsample for better Whisper accuracy
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
      this.addToConversationHistory(state, 'assistant', response.reply)
      state.currentFlow = response.currentFlow || null
      
      // Manage conversation history size
      if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
      }

      console.log(`[REALTIME AGENT] AI Response: "${response.reply.substring(0, 100)}..."`)

      // Stream the response
      await this.streamTTS(state, response.reply)

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
            if (state.openaiClient && state.ttsProvider === 'realtime') {
              console.log('[REALTIME AGENT] Requesting professional greeting via realtime client')
              state.openaiClient.requestAssistantResponse()
            } else {
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
    if (!state.businessId) return createVoiceSystemPrompt('this creative agency');

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
        const projects = await prisma.project.findMany({
          where: { clientId: client.id, status: { not: 'COMPLETED' } },
          select: { name: true, status: true, details: true },
        });
        if (projects.length > 0) {
          projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\n` + projects.map((p: { name: string; status: string; details: string | null }) => `  - Project: "${p.name}", Status: ${p.status}, Last Update: ${p.details || 'No details available'}`).join('\n');
        } else {
          projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\nThis client currently has no active projects.`;
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

    return createVoiceSystemPrompt(business?.name || 'this creative agency', context, leadCaptureQuestions);
  }

  private async loadAgentConfig(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.__configLoaded) return;

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
      });

      if (cfg) {
        const provider = (cfg as any).ttsProvider
        if (provider) {
          state.ttsProvider = provider
        } else if (cfg.useOpenaiTts !== undefined) {
          state.ttsProvider = cfg.useOpenaiTts ? 'openai' : 'polly'
        }
        if (!state.ttsProvider) state.ttsProvider = 'realtime';
        state.openaiVoice = (cfg.openaiVoice || 'nova').toLowerCase();
        state.openaiModel = cfg.openaiModel || 'tts-1';
        state.personaPrompt = cfg.personaPrompt;
        console.log(`[RealtimeAgent] Loaded agent config for business ${state.businessId}:`, {
          ttsProvider: state.ttsProvider,
          openaiVoice: state.openaiVoice,
        });
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to load agentConfig – using high-quality defaults:', (err as Error).message);
    } finally {
      state.__configLoaded = true;
    }
  }

  private async initializeOpenAIRealtimeClient(state: ConnectionState, initialPrompt: string): Promise<void> {
    if (state.openaiClient || !process.env.OPENAI_API_KEY) return

    console.log('[REALTIME AGENT] Initializing OpenAI Realtime Client with professional settings...')
    try {
      const client = new OpenAIRealtimeClient(
        process.env.OPENAI_API_KEY,
        state.openaiVoice || 'nova',
        initialPrompt,
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

              // Enhanced error handling - bulletproof fallback system
        client.on('error', async (error) => {
          console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error.message)
          
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

      client.on('close', async () => {
        console.log('[REALTIME AGENT] OpenAI Realtime Client connection closed gracefully')
        
        // Don't immediately switch to fallback - connection might recover
        if (state.openaiClient === client) {
          console.log('[REALTIME AGENT] Realtime client closed, will use TTS fallback for new requests')
          state.ttsProvider = 'openai'
          state.openaiClient = undefined
        }
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
      });

      client.on('responseComplete', () => {
        console.log('[REALTIME AGENT] Response complete')
        state.isSpeaking = false // Response finished
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
          // Initialize OpenAI client as early as possible if not already done.
          // The businessId might not be known yet, so we use defaults for now,
          // and the config will be re-evaluated in handleStartEvent.
          if (state.ttsProvider === 'realtime' && !state.openaiClient) {
            this.initializeOpenAIRealtimeClient(state, 'You are a helpful assistant. Please wait for more specific instructions.');
          }
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

        // Enhanced VAD with better noise handling
        const buf = Buffer.from(mediaPayload, 'base64')
        let energy = 0
        for (let i = 0; i < buf.length; i++) energy += Math.abs(buf[i] - 128)
        energy = energy / buf.length

        // Improved noise-floor calibration with more samples
        if (!state.vadCalibrated) {
          state.vadNoiseFloor += energy
          state.vadSamples += 1
          if (state.vadSamples >= 100) { // More samples for better calibration
            state.vadNoiseFloor = state.vadNoiseFloor / state.vadSamples
            state.vadThreshold = state.vadNoiseFloor + 12 // Increased margin for better accuracy
            state.vadCalibrated = true
            console.log(`[REALTIME AGENT] VAD calibrated - noise floor: ${state.vadNoiseFloor.toFixed(2)}, threshold: ${state.vadThreshold.toFixed(2)}`)
          }
        }

        const now = Date.now()
        const threshold = state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD

        // If realtime client is active, stream audio and handle turn-taking
        if (state.openaiClient && state.ttsProvider === 'realtime') {
          try {
            state.openaiClient.sendAudio(mediaPayload)

            // Professional turn-taking logic
            if (energy > threshold) {
              if (!state.isRecording) {
                console.log('[REALTIME AGENT] Professional VAD: User speech detected')
                state.isRecording = true
              }
              state.lastSpeechMs = now
            }

            // Give user time to finish speaking before responding
            if (state.isRecording && now - state.lastSpeechMs > 800) { // Increased silence duration for professional conversations
              console.log('[REALTIME AGENT] Professional VAD: User finished speaking, assistant will respond')
              state.openaiClient.requestAssistantResponse()
              state.isRecording = false
            }
          } catch (error) {
            console.error('[REALTIME AGENT] Error with realtime client audio processing:', error)
            // Fall back to TTS pipeline
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
        if (state.isRecording && !state.isProcessing && now - state.lastSpeechMs > 1000 && state.audioQueue.length > 0) {
          console.log('[REALTIME AGENT] Processing complete utterance via professional Whisper pipeline')
          state.isProcessing = true
          this.flushAudioQueue(state)
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
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 