import { scrapeLeboncoin } from './lib/scraper'

async function debug() {
  const url = 'https://www.leboncoin.fr/recherche?text=Apple+Mac+mini+M4&kst=k'
  const results = await scrapeLeboncoin(url)
  console.log('--- TOP 10 RESULTS ---')
  results.slice(0, 10).forEach(r => {
    console.log(`${r.price} € - ${r.title}`)
  })
}

debug()
