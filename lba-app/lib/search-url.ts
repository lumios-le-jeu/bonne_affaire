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
