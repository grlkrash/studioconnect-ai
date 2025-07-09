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
import { detectProjectType, ProjectType } from '../utils/projectTypeClassifier'

/**
 * 🎯 BULLETPROOF FORTUNE 500 AI HANDLER 🎯
 * Enhanced for multi-turn conversations and enterprise-grade reliability
 */

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

// Insert after ExtendedLeadCaptureQuestion type definition
const DEFAULT_QUESTION_SETS: Record<ProjectType, ExtendedLeadCaptureQuestion[]> = {
  BRANDING: [
    { questionText: 'What is the name of your brand or product?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'brandName', isEssentialForEmergency: false },
    { questionText: 'Do you have existing brand guidelines?', expectedFormat: 'TEXT', order: 2, isRequired: true, mapsToLeadField: 'brandGuidelines', isEssentialForEmergency: false },
    { questionText: 'What timeline are you aiming for this branding project?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'timeline', isEssentialForEmergency: false },
    { questionText: 'To help us scope this correctly, what is the approximate budget for this project?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ],
  DESIGN: [
    { questionText: 'Which design deliverables are you looking for (e.g., website, app, print)?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'designDeliverables', isEssentialForEmergency: false },
    { questionText: 'Do you have wireframes or content ready?', expectedFormat: 'TEXT', order: 2, isRequired: false, mapsToLeadField: 'wireframes', isEssentialForEmergency: false },
    { questionText: 'What is your preferred timeline?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'timeline', isEssentialForEmergency: false },
    { questionText: 'To ensure we align on the scope, what is the budget you have allocated for these deliverables?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ],
  MARKETING: [
    { questionText: 'Which channels are you focusing on (social, email, paid ads, etc.)?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'channels', isEssentialForEmergency: false },
    { questionText: 'What is the main goal of this campaign?', expectedFormat: 'TEXT', order: 2, isRequired: true, mapsToLeadField: 'campaignGoal', isEssentialForEmergency: false },
    { questionText: 'What is your desired launch date?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'timeline', isEssentialForEmergency: false },
    { questionText: 'What is the planned budget for this marketing campaign?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ],
  PRODUCTION: [
    { questionText: 'Are you looking for video, photo, or animation production?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'productionType', isEssentialForEmergency: false },
    { questionText: 'Do you have a script or storyboard?', expectedFormat: 'TEXT', order: 2, isRequired: false, mapsToLeadField: 'script', isEssentialForEmergency: false },
    { questionText: 'What is your target delivery date?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'timeline', isEssentialForEmergency: false },
    { questionText: 'What is the budget for this production?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ],
  EVENTS: [
    { questionText: 'What type of event are you planning?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'eventType', isEssentialForEmergency: false },
    { questionText: 'What is the expected date of the event?', expectedFormat: 'TEXT', order: 2, isRequired: true, mapsToLeadField: 'eventDate', isEssentialForEmergency: false },
    { questionText: 'Approximately how many attendees are expected?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'attendees', isEssentialForEmergency: false },
    { questionText: 'What is the overall budget you are working with for this event?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ],
  OTHER: [
    { questionText: 'Could you briefly describe the project you have in mind?', expectedFormat: 'TEXT', order: 1, isRequired: true, mapsToLeadField: 'projectDescription', isEssentialForEmergency: false },
    { questionText: 'What is the primary goal you hope to achieve with this project?', expectedFormat: 'TEXT', order: 2, isRequired: true, mapsToLeadField: 'campaignGoal', isEssentialForEmergency: false },
    { questionText: 'What is your ideal timeline or deadline?', expectedFormat: 'TEXT', order: 3, isRequired: false, mapsToLeadField: 'timeline', isEssentialForEmergency: false },
    { questionText: 'And finally, what is the approximate budget you have in mind for this?', expectedFormat: 'TEXT', order: 4, isRequired: false, mapsToLeadField: 'budget', isEssentialForEmergency: false }
  ]
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
  const business = businessName || 'this creative agency';
  
  return `You are a professional AI account manager for ${business}. You're having a real phone conversation with a client or prospect.

CORE ROLE & RESPONSIBILITIES:
- Answer questions about projects, services, and creative work with expertise
- Provide real-time project status updates and timeline information
- Help clients with billing, invoicing, and payment questions
- Qualify new prospects by understanding their creative needs and budget
- Connect people to the right team members when needed
- Handle urgent requests and emergency escalations professionally

COMMUNICATION STYLE:
- Speak naturally and conversationally like a helpful colleague
- Keep responses brief and engaging (1-2 sentences typically)
- Use brief acknowledgments like "Got it," "Perfect," or "Absolutely"
- Ask clarifying questions when you need more information
- Be warm, professional, and solution-focused
- Never give empty responses or refuse to help

KEY CONVERSATION PATTERNS:
- For project inquiries: "Let me check on that project for you. Which specific project are you asking about?"
- For status updates: "I can help you with that status update. What's the project name or reference number?"
- For urgent matters: "I understand this is urgent. Let me get you connected to the right person immediately."
- For billing questions: "I can help with billing information. What specifically do you need assistance with?"

${context ? `\nBUSINESS CONTEXT:\n${context}` : ''}

${personaPrompt ? `\nPERSONALITY & EXPERTISE:\n${personaPrompt}` : ''}

CRITICAL: Always provide a helpful, conversational response. If you're unsure about specific details, say "Let me connect you with someone who has those exact details" rather than giving no response. Keep the conversation flowing naturally.`
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
  currentActiveFlow: string | null = null,
  projectId: string | null = null,
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
    const kbWhere: any = { businessId: business.id }
    if (projectId) kbWhere.projectId = projectId

    const knowledgeBaseEntries = await prisma.knowledgeBase.findMany({
      where: kbWhere,
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

    const detectedProjectType: ProjectType = detectProjectType(message)
    let leadCaptureQuestions: any[] = []
    if (detectedProjectType !== 'OTHER') {
      leadCaptureQuestions = DEFAULT_QUESTION_SETS[detectedProjectType]
    } else if (business.agentConfig?.questions && business.agentConfig.questions.length) {
      leadCaptureQuestions = business.agentConfig.questions
    }

    // 🎯 BUILD BULLETPROOF CONVERSATION CONTEXT 🎯
    const conversationContext = {
      businessName: business.name,
      criticalTopics: [],
      lastInteractionType: 'inquiry' as const
    };

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

    // 🎯 BULLETPROOF PROJECT STATUS INTELLIGENCE - FORTUNE 50 QUALITY 🎯
    try {
      const projectStatusResult = await getProjectStatusIntelligence(message, businessId);
      if (projectStatusResult) {
        console.log(`[🎯 PROJECT INTELLIGENCE] ✅ Handled project status inquiry: ${projectStatusResult.projectFound ? 'Found' : 'Not found'}`);
        return { 
          reply: projectStatusResult.reply, 
          currentFlow: currentActiveFlow || null, 
          nextAction: 'CONTINUE' 
        };
      }
    } catch (projectErr) {
      console.warn('[🎯 PROJECT INTELLIGENCE] ⚠️ Project status intelligence failed, falling back to LLM:', projectErr);
    }

    // 🎯 BULLETPROOF AI RESPONSE GENERATION - FORTUNE 50 QUALITY 🎯
    console.log('[🎯 AI HANDLER] 🧠 Generating AI response with bulletproof system...')
    
    let aiResponse: string | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    // Try multiple times to get a valid response
    while ((!aiResponse || aiResponse.trim().length === 0) && attempts < maxAttempts) {
      attempts++;
      console.log(`[🎯 AI HANDLER] 🔄 AI generation attempt ${attempts}/${maxAttempts}`);
      
      try {
        const rawResponse = await getChatCompletion([
          { role: 'system', content: systemMessage },
          ...finalHistory,
          { role: 'user', content: message }
        ]);
        
        if (rawResponse && rawResponse.trim().length > 0) {
          aiResponse = rawResponse;
          console.log(`[🎯 AI HANDLER] ✅ AI response generated successfully on attempt ${attempts}: "${aiResponse.substring(0, 100)}..."`);
          break;
        } else {
          console.warn(`[🎯 AI HANDLER] ⚠️ Empty AI response on attempt ${attempts}, retrying...`);
        }
      } catch (aiError) {
        console.error(`[🎯 AI HANDLER] ❌ AI generation attempt ${attempts} failed:`, aiError);
        
        if (attempts === maxAttempts) {
          // Final fallback - create a contextual response based on the message
          const lowerMsg = message.toLowerCase();
          if (lowerMsg.includes('project') || lowerMsg.includes('status')) {
            aiResponse = "Let me help you with your project. Could you tell me which project you're asking about?";
          } else if (lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('quote')) {
            aiResponse = "I'd be happy to help with pricing information. Let me connect you with someone who can provide detailed quotes.";
          } else if (lowerMsg.includes('timeline') || lowerMsg.includes('deadline') || lowerMsg.includes('when')) {
            aiResponse = "Great question about timing. Let me get you connected with our project team for specific timeline details.";
          } else {
            aiResponse = "I'm here to help with your creative project needs. What can I assist you with today?";
          }
          console.log(`[🎯 AI HANDLER] 🛡️ Using contextual fallback response: "${aiResponse}"`);
        }
      }
    }
    
    // Final safety check - ensure we ALWAYS have a response
    if (!aiResponse || aiResponse.trim().length === 0) {
      aiResponse = "Thank you for calling. How can I help you with your creative project today?";
      console.log(`[🎯 AI HANDLER] 🚨 Emergency fallback activated: "${aiResponse}"`);
    }

    const reply = cleanVoiceResponse(aiResponse)
    
    // Additional safety check after cleaning
    if (!reply || reply.trim().length === 0) {
      const emergencyReply = "I'm here to help. What can I assist you with?";
      console.log(`[🎯 AI HANDLER] 🚨 Post-cleaning emergency fallback: "${emergencyReply}"`);
      return {
        reply: emergencyReply,
        currentFlow: currentActiveFlow,
        nextAction: 'CONTINUE',
      };
    }

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
  projectId?: string | null
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
  projectId?: string | null,
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
      projectId = null,
      callSid,
      channel = 'VOICE'
    } = args[0] as ProcessMessageInput
    return _processMessage(message, conversationHistory, businessId, currentActiveFlow, projectId, callSid, channel)
  }

  // Positional-argument fallback (legacy support)
  const [
    message,
    conversationHistory,
    businessId,
    currentActiveFlow = null,
    projectId = null,
    callSid,
    channel = 'VOICE'
  ] = args as [string, any[], string, string | null | undefined, string | null | undefined, string | undefined, 'VOICE' | 'CHAT']

  return _processMessage(message, conversationHistory, businessId, currentActiveFlow, projectId, callSid, channel)
}

// PROCESS MESSAGE WRAPPER END

/**
 * 🎯 BULLETPROOF ENTERPRISE PROJECT STATUS INTELLIGENCE 🎯
 * Provides real-time project status updates with Fortune 50 quality responses
 */
export async function getProjectStatusIntelligence(
  message: string, 
  businessId: string
): Promise<{ reply: string; projectFound: boolean } | null> {
  if (!businessId) return null;

  try {
    // 🚨 CRITICAL FIX: Check if PM integrations are actually working
    const activeIntegrations = await prisma.integration.findMany({
      where: {
        businessId,
        isEnabled: true,
        syncStatus: 'CONNECTED'
      }
    });

    console.log(`[🎯 PROJECT INTELLIGENCE] Active integrations: ${activeIntegrations.length}`);

    // If no active integrations, don't attempt project lookups
    if (activeIntegrations.length === 0) {
      console.log(`[🎯 PROJECT INTELLIGENCE] No active PM integrations - being honest about limitations`);
      return {
        reply: "I don't currently have access to live project management data. Our project management integrations are still being set up. Let me connect you with your project manager who can provide you with detailed, up-to-date project status information right away.",
        projectFound: false
      };
    }

    // 🎯 ENHANCED PROJECT STATUS DETECTION PATTERNS 🎯
    const statusPatterns = [
      // Direct status inquiries
      /(status|update|progress|where\s+(are\s+)?we|how\s+is|what'?s\s+the\s+status)\s+(of|on|for|with)?\s*(.{3,})/i,
      
      // Project-specific inquiries
      /(can\s+you\s+)?((check|give\s+me|tell\s+me|provide)\s+)?(an?\s+)?(update|status|progress)\s+(on|for|about|regarding)\s*(.{3,})/i,
      
      // Timeline inquiries
      /(when\s+(will|is)|timeline\s+for|eta\s+for|deadline\s+for)\s*(.{3,})/i,
      
      // Completion inquiries
      /(is|has)\s+(.{3,})\s+(done|finished|completed|ready)/i,
      
      // Generic project references
      /(project|campaign|website|logo|branding|design)\s+(.{3,})/i
    ];

    let projectQuery = '';
    let matchType = '';

    // Find the best pattern match
    for (const pattern of statusPatterns) {
      const match = message.match(pattern);
      if (match) {
        // Extract the most relevant capture group
        const captures = match.slice(1).filter(cap => cap && cap.trim().length > 2);
        if (captures.length > 0) {
          projectQuery = captures[captures.length - 1].trim();
          matchType = pattern.toString().includes('timeline|eta|deadline') ? 'timeline' : 'status';
          break;
        }
      }
    }

    if (!projectQuery) return null;

    // Clean up the project query
    projectQuery = projectQuery
      .replace(/\b(project|the|a|an|is|are|was|were|been|being|be|have|has|had|will|would|could|should|may|might|can|shall|must|status|update|progress|done|finished|completed|ready)\b/gi, '')
      .replace(/[^\w\s-']/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (projectQuery.length < 2) return null;

    console.log(`[🎯 PROJECT INTELLIGENCE] Searching for project: "${projectQuery}" (type: ${matchType})`);

    // 🎯 INTELLIGENT PROJECT SEARCH WITH MULTIPLE STRATEGIES 🎯
    
    // Only search projects that have been synced from PM tools AND have recent sync data
    let project = await prisma.project.findFirst({
      where: {
        businessId,
        name: { equals: projectQuery, mode: 'insensitive' },
        pmToolId: { not: null }, // Only projects from PM tools
        lastSyncedAt: { not: null } // Only recently synced projects
      },
      select: { 
        id: true, name: true, status: true, details: true, 
        assignee: true, dueDate: true, lastSyncedAt: true, pmTool: true,
        client: { select: { name: true } }
      }
    });

    // Strategy 2: Contains match with word boundaries
    if (!project) {
      project = await prisma.project.findFirst({
        where: {
          businessId,
          name: { contains: projectQuery, mode: 'insensitive' },
          pmToolId: { not: null },
          lastSyncedAt: { not: null }
        },
        select: { 
          id: true, name: true, status: true, details: true, 
          assignee: true, dueDate: true, lastSyncedAt: true, pmTool: true,
          client: { select: { name: true } }
        }
      });
    }

    // Strategy 3: Word-by-word fuzzy matching
    if (!project && projectQuery.includes(' ')) {
      const words = projectQuery.split(' ').filter(w => w.length > 2);
      if (words.length > 0) {
        const wordConditions = words.map(word => ({
          name: { contains: word, mode: 'insensitive' as const }
        }));

        project = await prisma.project.findFirst({
          where: {
            businessId,
            OR: wordConditions,
            pmToolId: { not: null },
            lastSyncedAt: { not: null }
          },
          select: { 
            id: true, name: true, status: true, details: true, 
            assignee: true, dueDate: true, lastSyncedAt: true, pmTool: true,
            client: { select: { name: true } }
          }
        });
      }
    }

    if (!project) {
      console.log(`[🎯 PROJECT INTELLIGENCE] No synced project found for: "${projectQuery}"`);
      
      // Check if there are any synced projects at all
      const syncedProjects = await prisma.project.findMany({
        where: { 
          businessId,
          pmToolId: { not: null },
          lastSyncedAt: { not: null }
        },
        select: { name: true, status: true, pmTool: true },
        orderBy: { lastSyncedAt: 'desc' },
        take: 5
      });

      if (syncedProjects.length > 0) {
        const projectList = syncedProjects
          .map(p => `• ${p.name} (${p.status?.toLowerCase().replace(/_/g, ' ') || 'active'}) - ${p.pmTool || 'PM Tool'}`)
          .join('\n');
        
        return {
          reply: `I couldn't find a project matching "${projectQuery}" in our connected project management tools. Here are your current projects:\n\n${projectList}\n\nCould you please specify which project you'd like an update on, or would you like me to connect you with your project manager?`,
          projectFound: false
        };
      } else {
        return {
          reply: `I don't have access to current project data at the moment. This could be because our project management integration is still syncing, or there may be a temporary connection issue. Let me connect you with your project manager who can provide you with the most up-to-date project information.`,
          projectFound: false
        };
      }
    }

    // 🚨 CRITICAL: Check if project data is recent (within last 24 hours)
    const lastSync = project.lastSyncedAt ? new Date(project.lastSyncedAt) : null;
    const isStale = !lastSync || (Date.now() - lastSync.getTime()) > 24 * 60 * 60 * 1000;

    if (isStale) {
      console.log(`[🎯 PROJECT INTELLIGENCE] Project data is stale, attempting refresh...`);
      
      try {
        await refreshProjectStatus(project.id);
        
        // Re-fetch updated project data
        const updatedProject = await prisma.project.findUnique({
          where: { id: project.id },
          select: { 
            id: true, name: true, status: true, details: true, 
            assignee: true, dueDate: true, lastSyncedAt: true, pmTool: true,
            client: { select: { name: true } }
          }
        });
        
        if (updatedProject) {
          project = updatedProject;
          console.log(`[🎯 PROJECT INTELLIGENCE] ✅ Successfully refreshed project data`);
        }
      } catch (refreshError) {
        console.warn('[🎯 PROJECT INTELLIGENCE] Could not refresh project status:', refreshError);
        
        // If refresh fails and data is very stale, be honest about it
        if (isStale) {
          return {
            reply: `I found the project "${project.name}" but the information may not be current due to a sync issue with our project management system. Let me connect you with your project manager who can provide you with the most up-to-date status.`,
            projectFound: true
          };
        }
      }
    }

    // 🎯 GENERATE VERIFIED STATUS RESPONSE 🎯
    const statusText = project.status?.toLowerCase().replace(/_/g, ' ') || 'in progress';
    const projectName = project.name;
    const clientName = project.client?.name;
    const pmTool = project.pmTool || 'project management system';
    
    let response = '';
    
    // Contextual response based on match type
    if (matchType === 'timeline') {
      response = `Based on our ${pmTool} data, here's the timeline for ${projectName}`;
    } else {
      response = `According to our ${pmTool} integration, here's the current status of ${projectName}`;
    }
    
    if (clientName) {
      response += ` for ${clientName}`;
    }
    
    response += `:\n\n`;
    
    // Status information
    response += `📊 **Status:** ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}\n`;
    
    // Assignee information
    if (project.assignee) {
      response += `👤 **Assigned to:** ${project.assignee}\n`;
    }
    
    // Due date information
    if (project.dueDate) {
      const dueDate = new Date(project.dueDate);
      const now = new Date();
      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
      
      response += `📅 **Due Date:** ${dueDate.toLocaleDateString()}`;
      if (daysDiff > 0) {
        response += ` (${daysDiff} days remaining)`;
      } else if (daysDiff === 0) {
        response += ` (due today)`;
      } else {
        response += ` (${Math.abs(daysDiff)} days overdue)`;
      }
      response += `\n`;
    }
    
    // Latest details
    if (project.details && project.details.trim()) {
      response += `📝 **Latest Update:** ${project.details}\n`;
    }
    
    // Last sync information with honesty about data freshness
    if (project.lastSyncedAt) {
      const syncDate = new Date(project.lastSyncedAt);
      const syncAgo = Math.round((Date.now() - syncDate.getTime()) / (1000 * 60));
      if (syncAgo < 60) {
        response += `\n*Data synced from ${pmTool} ${syncAgo} minutes ago*`;
      } else if (syncAgo < 1440) { // Less than 24 hours
        response += `\n*Data synced from ${pmTool} ${Math.round(syncAgo / 60)} hours ago*`;
      } else {
        response += `\n*Data synced from ${pmTool} ${Math.round(syncAgo / 1440)} days ago - let me connect you with your project manager for the latest updates*`;
      }
    }
    
    // Professional closing
    response += `\n\nWould you like me to connect you with your project manager for more detailed information, or is there anything specific about this project I can help you with?`;

    console.log(`[🎯 PROJECT INTELLIGENCE] ✅ Generated verified status response for project: ${projectName}`);
    
    return {
      reply: response,
      projectFound: true
    };

  } catch (error) {
    console.error('[🎯 PROJECT INTELLIGENCE] ❌ Error in project status intelligence:', error);
    return {
      reply: 'I apologize, but I\'m having trouble accessing our project management system at the moment. Let me connect you with your project manager who can provide you with a detailed status update right away.',
      projectFound: false
    };
  }
}