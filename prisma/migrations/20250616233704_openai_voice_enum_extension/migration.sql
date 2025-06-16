-- Ensure enum values are only added if they do not already exist to avoid duplicate errors during deploy
ALTER TYPE "OpenAiVoice" ADD VALUE IF NOT EXISTS 'FABLE';
ALTER TYPE "OpenAiVoice" ADD VALUE IF NOT EXISTS 'ONYX';
ALTER TYPE "OpenAiVoice" ADD VALUE IF NOT EXISTS 'NOVA';
