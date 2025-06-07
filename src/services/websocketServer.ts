import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { RealtimeAgentService } from './realtimeAgentService';

/**
 * WebSocket server for handling Twilio Media Streams
 * Creates bidirectional audio bridge between Twilio and OpenAI
 */
export class TwilioWebSocketServer {
  private wss: WebSocketServer;
  private activeConnections = new Map<string, RealtimeAgentService>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/' // Root path for WebSocket connections
    });

    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    console.log('[WebSocket Server] Twilio Media Stream WebSocket server initialized');

    this.wss.on('connection', (ws: WebSocket, request) => {
      console.log('[WebSocket Server] New Twilio connection established');
      
      // Extract call information from headers or query params if available
      const userAgent = request.headers['user-agent'] || '';
      const isFromTwilio = userAgent.includes('TwilioProxy') || userAgent.includes('Twilio');
      
      if (!isFromTwilio) {
        console.warn('[WebSocket Server] Connection not from Twilio, closing');
        ws.close(1008, 'Only Twilio connections allowed');
        return;
      }

      let callSid: string | null = null;
      let realtimeAgent: RealtimeAgentService | null = null;

      // Handle incoming messages from Twilio
      ws.on('message', async (message: WebSocket.Data) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Extract CallSid from the first message
          if (!callSid && data.start?.callSid) {
            const extractedCallSid = data.start.callSid;
            
            // Guard clause: Ensure CallSid is valid before proceeding
            if (!extractedCallSid || typeof extractedCallSid !== 'string') {
              console.error('[WebSocket] Connection rejected: CallSid could not be determined from request URL.');
              ws.close(4001, 'CallSid not found');
              return;
            }
            
            callSid = extractedCallSid;
            console.log(`[WebSocket Server] CallSid identified: ${callSid}`);
            
            // Create and connect RealtimeAgentService
            realtimeAgent = new RealtimeAgentService(callSid);
            this.activeConnections.set(callSid, realtimeAgent);
            
            try {
              await realtimeAgent.connect(ws);
              console.log(`[WebSocket Server] Audio bridge established for call: ${callSid}`);
            } catch (error) {
              console.error(`[WebSocket Server] Failed to establish audio bridge for call ${callSid}:`, error);
              ws.close(1011, 'Failed to connect to AI service');
              return;
            }
          }
          
          // All message handling is now done in RealtimeAgentService
          // The service will handle the bidirectional audio forwarding
          
        } catch (error) {
          console.error('[WebSocket Server] Error processing Twilio message:', error);
        }
      });

      // Handle connection errors
      ws.on('error', (error: Error) => {
        console.error('[WebSocket Server] WebSocket error:', error);
        if (callSid && realtimeAgent) {
          realtimeAgent.disconnect();
          this.activeConnections.delete(callSid);
        }
      });

      // Handle connection close
      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[WebSocket Server] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        if (callSid && realtimeAgent) {
          console.log(`[WebSocket Server] Cleaning up audio bridge for call: ${callSid}`);
          realtimeAgent.disconnect();
          this.activeConnections.delete(callSid);
        }
      });
    });

    // Handle server errors
    this.wss.on('error', (error: Error) => {
      console.error('[WebSocket Server] Server error:', error);
    });
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

  /**
   * Gracefully close all connections
   */
  public async close(): Promise<void> {
    console.log('[WebSocket Server] Closing WebSocket server...');
    
    // Disconnect all active agents
    for (const [callSid, agent] of this.activeConnections) {
      console.log(`[WebSocket Server] Disconnecting agent for call: ${callSid}`);
      agent.disconnect();
    }
    
    this.activeConnections.clear();
    
    // Close the WebSocket server
    return new Promise((resolve) => {
      this.wss.close(() => {
        console.log('[WebSocket Server] WebSocket server closed');
        resolve();
      });
    });
  }
} 