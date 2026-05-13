import { prisma } from './lib/prisma'
import { scrapeLeboncoin } from './lib/scraper'

async function test() {
  const search = await prisma.search.findFirst({
     where: { isTracking: true }
  })
  
  if (!search) {
     console.log("No active search found.");
     return;
  }
  
  console.log("Testing search ID:", search.id, "URL:", search.url);
  try {
     const listings = await scrapeLeboncoin(search.url)
     console.log(`Found ${listings.length} listings!`)
     console.log("Saving to DB mock...");
  } catch (err) {
     console.error("Error:", err);
  } finally {
     await prisma.$disconnect();
  }
}

test()
