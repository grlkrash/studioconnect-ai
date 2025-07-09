import { Router, Request, Response, NextFunction } from 'express';
import { processMessage } from '../core/aiHandler';
import { initiateClickToCall } from '../services/notificationService';
import { PrismaClient, Prisma } from '@prisma/client';
import { findRelevantKnowledge } from '../core/ragService';
import { getChatCompletion } from '../services/openai';

const prisma = new PrismaClient();
const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationHistory, businessId, currentFlow, projectId } = req.body;
    if (!businessId) {
      res.status(400).json({ error: 'Missing required field: businessId' });
      return;
    }
    // Handle empty message as welcome message request
    if (!message || message.trim() === '') {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        include: { agentConfig: true },
      });
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      // Show branding for the PRO plan (branding is hidden only on ENTERPRISE)
      const showBranding = business.planTier === 'PRO';
      let welcomeMessage = 'Hey! How can I help you today?';
      if (business.agentConfig?.welcomeMessage) {
        welcomeMessage = business.agentConfig.welcomeMessage.replace(/\{businessName\}/gi, business.name);
      }
      res.status(200).json({
        reply: welcomeMessage,
        agentName: business.agentConfig?.agentName || 'AI Assistant',
        showBranding,
        currentFlow: null,
      });
      return;
    }
    // If a projectId is provided, perform scope-creep analysis first
    if (projectId) {
      try {
        // 1️⃣ Retrieve project-specific context from the knowledge base (RAG)
        const contextEntries = await findRelevantKnowledge(
          message,
          businessId,
          5,
          { projectId }
        );

        const projectContext = contextEntries.map(e => e.content).join('\n---\n');

        // 2️⃣ Ask the LLM whether the request is out of scope. We force a strict JSON response.
        const systemPrompt = `You are a senior project manager whose task is to detect scope creep in client requests. Analyse the client's latest request against the original project scope. Respond STRICTLY with valid JSON (no markdown, no comments) matching this TypeScript type:\n{\"isOutOfScope\": boolean, \"briefExplanation\": string}`;

        const analysisRaw = await getChatCompletion(
          `PROJECT_SCOPE:\n${projectContext || 'N/A'}\n\nCLIENT_REQUEST:\n${message}`,
          systemPrompt,
          'gpt-4o'
        );

        let isOutOfScope = false;
        let briefExplanation = '';
        try {
          const parsed = JSON.parse(analysisRaw || '{}');
          isOutOfScope = Boolean(parsed.isOutOfScope);
          briefExplanation = parsed.briefExplanation || '';
        } catch (_) {
          // Fallback – treat as in-scope if parsing fails
          isOutOfScope = false;
        }

        // 3️⃣ If out-of-scope, record the risk and respond gracefully to the client
        if (isOutOfScope) {
          await prisma.knowledgeBase.create({
            data: {
              businessId,
              projectId,
              content: `⚠️ Possible scope-creep request: "${message}"\nExplanation: ${briefExplanation}`,
              metadata: {
                type: 'SCOPE_CREEP_RISK'
              } as Prisma.JsonObject
            }
          });

          res.status(200).json({
            reply: "That's a great question. Let me check with the project manager and get back to you with the details.",
            currentFlow: null
          });
          return;
        }
        // If not out-of-scope, continue normally
      } catch (scopeErr) {
        console.error('[Scope-Creep Detection] Error:', scopeErr);
        // Fail-open: continue with normal processing
      }
    }

    // Standard processing for new leads or in-scope project chats
    const aiResponse = await processMessage({
      message,
      conversationHistory: conversationHistory || [],
      businessId,
      currentActiveFlow: currentFlow ?? null,
      projectId,
      channel: 'CHAT'
    });

    res.status(200).json(aiResponse);
    return;
  } catch (error) {
    console.error('Error in chat route:', error);
    next(error);
  }
});

router.post('/initiate-call', async (req, res, next) => {
  try {
    const { phoneNumber, businessId, conversationHistory } = req.body;
    if (!phoneNumber || !businessId) {
      res.status(400).json({ error: 'Missing required fields: phoneNumber and businessId' });
      return;
    }
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    if (!business.notificationPhoneNumber) {
      res.status(400).json({ error: 'Business has no notification phone number configured' });
      return;
    }
    const callResult = await initiateClickToCall({
      phoneNumber,
      businessNotificationPhoneNumber: business.notificationPhoneNumber,
      businessName: business.name,
      conversationHistory,
    });
    res.status(200).json({
      success: true,
      message: 'Call initiated successfully',
      callSid: callResult.callSid,
    });
    return;
  } catch (error) {
    console.error('Error in initiate-call route:', error);
    next(error);
  }
});

export default router; 