/**
 * scraper.ts — Playwright scraper avec double mode :
 * 1. SSR __NEXT_DATA__ pour les catégories classiques
 * 2. Interception réseau pour l'immobilier (catégories SPA)
 *
 * Ne bloque PLUS les ressources JS/CSS pour ne pas casser DataDome.
 */

import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { BrowserContext } from 'playwright'

chromium.use(StealthPlugin())

export interface LBCListing {
  id: string
  title: string
  price: number
  location: string
  thumb: string | null
  url: string
}

// ─────────────────────────────────────────────
// Extraction depuis le JSON annonces (SSR ou API)
// ─────────────────────────────────────────────
function extractFromAds(ads: any[]): LBCListing[] {
  const listings: LBCListing[] = []
  for (const ad of ads) {
    const id = String(ad.list_id ?? ad.id ?? '')
    if (!id) continue

    const price = Array.isArray(ad.price) ? ad.price[0] : (ad.price ?? 0)
    if (!price || price <= 0 || price > 50000000) continue // 50M€ max

    const images = ad.images ?? {}
    const thumb =
      images.small_url ||
      images.urls_large?.[0] ||
      images.urls?.[0] ||
      images.thumb_url ||
      null

    const loc = ad.location ?? {}
    const city = loc.city || ''
    const zip = loc.zipcode || loc.department_id || ''
    const location = [city, zip].filter(Boolean).join(' ') || 'France'

    const adUrl = ad.url
      ? (ad.url.startsWith('http') ? ad.url : `https://www.leboncoin.fr${ad.url}`)
      : `https://www.leboncoin.fr/ad/annonce/${id}`

    listings.push({ id, title: ad.subject ?? 'Annonce LBC', price, location, thumb, url: adUrl })
  }
  return listings
}

// ─────────────────────────────────────────────
// Construit l'URL paginée
// ─────────────────────────────────────────────
function buildPageUrl(searchUrl: string, page: number): string {
  const url = new URL(searchUrl)
  if (page > 1) url.searchParams.set('page', String(page))
  else url.searchParams.delete('page')
  return url.toString()
}

