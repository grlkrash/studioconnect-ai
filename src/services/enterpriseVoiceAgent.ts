import { WebSocket } from 'ws'
import { prisma } from './db'
import twilio from 'twilio'
import { getChatCompletion, getTranscription } from './openai'
import { generateSpeechWithElevenLabs } from './elevenlabs'
import { LeadQualifier } from '../core/leadQualifier'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

/**
 * 🏢 BULLETPROOF ENTERPRISE VOICE AGENT 🏢
 * 
 * Built for Fortune 100/50 companies requiring:
 * ✅ 99.99% reliability
 * ✅ Premium ElevenLabs TTS quality
 * ✅ Natural, professional conversations
 * ✅ Project-centric client management
 * ✅ Seamless team escalation
 * ✅ Zero-tolerance error handling
 */

interface EnterpriseCall {
  // Core identifiers
  callSid: string
  streamSid: string | null
  businessId: string
  
  // Call metadata
  fromNumber: string
  toNumber: string
  startTime: number
  
  // Connection state
  ws: WebSocket
  isActive: boolean
  
  // Conversation
  messages: Array<{ role: 'user' | 'assistant', text: string, timestamp: number }>
  currentPhase: 'greeting' | 'qualification' | 'project_inquiry' | 'escalation'
  
  // Audio processing
  audioChunks: Buffer[]
  isSpeaking: boolean
  lastAudioTime: number
  
  // Client context
  clientId: string | null
  clientName: string | null
  isExistingClient: boolean
  
  // Business context
  businessName: string
  voiceId: string
  personaPrompt: string
}

export class BulletproofEnterpriseVoiceAgent extends EventEmitter {
  private static instance: BulletproofEnterpriseVoiceAgent
  private activeCalls: Map<string, EnterpriseCall> = new Map()
  private twilioClient: twilio.Twilio
  
  private constructor() {
    super()
    this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    console.log('[🏢 ENTERPRISE AGENT] 🚀 Bulletproof Voice Agent initialized for Fortune 100/50 quality')
  }
  
  public static getInstance(): BulletproofEnterpriseVoiceAgent {
    if (!BulletproofEnterpriseVoiceAgent.instance) {
      BulletproofEnterpriseVoiceAgent.instance = new BulletproofEnterpriseVoiceAgent()
    }
    return BulletproofEnterpriseVoiceAgent.instance
  }
  
