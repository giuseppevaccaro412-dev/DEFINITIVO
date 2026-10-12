/* =============================================================================
   Ponte per l'artifact di Claude.

   Dentro un artifact pubblicato su claude.ai la pagina non può chiamare né i
   proxy (/api/chat, /api/anthropic) né l'API di Anthropic. Questo file, attivo
   SOLO lì (su Vercel non fa nulla), intercetta quelle richieste e le gira al
   Claude di chi apre la pagina tramite la capability «sample», poi risponde nel
   formato che ciascun programma si aspetta. I tre programmi restano invariati.

   Differenze rispetto alla chiamata nativa:
   - i PDF non possono viaggiare come documento: se ne estrae il testo pagina
     per pagina (pdf.js) e le pagine senza testo vengono mandate come immagini;
     se il testo supera il limite di una richiesta si tengono le pagine più
     pertinenti (prima si tagliava dall'inizio e i prospetti andavano persi);
   - gli errori non vengono mai segnalati come temporanei, così i programmi non
     ripetono la richiesta in automatico.
   ============================================================================= */

const HOST_ARTIFACT = /(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/;
const attivo =
  typeof window !== "undefined" &&
  (HOST_ARTIFACT.test(window.location?.hostname || "") || typeof window.claude?.use === "function");

export const modalitaArtifact = attivo;

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const MAX_BYTE_TESTO = 250_000;

let promessaSample = null;
const ottieniSample = () => {
  if (!promessaSample)
    promessaSample = (async () => {
      const s = window.claude?.use ? await window.claude.use("sample") : null;
      const limiti = s ? await s.limits().catch(() => null) : null;
      return { s, limiti };
    })();
  return promessaSample;
};

/* Al massimo 2 richieste a Claude insieme: le altre aspettano il turno. */
let attive = 0;
const coda = [];
const limita = (fn) =>
  new Promise((ok, ko) => {
    const via = () => {
      attive++;
      fn().then(ok, ko).finally(() => { attive--; coda.shift()?.(); });
    };
    attive < 2 ? via() : coda.push(via);
  });

/* ---------- pdf.js (stessa versione usata dai programmi) ---------- */
let promessaPdfJs = null;
const caricaPdfJs = () => {
  if (!promessaPdfJs)
    promessaPdfJs = new Promise((ok, ko) => {
      const pronto = () => {
        const lib = window.pdfjsLib;
        if (!lib.GlobalWorkerOptions.workerSrc)
          lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
            new Blob([`importScripts("${PDFJS}/pdf.worker.min.js");`], { type: "application/javascript" })
          );
        ok(lib);
      };
      if (window.pdfjsLib) return pronto();
      const s = document.createElement("script");
      s.src = `${PDFJS}/pdf.min.js`;
      s.onload = () => (window.pdfjsLib ? pronto() : ko(new Error("pdf.js non disponibile")));
      s.onerror = () => ko(new Error("pdf.js non caricato"));
      document.head.appendChild(s);
    });
  return promessaPdfJs;
};

const daBase64 = (b64) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

/* Ricostruisce le righe delle tabelle ordinando i frammenti per y e poi per x. */
function righeDellaPagina(items) {
  const pezzi = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const righe = [];
  let r = null;
  for (const p of pezzi) {
    if (!r || Math.abs(p.y - r.y) > 2.5) { r = { y: p.y, parti: [] }; righe.push(r); }
    r.parti.push(p);
  }
  return righe
    .map((riga) => {
      riga.parti.sort((a, b) => a.x - b.x);
      let out = "", fine = null;
      for (const p of riga.parti) {
        if (fine != null) out += p.x - fine > 12 ? "   " : p.x - fine > 1.5 ? " " : "";
        out += p.s;
        fine = p.x + p.w;
      }
      return out;
    })
    .join("\n");
}

async function paginaInJpeg(page) {
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(3, 1600 / vp1.width) });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const ctx = c.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  c.width = c.height = 0;
  return blob;
}

/* PDF → pagine di testo. Le pagine senza testo selezionabile (scansioni)
   restano segnate: verranno mandate come immagini se c'è posto. */
async function leggiPagine(b64) {
  const lib = await caricaPdfJs();
  const pdf = await lib.getDocument({ data: daBase64(b64), isEvalSupported: false }).promise;
  const pagine = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const t = righeDellaPagina((await page.getTextContent()).items);
    pagine.push({ n: i, testo: t, scansionata: t.replace(/\s/g, "").length < 40 });
    page.cleanup();
  }
  return { pdf, pagine };
}

