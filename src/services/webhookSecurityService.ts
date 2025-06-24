import crypto from 'crypto'

export interface WebhookSecurityConfig {
  secret: string
  signatureHeader: string
  algorithm: string
}

export class WebhookSecurityService {
  private config: WebhookSecurityConfig

  constructor(config: WebhookSecurityConfig) {
    this.config = config
  }

  /**
   * Verify HMAC signature for webhook requests
   * @param payload - Raw request body
   * @param signature - Signature from request headers
   * @returns boolean indicating if signature is valid
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.secret) {
      console.warn('[WEBHOOK SECURITY] No webhook secret configured')
      return false
    }

    if (!signature) {
      console.warn('[WEBHOOK SECURITY] No signature provided')
      return false
    }

    try {
      const expectedSignature = crypto
        .createHmac(this.config.algorithm, this.config.secret)
        .update(payload)
        .digest('hex')

      const expectedHeader = `${this.config.algorithm}=${expectedSignature}`
      
      console.log('[WEBHOOK SECURITY] Signature verification:')
      console.log('[WEBHOOK SECURITY] - Expected:', expectedHeader)
      console.log('[WEBHOOK SECURITY] - Received:', signature)

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedHeader)
      )
    } catch (error) {
      console.error('[WEBHOOK SECURITY] Error verifying signature:', error)
      return false
    }
  }

  /**
   * Generate HMAC signature for testing
   * @param payload - Raw request body
   * @returns signature string
   */
  generateSignature(payload: string): string {
    if (!this.config.secret) {
      throw new Error('No webhook secret configured')
    }

    const signature = crypto
      .createHmac(this.config.algorithm, this.config.secret)
      .update(payload)
      .digest('hex')

    return `${this.config.algorithm}=${signature}`
  }

  /**
   * Validate webhook configuration
   * @returns boolean indicating if configuration is valid
   */
  isConfigured(): boolean {
    return !!this.config.secret
  }
}

// 🎯 STEP 2: ElevenLabs webhook security service
export const elevenLabsWebhookSecurity = new WebhookSecurityService({
  secret: process.env.ELEVENLABS_WEBHOOK_SECRET || '',
  signatureHeader: 'elevenlabs-signature',
  algorithm: 'sha256'
})

// 🎯 STEP 2: Validation function for ElevenLabs webhooks
export function validateElevenLabsWebhook(payload: string, signature: string): {
  isValid: boolean
  error?: string
} {
  if (!elevenLabsWebhookSecurity.isConfigured()) {
    return {
      isValid: false,
      error: 'ELEVENLABS_WEBHOOK_SECRET not configured'
    }
  }

  const isValid = elevenLabsWebhookSecurity.verifySignature(payload, signature)
  
  return {
    isValid,
    error: isValid ? undefined : 'Invalid signature'
  }
} 