import { prisma } from './prisma'
import { queryOf } from './search-url'

/**
 * Ingestion des lots envoyes par l'extension.
 *
 * L'ancien modele posait une question a laquelle il ne pouvait pas repondre :
 * "cette annonce a disparu, est-elle vendue ?". Comme le scraper ne lisait que
 * 8 pages, une annonce reléguée en page 9 disparaissait sans etre vendue, d'ou
 * le garde-fou a 30 scans manques qui rendait daysToSell inexploitable.
 *
 * Ici chaque passage est trace (ScanRun) avec sa couverture reelle. On ne fait
 * vieillir une annonce que lorsqu'un passage COMPLET ne l'a pas revue : 3
 * passages complets et 3 jours suffisent alors, et daysToSell redevient juste.
 */

const MISSING_RUNS_BEFORE_SOLD = 3
const MIN_DAYS_BEFORE_SOLD = 3
const PAGE_SIZE = 35

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

export interface RawAd {
  list_id: number | string
  subject: string
  body?: string
  price?: number[] | number
  url?: string
  category_name?: string
  first_publication_date?: string
  index_date?: string
  images?: { thumb_url?: string; urls_thumb?: string[]; urls?: string[] }
  location?: { city?: string; zipcode?: string; department_id?: string }
  owner?: { type?: string; name?: string }
  attributes?: { key: string; value: string; value_label?: string }[]
}

export interface NormalAd {
  id: string
  title: string
  price: number
  location: string | null
  zipcode: string | null
  thumb: string | null
  url: string
  isPro: boolean
  hasShipping: boolean
  publishedAt: Date | null
  raw: string
}

function parseDate(s?: string): Date | null {
  if (!s) return null
  // Leboncoin renvoie "2026-09-14 08:12:33" (heure de Paris) ou de l'ISO.
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + '+02:00')
  return isNaN(d.getTime()) ? null : d
}

export function normalize(ad: RawAd): NormalAd | null {
  if (!ad?.list_id || !ad?.subject) return null

  const price = Array.isArray(ad.price) ? ad.price[0] : ad.price
  if (!price || price <= 0 || price > 50_000_000) return null

  const attrs = ad.attributes || []
  const hasShipping = attrs.some(
    (a) => /shippable|shipping|colis/i.test(a.key) && !/^(false|0|no)$/i.test(String(a.value))
  )

  return {
    id: String(ad.list_id),
    title: ad.subject,
    price: Math.round(price),
    location: ad.location?.city || null,
    zipcode: ad.location?.zipcode || null,
    thumb: ad.images?.thumb_url || ad.images?.urls_thumb?.[0] || ad.images?.urls?.[0] || null,
    url: ad.url || `https://www.leboncoin.fr/ad/${ad.category_name || 'divers'}/${ad.list_id}`,
    isPro: (ad.owner?.type || '').toLowerCase() === 'pro',
    hasShipping,
    publishedAt: parseDate(ad.first_publication_date || ad.index_date),
    raw: JSON.stringify({
      body: ad.body?.slice(0, 1000),
      attributes: attrs.map((a) => ({ k: a.key, v: a.value_label ?? a.value })),
      owner: ad.owner?.type,
      category: ad.category_name,
    }),
  }
}

/* ------------------------------------------------------------------ *
 * Ingestion d'une page
 * ------------------------------------------------------------------ */

