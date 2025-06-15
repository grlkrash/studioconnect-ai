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

    // Ensure we have a mock client to associate with the demo projects
    const mockClient = await prisma.client.upsert({
      where: { externalId: `MOCK-${businessId}` },
      update: { name: 'Mock Client' },
      create: {
        businessId,
        name: 'Mock Client',
        externalId: `MOCK-${businessId}`,
      },
    })

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
      await prisma.project.upsert({
        where: {
          externalId: `MOCK-${businessId}-${idx}`,
        },
        update: {
          name: project.name,
          status: project.status,
          details: project.details,
          clientId: mockClient.id,
          lastSyncedAt: new Date(),
        },
        create: {
          businessId,
          clientId: mockClient.id,
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