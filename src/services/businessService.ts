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

  return agentConfig?.welcomeMessage || 'Welcome to our service!'
} 