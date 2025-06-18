import axios from 'axios'
import { prisma } from './db'

/**
 * Fetch real-time status of an Asana project/task.
 */
export async function fetchAsanaProjectStatus(externalId: string): Promise<{ status: string; details?: string } | null> {
  if (!process.env.ASANA_ACCESS_TOKEN) return null
  try {
    const resp = await axios.get(`https://app.asana.com/api/1.0/projects/${externalId}`, {
      headers: { Authorization: `Bearer ${process.env.ASANA_ACCESS_TOKEN}` },
    })
    const data = resp.data?.data
    if (!data) return null
    return { status: data.current_status?.color || data.status || 'Unknown', details: data.notes }
  } catch (err) {
    console.error('[ProjectStatus] Asana fetch failed', (err as Error).message)
    return null
  }
}

/**
 * Fetch real-time status of a Jira issue.
 */
export async function fetchJiraIssueStatus(issueKey: string): Promise<{ status: string; details?: string } | null> {
  if (!process.env.JIRA_BASE_URL || !process.env.JIRA_API_TOKEN || !process.env.JIRA_USER_EMAIL) return null
  try {
    const url = `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`
    const auth = Buffer.from(`${process.env.JIRA_USER_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')
    const resp = await axios.get(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
    const issue = resp.data
    const status = issue.fields?.status?.name || 'Unknown'
    const details = issue.fields?.summary || ''
    return { status, details }
  } catch (err) {
    console.error('[ProjectStatus] Jira fetch failed', (err as Error).message)
    return null
  }
}

/**
 * Update a single project row with latest status (Asana or Jira).
 */
export async function refreshProjectStatus(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project || !project.pmTool || !project.pmToolId) return

  let remote: { status: string; details?: string } | null = null
  if (project.pmTool === 'ASANA') {
    remote = await fetchAsanaProjectStatus(project.pmToolId!)
  } else if (project.pmTool === 'JIRA') {
    remote = await fetchJiraIssueStatus(project.pmToolId!)
  }

  if (remote) {
    await prisma.project.update({ where: { id: projectId }, data: { status: remote.status, details: remote.details || project.details, lastSyncedAt: new Date() } })
  }
} 