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
    return Array.from(document.querySelectorAll('script')).map(s => {
       const id = s.id || ''
       const text = s.innerHTML.substring(0, 50)
       return { id, text, len: s.innerHTML.length }
    })
  })
  
  console.log('Scripts:', results)
  await browser.close()
}

debug()
