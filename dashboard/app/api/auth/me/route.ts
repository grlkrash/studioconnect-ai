import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'

// GET /api/auth/me – returns { user, businessId }
export async function GET(request: NextRequest) {
  try {
    // Get business information
    const business = await getBusiness(request)
    
    if (!business) {
      console.warn('[Auth Me] Business not found for request')
      return NextResponse.json(
        { error: 'Business not found or authentication failed' },
        { status: 404 }
      )
    }

    // Return business info for auth context
    return NextResponse.json({
      businessId: business.id,
      businessName: business.name,
      authenticated: true,
      user: {
        id: business.id,
        name: business.name,
        email: business.email
      }
    })
  } catch (error) {
    console.error('[Auth Me] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 