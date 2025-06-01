-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL';
