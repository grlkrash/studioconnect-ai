import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const startOfDay = new Date()
    startOfDay.setHours(0,0,0,0)
    const callsToday = await prisma.callLog.count({
      where: {
        businessId: biz.id,
        createdAt: { gte: startOfDay },
        direction: 'INBOUND',
      },
    })

    // Success rate: completed calls / total calls
    const [totalCalls, completedCalls] = await Promise.all([
      prisma.callLog.count({ where: { businessId: biz.id } }),
      prisma.callLog.count({ where: { businessId: biz.id, status: 'COMPLETED' } }),
    ])
    const successRate = totalCalls ? ((completedCalls / totalCalls) * 100).toFixed(1) + '%' : '—'

    const responseTimes = await prisma.callLog.findMany({
      where: { businessId: biz.id, metadata: { path: ['responseTime'] } },
      select: { metadata: true },
      take: 1000,
    })
    const avgResponse = responseTimes.length
      ? (
          responseTimes.reduce((sum, c) => {
            const rt = (c.metadata as any).responseTime ?? 0
            return sum + rt
          }, 0) / responseTimes.length
        ).toFixed(1) + 's'
      : '—'

    // Avg call duration (seconds) from metadata.duration else diff timestamps
    const durations = await prisma.callLog.findMany({
      where: { businessId: biz.id, status: 'COMPLETED' },
      select: { metadata: true, createdAt: true, updatedAt: true },
      take: 1000,
    })
    const avgDurationSec = durations.length
      ? (
          durations.reduce((sum, c) => {
            const d = (c.metadata as any)?.duration
            if (typeof d === 'number' && d > 0) return sum + d
            // fallback to timestamp diff secs
            return sum + (c.updatedAt.getTime() - c.createdAt.getTime()) / 1000
          }, 0) / durations.length
        ).toFixed(0)
      : null
    const avgDuration = avgDurationSec ? `${avgDurationSec}s` : '—'

    return NextResponse.json({
      businessId: biz.id,
      agentStatus: 'Online',
      callsToday,
      avgResponse,
      avgDuration,
      successRate,
    })
  } catch (err) {
    console.error('[DASH_STATUS]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 