/*
  Warnings:

  - Added the required column `conversationId` to the `call_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `call_logs` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `direction` on the `call_logs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `updatedAt` to the `conversations` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('VOICE', 'CHAT');

-- AlterTable
ALTER TABLE "call_logs" ADD COLUMN     "content" TEXT,
ADD COLUMN     "conversationId" TEXT NOT NULL,
ADD COLUMN     "type" "CallType" NOT NULL,
DROP COLUMN "direction",
ADD COLUMN     "direction" "CallDirection" NOT NULL;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "metadata" JSONB DEFAULT '{}',
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
