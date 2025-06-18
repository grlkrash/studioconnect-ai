import { Project } from "@prisma/client"
import axios, { AxiosInstance } from "axios"
import crypto from "crypto"

import { prisma } from "../db"
import { ProjectManagementProvider } from "./pm.provider.interface"
import { getOrCreateClient } from "./client-helper"

// Constants
const ASANA_API_BASE_URL = "https://app.asana.com/api/1.0"
const WEBHOOK_TARGET_PATH = "/api/webhooks/pm/asana"

/**
 * Asana-specific implementation of the ProjectManagementProvider interface.
 * Handles connection, data synchronization, and webhook events for Asana.
 */
class AsanaProvider implements ProjectManagementProvider {
  /**
   * Validates Asana credentials by making a test API call.
   * This should be called during the initial setup process where the user provides their credentials.
   *
   * @param credentials - The API key and workspace GID for Asana.
   * @returns A boolean indicating if the connection was successful.
   */
  async connect(credentials: Record<string, any>): Promise<boolean> {
    const token: string | undefined = credentials.apiKey ?? credentials.accessToken
    const workspaceGid: string | undefined = credentials.workspaceGid

    if (!token) {
      console.error("[AsanaProvider] Missing API token or access token.")
      return false
    }

    try {
      const testClient = axios.create({
        baseURL: ASANA_API_BASE_URL,
        headers: { Authorization: `Bearer ${token}` },
      })

      if (workspaceGid) {
        await testClient.get(`/workspaces/${workspaceGid}`)
      } else {
        // Fallback: fetch current user to verify token validity
        await testClient.get('/users/me')
      }

      console.log('[AsanaProvider] Connection successful using provided credentials')
      return true
    } catch (error) {
      const errorMessage =
        error instanceof Error && (error as any).response?.data
          ? JSON.stringify((error as any).response.data)
          : (error as Error).message
      console.error('[AsanaProvider] Connection failed:', errorMessage)
      return false
    }
  }

  /**
   * Fetches all tasks from the configured Asana workspace and syncs them
   * with the local database.
   *
   * @param businessId - The ID of the business to sync data for.
   * @returns A summary of the synced data.
   */
  async syncProjects(
    businessId: string
  ): Promise<{ projectCount: number; taskCount: number }> {
    const apiClient = await this.getApiClient(businessId)
    const { asanaWorkspaceGid } = await this.getBusinessCredentials(businessId)

    const tasks = []
    let offset: string | null = null
    const taskFields = [
      "name",
      "completed",
      "assignee",
      "projects",
      "custom_fields",
      "notes",
      "due_on",
      "created_at",
      "modified_at",
    ]

    console.log(
      `[AsanaProvider] Starting project sync for business ${businessId} in workspace ${asanaWorkspaceGid}`
    )

    try {
      do {
        const params: any = {
          "opt_fields": taskFields.join(","),
          "limit": 100,
        }
        if (offset) {
          params.offset = offset
        }

        const response = await apiClient.get(
          `/workspaces/${asanaWorkspaceGid}/tasks/search`,
          { params }
        )

        if (response.data.data) {
          tasks.push(...response.data.data)
        }
        offset = response.data.next_page?.offset ?? null
      } while (offset)

      console.log(`[AsanaProvider] Fetched ${tasks.length} tasks from Asana.`)
      const projectGids = new Set<string>()

      for (const task of tasks) {
        if (!task.gid) continue

        // Use the Asana project name (first project) as the client identifier if available.
        const clientName: string = task.projects?.[0]?.name || 'Asana Client'
        const clientId = await getOrCreateClient(businessId, clientName)

        const normalizedData = {
          ...this.normalizeData(task),
          clientId,
          pmTool: 'ASANA',
        }

        await prisma.project.upsert({
          where: { businessId_pmToolId: { businessId, pmToolId: task.gid } },
          update: normalizedData,
          create: {
            ...normalizedData,
            businessId,
            pmToolId: task.gid,
          } as any,
        })

        if (task.projects) {
          task.projects.forEach((p: { gid: string }) => projectGids.add(p.gid))
        }
      }

      console.log(`[AsanaProvider] Synced ${tasks.length} tasks.`)
      return { taskCount: tasks.length, projectCount: projectGids.size }
    } catch (error) {
      const errorMessage =
        error instanceof Error && (error as any).response?.data
          ? JSON.stringify((error as any).response.data)
          : error.message
      console.error("[AsanaProvider] Error syncing projects:", errorMessage)
      throw error
    }
  }

  /**
   * Creates a webhook subscription in Asana for a specific resource.
   * This method requires an external system to handle the initial handshake.
   *
   * @param businessId - The ID of the business to set up the webhook for.
   * @returns The ID of the created webhook.
   */
  async setupWebhooks(businessId: string): Promise<{ webhookId: string }> {
    const apiClient = await this.getApiClient(businessId)
    const { asanaWorkspaceGid } = await this.getBusinessCredentials(businessId)

    if (!process.env.APP_BASE_URL) {
      throw new Error("APP_BASE_URL environment variable is not set.")
    }

    const targetUrl = `${process.env.APP_BASE_URL}${WEBHOOK_TARGET_PATH}?businessId=${businessId}`

    try {
      const response = await apiClient.post("/webhooks", {
        data: {
          resource: asanaWorkspaceGid,
          target: targetUrl,
          filters: [
            { resource_type: "task", action: "added" },
            { resource_type: "task", action: "changed" },
            { resource_type: "task", action: "deleted" },
          ],
        },
      })

      const webhookId = response.data.data.gid
      console.log(
        `[AsanaProvider] Successfully requested webhook creation with ID: ${webhookId}. Awaiting handshake.`
      )

      // The handshake response is handled by the webhook endpoint itself.
      // Asana holds the request open until the handshake is complete.
      return { webhookId }
    } catch (error) {
      const errorMessage =
        error instanceof Error && (error as any).response?.data
          ? JSON.stringify((error as any).response.data)
          : error.message
      console.error("[AsanaProvider] Failed to setup webhook:", errorMessage)
      throw error
    }
  }

