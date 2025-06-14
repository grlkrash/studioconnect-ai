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

// All other view routes corrected similarly...

export default router; 