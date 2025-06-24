"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { 
  MessageSquare, 
  Phone, 
  User, 
  Clock, 
  Calendar,
  Search, 
  Filter,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Download,
  Eye,
  MessageCircle,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Brain,
  Target,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Users,
  Clock3
} from "lucide-react"
import { useBusiness } from "@/context/business-context"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { format, isToday, isYesterday, subDays } from "date-fns"

interface Interaction {
  id: string
  type: 'CHAT' | 'VOICE'
  source: 'widget' | 'phone' | 'api' | 'whatsapp' | 'email'
  status: 'ACTIVE' | 'COMPLETED' | 'ESCALATED' | 'ABANDONED' | 'FAILED'
  clientId?: string
  clientName?: string
  clientEmail?: string
  phoneNumber?: string
  createdAt: string
  updatedAt: string
  endedAt?: string
  metadata?: {
    duration?: number
    messageCount?: number
    aiResponseTime?: number
    resolutionTime?: number
    satisfaction?: number
    sentiment?: 'positive' | 'neutral' | 'negative'
    escalationReason?: string
    topics?: string[]
    urgency?: 'low' | 'medium' | 'high' | 'critical'
    resolved?: boolean
    handoffToHuman?: boolean
    customerReturn?: boolean
  }
  summary?: string
  conversation?: {
    id: string
    messages: Array<{
      id: string
      role: 'user' | 'assistant' | 'system'
      content: string
      timestamp: string
      metadata?: any
    }>
  }
}

interface InteractionAnalytics {
  totalInteractions: number
  activeInteractions: number
  completedInteractions: number
  escalatedInteractions: number
  averageResolutionTime: number
  customerSatisfaction: number
  commonTopics: Array<{ topic: string; count: number }>
  sentimentDistribution: { positive: number; neutral: number; negative: number }
  hourlyVolume: Array<{ hour: number; count: number }>
  sourceDistribution: Record<string, number>
}

