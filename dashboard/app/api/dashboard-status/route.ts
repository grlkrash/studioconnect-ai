import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const url = new URL(req.url)
    const businessId = url.searchParams.get('businessId') || business.id

    // Get system status and health metrics
    const [
      systemHealth,
      lastCallTime,
      activeIntegrations,
      voiceAgentStatus,
      clientsTotal,
      leadsTotal,
      knowledgeCount,
      questionsCount,
      businessNotifications
    ] = await Promise.all([
      // System health check
      Promise.resolve({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }),

      // Last call timestamp
      prisma.callLog.findFirst({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, status: true }
      }),

      // Active integrations count
      prisma.integration.count({
        where: { 
          businessId,
          isEnabled: true 
        }
      }),

      // Voice agent configuration status
      prisma.business.findUnique({
        where: { id: businessId },
        select: {
          voiceEnabled: true,
          openaiVoiceId: true,
          elevenlabsVoiceId: true
        }
      }),

      // Total clients
      prisma.client.count({
        where: { businessId }
      }),

      // Total leads
      prisma.lead.count({
        where: { businessId }
      }),

      // Knowledge base count
      prisma.knowledgeBase.count({
        where: { businessId }
      }),

      // Questions count
      prisma.leadCaptureQuestion.count({
        where: { config: { businessId } }
      }),

      // Business notification settings
      prisma.business.findUnique({
        where: { id: businessId },
        select: {
          notificationEmails: true,
          notificationPhoneNumber: true
        }
      })
    ])

    const status = {
      systemHealth,
      lastCall: lastCallTime ? {
        timestamp: lastCallTime.createdAt.toISOString(),
        status: lastCallTime.status
      } : null,
      integrations: {
        active: activeIntegrations,
        total: activeIntegrations // Could expand this to show total vs active
      },
      voiceAgent: {
        enabled: voiceAgentStatus?.voiceEnabled || false,
        configured: !!(voiceAgentStatus?.openaiVoiceId || voiceAgentStatus?.elevenlabsVoiceId)
      },
      clientsTotal,
      leadsTotal,
      knowledgeCount,
      questionsCount,
      notificationEmailsCount: businessNotifications?.notificationEmails?.length || 0,
      hasSms: !!businessNotifications?.notificationPhoneNumber
    }

    return NextResponse.json(status)

  } catch (error) {
    console.error('[DASHBOARD STATUS API] Error:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch dashboard status',
      systemHealth: {
        status: 'error',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    }, { status: 500 })
  }
} 