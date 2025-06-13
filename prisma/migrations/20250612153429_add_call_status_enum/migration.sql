/*
  Warnings:

  - Changed the type of `status` on the `call_logs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER', 'CANCELED');

-- AlterTable
ALTER TABLE "call_logs" DROP COLUMN "status",
ADD COLUMN     "status" "CallStatus" NOT NULL;