// ─────────────────────────────────────────────
// Scrape une page dans un onglet existant
// Stratégie 1 : intercepter la réponse API réseau (immobilier SPA)
// Stratégie 2 : lire __NEXT_DATA__ SSR (catégories classiques)
// Stratégie 3 : fallback DOM
// ─────────────────────────────────────────────
async function scrapePageInTab(context: BrowserContext, url: string, pageNum: number): Promise<LBCListing[]> {
  const tab = await context.newPage()

  // ⚠️ On ne bloque PLUS les ressources — DataDome a besoin des scripts JS pour valider
  // (bloquer CSS/fonts/images uniquement, pas JS ni XHR/fetch)
  await tab.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (['image', 'media', 'font', 'stylesheet'].includes(t)) route.abort()
    else route.continue()
  })

  // Capturer les réponses API avec des annonces (mode immobilier SPA)
  const interceptedAds: any[] = []
  tab.on('response', async (response) => {
    if (interceptedAds.length > 0) return // déjà trouvé
    const resUrl = response.url()
    const ct = response.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    // LBC API endpoints connus pour les annonces
    if (
      resUrl.includes('api.leboncoin.fr') ||
      resUrl.includes('/classified') ||
      resUrl.includes('/ad-search') ||
      resUrl.includes('/classifieds')
    ) {
      try {
        // Timeout sur la lecture du body pour éviter un blocage si la réponse est lente
        const jsonTimeout = new Promise<never>((_, r) => setTimeout(() => r(new Error('json timeout')), 3000))
        const json = await Promise.race([response.json(), jsonTimeout])
        const ads = (json as any)?.ads ?? (json as any)?.data?.ads ?? null
        if (Array.isArray(ads) && ads.length > 0) {
          interceptedAds.push(...ads)
          console.log(`\x1b[36m[Scraper]\x1b[0m Page ${pageNum}: API interceptée — ${ads.length} annonces brutes`)
        }
      } catch { /* ignore — réponse lente ou corps non-JSON */ }
    }
  })

  try {
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    // Attendre que DataDome valide + que les appels API soient lancés
    await tab.waitForTimeout(3000)

    // Détection rapide : si la page est vide (blocage DataDome total), on abandonne
    const isEmpty = await tab.evaluate(() => {
      const body = document.body?.innerText?.trim() ?? ''
      const hasScript = !!document.getElementById('__NEXT_DATA__')
      return body.length < 50 && !hasScript
    })
    if (isEmpty) {
      console.warn(`\x1b[33m[Scraper]\x1b[0m Page ${pageNum}: page vide (blocage DataDome?) — abandon`)
      await tab.screenshot({ path: 'datadome_block.png' })
      console.warn(`\x1b[33m[Scraper]\x1b[0m Screenshot enregistré sous 'datadome_block.png'`)
      return []
    }

    // ── Stratégie 1 : API interceptée pendant le chargement ─────────────────
    if (interceptedAds.length > 0) {
      const parsed = extractFromAds(interceptedAds)
      console.log(`\x1b[32m[Scraper]\x1b[0m Page ${pageNum}: ${parsed.length} annonces (API réseau)`)
      return parsed
    }

    // ── Stratégie 2 : __NEXT_DATA__ SSR ─────────────────────────────────────
    const ads = await tab.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__')
      if (!script?.textContent) return null
      try {
        const data = JSON.parse(script.textContent)
        return (
          data?.props?.pageProps?.searchData?.ads ??
          data?.props?.pageProps?.ads ??
          data?.props?.pageProps?.initialSearchData?.ads ??
          null
        )
      } catch { return null }
    })

    if (ads && Array.isArray(ads) && ads.length > 0) {
      const parsed = extractFromAds(ads)
      console.log(`\x1b[32m[Scraper]\x1b[0m Page ${pageNum}: ${parsed.length} annonces (__NEXT_DATA__)`)
      return parsed
    }

    // ── Stratégie 3 : Fallback DOM ───────────────────────────────────────────
    const fallback = await tab.evaluate(() => {
      const results: any[] = []
      const seen = new Set<string>()
      const adLinks = Array.from(document.querySelectorAll('a[href*="/ad/"]')) as HTMLAnchorElement[]
      adLinks.forEach(anchor => {
        const idMatch = anchor.href.match(/\/ad\/[^/]+\/(\d+)/)
        if (!idMatch) return
        const adId = idMatch[1]
        if (seen.has(adId)) return
        seen.add(adId)
        const card = anchor.closest('article') || anchor.closest('li') || anchor.parentElement
        if (!card) return
        const found = card.textContent?.match(/(\d[\d\s\u00A0]*)[\s\u00A0]*€/)
        const price = found ? parseInt(found[1].replace(/\s|\u00A0/g, '')) : 0
        if (!price || price <= 0 || price > 50000000) return
        const title = (card as HTMLElement).getAttribute('aria-label') || 'Annonce LBC'
        results.push({ id: adId, title, price, location: 'France', thumb: null, url: anchor.href })
      })
      return results
    })

    console.log(`\x1b[33m[Scraper]\x1b[0m Page ${pageNum}: ${fallback.length} annonces (DOM fallback)`)
    return fallback as LBCListing[]

  } catch (err: any) {
    console.error(`\x1b[31m[Scraper]\x1b[0m Page ${pageNum}: erreur —`, err.message)
    return []
  } finally {
    await tab.close()
  }
}

// ─────────────────────────────────────────────
// Point d'entrée — 1 browser, pages séquentielles
// ─────────────────────────────────────────────
export async function scrapeLeboncoin(searchUrl: string): Promise<LBCListing[]> {
  const MAX_PAGES = 8

  const browser = await chromium.launch({
    headless: false, // DataDome bloque headless:true
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--window-size=1280,800',
    ],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'accept-language': 'fr-FR,fr;q=0.9',
    },
  })

  // Masquer webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
  })

  console.log(`\x1b[36m[Scraper]\x1b[0m Démarrage séquentiel — ${MAX_PAGES} pages max`)
  const start = Date.now()

  const allListings: LBCListing[] = []
  const seen = new Set<string>()

  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const pageListings = await scrapePageInTab(context, buildPageUrl(searchUrl, p), p)

      for (const l of pageListings) {
        if (!seen.has(l.id)) {
          seen.add(l.id)
          allListings.push(l)
        }
      }

      if (pageListings.length === 0) {
        console.log(`\x1b[33m[Scraper]\x1b[0m Page vide, arrêt anticipé.`)
        break
      }

      if (p < MAX_PAGES) {
        const delay = Math.floor(Math.random() * 2000 + 2000) // 2 à 4 sec
        await new Promise(r => setTimeout(r, delay))
      }
    }
  } finally {
    await browser.close()
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\x1b[32m[Scraper]\x1b[0m ✅ ${allListings.length} annonces en ${elapsed}s`)

  return allListings
}

// ─────────────────────────────────────────────
// Execution CLI
// ─────────────────────────────────────────────
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
