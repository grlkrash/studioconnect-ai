/*
  Warnings:

  - You are about to drop the column `twilioLanguage` on the `agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `twilioVoice` on the `agent_configs` table. All the data in the column will be lost.
  - The `openaiVoice` column on the `agent_configs` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "OpenAiVoice" AS ENUM ('ALLOY', 'ECHO', 'FABLE', 'ONYX', 'NOVA', 'SHIMMER');

-- AlterTable
ALTER TABLE "agent_configs" DROP COLUMN "twilioLanguage",
DROP COLUMN "twilioVoice",
DROP COLUMN "openaiVoice",
ADD COLUMN     "openaiVoice" "OpenAiVoice" NOT NULL DEFAULT 'NOVA';
