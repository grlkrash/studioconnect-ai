import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, Phone, Mail, Calendar, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import ClientTable from "./client-table"

export default async function ClientsPage() {
  const business = await prisma.business.findFirst({ select: { id: true } })

  if (!business) return <div className="p-6">No business records found.</div>

  const [clientsTotal, clientsNewWeek, leadsQualified] = await Promise.all([
    prisma.client.count({ where: { businessId: business.id } }),
    prisma.client.count({
      where: { businessId: business.id, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.lead.count({ where: { businessId: business.id, status: "QUALIFIED" } }),
  ])

  const clients = await prisma.client.findMany({
    where: { businessId: business.id },
    include: { projects: true },
    orderBy: { createdAt: "desc" },
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Clients</p>
                  <p className="text-2xl font-bold text-slate-900">{clientsTotal}</p>
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
                  <p className="text-2xl font-bold text-slate-900">{clientsNewWeek}</p>
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
                  <p className="text-2xl font-bold text-slate-900">{leadsQualified}</p>
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
