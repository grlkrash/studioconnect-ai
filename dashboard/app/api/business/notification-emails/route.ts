import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET() {
  const biz = await getBusiness()
  if (!biz) return NextResponse.json({ error: 'business_not_found' }, { status: 404 })

  const data = await prisma.business.findUnique({ where: { id: biz.id }, select: { notificationEmails: true } })
  return NextResponse.json({ notificationEmails: data?.notificationEmails || [] })
}

export async function PUT(req: Request) {
  const biz = await getBusiness()
  if (!biz) return NextResponse.json({ error: 'business_not_found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.emails)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  await prisma.business.update({ where: { id: biz.id }, data: { notificationEmails: body.emails as string[] } })
  return NextResponse.json({ success: true })
} 