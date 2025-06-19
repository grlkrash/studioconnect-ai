export interface ProviderEnvConfig {
  provider: string
  required: string[]
}

const CONFIG: Record<string, string[]> = {
  ASANA: ['ASANA_CLIENT_ID', 'ASANA_CLIENT_SECRET'],
  MONDAY: ['MONDAY_CLIENT_ID', 'MONDAY_CLIENT_SECRET'],
  JIRA: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
}

export function isProviderEnabled(provider: string): boolean {
  const keys = CONFIG[provider.toUpperCase()] || []
  return keys.every(k => !!process.env[k])
}

export function getMissingKeys(provider: string): string[] {
  const keys = CONFIG[provider.toUpperCase()] || []
  return keys.filter(k => !process.env[k])
} 