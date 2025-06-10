import WebSocket from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
import { processMessage } from '../core/aiHandler';

const prisma = new PrismaClient();

// Initialize Twilio REST client for fetching call details
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
  }

  private setupTwilioListeners() {
    if (!this.twilioWs) {
      console.error(`[RealtimeAgent] Cannot setup Twilio listeners: WebSocket is null for call ${this.callSid}`);
      return;
    }

    this.twilioWs.on('message', (message: WebSocket.RawData) => {
      this.handleTwilioMessage(message);
    });
    this.twilioWs.on('close', () => this.cleanup('Twilio'));
    this.twilioWs.on('error', (error) => {
      console.error(`[RealtimeAgent] Twilio WebSocket error for ${this.callSid}:`, error);
      this.cleanup('Twilio');
    });
  }

  private handleTwilioMessage(message: WebSocket.RawData) {
    try {
      const msg = JSON.parse(message.toString());
      
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
      console.error(`[RealtimeAgent] Error handling Twilio message for ${this.callSid}:`, error);
    }
  }

  private connectToOpenAI() {
    console.log(`[RealtimeAgent] Connecting to OpenAI Realtime API for call: ${this.callSid}`);
    
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    const headers = {
      'Authorization': `Bearer ${this.openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    };

    this.openAiWs = new WebSocket(url, { headers });
    this.setupOpenAIListeners();
  }

  private setupOpenAIListeners() {
    if (!this.openAiWs) return;

    this.openAiWs.on('open', async () => {
      console.log(`[RealtimeAgent] OpenAI connection opened for ${this.callSid}. Configuring session.`);
      await this.configureOpenAiSession();
    });

    this.openAiWs.on('message', (message: WebSocket.RawData) => {
      try {
        const response = JSON.parse(message.toString());
        
        console.log(`[RealtimeAgent] Received OpenAI event: ${response.type} for call ${this.callSid}`);
        
        switch (response.type) {
          case 'session.created':
            console.log(`[RealtimeAgent] OpenAI session created for call ${this.callSid}`);
            this.state.isAiReady = true;
            this.triggerGreeting();
            break;
            
          case 'response.audio.delta':
            console.log(`[RealtimeAgent] Received audio chunk from OpenAI for call ${this.callSid}`);
            if (response.delta) {
              this.handleOpenAiAudio(response.delta);
            }
            break;
            
          case 'response.audio.done':
            console.log(`[RealtimeAgent] OpenAI audio response completed for call ${this.callSid}`);
            break;

          case 'response.audio_transcript.done':
            // Track AI's response transcript
            if (response.transcript) {
              this.addToConversationHistory('assistant', response.transcript);
              console.log(`[RealtimeAgent] AI response transcript: ${response.transcript}`);
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            // Track user's input transcript
            if (response.transcript) {
              this.addToConversationHistory('user', response.transcript);
              console.log(`[RealtimeAgent] User input transcript: ${response.transcript}`);
              
              // Analyze for lead capture opportunity
              this.analyzeForLeadCapture().catch(error => {
                console.error(`[RealtimeAgent] Error analyzing for lead capture:`, error);
              });
            }
            break;
            
          case 'input_audio_buffer.speech_started':
            console.log(`[RealtimeAgent] User started speaking for call ${this.callSid}`);
            // Only interrupt if there's actually an active response
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              try {
                this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
              } catch (error) {
                // Ignore cancel errors - they're expected if no response is active
                console.log(`[RealtimeAgent] Response cancel ignored (expected if no active response) for call ${this.callSid}`);
              }
            }
            break;
            
          case 'input_audio_buffer.speech_stopped':
            console.log(`[RealtimeAgent] User stopped speaking for call ${this.callSid}`);
            // Add a small delay before committing to ensure we have sufficient audio
            setTimeout(() => {
              if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
                try {
                  this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                  this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
                } catch (error) {
                  console.log(`[RealtimeAgent] Audio commit ignored (buffer may be empty) for call ${this.callSid}`);
                }
              }
            }, 100); // Small delay to ensure audio buffer has content
            break;
            
          case 'error':
            // Filter out expected errors that are part of normal operation
            if (response.error?.code === 'input_audio_buffer_commit_empty' || 
                response.error?.code === 'response_cancel_not_active' ||
                response.error?.code === 'conversation_already_has_active_response') {
              console.log(`[RealtimeAgent] Expected OpenAI operational message for call ${this.callSid}: ${response.error.code}`);
            } else {
              console.error(`[RealtimeAgent] OpenAI error for call ${this.callSid}:`, response.error);
            }
            break;
            
          default:
            if (process.env.NODE_ENV === 'development') {
              console.log(`[RealtimeAgent] Unhandled OpenAI event for call ${this.callSid}: ${response.type}`);
            }
        }
      } catch (error) {
        console.error(`[RealtimeAgent] Error parsing OpenAI message for call ${this.callSid}:`, error);
      }
    });

    this.openAiWs.on('close', () => this.cleanup('OpenAI'));
    this.openAiWs.on('error', (error) => {
      console.error(`[RealtimeAgent] OpenAI WebSocket error for ${this.callSid}:`, error);
      this.cleanup('OpenAI');
    });
  }

  private async configureOpenAiSession(): Promise<void> {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) return;

    let businessInstructions = 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries. Keep responses concise and conversational.';
    
    // Try to get business-specific instructions
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
          // Store business ID for lead creation
          this.state.businessId = business.id;
          console.log(`[RealtimeAgent] Business ID stored: ${business.id} for call ${this.callSid}`);
          
          // Build comprehensive business-specific instructions
          const businessName = business.name;
          const questions = business.agentConfig?.questions || [];
          
          businessInstructions = `You are a professional AI receptionist for ${businessName}. Your ONLY goal is to serve callers on behalf of this specific business.

🚨 EMERGENCY DETECTION PROTOCOL:
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

🎯 NORMAL LEAD CAPTURE: For non-emergency situations, ask questions one at a time:
${questions.map((q, index) => `${index + 1}. ${q.questionText}`).join('\n')}

CRITICAL RULES:
🏢 BUSINESS IDENTITY: You work EXCLUSIVELY for ${businessName}. NEVER suggest competitors.
📚 KNOWLEDGE BOUNDARIES: Only use information explicitly provided. NEVER invent details.
🚫 FORBIDDEN: Do NOT restart conversations, repeat greetings mid-call, or invent information.
💬 VOICE OPTIMIZATION: Keep responses under 25 seconds when spoken. Use natural, conversational language.
🔄 CONVERSATION FLOW: ONLY respond when the user has clearly spoken. If you detect silence or unclear audio, WAIT for clear user input. Do NOT continue asking questions or making statements if the user hasn't responded clearly to your previous question.

EMERGENCY KEYWORDS TO DETECT: burst, flooding, leak, emergency, urgent, no heat, no hot water, electrical issue, gas smell, water damage, basement flooding, pipe burst, toilet overflowing.`;
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
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,           // Slightly more sensitive to reduce double responses
          prefix_padding_ms: 300,   // Reduced padding
          silence_duration_ms: 1800 // Shorter silence duration to be more responsive
        }
      }
    };

    this.openAiWs.send(JSON.stringify(sessionConfig));
    console.log(`[RealtimeAgent] OpenAI session configured for call ${this.callSid} with business-specific instructions`);
  }

  private async triggerGreeting() {
    console.log(`[RealtimeAgent] Checking readiness to trigger greeting for ${this.callSid}.`);
    
    if (this.state.isAiReady && this.state.isTwilioReady) {
      console.log(`[RealtimeAgent] System is ready. Triggering greeting.`);
      
      try {
        // Fetch call details and business configuration
        const callDetails = await twilioClient.calls(this.callSid).fetch();
        const toPhoneNumber = callDetails.to;
        
        let welcomeMessage = 'Hello! Thank you for calling. How can I help you today?';
        let businessName = '';
        
        if (toPhoneNumber) {
          const business = await prisma.business.findFirst({
            where: { twilioPhoneNumber: toPhoneNumber }
          });
          
          if (business) {
            businessName = business.name;
            const agentConfig = await prisma.agentConfig.findUnique({
              where: { businessId: business.id }
            });
            
            if (agentConfig?.voiceGreetingMessage?.trim()) {
              welcomeMessage = agentConfig.voiceGreetingMessage;
            } else if (agentConfig?.welcomeMessage?.trim()) {
              welcomeMessage = agentConfig.welcomeMessage;
            }
            
            // Replace {businessName} template variable if present
            welcomeMessage = welcomeMessage.replace(/\{businessName\}/gi, businessName);
          }
        }
        
        // Send text event to OpenAI to make the agent speak the welcome message
        if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
          const textEvent = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: welcomeMessage
                }
              ]
            }
          };
          
          this.openAiWs.send(JSON.stringify(textEvent));
          
          setTimeout(() => {
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
            }
          }, 100);
          
          console.log(`[RealtimeAgent] Greeting triggered for call ${this.callSid}: "${welcomeMessage}"`);
        }
      } catch (error) {
        console.error(`[RealtimeAgent] Error triggering greeting for call ${this.callSid}:`, error);
      }
    } else {
      console.log(`[RealtimeAgent] Not ready to trigger greeting. AI: ${this.state.isAiReady}, Twilio: ${this.state.isTwilioReady}`);
    }
  }
  
  private handleOpenAiAudio(audioB64: string) {
    // Add audio to queue for processing
    this.state.audioQueue.push(audioB64);
    this.processAudioQueue();
  }

     private processAudioQueue() {
     // Only process audio if both connections are ready
     if (!this.state.isTwilioReady || !this.state.streamSid || !this.twilioWs) {
       console.log(`[RealtimeAgent] Not ready to process audio queue for call ${this.callSid}`);
       return;
     }

     // Process all queued audio chunks
     while (this.state.audioQueue.length > 0) {
       const audioChunk = this.state.audioQueue.shift();
       if (audioChunk && this.twilioWs.readyState === WebSocket.OPEN) {
         const twilioMsg = {
           event: "media",
           streamSid: this.state.streamSid,
           media: { payload: audioChunk },
         };
         console.log(`[RealtimeAgent] Forwarding queued audio to Twilio for call ${this.callSid}`);
         this.twilioWs.send(JSON.stringify(twilioMsg));
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
    if (!this.state.businessId || this.state.conversationHistory.length < 4) {
      console.log(`[RealtimeAgent] Skipping lead creation - insufficient conversation data`);
      return;
    }

    try {
      console.log(`[RealtimeAgent] Creating lead for call ${this.callSid}...`);

      // Convert conversation history to format expected by processMessage
      const conversationForAI = this.state.conversationHistory.map(entry => ({
        role: entry.role,
        content: entry.content
      }));

      // Get the user's main message (usually the first substantial user message)
      const userMessages = this.state.conversationHistory.filter(entry => entry.role === 'user');
      const mainUserMessage = userMessages.find(msg => msg.content.length > 10) || userMessages[0];

      if (!mainUserMessage) {
        console.log(`[RealtimeAgent] No substantial user message found for lead creation`);
        return;
      }

      // Process through the lead capture system
      const result = await processMessage(
        mainUserMessage.content,
        conversationForAI,
        this.state.businessId,
        'LEAD_CAPTURE', // Force lead capture mode
        this.callSid
      );

      console.log(`[RealtimeAgent] Lead processing result:`, result);

      // Create conversation summary for lead
      const conversationSummary = this.state.conversationHistory
        .map(entry => `${entry.role}: ${entry.content}`)
        .join('\n');

      // Try to extract key information from conversation
      const extractedInfo = this.extractLeadInformation();

      // Create lead record
      const newLead = await prisma.lead.create({
        data: {
          businessId: this.state.businessId,
          status: 'NEW',
          priority: this.detectEmergency() ? 'URGENT' : 'NORMAL',
          conversationTranscript: JSON.stringify(conversationForAI),
          capturedData: extractedInfo,
          contactName: extractedInfo.name || null,
          contactEmail: extractedInfo.email || null,
          contactPhone: extractedInfo.phone || null,
          notes: `Voice call lead - CallSid: ${this.callSid}`
        }
      });

      console.log(`[RealtimeAgent] Lead created successfully:`, newLead.id);

      // Send notifications
      await this.sendLeadNotifications(newLead);

    } catch (error) {
      console.error(`[RealtimeAgent] Error creating lead for call ${this.callSid}:`, error);
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
} 