import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const business = await getBusiness(req)
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const businessId = business.id

    // Basic stats – calls today
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)

    const callsToday = await prisma.callLog.count({
      where: { businessId, createdAt: { gte: startOfToday } },
    })

    // Fetch Twilio number
    const bizMeta = await prisma.business.findUnique({
      where: { id: businessId },
      select: { twilioPhoneNumber: true },
    })

    // Placeholder values for now – can be expanded later
    const payload = {
      businessId,
      agentStatus: callsToday > 0 ? 'active' : 'idle',
      callsToday,
      avgResponse: '—',
      avgDuration: '—',
      successRate: '—',
      twilioPhoneNumber: bizMeta?.twilioPhoneNumber ?? null,
    }

    return NextResponse.json(payload)
  } catch (err) {
    console.error('[DASHBOARD_STATUS]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
} 