export type ProjectType = 'BRANDING' | 'DESIGN' | 'MARKETING' | 'PRODUCTION' | 'EVENTS' | 'OTHER'

const KEYWORDS: Record<ProjectType, string[]> = {
  BRANDING: ['brand', 'branding', 'logo', 'identity', 'rebrand', 'style guide'],
  DESIGN: ['design', 'graphic', 'ui', 'ux', 'illustration', 'mockup', 'wireframe'],
  MARKETING: ['marketing', 'campaign', 'ads', 'advertising', 'social', 'seo', 'content'],
  PRODUCTION: ['video', 'photo', 'shoot', 'production', 'edit', 'post-production', 'animation'],
  EVENTS: ['event', 'conference', 'expo', 'trade show', 'activation', 'booth', 'launch'],
  OTHER: []
}

/**
 * Detect a high-level project type from free-text using simple keyword matching.
 * Falls back to 'OTHER' when no clear match is found.
 */
export function detectProjectType(text: string | undefined | null): ProjectType {
  if (!text) return 'OTHER'
  const lower = text.toLowerCase()
  for (const [type, words] of Object.entries(KEYWORDS) as [ProjectType, string[]][]) {
    if (type === 'OTHER') continue
    if (words.some((w) => lower.includes(w))) return type
  }
  return 'OTHER'
} 