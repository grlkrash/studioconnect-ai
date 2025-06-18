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
    select: { welcomeMessage: true }
  })

  // Fetch business name for dynamic placeholder replacement
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true }
  })

  const bizName = business?.name || 'our business'

  if (agentConfig?.welcomeMessage && agentConfig.welcomeMessage.trim()) {
    return agentConfig.welcomeMessage.replace(/\{businessName\}/gi, bizName)
  }

  // Improved default welcome
  return `Hello! Thanks for calling ${bizName}. How can I help you today?`
} 