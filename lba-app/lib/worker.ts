import { spawn } from 'child_process'
import 'dotenv/config'

export interface LBCListing {
  id: string
  title: string
  price: number
  location: string
  thumb: string | null
  url: string
}

function extractFromAds(adsArray: any[]): LBCListing[] {
  const results: LBCListing[] = []
  for (const ad of adsArray) {
    if (!ad?.list_id || !ad?.subject) continue
    const price = ad.price ? ad.price[0] : 0
    if (!price || price <= 0 || price > 50000000) continue
    
    let thumb = null
    if (ad.images?.thumb_url) thumb = ad.images.thumb_url
    else if (ad.images?.urls_thumb && ad.images.urls_thumb.length > 0) thumb = ad.images.urls_thumb[0]

    let location = 'France'
    if (ad.location?.city) location = ad.location.city

    results.push({
      id: ad.list_id.toString(),
      title: ad.subject,
      price,
      location,
      thumb,
      url: ad.url || `https://www.leboncoin.fr/ad/${ad.category_name || 'divers'}/${ad.list_id}`
    })
  }
  return results
}

function buildPageUrl(searchUrl: string, pageNum: number): string {
  const urlObj = new URL(searchUrl)
  urlObj.searchParams.set('page', pageNum.toString())
  return urlObj.toString()
}

// Fonction pour exécuter un AppleScript sur le Mac mini via SSH
async function runAppleScriptSSH(script: string): Promise<string> {
  const sshHost = process.env.MAC_SSH_HOST
  if (!sshHost) {
    throw new Error("ERREUR: La variable d'environnement MAC_SSH_HOST n'est pas définie (ex: MAC_SSH_HOST=user@192.168.1.50). Veuillez l'ajouter dans votre fichier .env")
  }

  return new Promise((resolve, reject) => {
    // Exécution de 'ssh user@ip osascript'
    const child = spawn('ssh', [sshHost, 'osascript']);
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Erreur SSH (code ${code}): ${stderr}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Impossible de lancer SSH: ${err.message}`));
    });

    // Envoi du script via stdin
    child.stdin.write(script);
    child.stdin.end();
  });
}

async function scrapePageMac(url: string, pageNum: number): Promise<LBCListing[]> {
  console.log(`\x1b[36m[Scraper Mac]\x1b[0m Page ${pageNum}: Navigation vers ${url}...`)
  
  // Script 1: Naviguer vers l'URL
  const navScript = `
    tell application "Google Chrome"
      activate
      set URL of active tab of window 1 to "${url}"
      delay 4
    end tell
  `
  await runAppleScriptSSH(navScript)

  // Script 2: Boucle pour extraire les données et surveiller DataDome
  let attempts = 0;
  while (attempts < 12) { // Maximum ~60 secondes d'attente (12 * 5s)
    const extractScript = `
      tell application "Google Chrome"
        set jsonText to execute active tab of window 1 javascript "
          var script = document.getElementById('__NEXT_DATA__');
          if (script) {
            return script.textContent;
          } else {
            return 'NOT_FOUND';
          }
        "
        return jsonText
      end tell
    `
    const data = await runAppleScriptSSH(extractScript)
    
    if (data === "NOT_FOUND" || data === "") {
      console.warn(`\x1b[33m[Scraper Mac]\x1b[0m Page ${pageNum}: CAPTCHA DataDome détecté (ou page non chargée) !`)
      console.warn(`\x1b[33m[Scraper Mac]\x1b[0m 🛑 Veuillez résoudre le Captcha MANUELLEMENT sur le Mac mini ! En attente...`)
      await new Promise(r => setTimeout(r, 5000))
      attempts++
      continue
    }

    try {
      const parsed = JSON.parse(data)
      const ads = (parsed as any)?.props?.pageProps?.searchData?.ads ??
                  (parsed as any)?.props?.pageProps?.ads ??
                  (parsed as any)?.props?.pageProps?.initialSearchData?.ads ?? null
                  
      if (ads && Array.isArray(ads) && ads.length > 0) {
        const listings = extractFromAds(ads)
        console.log(`\x1b[32m[Scraper Mac]\x1b[0m Page ${pageNum}: ${listings.length} annonces extraites via AppleScript`)
        return listings
      } else {
        console.warn(`\x1b[33m[Scraper Mac]\x1b[0m Page ${pageNum}: Aucun résultat d'annonces trouvé dans le JSON.`)
        return []
      }
    } catch (e: any) {
      console.error(`\x1b[31m[Scraper Mac]\x1b[0m Page ${pageNum}: Erreur de parsing JSON —`, e.message)
      return []
    }
  }

  console.warn(`\x1b[31m[Scraper Mac]\x1b[0m ❌ Temps écoulé ou échec de résolution du Captcha sur le Mac. Abandon de la page ${pageNum}.`)
  return []
}

export async function scrapeLeboncoin(searchUrl: string): Promise<LBCListing[]> {
  const MAX_PAGES = 8
  console.log(`\x1b[36m[Scraper Mac]\x1b[0m Démarrage via SSH sur le Mac — ${MAX_PAGES} pages max`)
  const start = Date.now()

  const allListings: LBCListing[] = []
  const seen = new Set<string>()

  for (let p = 1; p <= MAX_PAGES; p++) {
    const pageListings = await scrapePageMac(buildPageUrl(searchUrl, p), p)

    for (const l of pageListings) {
      if (!seen.has(l.id)) {
        seen.add(l.id)
        allListings.push(l)
      }
    }

    if (pageListings.length === 0) {
      console.log(`\x1b[33m[Scraper Mac]\x1b[0m Page vide ou fin des résultats, arrêt anticipé.`)
      break
    }

    if (p < MAX_PAGES) {
      // Petite pause aléatoire pour imiter un comportement humain
      const delay = Math.floor(Math.random() * 2000 + 1500)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\x1b[32m[Scraper Mac]\x1b[0m ✅ Terminé: ${allListings.length} annonces scrapées en ${elapsed}s`)

  return allListings
}

// Execution CLI
if (require.main === module || process.argv[1]?.endsWith('worker.ts')) {
  const url = process.argv[2]
  if (url) {
    scrapeLeboncoin(url)
      .then(res => {
        console.log(JSON.stringify({ __workerResult: res }))
        process.exit(0)
      })
      .catch(err => {
        console.error(err)
        process.exit(1)
      })
  }
}
