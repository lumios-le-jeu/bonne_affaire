/**
 * fb-content.js — monde isole, pages Marketplace.
 *
 * Relais passif. Aucune action sur la page : pas de defilement automatique,
 * pas de clic, pas d'onglet. Les annonces remontees sont celles que la page a
 * chargees pendant que tu la consultes.
 *
 * Les lots sont regroupes avant envoi : Facebook emet beaucoup de petites
 * reponses pendant un defilement, inutile d'ouvrir une requete pour chacune.
 */
(() => {
  const FLUSH_MS = 2500;
  const MAX_BATCH = 120;

  let pending = [];
  let timer = null;

  const flush = () => {
    timer = null;
    if (!pending.length) return;
    const ads = pending.splice(0, MAX_BATCH);
    try {
      chrome.runtime.sendMessage({ type: "fb-ads", url: location.href, ads });
    } catch (e) { /* service worker endormi : le lot suivant repassera */ }
    if (pending.length) timer = setTimeout(flush, FLUSH_MS);
  };

  window.addEventListener("lba:fb-ads", (e) => {
    const { ads } = e.detail || {};
    if (!ads || !ads.length) return;
    pending = pending.concat(ads);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  });

  // Facebook navigue sans recharger la page : a chaque changement d'URL, on
  // redemande une lecture du contenu deja rendu.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    flush();
    setTimeout(() => window.dispatchEvent(new CustomEvent("lba:fb-harvest")), 2500);
  }, 1500);

  window.addEventListener("beforeunload", flush);
})();
