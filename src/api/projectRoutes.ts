import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// GET /api/projects – list all projects for the business
router.get('/', authMiddleware, async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { businessId: req.user!.businessId },
      include: {
        client: {
          select: { id: true, name: true, email: true, phone: true }
        },
        knowledgeBaseEntries: {
          select: { id: true, content: true, createdAt: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json(projects)
  } catch (error) {
    console.error('[PROJECT ROUTES] Failed to fetch projects:', error)
    res.status(500).json({ error: 'failed to fetch projects' })
  }
})

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