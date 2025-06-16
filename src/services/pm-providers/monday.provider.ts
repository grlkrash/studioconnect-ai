import { Project } from '@prisma/client'
import axios from 'axios'
import { prisma } from '../db'
import { ProjectManagementProvider } from './pm.provider.interface'

const MONDAY_API_URL = 'https://api.monday.com/v2'

/**
 * Implements the ProjectManagementProvider for Monday.com, handling API interaction
 * for syncing projects, and managing webhooks.
 */
export class MondayProvider implements ProjectManagementProvider {
  /**
   * Retrieves the API client for a given business, configured with the correct credentials.
   * @param businessId - The ID of the business.
   * @returns An axios-like client for making authenticated requests to the Monday.com API.
   */
  private async getApiClient(businessId: string) {
    // In a real app, you would fetch securely stored credentials.
    // Here we'll simulate fetching it, assuming it's stored on an Integration model.
    const integration = await prisma.integration.findFirst({
      where: {
        businessId,
        provider: 'MONDAY',
      },
    })

    const apiKey = (integration?.credentials as any)?.apiKey || process.env.MONDAY_API_KEY

    if (!apiKey) {
      throw new Error(`[MondayProvider] API key for business ${businessId} not found.`)
    }

    return {
      post: (data: { query: string, variables?: Record<string, any> }) =>
        axios.post(MONDAY_API_URL, data, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
            'API-Version': '2023-10',
          },
        }),
    }
  }

  /**
   * Establishes and tests the connection to the Monday.com API using provided credentials.
   * @param credentials - An object containing the `apiKey`.
   * @returns A boolean indicating if the connection was successful.
   */
  async connect(credentials: { apiKey: string }): Promise<boolean> {
    if (!credentials.apiKey) {
      console.error('[MondayProvider] API key is required for connection.')
      return false
    }

    try {
      const query = 'query { me { id } }'
      await axios.post(
        MONDAY_API_URL,
        { query },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: credentials.apiKey,
          },
        },
      )
      console.log('[MondayProvider] Connection to Monday.com successful.')
      return true
    } catch (error: any) {
      console.error(
        '[MondayProvider] Connection failed:',
        error.response?.data || error.message,
      )
      return false
    }
  }

  /**
   * Performs a one-way sync of all boards and items from Monday.com to the local database.
   * @param businessId - The ID of the business to sync projects for.
   * @returns A summary of the synced data.
   */
  async syncProjects(businessId: string): Promise<{ projectCount: number, taskCount: number }> {
    const apiClient = await this.getApiClient(businessId)
    let projectCount = 0
    let taskCount = 0

    const boardsQuery = 'query { boards(limit: 100) { id name } }'
    const boardsResponse = await apiClient.post({ query: boardsQuery })
    const boards = boardsResponse.data.data.boards || []
    projectCount = boards.length

    for (const board of boards) {
      let cursor: string | null = null
      let hasMore = true

      while (hasMore) {
        const itemsQuery = `
          query($boardId: [ID!], $cursor: String) {
            boards(ids: $boardId) {
              items_page(limit: 25, cursor: $cursor) {
                cursor
                items {
                  id
                  name
                  column_values {
                    id
                    title
                    text
                    type
                  }
                }
              }
            }
          }`

        const variables = { boardId: [board.id], cursor }
        const itemsResponse = await apiClient.post({ query: itemsQuery, variables })
        const itemsPage = itemsResponse.data.data.boards[0]?.items_page

        if (!itemsPage || itemsPage.items.length === 0) {
          hasMore = false
          continue
        }

        const items = itemsPage.items
        taskCount += items.length

        for (const item of items) {
          const normalizedData = this.normalizeData(item, businessId)
          if (!normalizedData.pmToolId) continue
          
          await prisma.project.upsert({
            where: { pmToolId_businessId: { pmToolId: normalizedData.pmToolId, businessId } },
            update: normalizedData,
            create: {
              ...normalizedData,
              businessId,
            } as any,
          })
        }

        cursor = itemsPage.cursor
        if (!cursor) {
          hasMore = false
        }
      }
    }

    console.log(`[MondayProvider] Sync complete for business ${businessId}. Synced ${projectCount} boards and ${taskCount} items.`)
    return { projectCount, taskCount }
  }

  /**
   * Sets up webhooks for all boards in a Monday.com account to enable real-time updates.
   * @param businessId - The ID of the business for which to set up webhooks.
   * @returns An object containing the ID of the last created webhook.
   */
  async setupWebhooks(businessId: string): Promise<{ webhookId: string }> {
    const apiClient = await this.getApiClient(businessId)
    const webhookUrl = `${process.env.APP_URL}/api/webhooks/pm/monday?businessId=${businessId}`
    let lastWebhookId = ''

    const boardsQuery = 'query { boards(limit: 100) { id } }'
    const boardsResponse = await apiClient.post({ query: boardsQuery })
    const boards = boardsResponse.data.data.boards

    const eventsToSubscribe: string[] = ['create_item', 'update_column_value']

    for (const board of boards) {
      for (const event of eventsToSubscribe) {
        const mutation = `
          mutation($boardId: ID!, $url: String!, $event: WebhookEventType!) {
            create_webhook(board_id: $boardId, url: $url, event: $event) {
              id
            }
          }`
        const variables = { boardId: board.id, url: webhookUrl, event }

        try {
          const response = await apiClient.post({ query: mutation, variables })
          if (response.data.errors) {
            throw new Error(JSON.stringify(response.data.errors))
          }
          const webhookId = response.data.data.create_webhook.id
          lastWebhookId = webhookId
          console.log(`[MondayProvider] Created webhook ${webhookId} for board ${board.id} and event ${event}.`)
        } catch (error: any) {
          console.error(`[MondayProvider] Failed to create webhook for board ${board.id} and event ${event}:`, error.message)
        }
      }
    }

    if (!lastWebhookId) {
      throw new Error(`[MondayProvider] Failed to create any webhooks for business ${businessId}.`)
    }
    return { webhookId: lastWebhookId }
  }

  /**
   * Handles incoming webhook payloads from Monday.com.
   * @param payload - The webhook payload.
   * @param businessId - The businessId associated with the webhook.
   */
  async handleWebhook(payload: any, businessId: string): Promise<void> {
    const { event } = payload

    if (!event || !event.pulseId) {
      console.warn('[MondayProvider] Received webhook without event or pulseId.')
      return
    }

    const apiClient = await this.getApiClient(businessId)
    const itemQuery = `
      query($itemId: [ID!]) {
        items(ids: $itemId) {
          id
          name
          column_values {
            id
            title
            text
            type
          }
        }
      }`

    const variables = { itemId: [event.pulseId] }
    const response = await apiClient.post({ query: itemQuery, variables })
    const item = response.data.data.items[0]

    if (item) {
      const normalizedData = this.normalizeData(item, businessId)
      await prisma.project.upsert({
        where: { pmToolId_businessId: { pmToolId: item.id, businessId } },
        update: normalizedData,
        create: {
          ...normalizedData,
          businessId,
        } as any,
      })
      console.log(`[MondayProvider] Processed webhook for item ${item.id} for business ${businessId}.`)
    }
  }

  /**
   * Normalizes data from the Monday.com item format to the application's internal Project model.
   * @param providerData - The raw item object from Monday.com.
   * @param businessId - The ID of the business this data belongs to.
   * @returns A partial Project object with normalized data.
   */
  normalizeData(providerData: any, businessId: string): Partial<Project> {
    const { id, name, column_values = [] } = providerData

    const normalized: Partial<Project> = {
      pmToolId: id.toString(),
      name: name || 'Untitled Item',
      businessId,
    }

    const statusColumn = column_values.find((c: any) => c.type === 'status')
    if (statusColumn) {
      normalized.status = statusColumn.text || 'No Status'
    }

    return normalized
  }
} 