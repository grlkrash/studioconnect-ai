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
 * Generates speech from text using OpenAI's Text-to-Speech API.
 * @param textToSpeak The text to convert to speech.
 * @param voice The voice to use for speech generation.
 * @param model The TTS model to use (tts-1 or tts-1-hd).
 * @returns A promise that resolves to the path of the generated audio file or null if generation fails.
 */
export const generateSpeechFromText = async (
  textToSpeak: string,
  voice: string = 'nova',
  model: 'tts-1' | 'tts-1-hd' = 'tts-1',
  provider: 'openai' | 'polly' = 'openai'
): Promise<string | null> => {
  if (!textToSpeak || textToSpeak.trim().length === 0) {
    console.warn('[OpenAI TTS] Received empty text to speak, skipping.');
    return null;
  }

  // ------------------------------------------------------------------
  //  Simple disk-based cache to avoid regenerating identical speech
  //  Hash key = sha256(text + voice + model + provider)
  //  Cached under: os.tmpdir()/scai_tts_cache/<hash>.mp3
  // ------------------------------------------------------------------

  let cachedPath: string | null = null
  try {
    const cacheDir = path.join(os.tmpdir(), 'scai_tts_cache')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const hash = crypto.createHash('sha256').update(`${provider}|${model}|${voice}|${textToSpeak}`).digest('hex')
    cachedPath = path.join(cacheDir, `${hash}.mp3`)
    if (fs.existsSync(cachedPath)) {
      console.log(`[OpenAI TTS] Returning cached speech (hash=${hash.slice(0,8)})`)
      return cachedPath
    }
  } catch (cacheErr) {
    // Non-fatal: continue without cache
    console.warn('[OpenAI TTS] Cache access issue, continuing without cache:', cacheErr instanceof Error ? cacheErr.message : cacheErr)
  }
  console.log(`[OpenAI TTS] Generating speech for text: "${textToSpeak.substring(0, 50)}..." using model: ${model}`);
  
  try {
    if (provider === 'openai') {
      const mp3 = await openai.audio.speech.create({
        model,
        voice: voice.toLowerCase() as any,
        input: textToSpeak,
      })

      const buffer = Buffer.from(await mp3.arrayBuffer())
      const targetPath = cachedPath || path.join(os.tmpdir(), `openai_speech_${Date.now()}.mp3`)
      await fs.promises.writeFile(targetPath, buffer)
      return targetPath
    }

    // Polly fallback
    const polly = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' })
    const synth = new SynthesizeSpeechCommand({
      Text: textToSpeak,
      OutputFormat: 'mp3',
      VoiceId: voice.charAt(0).toUpperCase() + voice.slice(1).toLowerCase() as any,
    })
    const res = await polly.send(synth)
    const uint8 = await res.AudioStream?.transformToByteArray()
    if (!uint8) throw new Error('Polly audio empty')
    const targetPath = cachedPath || path.join(os.tmpdir(), `polly_speech_${Date.now()}.mp3`)
    await fs.promises.writeFile(targetPath, Buffer.from(uint8))
    return targetPath
  } catch (error) {
    console.error('[TTS] Error generating speech:', error)
    return null
  }
}; 