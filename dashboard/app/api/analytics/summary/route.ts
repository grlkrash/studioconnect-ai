import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Revenue per month (sum of project value placeholder)
    const revenueRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT date_trunc('month', "createdAt") AS month,
             SUM(COALESCE((metadata->>'amount')::numeric,0)) AS total
      FROM "leads"
      WHERE "businessId" = $1
      GROUP BY 1
      ORDER BY 1 ASC;`, biz.id)

    const revenueData = revenueRows.map((r) => ({
      month: new Date(r.month).toLocaleString('default', { month: 'short' }),
      total: Number(r.total),
    }))

    // Calls by hour today
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const callRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT date_part('hour', "createdAt") AS hr, COUNT(*) AS cnt,
             SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS qualified
      FROM "call_logs" WHERE "businessId"=$1 AND "createdAt" >= $2
      GROUP BY 1 ORDER BY 1`, biz.id, todayStart)
    const callVolumeData = callRows.map((r)=>({ time: `${r.hr}:00`, calls: Number(r.cnt), qualified: Number(r.qualified)}))

    // Project distribution
    const projectRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT name, COUNT(*)*100.0/(SELECT COUNT(*) FROM "projects" WHERE "businessId"=$1) AS pct
      FROM "projects" WHERE "businessId"=$1 GROUP BY name LIMIT 6`, biz.id)
    const colors = ['#8B5CF6','#06B6D4','#10B981','#F59E0B','#EF4444','#a855f7']
    const projectTypeData = projectRows.map((r,i)=>({name:r.name,value:Math.round(r.pct),color:colors[i%colors.length]}))

    return NextResponse.json({ revenueData, callVolumeData, projectTypeData })
  } catch (err) {
    console.error('[ANALYTICS_SUM]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 