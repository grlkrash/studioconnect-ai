import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function updateNotificationEmail() {
  try {
    console.log('🔍 Looking for Aurora Branding business...')
    
    // Find Aurora Branding business
    const business = await prisma.business.findFirst({
      where: { name: { contains: 'Aurora' } },
      select: { id: true, name: true, notificationEmails: true }
    })
    
    if (!business) {
      console.error('❌ Aurora Branding business not found')
      return
    }
    
    console.log('✅ Found business:', business.name)
    console.log('🔍 Current notification emails:', business.notificationEmails)
    
    // Update with correct notification email
    const updated = await prisma.business.update({
      where: { id: business.id },
      data: {
        notificationEmails: ['sonia@cincyaisolutions.com']
      },
      select: { id: true, name: true, notificationEmails: true }
    })
    
    console.log('✅ Successfully updated notification emails!')
    console.log('📧 New notification emails:', updated.notificationEmails)
    
    return updated
  } catch (error) {
    console.error('❌ Error updating notification email:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  updateNotificationEmail()
    .then(() => {
      console.log('✅ Notification email update completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Notification email update failed:', error)
      process.exit(1)
    })
}

export default updateNotificationEmail 