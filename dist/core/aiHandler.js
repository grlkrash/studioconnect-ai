"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRecoveryResponse = exports.createVoiceSystemPrompt = void 0;
exports.handleIncomingMessage = handleIncomingMessage;
exports.processMessage = processMessage;
exports.getProjectStatusIntelligence = getProjectStatusIntelligence;
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

CRITICAL: Always provide a helpful, conversational response. If you're unsure about specific details, say "Let me connect you with someone who has those exact details" rather than giving no response. Keep the conversation flowing naturally.`;
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
const _processMessage = async (message, conversationHistory, businessId, currentActiveFlow = null, projectId = null, callSid, channel = 'VOICE') => {
    var _a, _b;
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
        const kbWhere = { businessId: business.id };
        if (projectId)
            kbWhere.projectId = projectId;
        const knowledgeBaseEntries = await db_1.prisma.knowledgeBase.findMany({
            where: kbWhere,
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
        const conversationContext = {
            businessName: business.name,
            criticalTopics: [],
            lastInteractionType: 'inquiry'
        };
        const personaPrompt = (_b = business.agentConfig) === null || _b === void 0 ? void 0 : _b.personaPrompt;
        const systemMessage = (0, exports.createVoiceSystemPrompt)(business.name, context, leadCaptureQuestions, personaPrompt || undefined);
        const finalHistory = conversationHistory.map((h) => ({
            role: h.role,
            content: h.content,
        }));
        console.log('[AI Handler] Generating chat completion with system message:', systemMessage.substring(0, 500) + '...');
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
        }
        catch (projectErr) {
            console.warn('[🎯 PROJECT INTELLIGENCE] ⚠️ Project status intelligence failed, falling back to LLM:', projectErr);
        }
        console.log('[🎯 AI HANDLER] 🧠 Generating AI response with bulletproof system...');
        let aiResponse = null;
        let attempts = 0;
        const maxAttempts = 3;
        while ((!aiResponse || aiResponse.trim().length === 0) && attempts < maxAttempts) {
            attempts++;
            console.log(`[🎯 AI HANDLER] 🔄 AI generation attempt ${attempts}/${maxAttempts}`);
            try {
                const rawResponse = await (0, openai_1.getChatCompletion)([
                    { role: 'system', content: systemMessage },
                    ...finalHistory,
                    { role: 'user', content: message }
                ]);
                if (rawResponse && rawResponse.trim().length > 0) {
                    aiResponse = rawResponse;
                    console.log(`[🎯 AI HANDLER] ✅ AI response generated successfully on attempt ${attempts}: "${aiResponse.substring(0, 100)}..."`);
                    break;
                }
                else {
                    console.warn(`[🎯 AI HANDLER] ⚠️ Empty AI response on attempt ${attempts}, retrying...`);
                }
            }
            catch (aiError) {
                console.error(`[🎯 AI HANDLER] ❌ AI generation attempt ${attempts} failed:`, aiError);
                if (attempts === maxAttempts) {
                    const lowerMsg = message.toLowerCase();
                    if (lowerMsg.includes('project') || lowerMsg.includes('status')) {
                        aiResponse = "Let me help you with your project. Could you tell me which project you're asking about?";
                    }
                    else if (lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('quote')) {
                        aiResponse = "I'd be happy to help with pricing information. Let me connect you with someone who can provide detailed quotes.";
                    }
                    else if (lowerMsg.includes('timeline') || lowerMsg.includes('deadline') || lowerMsg.includes('when')) {
                        aiResponse = "Great question about timing. Let me get you connected with our project team for specific timeline details.";
                    }
                    else {
                        aiResponse = "I'm here to help with your creative project needs. What can I assist you with today?";
                    }
                    console.log(`[🎯 AI HANDLER] 🛡️ Using contextual fallback response: "${aiResponse}"`);
                }
            }
        }
        if (!aiResponse || aiResponse.trim().length === 0) {
            aiResponse = "Thank you for calling. How can I help you with your creative project today?";
            console.log(`[🎯 AI HANDLER] 🚨 Emergency fallback activated: "${aiResponse}"`);
        }
        const reply = cleanVoiceResponse(aiResponse);
        if (!reply || reply.trim().length === 0) {
            const emergencyReply = "I'm here to help. What can I assist you with?";
            console.log(`[🎯 AI HANDLER] 🚨 Post-cleaning emergency fallback: "${emergencyReply}"`);
            return {
                reply: emergencyReply,
                currentFlow: currentActiveFlow,
                nextAction: 'CONTINUE',
            };
        }
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
        const { message, conversationHistory, businessId, currentActiveFlow = null, projectId = null, callSid, channel = 'VOICE' } = args[0];
        return _processMessage(message, conversationHistory, businessId, currentActiveFlow, projectId, callSid, channel);
    }
    const [message, conversationHistory, businessId, currentActiveFlow = null, projectId = null, callSid, channel = 'VOICE'] = args;
    return _processMessage(message, conversationHistory, businessId, currentActiveFlow, projectId, callSid, channel);
}
async function getProjectStatusIntelligence(message, businessId) {
    var _a, _b;
    if (!businessId)
        return null;
    try {
        const activeIntegrations = await db_1.prisma.integration.findMany({
            where: {
                businessId,
                isEnabled: true,
                syncStatus: 'CONNECTED'
            }
        });
        console.log(`[🎯 PROJECT INTELLIGENCE] Active integrations: ${activeIntegrations.length}`);
        if (activeIntegrations.length === 0) {
            console.log(`[🎯 PROJECT INTELLIGENCE] No active PM integrations - being honest about limitations`);
            return {
                reply: "I don't currently have access to live project management data. Our project management integrations are still being set up. Let me connect you with your project manager who can provide you with detailed, up-to-date project status information right away.",
                projectFound: false
            };
        }
        const statusPatterns = [
            /(status|update|progress|where\s+(are\s+)?we|how\s+is|what'?s\s+the\s+status)\s+(of|on|for|with)?\s*(.{3,})/i,
            /(can\s+you\s+)?((check|give\s+me|tell\s+me|provide)\s+)?(an?\s+)?(update|status|progress)\s+(on|for|about|regarding)\s*(.{3,})/i,
            /(when\s+(will|is)|timeline\s+for|eta\s+for|deadline\s+for)\s*(.{3,})/i,
            /(is|has)\s+(.{3,})\s+(done|finished|completed|ready)/i,
            /(project|campaign|website|logo|branding|design)\s+(.{3,})/i
        ];
        let projectQuery = '';
        let matchType = '';
        for (const pattern of statusPatterns) {
            const match = message.match(pattern);
            if (match) {
                const captures = match.slice(1).filter(cap => cap && cap.trim().length > 2);
                if (captures.length > 0) {
                    projectQuery = captures[captures.length - 1].trim();
                    matchType = pattern.toString().includes('timeline|eta|deadline') ? 'timeline' : 'status';
                    break;
                }
            }
        }
        if (!projectQuery)
            return null;
        projectQuery = projectQuery
            .replace(/\b(project|the|a|an|is|are|was|were|been|being|be|have|has|had|will|would|could|should|may|might|can|shall|must|status|update|progress|done|finished|completed|ready)\b/gi, '')
            .replace(/[^\w\s-']/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (projectQuery.length < 2)
            return null;
        console.log(`[🎯 PROJECT INTELLIGENCE] Searching for project: "${projectQuery}" (type: ${matchType})`);
        let project = await db_1.prisma.project.findFirst({
            where: {
                businessId,
                name: { equals: projectQuery, mode: 'insensitive' },
                pmToolId: { not: null },
                lastSyncedAt: { not: null }
            },
            select: {
                id: true, name: true, status: true, details: true,
                assignee: true, dueDate: true, lastSyncedAt: true, pmTool: true,
                client: { select: { name: true } }
            }
        });
        if (!project) {
            project = await db_1.prisma.project.findFirst({
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
        if (!project && projectQuery.includes(' ')) {
            const words = projectQuery.split(' ').filter(w => w.length > 2);
            if (words.length > 0) {
                const wordConditions = words.map(word => ({
                    name: { contains: word, mode: 'insensitive' }
                }));
                project = await db_1.prisma.project.findFirst({
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
            const syncedProjects = await db_1.prisma.project.findMany({
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
                    .map(p => { var _a; return `• ${p.name} (${((_a = p.status) === null || _a === void 0 ? void 0 : _a.toLowerCase().replace(/_/g, ' ')) || 'active'}) - ${p.pmTool || 'PM Tool'}`; })
                    .join('\n');
                return {
                    reply: `I couldn't find a project matching "${projectQuery}" in our connected project management tools. Here are your current projects:\n\n${projectList}\n\nCould you please specify which project you'd like an update on, or would you like me to connect you with your project manager?`,
                    projectFound: false
                };
            }
            else {
                return {
                    reply: `I don't have access to current project data at the moment. This could be because our project management integration is still syncing, or there may be a temporary connection issue. Let me connect you with your project manager who can provide you with the most up-to-date project information.`,
                    projectFound: false
                };
            }
        }
        const lastSync = project.lastSyncedAt ? new Date(project.lastSyncedAt) : null;
        const isStale = !lastSync || (Date.now() - lastSync.getTime()) > 24 * 60 * 60 * 1000;
        if (isStale) {
            console.log(`[🎯 PROJECT INTELLIGENCE] Project data is stale, attempting refresh...`);
            try {
                await (0, projectStatusService_1.refreshProjectStatus)(project.id);
                const updatedProject = await db_1.prisma.project.findUnique({
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
            }
            catch (refreshError) {
                console.warn('[🎯 PROJECT INTELLIGENCE] Could not refresh project status:', refreshError);
                if (isStale) {
                    return {
                        reply: `I found the project "${project.name}" but the information may not be current due to a sync issue with our project management system. Let me connect you with your project manager who can provide you with the most up-to-date status.`,
                        projectFound: true
                    };
                }
            }
        }
        const statusText = ((_a = project.status) === null || _a === void 0 ? void 0 : _a.toLowerCase().replace(/_/g, ' ')) || 'in progress';
        const projectName = project.name;
        const clientName = (_b = project.client) === null || _b === void 0 ? void 0 : _b.name;
        const pmTool = project.pmTool || 'project management system';
        let response = '';
        if (matchType === 'timeline') {
            response = `Based on our ${pmTool} data, here's the timeline for ${projectName}`;
        }
        else {
            response = `According to our ${pmTool} integration, here's the current status of ${projectName}`;
        }
        if (clientName) {
            response += ` for ${clientName}`;
        }
        response += `:\n\n`;
        response += `📊 **Status:** ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}\n`;
        if (project.assignee) {
            response += `👤 **Assigned to:** ${project.assignee}\n`;
        }
        if (project.dueDate) {
            const dueDate = new Date(project.dueDate);
            const now = new Date();
            const timeDiff = dueDate.getTime() - now.getTime();
            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
            response += `📅 **Due Date:** ${dueDate.toLocaleDateString()}`;
            if (daysDiff > 0) {
                response += ` (${daysDiff} days remaining)`;
            }
            else if (daysDiff === 0) {
                response += ` (due today)`;
            }
            else {
                response += ` (${Math.abs(daysDiff)} days overdue)`;
            }
            response += `\n`;
        }
        if (project.details && project.details.trim()) {
            response += `📝 **Latest Update:** ${project.details}\n`;
        }
        if (project.lastSyncedAt) {
            const syncDate = new Date(project.lastSyncedAt);
            const syncAgo = Math.round((Date.now() - syncDate.getTime()) / (1000 * 60));
            if (syncAgo < 60) {
                response += `\n*Data synced from ${pmTool} ${syncAgo} minutes ago*`;
            }
            else if (syncAgo < 1440) {
                response += `\n*Data synced from ${pmTool} ${Math.round(syncAgo / 60)} hours ago*`;
            }
            else {
                response += `\n*Data synced from ${pmTool} ${Math.round(syncAgo / 1440)} days ago - let me connect you with your project manager for the latest updates*`;
            }
        }
        response += `\n\nWould you like me to connect you with your project manager for more detailed information, or is there anything specific about this project I can help you with?`;
        console.log(`[🎯 PROJECT INTELLIGENCE] ✅ Generated verified status response for project: ${projectName}`);
        return {
            reply: response,
            projectFound: true
        };
    }
    catch (error) {
        console.error('[🎯 PROJECT INTELLIGENCE] ❌ Error in project status intelligence:', error);
        return {
            reply: 'I apologize, but I\'m having trouble accessing our project management system at the moment. Let me connect you with your project manager who can provide you with a detailed status update right away.',
            projectFound: false
        };
    }
}
//# sourceMappingURL=aiHandler.js.map