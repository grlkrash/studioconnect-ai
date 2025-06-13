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

    if (!callSid || !businessId) {
      console.error('[REALTIME AGENT] Missing required parameters:', { callSid, businessId });
      ws.close(1008, 'Missing required parameters');
      return;
    }

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

    this.connections.set(callSid, state);
    this.setupTwilioListeners(state);
    this.setupWebSocketListeners(state);

    // Send welcome message
    try {
      const welcomeMessage = await this.getWelcomeMessage(state);
      this.sendTwilioMessage(callSid, welcomeMessage);
    } catch (error) {
      console.error(`[REALTIME AGENT] Error sending welcome message:`, error);
      this.sendTwilioMessage(callSid, 'Welcome to StudioConnect AI. How can I help you today?');
    }

    // Update the CallLog creation
    const callLog = await prisma.callLog.create({
      data: {
        businessId,
        conversationId: crypto.randomUUID(),
        callSid,
        from: fromNumber || '',
        to: '',
        direction: CallDirection.INBOUND,
        type: CallType.VOICE,
        status: CallStatus.INITIATED,
        source: 'TWILIO'
      }
    });
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

    // Handle start event
    (this.twilioClient.calls(callSid) as any)
      .on('start', async (data: any) => {
        await this.handleStartEvent(state, data);
      });

    // Handle media stream
    (this.twilioClient.calls(callSid) as any)
      .on('media', async (media: TwilioMedia) => {
        if (!media.payload) return;

        try {
          const response = await processMessage(
            media.payload,
            state.conversationHistory,
            businessId,
            state.currentFlow || null,
            callSid,
            'VOICE'
          );

          // Update conversation history and current flow
          this.addToConversationHistory(state, 'user', media.payload);
          this.addToConversationHistory(state, 'assistant', response.reply);
          state.currentFlow = response.currentFlow || null;

          // Keep conversation history at a reasonable size
          if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
            state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
          }

          this.sendTwilioMessage(callSid, response.reply);
        } catch (error) {
          console.error(`[REALTIME AGENT] Error processing message:`, error);
          this.sendTwilioMessage(callSid, 'I apologize, but I encountered an error processing your request. Could you please try again?');
        }
      });

    // Handle end event
    (this.twilioClient.calls(callSid) as any)
      .on('end', () => {
        console.log(`[REALTIME AGENT] Call ${callSid} ended`);
        this.cleanup(callSid);
      });
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
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 