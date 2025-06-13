import { Router, Response, NextFunction, Request } from 'express'
import { requireAuth, AuthenticatedRequest, isAuthenticatedRequest, UserPayload } from './authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'
import { prisma } from '../services/db'
import { z } from 'zod'
import { processMessage, handleIncomingMessage } from '../core/aiHandler'
import { initiateCall, sendLeadNotificationEmail, initiateClickToCall } from '../services/notificationService'
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

// POST / route for handling chat messages
router.post('/', async (req, res) => {
  try {
    const { message, conversationHistory, businessId, currentFlow } = req.body

    // Debug logging
    console.log(`[Chat API] Received message: "${message}"`)
    console.log(`[Chat API] Business ID: ${businessId}`)
    console.log(`[Chat API] Current Flow: ${currentFlow}`)
    console.log(`[Chat API] Conversation History Length: ${conversationHistory?.length || 0}`)

    // Basic validation
    if (!businessId) {
      res.status(400).json({ error: 'Missing required field: businessId' })
      return
    }

    // Handle empty message as welcome message request
    if (!message || message.trim() === '') {
      console.log('[Chat API] Empty message detected, treating as welcome message request')
      
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          include: {
            agentConfig: true
          }
        })
        
        if (!business) {
          res.status(404).json({ error: 'Business not found' })
          return
        }

        // Determine if branding should be shown
        const showBranding = business.planTier === 'FREE' || business.planTier === 'BASIC'
        
        // Get configured welcome message with business name replacement
        let welcomeMessage = "Hey! How can I help you today?"
        if (business.agentConfig?.welcomeMessage) {
          welcomeMessage = business.agentConfig.welcomeMessage.replace(/\{businessName\}/gi, business.name)
        }
        
        res.status(200).json({
          reply: welcomeMessage,
          configuredWelcomeMessage: welcomeMessage,
          agentName: business.agentConfig?.agentName || 'AI Assistant',
          showBranding: showBranding,
          currentFlow: null
        })
        return
        
      } catch (error) {
        console.error('[Chat API] Error fetching welcome configuration:', error)
        res.status(500).json({ error: 'Error loading welcome message' })
        return
      } finally {
        await prisma.$disconnect()
      }
    }

    // Call the AI handler with currentFlow parameter
    const aiResponse = await processMessage(
      message, 
      conversationHistory || [], 
      businessId, 
      currentFlow
    )

    console.log(`[Chat API] AI Response currentFlow: ${aiResponse.currentFlow}`)
    console.log(`[Chat API] AI Response reply: "${aiResponse.reply}"`)

    // For first message (empty conversation history), include welcome message with business name template replacement
    if (!conversationHistory || conversationHistory.length === 0) {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId }
        })
        
        if (business) {
          const agentConfig = await prisma.agentConfig.findUnique({
            where: { businessId: businessId }
          })
          
          // Add configured welcome message with business name replacement
          if (agentConfig?.welcomeMessage) {
            const welcomeMessageWithBusinessName = agentConfig.welcomeMessage.replace(/\{businessName\}/gi, business.name)
            aiResponse.configuredWelcomeMessage = welcomeMessageWithBusinessName
          }
        }
      } catch (error) {
        console.error('[Chat API] Error fetching welcome message:', error)
      } finally {
        await prisma.$disconnect()
      }
    }

    res.status(200).json(aiResponse)

  } catch (error) {
    console.error('Error in chat route:', error)
    res.status(500).json({ error: 'An internal server error occurred.' })
  }
})

// POST /initiate-call route for handling chat-to-call escalation
router.post('/initiate-call', async (req, res) => {
  try {
    const { phoneNumber, businessId, conversationHistory } = req.body

    // Basic validation
    if (!phoneNumber || !businessId) {
      res.status(400).json({ error: 'Missing required fields: phoneNumber and businessId' })
      return
    }

    // Get business details
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId }
      })
      
      if (!business) {
        res.status(404).json({ error: 'Business not found' })
        return
      }

      if (!business.notificationPhoneNumber) {
        res.status(400).json({ error: 'Business has no notification phone number configured' })
        return
      }

      // Initiate the call
      const callResult = await initiateClickToCall(
        phoneNumber,
        business.notificationPhoneNumber,
        business.name,
        conversationHistory
      )

      res.status(200).json({
        success: true,
        message: 'Call initiated successfully',
        callSid: callResult.callSid
      })

    } catch (error) {
      console.error('[Chat API] Error initiating call:', error)
      res.status(500).json({ error: 'Failed to initiate call' })
    } finally {
      await prisma.$disconnect()
    }

  } catch (error) {
    console.error('Error in initiate-call route:', error)
    res.status(500).json({ error: 'An internal server error occurred.' })
  }
})

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