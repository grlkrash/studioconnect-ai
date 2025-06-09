import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { RealtimeAgentService } from './realtimeAgentService';
import url from 'url';

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
      
      const requestUrl = new URL(req.url!, `http://${req.headers.host}`);
      const callSid = requestUrl.searchParams.get('CallSid');

      if (!callSid) {
        console.error('[WebSocket Server] Connection rejected: CallSid not found in request URL.');
        ws.close(1011, 'CallSid is required.');
        return;
      }

      console.log(`[WebSocket Server] CallSid identified: ${callSid}`);
      const agent = new RealtimeAgentService(ws, req);
      this.activeConnections.set(callSid, agent);
      console.log(`[WebSocket Server] Audio bridge established for call: ${callSid}. Active connections: ${this.activeConnections.size}`);

      ws.on('close', (code, reason) => {
        console.log(`[WebSocket Server] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        this.activeConnections.get(callSid)?.cleanup('Twilio');
        this.activeConnections.delete(callSid);
        console.log(`[WebSocket Server] Cleaning up audio bridge for call: ${callSid}. Active connections: ${this.activeConnections.size}`);
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