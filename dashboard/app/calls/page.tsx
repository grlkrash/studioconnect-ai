"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { 
  Phone, 
  Clock, 
  User, 
  Calendar as CalendarIcon, 
  ExternalLink, 
  Search, 
  Filter,
  Download,
  Play,
  Pause,
  Volume2,
  FileText,
  BarChart3,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Eye,
  MoreHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react"
import { useBusiness } from "@/context/business-context"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { BusinessGuard } from "@/components/business-guard"
import { cn } from "@/lib/utils"
import { format, isToday, isYesterday, subDays, startOfDay, endOfDay } from "date-fns"

interface CallLog {
  id: string
  callSid: string
  from: string
  to: string
  direction: 'INBOUND' | 'OUTBOUND'
  status: 'INITIATED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'CANCELED'
  type: 'VOICE' | 'CHAT'
  createdAt: string
  updatedAt: string
  content?: string
  metadata?: {
    duration?: number
    transcript?: string
    aiResponse?: string
    escalated?: boolean
    recordingUrl?: string
    sentiment?: 'positive' | 'neutral' | 'negative'
    summary?: string
    keyTopics?: string[]
    customerSatisfaction?: number
  }
  conversation?: {
    id: string
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      timestamp: string
    }>
  }
}

interface CallAnalytics {
  totalCalls: number
  completedCalls: number
  failedCalls: number
  averageDuration: number
  successRate: number
  todayCalls: number
  escalationRate: number
  averageSentiment: number
  topTopics: Array<{ topic: string; count: number }>
  hourlyDistribution: Array<{ hour: number; count: number }>
}

