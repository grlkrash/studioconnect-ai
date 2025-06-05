/*
  Warnings:

  - A unique constraint covering the columns `[twilioPhoneNumber]` on the table `businesses` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "twilioPhoneNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "businesses_twilioPhoneNumber_key" ON "businesses"("twilioPhoneNumber");
