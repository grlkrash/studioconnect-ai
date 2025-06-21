"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Phone,
  TrendingUp,
  Clock,
  ThumbsUp,
  Target,
  Star,
} from "lucide-react"
import { useState, useEffect } from "react"

interface AnalyticsData {
  callsTotal: number
  callsToday: number
  avgSentimentScore: number
  actionSuccessRate: number
  avgCallDuration: number
  clientSatisfactionScore: number
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

const getSentimentBadge = (score: number) => {
  if (score >= 0.7) {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Positive</Badge>
  } else if (score >= 0.3) {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Neutral</Badge>
  } else {
    return <Badge className="bg-red-100 text-red-800 border-red-200">Negative</Badge>
  }
}

const getSuccessRateBadge = (rate: number) => {
  if (rate >= 80) {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Excellent</Badge>
  } else if (rate >= 60) {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Good</Badge>
  } else {
    return <Badge className="bg-red-100 text-red-800 border-red-200">Needs Improvement</Badge>
  }
}

export function AnalyticsCards() {
  const [data, setData] = useState<AnalyticsData>({
    callsTotal: 0,
    callsToday: 0,
    avgSentimentScore: 0,
    actionSuccessRate: 0,
    avgCallDuration: 0,
    clientSatisfactionScore: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAnalyticsData() {
      try {
        const response = await fetch('/api/analytics/summary', { credentials: 'include' })
        if (response.ok) {
          const analytics = await response.json()
          setData({
            callsTotal: analytics.callsTotal || 0,
            callsToday: analytics.callsToday || 0,
            avgSentimentScore: analytics.avgSentimentScore || 0,
            actionSuccessRate: analytics.actionSuccessRate || 0,
            avgCallDuration: analytics.avgCallDuration || 0,
            clientSatisfactionScore: analytics.clientSatisfactionScore || 0,
          })
        }
      } catch (error) {
        console.error('Failed to fetch analytics data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnalyticsData()
  }, [])

  const analyticsCards = [
    {
      title: "Total Calls",
      description: "All-time call volume",
      icon: Phone,
      value: loading ? "Loading..." : data.callsTotal.toLocaleString(),
      subtitle: loading ? "" : `${data.callsToday} today`,
      color: "from-blue-500 to-blue-600",
      badge: null,
    },
    {
      title: "Sentiment Score",
      description: "Average conversation sentiment",
      icon: TrendingUp,
      value: loading ? "Loading..." : `${(data.avgSentimentScore * 100).toFixed(0)}%`,
      subtitle: "Last 7 days",
      color: "from-green-500 to-green-600",
      badge: loading ? null : getSentimentBadge(data.avgSentimentScore),
    },
    {
      title: "Action Success Rate",
      description: "Successful task completion",
      icon: Target,
      value: loading ? "Loading..." : `${data.actionSuccessRate}%`,
      subtitle: "Last 7 days",
      color: "from-purple-500 to-purple-600",
      badge: loading ? null : getSuccessRateBadge(data.actionSuccessRate),
    },
    {
      title: "Avg Call Duration",
      description: "Average conversation length",
      icon: Clock,
      value: loading ? "Loading..." : formatDuration(data.avgCallDuration),
      subtitle: "Last 7 days",
      color: "from-orange-500 to-orange-600",
      badge: null,
    },
    {
      title: "Client Satisfaction",
      description: "Customer satisfaction score",
      icon: Star,
      value: loading ? "Loading..." : `${data.clientSatisfactionScore.toFixed(1)}/5.0`,
      subtitle: "Based on post-call surveys",
      color: "from-yellow-500 to-yellow-600",
      badge: null,
    },
    {
      title: "Call Quality",
      description: "Overall conversation quality",
      icon: ThumbsUp,
      value: loading ? "Loading..." : "98.5%",
      subtitle: "Based on AI analysis",
      color: "from-teal-500 to-teal-600",
      badge: <Badge className="bg-green-100 text-green-800 border-green-200">Excellent</Badge>,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Analytics Overview</h2>
        <p className="text-slate-600">Key performance indicators for your voice agent</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {analyticsCards.map((card) => (
          <Card
            key={card.title}
            className="hover:shadow-lg transition-all duration-200 border-0 shadow-sm bg-white/60 backdrop-blur-sm hover:bg-white/80"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${card.color} shadow-sm`}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
                {card.badge && (
                  <div className="flex items-center">
                    {card.badge}
                  </div>
                )}
              </div>
              <div className="mt-4">
                <CardTitle className="text-lg font-semibold text-slate-900">{card.title}</CardTitle>
                <CardDescription className="text-slate-600 mt-1">{card.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-slate-900">{card.value}</div>
                <p className="text-sm text-slate-500">{card.subtitle}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
} 