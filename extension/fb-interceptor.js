/**
 * fb-interceptor.js — monde PRINCIPAL, pages Marketplace de Facebook.
 *
 * Mode PASSIF, et c'est un choix, pas une limitation technique : rien ici
 * n'ouvre d'onglet, ne fait defiler, ne clique ni ne declenche de requete. On
 * lit uniquement ce que la page a charge parce que TU la consultes. Une
 * extension qui pilote une session Facebook connectee viole les conditions
 * d'utilisation et expose le compte personnel a une restriction — le prix
 * d'une erreur est sans commune mesure avec le captcha de Leboncoin.
 *
 * Facebook n'expose pas de __NEXT_DATA__ : les annonces arrivent par reponses
 * GraphQL (souvent plusieurs objets JSON separes par des sauts de ligne) et
 * dans des blocs <script type="application/json"> au premier rendu.
 */
(() => {
  const seen = new Set();
  const MAX_SCAN = 4_000_000; // au-dela, on ne scanne pas : blobs de plusieurs Mo

  const emit = (ads, source) => {
    if (!ads || !ads.length) return;
    const fresh = ads.filter((a) => {
      const k = String(a.id);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!fresh.length) return;
    window.dispatchEvent(new CustomEvent("lba:fb-ads", { detail: { ads: fresh, source } }));
  };

  /* ------------------------------------------------------------------ *
   * Reconnaissance d'une annonce Marketplace
   * ------------------------------------------------------------------ */

  const isListing = (o) =>
    o &&
    typeof o === "object" &&
    o.id != null &&
    o.listing_price != null &&
    (typeof o.marketplace_listing_title === "string" || typeof o.custom_title === "string");

  /**
   * Collecte TOUTES les annonces d'un objet JSON, et pas le plus grand tableau
   * comme cote Leboncoin : Facebook les imbrique une par une sous
   * feed_units.edges[].node.listing.
   */
  function collectListings(root) {
    const out = [];
    const walk = (node, d) => {
      if (!node || typeof node !== "object" || d > 18 || out.length > 400) return;
      if (isListing(node)) { out.push(node); return; }
      if (Array.isArray(node)) { for (const v of node) walk(v, d + 1); return; }
      for (const k in node) walk(node[k], d + 1);
    };
    walk(root, 0);
    return out;
  }

  /** Isole chaque objet contenant une cle donnee, par comptage d'accolades. */
  function extractObjectsByKey(text, key) {
    const out = [];
    let idx = 0;
    while ((idx = text.indexOf(key, idx)) !== -1 && out.length < 400) {
      const start = text.lastIndexOf("{", idx);
      if (start === -1) { idx += key.length; continue; }
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < text.length && i - start < 80000; i++) {
        const c = text[i];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) { idx += key.length; continue; }
      try {
        const o = JSON.parse(text.slice(start, end + 1));
        if (isListing(o)) out.push(o);
      } catch (e) { /* fragment tronque */ }
      idx = end;
    }
    return out;
  }

  function scanText(text, source) {
    if (!text || text.length > MAX_SCAN) return;
    if (text.indexOf("listing_price") === -1) return;

    // Une reponse GraphQL peut contenir plusieurs objets JSON, un par ligne.
    const chunks = text.indexOf("\n") === -1 ? [text] : text.split("\n");
    let found = [];
    const unreadable = [];
    for (const c of chunks) {
      const t = c.trim();
      if (!t) continue;
      if (t[0] === "{") {
        try {
          found = found.concat(collectListings(JSON.parse(t)));
          continue;
        } catch (e) { /* illisible d'un bloc : repris plus bas */ }
      }
      // Pas de `continue` ici : Facebook prefixe souvent ses reponses d'un
      // `for (;;);` anti-detournement, qui rend la ligne impossible a parser
      // alors que les objets qu'elle contient sont complets.
      unreadable.push(t);
    }

    // Les fragments illisibles — reponse coupee en cours de transfert, forme
    // inattendue — sont repris objet par objet, sans renoncer a ceux qui ont
    // ete lus normalement. L'extraction par cle rattrape une fin manquante.
    for (const t of unreadable) {
      if (t.indexOf("listing_price") === -1) continue;
      let raw = extractObjectsByKey(t, '"marketplace_listing_title"');
      if (!raw.length) raw = extractObjectsByKey(t, '"custom_title"');
      found = found.concat(raw);
    }

    emit(found, unreadable.length ? source + "+raw" : source);
  }

  /* ------------------------------------------------------------------ *
   * Ecoute des reponses que la page recupere d'elle-meme
   * ------------------------------------------------------------------ */

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        const url = (res && res.url) || String(args[0]);
        if (!/facebook\.com/.test(url)) return;
        res.clone().text().then((t) => scanText(t, "graphql")).catch(() => {});
      } catch (e) { /* ne jamais casser la page */ }
    }).catch(() => {});
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__lbaUrl = u;
    return origOpen.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener("load", () => {
      try {
        if (!/facebook\.com/.test(String(this.__lbaUrl || ""))) return;
        if (typeof this.responseText === "string") scanText(this.responseText, "xhr");
      } catch (e) { /* idem */ }
    });
    return origSend.apply(this, a);
  };

  /* ------------------------------------------------------------------ *
   * Contenu deja present au premier rendu
   * ------------------------------------------------------------------ */

  function harvestDocument(reason) {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (s.textContent && s.textContent.indexOf("listing_price") !== -1) {
        scanText(s.textContent, "inline:" + reason);
      }
    }
  }

  window.addEventListener("load", () => setTimeout(() => harvestDocument("load"), 2000), { once: true });
  window.addEventListener("lba:fb-harvest", () => harvestDocument("ask"));

  console.debug("[LBA/fb] lecture passive active");
})();
