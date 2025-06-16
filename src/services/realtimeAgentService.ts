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
  lastSpeechMs: number;
  vadCalibrated: boolean;
  vadSamples: number;
  vadNoiseFloor: number;
  vadThreshold: number;
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
      lastSpeechMs: Date.now(),
      vadCalibrated: false,
      vadSamples: 0,
      vadNoiseFloor: 0,
      vadThreshold: 25,
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
          // Attempt to send welcome via realtime voice first; fallback to TTS
          try {
            if (state.openaiClient) {
              state.openaiClient.sendUserText(welcomeMessage)
              state.openaiClient.requestAssistantResponse()
            } else {
              await this.streamTTS(state, welcomeMessage)
            }
          } catch {
            await this.streamTTS(state, welcomeMessage)
          }
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
        const client = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY, state.openaiVoice)
        await client.connect()

        // Relay assistant audio back to Twilio in real time
        client.onAssistantAudio((b64) => {
          if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
            state.ws.send(JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload: b64 }
            }))
          }
        })

        state.openaiClient = client

        // Trigger greeting via realtime if not yet delivered
        if (!state.welcomeMessageDelivered) {
          const welcome = await this.getWelcomeMessage(state)
          client.sendUserText(welcome)
          client.requestAssistantResponse()
          state.welcomeMessageDelivered = true
        }
      } catch (err) {
        console.error('[RealtimeAgent] Failed to establish OpenAI realtime session – reverting to local pipeline', err)
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
          const cfg = await prisma.agentConfig.findUnique({ where: { businessId: state.businessId } })
          if (cfg) {
            state.ttsProvider = (cfg as any).ttsProvider || (cfg.useOpenaiTts ? 'openai' : 'polly')
            state.openaiVoice = (cfg.openaiVoice || 'NOVA').toLowerCase()
            state.openaiModel = cfg.openaiModel || 'tts-1'
          }
        } catch (err) {
          console.error('[REALTIME AGENT] Failed to load agentConfig – falling back to defaults:', (err as Error).message)
          // swallow – we already have safe defaults on the state object
        } finally {
          // Ensure we never attempt the lookup again for this call, even if it failed
          state.__configLoaded = true
        }
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
    if (state.audioQueue.length === 0) return

    try {
      const rawBuffers = state.audioQueue.map((b64) => Buffer.from(b64, 'base64'))
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

      // Reset queue regardless of transcription success
      state.audioQueue = []

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

      // Find business by phone number using multiple matching strategies to account for formatting differences
      const digitsOnly = toNumber.replace(/[^0-9]/g, '')

      // Attempt exact E.164 match first
      let business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: toNumber },
        select: {
          id: true,
          twilioPhoneNumber: true,
        },
      })

      // Fallback: try digits-only match (common if number stored without '+')
      if (!business) {
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: digitsOnly },
          select: {
            id: true,
            twilioPhoneNumber: true,
          },
        })
      }

      // Fallback: try matching numbers that *end* with the 10-digit national significant number
      if (!business && digitsOnly.length >= 10) {
        const lastTen = digitsOnly.slice(-10)
        business = await prisma.business.findFirst({
          where: {
            twilioPhoneNumber: {
              endsWith: lastTen,
            },
          },
          select: {
            id: true,
            twilioPhoneNumber: true,
          },
        })
      }

      if (!business) {
        console.warn('[RealtimeAgent] Business not found for phone number:', toNumber, '. Proceeding with default flow.');

        // Try a more lenient in-memory match by normalizing digits of stored phone numbers
        const allBusinesses = await prisma.business.findMany({
          where: {
            twilioPhoneNumber: {
              not: null
            }
          },
          select: {
            id: true,
            twilioPhoneNumber: true
          }
        })

        // Ensure we have the 10-digit national significant number for comparison
        const lastTen = digitsOnly.slice(-10)

        const matchBySanitized = allBusinesses.find((b: { id: string; twilioPhoneNumber: string | null }) => {
          const storedDigits = (b.twilioPhoneNumber || '').replace(/[^0-9]/g, '')
          return storedDigits.endsWith(lastTen)
        })

        if (matchBySanitized) {
          business =
            (await prisma.business.findUnique({
              where: { id: matchBySanitized.id },
              select: {
                id: true,
                twilioPhoneNumber: true,
              },
            })) ?? null
        }
      }

      if (!business) {
        // Even without a business context, populate minimal state so the call can continue.
        state.businessId = null
        state.fromNumber = fromNumber
        state.toNumber = toNumber

        // Provide a generic greeting so callers are not met with silence
        if (!state.welcomeMessageDelivered) {
          await this.streamTTS(state, 'Welcome to StudioConnect AI. How can I help you today?')
          state.welcomeMessageDelivered = true
        }
      } else {
        // Create conversation for a recognized business
        const conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            sessionId: crypto.randomUUID(),
            messages: []
          }
        })

        // Log the call – use upsert to avoid duplicate key errors when Twilio reconnects
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
            metadata: {
              streamSid: state.streamSid
            }
          },
          update: {
            // Update metadata if we reconnect and have a new streamSid
            metadata: {
              streamSid: state.streamSid
            },
            updatedAt: new Date()
          }
        })

        // Update state when business is recognized
        state.businessId = business.id
        state.fromNumber = fromNumber
        state.toNumber = toNumber

        // Send the business-specific welcome message now that we have context
        if (!state.welcomeMessageDelivered) {
          const welcomeMessage = await this.getWelcomeMessage(state)
          await this.streamTTS(state, welcomeMessage)
          state.welcomeMessageDelivered = true
        }
      }
    } catch (error) {
      console.error('[RealtimeAgent] Error handling start event:', error);
      this.cleanup('Error handling start event');
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
    const state = [...this.connections.values()].find((s) => s.ws === ws)

    if (!state) {
      console.warn('[REALTIME AGENT] Received stream event for unknown WebSocket')
      return
    }

    const eventType = payload.event as string | undefined

    switch (eventType) {
      case 'start': {
        // The START event provides the definitive CallSid – remap the state so future look-ups are cheap
        try {
          this.handleStartEvent(state, payload)

          const startCallSid = (payload as any).start?.callSid as string | undefined
          if (startCallSid) {
            // If the state is stored under a temporary key, move it under the real CallSid
            const existingKey = [...this.connections.entries()].find(([_, val]) => val === state)?.[0]
            if (existingKey && existingKey !== startCallSid) {
              this.connections.delete(existingKey)
              this.connections.set(startCallSid, state)
            }
            state.callSid = startCallSid
          }
        } catch (error) {
          console.error('[REALTIME AGENT] Error processing START event:', error)
        }
        break
      }
      case 'media': {
        const mediaPayload = (payload as any).media?.payload as string | undefined
        if (!mediaPayload) return

        // If realtime client is active, stream directly
        if (state.openaiClient) {
          state.openaiClient.sendAudio(mediaPayload)
          return
        }

        // Fallback: existing Whisper pipeline

        // Ignore media frames until we have resolved business context.
        if (!state.businessId) return

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
          }
        }

        const now = Date.now()
        const threshold = state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD

        if (energy > threshold) {
          state.lastSpeechMs = now
          state.audioQueue.push(mediaPayload)
        } else {
          state.audioQueue.push(mediaPayload)
        }

        if (now - state.lastSpeechMs > VAD_SILENCE_MS && state.audioQueue.length > 0) {
          this.flushAudioQueue(state)
        }
        break
      }
      case 'stop':
      case 'end': {
        // Clean-up when Twilio signals the end of the stream.
        this.cleanup('Twilio STOP event')
        if (!state.callSid) ws.close()
        break
      }
      default:
        console.warn('[REALTIME AGENT] Unhandled Twilio stream event type:', eventType)
    }
  }
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 