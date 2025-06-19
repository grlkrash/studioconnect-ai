import { NextResponse } from 'next/server'
import twilio from 'twilio'
import OpenAI from 'openai'

export const runtime = 'nodejs'

async function quickCheck<T>(fn: () => Promise<T>, timeoutMs = 2500): Promise<boolean> {
  try {
    return await Promise.race([
      fn().then(() => true).catch(() => false),
      new Promise<boolean>((res) => setTimeout(() => res(false), timeoutMs)),
    ])
  } catch {
    return false
  }
}

export async function GET() {
  // Minimal "is everything wired" health-probe for uptime monitors
  const twilioOk = await quickCheck(async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return false
    const cli = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    // lightweight request (does not count towards rate limits)
    await cli.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch()
  })

  const openaiOk = await quickCheck(async () => {
    if (!process.env.OPENAI_API_KEY) return false
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    await openai.models.list({ limit: 1 })
  })

  const elevenOk = await quickCheck(async () => {
    if (!process.env.ELEVENLABS_API_KEY) return false
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    })
    if (!res.ok) throw new Error('ElevenLabs error')
  })

  const everythingUp = twilioOk && openaiOk && elevenOk
  return NextResponse.json({ ok: everythingUp, twilio: twilioOk, openai: openaiOk, elevenLabs: elevenOk })
} 