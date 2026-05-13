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

        // Anti-bot: Pause aléatoire entre 10 et 20 secondes sauf pour la dernière recherche
        if (i < activeSearches.length - 1) {
          const delay = Math.floor(Math.random() * (20000 - 10000 + 1) + 10000)
          console.log(`\x1b[90m[Anti-Bot] Pause de ${Math.round(delay/1000)}s avant la prochaine recherche...\x1b[0m`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
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
