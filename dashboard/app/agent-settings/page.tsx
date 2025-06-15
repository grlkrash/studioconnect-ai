"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Settings, Save } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function AgentSettings() {
  const { toast } = useToast()

  interface Settings {
    agentName: string
    welcomeMessage: string
    personaPrompt: string
    openaiVoice: string
    openaiModel: string
    useOpenaiTts: boolean
    voiceGreetingMessage: string
  }

  const [settings, setSettings] = useState<Settings>({
    agentName: "AI Assistant",
    personaPrompt: "You are a helpful assistant.",
    welcomeMessage: "Hello! How can I help you today?",
    openaiVoice: "NOVA",
    openaiModel: "tts-1",
    useOpenaiTts: true,
    voiceGreetingMessage: "Hello! I'm your AI assistant. How can I help you today?",
  })

  // Fetch existing config
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/agent-config", { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          if (data.config) setSettings({ ...settings, ...data.config })
        }
      } catch (err) {
        console.error("Failed to load agent config", err)
      }
    })()
  }, [])

  const handleSave = async () => {
    try {
      const res = await fetch("/api/agent-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        toast({ title: "Saved", description: "Agent settings updated." })
      } else throw new Error("Failed")
    } catch (err) {
      toast({ title: "Error", description: "Could not save settings", variant: "destructive" })
      console.error(err)
    }
  }

  // Coming soon placeholder
  const ComingSoon = () => (
    <p className="text-xs text-slate-500 italic">Coming Soon 🚧</p>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Agent Settings</h1>
              <p className="text-slate-600">Configure your AI agent's personality, voice, and behavior</p>
            </div>
          </div>
          {/* Status removed for brevity */}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Configuration</CardTitle>
                <CardDescription>Set up your AI agent's basic identity and voice settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="agentName">Agent Name</Label>
                    <Input
                      id="agentName"
                      value={settings.agentName}
                      onChange={(e) => setSettings({ ...settings, agentName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openaiVoice">Voice</Label>
                    <Select
                      value={settings.openaiVoice}
                      onValueChange={(value) => setSettings({ ...settings, openaiVoice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NOVA">NOVA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Voice Model</Label>
                    <Select
                      value={settings.openaiModel}
                      onValueChange={(value) => setSettings({ ...settings, openaiModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tts-1">TTS-1 (fast)</SelectItem>
                        <SelectItem value="tts-1-hd">TTS-1-HD (high quality)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Welcome Message */}
            <Card>
              <CardHeader>
                <CardTitle>Welcome Message</CardTitle>
                <CardDescription>Customize the greeting your AI agent uses when answering calls</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="welcomeMessage">Welcome Message</Label>
                  <Textarea
                    id="welcomeMessage"
                    rows={4}
                    value={settings.welcomeMessage}
                    onChange={(e) => setSettings({ ...settings, welcomeMessage: e.target.value })}
                    placeholder="Enter your custom welcome message..."
                  />
                  <p className="text-sm text-slate-500">
                    Keep it concise and professional. This will be the first thing callers hear.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Brand Voice Configuration Placeholder */}
            <Card>
              <CardHeader>
                <CardTitle>Brand Voice Configuration</CardTitle>
                <CardDescription>Fine-tune tone & industry focus</CardDescription>
              </CardHeader>
              <CardContent>
                <ComingSoon />
              </CardContent>
            </Card>

            {/* Additional Preferences */}
            <Card>
              <CardHeader>
                <CardTitle>Additional Preferences</CardTitle>
              </CardHeader>
              <CardContent>
                <ComingSoon />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={handleSave} className="w-full">
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
                <Button variant="ghost" className="w-full">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset to Default
                </Button>
              </CardContent>
            </Card>

            {/* Current Status */}
            <Card>
              <CardHeader>
                <CardTitle>Current Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Agent Status</span>
                  <Badge className="bg-green-50 text-green-700 border-green-200">Online</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Calls Today</span>
                  <span className="text-sm font-medium">47</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Avg Response Time</span>
                  <span className="text-sm font-medium">1.2s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Success Rate</span>
                  <span className="text-sm font-medium">98.5%</span>
                </div>
              </CardContent>
            </Card>

            {/* Voice Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Voice Preview</CardTitle>
                <CardDescription>Listen to how your agent will sound</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-700">
                      "Hello! I'm your AI assistant. How can I help you today?"
                    </p>
                  </div>
                  <Button variant="outline" className="w-full">
                    <Play className="w-4 h-4 mr-2" />
                    Play Preview
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
