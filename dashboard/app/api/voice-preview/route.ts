import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { text, model = 'tts-1', voice = 'NOVA' } = await req.json()
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 })

    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, voice, input: text, format: 'mp3', response_format: 'b64_json' }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('[VOICE_PREVIEW]', err)
      return NextResponse.json({ error: 'OpenAI error' }, { status: 500 })
    }

    const data = await resp.json()
    return NextResponse.json({ audioBase64: data.audio })
  } catch (err) {
    console.error('[VOICE_PREVIEW_UNK]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 