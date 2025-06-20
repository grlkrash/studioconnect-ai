import { WebSocket } from 'ws'
import { prisma } from './db'
import twilio from 'twilio'
import { OpenAIRealtimeClient } from './openaiRealtimeClient'
import { BulletproofElevenLabsClient } from './elevenlabsStreamingClient'
import { getChatCompletion, getTranscription } from './openai'
import { generateSpeechWithElevenLabs } from './elevenlabs'
import { voiceHealthMonitor } from '../monitor/voiceHealthMonitor'
import { LeadQualifier } from '../core/leadQualifier'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { 
  ENTERPRISE_VOICES, 
  getEnterpriseVoiceSettings, 
  getContextualVoiceSettings,
  getConversationalEnhancements,
  getEnterpriseErrorMessages 
} from '../config/enterpriseDefaults'

/**
 * 🏢 BULLETPROOF ENTERPRISE VOICE AGENT 🏢
 * 
 * Built for Fortune 100/50 companies requiring:
 * - 99.99% reliability
 * - Enterprise-grade audio quality using ElevenLabs best practices
 * - Natural, professional conversations with dynamic voice settings
 * - Project-centric client management
 * - Seamless escalation to human teams
 * 
 * Architecture: Simple, reliable, bulletproof
 */

interface EnterpriseConnectionState {
  // Core Connection
  ws: WebSocket
  callSid: string
  streamSid: string | null
  businessId: string
  
  // Call Details
  fromNumber: string
  toNumber: string
  callStartTime: number
  isActive: boolean
  
  // Conversation State
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }>
  currentIntent: 'greeting' | 'qualification' | 'project_status' | 'escalation' | 'closing'
  
  // Audio Processing
  audioBuffer: Buffer[]
  isRecording: boolean
  isSpeaking: boolean
  lastAudioTimestamp: number
  
  // Lead & Client Management
  clientId: string | null
  leadQualifier: LeadQualifier | null
  qualificationAnswers: Record<string, string>
  projectRequests: string[]
  
  // Enterprise Features - OPTIMIZED FOR ELEVENLABS
  personaPrompt: string
    voiceSettings: {
    voiceId: string
    stability: number
    similarity_boost: number
    style: number
    use_speaker_boost: boolean
    speed: number
  }
  
  // Reliability
  healthChecks: {
    lastPing: number
    audioProcessing: boolean
    ttsWorking: boolean
    sttWorking: boolean
  }
}

export class BulletproofEnterpriseVoiceAgent extends EventEmitter {
  private static instance: BulletproofEnterpriseVoiceAgent
  private connections: Map<string, EnterpriseConnectionState> = new Map()
  private twilioClient: twilio.Twilio
  private conversationalEnhancements = getConversationalEnhancements()
  private errorMessages = getEnterpriseErrorMessages()
  
  private constructor() {
    super()
    this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    this.startHealthMonitoring()
  }
  
  public static getInstance(): BulletproofEnterpriseVoiceAgent {
    if (!BulletproofEnterpriseVoiceAgent.instance) {
      BulletproofEnterpriseVoiceAgent.instance = new BulletproofEnterpriseVoiceAgent()
    }
    return BulletproofEnterpriseVoiceAgent.instance
  }
  
