import { Project } from "@prisma/client"

/**
 * Defines the contract for all Project Management tool providers.
 */
export interface ProjectManagementProvider {
  /**
   * Validates credentials and establishes a connection.
   * @param credentials - API token or other auth materials.
   * @returns A boolean indicating if the connection was successful.
   */
  connect(credentials: { apiKey: string; [key: string]: any }): Promise<boolean>;

  /**
   * Performs the initial one-way sync of all relevant project data.
   * @param businessId - The ID of the business to sync data for.
   * @returns A summary of synced data (e.g., project and task counts).
   */
  syncProjects(businessId: string): Promise<{ projectCount: number; taskCount: number }>;

  /**
   * Programmatically creates a webhook in the third-party service.
   * @param businessId - The ID of the business for which to set up the webhook.
   * @returns The details of the created webhook.
   */
  setupWebhooks(businessId: string): Promise<{ webhookId: string }>;

  /**
   * Processes an incoming webhook event payload from the provider.
   * @param payload - The raw, validated payload from the webhook request.
   */
  handleWebhook(payload: any): Promise<void>;

  /**
   * Normalizes provider-specific data into our internal Project model.
   * @param providerData - The raw data object from the provider's API.
   * @returns A normalized Project object compatible with our Prisma schema.
   */
  normalizeData(providerData: any): Partial<Project>;
} 