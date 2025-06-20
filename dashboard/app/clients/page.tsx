"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, Phone, Mail, Calendar, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import ClientTable from "./client-table"

interface ClientData {
  id: string
  businessId: string
  name: string
  email: string | null
  phone: string | null
  externalId: string | null
  createdAt: Date
  updatedAt: Date
  projects: any[]
}

interface ClientStats {
  clientsTotal: number
  clientsNewWeek: number
  leadsQualified: number
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientData[]>([])
  const [stats, setStats] = useState<ClientStats>({ clientsTotal: 0, clientsNewWeek: 0, leadsQualified: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchClients() {
      try {
        const response = await fetch('/api/clients', { credentials: 'include' })
        if (!response.ok) {
          throw new Error('Failed to fetch clients')
        }
        const data = await response.json()
        const clientsWithDates = (data.clients || []).map((client: any) => ({
          ...client,
          createdAt: new Date(client.createdAt),
          updatedAt: new Date(client.updatedAt)
        }))
        setClients(clientsWithDates)
        setStats({
          clientsTotal: data.stats?.clientsTotal || 0,
          clientsNewWeek: data.stats?.clientsNewWeek || 0,
          leadsQualified: data.stats?.leadsQualified || 0
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load clients')
      } finally {
        setLoading(false)
      }
    }

    fetchClients()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">Loading clients...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <p className="text-red-600">Error: {error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Clients</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.clientsTotal}</p>
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
                  <p className="text-2xl font-bold text-slate-900">{stats.clientsNewWeek}</p>
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
                  <p className="text-sm text-slate-600">Qualified Leads</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.leadsQualified}</p>
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
                  <p className="text-2xl font-bold text-slate-900">–%</p>
                </div>
                <div className="p-2 bg-orange-50 rounded-lg">
                  <Mail className="w-5 h-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Client List */}
        <Card>
          <CardHeader>
            <CardTitle>Client List</CardTitle>
            <CardDescription>Manage your leads and client relationships</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientTable clients={clients} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
