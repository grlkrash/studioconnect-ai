import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ config: null })

    const config = await prisma.agentConfig.findUnique({ where: { businessId: biz.id } })
    return NextResponse.json({ config })
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

    const allowedFields = [
      'agentName',
      'personaPrompt',
      'welcomeMessage',
      'openaiVoice',
      'openaiModel',
      'useOpenaiTts',
      'voiceGreetingMessage',
      'widgetTheme',
    ] as const

    const data: Record<string, any> = {}
    for (const key of allowedFields) if (key in body) data[key] = body[key]

    const config = await prisma.agentConfig.upsert({
      where: { businessId: biz.id },
      update: data,
      create: { businessId: biz.id, ...data },
    })

    return NextResponse.json({ config })
  } catch (err: any) {
    console.error('[AGENT_CONFIG_PUT]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
} 