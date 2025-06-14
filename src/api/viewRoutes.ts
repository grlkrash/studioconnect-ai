import { Router, Request, Response } from 'express';
import { authMiddleware } from './authMiddleware';
import { prisma } from '../services/db';

const router = Router();

router.get('/login', (req: Request, res: Response) => {
  res.render('login', { error: null });
});

router.get('/dashboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.redirect('/admin/login');
      return;
    }
    const userWithBusiness = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { business: true },
    });
    if (!userWithBusiness) {
      res.redirect('/admin/login');
      return;
    }
    res.render('dashboard', { user: userWithBusiness });
    return;
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    res.status(500).send('Error loading dashboard.');
  }
});

// Agent Settings
router.get('/settings', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  res.render('agent-settings', { businessId: req.user.businessId })
})

// Lead Questions
router.get('/lead-questions', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  res.render('lead-questions', { businessId: req.user.businessId })
})

// Knowledge Base
router.get('/knowledge-base', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  res.render('knowledge-base', { businessId: req.user.businessId })
})

// Notification Settings
router.get('/notifications', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  res.render('notification-settings', { businessId: req.user.businessId })
})

// View Leads
router.get('/leads', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  const leads = await prisma.lead.findMany({ where: { businessId: req.user.businessId }, include: { assignedTo: true } })
  res.render('view-leads', { leads })
})

// Clients list page
router.get('/clients', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  const clients = await prisma.client.findMany({ where: { businessId: req.user.businessId }, include: { projects: true } })
  res.render('clients', { clients })
})

// Projects list page
router.get('/projects', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  const projects = await prisma.project.findMany({ where: { businessId: req.user.businessId }, include: { client: true } })
  res.render('projects', { projects })
})

// Integrations page
router.get('/integrations', authMiddleware, (req: Request, res: Response) => {
  if (!req.user) return res.redirect('/admin/login')
  res.render('integrations')
})

// Widget demo page (optional)
router.get('/widget-demo', (req: Request, res: Response) => {
  res.render('widget')
})

// All other view routes corrected similarly...

export default router; 