import WebSocket from 'ws';

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

    } catch (error) {
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
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
    });

    // Handle Twilio connection close
    this.twilioWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeAgent] Twilio connection closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.disconnect();
    });
  }

  /**
   * Sets up OpenAI WebSocket event listeners
   */
  private setupOpenAiListeners(): void {
    if (!this.openAiWs) return;

    // Connection opened successfully
    this.openAiWs.on('open', () => {
      console.log(`[RealtimeAgent] OpenAI connection opened for call: ${this.callSid}`);
      
      // Send initial session configuration
      this.configureOpenAiSession();
    });

    // Message received from OpenAI
    this.openAiWs.on('message', (data: WebSocket.Data) => {
      this.handleOpenAiMessage(data);
    });

    // Connection error occurred
    this.openAiWs.on('error', (error: Error) => {
      console.error(`[RealtimeAgent] OpenAI WebSocket error for call ${this.callSid}:`, error);
    });

    // Connection closed
    this.openAiWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeAgent] OpenAI connection closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.openAiWs = null;
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
   * Handles incoming messages from OpenAI WebSocket
   */
  private handleOpenAiMessage(data: WebSocket.Data): void {
    try {
      const response = JSON.parse(data.toString());
      
      switch (response.type) {
        case 'session.created':
          console.log(`[RealtimeAgent] OpenAI session created for call ${this.callSid}`);
          break;
          
        case 'response.audio.delta':
          // Forward audio from OpenAI back to Twilio
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const twilioMessage = {
              event: 'media',
              streamSid: this.streamSid,
              media: {
                payload: response.delta
              }
            };
            this.twilioWs.send(JSON.stringify(twilioMessage));
          }
          break;
          
        case 'response.audio.done':
          console.log(`[RealtimeAgent] OpenAI audio response completed for call ${this.callSid}`);
          break;
          
        case 'error':
          console.error(`[RealtimeAgent] OpenAI error for call ${this.callSid}:`, response.error);
          break;
          
        default:
          if (process.env.NODE_ENV === 'development') {
            console.log(`[RealtimeAgent] OpenAI event for call ${this.callSid}: ${response.type}`);
          }
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing OpenAI message for call ${this.callSid}:`, error);
    }
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
        instructions: 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries.',
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
          silence_duration_ms: 200
        }
      }
    };

    this.openAiWs.send(JSON.stringify(sessionConfig));
    console.log(`[RealtimeAgent] OpenAI session configured for call ${this.callSid}`);
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
      console.log(`[RealtimeAgent] Message sent to OpenAI for call ${this.callSid}:`, message);
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