export async function ingestPage(input: {
  searchId?: string | null
  runId?: string | null
  url: string
  page?: number
  total?: number | null
  ads: RawAd[]
}) {
  const ads = input.ads.map(normalize).filter((a): a is NormalAd => a !== null)
  if (!ads.length) return { stored: 0, reason: 'lot vide' }

  // Rattachement : identifiant fourni par l'extension, sinon meme requete texte.
  let searchId = input.searchId || null
  if (!searchId) searchId = await matchSearchByQuery(input.url)
  if (!searchId) return { stored: 0, reason: 'aucune recherche suivie ne correspond' }

  const now = new Date()

  for (const a of ads) {
    const existing = await prisma.listing.findUnique({ where: { id: a.id } })
    const status = existing?.status === 'excluded' ? 'excluded' : 'active'

    // firstSeen ne doit pas etre "le jour ou MON scraper l'a croisee" : c'est
    // la date de mise en ligne annoncee par Leboncoin qui compte, sinon une
    // annonce publiee un mois avant la creation de la recherche parait vendue
    // en deux jours. On garde la plus ancienne date connue.
    const firstSeen = new Date(
      Math.min(
        ...[existing?.firstSeen, a.publishedAt, now]
          .filter((d): d is Date => d instanceof Date || typeof d === 'object' && d !== null)
          .map((d) => new Date(d as Date).getTime())
      )
    )

    await prisma.listing.upsert({
      where: { id: a.id },
      create: {
        id: a.id, title: a.title, price: a.price, location: a.location, zipcode: a.zipcode,
        thumb: a.thumb, url: a.url, isPro: a.isPro, hasShipping: a.hasShipping,
        publishedAt: a.publishedAt, raw: a.raw, status, searchId,
        firstSeen,
        lastSeen: now,
      },
      update: {
        title: a.title, price: a.price, location: a.location, zipcode: a.zipcode,
        thumb: a.thumb, url: a.url, isPro: a.isPro, hasShipping: a.hasShipping,
        publishedAt: a.publishedAt ?? existing?.publishedAt, raw: a.raw,
        status, lastSeen: now, missingCount: 0, firstSeen,
        // Une annonce revue n'est plus vendue : on annule un verdict premature.
        ...(status === 'active' ? { soldAt: null, daysToSell: null } : {}),
      },
    })

    if (!existing || existing.price !== a.price) {
      await prisma.priceHistory.create({ data: { listingId: a.id, price: a.price } })
    }
  }

  if (input.runId) {
    await prisma.scanRun.update({
      where: { id: input.runId },
      data: {
        pagesSeen: { increment: 1 },
        adsSeen: { increment: ads.length },
        ...(input.total ? { total: input.total } : {}),
      },
    }).catch(() => {})
  }
  if (input.total) {
    await prisma.search.update({ where: { id: searchId }, data: { lastTotal: input.total } }).catch(() => {})
  }

  return { stored: ads.length, searchId }
}

/**
 * Filet de secours pour les lots arrives sans searchId — en pratique, les
 * pages que tu consultes toi-meme. Les lots de la collecte planifiee, eux,
 * portent leur searchId depuis l'extension et ne passent pas par ici.
 * Comparaison sur la requete normalisee : casse, espaces, "+" et caracteres
 * invisibles ne doivent pas suffire a perdre un lot.
 */
