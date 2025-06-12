import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { RealtimeAgentService } from './realtimeAgentService';

interface ConnectionState {
  agent: RealtimeAgentService;
  createdAt: Date;
  lastPing: Date;
}

/**
 * WebSocket server for handling Twilio Media Streams
 * Creates bidirectional audio bridge between Twilio and OpenAI
 */
export class TwilioWebSocketServer {
  private wss: WebSocketServer;
  private activeConnections = new Map<string, ConnectionState>();
  private readonly PING_INTERVAL = 30000;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server });
    this.setupConnectionHandler();
    this.setupPingInterval();
    console.log('[WebSocket Server] Initialized.');
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WebSocket Server] New Twilio connection established.');

      // Get the singleton instance
      const agent = RealtimeAgentService.getInstance();
      
      // Parse URL parameters
      const url = new URL(ws.url || '', 'ws://localhost');
      const params = url.searchParams;
      
      // Handle the new connection
      agent.handleNewConnection(ws, params);

      const tempConnectionId = `temp_${Date.now()}`;
      this.activeConnections.set(tempConnectionId, {
        agent,
        createdAt: new Date(),
        lastPing: new Date(),
      });

      ws.on('close', () => {
        const callSid = agent.getCallSid();
        const key = callSid || tempConnectionId;
        this.cleanupConnection(key, 'Connection closed');
      });

      ws.on('error', (error) => {
        const callSid = agent.getCallSid();
        const key = callSid || tempConnectionId;
        this.cleanupConnection(key, `WebSocket error: ${error.message}`);
      });
        
      ws.on('pong', () => {
        const callSid = agent.getCallSid();
        const connectionKey = callSid || tempConnectionId;
        const state = this.activeConnections.get(connectionKey);
        if (state) {
            state.lastPing = new Date();
        }
      });
    });
  }

  private setupPingInterval() {
    this.pingInterval = setInterval(() => {
      this.activeConnections.forEach((state, key) => {
          if (new Date().getTime() - state.lastPing.getTime() > this.PING_INTERVAL * 2) {
              this.cleanupConnection(key, 'Connection stale');
          }
      });
      this.wss.clients.forEach((ws) => ws.ping());
    }, this.PING_INTERVAL);
  }

  private cleanupConnection(key: string, reason: string) {
    const state = this.activeConnections.get(key);
    if (state) {
      this.log(`Cleaning up connection ${key}: ${reason}`);
      state.agent.cleanup(reason);
      this.activeConnections.delete(key);
    }
  }
    
  private log(message: string) {
      console.log(`[WebSocket Server] ${message}`);
  }
    
  public close() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.wss.close();
    this.log('Server closed.');
  }

  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
} 