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

type Biz = { id: string; name: string; twilioPhoneNumber: string | null }

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

  if (!['in-progress', 'completed'].includes(lastStatus)) {
    console.error(`[Monitor] ❌ ALERT: Synthetic call to ${biz.name} did not connect (status: ${lastStatus})`)
    // TODO: send notification via email / Slack / PagerDuty
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