import { ProjectSyncProvider } from './types'
import { prisma } from '../db'

/**
 * Simple mock provider that inserts a handful of demo projects for a business.
 * Guarded by the SEED_MOCK_PROJECTS env-var so it is never executed in prod
 * unless explicitly enabled.
 */
export const mockProjectProvider: ProjectSyncProvider = {
  async syncProjects(businessId: string): Promise<void> {
    if (process.env.SEED_MOCK_PROJECTS !== 'true') return

    // Fetch all existing clients for the business (including any newly added)
    let clients = await prisma.client.findMany({ where: { businessId } })

    // If the business has no clients yet, create a single mock client so projects can still be associated
    if (clients.length === 0) {
      const created = await prisma.client.upsert({
        where: { externalId: `MOCK-${businessId}` },
        update: { name: 'Mock Client' },
        create: {
          businessId,
          name: 'Mock Client',
          externalId: `MOCK-${businessId}`,
        },
      })
      clients = [created]
    }

    const mockProjects = [
      {
        name: 'Website Redesign',
        status: 'In Progress',
        details: 'Revamping corporate marketing site',
      },
      {
        name: 'Brand Guidelines',
        status: 'Completed',
        details: 'Delivered new visual identity and brand book',
      },
      {
        name: 'Social Media Campaign – Q3',
        status: 'Planning',
        details: 'Strategy & asset creation for Q3 push',
      },
    ]

    for (const [idx, project] of mockProjects.entries()) {
      const targetClientId = clients[idx % clients.length].id
      await prisma.project.upsert({
        where: {
          externalId: `MOCK-${businessId}-${idx}`,
        },
        update: {
          name: project.name,
          status: project.status,
          details: project.details,
          clientId: targetClientId,
          lastSyncedAt: new Date(),
        },
        create: {
          businessId,
          clientId: targetClientId,
          name: project.name,
          status: project.status,
          details: project.details,
          externalId: `MOCK-${businessId}-${idx}`,
          lastSyncedAt: new Date(),
        },
      })
    }
  },
} 