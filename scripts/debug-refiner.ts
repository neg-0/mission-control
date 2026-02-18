import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const ideas = await prisma.idea.findMany()
  console.log('Ideas:', JSON.stringify(ideas, null, 2))
  const journal = await prisma.agentJournal.findMany({
    where: { agentId: 'refiner' },
    orderBy: { createdAt: 'desc' },
    take: 5
  })
  console.log('Journal:', JSON.stringify(journal, null, 2))
}
main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect())