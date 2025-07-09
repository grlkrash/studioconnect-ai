import { prisma } from '../services/db'

async function fixAgentName() {
  try {
    console.log('🚫 FIXING HARDCODED MAYA AGENT NAME...')
    
    // Find Aurora Branding business
    const business = await prisma.business.findFirst({
      where: { 
        OR: [
          { name: { contains: 'Aurora', mode: 'insensitive' } },
          { twilioPhoneNumber: '+15138487161' }
        ]
      },
      include: { agentConfig: true }
    })
    
    if (!business) {
      console.error('❌ Business not found')
      return
    }
    
    console.log('✅ Found business:', business.name)
    
    if (business.agentConfig) {
      const currentPersonaPrompt = business.agentConfig.personaPrompt || ''
      const currentVoiceGreeting = business.agentConfig.voiceGreetingMessage || ''
      const currentWelcomeMessage = business.agentConfig.welcomeMessage || ''
      
      // Replace Maya with Alex (gender-neutral name for male voice)
      const updatedPersonaPrompt = currentPersonaPrompt
        .replace(/You are Maya,/g, 'You are Alex,')
        .replace(/I'm Maya,/g, "I'm Alex,")
        .replace(/This is Maya/g, 'This is Alex')
        .replace(/Maya, your/g, 'Alex, your')
        .replace(/Maya /g, 'Alex ')
      
      const updatedVoiceGreeting = currentVoiceGreeting
        .replace(/I'm Maya,/g, "I'm Alex,")
        .replace(/This is Maya/g, 'This is Alex')
        .replace(/Maya, your/g, 'Alex, your')
        .replace(/Maya /g, 'Alex ')
      
      const updatedWelcomeMessage = currentWelcomeMessage
        .replace(/I'm Maya,/g, "I'm Alex,")
        .replace(/This is Maya/g, 'This is Alex')
        .replace(/Maya, your/g, 'Alex, your')
        .replace(/Maya /g, 'Alex ')
      
      // Update the agent configuration
      await prisma.agentConfig.update({
        where: { id: business.agentConfig.id },
        data: {
          agentName: 'Alex',
          personaPrompt: updatedPersonaPrompt,
          voiceGreetingMessage: updatedVoiceGreeting,
          welcomeMessage: updatedWelcomeMessage,
          // Set voice to Mark (Natural Conversations) that you wanted
          elevenlabsVoice: 'pNInz6obpgDQGcFmaJgB' // This is a male voice ID
        }
      })
      
      console.log('✅ Updated agent configuration:')
      console.log('- Agent name: Maya → Alex')
      console.log('- Updated persona prompt (Maya → Alex)')
      console.log('- Updated voice greeting (Maya → Alex)')
      console.log('- Updated welcome message (Maya → Alex)')
      console.log('- Voice ID: Set to male voice')
      
    } else {
      console.error('❌ No agent config found for business')
    }
    
  } catch (error) {
    console.error('❌ Error fixing agent name:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixAgentName() 