  /**
   * 🚀 ENTERPRISE CALL INITIATION
   * Bulletproof connection setup for Fortune 100/50 standards
   */
  public async handleNewCall(ws: WebSocket, params: URLSearchParams): Promise<void> {
    const callSid = params.get('callSid')
    const fromNumber = params.get('from')
    const toNumber = params.get('to')
    
    if (!callSid || !fromNumber || !toNumber) {
      console.error('[🏢 ENTERPRISE AGENT] Missing required call parameters')
      ws.close(1008, 'Invalid call parameters')
      return
    }
    
    console.log(`[🏢 ENTERPRISE AGENT] 🚀 Initiating Fortune 100 quality call: ${callSid}`)
    
    try {
      // Load business configuration
      const business = await this.loadBusinessConfig(toNumber)
      if (!business) {
        console.error('[🏢 ENTERPRISE AGENT] No business configuration found')
        ws.close(1008, 'Business not configured')
        return
      }
      
      // Check if this is an existing client first
      const existingClient = await this.identifyExistingClient(fromNumber, business.id)
      
      // 🎯 ENHANCED VOICE SELECTION BASED ON BUSINESS PREFERENCE 🎯
      let selectedVoice = business.agentConfig?.elevenlabsVoice || ENTERPRISE_VOICES.jessica
      
      // If no custom voice set, intelligently select based on client type
      if (!business.agentConfig?.elevenlabsVoice) {
        if (existingClient) {
          // Use empathetic Jessica for existing clients
          selectedVoice = ENTERPRISE_VOICES.jessica
        } else {
          // Use bright, uplifting Hope for new leads
          selectedVoice = ENTERPRISE_VOICES.hope
        }
      }
      
      console.log(`[🏢 ENTERPRISE AGENT] 🎙️ Selected premium voice: ${selectedVoice}`)
      
      // Initialize enterprise connection state with optimized settings
      const state: EnterpriseConnectionState = {
      ws,
      callSid,
      streamSid: null,
        businessId: business.id,
        fromNumber,
        toNumber,
        callStartTime: Date.now(),
        isActive: true,
        conversationHistory: [],
        currentIntent: existingClient ? 'project_status' : 'greeting',
        audioBuffer: [],
      isRecording: false,
      isSpeaking: false,
        lastAudioTimestamp: Date.now(),
        clientId: existingClient?.id || null,
        leadQualifier: null,
        qualificationAnswers: {},
        projectRequests: [],
        personaPrompt: business.agentConfig?.personaPrompt || this.getDefaultPersonaPrompt(),
        voiceSettings: {
          voiceId: selectedVoice,
          ...getContextualVoiceSettings('greeting') // Start with greeting-optimized settings
        },
        healthChecks: {
          lastPing: Date.now(),
          audioProcessing: true,
          ttsWorking: true,
          sttWorking: true
        }
      }
      
      this.connections.set(callSid, state)
      
      // Setup bulletproof WebSocket handling
      this.setupEnterpriseWebSocketHandlers(state)
      
      // Initialize lead qualification if needed
      if (business.planTier === 'ENTERPRISE' && !existingClient) {
        // Load lead questions from database
        const leadQuestions = await prisma.leadCaptureQuestion.findMany({
          where: { 
            config: { businessId: business.id }
          },
          orderBy: { order: 'asc' }
        })
        
        // Transform to LeadQuestion format
        const questions = leadQuestions.map(q => ({
          id: q.id,
          order: q.order,
          questionText: q.questionText,
          isRequired: q.isRequired,
          mapsToLeadField: q.mapsToLeadField || undefined
        }))
        
        state.leadQualifier = new LeadQualifier(questions)
      }
      
      if (existingClient) {
        console.log(`[🏢 ENTERPRISE AGENT] 🎯 Existing client identified: ${existingClient.name}`)
      }
      
      console.log(`[🏢 ENTERPRISE AGENT] ✅ Enterprise call initialized successfully`)
      
      } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Failed to initialize call:', error)
      ws.close(1011, 'Initialization failed')
    }
  }
  
  /**
   * 🎯 BULLETPROOF WEBSOCKET HANDLERS
   * Enterprise-grade reliability with comprehensive error handling
   */
  private setupEnterpriseWebSocketHandlers(state: EnterpriseConnectionState): void {
    const { ws, callSid } = state
    
    // Handle incoming Twilio media streams
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        
        switch (message.event) {
          case 'start':
            await this.handleCallStart(state, message)
            break
          case 'media':
            await this.handleAudioData(state, message)
            break
          case 'stop':
            await this.handleCallEnd(state, message)
            break
          default:
            // Ignore unknown events
            break
        }
      } catch (error) {
        console.error(`[🏢 ENTERPRISE AGENT] WebSocket message error:`, error)
      }
    })
    
    // Handle connection issues
    ws.on('close', (code: number, reason: string) => {
      console.log(`[🏢 ENTERPRISE AGENT] Call ended: ${callSid} (${code}: ${reason})`)
      this.cleanupCall(callSid)
    })
    
    ws.on('error', (error: Error) => {
      console.error(`[🏢 ENTERPRISE AGENT] WebSocket error for ${callSid}:`, error)
      this.cleanupCall(callSid)
    })
  }
  
  /**
   * 🚀 CALL START - BULLETPROOF WELCOME MESSAGE
   * Delivers enterprise-grade welcome message with 99.99% reliability
   */
  private async handleCallStart(state: EnterpriseConnectionState, message: any): Promise<void> {
    state.streamSid = message.start.streamSid
    console.log(`[🏢 ENTERPRISE AGENT] 🎬 Call started - Stream ID: ${state.streamSid}`)
    
    // Deliver bulletproof welcome message
    const welcomeMessage = await this.generateWelcomeMessage(state)
    await this.deliverEnterpriseMessage(state, welcomeMessage)
    
    // Start listening for client response
    this.startListening(state)
  }
  
  /**
   * 🎙️ AUDIO PROCESSING - BULLETPROOF PIPELINE
   * Enterprise-grade audio processing with zero tolerance for failure
   */
  private async handleAudioData(state: EnterpriseConnectionState, message: any): Promise<void> {
    if (!message.media || !message.media.payload) return
    
    // Skip processing if agent is speaking
    if (state.isSpeaking) return
    
    // Convert base64 audio to buffer
    const audioChunk = Buffer.from(message.media.payload, 'base64')
    state.audioBuffer.push(audioChunk)
    state.lastAudioTimestamp = Date.now()
    
    // Process audio in chunks for optimal performance
    if (state.audioBuffer.length >= 20) { // ~400ms of audio
      const audioData = Buffer.concat(state.audioBuffer)
      state.audioBuffer = []
      
      // Process with bulletproof transcription
      await this.processAudioChunk(state, audioData)
    }
  }

  /**
   * 🎯 BULLETPROOF AUDIO PROCESSING
   * Converts audio to text with enterprise-grade reliability
   */
  private async processAudioChunk(state: EnterpriseConnectionState, audioData: Buffer): Promise<void> {
    try {
      // Convert μ-law to WAV for transcription
      const wavPath = await this.convertToWav(audioData)
      
      // Get transcription with bulletproof error handling
      const transcript = await getTranscription(wavPath, true)
      
      if (transcript && transcript.trim().length > 3) {
        console.log(`[🏢 ENTERPRISE AGENT] 🎙️ Client: "${transcript}"`)
        
        // Process the conversation
        await this.processClientMessage(state, transcript)
      }

    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Audio processing error:', error)
      state.healthChecks.audioProcessing = false
    }
  }
  
  /**
   * 🧠 CONVERSATION PROCESSING
   * Handles client messages with enterprise-grade intelligence
   */
  private async processClientMessage(state: EnterpriseConnectionState, message: string): Promise<void> {
    // Add to conversation history
    state.conversationHistory.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    })
    
    // Determine intent and generate response
    const response = await this.generateIntelligentResponse(state, message)
    
    if (response) {
      // Add to conversation history
      state.conversationHistory.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      })
      
      // Deliver response with enterprise TTS
      await this.deliverEnterpriseMessage(state, response)
    }
  }
  
  /**
   * 🧠 INTELLIGENT RESPONSE GENERATION
   * Fortune 100 quality conversational AI with enhanced natural flow
   */
  private async generateIntelligentResponse(state: EnterpriseConnectionState, message: string): Promise<string | null> {
    try {
      // 🎯 DYNAMIC VOICE SETTINGS BASED ON CONVERSATION CONTEXT 🎯
      this.updateVoiceSettingsForContext(state, message)
      
      const systemPrompt = this.buildEnterpriseSystemPrompt(state)
      const conversationContext = this.buildConversationContext(state)
      
      const response = await getChatCompletion(
        [
          { role: 'system', content: systemPrompt },
          ...conversationContext,
          { role: 'user', content: message }
        ],
        'gpt-4o'
      )
      
      if (response) {
        // 🎯 ENHANCE RESPONSE WITH CONVERSATIONAL FLOW 🎯
        return this.enhanceResponseWithConversationalFlow(response, state, message)
      }
      
      return null
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Response generation error:', error)
      return "I apologize for the technical difficulty. Let me transfer you to one of our team members immediately."
    }
  }
  
  /**
   * 🎯 DYNAMIC VOICE SETTINGS BASED ON CONVERSATION CONTEXT 🎯
   */
  private updateVoiceSettingsForContext(state: EnterpriseConnectionState, message: string): void {
    const lowerMessage = message.toLowerCase()
    
    // Detect conversation context and adjust voice settings accordingly
    if (lowerMessage.includes('urgent') || lowerMessage.includes('emergency') || lowerMessage.includes('asap')) {
      // Use escalation settings for urgent matters
      const escalationSettings = getContextualVoiceSettings('escalation')
      state.voiceSettings = { ...state.voiceSettings, ...escalationSettings }
      console.log('[🏢 ENTERPRISE AGENT] 🚨 Switched to escalation voice settings for urgent matter')
    } else if (lowerMessage.includes('project') || lowerMessage.includes('status') || lowerMessage.includes('timeline')) {
      // Use business settings for project discussions
      const businessSettings = getContextualVoiceSettings('business')
      state.voiceSettings = { ...state.voiceSettings, ...businessSettings }
      console.log('[🏢 ENTERPRISE AGENT] 💼 Switched to business voice settings for project discussion')
    } else if (lowerMessage.includes('technical') || lowerMessage.includes('specification') || lowerMessage.includes('development')) {
      // Use technical settings for detailed explanations
      const technicalSettings = getContextualVoiceSettings('technical')
      state.voiceSettings = { ...state.voiceSettings, ...technicalSettings }
      console.log('[🏢 ENTERPRISE AGENT] 🔧 Switched to technical voice settings for detailed explanation')
    }
  }
  
  /**
   * 🎯 ENHANCED CONVERSATIONAL FLOW WITH NATURAL TRANSITIONS 🎯
   */
  private enhanceResponseWithConversationalFlow(response: string, state: EnterpriseConnectionState, userMessage: string): string {
    const lowerMessage = userMessage.toLowerCase()
    
    // Add natural acknowledgments for user responses
    if (this.isUserProvidingInformation(lowerMessage)) {
      const acknowledgment = this.getRandomElement(this.conversationalEnhancements.acknowledgments)
      return `${acknowledgment} ${response}`
    }
    
    // Add smooth transitions for helpful responses
    if (this.isUserRequestingHelp(lowerMessage)) {
      const transition = this.getRandomElement(this.conversationalEnhancements.transitions)
      return `${transition} ${response}`
    }
    
    // Add professional escalation language when needed
    if (this.shouldEscalate(lowerMessage, response)) {
      const escalation = this.getRandomElement(this.conversationalEnhancements.escalations)
      return escalation
    }
    
    return response
  }
  
  /**
   * 🎯 CONVERSATION ANALYSIS HELPERS 🎯
   */
  private isUserProvidingInformation(message: string): boolean {
    const infoIndicators = ['my', 'our', 'we', 'i', 'project', 'company', 'business', 'name', 'email', 'phone']
    return infoIndicators.some(indicator => message.includes(indicator))
  }
  
  private isUserRequestingHelp(message: string): boolean {
    const helpIndicators = ['can you', 'could you', 'would you', 'help', 'assist', 'support', 'need', 'want', 'looking for']
    return helpIndicators.some(indicator => message.includes(indicator))
  }
  
  private shouldEscalate(userMessage: string, agentResponse: string): boolean {
    const escalationTriggers = [
      'speak to someone', 'talk to human', 'human agent', 'representative', 
      'manager', 'supervisor', 'not helpful', 'frustrated', 'angry',
      'complex project', 'detailed discussion', 'pricing', 'contract'
    ]
    
    return escalationTriggers.some(trigger => 
      userMessage.includes(trigger) || agentResponse.includes('transfer') || agentResponse.includes('connect')
    )
  }
  
  private getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)]
  }
  
  /**
   * 🎵 ENTERPRISE TTS DELIVERY
   * Bulletproof text-to-speech with ElevenLabs premium quality
   */
  private async deliverEnterpriseMessage(state: EnterpriseConnectionState, text: string): Promise<void> {
    try {
      state.isSpeaking = true
      
      console.log(`[🏢 ENTERPRISE AGENT] 🎵 Delivering: "${text}"`)
      
      // Generate premium TTS with ElevenLabs
      const audioPath = await generateSpeechWithElevenLabs(
        text,
        state.voiceSettings.voiceId,
        'eleven_turbo_v2_5',
        {
          stability: state.voiceSettings.stability,
          similarity_boost: state.voiceSettings.similarity_boost,
          style: state.voiceSettings.style,
          use_speaker_boost: state.voiceSettings.use_speaker_boost,
          speed: state.voiceSettings.speed
        }
      )
      
      if (audioPath) {
        // Convert to μ-law and stream to Twilio
        await this.streamAudioToTwilio(state, audioPath)
      } else {
        throw new Error('TTS generation failed')
      }
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] TTS delivery error:', error)
      state.healthChecks.ttsWorking = false
    } finally {
      state.isSpeaking = false
    }
  }
  
  /**
   * 🎵 STREAM AUDIO TO TWILIO
   * Bulletproof audio streaming with enterprise quality
   */
  private async streamAudioToTwilio(state: EnterpriseConnectionState, audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert MP3 to μ-law using FFmpeg
      const ffmpeg = spawn('ffmpeg', [
        '-i', audioPath,
        '-ar', '8000',
        '-ac', '1',
        '-f', 'mulaw',
        '-'
      ])
      
      let audioData = Buffer.alloc(0)
      
      ffmpeg.stdout.on('data', (chunk) => {
        audioData = Buffer.concat([audioData, chunk])
      })
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          // Stream in chunks to Twilio
          const chunkSize = 320 // 20ms chunks
          for (let i = 0; i < audioData.length; i += chunkSize) {
            const chunk = audioData.slice(i, i + chunkSize)
            const base64Chunk = chunk.toString('base64')
            
            state.ws.send(JSON.stringify({
              event: 'media',
            streamSid: state.streamSid,
              media: {
                payload: base64Chunk
              }
            }))
          }
          
          // Clean up temp file
          fs.unlink(audioPath, () => {})
          resolve()
              } else {
          reject(new Error(`FFmpeg failed with code ${code}`))
        }
      })
      
      ffmpeg.on('error', reject)
    })
  }
  
  /**
   * 🎯 SYSTEM PROMPT BUILDER
   * Creates enterprise-grade conversation prompts
   */
  private buildEnterpriseSystemPrompt(state: EnterpriseConnectionState): string {
    const business = this.getBusinessName(state.businessId)
    const isExistingClient = state.clientId !== null
    
    return `You are a professional AI Account Manager for ${business}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

YOUR ROLE:
${isExistingClient ? 
  '- Provide project status updates and timeline information\n- Address client concerns and questions professionally\n- Coordinate with the team for complex requests\n- Maintain strong client relationships' :
  '- Qualify new leads professionally\n- Gather project requirements and timeline\n- Schedule consultations with the team\n- Provide information about our services'
}

CONVERSATION GUIDELINES:
- Keep responses concise and to the point (2-3 sentences max)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Use natural, conversational language
- Maintain professional tone throughout

ESCALATION TRIGGERS:
- Complex project discussions requiring creative input
- Pricing negotiations or contract discussions
- Emergency or urgent project issues
- Client dissatisfaction or complaints

${state.personaPrompt ? `\nADDITIONAL CONTEXT:\n${state.personaPrompt}` : ''}

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect that premium standard.`
  }
  
  /**
   * 🎯 CONVERSATION CONTEXT BUILDER
   */
  private buildConversationContext(state: EnterpriseConnectionState): Array<{role: 'user' | 'assistant', content: string}> {
    return state.conversationHistory.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  }
  
  /**
   * 🎯 ENHANCED WELCOME MESSAGE GENERATOR WITH PREMIUM VOICE DELIVERY
   */
  private async generateWelcomeMessage(state: EnterpriseConnectionState): Promise<string> {
    const business = await this.getBusinessDetails(state.businessId)
    const isExistingClient = state.clientId !== null
    
    // Use contextual voice settings for the greeting
    const greetingSettings = getContextualVoiceSettings('greeting')
    state.voiceSettings = { ...state.voiceSettings, ...greetingSettings }
    
    if (isExistingClient) {
      const client = await this.getClientDetails(state.clientId!)
      const clientName = client?.name ? client.name.split(' ')[0] : 'there' // Use first name for warmth
      return `Hello ${clientName}! Thank you for calling ${business?.name || 'us'}. I'm here to help with your projects and any questions you might have. What can I assist you with today?`
    } else {
      // For new callers, use bright and professional greeting
      return `Hello! Thank you for calling ${business?.name || 'us'}. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?`
    }
  }
  
  /**
   * 🎯 UTILITY METHODS
   */
  private async convertToWav(audioData: Buffer): Promise<string> {
    const tempPath = `/tmp/audio_${Date.now()}.wav`
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', '-',
        '-ar', '16000',
        '-ac', '1',
        tempPath
      ])
      
      ffmpeg.stdin.write(audioData)
      ffmpeg.stdin.end()
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(tempPath)
        } else {
          reject(new Error(`FFmpeg conversion failed with code ${code}`))
        }
      })
      
      ffmpeg.on('error', reject)
    })
  }
  
  private async loadBusinessConfig(toNumber: string): Promise<any> {
    return await prisma.business.findFirst({
      where: { twilioPhoneNumber: toNumber },
      include: {
        agentConfig: true
      }
    })
  }
  
  private async identifyExistingClient(fromNumber: string, businessId: string): Promise<any> {
    return await prisma.client.findFirst({
      where: { 
        phone: fromNumber,
        businessId: businessId
      },
      select: {
        id: true,
        name: true,
        email: true
      }
    })
  }
  
  private getBusinessName(businessId: string): string {
    // This should be cached or looked up
    return "Your Agency" // Placeholder
  }
  
  private async getBusinessDetails(businessId: string): Promise<any> {
    return await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true }
    })
  }
  
  private async getClientDetails(clientId: string): Promise<any> {
    return await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, email: true }
    })
  }
  
  private getDefaultPersonaPrompt(): string {
    return "You are a professional, knowledgeable, and friendly AI assistant representing a premium creative agency."
  }
  
  private startListening(state: EnterpriseConnectionState): void {
    state.isRecording = true
    console.log(`[🏢 ENTERPRISE AGENT] 🎙️ Listening for client response...`)
  }
  
  private async handleCallEnd(state: EnterpriseConnectionState, message: any): Promise<void> {
    console.log(`[🏢 ENTERPRISE AGENT] 📞 Call ending: ${state.callSid}`)
    await this.cleanupCall(state.callSid)
  }
  
  private async cleanupCall(callSid: string): Promise<void> {
    const state = this.connections.get(callSid)
    if (!state) return
    
    console.log(`[🏢 ENTERPRISE AGENT] 🧹 Cleaning up call: ${callSid}`)
    
    // Calculate call duration
    const duration = Date.now() - state.callStartTime
    
    // Create a conversation first
    let conversationId: string
    try {
      const conversation = await prisma.conversation.create({
        data: {
          businessId: state.businessId,
          sessionId: `call_${callSid}`,
          messages: JSON.stringify(state.conversationHistory),
          clientId: state.clientId,
          phoneNumber: state.fromNumber,
          endedAt: new Date()
        }
      })
      conversationId = conversation.id
        } catch (error) {
      console.error('Failed to create conversation:', error)
          return
        }

    // Save call log with proper fields
    try {
      await prisma.callLog.create({
        data: {
          callSid: callSid,
          businessId: state.businessId,
          conversationId: conversationId,
          from: state.fromNumber,
          to: state.toNumber,
          source: 'enterprise_voice_agent',
          type: 'VOICE',
          direction: 'INBOUND',
          status: duration > 10000 ? 'COMPLETED' : 'FAILED',
          content: state.conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n'),
          metadata: {
            duration: Math.floor(duration / 1000),
            clientId: state.clientId,
            agentType: 'enterprise'
          }
        }
      })
    } catch (error) {
      console.error('Failed to save call log:', error)
    }
    
    // Send notification email if configured
    await this.sendCallSummaryEmail(state)
    
    // Remove from active connections
    this.connections.delete(callSid)
    
    console.log(`[🏢 ENTERPRISE AGENT] ✅ Call cleanup completed: ${callSid}`)
  }
  
  private async sendCallSummaryEmail(state: EnterpriseConnectionState): Promise<void> {
    try {
      const business = await prisma.business.findUnique({
        where: { id: state.businessId },
        select: { 
          name: true, 
          notificationEmails: true 
        }
      })
      
      if (business?.notificationEmails?.length) {
        const { sendCallSummaryEmail } = await import('./notificationService')
        await sendCallSummaryEmail(business.notificationEmails, {
          businessName: business.name,
          caller: state.fromNumber,
          callee: state.toNumber,
          durationSec: Math.floor((Date.now() - state.callStartTime) / 1000),
          transcript: state.conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')
        })
      }
    } catch (error) {
      console.error('Failed to send call summary email:', error)
    }
  }
  
  private startHealthMonitoring(): void {
    setInterval(() => {
      this.performHealthChecks()
    }, 30000) // Every 30 seconds
  }
  
  private performHealthChecks(): void {
    const activeConnections = this.connections.size
    console.log(`[🏢 ENTERPRISE AGENT] 💓 Health Check: ${activeConnections} active calls`)
    
    // Check for stale connections
    const now = Date.now()
    for (const [callSid, state] of this.connections.entries()) {
      if (now - state.lastAudioTimestamp > 300000) { // 5 minutes
        console.log(`[🏢 ENTERPRISE AGENT] 🧹 Cleaning up stale connection: ${callSid}`)
        this.cleanupCall(callSid)
      }
    }
  }
  
  // Public methods for external access
  public getActiveConnections(): number {
    return this.connections.size
  }
  
  public getConnectionStatus(): string {
    const connections = Array.from(this.connections.values())
    const healthy = connections.filter(c => c.healthChecks.audioProcessing && c.healthChecks.ttsWorking).length
    return `${healthy}/${connections.length} connections healthy`
  }
}

// Export singleton instance
export const bulletproofEnterpriseAgent = BulletproofEnterpriseVoiceAgent.getInstance()
export default bulletproofEnterpriseAgent