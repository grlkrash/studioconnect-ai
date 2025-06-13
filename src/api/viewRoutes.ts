import { Router, Request, Response } from 'express'
import { authMiddleware, UserPayload } from './authMiddleware'
import { prisma } from '../services/db'

const router = Router()

// Extend Express Request type
interface AuthRequest extends Request {
    user?: UserPayload
}

// Login page route
router.get('/login', (req: Request, res: Response) => {
    if (req.cookies.token) {
        return res.redirect('/dashboard')
    }
    res.render('login', { error: null })
})

// Protected dashboard route
router.get('/dashboard', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

        const userWithBusiness = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: {
                business: true
            }
        })

        if (!userWithBusiness) {
            console.error('Dashboard: User from token not found in DB:', req.user.userId)
            return res.redirect('/login')
        }

        const leadStats = await prisma.lead.groupBy({
            by: ['status'],
            where: { businessId: req.user.businessId },
            _count: {
                status: true
            }
        })

        const stats = {
            NEW: leadStats.find(s => s.status === 'NEW')?._count.status || 0,
            CONTACTED: leadStats.find(s => s.status === 'CONTACTED')?._count.status || 0,
            CLOSED: leadStats.find(s => s.status === 'CLOSED')?._count.status || 0
        }

        res.render('dashboard', {
            user: userWithBusiness,
            stats,
            businessName: userWithBusiness.business?.name || 'Your Business'
        })

    } catch (error) {
        console.error("Error rendering dashboard:", error)
        res.status(500).render('error', { 
            message: 'Error loading dashboard',
            user: req.user 
        })
    }
})

// Protected agent settings route
router.get('/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

        const business = await prisma.business.findUnique({
            where: { id: req.user.businessId }
        })

        const agentConfig = await prisma.agentConfig.findUnique({
            where: { businessId: req.user.businessId }
        })

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
router.get('/lead-questions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

        const agentConfig = await prisma.agentConfig.findUnique({
            where: { businessId: req.user.businessId }
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
router.get('/knowledge-base', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

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
router.get('/leads', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

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
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.redirect('/login')
        }

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

export default router 