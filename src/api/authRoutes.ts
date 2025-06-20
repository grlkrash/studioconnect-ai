import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { Request, Response } from 'express'

const router = Router()

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