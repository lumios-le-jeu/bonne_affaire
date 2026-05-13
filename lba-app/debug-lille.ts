import { scrapeLeboncoin } from './lib/scraper'
const lilleUrl = 'https://www.leboncoin.fr/recherche?text=mac+mini&locations=Lille__50.63237559366482_3.058788740442864_1000'
console.log('Testing Lille URL: ', lilleUrl)
scrapeLeboncoin(lilleUrl).then(res => {
  console.log('Result count: ', res.length)
  if (res.length > 0) {
     console.log('First result ID: ', res[0].id)
     console.log('First result Title: ', res[0].title)
  } else {
     console.log('FAILED: No results found for Lille URL.')
  }
}).catch(err => {
  console.error('Fatal Scrape Error: ', err)
})
