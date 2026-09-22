import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cleanSearchUrl } from '@/lib/search-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

const PAGE_SIZE = 35
const MAX_PAGES = Number(process.env.LBA_MAX_PAGES || 8)
const MIN_HOURS_BETWEEN_RUNS = Number(process.env.LBA_MIN_HOURS || 20)

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

/**
 * Plan de collecte demande par l'extension.
 *
 * On ne renvoie que ce qui est reellement necessaire : le nombre de pages est
 * calcule sur le volume annonce au dernier passage, pas sur une constante.
 * Une recherche a 60 annonces coute 2 pages, pas 8 — c'est autant de trafic en
 * moins, donc autant de raisons en moins d'etre remarque.
 */
export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1'
  const cutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_RUNS * 3600_000)

  const searches = await prisma.search.findMany({
    where: {
      isTracking: true,
      ...(force ? {} : { OR: [{ lastScraped: null }, { lastScraped: { lt: cutoff } }] }),
    },
    orderBy: { lastScraped: 'asc' },
  })

  // Verrou : une recherche deja prise en charge par un autre collecteur n'est
  // pas redistribuee. Sans ca, deux navigateurs (le portable et le Mac) qui
  // demandent un plan a quelques minutes d'intervalle collecteraient les memes
  // pages en double — trafic double, donc risque de blocage double, pour zero
  // donnee supplementaire. lastScraped ne suffit pas : il n'est ecrit qu'a la
  // fin du passage.
  const claimCutoff = new Date(Date.now() - 3 * 3600_000)
  const claimed = new Set(
    (
      await prisma.scanRun.findMany({
        where: { finishedAt: null, startedAt: { gte: claimCutoff } },
        select: { searchId: true },
      })
    ).map((r) => r.searchId)
  )

  const out = []
  for (const s of searches) {
    if (claimed.has(s.id) && !force) continue

    // Auto-reparation des recherches creees avant le nettoyage a la saisie
    // (ex. V-STROM et son espace de largeur nulle). Si l'URL propre existe
    // deja sous une autre recherche, on garde l'ancienne en base mais on
    // visite quand meme la version propre.
    const url = cleanSearchUrl(s.url)
    if (url !== s.url) {
      await prisma.search.update({ where: { id: s.id }, data: { url } }).catch(() => {})
      console.log(`\x1b[33m[Queue]\x1b[0m URL nettoyee pour "${s.name.trim()}" (caracteres invisibles)`)
    }

    // Combien de pages pour couvrir le perimetre ? On ajoute une page de marge :
    // sans elle, un scan a la limite exacte n'est jamais juge "complet".
    const needed = s.lastTotal
      ? Math.min(MAX_PAGES, Math.ceil(s.lastTotal / PAGE_SIZE) + 1)
      : MAX_PAGES

    const run = await prisma.scanRun.create({
      data: { searchId: s.id, total: s.lastTotal ?? null },
    })

    out.push({
      searchId: s.id,
      runId: run.id,
      name: s.name,
      url,
      pages: Array.from({ length: needed }, (_, i) => i + 1),
    })
  }

  // Les runs jamais clos (Chrome ferme en pleine collecte) encombrent la table.
  await prisma.scanRun.updateMany({
    where: { finishedAt: null, startedAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
    data: { finishedAt: new Date(), complete: false, note: 'abandonne' },
  })

  return NextResponse.json({ searches: out, generatedAt: new Date() }, { headers: cors })
}
