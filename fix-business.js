const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixBusiness() {
  try {
    const businessId = 'cmc4f1vdo0000w4oy5jkpa6t0'; // The actual business ID
    const elevenlabsAgentId = 'agent_01jy6ztt6mf5jaa266qj8b7asz'; // Your ElevenLabs agent ID
    
    console.log('🔧 FIXING BUSINESS CONFIGURATION...');
    
    // First, update the business phone number
    // Replace with your actual Twilio phone number
    const twilioPhoneNumber = '+15138675309'; // UPDATE THIS WITH YOUR ACTUAL TWILIO NUMBER
    
    const updatedBusiness = await prisma.business.update({
      where: { id: businessId },
      data: {
        twilioPhoneNumber: twilioPhoneNumber
      }
    });
    
    console.log('✅ Updated business phone number to:', updatedBusiness.twilioPhoneNumber);
    
    // Next, update or create the agent config with ElevenLabs agent ID
    const agentConfig = await prisma.agentConfig.upsert({
      where: { businessId: businessId },
      update: {
        elevenlabsAgentId: elevenlabsAgentId,
        elevenlabsVoice: 'kdmDKE6EkgrWrrykO9Qt', // Jessica voice for professional calls
        welcomeMessage: 'Hello! Thank you for calling Aurora Branding & Co. I\'m here to help with your projects and any questions you might have. How may I assist you today?'
      },
      create: {
        businessId: businessId,
        elevenlabsAgentId: elevenlabsAgentId,
        elevenlabsVoice: 'kdmDKE6EkgrWrrykO9Qt', // Jessica voice
        welcomeMessage: 'Hello! Thank you for calling Aurora Branding & Co. I\'m here to help with your projects and any questions you might have. How may I assist you today?',
        personaPrompt: 'You are a professional AI assistant for Aurora Branding & Co, a premium creative agency. You are knowledgeable, friendly, and focused on helping clients with their branding and creative projects.'
      }
    });
    
    console.log('✅ Updated agent config with ElevenLabs agent ID:', agentConfig.elevenlabsAgentId);
    
    // Verify the configuration
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        agentConfig: true
      }
    });
    
    console.log('\n=== FINAL CONFIGURATION ===');
    console.log('Business:', business.name);
    console.log('Phone:', business.twilioPhoneNumber);
    console.log('ElevenLabs Agent ID:', business.agentConfig?.elevenlabsAgentId);
    console.log('Voice:', business.agentConfig?.elevenlabsVoice);
    console.log('Welcome Message:', business.agentConfig?.welcomeMessage);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixBusiness(); 