async function matchSearchByQuery(url: string): Promise<string | null> {
  const q = queryOf(url)
  if (!q) return null
  const searches = await prisma.search.findMany({ where: { isTracking: true } })
  for (const s of searches) {
    if (queryOf(s.url) === q) return s.id
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Bilan de fin de passage
 * ------------------------------------------------------------------ */

export async function finalizeRun(runId: string) {
  const run = await prisma.scanRun.findUnique({ where: { id: runId } })
  if (!run || run.finishedAt) return { ok: false, reason: 'run inconnu ou deja clos' }

  const searchId = run.searchId
  const now = new Date()

  // Un passage est complet si l'on a vu (presque) tout ce que Leboncoin annonce,
  // ou si la derniere page etait incomplete — signe qu'il n'y a plus rien apres.
  const expected = run.total ?? null
  const complete =
    expected !== null
      ? run.adsSeen >= Math.floor(expected * 0.9)
      : run.adsSeen > 0 && run.adsSeen < run.pagesSeen * PAGE_SIZE

  let aged = 0
  let sold = 0

  if (complete) {
    const missed = await prisma.listing.findMany({
      where: { searchId, status: 'active', lastSeen: { lt: run.startedAt } },
    })
    for (const l of missed) {
      const n = (l.missingCount || 0) + 1
      const daysSinceSeen = (now.getTime() - new Date(l.lastSeen).getTime()) / 86_400_000

      if (n >= MISSING_RUNS_BEFORE_SOLD && daysSinceSeen >= MIN_DAYS_BEFORE_SOLD) {
        const daysToSell = await measuredDaysToSell(searchId, l.firstSeen, l.lastSeen, run.startedAt)
        // On date la vente a la derniere observation, pas a aujourd'hui :
        // l'annonce a disparu quelque part entre les deux, et lastSeen est la
        // seule borne dont on soit sur. daysToSell reste null si cette
        // fenetre est trop large pour etre une mesure (voir plus bas).
        await prisma.listing.update({
          where: { id: l.id },
          data: { status: 'sold', soldAt: l.lastSeen, daysToSell, missingCount: n },
        })
        sold++
      } else {
        await prisma.listing.update({ where: { id: l.id }, data: { missingCount: n } })
        aged++
      }
    }
  }

  await snapshot(searchId, now)

  await prisma.scanRun.update({
    where: { id: runId },
    data: {
      finishedAt: now,
      complete,
      note: complete ? `${sold} vendues, ${aged} en sursis` : 'couverture partielle, aucun verdict',
    },
  })
  await prisma.search.update({ where: { id: searchId }, data: { lastScraped: now } })

  return { ok: true, complete, sold, aged, adsSeen: run.adsSeen, total: run.total }
}

/* ------------------------------------------------------------------ *
 * Mesure du delai de vente
 * ------------------------------------------------------------------ */

/**
 * Au-dela de cet ecart entre la derniere observation d'une annonce et le
 * premier passage complet qui ne l'a plus trouvee, on sait qu'elle est partie
 * mais pas quand : ce n'est plus une mesure.
 */
export const MAX_OBSERVATION_GAP_DAYS = 3

/**
 * Renvoie le delai de vente en jours, ou null s'il n'a pas ete observe.
 *
 * Cas typique du null : les annonces heritees de l'ancien scraper, vues pour
 * la derniere fois le 13 mai puis constatees absentes en septembre. Elles
 * sont bien vendues, mais leur delai calcule (lastSeen - firstSeen) valait 0
 * jour parce que l'ancien scraper ne les avait croisees qu'une fois. Meme
 * chose apres une semaine sans collecte : les ventes survenues pendant le
 * trou sont comptees, pas mesurees.
 *
 * @param fallbackStart debut du passage en cours, si c'est lui le premier a
 *        constater l'absence (il n'est pas encore marque complet en base).
 */
export async function measuredDaysToSell(
  searchId: string,
  firstSeen: Date,
  lastSeen: Date,
  fallbackStart?: Date
): Promise<number | null> {
  const firstMiss = await prisma.scanRun.findFirst({
    where: { searchId, complete: true, startedAt: { gt: lastSeen } },
    orderBy: { startedAt: 'asc' },
    select: { startedAt: true },
  })
  const missAt = firstMiss?.startedAt ?? fallbackStart
  if (!missAt) return null

  const gapDays = (missAt.getTime() - new Date(lastSeen).getTime()) / 86_400_000
  if (gapDays > MAX_OBSERVATION_GAP_DAYS) return null

  return Math.max(0, Math.round((new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / 86_400_000))
}

async function snapshot(searchId: string, now: Date) {
  const active = await prisma.listing.findMany({
    where: { searchId, status: 'active' },
    select: { price: true },
  })
  if (!active.length) return

  const prices = active.map((l) => l.price).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const med = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2)
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)

  const day = new Date(now); day.setHours(0, 0, 0, 0)
  const existing = await prisma.dailySnapshot.findFirst({
    where: { searchId, date: { gte: day } },
  })
  const data = {
    avgPrice: avg, medPrice: med,
    minPrice: prices[0], maxPrice: prices[prices.length - 1],
    count: prices.length,
  }
  if (existing) await prisma.dailySnapshot.update({ where: { id: existing.id }, data })
  else await prisma.dailySnapshot.create({ data: { searchId, ...data } })
}
