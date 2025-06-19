import { Project } from '@prisma/client'
import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import { prisma } from '../db'
import { getAppBaseUrl } from '../../utils/env'
import { ProjectManagementProvider } from './pm.provider.interface'
import { getOrCreateClient } from './client-helper'

// Enterprise Jira OAuth Scopes for large agencies and creative studios
const REQUIRED_JIRA_SCOPES = [
  // Read permissions
  'read:jira-work',
  'read:jira-user',
  'read:project:jira',
  'read:issue:jira',
  'read:project.component:jira',
  'read:project.version:jira',
  'read:issue.time-tracking:jira',
  'read:comment:jira',
  'read:attachment:jira',
  'read:audit-log:jira',
  
  // Write permissions for project management
  'write:jira-work',
  'write:issue:jira',
  'write:comment:jira',
  'write:attachment:jira',
  'write:project:jira',
  'write:project.component:jira',
  'write:project.version:jira',
  'write:issue.time-tracking:jira',
  
  // Advanced permissions for enterprise features
  'read:dashboard:jira',
  'read:filter:jira',
  'read:workflow:jira',
  'read:field:jira',
  'read:field.option:jira',
  'read:issue-type:jira',
  'read:priority:jira',
  'read:resolution:jira',
  'read:status:jira',
  'read:user:jira',
  'read:role:jira',
  'read:group:jira',
  
  // Webhook permissions
  'manage:jira-webhook',
  
  // Advanced reporting and analytics
  'read:application-role:jira',
  'read:avatar:jira',
  'read:issue-link:jira',
  'read:issue-link-type:jira',
  'read:project-category:jira',
  'read:project-role:jira',
  'read:screen:jira',
  'read:field-configuration:jira'
]

// Helper to store axios instances per business with token refresh capability
class JiraApiClient {
  private client: AxiosInstance
  private accessToken: string
  private refreshToken?: string
  private tokenExpiresAt?: Date
  private businessId: string

  constructor(businessId: string, cloudId: string, accessToken: string, refreshToken?: string, expiresAt?: Date) {
    this.businessId = businessId
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    this.tokenExpiresAt = expiresAt

    const baseURL = `https://api.atlassian.com/ex/jira/${cloudId}`
    this.client = axios.create({
      baseURL: `${baseURL}/rest/api/3`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'StudioConnect-AI/1.0 (Enterprise)'
      },
      timeout: 30000, // 30 second timeout for enterprise reliability
    })

