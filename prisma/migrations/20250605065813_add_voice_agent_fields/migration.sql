-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "voiceCompletionMessage" TEXT,
ADD COLUMN     "voiceEmergencyMessage" TEXT,
ADD COLUMN     "voiceEndCallMessage" TEXT,
ADD COLUMN     "voiceGreetingMessage" TEXT;
