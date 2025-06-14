import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// POST /api/projects – create a new project
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, clientId, status = 'active', details } = req.body

    if (!name || !clientId) {
      res.status(400).json({ error: 'name and clientId are required' })
      return
    }

    const project = await prisma.project.create({
      data: {
        name,
        status,
        details,
        clientId,
        businessId: req.user!.businessId
      }
    })

    res.status(201).json(project)
  } catch (error) {
    console.error('[PROJECT ROUTES] Failed to create project:', error)
    res.status(500).json({ error: 'failed to create project' })
  }
})

export default router 