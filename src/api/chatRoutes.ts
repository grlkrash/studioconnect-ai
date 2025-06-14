import { Router, Request, Response, NextFunction } from 'express';
import { processMessage } from '../core/aiHandler';
import { initiateClickToCall } from '../services/notificationService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, conversationHistory, businessId, currentFlow } = req.body;
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
    const aiResponse = await processMessage(message, conversationHistory || [], businessId, currentFlow);
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