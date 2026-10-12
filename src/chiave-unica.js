/* =============================================================================
   Chiave API unica per tutta la suite.

   La chiave inserita una volta nella schermata «Documenti» vale per tutti i
   programmi (SP, CE, RF, Redditività e solvibilità, Analisi strategica,
   Quality of Earnings, Comparazione), senza toccarli: le loro richieste
   all'IA vengono intercettate qui.

   Due fornitori:
   - Anthropic: la chiave si aggiunge alle richieste verso i proxy dello stesso
     dominio, nello stesso punto in cui la metterebbe ciascun programma
       SP     → POST /api/chat       : campo «apiKey» (se il programma non ne ha una sua)
       CE, RF → POST /api/anthropic  : header «x-user-key» (se il programma non ne ha una sua)
   - OpenAI (es. gpt-5.4-mini): OGNI richiesta a Claude dei programmi
     (/api/chat, /api/anthropic, api.anthropic.com/v1/messages) viene tradotta
     per OpenAI e la risposta riportata nel formato che il programma si aspetta.
     I PDF viaggiano come file (input «file» di Chat Completions); la ricerca
     web di Analisi strategica usa lo strumento web search della Responses API.

   La chiave resta nella memoria della pagina; viene salvata nel browser solo
   se scegli «Ricorda in questo browser». Nell'artifact di claude.ai non serve:
   lì le richieste vanno al Claude di chi apre la pagina (ponte-artifact.js).
   ============================================================================= */
import { modalitaArtifact } from "./ponte-artifact.js";

const CHIAVE_LS = "suite_chiave_anthropic"; // chiave Anthropic (versioni precedenti)
const CONFIG_LS = "suite_config_ia"; // { provider, modello, chiavi: { anthropic, openai } }
export const MODELLO_OPENAI_PREDEFINITO = "gpt-5.4-mini";

const config = { provider: "anthropic", modello: MODELLO_OPENAI_PREDEFINITO, chiavi: { anthropic: "", openai: "" } };
const ascoltatori = new Set();

try {
  if (!modalitaArtifact) {
    const c = JSON.parse(window.localStorage.getItem(CONFIG_LS) || "null");
    if (c) {
      if (c.provider === "openai" || c.provider === "anthropic") config.provider = c.provider;
      if (c.modello) config.modello = c.modello;
      config.chiavi = { ...config.chiavi, ...(c.chiavi || {}) };
    }
    config.chiavi.anthropic ||= window.localStorage.getItem(CHIAVE_LS) || "";
  }
} catch { /* archiviazione non disponibile */ }

const salva = (ricorda) => {
  try {
    if (ricorda && (config.chiavi.anthropic || config.chiavi.openai)) {
      window.localStorage.setItem(CONFIG_LS, JSON.stringify(config));
      if (config.chiavi.anthropic) window.localStorage.setItem(CHIAVE_LS, config.chiavi.anthropic);
      else window.localStorage.removeItem(CHIAVE_LS);
    } else {
      window.localStorage.setItem(CONFIG_LS, JSON.stringify({ provider: config.provider, modello: config.modello, chiavi: {} }));
      window.localStorage.removeItem(CHIAVE_LS);
    }
  } catch { /* archiviazione non disponibile */ }
  ascoltatori.forEach((f) => f({ ...config, chiavi: { ...config.chiavi } }));
};

/* ---- interfaccia per la schermata «Documenti» ---- */
export const leggiProvider = () => config.provider;
export const leggiModello = () => config.modello;
export const leggiChiave = (provider = config.provider) => config.chiavi[provider] || "";
export const chiaveRicordata = () => {
  try { return !!(JSON.parse(window.localStorage.getItem(CONFIG_LS) || "{}").chiavi?.[config.provider] || window.localStorage.getItem(CHIAVE_LS)); } catch { return false; }
};
export function impostaChiave(nuova, ricorda) {
  config.chiavi[config.provider] = (nuova || "").trim();
  salva(ricorda);
}
export function impostaProvider(provider, ricorda) {
  if (provider !== "openai" && provider !== "anthropic") return;
  config.provider = provider;
  salva(ricorda);
}
export function impostaModello(modello, ricorda) {
  config.modello = (modello || "").trim() || MODELLO_OPENAI_PREDEFINITO;
  salva(ricorda);
}
export const suCambioChiave = (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); };

