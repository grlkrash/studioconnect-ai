import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// PUT /api/business/notification-emails – replace the list of notification emails
router.put('/notification-emails', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const { emails } = req.body as { emails?: string[] }

    if (!Array.isArray(emails)) {
      res.status(400).json({ error: 'emails must be an array of strings' })
      return
    }

    // Basic sanitization – trim and filter empty strings, dedupe
    const cleaned = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)))

    const updated = await prisma.business.update({
      where: { id: req.user.businessId },
      data: {
        notificationEmails: cleaned,
      },
      select: { id: true, notificationEmails: true },
    })

    res.json({ success: true, business: updated })
  } catch (error) {
    console.error('[BUSINESS ROUTES] Failed to update notification emails:', error)
    res.status(500).json({ error: 'failed to update notification emails' })
  }
})

// GET /api/business/notification-emails – return list for current business
router.get('/notification-emails', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })

    const biz = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { notificationEmails: true },
    })

    res.json({ notificationEmails: biz?.notificationEmails || [] })
  } catch (error) {
    console.error('[BUSINESS ROUTES] Failed to fetch notification emails:', error)
    res.status(500).json({ error: 'failed to fetch notification emails' })
  }
})

// PUT /api/business/notification-phone – set/update the notification phone number
router.put('/notification-phone', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })

    const { phoneNumber } = req.body as { phoneNumber?: string }
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' })

    const updated = await prisma.business.update({
      where: { id: req.user.businessId },
      data: { notificationPhoneNumber: phoneNumber.trim() },
      select: { id: true, notificationPhoneNumber: true },
    })

    res.json({ success: true, business: updated })
  } catch (err) {
    console.error('[BUSINESS ROUTES] Failed to update notification phone:', err)
    res.status(500).json({ error: 'failed to update notification phone' })
  }
})

// GET /api/business/notification-phone – fetch current value
router.get('/notification-phone', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    const biz = await prisma.business.findUnique({ where: { id: req.user.businessId }, select: { notificationPhoneNumber: true } })
    res.json({ notificationPhoneNumber: biz?.notificationPhoneNumber || null })
  } catch (err) {
    console.error('[BUSINESS ROUTES] Failed to fetch notification phone:', err)
    res.status(500).json({ error: 'failed to fetch notification phone' })
  }
})

export default router 