import { PrismaClient } from '@prisma/client'
import { scrapeLeboncoin } from './lib/scraper'

const prisma = new PrismaClient()

async function manualScrape(searchId: string) {
  console.log(`\x1b[36m[Manual Scrape]\x1b[0m Starting for ID: ${searchId}`)
  
  const search = await prisma.search.findUnique({ where: { id: searchId } })
  if (!search) {
    console.error(`\x1b[31m[Error]\x1b[0m Search not found for ID: ${searchId}`)
    return
  }

  try {
    const scrapedListings = await scrapeLeboncoin(search.url)
    console.log(`\x1b[32m[Success]\x1b[0m Scraped ${scrapedListings.length} listings.`)

    if (scrapedListings.length === 0) {
      console.warn('\x1b[33m[Warning]\x1b[0m No listings found. Check for DataDome.')
      return
    }

    const now = new Date()
    
    // Simplistic upsert for manual debug
    console.log('\x1b[34m[DB]\x1b[0m Updating listings...')
    for (const l of scrapedListings) {
      await prisma.listing.upsert({
        where: { id: l.id },
        create: {
          id: l.id,
          title: l.title,
          price: l.price,
          location: l.location,
          thumb: l.thumb,
          url: l.url,
          status: 'active',
          searchId: search.id,
          firstSeen: now,
          lastSeen: now,
        },
        update: {
          price: l.price,
          status: 'active',
          lastSeen: now,
          thumb: l.thumb,
          location: l.location,
          title: l.title,
        },
      })
    }

    // Daily Snapshot
    const prices = scrapedListings.map(l => l.price)
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    const min = Math.min(...prices)
    const max = Math.max(...prices)

    await prisma.dailySnapshot.create({
      data: {
        searchId: search.id,
        avgPrice: avg,
        minPrice: min,
        maxPrice: max,
        count: scrapedListings.length,
        date: now
      }
    })

    await prisma.search.update({
      where: { id: search.id },
      data: { lastScraped: now }
    })

    console.log('\x1b[32m[Done]\x1b[0m Database updated. Refresh your dashboard.')

  } catch (err) {
    console.error('\x1b[31m[Critical]\x1b[0m Manal scrape failed:', err)
  } finally {
    await prisma.$disconnect()
  }
}

const searchId = process.argv[2]
if (!searchId) {
  console.log('Usage: npx tsx manual-scrape.ts <searchId>')
} else {
  manualScrape(searchId)
}
