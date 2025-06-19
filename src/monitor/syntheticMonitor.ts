import dotenv from 'dotenv'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'

dotenv.config()

/**
 * Synthetic monitoring script
 * ---------------------------------------
 * 1. Pull all businesses with an active Twilio phone number
 * 2. For each, place a short test call from a dedicated caller ID
 * 3. Poll Twilio for up to 40 s to confirm the call reached `in-progress` or `completed`
 * 4. Log problems (TODO: integrate email / Slack alert)
 *
 * Run once via `npm run monitor` or schedule with cron / Render Cron Job.
 */

const prisma = new PrismaClient()

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
)

const MONITOR_CALLER_ID = process.env.MONITOR_CALLER_ID || '+15005550006' // Twilio test number
const MAX_WAIT_MS = 40_000 // 40 seconds per call
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const MOS_THRESHOLD = 4

type Biz = { id: string; name: string; twilioPhoneNumber: string | null }

function postSlackAlert(text: string): void {
  if (!SLACK_WEBHOOK_URL) return
  fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((err) => {
    console.warn('[Monitor] Failed to post Slack alert:', (err as Error).message)
  })
}

async function placeTestCall(biz: Biz): Promise<void> {
  if (!biz.twilioPhoneNumber) return

  console.log(`[Monitor] 🚀 Dialing ${biz.name} (${biz.twilioPhoneNumber})`)
  const call = await twilioClient.calls.create({
    to: biz.twilioPhoneNumber,
    from: MONITOR_CALLER_ID,
    timeout: 15, // seconds to wait for answer before ending
  })

  const start = Date.now()
  let lastStatus = 'queued'

  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 3_000))
    const updated = await twilioClient.calls(call.sid).fetch()
    lastStatus = updated.status as string
    if (['in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(lastStatus)) {
      break
    }
  }

  console.log(`[Monitor] 📞 Call ${call.sid} finished with status: ${lastStatus}`)

  let mosScore: number | null = null
  try {
    // @ts-ignore – Feedback API not in older twilio typings
    const feedback = await (twilioClient.calls(call.sid) as any).feedback().fetch()
    // feedback.qualityScore can be string or number depending on SDK version
    if (feedback && (feedback as any).qualityScore !== undefined) {
      mosScore = parseFloat(String((feedback as any).qualityScore))
      console.log(`[Monitor] MOS for ${call.sid}: ${mosScore}`)
    }
  } catch (err) {
    console.warn('[Monitor] Unable to fetch feedback for call', call.sid)
  }

  const badStatus = !['in-progress', 'completed'].includes(lastStatus)
  const badMos = mosScore !== null && mosScore < MOS_THRESHOLD

  if (badStatus || badMos) {
    const reason = badStatus ? `status: ${lastStatus}` : `MOS ${mosScore}`
    const alertText = `:rotating_light: Synthetic call alert for *${biz.name}* – ${reason}`
    console.error(`[Monitor] ❌ ALERT: ${alertText}`)
    postSlackAlert(alertText)
  }
}

async function run(): Promise<void> {
  try {
    const businesses = await prisma.business.findMany({
      where: { twilioPhoneNumber: { not: null } },
      select: { id: true, name: true, twilioPhoneNumber: true },
    })

    if (businesses.length === 0) {
      console.log('[Monitor] No businesses with Twilio numbers found – nothing to test.')
      return
    }

    for (const biz of businesses) {
      await placeTestCall(biz)
    }
  } catch (error) {
    console.error('[Monitor] Critical error running synthetic monitor', error)
  } finally {
    await prisma.$disconnect()
  }
}

run() 