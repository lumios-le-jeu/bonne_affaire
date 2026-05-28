import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import path from 'path'

puppeteer.use(StealthPlugin())

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

async function scrapePageInTab(browser: any, url: string, pageNum: number): Promise<LBCListing[]> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  await page.setRequestInterception(true)
  page.on('request', (request: any) => {
    const t = request.resourceType()
    if (['image', 'media', 'font', 'stylesheet'].includes(t)) request.abort()
    else request.continue()
  })

  const interceptedAds: any[] = []
  page.on('response', async (response: any) => {
    if (interceptedAds.length > 0) return
    const resUrl = response.url()
    const ct = response.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    
    if (
      resUrl.includes('api.leboncoin.fr') ||
      resUrl.includes('/classified') ||
      resUrl.includes('/ad-search') ||
      resUrl.includes('/classifieds')
    ) {
      try {
        const jsonTimeout = new Promise<never>((_, r) => setTimeout(() => r(new Error('json timeout')), 3000))
        const json = await Promise.race([response.json(), jsonTimeout])
        const ads = (json as any)?.ads ?? (json as any)?.data?.ads ?? null
        if (Array.isArray(ads) && ads.length > 0) {
          interceptedAds.push(...ads)
          console.log(`\x1b[36m[Scraper]\x1b[0m Page ${pageNum}: API interceptée — ${ads.length} annonces brutes`)
        }
      } catch { /* ignore */ }
    }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await new Promise(r => setTimeout(r, 3000))

    const isEmpty = await page.evaluate(() => {
      const hasScript = !!document.getElementById('__NEXT_DATA__')
      return !hasScript
    })
    
    if (isEmpty) {
      console.warn(`\x1b[33m[Scraper]\x1b[0m Page ${pageNum}: CAPTCHA DataDome détecté !`)
      console.warn(`\x1b[33m[Scraper]\x1b[0m 🛑 Veuillez résoudre le Captcha MANUELLEMENT dans la fenêtre du navigateur sur le Mac mini ! (60 secondes max...)`)
      
      try {
        await page.waitForSelector('#__NEXT_DATA__', { timeout: 60000 })
        console.log(`\x1b[32m[Scraper]\x1b[0m ✅ Captcha résolu avec succès !`)
        await new Promise(r => setTimeout(r, 2000))
      } catch (e) {
        console.warn(`\x1b[31m[Scraper]\x1b[0m ❌ Temps écoulé ou échec de résolution du Captcha. Abandon.`)
        await page.screenshot({ path: 'datadome_block.png' })
        return []
      }
    }

    if (interceptedAds.length > 0) {
      const parsed = extractFromAds(interceptedAds)
      console.log(`\x1b[32m[Scraper]\x1b[0m Page ${pageNum}: ${parsed.length} annonces (API réseau)`)
      return parsed
    }

    const ads = await page.evaluate(() => {
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

    const fallback = await page.evaluate(() => {
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
    await page.close()
  }
}

export async function scrapeLeboncoin(searchUrl: string): Promise<LBCListing[]> {
  const MAX_PAGES = 8
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  })

  console.log(`\x1b[36m[Scraper]\x1b[0m Démarrage séquentiel — ${MAX_PAGES} pages max`)
  const start = Date.now()

  const allListings: LBCListing[] = []
  const seen = new Set<string>()

  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const pageListings = await scrapePageInTab(browser, buildPageUrl(searchUrl, p), p)

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
        const delay = Math.floor(Math.random() * 2000 + 2000)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  } finally {
    await browser.disconnect()
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\x1b[32m[Scraper]\x1b[0m ✅ ${allListings.length} annonces en ${elapsed}s`)

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
