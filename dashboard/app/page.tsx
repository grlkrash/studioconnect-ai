import { Metadata } from "next"
import { redirect } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardCards } from "@/components/dashboard-cards"
import { StatsOverview } from "@/components/stats-overview"

// This component is a redirect page
// Remove dynamic = 'force-dynamic' for static export

export const metadata: Metadata = {
  title: "Dashboard",
}

export default function Page() {
  redirect("/admin/dashboard")
}
