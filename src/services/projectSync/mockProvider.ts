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
          lastSyncedAt: new Date(),
        },
        create: {
          businessId,
          clientId: null, // no real client association for mock data
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