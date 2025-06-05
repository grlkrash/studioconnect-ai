"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessage = void 0;
const db_1 = require("../services/db");
const openai_1 = require("../services/openai");
const ragService_1 = require("./ragService");
const notificationService_1 = require("../services/notificationService");
const client_1 = require("@prisma/client");
/**
 * Enhances prompts for voice-friendly responses with SSML guidance
 */
const enhancePromptForVoice = (basePrompt, businessName) => {
    const voiceGuidance = `
You are a highly articulate and empathetic AI voice assistant${businessName ? ` for ${businessName}` : ''}. Your responses will be spoken aloud, so craft them to sound natural and conversational when heard.

VOICE RESPONSE GUIDELINES:
- Use a warm, professional, and conversational tone
- Speak as if you're having a friendly phone conversation
- Use natural speech patterns with appropriate pauses
- Keep sentences clear and not too long
- Use contractions naturally (I'm, you're, we'll, that's)
- Include verbal acknowledgments (Got it, Okay, Alright, Perfect)
- Ask follow-up questions naturally
- Avoid complex punctuation or special characters that don't translate well to speech

For emphasis on important information, you may optionally use simple SSML tags:
- <break time="300ms"/> for brief pauses
- <emphasis level="moderate">important word</emphasis> for key information
- Use sparingly and only where it genuinely improves clarity

${basePrompt}`;
    return voiceGuidance;
};
/**
 * Generate a natural acknowledgment to prepend to questions
 */
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
/**
 * Main AI handler that processes user messages and determines the appropriate response flow.
 * Routes to either FAQ (RAG), Lead Capture, or fallback flow based on intent.
 */
