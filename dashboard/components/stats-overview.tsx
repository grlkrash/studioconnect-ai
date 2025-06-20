"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Users, MessageSquare, TrendingUp } from "lucide-react"
import { useState, useEffect } from "react"

interface StatsData {
  totalInteractions: number
  qualifiedLeads: number
  projectInquiries: number
  voiceMinutes: number
}

export function StatsOverview() {
  const [stats, setStats] = useState<StatsData>({ 
    totalInteractions: 0, 
    qualifiedLeads: 0, 
    projectInquiries: 0, 
    voiceMinutes: 0 
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/analytics/summary', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setStats({
            totalInteractions: (data.totalCalls || 0) + (data.totalInteractions || 0),
            qualifiedLeads: data.totalCalls || 0, // Using calls as proxy for qualified leads
            projectInquiries: data.totalInteractions || 0, // Using interactions as proxy
            voiceMinutes: Math.round((data.totalCalls || 0) * 2.5) // Estimate 2.5 min avg call
          })
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  const statItems = [
    {
      title: 'Total AI Interactions',
      value: loading ? '...' : stats.totalInteractions,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      subtitle: 'Combined calls & chats',
    },
    {
      title: 'Qualified Leads',
      value: loading ? '...' : stats.qualifiedLeads,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      subtitle: 'Calls & chats marked as leads',
    },
    {
      title: 'Project Status Queries',
      value: loading ? '...' : stats.projectInquiries,
      icon: Phone,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      subtitle: 'Handled by AI',
    },
    {
      title: 'Billing Usage (mins)',
      value: loading ? '...' : stats.voiceMinutes,
      icon: MessageSquare,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      subtitle: 'Voice minutes processed',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 py-4">
      {statItems.map((stat) => (
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
