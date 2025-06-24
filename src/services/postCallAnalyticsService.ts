import { prisma } from './db'
import { Prisma } from '@prisma/client'

export interface ElevenLabsPostCallPayload {
  agent_id?: string
  call_sid: string
  caller_id?: string
  called_number?: string
  conversation_id?: string
  analysis?: {
    conversation?: any[]
    conversation_summary?: string
    sentiment_score?: number
    action_success?: boolean
    satisfaction_score?: number
  }
  conversation_summary?: string
  conversation?: any[]
  duration_seconds?: number
  call_status?: string
  sentiment_score?: number
  action_success?: boolean
  satisfaction_score?: number
  [key: string]: any
}

export interface ProcessedCallData {
  call_sid: string
  business_id: string
  business_name: string
  conversation_id: string
  has_transcript: boolean
  has_summary: boolean
  duration_seconds?: number
  sentiment_score?: number
  records_updated: string[]
}

export class PostCallAnalyticsService {
  /**
   * Process ElevenLabs post-call webhook payload
   * @param payload - Raw webhook payload from ElevenLabs
   * @returns Processed call data summary
   */
  async processPostCallData(payload: ElevenLabsPostCallPayload): Promise<ProcessedCallData> {
    console.log('[POST-CALL ANALYTICS] 🎯 Processing call data for:', payload.call_sid)
    
    // Extract key fields from payload
    const {
      agent_id,
      call_sid,
      caller_id,
      called_number,
      conversation_id,
      analysis,
      conversation_summary,
      conversation,
      duration_seconds,
      call_status,
      sentiment_score,
      action_success,
      satisfaction_score
    } = payload

    // Find the business using multiple strategies
    const business = await this.identifyBusiness(called_number, agent_id)
    
    if (!business) {
      throw new Error(`No business found for call ${call_sid}`)
    }

    console.log('[POST-CALL ANALYTICS] ✅ Business identified:', business.name)

    // Process conversation data
    const conversationData = this.extractConversationData(payload)
    
    // Upsert conversation record
    const conversationRecord = await this.upsertConversation({
      business_id: business.id,
      call_sid,
      caller_id,
      conversation_data: conversationData,
      metadata: {
        ...payload,
        processed_at: new Date().toISOString(),
        step_2_recovery_plan: true
      }
    })

    console.log('[POST-CALL ANALYTICS] ✅ Conversation record processed:', conversationRecord.id)

    // Upsert call log for dashboard visibility
    await this.upsertCallLog({
      call_sid,
      business_id: business.id,
      conversation_id: conversationRecord.id,
      caller_id,
      called_number,
      duration_seconds,
      sentiment_score,
      action_success,
      satisfaction_score,
      summary: conversation_summary || analysis?.conversation_summary,
      metadata: payload
    })

    console.log('[POST-CALL ANALYTICS] ✅ Call log record processed for dashboard')

    return {
      call_sid,
      business_id: business.id,
      business_name: business.name,
      conversation_id: conversationRecord.id,
      has_transcript: !!(conversation || analysis?.conversation),
      has_summary: !!(conversation_summary || analysis?.conversation_summary),
      duration_seconds,
      sentiment_score,
      records_updated: ['conversation', 'callLog']
    }
  }