const processMessage = async (message, conversationHistory, businessId, currentActiveFlow) => {
    try {
        console.log(`AI Handler processing message for business ${businessId}: "${message}"`);
        console.log('Received currentActiveFlow:', currentActiveFlow);
        // DEBUG: Log the received conversation history
        console.log('Received conversationHistory on backend:', JSON.stringify(conversationHistory, null, 2));
        // Fetch the Business record to get the planTier
        const business = await db_1.prisma.business.findUnique({
            where: { id: businessId }
        });
        if (!business) {
            console.error(`Business not found for ID: ${businessId}. Cannot determine branding or agent config.`);
            return {
                reply: "Sorry, I'm having trouble finding configuration for this business.",
                showBranding: true // Default to showing branding if business not found
            };
        }
        // Determine if branding should be shown
        // Show branding for FREE and BASIC tiers, hide for PRO
        const showBranding = business.planTier === client_1.PlanTier.FREE || business.planTier === client_1.PlanTier.BASIC;
        console.log(`Business planTier: ${business.planTier}, Show Branding: ${showBranding}`);
        // Fetch agent configuration for persona and settings
        const agentConfig = await db_1.prisma.agentConfig.findUnique({
            where: { businessId },
            include: { questions: { orderBy: { order: 'asc' } } }
        });
        // DEFENSIVE LOGIC: Detect if we should continue lead capture based on conversation history
        let shouldForceLeadCapture = false;
        if (!currentActiveFlow && conversationHistory.length > 0) {
            console.log('No currentActiveFlow provided, analyzing conversation history...');
            // Check if the last assistant message was a lead capture question
            const lastAssistantMessage = [...conversationHistory].reverse().find(msg => msg.role === 'assistant');
            if (lastAssistantMessage && agentConfig?.questions) {
                const isLastMessageLeadQuestion = agentConfig.questions.some(q => q.questionText === lastAssistantMessage.content);
                if (isLastMessageLeadQuestion) {
                    console.log('Last assistant message was a lead capture question, forcing lead capture continuation');
                    shouldForceLeadCapture = true;
                }
            }
            // Also check if we've asked multiple lead questions in this conversation
            if (!shouldForceLeadCapture && agentConfig?.questions) {
                let leadQuestionCount = 0;
                for (const historyEntry of conversationHistory) {
                    if (historyEntry.role === 'assistant') {
                        const isLeadQuestion = agentConfig.questions.some(q => q.questionText === historyEntry.content);
                        if (isLeadQuestion) {
                            leadQuestionCount++;
                        }
                    }
                }
                if (leadQuestionCount >= 2) {
                    console.log(`Found ${leadQuestionCount} lead questions in history, forcing lead capture continuation`);
                    shouldForceLeadCapture = true;
                }
            }
            // Check if the last assistant message was an FAQ fallback offer and user responded positively
            if (!shouldForceLeadCapture && lastAssistantMessage) {
                const isFAQFallbackOffer = lastAssistantMessage.content.includes("I couldn't find a specific answer to that in my current knowledge") &&
                    lastAssistantMessage.content.includes("Would you like me to take down your details");
                if (isFAQFallbackOffer) {
                    console.log('Last message was FAQ fallback offer, checking user response...');
                    // Use AI to detect positive intent more intelligently
                    const intentCheckPrompt = `The user was asked: "Would you like me to take down your details so someone from our team can get back to you with the information you need?"

User's response: "${message}"

Does this response indicate they want to proceed with providing their details? Consider responses like:
- Explicit yes/agreement: "yes", "sure", "okay", "please do"  
- Implicit agreement: "that would be great", "sounds good", "go ahead"
- Conditional agreement: "yes, if you could", "that would be helpful"
- Questions showing interest: "what details do you need?", "how does that work?"

Respond with only YES or NO.`;
                    const isPositiveResponse = await (0, openai_1.getChatCompletion)(intentCheckPrompt, "You are an intent detection expert focused on identifying user agreement to proceed with lead capture.");
                    if ((isPositiveResponse || 'NO').trim().toUpperCase() === 'YES') {
                        console.log('User responded positively to FAQ fallback offer, transitioning to lead capture');
                        shouldForceLeadCapture = true;
                    }
                    else {
                        console.log('User declined or responded negatively to FAQ fallback offer');
                    }
                }
            }
        }
        // Step 1: Intent Recognition
        let intent;
        if (currentActiveFlow === 'LEAD_CAPTURE' || shouldForceLeadCapture) {
            intent = 'LEAD_CAPTURE';
            console.log('Continuing LEAD_CAPTURE flow based on state or defensive logic.');
        }
        else {
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

Classify as: LEAD_CAPTURE, FAQ, END_CALL, or OTHER`;
            const intentResponse = await (0, openai_1.getChatCompletion)(intentPrompt, "You are an intent classification expert. Respond with only: FAQ, LEAD_CAPTURE, END_CALL, or OTHER.");
            intent = (intentResponse || 'OTHER').trim().toUpperCase();
        }
        console.log(`Effective intent: ${intent}`);
        // Step 2: Route based on intent
        if (intent === 'FAQ') {
            // FAQ Flow - Use RAG to find relevant information
            console.log('Entering FAQ flow...');
            const relevantKnowledge = await (0, ragService_1.findRelevantKnowledge)(message, businessId, 3);
            if (relevantKnowledge && relevantKnowledge.length > 0) {
                // Found relevant snippets - construct context-aware response
                const contextSnippets = relevantKnowledge.map(s => s.content).join('\n---\n');
                const personaPrompt = agentConfig?.personaPrompt || "You are a helpful assistant.";
                const baseFaqPrompt = `Based on the following context, answer the user's question naturally and conversationally. Be helpful and engaging in your response. If the context doesn't provide a complete answer, politely say you don't have that specific information available. 

Context:
${contextSnippets}

User's Question: ${message}`;
                // Enhance the prompt for voice interaction
                const voiceEnhancedPrompt = enhancePromptForVoice(baseFaqPrompt, business.name);
                const aiResponse = await (0, openai_1.getChatCompletion)(voiceEnhancedPrompt, personaPrompt);
                // Add natural acknowledgment prefix to FAQ responses for voice
                const faqAcknowledgments = [
                    "I can help with that. ",
                    "Here's what I found: ",
                    "Let me share that information: ",
                    "I've got the answer for you: ",
                    "Sure, here's what I know: "
                ];
                const randomAcknowledgment = faqAcknowledgments[Math.floor(Math.random() * faqAcknowledgments.length)];
                const finalFaqReply = `${randomAcknowledgment}${aiResponse || "I'm having trouble accessing my knowledge base right now. Please try again later."}`;
                return {
                    reply: finalFaqReply,
                    currentFlow: null,
                    showBranding
                };
            }
            else {
                // No relevant knowledge found - offer to take details for follow-up
                console.log('No relevant knowledge found in FAQ flow - offering lead capture');
                return {
                    reply: "I checked my information but couldn't find specific details on that. Would you like me to take down your contact information so someone from our team can get back to you with the answer you need?",
                    currentFlow: null,
                    showBranding
                };
            }
        }
        else if (intent === 'END_CALL') {
            console.log('Entering END_CALL flow...');
            return {
                reply: "Thank you for contacting us! Have a great day and feel free to reach out anytime if you need assistance. Goodbye!",
                currentFlow: null,
                showBranding
            };
        }
        else if (intent === 'LEAD_CAPTURE') {
            // Lead Capture Flow - Guide through questions
            console.log('Entering Lead Capture flow...');
            console.log('Agent config questions:', agentConfig?.questions?.map((q) => ({ id: q.id, text: q.questionText, order: q.order })));
            if (!agentConfig || !agentConfig.questions || agentConfig.questions.length === 0) {
                return {
                    reply: "It looks like our lead capture system isn't set up yet. How else can I assist?",
                    currentFlow: null,
                    showBranding
                };
            }
            // Check if the INITIAL message that triggered lead capture was an emergency
            let isEmergency = false;
            const firstUserMessage = conversationHistory.find(entry => entry.role === 'user')?.content || '';
            if (firstUserMessage) {
                console.log(`Checking if initial message indicates emergency: "${firstUserMessage}"`);
                const emergencyCheckPrompt = `Does the following user message indicate an emergency situation (e.g., burst pipe, flooding, no heat in freezing weather, gas leak, electrical hazard, water heater leak)? Respond with only YES or NO. User message: '${firstUserMessage}'`;
                const isEmergencyResponse = await (0, openai_1.getChatCompletion)(emergencyCheckPrompt, "You are an emergency detection assistant specialized in identifying urgent home service situations.");
                isEmergency = (isEmergencyResponse || 'NO').trim().toUpperCase() === 'YES';
                if (isEmergency) {
                    console.log('Lead creation: Initial message WAS an EMERGENCY');
                }
                else {
                    console.log('Lead creation: Initial message was NOT an emergency');
                }
            }
            // Determine which questions to ask based on emergency status
            let questionsToAsk = agentConfig.questions;
            if (isEmergency) {
                console.log("EMERGENCY DETECTED: Filtering for essential questions...");
                // Filter for questions marked as essential for emergencies
                const essentialQuestions = questionsToAsk.filter(q => q.isEssentialForEmergency === true);
                if (essentialQuestions.length > 0) {
                    questionsToAsk = essentialQuestions;
                    console.log('Essential emergency questions:', questionsToAsk.map(q => q.questionText));
                }
                else {
                    // Fallback if no questions are marked as essential for emergency:
                    // Ask just the very first configured question as a bare minimum
                    if (agentConfig.questions && agentConfig.questions.length > 0) {
                        console.log("No essential questions marked for emergency, asking only the first configured question.");
                        questionsToAsk = agentConfig.questions.slice(0, 1);
                    }
                    else {
                        questionsToAsk = []; // No questions configured at all
                    }
                    console.log('Fallback emergency questions:', questionsToAsk.map(q => q.questionText));
                }
            }
            // Determine next unanswered question
            let nextQuestion = null;
            const answeredQuestions = new Set();
            // Analyze conversation history to find answered questions
            console.log('\n=== ANALYZING CONVERSATION HISTORY ===');
            for (let i = 0; i < conversationHistory.length - 1; i++) {
                const entry = conversationHistory[i];
                const nextEntry = conversationHistory[i + 1];
                console.log(`[${i}] ${entry.role}: "${entry.content}"`);
                if (entry.role === 'assistant') {
                    // Check if this message matches any of our questions
                    const matchedQuestion = questionsToAsk.find((q) => q.questionText === entry.content);
                    if (matchedQuestion && nextEntry && nextEntry.role === 'user') {
                        console.log(`  ✓ Matched question: "${matchedQuestion.questionText}" (ID: ${matchedQuestion.id})`);
                        console.log(`  ✓ User answer: "${nextEntry.content}"`);
                        answeredQuestions.add(matchedQuestion.id);
                    }
                }
            }
            console.log('\nAnswered question IDs:', Array.from(answeredQuestions));
            console.log('Total questions to ask in this flow:', questionsToAsk.length);
            console.log('Questions answered:', answeredQuestions.size);
            // Find first unanswered question
            for (const question of questionsToAsk) {
                if (!answeredQuestions.has(question.id)) {
                    nextQuestion = question;
                    console.log(`\nNext question to ask: "${question.questionText}" (ID: ${question.id}, Order: ${question.order})`);
                    break;
                }
            }
            if (nextQuestion) {
                // Determine if this is a follow-up question by checking conversation history
                let questionPrefix = "";
                const assistantLeadQuestions = conversationHistory.filter(m => m.role === 'assistant' && questionsToAsk.some(q => q.questionText === m.content));
                // If we've already asked at least one lead question, this is a follow-up
                if (assistantLeadQuestions.length > 0) {
                    const followUpPrefixes = ["Okay, and ", "Got it. ", "Alright. ", "Thanks. "];
                    questionPrefix = followUpPrefixes[Math.floor(Math.random() * followUpPrefixes.length)];
                }
                const leadQuestionReply = `${questionPrefix}${nextQuestion.questionText}`;
                return {
                    reply: leadQuestionReply,
                    currentFlow: 'LEAD_CAPTURE',
                    showBranding
                };
            }
            else {
                // All questions answered - create lead
                console.log('\n=== ALL QUESTIONS ANSWERED - CREATING LEAD ===');
                // Extract captured data from conversation history
                const capturedData = {};
                for (let i = 0; i < conversationHistory.length - 1; i++) {
                    const entry = conversationHistory[i];
                    if (entry.role === 'assistant') {
                        const matchedQuestion = questionsToAsk.find((q) => q.questionText === entry.content);
                        if (matchedQuestion && i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
                            const questionText = matchedQuestion.questionText;
                            const userAnswer = conversationHistory[i + 1].content;
                            // DEBUG: Log what's being captured
                            console.log(`Backend: For Question: "${questionText}"`);
                            console.log(`Backend: Captured Answer: "${userAnswer}"`);
                            console.log(`Backend: Type of Answer:`, typeof userAnswer);
                            capturedData[questionText] = userAnswer;
                        }
                    }
                }
                // DEBUG: Log final capturedData before saving
                console.log('Final capturedData before saving lead:', JSON.stringify(capturedData, null, 2));
                // Add emergency notes if this was detected as an emergency
                if (isEmergency && firstUserMessage) {
                    capturedData.emergency_notes = `User indicated an EMERGENCY situation in their initial message: "${firstUserMessage}"`;
                    console.log('Added emergency_notes to capturedData:', capturedData.emergency_notes);
                }
                // Map captured data to specific lead fields based on mapsToLeadField property
                let contactName = undefined;
                let contactEmail = undefined;
                let contactPhone = undefined;
                let notes = undefined;
                // Iterate through questions to find field mappings
                for (const question of questionsToAsk) {
                    // Check if this question has a mapsToLeadField property and if we have an answer for it
                    // Using type assertion since the field exists in schema but types may not be regenerated yet
                    const questionWithMapping = question;
                    if (questionWithMapping.mapsToLeadField && capturedData[question.questionText]) {
                        const answer = capturedData[question.questionText];
                        console.log(`Mapping question "${question.questionText}" to field "${questionWithMapping.mapsToLeadField}": ${answer}`);
                        // Map the answer to the appropriate field
                        switch (questionWithMapping.mapsToLeadField) {
                            case 'contactName':
                                contactName = answer;
                                break;
                            case 'contactEmail':
                                contactEmail = answer;
                                break;
                            case 'contactPhone':
                                contactPhone = answer;
                                break;
                            case 'notes':
                                notes = answer;
                                break;
                            default:
                                console.log(`Unknown mapsToLeadField value: ${questionWithMapping.mapsToLeadField}`);
                        }
                    }
                }
                // Log the mapped fields for debugging
                console.log('Mapped lead fields:', {
                    contactName,
                    contactEmail,
                    contactPhone,
                    notes
                });
                // Create lead record with appropriate priority
                const newLead = await db_1.prisma.lead.create({
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
                });
                // Send email notification to the business owner
                try {
                    if (business && business.notificationEmail) {
                        console.log(`Sending lead notification email to ${business.notificationEmail}...`);
                        // Prepare lead details for the email
                        const leadDetails = {
                            capturedData: newLead.capturedData,
                            conversationTranscript: newLead.conversationTranscript,
                            contactName: newLead.contactName,
                            contactEmail: newLead.contactEmail,
                            contactPhone: newLead.contactPhone,
                            notes: newLead.notes,
                            createdAt: newLead.createdAt
                        };
                        await (0, notificationService_1.sendLeadNotificationEmail)(business.notificationEmail, leadDetails, newLead.priority, business.name);
                        // Send confirmation email to customer if email was captured
                        if (newLead.contactEmail) {
                            try {
                                console.log(`Attempting to send lead confirmation email to customer: ${newLead.contactEmail}`);
                                await (0, notificationService_1.sendLeadConfirmationToCustomer)(newLead.contactEmail, business.name, newLead, isEmergency);
                            }
                            catch (customerEmailError) {
                                console.error('Failed to send confirmation email to customer:', customerEmailError);
                            }
                        }
                        else {
                            console.log('No customer email captured for confirmation email.');
                        }
                        // Handle emergency voice call if needed
                        if (isEmergency && business.notificationPhoneNumber) {
                            try {
                                console.log(`Initiating emergency voice call to ${business.notificationPhoneNumber}...`);
                                // Construct a more detailed lead summary with improved emergency prioritization
                                let leadSummaryForCall = `Lead from ${newLead.contactName || 'unknown contact'}.`;
                                // Look for problem description in captured data with enhanced priority logic
                                if (newLead.capturedData && typeof newLead.capturedData === 'object') {
                                    const captured = newLead.capturedData;
                                    let problemDescription = null;
                                    // PRIORITY 1: Look for answers to questions marked as isEssentialForEmergency that contain emergency-specific keywords
                                    const emergencyQuestionKeys = Object.keys(captured).filter(key => {
                                        const questionFromConfig = questionsToAsk.find(q => q.questionText === key && q.isEssentialForEmergency);
                                        if (!questionFromConfig)
                                            return false;
                                        // Check if the question itself is emergency-focused
                                        const emergencyKeywords = ['emergency', 'urgent', 'describe', 'problem', 'issue', 'situation', 'happening', 'wrong'];
                                        return emergencyKeywords.some(keyword => key.toLowerCase().includes(keyword));
                                    });
                                    if (emergencyQuestionKeys.length > 0) {
                                        // Use the first emergency-specific question answer
                                        problemDescription = captured[emergencyQuestionKeys[0]];
                                        console.log(`Using answer from emergency-specific question: "${emergencyQuestionKeys[0]}"`);
                                    }
                                    // PRIORITY 2: Look for emergency_notes (initial transcribed emergency message)
                                    if (!problemDescription && captured.emergency_notes) {
                                        // Extract the actual emergency message from emergency_notes
                                        const match = captured.emergency_notes.match(/initial message: "([^"]+)"/i);
                                        if (match && match[1]) {
                                            problemDescription = match[1];
                                            console.log('Using emergency_notes content for voice alert');
                                        }
                                        else {
                                            problemDescription = captured.emergency_notes;
                                        }
                                    }
                                    // PRIORITY 3: General issue/problem description questions
                                    if (!problemDescription) {
                                        const issueKey = Object.keys(captured).find(key => key.toLowerCase().includes('issue') ||
                                            key.toLowerCase().includes('problem') ||
                                            key.toLowerCase().includes('describe') ||
                                            (key.toLowerCase().includes('what') && key.toLowerCase().includes('happening')));
                                        if (issueKey) {
                                            problemDescription = captured[issueKey];
                                            console.log(`Using general issue description from: "${issueKey}"`);
                                        }
                                    }
                                    // PRIORITY 4: Fall back to first user message
                                    if (!problemDescription) {
                                        const firstUserMessage = conversationHistory.find(entry => entry.role === 'user')?.content;
                                        if (firstUserMessage) {
                                            problemDescription = firstUserMessage;
                                            console.log('Using first user message as fallback for voice alert');
                                        }
                                    }
                                    // Construct the summary with the best available description
                                    if (problemDescription) {
                                        // Truncate for voice clarity (max ~150 chars)
                                        const truncatedDescription = problemDescription.length > 150
                                            ? problemDescription.substring(0, 150) + '...'
                                            : problemDescription;
                                        leadSummaryForCall += ` Issue stated: ${truncatedDescription}`;
                                    }
                                    else {
                                        leadSummaryForCall += ' Details in system.';
                                    }
                                }
                                await (0, notificationService_1.initiateEmergencyVoiceCall)(business.notificationPhoneNumber, business.name, leadSummaryForCall, newLead.id);
                                console.log('Emergency voice call initiated successfully');
                            }
                            catch (callError) {
                                console.error('Failed to initiate emergency voice call:', callError);
                            }
                        }
                        else if (isEmergency) {
                            console.log('No notification phone number configured for emergency calls');
                        }
                    }
                    else {
                        console.log('No notification email configured for this business');
                    }
                }
                catch (emailError) {
                    // Don't let email failures break the lead capture flow
                    console.error('Failed to send notification email:', emailError);
                }
                if (isEmergency) {
                    return {
                        reply: "Thank you for providing that information. We've identified this as an URGENT situation and will prioritize your request. Our team will contact you as soon as possible to address your emergency.",
                        currentFlow: null,
                        showBranding
                    };
                }
                else {
                    // Use custom completion message if available, otherwise use default
                    const completionMessage = agentConfig?.leadCaptureCompletionMessage ||
                        "Thanks for providing that information! Our team will review it and get back to you ASAP.";
                    return {
                        reply: completionMessage,
                        currentFlow: null,
                        showBranding
                    };
                }
            }
        }
        else {
            // OTHER/Fallback Flow
            console.log('Entering OTHER/fallback flow...');
            // Check if user just declined the FAQ fallback offer
            const lastAssistantMessage = [...conversationHistory].reverse().find(msg => msg.role === 'assistant');
            if (lastAssistantMessage &&
                lastAssistantMessage.content.includes("I couldn't find a specific answer to that in my current knowledge") &&
                lastAssistantMessage.content.includes("Would you like me to take down your details")) {
                console.log('User appears to have declined FAQ fallback offer, providing alternative help');
                // Use AI to detect if this is a decline and provide helpful alternative
                const declineCheckPrompt = `The user was asked: "Would you like me to take down your details so someone from our team can get back to you with the information you need?"

User's response: "${message}"

Does this response indicate they declined or don't want to provide details? Consider responses like:
- Explicit no: "no", "no thanks", "not right now"
- Soft decline: "maybe later", "I'll think about it"
- Deflection: changing subject, asking different questions

Respond with only YES or NO.`;
                const isDeclineResponse = await (0, openai_1.getChatCompletion)(declineCheckPrompt, "You are an intent detection expert focused on identifying user decline or reluctance.");
                if ((isDeclineResponse || 'NO').trim().toUpperCase() === 'YES') {
                    console.log('User declined FAQ fallback offer, providing alternative assistance');
                    return {
                        reply: "No problem! Is there anything else I can help you with today? I'm here to assist with any questions you might have.",
                        currentFlow: null,
                        showBranding
                    };
                }
            }
            // Check if this is the start of a conversation
            if (conversationHistory.length === 0 && agentConfig?.welcomeMessage) {
                return {
                    reply: agentConfig.welcomeMessage,
                    currentFlow: null,
                    showBranding
                };
            }
            // General chat with persona
            const personaPrompt = agentConfig?.personaPrompt || "You are a helpful assistant.";
            const aiResponse = await (0, openai_1.getChatCompletion)(message, personaPrompt);
            return {
                reply: aiResponse || "How can I help you today?",
                currentFlow: null,
                showBranding
            };
        }
    }
    catch (error) {
        console.error('Error in processMessage:', error);
        return {
            reply: "I apologize, but I'm having trouble processing your request right now. Please try again later or contact us directly.",
            currentFlow: null,
            showBranding: true // Default to showing branding in error cases
        };
    }
};
exports.processMessage = processMessage;
//# sourceMappingURL=aiHandler.js.map