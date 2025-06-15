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

import { getDashboardCounts } from "@/lib/dashboard-stats"

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

export async function DashboardCards() {
  const counts = await getDashboardCounts()

  const dashboardCards = [
    {
      title: "Agent Settings",
      description: "Fine-tune your AI agent's persona and voice.",
      icon: Settings,
      href: "/agent-settings",
      status: "configured",
      color: "from-blue-500 to-blue-600",
      stats: "Voice: Professional | English",
    },
    {
      title: "Client Intake Questions",
      description: "Edit the lead-capture flow.",
      icon: MessageSquare,
      href: "/intake-questions",
      status: "needs-attention",
      color: "from-red-500 to-red-600",
      stats: "7 questions configured",
    },
    {
      title: "Knowledge Base",
      description: "Manage canned answers & FAQs.",
      icon: BookOpen,
      href: "/knowledge-base",
      status: "configured",
      color: "from-green-500 to-green-600",
      stats: "24 articles | 2 days ago",
    },
    {
      title: "Clients & Requests",
      description: "All captured clients at a glance.",
      icon: Users,
      href: "/clients",
      status: "active",
      color: "from-purple-500 to-purple-600",
      stats: `${counts.clientsTotal} clients • ${counts.leadsTotal} requests`,
    },
    {
      title: "Notification Settings",
      description: "Emails, SMS & Slack alerts.",
      icon: Bell,
      href: "/notifications",
      status: "configured",
      color: "from-yellow-500 to-yellow-600",
      stats: "Email & SMS enabled",
    },
    {
      title: "Projects",
      description: "Synced from your PM tool.",
      icon: FolderOpen,
      href: "/projects",
      status: "synced",
      color: "from-indigo-500 to-indigo-600",
      stats: `${counts.projectsTotal} projects | ${counts.projectsActive} active`,
    },
    {
      title: "Integrations",
      description: "Connect PM & messaging tools.",
      icon: Plug,
      href: "/integrations",
      status: "partial",
      color: "from-teal-500 to-teal-600",
      stats: "Asana connected | Slack pending",
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
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold text-slate-900">{card.title}</CardTitle>
              <CardDescription className="text-slate-600 text-sm leading-relaxed">
                {card.description}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{card.stats}</div>
              <Button asChild className="w-full group-hover:bg-slate-900 transition-colors">
                <Link href={card.href} className="flex items-center justify-center">
                  Manage {card.title}
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
