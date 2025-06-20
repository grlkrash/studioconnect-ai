"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Settings,
  MessageSquare,
  BookOpen,
  Users,
  Bell,
  FolderOpen,
  Plug,
  ArrowRight,
  CheckCircle,
  AlertCircle,
} from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"

interface DashboardData {
  clientsTotal: number
  leadsTotal: number
  knowledgeCount: number
  questionsCount: number
  agentConfigured: boolean
  notificationEmailsCount: number
  hasSms: boolean
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "configured":
    case "synced":
    case "active":
      return <CheckCircle className="w-4 h-4 text-green-600" />
    case "needs-attention":
    case "partial":
      return <AlertCircle className="w-4 h-4 text-yellow-600" />
    default:
      return <AlertCircle className="w-4 h-4 text-gray-400" />
  }
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case "configured":
      return (
        <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">
          Configured
        </Badge>
      )
    case "synced":
      return (
        <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
          Synced
        </Badge>
      )
    case "active":
      return (
        <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200">
          Active
        </Badge>
      )
    case "needs-attention":
      return (
        <Badge variant="secondary" className="bg-yellow-50 text-yellow-700 border-yellow-200">
          Needs Attention
        </Badge>
      )
    case "partial":
      return (
        <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">
          Partial
        </Badge>
      )
    default:
      return <Badge variant="outline">Unknown</Badge>
  }
}

export function DashboardCards() {
  const [data, setData] = useState<DashboardData>({
    clientsTotal: 0,
    leadsTotal: 0,
    knowledgeCount: 0,
    questionsCount: 0,
    agentConfigured: false,
    notificationEmailsCount: 0,
    hasSms: false
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const response = await fetch('/api/dashboard-status', { credentials: 'include' })
        if (response.ok) {
          const status = await response.json()
          setData({
            clientsTotal: status.clientsTotal || 0,
            leadsTotal: status.leadsTotal || 0,
            knowledgeCount: status.knowledgeCount || 0,
            questionsCount: status.questionsCount || 0,
            agentConfigured: status.voiceAgent?.configured || false,
            notificationEmailsCount: status.notificationEmailsCount || 0,
            hasSms: status.hasSms || false
          })
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  const dashboardCards = [
    {
      title: "Agent Settings",
      description: "Fine-tune your AI agent's persona and voice.",
      icon: Settings,
      href: "/agent-settings",
      status: data.agentConfigured ? "configured" : "needs-attention",
      color: "from-blue-500 to-blue-600",
      stats: loading ? "Loading..." : (data.agentConfigured ? "Voice configured" : "Not configured"),
    },
    {
      title: "Client Intake Questions",
      description: "Edit the lead-capture flow.",
      icon: MessageSquare,
      href: "/intake-questions",
      status: data.questionsCount > 0 ? "configured" : "needs-attention",
      color: "from-red-500 to-red-600",
      stats: loading ? "Loading..." : `${data.questionsCount} question${data.questionsCount === 1 ? "" : "s"} configured`,
    },
    {
      title: "Knowledge Base",
      description: "Manage canned answers & FAQs.",
      icon: BookOpen,
      href: "/knowledge-base",
      status: data.knowledgeCount > 0 ? "configured" : "needs-attention",
      color: "from-green-500 to-green-600",
      stats: loading ? "Loading..." : (data.knowledgeCount === 0 ? "No articles yet" : `${data.knowledgeCount} articles`),
    },
    {
      title: "Clients & Requests",
      description: "All captured clients at a glance.",
      icon: Users,
      href: "/clients",
      status: data.clientsTotal > 0 ? "active" : "needs-attention",
      color: "from-purple-500 to-purple-600",
      stats: loading ? "Loading..." : `${data.clientsTotal} clients • ${data.leadsTotal} requests`,
    },
    {
      title: "Notification Settings",
      description: "Emails, SMS & Slack alerts.",
      icon: Bell,
      href: "/notifications",
      status: data.notificationEmailsCount > 0 || data.hasSms ? "configured" : "needs-attention",
      color: "from-yellow-500 to-yellow-600",
      stats: loading ? "Loading..." : (
        data.notificationEmailsCount > 0
          ? `${data.notificationEmailsCount} email${data.notificationEmailsCount === 1 ? '' : 's'}${data.hasSms ? ' • SMS enabled' : ''}`
          : data.hasSms
            ? 'SMS enabled'
            : 'No channels configured'
      ),
    },
    {
      title: "Integrations",
      description: "Connect PM & messaging tools.",
      icon: Plug,
      href: "/integrations",
      status: "partial",
      color: "from-teal-500 to-teal-600",
      stats: "Manage integrations",
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {dashboardCards.map((card) => (
        <Card
          key={card.title}
          className="group hover:shadow-lg transition-all duration-200 border-0 shadow-sm bg-white/60 backdrop-blur-sm hover:bg-white/80"
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className={`p-3 rounded-xl bg-gradient-to-br ${card.color} shadow-sm`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex items-center space-x-2">
                {getStatusIcon(card.status)}
                {getStatusBadge(card.status)}
              </div>
            </div>
            <div className="mt-4">
              <CardTitle className="text-lg font-semibold text-slate-900">{card.title}</CardTitle>
              <CardDescription className="text-slate-600 mt-1">{card.description}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{card.stats}</p>
              <Button variant="ghost" size="sm" asChild className="group-hover:bg-slate-100">
                <Link href={card.href} className="flex items-center">
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
