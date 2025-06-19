import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Users, MessageSquare, TrendingUp } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getBusiness } from "@/lib/getBusiness"

export async function StatsOverview() {
  const business = await getBusiness()
  if (!business) return null

  // Aggregate metrics
  const [totalCalls, totalChats, leadCalls, leadChats, projectInquiries, callMinutes] = await Promise.all([
    prisma.callLog.count({ where: { businessId: business.id } }),
    prisma.conversation.count({ where: { businessId: business.id } }),
    prisma.callLog.count({ where: { businessId: business.id, type: 'VOICE', status: 'COMPLETED' } }),
    prisma.conversation.count({ where: { businessId: business.id, leadId: { not: null } } }),
    prisma.conversation.count({ where: { businessId: business.id, metadata: { path: ['projectInquiry'], equals: true } } }),
    prisma.callLog.aggregate({
      where: { businessId: business.id },
      _sum: {
        metadata: true as any, // duration stored in metadata.duration
      },
    }) as unknown as { _sum: { metadata: { duration: number } | null } },
  ])

  const voiceMinutes = (callMinutes?._sum?.metadata as any)?.duration || 0

  const stats = [
    {
      title: 'Total AI Interactions',
      value: totalCalls + totalChats,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      subtitle: 'Combined calls & chats',
    },
    {
      title: 'Qualified Leads',
      value: leadCalls + leadChats,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      subtitle: 'Calls & chats marked as leads',
    },
    {
      title: 'Project Status Queries',
      value: projectInquiries,
      icon: Phone,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      subtitle: 'Handled by AI',
    },
    {
      title: 'Billing Usage (mins)',
      value: voiceMinutes,
      icon: MessageSquare,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      subtitle: 'Voice minutes processed',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 py-4">
      {stats.map((stat) => (
        <Card key={stat.title} className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">{stat.title}</CardTitle>
            <div className={`p-2 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <p className="text-xs text-slate-500 mt-1">{stat.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