export default function CallsPage() {
  const { businessId } = useBusiness()
  const { toast } = useToast()
  
  // State
  const [calls, setCalls] = useState<CallLog[]>([])
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null)
  const [audioPlaying, setAudioPlaying] = useState<string | null>(null)
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dateRange, setDateRange] = useState<{ from: Date | null; to: Date | null }>({
    from: subDays(new Date(), 7),
    to: new Date()
  })
  const [directionFilter, setDirectionFilter] = useState<string>("all")
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)

  // Load calls data
  const loadCalls = useCallback(async (showRefreshing = false) => {
    if (!businessId) return
    
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    
    try {
      const params = new URLSearchParams({
        businessId,
        ...(dateRange.from && { from: dateRange.from.toISOString() }),
        ...(dateRange.to && { to: dateRange.to.toISOString() }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(directionFilter !== 'all' && { direction: directionFilter }),
        ...(searchTerm && { search: searchTerm }),
        limit: (itemsPerPage * 10).toString() // Load extra for better UX
      })

      const [callsRes, analyticsRes] = await Promise.all([
        fetch(`/admin/api/calls?${params}`, { credentials: 'include' }),
        fetch(`/admin/api/analytics/calls?${params}`, { credentials: 'include' })
      ])

      if (callsRes.ok) {
        const callsData = await callsRes.json()
        setCalls(callsData.calls || [])
      } else {
        throw new Error('Failed to fetch calls')
      }

      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json()
        setAnalytics(analyticsData.analytics || null)
      }

      console.log('✅ Call data loaded successfully')
      
    } catch (error) {
      console.error('❌ Failed to load calls:', error)
      toast({
        title: "Load Failed",
        description: "Unable to load call data. Please try again.",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [businessId, dateRange, statusFilter, directionFilter, searchTerm, itemsPerPage, toast])

  // Filter and paginate calls
  const filteredCalls = useMemo(() => {
    let filtered = calls

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(call => 
        call.from.toLowerCase().includes(term) ||
        call.to.toLowerCase().includes(term) ||
        call.metadata?.summary?.toLowerCase().includes(term) ||
        call.metadata?.keyTopics?.some(topic => topic.toLowerCase().includes(term))
      )
    }

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [calls, searchTerm])

  const paginatedCalls = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredCalls.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredCalls, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredCalls.length / itemsPerPage)

  // Helper functions
  const formatDuration = useCallback((seconds: number) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  const getStatusBadge = useCallback((status: string) => {
    const statusMap = {
      COMPLETED: { variant: "default" as const, text: "Completed", icon: CheckCircle, color: "text-green-600" },
      FAILED: { variant: "destructive" as const, text: "Failed", icon: XCircle, color: "text-red-600" },
      BUSY: { variant: "secondary" as const, text: "Busy", icon: AlertCircle, color: "text-yellow-600" },
      NO_ANSWER: { variant: "outline" as const, text: "No Answer", icon: AlertCircle, color: "text-gray-600" },
      CANCELED: { variant: "secondary" as const, text: "Cancelled", icon: XCircle, color: "text-gray-600" },
      IN_PROGRESS: { variant: "default" as const, text: "In Progress", icon: Clock, color: "text-blue-600" },
      RINGING: { variant: "outline" as const, text: "Ringing", icon: Clock, color: "text-blue-600" },
      INITIATED: { variant: "outline" as const, text: "Initiated", icon: Clock, color: "text-gray-600" }
    }
    return statusMap[status as keyof typeof statusMap] || { 
      variant: "outline" as const, 
      text: status, 
      icon: AlertCircle, 
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

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    if (isToday(date)) return `Today, ${format(date, 'HH:mm')}`
    if (isYesterday(date)) return `Yesterday, ${format(date, 'HH:mm')}`
    return format(date, 'MMM dd, HH:mm')
  }, [])

  // Load data on mount and when filters change
  useEffect(() => {
    loadCalls()
  }, [loadCalls])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadCalls(true)
    }, 30000)
    return () => clearInterval(interval)
  }, [loadCalls])

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading call history...</p>
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
            <Phone className="h-8 w-8 text-blue-600" />
            Call History
          </h1>
          <p className="text-slate-600 mt-2">
            Enterprise-grade call analytics and conversation management
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            onClick={() => loadCalls(true)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Calls</p>
                  <p className="text-2xl font-bold">{analytics.totalCalls.toLocaleString()}</p>
                </div>
                <Phone className="h-8 w-8 text-blue-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
                <span className="text-green-600">{analytics.todayCalls} today</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Success Rate</p>
                  <p className="text-2xl font-bold">{analytics.successRate.toFixed(1)}%</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">
                  {analytics.completedCalls} / {analytics.totalCalls} completed
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Avg Duration</p>
                  <p className="text-2xl font-bold">{formatDuration(analytics.averageDuration)}</p>
                </div>
                <Clock className="h-8 w-8 text-purple-600" />
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
                  <p className="text-2xl font-bold">{analytics.averageSentiment.toFixed(1)}/5</p>
                </div>
                <BarChart3 className="h-8 w-8 text-orange-600" />
              </div>
              <div className="mt-2 flex items-center text-sm">
                <span className="text-slate-600">Average rating</span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Phone number, topic, summary..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="BUSY">Busy</SelectItem>
                  <SelectItem value="NO_ANSWER">No Answer</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={directionFilter} onValueChange={setDirectionFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Directions</SelectItem>
                  <SelectItem value="INBOUND">Inbound</SelectItem>
                  <SelectItem value="OUTBOUND">Outbound</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date Range</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd")}
                        </>
                      ) : (
                        format(dateRange.from, "MMM dd, yyyy")
                      )
                    ) : (
                      "Pick a date range"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange.from || new Date()}
                    selected={{ from: dateRange.from || undefined, to: dateRange.to || undefined }}
                    onSelect={(range) => setDateRange({ from: range?.from || null, to: range?.to || null })}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Call List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Call Log</CardTitle>
              <CardDescription>
                {filteredCalls.length.toLocaleString()} calls found
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
          {filteredCalls.length === 0 ? (
            <div className="text-center py-12">
              <Phone className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No calls found</h3>
              <p className="text-slate-600 mb-4">
                {searchTerm || statusFilter !== 'all' || directionFilter !== 'all'
                  ? "Try adjusting your filters to see more results"
                  : "Voice calls will appear here once your agent starts receiving calls"
                }
              </p>
              {(searchTerm || statusFilter !== 'all' || directionFilter !== 'all') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm("")
                    setStatusFilter("all")
                    setDirectionFilter("all")
                    setCurrentPage(1)
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedCalls.map((call) => {
                const statusInfo = getStatusBadge(call.status)
                const StatusIcon = statusInfo.icon
                const sentiment = getSentimentBadge(call.metadata?.sentiment)
                
                return (
                  <div
                    key={call.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedCall(call)}
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      <div className={cn("p-2 rounded-full", 
                        call.direction === 'INBOUND' ? 'bg-green-100' : 'bg-blue-100'
                      )}>
                        <Phone className={cn("w-4 h-4",
                          call.direction === 'INBOUND' ? 'text-green-600' : 'text-blue-600'
                        )} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium truncate">
                            {call.direction === 'INBOUND' ? call.from : call.to}
                          </p>
                          <Badge variant="outline" className="text-xs">
                            {call.direction.toLowerCase()}
                          </Badge>
                          {call.metadata?.escalated && (
                            <Badge variant="destructive" className="text-xs">
                              Escalated
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-slate-600">
                          <span>{formatDate(call.createdAt)}</span>
                          {call.metadata?.duration && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(call.metadata.duration)}
                            </span>
                          )}
                          {call.metadata?.summary && (
                            <span className="truncate max-w-[300px]">
                              {call.metadata.summary}
                            </span>
                          )}
                        </div>
                        
                        {call.metadata?.keyTopics && call.metadata.keyTopics.length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {call.metadata.keyTopics.slice(0, 3).map((topic, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {topic}
                              </Badge>
                            ))}
                            {call.metadata.keyTopics.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{call.metadata.keyTopics.length - 3}
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

      {/* Call Detail Dialog */}
      <Dialog open={!!selectedCall} onOpenChange={(open) => !open && setSelectedCall(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Call Details
            </DialogTitle>
            <DialogDescription>
              {selectedCall && `${selectedCall.direction.toLowerCase()} call with ${
                selectedCall.direction === 'INBOUND' ? selectedCall.from : selectedCall.to
              }`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedCall && (
            <Tabs defaultValue="overview" className="h-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
              </TabsList>
              
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Phone Number</Label>
                      <p className="text-sm">{selectedCall.direction === 'INBOUND' ? selectedCall.from : selectedCall.to}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Direction</Label>
                      <p className="text-sm capitalize">{selectedCall.direction.toLowerCase()}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Status</Label>
                      <Badge variant={getStatusBadge(selectedCall.status).variant}>
                        {getStatusBadge(selectedCall.status).text}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Started</Label>
                      <p className="text-sm">{new Date(selectedCall.createdAt).toLocaleString()}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Duration</Label>
                      <p className="text-sm">{selectedCall.metadata?.duration ? formatDuration(selectedCall.metadata.duration) : 'N/A'}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Call SID</Label>
                      <p className="text-xs font-mono text-slate-500">{selectedCall.callSid}</p>
                    </div>
                  </div>
                </div>
                
                {selectedCall.metadata?.summary && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Summary</Label>
                    <p className="text-sm mt-1 p-3 bg-slate-50 rounded-lg">{selectedCall.metadata.summary}</p>
                  </div>
                )}
                
                {selectedCall.metadata?.keyTopics && selectedCall.metadata.keyTopics.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Key Topics</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedCall.metadata.keyTopics.map((topic, index) => (
                        <Badge key={index} variant="secondary">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="transcript" className="space-y-4">
                <ScrollArea className="h-[400px] w-full">
                  {selectedCall.conversation?.messages ? (
                    <div className="space-y-3 pr-4">
                      {selectedCall.conversation.messages.map((message, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex gap-3 p-3 rounded-lg",
                            message.role === 'user' 
                              ? "bg-blue-50 border-l-4 border-blue-500" 
                              : "bg-slate-50 border-l-4 border-slate-500"
                          )}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={message.role === 'user' ? 'default' : 'secondary'}>
                                {message.role === 'user' ? 'Customer' : 'AI Agent'}
                              </Badge>
                              <span className="text-xs text-slate-500">
                                {new Date(message.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm">{message.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                      <p className="text-slate-600">No transcript available</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="analytics" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {selectedCall.metadata?.sentiment && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Sentiment</Label>
                      <div className="mt-1">
                        {getSentimentBadge(selectedCall.metadata.sentiment) && (
                          <Badge className={getSentimentBadge(selectedCall.metadata.sentiment)!.color}>
                            {getSentimentBadge(selectedCall.metadata.sentiment)!.text}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {selectedCall.metadata?.customerSatisfaction && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Customer Satisfaction</Label>
                      <p className="text-sm mt-1">{selectedCall.metadata.customerSatisfaction}/5 stars</p>
                    </div>
                  )}
                  
                  {selectedCall.metadata?.escalated && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Escalation</Label>
                      <Badge variant="destructive">Escalated to Human</Badge>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  )
} 