import { Router, Request, Response } from 'express'
import { authMiddleware, UserPayload } from './authMiddleware'
import { prisma } from '../services/db'
import { asyncHandler } from '../utils/asyncHandler'

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
router.get('/dashboard', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
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
}))

// Settings View
router.get('/settings', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }

    const business = await prisma.business.findUnique({ where: { id: req.user.businessId } })
    return res.render('settings', {
        title: 'Settings',
        businessName: business?.name || 'Your Business',
        config: business,
        user: req.user
    })
}))

// Lead Questions View
router.get('/lead-questions', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
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
}))

// Knowledge Base View
router.get('/knowledge-base', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
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
}))

// Leads Table View
router.get('/leads', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
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
}))

router.get('/notifications', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return res.redirect('/login')
    }
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
}))

export default router 