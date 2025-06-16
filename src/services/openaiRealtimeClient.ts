import WebSocket from 'ws'

/**
 * Minimal wrapper around the OpenAI Realtime API (experimental).
 * Handles session bootstrap, streaming caller audio → OpenAI and
 * emitting assistant audio deltas back to the caller in g711-ulaw.
 */
export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null
  private ready = false

  constructor(
    private readonly apiKey: string,
    private readonly voice: string = 'alloy',
    private readonly instructions: string = 'You are a helpful assistant.',
  ) {}

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
        this.ready = true
        resolve()
      })

      this.ws.once('error', (err) => {
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
      try { this.ws.close() } catch {}
      this.ws = null
      this.ready = false
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

  /** Register a handler for assistant audio deltas. */
  onAssistantAudio(cb: (b64Ulaw: string) => void): void {
    if (!this.ws) return
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'response.audio.delta' && msg.delta) {
          cb(msg.delta as string)
        }
      } catch (err) {
        console.error('[OpenAIRealtimeClient] Failed to parse message', err)
      }
    })
  }
} 