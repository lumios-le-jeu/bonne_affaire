import { scrapeLeboncoin } from './lib/scraper'
scrapeLeboncoin('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4').then(res => {
  console.log('Result count: ', res.length)
  if (res.length > 0) console.log(res[0])
})
