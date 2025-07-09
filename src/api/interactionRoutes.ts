import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { prisma } from '../services/db'
import { Request, Response } from 'express'

const router = Router()

// Get all interactions (calls + conversations) with pagination
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const type = req.query.type as string
    const status = req.query.status as string
    const source = req.query.source as string
    const sentiment = req.query.sentiment as string
    const search = req.query.search as string

    // Build where conditions
    const conversationWhere: any = { businessId }
    const callWhere: any = { businessId }

    if (search) {
      conversationWhere.OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { client: { email: { contains: search, mode: 'insensitive' } } }
      ]
      callWhere.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { to: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Get conversations and calls separately, then combine
    const [conversations, calls] = await Promise.all([
      type === 'VOICE' ? [] : prisma.conversation.findMany({
        where: conversationWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          client: { select: { name: true, email: true } }
        }
      }),
      type === 'CHAT' ? [] : prisma.callLog.findMany({
        where: callWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          conversation: {
            include: {
              client: { select: { name: true, email: true } }
            }
          }
        }
      })
    ])

    // Transform and combine data
    let interactions: any[] = []

    // Add chat interactions
    interactions.push(...conversations.map((conv: any) => {
      const messageCount = Array.isArray(conv.messages) ? conv.messages.length : 0
              const metadata = conv.metadata as any || {}
        return {
          id: `conv_${conv.id}`,
          type: 'CHAT',
          source: 'widget',
          status: conv.endedAt ? 'COMPLETED' : 'ACTIVE',
          clientId: conv.clientId,
          clientName: conv.client?.name || 'Unknown',
          clientEmail: conv.client?.email || null,
          phoneNumber: null,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          endedAt: conv.endedAt,
          metadata: {
            messageCount,
            aiResponseTime: metadata.aiResponseTime || null,
            resolutionTime: metadata.resolutionTime || null,
            satisfaction: metadata.satisfaction || null,
            sentiment: metadata.sentiment || 'neutral',
            topics: metadata.topics || [],
            urgency: metadata.urgency || 'medium',
            resolved: !!conv.endedAt,
            handoffToHuman: metadata.handoffToHuman || false,
            customerReturn: metadata.customerReturn || false
          },
          summary: metadata.summary || null,
          conversation: {
            id: conv.id,
            messages: conv.messages || []
          }
        }
    }))

          // Add voice interactions
      interactions.push(...calls.map((call: any) => {
        const metadata = call.metadata as any || {}
        return {
          id: `call_${call.id}`,
          type: 'VOICE',
          source: 'phone',
          status: call.status || 'COMPLETED',
          clientId: call.conversation?.clientId || null,
          clientName: call.conversation?.client?.name || 'Unknown',
          clientEmail: call.conversation?.client?.email || null,
          phoneNumber: call.from,
          createdAt: call.createdAt,
          updatedAt: call.updatedAt,
          endedAt: call.endedAt,
          metadata: {
            duration: metadata.duration || 0,
            aiResponseTime: metadata.aiResponseTime || null,
            resolutionTime: metadata.resolutionTime || null,
            satisfaction: metadata.satisfaction || null,
            sentiment: metadata.sentiment || 'neutral',
            escalationReason: metadata.escalationReason || null,
            topics: metadata.topics || metadata.keyTopics || [],
            urgency: metadata.urgency || 'medium',
            resolved: call.status === 'COMPLETED',
            handoffToHuman: metadata.handoffToHuman || false,
            customerReturn: metadata.customerReturn || false
          },
          summary: metadata.summary || null,
          conversation: call.conversation || null
        }
      }))

    // Apply additional filters
    if (status && status !== 'all') {
      interactions = interactions.filter(i => i.status === status)
    }
    if (source && source !== 'all') {
      interactions = interactions.filter(i => i.source === source)
    }
    if (sentiment && sentiment !== 'all') {
      interactions = interactions.filter(i => i.metadata?.sentiment === sentiment)
    }

    // Sort by creation date
    interactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Apply pagination
    const total = interactions.length
    const paginatedInteractions = interactions.slice(offset, offset + limit)

    res.json({
      interactions: paginatedInteractions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    })
  } catch (error) {
    console.error('[INTERACTIONS API] Error:', error)
    res.status(500).json({ error: 'Failed to fetch interactions' })
  }
})

// Get single interaction details
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const { id } = req.params
    const [type, actualId] = id.split('_')

    let interaction = null

    if (type === 'conv') {
      const conversation = await prisma.conversation.findFirst({
        where: { id: actualId, businessId },
        include: {
          client: { select: { name: true, email: true } }
        }
      })

      if (conversation) {
        interaction = {
          id: `conv_${conversation.id}`,
          type: 'CHAT',
          source: 'widget',
          status: conversation.endedAt ? 'COMPLETED' : 'ACTIVE',
          clientName: conversation.client?.name || 'Unknown',
          clientEmail: conversation.client?.email || null,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          metadata: conversation.metadata,
          conversation: {
            id: conversation.id,
            messages: conversation.messages || []
          }
        }
      }
    } else if (type === 'call') {
      const call = await prisma.callLog.findFirst({
        where: { id: actualId, businessId },
        include: {
          conversation: {
            include: {
              client: { select: { name: true, email: true } }
            }
          }
        }
      })

      if (call) {
        interaction = {
          id: `call_${call.id}`,
          type: 'VOICE',
          source: 'phone',
          status: call.status || 'COMPLETED',
          clientName: call.conversation?.client?.name || 'Unknown',
          phoneNumber: call.from,
          createdAt: call.createdAt,
          updatedAt: call.updatedAt,
          metadata: call.metadata,
          conversation: call.conversation
        }
      }
    }

    if (!interaction) {
      return res.status(404).json({ error: 'Interaction not found' })
    }

    res.json({ interaction })
  } catch (error) {
    console.error('[INTERACTIONS API] Error fetching interaction:', error)
    res.status(500).json({ error: 'Failed to fetch interaction' })
  }
})

export default router 