import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * /api/scrape — vestige de l'ancienne collecte, neutralise.
 *
 * Cette route hebergeait deux choses devenues nuisibles :
 *
 *  - un cron interne qui se declenchait chaque jour a 5h00 et lancait
 *    runScrapeJob() sur le worker Puppeteer/SSH. Ce worker n'existe plus ;
 *    l'appel echouait, mais job.ts ecrivait malgre tout lastScraped = now
 *    dans son bloc catch. /api/queue en concluait que les recherches
 *    venaient d'etre scannees et renvoyait un plan vide a l'extension
 *    pendant les 20 heures suivantes : la collecte s'arretait sans un mot.
 *
 *  - une file d'attente pilotant un navigateur unique, sans objet desormais.
 *
 * La collecte est maintenant tiree par l'extension Chrome, qui recupere son
 * plan sur /api/queue et depose ses lots sur /api/ingest.
 *
 * On garde le GET : l'interface s'en sert pour savoir ou en est une recherche.
 * Le POST repond sans rien declencher, pour ne pas casser un appel oublie.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { searchId } = await request.json().catch(() => ({ searchId: null }))
  console.log(
    `\x1b[33m[Scrape]\x1b[0m Appel ignore pour ${searchId ?? '?'} — ` +
    `la collecte passe par l'extension Chrome (popup → « Collecter maintenant »).`
  )
  return NextResponse.json({
    message: "Collecte geree par l'extension Chrome",
    mode: 'extension',
    searchId,
    inQueue: false,
    isProcessing: false,
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const searchId = searchParams.get('id')
  if (!searchId) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const search = await prisma.search.findUnique({
    where: { id: searchId },
    select: { id: true, lastScraped: true, name: true },
  })
  if (!search) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const count = await prisma.listing.count({ where: { searchId, status: 'active' } })

  // Un passage ouvert signale une collecte en cours cote extension.
  const running = await prisma.scanRun.findFirst({
    where: { searchId, finishedAt: null },
    orderBy: { startedAt: 'desc' },
  })

  return NextResponse.json({
    lastScraped: search.lastScraped,
    count,
    inQueue: !!running,
    queuePosition: running ? 1 : 0,
    isProcessing: !!running,
  })
}
