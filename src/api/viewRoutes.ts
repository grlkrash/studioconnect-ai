import { Router, Response, Request } from 'express'
import { authMiddleware, isAuthenticatedRequest } from './authMiddleware'
import { prisma } from '../services/db'

const router = Router()

// Login page route
router.get('/login', (req: Request, res: Response) => {
  res.render('login', { error: null }); return;
})

// Protected dashboard route
router.get('/dashboard', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const userWithBusiness = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        business: true
      }
    })

    if (!userWithBusiness) {
      console.error('Dashboard: User from token not found in DB:', req.user.userId)
      res.redirect('/admin/login'); return
    }

    res.render('dashboard', {
      user: userWithBusiness
    }); return;
  } catch (error) {
    console.error("Error rendering dashboard:", error)
    res.status(500).json({ error: 'Failed to fetch dashboard data' }); return
  }
})

// Protected agent settings route
router.get('/settings', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    })
    
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })
    
    res.render('agent-settings', {
      agentConfig: agentConfig || null,
      business: business || null,
      user: req.user,
      successMessage: req.query.success
    }); return;
  } catch (error) {
    console.error('Error fetching agent config:', error)
    res.status(500).json({ error: 'Failed to fetch settings' }); return
  }
})

// Protected lead questions route
router.get('/lead-questions', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })
    
    const questions = agentConfig 
      ? await prisma.leadCaptureQuestion.findMany({ 
          where: { configId: agentConfig.id }, 
          orderBy: { order: 'asc' } 
        }) 
      : []
    
    res.render('lead-questions', { 
      questions, 
      user: req.user 
    }); return;
  } catch (error) {
    console.error('Error fetching lead questions:', error)
    res.status(500).json({ error: 'Failed to fetch lead questions' }); return
  }
})

// Protected knowledge base route
router.get('/knowledge-base', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const knowledgeEntries = await prisma.knowledgeBase.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    res.render('knowledge-base', { 
      knowledgeEntries, 
      user: req.user 
    }); return;
  } catch (error) {
    console.error('Error fetching knowledge base entries:', error)
    res.status(500).json({ error: 'Failed to fetch knowledge base' }); return
  }
})

// Protected leads route
router.get('/leads', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const leads = await prisma.lead.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    res.render('view-leads', { 
      leads, 
      user: req.user 
    }); return;
  } catch (error) {
    console.error('Error fetching leads:', error)
    res.status(500).json({ error: 'Failed to fetch leads' }); return
  }
})

// Protected notification settings route
router.get('/notifications', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        notificationEmail: true,
        notificationPhoneNumber: true,
        planTier: true
      }
    })
    
    if (!business) {
      res.status(404).render('error', {
        message: 'Business not found',
        user: req.user 
      }); return
    }
    
    res.render('notification-settings', { 
      business, 
      user: req.user,
      successMessage: req.query.success
    }); return;
  } catch (error) {
    console.error('Error fetching notification settings:', error)
    res.status(500).json({ error: 'Failed to fetch notifications' }); return
  }
})

// Protected clients route
router.get('/clients', authMiddleware, async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        clients: {
          orderBy: { createdAt: 'desc' },
          include: {
            projects: true
          }
        }
      }
    })
    
    if (!business) {
      res.status(404).render('error', {
        message: 'Business not found',
        user: req.user 
      }); return
    }
    
    res.render('clients', { 
      clients: business.clients, 
      user: req.user,
      successMessage: req.query.success
    }); return;
  } catch (error) {
    console.error('Error fetching clients:', error)
    res.status(500).json({ error: 'Failed to fetch clients' }); return
  }
})

// Protected projects route - Enterprise plan only
router.get('/projects', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const projects = await prisma.project.findMany({
      where: { businessId },
      include: {
        client: true,
        business: true
      }
    })
    
    res.json(projects); return;
  } catch (error) {
    console.error('Error fetching projects:', error)
    res.status(500).json({ error: 'Failed to fetch projects' }); return
  }
})

// Protected integrations route - Enterprise plan only
router.get('/integrations', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const businessId = req.user.businessId
    
    const integrations = await prisma.integration.findMany({
      where: { businessId },
      include: {
        business: true
      }
    })
    
    res.json(integrations); return;
  } catch (error) {
    console.error('Error fetching integrations:', error)
    res.status(500).json({ error: 'Failed to fetch integrations' }); return
  }
})

export default router 