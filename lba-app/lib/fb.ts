import type { NormalAd } from './ingest'

/**
 * Normalisation des annonces Facebook Marketplace.
 *
 * Facebook sert ses annonces par GraphQL, avec des noms de champs qui lui sont
 * propres et qui changent plus souvent que ceux de Leboncoin. On ne lit donc
 * que des champs tolerants aux variantes, et on garde la charge brute dans
 * `raw` : si la forme bouge, les donnees passees restent exploitables sans
 * avoir a tout recollecter.
 */

export interface FbListing {
  id: string | number
  marketplace_listing_title?: string
  custom_title?: string
  listing_price?: { amount?: string | number; formatted_amount?: string; amount_with_offset?: string }
  location?: { reverse_geocode?: { city?: string; state?: string; city_page?: { display_name?: string } } }
  primary_listing_photo?: { image?: { uri?: string } }
  listing_photos?: { image?: { uri?: string } }[]
  creation_time?: number
  is_sold?: boolean
  is_live?: boolean
  marketplace_listing_seller?: { __typename?: string; name?: string }
  delivery_types?: string[]
  is_shipping_offered?: boolean
}

/** Identifiant prefixe : les id numeriques des deux sites pourraient se telescoper. */
export const fbId = (id: string | number) => `fb:${id}`

function parsePrice(p: FbListing['listing_price']): number | null {
  if (!p) return null
  const direct = typeof p.amount === 'number' ? p.amount : parseFloat(String(p.amount ?? ''))
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)

  // amount_with_offset est en centimes.
  const offset = parseFloat(String(p.amount_with_offset ?? ''))
  if (Number.isFinite(offset) && offset > 0) return Math.round(offset / 100)

  // Dernier recours : "1 250 €" — on retire espaces fines et separateurs.
  const digits = (p.formatted_amount || '').replace(/[^\d]/g, '')
  const n = parseInt(digits, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function normalizeFb(ad: FbListing): NormalAd | null {
  if (!ad || ad.id == null) return null

  const title = ad.marketplace_listing_title || ad.custom_title
  if (!title) return null

  const price = parsePrice(ad.listing_price)
  // Marketplace est plein d'annonces a 0 € (dons, "faire offre") : elles
  // fausseraient toute statistique de prix.
  if (!price || price > 50_000_000) return null

  const geo = ad.location?.reverse_geocode
  const photo = ad.primary_listing_photo?.image?.uri || ad.listing_photos?.[0]?.image?.uri || null

  const shipping =
    ad.is_shipping_offered === true ||
    (Array.isArray(ad.delivery_types) && ad.delivery_types.some((d) => /ship|deliver/i.test(d)))

  return {
    id: fbId(ad.id),
    title,
    price,
    location: geo?.city_page?.display_name || geo?.city || null,
    zipcode: null,
    thumb: photo,
    url: `https://www.facebook.com/marketplace/item/${ad.id}/`,
    // Un vendeur de type Page est un professionnel ; un User est un particulier.
    isPro: (ad.marketplace_listing_seller?.__typename || '') === 'Page',
    hasShipping: !!shipping,
    publishedAt: ad.creation_time ? new Date(ad.creation_time * 1000) : null,
    raw: JSON.stringify({
      seller: ad.marketplace_listing_seller?.__typename,
      isSold: ad.is_sold === true,
      isLive: ad.is_live,
      delivery: ad.delivery_types,
      formattedPrice: ad.listing_price?.formatted_amount,
    }),
  }
}

/** Facebook annonce lui-meme qu'un article est vendu — Leboncoin, jamais. */
export const fbIsSold = (ad: FbListing) => ad?.is_sold === true
