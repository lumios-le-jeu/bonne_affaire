import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth())

async function debug() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  
  const results = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a'))
    const ads = all.filter(a => a.href && a.href.includes('/ad/'))
    return ads.map(a => {
        return {
           href: a.href,
           text: a.textContent,
           priceFound: !!(a.textContent || '').match(/(\d[\d\s\u00A0]*)\s*€/)
        }
    }).slice(0, 5)
  })
  
  console.log('Ads found:', results.length)
  console.log('Sample Ads:', results)
  await browser.close()
}

debug()
