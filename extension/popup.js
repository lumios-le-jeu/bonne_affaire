const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.storage.local.get({
    plan: [], outbox: [], log: [], blockedUntil: 0, api: "http://localhost:3000",
  });

  // On ne reecrit pas le champ pendant que tu tapes dedans.
  if (document.activeElement !== $("api")) $("api").value = s.api;

  const blocked = s.blockedUntil > Date.now();
  $("state").textContent = blocked
    ? "bloque jusqu'a " + new Date(s.blockedUntil).toLocaleTimeString("fr-FR")
    : s.plan.length ? "en cours" : "au repos";
  $("state").className = blocked ? "bad" : "ok";

  $("plan").textContent = s.plan.length;
  $("next").textContent = s.plan.length
    ? new Date(s.plan[0].at).toLocaleTimeString("fr-FR")
    : "–";
  $("outbox").textContent = s.outbox.length;
  $("log").textContent = s.log.join("\n");
}

$("api").onchange = () => {
  const v = $("api").value.trim().replace(/\/+$/, "");
  chrome.storage.local.set({ api: v || "http://localhost:3000" });
};

$("run").onclick = () => chrome.runtime.sendMessage({ type: "popup:runNow" }, refresh);
$("reset").onclick = () => chrome.runtime.sendMessage({ type: "popup:reset" }, refresh);

refresh();
setInterval(refresh, 2000);
