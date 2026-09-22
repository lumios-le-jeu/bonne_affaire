/**
 * background.js — service worker MV3. Le chef d'orchestre.
 *
 * Principe directeur : une page a la fois, a un rythme humain, dans ta vraie
 * session Chrome. On ne fabrique pas de trafic, on en etale un peu.
 *
 * Etat persiste dans chrome.storage.local :
 *   plan        : [{searchId, url, page, at}]  file de visites a venir
 *   runs        : {searchId: runId}            run serveur en cours
 *   outbox      : [payload]                    lots non remis (app eteinte)
 *   blockedUntil: timestamp                    pause apres captcha
 *   lastQueueAt : timestamp                    derniere demande de plan
 */

const DEFAULT_API = "http://localhost:3000";
const TICK_MIN = 2;                       // reveil du worker
const GAP_MIN_MS = 45_000;                // ecart minimum entre deux pages
const GAP_MAX_MS = 180_000;               // ecart maximum
const TAB_TIMEOUT_MS = 55_000;            // au-dela, on abandonne la page
const BLOCK_PAUSE_MS = 6 * 3600_000;      // apres captcha : silence radio
const QUEUE_EVERY_MS = 6 * 3600_000;      // on redemande un plan 4x/jour
const PAGE_FULL = 30;                     // en dessous, la page est la derniere

const rnd = (a, b) => a + Math.random() * (b - a);
const now = () => Date.now();

const get = (k, d) => chrome.storage.local.get({ [k]: d }).then((o) => o[k]);
const set = (o) => chrome.storage.local.set(o);

async function log(line) {
  const l = await get("log", []);
  l.unshift(new Date().toLocaleTimeString("fr-FR") + "  " + line);
  await set({ log: l.slice(0, 120) });
  console.log("[LBA]", line);
}

/* ---------------------------------------------------------------------- *
 * Transport vers l'application locale
 * ---------------------------------------------------------------------- */

/** Base de l'app locale. Next bascule sur 3001 si 3000 est occupe : reglable
 *  depuis le popup plutot que de te laisser deviner pourquoi rien n'arrive. */
const api = () => get("api", DEFAULT_API);

async function send(path, body) {
  const res = await fetch((await api()) + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
  return res.json().catch(() => ({}));
}

/** Remet les lots mis de cote quand l'app n'etait pas lancee. */
async function flushOutbox() {
  const out = await get("outbox", []);
  if (!out.length) return;
  const rest = [];
  for (const item of out) {
    try { await send("/api/ingest", item); }
    catch (e) { rest.push(item); }
  }
  await set({ outbox: rest });
  if (out.length !== rest.length) await log(`outbox : ${out.length - rest.length} lot(s) remis`);
}

async function deliver(payload) {
  try {
    await send("/api/ingest", payload);
  } catch (e) {
    const out = await get("outbox", []);
    out.push(payload);
    await set({ outbox: out.slice(-400) });
    await log("app injoignable, lot mis de cote (" + out.length + ")");
  }
}

/* ---------------------------------------------------------------------- *
 * Construction du plan de la journee
 * ---------------------------------------------------------------------- */

async function buildPlan(force = false) {
  const blockedUntil = await get("blockedUntil", 0);
  if (!force && blockedUntil > now()) return;

  let queue;
  try {
    const res = await fetch((await api()) + "/api/queue" + (force ? "?force=1" : ""));
    if (!res.ok) throw new Error("HTTP " + res.status);
    queue = await res.json();
  } catch (e) {
    await log("plan impossible : " + e.message);
    return;
  }

  const jobs = [];
  const runs = {};
  let at = now() + (force ? 3_000 : rnd(60_000, 900_000)); // demarrage decale

  for (const s of queue.searches || []) {
    runs[s.searchId] = s.runId;
    for (const page of s.pages) {
      jobs.push({ searchId: s.searchId, runId: s.runId, url: s.url, page, at: Math.round(at) });
      at += rnd(GAP_MIN_MS, GAP_MAX_MS);
    }
    // Marqueur de fin de recherche : declenche le bilan cote serveur.
    jobs.push({ finalize: true, searchId: s.searchId, runId: s.runId, at: Math.round(at) });
    at += rnd(GAP_MIN_MS, GAP_MAX_MS);
  }

  await set({ plan: jobs, runs, lastQueueAt: now() });
  await log(`plan : ${jobs.length} etapes, fin prevue ${new Date(at).toLocaleTimeString("fr-FR")}`);
}

/* ---------------------------------------------------------------------- *
 * Execution d'une etape
 * ---------------------------------------------------------------------- */

let busy = false;

/**
 * Onglets ouverts par la collecte → etape du plan qu'ils servent.
 * C'est ce qui permet de rattacher un lot a sa recherche sans deviner : on
 * sait quel onglet on a ouvert et pour quoi. L'ancienne methode comparait le
 * parametre text= de l'URL, et perdait le lot au moindre ecart (caractere
 * invisible, "+" contre "%20", redirection de Leboncoin).
 */
const visits = new Map();

function pageUrl(url, page) {
  const u = new URL(url);
  if (page > 1) u.searchParams.set("page", String(page));
  else u.searchParams.delete("page");
  // Tri par date : les nouveautes d'abord, coherent avec le suivi quotidien.
  if (!u.searchParams.has("sort")) u.searchParams.set("sort", "time");
  return u.toString();
}

/** Ouvre l'URL dans un onglet d'arriere-plan et attend la fin de la moisson. */
function visit(url, job) {
  return new Promise(async (resolve) => {
    const tab = await chrome.tabs.create({ url, active: false });
    visits.set(tab.id, { searchId: job.searchId, runId: job.runId, page: job.page });
    let finished = false;

    const finish = async (status) => {
      if (finished) return;
      finished = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      clearTimeout(timer);
      // On garde l'association un moment : des lots tardifs peuvent encore
      // arriver pendant la fermeture de l'onglet.
      setTimeout(() => visits.delete(tab.id), 30_000);
      // Petite latence avant fermeture : on ne claque pas l'onglet a la milliseconde.
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), rnd(1500, 4000));
      resolve(status);
    };

    const onMsg = (msg, sender) => {
      if (!sender.tab || sender.tab.id !== tab.id) return;
      if (msg.type === "done") finish({ ok: true, count: msg.count });
      if (msg.type === "blocked") finish({ ok: false, blocked: true, why: msg.why });
    };
    chrome.runtime.onMessage.addListener(onMsg);

    const timer = setTimeout(() => finish({ ok: false, timeout: true }), TAB_TIMEOUT_MS);
  });
}

