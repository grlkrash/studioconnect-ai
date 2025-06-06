import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
 * @param userPrompt The user's prompt/message.
 * @param systemPrompt An optional system message to guide the AI's behavior.
 * @param model The chat model to use.
 * @returns A promise that resolves to the AI's response text or null if no content.
 */
export const getChatCompletion = async (
  userPrompt: string,
  systemPrompt?: string,
  model: string = 'gpt-4o' // Or your preferred model like gpt-3.5-turbo
): Promise<string | null> => {
  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await openai.chat.completions.create({
      model: model,
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
 * @returns A promise that resolves to the path of the generated audio file or null if generation fails.
 */
export const generateSpeechFromText = async (
  textToSpeak: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'
): Promise<string | null> => {
  if (!textToSpeak || textToSpeak.trim().length === 0) {
    console.warn('[OpenAI TTS] Received empty text to speak, skipping.');
    return null;
  }
  console.log(`[OpenAI TTS] Generating speech for text: "${textToSpeak.substring(0, 50)}..."`);
  
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: textToSpeak,
    });

    const tempFileName = `openai_speech_${Date.now()}.mp3`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(tempFilePath, buffer);

    console.log(`[OpenAI TTS] Speech audio file saved to: ${tempFilePath}`);
    return tempFilePath;
  } catch (error) {
    console.error('[OpenAI TTS] Error generating speech:', error);
    return null;
  }
}; 