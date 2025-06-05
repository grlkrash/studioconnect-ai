-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "twilioLanguage" TEXT NOT NULL DEFAULT 'en-US',
ADD COLUMN     "twilioVoice" TEXT NOT NULL DEFAULT 'alice';
