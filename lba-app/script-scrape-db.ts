import { scrapeLeboncoin } from './lib/scraper'
import { prisma } from './lib/prisma'

async function tryScrape() {
  const searches = await prisma.search.findMany({ where: { isTracking: true } })
  for (const search of searches) {
    console.log(`Starting background scrape for: ${search.name}`)
    
    try {
      const scrapedListings = await scrapeLeboncoin(search.url)
      console.log(`Scraped ${scrapedListings.length} listings.`)
      
      if (scrapedListings.length === 0) {
        console.log("No listings found, skipping.")
        continue;
      }

      const now = new Date()
      const scrapedIds = scrapedListings.map((l) => l.id)

      const existingListings = await prisma.listing.findMany({
        where: { searchId: search.id },
      })
      const existingMap = new Map(existingListings.map((l) => [l.id, l]))
      const existingIds = new Set(existingListings.filter((l) => l.status === 'active').map((l) => l.id))

      const soldIds = [...existingIds].filter((id) => !scrapedIds.includes(id))

      for (const soldId of soldIds) {
        const listing = existingMap.get(soldId)
        if (listing) {
          const daysToSell = Math.round(
            (now.getTime() - new Date(listing.firstSeen).getTime()) / (1000 * 60 * 60 * 24)
          )
          await prisma.listing.update({
            where: { id: soldId },
            data: { status: 'sold', soldAt: now, daysToSell, lastSeen: now },
          })
        }
      }

      for (const l of scrapedListings) {
        const existing = existingMap.get(l.id)
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
            location: l.location,
            thumb: l.thumb,
            url: l.url,
          },
        })

        if (!existing || existing.price !== l.price) {
          await prisma.priceHistory.create({
            data: { listingId: l.id, price: l.price },
          })
        }
      }

      if (scrapedListings.length > 0) {
        const prices = scrapedListings.map((l) => l.price)
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
          },
        })
      }

      await prisma.search.update({
        where: { id: search.id },
        data: { lastScraped: now },
      })
      
      console.log(`Success! Saved ${scrapedListings.length} to DB.`)
    } catch (e) {
      console.error(`Error saving ${search.name}:`, e)
    }
  }
}

tryScrape().finally(() => prisma.$disconnect())
