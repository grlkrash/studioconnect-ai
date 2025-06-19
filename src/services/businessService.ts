import { prisma } from './db';
import { normalizePhoneNumber } from '../utils/phoneHelpers';

export async function getBusinessIdFromPhoneNumber(phoneNumber: string): Promise<string | null> {
  const normalized = normalizePhoneNumber(phoneNumber)

  const business = await prisma.business.findFirst({
    where: { twilioPhoneNumber: normalized },
    select: { id: true }
  })

  return business?.id || null
}

export async function getBusinessWelcomeMessage(businessId: string): Promise<string> {
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId },
    select: { 
      welcomeMessage: true,
      voiceGreetingMessage: true,
      agentName: true
    }
  })

  // Fetch business name for dynamic placeholder replacement
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true }
  })

  const bizName = business?.name || 'our business'
  const agentName = agentConfig?.agentName || 'AI Account Manager'

  // Prioritize voiceGreetingMessage for voice calls
  if (agentConfig?.voiceGreetingMessage && agentConfig.voiceGreetingMessage.trim().length > 5) {
    return agentConfig.voiceGreetingMessage.replace(/\{businessName\}/gi, bizName)
  }

  if (agentConfig?.welcomeMessage && agentConfig.welcomeMessage.trim().length > 5) {
    return agentConfig.welcomeMessage.replace(/\{businessName\}/gi, bizName)
  }

  // Enhanced professional default welcome
  return `Good day! Thank you for calling ${bizName}. I'm ${agentName}, your dedicated creative strategist, here to assist with your brand projects and creative initiatives. How may I help you today?`
} 