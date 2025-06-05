import RedisManager from '../config/redis'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  intent?: string
  confidence?: number
  entities?: ExtractedEntities
}

export interface ExtractedEntities {
  names?: string[]
  emails?: string[]
  phoneNumbers?: string[]
  dates?: string[]
  locations?: string[]
  companies?: string[]
  amounts?: string[]
  custom?: Record<string, any>
}

export interface AIIntent {
  intent: string
  confidence: number
  timestamp: number
  turnIndex: number // Which conversation turn this was identified in
  context?: string // Additional context for the intent
}

export interface DetailedFlowState {
  primaryFlow: string | null // e.g., "lead_capture", "faq", "support"
  subFlow: string | null // e.g., "asking_name", "asking_email", "awaiting_clarification"
  flowData: Record<string, any> // Flow-specific data storage
  completedSteps: string[] // Track what steps have been completed
  nextExpectedInputs: string[] // What the AI expects next
  flowStartTime: number
  lastFlowUpdate: number
}

export interface SessionMetadata {
  businessId?: string
  callerNumber?: string
  twilioCallSid?: string
  callStartTime: number
  lastActivityTime: number
  totalMessages: number
  averageResponseTime?: number
  voiceSettings?: {
    voice: string
    language: string
  }
}

export interface VoiceSession {
  // Enhanced conversation history
  history: ConversationMessage[]
  
  // Intent tracking
  identifiedIntents: AIIntent[]
  
  // Entity extraction results
  extractedEntities: ExtractedEntities
  
  // Enhanced flow management
  currentFlow: string | null // Keep for backwards compatibility
  detailedFlow: DetailedFlowState
  
  // Session metadata
  metadata: SessionMetadata
  
  // Legacy timestamps (keep for compatibility)
  createdAt: number
  lastActivity: number
}

class VoiceSessionService {
  private static instance: VoiceSessionService
  private readonly SESSION_PREFIX = 'voice_session:'
  private readonly DEFAULT_EXPIRATION = 7200 // 2 hours in seconds
  private readonly fallbackSessions = new Map<string, VoiceSession>() // In-memory fallback
  
  // Enhanced in-memory session bounds and cleanup configuration
  private readonly MAX_FALLBACK_SESSIONS = 100 // Max number of fallback sessions to keep in memory
  private readonly FALLBACK_SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes for inactive fallback sessions

  private constructor() {}

  static getInstance(): VoiceSessionService {
    if (!VoiceSessionService.instance) {
      VoiceSessionService.instance = new VoiceSessionService()
    }
    return VoiceSessionService.instance
  }

  private getSessionKey(callSid: string): string {
    return `${this.SESSION_PREFIX}${callSid}`
  }

  private createEmptySession(): VoiceSession {
    const now = Date.now()
    return {
      history: [],
      currentFlow: null,
      identifiedIntents: [],
      extractedEntities: {},
      detailedFlow: {
        primaryFlow: null,
        subFlow: null,
        flowData: {},
        completedSteps: [],
        nextExpectedInputs: [],
        flowStartTime: now,
        lastFlowUpdate: now
      },
      metadata: {
        callStartTime: now,
        lastActivityTime: now,
        totalMessages: 0
      },
      createdAt: now,
      lastActivity: now
    }
  }

  async getVoiceSession(callSid: string): Promise<VoiceSession> {
    try {
      const redisManager = RedisManager.getInstance()
      
      if (redisManager.isClientConnected()) {
        const client = redisManager.getClient()
        const sessionKey = this.getSessionKey(callSid)
        const sessionData = await client.get(sessionKey)
        
        if (sessionData) {
          const session = JSON.parse(sessionData) as VoiceSession
          // Update last activity
          session.lastActivity = Date.now()
          await this.updateVoiceSession(callSid, session.history, session.currentFlow)
          console.log(`[Voice Session] Retrieved Redis session for CallSid: ${callSid}`)
          return session
        }
      }
    } catch (error) {
      console.error('[Voice Session] Error retrieving from Redis:', error)
    }

    // Fallback to in-memory or create new session
    if (this.fallbackSessions.has(callSid)) {
      const session = this.fallbackSessions.get(callSid)!
      session.lastActivity = Date.now()
      console.log(`[Voice Session] Retrieved fallback session for CallSid: ${callSid}`)
      return session
    }

    // Create new session
    const newSession = this.createEmptySession()
    this.fallbackSessions.set(callSid, newSession)
    console.log(`[Voice Session] Created new session for CallSid: ${callSid}`)
    return newSession
  }

