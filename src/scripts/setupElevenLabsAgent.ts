/**
 * 🎯 ELEVENLABS CONVERSATIONAL AI SETUP SCRIPT
 * 
 * Following ElevenLabs official documentation to create proper AI Account Manager agents
 * This replaces our custom voice pipeline with ElevenLabs native solution
 */

import { prisma } from '../services/db'
import { ElevenLabsConversationalAgent } from '../services/elevenlabsConversationalAgent'

// Create single instance
const elevenLabsAgent = new ElevenLabsConversationalAgent()

// ElevenLabs recommended premium voices from their docs
const PREMIUM_VOICES = {
  'jessica': 'g6xIsTj2HwM6VR4iXFCw', // Empathetic and expressive, great for wellness coaches
  'hope': 'OYTbf65OHHFELVut7v2H',     // Bright and uplifting, perfect for positive interactions
  'archer': 'L0Dsvb3SLTyegXwtm47J',   // Grounded and friendly young British male with charm
  'alexandra': 'kdmDKE6EkgrWrrykO9Qt', // Super realistic, young female voice that likes to chat
  'stuart': 'HDA9tsk27wYi3uq0fPcK',    // Professional & friendly Aussie, ideal for technical assistance
  'adam': 'pNInz6obpgDQGcFmaJgB'      // Professional male voice - RECOMMENDED for business
}

// ElevenLabs recommended voice settings from their docs
const ENTERPRISE_VOICE_SETTINGS = {
  stability: 0.45,        // Balanced emotional delivery
  similarity_boost: 0.85, // High clarity and consistency  
  style: 0.30,           // Natural conversational style
  use_speaker_boost: true,
  speed: 1.0             // Natural conversation speed
}

