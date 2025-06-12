import { prisma } from './db';
import { Business, AgentConfig } from '@prisma/client';

export async function getBusinessIdFromPhoneNumber(phoneNumber: string): Promise<string | null> {
  const business = await prisma.business.findFirst({
    where: { twilioPhoneNumber: phoneNumber },
    select: { id: true }
  });
  return business?.id || null;
}

export async function getBusinessWelcomeMessage(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { agentConfig: true }
  });
  return business?.agentConfig?.welcomeMessage || 'Welcome to our service!';
} 