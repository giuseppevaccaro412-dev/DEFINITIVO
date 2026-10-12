/* =============================================================================
   Suite di riclassificazione — schermata unica di caricamento.

   I tre programmi (SP, CE, RF) sono importati COSÌ COME SONO, senza alcuna
   modifica (vedi scripts/verifica-moduli.mjs, che ne controlla l'impronta).
   Restano montati tutti e tre per tutta la sessione, ognuno nella sua scheda.

   Questa schermata non estrae nulla: consegna ogni file all'input di
   caricamento del programma, esattamente come se lo scegliessi tu dal suo
   pulsante, e i programmi lavorano con la loro logica.

   Più esercizi: l'utente indica gli anni e carica i documenti di ciascuno.
   Gli esercizi girano uno alla volta, dal più vecchio, con i programmi
   rimontati da zero tra uno e l'altro. Per ogni esercizio, in parallelo nei
   tre programmi:
     1. Prospetti T  (il programma legge anche la colonna comparativa T-1)
     2. Nota Integrativa T
     3. Relazione sulla Gestione T
     4-6. documenti dell'esercizio precedente come T-1, se caricati
     7. JSON di SP e CE nel tab 4 del Rendiconto
     8. salvataggio dei tre JSON (gli stessi di «Salva dati»)
   Un passo parte quando le chiamate all'IA del passo precedente sono
   terminate in tutti e tre i programmi. Alla fine: ZIP con una cartella per
   esercizio («2025-2026/»), come l'archivio NVIDIA.
   ============================================================================= */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/* Il programma «Redditività e solvibilità» usa lo stesso JSZip della pagina. */
if (typeof window !== "undefined" && !window.JSZip) window.JSZip = JSZip;
import RiclassificazioneSP from "./moduli/RiclassificazioneSP.jsx";
import ContoEconomicoRiclassificato from "./moduli/ContoEconomicoRiclassificato_v2_1_4.jsx";
import RendicontoFinanziarioRiclassificato from "./moduli/RendicontoFinanziarioRiclassificato.jsx";
import RedditivitaSolvibilita from "./moduli/RedditivitaSolvibilita.jsx";
import QualityOfEarnings, { esitoFase5DaSalvataggio } from "./moduli/QualityOfEarnings.jsx";
import htmlProformaDcf from "./moduli/BilancioProformaDCF.html?raw";
/* «Ricerca Aziende»: pagina a sé (settori, filiera, screener SEC, peer,
   consenso analisti), mostrata in un riquadro come prima scheda della suite. */
import htmlRicercaAziende from "./moduli/RicercaAziende.html?raw";
/* «Analisi strategica esterna e interna»: programma a sé, fra Redditività e
   solvibilità e Quality of Earnings. Montato alla prima apertura, poi resta vivo. */
import AnalisiStrategica from "./moduli/AnalisiStrategica.jsx";
import ComparazioneSettoriale from "./moduli/ComparazioneSettoriale.jsx";
import { paginaDcfConZip } from "./ponte-dcf.js";
import { modalitaArtifact, verificaClaude, CODICI_BLOCCANTI } from "./ponte-artifact.js";
import { catturaProssimoDownload, consegnaAllUtente } from "./cattura-download.js";
import { apriPersistenza } from "./persistenza.js";
import { leggiChiave, impostaChiave, chiaveRicordata, chiaveSullHosting, leggiProvider, impostaProvider, leggiModello, impostaModello, MODELLO_OPENAI_PREDEFINITO } from "./chiave-unica.js";

/* ---------- Monitor delle chiamate all'IA ----------
   Conta le richieste in corso verso i proxy dei programmi (SP → /api/chat,
   CE e RF → /api/anthropic o API diretta) e ne registra l'esito: serve a
   capire quando un passo è finito e se è andato davvero a buon fine (prima
   un passo risultava «fatto» anche se tutte le chiamate fallivano).
   Le richieste passano invariate. */
const monitor = { inCorso: 0, ultimaAttivita: 0, totali: 0, esiti: [], ascoltatori: new Set() };
const notifica = () => monitor.ascoltatori.forEach((f) => f());
const eChiamataIA = (url) =>
  /\/api\/(chat|anthropic)\b|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/.test(url);

/* ---------- Esercizio di riferimento ----------
   L'anno scritto dall'utente per l'esercizio in elaborazione (o in vista).
   Lo SP e il CE lo ricevono come prop; in più ogni richiesta all'IA dei tre
   programmi si apre con una nota che fissa T e T-1, così gli anni usati come
   esempio nelle istruzioni (es. 2025, 2024) non vengono presi alla lettera. */
let annoDiRiferimento = "";
/* La nota vale per SP, CE e RF: non per «Redditività e solvibilità», che lavora
   su più esercizi insieme e contrassegna le sue richieste
   (window.__richiestaRedditivita, vero solo mentre parte la sua fetch). */
const impostaAnnoDiRiferimento = (a) => { annoDiRiferimento = /^\d{4}$/.test(String(a || "")) ? String(a) : ""; };
const notaAnno = (a) =>
  `ESERCIZIO DI RIFERIMENTO DI QUESTA RICLASSIFICAZIONE: l'esercizio corrente (T) è il ${a} (bilancio chiuso nel ${a}); l'esercizio precedente (T-1) è il ${Number(a) - 1}. ` +
  `Gli anni che nelle istruzioni seguenti compaiono come esempio (es. 2025, 2024) sono solo esempi: dove si parla di esercizio corrente intendi il ${a}, ` +
  `dove si parla di esercizio precedente o di colonna comparativa intendi il ${Number(a) - 1}.\n\n`;
function conAnnoDiRiferimento(url, init) {
  if (!annoDiRiferimento || window.__richiestaRedditivita || window.__richiestaQualityOfEarnings || typeof init?.body !== "string") return init;
  // Integrazione documentale di «Redditività e solvibilità»: lavora su tutti gli esercizi.
  if (init.body.includes("eserciziPresenti")) return init;
  // Comparazione settoriale: lavora su più aziende ed esercizi insieme.
  if (/COMPARAZIONE INTERAZIENDALE|giudizio comparativo/.test(init.body)) return init;
  try {
    const corpo = JSON.parse(init.body);
    const nota = notaAnno(annoDiRiferimento);
    if (/\/api\/chat\b/.test(url)) {
      if (typeof corpo.testo !== "string") return init;
      corpo.testo = nota + corpo.testo;
    } else {
      const ultimo = (corpo.messages || []).filter((m) => m.role === "user").pop();
      if (!ultimo) return init;
      if (typeof ultimo.content === "string") ultimo.content = nota + ultimo.content;
      else if (Array.isArray(ultimo.content)) {
        const t = ultimo.content.find((b) => b?.type === "text");
        if (t) t.text = nota + t.text; else ultimo.content.push({ type: "text", text: nota });
      } else return init;
    }
    return { ...init, body: JSON.stringify(corpo) };
  } catch { return init; }
}

if (typeof window !== "undefined" && !window.__monitorIA) {
  window.__monitorIA = true;
  const fetchOriginale = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const metodo = (init?.method || input?.method || "GET").toUpperCase();
    if (!eChiamataIA(url) || metodo !== "POST") return fetchOriginale(input, init);
    init = conAnnoDiRiferimento(url, init);
    monitor.inCorso++;
    monitor.totali++;
    monitor.ultimaAttivita = Date.now();
    notifica();
    const p = fetchOriginale(input, init);
    p.then(
      async (r) => {
        const esito = { ok: r.ok, status: r.status, codice: r.headers.get("x-ponte-codice") || "", troncato: r.headers.get("x-ponte-troncato") === "1", nota: decodeURIComponent(r.headers.get("x-ponte-nota") || ""), messaggio: "" };
        if (!r.ok) {
          try {
            const d = await r.clone().json();
            esito.messaggio = d.errore || d.error?.message || `HTTP ${r.status}`;
          } catch { esito.messaggio = `HTTP ${r.status}`; }
        }
        monitor.esiti.push(esito);
      },
      (e) => monitor.esiti.push({ ok: false, status: 0, codice: "rete", messaggio: `Rete: ${e?.message || e}` }),
    ).finally(() => {
      monitor.inCorso--;
      monitor.ultimaAttivita = Date.now();
      notifica();
    });
    return p;
  };
}

/* Riassunto delle chiamate fatte durante un passo. Gli errori temporanei
   (sovraccarico, rate limit del provider) seguiti da una riuscita sono
   normali tentativi ripetuti dai programmi e non vengono segnalati. */
const TEMPORANEI = new Set([429, 500, 502, 503, 504, 529]);
function riassumiPasso(daIndice, partito) {
  const es = monitor.esiti.slice(daIndice);
  const ok = es.filter((e) => e.ok);
  const ko = es.filter((e) => !e.ok && !(ok.length && TEMPORANEI.has(e.status)));
  const messaggi = [...new Set(ko.map((e) => e.messaggio))].slice(0, 2);
  const note = [...new Set(ok.map((e) => e.nota).filter(Boolean))];
  const troncate = ok.filter((e) => e.troncato).length;
  const bloccante = ko.find((e) => CODICI_BLOCCANTI.includes(e.codice));
  if (!partito || !es.length)
    return { stato: "errore", nota: "Nessuna richiesta a Claude è partita: i programmi non hanno elaborato il file. Apri le schede SP, CE e RF per vedere il messaggio." };
  if (!ok.length) return { stato: "errore", nota: `Tutte le ${es.length} richieste sono fallite: ${messaggi.join(" · ")}`, bloccante };
  const parti = [];
  if (ko.length) parti.push(`${ko.length} richieste su ${es.length} fallite: ${messaggi.join(" · ")}`);
  if (troncate) parti.push(`${troncate} risposte interrotte per lunghezza`);
  if (note.length) parti.push(`documento lungo, inviate le pagine più pertinenti (${note.slice(0, 2).join("; ")})`);
  return { stato: ko.length || troncate ? "avviso" : "fatto", nota: `${ok.length} risposte ricevute${parti.length ? " · " + parti.join(" · ") : ""}`, bloccante };
}

/* Contenuto reale di un JSON salvato: quante voci ha l'esercizio T e il T-1. */
function contaVoci(j) {
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return {
    t: n(j?.esercizioCorrente?.voci) || n(j?.statoApplicazione?.voci),
    t1: n(j?.esercizioPrecedente?.voci) || n(j?.statoApplicazione?.vociPrec),
  };
}

/* Quale programma ha prodotto un JSON (nome del file, altrimenti contenuto). */
function riconosciProgramma(nome, j) {
  const n = String(nome || "").toLowerCase();
  if (n.startsWith("riclassificazione-sp")) return "SP";
  if (n.startsWith("riclassificazione-ce")) return "CE";
  if (n.startsWith("rendiconto-finanziario")) return "RF";
  if (String(j?.formato || "").startsWith("ce-riclassificato")) return "CE";
  if (j?.modulo === "rendiconto_finanziario") return "RF";
  if (j?.deltaPatrimoniali || j?.statoApplicazione?.asaMap !== undefined) return "SP";
  return null;
}

/* Attesa della fine di un passo.
   - Se entro AVVIO_MAX non parte nessuna chiamata, il passo è considerato
     concluso (per esempio un programma ha scartato il file).
   - Altrimenti si attende che non ci siano richieste in corso per QUIETE ms:
     la quiete supera la pausa massima dei retry dei programmi (20 s), così
     un nuovo tentativo dopo un «Overloaded» non viene scambiato per la fine. */
const AVVIO_MAX = 90_000;
const QUIETE = 25_000;
function attendiFinePasso(totaliPrima, segnale) {
  const inizio = Date.now();
  return new Promise((risolvi, rifiuta) => {
    const t = setInterval(() => {
      if (segnale.aborted) { clearInterval(t); rifiuta(new Error("interrotto")); return; }
      const partito = monitor.totali > totaliPrima;
      if (!partito) {
        if (Date.now() - inizio > AVVIO_MAX) { clearInterval(t); risolvi(false); }
        return;
      }
      if (monitor.inCorso === 0 && Date.now() - monitor.ultimaAttivita > (window.__quieteTest || QUIETE)) { clearInterval(t); risolvi(true); }
    }, 500);
  });
}

/* ---------- Mappa degli input di caricamento di ciascun programma ----------
   Posizione dell'input type="file" nell'ordine in cui il programma lo
   disegna. L'«accept» atteso serve da controllo: se un programma cambia
   struttura, la schermata si ferma con un messaggio invece di consegnare il
   file al pulsante sbagliato. */
const PDF_SP = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html";
const PROGRAMMI = {
  SP: {
    nome: "Stato Patrimoniale",
    sigla: "SP",
    numeroInput: 8,
    input: {
      "T.prospetti": [1, PDF_SP], "T.ni": [2, PDF_SP], "T.rg": [3, PDF_SP],
      "T1.prospetti": [4, PDF_SP], "T1.ni": [5, PDF_SP], "T1.rg": [6, PDF_SP],
      json: [7, ".json,application/json"], // «Carica dati salvati»
    },
  },
  CE: {
    nome: "Conto Economico",
    sigla: "CE",
    numeroInput: 8,
    input: {
      "T.prospetti": [1, ".pdf,.txt,.md,.csv"], "T.ni": [2, ".pdf,.txt,.md"], "T.rg": [3, ".pdf,.txt,.md"],
      "T1.prospetti": [5, ".pdf,.txt,.md,.csv"], "T1.ni": [6, ".pdf,.txt,.md"], "T1.rg": [7, ".pdf,.txt,.md"],
      json: [4, ".json"], // «Carica dati salvati»
    },
  },
  RF: {
    nome: "Rendiconto Finanziario",
    sigla: "RF",
    numeroInput: 10,
    input: {
      "T.prospetti": [1, ".pdf,.txt,.md"], "T.ni": [2, ".pdf,.txt,.md"], "T.rg": [3, ".pdf,.txt,.md"],
      "T1.prospetti": [7, ".pdf,.txt,.md"], "T1.ni": [8, ".pdf,.txt,.md"], "T1.rg": [9, ".pdf,.txt,.md"],
      // Tab 4 «Dati SP e CE»: i JSON salvati dagli altri due programmi
      "ponte.SP": [4, ".json"], "ponte.CE": [5, ".json"],
      json: [6, ".json"], // «Carica dati salvati»
    },
  },
};
const ORDINE = ["T.prospetti", "T.ni", "T.rg", "T1.prospetti", "T1.ni", "T1.rg"];
const DOCUMENTI = [
  { id: "prospetti", nome: "Prospetti contabili", nota: "Stato Patrimoniale, Conto Economico, Rendiconto Finanziario" },
  { id: "ni", nome: "Nota Integrativa", nota: "Notes to the Financial Statements" },
  { id: "rg", nome: "Relazione sulla Gestione", nota: "MD&A, Management Commentary" },
];
const etichettaPasso = (k) => {
  if (k === "json") return "Carica dati salvati";
  if (k === "ponte.SP") return "JSON dello Stato Patrimoniale";
  if (k === "ponte.CE") return "JSON del Conto Economico";
  const [anno, doc] = k.split(".");
  return `${DOCUMENTI.find((d) => d.id === doc).nome} ${anno === "T" ? "T" : "T-1"}`;
};

function inputDelProgramma(contenitore, sigla, chiave) {
  const p = PROGRAMMI[sigla];
  const tutti = contenitore ? [...contenitore.querySelectorAll('input[type="file"]')] : [];
  if (tutti.length !== p.numeroInput)
    throw new Error(`${p.nome}: trovati ${tutti.length} pulsanti di caricamento invece di ${p.numeroInput}. Il programma è cambiato: aggiorna la mappa in App.jsx.`);
  const [indice, accept] = p.input[chiave];
  const el = tutti[indice];
  if (el.getAttribute("accept") !== accept)
    throw new Error(`${p.nome}: il pulsante per «${etichettaPasso(chiave)}» non corrisponde. Aggiorna la mappa in App.jsx.`);
  return el;
}

/* Consegna il file all'input come farebbe una scelta manuale: React riceve
   l'evento «change» e il programma esegue il proprio gestore. */
