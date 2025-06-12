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
export function isAuthenticatedRequest(req: Request): req is Request & { user: UserPayload } {
  return 'user' in req && req.user !== undefined;
}

// Authentication middleware
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as UserPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        business: true
      }
    });

    if (!user || !user.business) {
      res.status(401).json({ error: 'User or business not found' });
      return;
    }

    // Attach the complete user payload to the request
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
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized: No user found' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
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