"use client"

import { useState } from "react"
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

const integrations = [
  {
    id: 1,
    name: "Asana",
    description: "Project management and task tracking",
    category: "Project Management",
    status: "connected",
    icon: "🎯",
    features: ["Project sync", "Task updates", "Team collaboration"],
    lastSync: "1 hour ago",
    isEnabled: true,
  },
  {
    id: 2,
    name: "Slack",
    description: "Team communication and notifications",
    category: "Communication",
    status: "pending",
    icon: "💬",
    features: ["Real-time notifications", "Channel updates", "Direct messages"],
    lastSync: "Not connected",
    isEnabled: false,
  },
  {
    id: 3,
    name: "Trello",
    description: "Visual project management boards",
    category: "Project Management",
    status: "available",
    icon: "📋",
    features: ["Board sync", "Card updates", "List management"],
    lastSync: "Not connected",
    isEnabled: false,
  },
  {
    id: 4,
    name: "Microsoft Teams",
    description: "Enterprise communication platform",
    category: "Communication",
    status: "available",
    icon: "🏢",
    features: ["Team notifications", "Meeting integration", "File sharing"],
    lastSync: "Not connected",
    isEnabled: false,
  },
  {
    id: 5,
    name: "Jira",
    description: "Issue tracking and project management",
    category: "Project Management",
    status: "available",
    icon: "🔧",
    features: ["Issue tracking", "Sprint management", "Workflow automation"],
    lastSync: "Not connected",
    isEnabled: false,
  },
  {
    id: 6,
    name: "Discord",
    description: "Community and team communication",
    category: "Communication",
    status: "available",
    icon: "🎮",
    features: ["Server notifications", "Voice channels", "Bot integration"],
    lastSync: "Not connected",
    isEnabled: false,
  },
]

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
  const [selectedIntegration, setSelectedIntegration] = useState<any>(null)
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false)

  const handleConnect = (integration: any) => {
    toast({
      title: `Connecting to ${integration.name}`,
      description: "You will be redirected to authorize the connection.",
    })
  }

  const handleDisconnect = (integration: any) => {
    toast({
      title: `Disconnected from ${integration.name}`,
      description: "The integration has been successfully disconnected.",
    })
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
                      <Button variant="destructive" size="sm" onClick={() => handleDisconnect(integration)}>
                        Disconnect
                      </Button>
                    </>
                  ) : integration.status === "pending" ? (
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      Authorization Pending
                    </Button>
                  ) : (
                    <Button size="sm" className="w-full" onClick={() => handleConnect(integration)}>
                      Connect
                    </Button>
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
