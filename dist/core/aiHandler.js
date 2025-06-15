"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRecoveryResponse = void 0;
exports.handleIncomingMessage = handleIncomingMessage;
exports.processMessage = processMessage;
const db_1 = require("../services/db");
const openai_1 = require("../services/openai");
const ragService_1 = require("./ragService");
const twilio_1 = __importDefault(require("twilio"));
const DEFAULT_EMERGENCY_QUESTIONS = [
    {
        questionText: "Can you describe this situation in as much detail as possible?",
        expectedFormat: 'TEXT',
        order: 1,
        isRequired: true,
        mapsToLeadField: 'notes',
        isEssentialForEmergency: true
    },
    {
        questionText: "What's your exact address or location?",
        expectedFormat: 'TEXT',
        order: 2,
        isRequired: true,
        mapsToLeadField: 'address',
        isEssentialForEmergency: true
    },
    {
        questionText: "What's your name?",
        expectedFormat: 'TEXT',
        order: 3,
        isRequired: true,
        mapsToLeadField: 'contactName',
        isEssentialForEmergency: true
    },
    {
        questionText: "What's your phone number?",
        expectedFormat: 'PHONE',
        order: 4,
        isRequired: true,
        mapsToLeadField: 'contactPhone',
        isEssentialForEmergency: true
    }
];
const createVoiceSystemPrompt = (businessName, knowledgeContext, leadCaptureQuestions) => {
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

` : ''}`;
};
const cleanVoiceResponse = (response) => {
    if (!response)
        return response;
    let cleanedResponse = response.trim();
    const prefixPatterns = [
        /^(Say|Response|Here is the response|Assistant|AI|Voice|Agent|Bot|System|Output|Reply|Answer|Speaking|Dialogue|Script|Chat|Message|Text):\s*/gi,
        /^(I should say|Let me say|I'll say|I will say|I would say|I need to say|I want to say):\s*/gi,
        /^(The response is|My response is|The answer is|My answer is):\s*/gi,
        /^(Here's what I would say|Here's my response|Here's what I'll say|Here's my answer|Here is what I would say):\s*/gi,
        /^(This is what I would say|This is my response|This is what I'll say):\s*/gi,
        /^(Voice Assistant|Phone Agent|Call Handler|Customer Service|Support Agent|Virtual Assistant):\s*/gi,
        /^(Business Assistant|Phone Support|Call Center|Help Desk|Service Rep):\s*/gi,
        /^(Speaking|Responding|Replying|Answering|Saying|Telling|Explaining):\s*/gi,
        /^(The appropriate response would be|An appropriate response is|A good response would be):\s*/gi,
        /^(In response to|As a response|For this response):\s*/gi,
        /^(Function|Method|Return|Output|Result|Value):\s*/gi,
        /^(Console\.log|Print|Echo|Display):\s*/gi,
        /^(Well, I would say|So I would respond with|I think I should say):\s*/gi,
        /^(Let me respond|Let me answer|Allow me to say):\s*/gi
    ];
    let maxIterations = 10;
    let iterations = 0;
    let previousLength = 0;
    while (cleanedResponse.length !== previousLength && iterations < maxIterations) {
        previousLength = cleanedResponse.length;
        iterations++;
        for (const pattern of prefixPatterns) {
            cleanedResponse = cleanedResponse.replace(pattern, '').trim();
        }
    }
    cleanedResponse = cleanedResponse.replace(/^\[.*?\]\s*/g, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\(.*?\)\s*/g, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\{.*?\}\s*/g, '').trim();
    cleanedResponse = cleanedResponse.replace(/^<(?!break|emphasis|phoneme).*?>\s*/g, '').trim();
    const quotePatterns = [
        /^"(.*)"$/s,
        /^'(.*)'$/s,
        /^`(.*)`$/s,
        /^«(.*)»$/s,
        /^"(.*)"$/s,
        /^'(.*)'$/s
    ];
    for (const quotePattern of quotePatterns) {
        const match = cleanedResponse.match(quotePattern);
        if (match && match[1]) {
            cleanedResponse = match[1].trim();
            break;
        }
    }
    cleanedResponse = cleanedResponse.replace(/^\*\*(.*?)\*\*$/gs, '$1').trim();
    cleanedResponse = cleanedResponse.replace(/^\*(.*?)\*$/gs, '$1').trim();
    cleanedResponse = cleanedResponse.replace(/^_(.*?)_$/gs, '$1').trim();
    cleanedResponse = cleanedResponse.replace(/^`(.*?)`$/gs, '$1').trim();
    cleanedResponse = cleanedResponse.replace(/^[-=+*#]{2,}\s*/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/^>\s*/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\d+\.\s*/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/^[-*+]\s*/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\/\/.*$/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\/\*.*?\*\//gs, '').trim();
    cleanedResponse = cleanedResponse.replace(/^\s*[\{\}]\s*$/gm, '').trim();
    cleanedResponse = cleanedResponse.replace(/\.\s*["'\]\}]+\s*$/g, '.').trim();
    cleanedResponse = cleanedResponse.replace(/["\'\]\}]+\s*$/g, '').trim();
    cleanedResponse = cleanedResponse.replace(/\n\s*\n/g, '\n').trim();
    cleanedResponse = cleanedResponse.replace(/\s+/g, ' ').trim();
    if (!cleanedResponse || cleanedResponse.length < 2) {
        console.warn('cleanVoiceResponse: Over-cleaned response, returning original:', response);
        return response.trim();
    }
    return cleanedResponse;
};
const getQuestionAcknowledgment = (isFirstQuestion = false) => {
    if (isFirstQuestion) {
        const firstAcknowledgments = [
            "Perfect!",
            "Great!",
            "Alright,",
            "Okay,",
            "Sure thing!"
        ];
        return firstAcknowledgments[Math.floor(Math.random() * firstAcknowledgments.length)];
    }
    else {
        const followUpAcknowledgments = [
            "Got it.",
            "Okay.",
            "Alright,",
            "Thanks.",
            "Perfect."
        ];
        return followUpAcknowledgments[Math.floor(Math.random() * followUpAcknowledgments.length)];
    }
};
const isResponseClear = async (userResponse, expectedContext, currentGoal) => {
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

Respond with only YES if clear and complete, or NO if unclear/incomplete.`;
        const clarityResponse = await (0, openai_1.getChatCompletion)(clarityCheckPrompt, "You are a clarity assessment expert focused on evaluating user response completeness and clarity.");
        const cleanedClarityResponse = cleanVoiceResponse(clarityResponse || 'NO');
        return cleanedClarityResponse.trim().toUpperCase() === 'YES';
    }
    catch (error) {
        console.error('Error checking response clarity:', error);
        return true;
    }
};
const generateClarifyingQuestion = async (unclearResponse, originalQuestion, context, businessName) => {
    try {
        const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined);
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

Generate only the clarifying question text:`;
        const rawResponse = await (0, openai_1.getChatCompletion)(clarifyingUserPrompt, voiceSystemPrompt);
        const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null;
        return cleanedResponse || "I didn't quite catch that. Could you please repeat what you said?";
    }
    catch (error) {
        console.error('Error generating clarifying question:', error);
        return "I didn't quite catch that. Could you please repeat what you said?";
    }
};
const selectSmartEmergencyQuestions = async (emergencyMessage, availableQuestions, businessName) => {
    try {
        const configuredEmergencyQuestions = availableQuestions.filter(q => q.isEssentialForEmergency);
        if (configuredEmergencyQuestions.length > 0) {
            console.log('Using configured emergency questions:', configuredEmergencyQuestions.length);
            return configuredEmergencyQuestions;
        }
        console.log('No configured emergency questions found, using smart selection...');
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

Respond with ONLY the question numbers from the available questions list, separated by commas (e.g., "1,3,4"). If none of the available questions are suitable for emergencies, respond with "DEFAULT" to use the default emergency questions.`;
        const aiResponse = await (0, openai_1.getChatCompletion)(questionSelectionPrompt, "You are an emergency response expert who selects the most critical questions for urgent situations.");
        const cleanedResponse = cleanVoiceResponse(aiResponse || 'DEFAULT').trim();
        if (cleanedResponse === 'DEFAULT') {
            console.log('AI recommends using default emergency questions');
            return DEFAULT_EMERGENCY_QUESTIONS;
        }
        const selectedIndices = cleanedResponse.split(',').map(num => parseInt(num.trim()) - 1).filter(index => !isNaN(index));
        if (selectedIndices.length === 0) {
            console.log('Could not parse AI response, falling back to default emergency questions');
            return DEFAULT_EMERGENCY_QUESTIONS;
        }
        const selectedQuestions = selectedIndices
            .map(index => availableQuestions[index])
            .filter(q => q !== undefined);
        if (selectedQuestions.length === 0) {
            console.log('No valid questions selected, falling back to default emergency questions');
            return DEFAULT_EMERGENCY_QUESTIONS;
        }
        console.log(`AI selected ${selectedQuestions.length} emergency questions:`, selectedQuestions.map(q => q.questionText));
        return selectedQuestions;
    }
    catch (error) {
        console.error('Error in smart emergency question selection:', error);
        return DEFAULT_EMERGENCY_QUESTIONS;
    }
};
const offerEmergencyEscalation = async (emergencyMessage, businessName) => {
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

Business name: ${businessName || 'our team'}`;
        const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined);
        const aiResponse = await (0, openai_1.getChatCompletion)(escalationPrompt, voiceSystemPrompt);
        return cleanVoiceResponse(aiResponse ||
            `I understand this is an emergency situation. I can either connect you directly to our emergency response team right now (within 30 seconds), or quickly gather just 2-3 essential details so we can dispatch help immediately. Which would you prefer?`);
    }
    catch (error) {
        console.error('Error generating emergency escalation offer:', error);
        return `I understand this is an emergency situation. I can either connect you directly to our emergency response team right now (within 30 seconds), or quickly gather just 2-3 essential details so we can dispatch help immediately. Which would you prefer?`;
    }
};
const confirmEmergencyDetails = async (userResponse, questionType, businessName) => {
    const confirmationPrompt = `The user has provided their ${questionType}. Generate a confirmation response that:
1. Repeats back the ${questionType} they provided
2. Asks "Is that correct?"
3. Uses natural speech patterns
4. Is brief and clear

User's ${questionType}: "${userResponse}"

Generate only the confirmation response:`;
    const voiceSystemPrompt = createVoiceSystemPrompt(businessName, undefined, undefined);
    const confirmationResponse = await (0, openai_1.getChatCompletion)(confirmationPrompt, voiceSystemPrompt);
    return cleanVoiceResponse(confirmationResponse || `I heard your ${questionType} as "${userResponse}". Is that correct?`);
};
const getCallerId = async (callSid) => {
    try {
        const twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const call = await twilioClient.calls(callSid).fetch();
        return call.from || null;
    }
    catch (error) {
        console.error('Error fetching caller ID from Twilio:', error);
        return null;
    }
};
const determineNextVoiceAction = (intent, currentFlow) => {
    if (intent === 'END_CALL')
        return 'HANGUP';
    if (currentFlow === 'EMERGENCY_ESCALATION_OFFER')
        return 'TRANSFER';
    return 'CONTINUE';
};
const _processMessage = async (message, conversationHistory, businessId, currentActiveFlow, callSid, channel = 'VOICE') => {
    try {
        console.log(`AI Handler processing message for business ${businessId}: "${message}"`);
        console.log('Received currentActiveFlow:', currentActiveFlow);
        console.log('Received conversationHistory on backend:', JSON.stringify(conversationHistory, null, 2));
        const business = await db_1.prisma.business.findUnique({
            where: { id: businessId }
        });
        if (!business) {
            console.error(`Business not found for ID: ${businessId}. Cannot determine branding or agent config.`);
            return {
                reply: "Sorry, I'm having trouble finding configuration for this business.",
                showBranding: true,
                nextAction: 'HANGUP'
            };
        }
        const showBranding = business.planTier === 'PRO';
        console.log(`Business planTier: ${business.planTier}, Show Branding: ${showBranding}`);
        let isExistingClient = false;
        let client = null;
        let fromNumber = null;
        if (callSid) {
            fromNumber = await getCallerId(callSid);
            if (fromNumber) {
                client = await db_1.prisma.client.findFirst({
                    where: {
                        businessId,
                        phone: fromNumber
                    }
                });
                if (client) {
                    isExistingClient = true;
                    console.log(`[AI Handler] Identified existing client: ${client.name} (ID: ${client.id})`);
                }
            }
        }
        let intent;
        let isEmergency = false;
        if ((currentActiveFlow === null || currentActiveFlow === void 0 ? void 0 : currentActiveFlow.startsWith('LEAD_CAPTURE')) || (currentActiveFlow === null || currentActiveFlow === void 0 ? void 0 : currentActiveFlow.startsWith('NEW_LEAD_QUALIFICATION'))) {
            intent = 'NEW_LEAD_QUALIFICATION';
            console.log('Continuing NEW_LEAD_QUALIFICATION flow based on state.');
        }
        else if ((currentActiveFlow === null || currentActiveFlow === void 0 ? void 0 : currentActiveFlow.startsWith('FAQ_CLARIFYING')) || (currentActiveFlow === null || currentActiveFlow === void 0 ? void 0 : currentActiveFlow.startsWith('CLIENT_FAQ_CLARIFYING'))) {
            intent = 'CLIENT_FAQ';
            console.log('Continuing CLIENT_FAQ flow after clarification.');
        }
        else if (currentActiveFlow === 'PROJECT_STATUS_CLARIFYING') {
            intent = 'PROJECT_STATUS_INQUIRY';
            console.log('Continuing PROJECT_STATUS_INQUIRY flow after clarification.');
        }
        else if (currentActiveFlow === 'EMERGENCY_ESCALATION_OFFER') {
            const choiceResponse = await (0, openai_1.getChatCompletion)(`The user was offered emergency escalation. User's response: "${message}"
        Does the user want IMMEDIATE ESCALATION or QUICK QUESTIONS?
        Respond with only: IMMEDIATE or QUESTIONS`, "You are an escalation preference detection expert.");
            const userChoice = cleanVoiceResponse(choiceResponse || 'QUESTIONS').trim().toUpperCase();
            intent = userChoice === 'IMMEDIATE' ? 'EMERGENCY' : 'NEW_LEAD_QUALIFICATION';
        }
        else {
            const intentPrompt = `Analyze the user's message and classify their intent for a creative agency.

      ${isExistingClient ? `**THIS CALL IS FROM AN EXISTING CLIENT (${(client === null || client === void 0 ? void 0 : client.name) || 'Unknown Client'}).**` : `**THIS CALL IS FROM A POTENTIAL NEW CLIENT.**`}

      Possible Intents:
      - **NEW_LEAD_QUALIFICATION**: User is asking for new services, pricing, consultations, or expressing a new project need.
      - **PROJECT_STATUS_INQUIRY**: User is an existing client asking for an update on an ongoing project (e.g., "What's the status of my website?", "How's the branding project going?"). (Only for existing clients)
      - **CLIENT_FAQ**: User is an existing client asking general questions about the agency (e.g., "How do I submit feedback?", "What's your billing cycle?", "Where can I find my invoices?"). (Only for existing clients)
      - **AGENCY_GENERAL_FAQ**: User (new or existing) asking general questions about the agency that are not project-specific (e.g., "What services do you offer?", "What are your office hours?").
      - **END_CALL**: User indicates they want to end the call.
      - **OTHER**: Greetings, thank you messages, unclear, or off-topic messages.

      User message: '${message}'
      Recent history: ${JSON.stringify(conversationHistory.slice(-3))}

      Classify as: NEW_LEAD_QUALIFICATION, PROJECT_STATUS_INQUIRY, CLIENT_FAQ, AGENCY_GENERAL_FAQ, END_CALL, or OTHER`;
            const intentResponse = await (0, openai_1.getChatCompletion)(intentPrompt, "You are an intent classification expert for a creative agency. Respond with only: NEW_LEAD_QUALIFICATION, PROJECT_STATUS_INQUIRY, CLIENT_FAQ, AGENCY_GENERAL_FAQ, END_CALL, or OTHER.");
            intent = cleanVoiceResponse(intentResponse || 'OTHER').trim().toUpperCase();
        }
        isEmergency = intent === 'EMERGENCY';
        console.log(`Effective intent: ${intent}  (isEmergency: ${isEmergency})`);
        if (intent === 'PROJECT_STATUS_INQUIRY') {
            console.log('Entering PROJECT_STATUS_INQUIRY flow...');
            if (!isExistingClient) {
                return {
                    reply: "I can help with project status updates for existing clients. Are you an existing client, or are you looking to start a new project?",
                    currentFlow: null,
                    showBranding,
                    nextAction: determineNextVoiceAction('OTHER', null)
                };
            }
            if (business.planTier !== 'ENTERPRISE') {
                return {
                    reply: `Project status inquiries are available on our ENTERPRISE plan. Would you like me to take your details to have someone from our team provide an update?`,
                    currentFlow: 'NEW_LEAD_QUALIFICATION',
                    showBranding,
                    nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
                };
            }
            const projectQueryPrompt = `The client (${client === null || client === void 0 ? void 0 : client.name}) is asking about a project. What specific project are they asking about? If unclear, ask a clarifying question.
      Client message: "${message}"
      Respond with only the project name (e.g., "Website Redesign") or "UNCLEAR" if you cannot determine the project.`;
            const projectName = cleanVoiceResponse(await (0, openai_1.getChatCompletion)(projectQueryPrompt, "You are a project name extraction expert.") || '');
            if (projectName === 'UNCLEAR' || !projectName) {
                return {
                    reply: "I'm not sure how to help with that. Would you like me to connect you with our team?",
                    currentFlow: 'NEW_LEAD_QUALIFICATION',
                    showBranding,
                    nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
                };
            }
            const projects = await db_1.prisma.project.findMany({
                where: {
                    clientId: client === null || client === void 0 ? void 0 : client.id,
                    name: { contains: projectName, mode: 'insensitive' }
                },
                orderBy: { lastSyncedAt: 'desc' }
            });
            if (projects.length > 0) {
                const project = projects[0];
                return {
                    reply: `Okay, for your project "${project.name}", the current status is: "${project.status}". The last update was on ${new Date(project.lastSyncedAt).toLocaleDateString()}. Is there anything else I can help with regarding this project?`,
                    currentFlow: null,
                    showBranding,
                    nextAction: determineNextVoiceAction('PROJECT_STATUS_INQUIRY', null)
                };
            }
            else {
                return {
                    reply: `I couldn't find a project named "${projectName}". Could you please confirm the project name, or describe it briefly?`,
                    currentFlow: 'PROJECT_STATUS_CLARIFYING',
                    showBranding,
                    nextAction: determineNextVoiceAction('PROJECT_STATUS_INQUIRY', 'PROJECT_STATUS_CLARIFYING')
                };
            }
        }
        else if (intent === 'CLIENT_FAQ') {
            console.log('Entering CLIENT_FAQ flow...');
            if (!isExistingClient) {
                return {
                    reply: "I can answer general questions about our agency. What would you like to know?",
                    currentFlow: null,
                    showBranding,
                    nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
                };
            }
            if (business.planTier !== 'ENTERPRISE') {
                return {
                    reply: `Client-specific FAQs are available on our ENTERPRISE plan. I can answer general questions about our agency's services. What would you like to know?`,
                    currentFlow: 'AGENCY_GENERAL_FAQ',
                    showBranding,
                    nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
                };
            }
            const relevantKnowledge = await (0, ragService_1.findRelevantKnowledge)(message, businessId, 3);
            if (relevantKnowledge.length > 0) {
                const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n');
                const voiceSystemPrompt = createVoiceSystemPrompt(business.name, contextSnippets, undefined);
                const faqUserPrompt = `Based on the following context, answer the client's question naturally and conversationally. Focus on providing helpful information relevant to an agency client.
        Context: ${contextSnippets}
        Client's Question: ${message}`;
                const rawResponse = await (0, openai_1.getChatCompletion)(faqUserPrompt, voiceSystemPrompt);
                const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null;
                return {
                    reply: cleanedResponse || "I'm having trouble finding that specific information. Could you rephrase your question?",
                    currentFlow: null,
                    showBranding,
                    nextAction: determineNextVoiceAction('CLIENT_FAQ', null)
                };
            }
            else {
                return {
                    reply: "I couldn't find a specific answer to that in our client knowledge base. Can I get a message to our team to follow up with you on this?",
                    currentFlow: 'NEW_LEAD_QUALIFICATION',
                    showBranding,
                    nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
                };
            }
        }
        else if (intent === 'NEW_LEAD_QUALIFICATION') {
        }
        else if (intent === 'AGENCY_GENERAL_FAQ') {
            console.log('Entering AGENCY_GENERAL_FAQ flow...');
            const relevantKnowledge = await (0, ragService_1.findRelevantKnowledge)(message, businessId, 3);
            if (relevantKnowledge.length > 0) {
                const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n');
                const voiceSystemPrompt = createVoiceSystemPrompt(business.name, contextSnippets, undefined);
                const faqUserPrompt = `Based on the following context, answer the user's question naturally and conversationally. Focus on providing helpful information about our agency.
        Context: ${contextSnippets}
        User's Question: ${message}`;
                const rawResponse = await (0, openai_1.getChatCompletion)(faqUserPrompt, voiceSystemPrompt);
                const cleanedResponse = rawResponse ? cleanVoiceResponse(rawResponse) : null;
                return {
                    reply: cleanedResponse || "I'm having trouble finding that specific information. Could you rephrase your question?",
                    currentFlow: null,
                    showBranding,
                    nextAction: determineNextVoiceAction('AGENCY_GENERAL_FAQ', null)
                };
            }
            else {
                return {
                    reply: "I couldn't find a specific answer to that in our agency knowledge base. Can I get a message to our team to follow up with you on this?",
                    currentFlow: 'NEW_LEAD_QUALIFICATION',
                    showBranding,
                    nextAction: determineNextVoiceAction('NEW_LEAD_QUALIFICATION', 'NEW_LEAD_QUALIFICATION')
                };
            }
        }
    }
    catch (error) {
        console.error('Error in processMessage:', error);
        return {
            reply: "I apologize, but I'm having trouble processing your request right now. Please try again later or contact our team directly.",
            currentFlow: null,
            showBranding: true,
            nextAction: 'HANGUP'
        };
    }
    return {
        reply: "I'm not sure how to help with that. Would you like me to connect you with our team?",
        currentFlow: 'NEW_LEAD_QUALIFICATION',
        showBranding: true,
        nextAction: 'CONTINUE'
    };
};
const generateRecoveryResponse = () => {
    const recoveryMessages = [
        "I do apologize, it seems I'm experiencing a technical issue with my connection right now. I can still take a message for the team if you'd like.",
        "I'm sorry, I seem to be having some technical difficulties at the moment. Would you like to leave a message for someone to call you back?",
        "My apologies - I'm experiencing a brief technical issue. I can take down your information so our team can reach out to you directly.",
        "I'm sorry about that, I seem to be having a connection problem right now. I can still help by taking your details for a callback if that would be helpful."
    ];
    const randomIndex = Math.floor(Math.random() * recoveryMessages.length);
    return recoveryMessages[randomIndex];
};
exports.generateRecoveryResponse = generateRecoveryResponse;
async function handleIncomingMessage(message, sessionId, businessId) {
    return { response: 'AI response' };
}
function processMessage(...args) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        const { message, conversationHistory, businessId, currentActiveFlow = null, callSid, channel = 'VOICE' } = args[0];
        return _processMessage(message, conversationHistory, businessId, currentActiveFlow, callSid, channel);
    }
    const [message, conversationHistory, businessId, currentActiveFlow = null, callSid, channel = 'VOICE'] = args;
    return _processMessage(message, conversationHistory, businessId, currentActiveFlow, callSid, channel);
}
//# sourceMappingURL=aiHandler.js.map