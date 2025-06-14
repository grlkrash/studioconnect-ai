// src/api/authMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../services/db';
import { PlanTier, UserRole } from '@prisma/client';

// Define the UserPayload type for the JWT token
export interface UserPayload {
  userId: string;
  businessId: string;
  role: UserRole;
  business: {
    id: string;
    planTier: PlanTier;
  };
}

// Extend the Express Request interface to include our user payload
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

// Export the AuthenticatedRequest interface
export interface AuthenticatedRequest extends Request {
  user: UserPayload;
}

// Type guard to check if a request is authenticated
export function isAuthenticatedRequest(req: Request): req is AuthenticatedRequest {
  return 'user' in req && req.user !== undefined;
}

// Authentication middleware
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Prefer Authorization header ("Bearer <token>") but fall back to signed cookie
    const authHeader = req.headers.authorization;

    // Attempt to extract token from "Authorization" header (if it exists and is correctly formatted)
    let token: string | undefined = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : undefined;

    // Fallback to JWT stored in an httpOnly cookie named "token"
    if (!token && req.cookies?.token) {
      token = req.cookies.token as string;
    }

    // If we still don't have a token, block the request
    if (!token) {
      if (req.originalUrl.startsWith('/api')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      res.redirect('/admin/login');
      return;
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as UserPayload;

    // Validate user exists and has associated business
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { business: true }
    });

    if (!user?.business) {
      res.status(401).json({ error: 'User or business not found' });
      return;
    }

    // Attach validated user payload
    req.user = {
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      business: {
        id: user.business.id,
        planTier: user.business.planTier
      }
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    if (req.originalUrl.startsWith('/api')) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    res.redirect('/admin/login');
    return;
  }
};

// Export requireAuth as an alias for authMiddleware
export const requireAuth = authMiddleware;

// Role-based authorization middleware
export const requireRole = (roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

// Plan tier validation middleware
export const requirePlan = (requiredTier: PlanTier) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userPlanTier = req.user.business.planTier;
    if (userPlanTier !== requiredTier && userPlanTier !== PlanTier.ENTERPRISE) {
      res.status(403).json({ error: 'Upgrade required' });
      return;
    }

    next();
  };
};

// Export a type-safe middleware chain helper
export const chainMiddleware = <T extends Request>(
  ...middlewares: Array<(req: T, res: Response, next: NextFunction) => void>
) => {
  return (req: T, res: Response, next: NextFunction) => {
    let index = 0;

    const runMiddleware = () => {
      if (index >= middlewares.length) {
        next();
        return;
      }

      const middleware = middlewares[index];
      index++;

      middleware(req, res, (err?: any) => {
        if (err) {
          next(err);
          return;
        }
        runMiddleware();
      });
    };

    runMiddleware();
  };
}; 