import { prisma } from '../services/db'
import { getChatCompletion, getEmbedding } from '../services/openai'
import { findRelevantKnowledge } from './ragService'
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from '../services/notificationService'
import { LeadCaptureQuestion } from '@prisma/client'

// Extend the LeadCaptureQuestion type to include isEssentialForEmergency
type ExtendedLeadCaptureQuestion = LeadCaptureQuestion & {
  isEssentialForEmergency: boolean
}

/**
 * Main AI handler that processes user messages and determines the appropriate response flow.
 * Routes to either FAQ (RAG), Lead Capture, or fallback flow based on intent.
 */
export const processMessage = async (
  message: string,
  conversationHistory: any[], // We'll define a proper type later
  businessId: string
): Promise<{ reply: string; [key: string]: any }> => {
  try {
    console.log(`AI Handler processing message for business ${businessId}: "${message}"`)
    
    // DEBUG: Log the received conversation history
    console.log('Received conversationHistory on backend:', JSON.stringify(conversationHistory, null, 2))

    // Step 1: Intent Recognition
    const intentPrompt = `Analyze the user's message and classify their intent.

LEAD_CAPTURE indicators (respond with LEAD_CAPTURE if ANY of these apply):
- Asking about pricing, costs, quotes, estimates, or rates
- Requesting services, appointments, consultations, or bookings
- Expressing problems they need solved (repairs, installations, issues)
- Asking about availability or scheduling
- Wanting to hire, work with, or engage services
- Requesting contact or callback
- Mentioning urgency or timelines for service needs
- Asking "do you..." questions about services offered
- Expressing interest in getting something done/fixed/installed
- Location/service area questions (often precede service requests)

FAQ indicators (respond with FAQ if user is ONLY seeking information):
- General business information (hours, location, policies)
- How things work or process questions
- Educational questions about the industry/service
- Past tense or hypothetical scenarios
- No indication of current need or purchase intent

OTHER indicators:
- Greetings, thank you messages
- Unclear or off-topic messages
- Follow-up clarifications without service intent

User message: '${message}'
Recent history: ${JSON.stringify(conversationHistory.slice(-3))}

Classify as: LEAD_CAPTURE, FAQ, or OTHER`
    
    const intentResponse = await getChatCompletion(
      intentPrompt,
      "You are an intent classification expert. Respond with only: FAQ, LEAD_CAPTURE, or OTHER."
    )
    
    const intent = (intentResponse || 'OTHER').trim().toUpperCase()
    console.log(`Classified intent: ${intent}`)

    // Fetch agent configuration for persona and settings
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    // Step 2: Route based on intent
    if (intent === 'FAQ') {
      // FAQ Flow - Use RAG to find relevant information
      console.log('Entering FAQ flow...')
      
      const relevantKnowledge = await findRelevantKnowledge(message, businessId, 3)
      
      if (relevantKnowledge && relevantKnowledge.length > 0) {
        // Found relevant snippets - construct context-aware response
        const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n')
        const personaPrompt = agentConfig?.personaPrompt || "You are a helpful assistant."
        
        const faqPrompt = `Based on the following context, answer the user's question. If the context doesn't provide an answer, politely say you don't have that information. 

Context:
${contextSnippets}

User's Question: ${message}`
        
        const aiResponse = await getChatCompletion(faqPrompt, personaPrompt)
        return { reply: aiResponse || "I'm having trouble accessing my knowledge base right now. Please try again later." }
      } else {
        // No relevant knowledge found
        console.log('No relevant knowledge found in FAQ flow')
        return { reply: "I couldn't find specific information on that. How else can I help?" }
      }
      
    } else if (intent === 'LEAD_CAPTURE') {
      // Lead Capture Flow - Guide through questions
      console.log('Entering Lead Capture flow...')
      
      console.log('Agent config questions:', agentConfig?.questions?.map((q: LeadCaptureQuestion) => ({ id: q.id, text: q.questionText, order: q.order })))
      
      if (!agentConfig || !agentConfig.questions || agentConfig.questions.length === 0) {
        return { reply: "It looks like our lead capture system isn't set up yet. How else can I assist?" }
      }

      // Check if the INITIAL message that triggered lead capture was an emergency
      let isEmergency = false
      const firstUserMessage = conversationHistory.find(entry => entry.role === 'user')?.content || ''
      
      if (firstUserMessage) {
        console.log(`Checking if initial message indicates emergency: "${firstUserMessage}"`)
        const emergencyCheckPrompt = `Does the following user message indicate an emergency situation (e.g., burst pipe, flooding, no heat in freezing weather, gas leak, electrical hazard, water heater leak)? Respond with only YES or NO. User message: '${firstUserMessage}'`
        const isEmergencyResponse = await getChatCompletion(
          emergencyCheckPrompt, 
          "You are an emergency detection assistant specialized in identifying urgent home service situations."
        )
        isEmergency = (isEmergencyResponse || 'NO').trim().toUpperCase() === 'YES'
        
        if (isEmergency) {
          console.log('Lead creation: Initial message WAS an EMERGENCY')
        } else {
          console.log('Lead creation: Initial message was NOT an emergency')
        }
      }

      // Determine which questions to ask based on emergency status
      let questionsToAsk = agentConfig.questions as ExtendedLeadCaptureQuestion[]
      if (isEmergency) {
        console.log("EMERGENCY DETECTED: Filtering for essential questions...")
        // Filter for questions marked as essential for emergencies
        const essentialQuestions = questionsToAsk.filter(
          q => q.isEssentialForEmergency === true
        )

        if (essentialQuestions.length > 0) {
          questionsToAsk = essentialQuestions
          console.log('Essential emergency questions:', questionsToAsk.map(q => q.questionText))
        } else {
          // Fallback if no questions are marked as essential for emergency:
          // Ask just the very first configured question as a bare minimum
          if (agentConfig.questions && agentConfig.questions.length > 0) {
            console.log("No essential questions marked for emergency, asking only the first configured question.")
            questionsToAsk = agentConfig.questions.slice(0, 1) as ExtendedLeadCaptureQuestion[]
          } else {
            questionsToAsk = [] // No questions configured at all
          }
          console.log('Fallback emergency questions:', questionsToAsk.map(q => q.questionText))
        }
      }
      
      // Determine next unanswered question
      let nextQuestion = null
      const answeredQuestions = new Set<string>()
      
      // Analyze conversation history to find answered questions
      console.log('\n=== ANALYZING CONVERSATION HISTORY ===')
      for (let i = 0; i < conversationHistory.length - 1; i++) {
        const entry = conversationHistory[i]
        const nextEntry = conversationHistory[i + 1]
        console.log(`[${i}] ${entry.role}: "${entry.content}"`)
        
        if (entry.role === 'assistant') {
          // Check if this message matches any of our questions
          const matchedQuestion = questionsToAsk.find((q: ExtendedLeadCaptureQuestion) => q.questionText === entry.content)
          if (matchedQuestion && nextEntry && nextEntry.role === 'user') {
            console.log(`  ✓ Matched question: "${matchedQuestion.questionText}" (ID: ${matchedQuestion.id})`)
            console.log(`  ✓ User answer: "${nextEntry.content}"`)
            answeredQuestions.add(matchedQuestion.id)
          }
        }
      }
      
      console.log('\nAnswered question IDs:', Array.from(answeredQuestions))
      console.log('Total questions to ask in this flow:', questionsToAsk.length)
      console.log('Questions answered:', answeredQuestions.size)
      
      // Find first unanswered question
      for (const question of questionsToAsk) {
        if (!answeredQuestions.has(question.id)) {
          nextQuestion = question
          console.log(`\nNext question to ask: "${question.questionText}" (ID: ${question.id}, Order: ${question.order})`)
          break
        }
      }
      
      if (nextQuestion) {
        // Ask the next question
        return { reply: nextQuestion.questionText }
      } else {
        // All questions answered - create lead
        console.log('\n=== ALL QUESTIONS ANSWERED - CREATING LEAD ===')
        
        // Extract captured data from conversation history
        const capturedData: Record<string, string> = {}
        for (let i = 0; i < conversationHistory.length - 1; i++) {
          const entry = conversationHistory[i]
          if (entry.role === 'assistant') {
            const matchedQuestion = questionsToAsk.find((q: ExtendedLeadCaptureQuestion) => q.questionText === entry.content)
            if (matchedQuestion && i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
              const questionText = matchedQuestion.questionText
              const userAnswer = conversationHistory[i + 1].content
              
              // DEBUG: Log what's being captured
              console.log(`Backend: For Question: "${questionText}"`)
              console.log(`Backend: Captured Answer: "${userAnswer}"`)
              console.log(`Backend: Type of Answer:`, typeof userAnswer)
              
              capturedData[questionText] = userAnswer
            }
          }
        }
        
        // DEBUG: Log final capturedData before saving
        console.log('Final capturedData before saving lead:', JSON.stringify(capturedData, null, 2))
        
        // Map captured data to specific lead fields based on mapsToLeadField property
        let contactName: string | undefined = undefined
        let contactEmail: string | undefined = undefined
        let contactPhone: string | undefined = undefined
        let notes: string | undefined = undefined
        
        // Iterate through questions to find field mappings
        for (const question of questionsToAsk) {
          // Check if this question has a mapsToLeadField property and if we have an answer for it
          // Using type assertion since the field exists in schema but types may not be regenerated yet
          const questionWithMapping = question as typeof question & { mapsToLeadField?: string }
          
          if (questionWithMapping.mapsToLeadField && capturedData[question.questionText]) {
            const answer = capturedData[question.questionText]
            
            console.log(`Mapping question "${question.questionText}" to field "${questionWithMapping.mapsToLeadField}": ${answer}`)
            
            // Map the answer to the appropriate field
            switch (questionWithMapping.mapsToLeadField) {
              case 'contactName':
                contactName = answer
                break
              case 'contactEmail':
                contactEmail = answer
                break
              case 'contactPhone':
                contactPhone = answer
                break
              case 'notes':
                notes = answer
                break
              default:
                console.log(`Unknown mapsToLeadField value: ${questionWithMapping.mapsToLeadField}`)
            }
          }
        }
        
        // Log the mapped fields for debugging
        console.log('Mapped lead fields:', {
          contactName,
          contactEmail,
          contactPhone,
          notes
        })
        
        // Create lead record with appropriate priority
        const newLead = await prisma.lead.create({
          data: {
            businessId,
            capturedData,
            conversationTranscript: JSON.stringify(conversationHistory),
            status: 'NEW',
            priority: isEmergency ? 'URGENT' : 'NORMAL',
            contactName,
            contactEmail,
            contactPhone,
            notes
          }
        })
        
        // Send email notification to the business owner
        try {
          const business = await prisma.business.findUnique({ 
            where: { id: businessId } 
          })
          
          if (business && business.notificationEmail) {
            console.log(`Sending lead notification email to ${business.notificationEmail}...`)
            
            // Prepare lead details for the email
            const leadDetails = {
              capturedData: newLead.capturedData,
              conversationTranscript: newLead.conversationTranscript,
              contactName: newLead.contactName,
              contactEmail: newLead.contactEmail,
              contactPhone: newLead.contactPhone,
              notes: newLead.notes
            }
            
            await sendLeadNotificationEmail(
              business.notificationEmail,
              leadDetails,
              newLead.priority,
              business.name
            )

            // Send confirmation email to customer if email was captured
            if (newLead.contactEmail) {
              try {
                console.log(`Attempting to send lead confirmation email to customer: ${newLead.contactEmail}`)
                await sendLeadConfirmationToCustomer(newLead.contactEmail, business.name, newLead, isEmergency)
              } catch (customerEmailError) {
                console.error('Failed to send confirmation email to customer:', customerEmailError)
              }
            } else {
              console.log('No customer email captured for confirmation email.')
            }

            // Handle emergency voice call if needed
            if (isEmergency && business.notificationPhoneNumber) {
              try {
                console.log(`Initiating emergency voice call to ${business.notificationPhoneNumber}...`)
                
                // Construct a more detailed lead summary
                let leadSummaryForCall = `Lead from ${newLead.contactName || 'unknown contact'}.`
                
                // Look for issue/problem description in captured data
                if (newLead.capturedData && typeof newLead.capturedData === 'object') {
                  const captured = newLead.capturedData as any
                  
                  // Try to find the issue description from various possible question patterns
                  const issueKey = Object.keys(captured).find(key => 
                    key.toLowerCase().includes('issue') || 
                    key.toLowerCase().includes('problem') ||
                    key.toLowerCase().includes('describe') ||
                    key.toLowerCase().includes('what') && key.toLowerCase().includes('happening')
                  )
                  
                  if (issueKey) {
                    leadSummaryForCall += ` Issue: ${captured[issueKey]}.`
                  } else {
                    // If no specific issue question found, include the first user message as context
                    const firstUserMessage = conversationHistory.find(entry => entry.role === 'user')?.content
                    if (firstUserMessage) {
                      leadSummaryForCall += ` Initial message: ${firstUserMessage}.`
                    } else {
                      leadSummaryForCall += ' Details in system.'
                    }
                  }
                }
                
                await initiateEmergencyVoiceCall(
                  business.notificationPhoneNumber,
                  business.name,
                  leadSummaryForCall
                )
                console.log('Emergency voice call initiated successfully')
              } catch (callError) {
                console.error('Failed to initiate emergency voice call:', callError)
              }
            } else if (isEmergency) {
              console.log('No notification phone number configured for emergency calls')
            }
          } else {
            console.log('No notification email configured for this business')
          }
        } catch (emailError) {
          // Don't let email failures break the lead capture flow
          console.error('Failed to send notification email:', emailError)
        }
        
        if (isEmergency) {
          return { 
            reply: "Thank you for providing that information. We've identified this as an URGENT situation and will prioritize your request. Our team will contact you as soon as possible to address your emergency." 
          }
        } else {
          return { 
            reply: "Thanks for providing that information! Our team will review it and get back to you shortly." 
          }
        }
      }
      
    } else {
      // OTHER/Fallback Flow
      console.log('Entering OTHER/fallback flow...')
      
      // Check if this is the start of a conversation
      if (conversationHistory.length === 0 && agentConfig?.welcomeMessage) {
        return { reply: agentConfig.welcomeMessage }
      }
      
      // General chat with persona
      const personaPrompt = agentConfig?.personaPrompt || "You are a helpful assistant."
      const aiResponse = await getChatCompletion(
        message,
        personaPrompt
      )
      
      return { reply: aiResponse || "How can I help you today?" }
    }
    
  } catch (error) {
    console.error('Error in processMessage:', error)
    return { 
      reply: "I apologize, but I'm having trouble processing your request right now. Please try again later or contact us directly." 
    }
  }
} 