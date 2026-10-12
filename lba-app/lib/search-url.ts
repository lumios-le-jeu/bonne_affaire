/**
 * Hygiene des URL de recherche Leboncoin.
 *
 * Un copier-coller depuis une page web, un PDF ou une messagerie embarque
 * souvent des caracteres invisibles : espace de largeur nulle (U+200B),
 * joiners, BOM, trait d'union conditionnel. Dans le parametre text= ils
 * faussent la recherche Leboncoin elle-meme et empechent tout rapprochement
 * avec l'URL reelle de la page.
 * Cas vecu : "text=%E2%80%8BV-STROM+800" — 2 annonces au lieu de 1 048.
 */

const INVISIBLE = /[\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g

/** Nettoie les valeurs de parametres d'une URL de recherche. Ne touche a l'URL que si necessaire. */
export function cleanSearchUrl(raw: string): string {
  const trimmed = raw.replace(INVISIBLE, '').trim()
  let u: URL
  try { u = new URL(trimmed) } catch { return trimmed }

  let changed = trimmed !== raw
  for (const [k, v] of [...u.searchParams]) {
    const c = v.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
    if (c !== v) { u.searchParams.set(k, c); changed = true }
  }
  return changed ? u.toString() : raw
}

/** Forme canonique d'une requete texte, pour comparer deux URL entre elles. */
export function normalizeQuery(text: string | null | undefined): string {
  return (text || '')
    .replace(INVISIBLE, '')
    .replace(/\+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Requete texte normalisee d'une URL Leboncoin, ou '' si illisible. */
export function queryOf(url: string): string {
  try { return normalizeQuery(new URL(url).searchParams.get('text')) } catch { return '' }
}

/** Site d'origine d'une URL de recherche. */
export function sourceOf(url: string): 'facebook' | 'leboncoin' | '' {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    if (h.endsWith('facebook.com')) return 'facebook'
    if (h.endsWith('leboncoin.fr')) return 'leboncoin'
    return ''
  } catch { return '' }
}

/**
 * Cle canonique d'une recherche, pour rapprocher une page visitee d'une
 * recherche suivie.
 *
 * Elle remplace la comparaison du seul parametre text=, qui confondait deux
 * recherches partageant le meme libelle mais pas la meme zone : "mac mini M4"
 * a Lille et "mac mini M4" en France entiere avaient la meme cle.
 *
 * Leboncoin : texte + categorie + zone.
 * Facebook  : identifiant de place de marche (dans le chemin) + requete.
 *
 * Renvoie '' si la recherche n'est pas identifiable — notamment une page
 * Marketplace sans requete, qu'il ne faut rattacher a rien.
 */
export function searchKeyOf(url: string): string {
  const source = sourceOf(url)
  if (!source) return ''
  let u: URL
  try { u = new URL(url) } catch { return '' }

  if (source === 'facebook') {
    const q = normalizeQuery(u.searchParams.get('query'))
    if (!q) return ''
    const place = u.pathname.match(/\/marketplace\/(\d+)/)
    return ['fb', place ? place[1] : '', q].join(':')
  }

  const text = normalizeQuery(u.searchParams.get('text'))
  if (!text) return ''
  return [
    'lbc',
    text,
    (u.searchParams.get('category') || '').trim(),
    normalizeQuery(u.searchParams.get('locations')),
  ].join(':')
}
