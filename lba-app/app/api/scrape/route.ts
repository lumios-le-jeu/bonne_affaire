import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { scrapeLeboncoin } from '@/lib/scraper'
import { runScrapeJob } from '@/lib/job'

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
