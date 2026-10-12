/* Proxy per Conto Economico e Rendiconto Finanziario.
   Inoltra il corpo della richiesta a /v1/messages così com'è.
   Chiave: header «x-user-key» (digitata nel programma) oppure ANTHROPIC_API_KEY.
   Se hai già il tuo api/anthropic.js funzionante, puoi sostituire questo file. */
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { type: "method_not_allowed", message: "Usa POST" } });
  const chiave = req.headers["x-user-key"] || process.env.ANTHROPIC_API_KEY;
  if (!chiave) return res.status(401).json({ error: { type: "authentication_error", message: "Nessuna chiave Anthropic: impostala nel programma o in ANTHROPIC_API_KEY." } });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01" },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    });
    const testo = await r.text();
    res.status(r.status).setHeader("content-type", "application/json").send(testo);
  } catch (e) {
    res.status(502).json({ error: { type: "api_error", message: `Proxy: ${e.message}` } });
  }
}
