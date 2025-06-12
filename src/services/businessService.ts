import { prisma } from './db';

export async function getBusinessIdFromPhoneNumber(phoneNumber: string): Promise<string | null> {
  const business = await prisma.business.findFirst({
    where: { phone: phoneNumber },
    select: { id: true }
  });
  return business?.id || null;
}

export async function getBusinessWelcomeMessage(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { welcomeMessage: true }
  });
  return business?.welcomeMessage || 'Welcome to our service!';
} 