import { Router } from 'express'
import { requireAuth, AuthenticatedRequest } from './authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'
import { prisma } from '../services/db'
import { z } from 'zod'
import { processMessage } from '../core/aiHandler'
import { initiateClickToCall } from '../services/notificationService'
import { PlanManager } from '../utils/planUtils'
import { CallDirection, CallType } from '@prisma/client'

const router = Router()

// Schema definitions
const messageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  businessId: z.string()
})

const conversationSchema = z.object({
  clientId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  businessId: z.string()
})

// Conversation management
router.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { businessId: req.user.businessId },
      include: {
        callLogs: {
          orderBy: { createdAt: 'asc' }
        },
        client: true
      },
      orderBy: { updatedAt: 'desc' }
    })
    res.json(conversations)
  } catch (error) {
    console.error('Error fetching conversations:', error)
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

router.post(
  '/sessions',
  validateRequest(conversationSchema),
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const conversation = await prisma.conversation.create({
        data: {
          businessId: req.user.businessId,
          clientId: req.body.clientId || null,
          metadata: req.body.metadata || {},
          sessionId: crypto.randomUUID()
        }
      })
      res.json(conversation)
    } catch (error) {
      console.error('Error creating conversation:', error)
      res.status(500).json({ error: 'Failed to create conversation' })
    }
  }
)

// Message handling
router.post(
  '/messages',
  validateRequest(messageSchema),
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      // First create or get the conversation
      const conversation = await prisma.conversation.findFirst({
        where: { businessId: req.user.businessId },
        orderBy: { updatedAt: 'desc' }
      }) || await prisma.conversation.create({
        data: {
          businessId: req.user.businessId,
          sessionId: crypto.randomUUID(),
          metadata: {}
        }
      })

      const callLog = await prisma.callLog.create({
        data: {
          businessId: req.user.businessId,
          content: req.body.content,
          type: CallType.CHAT,
          direction: req.body.role === 'user' ? CallDirection.INBOUND : CallDirection.OUTBOUND,
          callSid: crypto.randomUUID(),
          from: 'SYSTEM',
          to: 'SYSTEM',
          status: 'COMPLETED',
          source: 'CHAT',
          conversation: {
            connect: { id: conversation.id }
          }
        }
      })
      res.json(callLog)
    } catch (error) {
      console.error('Error creating call log:', error)
      res.status(500).json({ error: 'Failed to create call log' })
    }
  }
)

// Agent configuration (PRO plan only)
router.get('/widget-config', requireAuth, requirePlan('PRO'), async (req: AuthenticatedRequest, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      include: {
        agentConfig: true
      }
    })
    res.json(business?.agentConfig || {})
  } catch (error) {
    console.error('Error fetching agent config:', error)
    res.status(500).json({ error: 'Failed to fetch agent configuration' })
  }
})

router.post(
  '/widget-config',
  requireAuth,
  requirePlan('PRO'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const config = await prisma.agentConfig.upsert({
        where: { businessId: req.user.businessId },
        update: req.body,
        create: {
          ...req.body,
          businessId: req.user.businessId
        }
      })
      res.json(config)
    } catch (error) {
      console.error('Error updating agent config:', error)
      res.status(500).json({ error: 'Failed to update agent configuration' })
    }
  }
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
      return res.status(400).json({ error: 'Missing required field: businessId' })
    }

    // Handle empty message as welcome message request
    if (!message || message.trim() === '') {
      console.log('[Chat API] Empty message detected, treating as welcome message request')
      
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          include: {
            agentConfig: true
          }
        })
        
        if (!business) {
          return res.status(404).json({ error: 'Business not found' })
        }

        // Determine if branding should be shown using PlanManager
        const showBranding = PlanManager.shouldShowBranding(business.planTier)
        
        // Get configured welcome message with business name replacement
        let welcomeMessage = "Hey! How can I help you today?"
        if (business.agentConfig?.welcomeMessage) {
          welcomeMessage = business.agentConfig.welcomeMessage.replace(/\{businessName\}/gi, business.name)
        }
        
        return res.status(200).json({
          reply: welcomeMessage,
          configuredWelcomeMessage: welcomeMessage,
          agentName: business.agentConfig?.agentName || 'AI Assistant',
          showBranding: showBranding,
          currentFlow: null
        })
        
      } catch (error) {
        console.error('[Chat API] Error fetching welcome configuration:', error)
        return res.status(500).json({ error: 'Error loading welcome message' })
      }
    }

    // Call the AI handler with currentFlow parameter
    const aiResponse = await processMessage(
      message, 
      conversationHistory || [], 
      businessId, 
      currentFlow,
      undefined, // No callSid for chat
      'CHAT'     // Specify channel as CHAT
    )

    console.log(`[Chat API] AI Response currentFlow: ${aiResponse.currentFlow}`)
    console.log(`[Chat API] AI Response reply: "${aiResponse.reply}"`)

    // For first message (empty conversation history), include welcome message with business name template replacement
    if (!conversationHistory || conversationHistory.length === 0) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          include: {
            agentConfig: true
          }
        })
        
        if (business?.agentConfig?.welcomeMessage) {
          const welcomeMessageWithBusinessName = business.agentConfig.welcomeMessage.replace(/\{businessName\}/gi, business.name)
          aiResponse.configuredWelcomeMessage = welcomeMessageWithBusinessName
        }
      } catch (error) {
        console.error('[Chat API] Error fetching welcome message:', error)
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
      return res.status(400).json({ error: 'Missing required fields: phoneNumber and businessId' })
    }

    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        include: {
          agentConfig: true
        }
      })
      
      if (!business) {
        return res.status(404).json({ error: 'Business not found' })
      }

      // Create a new conversation for the call
      const conversation = await prisma.conversation.create({
        data: {
          businessId,
          sessionId: crypto.randomUUID(),
          metadata: {
            source: 'CHAT_ESCALATION',
            chatHistory: conversationHistory
          }
        }
      })

      // Initiate the call
      const callResult = await initiateClickToCall({
        phoneNumber,
        businessId,
        conversationHistory
      })

      res.json(callResult)
    } catch (error) {
      console.error('Error initiating call:', error)
      res.status(500).json({ error: 'Failed to initiate call' })
    }
  } catch (error) {
    console.error('Error in initiate-call route:', error)
    res.status(500).json({ error: 'An internal server error occurred.' })
  }
})

router.get('/chats', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { businessId: req.user.businessId },
      include: {
        callLogs: true
      }
    })
    res.json(conversations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

router.post('/chats', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { title } = req.body
    const conversation = await prisma.conversation.create({
      data: {
        businessId: req.user.businessId,
        sessionId: crypto.randomUUID(),
        metadata: { title }
      }
    })
    res.json(conversation)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create conversation' })
  }
})

router.get('/chats/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        callLogs: true
      }
    })
    if (!conversation || conversation.businessId !== req.user.businessId) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    res.json(conversation)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversation' })
  }
})

router.post('/chats/:id/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { content } = req.body
    const callLog = await prisma.callLog.create({
      data: {
        content,
        conversationId: req.params.id,
        type: CallType.CHAT,
        direction: CallDirection.OUTBOUND,
        businessId: req.user.businessId,
        callSid: crypto.randomUUID(),
        from: 'SYSTEM',
        to: 'SYSTEM',
        status: 'COMPLETED',
        source: 'CHAT'
      }
    })
    res.json(callLog)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create message' })
  }
})

export default router 