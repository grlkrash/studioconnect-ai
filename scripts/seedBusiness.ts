import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function seedBusiness() {
  try {
    // Check if any business exists
    const existingBusiness = await prisma.business.findFirst()
    
    if (existingBusiness) {
      console.log('✅ Business already exists:', existingBusiness.name)
      console.log('Business ID:', existingBusiness.id)
      return existingBusiness
    }

    // Create default business
    const business = await prisma.business.create({
      data: {
        name: 'StudioConnect AI',
        businessType: 'CREATIVE',
        planTier: 'PRO',
        notificationEmail: 'sonia@cincyaisolutions.com',
        notificationEmails: ['sonia@cincyaisolutions.com'],
        timezone: 'America/New_York',
        businessHours: {
          monday: { open: '09:00', close: '17:00', closed: false },
          tuesday: { open: '09:00', close: '17:00', closed: false },
          wednesday: { open: '09:00', close: '17:00', closed: false },
          thursday: { open: '09:00', close: '17:00', closed: false },
          friday: { open: '09:00', close: '17:00', closed: false },
          saturday: { open: '10:00', close: '15:00', closed: false },
          sunday: { open: '10:00', close: '15:00', closed: true }
        },
        brandColors: {
          primary: '#0ea5e9',
          secondary: '#64748b',
          accent: '#8b5cf6'
        }
      }
    })

    console.log('🎉 Created new business:', business.name)
    console.log('Business ID:', business.id)
    
    // Create default agent config
    const agentConfig = await prisma.agentConfig.create({
      data: {
        businessId: business.id,
        agentName: 'AI Creative Assistant',
        personaPrompt: `You are a highly professional AI Creative Assistant for StudioConnect AI, a premium creative agency. You specialize in:

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
        welcomeMessage: 'Welcome to StudioConnect AI! I\'m your dedicated AI Creative Assistant, ready to help with your creative projects and business initiatives.',
        voiceGreetingMessage: 'Hello! Thank you for calling StudioConnect AI. I\'m your dedicated AI Creative Assistant, here to provide immediate assistance with your creative projects, timeline updates, and strategic initiatives. How may I help you today?',
        ttsProvider: 'elevenlabs',
        elevenlabsVoice: 'pNInz6obpgDQGcFmaJgB', // Adam - Professional male voice
        elevenlabsModel: 'eleven_turbo_v2_5',
        openaiVoice: 'NOVA',
        openaiModel: 'tts-1-hd',
        voiceSettings: {
          stability: 0.7,
          similarity: 0.85,
          style: 0.2,
          use_speaker_boost: true
        },
        colorTheme: {
          primary: '#0ea5e9',
          secondary: '#64748b'
        }
      }
    })

    console.log('🎉 Created agent config for business')
    
    return business
  } catch (error) {
    console.error('❌ Error seeding business:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  seedBusiness()
    .then(() => {
      console.log('✅ Business seeding completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Business seeding failed:', error)
      process.exit(1)
    })
}

export default seedBusiness 