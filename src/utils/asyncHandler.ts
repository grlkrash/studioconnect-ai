import { Request, Response, NextFunction, RequestHandler } from 'express'
import { UserPayload } from '../api/authMiddleware'
import { ParamsDictionary } from 'express-serve-static-core'
import { ParsedQs } from 'qs'

type AsyncRequestHandler<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = ParsedQs,
  Locals extends Record<string, any> = Record<string, any>
> = (
  req: Request<P, ResBody, ReqBody, ReqQuery, Locals> & { user?: UserPayload },
  res: Response<ResBody, Locals>,
  next: NextFunction
) => Promise<void | Response<ResBody, Locals>>

const asyncHandler = <
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = ParsedQs,
  Locals extends Record<string, any> = Record<string, any>
>(
  fn: AsyncRequestHandler<P, ResBody, ReqBody, ReqQuery, Locals>
): RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals> => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export default asyncHandler 