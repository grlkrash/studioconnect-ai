import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) return NextResponse.json([])

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

    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const entry = await prisma.knowledgeBase.create({
      data: { businessId: business.id, content, metadata },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    console.error('[KB_POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 