/* Chiavi configurate sull'hosting (risposta del proxy SP, solo booleani). */
const fetchOriginale = typeof window !== "undefined" ? window.fetch.bind(window) : null;
export async function chiaveSullHosting() {
  try {
    const r = await fetchOriginale("/api/chat");
    if (!r.ok) return null;
    const p = (await r.json()).providers || {};
    return { anthropic: !!p.claude, openai: !!p.openai };
  } catch { return null; }
}

/* ---------------------------------------------------------------------------
   Traduzione Anthropic → OpenAI
   --------------------------------------------------------------------------- */
const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/* Blocchi di contenuto in formato Anthropic → parti di un messaggio OpenAI. */
function partiOpenAI(contenuto) {
  if (typeof contenuto === "string") return [{ type: "text", text: contenuto }];
  const parti = [];
  let nDoc = 0;
  for (const b of contenuto || []) {
    if (!b) continue;
    if (b.type === "text") parti.push({ type: "text", text: b.text || "" });
    else if (b.type === "document" && b.source?.type === "base64") {
      nDoc++;
      parti.push({ type: "file", file: { filename: b.title || `documento-${nDoc}.pdf`, file_data: `data:${b.source.media_type || "application/pdf"};base64,${b.source.data}` } });
    } else if (b.type === "document" && b.source?.type === "text") parti.push({ type: "text", text: b.source.data || "" });
    else if (b.type === "document" && b.source?.type === "content") parti.push(...partiOpenAI(b.source.content));
    else if (b.type === "image" && b.source?.type === "base64") parti.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    else if (b.type === "image_url" || b.type === "file") parti.push(b); // già in formato OpenAI
    else if (b.type === "tool_result" || b.type === "tool_use") parti.push({ type: "text", text: JSON.stringify(b) });
  }
  return parti.length ? parti : [{ type: "text", text: "" }];
}

const testoDiSistema = (s) =>
  typeof s === "string" ? s : Array.isArray(s) ? s.map((b) => b?.text || "").join("\n\n") : "";

/* Errore OpenAI → stesso stato HTTP, con il messaggio nel formato Anthropic. */
async function erroreOpenAI(r) {
  let messaggio = `OpenAI ${r.status}`;
  try { const j = await r.json(); messaggio = j?.error?.message || messaggio; } catch { /* corpo illeggibile */ }
  return { status: r.status, messaggio };
}

/* I modelli «ragionanti» (gpt-5.x) spendono parte dei token nel ragionamento:
   il tetto si allarga perché la risposta non resti troncata. */
const tettoToken = (max) => Math.min(128000, Math.round((Number(max) || 4000) * 1.5) + 4000);

