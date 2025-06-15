import { ProjectSyncProvider } from './types'
import { mockProjectProvider } from './mockProvider'

// Placeholder for future real providers (Asana, Jira, etc.)
// import { asanaProvider } from './asanaProvider'

export function getProjectSyncProvider(): ProjectSyncProvider {
  // When real integrations are ready, inspect business settings or env vars
  // and return the appropriate provider. For now, fall back to the mock.
  return mockProjectProvider
} 