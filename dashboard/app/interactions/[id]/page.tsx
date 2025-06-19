import { prisma } from "@/lib/prisma"
import { getBusiness } from "@/lib/getBusiness"
import { notFound } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard-header"
import Link from "next/link"

export const dynamic = 'force-dynamic'

interface Params {
  params: { id: string }
}

export default async function InteractionDetail({ params }: Params) {
  const business = await getBusiness()
  if (!business) return notFound()

  // Try conversation first (chat) then callLog
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, businessId: business.id },
  })

  const call = await prisma.callLog.findFirst({
    where: { id: params.id, businessId: business.id },
  })

  if (!conversation && !call) return notFound()

  let transcript: string = ""

  if (conversation) {
    const messages: any[] = conversation.messages as any[]
    transcript = messages
      .map((m) => `${m.role === 'assistant' ? 'Agent' : 'User'}: ${m.content}`)
      .join("\n")
  } else if (call) {
    transcript = call.content || "No transcript available"
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <DashboardHeader />
      <div className="flex-1 p-6 space-y-6 max-w-3xl mx-auto">
        <Link href="/interactions" className="text-sky-600 underline">
          ← Back to interactions
        </Link>
        <h2 className="text-2xl font-bold text-slate-900">Transcript</h2>
        <pre className="whitespace-pre-wrap bg-white p-4 rounded-lg border border-slate-200 text-slate-800 overflow-auto">
          {transcript || '—'}
        </pre>
      </div>
    </div>
  )
} 