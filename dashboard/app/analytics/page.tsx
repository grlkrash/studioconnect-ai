"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart3, TrendingUp, DollarSign, Clock, Users, Download, Calendar } from "lucide-react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { Input } from "@/components/ui/input"
import { useState, useEffect } from "react"

const efficiencyMetrics = [
  { metric: "Client Response Time", current: "2.3 min", previous: "45 min", improvement: 95 },
  { metric: "Qualification Accuracy", current: "87%", previous: "62%", improvement: 40 },
  { metric: "Team Utilization", current: "94%", previous: "76%", improvement: 24 },
  { metric: "Team Interruptions", current: "12/day", previous: "47/day", improvement: 74 },
]

export default function AnalyticsPage() {
  /* ROI calculator state */
  const [laborSavings, setLaborSavings] = useState<number | "">("")
  const [additionalRevenue, setAdditionalRevenue] = useState<number | "">("")
  const [pipelineIncrease, setPipelineIncrease] = useState<number | "">("")
  const [responseReduction, setResponseReduction] = useState<number | "">("")
  const [utilizationGain, setUtilizationGain] = useState<number | "">("")

  // Live data states
  const [revenueData, setRevenueData] = useState<any[]>([])
  const [callVolumeData, setCallVolumeData] = useState<any[]>([])
  const [projectTypeData, setProjectTypeData] = useState<any[]>([])

  const numeric = (v: number | "") => (typeof v === "number" && !isNaN(v) ? v : 0)
  const totalROI =
    numeric(laborSavings) +
    numeric(additionalRevenue) +
    numeric(pipelineIncrease) +
    numeric(responseReduction) +
    numeric(utilizationGain)

  // Fetch summary on mount
  useEffect(() => {
    ;(async () => {
      try {
        const sumRes = await fetch(`/api/analytics/summary${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`)
        if (sumRes.ok) {
          const sum = await sumRes.json()
          setRevenueData(sum.revenueData)
          setCallVolumeData(sum.callVolumeData)
          setProjectTypeData(sum.projectTypeData)
        }

        const res = await fetch(`/api/dashboard-status${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`)
        if (!res.ok) return
        const data = await res.json()
        // crude estimate: labor cost saved = callsToday * avgDuration (sec) * $1 per second (placeholder)
        const durationSec = parseInt((data.avgDuration || "0s").replace(/s$/, ""), 10) || 0
        const calls = data.callsToday ?? 0
        const estLabor = Math.round((calls * durationSec) / 60 * 25) // $25/hr salary
        setLaborSavings(estLabor)
      } catch {}
    })()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Analytics Dashboard</h1>
              <p className="text-slate-600">Track your AI agent's impact on business growth and efficiency</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Select defaultValue="30days">
              <SelectTrigger className="w-32">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 days</SelectItem>
                <SelectItem value="30days">Last 30 days</SelectItem>
                <SelectItem value="90days">Last 90 days</SelectItem>
                <SelectItem value="1year">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={()=>{window.location.href=`/api/analytics/report${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`}}>
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Key Performance Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Revenue Impact</CardTitle>
              <DollarSign className="w-4 h-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">$847K</div>
              <p className="text-xs text-green-600 font-medium">+23% from AI-captured clients</p>
              <div className="mt-2">
                <Progress value={68} className="h-2" />
                <p className="text-xs text-slate-500 mt-1">68% of total pipeline</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Conversion Rate</CardTitle>
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">34.2%</div>
              <p className="text-xs text-blue-600 font-medium">+8.5% vs traditional methods</p>
              <div className="mt-2">
                <Progress value={34} className="h-2" />
                <p className="text-xs text-slate-500 mt-1">Industry avg: 18%</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Time Saved</CardTitle>
              <Clock className="w-4 h-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">127hrs</div>
              <p className="text-xs text-purple-600 font-medium">This month</p>
              <div className="mt-2">
                <p className="text-xs text-slate-500">$12,700 in saved labor costs</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Client Satisfaction</CardTitle>
              <Users className="w-4 h-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">4.8/5</div>
              <p className="text-xs text-orange-600 font-medium">+0.3 improvement</p>
              <div className="mt-2">
                <Progress value={96} className="h-2" />
                <p className="text-xs text-slate-500 mt-1">96% would recommend</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Revenue Impact Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Impact Over Time</CardTitle>
            <CardDescription>Comparing AI-generated clients vs traditional client sources</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                aiClients: {
                  label: "AI Clients",
                  color: "hsl(var(--chart-1))",
                },
                traditionalClients: {
                  label: "Traditional Clients",
                  color: "hsl(var(--chart-2))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="aiClients" fill="var(--color-aiClients)" name="AI Clients" />
                  <Bar dataKey="traditionalClients" fill="var(--color-traditionalClients)" name="Traditional Clients" />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Call Volume Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Call Pattern</CardTitle>
              <CardDescription>Call volume and qualification rates by hour</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  calls: {
                    label: "Total Calls",
                    color: "hsl(var(--chart-1))",
                  },
                  qualified: {
                    label: "Qualified Clients",
                    color: "hsl(var(--chart-2))",
                  },
                }}
                className="h-[250px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={callVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="calls" stroke="var(--color-calls)" name="Total Calls" />
                    <Line
                      type="monotone"
                      dataKey="qualified"
                      stroke="var(--color-qualified)"
                      name="Qualified Clients"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Project Type Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Project Type Distribution</CardTitle>
              <CardDescription>Types of projects from AI-captured clients</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={projectTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {projectTypeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <ChartTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {projectTypeData.map((item, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-sm text-slate-600">{item.name}</span>
                    <span className="text-sm font-medium">{item.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Efficiency Improvements */}
        <Card>
          <CardHeader>
            <CardTitle>Operational Efficiency Gains</CardTitle>
            <CardDescription>Key improvements since implementing StudioConnect AI</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {efficiencyMetrics.map((metric, index) => (
                <div key={index} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-900">{metric.metric}</h3>
                    <Badge className="bg-green-50 text-green-700 border-green-200">+{metric.improvement}%</Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Current</span>
                      <span className="font-medium text-green-600">{metric.current}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Previous</span>
                      <span className="text-slate-500">{metric.previous}</span>
                    </div>
                  </div>
                  <Progress value={metric.improvement} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ROI Calculator */}
        <Card>
          <CardHeader>
            <CardTitle>ROI Calculator</CardTitle>
            <CardDescription>Estimate financial impact based on your own numbers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <h3 className="font-medium text-slate-900">Saved Labor Costs ($)</h3>
                <Input
                  type="number"
                  placeholder="e.g. 12700"
                  value={laborSavings}
                  onChange={(e) => setLaborSavings(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium text-slate-900">Additional Revenue ($)</h3>
                <Input
                  type="number"
                  placeholder="e.g. 15750"
                  value={additionalRevenue}
                  onChange={(e) => setAdditionalRevenue(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium text-slate-900">Pipeline Value Increase ($)</h3>
                <Input
                  type="number"
                  placeholder="e.g. 25000"
                  value={pipelineIncrease}
                  onChange={(e) => setPipelineIncrease(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium text-slate-900">Value of Faster Response ($)</h3>
                <Input
                  type="number"
                  placeholder="e.g. 5000"
                  value={responseReduction}
                  onChange={(e) => setResponseReduction(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium text-slate-900">Utilization Gain ($)</h3>
                <Input
                  type="number"
                  placeholder="e.g. 8000"
                  value={utilizationGain}
                  onChange={(e) => setUtilizationGain(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2 flex flex-col justify-end">
                <h3 className="font-medium text-slate-900">Estimated Total Benefit</h3>
                <p className="text-3xl font-bold text-green-600">${totalROI.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
