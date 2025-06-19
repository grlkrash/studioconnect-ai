import { asanaProvider } from '../pm-providers/asana.provider'
import { MondayProvider } from '../pm-providers/monday.provider'
import { JiraProvider } from '../pm-providers/jira.provider'
import prisma from '../db'
import { cronReportPersonalData } from '../atlassianAccountService'

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

/**
 * Weekly Personal Data Reporting cron – fulfills Atlassian GDPR requirements.
 * It grabs up to 90 Atlassian accountIds stored in the DB and reports them using the
 * official Personal Data Reporting API. Atlassian returns 204/200 regardless; we log
 * but otherwise swallow errors so production calls never crash the worker.
 */
export function startAtlassianPdrCron () {
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000

  const run = async () => {
    try {
      await cronReportPersonalData()
    } catch (err) {
      console.error('[PDR Cron] Failed to report personal data', err)
    }
  }

  // Kick-off immediately once per boot and then weekly
  run()
  setInterval(run, ONE_WEEK)
} 