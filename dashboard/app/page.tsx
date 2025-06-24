import { Metadata } from "next"
import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardCards } from "@/components/dashboard-cards"
import { AnalyticsCards } from "@/components/analytics-cards"
import { StatsOverview } from "@/components/stats-overview"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default function DashboardPage() {
  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Dashboard - Main Page</h1>
      <p>If you can see this page, the dashboard routing is working!</p>
      <p>Path: / (dashboard root)</p>
      <p>Timestamp: {new Date().toISOString()}</p>
      
      <div style={{ marginTop: '20px' }}>
        <h2>Navigation Test:</h2>
        <ul>
          <li><a href="/login" style={{ color: 'blue' }}>Login Page</a></li>
          <li><a href="/test-auth" style={{ color: 'blue' }}>Test Auth Page</a></li>
          <li><a href="/dashboard" style={{ color: 'blue' }}>Dashboard</a></li>
        </ul>
      </div>
    </div>
  )
}
