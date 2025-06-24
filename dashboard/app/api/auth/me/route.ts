import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

interface UserPayload {
  userId: string
  businessId: string
  role: string
  business: {
    id: string
    planTier: string
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get('token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as UserPayload

    // Validate user exists and has associated business
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { business: true }
    })

    if (!user?.business) {
      return NextResponse.json({ error: 'User or business not found' }, { status: 401 })
    }

    return NextResponse.json({ 
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      businessName: user.business.name,
      planTier: user.business.planTier,
      business: {
        id: user.business.id,
        name: user.business.name,
        planTier: user.business.planTier
      }
    })
  } catch (error) {
    console.error('Auth verification error:', error)
    
    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 