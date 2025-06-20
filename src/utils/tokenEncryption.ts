import crypto from 'crypto'

// 32-byte key for AES-256 derived from env var (base64 or hex). For local dev fallback to static key.
const SECRET_KEY = ((): Buffer => {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY || ''
  if (!envKey) {
    console.warn('[TokenEncryption] Using fallback key – set TOKEN_ENCRYPTION_KEY in production!')
  }
  // Interpret as base64 or hex, otherwise use utf8 buffer (padded / sliced).
  try {
    if (envKey.length === 44) return Buffer.from(envKey, 'base64') // 32 bytes ⇒ 44 base64 chars
    if (envKey.length === 64) return Buffer.from(envKey, 'hex') // 32 bytes ⇒ 64 hex chars
  } catch {}
  const key = Buffer.alloc(32)
  Buffer.from(envKey).copy(key)
  return key
})()

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12 // recommended for GCM

export function encryptToken (plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, SECRET_KEY, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptToken (encoded: string): string {
  try {
    const data = Buffer.from(encoded, 'base64')
    const iv = data.subarray(0, IV_LENGTH)
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16)
    const text = data.subarray(IV_LENGTH + 16)
    const decipher = crypto.createDecipheriv(ALGO, SECRET_KEY, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(text), decipher.final()])
    return dec.toString('utf8')
  } catch (err) {
    console.error('[TokenEncryption] Failed to decrypt:', (err as Error).message)
    throw err
  }
}

export function encryptCredentials (cred: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(cred)) {
    if (typeof v === 'string' && isTokenKey(k)) out[k] = encryptToken(v)
    else out[k] = v
  }
  return out
}

export function decryptCredentials (cred: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(cred)) {
    if (typeof v === 'string' && isTokenKey(k)) out[k] = safelyDecrypt(v)
    else out[k] = v
  }
  return out
}

function isTokenKey (key: string): boolean {
  return /token|secret|apikey|access|refresh/i.test(key)
}

function safelyDecrypt (str: string): string {
  try {
    return decryptToken(str)
  } catch {
    // If decryption fails assume already plaintext
    return str
  }
} 