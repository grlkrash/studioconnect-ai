import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import crypto from 'crypto'

dotenv.config(); // Ensures OPENAI_API_KEY is loaded from .env

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates an embedding vector for the given text using OpenAI's API.
 * @param text The text to embed.
 * @param model The embedding model to use.
 * @returns A promise that resolves to an array of numbers (the embedding vector).
 */
export const getEmbedding = async (
  text: string,
  model: string = 'text-embedding-3-small'
): Promise<number[]> => {
  try {
    const response = await openai.embeddings.create({
      model: model,
      input: text.replace(/\n/g, ' '), // OpenAI recommends replacing newlines with spaces
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error getting embedding from OpenAI:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
};

/**
 * Gets a chat completion from OpenAI's API.
 * Can either take a user prompt and system prompt, or a full message history.
 * @param userPrompt The user's prompt/message.
 * @param systemPrompt An optional system message to guide the AI's behavior.
 * @param model The chat model to use.
 * @returns A promise that resolves to the AI's response text or null if no content.
 */
export function getChatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  model?: string
): Promise<string | null>;
export function getChatCompletion(
  userPrompt: string,
  systemPrompt?: string,
  model?: string
): Promise<string | null>;
export async function getChatCompletion(
  promptOrMessages: string | OpenAI.Chat.ChatCompletionMessageParam[],
  systemPromptOrModel?: string,
  model: string = 'gpt-4o'
): Promise<string | null> {
  try {
    let messages: OpenAI.Chat.ChatCompletionMessageParam[];
    let chatModel = model;

    if (Array.isArray(promptOrMessages)) {
      messages = promptOrMessages;
      if (systemPromptOrModel) {
        chatModel = systemPromptOrModel;
      }
    } else {
      messages = [];
      const userPrompt = promptOrMessages;
      const systemPrompt = systemPromptOrModel;
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });
    }

    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: messages,
    });
    return response.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('Error getting chat completion from OpenAI:', error);
    throw error; // Re-throw the error
  }
};

/**
 * Transcribes audio using OpenAI's Whisper API.
 * @param audioFilePath Path to the saved audio file to transcribe.
 * @returns A promise that resolves to the transcribed text or null if transcription fails.
 */
export const getTranscription = async (
  audioFilePath: string
): Promise<string | null> => {
  console.log(`[OpenAI Service] Transcribing audio file at: ${audioFilePath}`);
  
  if (!fs.existsSync(audioFilePath)) {
    console.error(`[OpenAI Service] Audio file not found at path: ${audioFilePath}`);
    return null;
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      // language: 'en', // Optional: specify language if known
      // response_format: 'text' // Optional: default is json, but text can be simpler
    });

    // For 'json' response_format (default):
    const transcribedText = transcription.text;
    console.log(`[OpenAI Service] Transcription successful. Text: "${transcribedText.substring(0, 100)}..."`);
    return transcribedText;
  } catch (error) {
    console.error('[OpenAI Service] Error getting transcription from OpenAI:', error);
    throw error; // Re-throw the error to be handled by the caller
  } finally {
    // Clean up the temporary audio file after transcription
    try {
      if (fs.existsSync(audioFilePath)) {
        fs.unlinkSync(audioFilePath);
        console.log(`[OpenAI Service] Deleted temporary audio file: ${audioFilePath}`);
      }
    } catch (cleanupError) {
      console.error(`[OpenAI Service] Error deleting temporary audio file ${audioFilePath}:`, cleanupError);
    }
  }
};

/**
 * Generates speech from text using the specified provider with automatic fallback
 * @param text - Text to convert to speech
 * @param voice - Voice to use (provider-specific)
 * @param model - Model to use (provider-specific)
 * @param provider - TTS provider ('openai', 'polly', 'elevenlabs')
 * @param voiceSettings - Additional voice settings for ElevenLabs
 * @returns Path to generated audio file or null if failed
 */
export async function generateSpeechFromText(
  text: string,
  voice: string = 'nova',
  model: string = 'tts-1',
  provider: 'openai' | 'polly' | 'elevenlabs' = 'elevenlabs',
  voiceSettings?: any
): Promise<string | null> {
  if (!text || text.trim().length === 0) {
    console.warn('[TTS] Empty text provided, skipping generation')
    return null
  }

  const cleanText = text.trim()
  console.log(`[TTS] Generating speech with ${provider} provider: "${cleanText.substring(0, 50)}..."`)

  try {
    switch (provider) {
      case 'elevenlabs':
        const { generateSpeechWithElevenLabs } = await import('./elevenlabs')
        return await generateSpeechWithElevenLabs(cleanText, voice, model, voiceSettings)

      case 'openai':
        return await generateSpeechWithOpenAI(cleanText, voice as any, model as any)

      case 'polly':
        return await generateSpeechWithPolly(cleanText, voice, model)

      default:
        console.error(`[TTS] Unknown provider: ${provider}`)
        return null
    }
  } catch (error) {
    console.error(`[TTS] Error with ${provider} provider:`, error)
    return null
  }
}

/**
 * Generates speech using OpenAI TTS with enhanced error handling
 */
async function generateSpeechWithOpenAI(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
  model: 'tts-1' | 'tts-1-hd' = 'tts-1-hd'
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('[OpenAI TTS] OPENAI_API_KEY is not set')
    return null
  }

  try {
    console.log(`[OpenAI TTS] Generating speech with voice ${voice} and model ${model}`)
    
    const response = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: 'mp3',
      speed: 1.0,
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    const filePath = path.join(os.tmpdir(), `openai_speech_${Date.now()}.mp3`)
    await fs.promises.writeFile(filePath, buffer)
    
    console.log(`[OpenAI TTS] Successfully generated speech: ${filePath}`)
    return filePath
  } catch (error) {
    console.error('[OpenAI TTS] Error generating speech:', error)
    return null
  }
}

/**
 * Generates speech using Amazon Polly with enhanced error handling
 */
async function generateSpeechWithPolly(
  text: string,
  voice: string = 'Amy',
  model: string = 'tts-1'
): Promise<string | null> {
  // AWS Polly implementation would go here
  // For now, fallback to OpenAI
  console.warn('[Polly TTS] Polly not implemented, falling back to OpenAI')
  return await generateSpeechWithOpenAI(text, 'nova', 'tts-1-hd')
} 