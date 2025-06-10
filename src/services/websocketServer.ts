import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { RealtimeAgentService } from './realtimeAgentService';

interface ConnectionState {
  agent: RealtimeAgentService;
  createdAt: Date;
  lastPing: Date;
  isActive: boolean;
}

/**
 * WebSocket server for handling Twilio Media Streams
 * Creates bidirectional audio bridge between Twilio and OpenAI
 */
export class TwilioWebSocketServer {
  private wss: WebSocketServer;
  private activeConnections = new Map<string, ConnectionState>();
  private readonly CONNECTION_TIMEOUT = 30000; // 30 seconds
  private readonly PING_INTERVAL = 30000; // 30 seconds
  private pingInterval: NodeJS.Timeout | null = null;

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
        clientTracking: true,
        perMessageDeflate: false, // Disable compression for better performance
        maxPayload: 1024 * 1024 // 1MB max payload
      });
      
      this.setupConnectionHandler();
      this.setupPingInterval();
      console.log('[WebSocket Server] Successfully initialized WebSocket server');
    } catch (error) {
      console.error('[WebSocket Server] Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket Server] New connection attempt');
      
      // Enhanced Twilio validation
      const userAgent = req.headers['user-agent'] || '';
      const isFromTwilio = userAgent.includes('Twilio') || 
                          userAgent.includes('TwilioProxy') ||
                          req.headers['x-twilio-signature'] !== undefined;
      
      if (!isFromTwilio) {
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
      this.activeConnections.set(tempConnectionId, {
        agent,
        createdAt: new Date(),
        lastPing: new Date(),
        isActive: true
      });
      
      console.log(`[WebSocket Server] Temporary connection established: ${tempConnectionId}. Active connections: ${this.activeConnections.size}`);

      // Set timeout for temporary connection
      const connectionTimeout = setTimeout(() => {
        const state = this.activeConnections.get(tempConnectionId);
        if (state && !state.agent.getCallSid()) {
          console.log(`[WebSocket Server] Temporary connection ${tempConnectionId} timed out`);
          this.cleanupConnection(tempConnectionId, 'Connection timeout');
        }
      }, this.CONNECTION_TIMEOUT);

      // Handle CallSid reception
      agent.onCallSidReceived = (callSid: string) => {
        console.log(`[WebSocket Server] CallSid received from start message: ${callSid}`);
        clearTimeout(connectionTimeout);
        
        // Move connection from temp ID to actual CallSid
        const state = this.activeConnections.get(tempConnectionId);
        if (state) {
          this.activeConnections.delete(tempConnectionId);
          this.activeConnections.set(callSid, state);
          console.log(`[WebSocket Server] Audio bridge established for call: ${callSid}. Active connections: ${this.activeConnections.size}`);
        }
      };

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`[WebSocket Server] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        this.cleanupConnection(connectionKey, `Connection closed: ${reason.toString()}`);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket Server] WebSocket error:`, error);
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        this.cleanupConnection(connectionKey, `WebSocket error: ${error.message}`);
      });

      // Handle pong responses
      ws.on('pong', () => {
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        const state = this.activeConnections.get(connectionKey);
        if (state) {
          state.lastPing = new Date();
        }
      });
    });

    console.log('[WebSocket Server] Connection handler is set up.');
  }

  private setupPingInterval() {
    this.pingInterval = setInterval(() => {
      const now = new Date();
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });

      // Check for stale connections
      for (const [key, state] of this.activeConnections.entries()) {
        const timeSinceLastPing = now.getTime() - state.lastPing.getTime();
        if (timeSinceLastPing > this.CONNECTION_TIMEOUT) {
          console.log(`[WebSocket Server] Connection ${key} is stale (${timeSinceLastPing}ms since last ping)`);
          this.cleanupConnection(key, 'Connection stale');
        }
      }
    }, this.PING_INTERVAL);
  }

  private cleanupConnection(connectionKey: string, reason: string) {
    const state = this.activeConnections.get(connectionKey);
    if (state) {
      console.log(`[WebSocket Server] Cleaning up connection ${connectionKey}: ${reason}`);
      state.agent.cleanup('Twilio');
      this.activeConnections.delete(connectionKey);
      console.log(`[WebSocket Server] Active connections: ${this.activeConnections.size}`);
    }
  }

  public close() {
    console.log('[WebSocket Server] Closing WebSocket server...');
    
    // Cleanup all connections
    for (const [key, state] of this.activeConnections.entries()) {
      this.cleanupConnection(key, 'Server shutdown');
    }
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
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
    const state = this.activeConnections.get(callSid);
    if (!state) return null;
    
    const timeSinceLastPing = new Date().getTime() - state.lastPing.getTime();
    return `${state.agent.getConnectionStatus()} (Last ping: ${timeSinceLastPing}ms ago)`;
  }
} 