import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardCards } from "@/components/dashboard-cards"
import { StatsOverview } from "@/components/stats-overview"

export default function Dashboard() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <DashboardHeader />
      <div className="flex-1 p-6 space-y-6">
        <StatsOverview />
        <DashboardCards />
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
