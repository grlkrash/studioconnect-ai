export function normalizePhoneNumber(phone: string): string {
  // Remove everything except digits
  const digits = phone.replace(/\D/g, '')

  if (!digits) return phone

  // If already has country code and leading '+' in input, assume it is E.164
  if (phone.trim().startsWith('+')) return '+' + digits

  // Handle US numbers: 10 digits -> +1XXXXXXXXXX
  if (digits.length === 10) return `+1${digits}`

  // 11 digits that start with 1 -> + followed
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`

  // Fallback: prepend '+' if missing
  return `+${digits}`
} 