async function setupElevenLabsAgentForBusiness(businessId: string): Promise<void> {
  try {
    console.log(`[🎯 SETUP] Setting up ElevenLabs Conversational AI for business: ${businessId}`)
    
    // Get business details
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { agentConfig: true }
    })
    
    if (!business) {
      throw new Error('Business not found')
    }
    
    // Check if agent already exists
    if (business.agentConfig?.elevenlabsAgentId) {
      console.log(`[🎯 SETUP] ✅ ElevenLabs agent already exists: ${business.agentConfig.elevenlabsAgentId}`)
      return
    }
    
    // Select appropriate voice (Adam for professional, warm conversations)
    const selectedVoice = business.agentConfig?.elevenlabsVoice || PREMIUM_VOICES.adam
    
    // Build professional AI Account Manager instructions WITH CLIENT TOOLS
    const instructions = `You are a professional AI Account Manager for ${business.name}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

🔥 IMPORTANT: You have access to REAL-TIME client tools that let you retrieve live project data, client information, and business details. USE THESE TOOLS to provide accurate, current information.

YOUR CORE ROLES:

1. **CLIENT IDENTIFICATION & PERSONALIZATION**: 
   - ALWAYS use get_client_info at the beginning of each call to identify if caller is new or existing
   - Personalize your greeting based on their relationship status
   - Use their name when available

2. **REAL-TIME PROJECT STATUS UPDATES**: 
   - When clients ask about projects, use get_project_status to retrieve current information
   - Provide specific status updates, timelines, and details
   - Reference actual project names and progress from our systems

3. **PROFESSIONAL LEAD QUALIFICATION**: 
   - For new callers, gather: company name, contact details, project type, timeline, budget expectations
   - Ask about decision-making authority
   - Qualify their needs professionally

4. **INTELLIGENT ESCALATION**: 
   - Use escalate_to_team for: pricing discussions, complex creative requirements, technical specifications, contract negotiations, or when specifically requested
   - Always provide context about why you're escalating

CONVERSATION FLOW:
1. **Start**: Use get_client_info immediately to identify caller
2. **Personalize**: Adjust greeting based on client status (new vs existing)
3. **Listen**: Understand their specific need
4. **Retrieve**: Use appropriate tools to get real-time data
5. **Respond**: Provide accurate, current information
6. **Escalate**: When needed, use escalate_to_team with proper context

TOOL USAGE GUIDELINES:
- get_client_info: Use at call start and when needing client context
- get_project_status: Use when clients ask about project progress, timelines, or deliverables
- escalate_to_team: Use for complex discussions or when human expertise is needed
- get_business_hours: Use when asked about availability or operating hours

CONVERSATION STYLE:
- Keep responses concise (2-3 sentences max for each point)
- Ask clarifying questions when needed
- Show empathy and understanding
- Use natural, conversational language with professional tone
- Reference specific project details when available through tools

ESCALATION TRIGGERS:
- Pricing negotiations or contract discussions
- Complex creative requirements beyond general scope
- Technical specifications requiring expert input
- Emergency or urgent project issues
- When caller specifically requests to speak with someone
- Client dissatisfaction or complaints

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect premium service standards. Use your tools to provide accurate, real-time information that demonstrates our professionalism and attention to detail.`

    // Build warm, professional first message
    const firstMessage = `Hello! Thank you for calling ${business.name}. I'm your AI Account Manager, and I'm here to help with any questions about your projects or our creative services. Let me just pull up your information... How may I assist you today?`
    
    // Create ElevenLabs Conversational AI agent
    console.log(`[🎯 SETUP] Creating ElevenLabs agent with premium voice: ${selectedVoice}`)
    
    const agentId = await elevenLabsAgent.createAgent(businessId, {
      name: `${business.name} AI Account Manager`,
      description: `Professional AI Account Manager for ${business.name} - handles lead qualification, client service, and project inquiries with real-time data access`,
      instructions,
      first_message: firstMessage,
      voice_id: selectedVoice,
      voice_settings: ENTERPRISE_VOICE_SETTINGS
    })
    
    // Update business configuration
    await prisma.agentConfig.upsert({
      where: { businessId },
      update: { 
        elevenlabsAgentId: agentId,
        personaPrompt: instructions,
        welcomeMessage: firstMessage,
        elevenlabsVoice: selectedVoice,
        ttsProvider: 'elevenlabs' // Ensure TTS provider is set
      },
      create: {
        businessId,
        elevenlabsAgentId: agentId,
        personaPrompt: instructions,
        welcomeMessage: firstMessage,
        elevenlabsVoice: selectedVoice,
        agentName: `${business.name} AI Account Manager`,
        ttsProvider: 'elevenlabs'
      }
    })
    
    console.log(`[🎯 SETUP] ✅ ElevenLabs Conversational AI agent created successfully!`)
    console.log(`[🎯 SETUP] 🎙️ Agent ID: ${agentId}`)
    console.log(`[🎯 SETUP] 🎵 Voice: ${selectedVoice} (Premium ElevenLabs voice)`)
    console.log(`[🎯 SETUP] 🔧 Client Tools: ✅ Real-time project status, client lookup, escalation`)
    console.log(`[🎯 SETUP] 📞 Twilio webhook URL: /api/voice/elevenlabs-webhook`)
    console.log(`[🎯 SETUP] 🔄 Events webhook URL: /api/voice/elevenlabs-events`)
    console.log(`[🎯 SETUP] 🌐 Server URL: ${process.env.FRONTEND_PRODUCTION_URL || process.env.APP_PRIMARY_URL || 'https://studioconnect-ai.onrender.com'}`)
    
  } catch (error) {
    console.error(`[🎯 SETUP] ❌ Failed to setup ElevenLabs agent:`, error)
    throw error
  }
}

// Main execution
async function main() {
  const businessId = process.argv[2]
  
  if (!businessId) {
    console.error('Usage: tsx setupElevenLabsAgent.ts <businessId>')
    process.exit(1)
  }
  
  try {
    await setupElevenLabsAgentForBusiness(businessId)
    console.log(`[🎯 SETUP] 🎉 Agent setup complete for business: ${businessId}`)
  } catch (error) {
    console.error(`[🎯 SETUP] 💥 Setup failed:`, error)
    process.exit(1)
  }
}

// Export for use in other scripts
export { setupElevenLabsAgentForBusiness }

// Run if called directly
if (require.main === module) {
  main()
} 