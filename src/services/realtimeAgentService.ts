import { WebSocket } from 'ws';
import twilio from 'twilio';
import { PrismaClient, CallStatus, CallType, CallDirection } from '@prisma/client';
import { processMessage } from '../core/aiHandler';
import { getChatCompletion } from '../services/openai';
import { cleanVoiceResponse } from '../utils/voiceHelpers';
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from './notificationService';
import OpenAI from 'openai';
import { generateSpeechFromText } from './openai';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { getBusinessWelcomeMessage } from './businessService';
import { getClientByPhoneNumber } from './clientService';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const openai = new OpenAI();

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

// State management
const activeAgents = new Map<string, AgentState>();
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
      toNumber: null
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
        const welcomeMessage = await this.getWelcomeMessage(state)
        this.sendTwilioMessage(callSid, welcomeMessage)
      } catch (error) {
        console.error('[REALTIME AGENT] Error sending welcome message:', error)
        this.sendTwilioMessage(callSid, 'Welcome to StudioConnect AI. How can I help you today?')
      }

      await prisma.callLog.create({
        data: {
          businessId,
          conversationId: crypto.randomUUID(),
          callSid,
          from: fromNumber ?? '',
          to: '',
          direction: CallDirection.INBOUND,
          type: CallType.VOICE,
          status: CallStatus.INITIATED,
          source: 'TWILIO'
        }
      })
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
        this.connections.delete(this.callSid);
        console.log(`[REALTIME AGENT] Cleaned up connection for call ${this.callSid}: ${reason}`);
      }
    }
    this.callSid = null;
  }

  private sendTwilioMessage(callSid: string, message: string): void {
    try {
      this.twilioClient.calls(callSid)
        .update({ twiml: `<Response><Say>${message}</Say></Response>` });
    } catch (error) {
      console.error(`[REALTIME AGENT] Error sending Twilio message:`, error);
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
      const toNumber = callDetails.to ?? '';
      const fromNumber = callDetails.from ?? '';
      console.log('[DEBUG] 3b. Call details fetched:', { toNumber, fromNumber });

      // Find business by phone number
      const business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: toNumber }
      });

      if (!business) {
        console.error('[RealtimeAgent] Business not found for phone number:', toNumber);
        this.cleanup('Business not found');
        return;
      }

      // Create conversation
      const conversation = await prisma.conversation.create({
        data: {
          businessId: business.id,
          sessionId: crypto.randomUUID(),
          messages: []
        }
      });

      // Log the call
      await prisma.callLog.create({
        data: {
          businessId: business.id,
          callSid,
          from: fromNumber,
          to: toNumber,
          direction: CallDirection.INBOUND,
          type: CallType.VOICE,
          status: CallStatus.INITIATED,
          source: 'VOICE_CALL',
          conversationId: conversation.id,
          metadata: {
            streamSid: state.streamSid
          }
        }
      });

      // Update state
      state.businessId = business.id;
      state.fromNumber = fromNumber;
      state.toNumber = toNumber;

      // Now that we have both callSid and business context, send the welcome greeting to the caller.
      try {
        const welcomeMessage = await this.getWelcomeMessage(state)
        this.sendTwilioMessage(callSid, welcomeMessage)
      } catch (err) {
        console.error('[RealtimeAgent] Error sending welcome message after START event:', err)
      }

      // Connect to OpenAI if needed
      if (this.connectToOpenAI) this.connectToOpenAI();
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

        const { businessId } = state
        const callSid = state.callSid ?? 'UNKNOWN_CALLSID'

        processMessage({
          message: mediaPayload,
          conversationHistory: state.conversationHistory,
          businessId: businessId ?? '',
          currentActiveFlow: state.currentFlow ?? null,
          callSid,
          channel: 'VOICE'
        })
          .then((response) => {
            this.addToConversationHistory(state, 'user', mediaPayload)
            this.addToConversationHistory(state, 'assistant', response.reply)
            state.currentFlow = response.currentFlow || null

            if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
              state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
            }

            if (state.callSid) this.sendTwilioMessage(state.callSid, response.reply)
          })
          .catch((err) => {
            console.error('[REALTIME AGENT] Error processing MEDIA payload:', err)
            if (state.callSid) {
              this.sendTwilioMessage(state.callSid, 'I encountered an error while processing your request. Please try again.')
            }
          })
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