function consegnaFile(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ---------- Ponte verso il tab 4 del Rendiconto ----------
   Fa quello che faresti a mano: «Salva dati» nello SP e nel CE, poi carica i
   due JSON nei pulsanti del tab 4 dell'RF. Il salvataggio viene catturato
   (nessun file scaricato) e passato direttamente all'RF. */
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function trovaPulsante(contenitore, testo, attendiMs = 0) {
  const fine = Date.now() + attendiMs;
  for (;;) {
    const b = [...contenitore.querySelectorAll("button")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(testo));
    if (b || Date.now() >= fine) return b || null;
    await pausa(200);
  }
}
/* Come si ottiene il JSON di «Salva dati» in ciascun programma.
   SP salva subito; CE e RF aprono una finestra da cui si scarica il file. */
const SALVATAGGIO = {
  SP: { pulsante: "Salva dati (JSON)" },
  CE: { pulsante: "Salva dati", finestra: "Prova download diretto" },
  RF: { pulsante: "Salva dati (JSON)", finestra: "Download diretto" },
};
async function esportaJson(sigla, contenitore) {
  const { pulsante, finestra } = SALVATAGGIO[sigla];
  const b = await trovaPulsante(contenitore, pulsante);
  if (!b) throw new Error(`pulsante «${pulsante}» non trovato`);
  if (b.disabled) throw new Error("nessun dato da salvare");
  if (!finestra) {
    const cattura = catturaProssimoDownload();
    b.click();
    const r = await cattura;
    if (!r) throw new Error("il salvataggio non è partito");
    return r;
  }
  b.click();
  const diretto = await trovaPulsante(contenitore, finestra, 5000);
  if (!diretto) throw new Error("la finestra di salvataggio non si è aperta");
  const cattura = catturaProssimoDownload();
  diretto.click();
  const r = await cattura;
  const chiudi = [...contenitore.querySelectorAll("button")].find(
    (x) => x.textContent.trim() === "Chiudi" || x.getAttribute("aria-label") === "Chiudi");
  chiudi?.click();
  if (!r) throw new Error("il salvataggio non è partito");
  return r;
}

/* Legge il JSON salvato da un programma: voci reali, esercizio letto, azienda. */
async function completaRisultato(r, s, anno) {
  try {
    const j = JSON.parse(await r[s].blob.text());
    r[s].voci = contaVoci(j);
    const letto = String(j?.esercizioCorrente?.esercizio ?? j?.esercizio ?? "");
    if (anno && letto && !letto.includes(anno)) r.avvisi.push(`${s} ha letto l'esercizio «${letto}»`);
    if (!r.azienda && j?.azienda) r.azienda = j.azienda;
  } catch {
    r[s].voci = { t: 0, t1: 0 };
  }
  r[s].vuoto = !r[s].voci.t;
}
/* Un esercizio è riuscito solo se tutti e tre i programmi hanno estratto voci. */
function esitoAnno(r) {
  const buoni = ["SP", "CE", "RF"].filter((s) => r?.[s]?.blob && !r[s].vuoto).length;
  return { buoni, stato: buoni === 3 ? "fatto" : buoni === 0 ? "errore" : "avviso" };
}

/* ---------- Riapertura di una sessione da ZIP ----------
   Due formati:
   - ZIP di un'azienda (quello di sempre): una cartella per esercizio,
     «2024-2025/», con i JSON di SP, CE e RF, più eventuali «ttm/»,
     «redditivita-solvibilita/», «quality-of-earnings/» e «sessione.json»;
   - ZIP della sessione con più aziende: «aziende/<Nome>/…» con dentro, per
     ciascuna, la stessa struttura, e un «sessione.json» generale.
   Funziona anche se lo ZIP è stato estratto e ricompresso dentro un'altra
   cartella. Un JSON fuori dalle cartelle viene assegnato all'esercizio che
   dichiara al suo interno. */
const ignorato = (percorso) => /(^|\/)(__MACOSX\/|\._)/.test(percorso);
/* Documenti caricati (PDF, testo) dentro lo ZIP: «documenti/2024-2025/ni/<file>».
   Alla riapertura tornano nei riquadri del loro esercizio, così una sessione
   interrotta riprende senza ricaricarli. */
const RE_DOCUMENTO = /(?:^|\/)documenti\/(\d{4})-(\d{4})\/(prospetti|ni|rg)\/([^/]+)$/;
const TIPI_DOCUMENTO = { pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const nomeFileSicuro = (n) => String(n || "documento").replace(/[\\/]+/g, "_");
/* Relazione infrannuale (trimestrale/semestrale) che accompagna il bilancio TTM:
   nello stato dell'azienda sta in file["ttm.doc"], nello ZIP in «documenti/ttm/». */
const CHIAVE_DOC_TTM = "ttm.doc";
const RE_DOC_TTM = /(?:^|\/)documenti\/ttm\/([^/]+)$/;
/* Identità di un documento per l'integrazione documentale: ciò che Redditività
   ha già letto non si rilegge (si integra solo ciò che è nuovo). */
const chiaveDoc = (x) => `${x.tipo}:${x.anno}:${x.file?.name || ""}:${x.file?.size ?? ""}`;
const annoDi = (v) => { const m = String(v ?? "").match(/(19|20)\d{2}/g); return m ? Number(m[m.length - 1]) : null; };
async function leggiVociAzienda(voci) {
  const per = {};
  let manifesto = null;
  let analisi = null; // JSON di «Redditività e solvibilità»
  let qoe = null; // salvataggio di «Quality of Earnings»
  let ttm = null; // bilancio TTM
  let dcf = null; // esportazione di «Pro-forma e DCF»
  const documenti = []; // { anno, tipo, percorso, file }
  let docTtm = null; // relazione infrannuale del TTM
  const scartati = [];
  for (const { percorso, voce } of voci) {
    const mt = percorso.match(RE_DOC_TTM);
    if (mt) {
      const est = mt[1].toLowerCase().split(".").pop();
      const blob = await voce.async("blob");
      docTtm = new File([blob], mt[1], { type: est === "json" ? "application/json" : TIPI_DOCUMENTO[est] || "" });
      continue;
    }
    const md = percorso.match(RE_DOCUMENTO);
    if (md) {
      if (documenti.some((d) => d.anno === md[2] && d.tipo === md[3])) continue;
      const est = md[4].toLowerCase().split(".").pop();
      const blob = await voce.async("blob");
      documenti.push({ anno: md[2], tipo: md[3], percorso: `documenti/${md[1]}-${md[2]}/${md[3]}/${md[4]}`, file: new File([blob], md[4], { type: TIPI_DOCUMENTO[est] || "" }) });
      continue;
    }
    if (/(^|\/)sessione\.json$/i.test(percorso)) {
      try { manifesto = JSON.parse(await voce.async("string")); } catch { /* manifesto illeggibile: si va avanti */ }
      continue;
    }
    if (!/\.json$/i.test(percorso)) continue;
    const nome = percorso.split("/").pop();
    const testo = await voce.async("string");
    let j;
    try { j = JSON.parse(testo); } catch { scartati.push(nome); continue; }
    if (String(j?.formato || "").startsWith("analisi-bilancio")) { analisi = { nome, testo }; continue; }
    if (eSalvataggioQoE(j)) { qoe = { nome, testo }; continue; }
    if (eBilancioTtm(j)) { ttm = { nome, testo, info: infoTtm(j) }; continue; }
    if (String(j?.formato || "").startsWith("proforma-dcf")) { dcf = { nome, testo }; continue; }
    if (String(j?.formato || "").startsWith("comparazione-")) continue;
    const s = riconosciProgramma(nome, j);
    const cartella = percorso.match(/(?:^|\/)(\d{4})-(\d{4})\/[^/]+$/);
    const dichiarato = String(j?.esercizioCorrente?.esercizio ?? j?.esercizio ?? "").match(/(\d{4})(?!.*\d{4})/);
    const anno = cartella ? cartella[2] : dichiarato?.[1];
    if (!s || !anno) { scartati.push(nome); continue; }
    const r = (per[anno] ||= { avvisi: [] });
    if (r[s]) { r.avvisi.push(`più file ${s} nella cartella: usato ${r[s].nome}`); continue; }
    r[s] = { nome, blob: new Blob([testo], { type: "application/json" }) };
    await completaRisultato(r, s, null);
  }
  for (const r of Object.values(per)) {
    for (const s of ["SP", "CE", "RF"]) if (!r[s]) r[s] = { errore: "assente nello ZIP" };
  }
  /* Il manifesto dice se i documenti di un esercizio sono già stati riclassificati
     (elaborato) e se Redditività li ha già letti (documentiIntegrati). */
  const notePerDoc = Array.isArray(manifesto?.documenti) ? manifesto.documenti : [];
  for (const d of documenti) {
    const n = notePerDoc.find((x) => x?.percorso === d.percorso) || notePerDoc.find((x) => String(x?.anno) === d.anno && x?.tipo === d.tipo);
    d.elaborato = n ? n.elaborato !== false : !!per[d.anno];
  }
  return {
    per, analisi, qoe, ttm, dcf, documenti, docTtm,
    documentiIntegrati: !!manifesto?.documentiIntegrati,
    documentiVisti: Array.isArray(manifesto?.documentiVisti) ? manifesto.documentiVisti : null,
    coda: manifesto?.coda || null,
    azienda: manifesto?.azienda || Object.values(per).find((r) => r.azienda)?.azienda || "", scartati,
  };
}
async function leggiZipSessione(file) {
  const zip = await JSZip.loadAsync(file);
  const gruppi = new Map(); // cartella dell'azienda -> voci
  const radice = [];
  let generale = null;
  for (const [percorso, voce] of Object.entries(zip.files)) {
    if (voce.dir || ignorato(percorso)) continue;
    const m = percorso.match(/(?:^|\/)aziende\/([^/]+)\/(.+)$/);
    if (m) {
      if (!gruppi.has(m[1])) gruppi.set(m[1], []);
      gruppi.get(m[1]).push({ percorso: m[2], voce });
    } else radice.push({ percorso, voce });
  }
  if (gruppi.size) {
    const s = radice.find((v) => /(^|\/)sessione\.json$/i.test(v.percorso));
    if (s) { try { generale = JSON.parse(await s.voce.async("string")); } catch { generale = null; } }
    const aziende = [];
    for (const [cartella, voci] of gruppi) {
      const l = await leggiVociAzienda(voci);
      const info = (generale?.aziende || []).find((a) => a.cartella === cartella);
      aziende.push({ ...l, cartella, nome: info?.nome || l.azienda || cartella.replace(/_/g, " "), principale: info?.ruolo === "principale", ordine: info ? generale.aziende.indexOf(info) : 999 });
    }
    aziende.sort((a, b) => a.ordine - b.ordine);
    if (!aziende.some((a) => a.principale)) aziende[0].principale = true;
    let comparazione = null;
    for (const v of radice) {
      if (!/\.json$/i.test(v.percorso) || /(^|\/)sessione\.json$/i.test(v.percorso)) continue;
      try { const t = await v.voce.async("string"); if (/"formato"\s*:\s*"comparazione-sessione/.test(t.slice(0, 400))) comparazione = t; } catch { /* file illeggibile */ }
    }
    return { multi: true, aziende, comparazione, coda: generale?.coda || null };
  }
  const l = await leggiVociAzienda(radice);
  return { multi: false, aziende: [{ ...l, nome: l.azienda, principale: true }] };
}

/* Bilancio TTM del Generatore Bilancio TTM (formato «bilancio-ttm/2.0»). */
const eBilancioTtm = (j) => String(j?.formato || "").startsWith("bilancio-ttm");
function infoTtm(j) {
  const ec = j?.esercizioCorrente || {};
  return {
    etichetta: ec.esercizio || "TTM",
    data: ec.dataRiferimento || null,
    mesi: ec.mesiCoperti ?? j?.periodoZero?.mesiCoperti ?? null,
    base: j?.periodoZero?.esercizioBase || null,
    unita: j?.unita || null,
    azienda: j?.azienda || null,
  };
}

/* Salvataggio unificato di «Quality of Earnings» (Validazione e Qualità Contabile). */
const eSalvataggioQoE = (j) => /Qualit[àa] Contabile/.test(String(j?.applicazione || ""));

/* Confronto di due JSON salvati ignorando l'ora di generazione. */
async function uguali(a, b) {
  if (!a || !b) return false;
  const norm = async (x) => {
    try {
      const j = JSON.parse(await x.text());
      delete j.generato; delete j.generatoIl;
      return JSON.stringify(j);
    } catch { return await x.text(); }
  };
  return (await norm(a)) === (await norm(b));
}

/* ============================== Interfaccia ============================== */
const rid = () => Math.random().toString(36).slice(2, 9);
const nuovoAnno = (anno = "", ripristinato = false) => ({ id: rid(), anno, ripristinato });
const annoValido = (a) => /^\d{4}$/.test(String(a || "").trim());
const nomeCartella = (anno) => `${Number(anno) - 1}-${anno}`;

/* File di un'azienda per la comparazione: l'analisi di Redditività ridotta
   alla sola azienda e ai soli esercizi interi (se c'è), altrimenti i JSON di
   SP, CE e RF; poi Quality of Earnings e DCF. Usata sia con i dati della suite
   sia con lo ZIP della sessione trascinato nella scheda Comparazione. */
function componiFileComparazione({ nome, analisiTesto = null, programmi = [], qoe = null, dcf = null }) {
  const out = [];
  const nomeF = String(nome || "azienda").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "azienda";
  let conAnalisi = false;
  if (analisiTesto) {
    try {
      const j = JSON.parse(analisiTesto);
      const p = j?.aziende?.principale;
      if (p?.esercizi) {
        const esercizi = Object.fromEntries(Object.entries(p.esercizi).filter(([k]) => /^\d{4}$/.test(String(k))));
        if (Object.keys(esercizi).length) {
          const { ttm: _t, ...resto } = p;
          const solo = { ...j, aziende: { principale: { ...resto, nome, esercizi } }, target: "principale" };
          out.push(new File([JSON.stringify(solo)], `analisi-bilancio_${nomeF}.json`, { type: "application/json" }));
          conAnalisi = true;
        }
      }
    } catch { /* analisi illeggibile: si usano i JSON dei programmi */ }
  }
  if (!conAnalisi) out.push(...programmi);
  if (qoe?.testo) out.push(new File([qoe.testo], qoe.nome, { type: "application/json" }));
  if (dcf?.testo) out.push(new File([dcf.testo], dcf.nome, { type: "application/json" }));
  return { file: out, conAnalisi };
}

/* Salvataggio QoE di una versione precedente: gli si aggiunge l'esito della
   Fase 5 (spread e Trust Score) ricalcolato dai dati salvati. */
function qoeConFase5(q) {
  if (!q?.testo || /"information_risk_premium_pct"\s*:\s*-?\d/.test(q.testo)) return q;
  try {
    const d = JSON.parse(q.testo);
    const p5 = esitoFase5DaSalvataggio(d);
    if (!p5) return q;
    const ricco = { ...d, schema_ecosistema: p5.schema, accounting_trust_score: p5.accounting_trust_score, trust_score_fascia: p5.trust_score_fascia,
      information_risk_premium_pct: p5.information_risk_premium_pct, information_risk_premium_bps: p5.information_risk_premium_bps,
      investable_flag: p5.investable_flag, fase5: p5 };
    return { nome: q.nome, testo: JSON.stringify(ricco) };
  } catch { return q; }
}

/* ZIP della sessione (o di un'azienda) → aziende per la comparazione. */
async function aziendeDaZipComparazione(file) {
  const zip = await JSZip.loadAsync(file);
  let indice = null;
  try { const r = zip.file("sessione.json"); if (r) indice = JSON.parse(await r.async("string")); } catch { indice = null; }
  const gruppi = new Map(); // cartella -> { percorsi }
  for (const p of Object.keys(zip.files)) {
    const v = zip.files[p];
    if (v.dir || !/\.json$/i.test(p) || /(^|\/)(__MACOSX\/|\._)/.test(p)) continue;
    const m = /^aziende\/([^/]+)\/(.+)$/.exec(p);
    const cart = m ? m[1] : "";
    const resto = m ? m[2] : p;
    if (!m && /^(comparazione|documenti)\//i.test(p)) continue;
    if (/^documenti\//i.test(resto) || /(^|\/)sessione\.json$/i.test(resto)) continue;
    if (!gruppi.has(cart)) gruppi.set(cart, []);
    gruppi.get(cart).push({ percorso: resto, voce: v });
  }
  const voci = Array.isArray(indice?.aziende) ? indice.aziende : [];
  const out = [];
  for (const [cart, el] of gruppi) {
    const info = voci.find((a) => a.cartella === cart) || null;
    const nome = info?.nome || (cart ? cart.replace(/_/g, " ") : (indice?.azienda || String(file.name).replace(/\.zip$/i, "")));
    let analisiTesto = null, qoe = null, dcf = null;
    const programmi = [];
    for (const { percorso, voce } of el.sort((a, b) => a.percorso.localeCompare(b.percorso))) {
      const nomeF = percorso.split("/").pop();
      if (/^redditivita-solvibilita\//i.test(percorso)) analisiTesto = await voce.async("string");
      else if (/^quality-of-earnings\//i.test(percorso)) qoe = { nome: nomeF, testo: await voce.async("string") };
      else if (/^proforma-dcf\//i.test(percorso)) dcf = { nome: nomeF, testo: await voce.async("string") };
      else if (/^\d{4}-\d{4}\//.test(percorso)) programmi.push(new File([await voce.async("blob")], nomeF, { type: "application/json" }));
    }
    if (!analisiTesto && !programmi.length) continue;
    qoe = qoeConFase5(qoe);
    const { file: fileC, conAnalisi } = componiFileComparazione({ nome, analisiTesto, programmi, qoe, dcf });
    out.push({ id: `zip-${cart || "radice"}`, nome, ruolo: info?.ruolo || "", file: fileC,
      riepilogo: { analisi: conAnalisi, programmi: conAnalisi ? 0 : programmi.length, qoe: !!qoe, dcf: !!dcf } });
  }
  out.sort((a, b) => (b.ruolo === "principale") - (a.ruolo === "principale"));
  return out;
}
const pulisciNome = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
const STEP_ETICHETTA = {
  "T.prospetti": "Prospetti T", "T.ni": "Nota Integrativa T", "T.rg": "Relazione sulla Gestione T",
  "T1.prospetti": "Prospetti T-1", "T1.ni": "Nota Integrativa T-1", "T1.rg": "Relazione sulla Gestione T-1",
  ponte: "JSON di SP e CE nel tab 4 del Rendiconto", esporta: "Salvataggio dei 3 JSON",
};
/* Un'azienda della sessione (una scheda): stessi dati della schermata singola. */
const nuovaAzienda = (nome, nomeAuto = true) => ({
  id: rid(), nome, nomeAuto, anni: [nuovoAnno()], file: {}, risultati: {}, ttm: null, analisi: null, sessione: null, avanzamento: [],
  qoe: null, qoeFirma: null, // salvataggio di Quality of Earnings { nome, testo } e fotografia dei dati usati
  dcf: null, // ultima esportazione JSON del suo Pro-forma e DCF { nome, testo }
  docIntegrati: false, // i suoi documenti sono già passati dall'integrazione documentale di Redditività
});
const conRisultati = (risultati) => Object.values(risultati || {}).some((r) => ["SP", "CE", "RF"].some((s) => r?.[s]?.blob));
/* Un esercizio va riclassificato se ha i prospetti e non è già stato
   riclassificato con questi stessi documenti (docElaborati: si azzera quando
   cambi un documento dell'esercizio o premi «Rielabora»). */
const daRiclassificare = (a, file, risultati) =>
  annoValido(a.anno) && !!file?.[`${a.id}.prospetti`] && !(a.docElaborati && risultati?.[a.anno]);
const completata = (u) => ["fatto", "avviso", "errore"].includes(u?.stato);
const bloccato = (messaggio) => Object.assign(new Error(messaggio), { bloccato: true });
const formatoMB = (b) => `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;

/* Stato React con un ref sempre allineato: la coda lavora per minuti dentro
   una sola funzione asincrona e deve leggere i valori correnti, non quelli
   del momento in cui è partita. */
function useStatoConRef(iniziale) {
  const [v, setV] = useState(iniziale);
  const ref = useRef(undefined);
  const pronto = useRef(false);
  if (!pronto.current) { ref.current = v; pronto.current = true; }
  const set = useCallback((x) => {
    const n = typeof x === "function" ? x(ref.current) : x;
    ref.current = n;
    setV(n);
  }, []);
  return [v, set, ref];
}

export default function App() {
  /* ---------- Aziende della sessione ----------
     Ogni scheda è un'azienda con i propri esercizi, documenti, riclassificazioni,
     TTM e analisi di Redditività e solvibilità. L'azienda «attiva» è quella
     aperta nelle schede SP, CE, RF e Redditività: i suoi dati vivono negli stati
     di lavoro qui sotto (anni, file, risultati…), quelli delle altre nel loro
     elemento di «aziende». Passando a un'altra azienda le modifiche fatte nelle
     schede vengono riprese, come quando si cambia esercizio. */
  const inizio = useRef(null);
  if (!inizio.current) inizio.current = nuovaAzienda("Azienda in analisi");
  const [aziende, setAziende, aziendeRef] = useStatoConRef([inizio.current]);
  const [attiva, setAttiva, attivaRef] = useStatoConRef(inizio.current.id);
  const [principale, setPrincipale, principaleRef] = useStatoConRef(inizio.current.id);
  const [cambioAz, setCambioAz] = useState(null); // azienda in apertura

  const [anni, setAnni, anniRef] = useStatoConRef(inizio.current.anni);
  const [file, setFile, fileRef] = useStatoConRef({}); // chiave: `${idAnno}.${documento}`
  const [vista, setVista] = useState("carica"); // RICERCA | carica | SP | CE | RF | RS | QOE | DCF | CMP
  /* La pagina di Ricerca Aziende si monta alla prima apertura e poi resta viva. */
  const [ricercaAperta, setRicercaAperta] = useState(false);
  useEffect(() => { if (vista === "RICERCA") setRicercaAperta(true); }, [vista]);
  const [strategicaAperta, setStrategicaAperta] = useState(false);
  useEffect(() => { if (vista === "STRAT") setStrategicaAperta(true); }, [vista]);
  const [stato, setStato] = useState("pronto"); // pronto | verifica | in_corso | finito | errore | interrotto
  const [avanzamento, setAvanzamento, avanzamentoRef] = useStatoConRef([]); // [{anno, passi: [{step, stato, nota}], stato, nota}]
  const [risultati, setRisultati, risultatiRef] = useStatoConRef({}); // { anno: { SP, CE, RF: {nome, blob} | {errore}, avvisi: [] } }
  const [errore, setErrore] = useState("");
  const [, aggiorna] = useState(0);
  const contenitori = { SP: useRef(null), CE: useRef(null), RF: useRef(null) };
  const controllo = useRef(null);
  /* Fornitore e chiave dell'IA, unici per tutti i programmi (chiave-unica.js). */
  const [providerIA, setProviderIA] = useState(leggiProvider());
  const [modelloIA, setModelloIA] = useState(leggiModello());
  const [chiave, setChiave] = useState(leggiChiave());
  const [ricorda, setRicorda] = useState(chiaveRicordata());
  const [vedi, setVedi] = useState(false);
  const [hostingChiavi, setHostingChiavi] = useState(null); // { anthropic, openai } configurate sull'hosting | null
  useEffect(() => { if (!modalitaArtifact) chiaveSullHosting().then(setHostingChiavi); }, []);
  const hosting = hostingChiavi ? !!hostingChiavi[providerIA] : null;
  const cambiaChiave = (v, r = ricorda) => { setChiave(v.trim()); impostaChiave(v, r); };
  const cambiaProvider = (p) => { impostaProvider(p, ricorda); setProviderIA(p); setChiave(leggiChiave(p)); };
  const chiaveOk = modalitaArtifact || !!chiave || (providerIA === "anthropic" && hosting === true);

  /* Coda di elaborazione: unità della fase 1 (un esercizio di un'azienda) e
     della fase 2 (Redditività e solvibilità di un'azienda). */
  const [coda, setCoda, codaRef] = useStatoConRef(null); // { unita: [...], corrente, creata }

  /* I tre programmi vengono rimontati da zero tra un esercizio e l'altro
     (e con «Azzera tutto»), come a pagina appena aperta. */
  const [versione, setVersione] = useState(0);
  const [confermaAzzera, setConfermaAzzera] = useState(false);
  const azzerato = useRef(false);
  const [dlInCorso, setDlInCorso] = useState(null);
  const [esitoDl, setEsitoDl] = useState(null);

  /* Esercizio in vista nelle schede SP, CE e RF. Le modifiche fatte lì
     vengono riprese (con lo stesso «Salva dati» dei programmi) quando passi a
     un altro esercizio, a un'altra azienda o scarichi. */
  const [annoAttivo, setAnnoAttivo] = useState(null);
  /* «Redditività e solvibilità»: un'istanza sola, per l'azienda indicata da
     rsAzienda; riparte da zero (nuova chiave) a ogni nuovo passaggio. */
  const [zipRS, setZipRS] = useState(null);
  const [versioneRS, setVersioneRS] = useState(0);
  const [msgRS, setMsgRS] = useState(null);
  const [docsRS, setDocsRS] = useState({ elenco: [], avvio: false });
  const [concorrentiRS, setConcorrentiRS] = useState(null);
  const [rsAzienda, setRsAzienda] = useState(null);
  const rsAziendaRef = useRef(null);
  const [rsFirmaPeer, setRsFirmaPeer] = useState(null);
  const [analisiRS, setAnalisiRS] = useState(null);
  const rsApi = useRef(null);
  const analisiCorrenteRS = () => { try { return rsApi.current?.esporta?.() || null; } catch { return null; } };

  /* Bilancio TTM (dal Generatore Bilancio TTM): viaggia nello ZIP in «ttm/» e
     arriva a Redditività e solvibilità come periodo distinto; da lì, dentro la
     sintesi, al Pro-forma e DCF come anno base. Quality of Earnings lo esclude. */
  const [ttm, setTtm, ttmRef] = useStatoConRef(null); // { nome, testo, info }
  const [msgTtm, setMsgTtm] = useState(null);
  const inputTtm = useRef(null);
  const [sopraTtm, setSopraTtm] = useState(false); // JSON trascinato sopra il riquadro TTM

  /* «Quality of Earnings»: lavora sull'azienda in analisi. Riceve lo ZIP la
     prima volta che se ne apre la scheda, oppure il proprio salvataggio quando
     si riapre uno ZIP che lo contiene. «Bilancio pro-forma e DCF» invece non
     riceve nulla da solo: lo ZIP definitivo lo carichi tu dalla sua pagina. */
  const [qoe, setQoe] = useState({ versione: 0, zip: null, salvataggio: null, aperto: false, aggiornamento: false, firma: null });
  const [qoeSuperato, setQoeSuperato] = useState(false);
  const qoeApi = useRef(null);
  /* Quality of Earnings segue l'azienda aperta, come Redditività: un'istanza
     sola, il cui lavoro passa nella scheda dell'azienda quando si cambia. */
  const [qoeAzienda, setQoeAzienda] = useState(null);
  const qoeAziendaRef = useRef(null);
  /* Pro-forma e DCF: una pagina per azienda, montata alla prima apertura e
     tenuta viva (nascosta) quando si passa a un'altra azienda. */
  const [dcfAziende, setDcfAziende] = useState([]);
  const paginaDcf = useMemo(() => paginaDcfConZip(htmlProformaDcf), []);
  /* «Comparazione settoriale»: un'istanza per tutta la sessione. Riceve un
     riquadro per azienda con i suoi JSON (aziende), oppure una sessione salvata
     da ripristinare (sessione). firma = dati della suite al momento del
     passaggio: se cambiano, la scheda propone «Aggiorna». */
  const [cmp, setCmp] = useState({ versione: 0, aziende: null, sessione: null, firma: null });
  const cmpApi = useRef(null);
  const azzeraQoe = (salvataggio = null) => {
    setQoeSuperato(false);
    setQoe((q) => ({ versione: q.versione + 1, zip: null, salvataggio, aperto: false, aggiornamento: false, firma: null }));
  };

  /* Anno passato ai programmi: quello in elaborazione o quello in vista. */
  const [annoProgrammi, setAnnoProgrammiStato] = useState("");
  const setAnnoProgrammi = (a) => { impostaAnnoDiRiferimento(a); setAnnoProgrammiStato(a || ""); };
  const [cambio, setCambio] = useState(null); // anno in apertura
  const annoAttivoRef = useRef(null);
  useEffect(() => { annoAttivoRef.current = annoAttivo; }, [annoAttivo]);
  const [sessione, setSessione, sessioneRef] = useStatoConRef(null); // { azienda, nome } dello ZIP riaperto

  /* ---------- Dati di un'azienda (attiva: stati di lavoro; altre: scheda) ---------- */
  const aziendaById = (id) => aziendeRef.current.find((z) => z.id === id) || null;
  const aggiornaAzienda = (id, campi) =>
    setAziende((lista) => lista.map((z) => (z.id === id ? { ...z, ...(typeof campi === "function" ? campi(z) : campi) } : z)));
  const datiAzienda = (id) => {
    const z = aziendaById(id);
    if (!z) return null;
    if (id !== attivaRef.current) return z;
    return { ...z, anni: anniRef.current, file: fileRef.current, risultati: risultatiRef.current, ttm: ttmRef.current, sessione: sessioneRef.current, avanzamento: avanzamentoRef.current };
  };
  /* Analisi di Redditività e solvibilità: dal programma se è aperto su
     quell'azienda, altrimenti l'ultima ripresa nella scheda. */
  const analisiDi = (id) => {
    if (rsAziendaRef.current === id) { const a = analisiCorrenteRS(); if (a) return a; }
    return aziendaById(id)?.analisi || null;
  };
  /* Salvataggio di Quality of Earnings di un'azienda: dal programma se è aperto
     su di essa (e ha già ripristinato il proprio salvataggio), altrimenti dalla scheda. */
  const qoeLiveDi = (id) => {
    if (qoeAziendaRef.current === id && (qoeRef.current.zip || qoeRef.current.salvataggio)) {
      try {
        if (qoeApi.current?.stato?.().ripristinato !== false) {
          const sq = qoeApi.current?.esporta?.();
          if (sq) return { nome: sq.nome, testo: sq.testo };
        }
      } catch { /* resta la copia della scheda */ }
    }
    return aziendaById(id)?.qoe || null;
  };
  /* DCF di un'azienda: dalla sua pagina «Pro-forma e DCF» se è aperta e ha
     dati (stessa esportazione di «Scarica il JSON»), altrimenti l'ultimo
     salvato. La copia letta dalla pagina resta anche nella scheda. */
  const dcfLiveDi = (id, { aggiorna = true } = {}) => {
    try {
      const fr = document.querySelector(`iframe[data-dcf-azienda="${CSS.escape(String(id))}"]`);
      const x = fr?.contentWindow?.__dcfEsporta?.();
      if (x) {
        const slug = String(x.azienda || aziendaById(id)?.nome || "azienda").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "azienda";
        const dcf = { nome: `proforma-dcf_${slug}.json`, testo: JSON.stringify(x, null, 2) };
        if (aggiorna && aziendaById(id)?.dcf?.testo !== dcf.testo) aggiornaAzienda(id, { dcf });
        return dcf;
      }
    } catch { /* resta l'ultimo salvato */ }
    return aziendaById(id)?.dcf || null;
  };
  /* Il lavoro di QoE dell'azienda che lo lascia resta nella sua scheda. */
  const catturaQoe = () => {
    const id = qoeAziendaRef.current;
    if (!id || !aziendaById(id) || !(qoeRef.current.zip || qoeRef.current.salvataggio)) return;
    const sq = qoeLiveDi(id);
    if (sq) aggiornaAzienda(id, { qoe: sq, qoeFirma: qoeRef.current.firma ?? null });
  };
  /* Monta Quality of Earnings sull'azienda indicata, con il suo salvataggio. */
  const montaQoe = (id, { cattura = true } = {}) => {
    if (cattura) catturaQoe();
    const z = aziendaById(id);
    qoeAziendaRef.current = id;
    setQoeAzienda(id);
    setQoeSuperato(false);
    setQoe((q) => ({ versione: q.versione + 1, zip: null, salvataggio: z?.qoe?.testo || null, aperto: false, aggiornamento: false, firma: z?.qoeFirma ?? null }));
  };
  const documentiUltimoAnno = (id) => {
    const el = documentiDi(id);
    const ultimo = Math.max(0, ...el.map((d) => Number(d.anno) || 0));
    const visti = new Set();
    return el.filter((d) => Number(d.anno) === ultimo).filter((d) => {
      const k = `${d.file.name}|${d.file.size}`;
      if (visti.has(k)) return false;
      visti.add(k);
      return true;
    });
  };
  const documentiDi = (id) => {
    const d = datiAzienda(id);
    if (!d) return [];
    const el = d.anni.filter((a) => annoValido(a.anno)).flatMap((a) =>
      ["prospetti", "ni", "rg"].filter((x) => d.file[`${a.id}.${x}`]).map((x) => ({ file: d.file[`${a.id}.${x}`], anno: a.anno, tipo: x })));
    // La relazione infrannuale vale solo insieme al suo bilancio TTM.
    if (d.ttm && d.file[CHIAVE_DOC_TTM]) el.push({ file: d.file[CHIAVE_DOC_TTM], anno: "TTM", tipo: "infrannuale" });
    return el;
  };
  /* Documenti già letti dall'integrazione documentale di Redditività. Le
     sessioni precedenti avevano solo «già integrati sì/no»: in quel caso
     valgono come letti tutti i documenti presenti. */
  const vistiDi = (id) => {
    const z = aziendaById(id);
    if (Array.isArray(z?.docVisti)) return new Set(z.docVisti);
    return new Set(z?.docIntegrati ? documentiDi(id).map(chiaveDoc) : []);
  };
  const documentiNuovi = (id) => { const v = vistiDi(id); return documentiDi(id).filter((x) => !v.has(chiaveDoc(x))); };
  const nomeDaRisultati = (r, s) => Object.values(r || {}).find((x) => x?.azienda)?.azienda || s?.azienda || "";
  /* Firma del Peer Group di un'azienda: le riclassificazioni e i nomi di tutte
     le altre. Se cambia dopo l'ultimo passaggio, Redditività lo segnala. */
  const firmaPeerDi = (id) => aziendeRef.current.filter((z) => z.id !== id).map((z) => {
    const r = datiAzienda(z.id)?.risultati || {};
    return `${z.id}:${z.nome}:` + Object.keys(r).sort().map((a) => `${a}=` + ["SP", "CE", "RF"].map((s) => (r[a][s]?.blob ? r[a][s].blob.size : "-")).join(",")).join(";");
  }).join("|");

  /* Riporta nella scheda dell'azienda attiva i suoi stati di lavoro. */
  const fotografaAttiva = () => {
    const id = attivaRef.current;
    const d = datiAzienda(id);
    if (!d) return;
    const az = nomeDaRisultati(d.risultati, d.sessione);
    aggiornaAzienda(id, {
      anni: d.anni, file: d.file, risultati: d.risultati, ttm: d.ttm, sessione: d.sessione, avanzamento: d.avanzamento,
      analisi: analisiDi(id),
      ...(d.nomeAuto && az ? { nome: az } : {}),
    });
  };
  /* Porta i dati di una scheda negli stati di lavoro (programmi puliti). */
  const caricaInLavoro = (z) => {
    setAnni(z.anni?.length ? z.anni : [nuovoAnno()]);
    setFile(z.file || {});
    setRisultati(z.risultati || {});
    setTtm(z.ttm || null);
    setSessione(z.sessione || null);
    setAvanzamento(z.avanzamento || []);
    setMsgZip(null);
    setMsgTtm(null);
    setEsitoDl(null);
    annoAttivoRef.current = null;
    setAnnoAttivo(null);
    setAnnoProgrammi("");
    setVersione((v) => v + 1);
  };

  /* Passa a Redditività e solvibilità le riclassificazioni di un'azienda,
     i suoi documenti (integrazione documentale), l'analisi salvata e, come
     Peer Group, tutte le altre aziende con riclassificazioni. */
  const passaARSAzienda = async (id, { avvio = false } = {}) => {
    const d = datiAzienda(id);
    if (!d) return { zip: false, concorrenti: 0, documenti: 0 };
    const zip = conRisultati(d.risultati) ? await zipComeFile(id, { conAnalisi: false, conQoe: false }) : null;
    const concorrenti = [];
    for (const z of aziendeRef.current) {
      if (z.id === id || !conRisultati(datiAzienda(z.id)?.risultati)) continue;
      concorrenti.push({ id: z.id, nome: z.nome, zip: await zipComeFile(z.id, { conAnalisi: false, conQoe: false, conTtm: false }) });
    }
    const elenco = avvio ? documentiNuovi(id) : documentiDi(id);
    /* L'analisi dell'azienda che lascia Redditività resta nella sua scheda. */
    const vecchia = rsAziendaRef.current;
    if (vecchia && vecchia !== id && aziendaById(vecchia)) { const a = analisiCorrenteRS(); if (a) aggiornaAzienda(vecchia, { analisi: a }); }
    setAnalisiRS(analisiDi(id)?.testo || null);
    setZipRS(zip);
    setDocsRS({ elenco, avvio: avvio && elenco.length > 0 });
    setConcorrentiRS(concorrenti);
    rsAziendaRef.current = id;
    setRsAzienda(id);
    setRsFirmaPeer(firmaPeerDi(id));
    setVersioneRS((v) => v + 1);
    return { zip: !!zip, concorrenti: concorrenti.length, documenti: elenco.length, chiavi: elenco.map(chiaveDoc), nomi: concorrenti.map((c) => c.nome) };
  };

  const riprendiModifiche = async () => {
    const anno = annoAttivoRef.current;
    const prima = risultatiRef.current[anno];
    if (!anno || !prima) return risultatiRef.current;
    const dopo = { ...prima };
    dopo.avvisi = [...(prima.avvisi || [])];
    for (const s of ["SP", "CE"]) {
      try { dopo[s] = await esportaJson(s, contenitori[s].current); await completaRisultato(dopo, s, null); }
      catch { /* il programma non ha dati da salvare: resta la versione precedente */ }
    }
    /* Se SP o CE sono stati modificati, il tab 4 del Rendiconto riceve i JSON
       aggiornati prima di salvare l'RF, così i flussi restano coerenti. */
    for (const s of ["SP", "CE"]) {
      if (!dopo[s]?.blob || (await uguali(prima[s]?.blob, dopo[s].blob))) continue;
      try {
        consegnaFile(inputDelProgramma(contenitori.RF.current, "RF", `ponte.${s}`), new File([dopo[s].blob], dopo[s].nome, { type: "application/json" }));
        await pausa(1500);
      } catch { /* resta il tab 4 com'era */ }
    }
    try { dopo.RF = await esportaJson("RF", contenitori.RF.current); await completaRisultato(dopo, "RF", null); }
    catch { /* resta la versione precedente */ }
    /* Il JSON identico al precedente resta lo stesso oggetto (niente nuovo salvataggio). */
    for (const s of ["SP", "CE", "RF"]) if (prima[s]?.blob && dopo[s]?.blob && dopo[s] !== prima[s] && (await uguali(prima[s].blob, dopo[s].blob))) dopo[s] = prima[s];
    const tutti = { ...risultatiRef.current, [anno]: dopo };
    setRisultati(tutti);
    return tutti;
  };

  const apriAnno = async (anno) => {
    if (anno === annoAttivoRef.current || cambio) return;
    setCambio(anno);
    try {
      const tutti = await riprendiModifiche();
      setAnnoProgrammi(anno);
      setVersione((v) => v + 1); // programmi puliti
      await pausa(2000);
      const r = tutti[anno];
      for (const s of ["SP", "CE", "RF"]) {
        if (!r?.[s]?.blob) continue;
        consegnaFile(inputDelProgramma(contenitori[s].current, s, "json"), new File([r[s].blob], r[s].nome, { type: "application/json" }));
      }
      await pausa(1500);
      setAnnoAttivo(anno);
      annoAttivoRef.current = anno;
    } catch (e) {
      setErrore(`Apertura dell'esercizio ${anno} non riuscita: ${e.message}`);
    } finally {
      setCambio(null);
    }
  };

  /* Cambio di azienda: modifiche riprese, dati scambiati, programmi puliti.
     apri: apre l'ultimo esercizio nelle schede; rs: Redditività su questa azienda. */
  const attivaAzienda = async (id, { apri = true, rs = true, qoe: conQoe = rs } = {}) => {
    if (!aziendaById(id)) return;
    if (id !== attivaRef.current) {
      if (annoAttivoRef.current) await riprendiModifiche();
      fotografaAttiva();
      const z = aziendaById(id);
      attivaRef.current = id;
      setAttiva(id);
      caricaInLavoro(z);
    }
    if (rs && rsAziendaRef.current !== id) await passaARSAzienda(id);
    if (conQoe && qoeAziendaRef.current !== id) montaQoe(id);
    if (apri && !annoAttivoRef.current) {
      const el = Object.keys(risultatiRef.current).sort();
      if (el.length) { await pausa(300); await apriAnno(el[el.length - 1]); }
    }
  };
  const scegliAzienda = async (id) => {
    if (id === attivaRef.current || cambioAz) return;
    setCambioAz(id);
    setErrore("");
    try { await attivaAzienda(id); }
    catch (e) { setErrore(`Apertura di «${aziendaById(id)?.nome}» non riuscita: ${e.message}`); }
    finally { setCambioAz(null); }
  };
  const aggiungiAzienda = async () => {
    const n = aziendeRef.current.length;
    const z = nuovaAzienda(`Concorrente ${n}`);
    setAziende((l) => [...l, z]);
    await scegliAzienda(z.id);
  };
  const rinominaAzienda = (id, nome) => aggiornaAzienda(id, { nome, nomeAuto: false });
  const [confermaAz, setConfermaAz] = useState(null); // { tipo: "rimuovi" | "principale", id }
  const rimuoviAzienda = async (id) => {
    setConfermaAz(null);
    if (id === principaleRef.current || aziendeRef.current.length < 2) return;
    if (id === attivaRef.current) {
      /* Le modifiche nelle schede appartengono all'azienda che si toglie. */
      annoAttivoRef.current = null;
      setAnnoAttivo(null);
      await scegliAzienda(principaleRef.current);
    }
    setAziende((l) => l.filter((z) => z.id !== id));
    setDcfAziende((l) => l.filter((x) => x !== id));
    setCoda((c) => (c ? { ...c, unita: c.unita.filter((u) => u.azienda !== id) } : c));
  };
  const impostaPrincipale = (id) => {
    setConfermaAz(null);
    if (id === principaleRef.current) return;
    setPrincipale(id);
  };

  /* ---------- Riapri sessione da ZIP ---------- */
  const inputZip = useRef(null);
  const inputZipAzienda = useRef(null);
  const [zipInAttesa, setZipInAttesa] = useState(null); // { file, modo: "sessione" | "azienda" } in attesa di conferma
  const [msgZip, setMsgZip] = useState(null);
  const sessioneAperta = () =>
    aziendeRef.current.some((z) => z.id !== attivaRef.current && (conRisultati(z.risultati) || Object.keys(z.file || {}).length)) ||
    Object.keys(risultatiRef.current).length > 0 || Object.keys(fileRef.current).length > 0;
  const aziendaAttivaConDati = () => Object.keys(risultatiRef.current).length > 0 || Object.keys(fileRef.current).length > 0;
  const scegliZip = (f, modo = "sessione") => {
    if (!f) return;
    if (modo === "sessione" ? sessioneAperta() : aziendaAttivaConDati()) setZipInAttesa({ file: f, modo });
    else if (modo === "sessione") riapriDaZip(f);
    else caricaZipInAzienda(f);
  };
  const aziendaDaLetto = (a, nomeFile, base = null) => {
    /* Esercizi: quelli con le riclassificazioni e quelli che nello ZIP hanno
       solo i documenti (interrotti prima di finire). */
    const docs = a.documenti || [];
    const elencoAnni = [...new Set([...Object.keys(a.per), ...docs.map((d) => d.anno)])].sort();
    const anniA = elencoAnni.map((x) => {
      const dx = docs.filter((d) => d.anno === x);
      return { ...nuovoAnno(x, !!a.per[x]), docElaborati: dx.length > 0 && !!a.per[x] && dx.every((d) => d.elaborato) };
    });
    const fileA = {};
    for (const d of docs) {
      const an = anniA.find((y) => y.anno === d.anno);
      if (an && !fileA[`${an.id}.${d.tipo}`]) fileA[`${an.id}.${d.tipo}`] = d.file;
    }
    if (a.docTtm && a.ttm) fileA[CHIAVE_DOC_TTM] = a.docTtm;
    return {
    ...(base || nuovaAzienda(a.nome || a.azienda || "Azienda")),
    ...(base ? {} : { nome: a.nome || a.azienda || "Azienda", nomeAuto: !a.nome && !a.azienda }),
    anni: anniA.length ? anniA : [nuovoAnno()],
    file: fileA,
    docIntegrati: !!a.documentiIntegrati && docs.length > 0,
    ...(a.documentiVisti ? { docVisti: a.documentiVisti } : {}),
    risultati: a.per,
    ttm: a.ttm || null,
    analisi: a.analisi ? { nome: a.analisi.nome, testo: a.analisi.testo } : null,
    qoe: a.qoe ? { nome: a.qoe.nome, testo: a.qoe.testo } : null,
    qoeFirma: null,
    dcf: a.dcf ? { nome: a.dcf.nome, testo: a.dcf.testo } : null,
    sessione: { azienda: a.azienda, nome: nomeFile },
    avanzamento: [],
    };
  };
  const descriviLetto = (a) => {
    const elenco = Object.keys(a.per).sort();
    const vuoti = elenco.flatMap((x) => ["SP", "CE", "RF"].filter((s) => !a.per[x][s]?.blob || a.per[x][s].vuoto).map((s) => `${s} ${x}`));
    const nd = (a.documenti || []).length;
    const soloDoc = [...new Set((a.documenti || []).map((d) => d.anno))].filter((x) => !a.per[x]).sort();
    const parti = [];
    if (elenco.length) parti.push(`${elenco.map(nomeCartella).join(", ")}${vuoti.length ? ` (senza dati: ${vuoti.join(", ")})` : ""}`);
    if (nd) parti.push(`${nd} ${nd === 1 ? "documento" : "documenti"} ripristinati`);
    if (soloDoc.length) parti.push(`da riclassificare: ${soloDoc.join(", ")}`);
    return { elenco, vuoti, testo: parti.join(" · ") || "nessun dato" };
  };
  /* Coda salvata nello ZIP (sessione interrotta): le aziende sono indicate per
     cartella, qui tornano agli id della sessione riaperta. */
  const codaDaZip = (cz, idDi) => {
    if (!Array.isArray(cz?.unita) || !cz.unita.length) return null;
    const unita = cz.unita.filter((u) => u.fase !== 4).map((u) => {
      const az = u.fase === 4 ? idDi(u.azienda) || principaleRef.current : idDi(u.azienda);
      if (!az) return null;
      const id = u.fase === 1 ? `1:${az}:${u.anno}` : u.fase === 4 ? "4:tutte" : `${u.fase}:${az}`;
      return { ...u, id, azienda: az, ...(u.stato === "in_corso" ? { stato: "attesa", fatti: 0 } : {}) };
    }).filter(Boolean);
    if (!unita.some((u) => !completata(u))) return null;
    return { creata: cz.creata || new Date().toISOString(), corrente: "", unita };
  };
  const riapriDaZip = async (f) => {
    setZipInAttesa(null);
    setErrore("");
    setMsgZip({ tipo: "info", testo: `Lettura di «${f.name}»…` });
    let letto;
    try { letto = await leggiZipSessione(f); }
    catch (e) { setMsgZip({ tipo: "warn", testo: `ZIP non leggibile: ${e.message}` }); return; }
    const valide = letto.aziende.filter((a) => Object.keys(a.per).length || a.documenti?.length);
    if (!valide.length) {
      setMsgZip({ tipo: "warn", testo: "Nello ZIP non ci sono riclassificazioni né documenti riconoscibili: servono le cartelle per esercizio («2024-2025/») con i JSON di SP, CE e RF salvati da questa schermata." });
      return;
    }
    azzerato.current = true;
    controllo.current?.abort();
    annoAttivoRef.current = null;
    setAnnoAttivo(null);
    const lista = valide.map((a) => aziendaDaLetto(a, f.name));
    const ip = Math.max(0, valide.findIndex((a) => a.principale));
    const princ = lista[ip];
    setAziende(lista);
    setPrincipale(princ.id);
    attivaRef.current = princ.id;
    setAttiva(princ.id);
    caricaInLavoro(princ);
    rsAziendaRef.current = null;
    /* Coda interrotta salvata nello ZIP: torna com'era, con «Riprendi». */
    const idPerCartella = (c) => {
      const i = letto.multi ? valide.findIndex((a) => a.cartella === c) : c === "questa" ? 0 : -1;
      return i >= 0 ? lista[i].id : null;
    };
    const codaZ = codaDaZip(letto.multi ? letto.coda : valide[0].coda, idPerCartella);
    setCoda(codaZ);
    setStato(codaZ ? "interrotto" : "pronto");
    setVista("carica");
    qoeAziendaRef.current = null;
    montaQoe(princ.id, { cattura: false });
    setDcfAziende([]);
    const scartati = valide.flatMap((a) => a.scartati);
    const desc = valide.map((a) => `${valide.length > 1 ? `${a.nome}: ` : ""}${descriviLetto(a).testo}`);
    setMsgZip({
      tipo: desc.some((t) => t.includes("senza dati")) ? "warn" : "ok",
      testo: `Sessione riaperta${valide.length > 1 ? ` · ${valide.length} aziende` : princ.sessione?.azienda ? ` · ${princ.sessione.azienda}` : ""}: ${desc.join(" · ")}.` +
        (codaZ ? " L'elaborazione si era fermata: premi «Riprendi» per continuare dal primo passo non completato, senza ricaricare i documenti." : "") +
        (scartati.length ? ` File ignorati: ${scartati.join(", ")}.` : ""),
    });
    const info = await passaARSAzienda(princ.id);
    if (info.zip) setMsgRS({ tipo: "ok", testo: `«${f.name}» passato anche a «Redditività e solvibilità»${valide[ip].analisi ? `, con l'analisi salvata (${valide[ip].analisi.nome})` : ""}${info.concorrenti ? ` · Peer Group: ${info.nomi.join(", ")}` : ""}.` });
    const el = Object.keys(princ.risultati).sort();
    if (el.length) await apriAnno(el[el.length - 1]);
    /* Comparazione: quella salvata nello ZIP, altrimenti si compone da sola. */
    if (letto.comparazione) setCmp((c) => ({ versione: c.versione + 1, aziende: null, sessione: letto.comparazione, firma: firmaComparazione() }));
    else { setCmp((c) => ({ versione: c.versione + 1, aziende: null, sessione: null, firma: null })); await pausa(200); dopoNuoviDatiRef.current?.(); }
    salvaPresto();
  };
  /* ZIP di una sola azienda dentro la scheda aperta (per esempio un concorrente
     già riclassificato in un'altra sessione). */
  const caricaZipInAzienda = async (f) => {
    setZipInAttesa(null);
    setErrore("");
    setMsgZip({ tipo: "info", testo: `Lettura di «${f.name}»…` });
    let letto;
    try { letto = await leggiZipSessione(f); }
    catch (e) { setMsgZip({ tipo: "warn", testo: `ZIP non leggibile: ${e.message}` }); return; }
    if (letto.multi) {
      setMsgZip({ tipo: "warn", testo: `«${f.name}» è lo ZIP di una sessione con ${letto.aziende.length} aziende: per aprirlo usa «Riapri sessione da ZIP».` });
      return;
    }
    const a = letto.aziende[0];
    if (!Object.keys(a.per).length && !a.documenti?.length) {
      setMsgZip({ tipo: "warn", testo: "Nello ZIP non ci sono riclassificazioni né documenti riconoscibili." });
      return;
    }
    const id = attivaRef.current;
    const base = aziendaById(id);
    annoAttivoRef.current = null;
    setAnnoAttivo(null);
    const z = { ...aziendaDaLetto(a, f.name, base), ...(base.nomeAuto && a.azienda ? { nome: a.azienda } : {}) };
    setAziende((l) => l.map((x) => (x.id === id ? z : x)));
    caricaInLavoro(z);
    rsAziendaRef.current = null;
    if (qoeAziendaRef.current === id) { qoeAziendaRef.current = null; montaQoe(id, { cattura: false }); }
    const d = descriviLetto(a);
    setMsgZip({ tipo: d.vuoti.length ? "warn" : "ok", testo: `«${f.name}» caricato in «${z.nome}»: ${d.testo}.` + (a.scartati.length ? ` File ignorati: ${a.scartati.join(", ")}.` : "") });
    await passaARSAzienda(id);
    if (d.elenco.length) await apriAnno(d.elenco[d.elenco.length - 1]);
    dopoNuoviDatiRef.current?.();
    salvaPresto();
  };

  const azzeraTutto = () => {
    azzerato.current = true;
    controllo.current?.abort();
    const z = nuovaAzienda("Azienda in analisi");
    setAziende([z]);
    attivaRef.current = z.id;
    setAttiva(z.id);
    setPrincipale(z.id);
    caricaInLavoro(z);
    setMsgZip(null);
    setErrore("");
    setDlInCorso(null);
    setCoda(null);
    setStato("pronto");
    setVista("carica");
    setZipRS(null);
    setAnalisiRS(null);
    setConcorrentiRS(null);
    rsAziendaRef.current = null;
    setRsAzienda(null);
    setRsFirmaPeer(null);
    qoeAziendaRef.current = z.id;
    setQoeAzienda(z.id);
    azzeraQoe(null);
    setDcfAziende([]);
    setCmp((c) => ({ versione: c.versione + 1, aziende: null, sessione: null, firma: null }));
    setDocsRS({ elenco: [], avvio: false });
    setVersioneRS((v) => v + 1);
    setMsgRS(null);
    setConfermaAzzera(false);
  };

  useEffect(() => {
    const f = () => aggiorna((n) => n + 1);
    monitor.ascoltatori.add(f);
    return () => monitor.ascoltatori.delete(f);
  }, []);

  /* Un documento cambiato: il suo esercizio va riclassificato di nuovo e
     Redditività rilegge i documenti dell'azienda. */
  const imposta = (k, f) => {
    const idA = k.split(".")[0];
    setAnni((as) => (as.some((a) => a.id === idA && a.docElaborati) ? as.map((a) => (a.id === idA ? { ...a, docElaborati: false } : a)) : as));
    { const z = aziendaById(attivaRef.current); if (z && !Array.isArray(z.docVisti)) aggiornaAzienda(attivaRef.current, { docVisti: [...vistiDi(attivaRef.current)] }); }
    setFile((s) => {
      const n = { ...s };
      if (f) n[k] = f; else delete n[k];
      return n;
    });
  };
  const rielabora = (id) => setAnni((as) => as.map((a) => (a.id === id ? { ...a, docElaborati: false } : a)));
  /* Esercizi riaperti da uno ZIP (con le riclassificazioni) a cui hai ricaricato
     i documenti: «Non rifare» li tiene come sono e usa i documenti solo per le
     analisi (integrazione documentale di Redditività, Quality of Earnings). */
  const daNonRifare = (a, f, r) => a.ripristinato && !a.docElaborati && !!r?.[a.anno] && !!f?.[`${a.id}.prospetti`];
  const nonRifare = (id) => setAnni((as) => as.map((a) => (a.id === id ? { ...a, docElaborati: true } : a)));
  const nonRifareTutti = () => {
    for (const z of aziendeRef.current) {
      if (z.id === attivaRef.current) setAnni((as) => as.map((a) => (daNonRifare(a, fileRef.current, risultatiRef.current) ? { ...a, docElaborati: true } : a)));
      else aggiornaAzienda(z.id, (x) => ({ anni: (x.anni || []).map((a) => (daNonRifare(a, x.file, x.risultati) ? { ...a, docElaborati: true } : a)) }));
    }
  };
  const cambiaAnno = (id, v) => setAnni((as) => as.map((a) => (a.id === id ? { ...a, anno: v.replace(/\D/g, "").slice(0, 4) } : a)));
  const aggiungiAnno = () => setAnni((as) => {
    const validi = as.map((a) => Number(a.anno)).filter((n) => n > 1900);
    return [...as, nuovoAnno(validi.length ? String(Math.max(...validi) + 1) : "")];
  });
  const togliAnno = (id) => {
    const a = anni.find((x) => x.id === id);
    if (a && risultatiRef.current[a.anno]) {
      const { [a.anno]: _, ...resto } = risultatiRef.current;
      setRisultati(resto);
      if (annoAttivoRef.current === a.anno) { annoAttivoRef.current = null; setAnnoAttivo(null); setAnnoProgrammi(""); setVersione((v) => v + 1); }
    }
    setAnni((as) => as.filter((x) => x.id !== id));
    setFile((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith(`${id}.`))));
  };

  /* Esercizi da elaborare: quelli con i prospetti caricati, in tutte le aziende.
     Gli esercizi riaperti da uno ZIP senza nuovi documenti restano come sono. */
  const vistaAzienda = (z) => (z.id === attiva ? { ...z, anni, file, risultati } : z);
  const totaleDaElaborare = aziende.reduce((n, z) => { const d = vistaAzienda(z); return n + d.anni.filter((a) => daRiclassificare(a, d.file, d.risultati)).length; }, 0);
  const aziendeDaElaborare = aziende.filter((z) => { const d = vistaAzienda(z); return d.anni.some((a) => daRiclassificare(a, d.file, d.risultati)); }).length;
  const sessioneConRisultati = aziende.some((z) => conRisultati(vistaAzienda(z).risultati));
  const totaleDaNonRifare = aziende.reduce((n, z) => { const d = vistaAzienda(z); return n + d.anni.filter((a) => daNonRifare(a, d.file, d.risultati)).length; }, 0);

  /* Controlli prima dell'avvio, per ogni azienda: anni scritti, non ripetuti, prospetti presenti. */
  const problemi = (() => {
    const out = [];
    const multi = aziende.length > 1;
    for (const z of aziende) {
      const d = vistaAzienda(z);
      const pre = multi ? `${z.nome}: ` : "";
      const visti = new Set();
      for (const a of d.anni) {
        if (!annoValido(a.anno)) { out.push(`${pre}scrivi l'anno di ogni esercizio (4 cifre).`); break; }
        if (visti.has(a.anno)) out.push(`${pre}l'esercizio ${a.anno} compare due volte.`);
        visti.add(a.anno);
        if (!d.file[`${a.id}.prospetti`] && !a.ripristinato) out.push(`${pre}mancano i prospetti contabili del ${a.anno}.`);
      }
    }
    if (!totaleDaElaborare && !sessioneConRisultati && !out.length) out.push("Carica i prospetti di almeno un esercizio da elaborare.");
    if (!chiaveOk) out.push("Inserisci la chiave API.");
    return out.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  })();
  const pronto = problemi.length === 0 && stato !== "in_corso" && stato !== "verifica" && !cambio && !cambioAz;

  const aggiornaPasso = (anno, step, campi) =>
    setAvanzamento((av) => av.map((r) => (r.anno !== anno ? r : { ...r, passi: r.passi.map((p) => (p.step === step ? { ...p, ...campi } : p)) })));
  const aggiornaAnno = (anno, campi) => setAvanzamento((av) => av.map((r) => (r.anno === anno ? { ...r, ...campi } : r)));
  const aggiornaUnita = (uid, campi) => setCoda((c) => (c ? { ...c, unita: c.unita.map((u) => (u.id === uid ? { ...u, ...campi } : u)) } : c));
  const setCorrente = (testo) => setCoda((c) => (c ? { ...c, corrente: testo } : c));

  /* ---------- Piano della coda (per fasi) ----------
     Fase 1: tutte le riclassificazioni, prima l'azienda in analisi e poi le
     altre nell'ordine delle schede, ogni azienda dal suo esercizio più vecchio.
     Fase 2: Redditività e solvibilità di ogni azienda, con tutte le altre come
     Peer Group e l'integrazione documentale sui suoi documenti. */
  const ordineAziende = () => [principaleRef.current, ...aziendeRef.current.map((z) => z.id).filter((id) => id !== principaleRef.current)];
  const pianifica = ({ aggiornamento = false } = {}) => {
    const unita = [];
    const conFase1 = new Set();
    for (const id of ordineAziende()) {
      const d = datiAzienda(id);
      const daFare = d.anni.filter((a) => daRiclassificare(a, d.file, d.risultati)).sort((a, b) => Number(a.anno) - Number(b.anno));
      for (const a of daFare) {
        const prec = d.anni.find((x) => Number(x.anno) === Number(a.anno) - 1 && d.file[`${x.id}.prospetti`]);
        let n = 0;
        for (const x of ["prospetti", "ni", "rg"]) { if (d.file[`${a.id}.${x}`]) n++; if (prec && d.file[`${prec.id}.${x}`]) n++; }
        unita.push({ id: `1:${id}:${a.anno}`, fase: 1, azienda: id, anno: a.anno, passi: n + 2, fatti: 0, stato: "attesa" });
      }
      if (daFare.length) conFase1.add(id);
    }
    for (const id of ordineAziende()) {
      const d = datiAzienda(id);
      if (!conFase1.has(id) && !conRisultati(d.risultati)) continue;
      /* Integrazione documentale dei soli documenti che Redditività non ha
         ancora letto: quelli di un esercizio nuovo, la relazione infrannuale
         di un nuovo TTM, o documenti ripristinati da uno ZIP e mai integrati. */
      const docs = documentiNuovi(id).length;
      unita.push({ id: `2:${id}`, fase: 2, azienda: id, passi: 1 + docs, fatti: 0, stato: "attesa", integrazione: docs > 0 });
    }
    /* Fase 3: Quality of Earnings di ogni azienda rielaborata (o che non ce l'ha ancora). */
    for (const id of ordineAziende()) {
      const d = datiAzienda(id);
      if (!conFase1.has(id) && (!conRisultati(d.risultati) || qoeLiveDi(id))) continue;
      unita.push({ id: `3:${id}`, fase: 3, azienda: id, passi: 1 + documentiUltimoAnno(id).length, fatti: 0, stato: "attesa" });
    }
    /* Fase 4: comparazione settoriale di tutte le aziende (servono almeno due). */
    const conDati = ordineAziende().filter((id) => conFase1.has(id) || conRisultati(datiAzienda(id).risultati));
    /* La comparazione non entra più nella coda: la avvii tu dalla sua scheda,
       dopo aver corretto i dati e calcolato WACC e DCF. */
    void conDati;
    /* «Riaggiorna tutto» (nuovo trimestrale, semestrale o annuale): anche il
       DCF di ogni azienda che ne ha uno (dati nuovi, le tue assunzioni di
       prima) e, con almeno due aziende, la comparazione. */
    if (aggiornamento) {
      for (const id of ordineAziende()) {
        if (!conFase1.has(id) && !conRisultati(datiAzienda(id).risultati)) continue;
        const conDcf = !!aziendaById(id)?.dcf || !!document.querySelector(`iframe[data-dcf-azienda="${CSS.escape(String(id))}"]`);
        if (conDcf) unita.push({ id: `5:${id}`, fase: 5, azienda: id, passi: 1, fatti: 0, stato: "attesa" });
      }
      if (conDati.length >= 2) unita.push({ id: "6", fase: 6, azienda: principaleRef.current, passi: 1, fatti: 0, stato: "attesa" });
    }
    /* Restano i risultati degli esercizi che non vengono rielaborati. */
    for (const id of conFase1) {
      const anniRi = unita.filter((u) => u.fase === 1 && u.azienda === id).map((u) => u.anno);
      const d = datiAzienda(id);
      const tenuti = Object.fromEntries(Object.entries(d.risultati).filter(([an]) => !anniRi.includes(an) && d.anni.some((a) => a.anno === an)));
      const av = (d.avanzamento || []).filter((r) => !anniRi.includes(r.anno));
      if (id === attivaRef.current) { setRisultati(tenuti); setAvanzamento(av); }
      else aggiornaAzienda(id, { risultati: tenuti, avanzamento: av });
    }
    return { unita, corrente: "", creata: new Date().toISOString() };
  };

  /* Fase 1 · un esercizio di un'azienda: lo stesso flusso di sempre. */
  const eseguiAnno = async (u, segnale) => {
    await attivaAzienda(u.azienda, { apri: false, rs: false });
    const nome = aziendaById(u.azienda)?.nome || "";
    const d = datiAzienda(u.azienda);
    const a = d.anni.find((x) => x.anno === u.anno);
    if (!a || !d.file[`${a.id}.prospetti`]) { aggiornaUnita(u.id, { stato: "errore", fatti: u.passi, nota: "prospetti non più presenti" }); return; }
    const anno = u.anno;
    const prec = d.anni.find((x) => Number(x.anno) === Number(anno) - 1 && d.file[`${x.id}.prospetti`]);
    const docs = {};
    for (const x of ["prospetti", "ni", "rg"]) {
      if (d.file[`${a.id}.${x}`]) docs[`T.${x}`] = d.file[`${a.id}.${x}`];
      if (prec && d.file[`${prec.id}.${x}`]) docs[`T1.${x}`] = d.file[`${prec.id}.${x}`];
    }
    aggiornaUnita(u.id, { stato: "in_corso", fatti: 0, nota: "" });
    setAvanzamento((av) => [...av.filter((r) => r.anno !== anno), {
      anno, stato: "in_corso", nota: `T-1: ${prec ? `documenti ${prec.anno}` : "colonna comparativa"}`,
      passi: [...ORDINE.filter((k) => docs[k]), "ponte", "esporta"].map((step) => ({ step, stato: "attesa" })),
    }].sort((x, y) => Number(x.anno) - Number(y.anno)));
    // Programmi puliti per il nuovo esercizio, con il suo anno.
    annoAttivoRef.current = null;
    setAnnoAttivo(null);
    setAnnoProgrammi(anno);
    setVersione((v) => v + 1);
    await pausa(2000);
    if (segnale.aborted) throw new Error("interrotto");
    let fatti = 0;
    for (const k of ORDINE.filter((x) => docs[x])) {
      setCorrente(`Fase 1 · ${nome} · esercizio ${anno} · ${STEP_ETICHETTA[k]}`);
      aggiornaPasso(anno, k, { stato: "in_corso" });
      const prima = monitor.totali;
      const daEsito = monitor.esiti.length;
      for (const s of Object.keys(PROGRAMMI)) consegnaFile(inputDelProgramma(contenitori[s].current, s, k), docs[k]);
      const partito = await attendiFinePasso(prima, segnale);
      const r = riassumiPasso(daEsito, partito);
      aggiornaPasso(anno, k, { stato: r.stato, nota: r.nota });
      // Claude non disponibile, non autorizzato o al limite di utilizzo: ci si ferma.
      if (r.bloccante) {
        aggiornaAnno(anno, { stato: "errore", nota: "fermato: riprende da qui con «Riprendi»" });
        throw bloccato(r.bloccante.messaggio);
      }
      aggiornaUnita(u.id, { fatti: ++fatti });
    }

    // Tab 4 del Rendiconto: JSON di SP e CE.
    setCorrente(`Fase 1 · ${nome} · esercizio ${anno} · ${STEP_ETICHETTA.ponte}`);
    aggiornaPasso(anno, "ponte", { stato: "in_corso" });
    const esitiPonte = [];
    for (const s of ["SP", "CE"]) {
      if (segnale.aborted) throw new Error("interrotto");
      try {
        const { nome: n, blob } = await esportaJson(s, contenitori[s].current);
        consegnaFile(inputDelProgramma(contenitori.RF.current, "RF", `ponte.${s}`), new File([blob], n, { type: "application/json" }));
        esitiPonte.push(`${s} ✓`);
        await pausa(1500);
      } catch (e) {
        esitiPonte.push(`${s}: non passato (${e.message})`);
      }
    }
    const ponteOk = esitiPonte.every((t) => t.endsWith("✓"));
    aggiornaPasso(anno, "ponte", { stato: ponteOk ? "fatto" : "avviso", nota: ponteOk ? "" : esitiPonte.join(" · ") });
    aggiornaUnita(u.id, { fatti: ++fatti });

    // I tre JSON dell'esercizio, gli stessi di «Salva dati», con il controllo
    // di cosa contengono davvero.
    setCorrente(`Fase 1 · ${nome} · esercizio ${anno} · ${STEP_ETICHETTA.esporta}`);
    aggiornaPasso(anno, "esporta", { stato: "in_corso" });
    const r = { avvisi: [] };
    for (const s of ["SP", "CE", "RF"]) {
      if (segnale.aborted) throw new Error("interrotto");
      try {
        r[s] = await esportaJson(s, contenitori[s].current);
      } catch (e) {
        r[s] = { errore: e.message === "nessun dato da salvare" ? "non riclassificato: nessuna voce estratta" : e.message };
        continue;
      }
      await completaRisultato(r, s, anno);
    }
    setRisultati({ ...risultatiRef.current, [anno]: r });
    const esito = esitoAnno(r);
    const nota = ["SP", "CE", "RF"].map((s) => `${s}: ${r[s]?.blob ? `${r[s].voci.t} voci T, ${r[s].voci.t1} voci T-1` : r[s]?.errore}`).join(" · ");
    aggiornaPasso(anno, "esporta", { stato: esito.stato, nota });
    const statoAnno = esito.stato === "fatto" && (r.avvisi.length || !ponteOk) ? "avviso" : esito.stato;
    aggiornaAnno(anno, { stato: statoAnno });
    aggiornaUnita(u.id, { stato: statoAnno, fatti: u.passi, nota: esito.stato === "fatto" ? "" : nota });
    /* Documenti riclassificati: un nuovo «Avvia» non li rifà (salvo «Rielabora»). */
    if (esito.stato !== "errore") setAnni((as) => as.map((x) => (x.id === a.id ? { ...x, docElaborati: true } : x)));
    fotografaAttiva();
  };

  const attendi = async (cond, ms, segnale) => {
    const fine = Date.now() + ms;
    for (;;) {
      if (segnale.aborted) throw new Error("interrotto");
      try { if (cond()) return true; } catch { /* non ancora pronto */ }
      if (Date.now() > fine) return false;
      await pausa(400);
    }
  };

  /* Fase 2 · Redditività e solvibilità di un'azienda. */
  const eseguiRS = async (u, segnale) => {
    await attivaAzienda(u.azienda, { apri: false, rs: false });
    const nome = aziendaById(u.azienda)?.nome || "";
    aggiornaUnita(u.id, { stato: "in_corso", fatti: 0, nota: "" });
    setCorrente(`Fase 2 · ${nome} · Redditività e solvibilità · riclassificazioni e Peer Group`);
    const prima = rsApi.current?.istanza;
    const info = await passaARSAzienda(u.azienda, { avvio: !!u.integrazione });
    if (!info.zip) { aggiornaUnita(u.id, { stato: "avviso", fatti: u.passi, nota: "nessuna riclassificazione da analizzare" }); return; }
    const caricata = await attendi(() => rsApi.current?.istanza !== prima && rsApi.current.pronta() && rsApi.current.peerSuite() >= info.concorrenti, 90_000, segnale);
    aggiornaUnita(u.id, { fatti: 1 });
    let stato = caricata ? "fatto" : "avviso";
    let nota = info.concorrenti ? `Peer Group: ${info.nomi.join(", ")}` : "nessun concorrente nel Peer Group";
    if (!caricata) nota += " · caricamento incompleto: controlla la scheda Redditività";
    if (u.integrazione && info.documenti) {
      const partita = await attendi(() => rsApi.current?.istanza !== prima && rsApi.current.statoIntegrazione().avviato, 90_000, segnale);
      if (!partita) { stato = "avviso"; nota += " · integrazione documentale non partita"; }
      else {
        let st = rsApi.current.statoIntegrazione();
        for (;;) {
          st = rsApi.current.statoIntegrazione();
          setCorrente(`Fase 2 · ${nome} · integrazione documentale · documento ${Math.min(st.fatti + 1, st.totale)} di ${st.totale}`);
          aggiornaUnita(u.id, { fatti: 1 + st.fatti });
          if (st.bloccante) throw bloccato(st.bloccante);
          if (!st.inCorso) break;
          if (segnale.aborted) throw new Error("interrotto");
          await pausa(1000);
        }
        nota += ` · integrazione documentale: ${st.fatti} di ${st.totale} documenti`;
        if (st.totale && st.fatti >= st.totale) {
          const visti = [...new Set([...vistiDi(u.azienda), ...(info.chiavi || [])])];
          aggiornaAzienda(u.azienda, { docIntegrati: true, docVisti: visti });
        }
      }
    }
    await pausa(800);
    aggiornaAzienda(u.azienda, (z) => ({ analisi: analisiCorrenteRS() || z.analisi }));
    aggiornaUnita(u.id, { stato, fatti: u.passi, nota });
  };

  /* Fase 5 · Pro-forma e DCF di un'azienda con i dati aggiornati: la pagina
     riceve lo ZIP dell'azienda (riclassificazioni, Redditività con il TTM,
     Quality of Earnings) e riapplica le assunzioni che c'erano (crescite,
     margini, azioni, cambio, spread scritto a mano). */
  const eseguiDcf = async (u, segnale) => {
    const id = u.azienda;
    const nome = aziendaById(id)?.nome || "";
    aggiornaUnita(u.id, { stato: "in_corso", fatti: 0, nota: "" });
    setCorrente(`Fase 5 · ${nome} · Pro-forma e DCF · dati aggiornati, assunzioni di prima`);
    setDcfAziende((l) => (l.includes(id) ? l : [...l, id]));
    const finestra = () => document.querySelector(`iframe[data-dcf-azienda="${CSS.escape(String(id))}"]`)?.contentWindow;
    const pronta = await attendi(() => { const w = finestra(); return w && typeof w.__dcfAggiornaDaZip === "function" && w.__dcfRipresaFatta?.(); }, 60_000, segnale);
    if (!pronta) { aggiornaUnita(u.id, { stato: "avviso", fatti: 1, nota: "pagina DCF non pronta: aprila e premi «↻ Aggiorna il DCF»" }); return; }
    await pausa(1500); // la ripresa del DCF salvato si completa
    const zip = await zipComeFile(id, { conAnalisi: true, conQoe: true, conDcf: false });
    let esito;
    try { esito = await finestra().__dcfAggiornaDaZip(zip); }
    catch (e) { esito = { ok: false, messaggio: e?.message || String(e) }; }
    await pausa(1200);
    dcfLiveDi(id);
    aggiornaUnita(u.id, { stato: esito?.ok ? "fatto" : "avviso", fatti: 1, nota: esito?.messaggio || "" });
  };

  /* «↻ Aggiorna il DCF» nella scheda Pro-forma e DCF: come la Fase 5 della
     coda, ma per l'azienda in vista e su richiesta. */
  const [dcfAgg, setDcfAgg] = useState({ inCorso: null, msg: null });
  const aggiornaDcf = async (id) => {
    setDcfAgg({ inCorso: id, msg: null });
    const ctrl = new AbortController();
    try {
      if (id === attivaRef.current && annoAttivoRef.current) { try { await riprendiModifiche(); } catch { /* restano gli ultimi JSON */ } }
      catturaQoe();
      if (rsAziendaRef.current === id) { const a = analisiCorrenteRS(); if (a) aggiornaAzienda(id, { analisi: a }); }
      setDcfAziende((l) => (l.includes(id) ? l : [...l, id]));
      const finestra = () => document.querySelector(`iframe[data-dcf-azienda="${CSS.escape(String(id))}"]`)?.contentWindow;
      const pronta = await attendi(() => { const w = finestra(); return w && typeof w.__dcfAggiornaDaZip === "function" && w.__dcfRipresaFatta?.(); }, 60_000, ctrl.signal);
      if (!pronta) throw new Error("la pagina del DCF non è pronta: riprova tra qualche secondo");
      await pausa(800);
      const zip = await zipComeFile(id, { conAnalisi: true, conQoe: true, conDcf: false });
      const esito = await finestra().__dcfAggiornaDaZip(zip);
      await pausa(1000);
      dcfLiveDi(id);
      setDcfAgg({ inCorso: null, msg: { id, tipo: esito?.ok ? "ok" : "errore",
        testo: esito?.ok ? `✓ DCF di ${aziendaById(id)?.nome || ""} aggiornato: ${esito.messaggio}.` : `DCF non aggiornato: ${esito?.messaggio || "errore"}.` } });
    } catch (e) {
      setDcfAgg({ inCorso: null, msg: { id, tipo: "errore", testo: `DCF non aggiornato: ${e?.message || e}.` } });
    }
  };

  /* Fase 3 · Quality of Earnings di un'azienda: ZIP (riclassificazioni +
     Redditività con i comparables), documenti dell'ultimo esercizio, consegna
     alla Fase 1 e diagnosi forense, tutto come farebbe la scheda da sola. Se
     l'azienda aveva già un lavoro QoE, prima lo si ripristina e poi lo si
     aggiorna con i dati nuovi (rettifiche e note restano). */
  const eseguiQoE = async (u, segnale) => {
    await attivaAzienda(u.azienda, { apri: false, rs: false, qoe: false });
    const nome = aziendaById(u.azienda)?.nome || "";
    aggiornaUnita(u.id, { stato: "in_corso", fatti: 0, nota: "" });
    setCorrente(`Fase 3 · ${nome} · Quality of Earnings · apertura delle riclassificazioni`);
    if (!conRisultati(datiAzienda(u.azienda)?.risultati)) { aggiornaUnita(u.id, { stato: "avviso", fatti: u.passi, nota: "nessuna riclassificazione da analizzare" }); return; }
    catturaQoe();
    const precedente = aziendaById(u.azienda)?.qoe?.testo || null;
    const zip = await zipComeFile(u.azienda, { conAnalisi: true, conQoe: false });
    const prima = qoeApi.current?.istanza;
    const daEsito = monitor.esiti.length;
    qoeAziendaRef.current = u.azienda;
    setQoeAzienda(u.azienda);
    setQoeSuperato(false);
    if (precedente) {
      setQoe((q) => ({ versione: q.versione + 1, zip: null, salvataggio: precedente, aperto: true, aggiornamento: false, firma: null }));
      await attendi(() => qoeApi.current?.istanza !== prima && qoeApi.current.stato().ripristinato, 60_000, segnale);
      await pausa(1500);
      setQoe((q) => ({ ...q, zip, aggiornamento: true, firma: firmaPerQoe(u.azienda) }));
    } else {
      setQoe((q) => ({ versione: q.versione + 1, zip, salvataggio: null, aperto: true, aggiornamento: false, firma: firmaPerQoe(u.azienda) }));
    }
    await attendi(() => qoeApi.current?.istanza !== prima && qoeApi.current.stato().zipImportati > 0, 90_000, segnale);
    aggiornaUnita(u.id, { fatti: 1 });
    /* Lavoro finito = 10 secondi senza documenti, consegne, diagnosi né chiamate a Claude. */
    const quiete = async (etichetta) => {
      let calmoDa = null;
      const fine = Date.now() + 40 * 60_000;
      for (;;) {
        if (segnale.aborted) throw new Error("interrotto");
        const blocco = monitor.esiti.slice(daEsito).find((e) => CODICI_BLOCCANTI.includes(e.codice));
        if (blocco) throw bloccato(blocco.messaggio);
        const st = qoeApi.current?.stato?.() || {};
        aggiornaUnita(u.id, { fatti: Math.min(u.passi - 1, 1 + (st.documentiFiniti || 0)) });
        setCorrente(`Fase 3 · ${nome} · Quality of Earnings · ${st.documentiAvviati > st.documentiFiniti ? `documento ${st.documentiFiniti + 1} di ${st.documentiAvviati}` : etichetta}`);
        if (st.occupato || monitor.inCorso > 0) calmoDa = null;
        else if (!calmoDa) calmoDa = Date.now();
        else if (Date.now() - calmoDa > 10_000) return true;
        if (Date.now() > fine) return false;
        await pausa(1000);
      }
    };
    let completa = await quiete("documenti e diagnosi forense");
    let st = qoeApi.current?.stato?.() || {};
    if (completa && st.daConsegnare && !st.bloccatoGatekeeper) {
      qoeApi.current.consegna();
      await pausa(1500);
      completa = await quiete("consegna alla Fase 1 e diagnosi forense");
      st = qoeApi.current?.stato?.() || {};
    }
    const sq = qoeLiveDi(u.azienda);
    aggiornaAzienda(u.azienda, { qoe: sq, qoeFirma: qoeRef.current.firma ?? null });
    const parti = [];
    if (st.documentiAvviati) parti.push(`${st.documentiFiniti} di ${st.documentiAvviati} documenti analizzati`);
    if (st.punteggio !== null && st.punteggio !== undefined) parti.push(`punteggio di qualità ${st.punteggio}/100`);
    else parti.push("diagnosi non eseguita: apri la scheda Quality of Earnings");
    if (st.bloccatoGatekeeper) parti.push("il Gatekeeper segnala dati non quadrati: controlla la Fase 0");
    if (!completa) parti.push("tempo massimo superato");
    aggiornaUnita(u.id, { stato: completa && !st.bloccatoGatekeeper && st.punteggio != null ? "fatto" : "avviso", fatti: u.passi, nota: parti.join(" · ") });
  };

  /* Fase 4 · comparazione settoriale con i dati appena prodotti. */
  const eseguiComparazione = async (u, segnale) => {
    aggiornaUnita(u.id, { stato: "in_corso", fatti: 0, nota: "" });
    setCorrente("Fase 4 · Comparazione settoriale di tutte le aziende");
    const n = aggiornaComparazione();
    await pausa(1000);
    const ok = await attendi(() => cmpApi.current && !cmpApi.current.inCaricamento() && cmpApi.current.aziende() > 0, 60_000, segnale);
    const caricate = cmpApi.current?.aziende?.() || 0;
    aggiornaUnita(u.id, { stato: ok && caricate >= 2 ? "fatto" : "avviso", fatti: 1, nota: `${caricate} di ${n} aziende nella comparazione` });
  };

  /* Un nuovo bilancio annuale rende superato il TTM costruito sull'esercizio
     precedente: TTM e relazione infrannuale si tolgono prima di riaggiornare. */
  const togliTtmSuperati = () => {
    const tolti = [];
    for (const z of aziendeRef.current) {
      const d = datiAzienda(z.id);
      const base = annoDi(d?.ttm?.info?.base);
      if (!d?.ttm || !base) continue;
      const ultimo = Math.max(0, ...d.anni.filter((a) => d.file[`${a.id}.prospetti`] || d.risultati[a.anno]).map((a) => Number(a.anno) || 0));
      if (ultimo <= base) continue;
      tolti.push(z.nome);
      if (z.id === attivaRef.current) {
        setTtm(null);
        setFile((f) => { const n = { ...f }; delete n[CHIAVE_DOC_TTM]; return n; });
      } else {
        const f = { ...(z.file || {}) };
        delete f[CHIAVE_DOC_TTM];
        aggiornaAzienda(z.id, { ttm: null, file: f });
      }
    }
    return tolti;
  };

  const avvia = async (riprendi = false, { aggiornamento = false } = {}) => {
    setErrore("");
    try {
      for (const k of ORDINE) for (const s of Object.keys(PROGRAMMI)) inputDelProgramma(contenitori[s].current, s, k);
      for (const k of ["ponte.SP", "ponte.CE"]) inputDelProgramma(contenitori.RF.current, "RF", k);
    } catch (e) {
      setErrore(e.message);
      setStato("errore");
      return;
    }

    /* Prima di tutto: Claude risponde? (nell'artifact chiede qui il permesso) */
    setStato("verifica");
    const v = await verificaClaude();
    if (!v.ok) {
      setErrore(v.messaggio);
      setStato(riprendi ? "interrotto" : "errore");
      return;
    }

    /* Le modifiche fatte nelle schede all'esercizio in vista vengono salvate
       prima di ripulire i programmi. */
    if (annoAttivoRef.current) await riprendiModifiche();
    fotografaAttiva();

    if (aggiornamento) {
      const tolti = togliTtmSuperati();
      if (tolti.length) { await pausa(300); setMsgTtm({ tipo: "ok", testo: `Nuovo bilancio annuale: TTM superato tolto (${tolti.join(", ")}).` }); }
    }
    let c = codaRef.current;
    if (!riprendi || !c) c = pianifica({ aggiornamento });
    else c = { ...c, corrente: "", unita: c.unita.filter((u) => u.fase !== 4).map((u) => (u.stato === "in_corso" ? { ...u, stato: "attesa", fatti: 0 } : u)) };
    setCoda(c);
    azzerato.current = false;
    controllo.current = new AbortController();
    const segnale = controllo.current.signal;
    setEsitoDl(null);
    setStato("in_corso");
    salvaPresto();

    try {
      for (const { id } of c.unita) {
        const u = codaRef.current?.unita.find((x) => x.id === id);
        if (!u || completata(u)) continue;
        if (segnale.aborted) throw new Error("interrotto");
        if (!aziendaById(u.azienda)) { aggiornaUnita(u.id, { stato: "errore", fatti: u.passi, nota: "azienda rimossa" }); continue; }
        if (u.fase === 1) await eseguiAnno(u, segnale);
        else if (u.fase === 2) await eseguiRS(u, segnale);
        else if (u.fase === 3) await eseguiQoE(u, segnale);
        else if (u.fase === 5) await eseguiDcf(u, segnale);
        else if (u.fase === 6) {
          for (const z of aziendeRef.current) dcfLiveDi(z.id);
          await eseguiComparazione(u, segnale);
          setCmpCambiata(false);
        }
        else await eseguiComparazione(u, segnale);
        salvaPresto();
      }
      setCorrente("");
      // Alla fine resta aperta l'azienda in analisi, con il suo ultimo esercizio.
      await attivaAzienda(principaleRef.current, { apri: true, rs: true, qoe: true });
      setStato("finito");
      const n = aziendeRef.current.length;
      setMsgRS({ tipo: "ok", testo: `Riclassificazioni passate a «Redditività e solvibilità»${n > 1 ? ` per ${n} aziende, ognuna con le altre nel Peer Group` : ""}.` });
      salvaPresto();
    } catch (e) {
      if (azzerato.current) return; // l'azzeramento ha già ripulito tutto
      setCoda((cc) => (cc ? { ...cc, corrente: "", unita: cc.unita.map((u) => (u.stato === "in_corso" ? { ...u, stato: "attesa", fatti: 0 } : u)) } : cc));
      if (e.bloccato) {
        setErrore(`${e.message} — Elaborazione sospesa: premi «Riprendi» quando Claude è di nuovo disponibile; si riparte dal primo passo non completato.`);
        setStato("interrotto");
      } else if (segnale.aborted) setStato("interrotto");
      else { setErrore(e.message); setStato("errore"); }
      fotografaAttiva();
      salvaPresto();
    }
  };

  const ferma = () => controllo.current?.abort();

  /* Caricamento del bilancio TTM: se le riclassificazioni ci sono già, passa
     subito a Redditività e solvibilità (che conserva la propria analisi). */
  const caricaTtm = async (f) => {
    if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); }
    catch { setMsgTtm({ tipo: "warn", testo: `${f.name} non è un JSON valido.` }); return; }
    if (!eBilancioTtm(j)) {
      setMsgTtm({ tipo: "warn", testo: `${f.name} non è un bilancio TTM: serve il file «bilancio-ttm» esportato dal Generatore Bilancio TTM.` });
      return;
    }
    const nuovo = { nome: f.name, testo: JSON.stringify(j, null, 2), info: infoTtm(j) };
    const vecchio = ttmRef.current;
    const cambiaData = vecchio && vecchio.info?.data !== nuovo.info.data;
    setTtm(nuovo);
    // La relazione infrannuale del TTM precedente non vale per il nuovo periodo.
    if (cambiaData && fileRef.current[CHIAVE_DOC_TTM]) setFile((x) => { const n = { ...x }; delete n[CHIAVE_DOC_TTM]; return n; });
    const az = sessione?.azienda || nomeDaRisultati(risultatiRef.current) || "";
    const diversa = az && nuovo.info.azienda && pulisciNome(az).toLowerCase() !== pulisciNome(nuovo.info.azienda).toLowerCase();
    setMsgTtm({ tipo: diversa ? "warn" : "ok", testo: `${nuovo.info.etichetta} caricato.` + (diversa ? ` ⚠ Il TTM è di «${nuovo.info.azienda}», le riclassificazioni di «${az}».` : "") +
      (vecchio ? ` Sostituisce ${vecchio.info?.etichetta || "il TTM precedente"}${cambiaData ? ": carica qui sotto la relazione trimestrale o semestrale del nuovo periodo" : ""}, poi premi «🔄 Riaggiorna tutto».` : "") });
    if (Object.keys(risultatiRef.current).length) await aggiornaRS(false);
  };
  const togliTtm = async () => {
    setTtm(null);
    if (fileRef.current[CHIAVE_DOC_TTM]) setFile((x) => { const n = { ...x }; delete n[CHIAVE_DOC_TTM]; return n; });
    setMsgTtm({ tipo: "ok", testo: "Bilancio TTM tolto dalla sessione." });
    if (Object.keys(risultatiRef.current).length) await aggiornaRS(false);
  };

  const qoeRef = useRef(qoe);
  qoeRef.current = qoe;
  /* Prima apertura della scheda QoE: riceve lo ZIP dell'azienda in analisi. */
  useEffect(() => {
    if (vista === "DCF") setDcfAziende((l) => (l.includes(attivaRef.current) ? l : [...l, attivaRef.current]));
    if (vista !== "QOE" || qoe.aperto) return;
    if (!qoeAziendaRef.current) { qoeAziendaRef.current = attivaRef.current; setQoeAzienda(attivaRef.current); }
    if (qoe.salvataggio || !conRisultati(datiAzienda(qoeAziendaRef.current)?.risultati)) { setQoe((q) => ({ ...q, aperto: true, firma: q.firma ?? firmaPerQoe() })); return; }
    let annullato = false;
    (async () => {
      try {
        const f = await zipComeFile(qoeAziendaRef.current, { conAnalisi: true, conQoe: false });
        if (!annullato) setQoe((q) => ({ ...q, aperto: true, aggiornamento: false, firma: firmaPerQoe(), zip: f }));
      } catch { /* resta da caricare a mano dalla Fase 0 */ }
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, qoe.aperto, qoe.salvataggio, attiva]);
  /* Fotografia dei dati passati a Quality of Earnings: analisi di Redditività
     (senza l'ora di generazione) ed elenco delle riclassificazioni dell'azienda
     in analisi. Se cambia, la scheda QoE mostra l'avviso con «Aggiorna». */
  const firmaPerQoe = (pid = qoeAziendaRef.current) => {
    let rs = "";
    try {
      const a = analisiDi(pid);
      if (a?.testo) { const j = JSON.parse(a.testo); delete j.generatoIl; delete j.coppie; rs = JSON.stringify(j); }
    } catch { rs = ""; }
    const d = datiAzienda(pid) || { risultati: {} };
    const ric = Object.entries(d.risultati).sort().map(([anno, r]) =>
      [anno, ...["SP", "CE", "RF"].map((x) => (r[x]?.blob ? `${r[x].nome}:${r[x].blob.size}` : "-"))].join("|")).join(";");
    return `${pid}#${ric}#${d.ttm?.nome || ""}#${rs}`;
  };
  useEffect(() => {
    if (vista !== "QOE" || !qoe.aperto || qoe.firma === null) return;
    const controlla = () => setQoeSuperato(firmaPerQoe() !== qoe.firma);
    controlla();
    const t = setInterval(controlla, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, qoe.aperto, qoe.firma]);
  const [qoeInAggiornamento, setQoeInAggiornamento] = useState(false);
  const aggiornaQoe = async () => {
    setQoeInAggiornamento(true);
    try {
      if (attivaRef.current === qoeAziendaRef.current) await riprendiModifiche();
      const f = await zipComeFile(qoeAziendaRef.current, { conAnalisi: true, conQoe: false });
      setQoe((q) => ({ ...q, aggiornamento: true, firma: firmaPerQoe(), zip: f }));
      setQoeSuperato(false);
    } finally { setQoeInAggiornamento(false); }
  };
  /* Documenti iniziali per QoE (azienda in analisi): solo dopo l'apertura della
     scheda, così la sua analisi non parte mentre girano SP, CE e RF. */
  const documentiPerQoe = useMemo(
    () => (qoe.aperto && qoeAziendaRef.current ? documentiDi(qoeAziendaRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qoe.aperto, file, anni, aziende, qoeAzienda, qoe.versione]
  );

  /* Quality of Earnings più recente di un'azienda, per la pagina DCF: se il
     salvataggio nello ZIP non ha lo spread (versione precedente), il DCF chiede
     qui quello attuale. L'azienda si cerca per nome, poi per riquadro. */
  const qoeLiveDiRef = useRef(null);
  qoeLiveDiRef.current = qoeLiveDi;
  useEffect(() => {
    const semplice = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9à-ü]+/g, "");
    window.__suiteQoeAttuale = (finestra, nome) => {
      const lista = aziendeRef.current || [];
      let z = nome ? lista.find((a) => semplice(a.nome) === semplice(nome) || semplice(pulisciNome(a.nome)) === semplice(nome)) : null;
      if (!z && finestra) {
        const fr = [...document.querySelectorAll("iframe[data-dcf-azienda]")].find((f) => f.contentWindow === finestra);
        const id = fr?.getAttribute("data-dcf-azienda");
        z = lista.find((a) => a.id === id) || null;
      }
      if (!z) return null;
      const q = qoeLiveDiRef.current?.(z.id);
      return q ? { nome: q.nome, testo: q.testo, azienda: z.nome } : null;
    };
    /* Spread da rischio informativo per il DCF di un'azienda, letto a ogni
       controllo della pagina DCF: dal Quality of Earnings aperto su di essa,
       altrimenti dall'ultimo salvataggio QoE della sua scheda. */
    const cacheSpread = new Map();
    const numero = (testo, campo) => {
      const m = new RegExp('"' + campo + '"\\s*:\\s*(-?[0-9.eE+-]+)').exec(testo || "");
      return m ? Number(m[1]) : null;
    };
    window.__suiteSpreadDi = (finestra) => {
      const fr = [...document.querySelectorAll("iframe[data-dcf-azienda]")].find((f) => f.contentWindow === finestra);
      const id = fr?.getAttribute("data-dcf-azienda");
      const z = (aziendeRef.current || []).find((a) => a.id === id);
      if (!z) return null;
      if (qoeAziendaRef.current === id) {
        try {
          if (qoeApi.current?.stato?.().ripristinato !== false) {
            const p = qoeApi.current?.fase5?.();
            if (p && p.information_risk_premium_pct != null) {
              return { pct: Number(p.information_risk_premium_pct), trust: p.accounting_trust_score ?? null, investibile: p.investable_flag ?? null, azienda: z.nome, fonte: "Quality of Earnings aperto" };
            }
          }
        } catch { /* si passa al salvataggio */ }
      }
      const testo = z.qoe?.testo;
      if (!testo) return null;
      let v = cacheSpread.get(id);
      if (!v || v.testo !== testo) {
        v = { testo, pct: numero(testo, "information_risk_premium_pct"), trust: numero(testo, "accounting_trust_score"), investibile: null, ricalcolato: false };
        if (v.pct == null) {
          /* Salvataggio di una versione precedente, senza la Fase 5: la si
             ricalcola dai dati salvati con la stessa catena di Quality of Earnings. */
          try {
            const p5 = esitoFase5DaSalvataggio(JSON.parse(testo));
            if (p5 && p5.information_risk_premium_pct != null) {
              v.pct = Number(p5.information_risk_premium_pct);
              v.trust = p5.accounting_trust_score ?? null;
              v.investibile = p5.investable_flag ?? null;
              v.ricalcolato = true;
            }
          } catch { /* resta senza spread */ }
        }
        cacheSpread.set(id, v);
      }
      return v.pct == null ? null : { pct: v.pct, trust: v.trust, investibile: v.investibile, azienda: z.nome, fonte: v.ricalcolato ? "ricalcolato dal salvataggio di Quality of Earnings" : "ultimo salvataggio di Quality of Earnings" };
    };
    /* DCF salvato dell'azienda di una pagina DCF: la pagina lo riapre da sola. */
    window.__suiteDcfSalvato = (finestra) => {
      const fr = [...document.querySelectorAll("iframe[data-dcf-azienda]")].find((f) => f.contentWindow === finestra);
      const id = fr?.getAttribute("data-dcf-azienda");
      const z = (aziendeRef.current || []).find((a) => a.id === id);
      return z?.dcf?.testo ? { nome: z.dcf.nome, testo: z.dcf.testo } : null;
    };
    return () => { delete window.__suiteQoeAttuale; delete window.__suiteSpreadDi; delete window.__suiteDcfSalvato; };
  }, []);

  /* Cambi BCE del giorno per il DCF (valore per azione in euro). Nella pagina
     pubblicata le richieste a siti esterni sono bloccate: il cambio lo cerca
     ogni giorno un'attività pianificata di Claude (ricerca sul sito della BCE)
     e lo scrive nel database dell'artifact, documento «cambi/bce»
     { data, fonte, rates: { USD: 1.12, ... }, aggiornato }. La suite lo legge
     all'apertura e ogni 30 minuti; le pagine DCF lo trovano in window.__suiteCambi. */
  useEffect(() => {
    let fermo = false;
    let timer = null;
    const leggi = async () => {
      try {
        const db = await window.claude?.use?.("db");
        if (!db || fermo) return;
        const snap = await db.doc("cambi/bce").get();
        const d = snap?.exists ? snap.data() : null;
        if (d && d.rates && typeof d.rates === "object") window.__suiteCambi = d;
      } catch { /* senza database: resta il cambio scritto a mano */ }
    };
    leggi();
    timer = setInterval(leggi, 30 * 60 * 1000);
    return () => { fermo = true; clearInterval(timer); };
  }, []);

  /* I download della pagina DCF passano da qui (nell'artifact: capability «downloads»). */
  useEffect(() => {
    window.__suiteConsegnaFile = (nome, blob, finestra) => {
      /* Un'esportazione JSON del Pro-forma e DCF resta anche nella scheda
         dell'azienda di quella pagina: entra nello ZIP e nella comparazione. */
      if (finestra && blob && /\.json$/i.test(String(nome))) {
        const fr = [...document.querySelectorAll("iframe[data-dcf-azienda]")].find((f) => f.contentWindow === finestra);
        const id = fr?.getAttribute("data-dcf-azienda");
        if (id) {
          blob.text().then((testo) => {
            try {
              if (!String(JSON.parse(testo)?.formato || "").startsWith("proforma-dcf")) return;
              aggiornaAziendaRef.current?.(id, { dcf: { nome: String(nome).split("/").pop(), testo } });
              setTimeout(() => dopoNuoviDatiRef.current?.("dcf"), 300);
            } catch { /* non è un JSON del DCF */ }
          });
        }
      }
      return consegnaAllUtente(nome, blob);
    };
  }, []);

  /* «Aggiorna con le modifiche» e «Peer Group cambiato · Aggiorna»: ZIP con le
     ultime modifiche fatte nelle schede SP, CE e RF e Peer Group attuale.
     Parametri inseriti a mano, CAPM e integrazione documentale restano. */
  const aggiornaRS = async (apri = true) => {
    setDlInCorso("rs");
    try {
      const tutti = await riprendiModifiche();
      if (!Object.keys(tutti).length) return;
      const info = await passaARSAzienda(attivaRef.current);
      const n = Object.keys(tutti).length;
      setMsgRS({ tipo: "ok", testo: `Riclassificazioni passate a «Redditività e solvibilità» (${n} ${n === 1 ? "esercizio" : "esercizi"}${info.concorrenti ? ` · Peer Group: ${info.nomi.join(", ")}` : ""}).` });
      if (apri) setVista("RS");
    } catch (e) {
      setMsgRS({ tipo: "warn", testo: `Passaggio a «Redditività e solvibilità» non riuscito: ${e.message}` });
    } finally { setDlInCorso(null); }
  };

  /* ---------- Comparazione settoriale ---------- */
  const comparazioneCorrente = () => {
    try { return cmpApi.current?.esporta?.() || null; } catch { return null; }
  };
  const comparazioneRef = useRef(null);
  comparazioneRef.current = cmp;
  /* I file di ciascuna azienda per la comparazione: l'analisi di Redditività
     (solo l'azienda stessa, esercizi chiusi: è il formato che porta tutto in un
     file), altrimenti i JSON di SP, CE e RF; più QoE e DCF quando ci sono. */
  const fileComparazione = (id) => {
    const z = aziendaById(id);
    const d = datiAzienda(id);
    if (!z || !d) return [];
    const programmi = [];
    for (const anno of Object.keys(d.risultati).sort()) {
      for (const sg of ["SP", "CE", "RF"]) {
        const x = d.risultati[anno][sg];
        if (x?.blob) programmi.push(new File([x.blob], x.nome, { type: "application/json" }));
      }
    }
    return componiFileComparazione({
      nome: z.nome, analisiTesto: analisiDi(id)?.testo || null, programmi,
      qoe: qoeConFase5(qoeLiveDi(id)), dcf: dcfLiveDi(z.id, { aggiorna: false }),
    }).file;
  };
  const firmaComparazione = () => aziendeRef.current.map((z) => {
    const d = datiAzienda(z.id) || { risultati: {} };
    /* Solo ciò che cambia la sostanza del confronto: esercizi riclassificati,
       presenza dell'analisi, di QoE e del DCF (i loro testi cambiano anche solo
       per l'ora di salvataggio o per un nuovo montaggio del programma). */
    const an = z.id === rsAziendaRef.current || z.analisi ? "a" : "";
    const q = (z.id === qoeAziendaRef.current && (qoeRef.current.salvataggio || qoeRef.current.zip)) || z.qoe ? "q" : "";
    return [z.id, z.nome, Object.keys(d.risultati).sort().map((a) => ["SP", "CE", "RF"].map((s) => d.risultati[a][s]?.blob?.size || "-").join(",")).join(";"),
      an, q, z.dcf?.testo.length || ""].join("|");
  }).join("§");
  const [zipCmp, setZipCmp] = useState({ sopra: false, inCorso: false, msg: null });
  /* «Aggiorna la comparazione»: rilegge tutto ciò che sta a monte. Le
     modifiche fatte nelle schede SP, CE e RF dell'azienda in vista, l'analisi
     di Redditività e solvibilità (dal programma se è aperto, con i parametri
     compilati), Quality of Earnings con lo spread, il DCF di ogni pagina aperta. */
  const [cmpRilettura, setCmpRilettura] = useState(false);
  const aggiornaComparazioneTutto = async () => {
    setCmpRilettura(true);
    try {
      try { await riprendiModifiche(); } catch { /* restano gli ultimi JSON */ }
      catturaQoe();
      for (const z of aziendeRef.current) dcfLiveDi(z.id);
      await pausa(300);
      const n = aggiornaComparazione();
      setCmpCambiata(false);
      setZipCmp((x) => ({ ...x, msg: { tipo: "ok", testo: `↻ Comparazione aggiornata con i dati attuali di ${n} aziende: riclassificazioni, Redditività e solvibilità, Quality of Earnings e DCF.` } }));
    } finally {
      setCmpRilettura(false);
    }
  };
  const caricaZipComparazione = async (file) => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setZipCmp({ sopra: false, inCorso: false, msg: { tipo: "errore", testo: `${file.name} non è uno ZIP: trascina lo ZIP della sessione scaricato con «⬇ ZIP sessione».` } }); return; }
    setZipCmp({ sopra: false, inCorso: true, msg: null });
    try {
      const el = await aziendeDaZipComparazione(file);
      if (!el.length) throw new Error("nello ZIP non ci sono aziende con riclassificazioni o analisi");
      setCmp((c) => ({ versione: c.versione + 1, aziende: el.map(({ id, nome, file: f }) => ({ id, nome, file: f })), sessione: null, firma: null, zip: file.name }));
      setCmpCambiata(false);
      const righe = el.map((a) => `${a.nome}: ${a.riepilogo.analisi ? "analisi di Redditività" : `${a.riepilogo.programmi} JSON di SP, CE e RF`}` +
        ` · ${a.riepilogo.qoe ? "Quality of Earnings" : "senza Quality of Earnings"} · ${a.riepilogo.dcf ? "DCF" : "senza DCF"}`);
      const senzaDcf = el.filter((a) => !a.riepilogo.dcf).map((a) => a.nome);
      setZipCmp({ sopra: false, inCorso: false, msg: { tipo: senzaDcf.length ? "avviso" : "ok",
        testo: `✓ ${file.name}: ${el.length} aziende nella comparazione.`, righe,
        nota: senzaDcf.length ? `Senza DCF: ${senzaDcf.join(", ")}. Apri la loro pagina «Pro-forma e DCF», poi riscarica lo ZIP della sessione.` : null } });
    } catch (e) {
      setZipCmp({ sopra: false, inCorso: false, msg: { tipo: "errore", testo: `ZIP non caricato: ${e?.message || e}` } });
    }
  };
  const aziendeConDati = () => aziendeRef.current.filter((z) => conRisultati(datiAzienda(z.id)?.risultati));
  /* Passa alla comparazione i dati attuali di tutte le aziende con riclassificazioni. */
  const aggiornaComparazione = () => {
    const elenco = ordineAziende().map((id) => aziendaById(id)).filter(Boolean)
      .filter((z) => conRisultati(datiAzienda(z.id)?.risultati))
      .map((z) => ({ id: z.id, nome: z.nome, file: fileComparazione(z.id) }));
    setCmp((c) => ({ ...c, aziende: elenco, firma: firmaComparazione(), zip: null }));
    return elenco.length;
  };
  /* Dopo un caricamento che porta dati completi (ZIP, export del DCF), la
     comparazione si aggiorna da sola se ci sono almeno due aziende. */
  /* Non più automatico: dopo nuovi dati la scheda Comparazione segnala che
     sono cambiati e la aggiorni tu con «↻ Aggiorna la comparazione». */
  const dopoNuoviDati = () => {};
  const dopoNuoviDatiRef = useRef(null);
  dopoNuoviDatiRef.current = dopoNuoviDati;
  const aggiornaAziendaRef = useRef(null);
  aggiornaAziendaRef.current = aggiornaAzienda;
  const [cmpCambiata, setCmpCambiata] = useState(false);
  useEffect(() => {
    if (vista !== "CMP") return;
    const controlla = () => setCmpCambiata(comparazioneRef.current.firma !== null && firmaComparazione() !== comparazioneRef.current.firma);
    controlla();
    const t = setInterval(controlla, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, cmp.firma]);

  /* ---------- ZIP ---------- */
  const anniConRisultati = Object.keys(risultati).sort();
  /* Contenuto dello ZIP di un'azienda dentro una cartella (radice o «aziende/<Nome>/»). */
  /* conDocumenti: solo negli ZIP che scarichi (non in quelli passati ai programmi).
     coda: stato della coda interrotta, per riprendere dopo «Riapri sessione da ZIP». */
  const riempiCartella = (cartella, id, { conAnalisi = true, conQoe = conAnalisi, conTtm = true, conDcf = conAnalisi && conQoe, conDocumenti = false, coda = null } = {}) => {
    const d = datiAzienda(id);
    const anniR = Object.keys(d.risultati).sort();
    let azienda = "";
    for (const anno of anniR) {
      const r = d.risultati[anno];
      azienda ||= r.azienda || "";
      const c = cartella.folder(nomeCartella(anno));
      for (const s of ["SP", "CE", "RF"]) if (r[s]?.blob) c.file(r[s].nome, r[s].blob);
    }
    // Documenti caricati (PDF e testo), uno per riquadro: «documenti/2024-2025/ni/<file>».
    const documenti = [];
    if (conDocumenti) {
      for (const a of d.anni) {
        if (!annoValido(a.anno)) continue;
        for (const tipo of ["prospetti", "ni", "rg"]) {
          const f = d.file[`${a.id}.${tipo}`];
          if (!f) continue;
          const percorso = `documenti/${nomeCartella(a.anno)}/${tipo}/${nomeFileSicuro(f.name)}`;
          cartella.file(percorso, f);
          documenti.push({ anno: a.anno, tipo, percorso, nome: f.name, elaborato: !!(a.docElaborati && d.risultati[a.anno]) });
        }
      }
    }
    if (conDocumenti && d.ttm && d.file[CHIAVE_DOC_TTM]) {
      const f = d.file[CHIAVE_DOC_TTM];
      const percorso = `documenti/ttm/${nomeFileSicuro(f.name)}`;
      cartella.file(percorso, f);
      documenti.push({ anno: "TTM", tipo: "infrannuale", percorso, nome: f.name, elaborato: true });
    }
    azienda ||= d.sessione?.azienda || (d.nomeAuto ? "" : d.nome) || "";
    // Bilancio TTM, se caricato.
    const conT = conTtm && d.ttm;
    if (conT) cartella.file(`ttm/${d.ttm.nome}`, d.ttm.testo);
    // Analisi di «Redditività e solvibilità» (lo stesso file di «Salva analisi»).
    const analisi = conAnalisi ? analisiDi(id) : null;
    if (analisi) cartella.file(`redditivita-solvibilita/${analisi.nome}`, analisi.testo);
    // Salvataggio di «Quality of Earnings» (solo l'azienda in analisi).
    const salvQoe = conQoe ? qoeLiveDi(id) : null;
    if (salvQoe) cartella.file(`quality-of-earnings/${salvQoe.nome}`, salvQoe.testo);
    // Ultima esportazione JSON del Pro-forma e DCF di questa azienda.
    const dcfA = conDcf ? dcfLiveDi(id) : null;
    if (dcfA) cartella.file(`proforma-dcf/${dcfA.nome}`, dcfA.testo);
    // Indice dell'azienda: serve a «Riapri sessione da ZIP».
    cartella.file("sessione.json", JSON.stringify({
      formato: "suite-riclassificazione/1",
      azienda,
      analisi: analisi ? `redditivita-solvibilita/${analisi.nome}` : null,
      qualityOfEarnings: salvQoe ? `quality-of-earnings/${salvQoe.nome}` : null,
      ttm: conT ? `ttm/${d.ttm.nome}` : null,
      creato: new Date().toISOString(),
      esercizi: anniR.map((anno) => ({
        anno, cartella: nomeCartella(anno),
        file: Object.fromEntries(["SP", "CE", "RF"].filter((s) => d.risultati[anno][s]?.blob).map((s) => [s, d.risultati[anno][s].nome])),
      })),
      ...(conDocumenti ? { documenti, documentiIntegrati: !!aziendaById(id)?.docIntegrati, documentiVisti: [...vistiDi(id)] } : {}),
      ...(coda ? { coda } : {}),
    }, null, 2));
    const nome = `${pulisciNome(azienda) || "riclassificazioni"}${anniR.length ? `_${Number(anniR[0]) - 1}-${anniR[anniR.length - 1]}` : ""}.zip`;
    return { nome, analisi: !!analisi, qoe: !!salvQoe, esercizi: anniR, documenti: documenti.length };
  };
  /* Coda interrotta da mettere nello ZIP: aziende indicate per cartella
     (nomeDi), unità in corso tornate «in attesa». Niente se è finita. */
  const codaPerZip = (nomeDi, soloId = null) => {
    const c = codaRef.current;
    if (!c?.unita?.length || !c.unita.some((u) => !completata(u))) return null;
    const unita = c.unita
      .filter((u) => !soloId || (u.azienda === soloId && u.fase !== 4))
      .map(({ id: _id, ...u }) => ({ ...u, azienda: nomeDi(u.azienda), ...(u.stato === "in_corso" ? { stato: "attesa", fatti: 0 } : {}) }))
      .filter((u) => u.azienda);
    return unita.some((u) => !completata(u)) ? { creata: c.creata, unita } : null;
  };
  /* ZIP di un'azienda: una cartella per esercizio + sessione.json (formato di sempre). */
  const costruisciZip = async (id, opzioni) => {
    const zip = new JSZip();
    const info = riempiCartella(zip, id, opzioni);
    const blob = await zip.generateAsync({ type: "blob" });
    return { ...info, blob };
  };
  const zipComeFile = async (id, opzioni) => {
    const { nome, blob } = await costruisciZip(id, opzioni);
    return new File([blob], nome, { type: "application/zip" });
  };
  /* ZIP della sessione: una cartella per azienda («aziende/<Nome>/»). */
  const costruisciZipSessione = async () => {
    const zip = new JSZip();
    const voci = [];
    const usati = new Set();
    const cartellaDi = {};
    let documenti = 0;
    for (const z of aziendeRef.current) {
      let cart = pulisciNome(z.nome) || "Azienda";
      while (usati.has(cart.toLowerCase())) cart += "_2";
      usati.add(cart.toLowerCase());
      cartellaDi[z.id] = cart;
      const info = riempiCartella(zip.folder(`aziende/${cart}`), z.id, { conDocumenti: true });
      documenti += info.documenti;
      voci.push({ nome: z.nome, cartella: cart, ruolo: z.id === principaleRef.current ? "principale" : "concorrente", esercizi: info.esercizi, analisi: info.analisi, qualityOfEarnings: info.qoe, documenti: info.documenti });
    }
    const sc = comparazioneCorrente();
    if (sc) zip.file(`comparazione/${sc.nome}`, sc.testo);
    const coda = codaPerZip((id) => cartellaDi[id] || null);
    zip.file("sessione.json", JSON.stringify({ formato: "suite-riclassificazione/2", creato: new Date().toISOString(), aziende: voci, comparazione: sc ? `comparazione/${sc.nome}` : null, ...(coda ? { coda } : {}) }, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    const pr = aziendaById(principaleRef.current);
    return { nome: `sessione_${pulisciNome(pr?.nome) || "aziende"}_${voci.length}-aziende.zip`, blob, aziende: voci.length, documenti, interrotta: !!coda };
  };
  const scaricaZipAzienda = async (id = attivaRef.current) => {
    setDlInCorso("zip");
    setEsitoDl(null);
    try {
      if (id === attivaRef.current) await riprendiModifiche(); // modifiche fatte nelle schede
      const coda = codaPerZip((x) => (x === id ? "questa" : null), id);
      const { nome, blob, analisi, qoe: conQoe, documenti } = await costruisciZip(id, { conDocumenti: true, coda });
      const esito = await consegnaAllUtente(nome, blob);
      const extra = [analisi && "redditività e solvibilità", conQoe && "Quality of Earnings", documenti && `${documenti} ${documenti === 1 ? "documento" : "documenti"}`, coda && "punto di ripresa"].filter(Boolean);
      setEsitoDl(esito === "salvato" ? { tipo: "ok", testo: `${nome}${extra.length ? ` · con ${extra.join(" e ")}` : ""}` } : { tipo: "warn", testo: esito === "annullato" ? "Download annullato" : "Download non disponibile in questa vista" });
    } catch (e) {
      setEsitoDl({ tipo: "warn", testo: `ZIP non creato: ${e.message}` });
    } finally {
      setDlInCorso(null);
    }
  };
  const scaricaZipSessione = async () => {
    setDlInCorso("sessione");
    setEsitoDl(null);
    try {
      await riprendiModifiche();
      fotografaAttiva();
      const { nome, blob, aziende: n, documenti, interrotta } = await costruisciZipSessione();
      const esito = await consegnaAllUtente(nome, blob);
      setEsitoDl(esito === "salvato" ? { tipo: "ok", testo: `${nome} · ${n} aziende${documenti ? ` · ${documenti} ${documenti === 1 ? "documento" : "documenti"}` : ""}${interrotta ? " · con il punto di ripresa" : ""}` } : { tipo: "warn", testo: esito === "annullato" ? "Download annullato" : "Download non disponibile in questa vista" });
    } catch (e) {
      setEsitoDl({ tipo: "warn", testo: `ZIP non creato: ${e.message}` });
    } finally {
      setDlInCorso(null);
    }
  };
  const scaricaUno = async (anno, s) => {
    setDlInCorso(`${anno}.${s}`);
    try {
      const tutti = anno === annoAttivoRef.current ? await riprendiModifiche() : risultatiRef.current;
      const r = tutti[anno]?.[s];
      if (r?.blob) await consegnaAllUtente(r.nome, r.blob);
    } finally { setDlInCorso(null); }
  };

  /* ---------- Salvataggio della sessione nell'artifact ---------- */
  const persRef = useRef(null);
  const prontoSalvataggio = useRef(false);
  const [pers, setPers] = useState({ disponibile: false, uso: null, ultimo: null, ripristino: null, msg: null, errore: "" });
  const [confermaSvuota, setConfermaSvuota] = useState(false);
  const salv = useRef({ inCorso: false, ancora: false, timer: null, ultimo: "" });
  const aggiornaUso = async () => {
    const u = await persRef.current?.uso();
    if (u) setPers((s) => ({ ...s, uso: u }));
  };
  const scriviSessione = async () => {
    const p = persRef.current;
    const ids = [];
    const tieni = (id) => { if (id) ids.push(id); return id || null; };
    const elenco = [];
    for (const z of aziendeRef.current) {
      const d = datiAzienda(z.id);
      if (!d) continue;
      const an = analisiDi(z.id);
      const fileIdx = {};
      for (const [k, f] of Object.entries(d.file || {})) fileIdx[k] = { id: tieni(await p.carica(f, f.name)), nome: f.name, tipo: f.type || "", size: f.size };
      const ris = {};
      for (const [anno, r] of Object.entries(d.risultati || {})) {
        const o = { avvisi: r.avvisi || [], azienda: r.azienda || "" };
        for (const s of ["SP", "CE", "RF"]) {
          const x = r[s];
          if (!x) continue;
          o[s] = x.blob ? { nome: x.nome, id: tieni(await p.carica(x.blob, x.nome)), voci: x.voci || null, vuoto: !!x.vuoto } : { errore: x.errore || "assente" };
        }
        ris[anno] = o;
      }
      elenco.push({
        id: z.id, nome: z.nome, nomeAuto: !!z.nomeAuto,
        anni: d.anni.map(({ id, anno, ripristinato, docElaborati }) => ({ id, anno, ripristinato: !!ripristinato, docElaborati: !!docElaborati })),
        docIntegrati: !!z.docIntegrati,
        docVisti: Array.isArray(z.docVisti) ? z.docVisti : null,
        file: fileIdx, risultati: ris,
        ttm: d.ttm ? { nome: d.ttm.nome, info: d.ttm.info, id: tieni(await p.caricaTesto(d.ttm.testo, d.ttm.nome)) } : null,
        analisi: an ? { nome: an.nome, id: tieni(await p.caricaTesto(an.testo, an.nome)) } : null,
        qoe: (await (async () => { const q = qoeLiveDi(z.id); return q ? { nome: q.nome, id: tieni(await p.caricaTesto(q.testo, q.nome)) } : null; })()),
        qoeFirma: z.id === qoeAziendaRef.current ? (qoeRef.current.firma ?? null) : (z.qoeFirma ?? null),
        dcf: (await (async () => { const x = dcfLiveDi(z.id, { aggiorna: false }); return x ? { nome: x.nome, id: tieni(await p.caricaTesto(x.testo, x.nome)) } : null; })()),
        sessione: d.sessione || null,
        avanzamento: d.avanzamento || [],
      });
    }
    const sc = comparazioneCorrente() || (comparazioneRef.current.sessione ? { nome: "comparazione-sessione.json", testo: comparazioneRef.current.sessione } : null);
    const comparazione = sc ? { nome: sc.nome, id: tieni(await p.caricaTesto(sc.testo, sc.nome)), firma: comparazioneRef.current.firma } : null;
    const indice = { formato: "suite-sessione/1", aziende: elenco, attiva: attivaRef.current, principale: principaleRef.current, coda: codaRef.current, comparazione };
    const firma = JSON.stringify(indice);
    if (firma === salv.current.ultimo) return;
    await p.scriviIndice({ ...indice, salvato: new Date().toISOString() }, ids);
    salv.current.ultimo = firma;
    const mancanti = p.errori.splice(0);
    setPers((s) => ({ ...s, ultimo: new Date(), errore: mancanti.length ? `Non salvati: ${[...new Set(mancanti)].join(" · ")}` : "" }));
    aggiornaUso();
  };
  const salvaOra = async () => {
    const s = salv.current;
    if (!persRef.current || !prontoSalvataggio.current) return;
    if (s.inCorso) { s.ancora = true; return; }
    s.inCorso = true;
    try {
      do { s.ancora = false; await scriviSessione(); } while (s.ancora);
    } catch (e) {
      setPers((x) => ({ ...x, errore: `Salvataggio non riuscito: ${e?.message || e?.code || e}` }));
    } finally { s.inCorso = false; }
  };
  const salvaPresto = (ms = 2500) => {
    if (!persRef.current) return;
    clearTimeout(salv.current.timer);
    salv.current.timer = setTimeout(() => salvaOra(), ms);
  };
  useEffect(() => { salvaPresto(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aziende, anni, file, risultati, ttm, coda, attiva, principale, sessione, avanzamento, qoe.salvataggio, qoe.zip]);
  /* Le modifiche fatte dentro Redditività e Quality of Earnings (parametri,
     CAPM, rettifiche) non passano da qui: un controllo ogni 30 secondi. */
  useEffect(() => {
    const t = setInterval(() => { if (!salv.current.inCorso) salvaOra(); }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ripristinaSessione = async (ind) => {
    const p = persRef.current;
    setPers((s) => ({ ...s, ripristino: "Ripristino della sessione salvata…" }));
    const mancanti = [];
    const ids = [];
    const lista = [];
    for (const a of ind.aziende) {
      setPers((s) => ({ ...s, ripristino: `Ripristino della sessione salvata · ${a.nome}…` }));
      const fileA = {};
      for (const [k, f] of Object.entries(a.file || {})) {
        if (!f.id) { mancanti.push(f.nome); continue; }
        try { fileA[k] = await p.leggiFile(f.id, f.nome, f.tipo); ids.push(f.id); } catch { mancanti.push(f.nome); }
      }
      const ris = {};
      for (const [anno, r] of Object.entries(a.risultati || {})) {
        const o = { avvisi: r.avvisi || [], ...(r.azienda ? { azienda: r.azienda } : {}) };
        for (const s of ["SP", "CE", "RF"]) {
          const x = r[s];
          if (!x || x.errore || !x.id) { o[s] = { errore: x?.errore || "non salvato" }; continue; }
          try { o[s] = { nome: x.nome, blob: await p.leggiFile(x.id, x.nome, "application/json"), voci: x.voci, vuoto: x.vuoto }; ids.push(x.id); }
          catch { o[s] = { errore: "file salvato non più disponibile" }; mancanti.push(x.nome); }
        }
        ris[anno] = o;
      }
      let ttmA = null;
      if (a.ttm?.id) { try { ttmA = { nome: a.ttm.nome, info: a.ttm.info, testo: await p.leggiTesto(a.ttm.id) }; ids.push(a.ttm.id); } catch { mancanti.push(a.ttm.nome); } }
      let anA = null;
      if (a.analisi?.id) { try { anA = { nome: a.analisi.nome, testo: await p.leggiTesto(a.analisi.id) }; ids.push(a.analisi.id); } catch { mancanti.push(a.analisi.nome); } }
      let dcfA = null;
      if (a.dcf?.id) { try { dcfA = { nome: a.dcf.nome, testo: await p.leggiTesto(a.dcf.id) }; ids.push(a.dcf.id); } catch { mancanti.push(a.dcf.nome); } }
      let qoeA = null;
      if (a.qoe?.id) { try { qoeA = { nome: a.qoe.nome, testo: await p.leggiTesto(a.qoe.id) }; ids.push(a.qoe.id); } catch { mancanti.push(a.qoe.nome); } }
      lista.push({
        id: a.id, nome: a.nome, nomeAuto: !!a.nomeAuto,
        anni: a.anni?.length ? a.anni : [nuovoAnno()], file: fileA, risultati: ris, ttm: ttmA, analisi: anA,
        qoe: qoeA, qoeFirma: a.qoeFirma ?? null, dcf: dcfA, docIntegrati: !!a.docIntegrati,
        ...(Array.isArray(a.docVisti) ? { docVisti: a.docVisti } : {}),
        sessione: a.sessione || null, avanzamento: a.avanzamento || [],
      });
    }
    /* Salvataggi della tappa 1: un solo QoE, dell'azienda in analisi. */
    if (ind.qoe?.id) {
      const pz = lista.find((z) => z.id === ind.principale) || lista[0];
      try { if (pz && !pz.qoe) pz.qoe = { nome: ind.qoe.nome, testo: await p.leggiTesto(ind.qoe.id) }; ids.push(ind.qoe.id); } catch { mancanti.push(ind.qoe.nome); }
    }
    let cmpTesto = null;
    if (ind.comparazione?.id) { try { cmpTesto = await p.leggiTesto(ind.comparazione.id); ids.push(ind.comparazione.id); } catch { mancanti.push(ind.comparazione.nome); } }
    p.impostaRiferimenti(ids);
    if (!lista.length) return;
    const princ = lista.find((z) => z.id === ind.principale) || lista[0];
    const att = lista.find((z) => z.id === ind.attiva) || princ;
    setAziende(lista);
    setPrincipale(princ.id);
    attivaRef.current = att.id;
    setAttiva(att.id);
    caricaInLavoro(att);
    rsAziendaRef.current = null;
    qoeAziendaRef.current = null;
    montaQoe(att.id, { cattura: false });
    if (cmpTesto) setCmp((c) => ({ versione: c.versione + 1, aziende: null, sessione: cmpTesto, firma: ind.comparazione.firma ?? null }));
    let incompleta = false;
    if (ind.coda?.unita?.length) {
      const c = { ...ind.coda, corrente: "", unita: ind.coda.unita.filter((u) => u.fase !== 4 && lista.some((z) => z.id === u.azienda)).map((u) => (u.stato === "in_corso" ? { ...u, stato: "attesa", fatti: 0 } : u)) };
      incompleta = c.unita.some((u) => !completata(u));
      setCoda(c);
      setStato(incompleta ? "interrotto" : "finito");
    }
    await passaARSAzienda(att.id);
    const el = Object.keys(att.risultati).sort();
    if (el.length) { await pausa(300); await apriAnno(el[el.length - 1]); }
    setPers((s) => ({
      ...s, ripristino: null,
      msg: `Sessione salvata ripristinata: ${lista.map((z) => z.nome).join(", ")}.` +
        (incompleta ? " L'elaborazione si era fermata: premi «Riprendi» per continuare dal primo passo non completato." : "") +
        (mancanti.length ? ` Non più disponibili: ${[...new Set(mancanti)].join(", ")}.` : ""),
    }));
  };
  useEffect(() => {
    let annullato = false;
    (async () => {
      const p = await apriPersistenza();
      if (!p || annullato) return;
      persRef.current = p;
      setPers((s) => ({ ...s, disponibile: true }));
      try {
        const ind = await p.leggiIndice();
        if (ind?.aziende?.length) await ripristinaSessione(ind);
      } catch (e) {
        setPers((s) => ({ ...s, ripristino: null, errore: `Sessione salvata non ripristinata: ${e?.message || e?.code || e}` }));
      } finally {
        prontoSalvataggio.current = true;
        aggiornaUso();
      }
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const svuotaSalvataggio = async () => {
    setConfermaSvuota(false);
    const p = persRef.current;
    if (!p) return;
    prontoSalvataggio.current = false;
    clearTimeout(salv.current.timer);
    try {
      await p.svuota();
      setPers((s) => ({ ...s, msg: "Sessione salvata svuotata: alla prossima apertura la pagina parte vuota. Quello che vedi ora resta finché non chiudi; se continui a lavorare viene salvato di nuovo.", errore: "", ultimo: null }));
    } catch (e) {
      setPers((s) => ({ ...s, errore: `Svuotamento non riuscito: ${e?.message || e?.code || e}` }));
    } finally {
      /* Riparte al prossimo cambiamento (non subito: si ricreerebbe la copia appena tolta). */
      salv.current.ultimo = "";
      setTimeout(() => { prontoSalvataggio.current = true; }, 3000);
      clearTimeout(salv.current.timer);
      aggiornaUso();
    }
  };

  const disab = stato === "in_corso" || stato === "verifica" || !!cambio || !!cambioAz || !!pers.ripristino;
  const esitoGenerale = (() => {
    const anniR = Object.keys(risultati);
    if (!anniR.length) return null;
    const e = anniR.map((a) => esitoAnno(risultati[a]));
    if (e.every((x) => x.stato === "fatto")) return "fatto";
    if (e.every((x) => x.stato === "errore")) return "errore";
    return "avviso";
  })();
  const nomeAttiva = aziende.find((z) => z.id === attiva)?.nome || "";
  const nomeDi = (id) => aziende.find((z) => z.id === id)?.nome || "";
  const multi = aziende.length > 1;
  const totPassi = coda ? coda.unita.reduce((n, u) => n + u.passi, 0) : 0;
  const fattiPassi = coda ? coda.unita.reduce((n, u) => n + (completata(u) ? u.passi : Math.min(u.fatti || 0, u.passi)), 0) : 0;
  const codaIncompleta = !!coda && coda.unita.some((u) => !completata(u));
  const primoPassoMancante = (() => {
    if (!coda) return 0;
    let n = 0;
    for (const u of coda.unita) { if (!completata(u)) return n + 1; n += u.passi; }
    return 0;
  })();
  const peerCambiato = multi && rsAzienda && rsAzienda === attiva && rsFirmaPeer !== null && stato !== "in_corso" && firmaPeerDi(attiva) !== rsFirmaPeer;
  const ziponeOk = aziende.some((z) => { const v = vistaAzienda(z); return conRisultati(v.risultati) || Object.keys(v.file || {}).length > 0; });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* ---------- Barra superiore: schede e avanzamento ---------- */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-800 mr-3">Riclassificazione di bilancio</span>
          {multi && (
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 mr-1">
              Azienda:
              <select value={attiva} onChange={(e) => scegliAzienda(e.target.value)} disabled={disab}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800 disabled:opacity-60">
                {aziende.map((z) => <option key={z.id} value={z.id}>{z.nome}{z.id === principale ? " (in analisi)" : ""}</option>)}
              </select>
            </label>
          )}
          <Scheda attiva={vista === "RICERCA"} onClick={() => setVista("RICERCA")}>🔎 Ricerca Aziende</Scheda>
          <Scheda attiva={vista === "carica"} onClick={() => setVista("carica")}>📂 Documenti</Scheda>
          {Object.entries(PROGRAMMI).map(([s, p]) => (
            <Scheda key={s} attiva={vista === s} onClick={() => setVista(s)}>
              {p.sigla} · {p.nome}
            </Scheda>
          ))}
          <Scheda attiva={vista === "RS"} onClick={() => setVista("RS")}>
            📊 Redditività e solvibilità{zipRS ? " ✓" : ""}
          </Scheda>
          <Scheda attiva={vista === "STRAT"} onClick={() => setVista("STRAT")}>🧭 Analisi strategica</Scheda>
          <Scheda attiva={vista === "QOE"} onClick={() => setVista("QOE")}>
            🧾 Quality of Earnings{qoe.zip || qoe.salvataggio ? " ✓" : ""}
          </Scheda>
          <Scheda attiva={vista === "DCF"} onClick={() => setVista("DCF")}>
            📈 Pro-forma e DCF
          </Scheda>
          <Scheda attiva={vista === "CMP"} onClick={() => setVista("CMP")}>
            ⚖️ Comparazione{cmp.aziende || cmp.sessione ? " ✓" : ""}
          </Scheda>
          {annoAttivo && stato !== "in_corso" && (
            <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 font-semibold">
              In vista: {multi ? `${nomeAttiva} · ` : ""}{nomeCartella(annoAttivo)}
            </span>
          )}
          {cambio && <span className="text-xs text-slate-500">Apertura {nomeCartella(cambio)}…</span>}
          {cambioAz && <span className="text-xs text-slate-500">Apertura di «{nomeDi(cambioAz)}»…</span>}
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {stato === "in_corso" && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  {coda?.corrente || "Preparazione…"}{totPassi ? ` · passo ${Math.min(fattiPassi + 1, totPassi)} di ${totPassi}` : ""}{" · "}{monitor.inCorso} chiamate IA in corso
                </span>
                <button onClick={ferma} className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-100">Interrompi</button>
              </>
            )}
            {stato === "verifica" && <span className="text-indigo-700">Verifica che Claude risponda…</span>}
            {stato !== "in_corso" && (
              <>
                {multi && ziponeOk && (
                  <button onClick={scaricaZipSessione} disabled={!!dlInCorso || !!cambio || disab}
                    title="ZIP con una cartella per azienda (aziende/<Nome>/…), riapribile con «Riapri sessione da ZIP»"
                    className="px-2.5 py-1 rounded-md bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-40">
                    {dlInCorso === "sessione" ? "Preparazione…" : `⬇ ZIP sessione (${aziende.length} aziende)`}
                  </button>
                )}
                {(anniConRisultati.length > 0 || Object.keys(file).length > 0) && (
                  <button onClick={() => scaricaZipAzienda()} disabled={!!dlInCorso || !!cambio || disab}
                    title="ZIP con le riclassificazioni di ogni esercizio e il JSON di «Redditività e solvibilità», riapribile con «Riapri sessione da ZIP»"
                    className="px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-40">
                    {dlInCorso === "zip" ? "Preparazione…" : multi ? `⬇ ZIP di ${nomeAttiva}` : "⬇ Scarica ZIP aggiornato"}
                  </button>
                )}
              </>
            )}
            {esitoDl && vista !== "carica" && <span className={esitoDl.tipo === "ok" ? "text-emerald-700" : "text-amber-700"}>{esitoDl.tipo === "ok" ? "✓ salvato" : esitoDl.testo}</span>}
            {sessione && stato !== "in_corso" && !multi && <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1">📦 {sessione.azienda || sessione.nome}</span>}
            {stato === "finito" && esitoGenerale === "fatto" && <span className="text-emerald-700 font-semibold">✓ Riclassificazioni completate</span>}
            {stato === "finito" && esitoGenerale === "avviso" && <span className="text-amber-700 font-semibold">⚠ Completato con problemi: vedi i dettagli</span>}
            {stato === "finito" && esitoGenerale === "errore" && <span className="text-rose-700 font-semibold">✗ Nessuna riclassificazione riuscita</span>}
            {stato === "errore" && <span className="text-rose-700 font-semibold">✗ Elaborazione fermata</span>}
            {stato === "interrotto" && <span className="text-amber-700">Interrotto{codaIncompleta ? " · «Riprendi» in Documenti" : ""}</span>}
          </div>
        </div>
      </header>

      {/* ---------- Schermata di caricamento ---------- */}
      <div hidden={vista !== "RICERCA"}>
        {ricercaAperta && (
          <iframe title="Ricerca Aziende" srcDoc={htmlRicercaAziende}
            style={{ width: "100%", height: "calc(100vh - 52px)", border: 0, display: "block" }} />
        )}
      </div>
      <main hidden={vista !== "carica"} className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Carica i documenti</h1>
            <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => inputZip.current?.click()} disabled={disab}
              className="px-4 py-2 rounded-lg border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-40">
              📦 Riapri sessione da ZIP
            </button>
            <input ref={inputZip} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; scegliZip(f, "sessione"); }} />
            {confermaAzzera ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5">
                <span className="text-sm text-rose-800">
                  {stato === "in_corso" ? "Interrompe l'elaborazione e cancella tutto." : `Cancella documenti e riclassificazioni${multi ? " di tutte le aziende" : ""}.`}
                </span>
                <button onClick={azzeraTutto} className="px-3 py-1 rounded-md bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700">Sì, azzera</button>
                <button onClick={() => setConfermaAzzera(false)} className="px-3 py-1 rounded-md text-sm text-slate-600 hover:bg-white">Annulla</button>
              </div>
            ) : (
              <button onClick={() => setConfermaAzzera(true)}
                className="px-4 py-2 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50">
                🗑 Azzera tutto
              </button>
            )}
            </div>
          </div>
          {zipInAttesa && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="text-sm text-amber-900">
                {zipInAttesa.modo === "sessione"
                  ? `Riaprire «${zipInAttesa.file.name}»? Sostituisce aziende, esercizi, documenti e riclassificazioni aperti ora (scarica prima lo ZIP se ti servono).`
                  : `Caricare «${zipInAttesa.file.name}» in «${nomeAttiva}»? Sostituisce esercizi, documenti e riclassificazioni di questa azienda.`}
              </span>
              <button onClick={() => (zipInAttesa.modo === "sessione" ? riapriDaZip(zipInAttesa.file) : caricaZipInAzienda(zipInAttesa.file))}
                className="px-3 py-1 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700">Sì, {zipInAttesa.modo === "sessione" ? "riapri" : "carica"}</button>
              <button onClick={() => setZipInAttesa(null)} className="px-3 py-1 rounded-md text-sm text-slate-600 hover:bg-white">Annulla</button>
            </div>
          )}
          {msgZip && (
            <p className={`mt-2 text-sm ${msgZip.tipo === "ok" ? "text-emerald-700" : msgZip.tipo === "warn" ? "text-amber-700" : "text-slate-600"}`}>
              {msgZip.tipo === "ok" ? "✓ " : ""}{msgZip.testo}
            </p>
          )}
          {pers.ripristino && <p className="mt-2 text-sm text-indigo-700">⏳ {pers.ripristino}</p>}
          {pers.msg && <p className="mt-2 text-sm text-emerald-700">💾 {pers.msg}</p>}
          <p className="text-sm text-slate-600 mt-1">
            Aggiungi un esercizio per ogni anno che vuoi riclassificare e scrivi tu l'anno. Gli esercizi girano uno alla volta,
            dal più vecchio; per ognuno escono i JSON di Stato Patrimoniale, Conto Economico e Rendiconto Finanziario.
            Il T-1 di ogni esercizio si legge dai documenti dell'anno precedente, se li hai caricati, altrimenti dalla colonna comparativa.
          </p>
          <p className="text-sm text-slate-600 mt-1">
            Con «+ Aggiungi azienda» apri una scheda per ogni concorrente: un solo «Avvia» riclassifica tutte le aziende e poi passa
            ciascuna a Redditività e solvibilità con le altre nel Peer Group. Per riprendere un lavoro già fatto usa «Riapri sessione da ZIP».
          </p>
        </div>

        {/* ---------- Chiave API unica ---------- */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">🔑 Intelligenza artificiale · una chiave per tutte le app</h2>
            <span className="text-xs text-slate-500">Vale per SP, CE, RF, Redditività, Analisi strategica, Quality of Earnings e Comparazione</span>
          </div>
          {modalitaArtifact ? (
            <p className="text-sm text-slate-600">
              In questa versione su claude.ai non serve nessuna chiave: tutte le app usano il tuo account Claude.
              La prima volta che avvii, la pagina ti chiede il permesso. Una chiave OpenAI qui non si può usare, perché la pagina
              pubblicata su claude.ai non può collegarsi ad altri servizi: vale nella versione installata (Vercel), dove la inserisci
              una volta in questo riquadro e la usano tutte le app.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm text-slate-600">
                  <span className="block text-xs font-semibold mb-0.5">Fornitore</span>
                  <select value={providerIA} disabled={disab} onChange={(e) => cambiaProvider(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </label>
                {providerIA === "openai" && (
                  <label className="text-sm text-slate-600">
                    <span className="block text-xs font-semibold mb-0.5">Modello</span>
                    <input value={modelloIA} disabled={disab} spellCheck={false}
                      onChange={(e) => { setModelloIA(e.target.value); impostaModello(e.target.value, ricorda); }}
                      placeholder={MODELLO_OPENAI_PREDEFINITO}
                      className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[16rem]">
                  <input
                    type={vedi ? "text" : "password"} value={chiave} autoComplete="off" spellCheck={false}
                    disabled={disab}
                    onChange={(e) => cambiaChiave(e.target.value)}
                    placeholder={providerIA === "openai" ? "sk-… (chiave OpenAI)" : hosting ? "sk-ant-… (facoltativa: sull'hosting c'è già una chiave)" : "sk-ant-…"}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <button type="button" onClick={() => setVedi((v) => !v)} aria-label={vedi ? "Nascondi chiave" : "Mostra chiave"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm">{vedi ? "🙈" : "👁"}</button>
                </div>
                {chiave && (
                  <button type="button" disabled={disab} onClick={() => cambiaChiave("", false)}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">Cancella</button>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input type="checkbox" checked={ricorda} disabled={disab}
                  onChange={(e) => { setRicorda(e.target.checked); impostaChiave(chiave, e.target.checked); }} />
                Ricorda in questo browser
              </label>
              <p className={`text-xs ${chiaveOk ? "text-emerald-700" : "text-amber-700"}`}>
                {chiave
                  ? providerIA === "openai"
                    ? `Chiave OpenAI impostata: tutti i programmi usano ${modelloIA || MODELLO_OPENAI_PREDEFINITO}, qualunque fornitore mostri la loro «Configurazione IA». Non finisce nei JSON salvati.`
                    : "Chiave impostata: viene passata a tutti i programmi a ogni richiesta e non finisce nei JSON salvati."
                  : providerIA === "openai"
                    ? "Inserisci la chiave OpenAI: da quel momento la usano tutti i programmi."
                  : hosting === true
                    ? "Nessuna chiave a schermo: si userà quella configurata sull'hosting (ANTHROPIC_API_KEY)."
                    : hosting === false
                      ? "Inserisci la chiave per avviare: sull'hosting non ne è configurata nessuna."
                      : "Inserisci la chiave per avviare (non riesco a verificare se l'hosting ne ha una)."}
              </p>
            </>
          )}
        </div>

        {/* ---------- Schede delle aziende ---------- */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-end gap-1 border-b border-slate-200 px-2 pt-2" role="tablist" aria-label="Aziende">
            {aziende.map((z) => {
              const d = vistaAzienda(z);
              const n = Object.keys(d.risultati || {}).length;
              return (
                <button key={z.id} role="tab" aria-selected={z.id === attiva} onClick={() => scegliAzienda(z.id)} disabled={disab && z.id !== attiva}
                  className={`px-3 py-2 rounded-t-lg text-sm font-semibold border-b-2 -mb-px disabled:opacity-50 ${z.id === attiva ? "border-indigo-600 text-indigo-700 bg-indigo-50" : "border-transparent text-slate-600 hover:bg-slate-50"}`}>
                  {z.nome || "Senza nome"}
                  {z.id === principale && <span className="ml-1 font-normal text-xs text-indigo-600">(in analisi)</span>}
                  {n > 0 && <span className="ml-1.5 text-[11px] font-normal text-emerald-700">✓ {n}</span>}
                </button>
              );
            })}
            <button onClick={aggiungiAzienda} disabled={disab}
              className="px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 rounded-t-lg disabled:opacity-40">
              + Aggiungi azienda
            </button>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2 font-semibold">
              Nome
              <input value={nomeAttiva} onChange={(e) => rinominaAzienda(attiva, e.target.value)} disabled={disab}
                className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </label>
            <span className="text-xs text-slate-500">
              {attiva === principale
                ? multi ? "Azienda in analisi: le altre schede sono il suo Peer Group." : "Azienda in analisi."
                : `Concorrente: entra nel Peer Group delle altre aziende e ha le sue analisi (Redditività, Quality of Earnings, DCF).`}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => inputZipAzienda.current?.click()} disabled={disab}
                title="Carica in questa scheda lo ZIP di un'azienda già riclassificata"
                className="px-2.5 py-1 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">📦 Carica ZIP in questa azienda</button>
              <input ref={inputZipAzienda} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; scegliZip(f, "azienda"); }} />
              {attiva !== principale && (
                <button onClick={() => setConfermaAz({ tipo: "principale", id: attiva })} disabled={disab}
                  className="px-2.5 py-1 rounded-md border border-indigo-200 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">Imposta come azienda in analisi</button>
              )}
              {attiva !== principale && (
                <button onClick={() => setConfermaAz({ tipo: "rimuovi", id: attiva })} disabled={disab}
                  className="px-2.5 py-1 rounded-md text-xs text-slate-500 hover:text-rose-600 disabled:opacity-40">Rimuovi azienda</button>
              )}
            </span>
          </div>
          {confermaAz && (
            <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="flex-1 min-w-[14rem]">
                {confermaAz.tipo === "rimuovi"
                  ? `Rimuovere «${nomeDi(confermaAz.id)}» con i suoi documenti e riclassificazioni? Esce anche dal Peer Group delle altre aziende.`
                  : `Rendere «${nomeDi(confermaAz.id)}» l'azienda in analisi? Va in testa alla coda e nello ZIP di sessione ha il ruolo «principale»; analisi e lavori di tutte le aziende restano.`}
              </span>
              <button onClick={() => (confermaAz.tipo === "rimuovi" ? rimuoviAzienda(confermaAz.id) : impostaPrincipale(confermaAz.id))}
                className="px-3 py-1 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700">Sì</button>
              <button onClick={() => setConfermaAz(null)} className="px-3 py-1 rounded-md text-sm text-slate-600 hover:bg-white">Annulla</button>
            </div>
          )}
        </div>

        {/* ---------- Esercizi ---------- */}
        <div className="space-y-3">
          {anni.map((a) => {
            const prec = anni.find((x) => annoValido(a.anno) && Number(x.anno) === Number(a.anno) - 1);
            return (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    Esercizio
                    <input value={a.anno} onChange={(e) => cambiaAnno(a.id, e.target.value)} disabled={disab || a.ripristinato}
                      inputMode="numeric" placeholder="2026"
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </label>
                  {annoValido(a.anno) && (
                    <span className="text-xs text-slate-500">
                      cartella <span className="font-mono">{nomeCartella(a.anno)}</span> · T-1 {prec ? `dai documenti ${prec.anno}` : "dalla colonna comparativa"}
                    </span>
                  )}
                  {(a.ripristinato || a.docElaborati) && risultati[a.anno] && (
                    <span className="text-xs rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5">
                      {a.docElaborati
                        ? "Riclassificato con questi documenti · non viene rifatto"
                        : file[`${a.id}.prospetti`] ? "Riaperto · verrà rielaborato con i nuovi documenti" : "Riaperto · carica documenti solo per rielaborarlo"}
                    </span>
                  )}
                  {daNonRifare(a, file, risultati) && (
                    <button onClick={() => nonRifare(a.id)} disabled={disab}
                      title="Tiene la riclassificazione già fatta: i documenti servono solo a Redditività e Quality of Earnings"
                      className="text-xs text-indigo-700 hover:underline disabled:opacity-40">Non rifare</button>
                  )}
                  {a.docElaborati && risultati[a.anno] && file[`${a.id}.prospetti`] && (
                    <button onClick={() => rielabora(a.id)} disabled={disab}
                      title="Riclassifica di nuovo questo esercizio con gli stessi documenti al prossimo «Avvia»"
                      className="text-xs text-indigo-700 hover:underline disabled:opacity-40">Rielabora</button>
                  )}                  {anni.length > 1 && (
                    <button onClick={() => togliAnno(a.id)} disabled={disab}
                      className="ml-auto text-xs text-slate-400 hover:text-rose-600 disabled:opacity-40">Rimuovi esercizio</button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {DOCUMENTI.map((d) => (
                    <div key={d.id} className="min-w-0 space-y-1">
                      <div className="text-xs font-semibold text-slate-600">{d.nome}</div>
                      <Slot file={file[`${a.id}.${d.id}`]} obbligatorio={d.id === "prospetti" && !a.ripristinato}
                        disabilitato={disab} onScelta={(f) => imposta(`${a.id}.${d.id}`, f)} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <button onClick={aggiungiAnno} disabled={disab}
            className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">
            + Aggiungi esercizio{multi ? ` a ${nomeAttiva}` : ""}
          </button>
        </div>

        {/* ---------- Bilancio TTM (anche trascinando il JSON sul riquadro) ---------- */}
        <div
          onDragOver={(e) => { if (disab) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!sopraTtm) setSopraTtm(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSopraTtm(false); }}
          onDrop={(e) => { e.preventDefault(); setSopraTtm(false); const f = e.dataTransfer.files?.[0]; if (f && !disab) caricaTtm(f); }}
          className={`rounded-xl border px-4 py-3 space-y-2 transition-colors ${sopraTtm ? "border-indigo-400 border-dashed bg-indigo-50" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-sm">📈 Bilancio TTM <span className="font-normal text-slate-500">(dal Generatore Bilancio TTM, facoltativo{multi ? `, per ${nomeAttiva}` : ""})</span></h2>
            <div className="flex gap-2">
              <button onClick={() => inputTtm.current?.click()} disabled={disab}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">
                {ttm ? "Sostituisci" : "Carica JSON bilancio-ttm"}
              </button>
              {ttm && (
                <button onClick={togliTtm} disabled={disab}
                  className="px-3 py-1.5 rounded-md text-xs text-slate-500 hover:text-rose-600 disabled:opacity-40">Togli</button>
              )}
            </div>
            <input ref={inputTtm} type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; caricaTtm(f); }} />
          </div>
          {!ttm && (
            <div onClick={() => !disab && inputTtm.current?.click()}
              className={`rounded-lg border border-dashed px-3 py-2.5 text-sm ${disab ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-indigo-300"} ${sopraTtm ? "border-indigo-400 text-indigo-800" : "border-slate-300 bg-slate-50 text-slate-500"}`}>
              {sopraTtm ? "Rilascia qui il JSON bilancio-ttm" : "Trascina qui il JSON bilancio-ttm, oppure fai clic per sceglierlo"}
            </div>
          )}
          <p className="text-xs text-slate-500">
            Il TTM è già riclassificato: non passa da SP, CE e RF. Entra in Redditività e solvibilità come periodo distinto
            dopo l'ultimo esercizio (senza toccarlo), e da lì nel Pro-forma e DCF come anno base; Quality of Earnings lo esclude.
            Quando carichi il bilancio annuale successivo, il TTM viene tolto da solo.
          </p>
          {ttm && (
            <p className="text-xs text-slate-700">
              <span className="font-mono">{ttm.nome}</span> · {ttm.info.etichetta}
              {ttm.info.data ? ` · al ${ttm.info.data}` : ""}{ttm.info.mesi ? ` · ${ttm.info.mesi} mesi infrannuali` : ""}
              {ttm.info.base ? ` · esercizio base ${ttm.info.base}` : ""}{ttm.info.unita ? ` · ${ttm.info.unita}` : ""}
            </p>
          )}
          {ttm && (
            <div className="space-y-1 max-w-md">
              <div className="text-xs font-semibold text-slate-600">Relazione trimestrale o semestrale del periodo TTM (10-Q, half-year report · PDF o JSON)</div>
              <Slot file={file[CHIAVE_DOC_TTM]} disabilitato={disab} onScelta={(f) => imposta(CHIAVE_DOC_TTM, f)} />
              <p className="text-[11px] text-slate-500">La legge Redditività e solvibilità per la scheda {ttm.info.etichetta}; Quality of Earnings la esclude, come il TTM.</p>
            </div>
          )}
          {msgTtm && <p className={`text-xs ${msgTtm.tipo === "ok" ? "text-emerald-700" : "text-amber-700"}`}>{msgTtm.testo}</p>}
        </div>

        {/* ---------- Nuovo bilancio: riaggiorna tutto ---------- */}
        {aziende.some((z) => conRisultati(vistaAzienda(z).risultati)) && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 space-y-2">
            <h2 className="font-semibold text-sm text-emerald-900">🔄 Nuovo bilancio trimestrale, semestrale o annuale</h2>
            <ul className="text-xs text-emerald-900 list-disc pl-5 space-y-0.5">
              <li><b>Trimestrale o semestrale</b>: nel riquadro TTM qui sopra premi «Sostituisci» con il nuovo JSON bilancio-ttm e carica la relazione infrannuale.</li>
              <li><b>Annuale</b>: «+ Aggiungi esercizio» con i suoi documenti; il TTM costruito sull'esercizio precedente si toglie da solo.</li>
              <li>Poi «Riaggiorna tutto»: riclassifica ciò che è nuovo, aggiorna Redditività e solvibilità (legge solo i documenti nuovi),
                Quality of Earnings (con un nuovo annuale), il DCF di ogni azienda con le tue assunzioni di prima e la comparazione.</li>
            </ul>
            <button onClick={() => avvia(false, { aggiornamento: true })} disabled={stato === "in_corso" || stato === "verifica" || !chiaveOk}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">
              🔄 Riaggiorna tutto{totaleDaElaborare ? ` (${totaleDaElaborare} ${totaleDaElaborare === 1 ? "esercizio nuovo" : "esercizi nuovi"})` : ""}
            </button>
          </div>
        )}

        <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900">
          La modalità singolo anno resta quella impostata dentro ciascun programma: per questo flusso lasciala disattivata.
        </div>

        {errore && <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">{errore}</div>}

        {totaleDaNonRifare > 0 && stato !== "in_corso" && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">
              {totaleDaNonRifare === 1 ? "1 esercizio già riclassificato (riaperto dallo ZIP) ha" : `${totaleDaNonRifare} esercizi già riclassificati (riaperti dallo ZIP) hanno`} di nuovo i documenti e verrebbe rifatto.
              Se vuoi riclassificare solo gli esercizi mancanti, tienili come sono: i loro documenti servono comunque a Redditività e Quality of Earnings.
            </span>
            <button onClick={nonRifareTutti} disabled={disab}
              className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-40">
              Non rifare {totaleDaNonRifare === 1 ? "l'esercizio già riclassificato" : `i ${totaleDaNonRifare} esercizi già riclassificati`}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {codaIncompleta && (stato === "interrotto" || stato === "errore") && (
            <button onClick={() => avvia(true)} disabled={disab || !chiaveOk}
              className="px-5 py-2.5 rounded-lg font-semibold text-sm bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">
              ▶ Riprendi (dal passo {primoPassoMancante} di {totPassi})
            </button>
          )}
          <button onClick={() => avvia(false)} disabled={!pronto}
            className={`px-5 py-2.5 rounded-lg font-semibold text-sm ${pronto ? (codaIncompleta ? "border border-indigo-300 text-indigo-700 hover:bg-indigo-50" : "bg-indigo-600 text-white hover:bg-indigo-700") : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
            {stato === "verifica" ? "Verifica di Claude…" : `▶ ${codaIncompleta ? "Avvia da capo" : totaleDaElaborare ? "Avvia le riclassificazioni" : "Avvia le analisi"}${multi && aziendeDaElaborare > 1 ? ` (${aziendeDaElaborare} aziende · ${totaleDaElaborare} esercizi)` : totaleDaElaborare > 1 ? ` (${totaleDaElaborare} esercizi)` : ""}`}
          </button>
          <span className="text-xs text-slate-500">{problemi[0] || `${Object.keys(file).length} documenti pronti${multi ? ` in ${nomeAttiva}` : ""} · ${totaleDaElaborare ? `${totaleDaElaborare} ${totaleDaElaborare === 1 ? "esercizio" : "esercizi"} da elaborare` : "esercizi già riclassificati: partono Redditività, Quality of Earnings e comparazione"}`}</span>
        </div>

        {/* ---------- Coda: avanzamento complessivo ---------- */}
        {coda && coda.unita.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">Avanzamento</span>
              <span className="text-xs text-slate-500">passo {stato === "in_corso" ? Math.min(fattiPassi + 1, totPassi) : fattiPassi} di {totPassi}</span>
              {stato === "in_corso" && (
                <button onClick={ferma} className="ml-auto px-2.5 py-1 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50">Interrompi</button>
              )}
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-2 ${stato === "in_corso" ? "bg-indigo-500" : codaIncompleta ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${totPassi ? Math.round((fattiPassi / totPassi) * 100) : 0}%` }} />
            </div>
            {stato === "in_corso" && coda.corrente && <p className="text-xs text-indigo-800">{coda.corrente}</p>}
            {stato === "interrotto" && codaIncompleta && <p className="text-xs text-amber-800">Elaborazione sospesa: «Riprendi» continua dal primo passo non completato.</p>}
            <ol className="text-xs divide-y divide-slate-100">
              {coda.unita.map((u) => (
                <li key={u.id} className="py-1 flex items-start gap-2">
                  <span className="mt-1"><Pallino stato={u.stato} piccolo /></span>
                  <span className="min-w-0">
                    <span className="font-semibold">Fase {u.fase}</span> · {u.fase === 4 || u.fase === 6 ? `${aziende.length} aziende` : nomeDi(u.azienda)} · {u.fase === 1 ? `esercizio ${u.anno}` : u.fase === 2 ? `Redditività e solvibilità${u.integrazione ? " + integrazione documentale" : ""}` : u.fase === 3 ? "Quality of Earnings (documenti dell'ultimo esercizio e diagnosi)" : u.fase === 5 ? "Pro-forma e DCF (dati aggiornati, assunzioni di prima)" : "Comparazione settoriale"}
                    {u.nota && <span className={`block ${u.stato === "errore" ? "text-rose-700" : u.stato === "avviso" ? "text-amber-700" : "text-slate-500"}`}>{u.nota}</span>}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-slate-500">{u.stato === "in_corso" ? `${u.fatti}/${u.passi}` : ETICHETTA_STATO[u.stato]}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ---------- Avanzamento per esercizio (azienda aperta) ---------- */}
        {avanzamento.length > 0 && (
          <div className="space-y-3">
            {avanzamento.map((r) => (
              <div key={r.anno} className="bg-white rounded-xl border border-slate-200">
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-3 border-b border-slate-100">
                  <Pallino stato={r.stato} />
                  <span className="font-semibold text-sm">{multi ? `${nomeAttiva} · ` : ""}Esercizio {r.anno}</span>
                  <span className="text-xs text-slate-500">{r.nota}</span>
                  <span className="ml-auto text-xs text-slate-500">{ETICHETTA_STATO[r.stato]}</span>
                </div>
                <ol className="divide-y divide-slate-100 text-sm">
                  {r.passi.map((p) => (
                    <li key={p.step} className="px-4 py-1.5 flex items-center gap-3">
                      <Pallino stato={p.stato} piccolo />
                      <span className="min-w-0">
                        {STEP_ETICHETTA[p.step]}{p.step.startsWith("T") ? " → SP, CE, RF" : ""}
                        {p.nota && <span className={`block text-xs ${p.stato === "errore" ? "text-rose-700" : p.stato === "avviso" ? "text-amber-700" : "text-slate-500"}`}>{p.nota}</span>}
                      </span>
                      <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">{ETICHETTA_STATO[p.stato]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {/* ---------- Risultati e download (azienda aperta) ---------- */}
        {anniConRisultati.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                {esitoGenerale === "errore" ? "✗ Nessun esercizio riclassificato" : esitoGenerale === "avviso" ? "⚠ Riclassificazioni (alcune incomplete)" : "⬇ Riclassificazioni pronte"}
                {multi && <span className="font-normal text-slate-500"> · {nomeAttiva}</span>}
              </h2>
              <div className="flex flex-wrap gap-2">
                {multi && (
                  <button onClick={scaricaZipSessione} disabled={!!dlInCorso || disab}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                    {dlInCorso === "sessione" ? "Preparazione…" : `ZIP sessione (${aziende.length} aziende)`}
                  </button>
                )}
                <button onClick={() => scaricaZipAzienda()} disabled={!!dlInCorso || disab}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold ${dlInCorso || disab ? "bg-slate-200 text-slate-400" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                  {dlInCorso === "zip" ? "Preparazione…" : `${multi ? "ZIP di questa azienda" : "Scarica ZIP"} (${anniConRisultati.length} ${anniConRisultati.length === 1 ? "esercizio" : "esercizi"} + analisi)`}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Scegli quale esercizio vedere nelle schede SP, CE e RF con «Visualizza». Le modifiche che fai lì vengono
              riprese quando passi a un altro esercizio o a un'altra azienda o scarichi: lo ZIP contiene sempre la versione aggiornata.
            </p>
            {esitoDl && <p className={`text-xs ${esitoDl.tipo === "ok" ? "text-emerald-700" : "text-amber-700"}`}>{esitoDl.tipo === "ok" ? `✓ ${esitoDl.testo}` : esitoDl.testo}</p>}
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">
              <span className="text-xs text-violet-900 flex-1 min-w-[12rem]">
                {msgRS ? `${msgRS.tipo === "ok" ? "✓ " : ""}${msgRS.testo}` : "«Redditività e solvibilità» riceve tutte le riclassificazioni a fine elaborazione."}
              </span>
              {zipRS && (
                <button onClick={() => setVista("RS")} className="px-2.5 py-1 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700">
                  Apri l'analisi
                </button>
              )}
              <button onClick={() => aggiornaRS(true)} disabled={!!dlInCorso || disab}
                title="Ripassa lo ZIP con le modifiche fatte nelle schede SP, CE e RF. Parametri inseriti a mano, CAPM e valori dell’integrazione documentale restano."
                className="px-2.5 py-1 rounded-md border border-violet-300 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-40">
                {dlInCorso === "rs" ? "Preparazione…" : "↻ Aggiorna con le modifiche"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-semibold">Schede</th>
                    <th className="py-2 pr-3 font-semibold">Cartella</th>
                    <th className="py-2 pr-3 font-semibold">SP</th>
                    <th className="py-2 pr-3 font-semibold">CE</th>
                    <th className="py-2 pr-3 font-semibold">RF</th>
                  </tr>
                </thead>
                <tbody>
                  {anniConRisultati.map((anno) => (
                    <tr key={anno} className={`border-b border-slate-100 align-top ${anno === annoAttivo ? "bg-amber-50" : ""}`}>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {anno === annoAttivo ? (
                          <span className="inline-flex flex-col gap-1">
                            <span className="text-xs font-semibold text-amber-800">● In vista</span>
                            <span className="flex gap-1">
                              {["SP", "CE", "RF"].map((s) => (
                                <button key={s} onClick={() => setVista(s)} className="px-1.5 py-0.5 rounded border border-amber-300 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">{s}</button>
                              ))}
                            </span>
                          </span>
                        ) : (
                          <button onClick={() => apriAnno(anno)} disabled={disab || !!dlInCorso}
                            className="px-2.5 py-1 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">
                            {cambio === anno ? "Apertura…" : "Visualizza"}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        {nomeCartella(anno)}/
                        {(risultati[anno].avvisi || []).map((t) => <span key={t} className="block font-sans text-xs text-amber-700">⚠ {t}</span>)}
                      </td>
                      {["SP", "CE", "RF"].map((s) => {
                        const x = risultati[anno][s];
                        return (
                          <td key={s} className="py-2 pr-3">
                            {x?.blob ? (
                              <>
                                <button onClick={() => scaricaUno(anno, s)} disabled={!!dlInCorso} title="Scarica solo questo file"
                                  className="text-left text-xs text-indigo-700 hover:underline break-all">{x.nome}</button>
                                {x.voci && (
                                  <span className={`block text-xs ${x.vuoto ? "text-rose-700 font-semibold" : "text-slate-500"}`}>
                                    {x.vuoto ? "✗ vuoto: nessuna voce estratta" : `${x.voci.t} voci T · ${x.voci.t1} voci T-1`}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-rose-700 font-semibold">✗ {x?.errore || "—"}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- Sessione salvata nell'artifact ---------- */}
        {pers.disponibile && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-sm">💾 Sessione salvata</h2>
              <span className="text-xs text-slate-500">
                {pers.uso ? `${formatoMB(pers.uso.bytes)} di ${formatoMB(pers.uso.maxBytes)} · ${pers.uso.files} file` : "spazio in lettura…"}
                {pers.ultimo ? ` · ultimo salvataggio alle ${pers.ultimo.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
              <span className="ml-auto">
                {confermaSvuota ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs text-rose-800">Elimina la copia salvata (documenti, JSON, analisi)?</span>
                    <button onClick={svuotaSalvataggio} className="px-2.5 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700">Sì, svuota</button>
                    <button onClick={() => setConfermaSvuota(false)} className="px-2.5 py-1 rounded-md text-xs text-slate-600 hover:bg-slate-50">Annulla</button>
                  </span>
                ) : (
                  <button onClick={() => setConfermaSvuota(true)} disabled={stato === "in_corso"}
                    className="px-2.5 py-1 rounded-md border border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40">Svuota sessione salvata</button>
                )}
              </span>
            </div>
            {pers.uso && (
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-1.5 bg-sky-500" style={{ width: `${Math.min(100, Math.max(1, Math.round((pers.uso.bytes / pers.uso.maxBytes) * 100)))}%` }} />
              </div>
            )}
            <p className="text-xs text-slate-500">
              Documenti, riclassificazioni, analisi e avanzamento si salvano da soli in questo artifact: se chiudi la pagina li ritrovi
              alla prossima apertura e un'elaborazione interrotta riparte con «Riprendi». I file oltre 20 MB non vengono salvati.
            </p>
            {pers.errore && <p className="text-xs text-amber-700">⚠ {pers.errore}</p>}
          </div>
        )}
      </main>

      {/* ---------- I tre programmi, invariati e sempre montati ---------- */}
      {/* Lo SP legge una sola volta, all'avvio, se il proxy ha una chiave Claude:
          quando la chiave unica compare o sparisce viene rimontato per rileggerlo. */}
      <div ref={contenitori.SP} hidden={vista !== "SP"}><RiclassificazioneSP key={`${versione}-${modalitaArtifact || !chiave ? "sp" : "sp-chiave"}`} annoRiferimento={annoProgrammi} /></div>
      <div ref={contenitori.CE} hidden={vista !== "CE"}><ContoEconomicoRiclassificato key={versione} annoRiferimento={annoProgrammi} /></div>
      <div ref={contenitori.RF} hidden={vista !== "RF"}><RendicontoFinanziarioRiclassificato key={versione} /></div>
      <div hidden={vista !== "RS"}>
        {multi && rsAzienda && (
          <div className={`sticky top-[52px] z-30 border-b ${peerCambiato ? "bg-amber-50 border-amber-200" : "bg-violet-50 border-violet-100"}`}>
            <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
              <span className={`flex-1 min-w-[16rem] ${peerCambiato ? "text-amber-900" : "text-violet-900"}`}>
                Analisi di <b>{nomeDi(rsAzienda)}</b>{rsAzienda === principale ? " (in analisi)" : ""}
                {concorrentiRS?.length ? ` · Peer Group: ${concorrentiRS.map((c) => nomeDi(c.id) || c.nome).join(", ")}` : " · nessun concorrente con riclassificazioni"}
                {peerCambiato && " · ⚠ Peer Group cambiato: le riclassificazioni o i nomi delle altre aziende sono cambiati dopo l'ultimo caricamento."}
                {rsAzienda !== attiva && ` · L'azienda aperta è «${nomeAttiva}».`}
              </span>
              {(peerCambiato || rsAzienda !== attiva) && (
                <button onClick={() => (rsAzienda !== attiva ? passaARSAzienda(attiva) : aggiornaRS(false))} disabled={disab || !!dlInCorso}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
                  {dlInCorso === "rs" ? "Aggiornamento…" : rsAzienda !== attiva ? `Apri ${nomeAttiva}` : "↻ Aggiorna"}
                </button>
              )}
            </div>
          </div>
        )}
        <RedditivitaSolvibilita key={`rs-${versioneRS}`} zipRiclassificazioni={zipRS} iaEsterna={chiaveOk}
          documentiSuite={docsRS.elenco} avvioIntegrazione={docsRS.avvio}
          analisiIniziale={analisiRS} apiRef={rsApi} concorrentiSuite={concorrentiRS} />
      </div>
      <div hidden={vista !== "STRAT"}>
        {strategicaAperta && <AnalisiStrategica />}
      </div>
      <div hidden={vista !== "QOE"}>
        {multi && (
          <div className="bg-slate-100 border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 py-1.5 text-xs text-slate-700">
              Quality of Earnings di <b>{nomeDi(qoeAzienda || attiva)}</b>{(qoeAzienda || attiva) === principale ? " (in analisi)" : ""}
              {qoeAzienda && qoeAzienda !== attiva ? ` · l'azienda aperta è «${nomeAttiva}»: per vedere la sua scegli di nuovo l'azienda in alto.` : " · cambiando azienda in alto il lavoro resta salvato nella sua scheda."}
            </div>
          </div>
        )}
        {qoeSuperato && (
          <div className="sticky top-[52px] z-30 bg-amber-50 border-b border-amber-200">
            <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-3 text-sm text-amber-900">
              <span className="flex-1 min-w-[16rem]">
                ⚠ <b>Redditività e solvibilità</b> (o le riclassificazioni) è cambiata dopo l'ultimo aggiornamento di Quality of
                Earnings: comparables, parametri o esercizi qui non sono quelli attuali.
              </span>
              <button onClick={aggiornaQoe} disabled={qoeInAggiornamento || stato === "in_corso"}
                className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
                {qoeInAggiornamento ? "Aggiornamento…" : "↻ Aggiorna Quality of Earnings"}
              </button>
            </div>
          </div>
        )}
        <QualityOfEarnings key={`qoe-${qoe.versione}`} zipRiclassificazioni={qoe.zip} salvataggioIniziale={qoe.salvataggio}
          zipEAggiornamento={qoe.aggiornamento} documentiSuite={documentiPerQoe}
          onScaricaZip={() => scaricaZipAzienda(qoeAziendaRef.current || attivaRef.current)} apiRef={qoeApi} />
      </div>
      <div hidden={vista !== "DCF"}>
        <div className="sticky top-[52px] z-30 bg-slate-100 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
            <span className={`flex-1 min-w-[16rem] ${dcfAgg.msg?.tipo === "errore" ? "text-rose-700" : "text-slate-700"}`}>
              {dcfAgg.inCorso === attiva
                ? `Aggiornamento del DCF di ${nomeAttiva}: riclassificazioni, Redditività e solvibilità, Quality of Earnings…`
                : dcfAgg.msg && dcfAgg.msg.id === attiva
                  ? dcfAgg.msg.testo
                  : `Pro-forma e DCF di ${nomeAttiva}: «Aggiorna» ricalcola il DCF con i dati attuali della suite (riclassificazioni, Redditività e solvibilità, Quality of Earnings) e tiene le tue assunzioni.`}
            </span>
            <button onClick={() => aggiornaDcf(attiva)} disabled={!!dcfAgg.inCorso || stato === "in_corso" || !conRisultati(risultati)}
              title="Rilegge i dati delle fasi precedenti e ricalcola il DCF di questa azienda, riapplicando le assunzioni che hai impostato"
              className="px-3 py-1.5 rounded-md bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50">
              {dcfAgg.inCorso === attiva ? "Aggiornamento…" : "↻ Aggiorna il DCF"}
            </button>
          </div>
        </div>
        {dcfAziende.filter((id) => aziende.some((z) => z.id === id)).map((id) => (
          <iframe key={id} data-dcf-azienda={id} title={`Bilancio pro-forma e DCF · ${nomeDi(id)}`} srcDoc={paginaDcf} hidden={id !== attiva}
            style={{ width: "100%", height: "calc(100vh - 96px)", border: 0, display: id === attiva ? "block" : "none" }} />
        ))}
      </div>
      <div hidden={vista !== "CMP"}>
        {(() => {
          const nDati = aziende.filter((z) => conRisultati(vistaAzienda(z).risultati)).length;
          const mai = !cmp.aziende && !cmp.sessione;
          const avviso = cmpCambiata || (mai && nDati >= 2);
          return (
            <div className={`sticky top-[52px] z-30 border-b ${avviso ? "bg-amber-50 border-amber-200" : "bg-slate-100 border-slate-200"}`}>
              <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
                <span className={`flex-1 min-w-[16rem] ${avviso ? "text-amber-900" : "text-slate-700"}`}>
                  {nDati < 2
                    ? `Comparazione settoriale: servono almeno due aziende con riclassificazioni (ora ${nDati}). Aggiungile da «+ Aggiungi azienda» in Documenti, oppure caricane gli ZIP completi.`
                    : mai
                      ? `${nDati} aziende con dati. La comparazione non parte da sola: quando hai corretto i dati e calcolato i DCF, avviala da qui con i dati attuali della suite oppure trascina qui sotto lo ZIP della sessione.`
                      : cmp.zip
                        ? `Comparazione dallo ZIP ${cmp.zip}: riclassificazioni, Redditività, Quality of Earnings e DCF di ogni azienda.`
                      : cmpCambiata
                        ? "⚠ I dati delle aziende sono cambiati dopo l'ultimo passaggio alla comparazione (riclassificazioni, Redditività, QoE, DCF o aziende)."
                        : `Comparazione di ${nDati} aziende con i dati della suite: analisi di Redditività (o JSON di SP, CE e RF), Quality of Earnings e DCF esportato.`}
                </span>
                {nDati >= 2 && (
                  <button onClick={aggiornaComparazioneTutto} disabled={stato === "in_corso" || cmpRilettura}
                    title="Rilegge tutto: modifiche nelle schede SP, CE e RF, analisi di Redditività e solvibilità con i parametri compilati, Quality of Earnings con lo spread e il DCF di ogni azienda"
                    className={`px-3 py-1.5 rounded-md text-white text-sm font-semibold disabled:opacity-50 ${mai || cmpCambiata ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-700 hover:bg-slate-800"}`}>
                    {cmpRilettura ? "Rilettura in corso…" : mai ? "▶ Componi la comparazione" : "↻ Aggiorna la comparazione"}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <label
            onDragOver={(e) => { e.preventDefault(); if (!zipCmp.sopra) setZipCmp((z) => ({ ...z, sopra: true })); }}
            onDragLeave={() => setZipCmp((z) => ({ ...z, sopra: false }))}
            onDrop={(e) => { e.preventDefault(); caricaZipComparazione(e.dataTransfer?.files?.[0]); }}
            className={`block rounded-xl border-2 border-dashed px-4 py-4 text-center cursor-pointer transition ${zipCmp.sopra ? "border-indigo-500 bg-indigo-50" : "border-indigo-300 bg-white hover:bg-indigo-50/50"}`}>
            <input type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; caricaZipComparazione(f); }} />
            <div className="text-sm font-semibold text-indigo-900">
              {zipCmp.inCorso ? "⏳ Lettura dello ZIP…" : "📦 Trascina qui lo ZIP della sessione (con i DCF) o fai clic per sceglierlo"}
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Lo ZIP scaricato con «⬇ ZIP sessione» dopo aver calcolato i DCF: ogni azienda entra con riclassificazioni, Redditività,
              Quality of Earnings (con lo spread) e DCF. Sostituisce le aziende della comparazione; pesi e normalizzazioni restano.
            </div>
          </label>
          {zipCmp.msg && (
            <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${zipCmp.msg.tipo === "errore" ? "border-red-300 bg-red-50 text-red-800" : zipCmp.msg.tipo === "avviso" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
              <div className="font-semibold">{zipCmp.msg.testo}</div>
              {zipCmp.msg.righe?.length ? <ul className="mt-1 list-disc pl-5 text-xs">{zipCmp.msg.righe.map((r) => <li key={r}>{r}</li>)}</ul> : null}
              {zipCmp.msg.nota ? <div className="mt-1 text-xs">{zipCmp.msg.nota}</div> : null}
            </div>
          )}
        </div>
        <ComparazioneSettoriale key={`cmp-${cmp.versione}`} aziendeSuite={cmp.aziende} sessioneIniziale={cmp.sessione} apiRef={cmpApi} />
      </div>
    </div>
  );
}

const ETICHETTA_STATO = { attesa: "in attesa", in_corso: "in elaborazione", fatto: "fatto", avviso: "da controllare", errore: "non riuscito" };
function Pallino({ stato, piccolo }) {
  const colore = stato === "fatto" ? "bg-emerald-500" : stato === "avviso" ? "bg-amber-500" : stato === "errore" ? "bg-rose-500" : stato === "in_corso" ? "bg-indigo-500 animate-pulse" : "bg-slate-300";
  return <span className={`flex-none inline-block rounded-full ${piccolo ? "w-2 h-2" : "w-2.5 h-2.5"} ${colore}`} />;
}

function Scheda({ attiva, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm font-medium ${attiva ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}

function Slot({ file, obbligatorio, disabilitato, onScelta }) {
  const ref = useRef(null);
  const [sopra, setSopra] = useState(false);
  return (
    <div
      onClick={() => !disabilitato && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setSopra(true); }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => { e.preventDefault(); setSopra(false); const f = e.dataTransfer.files?.[0]; if (f && !disabilitato) onScelta(f); }}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 min-w-0 ${disabilitato ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${file ? "border-indigo-400 bg-white" : sopra ? "border-indigo-400 bg-indigo-50 border-dashed" : "border-dashed border-slate-300 bg-slate-50 hover:border-indigo-300"}`}>
      <span className={`flex-none w-6 h-6 rounded-full grid place-items-center text-xs ${file ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-400"}`}>
        {file ? "✓" : "+"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate">{file ? file.name : "Scegli o trascina un file"}</span>
        <span className="block text-xs text-slate-500">
          {file ? `${(file.size / 1048576).toFixed(1).replace(".", ",")} MB` : obbligatorio ? "Obbligatorio" : "Facoltativo"}
        </span>
      </span>
      {file && !disabilitato && (
        <button onClick={(e) => { e.stopPropagation(); onScelta(null); }} className="text-slate-400 hover:text-rose-600 px-1" aria-label="Rimuovi">✕</button>
      )}
      <input ref={ref} type="file" accept=".pdf,.txt,.md,.json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onScelta(f); e.target.value = ""; }} />
    </div>
  );
}