/* ---------- Scelta delle pagine pertinenti ----------
   Un bilancio completo (10-K, 20-F, relazione finanziaria annuale) supera di
   molto il limite di testo di una richiesta. Prima si tagliava dall'inizio, e
   i prospetti, che stanno quasi sempre a metà o in fondo, non arrivavano mai
   a Claude. Ora, quando il testo non ci sta, si tengono le pagine più
   pertinenti alla domanda del programma (parole chiave del prospetto o della
   sezione richiesta + densità di numeri, tipica delle tabelle), nell'ordine
   originale e con il loro numero di pagina. */
const ARGOMENTI = {
  SP: {
    domanda: /stato patrimoniale|balance sheets?|financial position|attivo e passivo/gi,
    chiavi: ["stato patrimoniale", "balance sheet", "financial position", "totale attivo", "total assets", "totale passivo",
      "total liabilities", "patrimonio netto", "shareholders' equity", "stockholders' equity", "shareholders’ equity",
      "stockholders’ equity", "current assets", "attivo circolante", "immobilizzazioni", "crediti verso", "debiti verso",
      "current liabilities", "disponibilità liquide", "cash and cash equivalents", "inventories", "rimanenze"],
  },
  CE: {
    domanda: /conto economico|income statements?|statements? of (?:operations|income)|profit or loss/gi,
    chiavi: ["conto economico", "income statement", "statements of income", "statement of operations", "statements of operations",
      "profit or loss", "ricavi", "revenue", "net income", "utile", "perdita", "cost of revenue", "costo del venduto",
      "operating income", "risultato operativo", "gross profit", "earnings per share", "imposte sul reddito", "income tax",
      "valore della produzione", "costi della produzione", "ebitda"],
  },
  RF: {
    domanda: /rendiconto finanziario|cash flows?|flussi finanziari/gi,
    chiavi: ["rendiconto finanziario", "cash flow", "cash flows", "flussi finanziari", "flusso finanziario", "operating activities",
      "investing activities", "financing activities", "attività operativa", "attività di investimento",
      "attività di finanziamento", "depreciation", "ammortamenti", "dividendi", "dividends", "cash equivalents"],
  },
  NI: {
    domanda: /nota integrativa|notes to (?:the )?(?:consolidated )?financial statements/gi,
    chiavi: ["nota integrativa", "notes to", "criteri di valutazione", "accounting policies", "scadenz", "maturit", "debt",
      "debiti", "fondi", "provisions", "imposte differite", "deferred tax", "leases", "leasing", "garanzi", "warrant",
      "segment", "settori", "commitments", "impegni", "fair value"],
  },
  RG: {
    domanda: /relazione sulla gestione|management'?s discussion|md&a|management commentary/gi,
    chiavi: ["relazione sulla gestione", "management's discussion", "management’s discussion", "md&a", "outlook",
      "evoluzione prevedibile", "fatti di rilievo", "risk factors", "fattori di rischio", "andamento", "results of operations",
      "liquidity and capital resources", "segment", "settore", "mercato", "guidance"],
  },
};

function pesiDellaDomanda(domanda) {
  const testa = domanda.slice(0, 4000);
  const pesi = {};
  for (const [k, a] of Object.entries(ARGOMENTI)) pesi[k] = (testa.match(a.domanda) || []).length;
  if (!Object.values(pesi).some((v) => v > 0)) for (const k of Object.keys(pesi)) pesi[k] = 1;
  return pesi;
}

function punteggioPagina(testo, pesi) {
  const t = testo.toLowerCase();
  let p = 0;
  for (const [k, a] of Object.entries(ARGOMENTI)) {
    if (!pesi[k]) continue;
    let colpi = 0;
    for (const c of a.chiavi) {
      let i = t.indexOf(c);
      while (i !== -1 && colpi < 40) { colpi++; i = t.indexOf(c, i + c.length); }
    }
    p += pesi[k] * colpi;
  }
  // Le tabelle dei prospetti: tante righe con almeno due importi.
  const righe = testo.split("\n");
  const numeriche = righe.filter((r) => (r.match(/\(?-?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?\)?|\b\d{3,}\b/g) || []).length >= 2).length;
  p += 12 * (numeriche / Math.max(righe.length, 1));
  return p;
}

