/**
 * 🎯 ELEVENLABS CONVERSATIONAL AI AGENT - OFFICIAL IMPLEMENTATION 🎯
 * 
 * Following ElevenLabs official documentation for Conversational AI
 * https://elevenlabs.io/docs/conversational-ai/overview
 * 
 * This replaces our custom voice pipeline with ElevenLabs' native solution
 */

import axios from 'axios'
import { WebSocket } from 'ws'
import { EventEmitter } from 'events'
import { prisma } from './db'

// ElevenLabs Conversational AI Configuration
interface ElevenLabsAgentConfig {
  agent_id: string
  first_message?: string
  system_prompt?: string
  voice_id?: string
  voice_settings?: {
    stability?: number
    similarity_boost?: number
    style?: number
    use_speaker_boost?: boolean
    speed?: number
  }
}

interface ConversationSession {
  conversation_id: string
  agent_id: string
  business_id: string
  client_id?: string
  call_sid: string
  from_number: string
  to_number: string
  websocket?: WebSocket
  start_time: Date
  status: 'active' | 'ended' | 'failed'
}

export class ElevenLabsConversationalAgent extends EventEmitter {
  private apiKey: string
  private baseUrl: string = 'https://api.elevenlabs.io/v1'
  private activeSessions: Map<string, ConversationSession> = new Map()

