import { Router } from 'express'
import { prisma } from '../services/db'

const router = Router()

// Public endpoint: GET /api/widget-config/:businessId
router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params
    if (!businessId) return res.status(400).json({ error: 'missing id' })
    const cfg = await prisma.agentConfig.findUnique({
      where: { businessId },
      select: {
        widgetTheme: true,
      },
    })
    if (!cfg) return res.status(404).json({ error: 'not found' })
    res.json({ widgetTheme: cfg.widgetTheme || {} })
  } catch (err) {
    console.error('[WIDGET CONFIG] fetch failed', err)
    res.status(500).json({ error: 'failed' })
  }
})

export default router 