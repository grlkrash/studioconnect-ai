import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Utility: first business fallback while auth is WIP
async function getBusiness() {
  return prisma.business.findFirst({ select: { id: true } })
}

export async function GET() {
  try {
    const biz = await getBusiness()
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
    const biz = await getBusiness()
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