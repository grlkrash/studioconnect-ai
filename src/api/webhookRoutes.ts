import express, { Request, Response } from 'express'
import prisma from '../services/db'
import { asanaProvider } from '../services/pm-providers/asana.provider'
import { JiraProvider } from '../services/pm-providers/jira.provider'
import { MondayProvider } from '../services/pm-providers/monday.provider'

const jiraProvider = new JiraProvider()
const mondayProvider = new MondayProvider()

const router = express.Router()

// We need raw body for signature verification, so use express.raw middleware
router.post('/pm/:provider', express.raw({ type: '*/*', limit: '10mb' }), async (req: Request, res: Response) => {
  const providerParam = req.params.provider?.toLowerCase()
  try {
    switch (providerParam) {
      case 'asana': {
        await asanaProvider.handleWebhook({
          rawBody: req.body as Buffer,
          headers: req.headers as any,
          query: req.query as any,
        })
        return res.status(200).send('OK')
      }
      case 'jira': {
        const token = typeof req.query.token === 'string' ? req.query.token : undefined
        if (!token) return res.status(400).json({ error: 'Missing token' })
        const integ = await prisma.integration.findFirst({ where: { provider: 'JIRA', webhookSecret: token } })
        if (!integ) return res.status(401).json({ error: 'Invalid token' })
        // Jira sends JSON payload
        const payload = JSON.parse(req.body.toString())
        await jiraProvider.handleWebhook(payload, integ.businessId)
        return res.status(200).send('OK')
      }
      case 'monday': {
        const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined
        if (!businessId) return res.status(400).json({ error: 'Missing businessId query param' })
        // Monday may send challenge handshake or event; pass raw JSON
        let payload: any
        try { payload = JSON.parse(req.body.toString()) } catch { payload = {} }
        // Handle URL verification challenge
        if (payload.challenge) {
          return res.json({ challenge: payload.challenge })
        }
        await mondayProvider.handleWebhook(payload, businessId)
        return res.status(200).send('OK')
      }
      default:
        return res.status(404).json({ error: 'Unknown provider' })
    }
  } catch (err: any) {
    console.error('[webhookRoutes] Error handling webhook:', err)
    return res.status(500).json({ error: 'Failed to process webhook' })
  }
})

export default router 