  /**
   * Processes an incoming webhook event from Asana after validating its signature.
   *
   * @param request - The incoming request object, containing the raw body and headers.
   */
  async handleWebhook(request: {
    rawBody: Buffer
    headers: Record<string, string | string[] | undefined>
    query: { businessId?: string }
  }): Promise<void> {
    const { rawBody, headers, query } = request
    const businessId = query.businessId
    const signature = headers["x-hook-signature"] as string | undefined

    if (!businessId) {
      console.error("[AsanaProvider] Webhook missing businessId in query.")
      return
    }

    const { asanaWebhookSecret } = await this.getBusinessCredentials(businessId)

    if (!signature || !asanaWebhookSecret) {
      console.error("[AsanaProvider] Missing signature or secret for webhook validation.")
      return
    }

    if (!this.validateWebhookSignature(asanaWebhookSecret, rawBody, signature)) {
      console.error("[AsanaProvider] Invalid webhook signature.")
      // In a real scenario, you would return a 401 Unauthorized response here.
      return
    }

    const payload = JSON.parse(rawBody.toString("utf-8"))
    console.log("[AsanaProvider] Webhook signature validated. Processing events.")

    if (payload.events) {
      const apiClient = await this.getApiClient(businessId)
      for (const event of payload.events) {
        if (event.resource?.resource_type === "task") {
          await this.processTaskEvent(event, apiClient, businessId)
        }
      }
    }
  }

  /**
   * Normalizes an Asana task object into the internal Project model.
   *
   * @param task - The raw task data object from the Asana API.
   * @returns A normalized Project object compatible with the Prisma schema.
   */
  normalizeData(task: any): Partial<Project> {
    let status = "IN_PROGRESS"
    if (task.completed) {
      status = "COMPLETED"
    } else if (task.name.toLowerCase().includes("blocked")) {
      status = "BLOCKED"
    }

    return {
      name: task.name,
      status: status,
      details: task.notes || null,
      assignee: task.assignee?.name || null,
      dueDate: task.due_on ? new Date(task.due_on) : null,
      createdAt: task.created_at ? new Date(task.created_at) : new Date(),
      updatedAt: task.modified_at ? new Date(task.modified_at) : new Date(),
    }
  }

  /**
   * Creates an Axios instance with the correct auth for a given business.
   */
  private async getApiClient(businessId: string): Promise<AxiosInstance> {
    const { asanaToken } = await this.getBusinessCredentials(businessId)
    return axios.create({
      baseURL: ASANA_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${asanaToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    })
  }

  /**
   * Fetches and validates the stored Asana credentials for a business.
   */
  private async getBusinessCredentials(businessId: string) {
    const integration = await prisma.integration.findFirst({
      where: {
        businessId,
        provider: 'ASANA',
      },
      select: {
        apiKey: true,
        credentials: true,
        webhookSecret: true,
      },
    })

    const creds = integration?.credentials as any || {}
    const token = integration?.apiKey || creds.accessToken || creds.apiKey
    const workspaceGid = creds.workspaceGid

    if (!token || !workspaceGid) {
      throw new Error(`Asana credentials not configured for business ${businessId}`)
    }

    return {
      asanaToken: token,
      asanaWorkspaceGid: workspaceGid,
      asanaWebhookSecret: integration?.webhookSecret ?? null,
    }
  }

  /**
   * Validates an incoming Asana webhook signature.
   */
  private validateWebhookSignature(
    secret: string,
    body: Buffer,
    signature: string
  ): boolean {
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex")
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, "hex"),
      Buffer.from(signature, "hex")
    )
  }

  /**
   * Processes a single task event from a webhook payload.
   */
  private async processTaskEvent(
    event: any,
    apiClient: AxiosInstance,
    businessId: string
  ) {
    const taskGid = event.resource.gid
    console.log(
      `[AsanaProvider] Processing event action '${event.action}' for task ${taskGid}`
    )
    if (event.action === "deleted") {
      await prisma.project.delete({ where: { businessId_pmToolId: { businessId, pmToolId: taskGid } } }).catch((e: any) => {
        console.warn(`[AsanaProvider] Failed to delete task ${taskGid}, it may have already been removed.`)
      })
    } else {
      try {
        const response = await apiClient.get(`/tasks/${taskGid}`)
        const taskData = response.data.data
        const normalizedData = this.normalizeData(taskData)
        await prisma.project.upsert({
          where: { businessId_pmToolId: { businessId, pmToolId: taskGid } },
          update: normalizedData,
          create: {
            ...normalizedData,
            pmToolId: taskGid,
            businessId,
            pmTool: "ASANA",
          } as any,
        })
      } catch (error) {
        if ((error as any).response?.status === 404) {
          console.warn(`[AsanaProvider] Task ${taskGid} not found, may have been deleted.`)
        } else {
          console.error(`[AsanaProvider] Failed to fetch task ${taskGid}:`, error.message)
        }
      }
    }
  }
}

export const asanaProvider = new AsanaProvider() 