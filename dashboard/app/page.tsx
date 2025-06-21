import { Metadata } from "next"
import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardCards } from "@/components/dashboard-cards"
import { AnalyticsCards } from "@/components/analytics-cards"
import { StatsOverview } from "@/components/stats-overview"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <DashboardHeader />
      <div className="flex-1 p-6 space-y-8">
        <StatsOverview />
        <AnalyticsCards />
        <DashboardCards />
      </div>
    </div>
  )
}
