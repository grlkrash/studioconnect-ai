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

    // Get conversations and calls separately, then combine
    const [conversations, calls] = await Promise.all([
      prisma.conversation.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { name: true } }
        }
      }),
      prisma.callLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        include: {
          conversation: {
            include: {
              client: { select: { name: true } }
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
      return {
        id: `conv_${conv.id}`,
        type: 'chat',
        clientName: conv.client?.name || 'Unknown',
        status: conv.status || 'completed',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount,
        metadata: { channel: 'chat', messageCount }
      }
    }))

    // Add voice interactions
    interactions.push(...calls.map((call: any) => ({
      id: `call_${call.id}`,
      type: 'call',
      clientName: call.conversation?.client?.name || 'Unknown',
      phoneNumber: call.phoneNumber,
      status: call.status,
      duration: call.duration,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      metadata: { channel: 'voice', duration: call.duration, phoneNumber: call.phoneNumber }
    })))

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

export default router 