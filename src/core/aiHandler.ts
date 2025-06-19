import { prisma } from '../services/db'
import { getChatCompletion, getEmbedding } from '../services/openai'
import { findRelevantKnowledge } from './ragService'
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from '../services/notificationService'
import VoiceSessionService from '../services/voiceSessionService'
import twilio from 'twilio'
import { requireAuth } from '../api/authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'
import { refreshProjectStatus } from '../services/projectStatusService'

// Local runtime type for LeadCaptureQuestion shape (avoid direct Prisma type import to prevent missing-field errors)
interface LeadCaptureQuestionBase {
  id?: string
  configId?: string
  questionText: string
  expectedFormat: string | number
  order: number
  isRequired: boolean
  mapsToLeadField?: string
  isEssentialForEmergency: boolean
  createdAt?: Date
  updatedAt?: Date
}

// Extend the LeadCaptureQuestion type to include isEssentialForEmergency
type ExtendedLeadCaptureQuestion = LeadCaptureQuestionBase & {
  isEssentialForEmergency: boolean
}

// Default emergency questions when none are configured
const DEFAULT_EMERGENCY_QUESTIONS: Omit<ExtendedLeadCaptureQuestion, 'id' | 'configId' | 'createdAt' | 'updatedAt'>[] = [
  {
    questionText: "Can you describe this situation in as much detail as possible?",
    expectedFormat: 'TEXT' as any,
    order: 1,
    isRequired: true,
    mapsToLeadField: 'notes',
    isEssentialForEmergency: true
  },
  {
    questionText: "What's your exact address or location?",
    expectedFormat: 'TEXT' as any,
    order: 2,
    isRequired: true,
    mapsToLeadField: 'address',
    isEssentialForEmergency: true
  },
  {
    questionText: "What's your name?",
    expectedFormat: 'TEXT' as any,
    order: 3,
    isRequired: true,
    mapsToLeadField: 'contactName',
    isEssentialForEmergency: true
  },
  {
    questionText: "What's your phone number?",
    expectedFormat: 'PHONE' as any,
    order: 4,
    isRequired: true,
    mapsToLeadField: 'contactPhone',
    isEssentialForEmergency: true
  }
]

// Add new nextAction type
type NextAction = 'CONTINUE' | 'HANGUP' | 'TRANSFER' | 'VOICEMAIL' | 'AWAITING_CALLBACK_CONFIRMATION';

// Add type for client lookup
type ClientLookup = {
  businessId: string
  phone: string
}

/**
 * 🎯 BULLETPROOF FORTUNE 500 SYSTEM PROMPT 🎯
 * Creates an enterprise-grade system prompt optimized for Fortune 500 client interactions
 * Designed for maximum professionalism, reliability, and business value
 */
