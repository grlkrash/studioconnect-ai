import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const url = new URL(req.url)
    const businessId = url.searchParams.get('businessId') || business.id

    // Get summary stats
    const [
      totalCalls,
      totalInteractions,
      totalClients,
      recentCalls,
      callsThisWeek,
      callsLastWeek
    ] = await Promise.all([
      // Total calls
      prisma.callLog.count({
        where: { businessId }
      }),

      // Total interactions 
      prisma.interaction.count({
        where: { businessId }
      }),

      // Total clients
      prisma.client.count({
        where: { businessId }
      }),

      // Recent calls (last 24h)
      prisma.callLog.count({
        where: {
          businessId,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      }),

      // Calls this week
      prisma.callLog.count({
        where: {
          businessId,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),

      // Calls last week (for comparison)
      prisma.callLog.count({
        where: {
          businessId,
          createdAt: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      })
    ])

    const weekOverWeekChange = callsLastWeek > 0 
      ? ((callsThisWeek - callsLastWeek) / callsLastWeek * 100).toFixed(1)
      : '0'

    const summary = {
      totalCalls,
      totalInteractions,
      totalClients,
      recentCalls,
      callsThisWeek,
      callsLastWeek,
      weekOverWeekChange: `${weekOverWeekChange}%`,
      weekOverWeekChangeValue: parseFloat(weekOverWeekChange)
    }

    return NextResponse.json(summary)

  } catch (error) {
    console.error('[ANALYTICS SUMMARY API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 })
  }
} 