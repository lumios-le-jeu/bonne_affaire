import { prisma } from './lib/prisma'
import { runScrapeJob } from './lib/job'

/**
 * Script standalone à exécuter via le Planificateur de tâches Windows
 * ou via cron sur un serveur.
 * 
 * Lance le scan complet (exactement comme le dashboard) pour toutes
 * les recherches actives, met à jour les statuts de vente, etc.
 */
async function runCron() {
  console.log('--- DÉMARRAGE DU CRON DE SCRAPING ---')
  console.log(`Heure: ${new Date().toLocaleString('fr-FR')}`)

  try {
    const activeSearches = await prisma.search.findMany({
      where: { isTracking: true }
    })

    if (activeSearches.length === 0) {
      console.log('Aucune recherche active à scraper.')
      return
    }

    console.log(`${activeSearches.length} recherches actives trouvées.`)

    for (let i = 0; i < activeSearches.length; i++) {
      const search = activeSearches[i]
      console.log(`\n[${i+1}/${activeSearches.length}] Lancement du scan pour : ${search.name}`)
      try {
        await runScrapeJob(search.id)
      } catch (err) {
        console.error(`Erreur lors du scan de ${search.name}:`, err)
      }
    }

    console.log('\n✅ Tous les scans sont terminés !')
  } catch (error) {
    console.error('Erreur globale du cron:', error)
  } finally {
    await prisma.$disconnect()
  }
}

runCron()
