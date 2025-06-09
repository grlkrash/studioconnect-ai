import WebSocket from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';

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
}

/**
 * RealtimeAgentService - Two-way audio bridge between Twilio and OpenAI
 * Handles real-time bidirectional voice conversations
 */
export class RealtimeAgentService {
  private twilioWs: WebSocket | null = null;
  private openAiWs: WebSocket | null = null;
  private callSid: string = '';
  private state: ConnectionState;
  private readonly openaiApiKey: string;
  public onCallSidReceived?: (callSid: string) => void;

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
          // Build comprehensive business-specific instructions
          const businessName = business.name;
          const questions = business.agentConfig?.questions || [];
          
                    businessInstructions = `You are a professional AI receptionist for ${businessName}. Your ONLY goal is to serve callers on behalf of this specific business.

🚨 EMERGENCY DETECTION PROTOCOL:
FIRST, detect if the caller's message indicates an EMERGENCY (burst pipe, flooding, no heat in freezing weather, gas leak, electrical hazard, water damage):
- If EMERGENCY detected: Immediately say "I understand this is an emergency situation. I can connect you directly to our team right now, or quickly gather your details so they can respond immediately. What would you prefer?"
- If they choose "connect now": Say "Absolutely! I'm connecting you to our emergency line right now. Please hold while I transfer your call."
- If they choose "gather details": Ask these EMERGENCY questions ONLY: 1) "What's your exact address or location?" 2) "What's your name?" 3) "What's your phone number?" 4) "Can you describe the emergency situation in detail?"

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
          threshold: 0.5,           // Less sensitive (0.5 instead of 0.6)
          prefix_padding_ms: 500,   // More padding before speech starts
          silence_duration_ms: 2500 // Wait 2.5 seconds of silence before processing (was 1.2s)
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
        
        if (toPhoneNumber) {
          const business = await prisma.business.findFirst({
            where: { twilioPhoneNumber: toPhoneNumber }
          });
          
          if (business) {
            const agentConfig = await prisma.agentConfig.findUnique({
              where: { businessId: business.id }
            });
            
            if (agentConfig?.voiceGreetingMessage?.trim()) {
              welcomeMessage = agentConfig.voiceGreetingMessage;
            } else if (agentConfig?.welcomeMessage?.trim()) {
              welcomeMessage = agentConfig.welcomeMessage;
            }
          }
        }
        
        // Send text event to OpenAI to make the agent speak the welcome message
        if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
          const textEvent = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `Please say this exact welcome message to the caller: "${welcomeMessage}"`
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

     public cleanup(source: 'Twilio' | 'OpenAI' | 'Other' = 'Other') {
     console.log(`[RealtimeAgent] Cleanup triggered by ${source} for call ${this.callSid}.`);
     
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