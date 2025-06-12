import { prisma } from './db';

export async function getClientByPhoneNumber(phoneNumber: string): Promise<any | null> {
  const client = await prisma.client.findFirst({
    where: { phone: phoneNumber }
  });
  return client;
} 