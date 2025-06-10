import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { RealtimeAgentService } from './realtimeAgentService';

/**
 * WebSocket server for handling Twilio Media Streams
 * Creates bidirectional audio bridge between Twilio and OpenAI
 */
export class TwilioWebSocketServer {
  private wss: WebSocketServer;
  private activeConnections = new Map<string, RealtimeAgentService>();

  constructor(server: HttpServer) {
    console.log('[WebSocket Server] Initializing Twilio Media Stream WebSocket server...');
    
    // Validate required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for WebSocket server initialization');
    }
    
    // Initialize WebSocket server with proper error handling
    try {
      this.wss = new WebSocketServer({ 
        server,
        // Add ping/pong for connection health monitoring
        clientTracking: true,
        perMessageDeflate: false // Disable compression for better performance
      });
      
      this.setupConnectionHandler();
      console.log('[WebSocket Server] Successfully initialized WebSocket server');
    } catch (error) {
      console.error('[WebSocket Server] Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket Server] New connection attempt');
      
      // Validate connection is from Twilio
      const userAgent = req.headers['user-agent'] || '';
      if (!userAgent.includes('Twilio')) {
        console.warn('[WebSocket Server] Rejected non-Twilio connection attempt');
        ws.close(1008, 'Only Twilio connections allowed');
        return;
      }
      
      console.log('[WebSocket Server] New Twilio connection established.');
      
      // Initialize RealtimeAgentService
      console.log('[WebSocket Server] Initializing RealtimeAgentService - CallSid will be obtained from start message');
      const agent = new RealtimeAgentService(ws);
      
      // Track connection temporarily until we get the CallSid
      const tempConnectionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.activeConnections.set(tempConnectionId, agent);
      console.log(`[WebSocket Server] Temporary connection established: ${tempConnectionId}. Active connections: ${this.activeConnections.size}`);

      // Handle CallSid reception
      agent.onCallSidReceived = (callSid: string) => {
        console.log(`[WebSocket Server] CallSid received from start message: ${callSid}`);
        // Move connection from temp ID to actual CallSid
        this.activeConnections.delete(tempConnectionId);
        this.activeConnections.set(callSid, agent);
        console.log(`[WebSocket Server] Audio bridge established for call: ${callSid}. Active connections: ${this.activeConnections.size}`);
      };

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`[WebSocket Server] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        
        this.activeConnections.get(connectionKey)?.cleanup('Twilio');
        this.activeConnections.delete(connectionKey);
        console.log(`[WebSocket Server] Cleaning up audio bridge for connection: ${connectionKey}. Active connections: ${this.activeConnections.size}`);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket Server] WebSocket error:`, error);
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        
        this.activeConnections.get(connectionKey)?.cleanup('Twilio');
        this.activeConnections.delete(connectionKey);
      });
    });

    // Add ping/pong for connection health monitoring
    const pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, 30000); // Ping every 30 seconds

    this.wss.on('close', () => {
      clearInterval(pingInterval);
    });

    console.log('[WebSocket Server] Connection handler is set up.');
  }

  public close() {
    console.log('[WebSocket Server] Closing WebSocket server...');
    this.wss.close();
    console.log('[WebSocket Server] WebSocket server closed.');
  }

  /**
   * Get active connection count
   */
  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }

  /**
   * Get connection status for a specific call
   */
  public getConnectionStatus(callSid: string): string | null {
    const agent = this.activeConnections.get(callSid);
    return agent ? agent.getConnectionStatus() : null;
  }
} 