import { WebSocket, WebSocketServer } from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
import { processMessage } from '../core/aiHandler';
import { getChatCompletion } from '../services/openai';
import { cleanVoiceResponse } from '../utils/voiceHelpers';

const prisma = new PrismaClient();

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
}

/**
 * RealtimeAgentService - Two-way audio bridge between Twilio and OpenAI
 * Handles real-time bidirectional voice conversations with lead capture integration
 */
export class RealtimeAgentService {
  private twilioWs: WebSocket | null = null;
  private openAiWs: WebSocket | null = null;
  private callSid: string = '';
  private state: ConnectionState;
  private readonly openaiApiKey: string;
  public onCallSidReceived?: (callSid: string) => void;
  private conversationSummary: string = '';
  private currentQuestionIndex: number = 0;
  private leadCaptureQuestions: any[] = [];

  constructor(twilioWs: WebSocket) {
    // CallSid will be extracted from Twilio start message parameters (more reliable than URL)
    this.twilioWs = twilioWs;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
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
    };

    // Set up Twilio WebSocket listeners immediately
    this.setupTwilioListeners();
    
    console.log('[RealtimeAgent] Service initialized - waiting for CallSid from start message');
  }

  /**
   * Establishes bidirectional audio bridge between Twilio and OpenAI
   */
  public async connect(twilioWs: WebSocket): Promise<void> {
    try {
      this.twilioWs = twilioWs;
      console.log(`[RealtimeAgent] Connection initiated for call ${this.callSid}`);
      
      // Set up Twilio WebSocket listeners - connection to OpenAI will be triggered by 'start' event
      this.setupTwilioListeners();
    } catch (error) {
      console.error('[RealtimeAgent] Error in connect:', error);
      throw error;
    }
  }

  private setupTwilioListeners() {
    if (!this.twilioWs) {
      console.error(`[RealtimeAgent] Cannot setup Twilio listeners: WebSocket is null for call ${this.callSid}`);
      return;
    }

    console.log(`[RealtimeAgent] Setting up Twilio listeners for call ${this.callSid}. Current WebSocket state: ${this.twilioWs.readyState}`);

    // Add ping interval to keep connection alive
    const pingInterval = setInterval(() => {
      if (this.twilioWs?.readyState === WebSocket.OPEN) {
        this.twilioWs.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    this.twilioWs.on('message', (message: Buffer) => {
      this.handleTwilioMessage(message);
    });

    this.twilioWs.on('close', (code: number, reason: Buffer) => {
      clearInterval(pingInterval);
      console.log(`[RealtimeAgent] Twilio WebSocket closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.cleanup('Twilio');
    });

    this.twilioWs.on('error', (error: Error) => {
      clearInterval(pingInterval);
      console.error(`[RealtimeAgent] Twilio WebSocket error for call ${this.callSid}:`, error);
      this.cleanup('Twilio');
    });

    this.twilioWs.on('pong', () => {
      console.log(`[RealtimeAgent] Received pong from Twilio for call ${this.callSid}`);
    });
  }

  private handleTwilioMessage(message: Buffer) {
    try {
      const msg = JSON.parse(message.toString());
      console.log(`[RealtimeAgent] Received Twilio message:`, msg);
      
      if (msg.event === "connected") {
        console.log(`[RealtimeAgent] Twilio stream connected for call ${this.callSid}`);
      } else if (msg.event === "start") {
        // Extract CallSid from start message (correct location)
        this.callSid = msg.start.callSid;
        
        if (!this.callSid) {
          console.error('[RealtimeAgent] CallSid not found in start message');
          this.cleanup('Twilio');
          return;
        }
        
        console.log(`[RealtimeAgent] CallSid received from start message: ${this.callSid}`);
        
        // Notify WebSocket server that we have the CallSid
        if (this.onCallSidReceived) {
          this.onCallSidReceived(this.callSid);
        }
        
        this.state.streamSid = msg.start.streamSid;
        this.state.isTwilioReady = true;
        console.log(`[RealtimeAgent] Twilio stream started for call ${this.callSid}. streamSid: ${this.state.streamSid}`);
        // Now that we have streamSid, we can safely connect to OpenAI
        this.connectToOpenAI();
      } else if (msg.event === "media") {
        // Forward audio from Twilio to OpenAI
        if (this.openAiWs?.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          };
          this.openAiWs.send(JSON.stringify(audioAppend));
        }
        
        // Send mark message back to Twilio to keep audio stream alive
        if (this.state.streamSid && this.twilioWs) {
          const markMsg = {
            event: "mark", 
            streamSid: this.state.streamSid,
            mark: { name: `forwarded_to_openai_${Date.now()}` }
          };
          this.twilioWs.send(JSON.stringify(markMsg));
        }
      } else if (msg.event === "stop") {
        console.log(`[RealtimeAgent] Twilio stream stopped for call: ${this.callSid}`);
        this.cleanup('Twilio');
      }
    } catch (error) {
      console.error('[RealtimeAgent] Error handling Twilio message:', error);
    }
  }

  private connectToOpenAI() {
    console.log(`[RealtimeAgent] Connecting to OpenAI Realtime API for call: ${this.callSid}`);
    
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    const headers = {
      'Authorization': `Bearer ${this.openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    };

    console.log(`[RealtimeAgent] OpenAI WebSocket URL: ${url}`);
    console.log(`[RealtimeAgent] OpenAI WebSocket headers:`, headers);

    this.openAiWs = new WebSocket(url, { headers });
    this.setupOpenAIListeners();
  }

  private setupOpenAIListeners(): void {
    if (!this.openAiWs) return;

    this.openAiWs.on('open', async () => {
      console.log(`[RealtimeAgent] OpenAI connection opened for ${this.callSid}. Configuring session.`);
      await this.configureOpenAiSession();
    });

    // Add ping interval to keep connection alive
    const pingInterval = setInterval(() => {
      if (this.openAiWs?.readyState === WebSocket.OPEN) {
        this.openAiWs.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    this.openAiWs.on('message', (data: Buffer) => {
      const message = data.toString();
      try {
        const response = JSON.parse(message);
        console.log(`[RealtimeAgent] Received message from OpenAI:`, response);

        switch (response.type) {
          case 'session.created':
            console.log(`[RealtimeAgent] OpenAI session created for call ${this.callSid}`);
            this.state.isAiReady = true;
            this.state.isCallActive = true;
            this.triggerGreeting();
            break;

          case 'session.error':
            console.error(`[RealtimeAgent] OpenAI Session Error for call ${this.callSid}:`, response.error);
            this.cleanup('OpenAI');
            break;
            
          case 'response.audio.delta':
            this.handleOpenAiAudio(response.delta);
            break;

          case 'conversation.item.created':
            if (response.item?.role === 'assistant' && response.item?.content?.[0]?.text) {
              const transcript = response.item.content[0].text;
              console.log(`[RealtimeAgent] AI says: "${transcript}" (Call: ${this.callSid})`);
              this.addToConversationHistory('assistant', transcript);
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            if (response.item?.transcript) {
              const userTranscript = response.item.transcript;
              console.log(`[RealtimeAgent] User says: "${userTranscript}" (Call: ${this.callSid})`);
              this.addToConversationHistory('user', userTranscript);
            }
            break;
            
          case 'input_audio_buffer.speech_stopped':
            console.log(`[RealtimeAgent] User stopped speaking for call ${this.callSid}`);
            setTimeout(() => {
              if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
                try {
                  this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                } catch (error) {
                  console.log(`[RealtimeAgent] Audio commit ignored (buffer may be empty) for call ${this.callSid}`);
                }
              }
            }, 100);
            break;
            
          case 'error':
            console.error(`[RealtimeAgent] OpenAI error for call ${this.callSid}: ${response.message}`);
            break;
        }
      } catch (error) {
        console.error(`[RealtimeAgent] Error parsing OpenAI message for call ${this.callSid}:`, error);
      }
    });

    this.openAiWs.on('close', (code: number, reason: Buffer) => {
      clearInterval(pingInterval);
      console.log(`[RealtimeAgent] OpenAI WebSocket closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.cleanup();
    });

    this.openAiWs.on('error', (error: Error) => {
      clearInterval(pingInterval);
      console.error(`[RealtimeAgent] OpenAI WebSocket error for call ${this.callSid}:`, error);
      this.cleanup();
    });

    this.openAiWs.on('pong', () => {
      console.log(`[RealtimeAgent] Received pong from OpenAI for call ${this.callSid}`);
    });
  }

  private async configureOpenAiSession(): Promise<void> {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) {
      console.log('[RealtimeAgent] OpenAI WebSocket not ready for session configuration.');
      return;
    }

    console.log(`[RealtimeAgent] Configuring OpenAI session for call ${this.callSid}.`);

    let businessInstructions = 'You are a helpful AI assistant. Respond naturally and helpfully. Keep responses concise and conversational.';
    let openaiVoice = 'alloy'; // Default voice - lowercase as per API spec
    let openaiModel = 'tts-1'; // Default TTS model

    try {
      const callDetails = await twilioClient.calls(this.callSid).fetch();
      const toPhoneNumber = callDetails.to;
      
      if (toPhoneNumber) {
        const business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: toPhoneNumber },
          include: {
            agentConfig: {
              include: { questions: { orderBy: { order: 'asc' } } }
            }
          }
        });
        
        if (business) {
          this.state.businessId = business.id;
          console.log(`[RealtimeAgent] Business ID stored: ${business.id} for call ${this.callSid}`);
          
          // Get the configured voice and model
          if (business.agentConfig?.openaiVoice) {
            // Convert to lowercase and validate
            const configuredVoice = business.agentConfig.openaiVoice.toLowerCase();
            const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
            openaiVoice = validVoices.includes(configuredVoice) ? configuredVoice : 'nova';
            console.log(`[RealtimeAgent] Using configured OpenAI voice: ${openaiVoice}`);
          }
          if (business.agentConfig?.openaiModel) {
            openaiModel = business.agentConfig.openaiModel;
            console.log(`[RealtimeAgent] Using configured OpenAI TTS model: ${openaiModel}`);
          }
          
          const businessName = business.name;
          const questions = business.agentConfig?.questions || [];
          const welcomeMessage = await this.getWelcomeMessage(business.id);
          
          businessInstructions = `You are a professional AI receptionist for ${businessName}. Your ONLY goal is to serve callers on behalf of this specific business.

AFTER the initial greeting, listen to the user and respond accordingly.

EMERGENCY DETECTION PROTOCOL:
FIRST, detect if the caller's message indicates an EMERGENCY (burst pipe, flooding, no heat in freezing weather, gas leak, electrical hazard, water damage):
- If EMERGENCY detected: Immediately say "I understand this is an emergency situation. I can connect you directly to our team right now, or quickly gather your details so they can respond immediately. What would you prefer?"
- If they choose "connect now": Say "Absolutely! I'm connecting you to our emergency line right now. Please hold while I transfer your call."
- If they choose "gather details": Ask these EMERGENCY questions ONLY: 
  1) "What's your exact address or location?" 
  2) After they provide the address, ALWAYS confirm it by repeating it back and asking "Is that correct?" 
  3) If they say no or correct it, ask them to repeat the correct address and confirm again
  4) Only proceed to next question after address is confirmed
  5) "What's your name?" 
  6) "What's your phone number?" 
  7) "Can you describe the emergency situation in detail?"

NORMAL LEAD CAPTURE: For non-emergency situations, ask questions one at a time:
${questions.map((q, index) => `${index + 1}. ${q.questionText}`).join('\n')}

CRITICAL RULES:
BUSINESS IDENTITY: You work EXCLUSIVELY for ${businessName}. NEVER suggest competitors.
KNOWLEDGE BOUNDARIES: Only use information explicitly provided. NEVER invent details.
FORBIDDEN: Do NOT restart conversations, repeat greetings mid-call, or invent information.
VOICE OPTIMIZATION: Keep responses under 25 seconds when spoken. Use natural, conversational language.
CONVERSATION FLOW: ONLY respond when the user has clearly spoken. If you detect silence or unclear audio, WAIT for a clear user input. Do NOT continue asking questions if the user hasn't responded clearly.`;
        }
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error fetching business config for session setup:`, error);
    }

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: businessInstructions,
        voice: openaiVoice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { 
          model: 'whisper-1',
          language: 'en'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    console.log(`[RealtimeAgent] Sending session configuration for call ${this.callSid}:`, sessionConfig);
    try {
      this.openAiWs.send(JSON.stringify(sessionConfig));
      console.log(`[RealtimeAgent] OpenAI session configured for call ${this.callSid} with business-specific instructions`);
    } catch (error) {
      console.error(`[RealtimeAgent] Failed to send session configuration:`, error);
      this.cleanup('OpenAI');
      return;
    }

    // Wait for session creation before triggering greeting
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session creation timeout'));
      }, 30000); // Increased from 10s to 30s

      const handler = (event: { data: any }) => {
        try {
          const response = JSON.parse(event.data.toString());
          console.log(`[RealtimeAgent] Received response during session creation:`, response);
          if (response.type === 'session.created') {
            clearTimeout(timeout);
            this.openAiWs!.removeEventListener('message', handler);
            resolve();
          } else if (response.type === 'session.error') {
            clearTimeout(timeout);
            this.openAiWs!.removeEventListener('message', handler);
            reject(new Error(`Session error: ${response.error}`));
          } else if (response.type === 'error') {
            clearTimeout(timeout);
            this.openAiWs!.removeEventListener('message', handler);
            reject(new Error(`OpenAI error: ${response.message}`));
          }
        } catch (error) {
          console.error(`[RealtimeAgent] Error handling session creation response:`, error);
        }
      };
      this.openAiWs!.addEventListener('message', handler);
    }).catch(error => {
      console.error(`[RealtimeAgent] Session creation failed:`, error);
      this.cleanup('OpenAI');
      return;
    });

    // Now trigger the greeting after session is created
    await this.triggerGreeting();
  }

  private handleOpenAiAudio(audioB64: string) {
    try {
      console.log(`[RealtimeAgent] Handling OpenAI audio for call ${this.callSid}. Audio length: ${audioB64.length}`);
      console.log(`[RealtimeAgent] Current WebSocket states:`, {
        openAiWsState: this.openAiWs?.readyState,
        twilioWsState: this.twilioWs?.readyState,
        isTwilioReady: this.state.isTwilioReady,
        streamSid: this.state.streamSid
      });

      // Validate audio data
      if (!audioB64 || typeof audioB64 !== 'string') {
        console.error(`[RealtimeAgent] Invalid audio data received for call ${this.callSid}`);
        return;
      }

      // Add audio to queue for processing
      this.state.audioQueue.push(audioB64);
      console.log(`[RealtimeAgent] Added audio to queue. Queue length: ${this.state.audioQueue.length}`);
      this.processAudioQueue();
    } catch (error) {
      console.error(`[RealtimeAgent] Error handling OpenAI audio:`, error);
    }
  }

  private processAudioQueue() {
    // Only process audio if both connections are ready
    if (!this.state.isTwilioReady || !this.state.streamSid || !this.twilioWs) {
      console.log(`[RealtimeAgent] Not ready to process audio queue for call ${this.callSid}. State:`, {
        isTwilioReady: this.state.isTwilioReady,
        streamSid: this.state.streamSid,
        twilioWsState: this.twilioWs?.readyState
      });
      return;
    }

    // Process all queued audio chunks
    while (this.state.audioQueue.length > 0) {
      try {
        const audioChunk = this.state.audioQueue.shift();
        if (!audioChunk) continue;

        if (this.twilioWs.readyState === WebSocket.OPEN) {
          const twilioMsg = {
            event: "media",
            streamSid: this.state.streamSid,
            media: { payload: audioChunk },
          };
          
          // Send mark message to keep stream alive
          const markMsg = {
            event: "mark",
            streamSid: this.state.streamSid,
            mark: { name: `audio_processed_${Date.now()}` }
          };

          // Send both messages
          this.twilioWs.send(JSON.stringify(twilioMsg));
          this.twilioWs.send(JSON.stringify(markMsg));
          
          console.log(`[RealtimeAgent] Forwarded audio chunk to Twilio for call ${this.callSid}. Chunk size: ${audioChunk.length}`);
        } else {
          console.error(`[RealtimeAgent] Twilio WebSocket not open for call ${this.callSid}. State: ${this.twilioWs.readyState}`);
          this.cleanup('Twilio');
          return;
        }
      } catch (error) {
        console.error(`[RealtimeAgent] Error processing audio chunk for call ${this.callSid}:`, error);
        // Don't break the loop, try to process remaining chunks
      }
    }
  }

  /**
   * Sends a message to the OpenAI Realtime API
   */
  public sendMessage(message: any): void {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) {
      console.error(`[RealtimeAgent] Cannot send message for call ${this.callSid}: OpenAI WebSocket not connected`);
      return;
    }

    try {
      this.openAiWs.send(JSON.stringify(message));
      console.log(`[RealtimeAgent] Message sent to OpenAI for call ${this.callSid}:`, message.type);
    } catch (error) {
      console.error(`[RealtimeAgent] Failed to send message to OpenAI for call ${this.callSid}:`, error);
    }
  }

  /**
   * Adds conversation entry to history
   */
  private addToConversationHistory(role: 'user' | 'assistant', content: string): void {
    this.state.conversationHistory.push({
      role,
      content,
      timestamp: new Date()
    });
    
    console.log(`[RealtimeAgent] Added to conversation history [${role}]: ${content.substring(0, 100)}...`);
  }

  /**
   * Analyzes conversation for lead capture opportunities
   */
  private async analyzeForLeadCapture(): Promise<boolean> {
    if (this.state.leadCaptureTriggered || !this.state.businessId) {
      return false;
    }

    const recentMessages = this.state.conversationHistory.slice(-6); // Last 6 messages
    const conversationText = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');

    // Use simplified intent detection
    const leadIndicators = [
      'price', 'cost', 'quote', 'estimate', 'service', 'repair', 'fix', 'install', 
      'problem', 'issue', 'help', 'need', 'appointment', 'schedule', 'emergency',
      'urgent', 'how much', 'do you', 'can you'
    ];

    const hasLeadIntent = leadIndicators.some(indicator => 
      conversationText.toLowerCase().includes(indicator)
    );

    if (hasLeadIntent && recentMessages.length >= 4) {
      console.log(`[RealtimeAgent] Lead capture triggered for call ${this.callSid}`);
      this.state.leadCaptureTriggered = true;
      return true;
    }

    return false;
  }

  /**
   * Processes lead creation at end of call
   */
  private async processLeadCreation(): Promise<void> {
    try {
      // Validate business configuration first
      if (!this.state.businessId) {
        console.error('[RealtimeAgent] No business ID available for lead creation');
        return;
      }

      const hasValidConfig = await this.validateBusinessConfig(this.state.businessId);
      if (!hasValidConfig) {
        console.error('[RealtimeAgent] Business configuration validation failed, skipping lead creation');
        return;
      }

      // Extract information from conversation
      const extractedInfo = this.extractLeadInformation();
      
      // Check for emergency in the first user message
      const firstUserMessage = this.state.conversationHistory.find(entry => entry.role === 'user')?.content;
      const isEmergency = firstUserMessage ? await this.detectEmergencyWithAI(firstUserMessage) : false;
      
      // Prepare conversation for AI
      const conversationForAI = this.state.conversationHistory.map(entry => ({
        role: entry.role,
        content: entry.content
      }));

      // Create lead record with emergency priority if detected
      const newLead = await prisma.lead.create({
        data: {
          businessId: this.state.businessId,
          status: 'NEW',
          priority: isEmergency ? 'URGENT' : 'NORMAL',
          conversationTranscript: JSON.stringify(conversationForAI),
          capturedData: {
            ...extractedInfo,
            emergency_notes: isEmergency ? firstUserMessage : null
          },
          contactName: extractedInfo.name || null,
          contactEmail: extractedInfo.email || null,
          contactPhone: extractedInfo.phone || null,
          notes: `Voice call lead - CallSid: ${this.callSid}${isEmergency ? ' - EMERGENCY DETECTED' : ''}`
        }
      });

      console.log(`[RealtimeAgent] Lead created successfully:`, {
        leadId: newLead.id,
        isEmergency,
        priority: newLead.priority
      });

      // Send notifications immediately
      await this.sendLeadNotifications(newLead);

    } catch (error) {
      console.error(`[RealtimeAgent] Error creating lead for call ${this.callSid}:`, error);
    }
  }

  /**
   * Enhanced emergency detection using AI
   */
  private async detectEmergencyWithAI(message: string): Promise<boolean> {
    try {
      const emergencyCheckPrompt = `Does the following user message indicate an emergency situation (e.g., burst pipe, flooding, no heat in freezing weather, gas leak, electrical hazard, water heater leak)? Respond with only YES or NO. User message: '${message}'`;
      
      const isEmergencyResponse = await getChatCompletion(
        emergencyCheckPrompt, 
        "You are an emergency detection assistant specialized in identifying urgent home service situations."
      );
      
      const isEmergency = cleanVoiceResponse(isEmergencyResponse || 'NO').trim().toUpperCase() === 'YES';
      
      console.log(`[RealtimeAgent] Emergency detection result:`, {
        message,
        isEmergency,
        rawResponse: isEmergencyResponse
      });
      
      return isEmergency;
    } catch (error) {
      console.error(`[RealtimeAgent] Error in AI emergency detection:`, error);
      // Fallback to keyword-based detection if AI fails
      return this.detectEmergency();
    }
  }

  /**
   * Extracts lead information from conversation
   */
  private extractLeadInformation(): Record<string, any> {
    const conversationText = this.state.conversationHistory
      .map(entry => entry.content)
      .join(' ');

    const extractedInfo: Record<string, any> = {};

    // Simple extraction patterns
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phoneRegex = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/;
    const nameRegex = /(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i;

    const emailMatch = conversationText.match(emailRegex);
    if (emailMatch) extractedInfo.email = emailMatch[0];

    const phoneMatch = conversationText.match(phoneRegex);
    if (phoneMatch) extractedInfo.phone = phoneMatch[0];

    const nameMatch = conversationText.match(nameRegex);
    if (nameMatch) extractedInfo.name = nameMatch[1];

    // Add conversation summary
    extractedInfo.conversation_summary = this.state.conversationHistory
      .filter(entry => entry.role === 'user')
      .map(entry => entry.content)
      .join(' | ');

    return extractedInfo;
  }

  /**
   * Detects if conversation indicates emergency
   */
  private detectEmergency(): boolean {
    const conversationText = this.state.conversationHistory
      .map(entry => entry.content)
      .join(' ')
      .toLowerCase();

    const emergencyKeywords = [
      'emergency', 'urgent', 'burst', 'flooding', 'leak', 'no heat', 
      'no hot water', 'electrical issue', 'gas smell', 'water damage',
      'basement flooding', 'pipe burst', 'toilet overflowing'
    ];

    return emergencyKeywords.some(keyword => conversationText.includes(keyword));
  }

  /**
   * Sends lead notifications
   */
  private async sendLeadNotifications(lead: any): Promise<void> {
    try {
      const business = await prisma.business.findUnique({
        where: { id: this.state.businessId! }
      });

      if (!business) {
        console.error(`[RealtimeAgent] Business not found for ID: ${this.state.businessId}`);
        return;
      }

      // Import notification functions
      const { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } = 
        await import('../services/notificationService');

      // Send email notification to business
      if (business.notificationEmail) {
        try {
          await sendLeadNotificationEmail(
            business.notificationEmail,
            {
              capturedData: lead.capturedData,
              conversationTranscript: lead.conversationTranscript,
              contactName: lead.contactName,
              contactEmail: lead.contactEmail,
              contactPhone: lead.contactPhone,
              notes: lead.notes,
              createdAt: lead.createdAt,
              status: lead.status
            },
            lead.priority,
            business.name
          );
          console.log(`[RealtimeAgent] Lead notification email sent for call ${this.callSid}`);
        } catch (emailError) {
          console.error(`[RealtimeAgent] Failed to send notification email:`, emailError);
        }
      } else {
        console.warn(`[RealtimeAgent] No notification email configured for business ${business.id}`);
      }

      // Send emergency call if urgent
      if (lead.priority === 'URGENT') {
        if (!business.notificationPhoneNumber) {
          console.warn(`[RealtimeAgent] No notification phone number configured for emergency calls for business ${business.id}`);
          return;
        }

        if (!process.env.TWILIO_PHONE_NUMBER) {
          console.error('[RealtimeAgent] TWILIO_PHONE_NUMBER environment variable is not set');
          return;
        }

        try {
          const emergencyDetails = lead.capturedData?.conversation_summary || 'Voice call emergency';
          await initiateEmergencyVoiceCall(
            business.notificationPhoneNumber,
            business.name,
            emergencyDetails,
            business.id
          );
          console.log(`[RealtimeAgent] Emergency call initiated for call ${this.callSid}`);
        } catch (callError) {
          console.error(`[RealtimeAgent] Failed to initiate emergency call:`, callError);
        }
      }

      // Send customer confirmation if email available
      if (lead.contactEmail) {
        try {
          await sendLeadConfirmationToCustomer(
            lead.contactEmail,
            business.name,
            lead,
            lead.priority === 'URGENT'
          );
          console.log(`[RealtimeAgent] Customer confirmation sent for call ${this.callSid}`);
        } catch (confirmationError) {
          console.error(`[RealtimeAgent] Failed to send customer confirmation:`, confirmationError);
        }
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error in sendLeadNotifications for call ${this.callSid}:`, error);
    }
  }

  public cleanup(source: 'Twilio' | 'OpenAI' | 'Other' = 'Other') {
    console.log(`[RealtimeAgent] Cleanup triggered by ${source} for call ${this.callSid}.`);
    console.log(`[RealtimeAgent] Current WebSocket states:`, {
      openAiWsState: this.openAiWs?.readyState,
      twilioWsState: this.twilioWs?.readyState
    });
    
    // Process lead creation before cleanup if we have conversation data
    if (this.state.conversationHistory.length > 0 && this.state.businessId) {
      console.log(`[RealtimeAgent] Processing lead creation before cleanup for call ${this.callSid}`);
      this.processLeadCreation().catch(error => {
        console.error(`[RealtimeAgent] Error processing lead creation during cleanup:`, error);
      });
    }
    
    if (this.openAiWs && this.openAiWs.readyState !== WebSocket.CLOSED) {
      this.openAiWs.close();
      this.openAiWs = null;
    }
    
    if (this.twilioWs && this.twilioWs.readyState !== WebSocket.CLOSED) {
      this.twilioWs.close();
      this.twilioWs = null;
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
    };
  }

  /**
   * Public disconnect method for compatibility
   */
  public disconnect(): void {
    this.cleanup('Other');
  }

  /**
   * Gets the current connection status
   */
     public getConnectionStatus(): string {
     const openAiStatus = !this.openAiWs ? 'disconnected' : 
       this.openAiWs.readyState === WebSocket.CONNECTING ? 'connecting' :
       this.openAiWs.readyState === WebSocket.OPEN ? 'connected' :
       this.openAiWs.readyState === WebSocket.CLOSING ? 'closing' : 'closed';
     
     const twilioStatus = !this.twilioWs ? 'disconnected' :
       this.twilioWs.readyState === WebSocket.CONNECTING ? 'connecting' :
       this.twilioWs.readyState === WebSocket.OPEN ? 'connected' :
       this.twilioWs.readyState === WebSocket.CLOSING ? 'closing' : 'closed';
     
     return `OpenAI: ${openAiStatus}, Twilio: ${twilioStatus}, State: AI=${this.state.isAiReady}, Twilio=${this.state.isTwilioReady}`;
   }

  /**
   * Gets the call SID associated with this service instance
   */
  public getCallSid(): string {
    return this.callSid;
  }

  /**
   * Validates that the business has proper notification settings configured
   * @param businessId - The ID of the business to validate
   * @returns {Promise<boolean>} True if business has valid notification settings
   */
  private async validateBusinessConfig(businessId: string): Promise<boolean> {
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: {
          notificationEmail: true,
          notificationPhoneNumber: true,
          name: true
        }
      });
      
      if (!business) {
        console.error(`[RealtimeAgent] Business ${businessId} not found`);
        return false;
      }
      
      if (!business.notificationEmail && !business.notificationPhoneNumber) {
        console.warn(`[RealtimeAgent] Business ${business.name} (${businessId}) has no notification methods configured`);
        return false;
      }
      
      // Log notification configuration
      console.log(`[RealtimeAgent] Business ${business.name} notification config:`, {
        hasEmail: !!business.notificationEmail,
        hasPhone: !!business.notificationPhoneNumber
      });
      
      return true;
    } catch (error) {
      console.error(`[RealtimeAgent] Error validating business config:`, error);
      return false;
    }
  }

  private async triggerGreeting() {
    console.log(`[RealtimeAgent] Checking readiness to trigger greeting for ${this.callSid}.`);
    
    if (!this.state.isAiReady || !this.state.isTwilioReady) {
      console.log(`[RealtimeAgent] Not ready to trigger greeting. AI: ${this.state.isAiReady}, Twilio: ${this.state.isTwilioReady}`);
      return;
    }

    if (this.state.welcomeMessageDelivered) {
      console.log(`[RealtimeAgent] Welcome message already delivered for call ${this.callSid}`);
      return;
    }

    try {
      if (!this.state.businessId) {
        console.error(`[RealtimeAgent] No business ID available for call ${this.callSid}`);
        return;
      }

      const welcomeMessage = await this.getWelcomeMessage(this.state.businessId);
      
      if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) {
        throw new Error('OpenAI WebSocket not ready');
      }

      // Send the welcome message as a text event with user role and clear instruction
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

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Welcome message delivery timeout'));
        }, 5000);

        const handler = (event: { data: any }) => {
          try {
            const response = JSON.parse(event.data.toString());
            if (response.type === 'conversation.item.created') {
              clearTimeout(timeout);
              this.openAiWs!.removeEventListener('message', handler);
              resolve();
            }
          } catch (error) {
            console.error(`[RealtimeAgent] Error handling welcome message response:`, error);
          }
        };

        this.openAiWs!.addEventListener('message', handler);
        this.openAiWs!.send(JSON.stringify(textEvent));
      });

      // Send response creation after confirmation
      this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
      
      this.state.welcomeMessageDelivered = true;
      console.log(`[RealtimeAgent] Greeting delivered for call ${this.callSid}: "${welcomeMessage}"`);
    } catch (error) {
      this.state.welcomeMessageAttempts++;
      console.error(`[RealtimeAgent] Failed to deliver greeting (attempt ${this.state.welcomeMessageAttempts}):`, error);
      
      if (this.state.welcomeMessageAttempts < 3) {
        setTimeout(() => this.triggerGreeting(), 1000 * this.state.welcomeMessageAttempts);
      }
    }
  }

  private async getWelcomeMessage(businessId: string): Promise<string> {
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        include: { agentConfig: true }
      });
      
      if (!business) {
        console.warn(`[RealtimeAgent] Business ${businessId} not found, using default welcome message`);
        return 'Hello! Thank you for calling. How can I help you today?';
      }
      
      let welcomeMessage = business.agentConfig?.voiceGreetingMessage?.trim() || 
                          business.agentConfig?.welcomeMessage?.trim() || 
                          'Hello! Thank you for calling. How can I help you today?';
                          
      return welcomeMessage.replace(/\{businessName\}/gi, business.name);
    } catch (error) {
      console.error(`[RealtimeAgent] Error getting welcome message:`, error);
      return 'Hello! Thank you for calling. How can I help you today?';
    }
  }
} 