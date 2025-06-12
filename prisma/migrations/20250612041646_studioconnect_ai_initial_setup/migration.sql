/*
  Warnings:

  - The values [REAL_ESTATE,LAW,HVAC,PLUMBING] on the enum `BusinessType` will be removed. If these variants are still used in the database, this will fail.

*/
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

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "prefix_padding_ms" INTEGER,
ADD COLUMN     "realtimeInstructions" TEXT,
ADD COLUMN     "silence_duration_ms" INTEGER,
ADD COLUMN     "vad_threshold" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "businessHours" JSONB DEFAULT '{"monday":{"start":"9:00","end":"17:00"},"tuesday":{"start":"9:00","end":"17:00"},"wednesday":{"start":"9:00","end":"17:00"},"thursday":{"start":"9:00","end":"17:00"},"friday":{"start":"9:00","end":"17:00"}}',
ADD COLUMN     "timezone" TEXT DEFAULT 'America/New_York';
