import { prisma } from '../services/db'
import { getChatCompletion, getEmbedding } from '../services/openai'
import { findRelevantKnowledge } from './ragService'
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from '../services/notificationService'
import { LeadCaptureQuestion, PlanTier } from '@prisma/client'
import VoiceSessionService from '../services/voiceSessionService'

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

/**
 * Creates a refined system prompt for natural voice interactions with strict business rules
 */
const createVoiceSystemPrompt = (businessName?: string, knowledgeContext?: string, leadCaptureQuestions?: any[]): string => {
  return `You are a professional AI receptionist for ${businessName || 'this business'}. Your ONLY goal is to serve callers on behalf of this specific business. You are engaged in a REAL-TIME PHONE CONVERSATION with a human caller speaking directly into their phone.

**CRITICAL BUSINESS RULES - NO EXCEPTIONS:**

🏢 **BUSINESS IDENTITY**: You work EXCLUSIVELY for ${businessName || 'this business'}. NEVER offer to "find another service provider" or suggest competitors. Your job is to help customers work with THIS business only.

📚 **KNOWLEDGE BOUNDARIES**: You may ONLY use information from the "Knowledge Base Context" provided below. You must NEVER invent, assume, or use external knowledge about:
- Product brands, models, or specifications
- Pricing information not explicitly provided
- Services not mentioned in your knowledge base
- Availability or inventory details
If information is not in your knowledge base, you MUST say "I don't have that specific information available, but our team can help you with that."

🎯 **LEAD CAPTURE PROTOCOL**: When in lead capture mode, you MUST:
- Ask ONLY the pre-defined questions provided in the "Lead Capture Questions" section
- Ask them ONE AT A TIME in the specified order
- Do NOT rephrase unless absolutely necessary for clarity
- Give brief acknowledgments ("Got it", "Okay", "Perfect") then move to next question
- NEVER generate your own questions

🚫 **FORBIDDEN BEHAVIORS**:
- Do NOT restart conversations or repeat greetings mid-call
- Do NOT offer services from other companies
- Do NOT invent product details or specifications
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
   * **Natural Pauses:** \`<break time="300ms"/>\` between distinct thoughts (like taking a breath)
   * **Processing Pauses:** \`<break time="500ms"/>\` before important questions or after receiving complex information
   * **Gentle Emphasis:** \`<emphasis level="moderate">key information</emphasis>\` for critical details only
   * **Pronunciation:** \`<phoneme alphabet="ipa" ph="liːd">leads</phoneme>\` for sales leads vs "led"
   
   SSML Examples:
   - "Thanks for calling!<break time="300ms"/> How can I help you today?"
   - "I understand you need <emphasis level="moderate">emergency plumbing</emphasis>.<break time="400ms"/> What's happening exactly?"
   - "Let me get your <emphasis level="moderate">phone number</emphasis><break time="300ms"/> in case we get disconnected."

4. **HELPFUL & EMPATHETIC PERSONA:**
   - Begin responses with natural acknowledgments: "Absolutely", "Of course", "I understand", "Sure thing", "Got it"
   - Use empathetic language for problems: "That sounds frustrating", "I can understand why you'd be concerned"
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

**LEAD CAPTURE QUESTIONS (ask in this exact order):**
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
2. Offers immediate escalation to a live person
3. Provides assurance that help is coming
4. Asks if they want immediate escalation or to continue with quick questions

Keep it conversational and under 30 seconds when spoken. Use natural speech patterns.

Business name: ${businessName || 'our team'}`

    const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined)
    const aiResponse = await getChatCompletion(escalationPrompt, voiceSystemPrompt)
    
    return cleanVoiceResponse(aiResponse || 
      `I understand this is an emergency situation. I can either connect you directly to someone from our team right now, or quickly gather your details so they can respond immediately. What would you prefer?`
    )

  } catch (error) {
    console.error('Error generating emergency escalation offer:', error)
    return `I understand this is an emergency situation. I can either connect you directly to someone from our team right now, or quickly gather your details so they can respond immediately. What would you prefer?`
  }
}

/**
 * Main AI handler that processes user messages and determines the appropriate response flow.
 * Routes to either FAQ (RAG), Lead Capture, or fallback flow based on intent.
 */
