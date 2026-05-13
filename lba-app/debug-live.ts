import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

chromium.use(stealth())

async function run() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('https://www.leboncoin.fr/recherche?text=montre+garmin&kst=k', { waitUntil: 'load' })
  await page.waitForTimeout(5000)
  
  // Dump a tags to see their hrefs
  const links = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('a')).map(a => ({
         href: a.href,
         text: a.textContent?.trim().substring(0, 50)
     })).filter(a => a.text && a.text.includes('Montre'))
  })
  
  // Dump all texts that look like price
  const prices = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('p, span, div'))
       .filter(e => e.textContent && e.textContent.includes('€'))
       .map(e => ({ tag: e.tagName, text: e.textContent?.trim() }))
       .slice(0, 10)
  })
  
  console.log('LINKS FOUND WITH "Montre":', links)
  console.log('PRICES FOUND:', prices)

  // Dump generic article/card structure
  const cards = await page.evaluate(() => {
     const ads = document.querySelectorAll('[data-test-id="adcard-container"], [data-qa-id="aditem_container"], article')
     return Array.from(ads).map(ad => ad.innerHTML.substring(0, 200))
  })
  console.log('CARDS FOUND:', cards.length)

  require('fs').writeFileSync('debug_dom.json', JSON.stringify({ links, prices, cardsLength: cards.length }, null, 2))
  
  await browser.close()
}

run()
