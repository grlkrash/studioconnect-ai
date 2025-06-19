import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ config: null })

    const config = await prisma.agentConfig.findUnique({ where: { businessId: biz.id } })
    const realtimeAvailable = process.env.OPENAI_REALTIME_ENABLED === 'true'
    return NextResponse.json({ config, realtimeAvailable })
  } catch (err) {
    console.error('[AGENT_CONFIG_GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    console.log('[AGENT_CONFIG_PUT] Received body:', JSON.stringify(body, null, 2))

    const realtimeAvailable = process.env.OPENAI_REALTIME_ENABLED === 'true'

    // Prevent selecting realtime when not enabled
    if (!realtimeAvailable && body.ttsProvider === 'realtime') {
      return NextResponse.json({ error: 'OpenAI Realtime is not enabled for this deployment.' }, { status: 400 })
    }

    const allowedFields = [
      'agentName',
      'personaPrompt',
      'welcomeMessage',
      'openaiVoice',
      'openaiModel',
      'useOpenaiTts',
      'voiceGreetingMessage',
      'voiceCompletionMessage',
      'voiceEmergencyMessage',
      'voiceEndCallMessage',
      'ttsProvider',
      'widgetTheme',
      'voiceSettings',
      'elevenlabsVoice',
      'elevenlabsModel',
      'leadCaptureCompletionMessage',
      'colorTheme',
    ] as const

    const data: Record<string, any> = {}
    for (const key of allowedFields) {
      if (key in body && body[key] !== undefined) {
        data[key] = body[key]
      }
    }

    console.log('[AGENT_CONFIG_PUT] Filtered data to save:', JSON.stringify(data, null, 2))

    // Ensure JSON serialization for complex objects
    if (data.voiceSettings && typeof data.voiceSettings === 'object') {
      data.voiceSettings = JSON.stringify(data.voiceSettings)
    }
    if (data.widgetTheme && typeof data.widgetTheme === 'object') {
      data.widgetTheme = JSON.stringify(data.widgetTheme)
    }
    if (data.colorTheme && typeof data.colorTheme === 'object') {
      data.colorTheme = JSON.stringify(data.colorTheme)
    }

    const updatedConfig = await prisma.agentConfig.upsert({
      where: { businessId: biz.id },
      update: data,
      create: { businessId: biz.id, ...data },
    })

    console.log('[AGENT_CONFIG_PUT] Successfully saved config:', updatedConfig.id)

    return NextResponse.json({ 
      success: true,
      updatedConfig, 
      realtimeAvailable 
    })
  } catch (err: any) {
    console.error('[AGENT_CONFIG_PUT] Error:', err)
    return NextResponse.json({ 
      error: 'Failed to update agent configuration',
      details: err.message 
    }, { status: 500 })
  }
} 