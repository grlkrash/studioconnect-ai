"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Settings, Play, Save, RotateCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function AgentSettings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState({
    agentName: "Aurora Assistant",
    voice: "professional-female",
    language: "en-US",
    welcomeMessage: "Hello! I'm Aurora Assistant from Aurora Branding & Co. How can I help you today?",
    personality: "professional",
    responseSpeed: "normal",
    enableRecording: true,
    enableTranscription: true,
    workingHours: true,
    timezone: "EST",
  })

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your AI agent settings have been updated successfully.",
    })
  }

  const handleTest = () => {
    toast({
      title: "Test call initiated",
      description: "A test call will be placed to your configured number.",
    })
  }

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
          <Badge className="bg-green-50 text-green-700 border-green-200">Active</Badge>
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
                    <Label htmlFor="voice">Voice Type</Label>
                    <Select
                      value={settings.voice}
                      onValueChange={(value) => setSettings({ ...settings, voice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional-female">Professional Female</SelectItem>
                        <SelectItem value="professional-male">Professional Male</SelectItem>
                        <SelectItem value="friendly-female">Friendly Female</SelectItem>
                        <SelectItem value="friendly-male">Friendly Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="language">Language</Label>
                    <Select
                      value={settings.language}
                      onValueChange={(value) => setSettings({ ...settings, language: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-US">English (US)</SelectItem>
                        <SelectItem value="en-GB">English (UK)</SelectItem>
                        <SelectItem value="es-ES">Spanish</SelectItem>
                        <SelectItem value="fr-FR">French</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="personality">Personality</Label>
                    <Select
                      value={settings.personality}
                      onValueChange={(value) => setSettings({ ...settings, personality: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                        <SelectItem value="formal">Formal</SelectItem>
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

            {/* Brand Voice Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Brand Voice Configuration</CardTitle>
                <CardDescription>
                  Configure your AI agent to match your agency's unique brand personality and tone
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brandTone">Brand Tone</Label>
                    <Select defaultValue="professional-creative">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional-creative">Professional & Creative</SelectItem>
                        <SelectItem value="friendly-approachable">Friendly & Approachable</SelectItem>
                        <SelectItem value="sophisticated-premium">Sophisticated & Premium</SelectItem>
                        <SelectItem value="casual-innovative">Casual & Innovative</SelectItem>
                        <SelectItem value="authoritative-expert">Authoritative & Expert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="industryFocus">Industry Focus</Label>
                    <Select defaultValue="design-branding">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="design-branding">Design & Branding</SelectItem>
                        <SelectItem value="web-digital">Web & Digital</SelectItem>
                        <SelectItem value="animation-motion">Animation & Motion</SelectItem>
                        <SelectItem value="print-traditional">Print & Traditional</SelectItem>
                        <SelectItem value="full-service">Full-Service Agency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="brandValues">Brand Values & Keywords</Label>
                  <Textarea
                    id="brandValues"
                    rows={3}
                    placeholder="e.g., innovative, collaborative, results-driven, premium quality, creative excellence..."
                    defaultValue="Creative excellence, collaborative partnership, innovative solutions, premium quality, strategic thinking"
                  />
                  <p className="text-sm text-slate-500">
                    These keywords will influence how your AI agent communicates and positions your services.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="avoidWords">Words/Phrases to Avoid</Label>
                  <Textarea
                    id="avoidWords"
                    rows={2}
                    placeholder="e.g., cheap, basic, simple, quick fix..."
                    defaultValue="Cheap, basic, template-based, one-size-fits-all"
                  />
                  <p className="text-sm text-slate-500">Words that don't align with your brand positioning.</p>
                </div>

                <div className="space-y-4">
                  <Label>Communication Style Preferences</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Use Industry Terminology</p>
                        <p className="text-xs text-slate-500">Brand identity, visual hierarchy, etc.</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Emphasize Process</p>
                        <p className="text-xs text-slate-500">Highlight your methodology</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Mention Awards/Recognition</p>
                        <p className="text-xs text-slate-500">Reference achievements</p>
                      </div>
                      <Switch />
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Portfolio References</p>
                        <p className="text-xs text-slate-500">Mention relevant case studies</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sampleResponses">Sample Brand Voice Responses</Label>
                  <div className="space-y-3">
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-sm font-medium text-slate-700 mb-1">When asked about pricing:</p>
                      <p className="text-sm text-slate-600">
                        "Our investment varies based on project scope and strategic objectives. We believe in creating
                        tailored solutions that deliver exceptional ROI. I'd love to understand your specific needs to
                        provide accurate investment details."
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <p className="text-sm font-medium text-slate-700 mb-1">When describing services:</p>
                      <p className="text-sm text-slate-600">
                        "We specialize in comprehensive brand experiences that resonate with your target audience. Our
                        collaborative process ensures every touchpoint reflects your brand's unique story and drives
                        meaningful engagement."
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>Fine-tune your AI agent's behavior and capabilities</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Call Recording</Label>
                    <p className="text-sm text-slate-500">Record all incoming calls for quality assurance</p>
                  </div>
                  <Switch
                    checked={settings.enableRecording}
                    onCheckedChange={(checked) => setSettings({ ...settings, enableRecording: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Call Transcription</Label>
                    <p className="text-sm text-slate-500">Generate text transcripts of all calls</p>
                  </div>
                  <Switch
                    checked={settings.enableTranscription}
                    onCheckedChange={(checked) => setSettings({ ...settings, enableTranscription: checked })}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Working Hours Mode</Label>
                    <p className="text-sm text-slate-500">Adjust responses based on business hours</p>
                  </div>
                  <Switch
                    checked={settings.workingHours}
                    onCheckedChange={(checked) => setSettings({ ...settings, workingHours: checked })}
                  />
                </div>
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
                <Button onClick={handleTest} className="w-full" variant="outline">
                  <Play className="w-4 h-4 mr-2" />
                  Test Agent
                </Button>
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
                      "Hello! I'm Aurora Assistant from Aurora Branding & Co. How can I help you today?"
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
