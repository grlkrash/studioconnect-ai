import { Router } from 'express'
import { requireAuth, AuthenticatedRequest } from './authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { prisma } from '../services/db'

const router = Router()

// Routes will be added here in the next steps

// Login page route
router.get('/login', (req, res) => {
  res.render('login', { error: null })
})

// Protected dashboard route
router.get('/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userWithBusiness = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        business: true
      }
    })

    if (!userWithBusiness) {
      console.error('Dashboard: User from token not found in DB:', req.user.userId)
      return res.redirect('/admin/login')
    }

    res.render('dashboard', {
      user: userWithBusiness
    })
  } catch (error) {
    console.error("Error rendering dashboard:", error)
    return res.status(500).send("Error loading dashboard.")
  }
})

// Protected agent settings route
router.get('/settings', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const businessId = req.user.businessId
    
    const [business, agentConfig] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId }
      }),
      prisma.agentConfig.findUnique({
        where: { businessId }
      })
    ])
    
    res.render('agent-settings', {
      agentConfig: agentConfig || null,
      business: business || null,
      user: req.user,
      successMessage: req.query.success
    })
  } catch (error) {
    console.error('Error fetching agent config:', error)
    res.status(500).render('error', { 
      message: 'Failed to load agent settings',
      user: req.user 
    })
  }
})

// Protected lead questions route
router.get('/lead-questions', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
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
    })
  } catch (error) {
    console.error('Error fetching lead questions:', error)
    res.status(500).render('error', { 
      message: 'Failed to load lead questions',
      user: req.user 
    })
  }
})

// Protected knowledge base route
router.get('/knowledge-base', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const knowledgeEntries = await prisma.knowledgeBase.findMany({ 
      where: { businessId: req.user.businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    res.render('knowledge-base', { 
      knowledgeEntries, 
      user: req.user 
    })
  } catch (error) {
    console.error('Error fetching knowledge base entries:', error)
    res.status(500).render('error', { 
      message: 'Failed to load knowledge base',
      user: req.user 
    })
  }
})

// Protected leads route
router.get('/leads', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const leads = await prisma.lead.findMany({ 
      where: { businessId: req.user.businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    res.render('view-leads', { 
      leads, 
      user: req.user 
    })
  } catch (error) {
    console.error('Error fetching leads:', error)
    res.status(500).render('error', { 
      message: 'Failed to load leads',
      user: req.user 
    })
  }
})

// Protected notification settings route
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
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
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('notification-settings', { 
      business, 
      user: req.user,
      successMessage: req.query.success
    })
  } catch (error) {
    console.error('Error fetching notification settings:', error)
    res.status(500).render('error', { 
      message: 'Failed to load notification settings',
      user: req.user 
    })
  }
})

// Protected clients route
router.get('/clients', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    const businessId = req.user.businessId
    
    // Fetch all clients for this business
    const clients = await prisma.client.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' },
      include: {
        projects: true // Include related projects
      }
    })
    
    res.render('clients', { 
      clients, 
      user: req.user,
      successMessage: req.query.success
    })
  } catch (error) {
    console.error('Error fetching clients:', error)
    res.status(500).render('error', { 
      message: 'Failed to load clients',
      user: req.user 
    })
  }
})

// Protected projects route - Enterprise plan only
router.get('/projects', requireAuth, requirePlan('ENTERPRISE'), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    const businessId = req.user.businessId
    
    // Fetch all projects for this business
    const projects = await prisma.project.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' },
      include: {
        client: true // Include related client
      }
    })
    
    res.render('projects', { 
      projects, 
      user: req.user,
      successMessage: req.query.success
    })
  } catch (error) {
    console.error('Error fetching projects:', error)
    res.status(500).render('error', { 
      message: 'Failed to load projects',
      user: req.user 
    })
  }
})

// Protected integrations route - Enterprise plan only
router.get('/integrations', requireAuth, requirePlan('ENTERPRISE'), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    const businessId = req.user.businessId
    
    const integrations = await prisma.integration.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' }
    })
    
    res.render('integrations', { 
      integrations, 
      user: req.user,
      successMessage: req.query.success
    })
  } catch (error) {
    console.error('Error fetching integrations:', error)
    res.status(500).render('error', { 
      message: 'Failed to load integrations',
      user: req.user 
    })
  }
})

export default router 