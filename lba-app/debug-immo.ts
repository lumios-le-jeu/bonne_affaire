/**
 * debug-immo-server.ts — À lancer sur le serveur Mac (pas Windows)
 * Intercepte les réponses réseau pour trouver l'API LBC immobilier
 * 
 * Usage: npx tsx debug-immo-server.ts
 */
import { chromium } from 'playwright'

const TEST_URL = 'https://www.leboncoin.fr/recherche?category=9&text=maison&locations=Marcq-en-Bar%C5%93ul_59700__50.67399978637695_3.0941998958587646_5000_5000&square=170-max&land_plot_surface=10-max&bedrooms=4-4&price=min-900000&real_estate_type=1&outside_access=garden'

async function debug() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9' }
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
  })

  const page = await context.newPage()

  // Intercepter toutes les réponses
  const hits: string[] = []
  page.on('response', async (response) => {
    const url = response.url()
    const ct = response.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    try {
      const json = await response.json()
      const adsCount = json?.ads?.length ?? json?.data?.ads?.length ?? null
      if (adsCount !== null) {
        hits.push(`✅ ${url.substring(0, 120)} → ${adsCount} ads`)
        console.log(hits[hits.length - 1])
        if (json?.ads?.[0]) {
          console.log('   Premier ad keys:', Object.keys(json.ads[0]).join(', '))
          console.log('   list_id:', json.ads[0].list_id, '| price:', json.ads[0].price)
        }
      }
    } catch { /* ignore */ }
  })

  console.log('Chargement (networkidle)...')
  try {
    await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 30000 })
  } catch {
    console.log('Timeout networkidle, continuation...')
  }
  await page.waitForTimeout(5000)

  // Dump __NEXT_DATA__ si présent
  const nextData = await page.evaluate(() => {
    const s = document.getElementById('__NEXT_DATA__')
    if (!s?.textContent) return null
    const d = JSON.parse(s.textContent)
    const pp = d?.props?.pageProps
    return {
      keys: pp ? Object.keys(pp) : [],
      searchDataKeys: pp?.searchData ? Object.keys(pp.searchData) : null,
      adsViaSSR: pp?.searchData?.ads?.length ?? pp?.ads?.length ?? 0,
    }
  })

  console.log('\n=== RÉSUMÉ ===')
  console.log('Titre:', await page.title())
  console.log('__NEXT_DATA__:', nextData ?? 'absent')
  console.log('Appels API avec ads:', hits.length > 0 ? hits : 'AUCUN')

  await browser.close()
}

debug().catch(console.error)
