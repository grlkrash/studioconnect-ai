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
CREATE TYPE "SyncStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

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
ALTER TABLE "integrations" ADD COLUMN     "credentials" JSONB,
ADD COLUMN     "syncStatus" "SyncStatus" DEFAULT 'CONNECTED',
ADD COLUMN     "webhookId" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "assignee" TEXT,
ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "pm_tool" TEXT,
ADD COLUMN     "pm_tool_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "integrations_businessId_type_key" ON "integrations"("businessId", "type");

-- CreateIndex
CREATE INDEX "knowledge_base_businessId_projectId_idx" ON "knowledge_base"("businessId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_pm_tool_id_businessId_key" ON "projects"("pm_tool_id", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_businessId_pm_tool_id_key" ON "projects"("businessId", "pm_tool_id");

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
