import { NextRequest, NextResponse } from 'next/server'
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly"

export async function POST(req: NextRequest) {
  try {
    const { text, model = 'tts-1', voice = 'nova', provider = 'openai' } = await req.json()
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 })

      const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, voice: voice.toLowerCase(), input: text, format: 'mp3', response_format: 'b64_json' }),
      })

      if (!resp.ok) {
        const err = await resp.text()
        console.error('[VOICE_PREVIEW]', err)
        return NextResponse.json({ error: 'OpenAI error' }, { status: 500 })
      }

      const data = await resp.json()
      return NextResponse.json({ audioBase64: data.audio })
    }

    // Polly fallback
    const pollyRegion = process.env.AWS_REGION || 'us-east-1'
    const pollyClient = new PollyClient({ region: pollyRegion })
    const pollyVoice = voice.charAt(0).toUpperCase() + voice.slice(1).toLowerCase() // e.g., "Joanna"

    const synthCommand = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: pollyVoice as any,
    })
    const pollyResp = await pollyClient.send(synthCommand)
    const uint8 = await pollyResp.AudioStream?.transformToByteArray()
    if (!uint8) throw new Error('Polly audio stream empty')
    const audioBase64 = Buffer.from(uint8).toString('base64')
    return NextResponse.json({ audioBase64 })
  } catch (err) {
    console.error('[VOICE_PREVIEW_UNK]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 