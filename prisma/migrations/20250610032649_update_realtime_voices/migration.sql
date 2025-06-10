/*
  Warnings:

  - The values [FABLE,ONYX,NOVA] on the enum `OpenAiVoice` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OpenAiVoice_new" AS ENUM ('ALLOY', 'ASH', 'BALLAD', 'CORAL', 'ECHO', 'SAGE', 'SHIMMER', 'VERSE');
ALTER TABLE "agent_configs" ALTER COLUMN "openaiVoice" DROP DEFAULT;
ALTER TABLE "agent_configs" ALTER COLUMN "openaiVoice" TYPE "OpenAiVoice_new" USING ("openaiVoice"::text::"OpenAiVoice_new");
ALTER TYPE "OpenAiVoice" RENAME TO "OpenAiVoice_old";
ALTER TYPE "OpenAiVoice_new" RENAME TO "OpenAiVoice";
DROP TYPE "OpenAiVoice_old";
ALTER TABLE "agent_configs" ALTER COLUMN "openaiVoice" SET DEFAULT 'ALLOY';
COMMIT;

-- AlterTable
ALTER TABLE "agent_configs" ALTER COLUMN "openaiVoice" SET DEFAULT 'ALLOY';
