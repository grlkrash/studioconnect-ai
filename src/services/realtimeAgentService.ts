import WebSocket from 'ws';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Initialize Twilio REST client for fetching call details
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * RealtimeAgentService - Two-way audio bridge between Twilio and OpenAI
 * Handles real-time bidirectional voice conversations
 */
export class RealtimeAgentService {
  private openAiWs: WebSocket | null = null;
  private twilioWs: WebSocket | null = null;
  private callSid: string;
  private streamSid: string | null = null;
  private readonly openaiApiKey: string;
  private isSessionReady = false;
  private pendingAudioChunks: any[] = [];

  constructor(callSid: string) {
    this.callSid = callSid;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for RealtimeAgentService');
    }
  }

  /**
   * Establishes bidirectional audio bridge between Twilio and OpenAI
   */
  public async connect(twilioWs: WebSocket): Promise<void> {
    try {
      this.twilioWs = twilioWs;
      
      // Set up Twilio WebSocket listeners first
      this.setupTwilioListeners();
      
      // Connect to OpenAI but don't trigger greeting yet
      await this.connectToOpenAI();

    } catch (error) {
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
  }

  /**
   * Connects to OpenAI Realtime API
   */
  private async connectToOpenAI(): Promise<void> {
    // Define the WebSocket URL with specified model (use supported realtime model)
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    
    // Define headers for authentication and API version
    const headers = {
      'Authorization': `Bearer ${this.openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    };

    console.log(`[RealtimeAgent] Connecting to OpenAI Realtime API for call: ${this.callSid}`);

    // Instantiate the OpenAI WebSocket client
    this.openAiWs = new WebSocket(url, { headers });

    // Set up OpenAI WebSocket event listeners
    this.setupOpenAiListeners();
  }

  /**
   * Sets up Twilio WebSocket event listeners
   */
  private setupTwilioListeners(): void {
    if (!this.twilioWs) return;

    console.log(`[RealtimeAgent] Setting up Twilio WebSocket listeners for call: ${this.callSid}`);

    // Handle messages from Twilio (audio from caller)
    this.twilioWs.on('message', (message: WebSocket.Data) => {
      this.handleTwilioMessage(message);
    });

    // Handle Twilio connection errors
    this.twilioWs.on('error', (error: Error) => {
      console.error(`[RealtimeAgent] Twilio WebSocket error for call ${this.callSid}:`, error);
      this.disconnect();
    });

    // Handle Twilio connection close
    this.twilioWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeAgent] Twilio connection closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.disconnect();
    });
  }

  /**
   * Sets up OpenAI WebSocket event listeners with enhanced diagnostic logging
   */
  private setupOpenAiListeners(): void {
    if (!this.openAiWs) {
      console.error(`[RealtimeAgent] Cannot setup listeners, OpenAI WebSocket is not initialized for call ${this.callSid}.`);
      return;
    }

    console.log(`[RealtimeAgent] Setting up OpenAI WebSocket listeners for call: ${this.callSid}`);

    // Connection opened successfully
    this.openAiWs.on('open', () => {
      console.log(`[RealtimeAgent] OpenAI connection opened for call: ${this.callSid}`);
      
      // Send initial session configuration
      this.configureOpenAiSession();
    });

    // Message received from OpenAI with enhanced logging
    this.openAiWs.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString());
        
        // Log all incoming message types for debugging
        console.log(`[RealtimeAgent] Received OpenAI event: ${response.type} for call ${this.callSid}`);
        
        switch (response.type) {
          case 'session.created':
            console.log(`[RealtimeAgent] OpenAI session created for call ${this.callSid}`);
            this.isSessionReady = true;
            // Check if we can trigger greeting now (need both session and streamSid)
            this.maybeStartConversation();
            break;
            
          case 'response.audio.delta':
            console.log(`[RealtimeAgent] Received audio chunk from OpenAI for call ${this.callSid}. Audio length: ${response.delta ? response.delta.length : 'undefined'}`);
            
            // Store audio if streamSid not ready yet
            if (!this.streamSid) {
              console.log(`[RealtimeAgent] Storing audio chunk - streamSid not ready yet for call ${this.callSid}`);
              this.pendingAudioChunks.push(response);
              return;
            }
            
            // Forward audio from OpenAI back to Twilio
            this.forwardAudioToTwilio(response.delta);
            break;
            
          case 'response.audio.done':
            console.log(`[RealtimeAgent] OpenAI audio response completed for call ${this.callSid}`);
            break;
            
          case 'input_audio_buffer.speech_started':
            console.log(`[RealtimeAgent] User started speaking for call ${this.callSid}`);
            // Optionally interrupt any ongoing AI speech
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
              console.log(`[RealtimeAgent] Sent response.cancel to OpenAI for call ${this.callSid}`);
            }
            break;
            
          case 'input_audio_buffer.speech_stopped':
            console.log(`[RealtimeAgent] User stopped speaking for call ${this.callSid}`);
            // Commit the audio buffer and request a response
            if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
              this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
              this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
              console.log(`[RealtimeAgent] Sent commit and response.create to OpenAI for call ${this.callSid}`);
            }
            break;
            
          case 'error':
            console.error(`[RealtimeAgent] OpenAI error for call ${this.callSid}:`, response.error);
            break;
            
          default:
            if (process.env.NODE_ENV === 'development') {
              console.log(`[RealtimeAgent] Unhandled OpenAI event for call ${this.callSid}: ${response.type}`, response);
            }
        }
      } catch (error) {
        console.error(`[RealtimeAgent] Error parsing OpenAI message for call ${this.callSid}:`, error);
        console.error(`[RealtimeAgent] Raw message data: ${data.toString().substring(0, 500)}...`);
      }
    });

    // Connection error occurred
    this.openAiWs.on('error', (error: Error) => {
      console.error(`[RealtimeAgent] OpenAI WebSocket error for call ${this.callSid}:`, error);
      this.disconnect();
    });

    // Connection closed
    this.openAiWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeAgent] OpenAI connection closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.openAiWs = null;
      
      // Close Twilio connection if still open
      if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
        console.log(`[RealtimeAgent] Closing Twilio connection due to OpenAI disconnect for call ${this.callSid}`);
        this.twilioWs.close();
      }
    });
  }

  /**
   * Handles incoming messages from Twilio WebSocket
   */
  private handleTwilioMessage(message: WebSocket.Data): void {
    try {
      const msg = JSON.parse(message.toString());
      
      switch (msg.event) {
        case 'connected':
          console.log(`[RealtimeAgent] Twilio stream connected for call ${this.callSid}`);
          break;
          
        case 'start':
          console.log(`[RealtimeAgent] Twilio stream started for call ${this.callSid}`);
          this.streamSid = msg.start.streamSid;
          console.log(`[RealtimeAgent] Stream SID: ${this.streamSid}`);
          
          // Process any pending audio chunks now that we have streamSid
          this.processPendingAudio();
          
          // Check if we can start conversation now (need both session and streamSid)
          this.maybeStartConversation();
          break;
          
        case 'media':
          // Forward audio from Twilio to OpenAI
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            const audioAppend = {
              type: 'input_audio_buffer.append',
              audio: msg.media.payload
            };
            this.openAiWs.send(JSON.stringify(audioAppend));
          }
          
          // **CRITICAL**: Send mark message back to Twilio to keep audio stream alive
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const markMessage = {
              event: 'mark',
              streamSid: this.streamSid,
              mark: {
                name: `audio_processed_${Date.now()}`
              }
            };
            this.twilioWs.send(JSON.stringify(markMessage));
          }
          break;
          
        case 'stop':
          console.log(`[RealtimeAgent] Twilio stream stopped for call ${this.callSid}`);
          this.disconnect();
          break;
          
        default:
          console.log(`[RealtimeAgent] Unknown Twilio event: ${msg.event}`);
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing Twilio message for call ${this.callSid}:`, error);
    }
  }

  /**
   * Checks if both session and streamSid are ready, then starts conversation
   */
  private maybeStartConversation(): void {
    if (this.isSessionReady && this.streamSid) {
      console.log(`[RealtimeAgent] Both OpenAI session and Twilio stream ready - triggering greeting for call ${this.callSid}`);
      // Add small delay to ensure everything is properly initialized
      setTimeout(() => {
        this.triggerGreeting().catch(error => {
          console.error(`[RealtimeAgent] Failed to trigger greeting for call ${this.callSid}:`, error);
        });
      }, 200);
    } else {
      console.log(`[RealtimeAgent] Not ready to start conversation - Session ready: ${this.isSessionReady}, StreamSid ready: ${!!this.streamSid}`);
    }
  }

  /**
   * Processes any audio chunks that arrived before streamSid was available
   */
  private processPendingAudio(): void {
    if (this.pendingAudioChunks.length > 0) {
      console.log(`[RealtimeAgent] Processing ${this.pendingAudioChunks.length} pending audio chunks for call ${this.callSid}`);
      
      for (const audioChunk of this.pendingAudioChunks) {
        if (audioChunk.delta) {
          this.forwardAudioToTwilio(audioChunk.delta);
        }
      }
      
      // Clear pending chunks
      this.pendingAudioChunks = [];
    }
  }

  /**
   * Forwards audio from OpenAI to Twilio with proper error handling
   */
  private forwardAudioToTwilio(audioData: string): void {
    if (!this.streamSid) {
      console.warn(`[RealtimeAgent] Cannot forward audio to Twilio: streamSid is not set for call ${this.callSid}.`);
      return;
    }
    
    if (!this.twilioWs) {
      console.warn(`[RealtimeAgent] Cannot forward audio to Twilio: Twilio WebSocket is null for call ${this.callSid}.`);
      return;
    }
    
    if (this.twilioWs.readyState !== WebSocket.OPEN) {
      console.warn(`[RealtimeAgent] Cannot forward audio to Twilio: WebSocket state is ${this.twilioWs.readyState} (expected ${WebSocket.OPEN}) for call ${this.callSid}.`);
      return;
    }
    
    if (!audioData) {
      console.warn(`[RealtimeAgent] Cannot forward audio to Twilio: audio data is empty for call ${this.callSid}.`);
      return;
    }
    
    // Forward audio from OpenAI back to Twilio
    const twilioMessage = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: audioData
      }
    };
    
    console.log(`[RealtimeAgent] Forwarding audio to Twilio for stream ${this.streamSid}. Payload length: ${audioData.length}`);
    this.twilioWs.send(JSON.stringify(twilioMessage));
    console.log(`[RealtimeAgent] Audio successfully sent to Twilio for call ${this.callSid}`);
  }

  /**
   * Configures the OpenAI session for voice conversation
   */
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

  /**
   * Proactively triggers the agent's welcome message by fetching business config
   * and sending a text event to OpenAI to make the agent speak
   */
  private async triggerGreeting(): Promise<void> {
    try {
      console.log(`[RealtimeAgent] Triggering greeting for call ${this.callSid}`);
      
      // Fetch call details from Twilio to get the phone numbers
      const callDetails = await twilioClient.calls(this.callSid).fetch();
      const toPhoneNumber = callDetails.to;
      
      console.log(`[RealtimeAgent] Call made to phone number: ${toPhoneNumber}`);
      
      // Find business by Twilio phone number
      let business = null;
      let agentConfig = null;
      let welcomeMessage = 'Hello! Thank you for calling. How can I help you today?';
      
      if (toPhoneNumber) {
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: toPhoneNumber }
        });
        
        if (business) {
          console.log(`[RealtimeAgent] Found business: ${business.name}`);
          
          // Get agent configuration
          agentConfig = await prisma.agentConfig.findUnique({
            where: { businessId: business.id }
          });
          
          // Determine welcome message
          if (agentConfig?.voiceGreetingMessage?.trim()) {
            welcomeMessage = agentConfig.voiceGreetingMessage;
            console.log(`[RealtimeAgent] Using custom voice greeting`);
          } else if (agentConfig?.welcomeMessage?.trim()) {
            welcomeMessage = agentConfig.welcomeMessage;
            console.log(`[RealtimeAgent] Using general welcome message`);
          }
        } else {
          console.log(`[RealtimeAgent] No business found for phone: ${toPhoneNumber}, using default greeting`);
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
        
        // Trigger response creation
        setTimeout(() => {
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }, 100);
        
        console.log(`[RealtimeAgent] Greeting triggered for call ${this.callSid}: "${welcomeMessage}"`);
      }
      
    } catch (error) {
      console.error(`[RealtimeAgent] Error triggering greeting for call ${this.callSid}:`, error);
      
      // Fallback to default greeting if there's an error
      if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
        const fallbackEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Please say: "Hello! Thank you for calling. How can I help you today?"'
              }
            ]
          }
        };
        
        this.openAiWs.send(JSON.stringify(fallbackEvent));
        
        setTimeout(() => {
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }, 100);
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
   * Closes both WebSocket connections gracefully
   */
  public disconnect(): void {
    console.log(`[RealtimeAgent] Disconnecting audio bridge for call: ${this.callSid}`);
    
    if (this.openAiWs) {
      this.openAiWs.close();
      this.openAiWs = null;
    }
    
    if (this.twilioWs) {
      this.twilioWs.close();
      this.twilioWs = null;
    }
    
    this.streamSid = null;
    this.isSessionReady = false;
    this.pendingAudioChunks = [];
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
    
    return `OpenAI: ${openAiStatus}, Twilio: ${twilioStatus}`;
  }

  /**
   * Gets the call SID associated with this service instance
   */
  public getCallSid(): string {
    return this.callSid;
  }
} 