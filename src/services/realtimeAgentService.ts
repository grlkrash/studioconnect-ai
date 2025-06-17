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
      ttsProvider: 'openai',
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
      openaiClient: undefined
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
          if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
            state.ws.send(JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload: b64 }
            }))
          }
        })

        // Handle text responses to maintain conversation history
        client.on('assistantMessage', (text) => {
          this.addToConversationHistory(state, 'assistant', text);
          console.log(`[REALTIME AGENT] Assistant: ${text}`);
        });

        // Handle errors
        client.on('error', (error) => {
          console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error);
          // could add fallback logic here
        });

        state.openaiClient = client

        // Trigger greeting via realtime if not yet delivered
        if (!state.welcomeMessageDelivered) {
          const welcome = await this.getWelcomeMessage(state)
          client.sendUserText(welcome)
          client.requestAssistantResponse()
          state.welcomeMessageDelivered = true
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

    try {
      /**
       * Load the Agent-level voice configuration. In production we occasionally hit
       * a "P2022 column does not exist" error when the database schema is out of
       * sync with the generated Prisma client. Because this *only* affects the
       * optional widget configuration, we treat the lookup as a best-effort
       * operation and gracefully fall back to sensible defaults whenever it
       * fails instead of aborting the entire TTS pipeline (which results in the
       * caller hearing *nothing*).
       */
      if (state.businessId && !state.__configLoaded) {
        try {
          // Fetch ONLY the columns we actually need to avoid runtime errors when the
          // database schema is missing newer, optional columns (e.g. widgetTheme).
          const cfg = await prisma.agentConfig.findUnique({
            where: { businessId: state.businessId },
            select: {
              useOpenaiTts: true,
              openaiVoice: true,
              openaiModel: true,
              personaPrompt: true,
            },
          })

          if (cfg) {
            // Check for ttsProvider on the fetched object to be safe.
            const provider = (cfg as any).ttsProvider
            state.ttsProvider = provider || (cfg.useOpenaiTts ? 'openai' : 'polly')
            state.openaiVoice = (cfg.openaiVoice || 'NOVA').toLowerCase()
            state.openaiModel = cfg.openaiModel || 'tts-1'
            state.personaPrompt = cfg.personaPrompt
          }
        } catch (err) {
          console.error('[REALTIME AGENT] Failed to load agentConfig – falling back to defaults:', (err as Error).message)
        } finally {
          state.__configLoaded = true
        }
      }

      // If the business is configured for realtime voice and we haven't yet
      // established a realtime session, do that now.
      if (state.ttsProvider === 'realtime' && !state.openaiClient && process.env.OPENAI_API_KEY) {
        try {
          const client = new OpenAIRealtimeClient(
            process.env.OPENAI_API_KEY,
            state.openaiVoice,
            state.personaPrompt || undefined, // Pass prompt; fallback to default
          )
          await client.connect()
          client.on('assistantAudio', (b64) => {
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
          client.on('error', (error) => {
            console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error);
          });

          state.openaiClient = client
        } catch (err) {
          console.error('[REALTIME AGENT] Failed to bootstrap OpenAI realtime client – will fall back to local TTS:', err)
          // Ensure we don't attempt again in this call
          state.ttsProvider = 'openai'
        }
      }

      // If the realtime client is active, it is the single source of truth for audio.
      // Send the text to it and let it handle the TTS, then exit.
      if (state.openaiClient) {
        this.addToConversationHistory(state, 'user', text)
        state.openaiClient.sendUserText(text)
        state.openaiClient.requestAssistantResponse()
        return
      }

      const mp3Path = await generateSpeechFromText(text, state.openaiVoice, state.openaiModel as any, (state.ttsProvider === 'realtime' ? 'openai' : state.ttsProvider) as 'openai' | 'polly')
      if (!mp3Path) return

      const ulawPath = path.join(os.tmpdir(), `${path.basename(mp3Path, path.extname(mp3Path))}.ulaw`)

      // Convert MP3 to 8kHz mono µ-law raw audio compatible with Twilio
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-i', mp3Path,
        '-ar', '8000',
        '-ac', '1',
        '-f', 'mulaw',
        ulawPath
      ])

      const ulawBuffer = await fs.promises.readFile(ulawPath)
      const CHUNK_SIZE = 320 // 40ms of audio at 8kHz µ-law

      for (let offset = 0; offset < ulawBuffer.length; offset += CHUNK_SIZE) {
        const chunk = ulawBuffer.subarray(offset, offset + CHUNK_SIZE)
        const payload = chunk.toString('base64')
        state.ws.send(JSON.stringify({
          event: 'media',
          streamSid: state.streamSid,
          media: { payload }
        }))
        // Pace the chunks so audio plays in real-time
        await new Promise((resolve) => setTimeout(resolve, 40))
      }

      // Signal end of message
      state.ws.send(JSON.stringify({ event: 'mark', streamSid: state.streamSid, mark: { name: 'eom' } }))

      await cleanupTempFile(mp3Path)
      await cleanupTempFile(ulawPath)
    } catch (error) {
      console.error('[REALTIME AGENT] Error streaming TTS to Twilio:', error)
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

    try {
      const rawBuffers = audioToProcess.map((b64) => Buffer.from(b64, 'base64'))
      const rawData = Buffer.concat(rawBuffers)

      // Skip processing if the utterance is too short (<200 ms) to avoid Whisper 400 errors
      const MIN_DURATION_MS = 200
      const bytesPerMs = 8 // 8000 samples/sec * 1 byte/sample / 1000ms
      if (rawData.length < bytesPerMs * MIN_DURATION_MS) {
        // Discard the captured silence/noise and reset queue early
        state.audioQueue = []
        return
      }

      const baseName = `${state.callSid || 'unknown'}_${Date.now()}`
      const rawPath = path.join(os.tmpdir(), `${baseName}.ulaw`)
      const wavPath = path.join(os.tmpdir(), `${baseName}.wav`)

      await fs.promises.writeFile(rawPath, rawData)

      // Convert raw µ-law to WAV 8kHz mono for Whisper
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', rawPath,
        wavPath
      ])

      const transcriptRaw = await getTranscription(wavPath)

      await cleanupTempFile(rawPath)
      await cleanupTempFile(wavPath)

      // Reset queue regardless of transcription success - This is now done at the top
      // state.audioQueue = []
      // Mark that we have stopped recording this utterance
      // state.isRecording = false

      if (!transcriptRaw) return

      const transcript = transcriptRaw

      const txt = transcript.trim().toLowerCase()
      const allowedShort = ['yes','no','ok','okay','sure','thanks','thank you','bye','hello','hi']
      const isValid = txt.split(/\s+/).length > 1 || allowedShort.includes(txt)
      if (!isValid) return

      const callSid = state.callSid ?? 'UNKNOWN_CALLSID'

      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid,
        channel: 'VOICE'
      })

      this.addToConversationHistory(state, 'user', transcript)
      this.addToConversationHistory(state, 'assistant', response.reply)
      state.currentFlow = response.currentFlow || null
      if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
      }

      await this.streamTTS(state, response.reply)
    } catch (error) {
      console.error('[REALTIME AGENT] Error flushing audio queue:', error)
      await this.streamTTS(state, 'I encountered an error while processing your request.')
      state.audioQueue = []
    } finally {
      state.isProcessing = false
    }
  }

  public getConnectionStatus(): string {
    return this.connections.size > 0 ? 'active' : 'idle';
  }

  public getActiveConnections(): number {
    return this.connections.size;
  }

  private async handleStartEvent(state: ConnectionState, data: any): Promise<void> {
    console.log('[DEBUG] 3a. Processing start event...');
    const callSid = data.start?.callSid;
    state.streamSid = data.start?.streamSid;
    state.isTwilioReady = true;
    state.callSid = callSid;
    this.callSid = callSid ?? this.callSid;

    if (this.onCallSidReceived && callSid) this.onCallSidReceived(callSid);

    if (!callSid) {
      console.error('[RealtimeAgent] CallSid not found in start message');
      this.cleanup('Twilio');
      return;
    }

    try {
      const callDetails = await twilioClient.calls(callSid).fetch();
      const toNumberRaw = callDetails.to ?? '';
      const fromNumberRaw = callDetails.from ?? '';

      const toNumber = normalizePhoneNumber(toNumberRaw);
      const fromNumber = normalizePhoneNumber(fromNumberRaw);

      console.log('[DEBUG] 3b. Call details fetched:', { toNumber, fromNumber });

      const digitsOnly = toNumber.replace(/[^0-9]/g, '');
      let business: { id: string; twilioPhoneNumber: string | null } | null = null;

      if (digitsOnly) {
        console.log(`[RealtimeAgent] Looking up business for phone number: ${toNumber} (digits: ${digitsOnly})`);
        // Attempt exact E.164 match first
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: toNumber },
          select: { id: true, twilioPhoneNumber: true },
        });

        // Fallback: try matching numbers that *end* with the 10-digit national significant number
        if (!business && digitsOnly.length >= 10) {
          const lastTen = digitsOnly.slice(-10);
          console.log(`[RealtimeAgent] Fallback lookup using last 10 digits: ${lastTen}`);
          const businesses = await prisma.business.findMany({
            where: { twilioPhoneNumber: { endsWith: lastTen } },
            select: { id: true, twilioPhoneNumber: true },
          });
          if (businesses.length > 0) {
            business = businesses[0]; // take the first match
            if (business && businesses.length > 1) {
              console.warn(`[RealtimeAgent] Found multiple businesses matching last 10 digits. Using first match: ${business.id}`);
            }
          }
        }
      }

      if (business) {
        console.log(`[RealtimeAgent] Found business: ${business.id}`);
        // Update state with recognized business details
        state.businessId = business.id;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Create conversation and log the call
        const conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            sessionId: crypto.randomUUID(),
            messages: [],
          },
        });

        await prisma.callLog.upsert({
          where: { callSid },
          create: {
            businessId: business.id,
            callSid,
            from: fromNumber,
            to: toNumber,
            direction: 'INBOUND',
            type: 'VOICE',
            status: 'INITIATED',
            source: 'VOICE_CALL',
            conversationId: conversation.id,
            metadata: { streamSid: state.streamSid },
          },
          update: {
            metadata: { streamSid: state.streamSid },
            updatedAt: new Date(),
          },
        });

        // Load agent config and initialize realtime client
        await this.loadAgentConfig(state);
        
        const systemPrompt = await this.buildSystemPrompt(state);

        if (state.ttsProvider === 'realtime' && !state.openaiClient) {
          await this.initializeOpenAIRealtimeClient(state, systemPrompt);
        }

        // Always update instructions with the latest context
        if (state.openaiClient) {
          console.log('[RealtimeAgent] Updating OpenAI Realtime client with full context prompt.');
          state.openaiClient.updateInstructions(systemPrompt);
        }

        // Deliver the initial greeting now that we have full business context.
        if (!state.welcomeMessageDelivered) {
          try {
            if (state.openaiClient) {
              // Realtime voice: ask the assistant to produce the first response based on the system prompt.
              state.openaiClient.requestAssistantResponse()
            } else {
              // Fallback TTS pipeline (OpenAI or Polly)
              const welcome = await this.getWelcomeMessage(state)
              await this.streamTTS(state, welcome)
            }
          } catch (err) {
            console.error('[RealtimeAgent] Failed to send greeting:', err)
          } finally {
            state.welcomeMessageDelivered = true
          }
        }

      } else {
        console.warn('[RealtimeAgent] Business not found for phone number:', toNumber, '. Proceeding with default flow.');
        // Populate minimal state for call to continue
        state.businessId = null;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Provide a generic greeting
        if (!state.welcomeMessageDelivered) {
          if (state.openaiClient) {
            state.openaiClient.sendUserText('Welcome to StudioConnect AI. How can I help you today?');
            state.openaiClient.requestAssistantResponse();
          } else {
            await this.streamTTS(state, 'Welcome to StudioConnect AI. How can I help you today?');
          }
          state.welcomeMessageDelivered = true;
        }
      }
    } catch (error) {
      console.error('[RealtimeAgent] Error handling start event:', error);
      this.cleanup('Error handling start event');
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
        state.ttsProvider = (cfg as any).ttsProvider || (cfg.useOpenaiTts ? 'openai' : 'polly');
        state.openaiVoice = (cfg.openaiVoice || 'nova').toLowerCase();
        state.openaiModel = cfg.openaiModel || 'tts-1';
        state.personaPrompt = cfg.personaPrompt;
        console.log(`[RealtimeAgent] Loaded agent config for business ${state.businessId}:`, {
          ttsProvider: state.ttsProvider,
          openaiVoice: state.openaiVoice,
        });
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to load agentConfig – falling back to defaults:', (err as Error).message);
    } finally {
      state.__configLoaded = true;
    }
  }

  private async initializeOpenAIRealtimeClient(state: ConnectionState, initialPrompt: string): Promise<void> {
    if (state.openaiClient || !process.env.OPENAI_API_KEY) return;

    console.log('[REALTIME AGENT] Initializing OpenAI Realtime Client...');
    try {
      const client = new OpenAIRealtimeClient(
        process.env.OPENAI_API_KEY,
        state.openaiVoice,
        initialPrompt,
      );
      await client.connect();

      // Relay assistant audio back to Twilio in real time
      client.on('assistantAudio', (b64) => {
        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.ws.send(JSON.stringify({
            event: 'media',
            streamSid: state.streamSid,
            media: { payload: b64 },
          }));
        }
      });

      // Handle text responses to maintain conversation history
      client.on('assistantMessage', (text) => {
        this.addToConversationHistory(state, 'assistant', text);
        console.log(`[REALTIME AGENT] Assistant: ${text}`);
      });

      // Handle errors
      client.on('error', (error) => {
        console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error);
      });

      client.on('close', () => {
        console.log('[REALTIME AGENT] OpenAI Realtime Client connection closed.');
        // Invalidate the client so it can be re-established if needed
        state.openaiClient = undefined;
      });

      state.openaiClient = client;
      console.log('[REALTIME AGENT] OpenAI Realtime Client connected successfully.');
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to establish OpenAI realtime session – will use local pipeline', err);
      // Fallback so we don't keep trying
      state.ttsProvider = 'openai';
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

        // Always run VAD to manage conversation turn-taking.
        const buf = Buffer.from(mediaPayload, 'base64')
        let energy = 0
        for (let i = 0; i < buf.length; i++) energy += Math.abs(buf[i] - 128)
        energy = energy / buf.length

        // Dynamic noise-floor calibration (first 50 frames)
        if (!state.vadCalibrated) {
          state.vadNoiseFloor += energy
          state.vadSamples += 1
          if (state.vadSamples >= 50) {
            state.vadNoiseFloor = state.vadNoiseFloor / state.vadSamples
            state.vadThreshold = state.vadNoiseFloor + 8 // margin
            state.vadCalibrated = true
            console.log(`[REALTIME AGENT] VAD calibrated with noise floor ${state.vadNoiseFloor} and threshold ${state.vadThreshold}`)
          }
        }

        const now = Date.now()
        const threshold = state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD

        // If realtime client is active, stream audio directly and use VAD for turn-taking.
        if (state.openaiClient) {
          state.openaiClient.sendAudio(mediaPayload)

          if (energy > threshold) {
            if (!state.isRecording) {
              console.log('[REALTIME AGENT] VAD speech detected.')
              state.isRecording = true
            }
            state.lastSpeechMs = now
          }

          // If user was speaking but is now silent, it's the assistant's turn.
          if (state.isRecording && now - state.lastSpeechMs > VAD_SILENCE_MS) {
            console.log('[REALTIME AGENT] VAD detected end of speech, requesting assistant response.')
            state.openaiClient.requestAssistantResponse()
            state.isRecording = false // Reset for next utterance
          }
          return // VAD logic for realtime is complete
        }

        // --- Fallback to local Whisper pipeline if realtime client is not available ---

        // Ignore media frames until we have resolved business context.
        if (!state.businessId) return

        if (energy > threshold) {
          // Speech detected – begin or continue recording
          if (!state.isRecording) {
            state.isRecording = true
            // Reset the queue at the start of a new utterance so we don't prepend previous noise
            state.audioQueue = []
          }
          state.lastSpeechMs = now
          state.audioQueue.push(mediaPayload)
        } else if (state.isRecording) {
          // Continue capturing trailing silence while recording
          state.audioQueue.push(mediaPayload)
        }

        // Flush when we've been in silence for a while **and** we were previously recording
        if (state.isRecording && !state.isProcessing && now - state.lastSpeechMs > VAD_SILENCE_MS && state.audioQueue.length > 0) {
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