async function chatOpenAI({ system, messaggi, maxTokens, formatoJson = false }) {
  const corpo = {
    model: config.modello || MODELLO_OPENAI_PREDEFINITO,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messaggi.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.role === "assistant"
          ? partiOpenAI(m.content).map((p) => p.text || "").join("\n")
          : partiOpenAI(m.content),
      })),
    ],
    max_completion_tokens: tettoToken(maxTokens),
    reasoning_effort: "low",
    ...(formatoJson ? { response_format: { type: "json_object" } } : {}),
  };
  const invia = (c) => fetchOriginale("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.chiavi.openai}` },
    body: JSON.stringify(c),
  });
  let r = await invia(corpo);
  /* Un modello che non accetta un parametro: si riprova senza. */
  for (let i = 0; i < 2 && r.status === 400; i++) {
    const e = await r.clone().json().catch(() => ({}));
    const m = String(e?.error?.message || "") + " " + String(e?.error?.param || "");
    if (/reasoning_effort/.test(m) && corpo.reasoning_effort) { delete corpo.reasoning_effort; r = await invia(corpo); continue; }
    if (/response_format|json_object/.test(m) && corpo.response_format) { delete corpo.response_format; r = await invia(corpo); continue; }
    break;
  }
  if (!r.ok) throw await erroreOpenAI(r);
  const d = await r.json();
  const scelta = d.choices?.[0] || {};
  return {
    testo: scelta.message?.content || "",
    troncato: scelta.finish_reason === "length",
    uso: { input_tokens: d.usage?.prompt_tokens || 0, output_tokens: d.usage?.completion_tokens || 0 },
  };
}

/* Ricerca web (Analisi strategica): Responses API con lo strumento di ricerca,
   restituita come blocchi «web_search_tool_result» + testo con citazioni. */
async function ricercaWebOpenAI({ system, messaggi, maxTokens }) {
  const ultimo = [...messaggi].reverse().find((m) => m.role === "user");
  const testo = partiOpenAI(ultimo?.content).map((p) => p.text || "").join("\n");
  const r = await fetchOriginale("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.chiavi.openai}` },
    body: JSON.stringify({
      model: config.modello || MODELLO_OPENAI_PREDEFINITO,
      ...(system ? { instructions: system } : {}),
      input: testo,
      tools: [{ type: "web_search_preview" }],
      max_output_tokens: tettoToken(maxTokens),
    }),
  });
  if (!r.ok) throw await erroreOpenAI(r);
  const d = await r.json();
  const risultati = [];
  const citazioni = [];
  let out = "";
  for (const item of d.output || []) {
    if (item.type === "web_search_call") (item.action?.sources || []).forEach((s) => s.url && risultati.push({ type: "web_search_result", url: s.url, title: s.title || "" }));
    if (item.type === "message") for (const c of item.content || []) {
      if (c.type !== "output_text") continue;
      const base = out.length;
      out += c.text;
      for (const a of c.annotations || []) {
        if (a.type !== "url_citation" || !a.url) continue;
        risultati.push({ type: "web_search_result", url: a.url, title: a.title || "" });
        const da = base + (a.start_index ?? 0), a_ = base + (a.end_index ?? 0);
        citazioni.push({ type: "web_search_result_location", url: a.url, title: a.title || "", cited_text: out.slice(da, a_) });
      }
    }
  }
  return [
    { type: "web_search_tool_result", tool_use_id: "openai", content: risultati },
    { type: "text", text: out || d.output_text || "", citations: citazioni },
  ];
}

/* Una richiesta in formato Anthropic Messages → risposta in formato Anthropic. */
async function messaggioViaOpenAI(corpo) {
  const system = testoDiSistema(corpo.system);
  const messaggi = Array.isArray(corpo.messages) ? corpo.messages : [];
  const conRicerca = Array.isArray(corpo.tools) && corpo.tools.some((t) => /web_search|web_fetch/.test(String(t?.type || t?.name || "")));
  try {
    if (conRicerca) {
      const content = await ricercaWebOpenAI({ system, messaggi, maxTokens: corpo.max_tokens });
      return json({ id: "openai", type: "message", role: "assistant", model: config.modello, content, stop_reason: "end_turn" });
    }
    const r = await chatOpenAI({ system, messaggi, maxTokens: corpo.max_tokens });
    return json({
      id: "openai", type: "message", role: "assistant", model: config.modello,
      content: [{ type: "text", text: r.testo }],
      stop_reason: r.troncato ? "max_tokens" : "end_turn", usage: r.uso,
    });
  } catch (e) {
    const tipo = e.status === 429 ? "rate_limit_error" : e.status === 401 ? "authentication_error" : e.status >= 500 ? "api_error" : "invalid_request_error";
    return json({ type: "error", error: { type: tipo, message: e.messaggio || String(e?.message || e) } }, e.status || 500);
  }
}

