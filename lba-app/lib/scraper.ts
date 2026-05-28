import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

export interface LBCListing {
  id: string
  title: string
  price: number
  location: string
  thumb: string | null
  url: string
}

export async function scrapeLeboncoin(searchUrl: string): Promise<LBCListing[]> {
  const workerPath = path.join(process.cwd(), 'lib', 'worker.ts')
  
  console.log(`\x1b[35m[Scraper Spawner]\x1b[0m Démarrage du worker isolé pour: ${searchUrl}`)

  // Exécute le worker avec npx tsx pour avoir le support TypeScript natif
  // timeout de 5 minutes au niveau du processus système
  const { stdout, stderr } = await execAsync(`npx tsx "${workerPath}" "${searchUrl}"`, {
    maxBuffer: 1024 * 1024 * 10, // 10 MB buffer pour les grosses pages / JSON
    timeout: 5 * 60 * 1000, 
  })

  let result: LBCListing[] | null = null

  // On parse les logs du worker
  const lines = stdout.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('{"__workerResult":')) {
      try {
        const parsed = JSON.parse(trimmed)
        result = parsed.__workerResult
      } catch (err) {
        console.error(`\x1b[31m[Scraper Spawner]\x1b[0m Erreur parse JSON:`, err)
      }
    } else {
      // Afficher les autres logs (couleurs incluses)
      console.log(trimmed)
    }
  }

  if (stderr) {
    // Affiche les erreurs/warnings standard sans tout crasher
    console.warn(`\x1b[33m[Worker Stderr]\x1b[0m`, stderr)
  }

  if (!result) {
    throw new Error('Le worker a terminé sans retourner de __workerResult valide.')
  }

  return result
}
