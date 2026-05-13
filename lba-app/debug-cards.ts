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
    const cards = document.querySelectorAll('a[href*="/ad/"]')
    return Array.from(cards).map(a => {
        return {
           href: a.getAttribute('href'),
           text: a.textContent?.trim().replace(/\s+/g, ' ').substring(0, 100)
        }
    }).slice(0, 5)
  })
  
  console.log('Cards:', results)
  await browser.close()
}

debug()
