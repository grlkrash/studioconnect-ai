import { Router } from 'express'
import { processMessage } from '../core/aiHandler'

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
    if (!message || !businessId) {
      return res.status(400).json({ error: 'Missing required fields: message and businessId' })
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

    res.status(200).json(aiResponse)

  } catch (error) {
    console.error('Error in chat route:', error)
    res.status(500).json({ error: 'An internal server error occurred.' })
  }
})

export default router 