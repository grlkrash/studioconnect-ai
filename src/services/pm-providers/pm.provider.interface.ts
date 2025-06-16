import { Project } from "@prisma/client"

/**
 * Defines the contract for all Project Management tool providers.
 */
export interface ProjectManagementProvider {
  /**
   * Establishes and tests the connection to the provider.
   * @param credentials - The API credentials required for authentication.
   *                      For Jira: { email: string, token: string, instanceUrl: string }
   */
  connect(credentials: { [key: string]: any }): Promise<boolean>;

  /**
   * Performs a one-way sync of all projects from the provider to the local database.
   * @param businessId - The ID of the business to sync projects for.
   */
  syncProjects(businessId: string): Promise<{ projectCount: number; taskCount: number }>;

  /**
   * Sets up webhooks for real-time updates from the provider.
   * @param businessId - The ID of the business to set up webhooks for.
   */
  setupWebhooks(businessId: string): Promise<{ webhookId: string }>;

  /**
   * Handles incoming webhook payloads after they have been authenticated.
   * @param payload - The webhook payload from the provider.
   * @param businessId - The businessId associated with this webhook event.
   */
  handleWebhook(payload: any, businessId: string): Promise<void>;

  /**
   * Normalizes data from the provider's format to the application's internal Project model.
   * @param providerData - The raw data object from the provider (e.g., a Jira issue).
   * @param businessId - The ID of the business this data belongs to.
   * @returns A partial Project object with normalized data.
   */
  normalizeData(providerData: any, businessId: string): Partial<Project>;
} 