"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Settings, Save, RotateCcw, Play, Info, AlertTriangle, CheckCircle, Loader2, Volume2, Mic, TestTube2, Shield, Zap } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { useBusiness } from "@/context/business-context"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"

export default function AgentSettings() {
  const { toast } = useToast()
  const { businessId } = useBusiness()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingVoice, setIsTestingVoice] = useState(false)
  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'critical'>('healthy')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  interface EnterpriseSettings {
    // Core Configuration
    agentName: string
    personaPrompt: string
    welcomeMessage: string
    voiceGreetingMessage: string
    
    // Voice & TTS Configuration
    ttsProvider: 'elevenlabs' | 'openai' | 'realtime'
    elevenlabsVoice: string
    elevenlabsModel: string
    openaiVoice: string
    openaiModel: string
    
    // Enterprise Voice Settings
    voiceSettings: {
      stability: number
      similarity_boost: number
      style: number
      use_speaker_boost: boolean
      speed: number
    }
    
    // Advanced Settings
    enableRealtimeMode: boolean
    enableAdvancedFiltering: boolean
    conversationTimeout: number
    maxConversationLength: number
    enableEmergencyEscalation: boolean
    
    // Professional Features
    enableCallRecording: boolean
    enableAnalytics: boolean
    enableCustomPrompts: boolean
    enableMultiLanguage: boolean
  }

  const enterpriseDefaults: EnterpriseSettings = {
    agentName: "AI Account Manager",
    personaPrompt: `You are a highly professional AI Account Manager for a premium creative agency. You specialize in:

🎨 CREATIVE SERVICES: Branding, web design, digital marketing, video production, and creative campaigns
📊 PROJECT MANAGEMENT: Status updates, timeline coordination, and deliverable tracking  
💼 CLIENT RELATIONS: Professional communication, requirement gathering, and solution consulting
🚀 STRATEGIC CONSULTING: Creative direction, brand strategy, and growth initiatives

COMMUNICATION STYLE:
- Professional yet approachable tone
- Industry expertise and creative knowledge
- Proactive problem-solving mindset
- Clear, concise, and action-oriented responses
- Always ask clarifying questions to better serve clients

CAPABILITIES:
- Real-time project status updates
- Creative brief discussions
- Timeline and deadline management
- Resource allocation insights
- Strategic recommendations
- Emergency escalation for urgent matters

Maintain the highest standards of professionalism while being genuinely helpful and solution-focused.`,
    
    welcomeMessage: "Welcome to our creative studio! I'm your dedicated AI Account Manager, ready to assist with your projects and creative initiatives.",
    
    voiceGreetingMessage: "Good day! Thank you for calling our creative studio. I'm your dedicated AI Account Manager, here to provide immediate assistance with your creative projects, timeline updates, and strategic initiatives. How may I help you today?",
    
    ttsProvider: 'elevenlabs',
    elevenlabsVoice: '21m00Tcm4TlvDq8ikWAM', // Rachel - Professional female voice
    elevenlabsModel: 'eleven_turbo_v2_5',
    openaiVoice: 'nova',
    openaiModel: 'tts-1-hd',
    
    voiceSettings: {
      stability: 0.7,
      similarity_boost: 0.85,
      style: 0.2,
      use_speaker_boost: true,
      speed: 1.0
    },
    
    enableRealtimeMode: true,
    enableAdvancedFiltering: true,
    conversationTimeout: 300000, // 5 minutes
    maxConversationLength: 50,
    enableEmergencyEscalation: true,
    
    enableCallRecording: true,
    enableAnalytics: true,
    enableCustomPrompts: true,
    enableMultiLanguage: false
  }

  const [settings, setSettings] = useState<EnterpriseSettings>(enterpriseDefaults)
  const [voices, setVoices] = useState<any[]>([])
  const [realtimeAvailable, setRealtimeAvailable] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Load configuration
  const loadConfiguration = useCallback(async () => {
    if (!businessId) return
    
    setIsLoading(true)
    try {
      const [configRes, voicesRes, statusRes] = await Promise.all([
        fetch(`/api/agent-config?businessId=${businessId}`, { credentials: "include" }),
        fetch('/api/elevenlabs/voices', { credentials: "include" }),
        fetch(`/api/dashboard-status?businessId=${businessId}`, { credentials: "include" })
      ])

      if (configRes.ok) {
        const configData = await configRes.json()
        if (configData.config) {
          setSettings(prev => ({
            ...prev,
            ...configData.config,
            voiceSettings: {
              ...prev.voiceSettings,
              ...configData.config.voiceSettings
            }
          }))
          setRealtimeAvailable(configData.realtimeAvailable || false)
          console.log('✅ Agent configuration loaded successfully')
        }
      }

      if (voicesRes.ok) {
        const voicesData = await voicesRes.json()
        setVoices(voicesData.voices || [])
        console.log('✅ ElevenLabs voices loaded successfully')
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json()
        setSystemStatus(statusData.voiceHealth?.status || 'healthy')
        console.log('✅ System status loaded successfully')
      }

    } catch (error) {
      console.error('❌ Failed to load configuration:', error)
      toast({
        title: "Configuration Load Failed",
        description: "Unable to load current settings. Please refresh the page.",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }, [businessId, toast])

  // Validation
  const validateSettings = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    
    if (!settings.agentName.trim()) {
      errors.agentName = "Agent name is required"
    }
    
    if (!settings.personaPrompt.trim()) {
      errors.personaPrompt = "Persona prompt is required"
    } else if (settings.personaPrompt.length < 50) {
      errors.personaPrompt = "Persona prompt should be at least 50 characters for effective AI behavior"
    }
    
    if (!settings.welcomeMessage.trim()) {
      errors.welcomeMessage = "Welcome message is required"
    }
    
    if (!settings.voiceGreetingMessage.trim()) {
      errors.voiceGreetingMessage = "Voice greeting message is required"
    }
    
    if (settings.ttsProvider === 'elevenlabs' && !settings.elevenlabsVoice) {
      errors.elevenlabsVoice = "ElevenLabs voice selection is required"
    }
    
    if (settings.ttsProvider === 'openai' && !settings.openaiVoice) {
      errors.openaiVoice = "OpenAI voice selection is required"
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }, [settings])

  // Save configuration
  const saveConfiguration = useCallback(async () => {
    if (!validateSettings()) {
      toast({
        title: "Validation Error",
        description: "Please fix the validation errors before saving.",
        variant: "destructive"
      })
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        ...settings,
        businessId: businessId
      }

      const response = await fetch(`/api/agent-config?businessId=${businessId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
        toast({
          title: "Configuration Saved",
          description: "Your enterprise voice agent settings have been updated successfully.",
          duration: 3000
        })
        console.log('✅ Configuration saved successfully')
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save configuration')
      }
    } catch (error) {
      console.error('❌ Save failed:', error)
      toast({
        title: "Save Failed",
        description: `Unable to save configuration: ${error}`,
        variant: "destructive"
      })
    } finally {
      setIsSaving(false)
    }
  }, [settings, businessId, validateSettings, toast])

  // Test voice
  const testVoice = useCallback(async () => {
    setIsTestingVoice(true)
    try {
      const testText = settings.voiceGreetingMessage || "Hello! This is a test of your voice agent configuration."
      
      const response = await fetch('/api/voice-preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          voice: settings.ttsProvider === 'elevenlabs' ? settings.elevenlabsVoice : settings.openaiVoice,
          model: settings.ttsProvider === 'elevenlabs' ? settings.elevenlabsModel : settings.openaiModel,
          provider: settings.ttsProvider,
          voiceSettings: settings.voiceSettings
        })
      })

      if (response.ok) {
        const blob = await response.blob()
        const audioUrl = URL.createObjectURL(blob)
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl
          audioRef.current.play()
        }
        
        toast({
          title: "Voice Test",
          description: "Playing voice preview with current settings.",
          duration: 2000
        })
      } else {
        throw new Error('Voice test failed')
      }
    } catch (error) {
      console.error('❌ Voice test failed:', error)
      toast({
        title: "Voice Test Failed",
        description: "Unable to generate voice preview. Please check your settings.",
        variant: "destructive"
      })
    } finally {
      setIsTestingVoice(false)
    }
  }, [settings, toast])

  // Track changes
  const updateSetting = useCallback((key: keyof EnterpriseSettings, value: any) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: value }
      setHasUnsavedChanges(true)
      return updated
    })
  }, [])

  const updateVoiceSetting = useCallback((key: keyof EnterpriseSettings['voiceSettings'], value: any) => {
    setSettings(prev => ({
      ...prev,
      voiceSettings: {
        ...prev.voiceSettings,
        [key]: value
      }
    }))
    setHasUnsavedChanges(true)
  }, [])

  // Load data on mount
  useEffect(() => {
    loadConfiguration()
  }, [loadConfiguration])

  // Validate on settings change
  useEffect(() => {
    if (!isLoading) {
      validateSettings()
    }
  }, [settings, isLoading, validateSettings])

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading enterprise configuration...</p>
        </div>
        </div>
        </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
            <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              Enterprise Voice Agent
            </h1>
            <p className="text-slate-600 mt-2">
              Professional-grade AI voice agent configuration for creative agencies and studios
            </p>
            </div>
          
          <div className="flex items-center gap-3">
            <Badge variant={systemStatus === 'healthy' ? 'default' : systemStatus === 'degraded' ? 'secondary' : 'destructive'}>
              {systemStatus === 'healthy' && <CheckCircle className="h-3 w-3 mr-1" />}
              {systemStatus === 'degraded' && <AlertTriangle className="h-3 w-3 mr-1" />}
              {systemStatus === 'critical' && <AlertTriangle className="h-3 w-3 mr-1" />}
              System {systemStatus}
            </Badge>
            
            {lastSaved && (
              <p className="text-xs text-slate-500">
                Last saved: {lastSaved.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Unsaved changes warning */}
        {hasUnsavedChanges && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You have unsaved changes. Make sure to save your configuration before leaving this page.
            </AlertDescription>
          </Alert>
        )}

        {/* Main Configuration */}
        <Tabs defaultValue="core" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="core">Core Settings</TabsTrigger>
            <TabsTrigger value="voice">Voice & Audio</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="professional">Professional Features</TabsTrigger>
          </TabsList>

          {/* Core Settings */}
          <TabsContent value="core" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Core Configuration
                </CardTitle>
                <CardDescription>
                  Essential settings that define your AI agent's identity and behavior
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="agentName">Agent Name *</Label>
                    <Input
                      id="agentName"
                      value={settings.agentName}
                      onChange={(e) => updateSetting('agentName', e.target.value)}
                      placeholder="AI Account Manager"
                      className={validationErrors.agentName ? "border-red-500" : ""}
                    />
                    {validationErrors.agentName && (
                      <p className="text-xs text-red-600">{validationErrors.agentName}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="conversationTimeout">Conversation Timeout (minutes)</Label>
                    <Input
                      id="conversationTimeout"
                      type="number"
                      value={Math.floor(settings.conversationTimeout / 60000)}
                      onChange={(e) => updateSetting('conversationTimeout', parseInt(e.target.value) * 60000)}
                      min="1"
                      max="30"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="welcomeMessage">Welcome Message *</Label>
                  <Input
                    id="welcomeMessage"
                    value={settings.welcomeMessage}
                    onChange={(e) => updateSetting('welcomeMessage', e.target.value)}
                    placeholder="Welcome to our creative studio..."
                    className={validationErrors.welcomeMessage ? "border-red-500" : ""}
                  />
                  {validationErrors.welcomeMessage && (
                    <p className="text-xs text-red-600">{validationErrors.welcomeMessage}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="voiceGreetingMessage">Voice Greeting Message *</Label>
                  <Textarea
                    id="voiceGreetingMessage"
                    value={settings.voiceGreetingMessage}
                    onChange={(e) => updateSetting('voiceGreetingMessage', e.target.value)}
                    placeholder="Good day! Thank you for calling..."
                    rows={3}
                    className={validationErrors.voiceGreetingMessage ? "border-red-500" : ""}
                  />
                  {validationErrors.voiceGreetingMessage && (
                    <p className="text-xs text-red-600">{validationErrors.voiceGreetingMessage}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personaPrompt">AI Persona & Behavior *</Label>
                  <Textarea
                    id="personaPrompt"
                    value={settings.personaPrompt}
                    onChange={(e) => updateSetting('personaPrompt', e.target.value)}
                    placeholder="You are a highly professional AI Account Manager..."
                    rows={8}
                    className={validationErrors.personaPrompt ? "border-red-500" : ""}
                  />
                  {validationErrors.personaPrompt && (
                    <p className="text-xs text-red-600">{validationErrors.personaPrompt}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    Characters: {settings.personaPrompt.length} (minimum 50 recommended)
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Voice & Audio */}
          <TabsContent value="voice" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Volume2 className="h-5 w-5" />
                  Voice & Audio Configuration
                </CardTitle>
                <CardDescription>
                  Professional voice settings for enterprise-grade audio quality
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>TTS Provider *</Label>
                    <Select
                      value={settings.ttsProvider}
                      onValueChange={(value: 'elevenlabs' | 'openai' | 'realtime') => updateSetting('ttsProvider', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="elevenlabs">
                          <div className="flex items-center gap-2">
                            <Badge variant="default">Recommended</Badge>
                            ElevenLabs (Premium)
                          </div>
                        </SelectItem>
                        <SelectItem value="openai">OpenAI TTS</SelectItem>
                        {realtimeAvailable && (
                          <SelectItem value="realtime">
                            <div className="flex items-center gap-2">
                              <Zap className="h-3 w-3" />
                              OpenAI Realtime
                            </div>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {settings.ttsProvider === 'elevenlabs' && (
                    <>
                  <div className="space-y-2">
                        <Label>ElevenLabs Voice *</Label>
                    <Select
                          value={settings.elevenlabsVoice} 
                          onValueChange={(value) => updateSetting('elevenlabsVoice', value)}
                    >
                          <SelectTrigger className={validationErrors.elevenlabsVoice ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select voice" />
                      </SelectTrigger>
                      <SelectContent>
                            {voices.map((voice) => (
                              <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                <div className="flex items-center gap-2">
                                  <span>{voice.name}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {voice.category || 'Custom'}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {validationErrors.elevenlabsVoice && (
                          <p className="text-xs text-red-600">{validationErrors.elevenlabsVoice}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>ElevenLabs Model</Label>
                        <Select 
                          value={settings.elevenlabsModel} 
                          onValueChange={(value) => updateSetting('elevenlabsModel', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eleven_turbo_v2_5">
                              <div className="flex items-center gap-2">
                                <Badge variant="default">Recommended</Badge>
                                Eleven Turbo v2.5
                              </div>
                            </SelectItem>
                            <SelectItem value="eleven_multilingual_v2">Eleven Multilingual v2</SelectItem>
                            <SelectItem value="eleven_monolingual_v1">Eleven Monolingual v1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                    </>
                  )}

                  {settings.ttsProvider === 'openai' && (
                    <>
                      <div className="space-y-2">
                        <Label>OpenAI Voice *</Label>
                        <Select 
                          value={settings.openaiVoice} 
                          onValueChange={(value) => updateSetting('openaiVoice', value)}
                        >
                          <SelectTrigger className={validationErrors.openaiVoice ? "border-red-500" : ""}>
                            <SelectValue placeholder="Select voice" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nova">Nova (Recommended)</SelectItem>
                            <SelectItem value="alloy">Alloy</SelectItem>
                            <SelectItem value="echo">Echo</SelectItem>
                            <SelectItem value="fable">Fable</SelectItem>
                            <SelectItem value="onyx">Onyx</SelectItem>
                            <SelectItem value="shimmer">Shimmer</SelectItem>
                          </SelectContent>
                        </Select>
                        {validationErrors.openaiVoice && (
                          <p className="text-xs text-red-600">{validationErrors.openaiVoice}</p>
                        )}
                </div>

                  <div className="space-y-2">
                        <Label>OpenAI Model</Label>
                    <Select
                      value={settings.openaiModel}
                          onValueChange={(value) => updateSetting('openaiModel', value)}
                    >
                      <SelectTrigger>
                            <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                            <SelectItem value="tts-1-hd">
                              <div className="flex items-center gap-2">
                                <Badge variant="default">HD Quality</Badge>
                                TTS-1-HD
                              </div>
                            </SelectItem>
                            <SelectItem value="tts-1">TTS-1 (Standard)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                    </>
                  )}
                </div>

                {settings.ttsProvider === 'elevenlabs' && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <h4 className="font-medium">Voice Fine-Tuning</h4>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Stability</Label>
                            <span className="text-sm text-slate-600">{settings.voiceSettings.stability}</span>
                          </div>
                          <Slider
                            value={[settings.voiceSettings.stability]}
                            onValueChange={(value) => updateVoiceSetting('stability', value[0])}
                            max={1}
                            min={0.1}
                            step={0.1}
                            className="w-full"
                          />
                          <p className="text-xs text-slate-500">Higher values = more consistent delivery</p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Similarity Boost</Label>
                            <span className="text-sm text-slate-600">{settings.voiceSettings.similarity_boost}</span>
                          </div>
                          <Slider
                            value={[settings.voiceSettings.similarity_boost]}
                            onValueChange={(value) => updateVoiceSetting('similarity_boost', value[0])}
                            max={1}
                            min={0.1}
                            step={0.05}
                            className="w-full"
                          />
                          <p className="text-xs text-slate-500">Higher values = closer to original voice</p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Style</Label>
                            <span className="text-sm text-slate-600">{settings.voiceSettings.style}</span>
                          </div>
                          <Slider
                            value={[settings.voiceSettings.style]}
                            onValueChange={(value) => updateVoiceSetting('style', value[0])}
                            max={1}
                            min={0}
                            step={0.1}
                            className="w-full"
                          />
                          <p className="text-xs text-slate-500">Higher values = more expressive delivery</p>
                  </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Speaking Speed</Label>
                            <span className="text-sm text-slate-600">{settings.voiceSettings.speed}x</span>
                  </div>
                          <Slider
                            value={[settings.voiceSettings.speed]}
                            onValueChange={(value) => updateVoiceSetting('speed', value[0])}
                            max={1.5}
                            min={0.7}
                            step={0.1}
                            className="w-full"
                          />
                          <p className="text-xs text-slate-500">1.0x = natural speaking pace</p>
                  </div>
                </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="speakerBoost"
                          checked={settings.voiceSettings.use_speaker_boost}
                          onCheckedChange={(checked) => updateVoiceSetting('use_speaker_boost', checked)}
                        />
                        <Label htmlFor="speakerBoost">Enable Speaker Boost (Enhanced Audio Quality)</Label>
                      </div>
                    </div>
                  </>
                )}

                <Separator />
                
                <div className="flex items-center gap-3">
                  <Button 
                    onClick={testVoice} 
                    disabled={isTestingVoice}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    {isTestingVoice ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube2 className="h-4 w-4" />
                    )}
                    Test Voice Preview
                  </Button>
                  <p className="text-sm text-slate-600">
                    Preview how your voice agent will sound with current settings
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Advanced Settings */}
          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Advanced Configuration
                </CardTitle>
                <CardDescription>
                  Fine-tune performance and behavior for optimal results
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableRealtimeMode"
                      checked={settings.enableRealtimeMode && realtimeAvailable}
                      onCheckedChange={(checked) => updateSetting('enableRealtimeMode', checked)}
                      disabled={!realtimeAvailable}
                    />
                    <div>
                      <Label htmlFor="enableRealtimeMode">Real-time Voice Mode</Label>
                      <p className="text-xs text-slate-500">
                        {realtimeAvailable ? "Ultra-low latency conversations" : "Not available - requires enterprise plan"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableAdvancedFiltering"
                      checked={settings.enableAdvancedFiltering}
                      onCheckedChange={(checked) => updateSetting('enableAdvancedFiltering', checked)}
                    />
                    <div>
                      <Label htmlFor="enableAdvancedFiltering">Advanced Phantom Speech Filtering</Label>
                      <p className="text-xs text-slate-500">Enterprise-grade noise and false positive elimination</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableEmergencyEscalation"
                      checked={settings.enableEmergencyEscalation}
                      onCheckedChange={(checked) => updateSetting('enableEmergencyEscalation', checked)}
                    />
                    <div>
                      <Label htmlFor="enableEmergencyEscalation">Emergency Escalation</Label>
                      <p className="text-xs text-slate-500">Automatically escalate urgent calls to human agents</p>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="maxConversationLength">Max Conversation Length</Label>
                    <Input
                      id="maxConversationLength"
                      type="number"
                      value={settings.maxConversationLength}
                      onChange={(e) => updateSetting('maxConversationLength', parseInt(e.target.value))}
                      min="10"
                      max="100"
                    />
                    <p className="text-xs text-slate-500">Maximum number of exchanges to maintain context</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Professional Features */}
          <TabsContent value="professional" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Professional Features
                </CardTitle>
                <CardDescription>
                  Enterprise capabilities for agencies and creative studios
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableCallRecording"
                      checked={settings.enableCallRecording}
                      onCheckedChange={(checked) => updateSetting('enableCallRecording', checked)}
                    />
                    <div>
                      <Label htmlFor="enableCallRecording">Call Recording</Label>
                      <p className="text-xs text-slate-500">Record conversations for quality assurance and training</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableAnalytics"
                      checked={settings.enableAnalytics}
                      onCheckedChange={(checked) => updateSetting('enableAnalytics', checked)}
                    />
                    <div>
                      <Label htmlFor="enableAnalytics">Advanced Analytics</Label>
                      <p className="text-xs text-slate-500">Detailed conversation metrics and insights</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableCustomPrompts"
                      checked={settings.enableCustomPrompts}
                      onCheckedChange={(checked) => updateSetting('enableCustomPrompts', checked)}
                    />
                    <div>
                      <Label htmlFor="enableCustomPrompts">Custom Prompt Library</Label>
                      <p className="text-xs text-slate-500">Create and manage specialized conversation templates</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enableMultiLanguage"
                      checked={settings.enableMultiLanguage}
                      onCheckedChange={(checked) => updateSetting('enableMultiLanguage', checked)}
                    />
                    <div>
                      <Label htmlFor="enableMultiLanguage">Multi-language Support</Label>
                      <p className="text-xs text-slate-500">Coming soon - Support for multiple languages</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex items-center justify-between bg-slate-50 p-4 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Info className="h-4 w-4" />
            Changes are automatically validated. Save to apply your configuration.
                  </div>
          
          <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
              onClick={() => {
                setSettings(enterpriseDefaults)
                setHasUnsavedChanges(true)
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
            
            <Button 
              onClick={saveConfiguration}
              disabled={isSaving || Object.keys(validationErrors).length > 0}
              className="min-w-[120px]"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {isSaving ? 'Saving...' : 'Save Configuration'}
                  </Button>
          </div>
        </div>

        {/* Hidden audio element for voice testing */}
        <audio ref={audioRef} className="hidden" />
        
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

