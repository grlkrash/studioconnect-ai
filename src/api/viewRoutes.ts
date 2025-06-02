import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { prisma } from '../services/db'

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
    
    // Fetch AgentConfig for this business
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })
    
    // Render the agent settings page
    res.render('agent-settings', {
      agentConfig: agentConfig || null,
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

export default router 