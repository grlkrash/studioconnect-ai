import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    console.log('[CALLS API] Processing request...')
    
    const business = await getBusiness(req)
    if (!business) {
      console.log('[CALLS API] No business found')
      return NextResponse.json({ calls: [] })
    }

    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')
    const direction = url.searchParams.get('direction')

    console.log(`[CALLS API] Fetching calls for business: ${business.id}`)

    // Build filters
    let where: any = {
      businessId: business.id
    }

    if (status && status !== 'all') {
      where.status = status
    }

    if (direction && direction !== 'all') {
      where.direction = direction
    }

    if (search) {
      where.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { to: { contains: search, mode: 'insensitive' } }
      ]
    }

    const calls = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        from: true,
        to: true,
        status: true,
        direction: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        businessId: true,
        metadata: true
      }
    })

    const totalCount = await prisma.callLog.count({ where })

    console.log(`[CALLS API] Found ${calls.length} calls, total: ${totalCount}`)

    return NextResponse.json({
      calls: calls.map(call => ({
        id: call.id,
        from: call.from || 'Unknown',
        to: call.to || 'Unknown', 
        status: call.status,
        direction: call.direction,
        type: call.type,
        duration: (call.metadata as any)?.duration || 0,
        createdAt: call.createdAt.toISOString(),
        updatedAt: call.updatedAt.toISOString()
      })),
      totalCount,
      hasMore: offset + calls.length < totalCount
    })

  } catch (error) {
    console.error('[CALLS API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 })
  }
} 