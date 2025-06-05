-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'BASIC', 'PRO');

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "leadCaptureCompletionMessage" TEXT;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "planTier" "PlanTier" NOT NULL DEFAULT 'FREE';
