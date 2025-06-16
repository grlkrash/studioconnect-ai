import { Router, Request, Response } from 'express'
import { authMiddleware } from './authMiddleware'
import { integrationService } from '../services/integrationService'

const router = Router()

// Connect / update credentials for a provider
router.post('/:provider/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider
    const credentials = req.body || {}
    if (!provider) return res.status(400).json({ error: 'Provider is required in path.' })
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    await integrationService.connectProvider(req.user.businessId, provider, credentials)
    res.json({ status: 'connected' })
  } catch (err: any) {
    console.error('[integrationRoutes] connect error:', err)
    res.status(400).json({ error: err.message || 'Failed to connect provider' })
  }
})

// Disconnect provider
router.delete('/:provider', authMiddleware, async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider
    if (!provider) return res.status(400).json({ error: 'Provider is required in path.' })
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    await integrationService.disconnectProvider(req.user.businessId, provider)
    res.json({ status: 'disconnected' })
  } catch (err: any) {
    console.error('[integrationRoutes] disconnect error:', err)
    res.status(400).json({ error: err.message || 'Failed to disconnect provider' })
  }
})

// Get status of all integrations
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const data = await integrationService.getIntegrationStatus(req.user.businessId)
    res.json({ integrations: data })
  } catch (err: any) {
    console.error('[integrationRoutes] status error:', err)
    res.status(500).json({ error: 'Failed to fetch integrations' })
  }
})

export default router 