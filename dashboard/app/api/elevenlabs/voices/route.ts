import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing ELEVENLABS_API_KEY' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
      next: { revalidate: 60 * 5 }, // cache for 5 min
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: 'Upstream error', detail: err }, { status: 502 })
    }

    const data = await res.json()
    return NextResponse.json(data, { status: 200 })
  } catch (err: any) {
    console.error('[API] elevenlabs voices error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
} 