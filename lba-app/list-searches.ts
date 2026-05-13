import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const searches = await prisma.search.findMany()
  console.log(JSON.stringify(searches, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
