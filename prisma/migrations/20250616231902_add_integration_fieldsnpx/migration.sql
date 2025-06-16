/*
  Warnings:

  - You are about to drop the column `prefix_padding_ms` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `realtimeInstructions` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `silence_duration_ms` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `vad_threshold` on the `agent_configs` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OpenAiVoice" ADD VALUE 'FABLE';
ALTER TYPE "OpenAiVoice" ADD VALUE 'ONYX';
ALTER TYPE "OpenAiVoice" ADD VALUE 'NOVA';

-- AlterTable
ALTER TABLE "agent_configs" DROP COLUMN "prefix_padding_ms",
DROP COLUMN "realtimeInstructions",
DROP COLUMN "silence_duration_ms",
DROP COLUMN "vad_threshold",
ADD COLUMN     "ttsProvider" TEXT NOT NULL DEFAULT 'openai',
ADD COLUMN     "widgetTheme" JSONB DEFAULT '{}',
ALTER COLUMN "openaiVoice" SET DEFAULT 'NOVA';

-- AlterTable
ALTER TABLE "businesses" ALTER COLUMN "businessHours" DROP DEFAULT,
ALTER COLUMN "timezone" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "knowledge_base_businessId_projectId_idx" ON "knowledge_base"("businessId", "projectId");

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
