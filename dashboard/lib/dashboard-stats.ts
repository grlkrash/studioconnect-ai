import { prisma } from "./prisma"

interface DashboardCounts {
  clientsTotal: number
  clientsNewWeek: number
  projectsTotal: number
  projectsActive: number
  leadsTotal: number
}

/**
 * Fetch basic counts needed for the dashboard cards. If a businessId is not
 * provided, the first business in the database will be used. This keeps the demo
 * functional without complex auth plumbing.
 */
export async function getDashboardCounts(businessId?: string): Promise<DashboardCounts> {
  // Resolve businessId if not provided
  let bizId = businessId
  if (!bizId) {
    const firstBiz = await prisma.business.findFirst({ select: { id: true } })
    bizId = firstBiz?.id || undefined
  }

  // If we still do not have a business to reference, return zeros so the UI can
  // fall back gracefully.
  if (!bizId) {
    return {
      clientsTotal: 0,
      clientsNewWeek: 0,
      projectsTotal: 0,
      projectsActive: 0,
      leadsTotal: 0,
    }
  }

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const [clientsTotal, clientsNewWeek, projectsTotal, projectsActive, leadsTotal] =
    await Promise.all([
      prisma.client.count({ where: { businessId: bizId } }),
      prisma.client.count({
        where: { businessId: bizId, createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.project.count({ where: { businessId: bizId } }),
      prisma.project.count({
        where: { businessId: bizId, status: "active" },
      }),
      prisma.lead.count({ where: { businessId: bizId } }),
    ])

  return { clientsTotal, clientsNewWeek, projectsTotal, projectsActive, leadsTotal }
} 