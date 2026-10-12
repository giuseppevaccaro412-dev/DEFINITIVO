/**
 * ============================================================================
 *  ANALISI STRATEGICA ESTERNA E INTERNA — società registrate presso la SEC
 *  Fase 0 · Base informativa: acquisizione, lettura e instradamento dei documenti
 * ----------------------------------------------------------------------------
 *  Percorso dell'analisi (cap. 2-4 del testo di riferimento):
 *    Fase 0  Base informativa         → documenti letti, estratti, instradati
 *    Fase 1  Profilo e perimetro      → identità, modello di business, ASA, peer
 *    Fase 2  Analisi esterna          → PESTEL, ciclo di vita, 5 forze, FCS, O/M
 *    Fase 3  Analisi interna          → strategie, catena del valore, risorse, governance
 *    Fase 4  Verifica numerica        → «regola d'oro»: ogni affermazione ai numeri
 *    Fase 5  Coerenza e credibilità   → SWOT/TOWS, promesse vs realtà, narrativa vs numeri
 *    Fase 6  Sintesi e relazione Word → giudizio, assumption, relazione .docx
 *
 *  Tutte le fasi sono implementate. Regola comune: l'IA legge e propone, citando
 *  gli estratti; l'operatore conferma o corregge; indici, matrici, verifiche ed
 *  esiti sono calcolati dal sistema. Alle fasi successive e alla relazione Word
 *  passano solo le sezioni confermate.
 *
 *  Origine del codice: lettura dei PDF (suddivisione con pdf-lib), configurazione
 *  IA multi-provider, regolatore di ritmo, riprove e orchestratore per porzioni
 *  sono portati dalla Fase 0 di «Validazione e Qualità Contabile». Nuovi: lettura
 *  dei filing EDGAR in HTML, tassonomia dei temi strategici, entità (società
 *  analizzata + peer), dati XBRL «companyfacts», copertura e instradamento.
 *
 *  ORGANIZZAZIONE DEL FILE
 *    [0] design tokens e utilità
 *    [1] tassonomia: aree, tipi documento, temi, fasi, requisiti di copertura
 *    [2] lettura documenti: PDF a porzioni, HTML/testo a porzioni
 *    [3] configurazione IA, regolatore di ritmo, adattatori dei provider
 *    [4] prompt: filtro strategico, filtro dell'informazione derivata, frontespizio
 *    [5] estrazione per porzione e orchestratore per documento
 *    [6] consolidamento tra fonti, instradamento alle fasi, copertura
 *    [7] dati XBRL (SEC companyfacts)
 *    [8] stato (reducer)
 *    [9] salvataggio e ripristino
 *   [10] interfaccia della Fase 0
 *   [11] guscio dell'applicazione
 *   [12-13] Fase 1 · [14-15] Fase 2 · [16-17] Fase 3 · [18-19] Fase 4
 *   [20-21] Fase 5 · [22] Fase 6 · [23] relazione Word · [24] interfaccia Fase 6
 * ============================================================================
 */

import React, { useReducer, useRef, useState, useMemo, useCallback } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Building2, Check, ChevronDown, ChevronRight,
  Compass, Database, Globe, FileText, FolderOpen, GitBranch, Info, Languages, Layers, Lock, Plus,
  RefreshCw, Save, Search, Scale, Target, Trash2, Upload, Users, X, FileOutput, Newspaper,
} from "lucide-react";

/* ==========================================================================
   [0] DESIGN TOKENS E UTILITÀ
   Stessa famiglia visiva della suite di revisione: neutri freddi, colore usato
   come informazione. Qui il colore dice da quale livello informativo viene un
   dato — obbligatorio, volontario, derivato, di contesto, notizia.
   ========================================================================== */
const C = {
  fondo: "#E9ECEF",
  carta: "#FFFFFF",
  inchiostro: "#14171C",
  muto: "#69727D",
  riga: "#D2D7DD",
  rigaTenue: "#E8EBEF",
  annuale: "#0C6157",
  annualeTenue: "#E3F0EC",
  periodico: "#2F4B8F",
  periodicoTenue: "#E6EAF4",
  volontaria: "#8A6212",
  volontariaTenue: "#F5EEDC",
  derivata: "#7A4B86",
  derivataTenue: "#F0E9F3",
  contesto: "#3D6E8C",
  contestoTenue: "#E4EEF4",
  notizie: "#A3341F",
  notizieTenue: "#F6E7E2",
  ok: "#0C6157",
  okTenue: "#E3F0EC",
  allarme: "#A3341F",
  allarmeTenue: "#F6E7E2",
  ambra: "#8A6212",
  ambraTenue: "#F5EEDC",
};
const F = {
  display: "'Libre Franklin', system-ui, sans-serif",
  testo: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

const plurale = (n, singolare, plurale_) => `${n} ${n === 1 ? singolare : plurale_}`;
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const ora = () => new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const nuovoId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const idBreve = () => nuovoId().replace(/-/g, "").slice(0, 8);

/** Normalizzazione per i confronti di nomi: "Ferrari N.V." e "FERRARI NV" sono la stessa società. */
const normalizzaNome = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|n\.?v|s\.?p\.?a|s\.?a|ag|se|holdings?|group|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const stessoSoggetto = (a, b) => {
  const x = normalizzaNome(a), y = normalizzaNome(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y));
};

const fmtNumero = (v, cifre = 0) =>
  v === null || v === undefined || !isFinite(v) ? "—" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: cifre }).format(v);

/** Importi XBRL in milioni: le serie SEC sono in unità, illeggibili a schermo. */
const fmtMilioni = (v, unita) => {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (unita && !/^(USD|EUR|GBP|JPY|CHF|CAD|CNY|SEK|DKK|NOK|AUD|HKD|INR|BRL|KRW|TWD|MXN|ILS)$/i.test(unita)) return fmtNumero(v);
  return `${fmtNumero(v / 1e6, Math.abs(v) < 1e8 ? 1 : 0)}`;
};

/* ==========================================================================
   [1] TASSONOMIA
   ========================================================================== */

/**
 * LE FASI DELL'ANALISI — fonte unica di verità.
 * Ogni estratto viene instradato a una o più fasi in base al tema: la Fase 0
 * non decide che cosa significhi un frammento, decide soltanto a chi serve.
 */
const FASI_ANALISI = [
  { id: 0, occhiello: "Fase 0", titolo: "Base informativa", icona: Layers, pronta: true,
    descrizione: "Acquisizione dei documenti, lettura per porzioni, estrazione dei frammenti strategici e instradamento alle fasi successive." },
  { id: 1, occhiello: "Fase 1", titolo: "Profilo e perimetro", icona: Building2, pronta: true,
    descrizione: "Identità, modello di business su tre livelli, aree strategiche d'affari (ASA) e peer group." },
  { id: 2, occhiello: "Fase 2", titolo: "Analisi esterna", icona: Compass, pronta: true,
    descrizione: "PESTEL, ciclicità, ciclo di vita del settore e della tecnologia, 5 forze, fattori critici di successo, opportunità e minacce." },
  { id: 3, occhiello: "Fase 3", titolo: "Analisi interna", icona: Users, pronta: true,
    descrizione: "Corporate e competitive strategy, catena del valore, risorse e capitale intangibile (VRIO), governance e management." },
  { id: 4, occhiello: "Fase 4", titolo: "Verifica numerica", icona: BarChart3, pronta: true,
    descrizione: "La «regola d'oro»: ogni affermazione strategica confrontata con i KPI di bilancio, in serie storica e rispetto ai peer." },
  { id: 5, occhiello: "Fase 5", titolo: "Coerenza e credibilità", icona: Scale, pronta: true,
    descrizione: "SWOT e TOWS sui soli punti verificati, coerenza strategia-ambiente, promesse e realtà, narrativa e numeri." },
  { id: 6, occhiello: "Fase 6", titolo: "Sintesi e relazione", icona: FileOutput, pronta: true,
    descrizione: "Giudizio finale per ASA, assumption per i pro-forma in tre scenari, relazione Word con citazioni." },
];
const etichettaFase = (id) => FASI_ANALISI.find((f) => f.id === id)?.occhiello || `Fase ${id}`;

/**
 * AREE DI CARICAMENTO — i livelli informativi del cap. 2.
 * `rango` ordina l'attendibilità della fonte nel consolidamento: a parità di
 * informazione, quella depositata presso l'autorità di vigilanza fa da capofila.
 * `entitaPredefinita` dice a chi si attribuisce di norma un documento dell'area:
 * un filing appartiene a una società, uno studio di settore no.
 */
const AREE = [
  {
    layer: "annuali", label: "Filing annuali e societari", colore: C.annuale, tenue: C.annualeTenue, rango: 1,
    classe: "Primaria · obbligatoria", entitaPredefinita: "principale", filtro: "strategico",
    nota: "Il nucleo dell'analisi. 10-K / 20-F / 40-F degli ultimi 3-5 esercizi, proxy statement e prospetto. Trascina anche i file .htm scaricati da EDGAR: vengono letti come testo, senza conversione in PDF.",
    tipi: [
      { id: "10-K", label: "Form 10-K", nota: "Relazione annuale, società USA" },
      { id: "20-F", label: "Form 20-F", nota: "Relazione annuale, emittenti esteri" },
      { id: "40-F", label: "Form 40-F", nota: "Relazione annuale, emittenti canadesi" },
      { id: "DEF 14A", label: "DEF 14A", nota: "Proxy statement: board, remunerazione, peer group" },
      { id: "PROSPETTO", label: "Prospetto (S-1/F-1/424B)", nota: "Fattori di rischio, business, mercato" },
    ],
  },
  {
    layer: "periodici", label: "Filing periodici ed eventi", colore: C.periodico, tenue: C.periodicoTenue, rango: 2,
    classe: "Primaria · obbligatoria", entitaPredefinita: "principale", filtro: "strategico",
    nota: "Trimestrali, eventi rilevanti (8-K / 6-K), comunicati, assetti proprietari, lettere della SEC. Danno la dinamica recente e la cronologia degli eventi.",
    tipi: [
      { id: "10-Q", label: "Form 10-Q", nota: "Trimestrale, società USA" },
      { id: "6-K", label: "Form 6-K", nota: "Infrannuale ed eventi, emittenti esteri" },
      { id: "8-K", label: "Form 8-K", nota: "Evento rilevante" },
      { id: "PRESS RELEASE", label: "Comunicato stampa", nota: "Ex. 99.1 o comunicato della società" },
      { id: "ASSETTI", label: "SC 13D / 13G / Form 4", nota: "Soci rilevanti e operazioni degli insider" },
      { id: "CORRESP", label: "CORRESP / UPLOAD", nota: "Lettere di commento della SEC e risposte" },
      { id: "NT", label: "NT 10-K / NT 10-Q", nota: "Comunicazione di deposito tardivo" },
    ],
  },
  {
    layer: "volontaria", label: "Informazione volontaria", colore: C.volontaria, tenue: C.volontariaTenue, rango: 3,
    classe: "Primaria · volontaria", entitaPredefinita: "principale", filtro: "strategico",
    nota: "Ciò che il management sceglie di dire: presentazioni, Investor Day, trascrizioni delle conference call, report di sostenibilità. È qui che si trovano obiettivi e guidance da verificare.",
    tipi: [
      { id: "INVESTOR PRESENTATION", label: "Presentazione agli investitori", nota: "Risultati, Capital Markets Day" },
      { id: "PIANO STRATEGICO", label: "Piano strategico / Investor Day", nota: "Obiettivi e target pluriennali" },
      { id: "EARNINGS CALL", label: "Trascrizione conference call", nota: "Commento del management e domande degli analisti" },
      { id: "SOSTENIBILITA", label: "Report di sostenibilità", nota: "ESG, capitale umano, catena di fornitura" },
      { id: "SITO IR", label: "Pagine istituzionali / IR", nota: "Missione, valori, profilo" },
    ],
  },
  {
    layer: "derivata", label: "Informazione derivata", colore: C.derivata, tenue: C.derivataTenue, rango: 4,
    classe: "Derivata · terzi", entitaPredefinita: "principale", filtro: "derivato",
    nota: "Stime e giudizi di terzi: report degli analisti, consensus, rating. Ogni parametro viene estratto con la fonte e la data; il sell-side va letto sapendo del possibile conflitto d'interesse.",
    tipi: [
      { id: "ANALYST REPORT", label: "Report di analisti", nota: "Sell-side, indipendenti" },
      { id: "CONSENSUS", label: "Dati di consensus", nota: "Stime aggregate" },
      { id: "RATING", label: "Rapporto di rating", nota: "S&P, Moody's, Fitch e simili" },
    ],
  },
  {
    layer: "contesto", label: "Contesto: settore e macro-ambiente", colore: C.contesto, tenue: C.contestoTenue, rango: 5,
    classe: "Contesto esterno", entitaPredefinita: null, filtro: "strategico",
    nota: "Studi di settore, dati macroeconomici, normativa. Alimentano soprattutto la Fase 2: dimensione e crescita del mercato, struttura competitiva, PESTEL.",
    tipi: [
      { id: "INDUSTRY REPORT", label: "Studio di settore", nota: "Associazioni, centri studi, consulenza" },
      { id: "MACRO", label: "Dati macroeconomici", nota: "BEA, BLS, FRED, Census, FMI, OCSE" },
      { id: "NORMATIVA", label: "Normativa e regolamentazione", nota: "Autorità di settore, leggi, dazi" },
    ],
  },
  {
    layer: "notizie", label: "Notizie e rassegna stampa", colore: C.notizie, tenue: C.notizieTenue, rango: 6,
    classe: "Notizie", entitaPredefinita: "principale", filtro: "strategico",
    nota: "Articoli salvati in PDF o come pagina web. Ogni notizia viene datata e agganciata al tema strategico che tocca, per la cronologia degli eventi.",
    tipi: [{ id: "NOTIZIA", label: "Notizia / articolo", nota: "Stampa economica, agenzie" }],
  },
];

const TUTTI_I_TIPI = AREE.flatMap((a) => a.tipi.map((t) => ({ ...t, layer: a.layer })));
const areaDelLivello = (layer) => AREE.find((a) => a.layer === layer) || null;
const areaDelTipo = (idTipo) => AREE.find((a) => a.tipi.some((t) => t.id === idTipo)) || null;
const etichettaTipo = (idTipo) => TUTTI_I_TIPI.find((t) => t.id === idTipo)?.label || idTipo;
const LAYER_VALIDI = AREE.map((a) => a.layer);

/** Estensioni accettate: i filing EDGAR sono nativamente HTML. */
const RE_FILE_AMMESSI = /\.(pdf|html?|txt|md)$/i;
const formatoDaFile = (file) =>
  /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? "pdf"
    : /\.html?$/i.test(file.name) || file.type === "text/html" ? "html"
    : "testo";

/**
 * RICONOSCIMENTO DEL TIPO DAL NOME FILE.
 * I file scaricati da EDGAR hanno spesso nomi non parlanti ("aapl-20240928.htm"):
 * per l'HTML il riconoscimento vero avviene sulla testata del documento
 * (`riconosciTestata`), che è deterministica e non costa chiamate IA.
 * L'ordine conta: NT prima di 10-K, 10-Q prima di 10-K, DEF 14A prima dei generici.
 */
const PATTERN_TIPO = [
  { tipo: "NT", re: /(^|[^a-z])nt[\s._-]?10[\s._-]?[kq]|12b[\s._-]?25/i, motivo: "deposito tardivo (NT / 12b-25)" },
  { tipo: "10-Q", re: /(^|[^0-9])10[\s._-]?q($|[^a-z0-9])/i, motivo: "sigla 10-Q nel nome" },
  { tipo: "10-K", re: /(^|[^0-9])10[\s._-]?k($|[^a-z0-9])/i, motivo: "sigla 10-K nel nome" },
  { tipo: "20-F", re: /(^|[^0-9])20[\s._-]?f($|[^a-z0-9])/i, motivo: "sigla 20-F nel nome" },
  { tipo: "40-F", re: /(^|[^0-9])40[\s._-]?f($|[^a-z0-9])/i, motivo: "sigla 40-F nel nome" },
  { tipo: "6-K", re: /(^|[^0-9])6[\s._-]?k($|[^a-z0-9])/i, motivo: "sigla 6-K nel nome" },
  { tipo: "8-K", re: /(^|[^0-9])8[\s._-]?k($|[^a-z0-9])/i, motivo: "sigla 8-K nel nome" },
  { tipo: "DEF 14A", re: /def[\s._-]?14[\s._-]?a|proxy[\s._-]?statement|\bproxy\b/i, motivo: "proxy statement" },
  { tipo: "PROSPETTO", re: /(^|[^a-z])(s|f)[\s._-]?1($|[^0-9])|424b|prospectus|prospetto/i, motivo: "prospetto" },
  { tipo: "ASSETTI", re: /sc[\s._-]?13[dg]|schedule[\s._-]?13|form[\s._-]?4($|[^0-9])|beneficial[\s._-]?owner/i, motivo: "assetti proprietari" },
  { tipo: "CORRESP", re: /corresp|comment[\s._-]?letter|upload/i, motivo: "corrispondenza con la SEC" },
  { tipo: "EARNINGS CALL", re: /transcript|trascrizion|earnings[\s._-]?call|conference[\s._-]?call/i, motivo: "trascrizione di call" },
  { tipo: "PIANO STRATEGICO", re: /investor[\s._-]?day|capital[\s._-]?markets?[\s._-]?day|strategic[\s._-]?plan|piano[\s._-]?(industriale|strategico)|business[\s._-]?plan/i, motivo: "piano o giornata investitori" },
  { tipo: "INVESTOR PRESENTATION", re: /presentation|presentazione|slides?|deck/i, motivo: "presentazione" },
  { tipo: "SOSTENIBILITA", re: /sustainab|esg|csr|impact[\s._-]?report|sostenibil|10[\s._-]?k[\s._-]?esg/i, motivo: "report di sostenibilità" },
  { tipo: "RATING", re: /rating|moody|s&p|fitch|credit[\s._-]?opinion/i, motivo: "rating" },
  { tipo: "CONSENSUS", re: /consensus|estimates|stime[\s._-]?aggregate|visible[\s._-]?alpha|ibes|factset/i, motivo: "consensus" },
  { tipo: "ANALYST REPORT", re: /analyst|equity[\s._-]?research|initiation|price[\s._-]?target|broker|research[\s._-]?note/i, motivo: "ricerca di analisti" },
  { tipo: "INDUSTRY REPORT", re: /industry|settore|market[\s._-]?(report|study|outlook)|mercato/i, motivo: "studio di settore" },
  { tipo: "MACRO", re: /gdp|pil|inflation|inflazion|fred|bea|bls|imf|fmi|oecd|ocse|outlook[\s._-]?econom/i, motivo: "dati macro" },
  { tipo: "NORMATIVA", re: /regulat|normativ|federal[\s._-]?register|directive|direttiva|regolamento|tariff|dazi/i, motivo: "normativa" },
  { tipo: "PRESS RELEASE", re: /press[\s._-]?release|comunicato|ex[\s._-]?99|exhibit[\s._-]?99/i, motivo: "comunicato" },
  { tipo: "NOTIZIA", re: /news|notizia|articolo|reuters|bloomberg|wsj|ft\.com|cnbc/i, motivo: "notizia" },
  { tipo: "10-K", re: /annual[\s._-]?report/i, motivo: "relazione annuale" },
];

function riconosciTipoDaNome(nomeFile) {
  const nome = nomeFile.replace(/\.(pdf|html?|txt|md)$/i, "");
  for (const p of PATTERN_TIPO) if (p.re.test(nome)) return { tipo: p.tipo, confidenza: "media", motivo: p.motivo };
  return { tipo: null, confidenza: "nessuna", motivo: "nome file non parlante" };
}

/** Anno nel nome: "aapl-20240928.htm" → 2024. */
function annoDaNome(nomeFile) {
  const m8 = nomeFile.match(/(?:^|[^0-9])((?:19|20)\d{2})(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])(?:[^0-9]|$)/);
  if (m8) return m8[1];
  const m = nomeFile.match(/(19|20)\d{2}/g);
  return m ? m[m.length - 1] : null;
}

/**
 * RICONOSCIMENTO DALLA TESTATA DEL FILING (deterministico).
 * La copertina di un filing SEC dichiara il form ("FORM 10-K"), il periodo
 * ("For the fiscal year ended September 28, 2024") e la denominazione esatta
 * ("(Exact name of registrant as specified in its charter)"). Si cerca la
 * prima occorrenza fra i candidati nelle prime righe: un 10-Q cita il 10-K più
 * avanti nel testo, mai prima della propria intestazione.
 */
const CANDIDATI_TESTATA = [
  { tipo: "NT", re: /\bFORM\s+12b-25\b|\bNOTIFICATION OF LATE FILING\b/i },
  { tipo: "10-K", re: /\bFORM\s+10-K(?:\/A)?\b|\bANNUAL REPORT PURSUANT TO SECTION 13/i },
  { tipo: "10-Q", re: /\bFORM\s+10-Q(?:\/A)?\b|\bQUARTERLY REPORT PURSUANT TO SECTION 13/i },
  { tipo: "20-F", re: /\bFORM\s+20-F(?:\/A)?\b/i },
  { tipo: "40-F", re: /\bFORM\s+40-F\b/i },
  { tipo: "8-K", re: /\bFORM\s+8-K\b|\bCURRENT REPORT\s+PURSUANT TO SECTION 13/i },
  { tipo: "6-K", re: /\bFORM\s+6-K\b|\bREPORT OF FOREIGN PRIVATE ISSUER\b/i },
  { tipo: "DEF 14A", re: /\bSCHEDULE\s+14A\b|\bDEFINITIVE PROXY STATEMENT\b|\bNOTICE OF ANNUAL MEETING\b/i },
  { tipo: "ASSETTI", re: /\bSCHEDULE\s+13[DG]\b|\bSTATEMENT OF CHANGES IN BENEFICIAL OWNERSHIP\b/i },
  { tipo: "PROSPETTO", re: /\bFORM\s+[SF]-1\b|\bREGISTRATION STATEMENT UNDER THE SECURITIES ACT\b|\bPROSPECTUS\b/i },
];

const MESI_EN = "January|February|March|April|May|June|July|August|September|October|November|December";

function riconosciTestata(testo) {
  const testa = String(testo || "").slice(0, 12000);
  let migliore = null;
  for (const c of CANDIDATI_TESTATA) {
    const m = c.re.exec(testa);
    if (m && (!migliore || m.index < migliore.indice)) migliore = { tipo: c.tipo, indice: m.index, dicitura: m[0] };
  }
  const reData = new RegExp(`(?:fiscal year ended|quarterly period ended|period ended|year ended)\\s*:?\\s*((?:${MESI_EN})\\s+\\d{1,2},?\\s+((?:19|20)\\d{2}))`, "i");
  const mData = testa.match(reData);
  const reEvento = new RegExp(`Date of Report[^:]*:\\s*((?:${MESI_EN})\\s+\\d{1,2},?\\s+((?:19|20)\\d{2}))`, "i");
  const mEvento = testa.match(reEvento);
  const mNome = testa.match(/\n\s*([^\n|]{2,100}?)\s*\n[^\n]{0,20}\(\s*Exact name of registrant/i);
  return {
    tipo: migliore?.tipo || null,
    dicitura: migliore?.dicitura || null,
    periodo: mData ? mData[1] : mEvento ? mEvento[1] : null,
    anno: mData ? mData[2] : mEvento ? mEvento[2] : null,
    emittente: mNome ? mNome[1].replace(/\s+/g, " ").trim() : null,
  };
}

/**
 * TEMI STRATEGICI — il vocabolario chiuso dell'estrazione.
 * Ogni tema dichiara le fasi a cui serve: è la tabella di instradamento. Il
 * modello sceglie il tema; a quale fase arriva lo decide il codice, non l'IA.
 * `gruppo` serve alle riletture mirate sulle porzioni dense.
 */
const TEMI = {
  identita: { label: "Identità: missione, visione, valori", fasi: [1, 3], gruppo: "interno",
    desc: "missione, visione, valori, scopo dichiarato, codice etico, cultura aziendale" },
  modello_business: { label: "Modello di business", fasi: [1, 3], gruppo: "interno",
    desc: "che cosa vende e a chi, modello di ricavo (prodotto, servizio, abbonamento, licenza), canali, stagionalità, fonti del margine" },
  segmenti: { label: "Segmenti e ASA", fasi: [1, 4], gruppo: "numeri",
    desc: "segmenti operativi, ricavi, margini e attività per segmento, per area geografica o linea di prodotto (ASC 280 / IFRS 8)" },
  concorrenza: { label: "Concorrenza e posizionamento", fasi: [1, 2, 4], gruppo: "esterno",
    desc: "concorrenti nominati, quote di mercato, basi della competizione (prezzo, qualità, marchio, tecnologia), posizione competitiva dichiarata" },
  mercato_domanda: { label: "Mercato e domanda", fasi: [2], gruppo: "esterno",
    desc: "dimensione e crescita del mercato servito, mercato indirizzabile (TAM), trend della domanda, ciclicità, fase del ciclo di vita del settore" },
  contesto_politico_normativo: { label: "PESTEL · Politico-normativo", fasi: [2], gruppo: "esterno",
    desc: "regolamentazione di settore, autorizzazioni, dazi, sanzioni, incentivi, fiscalità, antitrust, stabilità politica dei paesi serviti" },
  contesto_economico: { label: "PESTEL · Economico", fasi: [2], gruppo: "esterno",
    desc: "PIL, inflazione, tassi d'interesse, cambi, prezzi delle materie prime, potere d'acquisto, sensibilità al ciclo economico" },
  contesto_sociale: { label: "PESTEL · Socio-culturale", fasi: [2], gruppo: "esterno",
    desc: "demografia, gusti e abitudini dei consumatori, valori, sensibilità dell'opinione pubblica, reputazione" },
  contesto_tecnologico: { label: "PESTEL · Tecnologico", fasi: [2, 3], gruppo: "esterno",
    desc: "innovazioni di settore, tecnologie emergenti o sostitutive, digitalizzazione, obsolescenza, ritmo dell'innovazione" },
  contesto_ambientale: { label: "PESTEL · Ambientale", fasi: [2], gruppo: "esterno",
    desc: "clima, disponibilità di risorse naturali, emissioni, transizione energetica, vincoli ambientali" },
  fornitori: { label: "Fornitori e approvvigionamento", fasi: [2, 3], gruppo: "esterno",
    desc: "fornitori chiave e loro concentrazione, fonte unica, materie prime critiche, dipendenze, catena di fornitura" },
  clienti: { label: "Clienti e canali", fasi: [2, 3], gruppo: "esterno",
    desc: "concentrazione dei clienti, clienti oltre il 10% dei ricavi, potere contrattuale, canali distributivi, fidelizzazione, costi di cambio" },
  barriere_sostituti: { label: "Barriere all'entrata e sostituti", fasi: [2], gruppo: "esterno",
    desc: "barriere all'entrata (capitale, licenze, brevetti, scala, rete), minaccia di nuovi entranti, prodotti sostitutivi, barriere all'uscita" },
  strategia: { label: "Strategia dichiarata", fasi: [3, 5], gruppo: "strategia",
    desc: "priorità strategiche, scelte competitive (costo, differenziazione, focus), espansione in nuovi mercati o prodotti, riposizionamenti" },
  crescita_esterna: { label: "M&A, alleanze, dismissioni", fasi: [3, 5], gruppo: "strategia",
    desc: "acquisizioni, joint venture, alleanze, partecipazioni, cessioni, integrazione verticale o orizzontale" },
  operations: { label: "Operations e catena del valore", fasi: [3], gruppo: "interno",
    desc: "produzione, impianti e loro capacità e utilizzo, esternalizzazione, logistica, efficienza, localizzazione" },
  innovazione: { label: "Ricerca, sviluppo e innovazione", fasi: [3, 4], gruppo: "interno",
    desc: "spese e progetti di R&S, pipeline di prodotti, brevetti e loro scadenze, licenze, tecnologie proprietarie" },
  capitale_umano: { label: "Capitale umano", fasi: [3, 4], gruppo: "interno",
    desc: "numero e categorie di dipendenti, turnover, sindacati, formazione, competenze chiave, persone chiave" },
  capitale_relazionale: { label: "Marchio e capitale relazionale", fasi: [3], gruppo: "interno",
    desc: "marchi, reputazione, partnership, rapporti con istituzioni, comunità e finanziatori" },
  governance: { label: "Governance e management", fasi: [3], gruppo: "interno",
    desc: "composizione e indipendenza del board, CEO e dirigenti, cambi al vertice, assetti proprietari, azionisti di controllo, parti correlate" },
  incentivi: { label: "Incentivi del management", fasi: [3, 5], gruppo: "interno",
    desc: "metriche e soglie a cui è legata la remunerazione variabile, peer group retributivo, piani azionari" },
  rischi: { label: "Fattori di rischio", fasi: [2, 3, 5], gruppo: "strategia",
    desc: "rischi dichiarati (strategici, competitivi, operativi, finanziari, legali, cyber), contenziosi rilevanti" },
  guidance: { label: "Guidance e obiettivi quantitativi", fasi: [5, 6], gruppo: "strategia",
    desc: "previsioni, target e obiettivi numerici con orizzonte temporale, aggiornamenti, conferme o ritiri della guidance" },
  kpi_operativi: { label: "KPI operativi e non finanziari", fasi: [4], gruppo: "numeri",
    desc: "volumi, unità consegnate, clienti, prezzi medi, ARPU, tasso di abbandono, portafoglio ordini, utilizzo della capacità" },
  politica_finanziaria: { label: "Politica finanziaria e allocazione del capitale", fasi: [3, 4], gruppo: "strategia",
    desc: "investimenti e capex programmati, dividendi, riacquisto di azioni, indebitamento e scadenze, linee di credito, liquidità" },
  controlli_revisione: { label: "Revisione e controlli", fasi: [5], gruppo: "numeri",
    desc: "giudizio del revisore, critical audit matters, debolezze del controllo interno, cambio di revisore, restatement, rilievi della SEC" },
  eventi: { label: "Eventi rilevanti", fasi: [5], gruppo: "numeri",
    desc: "fatti datati di rilievo: contratti, annunci, uscite di dirigenti, incidenti, sanzioni, esiti di contenziosi" },
};
const ID_TEMI = Object.keys(TEMI);

const GRUPPI_TEMATICI = [
  { id: "esterno", label: "ambiente esterno: mercato, PESTEL, 5 forze" },
  { id: "interno", label: "risorse interne: business, operations, persone, governance" },
  { id: "strategia", label: "strategia, M&A, rischi, guidance, allocazione del capitale" },
  { id: "numeri", label: "segmenti, KPI, revisione, eventi" },
].map((g) => ({ ...g, temi: ID_TEMI.filter((t) => TEMI[t].gruppo === g.id) }));

/** Natura dell'affermazione: decide che cosa ne farà la Fase 4 o la Fase 5. */
const NATURE = {
  fatto: { label: "Fatto", nota: "Dato o evento accaduto e verificabile" },
  affermazione: { label: "Affermazione", nota: "Giudizio del management su sé stesso: da verificare sui numeri (Fase 4)" },
  previsione: { label: "Previsione", nota: "Obiettivo, guidance o intenzione: da confrontare con il consuntivo (Fase 5)" },
  rischio: { label: "Rischio", nota: "Incertezza o fattore di rischio dichiarato" },
};

const SOGGETTI = {
  societa: "Società",
  concorrente: "Concorrente",
  settore: "Settore",
  macro: "Macro-ambiente",
};

/** Metriche dell'informazione derivata: un vocabolario separato dai temi, perché
 *  una stima di terzi non deve mai essere confusa con un fatto dichiarato. */
const METRICHE = {
  target_price: { label: "Target price", unita: "valuta", fasi: [5, 6] },
  raccomandazione: { label: "Raccomandazione", unita: "testo", fasi: [5, 6] },
  rating_credito: { label: "Rating di credito", unita: "testo", fasi: [5, 6] },
  stima_ricavi: { label: "Stima dei ricavi", unita: "valuta", fasi: [5, 6] },
  stima_margine: { label: "Stima di margine (EBITDA/EBIT)", unita: "%", fasi: [5, 6] },
  stima_utile: { label: "Stima di utile / EPS", unita: "valuta", fasi: [5, 6] },
  crescita_attesa: { label: "Crescita attesa", unita: "%", fasi: [5, 6] },
  quota_mercato: { label: "Quota di mercato", unita: "%", fasi: [2, 4] },
  dimensione_mercato: { label: "Dimensione del mercato", unita: "valuta", fasi: [2] },
  crescita_mercato: { label: "Crescita del mercato", unita: "%", fasi: [2] },
  multiplo: { label: "Multiplo di valutazione", unita: "x", fasi: [4, 6] },
  giudizio_strategico: { label: "Giudizio strategico", unita: "testo", fasi: [2, 3, 5] },
};
const PERIMETRI = { societa: "Società", peer: "Peer group", settore: "Settore", mercato: "Mercato / macro" };
const POLARITA = { forza: "Punto di forza", debolezza: "Punto di debolezza", opportunita: "Opportunità", minaccia: "Minaccia", neutra: "Neutra" };

/**
 * REQUISITI DI COPERTURA — che cosa serve e che cosa resta scoperto se manca.
 * È la checklist della Fase 0: l'analisi può partire anche incompleta, ma ogni
 * lacuna va detta con la sua conseguenza, non scoperta tre fasi più avanti.
 */
const REQUISITI = [
  { id: "annuali", label: "Relazioni annuali (10-K / 20-F / 40-F)", tipi: ["10-K", "20-F", "40-F"], minimo: 3, essenziale: true, fasi: [1, 2, 3, 4, 5],
    seManca: "Senza almeno tre esercizi non si leggono le tendenze: ciclo di vita, coerenza dei margini e track record restano non valutabili." },
  { id: "xbrl", label: "Dati XBRL (companyfacts)", speciale: "xbrl", minimo: 3, essenziale: true, fasi: [4],
    seManca: "La verifica numerica dovrà basarsi solo sui numeri citati nel testo, più fragili e meno completi delle serie XBRL." },
  { id: "periodici", label: "Trimestrali recenti (10-Q / 6-K)", tipi: ["10-Q", "6-K"], minimo: 2, fasi: [4, 5],
    seManca: "La dinamica dell'ultimo anno non è osservabile: il giudizio si ferma all'ultima chiusura annuale." },
  { id: "proxy", label: "Proxy statement (DEF 14A)", tipi: ["DEF 14A"], minimo: 1, fasi: [3, 5],
    seManca: "Governance e incentivi del management restano parziali; si perde il peer group retributivo, che nomina i concorrenti scelti dal board.",
    soloUsa: true },
  { id: "eventi", label: "Eventi e comunicati (8-K / 6-K / comunicati)", tipi: ["8-K", "6-K", "PRESS RELEASE"], minimo: 2, fasi: [5],
    seManca: "Manca la cronologia degli eventi: cambi al vertice, acquisizioni e guidance trimestrali non entrano nel confronto promesse-realtà." },
  { id: "presentazioni", label: "Presentazioni o piano strategico", tipi: ["INVESTOR PRESENTATION", "PIANO STRATEGICO"], minimo: 1, fasi: [3, 5, 6],
    seManca: "Senza piano o presentazioni le assumption saranno solo estrapolate dalla storia (§4.1): affidabilità ridotta." },
  { id: "transcript", label: "Trascrizioni delle conference call", tipi: ["EARNINGS CALL"], minimo: 1, fasi: [3, 5],
    seManca: "Mancano le domande degli analisti, che rivelano i punti deboli percepiti dal mercato, e la guidance verbale." },
  { id: "analisti", label: "Report di analisti o consensus", tipi: ["ANALYST REPORT", "CONSENSUS", "RATING"], minimo: 1, fasi: [5, 6],
    seManca: "Nessun confronto fra consensus e guidance: non si sa se il mercato è più ottimista o più prudente del management." },
  { id: "settore", label: "Studi di settore", tipi: ["INDUSTRY REPORT"], minimo: 1, ambito: "contesto", fasi: [2],
    seManca: "Dimensione, crescita e struttura del mercato verranno ricavate solo da ciò che dice la società: fonte non indipendente." },
  { id: "macro", label: "Macro-ambiente e normativa", tipi: ["MACRO", "NORMATIVA"], minimo: 1, ambito: "contesto", fasi: [2],
    seManca: "La PESTEL poggerà su quanto riportato nei Risk Factors, senza un riscontro esterno." },
  { id: "notizie", label: "Notizie degli ultimi 12-24 mesi", tipi: ["NOTIZIA"], minimo: 3, ambito: "tutte", fasi: [2, 5],
    seManca: "Gli eventi recenti non documentati nei filing restano fuori dalla cronologia." },
  { id: "peer", label: "Peer con almeno una relazione annuale", speciale: "peer", minimo: 3, fasi: [1, 2, 4],
    seManca: "Senza bilanci dei concorrenti la posizione competitiva non è misurabile: quote, premi di margine e gruppi strategici restano dichiarati." },
];

/* ==========================================================================
   [2] LETTURA DEI DOCUMENTI
   --------------------------------------------------------------------------
   Due strade, una sola forma in uscita: un elenco di porzioni.
     · PDF → taglio reale per pagine con pdf-lib (portato dalla suite QoE);
     · HTML/testo → conversione in testo pulito e taglio per caratteri.
   L'HTML è la forma nativa dei filing EDGAR: convertirlo in PDF per poi
   rileggerlo come immagine sarebbe solo spreco. Il testo costa una frazione dei
   token e conserva le intestazioni «Item» che servono all'instradamento.
   ========================================================================== */

const BYTE_STIMATI_PER_PAGINA = 45_000;

/** Più il documento è lungo, più le porzioni sono piccole: una porzione troppo
 *  grande satura la risposta e il modello «sceglie» che cosa riportare. */
function pianificaSuddivisione(nPagine) {
  if (nPagine <= 25) return { paginePerBlocco: 12, sovrapposizione: 0, passateTematiche: false, profilo: "documento breve" };
  if (nPagine <= 120) return { paginePerBlocco: 12, sovrapposizione: 1, passateTematiche: false, profilo: "documento medio" };
  if (nPagine <= 400) return { paginePerBlocco: 10, sovrapposizione: 2, passateTematiche: true, profilo: "documento lungo" };
  return { paginePerBlocco: 8, sovrapposizione: 2, passateTematiche: true, profilo: "documento molto lungo" };
}

const uint8ArrayToBase64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

function caricaPdfLib() {
  if (typeof window === "undefined") return Promise.reject(new Error("pdf-lib richiede un browser"));
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (window.__pdfLibPromise) return window.__pdfLibPromise;
  window.__pdfLibPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    s.onload = () => (window.PDFLib ? res(window.PDFLib) : rej(new Error("Libreria PDF non disponibile")));
    s.onerror = () => { window.__pdfLibPromise = null; rej(new Error("Impossibile caricare la libreria di suddivisione PDF")); };
    document.head.appendChild(s);
  });
  return window.__pdfLibPromise;
}

/** Ripiego dichiarato: se pdf-lib non si carica il documento viaggia intero, e
 *  ogni porzione lo dice con `stimato: true`. Un ripiego silenzioso è ciò che
 *  nella suite QoE aveva reso irriconoscibile il problema la prima volta. */
async function suddividiPdfStimato(file, motivo) {
  const buffer = await file.arrayBuffer();
  const nPagine = Math.max(1, Math.round(buffer.byteLength / BYTE_STIMATI_PER_PAGINA));
  const piano = pianificaSuddivisione(nPagine);
  return [{
    indice: 1, totale: 1, formato: "pdf", paginaIniziale: 1, paginaFinale: nPagine, paginaSovrapposta: null,
    base64: uint8ArrayToBase64(new Uint8Array(buffer)), stimato: true, motivoStima: motivo, piano,
  }];
}

async function suddividiPdf(file) {
  let PDFDocument;
  try { ({ PDFDocument } = await caricaPdfLib()); }
  catch (e) { return suddividiPdfStimato(file, e?.message || "libreria non disponibile"); }

  let origine, nPagine;
  try {
    origine = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    nPagine = origine.getPageCount();
  } catch (e) {
    return suddividiPdfStimato(file, `PDF non apribile per il taglio (${e?.message || e})`);
  }

  const piano = pianificaSuddivisione(nPagine);
  const passo = Math.max(1, piano.paginePerBlocco - piano.sovrapposizione);
  const blocchi = [];
  for (let da = 0; da < nPagine; da += passo) {
    const a = Math.min(da + piano.paginePerBlocco, nPagine);
    const nuovo = await PDFDocument.create();
    const pagine = await nuovo.copyPages(origine, Array.from({ length: a - da }, (_, k) => da + k));
    pagine.forEach((pg) => nuovo.addPage(pg));
    blocchi.push({
      indice: blocchi.length + 1, totale: 0, formato: "pdf",
      paginaIniziale: da + 1, paginaFinale: a,
      paginaSovrapposta: da > 0 ? da + piano.sovrapposizione : null,
      base64: uint8ArrayToBase64(await nuovo.save()), stimato: false, piano,
    });
    if (a >= nPagine) break;
  }
  return blocchi.map((b) => ({ ...b, totale: blocchi.length }));
}

/**
 * HTML → TESTO PULITO.
 * Un 10-K inline XBRL contiene, nascosto in testa, l'intero blocco dei fatti
 * contabili (`ix:header`): centinaia di migliaia di caratteri senza una parola
 * di prosa. Va tolto prima di tutto, insieme a script, stili ed elementi
 * nascosti. Le celle di tabella restano separate da « | » perché una tabella
 * di segmenti appiattita senza separatori diventa una fila di numeri senza
 * colonne.
 */
function htmlInTesto(html) {
  let s = String(html || "");
  s = s.replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ");
  s = s.replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]+style\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/[a-z]+>/gi, " ");
  s = s.replace(/<\/t[dh]\s*>/gi, " | ");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|title)\s*>/gi, "\n");
  let testo;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(`<body>${s}</body>`, "text/html");
    testo = doc.body ? doc.body.textContent || "" : "";
  } else {
    testo = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  return testo
    .replace(/ /g, " ")
    .split("\n")
    .map((r) => r.replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+$/g, "").replace(/^(\s*\|\s*)+/g, "").trim())
    .filter((r, i, arr) => r || (arr[i - 1] && arr[i - 1].trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function leggiTestoDaFile(file) {
  const grezzo = await file.text();
  return formatoDaFile(file) === "html" ? htmlInTesto(grezzo) : grezzo.replace(/\r\n?/g, "\n");
}

/** Intestazioni di sezione dei filing: «PART II», «Item 1A. Risk Factors». */
const RE_INTESTAZIONE = /^\s*(PART\s+[IVX]+\b[^\n]{0,60}|ITEM\s+\d{1,2}[A-D]?(?:\.\d)?\s*[.:—–-]?\s*[^\n]{0,90})$/i;

function mappaSezioni(testo) {
  const sezioni = [];
  let pos = 0;
  for (const riga of testo.split("\n")) {
    if (riga.length < 140 && RE_INTESTAZIONE.test(riga)) sezioni.push({ pos, titolo: riga.replace(/\s*\|\s*/g, " ").trim().slice(0, 100) });
    pos += riga.length + 1;
  }
  return sezioni;
}

const CARATTERI_PER_BLOCCO = 45_000;
const CARATTERI_SOVRAPPOSTI = 1_500;

/**
 * Taglio del testo in porzioni a confine di riga, con sovrapposizione: una
 * tabella o un paragrafo a cavallo del taglio resta integro almeno in una delle
 * due porzioni. Ogni porzione sa in quale sezione comincia e quali intestazioni
 * contiene: il modello lo riceve nel prompt e la citazione lo conserva.
 */
function suddividiTesto(testo) {
  const sezioni = mappaSezioni(testo);
  const blocchi = [];
  const n = testo.length;
  const piano = {
    paginePerBlocco: null, sovrapposizione: CARATTERI_SOVRAPPOSTI,
    passateTematiche: n > 400_000, profilo: n > 400_000 ? "testo lungo" : n > 120_000 ? "testo medio" : "testo breve",
  };
  let da = 0;
  while (da < n) {
    let a = Math.min(n, da + CARATTERI_PER_BLOCCO);
    if (a < n) {
      const acapo = testo.lastIndexOf("\n", a);
      if (acapo > da + CARATTERI_PER_BLOCCO * 0.6) a = acapo;
    }
    const dentro = sezioni.filter((s) => s.pos >= da && s.pos < a).map((s) => s.titolo);
    const precedente = [...sezioni].reverse().find((s) => s.pos < da);
    blocchi.push({
      indice: blocchi.length + 1, totale: 0, formato: "testo",
      caratteriDa: da, caratteriA: a, testo: testo.slice(da, a),
      sezioneIniziale: precedente ? precedente.titolo : null,
      sezioniContenute: Array.from(new Set(dentro)).slice(0, 25),
      sovrapposto: da > 0, piano,
    });
    if (a >= n) break;
    da = Math.max(a - CARATTERI_SOVRAPPOSTI, da + 1);
  }
  return blocchi.map((b) => ({ ...b, totale: blocchi.length }));
}

/** Porzioni pronte per l'estrazione, qualunque sia il formato del file. */
async function preparaBlocchi(file) {
  if (formatoDaFile(file) === "pdf") return { blocchi: await suddividiPdf(file), testo: null };
  const testo = await leggiTestoDaFile(file);
  if (!testo.trim()) throw new Error("il file non contiene testo leggibile");
  return { blocchi: suddividiTesto(testo), testo };
}

/** Contenuto da inviare al modello per una porzione: documento o testo. */
function contenutoBlocco(blocco) {
  if (blocco.formato === "pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: blocco.base64 } };
  }
  return { type: "text", text: `<<<INIZIO TESTO DELLA PORZIONE>>>\n${blocco.testo}\n<<<FINE TESTO DELLA PORZIONE>>>` };
}

/* ==========================================================================
   [3] CONFIGURAZIONE IA — provider, chiavi, regolatore di ritmo, riprove
   --------------------------------------------------------------------------
   Portato senza modifiche di sostanza dalla suite QoE: lo stesso file deve
   funzionare incollato in un artifact (chiamata diretta autenticata
   dall'ambiente) e pubblicato su Vercel/Railway (proxy /api/anthropic).
   Niente `import.meta`: romperebbe il parsing fuori da un modulo ES.
   ========================================================================== */

const ENDPOINT_API_DIRETTA = "https://api.anthropic.com/v1/messages";

const rilevaEndpointClaude = () => {
  /* eslint-disable-next-line no-undef */
  if (typeof __CLAUDE_ENDPOINT__ === "string" && __CLAUDE_ENDPOINT__) return __CLAUDE_ENDPOINT__;
  if (typeof window !== "undefined") {
    const manuale = window.__CLAUDE_ENDPOINT__;
    if (typeof manuale === "string" && manuale) return manuale;
    const host = (window.location && window.location.hostname) || "";
    if (/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(host)) return ENDPOINT_API_DIRETTA;
  }
  return "/api/anthropic";
};
const CLAUDE_ENDPOINT = rilevaEndpointClaude();
const CLAUDE_DIRETTO = CLAUDE_ENDPOINT === ENDPOINT_API_DIRETTA;

const headerClaude = (apiKey) => {
  const chiave = apiKey && apiKey !== "__subscription__" ? apiKey : null;
  if (!chiave) return { "Content-Type": "application/json" };
  return CLAUDE_DIRETTO
    ? { "Content-Type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : { "Content-Type": "application/json", "x-user-key": chiave };
};

const MODELLI_PREDEFINITI = { claude: "claude-sonnet-4-6", openai: "gpt-4o-mini", gemini: "gemini-2.0-flash" };
const CHIAVE_LOCALSTORAGE_IA = "strategica_config_ia";
const configIA = { provider: "claude", chiavi: { claude: "", openai: "", gemini: "" }, modelli: { ...MODELLI_PREDEFINITI } };

function ripristinaConfigIA() {
  try {
    const grezzo = typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(CHIAVE_LOCALSTORAGE_IA) : null;
    if (grezzo) {
      const s = JSON.parse(grezzo);
      if (s.provider && MODELLI_PREDEFINITI[s.provider]) configIA.provider = s.provider;
      configIA.chiavi = { claude: "", openai: "", gemini: "", ...(s.chiavi || {}) };
      configIA.modelli = { ...MODELLI_PREDEFINITI, ...(s.modelli || {}) };
    }
  } catch { /* archivio illeggibile: valgono i predefiniti */ }
  return { ...configIA, chiavi: { ...configIA.chiavi }, modelli: { ...configIA.modelli } };
}

function impostaConfigIA(parziale) {
  if (parziale.provider) configIA.provider = parziale.provider;
  if (parziale.chiavi) configIA.chiavi = { ...configIA.chiavi, ...parziale.chiavi };
  if (parziale.modelli) configIA.modelli = { ...configIA.modelli, ...parziale.modelli };
  try { window.localStorage.setItem(CHIAVE_LOCALSTORAGE_IA, JSON.stringify(configIA)); } catch { /* sessione corrente */ }
  return { ...configIA, chiavi: { ...configIA.chiavi }, modelli: { ...configIA.modelli } };
}

function dimenticaConfigIA() {
  configIA.provider = "claude";
  configIA.chiavi = { claude: "", openai: "", gemini: "" };
  configIA.modelli = { ...MODELLI_PREDEFINITI };
  try { window.localStorage.removeItem(CHIAVE_LOCALSTORAGE_IA); } catch { /* niente */ }
  return { ...configIA, chiavi: { ...configIA.chiavi }, modelli: { ...configIA.modelli } };
}

const chiaveCorrente = () => (configIA.provider === "claude" ? configIA.chiavi.claude || "__subscription__" : configIA.chiavi[configIA.provider] || "");
ripristinaConfigIA();

/* Regolatore di ritmo: serializza, distanzia, si adatta. Su un 10-K da 40
   porzioni le chiamate lanciate senza ritmo saturano il limite di token al
   minuto nelle prime porzioni e non si ricompongono più da sole. */
const INTERVALLO_BASE_IA = 1200;
const INTERVALLO_MAX_IA = 45000;
const SUCCESSI_PER_ACCELERARE = 4;
const ritmoIA = { intervallo: INTERVALLO_BASE_IA, ultimaPartenza: 0, coda: Promise.resolve(), successi: 0 };

function segnalaCongestione() {
  ritmoIA.successi = 0;
  ritmoIA.intervallo = Math.min(INTERVALLO_MAX_IA, Math.max(2000, Math.round(ritmoIA.intervallo * 2)));
}
function segnalaSuccesso() {
  ritmoIA.successi++;
  if (ritmoIA.successi >= SUCCESSI_PER_ACCELERARE && ritmoIA.intervallo > INTERVALLO_BASE_IA) {
    ritmoIA.successi = 0;
    ritmoIA.intervallo = Math.max(INTERVALLO_BASE_IA, Math.round(ritmoIA.intervallo * 0.7));
  }
}
function inCodaIA(fn) {
  const mia = ritmoIA.coda.then(async () => {
    const daAspettare = ritmoIA.intervallo - (Date.now() - ritmoIA.ultimaPartenza);
    if (daAspettare > 0) await attesa(daAspettare);
    ritmoIA.ultimaPartenza = Date.now();
    return fn();
  });
  ritmoIA.coda = mia.then(() => {}, () => {});
  return mia;
}

const STATI_RIPROVABILI = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
/* Non tutti i 429 sono congestione: credito esaurito o contesto lungo non
   abilitato non passano aspettando, e vanno detti subito. */
const SEGNI_DI_ABILITAZIONE = ["credit", "spend limit", "long context", "billing", "quota", "payment", "insufficient", "not allowed", "permission", "plan does not"];

async function erroreDaRisposta(res, etichetta) {
  let dettaglio = "";
  try {
    const grezzo = await res.text();
    try { const j = JSON.parse(grezzo); dettaglio = j?.error?.message || j?.errore || grezzo.slice(0, 300); }
    catch { dettaglio = grezzo.slice(0, 300); }
  } catch { /* corpo non leggibile */ }
  const err = new Error(`${etichetta} ${res.status}${dettaglio ? ` — ${dettaglio}` : ""}`);
  err.stato = res.status;
  err.riprovabile = STATI_RIPROVABILI.has(res.status);
  if ([402, 403, 429].includes(res.status) && SEGNI_DI_ABILITAZIONE.some((s) => dettaglio.toLowerCase().includes(s))) {
    err.riprovabile = false;
    err.definitivo = true;
  }
  if (res.status === 400 || res.status === 401 || res.status === 404) err.definitivo = true;
  const suggerita = Number(res.headers?.get?.("retry-after"));
  if (isFinite(suggerita) && suggerita > 0) err.attesaSuggerita = Math.min(90000, suggerita * 1000);
  return err;
}
function erroreDiRete(e) {
  const err = new Error(`rete non raggiungibile (${e.message})`);
  err.riprovabile = true;
  return err;
}

/* OpenAI non legge il PDF grezzo: le pagine diventano immagini nel browser. */
const PDFJS_VER = "3.11.174";
function caricaPdfJs() {
  if (window.pdfjsLib && window.__pdfJsPronto) return Promise.resolve(window.pdfjsLib);
  if (window.__pdfJsPromise) return window.__pdfJsPromise;
  window.__pdfJsPromise = new Promise((res, rej) => {
    const avvia = () => {
      const lib = window.pdfjsLib;
      if (!lib) return rej(new Error("Libreria pdf.js non disponibile"));
      const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;
      try { lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: "application/javascript" })); }
      catch { lib.GlobalWorkerOptions.workerSrc = workerUrl; }
      window.__pdfJsPronto = true;
      res(lib);
    };
    if (window.pdfjsLib) return avvia();
    const s = document.createElement("script");
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
    s.onload = avvia;
    s.onerror = () => { window.__pdfJsPromise = null; rej(new Error("Impossibile caricare pdf.js")); };
    document.head.appendChild(s);
  });
  return window.__pdfJsPromise;
}

async function pdfInImmagini(base64) {
  const lib = await caricaPdfJs();
  const bin = atob(base64);
  const dati = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) dati[i] = bin.charCodeAt(i);
  const doc = await lib.getDocument({ data: dati, isEvalSupported: false }).promise;
  const parti = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const pagina = await doc.getPage(i);
      const base = pagina.getViewport({ scale: 1 });
      const viewport = pagina.getViewport({ scale: Math.min(3, Math.max(1, 1000 / base.width)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      let url = "";
      for (const q of [0.82, 0.65, 0.5, 0.38]) { url = canvas.toDataURL("image/jpeg", q); if (url.length * 0.75 <= 420 * 1024) break; }
      parti.push({ type: "text", text: `— Pagina ${i} della porzione —` });
      parti.push({ type: "image_url", image_url: { url, detail: "high" } });
      canvas.width = 0; canvas.height = 0;
    }
  } finally { if (doc.destroy) await doc.destroy(); }
  return parti;
}

async function eseguiClaude({ system, blocchi, maxTokens, apiKey, model }) {
  let res;
  try {
    res = await fetch(CLAUDE_ENDPOINT, {
      method: "POST", headers: headerClaude(apiKey),
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: blocchi }] }),
    });
  } catch (e) { throw erroreDiRete(e); }
  if (!res.ok) throw await erroreDaRisposta(res, "Claude");
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

async function eseguiOpenAI({ system, blocchi, maxTokens, apiKey, model }) {
  const parti = [];
  for (const b of blocchi) {
    if (b.type === "document" && b.source?.data) parti.push(...(await pdfInImmagini(b.source.data)));
    else if (b.type === "text") parti.push({ type: "text", text: b.text });
  }
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: parti }] }),
    });
  } catch (e) { throw erroreDiRete(e); }
  if (!res.ok) throw await erroreDaRisposta(res, "OpenAI");
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function eseguiGemini({ system, blocchi, maxTokens, apiKey, model }) {
  const parti = blocchi.map((b) =>
    b.type === "document" && b.source?.data ? { inline_data: { mime_type: "application/pdf", data: b.source.data } }
      : b.type === "text" ? { text: b.text } : null).filter(Boolean);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: parti }], ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), generationConfig: { maxOutputTokens: maxTokens } }),
    });
  } catch (e) { throw erroreDiRete(e); }
  if (!res.ok) throw await erroreDaRisposta(res, "Gemini");
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

async function eseguiChiamataIA({ system, contenuto, maxTokens }) {
  const provider = configIA.provider;
  const apiKey = chiaveCorrente();
  const model = configIA.modelli[provider] || MODELLI_PREDEFINITI[provider];
  const blocchi = typeof contenuto === "string" ? [{ type: "text", text: contenuto }] : contenuto;
  if (provider !== "claude" && !apiKey) {
    const err = new Error(`Chiave API mancante per ${provider}: inserirla in «Configurazione IA» oppure selezionare Claude.`);
    err.definitivo = true;
    throw err;
  }
  const argomenti = { system, blocchi, maxTokens, apiKey, model };
  if (provider === "openai") return eseguiOpenAI(argomenti);
  if (provider === "gemini") return eseguiGemini(argomenti);
  return eseguiClaude(argomenti);
}

async function chiamataIA({ system, contenuto, maxTokens = 4000, tentativi = 5 }) {
  let ultimo = null;
  for (let t = 0; t <= tentativi; t++) {
    try {
      const testo = await inCodaIA(() => eseguiChiamataIA({ system, contenuto, maxTokens }));
      segnalaSuccesso();
      return testo;
    } catch (err) {
      ultimo = err;
      if (!err.riprovabile || t === tentativi) break;
      segnalaCongestione();
      const base = err.attesaSuggerita ?? Math.min(60000, 2000 * 2 ** t);
      await attesa(Math.round(base * (0.75 + Math.random() * 0.5)));
    }
  }
  throw ultimo;
}

/** JSON robusto: tollera recinti markdown e testo prima o dopo l'oggetto. */
function parseJsonRobusto(testo) {
  const pulito = String(testo || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(pulito); } catch { /* sotto */ }
  const i = pulito.indexOf("{");
  if (i < 0) return null;
  let profondita = 0, inStringa = false, escape = false;
  for (let k = i; k < pulito.length; k++) {
    const ch = pulito[k];
    if (inStringa) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStringa = false;
      continue;
    }
    if (ch === '"') inStringa = true;
    else if (ch === "{") profondita++;
    else if (ch === "}") {
      profondita--;
      if (profondita === 0) { try { return JSON.parse(pulito.slice(i, k + 1)); } catch { return null; } }
    }
  }
  return null;
}

/* ==========================================================================
   [4] PROMPT
   ========================================================================== */

const ELENCO_TEMI_PROMPT = ID_TEMI.map((id) => `- ${id}: ${TEMI[id].desc}`).join("\n");

const SYSTEM_FILTRO_STRATEGICO = `Sei un filtro di estrazione documentale per l'ANALISI STRATEGICA di una società
(analisi esterna del contesto e analisi interna delle strategie). Non sei un analista:
non commenti, non valuti, non riassumi. Estrai frammenti letterali, li classifichi e li traduci.

COSA CONSERVARE
Tutto ciò che descrive l'ambiente in cui l'impresa compete e le scelte con cui compete.
A differenza di un'estrazione contabile, qui la descrizione del business, dei mercati,
dei prodotti, dei clienti e dei concorrenti è materiale PRIMARIO, non da scartare.
Temi ammessi (usa solo questi identificativi):
${ELENCO_TEMI_PROMPT}

COSA SCARTARE
Indici e sommari, caselle di spunta della copertina, avvertenze «safe harbor» e
dichiarazioni forward-looking generiche (ma CONSERVA gli obiettivi concreti che contengono),
firme, elenchi degli allegati, definizioni di glossario, formule di rito legali, dati di
mercato del titolo privi di contenuto strategico, ripetizioni della stessa frase standard.

CLASSIFICAZIONE OBBLIGATORIA DI OGNI FRAMMENTO
- tema: uno dei temi ammessi; se un frammento tocca due temi scegli il prevalente.
- natura:
  · "fatto" = dato o evento accaduto e verificabile (es. ricavi del segmento, acquisizione chiusa);
  · "affermazione" = giudizio qualitativo del management su sé stesso o sulla propria posizione
    («siamo leader», «marchio più riconosciuto», «costi tra i più bassi del settore»): sarà
    verificato sui numeri, quindi va estratto ogni volta che compare;
  · "previsione" = obiettivo, target, guidance, piano o intenzione futura, con l'orizzonte se c'è;
  · "rischio" = fattore di rischio o incertezza dichiarata.
- soggetto: "societa" (l'emittente), "concorrente" (un rivale nominato), "settore" (il comparto
  nel suo insieme), "macro" (economia, politica, normativa generale). Se è un concorrente o un
  settore, indicane il nome in nome_soggetto.
- sezione: il titolo della sezione in cui si trova il frammento così come scritto nel documento
  (es. "Item 1A. Risk Factors", "Item 7. Management's Discussion and Analysis", "Note 15 — Segment
  Information"). Se non è riconoscibile, null.

REGOLE DI TRASCRIZIONE
- testo_originale: trascrizione letterale, mai parafrasata, 20-150 parole; nelle tabelle trascrivi
  riga per riga i valori pertinenti (intestazione di colonna compresa).
- Cifre, date, valute, denominazioni restano identiche all'originale.
- Non unire frammenti di punti diversi del documento.

REGOLE DI TRADUZIONE
- traduzione_it: traduzione integrale in italiano dello stesso frammento, con la terminologia
  economico-aziendale italiana ("market share" → "quota di mercato", "net sales" → "ricavi netti",
  "segment" → "segmento", "guidance" resta "guidance", "backlog" → "portafoglio ordini").
- Non aggiungere, non spiegare, non abbreviare.

REGOLE DI ESAUSTIVITÀ
Stai leggendo UNA PORZIONE di un documento più lungo. Percorrila dall'inizio alla fine e
riporta OGNI occorrenza pertinente: la deduplicazione avviene a valle. Le tabelle contano
(ricavi per segmento e area, clienti principali, dipendenti, capacità). Se una porzione è
ricca, preferisci molti frammenti brevi a pochi lunghi. Se un frammento è tagliato dal confine
della porzione riportalo per la parte leggibile con "troncato": true, senza completarlo.

SEGNALE DI SATURAZIONE
Se per limiti di spazio hai dovuto lasciare fuori materiale rilevante, imposta "saturo": true
e indica in "temi_residui" i temi rimasti scoperti: il sistema rileggerà la porzione.

FORMATO DI USCITA
Rispondi esclusivamente con un oggetto JSON valido, senza testo introduttivo e senza
delimitatori markdown.`;

/** Dove guardare, per tipo di documento: le sezioni in cui il materiale strategico sta di norma. */
const DOVE_GUARDARE = {
  "10-K": "Item 1 Business (prodotti, segmenti, clienti, concorrenza, fornitori, brevetti, regolamentazione, capitale umano), Item 1A Risk Factors, Item 1C Cybersecurity, Item 2 Properties (impianti e capacità), Item 3 Legal Proceedings, Item 5 (riacquisti di azioni), Item 7 MD&A (driver dei risultati, KPI, priorità, prospettive), Item 7A, Item 8 note (segmenti, ricavi disaggregati, acquisizioni, R&S, impegni), relazione del revisore (critical audit matters), Item 9A, Part III.",
  "20-F": "Item 3.D Risk Factors, Item 4 Information on the Company (4.A storia e sviluppo, 4.B business overview con mercati, concorrenza, stagionalità, materie prime, regolamentazione; 4.C struttura; 4.D impianti), Item 5 Operating and Financial Review (5.A risultati, 5.C R&S e brevetti, 5.D tendenze), Item 6 (amministratori, compensi, dipendenti), Item 7 (azionisti rilevanti, parti correlate), Item 8 (contenziosi, dividendi), Item 11, Item 15-16 (controlli, revisore), Item 18 note (segmenti).",
  "40-F": "Annual Information Form (descrizione del business, rischi, mercati), Management's Discussion and Analysis, note al bilancio (segmenti).",
  "10-Q": "Part I Item 2 MD&A (andamento del trimestre, driver, prospettive), note (segmenti), Part II Item 1A (rischi aggiornati), Item 2 (riacquisti).",
  "6-K": "Comunicato o relazione allegata: risultati, guidance, eventi, operazioni straordinarie.",
  "8-K": "Item 1.01 accordi rilevanti, 2.01 acquisizioni/cessioni, 2.02 risultati (Exhibit 99.1), 2.05-2.06 ristrutturazioni e svalutazioni, 4.01 cambio revisore, 4.02 bilanci non più affidabili, 5.02 cambi di amministratori e dirigenti, 7.01-8.01 presentazioni e altri eventi.",
  "DEF 14A": "struttura e indipendenza del board, comitati, Compensation Discussion & Analysis (le metriche degli incentivi dicono che cosa il board considera strategico), peer group retributivo (concorrenti scelti dal board), parti correlate, proposte degli azionisti.",
  "PROSPETTO": "Prospectus Summary, Risk Factors, Industry/Market overview (dimensione e crescita del mercato), Business, Competition, Use of Proceeds, assetti proprietari prima e dopo l'offerta.",
  "ASSETTI": "identità dei soci rilevanti, percentuale posseduta, Item 4 «Purpose of Transaction» (intenzioni di un socio attivista), operazioni degli insider.",
  "CORRESP": "rilievi dello staff SEC (segmenti, metriche non-GAAP, rischi, disclosure) e risposte della società.",
  "NT": "motivi del ritardo nel deposito e problemi contabili dichiarati.",
  "PRESS RELEASE": "fatti annunciati, risultati, guidance, commenti del management, date.",
  "INVESTOR PRESENTATION": "priorità strategiche, KPI, quote e posizionamento, mercato indirizzabile (TAM), obiettivi con orizzonte, allocazione del capitale.",
  "PIANO STRATEGICO": "strategia realizzata, motivi del cambiamento, progetto strategico, azioni (cantieri), obiettivi economico-finanziari pluriennali e loro ipotesi.",
  "EARNINGS CALL": "commento del management su domanda, prezzi, costi, margini, guidance; domande degli analisti e risposte (rivelano i punti deboli percepiti dal mercato). Indica nel frammento chi parla se è scritto.",
  "SOSTENIBILITA": "impatti e obiettivi ambientali, capitale umano (organico, turnover, formazione), catena di fornitura, rischi climatici, governance della sostenibilità.",
  "SITO IR": "missione, visione, valori, profilo, storia, marchi, organizzazione.",
  "INDUSTRY REPORT": "dimensione e crescita del mercato, segmentazione, quote dei principali operatori, struttura competitiva, barriere, trend tecnologici e normativi, fase del ciclo di vita. Soggetto di norma «settore» o «concorrente».",
  "MACRO": "PIL, inflazione, tassi, cambi, occupazione, prezzi delle materie prime, previsioni. Soggetto di norma «macro».",
  "NORMATIVA": "contenuto della norma, settori e soggetti colpiti, data di entrata in vigore, effetti attesi. Soggetto di norma «macro» o «settore».",
  "NOTIZIA": "il fatto riportato, la data, i soggetti coinvolti, le cifre. Indica sempre la data della notizia nel campo data.",
};

function descriviPorzione(blocco) {
  if (blocco.formato === "pdf") {
    const range = blocco.stimato
      ? `documento intero (il taglio per pagine non è riuscito: ${blocco.motivoStima})`
      : `pagine da ${blocco.paginaIniziale} a ${blocco.paginaFinale} del documento originale`;
    const sovr = blocco.paginaSovrapposta ? ` Le pagine da ${blocco.paginaIniziale} a ${blocco.paginaSovrapposta} ripetono la coda della porzione precedente: estraile comunque.` : "";
    return `PORZIONE: blocco ${blocco.indice} di ${blocco.totale} — ${range}.${sovr}
Il campo "pagina" deve riportare il numero di pagina del DOCUMENTO ORIGINALE (somma l'offset).`;
  }
  const sezioni = blocco.sezioniContenute?.length ? `\nIntestazioni presenti in questa porzione: ${blocco.sezioniContenute.join(" · ")}.` : "";
  const inizio = blocco.sezioneIniziale ? `\nLa porzione comincia all'interno della sezione: ${blocco.sezioneIniziale}.` : "";
  return `PORZIONE: blocco ${blocco.indice} di ${blocco.totale} — testo, caratteri ${blocco.caratteriDa}-${blocco.caratteriA}.${inizio}${sezioni}
Il documento è testo senza numeri di pagina: imposta "pagina": null e compila sempre "sezione".${blocco.sovrapposto ? "\nL'inizio della porzione ripete la coda della precedente: estrai comunque." : ""}`;
}

function promptFiltroStrategico({ doc, blocco, gruppoTematico = null }) {
  const area = areaDelLivello(doc.layer);
  const dove = DOVE_GUARDARE[doc.tipo] ? `\nDOVE GUARDARE in un ${etichettaTipo(doc.tipo)}: ${DOVE_GUARDARE[doc.tipo]}` : "";
  const contesto = doc.layer === "contesto" || doc.layer === "notizie"
    ? `\nNATURA DEL DOCUMENTO: ${area?.classe}. Non è un documento della società analizzata${doc.entitaNome ? ` (che è ${doc.entitaNome})` : ""}: classifica con cura il soggetto di ogni frammento.`
    : doc.entitaNome ? `\nSOCIETÀ EMITTENTE: ${doc.entitaNome}.` : "";
  const focus = gruppoTematico
    ? `\n\n>>> PASSATA DI RECUPERO <<<
Questa porzione è già stata letta ed è risultata densa. Rileggila da capo cercando ESCLUSIVAMENTE
questi temi: ${gruppoTematico.temi.join(", ")} (${gruppoTematico.label}). Ignora il resto.`
    : "";
  return `DOCUMENTO: "${doc.etichetta}" — tipo ${etichettaTipo(doc.tipo)} (identificativo ${doc.id})${contesto}
${descriviPorzione(blocco)}${dove}${focus}

Restituisci esattamente questa struttura:
{
  "saturo": <true|false>,
  "temi_residui": ["<temi rimasti scoperti, se saturo>"],
  "estratti": [
    {
      "tema": "<uno dei temi ammessi>",
      "natura": "fatto" | "affermazione" | "previsione" | "rischio",
      "soggetto": "societa" | "concorrente" | "settore" | "macro",
      "nome_soggetto": "<nome del concorrente o del settore, altrimenti null>",
      "sezione": "<titolo della sezione, oppure null>",
      "pagina": <intero oppure null>,
      "periodo": "<esercizio o orizzonte a cui si riferisce, es. FY2024, 2027, oppure null>",
      "data": "<data dell'evento AAAA-MM-GG se indicata, altrimenti null>",
      "testo_originale": "<trascrizione letterale>",
      "traduzione_it": "<traduzione italiana>",
      "rilevanza": "alta" | "media" | "bassa",
      "troncato": <true|false>,
      "dati_numerici": [{ "voce": "<descrizione>", "valore": <numero>, "unita": "<valuta ISO, %, unità>", "periodo": "<periodo>" }]
    }
  ]
}
Se la porzione non contiene nulla di pertinente: "estratti": [], "saturo": false.`;
}

const SYSTEM_FILTRO_DERIVATI = `Sei un filtro di estrazione per documenti di terzi (report di analisti, consensus,
rating) a supporto di un'analisi strategica. Non commenti e non valuti: estrai parametri e
giudizi, con chi li afferma e quando, e li traduci.

NATURA DEL MATERIALE
Sono stime e opinioni di terzi, non dichiarazioni della società. Un numero o un giudizio senza
fonte e senza data è inutilizzabile: in quel caso non estrarlo.

METRICHE AMMESSE
target_price, raccomandazione, rating_credito, stima_ricavi, stima_margine, stima_utile,
crescita_attesa, quota_mercato, dimensione_mercato, crescita_mercato, multiplo,
giudizio_strategico.
"giudizio_strategico" raccoglie i giudizi qualitativi dell'analista sulla strategia e sul
posizionamento (vantaggi competitivi, debolezze, opportunità, minacce, qualità del management):
per questi indica la polarità ("forza", "debolezza", "opportunita", "minaccia", "neutra").

PERIMETRO OBBLIGATORIO
"societa" (stima sulla società analizzata), "peer" (gruppo di comparabili), "settore" (media o
mediana di settore), "mercato" (dato macro o di mercato). Se non è chiaro, non estrarre.

SCARTA disclaimer, avvertenze sui conflitti d'interesse, metodologia generica, descrizione
della casa di ricerca, riepiloghi di borsa privi di contenuto.

REGOLE: testo_originale letterale (15-100 parole), traduzione_it integrale in italiano, valori e
date identici all'originale, tabelle riga per riga. Percorri tutta la porzione.

FORMATO: solo un oggetto JSON valido, senza testo introduttivo né delimitatori markdown.`;

function promptFiltroDerivati({ doc, blocco }) {
  return `DOCUMENTO: "${doc.etichetta}" — tipo ${etichettaTipo(doc.tipo)} (identificativo ${doc.id})${doc.entitaNome ? `\nSOCIETÀ ANALIZZATA: ${doc.entitaNome}` : ""}
${descriviPorzione(blocco)}

Restituisci:
{
  "saturo": <true|false>,
  "estratti": [
    {
      "metrica": "<una delle metriche ammesse>",
      "perimetro": "societa" | "peer" | "settore" | "mercato",
      "polarita": "forza" | "debolezza" | "opportunita" | "minaccia" | "neutra",
      "valore": <numero oppure null se qualitativo>,
      "unita": "%" | "x" | "<valuta ISO>" | "testo",
      "periodo": "<es. FY2026E, 12 mesi>",
      "fonte": "<casa di ricerca, agenzia, banca dati>",
      "data_documento": "<data di pubblicazione, se indicata>",
      "sezione": "<titolo della sezione, oppure null>",
      "pagina": <intero oppure null>,
      "testo_originale": "<trascrizione letterale>",
      "traduzione_it": "<traduzione italiana>",
      "rilevanza": "alta" | "media" | "bassa"
    }
  ]
}
Se non ci sono parametri utilizzabili: "estratti": [], "saturo": false.`;
}

/* ==========================================================================
   [5] ESTRAZIONE PER PORZIONE E ORCHESTRATORE
   ========================================================================== */

/** Recupero da una risposta troncata: se il modello ha esaurito lo spazio a
 *  metà dell'array, gli oggetti completi già scritti sono validi e si salvano. */
function recuperaEstrattiTroncati(testo) {
  const s = String(testo || "");
  const inizio = s.indexOf('"estratti"');
  if (inizio < 0) return [];
  const apertura = s.indexOf("[", inizio);
  if (apertura < 0) return [];
  const out = [];
  let k = apertura + 1;
  while (k < s.length) {
    const i = s.indexOf("{", k);
    if (i < 0) break;
    let prof = 0, inStr = false, esc = false, fine = -1;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") prof++;
      else if (ch === "}") { prof--; if (prof === 0) { fine = j; break; } }
    }
    if (fine < 0) break;
    try { out.push(JSON.parse(s.slice(i, fine + 1))); } catch { /* oggetto malformato: si salta */ }
    k = fine + 1;
  }
  return out;
}

const testoOrNull = (x) => (typeof x === "string" && x.trim() && x.trim().toLowerCase() !== "null" ? x.trim() : null);
const MAX_TOKEN_ESTRAZIONE = 8000;

async function filtraBlocco({ doc, blocco, gruppoTematico = null }) {
  const derivato = areaDelLivello(doc.layer)?.filtro === "derivato";
  const testo = await chiamataIA({
    system: derivato ? SYSTEM_FILTRO_DERIVATI : SYSTEM_FILTRO_STRATEGICO,
    contenuto: [
      contenutoBlocco(blocco),
      { type: "text", text: derivato ? promptFiltroDerivati({ doc, blocco }) : promptFiltroStrategico({ doc, blocco, gruppoTematico }) },
    ],
    maxTokens: MAX_TOKEN_ESTRAZIONE,
  });

  let json = parseJsonRobusto(testo);
  let troncata = false;
  if (!json || !Array.isArray(json.estratti)) {
    const recuperati = recuperaEstrattiTroncati(testo);
    if (!recuperati.length) return { estratti: [], saturo: false, temiResidui: [], illeggibile: !json };
    json = { estratti: recuperati, saturo: true };
    troncata = true;
  }

  const base = (e, k, suff) => ({
    id: `${doc.id}-b${blocco.indice}${suff}-${k}`,
    docId: doc.id,
    entitaId: doc.entitaId,
    sezione: testoOrNull(e.sezione) || (blocco.formato === "testo" ? blocco.sezioneIniziale : null),
    pagina: Number(e.pagina) || null,
    testoOriginale: String(e.testo_originale).trim(),
    traduzioneIt: String(e.traduzione_it || "").trim(),
    rilevanza: ["alta", "media", "bassa"].includes(e.rilevanza) ? e.rilevanza : "media",
    blocco: blocco.indice,
  });

  if (derivato) {
    const estratti = json.estratti
      .filter((e) => e && e.testo_originale && METRICHE[e.metrica] && PERIMETRI[e.perimetro] && testoOrNull(e.fonte))
      .map((e, k) => ({
        ...base(e, k, "-d"),
        derivato: true,
        metrica: e.metrica,
        perimetro: e.perimetro,
        polarita: POLARITA[e.polarita] ? e.polarita : "neutra",
        valore: typeof e.valore === "number" && isFinite(e.valore) ? e.valore : null,
        unita: testoOrNull(e.unita) || METRICHE[e.metrica].unita,
        periodo: testoOrNull(e.periodo),
        fonte: String(e.fonte).trim(),
        dataDocumento: testoOrNull(e.data_documento),
        passata: "generale",
        fasi: METRICHE[e.metrica].fasi,
      }));
    return { estratti, saturo: json.saturo === true || troncata, temiResidui: [] };
  }

  const suffisso = gruppoTematico ? `-${gruppoTematico.id}` : "";
  const estratti = json.estratti
    .filter((e) => e && e.testo_originale && TEMI[e.tema])
    .filter((e) => !gruppoTematico || gruppoTematico.temi.includes(e.tema))
    .map((e, k) => ({
      ...base(e, k, suffisso),
      tema: e.tema,
      natura: NATURE[e.natura] ? e.natura : "fatto",
      soggetto: SOGGETTI[e.soggetto] ? e.soggetto : (doc.layer === "contesto" ? "settore" : "societa"),
      nomeSoggetto: testoOrNull(e.nome_soggetto),
      periodo: testoOrNull(e.periodo),
      data: testoOrNull(e.data),
      troncato: e.troncato === true,
      datiNumerici: Array.isArray(e.dati_numerici) ? e.dati_numerici.filter((d) => d && typeof d.valore === "number" && isFinite(d.valore)).slice(0, 12) : [],
      passata: gruppoTematico ? gruppoTematico.id : "generale",
      fasi: TEMI[e.tema].fasi,
    }));
  return {
    estratti,
    saturo: json.saturo === true || troncata,
    temiResidui: Array.isArray(json.temi_residui) ? json.temi_residui.filter((t) => TEMI[t]) : [],
  };
}

/** Deduplicazione su pagina/sezione + testo normalizzato: le porzioni si
 *  sovrappongono e le riletture rivedono materiale già estratto. */
function deduplicaEstratti(esistenti, nuovi) {
  const chiave = (e) => `${e.pagina ?? e.sezione ?? "?"}|${String(e.testoOriginale).toLowerCase().replace(/[^a-z0-9]/gi, "").slice(0, 100)}`;
  const chiaveTesto = (e) => String(e.testoOriginale).toLowerCase().replace(/[^a-z0-9]/gi, "").slice(0, 140);
  const viste = new Set(esistenti.map(chiave));
  const visteTesto = new Set(esistenti.map(chiaveTesto));
  const tenuti = [];
  for (const n of nuovi) {
    const k = chiave(n), kt = chiaveTesto(n);
    if (viste.has(k) || (kt.length > 60 && visteTesto.has(kt))) continue;
    viste.add(k); visteTesto.add(kt);
    tenuti.push(n);
  }
  return tenuti;
}

const PAUSA_PRIMA_DELLA_RIPRESA = 20000;

/**
 * ORCHESTRATORE PER DOCUMENTO — lettura generale di ogni porzione, riletture
 * mirate sulle porzioni dense o sature, seconda passata sulle porzioni fallite.
 * Un errore definitivo (credito, chiave, permessi) ferma il documento: ripeterlo
 * porzione per porzione non avvicina la soluzione di un passo.
 */
async function analizzaDocumento({ doc, blocchi, onProgresso, onEstratti, segnaleStop }) {
  const piano = blocchi[0]?.piano || { passateTematiche: false };
  let accumulati = [];
  let passateTotali = 0;
  let interruzione = null;
  const lette = new Set();
  const nonLette = [];
  const derivato = areaDelLivello(doc.layer)?.filtro === "derivato";

  const leggiPorzione = async (blocco, ripresa = false) => {
    onProgresso?.({ fase: ripresa ? "Ripresa porzione" : "Estrazione", blocco: blocco.indice, totale: blocco.totale, passata: "lettura generale" });
    let esito;
    try {
      esito = await filtraBlocco({ doc, blocco });
      passateTotali++;
    } catch (err) {
      if (err.definitivo) {
        interruzione = err;
        onProgresso?.({ fase: "Interruzione", blocco: blocco.indice, totale: blocco.totale, errore: err.message, definitivo: true });
        return false;
      }
      onProgresso?.({ fase: "Errore su porzione", blocco: blocco.indice, totale: blocco.totale, errore: err.message, ripresa });
      return false;
    }
    lette.add(blocco.indice);
    const nuovi = deduplicaEstratti(accumulati, esito.estratti);
    accumulati = [...accumulati, ...nuovi];
    onEstratti?.(nuovi, { blocco: blocco.indice, totale: blocco.totale, passata: "generale", saturo: esito.saturo, illeggibile: esito.illeggibile });

    if (derivato) return true;
    if (!esito.saturo && !(piano.passateTematiche && esito.estratti.length > 0)) return true;
    const gruppi = esito.saturo && esito.temiResidui.length
      ? GRUPPI_TEMATICI.filter((g) => g.temi.some((t) => esito.temiResidui.includes(t)))
      : GRUPPI_TEMATICI;
    for (const gruppo of gruppi) {
      if (segnaleStop?.fermato) break;
      onProgresso?.({ fase: "Rilettura mirata", blocco: blocco.indice, totale: blocco.totale, passata: gruppo.label });
      try {
        const recupero = await filtraBlocco({ doc, blocco, gruppoTematico: gruppo });
        passateTotali++;
        const aggiunti = deduplicaEstratti(accumulati, recupero.estratti);
        accumulati = [...accumulati, ...aggiunti];
        onEstratti?.(aggiunti, { blocco: blocco.indice, totale: blocco.totale, passata: gruppo.label, saturo: recupero.saturo });
      } catch (err) {
        if (err.definitivo) { interruzione = err; break; }
      }
    }
    return true;
  };

  for (const blocco of blocchi) {
    if (segnaleStop?.fermato) break;
    const ok = await leggiPorzione(blocco);
    if (interruzione) break;
    if (!ok) nonLette.push(blocco);
  }

  const irrecuperabili = [];
  if (nonLette.length && !interruzione && !segnaleStop?.fermato) {
    onProgresso?.({ fase: "Attesa prima della ripresa", blocco: nonLette.length, totale: blocchi.length, ripresa: true });
    await attesa(PAUSA_PRIMA_DELLA_RIPRESA);
    for (const blocco of nonLette) {
      const ok = await leggiPorzione(blocco, true);
      if (!ok) irrecuperabili.push(blocco.indice);
      if (interruzione) break;
    }
  }

  const mancanti = blocchi.map((b) => b.indice).filter((i) => !lette.has(i));
  return {
    estratti: accumulati, passateTotali, porzioniTotali: blocchi.length,
    nonLette: mancanti, recuperate: nonLette.length - irrecuperabili.length,
    interruzione, fermato: !!segnaleStop?.fermato,
  };
}

/**
 * FRONTESPIZIO — tipo, emittente e profilo dalla prima porzione.
 * Per l'HTML la testata deterministica viene passata come indizio: il modello
 * conferma o corregge, non indovina da zero. Ogni campo non scritto nel
 * documento deve tornare null: un'anagrafica inventata sposta il peer group.
 */
async function identificaFrontespizio(blocco, indizi = null) {
  const contenuto = blocco.formato === "pdf"
    ? contenutoBlocco(blocco)
    : { type: "text", text: `<<<INIZIO TESTO>>>\n${blocco.testo.slice(0, 24000)}\n<<<FINE TESTO>>>` };
  const testo = await chiamataIA({
    system: `Identifichi natura ed emittente di documenti societari leggendo copertina e prime pagine.
Rispondi solo con JSON valido. Se un dato non è esplicitamente scritto, riporta null: non stimare,
non dedurre dalla tua conoscenza. Una risposta nulla è sempre preferibile a un dato inventato.`,
    contenuto: [contenuto, {
      type: "text",
      text: `Tipi ammessi: ${TUTTI_I_TIPI.map((t) => t.id).join(", ")}.
${indizi?.tipo ? `Indizio dalla testata: ${indizi.dicitura || indizi.tipo}${indizi.periodo ? `, periodo ${indizi.periodo}` : ""}${indizi.emittente ? `, emittente ${indizi.emittente}` : ""}.` : ""}

Cerca: form o natura del documento; denominazione esatta dell'emittente; ticker; CIK se scritto;
codice SIC o settore dichiarato; data di chiusura del periodo; profilo di business (che cosa vende,
con quale modello, posizionamento di prezzo, scala, mercati) SOLO se dichiarato; CONCORRENTI
nominati esplicitamente nel documento come tali (sezioni Competition, peer group): non dedurli.

Rispondi con:
{
  "tipo": "<tipo ammesso o null>",
  "emittente": "<denominazione o null>",
  "ticker": "<o null>",
  "cik": "<o null>",
  "sic": "<codice o null>",
  "settore": "<settore dichiarato, testo breve, o null>",
  "periodo": "<data di chiusura del periodo o null>",
  "anno": <anno del periodo, intero, o null>,
  "profilo": { "attivita": "<o null>", "posizionamento": "<massa|premium|lusso|ultra-lusso|discount o null>", "scala": "<o null>", "mercati": "<o null>" },
  "peer": ["<concorrente nominato>"],
  "confidenza": "alta" | "media" | "bassa",
  "indizio": "<dicitura esatta su cui ti basi>"
}`,
    }],
    maxTokens: 1200,
  });
  const json = parseJsonRobusto(testo) || {};
  const p = json.profilo && typeof json.profilo === "object" ? json.profilo : {};
  return {
    tipo: TUTTI_I_TIPI.some((t) => t.id === json.tipo) ? json.tipo : null,
    emittente: testoOrNull(json.emittente),
    ticker: testoOrNull(json.ticker),
    cik: testoOrNull(String(json.cik ?? "")),
    sic: testoOrNull(String(json.sic ?? "")),
    settore: testoOrNull(json.settore),
    periodo: testoOrNull(json.periodo),
    anno: Number.isInteger(json.anno) ? json.anno : (Number(json.anno) || null),
    profilo: { attivita: testoOrNull(p.attivita), posizionamento: testoOrNull(p.posizionamento), scala: testoOrNull(p.scala), mercati: testoOrNull(p.mercati) },
    peer: Array.isArray(json.peer) ? json.peer.map(testoOrNull).filter(Boolean).slice(0, 12) : [],
    confidenza: ["alta", "media", "bassa"].includes(json.confidenza) ? json.confidenza : "bassa",
    indizio: testoOrNull(json.indizio),
  };
}

/* ==========================================================================
   [6] CONSOLIDAMENTO, INSTRADAMENTO, COPERTURA
   ========================================================================== */

const PAROLE_VUOTE = new Set("della delle degli dello dell nella nelle negli nello sono stato stata essere anche come questo questa questi queste quale quali loro nostro nostra nostri nostre with that this from have which their there been were will would could should into about other than also such these those more most only over under after before while where when".split(" "));
const tokenizza = (t) => new Set(String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PAROLE_VUOTE.has(w)));
const numeriChiave = (t) => new Set((String(t || "").match(/\d+(?:[.,]\d+)?/g) || []).filter((n) => n.replace(/[.,]/g, "").length >= 2));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Raggruppa per tema le informazioni che documenti diversi riportano allo
 * stesso modo. Capofila è la fonte di rango più alto: un fatto che il 10-K e
 * una notizia riportano entrambi si cita dal 10-K, e la notizia diventa conferma.
 */
function consolidaEstratti(documenti, estrattiPerDoc) {
  const metaDoc = Object.fromEntries(documenti.map((d) => [d.id, d]));
  const rango = (e) => areaDelLivello(metaDoc[e.docId]?.layer)?.rango ?? 9;
  const perTema = {};
  for (const lista of Object.values(estrattiPerDoc)) {
    for (const e of lista) {
      if (e.derivato || !metaDoc[e.docId]) continue;
      (perTema[e.tema] = perTema[e.tema] || []).push(e);
    }
  }
  const perEstratto = {};
  const cluster = [];
  for (const lista of Object.values(perTema)) {
    const ordinati = [...lista].sort((a, b) => rango(a) - rango(b));
    const locali = [];
    for (const e of ordinati) {
      const tok = tokenizza(e.traduzioneIt || e.testoOriginale);
      const num = numeriChiave(e.testoOriginale);
      let trovato = null;
      for (const c of locali) {
        if (c.entitaId !== e.entitaId) continue;
        const sim = jaccard(tok, c.token);
        const numeriCompatibili = !num.size || !c.numeri.size || [...num].some((n) => c.numeri.has(n));
        if (sim >= 0.5 && numeriCompatibili) { trovato = c; break; }
      }
      if (trovato) trovato.occorrenze.push(e);
      else locali.push({ id: e.id, entitaId: e.entitaId, token: tok, numeri: num, occorrenze: [e] });
    }
    for (const c of locali) {
      const docs = Array.from(new Set(c.occorrenze.map((o) => o.docId)));
      const voce = { capofila: c.occorrenze[0], occorrenze: c.occorrenze, nFonti: docs.length, tipiFonte: Array.from(new Set(docs.map((d) => metaDoc[d]?.tipo))) };
      cluster.push(voce);
      c.occorrenze.forEach((o, i) => { perEstratto[o.id] = { principale: i === 0, nFonti: docs.length, cluster: voce }; });
    }
  }
  return { cluster, perEstratto };
}

/**
 * INSTRADAMENTO — il materiale che una fase riceve.
 * È il punto di consegna per le fasi successive: ciascuna chiama questa
 * funzione e riceve solo ciò che le serve, con la provenienza attaccata.
 */
function materialePerFase(stato, fase) {
  const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
  const estratti = Object.values(stato.estratti).flat().filter((e) => (e.fasi || []).includes(fase) && metaDoc[e.docId]);
  return {
    fase,
    estratti: estratti.map((e) => ({ ...e, documento: metaDoc[e.docId] })),
    xbrl: fase === 4 || fase === 1 ? stato.xbrl : {},
    entita: stato.entita,
    documenti: stato.documenti.filter((d) => estratti.some((e) => e.docId === d.id)),
  };
}

function riepilogoInstradamento(stato) {
  const tutti = Object.values(stato.estratti).flat();
  return FASI_ANALISI.filter((f) => f.id > 0).map((f) => {
    const qui = tutti.filter((e) => (e.fasi || []).includes(f.id));
    const perTema = {};
    for (const e of qui) {
      const k = e.derivato ? `metrica:${e.metrica}` : e.tema;
      perTema[k] = (perTema[k] || 0) + 1;
    }
    const perNatura = {};
    for (const e of qui) if (!e.derivato) perNatura[e.natura] = (perNatura[e.natura] || 0) + 1;
    const docIds = new Set(qui.map((e) => e.docId));
    const tipi = Array.from(new Set(stato.documenti.filter((d) => docIds.has(d.id)).map((d) => d.tipo)));
    return {
      fase: f, totale: qui.length, perTema, perNatura, tipi,
      xbrl: f.id === 4 || f.id === 1 ? Object.keys(stato.xbrl).length : 0,
    };
  });
}

/** Stato della copertura per un'entità: per ogni requisito, presente, parziale o mancante. */
function valutaCopertura(stato, entita) {
  const principale = entita.ruolo === "principale";
  const documentiEntita = stato.documenti.filter((d) => d.entitaId === entita.id && d.stato !== "interrotto");
  const documentiContesto = stato.documenti.filter((d) => !d.entitaId && d.stato !== "interrotto");
  const emittenteEstero = documentiEntita.some((d) => d.tipo === "20-F" || d.tipo === "40-F");
  return REQUISITI
    .filter((r) => principale || ["annuali", "xbrl", "periodici", "presentazioni"].includes(r.id))
    .filter((r) => !(r.soloUsa && emittenteEstero))
    .map((r) => {
      let n = 0, dettaglio = "";
      if (r.speciale === "xbrl") {
        n = stato.xbrl[entita.id]?.anni?.length || 0;
        dettaglio = n ? `${plurale(n, "esercizio", "esercizi")} in serie` : "";
      } else if (r.speciale === "peer") {
        const peer = stato.entita.filter((e) => e.ruolo === "peer");
        n = peer.filter((p) => stato.documenti.some((d) => d.entitaId === p.id && ["10-K", "20-F", "40-F"].includes(d.tipo)) || stato.xbrl[p.id]).length;
        dettaglio = `${n} su ${peer.length} peer registrati`;
      } else {
        const pool = r.ambito === "contesto" ? documentiContesto : r.ambito === "tutte" ? [...documentiEntita, ...documentiContesto] : documentiEntita;
        const trovati = pool.filter((d) => r.tipi.includes(d.tipo));
        if (r.id === "annuali") {
          const anni = new Set(trovati.map((d) => d.anno).filter(Boolean));
          n = Math.max(anni.size, trovati.length ? 1 : 0);
          dettaglio = anni.size ? `esercizi ${Array.from(anni).sort().join(", ")}` : trovati.length ? `${trovati.length} documento senza anno riconosciuto` : "";
        } else {
          n = trovati.length;
          dettaglio = n ? Array.from(new Set(trovati.map((d) => etichettaTipo(d.tipo)))).join(", ") : "";
        }
      }
      const esito = n >= r.minimo ? "completo" : n > 0 ? "parziale" : "mancante";
      return { ...r, n, esito, dettaglio };
    });
}

/* ==========================================================================
   [7] DATI XBRL — SEC companyfacts
   --------------------------------------------------------------------------
   Il file si scarica gratis da data.sec.gov/api/xbrl/companyfacts/CIK##########.json.
   Contiene tutti i valori contabili dichiarati in XBRL, per concetto e periodo.
   Da qui si ricavano serie annuali deterministiche per la Fase 4: nessuna IA,
   nessuna lettura di PDF, nessun numero «visto» invece che dichiarato.
   ========================================================================== */

const CONCETTI_XBRL = [
  { chiave: "ricavi", label: "Ricavi", tipo: "flusso", concetti: ["us-gaap:Revenues", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:SalesRevenueNet", "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax", "ifrs-full:Revenue"] },
  { chiave: "costoVenduto", label: "Costo del venduto", tipo: "flusso", concetti: ["us-gaap:CostOfRevenue", "us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfGoodsSold", "ifrs-full:CostOfSales"] },
  { chiave: "utileLordo", label: "Margine lordo", tipo: "flusso", concetti: ["us-gaap:GrossProfit", "ifrs-full:GrossProfit"] },
  { chiave: "rs", label: "Ricerca e sviluppo", tipo: "flusso", concetti: ["us-gaap:ResearchAndDevelopmentExpense", "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "ifrs-full:ResearchAndDevelopmentExpense"] },
  { chiave: "sga", label: "Spese commerciali, generali e amm.ve", tipo: "flusso", concetti: ["us-gaap:SellingGeneralAndAdministrativeExpense", "ifrs-full:SellingGeneralAndAdministrativeExpense"] },
  { chiave: "pubblicita", label: "Pubblicità e marketing", tipo: "flusso", concetti: ["us-gaap:AdvertisingExpense", "us-gaap:MarketingAndAdvertisingExpense", "us-gaap:MarketingExpense"] },
  { chiave: "risultatoOperativo", label: "Risultato operativo", tipo: "flusso", concetti: ["us-gaap:OperatingIncomeLoss", "ifrs-full:ProfitLossFromOperatingActivities"] },
  { chiave: "utileNetto", label: "Utile netto", tipo: "flusso", concetti: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss", "ifrs-full:ProfitLoss", "ifrs-full:ProfitLossAttributableToOwnersOfParent"] },
  { chiave: "ammortamenti", label: "Ammortamenti", tipo: "flusso", concetti: ["us-gaap:DepreciationDepletionAndAmortization", "us-gaap:DepreciationAmortizationAndAccretionNet", "us-gaap:DepreciationAndAmortization", "ifrs-full:DepreciationAndAmortisationExpense"] },
  { chiave: "cfo", label: "Flusso di cassa operativo", tipo: "flusso", concetti: ["us-gaap:NetCashProvidedByUsedInOperatingActivities", "ifrs-full:CashFlowsFromUsedInOperatingActivities"] },
  { chiave: "capex", label: "Investimenti in immobilizzazioni", tipo: "flusso", concetti: ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "us-gaap:PaymentsToAcquireProductiveAssets", "ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"] },
  { chiave: "acquisizioni", label: "Acquisizioni d'impresa", tipo: "flusso", concetti: ["us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired", "ifrs-full:CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"] },
  { chiave: "dividendi", label: "Dividendi pagati", tipo: "flusso", concetti: ["us-gaap:PaymentsOfDividends", "us-gaap:PaymentsOfDividendsCommonStock", "ifrs-full:DividendsPaidClassifiedAsFinancingActivities"] },
  { chiave: "riacquisti", label: "Riacquisto di azioni", tipo: "flusso", concetti: ["us-gaap:PaymentsForRepurchaseOfCommonStock", "ifrs-full:PaymentsToAcquireOrRedeemEntitysShares"] },
  { chiave: "totaleAttivo", label: "Totale attivo", tipo: "stock", concetti: ["us-gaap:Assets", "ifrs-full:Assets"] },
  { chiave: "patrimonioNetto", label: "Patrimonio netto", tipo: "stock", concetti: ["us-gaap:StockholdersEquity", "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "ifrs-full:Equity", "ifrs-full:EquityAttributableToOwnersOfParent"] },
  { chiave: "cassa", label: "Disponibilità liquide", tipo: "stock", concetti: ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "ifrs-full:CashAndCashEquivalents"] },
  { chiave: "debitoLungo", label: "Debiti finanziari a lungo termine", tipo: "stock", concetti: ["us-gaap:LongTermDebtNoncurrent", "us-gaap:LongTermDebt", "ifrs-full:NoncurrentPortionOfNoncurrentBorrowings", "ifrs-full:LongtermBorrowings"] },
  { chiave: "rimanenze", label: "Rimanenze", tipo: "stock", concetti: ["us-gaap:InventoryNet", "ifrs-full:Inventories"] },
  { chiave: "crediti", label: "Crediti commerciali", tipo: "stock", concetti: ["us-gaap:AccountsReceivableNetCurrent", "ifrs-full:TradeAndOtherCurrentReceivables", "ifrs-full:CurrentTradeReceivables"] },
  { chiave: "dipendenti", label: "Dipendenti", tipo: "stock", concetti: ["dei:EntityNumberOfEmployees"] },
];

const FORM_ANNUALI = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"]);
const giorniTra = (a, b) => (new Date(b) - new Date(a)) / 86400000;

function eCompanyFacts(obj) {
  return obj && typeof obj === "object" && obj.facts && typeof obj.facts === "object" && (obj.cik !== undefined || obj.entityName);
}

/**
 * Serie annuali da companyfacts. Per ogni voce si prova la lista dei concetti
 * nell'ordine dato e, anno per anno, si prende il primo concetto che ha un
 * valore: le società cambiano tag nel tempo (Revenues → RevenueFromContract…)
 * e fermarsi al primo concetto trovato lascerebbe buchi nella serie.
 * Flussi: durata fra 330 e 400 giorni. Stock: valore a fine esercizio. A parità
 * di periodo vince il deposito più recente, che incorpora eventuali rettifiche.
 */
function parseCompanyFacts(obj) {
  const facts = obj.facts || {};
  const serie = {};
  const anniTutti = new Set();
  let fineEsercizio = null;

  for (const voce of CONCETTI_XBRL) {
    const valori = {};
    const origine = {};
    let unitaScelta = null;
    for (const nome of voce.concetti) {
      const [ns, concetto] = nome.split(":");
      const nodo = facts[ns]?.[concetto];
      if (!nodo?.units) continue;
      const unitaDisponibili = Object.keys(nodo.units);
      const unita = unitaScelta && unitaDisponibili.includes(unitaScelta) ? unitaScelta
        : unitaDisponibili.find((u) => u === "USD") || unitaDisponibili.find((u) => /^[A-Z]{3}$/.test(u)) || unitaDisponibili[0];
      if (!unita) continue;
      const perAnno = {};
      for (const f of nodo.units[unita] || []) {
        if (!f || !FORM_ANNUALI.has(f.form) || !f.end || typeof f.val !== "number") continue;
        if (voce.tipo === "flusso") {
          if (!f.start) continue;
          const g = giorniTra(f.start, f.end);
          if (g < 330 || g > 400) continue;
        } else if (voce.chiave !== "dipendenti" && f.start) continue;
        const anno = Number(f.end.slice(0, 4)) - (Number(f.end.slice(5, 7)) <= 1 ? 1 : 0);
        const prec = perAnno[anno];
        if (!prec || f.end > prec.end || (f.end === prec.end && (f.filed || "") > (prec.filed || ""))) perAnno[anno] = f;
      }
      for (const [anno, f] of Object.entries(perAnno)) {
        if (valori[anno] !== undefined) continue;
        valori[anno] = f.val;
        origine[anno] = { concetto: nome, fine: f.end, form: f.form, depositato: f.filed || null };
        unitaScelta = unitaScelta || unita;
        anniTutti.add(Number(anno));
        if (voce.chiave === "ricavi" && (!fineEsercizio || f.end > fineEsercizio)) fineEsercizio = f.end;
      }
    }
    if (Object.keys(valori).length) serie[voce.chiave] = { label: voce.label, tipo: voce.tipo, unita: unitaScelta, valori, origine };
  }
  const anni = Array.from(anniTutti).sort((a, b) => a - b);
  return {
    entityName: obj.entityName || null,
    cik: obj.cik !== undefined ? String(obj.cik).padStart(10, "0") : null,
    serie, anni,
    fineEsercizio: fineEsercizio ? fineEsercizio.slice(5) : null,
    principio: facts["us-gaap"] ? "US GAAP" : facts["ifrs-full"] ? "IFRS" : "n.d.",
  };
}

/* ==========================================================================
   [8] STATO DELLA FASE 0
   --------------------------------------------------------------------------
   Entità: la società analizzata ("principale") e i peer. Ogni documento è
   attribuito a un'entità, oppure a nessuna se è materiale di contesto (uno
   studio di settore non appartiene a una società). I campi dell'anagrafica
   corretti a mano non vengono più sovrascritti dalle letture automatiche.
   ========================================================================== */

const profiloVuoto = () => ({ attivita: null, posizionamento: null, scala: null, mercati: null });
const entitaVuota = (id, ruolo, nome = "") => ({
  id, ruolo, nome, ticker: "", cik: "", sic: "", settore: "", esercizio: "",
  profilo: profiloVuoto(), peerNominati: [], fonte: {}, creata: new Date().toISOString(),
});

const statoIniziale = {
  entita: [entitaVuota("principale", "principale")],
  documenti: [],
  estratti: {},
  xbrl: {},
  fase1: {},
  fase2: {},
  fase3: {},
  fase4: { voci: {}, scatter: null },
  fase5: {},
  fase6: {},
  opzioni: {},
  confronto: [],
  attivita: [],
  elaborazione: null,
  notifica: null,
};

/** Stato della Fase 1 per un'entità: sezioni proposte/confermate, soglia e scelte sulle ASA. */
const fase1Vuota = () => ({ sezioni: {}, sogliaAsa: SOGLIA_ASA_PREDEFINITA, asa: {} });
const conFase1 = (stato, entitaId, fn) => {
  const corrente = stato.fase1?.[entitaId] || fase1Vuota();
  return { ...stato, fase1: { ...(stato.fase1 || {}), [entitaId]: fn(corrente) } };
};

const voceLog = (livello, testo) => ({ id: nuovoId(), ora: ora(), livello, testo });
const conLog = (stato, livello, testo) => ({ ...stato, attivita: [voceLog(livello, testo), ...stato.attivita].slice(0, 200) });
const nomeEntita = (e) => (e ? e.nome || (e.ruolo === "principale" ? "Società analizzata" : "Peer senza nome") : "Contesto");

const CAMPI_ANAGRAFICA = ["nome", "ticker", "cik", "sic", "settore", "esercizio"];

function reducer(stato, azione) {
  switch (azione.tipo) {
    case "LOG":
      return conLog(stato, azione.livello || "info", azione.testo);

    case "NOTIFICA":
      return { ...stato, notifica: azione.notifica };

    case "PROGRESSO":
      return { ...stato, elaborazione: azione.elaborazione };

    case "FINE_ELABORAZIONE":
      return { ...stato, elaborazione: null };

    case "DOC_REGISTRATO":
      return { ...stato, documenti: [...stato.documenti, azione.doc], estratti: { ...stato.estratti, [azione.doc.id]: [] } };

    case "DOC_AGGIORNATO":
      return { ...stato, documenti: stato.documenti.map((d) => (d.id === azione.id ? { ...d, ...azione.patch } : d)) };

    case "DOC_RIMOSSO": {
      const doc = stato.documenti.find((d) => d.id === azione.id);
      if (!doc) return stato;
      const estratti = { ...stato.estratti };
      const n = (estratti[azione.id] || []).length;
      delete estratti[azione.id];
      return conLog({ ...stato, documenti: stato.documenti.filter((d) => d.id !== azione.id), estratti },
        "info", `Rimosso «${doc.nomeFile}» con ${plurale(n, "estratto", "estratti")}.`);
    }

    case "DOC_RIATTRIBUITO": {
      const entitaId = azione.entitaId || null;
      return {
        ...stato,
        documenti: stato.documenti.map((d) => (d.id === azione.id ? { ...d, entitaId } : d)),
        estratti: { ...stato.estratti, [azione.id]: (stato.estratti[azione.id] || []).map((e) => ({ ...e, entitaId })) },
      };
    }

    case "ESTRATTI_AGGIUNTI": {
      if (!stato.estratti[azione.docId]) return stato;
      return { ...stato, estratti: { ...stato.estratti, [azione.docId]: [...stato.estratti[azione.docId], ...azione.estratti] } };
    }

    case "ENTITA_PATCH": {
      const fonte = {};
      for (const k of Object.keys(azione.patch)) fonte[k] = "manuale";
      return {
        ...stato,
        entita: stato.entita.map((e) => (e.id === azione.id
          ? { ...e, ...azione.patch, profilo: azione.patch.profilo ? { ...e.profilo, ...azione.patch.profilo } : e.profilo, fonte: { ...e.fonte, ...fonte } }
          : e)),
      };
    }

    case "ENTITA_AGGIUNTA": {
      const nome = String(azione.nome || "").trim();
      if (nome && stato.entita.some((e) => stessoSoggetto(e.nome, nome))) return stato;
      const id = azione.id || `peer-${idBreve()}`;
      const nuova = { ...entitaVuota(id, "peer", nome), ...(azione.patch || {}) };
      return conLog({ ...stato, entita: [...stato.entita, nuova] }, "ok",
        `Peer aggiunto: «${nome || "senza nome"}»${azione.motivo ? ` — ${azione.motivo}` : ""}.`);
    }

    case "ENTITA_RIMOSSA": {
      const e = stato.entita.find((x) => x.id === azione.id);
      if (!e || e.ruolo === "principale") return stato;
      const toccati = stato.documenti.filter((d) => d.entitaId === e.id).length;
      const xbrl = { ...stato.xbrl };
      delete xbrl[e.id];
      const fase1 = { ...(stato.fase1 || {}) };
      delete fase1[e.id];
      return conLog({
        ...stato,
        entita: stato.entita.filter((x) => x.id !== e.id),
        documenti: stato.documenti.map((d) => (d.entitaId === e.id ? { ...d, entitaId: null } : d)),
        estratti: Object.fromEntries(Object.entries(stato.estratti).map(([k, l]) => [k, l.map((x) => (x.entitaId === e.id ? { ...x, entitaId: null } : x))])),
        xbrl, fase1,
      }, "info", `Peer «${nomeEntita(e)}» rimosso${toccati ? `: ${plurale(toccati, "documento passa", "documenti passano")} al contesto` : ""}.`);
    }

    case "IDENTIFICAZIONE": {
      /* Lettura automatica dell'anagrafica: riempie solo i campi vuoti e non
         tocca mai ciò che l'operatore ha scritto. I concorrenti nominati si
         sommano: documenti diversi ne citano di diversi. */
      const { entitaId, esito, doc } = azione;
      const e = stato.entita.find((x) => x.id === entitaId);
      if (!e || !esito) return stato;
      const patch = {}, fonte = { ...e.fonte };
      const prova = (campo, valore) => {
        if (valore && !e[campo] && fonte[campo] !== "manuale") { patch[campo] = valore; fonte[campo] = "documento"; }
      };
      prova("nome", esito.emittente);
      prova("ticker", esito.ticker);
      prova("cik", esito.cik);
      prova("sic", esito.sic);
      prova("settore", esito.settore);
      let profilo = e.profilo;
      if (esito.profilo && fonte.profilo !== "manuale") {
        const unione = { ...e.profilo };
        let toccato = false;
        for (const k of Object.keys(profiloVuoto())) if (esito.profilo[k] && !unione[k]) { unione[k] = esito.profilo[k]; toccato = true; }
        if (toccato) { profilo = unione; fonte.profilo = "documento"; }
      }
      const gia = new Set([...(e.peerNominati || []), ...stato.entita.map((x) => x.nome)].map(normalizzaNome));
      const nuoviPeer = (esito.peer || []).filter((p) => p && !gia.has(normalizzaNome(p)) && !stessoSoggetto(p, e.nome || esito.emittente));
      const peerNominati = [...(e.peerNominati || []), ...nuoviPeer].slice(0, 30);
      const rilevati = [...Object.keys(patch), profilo !== e.profilo ? "profilo" : null, nuoviPeer.length ? `${nuoviPeer.length} concorrenti nominati` : null].filter(Boolean);
      if (!rilevati.length) return stato;
      return conLog({
        ...stato,
        entita: stato.entita.map((x) => (x.id === entitaId ? { ...x, ...patch, profilo, peerNominati, fonte } : x)),
      }, "ok", `Anagrafica di «${patch.nome || nomeEntita(e)}» letta da «${doc}»: ${rilevati.join(", ")}.`);
    }

    case "XBRL_CARICATO": {
      const { entitaId, dati, nomeFile } = azione;
      const e = stato.entita.find((x) => x.id === entitaId);
      let entita = stato.entita;
      if (e) {
        const patch = {};
        if (!e.nome && dati.entityName) patch.nome = dati.entityName;
        if (!e.cik && dati.cik) patch.cik = dati.cik;
        if (!e.esercizio && dati.fineEsercizio) patch.esercizio = dati.fineEsercizio;
        if (Object.keys(patch).length) entita = entita.map((x) => (x.id === entitaId ? { ...x, ...patch, fonte: { ...x.fonte, ...Object.fromEntries(Object.keys(patch).map((k) => [k, "xbrl"])) } } : x));
      }
      const anni = dati.anni;
      return conLog({ ...stato, entita, xbrl: { ...stato.xbrl, [entitaId]: { ...dati, nomeFile, caricatoIl: new Date().toISOString() } } },
        "ok", `Dati XBRL di «${dati.entityName || nomeEntita(e)}» (${dati.principio}): ${plurale(Object.keys(dati.serie).length, "voce", "voci")} su ${plurale(anni.length, "esercizio", "esercizi")}${anni.length ? ` (${anni[0]}-${anni[anni.length - 1]})` : ""}.`);
    }

    case "XBRL_RIMOSSO": {
      const xbrl = { ...stato.xbrl };
      delete xbrl[azione.entitaId];
      return conLog({ ...stato, xbrl }, "info", "Serie XBRL rimossa.");
    }

    case "FASE1_SEZIONE":
      return conFase1(stato, azione.entitaId, (f) => ({ ...f, sezioni: { ...f.sezioni, [azione.sezioneId]: { ...azione.risultato, stato: "proposto" } } }));

    case "FASE1_STATO":
      return conFase1(stato, azione.entitaId, (f) => (f.sezioni[azione.sezioneId]
        ? { ...f, sezioni: { ...f.sezioni, [azione.sezioneId]: { ...f.sezioni[azione.sezioneId], stato: azione.stato, confermatoIl: azione.stato === "confermato" ? new Date().toISOString() : null } } }
        : f));

    case "FASE1_MODIFICA":
      return conFase1(stato, azione.entitaId, (f) => {
        const sez = f.sezioni[azione.sezioneId];
        if (!sez) return f;
        return { ...f, sezioni: { ...f.sezioni, [azione.sezioneId]: { ...sez, dati: impostaIn(sez.dati, azione.percorso, azione.valore), stato: "modificato" } } };
      });

    case "FASE1_ASA":
      return conFase1(stato, azione.entitaId, (f) => ({ ...f, asa: { ...f.asa, [azione.nome]: azione.valore } }));

    case "FASE1_SOGLIA":
      return conFase1(stato, azione.entitaId, (f) => ({ ...f, sogliaAsa: azione.valore, asa: {} }));

    /* Azioni generiche per le fasi a sezioni (dalla Fase 2 in poi): il ramo
       dello stato e la chiave dell'unità arrivano con l'azione. */
    case "SEZ_RISULTATO": {
      const ramo = stato[azione.ramo] || {};
      const corrente = ramo[azione.chiave] || { sezioni: {} };
      return { ...stato, [azione.ramo]: { ...ramo, [azione.chiave]: { ...corrente, ...(azione.meta ? { meta: azione.meta } : {}), sezioni: { ...corrente.sezioni, [azione.sezioneId]: { ...azione.risultato, stato: "proposto" } } } } };
    }

    case "SEZ_STATO": {
      const ramo = stato[azione.ramo] || {};
      const corrente = ramo[azione.chiave];
      if (!corrente?.sezioni?.[azione.sezioneId]) return stato;
      return { ...stato, [azione.ramo]: { ...ramo, [azione.chiave]: { ...corrente, sezioni: { ...corrente.sezioni, [azione.sezioneId]: { ...corrente.sezioni[azione.sezioneId], stato: azione.stato, confermatoIl: azione.stato === "confermato" ? new Date().toISOString() : null } } } } };
    }

    case "SEZ_MODIFICA": {
      const ramo = stato[azione.ramo] || {};
      const corrente = ramo[azione.chiave];
      const sez = corrente?.sezioni?.[azione.sezioneId];
      if (!sez) return stato;
      return { ...stato, [azione.ramo]: { ...ramo, [azione.chiave]: { ...corrente, sezioni: { ...corrente.sezioni, [azione.sezioneId]: { ...sez, dati: impostaIn(sez.dati, azione.percorso, azione.valore), stato: "modificato" } } } } };
    }

    case "F4_TEST": {
      const voci = { ...(stato.fase4?.voci || {}) };
      for (const [id, v] of Object.entries(azione.voci)) voci[id] = { ...(voci[id] || {}), ...v, preparatoIl: new Date().toISOString() };
      return { ...stato, fase4: { ...(stato.fase4 || {}), voci } };
    }

    case "F4_VOCE": {
      const voci = { ...(stato.fase4?.voci || {}) };
      voci[azione.id] = { ...(voci[azione.id] || {}), ...azione.patch };
      return { ...stato, fase4: { ...(stato.fase4 || {}), voci } };
    }

    case "CONFRONTO_AGGIUNGI": {
      const mappa = new Map((stato.confronto || []).map((x) => [x.id, x]));
      for (const x of azione.schede) mappa.set(x.id, x);
      return { ...stato, confronto: [...mappa.values()] };
    }

    case "CONFRONTO_RIMUOVI":
      return { ...stato, confronto: (stato.confronto || []).filter((x) => x.id !== azione.id) };

    case "OPZIONI":
      return { ...stato, opzioni: { ...(stato.opzioni || {}), ...azione.patch } };

    case "F4_SCATTER":
      return { ...stato, fase4: { ...(stato.fase4 || { voci: {} }), scatter: azione.scatter } };

    case "RIPRISTINO":
      return { ...statoIniziale, ...azione.stato, elaborazione: null, notifica: null, attivita: [voceLog("ok", azione.messaggio), ...(azione.stato.attivita || [])].slice(0, 200) };

    case "AZZERA":
      return { ...statoIniziale, entita: [entitaVuota("principale", "principale")], fase1: {}, fase2: {}, fase3: {}, fase4: { voci: {}, scatter: null }, fase5: {}, fase6: {}, opzioni: {}, confronto: [], attivita: [voceLog("info", "Analisi azzerata.")] };

    default:
      return stato;
  }
}

/* ==========================================================================
   [9] SALVATAGGIO E RIPRISTINO
   Un file JSON per l'intero lavoro. Non contiene i PDF: contiene ciò che ne è
   stato estratto, che è quanto serve alle fasi successive. Tutto ciò che
   rientra viene sanificato: un salvataggio resta un file esterno.
   ========================================================================== */

const NOME_APPLICAZIONE = "Analisi Strategica — società SEC";
const FORMATO_SALVATAGGIO = 1;

function componiSalvataggio(stato) {
  const nEstratti = Object.values(stato.estratti).reduce((s, l) => s + l.length, 0);
  const principale = stato.entita.find((e) => e.ruolo === "principale");
  return {
    applicazione: NOME_APPLICAZIONE,
    formatoSalvataggio: FORMATO_SALVATAGGIO,
    generato: new Date().toISOString(),
    azienda: principale?.nome || null,
    riepilogo: {
      entita: stato.entita.length,
      documenti: stato.documenti.length,
      estratti: nEstratti,
      serieXbrl: Object.keys(stato.xbrl).length,
      perFase: riepilogoInstradamento(stato).map((r) => ({ fase: r.fase.id, titolo: r.fase.titolo, estratti: r.totale })),
    },
    stato: {
      entita: stato.entita,
      documenti: stato.documenti,
      estratti: stato.estratti,
      xbrl: stato.xbrl,
      fase1: stato.fase1 || {},
      fase2: stato.fase2 || {},
      fase3: stato.fase3 || {},
      fase4: stato.fase4 || { voci: {}, scatter: null },
      fase5: stato.fase5 || {},
      fase6: stato.fase6 || {},
      confronto: stato.confronto || [],
      opzioni: stato.opzioni || {},
      attivita: stato.attivita.slice(0, 80),
    },
  };
}

function interpretaSalvataggio(dati) {
  if (!dati || typeof dati !== "object" || !dati.stato) throw new Error("struttura non riconosciuta: manca il blocco «stato»");
  const s = dati.stato;
  const entita = (Array.isArray(s.entita) ? s.entita : [])
    .filter((e) => e && typeof e.id === "string")
    .map((e) => ({ ...entitaVuota(e.id, e.ruolo === "principale" ? "principale" : "peer"), ...e, profilo: { ...profiloVuoto(), ...(e.profilo || {}) } }));
  if (!entita.some((e) => e.ruolo === "principale")) entita.unshift(entitaVuota("principale", "principale"));
  const idEntita = new Set(entita.map((e) => e.id));
  const documenti = (Array.isArray(s.documenti) ? s.documenti : [])
    .filter((d) => d && typeof d.id === "string" && LAYER_VALIDI.includes(d.layer))
    .map((d) => ({ ...d, entitaId: idEntita.has(d.entitaId) ? d.entitaId : null, stato: d.stato === "in_lettura" ? "interrotto" : d.stato }));
  const idDoc = new Set(documenti.map((d) => d.id));
  const estratti = {};
  for (const d of documenti) {
    const lista = Array.isArray(s.estratti?.[d.id]) ? s.estratti[d.id] : [];
    estratti[d.id] = lista
      .filter((e) => e && e.testoOriginale && (e.derivato ? METRICHE[e.metrica] : TEMI[e.tema]))
      .map((e) => ({ ...e, docId: d.id, entitaId: d.entitaId, fasi: e.derivato ? METRICHE[e.metrica].fasi : TEMI[e.tema].fasi }));
  }
  const xbrl = {};
  for (const [k, v] of Object.entries(s.xbrl || {})) if (idEntita.has(k) && v && v.serie) xbrl[k] = v;
  const fase1 = {};
  for (const [k, v] of Object.entries(s.fase1 || {})) {
    if (!idEntita.has(k) || !v || typeof v !== "object") continue;
    const sezioni = {};
    for (const [sid, sz] of Object.entries(v.sezioni || {})) {
      if (sezioneFase1(sid) && sz && typeof sz === "object" && sz.dati) sezioni[sid] = { ...sz, stato: ["proposto", "confermato", "modificato"].includes(sz.stato) ? sz.stato : "proposto" };
    }
    fase1[k] = { ...fase1Vuota(), ...v, sezioni };
  }
  const ramoSezioni = (grezzo, trova) => {
    const out = {};
    for (const [k, v] of Object.entries(grezzo || {})) {
      if (!v || typeof v !== "object" || !idEntita.has(k.split("::")[0])) continue;
      const sezioni = {};
      for (const [sid, sz] of Object.entries(v.sezioni || {})) {
        if (trova(sid) && sz && typeof sz === "object" && sz.dati) sezioni[sid] = { ...sz, stato: ["proposto", "confermato", "modificato"].includes(sz.stato) ? sz.stato : "proposto" };
      }
      out[k] = { ...v, sezioni };
    }
    return out;
  };
  const fase2 = ramoSezioni(s.fase2, sezioneFase2);
  const fase3 = ramoSezioni(s.fase3, sezioneFase3);
  const fase5 = ramoSezioni(s.fase5, sezioneFase5);
  const fase6 = ramoSezioni(s.fase6, sezioneFase6);
  const opzioni = {};
  if (s.opzioni && typeof s.opzioni === "object") {
    opzioni.includiNonVerificate = !!s.opzioni.includiNonVerificate;
    const r = s.opzioni.relazione;
    if (r && typeof r === "object") {
      opzioni.relazione = {
        versione: r.versione === "sintetica" ? "sintetica" : "completa",
        analista: typeof r.analista === "string" ? r.analista : "",
        commenti: Object.fromEntries(Object.entries(r.commenti || {}).filter(([k, v]) => CAPITOLI_RELAZIONE.some(([c]) => c === k) && typeof v === "string")),
      };
    }
  }
  const fase4 = { voci: {}, scatter: null };
  if (s.fase4 && typeof s.fase4 === "object") {
    for (const [id, v] of Object.entries(s.fase4.voci || {})) {
      if (!v || typeof v !== "object") continue;
      fase4.voci[id] = {
        ...v,
        test: Array.isArray(v.test) ? v.test.filter((t) => t && kpiPerId(t.kpi) && CONDIZIONI[t.condizione]) : undefined,
        esitoManuale: ESITI_VERIFICA[v.esitoManuale] ? v.esitoManuale : null,
      };
    }
    if (s.fase4.scatter && kpiPerId(s.fase4.scatter.x) && kpiPerId(s.fase4.scatter.y)) fase4.scatter = s.fase4.scatter;
  }
  const nEstratti = Object.values(estratti).reduce((t, l) => t + l.length, 0);
  return {
    stato: { entita, documenti: documenti.filter((d) => idDoc.has(d.id)), estratti, xbrl, fase1, fase2, fase3, fase4, fase5, fase6, opzioni,
      confronto: Array.isArray(s.confronto) ? s.confronto.filter((x) => x && x.tipo === "scheda-punteggio-strategico" && x.pilastri) : [], attivita: Array.isArray(s.attivita) ? s.attivita.slice(0, 80) : [] },
    messaggio: `Lavoro ripristinato${dati.azienda ? ` — ${dati.azienda}` : ""}: ${plurale(documenti.length, "documento", "documenti")}, ${plurale(nEstratti, "estratto", "estratti")}, ${plurale(Object.keys(xbrl).length, "serie XBRL", "serie XBRL")}.`,
  };
}

function scaricaJson(oggetto, nomeFile) {
  const blob = new Blob([JSON.stringify(oggetto, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Esportazione degli estratti in CSV (separatore «;», compatibile con Excel in italiano). */
function esportaEstrattiCsv(stato) {
  const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
  const metaEnt = Object.fromEntries(stato.entita.map((e) => [e.id, e]));
  const q = (x) => `"${String(x ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const righe = [["Società", "Documento", "Tipo", "Tema / metrica", "Natura / perimetro", "Soggetto", "Sezione", "Pagina", "Periodo", "Fasi", "Traduzione", "Testo originale"].map(q).join(";")];
  for (const lista of Object.values(stato.estratti)) {
    for (const e of lista) {
      const d = metaDoc[e.docId];
      righe.push([
        nomeEntita(metaEnt[e.entitaId]), d?.nomeFile, d?.tipo,
        e.derivato ? METRICHE[e.metrica]?.label : TEMI[e.tema]?.label,
        e.derivato ? PERIMETRI[e.perimetro] : NATURE[e.natura]?.label,
        e.derivato ? e.fonte : [SOGGETTI[e.soggetto], e.nomeSoggetto].filter(Boolean).join(" — "),
        e.sezione, e.pagina, e.periodo, (e.fasi || []).join(", "), e.traduzioneIt, e.testoOriginale,
      ].map(q).join(";"));
    }
  }
  const blob = new Blob(["﻿" + righe.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `estratti_strategici_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==========================================================================
   [10] INTERFACCIA — componenti
   ========================================================================== */

function Intestazione({ icona, titolo, nota, colore = C.inchiostro, badge }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ color: colore }}>{icona}</span>
        <h3 className="text-sm" style={{ fontFamily: F.display, fontWeight: 600, letterSpacing: "-0.01em" }}>{titolo}</h3>
        <div className="ml-auto">{badge}</div>
      </div>
      {nota && <p className="mt-1 text-xs leading-relaxed" style={{ color: C.muto }}>{nota}</p>}
    </div>
  );
}

function Pillola({ children, colore = C.muto, sfondo = C.fondo, titolo }) {
  return (
    <span title={titolo} className="rounded px-2 py-0.5 inline-block" style={{ background: sfondo, color: colore, fontFamily: F.mono, fontSize: 10, lineHeight: 1.6 }}>
      {children}
    </span>
  );
}

const COLORE_NATURA = {
  fatto: [C.ok, C.okTenue],
  affermazione: [C.ambra, C.ambraTenue],
  previsione: [C.periodico, C.periodicoTenue],
  rischio: [C.allarme, C.allarmeTenue],
};

const Scheda = ({ children, className = "" }) => (
  <section className={`rounded-lg border ${className}`} style={{ borderColor: C.riga, background: C.carta }}>{children}</section>
);

/* ── Configurazione IA (portata dalla suite QoE) ─────────────────────── */
function PannelloIA() {
  const [aperto, setAperto] = useState(false);
  const [cfg, setCfg] = useState(() => ripristinaConfigIA());
  const [mostra, setMostra] = useState(false);
  const aggiorna = (p) => setCfg(impostaConfigIA(p));
  const provider = cfg.provider;
  const chiave = cfg.chiavi[provider] || "";
  const attiva = provider === "claude" || Boolean(chiave);
  const claudeOspite = provider === "claude" && CLAUDE_DIRETTO;
  const etichetta = claudeOspite ? "Ambiente ospite" : provider === "claude" ? (chiave ? "Chiave personale" : "Chiave del server") : chiave ? "Chiave inserita" : "Chiave mancante";

  return (
    <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex flex-wrap items-center gap-2">
        <button onClick={() => setAperto((a) => !a)} className="st-btn flex items-center gap-2 rounded-md border px-3 py-1.5" style={{ borderColor: C.riga }}>
          <Lock size={13} style={{ color: C.muto }} />
          <span className="st-eyebrow" style={{ color: C.muto }}>Configurazione IA</span>
          {aperto ? <ChevronDown size={13} style={{ color: C.muto }} /> : <ChevronRight size={13} style={{ color: C.muto }} />}
        </button>
        <span className="rounded-md px-3 py-1.5 text-xs" style={{ background: C.fondo, fontFamily: F.mono }}>
          {provider === "claude" ? "Claude" : provider === "openai" ? "OpenAI" : "Gemini"} · <span style={{ color: C.muto }}>{cfg.modelli[provider]}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-md px-3 py-1.5" style={{ background: attiva ? C.okTenue : C.allarmeTenue }}>
          {attiva ? <Check size={12} style={{ color: C.ok }} /> : <AlertTriangle size={12} style={{ color: C.allarme }} />}
          <span className="st-eyebrow" style={{ color: attiva ? C.ok : C.allarme }}>{etichetta}</span>
        </span>
      </div>
      {aperto && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-4">
          <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: C.riga, background: C.fondo }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="st-eyebrow" style={{ color: C.muto }}>Provider</span>
              <div className="flex rounded-md overflow-hidden border" style={{ borderColor: C.riga }}>
                {[["claude", "Claude"], ["openai", "OpenAI"], ["gemini", "Gemini"]].map(([id, nome]) => (
                  <button key={id} onClick={() => aggiorna({ provider: id })} className="st-btn px-3 py-1.5 text-sm border-r last:border-r-0"
                    style={{ borderColor: C.riga, background: provider === id ? C.inchiostro : C.carta, color: provider === id ? "#fff" : C.muto }}>{nome}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {claudeOspite ? (
                <div className="flex-1 min-w-[240px] flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.ok, background: C.okTenue, color: C.ok }}>
                  <Check size={14} /> Claude è autenticato dall'ambiente ospite: nessuna chiave da inserire.
                </div>
              ) : (
                <div className="flex-1 min-w-[240px] flex items-center rounded-md border px-3" style={{ borderColor: C.riga, background: C.carta }}>
                  <input type={mostra ? "text" : "password"} value={chiave} spellCheck={false} aria-label="Chiave API"
                    onChange={(e) => aggiorna({ chiavi: { [provider]: e.target.value } })}
                    placeholder={provider === "openai" ? "sk-…" : provider === "claude" ? "sk-ant-… (vuoto = chiave del server)" : "AIza…"}
                    className="flex-1 py-2 text-sm outline-none bg-transparent" style={{ fontFamily: F.mono }} />
                  <button onClick={() => setMostra((s) => !s)} className="st-btn text-xs" style={{ color: C.muto }}>{mostra ? "nascondi" : "mostra"}</button>
                </div>
              )}
              <input value={cfg.modelli[provider]} onChange={(e) => aggiorna({ modelli: { [provider]: e.target.value } })} aria-label="Modello"
                className="rounded-md border px-3 py-2 text-sm w-full sm:w-60" style={{ borderColor: C.riga, background: C.carta, fontFamily: F.mono }} />
              <button onClick={() => { setCfg(dimenticaConfigIA()); setMostra(false); }} className="st-btn flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.riga, background: C.carta, color: C.muto }}>
                <RefreshCw size={13} /> Dimentica chiavi
              </button>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: C.muto }}>
              I filing in HTML vengono inviati come testo, i PDF nel formato nativo (con OpenAI le pagine sono convertite in immagini nel browser).
              Le chiavi restano nel <code>localStorage</code> di questo browser sotto <code>{CHIAVE_LOCALSTORAGE_IA}</code>; con Claude e campo vuoto si usa la
              chiave del server tramite il proxy <code>/api/anthropic</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Log di attività ────────────────────────────────────────────────── */
function FeedAttivita({ attivita, elaborazione, onInterrompi }) {
  const colori = { ok: C.ok, errore: C.allarme, attenzione: C.ambra, info: C.muto };
  return (
    <Scheda>
      <Intestazione icona={<Activity size={14} />} titolo="Log di attività" nota="Cronologia dell'elaborazione, dal più recente." />
      {elaborazione && (
        <div className="mx-4 mb-3 rounded-md border p-3" style={{ borderColor: C.periodico, background: C.periodicoTenue }}>
          <div className="flex items-center gap-2">
            <RefreshCw size={13} className="animate-spin" style={{ color: C.periodico }} />
            <span className="text-xs flex-1 truncate">{elaborazione.fase}</span>
            {elaborazione.totale > 0 && <span className="st-eyebrow" style={{ color: C.periodico }}>{elaborazione.blocco} / {elaborazione.totale}</span>}
          </div>
          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: C.riga }}>
            <div className="h-full transition-all" style={{ width: `${elaborazione.totale ? (elaborazione.blocco / elaborazione.totale) * 100 : 8}%`, background: C.periodico }} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs truncate flex-1" style={{ color: C.muto }}>{elaborazione.doc}{elaborazione.passata ? ` · ${elaborazione.passata}` : ""}</p>
            <button onClick={onInterrompi} className="st-btn st-eyebrow underline" style={{ color: C.allarme }}>interrompi</button>
          </div>
        </div>
      )}
      <ul className="px-4 pb-4 max-h-96 overflow-y-auto st-scroll space-y-2">
        {attivita.length === 0 && <li className="text-sm" style={{ color: C.muto }}>Nessuna attività registrata.</li>}
        {attivita.map((a) => (
          <li key={a.id} className="flex gap-2 text-xs leading-relaxed">
            <span style={{ fontFamily: F.mono, color: C.muto, fontSize: 10 }}>{a.ora}</span>
            <span style={{ color: colori[a.livello] || C.inchiostro, overflowWrap: "anywhere", minWidth: 0 }}>{a.testo}</span>
          </li>
        ))}
      </ul>
    </Scheda>
  );
}

/* ── Campo d'anagrafica modificabile ────────────────────────────────── */
function CampoAnagrafica({ etichetta, valore, fonte, onSalva, largo = false, mono = false }) {
  return (
    <label className={`flex flex-col gap-0.5 ${largo ? "sm:col-span-2" : ""}`}>
      <span className="st-eyebrow flex items-center gap-1" style={{ color: C.muto }}>
        {etichetta}
        {fonte && fonte !== "manuale" && <span style={{ color: C.periodico }}>· da {fonte}</span>}
      </span>
      <input key={`${etichetta}-${valore}`} defaultValue={valore || ""} onBlur={(e) => { if ((e.target.value || "") !== (valore || "")) onSalva(e.target.value.trim()); }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="rounded border px-2 py-1 text-sm" style={{ borderColor: C.riga, fontFamily: mono ? F.mono : F.testo }} />
    </label>
  );
}

/* ── Società analizzata e peer ──────────────────────────────────────── */
function PannelloEntita({ entita, documenti, xbrl, dispatch }) {
  const principale = entita.find((e) => e.ruolo === "principale");
  const peer = entita.filter((e) => e.ruolo === "peer");
  const [nuovoPeer, setNuovoPeer] = useState("");
  const conta = (id) => documenti.filter((d) => d.entitaId === id).length;
  const patch = (id, p) => dispatch({ tipo: "ENTITA_PATCH", id, patch: p });
  const aggiungi = (nome, motivo) => nome.trim() && dispatch({ tipo: "ENTITA_AGGIUNTA", nome: nome.trim(), motivo });
  const p = principale.profilo || {};

  return (
    <Scheda>
      <Intestazione icona={<Building2 size={14} />} titolo="Società analizzata e peer"
        nota="L'anagrafica si compila da sola leggendo la copertina dei filing e i dati XBRL; ogni campo resta correggibile e la correzione vince sulle letture successive. I concorrenti nominati nei documenti si promuovono a peer con un clic." />
      <div className="px-4 pb-4 space-y-4">
        <div className="rounded-md border p-3" style={{ borderColor: C.annuale, background: C.annualeTenue }}>
          <div className="flex items-center gap-2 mb-2">
            <Target size={13} style={{ color: C.annuale }} />
            <span className="st-eyebrow" style={{ color: C.annuale }}>Società analizzata · {plurale(conta("principale"), "documento", "documenti")}{xbrl.principale ? " · XBRL" : ""}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <CampoAnagrafica etichetta="Denominazione" valore={principale.nome} fonte={principale.fonte.nome} onSalva={(v) => patch("principale", { nome: v })} largo />
            <CampoAnagrafica etichetta="Ticker" valore={principale.ticker} fonte={principale.fonte.ticker} onSalva={(v) => patch("principale", { ticker: v.toUpperCase() })} mono />
            <CampoAnagrafica etichetta="CIK" valore={principale.cik} fonte={principale.fonte.cik} onSalva={(v) => patch("principale", { cik: v })} mono />
            <CampoAnagrafica etichetta="Settore / SIC" valore={[principale.settore, principale.sic].filter(Boolean).join(" · ")} fonte={principale.fonte.settore} onSalva={(v) => patch("principale", { settore: v })} largo />
            <CampoAnagrafica etichetta="Chiusura esercizio" valore={principale.esercizio} fonte={principale.fonte.esercizio} onSalva={(v) => patch("principale", { esercizio: v })} mono />
          </div>
          {Object.values(p).some(Boolean) && (
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {[["Attività", p.attivita], ["Posizionamento", p.posizionamento], ["Scala", p.scala], ["Mercati", p.mercati]].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="st-eyebrow shrink-0" style={{ color: C.muto, paddingTop: 2 }}>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          {principale.peerNominati?.length > 0 && (
            <div className="mt-3">
              <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Concorrenti nominati nei documenti</div>
              <div className="flex flex-wrap gap-1.5">
                {principale.peerNominati.map((n) => {
                  const gia = entita.some((e) => stessoSoggetto(e.nome, n));
                  return (
                    <button key={n} disabled={gia} onClick={() => aggiungi(n, "concorrente nominato nei documenti della società")}
                      className="st-btn flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
                      style={{ borderColor: gia ? C.riga : C.annuale, color: gia ? C.muto : C.annuale, background: C.carta }}>
                      {gia ? <Check size={11} /> : <Plus size={11} />} {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users size={13} style={{ color: C.muto }} />
            <span className="st-eyebrow" style={{ color: C.muto }}>Peer group · {peer.length}</span>
          </div>
          {peer.length === 0 && <p className="text-xs mb-2" style={{ color: C.muto }}>Nessun peer. Aggiungili qui, dai concorrenti nominati, oppure caricando i loro filing o i loro dati XBRL.</p>}
          <ul className="space-y-1.5">
            {peer.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5" style={{ borderColor: C.rigaTenue }}>
                <input key={`${e.id}-${e.nome}`} defaultValue={e.nome} onBlur={(ev) => ev.target.value.trim() !== e.nome && patch(e.id, { nome: ev.target.value.trim() })}
                  className="flex-1 min-w-[140px] rounded border px-2 py-1 text-sm" style={{ borderColor: C.riga }} aria-label="Nome del peer" />
                <input key={`${e.id}-t-${e.ticker}`} defaultValue={e.ticker} placeholder="ticker" onBlur={(ev) => ev.target.value.trim().toUpperCase() !== e.ticker && patch(e.id, { ticker: ev.target.value.trim().toUpperCase() })}
                  className="w-20 rounded border px-2 py-1 text-sm" style={{ borderColor: C.riga, fontFamily: F.mono }} aria-label="Ticker del peer" />
                <span className="st-eyebrow" style={{ color: C.muto }}>{plurale(conta(e.id), "doc", "doc")}{xbrl[e.id] ? " · XBRL" : ""}</span>
                <button onClick={() => dispatch({ tipo: "ENTITA_RIMOSSA", id: e.id })} aria-label={`Rimuovi ${e.nome}`}><X size={14} style={{ color: C.muto }} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input value={nuovoPeer} onChange={(e) => setNuovoPeer(e.target.value)} placeholder="Nome del concorrente"
              onKeyDown={(e) => { if (e.key === "Enter") { aggiungi(nuovoPeer, "inserito dall'operatore"); setNuovoPeer(""); } }}
              className="flex-1 rounded border px-2 py-1 text-sm" style={{ borderColor: C.riga }} />
            <button onClick={() => { aggiungi(nuovoPeer, "inserito dall'operatore"); setNuovoPeer(""); }} className="st-btn flex items-center gap-1 rounded border px-3 py-1 text-sm" style={{ borderColor: C.riga }}>
              <Plus size={13} /> Aggiungi peer
            </button>
          </div>
        </div>
      </div>
    </Scheda>
  );
}

/* ── Dati XBRL ──────────────────────────────────────────────────────── */
const RIGHE_TABELLA_XBRL = ["ricavi", "utileLordo", "risultatoOperativo", "utileNetto", "rs", "sga", "cfo", "capex", "acquisizioni", "riacquisti", "totaleAttivo", "patrimonioNetto", "debitoLungo", "dipendenti"];

function PannelloXbrl({ entita, xbrl, dispatch }) {
  const [sopra, setSopra] = useState(false);
  const [aperti, setAperti] = useState({});
  const inputRef = useRef(null);
  const principale = entita.find((e) => e.ruolo === "principale");

  const carica = async (files) => {
    for (const file of Array.from(files)) {
      if (!/\.json$/i.test(file.name)) {
        dispatch({ tipo: "LOG", livello: "attenzione", testo: `${file.name}: qui si caricano solo i file companyfacts in formato JSON.` });
        continue;
      }
      let obj;
      try { obj = JSON.parse(await file.text()); }
      catch { dispatch({ tipo: "LOG", livello: "errore", testo: `${file.name} non è un JSON valido.` }); continue; }
      if (!eCompanyFacts(obj)) {
        dispatch({ tipo: "LOG", livello: "errore", testo: `${file.name} non è un file companyfacts della SEC (mancano «facts» e «entityName»). Scaricarlo da data.sec.gov/api/xbrl/companyfacts/CIK##########.json.` });
        continue;
      }
      const dati = parseCompanyFacts(obj);
      if (!dati.anni.length) {
        dispatch({ tipo: "LOG", livello: "attenzione", testo: `${file.name}: nessuna delle voci attese ha valori annuali da 10-K, 20-F o 40-F.` });
        continue;
      }
      const cikNum = (c) => String(c || "").replace(/\D/g, "").replace(/^0+/, "");
      let bersaglio = entita.find((e) => (e.cik && cikNum(e.cik) === cikNum(dati.cik)) || (e.nome && dati.entityName && stessoSoggetto(e.nome, dati.entityName)));
      if (!bersaglio && !principale.nome && !xbrl.principale) bersaglio = principale;
      if (!bersaglio) {
        const id = `peer-${idBreve()}`;
        dispatch({ tipo: "ENTITA_AGGIUNTA", id, nome: dati.entityName || `CIK ${dati.cik}`, patch: { cik: dati.cik || "" }, motivo: "dai dati XBRL caricati" });
        dispatch({ tipo: "XBRL_CARICATO", entitaId: id, dati, nomeFile: file.name });
      } else {
        dispatch({ tipo: "XBRL_CARICATO", entitaId: bersaglio.id, dati, nomeFile: file.name });
      }
    }
  };

  const conDati = entita.filter((e) => xbrl[e.id]);
  const cikPrincipale = String(principale.cik || "").replace(/\D/g, "");

  return (
    <Scheda>
      <Intestazione icona={<Database size={14} />} titolo="Dati XBRL della SEC (companyfacts)" colore={C.annuale}
        nota="Le serie contabili dichiarate in XBRL, lette senza IA: alimentano la verifica numerica della Fase 4. Un file per società; viene attribuito da solo alla società o al peer corrispondente (CIK o denominazione)." />
      <div className="px-4 pb-4 space-y-3">
        <div onDragOver={(e) => { e.preventDefault(); setSopra(true); }} onDragLeave={() => setSopra(false)}
          onDrop={(e) => { e.preventDefault(); setSopra(false); carica(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          className="rounded-md border-2 border-dashed px-4 py-5 text-center cursor-pointer"
          style={{ borderColor: sopra ? C.annuale : C.riga, background: sopra ? C.annualeTenue : "transparent" }}>
          <input ref={inputRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={(e) => { carica(e.target.files); e.target.value = ""; }} />
          <Upload size={18} className="mx-auto mb-1" style={{ color: C.annuale }} />
          <p className="text-sm">Trascina qui i file companyfacts (.json)</p>
          <p className="st-eyebrow mt-1 break-all" style={{ color: C.muto }}>
            {cikPrincipale ? `per ${principale.nome || "la società"}: data.sec.gov/api/xbrl/companyfacts/CIK${cikPrincipale.padStart(10, "0")}.json` : "data.sec.gov/api/xbrl/companyfacts/CIK##########.json"}
          </p>
        </div>

        {conDati.map((e) => {
          const d = xbrl[e.id];
          const anni = d.anni.slice(-6);
          const aperto = aperti[e.id] ?? e.ruolo === "principale";
          return (
            <div key={e.id} className="rounded-md border" style={{ borderColor: C.riga }}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => setAperti((a) => ({ ...a, [e.id]: !aperto }))} className="flex flex-wrap items-center gap-2 flex-1 min-w-0 text-left">
                  {aperto ? <ChevronDown size={14} style={{ color: C.muto }} /> : <ChevronRight size={14} style={{ color: C.muto }} />}
                  <span className="text-sm" style={{ fontWeight: 600 }}>{nomeEntita(e)}</span>
                  <span className="st-eyebrow" style={{ color: C.muto }}>{d.principio} · {d.anni[0]}-{d.anni[d.anni.length - 1]} · {Object.keys(d.serie).length} voci</span>
                </button>
                <button onClick={() => dispatch({ tipo: "XBRL_RIMOSSO", entitaId: e.id })} aria-label="Rimuovi serie XBRL"><Trash2 size={13} style={{ color: C.muto }} /></button>
              </div>
              {aperto && (
                <div className="overflow-x-auto border-t" style={{ borderColor: C.rigaTenue }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: C.fondo }}>
                        <th className="text-left px-3 py-1.5 st-eyebrow" style={{ color: C.muto }}>Voce (milioni)</th>
                        {anni.map((a) => <th key={a} className="text-right px-3 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>{a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {RIGHE_TABELLA_XBRL.filter((k) => d.serie[k]).map((k) => {
                        const s = d.serie[k];
                        return (
                          <tr key={k} className="border-t" style={{ borderColor: C.rigaTenue }}>
                            <td className="px-3 py-1" title={Object.values(s.origine).map((o) => o.concetto).filter((v, i, a) => a.indexOf(v) === i).join(", ")}>{s.label}{k === "dipendenti" ? " (unità)" : ""}</td>
                            {anni.map((a) => (
                              <td key={a} className="text-right px-3 py-1" style={{ fontFamily: F.mono }}>
                                {k === "dipendenti" ? fmtNumero(s.valori[a]) : fmtMilioni(s.valori[a], s.unita)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-xs" style={{ color: C.muto }}>
                    Valuta {Object.values(d.serie).find((s) => s.unita && s.unita.length === 3)?.unita || "n.d."} · esercizio con chiusura {d.fineEsercizio || "n.d."} · fonte {d.nomeFile}. Passa il mouse su una voce per vedere il concetto XBRL usato.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Scheda>
  );
}

/* ── Area di caricamento ────────────────────────────────────────────── */
function Dropzone({ area, documenti, entita, estratti, onAvvia, occupata, onRimuovi, onRiattribuisci, ricercaWeb = null }) {
  const [sopra, setSopra] = useState(false);
  const [coda, setCoda] = useState([]);
  const [verificando, setVerificando] = useState(null);
  const [lotto, setLotto] = useState({ attivo: false, tipo: "" });
  const [elencoAperto, setElencoAperto] = useState(false);
  const inputRef = useRef(null);
  const lottoOperativo = lotto.attivo && !!lotto.tipo;
  const principale = entita.find((e) => e.ruolo === "principale");

  const entitaDaEmittente = (emittente) => (emittente ? entita.find((e) => e.nome && stessoSoggetto(e.nome, emittente)) : null);
  const aggiorna = (chiave, patch) => setCoda((c) => c.map((v) => (v.chiave === chiave ? { ...v, ...patch } : v)));

  const accoda = (files) => {
    const ammessi = Array.from(files).filter((f) => RE_FILE_AMMESSI.test(f.name));
    const scartati = Array.from(files).length - ammessi.length;
    if (scartati) alertSoft(`${plurale(scartati, "file ignorato", "file ignorati")}: in quest'area si caricano PDF, HTML (.htm) o testo.`);
    const nuovi = ammessi.map((f) => {
      const r = riconosciTipoDaNome(f.name);
      const tipoNome = r.tipo && area.tipi.some((t) => t.id === r.tipo) ? r.tipo : r.tipo;
      return {
        chiave: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`,
        file: f, formato: formatoDaFile(f),
        tipo: lottoOperativo ? lotto.tipo : tipoNome || (area.tipi.length === 1 ? area.tipi[0].id : ""),
        fonte: lottoOperativo ? "lotto" : r.tipo ? "nome file" : area.tipi.length === 1 ? "area" : null,
        motivo: lottoOperativo ? "tipo dichiarato per l'intero lotto" : r.motivo,
        anno: annoDaNome(f.name),
        emittente: null,
        testata: null,
        entitaId: area.entitaPredefinita || "",
      };
    });
    setCoda((c) => [...c, ...nuovi]);
    /* Per HTML e testo la testata si legge subito: il riconoscimento non
       costa nulla e risolve i nomi file non parlanti di EDGAR. */
    nuovi.filter((v) => v.formato !== "pdf").forEach(async (v) => {
      try {
        const testo = (await leggiTestoDaFile(v.file)).slice(0, 15000);
        const t = riconosciTestata(testo);
        const ent = entitaDaEmittente(t.emittente);
        setCoda((c) => c.map((x) => {
          if (x.chiave !== v.chiave) return x;
          const patch = { testata: t, emittente: t.emittente || x.emittente, anno: t.anno || x.anno };
          if (t.tipo && x.fonte !== "scelta manuale" && x.fonte !== "lotto") Object.assign(patch, { tipo: t.tipo, fonte: "testata", motivo: `testata: «${t.dicitura}»` });
          if (ent && x.entitaId !== ent.id && area.entitaPredefinita) patch.entitaId = ent.id;
          return { ...x, ...patch };
        }));
      } catch { /* la testata non è leggibile: resta il riconoscimento dal nome */ }
    });
  };

  const alertSoft = (testo) => setAvviso(testo);
  const [avviso, setAvviso] = useState(null);

  const verificaConIA = async (v) => {
    setVerificando(v.chiave);
    try {
      const { blocchi } = await preparaBlocchi(v.file);
      const esito = await identificaFrontespizio(blocchi[0], v.testata);
      const ent = entitaDaEmittente(esito.emittente);
      aggiorna(v.chiave, {
        tipo: esito.tipo || v.tipo,
        fonte: esito.tipo ? "frontespizio" : v.fonte,
        motivo: esito.tipo ? `frontespizio: ${esito.indizio || "dicitura riconosciuta"}` : "frontespizio non conclusivo",
        anno: esito.anno ? String(esito.anno) : v.anno,
        emittente: esito.emittente || v.emittente,
        ...(ent && area.entitaPredefinita ? { entitaId: ent.id } : {}),
      });
    } catch (err) {
      aggiorna(v.chiave, { motivo: `verifica non riuscita: ${err.message}` });
    } finally { setVerificando(null); }
  };

  const pronti = coda.filter((v) => v.tipo);
  const avvia = () => {
    pronti.forEach((v) => onAvvia({ file: v.file, layer: area.layer, tipo: v.tipo, entitaId: v.entitaId || null, anno: v.anno, testata: v.testata }));
    setCoda((c) => c.filter((v) => !v.tipo));
  };
  const gruppiTipo = [area, ...AREE.filter((a) => a.layer !== area.layer)];
  const opzioniEntita = [
    ...entita.map((e) => ({ id: e.id, label: e.ruolo === "principale" ? `${nomeEntita(e)} (analizzata)` : `${nomeEntita(e)} (peer)` })),
    { id: "", label: "— contesto: nessuna società —" },
  ];

  return (
    <Scheda>
      <Intestazione icona={<Layers size={14} />} titolo={area.label} colore={area.colore} nota={area.nota}
        badge={<span className="st-eyebrow" style={{ color: area.colore }}>{area.classe}</span>} />
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        {area.tipi.map((t) => (
          <span key={t.id} title={t.nota} className="rounded-full border px-2.5 py-0.5" style={{ borderColor: C.riga, color: C.muto, fontFamily: F.mono, fontSize: 10 }}>{t.label}</span>
        ))}
      </div>

      {area.tipi.length > 1 && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2" style={{ borderColor: lottoOperativo ? area.colore : C.riga, background: lottoOperativo ? area.tenue : "transparent" }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={lotto.attivo} onChange={(e) => setLotto((l) => ({ ...l, attivo: e.target.checked }))} />
              <span className="text-xs">I file di questo caricamento sono tutti dello stesso tipo</span>
            </label>
            {lotto.attivo && (
              <select value={lotto.tipo} onChange={(e) => setLotto((l) => ({ ...l, tipo: e.target.value }))} className="rounded border px-2 py-1"
                style={{ borderColor: lotto.tipo ? C.riga : C.allarme, fontFamily: F.mono, fontSize: 11, background: C.carta }}>
                <option value="">— tipo del lotto —</option>
                {area.tipi.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      <div className="p-4 pt-0">
        <div onDragOver={(e) => { e.preventDefault(); setSopra(true); }} onDragLeave={() => setSopra(false)}
          onDrop={(e) => { e.preventDefault(); setSopra(false); accoda(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          role="button" tabIndex={0} className="rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer"
          style={{ borderColor: sopra ? area.colore : C.riga, background: sopra ? area.tenue : "transparent" }}>
          <input ref={inputRef} type="file" accept=".pdf,.htm,.html,.txt,.md,application/pdf,text/html,text/plain" multiple className="hidden"
            onChange={(e) => { accoda(e.target.files); e.target.value = ""; }} />
          <Upload size={20} className="mx-auto mb-2" style={{ color: area.colore }} />
          <p className="text-sm">Trascina qui i documenti oppure seleziona più file</p>
          <p className="st-eyebrow mt-1" style={{ color: C.muto }}>PDF · HTML da EDGAR · testo</p>
        </div>
      </div>
      {ricercaWeb}
      <div className="px-4 pb-4">
        {avviso && (
          <p className="mt-2 text-xs flex items-center gap-2" style={{ color: C.ambra }}>
            <AlertTriangle size={12} /> {avviso}
            <button onClick={() => setAvviso(null)} aria-label="Chiudi avviso"><X size={12} /></button>
          </p>
        )}

        {coda.length > 0 && (
          <div className="mt-3 rounded-md border" style={{ borderColor: area.colore }}>
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: C.rigaTenue, background: area.tenue }}>
              <span className="st-eyebrow" style={{ color: area.colore }}>Da confermare · {coda.length}</span>
              <span className="text-xs ml-auto" style={{ color: C.muto }}>Controlla tipo e società, poi avvia la lettura.</span>
            </div>
            <ul>
              {coda.map((v) => {
                const fuoriArea = v.tipo && !area.tipi.some((t) => t.id === v.tipo);
                const entScelta = entita.find((e) => e.id === v.entitaId);
                const discorde = v.emittente && entScelta?.nome && !stessoSoggetto(entScelta.nome, v.emittente);
                return (
                  <li key={v.chiave} className="px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: C.rigaTenue }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText size={14} style={{ color: v.tipo ? area.colore : C.muto }} />
                      <span className="text-sm flex-1 min-w-[140px] truncate" title={v.file.name}>{v.file.name}</span>
                      <Pillola>{v.formato.toUpperCase()}</Pillola>
                      <select value={v.tipo} onChange={(e) => aggiorna(v.chiave, { tipo: e.target.value, fonte: "scelta manuale", motivo: "tipo indicato dall'operatore" })}
                        className="rounded border px-2 py-1" style={{ borderColor: v.tipo ? C.riga : C.allarme, fontFamily: F.mono, fontSize: 11, background: C.carta, maxWidth: 220 }} aria-label="Tipo di documento">
                        <option value="">— scegli tipo —</option>
                        {gruppiTipo.map((a) => (
                          <optgroup key={a.layer} label={a.layer === area.layer ? a.label : `${a.label} · altra area`}>
                            {a.tipi.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      <select value={v.entitaId || ""} onChange={(e) => aggiorna(v.chiave, { entitaId: e.target.value })} className="rounded border px-2 py-1"
                        style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta, maxWidth: 220 }} aria-label="Società a cui appartiene">
                        {opzioniEntita.map((o) => <option key={o.id || "ctx"} value={o.id}>{o.label}</option>)}
                      </select>
                      <input value={v.anno || ""} onChange={(e) => aggiorna(v.chiave, { anno: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="anno"
                        className="w-16 rounded border px-2 py-1" style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11 }} aria-label="Anno di riferimento" />
                      <button onClick={() => setCoda((c) => c.filter((x) => x.chiave !== v.chiave))} aria-label={`Togli ${v.file.name}`}><X size={14} style={{ color: C.muto }} /></button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
                      <span className="st-eyebrow" style={{ color: v.fonte ? area.colore : C.ambra }}>{v.fonte ? `da ${v.fonte}` : "non riconosciuto"} · {v.motivo}</span>
                      {v.emittente && <span className="st-eyebrow" style={{ color: C.muto }}>emittente: {v.emittente}</span>}
                      <button onClick={() => verificaConIA(v)} disabled={verificando === v.chiave} className="st-eyebrow underline" style={{ color: C.periodico }}>
                        {verificando === v.chiave ? "lettura frontespizio…" : "verifica dal frontespizio (IA)"}
                      </button>
                    </div>
                    {discorde && (
                      <p className="mt-1 pl-6 text-xs" style={{ color: C.allarme }}>
                        La testata indica «{v.emittente}», ma il documento è attribuito a «{entScelta.nome}». Se è un concorrente, aggiungilo come peer e scegli lui.
                      </p>
                    )}
                    {fuoriArea && (
                      <p className="mt-1 pl-6 text-xs" style={{ color: C.ambra }}>
                        {etichettaTipo(v.tipo)} appartiene all'area «{areaDelTipo(v.tipo)?.label}»: il documento verrà registrato in quell'area.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-t" style={{ borderColor: C.rigaTenue }}>
              <button onClick={avvia} disabled={!pronti.length} className="st-btn rounded px-3 py-1.5 text-sm"
                style={{ background: pronti.length ? area.colore : C.riga, color: "#fff" }}>
                {occupata ? `Accoda ${plurale(pronti.length, "documento", "documenti")}` : `Analizza ${plurale(pronti.length, "documento", "documenti")}`}
              </button>
              {coda.length > pronti.length && <span className="text-xs" style={{ color: C.allarme }}>{coda.length - pronti.length} senza tipo: assegnalo o togli il file.</span>}
            </div>
          </div>
        )}

        {documenti.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setElencoAperto((a) => !a)} className="st-btn flex items-center gap-1.5 st-eyebrow" style={{ color: area.colore }}>
              {elencoAperto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {plurale(documenti.length, "documento acquisito", "documenti acquisiti")}
            </button>
            {elencoAperto && (
              <ul className="mt-2">
                {documenti.map((d) => {
                  const n = (estratti[d.id] || []).length;
                  const colStato = d.stato === "completato" ? C.ok : d.stato === "in_lettura" ? C.periodico : d.stato === "parziale" ? C.ambra : C.allarme;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
                      <FileText size={13} style={{ color: area.colore }} />
                      {d.origine === "web"
                        ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm flex-1 min-w-[140px] truncate underline" title={`${d.titolo} — ${d.url}`}><Globe size={11} className="inline mr-1" style={{ color: area.colore }} />{d.titolo}{d.editore ? ` · ${d.editore}` : ""}</a>
                        : <span className="text-sm flex-1 min-w-[140px] truncate" title={d.nomeFile}>{d.nomeFile}</span>}
                      <Pillola>{d.tipo}{d.anno ? ` · ${d.anno}` : ""}</Pillola>
                      <select value={d.entitaId || ""} onChange={(e) => onRiattribuisci(d.id, e.target.value)} className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 10, background: C.carta, maxWidth: 170 }} aria-label="Attribuzione del documento">
                        {opzioniEntita.map((o) => <option key={o.id || "ctx"} value={o.id}>{o.label}</option>)}
                      </select>
                      <span className="st-eyebrow" style={{ color: colStato }}>{(d.stato || "").replace("_", " ")} · {n} estr.</span>
                      {d.stato !== "in_lettura" && <button onClick={() => onRimuovi(d.id)} aria-label={`Rimuovi ${d.nomeFile}`}><Trash2 size={13} style={{ color: C.muto }} /></button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Scheda>
  );
}

/* ── Copertura documentale ──────────────────────────────────────────── */
function VistaCopertura({ stato }) {
  const colore = { completo: C.ok, parziale: C.ambra, mancante: C.allarme };
  const sfondo = { completo: C.okTenue, parziale: C.ambraTenue, mancante: C.allarmeTenue };
  return (
    <div className="space-y-4">
      {stato.entita.map((e) => {
        const req = valutaCopertura(stato, e);
        const mancanti = req.filter((r) => r.esito !== "completo");
        return (
          <Scheda key={e.id}>
            <Intestazione icona={e.ruolo === "principale" ? <Target size={14} /> : <Users size={14} />} titolo={`${nomeEntita(e)}${e.ruolo === "principale" ? " · società analizzata" : " · peer"}`}
              nota={e.ruolo === "principale"
                ? "Che cosa c'è, che cosa manca e quali fasi ne risentono. L'analisi può partire anche con lacune: la relazione finale le dichiarerà."
                : "Per i peer bastano bilanci annuali, dati XBRL ed eventuali presentazioni: servono al confronto, non a un'analisi completa."}
              badge={<span className="st-eyebrow" style={{ color: mancanti.length ? C.ambra : C.ok }}>{req.length - mancanti.length} / {req.length} completi</span>} />
            <ul className="px-4 pb-4 space-y-2">
              {req.map((r) => (
                <li key={r.id} className="rounded-md border px-3 py-2" style={{ borderColor: C.rigaTenue, background: r.esito === "completo" ? C.carta : sfondo[r.esito] }}>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.esito === "completo" ? <Check size={14} style={{ color: C.ok }} /> : <AlertTriangle size={14} style={{ color: colore[r.esito] }} />}
                    <span className="text-sm flex-1 min-w-[180px]" style={{ fontWeight: 500 }}>{r.label}{r.essenziale ? " *" : ""}</span>
                    <span className="st-eyebrow" style={{ color: colore[r.esito] }}>{r.esito} · {r.n}/{r.minimo}</span>
                    <span className="flex gap-1">{r.fasi.map((f) => <Pillola key={f}>{etichettaFase(f)}</Pillola>)}</span>
                  </div>
                  {r.dettaglio && <p className="mt-1 pl-6 text-xs" style={{ color: C.muto }}>{r.dettaglio}</p>}
                  {r.esito !== "completo" && <p className="mt-1 pl-6 text-xs" style={{ color: C.inchiostro }}>{r.seManca}</p>}
                </li>
              ))}
            </ul>
          </Scheda>
        );
      })}
      <p className="text-xs" style={{ color: C.muto }}>* requisito essenziale. Le soglie (tre esercizi, due trimestrali, tre peer…) sono quelle minime per leggere una tendenza o fare un confronto.</p>
    </div>
  );
}

/* ── Estratti ───────────────────────────────────────────────────────── */
function SchedaEstratto({ e, doc, ent, info }) {
  const [originale, setOriginale] = useState(false);
  const [col, bg] = e.derivato ? [C.derivata, C.derivataTenue] : COLORE_NATURA[e.natura] || [C.muto, C.fondo];
  return (
    <article className="rounded border p-3" style={{ borderColor: info?.nFonti > 1 ? C.ok : C.rigaTenue }}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Pillola colore={C.inchiostro}>{e.derivato ? METRICHE[e.metrica]?.label : TEMI[e.tema]?.label}</Pillola>
        <Pillola colore={col} sfondo={bg}>{e.derivato ? `${PERIMETRI[e.perimetro]}${e.polarita && e.polarita !== "neutra" ? ` · ${POLARITA[e.polarita]}` : ""}` : NATURE[e.natura]?.label}</Pillola>
        {!e.derivato && e.soggetto !== "societa" && <Pillola>{SOGGETTI[e.soggetto]}{e.nomeSoggetto ? `: ${e.nomeSoggetto}` : ""}</Pillola>}
        {e.derivato && e.valore !== null && <Pillola colore={C.inchiostro}>{fmtNumero(e.valore, 2)} {e.unita}</Pillola>}
        {info?.nFonti > 1 && <Pillola colore={C.ok} sfondo={C.okTenue} titolo={info.cluster.tipiFonte.join(" · ")}>confermato da {info.nFonti} fonti</Pillola>}
        <span className="ml-auto flex gap-1">{(e.fasi || []).map((f) => <Pillola key={f} colore={C.periodico} sfondo={C.periodicoTenue}>F{f}</Pillola>)}</span>
      </div>
      <p className="text-sm leading-relaxed">{e.traduzioneIt || e.testoOriginale}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="st-eyebrow" style={{ color: C.muto }}>{nomeEntita(ent)}</span>
        <span className="st-eyebrow" style={{ color: areaDelLivello(doc?.layer)?.colore || C.muto }}>{doc?.tipo}{doc?.anno ? ` ${doc.anno}` : ""}</span>
        {e.sezione && <span className="st-eyebrow" style={{ color: C.muto }}>{e.sezione}</span>}
        {e.pagina && <span className="st-eyebrow" style={{ color: C.muto }}>p. {e.pagina}</span>}
        {e.periodo && <span className="st-eyebrow" style={{ color: C.muto }}>periodo {e.periodo}</span>}
        {e.data && <span className="st-eyebrow" style={{ color: C.muto }}>{e.data}</span>}
        {e.derivato && <span className="st-eyebrow" style={{ color: C.derivata }}>fonte: {e.fonte}{e.dataDocumento ? ` del ${e.dataDocumento}` : ""}</span>}
        {e.troncato && <span className="st-eyebrow" style={{ color: C.ambra }}>troncato</span>}
        <button onClick={() => setOriginale((o) => !o)} className="st-eyebrow underline ml-auto" style={{ color: C.periodico }}>{originale ? "nascondi originale" : "testo originale"}</button>
      </div>
      {originale && <p className="mt-2 text-xs leading-relaxed rounded p-2" style={{ background: C.fondo, fontFamily: F.mono }}>{e.testoOriginale}</p>}
    </article>
  );
}

function VistaEstratti({ stato, filtroIniziale = null }) {
  const [filtri, setFiltri] = useState(() => ({ fase: "tutte", tema: "tutti", entita: "tutte", natura: "tutte", testo: "", ripetizioni: false, ...(filtroIniziale || {}) }));
  const [limite, setLimite] = useState(120);
  const metaDoc = useMemo(() => Object.fromEntries(stato.documenti.map((d) => [d.id, d])), [stato.documenti]);
  const metaEnt = useMemo(() => Object.fromEntries(stato.entita.map((e) => [e.id, e])), [stato.entita]);
  const consolidato = useMemo(() => consolidaEstratti(stato.documenti, stato.estratti), [stato.documenti, stato.estratti]);
  const tutti = useMemo(() => Object.values(stato.estratti).flat(), [stato.estratti]);

  const lista = useMemo(() => {
    const q = filtri.testo.trim().toLowerCase();
    return tutti.filter((e) => {
      if (filtri.fase !== "tutte" && !(e.fasi || []).includes(Number(filtri.fase))) return false;
      if (filtri.tema === "derivati" && !e.derivato) return false;
      if (filtri.tema !== "tutti" && filtri.tema !== "derivati" && e.tema !== filtri.tema) return false;
      if (filtri.entita === "contesto" && e.entitaId) return false;
      if (filtri.entita !== "tutte" && filtri.entita !== "contesto" && e.entitaId !== filtri.entita) return false;
      if (filtri.natura !== "tutte" && e.natura !== filtri.natura) return false;
      if (!filtri.ripetizioni && consolidato.perEstratto[e.id] && !consolidato.perEstratto[e.id].principale) return false;
      if (q && !`${e.traduzioneIt} ${e.testoOriginale} ${e.sezione || ""} ${e.nomeSoggetto || ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.rilevanza === "alta" ? 0 : a.rilevanza === "media" ? 1 : 2) - (b.rilevanza === "alta" ? 0 : b.rilevanza === "media" ? 1 : 2));
  }, [tutti, filtri, consolidato]);

  const set = (k) => (ev) => { setFiltri((f) => ({ ...f, [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value })); setLimite(120); };
  const stile = { borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta };
  const ripetuti = Object.values(consolidato.perEstratto).filter((x) => !x.principale).length;

  return (
    <Scheda>
      <Intestazione icona={<Languages size={14} />} titolo="Estratti strategici"
        nota="Ogni frammento è letterale, tradotto e classificato per tema, natura e soggetto. Le informazioni riportate da più documenti compaiono una volta sola, citate dalla fonte più autorevole, con il numero di conferme."
        badge={<span className="st-eyebrow" style={{ color: C.muto }}>{lista.length} visibili · {tutti.length} totali{ripetuti ? ` · ${ripetuti} ripetizioni accorpate` : ""}</span>} />
      <div className="px-4 pb-3 flex flex-wrap gap-2 items-center">
        <select value={filtri.fase} onChange={set("fase")} className="rounded border px-2 py-1" style={stile} aria-label="Filtro per fase">
          <option value="tutte">Tutte le fasi</option>
          {FASI_ANALISI.filter((f) => f.id > 0).map((f) => <option key={f.id} value={f.id}>{f.occhiello} · {f.titolo}</option>)}
        </select>
        <select value={filtri.tema} onChange={set("tema")} className="rounded border px-2 py-1" style={stile} aria-label="Filtro per tema">
          <option value="tutti">Tutti i temi</option>
          <option value="derivati">Solo informazione derivata</option>
          {ID_TEMI.map((t) => <option key={t} value={t}>{TEMI[t].label}</option>)}
        </select>
        <select value={filtri.entita} onChange={set("entita")} className="rounded border px-2 py-1" style={stile} aria-label="Filtro per società">
          <option value="tutte">Tutte le società</option>
          {stato.entita.map((e) => <option key={e.id} value={e.id}>{nomeEntita(e)}</option>)}
          <option value="contesto">Solo contesto</option>
        </select>
        <select value={filtri.natura} onChange={set("natura")} className="rounded border px-2 py-1" style={stile} aria-label="Filtro per natura">
          <option value="tutte">Ogni natura</option>
          {Object.entries(NATURE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="flex items-center rounded border px-2 flex-1 min-w-[160px]" style={{ borderColor: C.riga }}>
          <Search size={12} style={{ color: C.muto }} />
          <input value={filtri.testo} onChange={set("testo")} placeholder="cerca nel testo" className="flex-1 px-2 py-1 text-xs outline-none bg-transparent" />
        </div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: C.muto }}>
          <input type="checkbox" checked={filtri.ripetizioni} onChange={set("ripetizioni")} /> mostra ripetizioni
        </label>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {tutti.length === 0 && <p className="text-sm" style={{ color: C.muto }}>Nessun estratto. Carica i documenti nelle aree della scheda «Caricamento».</p>}
        {tutti.length > 0 && lista.length === 0 && <p className="text-sm" style={{ color: C.muto }}>Nessun estratto corrisponde ai filtri.</p>}
        {lista.slice(0, limite).map((e) => (
          <SchedaEstratto key={e.id} e={e} doc={metaDoc[e.docId]} ent={metaEnt[e.entitaId]} info={consolidato.perEstratto[e.id]} />
        ))}
        {lista.length > limite && (
          <button onClick={() => setLimite((l) => l + 120)} className="st-btn w-full rounded border py-2 text-sm" style={{ borderColor: C.riga }}>
            Mostra altri {Math.min(120, lista.length - limite)} di {lista.length - limite}
          </button>
        )}
      </div>
    </Scheda>
  );
}

/* ── Instradamento alle fasi ────────────────────────────────────────── */
function VistaInstradamento({ stato, onFiltra }) {
  const righe = useMemo(() => riepilogoInstradamento(stato), [stato]);
  const massimo = Math.max(1, ...righe.map((r) => r.totale));
  return (
    <div className="space-y-4">
      <Scheda>
        <Intestazione icona={<GitBranch size={14} />} titolo="Instradamento alle fasi"
          nota="Che cosa riceverà ciascuna fase. L'instradamento è deterministico: il modello assegna il tema a ogni frammento, la tabella dei temi decide a quali fasi arriva. Un frammento può servire a più fasi." />
        <div className="px-4 pb-4 space-y-3">
          {righe.map((r) => {
            const temi = Object.entries(r.perTema).sort((a, b) => b[1] - a[1]);
            const Icona = r.fase.icona;
            return (
              <div key={r.fase.id} className="rounded-md border p-3" style={{ borderColor: C.riga }}>
                <div className="flex flex-wrap items-center gap-2">
                  <Icona size={14} style={{ color: C.periodico }} />
                  <span className="text-sm" style={{ fontWeight: 600 }}>{r.fase.occhiello} · {r.fase.titolo}</span>
                  <span className="st-eyebrow ml-auto" style={{ color: r.totale ? C.periodico : C.allarme }}>
                    {plurale(r.totale, "estratto", "estratti")}{r.xbrl ? ` · ${plurale(r.xbrl, "serie XBRL", "serie XBRL")}` : ""}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: C.fondo }}>
                  <div className="h-full" style={{ width: `${(r.totale / massimo) * 100}%`, background: C.periodico }} />
                </div>
                <p className="mt-2 text-xs" style={{ color: C.muto }}>{r.fase.descrizione}</p>
                {temi.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {temi.map(([k, n]) => {
                      const etichetta = k.startsWith("metrica:") ? METRICHE[k.slice(8)]?.label : TEMI[k]?.label;
                      return (
                        <button key={k} onClick={() => onFiltra({ fase: String(r.fase.id), tema: k.startsWith("metrica:") ? "derivati" : k })}
                          className="st-btn rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: C.riga, background: C.carta }}>
                          {etichetta} <span style={{ fontFamily: F.mono, color: C.muto }}>{n}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {Object.keys(r.perNatura).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(r.perNatura).map(([k, n]) => {
                      const [col, bg] = COLORE_NATURA[k] || [C.muto, C.fondo];
                      return <Pillola key={k} colore={col} sfondo={bg}>{NATURE[k]?.label} {n}</Pillola>;
                    })}
                  </div>
                )}
                {r.tipi.length > 0 && <p className="mt-2 st-eyebrow" style={{ color: C.muto }}>da: {r.tipi.join(" · ")}</p>}
                {r.totale === 0 && !r.xbrl && <p className="mt-2 text-xs" style={{ color: C.allarme }}>Nessun materiale ancora: controlla la scheda «Copertura» per sapere quali documenti alimentano questa fase.</p>}
              </div>
            );
          })}
        </div>
      </Scheda>
      <Scheda>
        <Intestazione icona={<Info size={14} />} titolo="Tabella dei temi" nota="Per ogni tema, le fasi che lo ricevono." />
        <div className="px-4 pb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: C.fondo }}>
                <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Tema</th>
                {FASI_ANALISI.filter((f) => f.id > 0).map((f) => <th key={f.id} className="px-2 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>F{f.id}</th>)}
              </tr>
            </thead>
            <tbody>
              {ID_TEMI.map((t) => (
                <tr key={t} className="border-t" style={{ borderColor: C.rigaTenue }}>
                  <td className="px-2 py-1" title={TEMI[t].desc}>{TEMI[t].label}</td>
                  {FASI_ANALISI.filter((f) => f.id > 0).map((f) => (
                    <td key={f.id} className="text-center px-2 py-1">{TEMI[t].fasi.includes(f.id) ? <span style={{ color: C.periodico }}>●</span> : <span style={{ color: C.riga }}>·</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Scheda>
    </div>
  );
}

/* ── Mappa delle fonti (colonna laterale) ───────────────────────────── */
function MappaFonti({ stato }) {
  const nEstratti = (layer) => stato.documenti.filter((d) => d.layer === layer).reduce((s, d) => s + (stato.estratti[d.id] || []).length, 0);
  return (
    <Scheda>
      <Intestazione icona={<Layers size={14} />} titolo="Base informativa" nota="Documenti ed estratti per livello informativo, dal più vincolante al meno." />
      <div className="px-4 pb-4 space-y-1.5">
        {AREE.map((a) => {
          const docs = stato.documenti.filter((d) => d.layer === a.layer).length;
          return (
            <div key={a.layer} className="flex items-center gap-2 rounded-sm px-3 py-2" style={{ background: docs ? a.tenue : C.fondo, borderLeft: `3px solid ${docs ? a.colore : C.riga}` }}>
              <span className="st-eyebrow flex-1" style={{ color: docs ? a.colore : C.muto }}>{a.label}</span>
              <span className="text-xs" style={{ fontFamily: F.mono, color: C.muto }}>{docs} doc · {nEstratti(a.layer)} estr.</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 rounded-sm px-3 py-2" style={{ background: Object.keys(stato.xbrl).length ? C.annualeTenue : C.fondo, borderLeft: `3px dashed ${C.annuale}` }}>
          <span className="st-eyebrow flex-1" style={{ color: C.annuale }}>Serie XBRL</span>
          <span className="text-xs" style={{ fontFamily: F.mono, color: C.muto }}>{Object.keys(stato.xbrl).length} società</span>
        </div>
      </div>
    </Scheda>
  );
}

/* ==========================================================================
   VISTA FASE 0
   ========================================================================== */
function VistaFase0({ stato, dispatch }) {
  const [scheda, setScheda] = useState("caricamento");
  const [filtroIniziale, setFiltroIniziale] = useState(null);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const catena = useRef(Promise.resolve());
  const segnaleCorrente = useRef({ fermato: false });
  const [inCoda, setInCoda] = useState(0);

  const totEstratti = useMemo(() => Object.values(stato.estratti).reduce((s, l) => s + l.length, 0), [stato.estratti]);

  /* ---- Pipeline completa su un documento --------------------------------- */
  const elaboraDocumento = useCallback(async ({ file, layer, tipo, entitaId, anno, testata, extra }, segnale) => {
    if (segnale.fermato) return;
    const areaEffettiva = areaDelTipo(tipo)?.layer || layer;
    const ent = statoRef.current.entita.find((e) => e.id === entitaId) || null;
    const doc = {
      id: idBreve(),
      etichetta: `${tipo} — ${file.name.replace(/\.(pdf|html?|txt|md)$/i, "")}`,
      tipo, layer: areaEffettiva, nomeFile: file.name, formato: formatoDaFile(file),
      entitaId: entitaId || null, anno: anno || null,
      caricatoIl: new Date().toISOString(), stato: "in_lettura",
      ...(extra || {}),
    };
    if (extra?.origine === "web") doc.etichetta = `${tipo} — ${extra.editore}: ${extra.titolo}`.slice(0, 160);
    dispatch({ tipo: "DOC_REGISTRATO", doc });
    dispatch({ tipo: "LOG", livello: "info", testo: `Acquisito «${file.name}» come ${etichettaTipo(tipo)}${ent ? ` di ${nomeEntita(ent)}` : " (contesto)"}.` });
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: doc.etichetta, fase: "Preparazione delle porzioni", blocco: 0, totale: 0 } });

    let preparato;
    try {
      preparato = await preparaBlocchi(file);
    } catch (err) {
      dispatch({ tipo: "DOC_AGGIORNATO", id: doc.id, patch: { stato: "interrotto", errore: err.message } });
      dispatch({ tipo: "LOG", livello: "errore", testo: `${file.name}: lettura non riuscita — ${err.message}.` });
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      return;
    }
    const { blocchi, testo } = preparato;
    const piano = blocchi[0]?.piano;
    const testataLetta = testo ? riconosciTestata(testo) : testata;
    if (!doc.anno && testataLetta?.anno) dispatch({ tipo: "DOC_AGGIORNATO", id: doc.id, patch: { anno: testataLetta.anno } });
    dispatch({
      tipo: "LOG", livello: blocchi[0]?.stimato ? "attenzione" : "info",
      testo: blocchi[0]?.formato === "pdf"
        ? (blocchi[0]?.stimato ? `${tipo}: taglio per pagine non riuscito (${blocchi[0].motivoStima}); il documento viaggia intero.` : `${tipo}: ${piano.profilo} → ${plurale(blocchi.length, "porzione", "porzioni")} da ${piano.paginePerBlocco} pagine${piano.passateTematiche ? ", riletture tematiche attive" : ""}.`)
        : `${tipo}: testo di ${fmtNumero(testo.length)} caratteri → ${plurale(blocchi.length, "porzione", "porzioni")}; ${plurale(mappaSezioni(testo).length, "intestazione di sezione riconosciuta", "intestazioni di sezione riconosciute")}.`,
    });

    /* Anagrafica dalla copertina, in parallelo: un fallimento qui non deve mai
       fermare l'estrazione, per questo non viene atteso. */
    if (entitaId && ["annuali", "periodici", "volontaria"].includes(areaEffettiva) && blocchi[0]) {
      identificaFrontespizio(blocchi[0], testataLetta)
        .then((esito) => {
          const corrente = statoRef.current.entita.find((e) => e.id === entitaId);
          if (esito.emittente && corrente?.nome && !stessoSoggetto(corrente.nome, esito.emittente)) {
            dispatch({ tipo: "LOG", livello: "attenzione", testo: `«${file.name}»: la copertina indica «${esito.emittente}», ma il documento è attribuito a «${corrente.nome}». Verifica l'attribuzione nell'elenco dei documenti.` });
            return;
          }
          if (esito.anno && !statoRef.current.documenti.find((d) => d.id === doc.id)?.anno) dispatch({ tipo: "DOC_AGGIORNATO", id: doc.id, patch: { anno: String(esito.anno) } });
          dispatch({ tipo: "IDENTIFICAZIONE", entitaId, esito, doc: file.name });
        })
        .catch(() => { /* anagrafica non rilevata: non è un errore di pipeline */ });
    }

    const docPerPrompt = { ...doc, entitaNome: ent?.nome || statoRef.current.entita.find((e) => e.ruolo === "principale")?.nome || null };
    let raccolti = 0;
    const esito = await analizzaDocumento({
      doc: docPerPrompt, blocchi, segnaleStop: segnale,
      onProgresso: (p) => {
        if (p.errore) {
          dispatch({
            tipo: "LOG", livello: p.definitivo || p.ripresa ? "errore" : "attenzione",
            testo: p.definitivo
              ? `Lettura interrotta alla porzione ${p.blocco} di ${p.totale}: ${p.errore}. Non si risolve aspettando: verificare chiave, credito e permessi in «Configurazione IA».`
              : p.ripresa
                ? `Porzione ${p.blocco} di ${p.totale} non recuperata: ${p.errore}. Il suo contenuto non entra nell'analisi.`
                : `Porzione ${p.blocco} di ${p.totale} rinviata (${p.errore}): verrà ripresa a fine documento.`,
          });
          return;
        }
        dispatch({ tipo: "PROGRESSO", elaborazione: { doc: doc.etichetta, fase: p.fase, blocco: p.blocco, totale: p.totale, passata: p.passata } });
      },
      onEstratti: (nuovi, info) => {
        if (nuovi.length) { dispatch({ tipo: "ESTRATTI_AGGIUNTI", docId: doc.id, estratti: nuovi }); raccolti += nuovi.length; }
        if (info.illeggibile) dispatch({ tipo: "LOG", livello: "attenzione", testo: `Porzione ${info.blocco}: risposta del modello non interpretabile, nessun estratto.` });
      },
    });

    const lette = esito.porzioniTotali - esito.nonLette.length;
    const statoDoc = esito.interruzione || esito.fermato ? (lette ? "parziale" : "interrotto") : esito.nonLette.length ? "parziale" : "completato";
    dispatch({ tipo: "DOC_AGGIORNATO", id: doc.id, patch: { stato: statoDoc, porzioni: esito.porzioniTotali, porzioniLette: lette, nonLette: esito.nonLette } });
    const sintesi = esito.fermato
      ? `«${file.name}»: lettura interrotta dall'operatore dopo ${lette} porzioni su ${esito.porzioniTotali} — ${raccolti} estratti conservati.`
      : esito.interruzione
        ? `«${file.name}»: lette ${lette} porzioni su ${esito.porzioniTotali} prima dell'interruzione — ${raccolti} estratti. Il documento è incompleto: rilancialo dopo aver rimosso la causa.`
        : esito.nonLette.length
          ? `«${file.name}»: estrazione parziale, ${raccolti} estratti da ${lette} porzioni su ${esito.porzioniTotali}. Porzioni non lette: ${esito.nonLette.join(", ")}.`
          : `«${file.name}»: ${raccolti} estratti da ${plurale(esito.porzioniTotali, "porzione", "porzioni")} in ${plurale(esito.passateTotali, "passata", "passate")} IA${esito.recuperate ? ` (${esito.recuperate} recuperate alla seconda passata)` : ""}.`;
    dispatch({ tipo: "LOG", livello: statoDoc === "completato" ? "ok" : "attenzione", testo: sintesi });
    dispatch({ tipo: "NOTIFICA", notifica: { testo: sintesi, gravita: statoDoc === "completato" ? "info" : "alta" } });
    dispatch({ tipo: "FINE_ELABORAZIONE" });
  }, [dispatch]);

  /* Coda sequenziale: un documento alla volta, nell'ordine di conferma. Le
     chiamate IA sono già serializzate dal regolatore; la coda tiene leggibile
     il log e permette di interrompere tutto ciò che è in attesa. */
  const accoda = useCallback((richiesta) => {
    const segnale = segnaleCorrente.current;
    setInCoda((n) => n + 1);
    catena.current = catena.current
      .then(() => elaboraDocumento(richiesta, segnale))
      .catch((err) => { dispatch({ tipo: "LOG", livello: "errore", testo: `${richiesta.file.name}: elaborazione interrotta — ${err.message}` }); dispatch({ tipo: "FINE_ELABORAZIONE" }); })
      .finally(() => setInCoda((n) => Math.max(0, n - 1)));
  }, [elaboraDocumento, dispatch]);

  const interrompi = useCallback(() => {
    segnaleCorrente.current.fermato = true;
    segnaleCorrente.current = { fermato: false };
    dispatch({ tipo: "LOG", livello: "attenzione", testo: "Interruzione richiesta: la porzione in corso viene completata, i documenti in coda non vengono letti." });
  }, [dispatch]);

  const occupata = !!stato.elaborazione || inCoda > 0;
  const schede = [
    ["caricamento", "Caricamento", Upload],
    ["copertura", "Copertura", Check],
    ["estratti", `Estratti (${totEstratti})`, Languages],
    ["instradamento", "Instradamento", GitBranch],
  ];

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 0 · Base informativa</span>
          <span className="text-xs" style={{ color: C.muto }}>
            {plurale(stato.documenti.length, "documento", "documenti")} · {plurale(totEstratti, "estratto", "estratti")} · {plurale(stato.entita.length, "società", "società")}
            {inCoda > 1 ? ` · ${inCoda - 1} in coda` : ""}
          </span>
          <nav className="ml-auto flex rounded-md overflow-x-auto border" style={{ borderColor: C.riga }}>
            {schede.map(([k, l, Icona]) => (
              <button key={k} onClick={() => setScheda(k)} className="st-btn flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap border-r last:border-r-0"
                style={{ borderColor: C.riga, background: scheda === k ? C.inchiostro : C.carta, color: scheda === k ? "#fff" : C.muto, fontFamily: F.mono, fontSize: 12 }}>
                <Icona size={12} /> {l}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {stato.notifica && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
          <div className="flex items-start gap-3 rounded-md border px-4 py-3" style={{ borderColor: stato.notifica.gravita === "alta" ? C.ambra : C.riga, background: stato.notifica.gravita === "alta" ? C.ambraTenue : C.carta }}>
            <Info size={16} className="mt-0.5 shrink-0" style={{ color: stato.notifica.gravita === "alta" ? C.ambra : C.muto }} />
            <p className="text-sm flex-1">{stato.notifica.testo}</p>
            <button onClick={() => dispatch({ tipo: "NOTIFICA", notifica: null })} aria-label="Chiudi notifica"><X size={14} style={{ color: C.muto }} /></button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {scheda === "caricamento" && (
            <>
              <PannelloEntita entita={stato.entita} documenti={stato.documenti} xbrl={stato.xbrl} dispatch={dispatch} />
              <PannelloXbrl entita={stato.entita} xbrl={stato.xbrl} dispatch={dispatch} />
              {AREE.map((a) => (
                <Dropzone key={a.layer} area={a} entita={stato.entita} estratti={stato.estratti}
                  documenti={stato.documenti.filter((d) => d.layer === a.layer)}
                  onAvvia={accoda} occupata={occupata}
                  onRimuovi={(id) => dispatch({ tipo: "DOC_RIMOSSO", id })}
                  onRiattribuisci={(id, entitaId) => dispatch({ tipo: "DOC_RIATTRIBUITO", id, entitaId })}
                  ricercaWeb={RICERCA_WEB[a.layer] ? <RicercaWeb area={a} stato={stato} onAvvia={accoda} occupata={occupata} /> : null} />
              ))}
            </>
          )}
          {scheda === "copertura" && <VistaCopertura stato={stato} />}
          {scheda === "estratti" && <VistaEstratti key={JSON.stringify(filtroIniziale)} stato={stato} filtroIniziale={filtroIniziale} />}
          {scheda === "instradamento" && <VistaInstradamento stato={stato} onFiltra={(f) => { setFiltroIniziale(f); setScheda("estratti"); }} />}
        </div>
        <aside className="space-y-6 min-w-0">
          <MappaFonti stato={stato} />
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={interrompi} />
        </aside>
      </main>
    </>
  );
}

/* ── Fasi non ancora costruite ──────────────────────────────────────── */
function VistaFaseInCostruzione({ fase, stato }) {
  const materiale = useMemo(() => materialePerFase(stato, fase.id), [stato, fase.id]);
  const Icona = fase.icona;
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <Scheda>
        <div className="p-6">
          <div className="flex items-center gap-2"><Icona size={18} style={{ color: C.periodico }} /><span className="st-eyebrow" style={{ color: C.muto }}>{fase.occhiello} · in costruzione</span></div>
          <h2 className="mt-2 text-xl" style={{ fontFamily: F.display, fontWeight: 700 }}>{fase.titolo}</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muto }}>{fase.descrizione}</p>
          <div className="mt-4 rounded-md p-3 text-sm" style={{ background: C.periodicoTenue }}>
            Materiale già pronto per questa fase: <b>{plurale(materiale.estratti.length, "estratto", "estratti")}</b> da {plurale(materiale.documenti.length, "documento", "documenti")}
            {Object.keys(materiale.xbrl).length ? <>, più <b>{plurale(Object.keys(materiale.xbrl).length, "serie XBRL", "serie XBRL")}</b></> : null}.
          </div>
        </div>
      </Scheda>
    </main>
  );
}

/* ==========================================================================
   [11] GUSCIO DELL'APPLICAZIONE
   ========================================================================== */
export default function AppAnalisiStrategica() {
  const [stato, dispatch] = useReducer(reducer, statoIniziale);
  const [fase, setFase] = useState(0);
  const [esitoFile, setEsitoFile] = useState(null);
  const [confermaAzzera, setConfermaAzzera] = useState(false);
  const fileRef = useRef(null);
  const principale = stato.entita.find((e) => e.ruolo === "principale");

  const salva = () => {
    const dati = componiSalvataggio(stato);
    const nome = (dati.azienda || "analisi").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "analisi";
    scaricaJson(dati, `strategica_${nome}_${new Date().toISOString().slice(0, 10)}.json`);
    setEsitoFile({ livello: "ok", testo: `Salvati ${plurale(dati.riepilogo.documenti, "documento", "documenti")} e ${plurale(dati.riepilogo.estratti, "estratto", "estratti")}. I file originali non sono nel salvataggio: ciò che ne è stato estratto sì.` });
  };

  const carica = async (file) => {
    try {
      let dati;
      try { dati = JSON.parse(await file.text()); } catch { throw new Error("il file non è un JSON valido"); }
      const esito = interpretaSalvataggio(dati);
      dispatch({ tipo: "RIPRISTINO", stato: esito.stato, messaggio: esito.messaggio });
      setEsitoFile({ livello: "ok", testo: esito.messaggio });
      setFase(0);
    } catch (err) {
      setEsitoFile({ livello: "errore", testo: `Caricamento non riuscito: ${err.message}.` });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const azzera = () => {
    if (!confermaAzzera) { setConfermaAzzera(true); setTimeout(() => setConfermaAzzera(false), 4000); return; }
    setConfermaAzzera(false);
    dispatch({ tipo: "AZZERA" });
    setEsitoFile(null);
    setFase(0);
  };

  const faseCorrente = FASI_ANALISI.find((f) => f.id === fase);
  const nEstratti = Object.values(stato.estratti).reduce((s, l) => s + l.length, 0);

  return (
    <div className="min-h-screen w-full" style={{ background: C.fondo, fontFamily: F.testo, color: C.inchiostro }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .st-eyebrow { font-family: ${F.mono}; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
        .st-scroll::-webkit-scrollbar { width: 8px; }
        .st-scroll::-webkit-scrollbar-thumb { background: ${C.riga}; border-radius: 4px; }
        .st-btn:focus-visible { outline: 2px solid ${C.periodico}; outline-offset: 2px; }
        button:disabled { cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      <header className="border-b" style={{ borderColor: C.riga, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="st-eyebrow" style={{ color: C.muto }}>Analisi fondamentale · contesto e strategie</div>
            <h1 className="mt-1 text-2xl sm:text-3xl" style={{ fontFamily: F.display, fontWeight: 800, letterSpacing: "-0.02em" }}>Analisi Strategica</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muto }}>
              {principale.nome ? <>{principale.nome}{principale.ticker ? ` · ${principale.ticker}` : ""}{stato.entita.length > 1 ? ` · ${plurale(stato.entita.length - 1, "peer", "peer")}` : ""}</> : "Esterna e interna · società registrate presso la SEC"}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md px-3 py-1.5" style={{ background: C.fondo }}>
            <span className="st-eyebrow" style={{ color: C.muto }}>Estratti</span>
            <span style={{ fontFamily: F.display, fontWeight: 700 }}>{fmtNumero(nEstratti)}</span>
          </div>
        </div>

        <div className="border-t" style={{ borderColor: C.rigaTenue, background: C.fondo }}>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-2">
            <nav className="flex rounded-md overflow-x-auto border max-w-full" style={{ borderColor: C.riga, background: C.carta }}>
              {FASI_ANALISI.map((f) => {
                const Icona = f.icona;
                const attiva = fase === f.id;
                return (
                  <button key={f.id} onClick={() => setFase(f.id)} title={f.pronta ? f.titolo : `${f.titolo} — in costruzione`}
                    className="st-btn flex items-center gap-1.5 px-2.5 py-2 border-r last:border-r-0 shrink-0 whitespace-nowrap"
                    style={{ borderColor: C.riga, background: attiva ? C.inchiostro : C.carta, color: attiva ? "#fff" : f.pronta ? C.inchiostro : C.muto }}>
                    {f.pronta ? <Icona size={12} /> : <Lock size={11} />}
                    <span className="st-eyebrow" style={{ color: "inherit", fontSize: "0.62rem" }}>{f.occhiello}</span>
                  </button>
                );
              })}
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button onClick={salva} className="st-btn flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.riga, background: C.carta }}>
                <Save size={14} style={{ color: C.annuale }} /> Salva
              </button>
              <button onClick={() => fileRef.current?.click()} className="st-btn flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.riga, background: C.carta }}>
                <FolderOpen size={14} style={{ color: C.periodico }} /> Carica
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && carica(e.target.files[0])} />
              <button onClick={() => esportaEstrattiCsv(stato)} disabled={!nEstratti} className="st-btn flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.riga, background: C.carta, opacity: nEstratti ? 1 : 0.5 }}>
                <ArrowRight size={14} style={{ color: C.muto }} /> Estratti CSV
              </button>
              <button onClick={azzera} className="st-btn flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: confermaAzzera ? C.allarme : C.riga, background: confermaAzzera ? C.allarmeTenue : C.carta, color: confermaAzzera ? C.allarme : C.muto }}>
                <RefreshCw size={14} /> {confermaAzzera ? "Conferma azzeramento" : "Azzera"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <PannelloIA />

      {esitoFile && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
          <div className="flex items-start gap-3 rounded-md border px-4 py-3" style={{ borderColor: esitoFile.livello === "errore" ? C.allarme : C.ok, background: esitoFile.livello === "errore" ? C.allarmeTenue : C.okTenue }}>
            {esitoFile.livello === "errore" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: C.allarme }} /> : <Check size={16} className="mt-0.5 shrink-0" style={{ color: C.ok }} />}
            <p className="text-sm flex-1">{esitoFile.testo}</p>
            <button onClick={() => setEsitoFile(null)} aria-label="Chiudi messaggio"><X size={14} style={{ color: C.muto }} /></button>
          </div>
        </div>
      )}

      {fase === 0 ? <VistaFase0 stato={stato} dispatch={dispatch} />
        : fase === 1 ? <VistaFase1 stato={stato} dispatch={dispatch} />
        : fase === 2 ? <VistaFase2 stato={stato} dispatch={dispatch} />
        : fase === 3 ? <VistaFase3 stato={stato} dispatch={dispatch} />
        : fase === 4 ? <VistaFase4 stato={stato} dispatch={dispatch} />
        : fase === 5 ? <VistaFase5 stato={stato} dispatch={dispatch} />
        : fase === 6 ? <VistaFase6 stato={stato} dispatch={dispatch} />
        : <VistaFaseInCostruzione fase={faseCorrente} stato={stato} />}

      <footer className="mx-auto max-w-7xl px-4 sm:px-6 pb-8 text-xs" style={{ color: C.muto }}>
        <Newspaper size={12} className="inline mr-1" /> Gli estratti sono trascrizioni letterali con traduzione: ogni giudizio delle fasi successive citerà documento, sezione e pagina.
      </footer>
    </div>
  );
}

/* ==========================================================================
   [12] FASE 1 — PROFILO E PERIMETRO
   --------------------------------------------------------------------------
   Quattro sezioni, ciascuna costruita dall'IA SOLO sugli estratti della Fase 0
   e confermata o corretta dall'operatore:
     1A Identità                 → missione, visione, valori, codice etico
     1B Modello di business      → livello strategico, operativo, economico
     1C Segmenti e ASA           → segmenti, serie, peso, unità di analisi
     1D Perimetro competitivo    → confini del mercato, basi della competizione, concorrenti
   Il livello economico-finanziario del modello di business non passa dall'IA:
   è calcolato dalle serie XBRL. Le affermazioni del management che emergono
   qui vengono raccolte come «da verificare» e consegnate alla Fase 4.

   Regola delle evidenze: ogni elemento proposto deve citare almeno un
   estratto. Le citazioni che non corrispondono a un estratto reale vengono
   scartate, e un elemento rimasto senza citazioni è marcato «non supportato»:
   non sparisce, ma non può essere scambiato per un fatto documentato.
   ========================================================================== */

const SEZIONI_FASE1 = [
  { id: "identita", titolo: "1A · Identità", icona: Target, temi: ["identita"], supporto: ["strategia", "capitale_relazionale"],
    nota: "Chi la società dice di essere: missione, visione, valori, codice etico (§4.2). Distingue ciò che è dichiarato come tale da ciò che è ricostruito dalla descrizione." },
  { id: "modello", titolo: "1B · Modello di business", icona: Layers, temi: ["modello_business", "clienti"], supporto: ["strategia", "operations", "innovazione", "fornitori", "capitale_relazionale"],
    nota: "La «ricetta» con cui l'azienda crea e trattiene valore, su tre livelli (§4.1): strategico, operativo, economico-finanziario. Il terzo livello è calcolato dai dati XBRL." },
  { id: "segmenti", titolo: "1C · Segmenti e ASA", icona: BarChart3, temi: ["segmenti"], supporto: ["modello_business", "kpi_operativi"],
    nota: "Le aree strategiche d'affari (§3.6, §4.3). I segmenti che superano la soglia di peso diventano le unità su cui si ripete l'analisi esterna e interna." },
  { id: "perimetro", titolo: "1D · Perimetro competitivo e peer", icona: Compass, temi: ["concorrenza"], supporto: ["mercato_domanda", "barriere_sostituti", "clienti"],
    contesto: true, metriche: ["quota_mercato", "dimensione_mercato", "crescita_mercato", "giudizio_strategico"],
    nota: "Il «recinto» in cui l'impresa gioca (§3.6): confini del mercato dal lato della domanda e dell'offerta, basi della competizione, concorrenti nominati e loro tipo." },
];
const sezioneFase1 = (id) => SEZIONI_FASE1.find((s) => s.id === id);
const MAX_ESTRATTI_PER_SEZIONE = 110;
const SOGLIA_ASA_PREDEFINITA = 10;

/**
 * Selezione degli estratti per una sezione: prima i temi propri, poi quelli di
 * supporto; dentro ciascun gruppo prima la rilevanza alta e la fonte più
 * autorevole. Le ripetizioni accorpate dal consolidamento non entrano: al
 * modello arriva la capofila con il numero di conferme.
 */
function selezionaEstratti(stato, entitaId, sezione) {
  const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
  const consolidato = consolidaEstratti(stato.documenti, stato.estratti);
  const principale = stato.entita.find((e) => e.id === entitaId)?.ruolo === "principale";
  const tutti = Object.values(stato.estratti).flat().filter((e) => metaDoc[e.docId]);
  const idPeer = new Set(stato.entita.filter((x) => x.ruolo === "peer").map((x) => x.id));
  const nomePer = Object.fromEntries(stato.entita.map((x) => [x.id, nomeEntita(x)]));
  const ammessoPerEntita = (e) => e.entitaId === entitaId
    || (principale && !e.entitaId && sezione.contesto)
    || (principale && sezione.peer && idPeer.has(e.entitaId));
  const pesoRil = { alta: 0, media: 1, bassa: 2 };
  const rango = (e) => areaDelLivello(metaDoc[e.docId]?.layer)?.rango ?? 9;
  const ordina = (a, b) => (pesoRil[a.rilevanza] ?? 1) - (pesoRil[b.rilevanza] ?? 1) || rango(a) - rango(b);

  const testuali = tutti.filter((e) => !e.derivato && ammessoPerEntita(e) && (consolidato.perEstratto[e.id]?.principale ?? true));
  const propri = testuali.filter((e) => sezione.temi.includes(e.tema)).sort(ordina);
  const disupporto = testuali.filter((e) => sezione.supporto.includes(e.tema)).sort(ordina);
  const derivati = sezione.metriche
    ? tutti.filter((e) => e.derivato && sezione.metriche.includes(e.metrica) && (e.entitaId === entitaId || (principale && !e.entitaId)))
    : [];
  const scelti = [...propri, ...derivati, ...disupporto].slice(0, MAX_ESTRATTI_PER_SEZIONE);

  const mappa = {};
  const righe = scelti.map((e, i) => {
    const codice = `E${i + 1}`;
    mappa[codice] = e.id;
    const d = metaDoc[e.docId];
    const conferme = consolidato.perEstratto[e.id]?.nFonti > 1 ? ` · confermato da ${consolidato.perEstratto[e.id].nFonti} fonti` : "";
    const testa = e.derivato
      ? `${METRICHE[e.metrica]?.label} · perimetro ${PERIMETRI[e.perimetro]} · fonte ${e.fonte}${e.dataDocumento ? ` del ${e.dataDocumento}` : ""}${e.valore !== null ? ` · valore ${e.valore} ${e.unita}` : ""}`
      : `${TEMI[e.tema]?.label} · ${NATURE[e.natura]?.label}${e.soggetto !== "societa" ? ` · soggetto ${SOGGETTI[e.soggetto]}${e.nomeSoggetto ? ` (${e.nomeSoggetto})` : ""}` : ""}`;
    const dati = (e.datiNumerici || []).length ? `\n  dati: ${e.datiNumerici.map((x) => `${x.voce} = ${x.valore} ${x.unita || ""}${x.periodo ? ` (${x.periodo})` : ""}`).join("; ")}` : "";
    const diAltri = e.entitaId && e.entitaId !== entitaId ? ` · documento di ${nomePer[e.entitaId]} (peer)` : !e.entitaId ? " · fonte di contesto" : "";
    return `[${codice}] ${d.tipo}${d.anno ? ` ${d.anno}` : ""}${diAltri}${e.sezione ? ` · ${e.sezione}` : ""}${e.pagina ? ` · p. ${e.pagina}` : ""}${e.periodo ? ` · periodo ${e.periodo}` : ""} · ${testa}${conferme}\n  ${String(e.traduzioneIt || e.testoOriginale).slice(0, 700)}${dati}`;
  });
  return { testo: righe.join("\n\n"), mappa, quanti: scelti.length, propri: propri.length };
}

const SYSTEM_FASE1 = `Sei un analista strategico che redige il profilo di una società per un'analisi
fondamentale. Lavori ESCLUSIVAMENTE sugli estratti forniti: citazioni letterali, tradotte, prese dai
documenti della società e da fonti di contesto, ciascuna con un codice [E#].

REGOLE
- Non usare conoscenze esterne sulla società o sul settore, nemmeno se le ritieni certe.
- Ogni elemento che proponi deve indicare in "evidenze" i codici degli estratti che lo sostengono.
  Un elemento senza evidenze non va proposto: indicalo invece in "lacune".
- Distingui ciò che la società dichiara di sé (affermazioni, da verificare) dai fatti documentati.
- Sii sintetico e preciso; scrivi in italiano, con terminologia economico-aziendale italiana.
- Le cifre vanno riportate esattamente come negli estratti, con unità e periodo.
- Rispondi esclusivamente con un oggetto JSON valido, senza testo introduttivo né markdown.`;

const SCHEMI_FASE1 = {
  identita: `{
  "missione": { "testo": "<missione>", "dichiarata": <true se il documento la presenta esplicitamente come missione/scopo, false se ricostruita>, "evidenze": ["E#"] } | null,
  "visione": { "testo": "...", "dichiarata": <bool>, "evidenze": ["E#"] } | null,
  "valori": [ { "testo": "<valore>", "evidenze": ["E#"] } ],
  "codice_etico": { "testo": "<esistenza e contenuto essenziale>", "evidenze": ["E#"] } | null,
  "sintesi": { "testo": "<2-3 frasi: chi la società dice di essere>", "evidenze": ["E#"] },
  "lacune": ["<elemento dell'identità non documentato dagli estratti>"]
}`,
  modello: `{
  "livello_strategico": {
    "sintesi": { "testo": "<chi siamo e dove andiamo: identità e scelte strategiche di fondo>", "evidenze": ["E#"] },
    "scelte": [ { "testo": "<scelta strategica dichiarata (corporate o competitiva)>", "evidenze": ["E#"] } ]
  },
  "livello_operativo": {
    "offerta": { "testo": "<prodotti e servizi>", "evidenze": ["E#"] } | null,
    "clienti_target": { "testo": "<segmenti di clientela, concentrazione>", "evidenze": ["E#"] } | null,
    "canali": { "testo": "<canali di vendita e distribuzione>", "evidenze": ["E#"] } | null,
    "modello_ricavo": { "testo": "<come si generano i ricavi: vendita, abbonamento, licenza, servizi ricorrenti…>", "evidenze": ["E#"] } | null,
    "risorse_chiave": { "testo": "<tecnologie, marchi, impianti, competenze>", "evidenze": ["E#"] } | null,
    "attivita_chiave": { "testo": "<attività svolte internamente vs esternalizzate>", "evidenze": ["E#"] } | null,
    "partner_fornitori": { "testo": "<fornitori e partner critici>", "evidenze": ["E#"] } | null
  },
  "affermazioni_da_verificare": [
    { "testo": "<affermazione del management su sé stesso o sulla propria posizione>", "kpi_suggeriti": ["<indicatore di bilancio con cui verificarla>"], "evidenze": ["E#"] }
  ],
  "lacune": ["..."]
}`,
  segmenti: `{
  "criterio": "attivita" | "geografico" | "prodotto" | "misto" | null,
  "segmenti": [
    { "nome": "<nome del segmento come nel documento>", "tipo": "attivita" | "geografico" | "prodotto",
      "descrizione": "<che cosa comprende>",
      "serie": [ { "anno": <intero>, "ricavi": <numero o null>, "risultato": <risultato del segmento o null>, "unita": "<es. USD milioni>" } ],
      "evidenze": ["E#"] }
  ],
  "aree_geografiche": [
    { "nome": "<area>", "serie": [ { "anno": <intero>, "ricavi": <numero o null>, "unita": "<unità>" } ], "evidenze": ["E#"] }
  ],
  "lacune": ["..."]
}
Riporta i valori ESATTAMENTE come negli estratti e nella stessa unità; se gli estratti riportano unità
diverse per anni diversi, indica per ogni anno la sua unità. Non calcolare quote o somme: le calcola il sistema.`,
  perimetro: `{
  "definizione_mercato": {
    "domanda": { "testo": "<quali bisogni e quali prodotti i clienti considerano sostituibili>", "evidenze": ["E#"] } | null,
    "offerta": { "testo": "<tecnologie e processi che accomunano i concorrenti>", "evidenze": ["E#"] } | null,
    "geografia": { "testo": "<ambito geografico della competizione>", "evidenze": ["E#"] } | null
  },
  "basi_competizione": [ { "testo": "<fattore su cui si compete: prezzo, qualità, marchio, tecnologia, servizio…>", "evidenze": ["E#"] } ],
  "concorrenti": [
    { "nome": "<denominazione>", "tipo": "diretto" | "indiretto" | "potenziale",
      "segmenti": ["<segmento o ASA in cui compete>"], "motivo": "<perché è un concorrente, secondo gli estratti>", "evidenze": ["E#"] }
  ],
  "quote_mercato": [
    { "soggetto": "<società o concorrente>", "valore": <numero o null>, "unita": "%", "periodo": "<periodo>",
      "fonte_tipo": "dichiarata dalla società" | "terzi", "evidenze": ["E#"] }
  ],
  "lacune": ["..."]
}
"diretto" = stesso prodotto per gli stessi clienti; "indiretto" = prodotto sostitutivo o segmento contiguo;
"potenziale" = possibile nuovo entrante citato negli estratti.`,
};

/**
 * Pulizia delle citazioni: tiene solo i codici che esistono, li traduce in id
 * di estratto e marca come non supportato ogni elemento rimasto senza
 * evidenze. Lavora ricorsivamente su qualunque forma dello schema.
 */
function validaEvidenze(nodo, mappa, usati = new Set()) {
  if (Array.isArray(nodo)) return nodo.map((x) => validaEvidenze(x, mappa, usati)).filter((x) => x !== null && x !== undefined);
  if (!nodo || typeof nodo !== "object") return nodo;
  const out = {};
  for (const [k, v] of Object.entries(nodo)) {
    if (k === "evidenze") continue;
    out[k] = validaEvidenze(v, mappa, usati);
  }
  if ("evidenze" in nodo || "testo" in nodo) {
    const codici = Array.isArray(nodo.evidenze) ? nodo.evidenze.map((c) => String(c).replace(/[^\w]/g, "").toUpperCase()) : [];
    const validi = Array.from(new Set(codici.filter((c) => mappa[c])));
    validi.forEach((c) => usati.add(c));
    out.evidenze = validi.map((c) => mappa[c]);
    if (!validi.length) out.nonSupportato = true;
  }
  return out;
}

async function generaSezioneFase1({ stato, entitaId, sezioneId }) {
  const sezione = sezioneFase1(sezioneId);
  const ent = stato.entita.find((e) => e.id === entitaId);
  const sel = selezionaEstratti(stato, entitaId, sezione);
  if (!sel.quanti) {
    const err = new Error(`nessun estratto disponibile per ${sezione.titolo}: in Fase 0 non sono stati estratti frammenti sui temi ${[...sezione.temi, ...sezione.supporto].map((t) => TEMI[t].label).join(", ")}.`);
    err.vuoto = true;
    throw err;
  }
  const peerNoti = stato.entita.filter((e) => e.id !== entitaId && e.nome).map((e) => e.nome);
  const testo = await chiamataIA({
    system: SYSTEM_FASE1,
    contenuto: `SOCIETÀ: ${nomeEntita(ent)}${ent.ticker ? ` (${ent.ticker})` : ""}${ent.settore ? ` — settore dichiarato: ${ent.settore}` : ""}
SEZIONE: ${sezione.titolo}. ${sezione.nota}
${sezioneId === "perimetro" && peerNoti.length ? `Società già registrate nell'analisi: ${peerNoti.join(", ")}.\n` : ""}
ESTRATTI (${sel.quanti}):
${sel.testo}

Restituisci esattamente questa struttura:
${SCHEMI_FASE1[sezioneId]}`,
    maxTokens: 6000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object") throw new Error("risposta del modello non interpretabile");
  const usati = new Set();
  const dati = validaEvidenze(json, sel.mappa, usati);
  return { dati, estrattiForniti: sel.quanti, evidenzeUsate: usati.size, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}` };
}

/* --- Livello economico-finanziario: deterministico, dalle serie XBRL ------- */
const rapporto = (a, b) => (a === undefined || b === undefined || a === null || b === null || !b ? null : a / b);
function indicatoriEconomici(dati) {
  if (!dati?.serie) return null;
  const s = (k) => dati.serie[k]?.valori || {};
  const anni = dati.anni.filter((a) => s("ricavi")[a] !== undefined).slice(-6);
  if (!anni.length) return null;
  const riga = (id, label, fn, formato = "%") => ({ id, label, formato, valori: Object.fromEntries(anni.map((a, i) => [a, fn(a, anni[i - 1])])) });
  const pct = (x) => (x === null ? null : x * 100);
  const righe = [
    riga("crescita", "Crescita dei ricavi", (a, p) => (p ? pct(rapporto(s("ricavi")[a] - s("ricavi")[p], s("ricavi")[p])) : null)),
    riga("margineLordo", "Margine lordo / ricavi", (a) => pct(rapporto(s("utileLordo")[a] ?? (s("costoVenduto")[a] !== undefined ? s("ricavi")[a] - s("costoVenduto")[a] : undefined), s("ricavi")[a]))),
    riga("margineOperativo", "Risultato operativo / ricavi", (a) => pct(rapporto(s("risultatoOperativo")[a], s("ricavi")[a]))),
    riga("margineNetto", "Utile netto / ricavi", (a) => pct(rapporto(s("utileNetto")[a], s("ricavi")[a]))),
    riga("rs", "R&S / ricavi", (a) => pct(rapporto(s("rs")[a], s("ricavi")[a]))),
    riga("sga", "Spese comm. gen. amm.ve / ricavi", (a) => pct(rapporto(s("sga")[a], s("ricavi")[a]))),
    riga("pubblicita", "Pubblicità / ricavi", (a) => pct(rapporto(s("pubblicita")[a], s("ricavi")[a]))),
    riga("capex", "Investimenti / ricavi", (a) => pct(rapporto(s("capex")[a], s("ricavi")[a]))),
    riga("capexAmm", "Investimenti / ammortamenti", (a) => rapporto(s("capex")[a], s("ammortamenti")[a]), "x"),
    riga("cassaUtile", "Flusso operativo / utile netto", (a) => rapporto(s("cfo")[a], s("utileNetto")[a]), "x"),
    riga("rotazione", "Ricavi / totale attivo", (a) => rapporto(s("ricavi")[a], s("totaleAttivo")[a]), "x"),
    riga("ricaviDip", "Ricavi per dipendente (migliaia)", (a) => (s("dipendenti")[a] ? s("ricavi")[a] / s("dipendenti")[a] / 1000 : null), "n"),
  ].filter((r) => Object.values(r.valori).some((v) => v !== null && isFinite(v)));
  const primo = anni[0], ultimo = anni[anni.length - 1];
  const cagr = anni.length > 1 && s("ricavi")[primo] > 0 ? (Math.pow(s("ricavi")[ultimo] / s("ricavi")[primo], 1 / (ultimo - primo)) - 1) * 100 : null;
  return { anni, righe, cagr, primo, ultimo };
}

/** Pesi dei segmenti, calcolati dal sistema e non dal modello: stesso anno, stessa unità. */
function pesiSegmenti(segmenti = []) {
  const perAnno = {};
  for (const sg of segmenti) {
    for (const p of sg.serie || []) {
      if (typeof p.ricavi !== "number" || !isFinite(p.ricavi) || !p.anno) continue;
      const k = `${p.anno}|${(p.unita || "").toLowerCase()}`;
      (perAnno[k] = perAnno[k] || []).push({ nome: sg.nome, ricavi: p.ricavi });
    }
  }
  const chiavi = Object.keys(perAnno).sort((a, b) => Number(b.split("|")[0]) - Number(a.split("|")[0]) || perAnno[b].length - perAnno[a].length);
  if (!chiavi.length) return { anno: null, unita: null, pesi: {} };
  const [anno, unita] = chiavi[0].split("|");
  const voci = perAnno[chiavi[0]];
  const totale = voci.reduce((t, v) => t + Math.max(0, v.ricavi), 0);
  return { anno: Number(anno), unita, totale, pesi: Object.fromEntries(voci.map((v) => [v.nome, totale ? (Math.max(0, v.ricavi) / totale) * 100 : null])) };
}

/** Profilo confermato, nella forma che le fasi successive leggeranno. */
function profiloFase1(stato, entitaId) {
  const f = stato.fase1?.[entitaId];
  if (!f) return null;
  const sez = (id) => (f.sezioni[id] && f.sezioni[id].stato !== "proposto" ? f.sezioni[id].dati : null);
  const seg = sez("segmenti");
  const pesi = pesiSegmenti(seg?.segmenti);
  const soglia = f.sogliaAsa ?? SOGLIA_ASA_PREDEFINITA;
  const asa = (seg?.segmenti || []).filter((s) => (f.asa?.[s.nome] ?? ((pesi.pesi[s.nome] ?? 0) >= soglia))).map((s) => ({ ...s, peso: pesi.pesi[s.nome] ?? null }));
  return {
    identita: sez("identita"),
    modello: sez("modello"),
    segmenti: seg, asa, pesi,
    perimetro: sez("perimetro"),
    affermazioniDaVerificare: sez("modello")?.affermazioni_da_verificare || [],
    economico: indicatoriEconomici(stato.xbrl[entitaId]),
  };
}

/* --- Utilità per modifiche puntuali dell'operatore ---------------------- */
function impostaIn(oggetto, percorso, valore) {
  if (!percorso.length) return valore;
  const [testa, ...coda] = percorso;
  const base = Array.isArray(oggetto) ? [...oggetto] : { ...(oggetto || {}) };
  base[testa] = impostaIn(base[testa], coda, valore);
  return base;
}

/* ==========================================================================
   [13] INTERFACCIA DELLA FASE 1
   ========================================================================== */

const STATO_SEZIONE = {
  proposto: { label: "proposta IA · da confermare", colore: C.ambra, sfondo: C.ambraTenue },
  modificato: { label: "modificata dall'operatore", colore: C.periodico, sfondo: C.periodicoTenue },
  confermato: { label: "confermata", colore: C.ok, sfondo: C.okTenue },
};

/** Citazioni di un elemento: pillole numerate che aprono il testo degli estratti. */
function Evidenze({ ids = [], indice }) {
  const [aperto, setAperto] = useState(false);
  if (!ids.length) return null;
  return (
    <span className="inline">
      <button onClick={() => setAperto((a) => !a)} className="st-btn ml-1 align-middle rounded px-1.5" title="Mostra le citazioni"
        style={{ background: C.periodicoTenue, color: C.periodico, fontFamily: F.mono, fontSize: 10 }}>
        {plurale(ids.length, "fonte", "fonti")} {aperto ? "▴" : "▾"}
      </button>
      {aperto && (
        <span className="block mt-1.5 space-y-1.5">
          {ids.map((id) => {
            const r = indice[id];
            if (!r) return <span key={id} className="block text-xs" style={{ color: C.muto }}>estratto non più disponibile (documento rimosso)</span>;
            const { e, d } = r;
            return (
              <span key={id} className="block rounded border-l-2 pl-2 py-1 text-xs" style={{ borderColor: areaDelLivello(d?.layer)?.colore || C.riga, background: C.fondo }}>
                <span className="st-eyebrow block" style={{ color: C.muto }}>
                  {d?.tipo}{d?.anno ? ` ${d.anno}` : ""}{e.sezione ? ` · ${e.sezione}` : ""}{e.pagina ? ` · p. ${e.pagina}` : ""}
                </span>
                {e.traduzioneIt || e.testoOriginale}
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

/** Un elemento del profilo: testo, citazioni, segnale «non supportato», modifica in linea. */
function Voce({ etichetta, nodo, percorso, onModifica, indice, extra }) {
  const [modifica, setModifica] = useState(false);
  const [bozza, setBozza] = useState("");
  if (!nodo) {
    return etichetta ? (
      <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
        <div className="st-eyebrow" style={{ color: C.muto }}>{etichetta}</div>
        <p className="text-xs italic" style={{ color: C.muto }}>Non documentato negli estratti.</p>
      </div>
    ) : null;
  }
  return (
    <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
      {etichetta && (
        <div className="flex items-center gap-2">
          <span className="st-eyebrow" style={{ color: C.muto }}>{etichetta}</span>
          {extra}
        </div>
      )}
      {modifica ? (
        <div className="mt-1 space-y-1">
          <textarea value={bozza} onChange={(e) => setBozza(e.target.value)} rows={3} className="w-full rounded border p-2 text-sm" style={{ borderColor: C.periodico }} />
          <div className="flex gap-2">
            <button onClick={() => { onModifica([...percorso, "testo"], bozza.trim()); setModifica(false); }} className="st-btn rounded px-3 py-1 text-xs" style={{ background: C.periodico, color: "#fff" }}>Salva</button>
            <button onClick={() => setModifica(false)} className="st-btn rounded border px-3 py-1 text-xs" style={{ borderColor: C.riga }}>Annulla</button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed">
          {nodo.testo || <span style={{ color: C.muto }}>—</span>}
          {nodo.nonSupportato && <span className="ml-1 rounded px-1.5" style={{ background: C.allarmeTenue, color: C.allarme, fontFamily: F.mono, fontSize: 10 }}>non supportato</span>}
          <Evidenze ids={nodo.evidenze} indice={indice} />
          <button onClick={() => { setBozza(nodo.testo || ""); setModifica(true); }} className="st-btn ml-2 st-eyebrow underline" style={{ color: C.muto }}>modifica</button>
        </p>
      )}
    </div>
  );
}

function Lacune({ lacune }) {
  if (!lacune?.length) return null;
  return (
    <div className="mt-3 rounded-md p-2.5" style={{ background: C.ambraTenue }}>
      <div className="st-eyebrow mb-1" style={{ color: C.ambra }}>Lacune segnalate</div>
      <ul className="list-disc pl-5 text-xs space-y-0.5">{lacune.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

const fmtIndicatore = (v, formato) => (v === null || v === undefined || !isFinite(v) ? "—" : formato === "%" ? `${fmtNumero(v, 1)}%` : formato === "x" ? `${fmtNumero(v, 2)}x` : fmtNumero(v, 0));

/** Livello economico-finanziario: tabella dalle serie XBRL e confronto con i peer sull'ultimo anno. */
function LivelloEconomico({ stato, entitaId }) {
  const ind = indicatoriEconomici(stato.xbrl[entitaId]);
  const peer = stato.entita.filter((e) => e.id !== entitaId && stato.xbrl[e.id]).map((e) => ({ e, ind: indicatoriEconomici(stato.xbrl[e.id]) })).filter((x) => x.ind);
  if (!ind) {
    return <p className="text-xs" style={{ color: C.muto }}>Nessuna serie XBRL per questa società: carica il file companyfacts in Fase 0 per calcolare il livello economico-finanziario.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: C.fondo }}>
              <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Indicatore</th>
              {ind.anni.map((a) => <th key={a} className="text-right px-2 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {ind.righe.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: C.rigaTenue }}>
                <td className="px-2 py-1">{r.label}</td>
                {ind.anni.map((a) => <td key={a} className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtIndicatore(r.valori[a], r.formato)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ind.cagr !== null && <p className="text-xs" style={{ color: C.muto }}>Crescita media annua composta dei ricavi {ind.primo}-{ind.ultimo}: <b style={{ color: C.inchiostro }}>{fmtNumero(ind.cagr, 1)}%</b>.</p>}
      {peer.length > 0 && (
        <div className="overflow-x-auto">
          <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Confronto con i peer · ultimo esercizio disponibile</div>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: C.fondo }}>
                <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Indicatore</th>
                {[{ e: stato.entita.find((x) => x.id === entitaId), ind }, ...peer].map(({ e, ind: i }) => (
                  <th key={e.id} className="text-right px-2 py-1.5" style={{ color: e.id === entitaId ? C.annuale : C.muto }}>{nomeEntita(e)} <span style={{ fontFamily: F.mono }}>{i.ultimo}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ind.righe.filter((r) => r.id !== "crescita" || true).map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: C.rigaTenue }}>
                  <td className="px-2 py-1">{r.label}</td>
                  {[{ e: { id: entitaId }, ind }, ...peer].map(({ e, ind: i }) => {
                    const rr = i.righe.find((x) => x.id === r.id);
                    return <td key={e.id} className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtIndicatore(rr?.valori[i.ultimo], r.formato)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs" style={{ color: C.muto }}>Calcolato senza IA dalle serie XBRL. Spiega come le scelte dei primi due livelli si traducono in ricavi, costi, investimenti e cassa; la verifica di ogni affermazione avviene in Fase 4.</p>
    </div>
  );
}

function CorpoIdentita({ d, mod, indice }) {
  return (
    <>
      <Voce etichetta="Missione" nodo={d.missione} percorso={["missione"]} onModifica={mod} indice={indice}
        extra={d.missione && <Pillola>{d.missione.dichiarata ? "dichiarata" : "ricostruita"}</Pillola>} />
      <Voce etichetta="Visione" nodo={d.visione} percorso={["visione"]} onModifica={mod} indice={indice}
        extra={d.visione && <Pillola>{d.visione.dichiarata ? "dichiarata" : "ricostruita"}</Pillola>} />
      <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
        <div className="st-eyebrow" style={{ color: C.muto }}>Valori</div>
        {(d.valori || []).length ? d.valori.map((v, i) => <Voce key={i} nodo={v} percorso={["valori", i]} onModifica={mod} indice={indice} />)
          : <p className="text-xs italic" style={{ color: C.muto }}>Non documentati negli estratti.</p>}
      </div>
      <Voce etichetta="Codice etico" nodo={d.codice_etico} percorso={["codice_etico"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Sintesi dell'identità" nodo={d.sintesi} percorso={["sintesi"]} onModifica={mod} indice={indice} />
      <Lacune lacune={d.lacune} />
    </>
  );
}

const CAMPI_OPERATIVI = [["offerta", "Offerta"], ["clienti_target", "Clienti"], ["canali", "Canali"], ["modello_ricavo", "Modello di ricavo"], ["risorse_chiave", "Risorse chiave"], ["attivita_chiave", "Attività chiave e esternalizzazione"], ["partner_fornitori", "Partner e fornitori critici"]];

function CorpoModello({ d, mod, indice, stato, entitaId }) {
  const ls = d.livello_strategico || {};
  const lo = d.livello_operativo || {};
  return (
    <>
      <div className="st-eyebrow mt-1 mb-1" style={{ color: C.annuale }}>Livello strategico · chi siamo e dove andiamo</div>
      <Voce nodo={ls.sintesi} percorso={["livello_strategico", "sintesi"]} onModifica={mod} indice={indice} etichetta="Sintesi" />
      {(ls.scelte || []).map((v, i) => <Voce key={i} etichetta={i === 0 ? "Scelte strategiche dichiarate" : null} nodo={v} percorso={["livello_strategico", "scelte", i]} onModifica={mod} indice={indice} />)}
      <div className="st-eyebrow mt-4 mb-1" style={{ color: C.annuale }}>Livello operativo · come lo facciamo</div>
      {CAMPI_OPERATIVI.map(([k, l]) => <Voce key={k} etichetta={l} nodo={lo[k]} percorso={["livello_operativo", k]} onModifica={mod} indice={indice} />)}
      <div className="st-eyebrow mt-4 mb-2" style={{ color: C.annuale }}>Livello economico-finanziario · i numeri</div>
      <LivelloEconomico stato={stato} entitaId={entitaId} />
      {(d.affermazioni_da_verificare || []).length > 0 && (
        <div className="mt-4 rounded-md border p-3" style={{ borderColor: C.ambra }}>
          <div className="st-eyebrow mb-1" style={{ color: C.ambra }}>Affermazioni del management da verificare in Fase 4 · {d.affermazioni_da_verificare.length}</div>
          {d.affermazioni_da_verificare.map((a, i) => (
            <Voce key={i} nodo={a} percorso={["affermazioni_da_verificare", i]} onModifica={mod} indice={indice}
              extra={null} />
          ))}
          <div className="mt-1 flex flex-wrap gap-1">
            {Array.from(new Set(d.affermazioni_da_verificare.flatMap((a) => a.kpi_suggeriti || []))).slice(0, 16).map((k) => <Pillola key={k}>{k}</Pillola>)}
          </div>
        </div>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoSegmenti({ d, mod, indice, f, entitaId, dispatch }) {
  const pesi = pesiSegmenti(d.segmenti);
  const soglia = f.sogliaAsa ?? SOGLIA_ASA_PREDEFINITA;
  const anni = Array.from(new Set((d.segmenti || []).flatMap((s) => (s.serie || []).map((p) => p.anno)).filter(Boolean))).sort().slice(-5);
  const anniGeo = Array.from(new Set((d.aree_geografiche || []).flatMap((s) => (s.serie || []).map((p) => p.anno)).filter(Boolean))).sort().slice(-5);
  const valore = (s, a, campo = "ricavi") => (s.serie || []).find((p) => p.anno === a)?.[campo];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-xs" style={{ color: C.muto }}>Criterio di segmentazione: <b style={{ color: C.inchiostro }}>{d.criterio || "n.d."}</b></span>
        <label className="flex items-center gap-1.5 text-xs ml-auto">
          Soglia ASA
          <input type="number" min={1} max={50} value={soglia} onChange={(e) => dispatch({ tipo: "FASE1_SOGLIA", entitaId, valore: Math.max(1, Math.min(50, Number(e.target.value) || SOGLIA_ASA_PREDEFINITA)) })}
            className="w-14 rounded border px-1.5 py-0.5" style={{ borderColor: C.riga, fontFamily: F.mono }} />% dei ricavi
        </label>
      </div>
      {(d.segmenti || []).length === 0 ? <p className="text-xs italic" style={{ color: C.muto }}>Nessun segmento negli estratti.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: C.fondo }}>
                <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>ASA</th>
                <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Segmento</th>
                {anni.map((a) => <th key={a} className="text-right px-2 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>{a}</th>)}
                <th className="text-right px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Peso {pesi.anno || ""}</th>
              </tr>
            </thead>
            <tbody>
              {d.segmenti.map((s, i) => {
                const peso = pesi.pesi[s.nome];
                const automatico = (peso ?? 0) >= soglia;
                const scelto = f.asa?.[s.nome] ?? automatico;
                return (
                  <tr key={i} className="border-t align-top" style={{ borderColor: C.rigaTenue, background: scelto ? C.annualeTenue : "transparent" }}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={scelto} aria-label={`Unità di analisi: ${s.nome}`}
                        onChange={(e) => dispatch({ tipo: "FASE1_ASA", entitaId, nome: s.nome, valore: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div style={{ fontWeight: 600 }}>{s.nome} <Pillola>{s.tipo || "n.d."}</Pillola>{s.nonSupportato && <Pillola colore={C.allarme} sfondo={C.allarmeTenue}>non supportato</Pillola>}</div>
                      {s.descrizione && <div style={{ color: C.muto }}>{s.descrizione}</div>}
                      <Evidenze ids={s.evidenze} indice={indice} />
                    </td>
                    {anni.map((a) => {
                      const r = valore(s, a), ris = valore(s, a, "risultato");
                      return (
                        <td key={a} className="text-right px-2 py-1.5" style={{ fontFamily: F.mono }}>
                          {fmtNumero(r, 1)}
                          {ris !== undefined && ris !== null && <div style={{ color: C.muto }}>ris. {fmtNumero(ris, 1)}</div>}
                        </td>
                      );
                    })}
                    <td className="text-right px-2 py-1.5" style={{ fontFamily: F.mono, color: automatico ? C.annuale : C.muto }}>{peso === undefined ? "—" : `${fmtNumero(peso, 1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs" style={{ color: C.muto }}>
            Valori come negli estratti{pesi.unita ? ` (${pesi.unita})` : ""}; i pesi sono calcolati dal sistema sull'anno {pesi.anno || "—"}. Le righe evidenziate sono le unità di analisi:
            sopra soglia sono selezionate in automatico, la spunta manuale prevale.
          </p>
        </div>
      )}
      {(d.aree_geografiche || []).length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Aree geografiche</div>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: C.fondo }}>
                <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Area</th>
                {anniGeo.map((a) => <th key={a} className="text-right px-2 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>{a}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.aree_geografiche.map((g, i) => (
                <tr key={i} className="border-t" style={{ borderColor: C.rigaTenue }}>
                  <td className="px-2 py-1">{g.nome} <Evidenze ids={g.evidenze} indice={indice} /></td>
                  {anniGeo.map((a) => <td key={a} className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtNumero(valore(g, a), 1)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoPerimetro({ d, mod, indice, stato, dispatch }) {
  const dm = d.definizione_mercato || {};
  return (
    <>
      <div className="st-eyebrow mt-1 mb-1" style={{ color: C.annuale }}>Confini del mercato</div>
      <Voce etichetta="Lato della domanda · che cosa i clienti considerano sostituibile" nodo={dm.domanda} percorso={["definizione_mercato", "domanda"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Lato dell'offerta · tecnologie e processi comuni" nodo={dm.offerta} percorso={["definizione_mercato", "offerta"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Ambito geografico" nodo={dm.geografia} percorso={["definizione_mercato", "geografia"]} onModifica={mod} indice={indice} />
      <div className="st-eyebrow mt-4 mb-1" style={{ color: C.annuale }}>Basi della competizione</div>
      {(d.basi_competizione || []).length ? d.basi_competizione.map((b, i) => <Voce key={i} nodo={b} percorso={["basi_competizione", i]} onModifica={mod} indice={indice} />)
        : <p className="text-xs italic" style={{ color: C.muto }}>Non documentate negli estratti.</p>}
      <div className="st-eyebrow mt-4 mb-1" style={{ color: C.annuale }}>Concorrenti</div>
      {(d.concorrenti || []).length === 0 ? <p className="text-xs italic" style={{ color: C.muto }}>Nessun concorrente nominato negli estratti.</p> : (
        <ul className="space-y-1.5">
          {d.concorrenti.map((c, i) => {
            const registrato = stato.entita.find((e) => stessoSoggetto(e.nome, c.nome));
            const colTipo = c.tipo === "diretto" ? C.allarme : c.tipo === "indiretto" ? C.ambra : C.periodico;
            return (
              <li key={i} className="rounded border px-3 py-2" style={{ borderColor: C.rigaTenue }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm" style={{ fontWeight: 600 }}>{c.nome}</span>
                  <Pillola colore={colTipo} sfondo={C.fondo}>{c.tipo || "n.d."}</Pillola>
                  {(c.segmenti || []).map((s) => <Pillola key={s}>{s}</Pillola>)}
                  {c.nonSupportato && <Pillola colore={C.allarme} sfondo={C.allarmeTenue}>non supportato</Pillola>}
                  <span className="ml-auto">
                    {registrato
                      ? <span className="st-eyebrow flex items-center gap-1" style={{ color: C.ok }}><Check size={11} /> {registrato.ruolo === "principale" ? "società analizzata" : "già nel peer group"}</span>
                      : <button onClick={() => dispatch({ tipo: "ENTITA_AGGIUNTA", nome: c.nome, motivo: `concorrente ${c.tipo || ""} individuato in Fase 1` })}
                          className="st-btn flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: C.annuale, color: C.annuale }}><Plus size={11} /> aggiungi ai peer</button>}
                  </span>
                </div>
                {c.motivo && <p className="text-xs mt-1" style={{ color: C.muto }}>{c.motivo} <Evidenze ids={c.evidenze} indice={indice} /></p>}
              </li>
            );
          })}
        </ul>
      )}
      {(d.quote_mercato || []).length > 0 && (
        <>
          <div className="st-eyebrow mt-4 mb-1" style={{ color: C.annuale }}>Quote di mercato citate</div>
          <ul className="space-y-1">
            {d.quote_mercato.map((q, i) => (
              <li key={i} className="text-sm">
                <b>{q.soggetto}</b>: {q.valore !== null && q.valore !== undefined ? `${fmtNumero(q.valore, 1)}${q.unita || "%"}` : "n.d."}{q.periodo ? ` (${q.periodo})` : ""}
                <Pillola colore={q.fonte_tipo === "terzi" ? C.derivata : C.ambra} sfondo={C.fondo}>{q.fonte_tipo || "fonte n.d."}</Pillola>
                <Evidenze ids={q.evidenze} indice={indice} />
              </li>
            ))}
          </ul>
        </>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function VistaFase1({ stato, dispatch }) {
  const [entitaId, setEntitaId] = useState("principale");
  const [inCorso, setInCorso] = useState(null);
  const fermato = useRef(false);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const ent = stato.entita.find((e) => e.id === entitaId) || stato.entita[0];
  const f = stato.fase1?.[ent.id] || fase1Vuota();
  const indice = useMemo(() => {
    const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
    const out = {};
    for (const l of Object.values(stato.estratti)) for (const e of l) out[e.id] = { e, d: metaDoc[e.docId] };
    return out;
  }, [stato.estratti, stato.documenti]);
  const disponibilita = useMemo(() => Object.fromEntries(SEZIONI_FASE1.map((s) => [s.id, selezionaEstratti(stato, ent.id, s)])), [stato.estratti, stato.documenti, ent.id]);

  const genera = useCallback(async (sezioneId) => {
    const sez = sezioneFase1(sezioneId);
    setInCorso(sezioneId);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: nomeEntita(ent), fase: `Fase 1 · ${sez.titolo}`, blocco: 0, totale: 0 } });
    try {
      const risultato = await generaSezioneFase1({ stato: statoRef.current, entitaId: ent.id, sezioneId });
      dispatch({ tipo: "FASE1_SEZIONE", entitaId: ent.id, sezioneId, risultato });
      dispatch({ tipo: "LOG", livello: "ok", testo: `${sez.titolo} di «${nomeEntita(ent)}» proposta su ${plurale(risultato.estrattiForniti, "estratto", "estratti")}, ${risultato.evidenzeUsate} citati. Da confermare.` });
      return true;
    } catch (err) {
      dispatch({ tipo: "LOG", livello: err.vuoto ? "attenzione" : "errore", testo: `${sez.titolo}: ${err.message}` });
      return !err.definitivo;
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(null);
    }
  }, [dispatch, ent]);

  const generaTutte = async () => {
    fermato.current = false;
    for (const s of SEZIONI_FASE1) {
      if (fermato.current) break;
      if (f.sezioni[s.id]?.stato === "confermato") continue;
      const prosegui = await genera(s.id);
      if (!prosegui) break;
    }
  };

  const confermate = SEZIONI_FASE1.filter((s) => f.sezioni[s.id]?.stato === "confermato" || f.sezioni[s.id]?.stato === "modificato").length;
  const profilo = profiloFase1(stato, ent.id);

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 1 · Profilo e perimetro</span>
          <nav className="flex rounded-md overflow-x-auto border max-w-full" style={{ borderColor: C.riga }}>
            {stato.entita.map((e) => (
              <button key={e.id} onClick={() => setEntitaId(e.id)} className="st-btn px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 text-xs"
                style={{ borderColor: C.riga, background: ent.id === e.id ? C.inchiostro : C.carta, color: ent.id === e.id ? "#fff" : C.muto }}>
                {nomeEntita(e)}{e.ruolo === "principale" ? " ★" : ""}
              </button>
            ))}
          </nav>
          <span className="text-xs" style={{ color: C.muto }}>{confermate} / {SEZIONI_FASE1.length} sezioni validate</span>
          <div className="ml-auto flex gap-2">
            {inCorso ? (
              <button onClick={() => { fermato.current = true; }} className="st-btn rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: C.allarme, color: C.allarme }}>Ferma dopo questa sezione</button>
            ) : (
              <button onClick={generaTutte} className="st-btn flex items-center gap-2 rounded-md px-3 py-1.5 text-sm" style={{ background: C.annuale, color: "#fff" }}>
                <RefreshCw size={13} /> Genera le sezioni non confermate
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {SEZIONI_FASE1.map((s) => {
            const sez = f.sezioni[s.id];
            const st = sez ? STATO_SEZIONE[sez.stato] : null;
            const disp = disponibilita[s.id];
            const Icona = s.icona;
            const mod = (percorso, valore) => dispatch({ tipo: "FASE1_MODIFICA", entitaId: ent.id, sezioneId: s.id, percorso, valore });
            return (
              <Scheda key={s.id}>
                <Intestazione icona={<Icona size={14} />} titolo={s.titolo} nota={s.nota} colore={C.annuale}
                  badge={st ? <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: st.sfondo, color: st.colore }}>{st.label}</span> : null} />
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs" style={{ color: disp.propri ? C.muto : C.allarme }}>
                      Materiale: {plurale(disp.propri, "estratto sul tema", "estratti sul tema")}, {disp.quanti - disp.propri} di supporto
                      {sez ? ` · proposta del ${new Date(sez.generatoIl).toLocaleDateString("it-IT")} (${sez.modello}), ${sez.evidenzeUsate} estratti citati` : ""}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => genera(s.id)} disabled={!!inCorso || !disp.quanti} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs"
                        style={{ borderColor: C.riga, opacity: inCorso || !disp.quanti ? 0.5 : 1 }}>
                        <RefreshCw size={12} className={inCorso === s.id ? "animate-spin" : ""} /> {inCorso === s.id ? "in corso…" : sez ? "Rigenera" : "Genera"}
                      </button>
                      {sez && sez.stato !== "confermato" && (
                        <button onClick={() => dispatch({ tipo: "FASE1_STATO", entitaId: ent.id, sezioneId: s.id, stato: "confermato" })} className="st-btn flex items-center gap-1 rounded px-2.5 py-1 text-xs" style={{ background: C.ok, color: "#fff" }}>
                          <Check size={12} /> Conferma
                        </button>
                      )}
                      {sez && sez.stato === "confermato" && (
                        <button onClick={() => dispatch({ tipo: "FASE1_STATO", entitaId: ent.id, sezioneId: s.id, stato: "proposto" })} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, color: C.muto }}>Riapri</button>
                      )}
                    </span>
                  </div>
                  {!sez && (
                    <p className="text-sm" style={{ color: C.muto }}>
                      {disp.quanti ? "Sezione non ancora generata. «Genera» chiede all'IA una proposta costruita solo sugli estratti, con le citazioni." : "Nessun estratto utile: carica in Fase 0 i documenti che trattano questi temi (per la società analizzata: 10-K/20-F, presentazioni, sito istituzionale)."}
                    </p>
                  )}
                  {sez && s.id === "identita" && <CorpoIdentita d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "modello" && <CorpoModello d={sez.dati} mod={mod} indice={indice} stato={stato} entitaId={ent.id} />}
                  {!sez && s.id === "modello" && <div className="mt-3"><div className="st-eyebrow mb-2" style={{ color: C.annuale }}>Livello economico-finanziario · i numeri</div><LivelloEconomico stato={stato} entitaId={ent.id} /></div>}
                  {sez && s.id === "segmenti" && <CorpoSegmenti d={sez.dati} mod={mod} indice={indice} f={f} entitaId={ent.id} dispatch={dispatch} />}
                  {sez && s.id === "perimetro" && <CorpoPerimetro d={sez.dati} mod={mod} indice={indice} stato={stato} dispatch={dispatch} />}
                </div>
              </Scheda>
            );
          })}
        </div>
        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="Consegna alle fasi successive"
              nota="Solo le sezioni confermate o modificate passano a valle. Le proposte non confermate restano qui." />
            <ul className="px-4 pb-4 space-y-1.5 text-xs">
              <li className="flex justify-between"><span>Unità di analisi (ASA)</span><b>{profilo?.asa?.length ? profilo.asa.map((a) => a.nome).join(", ") : "—"}</b></li>
              <li className="flex justify-between"><span>Affermazioni da verificare → Fase 4</span><b>{profilo?.affermazioniDaVerificare?.length || 0}</b></li>
              <li className="flex justify-between"><span>Concorrenti individuati</span><b>{profilo?.perimetro?.concorrenti?.length || 0}</b></li>
              <li className="flex justify-between"><span>Peer registrati</span><b>{stato.entita.filter((e) => e.ruolo === "peer").length}</b></li>
              <li className="flex justify-between"><span>Livello economico (XBRL)</span><b>{profilo?.economico ? `${profilo.economico.primo}-${profilo.economico.ultimo}` : "—"}</b></li>
            </ul>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => { fermato.current = true; }} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [14] FASE 2 — ANALISI ESTERNA
   --------------------------------------------------------------------------
   Si ripete per ogni unità di analisi (ASA) confermata in Fase 1 (§3.6: «In
   questi casi l'analisi deve essere ripetuta per ogni singola ASA»). Senza
   ASA confermate si lavora sul gruppo nel suo insieme, e lo si dichiara.

     2A PESTEL e ciclicità        → fattori del macro-ambiente con direzione, intensità, orizzonte
     2B Ciclo di vita             → fase del settore, classe di Pavitt, stadio della tecnologia
     2C Cinque forze              → punteggio per forza e per sotto-driver, indice di attrattività
     2D Fattori critici di successo
     2E Opportunità e minacce     → probabilità × impatto, giudizio di attrattività

   Due elementi sono calcolati dal sistema e non dall'IA: l'indice di
   attrattività strutturale (dalla media delle cinque forze) e il confronto
   fra il profilo di bilancio atteso nella fase del ciclo di vita e quello
   osservato nelle serie XBRL — un'anticipazione della verifica di Fase 4.
   ========================================================================== */

const METRICHE_CONTESTO = ["crescita_mercato", "dimensione_mercato", "quota_mercato", "giudizio_strategico"];
const SEZIONI_FASE2 = [
  { id: "pestel", titolo: "2A · PESTEL e ciclicità", icona: Compass, contesto: true, peer: false, metriche: METRICHE_CONTESTO,
    temi: ["contesto_politico_normativo", "contesto_economico", "contesto_sociale", "contesto_tecnologico", "contesto_ambientale"], supporto: ["rischi", "mercato_domanda"],
    nota: "Il macro-ambiente (§3.11): fattori politico-normativi, economici, socio-culturali, tecnologici e ambientali, con la loro direzione per l'ASA. Comprende la sensibilità al ciclo economico." },
  { id: "ciclo", titolo: "2B · Ciclo di vita del settore e tecnologia", icona: Activity, contesto: true, peer: true, metriche: METRICHE_CONTESTO,
    temi: ["mercato_domanda", "contesto_tecnologico"], supporto: ["innovazione", "concorrenza"],
    nota: "In quale fase si trova il settore (§3.10) e quale ruolo ha la tecnologia (Pavitt; tecnologie emergenti, chiave, di base). Il sistema confronta il profilo di bilancio tipico della fase con quello osservato." },
  { id: "forze", titolo: "2C · Le cinque forze competitive", icona: Scale, contesto: true, peer: true, metriche: METRICHE_CONTESTO,
    temi: ["clienti", "fornitori", "barriere_sostituti", "concorrenza"], supporto: ["mercato_domanda", "rischi", "operations"],
    nota: "Struttura del settore (§3.7): potere dei clienti e dei fornitori, rivalità interna, minaccia di nuovi entranti e di prodotti sostitutivi. Punteggio da 1 (forza debole, favorevole) a 5 (forza intensa, comprime i margini)." },
  { id: "fcs", titolo: "2D · Fattori critici di successo", icona: Target, contesto: true, peer: true, metriche: METRICHE_CONTESTO,
    temi: ["concorrenza", "clienti", "mercato_domanda"], supporto: ["strategia", "innovazione", "capitale_relazionale", "operations"],
    nota: "Le risorse e competenze che fanno vincere in questa ASA (§3.8): cosa vogliono i clienti, come scelgono, su cosa si combatte davvero. In Fase 3 verranno confrontati con le risorse dell'impresa." },
  { id: "om", titolo: "2E · Opportunità e minacce", icona: AlertTriangle, contesto: true, peer: false, metriche: METRICHE_CONTESTO,
    temi: ["rischi", "mercato_domanda"], supporto: ["contesto_politico_normativo", "contesto_economico", "contesto_tecnologico", "concorrenza", "barriere_sostituti"],
    nota: "La sintesi dell'analisi esterna (§3.12): opportunità (attrattività: volumi, prezzi, margini, spazio per innovare) e minacce (fattori di rischio), con probabilità e impatto." },
];
const sezioneFase2 = (id) => SEZIONI_FASE2.find((s) => s.id === id);

const FATTORI_PESTEL = [
  ["politico_normativo", "Politico-normativo"], ["economico", "Economico"], ["sociale", "Socio-culturale"],
  ["tecnologico", "Tecnologico"], ["ambientale", "Ambientale"],
];
const FORZE = [
  ["clienti", "Potere dei clienti"], ["fornitori", "Potere dei fornitori"], ["rivalita", "Rivalità interna"],
  ["nuovi_entranti", "Minaccia di nuovi entranti"], ["sostituti", "Minaccia di prodotti sostitutivi"],
];
const FASI_CICLO = [["introduzione", "Introduzione"], ["sviluppo", "Sviluppo"], ["maturita", "Maturità"], ["declino", "Declino"]];
const PAVITT = { tradizionale: "Settore tradizionale (fornitori dominanti)", scala: "Settore di scala", fornitori_specializzati: "Fornitori specializzati", science_based: "Science based / alta tecnologia" };
const STADI_TECNOLOGIA = { emergente: "Tecnologia emergente", chiave: "Tecnologia chiave", base: "Tecnologia di base" };

const SCHEMI_FASE2 = {
  pestel: `{
  "fattori": {
${FATTORI_PESTEL.map(([k]) => `    "${k}": {
      "giudizio": { "testo": "<effetto complessivo del fattore sull'ASA>", "evidenze": ["E#"] } | null,
      "elementi": [ { "testo": "<fattore specifico>", "direzione": "opportunita" | "minaccia" | "neutro", "intensita": <1-5>, "orizzonte": "breve" | "medio" | "lungo", "evidenze": ["E#"] } ]
    }`).join(",\n")}
  },
  "ciclicita": { "classe": "ciclico" | "anticiclico" | "neutro" | null, "testo": "<come la domanda dell'ASA reagisce al ciclo economico>", "evidenze": ["E#"] },
  "lacune": ["..."]
}`,
  ciclo: `{
  "fase_settore": { "fase": "introduzione" | "sviluppo" | "maturita" | "declino" | null, "testo": "<motivazione: domanda, crescita, concorrenza, prezzi>", "evidenze": ["E#"] },
  "differenze_geografiche": { "testo": "<la fase cambia per area geografica o segmento?>", "evidenze": ["E#"] } | null,
  "tecnologia": { "pavitt": "tradizionale" | "scala" | "fornitori_specializzati" | "science_based" | null,
                  "stadio": "emergente" | "chiave" | "base" | null,
                  "testo": "<ruolo della tecnologia, innovazioni di prodotto o di processo, rischio di obsolescenza>", "evidenze": ["E#"] },
  "crescita_mercato": [ { "testo": "<dato o stima di crescita/dimensione del mercato>", "valore": <numero o null>, "unita": "<% o valuta>", "periodo": "<periodo>", "fonte_tipo": "dichiarata dalla società" | "terzi", "evidenze": ["E#"] } ],
  "lacune": ["..."]
}`,
  forze: `{
  "forze": {
${FORZE.map(([k]) => `    "${k}": {
      "punteggio": <1-5>,
      "sintesi": { "testo": "<giudizio sulla forza>", "evidenze": ["E#"] },
      "driver": [ { "driver": "<sotto-driver: es. concentrazione, costi di cambio, differenziazione, capacità in eccesso, barriere all'uscita, capitale richiesto, licenze, brevetti, rapporto qualità/prezzo del sostituto>", "testo": "<valutazione>", "punteggio": <1-5>, "evidenze": ["E#"] } ]
    }`).join(",\n")}
  },
  "lacune": ["..."]
}
Punteggio: 1 = forza debole (favorevole alla redditività del settore), 5 = forza molto intensa (comprime margini e
crescita). Se una forza non è documentata dagli estratti, metti punteggio null e spiegalo in "lacune".`,
  fcs: `{
  "fcs": [ { "fattore": "<fattore critico di successo>", "testo": "<perché è decisivo: cosa vogliono i clienti, come scelgono>", "kpi": ["<indicatore con cui misurarlo>"], "evidenze": ["E#"] } ],
  "lacune": ["..."]
}`,
  om: `{
  "opportunita": [ { "testo": "<opportunità>", "origine": "<PESTEL · fattore | 5 forze · forza | ciclo di vita | mercato>", "probabilita": <1-5>, "impatto": <1-5>, "orizzonte": "breve" | "medio" | "lungo", "evidenze": ["E#"] } ],
  "minacce": [ { "testo": "<minaccia>", "origine": "...", "probabilita": <1-5>, "impatto": <1-5>, "orizzonte": "breve" | "medio" | "lungo", "evidenze": ["E#"] } ],
  "giudizio_attrattivita": { "testo": "<quanto è attrattiva l'ASA: crescita di volumi, prezzi, margini, spazio per innovare>", "evidenze": ["E#"] },
  "lacune": ["..."]
}
Le opportunità e le minacce riguardano l'AMBIENTE, non l'impresa: i punti di forza e di debolezza interni sono
oggetto della Fase 3 e qui non vanno elencati.`,
};

const limita15 = (v) => (typeof v === "number" && isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : null);
/** Normalizza i punteggi: il modello può restituire stringhe, decimali o valori fuori scala. */
function normalizzaPunteggi(nodo) {
  if (Array.isArray(nodo)) return nodo.map(normalizzaPunteggi);
  if (!nodo || typeof nodo !== "object") return nodo;
  const out = {};
  for (const [k, v] of Object.entries(nodo)) {
    out[k] = ["punteggio", "intensita", "probabilita", "impatto"].includes(k)
      ? (v === null || v === undefined || v === "" ? null : limita15(Number(v)))
      : normalizzaPunteggi(v);
  }
  return out;
}

const chiaveUnita = (entitaId, asaNome) => `${entitaId}::${asaNome || "gruppo"}`;

/** Unità di analisi per la Fase 2: le ASA confermate in Fase 1, altrimenti il gruppo. */
function unitaDiAnalisi(stato) {
  const p = profiloFase1(stato, "principale");
  const asa = p?.asa || [];
  if (!asa.length) return [{ chiave: chiaveUnita("principale", null), nome: "Gruppo nel suo insieme", descrizione: null, peso: null, gruppo: true }];
  return asa.map((a) => ({ chiave: chiaveUnita("principale", a.nome), nome: a.nome, descrizione: a.descrizione || null, peso: a.peso ?? null, gruppo: false }));
}

/** Riassunto compatto delle sezioni già prodotte, per la sintesi O/M. */
function riassuntoPerSintesi(sezioni) {
  const righe = [];
  const pe = sezioni.pestel;
  if (pe?.fattori) {
    for (const [k, l] of FATTORI_PESTEL) {
      const f = pe.fattori[k];
      if (!f) continue;
      if (f.giudizio?.testo) righe.push(`PESTEL · ${l}: ${f.giudizio.testo}`);
      for (const el of f.elementi || []) righe.push(`  - [${el.direzione}, intensità ${el.intensita ?? "n.d."}, ${el.orizzonte || "orizzonte n.d."}] ${el.testo}`);
    }
    if (pe.ciclicita?.testo) righe.push(`Ciclicità (${pe.ciclicita.classe || "n.d."}): ${pe.ciclicita.testo}`);
  }
  const ci = sezioni.ciclo;
  if (ci?.fase_settore) righe.push(`Ciclo di vita: ${ci.fase_settore.fase || "n.d."} — ${ci.fase_settore.testo || ""}`);
  if (ci?.tecnologia?.testo) righe.push(`Tecnologia (${ci.tecnologia.pavitt || "n.d."}, ${ci.tecnologia.stadio || "n.d."}): ${ci.tecnologia.testo}`);
  const fo = sezioni.forze?.forze;
  if (fo) for (const [k, l] of FORZE) if (fo[k]) righe.push(`5 forze · ${l}: punteggio ${fo[k].punteggio ?? "n.d."} — ${fo[k].sintesi?.testo || ""}`);
  for (const f of sezioni.fcs?.fcs || []) righe.push(`FCS: ${f.fattore} — ${f.testo || ""}`);
  return righe.join("\n");
}

const SYSTEM_FASE2 = SYSTEM_FASE1.replace(
  "Sei un analista strategico che redige il profilo di una società per un'analisi\nfondamentale.",
  "Sei un analista strategico che conduce l'ANALISI ESTERNA (contesto competitivo e macro-ambiente) di\nun'area strategica d'affari per un'analisi fondamentale.");

async function generaSezioneFase2({ stato, unita, sezioneId, precedenti = null }) {
  const sezione = sezioneFase2(sezioneId);
  const ent = stato.entita.find((e) => e.id === "principale");
  const sel = selezionaEstratti(stato, "principale", sezione);
  if (!sel.quanti) {
    const err = new Error(`nessun estratto disponibile: in Fase 0 non ci sono frammenti sui temi ${sezione.temi.map((t) => TEMI[t].label).join(", ")}. Carica studi di settore, dati macro o i Risk Factors dei filing.`);
    err.vuoto = true;
    throw err;
  }
  const p1 = profiloFase1(stato, "principale");
  const perimetro = p1?.perimetro?.definizione_mercato;
  const contestoAsa = [
    `UNITÀ DI ANALISI: ${unita.gruppo ? "il gruppo nel suo insieme (nessuna ASA confermata in Fase 1)" : `ASA «${unita.nome}»${unita.descrizione ? ` — ${unita.descrizione}` : ""}${unita.peso ? ` — ${fmtNumero(unita.peso, 1)}% dei ricavi` : ""}`}.`,
    !unita.gruppo ? "Gli estratti riguardano spesso l'intera società: usa solo ciò che è pertinente a questa ASA e dichiara in «lacune» ciò che non si può attribuire." : "",
    perimetro?.domanda?.testo ? `Perimetro del mercato confermato in Fase 1 — domanda: ${perimetro.domanda.testo}${perimetro.geografia?.testo ? `; geografia: ${perimetro.geografia.testo}` : ""}.` : "",
    p1?.perimetro?.concorrenti?.length ? `Concorrenti individuati in Fase 1: ${p1.perimetro.concorrenti.map((c) => `${c.nome} (${c.tipo || "n.d."})`).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
  const sintesiPrecedenti = sezioneId === "om" && precedenti ? `\nSINTESI DELLE SEZIONI 2A-2D (da usare come base, citando comunque gli estratti):\n${riassuntoPerSintesi(precedenti)}\n` : "";

  const testo = await chiamataIA({
    system: SYSTEM_FASE2,
    contenuto: `SOCIETÀ: ${nomeEntita(ent)}${ent.settore ? ` — settore dichiarato: ${ent.settore}` : ""}
${contestoAsa}
SEZIONE: ${sezione.titolo}. ${sezione.nota}
${sintesiPrecedenti}
ESTRATTI (${sel.quanti}):
${sel.testo}

Restituisci esattamente questa struttura:
${SCHEMI_FASE2[sezioneId]}`,
    maxTokens: 7000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object") throw new Error("risposta del modello non interpretabile");
  const usati = new Set();
  const dati = normalizzaPunteggi(validaEvidenze(json, sel.mappa, usati));
  return { dati, estrattiForniti: sel.quanti, evidenzeUsate: usati.size, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}` };
}

/** Indice di attrattività strutturale: 100 = forze tutte deboli, 0 = tutte intense. */
function attrattivitaDaForze(forze) {
  if (!forze) return null;
  const valori = FORZE.map(([k]) => forze[k]?.punteggio).filter((v) => typeof v === "number");
  if (!valori.length) return null;
  const media = valori.reduce((a, b) => a + b, 0) / valori.length;
  return { media, indice: Math.round(((5 - media) / 4) * 100), valutate: valori.length };
}

/**
 * Profilo di bilancio atteso nella fase del ciclo di vita (§3.10) confrontato
 * con quello osservato: media degli ultimi tre esercizi XBRL. È un controllo
 * di plausibilità, non un giudizio: le soglie sono indicative e dichiarate.
 */
const PROFILO_ATTESO = {
  introduzione: [
    { id: "crescita", label: "Crescita dei ricavi elevata", test: (o) => o.crescita === null ? null : o.crescita >= 15, soglia: "≥ 15%" },
    { id: "margineOperativo", label: "Redditività bassa o negativa", test: (o) => o.margineOperativo === null ? null : o.margineOperativo <= 5, soglia: "margine operativo ≤ 5%" },
    { id: "cassa", label: "Flussi di cassa assorbiti", test: (o) => o.cassaUtile === null ? null : o.cassaUtile < 1, soglia: "flusso operativo / utile < 1" },
  ],
  sviluppo: [
    { id: "crescita", label: "Crescita dei ricavi sostenuta", test: (o) => o.crescita === null ? null : o.crescita >= 8, soglia: "≥ 8%" },
    { id: "capexAmm", label: "Investimenti superiori agli ammortamenti", test: (o) => o.capexAmm === null ? null : o.capexAmm > 1.2, soglia: "investimenti / ammortamenti > 1,2" },
    { id: "margineOperativo", label: "Redditività positiva e in crescita", test: (o) => o.margineOperativo === null ? null : o.margineOperativo > 0, soglia: "margine operativo > 0" },
  ],
  maturita: [
    { id: "crescita", label: "Crescita contenuta", test: (o) => o.crescita === null ? null : o.crescita > -2 && o.crescita < 8, soglia: "fra -2% e 8%" },
    { id: "cassa", label: "Forte generazione di cassa", test: (o) => o.cassaUtile === null ? null : o.cassaUtile >= 1, soglia: "flusso operativo / utile ≥ 1" },
    { id: "capexAmm", label: "Investimenti di mantenimento", test: (o) => o.capexAmm === null ? null : o.capexAmm >= 0.6 && o.capexAmm <= 1.4, soglia: "investimenti / ammortamenti fra 0,6 e 1,4" },
  ],
  declino: [
    { id: "crescita", label: "Ricavi in calo", test: (o) => o.crescita === null ? null : o.crescita < 0, soglia: "< 0%" },
    { id: "capexAmm", label: "Disinvestimento", test: (o) => o.capexAmm === null ? null : o.capexAmm < 0.8, soglia: "investimenti / ammortamenti < 0,8" },
  ],
};

function profiloOsservato(stato) {
  const ind = indicatoriEconomici(stato.xbrl.principale);
  if (!ind) return null;
  const media = (id) => {
    const r = ind.righe.find((x) => x.id === id);
    if (!r) return null;
    const v = ind.anni.slice(-3).map((a) => r.valori[a]).filter((x) => x !== null && x !== undefined && isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    anni: ind.anni.slice(-3),
    crescita: media("crescita"), margineOperativo: media("margineOperativo"),
    capexAmm: media("capexAmm"), cassaUtile: media("cassaUtile"),
  };
}

function coerenzaCicloVita(stato, fase) {
  const oss = profiloOsservato(stato);
  if (!fase || !PROFILO_ATTESO[fase]) return null;
  if (!oss) return { osservato: null, controlli: [] };
  return { osservato: oss, controlli: PROFILO_ATTESO[fase].map((c) => ({ ...c, esito: c.test(oss) })) };
}

/** Analisi esterna confermata di un'unità, nella forma che le fasi successive leggeranno. */
function profiloFase2(stato, chiave) {
  const f = stato.fase2?.[chiave];
  if (!f) return null;
  const sez = (id) => (f.sezioni?.[id] && f.sezioni[id].stato !== "proposto" ? f.sezioni[id].dati : null);
  return {
    pestel: sez("pestel"), ciclo: sez("ciclo"), forze: sez("forze"), fcs: sez("fcs"), om: sez("om"),
    attrattivita: attrattivitaDaForze(sez("forze")?.forze),
  };
}

/* ==========================================================================
   [15] INTERFACCIA DELLA FASE 2
   ========================================================================== */

const COLORE_DIREZIONE = { opportunita: [C.ok, C.okTenue, "opportunità"], minaccia: [C.allarme, C.allarmeTenue, "minaccia"], neutro: [C.muto, C.fondo, "neutro"] };

function Puntini({ valore, colore = C.inchiostro, titolo }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" title={titolo || (valore ? `${valore} su 5` : "non valutato")}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: valore && i <= valore ? colore : C.riga, display: "inline-block" }} />)}
    </span>
  );
}

function SceltaPunteggio({ valore, onCambia, etichetta }) {
  return (
    <select value={valore ?? ""} onChange={(e) => onCambia(e.target.value === "" ? null : Number(e.target.value))} aria-label={etichetta}
      className="rounded border px-1 py-0.5" style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta }}>
      <option value="">—</option>
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

function Elemento({ el, percorso, mod, indice, campi = true }) {
  const [col, bg, lab] = COLORE_DIREZIONE[el.direzione] || COLORE_DIREZIONE.neutro;
  return (
    <div className="pl-3 border-l-2 py-1" style={{ borderColor: col }}>
      <Voce nodo={el} percorso={percorso} onModifica={mod} indice={indice} />
      {campi && (
        <div className="flex flex-wrap items-center gap-2 -mt-1 mb-1">
          <Pillola colore={col} sfondo={bg}>{lab}</Pillola>
          <span className="st-eyebrow" style={{ color: C.muto }}>intensità</span> <Puntini valore={el.intensita} colore={col} />
          <SceltaPunteggio valore={el.intensita} etichetta="Intensità" onCambia={(v) => mod([...percorso, "intensita"], v)} />
          {el.orizzonte && <Pillola>orizzonte {el.orizzonte}</Pillola>}
        </div>
      )}
    </div>
  );
}

function CorpoPestel({ d, mod, indice }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FATTORI_PESTEL.map(([k, l]) => {
          const f = d.fattori?.[k];
          const n = f?.elementi || [];
          const opp = n.filter((e) => e.direzione === "opportunita").length, min = n.filter((e) => e.direzione === "minaccia").length;
          return (
            <div key={k} className="rounded-md border p-3" style={{ borderColor: C.riga }}>
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ fontWeight: 600 }}>{l}</span>
                <span className="ml-auto flex gap-1">{opp > 0 && <Pillola colore={C.ok} sfondo={C.okTenue}>{opp} opp.</Pillola>}{min > 0 && <Pillola colore={C.allarme} sfondo={C.allarmeTenue}>{min} min.</Pillola>}</span>
              </div>
              {f?.giudizio ? <Voce nodo={f.giudizio} percorso={["fattori", k, "giudizio"]} onModifica={mod} indice={indice} /> : <p className="text-xs italic mt-1" style={{ color: C.muto }}>Nessun giudizio documentato.</p>}
              <div className="space-y-1 mt-1">{n.map((el, i) => <Elemento key={i} el={el} percorso={["fattori", k, "elementi", i]} mod={mod} indice={indice} />)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Voce etichetta="Ciclicità della domanda" nodo={d.ciclicita} percorso={["ciclicita"]} onModifica={mod} indice={indice}
          extra={d.ciclicita?.classe && <Pillola colore={C.inchiostro}>{d.ciclicita.classe}</Pillola>} />
      </div>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoCiclo({ d, mod, indice, stato }) {
  const fase = d.fase_settore?.fase;
  const coerenza = coerenzaCicloVita(stato, fase);
  const fmtOss = (id, v) => (v === null || v === undefined ? "n.d." : id === "capexAmm" || id === "cassa" ? `${fmtNumero(v, 2)}x` : `${fmtNumero(v, 1)}%`);
  const valoreOss = (c, o) => (c.id === "cassa" ? o.cassaUtile : o[c.id]);
  return (
    <>
      <div className="flex flex-wrap gap-1 mb-2">
        {FASI_CICLO.map(([k, l], i) => (
          <div key={k} className="flex-1 min-w-[90px] rounded px-2 py-2 text-center text-xs"
            style={{ background: fase === k ? C.annuale : C.fondo, color: fase === k ? "#fff" : C.muto, fontWeight: fase === k ? 600 : 400 }}>
            {i + 1}. {l}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="st-eyebrow" style={{ color: C.muto }}>Fase</span>
        <select value={fase || ""} onChange={(e) => mod(["fase_settore", "fase"], e.target.value || null)} className="rounded border px-1.5 py-0.5"
          style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta }} aria-label="Fase del ciclo di vita">
          <option value="">non determinata</option>
          {FASI_CICLO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <Voce etichetta="Motivazione" nodo={d.fase_settore} percorso={["fase_settore"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Differenze per area o segmento" nodo={d.differenze_geografiche} percorso={["differenze_geografiche"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Tecnologia" nodo={d.tecnologia} percorso={["tecnologia"]} onModifica={mod} indice={indice}
        extra={<>{d.tecnologia?.pavitt && <Pillola>{PAVITT[d.tecnologia.pavitt] || d.tecnologia.pavitt}</Pillola>}{d.tecnologia?.stadio && <Pillola>{STADI_TECNOLOGIA[d.tecnologia.stadio] || d.tecnologia.stadio}</Pillola>}</>} />
      {(d.crescita_mercato || []).length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
          <div className="st-eyebrow" style={{ color: C.muto }}>Dimensione e crescita del mercato</div>
          {d.crescita_mercato.map((c, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-2">
              <Voce nodo={c} percorso={["crescita_mercato", i]} onModifica={mod} indice={indice} />
              <Pillola colore={c.fonte_tipo === "terzi" ? C.derivata : C.ambra}>{c.fonte_tipo || "fonte n.d."}</Pillola>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-md border p-3" style={{ borderColor: C.periodico }}>
        <div className="st-eyebrow mb-1" style={{ color: C.periodico }}>Profilo di bilancio atteso nella fase e profilo osservato · anticipazione della Fase 4</div>
        {!fase && <p className="text-xs" style={{ color: C.muto }}>Fase non determinata: nessun confronto possibile.</p>}
        {fase && !coerenza?.osservato && <p className="text-xs" style={{ color: C.muto }}>Mancano le serie XBRL della società: carica il file companyfacts in Fase 0.</p>}
        {coerenza?.osservato && (
          <>
            <ul className="space-y-1">
              {coerenza.controlli.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                  {c.esito === true ? <Check size={13} style={{ color: C.ok }} /> : c.esito === false ? <AlertTriangle size={13} style={{ color: C.allarme }} /> : <Info size={13} style={{ color: C.muto }} />}
                  <span className="flex-1 min-w-[180px]">{c.label} <span style={{ color: C.muto }}>({c.soglia})</span></span>
                  <span style={{ fontFamily: F.mono }}>osservato {fmtOss(c.id, valoreOss(c, coerenza.osservato))}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs" style={{ color: C.muto }}>
              Media degli esercizi {coerenza.osservato.anni.join(", ")} sull'intera società (non sulla singola ASA). Le soglie sono indicative: un disallineamento è una domanda da porre in Fase 4, non una conclusione.
            </p>
          </>
        )}
      </div>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoForze({ d, mod, indice }) {
  const att = attrattivitaDaForze(d.forze);
  const [aperti, setAperti] = useState({});
  const coloreForza = (v) => (v >= 4 ? C.allarme : v === 3 ? C.ambra : C.ok);
  return (
    <>
      {att && (
        <div className="flex flex-wrap items-center gap-4 rounded-md p-3 mb-3" style={{ background: C.fondo }}>
          <div>
            <div className="st-eyebrow" style={{ color: C.muto }}>Attrattività strutturale</div>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 28, color: att.indice >= 60 ? C.ok : att.indice >= 40 ? C.ambra : C.allarme }}>{att.indice}<span style={{ fontSize: 14, color: C.muto }}>/100</span></div>
          </div>
          <p className="text-xs flex-1 min-w-[200px]" style={{ color: C.muto }}>
            Calcolata dal sistema: intensità media delle forze {fmtNumero(att.media, 2)} su 5 ({att.valutate} forze valutate). 100 = tutte le forze deboli, settore molto redditizio; 0 = tutte intense.
          </p>
        </div>
      )}
      <div className="space-y-2">
        {FORZE.map(([k, l]) => {
          const f = d.forze?.[k];
          const v = f?.punteggio;
          return (
            <div key={k} className="rounded-md border p-3" style={{ borderColor: C.riga }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm flex-1 min-w-[160px]" style={{ fontWeight: 600 }}>{l}</span>
                <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: C.fondo }}>
                  <div className="h-full" style={{ width: `${v ? (v / 5) * 100 : 0}%`, background: v ? coloreForza(v) : C.riga }} />
                </div>
                <SceltaPunteggio valore={v} etichetta={`Punteggio ${l}`} onCambia={(n) => mod(["forze", k, "punteggio"], n)} />
              </div>
              {f?.sintesi ? <Voce nodo={f.sintesi} percorso={["forze", k, "sintesi"]} onModifica={mod} indice={indice} /> : <p className="text-xs italic mt-1" style={{ color: C.muto }}>Forza non documentata negli estratti.</p>}
              {(f?.driver || []).length > 0 && (
                <>
                  <button onClick={() => setAperti((a) => ({ ...a, [k]: !a[k] }))} className="st-btn st-eyebrow flex items-center gap-1 mt-1" style={{ color: C.periodico }}>
                    {aperti[k] ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {plurale(f.driver.length, "sotto-driver", "sotto-driver")}
                  </button>
                  {aperti[k] && f.driver.map((dr, i) => (
                    <div key={i} className="pl-3 border-l-2 mt-1" style={{ borderColor: dr.punteggio ? coloreForza(dr.punteggio) : C.riga }}>
                      <div className="flex items-center gap-2 text-xs pt-1"><b>{dr.driver}</b> <Puntini valore={dr.punteggio} colore={dr.punteggio ? coloreForza(dr.punteggio) : C.riga} /></div>
                      <Voce nodo={dr} percorso={["forze", k, "driver", i]} onModifica={mod} indice={indice} />
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoFcs({ d, mod, indice }) {
  return (
    <>
      {(d.fcs || []).length === 0 && <p className="text-xs italic" style={{ color: C.muto }}>Nessun fattore critico documentato.</p>}
      <ol className="space-y-2">
        {(d.fcs || []).map((f, i) => (
          <li key={i} className="rounded-md border p-3" style={{ borderColor: C.riga }}>
            <div className="text-sm" style={{ fontWeight: 600 }}>{i + 1}. {f.fattore}</div>
            <Voce nodo={f} percorso={["fcs", i]} onModifica={mod} indice={indice} />
            {(f.kpi || []).length > 0 && <div className="flex flex-wrap gap-1"><span className="st-eyebrow" style={{ color: C.muto }}>si misura con</span>{f.kpi.map((k) => <Pillola key={k}>{k}</Pillola>)}</div>}
          </li>
        ))}
      </ol>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function MatriceRischio({ opportunita = [], minacce = [] }) {
  const celle = {};
  opportunita.forEach((o, i) => { if (o.probabilita && o.impatto) (celle[`${o.probabilita}-${o.impatto}`] = celle[`${o.probabilita}-${o.impatto}`] || []).push({ id: `O${i + 1}`, col: C.ok }); });
  minacce.forEach((o, i) => { if (o.probabilita && o.impatto) (celle[`${o.probabilita}-${o.impatto}`] = celle[`${o.probabilita}-${o.impatto}`] || []).push({ id: `M${i + 1}`, col: C.allarme }); });
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "28px repeat(5, minmax(44px, 1fr))" }}>
        {[5, 4, 3, 2, 1].map((imp) => (
          <React.Fragment key={imp}>
            <div className="text-xs text-right pr-1 self-center" style={{ fontFamily: F.mono, color: C.muto }}>{imp}</div>
            {[1, 2, 3, 4, 5].map((pr) => {
              const peso = pr * imp;
              return (
                <div key={pr} className="rounded p-1 flex flex-wrap gap-0.5 content-start" style={{ minHeight: 40, background: peso >= 15 ? C.allarmeTenue : peso >= 8 ? C.ambraTenue : C.fondo }}>
                  {(celle[`${pr}-${imp}`] || []).map((x) => <span key={x.id} className="rounded px-1" style={{ background: x.col, color: "#fff", fontFamily: F.mono, fontSize: 9 }}>{x.id}</span>)}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div />
        {[1, 2, 3, 4, 5].map((pr) => <div key={pr} className="text-xs text-center" style={{ fontFamily: F.mono, color: C.muto }}>{pr}</div>)}
      </div>
      <p className="text-xs mt-1" style={{ color: C.muto }}>Asse verticale: impatto · asse orizzontale: probabilità. O = opportunità, M = minaccia.</p>
    </div>
  );
}

function ListaOM({ voci, tipo, mod, indice }) {
  const [col, bg] = tipo === "opportunita" ? [C.ok, C.okTenue] : [C.allarme, C.allarmeTenue];
  const pref = tipo === "opportunita" ? "O" : "M";
  return (
    <ol className="space-y-1.5">
      {voci.map((o, i) => (
        <li key={i} className="pl-3 border-l-2" style={{ borderColor: col }}>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="rounded px-1.5" style={{ background: bg, color: col, fontFamily: F.mono, fontSize: 10 }}>{pref}{i + 1}</span>
            {o.origine && <Pillola>{o.origine}</Pillola>}
            <span className="st-eyebrow" style={{ color: C.muto }}>prob.</span><SceltaPunteggio valore={o.probabilita} etichetta="Probabilità" onCambia={(v) => mod([tipo, i, "probabilita"], v)} />
            <span className="st-eyebrow" style={{ color: C.muto }}>impatto</span><SceltaPunteggio valore={o.impatto} etichetta="Impatto" onCambia={(v) => mod([tipo, i, "impatto"], v)} />
            {o.orizzonte && <Pillola>{o.orizzonte}</Pillola>}
          </div>
          <Voce nodo={o} percorso={[tipo, i]} onModifica={mod} indice={indice} />
        </li>
      ))}
    </ol>
  );
}

function CorpoOm({ d, mod, indice }) {
  return (
    <>
      <Voce etichetta="Giudizio di attrattività" nodo={d.giudizio_attrattivita} percorso={["giudizio_attrattivita"]} onModifica={mod} indice={indice} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
        <div>
          <div className="st-eyebrow mb-1" style={{ color: C.ok }}>Opportunità · {(d.opportunita || []).length}</div>
          <ListaOM voci={d.opportunita || []} tipo="opportunita" mod={mod} indice={indice} />
        </div>
        <div>
          <div className="st-eyebrow mb-1" style={{ color: C.allarme }}>Minacce · {(d.minacce || []).length}</div>
          <ListaOM voci={d.minacce || []} tipo="minacce" mod={mod} indice={indice} />
        </div>
      </div>
      <div className="mt-4">
        <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Matrice probabilità × impatto</div>
        <MatriceRischio opportunita={d.opportunita} minacce={d.minacce} />
      </div>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function VistaFase2({ stato, dispatch }) {
  const unita = useMemo(() => unitaDiAnalisi(stato), [stato.fase1, stato.xbrl]);
  const [chiave, setChiave] = useState(null);
  const u = unita.find((x) => x.chiave === chiave) || unita[0];
  const [inCorso, setInCorso] = useState(null);
  const fermato = useRef(false);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const f = stato.fase2?.[u.chiave] || { sezioni: {} };
  const indice = useMemo(() => {
    const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
    const out = {};
    for (const l of Object.values(stato.estratti)) for (const e of l) out[e.id] = { e, d: metaDoc[e.docId] };
    return out;
  }, [stato.estratti, stato.documenti]);
  const disponibilita = useMemo(() => Object.fromEntries(SEZIONI_FASE2.map((s) => [s.id, selezionaEstratti(stato, "principale", s)])), [stato.estratti, stato.documenti, stato.entita]);
  const p1 = profiloFase1(stato, "principale");
  const asaNonConfermate = !p1 || !(stato.fase1?.principale?.sezioni?.segmenti && stato.fase1.principale.sezioni.segmenti.stato !== "proposto");

  const genera = useCallback(async (sezioneId, precedenti = null) => {
    const sez = sezioneFase2(sezioneId);
    setInCorso(sezioneId);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: u.nome, fase: `Fase 2 · ${sez.titolo}`, blocco: 0, totale: 0 } });
    try {
      const corrente = statoRef.current;
      const base = precedenti || Object.fromEntries(Object.entries(corrente.fase2?.[u.chiave]?.sezioni || {}).map(([k, v]) => [k, v.dati]));
      const risultato = await generaSezioneFase2({ stato: corrente, unita: u, sezioneId, precedenti: base });
      dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase2", chiave: u.chiave, sezioneId, risultato, meta: { nome: u.nome, gruppo: u.gruppo } });
      dispatch({ tipo: "LOG", livello: "ok", testo: `${sez.titolo} per «${u.nome}» proposta su ${plurale(risultato.estrattiForniti, "estratto", "estratti")}, ${risultato.evidenzeUsate} citati. Da confermare.` });
      return risultato.dati;
    } catch (err) {
      dispatch({ tipo: "LOG", livello: err.vuoto ? "attenzione" : "errore", testo: `${sez.titolo} (${u.nome}): ${err.message}` });
      if (err.definitivo) throw err;
      return null;
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(null);
    }
  }, [dispatch, u]);

  const generaTutte = async () => {
    fermato.current = false;
    const raccolti = Object.fromEntries(Object.entries(f.sezioni || {}).map(([k, v]) => [k, v.dati]));
    try {
      for (const s of SEZIONI_FASE2) {
        if (fermato.current) break;
        if (f.sezioni[s.id]?.stato === "confermato") continue;
        const dati = await genera(s.id, raccolti);
        if (dati) raccolti[s.id] = dati;
      }
    } catch { /* errore definitivo già registrato nel log */ }
  };

  const validate = SEZIONI_FASE2.filter((s) => f.sezioni[s.id] && f.sezioni[s.id].stato !== "proposto").length;
  const riepilogo = unita.map((x) => ({ x, p: profiloFase2(stato, x.chiave), tutte: stato.fase2?.[x.chiave]?.sezioni || {} }));

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 2 · Analisi esterna</span>
          <nav className="flex rounded-md overflow-x-auto border max-w-full" style={{ borderColor: C.riga }}>
            {unita.map((x) => (
              <button key={x.chiave} onClick={() => setChiave(x.chiave)} className="st-btn px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 text-xs"
                style={{ borderColor: C.riga, background: u.chiave === x.chiave ? C.inchiostro : C.carta, color: u.chiave === x.chiave ? "#fff" : C.muto }}>
                {x.nome}{x.peso ? ` · ${fmtNumero(x.peso, 0)}%` : ""}
              </button>
            ))}
          </nav>
          <span className="text-xs" style={{ color: C.muto }}>{validate} / {SEZIONI_FASE2.length} sezioni validate</span>
          <div className="ml-auto">
            {inCorso ? (
              <button onClick={() => { fermato.current = true; }} className="st-btn rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: C.allarme, color: C.allarme }}>Ferma dopo questa sezione</button>
            ) : (
              <button onClick={generaTutte} className="st-btn flex items-center gap-2 rounded-md px-3 py-1.5 text-sm" style={{ background: C.annuale, color: "#fff" }}>
                <RefreshCw size={13} /> Genera le sezioni non confermate
              </button>
            )}
          </div>
        </div>
      </div>

      {asaNonConfermate && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
          <div className="flex items-start gap-3 rounded-md border px-4 py-3" style={{ borderColor: C.ambra, background: C.ambraTenue }}>
            <Info size={16} className="mt-0.5 shrink-0" style={{ color: C.ambra }} />
            <p className="text-sm">La sezione 1C «Segmenti e ASA» non è ancora confermata: l'analisi esterna si fa sul gruppo nel suo insieme. Conferma le ASA in Fase 1 per ripeterla su ciascuna area d'affari.</p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {SEZIONI_FASE2.map((s) => {
            const sez = f.sezioni[s.id];
            const st = sez ? STATO_SEZIONE[sez.stato] : null;
            const disp = disponibilita[s.id];
            const Icona = s.icona;
            const mod = (percorso, valore) => dispatch({ tipo: "SEZ_MODIFICA", ramo: "fase2", chiave: u.chiave, sezioneId: s.id, percorso, valore });
            const bloccataOm = s.id === "om" && !["pestel", "forze"].some((k) => f.sezioni[k]);
            return (
              <Scheda key={s.id}>
                <Intestazione icona={<Icona size={14} />} titolo={s.titolo} nota={s.nota} colore={C.contesto}
                  badge={st ? <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: st.sfondo, color: st.colore }}>{st.label}</span> : null} />
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs" style={{ color: disp.propri ? C.muto : C.allarme }}>
                      Materiale: {plurale(disp.propri, "estratto sul tema", "estratti sul tema")}, {disp.quanti - disp.propri} di supporto o derivati
                      {sez ? ` · proposta del ${new Date(sez.generatoIl).toLocaleDateString("it-IT")} (${sez.modello}), ${sez.evidenzeUsate} estratti citati` : ""}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => genera(s.id).catch(() => {})} disabled={!!inCorso || !disp.quanti} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs"
                        style={{ borderColor: C.riga, opacity: inCorso || !disp.quanti ? 0.5 : 1 }}>
                        <RefreshCw size={12} className={inCorso === s.id ? "animate-spin" : ""} /> {inCorso === s.id ? "in corso…" : sez ? "Rigenera" : "Genera"}
                      </button>
                      {sez && sez.stato !== "confermato" && (
                        <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase2", chiave: u.chiave, sezioneId: s.id, stato: "confermato" })} className="st-btn flex items-center gap-1 rounded px-2.5 py-1 text-xs" style={{ background: C.ok, color: "#fff" }}>
                          <Check size={12} /> Conferma
                        </button>
                      )}
                      {sez && sez.stato === "confermato" && (
                        <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase2", chiave: u.chiave, sezioneId: s.id, stato: "proposto" })} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, color: C.muto }}>Riapri</button>
                      )}
                    </span>
                  </div>
                  {!sez && (
                    <p className="text-sm" style={{ color: C.muto }}>
                      {!disp.quanti ? "Nessun estratto utile: carica in Fase 0 studi di settore, dati macro, normativa o i filing con i Risk Factors."
                        : bloccataOm ? "Conviene generare prima PESTEL e cinque forze: la sintesi parte da quelle sezioni." : "Sezione non ancora generata."}
                    </p>
                  )}
                  {sez && s.id === "pestel" && <CorpoPestel d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "ciclo" && <CorpoCiclo d={sez.dati} mod={mod} indice={indice} stato={stato} />}
                  {sez && s.id === "forze" && <CorpoForze d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "fcs" && <CorpoFcs d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "om" && <CorpoOm d={sez.dati} mod={mod} indice={indice} />}
                </div>
              </Scheda>
            );
          })}
        </div>
        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="Quadro delle ASA"
              nota="Solo le sezioni confermate o modificate entrano nel quadro e passano alle Fasi 3 e 5." />
            <div className="px-4 pb-4 space-y-2">
              {riepilogo.map(({ x, p, tutte }) => (
                <div key={x.chiave} className="rounded-md border p-2.5 text-xs" style={{ borderColor: x.chiave === u.chiave ? C.contesto : C.rigaTenue }}>
                  <div className="flex items-center gap-2">
                    <b className="flex-1">{x.nome}</b>
                    <span className="st-eyebrow" style={{ color: C.muto }}>{Object.values(tutte).filter((v) => v.stato !== "proposto").length}/{SEZIONI_FASE2.length}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5" style={{ color: C.muto }}>
                    <span>Attrattività</span><b style={{ color: C.inchiostro }}>{p?.attrattivita ? `${p.attrattivita.indice}/100` : "—"}</b>
                    <span>Ciclo di vita</span><b style={{ color: C.inchiostro }}>{FASI_CICLO.find(([k]) => k === p?.ciclo?.fase_settore?.fase)?.[1] || "—"}</b>
                    <span>Opportunità / minacce</span><b style={{ color: C.inchiostro }}>{p?.om ? `${(p.om.opportunita || []).length} / ${(p.om.minacce || []).length}` : "—"}</b>
                    <span>Fattori critici</span><b style={{ color: C.inchiostro }}>{p?.fcs?.fcs?.length ?? "—"}</b>
                  </div>
                </div>
              ))}
            </div>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => { fermato.current = true; }} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [16] FASE 3 — ANALISI INTERNA
   --------------------------------------------------------------------------
   Dopo aver capito che cosa succede fuori, si guarda dentro (§3.4, cap. 4):
   l'azienda ha le risorse e le competenze per vincere nelle sue ASA?

     3A Corporate strategy e portafoglio   → livello società
     3B Strategia competitiva              → per ASA
     3C Catena del valore                  → per ASA
     3D Risorse, capitale intangibile, VRIO → per ASA, collegate ai FCS della Fase 2
     3E Governance e management            → livello società
     3F Punti di forza e di debolezza      → per ASA, tutti «dichiarati» e consegnati alla Fase 4

   Calcolati dal sistema: categoria BCG (da quota relativa e crescita del
   mercato), zona della matrice GE (attrattività dalla Fase 2 × posizione
   competitiva), esito VRIO (dalla sequenza delle quattro domande) e copertura
   dei fattori critici di successo da parte delle risorse.
   ========================================================================== */

const CHIAVE_SOCIETA = "principale::societa";

const SEZIONI_FASE3 = [
  { id: "corporate", livello: "societa", titolo: "3A · Corporate strategy e portafoglio", icona: Layers, contesto: false, peer: false,
    temi: ["crescita_esterna", "strategia", "segmenti"], supporto: ["politica_finanziaria", "modello_business"],
    nota: "Dove l'azienda sceglie di competere (§4.3): monobusiness o diversificata, integrazione verticale, acquisizioni e cessioni, ruolo di ciascuna ASA nel portafoglio. Livello società: vale per tutte le ASA." },
  { id: "competitiva", livello: "asa", titolo: "3B · Strategia competitiva", icona: Target, contesto: false, peer: false,
    temi: ["strategia", "concorrenza", "modello_business"], supporto: ["clienti", "capitale_relazionale", "operations", "innovazione"],
    nota: "Come l'azienda compete nell'ASA: leadership di costo, differenziazione o focus. Ogni strategia lascia tracce attese nel bilancio: qui si dichiarano, in Fase 4 si cercano." },
  { id: "catena", livello: "asa", titolo: "3C · Catena del valore", icona: GitBranch, contesto: false, peer: false,
    temi: ["operations", "fornitori", "innovazione", "modello_business"], supporto: ["capitale_umano", "clienti"],
    nota: "Le attività primarie e di supporto (§3.13): quali sono svolte all'interno, quali esternalizzate, e in quale fase si crea il margine." },
  { id: "risorse", livello: "asa", titolo: "3D · Risorse, capitale intangibile e VRIO", icona: Database, contesto: false, peer: false,
    temi: ["innovazione", "capitale_umano", "capitale_relazionale", "operations"], supporto: ["identita", "governance", "modello_business"],
    nota: "Capitale umano, relazionale e strutturale (§2.9) e risorse tangibili. Per ognuna il test VRIO: valore, rarità, inimitabilità, organizzazione. Le risorse sono collegate ai fattori critici di successo della Fase 2." },
  { id: "governance", livello: "societa", titolo: "3E · Governance e management", icona: Users, contesto: false, peer: false,
    temi: ["governance", "incentivi", "controlli_revisione"], supporto: ["capitale_umano", "rischi", "eventi"],
    nota: "Come è governata l'azienda e chi la guida: board, vertice, assetti proprietari, incentivi e loro allineamento con la strategia, parti correlate, segnali sui controlli. Livello società." },
  { id: "swot", livello: "asa", titolo: "3F · Punti di forza e di debolezza", icona: Scale, contesto: false, peer: false,
    temi: ["rischi", "strategia", "concorrenza"], supporto: ["innovazione", "capitale_umano", "operations", "clienti", "fornitori", "politica_finanziaria"],
    nota: "La sintesi interna: forze e debolezze rispetto ai fattori critici di successo. Sono tutte «dichiarate»: entreranno nella SWOT della Fase 5 solo dopo la verifica numerica della Fase 4." },
];
const sezioneFase3 = (id) => SEZIONI_FASE3.find((s) => s.id === id);

const ATTIVITA_PRIMARIE = [["logistica_entrata", "Logistica in entrata"], ["operations", "Operations / produzione"], ["logistica_uscita", "Logistica in uscita"], ["marketing_vendite", "Marketing e vendite"], ["servizi", "Servizi post-vendita"]];
const ATTIVITA_SUPPORTO = [["infrastruttura", "Infrastruttura d'impresa"], ["risorse_umane", "Gestione delle risorse umane"], ["tecnologia", "Sviluppo tecnologico / R&S"], ["approvvigionamento", "Approvvigionamento"]];
const STRATEGIE_COMPETITIVE = {
  leadership_costo: "Leadership di costo", differenziazione: "Differenziazione", focus_costo: "Focus sul costo",
  focus_differenziazione: "Focus sulla differenziazione", ibrida: "Ibrida", non_definita: "Non definita (stuck in the middle)",
};
const CATEGORIE_RISORSA = { umano: "Capitale umano", relazionale: "Capitale relazionale", strutturale: "Capitale strutturale", tangibile: "Risorsa tangibile", finanziaria: "Risorsa finanziaria" };
const ESITI_VRIO = {
  svantaggio: ["Svantaggio competitivo", C.allarme], parita: ["Parità competitiva", C.muto], temporaneo: ["Vantaggio temporaneo", C.ambra],
  non_sfruttato: ["Vantaggio non sfruttato", C.ambra], sostenibile: ["Vantaggio sostenibile", C.ok],
};
const VALUTAZIONI = { positiva: [C.ok, C.okTenue], negativa: [C.allarme, C.allarmeTenue], neutra: [C.muto, C.fondo] };

const nodoVoce = `{ "testo": "...", "valutazione": "positiva" | "negativa" | "neutra", "evidenze": ["E#"] } | null`;
const nodoAttivita = `{ "svolta": "interna" | "esternalizzata" | "mista" | null, "rilevanza": <1-5: quanto contribuisce al margine>, "testo": "...", "evidenze": ["E#"] } | null`;

const SCHEMI_FASE3 = {
  corporate: `{
  "assetto": { "tipo": "monobusiness" | "diversificata_correlata" | "diversificata_non_correlata" | null, "testo": "<come è composto il perimetro delle attività>", "evidenze": ["E#"] },
  "integrazione_verticale": { "testo": "<a monte/a valle, make or buy>", "evidenze": ["E#"] } | null,
  "operazioni": [ { "testo": "<acquisizione, cessione, joint venture, alleanza, investimento rilevante>", "tipo": "acquisizione" | "cessione" | "joint_venture" | "alleanza" | "investimento", "anno": <intero o null>, "evidenze": ["E#"] } ],
  "portafoglio": [ { "asa": "<nome ESATTO di una delle ASA indicate>", "quota_relativa": "alta" | "bassa" | null, "crescita_mercato": "alta" | "bassa" | null,
                     "posizione_competitiva": <1-5>, "testo": "<ruolo dell'ASA nel portafoglio: generatrice di cassa, motore di crescita, da ristrutturare…>", "evidenze": ["E#"] } ],
  "allocazione_capitale": { "testo": "<dove va il capitale: investimenti, M&A, dividendi, riacquisti>", "evidenze": ["E#"] } | null,
  "lacune": ["..."]
}
"quota_relativa" è la quota rispetto al principale concorrente; "crescita_mercato" è alta se il mercato cresce più
dell'economia. Usa i dati della Fase 2 indicati sopra quando ci sono.`,
  competitiva: `{
  "strategia": { "tipo": "leadership_costo" | "differenziazione" | "focus_costo" | "focus_differenziazione" | "ibrida" | "non_definita", "testo": "<motivazione>", "evidenze": ["E#"] },
  "fonti_vantaggio": [ { "testo": "<fonte del vantaggio dichiarata: marchio, tecnologia, scala, rete, servizio…>", "evidenze": ["E#"] } ],
  "kpi_attesi": [ { "kpi": "<indicatore di bilancio>", "testo": "<che cosa dovrebbe mostrare il bilancio se la strategia è reale, es. margine lordo superiore ai peer, spese di R&S in crescita>", "evidenze": ["E#"] } ],
  "coerenza_fcs": { "testo": "<la strategia risponde ai fattori critici di successo dell'ASA?>", "evidenze": ["E#"] },
  "lacune": ["..."]
}`,
  catena: `{
  "primarie": {
${ATTIVITA_PRIMARIE.map(([k]) => `    "${k}": ${nodoAttivita}`).join(",\n")}
  },
  "supporto": {
${ATTIVITA_SUPPORTO.map(([k]) => `    "${k}": ${nodoAttivita}`).join(",\n")}
  },
  "dove_si_crea_valore": { "testo": "<in quali fasi l'azienda concentra il margine e perché>", "evidenze": ["E#"] },
  "lacune": ["..."]
}`,
  risorse: `{
  "risorse": [
    { "nome": "<risorsa o competenza>", "categoria": "umano" | "relazionale" | "strutturale" | "tangibile" | "finanziaria",
      "testo": "<descrizione documentata>",
      "vrio": { "valore": <true|false|null>, "rarita": <true|false|null>, "inimitabilita": <true|false|null>, "organizzazione": <true|false|null> },
      "fcs_collegati": ["<nome ESATTO di un fattore critico di successo fra quelli indicati>"],
      "evidenze": ["E#"] }
  ],
  "lacune": ["..."]
}
VRIO: valore = permette di sfruttare opportunità o neutralizzare minacce; rarità = pochi concorrenti la possiedono;
inimitabilità = costosa o lenta da imitare (brevetti, storia, reti, cultura); organizzazione = l'azienda è organizzata
per sfruttarla. Usa null quando gli estratti non permettono di rispondere.`,
  governance: `{
  "board": ${nodoVoce},
  "vertice": ${nodoVoce},
  "assetti_proprietari": ${nodoVoce},
  "incentivi": { "testo": "...", "metriche": ["<metrica a cui è legata la remunerazione variabile>"], "allineamento": "allineati" | "parziali" | "disallineati" | null, "valutazione": "positiva" | "negativa" | "neutra", "evidenze": ["E#"] } | null,
  "parti_correlate": ${nodoVoce},
  "segnali": [ { "testo": "<cambio revisore, restatement, debolezze dei controlli, uscite al vertice, rilievi SEC…>", "valutazione": "positiva" | "negativa" | "neutra", "evidenze": ["E#"] } ],
  "qualita_management": { "testo": "<esperienza, continuità, coerenza fra quanto annunciato e quanto fatto, se documentata>", "valutazione": "positiva" | "negativa" | "neutra", "evidenze": ["E#"] },
  "lacune": ["..."]
}
"vertice" comprende la coincidenza fra presidente e amministratore delegato, anzianità e cambi recenti;
"allineamento" dice se le metriche degli incentivi spingono nella direzione della strategia dichiarata.`,
  swot: `{
  "forze": [ { "testo": "<punto di forza>", "origine": "<3A | 3B | 3C | 3D | 3E | Fase 1>", "fcs_collegato": "<nome FCS o null>", "kpi_verifica": ["<indicatore con cui la Fase 4 lo verificherà>"], "evidenze": ["E#"] } ],
  "debolezze": [ { "testo": "<punto di debolezza>", "origine": "...", "fcs_collegato": "<nome FCS o null>", "kpi_verifica": ["..."], "evidenze": ["E#"] } ],
  "lacune": ["..."]
}
Considera debolezza anche un fattore critico di successo per cui l'azienda non mostra risorse adeguate.
Sono punti INTERNI: non ripetere opportunità e minacce dell'ambiente.`,
};

/** VRIO: l'esito segue la sequenza delle domande, non il giudizio del modello. */
function esitoVrio(v) {
  if (!v) return null;
  const { valore, rarita, inimitabilita, organizzazione } = v;
  if (valore === false) return "svantaggio";
  if (valore !== true) return null;
  if (rarita === false) return "parita";
  if (rarita !== true) return null;
  if (inimitabilita === false) return "temporaneo";
  if (inimitabilita !== true) return null;
  if (organizzazione === false) return "non_sfruttato";
  if (organizzazione !== true) return null;
  return "sostenibile";
}

const aBooleano = (x) => (x === true || x === false ? x : typeof x === "string" ? (/^(true|si|sì|yes)$/i.test(x.trim()) ? true : /^(false|no)$/i.test(x.trim()) ? false : null) : null);
function normalizzaFase3(dati, sezioneId) {
  const d = normalizzaPunteggi(dati);
  if (sezioneId === "risorse" && Array.isArray(d.risorse)) {
    d.risorse = d.risorse.map((r) => ({
      ...r,
      vrio: Object.fromEntries(["valore", "rarita", "inimitabilita", "organizzazione"].map((k) => [k, aBooleano(r.vrio?.[k])])),
      fcs_collegati: Array.isArray(r.fcs_collegati) ? r.fcs_collegati.filter((x) => typeof x === "string") : [],
    }));
  }
  return d;
}

const CATEGORIE_BCG = {
  "alta|alta": ["Stella", C.ok], "alta|bassa": ["Vacca da mungere", C.periodico],
  "bassa|alta": ["Dilemma", C.ambra], "bassa|bassa": ["Cane", C.allarme],
};
const categoriaBcg = (p) => (p?.quota_relativa && p?.crescita_mercato ? CATEGORIE_BCG[`${p.quota_relativa}|${p.crescita_mercato}`] : null);
function zonaGe(attrattivita, posizione) {
  if (attrattivita === null || attrattivita === undefined || !posizione) return null;
  const a = attrattivita >= 60 ? 3 : attrattivita >= 40 ? 2 : 1;
  const p = posizione >= 4 ? 3 : posizione >= 3 ? 2 : 1;
  const somma = a + p;
  return somma >= 5 ? ["Investire e crescere", C.ok] : somma >= 4 ? ["Selettività", C.ambra] : ["Raccogliere o dismettere", C.allarme];
}

/** Fattori critici di successo dell'ASA (Fase 2, anche se solo proposti) e loro copertura con le risorse. */
function fcsDellUnita(stato, chiave) {
  return (stato.fase2?.[chiave]?.sezioni?.fcs?.dati?.fcs || []).map((f) => f.fattore).filter(Boolean);
}
function coperturaFcs(fcs, risorse = []) {
  return fcs.map((nome) => {
    const collegate = risorse.filter((r) => (r.fcs_collegati || []).some((x) => normalizzaNome(x) === normalizzaNome(nome)));
    const valide = collegate.filter((r) => ["temporaneo", "non_sfruttato", "sostenibile"].includes(esitoVrio(r.vrio)));
    return { nome, collegate, valide, esito: valide.some((r) => esitoVrio(r.vrio) === "sostenibile") ? "presidiato" : valide.length ? "parziale" : collegate.length ? "debole" : "scoperto" };
  });
}

/** Contesto delle fasi precedenti, in testo, per i prompt della Fase 3. */
function contestoPerFase3(stato, unita, sezioneId) {
  const righe = [];
  const p1 = profiloFase1(stato, "principale");
  const tutte = unitaDiAnalisi(stato);
  if (sezioneId === "corporate") {
    righe.push(`ASA dell'analisi: ${tutte.map((u) => `«${u.nome}»${u.peso ? ` (${fmtNumero(u.peso, 1)}% dei ricavi)` : ""}`).join(", ")}.`);
    for (const u of tutte) {
      const f2 = stato.fase2?.[u.chiave]?.sezioni || {};
      const att = attrattivitaDaForze(f2.forze?.dati?.forze);
      const fase = f2.ciclo?.dati?.fase_settore?.fase;
      const cresc = (f2.ciclo?.dati?.crescita_mercato || []).map((c) => c.testo).filter(Boolean).slice(0, 2).join("; ");
      righe.push(`Fase 2 per «${u.nome}»: attrattività ${att ? `${att.indice}/100` : "n.d."}, ciclo di vita ${fase || "n.d."}${cresc ? `, mercato: ${cresc}` : ""}.`);
    }
    const quote = p1?.perimetro?.quote_mercato || [];
    if (quote.length) righe.push(`Quote di mercato (Fase 1): ${quote.map((q) => `${q.soggetto} ${q.valore ?? "n.d."}${q.unita || ""} ${q.periodo || ""}`).join("; ")}.`);
  } else if (sezioneId !== "governance") {
    righe.push(`UNITÀ DI ANALISI: ${unita.gruppo ? "il gruppo nel suo insieme" : `ASA «${unita.nome}»${unita.descrizione ? ` — ${unita.descrizione}` : ""}`}.`);
    if (!unita.gruppo) righe.push("Gli estratti riguardano spesso l'intera società: usa solo ciò che è pertinente a questa ASA.");
    const f2 = stato.fase2?.[unita.chiave]?.sezioni || {};
    const fcs = fcsDellUnita(stato, unita.chiave);
    if (fcs.length) righe.push(`Fattori critici di successo dell'ASA (Fase 2): ${fcs.map((x) => `«${x}»`).join(", ")}.`);
    const forze = f2.forze?.dati?.forze;
    if (forze) righe.push(`Cinque forze (Fase 2): ${FORZE.map(([k, l]) => `${l} ${forze[k]?.punteggio ?? "n.d."}`).join(", ")}.`);
    if (f2.ciclo?.dati?.fase_settore?.fase) righe.push(`Ciclo di vita (Fase 2): ${f2.ciclo.dati.fase_settore.fase}.`);
    if (sezioneId === "swot") {
      const f3a = stato.fase3?.[CHIAVE_SOCIETA]?.sezioni || {};
      const f3 = stato.fase3?.[unita.chiave]?.sezioni || {};
      const st = f3.competitiva?.dati?.strategia;
      if (st?.tipo) righe.push(`Strategia competitiva (3B): ${STRATEGIE_COMPETITIVE[st.tipo] || st.tipo} — ${st.testo || ""}`);
      const ris = f3.risorse?.dati?.risorse || [];
      if (ris.length) righe.push(`Risorse (3D): ${ris.map((r) => `${r.nome} [${ESITI_VRIO[esitoVrio(r.vrio)]?.[0] || "VRIO incompleto"}]`).join("; ")}.`);
      const cop = coperturaFcs(fcs, ris);
      if (cop.length) righe.push(`Copertura dei FCS: ${cop.map((c) => `${c.nome}: ${c.esito}`).join("; ")}.`);
      const gov = f3a.governance?.dati;
      if (gov) righe.push(`Governance (3E): ${["board", "vertice", "incentivi", "qualita_management"].map((k) => gov[k]?.testo ? `${k} ${gov[k].valutazione || ""}: ${gov[k].testo}` : null).filter(Boolean).join(" | ")}`);
      const aff = p1?.affermazioniDaVerificare || [];
      if (aff.length) righe.push(`Affermazioni del management (Fase 1): ${aff.map((a) => a.testo).join("; ")}.`);
    }
  }
  return righe.join("\n");
}

const SYSTEM_FASE3 = SYSTEM_FASE1.replace(
  "Sei un analista strategico che redige il profilo di una società per un'analisi\nfondamentale.",
  "Sei un analista strategico che conduce l'ANALISI INTERNA (strategie, risorse, organizzazione) di una\nsocietà per un'analisi fondamentale. Ricorda che ciò che il management afferma di sé è da verificare.");

async function generaSezioneFase3({ stato, unita, sezioneId }) {
  const sezione = sezioneFase3(sezioneId);
  const ent = stato.entita.find((e) => e.id === "principale");
  const sel = selezionaEstratti(stato, "principale", sezione);
  if (!sel.quanti) {
    const err = new Error(`nessun estratto disponibile sui temi ${sezione.temi.map((t) => TEMI[t].label).join(", ")}: carica in Fase 0 i 10-K/20-F, il proxy statement, le presentazioni o le trascrizioni delle call.`);
    err.vuoto = true;
    throw err;
  }
  const testo = await chiamataIA({
    system: SYSTEM_FASE3,
    contenuto: `SOCIETÀ: ${nomeEntita(ent)}${ent.settore ? ` — settore dichiarato: ${ent.settore}` : ""}
SEZIONE: ${sezione.titolo}. ${sezione.nota}
${contestoPerFase3(stato, unita, sezioneId)}

ESTRATTI (${sel.quanti}):
${sel.testo}

Restituisci esattamente questa struttura:
${SCHEMI_FASE3[sezioneId]}`,
    maxTokens: 7000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object") throw new Error("risposta del modello non interpretabile");
  const usati = new Set();
  const dati = normalizzaFase3(validaEvidenze(json, sel.mappa, usati), sezioneId);
  return { dati, estrattiForniti: sel.quanti, evidenzeUsate: usati.size, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}` };
}

/** Analisi interna di un'unità (sezioni dell'ASA + sezioni di società), nella forma letta dalle fasi successive. */
function profiloFase3(stato, chiave) {
  const s = (k, id) => {
    const x = stato.fase3?.[k]?.sezioni?.[id];
    return x && x.stato !== "proposto" ? x.dati : null;
  };
  const risorse = s(chiave, "risorse");
  return {
    corporate: s(CHIAVE_SOCIETA, "corporate"),
    governance: s(CHIAVE_SOCIETA, "governance"),
    competitiva: s(chiave, "competitiva"),
    catena: s(chiave, "catena"),
    risorse,
    swot: s(chiave, "swot"),
    coperturaFcs: coperturaFcs(fcsDellUnita(stato, chiave), risorse?.risorse || []),
  };
}

/* ==========================================================================
   [17] INTERFACCIA DELLA FASE 3
   ========================================================================== */

function Valutazione({ v }) {
  if (!v) return null;
  const [col, bg] = VALUTAZIONI[v] || VALUTAZIONI.neutra;
  return <Pillola colore={col} sfondo={bg}>{v}</Pillola>;
}

function CorpoCorporate({ d, mod, indice, stato }) {
  const unita = unitaDiAnalisi(stato);
  const portafoglio = d.portafoglio || [];
  const perAsa = (nome) => portafoglio.find((p) => normalizzaNome(p.asa) === normalizzaNome(nome));
  return (
    <>
      <Voce etichetta="Assetto del perimetro" nodo={d.assetto} percorso={["assetto"]} onModifica={mod} indice={indice}
        extra={d.assetto?.tipo && <Pillola colore={C.inchiostro}>{d.assetto.tipo.replace(/_/g, " ")}</Pillola>} />
      <Voce etichetta="Integrazione verticale" nodo={d.integrazione_verticale} percorso={["integrazione_verticale"]} onModifica={mod} indice={indice} />
      <Voce etichetta="Allocazione del capitale" nodo={d.allocazione_capitale} percorso={["allocazione_capitale"]} onModifica={mod} indice={indice} />
      {(d.operazioni || []).length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
          <div className="st-eyebrow" style={{ color: C.muto }}>Operazioni di crescita esterna e dismissione</div>
          {d.operazioni.map((o, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-2">
              <Pillola colore={C.inchiostro}>{o.tipo || "operazione"}{o.anno ? ` · ${o.anno}` : ""}</Pillola>
              <div className="flex-1 min-w-[200px]"><Voce nodo={o} percorso={["operazioni", i]} onModifica={mod} indice={indice} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="st-eyebrow mt-4 mb-1" style={{ color: C.annuale }}>Portafoglio delle ASA</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: C.fondo }}>
              {["ASA", "Quota relativa", "Crescita mercato", "BCG", "Attrattività (F2)", "Posizione competitiva", "Matrice GE"].map((h) => <th key={h} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {unita.map((u) => {
              const idx = portafoglio.findIndex((p) => normalizzaNome(p.asa) === normalizzaNome(u.nome));
              const p = idx >= 0 ? portafoglio[idx] : null;
              const bcg = categoriaBcg(p);
              const att = attrattivitaDaForze(stato.fase2?.[u.chiave]?.sezioni?.forze?.dati?.forze);
              const ge = zonaGe(att?.indice, p?.posizione_competitiva);
              const scelta = (campo, opzioni) => (
                <select value={p?.[campo] ?? ""} disabled={idx < 0} onChange={(e) => mod(["portafoglio", idx, campo], e.target.value === "" ? null : campo === "posizione_competitiva" ? Number(e.target.value) : e.target.value)}
                  className="rounded border px-1 py-0.5" style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta }} aria-label={`${campo} ${u.nome}`}>
                  <option value="">—</option>{opzioni.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              );
              return (
                <tr key={u.chiave} className="border-t align-top" style={{ borderColor: C.rigaTenue }}>
                  <td className="px-2 py-1.5"><b>{u.nome}</b>{u.peso ? <span style={{ color: C.muto }}> · {fmtNumero(u.peso, 0)}%</span> : null}
                    {p && <div style={{ color: C.muto }}>{p.testo} <Evidenze ids={p.evidenze} indice={indice} /></div>}
                    {!p && <div style={{ color: C.allarme }}>non classificata dall'IA</div>}</td>
                  <td className="px-2 py-1.5">{scelta("quota_relativa", ["alta", "bassa"])}</td>
                  <td className="px-2 py-1.5">{scelta("crescita_mercato", ["alta", "bassa"])}</td>
                  <td className="px-2 py-1.5">{bcg ? <Pillola colore={bcg[1]}>{bcg[0]}</Pillola> : "—"}</td>
                  <td className="px-2 py-1.5" style={{ fontFamily: F.mono }}>{att ? `${att.indice}/100` : "—"}</td>
                  <td className="px-2 py-1.5">{scelta("posizione_competitiva", [1, 2, 3, 4, 5])}</td>
                  <td className="px-2 py-1.5">{ge ? <Pillola colore={ge[1]}>{ge[0]}</Pillola> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs" style={{ color: C.muto }}>Categoria BCG e zona della matrice GE sono calcolate dal sistema; l'attrattività viene dalle cinque forze della Fase 2. Quota, crescita e posizione si correggono dalla tabella.</p>
      {portafoglio.filter((p) => !unita.some((u) => normalizzaNome(u.nome) === normalizzaNome(p.asa))).length > 0 && (
        <p className="mt-1 text-xs" style={{ color: C.ambra }}>L'IA ha classificato anche aree non presenti fra le ASA confermate: {portafoglio.filter((p) => !unita.some((u) => normalizzaNome(u.nome) === normalizzaNome(p.asa))).map((p) => p.asa).join(", ")}.</p>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoCompetitiva({ d, mod, indice }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="st-eyebrow" style={{ color: C.muto }}>Strategia</span>
        <select value={d.strategia?.tipo || ""} onChange={(e) => mod(["strategia", "tipo"], e.target.value || null)} className="rounded border px-1.5 py-0.5"
          style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta }} aria-label="Strategia competitiva">
          <option value="">non determinata</option>
          {Object.entries(STRATEGIE_COMPETITIVE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <Voce etichetta="Motivazione" nodo={d.strategia} percorso={["strategia"]} onModifica={mod} indice={indice} />
      {(d.fonti_vantaggio || []).map((f, i) => <Voce key={i} etichetta={i === 0 ? "Fonti del vantaggio dichiarate" : null} nodo={f} percorso={["fonti_vantaggio", i]} onModifica={mod} indice={indice} />)}
      <Voce etichetta="Coerenza con i fattori critici di successo" nodo={d.coerenza_fcs} percorso={["coerenza_fcs"]} onModifica={mod} indice={indice} />
      {(d.kpi_attesi || []).length > 0 && (
        <div className="mt-3 rounded-md border p-3" style={{ borderColor: C.ambra }}>
          <div className="st-eyebrow mb-1" style={{ color: C.ambra }}>Tracce attese nel bilancio · da cercare in Fase 4</div>
          {d.kpi_attesi.map((k, i) => (
            <div key={i}>
              <Pillola colore={C.inchiostro}>{k.kpi}</Pillola>
              <Voce nodo={k} percorso={["kpi_attesi", i]} onModifica={mod} indice={indice} />
            </div>
          ))}
        </div>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoCatena({ d, mod, indice }) {
  const riga = (gruppo, [k, l]) => {
    const a = d[gruppo]?.[k];
    const colSv = a?.svolta === "interna" ? C.ok : a?.svolta === "esternalizzata" ? C.periodico : C.ambra;
    return (
      <div key={k} className="rounded-md border p-2.5" style={{ borderColor: C.riga, background: (a?.rilevanza || 0) >= 4 ? C.annualeTenue : C.carta }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm flex-1 min-w-[140px]" style={{ fontWeight: 600 }}>{l}</span>
          {a?.svolta && <Pillola colore={colSv}>{a.svolta}</Pillola>}
          <span className="st-eyebrow" style={{ color: C.muto }}>valore</span>
          <Puntini valore={a?.rilevanza} colore={C.annuale} />
          {a && <SceltaPunteggio valore={a.rilevanza} etichetta={`Rilevanza ${l}`} onCambia={(v) => mod([gruppo, k, "rilevanza"], v)} />}
        </div>
        {a ? <Voce nodo={a} percorso={[gruppo, k]} onModifica={mod} indice={indice} /> : <p className="text-xs italic" style={{ color: C.muto }}>Non documentata.</p>}
      </div>
    );
  };
  return (
    <>
      <div className="st-eyebrow mb-1" style={{ color: C.annuale }}>Attività primarie</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{ATTIVITA_PRIMARIE.map((x) => riga("primarie", x))}</div>
      <div className="st-eyebrow mt-3 mb-1" style={{ color: C.annuale }}>Attività di supporto</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{ATTIVITA_SUPPORTO.map((x) => riga("supporto", x))}</div>
      <Voce etichetta="Dove si crea il valore" nodo={d.dove_si_crea_valore} percorso={["dove_si_crea_valore"]} onModifica={mod} indice={indice} />
      <Lacune lacune={d.lacune} />
    </>
  );
}

const ciclaBool = (v) => (v === null || v === undefined ? true : v === true ? false : null);
function CorpoRisorse({ d, mod, indice, stato, chiave }) {
  const fcs = fcsDellUnita(stato, chiave);
  const copertura = coperturaFcs(fcs, d.risorse || []);
  const colCop = { presidiato: C.ok, parziale: C.ambra, debole: C.allarme, scoperto: C.allarme };
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: C.fondo }}>
              {["Risorsa", "V", "R", "I", "O", "Esito"].map((h) => <th key={h} className={`${h.length === 1 ? "text-center" : "text-left"} px-2 py-1.5 st-eyebrow`} style={{ color: C.muto }} title={{ V: "valore", R: "rarità", I: "inimitabilità", O: "organizzazione" }[h]}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(d.risorse || []).map((r, i) => {
              const esito = ESITI_VRIO[esitoVrio(r.vrio)];
              return (
                <tr key={i} className="border-t align-top" style={{ borderColor: C.rigaTenue }}>
                  <td className="px-2 py-1.5">
                    <b>{r.nome}</b> <Pillola>{CATEGORIE_RISORSA[r.categoria] || r.categoria || "n.d."}</Pillola>
                    <Voce nodo={r} percorso={["risorse", i]} onModifica={mod} indice={indice} />
                    {(r.fcs_collegati || []).length > 0 && <div className="flex flex-wrap gap-1"><span className="st-eyebrow" style={{ color: C.muto }}>FCS</span>{r.fcs_collegati.map((x) => <Pillola key={x} colore={C.contesto}>{x}</Pillola>)}</div>}
                  </td>
                  {["valore", "rarita", "inimitabilita", "organizzazione"].map((k) => {
                    const v = r.vrio?.[k];
                    return (
                      <td key={k} className="text-center px-1 py-1.5">
                        <button onClick={() => mod(["risorse", i, "vrio", k], ciclaBool(v))} className="st-btn rounded w-7 h-6" title="clic per cambiare: sì → no → non determinato"
                          style={{ background: v === true ? C.okTenue : v === false ? C.allarmeTenue : C.fondo, color: v === true ? C.ok : v === false ? C.allarme : C.muto, fontFamily: F.mono }}>
                          {v === true ? "sì" : v === false ? "no" : "?"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5">{esito ? <Pillola colore={esito[1]}>{esito[0]}</Pillola> : <span style={{ color: C.muto }}>incompleto</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs" style={{ color: C.muto }}>L'esito segue la sequenza VRIO e lo calcola il sistema; un clic su una casella cambia la risposta (sì → no → non determinato).</p>
      <div className="mt-4 rounded-md border p-3" style={{ borderColor: C.contesto }}>
        <div className="st-eyebrow mb-1" style={{ color: C.contesto }}>Copertura dei fattori critici di successo (Fase 2)</div>
        {!fcs.length && <p className="text-xs" style={{ color: C.muto }}>Nessun FCS per questa ASA: genera la sezione 2D in Fase 2.</p>}
        <ul className="space-y-1">
          {copertura.map((c) => (
            <li key={c.nome} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex-1 min-w-[160px]">{c.nome}</span>
              <span style={{ color: C.muto }}>{c.collegate.length ? c.collegate.map((r) => r.nome).join(", ") : "nessuna risorsa collegata"}</span>
              <Pillola colore={colCop[c.esito]}>{c.esito}</Pillola>
            </li>
          ))}
        </ul>
        {copertura.some((c) => c.esito === "scoperto" || c.esito === "debole") && <p className="mt-1 text-xs" style={{ color: C.allarme }}>Un FCS scoperto è un candidato punto di debolezza per la sezione 3F.</p>}
      </div>
      <Lacune lacune={d.lacune} />
    </>
  );
}

const VOCI_GOVERNANCE = [["board", "Consiglio di amministrazione"], ["vertice", "Vertice: presidente e amministratore delegato"], ["assetti_proprietari", "Assetti proprietari"], ["parti_correlate", "Parti correlate"]];
function CorpoGovernance({ d, mod, indice }) {
  return (
    <>
      {VOCI_GOVERNANCE.map(([k, l]) => <Voce key={k} etichetta={l} nodo={d[k]} percorso={[k]} onModifica={mod} indice={indice} extra={<Valutazione v={d[k]?.valutazione} />} />)}
      <Voce etichetta="Incentivi del management" nodo={d.incentivi} percorso={["incentivi"]} onModifica={mod} indice={indice}
        extra={<><Valutazione v={d.incentivi?.valutazione} />{d.incentivi?.allineamento && <Pillola colore={d.incentivi.allineamento === "allineati" ? C.ok : d.incentivi.allineamento === "disallineati" ? C.allarme : C.ambra}>{d.incentivi.allineamento} alla strategia</Pillola>}</>} />
      {(d.incentivi?.metriche || []).length > 0 && <div className="flex flex-wrap gap-1 mb-1"><span className="st-eyebrow" style={{ color: C.muto }}>metriche</span>{d.incentivi.metriche.map((m) => <Pillola key={m}>{m}</Pillola>)}</div>}
      <Voce etichetta="Qualità del management" nodo={d.qualita_management} percorso={["qualita_management"]} onModifica={mod} indice={indice} extra={<Valutazione v={d.qualita_management?.valutazione} />} />
      {(d.segnali || []).length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}>
          <div className="st-eyebrow" style={{ color: C.muto }}>Segnali</div>
          {d.segnali.map((s, i) => <div key={i} className="flex items-baseline gap-2"><Valutazione v={s.valutazione} /><div className="flex-1"><Voce nodo={s} percorso={["segnali", i]} onModifica={mod} indice={indice} /></div></div>)}
        </div>
      )}
      <Lacune lacune={d.lacune} />
    </>
  );
}

function CorpoSwot({ d, mod, indice }) {
  const lista = (tipo, col, bg, titolo) => (
    <div>
      <div className="st-eyebrow mb-1" style={{ color: col }}>{titolo} · {(d[tipo] || []).length}</div>
      <ol className="space-y-1.5">
        {(d[tipo] || []).map((x, i) => (
          <li key={i} className="pl-3 border-l-2" style={{ borderColor: col }}>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="rounded px-1.5" style={{ background: bg, color: col, fontFamily: F.mono, fontSize: 10 }}>{tipo === "forze" ? "S" : "W"}{i + 1}</span>
              {x.origine && <Pillola>{x.origine}</Pillola>}
              {x.fcs_collegato && <Pillola colore={C.contesto}>FCS: {x.fcs_collegato}</Pillola>}
              <Pillola colore={C.ambra} sfondo={C.ambraTenue}>dichiarato · da verificare</Pillola>
            </div>
            <Voce nodo={x} percorso={[tipo, i]} onModifica={mod} indice={indice} />
            {(x.kpi_verifica || []).length > 0 && <div className="flex flex-wrap gap-1 pb-1"><span className="st-eyebrow" style={{ color: C.muto }}>verifica con</span>{x.kpi_verifica.map((k) => <Pillola key={k}>{k}</Pillola>)}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {lista("forze", C.ok, C.okTenue, "Punti di forza")}
        {lista("debolezze", C.allarme, C.allarmeTenue, "Punti di debolezza")}
      </div>
      <p className="mt-2 text-xs" style={{ color: C.muto }}>Nessun punto entra nella SWOT della Fase 5 finché la Fase 4 non lo ha confrontato con i numeri (§3.5).</p>
      <Lacune lacune={d.lacune} />
    </>
  );
}

function VistaFase3({ stato, dispatch }) {
  const unita = useMemo(() => unitaDiAnalisi(stato), [stato.fase1, stato.xbrl]);
  const [chiave, setChiave] = useState(null);
  const u = unita.find((x) => x.chiave === chiave) || unita[0];
  const [inCorso, setInCorso] = useState(null);
  const fermato = useRef(false);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const chiaveDi = (s) => (s.livello === "societa" ? CHIAVE_SOCIETA : u.chiave);
  const sezioneSalvata = (s) => stato.fase3?.[chiaveDi(s)]?.sezioni?.[s.id];
  const indice = useMemo(() => {
    const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
    const out = {};
    for (const l of Object.values(stato.estratti)) for (const e of l) out[e.id] = { e, d: metaDoc[e.docId] };
    return out;
  }, [stato.estratti, stato.documenti]);
  const disponibilita = useMemo(() => Object.fromEntries(SEZIONI_FASE3.map((s) => [s.id, selezionaEstratti(stato, "principale", s)])), [stato.estratti, stato.documenti, stato.entita]);

  const genera = useCallback(async (sezioneId) => {
    const sez = sezioneFase3(sezioneId);
    const k = sez.livello === "societa" ? CHIAVE_SOCIETA : u.chiave;
    const etichetta = sez.livello === "societa" ? "società" : u.nome;
    setInCorso(sezioneId);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: etichetta, fase: `Fase 3 · ${sez.titolo}`, blocco: 0, totale: 0 } });
    try {
      const risultato = await generaSezioneFase3({ stato: statoRef.current, unita: u, sezioneId });
      dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase3", chiave: k, sezioneId, risultato, meta: { nome: etichetta } });
      dispatch({ tipo: "LOG", livello: "ok", testo: `${sez.titolo} (${etichetta}) proposta su ${plurale(risultato.estrattiForniti, "estratto", "estratti")}, ${risultato.evidenzeUsate} citati. Da confermare.` });
      await attesa(0);
      return true;
    } catch (err) {
      dispatch({ tipo: "LOG", livello: err.vuoto ? "attenzione" : "errore", testo: `${sez.titolo} (${etichetta}): ${err.message}` });
      return !err.definitivo;
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(null);
    }
  }, [dispatch, u]);

  const generaTutte = async () => {
    fermato.current = false;
    for (const s of SEZIONI_FASE3) {
      if (fermato.current) break;
      if (sezioneSalvata(s)?.stato === "confermato") continue;
      if (s.livello === "societa" && sezioneSalvata(s)) continue;
      /* La sintesi 3F legge le sezioni appena prodotte dallo stato: si lascia
         a React il tempo di applicarle prima di costruire il contesto. */
      if (s.id === "swot") await attesa(300);
      const ok = await genera(s.id);
      if (!ok) break;
    }
  };

  const nomiSezioniUnita = SEZIONI_FASE3.filter((s) => sezioneSalvata(s) && sezioneSalvata(s).stato !== "proposto").length;

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 3 · Analisi interna</span>
          <nav className="flex rounded-md overflow-x-auto border max-w-full" style={{ borderColor: C.riga }}>
            {unita.map((x) => (
              <button key={x.chiave} onClick={() => setChiave(x.chiave)} className="st-btn px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 text-xs"
                style={{ borderColor: C.riga, background: u.chiave === x.chiave ? C.inchiostro : C.carta, color: u.chiave === x.chiave ? "#fff" : C.muto }}>
                {x.nome}{x.peso ? ` · ${fmtNumero(x.peso, 0)}%` : ""}
              </button>
            ))}
          </nav>
          <span className="text-xs" style={{ color: C.muto }}>{nomiSezioniUnita} / {SEZIONI_FASE3.length} sezioni validate</span>
          <div className="ml-auto">
            {inCorso ? (
              <button onClick={() => { fermato.current = true; }} className="st-btn rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: C.allarme, color: C.allarme }}>Ferma dopo questa sezione</button>
            ) : (
              <button onClick={generaTutte} className="st-btn flex items-center gap-2 rounded-md px-3 py-1.5 text-sm" style={{ background: C.annuale, color: "#fff" }}>
                <RefreshCw size={13} /> Genera le sezioni non confermate
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {SEZIONI_FASE3.map((s) => {
            const k = chiaveDi(s);
            const sez = sezioneSalvata(s);
            const st = sez ? STATO_SEZIONE[sez.stato] : null;
            const disp = disponibilita[s.id];
            const Icona = s.icona;
            const mod = (percorso, valore) => dispatch({ tipo: "SEZ_MODIFICA", ramo: "fase3", chiave: k, sezioneId: s.id, percorso, valore });
            return (
              <Scheda key={s.id}>
                <Intestazione icona={<Icona size={14} />} titolo={s.titolo} nota={s.nota} colore={C.volontaria}
                  badge={<span className="flex gap-1.5 items-center">
                    <Pillola>{s.livello === "societa" ? "livello società" : `ASA: ${u.nome}`}</Pillola>
                    {st && <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: st.sfondo, color: st.colore }}>{st.label}</span>}
                  </span>} />
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs" style={{ color: disp.propri ? C.muto : C.allarme }}>
                      Materiale: {plurale(disp.propri, "estratto sul tema", "estratti sul tema")}, {disp.quanti - disp.propri} di supporto
                      {sez ? ` · proposta del ${new Date(sez.generatoIl).toLocaleDateString("it-IT")} (${sez.modello}), ${sez.evidenzeUsate} estratti citati` : ""}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => genera(s.id)} disabled={!!inCorso || !disp.quanti} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs"
                        style={{ borderColor: C.riga, opacity: inCorso || !disp.quanti ? 0.5 : 1 }}>
                        <RefreshCw size={12} className={inCorso === s.id ? "animate-spin" : ""} /> {inCorso === s.id ? "in corso…" : sez ? "Rigenera" : "Genera"}
                      </button>
                      {sez && sez.stato !== "confermato" && (
                        <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase3", chiave: k, sezioneId: s.id, stato: "confermato" })} className="st-btn flex items-center gap-1 rounded px-2.5 py-1 text-xs" style={{ background: C.ok, color: "#fff" }}>
                          <Check size={12} /> Conferma
                        </button>
                      )}
                      {sez && sez.stato === "confermato" && (
                        <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase3", chiave: k, sezioneId: s.id, stato: "proposto" })} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, color: C.muto }}>Riapri</button>
                      )}
                    </span>
                  </div>
                  {!sez && <p className="text-sm" style={{ color: C.muto }}>{disp.quanti ? (s.id === "swot" ? "Conviene generarla per ultima: parte da 3A-3E e dai fattori critici della Fase 2." : "Sezione non ancora generata.") : "Nessun estratto utile: carica in Fase 0 i filing annuali, il proxy statement e le presentazioni."}</p>}
                  {sez && s.id === "corporate" && <CorpoCorporate d={sez.dati} mod={mod} indice={indice} stato={stato} />}
                  {sez && s.id === "competitiva" && <CorpoCompetitiva d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "catena" && <CorpoCatena d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "risorse" && <CorpoRisorse d={sez.dati} mod={mod} indice={indice} stato={stato} chiave={u.chiave} />}
                  {sez && s.id === "governance" && <CorpoGovernance d={sez.dati} mod={mod} indice={indice} />}
                  {sez && s.id === "swot" && <CorpoSwot d={sez.dati} mod={mod} indice={indice} />}
                </div>
              </Scheda>
            );
          })}
        </div>
        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="Quadro interno delle ASA"
              nota="Solo le sezioni confermate o modificate passano alle Fasi 4 e 5." />
            <div className="px-4 pb-4 space-y-2">
              {unita.map((x) => {
                const p = profiloFase3(stato, x.chiave);
                const ris = p.risorse?.risorse || [];
                const scoperti = p.coperturaFcs.filter((c) => c.esito === "scoperto" || c.esito === "debole").length;
                return (
                  <div key={x.chiave} className="rounded-md border p-2.5 text-xs" style={{ borderColor: x.chiave === u.chiave ? C.volontaria : C.rigaTenue }}>
                    <b>{x.nome}</b>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5" style={{ color: C.muto }}>
                      <span>Strategia</span><b style={{ color: C.inchiostro }}>{STRATEGIE_COMPETITIVE[p.competitiva?.strategia?.tipo] || "—"}</b>
                      <span>Vantaggi sostenibili</span><b style={{ color: C.inchiostro }}>{p.risorse ? ris.filter((r) => esitoVrio(r.vrio) === "sostenibile").length : "—"}</b>
                      <span>FCS scoperti o deboli</span><b style={{ color: scoperti ? C.allarme : C.inchiostro }}>{p.risorse ? scoperti : "—"}</b>
                      <span>Forze / debolezze</span><b style={{ color: C.inchiostro }}>{p.swot ? `${(p.swot.forze || []).length} / ${(p.swot.debolezze || []).length}` : "—"}</b>
                    </div>
                  </div>
                );
              })}
            </div>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => { fermato.current = true; }} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [18] FASE 4 — VERIFICA NUMERICA (la «regola d'oro», §3.5)
   --------------------------------------------------------------------------
   «Ogni valutazione strategica deve essere ricondotta ai numeri del bilancio.»
   Questa fase non produce giudizi nuovi: prende ciò che le fasi precedenti
   hanno dichiarato e lo mette alla prova.

     4A Motore KPI              → indicatori dalle serie XBRL, società e peer
     4B Verifica delle voci     → affermazioni (F1), tracce attese (3B), forze e debolezze (3F)
     4C Ciclo di vita           → profilo atteso nella fase (F2) e profilo osservato, per ASA
     4D Posizionamento          → società contro mediana dei peer, mappa dei gruppi strategici

   Divisione dei compiti. L'IA (facoltativa) sceglie soltanto QUALI indicatori
   e QUALE condizione mettono alla prova una voce. Il calcolo e l'esito sono
   del sistema: confermato, parzialmente confermato, smentito, non verificabile.
   Ogni test resta modificabile dall'operatore, e l'esito si può forzare con
   una nota che ne spieghi il motivo.
   ========================================================================== */

/** Catalogo degli indicatori. `dir`: 1 = più alto è meglio (o «più intenso»), -1 = più basso è meglio,
 *  0 = grandezza di scala, né meglio né peggio (il confronto dice solo «più grande» o «più piccolo»). */
const CATALOGO_KPI = [
  { id: "ricavi", label: "Ricavi (milioni)", formato: "m", dir: 0, fn: (s, a) => s("ricavi")[a] },
  { id: "crescita_ricavi", label: "Crescita dei ricavi", formato: "%", dir: 1, fn: (s, a, p) => (p && s("ricavi")[p] ? ((s("ricavi")[a] - s("ricavi")[p]) / Math.abs(s("ricavi")[p])) * 100 : null) },
  { id: "margine_lordo", label: "Margine lordo / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("utileLordo")[a] ?? (s("costoVenduto")[a] !== undefined && s("ricavi")[a] !== undefined ? s("ricavi")[a] - s("costoVenduto")[a] : undefined), s("ricavi")[a]) },
  { id: "margine_operativo", label: "Risultato operativo / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("risultatoOperativo")[a], s("ricavi")[a]) },
  { id: "margine_netto", label: "Utile netto / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("utileNetto")[a], s("ricavi")[a]) },
  { id: "rs_ricavi", label: "Intensità di R&S (R&S / ricavi)", formato: "%", dir: 1, fn: (s, a) => pctDi(s("rs")[a], s("ricavi")[a]) },
  { id: "sga_ricavi", label: "Spese comm. gen. amm.ve / ricavi", formato: "%", dir: -1, fn: (s, a) => pctDi(s("sga")[a], s("ricavi")[a]) },
  { id: "pubblicita_ricavi", label: "Pubblicità / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("pubblicita")[a], s("ricavi")[a]) },
  { id: "capex_ricavi", label: "Investimenti / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("capex")[a], s("ricavi")[a]) },
  { id: "capex_ammortamenti", label: "Investimenti / ammortamenti", formato: "x", dir: 1, fn: (s, a) => rapporto(s("capex")[a], s("ammortamenti")[a]) },
  { id: "cfo_utile", label: "Flusso operativo / utile netto", formato: "x", dir: 1, fn: (s, a) => rapporto(s("cfo")[a], s("utileNetto")[a]) },
  { id: "cfo_ricavi", label: "Flusso operativo / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("cfo")[a], s("ricavi")[a]) },
  { id: "rotazione_attivo", label: "Ricavi / totale attivo", formato: "x", dir: 1, fn: (s, a) => rapporto(s("ricavi")[a], s("totaleAttivo")[a]) },
  { id: "roe", label: "Utile netto / patrimonio netto", formato: "%", dir: 1, fn: (s, a) => pctDi(s("utileNetto")[a], s("patrimonioNetto")[a]) },
  { id: "leva", label: "Debiti finanziari a lungo / patrimonio netto", formato: "x", dir: -1, fn: (s, a) => rapporto(s("debitoLungo")[a], s("patrimonioNetto")[a]) },
  { id: "dso", label: "Giorni medi di incasso", formato: "g", dir: -1, fn: (s, a) => (s("crediti")[a] !== undefined && s("ricavi")[a] ? (s("crediti")[a] / s("ricavi")[a]) * 365 : null) },
  { id: "dio", label: "Giorni medi di magazzino", formato: "g", dir: -1, fn: (s, a) => (s("rimanenze")[a] !== undefined && s("costoVenduto")[a] ? (s("rimanenze")[a] / s("costoVenduto")[a]) * 365 : null) },
  { id: "ricavi_dipendente", label: "Ricavi per dipendente (migliaia)", formato: "n", dir: 1, fn: (s, a) => (s("dipendenti")[a] && s("ricavi")[a] !== undefined ? s("ricavi")[a] / s("dipendenti")[a] / 1000 : null) },
  { id: "dipendenti", label: "Dipendenti", formato: "n", dir: 0, fn: (s, a) => s("dipendenti")[a] },
  { id: "acquisizioni_ricavi", label: "Acquisizioni / ricavi", formato: "%", dir: 1, fn: (s, a) => pctDi(s("acquisizioni")[a], s("ricavi")[a]) },
  { id: "payout", label: "Dividendi e riacquisti / utile netto", formato: "%", dir: 1, fn: (s, a) => (s("dividendi")[a] === undefined && s("riacquisti")[a] === undefined ? null : pctDi((s("dividendi")[a] || 0) + (s("riacquisti")[a] || 0), s("utileNetto")[a])) },
];
const KPI_SEGMENTO = [
  { id: "seg_crescita", label: "Crescita dei ricavi del segmento (ASA)", formato: "%", dir: 1, segmento: true },
  { id: "seg_margine", label: "Risultato del segmento / ricavi del segmento", formato: "%", dir: 1, segmento: true },
];
const TUTTI_I_KPI = [...CATALOGO_KPI, ...KPI_SEGMENTO];
const kpiPerId = (id) => TUTTI_I_KPI.find((k) => k.id === id);
function pctDi(a, b) { return a === undefined || a === null || b === undefined || b === null || !b ? null : (a / b) * 100; }
const fmtKpi = (v, formato) => (v === null || v === undefined || !isFinite(v) ? "—"
  : formato === "%" ? `${fmtNumero(v, 1)}%` : formato === "x" ? `${fmtNumero(v, 2)}x` : formato === "g" ? `${fmtNumero(v, 0)} gg`
  : formato === "m" ? fmtNumero(v / 1e6, 0) : fmtNumero(v, 0));

const CONDIZIONI = {
  migliore_peer: { label: "migliore della mediana dei peer", serve: "peer" },
  peggiore_peer: { label: "peggiore della mediana dei peer", serve: "peer" },
  in_miglioramento: { label: "in miglioramento negli ultimi esercizi", serve: "serie" },
  in_peggioramento: { label: "in peggioramento negli ultimi esercizi", serve: "serie" },
  stabile: { label: "stabile negli ultimi esercizi", serve: "serie" },
  sopra_soglia: { label: "sopra la soglia", serve: "soglia" },
  sotto_soglia: { label: "sotto la soglia", serve: "soglia" },
};

/** Serie di tutti gli indicatori di un'entità: { kpi: { anno: valore } }. */
function serieKpi(dati) {
  if (!dati?.serie) return null;
  const s = (k) => dati.serie[k]?.valori || {};
  const anni = dati.anni;
  const out = {};
  for (const k of CATALOGO_KPI) {
    out[k.id] = {};
    anni.forEach((a, i) => {
      const v = k.fn(s, a, anni[i - 1]);
      if (v !== null && v !== undefined && isFinite(v)) out[k.id][a] = v;
    });
  }
  return { anni, kpi: out };
}

const mediana = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Ultimo valore disponibile, o quello di un anno dato (con ripiego sull'ultimo anno precedente). */
function valoreAl(serie, anno = null) {
  const anni = Object.keys(serie || {}).map(Number).sort((a, b) => a - b);
  if (!anni.length) return null;
  const scelti = anno ? anni.filter((a) => a <= anno) : anni;
  if (!scelti.length) return null;
  const a = scelti[scelti.length - 1];
  return { anno: a, valore: serie[a] };
}

/** Quadro KPI: società, peer e mediana dei peer sull'ultimo anno della società. */
function quadroKpi(stato) {
  const soc = serieKpi(stato.xbrl.principale);
  const peer = stato.entita.filter((e) => e.ruolo === "peer" && stato.xbrl[e.id]).map((e) => ({ e, s: serieKpi(stato.xbrl[e.id]) }));
  if (!soc) return { societa: null, peer, righe: [] };
  const ultimo = soc.anni[soc.anni.length - 1];
  const righe = CATALOGO_KPI.map((k) => {
    const v = valoreAl(soc.kpi[k.id]);
    const vp = peer.map(({ e, s }) => ({ e, v: valoreAl(s.kpi[k.id], v?.anno || ultimo) }));
    const med = mediana(vp.map((x) => x.v?.valore));
    const nPeer = vp.filter((x) => x.v).length;
    const sopra = v && med !== null && k.dir !== 0 ? (v.valore - med) * k.dir > 0 : null;
    return { kpi: k, valore: v, peer: vp, mediana: med, nPeer, migliore: sopra };
  }).filter((r) => r.valore || r.nPeer);
  return { societa: soc, peer, righe, ultimo };
}

/* --- Raccolta delle voci da verificare --------------------------------- */
const hashBreve = (t) => {
  let h = 0;
  for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
};

/**
 * Le voci arrivano solo da sezioni confermate o modificate: un'affermazione
 * rimasta in proposta non è ancora stata accettata come oggetto dell'analisi.
 * L'identificativo dipende dal testo, così una voce mantiene i suoi test anche
 * se l'ordine delle sezioni cambia.
 */
function raccogliVoci(stato) {
  const voci = [];
  const p1 = profiloFase1(stato, "principale");
  for (const a of p1?.affermazioniDaVerificare || []) {
    if (!a?.testo) continue;
    voci.push({ id: `f1-${hashBreve(a.testo)}`, origine: "Fase 1 · affermazione del management", tipo: "affermazione", testo: a.testo, kpiSuggeriti: a.kpi_suggeriti || [], asa: null, evidenze: a.evidenze || [] });
  }
  for (const u of unitaDiAnalisi(stato)) {
    const p3 = profiloFase3(stato, u.chiave);
    const asa = u.gruppo ? null : u.nome;
    for (const k of p3.competitiva?.kpi_attesi || []) {
      const testo = `${k.kpi}: ${k.testo || ""}`.trim();
      voci.push({ id: `3b-${hashBreve(u.chiave + testo)}`, origine: `3B · traccia della strategia${asa ? ` · ${asa}` : ""}`, tipo: "traccia", testo, kpiSuggeriti: [k.kpi], asa, evidenze: k.evidenze || [],
        strategia: STRATEGIE_COMPETITIVE[p3.competitiva?.strategia?.tipo] || null });
    }
    for (const [lista, tipo] of [["forze", "forza"], ["debolezze", "debolezza"]]) {
      for (const x of p3.swot?.[lista] || []) {
        if (!x?.testo) continue;
        voci.push({ id: `3f-${tipo}-${hashBreve(u.chiave + x.testo)}`, origine: `3F · punto di ${tipo}${asa ? ` · ${asa}` : ""}`, tipo, testo: x.testo, kpiSuggeriti: x.kpi_verifica || [], asa, evidenze: x.evidenze || [], fcs: x.fcs_collegato || null });
      }
    }
  }
  return voci;
}

/* --- Mappatura voce → test: parole chiave (sempre disponibile) e IA ------ */
const PAROLE_KPI = [
  [/margine lordo|gross margin|prezz[oi] premium|premium price|differenzia|marchio|brand/i, "margine_lordo"],
  [/margine operativo|operating margin|redditivit|ebit\b/i, "margine_operativo"],
  [/utile netto|net income|margine netto/i, "margine_netto"],
  [/r&s|ricerca|sviluppo|innovaz|brevett|tecnolog/i, "rs_ricavi"],
  [/costi? (general|amministrat|di struttura)|efficienz|sg&a|spese (commerciali|generali)/i, "sga_ricavi"],
  [/pubblicit|marketing|advertising/i, "pubblicita_ricavi"],
  [/crescita|quota di mercato|leader|espansion|ricavi in aumento|volumi/i, "crescita_ricavi"],
  [/investiment|capex|capacit[àa] produttiva|impiant/i, "capex_ricavi"],
  [/cassa|cash|liquidit/i, "cfo_ricavi"],
  [/debito|indebitament|leva|leverage/i, "leva"],
  [/incass|credit[io] (commerc|vers)|dso/i, "dso"],
  [/magazzin|scorte|rimanenz|inventor/i, "dio"],
  [/produttivit|dipendent|personale|capitale umano/i, "ricavi_dipendente"],
  [/acquisizion|m&a|crescita esterna/i, "acquisizioni_ricavi"],
  [/dividend|riacquist|buyback|remunerazione degli azionisti/i, "payout"],
  [/costo del venduto|costi di produzione|leadership di costo|basso costo|fornitore/i, "margine_lordo"],
];

function testDaParoleChiave(voce) {
  const testo = `${voce.testo} ${(voce.kpiSuggeriti || []).join(" ")}`;
  const kpi = Array.from(new Set(PAROLE_KPI.filter(([re]) => re.test(testo)).map(([, k]) => k))).slice(0, 3);
  const negativa = voce.tipo === "debolezza";
  const test = kpi.map((k) => ({ kpi: k, condizione: negativa ? "peggiore_peer" : "migliore_peer", soglia: null, motivo: "associazione per parole chiave" }));
  if (voce.asa && /crescita|segment|quota|volumi/i.test(testo)) test.push({ kpi: "seg_crescita", condizione: negativa ? "in_peggioramento" : "in_miglioramento", soglia: null, motivo: "voce riferita all'ASA" });
  return test;
}

const SYSTEM_FASE4 = `Sei un analista finanziario che deve VERIFICARE affermazioni strategiche sui numeri del
bilancio (la «regola d'oro»: ogni giudizio strategico va ricondotto ai numeri). Non devi giudicare tu: per
ogni voce scegli gli indicatori del catalogo e la condizione che, se rispettata dai dati, la confermerebbe.
Il calcolo lo farà il sistema. Usa SOLO gli identificativi del catalogo e delle condizioni ammesse.
Se nessun indicatore del catalogo può mettere alla prova la voce, lascia "test" vuoto e spiega in
"non_verificabile". Rispondi solo con JSON valido, in italiano.`;

async function mappaVociConIA(stato, voci) {
  const quadro = quadroKpi(stato);
  const disponibili = new Set(quadro.righe.filter((r) => r.valore).map((r) => r.kpi.id));
  const catalogo = TUTTI_I_KPI.map((k) => `- ${k.id}: ${k.label}${k.segmento ? " [solo per voci riferite a un'ASA; confronti con i peer non disponibili]" : ` [${k.dir === 1 ? "più alto = migliore o più intenso" : "più basso = migliore"}${disponibili.has(k.id) ? "" : "; DATI NON DISPONIBILI per la società"}]`}`).join("\n");
  const condizioni = Object.entries(CONDIZIONI).map(([k, v]) => `- ${k}: ${v.label}${v.serve === "soglia" ? " (indica la soglia numerica nell'unità dell'indicatore)" : ""}`).join("\n");
  const elenco = voci.map((v, i) => `V${i + 1} [${v.tipo}${v.asa ? `, ASA ${v.asa}` : ""}${v.strategia ? `, strategia ${v.strategia}` : ""}] ${v.testo}${v.kpiSuggeriti?.length ? ` — indicatori suggeriti: ${v.kpiSuggeriti.join(", ")}` : ""}`).join("\n");
  const testo = await chiamataIA({
    system: SYSTEM_FASE4,
    contenuto: `CATALOGO DEGLI INDICATORI:
${catalogo}

CONDIZIONI AMMESSE:
${condizioni}

Per un punto di DEBOLEZZA la condizione deve descrivere ciò che i numeri mostrerebbero se la debolezza è reale
(es. peggiore_peer). Per un punto di forza, un'affermazione o una traccia di strategia, ciò che mostrerebbero se
è vera. Da uno a tre test per voce; preferisci il confronto con i peer quando ci sono dati.

VOCI DA VERIFICARE:
${elenco}

Rispondi con:
{ "mappature": [ { "voce": "V1", "test": [ { "kpi": "<id>", "condizione": "<id>", "soglia": <numero o null>, "motivo": "<perché questo indicatore>" } ], "non_verificabile": "<motivo, se nessun test>" } ] }`,
    maxTokens: 6000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || !Array.isArray(json.mappature)) throw new Error("risposta del modello non interpretabile");
  const out = {};
  for (const m of json.mappature) {
    const i = Number(String(m.voce || "").replace(/\D/g, "")) - 1;
    const voce = voci[i];
    if (!voce) continue;
    const test = (Array.isArray(m.test) ? m.test : [])
      .filter((t) => kpiPerId(t.kpi) && CONDIZIONI[t.condizione])
      .filter((t) => !kpiPerId(t.kpi).segmento || voce.asa)
      .slice(0, 4)
      .map((t) => ({ kpi: t.kpi, condizione: t.condizione, soglia: typeof t.soglia === "number" && isFinite(t.soglia) ? t.soglia : null, motivo: testoOrNull(t.motivo) }));
    out[voce.id] = { test, nonVerificabile: testoOrNull(m.non_verificabile) };
  }
  return out;
}

/* --- Valutazione deterministica ----------------------------------------- */
function serieSegmento(stato, asa, kpiId) {
  const seg = (profiloFase1(stato, "principale")?.segmenti?.segmenti || []).find((s) => normalizzaNome(s.nome) === normalizzaNome(asa));
  if (!seg) return null;
  const punti = (seg.serie || []).filter((p) => p.anno && typeof p.ricavi === "number").sort((a, b) => a.anno - b.anno);
  const out = {};
  punti.forEach((p, i) => {
    if (kpiId === "seg_margine" && typeof p.risultato === "number" && p.ricavi) out[p.anno] = (p.risultato / p.ricavi) * 100;
    if (kpiId === "seg_crescita" && i > 0 && punti[i - 1].ricavi && (punti[i - 1].unita || "") === (p.unita || "")) out[p.anno] = ((p.ricavi - punti[i - 1].ricavi) / Math.abs(punti[i - 1].ricavi)) * 100;
  });
  return out;
}

function valutaTest(stato, quadro, voce, t) {
  const k = kpiPerId(t.kpi);
  const c = CONDIZIONI[t.condizione];
  if (!k || !c) return { esito: null, dettaglio: "test non valido" };
  const serie = k.segmento ? serieSegmento(stato, voce.asa, k.id) : quadro.societa?.kpi?.[k.id];
  const valori = Object.entries(serie || {}).map(([a, v]) => [Number(a), v]).sort((a, b) => a[0] - b[0]);
  if (!valori.length) return { esito: null, dettaglio: k.segmento ? "nessun dato di segmento per l'ASA (Fase 1C)" : "indicatore non calcolabile: mancano le serie XBRL" };
  const [annoU, vU] = valori[valori.length - 1];
  if (c.serve === "peer") {
    if (k.segmento) return { esito: null, dettaglio: "per i segmenti non ci sono dati dei peer" };
    const riga = quadro.righe.find((r) => r.kpi.id === k.id);
    if (!riga || riga.mediana === null) return { esito: null, dettaglio: `${fmtKpi(vU, k.formato)} nel ${annoU}; nessun peer con dati XBRL per il confronto` };
    const migliore = (vU - riga.mediana) * (k.dir || 1) > 0;
    return { esito: t.condizione === "migliore_peer" ? migliore : !migliore, dettaglio: `${fmtKpi(vU, k.formato)} nel ${annoU} contro una mediana dei peer di ${fmtKpi(riga.mediana, k.formato)} (${plurale(riga.nPeer, "peer", "peer")})` };
  }
  if (c.serve === "serie") {
    const ultimi = valori.slice(-3);
    if (ultimi.length < 2) return { esito: null, dettaglio: `un solo esercizio disponibile (${annoU}: ${fmtKpi(vU, k.formato)})` };
    const [a0, v0] = ultimi[0];
    const delta = (vU - v0) * (k.dir || 1);
    const tolleranza = k.formato === "%" ? 1 : Math.abs(v0) * 0.05;
    const esito = t.condizione === "stabile" ? Math.abs(vU - v0) <= tolleranza : t.condizione === "in_miglioramento" ? delta > tolleranza : delta < -tolleranza;
    return { esito, dettaglio: `da ${fmtKpi(v0, k.formato)} (${a0}) a ${fmtKpi(vU, k.formato)} (${annoU})` };
  }
  if (t.soglia === null || t.soglia === undefined) return { esito: null, dettaglio: "soglia non indicata" };
  return { esito: t.condizione === "sopra_soglia" ? vU > t.soglia : vU < t.soglia, dettaglio: `${fmtKpi(vU, k.formato)} nel ${annoU}, soglia ${fmtKpi(t.soglia, k.formato)}` };
}

const ESITI_VERIFICA = {
  confermato: { label: "Confermato dai numeri", colore: C.ok, sfondo: C.okTenue },
  parziale: { label: "Parzialmente confermato", colore: C.ambra, sfondo: C.ambraTenue },
  smentito: { label: "Smentito dai numeri", colore: C.allarme, sfondo: C.allarmeTenue },
  non_verificabile: { label: "Non verificabile", colore: C.muto, sfondo: C.fondo },
};

function esitoVoce(risultati) {
  const valutati = risultati.filter((r) => r.esito !== null);
  if (!valutati.length) return "non_verificabile";
  const veri = valutati.filter((r) => r.esito).length;
  return veri === valutati.length ? "confermato" : veri > 0 ? "parziale" : "smentito";
}

/** Verifica completa: voci, test, risultati, esito calcolato ed esito finale (con l'eventuale forzatura). */
function verificaCompleta(stato) {
  const quadro = quadroKpi(stato);
  const conf = stato.fase4?.voci || {};
  return raccogliVoci(stato).map((v) => {
    const c = conf[v.id];
    const test = c?.test ?? null;
    const risultati = (test || []).map((t) => ({ ...t, ...valutaTest(stato, quadro, v, t) }));
    const calcolato = test ? esitoVoce(risultati) : null;
    return { ...v, preparata: !!test, fonteTest: c?.fonte || null, nonVerificabile: c?.nonVerificabile || null, risultati, calcolato, esito: c?.esitoManuale || calcolato, forzato: !!c?.esitoManuale, nota: c?.nota || "" };
  });
}

/** Assi predefiniti della mappa: i primi due indicatori con dati per la società e per almeno un peer. */
function assiPredefiniti(quadro) {
  const preferiti = ["margine_netto", "crescita_ricavi", "margine_operativo", "rs_ricavi", "margine_lordo", "rotazione_attivo"];
  const ok = preferiti.filter((id) => quadro.righe.some((r) => r.kpi.id === id && r.valore && r.nPeer > 0));
  return { x: ok[0] || "margine_operativo", y: ok[1] || "crescita_ricavi" };
}

/** Ciò che la Fase 5 leggerà: le voci con il loro esito. */
function profiloFase4(stato) {
  const voci = verificaCompleta(stato);
  const conta = (e) => voci.filter((v) => v.esito === e).length;
  return { voci, riepilogo: { totale: voci.length, confermate: conta("confermato"), parziali: conta("parziale"), smentite: conta("smentito"), nonVerificabili: conta("non_verificabile"), daPreparare: voci.filter((v) => !v.preparata).length } };
}

/* ==========================================================================
   [19] INTERFACCIA DELLA FASE 4
   ========================================================================== */

function PillolaEsito({ esito, forzato }) {
  const e = ESITI_VERIFICA[esito];
  if (!e) return <Pillola>test da preparare</Pillola>;
  return <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: e.sfondo, color: e.colore }}>{e.label}{forzato ? " · forzato" : ""}</span>;
}

const selStile = { borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta };

function VoceVerifica({ v, dispatch, indice }) {
  const [aperta, setAperta] = useState(false);
  const aggiorna = (patch) => dispatch({ tipo: "F4_VOCE", id: v.id, patch });
  const test = v.risultati.map(({ kpi, condizione, soglia, motivo }) => ({ kpi, condizione, soglia, motivo }));
  const cambiaTest = (i, patch) => aggiorna({ test: test.map((t, k) => (k === i ? { ...t, ...patch } : t)), fonte: "manuale" });
  const colTipo = v.tipo === "forza" ? C.ok : v.tipo === "debolezza" ? C.allarme : v.tipo === "traccia" ? C.periodico : C.ambra;
  return (
    <li className="rounded-md border p-3" style={{ borderColor: ESITI_VERIFICA[v.esito]?.colore || C.riga }}>
      <div className="flex flex-wrap items-center gap-2">
        <Pillola colore={colTipo}>{v.tipo}</Pillola>
        <span className="st-eyebrow" style={{ color: C.muto }}>{v.origine}</span>
        <span className="ml-auto"><PillolaEsito esito={v.esito} forzato={v.forzato} /></span>
      </div>
      <p className="text-sm mt-1.5 leading-relaxed">{v.testo} <Evidenze ids={v.evidenze} indice={indice} /></p>
      {v.preparata && v.risultati.length > 0 && (
        <ul className="mt-2 space-y-1">
          {v.risultati.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
              {r.esito === true ? <Check size={13} style={{ color: C.ok }} /> : r.esito === false ? <X size={13} style={{ color: C.allarme }} /> : <Info size={13} style={{ color: C.muto }} />}
              <select value={r.kpi} onChange={(e) => cambiaTest(i, { kpi: e.target.value })} className="rounded border px-1 py-0.5" style={{ ...selStile, maxWidth: 230 }} aria-label="Indicatore">
                {TUTTI_I_KPI.filter((k) => !k.segmento || v.asa).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
              <select value={r.condizione} onChange={(e) => cambiaTest(i, { condizione: e.target.value })} className="rounded border px-1 py-0.5" style={{ ...selStile, maxWidth: 230 }} aria-label="Condizione">
                {Object.entries(CONDIZIONI).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
              </select>
              {CONDIZIONI[r.condizione]?.serve === "soglia" && (
                <input type="number" value={r.soglia ?? ""} onChange={(e) => cambiaTest(i, { soglia: e.target.value === "" ? null : Number(e.target.value) })}
                  className="w-20 rounded border px-1 py-0.5" style={selStile} aria-label="Soglia" />
              )}
              <span style={{ color: C.muto }} className="flex-1 min-w-[160px]">{r.dettaglio}</span>
              <button onClick={() => aggiorna({ test: test.filter((_, k) => k !== i), fonte: "manuale" })} aria-label="Togli test"><X size={12} style={{ color: C.muto }} /></button>
            </li>
          ))}
        </ul>
      )}
      {v.preparata && !v.risultati.length && <p className="mt-1 text-xs" style={{ color: C.muto }}>Nessun test: {v.nonVerificabile || "nessun indicatore del catalogo può mettere alla prova questa voce."}</p>}
      {!v.preparata && <p className="mt-1 text-xs" style={{ color: C.muto }}>Test non ancora preparati. Usa i pulsanti in alto, oppure aggiungi un test a mano.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => aggiorna({ test: [...test, { kpi: v.asa ? "seg_crescita" : "margine_operativo", condizione: v.tipo === "debolezza" ? "peggiore_peer" : "migliore_peer", soglia: null }], fonte: "manuale" })}
          className="st-btn flex items-center gap-1 st-eyebrow underline" style={{ color: C.periodico }}><Plus size={11} /> aggiungi test</button>
        <button onClick={() => setAperta((a) => !a)} className="st-btn st-eyebrow underline" style={{ color: C.muto }}>{aperta ? "chiudi" : "forza l'esito"}</button>
        {v.fonteTest && <span className="st-eyebrow" style={{ color: C.muto }}>test: {v.fonteTest === "ia" ? "proposti dall'IA" : v.fonteTest === "parole_chiave" ? "per parole chiave" : "impostati a mano"}</span>}
      </div>
      {(aperta || v.forzato) && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <select value={v.forzato ? v.esito : ""} onChange={(e) => aggiorna({ esitoManuale: e.target.value || null })} className="rounded border px-1.5 py-1" style={selStile} aria-label="Esito forzato">
            <option value="">esito calcolato{v.calcolato ? ` (${ESITI_VERIFICA[v.calcolato].label.toLowerCase()})` : ""}</option>
            {Object.entries(ESITI_VERIFICA).map(([k, e]) => <option key={k} value={k}>{e.label}</option>)}
          </select>
          <textarea defaultValue={v.nota} key={v.nota} onBlur={(e) => e.target.value !== v.nota && aggiorna({ nota: e.target.value })} rows={2} placeholder="Motivo della forzatura (entra nella relazione)"
            className="flex-1 min-w-[200px] rounded border p-1.5 text-xs" style={{ borderColor: v.forzato && !v.nota ? C.allarme : C.riga }} />
        </div>
      )}
    </li>
  );
}

function TabellaPosizionamento({ quadro }) {
  if (!quadro.societa) return <p className="text-xs" style={{ color: C.muto }}>Mancano le serie XBRL della società: caricale in Fase 0.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: C.fondo }}>
            <th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Indicatore</th>
            <th className="text-right px-2 py-1.5" style={{ color: C.annuale }}>Società</th>
            <th className="text-right px-2 py-1.5" style={{ color: C.muto }}>Mediana peer</th>
            <th className="text-center px-2 py-1.5" style={{ color: C.muto }}>Posizione</th>
            {quadro.peer.map(({ e }) => <th key={e.id} className="text-right px-2 py-1.5" style={{ color: C.muto }}>{nomeEntita(e)}</th>)}
          </tr>
        </thead>
        <tbody>
          {quadro.righe.map((r) => (
            <tr key={r.kpi.id} className="border-t" style={{ borderColor: C.rigaTenue }}>
              <td className="px-2 py-1">{r.kpi.label} <span style={{ color: C.muto }}>{r.kpi.dir === -1 ? "↓" : r.kpi.dir === 1 ? "↑" : "↕"}</span></td>
              <td className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtKpi(r.valore?.valore, r.kpi.formato)}{r.valore ? <span style={{ color: C.muto }}> {r.valore.anno}</span> : ""}</td>
              <td className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtKpi(r.mediana, r.kpi.formato)}</td>
              <td className="text-center px-2 py-1">{r.kpi.dir === 0 && r.valore && r.mediana !== null ? <Pillola>{r.valore.valore > r.mediana ? "più grande" : "più piccola"}</Pillola> : r.migliore === null ? "—" : r.migliore ? <Pillola colore={C.ok} sfondo={C.okTenue}>migliore</Pillola> : <Pillola colore={C.allarme} sfondo={C.allarmeTenue}>peggiore</Pillola>}</td>
              {r.peer.map(({ e, v }) => <td key={e.id} className="text-right px-2 py-1" style={{ fontFamily: F.mono, color: C.muto }}>{fmtKpi(v?.valore, r.kpi.formato)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs" style={{ color: C.muto }}>↑ più alto è meglio (o più intenso) · ↓ più basso è meglio · ↕ grandezza di scala, né meglio né peggio. Ultimo esercizio della società; per i peer lo stesso anno o il più recente precedente.</p>
    </div>
  );
}

/** Mappa dei gruppi strategici: due indicatori a scelta, un punto per società. */
function MappaGruppi({ stato, quadro, x, y, onCambia }) {
  const kx = kpiPerId(x), ky = kpiPerId(y);
  const punti = [{ e: stato.entita.find((e) => e.id === "principale"), s: quadro.societa }, ...quadro.peer]
    .map(({ e, s }) => ({ e, vx: valoreAl(s?.kpi?.[x])?.valore, vy: valoreAl(s?.kpi?.[y])?.valore }))
    .filter((p) => p.vx !== undefined && p.vy !== undefined && p.vx !== null && p.vy !== null);
  const W = 420, H = 260, M = 52;
  const ext = (vs) => { const mn = Math.min(...vs), mx = Math.max(...vs); const pad = (mx - mn || Math.abs(mx) || 1) * 0.15; return [mn - pad, mx + pad]; };
  const [x0, x1] = punti.length ? ext(punti.map((p) => p.vx)) : [0, 1];
  const [y0, y1] = punti.length ? ext(punti.map((p) => p.vy)) : [0, 1];
  const sx = (v) => M + ((v - x0) / (x1 - x0 || 1)) * (W - M - 10);
  const sy = (v) => H - M + 10 - ((v - y0) / (y1 - y0 || 1)) * (H - M - 10);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 text-xs items-center">
        <span className="st-eyebrow" style={{ color: C.muto }}>Asse orizzontale</span>
        <select value={x} onChange={(e) => onCambia({ x: e.target.value, y })} className="rounded border px-1 py-0.5" style={selStile}>{CATALOGO_KPI.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        <span className="st-eyebrow" style={{ color: C.muto }}>Asse verticale</span>
        <select value={y} onChange={(e) => onCambia({ x, y: e.target.value })} className="rounded border px-1 py-0.5" style={selStile}>{CATALOGO_KPI.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
      </div>
      {punti.length < 2 ? <p className="text-xs" style={{ color: C.muto }}>Servono almeno due società con dati XBRL per entrambi gli indicatori.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 560 }} role="img" aria-label={`Mappa dei gruppi strategici: ${kx?.label} e ${ky?.label}`}>
          <line x1={M} y1={H - M + 10} x2={W - 10} y2={H - M + 10} stroke={C.riga} />
          <line x1={M} y1={10} x2={M} y2={H - M + 10} stroke={C.riga} />
          <text x={(M + W) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill={C.muto}>{kx?.label}</text>
          <text x={M} y={H - M + 22} fontSize="9" fill={C.muto} textAnchor="start">{fmtKpi(x0, kx?.formato)}</text>
          <text x={W - 10} y={H - M + 22} fontSize="9" fill={C.muto} textAnchor="end" dy="-0">{fmtKpi(x1, kx?.formato)}</text>
          <text x={M - 4} y={H - M + 10} fontSize="9" fill={C.muto} textAnchor="end">{fmtKpi(y0, ky?.formato)}</text>
          <text x={M - 4} y={16} fontSize="9" fill={C.muto} textAnchor="end">{fmtKpi(y1, ky?.formato)}</text>
          <text x={10} y={(H - M) / 2 + 10} fontSize="10" fill={C.muto} transform={`rotate(-90 10 ${(H - M) / 2 + 10})`} textAnchor="middle">{ky?.label}</text>
          {punti.map((p) => {
            const principale = p.e.ruolo === "principale";
            return (
              <g key={p.e.id}>
                <circle cx={sx(p.vx)} cy={sy(p.vy)} r={principale ? 7 : 5} fill={principale ? C.annuale : C.periodico} opacity={0.85} />
                <text x={sx(p.vx) > W * 0.6 ? sx(p.vx) - 9 : sx(p.vx) + 9} y={sy(p.vy) + 4} fontSize="10" fill={C.inchiostro} textAnchor={sx(p.vx) > W * 0.6 ? "end" : "start"}>{nomeEntita(p.e)}</text>
                <title>{`${nomeEntita(p.e)}: ${fmtKpi(p.vx, kx.formato)} · ${fmtKpi(p.vy, ky.formato)}`}</title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function VistaFase4({ stato, dispatch }) {
  const [inCorso, setInCorso] = useState(false);
  const [filtro, setFiltro] = useState("tutte");
  const quadro = useMemo(() => quadroKpi(stato), [stato.xbrl, stato.entita]);
  const verifiche = useMemo(() => verificaCompleta(stato), [stato]);
  const indice = useMemo(() => {
    const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
    const out = {};
    for (const l of Object.values(stato.estratti)) for (const e of l) out[e.id] = { e, d: metaDoc[e.docId] };
    return out;
  }, [stato.estratti, stato.documenti]);
  const unita = useMemo(() => unitaDiAnalisi(stato), [stato.fase1, stato.xbrl]);
  const scatter = stato.fase4?.scatter || assiPredefiniti(quadro);
  const conta = (e) => verifiche.filter((v) => v.esito === e).length;
  const daPreparare = verifiche.filter((v) => !v.preparata);

  const preparaParole = (tutte = false) => {
    const bersaglio = tutte ? verifiche : daPreparare;
    dispatch({ tipo: "F4_TEST", voci: Object.fromEntries(bersaglio.map((v) => [v.id, { test: testDaParoleChiave(v), fonte: "parole_chiave", nonVerificabile: null }])) });
    dispatch({ tipo: "LOG", livello: "ok", testo: `Fase 4: test preparati per parole chiave su ${plurale(bersaglio.length, "voce", "voci")}.` });
  };
  const preparaIA = async () => {
    if (!daPreparare.length) return;
    setInCorso(true);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: `${plurale(daPreparare.length, "voce", "voci")}`, fase: "Fase 4 · scelta dei test", blocco: 0, totale: 0 } });
    try {
      const mappe = await mappaVociConIA(stato, daPreparare);
      const voci = {};
      for (const v of daPreparare) voci[v.id] = mappe[v.id] ? { ...mappe[v.id], fonte: "ia" } : { test: testDaParoleChiave(v), fonte: "parole_chiave", nonVerificabile: null };
      dispatch({ tipo: "F4_TEST", voci });
      const ripiego = daPreparare.filter((v) => !mappe[v.id]).length;
      dispatch({ tipo: "LOG", livello: "ok", testo: `Fase 4: test proposti dall'IA per ${daPreparare.length - ripiego} voci${ripiego ? `, ${ripiego} preparate per parole chiave` : ""}. Il calcolo degli esiti è del sistema.` });
    } catch (err) {
      dispatch({ tipo: "LOG", livello: "attenzione", testo: `Fase 4: scelta dei test con l'IA non riuscita (${err.message}); uso le parole chiave.` });
      preparaParole(false);
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(false);
    }
  };

  const visibili = verifiche.filter((v) => filtro === "tutte" || (filtro === "da_preparare" ? !v.preparata : v.esito === filtro));

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 4 · Verifica numerica</span>
          <span className="text-xs" style={{ color: C.muto }}>{plurale(verifiche.length, "voce", "voci")} da verificare · {daPreparare.length} senza test</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => preparaParole(false)} disabled={!daPreparare.length || inCorso} className="st-btn rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: C.riga, opacity: daPreparare.length ? 1 : 0.5 }}>Prepara per parole chiave</button>
            <button onClick={preparaIA} disabled={!daPreparare.length || inCorso} className="st-btn flex items-center gap-2 rounded-md px-3 py-1.5 text-sm" style={{ background: C.annuale, color: "#fff", opacity: daPreparare.length ? 1 : 0.5 }}>
              <RefreshCw size={13} className={inCorso ? "animate-spin" : ""} /> {inCorso ? "in corso…" : "Prepara i test con l'IA"}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<BarChart3 size={14} />} titolo="4A · Motore KPI" colore={C.annuale}
              nota="Gli indicatori calcolati dalle serie XBRL della società e dei peer: sono il metro di tutte le verifiche. Nessuna IA in questo calcolo." />
            <div className="px-4 pb-4"><TabellaPosizionamento quadro={quadro} /></div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<Scale size={14} />} titolo="4B · Verifica delle affermazioni" colore={C.annuale}
              nota="Ogni affermazione del management (Fase 1), traccia attesa della strategia (3B) e punto di forza o debolezza (3F) confermato viene messo alla prova. L'IA sceglie solo indicatori e condizioni; il risultato lo calcola il sistema."
              badge={<span className="st-eyebrow" style={{ color: C.muto }}>{conta("confermato")} conf. · {conta("parziale")} parz. · {conta("smentito")} smentite · {conta("non_verificabile")} n.v.</span>} />
            <div className="px-4 pb-4">
              {verifiche.length === 0 ? (
                <p className="text-sm" style={{ color: C.muto }}>Nessuna voce da verificare. Le voci arrivano dalle sezioni <b>confermate</b>: affermazioni della 1B, tracce attese della 3B, forze e debolezze della 3F.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {[["tutte", "Tutte"], ["da_preparare", "Senza test"], ...Object.entries(ESITI_VERIFICA).map(([k, e]) => [k, e.label])].map(([k, l]) => (
                      <button key={k} onClick={() => setFiltro(k)} className="st-btn rounded-full border px-2.5 py-0.5 text-xs"
                        style={{ borderColor: filtro === k ? C.inchiostro : C.riga, background: filtro === k ? C.inchiostro : C.carta, color: filtro === k ? "#fff" : C.muto }}>{l}</button>
                    ))}
                  </div>
                  <ul className="space-y-2">{visibili.map((v) => <VoceVerifica key={v.id} v={v} dispatch={dispatch} indice={indice} />)}</ul>
                </>
              )}
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<Activity size={14} />} titolo="4C · Ciclo di vita: profilo atteso e osservato" colore={C.annuale}
              nota="Per ogni ASA, la fase del ciclo indicata in Fase 2 confrontata con il profilo di bilancio della società negli ultimi tre esercizi." />
            <div className="px-4 pb-4 space-y-2">
              {unita.map((u) => {
                const sez = stato.fase2?.[u.chiave]?.sezioni?.ciclo;
                const fase = sez?.dati?.fase_settore?.fase;
                const coer = coerenzaCicloVita(stato, fase);
                return (
                  <div key={u.chiave} className="rounded-md border p-2.5 text-xs" style={{ borderColor: C.rigaTenue }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{u.nome}</b>
                      <Pillola>{FASI_CICLO.find(([k]) => k === fase)?.[1] || "fase non determinata"}</Pillola>
                      {sez && sez.stato === "proposto" && <Pillola colore={C.ambra}>fase 2 non confermata</Pillola>}
                    </div>
                    {coer?.controlli?.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {coer.controlli.map((c) => (
                          <li key={c.id} className="flex items-center gap-1.5">
                            {c.esito === true ? <Check size={12} style={{ color: C.ok }} /> : c.esito === false ? <X size={12} style={{ color: C.allarme }} /> : <Info size={12} style={{ color: C.muto }} />}
                            {c.label} <span style={{ color: C.muto }}>({c.soglia})</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1" style={{ color: C.muto }}>{fase ? "Mancano le serie XBRL." : "Determina la fase in Fase 2 (sezione 2B)."}</p>}
                  </div>
                );
              })}
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<Compass size={14} />} titolo="4D · Mappa dei gruppi strategici" colore={C.annuale}
              nota="Posizione della società e dei peer su due indicatori a scelta (ultimo esercizio disponibile). Le società vicine formano un gruppo strategico: competono con modelli simili." />
            <div className="px-4 pb-4">
              <MappaGruppi stato={stato} quadro={quadro} x={scatter.x} y={scatter.y} onCambia={(s) => dispatch({ tipo: "F4_SCATTER", scatter: s })} />
            </div>
          </Scheda>
        </div>

        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="Esito della verifica" nota="Alla Fase 5 passano le voci con il loro esito: nella SWOT entreranno come verificate, parziali o smentite." />
            <ul className="px-4 pb-4 space-y-1.5">
              {Object.entries(ESITI_VERIFICA).map(([k, e]) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: e.colore }} />
                  <span className="flex-1">{e.label}</span><b style={{ fontFamily: F.mono }}>{conta(k)}</b>
                </li>
              ))}
              <li className="flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.riga }} /><span className="flex-1">Senza test</span><b style={{ fontFamily: F.mono }}>{daPreparare.length}</b></li>
              <li className="pt-1 text-xs" style={{ color: C.muto }}>Peer con dati XBRL: {quadro.peer.length}{quadro.peer.length === 0 ? " — senza peer i confronti «migliore/peggiore della mediana» restano non verificabili." : ""}</li>
            </ul>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => {}} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [20] FASE 5 — COERENZA E CREDIBILITÀ
   --------------------------------------------------------------------------
   «Le due facce della medaglia si uniscono» (§3.14): l'esterno incontra
   l'interno, e le promesse incontrano i numeri.

     5A SWOT e TOWS          → per ASA; nella SWOT entrano SOLO le voci che la Fase 4
                               ha confermato (in tutto o in parte), le opportunità e
                               minacce confermate in Fase 2; l'IA propone le opzioni TOWS
     5B Coerenza strategia-ambiente → regole esplicite e deterministiche
     5C Promesse e realtà    → guidance passate contro consuntivo XBRL
     5D Narrativa e numeri   → affermazioni smentite, segnali documentali, rischi ripetuti
     5E Consensus e guidance → dove il mercato è più ottimista o più prudente
   Il punteggio di credibilità del management è calcolato dal sistema e ne
   mostra le componenti: non è un voto dell'IA.
   ========================================================================== */

const QUADRANTI_TOWS = [
  ["so", "SO · usare le forze per cogliere le opportunità", C.ok],
  ["st", "ST · usare le forze per difendersi dalle minacce", C.periodico],
  ["wo", "WO · superare le debolezze sfruttando le opportunità", C.ambra],
  ["wt", "WT · ridurre le debolezze ed evitare le minacce", C.allarme],
];

/** SWOT di un'unità: dalle verifiche della Fase 4 e dall'analisi esterna confermata della Fase 2. */
function costruisciSwot(stato, unita, includiNonVerificate = false) {
  const asa = unita.gruppo ? null : unita.nome;
  const voci = verificaCompleta(stato).filter((v) => (v.tipo === "forza" || v.tipo === "debolezza") && (v.asa || null) === asa);
  const ammesse = (v) => v.esito === "confermato" || v.esito === "parziale" || (includiNonVerificate && v.esito === "non_verificabile");
  const s = voci.filter((v) => v.tipo === "forza" && ammesse(v));
  const w = voci.filter((v) => v.tipo === "debolezza" && ammesse(v));
  const escluse = voci.filter((v) => !ammesse(v));
  const p2 = profiloFase2(stato, unita.chiave);
  const peso = (x) => (x.probabilita || 0) * (x.impatto || 0);
  const o = [...(p2?.om?.opportunita || [])].sort((a, b) => peso(b) - peso(a));
  const t = [...(p2?.om?.minacce || [])].sort((a, b) => peso(b) - peso(a));
  const codici = {};
  s.forEach((x, i) => { codici[`S${i + 1}`] = x; });
  w.forEach((x, i) => { codici[`W${i + 1}`] = x; });
  o.forEach((x, i) => { codici[`O${i + 1}`] = x; });
  t.forEach((x, i) => { codici[`T${i + 1}`] = x; });
  return { s, w, o, t, escluse, codici, completa: s.length + w.length > 0 && o.length + t.length > 0 };
}

const SYSTEM_TOWS = `Sei un analista strategico. Dalla matrice SWOT fornita derivi le opzioni strategiche della
matrice TOWS (SO, ST, WO, WT). Usa SOLO gli elementi elencati, citandoli con i loro codici (S1, W2, O1, T3…):
ogni opzione deve combinare almeno un elemento interno (S o W) e uno esterno (O o T) del quadrante giusto.
Le forze e le debolezze sono già state verificate sui numeri: rispetta l'esito indicato. Non inventare fatti.
Scrivi in italiano, in modo concreto (che cosa fare, non slogan). Rispondi solo con JSON valido.`;

async function generaTows(stato, unita, swot) {
  const ent = stato.entita.find((e) => e.id === "principale");
  const p3 = profiloFase3(stato, unita.chiave);
  const p2 = profiloFase2(stato, unita.chiave);
  const riga = (cod, x, extra = "") => `${cod}: ${x.testo}${extra}`;
  const elenco = [
    "PUNTI DI FORZA", ...swot.s.map((x, i) => riga(`S${i + 1}`, x, ` [${ESITI_VERIFICA[x.esito]?.label.toLowerCase()}]`)),
    "PUNTI DI DEBOLEZZA", ...swot.w.map((x, i) => riga(`W${i + 1}`, x, ` [${ESITI_VERIFICA[x.esito]?.label.toLowerCase()}]`)),
    "OPPORTUNITÀ", ...swot.o.map((x, i) => riga(`O${i + 1}`, x, ` [prob. ${x.probabilita ?? "n.d."}, impatto ${x.impatto ?? "n.d."}]`)),
    "MINACCE", ...swot.t.map((x, i) => riga(`T${i + 1}`, x, ` [prob. ${x.probabilita ?? "n.d."}, impatto ${x.impatto ?? "n.d."}]`)),
  ].join("\n");
  const testo = await chiamataIA({
    system: SYSTEM_TOWS,
    contenuto: `SOCIETÀ: ${nomeEntita(ent)} — ${unita.gruppo ? "gruppo nel suo insieme" : `ASA «${unita.nome}»`}
Strategia competitiva dichiarata: ${STRATEGIE_COMPETITIVE[p3.competitiva?.strategia?.tipo] || "n.d."}. Attrattività strutturale: ${p2?.attrattivita ? `${p2.attrattivita.indice}/100` : "n.d."}. Ciclo di vita: ${p2?.ciclo?.fase_settore?.fase || "n.d."}.

${elenco}

Restituisci:
{
  "so": [ { "testo": "<opzione strategica>", "usa": ["S#", "O#"], "priorita": "alta" | "media" | "bassa" } ],
  "st": [ { "testo": "...", "usa": ["S#", "T#"], "priorita": "..." } ],
  "wo": [ { "testo": "...", "usa": ["W#", "O#"], "priorita": "..." } ],
  "wt": [ { "testo": "...", "usa": ["W#", "T#"], "priorita": "..." } ],
  "sintesi": "<2-3 frasi: quale direzione strategica emerge>"
}`,
    maxTokens: 4000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object") throw new Error("risposta del modello non interpretabile");
  const ammessi = { so: [/^S\d+$/, /^O\d+$/], st: [/^S\d+$/, /^T\d+$/], wo: [/^W\d+$/, /^O\d+$/], wt: [/^W\d+$/, /^T\d+$/] };
  const dati = { sintesi: testoOrNull(json.sintesi) };
  let scartate = 0;
  for (const [q] of QUADRANTI_TOWS) {
    dati[q] = (Array.isArray(json[q]) ? json[q] : []).map((o) => {
      const usa = (Array.isArray(o.usa) ? o.usa : []).map((c) => String(c).toUpperCase().trim()).filter((c) => swot.codici[c] && ammessi[q].some((re) => re.test(c)));
      const interno = usa.some((c) => ammessi[q][0].test(c)), esterno = usa.some((c) => ammessi[q][1].test(c));
      if (!o?.testo || !interno || !esterno) { scartate++; return null; }
      return { testo: String(o.testo).trim(), usa, priorita: ["alta", "media", "bassa"].includes(o.priorita) ? o.priorita : "media",
        riferimenti: usa.map((c) => ({ codice: c, testo: swot.codici[c].testo })) };
    }).filter(Boolean);
  }
  return { dati, scartate, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}`, estrattiForniti: Object.keys(swot.codici).length, evidenzeUsate: 0 };
}

/* --- 5B Regole di coerenza fra strategia e ambiente --------------------- */
function valutaCoerenza(stato, unita) {
  const p2 = profiloFase2(stato, unita.chiave);
  const p3 = profiloFase3(stato, unita.chiave);
  const quadro = quadroKpi(stato);
  const pos = (id) => quadro.righe.find((r) => r.kpi.id === id)?.migliore ?? null;
  const val = (id) => quadro.righe.find((r) => r.kpi.id === id)?.valore?.valore ?? null;
  const strategia = p3.competitiva?.strategia?.tipo || null;
  const fase = p2?.ciclo?.fase_settore?.fase || null;
  const att = p2?.attrattivita?.indice ?? null;
  const differenzia = strategia === "differenziazione" || strategia === "focus_differenziazione";
  const costo = strategia === "leadership_costo" || strategia === "focus_costo";
  const r = (id, titolo, condizioneNota, valuta) => {
    const esito = valuta();
    return { id, titolo, condizione: condizioneNota, ...esito };
  };
  return [
    r("stuck", "Strategia competitiva definita", "§ Porter: chi non sceglie fra costo e differenziazione resta «stuck in the middle»", () =>
      !strategia ? { esito: "non_valutabile", spiegazione: "Strategia competitiva non confermata in Fase 3 (3B)." }
        : strategia === "non_definita" ? { esito: "incoerente", spiegazione: "La strategia non risulta definita: rischio di posizione intermedia senza vantaggio né di costo né di differenziazione." }
        : { esito: "coerente", spiegazione: `Strategia dichiarata: ${STRATEGIE_COMPETITIVE[strategia]}.` }),
    r("diff_margine", "Differenziazione e premio di prezzo", "Chi si differenzia deve mostrare un margine lordo superiore ai concorrenti (§3.14, esempio 1)", () =>
      !differenzia ? { esito: "non_valutabile", spiegazione: "Regola applicabile solo a strategie di differenziazione." }
        : pos("margine_lordo") === null ? { esito: "non_valutabile", spiegazione: "Margine lordo non confrontabile con i peer (mancano dati XBRL)." }
        : pos("margine_lordo") ? { esito: "coerente", spiegazione: `Margine lordo ${fmtKpi(val("margine_lordo"), "%")}, superiore alla mediana dei peer: il premio di prezzo trova riscontro.` }
        : { esito: "incoerente", spiegazione: `Margine lordo ${fmtKpi(val("margine_lordo"), "%")}, inferiore alla mediana dei peer: la differenziazione dichiarata non si traduce in prezzo.` }),
    r("diff_investimento", "Differenziazione sostenuta da R&S o marketing", "La differenziazione si alimenta con innovazione o marca", () =>
      !differenzia ? { esito: "non_valutabile", spiegazione: "Regola applicabile solo a strategie di differenziazione." }
        : pos("rs_ricavi") === null && pos("pubblicita_ricavi") === null ? { esito: "non_valutabile", spiegazione: "Intensità di R&S e di pubblicità non confrontabili con i peer." }
        : pos("rs_ricavi") || pos("pubblicita_ricavi") ? { esito: "coerente", spiegazione: "Almeno uno fra R&S/ricavi e pubblicità/ricavi è superiore alla mediana dei peer." }
        : { esito: "attenzione", spiegazione: "Né la R&S né la pubblicità sono sopra la mediana dei peer: verificare su che cosa poggi la differenziazione." }),
    r("costo_efficienza", "Leadership di costo ed efficienza", "Chi compete sul costo deve avere costi di struttura e margini coerenti (§3.14, esempio 2)", () =>
      !costo ? { esito: "non_valutabile", spiegazione: "Regola applicabile solo a strategie di costo." }
        : pos("sga_ricavi") === null && pos("margine_operativo") === null ? { esito: "non_valutabile", spiegazione: "Indicatori di efficienza non confrontabili con i peer." }
        : pos("sga_ricavi") || pos("margine_operativo") ? { esito: "coerente", spiegazione: "Costi di struttura o margine operativo migliori della mediana dei peer." }
        : { esito: "incoerente", spiegazione: "Costi di struttura e margine operativo peggiori dei peer: il vantaggio di costo dichiarato non appare nei numeri." }),
    r("maturita_costo", "Mercato maturo e strategia", "In un mercato maturo con prodotti simili si compete sul prezzo: serve un vantaggio di costo (§3.14)", () =>
      !fase || !strategia ? { esito: "non_valutabile", spiegazione: "Servono la fase del ciclo (Fase 2) e la strategia (3B) confermate." }
        : (fase === "maturita" || fase === "declino") && !costo && (att !== null && att < 50) ? { esito: "attenzione", spiegazione: `Settore in ${fase === "maturita" ? "maturità" : "declino"} con attrattività ${att}/100 e strategia non di costo: la differenziazione deve essere molto solida per reggere la pressione sui prezzi.` }
        : { esito: "coerente", spiegazione: `Fase ${fase}, strategia ${STRATEGIE_COMPETITIVE[strategia]}: nessuna tensione evidente.` }),
    r("sviluppo_investimenti", "Fase di sviluppo e investimenti", "In sviluppo la domanda cresce: servono investimenti superiori agli ammortamenti (§3.10)", () =>
      fase !== "sviluppo" ? { esito: "non_valutabile", spiegazione: "Regola applicabile alla fase di sviluppo." }
        : val("capex_ammortamenti") === null ? { esito: "non_valutabile", spiegazione: "Rapporto investimenti/ammortamenti non calcolabile." }
        : val("capex_ammortamenti") > 1.1 ? { esito: "coerente", spiegazione: `Investimenti pari a ${fmtKpi(val("capex_ammortamenti"), "x")} gli ammortamenti.` }
        : { esito: "attenzione", spiegazione: `Investimenti pari solo a ${fmtKpi(val("capex_ammortamenti"), "x")} gli ammortamenti in un mercato in sviluppo: rischio di perdere quota.` }),
    r("fcs", "Risorse e fattori critici di successo", "Ogni FCS dell'ASA dovrebbe essere presidiato da una risorsa con vantaggio", () => {
      const c = p3.coperturaFcs || [];
      if (!c.length || !p3.risorse) return { esito: "non_valutabile", spiegazione: "Servono i FCS (2D) e le risorse confermate (3D)." };
      const scoperti = c.filter((x) => x.esito === "scoperto" || x.esito === "debole");
      return scoperti.length ? { esito: "incoerente", spiegazione: `FCS non presidiati: ${scoperti.map((x) => x.nome).join(", ")}.` } : { esito: "coerente", spiegazione: "Tutti i FCS hanno almeno una risorsa con vantaggio." };
    }),
    r("incentivi", "Incentivi e strategia", "Le metriche degli incentivi dovrebbero spingere nella direzione della strategia", () => {
      const inc = p3.governance?.incentivi;
      if (!inc?.allineamento) return { esito: "non_valutabile", spiegazione: "Allineamento degli incentivi non valutato in 3E." };
      return inc.allineamento === "allineati" ? { esito: "coerente", spiegazione: "Incentivi allineati alla strategia." }
        : inc.allineamento === "disallineati" ? { esito: "incoerente", spiegazione: `Incentivi disallineati (metriche: ${(inc.metriche || []).join(", ") || "n.d."}).` }
        : { esito: "attenzione", spiegazione: `Allineamento parziale (metriche: ${(inc.metriche || []).join(", ") || "n.d."}).` };
    }),
  ];
}
const ESITI_COERENZA = { coerente: ["Coerente", C.ok, C.okTenue], attenzione: ["Attenzione", C.ambra, C.ambraTenue], incoerente: ["Incoerente", C.allarme, C.allarmeTenue], non_valutabile: ["Non valutabile", C.muto, C.fondo] };

/* --- 5C/5E Promesse e realtà, consensus e guidance ---------------------- */
const METRICHE_PROMESSE = {
  ricavi: { label: "Ricavi (milioni)", dir: 1, formato: "n", consuntivo: (s, a) => s("ricavi")[a] !== undefined ? s("ricavi")[a] / 1e6 : null },
  utile_netto: { label: "Utile netto (milioni)", dir: 1, formato: "n", consuntivo: (s, a) => s("utileNetto")[a] !== undefined ? s("utileNetto")[a] / 1e6 : null },
  risultato_operativo: { label: "Risultato operativo (milioni)", dir: 1, formato: "n", consuntivo: (s, a) => s("risultatoOperativo")[a] !== undefined ? s("risultatoOperativo")[a] / 1e6 : null },
  flusso_operativo: { label: "Flusso di cassa operativo (milioni)", dir: 1, formato: "n", consuntivo: (s, a) => s("cfo")[a] !== undefined ? s("cfo")[a] / 1e6 : null },
  investimenti: { label: "Investimenti (milioni)", dir: 0, formato: "n", consuntivo: (s, a) => s("capex")[a] !== undefined ? s("capex")[a] / 1e6 : null },
  crescita_ricavi: { label: "Crescita dei ricavi (%)", dir: 1, formato: "%", kpi: "crescita_ricavi" },
  margine_lordo: { label: "Margine lordo (%)", dir: 1, formato: "%", kpi: "margine_lordo" },
  margine_operativo: { label: "Margine operativo (%)", dir: 1, formato: "%", kpi: "margine_operativo" },
  margine_netto: { label: "Margine netto (%)", dir: 1, formato: "%", kpi: "margine_netto" },
};
const TOLLERANZA_PROMESSE = 0.03;

const SEZIONE_PROMESSE = {
  id: "promesse", titolo: "5C · Promesse e realtà", temi: ["guidance"], supporto: ["eventi", "strategia", "politica_finanziaria"],
  contesto: false, peer: false, metriche: ["stima_ricavi", "stima_margine", "stima_utile", "crescita_attesa"],
};

const SYSTEM_PROMESSE = SYSTEM_FASE1.replace(
  "Sei un analista strategico che redige il profilo di una società per un'analisi\nfondamentale.",
  "Sei un analista che ricostruisce le PREVISIONI e la GUIDANCE dichiarate dal management nel tempo e le\nstime di consensus, per confrontarle con i risultati effettivi.");

async function generaPromesse(stato) {
  const sel = selezionaEstratti(stato, "principale", SEZIONE_PROMESSE);
  if (!sel.quanti) {
    const err = new Error("nessun estratto di guidance o di previsione: carica in Fase 0 comunicati sui risultati (8-K 2.02), presentazioni, trascrizioni delle call e i 10-K degli anni passati.");
    err.vuoto = true;
    throw err;
  }
  const ultimo = stato.xbrl.principale?.anni?.slice(-1)[0];
  const metriche = Object.entries(METRICHE_PROMESSE).map(([k, m]) => `- ${k}: ${m.label}`).join("\n");
  const testo = await chiamataIA({
    system: SYSTEM_PROMESSE,
    contenuto: `SOCIETÀ: ${nomeEntita(stato.entita.find((e) => e.id === "principale"))}. Ultimo esercizio con dati consuntivi: ${ultimo || "n.d."}.
METRICHE CONFRONTABILI (usa solo questi identificativi; gli importi vanno espressi in MILIONI nella valuta di bilancio, le percentuali come numero, es. 12.5):
${metriche}

ESTRATTI (${sel.quanti}):
${sel.testo}

Restituisci:
{
  "previsioni": [ { "testo": "<la previsione come formulata>", "metrica": "<id>", "tipo_valore": "puntuale" | "minimo" | "massimo" | "intervallo",
                    "valore": <numero>, "valore_max": <numero o null, solo per intervallo>, "anno": <esercizio a cui si riferisce>,
                    "dichiarata_nel": "<data o esercizio in cui è stata fatta, se noto>", "evidenze": ["E#"] } ],
  "previsioni_qualitative": [ { "testo": "<obiettivo non quantificato>", "anno": <intero o null>, "evidenze": ["E#"] } ],
  "consensus": [ { "metrica": "<id>", "anno": <intero>, "valore_consensus": <numero>, "valore_guidance": <numero o null>, "fonte": "<fonte del consensus>", "evidenze": ["E#"] } ],
  "lacune": ["..."]
}
Una stessa previsione ripetuta in più documenti va riportata una volta sola, con tutte le evidenze; se è stata
modificata nel tempo, riporta l'ultima versione e indica la modifica nel testo.`,
    maxTokens: 6000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object") throw new Error("risposta del modello non interpretabile");
  const usati = new Set();
  const dati = validaEvidenze(json, sel.mappa, usati);
  const numero = (x) => (typeof x === "number" && isFinite(x) ? x : typeof x === "string" && x.trim() && isFinite(Number(x.replace(",", "."))) ? Number(x.replace(",", ".")) : null);
  dati.previsioni = (dati.previsioni || []).filter((p) => METRICHE_PROMESSE[p.metrica] && numero(p.valore) !== null && Number(p.anno))
    .map((p) => ({ ...p, valore: numero(p.valore), valore_max: numero(p.valore_max), anno: Number(p.anno), tipo_valore: ["puntuale", "minimo", "massimo", "intervallo"].includes(p.tipo_valore) ? p.tipo_valore : "puntuale" }));
  dati.consensus = (dati.consensus || []).filter((c) => METRICHE_PROMESSE[c.metrica] && numero(c.valore_consensus) !== null && Number(c.anno))
    .map((c) => ({ ...c, valore_consensus: numero(c.valore_consensus), valore_guidance: numero(c.valore_guidance), anno: Number(c.anno) }));
  return { dati, estrattiForniti: sel.quanti, evidenzeUsate: usati.size, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}` };
}

function consuntivo(stato, metrica, anno) {
  const m = METRICHE_PROMESSE[metrica];
  const dati = stato.xbrl.principale;
  if (!m || !dati) return null;
  if (m.kpi) { const v = serieKpi(dati)?.kpi?.[m.kpi]?.[anno]; return v === undefined ? null : v; }
  const s = (k) => dati.serie[k]?.valori || {};
  const v = m.consuntivo(s, anno);
  return v === null || v === undefined || !isFinite(v) ? null : v;
}

function valutaPromessa(stato, p) {
  const m = METRICHE_PROMESSE[p.metrica];
  const ultimo = stato.xbrl.principale?.anni?.slice(-1)[0];
  if (!ultimo) return { esito: "non_verificabile", dettaglio: "mancano le serie XBRL" };
  if (p.anno > ultimo) return { esito: "in_corso", dettaglio: `esercizio ${p.anno} non ancora chiuso nei dati` };
  const eff = consuntivo(stato, p.metrica, p.anno);
  if (eff === null) return { esito: "non_verificabile", dettaglio: `consuntivo ${p.anno} non disponibile` };
  const tol = (v) => (m.formato === "%" ? 0.5 : Math.abs(v) * TOLLERANZA_PROMESSE);
  const dir = m.dir || 1;
  let ok;
  if (p.tipo_valore === "minimo") ok = eff >= p.valore - tol(p.valore);
  else if (p.tipo_valore === "massimo") ok = eff <= p.valore + tol(p.valore);
  else if (p.tipo_valore === "intervallo" && p.valore_max !== null) ok = eff >= Math.min(p.valore, p.valore_max) - tol(p.valore) && eff <= Math.max(p.valore, p.valore_max) + tol(p.valore_max);
  else ok = m.dir === 0 ? Math.abs(eff - p.valore) <= tol(p.valore) : (eff - p.valore) * dir >= -tol(p.valore);
  const scarto = m.formato === "%" ? `${fmtNumero(eff - p.valore, 1)} punti` : `${fmtNumero(((eff - p.valore) / Math.abs(p.valore || 1)) * 100, 1)}%`;
  return { esito: ok ? "rispettata" : "mancata", effettivo: eff, dettaglio: `consuntivo ${m.formato === "%" ? `${fmtNumero(eff, 1)}%` : fmtNumero(eff, 0)} contro ${m.formato === "%" ? `${fmtNumero(p.valore, 1)}%` : fmtNumero(p.valore, 0)} promesso (scarto ${scarto})` };
}
const sezioneFase5 = (id) => (id === "tows" || id === "promesse" ? { id } : null);
const ESITI_PROMESSA = { rispettata: ["Rispettata", C.ok, C.okTenue], mancata: ["Mancata", C.allarme, C.allarmeTenue], in_corso: ["Da monitorare", C.periodico, C.periodicoTenue], non_verificabile: ["Non verificabile", C.muto, C.fondo] };

/* --- 5D Narrativa e numeri: segnali deterministici ---------------------- */
function narrativaENumeri(stato) {
  const voci = verificaCompleta(stato).filter((v) => v.tipo === "affermazione" || v.tipo === "forza" || v.tipo === "traccia");
  const verificabili = voci.filter((v) => ["confermato", "parziale", "smentito"].includes(v.esito));
  const smentite = verificabili.filter((v) => v.esito === "smentito");
  const indice = verificabili.length ? Math.round((verificabili.filter((v) => v.esito === "confermato").length + 0.5 * verificabili.filter((v) => v.esito === "parziale").length) / verificabili.length * 100) : null;
  const segnali = [];
  const tipi = stato.documenti.map((d) => d.tipo);
  if (tipi.includes("NT")) segnali.push({ testo: "Presente una comunicazione di deposito tardivo (NT 10-K / NT 10-Q).", gravita: "alta" });
  if (tipi.includes("CORRESP")) segnali.push({ testo: "Presenti lettere di commento della SEC: verificare quali voci sono state contestate.", gravita: "media" });
  const controlli = Object.values(stato.estratti).flat().filter((e) => e.tema === "controlli_revisione" && e.entitaId === "principale");
  const re = [
    [/restat|riesposi|non[- ]reliance|4\.02/i, "Riferimenti a riesposizione dei bilanci o a bilanci non più affidabili.", "alta"],
    [/material weakness|debolezz[ae] (rilevant|material)/i, "Debolezze rilevanti del controllo interno dichiarate.", "alta"],
    [/change in (registrant's )?certifying accountant|cambio (della società )?di revisione|4\.01/i, "Cambio della società di revisione.", "media"],
    [/going concern|continuit[àa] aziendale/i, "Riferimenti alla continuità aziendale.", "alta"],
  ];
  for (const [r, testo, gravita] of re) if (controlli.some((e) => r.test(`${e.testoOriginale} ${e.traduzioneIt}`))) segnali.push({ testo, gravita });
  /* Rischi ripetuti invariati: lo stesso fattore di rischio, con lo stesso
     testo, in relazioni annuali di esercizi diversi. Non è un difetto in sé, ma
     un risk reporting copiato anno dopo anno informa poco (§2.6.1). */
  const consolidato = consolidaEstratti(stato.documenti, stato.estratti);
  const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
  const ripetuti = consolidato.cluster.filter((c) => c.capofila.tema === "rischi" && c.capofila.entitaId === "principale"
    && new Set(c.occorrenze.map((o) => metaDoc[o.docId]).filter((d) => ["10-K", "20-F", "40-F"].includes(d?.tipo)).map((d) => d.anno)).size >= 2);
  const rischiTotali = consolidato.cluster.filter((c) => c.capofila.tema === "rischi" && c.capofila.entitaId === "principale").length;
  return { indice, verificabili: verificabili.length, smentite, segnali, ripetuti, rischiTotali };
}

/** Punteggio di credibilità del management: componenti esplicite, pesi dichiarati. */
function credibilitaManagement(stato) {
  const prom = stato.fase5?.[CHIAVE_SOCIETA]?.sezioni?.promesse;
  const promesse = prom && prom.stato !== "proposto" ? (prom.dati.previsioni || []).map((p) => valutaPromessa(stato, p)) : [];
  const verificate = promesse.filter((p) => p.esito === "rispettata" || p.esito === "mancata");
  const quotaPromesse = verificate.length ? verificate.filter((p) => p.esito === "rispettata").length / verificate.length : null;
  const nar = narrativaENumeri(stato);
  const quotaNarrativa = nar.indice === null ? null : nar.indice / 100;
  const penalita = nar.segnali.reduce((t, s) => t + (s.gravita === "alta" ? 10 : 5), 0);
  const componenti = [
    { id: "promesse", label: "Promesse rispettate (5C)", peso: 0.5, valore: quotaPromesse, base: `${verificate.length} previsioni verificabili` },
    { id: "narrativa", label: "Affermazioni confermate dai numeri (Fase 4)", peso: 0.5, valore: quotaNarrativa, base: `${nar.verificabili} voci verificabili` },
  ];
  const disponibili = componenti.filter((c) => c.valore !== null);
  if (!disponibili.length) return { punteggio: null, componenti, penalita, motivo: "Servono previsioni verificate (5C confermata) o voci verificate in Fase 4." };
  const pesoTot = disponibili.reduce((t, c) => t + c.peso, 0);
  const base = disponibili.reduce((t, c) => t + c.valore * c.peso, 0) / pesoTot * 100;
  return { punteggio: Math.max(0, Math.round(base - penalita)), componenti, penalita, motivo: null };
}

function profiloFase5(stato) {
  const unita = unitaDiAnalisi(stato);
  const perUnita = Object.fromEntries(unita.map((u) => {
    const sw = costruisciSwot(stato, u, !!stato.opzioni?.includiNonVerificate);
    const tows = stato.fase5?.[u.chiave]?.sezioni?.tows;
    return [u.chiave, { unita: u, swot: sw, tows: tows && tows.stato !== "proposto" ? tows.dati : null, coerenza: valutaCoerenza(stato, u) }];
  }));
  const prom = stato.fase5?.[CHIAVE_SOCIETA]?.sezioni?.promesse;
  const previsioni = prom && prom.stato !== "proposto" ? (prom.dati.previsioni || []).map((p) => ({ ...p, ...valutaPromessa(stato, p) })) : [];
  return { perUnita, previsioni, promesse: prom && prom.stato !== "proposto" ? prom.dati : null, narrativa: narrativaENumeri(stato), credibilita: credibilitaManagement(stato) };
}

/* ==========================================================================
   [21] INTERFACCIA DELLA FASE 5
   ========================================================================== */

function QuadranteSwot({ titolo, voci, prefisso, colore, sfondo, esterno = false }) {
  return (
    <div className="rounded-md p-3" style={{ background: sfondo, minHeight: 120 }}>
      <div className="st-eyebrow mb-1.5" style={{ color: colore }}>{titolo} · {voci.length}</div>
      {!voci.length && <p className="text-xs italic" style={{ color: C.muto }}>{esterno ? "Nessuna voce confermata in Fase 2 (2E)." : "Nessuna voce verificata in Fase 4."}</p>}
      <ol className="space-y-1">
        {voci.map((v, i) => (
          <li key={i} className="text-xs leading-snug flex gap-1.5">
            <span className="shrink-0 rounded px-1" style={{ background: colore, color: "#fff", fontFamily: F.mono, fontSize: 9, height: 15 }}>{prefisso}{i + 1}</span>
            <span>
              {v.testo}
              {!esterno && v.esito && v.esito !== "confermato" && <span className="ml-1" style={{ color: ESITI_VERIFICA[v.esito]?.colore, fontFamily: F.mono, fontSize: 9 }}>[{ESITI_VERIFICA[v.esito]?.label.toLowerCase()}]</span>}
              {esterno && (v.probabilita || v.impatto) && <span className="ml-1" style={{ color: C.muto, fontFamily: F.mono, fontSize: 9 }}>[p{v.probabilita ?? "?"}·i{v.impatto ?? "?"}]</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function VistaFase5({ stato, dispatch }) {
  const unita = useMemo(() => unitaDiAnalisi(stato), [stato.fase1, stato.xbrl]);
  const [chiave, setChiave] = useState(null);
  const u = unita.find((x) => x.chiave === chiave) || unita[0];
  const [inCorso, setInCorso] = useState(null);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const includi = !!stato.opzioni?.includiNonVerificate;
  const swot = useMemo(() => costruisciSwot(stato, u, includi), [stato, u, includi]);
  const coerenza = useMemo(() => valutaCoerenza(stato, u), [stato, u]);
  const narrativa = useMemo(() => narrativaENumeri(stato), [stato]);
  const credibilita = useMemo(() => credibilitaManagement(stato), [stato]);
  const indice = useMemo(() => {
    const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
    const out = {};
    for (const l of Object.values(stato.estratti)) for (const e of l) out[e.id] = { e, d: metaDoc[e.docId] };
    return out;
  }, [stato.estratti, stato.documenti]);
  const tows = stato.fase5?.[u.chiave]?.sezioni?.tows;
  const prom = stato.fase5?.[CHIAVE_SOCIETA]?.sezioni?.promesse;
  const dispPromesse = useMemo(() => selezionaEstratti(stato, "principale", SEZIONE_PROMESSE), [stato.estratti, stato.documenti, stato.entita]);

  const esegui = async (cosa) => {
    setInCorso(cosa);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: cosa === "tows" ? u.nome : "società", fase: cosa === "tows" ? "Fase 5 · matrice TOWS" : "Fase 5 · promesse e consensus", blocco: 0, totale: 0 } });
    try {
      if (cosa === "tows") {
        const r = await generaTows(statoRef.current, u, swot);
        dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase5", chiave: u.chiave, sezioneId: "tows", risultato: r, meta: { nome: u.nome } });
        dispatch({ tipo: "LOG", livello: "ok", testo: `TOWS per «${u.nome}» proposta${r.scartate ? `: ${r.scartate} opzioni scartate perché non combinavano elementi interni ed esterni validi` : ""}. Da confermare.` });
      } else {
        const r = await generaPromesse(statoRef.current);
        dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase5", chiave: CHIAVE_SOCIETA, sezioneId: "promesse", risultato: r, meta: { nome: "società" } });
        dispatch({ tipo: "LOG", livello: "ok", testo: `Promesse e consensus ricostruiti da ${plurale(r.estrattiForniti, "estratto", "estratti")}: ${plurale(r.dati.previsioni.length, "previsione quantitativa", "previsioni quantitative")}, ${(r.dati.consensus || []).length} confronti con il consensus. Da confermare.` });
      }
    } catch (err) {
      dispatch({ tipo: "LOG", livello: err.vuoto ? "attenzione" : "errore", testo: `Fase 5: ${err.message}` });
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(null);
    }
  };

  const pulsanti = (sez, cosa, abilitato, ramoChiave, sezioneId) => (
    <span className="flex gap-2">
      <button onClick={() => esegui(cosa)} disabled={!!inCorso || !abilitato} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, opacity: inCorso || !abilitato ? 0.5 : 1 }}>
        <RefreshCw size={12} className={inCorso === cosa ? "animate-spin" : ""} /> {inCorso === cosa ? "in corso…" : sez ? "Rigenera" : "Genera"}
      </button>
      {sez && sez.stato !== "confermato" && <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase5", chiave: ramoChiave, sezioneId, stato: "confermato" })} className="st-btn flex items-center gap-1 rounded px-2.5 py-1 text-xs" style={{ background: C.ok, color: "#fff" }}><Check size={12} /> Conferma</button>}
      {sez && sez.stato === "confermato" && <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase5", chiave: ramoChiave, sezioneId, stato: "proposto" })} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, color: C.muto }}>Riapri</button>}
    </span>
  );
  const statoPill = (sez) => (sez ? <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: STATO_SEZIONE[sez.stato].sfondo, color: STATO_SEZIONE[sez.stato].colore }}>{STATO_SEZIONE[sez.stato].label}</span> : null);
  const modPromesse = (percorso, valore) => dispatch({ tipo: "SEZ_MODIFICA", ramo: "fase5", chiave: CHIAVE_SOCIETA, sezioneId: "promesse", percorso, valore });
  const modTows = (percorso, valore) => dispatch({ tipo: "SEZ_MODIFICA", ramo: "fase5", chiave: u.chiave, sezioneId: "tows", percorso, valore });

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 5 · Coerenza e credibilità</span>
          <nav className="flex rounded-md overflow-x-auto border max-w-full" style={{ borderColor: C.riga }}>
            {unita.map((x) => (
              <button key={x.chiave} onClick={() => setChiave(x.chiave)} className="st-btn px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 text-xs"
                style={{ borderColor: C.riga, background: u.chiave === x.chiave ? C.inchiostro : C.carta, color: u.chiave === x.chiave ? "#fff" : C.muto }}>
                {x.nome}{x.peso ? ` · ${fmtNumero(x.peso, 0)}%` : ""}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<Scale size={14} />} titolo="5A · SWOT e TOWS" colore={C.ok}
              nota="Forze e debolezze entrano solo se la Fase 4 le ha confermate (in tutto o in parte); opportunità e minacce vengono dalla sezione 2E confermata. Dalla matrice l'IA deriva le opzioni strategiche, ognuna ancorata ai codici degli elementi che combina."
              badge={<span className="flex gap-1.5 items-center"><Pillola>ASA: {u.nome}</Pillola>{statoPill(tows)}</span>} />
            <div className="px-4 pb-4">
              <label className="flex items-center gap-2 text-xs mb-3" style={{ color: C.muto }}>
                <input type="checkbox" checked={includi} onChange={(e) => dispatch({ tipo: "OPZIONI", patch: { includiNonVerificate: e.target.checked } })} />
                Includi anche le voci non verificabili (marcate come tali)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <QuadranteSwot titolo="Punti di forza" voci={swot.s} prefisso="S" colore={C.ok} sfondo={C.okTenue} />
                <QuadranteSwot titolo="Punti di debolezza" voci={swot.w} prefisso="W" colore={C.allarme} sfondo={C.allarmeTenue} />
                <QuadranteSwot titolo="Opportunità" voci={swot.o} prefisso="O" colore={C.periodico} sfondo={C.periodicoTenue} esterno />
                <QuadranteSwot titolo="Minacce" voci={swot.t} prefisso="T" colore={C.ambra} sfondo={C.ambraTenue} esterno />
              </div>
              {swot.escluse.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer" style={{ color: C.muto }}>{plurale(swot.escluse.length, "voce esclusa", "voci escluse")} dalla SWOT dopo la verifica</summary>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                    {swot.escluse.map((v) => <li key={v.id}>{v.testo} <span style={{ color: ESITI_VERIFICA[v.esito]?.colore || C.muto }}>— {v.esito ? ESITI_VERIFICA[v.esito].label.toLowerCase() : "test da preparare in Fase 4"}</span></li>)}
                  </ul>
                </details>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="st-eyebrow" style={{ color: C.muto }}>Matrice TOWS</span>
                {!swot.completa && <span className="text-xs" style={{ color: C.ambra }}>Servono almeno una voce interna e una esterna.</span>}
                <span className="ml-auto">{pulsanti(tows, "tows", swot.completa, u.chiave, "tows")}</span>
              </div>
              {tows && (
                <>
                  {tows.dati.sintesi && <p className="mt-2 text-sm leading-relaxed rounded-md p-2.5" style={{ background: C.fondo }}>{tows.dati.sintesi}</p>}
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {QUADRANTI_TOWS.map(([q, titolo, col]) => (
                      <div key={q} className="rounded-md border p-2.5" style={{ borderColor: col }}>
                        <div className="st-eyebrow mb-1" style={{ color: col }}>{titolo}</div>
                        {!(tows.dati[q] || []).length && <p className="text-xs italic" style={{ color: C.muto }}>Nessuna opzione.</p>}
                        {(tows.dati[q] || []).map((o, i) => (
                          <div key={i} className="py-1 border-t first:border-t-0" style={{ borderColor: C.rigaTenue }}>
                            <Voce nodo={o} percorso={[q, i]} onModifica={modTows} indice={indice} />
                            <div className="flex flex-wrap gap-1">
                              <Pillola colore={o.priorita === "alta" ? C.allarme : o.priorita === "media" ? C.ambra : C.muto}>priorità {o.priorita}</Pillola>
                              {o.usa.map((c) => <span key={c} title={o.riferimenti?.find((r) => r.codice === c)?.testo} className="rounded px-1" style={{ background: C.fondo, fontFamily: F.mono, fontSize: 10 }}>{c}</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="5B · Coerenza fra strategia e ambiente" colore={C.ok}
              nota="Regole esplicite (§3.14) applicate dal sistema all'ASA: la strategia dichiarata ha senso nell'ambiente della Fase 2 e trova riscontro nei numeri della Fase 4?" />
            <ul className="px-4 pb-4 space-y-1.5">
              {coerenza.map((r) => {
                const [l, col, bg] = ESITI_COERENZA[r.esito];
                return (
                  <li key={r.id} className="rounded-md border px-3 py-2" style={{ borderColor: C.rigaTenue, background: r.esito === "non_valutabile" ? C.carta : bg }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm flex-1 min-w-[180px]" style={{ fontWeight: 600 }}>{r.titolo}</span>
                      <Pillola colore={col}>{l}</Pillola>
                    </div>
                    <p className="text-xs mt-0.5">{r.spiegazione}</p>
                    <p className="text-xs" style={{ color: C.muto }}>{r.condizione}</p>
                  </li>
                );
              })}
            </ul>
          </Scheda>

          <Scheda>
            <Intestazione icona={<Target size={14} />} titolo="5C · Promesse e realtà" colore={C.ok}
              nota="Le previsioni quantitative del management (guidance, target dei piani) confrontate con il consuntivo XBRL. Le previsioni sugli esercizi non ancora chiusi restano «da monitorare» e passano alla Fase 6. Livello società."
              badge={<span className="flex gap-1.5 items-center"><Pillola>livello società</Pillola>{statoPill(prom)}</span>} />
            <div className="px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs" style={{ color: dispPromesse.propri ? C.muto : C.allarme }}>Materiale: {plurale(dispPromesse.propri, "estratto di guidance", "estratti di guidance")}, {dispPromesse.quanti - dispPromesse.propri} di supporto o di consensus</span>
                <span className="ml-auto">{pulsanti(prom, "promesse", dispPromesse.quanti > 0, CHIAVE_SOCIETA, "promesse")}</span>
              </div>
              {!prom && <p className="text-sm" style={{ color: C.muto }}>{dispPromesse.quanti ? "Non ancora generata." : "Nessun estratto di guidance: carica in Fase 0 comunicati sui risultati, presentazioni e trascrizioni delle call degli anni passati."}</p>}
              {prom && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: C.fondo }}>
                          {["Previsione", "Metrica", "Anno", "Promesso", "Esito"].map((h) => <th key={h} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(prom.dati.previsioni || []).map((p, i) => {
                          const v = valutaPromessa(stato, p);
                          const [l, col, bg] = ESITI_PROMESSA[v.esito];
                          return (
                            <tr key={i} className="border-t align-top" style={{ borderColor: C.rigaTenue }}>
                              <td className="px-2 py-1.5">{p.testo} <Evidenze ids={p.evidenze} indice={indice} />{p.dichiarata_nel && <div style={{ color: C.muto }}>dichiarata: {p.dichiarata_nel}</div>}</td>
                              <td className="px-2 py-1.5">{METRICHE_PROMESSE[p.metrica]?.label}</td>
                              <td className="px-2 py-1.5"><input type="number" value={p.anno} onChange={(e) => modPromesse(["previsioni", i, "anno"], Number(e.target.value))} className="w-16 rounded border px-1" style={selStile} aria-label="Anno" /></td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span style={{ color: C.muto }}>{p.tipo_valore === "minimo" ? "≥ " : p.tipo_valore === "massimo" ? "≤ " : p.tipo_valore === "intervallo" ? "da " : ""}</span>
                                <input type="number" value={p.valore} onChange={(e) => modPromesse(["previsioni", i, "valore"], Number(e.target.value))} className="w-20 rounded border px-1" style={selStile} aria-label="Valore promesso" />
                                {p.tipo_valore === "intervallo" && <> a <input type="number" value={p.valore_max ?? ""} onChange={(e) => modPromesse(["previsioni", i, "valore_max"], Number(e.target.value))} className="w-20 rounded border px-1" style={selStile} aria-label="Valore massimo" /></>}
                              </td>
                              <td className="px-2 py-1.5"><span className="rounded px-1.5 py-0.5" style={{ background: bg, color: col, fontFamily: F.mono, fontSize: 10 }}>{l}</span><div style={{ color: C.muto }}>{v.dettaglio}</div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!(prom.dati.previsioni || []).length && <p className="text-xs italic mt-1" style={{ color: C.muto }}>Nessuna previsione quantitativa negli estratti.</p>}
                  {(prom.dati.previsioni_qualitative || []).length > 0 && (
                    <div className="mt-3">
                      <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Obiettivi non quantificati</div>
                      {prom.dati.previsioni_qualitative.map((q, i) => <Voce key={i} nodo={q} percorso={["previsioni_qualitative", i]} onModifica={modPromesse} indice={indice} extra={q.anno ? <Pillola>{q.anno}</Pillola> : null} />)}
                    </div>
                  )}
                  <Lacune lacune={prom.dati.lacune} />
                </>
              )}
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<Languages size={14} />} titolo="5D · Narrativa e numeri" colore={C.ok}
              nota="Quanto ciò che il management racconta trova riscontro nei numeri, più i segnali documentali che chiedono cautela. Tutto calcolato dal sistema." />
            <div className="px-4 pb-4 space-y-3">
              <div className="flex flex-wrap items-center gap-4 rounded-md p-3" style={{ background: C.fondo }}>
                <div>
                  <div className="st-eyebrow" style={{ color: C.muto }}>Coerenza narrativa</div>
                  <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 26 }}>{narrativa.indice === null ? "—" : `${narrativa.indice}/100`}</div>
                </div>
                <p className="text-xs flex-1 min-w-[200px]" style={{ color: C.muto }}>Quota di affermazioni, tracce della strategia e punti di forza confermati dalla Fase 4 (parziali a metà), su {plurale(narrativa.verificabili, "voce verificabile", "voci verificabili")}.</p>
              </div>
              {narrativa.smentite.length > 0 && (
                <div>
                  <div className="st-eyebrow mb-1" style={{ color: C.allarme }}>Affermazioni smentite dai numeri</div>
                  <ul className="list-disc pl-5 text-xs space-y-0.5">{narrativa.smentite.map((v) => <li key={v.id}>{v.testo} <span style={{ color: C.muto }}>({v.origine})</span></li>)}</ul>
                </div>
              )}
              <div>
                <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Segnali documentali</div>
                {!narrativa.segnali.length ? <p className="text-xs" style={{ color: C.muto }}>Nessun segnale fra i documenti e gli estratti su revisione e controlli.</p> : (
                  <ul className="space-y-1">{narrativa.segnali.map((s, i) => <li key={i} className="flex items-center gap-2 text-xs"><AlertTriangle size={12} style={{ color: s.gravita === "alta" ? C.allarme : C.ambra }} />{s.testo}</li>)}</ul>
                )}
              </div>
              <p className="text-xs" style={{ color: C.muto }}>
                Fattori di rischio ripetuti con lo stesso testo in relazioni annuali di esercizi diversi: <b style={{ color: C.inchiostro }}>{narrativa.ripetuti.length}</b> su {narrativa.rischiTotali}. Un risk reporting copiato anno dopo anno informa poco.
              </p>
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<BarChart3 size={14} />} titolo="5E · Consensus e guidance" colore={C.ok}
              nota="Dove il mercato è più ottimista o più prudente del management. I dati vengono dalla stessa ricostruzione della 5C (report di analisti e consensus caricati in Fase 0)." />
            <div className="px-4 pb-4">
              {!(prom?.dati?.consensus || []).length ? <p className="text-xs" style={{ color: C.muto }}>Nessun confronto disponibile: servono dati di consensus fra i documenti di informazione derivata e la sezione 5C generata.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr style={{ background: C.fondo }}>{["Metrica", "Anno", "Guidance", "Consensus", "Differenza", "Lettura", "Fonte"].map((h) => <th key={h} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {prom.dati.consensus.map((c, i) => {
                        const m = METRICHE_PROMESSE[c.metrica];
                        const diff = c.valore_guidance !== null && c.valore_guidance !== undefined ? (m.formato === "%" ? c.valore_consensus - c.valore_guidance : ((c.valore_consensus - c.valore_guidance) / Math.abs(c.valore_guidance || 1)) * 100) : null;
                        const lettura = diff === null ? "—" : Math.abs(diff) < (m.formato === "%" ? 0.3 : 1) ? "allineati" : diff * (m.dir || 1) > 0 ? "mercato più ottimista" : "mercato più prudente";
                        return (
                          <tr key={i} className="border-t" style={{ borderColor: C.rigaTenue }}>
                            <td className="px-2 py-1">{m.label}</td><td className="px-2 py-1">{c.anno}</td>
                            <td className="px-2 py-1" style={{ fontFamily: F.mono }}>{fmtNumero(c.valore_guidance, 1)}</td>
                            <td className="px-2 py-1" style={{ fontFamily: F.mono }}>{fmtNumero(c.valore_consensus, 1)}</td>
                            <td className="px-2 py-1" style={{ fontFamily: F.mono }}>{diff === null ? "—" : m.formato === "%" ? `${fmtNumero(diff, 1)} p.` : `${fmtNumero(diff, 1)}%`}</td>
                            <td className="px-2 py-1">{lettura}</td>
                            <td className="px-2 py-1" style={{ color: C.muto }}>{c.fonte} <Evidenze ids={c.evidenze} indice={indice} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Scheda>
        </div>

        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<Users size={14} />} titolo="Credibilità del management" nota="Calcolata dal sistema; ogni componente è esplicita. Peserà sull'affidabilità delle assumption in Fase 6." />
            <div className="px-4 pb-4">
              <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, color: credibilita.punteggio === null ? C.muto : credibilita.punteggio >= 70 ? C.ok : credibilita.punteggio >= 45 ? C.ambra : C.allarme }}>
                {credibilita.punteggio === null ? "—" : credibilita.punteggio}<span style={{ fontSize: 14, color: C.muto }}>/100</span>
              </div>
              {credibilita.motivo && <p className="text-xs" style={{ color: C.muto }}>{credibilita.motivo}</p>}
              <ul className="mt-2 space-y-1 text-xs">
                {credibilita.componenti.map((c) => (
                  <li key={c.id} className="flex gap-2"><span className="flex-1">{c.label} <span style={{ color: C.muto }}>· peso {Math.round(c.peso * 100)}% · {c.base}</span></span><b style={{ fontFamily: F.mono }}>{c.valore === null ? "n.d." : `${Math.round(c.valore * 100)}%`}</b></li>
                ))}
                <li className="flex gap-2"><span className="flex-1">Penalità per segnali documentali</span><b style={{ fontFamily: F.mono, color: credibilita.penalita ? C.allarme : C.inchiostro }}>−{credibilita.penalita}</b></li>
              </ul>
            </div>
          </Scheda>
          <Scheda>
            <Intestazione icona={<GitBranch size={14} />} titolo="Quadro delle ASA" />
            <div className="px-4 pb-4 space-y-2">
              {unita.map((x) => {
                const sw = costruisciSwot(stato, x, includi);
                const co = valutaCoerenza(stato, x);
                return (
                  <div key={x.chiave} className="rounded-md border p-2.5 text-xs" style={{ borderColor: x.chiave === u.chiave ? C.ok : C.rigaTenue }}>
                    <b>{x.nome}</b>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5" style={{ color: C.muto }}>
                      <span>S / W / O / T</span><b style={{ color: C.inchiostro }}>{sw.s.length} / {sw.w.length} / {sw.o.length} / {sw.t.length}</b>
                      <span>Regole incoerenti</span><b style={{ color: co.some((r) => r.esito === "incoerente") ? C.allarme : C.inchiostro }}>{co.filter((r) => r.esito === "incoerente").length}</b>
                      <span>In attenzione</span><b style={{ color: C.inchiostro }}>{co.filter((r) => r.esito === "attenzione").length}</b>
                      <span>TOWS</span><b style={{ color: C.inchiostro }}>{stato.fase5?.[x.chiave]?.sezioni?.tows ? STATO_SEZIONE[stato.fase5[x.chiave].sezioni.tows.stato].label.split(" ")[0] : "—"}</b>
                    </div>
                  </div>
                );
              })}
            </div>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => {}} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [22] FASE 6 — SINTESI, ASSUMPTION E RELAZIONE
   --------------------------------------------------------------------------
     6A Giudizio finale   → quadro per ASA calcolato dal sistema (attrattività,
                            posizione, sostenibilità del vantaggio, coerenza) e
                            sintesi scritta dall'IA a partire dai SOLI giudizi confermati
     6B Assumption        → driver dei bilanci pro-forma in tre scenari: base
                            storica calcolata, proposta dell'IA che la motiva con
                            ambiente (F2), strategie (F3), verifica (F4), guidance e
                            consensus (F5); affidabilità legata alla credibilità
     6C Relazione Word    → documento .docx generato nel browser
   ========================================================================== */

const DRIVER_ASSUNZIONI = [
  { id: "crescita_ricavi", label: "Crescita annua dei ricavi", unita: "%", kpi: "crescita_ricavi", passoPess: -3, passoOtt: 3 },
  { id: "margine_operativo", label: "Margine operativo", unita: "%", kpi: "margine_operativo", passoPess: -2, passoOtt: 2 },
  { id: "investimenti_ricavi", label: "Investimenti / ricavi", unita: "%", kpi: "capex_ricavi", passoPess: 1, passoOtt: -0.5 },
  { id: "giorni_incasso", label: "Giorni medi di incasso", unita: "gg", kpi: "dso", passoPess: 10, passoOtt: -5 },
];
const SCENARI = [["pessimistico", "Pessimistico", C.allarme], ["base", "Base", C.periodico], ["ottimistico", "Ottimistico", C.ok]];
const ORIZZONTE_ANNI = 3;

/** Riferimenti numerici per ogni driver: storico (media ultimi 3 esercizi), guidance, consensus, mercato. */
function riferimentiDriver(stato) {
  const soc = serieKpi(stato.xbrl.principale);
  const media3 = (kpi) => {
    const v = Object.entries(soc?.kpi?.[kpi] || {}).sort((a, b) => a[0] - b[0]).slice(-3).map(([, x]) => x);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const ultimoAnno = soc?.anni?.slice(-1)[0] || null;
  const ricaviUltimi = stato.xbrl.principale?.serie?.ricavi?.valori?.[ultimoAnno] ?? null;
  const prom = stato.fase5?.[CHIAVE_SOCIETA]?.sezioni?.promesse;
  const previsioni = prom && prom.stato !== "proposto" ? prom.dati.previsioni || [] : [];
  const consensus = prom && prom.stato !== "proposto" ? prom.dati.consensus || [] : [];
  const futuro = (p) => ultimoAnno && p.anno > ultimoAnno;
  const daRicavi = (valMln, anno) => (ricaviUltimi && valMln ? (Math.pow((valMln * 1e6) / ricaviUltimi, 1 / Math.max(1, anno - ultimoAnno)) - 1) * 100 : null);
  const guidance = {}, cons = {};
  for (const p of previsioni.filter(futuro)) {
    if (p.metrica === "crescita_ricavi") guidance.crescita_ricavi = p.valore;
    if (p.metrica === "ricavi") guidance.crescita_ricavi = guidance.crescita_ricavi ?? daRicavi(p.valore, p.anno);
    if (p.metrica === "margine_operativo") guidance.margine_operativo = p.valore;
  }
  for (const c of consensus.filter(futuro)) {
    if (c.metrica === "crescita_ricavi") cons.crescita_ricavi = c.valore_consensus;
    if (c.metrica === "ricavi") cons.crescita_ricavi = cons.crescita_ricavi ?? daRicavi(c.valore_consensus, c.anno);
    if (c.metrica === "margine_operativo") cons.margine_operativo = c.valore_consensus;
  }
  const mercato = {};
  for (const u of unitaDiAnalisi(stato)) {
    const cm = (profiloFase2(stato, u.chiave)?.ciclo?.crescita_mercato || []).find((x) => typeof x.valore === "number" && (x.unita || "").includes("%"));
    if (cm && mercato.crescita_ricavi === undefined) mercato.crescita_ricavi = cm.valore;
  }
  return Object.fromEntries(DRIVER_ASSUNZIONI.map((d) => [d.id, {
    storico: media3(d.kpi), guidance: guidance[d.id] ?? null, consensus: cons[d.id] ?? null, mercato: mercato[d.id] ?? null,
  }]));
}

/** Scenari calcolati senza IA: base = media storica, scarti fissi dichiarati per gli altri due. */
function scenariStorici(stato) {
  const rif = riferimentiDriver(stato);
  const arrot = (x) => (x === null ? null : Math.round(x * 10) / 10);
  return {
    driver: Object.fromEntries(DRIVER_ASSUNZIONI.map((d) => {
      const b = rif[d.id].storico;
      return [d.id, { pessimistico: arrot(b === null ? null : b + d.passoPess), base: arrot(b), ottimistico: arrot(b === null ? null : b + d.passoOtt),
        motivazione: b === null ? "Dato storico non disponibile." : `Media degli ultimi tre esercizi; scenari a ${d.passoPess > 0 ? "+" : ""}${d.passoPess} e ${d.passoOtt > 0 ? "+" : ""}${d.passoOtt} ${d.unita === "%" ? "punti" : d.unita}.` }];
    })),
    ipotesi_chiave: ["Scenari estrapolati dalla serie storica, senza correzioni strategiche (§4.1: metodo più rischioso)."],
    rischi_scenario: [],
  };
}

/** Affidabilità delle assumption: dipende dalla credibilità e da quanto c'è oltre la storia. */
function affidabilitaAssunzioni(stato) {
  const cred = credibilitaManagement(stato).punteggio;
  const haPiano = stato.documenti.some((d) => ["PIANO STRATEGICO", "INVESTOR PRESENTATION"].includes(d.tipo) && d.entitaId === "principale");
  const rif = riferimentiDriver(stato);
  const haGuidance = Object.values(rif).some((r) => r.guidance !== null);
  const motivi = [];
  let livello = "media";
  if (cred === null) motivi.push("credibilità del management non misurata (Fase 5)");
  else if (cred >= 70) motivi.push(`credibilità del management ${cred}/100`);
  else motivi.push(`credibilità del management solo ${cred}/100`);
  if (!haPiano) motivi.push("nessun piano o presentazione strategica: le ipotesi sono in parte estrapolate dalla storia (§4.1)");
  if (!haGuidance) motivi.push("nessuna guidance sugli esercizi futuri");
  if (cred !== null && cred >= 70 && haPiano && haGuidance) livello = "alta";
  else if ((cred !== null && cred < 45) || (!haPiano && !haGuidance)) livello = "bassa";
  return { livello, motivi };
}

/** Proiezione semplice dei ricavi e del risultato operativo per scenario, sull'orizzonte. */
function proiezioneScenari(stato, assunzioni) {
  const anni = stato.xbrl.principale?.anni || [];
  const ultimo = anni[anni.length - 1];
  const ricavi0 = stato.xbrl.principale?.serie?.ricavi?.valori?.[ultimo];
  if (!ricavi0 || !assunzioni?.driver) return null;
  return {
    ultimo, ricavi0,
    scenari: Object.fromEntries(SCENARI.map(([k]) => {
      const g = assunzioni.driver.crescita_ricavi?.[k], m = assunzioni.driver.margine_operativo?.[k];
      if (typeof g !== "number" || typeof m !== "number") return [k, null];
      return [k, Array.from({ length: ORIZZONTE_ANNI }, (_, i) => {
        const ricavi = ricavi0 * Math.pow(1 + g / 100, i + 1);
        return { anno: ultimo + i + 1, ricavi, risultato: (ricavi * m) / 100 };
      })];
    })),
  };
}

/** Quadro deterministico per ASA: il giudizio dell'IA lo commenta, non lo sostituisce. */
function quadroGiudizio(stato) {
  const cred = credibilitaManagement(stato);
  return unitaDiAnalisi(stato).map((u) => {
    const p2 = profiloFase2(stato, u.chiave);
    const p3 = profiloFase3(stato, u.chiave);
    const port = (p3.corporate?.portafoglio || []).find((p) => normalizzaNome(p.asa) === normalizzaNome(u.nome));
    const ris = p3.risorse?.risorse || [];
    const sostenibili = ris.filter((r) => esitoVrio(r.vrio) === "sostenibile").length;
    const temporanei = ris.filter((r) => ["temporaneo", "non_sfruttato"].includes(esitoVrio(r.vrio))).length;
    const coer = valutaCoerenza(stato, u);
    const sw = costruisciSwot(stato, u, !!stato.opzioni?.includiNonVerificate);
    return {
      unita: u,
      attrattivita: p2?.attrattivita?.indice ?? null,
      ciclo: p2?.ciclo?.fase_settore?.fase || null,
      posizione: port?.posizione_competitiva ?? null,
      bcg: categoriaBcg(port)?.[0] || null,
      ge: zonaGe(p2?.attrattivita?.indice, port?.posizione_competitiva)?.[0] || null,
      strategia: STRATEGIE_COMPETITIVE[p3.competitiva?.strategia?.tipo] || null,
      sostenibilita: ris.length ? (sostenibili ? "durevole" : temporanei ? "temporanea" : "assente") : null,
      sostenibili, temporanei,
      fcsScoperti: p3.coperturaFcs.filter((c) => c.esito === "scoperto" || c.esito === "debole").map((c) => c.nome),
      incoerenti: coer.filter((r) => r.esito === "incoerente").map((r) => r.titolo),
      attenzione: coer.filter((r) => r.esito === "attenzione").map((r) => r.titolo),
      swot: { s: sw.s.length, w: sw.w.length, o: sw.o.length, t: sw.t.length },
      credibilita: cred.punteggio,
    };
  });
}

function testoQuadroPerIA(stato) {
  const q = quadroGiudizio(stato);
  const nar = narrativaENumeri(stato);
  const p5 = profiloFase5(stato);
  const p3s = profiloFase3(stato, CHIAVE_SOCIETA);
  const righe = [`Credibilità del management: ${p5.credibilita.punteggio ?? "n.d."}/100. Coerenza narrativa: ${nar.indice ?? "n.d."}/100. Segnali documentali: ${nar.segnali.map((s) => s.testo).join(" ") || "nessuno"}.`];
  if (p3s.corporate?.assetto?.testo) righe.push(`Assetto del perimetro: ${p3s.corporate.assetto.testo}`);
  if (p3s.governance) righe.push(`Governance: ${["board", "vertice", "incentivi", "qualita_management"].map((k) => p3s.governance[k]?.testo ? `${k} (${p3s.governance[k].valutazione || "n.d."}): ${p3s.governance[k].testo}` : null).filter(Boolean).join(" | ")}`);
  const prev = p5.previsioni || [];
  if (prev.length) righe.push(`Promesse del management: ${prev.map((p) => `${p.testo} → ${ESITI_PROMESSA[p.esito]?.[0] || p.esito}`).join("; ")}`);
  for (const x of q) {
    const u = x.unita;
    const p2 = profiloFase2(stato, u.chiave);
    const sw = costruisciSwot(stato, u, !!stato.opzioni?.includiNonVerificate);
    const tows = p5.perUnita[u.chiave]?.tows;
    righe.push(`\nASA «${u.nome}»${u.peso ? ` (${fmtNumero(u.peso, 1)}% dei ricavi)` : ""}: attrattività ${x.attrattivita ?? "n.d."}/100, ciclo ${x.ciclo || "n.d."}, posizione competitiva ${x.posizione ?? "n.d."}/5, BCG ${x.bcg || "n.d."}, GE ${x.ge || "n.d."}, strategia ${x.strategia || "n.d."}, vantaggi sostenibili ${x.sostenibili}, temporanei ${x.temporanei}, FCS scoperti: ${x.fcsScoperti.join(", ") || "nessuno"}, regole incoerenti: ${x.incoerenti.join(", ") || "nessuna"}, in attenzione: ${x.attenzione.join(", ") || "nessuna"}.`);
    righe.push(`  Forze verificate: ${sw.s.map((v) => `${v.testo} [${v.esito}]`).join("; ") || "nessuna"}`);
    righe.push(`  Debolezze verificate: ${sw.w.map((v) => `${v.testo} [${v.esito}]`).join("; ") || "nessuna"}`);
    righe.push(`  Opportunità: ${sw.o.map((v) => v.testo).join("; ") || "nessuna"} | Minacce: ${sw.t.map((v) => v.testo).join("; ") || "nessuna"}`);
    if (p2?.om?.giudizio_attrattivita?.testo) righe.push(`  Giudizio di attrattività (F2): ${p2.om.giudizio_attrattivita.testo}`);
    if (tows?.sintesi) righe.push(`  Direzione emersa dalla TOWS: ${tows.sintesi}`);
  }
  return righe.join("\n");
}

const SYSTEM_SINTESI = `Sei un analista che chiude un'analisi strategica fondamentale. Ricevi il quadro dei giudizi
già CONFERMATI dall'operatore e verificati sui numeri. Scrivi la sintesi: non aggiungere fatti, non usare
conoscenze esterne, non contraddire gli esiti delle verifiche (un punto smentito dai numeri non può diventare un
punto di forza). Distingui chiaramente ciò che è confermato da ciò che resta incerto. Italiano professionale,
frasi brevi. Rispondi solo con JSON valido.`;

async function generaSintesi(stato) {
  const ent = stato.entita.find((e) => e.id === "principale");
  const testo = await chiamataIA({
    system: SYSTEM_SINTESI,
    contenuto: `SOCIETÀ: ${nomeEntita(ent)}${ent.ticker ? ` (${ent.ticker})` : ""}

QUADRO DEI GIUDIZI CONFERMATI:
${testoQuadroPerIA(stato)}

Restituisci:
{
  "giudizio_complessivo": "<5-8 frasi: attrattività dei business, posizione competitiva, sostenibilità del vantaggio, credibilità del management, conclusione>",
  "asa": [ { "asa": "<nome ESATTO>", "giudizio": "<3-5 frasi>", "attrattivita": "alta" | "media" | "bassa", "posizione": "forte" | "media" | "debole",
             "sostenibilita_vantaggio": "durevole" | "temporanea" | "assente", "durata_stimata": "<orizzonte del vantaggio, es. 3-5 anni, o null>" } ],
  "punti_chiave": ["<da 3 a 6 punti chiave>"],
  "segnali_allarme": ["<eventuali segnali d'allarme>"]
}`,
    maxTokens: 4000,
  });
  const json = parseJsonRobusto(testo);
  if (!json || typeof json !== "object" || !json.giudizio_complessivo) throw new Error("risposta del modello non interpretabile");
  const nomi = new Set(unitaDiAnalisi(stato).map((u) => normalizzaNome(u.nome)));
  const dati = {
    giudizio_complessivo: { testo: String(json.giudizio_complessivo).trim() },
    asa: (Array.isArray(json.asa) ? json.asa : []).filter((a) => a && nomi.has(normalizzaNome(a.asa))).map((a) => ({
      asa: a.asa, testo: testoOrNull(a.giudizio) || "",
      attrattivita: ["alta", "media", "bassa"].includes(a.attrattivita) ? a.attrattivita : null,
      posizione: ["forte", "media", "debole"].includes(a.posizione) ? a.posizione : null,
      sostenibilita_vantaggio: ["durevole", "temporanea", "assente"].includes(a.sostenibilita_vantaggio) ? a.sostenibilita_vantaggio : null,
      durata_stimata: testoOrNull(a.durata_stimata),
    })),
    punti_chiave: (Array.isArray(json.punti_chiave) ? json.punti_chiave : []).map(testoOrNull).filter(Boolean).slice(0, 8).map((t) => ({ testo: t })),
    segnali_allarme: (Array.isArray(json.segnali_allarme) ? json.segnali_allarme : []).map(testoOrNull).filter(Boolean).slice(0, 8).map((t) => ({ testo: t })),
  };
  return { dati, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}`, estrattiForniti: 0, evidenzeUsate: 0 };
}

const SYSTEM_ASSUNZIONI = `Sei un analista che traduce un'analisi strategica in ipotesi (assumption) per i bilanci
pro-forma (§3.1, §3.14): ogni numero deve avere una causa strategica dichiarata — ambiente, strategia, risorse,
credibilità del management. Parti dai riferimenti numerici forniti (storico, guidance, consensus, mercato) e
spiega perché ti discosti. Non inventare dati: se un riferimento manca, dillo. Rispondi solo con JSON valido.`;

async function generaAssunzioni(stato) {
  const rif = riferimentiDriver(stato);
  const aff = affidabilitaAssunzioni(stato);
  const tab = DRIVER_ASSUNZIONI.map((d) => `- ${d.id} (${d.label}, ${d.unita}): storico ${rif[d.id].storico === null ? "n.d." : fmtNumero(rif[d.id].storico, 1)}, guidance ${rif[d.id].guidance === null ? "n.d." : fmtNumero(rif[d.id].guidance, 1)}, consensus ${rif[d.id].consensus === null ? "n.d." : fmtNumero(rif[d.id].consensus, 1)}, mercato ${rif[d.id].mercato === null ? "n.d." : fmtNumero(rif[d.id].mercato, 1)}`).join("\n");
  const testo = await chiamataIA({
    system: SYSTEM_ASSUNZIONI,
    contenuto: `ORIZZONTE: ${ORIZZONTE_ANNI} esercizi; valori come media annua sull'orizzonte.
AFFIDABILITÀ CALCOLATA DAL SISTEMA: ${aff.livello} (${aff.motivi.join("; ")}).

RIFERIMENTI NUMERICI:
${tab}

QUADRO STRATEGICO CONFERMATO:
${testoQuadroPerIA(stato)}

Restituisci:
{
  "driver": {
${DRIVER_ASSUNZIONI.map((d) => `    "${d.id}": { "pessimistico": <numero>, "base": <numero>, "ottimistico": <numero>, "motivazione": "<perché questi valori: quale fattore strategico li sposta rispetto allo storico>" }`).join(",\n")}
  },
  "ipotesi_chiave": ["<ipotesi strategica su cui poggia lo scenario base>"],
  "rischi_scenario": ["<che cosa porterebbe allo scenario pessimistico>"]
}
Gli scenari devono essere ordinati in modo coerente (il pessimistico peggiore del base, l'ottimistico migliore).`,
    maxTokens: 3500,
  });
  const json = parseJsonRobusto(testo);
  if (!json?.driver) throw new Error("risposta del modello non interpretabile");
  const num = (x) => (typeof x === "number" && isFinite(x) ? Math.round(x * 10) / 10 : typeof x === "string" && isFinite(Number(x.replace(",", "."))) ? Math.round(Number(x.replace(",", ".")) * 10) / 10 : null);
  const dati = {
    driver: Object.fromEntries(DRIVER_ASSUNZIONI.map((d) => {
      const x = json.driver[d.id] || {};
      return [d.id, { pessimistico: num(x.pessimistico), base: num(x.base), ottimistico: num(x.ottimistico), motivazione: testoOrNull(x.motivazione) || "" }];
    })),
    ipotesi_chiave: (json.ipotesi_chiave || []).map(testoOrNull).filter(Boolean),
    rischi_scenario: (json.rischi_scenario || []).map(testoOrNull).filter(Boolean),
  };
  return { dati, generatoIl: new Date().toISOString(), modello: `${configIA.provider} · ${configIA.modelli[configIA.provider]}`, estrattiForniti: 0, evidenzeUsate: 0 };
}

const sezioneFase6 = (id) => (id === "sintesi" || id === "assunzioni" ? { id } : null);

/** Capitoli della relazione: commento dell'analista per ciascuno. */
const CAPITOLI_RELAZIONE = [
  ["sintesi", "Executive summary"], ["base", "1. Base informativa e metodologia"], ["profilo", "2. Profilo della società"],
  ["esterna", "3. Analisi esterna"], ["interna", "4. Analisi interna"], ["verifica", "5. Verifica numerica"],
  ["coerenza", "6. Coerenza e credibilità"], ["conclusioni", "7. Conclusioni e assumption"],
];

/* ==========================================================================
   [23] RELAZIONE WORD — generazione nel browser con la libreria «docx»
   --------------------------------------------------------------------------
   La libreria si carica dal CDN alla prima generazione (o da
   window.__DOCX_URL__, se impostato). Il documento usa gli stili di titolo
   nativi di Word, così il sommario si aggiorna all'apertura; le citazioni sono
   note a piè di pagina con documento, sezione e pagina; nella relazione entrano
   solo le sezioni confermate o modificate dall'operatore.
   ========================================================================== */

const URL_DOCX = [
  "https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js",
  "https://unpkg.com/docx@9.5.1/dist/index.iife.js",
];

function caricaDocx() {
  if (typeof window === "undefined") return Promise.reject(new Error("la relazione Word richiede un browser"));
  if (window.docx?.Document) return Promise.resolve(window.docx);
  if (window.__docxPromise) return window.__docxPromise;
  const fonti = [window.__DOCX_URL__, ...URL_DOCX].filter(Boolean);
  window.__docxPromise = new Promise((res, rej) => {
    const prova = (i) => {
      if (i >= fonti.length) { window.__docxPromise = null; return rej(new Error("impossibile caricare la libreria per i documenti Word (rete non raggiungibile)")); }
      const s = document.createElement("script");
      s.src = fonti[i];
      s.onload = () => (window.docx?.Document ? res(window.docx) : prova(i + 1));
      s.onerror = () => prova(i + 1);
      document.head.appendChild(s);
    };
    prova(0);
  });
  return window.__docxPromise;
}

const LARGHEZZA_UTILE = 9638; // A4 con margini di 2 cm, in DXA
const COLORE_TITOLI = "0C6157";

async function generaRelazioneWord(stato, opzioni = {}) {
  const D = await caricaDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType,
    BorderStyle, FootnoteReferenceRun, TableOfContents, Footer, Header, PageNumber, PageBreak, LevelFormat } = D;
  const sintetica = opzioni.versione === "sintetica";
  const commenti = opzioni.commenti || {};
  const ent = stato.entita.find((e) => e.id === "principale");
  const metaDoc = Object.fromEntries(stato.documenti.map((d) => [d.id, d]));
  const estrattoPerId = {};
  for (const l of Object.values(stato.estratti)) for (const e of l) estrattoPerId[e.id] = e;
  const unita = unitaDiAnalisi(stato);
  const corpo = [];
  const note = {};
  let nNota = 0;
  const citati = [];

  /* ---- mattoni ---- */
  const T = (text, o = {}) => new TextRun({ text: String(text ?? ""), ...o });
  const TC = (text) => T(text, { size: 18 });
  const P = (contenuto, o = {}) => new Paragraph({ children: Array.isArray(contenuto) ? contenuto : [T(contenuto)], spacing: { after: 120 }, ...o });
  const muto = (testo) => P([T(testo, { italics: true, color: "69727D" })]);
  const H1 = (testo, nuovaPagina = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: nuovaPagina, children: [T(testo)] });
  const H2 = (testo) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [T(testo)] });
  const H3 = (testo) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [T(testo)] });
  const cita = (ids = []) => {
    const runs = [];
    for (const id of (ids || []).slice(0, 3)) {
      const e = estrattoPerId[id];
      if (!e) continue;
      const d = metaDoc[e.docId];
      nNota++;
      const rif = [d?.tipo, d?.anno, e.sezione, e.pagina ? `p. ${e.pagina}` : null].filter(Boolean).join(", ");
      note[nNota] = { children: [new Paragraph({ children: [T(`${rif}${d?.origine === "web" ? ` (fonte web: ${d.editore} — ${d.url})` : d?.nomeFile ? ` (${d.nomeFile})` : ""}: «${String(e.testoOriginale).slice(0, 300)}${e.testoOriginale.length > 300 ? "…" : ""}»`, { size: 16 })] })] };
      runs.push(new FootnoteReferenceRun(nNota));
      if (!citati.includes(id)) citati.push(id);
    }
    return runs;
  };
  const voce = (nodo, etichetta = null) => {
    if (!nodo?.testo) return etichetta ? P([T(`${etichetta}: `, { bold: true }), T("non documentato negli estratti.", { italics: true, color: "69727D" })]) : null;
    return P([
      ...(etichetta ? [T(`${etichetta}: `, { bold: true })] : []),
      T(nodo.testo),
      ...cita(nodo.evidenze),
      ...(nodo.nonSupportato ? [T(" [non supportato da estratti]", { italics: true, color: "A3341F" })] : []),
    ]);
  };
  const punto = (contenuto) => new Paragraph({ children: Array.isArray(contenuto) ? contenuto : [T(contenuto)], numbering: { reference: "punti", level: 0 }, spacing: { after: 60 } });
  const puntoVoce = (nodo, prefisso = "") => punto([T(prefisso), T(nodo?.testo || ""), ...cita(nodo?.evidenze), ...(nodo?.nonSupportato ? [T(" [non supportato]", { italics: true, color: "A3341F" })] : [])]);
  const bordo = { style: BorderStyle.SINGLE, size: 4, color: "D2D7DD" };
  const bordi = { top: bordo, bottom: bordo, left: bordo, right: bordo };
  const cella = (contenuto, w, intestazione = false) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: bordi,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: intestazione ? { type: ShadingType.CLEAR, fill: "E9ECEF", color: "auto" } : undefined,
    children: (Array.isArray(contenuto) && contenuto.length && contenuto[0] instanceof Paragraph)
      ? contenuto
      : [new Paragraph({ children: Array.isArray(contenuto) ? contenuto : [T(contenuto, { size: 18, bold: intestazione })] })],
  });
  const tabella = (intestazioni, righe, proporzioni) => {
    const tot = proporzioni.reduce((a, b) => a + b, 0);
    const w = proporzioni.map((p) => Math.floor((p / tot) * LARGHEZZA_UTILE));
    w[w.length - 1] += LARGHEZZA_UTILE - w.reduce((a, b) => a + b, 0);
    return new Table({
      width: { size: LARGHEZZA_UTILE, type: WidthType.DXA }, columnWidths: w,
      rows: [
        new TableRow({ tableHeader: true, children: intestazioni.map((h, i) => cella(h, w[i], true)) }),
        ...righe.map((r) => new TableRow({ children: r.map((c, i) => cella(typeof c === "number" ? String(c) : c ?? "—", w[i])) })),
      ],
    });
  };
  const spazio = () => P("");
  const nonConfermata = (nome) => muto(`${nome}: sezione non confermata dall'operatore, esclusa dalla relazione.`);
  const commento = (cap) => {
    const t = (commenti[cap] || "").trim();
    if (!t) return [];
    return [H3("Commento dell'analista"), ...t.split(/\n+/).map((r) => P([T(r, { italics: true })]))];
  };
  const fmtP = (v) => (v === null || v === undefined ? "—" : `${fmtNumero(v, 1)}%`);

  /* ---- frontespizio ---- */
  corpo.push(
    P([T("Analisi fondamentale", { size: 22, color: "69727D" })], { spacing: { before: 2400, after: 200 } }),
    P([T("Analisi strategica esterna e interna", { size: 52, bold: true, color: COLORE_TITOLI })], { spacing: { after: 240 } }),
    P([T(nomeEntita(ent), { size: 36, bold: true })]),
    P([T([ent.ticker && `Ticker ${ent.ticker}`, ent.cik && `CIK ${ent.cik}`, ent.settore].filter(Boolean).join(" · "), { size: 22, color: "69727D" })]),
    P([T(`Versione ${sintetica ? "sintetica" : "completa"} · ${new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}${opzioni.analista ? ` · ${opzioni.analista}` : ""}`, { size: 20 })], { spacing: { before: 600 } }),
    P([T(`Base informativa: ${plurale(stato.documenti.length, "documento", "documenti")}, ${plurale(Object.keys(stato.xbrl).length, "serie XBRL", "serie XBRL")}, ${plurale(stato.entita.filter((e) => e.ruolo === "peer").length, "peer", "peer")}.`, { size: 20, color: "69727D" })]),
    P([T("Ogni affermazione è tratta da documenti citati in nota; ogni giudizio strategico è stato confrontato con i numeri di bilancio. Le sezioni non confermate dall'analista sono escluse.", { size: 18, italics: true, color: "69727D" })], { spacing: { before: 1200 } }),
    new Paragraph({ children: [new PageBreak()] }),
    P([T("Sommario", { size: 32, bold: true, color: COLORE_TITOLI })]),
    P([T("Se il sommario non compare, in Word: clic destro qui sotto → «Aggiorna campo» (oppure F9).", { size: 16, italics: true, color: "69727D" })]),
    new TableOfContents("Sommario", { hyperlink: true, headingStyleRange: "1-2" }),
  );

  /* ---- executive summary ---- */
  const sint = stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.sintesi;
  const sintesi = sint && sint.stato !== "proposto" ? sint.dati : null;
  const quadro = quadroGiudizio(stato);
  const cred = credibilitaManagement(stato);
  corpo.push(H1("Executive summary"));
  if (sintesi) {
    corpo.push(P(sintesi.giudizio_complessivo?.testo || ""));
    if (sintesi.punti_chiave?.length) { corpo.push(H3("Punti chiave")); sintesi.punti_chiave.forEach((p) => corpo.push(punto(p.testo))); }
    if (sintesi.segnali_allarme?.length) { corpo.push(H3("Segnali d'allarme")); sintesi.segnali_allarme.forEach((p) => corpo.push(punto([T(p.testo, { color: "A3341F" })]))); }
  } else corpo.push(nonConfermata("Sintesi finale (6A)"));
  corpo.push(H3("Quadro delle aree strategiche d'affari"));
  corpo.push(tabella(["ASA", "Peso", "Attrattività", "Ciclo", "Posizione", "Strategia", "Vantaggio", "Matrice GE"],
    quadro.map((q) => [q.unita.nome, q.unita.peso ? `${fmtNumero(q.unita.peso, 0)}%` : "—", q.attrattivita === null ? "—" : `${q.attrattivita}/100`, FASI_CICLO.find(([k]) => k === q.ciclo)?.[1] || "—", q.posizione ? `${q.posizione}/5` : "—", q.strategia || "—", q.sostenibilita || "—", q.ge || "—"]),
    [16, 7, 11, 11, 10, 17, 12, 16]));
  const ps = calcolaPunteggioStrategico(stato);
  corpo.push(spazio(), P([T("Punteggio strategico: ", { bold: true }), T(ps.punteggio === null ? "non calcolabile" : `${ps.punteggio}/100, classe ${ps.classe.classe} (${ps.classe.label.toLowerCase()})`), T(` — copertura ${Math.round(ps.copertura * 100)}%, metodo ${ps.versione}${ps.affidabile ? "" : "; copertura insufficiente, punteggio poco affidabile"}.`, { color: "69727D" })]));
  corpo.push(P([T("Credibilità del management: ", { bold: true }), T(cred.punteggio === null ? "non misurata" : `${cred.punteggio}/100`), T(` — ${cred.componenti.map((c) => `${c.label.toLowerCase()} ${c.valore === null ? "n.d." : `${Math.round(c.valore * 100)}%`}`).join("; ")}${cred.penalita ? `; penalità per segnali −${cred.penalita}` : ""}.`, { color: "69727D" })]));
  corpo.push(...commento("sintesi"));

  /* ---- capitolo 7 anticipato nella versione sintetica? No: l'ordine resta lo stesso, la sintetica salta i dettagli ---- */
  if (!sintetica) {
    /* 1. Base informativa */
    corpo.push(H1("1. Base informativa e metodologia"));
    corpo.push(H2("1.1 Documenti analizzati"));
    corpo.push(tabella(["Area", "Tipo", "File", "Società", "Anno", "Estratti"],
      stato.documenti.map((d) => [areaDelLivello(d.layer)?.label || d.layer, etichettaTipo(d.tipo), d.origine === "web" ? `${d.titolo} — ${d.editore} (web, ${d.url})` : d.nomeFile, nomeEntita(stato.entita.find((e) => e.id === d.entitaId)), d.anno || "—", String((stato.estratti[d.id] || []).length)]),
      [18, 16, 26, 16, 8, 8]));
    const nWeb = stato.documenti.filter((d) => d.origine === "web").length;
    if (nWeb) corpo.push(P([T(`${nWeb === 1 ? "Una fonte è stata reperita" : `${nWeb} fonti sono state reperite`} con ricerca web dall'intelligenza artificiale e scelte dall'analista: i passaggi sono trascritti dall'IA e l'indirizzo è stato controllato fra i risultati della ricerca; i numeri decisivi vanno ricontrollati sulla fonte.`, { color: "69727D", size: 18 })]));
    const lacune = valutaCopertura(stato, ent).filter((r) => r.esito !== "completo");
    corpo.push(H2("1.2 Lacune della base informativa"));
    if (!lacune.length) corpo.push(P("La base informativa soddisfa tutti i requisiti minimi."));
    lacune.forEach((r) => corpo.push(punto([T(`${r.label} (${r.n}/${r.minimo}): `, { bold: true }), T(r.seManca)])));
    corpo.push(H2("1.3 Metodologia"));
    [
      "L'analisi segue il percorso dell'analisi fondamentale: contesto (analisi esterna), strategie (analisi interna), verifica sui numeri di bilancio, coerenza e credibilità, sintesi in ipotesi per i bilanci pro-forma.",
      "I documenti sono stati letti per porzioni; ogni frammento rilevante è stato trascritto letteralmente, tradotto e classificato per tema. Ogni affermazione della relazione rinvia in nota al frammento da cui è tratta.",
      "Gli indicatori sono calcolati dalle serie XBRL depositate presso la SEC, per la società e per i peer. Punti di forza, di debolezza e affermazioni del management entrano nella SWOT solo se confermati dai numeri.",
      "Indici, matrici (BCG, GE, VRIO), regole di coerenza e punteggio di credibilità sono calcolati in modo deterministico; l'intelligenza artificiale è stata usata per leggere i documenti e proporre giudizi, ciascuno confermato o corretto dall'analista.",
    ].forEach((t) => corpo.push(P(t)));
    corpo.push(...commento("base"));

    /* 2. Profilo */
    const p1 = profiloFase1(stato, "principale");
    corpo.push(H1("2. Profilo della società"));
    corpo.push(H2("2.1 Identità"));
    if (p1?.identita) {
      corpo.push(voce(p1.identita.missione, "Missione"), voce(p1.identita.visione, "Visione"));
      if (p1.identita.valori?.length) { corpo.push(P([T("Valori:", { bold: true })])); p1.identita.valori.forEach((v) => corpo.push(puntoVoce(v))); }
      corpo.push(voce(p1.identita.codice_etico, "Codice etico"), voce(p1.identita.sintesi, "Sintesi"));
    } else corpo.push(nonConfermata("Identità (1A)"));
    corpo.push(H2("2.2 Modello di business"));
    if (p1?.modello) {
      const m = p1.modello;
      corpo.push(H3("Livello strategico"), voce(m.livello_strategico?.sintesi));
      (m.livello_strategico?.scelte || []).forEach((s) => corpo.push(puntoVoce(s)));
      corpo.push(H3("Livello operativo"));
      CAMPI_OPERATIVI.forEach(([k, l]) => { const v = voce(m.livello_operativo?.[k], l); if (v) corpo.push(v); });
    } else corpo.push(nonConfermata("Modello di business (1B)"));
    const eco = indicatoriEconomici(stato.xbrl.principale);
    corpo.push(H3("Livello economico-finanziario"));
    if (eco) corpo.push(tabella(["Indicatore", ...eco.anni.map(String)], eco.righe.map((r) => [r.label, ...eco.anni.map((a) => fmtIndicatore(r.valori[a], r.formato))]), [34, ...eco.anni.map(() => 11)]));
    else corpo.push(muto("Serie XBRL non disponibili."));
    corpo.push(H2("2.3 Aree strategiche d'affari"));
    if (p1?.segmenti?.segmenti?.length) {
      corpo.push(tabella(["Segmento", "Tipo", `Ricavi ${p1.pesi.anno || ""}`, "Peso", "Unità di analisi"],
        p1.segmenti.segmenti.map((s) => [s.nome, s.tipo || "—", fmtNumero((s.serie || []).find((x) => x.anno === p1.pesi.anno)?.ricavi, 1), p1.pesi.pesi[s.nome] === undefined ? "—" : fmtP(p1.pesi.pesi[s.nome]), p1.asa.some((a) => a.nome === s.nome) ? "sì" : "no"]),
        [30, 16, 18, 14, 22]));
    } else corpo.push(nonConfermata("Segmenti e ASA (1C)"));
    corpo.push(H2("2.4 Perimetro competitivo"));
    if (p1?.perimetro) {
      const dm = p1.perimetro.definizione_mercato || {};
      corpo.push(voce(dm.domanda, "Confini dal lato della domanda"), voce(dm.offerta, "Confini dal lato dell'offerta"), voce(dm.geografia, "Ambito geografico"));
      (p1.perimetro.basi_competizione || []).forEach((b) => corpo.push(puntoVoce(b, "Base della competizione: ")));
      if (p1.perimetro.concorrenti?.length) corpo.push(tabella(["Concorrente", "Tipo", "ASA", "Motivo"], p1.perimetro.concorrenti.map((c) => [c.nome, c.tipo || "—", (c.segmenti || []).join(", ") || "—", [TC(c.motivo || ""), ...cita(c.evidenze)]]), [22, 12, 20, 46]));
    } else corpo.push(nonConfermata("Perimetro competitivo (1D)"));
    corpo.push(...commento("profilo"));

    /* 3. Analisi esterna */
    corpo.push(H1("3. Analisi esterna"));
    unita.forEach((u, iu) => {
      const p2 = profiloFase2(stato, u.chiave);
      corpo.push(H2(`3.${iu + 1} ${u.nome}${u.peso ? ` (${fmtNumero(u.peso, 0)}% dei ricavi)` : ""}`));
      if (!p2 || !Object.values(p2).some(Boolean)) { corpo.push(nonConfermata("Analisi esterna")); return; }
      corpo.push(H3("PESTEL e ciclicità"));
      if (p2.pestel) {
        const righe = [];
        FATTORI_PESTEL.forEach(([k, l]) => (p2.pestel.fattori?.[k]?.elementi || []).forEach((el) => righe.push([l, [TC(el.testo || ""), ...cita(el.evidenze)], el.direzione === "opportunita" ? "opportunità" : el.direzione || "—", el.intensita ? `${el.intensita}/5` : "—", el.orizzonte || "—"])));
        if (righe.length) corpo.push(tabella(["Fattore", "Elemento", "Direzione", "Intensità", "Orizzonte"], righe, [16, 46, 14, 11, 13]));
        FATTORI_PESTEL.forEach(([k, l]) => { const g = p2.pestel.fattori?.[k]?.giudizio; if (g?.testo) corpo.push(voce(g, l)); });
        corpo.push(voce(p2.pestel.ciclicita, `Ciclicità (${p2.pestel.ciclicita?.classe || "n.d."})`));
      } else corpo.push(nonConfermata("PESTEL (2A)"));
      corpo.push(H3("Ciclo di vita e tecnologia"));
      if (p2.ciclo) {
        corpo.push(voce(p2.ciclo.fase_settore, `Fase del settore: ${FASI_CICLO.find(([k]) => k === p2.ciclo.fase_settore?.fase)?.[1] || "n.d."}`));
        corpo.push(voce(p2.ciclo.tecnologia, `Tecnologia (${PAVITT[p2.ciclo.tecnologia?.pavitt] || "n.d."}; ${STADI_TECNOLOGIA[p2.ciclo.tecnologia?.stadio] || "n.d."})`));
        (p2.ciclo.crescita_mercato || []).forEach((c) => corpo.push(puntoVoce(c, `${c.fonte_tipo === "terzi" ? "Fonte terza" : "Fonte società"}: `)));
        const co = coerenzaCicloVita(stato, p2.ciclo.fase_settore?.fase);
        if (co?.controlli?.length) co.controlli.forEach((c) => corpo.push(punto(`${c.esito === true ? "Coerente" : c.esito === false ? "Non coerente" : "Non determinabile"}: ${c.label} (${c.soglia}).`)));
      } else corpo.push(nonConfermata("Ciclo di vita (2B)"));
      corpo.push(H3("Le cinque forze competitive"));
      if (p2.forze) {
        corpo.push(tabella(["Forza", "Intensità", "Valutazione"], FORZE.map(([k, l]) => [l, p2.forze.forze?.[k]?.punteggio ? `${p2.forze.forze[k].punteggio}/5` : "—", p2.forze.forze?.[k]?.sintesi ? [TC(p2.forze.forze[k].sintesi.testo || ""), ...cita(p2.forze.forze[k].sintesi.evidenze)] : "non documentata"]), [26, 12, 62]));
        if (p2.attrattivita) corpo.push(P([T("Attrattività strutturale: ", { bold: true }), T(`${p2.attrattivita.indice}/100 (intensità media delle forze ${fmtNumero(p2.attrattivita.media, 2)} su 5).`)]));
      } else corpo.push(nonConfermata("Cinque forze (2C)"));
      corpo.push(H3("Fattori critici di successo"));
      if (p2.fcs) (p2.fcs.fcs || []).forEach((f) => corpo.push(punto([T(`${f.fattore}: `, { bold: true }), T(f.testo || ""), ...cita(f.evidenze), ...(f.kpi?.length ? [T(` (si misura con: ${f.kpi.join(", ")})`, { color: "69727D" })] : [])])));
      else corpo.push(nonConfermata("Fattori critici (2D)"));
      corpo.push(H3("Opportunità e minacce"));
      if (p2.om) {
        const r = [...(p2.om.opportunita || []).map((o, i) => [`O${i + 1}`, [TC(o.testo || ""), ...cita(o.evidenze)], o.origine || "—", o.probabilita || "—", o.impatto || "—", o.orizzonte || "—"]),
          ...(p2.om.minacce || []).map((o, i) => [`T${i + 1}`, [TC(o.testo || ""), ...cita(o.evidenze)], o.origine || "—", o.probabilita || "—", o.impatto || "—", o.orizzonte || "—"])];
        if (r.length) corpo.push(tabella(["", "Voce", "Origine", "Prob.", "Impatto", "Orizzonte"], r, [6, 44, 20, 8, 10, 12]));
        corpo.push(voce(p2.om.giudizio_attrattivita, "Giudizio di attrattività"));
      } else corpo.push(nonConfermata("Opportunità e minacce (2E)"));
    });
    corpo.push(...commento("esterna"));

    /* 4. Analisi interna */
    corpo.push(H1("4. Analisi interna"));
    const soc = profiloFase3(stato, CHIAVE_SOCIETA);
    corpo.push(H2("4.1 Corporate strategy e portafoglio"));
    if (soc.corporate) {
      corpo.push(voce(soc.corporate.assetto, "Assetto"), voce(soc.corporate.integrazione_verticale, "Integrazione verticale"), voce(soc.corporate.allocazione_capitale, "Allocazione del capitale"));
      (soc.corporate.operazioni || []).forEach((o) => corpo.push(puntoVoce(o, `${o.tipo || "operazione"}${o.anno ? ` ${o.anno}` : ""}: `)));
      if (soc.corporate.portafoglio?.length) corpo.push(tabella(["ASA", "Quota relativa", "Crescita mercato", "BCG", "Posizione", "Matrice GE"], soc.corporate.portafoglio.map((p) => {
        const u = unita.find((x) => normalizzaNome(x.nome) === normalizzaNome(p.asa));
        const att = u ? profiloFase2(stato, u.chiave)?.attrattivita?.indice : null;
        return [p.asa, p.quota_relativa || "—", p.crescita_mercato || "—", categoriaBcg(p)?.[0] || "—", p.posizione_competitiva ? `${p.posizione_competitiva}/5` : "—", zonaGe(att, p.posizione_competitiva)?.[0] || "—"];
      }), [22, 14, 14, 16, 12, 22]));
    } else corpo.push(nonConfermata("Corporate strategy (3A)"));
    corpo.push(H2("4.2 Governance e management"));
    if (soc.governance) {
      VOCI_GOVERNANCE.forEach(([k, l]) => { const v = voce(soc.governance[k], `${l}${soc.governance[k]?.valutazione ? ` (${soc.governance[k].valutazione})` : ""}`); if (v) corpo.push(v); });
      corpo.push(voce(soc.governance.incentivi, `Incentivi${soc.governance.incentivi?.allineamento ? ` (${soc.governance.incentivi.allineamento} alla strategia)` : ""}`));
      corpo.push(voce(soc.governance.qualita_management, "Qualità del management"));
      (soc.governance.segnali || []).forEach((s) => corpo.push(puntoVoce(s, `Segnale (${s.valutazione || "n.d."}): `)));
    } else corpo.push(nonConfermata("Governance (3E)"));
    unita.forEach((u, iu) => {
      const p3 = profiloFase3(stato, u.chiave);
      corpo.push(H2(`4.${iu + 3} ${u.nome}`));
      corpo.push(H3("Strategia competitiva"));
      if (p3.competitiva) {
        corpo.push(voce(p3.competitiva.strategia, STRATEGIE_COMPETITIVE[p3.competitiva.strategia?.tipo] || "Strategia"));
        (p3.competitiva.fonti_vantaggio || []).forEach((f) => corpo.push(puntoVoce(f, "Fonte del vantaggio: ")));
        (p3.competitiva.kpi_attesi || []).forEach((k) => corpo.push(puntoVoce(k, `Traccia attesa (${k.kpi}): `)));
      } else corpo.push(nonConfermata("Strategia competitiva (3B)"));
      corpo.push(H3("Catena del valore"));
      if (p3.catena) {
        const righe = [...ATTIVITA_PRIMARIE.map((x) => ["primaria", ...x]), ...ATTIVITA_SUPPORTO.map((x) => ["supporto", ...x])]
          .filter(([g, k]) => p3.catena[g === "primaria" ? "primarie" : "supporto"]?.[k])
          .map(([g, k, l]) => { const a = p3.catena[g === "primaria" ? "primarie" : "supporto"][k]; return [l, a.svolta || "—", a.rilevanza ? `${a.rilevanza}/5` : "—", [TC(a.testo || ""), ...cita(a.evidenze)]]; });
        if (righe.length) corpo.push(tabella(["Attività", "Svolta", "Valore", "Descrizione"], righe, [24, 14, 10, 52]));
        corpo.push(voce(p3.catena.dove_si_crea_valore, "Dove si crea il valore"));
      } else corpo.push(nonConfermata("Catena del valore (3C)"));
      corpo.push(H3("Risorse e test VRIO"));
      if (p3.risorse) {
        const sn = (v) => (v === true ? "sì" : v === false ? "no" : "?");
        corpo.push(tabella(["Risorsa", "Categoria", "V", "R", "I", "O", "Esito"], (p3.risorse.risorse || []).map((r) => [[TC(r.nome || ""), ...cita(r.evidenze)], CATEGORIE_RISORSA[r.categoria] || "—", sn(r.vrio?.valore), sn(r.vrio?.rarita), sn(r.vrio?.inimitabilita), sn(r.vrio?.organizzazione), ESITI_VRIO[esitoVrio(r.vrio)]?.[0] || "incompleto"]), [30, 18, 6, 6, 6, 6, 28]));
        p3.coperturaFcs.forEach((c) => corpo.push(punto(`FCS «${c.nome}»: ${c.esito}${c.collegate.length ? ` (${c.collegate.map((r) => r.nome).join(", ")})` : ""}.`)));
      } else corpo.push(nonConfermata("Risorse e VRIO (3D)"));
    });
    corpo.push(...commento("interna"));

    /* 5. Verifica numerica */
    corpo.push(H1("5. Verifica numerica"));
    const qk = quadroKpi(stato);
    corpo.push(H2("5.1 Indicatori della società e dei peer"));
    if (qk.societa) corpo.push(tabella(["Indicatore", "Società", "Anno", "Mediana peer", "Posizione"], qk.righe.filter((r) => r.valore).map((r) => [r.kpi.label, fmtKpi(r.valore.valore, r.kpi.formato), String(r.valore.anno), fmtKpi(r.mediana, r.kpi.formato), r.migliore === null ? "—" : r.migliore ? "migliore" : "peggiore"]), [38, 16, 10, 18, 18]));
    else corpo.push(muto("Serie XBRL non disponibili."));
    corpo.push(P([T(`Peer con dati XBRL: ${qk.peer.map(({ e }) => nomeEntita(e)).join(", ") || "nessuno"}.`, { color: "69727D" })]));
  }

  /* 5.2 e tabelle chiave: anche nella sintetica */
  const ver = verificaCompleta(stato);
  if (sintetica) corpo.push(H1("Verifica numerica delle affermazioni"));
  else corpo.push(H2("5.2 Verifica delle affermazioni"));
  if (ver.length) {
    corpo.push(tabella(["Voce", "Origine", "Test e risultato", "Esito"], ver.map((v) => [
      [TC(v.testo), ...cita(v.evidenze)], v.origine,
      v.risultati.length ? v.risultati.map((r) => `${kpiPerId(r.kpi)?.label} ${CONDIZIONI[r.condizione]?.label}: ${r.esito === true ? "sì" : r.esito === false ? "no" : "n.d."} (${r.dettaglio})`).join("; ") : (v.nonVerificabile || "nessun test"),
      `${ESITI_VERIFICA[v.esito]?.label || "test da preparare"}${v.forzato ? ` (forzato: ${v.nota || "senza motivazione"})` : ""}`,
    ]), [30, 18, 36, 16]));
  } else corpo.push(muto("Nessuna voce da verificare: affermazioni, tracce della strategia e punti di forza o debolezza non sono stati confermati nelle fasi precedenti."));
  if (!sintetica) corpo.push(...commento("verifica"));

  /* 6. Coerenza e credibilità */
  corpo.push(H1(sintetica ? "SWOT, coerenza e credibilità" : "6. Coerenza e credibilità"));
  const p5 = profiloFase5(stato);
  unita.forEach((u, iu) => {
    const x = p5.perUnita[u.chiave];
    corpo.push(H2(`${sintetica ? "" : `6.${iu + 1} `}${u.nome}`));
    const lista = (voci, pref) => (voci.length ? voci.map((v, i) => new Paragraph({ children: [T(`${pref}${i + 1} `, { bold: true, size: 18 }), T(v.testo, { size: 18 }), ...(v.esito && v.esito !== "confermato" && pref.match(/[SW]/) ? [T(` [${ESITI_VERIFICA[v.esito]?.label.toLowerCase()}]`, { size: 16, color: "8A6212" })] : [])] })) : [new Paragraph({ children: [T("—", { size: 18, color: "69727D" })] })]);
    const w = Math.floor(LARGHEZZA_UTILE / 2);
    corpo.push(new Table({
      width: { size: LARGHEZZA_UTILE, type: WidthType.DXA }, columnWidths: [w, LARGHEZZA_UTILE - w],
      rows: [
        new TableRow({ children: [cella("Punti di forza (verificati)", w, true), cella("Punti di debolezza (verificati)", LARGHEZZA_UTILE - w, true)] }),
        new TableRow({ children: [cella(lista(x.swot.s, "S"), w), cella(lista(x.swot.w, "W"), LARGHEZZA_UTILE - w)] }),
        new TableRow({ children: [cella("Opportunità", w, true), cella("Minacce", LARGHEZZA_UTILE - w, true)] }),
        new TableRow({ children: [cella(lista(x.swot.o, "O"), w), cella(lista(x.swot.t, "T"), LARGHEZZA_UTILE - w)] }),
      ],
    }));
    if (x.tows) {
      corpo.push(H3("Opzioni strategiche (TOWS)"));
      if (x.tows.sintesi) corpo.push(P(x.tows.sintesi));
      const righe = QUADRANTI_TOWS.flatMap(([q, l]) => (x.tows[q] || []).map((o) => [l.split(" · ")[0], o.testo, o.usa.join(", "), o.priorita]));
      if (righe.length) corpo.push(tabella(["Quadrante", "Opzione", "Elementi", "Priorità"], righe, [12, 60, 16, 12]));
    }
    corpo.push(H3("Coerenza fra strategia e ambiente"));
    const regole = x.coerenza.filter((r) => r.esito !== "non_valutabile" || !sintetica);
    if (regole.length) corpo.push(tabella(["Regola", "Esito", "Spiegazione"], regole.map((r) => [r.titolo, ESITI_COERENZA[r.esito][0], r.spiegazione]), [28, 14, 58]));
    else corpo.push(muto("Nessuna regola valutabile: mancano strategia, fase del ciclo o dati di confronto confermati."));
  });
  corpo.push(H2(sintetica ? "Promesse e credibilità del management" : `6.${unita.length + 1} Promesse e realtà`));
  if (p5.promesse) {
    if (p5.previsioni.length) corpo.push(tabella(["Previsione", "Metrica", "Anno", "Esito"], p5.previsioni.map((p) => [[TC(p.testo), ...cita(p.evidenze)], METRICHE_PROMESSE[p.metrica]?.label, String(p.anno), `${ESITI_PROMESSA[p.esito]?.[0]} — ${p.dettaglio}`]), [36, 18, 8, 38]));
    if (!sintetica && p5.promesse.consensus?.length) {
      corpo.push(H3("Consensus e guidance"));
      corpo.push(tabella(["Metrica", "Anno", "Guidance", "Consensus", "Fonte"], p5.promesse.consensus.map((c) => [METRICHE_PROMESSE[c.metrica]?.label, String(c.anno), fmtNumero(c.valore_guidance, 1), fmtNumero(c.valore_consensus, 1), c.fonte || "—"]), [30, 10, 18, 18, 24]));
    }
  } else corpo.push(nonConfermata("Promesse e realtà (5C)"));
  const nar = p5.narrativa;
  corpo.push(P([T("Coerenza narrativa: ", { bold: true }), T(nar.indice === null ? "non misurata" : `${nar.indice}/100 su ${plurale(nar.verificabili, "voce verificabile", "voci verificabili")}.`)]));
  nar.smentite.forEach((v) => corpo.push(punto([T("Smentita dai numeri: ", { bold: true, color: "A3341F" }), T(v.testo)])));
  nar.segnali.forEach((s) => corpo.push(punto([T("Segnale: ", { bold: true }), T(s.testo)])));
  corpo.push(P([T("Credibilità del management: ", { bold: true }), T(cred.punteggio === null ? "non misurata." : `${cred.punteggio}/100.`)]));
  corpo.push(...commento("coerenza"));

  /* 7. Conclusioni e assumption */
  corpo.push(H1(sintetica ? "Conclusioni e assumption" : "7. Conclusioni e assumption"));
  if (sintesi?.asa?.length) {
    sintesi.asa.forEach((a) => corpo.push(H3(a.asa), P(a.testo || ""), P([T(`Attrattività ${a.attrattivita || "n.d."} · posizione ${a.posizione || "n.d."} · vantaggio ${a.sostenibilita_vantaggio || "n.d."}${a.durata_stimata ? ` (${a.durata_stimata})` : ""}`, { color: "69727D" })])));
  } else if (!sintesi) corpo.push(nonConfermata("Giudizio per ASA (6A)"));
  const ass = stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.assunzioni;
  const assunzioni = ass && ass.stato !== "proposto" ? ass.dati : null;
  const aff = affidabilitaAssunzioni(stato);
  corpo.push(H2(sintetica ? "Driver dei bilanci pro-forma" : "7.1 Driver dei bilanci pro-forma"));
  if (assunzioni) {
    corpo.push(tabella(["Driver", "Pessimistico", "Base", "Ottimistico", "Motivazione"], DRIVER_ASSUNZIONI.map((d) => {
      const x = assunzioni.driver[d.id] || {};
      const f = (v) => (v === null || v === undefined ? "—" : `${fmtNumero(v, 1)}${d.unita === "%" ? "%" : ` ${d.unita}`}`);
      return [d.label, f(x.pessimistico), f(x.base), f(x.ottimistico), x.motivazione || "—"];
    }), [22, 12, 10, 12, 44]));
    corpo.push(P([T("Affidabilità delle ipotesi: ", { bold: true }), T(`${aff.livello} — ${aff.motivi.join("; ")}.`)]));
    const pr = proiezioneScenari(stato, assunzioni);
    if (pr) {
      const righe = SCENARI.filter(([k]) => pr.scenari[k]).map(([k, l]) => [l, ...pr.scenari[k].map((x) => `${fmtNumero(x.ricavi / 1e6, 0)} / ${fmtNumero(x.risultato / 1e6, 0)}`)]);
      corpo.push(P([T(`Proiezione indicativa: ricavi / risultato operativo in milioni, partendo dai ricavi ${pr.ultimo} di ${fmtNumero(pr.ricavi0 / 1e6, 0)}.`, { color: "69727D" })]));
      corpo.push(tabella(["Scenario", ...Array.from({ length: ORIZZONTE_ANNI }, (_, i) => String(pr.ultimo + i + 1))], righe, [25, ...Array.from({ length: ORIZZONTE_ANNI }, () => 25)]));
    }
    if (assunzioni.ipotesi_chiave?.length) { corpo.push(H3("Ipotesi chiave")); assunzioni.ipotesi_chiave.forEach((t) => corpo.push(punto(t))); }
    if (assunzioni.rischi_scenario?.length) { corpo.push(H3("Che cosa porterebbe allo scenario pessimistico")); assunzioni.rischi_scenario.forEach((t) => corpo.push(punto(t))); }
  } else corpo.push(nonConfermata("Assumption (6B)"));
  corpo.push(H2(sintetica ? "Punteggio strategico" : "7.2 Punteggio strategico"));
  corpo.push(P([T(ps.punteggio === null ? "Punteggio non calcolabile: mancano sezioni confermate." : `${ps.punteggio}/100 — classe ${ps.classe.classe}, ${ps.classe.label.toLowerCase()}. Copertura ${Math.round(ps.copertura * 100)}%. Metodo ${ps.versione}, calcolato senza intelligenza artificiale sui soli giudizi confermati.`, { bold: true })]));
  corpo.push(tabella(["Pilastro", "Peso", "Punteggio", "Copertura", "Come si calcola"], ps.pilastri.map((x) => [x.label, `${x.peso}%`, x.valore === null ? "n.d." : String(x.valore), `${Math.round((x.copertura || 0) * 100)}%`, x.nota]), [24, 8, 11, 11, 46]));
  const confr = [schedaPunteggio(stato), ...(stato.confronto || []).filter((s) => s.id !== schedaPunteggio(stato).id)].sort((a, b) => (b.punteggio ?? -1) - (a.punteggio ?? -1));
  if (confr.length > 1) {
    corpo.push(H2(sintetica ? "Confronto di settore" : "7.3 Confronto di settore"));
    corpo.push(P([T(`Colonne: punteggio (Pt.), classe (Cl.), pilastri — ${PILASTRI.map((p) => `${p.label.slice(0, 4)}. ${p.label.toLowerCase()}`).join("; ")} — e copertura (Cop.).`, { color: "69727D", size: 16 })]));
    corpo.push(tabella(["#", "Società", "Pt.", "Cl.", ...PILASTRI.map((p) => `${p.label.slice(0, 4)}.`), "Cop."],
      confr.map((s, i) => [String(i + 1), `${s.societa}${s.ticker ? ` (${s.ticker})` : ""}`, s.punteggio === null ? "n.d." : String(s.punteggio), s.classe || "—", ...PILASTRI.map((p) => (s.pilastri?.[p.id]?.valore ?? "—").toString()), `${Math.round((s.copertura ?? 0) * 100)}%`]),
      [5, 25, 8, 6, 8, 8, 8, 8, 8, 8, 8]));
    avvisiConfronto(confr).forEach((a) => corpo.push(punto([T(a, { color: "8A6212" })])));
  }
  const daMonitorare = p5.previsioni.filter((p) => p.esito === "in_corso");
  if (daMonitorare.length) { corpo.push(H3("Previsioni del management da monitorare")); daMonitorare.forEach((p) => corpo.push(punto(`${p.testo} (${p.anno})`))); }
  corpo.push(...commento("conclusioni"));

  /* ---- allegati (solo versione completa) ---- */
  if (!sintetica) {
    corpo.push(H1("Allegato A — Registro delle evidenze"));
    corpo.push(P([T("Frammenti citati nella relazione, nel testo originale.", { color: "69727D" })]));
    if (citati.length) {
      corpo.push(tabella(["Documento", "Sezione / pagina", "Testo originale"], citati.map((id) => {
        const e = estrattoPerId[id], d = metaDoc[e.docId];
        return [`${d?.tipo || ""}${d?.anno ? ` ${d.anno}` : ""} — ${d?.nomeFile || ""}`, [e.sezione, e.pagina ? `p. ${e.pagina}` : null].filter(Boolean).join(" · ") || "—", e.testoOriginale];
      }), [24, 20, 56]));
    } else corpo.push(muto("Nessuna citazione."));
    const x = stato.xbrl.principale;
    corpo.push(H1("Allegato B — Serie XBRL della società"));
    if (x) {
      const anni = x.anni.slice(-6);
      corpo.push(tabella(["Voce (milioni)", ...anni.map(String)], RIGHE_TABELLA_XBRL.filter((k) => x.serie[k]).map((k) => [x.serie[k].label, ...anni.map((a) => (k === "dipendenti" ? fmtNumero(x.serie[k].valori[a]) : fmtMilioni(x.serie[k].valori[a], x.serie[k].unita)))]), [34, ...anni.map(() => 11)]));
      corpo.push(P([T(`Fonte: ${x.nomeFile}; principio ${x.principio}.`, { color: "69727D" })]));
    } else corpo.push(muto("Serie non caricate."));
    corpo.push(H1("Allegato C — Glossario"));
    [["ASA", "Area strategica d'affari: combinazione di prodotto, mercato e tecnologia analizzata come unità autonoma."],
      ["FCS", "Fattore critico di successo: risorsa o competenza che fa vincere in un'ASA."],
      ["PESTEL", "Analisi del macro-ambiente: politico-normativo, economico, socio-culturale, tecnologico, ambientale."],
      ["VRIO", "Test sulle risorse: valore, rarità, inimitabilità, organizzazione."],
      ["SWOT / TOWS", "Matrice di punti di forza, debolezza, opportunità e minacce; la TOWS ne deriva le opzioni strategiche."],
      ["BCG / GE", "Matrici di portafoglio: quota relativa e crescita del mercato (BCG); attrattività e posizione competitiva (GE)."],
      ["XBRL", "Formato strutturato con cui le società depositano i dati di bilancio presso la SEC."],
      ["Guidance", "Previsioni ufficiali del management sull'andamento futuro."]].forEach(([k, v]) => corpo.push(P([T(`${k}: `, { bold: true }), T(v)])));
  }

  const doc = new Document({
    creator: opzioni.analista || "Analisi Strategica",
    title: `Analisi strategica — ${nomeEntita(ent)}`,
    description: "Relazione generata dall'applicazione Analisi Strategica",
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: "Calibri", size: 32, bold: true, color: COLORE_TITOLI }, paragraph: { spacing: { before: 240, after: 160 } } },
        heading2: { run: { font: "Calibri", size: 26, bold: true, color: "14171C" }, paragraph: { spacing: { before: 240, after: 120 } } },
        heading3: { run: { font: "Calibri", size: 22, bold: true, color: "2F4B8F" }, paragraph: { spacing: { before: 180, after: 80 } } },
      },
    },
    numbering: { config: [{ reference: "punti", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    footnotes: note,
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(`Analisi strategica — ${nomeEntita(ent)}`, { size: 16, color: "69727D" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Pagina ", PageNumber.CURRENT, " di ", PageNumber.TOTAL_PAGES], size: 16, color: "69727D" })] })] }) },
      children: corpo.filter(Boolean),
    }],
  });
  const blob = await Packer.toBlob(doc);
  const nome = `Analisi_strategica_${(nomeEntita(ent) || "societa").replace(/[^A-Za-z0-9]+/g, "_")}_${sintetica ? "sintetica" : "completa"}_${new Date().toISOString().slice(0, 10)}.docx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { nome, note: nNota, citati: citati.length, byte: blob.size };
}

/* ==========================================================================
   [24] INTERFACCIA DELLA FASE 6
   ========================================================================== */

/** Stato di avanzamento di tutte le sezioni: dice che cosa entrerà nella relazione. */
function prontezzaRelazione(stato) {
  const righe = [];
  const conta = (sez) => (sez ? (sez.stato === "proposto" ? "proposta" : "confermata") : "assente");
  SEZIONI_FASE1.forEach((s) => righe.push({ fase: 1, nome: s.titolo, stato: conta(stato.fase1?.principale?.sezioni?.[s.id]) }));
  unitaDiAnalisi(stato).forEach((u) => {
    SEZIONI_FASE2.forEach((s) => righe.push({ fase: 2, nome: `${s.titolo} — ${u.nome}`, stato: conta(stato.fase2?.[u.chiave]?.sezioni?.[s.id]) }));
    SEZIONI_FASE3.filter((s) => s.livello === "asa").forEach((s) => righe.push({ fase: 3, nome: `${s.titolo} — ${u.nome}`, stato: conta(stato.fase3?.[u.chiave]?.sezioni?.[s.id]) }));
    righe.push({ fase: 5, nome: `5A · TOWS — ${u.nome}`, stato: conta(stato.fase5?.[u.chiave]?.sezioni?.tows) });
  });
  SEZIONI_FASE3.filter((s) => s.livello === "societa").forEach((s) => righe.push({ fase: 3, nome: s.titolo, stato: conta(stato.fase3?.[CHIAVE_SOCIETA]?.sezioni?.[s.id]) }));
  righe.push({ fase: 5, nome: "5C · Promesse e realtà", stato: conta(stato.fase5?.[CHIAVE_SOCIETA]?.sezioni?.promesse) });
  righe.push({ fase: 6, nome: "6A · Sintesi", stato: conta(stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.sintesi) });
  righe.push({ fase: 6, nome: "6B · Assumption", stato: conta(stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.assunzioni) });
  return righe;
}

function VistaFase6({ stato, dispatch }) {
  const [inCorso, setInCorso] = useState(null);
  const [esitoWord, setEsitoWord] = useState(null);
  const statoRef = useRef(stato);
  statoRef.current = stato;
  const quadro = useMemo(() => quadroGiudizio(stato), [stato]);
  const rif = useMemo(() => riferimentiDriver(stato), [stato]);
  const aff = useMemo(() => affidabilitaAssunzioni(stato), [stato]);
  const sint = stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.sintesi;
  const ass = stato.fase6?.[CHIAVE_SOCIETA]?.sezioni?.assunzioni;
  const proiezione = useMemo(() => (ass ? proiezioneScenari(stato, ass.dati) : null), [stato, ass]);
  const prontezza = useMemo(() => prontezzaRelazione(stato), [stato]);
  const rel = stato.opzioni?.relazione || { versione: "completa", analista: "", commenti: {} };
  const setRel = (patch) => dispatch({ tipo: "OPZIONI", patch: { relazione: { ...rel, ...patch } } });
  const indice = useMemo(() => ({}), []);

  const esegui = async (cosa) => {
    setInCorso(cosa);
    dispatch({ tipo: "PROGRESSO", elaborazione: { doc: "società", fase: cosa === "sintesi" ? "Fase 6 · sintesi finale" : "Fase 6 · assumption", blocco: 0, totale: 0 } });
    try {
      const r = cosa === "sintesi" ? await generaSintesi(statoRef.current) : await generaAssunzioni(statoRef.current);
      dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase6", chiave: CHIAVE_SOCIETA, sezioneId: cosa, risultato: r, meta: { nome: "società" } });
      dispatch({ tipo: "LOG", livello: "ok", testo: `Fase 6: ${cosa === "sintesi" ? "sintesi finale" : "assumption in tre scenari"} proposta. Da confermare.` });
    } catch (err) {
      dispatch({ tipo: "LOG", livello: "errore", testo: `Fase 6: ${err.message}` });
    } finally {
      dispatch({ tipo: "FINE_ELABORAZIONE" });
      setInCorso(null);
    }
  };
  const daStorico = () => {
    dispatch({ tipo: "SEZ_RISULTATO", ramo: "fase6", chiave: CHIAVE_SOCIETA, sezioneId: "assunzioni", meta: { nome: "società" },
      risultato: { dati: scenariStorici(stato), generatoIl: new Date().toISOString(), modello: "calcolo dallo storico", estrattiForniti: 0, evidenzeUsate: 0 } });
    dispatch({ tipo: "LOG", livello: "ok", testo: "Fase 6: scenari calcolati dalla media storica, senza IA. Da confermare." });
  };
  const generaWord = async () => {
    setInCorso("word");
    setEsitoWord(null);
    try {
      const r = await generaRelazioneWord(statoRef.current, rel);
      setEsitoWord({ ok: true, testo: `Relazione scaricata: ${r.nome} (${fmtNumero(r.byte / 1024, 0)} KB, ${plurale(r.note, "nota", "note")}, ${plurale(r.citati, "estratto citato", "estratti citati")}). All'apertura Word aggiorna il sommario.` });
      dispatch({ tipo: "LOG", livello: "ok", testo: `Relazione Word generata: ${r.nome}.` });
    } catch (err) {
      setEsitoWord({ ok: false, testo: `Generazione non riuscita: ${err.message}.` });
      dispatch({ tipo: "LOG", livello: "errore", testo: `Relazione Word: ${err.message}` });
    } finally { setInCorso(null); }
  };
  const pulsantiStato = (sez, id) => sez && (sez.stato !== "confermato"
    ? <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase6", chiave: CHIAVE_SOCIETA, sezioneId: id, stato: "confermato" })} className="st-btn flex items-center gap-1 rounded px-2.5 py-1 text-xs" style={{ background: C.ok, color: "#fff" }}><Check size={12} /> Conferma</button>
    : <button onClick={() => dispatch({ tipo: "SEZ_STATO", ramo: "fase6", chiave: CHIAVE_SOCIETA, sezioneId: id, stato: "proposto" })} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, color: C.muto }}>Riapri</button>);
  const statoPill = (sez) => (sez ? <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: STATO_SEZIONE[sez.stato].sfondo, color: STATO_SEZIONE[sez.stato].colore }}>{STATO_SEZIONE[sez.stato].label}</span> : null);
  const mod = (sezioneId) => (percorso, valore) => dispatch({ tipo: "SEZ_MODIFICA", ramo: "fase6", chiave: CHIAVE_SOCIETA, sezioneId, percorso, valore });
  const confermate = prontezza.filter((r) => r.stato === "confermata").length;

  return (
    <>
      <div className="border-b" style={{ borderColor: C.rigaTenue, background: C.carta }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
          <span className="st-eyebrow" style={{ color: C.muto }}>Fase 6 · Sintesi e relazione</span>
          <span className="text-xs" style={{ color: C.muto }}>{confermate} / {prontezza.length} sezioni confermate in tutta l'analisi</span>
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<Target size={14} />} titolo="6A · Giudizio finale" colore={C.annuale}
              nota="Il quadro è calcolato dal sistema dai giudizi confermati; la sintesi scritta dall'IA lo commenta e non può contraddire gli esiti delle verifiche."
              badge={statoPill(sint)} />
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={{ background: C.fondo }}>{["ASA", "Attrattività", "Ciclo", "Posizione", "Strategia", "Vantaggio", "GE", "Incoerenze"].map((h) => <th key={h} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {quadro.map((q) => (
                      <tr key={q.unita.chiave} className="border-t" style={{ borderColor: C.rigaTenue }}>
                        <td className="px-2 py-1"><b>{q.unita.nome}</b>{q.unita.peso ? <span style={{ color: C.muto }}> · {fmtNumero(q.unita.peso, 0)}%</span> : null}</td>
                        <td className="px-2 py-1" style={{ fontFamily: F.mono }}>{q.attrattivita === null ? "—" : `${q.attrattivita}/100`}</td>
                        <td className="px-2 py-1">{FASI_CICLO.find(([k]) => k === q.ciclo)?.[1] || "—"}</td>
                        <td className="px-2 py-1" style={{ fontFamily: F.mono }}>{q.posizione ? `${q.posizione}/5` : "—"}</td>
                        <td className="px-2 py-1">{q.strategia || "—"}</td>
                        <td className="px-2 py-1">{q.sostenibilita || "—"}</td>
                        <td className="px-2 py-1">{q.ge || "—"}</td>
                        <td className="px-2 py-1" style={{ color: q.incoerenti.length ? C.allarme : C.muto }}>{q.incoerenti.length || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="st-eyebrow" style={{ color: C.muto }}>Sintesi scritta</span>
                <span className="ml-auto flex gap-2">
                  <button onClick={() => esegui("sintesi")} disabled={!!inCorso} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, opacity: inCorso ? 0.5 : 1 }}>
                    <RefreshCw size={12} className={inCorso === "sintesi" ? "animate-spin" : ""} /> {inCorso === "sintesi" ? "in corso…" : sint ? "Rigenera" : "Genera"}
                  </button>
                  {pulsantiStato(sint, "sintesi")}
                </span>
              </div>
              {sint && (
                <div className="mt-2">
                  <Voce etichetta="Giudizio complessivo" nodo={sint.dati.giudizio_complessivo} percorso={["giudizio_complessivo"]} onModifica={mod("sintesi")} indice={indice} />
                  {(sint.dati.asa || []).map((a, i) => (
                    <Voce key={i} etichetta={a.asa} nodo={a} percorso={["asa", i]} onModifica={mod("sintesi")} indice={indice}
                      extra={<>{a.attrattivita && <Pillola>attrattività {a.attrattivita}</Pillola>}{a.posizione && <Pillola>posizione {a.posizione}</Pillola>}{a.sostenibilita_vantaggio && <Pillola>vantaggio {a.sostenibilita_vantaggio}{a.durata_stimata ? ` · ${a.durata_stimata}` : ""}</Pillola>}</>} />
                  ))}
                  {(sint.dati.punti_chiave || []).length > 0 && <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}><div className="st-eyebrow" style={{ color: C.muto }}>Punti chiave</div>{sint.dati.punti_chiave.map((p, i) => <Voce key={i} nodo={p} percorso={["punti_chiave", i]} onModifica={mod("sintesi")} indice={indice} />)}</div>}
                  {(sint.dati.segnali_allarme || []).length > 0 && <div className="py-1.5 border-t" style={{ borderColor: C.rigaTenue }}><div className="st-eyebrow" style={{ color: C.allarme }}>Segnali d'allarme</div>{sint.dati.segnali_allarme.map((p, i) => <Voce key={i} nodo={p} percorso={["segnali_allarme", i]} onModifica={mod("sintesi")} indice={indice} />)}</div>}
                </div>
              )}
            </div>
          </Scheda>

          <Scheda>
            <Intestazione icona={<BarChart3 size={14} />} titolo="6B · Assumption per i bilanci pro-forma" colore={C.annuale}
              nota="I driver dei bilanci futuri in tre scenari, come media annua sui prossimi tre esercizi. Ogni valore va motivato con una causa strategica (§3.1): la proposta parte dai riferimenti numerici qui sotto. I valori si correggono dalla tabella."
              badge={statoPill(ass)} />
            <div className="px-4 pb-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={{ background: C.fondo }}>{["Driver", "Storico (3 anni)", "Guidance", "Consensus", "Mercato (F2)"].map((h) => <th key={h} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {DRIVER_ASSUNZIONI.map((d) => (
                      <tr key={d.id} className="border-t" style={{ borderColor: C.rigaTenue }}>
                        <td className="px-2 py-1">{d.label}</td>
                        {["storico", "guidance", "consensus", "mercato"].map((k) => <td key={k} className="px-2 py-1" style={{ fontFamily: F.mono }}>{rif[d.id][k] === null ? "—" : `${fmtNumero(rif[d.id][k], 1)}${d.unita === "%" ? "%" : ` ${d.unita}`}`}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded px-2 py-0.5 st-eyebrow" style={{ background: aff.livello === "alta" ? C.okTenue : aff.livello === "media" ? C.ambraTenue : C.allarmeTenue, color: aff.livello === "alta" ? C.ok : aff.livello === "media" ? C.ambra : C.allarme }}>affidabilità {aff.livello}</span>
                <span className="text-xs flex-1 min-w-[200px]" style={{ color: C.muto }}>{aff.motivi.join("; ")}.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={daStorico} disabled={!!inCorso} className="st-btn rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga }}>Calcola dallo storico (senza IA)</button>
                <button onClick={() => esegui("assunzioni")} disabled={!!inCorso} className="st-btn flex items-center gap-1 rounded border px-2.5 py-1 text-xs" style={{ borderColor: C.riga, opacity: inCorso ? 0.5 : 1 }}>
                  <RefreshCw size={12} className={inCorso === "assunzioni" ? "animate-spin" : ""} /> {inCorso === "assunzioni" ? "in corso…" : "Proponi con l'IA"}
                </button>
                <span className="ml-auto">{pulsantiStato(ass, "assunzioni")}</span>
              </div>
              {ass && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr style={{ background: C.fondo }}><th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Driver</th>{SCENARI.map(([k, l, col]) => <th key={k} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: col }}>{l}</th>)}<th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Motivazione</th></tr></thead>
                      <tbody>
                        {DRIVER_ASSUNZIONI.map((d) => {
                          const x = ass.dati.driver?.[d.id] || {};
                          return (
                            <tr key={d.id} className="border-t align-top" style={{ borderColor: C.rigaTenue }}>
                              <td className="px-2 py-1.5">{d.label}</td>
                              {SCENARI.map(([k]) => (
                                <td key={k} className="px-2 py-1.5">
                                  <input type="number" step="0.1" value={x[k] ?? ""} onChange={(e) => mod("assunzioni")(["driver", d.id, k], e.target.value === "" ? null : Number(e.target.value))}
                                    className="w-20 rounded border px-1 py-0.5" style={selStile} aria-label={`${d.label} ${k}`} /> <span style={{ color: C.muto }}>{d.unita}</span>
                                </td>
                              ))}
                              <td className="px-2 py-1.5" style={{ color: C.muto }}>{x.motivazione || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {proiezione && (
                    <div className="overflow-x-auto">
                      <div className="st-eyebrow mb-1" style={{ color: C.muto }}>Proiezione indicativa · ricavi / risultato operativo (milioni), base {proiezione.ultimo}: {fmtNumero(proiezione.ricavi0 / 1e6, 0)}</div>
                      <table className="w-full text-xs">
                        <thead><tr style={{ background: C.fondo }}><th className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }}>Scenario</th>{Array.from({ length: ORIZZONTE_ANNI }, (_, i) => <th key={i} className="text-right px-2 py-1.5" style={{ fontFamily: F.mono, color: C.muto }}>{proiezione.ultimo + i + 1}</th>)}</tr></thead>
                        <tbody>
                          {SCENARI.filter(([k]) => proiezione.scenari[k]).map(([k, l, col]) => (
                            <tr key={k} className="border-t" style={{ borderColor: C.rigaTenue }}>
                              <td className="px-2 py-1" style={{ color: col }}>{l}</td>
                              {proiezione.scenari[k].map((x) => <td key={x.anno} className="text-right px-2 py-1" style={{ fontFamily: F.mono }}>{fmtNumero(x.ricavi / 1e6, 0)} / {fmtNumero(x.risultato / 1e6, 0)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(ass.dati.ipotesi_chiave || []).length > 0 && <div><div className="st-eyebrow" style={{ color: C.muto }}>Ipotesi chiave</div><ul className="list-disc pl-5 text-xs">{ass.dati.ipotesi_chiave.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                  {(ass.dati.rischi_scenario || []).length > 0 && <div><div className="st-eyebrow" style={{ color: C.muto }}>Che cosa porterebbe allo scenario pessimistico</div><ul className="list-disc pl-5 text-xs">{ass.dati.rischi_scenario.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                </>
              )}
            </div>
          </Scheda>

          <PannelloPunteggio stato={stato} />
          <PannelloConfronto stato={stato} dispatch={dispatch} />

          <Scheda>
            <Intestazione icona={<FileOutput size={14} />} titolo="6C · Relazione Word" colore={C.annuale}
              nota="Il documento .docx si genera nel browser: frontespizio, sommario, executive summary, sette capitoli, allegati. Le citazioni sono note a piè di pagina; entrano solo le sezioni confermate. La versione sintetica tiene sintesi, verifiche, SWOT, coerenza, credibilità e conclusioni." />
            <div className="px-4 pb-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-md overflow-hidden border" style={{ borderColor: C.riga }}>
                  {[["completa", "Completa"], ["sintetica", "Sintetica"]].map(([k, l]) => (
                    <button key={k} onClick={() => setRel({ versione: k })} className="st-btn px-3 py-1.5 text-sm border-r last:border-r-0"
                      style={{ borderColor: C.riga, background: rel.versione === k ? C.inchiostro : C.carta, color: rel.versione === k ? "#fff" : C.muto }}>{l}</button>
                  ))}
                </div>
                <input defaultValue={rel.analista} key={rel.analista} onBlur={(e) => e.target.value !== rel.analista && setRel({ analista: e.target.value.trim() })} placeholder="Nome dell'analista (frontespizio)"
                  className="flex-1 min-w-[200px] rounded border px-2 py-1.5 text-sm" style={{ borderColor: C.riga }} />
              </div>
              <details>
                <summary className="cursor-pointer text-sm" style={{ color: C.periodico }}>Commenti dell'analista per capitolo ({Object.values(rel.commenti || {}).filter((t) => t && t.trim()).length})</summary>
                <div className="mt-2 space-y-2">
                  {CAPITOLI_RELAZIONE.map(([k, l]) => (
                    <label key={k} className="block">
                      <span className="st-eyebrow" style={{ color: C.muto }}>{l}</span>
                      <textarea defaultValue={rel.commenti?.[k] || ""} key={`${k}-${rel.commenti?.[k] || ""}`} rows={2}
                        onBlur={(e) => e.target.value !== (rel.commenti?.[k] || "") && setRel({ commenti: { ...(rel.commenti || {}), [k]: e.target.value } })}
                        className="w-full rounded border p-2 text-sm" style={{ borderColor: C.riga }} placeholder="Commento che comparirà in fondo al capitolo" />
                    </label>
                  ))}
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={generaWord} disabled={!!inCorso} className="st-btn flex items-center gap-2 rounded-md px-4 py-2 text-sm" style={{ background: C.annuale, color: "#fff", opacity: inCorso ? 0.6 : 1 }}>
                  <FileOutput size={14} /> {inCorso === "word" ? "Generazione…" : `Genera relazione Word (${rel.versione})`}
                </button>
                <span className="text-xs" style={{ color: C.muto }}>{confermate} di {prontezza.length} sezioni confermate entreranno nel documento.</span>
              </div>
              {esitoWord && <p className="text-sm rounded-md px-3 py-2" style={{ overflowWrap: "anywhere", background: esitoWord.ok ? C.okTenue : C.allarmeTenue, color: esitoWord.ok ? C.ok : C.allarme }}>{esitoWord.testo}</p>}
            </div>
          </Scheda>
        </div>
        <aside className="space-y-6 min-w-0">
          <Scheda>
            <Intestazione icona={<Check size={14} />} titolo="Che cosa entra nella relazione" nota="Le sezioni proposte ma non confermate compaiono nel documento come «non confermate»." />
            <ul className="px-4 pb-4 space-y-1 max-h-96 overflow-y-auto st-scroll">
              {prontezza.map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.stato === "confermata" ? C.ok : r.stato === "proposta" ? C.ambra : C.riga }} />
                  <span className="flex-1">{r.nome}</span>
                  <span style={{ color: C.muto }}>{r.stato}</span>
                </li>
              ))}
            </ul>
          </Scheda>
          <FeedAttivita attivita={stato.attivita} elaborazione={stato.elaborazione} onInterrompi={() => {}} />
        </aside>
      </main>
    </>
  );
}

/* ==========================================================================
   [25] PUNTEGGIO STRATEGICO E CONFRONTO DI SETTORE
   --------------------------------------------------------------------------
   Un numero da 0 a 100 per confrontare aziende dello stesso settore. Perché il
   confronto abbia senso il punteggio è:
     · deterministico  → nessuna IA nel calcolo: stessi giudizi confermati, stesso numero;
     · versionato      → la versione del metodo viaggia con la scheda; versioni
                         diverse non si confrontano senza avviso;
     · scomposto       → sei pilastri con peso dichiarato, ognuno con le sue componenti;
     · con copertura   → se mancano dati, il pilastro esce dal calcolo, i pesi si
                         ridistribuiscono e la copertura lo dice: un 80 con copertura
                         40% non vale un 80 con copertura 95%.
   Usa solo sezioni confermate dall'operatore. Le soglie assolute (margini,
   crescita, leva) sono uguali per tutte le aziende: per questo il confronto
   è significativo fra aziende dello STESSO settore, non fra settori diversi.
   ========================================================================== */

const VERSIONE_METODO_PUNTEGGIO = "PS-1.0";

const PILASTRI = [
  { id: "attrattivita", label: "Attrattività dell'ambiente", peso: 20, fase: "Fase 2",
    nota: "Cinque forze (50%), fase del ciclo di vita (25%), saldo fra opportunità e minacce pesate per probabilità e impatto (25%); media delle ASA pesata sui ricavi." },
  { id: "posizione", label: "Posizione competitiva", peso: 20, fase: "Fasi 3-4",
    nota: "Posizione competitiva delle ASA in 3A (40%) e quota di indicatori chiave migliori della mediana dei peer (60%)." },
  { id: "sostenibilita", label: "Sostenibilità del vantaggio", peso: 20, fase: "Fase 3",
    nota: "Risorse con vantaggio sostenibile o temporaneo al test VRIO (50%) e copertura dei fattori critici di successo (50%)." },
  { id: "solidita", label: "Solidità economico-finanziaria", peso: 15, fase: "Fase 4",
    nota: "Margine operativo, crescita dei ricavi, conversione dell'utile in cassa e leva, su scale assolute uguali per tutte le aziende." },
  { id: "coerenza", label: "Coerenza strategica", peso: 10, fase: "Fase 5",
    nota: "Quota di regole di coerenza rispettate (attenzione vale metà) fra quelle valutabili, media delle ASA." },
  { id: "credibilita", label: "Credibilità e governance", peso: 15, fase: "Fasi 3-5",
    nota: "Punteggio di credibilità del management (70%) e valutazioni della governance in 3E (30%)." },
];

const CLASSI_PUNTEGGIO = [
  { min: 75, classe: "A", label: "Profilo strategico forte", colore: C.ok },
  { min: 60, classe: "B", label: "Profilo solido", colore: C.periodico },
  { min: 45, classe: "C", label: "Profilo intermedio", colore: C.ambra },
  { min: 0, classe: "D", label: "Profilo debole", colore: C.allarme },
];
const classeDi = (p) => (p === null || p === undefined ? null : CLASSI_PUNTEGGIO.find((c) => p >= c.min));
const COPERTURA_MINIMA = 0.6;

const limita100 = (x) => Math.max(0, Math.min(100, x));
/** Scala lineare: valore `zero` → 0 punti, valore `cento` → 100 punti (funziona anche invertita). */
const scala = (v, zero, cento) => (v === null || v === undefined || !isFinite(v) ? null : limita100(((v - zero) / (cento - zero)) * 100));
/** Media pesata che ignora i valori mancanti; restituisce anche la quota di peso coperta. */
function mediaPesata(voci) {
  const valide = voci.filter((x) => x.v !== null && x.v !== undefined && isFinite(x.v) && x.w > 0);
  const totale = voci.reduce((t, x) => t + (x.w > 0 ? x.w : 0), 0);
  if (!valide.length) return { valore: null, copertura: 0 };
  const w = valide.reduce((t, x) => t + x.w, 0);
  return { valore: valide.reduce((t, x) => t + x.v * x.w, 0) / w, copertura: totale ? w / totale : 0 };
}
const PUNTI_CICLO = { introduzione: 60, sviluppo: 80, maturita: 50, declino: 20 };

function calcolaPunteggioStrategico(stato) {
  const unita = unitaDiAnalisi(stato);
  const pesoAsa = (u) => (u.peso && u.peso > 0 ? u.peso : 1);
  const perAsa = (fn) => {
    const voci = unita.map((u) => ({ ...fn(u), w: pesoAsa(u) }));
    const m = mediaPesata(voci.map((x) => ({ v: x.v, w: x.w })));
    const pesoTot = voci.reduce((t, x) => t + x.w, 0);
    const copertura = pesoTot ? voci.reduce((t, x) => t + x.w * (x.v === null || x.v === undefined ? 0 : x.cop ?? 1), 0) / pesoTot : 0;
    return { valore: m.valore, copertura };
  };

  /* 1. Attrattività */
  const attr = perAsa((u) => {
    const p2 = profiloFase2(stato, u.chiave);
    const forze = p2?.attrattivita?.indice ?? null;
    const ciclo = PUNTI_CICLO[p2?.ciclo?.fase_settore?.fase] ?? null;
    let saldo = null;
    if (p2?.om) {
      const peso = (l) => (l || []).reduce((t, x) => t + (x.probabilita || 0) * (x.impatto || 0), 0);
      const o = peso(p2.om.opportunita), t = peso(p2.om.minacce);
      saldo = o + t > 0 ? 50 + 50 * ((o - t) / (o + t)) : null;
    }
    const m = mediaPesata([{ v: forze, w: 50 }, { v: ciclo, w: 25 }, { v: saldo, w: 25 }]);
    return { v: m.valore, cop: m.copertura, dettaglio: { forze, ciclo, saldo } };
  });

  /* 2. Posizione competitiva */
  const corporate = profiloFase3(stato, CHIAVE_SOCIETA).corporate;
  const posizioneAsa = perAsa((u) => {
    const p = (corporate?.portafoglio || []).find((x) => normalizzaNome(x.asa) === normalizzaNome(u.nome));
    return { v: p?.posizione_competitiva ? ((p.posizione_competitiva - 1) / 4) * 100 : null };
  });
  const quadro = quadroKpi(stato);
  const CHIAVE_KPI_POSIZIONE = ["margine_lordo", "margine_operativo", "crescita_ricavi", "rs_ricavi", "cfo_ricavi", "roe"];
  const confrontabili = quadro.righe.filter((r) => CHIAVE_KPI_POSIZIONE.includes(r.kpi.id) && r.migliore !== null);
  const quotaMigliori = confrontabili.length ? (confrontabili.filter((r) => r.migliore).length / confrontabili.length) * 100 : null;
  const pos = mediaPesata([{ v: posizioneAsa.valore, w: 40 }, { v: quotaMigliori, w: 60 }]);

  /* 3. Sostenibilità del vantaggio */
  const sost = perAsa((u) => {
    const p3 = profiloFase3(stato, u.chiave);
    if (!p3.risorse) return { v: null };
    const ris = p3.risorse.risorse || [];
    const vrio = Math.min(100, ris.filter((r) => esitoVrio(r.vrio) === "sostenibile").length * 40 + ris.filter((r) => ["temporaneo", "non_sfruttato"].includes(esitoVrio(r.vrio))).length * 15);
    const valoreFcs = { presidiato: 1, parziale: 0.6, debole: 0.2, scoperto: 0 };
    const fcs = p3.coperturaFcs.length ? (p3.coperturaFcs.reduce((t, c) => t + valoreFcs[c.esito], 0) / p3.coperturaFcs.length) * 100 : null;
    const m = mediaPesata([{ v: vrio, w: 50 }, { v: fcs, w: 50 }]);
    return { v: m.valore, cop: m.copertura };
  });

  /* 4. Solidità economico-finanziaria (scale assolute) */
  const riga = (id) => quadro.righe.find((r) => r.kpi.id === id)?.valore?.valore ?? null;
  const soc = serieKpi(stato.xbrl.principale);
  const crescitaMedia = (() => {
    const v = Object.entries(soc?.kpi?.crescita_ricavi || {}).sort((a, b) => a[0] - b[0]).slice(-3).map(([, x]) => x);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();
  const componentiSolidita = [
    { label: "Margine operativo", v: scala(riga("margine_operativo"), 0, 20), dato: riga("margine_operativo"), formato: "%" , scala: "0% → 0 · 20% → 100" },
    { label: "Crescita media dei ricavi (3 anni)", v: scala(crescitaMedia, -5, 15), dato: crescitaMedia, formato: "%", scala: "-5% → 0 · 15% → 100" },
    { label: "Flusso operativo / utile netto", v: scala(riga("cfo_utile"), 0.5, 1.2), dato: riga("cfo_utile"), formato: "x", scala: "0,5x → 0 · 1,2x → 100" },
    { label: "Debiti a lungo / patrimonio netto", v: scala(riga("leva"), 2, 0), dato: riga("leva"), formato: "x", scala: "2x → 0 · 0x → 100" },
  ];
  const sol = mediaPesata(componentiSolidita.map((c) => ({ v: c.v, w: 1 })));

  /* 5. Coerenza strategica */
  const coer = perAsa((u) => {
    const regole = valutaCoerenza(stato, u).filter((r) => r.esito !== "non_valutabile");
    if (!regole.length) return { v: null };
    const punti = { coerente: 1, attenzione: 0.5, incoerente: 0 };
    return { v: (regole.reduce((t, r) => t + punti[r.esito], 0) / regole.length) * 100 };
  });

  /* 6. Credibilità e governance */
  const cred = credibilitaManagement(stato).punteggio;
  const gov = profiloFase3(stato, CHIAVE_SOCIETA).governance;
  const valGov = { positiva: 100, neutra: 50, negativa: 0 };
  const voti = gov ? ["board", "vertice", "incentivi", "qualita_management"].map((k) => valGov[gov[k]?.valutazione]).filter((x) => x !== undefined) : [];
  const governance = voti.length ? voti.reduce((a, b) => a + b, 0) / voti.length : null;
  const credGov = mediaPesata([{ v: cred, w: 70 }, { v: governance, w: 30 }]);

  const risultati = {
    attrattivita: { valore: attr.valore, copertura: attr.copertura, componenti: [] },
    posizione: { valore: pos.valore, copertura: pos.copertura, componenti: [
      { label: "Posizione competitiva delle ASA (3A)", v: posizioneAsa.valore },
      { label: `Indicatori migliori della mediana dei peer (${confrontabili.filter((r) => r.migliore).length} su ${confrontabili.length})`, v: quotaMigliori },
    ] },
    sostenibilita: { valore: sost.valore, copertura: sost.copertura, componenti: [] },
    solidita: { valore: sol.valore, copertura: sol.copertura, componenti: componentiSolidita.map((c) => ({ label: `${c.label}: ${c.dato === null ? "n.d." : c.formato === "%" ? `${fmtNumero(c.dato, 1)}%` : `${fmtNumero(c.dato, 2)}x`} (${c.scala})`, v: c.v })) },
    coerenza: { valore: coer.valore, copertura: coer.copertura, componenti: [] },
    credibilita: { valore: credGov.valore, copertura: credGov.copertura, componenti: [
      { label: "Credibilità del management (5C-5D)", v: cred }, { label: "Valutazioni della governance (3E)", v: governance },
    ] },
  };
  const pilastri = PILASTRI.map((p) => ({ ...p, ...risultati[p.id], valore: risultati[p.id].valore === null ? null : Math.round(risultati[p.id].valore) }));
  const tot = mediaPesata(pilastri.map((p) => ({ v: p.valore, w: p.peso })));
  const copertura = pilastri.reduce((t, p) => t + p.peso * (p.valore === null ? 0 : p.copertura), 0) / 100;
  const punteggio = tot.valore === null ? null : Math.round(tot.valore);
  return { versione: VERSIONE_METODO_PUNTEGGIO, punteggio, classe: classeDi(punteggio), copertura, affidabile: copertura >= COPERTURA_MINIMA, pilastri };
}

/** Scheda esportabile: tutto ciò che serve per confrontare, niente di più. */
function schedaPunteggio(stato) {
  const ent = stato.entita.find((e) => e.id === "principale");
  const p = calcolaPunteggioStrategico(stato);
  const q = quadroKpi(stato);
  const kpi = Object.fromEntries(["crescita_ricavi", "margine_lordo", "margine_operativo", "rs_ricavi", "cfo_ricavi", "roe"].map((id) => [id, q.righe.find((r) => r.kpi.id === id)?.valore?.valore ?? null]));
  return {
    tipo: "scheda-punteggio-strategico",
    versioneMetodo: p.versione,
    id: `${normalizzaNome(ent.nome) || "societa"}-${ent.cik || ent.ticker || "x"}`,
    societa: ent.nome || "Società senza nome", ticker: ent.ticker || null, cik: ent.cik || null,
    settore: ent.settore || null, sic: ent.sic || null,
    esercizio: stato.xbrl.principale?.anni?.slice(-1)[0] || null,
    data: new Date().toISOString(),
    punteggio: p.punteggio, classe: p.classe?.classe || null, copertura: Math.round(p.copertura * 100) / 100,
    pilastri: Object.fromEntries(p.pilastri.map((x) => [x.id, { valore: x.valore, copertura: Math.round((x.copertura || 0) * 100) / 100, peso: x.peso }])),
    kpi,
    attrattivitaPerAsa: unitaDiAnalisi(stato).map((u) => ({ asa: u.nome, peso: u.peso ?? null, attrattivita: profiloFase2(stato, u.chiave)?.attrattivita?.indice ?? null })),
  };
}

/** Legge una scheda di confronto: scheda esportata oppure salvataggio completo di un'analisi. */
function leggiSchedaConfronto(obj) {
  if (obj?.tipo === "scheda-punteggio-strategico" && obj.pilastri) { const { corrente, ...resto } = obj; return resto; }
  if (obj?.stato && obj.formatoSalvataggio) {
    const { stato } = interpretaSalvataggio(obj);
    return { ...schedaPunteggio({ ...statoIniziale, ...stato }), origine: "salvataggio completo" };
  }
  throw new Error("non è una scheda di punteggio né un salvataggio di questa applicazione");
}

/** Avvisi di comparabilità fra la scheda corrente e quelle caricate. */
function avvisiConfronto(schede) {
  const avvisi = [];
  const versioni = new Set(schede.map((s) => s.versioneMetodo));
  if (versioni.size > 1) avvisi.push(`Versioni del metodo diverse (${[...versioni].join(", ")}): i punteggi non sono pienamente confrontabili.`);
  const settori = new Set(schede.map((s) => (s.sic ? `SIC ${s.sic}` : s.settore ? normalizzaNome(s.settore) : null)).filter(Boolean));
  if (settori.size > 1) avvisi.push(`Settori dichiarati diversi (${[...settori].join(" · ")}): le soglie assolute di solidità e il confronto con i peer hanno senso solo dentro lo stesso settore.`);
  const senza = schede.filter((s) => !s.sic && !s.settore);
  if (settori.size && senza.length) avvisi.push(`Settore non indicato per ${senza.map((s) => s.societa).join(", ")}: verifica che appartenga allo stesso settore.`);
  const poco = schede.filter((s) => (s.copertura ?? 0) < COPERTURA_MINIMA);
  if (poco.length) avvisi.push(`Copertura sotto il ${COPERTURA_MINIMA * 100}% per ${poco.map((s) => s.societa).join(", ")}: punteggio poco affidabile.`);
  const esercizi = new Set(schede.map((s) => s.esercizio).filter(Boolean));
  if (esercizi.size > 1) avvisi.push(`Esercizi di riferimento diversi (${[...esercizi].sort().join(", ")}).`);
  return avvisi;
}

/* --- Interfaccia: 6D punteggio, 6E confronto --------------------------- */
function BarraPunteggio({ valore, larghezza = 120, titolo }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={titolo}>
      <span className="inline-block rounded-sm overflow-hidden" style={{ width: larghezza, height: 8, background: C.fondo }}>
        <span className="block h-full" style={{ width: `${valore ?? 0}%`, background: C.annuale, borderRadius: "0 4px 4px 0" }} />
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.inchiostro, minWidth: 24 }}>{valore ?? "—"}</span>
    </span>
  );
}

function PillolaClasse({ classe, breve = false }) {
  if (!classe) return <Pillola>n.d.</Pillola>;
  const c = typeof classe === "string" ? CLASSI_PUNTEGGIO.find((x) => x.classe === classe) : classe;
  return <span className="rounded px-1.5 py-0.5 st-eyebrow whitespace-nowrap" title={`${c.classe} · ${c.label}`} style={{ background: C.fondo, color: c.colore, border: `1px solid ${c.colore}` }}>{breve ? c.classe : `${c.classe} · ${c.label}`}</span>;
}

function PannelloPunteggio({ stato }) {
  const p = useMemo(() => calcolaPunteggioStrategico(stato), [stato]);
  const [aperto, setAperto] = useState(null);
  return (
    <Scheda>
      <Intestazione icona={<Target size={14} />} titolo="6D · Punteggio strategico" colore={C.annuale}
        nota={`Calcolato dal sistema, senza IA, con il metodo ${p.versione}: sei pilastri con pesi fissi, solo sezioni confermate. È confrontabile fra aziende dello stesso settore analizzate con la stessa versione del metodo.`} />
      <div className="px-4 pb-4">
        <div className="flex flex-wrap items-end gap-4 rounded-md p-3" style={{ background: C.fondo }}>
          <div>
            <div className="st-eyebrow" style={{ color: C.muto }}>Punteggio</div>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 40, lineHeight: 1, color: C.inchiostro }}>{p.punteggio ?? "—"}<span style={{ fontSize: 15, color: C.muto }}>/100</span></div>
          </div>
          <div className="space-y-1">
            <PillolaClasse classe={p.classe} />
            <div className="text-xs" style={{ color: p.affidabile ? C.muto : C.allarme }}>
              Copertura {Math.round(p.copertura * 100)}%{p.affidabile ? "" : ` — sotto il ${COPERTURA_MINIMA * 100}%: punteggio poco affidabile, completa e conferma le sezioni mancanti`}
            </div>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {p.pilastri.map((x) => (
            <li key={x.id} className="rounded-md border px-3 py-2" style={{ borderColor: C.rigaTenue }}>
              <button onClick={() => setAperto(aperto === x.id ? null : x.id)} className="w-full flex flex-wrap items-center gap-2 text-left">
                {aperto === x.id ? <ChevronDown size={13} style={{ color: C.muto }} /> : <ChevronRight size={13} style={{ color: C.muto }} />}
                <span className="text-sm flex-1 min-w-[160px]" style={{ fontWeight: 600 }}>{x.label}</span>
                <span className="st-eyebrow" style={{ color: C.muto }}>peso {x.peso}% · {x.fase} · copertura {Math.round((x.copertura || 0) * 100)}%</span>
                <BarraPunteggio valore={x.valore} titolo={`${x.label}: ${x.valore ?? "n.d."}/100`} />
              </button>
              {aperto === x.id && (
                <div className="mt-1.5 pl-5 text-xs space-y-1" style={{ color: C.muto }}>
                  <p>{x.nota}</p>
                  {x.componenti?.map((c, i) => <div key={i} className="flex flex-wrap items-center gap-2"><span className="flex-1 min-w-[160px]">{c.label}</span><BarraPunteggio valore={c.v === null ? null : Math.round(c.v)} larghezza={80} /></div>)}
                  {x.valore === null && <p style={{ color: C.allarme }}>Pilastro non calcolabile: escluso, il suo peso è ridistribuito sugli altri.</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs" style={{ color: C.muto }}>Classi: A ≥ 75 · B 60-74 · C 45-59 · D &lt; 45.</p>
      </div>
    </Scheda>
  );
}

function PannelloConfronto({ stato, dispatch }) {
  const inputRef = useRef(null);
  const [errore, setErrore] = useState(null);
  const corrente = useMemo(() => ({ ...schedaPunteggio(stato), corrente: true }), [stato]);
  const altre = (stato.confronto || []).filter((s) => s.id !== corrente.id);
  const schede = [corrente, ...altre].sort((a, b) => (b.punteggio ?? -1) - (a.punteggio ?? -1));
  const avvisi = avvisiConfronto(schede);

  const carica = async (files) => {
    setErrore(null);
    const nuove = [];
    for (const f of Array.from(files)) {
      try { nuove.push({ ...leggiSchedaConfronto(JSON.parse(await f.text())), nomeFile: f.name }); }
      catch (e) { setErrore(`${f.name}: ${e.message}.`); }
    }
    if (nuove.length) {
      dispatch({ tipo: "CONFRONTO_AGGIUNGI", schede: nuove });
      dispatch({ tipo: "LOG", livello: "ok", testo: `Confronto di settore: ${plurale(nuove.length, "scheda caricata", "schede caricate")} (${nuove.map((s) => s.societa).join(", ")}).` });
    }
  };
  const esportaScheda = () => scaricaJson((({ corrente: _c, ...r }) => r)(corrente), `punteggio_${(corrente.societa || "societa").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${new Date().toISOString().slice(0, 10)}.json`);
  const esportaCsv = () => {
    const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const righe = [["Posizione", "Società", "Ticker", "Settore", "Esercizio", "Punteggio", "Classe", "Copertura", ...PILASTRI.map((p) => p.label), "Versione metodo"].map(q).join(";"),
      ...schede.map((s, i) => [i + 1, s.societa, s.ticker, s.settore || s.sic, s.esercizio, s.punteggio, s.classe, Math.round((s.copertura ?? 0) * 100) + "%", ...PILASTRI.map((p) => s.pilastri?.[p.id]?.valore), s.versioneMetodo].map(q).join(";"))];
    const blob = new Blob(["﻿" + righe.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `confronto_settore_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Scheda>
      <Intestazione icona={<BarChart3 size={14} />} titolo="6E · Confronto di settore" colore={C.annuale}
        nota="Esporta la scheda del punteggio di questa analisi; carica le schede (o i salvataggi completi) delle altre aziende dello stesso settore. La classifica si aggiorna da sola; gli avvisi segnalano ciò che rende il confronto meno omogeneo." />
      <div className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={esportaScheda} className="st-btn flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm" style={{ borderColor: C.riga }}><Save size={13} style={{ color: C.annuale }} /> Esporta scheda di questa azienda</button>
          <button onClick={() => inputRef.current?.click()} className="st-btn flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm" style={{ borderColor: C.riga }}><FolderOpen size={13} style={{ color: C.periodico }} /> Carica schede o analisi salvate</button>
          <input ref={inputRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={(e) => { carica(e.target.files); e.target.value = ""; }} />
          {schede.length > 1 && <button onClick={esportaCsv} className="st-btn flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm" style={{ borderColor: C.riga }}><ArrowRight size={13} style={{ color: C.muto }} /> Confronto in CSV</button>}
        </div>
        {errore && <p className="text-xs" style={{ color: C.allarme }}>{errore}</p>}
        {avvisi.length > 0 && (
          <ul className="rounded-md p-2.5 space-y-1 text-xs" style={{ background: C.ambraTenue }}>
            {avvisi.map((a, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: C.ambra }} />{a}</li>)}
          </ul>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: C.fondo }}>
                {["#", "Società", "Punteggio", "Classe", ...PILASTRI.map((p) => p.label.split(" ")[0]), "Copertura", ""].map((h, i) => (
                  <th key={i} className="text-left px-2 py-1.5 st-eyebrow" style={{ color: C.muto }} title={PILASTRI.find((p) => p.label.startsWith(h))?.label}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schede.map((s, i) => (
                <tr key={s.id + i} className="border-t" style={{ borderColor: C.rigaTenue, background: s.corrente ? C.annualeTenue : "transparent" }}>
                  <td className="px-2 py-1.5" style={{ fontFamily: F.mono }}>{i + 1}</td>
                  <td className="px-2 py-1.5 min-w-[180px]"><b>{s.societa}</b>{s.ticker ? ` · ${s.ticker}` : ""}{s.corrente && <span style={{ color: C.annuale }}> · questa analisi</span>}<div style={{ color: C.muto }}>{[s.settore || (s.sic ? `SIC ${s.sic}` : null), s.esercizio ? `esercizio ${s.esercizio}` : null].filter(Boolean).join(" · ")}</div></td>
                  <td className="px-2 py-1.5"><BarraPunteggio valore={s.punteggio} larghezza={70} titolo={`${s.societa}: ${s.punteggio ?? "n.d."}/100`} /></td>
                  <td className="px-2 py-1.5"><PillolaClasse classe={s.classe} breve /></td>
                  {PILASTRI.map((p) => <td key={p.id} className="px-2 py-1.5" style={{ fontFamily: F.mono }} title={`${p.label}: ${s.pilastri?.[p.id]?.valore ?? "n.d."}`}>{s.pilastri?.[p.id]?.valore ?? "—"}</td>)}
                  <td className="px-2 py-1.5" style={{ fontFamily: F.mono, color: (s.copertura ?? 0) < COPERTURA_MINIMA ? C.allarme : C.inchiostro }}>{Math.round((s.copertura ?? 0) * 100)}%</td>
                  <td className="px-2 py-1.5">{!s.corrente && <button onClick={() => dispatch({ tipo: "CONFRONTO_RIMUOVI", id: s.id })} aria-label={`Togli ${s.societa}`}><X size={12} style={{ color: C.muto }} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {schede.length === 1 && <p className="text-xs" style={{ color: C.muto }}>Per confrontare, analizza le altre aziende del settore con questa app, esporta le loro schede (o salva le analisi) e caricale qui.</p>}
      </div>
    </Scheda>
  );
}

/* ==========================================================================
   [21] RICERCA WEB CON L'IA (Fase 0, aree volontaria · derivata · contesto · notizie)
   Quando l'operatore non trova fonti adatte, l'IA cerca sul web, propone le
   fonti con un estratto fedele dei passaggi utili e l'URL. Il sistema
   controlla che ogni URL compaia davvero fra i risultati della ricerca;
   l'operatore sceglie quali fonti tenere. Le fonti scelte diventano documenti
   testuali dell'area e passano per la stessa lettura dei file caricati, così
   alimentano le fasi successive con estratti citabili.
   ========================================================================== */

const MAX_FONTI_WEB = 6;
const MAX_RICERCHE_WEB = 8;
const MAX_LETTURE_WEB = 4;

/* --- Adattatori: un'unica forma di risposta per i tre fornitori ---------- */
const normalizzaUrl = (u) => {
  try { const x = new URL(String(u).trim()); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); }
  catch { return String(u || "").trim().toLowerCase(); }
};
const dominioDi = (u) => { try { return new URL(String(u).trim()).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

async function ricercaWebClaude({ system, testo, maxTokens, apiKey, model }) {
  const strumentiCompleti = [
    { type: "web_search_20250305", name: "web_search", max_uses: MAX_RICERCHE_WEB },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: MAX_LETTURE_WEB, citations: { enabled: true }, max_content_tokens: 30000 },
  ];
  const soloRicerca = [strumentiCompleti[0]];
  const risultati = [], citazioni = [];
  let messaggi = [{ role: "user", content: testo }];
  let strumenti = strumentiCompleti;
  let testoFinale = "";
  for (let giro = 0; giro < 6; giro++) {
    const headers = { ...headerClaude(apiKey), ...(strumenti.length > 1 ? { "anthropic-beta": "web-fetch-2025-09-10" } : {}) };
    let res;
    try {
      res = await fetch(CLAUDE_ENDPOINT, { method: "POST", headers, body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: messaggi, tools: strumenti }) });
    } catch (e) { throw erroreDiRete(e); }
    if (!res.ok) {
      const err = await erroreDaRisposta(res, "Claude");
      /* La lettura delle pagine è in beta: se l'account o il proxy non la
         accettano si ripiega sulla sola ricerca, senza perdere il giro. */
      if (strumenti.length > 1 && res.status === 400 && /web_fetch|beta|tool/i.test(err.message)) { strumenti = soloRicerca; giro--; continue; }
      if (res.status === 400 && /web_search|tool/i.test(err.message)) err.message += " — la ricerca web potrebbe non essere abilitata per l'organizzazione: va attivata nella Console Anthropic (impostazioni › privacy / strumenti).";
      throw err;
    }
    const data = await res.json();
    const blocchi = data.content || [];
    let dopoUltimaRicerca = [];
    for (const b of blocchi) {
      if (b.type === "web_search_tool_result") {
        if (Array.isArray(b.content)) b.content.forEach((r) => r.url && risultati.push({ url: r.url, titolo: r.title || "", data: r.page_age || null, via: "ricerca" }));
        else if (b.content?.error_code) {
          const err = new Error(`ricerca web non riuscita (${b.content.error_code})`);
          err.riprovabile = ["too_many_requests", "unavailable"].includes(b.content.error_code);
          if (!risultati.length && !err.riprovabile) { err.definitivo = b.content.error_code !== "query_too_long"; throw err; }
        }
        dopoUltimaRicerca = [];
      } else if (b.type === "web_fetch_tool_result") {
        const u = b.content?.url || b.content?.content?.source?.url;
        if (u) risultati.push({ url: u, titolo: b.content?.content?.title || "", data: b.content?.retrieved_at || null, via: "lettura" });
        dopoUltimaRicerca = [];
      } else if (b.type === "text") {
        dopoUltimaRicerca.push(b.text);
        (b.citations || []).forEach((c) => c.url && c.cited_text && citazioni.push({ url: c.url, titolo: c.title || "", testo: c.cited_text }));
      }
    }
    testoFinale = dopoUltimaRicerca.join("") || testoFinale;
    if (data.stop_reason !== "pause_turn") break;
    messaggi = [...messaggi, { role: "assistant", content: blocchi }];
  }
  return { testo: testoFinale, risultati, citazioni };
}

async function ricercaWebOpenAI({ system, testo, maxTokens, apiKey, model }) {
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, instructions: system, input: testo, tools: [{ type: "web_search_preview" }], max_output_tokens: maxTokens }),
    });
  } catch (e) { throw erroreDiRete(e); }
  if (!res.ok) throw await erroreDaRisposta(res, "OpenAI");
  const data = await res.json();
  const risultati = [], citazioni = [];
  let out = "";
  for (const item of data.output || []) {
    if (item.type === "web_search_call") (item.action?.sources || []).forEach((s) => s.url && risultati.push({ url: s.url, titolo: s.title || "", via: "ricerca" }));
    if (item.type === "message") for (const c of item.content || []) {
      if (c.type !== "output_text") continue;
      out += c.text;
      (c.annotations || []).filter((a) => a.type === "url_citation" && a.url).forEach((a) => {
        risultati.push({ url: a.url, titolo: a.title || "", via: "citazione" });
      });
    }
  }
  return { testo: out || data.output_text || "", risultati, citazioni };
}

async function ricercaWebGemini({ system, testo, maxTokens, apiKey, model }) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: testo }] }], systemInstruction: { parts: [{ text: system }] }, tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
  } catch (e) { throw erroreDiRete(e); }
  if (!res.ok) throw await erroreDaRisposta(res, "Gemini");
  const data = await res.json();
  const cand = data.candidates?.[0] || {};
  /* Gemini restituisce link di reindirizzamento: per la verifica vale il
     dominio, che è nel titolo della fonte. */
  const risultati = (cand.groundingMetadata?.groundingChunks || []).map((g) => ({ url: g.web?.uri || "", titolo: g.web?.title || "", dominio: (g.web?.title || "").toLowerCase().replace(/^www\./, ""), via: "ricerca" }));
  return { testo: (cand.content?.parts || []).map((p) => p.text || "").join(""), risultati, citazioni: [] };
}

async function chiamataRicercaWeb({ system, testo, maxTokens = 16000 }) {
  const provider = configIA.provider;
  const apiKey = chiaveCorrente();
  const model = configIA.modelli[provider] || MODELLI_PREDEFINITI[provider];
  if (provider !== "claude" && !apiKey) {
    const err = new Error(`Chiave API mancante per ${provider}: inserirla in «Configurazione IA» oppure selezionare Claude.`);
    err.definitivo = true;
    throw err;
  }
  const esegui = provider === "openai" ? ricercaWebOpenAI : provider === "gemini" ? ricercaWebGemini : ricercaWebClaude;
  let ultimo = null;
  for (let t = 0; t <= 3; t++) {
    try {
      const r = await inCodaIA(() => esegui({ system, testo, maxTokens, apiKey, model }));
      segnalaSuccesso();
      return r;
    } catch (err) {
      ultimo = err;
      if (!err.riprovabile || t === 3) break;
      segnalaCongestione();
      await attesa(Math.round((err.attesaSuggerita ?? 4000 * 2 ** t) * (0.75 + Math.random() * 0.5)));
    }
  }
  throw ultimo;
}

/* --- Che cosa cercare, area per area ------------------------------------- */
const RICERCA_WEB = {
  volontaria: {
    obiettivo: "documenti in cui il management della società analizzata comunica strategia, obiettivi e guidance",
    dove: "sito investor relations della società (presentazioni dei risultati, Investor Day / Capital Markets Day, lettere agli azionisti), trascrizioni delle conference call sui risultati, report di sostenibilità, pagine istituzionali su missione e modello di business",
    cosa: "obiettivi e target pluriennali con cifre e scadenze, guidance, priorità di allocazione del capitale, descrizione del modello di business e dei segmenti, risposte del management alle domande degli analisti, rischi dichiarati",
    preferenze: "preferisci le fonti primarie della società (dominio della società, comunicati ufficiali) e i documenti più recenti; per le trascrizioni indica la data della call",
  },
  derivata: {
    obiettivo: "stime e giudizi di terzi sulla società analizzata",
    dove: "sintesi pubbliche di report di analisti, dati di consensus (stime di ricavi, utili, margini, target price, raccomandazioni), comunicati e rapporti delle agenzie di rating",
    cosa: "valori numerici con la data di riferimento e la fonte che li ha pubblicati: stime per i prossimi esercizi, numero di analisti, target price, raccomandazioni, rating con outlook e motivazioni",
    preferenze: "ogni parametro deve avere fonte e data; segnala quando un dato proviene da un aggregatore e non dall'analista; non inventare stime: se un valore non è pubblicamente disponibile dillo nel campo nonTrovato",
  },
  contesto: {
    obiettivo: "informazioni sul settore e sul macro-ambiente in cui opera la società analizzata",
    dove: "studi di settore di associazioni di categoria, centri studi e società di ricerca (sintesi pubbliche), statistiche ufficiali (BEA, BLS, FRED, Census, Eurostat, FMI, OCSE), autorità di regolazione e testi normativi",
    cosa: "dimensione e crescita del mercato con cifre e anni, quote di mercato e concentrazione, principali concorrenti, barriere all'ingresso, potere di fornitori e clienti, sostituti, tendenze tecnologiche, normativa e dazi, variabili macro rilevanti per la domanda",
    preferenze: "preferisci fonti istituzionali e ufficiali; per le stime di mercato indica chi le ha prodotte e l'anno; le cifre vanno riportate esattamente come nella fonte",
  },
  notizie: {
    obiettivo: "notizie recenti e rilevanti per la strategia della società analizzata",
    dove: "stampa economica e agenzie (Reuters, Bloomberg, Financial Times, Wall Street Journal, CNBC e testate di settore), comunicati stampa della società",
    cosa: "acquisizioni e cessioni, nuovi prodotti e mercati, cambi del management, contenziosi e indagini, accordi con clienti o fornitori, ristrutturazioni, eventi che toccano il vantaggio competitivo",
    preferenze: "una notizia per fonte, con la data di pubblicazione; privilegia gli ultimi 12-18 mesi e gli eventi con effetto sulla strategia, non i movimenti di borsa del giorno",
  },
};

const SYSTEM_RICERCA_WEB = `Sei un analista strategico che raccoglie fonti dal web per l'analisi di una società quotata alla SEC.
Usa la ricerca web (e, se disponibile, la lettura delle pagine) per trovare le fonti più pertinenti e affidabili.
Regole:
- Riporta solo fonti che hai effettivamente trovato con la ricerca in questa conversazione, con l'URL esatto restituito dalla ricerca. Mai URL ricostruiti a memoria.
- Nel campo "contenuto" riporta i passaggi utili della fonte il più fedelmente possibile, nella lingua originale, con tutte le cifre, le date e le unità di misura come appaiono. Non riassumere i numeri, non arrotondarli, non aggiungere tue valutazioni. Separa i passaggi con una riga vuota.
- Se una cosa richiesta non si trova, scrivilo in "nonTrovato" invece di riempire il vuoto.
- Al termine delle ricerche rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo.`;

function promptRicercaWeb({ area, stato, richiesta, tipo }) {
  const conf = RICERCA_WEB[area.layer];
  const p = stato.entita.find((e) => e.ruolo === "principale") || {};
  const peer = stato.entita.filter((e) => e.ruolo === "peer" && e.nome).map((e) => `${e.nome}${e.ticker ? ` (${e.ticker})` : ""}`);
  const presenti = stato.documenti.filter((d) => d.layer === area.layer).map((d) => `- ${etichettaTipo(d.tipo)}: ${d.titolo || d.nomeFile}${d.url ? ` — ${d.url}` : ""}${d.anno ? ` (${d.anno})` : ""}`);
  const tipiAmmessi = area.tipi.map((t) => `"${t.id}" (${t.label})`).join(", ");
  return `Data di oggi: ${new Date().toISOString().slice(0, 10)}.

SOCIETÀ ANALIZZATA
- Nome: ${p.nome || "(non indicato)"}${p.ticker ? `\n- Ticker: ${p.ticker}` : ""}${p.cik ? `\n- CIK SEC: ${p.cik}` : ""}${p.settore ? `\n- Settore: ${p.settore}` : ""}${p.sic ? `\n- Codice SIC: ${p.sic}` : ""}${p.esercizio ? `\n- Chiusura dell'esercizio: ${p.esercizio}` : ""}${peer.length ? `\n- Peer considerati: ${peer.join(", ")}` : ""}

CHE COSA CERCARE: ${conf.obiettivo}.
Dove cercare: ${conf.dove}.
Informazioni utili: ${conf.cosa}.
Criteri: ${conf.preferenze}.
${tipo ? `Tipo di fonte richiesto: ${etichettaTipo(tipo)}.\n` : ""}${richiesta ? `\nINDICAZIONI DELL'ANALISTA (prioritarie): ${richiesta}\n` : ""}
${presenti.length ? `FONTI GIÀ PRESENTI IN QUEST'AREA (non riproporle; l'analista le considera insufficienti o vuole integrarle):\n${presenti.join("\n")}\n` : ""}
Trova al massimo ${MAX_FONTI_WEB} fonti, le migliori, non le prime.

Rispondi con questo JSON:
{
  "fonti": [
    {
      "titolo": "titolo della pagina o del documento",
      "url": "URL esatto restituito dalla ricerca",
      "editore": "chi pubblica (società, testata, istituto)",
      "data": "AAAA-MM-GG o AAAA-MM o AAAA della pubblicazione, null se ignota",
      "tipo": uno fra ${tipiAmmessi},
      "lingua": "en | it | …",
      "affidabilita": "alta | media | bassa",
      "motivo": "perché è utile per l'analisi strategica, in italiano, una frase",
      "contenuto": "passaggi rilevanti riportati fedelmente (massimo 5000 caratteri)"
    }
  ],
  "nonTrovato": ["informazione cercata ma non trovata", "…"]
}`;
}

/** Verifica deterministica: l'URL proposto deve comparire fra quelli che il
 *  motore di ricerca ha davvero restituito (o almeno il suo dominio). */
function verificaFonteWeb(fonte, risultati) {
  const u = normalizzaUrl(fonte.url);
  const dom = dominioDi(fonte.url);
  if (!dom) return { verifica: "non_verificato", nota: "URL non valido" };
  if (risultati.some((r) => r.url && normalizzaUrl(r.url) === u)) return { verifica: "url", nota: "URL presente fra i risultati della ricerca" };
  if (risultati.some((r) => dominioDi(r.url) === dom || (r.dominio && (r.dominio === dom || dom.endsWith(`.${r.dominio}`))))) return { verifica: "dominio", nota: "dominio presente fra i risultati, pagina non confermata" };
  return { verifica: "non_verificato", nota: "URL non trovato fra i risultati della ricerca: possibile indirizzo ricostruito" };
}

async function cercaFontiWeb({ area, stato, richiesta, tipo }) {
  const r = await chiamataRicercaWeb({ system: SYSTEM_RICERCA_WEB, testo: promptRicercaWeb({ area, stato, richiesta, tipo }) });
  const json = parseJsonRobusto(r.testo);
  if (!json || !Array.isArray(json.fonti)) {
    const err = new Error("risposta della ricerca non interpretabile");
    err.grezzo = String(r.testo || "").slice(0, 400);
    throw err;
  }
  const tipiArea = new Set(area.tipi.map((t) => t.id));
  const visti = new Set();
  const fonti = json.fonti
    .filter((f) => f && f.url && String(f.contenuto || "").trim().length >= 40)
    .filter((f) => { const k = normalizzaUrl(f.url); if (visti.has(k)) return false; visti.add(k); return true; })
    .slice(0, MAX_FONTI_WEB)
    .map((f) => {
      const v = verificaFonteWeb(f, r.risultati);
      const citate = r.citazioni.filter((c) => normalizzaUrl(c.url) === normalizzaUrl(f.url)).map((c) => c.testo);
      return {
        chiave: idBreve(),
        titolo: String(f.titolo || dominioDi(f.url)).slice(0, 200),
        url: String(f.url).trim(),
        editore: String(f.editore || dominioDi(f.url)).slice(0, 120),
        data: f.data ? String(f.data).slice(0, 10) : null,
        tipo: tipiArea.has(f.tipo) ? f.tipo : tipo || area.tipi[0].id,
        lingua: f.lingua || null,
        affidabilita: ["alta", "media", "bassa"].includes(f.affidabilita) ? f.affidabilita : "media",
        motivo: String(f.motivo || ""),
        contenuto: String(f.contenuto).slice(0, 8000),
        citazioniVerificate: [...new Set(citate)].slice(0, 20),
        ...v,
        selezionata: v.verifica !== "non_verificato",
      };
    });
  return {
    fonti,
    nonTrovato: Array.isArray(json.nonTrovato) ? json.nonTrovato.map(String).filter(Boolean).slice(0, 10) : [],
    risultatiTotali: new Set(r.risultati.map((x) => normalizzaUrl(x.url))).size,
  };
}

/** Una fonte web diventa un documento di testo, con intestazione di
 *  provenienza: la lettura successiva la tratta come un file caricato. */
function fileDaFonteWeb(f) {
  const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const righe = [
    `FONTE WEB — ${f.titolo}`,
    `Editore: ${f.editore}`,
    `URL: ${f.url}`,
    `Data di pubblicazione: ${f.data || "non indicata"}`,
    `Reperita con ricerca web dall'IA il ${new Date().toISOString().slice(0, 10)}; verifica dell'indirizzo: ${f.nota}.`,
    `Avvertenza: i passaggi seguenti sono stati trascritti dall'IA dalla pagina; i numeri vanno ricontrollati sulla fonte prima di usarli in conclusioni decisive.`,
    "",
    "PASSAGGI RILEVANTI",
    f.contenuto,
  ];
  if (f.citazioniVerificate?.length) righe.push("", "PASSAGGI CITATI TESTUALMENTE DAL MOTORE DI RICERCA", ...f.citazioniVerificate.map((c) => `«${c}»`));
  const nome = `web_${slug(f.editore) || "fonte"}_${slug(f.titolo) || "pagina"}.txt`;
  return new File([righe.join("\n")], nome, { type: "text/plain" });
}

/* --- Interfaccia --------------------------------------------------------- */
const ETICHETTE_VERIFICA = {
  url: { label: "URL verificato", colore: C.ok },
  dominio: { label: "solo dominio", colore: C.ambra },
  non_verificato: { label: "URL non verificato", colore: C.allarme },
};

function RicercaWeb({ area, stato, onAvvia, occupata }) {
  const [aperto, setAperto] = useState(false);
  const [richiesta, setRichiesta] = useState("");
  const [tipo, setTipo] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [esito, setEsito] = useState(null);
  const [errore, setErrore] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  const principale = stato.entita.find((e) => e.ruolo === "principale");
  const manca = !principale?.nome && !(area.layer === "contesto" && principale?.settore)
    ? "Indica prima il nome della società analizzata (anagrafica in alto)." : null;

  const cerca = async () => {
    setInCorso(true); setErrore(null); setEsito(null);
    try {
      const r = await cercaFontiWeb({ area, stato, richiesta: richiesta.trim(), tipo: tipo || null });
      setEsito(r);
    } catch (e) {
      setErrore(e.message + (e.grezzo ? ` Risposta: «${e.grezzo}…»` : ""));
    } finally { setInCorso(false); }
  };

  const aggiorna = (chiave, patch) => setEsito((e) => ({ ...e, fonti: e.fonti.map((f) => (f.chiave === chiave ? { ...f, ...patch } : f)) }));
  const scelte = esito?.fonti.filter((f) => f.selezionata) || [];
  const analizza = () => {
    scelte.forEach((f) => onAvvia({
      file: fileDaFonteWeb(f), layer: area.layer, tipo: f.tipo,
      entitaId: area.entitaPredefinita || null,
      anno: f.data ? f.data.slice(0, 4) : null,
      extra: { origine: "web", url: f.url, titolo: f.titolo, editore: f.editore, dataPubblicazione: f.data, verificaUrl: f.verifica },
    }));
    setEsito((e) => ({ ...e, fonti: e.fonti.filter((f) => !f.selezionata) }));
  };

  if (!aperto) {
    return (
      <div className="px-4 pb-3">
        <button onClick={() => setAperto(true)} className="st-btn w-full flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: area.colore, color: area.colore }}>
          <Globe size={14} /> Non trovi fonti adatte? Cerca sul web con l'IA
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-md border p-3 space-y-3" style={{ borderColor: area.colore, background: area.tenue }}>
      <div className="flex items-start gap-2">
        <Globe size={14} className="mt-0.5 shrink-0" style={{ color: area.colore }} />
        <p className="text-xs flex-1" style={{ color: C.inchiostro }}>
          L'IA cerca sul web le fonti più adatte per <b>{principale?.nome || "la società analizzata"}</b> e ne trascrive i passaggi utili. Il sistema controlla che ogni indirizzo sia davvero fra i risultati della ricerca; tu scegli quali tenere. Le fonti scelte entrano in quest'area e vengono lette come i file caricati.
        </p>
        <button onClick={() => setAperto(false)} aria-label="Chiudi la ricerca web"><X size={13} style={{ color: C.muto }} /></button>
      </div>
      <textarea value={richiesta} onChange={(e) => setRichiesta(e.target.value)} rows={2}
        placeholder="Cosa cerchi, o perché le fonti trovate non vanno (facoltativo). Es.: trascrizione dell'ultima earnings call; target 2027 dell'Investor Day"
        className="w-full rounded border px-2.5 py-1.5 text-sm" style={{ borderColor: C.riga, background: C.carta }} />
      <div className="flex flex-wrap items-center gap-2">
        {area.tipi.length > 1 && (
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded border px-2 py-1.5" style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 11, background: C.carta }}>
            <option value="">qualsiasi tipo dell'area</option>
            {area.tipi.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        <button onClick={cerca} disabled={inCorso || !!manca} className="st-btn flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white disabled:opacity-50" style={{ background: area.colore }}>
          {inCorso ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} {inCorso ? "Ricerca in corso… (può durare un paio di minuti)" : esito ? "Cerca di nuovo" : "Avvia la ricerca"}
        </button>
      </div>
      {manca && <p className="text-xs" style={{ color: C.allarme }}>{manca}</p>}
      {errore && <p className="text-xs" style={{ color: C.allarme, overflowWrap: "anywhere" }}>Ricerca non riuscita: {errore}</p>}

      {esito && (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: C.muto }}>
            {esito.fonti.length ? `${plurale(esito.fonti.length, "fonte proposta", "fonti proposte")} su ${plurale(esito.risultatiTotali, "pagina esaminata", "pagine esaminate")}.` : "Nessuna fonte rimasta da valutare."} Le fonti con URL non verificato sono deselezionate.
          </p>
          {esito.fonti.map((f) => {
            const v = ETICHETTE_VERIFICA[f.verifica];
            return (
              <div key={f.chiave} className="rounded border p-2.5" style={{ borderColor: f.selezionata ? area.colore : C.riga, background: C.carta }}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={f.selezionata} onChange={(e) => aggiorna(f.chiave, { selezionata: e.target.checked })} aria-label={`Tieni ${f.titolo}`} />
                  <div className="flex-1 min-w-0">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm underline" style={{ fontWeight: 600, color: C.inchiostro, overflowWrap: "anywhere" }}>{f.titolo}</a>
                    <div className="text-xs mt-0.5" style={{ color: C.muto, overflowWrap: "anywhere" }}>{[f.editore, f.data, dominioDi(f.url)].filter(Boolean).join(" · ")}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="rounded px-1.5 py-0.5 st-eyebrow" title={f.nota} style={{ border: `1px solid ${v.colore}`, color: v.colore }}>{v.label}</span>
                      <span className="rounded px-1.5 py-0.5 st-eyebrow" style={{ border: `1px solid ${C.riga}`, color: C.muto }}>affidabilità {f.affidabilita}</span>
                      {f.citazioniVerificate.length > 0 && <span className="rounded px-1.5 py-0.5 st-eyebrow" style={{ border: `1px solid ${C.riga}`, color: C.muto }}>{plurale(f.citazioniVerificate.length, "citazione testuale", "citazioni testuali")}</span>}
                      {area.tipi.length > 1 && (
                        <select value={f.tipo} onChange={(e) => aggiorna(f.chiave, { tipo: e.target.value })} className="rounded border px-1.5 py-0.5" style={{ borderColor: C.riga, fontFamily: F.mono, fontSize: 10, background: C.carta }}>
                          {area.tipi.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      )}
                    </div>
                    {f.motivo && <p className="text-xs mt-1.5">{f.motivo}</p>}
                    <button onClick={() => setAnteprima(anteprima === f.chiave ? null : f.chiave)} className="text-xs mt-1 underline" style={{ color: C.muto }}>{anteprima === f.chiave ? "Nascondi i passaggi" : "Mostra i passaggi trascritti"}</button>
                    {anteprima === f.chiave && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded p-2 text-xs" style={{ background: C.fondo, fontFamily: F.mono, overflowWrap: "anywhere" }}>{f.contenuto}</pre>}
                  </div>
                </div>
              </div>
            );
          })}
          {esito.nonTrovato.length > 0 && (
            <div className="text-xs rounded p-2" style={{ background: C.carta, color: C.muto }}>
              <b>Non trovato:</b> {esito.nonTrovato.join("; ")}.
            </div>
          )}
          {esito.fonti.length > 0 && (
            <button onClick={analizza} disabled={!scelte.length} className="st-btn flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white disabled:opacity-50" style={{ background: area.colore }}>
              <ArrowRight size={13} /> Analizza {plurale(scelte.length, "fonte selezionata", "fonti selezionate")}{occupata ? " (in coda)" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
