/**
 * scraper.ts — Playwright scraper (parallel tabs, no playwright-extra)
 * Utilise directement 'playwright' sans le wrapper playwright-extra
 * pour éviter les conflits dans le contexte Next.js.
 * 4 onglets en parallèle + extraction via __NEXT_DATA__ SSR.
 */

import { chromium, BrowserContext } from 'playwright'

export interface LBCListing {
  id: string
  title: string
  price: number
  location: string
  thumb: string | null
  url: string
}

// ─────────────────────────────────────────────
// Extraction depuis le JSON __NEXT_DATA__ (SSR)
// ─────────────────────────────────────────────
function extractFromAds(ads: any[]): LBCListing[] {
  const listings: LBCListing[] = []
  for (const ad of ads) {
    const id = String(ad.list_id ?? ad.id ?? '')
    if (!id) continue

    const price = Array.isArray(ad.price) ? ad.price[0] : (ad.price ?? 0)
    if (!price || price <= 0 || price > 200000) continue

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
// ─────────────────────────────────────────────
async function scrapePageInTab(context: BrowserContext, url: string, pageNum: number): Promise<LBCListing[]> {
  const tab = await context.newPage()

  // Bloquer images/fonts/CSS/media — inutiles pour extraire __NEXT_DATA__
  await tab.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (['image', 'media', 'font', 'stylesheet'].includes(t)) route.abort()
    else route.continue()
  })

  try {
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
    // Laisser le JS s'initialiser (DataDome challenge + hydration Next.js)
    await tab.waitForTimeout(1500)

    // Extraire __NEXT_DATA__ directement depuis le HTML SSR
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

    // Fallback DOM si __NEXT_DATA__ vide
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
        if (!price || price <= 0 || price > 200000) return
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
// Point d'entrée — 1 browser, onglets parallèles
// ─────────────────────────────────────────────
export async function scrapeLeboncoin(searchUrl: string): Promise<LBCListing[]> {
  const MAX_PAGES = 8
  const CONCURRENCY = 4

  const browser = await chromium.launch({
    headless: false, // DataDome bloque headless:true — on doit garder le browser visible
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--window-size=1280,800',
    ],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1920, height: 1080 },
    // Cacher les signes d'automatisation
    extraHTTPHeaders: {
      'accept-language': 'fr-FR,fr;q=0.9',
    },
  })

  // Injecter un script pour masquer webdriver
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

      let newItems = 0
      for (const l of pageListings) {
        if (!seen.has(l.id)) {
          seen.add(l.id)
          allListings.push(l)
          newItems++
        }
      }

      // Si la page ne retourne aucune annonce valide, c'est la fin de la liste ou un blocage
      if (pageListings.length === 0) {
        console.log(`\x1b[33m[Scraper]\x1b[0m Page vide, arrêt anticipé.`)
        break
      }

      // Petite pause humaine entre chaque page (sauf la dernière)
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