const byte = (s) => new TextEncoder().encode(s).length;
const testoPagina = (pg, imgN) =>
  pg.scansionata
    ? `\n\n— Pagina ${pg.n} —\n${imgN ? `[pagina senza testo selezionabile: vedi immagine ${imgN}]` : "[pagina senza testo selezionabile, non disponibile]"}`
    : `\n\n— Pagina ${pg.n} —\n${pg.testo}`;

/* Blocchi in formato Anthropic → input testuale + immagini per «sample».
   Ritorna anche una nota su cosa è stato escluso, per la schermata. */
async function preparaInput(blocchi, limiti) {
  const maxImmagini = limiti?.images?.maxCount || 0;
  const tipi = limiti?.images?.mediaTypes || [];
  const maxByte = Math.min(MAX_BYTE_TESTO, (limiti?.maxPromptBytes || 262144) - 12_000);
  const immagini = [];
  const testi = [];
  const documenti = []; // { tipo: "pdf", pdf, pagine } | { tipo: "testo", testo }
  for (const b of blocchi) {
    if (!b) continue;
    if (b.type === "text") testi.push(b.text);
    else if (b.type === "document" && b.source?.media_type === "application/pdf") documenti.push({ tipo: "pdf", ...(await leggiPagine(b.source.data)) });
    else if (b.type === "document" && b.source?.type === "text") documenti.push({ tipo: "testo", testo: b.source.data });
    else if (b.type === "image" && b.source?.type === "base64") {
      if (immagini.length < maxImmagini && tipi.includes(b.source.media_type))
        immagini.push(new Blob([daBase64(b.source.data)], { type: b.source.media_type }));
    }
  }
  const domanda = testi.join("\n\n");
  const pesi = pesiDellaDomanda(domanda);

  /* Pagine candidate di tutti i PDF, con il loro costo in byte. */
  const candidate = [];
  documenti.forEach((d, di) => {
    if (d.tipo !== "pdf") return;
    for (const pg of d.pagine) candidate.push({ di, pg, costo: byte(testoPagina(pg)) + 4, punti: pg.scansionata ? 0 : punteggioPagina(pg.testo, pesi) });
  });
  const intestazioni = documenti.length * 700;
  const testiLiberi = documenti.filter((d) => d.tipo === "testo").reduce((s, d) => s + byte(d.testo), 0);
  let budget = maxByte - byte(domanda) - intestazioni - testiLiberi;
  const totale = candidate.reduce((s, c) => s + c.costo, 0);
  const scelte = new Set();
  let selezione = false;
  if (totale <= budget) candidate.forEach((c) => scelte.add(c));
  else {
    selezione = true;
    const prendi = (c) => { if (c && !scelte.has(c) && c.costo <= budget) { scelte.add(c); budget -= c.costo; return true; } return false; };
    // Prima pagina di ogni documento: denominazione, esercizio, valuta.
    documenti.forEach((d, di) => d.tipo === "pdf" && prendi(candidate.find((c) => c.di === di)));
    const ordinate = [...candidate].sort((a, b) => b.punti - a.punti);
    for (const c of ordinate) {
      if (c.punti <= 0 || budget <= 0) break;
      if (prendi(c)) {
        // Un prospetto spesso continua nella pagina successiva.
        const i = candidate.indexOf(c);
        const dopo = candidate[i + 1];
        if (dopo && dopo.di === c.di && dopo.punti >= c.punti * 0.35) prendi(dopo);
      }
    }
  }

  const allegati = [];
  const note = [];
  let nDoc = 0;
  for (let di = 0; di < documenti.length; di++) {
    const d = documenti[di];
    nDoc++;
    if (d.tipo === "testo") { allegati.push(`\n\n[DOCUMENTO ${nDoc}]\n${d.testo}\n[FINE DOCUMENTO ${nDoc}]`); continue; }
    const tenute = candidate.filter((c) => c.di === di && scelte.has(c)).map((c) => c.pg);
    let corpo = "";
    let saltateScansioni = 0;
    let ultima = 0;
    for (const pg of tenute) {
      if (pg.n > ultima + 1) corpo += `\n\n[… pagine ${ultima + 1}–${pg.n - 1} non incluse …]`;
      let imgN = 0;
      if (pg.scansionata) {
        if (immagini.length < maxImmagini) {
          immagini.push(await paginaInJpeg(await d.pdf.getPage(pg.n)));
          imgN = immagini.length;
        } else saltateScansioni++;
      }
      corpo += testoPagina(pg, imgN);
      ultima = pg.n;
    }
    if (ultima < d.pagine.length) corpo += `\n\n[… pagine ${ultima + 1}–${d.pagine.length} non incluse …]`;
    const n = d.pagine.length;
    const avviso = tenute.length < n
      ? ` Il documento è troppo lungo per una sola richiesta: sono incluse le ${tenute.length} pagine più pertinenti su ${n}, nell'ordine originale; i numeri «— Pagina N —» sono quelli del documento originale. Cerca i dati richiesti nelle pagine incluse.`
      : "";
    allegati.push(`\n\n[DOCUMENTO ${nDoc}: PDF di ${n} pagine, fornito come testo estratto pagina per pagina; ogni pagina è introdotta da «— Pagina N —», con N numero di pagina nel documento. Le tabelle sono linearizzate: una riga del prospetto per riga di testo, colonne nell'ordine originale da sinistra a destra.${avviso}${saltateScansioni ? ` ${saltateScansioni} pagine scansionate non sono leggibili.` : ""}]${corpo}\n[FINE DOCUMENTO ${nDoc}]`);
    if (tenute.length < n) note.push(`${tenute.length} pagine su ${n}`);
    if (saltateScansioni) note.push(`${saltateScansioni} pagine scansionate non lette`);
    await d.pdf.destroy();
  }

  let input = domanda + allegati.join("");
  if (byte(input) > maxByte) {
    // Taglio di sicurezza (testi non PDF molto lunghi).
    while (byte(input) > maxByte) input = input.slice(0, Math.floor(input.length * 0.95));
    input += "\n\n[Documento troncato per limiti di lunghezza: lavora sulle pagine disponibili.]";
    note.push("testo tagliato");
  }
  return { input, immagini, nota: selezione || note.length ? note.join(", ") : "" };
}

