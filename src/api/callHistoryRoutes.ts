import { Router } from 'express'
import { authMiddleware } from './authMiddleware'
import { prisma } from '../services/db'
import { Request, Response } from 'express'

const router = Router()

// Get call history with pagination
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const businessId = req.user?.businessId
    if (!businessId) {
      return res.status(401).json({ error: 'Business ID required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const status = req.query.status as string
    const search = req.query.search as string

    const where: any = { businessId }
    
    if (status) {
      where.status = status
    }
    
    if (search) {
      where.OR = [
        { phoneNumber: { contains: search, mode: 'insensitive' } },
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
                select: { name: true }
              }
            }
          }
        }
      }),
      prisma.callLog.count({ where })
    ])

    // Transform the data to match expected format
    const transformedCalls = calls.map((call: any) => ({
      id: call.id,
      phoneNumber: call.phoneNumber,
      status: call.status,
      duration: call.duration,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      clientName: call.conversation?.client?.name || 'Unknown',
      conversationId: call.conversationId,
      metadata: call.metadata || {}
    }))

    res.json({
      calls: transformedCalls,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    })
  } catch (error) {
    console.error('[CALL HISTORY API] Error:', error)
    res.status(500).json({ error: 'Failed to fetch call history' })
  }
})

export default router 