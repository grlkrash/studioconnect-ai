import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(request: NextRequest) {
  try {
    const business = await getBusiness()
    
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    return NextResponse.json({ 
      businessId: business.id,
      businessName: business.name,
      planTier: business.planTier 
    })
  } catch (error) {
    console.error('Error fetching business:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 