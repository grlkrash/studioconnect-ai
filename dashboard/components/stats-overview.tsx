import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Users, MessageSquare, TrendingUp } from "lucide-react"

const stats = [
  {
    title: "Pipeline Value",
    value: "$847K",
    change: "+23%",
    icon: TrendingUp,
    color: "text-green-600",
    bgColor: "bg-green-50",
    subtitle: "From AI-captured clients",
  },
  {
    title: "Time Saved",
    value: "127hrs",
    change: "+15%",
    icon: Users,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    subtitle: "Team productivity this month",
  },
  {
    title: "Team Utilization",
    value: "94%",
    change: "+18%",
    icon: Phone,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    subtitle: "Optimal resource allocation",
  },
  {
    title: "Avg Project Value",
    value: "$28.5K",
    change: "+12%",
    icon: MessageSquare,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    subtitle: "From AI-qualified clients",
  },
]

export function StatsOverview() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <Card key={stat.title} className="border-0 shadow-sm bg-white/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">{stat.title}</CardTitle>
            <div className={`p-2 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <p className="text-xs text-green-600 font-medium">{stat.change} from last month</p>
            <p className="text-xs text-slate-500 mt-1">{stat.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
