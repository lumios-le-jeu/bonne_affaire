import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runScrapeJob } from '@/lib/job'

// ─── File d'attente globale (un seul browser Chrome à la fois) ───────────────
const queue: string[] = []
let isProcessing = false

// ─── Cron interne : scan auto quotidien à 5h00 du matin ──────────────────────
// Pas besoin de cron OS — tourne directement dans le process Next.js
function getMsUntil5AM(): number {
  const now = new Date()
  const next5AM = new Date(now)
  next5AM.setHours(5, 0, 0, 0)
  if (next5AM <= now) next5AM.setDate(next5AM.getDate() + 1) // demain si 5h déjà passé
  return next5AM.getTime() - now.getTime()
}

async function runDailyScan() {
  console.log('\x1b[35m[AutoCron]\x1b[0m ⏰ Scan automatique quotidien déclenché (5h00)')
  try {
    const searches = await prisma.search.findMany({ where: { isTracking: true } })
    console.log(`\x1b[35m[AutoCron]\x1b[0m ${searches.length} recherche(s) active(s) à scanner`)
    for (const s of searches) {
      if (!queue.includes(s.id)) {
        queue.push(s.id)
        console.log(`\x1b[35m[AutoCron]\x1b[0m → "${s.name}" ajouté à la file`)
      }
    }
    processQueue().catch(err => console.error('[AutoCron Queue Error]', err))
  } catch (err) {
    console.error('\x1b[31m[AutoCron]\x1b[0m Erreur lors du scan auto:', err)
  }
  // Reprogram pour le lendemain à 5h exactement
  const delay = getMsUntil5AM()
  console.log(`\x1b[35m[AutoCron]\x1b[0m Prochain scan dans ${Math.round(delay / 1000 / 60)} minutes`)
  setTimeout(runDailyScan, delay)
}

// Démarrer le cron uniquement côté serveur (pas dans les workers Edge)
if (typeof globalThis.__autoCronStarted === 'undefined') {
  (globalThis as any).__autoCronStarted = true
  const initialDelay = getMsUntil5AM()
  console.log(`\x1b[35m[AutoCron]\x1b[0m ✅ Cron interne initialisé — premier scan dans ${Math.round(initialDelay / 1000 / 60)} min`)
  setTimeout(runDailyScan, initialDelay)
}

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
