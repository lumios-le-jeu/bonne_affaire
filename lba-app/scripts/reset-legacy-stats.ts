/**
 * reset-legacy-stats.ts — a lancer UNE FOIS, avec : npx tsx scripts/reset-legacy-stats.ts
 *
 * Assainit les statistiques heritees de l'ancien scraper.
 *
 * Deux corrections, aucune suppression :
 *
 * 1. Les annonces marquees vendues AVANT le passage a l'extension ont un
 *    daysToSell qui ne mesure rien. L'ancien scraper est tombe le 13 mai ; tout
 *    ce qui a disparu ensuite a ete date de ce jour-la. D'ou les 22 montres
 *    Garmin affichant toutes exactement 40 jours, et les 16 annonces a 0 jour.
 *    On remet daysToSell a null : l'API best-sellers filtre deja sur
 *    `daysToSell: { not: null }`, elles sortent donc des stats sans etre
 *    effacees — leur historique de prix reste consultable.
 *
 * 2. firstSeen valait "le jour ou mon scraper l'a croisee". On le ramene a la
 *    date de publication reelle (publishedAt) quand elle est plus ancienne :
 *    sur tes donnees, l'ecart median est de 9 jours, avec des annonces
 *    republiees depuis des annees.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Premiere collecte par l'extension. Tout verdict anterieur est suspect.
const CUTOVER = new Date('2026-09-18T00:00:00Z')

async function main() {
  const legacy = await prisma.listing.updateMany({
    where: { status: 'sold', daysToSell: { not: null }, soldAt: { lt: CUTOVER } },
    data: { daysToSell: null },
  })
  console.log(`1. ${legacy.count} verdicts de vente anterieurs au ${CUTOVER.toISOString().slice(0, 10)} retires des stats`)

  const candidates = await prisma.listing.findMany({
    where: { publishedAt: { not: null } },
    select: { id: true, firstSeen: true, publishedAt: true },
  })

  let fixed = 0
  let totalShift = 0
  for (const l of candidates) {
    if (!l.publishedAt) continue
    if (l.publishedAt >= l.firstSeen) continue
    totalShift += (l.firstSeen.getTime() - l.publishedAt.getTime()) / 86_400_000
    await prisma.listing.update({ where: { id: l.id }, data: { firstSeen: l.publishedAt } })
    fixed++
  }
  console.log(`2. ${fixed} dates de premiere vue corrigees (recul moyen : ${fixed ? (totalShift / fixed).toFixed(1) : 0} jours)`)

  const restant = await prisma.listing.count({ where: { status: 'sold', daysToSell: { not: null } } })
  console.log(`\nVentes encore comptabilisees : ${restant}`)
  console.log(
    restant === 0
      ? "C'est normal : tes premieres vraies mesures arriveront quand une annonce vue apres le basculement disparaitra."
      : 'Verifie que ces ventes-la ont bien ete observees par le nouveau collecteur.'
  )
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