export const createVoiceSystemPrompt = (
  businessName?: string,
  context?: string,
  leadCaptureQuestions?: any[],
  personaPrompt?: string
): string => {
  return `🏢 You are the ELITE AI Account Manager for ${businessName || 'this premier creative agency'}. You represent Fortune 500 quality service and are engaged in a REAL-TIME EXECUTIVE PHONE CONVERSATION.

${personaPrompt ? `\n🎯 **EXECUTIVE PERSONA GUIDELINES:**\n${personaPrompt}\n` : ''}

🎯 **FORTUNE 500 OBJECTIVES - ZERO TOLERANCE FOR FAILURE:**
1. **Fortune 500 Clients**: Deliver instant project intelligence, executive-level updates, and seamless escalation
2. **Enterprise Prospects**: Qualify high-value opportunities with C-suite professionalism
3. **Mission-Critical Issues**: Immediate executive escalation for time-sensitive business matters
4. **Account Management Excellence**: Maintain relationships worth millions in annual revenue

💼 **EXECUTIVE COMMUNICATION STANDARDS:**
- Speak with the authority and professionalism expected by Fortune 500 executives
- Every word reflects our premium positioning in the creative industry
- Demonstrate deep understanding of complex business challenges
- Show respect for the caller's time and business priorities

🏢 **BULLETPROOF BUSINESS RULES - FORTUNE 500 STANDARDS:**

💎 **PREMIUM AGENCY IDENTITY**: You represent EXCLUSIVELY ${businessName || 'this premier creative agency'} - a Fortune 500 caliber creative powerhouse. NEVER suggest competitors. You embody our premium market position and exceptional capabilities.

🎯 **ENTERPRISE KNOWLEDGE PROTOCOL**: You may ONLY use information from verified "CONTEXT" data below. For ANY information not explicitly provided, respond with executive-level professionalism:
"I'll need to connect you directly with our project team to get you the precise details you need. Let me arrange that immediately."

💼 **EXECUTIVE CLIENT QUALIFICATION**: When qualifying Fortune 500 prospects:
- Execute ONLY the strategic questions configured below
- Ask ONE premium question at a time with executive presence
- Use sophisticated acknowledgments: "Excellent", "Perfect", "Outstanding"
- Maintain Fortune 500 conversation flow and business intelligence gathering

🚫 **ABSOLUTE PROHIBITIONS - ZERO TOLERANCE:**
- NEVER restart conversations or repeat greetings (maintains executive flow)
- NEVER suggest competitors (we are the premium choice)
- NEVER invent project details (integrity is paramount)
- NEVER deviate from qualification protocol (consistency builds trust)
- NEVER make unauthorized commitments (executive approval required)

**ABSOLUTE REQUIREMENTS - NO EXCEPTIONS:**

1. **DIALOGUE-ONLY OUTPUT:** Your response IS the exact words to be spoken. NEVER EVER include:
   ❌ Prefixes: "Say:", "Response:", "AI:", "Assistant:", "Voice:", "Agent:", "Bot:", "System:", "Output:", "Reply:", "Answer:", "Speaking:", "Dialogue:", "Script:"
   ❌ Meta-commentary: "[speaking naturally]", "(pause here)", "(thinking)", "[empathetic tone]"
   ❌ Explanations: "I should say...", "Let me respond with...", "Here's what I'll say..."
   ❌ Formatting: Quotation marks around entire response, markdown, bullet points
   ❌ Stage directions: Actions, descriptions, or instructions about delivery
   ❌ Technical artifacts: JSON, XML tags (except SSML), programming syntax

2. **VOICE-FIRST SPEECH PATTERNS:**
   - Use CONVERSATIONAL sentences (8-12 words per sentence maximum)
   - Employ natural speech rhythm with pauses and breath points
   - Use contractions authentically ("I'll", "we're", "that's", "can't", "won't")
   - Include natural transitions: "Well,", "Actually,", "You know,", "So,", "Now,"
   - Avoid written language patterns - speak as humans naturally do on the phone
   - Use active voice and direct, simple language
   - Break complex ideas into multiple short sentences

3. **STRATEGIC SSML FOR NATURAL FLOW:** Use these SSML tags sparingly but effectively:
   * **Natural Pauses:** 
   * **Processing Pauses:** \`<break time="500ms"/>\` before important questions or after receiving complex information
   * **Gentle Emphasis:** \`<emphasis level="moderate">key information</emphasis>\` for critical details only
   * **Pronunciation:** \`<phoneme alphabet="ipa" ph="liːd">leads</phoneme>\` for sales leads vs "led"
   
   SSML Examples:
   - "Thanks for calling!<break time="300ms"/> How can I help you today?"
   - "I understand you need <emphasis level="moderate">project status update</emphasis>.<break time="400ms"/> Which project are you referring to?"
   - "Let me get your <emphasis level="moderate">contact information</emphasis><break time="300ms"/> so we can follow up."

4. **HELPFUL & EMPATHETIC PERSONA:**
   - Begin responses with natural acknowledgments: "Absolutely", "Of course", "I understand", "Sure thing", "Got it"
   - Use empathetic language for concerns: "That sounds important", "I can understand why you'd want to know that"
   - Maintain warm professionalism - friendly but competent
   - Mirror the caller's energy level appropriately
   - Show genuine interest in helping solve their creative needs
   - Use creative industry language naturally: "Let me check on that project", "I'll get you an update on those deliverables", "I can connect you with the creative team"

5. **PHONE CONVERSATION MASTERY:**
   - Always acknowledge what you heard before moving to next topic
   - Ask ONE clear question at a time - avoid multiple questions in one response
   - Confirm critical details by repeating them back
   - Use verbal signaling: "Okay", "Right", "I see" to show you're following
   - Provide clear next steps or endings
   - Keep responses under 30 seconds when spoken (roughly 75-100 words max)

**CRITICAL REMINDER:** You ARE the voice speaking live to a person on the phone. Every single word you generate will be spoken aloud immediately. There is no script, no narrator, no instructions - just natural human conversation through a phone call.

${context ? `
**CONTEXT FOR THIS CALL:**
${context}
` : ''}${leadCaptureQuestions && leadCaptureQuestions.length > 0 ? `

**CLIENT QUALIFICATION QUESTIONS (ask in this exact order):**
${leadCaptureQuestions.map((q, index) => `${index + 1}. ${q.questionText}`).join('\n')}

` : ''}`
}

/**
 * Post-processes AI responses to ensure clean speech output
 * Acts as an aggressive safety net to strip any unwanted prefixes or formatting
 */
