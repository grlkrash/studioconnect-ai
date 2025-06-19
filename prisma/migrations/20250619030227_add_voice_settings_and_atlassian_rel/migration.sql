-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "voiceSettings" JSONB;

-- CreateTable
CREATE TABLE "AtlassianAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtlassianAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtlassianAccount_accountId_key" ON "AtlassianAccount"("accountId");

-- CreateIndex
CREATE INDEX "AtlassianAccount_businessId_idx" ON "AtlassianAccount"("businessId");

-- AddForeignKey
ALTER TABLE "AtlassianAccount" ADD CONSTRAINT "AtlassianAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
