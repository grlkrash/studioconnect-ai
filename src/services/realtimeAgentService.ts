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
  private twilioWs: WebSocket;
  private openAiWs: WebSocket | null = null;
  private callSid: string;
  private state: ConnectionState;
  private readonly openaiApiKey: string;

  constructor(twilioWs: WebSocket, callSid: string) {
    this.twilioWs = twilioWs;
    this.callSid = callSid;
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
    this.setupTwilioListeners();
  }

  /**
   * Public method to maintain compatibility with existing code
   */
  public async connect(twilioWs: WebSocket): Promise<void> {
    // This method is kept for compatibility but the actual connection
    // is now handled in the constructor and triggered by Twilio start event
    console.log(`[RealtimeAgent] Connection initiated for call ${this.callSid}`);
  }

  private setupTwilioListeners() {
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
        this.state.streamSid = msg.start.streamSid;
        this.state.isTwilioReady = true;
        console.log(`[RealtimeAgent] Twilio stream started. streamSid: ${this.state.streamSid}`);
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
        if (this.state.streamSid) {
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

    this.openAiWs.on('open', () => {
      console.log(`[RealtimeAgent] OpenAI connection opened for ${this.callSid}. Configuring session.`);
      this.configureOpenAiSession();
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
            // Interrupt any ongoing AI speech
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
            }
            break;
            
          case 'input_audio_buffer.speech_stopped':
            console.log(`[RealtimeAgent] User stopped speaking for call ${this.callSid}`);
            // Commit the audio buffer and request a response
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
              this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
            }
            break;
            
          case 'error':
            console.error(`[RealtimeAgent] OpenAI error for call ${this.callSid}:`, response.error);
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

  private configureOpenAiSession(): void {
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

    this.openAiWs.send(JSON.stringify(sessionConfig));
    console.log(`[RealtimeAgent] OpenAI session configured for call ${this.callSid}`);
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
    if (!this.state.isTwilioReady || !this.state.streamSid) {
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

  private cleanup(source: 'Twilio' | 'OpenAI' | 'Other' = 'Other') {
    console.log(`[RealtimeAgent] Cleanup triggered by ${source} for call ${this.callSid}.`);
    
    if (this.openAiWs && this.openAiWs.readyState !== WebSocket.CLOSED) {
      this.openAiWs.close();
      this.openAiWs = null;
    }
    
    if (this.twilioWs && this.twilioWs.readyState !== WebSocket.CLOSED) {
      this.twilioWs.close();
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