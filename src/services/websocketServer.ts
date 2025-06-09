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
    this.wss = new WebSocketServer({ server });
    this.setupConnectionHandler();
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket Server] New Twilio connection established.');
      
      // CallSid will now be extracted from Twilio start message parameters (more reliable)
      console.log('[WebSocket Server] Initializing RealtimeAgentService - CallSid will be obtained from start message');
      const agent = new RealtimeAgentService(ws);
      
      // We'll track the connection temporarily until we get the CallSid from the start message
      const tempConnectionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.activeConnections.set(tempConnectionId, agent);
      console.log(`[WebSocket Server] Temporary connection established: ${tempConnectionId}. Active connections: ${this.activeConnections.size}`);

      // Listen for when the agent gets its CallSid from the start message
      agent.onCallSidReceived = (callSid: string) => {
        console.log(`[WebSocket Server] CallSid received from start message: ${callSid}`);
        // Move connection from temp ID to actual CallSid
        this.activeConnections.delete(tempConnectionId);
        this.activeConnections.set(callSid, agent);
        console.log(`[WebSocket Server] Audio bridge established for call: ${callSid}. Active connections: ${this.activeConnections.size}`);
      };

      ws.on('close', (code, reason) => {
        console.log(`[WebSocket Server] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        
        this.activeConnections.get(connectionKey)?.cleanup('Twilio');
        this.activeConnections.delete(connectionKey);
        console.log(`[WebSocket Server] Cleaning up audio bridge for connection: ${connectionKey}. Active connections: ${this.activeConnections.size}`);
      });
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