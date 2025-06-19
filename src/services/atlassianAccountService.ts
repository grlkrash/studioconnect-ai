import axios from 'axios'
import { prisma } from './db'

interface ReportAccount {
  accountId: string
  updatedAt: Date
}

const PDR_API_URL = 'https://api.atlassian.com/app/report-accounts/'

const db: any = prisma

export async function upsertAtlassianAccount(businessId: string, accountId: string): Promise<void> {
  await db.atlassianAccount.upsert({
    where: { accountId },
    update: { businessId },
    create: { businessId, accountId },
  })
}

export async function getAccountsBatch(limit = 90): Promise<ReportAccount[]> {
  const rows = await db.atlassianAccount.findMany({
    take: limit,
    orderBy: { updatedAt: 'asc' },
  })
  return rows.map((r: any) => ({ accountId: r.accountId, updatedAt: r.updatedAt }))
}

export async function reportPersonalData(batch: ReportAccount[]): Promise<void> {
  if (!process.env.ATLASSIAN_PDR_TOKEN) return // skip if token not set
  if (!batch.length) return

  try {
    await axios.post(
      PDR_API_URL,
      { accounts: batch.map((a) => ({ accountId: a.accountId, updatedAt: a.updatedAt.toISOString() })) },
      { headers: { Authorization: `Bearer ${process.env.ATLASSIAN_PDR_TOKEN}` } },
    )
  } catch (err) {
    console.error('[PDR] Failed to report accounts', (err as any).response?.data || err)
  }
}

export async function cronReportPersonalData(): Promise<void> {
  const batch = await getAccountsBatch()
  await reportPersonalData(batch)
} 