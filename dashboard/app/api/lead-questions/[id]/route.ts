import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  try {
    const updates = await req.json()
    await prisma.leadCaptureQuestion.update({ where: { id }, data: updates })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[LEAD_QUESTION_PUT]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  try {
    await prisma.leadCaptureQuestion.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[LEAD_QUESTION_DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
} 