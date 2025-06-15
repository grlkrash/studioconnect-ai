import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  try {
    const { content, metadata } = await req.json()
    await prisma.knowledgeBase.update({ where: { id }, data: { content, metadata } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[KB_PUT]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  try {
    await prisma.knowledgeBase.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[KB_DELETE]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
} 