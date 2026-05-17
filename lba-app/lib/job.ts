import { prisma } from './prisma'
import { scrapeLeboncoin } from './scraper'

export async function runScrapeJob(searchId: string) {
  const search = await prisma.search.findUnique({ where: { id: searchId } })
  if (!search) return

  console.log(`\x1b[34m[Scrape]\x1b[0m Starting: "${search.name}"`)

  const scrapedListings = await scrapeLeboncoin(search.url)

  if (scrapedListings.length === 0) {
    console.warn(`\x1b[33m[Scrape]\x1b[0m No listings for "${search.name}"`)
    return
  }

  const now = new Date()
  const scrapedIds = scrapedListings.map((l) => l.id)

  const existingListings = await prisma.listing.findMany({ where: { searchId: search.id } })
  const existingMap = new Map(existingListings.map((l) => [l.id, l]))
  const existingIds = new Set(existingListings.filter((l) => l.status === 'active').map((l) => l.id))
  const missingIds = [...existingIds].filter((id) => !scrapedIds.includes(id))

  for (const missingId of missingIds) {
    const listing = existingMap.get(missingId)
    if (!listing) continue
    const newMissingCount = (listing.missingCount || 0) + 1

    // ⚠️ Le scraper est limité à MAX_PAGES pages : une annonce en page 9+
    // n'apparaît jamais dans les résultats sans être vendue pour autant.
    // On exige donc :
    //  - 30 scans consécutifs manqués (au lieu de 15) — soit ~30 jours si scan quotidien
    //  - ET que la dernière vue soit > 14 jours (pas juste pagede débordement)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const isLongGone = new Date(listing.lastSeen).getTime() < fourteenDaysAgo.getTime()

    if (newMissingCount >= 30 && isLongGone) {
      const daysToSell = Math.round((now.getTime() - new Date(listing.firstSeen).getTime()) / (1000 * 60 * 60 * 24))
      await prisma.listing.update({ where: { id: missingId }, data: { status: 'sold', soldAt: now, daysToSell, lastSeen: now, missingCount: newMissingCount } })
    } else {
      await prisma.listing.update({ where: { id: missingId }, data: { missingCount: newMissingCount } })
    }
  }

  for (const l of scrapedListings) {
    const existing = existingMap.get(l.id)
    const newStatus = existing?.status === 'excluded' ? 'excluded' : 'active'
    const soldUpdate = newStatus === 'active' ? { soldAt: null, daysToSell: null } : {}

    await prisma.listing.upsert({
      where: { id: l.id },
      create: { id: l.id, title: l.title, price: l.price, location: l.location, thumb: l.thumb, url: l.url, status: newStatus, searchId: search.id, firstSeen: now, lastSeen: now },
      update: { price: l.price, status: newStatus, lastSeen: now, location: l.location, thumb: l.thumb, url: l.url, title: l.title, ...soldUpdate, missingCount: 0 },
    })

    if (!existing || existing.price !== l.price) {
      await prisma.priceHistory.create({ data: { listingId: l.id, price: l.price } })
    }
  }

  const prices = scrapedListings.map((l) => l.price)
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const existingSnapshot = await prisma.dailySnapshot.findFirst({ where: { searchId: search.id, date: { gte: today } } })
  if (existingSnapshot) {
    await prisma.dailySnapshot.update({ where: { id: existingSnapshot.id }, data: { avgPrice: avg, minPrice: Math.min(...prices), maxPrice: Math.max(...prices), count: scrapedListings.length } })
  } else {
    await prisma.dailySnapshot.create({ data: { searchId: search.id, avgPrice: avg, minPrice: Math.min(...prices), maxPrice: Math.max(...prices), count: scrapedListings.length } })
  }

  await prisma.search.update({ where: { id: search.id }, data: { lastScraped: now } })
  console.log(`\x1b[32m[Scrape]\x1b[0m Done: ${scrapedListings.length} listings for "${search.name}"`)
}
