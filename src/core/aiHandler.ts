on data import { prisma } from '../services/db'
import { getChatCompletion, getEmbedding } from '../services/openai'
import { findRelevantKnowledge } from './ragService'
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from '../services/notificationService'
import { LeadCaptureQuestion, PlanTier } from '@prisma/client'
import VoiceSessionService from '../services/voiceSessionService'
import twilio from 'twilio'
import { requireAuth } from '../api/authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'

// Extend the LeadCaptureQuestion type to include isEssentialForEmergency
type ExtendedLeadCaptureQuestion = LeadCaptureQuestion & {
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
 * Creates a refined system prompt for natural voice interactions with strict business rules
 */
const createVoiceSystemPrompt = (businessName?: string, knowledgeContext?: string, leadCaptureQuestions?: any[]): string => {
  return `You are a professional AI Account Manager for ${businessName || 'this creative agency'}. Your ONLY goal is to serve clients and qualify leads on behalf of this specific agency. You are engaged in a REAL-TIME PHONE CONVERSATION with a human caller speaking directly into their phone.

**CRITICAL BUSINESS RULES - NO EXCEPTIONS:**

🏢 **AGENCY IDENTITY**: You work EXCLUSIVELY for ${businessName || 'this creative agency'}. NEVER offer to "find another agency" or suggest competitors. Your job is to help clients work with THIS agency only.

📚 **KNOWLEDGE BOUNDARIES**: You may ONLY use information from the "Knowledge Base Context" and "Project/Client Data" provided below. You must NEVER invent, assume, or use external knowledge about:
- Specific project details not provided in the sync data
- Client-specific billing information not explicitly provided
- Services not mentioned in your knowledge base
- Internal team schedules or availability
If information is not in your knowledge, you MUST say "I don't have that specific information right now, but I can connect you to our team or get a message to them."

🎯 **LEAD CAPTURE PROTOCOL**: When qualifying new leads, you MUST:
- Ask ONLY the pre-defined questions provided in the "Lead Capture Questions" section
- Ask them ONE AT A TIME in the specified order
- Do NOT rephrase unless absolutely necessary for clarity
- Give brief acknowledgments ("Got it", "Okay", "Perfect") then move to next question
- NEVER generate your own questions

🚫 **FORBIDDEN BEHAVIORS**:
- Do NOT restart conversations or repeat greetings mid-call
- Do NOT offer services from other agencies
- Do NOT invent project details or client-specific information
- Do NOT skip or rephrase lead capture questions
- Do NOT assume knowledge not provided to you

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
   - Show genuine interest in helping solve their needs

5. **PHONE CONVERSATION MASTERY:**
   - Always acknowledge what you heard before moving to next topic
   - Ask ONE clear question at a time - avoid multiple questions in one response
   - Confirm critical details by repeating them back
   - Use verbal signaling: "Okay", "Right", "I see" to show you're following
   - Provide clear next steps or endings
   - Keep responses under 30 seconds when spoken (roughly 75-100 words max)

**CRITICAL REMINDER:** You ARE the voice speaking live to a person on the phone. Every single word you generate will be spoken aloud immediately. There is no script, no narrator, no instructions - just natural human conversation through a phone call.

${knowledgeContext ? `

**KNOWLEDGE BASE CONTEXT:**
${knowledgeContext}

` : ''}${leadCaptureQuestions && leadCaptureQuestions.length > 0 ? `

**LEAD QUALIFICATION QUESTIONS (ask in this exact order):**
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
  try {
    console.log(`AI Handler processing message for business ${businessId}: "${message}"`)
    console.log('Received currentActiveFlow:', currentActiveFlow)
    
    // DEBUG: Log the received conversation history
    console.log('Received conversationHistory on backend:', JSON.stringify(conversationHistory, null, 2))

    // Fetch the Business record to get the planTier
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    })

    if (!business) {
      console.error(`Business not found for ID: ${businessId}. Cannot determine branding or agent config.`)
      return { 
        reply: "Sorry, I'm having trouble finding configuration for this business.",
        showBranding: true,
        nextAction: 'HANGUP'
      }
    }

    // Determine if branding should be shown
    const showBranding = business.planTier === 'PRO'
    console.log(`Business planTier: ${business.planTier}, Show Branding: ${showBranding}`)

    // Fetch agent configuration for persona and settings
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    // Client identification
    let isExistingClient = false
    let client: any = null
    let fromNumber: string | null = null

    if (callSid) {
      fromNumber = await getCallerId(callSid)
      if (fromNumber) {
        client = await prisma.client.findFirst({ 
          where: { 
            businessId,
            phone: fromNumber 
          }
        })
        if (client) {
          isExistingClient = true
          console.log(`[AI Handler] Identified existing client: ${client.name} (ID: ${client.id})`)
        }
      }
    }

    // Step 1: Intent Recognition (Modified)
    let intent: string
    let isEmergency = false
    if (currentActiveFlow?.startsWith('LEAD_CAPTURE') || currentActiveFlow?.startsWith('NEW_LEAD_QUALIFICATION')) {
      intent = 'NEW_LEAD_QUALIFICATION'
      console.log('Continuing NEW_LEAD_QUALIFICATION flow based on state.')
    } else if (currentActiveFlow?.startsWith('FAQ_CLARIFYING') || currentActiveFlow?.startsWith('CLIENT_FAQ_CLARIFYING')) {
      intent = 'CLIENT_FAQ'
      console.log('Continuing CLIENT_FAQ flow after clarification.')
    } else if (currentActiveFlow === 'PROJECT_STATUS_CLARIFYING') {
      intent = 'PROJECT_STATUS_INQUIRY'
      console.log('Continuing PROJECT_STATUS_INQUIRY flow after clarification.')
    } else if (currentActiveFlow === 'EMERGENCY_ESCALATION_OFFER') {
      // Handle user's choice from emergency escalation offer
      const choiceResponse = await getChatCompletion(
        `The user was offered emergency escalation. User's response: "${message}"
        Does the user want IMMEDIATE ESCALATION or QUICK QUESTIONS?
        Respond with only: IMMEDIATE or QUESTIONS`,
        "You are an escalation preference detection expert."
      )
      const userChoice = cleanVoiceResponse(choiceResponse || 'QUESTIONS').trim().toUpperCase()
      intent = userChoice === 'IMMEDIATE' ? 'EMERGENCY' : 'NEW_LEAD_QUALIFICATION'
    } else {
      // Primary intent detection based on user message and client status
      const intentPrompt = `Analyze the user's message and classify their intent for a creative agency.

      ${isExistingClient ? `**THIS CALL IS FROM AN EXISTING CLIENT (${client?.name || 'Unknown Client'}).**` : `**THIS CALL IS FROM A POTENTIAL NEW CLIENT.**`}

      Possible Intents:
      - **NEW_LEAD_QUALIFICATION**: User is asking for new services, pricing, consultations, or expressing a new project need.
      - **PROJECT_STATUS_INQUIRY**: User is an existing client asking for an update on an ongoing project (e.g., "What's the status of my website?", "How's the branding project going?"). (Only for existing clients)
      - **CLIENT_FAQ**: User is an existing client asking general questions about the agency (e.g., "How do I submit feedback?", "What's your billing cycle?", "Where can I find my invoices?"). (Only for existing clients)
      - **AGENCY_GENERAL_FAQ**: User (new or existing) asking general questions about the agency that are not project-specific (e.g., "What services do you offer?", "What are your office hours?").
      - **END_CALL**: User indicates they want to end the call.
      - **OTHER**: Greetings, thank you messages, unclear, or off-topic messages.

      User message: '${message}'
      Recent history: ${JSON.stringify(conversationHistory.slice(-3))}

      Classify as: NEW_LEAD_QUALIFICATION, PROJECT_STATUS_INQUIRY, CLIENT_FAQ, AGENCY_GENERAL_FAQ, END_CALL, or OTHER`

      const intentResponse = await getChatCompletion(
        intentPrompt,
        "You are an intent classification expert for a creative agency. Respond with only: NEW_LEAD_QUALIFICATION, PROJECT_STATUS_INQUIRY, CLIENT_FAQ, AGENCY_GENERAL_FAQ, END_CALL, or OTHER."
      )
      intent = cleanVoiceResponse(intentResponse || 'OTHER').trim().toUpperCase()
    }
    isEmergency = intent === 'EMERGENCY'
    console.log(`Effective intent: ${intent}  (isEmergency: ${isEmergency})`)

    // Step 2: Route based on intent and plan tier
    if (intent === 'PROJECT_STATUS_INQUIRY') {
      console.log('Entering PROJECT_STATUS_INQUIRY flow...')
      if (!isExistingClient) {
        return {
          reply: "I can help with project status updates for existing clients. Are you an existing client, or are you looking to start a new project?",
          currentFlow: null,
          showBranding,
          nextAction: determineNextVoiceAction('OTHER', null)
        }
      }
      if (business.planTier !== 'ENTERPRISE') {
        return {
          reply: `Project status inquiries are available on our ENTERPRISE plan. Would you like me to take your details to have someone from our team provide an update?`,
          currentFlow: 'NEW_LEAD_QUALIFICATION',
          showBranding,
          nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
        }
      }

      const projectQueryPrompt = `The client (${client?.name}) is asking about a project. What specific project are they asking about? If unclear, ask a clarifying question.
      Client message: "${message}"
      Respond with only the project name (e.g., "Website Redesign") or "UNCLEAR" if you cannot determine the project.`
      const projectName = cleanVoiceResponse(await getChatCompletion(projectQueryPrompt, "You are a project name extraction expert.") || '')

      if (projectName === 'UNCLEAR' || !projectName) {
        return {
          reply: "I'm not sure how to help with that. Would you like me to connect you with our team?",
          currentFlow: 'NEW_LEAD_QUALIFICATION',
          showBranding,
          nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
        }
      }

      const projects = await prisma.project.findMany({
        where: { 
          clientId: client?.id, 
          name: { contains: projectName, mode: 'insensitive' } 
        },
        orderBy: { lastSyncedAt: 'desc' }
      })

      if (projects.length > 0) {
        const project = projects[0] // Take the most recent or best match
        return {
          reply: `Okay, for your project "${project.name}", the current status is: "${project.status}". The last update was on ${new Date(project.lastSyncedAt!).toLocaleDateString()}. Is there anything else I can help with regarding this project?`,
          currentFlow: null,
          showBranding,
          nextAction: determineNextVoiceAction('PROJECT_STATUS_INQUIRY', null)
        }
      } else {
        return {
          reply: `I couldn't find a project named "${projectName}". Could you please confirm the project name, or describe it briefly?`,
          currentFlow: 'PROJECT_STATUS_CLARIFYING',
          showBranding,
          nextAction: determineNextVoiceAction('PROJECT_STATUS_INQUIRY', 'PROJECT_STATUS_CLARIFYING')
        }
      }
    } else if (intent === 'CLIENT_FAQ') {
      console.log('Entering CLIENT_FAQ flow...')
      if (!isExistingClient) {
        return {
          reply: "I can answer general questions about our agency. What would you like to know?",
          currentFlow: null,
          showBranding,
          nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
        }
      }
      if (business.planTier !== 'ENTERPRISE') {
        return {
          reply: `Client-specific FAQs are available on our ENTERPRISE plan. I can answer general questions about our agency's services. What would you like to know?`,
          currentFlow: 'AGENCY_GENERAL_FAQ',
          showBranding,
          nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
        }
      }

      // Use RAG to answer client-specific FAQs from knowledge base
      const relevantKnowledge = await findRelevantKnowledge(message, businessId, 3)
      if (relevantKnowledge.length > 0) {
        const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n')
        const voiceSystemPrompt = createVoiceSystemPrompt(business.name, contextSnippets, undefined)
        const faqUserPrompt = `Based on the following context, answer the client's question naturally and conversationally. Focus on providing helpful information relevant to an agency client.
        Context: ${contextSnippets}
        Client's Question: ${message}`
        const rawResponse = await getChatCompletion(faqUserPrompt, voiceSystemPrompt)
        const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null
        return {
          reply: cleanedResponse || "I'm having trouble finding that specific information. Could you rephrase your question?",
          currentFlow: null,
          showBranding,
          nextAction: determineNextVoiceAction('CLIENT_FAQ', null)
        }
      } else {
        return {
          reply: "I couldn't find a specific answer to that in our client knowledge base. Can I get a message to our team to follow up with you on this?",
          currentFlow: 'NEW_LEAD_QUALIFICATION',
          showBranding,
          nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
        }
      }
    } else if (intent === 'NEW_LEAD_QUALIFICATION') {
      // ... (existing lead capture logic remains)
      // ... (keep the rest of the function as is)
    } else if (intent === 'AGENCY_GENERAL_FAQ') {
      // Similar to CLIENT_FAQ but for general agency questions accessible to all tiers
      console.log('Entering AGENCY_GENERAL_FAQ flow...')
      const relevantKnowledge = await findRelevantKnowledge(message, businessId, 3)
      if (relevantKnowledge.length > 0) {
        const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n')
        const voiceSystemPrompt = createVoiceSystemPrompt(business.name, contextSnippets, undefined)
        const faqUserPrompt = `Based on the following context, answer the user's question naturally and conversationally. Focus on providing helpful information about our agency.
        Context: ${contextSnippets}
        User's Question: ${message}`
        const rawResponse = await getChatCompletion(faqUserPrompt, voiceSystemPrompt)
        const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null
        return {
          reply: cleanedResponse || "I'm having trouble finding that specific information. Could you rephrase your question?",
          currentFlow: null,
          showBranding,
          nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
        }
      } else {
        return {
          reply: "I couldn't find a specific answer to that in our agency knowledge base. Can I get a message to our team to follow up with you on this?",
          currentFlow: 'NEW_LEAD_QUALIFICATION',
          showBranding,
          nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
        }
      }
    }
  } catch (error) {
    console.error('Error in processMessage:', error)
    return {
      reply: "I apologize, but I'm having trouble processing your request right now. Please try again later or contact our team directly.",
      currentFlow: null,
      showBranding: true,
      nextAction: 'HANGUP'
    }
  }
  
  // Default return if no other conditions are met
  return {
    reply: "I'm not sure how to help with that. Would you like me to connect you with our team?",
    currentFlow: 'NEW_LEAD_QUALIFICATION',
    showBranding: true,
    nextAction: 'CONTINUE'
  }
}

/**
 * Generate a graceful, empathetic recovery response for critical voice processing errors
 * This function provides a human-like response when the main AI processing fails
 */
export const generateRecoveryResponse = (): string => {
  const recoveryMessages = [
    "I do apologize, it seems I'm experiencing a technical issue with my connection right now. I can still take a message for the team if you'd like.",
    "I'm sorry, I seem to be having some technical difficulties at the moment. Would you like to leave a message for someone to call you back?",
    "My apologies - I'm experiencing a brief technical issue. I can take down your information so our team can reach out to you directly.",
    "I'm sorry about that, I seem to be having a connection problem right now. I can still help by taking your details for a callback if that would be helpful."
  ]
  
  // Return a random recovery message for more natural variation
  const randomIndex = Math.floor(Math.random() * recoveryMessages.length)
  return recoveryMessages[randomIndex]
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