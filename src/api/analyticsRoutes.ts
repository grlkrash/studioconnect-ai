import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { prisma } from '../services/db'

const router = Router()

// 📊 ANALYTICS SUMMARY ENDPOINT - Provides KPI data for dashboard
router.get('/summary', asyncHandler(async (req, res) => {
  console.log('[ANALYTICS] Fetching analytics summary')
  
  try {
    const now = new Date()
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get call analytics
    const [
      callsTotal,
      callsToday,
      callsLast7Days,
      recentCalls
    ] = await Promise.all([
      // Total calls
      prisma.callLog.count(),
      
      // Calls today
      prisma.callLog.count({
        where: { createdAt: { gte: today } }
      }),
      
      // Calls in last 7 days
      prisma.callLog.count({
        where: { createdAt: { gte: last7Days } }
      }),
      
      // Recent calls for analysis
      prisma.callLog.findMany({
        where: { createdAt: { gte: last7Days } },
        select: {
          id: true,
          createdAt: true,
          metadata: true,
          status: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ])

    // Calculate metrics from metadata
    let totalDuration = 0
    let sentimentSum = 0
    let sentimentCount = 0
    let actionSuccessCount = 0
    let actionTotalCount = 0
    let satisfactionSum = 0
    let satisfactionCount = 0

    recentCalls.forEach(call => {
      // Parse metadata if available
      if (call.metadata && typeof call.metadata === 'object') {
        const metadata = call.metadata as any

        // Duration from metadata
        if (metadata.duration || metadata.call_duration) {
          const duration = metadata.duration || metadata.call_duration
          if (typeof duration === 'number' && duration > 0) {
            totalDuration += duration
          }
        }

        // Sentiment analysis
        if (metadata.sentiment_score || metadata.sentimentScore) {
          const score = metadata.sentiment_score || metadata.sentimentScore
          if (typeof score === 'number' && score >= -1 && score <= 1) {
            sentimentSum += score
            sentimentCount++
          }
        }

        // Action success rate
        if (metadata.actions || metadata.action_results) {
          const actions = metadata.actions || metadata.action_results
          if (Array.isArray(actions)) {
            actionTotalCount += actions.length
            actionSuccessCount += actions.filter(a => a.success || a.completed).length
          }
        }

        // Customer satisfaction
        if (metadata.satisfaction_score || metadata.customerSatisfaction) {
          const score = metadata.satisfaction_score || metadata.customerSatisfaction
          if (typeof score === 'number' && score >= 1 && score <= 5) {
            satisfactionSum += score
            satisfactionCount++
          }
        }
      }
    })

    // Calculate averages
    const avgCallDuration = recentCalls.length > 0 ? Math.round(totalDuration / recentCalls.length) : 0
    const avgSentimentScore = sentimentCount > 0 ? Number((sentimentSum / sentimentCount).toFixed(2)) : 0
    const actionSuccessRate = actionTotalCount > 0 ? Math.round((actionSuccessCount / actionTotalCount) * 100) : 0
    const clientSatisfactionScore = satisfactionCount > 0 ? Number((satisfactionSum / satisfactionCount).toFixed(1)) : 0

    // Get business data for other metrics
    const [
      clientsTotal,
      clientsNewWeek,
      projectsTotal,
      projectsActive,
      leadsTotal
    ] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({
        where: { createdAt: { gte: last7Days } }
      }),
      prisma.project.count(),
      prisma.project.count({
        where: { status: 'active' }
      }),
      prisma.lead.count()
    ])

    const analytics = {
      // Basic counts
      clientsTotal,
      clientsNewWeek,
      projectsTotal,
      projectsActive,
      leadsTotal,
      
      // Call analytics
      callsTotal,
      callsToday,
      avgSentimentScore,
      actionSuccessRate,
      avgCallDuration,
      clientSatisfactionScore,
      
      // Additional metadata
      last7DaysCalls: callsLast7Days,
      dataCompleteness: {
        totalCalls: recentCalls.length,
        withDuration: recentCalls.filter(c => {
          const metadata = c.metadata as any
          return metadata && (metadata.duration || metadata.call_duration)
        }).length,
        withSentiment: sentimentCount,
        withActionData: actionTotalCount > 0 ? recentCalls.filter(c => {
          const metadata = c.metadata as any
          return metadata && (metadata.actions || metadata.action_results)
        }).length : 0,
        withSatisfactionScore: satisfactionCount
      }
    }

    console.log('[ANALYTICS] Summary generated:', {
      callsTotal,
      callsToday,
      avgSentimentScore,
      actionSuccessRate,
      avgCallDuration,
      clientSatisfactionScore
    })

    res.json(analytics)
  } catch (error) {
    console.error('[ANALYTICS] Error fetching summary:', error)
    res.status(500).json({ error: 'Failed to fetch analytics summary' })
  }
}))

export default router 