import { NextRequest, NextResponse } from 'next/server'
import { getDashboardCounts } from '@/lib/dashboard-stats'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get business ID from session/auth (for now, use first business)
    const businessId = undefined // Will use first business in getDashboardCounts
    
    const analytics = await getDashboardCounts(businessId)
    
    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Failed to fetch analytics summary:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
} 