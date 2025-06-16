import { Project } from '@prisma/client'
import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import { prisma } from '../db'
import { ProjectManagementProvider } from './pm.provider.interface'

// Helper to store axios instances per business
const axiosInstances: Map<string, AxiosInstance> = new Map()

export class JiraProvider implements ProjectManagementProvider {
  private getApiClient(businessId: string): AxiosInstance {
    const client = axiosInstances.get(businessId)
    if (!client) {
      throw new Error(`Jira API client not initialized for business ${businessId}. Call connect() first.`)
    }
    return client
  }

  async connect(credentials: {
    email: string
    token: string
    instanceUrl: string
    businessId: string
  }): Promise<boolean> {
    try {
      const { email, token, instanceUrl, businessId } = credentials
      if (!email || !token || !instanceUrl || !businessId) {
        throw new Error('Missing Jira credentials: email, token, instanceUrl, and businessId are required.')
      }

      const encodedToken = Buffer.from(`${email}:${token}`).toString('base64')
      const client = axios.create({
        baseURL: `${instanceUrl}/rest/api/3`,
        headers: {
          Authorization: `Basic ${encodedToken}`,
          Accept: 'application/json',
        },
      })

      // Test connection
      await client.get('/myself')
      axiosInstances.set(businessId, client)

      console.log(`[JiraProvider] Successfully connected to Jira for business ${businessId}`)
      return true
    } catch (error) {
      console.error('[JiraProvider] Failed to connect to Jira:', error)
      return false
    }
  }

  async syncProjects(businessId: string): Promise<{ projectCount: number; taskCount: number }> {
    const client = this.getApiClient(businessId)
    let projectCount = 0
    let startAt = 0
    const maxResults = 50
    let isLast = false

    try {
      while (!isLast) {
        const response = await client.get('/search', {
          params: {
            jql: 'status != Done', // Example JQL, could be configurable
            fields: 'summary,status,description,project',
            startAt,
            maxResults,
          },
        })

        const issues = response.data.issues
        if (issues.length === 0) {
          isLast = true
          continue
        }

        for (const issue of issues) {
          const normalizedData = this.normalizeData(issue, businessId)
          await prisma.project.upsert({
            where: {
              businessId_pmToolId: {
                businessId: businessId,
                pmToolId: normalizedData.pmToolId!,
              },
            },
            update: normalizedData,
            create: normalizedData as Project,
          })
          projectCount++
        }

        startAt += issues.length
        isLast = startAt >= response.data.total
      }

      console.log(`[JiraProvider] Synced ${projectCount} projects for business ${businessId}`)
      return { projectCount, taskCount: 0 } // taskCount not applicable for this model
    } catch (error) {
      console.error(`[JiraProvider] Error syncing projects for business ${businessId}:`, error)
      throw new Error('Failed to sync projects from Jira.')
    }
  }

  async setupWebhooks(businessId: string): Promise<{ webhookId: string }> {
    const client = this.getApiClient(businessId)
    const secret = crypto.randomBytes(32).toString('hex')
    const webhookUrl = `${process.env.APP_BASE_URL}/api/webhooks/pm/jira?token=${secret}`

    try {
      const response = await client.post('/webhook', {
        name: `StudioConnect AI Webhook for Business ${businessId}`,
        url: webhookUrl,
        events: ['jira:issue_created', 'jira:issue_updated'],
        jqlFilter: 'status != Done',
        excludeIssueDetails: false,
      })

      const webhookId = response.data.webhookRegistrationResult[0].createdWebhookId.toString()

      // Store the webhook ID and secret securely, associated with the business.
      // Assuming an Integration model exists for this.
      await prisma.integration.update({
        where: { businessId_provider: { businessId, provider: 'JIRA' } }, // hypothetical unique constraint
        data: {
          webhookId,
          webhookSecret: secret,
        },
      })

      console.log(`[JiraProvider] Created webhook ${webhookId} for business ${businessId}`)
      return { webhookId }
    } catch (error) {
      console.error(`[JiraProvider] Error setting up webhook for business ${businessId}:`, error)
      throw new Error('Failed to create Jira webhook.')
    }
  }

  async handleWebhook(payload: any, businessId: string): Promise<void> {
    // Note: Authentication of the webhook (via secret token) is assumed to happen
    // in the calling controller/handler, as per the PRD.
    try {
      if (!payload.issue) {
        console.warn('[JiraProvider] Received webhook without issue data.', payload)
        return
      }

      const normalizedData = this.normalizeData(payload.issue, businessId)
      await prisma.project.upsert({
        where: {
          businessId_pmToolId: {
            businessId: businessId,
            pmToolId: normalizedData.pmToolId!,
          },
        },
        update: normalizedData,
        create: normalizedData as Project,
      })

      console.log(`[JiraProvider] Processed webhook for issue ${normalizedData.pmToolId} for business ${businessId}`)
    } catch (error) {
      console.error(`[JiraProvider] Error processing webhook for business ${businessId}:`, error)
    }
  }

  normalizeData(issue: any, businessId: string): Partial<Project> {
    return {
      businessId,
      pmToolId: issue.key,
      name: issue.fields.summary,
      status: issue.fields.status.name?.toUpperCase() ?? 'UNKNOWN',
      details: issue.fields.description,
      lastSyncedAt: new Date(),
    }
  }
} 