const cleanVoiceResponse = (response: string): string => {
  if (!response) return response
  
  let cleanedResponse = response.trim()
  
  // ULTRA-AGGRESSIVE PREFIX REMOVAL - Comprehensive case-insensitive patterns
  const prefixPatterns = [
    // Core AI/Assistant prefixes
    /^(Say|Response|Here is the response|Assistant|AI|Voice|Agent|Bot|System|Output|Reply|Answer|Speaking|Dialogue|Script|Chat|Message|Text):\s*/gi,
    
    // "I should/will/would" patterns
    /^(I should say|Let me say|I'll say|I will say|I would say|I need to say|I want to say):\s*/gi,
    /^(The response is|My response is|The answer is|My answer is):\s*/gi,
    
    // "Here's" patterns
    /^(Here's what I would say|Here's my response|Here's what I'll say|Here's my answer|Here is what I would say):\s*/gi,
    /^(This is what I would say|This is my response|This is what I'll say):\s*/gi,
    
    // Role-based prefixes
    /^(Voice Assistant|Phone Agent|Call Handler|Customer Service|Support Agent|Virtual Assistant):\s*/gi,
    /^(Business Assistant|Phone Support|Call Center|Help Desk|Service Rep):\s*/gi,
    
    // Action-based prefixes
    /^(Speaking|Responding|Replying|Answering|Saying|Telling|Explaining):\s*/gi,
    
    // Formal response patterns
    /^(The appropriate response would be|An appropriate response is|A good response would be):\s*/gi,
    /^(In response to|As a response|For this response):\s*/gi,
    
    // Technical/Programming artifacts
    /^(Function|Method|Return|Output|Result|Value):\s*/gi,
    /^(Console\.log|Print|Echo|Display):\s*/gi,
    
    // Conversational artifacts that sometimes appear
    /^(Well, I would say|So I would respond with|I think I should say):\s*/gi,
    /^(Let me respond|Let me answer|Allow me to say):\s*/gi
  ]
  
  // Apply patterns iteratively until no more changes occur
  let maxIterations = 10 // Prevent infinite loops
  let iterations = 0
  let previousLength = 0
  
  while (cleanedResponse.length !== previousLength && iterations < maxIterations) {
    previousLength = cleanedResponse.length
    iterations++
    
    for (const pattern of prefixPatterns) {
      cleanedResponse = cleanedResponse.replace(pattern, '').trim()
    }
  }
  
  // Remove meta-commentary, stage directions, and technical artifacts
  cleanedResponse = cleanedResponse.replace(/^\[.*?\]\s*/g, '').trim()  // [speaking naturally]
  cleanedResponse = cleanedResponse.replace(/^\(.*?\)\s*/g, '').trim()  // (pause here)
  cleanedResponse = cleanedResponse.replace(/^\{.*?\}\s*/g, '').trim()  // {thinking}
  cleanedResponse = cleanedResponse.replace(/^<(?!break|emphasis|phoneme).*?>\s*/g, '').trim()  // <tone> but preserve SSML
  
  // Remove various quotation mark wrappings
  const quotePatterns = [
    /^"(.*)"$/s,     // Double quotes
    /^'(.*)'$/s,     // Single quotes
    /^`(.*)`$/s,     // Backticks
    /^«(.*)»$/s,     // French quotes
    /^"(.*)"$/s,     // Smart quotes
    /^'(.*)'$/s      // Smart single quotes
  ]
  
  for (const quotePattern of quotePatterns) {
    const match = cleanedResponse.match(quotePattern)
    if (match && match[1]) {
      cleanedResponse = match[1].trim()
      break
    }
  }
  
  // Remove markdown formatting artifacts
  cleanedResponse = cleanedResponse.replace(/^\*\*(.*?)\*\*$/gs, '$1').trim()  // **bold**
  cleanedResponse = cleanedResponse.replace(/^\*(.*?)\*$/gs, '$1').trim()      // *italic*
  cleanedResponse = cleanedResponse.replace(/^_(.*?)_$/gs, '$1').trim()        // _underline_
  cleanedResponse = cleanedResponse.replace(/^`(.*?)`$/gs, '$1').trim()        // `code`
  
  // Remove structured formatting
  cleanedResponse = cleanedResponse.replace(/^[-=+*#]{2,}\s*/gm, '').trim()    // Headers/dividers
  cleanedResponse = cleanedResponse.replace(/^>\s*/gm, '').trim()              // Block quotes
  cleanedResponse = cleanedResponse.replace(/^\d+\.\s*/gm, '').trim()          // Numbered lists
  cleanedResponse = cleanedResponse.replace(/^[-*+]\s*/gm, '').trim()          // Bullet lists
  
  // Remove programming/JSON artifacts
  cleanedResponse = cleanedResponse.replace(/^\/\/.*$/gm, '').trim()           // Comments
  cleanedResponse = cleanedResponse.replace(/^\/\*.*?\*\//gs, '').trim()       // Block comments
  cleanedResponse = cleanedResponse.replace(/^\s*[\{\}]\s*$/gm, '').trim()     // Lone braces
  
  // Remove trailing artifacts
  cleanedResponse = cleanedResponse.replace(/\.\s*["'\]\}]+\s*$/g, '.').trim() // Period + quotes/brackets
  cleanedResponse = cleanedResponse.replace(/["\'\]\}]+\s*$/g, '').trim()      // Trailing quotes/brackets
  
  // Clean up whitespace and line breaks
  cleanedResponse = cleanedResponse.replace(/\n\s*\n/g, '\n').trim()           // Multiple line breaks
  cleanedResponse = cleanedResponse.replace(/\s+/g, ' ').trim()                // Multiple spaces
  
  // Final validation - if response becomes empty or too short, return original
  if (!cleanedResponse || cleanedResponse.length < 2) {
    console.warn('cleanVoiceResponse: Over-cleaned response, returning original:', response)
    return response.trim()
  }
  
  return cleanedResponse
}

/**
 * Generate a natural acknowledgment to prepend to questions
 */
const getQuestionAcknowledgment = (isFirstQuestion: boolean = false): string => {
  if (isFirstQuestion) {
    const firstAcknowledgments = [
      "Perfect!",
      "Great!",
      "Alright,",
      "Okay,",
      "Sure thing!"
    ]
    return firstAcknowledgments[Math.floor(Math.random() * firstAcknowledgments.length)]
  } else {
    const followUpAcknowledgments = [
      "Got it.",
      "Okay.",
      "Alright,",
      "Thanks.",
      "Perfect."
    ]
    return followUpAcknowledgments[Math.floor(Math.random() * followUpAcknowledgments.length)]
  }
}

/**
 * Checks if a user's response is clear and complete for the given context
 */
const isResponseClear = async (
  userResponse: string,
  expectedContext: string,
  currentGoal: string
): Promise<boolean> => {
  try {
    const clarityCheckPrompt = `Evaluate if the user's response is clear and complete for the current context.

Current Goal/Question: ${currentGoal}
Expected Context: ${expectedContext}
User's Response: "${userResponse}"

Consider unclear responses:
- Very short or vague responses like "later", "maybe", "hmm", "okay"
- Responses that don't address the question asked
- Ambiguous transcriptions with unclear words
- Incomplete information when specific details are needed
- Non-sequitur responses that seem unrelated

Consider clear responses:
- Direct answers that address the question
- Complete information as requested
- Clear intent even if brief (e.g., "yes", "no" for yes/no questions)
- Properly formatted information (phone numbers, emails, names)

Respond with only YES if clear and complete, or NO if unclear/incomplete.`

            const clarityResponse = await getChatCompletion(
          clarityCheckPrompt,
          "You are a clarity assessment expert focused on evaluating user response completeness and clarity."
        )

        const cleanedClarityResponse = cleanVoiceResponse(clarityResponse || 'NO')
        return cleanedClarityResponse.trim().toUpperCase() === 'YES'
  } catch (error) {
    console.error('Error checking response clarity:', error)
    // Default to clear if we can't check
    return true
  }
}

/**
 * Generates a clarifying question based on unclear user input
 */
const generateClarifyingQuestion = async (
  unclearResponse: string,
  originalQuestion: string,
  context: string,
  businessName?: string
): Promise<string> => {
  try {
    const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined)
    
    const clarifyingUserPrompt = `The user gave an unclear response. Generate a brief, polite clarifying question to get the information needed.

Original Question/Context: ${originalQuestion}
User's Unclear Response: "${unclearResponse}"
Context: ${context}

Generate a clarifying question that:
- Begins with a natural interjection or acknowledgment ("I see," "Okay," "Alright," "Hmm," etc.)
- Is brief and conversational (voice-friendly)
- Politely acknowledges their response
- Asks for specific clarification needed
- Uses natural speech patterns and transitions
- Includes examples if helpful
- Flows naturally in conversation

Examples of good clarifying questions with natural interjections:
- "Okay, I want to make sure I heard that correctly - could you repeat your phone number?"
- "Alright, I didn't quite catch that. Could you tell me your name again?"
- "I see. When you say 'later', do you mean you'd like us to call you at a specific time, or would you prefer email contact?"
- "Right, I heard something about a plumbing issue - could you describe what's happening specifically?"
- "Mhm, let me make sure I understand - are you saying the problem is urgent?"

Generate only the clarifying question text:`
    
    const rawResponse = await getChatCompletion(clarifyingUserPrompt, voiceSystemPrompt)
    const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null

    return cleanedResponse || "I didn't quite catch that. Could you please repeat what you said?"
  } catch (error) {
    console.error('Error generating clarifying question:', error)
    return "I didn't quite catch that. Could you please repeat what you said?"
  }
}

/**
 * Smart question selection for emergency situations using AI
 */
const selectSmartEmergencyQuestions = async (
  emergencyMessage: string,
  availableQuestions: ExtendedLeadCaptureQuestion[],
  businessName?: string
): Promise<ExtendedLeadCaptureQuestion[]> => {
  try {
    // If we have configured emergency questions, use them
    const configuredEmergencyQuestions = availableQuestions.filter(q => q.isEssentialForEmergency)
    if (configuredEmergencyQuestions.length > 0) {
      console.log('Using configured emergency questions:', configuredEmergencyQuestions.length)
      return configuredEmergencyQuestions
    }

    console.log('No configured emergency questions found, using smart selection...')

    // Use AI to determine which questions are most relevant for this emergency
    const questionSelectionPrompt = `Emergency situation: "${emergencyMessage}"

Available questions:
${availableQuestions.map((q, index) => `${index + 1}. ${q.questionText} (maps to: ${q.mapsToLeadField || 'none'})`).join('\n')}

Default emergency questions:
${DEFAULT_EMERGENCY_QUESTIONS.map((q, index) => `${index + 1}. ${q.questionText} (maps to: ${q.mapsToLeadField})`).join('\n')}

For this emergency situation, select the 3-4 most essential questions that would help ${businessName || 'the business'} respond quickly and effectively. 

Prioritize:
1. Understanding the emergency details
2. Getting contact information
3. Getting location/address if relevant
4. Any service-specific details needed

Respond with ONLY the question numbers from the available questions list, separated by commas (e.g., "1,3,4"). If none of the available questions are suitable for emergencies, respond with "DEFAULT" to use the default emergency questions.`

    const aiResponse = await getChatCompletion(
      questionSelectionPrompt,
      "You are an emergency response expert who selects the most critical questions for urgent situations."
    )

    const cleanedResponse = cleanVoiceResponse(aiResponse || 'DEFAULT').trim()

    if (cleanedResponse === 'DEFAULT') {
      console.log('AI recommends using default emergency questions')
      return DEFAULT_EMERGENCY_QUESTIONS as ExtendedLeadCaptureQuestion[]
    }

    // Parse the AI response to get question indices
    const selectedIndices = cleanedResponse.split(',').map(num => parseInt(num.trim()) - 1).filter(index => !isNaN(index))
    
    if (selectedIndices.length === 0) {
      console.log('Could not parse AI response, falling back to default emergency questions')
      return DEFAULT_EMERGENCY_QUESTIONS as ExtendedLeadCaptureQuestion[]
    }

    const selectedQuestions = selectedIndices
      .map(index => availableQuestions[index])
      .filter(q => q !== undefined)

    if (selectedQuestions.length === 0) {
      console.log('No valid questions selected, falling back to default emergency questions')
      return DEFAULT_EMERGENCY_QUESTIONS as ExtendedLeadCaptureQuestion[]
    }

    console.log(`AI selected ${selectedQuestions.length} emergency questions:`, selectedQuestions.map(q => q.questionText))
    return selectedQuestions

  } catch (error) {
    console.error('Error in smart emergency question selection:', error)
    // Fallback to default emergency questions
    return DEFAULT_EMERGENCY_QUESTIONS as ExtendedLeadCaptureQuestion[]
  }
}

/**
 * Instant emergency escalation option
 */
const offerEmergencyEscalation = async (
  emergencyMessage: string,
  businessName?: string
): Promise<string> => {
  try {
    const escalationPrompt = `Emergency situation: "${emergencyMessage}"

This appears to be a serious emergency. Generate a brief, empathetic response that:
1. Acknowledges the urgency of their situation
2. Offers two clear options:
   - Immediate connection to emergency response team (within 30 seconds)
   - Quick information gathering (2-3 questions) for immediate dispatch
3. Explains what happens in each option
4. Sets clear expectations for response time

Keep it conversational and under 30 seconds when spoken. Use natural speech patterns.

Business name: ${businessName || 'our team'}`

    const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined)
    const aiResponse = await getChatCompletion(escalationPrompt, voiceSystemPrompt)
    
    return cleanVoiceResponse(aiResponse || 
      `I understand this is an emergency situation. I can either connect you directly to our emergency response team right now (within 30 seconds), or quickly gather just 2-3 essential details so we can dispatch help immediately. Which would you prefer?`
    )

  } catch (error) {
    console.error('Error generating emergency escalation offer:', error)
    return `I understand this is an emergency situation. I can either connect you directly to our emergency response team right now (within 30 seconds), or quickly gather just 2-3 essential details so we can dispatch help immediately. Which would you prefer?`
  }
}

// Add confirmation rules for emergency flow
const confirmEmergencyDetails = async (
  userResponse: string,
  questionType: 'address' | 'name' | 'phone',
  businessName?: string
): Promise<string> => {
  const confirmationPrompt = `The user has provided their ${questionType}. Generate a confirmation response that:
1. Repeats back the ${questionType} they provided
2. Asks "Is that correct?"
3. Uses natural speech patterns
4. Is brief and clear

User's ${questionType}: "${userResponse}"

Generate only the confirmation response:`

  const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined)
  const confirmationResponse = await getChatCompletion(confirmationPrompt, voiceSystemPrompt)
  return cleanVoiceResponse(confirmationResponse || `I heard your ${questionType} as "${userResponse}". Is that correct?`)
}

// Add Twilio caller ID lookup function
const getCallerId = async (callSid: string): Promise<string | null> => {
  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    const call = await twilioClient.calls(callSid).fetch()
    return call.from || null
  } catch (error) {
    console.error('Error fetching caller ID from Twilio:', error)
    return null
  }
}

/**
 * Determines the next voice action based on intent and current flow
 */
const determineNextVoiceAction = (intent: string, currentFlow: string | null): NextAction => {
  if (intent === 'END_CALL') return 'HANGUP'
  if (currentFlow === 'EMERGENCY_ESCALATION_OFFER') return 'TRANSFER'
  return 'CONTINUE'
}

/**
 * Main AI handler that processes user messages and determines the appropriate response flow.
 * Routes to either FAQ (RAG), Lead Capture, or fallback flow based on intent.
 */
const _processMessage = async (
  message: string,
  conversationHistory: any[],
  businessId: string,
  currentActiveFlow?: string | null,
  callSid?: string,
  channel: 'VOICE' | 'CHAT' = 'VOICE'
): Promise<{ 
  reply: string; 
  currentFlow?: string | null; 
  showBranding?: boolean; 
  nextAction?: NextAction;
  [key: string]: any 
}> => {
  const voiceSessionService = VoiceSessionService.getInstance()
  const session = callSid ? await voiceSessionService.getVoiceSession(callSid) : null

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        agentConfig: {
          include: {
            questions: { orderBy: { order: 'asc' } },
          },
        },
      },
    })

    if (!business) {
      console.warn(`[AI Handler] Business with ID ${businessId} not found.`)
      return {
        reply: "I'm sorry, I can't seem to access my configuration right now. Please try your call again in a few moments.",
        currentFlow: 'ERROR',
        nextAction: 'HANGUP',
      }
    }

    let context = ''
    let clientContext = ''
    let projectContext = ''
    let knowledgeContext = ''

    // Fetch Knowledge Base for the business
    const knowledgeBaseEntries = await prisma.knowledgeBase.findMany({
      where: { businessId: business.id },
      select: { content: true },
    })
    if (knowledgeBaseEntries.length > 0) {
      knowledgeContext = '--- KNOWLEDGE BASE ---\n' + knowledgeBaseEntries.map((e: { content: string }) => `- ${e.content}`).join('\n')
    }

    // If this is a voice call, identify the caller and fetch their projects
    if (callSid && channel === 'VOICE') {
      const callLog = await prisma.callLog.findUnique({
        where: { callSid },
        select: { from: true },
      })

      if (callLog && callLog.from) {
        const client = await prisma.client.findFirst({
          where: {
            businessId: business.id,
            phone: callLog.from,
          },
          include: {
            projects: {
              where: { status: { not: 'COMPLETED' } },
              select: { id: true, name: true, status: true, details: true, lastSyncedAt: true },
            },
          },
        })

        if (client) {
          clientContext = `--- CALLER INFORMATION ---\nThis call is from an existing client: ${client.name}.`
          if (client.projects.length > 0) {
            // Refresh status for projects if stale (> 2 min)
            const now = Date.now()
            for (const proj of client.projects) {
              const last = proj.lastSyncedAt ? new Date(proj.lastSyncedAt).getTime() : 0
              if (now - last > 2 * 60 * 1000) {
                await refreshProjectStatus(proj.id)
              }
            }

            // Re-query to get updated data
            const updated = await prisma.project.findMany({ where: { clientId: client.id, status: { not: 'COMPLETED' } }, select: { name: true, status: true, details: true } })
            projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\n` + updated.map((p: { name: string; status: string; details: string | null }) => `  - Project: "${p.name}", Status: ${p.status}, Last Update: ${p.details || 'No details available'}`).join('\n')
          } else {
            projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\nThis client currently has no active projects.`
          }
        }
      }
    }

    // Assemble the final context string in order of specificity
    const contextParts = [clientContext, projectContext, knowledgeContext].filter(Boolean)
    if (contextParts.length > 0) {
      context = contextParts.join('\n\n')
    }

    const leadCaptureQuestions = business.agentConfig?.questions || []

    const personaPrompt = business.agentConfig?.personaPrompt
    const systemMessage = createVoiceSystemPrompt(
      business.name,
      context,
      leadCaptureQuestions,
      personaPrompt || undefined
    )
    
    const finalHistory = conversationHistory.map((h: { role: string; content: string }) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))

    console.log('[AI Handler] Generating chat completion with system message:', systemMessage.substring(0, 500) + '...')

    // --- FAST PATH: direct project status inquiry detection before invoking LLM ---
    try {
      const statusRegex = /(status|update|progress)\s+(of|for)?\s+([\w\s\-']{3,})/i
      const m = message.match(statusRegex)
      if (m && m[3] && businessId) {
        const projName = m[3].trim()
        // Simple match: first project whose name includes the captured phrase (case-insensitive)
        const proj = await prisma.project.findFirst({
          where: {
            businessId,
            name: { contains: projName, mode: 'insensitive' },
          },
          select: { name: true, status: true, details: true },
        })
        if (proj) {
          const statusText = proj.status?.toLowerCase().replace(/_/g, ' ') || 'in progress'
          const detailsText = proj.details ? ` Latest update: ${proj.details}.` : ''
          const quickReply = `The current status of ${proj.name} is ${statusText}.${detailsText}`
          return { reply: quickReply, currentFlow: currentActiveFlow || null, nextAction: 'CONTINUE' }
        }
      }
    } catch (quickErr) {
      console.warn('[AI Handler] Quick project status check failed, falling back to LLM', quickErr)
    }

    const aiResponse = await getChatCompletion([
      { role: 'system', content: systemMessage },
      ...finalHistory,
      { role: 'user', content: message }
    ])

    const reply = cleanVoiceResponse(aiResponse || '')
    
    // TEMPORARY: Forcing a simple response for now to test the pipeline
    // const reply = "This is a test response."

    // Basic heuristic for live escalation or voicemail requests
    let nextAction: NextAction = 'CONTINUE'
    const lowerMsg = message.toLowerCase()
    if (/(human|representative|talk to (someone|a person)|connect me|transfer|emergency)/.test(lowerMsg)) {
      nextAction = 'TRANSFER'
    } else if (/(voicemail|leave (a )?message)/.test(lowerMsg)) {
      nextAction = 'VOICEMAIL'
    }

    // Update session state
    if (session && callSid) {
      const updatedHistory = [...conversationHistory, { role: 'user', content: message }, { role: 'assistant', content: reply }]
      await voiceSessionService.updateVoiceSession(callSid, updatedHistory, currentActiveFlow || null)
    }

    return {
      reply,
      currentFlow: currentActiveFlow, // placeholder
      nextAction,
    }
  } catch (error) {
    console.error('[🎯 BULLETPROOF AI HANDLER] ❌ Critical error processing message:', error)
    
    // Enhanced error categorization and recovery for production reliability
    let recoveryMessage = '';
    let nextAction: NextAction = 'CONTINUE';
    
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
        recoveryMessage = generateRecoveryResponse('network');
        console.error('[🎯 BULLETPROOF AI HANDLER] 🌐 Network/timeout error detected');
      } else if (errorMessage.includes('database') || errorMessage.includes('prisma')) {
        recoveryMessage = generateRecoveryResponse('database');
        console.error('[🎯 BULLETPROOF AI HANDLER] 🗃️ Database error detected');
      } else if (errorMessage.includes('openai') || errorMessage.includes('api')) {
        recoveryMessage = generateRecoveryResponse('ai processing');
        console.error('[🎯 BULLETPROOF AI HANDLER] 🤖 AI API error detected');
      } else {
        recoveryMessage = generateRecoveryResponse('generic');
        console.error('[🎯 BULLETPROOF AI HANDLER] ⚠️ Unknown error type detected');
      }
    } else {
      recoveryMessage = generateRecoveryResponse('generic');
      console.error('[🎯 BULLETPROOF AI HANDLER] ⚠️ Non-Error object thrown');
    }

    // Log error details for monitoring while providing graceful user experience
    console.error('[🎯 BULLETPROOF AI HANDLER] 📊 Error details for monitoring:', {
      businessId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : 'No stack trace available',
      messageLength: message.length,
      conversationHistoryLength: conversationHistory.length,
      timestamp: new Date().toISOString()
    });

    // Always return a helpful response instead of hanging up - Fortune 500 quality
    return {
      reply: recoveryMessage,
      currentFlow: currentActiveFlow, // Maintain current flow instead of erroring
      nextAction,
    }
  }
}

/**
 * 🎯 BULLETPROOF RECOVERY RESPONSE SYSTEM 🎯
 * Generates graceful, empathetic recovery responses for critical voice processing errors
 * This function provides human-like responses when the main AI processing fails, ensuring
 * Fortune 500 clients never experience dead air or confusing errors
 */
export const generateRecoveryResponse = (errorContext?: string): string => {
  // Different recovery messages based on error type for more contextual responses
  const genericRecoveryMessages = [
    "I do apologize, it seems I'm experiencing a brief technical issue with my connection right now. I can still take a message for the team if you'd like.",
    "I'm sorry, I seem to be having some technical difficulties at the moment. Would you like to leave a message for someone to call you back?",
    "My apologies - I'm experiencing a brief technical issue. I can take down your information so our team can reach out to you directly.",
    "I'm sorry about that, I seem to be having a connection problem right now. I can still help by taking your details for a callback if that would be helpful."
  ]

  const transcriptionRecoveryMessages = [
    "I'm sorry, I didn't quite catch what you said. Could you please repeat that for me?",
    "I apologize, but I didn't hear that clearly. Could you please say that again?",
    "I'm having trouble hearing you clearly. Could you please repeat what you just said?",
    "Sorry, I missed that. Could you please repeat your message?"
  ]

  const aiProcessingRecoveryMessages = [
    "I'm experiencing a brief processing delay. Let me try to help you another way - what can I assist you with today?",
    "I apologize for the delay. How can I help you with your creative project or business needs today?",
    "Sorry about that brief pause. I'm here to help - what brings you to our agency today?",
    "My apologies for the technical hiccup. How may I assist you with your project today?"
  ]

  let selectedMessages = genericRecoveryMessages;

  // Choose appropriate recovery messages based on error context
  if (errorContext) {
    const context = errorContext.toLowerCase();
    if (context.includes('transcription') || context.includes('speech') || context.includes('whisper')) {
      selectedMessages = transcriptionRecoveryMessages;
    } else if (context.includes('ai') || context.includes('processing') || context.includes('completion')) {
      selectedMessages = aiProcessingRecoveryMessages;
    }
  }
  
  // Return a random recovery message for more natural variation
  const randomIndex = Math.floor(Math.random() * selectedMessages.length)
  const selectedMessage = selectedMessages[randomIndex];
  
  // Log recovery for monitoring purposes
  console.log('[🎯 RECOVERY SYSTEM] Generated recovery response:', selectedMessage.substring(0, 50) + '...');
  
  return selectedMessage;
}

export async function handleIncomingMessage(message: string, sessionId: string, businessId: string) {
  // Implementation for handling incoming messages
  return { response: 'AI response' }
}

// PROCESS MESSAGE WRAPPER START

// Define an input shape for the object-based variant
interface ProcessMessageInput {
  message: string
  conversationHistory: any[]
  businessId: string
  currentActiveFlow?: string | null
  callSid?: string
  channel?: 'VOICE' | 'CHAT'
}

// Overload signatures for better type safety
export function processMessage(params: ProcessMessageInput): ReturnType<typeof _processMessage>
export function processMessage(
  message: string,
  conversationHistory: any[],
  businessId: string,
  currentActiveFlow?: string | null,
  callSid?: string,
  channel?: 'VOICE' | 'CHAT'
): ReturnType<typeof _processMessage>

// Implementation accepting either variant
export function processMessage(...args: any[]): ReturnType<typeof _processMessage> {
  // Object-based variant
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    const {
      message,
      conversationHistory,
      businessId,
      currentActiveFlow = null,
      callSid,
      channel = 'VOICE'
    } = args[0] as ProcessMessageInput
    return _processMessage(message, conversationHistory, businessId, currentActiveFlow, callSid, channel)
  }

  // Positional-argument fallback (legacy support)
  const [
    message,
    conversationHistory,
    businessId,
    currentActiveFlow = null,
    callSid,
    channel = 'VOICE'
  ] = args as [string, any[], string, string | null | undefined, string | undefined, 'VOICE' | 'CHAT']

  return _processMessage(message, conversationHistory, businessId, currentActiveFlow, callSid, channel)
}

// PROCESS MESSAGE WRAPPER END