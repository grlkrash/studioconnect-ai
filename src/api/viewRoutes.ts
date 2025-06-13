import { Router, Request, Response } from 'express'
import { authMiddleware, UserPayload } from './authMiddleware'
import { prisma } from '../services/db'

const router = Router()

// Extend Express Request type
interface AuthRequest extends Request {
    user?: UserPayload
}

// Simple login page
router.get('/login', (req: Request, res: Response) => {
    if (req.cookies.token) {
        return res.redirect('/dashboard')
    }
    return res.render('login', { title: 'Login' })
})

// Simple logout action
router.get('/logout', (req: Request, res: Response) => {
    res.clearCookie('token')
    return res.redirect('/login')
})

// Dashboard View
router.get('/dashboard', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
    try {
        const business = await prisma.business.findUnique({
            where: { id: req.user.businessId }
        })

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

        return res.render('dashboard', {
            title: 'Dashboard',
            businessName: business?.name || 'Your Business',
            stats,
            user: req.user
        })
    } catch (error) {
        console.error('Dashboard error:', error)
        return res.status(500).send('Error loading dashboard')
    }
})

// Settings View
router.get('/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }

    try {
        const business = await prisma.business.findUnique({ where: { id: req.user.businessId } })
        return res.render('settings', {
            title: 'Settings',
            businessName: business?.name || 'Your Business',
            config: business,
            user: req.user
        })
    } catch (error) {
        console.error('Settings page error:', error)
        return res.status(500).send('Error loading settings')
    }
})

// Lead Questions View
router.get('/lead-questions', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
    try {
        const business = await prisma.business.findUnique({ where: { id: req.user.businessId } })
        const questions = await prisma.leadCaptureQuestion.findMany({
            where: { config: { businessId: req.user.businessId } },
            orderBy: { order: 'asc' }
        })
        return res.render('lead-questions', {
            title: 'Lead Questions',
            businessName: business?.name,
            questions,
            user: req.user
        })
    } catch (error) {
        console.error('Lead questions page error:', error)
        return res.status(500).send('Error loading lead questions')
    }
})

// Knowledge Base View
router.get('/knowledge-base', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
    try {
        const business = await prisma.business.findUnique({ where: { id: req.user.businessId } })
        const knowledgeBaseItems = await prisma.knowledgeBase.findMany({
            where: { businessId: req.user.businessId },
            orderBy: { createdAt: 'desc' }
        })
        return res.render('knowledge-base', {
            title: 'Knowledge Base',
            businessName: business?.name,
            items: knowledgeBaseItems,
            user: req.user
        })
    } catch (error) {
        console.error('Knowledge base page error:', error)
        return res.status(500).send('Error loading knowledge base')
    }
})

// Leads Table View
router.get('/leads', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
    try {
        const business = await prisma.business.findUnique({ where: { id: req.user.businessId } })
        const leads = await prisma.lead.findMany({
            where: { businessId: req.user.businessId },
            orderBy: { createdAt: 'desc' }
        })
        return res.render('leads', {
            title: 'Leads',
            businessName: business?.name,
            leads,
            user: req.user
        })
    } catch (error) {
        console.error('Leads page error:', error)
        return res.status(500).send('Error loading leads')
    }
})

router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
    try {
        const business = await prisma.business.findUnique({
            where: { id: req.user.businessId },
            select: {
                name: true,
                notificationEmail: true,
                notificationPhoneNumber: true
            }
        })

        if (!business) {
            return res.status(404).send('Business not found')
        }

        return res.render('notifications', {
            title: 'Notifications',
            businessName: business.name,
            settings: business,
            user: req.user
        })
    } catch (error) {
        console.error('Notifications page error:', error)
        return res.status(500).send('Error loading notification settings')
    }
})

export default router 