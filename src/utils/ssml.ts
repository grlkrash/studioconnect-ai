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
 * Wrap arbitrary text in SSML with a global <prosody> tag so we can tune speed in one place.
 * Also adds short pauses after sentence-ending punctuation for more natural pacing.
 */
export function formatForSpeech(text: string, settings: SpeechSettings = {}): string {
  if (!text) return ''

  const safeSpeed = Math.min(Math.max(settings.speed ?? 1.0, 0.8), 1.2)
  const escaped = escapeXml(text.trim())
    // Insert a 400 ms pause after sentence endings for breath.
    .replace(/([\.\?!])\s+/g, `$1 <break time=\"400ms\"/> `)

  return `<speak><prosody rate=\"${safeSpeed}\">${escaped}</prosody></speak>`
} 