export default function InteractionsPage() {
  const { businessId } = useBusiness()
  const { toast } = useToast()
  
  // State
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [analytics, setAnalytics] = useState<InteractionAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null)
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [sentimentFilter, setSentimentFilter] = useState<string>("all")
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(25)

  // Load interactions data
  const loadInteractions = useCallback(async (showRefreshing = false) => {
    if (!businessId) return
    
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    
    try {
      const params = new URLSearchParams({
        businessId,
        ...(typeFilter !== 'all' && { type: typeFilter }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(sourceFilter !== 'all' && { source: sourceFilter }),
        ...(sentimentFilter !== 'all' && { sentiment: sentimentFilter }),
        ...(searchTerm && { search: searchTerm }),
        limit: (itemsPerPage * 5).toString()
      })

      const [interactionsRes, analyticsRes] = await Promise.all([
        fetch(`/admin/api/interactions?${params}`, { credentials: 'include' }),
        fetch(`/admin/api/analytics/interactions?${params}`, { credentials: 'include' })
      ])

      if (interactionsRes.ok) {
        const interactionsData = await interactionsRes.json()
        setInteractions(interactionsData.interactions || [])
      } else {
        throw new Error('Failed to fetch interactions')
      }

      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json()
        setAnalytics(analyticsData.analytics || null)
      }

      console.log('✅ Interactions data loaded successfully')
      
    } catch (error) {
      console.error('❌ Failed to load interactions:', error)
      toast({
        title: "Load Failed",
        description: "Unable to load interaction data. Please try again.",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [businessId, typeFilter, statusFilter, sourceFilter, sentimentFilter, searchTerm, itemsPerPage, toast])

  // Filter and paginate interactions
  const filteredInteractions = useMemo(() => {
    let filtered = interactions

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(interaction => 
        interaction.clientName?.toLowerCase().includes(term) ||
        interaction.clientEmail?.toLowerCase().includes(term) ||
        interaction.phoneNumber?.includes(term) ||
        interaction.summary?.toLowerCase().includes(term) ||
        interaction.metadata?.topics?.some(topic => topic.toLowerCase().includes(term))
      )
    }

    return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [interactions, searchTerm])

  const paginatedInteractions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredInteractions.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredInteractions, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredInteractions.length / itemsPerPage)

  // Helper functions
  const formatDuration = useCallback((seconds?: number) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  const getStatusBadge = useCallback((status: string) => {
    const statusMap = {
      ACTIVE: { variant: "default" as const, text: "Active", icon: Clock, color: "text-blue-600" },
      COMPLETED: { variant: "secondary" as const, text: "Completed", icon: CheckCircle, color: "text-green-600" },
      ESCALATED: { variant: "destructive" as const, text: "Escalated", icon: AlertTriangle, color: "text-red-600" },
      ABANDONED: { variant: "outline" as const, text: "Abandoned", icon: XCircle, color: "text-gray-600" },
      FAILED: { variant: "destructive" as const, text: "Failed", icon: XCircle, color: "text-red-600" }
    }
    return statusMap[status as keyof typeof statusMap] || { 
      variant: "outline" as const, 
      text: status, 
      icon: AlertTriangle, 
      color: "text-gray-600" 
    }
  }, [])

  const getSentimentBadge = useCallback((sentiment?: string) => {
    const sentimentMap = {
      positive: { variant: "default" as const, text: "Positive", color: "bg-green-100 text-green-800" },
      neutral: { variant: "secondary" as const, text: "Neutral", color: "bg-gray-100 text-gray-800" },
      negative: { variant: "destructive" as const, text: "Negative", color: "bg-red-100 text-red-800" }
    }
    return sentimentMap[sentiment as keyof typeof sentimentMap] || null
  }, [])

  const getSourceIcon = useCallback((source: string) => {
    const sourceMap = {
      widget: MessageSquare,
      phone: Phone,
      api: Zap,
      whatsapp: MessageCircle,
      email: MessageSquare
    }
    return sourceMap[source as keyof typeof sourceMap] || MessageSquare
  }, [])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    if (isToday(date)) return `Today, ${format(date, 'HH:mm')}`
    if (isYesterday(date)) return `Yesterday, ${format(date, 'HH:mm')}`
    return format(date, 'MMM dd, HH:mm')
  }, [])

  // Load data on mount and when filters change
  useEffect(() => {
    loadInteractions()
  }, [loadInteractions])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadInteractions(true)
    }, 30000)
    return () => clearInterval(interval)
  }, [loadInteractions])

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading interactions...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-purple-600" />
            Interactions
          </h1>
          <p className="text-slate-600 mt-2">
            Enterprise conversation management and analytics
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            onClick={() => loadInteractions(true)}
            disabled={refreshing}
            variant="outline"
            size="sm"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
          
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Analytics Overview */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total</p>
                  <p className="text-2xl font-bold">{analytics.totalInteractions.toLocaleString()}</p>
                </div>
                <Users className="h-8 w-8 text-purple-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
                <span className="text-green-600">{analytics.activeInteractions} active</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Completed</p>
                  <p className="text-2xl font-bold">{analytics.completedInteractions.toLocaleString()}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">
                  {((analytics.completedInteractions / analytics.totalInteractions) * 100).toFixed(1)}% completion rate
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Avg Resolution</p>
                  <p className="text-2xl font-bold">{formatDuration(analytics.averageResolutionTime)}</p>
                </div>
                <Clock3 className="h-8 w-8 text-blue-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">Per conversation</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Satisfaction</p>
                  <p className="text-2xl font-bold">{analytics.customerSatisfaction.toFixed(1)}/5</p>
                </div>
                <ThumbsUp className="h-8 w-8 text-orange-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">Customer rating</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Escalated</p>
                  <p className="text-2xl font-bold">{analytics.escalatedInteractions}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">
                  {((analytics.escalatedInteractions / analytics.totalInteractions) * 100).toFixed(1)}% escalation rate
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Client, topic, summary..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="CHAT">Chat</SelectItem>
                  <SelectItem value="VOICE">Voice</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="ESCALATED">Escalated</SelectItem>
                  <SelectItem value="ABANDONED">Abandoned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="widget">Website Widget</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Sentiment</Label>
              <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sentiments</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Interaction List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Conversations</CardTitle>
              <CardDescription>
                {filteredInteractions.length.toLocaleString()} interactions found
              </CardDescription>
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <span className="text-sm text-slate-600">
                  Page {currentPage} of {totalPages}
                </span>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredInteractions.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No interactions found</h3>
              <p className="text-slate-600 mb-4">
                {searchTerm || typeFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all'
                  ? "Try adjusting your filters to see more results"
                  : "Conversations will appear here once customers start interacting with your agent"
                }
              </p>
              {(searchTerm || typeFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm("")
                    setTypeFilter("all")
                    setStatusFilter("all")
                    setSourceFilter("all")
                    setSentimentFilter("all")
                    setCurrentPage(1)
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedInteractions.map((interaction) => {
                const statusInfo = getStatusBadge(interaction.status)
                const StatusIcon = statusInfo.icon
                const sentiment = getSentimentBadge(interaction.metadata?.sentiment)
                const SourceIcon = getSourceIcon(interaction.source)
                
                return (
                  <div
                    key={interaction.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedInteraction(interaction)}
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      <div className={cn("p-2 rounded-full",
                        interaction.type === 'CHAT' ? 'bg-purple-100' : 'bg-green-100'
                      )}>
                        <SourceIcon className={cn("w-4 h-4",
                          interaction.type === 'CHAT' ? 'text-purple-600' : 'text-green-600'
                        )} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium truncate">
                            {interaction.clientName || interaction.phoneNumber || interaction.clientEmail || 'Anonymous'}
                          </p>
                          <Badge variant="outline" className="text-xs">
                            {interaction.type.toLowerCase()}
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">
                            {interaction.source}
                          </Badge>
                          {interaction.metadata?.escalated && (
                            <Badge variant="destructive" className="text-xs">
                              Escalated
                            </Badge>
                          )}
                          {interaction.metadata?.urgency && interaction.metadata.urgency !== 'low' && (
                            <Badge 
                              variant={interaction.metadata.urgency === 'critical' ? 'destructive' : 'secondary'} 
                              className="text-xs capitalize"
                            >
                              {interaction.metadata.urgency}
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-slate-600 mb-1">
                          <span>{formatDate(interaction.updatedAt)}</span>
                          {interaction.metadata?.duration && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(interaction.metadata.duration)}
                            </span>
                          )}
                          {interaction.metadata?.messageCount && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {interaction.metadata.messageCount} messages
                            </span>
                          )}
                        </div>
                        
                        {interaction.summary && (
                          <p className="text-sm text-slate-600 truncate max-w-[500px]">
                            {interaction.summary}
                          </p>
                        )}
                        
                        {interaction.metadata?.topics && interaction.metadata.topics.length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {interaction.metadata.topics.slice(0, 3).map((topic, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {topic}
                              </Badge>
                            ))}
                            {interaction.metadata.topics.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{interaction.metadata.topics.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      {sentiment && (
                        <Badge className={sentiment.color}>
                          {sentiment.text}
                        </Badge>
                      )}
                      
                      {interaction.metadata?.satisfaction && (
                        <div className="flex items-center gap-1">
                          <ThumbsUp className="h-3 w-3 text-green-600" />
                          <span className="text-xs">{interaction.metadata.satisfaction}/5</span>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-1">
                        <StatusIcon className={cn("h-4 w-4", statusInfo.color)} />
                        <Badge variant={statusInfo.variant} className="text-xs">
                          {statusInfo.text}
                        </Badge>
                      </div>
                      
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Interaction Detail Dialog */}
      <Dialog open={!!selectedInteraction} onOpenChange={(open) => !open && setSelectedInteraction(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Conversation Details
            </DialogTitle>
            <DialogDescription>
              {selectedInteraction && `${selectedInteraction.type.toLowerCase()} conversation ${
                selectedInteraction.clientName ? `with ${selectedInteraction.clientName}` : 
                selectedInteraction.phoneNumber ? `from ${selectedInteraction.phoneNumber}` : ''
              }`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedInteraction && (
            <Tabs defaultValue="conversation" className="h-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              
              <TabsContent value="conversation" className="space-y-4">
                <ScrollArea className="h-[500px] w-full">
                  {selectedInteraction.conversation?.messages ? (
                    <div className="space-y-3 pr-4">
                      {selectedInteraction.conversation.messages.map((message, index) => (
                        <div
                          key={message.id}
                          className={cn(
                            "flex gap-3 p-3 rounded-lg",
                            message.role === 'user' 
                              ? "bg-blue-50 border-l-4 border-blue-500" 
                              : message.role === 'assistant'
                              ? "bg-purple-50 border-l-4 border-purple-500"
                              : "bg-slate-50 border-l-4 border-slate-500"
                          )}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={
                                message.role === 'user' ? 'default' : 
                                message.role === 'assistant' ? 'secondary' : 'outline'
                              }>
                                {message.role === 'user' ? 'Customer' : 
                                 message.role === 'assistant' ? 'AI Agent' : 'System'}
                              </Badge>
                              <span className="text-xs text-slate-500">
                                {new Date(message.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <MessageSquare className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                      <p className="text-slate-600">No conversation history available</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="analytics" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {selectedInteraction.metadata?.sentiment && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Sentiment Analysis</Label>
                      <div className="mt-1">
                        {getSentimentBadge(selectedInteraction.metadata.sentiment) && (
                          <Badge className={getSentimentBadge(selectedInteraction.metadata.sentiment)!.color}>
                            {getSentimentBadge(selectedInteraction.metadata.sentiment)!.text}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {selectedInteraction.metadata?.satisfaction && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Customer Satisfaction</Label>
                      <div className="flex items-center gap-1 mt-1">
                        <ThumbsUp className="h-4 w-4 text-green-600" />
                        <span>{selectedInteraction.metadata.satisfaction}/5 stars</span>
                      </div>
                    </div>
                  )}
                  
                  {selectedInteraction.metadata?.resolutionTime && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Resolution Time</Label>
                      <p className="text-sm mt-1">{formatDuration(selectedInteraction.metadata.resolutionTime)}</p>
                    </div>
                  )}
                  
                  {selectedInteraction.metadata?.aiResponseTime && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Avg AI Response Time</Label>
                      <p className="text-sm mt-1">{selectedInteraction.metadata.aiResponseTime}ms</p>
                    </div>
                  )}
                </div>
                
                {selectedInteraction.metadata?.escalationReason && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Escalation Reason</Label>
                    <p className="text-sm mt-1 p-3 bg-red-50 border border-red-200 rounded-lg">
                      {selectedInteraction.metadata.escalationReason}
                    </p>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Contact Info</Label>
                      <div className="text-sm space-y-1">
                        {selectedInteraction.clientName && <p>Name: {selectedInteraction.clientName}</p>}
                        {selectedInteraction.clientEmail && <p>Email: {selectedInteraction.clientEmail}</p>}
                        {selectedInteraction.phoneNumber && <p>Phone: {selectedInteraction.phoneNumber}</p>}
                      </div>
                    </div>
                    
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Source</Label>
                      <p className="text-sm capitalize">{selectedInteraction.source}</p>
                    </div>
                    
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Status</Label>
                      <Badge variant={getStatusBadge(selectedInteraction.status).variant}>
                        {getStatusBadge(selectedInteraction.status).text}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Started</Label>
                      <p className="text-sm">{new Date(selectedInteraction.createdAt).toLocaleString()}</p>
                    </div>
                    
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Last Activity</Label>
                      <p className="text-sm">{new Date(selectedInteraction.updatedAt).toLocaleString()}</p>
                    </div>
                    
                    {selectedInteraction.endedAt && (
                      <div>
                        <Label className="text-sm font-medium text-slate-600">Ended</Label>
                        <p className="text-sm">{new Date(selectedInteraction.endedAt).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>
                
                {selectedInteraction.summary && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Summary</Label>
                    <p className="text-sm mt-1 p-3 bg-slate-50 rounded-lg">{selectedInteraction.summary}</p>
                  </div>
                )}
                
                {selectedInteraction.metadata?.topics && selectedInteraction.metadata.topics.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Topics Discussed</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedInteraction.metadata.topics.map((topic, index) => (
                        <Badge key={index} variant="secondary">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  )
} 