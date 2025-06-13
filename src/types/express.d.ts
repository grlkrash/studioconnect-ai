import { UserPayload } from '../api/authMiddleware'

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload
    }
  }
}

export {} 