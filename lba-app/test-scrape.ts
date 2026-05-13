const { scrapeLeboncoin } = require('./lib/scraper.js') || {};

import { scrapeLeboncoin as tsScrape } from './lib/scraper'

tsScrape('https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4')
  .then(res => {
    console.log(`Found ${res.length} listings!`)
    if(res.length > 0) {
      console.log('First one:', res[0])
    }
  })
  .catch(err => {
    console.error('Test script error:', err)
  })
