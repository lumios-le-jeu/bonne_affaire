import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { scrapeLeboncoin } from '@/lib/scraper'

// ─── File d'attente globale (un seul browser Chrome à la fois) ───────────────
const queue: string[] = []
let isProcessing = false

async function processQueue() {
  if (isProcessing) return
  isProcessing = true

  while (queue.length > 0) {
    const searchId = queue.shift()!
    try {
      await runScrapeJob(searchId)
    } catch (err) {
      console.error(`\x1b[31m[Queue]\x1b[0m Error for ${searchId}:`, err)
    }
  }

  isProcessing = false
}

// ─── Logique de scrape (appelée séquentiellement par la queue) ───────────────
async function runScrapeJob(searchId: string) {
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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const isLongGone = new Date(listing.lastSeen).getTime() < sevenDaysAgo.getTime()

    if (newMissingCount >= 15 || isLongGone) {
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

// ─── POST /api/scrape — Ajouter à la file et démarrer si pas déjà actif ─────
export async function POST(request: Request) {
  const { searchId } = await request.json()
  if (!searchId) return NextResponse.json({ error: 'searchId is required' }, { status: 400 })

  const search = await prisma.search.findUnique({ where: { id: searchId }, select: { id: true, name: true } })
  if (!search) return NextResponse.json({ error: 'Search not found' }, { status: 404 })

  // Éviter les doublons dans la file
  if (!queue.includes(searchId)) {
    queue.push(searchId)
    console.log(`\x1b[36m[Queue]\x1b[0m Added "${search.name}" — queue size: ${queue.length}`)
  }

  // Démarrer le traitement en arrière-plan (sans await)
  processQueue().catch(err => console.error('[Queue Error]', err))

  return NextResponse.json({ 
    message: 'Added to queue', 
    searchId, 
    name: search.name,
    queuePosition: queue.indexOf(searchId) + 1,
    isProcessing 
  })
}

// ─── GET /api/scrape?id=xxx — Polling : vérifier si terminé ──────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const searchId = searchParams.get('id')
  if (!searchId) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const search = await prisma.search.findUnique({ where: { id: searchId }, select: { id: true, lastScraped: true, name: true } })
  if (!search) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const count = await prisma.listing.count({ where: { searchId, status: 'active' } })
  const inQueue = queue.includes(searchId)
  const position = queue.indexOf(searchId) + 1

  return NextResponse.json({ 
    lastScraped: search.lastScraped, 
    count,
    inQueue,
    queuePosition: position,
    isProcessing
  })
}
