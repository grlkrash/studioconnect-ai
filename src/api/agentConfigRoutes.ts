import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// GET /api/agent-config – return current agent config for the authenticated business
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })

    const config = await prisma.agentConfig.findUnique({
      where: { businessId: req.user.businessId },
    })

    res.json({ config })
  } catch (error) {
    console.error('[AGENT CONFIG] fetch failed', error)
    res.status(500).json({ error: 'failed to fetch agent config' })
  }
})

// PUT /api/agent-config – create or update selected fields
router.put('/', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })

    const allowedFields = [
      'agentName',
      'welcomeMessage',
      'personaPrompt',
      'openaiVoice',
      'openaiModel',
      'useOpenaiTts',
      'voiceGreetingMessage',
      'voiceCompletionMessage',
      'voiceEmergencyMessage',
      'voiceEndCallMessage',
      'widgetTheme',
      'ttsProvider',
    ] as const

    const data: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in req.body) data[key] = req.body[key]
    }

    // Upsert ensures config exists
    const updated = await prisma.agentConfig.upsert({
      where: { businessId: req.user.businessId },
      create: {
        businessId: req.user.businessId,
        ...data,
      },
      update: data,
    })

    res.json({ success: true, config: updated })
  } catch (error) {
    console.error('[AGENT CONFIG] update failed', error)
    res.status(500).json({ error: 'failed to update agent config' })
  }
})

export default router 