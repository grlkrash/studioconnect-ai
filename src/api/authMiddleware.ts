// src/api/authMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Define a type for the user payload stored in the JWT
export interface UserPayload {
  userId: string;
  businessId: string;
  role: string;
}

// Extend the Express Request interface to include our user payload
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.token; // Assuming the JWT is stored in an HTTP-only cookie named 'token'

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as UserPayload;
    req.user = decoded; // Attach the decoded user payload to the request object
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    console.error('JWT Verification Error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}; 