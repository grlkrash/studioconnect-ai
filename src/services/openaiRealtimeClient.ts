import WebSocket from 'ws'
import { EventEmitter } from 'events'

/**
 * Wrapper around the OpenAI Realtime API (experimental).
 * Handles session bootstrap, streaming caller audio → OpenAI and
 * emitting events for assistant audio, text, and errors.
 */
export class OpenAIRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null
  private ready = false

  constructor(
    private readonly apiKey: string,
    private readonly voice: string = 'alloy',
    private readonly instructions: string = 'You are a helpful assistant.',
  ) {
    super()
  }

  /** Establishes the WebSocket connection and configures a new session. */
  async connect(endpoint = 'wss://api.openai.com/v1/realtime'): Promise<void> {
    if (this.ws) return // already connected

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Organization': process.env.OPENAI_ORG_ID || undefined,
        } as Record<string, string>,
      })

      this.ws.once('open', () => {
        this.configureSession()
        this.startListening()
        this.ready = true
        this.emit('open')
        resolve()
      })

      this.ws.once('error', (err) => {
        this.emit('error', err)
        reject(err)
      })
    })
  }

  /** Sends caller audio chunk (base64 g711-ulaw 8kHz mono) to OpenAI. */
  sendAudio(payloadB64: string): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const msg = {
      type: 'input_audio.delta',
      audio: {
        data: payloadB64,
        format: 'g711_ulaw',
      },
    }
    this.ws.send(JSON.stringify(msg))
  }

  /** Pushes user text messages to the assistant (optional). */
  sendUserText(text: string): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const msg = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text }],
      },
    }
    this.ws.send(JSON.stringify(msg))
  }

  /** Request the assistant to produce a response (after sending text). */
  requestAssistantResponse(): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'response.create' }))
  }

  /** Close connection. */
  close(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
      this.ready = false
      this.removeAllListeners()
    }
  }

  /** Configure session after open. */
  private configureSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const cfg = {
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: this.instructions,
        voice: this.voice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        response_format: { type: 'audio' },
      },
    }
    this.ws.send(JSON.stringify(cfg))
  }

  /** Start listening to messages and emitting events. */
  private startListening(): void {
    if (!this.ws) return

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.emit('message', msg) // Generic message for logging

        if (msg.type === 'response.audio.delta' && msg.delta) {
          this.emit('assistantAudio', msg.delta as string)
        } else if (
          msg.type === 'conversation.item.update' &&
          msg.item?.role === 'assistant'
        ) {
          const contentItem = msg.item.content?.[0]
          if (contentItem?.type === 'text' && contentItem.text) {
            this.emit('assistantMessage', contentItem.text as string)
          }
        } else if (msg.type === 'error') {
          this.emit(
            'error',
            new Error(msg.message || 'Unknown OpenAI Realtime Error'),
          )
        }
      } catch (err) {
        console.error('[OpenAIRealtimeClient] Failed to parse message', err)
        this.emit('error', err as Error)
      }
    })

    this.ws.on('close', (code, reason) => {
      this.emit('close', code, reason.toString())
      this.ready = false
      this.ws = null
    })
  }
} 