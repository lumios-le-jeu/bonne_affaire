/**
 * content.js — monde isole. Pont entre la page et le service worker.
 *
 * Trois responsabilites :
 *  - recevoir les annonces captees par interceptor.js et les relayer ;
 *  - detecter un blocage DataDome et le signaler immediatement ;
 *  - simuler une presence humaine minimale (petit scroll) pour que la page
 *    charge ses images et ses lots differes, comme lors d'une vraie lecture.
 */
(() => {
  const MAX_BODY = 1000; // on garde un extrait du texte pour l'analyse IA
  let sent = 0;

  const slim = (ad) => {
    const o = { ...ad };
    if (typeof o.body === "string" && o.body.length > MAX_BODY) o.body = o.body.slice(0, MAX_BODY);
    // Champs volumineux et sans valeur analytique.
    delete o.similar_ads;
    delete o.counters;
    return o;
  };

  const post = (msg) => {
    try { chrome.runtime.sendMessage(msg); } catch (e) { /* worker endormi */ }
  };

  window.addEventListener("lba:ads", (e) => {
    const { ads, source, meta } = e.detail || {};
    if (!ads || !ads.length) return;
    sent += ads.length;
    post({
      type: "ads",
      url: location.href,
      page: Number(new URLSearchParams(location.search).get("page") || 1),
      total: meta && meta.total != null ? meta.total : null,
      source,
      ads: ads.map(slim),
    });
  });

  /* --------------------------- Detection blocage --------------------------- */

  const BLOCK_HINTS = [
    "geo.captcha-delivery.com",
    "captcha-delivery.com",
    "/interstitial",
  ];

  function looksBlocked() {
    if (BLOCK_HINTS.some((h) => location.href.includes(h))) return "url";
    if (document.querySelector('iframe[src*="captcha-delivery"]')) return "iframe";
    const t = (document.body && document.body.innerText) || "";
    if (/robot|v[ée]rification|captcha|Faites glisser vers la droite/i.test(t) && t.length < 3000) {
      return "texte";
    }
    return null;
  }

  function checkBlocked() {
    const why = looksBlocked();
    if (why) {
      post({ type: "blocked", url: location.href, why });
      return true;
    }
    return false;
  }

  /* --------------------------- Cycle de vie page --------------------------- */

  const humanScroll = () => {
    // Trois petits mouvements espaces, pas un saut en bas de page.
    let n = 0;
    const step = () => {
      if (n++ > 2) return;
      window.scrollBy({ top: 500 + Math.random() * 600, behavior: "smooth" });
      setTimeout(step, 900 + Math.random() * 1400);
    };
    setTimeout(step, 1200 + Math.random() * 1000);
  };

  window.addEventListener("load", () => {
    if (checkBlocked()) return;
    humanScroll();
    // Relance de la moisson apres le chargement differe.
    setTimeout(() => window.dispatchEvent(new CustomEvent("lba:harvest")), 2500);
    setTimeout(() => {
      if (checkBlocked()) return;
      window.dispatchEvent(new CustomEvent("lba:harvest"));
      post({ type: "done", url: location.href, count: sent });
    }, 6000);
  });

  // Un blocage peut apparaitre apres coup (redirection DataDome).
  const mo = new MutationObserver(() => { if (looksBlocked()) checkBlocked(); });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }
})();
