import { Router } from 'express'
import { processMessage } from '../core/aiHandler'
import { initiateClickToCall } from '../services/notificationService'

const router = Router()

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
          return res.status(404).json({ error: 'Business not found' })
        }

        // Determine if branding should be shown
        const showBranding = business.planTier === 'FREE' || business.planTier === 'BASIC'
        
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
      return res.status(400).json({ error: 'Missing required fields: phoneNumber and businessId' })
    }

    // Get business details
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId }
      })
      
      if (!business) {
        return res.status(404).json({ error: 'Business not found' })
      }

      if (!business.notificationPhoneNumber) {
        return res.status(400).json({ error: 'Business has no notification phone number configured' })
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

export default router 