/*
  Warnings:

  - You are about to drop the column `prefix_padding_ms` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `realtimeInstructions` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `silence_duration_ms` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `vad_threshold` on the `agent_configs` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[businessId,type]` on the table `integrations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pm_tool_id,businessId]` on the table `projects` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[businessId,pm_tool_id]` on the table `projects` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'SyncStatus'
    ) THEN
        CREATE TYPE "SyncStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
    END IF;
END$$;

-- AlterTable
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "prefix_padding_ms",
DROP COLUMN IF EXISTS "realtimeInstructions",
DROP COLUMN IF EXISTS "silence_duration_ms",
DROP COLUMN IF EXISTS "vad_threshold",
ADD COLUMN IF NOT EXISTS     "ttsProvider" TEXT NOT NULL DEFAULT 'openai',
ADD COLUMN IF NOT EXISTS     "widgetTheme" JSONB DEFAULT '{}',
ALTER COLUMN "openaiVoice" SET DEFAULT 'NOVA';

-- AlterTable
ALTER TABLE "businesses" ALTER COLUMN "businessHours" DROP DEFAULT,
ALTER COLUMN "timezone" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS     "credentials" JSONB,
ADD COLUMN IF NOT EXISTS     "syncStatus" "SyncStatus" DEFAULT 'CONNECTED',
ADD COLUMN IF NOT EXISTS     "webhookId" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS     "projectId" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS     "assignee" TEXT,
ADD COLUMN IF NOT EXISTS     "due_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "pm_tool" TEXT,
ADD COLUMN IF NOT EXISTS     "pm_tool_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_businessId_type_key" ON "integrations"("businessId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "knowledge_base_businessId_projectId_idx" ON "knowledge_base"("businessId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "projects_pm_tool_id_businessId_key" ON "projects"("pm_tool_id", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "projects_businessId_pm_tool_id_key" ON "projects"("businessId", "pm_tool_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_class t ON c.conrelid = t.oid
        WHERE  t.relname = 'knowledge_base'
        AND    c.conname = 'knowledge_base_projectId_fkey'
    ) THEN
        ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;
