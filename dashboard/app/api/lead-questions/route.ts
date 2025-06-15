import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

// GET /api/lead-questions
// Returns all lead-capture questions for the first business in the DB. This
// is a simplified implementation to make the dashboard functional until we
// have auth + multi-tenant context wired up.
export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ questions: [] })

    const config = await prisma.agentConfig.findUnique({
      where: { businessId: business.id },
      select: { id: true },
    })

    if (!config) return NextResponse.json({ questions: [] })

    const questions = await prisma.leadCaptureQuestion.findMany({
      where: { configId: config.id },
      orderBy: { order: 'asc' },
    })

    return NextResponse.json({ questions })
  } catch (err) {
    console.error('[LEAD_QUESTIONS_GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST /api/lead-questions
// Creates a new lead-capture question. Expects { questionText, expectedFormat,
// isRequired } in the request body.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { questionText, expectedFormat = 'TEXT', isRequired = true } = body

    if (!questionText) {
      return NextResponse.json({ error: 'questionText is required' }, { status: 400 })
    }

    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    // Ensure an AgentConfig exists for the business
    const config = await prisma.agentConfig.upsert({
      where: { businessId: business.id },
      update: {},
      create: { businessId: business.id },
    })

    const maxOrder = await prisma.leadCaptureQuestion.aggregate({
      where: { configId: config.id },
      _max: { order: true },
    })

    const question = await prisma.leadCaptureQuestion.create({
      data: {
        configId: config.id,
        questionText,
        expectedFormat,
        isRequired,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    })

    return NextResponse.json({ question }, { status: 201 })
  } catch (err) {
    console.error('[LEAD_QUESTION_POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
} 