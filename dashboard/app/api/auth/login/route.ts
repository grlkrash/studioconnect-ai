import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Find user by email
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      include: { business: true }
    })

    if (!user || !user.business) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash)
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const token = jwt.sign(
      {
        userId: user.id,
        businessId: user.businessId,
        role: user.role,
        business: {
          id: user.business.id,
          planTier: user.business.planTier
        }
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    // Create response with user data
    const response = NextResponse.json({
      success: true,
      user: {
        userId: user.id,
        businessId: user.businessId,
        role: user.role,
        business: user.business
      }
    })

    // Set secure cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
      path: '/'  // Important: set path to root so it's accessible across the app
    })

    return response
  } catch (error) {
    console.error('[Dashboard API] Login error:', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
} 