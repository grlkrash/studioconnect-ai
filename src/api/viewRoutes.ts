import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { prisma } from '../services/db'
import { requirePlan } from '../middleware/planMiddleware'

const router = Router()

// Routes will be added here in the next steps

// Login page route
router.get('/login', (req, res) => {
  res.render('login', { error: null })
})

// Protected dashboard route
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      // This should ideally be handled by authMiddleware redirecting for views
      // or a dedicated view auth middleware.
      return res.redirect('/admin/login');
    }

    // Fetch the full user details, AND INCLUDE the related business
    const userWithBusiness = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        business: true, // This line is key!
      },
    });

    if (!userWithBusiness) {
      console.error('Dashboard: User from token not found in DB:', req.user.userId);
      return res.redirect('/admin/login');
    }

    // Now userWithBusiness contains user details AND userWithBusiness.business has the business info
    res.render('dashboard', {
      user: userWithBusiness, // Pass the user object which now includes the business
    });

  } catch (error) {
    console.error("Error rendering dashboard:", error);
    return res.status(500).send("Error loading dashboard.");
  }
})

// Protected agent settings route
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    // authMiddleware ensures req.user exists, but TypeScript needs assurance
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    // Get businessId from authenticated user
    const businessId = req.user.businessId
    
    // Fetch Business for plan tier checking
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    })
    
    // Fetch AgentConfig for this business
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })
    
    // Render the agent settings page
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
router.get('/lead-questions', authMiddleware, async (req, res) => {
  try {
    // authMiddleware ensures req.user exists, but TypeScript needs assurance
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    // Get businessId from authenticated user
    const businessId = req.user.businessId
    
    // Fetch AgentConfig for this business
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })
    
    // Fetch all LeadCaptureQuestion records for this config
    const questions = agentConfig 
      ? await prisma.leadCaptureQuestion.findMany({ 
          where: { configId: agentConfig.id }, 
          orderBy: { order: 'asc' } 
        }) 
      : []
    
    // Render the lead questions page
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
router.get('/knowledge-base', authMiddleware, async (req, res) => {
  try {
    // authMiddleware ensures req.user exists, but TypeScript needs assurance
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    // Get businessId from authenticated user
    const businessId = req.user.businessId
    
    // Fetch all KnowledgeBase records for this business
    const knowledgeEntries = await prisma.knowledgeBase.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    // Render the knowledge base page
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
router.get('/leads', authMiddleware, async (req, res) => {
  try {
    // authMiddleware ensures req.user exists, but TypeScript needs assurance
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    // Get businessId from authenticated user
    const businessId = req.user.businessId
    
    // Fetch all Lead records for this business
    const leads = await prisma.lead.findMany({ 
      where: { businessId }, 
      orderBy: { createdAt: 'desc' } 
    })
    
    // Render the view leads page
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
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    // authMiddleware ensures req.user exists, but TypeScript needs assurance
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    // Get businessId from authenticated user
    const businessId = req.user.businessId
    
    // Fetch business notification settings
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
    
    // Render the notification settings page
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
router.get('/clients', authMiddleware, async (req, res) => {
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
router.get('/projects', authMiddleware, requirePlan('ENTERPRISE'), async (req, res) => {
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
        client: true, // Include related client
        tasks: true // Include related tasks
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
router.get('/integrations', authMiddleware, requirePlan('ENTERPRISE'), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).redirect('/admin/login')
    }
    
    const businessId = req.user.businessId
    
    // Fetch integration settings for this business
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