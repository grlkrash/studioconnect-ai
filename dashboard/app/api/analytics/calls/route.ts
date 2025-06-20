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

    // Get basic call stats
    const [
      totalCalls,
      completedCalls,
      failedCalls,
      todayStart
    ] = await Promise.all([
      prisma.callLog.count({
        where: { businessId: business.id, ...dateFilter }
      }),
      prisma.callLog.count({
        where: { businessId: business.id, status: 'COMPLETED', ...dateFilter }
      }),
      prisma.callLog.count({
        where: { 
          businessId: business.id, 
          status: { in: ['FAILED', 'NO_ANSWER', 'BUSY'] },
          ...dateFilter
        }
      }),
      new Date(new Date().setHours(0, 0, 0, 0))
    ])

    // Calls today
    const todayCalls = await prisma.callLog.count({
      where: { 
        businessId: business.id,
        createdAt: { gte: todayStart }
      }
    })

    // Get sample calls for duration calculation
    const callsWithDuration = await prisma.callLog.findMany({
      where: { 
        businessId: business.id,
        status: 'COMPLETED',
        ...dateFilter
      },
      select: { metadata: true },
      take: 100
    })

    // Calculate average duration
    const durations = callsWithDuration
      .map(call => (call.metadata as any)?.duration || 0)
      .filter(duration => duration > 0)
    
    const averageDuration = durations.length > 0 
      ? Math.round(durations.reduce((sum, dur) => sum + dur, 0) / durations.length)
      : 0

    // Calculate success rate
    const successRate = totalCalls > 0 
      ? Math.round((completedCalls / totalCalls) * 100)
      : 0

    // Get escalated calls
    const escalatedCalls = await prisma.callLog.count({
      where: {
        businessId: business.id,
        ...dateFilter,
        metadata: {
          path: ['escalated'],
          equals: true
        }
      }
    })

    const escalationRate = totalCalls > 0 
      ? Math.round((escalatedCalls / totalCalls) * 100)
      : 0

    // Mock data for topics and hourly distribution (can be enhanced later)
    const topTopics = [
      { topic: 'General Inquiry', count: Math.floor(totalCalls * 0.4) },
      { topic: 'Support Request', count: Math.floor(totalCalls * 0.3) },
      { topic: 'Appointment', count: Math.floor(totalCalls * 0.2) },
      { topic: 'Information', count: Math.floor(totalCalls * 0.1) }
    ]

    const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: Math.floor(Math.random() * (totalCalls / 24))
    }))

    const analytics = {
      totalCalls,
      completedCalls,
      failedCalls,
      averageDuration,
      successRate,
      todayCalls,
      escalationRate,
      averageSentiment: 0.7, // Mock neutral-positive sentiment
      topTopics,
      hourlyDistribution
    }

    console.log(`[ANALYTICS CALLS API] Returning analytics:`, analytics)

    return NextResponse.json({ analytics })
  } catch (err) {
    console.error('[ANALYTICS CALLS API] Error:', err)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error',
      analytics: null
    }, { status: 500 })
  }
} 