  async updateVoiceSession(
    callSid: string, 
    history: Array<{ role: string; content: string }>, 
    currentFlow: string | null
  ): Promise<void> {
    const existingSession = await this.getVoiceSession(callSid)
    
    // Convert legacy history to enhanced format
    const enhancedHistory: ConversationMessage[] = history.map((msg, index) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      timestamp: existingSession.history[index]?.timestamp || Date.now()
    }))
    
    await this.updateEnhancedSession(callSid, {
      ...existingSession,
      history: enhancedHistory,
      currentFlow,
      lastActivity: Date.now(),
      metadata: {
        ...existingSession.metadata,
        lastActivityTime: Date.now(),
        totalMessages: enhancedHistory.length
      }
    })
  }

  async updateEnhancedSession(callSid: string, session: Partial<VoiceSession>): Promise<void> {
    const existingSession = await this.getVoiceSession(callSid)
    
    const updatedSession: VoiceSession = {
      ...existingSession,
      ...session,
      lastActivity: Date.now(),
      metadata: {
        ...existingSession.metadata,
        ...session.metadata,
        lastActivityTime: Date.now(),
        totalMessages: session.history?.length || existingSession.history.length
      }
    }

    try {
      const redisManager = RedisManager.getInstance()
      
      if (redisManager.isClientConnected()) {
        const client = redisManager.getClient()
        const sessionKey = this.getSessionKey(callSid)
        
        await client.setEx(
          sessionKey, 
          this.DEFAULT_EXPIRATION, 
          JSON.stringify(updatedSession)
        )
        
        console.log(`[Voice Session] Updated enhanced Redis session for CallSid: ${callSid}`)
        
        // Remove from fallback if successfully saved to Redis
        if (this.fallbackSessions.has(callSid)) {
          this.fallbackSessions.delete(callSid)
        }
        return
      }
    } catch (error) {
      console.error('[Voice Session] Error updating enhanced Redis:', error)
    }

    // Fallback to in-memory storage
    this.fallbackSessions.set(callSid, updatedSession)
    console.log(`[Voice Session] Updated enhanced fallback session for CallSid: ${callSid}`)
  }

  async clearVoiceSession(callSid: string): Promise<void> {
    try {
      const redisManager = RedisManager.getInstance()
      
      if (redisManager.isClientConnected()) {
        const client = redisManager.getClient()
        const sessionKey = this.getSessionKey(callSid)
        
        const deleted = await client.del(sessionKey)
        if (deleted > 0) {
          console.log(`[Voice Session] Cleared Redis session for CallSid: ${callSid}`)
        }
      }
    } catch (error) {
      console.error('[Voice Session] Error clearing from Redis:', error)
    }

    // Also clear from fallback
    if (this.fallbackSessions.has(callSid)) {
      this.fallbackSessions.delete(callSid)
      console.log(`[Voice Session] Cleared fallback session for CallSid: ${callSid}`)
    }
  }

  async getAllActiveSessions(): Promise<string[]> {
    const activeSessions: string[] = []
    
    try {
      const redisManager = RedisManager.getInstance()
      
      if (redisManager.isClientConnected()) {
        const client = redisManager.getClient()
        const keys = await client.keys(`${this.SESSION_PREFIX}*`)
        
        activeSessions.push(...keys.map(key => key.replace(this.SESSION_PREFIX, '')))
      }
    } catch (error) {
      console.error('[Voice Session] Error getting active sessions from Redis:', error)
    }

    // Add fallback sessions
    activeSessions.push(...Array.from(this.fallbackSessions.keys()))
    
    return [...new Set(activeSessions)] // Remove duplicates
  }

  async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now()
    let cleanedCount = 0
    
    // First pass: Remove sessions that exceed timeout
    for (const [callSid, session] of this.fallbackSessions.entries()) {
      if (now - session.lastActivity > this.FALLBACK_SESSION_TIMEOUT_MS) {
        this.fallbackSessions.delete(callSid)
        cleanedCount++
        console.log(`[Voice Session Service] Cleaned up expired fallback session: ${callSid}`)
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[Voice Session Service] Cleaned up ${cleanedCount} expired fallback sessions.`)
    }
    
    // Second pass: If map still exceeds max size after cleaning old ones, remove oldest to enforce hard limit
    if (this.fallbackSessions.size > this.MAX_FALLBACK_SESSIONS) {
      const sessionsArray = Array.from(this.fallbackSessions.entries())
      sessionsArray.sort((a, b) => a[1].lastActivity - b[1].lastActivity) // Sort by oldest
      let removedToFit = 0
      
      while (this.fallbackSessions.size > this.MAX_FALLBACK_SESSIONS && sessionsArray.length > 0) {
        const oldestSession = sessionsArray.shift()
        if (oldestSession) {
          this.fallbackSessions.delete(oldestSession[0])
          removedToFit++
        }
      }
      
      if (removedToFit > 0) {
        console.log(`[Voice Session Service] Removed ${removedToFit} oldest fallback sessions to enforce MAX_FALLBACK_SESSIONS limit.`)
      }
    }
    
    console.log(`[Voice Session Service] Current fallback session count: ${this.fallbackSessions.size}`)
    
    // Redis handles expiration automatically, but we can log active sessions
    try {
      const activeSessions = await this.getAllActiveSessions()
      console.log(`[Voice Session Service] Total active sessions count: ${activeSessions.length}`)
    } catch (error) {
      console.error('[Voice Session Service] Error during cleanup:', error)
    }
  }

  // Get session statistics
  async getSessionStats(): Promise<{
    activeRedisSessions: number
    activeFallbackSessions: number
    totalActiveSessions: number
  }> {
    let activeRedisSessionsCount = 0
    
    try {
      const redisManager = RedisManager.getInstance()
      
      if (redisManager.isClientConnected()) {
        const client = redisManager.getClient()
        const keys = await client.keys(`${this.SESSION_PREFIX}*`)
        activeRedisSessionsCount = keys.length
      }
    } catch (error) {
      console.error('[Voice Session] Error getting Redis session stats:', error)
    }

    const activeFallbackSessionsCount = this.fallbackSessions.size
    
    return {
      activeRedisSessions: activeRedisSessionsCount,
      activeFallbackSessions: activeFallbackSessionsCount,
      totalActiveSessions: activeRedisSessionsCount + activeFallbackSessionsCount
    }
  }

  // Add a new conversation message with optional intent and entities
  async addConversationMessage(
    callSid: string,
    role: 'user' | 'assistant',
    content: string,
    options: {
      intent?: string
      confidence?: number
      entities?: ExtractedEntities
    } = {}
  ): Promise<void> {
    const session = await this.getVoiceSession(callSid)
    
    const newMessage: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
      intent: options.intent,
      confidence: options.confidence,
      entities: options.entities
    }
    
    const updatedHistory = [...session.history, newMessage]
    
    await this.updateEnhancedSession(callSid, {
      history: updatedHistory
    })
  }

  // Add or update intent information
  async addIntent(
    callSid: string,
    intent: string,
    confidence: number,
    context?: string
  ): Promise<void> {
    const session = await this.getVoiceSession(callSid)
    
    const newIntent: AIIntent = {
      intent,
      confidence,
      timestamp: Date.now(),
      turnIndex: session.history.length,
      context
    }
    
    const updatedIntents = [...session.identifiedIntents, newIntent]
    
    await this.updateEnhancedSession(callSid, {
      identifiedIntents: updatedIntents
    })
  }

  // Update extracted entities
  async updateEntities(
    callSid: string,
    entities: Partial<ExtractedEntities>
  ): Promise<void> {
    const session = await this.getVoiceSession(callSid)
    
    const mergedEntities: ExtractedEntities = {
      ...session.extractedEntities,
      ...entities,
      // Merge arrays instead of replacing them
      names: [...(session.extractedEntities.names || []), ...(entities.names || [])],
      emails: [...(session.extractedEntities.emails || []), ...(entities.emails || [])],
      phoneNumbers: [...(session.extractedEntities.phoneNumbers || []), ...(entities.phoneNumbers || [])],
      dates: [...(session.extractedEntities.dates || []), ...(entities.dates || [])],
      locations: [...(session.extractedEntities.locations || []), ...(entities.locations || [])],
      companies: [...(session.extractedEntities.companies || []), ...(entities.companies || [])],
      amounts: [...(session.extractedEntities.amounts || []), ...(entities.amounts || [])],
      custom: { ...session.extractedEntities.custom, ...entities.custom }
    }
    
    await this.updateEnhancedSession(callSid, {
      extractedEntities: mergedEntities
    })
  }

  // Update detailed flow state
  async updateDetailedFlow(
    callSid: string,
    flowUpdate: Partial<DetailedFlowState>
  ): Promise<void> {
    const session = await this.getVoiceSession(callSid)
    
    const updatedDetailedFlow: DetailedFlowState = {
      ...session.detailedFlow,
      ...flowUpdate,
      lastFlowUpdate: Date.now()
    }
    
    // Update legacy currentFlow for backwards compatibility
    const currentFlow = updatedDetailedFlow.primaryFlow
    
    await this.updateEnhancedSession(callSid, {
      detailedFlow: updatedDetailedFlow,
      currentFlow
    })
  }

  // Update session metadata
  async updateMetadata(
    callSid: string,
    metadata: Partial<SessionMetadata>
  ): Promise<void> {
    const session = await this.getVoiceSession(callSid)
    
    await this.updateEnhancedSession(callSid, {
      metadata: {
        ...session.metadata,
        ...metadata
      }
    })
  }

  // Get session analytics/insights
  async getSessionAnalytics(callSid: string): Promise<{
    conversationLength: number
    uniqueIntents: string[]
    mostConfidentIntent?: AIIntent
    extractedEntityCount: number
    flowProgression: string[]
    callDuration: number
  }> {
    const session = await this.getVoiceSession(callSid)
    
    const uniqueIntents = [...new Set(session.identifiedIntents.map(i => i.intent))]
    const mostConfidentIntent = session.identifiedIntents.reduce((max, current) => 
      current.confidence > (max?.confidence || 0) ? current : max, 
      session.identifiedIntents[0]
    )
    
    const entityCount = Object.values(session.extractedEntities)
      .reduce((count, entityArray) => count + (Array.isArray(entityArray) ? entityArray.length : 0), 0)
    
    const flowProgression = session.detailedFlow.completedSteps
    const callDuration = Date.now() - session.metadata.callStartTime
    
    return {
      conversationLength: session.history.length,
      uniqueIntents,
      mostConfidentIntent,
      extractedEntityCount: entityCount,
      flowProgression,
      callDuration
    }
  }
}

export default VoiceSessionService 