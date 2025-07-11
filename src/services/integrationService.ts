import { ProjectManagementProvider } from './pm-providers/pm.provider.interface'
import { asanaProvider } from './pm-providers/asana.provider'
import { JiraProvider } from './pm-providers/jira.provider'
import { MondayProvider } from './pm-providers/monday.provider'
import prisma from './db'
import { encryptCredentials, decryptCredentials } from '../utils/tokenEncryption'

/**
 * Central service for managing 3rd-party Project-Management integrations.
 * All API routes should delegate provider orchestration to this singleton.
 */
class IntegrationService {
  private static _instance: IntegrationService

  /** Keep long-lived provider instances where it makes sense (rate-limit mgmt, etc.) */
  private readonly providers: Record<string, ProjectManagementProvider>

  private constructor () {
    this.providers = {
      ASANA: asanaProvider,
      JIRA: new JiraProvider(),
      MONDAY: new MondayProvider(),
    }
  }

  static get instance (): IntegrationService {
    if (!this._instance) this._instance = new IntegrationService()
    return this._instance
  }

  /** Returns the provider instance for a given key or throws if unknown. */
  private getProvider (raw: string): ProjectManagementProvider {
    const key = raw.toUpperCase()
    const provider = this.providers[key]
    if (!provider) throw new Error(`Unsupported provider: ${raw}`)
    return provider
  }

  /**
   * Connects the given business to a provider using the supplied credentials.
   * ‑ Persists/updates Integration row
   * ‑ Performs initial data sync
   * ‑ Registers webhooks (best-effort)
   */
  async connectProvider (businessId: string, providerKey: string, credentials: Record<string, any>): Promise<void> {
    const provider = this.getProvider(providerKey)

    // 1. Validate credentials by attempting a lightweight API call
    const mergedCredentials = { ...credentials, businessId }
    const ok = await provider.connect(mergedCredentials)
    if (!ok) throw new Error('Failed to validate credentials with provider')

    // Encrypt tokens before persisting
    const encryptedCreds = encryptCredentials(credentials)

    // 2. Upsert Integration row
    await prisma.integration.upsert({
      where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
      create: {
        businessId,
        provider: providerKey.toUpperCase(),
        apiKey: credentials.apiKey ?? null,
        credentials: encryptedCreds,
        syncStatus: 'CONNECTED',
        isEnabled: true,
      } as any,
      update: {
        apiKey: credentials.apiKey ?? undefined,
        credentials: encryptedCreds,
        syncStatus: 'CONNECTED',
        isEnabled: true,
        updatedAt: new Date(),
      },
    })

    // 3. Trigger initial one-way sync (blocking)
    await provider.syncProjects(businessId)

    // 4. Attempt to register webhooks (non-fatal)
    try {
      const { webhookId } = await provider.setupWebhooks(businessId)
      if (webhookId) {
        await prisma.integration.update({
          where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
          data: { webhookId },
        })
      }
    } catch (err) {
      console.warn(`[IntegrationService] Webhook setup failed for ${providerKey}:`, (err as Error).message)
    }
  }

  /** Soft-disconnect without deleting historical data */
  async disconnectProvider (businessId: string, providerKey: string): Promise<void> {
    await prisma.integration.update({
      where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
      data: {
        isEnabled: false,
        syncStatus: 'DISCONNECTED',
        updatedAt: new Date(),
      },
    }).catch(() => {
      /* ignore if row missing */
    })
  }

  /** Returns integration records for a business */
  async getIntegrationStatus (businessId: string) {
    return prisma.integration.findMany({ where: { businessId } })
  }

  async syncNow (businessId: string, providerKey: string): Promise<{ projectCount: number; taskCount: number }> {
    const provider = this.getProvider(providerKey)
    const result = await provider.syncProjects(businessId)

    await prisma.integration.update({
      where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
      data: {
        syncStatus: 'CONNECTED',
        updatedAt: new Date(),
      },
    }).catch(() => {/* ignore if row missing */})

    return result
  }

  /** Enable / disable a provider for the business (dashboard toggle) */
  async setEnabled (businessId: string, providerKey: string, isEnabled: boolean): Promise<void> {
    await prisma.integration.update({
      where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
      data: { isEnabled, updatedAt: new Date() },
    }).catch(() => {/* ignore if row missing */})

    // Enterprise-only: fire Slack / Teams webhook notification when enabling
    if (isEnabled) {
      try {
        const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, planTier: true } })
        if (biz?.planTier === 'ENTERPRISE') {
          const text = `${biz.name} enabled ${providerKey.toUpperCase()} notifications`

          if (process.env.SLACK_WEBHOOK_URL) {
            await fetch(process.env.SLACK_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            }).catch(() => {})
          }

          if (process.env.TEAMS_WEBHOOK_URL) {
            await fetch(process.env.TEAMS_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            }).catch(() => {})
          }
        }
      } catch (err) {
        console.warn('[IntegrationService] webhook notify failed:', (err as Error).message)
      }
    }
  }

  /** Performs a lightweight check to verify stored credentials are still valid */
  async testConnection (businessId: string, providerKey: string): Promise<boolean> {
    const integration = await prisma.integration.findUnique({
      where: { businessId_provider: { businessId, provider: providerKey.toUpperCase() } },
    })
    if (!integration?.credentials) throw new Error('Provider not connected')
    const provider = this.getProvider(providerKey)
    const decrypted = decryptCredentials(integration.credentials as any)
    return provider.connect({ ...decrypted, businessId })
  }
}

export const integrationService = IntegrationService.instance 