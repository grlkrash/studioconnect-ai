import { EventEmitter } from 'events'
import WebSocket from 'ws'

export interface ElevenLabsSTTOptions {
  apiKey: string
  modelId?: string // default: eleven_multilingual_v2
}

export class ElevenLabsStreamingClient extends EventEmitter {
  private ws: WebSocket | null = null
  private ready = false

  constructor(private readonly opts: ElevenLabsSTTOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this.ws) return
    const model = this.opts.modelId || 'eleven_multilingual_v2'
    const url = `wss://api.elevenlabs.io/v1/stt?model=${encodeURIComponent(model)}`
    this.ws = new WebSocket(url, {
      headers: { 'xi-api-key': this.opts.apiKey },
    })
    this.ws.binaryType = 'arraybuffer'

    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => {
        this.ready = true
        resolve()
      })
      this.ws!.once('error', reject)
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'transcript') {
          this.emit('transcript', msg.text as string)
        }
      } catch {/* ignore */}
    })

    this.ws.on('close', () => {
      this.ready = false
      this.emit('close')
    })
  }

  isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN
  }

  sendAudio(buf: Buffer): void {
    if (!this.isReady()) return
    this.ws!.send(buf)
  }

  close(): void {
    try { this.ws?.close() } catch {}
    this.ready = false
  }
} 