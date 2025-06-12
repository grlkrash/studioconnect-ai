// src/api/authMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../services/db';
import { PlanTier } from '@prisma/client';

// Define the UserPayload type for the JWT token
export interface UserPayload {
  userId: string;
  businessId: string;
  role: string;
  business: {
    planTier: PlanTier;
  };
}

// Extend the Express Request interface to include our user payload
export interface AuthenticatedRequest extends Request {
  user: UserPayload;
}

// Authentication middleware
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as UserPayload;

    // Fetch fresh user data to ensure planTier is current
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        business: {
          select: {
            id: true,
            planTier: true
          }
        }
      }
    });

    if (!user || !user.business) {
      return res.status(401).json({ error: 'Unauthorized: User or business not found' });
    }

    // Attach the complete user payload to the request
    (req as AuthenticatedRequest).user = {
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      business: {
        planTier: user.business.planTier
      }
    };

    next();
  } catch (error) {
    console.error('JWT Verification Error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'Unauthorized: No user found' });
    }

    if (!roles.includes(authReq.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
}; 