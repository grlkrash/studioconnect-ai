import { prisma } from '../db'

/**
 * Returns the `clientId` for the given client name within a business.
 * Creates the Client row on-demand when it does not yet exist.
 * This utility keeps provider code succinct and centralises the logic.
 */
export async function getOrCreateClient (
  businessId: string,
  name: string,
  email?: string,
  phone?: string,
): Promise<string> {
  // Normalise name to avoid accidental duplicates like trailing spaces
  const safeName = name.trim() || 'Client'

  let client = await prisma.client.findFirst({ where: { businessId, name: safeName } })
  if (client) return client.id

  client = await prisma.client.create({
    data: {
      businessId,
      name: safeName,
      email: email?.trim() || undefined,
      phone: phone?.trim() || undefined,
    },
  })
  return client.id
} 