import { scrapeLeboncoin } from './lib/scraper'

async function debugGarmin() {
  const url = 'https://www.leboncoin.fr/recherche?category=29&text=garmin+235&kst=p'
  console.log('\x1b[36m[Debug]\x1b[0m Starting Garmin search check...')
  
  try {
    const listings = await scrapeLeboncoin(url)
    console.log(`\n\x1b[32m[Success]\x1b[0m Found ${listings.length} listings total.`)
    
    if (listings.length > 0) {
      console.log('\x1b[33mSample Listings:\x1b[0m')
      listings.slice(0, 3).forEach((l, i) => {
        console.log(`  ${i+1}. ${l.title} - ${l.price}€ (${l.id})`)
      })
    } else {
      console.log('\x1b[31m[Fail]\x1b[0m Scraper returned 0 listings. Check if Captcha was solved or if selectors changed.')
    }
  } catch (err) {
    console.error('\x1b[31m[Critical Error]\x1b[0m Debug script failed:', err)
  }
}

debugGarmin()
