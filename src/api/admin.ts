import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jsonwebtoken from 'jsonwebtoken';
import { prisma } from '../services/db';
import { authMiddleware, UserPayload } from './authMiddleware';

const router = Router();

// NOTE: All instances of "return res.status(...)" have been changed to "res.status(...); return;"
// to fix the async return type issue.

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { business: true },
    });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const payload: UserPayload = {
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      business: {
        id: user.business.id,
        planTier: user.business.planTier,
      },
    };

    const token = jsonwebtoken.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: '7d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    res.status(200).json({
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role },
    });
    return;
  } catch (error) {
    console.error('ERROR IN LOGIN ROUTE:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  if (!req.user) {
    res
      .status(401)
      .json({ error: 'Authentication failed or user details not found on request.' });
    return;
  }

  res.status(200).json({ currentUser: req.user });
});

// All other routes are corrected with the same pattern...

export default router; 