"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plug, CheckCircle, AlertCircle, Settings, ExternalLink } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"

// --- Static meta for each provider – merge with live backend status ---
const PROVIDERS_META = {
  ASANA: {
    name: "Asana",
    description: "Project management and task tracking",
    category: "Project Management",
    icon: "🎯",
    features: ["Project sync", "Task updates", "Team collaboration"],
  },
  MONDAY: {
    name: "Monday.com",
    description: "Visual project management boards",
    category: "Project Management",
    icon: "📋",
    features: ["Board sync", "Item updates", "Team collaboration"],
  },
  JIRA: {
    name: "Jira Cloud",
    description: "Issue tracking and agile project management",
    category: "Project Management",
    icon: "🔧",
    features: ["Issue tracking", "Sprint management", "Workflow automation"],
  },
} as const

type ProviderKey = keyof typeof PROVIDERS_META

interface IntegrationRecord {
  provider: ProviderKey
  syncStatus: "CONNECTED" | "ERROR" | "DISCONNECTED" | "PENDING"
  isEnabled: boolean
  updatedAt?: string
}

interface UiIntegration {
  id: number
  provider: ProviderKey
  name: string
  description: string
  category: string
  icon: string
  features: string[]
  status: "connected" | "pending" | "available"
  lastSync: string
  isEnabled: boolean
  error?: boolean
}

const getStatusBadge = (status: string) => {
  const statusConfig = {
    connected: { label: "Connected", className: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle },
    pending: { label: "Pending", className: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: AlertCircle },
    available: { label: "Available", className: "bg-slate-50 text-slate-700 border-slate-200", icon: Plug },
  }

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.available
  const IconComponent = config.icon

  return (
    <Badge variant="secondary" className={config.className}>
      <IconComponent className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  )
}

export default function IntegrationsPage() {
  const { toast } = useToast()
  const router = useRouter()

  const [integrations, setIntegrations] = useState<UiIntegration[]>([])
  const [loading, setLoading] = useState(true)

  // No additional state needed for OAuth flows

  const handleConnectAsanaOAuth = () => {
    window.location.href = "/api/integrations/asana/oauth-start"
  }

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/integrations")
      const json = await res.json()
      const records: IntegrationRecord[] = json.integrations || []

      // Build UI list for all supported providers
      const ui: UiIntegration[] = (Object.keys(PROVIDERS_META) as ProviderKey[]).map((key, idx) => {
        const rec = records.find(r => r.provider === key)
        const meta = PROVIDERS_META[key]

        let status: UiIntegration["status"] = "available"
        let lastSync = "Not connected"
        let isEnabled = false
        let error = false

        if (rec) {
          if (rec.syncStatus === "CONNECTED") status = "connected"
          else if (rec.syncStatus === "ERROR") { status = "pending"; error = true }
          else status = "pending"

          lastSync = rec.updatedAt ? new Date(rec.updatedAt).toLocaleString() : "Unknown"
          isEnabled = rec.isEnabled
        }

        return {
          id: idx + 1,
          provider: key,
          name: meta.name,
          description: meta.description,
          category: meta.category,
          icon: meta.icon,
          features: meta.features,
          status,
          lastSync,
          isEnabled,
          error,
        }
      })

      setIntegrations(ui)
    } catch (err) {
      console.error("[Integrations] Failed to fetch:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIntegrations()
  }, [fetchIntegrations])

  // Helpers
  const handleConnectMondayOAuth = () => {
    window.location.href = '/api/integrations/monday/oauth-start'
  }

  const handleConnectJiraOAuth = () => {
    window.location.href = '/api/integrations/jira/oauth-start'
  }

  const handleDisconnect = async (prov: ProviderKey) => {
    try {
      const res = await fetch(`/api/integrations/${prov.toLowerCase()}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
      toast({ title: `${PROVIDERS_META[prov].name} disconnected` })
      fetchIntegrations()
    } catch (err: any) {
      toast({ title: `Failed to disconnect ${PROVIDERS_META[prov].name}`, description: err.message, variant: "destructive" })
    }
  }

  const connectedIntegrations = integrations.filter((i) => i.status === "connected").length
  const pendingIntegrations = integrations.filter((i) => i.status === "pending").length

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-teal-500 to-teal-600 rounded-lg">
              <Plug className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
              <p className="text-slate-600">Connect your project management and messaging tools</p>
            </div>
          </div>
          <Button variant="outline">
            <ExternalLink className="w-4 h-4 mr-2" />
            Browse More
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Connected</p>
                  <p className="text-2xl font-bold text-slate-900">{connectedIntegrations}</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Pending</p>
                  <p className="text-2xl font-bold text-slate-900">{pendingIntegrations}</p>
                </div>
                <div className="p-2 bg-yellow-50 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Available</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {integrations.length - connectedIntegrations - pendingIntegrations}
                  </p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Plug className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Integrations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((integration) => (
            <Card key={integration.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="text-2xl">{integration.icon}</div>
                    <div>
                      <CardTitle className="text-lg">{integration.name}</CardTitle>
                      <CardDescription className="text-sm">{integration.category}</CardDescription>
                    </div>
                  </div>
                  {getStatusBadge(integration.status)}
                </div>
                <p className="text-sm text-slate-600 mt-2">{integration.description}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-slate-900">Features</h4>
                  <ul className="text-xs text-slate-600 space-y-1">
                    {integration.features.map((feature, index) => (
                      <li key={index} className="flex items-center">
                        <div className="w-1 h-1 bg-slate-400 rounded-full mr-2"></div>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                {integration.status === "connected" && (
                  <div className="space-y-3 pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Enable notifications</span>
                      <Switch checked={integration.isEnabled} />
                    </div>
                    <div className="text-xs text-slate-500">Last sync: {integration.lastSync}</div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {integration.status === "connected" ? (
                    <>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1">
                            <Settings className="w-4 h-4 mr-1" />
                            Configure
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Configure {integration.name}</DialogTitle>
                            <DialogDescription>Manage your {integration.name} integration settings</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>API Token</Label>
                              <Input type="password" placeholder="••••••••••••••••" />
                            </div>
                            <div className="space-y-2">
                              <Label>Sync Frequency</Label>
                              <select className="w-full p-2 border border-slate-200 rounded-md">
                                <option>Every 15 minutes</option>
                                <option>Every 30 minutes</option>
                                <option>Every hour</option>
                                <option>Every 4 hours</option>
                              </select>
                            </div>
                            <div className="flex justify-end space-x-2">
                              <Button variant="outline">Test Connection</Button>
                              <Button>Save Changes</Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button variant="destructive" size="sm" onClick={() => handleDisconnect(integration.provider)}>
                        Disconnect
                      </Button>
                    </>
                  ) : integration.status === "pending" ? (
                    <>
                      {integration.provider === "MONDAY" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectMondayOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : integration.provider === "JIRA" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectJiraOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : integration.provider === "ASANA" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectAsanaOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    // AVAILABLE STATE
                    <>
                      {integration.provider === "MONDAY" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectMondayOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : integration.provider === "JIRA" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectJiraOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : integration.provider === "ASANA" ? (
                        <Button size="sm" className="w-full" onClick={handleConnectAsanaOAuth}>
                          Connect via OAuth
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Help Section */}
        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
            <CardDescription>
              Having trouble setting up integrations? Check out our documentation or contact support.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Button variant="outline">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Documentation
              </Button>
              <Button variant="outline">Contact Support</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
