import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users } from "lucide-react"
import CallTable from "./call-table"

export default async function CallHistoryPage() {
  const business = await prisma.business.findFirst({ select: { id: true } })

  if (!business) return <div className="p-6">No business found.</div>

  const calls = await prisma.callLog.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between p-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            Call History
          </h1>
          <p className="text-slate-600 mt-1">Review all inbound and outbound calls handled by your AI agent.</p>
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
      </main>
    </div>
  )
} 