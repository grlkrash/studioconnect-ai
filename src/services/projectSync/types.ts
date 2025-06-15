export interface ProjectSyncProvider {
  /**
   * Synchronize projects for the given business. Implementations can upsert
   *   projects, update statuses, etc.
   * @param businessId – id of the Business whose projects need syncing
   */
  syncProjects(businessId: string): Promise<void>
} 