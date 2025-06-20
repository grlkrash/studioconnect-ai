import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import { bulletproofEnterpriseAgent } from './realtimeAgentService'
import url from 'url'

export class VoiceWebSocketServer {
  private wss: WebSocketServer
  
  constructor(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/voice-ws'
    })
    
    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request)
    })
    
    console.log('[WebSocket] Bulletproof Enterprise Voice WebSocket server initialized')
  }
  
  private async handleConnection(ws: WebSocket, request: IncomingMessage) {
    const parsedUrl = url.parse(request.url || '', true)
    const params = new URLSearchParams(parsedUrl.query as any)
    
    const callSid = params.get('callSid')
    
    console.log(`[🏢 ENTERPRISE WEBSOCKET] New Fortune 100/50 quality connection - CallSid: ${callSid}`)
    
    try {
      // Route all calls to bulletproof enterprise agent
      await bulletproofEnterpriseAgent.handleNewCall(ws, params)
      console.log(`[🏢 ENTERPRISE WEBSOCKET] ✅ Enterprise call routed successfully`)
    } catch (error) {
      console.error('[🏢 ENTERPRISE WEBSOCKET] ❌ Failed to handle connection:', error)
      ws.close(1011, 'Enterprise connection handling failed')
    }
  }
  
  public getConnectionCount(): number {
    return this.wss.clients.size
  }
}

export let voiceWebSocketServer: VoiceWebSocketServer | null = null

export function initializeVoiceWebSocketServer(server: Server): VoiceWebSocketServer {
  if (!voiceWebSocketServer) {
    voiceWebSocketServer = new VoiceWebSocketServer(server)
  }
  return voiceWebSocketServer
} 