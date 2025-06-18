import crypto from 'crypto'

/**
 * Generates a random code verifier for PKCE.
 * RFC 7636 section-4.1 requires the verifier to be between 43 and 128 characters.
 */
export function generateCodeVerifier (length = 64): string {
  const random = crypto.randomBytes(length)
  // Base64-url encode (RFC 4648 §5)
  return random.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Derives a code challenge from a verifier using SHA-256 and base64url encoding.
 */
export function deriveCodeChallenge (verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
} 