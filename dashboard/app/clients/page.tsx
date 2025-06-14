"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Users, Search, Filter, Phone, Mail, Calendar, MoreHorizontal, Download } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const clients = [
  {
    id: 1,
    name: "Sarah Johnson",
    company: "TechStart Inc.",
    phone: "+1 (555) 123-4567",
    email: "sarah@techstart.com",
    status: "new",
    lastContact: "2024-01-15",
    source: "phone",
    project: "Website Redesign",
    value: "$15,000",
  },
  {
    id: 2,
    name: "Michael Chen",
    company: "Green Energy Co.",
    phone: "+1 (555) 234-5678",
    email: "m.chen@greenenergy.com",
    status: "qualified",
    lastContact: "2024-01-14",
    source: "phone",
    project: "Brand Identity",
    value: "$25,000",
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    company: "Fashion Forward",
    phone: "+1 (555) 345-6789",
    email: "emily@fashionforward.com",
    status: "contacted",
    lastContact: "2024-01-13",
    source: "phone",
    project: "E-commerce Platform",
    value: "$35,000",
  },
  {
    id: 4,
    name: "David Kim",
    company: "Local Restaurant",
    phone: "+1 (555) 456-7890",
    email: "david@localrest.com",
    status: "proposal",
    lastContact: "2024-01-12",
    source: "phone",
    project: "Menu Design",
    value: "$5,000",
  },
  {
    id: 5,
    name: "Lisa Thompson",
    company: "Wellness Studio",
    phone: "+1 (555) 567-8901",
    email: "lisa@wellness.com",
    status: "won",
    lastContact: "2024-01-11",
    source: "phone",
    project: "Complete Rebrand",
    value: "$45,000",
  },
]

const getStatusBadge = (status: string) => {
  const statusConfig = {
    new: { label: "New", className: "bg-blue-50 text-blue-700 border-blue-200" },
    qualified: { label: "Qualified", className: "bg-purple-50 text-purple-700 border-purple-200" },
    contacted: { label: "Contacted", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
    proposal: { label: "Proposal", className: "bg-orange-50 text-orange-700 border-orange-200" },
    won: { label: "Won", className: "bg-green-50 text-green-700 border-green-200" },
    lost: { label: "Lost", className: "bg-red-50 text-red-700 border-red-200" },
  }

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.new
  return (
    <Badge variant="secondary" className={config.className}>
      {config.label}
    </Badge>
  )
}

export default function ClientsPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || client.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Clients & Requests</h1>
              <p className="text-slate-600">View and manage all clients captured by your AI agent</p>
            </div>
          </div>
          <Button>
            <Download className="w-4 h-4 mr-2" />
            Export Data
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Clients</p>
                  <p className="text-2xl font-bold text-slate-900">156</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">New This Week</p>
                  <p className="text-2xl font-bold text-slate-900">8</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <Phone className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Qualified Clients</p>
                  <p className="text-2xl font-bold text-slate-900">23</p>
                </div>
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Calendar className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Conversion Rate</p>
                  <p className="text-2xl font-bold text-slate-900">17%</p>
                </div>
                <div className="p-2 bg-orange-50 rounded-lg">
                  <Mail className="w-5 h-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <CardTitle>Client List</CardTitle>
                <CardDescription>Manage your leads and client relationships</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    placeholder="Search clients..."
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
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Last Contact</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-slate-900">{client.name}</div>
                          <div className="text-sm text-slate-500">{client.company}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center text-sm text-slate-600">
                            <Phone className="w-3 h-3 mr-1" />
                            {client.phone}
                          </div>
                          <div className="flex items-center text-sm text-slate-600">
                            <Mail className="w-3 h-3 mr-1" />
                            {client.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{client.project}</div>
                      </TableCell>
                      <TableCell>{getStatusBadge(client.status)}</TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{client.value}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-slate-600">{client.lastContact}</div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>View Details</DropdownMenuItem>
                            <DropdownMenuItem>Send Email</DropdownMenuItem>
                            <DropdownMenuItem>Schedule Call</DropdownMenuItem>
                            <DropdownMenuItem>Update Status</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
