import { chromium } from 'playwright-extra'

async function run() {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()
  await page.goto('https://www.leboncoin.fr/recherche?text=montre+garmin&kst=k', { waitUntil: 'load' })
  await page.waitForTimeout(5000)
  
  const ads = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('a'))
       .filter(a => a.href && a.href.includes('/ad/'))
       .map(a => ({ href: a.href, text: a.textContent }))
  })
  
  console.log(JSON.stringify(ads.slice(0, 3), null, 2))
  await browser.close()
}

run()
