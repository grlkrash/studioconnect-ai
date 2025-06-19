"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRecoveryResponse = exports.createVoiceSystemPrompt = void 0;
exports.handleIncomingMessage = handleIncomingMessage;
exports.processMessage = processMessage;
const db_1 = require("../services/db");
const openai_1 = require("../services/openai");
const voiceSessionService_1 = __importDefault(require("../services/voiceSessionService"));
const twilio_1 = __importDefault(require("twilio"));
const projectStatusService_1 = require("../services/projectStatusService");
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
const createVoiceSystemPrompt = (businessName, context, leadCaptureQuestions, personaPrompt) => {
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

` : ''}`;
};
exports.createVoiceSystemPrompt = createVoiceSystemPrompt;
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
        const voiceSystemPrompt = (0, exports.createVoiceSystemPrompt)(businessName, undefined, undefined);
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
        const voiceSystemPrompt = (0, exports.createVoiceSystemPrompt)(businessName, undefined, undefined);
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
    const voiceSystemPrompt = (0, exports.createVoiceSystemPrompt)(businessName, undefined, undefined);
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
    var _a, _b, _c;
    const voiceSessionService = voiceSessionService_1.default.getInstance();
    const session = callSid ? await voiceSessionService.getVoiceSession(callSid) : null;
    try {
        const business = await db_1.prisma.business.findUnique({
            where: { id: businessId },
            include: {
                agentConfig: {
                    include: {
                        questions: { orderBy: { order: 'asc' } },
                    },
                },
            },
        });
        if (!business) {
            console.warn(`[AI Handler] Business with ID ${businessId} not found.`);
            return {
                reply: "I'm sorry, I can't seem to access my configuration right now. Please try your call again in a few moments.",
                currentFlow: 'ERROR',
                nextAction: 'HANGUP',
            };
        }
        let context = '';
        let clientContext = '';
        let projectContext = '';
        let knowledgeContext = '';
        const knowledgeBaseEntries = await db_1.prisma.knowledgeBase.findMany({
            where: { businessId: business.id },
            select: { content: true },
        });
        if (knowledgeBaseEntries.length > 0) {
            knowledgeContext = '--- KNOWLEDGE BASE ---\n' + knowledgeBaseEntries.map((e) => `- ${e.content}`).join('\n');
        }
        if (callSid && channel === 'VOICE') {
            const callLog = await db_1.prisma.callLog.findUnique({
                where: { callSid },
                select: { from: true },
            });
            if (callLog && callLog.from) {
                const client = await db_1.prisma.client.findFirst({
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
                });
                if (client) {
                    clientContext = `--- CALLER INFORMATION ---\nThis call is from an existing client: ${client.name}.`;
                    if (client.projects.length > 0) {
                        const now = Date.now();
                        for (const proj of client.projects) {
                            const last = proj.lastSyncedAt ? new Date(proj.lastSyncedAt).getTime() : 0;
                            if (now - last > 2 * 60 * 1000) {
                                await (0, projectStatusService_1.refreshProjectStatus)(proj.id);
                            }
                        }
                        const updated = await db_1.prisma.project.findMany({ where: { clientId: client.id, status: { not: 'COMPLETED' } }, select: { name: true, status: true, details: true } });
                        projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\n` + updated.map((p) => `  - Project: "${p.name}", Status: ${p.status}, Last Update: ${p.details || 'No details available'}`).join('\n');
                    }
                    else {
                        projectContext = `--- ACTIVE PROJECTS for ${client.name} ---\nThis client currently has no active projects.`;
                    }
                }
            }
        }
        const contextParts = [clientContext, projectContext, knowledgeContext].filter(Boolean);
        if (contextParts.length > 0) {
            context = contextParts.join('\n\n');
        }
        const leadCaptureQuestions = ((_a = business.agentConfig) === null || _a === void 0 ? void 0 : _a.questions) || [];
        const personaPrompt = (_b = business.agentConfig) === null || _b === void 0 ? void 0 : _b.personaPrompt;
        const systemMessage = (0, exports.createVoiceSystemPrompt)(business.name, context, leadCaptureQuestions, personaPrompt || undefined);
        const finalHistory = conversationHistory.map((h) => ({
            role: h.role,
            content: h.content,
        }));
        console.log('[AI Handler] Generating chat completion with system message:', systemMessage.substring(0, 500) + '...');
        try {
            const statusRegex = /(status|update|progress)\s+(of|for)?\s+([\w\s\-']{3,})/i;
            const m = message.match(statusRegex);
            if (m && m[3] && businessId) {
                const projName = m[3].trim();
                const proj = await db_1.prisma.project.findFirst({
                    where: {
                        businessId,
                        name: { contains: projName, mode: 'insensitive' },
                    },
                    select: { name: true, status: true, details: true },
                });
                if (proj) {
                    const statusText = ((_c = proj.status) === null || _c === void 0 ? void 0 : _c.toLowerCase().replace(/_/g, ' ')) || 'in progress';
                    const detailsText = proj.details ? ` Latest update: ${proj.details}.` : '';
                    const quickReply = `The current status of ${proj.name} is ${statusText}.${detailsText}`;
                    return { reply: quickReply, currentFlow: currentActiveFlow || null, nextAction: 'CONTINUE' };
                }
            }
        }
        catch (quickErr) {
            console.warn('[AI Handler] Quick project status check failed, falling back to LLM', quickErr);
        }
        const aiResponse = await (0, openai_1.getChatCompletion)([
            { role: 'system', content: systemMessage },
            ...finalHistory,
            { role: 'user', content: message }
        ]);
        const reply = cleanVoiceResponse(aiResponse || '');
        let nextAction = 'CONTINUE';
        const lowerMsg = message.toLowerCase();
        if (/(human|representative|talk to (someone|a person)|connect me|transfer|emergency)/.test(lowerMsg)) {
            nextAction = 'TRANSFER';
        }
        else if (/(voicemail|leave (a )?message)/.test(lowerMsg)) {
            nextAction = 'VOICEMAIL';
        }
        if (session && callSid) {
            const updatedHistory = [...conversationHistory, { role: 'user', content: message }, { role: 'assistant', content: reply }];
            await voiceSessionService.updateVoiceSession(callSid, updatedHistory, currentActiveFlow || null);
        }
        return {
            reply,
            currentFlow: currentActiveFlow,
            nextAction,
        };
    }
    catch (error) {
        console.error('[🎯 BULLETPROOF AI HANDLER] ❌ Critical error processing message:', error);
        let recoveryMessage = '';
        let nextAction = 'CONTINUE';
        if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
                recoveryMessage = (0, exports.generateRecoveryResponse)('network');
                console.error('[🎯 BULLETPROOF AI HANDLER] 🌐 Network/timeout error detected');
            }
            else if (errorMessage.includes('database') || errorMessage.includes('prisma')) {
                recoveryMessage = (0, exports.generateRecoveryResponse)('database');
                console.error('[🎯 BULLETPROOF AI HANDLER] 🗃️ Database error detected');
            }
            else if (errorMessage.includes('openai') || errorMessage.includes('api')) {
                recoveryMessage = (0, exports.generateRecoveryResponse)('ai processing');
                console.error('[🎯 BULLETPROOF AI HANDLER] 🤖 AI API error detected');
            }
            else {
                recoveryMessage = (0, exports.generateRecoveryResponse)('generic');
                console.error('[🎯 BULLETPROOF AI HANDLER] ⚠️ Unknown error type detected');
            }
        }
        else {
            recoveryMessage = (0, exports.generateRecoveryResponse)('generic');
            console.error('[🎯 BULLETPROOF AI HANDLER] ⚠️ Non-Error object thrown');
        }
        console.error('[🎯 BULLETPROOF AI HANDLER] 📊 Error details for monitoring:', {
            businessId,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            stackTrace: error instanceof Error ? error.stack : 'No stack trace available',
            messageLength: message.length,
            conversationHistoryLength: conversationHistory.length,
            timestamp: new Date().toISOString()
        });
        return {
            reply: recoveryMessage,
            currentFlow: currentActiveFlow,
            nextAction,
        };
    }
};
const generateRecoveryResponse = (errorContext) => {
    const genericRecoveryMessages = [
        "I do apologize, it seems I'm experiencing a brief technical issue with my connection right now. I can still take a message for the team if you'd like.",
        "I'm sorry, I seem to be having some technical difficulties at the moment. Would you like to leave a message for someone to call you back?",
        "My apologies - I'm experiencing a brief technical issue. I can take down your information so our team can reach out to you directly.",
        "I'm sorry about that, I seem to be having a connection problem right now. I can still help by taking your details for a callback if that would be helpful."
    ];
    const transcriptionRecoveryMessages = [
        "I'm sorry, I didn't quite catch what you said. Could you please repeat that for me?",
        "I apologize, but I didn't hear that clearly. Could you please say that again?",
        "I'm having trouble hearing you clearly. Could you please repeat what you just said?",
        "Sorry, I missed that. Could you please repeat your message?"
    ];
    const aiProcessingRecoveryMessages = [
        "I'm experiencing a brief processing delay. Let me try to help you another way - what can I assist you with today?",
        "I apologize for the delay. How can I help you with your creative project or business needs today?",
        "Sorry about that brief pause. I'm here to help - what brings you to our agency today?",
        "My apologies for the technical hiccup. How may I assist you with your project today?"
    ];
    let selectedMessages = genericRecoveryMessages;
    if (errorContext) {
        const context = errorContext.toLowerCase();
        if (context.includes('transcription') || context.includes('speech') || context.includes('whisper')) {
            selectedMessages = transcriptionRecoveryMessages;
        }
        else if (context.includes('ai') || context.includes('processing') || context.includes('completion')) {
            selectedMessages = aiProcessingRecoveryMessages;
        }
    }
    const randomIndex = Math.floor(Math.random() * selectedMessages.length);
    const selectedMessage = selectedMessages[randomIndex];
    console.log('[🎯 RECOVERY SYSTEM] Generated recovery response:', selectedMessage.substring(0, 50) + '...');
    return selectedMessage;
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