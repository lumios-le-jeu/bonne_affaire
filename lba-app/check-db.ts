import { prisma } from './lib/prisma'

async function checkDb() {
  const searches = await prisma.search.findMany({
    include: {
      _count: {
        select: { listings: true }
      }
    }
  });

  console.log("Searches in DB:", searches.map(s => ({
    name: s.name,
    isTracking: s.isTracking,
    listingsCount: s._count.listings
  })));
  
  await prisma.$disconnect()
}

checkDb()
