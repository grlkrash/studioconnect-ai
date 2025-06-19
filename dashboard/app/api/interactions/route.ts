import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) return NextResponse.json({ interactions: [] })

    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const type = url.searchParams.get('type')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')

    // Get conversations (chat interactions)
    const conversations = await prisma.conversation.findMany({
      where: { 
        businessId: business.id,
        ...(search && {
          OR: [
            { phoneNumber: { contains: search, mode: 'insensitive' } },
            { client: { name: { contains: search, mode: 'insensitive' } } }
          ]
        })
      },
      include: {
        client: { select: { name: true, email: true } },
        callLogs: true
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset
    })

    // Get call logs (voice interactions)
    const calls = await prisma.callLog.findMany({
      where: { 
        businessId: business.id,
        ...(search && {
          OR: [
            { from: { contains: search, mode: 'insensitive' } },
            { to: { contains: search, mode: 'insensitive' } }
          ]
        })
      },
      include: {
        conversation: {
          include: {
            client: { select: { name: true, email: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    })

    // Transform data to unified format
    const interactions = [
      // Transform conversations
      ...conversations.map(conv => ({
        id: conv.id,
        type: 'CHAT' as const,
        source: 'widget' as const,
        status: conv.endedAt ? 'COMPLETED' as const : 'ACTIVE' as const,
        clientId: conv.clientId,
        clientName: conv.client?.name,
        clientEmail: conv.client?.email,
        phoneNumber: conv.phoneNumber,
        createdAt: conv.startedAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        endedAt: conv.endedAt?.toISOString(),
        metadata: {
          messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
          ...conv.metadata as any
        },
        conversation: {
          id: conv.id,
          messages: Array.isArray(conv.messages) ? (conv.messages as any[]).map((msg: any) => ({
            id: `${conv.id}-${msg.timestamp || Date.now()}`,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp || Date.now()).toISOString()
          })) : []
        }
      })),
      // Transform calls
      ...calls.map(call => ({
        id: call.id,
        type: 'VOICE' as const,
        source: 'phone' as const,
        status: call.status === 'COMPLETED' ? 'COMPLETED' as const : 
                call.status === 'FAILED' ? 'FAILED' as const : 'ACTIVE' as const,
        clientId: call.conversation?.clientId,
        clientName: call.conversation?.client?.name,
        clientEmail: call.conversation?.client?.email,
        phoneNumber: call.from,
        createdAt: call.createdAt.toISOString(),
        updatedAt: call.updatedAt.toISOString(),
        metadata: {
          duration: (call.metadata as any)?.duration,
          ...(call.metadata as any)
        },
        conversation: call.conversation ? {
          id: call.conversation.id,
          messages: Array.isArray(call.conversation.messages) ? (call.conversation.messages as any[]).map((msg: any) => ({
            id: `${call.conversation!.id}-${msg.timestamp || Date.now()}`,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp || Date.now()).toISOString()
          })) : []
        } : null
      }))
    ]

    // Filter by type if specified
    const filteredInteractions = type && type !== 'all' 
      ? interactions.filter(i => i.type === type)
      : interactions

    // Sort by updated date
    filteredInteractions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return NextResponse.json({ interactions: filteredInteractions })
  } catch (err) {
    console.error('[INTERACTIONS_GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 