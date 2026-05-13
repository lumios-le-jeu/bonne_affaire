import { scrapeLeboncoin } from './lib/scraper'

async function debug() {
  const url = 'https://www.leboncoin.fr/recherche?text=Apple+Mac+mini+M4&kst=k'
  console.log('Testing scrape for:', url)
  
  try {
    const results = await scrapeLeboncoin(url)
    console.log(`Scrape successful! Found ${results.length} results.`)
    console.log('First 3 results:', JSON.stringify(results.slice(0, 3), null, 2))
    
    if (results.length === 0) {
      console.error('FAILED: No results found.')
    } else {
      console.log('SUCCESS: Scraper is working again.')
    }
  } catch (err) {
    console.error('Scrape failed with error:', err)
  }
}

debug()
