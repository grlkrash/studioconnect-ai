import 'dotenv/config'
import { prisma } from '../src/services/db'
import { getProjectSyncProvider } from '../src/services/projectSync'

async function main() {
  const provider = getProjectSyncProvider()
  const businesses = await prisma.business.findMany({ select: { id: true } })

  for (const { id } of businesses) {
    await provider.syncProjects(id)
  }

  console.log('Mock project seeding complete')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  }) 