"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Bell, Mail, MessageSquare, Phone, Slack, TestTube } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { parsePhoneNumberFromString } from "libphonenumber-js"

const notificationChannels = [
  {
    id: "email",
    name: "Email",
    icon: Mail,
    description: "Receive notifications via email",
    enabled: true,
    settings: {
      address: "admin@aurorabranding.com",
      frequency: "immediate",
    },
  },
  {
    id: "sms",
    name: "SMS",
    icon: MessageSquare,
    description: "Get text message alerts",
    enabled: true,
    settings: {
      phone: "+1 (555) 123-4567",
      frequency: "immediate",
    },
  },
  {
    id: "slack",
    name: "Slack",
    icon: Slack,
    description: "Send notifications to Slack channel",
    enabled: false,
    settings: {
      channel: "#leads",
      frequency: "immediate",
    },
  },
  {
    id: "webhook",
    name: "Webhook",
    icon: Phone,
    description: "Send data to custom endpoint",
    enabled: false,
    settings: {
      url: "",
      frequency: "immediate",
    },
  },
]

const notificationTypes = [
  {
    id: "new_client",
    name: "New Client Captured",
    description: "When a new client completes the intake process",
    enabled: true,
    channels: ["email", "sms"],
  },
  {
    id: "call_completed",
    name: "Call Completed",
    description: "When any call is finished",
    enabled: false,
    channels: ["email"],
  },
  {
    id: "system_error",
    name: "System Error",
    description: "When there's a technical issue",
    enabled: true,
    channels: ["email", "sms"],
  },
  {
    id: "daily_summary",
    name: "Daily Summary",
    description: "Daily report of all activity",
    enabled: true,
    channels: ["email"],
  },
]

