import { WebSocket } from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
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
import { Twilio } from 'twilio';
import { getBusinessWelcomeMessage } from '../services/businessService';
import { getClientByPhoneNumber } from '../services/clientService';

const prisma = new PrismaClient();
const openai = new OpenAI();

// Initialize Twilio REST client for fetching call details
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface AgentSession {
  ws: WebSocket;
  businessId: string;
  conversationId: string;
  isActive: boolean;
  lastActivity: Date;
}

// This new interface will help manage the state of our connections
interface ConnectionState {
  ws: WebSocket;
  callSid: string;
  businessId: string;
  fromPhoneNumber?: string;
  clientId?: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

interface Question {
  questionText: string;
  order: number;
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
function startCleanupInterval() {
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
function logMemoryUsage(context: string) {
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  console.log(`[Memory ${context}] RSS: ${formatBytes(usage.rss)}MB, Heap Used: ${formatBytes(usage.heapUsed)}MB`);
}

async function cleanupTempFile(filePath: string) {
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
export class RealtimeAgentService {
  private static instance: RealtimeAgentService;
  private connections: Map<string, ConnectionState>;
  private twilioClient: Twilio;

  private constructor() {
    this.connections = new Map();
    this.twilioClient = new Twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }

  public static getInstance(): RealtimeAgentService {
    if (!RealtimeAgentService.instance) {
      RealtimeAgentService.instance = new RealtimeAgentService();
    }
    return RealtimeAgentService.instance;
  }

  public async handleNewConnection(ws: WebSocket, params: URLSearchParams) {
    const callSid = params.get('callSid');
    const businessId = params.get('businessId');
    const fromPhoneNumber = params.get('fromPhoneNumber');

    if (!callSid || !businessId) {
      console.error('[REALTIME AGENT] Missing required parameters:', { callSid, businessId });
      ws.close(1008, 'Missing required parameters');
      return;
    }

    console.log(`[REALTIME AGENT] New connection for call ${callSid} to business ${businessId}`);

    // Initialize connection state
    const state: ConnectionState = {
      ws,
      callSid,
      businessId,
      fromPhoneNumber: fromPhoneNumber || undefined,
      conversationHistory: []
    };

    // Try to identify client if phone number is available
    if (fromPhoneNumber) {
      try {
        const client = await getClientByPhoneNumber(businessId, fromPhoneNumber);
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
  }

  private async getWelcomeMessage(state: ConnectionState): Promise<string> {
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

  private setupTwilioListeners(state: ConnectionState) {
    const { callSid, businessId, clientId } = state;

    // Handle start event
    this.twilioClient.calls(callSid)
      .on('start', async () => {
        console.log(`[REALTIME AGENT] Call ${callSid} started`);
        // State is already initialized with businessId and callSid
      });

    // Handle media stream
    this.twilioClient.calls(callSid)
      .on('media', async (media) => {
        if (!media.payload) return;

        try {
          const response = await processMessage(
            media.payload,
            state.conversationHistory,
            businessId,
            clientId,
            callSid,
            'VOICE'
          );

          // Update conversation history
          state.conversationHistory.push(
            { role: 'user', content: media.payload },
            { role: 'assistant', content: response.reply }
          );

          // Keep conversation history at a reasonable size
          if (state.conversationHistory.length > 10) {
            state.conversationHistory = state.conversationHistory.slice(-10);
          }

          this.sendTwilioMessage(callSid, response.reply);
        } catch (error) {
          console.error(`[REALTIME AGENT] Error processing message:`, error);
          this.sendTwilioMessage(callSid, 'I apologize, but I encountered an error processing your request. Could you please try again?');
        }
      });

    // Handle end event
    this.twilioClient.calls(callSid)
      .on('end', () => {
        console.log(`[REALTIME AGENT] Call ${callSid} ended`);
        this.cleanupConnection(callSid);
      });
  }

  private setupWebSocketListeners(state: ConnectionState) {
    const { ws, callSid } = state;

    ws.on('close', () => {
      console.log(`[REALTIME AGENT] WebSocket closed for call ${callSid}`);
      this.cleanupConnection(callSid);
    });

    ws.on('error', (error) => {
      console.error(`[REALTIME AGENT] WebSocket error for call ${callSid}:`, error);
      this.cleanupConnection(callSid);
    });
  }

  private cleanupConnection(callSid: string) {
    const state = this.connections.get(callSid);
    if (!state) return;

    try {
      state.ws.close();
    } catch (error) {
      console.error(`[REALTIME AGENT] Error closing WebSocket:`, error);
    }

    this.connections.delete(callSid);
    console.log(`[REALTIME AGENT] Cleaned up connection for call ${callSid}`);
  }

  private sendTwilioMessage(callSid: string, message: string) {
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
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 