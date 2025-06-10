/**
 * Cleans and formats voice responses for consistent output
 * @param response - The raw response to clean
 * @returns Cleaned response string
 */
export function cleanVoiceResponse(response: string): string {
  if (!response) return '';
  
  // Remove any markdown formatting
  let cleaned = response.replace(/[*_`]/g, '');
  
  // Remove any HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // Remove any SSML tags
  cleaned = cleaned.replace(/<[^>]*\/>/g, '');
  
  // Remove any XML-like tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // Remove any extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove any quotes at the start/end
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  return cleaned;
}

/**
 * Formats a phone number for consistent display
 * @param phone - The phone number to format
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  
  // Return original if not 10 digits
  return phone;
}

/**
 * Escapes special characters for SSML
 * @param text - The text to escape
 * @returns Escaped text safe for SSML
 */
export function escapeSSML(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
} 