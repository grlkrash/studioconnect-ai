export interface SpeechSettings {
  /** Speaking speed multiplier – values between 0.8 (slower) and 1.2 (faster). */
  speed?: number
}

/**
 * Very small XML escape helper – sufficient for SSML subset.
 */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Formats text for speech synthesis with appropriate markup based on provider
 * @param text - The input text to format
 * @param options - Formatting options
 * @param provider - TTS provider (affects markup format)
 * @returns Formatted text ready for TTS
 */
export function formatForSpeech(
  text: string,
  options: {
    speed?: number;
    pauseAfterSentences?: number;
    pauseAfterCommas?: number;
  } = {},
  provider: 'openai' | 'polly' | 'elevenlabs' = 'elevenlabs'
): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // ElevenLabs doesn't support SSML, return clean text
  if (provider === 'elevenlabs') {
    return text.trim();
  }

  const {
    speed = 1.0,
    pauseAfterSentences = 400,
    pauseAfterCommas = 200,
  } = options;

  // For OpenAI and Polly, apply SSML formatting
  let formattedText = text.trim();

  // Add natural pauses after sentences
  formattedText = formattedText.replace(/([.!?])\s+/g, `$1<break time="${pauseAfterSentences}ms"/> `);
  
  // Add shorter pauses after commas for natural flow
  formattedText = formattedText.replace(/,\s+/g, `,<break time="${pauseAfterCommas}ms"/> `);

  // Wrap in SSML speak tag with prosody control
  return `<speak><prosody rate="${speed}">${formattedText}</prosody></speak>`;
} 