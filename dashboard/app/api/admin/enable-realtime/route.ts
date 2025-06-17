import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    // TODO: add admin authentication/authorization guard.
    const { count } = await prisma.agentConfig.updateMany({
      data: {
        ttsProvider: 'realtime',
        useOpenaiTts: true,
      },
    })

    return NextResponse.json({ updated: count })
  } catch (err) {
    console.error('[ADMIN_ENABLE_REALTIME]', err)
    return NextResponse.json({ error: 'Failed to enable realtime' }, { status: 500 })
  }
}