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
  callSid: string | null;
  lastActivity: number;
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
  private twilioWs: WebSocket | null = null;
  private openAiWs: WebSocket | null = null;
  private state: ConnectionState;
  private readonly openaiApiKey: string;
  private readonly model: string = 'gpt-4o-realtime-preview-2024-10-01';
  public onCallSidReceived?: (callSid: string) => void;
  private conversationSummary: string = '';
  private currentQuestionIndex: number = 0;
  private leadCaptureQuestions: Question[] = [];
  private callSid: string = '';
  private pingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

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
      callSid: null,
      lastActivity: Date.now()
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
  public async connect(twilioWs: WebSocket): Promise<void> {
    console.log('[DEBUG] 1. Connecting to Twilio WebSocket...');
    this.twilioWs = twilioWs;
    this.setupTwilioListeners();
    console.log('[DEBUG] 1a. Twilio WebSocket connection setup complete.');
  }

  private async sendWebSocketMessage(ws: WebSocket | null, message: any, context: string): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(`[DEBUG] Cannot send ${context} - WebSocket not ready`);
      return;
    }

    try {
      ws.send(JSON.stringify(message));
      console.log(`[DEBUG] ${context} sent successfully`);
    } catch (error) {
      console.error(`[DEBUG] Error sending ${context}:`, error);
      this.cleanup('WebSocket', error as Error);
    }
  }

  private setupTwilioListeners(): void {
    console.log('[DEBUG] 2. Setting up Twilio listeners...');
    if (!this.twilioWs) {
      console.error('[DEBUG] Twilio WebSocket not initialized');
      return;
    }

    const pingInterval = setInterval(() => {
      if (this.twilioWs?.readyState === WebSocket.OPEN) {
        this.twilioWs.ping();
      }
    }, 30000);

    this.twilioWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[DEBUG] Twilio WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
      clearInterval(pingInterval);
      this.cleanup('Twilio');
    });

    this.twilioWs.on('error', (error: Error) => {
      console.error('[DEBUG] Twilio WebSocket error:', error);
      clearInterval(pingInterval);
      this.cleanup('Twilio');
    });

    this.twilioWs.on('pong', () => {
      console.log('[DEBUG] Received pong from Twilio');
    });

    this.twilioWs.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('[DEBUG] 3. Received Twilio message:', data.event);

        if (data.event === 'start') {
          console.log('[DEBUG] 3a. Processing start event...');
          const callSid = data.start?.callSid;
          this.state.streamSid = data.start?.streamSid;
          this.state.isTwilioReady = true;
          this.state.callSid = callSid;

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
          await this.sendWebSocketMessage(this.openAiWs, {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
          }, 'Audio to OpenAI');

          await this.sendWebSocketMessage(this.twilioWs, {
            event: 'mark',
            streamSid: this.state.streamSid,
            mark: { name: `audio_processed_${Date.now()}` }
          }, 'Mark to Twilio');
        }
      } catch (error) {
        console.error('[DEBUG] Error processing Twilio message:', error);
      }
    });

    console.log('[DEBUG] 2a. Twilio listeners setup complete.');
  }

  private connectToOpenAI(): void {
    console.log('[DEBUG] 4. Connecting to OpenAI...');
    const url = 'wss://api.openai.com/v1/realtime/sessions';
    const headers = {
      'Authorization': `Bearer ${this.openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    };

    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 1000; // Start with 1 second delay

    const connect = () => {
      if (this.openAiWs) {
        console.log('[DEBUG] Closing existing OpenAI WebSocket connection');
        this.openAiWs.close();
      }

      console.log(`[DEBUG] Attempting OpenAI connection (attempt ${retryCount + 1}/${maxRetries})`);
      this.openAiWs = new WebSocket(url, { headers });
      this.setupOpenAIListeners();
    };

    connect();

    this.openAiWs?.on('error', (error) => {
      console.error('[DEBUG] OpenAI WebSocket error:', error);
      if (retryCount < maxRetries) {
        retryCount++;
        const delay = retryDelay * Math.pow(2, retryCount - 1); // Exponential backoff
        console.log(`[DEBUG] Retrying OpenAI connection in ${delay}ms (${retryCount}/${maxRetries})...`);
        setTimeout(connect, delay);
      } else {
        console.error('[DEBUG] Max retries reached for OpenAI connection');
        this.cleanup('OpenAI', error);
      }
    });

    this.openAiWs?.on('close', (code, reason) => {
      console.log(`[DEBUG] OpenAI WebSocket closed with code ${code} and reason: ${reason}`);
      if (retryCount < maxRetries && !this.state.isCleaningUp) {
        retryCount++;
        const delay = retryDelay * Math.pow(2, retryCount - 1);
        console.log(`[DEBUG] Attempting reconnection in ${delay}ms (${retryCount}/${maxRetries})...`);
        setTimeout(connect, delay);
      } else if (!this.state.isCleaningUp) {
        console.error('[DEBUG] Max retries reached for OpenAI connection');
        this.cleanup('OpenAI');
      }
    });
  }

  private setupOpenAIListeners(): void {
    console.log('[DEBUG] 5. Setting up OpenAI listeners...');
    if (!this.openAiWs) {
      console.error('[DEBUG] OpenAI WebSocket not initialized');
      return;
    }

    this.openAiWs.on('open', () => {
      console.log('[DEBUG] 5a. OpenAI WebSocket connected');
      this.state.isAiReady = true;
    });

    this.openAiWs.on('close', () => {
      console.log('[DEBUG] OpenAI WebSocket closed');
      this.state.isAiReady = false;
      this.cleanup('OpenAI');
    });

    this.openAiWs.on('error', (error: Error) => {
      console.error('[DEBUG] OpenAI WebSocket error:', error);
      this.cleanup('OpenAI', error);
    });

    this.openAiWs.on('message', async (data: any) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('[DEBUG] Received OpenAI message:', response.type);

        switch (response.type) {
          case 'session.created':
            console.log('[DEBUG] Session created, configuring...');
            await this.configureOpenAiSession();
            break;

          case 'session.updated':
            console.log('[DEBUG] Session configured, ready for audio');
            if (!this.state.welcomeMessageDelivered && this.state.businessId) {
              await this.triggerGreeting();
            }
            break;

          case 'response.audio.delta':
            if (this.twilioWs?.readyState === WebSocket.OPEN && this.state.streamSid) {
              await this.sendWebSocketMessage(this.twilioWs, {
                event: 'media',
                streamSid: this.state.streamSid,
                media: { payload: response.delta }
              }, 'Audio delta to Twilio');
            }
            break;

          case 'input_audio_buffer.speech_started':
            console.log('[DEBUG] Speech started');
            this.state.lastActivity = Date.now();
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('[DEBUG] Speech stopped');
            await this.sendWebSocketMessage(this.openAiWs, {
              type: 'input_audio_buffer.commit'
            }, 'Commit audio to OpenAI');
            await this.sendWebSocketMessage(this.openAiWs, {
              type: 'response.create'
            }, 'Create response to OpenAI');
            break;

          case 'response.text.delta':
            console.log('[DEBUG] Text delta received:', response.delta);
            this.state.lastActivity = Date.now();
            break;

          case 'response.text.done':
            console.log('[DEBUG] Text response complete');
            this.state.lastActivity = Date.now();
            break;

          case 'error':
            console.error('[DEBUG] OpenAI error:', response.error);
            this.cleanup('OpenAI', new Error(response.error));
            break;
        }
      } catch (error) {
        console.error('[DEBUG] Error handling OpenAI message:', error);
      }
    });

    console.log('[DEBUG] 5b. OpenAI listeners setup complete.');
  }

  private async configureOpenAiSession(): Promise<void> {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) return;

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries. Keep responses concise and conversational.',
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'auto',
          temperature: 0.2,
          prompt: 'This is a business conversation. The assistant is helpful and professional.'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        },
        response_format: {
          type: 'text',
          text: {
            temperature: 0.7,
            max_tokens: 150
          }
        }
      }
    };

    await this.sendWebSocketMessage(this.openAiWs, sessionConfig, 'Session config to OpenAI');
  }

  private async triggerGreeting(): Promise<void> {
    if (!this.state.isAiReady || !this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) {
      console.log('[DEBUG] Cannot trigger greeting, system not ready');
      return;
    }

    try {
      const welcomeMessage = await this.getWelcomeMessage(this.state.businessId!);
      console.log('[DEBUG] Triggering greeting:', welcomeMessage);

      // Step 1: Send the text to be spoken
      await this.sendWebSocketMessage(this.openAiWs, {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'input_text',
            text: welcomeMessage
          }]
        }
      }, 'Welcome message to OpenAI');

      // Step 2: Send the command to generate a response
      await this.sendWebSocketMessage(this.openAiWs, {
        type: 'response.create'
      }, 'Response creation to OpenAI');

      this.state.welcomeMessageDelivered = true;
    } catch (error) {
      console.error('[DEBUG] Error triggering greeting:', error);
    }
  }

  private handleOpenAiAudio(audioB64: string): void {
    if (this.twilioWs?.readyState === WebSocket.OPEN && this.state.streamSid) {
      const twilioMessage = {
        event: 'media',
        streamSid: this.state.streamSid,
        media: { payload: audioB64 }
      };
      this.twilioWs.send(JSON.stringify(twilioMessage));
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
    console.log(`[DEBUG] Cleanup initiated from ${source}${error ? ` with error: ${error.message}` : ''}`)
    
    // Only trigger fallback once for an active call
    if (this.state.isTwilioReady && this.state.callSid && !this.state.isCleaningUp) {
      try {
        console.log(`[Fallback] ${source} connection failed. Redirecting call ${this.state.callSid} to fallback handler.`)
        
        // Create fallback TwiML
        const fallbackTwiml = new twilio.twiml.VoiceResponse()
        fallbackTwiml.say({ voice: 'alice' }, 'We are experiencing difficulties with our AI voice service. Please wait while we connect you to our standard system.')
        fallbackTwiml.redirect({ method: 'POST' }, '/api/voice/fallback-handler')

        // Update the live call to use fallback handler
        this.state.isCleaningUp = true
        await twilioClient.calls(this.state.callSid).update({
          twiml: fallbackTwiml.toString()
        })
      } catch (fallbackError) {
        console.error('[Fallback] Failed to redirect call:', fallbackError)
      }
    }

    // Clean up WebSocket connections
    if (this.openAiWs) {
      this.openAiWs.close()
      this.openAiWs = null
    }
    
    if (this.twilioWs) {
      this.twilioWs.close()
      this.twilioWs = null
    }
    
    // Clear intervals
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    
    // Reset state
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
      isCleaningUp: true,
      callSid: null,
      lastActivity: Date.now()
    }
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

      const welcomeMessage = business.agentConfig?.welcomeMessage || 
                           'Hello! Thank you for calling. How can I help you today?';

      console.log('[DEBUG] 13a. Welcome message retrieved:', welcomeMessage);
      return welcomeMessage;
    } catch (error) {
      console.error('[DEBUG] Error getting welcome message:', error);
      return 'Hello! Thank you for calling. How can I help you today?';
    }
  }

  public getCallSid(): string {
    return this.state.callSid || '';
  }

  public getConnectionStatus(): string {
    const wsStatus = this.twilioWs?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
    return `WebSocket: ${wsStatus}, Twilio Ready: ${this.state.isTwilioReady}, AI Ready: ${this.state.isAiReady}`;
  }

  public getActiveConnections(): number {
    return this.state.isCallActive ? 1 : 0;
  }
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance(); 