/* Messaggi per i codici di errore di «sample». */
const MESSAGGI = {
  not_granted: "Claude non è stato autorizzato per questa pagina: ricarica la pagina e consenti l'uso di Claude (oppure dal menu Permessi dell'artifact).",
  sampling_disabled: "Claude non è disponibile per questo account.",
  not_declared: "Questa versione della pagina non ha il permesso di usare Claude.",
  capability_disabled: "Claude non è utilizzabile in questa vista: apri l'artifact da claude.ai.",
  rate_limited: "Limite di utilizzo di Claude raggiunto: rilancia più tardi.",
  prompt_too_large: "Documento troppo lungo per una singola richiesta.",
  session_expired: "Sessione scaduta: accedi di nuovo a claude.ai.",
  refused: "Claude ha rifiutato questa richiesta.",
  empty_completion: "Claude non ha restituito testo.",
  image_rejected: "Una pagina scansionata non è stata accettata.",
  images_unavailable: "Le pagine scansionate non possono essere inviate in questa vista.",
};
/* Errori dopo i quali è inutile proseguire con altri documenti. */
export const CODICI_BLOCCANTI = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "rate_limited", "session_expired", "non_disponibile"];
const NON_DISPONIBILE = "Claude non è raggiungibile da questa pagina. Aprila dentro claude.ai (non come pagina a sé in un'altra scheda) e consenti l'uso di Claude quando te lo chiede.";

/* Chiamata a Claude tramite «sample». Ritorna { text, troncato, nota } o lancia
   un errore con {status, codice, messaggio} già pronto per il formato del programma. */
async function chiamaClaude(blocchi, modello) {
  const { s, limiti } = await ottieniSample();
  if (!s) throw { status: 403, codice: "non_disponibile", messaggio: NON_DISPONIBILE };
  const { input, immagini, nota } = await preparaInput(blocchi, limiti);
  const opzioni = { modelTier: /opus/i.test(modello || "") ? "complex" : "default" };
  if (immagini.length) opzioni.images = immagini;
  try {
    const { text, truncated } = await limita(() => s(input, opzioni));
    return { text, troncato: !!truncated, nota };
  } catch (e) {
    const codice = e?.code || "upstream_error";
    throw { status: 400, codice, messaggio: MESSAGGI[codice] || `Risposta di Claude interrotta (${codice}): rilancia il caricamento.` };
  }
}

/* Verifica prima dell'avvio: Claude è raggiungibile e autorizzato?
   Una richiesta minima (modello rapido) fa comparire subito la richiesta di
   permesso, invece che a metà del primo documento. */
