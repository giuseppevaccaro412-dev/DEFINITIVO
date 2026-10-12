/* Proxy per lo Stato Patrimoniale (contratto di RiclassificazioneSP.jsx).
   GET  → { providers: { claude, openai, gemini } } : quali chiavi esistono sull'hosting (solo booleani)
   POST { provider, modello, maxTokens, testo, allegati, apiKey? } → { raw }
        errori → { errore, tipo, etichetta } con lo stato HTTP del provider.
   Se hai già il tuo api/chat.js funzionante, puoi sostituire questo file. */
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

const ENV = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
const ETICHETTA = { claude: "Claude", openai: "OpenAI", gemini: "Gemini" };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ providers: Object.fromEntries(Object.entries(ENV).map(([p, v]) => [p, !!process.env[v]])) });
  }
  if (req.method !== "POST") return res.status(405).json({ errore: "Usa GET o POST" });

  const corpo = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { provider = "claude", modello, maxTokens = 4000, testo = "", allegati = [], apiKey } = corpo;
  const etichetta = ETICHETTA[provider] || provider;
  const chiave = apiKey || process.env[ENV[provider]];
  if (!chiave) return res.status(401).json({ errore: `Nessuna chiave per ${etichetta}`, tipo: "authentication_error", etichetta });

  try {
    let r, raw;
    if (provider === "openai") {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${chiave}` },
        body: JSON.stringify({
          model: modello,
          max_completion_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: [...allegati, { type: "text", text: testo }] }],
        }),
      });
      if (r.ok) raw = (await r.json()).choices?.[0]?.message?.content || "";
    } else if (provider === "gemini") {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": chiave },
        body: JSON.stringify({
          contents: [{ parts: [...allegati, { text: testo }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens },
        }),
      });
      if (r.ok) raw = ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    } else {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: modello,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: [...allegati, { type: "text", text: testo }] }],
        }),
      });
      if (r.ok) raw = ((await r.json()).content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    if (!r.ok) {
      const dett = await r.json().catch(() => ({}));
      const err = dett.error || {};
      return res.status(r.status).json({ errore: err.message || `HTTP ${r.status}`, tipo: err.type || err.status || "", etichetta });
    }
    res.status(200).json({ raw });
  } catch (e) {
    res.status(502).json({ errore: `Proxy: ${e.message}`, tipo: "api_error", etichetta });
  }
}
