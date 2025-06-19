import InteractionTable from "@/components/interaction-table"
import { DashboardHeader } from "@/components/dashboard-header"
import { prisma } from "@/lib/prisma"
import { getBusiness } from "@/lib/getBusiness"

export const dynamic = 'force-dynamic'

export default async function InteractionsPage() {
  const business = await getBusiness()
  if (!business) return <div className="p-6">Business not found</div>

  const [calls, conversations] = await Promise.all([
    prisma.callLog.findMany({
      where: { businessId: business.id },
      include: { conversation: { include: { client: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.conversation.findMany({
      where: { businessId: business.id },
      include: { client: true },
      orderBy: { startedAt: 'desc' },
    }),
  ])

  const interactions = [
    ...calls.map((c) => ({
      id: c.id,
      type: 'voice' as const,
      from: c.from,
      client: c.conversation?.client?.name ?? null,
      date: c.createdAt,
      duration: (c.metadata as any)?.duration ?? null,
      status: c.status,
      conversationId: c.conversationId,
    })),
    ...conversations.map((conv) => ({
      id: conv.id,
      type: 'chat' as const,
      from: conv.phoneNumber ?? '',
      client: conv.client?.name ?? null,
      date: conv.startedAt,
      duration: null,
      status: null,
      conversationId: conv.id,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <DashboardHeader />
      <div className="flex-1 p-6 space-y-6">
        <InteractionTable interactions={interactions} />
      </div>
    </div>
  )
} 