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
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        agentConfig: true,
        leads: { 
          orderBy: { createdAt: 'desc' },
          take: 5
        },
        conversations: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            callLogs: true
          }
        }
      }
    })

    if (!business) {
      console.error('Dashboard: Business not found:', req.user.businessId)
      return res.redirect('/admin/login')
    }

    res.render('dashboard', {
      user: req.user,
      business,
      agentConfig: business.agentConfig
    })
  } catch (error) {
    console.error("Error rendering dashboard:", error)
    return res.status(500).send("Error loading dashboard.")
  }
})

// Protected agent settings route
router.get('/settings', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        agentConfig: {
          include: {
            questions: true
          }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('agent-settings', {
      agentConfig: business.agentConfig,
      business,
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
router.get('/lead-questions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        agentConfig: {
          include: {
            questions: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('lead-questions', { 
      questions: business.agentConfig?.questions || [], 
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
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        knowledgeBase: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('knowledge-base', { 
      knowledgeEntries: business.knowledgeBase, 
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
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        leads: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('view-leads', { 
      leads: business.leads, 
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
router.get('/notifications', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
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
router.get('/clients', requireAuth, async (req: AuthenticatedRequest, res) => {
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
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('clients', { 
      clients: business.clients, 
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
router.get('/projects', requireAuth, requirePlan('ENTERPRISE'), async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        projects: {
          orderBy: { createdAt: 'desc' },
          include: {
            client: true
          }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('projects', { 
      projects: business.projects, 
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
router.get('/integrations', requireAuth, requirePlan('ENTERPRISE'), async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        integrations: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    
    if (!business) {
      return res.status(404).render('error', { 
        message: 'Business not found',
        user: req.user 
      })
    }
    
    res.render('integrations', { 
      integrations: business.integrations, 
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