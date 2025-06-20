/**
 * 🎯 ELEVENLABS CONVERSATIONAL AI SETUP SCRIPT
 * 
 * Following ElevenLabs official documentation to create proper AI Account Manager agents
 * This replaces our custom voice pipeline with ElevenLabs native solution
 */

import { prisma } from '../services/db'
import { elevenLabsAgent } from '../services/elevenlabsConversationalAgent'

// ElevenLabs recommended premium voices from their docs
const PREMIUM_VOICES = {
  'jessica': 'g6xIsTj2HwM6VR4iXFCw', // Empathetic and expressive, great for wellness coaches
  'hope': 'OYTbf65OHHFELVut7v2H',     // Bright and uplifting, perfect for positive interactions
  'archer': 'L0Dsvb3SLTyegXwtm47J',   // Grounded and friendly young British male with charm
  'alexandra': 'kdmDKE6EkgrWrrykO9Qt', // Super realistic, young female voice that likes to chat
  'stuart': 'HDA9tsk27wYi3uq0fPcK'    // Professional & friendly Aussie, ideal for technical assistance
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
    
    // Select appropriate voice (Jessica for professional, empathetic conversations)
    const selectedVoice = business.agentConfig?.elevenlabsVoice || PREMIUM_VOICES.jessica
    
    // Build professional AI Account Manager instructions
    const instructions = `You are a professional AI Account Manager for ${business.name}, a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

YOUR CORE ROLES:
1. LEAD QUALIFICATION: For new callers, professionally gather:
   - Company name and contact details
   - Project type and requirements
   - Timeline and budget expectations
   - Decision-making authority

2. CLIENT SERVICE: For existing clients, provide:
   - Project status updates and timeline information
   - Address concerns and questions professionally
   - Coordinate with the team for complex requests
   - Maintain strong client relationships

CONVERSATION GUIDELINES:
- Keep responses concise and to the point (2-3 sentences max)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Use natural, conversational language with professional tone
- Show empathy and understanding for client needs

ESCALATION TRIGGERS:
- Complex project discussions requiring creative input
- Pricing negotiations or contract discussions
- Emergency or urgent project issues
- Client dissatisfaction or complaints
- Technical specifications beyond general scope

QUALIFICATION PROCESS:
1. Warm professional greeting
2. Identify if new lead or existing client
3. For new leads: gather basic requirements professionally
4. For existing clients: ask how you can help with their projects
5. Always offer to connect with appropriate team member
6. Provide clear next steps

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect premium service standards.`

    // Build warm, professional first message
    const firstMessage = `Hello! Thank you for calling ${business.name}. I'm your AI assistant, and I'm here to help with any questions about your projects or our creative services. How may I assist you today?`
    
    // Create ElevenLabs Conversational AI agent
    console.log(`[🎯 SETUP] Creating ElevenLabs agent with premium voice: ${selectedVoice}`)
    
    const agentId = await elevenLabsAgent.createAgent(businessId, {
      name: `${business.name} AI Account Manager`,
      description: `Professional AI Account Manager for ${business.name} - handles lead qualification, client service, and project inquiries`,
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
        elevenlabsVoice: selectedVoice
      },
      create: {
        businessId,
        elevenlabsAgentId: agentId,
        personaPrompt: instructions,
        welcomeMessage: firstMessage,
        elevenlabsVoice: selectedVoice,
        agentName: `${business.name} AI Account Manager`
      }
    })
    
    console.log(`[🎯 SETUP] ✅ ElevenLabs Conversational AI agent created successfully!`)
    console.log(`[🎯 SETUP] 🎙️ Agent ID: ${agentId}`)
    console.log(`[🎯 SETUP] 🎵 Voice: ${selectedVoice} (Premium ElevenLabs voice)`)
    console.log(`[🎯 SETUP] 📞 Twilio webhook URL: /api/voice/elevenlabs-webhook`)
    console.log(`[🎯 SETUP] 🔄 Events webhook URL: /api/voice/elevenlabs-events`)
    
  } catch (error) {
    console.error(`[🎯 SETUP] ❌ Failed to setup ElevenLabs agent:`, error)
    throw error
  }
}

// Export for use in other scripts
export { setupElevenLabsAgentForBusiness, PREMIUM_VOICES, ENTERPRISE_VOICE_SETTINGS }

// CLI usage
if (require.main === module) {
  const businessId = process.argv[2]
  
  if (!businessId) {
    console.error('Usage: npx ts-node src/scripts/setupElevenLabsAgent.ts <businessId>')
    process.exit(1)
  }
  
  setupElevenLabsAgentForBusiness(businessId)
    .then(() => {
      console.log('✅ Setup completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error)
      process.exit(1)
    })
} 