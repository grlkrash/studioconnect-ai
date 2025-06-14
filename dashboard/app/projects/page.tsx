"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FolderOpen, Search, Filter, Calendar, Users, RefreshCw, ExternalLink } from "lucide-react"

const projects = [
  {
    id: 1,
    name: "TechStart Website Redesign",
    client: "TechStart Inc.",
    status: "in-progress",
    progress: 65,
    dueDate: "2024-02-15",
    team: ["John D.", "Sarah M."],
    pmTool: "Asana",
    lastSync: "1 hour ago",
    tasks: { total: 24, completed: 16 },
  },
  {
    id: 2,
    name: "Green Energy Brand Identity",
    client: "Green Energy Co.",
    status: "review",
    progress: 90,
    dueDate: "2024-01-30",
    team: ["Emily R.", "Mike C."],
    pmTool: "Asana",
    lastSync: "30 minutes ago",
    tasks: { total: 18, completed: 16 },
  },
  {
    id: 3,
    name: "Fashion Forward E-commerce",
    client: "Fashion Forward",
    status: "planning",
    progress: 25,
    dueDate: "2024-03-20",
    team: ["David K.", "Lisa T."],
    pmTool: "Asana",
    lastSync: "2 hours ago",
    tasks: { total: 32, completed: 8 },
  },
  {
    id: 4,
    name: "Local Restaurant Menu Design",
    client: "Local Restaurant",
    status: "completed",
    progress: 100,
    dueDate: "2024-01-20",
    team: ["Anna S."],
    pmTool: "Asana",
    lastSync: "1 day ago",
    tasks: { total: 12, completed: 12 },
  },
  {
    id: 5,
    name: "Wellness Studio Complete Rebrand",
    client: "Wellness Studio",
    status: "in-progress",
    progress: 45,
    dueDate: "2024-04-10",
    team: ["Tom W.", "Sarah M.", "Mike C."],
    pmTool: "Asana",
    lastSync: "45 minutes ago",
    tasks: { total: 28, completed: 13 },
  },
]

const getStatusBadge = (status: string) => {
  const statusConfig = {
    planning: { label: "Planning", className: "bg-blue-50 text-blue-700 border-blue-200" },
    "in-progress": { label: "In Progress", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
    review: { label: "Review", className: "bg-purple-50 text-purple-700 border-purple-200" },
    completed: { label: "Completed", className: "bg-green-50 text-green-700 border-green-200" },
    "on-hold": { label: "On Hold", className: "bg-red-50 text-red-700 border-red-200" },
  }

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.planning
  return (
    <Badge variant="secondary" className={config.className}>
      {config.label}
    </Badge>
  )
}

export default function ProjectsPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const filteredProjects = projects.filter((project) => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.client.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || project.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg">
              <FolderOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
              <p className="text-slate-600">View and manage all projects synced from your PM tool</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync Now
            </Button>
            <Button>
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Asana
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Projects</p>
                  <p className="text-2xl font-bold text-slate-900">23</p>
                </div>
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <FolderOpen className="w-5 h-5 text-indigo-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">In Progress</p>
                  <p className="text-2xl font-bold text-slate-900">12</p>
                </div>
                <div className="p-2 bg-yellow-50 rounded-lg">
                  <Calendar className="w-5 h-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Completed</p>
                  <p className="text-2xl font-bold text-slate-900">8</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <Users className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Last Sync</p>
                  <p className="text-2xl font-bold text-slate-900">1h</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <CardTitle>Project List</CardTitle>
                <CardDescription>All projects synced from Asana</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    placeholder="Search projects..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="on-hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <Card key={project.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <CardDescription>{project.client}</CardDescription>
                  </div>
                  {getStatusBadge(project.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Progress</span>
                    <span className="font-medium">{project.progress}%</span>
                  </div>
                  <Progress value={project.progress} className="h-2" />
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Due Date</span>
                    <span className="font-medium">{project.dueDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tasks</span>
                    <span className="font-medium">
                      {project.tasks.completed}/{project.tasks.total}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Team</span>
                    <span className="font-medium">{project.team.length} members</span>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Synced from {project.pmTool}</span>
                    <span>{project.lastSync}</span>
                  </div>
                </div>

                <Button variant="outline" className="w-full">
                  View Details
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
