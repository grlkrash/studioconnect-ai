import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'

// GET /api/auth/me – returns { user, businessId }
export async function GET(request: NextRequest) {
  try {
    // Get business information
    const business = await getBusiness(request)
    
    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      )
    }

    // Return basic business info for auth context
    return NextResponse.json({
      businessId: business.id,
      authenticated: true
    })
  } catch (error) {
    console.error('[Auth Me] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 