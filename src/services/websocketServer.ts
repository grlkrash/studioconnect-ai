import { WebSocket, WebSocketServer } from 'ws'
import { Server } from 'http'
import { realtimeAgentService } from './realtimeAgentService'

interface WebSocketWithUrl extends WebSocket {
  url: string
}

export function setupWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocketWithUrl) => {
    console.log('New WebSocket connection')
    
    try {
      const url = new URL(ws.url)
      const params = new URLSearchParams(url.search)
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
      const url = new URL(ws.url)
      const params = new URLSearchParams(url.search)
      const callSid = params.get('callSid')
      if (callSid) realtimeAgentService.cleanup(callSid)
    })

    ws.on('close', (code: number, reason: string) => {
      console.log(`WebSocket connection closed: ${code} - ${reason}`)
      const url = new URL(ws.url)
      const params = new URLSearchParams(url.search)
      const callSid = params.get('callSid')
      if (callSid) realtimeAgentService.cleanup(callSid)
    })
  })

  console.log('WebSocket server started')
  return wss
} 