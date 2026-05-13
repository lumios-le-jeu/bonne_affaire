/**
 * debug-page.ts — Diagnostic: que voit-on dans le HTML renvoyé par LBC ?
 */
import { chromium } from 'playwright'

async function debug() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  })

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  const page = await context.newPage()
  await page.goto('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  const info = await page.evaluate(() => {
    const nextData = document.getElementById('__NEXT_DATA__')
    const adLinks = document.querySelectorAll('a[href*="/ad/"]').length
    const bodySnippet = document.body?.innerText?.substring(0, 300)
    const title = document.title
    const isDatadome = document.body?.innerHTML?.includes('datadome') || document.body?.innerHTML?.includes('var dd=')

    let nextDataKeys = ''
    if (nextData?.textContent) {
      try {
        const d = JSON.parse(nextData.textContent)
        nextDataKeys = Object.keys(d?.props?.pageProps ?? {}).join(', ')
      } catch {}
    }

    return { title, adLinks, bodySnippet, hasNextData: !!nextData, nextDataKeys, isDatadome }
  })

  console.log('=== DIAGNOSTIC ===')
  console.log('Title:', info.title)
  console.log('Ad links found:', info.adLinks)
  console.log('DataDome detected:', info.isDatadome)
  console.log('Has __NEXT_DATA__:', info.hasNextData)
  console.log('pageProps keys:', info.nextDataKeys)
  console.log('Body snippet:', info.bodySnippet)

  await browser.close()
}

debug().catch(console.error)
