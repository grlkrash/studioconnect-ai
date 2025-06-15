import { prisma } from './db';
import { normalizePhoneNumber } from '../utils/phoneHelpers';

export async function getClientByPhoneNumber(phoneNumber: string): Promise<any | null> {
  const normalized = normalizePhoneNumber(phoneNumber)

  const client = await prisma.client.findFirst({
    where: { phone: normalized }
  })

  return client
} 