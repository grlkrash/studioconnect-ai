-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "openaiModel" TEXT NOT NULL DEFAULT 'tts-1',
ADD COLUMN     "openaiVoice" TEXT NOT NULL DEFAULT 'nova',
ADD COLUMN     "useOpenaiTts" BOOLEAN NOT NULL DEFAULT true;
