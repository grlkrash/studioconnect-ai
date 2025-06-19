import { asanaProvider } from '../pm-providers/asana.provider'
import { MondayProvider } from '../pm-providers/monday.provider'
import { JiraProvider } from '../pm-providers/jira.provider'
import prisma from '../db'

const mondayProvider = new MondayProvider()
const jiraProvider = new JiraProvider()

/**
 * Kicks off a periodic Asana sync for every business that has an enabled ASANA integration.
 * Runs inside the API process – lightweight because we only fetch delta every 5 min.
 */
export function startAsanaCron () {
  const FIVE_MIN = 5 * 60 * 1000
  const run = async () => {
    try {
      // For each provider iterate
      const providers = [
        { key: 'ASANA', instance: asanaProvider },
        { key: 'MONDAY', instance: mondayProvider },
        { key: 'JIRA', instance: jiraProvider },
      ] as const

      for (const { key, instance } of providers) {
        const integrations = await prisma.integration.findMany({
          where: {
            provider: key,
            isEnabled: true,
            // Temporarily omit syncStatus filter to avoid enum-type mismatch errors on some deployments.
            // Once the database enum type is aligned with the Prisma schema, this filter can be re-enabled.
          },
          select: { businessId: true },
        })

        for (const integ of integrations) {
          try {
            await instance.syncProjects(integ.businessId)
          } catch (err) {
            console.error(`[${key} Cron] Sync failed for business ${integ.businessId}:`, (err as Error).message)
            await prisma.integration.update({
              where: { businessId_provider: { businessId: integ.businessId, provider: key } },
              data: { syncStatus: 'ERROR', updatedAt: new Date() },
            }).catch(() => {})
          }
        }
      }
    } catch (err) {
      console.error('[AsanaCron] Top-level error:', err)
    }
  }

  // Run immediately on startup then every 5 min
  run()
  setInterval(run, FIVE_MIN)
} 