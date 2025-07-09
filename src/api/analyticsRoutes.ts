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

// 📊 INTERACTIONS ANALYTICS ENDPOINT - For interactions page
router.get('/interactions', asyncHandler(async (req, res) => {
  console.log('[ANALYTICS] Fetching interactions analytics')
  
  try {
    const businessId = req.query.businessId as string
    if (!businessId) {
      return res.status(400).json({ error: 'Business ID required' })
    }

    const now = new Date()
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Get interaction data from conversations and calls
    const [conversations, calls] = await Promise.all([
      prisma.conversation.findMany({
        where: { 
          businessId,
          createdAt: { gte: last7Days }
        },
        select: {
          id: true,
          createdAt: true,
          metadata: true,
          endedAt: true
        }
      }),
      prisma.callLog.findMany({
        where: { 
          businessId,
          createdAt: { gte: last7Days }
        },
        select: {
          id: true,
          createdAt: true,
          status: true,
          metadata: true
        }
      })
    ])

    const totalInteractions = conversations.length + calls.length
    const activeInteractions = conversations.filter(c => !c.endedAt).length + 
                              calls.filter(c => c.status === 'IN_PROGRESS').length
    const completedInteractions = conversations.filter(c => c.endedAt).length + 
                                calls.filter(c => c.status === 'COMPLETED').length

    // Calculate metrics
    let totalDuration = 0
    let resolutionTimes: number[] = []
    let sentimentScores: number[] = []
    let satisfactionScores: number[] = []
    const topicCounts: Record<string, number> = {}

    // Process conversations
    conversations.forEach(conversation => {
      if (conversation.metadata && typeof conversation.metadata === 'object') {
        const metadata = conversation.metadata as any

        // Duration
        if (metadata.duration && typeof metadata.duration === 'number') {
          totalDuration += metadata.duration
        }

        // Resolution time
        if (metadata.resolutionTime && typeof metadata.resolutionTime === 'number') {
          resolutionTimes.push(metadata.resolutionTime)
        }

        // Sentiment
        if (metadata.sentiment_score && typeof metadata.sentiment_score === 'number') {
          sentimentScores.push(metadata.sentiment_score)
        }

        // Satisfaction
        if (metadata.satisfaction_score && typeof metadata.satisfaction_score === 'number') {
          satisfactionScores.push(metadata.satisfaction_score)
        }

        // Topics
        if (metadata.topics && Array.isArray(metadata.topics)) {
          metadata.topics.forEach((topic: string) => {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1
          })
        }
      }
    })

    // Process calls
    calls.forEach(call => {
      if (call.metadata && typeof call.metadata === 'object') {
        const metadata = call.metadata as any

        // Duration
        if (metadata.duration && typeof metadata.duration === 'number') {
          totalDuration += metadata.duration
        }

        // Resolution time
        if (metadata.resolutionTime && typeof metadata.resolutionTime === 'number') {
          resolutionTimes.push(metadata.resolutionTime)
        }

        // Sentiment
        if (metadata.sentiment_score && typeof metadata.sentiment_score === 'number') {
          sentimentScores.push(metadata.sentiment_score)
        }

        // Satisfaction
        if (metadata.satisfaction_score && typeof metadata.satisfaction_score === 'number') {
          satisfactionScores.push(metadata.satisfaction_score)
        }

        // Topics
        if (metadata.topics && Array.isArray(metadata.topics)) {
          metadata.topics.forEach((topic: string) => {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1
          })
        }
      }
    })

    const analytics = {
      totalInteractions,
      activeInteractions,
      completedInteractions,
      escalatedInteractions: 0, // TODO: implement escalation tracking
      averageResolutionTime: resolutionTimes.length > 0 ? 
        Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) : 0,
      customerSatisfaction: satisfactionScores.length > 0 ? 
        Number((satisfactionScores.reduce((a, b) => a + b, 0) / satisfactionScores.length).toFixed(1)) : 0,
      commonTopics: Object.entries(topicCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
      sentimentDistribution: {
        positive: sentimentScores.filter(s => s > 0.1).length,
        neutral: sentimentScores.filter(s => s >= -0.1 && s <= 0.1).length,
        negative: sentimentScores.filter(s => s < -0.1).length
      },
      hourlyVolume: generateHourlyVolume([...conversations, ...calls]),
      sourceDistribution: {
        widget: conversations.length,
        phone: calls.length,
        api: 0,
        whatsapp: 0,
        email: 0
      }
    }

    res.json({ analytics })
  } catch (error) {
    console.error('[ANALYTICS] Error fetching interactions analytics:', error)
    res.status(500).json({ error: 'Failed to fetch interactions analytics' })
  }
}))

// 📊 CALLS ANALYTICS ENDPOINT - For calls page
router.get('/calls', asyncHandler(async (req, res) => {
  console.log('[ANALYTICS] Fetching calls analytics')
  
  try {
    const businessId = req.query.businessId as string
    if (!businessId) {
      return res.status(400).json({ error: 'Business ID required' })
    }

    const now = new Date()
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const calls = await prisma.callLog.findMany({
      where: { 
        businessId,
        createdAt: { gte: last7Days }
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        metadata: true
      }
    })

    const totalCalls = calls.length
    const completedCalls = calls.filter(c => c.status === 'COMPLETED').length
    const failedCalls = calls.filter(c => c.status === 'FAILED').length
    const todayCalls = calls.filter(c => c.createdAt >= today).length

    // Calculate metrics from metadata
    let totalDuration = 0
    let validDurations = 0
    let sentimentScores: number[] = []
    const topicCounts: Record<string, number> = {}

    calls.forEach(call => {
      if (call.metadata && typeof call.metadata === 'object') {
        const metadata = call.metadata as any

        // Duration
        if (metadata.duration && typeof metadata.duration === 'number' && metadata.duration > 0) {
          totalDuration += metadata.duration
          validDurations++
        }

        // Sentiment
        if (metadata.sentiment_score && typeof metadata.sentiment_score === 'number') {
          sentimentScores.push(metadata.sentiment_score)
        }

        // Topics
        if (metadata.keyTopics && Array.isArray(metadata.keyTopics)) {
          metadata.keyTopics.forEach((topic: string) => {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1
          })
        }
      }
    })

    const analytics = {
      totalCalls,
      completedCalls,
      failedCalls,
      averageDuration: validDurations > 0 ? Math.round(totalDuration / validDurations) : 0,
      successRate: totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0,
      todayCalls,
      escalationRate: 0, // TODO: implement escalation tracking
      averageSentiment: sentimentScores.length > 0 ? 
        Number((sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length).toFixed(2)) : 0,
      topTopics: Object.entries(topicCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([topic, count]) => ({ topic, count })),
      hourlyDistribution: generateHourlyVolume(calls)
    }

    res.json({ analytics })
  } catch (error) {
    console.error('[ANALYTICS] Error fetching calls analytics:', error)
    res.status(500).json({ error: 'Failed to fetch calls analytics' })
  }
}))

// Helper function to generate hourly volume data
function generateHourlyVolume(interactions: Array<{ createdAt: Date }>): Array<{ hour: number; count: number }> {
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }))
  
  interactions.forEach(interaction => {
    const hour = new Date(interaction.createdAt).getHours()
    hourlyData[hour].count++
  })
  
  return hourlyData
}

export default router 