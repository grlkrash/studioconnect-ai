import { PrismaClient } from "@prisma/client"

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = global as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "postgresql://user:password@localhost:5434/app_db"
      }
    }
  })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma 