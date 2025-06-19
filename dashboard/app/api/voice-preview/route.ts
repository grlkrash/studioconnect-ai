import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, voiceSettings } = await req.json()
    
    if (!text || !voiceId) {
      return NextResponse.json({ error: 'Text and voiceId are required' }, { status: 400 })
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ElevenLabs API key not configured' }, { status: 500 })
    }

    // Generate speech using ElevenLabs API
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    
    const requestBody = {
      text: text.slice(0, 500), // Limit preview text length
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: voiceSettings?.stability ?? 0.5,
        similarity_boost: voiceSettings?.similarity ?? 0.8,
        style: voiceSettings?.style ?? 0.0,
        use_speaker_boost: voiceSettings?.use_speaker_boost ?? true,
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('ElevenLabs API error:', response.status, errorText)
      return NextResponse.json({ error: 'Failed to generate voice preview' }, { status: 500 })
    }

    const audioBuffer = await response.arrayBuffer()
    
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="voice-preview.mp3"',
      },
    })
    
  } catch (err: any) {
    console.error('[VOICE_PREVIEW] Error:', err)
    return NextResponse.json({ 
      error: 'Failed to generate voice preview',
      details: err.message 
    }, { status: 500 })
  }
} 