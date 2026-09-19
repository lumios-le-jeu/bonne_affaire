/**
 * interceptor.js — s'execute dans le MONDE PRINCIPAL de la page (world: MAIN).
 *
 * Role : ecouter, sans rien declencher. On patche fetch et XMLHttpRequest pour
 * lire les reponses JSON que le site recupere de lui-meme (api.leboncoin.fr,
 * routes internes /api/..., payload RSC). Aucune requete n'est emise par nous :
 * du point de vue de DataDome, le trafic reste exactement celui d'un humain
 * qui consulte la page.
 *
 * Les annonces trouvees sont transmises au content script (monde isole) via un
 * CustomEvent, seul canal possible entre les deux mondes.
 */
(() => {
  const TAG = "[LBA/intercept]";
  const seen = new Set();

  const emit = (ads, source, meta) => {
    if (!ads || !ads.length) return;
    // Deduplication locale a la page : le meme lot peut transiter par le
    // payload RSC puis par un fetch de pagination.
    const fresh = ads.filter((a) => {
      const k = String(a.list_id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!fresh.length) return;
    window.dispatchEvent(
      new CustomEvent("lba:ads", { detail: { ads: fresh, source, meta: meta || {} } })
    );
  };

  /* ------------------------------------------------------------------ *
   * Extraction generique
   * ------------------------------------------------------------------ */

  const isAd = (o) =>
    o && typeof o === "object" && o.list_id != null && typeof o.subject === "string";

  /** Parcourt un objet JSON et renvoie le plus grand tableau d'annonces trouve. */
  function deepFindAds(root, depth = 0) {
    let best = [];
    let total = null;
    const walk = (node, d) => {
      if (!node || typeof node !== "object" || d > 12) return;
      if (Array.isArray(node)) {
        if (node.length && isAd(node[0])) {
          const ads = node.filter(isAd);
          if (ads.length > best.length) best = ads;
          return;
        }
        for (const v of node) walk(v, d + 1);
        return;
      }
      if (typeof node.total === "number" && total == null) total = node.total;
      if (typeof node.total_all === "number" && total == null) total = node.total_all;
      for (const k in node) walk(node[k], d + 1);
    };
    walk(root, depth);
    return { ads: best, total };
  }

  /**
   * Filet de securite pour le payload RSC (self.__next_f) : ce n'est pas du JSON
   * valide d'un bloc, mais les objets annonce le sont individuellement. On
   * scanne le texte et on isole chaque objet contenant "list_id" par comptage
   * d'accolades, en ignorant les accolades a l'interieur des chaines.
   */
  function extractObjectsByKey(text, key = '"list_id"') {
    const out = [];
    let idx = 0;
    while ((idx = text.indexOf(key, idx)) !== -1) {
      // Remonte jusqu'a l'accolade ouvrante de l'objet courant.
      let start = text.lastIndexOf("{", idx);
      if (start === -1) { idx += key.length; continue; }
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < text.length && i - start < 60000; i++) {
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
        if (isAd(o)) out.push(o);
      } catch (e) { /* fragment tronque : on passe */ }
      idx = end;
    }
    return out;
  }

  function scanText(text, source) {
    if (!text || text.indexOf("list_id") === -1) return;
    try {
      const { ads, total } = deepFindAds(JSON.parse(text));
      if (ads.length) return emit(ads, source, { total });
    } catch (e) { /* pas du JSON d'un bloc : on tente le scan brut */ }
    emit(extractObjectsByKey(text), source + ":raw");
  }

  /* ------------------------------------------------------------------ *
   * Patch fetch / XHR
   * ------------------------------------------------------------------ */

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        const url = (res && res.url) || String(args[0]);
        if (!/leboncoin\.fr/.test(url)) return;
        res.clone().text().then((t) => scanText(t, "fetch")).catch(() => {});
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
        if (!/leboncoin\.fr/.test(String(this.__lbaUrl || ""))) return;
        if (typeof this.responseText === "string") scanText(this.responseText, "xhr");
      } catch (e) { /* idem */ }
    });
    return origSend.apply(this, a);
  };

  /* ------------------------------------------------------------------ *
   * Contenu deja present dans le document (rendu serveur)
   * ------------------------------------------------------------------ */

  function harvestDocument(reason) {
    // 1. Pages Router historique
    const nd = document.getElementById("__NEXT_DATA__");
    if (nd && nd.textContent) scanText(nd.textContent, "next-data:" + reason);

    // 2. App Router : payload RSC accumule dans self.__next_f
    try {
      const f = self.__next_f;
      if (Array.isArray(f) && f.length) {
        const joined = f.map((c) => (Array.isArray(c) ? c[1] : c)).filter((s) => typeof s === "string").join("");
        if (joined.indexOf("list_id") !== -1) {
          // Le payload RSC echappe les guillemets : on desechappe avant de scanner.
          let t = joined;
          if (t.indexOf('\\"list_id\\"') !== -1) {
            try { t = JSON.parse('"' + joined.replace(/"/g, '\\"') + '"'); } catch (e) { /* garde l'original */ }
          }
          emit(extractObjectsByKey(t), "rsc:" + reason);
        }
      }
    } catch (e) { /* ignore */ }

    // 3. Dernier recours : scripts inline
    if (!seen.size) {
      for (const s of document.querySelectorAll("script:not([src])")) {
        if (s.textContent && s.textContent.indexOf("list_id") !== -1) {
          emit(extractObjectsByKey(s.textContent), "inline:" + reason);
        }
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => harvestDocument("dom"), { once: true });
  window.addEventListener("load", () => setTimeout(() => harvestDocument("load"), 1200), { once: true });
  // Le content script peut redemander une passe (navigation SPA, scroll tardif).
  window.addEventListener("lba:harvest", () => harvestDocument("ask"));

  console.debug(TAG, "actif");
})();
