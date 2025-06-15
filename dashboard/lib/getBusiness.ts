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
 * 3. Cookie named `businessId`
 * 4. `DEFAULT_BUSINESS_ID` env variable (server only)
 * 5. First Business row (demo fallback)
 */
export async function getBusiness(req?: NextRequest) {
  // 1. URL search param – only if we have the req object
  let bizId: string | undefined
  if (req) {
    const url = new URL(req.url)
    bizId = url.searchParams.get('businessId') || undefined
    // 2. custom header
    if (!bizId) bizId = req.headers.get('x-business-id') || undefined
  }

  // 3. cookie fallback (edge/server only)
  if (!bizId) {
    try {
      const cookieStore = cookies()
      bizId = cookieStore.get('businessId')?.value
    } catch {}
  }

  // 4. env variable fallback (useful for single-tenant deployments)
  if (!bizId) bizId = process.env.DEFAULT_BUSINESS_ID

  if (bizId) {
    const found = await prisma.business.findUnique({ where: { id: bizId }, select: { id: true } })
    if (found) return found
  }

  // 5. Last-ditch demo fallback – first row
  return prisma.business.findFirst({ select: { id: true } })
} 