export const processMessage = async (
  message: string,
  conversationHistory: any[],
  businessId: string,
  currentActiveFlow?: string | null,
  callSid?: string
): Promise<{ 
  reply: string; 
  currentFlow?: string | null; 
  showBranding?: boolean; 
  nextVoiceAction?: 'CONTINUE' | 'HANGUP' | 'TRANSFER' | 'VOICEMAIL';
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
        showBranding: true, // Default to showing branding if business not found
        nextVoiceAction: 'HANGUP'
      }
    }

    // Determine if branding should be shown
    // Show branding for FREE and BASIC tiers, hide for PRO
    const showBranding = business.planTier === PlanTier.FREE || business.planTier === PlanTier.BASIC
    console.log(`Business planTier: ${business.planTier}, Show Branding: ${showBranding}`)

    // Fetch agent configuration for persona and settings
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    // Helper function to determine next voice action based on intent and flow state
    const determineNextVoiceAction = (
      intent: string,
      currentFlow: string | null,
      isEndingCall: boolean = false
    ): 'CONTINUE' | 'HANGUP' | 'TRANSFER' | 'VOICEMAIL' => {
      // If explicitly ending the call
      if (isEndingCall || intent === 'END_CALL') {
        return 'HANGUP'
      }
      
      // If we have an active flow (lead capture, FAQ clarification), continue
      if (currentFlow !== null) {
        return 'CONTINUE'
      }
      
      // If it's FAQ response without follow-up needed, hang up
      if (intent === 'FAQ') {
        return 'HANGUP'
      }
      
      // If it's lead capture completion, hang up
      if (intent === 'LEAD_CAPTURE' && currentFlow === null) {
        return 'HANGUP'
      }
      
      // For other cases where we might want to continue conversation
      if (intent === 'LEAD_CAPTURE' || intent === 'OTHER') {
        return 'CONTINUE'
      }
      
      // Default to hanging up
      return 'HANGUP'
    }

    // Handle clarification flows first
    if (currentActiveFlow?.startsWith('FAQ_CLARIFYING')) {
      console.log('Handling FAQ clarification flow...')
      
      // Extract original question from flow state if needed
      const clarificationContext = "your previous question"
      
      // Check if the clarification response is now clear
      const isClarificationClear = await isResponseClear(
        message,
        "FAQ clarification",
        "providing a clearer version of your question"
      )
      
      if (!isClarificationClear) {
        // Still unclear - ask for clarification again or fall back
        const fallbackClarification = await generateClarifyingQuestion(
          message,
          "your question",
          "FAQ assistance",
          business.name
        )
        
        return {
          reply: fallbackClarification,
          currentFlow: 'FAQ_CLARIFYING',
          showBranding,
          nextVoiceAction: determineNextVoiceAction('FAQ', 'FAQ_CLARIFYING')
        }
      }
      
      // Now clear - proceed with FAQ flow using the clarified message
      console.log('Clarification received, proceeding with FAQ flow...')
      // Continue to FAQ processing below with the clarified message
    }
    
    if (currentActiveFlow?.startsWith('LEAD_CAPTURE_CLARIFYING')) {
      console.log('Handling Lead Capture clarification flow...')
      
      // Extract the question being clarified from the flow state
      const questionContext = currentActiveFlow.replace('LEAD_CAPTURE_CLARIFYING_', '')
      
      // Check if the clarification response is now clear
      const isClarificationClear = await isResponseClear(
        message,
        `clarification for ${questionContext}`,
        `providing a clear answer to the ${questionContext} question`
      )
      
      if (!isClarificationClear) {
        // Still unclear - try one more clarification or proceed anyway
        console.log('Clarification still unclear, proceeding with lead capture anyway')
      }
      
      // Proceed with lead capture flow using the clarified (or best-effort) response
      console.log('Clarification received, continuing lead capture flow...')
      // Set flow back to LEAD_CAPTURE to continue the process
      currentActiveFlow = 'LEAD_CAPTURE'
    }
    
    // Handle emergency escalation response
    if (currentActiveFlow === 'EMERGENCY_ESCALATION_OFFER') {
      console.log('Handling emergency escalation response...')
      
      // Use AI to detect user's preference
      const escalationChoicePrompt = `The user was offered emergency escalation with this message:
      "I understand this is an emergency situation. I can either connect you directly to someone from our team right now, or quickly gather your details so they can respond immediately. What would you prefer?"

      User's response: "${message}"

      Does the user want IMMEDIATE ESCALATION (connect now) or QUICK QUESTIONS (gather details first)?

      Consider responses like:
      - IMMEDIATE: "connect me now", "yes connect me", "I need help now", "get someone on the line"
      - QUESTIONS: "quick questions", "gather details", "ask me questions", "collect my info", "that's fine"

      Respond with only: IMMEDIATE or QUESTIONS`
      
      const choiceResponse = await getChatCompletion(
        escalationChoicePrompt,
        "You are an escalation preference detection expert."
      )
      
      const userChoice = cleanVoiceResponse(choiceResponse || 'QUESTIONS').trim().toUpperCase()
      
      if (userChoice === 'IMMEDIATE') {
        console.log('User chose immediate escalation')
        
        return {
          reply: "Absolutely! I'm connecting you to our emergency line right now. Please hold while I transfer your call. Help is on the way!",
          currentFlow: null,
          showBranding,
          nextVoiceAction: 'TRANSFER' // This would need to be implemented in the voice system
        }
             } else {
         console.log('User chose to answer quick questions first')
         
         // Continue with emergency lead capture flow - we'll handle this in the lead capture section
         // by forcing the shouldForceLeadCapture flag
         console.log('Setting shouldForceLeadCapture to true for emergency escalation choice')
       }
    }

    // DEFENSIVE LOGIC: Detect if we should continue lead capture based on conversation history
    let shouldForceLeadCapture = false
    
    // Check if user just chose quick questions from emergency escalation
    if (currentActiveFlow === 'EMERGENCY_ESCALATION_OFFER') {
      shouldForceLeadCapture = true
      console.log('User chose quick questions from emergency escalation, forcing lead capture')
    } else if (!currentActiveFlow && conversationHistory.length > 0) {
      console.log('No currentActiveFlow provided, analyzing conversation history...')
      
      // Check if the last assistant message was a lead capture question
      const lastAssistantMessage = [...conversationHistory].reverse().find(msg => msg.role === 'assistant')
      if (lastAssistantMessage && agentConfig?.questions) {
        const isLastMessageLeadQuestion = agentConfig.questions.some(q => 
          q.questionText === lastAssistantMessage.content
        )
        
        if (isLastMessageLeadQuestion) {
          console.log('Last assistant message was a lead capture question, forcing lead capture continuation')
          shouldForceLeadCapture = true
        }
      }
      
      // Also check if we've asked multiple lead questions in this conversation
      if (!shouldForceLeadCapture && agentConfig?.questions) {
        let leadQuestionCount = 0
        for (const historyEntry of conversationHistory) {
          if (historyEntry.role === 'assistant') {
            const isLeadQuestion = agentConfig.questions.some(q => q.questionText === historyEntry.content)
            if (isLeadQuestion) {
              leadQuestionCount++
            }
          }
        }
        
        if (leadQuestionCount >= 2) {
          console.log(`Found ${leadQuestionCount} lead questions in history, forcing lead capture continuation`)
          shouldForceLeadCapture = true
        }
      }

      // Check if the last assistant message was an FAQ fallback offer and user responded positively
      if (!shouldForceLeadCapture && lastAssistantMessage) {
        const isFAQFallbackOffer = lastAssistantMessage.content.includes("I couldn't find a specific answer to that in my current knowledge") && 
                                  lastAssistantMessage.content.includes("Would you like me to take down your details")
        
        if (isFAQFallbackOffer) {
          console.log('Last message was FAQ fallback offer, checking user response...')
          
          // Use AI to detect positive intent more intelligently
          const intentCheckPrompt = `The user was asked: "Would you like me to take down your details so someone from our team can get back to you with the information you need?"

User's response: "${message}"

Does this response indicate they want to proceed with providing their details? Consider responses like:
- Explicit yes/agreement: "yes", "sure", "okay", "please do"  
- Implicit agreement: "that would be great", "sounds good", "go ahead"
- Conditional agreement: "yes, if you could", "that would be helpful"
- Questions showing interest: "what details do you need?", "how does that work?"

Respond with only YES or NO.`
          
          const isPositiveResponse = await getChatCompletion(
            intentCheckPrompt,
            "You are an intent detection expert focused on identifying user agreement to proceed with lead capture."
          )
          
          const cleanedPositiveResponse = cleanVoiceResponse(isPositiveResponse || 'NO')
          if (cleanedPositiveResponse.trim().toUpperCase() === 'YES') {
            console.log('User responded positively to FAQ fallback offer, transitioning to lead capture')
            shouldForceLeadCapture = true
          } else {
            console.log('User declined or responded negatively to FAQ fallback offer')
          }
        }
      }
    }

    // Step 1: Intent Recognition
    let intent: string
    if (currentActiveFlow === 'LEAD_CAPTURE' || shouldForceLeadCapture) {
      intent = 'LEAD_CAPTURE'
      console.log('Continuing LEAD_CAPTURE flow based on state or defensive logic.')
    } else if (currentActiveFlow?.startsWith('FAQ_CLARIFYING')) {
      intent = 'FAQ'
      console.log('Continuing FAQ flow after clarification.')
    } else {
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

END_CALL indicators (respond with END_CALL):
- User says 'goodbye', 'bye', 'that's all', 'nothing else'
- Expressions of completion: 'thanks, that's everything', 'I'm all set'
- Clear intent to end conversation: 'talk to you later', 'have a good day'
- Dismissive responses indicating they're done: 'okay thanks', 'alright'

OTHER indicators:
- Greetings, thank you messages
- Unclear or off-topic messages
- Follow-up clarifications without service intent

User message: '${message}'
Recent history: ${JSON.stringify(conversationHistory.slice(-3))}

Classify as: LEAD_CAPTURE, FAQ, END_CALL, or OTHER`
      
      const intentResponse = await getChatCompletion(
        intentPrompt,
        "You are an intent classification expert. Respond with only: FAQ, LEAD_CAPTURE, END_CALL, or OTHER."
      )
      const cleanedIntentResponse = cleanVoiceResponse(intentResponse || 'OTHER')
      intent = cleanedIntentResponse.trim().toUpperCase()
    }
    
    console.log(`Effective intent: ${intent}`)

    // Step 2: Route based on intent
    if (intent === 'FAQ') {
      // FAQ Flow - Use RAG to find relevant information
      console.log('Entering FAQ flow...')
      
      // Check if the user's question is clear enough for FAQ processing
      const isQuestionClear = await isResponseClear(
        message,
        "FAQ assistance",
        "asking a clear question that can be answered from our knowledge base"
      )
      
      if (!isQuestionClear) {
        console.log('User question is unclear, asking for clarification...')
        const clarifyingQuestion = await generateClarifyingQuestion(
          message,
          "your question",
          "FAQ assistance - helping you find information",
          business.name
        )
        
        return {
          reply: clarifyingQuestion,
          currentFlow: 'FAQ_CLARIFYING',
          showBranding,
          nextVoiceAction: determineNextVoiceAction('FAQ', 'FAQ_CLARIFYING')
        }
      }
      
      const relevantKnowledge = await findRelevantKnowledge(message, businessId, 3)
      
      if (relevantKnowledge && relevantKnowledge.length > 0) {
        // Found relevant snippets - construct context-aware response
        const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n')
        const voiceSystemPrompt = createVoiceSystemPrompt(business.name, contextSnippets, undefined)
        
        const faqUserPrompt = `Based on the following context, answer the user's question naturally and conversationally. Be helpful and engaging in your response. If the context doesn't provide a complete answer, politely say you don't have that specific information available.

Start your response with a natural interjection or acknowledgment and flow naturally into your answer.

Context:
${contextSnippets}

User's Question: ${message}`
        
        const rawResponse = await getChatCompletion(faqUserPrompt, voiceSystemPrompt)
        const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null
        
        return { 
          reply: cleanedResponse || "I'm having trouble accessing my knowledge base right now. Please try again later.",
          currentFlow: null,
          showBranding,
          nextVoiceAction: determineNextVoiceAction('FAQ', null)
        }
      } else {
        // No relevant knowledge found - offer to take details for follow-up
        console.log('No relevant knowledge found in FAQ flow - offering lead capture')
        return { 
          reply: "Hmm, I checked my information but couldn't find specific details on that. Would you like me to take down your contact information so someone from our team can get back to you with the answer you need?",
          currentFlow: null,
          showBranding,
          nextVoiceAction: 'CONTINUE' // Continue to see if they want to provide details
        }
      }
      
    } else if (intent === 'END_CALL') {
      console.log('Entering END_CALL flow...')
      return { 
        reply: "Thank you for contacting us! Have a great day and feel free to reach out anytime if you need assistance. Goodbye!",
        currentFlow: null,
        showBranding,
        nextVoiceAction: 'HANGUP'
      }
      
    } else if (intent === 'LEAD_CAPTURE') {
      // Lead Capture Flow - Guide through questions
      console.log('Entering Lead Capture flow...')
      
      // Extract the service of interest and save to session
      if (callSid) {
        try {
          console.log('Extracting service of interest from user message...')
          const serviceExtractionPrompt = `User message: "${message}". What is the primary service or product mentioned? Respond with only the service/product name, or "general inquiry" if none is found.`
          const serviceOfInterest = await getChatCompletion(
            serviceExtractionPrompt,
            "You are a service extraction expert. Extract only the main service or product mentioned."
          )
          
          const cleanedService = cleanVoiceResponse(serviceOfInterest || 'general inquiry')
          console.log(`Extracted service of interest: "${cleanedService}"`)
          
          // Get current session and update with service of interest
          const voiceSessionService = VoiceSessionService.getInstance()
          const session = await voiceSessionService.getVoiceSession(callSid)
          
          await voiceSessionService.updateDetailedFlow(callSid, {
            flowData: {
              ...session.detailedFlow.flowData,
              service_of_interest: cleanedService
            }
          })
          
          console.log(`Saved service of interest "${cleanedService}" to session ${callSid}`)
        } catch (error) {
          console.error('Error extracting/saving service of interest:', error)
        }
      }
      
      console.log('Agent config questions:', agentConfig?.questions?.map((q: LeadCaptureQuestion) => ({ id: q.id, text: q.questionText, order: q.order })))
      
      if (!agentConfig || !agentConfig.questions || agentConfig.questions.length === 0) {
        return { 
          reply: "It looks like our lead capture system isn't set up yet. How else can I assist?",
          currentFlow: null,
          showBranding,
          nextVoiceAction: 'CONTINUE'
        }
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
        const cleanedEmergencyResponse = cleanVoiceResponse(isEmergencyResponse || 'NO')
        isEmergency = cleanedEmergencyResponse.trim().toUpperCase() === 'YES'
        
        if (isEmergency) {
          console.log('Lead creation: Initial message WAS an EMERGENCY')
        } else {
          console.log('Lead creation: Initial message was NOT an emergency')
        }
      }

      // Determine which questions to ask based on emergency status
      let questionsToAsk = agentConfig.questions as ExtendedLeadCaptureQuestion[]
      if (isEmergency) {
        console.log("EMERGENCY DETECTED: Using smart question selection...")
        
        // Use smart question selection for emergencies
        questionsToAsk = await selectSmartEmergencyQuestions(
          firstUserMessage,
          agentConfig.questions as ExtendedLeadCaptureQuestion[],
          business.name
        )
        
        console.log(`Selected ${questionsToAsk.length} emergency questions:`, questionsToAsk.map(q => q.questionText))
        
        // Check if this is the first turn and it's an emergency - offer escalation for severe cases
        if (conversationHistory.length <= 2) { // First user message + potentially a greeting
          console.log('First emergency message detected, checking severity for escalation option...')
          
          // Check if user might want immediate escalation based on severity
          const severityCheckPrompt = `Emergency message: "${firstUserMessage}"
          
          Rate the severity of this emergency on a scale of 1-10:
          - 10: Life-threatening (fire, gas leak, electrical hazard)
          - 8-9: Property damage in progress (flooding, burst pipes)
          - 6-7: Urgent but contained (no heat, hot water, major appliance failure)
          - 4-5: Inconvenient but not urgent (minor leaks, clogs)
          - 1-3: Regular service requests
          
          Respond with only the number (1-10).`
          
          try {
            const severityResponse = await getChatCompletion(
              severityCheckPrompt,
              "You are an emergency severity assessment expert."
            )
            
            const severityScore = parseInt(cleanVoiceResponse(severityResponse || '5'))
            
            // For severe emergencies (8+), offer immediate escalation
            if (severityScore >= 8) {
              console.log(`High severity emergency detected (${severityScore}/10), offering immediate escalation`)
              
              const escalationOffer = await offerEmergencyEscalation(firstUserMessage, business.name)
              
              return {
                reply: escalationOffer,
                currentFlow: 'EMERGENCY_ESCALATION_OFFER',
                showBranding,
                nextVoiceAction: 'CONTINUE'
              }
            } else {
              console.log(`Moderate emergency (${severityScore}/10), proceeding with streamlined questions`)
            }
          } catch (error) {
            console.error('Error assessing emergency severity:', error)
            // Continue with normal emergency flow if assessment fails
          }
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
            
            // Check if the user's answer to this question was clear
            const isAnswerClear = await isResponseClear(
              nextEntry.content,
              `answer to: ${matchedQuestion.questionText}`,
              `providing a clear answer to the question about ${matchedQuestion.questionText.toLowerCase()}`
            )
            
            if (!isAnswerClear) {
              console.log(`Answer "${nextEntry.content}" to question "${matchedQuestion.questionText}" is unclear, asking for clarification`)
              
              const clarifyingQuestion = await generateClarifyingQuestion(
                nextEntry.content,
                matchedQuestion.questionText,
                "lead capture - collecting your information",
                business.name
              )
              
              // Create a flow state that indicates we're clarifying this specific question
              const clarificationFlow = `LEAD_CAPTURE_CLARIFYING_${matchedQuestion.questionText.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`
              
              return {
                reply: clarifyingQuestion,
                currentFlow: clarificationFlow,
                showBranding,
                nextVoiceAction: determineNextVoiceAction('LEAD_CAPTURE', clarificationFlow)
              }
            }
            
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
        // Check for saved context to make the agent more intelligent
        let contextualSystemPrompt = ""
        let hasServiceContext = false
        
        if (callSid) {
          try {
            const voiceSessionService = VoiceSessionService.getInstance()
            const session = await voiceSessionService.getVoiceSession(callSid)
            
            if (session.detailedFlow.flowData.service_of_interest) {
              contextualSystemPrompt = `CONTEXT: The user has already stated they are interested in '${session.detailedFlow.flowData.service_of_interest}'. You are now in a lead capture flow. Ask the next question from your list directly. Do not repeat the initial greeting or ask what they need help with again.`
              hasServiceContext = true
              console.log(`Using saved context for lead capture: ${session.detailedFlow.flowData.service_of_interest}`)
            }
          } catch (error) {
            console.error('Error retrieving session context for lead capture:', error)
          }
        }
        
        // Determine if this is a follow-up question by checking conversation history
        const assistantLeadQuestions = conversationHistory.filter(m => 
          m.role === 'assistant' && questionsToAsk.some(q => q.questionText === m.content)
        )
        
        // If we have service context, use AI to generate a more natural question flow
        if (hasServiceContext && contextualSystemPrompt) {
          const voiceSystemPrompt = createVoiceSystemPrompt(business.name, undefined, questionsToAsk)
          const enhancedSystemPrompt = `${voiceSystemPrompt}\n\n${contextualSystemPrompt}`
          
          const questionPrompt = `You need to ask the following question as part of the lead capture process: "${nextQuestion.questionText}"

${assistantLeadQuestions.length > 0 ? 
  'This is a follow-up question in the lead capture sequence. Start with a natural acknowledgment like "Okay," "Got it," "Thanks," or "Perfect."' : 
  'This is the first question in the lead capture sequence. Start with an enthusiastic acknowledgment that shows you understand their service interest.'
}

Generate a natural way to ask this question that flows well in the conversation.`
          
          const rawQuestionResponse = await getChatCompletion(questionPrompt, enhancedSystemPrompt)
          const cleanedQuestionResponse = rawQuestionResponse ? cleanVoiceResponse(rawQuestionResponse) : null
          
          if (cleanedQuestionResponse) {
            const leadQuestionReply = cleanedQuestionResponse
            
            return { 
              reply: leadQuestionReply,
              currentFlow: 'LEAD_CAPTURE',
              showBranding,
              nextVoiceAction: determineNextVoiceAction('LEAD_CAPTURE', 'LEAD_CAPTURE')
            }
          }
        }
        
        // Fallback to original prefix logic if AI generation fails or no context
        let questionPrefix = ""
        if (assistantLeadQuestions.length > 0) {
          const followUpPrefixes = ["Okay, and ", "Got it. ", "Alright. ", "Thanks. ", "Perfect. ", "I see. "]
          questionPrefix = followUpPrefixes[Math.floor(Math.random() * followUpPrefixes.length)]
        } else {
          // First question - use more welcoming interjections, but consider context
          if (hasServiceContext) {
            // If we have context, use more direct transitions that acknowledge the service interest
            const contextualPrefixes = ["Perfect! ", "Great! ", "Excellent! ", "Wonderful! "]
            questionPrefix = contextualPrefixes[Math.floor(Math.random() * contextualPrefixes.length)]
          } else {
            // Standard first question prefixes
            const firstQuestionPrefixes = ["Alright, ", "Okay, ", "Sure thing! ", "Perfect. ", "Great! "]
            questionPrefix = firstQuestionPrefixes[Math.floor(Math.random() * firstQuestionPrefixes.length)]
          }
        }
        
        const leadQuestionReply = `${questionPrefix}${nextQuestion.questionText}`
        
        return { 
          reply: leadQuestionReply,
          currentFlow: 'LEAD_CAPTURE',
          showBranding,
          nextVoiceAction: determineNextVoiceAction('LEAD_CAPTURE', 'LEAD_CAPTURE')
        }
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
        
        // Add emergency notes if this was detected as an emergency
        if (isEmergency && firstUserMessage) {
          capturedData.emergency_notes = `User indicated an EMERGENCY situation in their initial message: "${firstUserMessage}"`
          console.log('Added emergency_notes to capturedData:', capturedData.emergency_notes)
        }
        
        // Map captured data to specific lead fields based on mapsToLeadField property
        let contactName: string | undefined = undefined
        let contactEmail: string | undefined = undefined
        let contactPhone: string | undefined = undefined
        let address: string | undefined = undefined
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
              case 'address':
                address = answer
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
          address,
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
            // address, // TODO: Uncomment after running Prisma migration and generating client
            notes
          }
        })
        
        // Send email notification to the business owner
        try {
          if (business && business.notificationEmail) {
            console.log(`Sending lead notification email to ${business.notificationEmail}...`)
            
            // Prepare lead details for the email
            const leadDetails = {
              capturedData: newLead.capturedData,
              conversationTranscript: newLead.conversationTranscript,
              contactName: newLead.contactName,
              contactEmail: newLead.contactEmail,
              contactPhone: newLead.contactPhone,
              notes: newLead.notes,
              createdAt: newLead.createdAt
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
                
                // Construct a more detailed lead summary with improved emergency prioritization
                let leadSummaryForCall = `Lead from ${newLead.contactName || 'unknown contact'}.`
                
                // Look for problem description in captured data with enhanced priority logic
                if (newLead.capturedData && typeof newLead.capturedData === 'object') {
                  const captured = newLead.capturedData as any
                  let problemDescription = null
                  
                  // PRIORITY 1: Look for answers to questions marked as isEssentialForEmergency that contain emergency-specific keywords
                  const emergencyQuestionKeys = Object.keys(captured).filter(key => {
                    const questionFromConfig = questionsToAsk.find(q => q.questionText === key && q.isEssentialForEmergency)
                    if (!questionFromConfig) return false
                    
                    // Check if the question itself is emergency-focused
                    const emergencyKeywords = ['emergency', 'urgent', 'describe', 'problem', 'issue', 'situation', 'happening', 'wrong']
                    return emergencyKeywords.some(keyword => key.toLowerCase().includes(keyword))
                  })
                  
                  if (emergencyQuestionKeys.length > 0) {
                    // Use the first emergency-specific question answer
                    problemDescription = captured[emergencyQuestionKeys[0]]
                    console.log(`Using answer from emergency-specific question: "${emergencyQuestionKeys[0]}"`)
                  }
                  
                  // PRIORITY 2: Look for emergency_notes (initial transcribed emergency message)
                  if (!problemDescription && captured.emergency_notes) {
                    // Extract the actual emergency message from emergency_notes
                    const match = captured.emergency_notes.match(/initial message: "([^"]+)"/i)
                    if (match && match[1]) {
                      problemDescription = match[1]
                      console.log('Using emergency_notes content for voice alert')
                    } else {
                      problemDescription = captured.emergency_notes
                    }
                  }
                  
                  // PRIORITY 3: General issue/problem description questions
                  if (!problemDescription) {
                    const issueKey = Object.keys(captured).find(key => 
                      key.toLowerCase().includes('issue') || 
                      key.toLowerCase().includes('problem') ||
                      key.toLowerCase().includes('describe') ||
                      (key.toLowerCase().includes('what') && key.toLowerCase().includes('happening'))
                    )
                    
                    if (issueKey) {
                      problemDescription = captured[issueKey]
                      console.log(`Using general issue description from: "${issueKey}"`)
                    }
                  }
                  
                  // PRIORITY 4: Fall back to first user message
                  if (!problemDescription) {
                    const firstUserMessage = conversationHistory.find(entry => entry.role === 'user')?.content
                    if (firstUserMessage) {
                      problemDescription = firstUserMessage
                      console.log('Using first user message as fallback for voice alert')
                    }
                  }
                  
                  // Construct the summary with the best available description
                  if (problemDescription) {
                    // Truncate for voice clarity (max ~150 chars)
                    const truncatedDescription = problemDescription.length > 150 
                      ? problemDescription.substring(0, 150) + '...' 
                      : problemDescription
                    leadSummaryForCall += ` Issue stated: ${truncatedDescription}`
                  } else {
                    leadSummaryForCall += ' Details in system.'
                  }
                }
                
                await initiateEmergencyVoiceCall(
                  business.notificationPhoneNumber,
                  business.name,
                  leadSummaryForCall,
                  newLead.id
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
            reply: "Thank you for providing that information. We've identified this as an URGENT situation and will prioritize your request. Our team will contact you as soon as possible to address your emergency.",
            currentFlow: null,
            showBranding,
            nextVoiceAction: determineNextVoiceAction('LEAD_CAPTURE', null)
          }
        } else {
          // Use custom completion message if available, otherwise use default
          const completionMessage = agentConfig?.leadCaptureCompletionMessage || 
            "Thanks for providing that information! Our team will review it and get back to you ASAP."
          
          return { 
            reply: completionMessage,
            currentFlow: null,
            showBranding,
            nextVoiceAction: determineNextVoiceAction('LEAD_CAPTURE', null)
          }
        }
      }
      
    } else {
      // OTHER/Fallback Flow
      console.log('Entering OTHER/fallback flow...')
      
      // Check if user just declined the FAQ fallback offer
      const lastAssistantMessage = [...conversationHistory].reverse().find(msg => msg.role === 'assistant')
      if (lastAssistantMessage && 
          lastAssistantMessage.content.includes("I couldn't find a specific answer to that in my current knowledge") && 
          lastAssistantMessage.content.includes("Would you like me to take down your details")) {
        
        console.log('User appears to have declined FAQ fallback offer, providing alternative help')
        
        // Use AI to detect if this is a decline and provide helpful alternative
        const declineCheckPrompt = `The user was asked: "Would you like me to take down your details so someone from our team can get back to you with the information you need?"

User's response: "${message}"

Does this response indicate they declined or don't want to provide details? Consider responses like:
- Explicit no: "no", "no thanks", "not right now"
- Soft decline: "maybe later", "I'll think about it"
- Deflection: changing subject, asking different questions

Respond with only YES or NO.`
        
        const isDeclineResponse = await getChatCompletion(
          declineCheckPrompt,
          "You are an intent detection expert focused on identifying user decline or reluctance."
        )
        
        const cleanedDeclineResponse = cleanVoiceResponse(isDeclineResponse || 'NO')
               if (cleanedDeclineResponse.trim().toUpperCase() === 'YES') {
         console.log('User declined FAQ fallback offer, providing alternative assistance')
         return {
           reply: "No problem at all! Is there anything else I can help you with today? I'm here to assist with any questions you might have.",
           currentFlow: null,
           showBranding,
           nextVoiceAction: determineNextVoiceAction('OTHER', null)
         }
       }
     }
      
      // Check if this is the start of a conversation
      if (conversationHistory.length === 0 && agentConfig?.welcomeMessage) {
        return { 
          reply: agentConfig.welcomeMessage,
          currentFlow: null,
          showBranding,
          nextVoiceAction: determineNextVoiceAction('OTHER', null)
        }
      }
      
      // General chat with voice-optimized system prompt
      const voiceSystemPrompt = createVoiceSystemPrompt(business.name, undefined, agentConfig?.questions || undefined)
      
      // Incorporate persona if available
      let systemPrompt = voiceSystemPrompt
      if (agentConfig?.personaPrompt) {
        systemPrompt += `\n\nADDITIONAL CONTEXT: ${agentConfig.personaPrompt}`
      }
      
      const generalChatUserPrompt = `Respond to the user's message naturally and helpfully. Start with a natural interjection or acknowledgment to make the conversation feel more human and conversational.

User's message: ${message}`
      
      const rawResponse = await getChatCompletion(generalChatUserPrompt, systemPrompt)
      const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null
      
      return { 
        reply: cleanedResponse || "How can I help you today?",
        currentFlow: null,
        showBranding,
        nextVoiceAction: determineNextVoiceAction('OTHER', null)
      }
    }
    
  } catch (error) {
    console.error('Error in processMessage:', error)
    return { 
      reply: "I apologize, but I'm having trouble processing your request right now. Please try again later or contact us directly.",
      currentFlow: null,
      showBranding: true, // Default to showing branding in error cases
      nextVoiceAction: 'HANGUP'
    }
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