/* Richiesta del proxy dello SP (/api/chat) → risposta { raw }. */
async function chatSpViaOpenAI(corpo) {
  const blocchi = [...(corpo.allegati || []), { type: "text", text: corpo.testo || "" }];
  try {
    const r = await chatOpenAI({ system: "", messaggi: [{ role: "user", content: blocchi }], maxTokens: corpo.maxTokens, formatoJson: /json/i.test(corpo.testo || "") });
    return json({ raw: r.testo });
  } catch (e) {
    return json({ errore: e.messaggio || String(e?.message || e), tipo: e.status === 429 ? "rate_limit_error" : "invalid_request_error", etichetta: "OpenAI" }, e.status || 500);
  }
}

/* ---------------------------------------------------------------------------
   Intercettazione delle richieste dei programmi (solo fuori dall'artifact)
   --------------------------------------------------------------------------- */
if (typeof window !== "undefined" && !modalitaArtifact) {
  window.fetch = async (risorsa, init) => {
    const url = typeof risorsa === "string" ? risorsa : risorsa?.url || "";
    const metodo = (init?.method || risorsa?.method || "GET").toUpperCase();
    const versoClaude = /\/api\/anthropic\b|api\.anthropic\.com\/v1\/messages/.test(url);
    const versoSp = /\/api\/chat\b/.test(url);

    /* OpenAI per tutti i programmi. */
    if (config.provider === "openai" && config.chiavi.openai) {
      if (versoSp && metodo === "GET") return json({ providers: { claude: true, openai: true, gemini: false } });
      if (versoSp && metodo === "POST") {
        const corpo = JSON.parse(init?.body || "{}");
        /* Un programma che chiede espressamente un altro fornitore con la sua chiave resta com'è. */
        if (corpo.provider && corpo.provider !== "claude" && corpo.apiKey) return fetchOriginale(risorsa, init);
        return chatSpViaOpenAI(corpo);
      }
      if (versoClaude && metodo === "POST") return messaggioViaOpenAI(JSON.parse(init?.body || "{}"));
      /* Chiamate dirette a OpenAI dai programmi senza una chiave loro: si usa quella unica. */
      if (/api\.openai\.com/.test(url)) {
        const h = new Headers(init?.headers || {});
        if (!/Bearer\s+\S{8,}/.test(h.get("authorization") || "")) h.set("authorization", `Bearer ${config.chiavi.openai}`);
        return fetchOriginale(risorsa, { ...init, headers: h });
      }
      return fetchOriginale(risorsa, init);
    }

    /* Anthropic: la chiave unica nei proxy dello stesso dominio. */
    const chiave = config.chiavi.anthropic;
    if (!chiave) return fetchOriginale(risorsa, init);
    if (versoSp && metodo === "GET") {
      const r = await fetchOriginale(risorsa, init);
      const d = r.ok ? await r.json().catch(() => ({})) : {};
      return json({ ...d, providers: { ...(d.providers || {}), claude: true } });
    }
    if (versoSp && metodo === "POST" && typeof init?.body === "string") {
      const corpo = JSON.parse(init.body);
      if ((corpo.provider || "claude") === "claude" && !corpo.apiKey) corpo.apiKey = chiave;
      return fetchOriginale(risorsa, { ...init, body: JSON.stringify(corpo) });
    }
    if (/\/api\/anthropic\b/.test(url) && metodo === "POST") {
      const h = new Headers(init?.headers || {});
      if (!h.has("x-user-key")) h.set("x-user-key", chiave);
      return fetchOriginale(risorsa, { ...init, headers: h });
    }
    return fetchOriginale(risorsa, init);
  };
}
