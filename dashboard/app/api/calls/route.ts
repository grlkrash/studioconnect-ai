import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ calls: [] })

    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const calls = await prisma.callLog.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        phoneNumber: true,
        duration: true,
        status: true,
        createdAt: true,
        endedAt: true,
        transcript: true,
        metadata: true,
      },
    })

    return NextResponse.json({ calls })
  } catch (err) {
    console.error('[CALLS_GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 