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

    const [clients, clientsTotal, clientsNewWeek, leadsQualified] = await Promise.all([
      // Get clients with projects
      prisma.client.findMany({
        where: { businessId: business.id },
        include: { projects: true },
        orderBy: { createdAt: 'desc' },
      }),

      // Total clients
      prisma.client.count({ 
        where: { businessId: business.id } 
      }),

      // New clients this week
      prisma.client.count({
        where: { 
          businessId: business.id, 
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        },
      }),

      // Qualified leads
      prisma.lead.count({ 
        where: { businessId: business.id, status: "QUALIFIED" } 
      }),
    ])

    return NextResponse.json({
      clients: clients.map(client => ({
        ...client,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString()
      })),
      stats: {
        clientsTotal,
        clientsNewWeek,
        leadsQualified
      }
    })

  } catch (error) {
    console.error('[CLIENTS API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
  }
} 