export default function NotificationsPage() {
  const { toast } = useToast()
  const [channels, setChannels] = useState(notificationChannels)
  const [types, setTypes] = useState(notificationTypes)

  // --- NEW: multiple email addresses ---
  const [emailInput, setEmailInput] = useState("")
  const [emails, setEmails] = useState<string[]>([])
  const [phoneNumber, setPhoneNumber] = useState<string>("")
  const [phoneError, setPhoneError] = useState<string | null>(null)

  // Fetch existing emails on mount
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/business/notification-emails", {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.notificationEmails)) setEmails(data.notificationEmails)
        }
      } catch (err) {
        console.error("Failed to load notification emails", err)
      }
    })()

    ;(async () => {
      try {
        const res = await fetch("/api/business/notification-phone", { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          if (data.notificationPhoneNumber) setPhoneNumber(data.notificationPhoneNumber)
        }
      } catch (err) {
        console.error("Failed to load notification phone", err)
      }
    })()
  }, [])

  const handleChannelToggle = (channelId: string) => {
    setChannels(
      channels.map((channel) => (channel.id === channelId ? { ...channel, enabled: !channel.enabled } : channel)),
    )
    toast({
      title: "Settings updated",
      description: "Notification channel settings have been saved.",
    })
  }

  const handleTypeToggle = (typeId: string) => {
    setTypes(types.map((type) => (type.id === typeId ? { ...type, enabled: !type.enabled } : type)))
    toast({
      title: "Settings updated",
      description: "Notification type settings have been saved.",
    })
  }

  const handleTestNotification = () => {
    toast({
      title: "Test notification sent",
      description: "Check your configured channels for the test message.",
    })
  }

  const handleAddEmail = () => {
    const trimmed = emailInput.trim()
    if (!trimmed) return
    if (emails.includes(trimmed)) return
    setEmails([...emails, trimmed])
    setEmailInput("")
  }

  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email))
  }

  const handleSaveEmails = async () => {
    try {
      const res = await fetch("/api/business/notification-emails", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      })
      if (res.ok) {
        toast({ title: "Saved", description: "Notification emails updated." })
      } else {
        toast({ title: "Error", description: "Could not save emails", variant: "destructive" })
      }
    } catch (err) {
      console.error(err)
      toast({ title: "Error", description: "Could not save emails", variant: "destructive" })
    }
  }

  const handleSavePhone = async () => {
    setPhoneError(null)
    const formatted = phoneNumber.trim()
    if (!formatted) {
      setPhoneError("Phone is required")
      return
    }
    const pn = parsePhoneNumberFromString(formatted, "US")
    if (!pn || !pn.isValid()) {
      setPhoneError("Invalid phone number")
      return
    }
    try {
      const res = await fetch("/api/business/notification-phone", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: pn.number })
      })
      if (res.ok) {
        toast({ title: "Saved", description: "Notification phone updated." })
      } else {
        toast({ title: "Error", description: "Could not save phone", variant: "destructive" })
      }
    } catch (err) {
      console.error(err)
      toast({ title: "Error", description: "Could not save phone", variant: "destructive" })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg">
              <Bell className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Notification Settings</h1>
              <p className="text-slate-600">Configure where you receive notifications when new clients are captured</p>
            </div>
          </div>
          <Button onClick={handleTestNotification}>
            <TestTube className="w-4 h-4 mr-2" />
            Send Test
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Active Channels</p>
                  <p className="text-2xl font-bold text-slate-900">{channels.filter((c) => c.enabled).length}</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <Bell className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Notifications Today</p>
                  <p className="text-2xl font-bold text-slate-900">23</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Response Time</p>
                  <p className="text-2xl font-bold text-slate-900">2.3s</p>
                </div>
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Phone className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Notification Emails */}
        <Card>
          <CardHeader>
            <CardTitle>Email Recipients</CardTitle>
            <CardDescription>All addresses will receive client notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex space-x-2">
              <Input
                placeholder="name@company.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <Button type="button" onClick={handleAddEmail} disabled={!emailInput.trim()}>
                Add
              </Button>
            </div>

            {emails.length > 0 && (
              <ul className="space-y-2">
                {emails.map((email) => (
                  <li key={email} className="flex items-center justify-between bg-slate-50 p-2 rounded">
                    <span className="text-sm text-slate-700">{email}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveEmail(email)}
                      aria-label="Remove email"
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Button onClick={handleSaveEmails}>Save Emails</Button>
          </CardContent>
        </Card>

        {/* Notification Phone */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Phone</CardTitle>
            <CardDescription>Configure your notification phone</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex space-x-2">
              <Input
                placeholder="+1 (555) 123-4567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                error={phoneError}
              />
              <Button type="button" onClick={handleSavePhone} disabled={!phoneNumber.trim() || !!phoneError}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notification Channels */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Channels</CardTitle>
            <CardDescription>Configure how you want to receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {channels.map((channel) => (
              <div key={channel.id} className="flex items-start space-x-4 p-4 border border-slate-200 rounded-lg">
                <div className={`p-2 rounded-lg ${channel.enabled ? "bg-green-50" : "bg-slate-50"}`}>
                  <channel.icon className={`w-5 h-5 ${channel.enabled ? "text-green-600" : "text-slate-400"}`} />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900">{channel.name}</h3>
                      <p className="text-sm text-slate-600">{channel.description}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      {channel.enabled && <Badge className="bg-green-50 text-green-700 border-green-200">Active</Badge>}
                      <Switch checked={channel.enabled} onCheckedChange={() => handleChannelToggle(channel.id)} />
                    </div>
                  </div>

                  {channel.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
                      {channel.id === "email" && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-address`}>Email Address</Label>
                            <Input
                              id={`${channel.id}-address`}
                              value={channel.settings.address}
                              placeholder="your@email.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-frequency`}>Frequency</Label>
                            <Select value={channel.settings.frequency}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="immediate">Immediate</SelectItem>
                                <SelectItem value="hourly">Hourly Digest</SelectItem>
                                <SelectItem value="daily">Daily Digest</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      {channel.id === "sms" && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-phone`}>Phone Number</Label>
                            <Input
                              id={`${channel.id}-phone`}
                              value={channel.settings.phone}
                              placeholder="+1 (555) 123-4567"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-frequency`}>Frequency</Label>
                            <Select value={channel.settings.frequency}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="immediate">Immediate</SelectItem>
                                <SelectItem value="hourly">Hourly Digest</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      {channel.id === "slack" && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-channel`}>Slack Channel</Label>
                            <Input id={`${channel.id}-channel`} value={channel.settings.channel} placeholder="#leads" />
                          </div>
                          <div className="space-y-2">
                            <Label>Status</Label>
                            <Button variant="outline" size="sm">
                              Connect Slack
                            </Button>
                          </div>
                        </>
                      )}

                      {channel.id === "webhook" && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`${channel.id}-url`}>Webhook URL</Label>
                            <Input
                              id={`${channel.id}-url`}
                              value={channel.settings.url}
                              placeholder="https://your-app.com/webhook"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Test</Label>
                            <Button variant="outline" size="sm">
                              Test Webhook
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Notification Types */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Types</CardTitle>
            <CardDescription>Choose which events trigger notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {types.map((type) => (
              <div key={type.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div className="space-y-1">
                  <h3 className="font-medium text-slate-900">{type.name}</h3>
                  <p className="text-sm text-slate-600">{type.description}</p>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-500">Channels:</span>
                    {type.channels.map((channelId) => {
                      const channel = channels.find((c) => c.id === channelId)
                      return channel ? (
                        <Badge key={channelId} variant="outline" className="text-xs">
                          {channel.name}
                        </Badge>
                      ) : null
                    })}
                  </div>
                </div>
                <Switch checked={type.enabled} onCheckedChange={() => handleTypeToggle(type.id)} />
              </div>
            ))}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}