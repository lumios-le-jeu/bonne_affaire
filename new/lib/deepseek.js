/**
 * Client DeepSeek — API compatible OpenAI.
 * La clé ne quitte jamais le serveur.
 *
 * Vision : modèle "deepseek-flash", images en data URL base64 dans un bloc
 * image_url, 1024 tokens d'image au maximum, détail "original" pour garder
 * la texture (indispensable pour repérer mucus et traces de sang).
 */

/* Lues à chaque appel, et non au chargement du module : le .env peut être
   chargé après le require, et la configuration reste modifiable à chaud. */
const base = () => process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const modelName = () => process.env.DEEPSEEK_MODEL || "deepseek-flash";

/* deepseek-flash raisonne par défaut, en effort « high ». La chaîne de pensée
   consomme le budget de sortie avant que le JSON ne soit écrit : la réponse
   arrive alors coupée. Pour une extraction structurée on n'en a pas besoin —
   on la désactive, ce qui divise aussi le coût et la latence par deux ou trois. */
const thinkingMode = () => (process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled");

class DeepSeekError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function key() {
  const k = process.env.DEEPSEEK_API_KEY;
  if (!k) throw new DeepSeekError("no_key", "DEEPSEEK_API_KEY absente. Copiez .env.example en .env et renseignez votre clé.", 500);
  return k;
}

async function chat(messages, { json = false, maxTokens = 1400, temperature = 0.2, signal } = {}) {
  const body = {
    model: modelName(),
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
    thinking: { type: thinkingMode() }
  };
  if (thinkingMode() === "enabled") body.reasoning_effort = process.env.DEEPSEEK_REASONING_EFFORT || "medium";
  if (json) body.response_format = { type: "json_object" };

  let res;
  try {
    res = await fetch(base() + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key() },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if (e instanceof DeepSeekError) throw e;
    throw new DeepSeekError("network", "Impossible de joindre l'API DeepSeek : " + e.message, 502);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const map = {
      401: ["bad_key", "Clé API refusée. Vérifiez DEEPSEEK_API_KEY."],
      402: ["no_credit", "Solde DeepSeek insuffisant."],
      422: ["bad_request", "Requête refusée par l'API."],
      429: ["rate_limited", "Trop de requêtes. Réessayez dans un instant."],
      503: ["busy", "Serveur DeepSeek surchargé."]
    };
    const [code, msg] = map[res.status] || ["upstream", "Erreur DeepSeek " + res.status];
    throw new DeepSeekError(code, msg + (text ? " — " + text.slice(0, 300) : ""), res.status);
  }

  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  return {
    content: msg.content ?? "",
    // En mode raisonnement, la chaîne de pensée arrive à part. On la garde
    // comme filet de sécurité : il arrive que la réponse finale s'y trouve.
    reasoning: msg.reasoning_content ?? "",
    usage: data?.usage || null,
    finish: data?.choices?.[0]?.finish_reason
  };
}

/**
 * JSON, avec deux garde-fous : un contenu vide (défaut connu du mode JSON)
 * déclenche une relance, et une réponse coupée en déclenche une autre avec un
 * budget de sortie doublé, au lieu de renvoyer une erreur à l'utilisateur.
 */
async function chatJSON(messages, opts = {}) {
  let maxTokens = opts.maxTokens || 2000;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await chat(messages, Object.assign({}, opts, { json: true, maxTokens, temperature: attempt ? 0.4 : 0.2 }));
    const parsed = extractJSON(r.content) || extractJSON(r.reasoning);
    if (parsed) return { data: parsed, usage: r.usage, raw: r.content, tentatives: attempt + 1 };
    last = r;
    if (r.finish === "length") maxTokens = Math.min(maxTokens * 2, 8000);
  }
  if (last && last.finish === "length") {
    throw new DeepSeekError("truncated", "Réponse encore coupée à " + maxTokens + " tokens. Le modèle raisonne-t-il ? Vérifiez DEEPSEEK_THINKING.", 502);
  }
  throw new DeepSeekError("invalid_json", "L'API n'a pas renvoyé de JSON exploitable.", 502);
}

function extractJSON(text) {
  if (!text || !text.trim()) return null;
  const tries = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t.trim());
      if (v && typeof v === "object") return v;
    } catch (e) { /* suivant */ }
  }
  return null;
}

const imagePart = (buf, detail = "original") => ({
  type: "image_url",
  image_url: { url: "data:image/jpeg;base64," + buf.toString("base64"), detail }
});

/** Tarifs publics au 11/09/2026, en dollars par million de tokens. */
const RATES = {
  peak: { in: 0.3, out: 1.2 },
  offpeak: { in: 0.15, out: 0.6 }
};
function estimateCost(usage, when = new Date()) {
  if (!usage) return null;
  // Heures pleines : lundi au vendredi, 01:00–04:00 et 06:00–10:00 UTC.
  const d = when.getUTCDay(), h = when.getUTCHours();
  const peak = d >= 1 && d <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
  const r = peak ? RATES.peak : RATES.offpeak;
  const usd = (usage.prompt_tokens || 0) / 1e6 * r.in + (usage.completion_tokens || 0) / 1e6 * r.out;
  return { usd: Number(usd.toFixed(6)), tarif: peak ? "heures pleines" : "heures creuses", usage };
}

module.exports = { chat, chatJSON, imagePart, estimateCost, DeepSeekError, modelName, thinkingMode };
