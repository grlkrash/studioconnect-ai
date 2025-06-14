import bcrypt from 'bcrypt'
import { prisma } from '../src/services/db'

async function main() {
  const email = 'admin@demo.com'
  const password = 'demo1234'
  const passwordHash = await bcrypt.hash(password, 12)

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN' },
    create: {
      email,
      passwordHash,
      role: 'ADMIN',
      business: {
        create: {
          name: 'Aurora Branding & Co.',
        },
      },
    },
  })

  console.log('✅  Seeded admin@demo.com with password demo1234')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  }) 