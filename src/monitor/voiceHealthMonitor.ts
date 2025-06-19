import dotenv from 'dotenv'
import axios from 'axios'
import RedisManager from '../config/redis'
import { generateSpeechFromText } from '../services/openai'

dotenv.config()

const API_KEY = process.env.ELEVENLABS_API_KEY
if (!API_KEY) {
  console.error('[VoiceMonitor] ELEVENLABS_API_KEY not set – exiting')
  process.exit(1)
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const LATENCY_THRESHOLD_MS = parseInt(process.env.VOICE_LATENCY_THRESHOLD_MS || '1000', 10)
const CHECK_INTERVAL_MS = parseInt(process.env.VOICE_CHECK_INTERVAL_MS || '120000', 10) // 2 min default

const redisMgr = RedisManager.getInstance()

async function sendSlackAlert (text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.warn('[VoiceMonitor] Failed to post Slack alert:', (err as Error).message)
  }
}

async function recordStatus (latency: number, healthy: boolean): Promise<void> {
  try {
    await redisMgr.connect()
    const client = redisMgr.getClient()
    const payload = JSON.stringify({ ts: Date.now(), latency, healthy })
    await client.set('voice:health', payload, { PX: CHECK_INTERVAL_MS * 2 })
  } catch (err) {
    console.warn('[VoiceMonitor] Redis write failed:', (err as Error).message)
  }
}

async function prewarmPolly (): Promise<void> {
  console.log('[VoiceMonitor] Pre-warming Polly fallback…')
  await generateSpeechFromText('Warm-up', 'Amy', 'tts-1', 'polly')
}

async function runCheck (): Promise<void> {
  const start = Date.now()
  let latency = 0
  let healthy = true

  try {
    await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': API_KEY },
      timeout: 5000,
    })
    latency = Date.now() - start
    healthy = latency <= LATENCY_THRESHOLD_MS
  } catch (err) {
    latency = Date.now() - start
    healthy = false
    console.error('[VoiceMonitor] ElevenLabs ping failed:', (err as Error).message)
  }

  await recordStatus(latency, healthy)

  if (!healthy) {
    console.error(`[VoiceMonitor] High latency ${latency} ms (> ${LATENCY_THRESHOLD_MS} ms)`)
    await prewarmPolly()
    await sendSlackAlert(`:warning: ElevenLabs latency ${latency} ms exceeded threshold. Polly fallback pre-warmed.`)
  } else {
    console.log(`[VoiceMonitor] OK – latency ${latency} ms`)
  }
}

async function main (): Promise<void> {
  await runCheck()
  setInterval(runCheck, CHECK_INTERVAL_MS)
}

main().catch((err) => {
  console.error('[VoiceMonitor] Fatal error:', err)
  process.exit(1)
}) 