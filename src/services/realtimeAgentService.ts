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
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
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
  private ws: WebSocket | null = null;
  private state: ConnectionState;
  private readonly openaiApiKey: string;
  public onCallSidReceived?: (callSid: string) => void;
  private conversationSummary: string = '';
  private currentQuestionIndex: number = 0;
  private leadCaptureQuestions: Question[] = [];
  private callSid: string = '';

  public constructor() {
    console.log('[DEBUG] 0. Initializing RealtimeAgentService...');
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
      console.error('[DEBUG] FATAL: OPENAI_API_KEY is missing');
      throw new Error('OPENAI_API_KEY is required for RealtimeAgentService');
    }

    this.state = {
      isTwilioReady: false,
      isAiReady: false,
      streamSid: null,
      audioQueue: [],
      conversationHistory: [],
      businessId: null,
      leadCaptureTriggered: false,
      hasCollectedLeadInfo: false,
      isCallActive: false,
      welcomeMessageDelivered: false,
      welcomeMessageAttempts: 0,
      isCleaningUp: false,
    };

    this.setupTwilioListeners();
    console.log('[DEBUG] 0a. RealtimeAgentService initialization complete.');
  }

  static getInstance(): RealtimeAgentService {
    if (!RealtimeAgentService.instance) {
      RealtimeAgentService.instance = new RealtimeAgentService();
    }
    return RealtimeAgentService.instance;
  }

  /**
   * Establishes bidirectional audio bridge between Twilio and OpenAI
   */
  public async connect(ws: WebSocket): Promise<void> {
    console.log('[DEBUG] 1. Connecting to Twilio WebSocket...');
    this.ws = ws;
    this.setupTwilioListeners();
    console.log('[DEBUG] 1a. Twilio WebSocket connection setup complete.');
  }

  private setupTwilioListeners(): void {
    console.log('[DEBUG] 2. Setting up Twilio listeners...');
    if (!this.ws) {
      console.error('[DEBUG] Twilio WebSocket not initialized');
      return;
    }

    const pingInterval = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.ping();
      }
    }, 30000);

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[DEBUG] Twilio WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
      clearInterval(pingInterval);
      this.cleanup('Twilio');
    });

    this.ws.on('error', (error: Error) => {
      console.error('[DEBUG] Twilio WebSocket error:', error);
      clearInterval(pingInterval);
      this.cleanup('Twilio');
    });

    this.ws.on('pong', () => {
      console.log('[DEBUG] Received pong from Twilio');
    });

    this.ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('[DEBUG] 3. Received Twilio message:', data.event);

        if (data.event === 'start') {
          console.log('[DEBUG] 3a. Processing start event...');
          const callSid = data.start?.callSid;
          this.state.streamSid = data.start?.streamSid;
          this.state.isTwilioReady = true;
          this.callSid = callSid;

          if (this.onCallSidReceived) {
            this.onCallSidReceived(callSid);
          }

          if (!callSid) {
            console.error('[RealtimeAgent] CallSid not found in start message');
            this.cleanup('Twilio');
            return;
          }

          try {
            const callDetails = await twilioClient.calls(callSid).fetch();
            const toPhoneNumber = callDetails.to;
            console.log('[DEBUG] 3b. Call details fetched:', { toPhoneNumber });

            const business = await prisma.business.findUnique({
              where: { twilioPhoneNumber: toPhoneNumber }
            });

            if (business) {
              console.log('[DEBUG] 3c. Business found:', business.id);
              this.state.businessId = business.id;
              this.state.isCallActive = true;
              this.connectToOpenAI();
            } else {
              console.error('[DEBUG] Business not found for phone number:', toPhoneNumber);
              this.cleanup('Other');
            }
          } catch (error) {
            console.error(`[RealtimeAgent] Failed to fetch call details from Twilio API for ${callSid}:`, error);
            this.cleanup('Other');
            return;
          }
        } else if (data.event === 'media') {
          console.log('[DEBUG] 3d. Processing media event...');
          if (this.ws?.readyState === 1) {
            const audioAppend = {
              type: 'input_audio_buffer.append',
              audio: data.media.payload
            };
            this.ws.send(JSON.stringify(audioAppend));
            console.log('[DEBUG] 3e. Audio forwarded to OpenAI');
          }

          if (this.ws?.readyState === 1 && this.state.streamSid) {
            const markMessage = {
              event: 'mark',
              streamSid: this.state.streamSid,
              mark: { name: `audio_processed_${Date.now()}` }
            };
            this.ws.send(JSON.stringify(markMessage));
          }
        }
      } catch (error) {
        console.error('[DEBUG] Error processing Twilio message:', error);
      }
    });

    console.log('[DEBUG] 2a. Twilio listeners setup complete.');
  }

  private connectToOpenAI(): void {
    console.log('[DEBUG] 4. Connecting to OpenAI...');
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    const headers = {
      'Authorization': `Bearer ${this.openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    };

    this.ws = new WebSocket(url, { headers });
    this.setupOpenAIListeners();
    console.log('[DEBUG] 4a. OpenAI WebSocket connection initiated.');
  }

  private setupOpenAIListeners(): void {
    console.log('[DEBUG] 5. Setting up OpenAI listeners...');
    if (!this.ws) {
      console.error('[DEBUG] OpenAI WebSocket not initialized');
      return;
    }

    this.ws.on('open', () => {
      console.log('[DEBUG] 5a. OpenAI WebSocket connected');
      this.state.isAiReady = true;
      this.configureOpenAiSession();
    });

    this.ws.on('close', () => {
      console.log('[DEBUG] OpenAI WebSocket closed');
      this.cleanup('OpenAI');
    });

    this.ws.on('error', (error: Error) => {
      console.error('[DEBUG] OpenAI WebSocket error:', error);
      this.cleanup('OpenAI');
    });

    this.ws.on('message', (data: any) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('[DEBUG] 6. Received OpenAI message:', response.type);

        switch (response.type) {
          case 'response.audio.delta':
            if (this.ws?.readyState === 1 && this.state.streamSid) {
              const twilioMessage = {
                event: 'media',
                streamSid: this.state.streamSid,
                media: { payload: response.delta }
              };
              this.ws.send(JSON.stringify(twilioMessage));
              console.log('[DEBUG] 6a. Audio forwarded to Twilio');
            }
            break;

          case 'input_audio_buffer.speech_started':
            console.log('[DEBUG] 6b. Speech started');
            if (this.ws?.readyState === 1) {
              this.ws.send(JSON.stringify({ type: 'response.cancel' }));
            }
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('[DEBUG] 6c. Speech stopped');
            if (this.ws?.readyState === 1) {
              this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
              this.ws.send(JSON.stringify({ type: 'response.create' }));
            }
            break;

          case 'response.text.delta':
            console.log('[DEBUG] 6d. Text delta received:', response.delta);
            break;

          case 'response.text.done':
            console.log('[DEBUG] 6e. Text response complete');
            break;
        }
      } catch (error) {
        console.error('[DEBUG] Error processing OpenAI message:', error);
      }
    });

    console.log('[DEBUG] 5b. OpenAI listeners setup complete.');
  }

  private async configureOpenAiSession(): Promise<void> {
    console.log('[DEBUG] 7. Configuring OpenAI session...');
    if (!this.ws || this.ws.readyState !== 1) {
      console.error('[DEBUG] OpenAI WebSocket not ready for configuration');
      return;
    }

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries. Keep responses concise and conversational.',
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    this.ws.send(JSON.stringify(sessionConfig));
    console.log('[DEBUG] 7a. OpenAI session configuration sent');

    if (!this.state.welcomeMessageDelivered && this.state.businessId) {
      console.log('[DEBUG] 7b. Triggering welcome message...');
      await this.triggerGreeting();
    }
  }

  private async triggerGreeting(): Promise<void> {
    console.log('[DEBUG] 7c. Preparing welcome message...');
    try {
      const welcomeMessage = await this.getWelcomeMessage(this.state.businessId!);
      console.log('[DEBUG] 7d. Welcome message retrieved:', welcomeMessage);

      if (this.ws?.readyState === 1) {
        const textEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Please say this exact welcome message to the caller: "${welcomeMessage}"`
            }]
          }
        };

        this.ws.send(JSON.stringify(textEvent));
        console.log('[DEBUG] 7e. Welcome message sent to OpenAI');

        setTimeout(() => {
          if (this.ws?.readyState === 1) {
            this.ws.send(JSON.stringify({ type: 'response.create' }));
            console.log('[DEBUG] 7f. Response creation triggered');
          }
        }, 100);

        this.state.welcomeMessageDelivered = true;
      }
    } catch (error) {
      console.error('[DEBUG] Error triggering greeting:', error);
    }
  }

  private handleOpenAiAudio(audioB64: string): void {
    if (this.ws?.readyState === 1 && this.state.streamSid) {
      const twilioMessage = {
        event: 'media',
        streamSid: this.state.streamSid,
        media: { payload: audioB64 }
      };
      this.ws.send(JSON.stringify(twilioMessage));
    }
  }

  private addToConversationHistory(role: 'user' | 'assistant', content: string): void {
    this.state.conversationHistory.push({
      role,
      content,
      timestamp: new Date()
    });
  }

  public async cleanup(source: string, error?: Error): Promise<void> {
    if (this.state.isCleaningUp) {
      console.log('[DEBUG] Cleanup already in progress, skipping');
      return;
    }

    console.log(`[DEBUG] 8. Cleanup triggered by: ${source}`);
    if (error) console.error('[DEBUG] Cleanup reason:', error);

    this.state.isCleaningUp = true;

    console.log('[DEBUG] 8a. Delaying cleanup for 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.state.conversationHistory.length > 0 && this.state.businessId) {
      console.log('[DEBUG] 8b. Processing lead creation...');
      await this.processLeadCreation();
    } else {
      console.log('[DEBUG] 8b. Skipping lead creation (no history or businessId)');
    }

    console.log('[DEBUG] 8c. Closing WebSocket connections...');
    this.ws?.close();
    console.log('[DEBUG] 8d. Cleanup complete');
  }

  private async processLeadCreation(): Promise<void> {
    console.log('[DEBUG] 9. Processing lead creation...');
    try {
      const leadInfo = this.extractLeadInformation();
      console.log('[DEBUG] 9a. Extracted lead information:', leadInfo);

      const conversationText = this.state.conversationHistory.map(msg => msg.content).join(' ');
      const isEmergency = await this.detectEmergencyWithAI(conversationText);
      console.log('[DEBUG] 9b. Emergency detection result:', isEmergency);

      const lead = await prisma.lead.create({
        data: {
          businessId: this.state.businessId!,
          capturedData: leadInfo,
          status: 'NEW',
          priority: isEmergency ? 'URGENT' : 'NORMAL',
          contactName: leadInfo.name,
          contactEmail: leadInfo.email,
          contactPhone: leadInfo.phone
        }
      });

      console.log('[DEBUG] 9c. Lead created successfully:', lead.id);
      await this.sendLeadNotifications(lead);
      console.log('[DEBUG] 9d. Lead notifications sent');
    } catch (error) {
      console.error('[DEBUG] Error processing lead:', error);
    }
  }

  private async sendLeadNotifications(lead: any): Promise<void> {
    console.log('[DEBUG] 10. Sending lead notifications...');
    try {
      const business = await prisma.business.findUnique({
        where: { id: this.state.businessId! }
      });

      if (!business) {
        console.error('[DEBUG] Business not found for notifications');
        return;
      }

      if (business.notificationEmail) {
        console.log('[DEBUG] 10a. Sending email notification...');
        await sendLeadNotificationEmail(
          business.notificationEmail,
          lead,
          lead.priority,
          business.name
        );
      }

      if (lead.priority === 'URGENT' && business.notificationPhoneNumber) {
        console.log('[DEBUG] 10b. Sending emergency voice call...');
        await initiateEmergencyVoiceCall(
          business.notificationPhoneNumber,
          business.name,
          lead.capturedData.emergency_notes || 'Emergency situation reported',
          business.id
        );
      }

      if (lead.capturedData.email) {
        console.log('[DEBUG] 10c. Sending customer confirmation...');
        await sendLeadConfirmationToCustomer(
          lead.capturedData.email,
          business.name,
          lead,
          lead.priority === 'URGENT'
        );
      }

      console.log('[DEBUG] 10d. All notifications sent successfully');
    } catch (error) {
      console.error('[DEBUG] Error sending notifications:', error);
    }
  }

  private async detectEmergencyWithAI(message: string): Promise<boolean> {
    console.log('[DEBUG] 11. Detecting emergency with AI...');
    try {
      const response = await getChatCompletion(message);

      if (!response) {
        console.error('[DEBUG] No response from AI for emergency detection');
        return false;
      }

      const isEmergency = response.toLowerCase().includes('true');
      console.log('[DEBUG] 11a. Emergency detection result:', isEmergency);
      return isEmergency;
    } catch (error) {
      console.error('[DEBUG] Error detecting emergency:', error);
      return false;
    }
  }

  private extractLeadInformation(): Record<string, any> {
    console.log('[DEBUG] 12. Extracting lead information...');
    const leadInfo: Record<string, any> = {};
    const conversation = this.state.conversationHistory.map(msg => msg.content).join(' ');

    // Extract name
    const nameMatch = conversation.match(/name is (\w+)/i) || conversation.match(/my name is (\w+)/i);
    if (nameMatch) leadInfo.name = nameMatch[1];

    // Extract email
    const emailMatch = conversation.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) leadInfo.email = emailMatch[0];

    // Extract phone
    const phoneMatch = conversation.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
    if (phoneMatch) leadInfo.phone = phoneMatch[0];

    // Extract emergency notes if present
    if (conversation.toLowerCase().includes('emergency')) {
      leadInfo.emergency_notes = conversation;
    }

    console.log('[DEBUG] 12a. Extracted lead information:', leadInfo);
    return leadInfo;
  }

  private async getWelcomeMessage(businessId: string): Promise<string> {
    console.log('[DEBUG] 13. Getting welcome message...');
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        include: { agentConfig: true }
      });

      if (!business) {
        console.error('[DEBUG] Business not found for welcome message');
        return 'Hello! Thank you for calling. How can I help you today?';
      }

      const welcomeMessage = business.agentConfig?.voiceGreetingMessage || 
                           business.agentConfig?.welcomeMessage || 
                           'Hello! Thank you for calling. How can I help you today?';

      console.log('[DEBUG] 13a. Welcome message retrieved:', welcomeMessage);
      return welcomeMessage;
    } catch (error) {
      console.error('[DEBUG] Error getting welcome message:', error);
      return 'Hello! Thank you for calling. How can I help you today?';
    }
  }

  public getCallSid(): string {
    return this.callSid;
  }

  public getConnectionStatus(): string {
    const wsStatus = this.ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
    return `WebSocket: ${wsStatus}, Twilio Ready: ${this.state.isTwilioReady}, AI Ready: ${this.state.isAiReady}`;
  }
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 