import axios from 'axios'
import { prisma } from './db'

interface ReportAccount {
  accountId: string
  updatedAt: Date
}

const PDR_API_URL = 'https://api.atlassian.com/app/report-accounts/'

const db: any = prisma

// ---------------------------------------------------------------------------
// 1. Bearer-token helper (client_credentials) – avoids manual ATLASSIAN_PDR_TOKEN
// ---------------------------------------------------------------------------
let cachedToken: { value: string; expiresAt: number } | null = null

async function getAtlassianBearerToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value
  }

  const clientId = process.env.JIRA_CLIENT_ID || process.env.ATLASSIAN_CLIENT_ID
  const clientSecret = process.env.JIRA_CLIENT_SECRET || process.env.ATLASSIAN_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  try {
    const resp = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: 'api.atlassian.com',
    })

    const { access_token, expires_in } = resp.data as { access_token: string; expires_in: number }
    cachedToken = { value: access_token, expiresAt: Date.now() + expires_in * 1000 }
    return access_token
  } catch (err) {
    console.error('[PDR] Failed to fetch bearer token', (err as any).response?.data || err)
    return null
  }
}

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
  if (!batch.length) return

  const token = await getAtlassianBearerToken()
  if (!token) {
    console.warn('[PDR] Skipping personal-data report – no bearer token')
    return
  }

  try {
    await axios.post(
      PDR_API_URL,
      { accounts: batch.map((a) => ({ accountId: a.accountId, updatedAt: a.updatedAt.toISOString() })) },
      { headers: { Authorization: `Bearer ${token}` } },
    )
  } catch (err) {
    console.error('[PDR] Failed to report accounts', (err as any).response?.data || err)
  }
}

export async function cronReportPersonalData(): Promise<void> {
  const batch = await getAccountsBatch()
  await reportPersonalData(batch)
} 