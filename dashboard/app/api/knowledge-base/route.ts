import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    // Ensure a Business record exists so that the dashboard works out-of-the-box
    let business = await prisma.business.findFirst({ select: { id: true } })
    if (!business) {
      business = await prisma.business.create({ data: { name: 'Demo Business' }, select: { id: true } })
    }

    const kb = await prisma.knowledgeBase.findMany({
      where: { businessId: business.id },
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json(kb)
  } catch (err) {
    console.error('[KB_GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { content, metadata } = body
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })

    // Ensure a Business record exists so that the dashboard works out-of-the-box
    let business = await prisma.business.findFirst({ select: { id: true } })
    if (!business) {
      business = await prisma.business.create({ data: { name: 'Demo Business' }, select: { id: true } })
    }

    const entry = await prisma.knowledgeBase.create({
      data: { businessId: business.id, content, metadata },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    console.error('[KB_POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 