export async function verificaClaude() {
  if (!attivo) return { ok: true };
  const { s } = await ottieniSample();
  if (!s) return { ok: false, codice: "non_disponibile", messaggio: NON_DISPONIBILE };
  try {
    await s("Rispondi soltanto con la parola OK.", { modelTier: "quick", cache: false });
    return { ok: true };
  } catch (e) {
    const codice = e?.code || "upstream_error";
    return { ok: false, codice, messaggio: MESSAGGI[codice] || `Claude non ha risposto (${codice}). Riprova tra poco.` };
  }
}

/* Intestazioni che la schermata legge per sapere com'è andata la chiamata. */
const json = (corpo, status = 200, extra = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...extra } });
const intestazioniOk = (r) => ({ ...(r.troncato ? { "x-ponte-troncato": "1" } : {}), ...(r.nota ? { "x-ponte-nota": encodeURIComponent(r.nota) } : {}) });
const intestazioniErr = (e) => ({ "x-ponte-codice": e.codice || "errore" });

if (attivo) {
  const fetchOriginale = window.fetch.bind(window);
  window.fetch = async (risorsa, init) => {
    const url = typeof risorsa === "string" ? risorsa : risorsa?.url || "";
    const metodo = (init?.method || risorsa?.method || "GET").toUpperCase();

    // Stato Patrimoniale: proxy /api/chat
    if (/\/api\/chat\b/.test(url)) {
      if (metodo === "GET") return json({ providers: { claude: true, openai: false, gemini: false } });
      const corpo = JSON.parse(init?.body || "{}");
      if (corpo.provider && corpo.provider !== "claude")
        return json({ errore: "In questo artifact è disponibile solo Claude.", tipo: "invalid_request_error", etichetta: corpo.provider }, 400);
      try {
        const r = await chiamaClaude([...(corpo.allegati || []), { type: "text", text: corpo.testo || "" }], corpo.modello);
        return json({ raw: r.text }, 200, intestazioniOk(r));
      } catch (e) {
        return json({ errore: e.messaggio, tipo: "invalid_request_error", etichetta: "Claude" }, e.status || 400, intestazioniErr(e));
      }
    }

    // Conto Economico e Rendiconto Finanziario: API Anthropic (diretta o via proxy)
    if (/api\.anthropic\.com\/v1\/messages|\/api\/anthropic\b/.test(url) && metodo === "POST") {
      const corpo = JSON.parse(init?.body || "{}");
      /* Ricerca e lettura di pagine web (Analisi strategica): «sample» non ha
         accesso al web. Si risponde con un errore chiaro invece di lasciare che
         Claude inventi fonti. Il messaggio non contiene le parole che il
         programma tratta come «strumento non abilitato, riprova». */
      if (Array.isArray(corpo.tools) && corpo.tools.some((t) => /web_search|web_fetch/.test(String(t?.type || t?.name || "")))) {
        return json({ type: "error", error: { type: "invalid_request_error",
          message: "La ricerca sul web non è disponibile dentro l'artifact di claude.ai: carica a mano i documenti o il testo delle pagine che ti servono." } }, 400,
          { "x-ponte-codice": "ricerca_web_non_disponibile" });
      }
      const ultimo = (corpo.messages || []).filter((m) => m.role === "user").pop();
      const blocchi = typeof ultimo?.content === "string" ? [{ type: "text", text: ultimo.content }] : [...(ultimo?.content || [])];
      /* Le istruzioni «system» (Quality of Earnings ne fa largo uso) non hanno
         un posto in «sample»: vanno in testa al testo della richiesta. */
      const sistema = typeof corpo.system === "string" ? corpo.system
        : Array.isArray(corpo.system) ? corpo.system.map((b) => b?.text || "").join("\n\n") : "";
      if (sistema.trim()) blocchi.unshift({ type: "text", text: `ISTRUZIONI DI SISTEMA (valgono per tutta la risposta):\n${sistema}` });
      try {
        const r = await chiamaClaude(blocchi, corpo.model);
        return json({ type: "message", role: "assistant", content: [{ type: "text", text: r.text }], stop_reason: r.troncato ? "max_tokens" : "end_turn" }, 200, intestazioniOk(r));
      } catch (e) {
        return json({ type: "error", error: { type: "invalid_request_error", message: e.messaggio } }, e.status || 400, intestazioniErr(e));
      }
    }

    // OpenAI e Gemini non sono raggiungibili da un artifact.
    if (/api\.openai\.com|generativelanguage\.googleapis\.com/.test(url))
      return json({ error: { message: "In questo artifact è disponibile solo Claude." } }, 400);

    return fetchOriginale(risorsa, init);
  };
}
