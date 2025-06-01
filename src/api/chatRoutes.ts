import { Router } from 'express'
import { processMessage } from '../core/aiHandler'

const router = Router()

// POST / route for handling chat messages
router.post('/', async (req, res) => {
  try {
    const { message, conversationHistory, businessId } = req.body

    // Basic validation
    if (!message || !businessId) {
      return res.status(400).json({ error: 'Missing required fields: message and businessId' })
    }

    // Call the placeholder AI handler
    const aiResponse = await processMessage(message, conversationHistory || [], businessId)

    res.status(200).json(aiResponse)

  } catch (error) {
    console.error('Error in chat route:', error)
    res.status(500).json({ error: 'An internal server error occurred.' })
  }
})

export default router 