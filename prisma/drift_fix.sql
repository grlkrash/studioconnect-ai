-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'SYNCING', 'ERROR');

-- AlterEnum
BEGIN;
CREATE TYPE "BusinessType_new" AS ENUM ('BRANDING', 'WEB_DESIGN', 'MARKETING', 'DIGITAL', 'CREATIVE', 'DESIGN_AGENCY', 'ANIMATION_STUDIO', 'VFX_STUDIO', 'PRODUCTION_STUDIO', 'OTHER');
ALTER TABLE "businesses" ALTER COLUMN "businessType" DROP DEFAULT;
ALTER TABLE "businesses" ALTER COLUMN "businessType" TYPE "BusinessType_new" USING ("businessType"::text::"BusinessType_new");
ALTER TYPE "BusinessType" RENAME TO "BusinessType_old";
ALTER TYPE "BusinessType_new" RENAME TO "BusinessType";
DROP TYPE "BusinessType_old";
ALTER TABLE "businesses" ALTER COLUMN "businessType" SET DEFAULT 'OTHER';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OpenAiVoice" ADD VALUE 'ASH';
ALTER TYPE "OpenAiVoice" ADD VALUE 'BALLAD';
ALTER TYPE "OpenAiVoice" ADD VALUE 'CORAL';
ALTER TYPE "OpenAiVoice" ADD VALUE 'SAGE';
ALTER TYPE "OpenAiVoice" ADD VALUE 'VERSE';

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "ttsProvider" TEXT NOT NULL DEFAULT 'openai',
ADD COLUMN     "widgetTheme" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "credentials" JSONB,
ADD COLUMN     "encryptedApiKey" TEXT,
ADD COLUMN     "syncStatus" "IntegrationSyncStatus" NOT NULL DEFAULT 'DISCONNECTED',
ADD COLUMN     "webhookId" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "integrations_businessId_type_key" ON "integrations"("businessId", "type");

-- CreateIndex
CREATE INDEX "knowledge_base_businessId_projectId_idx" ON "knowledge_base"("businessId", "projectId");

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