async function step() {
  if (busy) return;
  const blockedUntil = await get("blockedUntil", 0);
  if (blockedUntil > now()) return;

  const plan = await get("plan", []);
  if (!plan.length) return;
  if (plan[0].at > now()) return;

  busy = true;
  const job = plan.shift();
  await set({ plan });

  try {
    if (job.finalize) {
      await deliver({ finalize: true, searchId: job.searchId, runId: job.runId });
      await log("bilan envoye pour " + job.searchId);
    } else {
      const url = pageUrl(job.url, job.page);
      const r = await visit(url, job);
      if (r.blocked) {
        await set({ blockedUntil: now() + BLOCK_PAUSE_MS, plan: [] });
        await log("BLOQUE (" + r.why + ") — pause 6 h, plan annule");
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon128.png",
          title: "LBA Collector — captcha Leboncoin",
          message: "Ouvre leboncoin.fr et resous la verification. La collecte reprend ensuite.",
        });
      } else {
        await log(`page ${job.page} : ${r.ok ? r.count + " annonces" : "rien (timeout)"}`);

        // Page incomplete = fin des resultats. Inutile d'ouvrir les pages
        // suivantes, qui seront vides : sept onglets de moins par recherche
        // et par jour, donc sept occasions de moins de se faire remarquer.
        if ((r.count || 0) < PAGE_FULL) {
          const rest = await get("plan", []);
          const kept = [];
          let dropped = 0;
          for (const j of rest) {
            if (j.searchId === job.searchId && !j.finalize) { dropped++; continue; }
            kept.push(j);
          }
          if (dropped) {
            // Le bilan n'a plus de raison d'attendre son creneau initial.
            const fin = kept.find((j) => j.finalize && j.searchId === job.searchId);
            if (fin) fin.at = Math.min(fin.at, now() + 20_000);
            await set({ plan: kept });
            await log(`fin des resultats — ${dropped} page(s) vide(s) evitee(s)`);
          }
        }
      }
    }
  } catch (e) {
    await log("erreur etape : " + e.message);
  } finally {
    busy = false;
  }
}

/* ---------------------------------------------------------------------- *
 * Messages des content scripts
 * ---------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ads") {
    // Lu tout de suite, avant le moindre await : l'association onglet → etape
    // doit etre captee avant que la fin de visite ne la programme a l'effacement.
    const v = sender.tab ? visits.get(sender.tab.id) : null;
    (async () => {
      let searchId = v ? v.searchId : null;
      let runId = v ? v.runId : null;
      if (!searchId) {
        // Page ouverte par toi, hors plan : rapprochement sur la requete texte.
        const runs = await get("runs", {});
        searchId = matchSearch(msg.url, await get("plan", []));
        runId = searchId ? runs[searchId] || null : null;
      }
      await deliver({
        searchId,
        runId,
        url: msg.url,
        page: v ? v.page : msg.page,
        total: msg.total,
        source: msg.source,
        ads: msg.ads,
      });
    })();
  }
  if (msg.type === "blocked" && !busy) {
    set({ blockedUntil: now() + BLOCK_PAUSE_MS });
    log("blocage detecte pendant ta navigation — collecte en pause 6 h");
  }
  if (msg.type === "popup:runNow") {
    buildPlan(true).then(() => step()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "popup:reset") {
    chrome.storage.local.set({ plan: [], blockedUntil: 0 }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

/**
 * Rattachement d'un lot a une recherche suivie.
 * Toute page leboncoin que TU consultes est aussi moissonnee : si elle ne
 * correspond a aucune recherche du plan, on l'envoie sans searchId et le
 * serveur decide (ingestion opportuniste).
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

/** Meme normalisation que lib/search-url.ts cote serveur. */
function queryOf(url) {
  try {
    return (new URL(url).searchParams.get("text") || "")
      .replace(INVISIBLE, "")
      .replace(/\+/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  } catch (e) {
    return "";
  }
}

function matchSearch(url, plan) {
  const q = queryOf(url);
  if (!q) return null;
  for (const j of plan) {
    if (j.url && queryOf(j.url) === q) return j.searchId;
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * Horloge
 * ---------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tick", { periodInMinutes: TICK_MIN });
  log("installe");
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("tick", { periodInMinutes: TICK_MIN });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "tick") return;
  await flushOutbox();
  const last = await get("lastQueueAt", 0);
  const plan = await get("plan", []);
  if (!plan.length && now() - last > QUEUE_EVERY_MS) await buildPlan();
  await step();
});
