const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function debugConfiguration() {
  console.log('🔍 DEBUGGING STUDIOCONNECT AI CONFIGURATION')
  console.log('=' .repeat(60))
  
  try {
    // Check all businesses with phone numbers
    const businesses = await prisma.business.findMany({
      include: { agentConfig: true },
      where: { twilioPhoneNumber: { not: null } }
    })
    
    console.log(`📊 Found ${businesses.length} businesses with Twilio phone numbers:`)
    console.log('')
    
    businesses.forEach((business, index) => {
      console.log(`${index + 1}. 🏢 ${business.name}`)
      console.log(`   📞 Phone: ${business.twilioPhoneNumber}`)
      console.log(`   🆔 ID: ${business.id}`)
      console.log(`   🎯 Plan: ${business.planTier}`)
      
      if (business.agentConfig) {
        console.log(`   🤖 Agent Config: ✅ EXISTS`)
        console.log(`   🎙️ ElevenLabs Voice: ${business.agentConfig.elevenlabsVoice || 'NOT SET'}`)
        console.log(`   🤖 ElevenLabs Agent ID: ${business.agentConfig.elevenlabsAgentId || 'NOT SET'}`)
        console.log(`   💬 Welcome Message: ${business.agentConfig.welcomeMessage ? 'SET' : 'NOT SET'}`)
        console.log(`   🧠 Persona Prompt: ${business.agentConfig.personaPrompt ? 'SET' : 'NOT SET'}`)
      } else {
        console.log(`   🤖 Agent Config: ❌ MISSING`)
      }
      console.log('')
    })
    
    // Check recent call logs
    const recentCalls = await prisma.callLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { business: { select: { name: true } } }
    })
    
    console.log('📞 RECENT CALL LOGS:')
    console.log('')
    
    if (recentCalls.length === 0) {
      console.log('   ❌ NO RECENT CALLS FOUND')
    } else {
      recentCalls.forEach((call, index) => {
        console.log(`${index + 1}. Call ${call.callSid}`)
        console.log(`   🏢 Business: ${call.business.name}`)
        console.log(`   📞 From: ${call.from} → To: ${call.to}`)
        console.log(`   📅 Date: ${call.createdAt.toISOString()}`)
        console.log(`   📊 Status: ${call.status}`)
        console.log(`   🔗 Source: ${call.source}`)
        console.log('')
      })
    }
    
    console.log('🔧 WEBHOOK URLS TO CONFIGURE IN ELEVENLABS:')
    console.log('')
    console.log('1. Personalization Webhook:')
    console.log('   https://YOUR-RENDER-DOMAIN.com/api/voice/elevenlabs-personalization')
    console.log('')
    console.log('2. Post-Call Webhook:')
    console.log('   https://YOUR-RENDER-DOMAIN.com/api/voice/elevenlabs-post-call')
    console.log('')
    console.log('🚨 REPLACE "YOUR-RENDER-DOMAIN" WITH YOUR ACTUAL DOMAIN!')
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

debugConfiguration() 