  constructor() {
    super()
    this.apiKey = process.env.ELEVENLABS_API_KEY!
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY is required')
    }
  }

  /**
   * 🚀 CREATE ELEVENLABS CONVERSATIONAL AI AGENT
   * Following official documentation for agent creation
   */
  async createAgent(businessId: string, config: {
    name: string
    description: string
    instructions: string
    first_message: string
    voice_id: string
    voice_settings?: any
    knowledge_base?: string[]
  }): Promise<string> {
    try {
      console.log('[🎯 ELEVENLABS AGENT] Creating Conversational AI agent...')
      
      const agentConfig = {
        conversation_config: {
          agent: {
            prompt: {
              prompt: config.instructions,
              first_message: config.first_message,
              language: "en"
            },
            llm: {
              model: "gemini-2.0-flash-exp", // Latest recommended model
              temperature: 0.7,
              max_tokens: 2048
            },
            voice: {
              voice_id: config.voice_id,
              voice_settings: {
                stability: config.voice_settings?.stability || 0.45,
                similarity_boost: config.voice_settings?.similarity_boost || 0.85,
                style: config.voice_settings?.style || 0.30,
                use_speaker_boost: config.voice_settings?.use_speaker_boost || true,
                speed: config.voice_settings?.speed || 1.0
              },
              output_format: "ulaw_8000" // Twilio-compatible format
            },
            conversation: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.4,
                prefix_padding_ms: 300,
                silence_duration_ms: 1200
              }
            }
          }
        },
        name: config.name,
        description: config.description
      }

      const response = await axios.post(
        `${this.baseUrl}/convai/agents`,
        agentConfig,
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      )

      const agentId = response.data.agent_id
      console.log(`[🎯 ELEVENLABS AGENT] ✅ Agent created: ${agentId}`)
      
      // Store agent configuration in database
      await this.saveAgentConfig(businessId, agentId, config)
      
      return agentId
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Failed to create agent:', error)
      throw error
    }
  }

  /**
   * 🎯 HANDLE TWILIO WEBHOOK FOR CONVERSATIONAL AI
   * Following ElevenLabs Twilio integration documentation
   */
  async handleTwilioWebhook(req: any, res: any): Promise<void> {
    try {
      const { CallSid, From, To } = req.body
      
      console.log(`[🎯 ELEVENLABS AGENT] 📞 Incoming call: ${CallSid}`)
      
      // Load business configuration
      const business = await this.loadBusinessConfig(To)
      if (!business || !business.agentConfig?.elevenlabsAgentId) {
        console.error('[🎯 ELEVENLABS AGENT] ❌ No agent configured for business')
        res.status(404).send('Agent not configured')
        return
      }

      // Check for existing client
      const existingClient = await this.identifyExistingClient(From, business.id)
      
      // Create conversation session
      const session: ConversationSession = {
        conversation_id: '', // Will be set by ElevenLabs
        agent_id: business.agentConfig.elevenlabsAgentId,
        business_id: business.id,
        client_id: existingClient?.id,
        call_sid: CallSid,
        from_number: From,
        to_number: To,
        start_time: new Date(),
        status: 'active'
      }

      this.activeSessions.set(CallSid, session)

      // Generate TwiML response to connect to ElevenLabs
      const twimlResponse = this.generateTwiMLForElevenLabs(session)
      
      res.type('text/xml')
      res.send(twimlResponse)
      
      console.log(`[🎯 ELEVENLABS AGENT] ✅ Call connected to ElevenLabs agent`)
      
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Webhook error:', error)
      res.status(500).send('Internal server error')
    }
  }

  /**
   * 🎯 GENERATE TWIML FOR ELEVENLABS INTEGRATION
   * Following official Twilio integration docs
   */
  private generateTwiMLForElevenLabs(session: ConversationSession): string {
    const websocketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${session.agent_id}`
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${websocketUrl}">
            <Parameter name="CallSid" value="${session.call_sid}" />
            <Parameter name="From" value="${session.from_number}" />
            <Parameter name="To" value="${session.to_number}" />
            <Parameter name="BusinessId" value="${session.business_id}" />
            <Parameter name="ClientId" value="${session.client_id || ''}" />
        </Stream>
    </Connect>
</Response>`
  }

  /**
   * 🎯 CUSTOMIZE AGENT FOR SPECIFIC CALL
   * Using ElevenLabs override capabilities
   */
  async customizeAgentForCall(session: ConversationSession): Promise<void> {
    try {
      const business = await this.getBusinessDetails(session.business_id)
      const client = session.client_id ? await this.getClientDetails(session.client_id) : null
      
      // Build dynamic system prompt
      let customPrompt = `You are a professional AI Account Manager for ${business?.name}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

YOUR ROLE:`

      if (client) {
        customPrompt += `
- Provide project status updates and timeline information
- Address client concerns and questions professionally  
- Coordinate with the team for complex requests
- Maintain strong client relationships

CLIENT CONTEXT:
- Client Name: ${client.name}
- Previous interactions: Available in conversation history`
      } else {
        customPrompt += `
- Qualify new leads professionally
- Gather project requirements and timeline
- Schedule consultations with the team
- Provide information about our services`
      }

      customPrompt += `

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

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect that premium standard.`

      // Build custom first message
      let firstMessage: string
      if (client) {
        const clientName = client.name ? client.name.split(' ')[0] : 'there'
        firstMessage = `Hello ${clientName}! Thank you for calling ${business?.name || 'us'}. I'm here to help with your projects and any questions you might have. What can I assist you with today?`
      } else {
        firstMessage = `Hello! Thank you for calling ${business?.name || 'us'}. I'm your AI assistant, and I'm here to help with any questions about our creative services and projects. How may I assist you today?`
      }

      // Send overrides to ElevenLabs
      await this.sendAgentOverrides(session.agent_id, {
        system_prompt: customPrompt,
        first_message: firstMessage
      })

      console.log(`[🎯 ELEVENLABS AGENT] ✅ Agent customized for call`)
      
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Failed to customize agent:', error)
    }
  }

  /**
   * 🎯 SEND AGENT OVERRIDES TO ELEVENLABS
   */
  private async sendAgentOverrides(agentId: string, overrides: {
    system_prompt?: string
    first_message?: string
  }): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/convai/agents/${agentId}/overrides`,
        overrides,
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      )
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Failed to send overrides:', error)
    }
  }

  /**
   * 🎯 MONITOR CONVERSATION EVENTS
   * Using ElevenLabs conversation events
   */
  async handleConversationEvent(event: any): Promise<void> {
    try {
      const { conversation_id, event_type, data } = event
      
      switch (event_type) {
        case 'conversation.started':
          console.log(`[🎯 ELEVENLABS AGENT] 🎬 Conversation started: ${conversation_id}`)
          break
          
        case 'conversation.ended':
          console.log(`[🎯 ELEVENLABS AGENT] 🏁 Conversation ended: ${conversation_id}`)
          await this.handleConversationEnd(conversation_id, data)
          break
          
        case 'agent.response':
          console.log(`[🎯 ELEVENLABS AGENT] 🤖 Agent response: ${data.text}`)
          break
          
        case 'user.speech':
          console.log(`[🎯 ELEVENLABS AGENT] 🎙️ User said: ${data.text}`)
          break
          
        case 'error':
          console.error(`[🎯 ELEVENLABS AGENT] ❌ Conversation error:`, data)
          break
      }
      
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Event handling error:', error)
    }
  }

  /**
   * 🎯 HANDLE CONVERSATION END
   */
  private async handleConversationEnd(conversationId: string, data: any): Promise<void> {
    try {
      // Find session by conversation ID
      const session = Array.from(this.activeSessions.values())
        .find(s => s.conversation_id === conversationId)
      
      if (!session) {
        console.warn(`[🎯 ELEVENLABS AGENT] ⚠️ Session not found for conversation: ${conversationId}`)
        return
      }

      // Get conversation transcript from ElevenLabs
      const transcript = await this.getConversationTranscript(conversationId)
      
      // Save conversation to database
      await this.saveConversationRecord(session, transcript, data)
      
      // Send notification email
      await this.sendCallSummaryEmail(session, transcript)
      
      // Cleanup
      this.activeSessions.delete(session.call_sid)
      session.status = 'ended'
      
      console.log(`[🎯 ELEVENLABS AGENT] ✅ Conversation cleanup completed: ${conversationId}`)
      
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Conversation end handling error:', error)
    }
  }

  /**
   * 🎯 GET CONVERSATION TRANSCRIPT
   */
  private async getConversationTranscript(conversationId: string): Promise<string> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/convai/conversations/${conversationId}/transcript`,
        {
          headers: {
            'xi-api-key': this.apiKey
          }
        }
      )
      
      return response.data.transcript || ''
    } catch (error) {
      console.error('[🎯 ELEVENLABS AGENT] ❌ Failed to get transcript:', error)
      return ''
    }
  }

  // Utility methods
  private async loadBusinessConfig(toNumber: string): Promise<any> {
    return await prisma.business.findFirst({
      where: { twilioPhoneNumber: toNumber },
      include: { agentConfig: true }
    })
  }

  private async identifyExistingClient(fromNumber: string, businessId: string): Promise<any> {
    return await prisma.client.findFirst({
      where: { phone: fromNumber, businessId: businessId },
      select: { id: true, name: true, email: true }
    })
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

  private async saveAgentConfig(businessId: string, agentId: string, config: any): Promise<void> {
    // Implementation to save agent config to database
  }

  private async saveConversationRecord(session: ConversationSession, transcript: string, data: any): Promise<void> {
    // Implementation to save conversation record
  }

  private async sendCallSummaryEmail(session: ConversationSession, transcript: string): Promise<void> {
    // Implementation to send email notification
  }
}

export const elevenLabsAgent = new ElevenLabsConversationalAgent() 