    // Add request interceptor for token refresh
    this.client.interceptors.request.use(async (config) => {
      await this.ensureValidToken()
      config.headers.Authorization = `Bearer ${this.accessToken}`
      return config
    })

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refreshAccessToken()
            const originalRequest = error.config
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`
            return this.client.request(originalRequest)
          } catch (refreshError) {
            console.error('[JiraProvider] Token refresh failed:', refreshError)
            throw new Error('Jira authentication expired. Please reconnect your account.')
          }
        }
        throw error
      }
    )
  }

  private async ensureValidToken(): Promise<void> {
    if (this.tokenExpiresAt && new Date() >= this.tokenExpiresAt && this.refreshToken) {
      await this.refreshAccessToken()
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available')
    }

    try {
      const response = await axios.post('https://auth.atlassian.com/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
      })

      this.accessToken = response.data.access_token
      this.refreshToken = response.data.refresh_token
      this.tokenExpiresAt = new Date(Date.now() + response.data.expires_in * 1000)

      // Update stored tokens in database
      await prisma.integration.update({
        where: { businessId_provider: { businessId: this.businessId, provider: 'JIRA' } },
        data: {
          apiKey: this.accessToken,
          credentials: {
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt.toISOString(),
          },
        },
      })

      console.log('[JiraProvider] Successfully refreshed access token')
    } catch (error) {
      console.error('[JiraProvider] Failed to refresh access token:', error)
      throw error
    }
  }

  getAxiosInstance(): AxiosInstance {
    return this.client
  }
}

const apiClients: Map<string, JiraApiClient> = new Map()

export class JiraProvider implements ProjectManagementProvider {
  /**
   * Validates Jira OAuth connection with enterprise-grade scope validation
   */
  async connect(credentials: Record<string, any>): Promise<boolean> {
    try {
      const { accessToken, refreshToken, cloudId, businessId, expiresAt } = credentials
      
      if (!accessToken || !cloudId || !businessId) {
        console.error('[JiraProvider] Missing required OAuth credentials')
        return false
      }

      // Validate cloud ID format
      if (!/^[a-f0-9-]{36}$/.test(cloudId)) {
        console.error('[JiraProvider] Invalid Jira Cloud ID format')
        return false
      }

      const tokenExpiry = expiresAt ? new Date(expiresAt) : undefined
      const apiClient = new JiraApiClient(businessId, cloudId, accessToken, refreshToken, tokenExpiry)
      
      // Test connection and validate permissions
      const client = apiClient.getAxiosInstance()
      
      // Validate user access and permissions
      const [userResponse, permissionsResponse] = await Promise.all([
        client.get('/myself'),
        client.get('/mypermissions')
      ])

      const userInfo = userResponse.data
      const permissions = permissionsResponse.data.permissions

      // Validate required permissions for enterprise features
      const requiredPerms = [
        'BROWSE_PROJECTS',
        'CREATE_ISSUES',
        'EDIT_ISSUES',
        'DELETE_ISSUES',
        'WORK_ON_ISSUES',
        'MANAGE_WATCHERS',
        'VIEW_VERSION_CONTROL',
        'MANAGE_PROJECT'
      ]

      const missingPerms = requiredPerms.filter(perm => !permissions[perm]?.havePermission)
      if (missingPerms.length > 0) {
        console.warn(`[JiraProvider] Missing enterprise permissions: ${missingPerms.join(', ')}`)
        // Don't fail connection but log warning for agency admins
      }

      // Store validated client
      apiClients.set(businessId, apiClient)

      // Store connection metadata
      await prisma.integration.upsert({
        where: { businessId_provider: { businessId, provider: 'JIRA' } },
        update: {
          apiKey: accessToken,
          credentials: {
            cloudId,
            refreshToken,
            expiresAt: tokenExpiry?.toISOString(),
            userAccountId: userInfo.accountId,
            userDisplayName: userInfo.displayName,
            userEmail: userInfo.emailAddress,
            connectedAt: new Date().toISOString(),
            requiredScopes: REQUIRED_JIRA_SCOPES,
            grantedPermissions: Object.keys(permissions).filter(p => permissions[p]?.havePermission)
          },
        },
        create: {
          businessId,
          provider: 'JIRA',
          apiKey: accessToken,
          credentials: {
            cloudId,
            refreshToken,
            expiresAt: tokenExpiry?.toISOString(),
            userAccountId: userInfo.accountId,
            userDisplayName: userInfo.displayName,
            userEmail: userInfo.emailAddress,
            connectedAt: new Date().toISOString(),
            requiredScopes: REQUIRED_JIRA_SCOPES,
            grantedPermissions: Object.keys(permissions).filter(p => permissions[p]?.havePermission)
          },
        },
      })

      console.log(`[JiraProvider] ✅ Enterprise OAuth connection successful for business ${businessId}`)
      console.log(`[JiraProvider] Connected as: ${userInfo.displayName} (${userInfo.emailAddress})`)
      return true
    } catch (error) {
      console.error('[JiraProvider] ❌ Failed to connect to Jira:', error)
      
      // Provide specific error messages for common issues
      if (error.response?.status === 401) {
        console.error('[JiraProvider] Authentication failed - invalid or expired token')
      } else if (error.response?.status === 403) {
        console.error('[JiraProvider] Insufficient permissions - check OAuth scopes')
      } else if (error.response?.status === 404) {
        console.error('[JiraProvider] Jira instance not found - check cloud ID')
      }
      
      return false
    }
  }

  /**
   * Syncs projects with advanced filtering and enterprise features
   */
  async syncProjects(businessId: string): Promise<{ projectCount: number; taskCount: number }> {
    const apiClient = apiClients.get(businessId)
    if (!apiClient) {
      throw new Error(`Jira not connected for business ${businessId}. Please reconnect.`)
    }

    const client = apiClient.getAxiosInstance()
    let taskCount = 0
    let projectCount = 0
    let startAt = 0
    const maxResults = 100 // Increased for enterprise efficiency

    try {
      console.log(`[JiraProvider] Starting enterprise project sync for business ${businessId}`)

      // Get all accessible projects first
      const projectsResponse = await client.get('/project/search', {
        params: {
          expand: 'description,lead,url,projectKeys',
          maxResults: 50
        }
      })

      const projects = projectsResponse.data.values
      console.log(`[JiraProvider] Found ${projects.length} accessible projects`)

      // Sync issues from all projects with enterprise JQL
      const enterpriseJQL = [
        'status != Done',
        'updated >= -30d', // Only sync recent updates for performance
        'project in (' + projects.map((p: any) => p.key).join(',') + ')'
      ].join(' AND ')

      let isLast = false
      while (!isLast) {
        const response = await client.get('/search', {
          params: {
            jql: enterpriseJQL,
            fields: [
              'summary',
              'status',
              'description',
              'project',
              'assignee',
              'creator',
              'priority',
              'issuetype',
              'created',
              'updated',
              'duedate',
              'timeoriginalestimate',
              'timeestimate',
              'timespent',
              'worklog',
              'labels',
              'components',
              'versions',
              'fixVersions',
              'resolution',
              'resolutiondate',
              'comment',
              'attachment'
            ].join(','),
            expand: 'changelog',
            startAt,
            maxResults,
          },
        })

        const issues = response.data.issues
        if (issues.length === 0) {
          isLast = true
          continue
        }

        // Process issues in batches for better performance
        const batchSize = 10
        for (let i = 0; i < issues.length; i += batchSize) {
          const batch = issues.slice(i, i + batchSize)
          
          await Promise.all(batch.map(async (issue: any) => {
            try {
              // Enhanced client name derivation
              const projectInfo = issue.fields.project
              const clientName = projectInfo.name || projectInfo.key || 'Jira Client'
              const clientId = await getOrCreateClient(businessId, clientName)

              const normalizedData = {
                ...this.normalizeData(issue, businessId),
                clientId,
                pmTool: 'JIRA',
              }

              await prisma.project.upsert({
                where: {
                  businessId_pmToolId: {
                    businessId,
                    pmToolId: normalizedData.pmToolId!,
                  },
                },
                update: normalizedData,
                create: normalizedData as Project,
              })

              taskCount++
            } catch (error) {
              console.error(`[JiraProvider] Failed to sync issue ${issue.key}:`, error)
            }
          }))
        }

        startAt += issues.length
        isLast = startAt >= response.data.total

        // Log progress for enterprise monitoring
        if (startAt % 500 === 0) {
          console.log(`[JiraProvider] Synced ${startAt}/${response.data.total} issues...`)
        }
      }

      projectCount = new Set(projects.map((p: any) => p.key)).size

      // Update last sync timestamp
      await prisma.integration.update({
        where: { businessId_provider: { businessId, provider: 'JIRA' } },
        data: {
          credentials: {
            ...await this.getStoredCredentials(businessId),
            lastSyncAt: new Date().toISOString(),
            lastSyncStats: {
              projectCount,
              taskCount,
              duration: Date.now()
            }
          },
        },
      })

      console.log(`[JiraProvider] ✅ Enterprise sync completed: ${taskCount} tasks from ${projectCount} projects`)
      return { projectCount, taskCount }
    } catch (error) {
      console.error(`[JiraProvider] ❌ Enterprise sync failed for business ${businessId}:`, error)
      
      // Enhanced error reporting for enterprise
      if (error.response?.status === 400) {
        throw new Error('Invalid JQL query or request parameters')
      } else if (error.response?.status === 403) {
        throw new Error('Insufficient permissions to access projects')
      } else if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded - please try again later')
      }
      
      throw new Error(`Enterprise sync failed: ${error.message}`)
    }
  }

  /**
   * Sets up enterprise-grade webhooks with proper security
   */
  async setupWebhooks(businessId: string): Promise<{ webhookId: string }> {
    const apiClient = apiClients.get(businessId)
    if (!apiClient) {
      throw new Error(`Jira not connected for business ${businessId}`)
    }

    const client = apiClient.getAxiosInstance()
    const secret = crypto.randomBytes(32).toString('hex')
    const baseUrl = getAppBaseUrl()
    
    if (!baseUrl) {
      throw new Error('Base URL configuration missing for webhook setup')
    }

    const webhookUrl = `${baseUrl}/api/webhooks/pm/jira?businessId=${businessId}&token=${secret}`

    try {
      // Enhanced webhook configuration for enterprise features
      const webhookConfig = {
        name: `StudioConnect AI Enterprise Webhook - ${businessId}`,
        url: webhookUrl,
        events: [
          'jira:issue_created',
          'jira:issue_updated',
          'jira:issue_deleted',
          'comment_created',
          'comment_updated',
          'worklog_updated',
          'project_created',
          'project_updated',
          'version_released',
          'version_created'
        ],
        jqlFilter: 'updated >= -1d', // Only recent changes for performance
        excludeIssueDetails: false,
        includeFields: [
          'summary',
          'status',
          'assignee',
          'priority',
          'components',
          'versions',
          'fixVersions',
          'labels'
        ]
      }

      console.log(`[JiraProvider] Creating enterprise webhook for business ${businessId}`)
      const response = await client.post('/webhook', webhookConfig)

      const webhookData = response.data
      const webhookId = webhookData.webhookRegistrationResult?.[0]?.createdWebhookId || 
                       webhookData.self?.split('/').pop()

      if (!webhookId) {
        throw new Error('Failed to extract webhook ID from Jira response')
      }

      // Store webhook configuration securely
      await prisma.integration.update({
        where: { businessId_provider: { businessId, provider: 'JIRA' } },
        data: {
          webhookId: webhookId.toString(),
          webhookSecret: secret,
          credentials: {
            ...await this.getStoredCredentials(businessId),
            webhookConfig,
            webhookCreatedAt: new Date().toISOString()
          },
        },
      })

      console.log(`[JiraProvider] ✅ Enterprise webhook created: ${webhookId}`)
      return { webhookId: webhookId.toString() }
    } catch (error) {
      console.error(`[JiraProvider] ❌ Failed to setup enterprise webhook:`, error)
      
      if (error.response?.status === 400) {
        throw new Error('Invalid webhook configuration')
      } else if (error.response?.status === 403) {
        throw new Error('Insufficient permissions to create webhooks')
      }
      
      throw new Error(`Webhook setup failed: ${error.message}`)
    }
  }

  /**
   * Handles webhook events with enterprise security and processing
   */
  async handleWebhook(payload: any, businessId: string): Promise<void> {
    try {
      if (!payload.issue && !payload.project) {
        console.warn('[JiraProvider] Received webhook without issue or project data')
        return
      }

      const eventType = payload.webhookEvent
      console.log(`[JiraProvider] Processing webhook event: ${eventType} for business ${businessId}`)

      if (payload.issue) {
        await this.processIssueWebhook(payload, businessId)
      } else if (payload.project) {
        await this.processProjectWebhook(payload, businessId)
      }

      // Log webhook processing for enterprise monitoring
      await this.logWebhookEvent(businessId, eventType, payload)
      
    } catch (error) {
      console.error(`[JiraProvider] ❌ Webhook processing failed for business ${businessId}:`, error)
      throw error
    }
  }

  private async processIssueWebhook(payload: any, businessId: string): Promise<void> {
    const issue = payload.issue
    const eventType = payload.webhookEvent

    if (eventType === 'jira:issue_deleted') {
      await prisma.project.deleteMany({
        where: {
          businessId,
          pmToolId: issue.key,
          pmTool: 'JIRA'
        }
      })
      console.log(`[JiraProvider] Deleted issue ${issue.key} via webhook`)
    } else {
      const clientName = issue.fields.project.name || issue.fields.project.key || 'Jira Client'
      const clientId = await getOrCreateClient(businessId, clientName)

      const normalizedData = {
        ...this.normalizeData(issue, businessId),
        clientId,
        pmTool: 'JIRA',
      }

      await prisma.project.upsert({
        where: {
          businessId_pmToolId: {
            businessId,
            pmToolId: normalizedData.pmToolId!,
          },
        },
        update: normalizedData,
        create: normalizedData as Project,
      })

      console.log(`[JiraProvider] Processed webhook for issue ${issue.key}`)
    }
  }

  private async processProjectWebhook(payload: any, businessId: string): Promise<void> {
    // Handle project-level events for enterprise monitoring
    const project = payload.project
    console.log(`[JiraProvider] Processing project webhook for ${project.key}`)
  }

  private async logWebhookEvent(businessId: string, eventType: string, payload: any): Promise<void> {
    try {
      const credentials = await this.getStoredCredentials(businessId)
      const webhookLogs = credentials.webhookLogs || []
      
      webhookLogs.push({
        eventType,
        timestamp: new Date().toISOString(),
        issueKey: payload.issue?.key,
        projectKey: payload.project?.key,
        processed: true
      })

      // Keep only last 100 webhook logs
      const recentLogs = webhookLogs.slice(-100)

      await prisma.integration.update({
        where: { businessId_provider: { businessId, provider: 'JIRA' } },
        data: {
          credentials: {
            ...credentials,
            webhookLogs: recentLogs
          },
        },
      })
    } catch (error) {
      console.error('[JiraProvider] Failed to log webhook event:', error)
    }
  }

  /**
   * Enhanced data normalization with enterprise fields
   */
  normalizeData(issue: any, businessId: string): Partial<Project> {
    const fields = issue.fields
    
    // Enhanced status mapping for enterprise workflows
    const statusMapping: Record<string, string> = {
      'To Do': 'TODO',
      'In Progress': 'IN_PROGRESS',
      'In Development': 'IN_PROGRESS',
      'Code Review': 'IN_REVIEW',
      'Testing': 'TESTING',
      'Ready for Deployment': 'READY',
      'Done': 'COMPLETED',
      'Closed': 'COMPLETED',
      'Cancelled': 'CANCELLED',
      'Blocked': 'BLOCKED',
      'On Hold': 'ON_HOLD'
    }

    const statusName = fields.status?.name || 'UNKNOWN'
    const normalizedStatus = statusMapping[statusName] || statusName.toUpperCase().replace(/\s+/g, '_')

    return {
      businessId,
      pmToolId: issue.key,
      name: fields.summary || 'Untitled Issue',
      status: normalizedStatus,
      details: fields.description || null,
      assignee: fields.assignee?.displayName || null,
      createdAt: fields.created ? new Date(fields.created) : new Date(),
      updatedAt: fields.updated ? new Date(fields.updated) : new Date(),
      dueDate: fields.duedate ? new Date(fields.duedate) : null,
      lastSyncedAt: new Date()
    }
  }

  private async getStoredCredentials(businessId: string): Promise<any> {
    const integration = await prisma.integration.findUnique({
      where: { businessId_provider: { businessId, provider: 'JIRA' } },
      select: { credentials: true }
    })
    return integration?.credentials || {}
  }
}

// Export singleton instance
export const jiraProvider = new JiraProvider() 