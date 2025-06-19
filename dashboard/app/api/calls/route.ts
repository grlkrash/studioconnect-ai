import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ calls: [] })

    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const calls = await prisma.callLog.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        conversation: {
          include: {
            client: {
              select: { name: true }
            }
          }
        }
      }
    })

    // Transform the data to match the expected format
    const transformedCalls = calls.map(call => ({
      id: call.id,
      callSid: call.callSid,
      from: call.from,
      to: call.to,
      direction: call.direction,
      status: call.status,
      type: call.type,
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
      content: call.content,
      metadata: call.metadata,
      conversation: call.conversation ? {
        id: call.conversation.id,
        messages: Array.isArray(call.conversation.messages) ? call.conversation.messages : [],
        client: call.conversation.client
      } : null
    }))

    return NextResponse.json({ calls: transformedCalls })
  } catch (err) {
    console.error('[CALLS_GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 