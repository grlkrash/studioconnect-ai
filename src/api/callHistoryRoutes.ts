import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { prisma } from '../services/db'
import { Request, Response } from 'express'

const router = Router()

// Get call history with pagination and filtering
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const status = req.query.status as string
    const direction = req.query.direction as string
    const search = req.query.search as string
    const from = req.query.from as string
    const to = req.query.to as string

    const where: any = { businessId }
    
    // Status filter
    if (status && status !== 'all') {
      where.status = status
    }
    
    // Direction filter
    if (direction && direction !== 'all') {
      where.direction = direction
    }
    
    // Date range filter
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
    
    // Search filter
    if (search) {
      where.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { to: { contains: search, mode: 'insensitive' } },
        { conversation: { client: { name: { contains: search, mode: 'insensitive' } } } }
      ]
    }

    const [calls, total] = await Promise.all([
      prisma.callLog.findMany({
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
      }),
      prisma.callLog.count({ where })
    ])

    // Transform the data to match expected format
    const transformedCalls = calls.map((call: any) => {
      const metadata = call.metadata as any || {}
      return {
        id: call.id,
        callSid: call.callSid || call.id,
        from: call.from,
        to: call.to,
        direction: call.direction || 'INBOUND',
        status: call.status || 'COMPLETED',
        type: 'VOICE',
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
        content: call.content,
        metadata: {
          duration: metadata.duration || 0,
          transcript: metadata.transcript || null,
          aiResponse: metadata.aiResponse || null,
          escalated: metadata.escalated || false,
          recordingUrl: metadata.recordingUrl || null,
          sentiment: metadata.sentiment || 'neutral',
          summary: metadata.summary || null,
          keyTopics: metadata.keyTopics || metadata.topics || [],
          customerSatisfaction: metadata.customerSatisfaction || metadata.satisfaction || null
        },
        conversation: call.conversation ? {
          id: call.conversation.id,
          messages: call.conversation.messages || []
        } : null
      }
    })

    res.json({
      calls: transformedCalls,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('[CALL HISTORY API] Error:', error)
    res.status(500).json({ error: 'Failed to fetch call history' })
  }
})

// Get single call details
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const { id } = req.params

    const call = await prisma.callLog.findFirst({
      where: { id, businessId },
      include: {
        conversation: {
          include: {
            client: {
              select: { name: true, email: true, phone: true }
            }
          }
        }
      }
    })

    if (!call) {
      return res.status(404).json({ error: 'Call not found' })
    }

    const metadata = call.metadata as any || {}
    const transformedCall = {
      id: call.id,
      callSid: call.callSid || call.id,
      from: call.from,
      to: call.to,
      direction: call.direction || 'INBOUND',
      status: call.status || 'COMPLETED',
      type: 'VOICE',
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      content: call.content,
      metadata: {
        duration: metadata.duration || 0,
        transcript: metadata.transcript || null,
        aiResponse: metadata.aiResponse || null,
        escalated: metadata.escalated || false,
        recordingUrl: metadata.recordingUrl || null,
        sentiment: metadata.sentiment || 'neutral',
        summary: metadata.summary || null,
        keyTopics: metadata.keyTopics || metadata.topics || [],
        customerSatisfaction: metadata.customerSatisfaction || metadata.satisfaction || null
      },
      conversation: call.conversation ? {
        id: call.conversation.id,
        messages: call.conversation.messages || [],
        client: call.conversation.client
      } : null
    }

    res.json({ call: transformedCall })
  } catch (error) {
    console.error('[CALL HISTORY API] Error fetching call:', error)
    res.status(500).json({ error: 'Failed to fetch call details' })
  }
})

// Update call metadata (for post-call processing)
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const { id } = req.params
    const { metadata, status } = req.body

    // Verify call belongs to business
    const existingCall = await prisma.callLog.findFirst({
      where: { id, businessId }
    })

    if (!existingCall) {
      return res.status(404).json({ error: 'Call not found' })
    }

    // Update call with new metadata
    const updatedCall = await prisma.callLog.update({
      where: { id },
      data: {
        ...(status && { status }),
        metadata: {
          ...(existingCall.metadata as any || {}),
          ...metadata
        }
      }
    })

    res.json({ success: true, call: updatedCall })
  } catch (error) {
    console.error('[CALL HISTORY API] Error updating call:', error)
    res.status(500).json({ error: 'Failed to update call' })
  }
})

export default router 