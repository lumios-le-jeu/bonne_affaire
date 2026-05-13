import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth())

async function debug() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4', { waitUntil: 'domcontentloaded' })
  
  const nextData = await page.evaluate(() => {
     const script = document.getElementById('__NEXT_DATA__')
     if (script) return JSON.parse(script.innerHTML)
     return null
  })
  
  if (nextData) {
     console.log('Got __NEXT_DATA__!')
     require('fs').writeFileSync('next_data.json', JSON.stringify(nextData, null, 2))
  } else {
     console.log('No __NEXT_DATA__ found')
  }
  await browser.close()
}

debug()
