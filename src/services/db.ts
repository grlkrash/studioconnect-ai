import { PrismaClient } from '../../generated/prisma'

declare global {
  // This prevents TypeScript errors for the global variable
  var __prisma: PrismaClient | undefined
}

// Singleton pattern to prevent multiple database connections
export const prisma = 
  globalThis.__prisma ??
  new PrismaClient({
    log: ['query'],
  })

// In development, save the instance to prevent hot reload from creating new connections
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

export default prisma 