import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// GET all questions ordered
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    const questions = await prisma.leadCaptureQuestion.findMany({
      where: { config: { businessId: req.user.businessId } },
      orderBy: { order: 'asc' },
    })
    res.json({ questions })
  } catch (err) {
    console.error('[LEAD Q] list', err)
    res.status(500).json({ error: 'failed to fetch questions' })
  }
})

// POST create new question (appends to end)
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })

    let config = await prisma.agentConfig.findUnique({ where: { businessId: req.user.businessId } })
    if (!config) {
      // Create minimal config to support lead questions
      config = await prisma.agentConfig.create({ data: { businessId: req.user.businessId } })
    }

    const { questionText, expectedFormat, isRequired = true, mapsToLeadField, isEssentialForEmergency } = req.body
    if (!questionText) return res.status(400).json({ error: 'questionText required' })

    const last = await prisma.leadCaptureQuestion.findFirst({
      where: { configId: config.id },
      orderBy: { order: 'desc' },
    })
    const nextOrder = (last?.order || 0) + 1

    const q = await prisma.leadCaptureQuestion.create({
      data: {
        configId: config.id,
        questionText,
        expectedFormat: expectedFormat || 'TEXT',
        order: nextOrder,
        isRequired,
        mapsToLeadField,
        isEssentialForEmergency,
      },
    })
    res.status(201).json(q)
  } catch (err) {
    console.error('[LEAD Q] create', err)
    res.status(500).json({ error: 'failed to create question' })
  }
})

// PUT update
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const data = req.body
    const updated = await prisma.leadCaptureQuestion.update({ where: { id }, data })
    res.json(updated)
  } catch (err) {
    console.error('[LEAD Q] update', err)
    res.status(500).json({ error: 'failed to update question' })
  }
})

// DELETE
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    await prisma.leadCaptureQuestion.delete({ where: { id } })
    res.status(204).end()
  } catch (err) {
    console.error('[LEAD Q] delete', err)
    res.status(500).json({ error: 'failed to delete question' })
  }
})

export default router 