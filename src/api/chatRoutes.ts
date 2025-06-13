import { Router, Response, NextFunction, Request } from 'express'
import { requireAuth, AuthenticatedRequest, isAuthenticatedRequest, UserPayload } from './authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'
import { prisma } from '../services/db'
import { z } from 'zod'
import { processMessage, handleIncomingMessage } from '../core/aiHandler'
import { initiateCall, sendLeadNotificationEmail } from '../services/notificationService'
import { PlanUtils } from '../utils/planUtils'
import { CallDirection, CallType, CallStatus, PlanTier } from '@prisma/client'
import { PrismaClient } from '@prisma/client'
import { asyncHandler } from '../utils/asyncHandler'
import crypto from 'crypto'

const router = Router()
const prismaClient = new PrismaClient()

// Schema definitions
const messageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  businessId: z.string().uuid()
})

const conversationSchema = z.object({
  clientId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  businessId: z.string()
})

const callSchema = z.object({
  to: z.string(),
  from: z.string(),
  businessId: z.string().uuid()
})

// Extend Express Request type
interface AuthRequest extends Request {
    user?: UserPayload
}

// Conversation management
router.get('/sessions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const conversations = await prismaClient.conversation.findMany({
    where: { businessId: req.user.businessId },
    include: {
      callLogs: {
        orderBy: { createdAt: 'asc' }
      },
      client: true
    },
    orderBy: { updatedAt: 'desc' }
  })
  return res.json(conversations)
}))

router.post(
  '/sessions',
  validateRequest(conversationSchema),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const conversation = await prismaClient.conversation.create({
      data: {
        businessId: req.user.businessId,
        clientId: req.body.clientId || null,
        metadata: req.body.metadata || {},
        sessionId: crypto.randomUUID()
      }
    })
    return res.json(conversation)
  })
)

// Message handling
router.post(
  '/messages',
  validateRequest(messageSchema),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    // First create or get the conversation
    const conversation = await prismaClient.conversation.findFirst({
      where: { businessId: req.user.businessId },
      orderBy: { updatedAt: 'desc' }
    }) || await prismaClient.conversation.create({
      data: {
        businessId: req.user.businessId,
        sessionId: crypto.randomUUID(),
        metadata: {}
      }
    })

    const callLog = await prismaClient.callLog.create({
      data: {
        businessId: req.user.businessId,
        content: req.body.content,
        type: CallType.CHAT,
        direction: req.body.role === 'user' ? CallDirection.INBOUND : CallDirection.OUTBOUND,
        callSid: crypto.randomUUID(),
        from: 'SYSTEM',
        to: 'SYSTEM',
        status: CallStatus.COMPLETED,
        source: 'CHAT',
        conversationId: conversation.id
      }
    })
    return res.json(callLog)
  })
)

// Agent configuration (PRO plan only)
router.get('/widget-config', requireAuth, requirePlan('PRO'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const business = await prismaClient.business.findUnique({
    where: { id: req.user.businessId },
    include: {
      agentConfig: true
    }
  })
  return res.json(business?.agentConfig || {})
}))

router.post(
  '/widget-config',
  requireAuth,
  requirePlan('PRO'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const config = await prismaClient.agentConfig.upsert({
      where: { businessId: req.user.businessId },
      update: req.body,
      create: {
        ...req.body,
        businessId: req.user.businessId
      }
    })
    return res.json(config)
  })
)

// Chat widget endpoint
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { content, businessId } = messageSchema.parse(req.body)
  
  const response = await handleIncomingMessage(content, crypto.randomUUID(), businessId)
  return res.json({ response })
}))

// Initiate call endpoint
router.post('/initiate-call', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  const { to, from, businessId } = callSchema.parse(req.body)

  const business = await prisma.business.findUnique({
    where: { id: businessId }
  })

  if (!business) return res.status(404).json({ error: 'Business not found' })

  const callSid = await initiateCall(to, from, businessId)
  return res.status(200).json({ message: 'Call initiated successfully', callSid })
}))

// Test notification endpoint
router.post('/test-notification', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
  
  const { businessId } = req.user
  
  const dummyLead = {
    id: 'dummy-lead-id',
    name: 'Test Lead',
    phone: '+15555555555',
    email: 'test@example.com',
    businessId,
    createdAt: new Date(),
    status: 'NEW',
    priority: 'NORMAL',
    notes: 'This is a test lead for notification purposes.',
    callSid: 'dummysid'
  }

  await sendLeadNotificationEmail(businessId, dummyLead, 'NORMAL', '')
  return res.status(200).json({ message: 'Test notification sent successfully' })
}))

router.get('/chats', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const conversations = await prismaClient.conversation.findMany({
    where: { businessId: req.user.businessId },
    include: {
      callLogs: true
    }
  })
  return res.json(conversations)
}))

router.post('/chats', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { title } = req.body
  const conversation = await prismaClient.conversation.create({
    data: {
      businessId: req.user.businessId,
      sessionId: crypto.randomUUID(),
      metadata: { title }
    }
  })
  return res.json(conversation)
}))

router.get('/chats/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const conversation = await prismaClient.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      callLogs: true
    }
  })
  
  if (!conversation || conversation.businessId !== req.user.businessId) {
    return res.status(404).json({ error: 'Conversation not found' })
  }
  
  return res.json(conversation)
}))

router.post('/chats/:id/messages', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { content } = req.body
  const callLog = await prismaClient.callLog.create({
    data: {
      content,
      conversationId: req.params.id,
      type: CallType.CHAT,
      direction: CallDirection.OUTBOUND,
      businessId: req.user.businessId,
      callSid: crypto.randomUUID(),
      from: 'SYSTEM',
      to: 'SYSTEM',
      status: CallStatus.COMPLETED,
      source: 'CHAT'
    }
  })
  return res.json(callLog)
}))

// Error handling middleware
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error in chat routes:', err)
  return res.status(500).json({ error: 'Internal server error' })
})

// Cleanup on process termination
process.on('SIGTERM', async () => {
  console.log('[Chat API] Received SIGTERM. Cleaning up...')
  await prismaClient.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('[Chat API] Received SIGINT. Cleaning up...')
  await prismaClient.$disconnect()
  process.exit(0)
})

export default router 