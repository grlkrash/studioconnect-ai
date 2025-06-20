import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    console.log('[CALLS API] Processing request...')
    
    const business = await getBusiness(req)
    if (!business) {
      console.log('[CALLS API] No business found')
      return NextResponse.json({ calls: [] })
    }

    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')
    const direction = url.searchParams.get('direction')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    console.log(`[CALLS API] Fetching calls for business: ${business.id}, limit: ${limit}, offset: ${offset}`)

    // Build where clause
    const where: any = { businessId: business.id }
    
    if (status && status !== 'all') {
      where.status = status
    }
    
    if (direction && direction !== 'all') {
      where.direction = direction
    }
    
    if (search) {
      where.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { to: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (from) {
      where.createdAt = { gte: new Date(from) }
    }
    
    if (to) {
      if (where.createdAt) {
        where.createdAt.lte = new Date(to)
      } else {
        where.createdAt = { lte: new Date(to) }
      }
    }

    const calls = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        conversation: {
          include: {
            client: {
              select: { name: true, email: true }
            }
          }
        }
      }
    })

    console.log(`[CALLS API] Found ${calls.length} calls`)

    // Transform the data to match the expected format
    const transformedCalls = calls.map(call => ({
      id: call.id,
      callSid: call.callSid || call.id,
      from: call.from || 'Unknown',
      to: call.to || 'Unknown', 
      direction: call.direction || 'INBOUND',
      status: call.status,
      type: call.type || 'VOICE',
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
      content: call.content,
      metadata: {
        duration: (call.metadata as any)?.duration || 0,
        transcript: (call.metadata as any)?.transcript,
        aiResponse: (call.metadata as any)?.aiResponse,
        escalated: (call.metadata as any)?.escalated || false,
        recordingUrl: (call.metadata as any)?.recordingUrl,
        sentiment: (call.metadata as any)?.sentiment || 'neutral',
        summary: (call.metadata as any)?.summary,
        keyTopics: (call.metadata as any)?.keyTopics || [],
        customerSatisfaction: (call.metadata as any)?.customerSatisfaction,
        ...(call.metadata as any)
      },
      conversation: call.conversation ? {
        id: call.conversation.id,
        messages: Array.isArray(call.conversation.messages) ? call.conversation.messages : [],
        client: call.conversation.client
      } : null
    }))

    console.log(`[CALLS API] Returning ${transformedCalls.length} transformed calls`)

    return NextResponse.json({ calls: transformedCalls })
  } catch (err) {
    console.error('[CALLS API] Error:', err)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error',
      calls: []
    }, { status: 500 })
  }
} 