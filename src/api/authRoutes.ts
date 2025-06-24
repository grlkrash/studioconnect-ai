import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../services/db'

const router = Router()

// Login endpoint
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    // Find user by email
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      include: { business: true }
    })

    if (!user || !user.business) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined')
      return res.status(500).json({ error: 'Server configuration error' })
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

    // Set secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax'
    })

    res.json({
      success: true,
      user: {
        userId: user.id,
        businessId: user.businessId,
        role: user.role,
        business: user.business
      }
    })
  } catch (error) {
    console.error('[AUTH API] Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Logout endpoint
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token')
  res.json({ success: true })
})

// Get current user info
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    res.json({
      userId: req.user.userId,
      businessId: req.user.businessId,
      role: req.user.role,
      business: req.user.business
    })
  } catch (error) {
    console.error('[AUTH API] Error getting user info:', error)
    res.status(500).json({ error: 'Failed to get user info' })
  }
})

export default router 