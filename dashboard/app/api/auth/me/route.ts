import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'
import { prisma } from '@/lib/prisma'

// GET /api/auth/me – returns { user, businessId }
export async function GET(request: NextRequest) {
  try {
    console.log('[Auth Me] Processing request...')
    
    // Get business information
    let business = await getBusiness(request)
    
    // If no business found through getBusiness, try to get the first business as fallback
    if (!business) {
      console.log('[Auth Me] No business found via getBusiness, trying fallback...')
      
      const firstBusiness = await prisma.business.findFirst({
        select: { 
          id: true, 
          name: true, 
          notificationEmail: true,
          planTier: true 
        }
      })
      
      if (firstBusiness) {
        business = firstBusiness
        console.log('[Auth Me] Using fallback business:', firstBusiness.name)
      }
    }
    
    if (!business) {
      console.warn('[Auth Me] No business found - database might be empty')
      return NextResponse.json(
        { 
          error: 'No business found. Please ensure your database is seeded with at least one business record.',
          requiresSetup: true 
        },
        { status: 404 }
      )
    }

    console.log('[Auth Me] Successfully found business:', business.id)
    
    // Return business info for auth context
    return NextResponse.json({
      businessId: business.id,
      businessName: business.name || 'StudioConnect AI',
      authenticated: true,
      user: {
        id: business.id,
        name: business.name || 'StudioConnect AI',
        email: business.notificationEmail || 'admin@studioconnect.ai'
      }
    })
  } catch (error) {
    console.error('[Auth Me] Error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
} 