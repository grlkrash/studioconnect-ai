import { prisma } from "@/lib/prisma"
import { getBusiness } from "@/lib/getBusiness"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users } from "lucide-react"
import CallTable from "./call-table"
import Link from "next/link"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

export default async function CallHistoryPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const business = await getBusiness()

  if (!business) return <div className="p-6">No business found.</div>

  const pageSize = 50
  const timeframe = searchParams?.t ?? "all" // all, 24h, 7d
  const page = parseInt(searchParams?.page ?? "1", 10)
  const skip = (page - 1) * pageSize

  const dateFilter = ()=>{
    if(timeframe==='24h') { const d=new Date(); d.setDate(d.getDate()-1); return { gte: d } }
    if(timeframe==='7d') { const d=new Date(); d.setDate(d.getDate()-7); return { gte: d } }
    return undefined
  }

  const whereBase:any = { businessId: business.id }
  if(dateFilter()) whereBase.createdAt = dateFilter()

  const [totalCount, calls] = await Promise.all([
    prisma.callLog.count({ where: whereBase }),
    prisma.callLog.findMany({
      where: whereBase,
      orderBy: { createdAt: "desc" },
      include: {
        conversation: { select: { client: { select: { name: true } } } },
      },
      skip,
      take: pageSize,
    }),
  ])

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between p-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            Call History
          </h1>
          <div className="flex items-center gap-4">
            <p className="text-slate-600 mt-1">Review all inbound and outbound calls handled by your AI agent.</p>
            <Select defaultValue={timeframe} onValueChange={(v)=>{window.location.href=`/calls?t=${v}`}}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Calls</CardTitle>
            <CardDescription>Inbound and outbound voice calls</CardDescription>
          </CardHeader>
          <CardContent>
            <CallTable calls={calls} />
          </CardContent>
        </Card>

        {/* Pagination Controls */}
        <div className="flex justify-center space-x-4">
          {page > 1 && (
            <Link href={`/calls?page=${page - 1}`} className="text-sm text-blue-600 underline">
              ← Previous
            </Link>
          )}
          {page < totalPages && (
            <Link href={`/calls?page=${page + 1}`} className="text-sm text-blue-600 underline">
              Next →
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}

export const dynamic = 'force-dynamic' 