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
    const limit = parseInt(url.searchParams.get('limit') || '50')

    // Fetch recent leads
    const leads = await prisma.lead.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    // Fetch recent knowledge base entries and filter for scope-creep risks
    const kbEntries = await prisma.knowledgeBase.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        project: {
          select: { name: true }
        }
      }
    })

    const risks = kbEntries.filter(entry => (entry.metadata as any)?.type === 'SCOPE_CREEP_RISK')

    // Merge and sort chronologically
    const feed = [
      ...leads.map(l => ({
        id: l.id,
        type: 'NEW_LEAD' as const,
        createdAt: l.createdAt,
        title: 'New Lead Intake',
        summary: JSON.stringify(l.capturedData, null, 2).slice(0, 200),
        riskTags: [],
        projectId: null,
      })),
      ...risks.map(r => ({
        id: r.id,
        type: 'SCOPE_CREEP' as const,
        createdAt: r.createdAt,
        title: r.project ? `Scope Alert: Project ${r.project.name}` : 'Scope Alert',
        summary: r.content,
        riskTags: ['⚠️ Scope Creep Risk'],
        projectId: r.projectId ?? null,
      }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return NextResponse.json({ feed })
  } catch (error) {
    console.error('[FEED API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch feed' }, { status: 500 })
  }
} 