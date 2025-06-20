import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

/**
 * Resolve the current Business row given multiple fallbacks so the app works
 * in multi-tenant as well as quick-start demo mode.
 *
 * Order of precedence (first match wins):
 * 1. Explicit `businessId` search param (?businessId=xxx) on the request URL
 * 2. `x-business-id` header
 * 3. JWT claim (sub or biz)
 * 4. Sub-domain segment (acme.studio-manager.app ⇒ acme)
 * 5. Cookie named `businessId`
 * 6. `DEFAULT_BUSINESS_ID` env var (gated to demo/dev)
 * 7. First Business row (demo fallback)
 */
export async function getBusiness(req?: NextRequest) {
  // 1. URL search param – only if we have the req object
  let bizId: string | undefined
  if (req) {
    const url = new URL(req.url)
    bizId = url.searchParams.get('businessId') || undefined
    // 2. custom header
    if (!bizId) bizId = req.headers.get('x-business-id') || undefined

    // 3. JWT claim – prefer explicit `biz` claim, fallback to `sub`
    if (!bizId) {
      const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined
      if (token) {
        const payload = decodeJwt(token)
        bizId = (payload?.biz as string) || (payload?.sub as string) || undefined
      }
    }

    // 4. Sub-domain lookup (e.g., acme.studio-manager.app)
    if (!bizId) {
      const hostname = url.hostname
      const parts = hostname.split('.')
      // Ignore bare domain like studio-manager.app; sub-domain must have at least 3 parts
      if (parts.length > 2) {
        const sub = parts[0]
        // Note: slug field doesn't exist in current schema, skip subdomain lookup for now
        // const found = await prisma.business.findFirst({ where: { slug: sub }, select: { id: true } })
        // if (found) bizId = found.id
      }
    }
  }

  // 5. cookie fallback (edge/server only)
  if (!bizId) {
    try {
      const cookieStore = await cookies()
      bizId = cookieStore.get('businessId')?.value
    } catch {}
  }

  // 6. env variable fallback (demo/dev only)
  if (!bizId && process.env.NODE_ENV === 'development') {
    bizId = process.env.DEFAULT_BUSINESS_ID
  }

  if (bizId) {
    const found = await prisma.business.findUnique({ 
      where: { id: bizId }, 
      select: { 
        id: true, 
        name: true, 
        planTier: true,
        businessType: true,
        notificationEmail: true,
        createdAt: true,
        updatedAt: true
      } 
    })
    if (found) return found
  }

  // 7. Last-ditch demo fallback – first row (only in demo env)
  // In single-tenant deployments we still want pages to load even if the business
  // identifier cannot be inferred from the request context. When there is **only
  // one** Business row in the database we will return that row as a sensible
  // default. This keeps production environments with a single business running
  // smoothly without extra query-string or cookie plumbing.

  try {
    const count = await prisma.business.count()
    if (count === 1) {
      return prisma.business.findFirst({ 
        select: { 
          id: true, 
          name: true, 
          planTier: true,
          businessType: true,
          notificationEmail: true,
          createdAt: true,
          updatedAt: true
        } 
      })
    }
  } catch {
    // ignore – fall through to null
  }

  // Retain the original behaviour for truly multi-tenant installations where
  // the business could not be determined.

  return null
}

// ----------------- Helpers ------------------

function decodeJwt(token: string) {
  try {
    const base64 = token.split('.')[1]
    const json = Buffer.from(base64, 'base64').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
} 