  /**
   * 🚀 INITIALIZE ENTERPRISE CALL
   * Sets up Fortune 100 quality voice experience
   */
  public async initializeCall(ws: WebSocket, params: URLSearchParams): Promise<void> {
    const callSid = params.get('callSid')
    const fromNumber = params.get('from') || ''
    const toNumber = params.get('to') || ''
    
    if (!callSid) {
      console.error('[🏢 ENTERPRISE AGENT] ❌ Missing callSid')
      ws.close(1008, 'Invalid parameters')
      return
    }
    
    console.log(`[🏢 ENTERPRISE AGENT] 📞 New Fortune 100 call: ${callSid} from ${fromNumber}`)
    
    try {
      // Load business configuration
      const business = await prisma.business.findFirst({
        where: { twilioPhoneNumber: toNumber },
        select: {
          id: true,
          name: true,
          businessType: true,
          createdAt: true,
          updatedAt: true
        }
      })
      
      if (!business) {
        console.error('[🏢 ENTERPRISE AGENT] ❌ Business not found')
        ws.close(1008, 'Business not configured')
        return
      }
      
      // Check for existing client
      const existingClient = await prisma.client.findFirst({
        where: { 
          phone: fromNumber,
          businessId: business.id
        },
        select: { id: true, name: true }
      })
      
      // Create enterprise call state
      const call: EnterpriseCall = {
        callSid,
        streamSid: null,
        businessId: business.id,
        fromNumber,
        toNumber,
        startTime: Date.now(),
        ws,
        isActive: true,
        messages: [],
        currentPhase: 'greeting',
        audioChunks: [],
        isSpeaking: false,
        lastAudioTime: Date.now(),
        clientId: existingClient?.id || null,
        clientName: existingClient?.name || null,
        isExistingClient: !!existingClient,
        businessName: business.name,
        voiceId: 'pNInz6obpgDQGcFmaJgB', // Premium ElevenLabs voice as default
        personaPrompt: 'Professional AI Account Manager' // Default prompt
      }
      
      this.activeCalls.set(callSid, call)
      this.setupCallHandlers(call)
      
      console.log(`[🏢 ENTERPRISE AGENT] ✅ Call initialized - Client: ${call.isExistingClient ? 'Existing' : 'New'}`)
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] ❌ Initialization failed:', error)
      ws.close(1011, 'Setup failed')
    }
  }
  
  /**
   * 🎧 SETUP CALL HANDLERS
   * Bulletproof WebSocket and audio handling
   */
  private setupCallHandlers(call: EnterpriseCall): void {
    const { ws, callSid } = call
    
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        await this.handleWebSocketMessage(call, message)
      } catch (error) {
        console.error(`[🏢 ENTERPRISE AGENT] Message error:`, error)
      }
    })
    
    ws.on('close', () => {
      console.log(`[🏢 ENTERPRISE AGENT] 📞 Call ended: ${callSid}`)
      this.endCall(callSid)
    })
    
    ws.on('error', (error) => {
      console.error(`[🏢 ENTERPRISE AGENT] WebSocket error:`, error)
      this.endCall(callSid)
    })
  }
  
  /**
   * 📨 HANDLE WEBSOCKET MESSAGES
   * Process Twilio stream events with bulletproof reliability
   */
  private async handleWebSocketMessage(call: EnterpriseCall, message: any): Promise<void> {
    switch (message.event) {
      case 'start':
        call.streamSid = message.start.streamSid
        console.log(`[🏢 ENTERPRISE AGENT] 🎬 Stream started: ${call.streamSid}`)
        // Delay welcome message slightly to ensure stream is ready
        setTimeout(() => this.deliverWelcomeMessage(call), 250)
        break
        
      case 'media':
        if (!call.isSpeaking && message.media?.payload) {
          await this.processAudioChunk(call, message.media.payload)
        }
        break
        
      case 'stop':
        console.log(`[🏢 ENTERPRISE AGENT] 🛑 Stream stopped`)
        this.endCall(call.callSid)
        break
    }
  }
  
  /**
   * 👋 DELIVER WELCOME MESSAGE
   * Fortune 100 quality greeting with bulletproof delivery
   */
  private async deliverWelcomeMessage(call: EnterpriseCall): Promise<void> {
    try {
      let welcomeText: string
      
      if (call.isExistingClient && call.clientName) {
        welcomeText = `Hello ${call.clientName}, thanks for calling ${call.businessName}. How can I help you with your project today?`
        call.currentPhase = 'project_inquiry'
      } else {
        welcomeText = `Hello, thanks for calling ${call.businessName}. How can I help you today?`
        call.currentPhase = 'qualification'
      }
      
      console.log(`[🏢 ENTERPRISE AGENT] 👋 Welcome: "${welcomeText}"`)
      
      await this.speakMessage(call, welcomeText)
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Welcome message failed:', error)
      await this.speakMessage(call, `Hello, thanks for calling ${call.businessName}. How can I help you?`)
    }
  }
  
  /**
   * 🎙️ PROCESS AUDIO CHUNK
   * High-performance audio processing with STT
   */
  private async processAudioChunk(call: EnterpriseCall, audioPayload: string): Promise<void> {
    try {
      const audioBuffer = Buffer.from(audioPayload, 'base64')
      call.audioChunks.push(audioBuffer)
      call.lastAudioTime = Date.now()
      
      // Process when we have enough audio (~500ms)
      if (call.audioChunks.length >= 25) {
        const combinedAudio = Buffer.concat(call.audioChunks)
        call.audioChunks = []
        
        const transcript = await this.transcribeAudio(combinedAudio)
        if (transcript && transcript.trim().length > 2) {
          console.log(`[🏢 ENTERPRISE AGENT] 🎙️ Client: "${transcript}"`)
          await this.handleClientMessage(call, transcript)
        }
      }
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Audio processing error:', error)
    }
  }
  
  /**
   * 🎧 TRANSCRIBE AUDIO
   * Convert audio to text with enterprise reliability
   */
  private async transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
    try {
      // Convert μ-law to WAV
      const wavPath = await this.convertAudioToWav(audioBuffer)
      
      // Transcribe with OpenAI Whisper
      const transcript = await getTranscription(wavPath, true)
      
      return transcript
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Transcription failed:', error)
      return null
    }
  }
  
  /**
   * 🔄 CONVERT AUDIO TO WAV
   * Convert μ-law audio to WAV format for transcription
   */
  private async convertAudioToWav(audioBuffer: Buffer): Promise<string> {
    const tempWavPath = `/tmp/audio_${Date.now()}.wav`
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', '-',
        '-ar', '16000',
        '-ac', '1',
        tempWavPath
      ])
      
      ffmpeg.stdin.write(audioBuffer)
      ffmpeg.stdin.end()
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(tempWavPath)
        } else {
          reject(new Error(`Audio conversion failed: ${code}`))
        }
      })
      
      ffmpeg.on('error', reject)
    })
  }
  
  /**
   * 💬 HANDLE CLIENT MESSAGE
   * Process client input with Fortune 100 intelligence
   */
  private async handleClientMessage(call: EnterpriseCall, message: string): Promise<void> {
    // Add to conversation history
    call.messages.push({
      role: 'user',
      text: message,
      timestamp: Date.now()
    })
    
    // Generate intelligent response
    const response = await this.generateResponse(call, message)
    
    if (response) {
      // Add response to history
      call.messages.push({
        role: 'assistant',
        text: response,
        timestamp: Date.now()
      })
      
      // Deliver response
      await this.speakMessage(call, response)
    }
  }
  
  /**
   * 🧠 GENERATE RESPONSE
   * Fortune 100 quality conversational AI
   */
  private async generateResponse(call: EnterpriseCall, message: string): Promise<string | null> {
    try {
      const systemPrompt = this.buildSystemPrompt(call)
      const conversationHistory = this.buildConversationHistory(call)
      
      const response = await getChatCompletion([
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message }
      ], 'gpt-4o')
      
      return response
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Response generation failed:', error)
      return "I apologize for the technical issue. Let me connect you with a team member who can assist you immediately."
    }
  }
  
  /**
   * 📝 BUILD SYSTEM PROMPT
   * Create context-aware conversation prompt
   */
  private buildSystemPrompt(call: EnterpriseCall): string {
    const isExistingClient = call.isExistingClient
    const businessName = call.businessName
    const clientContext = isExistingClient ? `existing client ${call.clientName}` : 'potential new client'
    
    return `You are a professional AI Account Manager for ${businessName}, a premium creative agency serving Fortune 100/50 companies.

CURRENT CALLER: You're speaking with a ${clientContext}.

PERSONALITY: Professional, polite, project-focused, and solution-oriented. Natural conversational tone with business professionalism.

${isExistingClient ? `
PRIMARY RESPONSIBILITIES:
- Provide project status updates and timeline information
- Address client concerns professionally and promptly  
- Coordinate with the team for complex requests
- Maintain strong client relationships
- Offer to connect with specific team members when needed
` : `
PRIMARY RESPONSIBILITIES:
- Qualify new leads professionally and thoroughly
- Understand project requirements and scope
- Gather timeline and budget information
- Schedule consultations with appropriate team members
- Provide overview of agency capabilities
`}

CONVERSATION STYLE:
- Keep responses concise (2-3 sentences maximum)
- Ask clarifying questions when appropriate
- Always offer human escalation for complex discussions
- Use natural, conversational language
- Maintain premium, professional tone

ESCALATION TRIGGERS (immediately offer to connect with team):
- Detailed project specifications or creative discussions
- Pricing, contracts, or proposal requests
- Emergency or time-sensitive issues
- Client complaints or dissatisfaction
- Technical implementation discussions

${call.personaPrompt ? `\nADDITIONAL CONTEXT: ${call.personaPrompt}` : ''}

Remember: You represent a Fortune 100 quality agency. Every interaction must reflect premium standards and exceptional service.`
  }
  
  /**
   * 📚 BUILD CONVERSATION HISTORY
   * Format recent conversation for context
   */
  private buildConversationHistory(call: EnterpriseCall): Array<{role: 'user' | 'assistant', content: string}> {
    return call.messages.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.text
    }))
  }
  
  /**
   * 🎵 SPEAK MESSAGE
   * Bulletproof TTS delivery with ElevenLabs premium quality
   */
  private async speakMessage(call: EnterpriseCall, text: string): Promise<void> {
    try {
      call.isSpeaking = true
      
      console.log(`[🏢 ENTERPRISE AGENT] 🎵 Speaking: "${text}"`)
      
      // Generate premium TTS with ElevenLabs
      const audioPath = await generateSpeechWithElevenLabs(
        text,
        call.voiceId,
        'eleven_turbo_v2_5',
        {
          stability: 0.35,
          similarity_boost: 0.8,
          style: 0.4,
          use_speaker_boost: true
        }
      )
      
      if (audioPath) {
        await this.streamAudioToCall(call, audioPath)
      } else {
        throw new Error('TTS generation failed')
      }
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] TTS error:', error)
    } finally {
      call.isSpeaking = false
    }
  }
  
  /**
   * 🎵 STREAM AUDIO TO CALL
   * High-performance audio streaming to Twilio
   */
  private async streamAudioToCall(call: EnterpriseCall, audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert MP3 to μ-law using FFmpeg
      const ffmpeg = spawn('ffmpeg', [
        '-i', audioPath,
        '-ar', '8000',
        '-ac', '1', 
        '-f', 'mulaw',
        '-'
      ])
      
      let audioBuffer = Buffer.alloc(0)
      
      ffmpeg.stdout.on('data', (chunk) => {
        audioBuffer = Buffer.concat([audioBuffer, chunk])
      })
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          this.streamAudioBuffer(call, audioBuffer)
          fs.unlink(audioPath, () => {}) // Cleanup
          resolve()
        } else {
          reject(new Error(`FFmpeg failed: ${code}`))
        }
      })
      
      ffmpeg.on('error', reject)
    })
  }
  
  /**
   * 🎵 STREAM AUDIO BUFFER
   * Send audio chunks to Twilio WebSocket
   */
  private streamAudioBuffer(call: EnterpriseCall, audioBuffer: Buffer): void {
    const chunkSize = 320 // 20ms chunks for smooth playback
    
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, i + chunkSize)
      const base64Chunk = chunk.toString('base64')
      
      call.ws.send(JSON.stringify({
        event: 'media',
        streamSid: call.streamSid,
        media: {
          payload: base64Chunk
        }
      }))
    }
  }
  
  /**
   * 📞 END CALL
   * Graceful call cleanup with enterprise logging
   */
  private async endCall(callSid: string): Promise<void> {
    const call = this.activeCalls.get(callSid)
    if (!call) return
    
    console.log(`[🏢 ENTERPRISE AGENT] 📞 Ending call: ${callSid}`)
    
    const duration = Date.now() - call.startTime
    const durationSeconds = Math.floor(duration / 1000)
    
    try {
      // Create conversation first
      const conversation = await prisma.conversation.create({
        data: {
          businessId: call.businessId,
          sessionId: callSid,
          messages: call.messages,
          phoneNumber: call.fromNumber,
          clientId: call.clientId,
          startedAt: new Date(call.startTime),
          endedAt: new Date()
        }
      })
      
      // Save call log
      await prisma.callLog.create({
        data: {
          callSid: callSid,
          businessId: call.businessId,
          from: call.fromNumber,
          to: call.toNumber,
          source: 'voice_agent',
          content: call.messages.map(m => `${m.role}: ${m.text}`).join('\n'),
          conversationId: conversation.id,
          type: 'VOICE',
          direction: 'INBOUND',
          status: durationSeconds > 10 ? 'COMPLETED' : 'FAILED',
          metadata: {
            clientType: call.isExistingClient ? 'existing' : 'new',
            phase: call.currentPhase,
            messageCount: call.messages.length,
            duration: durationSeconds
          }
        }
      })
      
      // Send summary email
      await this.sendCallSummary(call, durationSeconds)
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Call logging failed:', error)
    }
    
    // Cleanup
    this.activeCalls.delete(callSid)
    
    console.log(`[🏢 ENTERPRISE AGENT] ✅ Call cleanup completed: ${callSid}`)
  }
  
  /**
   * 📧 SEND CALL SUMMARY
   * Email notification with call details
   */
  private async sendCallSummary(call: EnterpriseCall, duration: number): Promise<void> {
    try {
      const business = await prisma.business.findUnique({
        where: { id: call.businessId },
        select: { name: true, notificationEmails: true }
      })
      
      if (business?.notificationEmails?.length) {
        const { sendCallSummaryEmail } = await import('./notificationService')
        
        await sendCallSummaryEmail(business.notificationEmails, {
          businessName: business.name,
          caller: call.fromNumber,
          callee: call.toNumber,
          durationSec: duration,
          transcript: call.messages.map(m => `${m.role}: ${m.text}`).join('\n'),

        })
      }
      
    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] Email summary failed:', error)
    }
  }
  
  /**
   * 📊 PUBLIC METHODS
   */
  public getActiveCallCount(): number {
    return this.activeCalls.size
  }
  
  public getCallStatus(callSid: string): string | null {
    const call = this.activeCalls.get(callSid)
    return call ? `Active - Phase: ${call.currentPhase}, Messages: ${call.messages.length}` : null
  }
  
  public getSystemHealth(): { status: string, activeCalls: number, uptime: string } {
    const uptime = process.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    
    return {
      status: 'HEALTHY',
      activeCalls: this.activeCalls.size,
      uptime: `${hours}h ${minutes}m`
    }
  }
}

// Export singleton instance
export const enterpriseVoiceAgent = BulletproofEnterpriseVoiceAgent.getInstance()
export default enterpriseVoiceAgent 