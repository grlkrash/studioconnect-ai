import { Request, Response, NextFunction } from 'express'

// Defines a type for an asynchronous Express request handler
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>

/**
 * Wraps an asynchronous Express.js route handler to catch errors
 * and pass them to the next middleware.
 * This prevents the need for try-catch blocks in every async handler.
 * @param fn The asynchronous request handler function.
 * @returns A standard Express.js request handler.
 */
export const asyncHandler = (fn: AsyncRequestHandler) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  } 