  /**
   * Identify business using multiple fallback strategies
   */
  private async identifyBusiness(called_number?: string, agent_id?: string) {
    const normalizePhone = (num: string | null | undefined) =>
      (num || '').replace(/[^0-9]/g, '')

    console.log('[POST-CALL ANALYTICS] 🔍 Business identification process:')
    console.log('[POST-CALL ANALYTICS] - Called Number:', called_number)
    console.log('[POST-CALL ANALYTICS] - Agent ID:', agent_id)

    // Strategy 1: Exact phone number match
    if (called_number) {
      let business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: called_number },
        include: { agentConfig: true }
      })

      if (business) {
        console.log('[POST-CALL ANALYTICS] ✅ Found via exact phone match')
        return business
      }

      // Strategy 2: Normalized phone number match
      const digits = normalizePhone(called_number)
      if (digits.length >= 10) {
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: { endsWith: digits.slice(-10) } },
          include: { agentConfig: true }
        })

        if (business) {
          console.log('[POST-CALL ANALYTICS] ✅ Found via normalized phone match')
          return business
        }
      }
    }

    // Strategy 3: Agent ID fallback (if schema supports it)
    if (agent_id) {
      try {
        const business = await prisma.business.findFirst({
          where: { 
            agentConfig: { 
              is: { 
                // @ts-ignore - elevenlabsAgentId field may exist
                elevenlabsAgentId: agent_id 
              } 
            } 
          },
          include: { agentConfig: true }
        }) as any

        if (business) {
          console.log('[POST-CALL ANALYTICS] ✅ Found via agent ID match')
          return business
        }
      } catch (error) {
        console.warn('[POST-CALL ANALYTICS] ⚠️ Agent ID lookup failed:', error)
      }
    }

    console.error('[POST-CALL ANALYTICS] ❌ No business found with any strategy')
    return null
  }

  /**
   * Extract and normalize conversation data from payload
   */
  private extractConversationData(payload: ElevenLabsPostCallPayload) {
    const { conversation, analysis } = payload
    
    // Prioritize direct conversation field, fallback to analysis.conversation
    if (conversation && Array.isArray(conversation)) {
      return conversation
    }
    
    if (analysis?.conversation && Array.isArray(analysis.conversation)) {
      return analysis.conversation
    }
    
    return []
  }

  /**
   * Upsert conversation record with bulletproof error handling
   */
  private async upsertConversation(data: {
    business_id: string
    call_sid: string
    caller_id?: string
    conversation_data: any[]
    metadata: any
  }) {
    const conversationPayload = {
      businessId: data.business_id,
      sessionId: data.call_sid,
      messages: JSON.stringify(data.conversation_data),
      startedAt: new Date(),
      endedAt: new Date(),
      metadata: data.metadata,
      phoneNumber: data.caller_id ?? undefined
    }

    return await prisma.conversation.upsert({
      where: { sessionId: data.call_sid },
      update: {
        endedAt: conversationPayload.endedAt,
        metadata: conversationPayload.metadata,
        phoneNumber: conversationPayload.phoneNumber,
        messages: conversationPayload.messages
      },
      create: conversationPayload
    })
  }

  /**
   * Upsert call log for dashboard visibility
   */
  private async upsertCallLog(data: {
    call_sid: string
    business_id: string
    conversation_id: string
    caller_id?: string
    called_number?: string
    duration_seconds?: number
    sentiment_score?: number
    action_success?: boolean
    satisfaction_score?: number
    summary?: string
    metadata: any
  }) {
    const callLogPayload = {
      callSid: data.call_sid,
      businessId: data.business_id,
      conversationId: data.conversation_id,
      from: data.caller_id ?? 'unknown',
      to: data.called_number ?? 'unknown',
      source: 'elevenlabs',
      metadata: {
        ...data.metadata,
        duration_seconds: data.duration_seconds,
        sentiment_score: data.sentiment_score,
        action_success: data.action_success,
        satisfaction_score: data.satisfaction_score,
        processed_at: new Date().toISOString(),
        step_2_recovery_plan: true
      },
      type: 'VOICE' as const,
      direction: 'INBOUND' as const,
      status: 'COMPLETED' as const,
      content: data.summary ?? undefined
    }

    return await prisma.callLog.upsert({
      where: { callSid: data.call_sid },
      update: {
        content: callLogPayload.content,
        metadata: callLogPayload.metadata,
        status: callLogPayload.status
      },
      create: callLogPayload
    })
  }

  /**
   * Get analytics summary for a business
   */
  async getAnalyticsSummary(businessId: string, days: number = 30) {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const [totalCalls, callsWithAnalytics, callsWithMetadata] = await Promise.all([
      // Total calls
      prisma.callLog.count({
        where: {
          businessId,
          createdAt: { gte: since },
          source: 'elevenlabs'
        }
      }),

      // Calls with analytics data
      prisma.callLog.count({
        where: {
          businessId,
          createdAt: { gte: since },
          source: 'elevenlabs',
          metadata: { path: ['step_2_recovery_plan'], equals: true }
        }
      }),

      // Get calls with metadata for manual averaging
      prisma.callLog.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
          source: 'elevenlabs',
          metadata: { path: ['step_2_recovery_plan'], equals: true }
        },
        select: { metadata: true },
        take: 1000 // Limit for performance
      })
    ])

    // Calculate averages from JSON metadata manually
    let totalDuration = 0
    let durationCount = 0
    let totalSentiment = 0
    let sentimentCount = 0

    callsWithMetadata.forEach(call => {
      const metadata = call.metadata as any
      
      if (metadata?.duration_seconds && typeof metadata.duration_seconds === 'number') {
        totalDuration += metadata.duration_seconds
        durationCount++
      }
      
      if (metadata?.sentiment_score && typeof metadata.sentiment_score === 'number') {
        totalSentiment += metadata.sentiment_score
        sentimentCount++
      }
    })

    const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0
    const avgSentiment = sentimentCount > 0 ? Math.round((totalSentiment / sentimentCount) * 100) / 100 : 0

    return {
      total_calls: totalCalls,
      calls_with_analytics: callsWithAnalytics,
      analytics_coverage: totalCalls > 0 ? Math.round((callsWithAnalytics / totalCalls) * 100) : 0,
      avg_duration_seconds: avgDuration,
      avg_sentiment_score: avgSentiment,
      metadata_calls_analyzed: callsWithMetadata.length,
      period_days: days,
      generated_at: new Date().toISOString()
    }
  }
}

// 🎯 STEP 2: Export singleton service instance
export const postCallAnalyticsService = new PostCallAnalyticsService() 