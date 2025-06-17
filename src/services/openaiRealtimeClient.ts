import { WebSocket } from 'ws'
import { EventEmitter } from 'events'

/**
 * Enhanced OpenAI Realtime Client with bulletproof error handling and connection stability
 * Designed for production voice applications with zero tolerance for failures
 */
export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null
  private ready = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5 // Increased for better reliability
  private reconnectDelay = 2000 // Increased delay for stability
  private heartbeatInterval: NodeJS.Timeout | null = null
  private connectionTimeout: NodeJS.Timeout | null = null
  private lastPongReceived = Date.now()
  private connectionHealthCheck: NodeJS.Timeout | null = null
  private isConnecting = false

  constructor(
    private readonly apiKey: string,
    private voice: string = 'nova',
    private instructions: string = 'You are a helpful assistant.',
  ) {
    super()
    this.setMaxListeners(20) // Prevent memory leaks
  }

  /** Establishes bulletproof connection with comprehensive error handling */
  async connect(endpoint = 'wss://api.openai.com/v1/realtime'): Promise<void> {
    if (this.isConnecting) {
      console.log('[OpenAIRealtimeClient] Connection already in progress, waiting...')
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000)
        this.once('ready', () => {
          clearTimeout(timeout)
          resolve()
        })
        this.once('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    }

    this.isConnecting = true
    
    try {
      await this.establishConnection(endpoint)
    } catch (error) {
      this.isConnecting = false
      console.error('[OpenAIRealtimeClient] Failed to establish connection:', error)
      throw error
    }
  }

  /** Enhanced connection establishment with retry logic */
  private async establishConnection(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[OpenAIRealtimeClient] Connecting to ${endpoint} (attempt ${this.reconnectAttempts + 1})`)
      
      // Set connection timeout
      this.connectionTimeout = setTimeout(() => {
        console.error('[OpenAIRealtimeClient] Connection timeout after 10 seconds')
        this.cleanup()
        reject(new Error('Connection timeout'))
      }, 10000)

      try {
        this.ws = new WebSocket(endpoint, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1'
          },
          handshakeTimeout: 10000,
          perMessageDeflate: false // Disable compression for better performance
        })

        this.ws.on('open', () => {
          console.log('[OpenAIRealtimeClient] WebSocket connection established')
          this.clearConnectionTimeout()
          this.ready = true
          this.isConnecting = false
          this.reconnectAttempts = 0
          this.lastPongReceived = Date.now()
          
          this.startListening()
          this.configureSession()
          this.startHeartbeat()
          this.startHealthCheck()
          
          this.emit('ready')
          resolve()
        })

        this.ws.on('error', (error) => {
          console.error('[OpenAIRealtimeClient] WebSocket connection error:', error)
          this.isConnecting = false
          this.cleanup()
          
          // Enhanced error classification
          let errorMessage = 'Connection failed'
          if (error.message?.includes('401')) {
            errorMessage = 'Authentication failed - check API key'
          } else if (error.message?.includes('403')) {
            errorMessage = 'Access forbidden - insufficient permissions'
          } else if (error.message?.includes('429')) {
            errorMessage = 'Rate limit exceeded - please try again later'
          } else if (error.message?.includes('timeout')) {
            errorMessage = 'Connection timeout - network issues'
          }
          
          reject(new Error(errorMessage))
        })

        this.ws.on('close', (code, reason) => {
          console.log(`[OpenAIRealtimeClient] Connection closed: ${code} ${reason.toString()}`)
          this.isConnecting = false
          this.handleDisconnection(code, reason.toString())
          
          if (this.connectionTimeout) {
            reject(new Error(`Connection closed: ${code} ${reason.toString()}`))
          }
        })

      } catch (error) {
        console.error('[OpenAIRealtimeClient] Failed to create WebSocket:', error)
        this.isConnecting = false
        this.cleanup()
        reject(error)
      }
    })
  }

  /** Sends audio data with error handling */
  sendAudio(payloadB64: string): void {
    if (!this.isReady()) {
      console.warn('[OpenAIRealtimeClient] Cannot send audio - client not ready')
      return
    }

    try {
      const msg = {
        type: 'input_audio_buffer.append',
        audio: payloadB64
      }
      this.ws!.send(JSON.stringify(msg))
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error sending audio:', error)
      this.handleConnectionError(error)
    }
  }

  /** Sends user text with validation */
  sendUserText(text: string): void {
    if (!this.isReady()) {
      console.warn('[OpenAIRealtimeClient] Cannot send text - client not ready')
      return
    }

    if (!text || text.trim().length === 0) {
      console.warn('[OpenAIRealtimeClient] Cannot send empty text')
      return
    }

    try {
      const msg = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: text.trim() }]
        }
      }
      this.ws!.send(JSON.stringify(msg))
      console.log(`[OpenAIRealtimeClient] Sent user text: ${text.substring(0, 50)}...`)
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error sending text:', error)
      this.handleConnectionError(error)
    }
  }

  /** Requests assistant response with validation */
  requestAssistantResponse(): void {
    if (!this.isReady()) {
      console.warn('[OpenAIRealtimeClient] Cannot request response - client not ready')
      return
    }

    try {
      this.ws!.send(JSON.stringify({ type: 'response.create' }))
      console.log('[OpenAIRealtimeClient] Requested assistant response')
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error requesting response:', error)
      this.handleConnectionError(error)
    }
  }

  /** Updates session instructions with validation */
  updateInstructions(newInstructions: string): void {
    if (!this.isReady()) {
      console.warn('[OpenAIRealtimeClient] Cannot update instructions - client not ready')
      return
    }

    if (!newInstructions || newInstructions.trim().length === 0) {
      console.warn('[OpenAIRealtimeClient] Cannot set empty instructions')
      return
    }

    try {
      this.instructions = newInstructions.trim()
      const cfg = {
        type: 'session.update',
        session: {
          instructions: this.instructions
        }
      }
      this.ws!.send(JSON.stringify(cfg))
      console.log('[OpenAIRealtimeClient] Instructions updated successfully')
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error updating instructions:', error)
      this.handleConnectionError(error)
    }
  }

  /** Gracefully closes connection */
  close(): void {
    console.log('[OpenAIRealtimeClient] Closing connection...')
    this.cleanup()
  }

  /** Checks if client is ready for operations */
  private isReady(): boolean {
    return this.ready && this.ws && this.ws.readyState === WebSocket.OPEN && !this.isConnecting
  }

  /** Configures OpenAI session with optimized settings for professional voice calls */
  private configureSession(): void {
    if (!this.isReady()) return

    try {
      const cfg = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: this.instructions,
          voice: this.voice,
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.3, // More sensitive for better conversation flow
            prefix_padding_ms: 200, // Reduced for faster response
            silence_duration_ms: 600 // Balanced for natural pauses
          },
          tool_choice: 'auto',
          temperature: 0.7, // Slightly reduced for more consistent responses
          max_response_output_tokens: 2048 // Optimized for voice responses
        }
      }

      this.ws!.send(JSON.stringify(cfg))
      console.log('[OpenAIRealtimeClient] Session configured for professional voice calls')
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error configuring session:', error)
      this.handleConnectionError(error)
    }
  }

  /** Enhanced message handling with comprehensive error recovery */
  private startListening(): void {
    if (!this.ws) return

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch (err) {
        console.error('[OpenAIRealtimeClient] Failed to parse message:', err)
        // Don't emit errors for parsing issues, just log them
      }
    })

    this.ws.on('close', (code, reason) => {
      console.log(`[OpenAIRealtimeClient] Connection closed: ${code} ${reason.toString()}`)
      this.handleDisconnection(code, reason.toString())
    })

    this.ws.on('error', (error) => {
      console.error('[OpenAIRealtimeClient] WebSocket error:', error)
      this.handleConnectionError(error)
    })

    this.ws.on('ping', () => {
      if (this.ws) {
        this.ws.pong()
      }
    })

    this.ws.on('pong', () => {
      this.lastPongReceived = Date.now()
    })
  }

  /** Enhanced message handling with better error classification */
  private handleMessage(msg: any): void {
    try {
      // Handle different message types
      switch (msg.type) {
        case 'response.audio.delta':
          if (msg.delta) {
            this.emit('assistantAudio', msg.delta)
          }
          break

                 case 'response.text.delta':
           if (msg.delta && typeof msg.delta === 'string' && msg.delta.trim()) {
             this.emit('assistantTextDelta', msg.delta)
           }
           break

        case 'conversation.item.created':
          if (msg.item?.role === 'assistant' && msg.item?.content) {
            const textContent = msg.item.content.find((c: any) => c.type === 'text')
            if (textContent?.text && textContent.text.trim()) {
              this.emit('assistantMessage', textContent.text.trim())
            }
          }
          break

        case 'input_audio_buffer.speech_started':
          this.emit('speechStarted')
          break

        case 'input_audio_buffer.speech_stopped':
          this.emit('speechStopped')
          break

        case 'response.done':
          this.emit('responseComplete', msg.response)
          break

        case 'error':
          const errorMsg = msg.error?.message || 'Unknown API error'
          const errorCode = msg.error?.code || 'unknown'
          console.error('[OpenAIRealtimeClient] API Error:', errorMsg, 'Code:', errorCode)
          
          // Handle specific error types
          if (errorCode === 'invalid_request_error' || errorCode === 'authentication_error') {
            this.emit('error', new Error(`API Error: ${errorMsg}`))
          } else {
            // For other errors, log but don't emit (let fallback handle it)
            console.warn('[OpenAIRealtimeClient] Non-critical API error, continuing...')
          }
          break

        case 'session.created':
          console.log('[OpenAIRealtimeClient] Session created successfully')
          break

        case 'session.updated':
          console.log('[OpenAIRealtimeClient] Session updated successfully')
          break

        case 'rate_limits.updated':
          if (msg.rate_limits) {
            console.log('[OpenAIRealtimeClient] Rate limits updated:', msg.rate_limits)
          }
          break

        default:
          // Don't log every unknown message type to reduce noise
          break
      }
    } catch (error) {
      console.error('[OpenAIRealtimeClient] Error handling message:', error)
      // Don't emit error for message handling issues
    }
  }

  /** Enhanced connection error handling */
  private handleConnectionError(error: any): void {
    console.error('[OpenAIRealtimeClient] Connection error:', error)
    
    // Only emit error for critical issues
    if (error.message?.includes('401') || error.message?.includes('403')) {
      this.emit('error', error)
    } else {
      // For other errors, attempt recovery
      this.attemptRecovery()
    }
  }

  /** Attempts connection recovery */
  private attemptRecovery(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OpenAIRealtimeClient] Max reconnection attempts reached, switching to fallback')
      this.emit('error', new Error('Max reconnection attempts reached'))
      return
    }

    console.log(`[OpenAIRealtimeClient] Attempting recovery (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`)
    
    setTimeout(() => {
      this.reconnectAttempts++
      this.connect().catch(err => {
        console.error('[OpenAIRealtimeClient] Recovery failed:', err)
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emit('error', new Error('Connection recovery failed'))
        }
      })
    }, this.reconnectDelay * this.reconnectAttempts) // Exponential backoff
  }

  /** Handles connection disconnection with smart reconnection logic */
  private handleDisconnection(code: number, reason: string): void {
    this.ready = false
    this.stopHeartbeat()
    this.stopHealthCheck()
    this.emit('close', code, reason)

    // Only attempt reconnection for recoverable disconnections
    if (code === 1006 || code === 1011 || code === 1012 || code === 1001) {
      this.attemptRecovery()
    } else if (code === 1000) {
      // Normal closure, don't reconnect
      console.log('[OpenAIRealtimeClient] Connection closed normally')
    } else {
      console.log(`[OpenAIRealtimeClient] Connection closed with code ${code}, not attempting reconnection`)
      this.emit('error', new Error(`Connection closed: ${code} ${reason}`))
    }
  }

  /** Enhanced heartbeat with connection health monitoring */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 25000) // More frequent pings for better reliability
  }

  /** Stops heartbeat interval */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /** Starts connection health monitoring */
  private startHealthCheck(): void {
    this.connectionHealthCheck = setInterval(() => {
      const now = Date.now()
      if (now - this.lastPongReceived > 60000) { // No pong in 60 seconds
        console.warn('[OpenAIRealtimeClient] Connection appears unhealthy, attempting recovery')
        this.attemptRecovery()
      }
    }, 30000)
  }

  /** Stops health check interval */
  private stopHealthCheck(): void {
    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck)
      this.connectionHealthCheck = null
    }
  }

  /** Clears connection timeout */
  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
  }

  /** Comprehensive cleanup with proper resource management */
  private cleanup(): void {
    this.ready = false
    this.isConnecting = false
    this.stopHeartbeat()
    this.stopHealthCheck()
    this.clearConnectionTimeout()
    
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'Client cleanup')
        }
      } catch (error) {
        console.error('[OpenAIRealtimeClient] Error during cleanup:', error)
      }
      this.ws = null
    }

    // Don't remove all listeners as parent components may be listening
    // this.removeAllListeners()
  }
} 