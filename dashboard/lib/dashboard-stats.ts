import { prisma } from "./prisma"

interface DashboardCounts {
  clientsTotal: number
  clientsNewWeek: number
  projectsTotal: number
  projectsActive: number
  leadsTotal: number
  // Analytics KPIs
  callsTotal: number
  callsToday: number
  avgSentimentScore: number
  actionSuccessRate: number
  avgCallDuration: number
  clientSatisfactionScore: number
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
      callsTotal: 0,
      callsToday: 0,
      avgSentimentScore: 0,
      actionSuccessRate: 0,
      avgCallDuration: 0,
      clientSatisfactionScore: 0,
    }
  }

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [
    clientsTotal, 
    clientsNewWeek, 
    projectsTotal, 
    projectsActive, 
    leadsTotal,
    callsTotal,
    callsToday,
    callAnalytics
  ] = await Promise.all([
    prisma.client.count({ where: { businessId: bizId } }),
    prisma.client.count({
      where: { businessId: bizId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.project.count({ where: { businessId: bizId } }),
    prisma.project.count({
      where: { businessId: bizId, status: "active" },
    }),
    prisma.lead.count({ where: { businessId: bizId } }),
    // Analytics KPIs
    prisma.callLog.count({ where: { businessId: bizId } }),
    prisma.callLog.count({ 
      where: { 
        businessId: bizId, 
        createdAt: { gte: today } 
      } 
    }),
    // Get analytics data from call logs
    prisma.callLog.aggregate({
      where: { 
        businessId: bizId,
        metadata: { not: null }
      },
      _avg: {
        // We'll calculate these from metadata JSON fields
      }
    })
  ])

  // Calculate analytics KPIs from call logs metadata
  const recentCalls = await prisma.callLog.findMany({
    where: { 
      businessId: bizId,
      metadata: { not: null },
      createdAt: { gte: sevenDaysAgo }
    },
    select: { metadata: true }
  })

  let avgSentimentScore = 0
  let actionSuccessRate = 0
  let avgCallDuration = 0
  let clientSatisfactionScore = 0

  if (recentCalls.length > 0) {
    let totalSentiment = 0
    let totalDuration = 0
    let successfulActions = 0
    let totalSatisfaction = 0
    let sentimentCount = 0
    let durationCount = 0
    let actionCount = 0
    let satisfactionCount = 0

    recentCalls.forEach(call => {
      const metadata = call.metadata as any
      
      if (metadata?.sentiment_score) {
        totalSentiment += metadata.sentiment_score
        sentimentCount++
      }
      
      if (metadata?.duration) {
        totalDuration += metadata.duration
        durationCount++
      }
      
      if (metadata?.action_success !== undefined) {
        if (metadata.action_success) successfulActions++
        actionCount++
      }
      
      if (metadata?.satisfaction_score) {
        totalSatisfaction += metadata.satisfaction_score
        satisfactionCount++
      }
    })

    avgSentimentScore = sentimentCount > 0 ? Math.round((totalSentiment / sentimentCount) * 100) / 100 : 0
    avgCallDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0
    actionSuccessRate = actionCount > 0 ? Math.round((successfulActions / actionCount) * 100) : 0
    clientSatisfactionScore = satisfactionCount > 0 ? Math.round((totalSatisfaction / satisfactionCount) * 100) / 100 : 0
  }

  return { 
    clientsTotal, 
    clientsNewWeek, 
    projectsTotal, 
    projectsActive, 
    leadsTotal,
    callsTotal,
    callsToday,
    avgSentimentScore,
    actionSuccessRate,
    avgCallDuration,
    clientSatisfactionScore
  }
} 