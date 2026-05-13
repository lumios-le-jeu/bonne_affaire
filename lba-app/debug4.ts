import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth())

async function debug() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  
  await page.route('**/*', route => {
     if (['image', 'font', 'stylesheet'].includes(route.request().resourceType())) route.abort()
     else route.continue()
  })

  await page.goto('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  
  const text = await page.evaluate(() => document.body.innerText)
  require('fs').writeFileSync('debug_text.txt', text)
  console.log('Text saved.')
  await browser.close()
}

debug()
