import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    console.log('[ANALYTICS CALLS API] Processing request...')
    
    const business = await getBusiness(req)
    if (!business) {
      console.log('[ANALYTICS CALLS API] No business found')
      return NextResponse.json({ analytics: null })
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    console.log(`[ANALYTICS CALLS API] Fetching analytics for business: ${business.id}`)

    // Build date range
    let dateFilter: any = {}
    if (from || to) {
      dateFilter.createdAt = {}
      if (from) dateFilter.createdAt.gte = new Date(from)
      if (to) dateFilter.createdAt.lte = new Date(to)
    }

    const where = {
      businessId: business.id,
      ...dateFilter
    }

    // Get call analytics
    const [
      totalCalls,
      completedCalls,
      failedCalls,
      callsWithDuration,
      callsByDirection,
      callsByStatus
    ] = await Promise.all([
      // Total calls
      prisma.callLog.count({ where }),
      
      // Completed calls
      prisma.callLog.count({ 
        where: { ...where, status: 'COMPLETED' }
      }),

      // Failed calls  
      prisma.callLog.count({
        where: { ...where, status: { in: ['FAILED', 'NO_ANSWER', 'BUSY', 'CANCELED'] } }
      }),

      // Average duration (for completed calls) - extracted from metadata
      prisma.callLog.findMany({
        where: { ...where, status: 'COMPLETED' },
        select: { metadata: true }
      }),

      // Calls by direction
      prisma.callLog.groupBy({
        by: ['direction'],
        where,
        _count: { id: true }
      }),

      // Calls by status
      prisma.callLog.groupBy({
        by: ['status'],
        where,
        _count: { id: true }
      })
    ])

    // Calculate average duration from metadata
    const durations = callsWithDuration
      .map(call => (call.metadata as any)?.duration)
      .filter(duration => typeof duration === 'number' && duration > 0)
    const averageDuration = durations.length > 0 
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0

    const analytics = {
      totalCalls,
      completedCalls,
      failedCalls,
      successRate: totalCalls > 0 ? (completedCalls / totalCalls * 100).toFixed(2) + '%' : '0%',
      averageDuration,
      callsByDirection: callsByDirection.reduce((acc, item) => {
        acc[item.direction || 'UNKNOWN'] = item._count.id
        return acc
      }, {} as Record<string, number>),
      callsByStatus: callsByStatus.reduce((acc, item) => {
        acc[item.status || 'UNKNOWN'] = item._count.id
        return acc
      }, {} as Record<string, number>)
    }

    console.log(`[ANALYTICS CALLS API] Analytics:`, analytics)

    return NextResponse.json({ analytics })

  } catch (error) {
    console.error('[ANALYTICS CALLS API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch call analytics' }, { status: 500 })
  }
} 