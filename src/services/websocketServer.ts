import { WebSocket, WebSocketServer } from 'ws'
import { Server, IncomingMessage } from 'http'
import { realtimeAgentService } from './realtimeAgentService'

export function setupWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log('New WebSocket connection')
    
    let callSid: string | undefined

    try {
      // `req.url` contains the path + query string sent by Twilio (e.g. "/?callSid=...&businessId=...")
      // In production we occasionally see it as `undefined` or just `/`.  Handle those cases gracefully.

      const rawUrl = typeof req.url === 'string' && req.url.trim() !== '' ? req.url : '/'

      // Always give URL an absolute base so Node's parser never throws.
      let fullUrl: URL
      try {
        fullUrl = new URL(rawUrl, 'http://localhost')
      } catch (parseErr) {
        // Fallback – should never happen, but guarantees we keep the socket alive.
        console.warn('Invalid request URL received for WebSocket upgrade – falling back to root', {
          rawUrl,
          error: parseErr instanceof Error ? parseErr.message : parseErr
        })
        fullUrl = new URL('/', 'http://localhost')
      }

      const params = fullUrl.searchParams

      callSid = params.get('callSid') || undefined

      // Forward the connection and parsed params to the realtime agent service
      realtimeAgentService.handleNewConnection(ws, params)
    } catch (error) {
      console.error('Error processing WebSocket connection:', error)
      ws.close(1008, 'Invalid connection parameters')
      return
    }

    ws.on('message', (message: string) => {
      try {
        console.log('Received message:', message.toString())
        // Messages are handled by RealtimeAgentService's internal Twilio listener
      } catch (error) {
        console.error('Error processing message:', error)
      }
    })

    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error)
      if (callSid) realtimeAgentService.cleanup(callSid)
    })

    ws.on('close', (code: number, reason: string) => {
      console.log(`WebSocket connection closed: ${code} - ${reason}`)
      if (callSid) realtimeAgentService.cleanup(callSid)
    })
  })

  console.log('WebSocket server started')
  return wss
} 