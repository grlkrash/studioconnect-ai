import WebSocket from 'ws';

/**
 * RealtimeAgentService - Manages OpenAI Realtime API WebSocket connections
 * Handles real-time voice conversations with OpenAI's GPT models
 */
export class RealtimeAgentService {
  private ws: WebSocket | null = null;
  private callSid: string;
  private readonly openaiApiKey: string;

  constructor(callSid: string) {
    this.callSid = callSid;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for RealtimeAgentService');
    }
  }

  /**
   * Establishes WebSocket connection to OpenAI Realtime API
   */
  public async connect(): Promise<void> {
    try {
      // Define the WebSocket URL with specified model
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini';
      
      // Define headers for authentication and API version
      const headers = {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      };

      console.log(`[RealtimeAgent] Connecting to OpenAI Realtime API for call: ${this.callSid}`);

      // Instantiate the WebSocket client
      this.ws = new WebSocket(url, { headers });

      // Set up essential event listeners
      this.setupEventListeners();

    } catch (error) {
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
  }

  /**
   * Sets up WebSocket event listeners for connection lifecycle management
   */
  private setupEventListeners(): void {
    if (!this.ws) return;

    // Connection opened successfully
    this.ws.on('open', () => {
      console.log(`[RealtimeAgent] Connection opened for call: ${this.callSid}`);
    });

    // Message received from OpenAI
    this.ws.on('message', (data: WebSocket.Data) => {
      console.log(`[RealtimeAgent] Message received for call ${this.callSid}:`, data.toString());
      // TODO: Handle incoming messages from OpenAI Realtime API
    });

    // Connection error occurred
    this.ws.on('error', (error: Error) => {
      console.error(`[RealtimeAgent] WebSocket error for call ${this.callSid}:`, error);
      // TODO: Implement error handling and recovery logic
    });

    // Connection closed
    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeAgent] Connection closed for call ${this.callSid}. Code: ${code}, Reason: ${reason.toString()}`);
      this.ws = null;
      // TODO: Implement cleanup logic
    });
  }

  /**
   * Sends a message to the OpenAI Realtime API
   */
  public sendMessage(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[RealtimeAgent] Cannot send message for call ${this.callSid}: WebSocket not connected`);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      console.log(`[RealtimeAgent] Message sent for call ${this.callSid}:`, message);
    } catch (error) {
      console.error(`[RealtimeAgent] Failed to send message for call ${this.callSid}:`, error);
    }
  }

  /**
   * Closes the WebSocket connection gracefully
   */
  public disconnect(): void {
    if (this.ws) {
      console.log(`[RealtimeAgent] Disconnecting call: ${this.callSid}`);
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Gets the current connection status
   */
  public getConnectionStatus(): string {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'unknown';
    }
  }

  /**
   * Gets the call SID associated with this service instance
   */
  public getCallSid(): string {
    return this.callSid;
  }
} 