import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const calls = await prisma.callLog.findMany({ where: { businessId: biz.id }, take: 1000 })
    const csvHeader = 'callSid,from,to,status,direction,createdAt\n'
    const csvBody = calls
      .map((c) => [c.callSid, c.from, c.to, c.status, c.direction, c.createdAt.toISOString()].join(','))
      .join('\n')
    const csv = csvHeader + csvBody

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="report.csv"',
      },
    })
  } catch (err) {
    console.error('[ANALYTICS_REPORT]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 