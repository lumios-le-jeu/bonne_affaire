/**
 * recompute-days-to-sell.ts — npx tsx scripts/recompute-days-to-sell.ts
 *
 * Reevalue le delai de vente de TOUTES les annonces vendues avec la regle de
 * lib/ingest.ts : une vente n'a un delai que si sa disparition a ete observee
 * a moins de MAX_OBSERVATION_GAP_DAYS jours pres.
 *
 * Remplace reset-legacy-stats.ts, qui ne traitait que les annonces deja
 * marquees vendues au moment du basculement et laissait passer celles encore
 * "actives" dans la base heritee. Celles-ci ont ete passees en vendues par
 * les premiers passages de l'extension, avec un delai de 0 jour qui ne
 * mesurait rien.
 *
 * Idempotent : peut etre relance sans risque. Ne supprime rien.
 */
import { prisma } from '../lib/prisma'
import { measuredDaysToSell, MAX_OBSERVATION_GAP_DAYS } from '../lib/ingest'

async function main() {
  const sold = await prisma.listing.findMany({
    where: { status: 'sold' },
    select: { id: true, searchId: true, firstSeen: true, lastSeen: true, daysToSell: true, search: { select: { name: true } } },
  })

  const perSearch = new Map<string, { name: string; kept: number; dropped: number; days: number[] }>()
  let changed = 0

  for (const l of sold) {
    const d = await measuredDaysToSell(l.searchId, l.firstSeen, l.lastSeen)
    if (d !== l.daysToSell) {
      await prisma.listing.update({ where: { id: l.id }, data: { daysToSell: d } })
      changed++
    }
    const s = perSearch.get(l.searchId) ?? { name: l.search.name, kept: 0, dropped: 0, days: [] }
    if (d === null) s.dropped++
    else { s.kept++; s.days.push(d) }
    perSearch.set(l.searchId, s)
  }

  console.log(`${sold.length} annonces vendues examinees, ${changed} corrigees.`)
  console.log(`Regle : disparition observee a moins de ${MAX_OBSERVATION_GAP_DAYS} jours pres.\n`)

  for (const s of perSearch.values()) {
    const sorted = [...s.days].sort((a, b) => a - b)
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
    console.log(
      `${s.name.trim().padEnd(18)} ${String(s.kept).padStart(3)} ventes mesurees` +
      `   ${String(s.dropped).padStart(3)} ventes non datables` +
      (med !== null ? `   mediane ${med} j` : '')
    )
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
