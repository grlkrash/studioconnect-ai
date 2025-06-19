"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Settings, Save, RotateCcw, Play } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useBusiness } from "@/context/business-context"

export default function AgentSettings() {
  const { toast } = useToast()
  const { businessId } = useBusiness()

  interface Settings {
    agentName: string
    welcomeMessage: string
    personaPrompt: string
    openaiVoice: string
    openaiModel: string
    ttsProvider: 'openai' | 'polly' | 'realtime' | 'elevenlabs'
    useOpenaiTts: boolean
    voiceGreetingMessage: string
    widgetTheme?: {
      primary?: string
      primaryDark?: string
      bg?: string
      bgSecondary?: string
      font?: string
      radius?: string
      blur?: string
    }
    voiceStability: number
    voiceSimilarity: number
    voiceStyle: number
  }

  const defaultSettings: Settings = {
    agentName: "AI Assistant",
    personaPrompt: "You are a helpful assistant.",
    welcomeMessage: "Hello! How can I help you today?",
    openaiVoice: "nova",
    openaiModel: "tts-1",
    ttsProvider: 'elevenlabs',
    useOpenaiTts: false,
    voiceGreetingMessage: "Hello! I'm your AI assistant. How can I help you today?",
    widgetTheme: {
      primary: "#2563eb",
      primaryDark: "#1d4ed8",
      bg: "#ffffffee",
      bgSecondary: "#f8fafc",
      font: "Inter, sans-serif",
      radius: "16px",
      blur: "0px",
    },
    voiceStability: 0.3,
    voiceSimilarity: 0.8,
    voiceStyle: 0.5,
  }

  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [realtimeAvailable, setRealtimeAvailable] = useState<boolean>(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [voices, setVoices] = useState<any[]>([])

  // Fetch existing config
  useEffect(() => {
    if (!businessId) return
    ;(async () => {
      try {
        const res = await fetch(`/api/agent-config${businessId ? `?businessId=${businessId}` : ''}`, { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          if (data.config) {
            const cfg = {
              ...data.config,
              openaiVoice: (data.config.openaiVoice || '').toLowerCase(),
              openaiModel: (data.config.openaiModel || '').toLowerCase(),
            }
            setSettings({
              ...defaultSettings,
              ...cfg,
              voiceStability: cfg.voiceSettings?.stability ?? defaultSettings.voiceStability,
              voiceSimilarity: cfg.voiceSettings?.similarity_boost ?? defaultSettings.voiceSimilarity,
              voiceStyle: cfg.voiceSettings?.style ?? defaultSettings.voiceStyle,
            })
            setRealtimeAvailable(Boolean(data.realtimeAvailable))
          }
        }
      } catch (err) {
        console.error("Failed to load agent config", err)
      }
    })()
  }, [businessId])

  useEffect(() => {
    const fetchVoices = async () => {
      const resVoices = await fetch('/api/elevenlabs/voices')
      if (resVoices.ok) {
        const dataVoices = await resVoices.json()
        setVoices(dataVoices?.voices || [])
      }
    }
    fetchVoices()
  }, [])

  const handleSave = async () => {
    try {
      // Build payload – include openaiVoice only when using OpenAI TTS
      const payload: Record<string, unknown> = {
        ...settings,
        ttsProvider: settings.ttsProvider,
        voiceSettings: {
          stability: settings.voiceStability,
          similarity_boost: settings.voiceSimilarity,
          style: settings.voiceStyle,
          use_speaker_boost: true,
        },
      }

      if (settings.ttsProvider === 'openai' && settings.openaiVoice) {
        payload.openaiVoice = settings.openaiVoice.toUpperCase()
      }

      const res = await fetch(`/api/agent-config${businessId ? `?businessId=${businessId}` : ''}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  /* ----------------- Status metrics child component ------------------ */
  function StatusMetrics() {
    const [status, setStatus] = useState<any | null>(null)

    useEffect(() => {
      ;(async () => {
        try {
          const res = await fetch(`/api/dashboard-status${businessId ? `?businessId=${businessId}` : ''}`)
          if (res.ok) setStatus(await res.json())
        } catch {
          /* swallow */
        }
      })()
    }, [businessId])

    return (
      <>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Business ID</span>
          <span className="text-xs font-mono">{businessId || status?.businessId || '—'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Agent Status</span>
          <Badge className="bg-green-50 text-green-700 border-green-200">{status?.agentStatus || '—'}</Badge>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Calls Today</span>
          <span className="text-sm font-medium">{status?.callsToday ?? '—'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Avg Response Time</span>
          <span className="text-sm font-medium">{status?.avgResponse ?? '—'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Avg Call Duration</span>
          <span className="text-sm font-medium">{status?.avgDuration ?? '—'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Success Rate</span>
          <span className="text-sm font-medium">{status?.successRate ?? '—'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Twilio Number</span>
          <span className="text-sm font-medium">{status?.twilioPhoneNumber ?? '—'}</span>
        </div>
      </>
    )
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
                    <Label>Provider</Label>
                    <Select
                      value={settings.ttsProvider}
                      onValueChange={(value) => setSettings({ ...settings, ttsProvider: value as any })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="realtime" disabled={!realtimeAvailable}>
                          OpenAI Realtime{!realtimeAvailable ? ' – Beta unavailable' : ''}
                        </SelectItem>
                        <SelectItem value="openai">OpenAI Standard TTS</SelectItem>
                        <SelectItem value="polly">Amazon Polly (Twilio fallback)</SelectItem>
                        <SelectItem value="elevenlabs">ElevenLabs Premium TTS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openaiVoice">Voice</Label>
                    <Select
                      value={settings.openaiVoice}
                      onValueChange={(value) => setSettings({ ...settings, openaiVoice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select voice" />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.length ? voices.map(v => (
                          <SelectItem key={v.voice_id} value={v.voice_id}>{v.name}</SelectItem>
                        )) : (
                          <SelectItem value="josh">Josh</SelectItem>
                        )}
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
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tts-1">TTS-1 (fast)</SelectItem>
                        <SelectItem value="tts-1-hd">TTS-1-HD (high quality)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Stability</Label>
                    <input type="range" min="0" max="1" step="0.05" value={settings.voiceStability}
                      onChange={(e)=>setSettings({...settings, voiceStability: parseFloat(e.target.value)})} />
                    <p className="text-xs text-slate-500">{settings.voiceStability}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Similarity Boost</Label>
                    <input type="range" min="0" max="1" step="0.05" value={settings.voiceSimilarity}
                      onChange={(e)=>setSettings({...settings, voiceSimilarity: parseFloat(e.target.value)})} />
                    <p className="text-xs text-slate-500">{settings.voiceSimilarity}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Style</Label>
                    <input type="range" min="0" max="1" step="0.05" value={settings.voiceStyle}
                      onChange={(e)=>setSettings({...settings, voiceStyle: parseFloat(e.target.value)})} />
                    <p className="text-xs text-slate-500">{settings.voiceStyle}</p>
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

            {/* Widget Appearance */}
            <Card>
              <CardHeader>
                <CardTitle>Widget Appearance</CardTitle>
                <CardDescription>Customize chat widget colors & style</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="primaryColor">Primary Color</Label>
                    <Input
                      id="primaryColor"
                      type="color"
                      value={settings.widgetTheme?.primary}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, primary: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryDarkColor">Primary Dark</Label>
                    <Input
                      id="primaryDarkColor"
                      type="color"
                      value={settings.widgetTheme?.primaryDark}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, primaryDark: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bgColor">Background</Label>
                    <Input
                      id="bgColor"
                      type="color"
                      value={settings.widgetTheme?.bg}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, bg: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bgSecondaryColor">Bg Secondary</Label>
                    <Input
                      id="bgSecondaryColor"
                      type="color"
                      value={settings.widgetTheme?.bgSecondary}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, bgSecondary: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="font">Font Stack</Label>
                    <Input
                      id="font"
                      value={settings.widgetTheme?.font}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, font: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="radius">Radius (px)</Label>
                    <Input
                      id="radius"
                      value={settings.widgetTheme?.radius}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, radius: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="blur">Blur (e.g., 14px)</Label>
                    <Input
                      id="blur"
                      value={settings.widgetTheme?.blur}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          widgetTheme: { ...settings.widgetTheme, blur: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
                {/* Code snippet */}
                <div className="space-y-2">
                  <Label>Embed Snippet</Label>
                  <pre className="bg-slate-900 text-green-400 rounded p-4 text-xs overflow-auto select-all">
                    {`<script defer
                      src="https://app.cincyaisolutions.com/widget.js"
                      data-business-id="YOUR_BUSINESS_ID_HERE"
                      data-api-url="https://app.cincyaisolutions.com"
                      data-primary="${settings.widgetTheme?.primary}"
                      data-primary-dark="${settings.widgetTheme?.primaryDark}"
                      data-bg="${settings.widgetTheme?.bg}"
                      data-bg-secondary="${settings.widgetTheme?.bgSecondary}"
                      data-font="${settings.widgetTheme?.font}"
                      data-radius="${settings.widgetTheme?.radius}"
                      data-blur="${settings.widgetTheme?.blur}"
                    ></script>`}
                  </pre>
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
                <Button onClick={handleSave} className="w-full">
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
                <Button variant="ghost" className="w-full">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset to Default
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!realtimeAvailable}
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/admin/enable-realtime', { method: 'POST' })
                      if (res.ok) {
                        const data = await res.json()
                        toast({ title: 'Realtime enabled', description: `Updated ${data.updated} agents.` })
                        setSettings((s) => ({ ...s, ttsProvider: 'realtime' }))
                      } else {
                        throw new Error('failed')
                      }
                    } catch (err) {
                      toast({ title: 'Error', description: 'Failed to enable realtime', variant: 'destructive' })
                    }
                  }}
                >
                  <Play className="w-4 h-4 mr-2" /> Enable Realtime for All
                </Button>
              </CardContent>
            </Card>

            {/* Current Status */}
            <Card>
              <CardHeader>
                <CardTitle>Current Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusMetrics />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Voice Engine</span>
                  <Badge className={settings.ttsProvider === 'realtime' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}>
                    {settings.ttsProvider === 'realtime' ? 'Realtime ✅' : 'Fallback'}
                  </Badge>
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
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={previewLoading}
                    onClick={async () => {
                      try {
                        setPreviewLoading(true)
                        const res = await fetch("/api/voice-preview", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            text: settings.welcomeMessage,
                            model: settings.openaiModel,
                            voice: settings.openaiVoice,
                            provider: settings.ttsProvider,
                          }),
                        })
                        if (!res.ok) throw new Error("failed")
                        const data = await res.json()
                        const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`)
                        await audio.play()
                      } catch (err) {
                        toast({ title: "Error", description: "Could not play preview", variant: "destructive" })
                      } finally {
                        setPreviewLoading(false)
                      }
                    }}
                  >
                    {previewLoading ? (
                      <>
                        <Play className="w-4 h-4 mr-2 animate-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" /> Play Preview
                      </>
                    )}
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
