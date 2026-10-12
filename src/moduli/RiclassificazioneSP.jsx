import { useState, useMemo, useRef, useEffect } from "react";

// ═════════════════════════════════════════════════════════════
// RICLASSIFICAZIONE SP — v2 «SCHEMA DINAMICO»
//  · L'IA estrae TUTTE le voci originali del bilancio, ciascuna
//    con importo e classe gestionale proposta
//  · Schermata di VALIDAZIONE: ogni voce è modificabile
//    (nome, importo, classe) prima di qualsiasi calcolo
//  · Le formule sono ADATTIVE: aggregano le voci per classe,
//    quindi funzionano con qualsiasi schema di bilancio; se una
//    voce non esiste, semplicemente non entra nella formula
//  · Riclassificazione per pertinenza gestionale (principale)
//    e per criterio finanziario (secondaria)
// ═════════════════════════════════════════════════════════════

const INK = "#14213D";
const PAPER = "#F5F6F3";
const CARD = "#FFFFFF";
const GREEN = "#1F7A5C";
const RED = "#B3423A";
const AMBER = "#C9962B";
const BLUE = "#2E5EAA";
const PURPLE = "#6D28D9";
const LINE = "#DDE1DA";

/* ── SCALA DEGLI IMPORTI: MILIONI ─────────────────────────────────────────
   Tutti gli importi estratti dall'IA sono espressi in MILIONI della valuta
   del documento, qualunque sia la scala del bilancio letto. La regola viene
   aggiunta in coda a ogni richiesta, dopo il testo del documento. */
const REGOLA_SCALA_MILIONI = `

SCALA DEGLI IMPORTI — REGOLA TASSATIVA, PREVALE SU QUALSIASI INDICAZIONE PRECEDENTE
Scrivi TUTTI gli importi monetari in MILIONI della valuta del documento.
- Ricava la scala dal documento stesso: intestazione del prospetto o delle note («in migliaia di euro», «€/000», «in thousands», «in millions», «in milioni», «importi in euro»). Se non è indicata, gli importi sono in unità di valuta.
- Converti: documento in migliaia → dividi per 1.000 (1.234.567 migliaia = 1234.567); documento in unità di valuta → dividi per 1.000.000 (45.678.901 € = 45.678901); documento già in milioni → nessuna conversione.
- Scrivi gli importi come numeri JSON (non stringhe), senza separatori delle migliaia, con il PUNTO come separatore decimale e senza arrotondare le cifre significative (fino a 6 decimali).
- NON riscalare percentuali, rapporti, conteggi (dipendenti, numero di azioni) e valori per azione.
- Ogni campo "unita" va valorizzato con "milioni": descrive gli importi che restituisci, non il documento. Se queste istruzioni dicono «importi espressi in milioni», si riferiscono all'output: la scala del documento va comunque letta nel documento.
- Gli importi che queste istruzioni ti forniscono come riferimento (voci già estratte, totali, valori già presenti) sono anch'essi in milioni.`;
const conScalaMilioni = (testo) => (String(testo || "").includes("SCALA DEGLI IMPORTI — REGOLA TASSATIVA") ? testo : `${testo || ""}${REGOLA_SCALA_MILIONI}`);
/* Tolleranza di quadratura con importi in milioni: 1.000 € oppure lo 0,05%
   della grandezza confrontata, se maggiore (un bilancio pubblicato in milioni
   arrotonda già all'unità). */
const tolleranzaMilioni = (...valori) =>
  Math.max(0.001, 0.0005 * Math.max(0, ...valori.map((v) => Math.abs(Number(v) || 0))));

const fmt = (n) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n || 0);
const fmt2 = (n) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmt1 = (n) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
const pct = (n) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n * 100) + "%";

const parse = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === "" || v === "-" || v == null) return 0;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
/* Importi in milioni: le voci conservano l'importo come testo nel formato
   italiano dei campi di modifica («1234,567»), così `parse` non scambia il
   punto decimale per un separatore delle migliaia. */
const sImp = (n) => String(Math.round((Number(n) || 0) * 1e6) / 1e6).replace(".", ",");
/* Lettura di un importo arrivato dall'IA o da un JSON salvato: i numeri restano
   numeri; un testo con la virgola o con i punti delle migliaia all'italiana
   («1.234.567») passa da `parse`; «1234.567» è un decimale. */
const parseIA = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t || t.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(t)) return parse(t);
  const n = Number(t);
  return isNaN(n) ? parse(t) : n;
};

let _id = 1;
const newId = () => `v${_id++}_${Date.now() % 100000}`;

// ── CLASSI DI PERTINENZA GESTIONALE ──────────────────────────
// Ogni voce del bilancio viene etichettata con una di queste
// classi: le formule aggregano per classe, quindi si adattano
// automaticamente alle voci effettivamente presenti.
const CLASSI = {
  // ATTIVO
  att_op_magazzino: { sez: "attivo", area: "Gestione caratteristica", label: "Operativa corrente — Rimanenze di magazzino", color: GREEN },
  att_op_corrente: { sez: "attivo", area: "Gestione caratteristica", label: "Operativa corrente — Crediti commerciali, ratei attivi, altre attività correnti", color: GREEN },
  att_op_immobilizzata: { sez: "attivo", area: "Gestione caratteristica", label: "Operativa immobilizzata — Immobilizzazioni strumentali, crediti operativi oltre 12 m.", color: GREEN },
  att_accessoria: { sez: "attivo", area: "Gestione accessoria", label: "Accessoria — Immobili civili, partecipazioni non strategiche, investimenti patrimoniali", color: PURPLE },
  att_fin_liquidita: { sez: "attivo", area: "Gestione finanziaria", label: "Finanziaria — Disponibilità liquide immediate", color: BLUE },
  att_fin_altre: { sez: "attivo", area: "Gestione finanziaria", label: "Finanziaria — Titoli, attività finanziarie e crediti finanziari", color: BLUE },
  // PASSIVO
  pn: { sez: "passivo", area: "Capitale di rischio", label: "Patrimonio netto — Capitale, riserve, risultato", color: RED },
  pass_op_corrente: { sez: "passivo", area: "Gestione caratteristica", label: "Operativa corrente — Debiti commerciali, imposte, fondi correnti, altre pass. correnti, ratei passivi", color: GREEN },
  pass_op_non_corrente: { sez: "passivo", area: "Gestione caratteristica", label: "Operativa non corrente — Fondi non correnti, TFR, debiti operativi oltre 12 m.", color: GREEN },
  pass_fin_corrente: { sez: "passivo", area: "Gestione finanziaria", label: "Finanziaria corrente — Banche e finanziamenti entro 12 m.", color: BLUE },
  pass_fin_non_corrente: { sez: "passivo", area: "Gestione finanziaria", label: "Finanziaria non corrente — Mutui, obbligazioni, leasing oltre 12 m.", color: BLUE },
  // JOLLY
  da_classificare: { sez: "entrambi", area: "—", label: "⚠ Da classificare (esclusa dai calcoli finché non assegnata)", color: AMBER },
};
const CLASSI_ATTIVO = Object.keys(CLASSI).filter((k) => CLASSI[k].sez === "attivo");
const CLASSI_PASSIVO = Object.keys(CLASSI).filter((k) => CLASSI[k].sez === "passivo");

// ── DATI D'ESEMPIO (schema dinamico) ─────────────────────────
const ESEMPIO_VOCI = [
  { nome: "Immobilizzazioni immateriali", importo: "120000", sezione: "attivo", classe: "att_op_immobilizzata" },
  { nome: "Immobilizzazioni materiali strumentali", importo: "870000", sezione: "attivo", classe: "att_op_immobilizzata" },
  { nome: "Immobili civili non strumentali", importo: "110000", sezione: "attivo", classe: "att_accessoria" },
  { nome: "Immobilizzazioni finanziarie (partecipazioni strategiche)", importo: "150000", sezione: "attivo", classe: "att_op_immobilizzata" },
  { nome: "Crediti commerciali oltre 12 mesi", importo: "60000", sezione: "attivo", classe: "att_op_immobilizzata" },
  { nome: "Rimanenze di magazzino", importo: "310000", sezione: "attivo", classe: "att_op_magazzino" },
  { nome: "Crediti verso clienti", importo: "390000", sezione: "attivo", classe: "att_op_corrente" },
  { nome: "Ratei e risconti attivi", importo: "20000", sezione: "attivo", classe: "att_op_corrente" },
  { nome: "Crediti finanziari a breve", importo: "30000", sezione: "attivo", classe: "att_fin_altre" },
  { nome: "Attività finanziarie non immobilizzate", importo: "50000", sezione: "attivo", classe: "att_fin_altre" },
  { nome: "Disponibilità liquide", importo: "90000", sezione: "attivo", classe: "att_fin_liquidita" },
  { nome: "Capitale sociale", importo: "500000", sezione: "passivo", classe: "pn" },
  { nome: "Riserve", importo: "280000", sezione: "passivo", classe: "pn" },
  { nome: "Utile d'esercizio", importo: "70000", sezione: "passivo", classe: "pn" },
  { nome: "Fondi per rischi e oneri correnti", importo: "20000", sezione: "passivo", classe: "pass_op_corrente" },
  { nome: "Fondi per rischi e oneri non correnti", importo: "60000", sezione: "passivo", classe: "pass_op_non_corrente" },
  { nome: "TFR di lavoro subordinato", importo: "160000", sezione: "passivo", classe: "pass_op_non_corrente" },
  { nome: "Debiti verso banche oltre 12 mesi", importo: "460000", sezione: "passivo", classe: "pass_fin_non_corrente" },
  { nome: "Debiti operativi oltre 12 mesi", importo: "80000", sezione: "passivo", classe: "pass_op_non_corrente" },
  { nome: "Debiti verso banche entro 12 mesi", importo: "180000", sezione: "passivo", classe: "pass_fin_corrente" },
  { nome: "Debiti commerciali (fornitori)", importo: "250000", sezione: "passivo", classe: "pass_op_corrente" },
  { nome: "Passività per imposte sul reddito", importo: "40000", sezione: "passivo", classe: "pass_op_corrente" },
  { nome: "Altre passività correnti (dipendenti, previdenza)", importo: "80000", sezione: "passivo", classe: "pass_op_corrente" },
  { nome: "Ratei e risconti passivi", importo: "20000", sezione: "passivo", classe: "pass_op_corrente" },
].map((v) => ({ ...v, id: newId() }));

// ── PROMPT DI ESTRAZIONE (schema dinamico) ───────────────────
// ⚠ Questi due blocchi NON sono più costanti usate direttamente dai prompt:
// sono soltanto i VALORI DI DEFAULT del sistema auto-apprendente. I prompt
// reali leggono da `systemPrompts.CLASSI_DOC` / `systemPrompts.SCHEMI`, che
// vivono nello stato React e vengono persistiti in localStorage (Tab 11).
const DEFAULT_CLASSI_DOC = `CLASSI DISPONIBILI (usa ESATTAMENTE questi codici):
ATTIVO:
- "att_op_magazzino": rimanenze di magazzino, lavori in corso su ordinazione
- "att_op_corrente": crediti commerciali/verso clienti entro 12 mesi, crediti tributari correnti, altre attività correnti operative, ratei e risconti attivi
- "att_op_immobilizzata": immobilizzazioni immateriali, materiali strumentali, diritti d'uso, imposte anticipate non correnti. INCLUDI QUI ANCHE: partecipazioni strategiche (es. joint venture, equity method) e crediti di natura finanziaria ma strettamente legati al core business (es. Captive Finance / crediti verso dealer) oltre i 12 mesi.
- "att_accessoria": immobili civili non strumentali, partecipazioni NON strategiche (es. azioni a fair value di altre società), investimenti patrimoniali estranei al core business
- "att_fin_liquidita": disponibilità liquide, cassa, banche attive, depositi
- "att_fin_altre": titoli, derivati attivi, crediti finanziari puri. ATTENZIONE: se i crediti finanziari sono "Captive Finance" (finanziamento della rete vendita), vanno in att_op_corrente (se <12 mesi) o att_op_immobilizzata (se >12 mesi).
PASSIVO:
- "pn": capitale sociale, tutte le riserve, utili/perdite a nuovo, utile/perdita d'esercizio
- "pass_op_corrente": debiti commerciali/fornitori, acconti da clienti ("Advances from customers"), debiti tributari/imposte correnti, debiti verso dipendenti e previdenza, altre passività correnti operative ("Other liabilities"), fondi rischi correnti, ratei e risconti passivi
- "pass_op_non_corrente": fondi rischi e oneri non correnti, TFR, debiti operativi oltre 12 mesi, imposte differite
- "pass_fin_corrente": debiti verso banche entro 12 mesi, quota corrente di mutui, obbligazioni a breve, leasing correnti, soci per finanziamenti a breve
- "pass_fin_non_corrente": mutui, obbligazioni, leasing e finanziamenti oltre 12 mesi
- "da_classificare": SOLO se davvero incerto sulla natura della voce
⚠ REGOLA RIGIDA PASSIVITÀ E LEASING: Le voci denominate 'Other liabilities' o 'Advances from customers' (anticipi da clienti) che si riferiscono al normale ciclo commerciale/operativo vanno classificate SEMPRE in 'pass_op_corrente' (a breve termine), a meno che il documento non specifichi esplicitamente una scadenza oltre i 12 mesi. Inoltre, le passività per leasing ('Lease liabilities', IFRS 16) vanno SEMPRE in 'pass_fin_corrente' o 'pass_fin_non_corrente' (a seconda della scadenza), MAI nei debiti operativi.`;

// ── FASE A — RICONOSCIMENTO DELLO SCHEMA CONTABILE ───────────
const SCHEMA_DETECT_PROMPT = `Sei un esperto di principi contabili nazionali e internazionali. Nel documento è presente uno Stato Patrimoniale / Balance Sheet / Statement of Financial Position.
Identifica lo SCHEMA CONTABILE seguito, basandoti su: lingua e denominazione delle voci, struttura del prospetto (art. 2424 c.c. con sezioni A-B-C-D e macroclassi = OIC; distinzione current/non-current = IAS/IFRS; ordine di liquidità decrescente con cash in testa = US GAAP), valuta, presenza di voci tipiche (TFR e ratei/risconti separati = OIC; right-of-use assets, investment property, assets held for sale = IAS/IFRS; treasury stock, additional paid-in capital, accounts receivable in testa = US GAAP).
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"schema":"oic","paese":"Italia","valuta":"EUR","unita":"unità","indizi":"1 frase sui segnali che hanno permesso il riconoscimento","note_contabili":["max 3 differenze contabili rilevanti di questo schema da tenere presenti nella riclassificazione"]}
Regole: "schema" può essere SOLO "oic" (bilancio italiano civilistico secondo principi OIC), "ifrs" (bilancio IAS/IFRS dello IASB, anche se redatto da società italiana quotata), "us_gaap" (bilancio statunitense US GAAP) oppure "altro" se davvero non riconoscibile; "unita" va sempre valorizzato con "milioni" (gli importi vengono estratti in milioni, vedi SCALA DEGLI IMPORTI). Rispondi SOLO con il JSON.`;

const DEFAULT_SCHEMI = {
  oic: {
    label: "Italiano civilistico (OIC)",
    regole: `REGOLE SPECIFICHE PER SCHEMA ITALIANO CIVILISTICO (art. 2424 c.c., principi OIC):
- Struttura per destinazione economica (A crediti v/soci, B immobilizzazioni, C attivo circolante, D ratei e risconti): NON confondere la collocazione formale con la natura gestionale (es. i crediti finanziari in C.III restano di natura finanziaria).
- Crediti verso soci per versamenti ancora dovuti (A) → "att_op_corrente".
- Immobilizzazioni finanziarie (B.III): partecipazioni strategiche/di controllo → "att_op_immobilizzata"; partecipazioni non strategiche → "att_accessoria"; crediti finanziari e titoli immobilizzati → "att_fin_altre".
- Nei crediti dell'attivo circolante (C.II) separa, se indicata, la quota esigibile oltre 12 mesi → "att_op_immobilizzata".
- Ratei e risconti attivi (D) → "att_op_corrente"; ratei e risconti passivi (E) → "pass_op_corrente".
- TFR di lavoro subordinato (C del passivo) → SEMPRE "pass_op_non_corrente".
- Fondi per rischi e oneri (B del passivo): distingui quota corrente/non corrente se desumibile, altrimenti "pass_op_non_corrente".
- Debiti (D del passivo): distingui la natura (banche, obbligazioni, soci per finanziamenti = finanziari; fornitori, tributari, previdenziali, acconti = operativi) e la scadenza entro/oltre 12 mesi se esposta.
- Azioni proprie in riduzione del patrimonio netto → "pn" con importo negativo.`,
  },
  ifrs: {
    label: "Internazionale (IAS/IFRS)",
    regole: `REGOLE SPECIFICHE PER SCHEMA IAS/IFRS (standard IASB):
- Il prospetto distingue già current/non-current: usa questa distinzione per assegnare le scadenze entro/oltre 12 mesi.
- Diritti d'uso / right-of-use assets (IFRS 16) → "att_op_immobilizzata"; le lease liabilities correlate → "pass_fin_corrente" o "pass_fin_non_corrente" secondo scadenza (per IFRS 16 il leasing è debito finanziario, a differenza dell'OIC dove i canoni restano fuori bilancio).
- Investimenti immobiliari / investment property (IAS 40) → "att_accessoria".
- Attività e passività destinate alla vendita / held for sale (IFRS 5) → "att_accessoria" (o "da_classificare" se la natura non è chiara).
- Imposte anticipate / deferred tax assets → "att_op_immobilizzata" (per IAS 12 sono sempre non correnti); imposte differite passive → "pass_op_non_corrente".
- Benefici ai dipendenti (IAS 19, incluso il TFR nelle società italiane IFRS) → "pass_op_non_corrente".
- Attività finanziarie a fair value, titoli, derivati attivi → "att_fin_altre"; derivati passivi e debiti finanziari → classi finanziarie secondo scadenza.
- Avviamento/goodwill e attività immateriali → "att_op_immobilizzata".
- Gli importi a fair value vanno presi così come esposti, senza rettifiche.
- PARTECIPAZIONI: "Investments accounted for equity method" sono strategiche → "att_op_immobilizzata". Altre partecipazioni a fair value → "att_accessoria".
- CREDITI FINANZIARI OPERATIVI: I crediti da "financing activities" legati al captive finance (es. finanziamenti ai dealer) sono operativi. Quota corrente → "att_op_corrente", quota non corrente → "att_op_immobilizzata".`,
  },
  us_gaap: {
    label: "Statunitense (US GAAP)",
    regole: `REGOLE SPECIFICHE PER SCHEMA US GAAP (bilancio americano):
- L'attivo è tipicamente esposto in ordine di liquidità DECRESCENTE (cash in testa, immobilizzazioni in fondo): l'ORDINE non indica la natura, classifica per contenuto.
- Cash and cash equivalents → "att_fin_liquidita"; marketable securities / short-term investments → "att_fin_altre".
- Accounts receivable (net) → "att_op_corrente"; inventories → "att_op_magazzino"; prepaid expenses e other current assets → "att_op_corrente".
- Property, plant and equipment (net), goodwill, intangible assets → "att_op_immobilizzata".
- Operating e finance lease right-of-use assets → "att_op_immobilizzata"; le lease liabilities → "pass_fin_corrente"/"pass_fin_non_corrente" secondo scadenza.
- Accounts payable, accrued liabilities, income taxes payable, deferred revenue corrente → "pass_op_corrente"; deferred revenue non corrente, deferred tax liabilities, pension e other long-term liabilities → "pass_op_non_corrente".
- Notes payable, current portion of long-term debt, commercial paper → "pass_fin_corrente"; long-term debt, bonds payable → "pass_fin_non_corrente".
- Common stock, additional paid-in capital, retained earnings, accumulated other comprehensive income → "pn"; treasury stock (azioni proprie) → "pn" con importo NEGATIVO.
- Non esiste il TFR italiano: eventuali pension/postretirement liabilities → "pass_op_non_corrente".`,
  },
  altro: {
    label: "Schema non standard",
    regole: `SCHEMA NON RICONOSCIUTO CON CERTEZZA: classifica ogni voce in base alla sua natura economica desumibile dalla denominazione e dal contesto; nel dubbio usa "da_classificare".`,
  },
};

// ── SISTEMA AUTO-APPRENDENTE: PROMPT DI SISTEMA PERSISTENTI ──
// I due blocchi di regole (CLASSI_DOC e SCHEMI) non sono più immutabili:
// l'Audit del Tab 11 può appendervi nuove regole, che vengono salvate nel
// browser e riutilizzate in TUTTE le chiamate IA successive.
const SP_PROMPTS_KEY = "sp_system_prompts";

const promptsDiDefault = () => ({
  CLASSI_DOC: DEFAULT_CLASSI_DOC,
  SCHEMI: JSON.parse(JSON.stringify(DEFAULT_SCHEMI)),
  // Registro delle regole apprese: {target, testo, quando} — solo per la UI.
  regoleApprese: [],
});

// Lettura difensiva: qualunque anomalia (storage disabilitato, JSON corrotto,
// struttura incompleta dopo un aggiornamento) fa ricadere sui default.
const caricaSystemPrompts = () => {
  const base = promptsDiDefault();
  try {
    if (typeof window === "undefined" || !window.localStorage) return base;
    const grezzo = window.localStorage.getItem(SP_PROMPTS_KEY);
    if (!grezzo) return base;
    const salvato = JSON.parse(grezzo);
    if (!salvato || typeof salvato !== "object") return base;
    const schemi = { ...base.SCHEMI };
    if (salvato.SCHEMI && typeof salvato.SCHEMI === "object") {
      Object.keys(base.SCHEMI).forEach((k) => {
        const s = salvato.SCHEMI[k];
        if (s && typeof s.regole === "string" && s.regole.trim()) {
          schemi[k] = { label: s.label || base.SCHEMI[k].label, regole: s.regole };
        }
      });
    }
    return {
      CLASSI_DOC: typeof salvato.CLASSI_DOC === "string" && salvato.CLASSI_DOC.trim()
        ? salvato.CLASSI_DOC
        : base.CLASSI_DOC,
      SCHEMI: schemi,
      regoleApprese: Array.isArray(salvato.regoleApprese) ? salvato.regoleApprese : [],
    };
  } catch {
    return base;
  }
};

const scriviSystemPrompts = (p) => {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      window.localStorage.setItem(SP_PROMPTS_KEY, JSON.stringify(p));
  } catch { /* quota esaurita o storage negato: la sessione corrente resta valida */ }
};

// ── CHIAVI API INSERITE DALL'UTENTE ─────────────────────────────────────────
// Le chiavi digitate nella schermata «🔑 Configurazione IA» vivono nel browser
// (localStorage, opzionale) e vengono inviate al proxy /api/chat SOLO al momento
// della singola chiamata: il server le usa e le dimentica, non le scrive né su
// disco né nei log. Non entrano mai nel JSON di salvataggio del lavoro.
const SP_KEYS_KEY = "sp_api_keys";
const CHIAVI_VUOTE = { claude: "", openai: "", gemini: "" };

const caricaChiavi = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { ...CHIAVI_VUOTE };
    const grezzo = window.localStorage.getItem(SP_KEYS_KEY);
    if (!grezzo) return { ...CHIAVI_VUOTE };
    const salvato = JSON.parse(grezzo);
    if (!salvato || typeof salvato !== "object") return { ...CHIAVI_VUOTE };
    return {
      claude: typeof salvato.claude === "string" ? salvato.claude : "",
      openai: typeof salvato.openai === "string" ? salvato.openai : "",
      gemini: typeof salvato.gemini === "string" ? salvato.gemini : "",
    };
  } catch {
    return { ...CHIAVI_VUOTE };
  }
};

const scriviChiavi = (k) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    // Se tutte vuote si rimuove la voce, invece di lasciare un oggetto inutile.
    const qualcosa = ["claude", "openai", "gemini"].some((p) => (k[p] || "").trim());
    if (qualcosa) window.localStorage.setItem(SP_KEYS_KEY, JSON.stringify(k));
    else window.localStorage.removeItem(SP_KEYS_KEY);
  } catch { /* storage negato: la chiave resta valida per la sessione corrente */ }
};

const dimenticaChiavi = () => {
  try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(SP_KEYS_KEY); }
  catch { /* noop */ }
};

// Anteprima non sensibile per il riepilogo a schermo: sk-ant-…4f2a
const chiaveMascherata = (v = "") => {
  const s = String(v).trim();
  if (s.length <= 12) return "•".repeat(Math.max(s.length, 4));
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
};

// Controllo di forma (non di validità!): serve solo a intercettare gli
// incollaggi sbagliati — chiave di un provider messa nel campo di un altro.
const formaChiaveSospetta = (provider, v = "") => {
  const s = String(v).trim();
  if (!s) return null;
  if (provider === "claude" && !s.startsWith("sk-ant-"))
    return "Le chiavi Anthropic iniziano di norma con «sk-ant-»";
  if (provider === "openai" && !s.startsWith("sk-"))
    return "Le chiavi OpenAI iniziano di norma con «sk-»";
  if (provider === "gemini" && !s.startsWith("AIza"))
    return "Le chiavi Google AI Studio iniziano di norma con «AIza»";
  return null;
};

/* ── ANCORA TEMPORALE DEI PROMPT ──────────────────────────────────────────
   Fuori dalla Modalità Singolo Anno l'anno di riferimento è l'esercizio
   corrente di default; quando la modalità è attiva diventa l'anno digitato
   dall'utente. Così l'istruzione di colonna e il blocco «singolo anno» non
   possono più contraddirsi (prima il prompt chiedeva il 2025 e subito dopo
   imponeva l'anno indicato). ------------------------------------------- */
/* Esercizio di riferimento: lo imposta chi monta il programma (prop
   «annoRiferimento», es. la suite di caricamento con l'anno digitato
   dall'utente). Senza prop resta l'esercizio di default. */
const ANNO_RIF_BASE = "2025";
let ANNO_RIF_DEFAULT = ANNO_RIF_BASE;
const annoValidoStr = (a) => (/^\d{4}$/.test(String(a || "").trim()) ? String(a).trim() : "");
const annoPrecDi = (a) => (annoValidoStr(a) ? String(Number(annoValidoStr(a)) - 1) : "");

const buildSpPrompt = (sch, prec = false, modalitaSingoloAnno = false, annoSpecifico = "", sp = promptsDiDefault(), annoSpecificoPrec = "") => {
  const profilo = sp.SCHEMI[sch?.schema] || sp.SCHEMI.altro;
  const note = Array.isArray(sch?.note_contabili) && sch.note_contabili.length
    ? `\nDIFFERENZE CONTABILI RILEVATE IN FASE DI RICONOSCIMENTO da tenere presenti:\n${sch.note_contabili.map((n) => `- ${n}`).join("\n")}`
    : "";
  // Flusso parallelo per il Rendiconto Finanziario: quando prec=true l'IA deve
  // leggere ESCLUSIVAMENTE la colonna comparativa dell'esercizio precedente.
  const annoT = (modalitaSingoloAnno ? annoValidoStr(annoSpecifico) : "") || ANNO_RIF_DEFAULT;
  const annoTPrec = annoValidoStr(annoSpecificoPrec) || annoPrecDi(annoT);
  /* Modalità Singolo Anno: il T-1 non arriva più dalla colonna comparativa del
     bilancio corrente, ma da un DOCUMENTO AUTONOMO (un bilancio per anno).
     L'esercizio da leggere è quindi la colonna PRINCIPALE di quel documento,
     non la comparativa: senza questo ribaltamento l'IA restituirebbe l'anno
     sbagliato (T-2) o una lista vuota. */
  const istruzioneEsercizioAutonoma = `⚠⚠ ESERCIZIO — DOCUMENTO AUTONOMO DELL'ANNO PRECEDENTE (Modalità Singolo Anno): il documento che stai analizzando è il bilancio a sé stante dell'esercizio ${annoTPrec || "precedente"}, NON il bilancio dell'anno corrente.
ISTRUZIONI TASSATIVE SULLA COLONNA:
- Estrai i dati dell'esercizio ${annoTPrec || "di chiusura di questo documento"}, che qui è la colonna PRINCIPALE del prospetto (nei prospetti a due colonne è la PRIMA colonna numerica).
- Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi presenti in questo documento.
- Verifica sempre l'intestazione di colonna (anno/data di chiusura) prima di leggere il numero.
- Nel campo "esercizio" riporta la data/anno di chiusura effettivamente letta${annoTPrec ? ` (attesa: ${annoTPrec})` : ""}.
- Se il documento non contiene l'esercizio richiesto, restituisci "voci":[] anziché ripiegare su un altro anno.`;
  const istruzioneEsercizioBase = prec
    ? `ESERCIZIO: estrai ESCLUSIVAMENTE la colonna dell'ANNO PRECEDENTE (${annoTPrec}), cioè l'esercizio COMPARATIVO, NON quello più recente. Se ci sono più colonne, individua dalle intestazioni quella dell'anno precedente (di norma la colonna comparativa, spesso a destra o indicata come «esercizio precedente») e non mescolarla in alcun modo con la colonna dell'anno corrente. Se la colonna dell'anno precedente non è presente, restituisci "voci":[] e indica in "esercizio" gli anni trovati.`
    : `ESERCIZIO: estrai ESCLUSIVAMENTE la colonna dell'esercizio ${annoT} (chiusura nel ${annoT}). Se ci sono più colonne, individua quella del ${annoT} dalle intestazioni e non mescolarla con altri anni. Se il ${annoT} non è presente, restituisci "voci":[] e indica in "esercizio" gli anni trovati.`;
  const istruzioneEsercizio = prec && modalitaSingoloAnno ? istruzioneEsercizioAutonoma : istruzioneEsercizioBase;
  // Istruzione tassativa supplementare quando è attiva la Modalità Singolo Anno
  // (solo per l'estrazione principale, prec === false).
  const singoloAnnoIstr = (!prec && modalitaSingoloAnno && annoSpecifico)
    ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Estrai ESCLUSIVAMENTE i dati, gli importi e le voci dello Stato Patrimoniale relativi all'anno ${annoSpecifico}. Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi.`
    : "";
  return `Sei un analista di bilancio esperto. Nel documento è presente uno Stato Patrimoniale già riconosciuto come: ${profilo.label}.
${profilo.regole}${note}
${istruzioneEsercizio}
ESTRAI TUTTE LE VOCI così come sono denominate nel bilancio (voci di dettaglio/foglia, NON i totali e subtotali come "Totale attivo", "Totale immobilizzazioni", "Totale debiti"), ognuna con il suo importo e la classe di pertinenza gestionale più appropriata secondo le regole di schema sopra indicate.
${sp.CLASSI_DOC}
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"esercizio":"31/12/${prec ? annoTPrec : annoT}","voci":[{"nome":"Immobilizzazioni materiali","importo":123456,"sezione":"attivo","classe":"att_op_immobilizzata"}, ...]}
Regole: "importo" numero JSON in MILIONI della valuta (vedi SCALA DEGLI IMPORTI), punto come separatore decimale (negativo se la voce è negativa, es. perdita d'esercizio o azioni proprie); "sezione" solo "attivo" o "passivo" (il patrimonio netto/equity va in "passivo"); includi OGNI voce con importo diverso da zero; la somma delle voci attive deve avvicinarsi al totale attivo e quella delle passive al totale passivo. Rispondi SOLO con il JSON.${singoloAnnoIstr}`;
};

// Ancora temporale della Nota Integrativa: unica frase che dichiara l'esercizio
// di riferimento, così le varianti T-1 possono sostituirla in modo affidabile.
const niAncora = (anno) => `(esercizio di riferimento ${anno}: se le tabelle mostrano più esercizi considera solo la colonna ${anno})`;
const buildNiFilterPrompt = (anno = ANNO_RIF_DEFAULT) => `Sei un analista di bilancio. Il documento allegato è la NOTA INTEGRATIVA di un bilancio ${niAncora(anno)}.
FASE 1 — FILTRO: individua le SOLE pagine e sezioni che contengono informazioni utili alla riclassificazione gestionale dello Stato Patrimoniale, ed estrai da esse i dati rilevanti. Sono utili ESCLUSIVAMENTE:
- composizione e scadenza dei debiti (entro/oltre 12 mesi; natura bancaria/finanziaria vs commerciale/operativa; mutui, leasing, obbligazioni, soci per finanziamenti). ⚠ OBBLIGATORIO: per i debiti finanziari ('Debt', 'Borrowings', 'Loans', 'Notes payable', 'Bonds', 'Financial payables') CERCA SEMPRE e riporta l'importo ESATTO della quota a breve termine ('current portion of long-term debt', 'short-term borrowings', 'commercial paper', utilizzi di linee di credito revolving) DISTINTO da quello della quota oltre 12 mesi. Se la Nota espone solo lo scadenzario per annualità (maturity schedule), riporta la prima annualità come quota corrente e la somma delle annualità successive come quota non corrente.
- dettaglio e natura dei crediti (commerciali vs finanziari vs tributari; entro/oltre 12 mesi; crediti di dubbia esigibilità). ⚠ OBBLIGATORIO: per le società con captive finance (es. 'Receivables from financing activities', 'Finance receivables', crediti finanziari verso clientela o rete di vendita) CERCAMI SEMPRE la ripartizione tra scadenze entro 12 mesi e oltre 12 mesi e riporta ENTRAMBI gli importi in modo distinto: questi portafogli hanno per natura scadenze miste e non possono mai risultare interamente a breve. Se trovi solo la maturity table per anni, ricostruisci la quota oltre 12 mesi sommando le annualità successive alla prima.
- composizione delle immobilizzazioni (strumentali vs immobili civili/investimenti patrimoniali; partecipazioni strategiche vs non strategiche)
- fondi per rischi e oneri (quota corrente vs non corrente) e TFR. ⚠ OBBLIGATORIO: per i fondi ('Provisions', 'Provisions for risks and charges') CERCA SEMPRE la ripartizione corrente/non corrente, con particolare attenzione ai fondi garanzia prodotto ('warranties', 'product warranty'), campagne di richiamo ('recalls', 'service actions'), contenziosi legali e ristrutturazioni: riporta separatamente la quota attesa in uscita entro 12 mesi e quella oltre. Se la Nota espone la movimentazione del fondo (utilizzi attesi/rollforward), usala per stimare e indicare esplicitamente la quota corrente.
- ⚠ FISCALITÀ DIFFERITA (IAS 12) — ECCEZIONE TASSATIVA: per 'Deferred tax assets' (imposte anticipate) e 'Deferred tax liabilities' (imposte differite passive) NON estrarre e NON riportare MAI alcuna ripartizione "entro/oltre 12 mesi", anche se la Nota la fornisce esplicitamente: tali informazioni vanno IGNORATE perché sotto IAS/IFRS queste poste sono per definizione integralmente non correnti. Estrai solo il valore complessivo ed eventuali informazioni su compensazioni ('offsetting'), recuperabilità o perdite fiscali riportabili.
- natura di ratei e risconti
- attività o passività estranee alla gestione caratteristica o destinate alla vendita
- garanzie prestate, impegni, covenant, operazioni con parti correlate
IGNORA tutto il resto (criteri di valutazione generici, commento al conto economico, compensi degli organi sociali, informativa sul personale, fatti di rilievo non patrimoniali, ecc.).
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"pagine_rilevanti":[5,6,12],"estratti":[{"pagina":5,"tema":"Debiti verso banche — scadenze","contenuto":"sintesi compatta con gli importi ESATTI trovati (es. entro 12 mesi 180.000; oltre 12 mesi 460.000, di cui mutuo ipotecario 400.000)"}]}
Regole: riporta in "contenuto" i dati numerici esatti in forma compatta; massimo 15 estratti, ciascuno massimo 600 caratteri; "pagina" è il numero di pagina del documento; se nulla è rilevante restituisci array vuoti. Rispondi SOLO con il JSON.`;

// Variante per il flusso dell'esercizio precedente: stessa struttura, ma l'IA
// deve cercare nella Nota Integrativa i dati riferiti all'esercizio precedente
// (colonna comparativa), non a quello corrente.
// Avviso condiviso dai filtri T-1: è l'errore più frequente e costoso, perché
// contamina silenziosamente tutta la comparazione tra esercizi.
const ALLERTA_CONTAMINAZIONE = `⚠ ALLERTA CONTAMINAZIONE DATI: NELLE TABELLE A PIÙ COLONNE, IGNORA TASSATIVAMENTE I VALORI DELL'ANNO CORRENTE. ESTRAI I DATI SOLO DALLA COLONNA COMPARATIVA (ANNO PRECEDENTE). PRELEVARE I NUMERI DELL'ANNO CORRENTE È CONSIDERATO UN ERRORE CRITICO.`;

const buildNiFilterPromptPrec = (anno = ANNO_RIF_DEFAULT) => `${ALLERTA_CONTAMINAZIONE}

${buildNiFilterPrompt(anno).replace(
  niAncora(anno),
  `(devi cercare i dati riferiti all'ESERCIZIO PRECEDENTE${annoPrecDi(anno) ? `, ${annoPrecDi(anno)}` : ""}: se le tabelle mostrano più esercizi considera ESCLUSIVAMENTE la colonna dell'anno precedente/comparativo, NON quella dell'anno più recente; se un'informazione è disponibile solo per l'anno corrente, ignorala)`
)}`;

/* ---- Variante «documento autonomo» della NI T-1 (Modalità Singolo Anno) ----
   Quando la serie storica si costruisce a mano, un anno per file, la Nota
   Integrativa destinata agli slot T-1 è quella dell'esercizio PRINCIPALE di
   quel documento: le istruzioni sulla «colonna comparativa» pescherebbero
   l'anno sbagliato (T-2) e vanno quindi ribaltate. ---- */
const buildNiFilterPromptPrecAutonomo = (annoPrec = "") => `${buildNiFilterPrompt(annoValidoStr(annoPrec) || ANNO_RIF_DEFAULT)}

⚠⚠ ESERCIZIO DI RIFERIMENTO — DOCUMENTO AUTONOMO (Modalità Singolo Anno). Sovrascrive ogni indicazione precedente sull'esercizio:
- Il documento che stai analizzando è la Nota Integrativa a sé stante di un esercizio già chiuso${annoValidoStr(annoPrec) ? ` (${annoValidoStr(annoPrec)})` : ""}, NON la nota dell'anno corrente.
- Estrai le informazioni dell'esercizio PRINCIPALE di questo documento, cioè quello a cui la nota si riferisce: nelle tabelle a due colonne è la PRIMA colonna (l'esercizio di chiusura), non il comparativo.
- Ignora tassativamente la colonna comparativa e i dati riferiti ad altri esercizi presenti in questo stesso documento.
- Quando la nota commenta una variazione («i debiti passano da X a Y»), il valore da estrarre è quello di ARRIVO Y, riferito all'esercizio della nota.`;

const buildNiApplyPrompt = (classiDoc = DEFAULT_CLASSI_DOC) => `Sei un analista di bilancio. Devi RICLASSIFICARE DEFINITIVAMENTE lo Stato Patrimoniale per pertinenza gestionale usando le informazioni non-financial già filtrate dalla Nota Integrativa.
VOCI ATTUALI dello Stato Patrimoniale (nome → importo → classe attuale):
{{VOCI}}
INFORMAZIONI FILTRATE DALLA NOTA INTEGRATIVA:
{{ESTRATTI}}
${classiDoc}
Usa le informazioni filtrate per: distinguere natura finanziaria od operativa dei debiti, separare le scadenze entro/oltre 12 mesi, isolare la quota corrente dei fondi, individuare attività estranee alla gestione caratteristica (accessorie), qualificare la natura dei crediti.
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{
 "riclassificazioni": [{"voce":"nome esatto di una voce dell'elenco","classe":"nuovo codice classe","motivo":"max 1 frase: quale informazione della NI giustifica lo spostamento di classe"}],
 "scomposizioni": [{"voce_originale":"nome esatto di una voce dell'elenco","dettagli":[{"nome":"Debiti v/banche entro 12 mesi","importo":100,"classe":"pass_fin_corrente"}],"motivo":"max 1 frase: quale informazione della NI giustifica la scomposizione"}],
 "osservazioni": ["max 4 stringhe brevi: garanzie, impegni, rischi, parti correlate rilevanti per la valutazione"]
}
Regole:
1) Usa "riclassificazioni" quando un'intera voce va spostata di classe.
2) Usa "scomposizioni" OBBLIGATORIAMENTE quando la NI indica che una voce aggregata contiene nature diverse (es. "Investments" che contiene in parte Equity Method strategici e in parte azioni a fair value). La somma dei dettagli deve essere <= dell'importo originale; il residuo resta nella voce originale.
3) MANTENIMENTO STORICO: Se stai analizzando un anno, assicurati di mantenere la logica di natura gestionale coerente con la storicità aziendale.
Proponi SOLO modifiche supportate dalle informazioni filtrate: se non hai elementi, restituisci array vuoti.

⚠ REGOLE RIGIDE E TASSATIVE DI SCOMPOSIZIONE E CLASSIFICAZIONE:
0) VINCOLO MATEMATICO ASSOLUTO — Non calcolare MAI la quota a lungo termine e non fare sottrazioni per nessuna voce (crediti, debiti, fondi). Fornisci nell'array "dettagli" ESCLUSIVAMENTE un singolo elemento con l'importo esatto della quota a BREVE termine/corrente, così come riportato letteralmente nelle informazioni filtrate. Il sistema calcolerà automaticamente il residuo a lungo termine per differenza matematica. Questo vincolo del dettaglio unico riguarda le scomposizioni per SCADENZA (breve/lungo termine); nelle scomposizioni per NATURA previste dalla regola 2 puoi indicare più dettagli, ma SOLO con importi esplicitamente quantificati nelle informazioni filtrate: nessun importo va mai ricavato per differenza.
0-bis) CLASSE DEL RESIDUO — Il residuo calcolato dal sistema EREDITA LA CLASSE DELLA VOCE ORIGINALE. Quindi, ogni volta che estrai una quota corrente da una voce la cui classe attuale non è quella corretta per il lungo termine, devi OBBLIGATORIAMENTE aggiungere in "riclassificazioni" lo spostamento della voce originale alla classe di lungo termine appropriata: solo così il residuo finisce nella classe giusta.
1) FISCALITÀ DIFFERITA (IAS 12) — Sotto principi IAS/IFRS le imposte anticipate ('Deferred tax assets') sono SEMPRE E SOLO non correnti e vanno classificate in "att_op_immobilizzata"; le imposte differite passive ('Deferred tax liabilities') sono SEMPRE E SOLO non correnti e vanno classificate in "pass_op_non_corrente". È SEVERAMENTE VIETATO scomporle tra quota corrente e non corrente: ignora tassativamente qualsiasi ripartizione "entro/oltre 12 mesi" eventualmente fornita nelle Note. Non generare MAI una scomposizione su queste voci: al massimo una riclassificazione.
2) DEBITI FINANZIARI ('Debt' / 'Borrowings' / 'Loans' / 'Bonds' / 'Notes payable') — Cerca SEMPRE nelle informazioni filtrate la quota a breve termine ('current portion of long-term debt') o gli utilizzi di linee di credito a breve ('short-term borrowings', 'commercial paper', revolving). Genera UN SOLO dettaglio con quell'importo in "pass_fin_corrente" e, se la voce originale non è già classificata "pass_fin_non_corrente", riclassificala contestualmente in "pass_fin_non_corrente". Non allocare MAI una macro-voce di debito interamente a lungo termine se la Nota indica diversamente.
3) CREDITI FINANZIARI ('Receivables from financing activities' / 'Finance receivables') — Questi portafogli (es. captive finance) hanno per natura scadenze miste. Cerca la ripartizione nelle informazioni filtrate, genera UN SOLO dettaglio con la quota a BREVE termine classificata "att_op_corrente" e riclassifica CONTESTUALMENTE la voce originale in "att_op_immobilizzata": il residuo calcolato dal sistema rappresenterà così la quota a lungo termine. Non allocare MAI il 100% dell'importo a breve termine.
4) FONDI RISCHI E ONERI ('Provisions') — I fondi per garanzie ('warranties'), campagne di richiamo ('recalls') o comunque legati al ciclo di vendita hanno quasi sempre un impatto a breve termine. Genera UN SOLO dettaglio con la quota corrente in "pass_op_corrente" e, se la voce originale non è già classificata "pass_op_non_corrente", riclassificala contestualmente in "pass_op_non_corrente". Non assegnarli MAI integralmente al lungo termine.
Per le regole 2), 3) e 4): se le informazioni filtrate NON contengono alcun dato sulla quota a breve, non inventare importi — lascia la voce invariata e segnala l'assenza del dato in "osservazioni". La regola 1) si applica invece SEMPRE, anche in presenza di dati contrari.
Rispondi SOLO con il JSON.`;

// ── RELAZIONE SULLA GESTIONE (RG) ────────────────────────────
// Filtro a 4 sezioni tematiche. Sezione fissa 1..4 in "sezione" per poter
// raggruppare gli estratti in 4 riquadri nella UI del Tab 3.
// Ancora temporale della Relazione sulla Gestione (gemella di niAncora).
const rgAncora = (anno) => `(esercizio di riferimento ${anno}: se si citano più esercizi considera i dati riferiti al ${anno})`;
const buildRgFilterPrompt = (anno = ANNO_RIF_DEFAULT) => `Sei un analista di bilancio. Il documento allegato è la RELAZIONE SULLA GESTIONE di un bilancio ${rgAncora(anno)}.
FASE 1 — FILTRO TEMATICO: leggi il documento e organizza le informazioni rilevanti in QUATTRO sezioni tematiche fisse, identificate dal campo "sezione" (numero 1..4):
1) CONTESTO MACROECONOMICO E SETTORE: andamento del mercato di riferimento, congiuntura, dinamiche di settore, posizionamento competitivo, fattori esterni che incidono sulla lettura patrimoniale.
2) MODELLO DI BUSINESS E AREE STRATEGICHE D'AFFARI (ASA): descrizione dei business, divisioni, segmenti operativi, aree geografiche, stabilimenti; informazioni utili ad attribuire attività/passività a specifiche aree o a distinguere gestione caratteristica vs accessoria.
3) FATTI DI RILIEVO E OPERAZIONI STRAORDINARIE: investimenti e disinvestimenti rilevanti, acquisizioni/cessioni, operazioni sul capitale, ristrutturazioni del debito, rivalutazioni, eventi successivi alla chiusura, garanzie e impegni assunti.
4) EVOLUZIONE PREVEDIBILE DELLA GESTIONE E CONTINUITÀ: prospettive, continuità aziendale (going concern), rischi finanziari (liquidità, credito, tasso), covenant, previsioni di indebitamento/investimento che qualificano natura e scadenza delle poste patrimoniali.
Per ogni informazione rilevante riporta gli importi ESATTI se presenti. IGNORA le parti puramente narrative senza impatto patrimoniale (es. auto-celebrazioni, informativa sul personale non patrimoniale, elenco cariche sociali).
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"pagine_rilevanti":[2,3,7],"estratti":[{"sezione":1,"pagina":2,"tema":"Andamento del settore","contenuto":"sintesi compatta con eventuali importi esatti"}]}
Regole: "sezione" è un intero da 1 a 4 secondo lo schema sopra; riporta in "contenuto" i dati numerici esatti in forma compatta; massimo 16 estratti complessivi, ciascuno massimo 600 caratteri; "pagina" è il numero di pagina del documento; se nulla è rilevante restituisci array vuoti. Rispondi SOLO con il JSON.`;

// Variante T-1: stesso filtro tematico a 4 sezioni, ma l'IA deve isolare
// esclusivamente i fatti e gli importi dell'esercizio comparativo.
const buildRgFilterPromptPrec = (anno = ANNO_RIF_DEFAULT) => `${ALLERTA_CONTAMINAZIONE}

${buildRgFilterPrompt(anno)}

⚠ ESERCIZIO DI RIFERIMENTO — ANNO PRECEDENTE (T-1):
Estrai ESCLUSIVAMENTE fatti e importi riferiti all'anno comparativo${annoPrecDi(anno) ? ` (${annoPrecDi(anno)})` : ""}, non all'anno corrente. Quando il management raffronta due esercizi, il dato dell'anno PRECEDENTE è il termine di paragone, non il valore di arrivo. Le informazioni prospettiche (obiettivi futuri) non vanno estratte qui.`;

/* ---- Variante «documento autonomo» della RG T-1 (Modalità Singolo Anno) ----
   Gemella della variante NI: la relazione caricata negli slot T-1 commenta il
   PROPRIO esercizio di chiusura, non quello comparativo. ---- */
const buildRgFilterPromptPrecAutonomo = (annoPrec = "") => `${buildRgFilterPrompt(annoValidoStr(annoPrec) || ANNO_RIF_DEFAULT)}

⚠⚠ ESERCIZIO DI RIFERIMENTO — DOCUMENTO AUTONOMO (Modalità Singolo Anno). Sovrascrive ogni indicazione precedente sull'esercizio:
- Il documento che stai analizzando è la Relazione sulla Gestione a sé stante di un esercizio già chiuso${annoValidoStr(annoPrec) ? ` (${annoValidoStr(annoPrec)})` : ""}, NON la relazione dell'anno corrente.
- Estrai fatti e importi dell'esercizio a cui la relazione si riferisce (il suo esercizio di chiusura).
- Quando il management raffronta due esercizi («i debiti scendono da X a Y»), il dato da estrarre è il valore di ARRIVO Y, non il termine di paragone X.
- Ignora tassativamente i dati riferiti ad altri esercizi presenti in questo stesso documento.`;

// Applicazione: gemello di buildNiApplyPrompt, ancorato alla Relazione sulla
// Gestione. Genera riclassificazioni e scomposizioni sulle stesse voci.
const buildRgApplyPrompt = (classiDoc = DEFAULT_CLASSI_DOC) => `Sei un analista di bilancio. Devi affinare la RICLASSIFICAZIONE dello Stato Patrimoniale per pertinenza gestionale usando le informazioni già filtrate dalla RELAZIONE SULLA GESTIONE.
VOCI ATTUALI dello Stato Patrimoniale (nome → importo → classe attuale):
{{VOCI}}
INFORMAZIONI FILTRATE DALLA RELAZIONE SULLA GESTIONE:
{{ESTRATTI}}
${classiDoc}
Usa le informazioni per: distinguere attività/passività della gestione caratteristica da quelle accessorie o estranee al core business (anche in base ai business/ASA descritti), qualificare la natura finanziaria od operativa di debiti e crediti, isolare poste connesse a operazioni straordinarie, riflettere rischi di continuità o scadenze che modificano la pertinenza gestionale delle voci.
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{
 "riclassificazioni": [{"voce":"nome esatto di una voce dell'elenco","classe":"nuovo codice classe","motivo":"max 1 frase: quale informazione della Relazione sulla Gestione giustifica lo spostamento di classe"}],
 "scomposizioni": [{"voce_originale":"nome esatto di una voce dell'elenco","dettagli":[{"nome":"Immobili civili non strumentali","importo":100,"classe":"att_accessoria"}],"motivo":"max 1 frase: quale informazione della Relazione sulla Gestione giustifica la scomposizione"}],
 "osservazioni": ["max 4 stringhe brevi: contesto, business, operazioni straordinarie o rischi di continuità rilevanti per la valutazione"]
}
Regole: usa "riclassificazioni" quando un'intera voce va spostata di classe; usa "scomposizioni" quando una voce aggregata va divisa (la somma dei dettagli deve essere ≤ dell'importo della voce originale; l'eventuale residuo resta nella voce originale). Proponi SOLO modifiche supportate dalle informazioni filtrate: se non hai elementi, restituisci array vuoti. Rispondi SOLO con il JSON.`;

// Metadati delle 4 sezioni tematiche della RG (per i riquadri della UI).
const RG_SEZIONI = [
  { n: 1, titolo: "Contesto macroeconomico e settore", icona: "🌍", tone: BLUE },
  { n: 2, titolo: "Modello di business e ASA", icona: "🏭", tone: GREEN },
  { n: 3, titolo: "Fatti di rilievo e operazioni straordinarie", icona: "⚡", tone: PURPLE },
  { n: 4, titolo: "Evoluzione prevedibile e continuità", icona: "🧭", tone: AMBER },
];

const NI_EVAL_PROMPT = `Sei un analista di bilancio senior. Devi VALUTARE e SPIEGARE l'impatto delle informazioni ricavate dalla Nota Integrativa sulla lettura dello Stato Patrimoniale riclassificato.
INFORMAZIONI DALLA NOTA INTEGRATIVA:
{{ESTRATTI}}
OSSERVAZIONI QUALITATIVE:
{{OSSERVAZIONI}}
QUADRO DEI MARGINI E INDICI CALCOLATI (nome: valore (giudizio automatico)):
{{QUADRO}}
Per ogni informazione rilevante della Nota Integrativa spiega in modo pratico: cosa significa per la solidità e la liquidità dell'azienda, quali margini o indici del quadro ne risentono e in che direzione (o quali giudizi automatici vanno letti con più cautela alla luce della NI), e quali rischi comporta (garanzie e beni ipotecati, covenant, scadenze concentrate, parti correlate, crediti dubbi, attività accessorie). Non ripetere i numeri senza commento: aggiungi interpretazione e collegamenti tra le informazioni.
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{
 "sintesi": "4-6 frasi di valutazione complessiva che integrano le informazioni della Nota Integrativa con il quadro degli indici",
 "valutazioni": [{"tema":"titolo breve","livello":"ok|warn|bad|info","spiegazione":"3-5 frasi pratiche e concrete","indici_collegati":"margini o indici interessati, separati da virgola"}]
}
Regole: massimo 8 valutazioni, ordinate per rilevanza decrescente; "livello" riflette l'impatto per chi legge il bilancio (ok=rassicurante, warn=da monitorare, bad=critico, info=neutro); basati SOLO sulle informazioni e sui valori forniti, senza inventare dati. Rispondi SOLO con il JSON.`;

// ── TAB 11 · AUDIT & AUTO-FIX ────────────────────────────────
// Prompt della "Checklist del Revisore": l'IA non riclassifica, CONTROLLA il
// lavoro già svolto (voci T, voci T-1 e Δ patrimoniali) e restituisce anomalie
// corredate sia dalla correzione puntuale sia dalla regola da memorizzare.
const buildAuditPrompt = ({ classiDoc, annoCorr, annoPrec, vociTxt, vociPrecTxt, deltaTxt, schemaTxt }) => `Sei un REVISORE CONTABILE SENIOR incaricato di sottoporre a controllo di qualità una riclassificazione di Stato Patrimoniale per pertinenza gestionale già eseguita da un altro analista. Il tuo compito NON è riclassificare da zero: devi trovare gli ERRORI del lavoro esistente, spiegarli e indicare come correggerli.
${schemaTxt}
FORMATO NUMERICO: tutti gli importi che seguono sono numeri grezzi, con il punto come separatore decimale e NESSUN separatore delle migliaia.

VOCI DELL'ESERCIZIO CORRENTE ${annoCorr} (formato: [id] nome | importo | sezione | classe assegnata):
${vociTxt}

VOCI DELL'ESERCIZIO PRECEDENTE ${annoPrec} (stesso formato):
${vociPrecTxt}

DELTA PATRIMONIALI CALCOLATI DAL SISTEMA (${annoCorr} − ${annoPrec}):
${deltaTxt}

${classiDoc}

ESEGUI ORA, NELL'ORDINE, QUESTA CHECKLIST DEL REVISORE IN 5 PUNTI:
1) QUADRATURA E ALLUCINAZIONI MATEMATICHE — Verifica che gli importi siano plausibili e coerenti tra loro: totale attivo ≈ totale passivo, assenza di ordini di grandezza incongrui rispetto alle voci vicine (es. un importo mille volte più grande o più piccolo del resto del prospetto), assenza di segni algebrici sbagliati (voci che dovrebbero essere positive esposte come negative e viceversa, con l'eccezione legittima di perdita d'esercizio e azioni proprie), assenza di voci duplicate o di totali/subtotali estratti per errore come se fossero voci di dettaglio.
2) COERENZA TRA GLI ANNI — La STESSA voce (o una voce con denominazione equivalente) presente in entrambi gli esercizi DEVE avere la STESSA classe di pertinenza gestionale, salvo un reale cambiamento di natura o di scadenza. Ogni disallineamento di classe tra ${annoCorr} e ${annoPrec} è un errore da segnalare: indica quale dei due anni è classificato male e correggi QUELLO, non entrambi.
3) REGOLE IAS/IFRS INVIOLABILI — Controlla il rispetto delle regole tassative, indipendentemente da quanto suggerisca il documento: 'Deferred tax assets' / imposte anticipate SEMPRE in "att_op_immobilizzata" e MAI scomposte tra corrente e non corrente; 'Deferred tax liabilities' / imposte differite passive SEMPRE in "pass_op_non_corrente"; TFR e benefici ai dipendenti (IAS 19) SEMPRE in "pass_op_non_corrente"; 'Lease liabilities' (IFRS 16) SEMPRE in "pass_fin_corrente" o "pass_fin_non_corrente", MAI tra i debiti operativi; 'Right-of-use assets' in "att_op_immobilizzata"; 'Advances from customers' e 'Other liabilities' del ciclo commerciale in "pass_op_corrente" salvo scadenza esplicita oltre 12 mesi.
4) TEST DEI DELTA PATRIMONIALI — Analizza i Δ sopra riportati alla ricerca di variazioni anno-su-anno MACROSCOPICHE che non siano spiegabili da una reale dinamica aziendale ma che siano invece il sintomo di un CAMBIO DI CLASSIFICAZIONE tra i due anni (il caso tipico: una macro-voce scomposta tra breve e lungo termine in un solo esercizio, oppure crediti da finanziamento captive allocati interamente a breve in un anno e a lungo nell'altro). Quando individui un Δ anomalo, RISALI alla voce che lo genera e segnala QUELLA voce.
5) VOCI ORFANE — Segnala ogni voce ancora classificata "da_classificare" (in entrambi gli esercizi) e proponi la classe corretta desumibile dalla denominazione.

Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{
 "esito": "superato",
 "messaggioGenerale": "Testo riassuntivo dell'esito complessivo del controllo, 2-4 frasi.",
 "anomalie": [
  {
   "idVoce": "id esatto della voce errata, copiato dalle parentesi quadre degli elenchi sopra",
   "esercizio": "corrente",
   "titoloErrore": "titolo breve del tipo di errore, es. Coerenza tra gli anni violata",
   "spiegazioneErrore": "2-4 frasi: perché è un errore, quale punto della checklist viola e quale effetto produce su margini, indici o Δ patrimoniali",
   "autoFix": { "eseguibile": true, "nuovaClasse": "codice classe corretto" },
   "promptUpdateSuggestion": { "target": "CLASSI_DOC", "nuovaRegola": "Regola operativa da aggiungere ai prompt di sistema affinché l'errore non si ripeta nelle estrazioni future." }
  }
 ]
}
Regole tassative sul formato:
- "esito" vale "superato" SOLO se non hai trovato alcuna anomalia (in tal caso "anomalie" è un array vuoto); altrimenti vale "errori".
- "idVoce" deve essere un id ESISTENTE copiato letteralmente dagli elenchi: non inventarlo, non usare il nome della voce. Se l'anomalia non è riconducibile a una voce specifica, ometti l'anomalia.
- "esercizio" vale "corrente" se l'id appartiene all'elenco ${annoCorr}, "precedente" se appartiene all'elenco ${annoPrec}.
- "autoFix.eseguibile" è true SOLO se la correzione consiste nel cambio di classe di quella singola voce e "nuovaClasse" è uno dei codici classe validi elencati sopra; se la correzione richiede una scomposizione, una rettifica di importo o un intervento manuale, metti "eseguibile": false e ometti "nuovaClasse", spiegando nel testo cosa deve fare l'utente.
- "promptUpdateSuggestion.target" vale "CLASSI_DOC" se la regola riguarda la natura/definizione delle classi, "SCHEMI" se riguarda una convenzione specifica del sistema contabile (OIC, IAS/IFRS, US GAAP). "nuovaRegola" deve essere una frase imperativa, autoconclusiva e generalizzabile (NON riferita a questa singola azienda o a questo singolo importo), max 400 caratteri. Ometti l'intero campo "promptUpdateSuggestion" se l'errore è un refuso irripetibile e non generalizzabile.
- Massimo 12 anomalie, ordinate per gravità decrescente. Non segnalare come errore una scelta semplicemente opinabile ma difendibile: segnala solo violazioni effettive della checklist.
Rispondi SOLO con il JSON.`;

// Sanificazione della risposta di audit: funzione PURA (testabile a parte).
// Tiene solo le anomalie ancorate a un id di voce realmente esistente e
// declassa ad "eseguibile: false" ogni autoFix che proponga una classe
// inesistente, identica a quella attuale o incompatibile con la sezione.
function sanificaAnomalie(parsed, vociCorr, vociPrec) {
  const indice = new Map();
  vociCorr.forEach((v) => indice.set(v.id, { voce: v, esercizio: "corrente" }));
  vociPrec.forEach((v) => indice.set(v.id, { voce: v, esercizio: "precedente" }));

  return (Array.isArray(parsed?.anomalie) ? parsed.anomalie : [])
    .map((a) => {
      const id = String(a?.idVoce || "").trim();
      const hit = indice.get(id);
      if (!hit) return null;
      const { voce, esercizio } = hit;
      const nuovaClasse = a?.autoFix?.nuovaClasse;
      const classeOk =
        !!CLASSI[nuovaClasse] &&
        nuovaClasse !== voce.classe &&
        (CLASSI[nuovaClasse].sez === voce.sezione || CLASSI[nuovaClasse].sez === "entrambi");
      const sug = a?.promptUpdateSuggestion;
      const sugOk =
        !!sug && typeof sug.nuovaRegola === "string" && sug.nuovaRegola.trim().length > 10 &&
        (sug.target === "CLASSI_DOC" || sug.target === "SCHEMI");
      return {
        idVoce: id,
        esercizio,
        nomeVoce: voce.nome,
        classeAttuale: voce.classe,
        importo: parse(voce.importo),
        titoloErrore: String(a?.titoloErrore || "Anomalia rilevata").trim(),
        spiegazioneErrore: String(a?.spiegazioneErrore || "").trim(),
        autoFix: { eseguibile: !!a?.autoFix?.eseguibile && classeOk, nuovaClasse: classeOk ? nuovaClasse : null },
        promptUpdateSuggestion: sugOk ? { target: sug.target, nuovaRegola: sug.nuovaRegola.trim() } : null,
      };
    })
    .filter(Boolean);
}

// Appende una regola appresa ai prompt di sistema. Anch'essa PURA: restituisce
// un nuovo oggetto systemPrompts senza mutare quello ricevuto.
function applicaRegolaAppresa(sp, sug, schemaAttivo) {
  const riga = `\n⚠ REGOLA APPRESA DALL'AUDIT: ${sug.nuovaRegola}`;
  const next = {
    ...sp,
    SCHEMI: { ...sp.SCHEMI },
    regoleApprese: [
      ...(sp.regoleApprese || []),
      { target: sug.target, testo: sug.nuovaRegola, quando: new Date().toLocaleString("it-IT") },
    ],
  };
  if (sug.target === "CLASSI_DOC") {
    next.CLASSI_DOC = sp.CLASSI_DOC + riga;
  } else {
    // Se lo schema contabile è già stato riconosciuto la regola va solo lì;
    // altrimenti va su tutti i profili, così non si perde qualunque schema
    // venga riconosciuto nella prossima estrazione.
    const chiavi = schemaAttivo && sp.SCHEMI[schemaAttivo] ? [schemaAttivo] : Object.keys(sp.SCHEMI);
    chiavi.forEach((k) => { next.SCHEMI[k] = { ...sp.SCHEMI[k], regole: sp.SCHEMI[k].regole + riga }; });
  }
  return next;
}

function calcKit(s) {
  const attOpCorrTot = s.attOpMag + s.attOpCorr;
  const ccno = attOpCorrTot - s.passOpCorr;
  const fosn = s.immobOper - s.passOpNC;
  const cinOper = ccno + fosn;
  const cinTot = cinOper + s.accessori;
  const attFin = s.liq + s.finAltre;
  const debFin = s.debFinC + s.debFinNC;
  const pfn = debFin - attFin;
  const attivoFisso = s.immobOper + s.accessori;
  const liqDifferite = s.attOpCorr + s.finAltre;
  const attivoCircolante = s.attOpMag + liqDifferite + s.liq;
  const totImpieghi = attivoFisso + attivoCircolante;
  const passCorrenti = s.passOpCorr + s.debFinC;
  const passConsolidate = s.passOpNC + s.debFinNC;
  const totFonti = s.pn + passConsolidate + passCorrenti;
  return {
    ...s, ccno, fosn, cinOper, cinTot, attFin, debFin, pfn,
    attivoFisso, attivoCircolante, passCorrenti, passConsolidate, totImpieghi, totFonti,
    msPrimario: s.pn - attivoFisso,
    msSecondario: s.pn + passConsolidate - attivoFisso,
    ccn: attivoCircolante - passCorrenti,
    mt: s.liq + liqDifferite - passCorrenti,
    autonomia: totFonti > 0 ? s.pn / totFonti : null,
    leverage: s.pn > 0 ? totImpieghi / s.pn : null,
    copSecondaria: attivoFisso > 0 ? (s.pn + passConsolidate) / attivoFisso : null,
    current: passCorrenti > 0 ? attivoCircolante / passCorrenti : null,
    quick: passCorrenti > 0 ? (s.liq + liqDifferite) / passCorrenti : null,
    gearing: s.pn > 0 ? pfn / s.pn : null,
    copPrimaria: attivoFisso > 0 ? s.pn / attivoFisso : null,
    liqSecca: passCorrenti > 0 ? s.liq / passCorrenti : null,
    pfnBreve: s.debFinC - attFin,
    rigidita: totImpieghi > 0 ? attivoFisso / totImpieghi : null,
    dipendenza: totFonti > 0 ? (passConsolidate + passCorrenti) / totFonti : null,
    pfnSuCin: cinTot > 0 ? pfn / cinTot : null,
    incidenzaAccessoria: cinTot > 0 ? s.accessori / cinTot : null,
  };
}

// ── AGGREGAZIONE PER CLASSI (funzione pura) ──────────────────
// Estratta dal useMemo di `r` per essere riutilizzata IDENTICA sia per
// l'esercizio corrente (voci) sia per l'esercizio precedente (vociPrec):
// così rPrec processa vociPrec ESATTAMENTE come r processa voci.
function riclassificaVoci(voci) {
  const sum = (...classi) =>
    voci.filter((v) => classi.includes(v.classe)).reduce((a, v) => a + parse(v.importo), 0);
  const of = (...classi) => voci.filter((v) => classi.includes(v.classe));

  const attOpMag = sum("att_op_magazzino");
  const attOpCorr = sum("att_op_corrente");
  const attOpCorrTot = attOpMag + attOpCorr;
  const passOpCorr = sum("pass_op_corrente");
  const ccno = attOpCorrTot - passOpCorr;
  const immobOper = sum("att_op_immobilizzata");
  const passOpNC = sum("pass_op_non_corrente");
  const cinOper = ccno + immobOper - passOpNC;
  const accessori = sum("att_accessoria");
  const cinTot = cinOper + accessori;
  const liq = sum("att_fin_liquidita");
  const finAltre = sum("att_fin_altre");
  const attFin = liq + finAltre;
  const totImpieghiFun = cinTot + attFin;
  const pn = sum("pn");
  const debFinC = sum("pass_fin_corrente");
  const debFinNC = sum("pass_fin_non_corrente");
  const debFin = debFinC + debFinNC;
  const totFontiFun = pn + debFin;
  const pfn = debFin - attFin;
  const fosn = immobOper - passOpNC;
  const pfnBreve = debFinC - attFin;

  const attivoFisso = immobOper + accessori;
  const liqDifferite = attOpCorr + finAltre;
  const attivoCircolante = attOpMag + liqDifferite + liq;
  const totImpieghi = attivoFisso + attivoCircolante;
  const passCorrenti = passOpCorr + debFinC;
  const passConsolidate = passOpNC + debFinNC;
  const totFonti = pn + passConsolidate + passCorrenti;
  const capitaleTerzi = passConsolidate + passCorrenti;

  const nonClass = voci.filter((v) => v.classe === "da_classificare");
  const nonClassAtt = nonClass.filter((v) => v.sezione === "attivo").reduce((a, v) => a + parse(v.importo), 0);
  const nonClassPass = nonClass.filter((v) => v.sezione === "passivo").reduce((a, v) => a + parse(v.importo), 0);

  const totAttivoContab = voci.filter((v) => v.sezione === "attivo").reduce((a, v) => a + parse(v.importo), 0);
  const totPassivoContab = voci.filter((v) => v.sezione === "passivo").reduce((a, v) => a + parse(v.importo), 0);

  const msPrimario = pn - attivoFisso;
  const msSecondario = pn + passConsolidate - attivoFisso;
  const ccn = attivoCircolante - passCorrenti;
  const mt = liq + liqDifferite - passCorrenti;

  const idx = totImpieghi > 0 && totFonti > 0;
  return {
    of,
    attOpMag, attOpCorr, attOpCorrTot, passOpCorr, ccno, immobOper, passOpNC, cinOper,
    accessori, cinTot, liq, finAltre, attFin, totImpieghiFun, pn, debFinC, debFinNC, debFin, totFontiFun, pfn,
    attivoFisso, liqDifferite, attivoCircolante, totImpieghi, passCorrenti, passConsolidate, totFonti, capitaleTerzi,
    nonClass, nonClassAtt, nonClassPass, totAttivoContab, totPassivoContab,
    msPrimario, msSecondario, ccn, mt, fosn, pfnBreve,
    rigidita: idx ? attivoFisso / totImpieghi : 0,
    elasticita: idx ? attivoCircolante / totImpieghi : 0,
    autonomia: idx ? pn / totFonti : 0,
    dipendenza: idx ? capitaleTerzi / totFonti : 0,
    leverage: pn > 0 ? totImpieghi / pn : null,
    copPrimaria: attivoFisso > 0 ? pn / attivoFisso : null,
    copSecondaria: attivoFisso > 0 ? (pn + passConsolidate) / attivoFisso : null,
    current: passCorrenti > 0 ? attivoCircolante / passCorrenti : null,
    quick: passCorrenti > 0 ? (liq + liqDifferite) / passCorrenti : null,
    liqSecca: passCorrenti > 0 ? liq / passCorrenti : null,
    gearing: pn > 0 ? pfn / pn : null,
    pfnSuCin: cinTot > 0 ? pfn / cinTot : null,
    incidenzaAccessoria: cinTot > 0 ? accessori / cinTot : null,
    pesoCcno: cinTot > 0 ? ccno / cinTot : null,
  };
}

const RANK = { ok: 0, info: 0, warn: 1, bad: 2 };
// Elenco ordinato di margini e indici con soglie di giudizio, riusato per la
// visualizzazione compatta degli indici (incluso l'esercizio precedente nella
// sezione dei Δ). Le soglie sono IDENTICHE a quelle del prospetto principale.
const CONFRONTO_ROWS = [
  // ── Margini del criterio finanziario ──
  { sez: "Margini del criterio finanziario", k: "pn", nome: "Patrimonio netto", f: (v) => fmt(v), lev: () => "info", peggioSe: "minore" },
  { sez: "Margini del criterio finanziario", k: "msPrimario", nome: "Margine di struttura primario", f: (v) => fmt(v), lev: (v) => (v >= 0 ? "ok" : "info"), peggioSe: "minore" },
  { sez: "Margini del criterio finanziario", k: "msSecondario", nome: "Margine di struttura secondario", f: (v) => fmt(v), lev: (v) => (v >= 0 ? "ok" : "bad"), peggioSe: "minore" },
  { sez: "Margini del criterio finanziario", k: "ccn", nome: "Capitale circolante netto (CCN)", f: (v) => fmt(v), lev: (v) => (v > 0 ? "ok" : "bad"), peggioSe: "minore" },
  { sez: "Margini del criterio finanziario", k: "mt", nome: "Margine di tesoreria", f: (v) => fmt(v), lev: (v) => (v >= 0 ? "ok" : "warn"), peggioSe: "minore" },
  // ── Grandezze della pertinenza gestionale ──
  { sez: "Grandezze della pertinenza gestionale", k: "ccno", nome: "Capitale circolante netto operativo (CCNO)", f: (v) => fmt(v), lev: () => "info", peggioSe: "maggiore" },
  { sez: "Grandezze della pertinenza gestionale", k: "fosn", nome: "Fabbisogno operativo strutturale netto (FOSN)", f: (v) => fmt(v), lev: () => "info", peggioSe: "maggiore" },
  { sez: "Grandezze della pertinenza gestionale", k: "cinOper", nome: "COIN (capitale operativo investito)", f: (v) => fmt(v), lev: () => "info", peggioSe: "maggiore" },
  { sez: "Grandezze della pertinenza gestionale", k: "pfn", nome: "Posizione finanziaria netta complessiva", f: (v) => fmt(v), lev: (v) => (v <= 0 ? "ok" : "info"), peggioSe: "maggiore" },
  { sez: "Grandezze della pertinenza gestionale", k: "pfnBreve", nome: "Posizione finanziaria netta a breve", f: (v) => fmt(v), lev: (v) => (v <= 0 ? "ok" : "warn"), peggioSe: "maggiore" },
  // ── Indici di solidità ──
  { sez: "Indici di solidità", k: "autonomia", nome: "Autonomia finanziaria", f: (v) => (v == null ? "n.d." : pct(v)), lev: (v) => (v == null ? "bad" : v >= 0.66 ? "ok" : v >= 0.33 ? "warn" : "bad"), peggioSe: "minore" },
  { sez: "Indici di solidità", k: "dipendenza", nome: "Dipendenza finanziaria", f: (v) => (v == null ? "n.d." : pct(v)), lev: () => "info", peggioSe: "maggiore" },
  { sez: "Indici di solidità", k: "leverage", nome: "Leverage", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "bad" : v <= 2 ? "ok" : v <= 3 ? "warn" : "bad"), peggioSe: "maggiore" },
  { sez: "Indici di solidità", k: "copPrimaria", nome: "Copertura primaria immobilizzazioni", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "info" : v >= 1 ? "ok" : "info"), peggioSe: "minore" },
  { sez: "Indici di solidità", k: "copSecondaria", nome: "Copertura secondaria immobilizzazioni", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "info" : v >= 1 ? "ok" : "bad"), peggioSe: "minore" },
  { sez: "Indici di solidità", k: "rigidita", nome: "Rigidità degli impieghi", f: (v) => (v == null ? "n.d." : pct(v)), lev: () => "info", peggioSe: "maggiore" },
  // ── Indici di liquidità ──
  { sez: "Indici di liquidità", k: "current", nome: "Indice di disponibilità (current ratio)", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "info" : v >= 2 ? "ok" : v >= 1 ? "warn" : "bad"), peggioSe: "minore" },
  { sez: "Indici di liquidità", k: "quick", nome: "Indice di liquidità (quick ratio)", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "info" : v >= 1 ? "ok" : v >= 0.7 ? "warn" : "bad"), peggioSe: "minore" },
  { sez: "Indici di liquidità", k: "liqSecca", nome: "Liquidità immediata", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: () => "info", peggioSe: "minore" },
  // ── Struttura finanziaria (pertinenza gestionale) ──
  { sez: "Struttura finanziaria (pertinenza gestionale)", k: "gearing", nome: "Gearing (PFN / PN)", f: (v) => (v == null ? "n.d." : fmt2(v)), lev: (v) => (v == null ? "bad" : v <= 1 ? "ok" : v <= 2 ? "warn" : "bad"), peggioSe: "maggiore" },
  { sez: "Struttura finanziaria (pertinenza gestionale)", k: "pfnSuCin", nome: "PFN / Capitale investito", f: (v) => (v == null ? "n.d." : pct(v)), lev: () => "info", peggioSe: "maggiore" },
  { sez: "Struttura finanziaria (pertinenza gestionale)", k: "incidenzaAccessoria", nome: "Incidenza gestione accessoria", f: (v) => (v == null ? "n.d." : pct(v)), lev: (v) => (v != null && v > 0.25 ? "warn" : "info"), peggioSe: "maggiore" },
];

const CLASSI_SEGMENTABILI = ["att_op_magazzino", "att_op_corrente", "att_op_immobilizzata", "pass_op_corrente", "pass_op_non_corrente"];

const ASA_PROMPT = `Sei un analista di bilancio esperto di Segment Reporting. L'azienda è multi-business e l'utente ha definito le seguenti Aree Strategiche d'Affari (formato "id: nome"):
{{ASA}}
Eventuali informazioni dalla Nota Integrativa (possono citare divisioni, settori, stabilimenti o aree geografiche):
{{NI}}
Elenco delle voci OPERATIVE dello Stato Patrimoniale da allocare (formato "id | denominazione | classe | importo"):
{{VOCI}}
Per ogni voce proponi l'allocazione più plausibile basandoti ESCLUSIVAMENTE sulla denominazione della voce e sulle informazioni fornite: l'id di una ASA se la voce è chiaramente dedicata a quell'area (es. per riferimenti espliciti nel nome), altrimenti "comune" per gli asset condivisi o non attribuibili in modo oggettivo (sede centrale, sistemi informatici di gruppo, logistica centralizzata, voci generiche). Regola prudenziale: nel dubbio usa SEMPRE "comune", non forzare mai un'allocazione.
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"allocazioni":[{"voce":"id della voce","dest":"id della ASA oppure comune","motivo":"max 1 frase"}]}`;

// ── COMPONENTI UI ────────────────────────────────────────────
function Badge({ level, text }) {
  const colors = {
    ok: { bg: "#E4F1EA", fg: GREEN, dot: GREEN },
    warn: { bg: "#F7EEDB", fg: "#8A6414", dot: AMBER },
    bad: { bg: "#F6E5E3", fg: RED, dot: RED },
    info: { bg: "#E8EDF6", fg: BLUE, dot: BLUE },
  };
  const c = colors[level] || colors.info;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.fg }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {text}
    </span>
  );
}

function ClasseChip({ code }) {
  const c = CLASSI[code];
  if (!c) return <span className="text-xs opacity-50">{code || "—"}</span>;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium leading-snug"
      style={{ background: `${c.color}1A`, color: c.color }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
      {c.label}
    </span>
  );
}

function SectionCard({ title, tone, children }) {
  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: LINE, background: CARD }}>
      <div className="px-4 py-2 text-xs font-semibold uppercase"
        style={{ background: tone, color: "#fff", fontFamily: "'Libre Franklin', sans-serif", letterSpacing: "0.12em" }}>
        {title}
      </div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

function Row({ label, value, bold, indent, color, sign, small }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${bold ? "font-semibold" : ""}`}
      style={{ paddingLeft: indent ? 16 : 0, color: color || INK }}>
      <span className={small ? "text-xs" : "text-sm"}>{sign ? `${sign} ` : ""}{label}</span>
      <span className={small ? "text-xs" : "text-sm"} style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{fmt(value)}</span>
    </div>
  );
}

function H2({ children }) {
  return (
    <h2 className="text-lg mb-3" style={{ fontFamily: "'Libre Franklin', sans-serif", fontWeight: 800 }}>
      {children}
    </h2>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white flex-shrink-0"
      style={{ borderTopColor: "transparent", animation: "spin .8s linear infinite" }} />
  );
}

function GruppoVoci({ titolo, voci, subtot, subtotLabel, color, segno }) {
  return (
    <>
      {voci.map((vv) => (
        <Row key={vv.id} label={vv.nome} value={parse(vv.importo)} indent sign={segno} small />
      ))}
      {voci.length === 0 && (
        <div className="text-xs opacity-40 py-1" style={{ paddingLeft: 16 }}>— nessuna voce di questa natura nel bilancio —</div>
      )}
      <div style={{ borderTop: `1px dashed ${LINE}` }}>
        <Row label={subtotLabel || titolo} value={subtot} bold indent color={color} />
      </div>
    </>
  );
}

const HL_YEL = "#FCE96A";
const HL_GRN = "#A8D08D";

function FRiga({ nome, val }) {
  return (
    <div className="flex justify-between gap-2 px-2 py-1 border-b" style={{ borderColor: "#EDEFE9" }}>
      <span className="text-xs">{nome}</span>
      <span className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{fmt(val)}</span>
    </div>
  );
}

function FSub({ label }) {
  return (
    <div className="px-2 py-1 text-xs italic font-semibold border-b" style={{ borderColor: LINE, background: "#FAFBF8" }}>
      {label}
    </div>
  );
}

function FTot({ label, val, hl }) {
  return (
    <div className="flex justify-between gap-2 px-2 py-1 border-b font-semibold" style={{ borderColor: LINE, background: hl }}>
      <span className="text-xs uppercase">{label}</span>
      <span className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{fmt(val)}</span>
    </div>
  );
}

function FVoci({ voci }) {
  if (voci.length === 0) return <div className="px-2 py-1 text-xs opacity-40">— nessuna voce —</div>;
  return voci.map((v) => <FRiga key={v.id} nome={v.nome} val={parse(v.importo)} />);
}

function TabelleAree({ r }) {
  return (
    <div className="space-y-4 mb-6">
      <div className="rounded-lg overflow-hidden border" style={{ borderColor: INK, background: CARD }}>
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-white"
          style={{ background: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>
          Area operativa — gestione caratteristica
        </div>
        <div className="grid md:grid-cols-2">
          <div className="md:border-r" style={{ borderColor: LINE }}>
            <div className="px-2 py-1.5 text-sm font-bold border-b" style={{ borderColor: INK }}>Attività Operative</div>
            <FSub label="Correnti" />
            <FVoci voci={r.of("att_op_magazzino", "att_op_corrente")} />
            <FTot label="Totale attività correnti operative" val={r.attOpCorrTot} hl={HL_YEL} />
            <FSub label="Strutturali" />
            <FVoci voci={r.of("att_op_immobilizzata")} />
            <FTot label="Totale attività strutturali operative" val={r.immobOper} hl={HL_YEL} />
            {r.of("att_accessoria").length > 0 && (
              <>
                <FSub label="Accessorie (extra-caratteristiche)" />
                <FVoci voci={r.of("att_accessoria")} />
                <FTot label="Totale impieghi accessori" val={r.accessori} hl={HL_YEL} />
              </>
            )}
          </div>
          <div>
            <div className="px-2 py-1.5 text-sm font-bold border-b" style={{ borderColor: INK }}>Passività Operative</div>
            <FSub label="Correnti" />
            <FVoci voci={r.of("pass_op_corrente")} />
            <FTot label="Totale passività correnti operative" val={r.passOpCorr} hl={HL_GRN} />
            <FSub label="Strutturali" />
            <FVoci voci={r.of("pass_op_non_corrente")} />
            <FTot label="Totale passività strutturali operative" val={r.passOpNC} hl={HL_GRN} />
          </div>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border" style={{ borderColor: INK, background: CARD }}>
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-white"
          style={{ background: BLUE, fontFamily: "'Libre Franklin', sans-serif" }}>
          Area finanziaria e capitale netto
        </div>
        <div className="grid md:grid-cols-2">
          <div className="md:border-r" style={{ borderColor: LINE }}>
            <div className="px-2 py-1.5 text-sm font-bold border-b" style={{ borderColor: INK }}>Attività Finanziarie</div>
            <FSub label="Cash & cash equivalents" />
            <FVoci voci={r.of("att_fin_liquidita")} />
            <FSub label="Investimenti finanziari" />
            <FVoci voci={r.of("att_fin_altre")} />
            <FTot label="Totale attività finanziarie" val={r.attFin} hl={HL_YEL} />
          </div>
          <div>
            <div className="px-2 py-1.5 text-sm font-bold border-b" style={{ borderColor: INK }}>Passività Finanziarie / Capitale Netto</div>
            <FSub label="Passività a breve" />
            <FVoci voci={r.of("pass_fin_corrente")} />
            <FSub label="Passività a medio-lungo" />
            <FVoci voci={r.of("pass_fin_non_corrente")} />
            <FTot label="Totale debiti finanziari" val={r.debFin} hl={HL_GRN} />
            <FSub label="Capitale netto" />
            <FVoci voci={r.of("pn")} />
            <FTot label="Totale passività finanziarie e netto" val={r.totFontiFun} hl={HL_GRN} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onLoad }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
      <p className="font-semibold mb-1">Nessuna voce disponibile</p>
      <p className="text-sm opacity-70 mb-4">
        Carica un bilancio (l'IA estrae tutte le voci), aggiungi le voci a mano o usa i dati d'esempio.
      </p>
      <button onClick={onLoad} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
        ← Vai a dati e validazione
      </button>
    </div>
  );
}

function CardInd({ m, onOpen }) {
  const isNum = typeof m.val === "number";
  return (
    <button onClick={() => onOpen(m)} title="Clicca per vedere calcolo e interpretazione"
      className="rounded-lg border p-4 flex flex-col gap-2 text-left w-full hover:shadow-md"
      style={{ borderColor: LINE, background: CARD, cursor: "pointer", transition: "box-shadow .15s" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-snug">{m.nome}</div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-semibold" style={{ background: "#E8EDF6", color: BLUE }}>ⓘ dettagli</span>
      </div>
      <div className="text-xl" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: m.colVal || (isNum ? (m.val >= 0 ? GREEN : RED) : INK) }}>
        {isNum ? fmt(m.val) : m.val}
      </div>
      <div className="text-xs opacity-60" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{m.formula}</div>
      {m.desc && <p className="text-xs opacity-70">{m.desc}</p>}
      <Badge level={m.giud[0]} text={m.giud[1]} />
    </button>
  );
}

function DettaglioModal({ m, onClose }) {
  if (!m) return null;
  const isNum = typeof m.val === "number";
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-lg" style={{ background: CARD }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 px-6 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: LINE, background: PAPER }}>
          <div>
            <h3 className="font-semibold leading-snug" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>{m.nome}</h3>
            <div className="text-2xl mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: m.colVal || (isNum ? (m.val >= 0 ? GREEN : RED) : INK) }}>
              {isNum ? fmt(m.val) : m.val}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none opacity-60 hover:opacity-100 flex-shrink-0">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>Formula</div>
            <div className="text-sm px-3 py-2 rounded border" style={{ background: "#FAFBF8", borderColor: LINE, fontFamily: "'IBM Plex Mono', monospace" }}>{m.formula}</div>
          </div>
          {m.comp && m.comp.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>Come è stato calcolato — dati del bilancio</div>
              <div className="rounded border overflow-hidden" style={{ borderColor: LINE }}>
                {m.comp.map((c, i) => (
                  <div key={i} className="flex justify-between gap-3 px-3 py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none", background: "#FDFDFB" }}>
                    <span>{c.s ? `${c.s} ` : ""}{c.l}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{fmt(c.v)}</span>
                  </div>
                ))}
                {m.calc && (
                  <div className="px-3 py-2 text-sm font-semibold" style={{ borderTop: `2px solid ${INK}`, fontFamily: "'IBM Plex Mono', monospace", background: "#FAFBF8" }}>
                    {m.calc}
                  </div>
                )}
              </div>
            </div>
          )}
          {(!m.comp || m.comp.length === 0) && m.calc && (
            <div>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>Come è stato calcolato</div>
              <div className="text-sm px-3 py-2 rounded border" style={{ background: "#FAFBF8", borderColor: LINE, fontFamily: "'IBM Plex Mono', monospace" }}>{m.calc}</div>
            </div>
          )}
          {m.sig && (
            <div>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: BLUE, fontFamily: "'Libre Franklin', sans-serif" }}>Cosa significa in pratica</div>
              <p className="text-sm leading-relaxed">{m.sig}</p>
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: INK, fontFamily: "'Libre Franklin', sans-serif" }}>Valutazione per questo bilancio</div>
            <Badge level={m.giud[0]} text={m.giud[1]} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
export default function RiclassificazioneSP({ annoRiferimento } = {}) {
  ANNO_RIF_DEFAULT = annoValidoStr(annoRiferimento) || ANNO_RIF_BASE;
  const [voci, setVoci] = useState([]);
  const [esercizio, setEsercizio] = useState("");
  const [tab, setTab] = useState("dati");
  const [ai, setAi] = useState({
    master: { loading: false, error: null, ok: null },
    sp: { loading: false, error: null, ok: null },
    ni: { loading: false, error: null, ok: null },
    rg: { loading: false, error: null, ok: null },
    spPrec: { loading: false, error: null, ok: null },
    niPrec: { loading: false, error: null, ok: null },
    rgPrec: { loading: false, error: null, ok: null },
  });
  // ── PROMPT DI SISTEMA AUTO-APPRENDENTI (Tab 11) ─────────────
  // Sostituiscono le vecchie costanti CLASSI_DOC e SCHEMI: il contenuto vive
  // qui, viene letto da tutte le funzioni che chiamano callAI e persiste nel
  // localStorage del browser, così le regole apprese sopravvivono al reload.
  const [systemPrompts, setSystemPrompts] = useState(() => caricaSystemPrompts());
  // Scrive stato + localStorage in un colpo solo (unico punto di persistenza).
  const salvaSystemPrompts = (next) => { setSystemPrompts(next); scriviSystemPrompts(next); };
  const resetSystemPrompts = () => {
    try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(SP_PROMPTS_KEY); } catch { /* noop */ }
    setSystemPrompts(promptsDiDefault());
  };
  // ── STATO DELL'AUDIT (Tab 11) ───────────────────────────────
  const [auditState, setAuditState] = useState({ loading: false, data: null, error: null });
  // Esiti delle azioni per indice di anomalia: { [i]: { fix: bool, learn: bool } }
  const [auditAzioni, setAuditAzioni] = useState({});
  const [schemaInfo, setSchemaInfo] = useState(null);
  const [spFase, setSpFase] = useState(null);
  // Flusso SP: "corrente" (solo 2025), "precedente" (solo 2024), "entrambi"
  // (2025 + estrazione della colonna comparativa 2024 dallo stesso documento).
  const [spFlow, setSpFlow] = useState("corrente");
  // ── MODALITÀ SINGOLO ANNO (opzionale) ───────────────────────
  // Quando attiva, l'IA estrae ESCLUSIVAMENTE i dati dell'anno indicato
  // (popolati solo nelle sezioni dell'anno corrente T) e la seconda
  // passata automatica per l'esercizio precedente (T-1) viene bloccata.
  const [modalitaSingoloAnno, setModalitaSingoloAnno] = useState(false);
  const [annoSpecifico, setAnnoSpecifico] = useState("");
  /* Modalità Singolo Anno · anno dei documenti caricati negli slot T-1.
     In questa modalità il T-1 non proviene più dalla colonna comparativa del
     bilancio corrente, ma da documenti AUTONOMI di un altro esercizio: serve
     quindi un secondo anno di riferimento, distinto da annoSpecifico. */
  const [annoSpecificoPrec, setAnnoSpecificoPrec] = useState("");
  /* Anni di riferimento effettivi dei prompt e delle etichette:
     · annoRif      → esercizio T (annoSpecifico se la modalità è attiva e
                      l'anno è valido, altrimenti l'esercizio di default);
     · annoRifPrec  → esercizio T-1 (annoSpecificoPrec se valorizzato,
                      altrimenti l'anno immediatamente precedente a annoRif). */
  const annoSingoloValido = !!annoValidoStr(annoSpecifico);
  const singoloAnnoAttivo = modalitaSingoloAnno && annoSingoloValido;
  const annoRif = (singoloAnnoAttivo ? annoValidoStr(annoSpecifico) : "") || ANNO_RIF_DEFAULT;
  const annoRifPrec = annoValidoStr(annoSpecificoPrec) || annoPrecDi(annoRif);
  /* Istruzione tassativa «singolo anno», differenziata per slot di
     destinazione: annoSpecifico per T, annoSpecificoPrec per T-1. */
  const istrSingoloAnno = (perPrec = false) => {
    const target = annoValidoStr(perPrec ? annoSpecificoPrec : annoSpecifico);
    return modalitaSingoloAnno && target
      ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Leggi ed estrai ESCLUSIVAMENTE le informazioni e gli importi relativi all'anno ${target}. Ignora tassativamente qualsiasi raffronto, colonna comparativa o dato riferito ad altri esercizi.`
      : "";
  };
  const [niOss, setNiOss] = useState([]);
  const [niFase, setNiFase] = useState(null);
  const [niFlow, setNiFlow] = useState("corrente");
  const [niChunks, setNiChunks] = useState(null);
  const [niEval, setNiEval] = useState({ loading: false, error: null, data: null });
  const [niFiltro, setNiFiltro] = useState(null);
  // Impatto della Nota Integrativa sulla sezione 1 (voci del bilancio):
  // riclassificazioni (spostamenti di classe) e scomposizioni (voci divise).
  const [niImpatto, setNiImpatto] = useState(null);
  const [validato, setValidato] = useState(false);
  const [dettaglio, setDettaglio] = useState(null);
  // ── STATO PER L'ESERCIZIO PRECEDENTE (es. 2024) ─────────────
  // Flusso parallelo propedeutico al Rendiconto Finanziario: consente il
  // calcolo esatto dei Δ patrimoniali tra due esercizi consecutivi.
  const [vociPrec, setVociPrec] = useState([]);
  const [esercizioPrec, setEsercizioPrec] = useState("");
  const [niFiltroPrec, setNiFiltroPrec] = useState(null);
  const [niOssPrec, setNiOssPrec] = useState([]);
  const [niImpattoPrec, setNiImpattoPrec] = useState(null);
  // ── STATO PER LA RELAZIONE SULLA GESTIONE (RG) ──────────────
  // Flusso gemello della Nota Integrativa: filtro a 4 sezioni tematiche +
  // applicazione (riclassificazioni/scomposizioni) sulle voci del bilancio.
  const [rgFiltro, setRgFiltro] = useState(null);   // { pagine, estratti[], applicato }
  const [rgOss, setRgOss] = useState([]);
  const [rgImpatto, setRgImpatto] = useState(null); // { riclass[], scomp[], scartate }
  // Gemelli T-1 della RG: stessa forma dei precedenti, ma alimentati dalla
  // passata sull'esercizio comparativo e applicati a vociPrec (sezioni 8-10).
  const [rgFiltroPrec, setRgFiltroPrec] = useState(null);
  const [rgOssPrec, setRgOssPrec] = useState([]);
  const [rgImpattoPrec, setRgImpattoPrec] = useState(null);
  const [rgFase, setRgFase] = useState(null);
  // ── CONFIGURAZIONE IA MULTI-PROVIDER ────────────────────────
  // La chiave API si inserisce DIRETTAMENTE nella schermata (riquadro
  // «🔑 Configurazione IA»): resta nel browser e viaggia al proxy /api/chat solo
  // al momento della chiamata. In alternativa, se sull'hosting sono impostate le
  // variabili d'ambiente (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY),
  // il server le usa come ripiego quando il campo è lasciato vuoto.
  const [provider, setProvider] = useState("claude");
  const [chiaviUtente, setChiaviUtente] = useState(() => caricaChiavi());
  const [ricordaChiavi, setRicordaChiavi] = useState(() => {
    const k = caricaChiavi();
    return ["claude", "openai", "gemini"].some((p) => (k[p] || "").trim());
  });
  const [mostraChiave, setMostraChiave] = useState(false);
  const [chiaviServer, setChiaviServer] = useState({ claude: false, openai: false, gemini: false });
  const [statoServer, setStatoServer] = useState("verifica"); // verifica | ok | offline

  // Scrittura della chiave: aggiorna lo stato e, se «ricorda» è attivo, il
  // localStorage. Unico punto di persistenza delle chiavi.
  const setChiave = (prov, valore) => {
    setChiaviUtente((k) => {
      const next = { ...k, [prov]: valore };
      if (ricordaChiavi) scriviChiavi(next);
      return next;
    });
  };
  // Interruttore «ricorda nel browser»: attivandolo salva subito quanto digitato,
  // disattivandolo ripulisce il localStorage lasciando le chiavi in sessione.
  const toggleRicorda = (attivo) => {
    setRicordaChiavi(attivo);
    if (attivo) scriviChiavi(chiaviUtente);
    else dimenticaChiavi();
  };
  const cancellaChiave = (prov) => {
    setChiaviUtente((k) => {
      const next = { ...k, [prov]: "" };
      if (ricordaChiavi) scriviChiavi(next);
      return next;
    });
  };
  const [modello, setModello] = useState({
    openai: "gpt-5.4-mini",
    gemini: "gemini-2.5-flash",
    claude: "claude-sonnet-4-6",
  });
  // All'avvio interroga /api/chat per sapere se il proxy risponde e se
  // sull'hosting esistono chiavi di ripiego: la risposta contiene SOLO
  // booleani, mai i valori delle chiavi.
  useEffect(() => {
    let vivo = true;
    fetch("/api/chat")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("config non disponibile"))))
      .then((d) => { if (!vivo) return; setChiaviServer(d.providers || {}); setStatoServer("ok"); })
      .catch(() => { if (vivo) setStatoServer("offline"); });
    return () => { vivo = false; };
  }, []);
  // Chiave digitata a schermo per il provider attivo (ha la precedenza).
  const chiaveCorrente = (chiaviUtente[provider] || "").trim();
  // L'IA è utilizzabile se c'è una chiave locale OPPURE una sull'hosting, e in
  // ogni caso solo se il proxy /api/chat risponde.
  const fonteChiave = chiaveCorrente ? "utente" : chiaviServer[provider] ? "server" : "nessuna";
  const iaAttiva = fonteChiave !== "nessuna" && statoServer !== "offline";
  const avvisoFormaChiave = formaChiaveSospetta(provider, chiaveCorrente);
  const [det, setDet] = useState({ fatturato: "", consumi: "", acquisti: "", crediti: "", scorte: "", fornitori: "", crescita: "10", durevolePct: "60" });
  const updDet = (campo, val) => setDet((s) => ({ ...s, [campo]: val }));
  const [asaList, setAsaList] = useState([
    { id: "asa1", nome: "ASA 1" },
    { id: "asa2", nome: "ASA 2" },
  ]);
  const [asaMap, setAsaMap] = useState({});
  const [asaAi, setAsaAi] = useState({ loading: false, error: null, ok: null });
  const setAlloc = (voceId, dest) => setAsaMap((m) => ({ ...m, [voceId]: dest }));
  const addAsa = () =>
    setAsaList((l) => (l.length >= 6 ? l : [...l, { id: `asa_${Date.now() % 100000}_${l.length}`, nome: `ASA ${l.length + 1}` }]));
  const renameAsa = (id, nome) => setAsaList((l) => l.map((a) => (a.id === id ? { ...a, nome } : a)));
  const removeAsa = (id) => {
    setAsaList((l) => (l.length <= 1 ? l : l.filter((a) => a.id !== id)));
    setAsaMap((m) => {
      const n = { ...m };
      Object.keys(n).forEach((k) => { if (n[k] === id) n[k] = "comune"; });
      return n;
    });
  };
  // Analisi di un bilancio completo (Form 10-K / 20-F) in un solo passaggio
  const masterFileRef = useRef(null);
  const spFileRef = useRef(null);
  const niFileRef = useRef(null);
  const rgFileRef = useRef(null);
  const spPrecFileRef = useRef(null);
  const niPrecFileRef = useRef(null);
  const rgPrecFileRef = useRef(null);
  // Caricamento di un salvataggio JSON precedentemente esportato
  const jsonFileRef = useRef(null);
  const [importEsito, setImportEsito] = useState(null); // { level, text }
  const setAiFor = (which, val) => setAi((s) => ({ ...s, [which]: val }));

  const updVoce = (id, campo, val) => {
    setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, [campo]: val } : v)));
    setValidato(false);
  };
  const delVoce = (id) => { setVoci((vs) => vs.filter((v) => v.id !== id)); setValidato(false); };
  const addVoce = (sezione) => {
    setVoci((vs) => [...vs, { id: newId(), nome: "", importo: "", sezione, classe: "da_classificare" }]);
    setValidato(false);
  };
  // Editor delle voci dell'esercizio precedente (stessa semantica di updVoce & co.)
  const updVocePrec = (id, campo, val) =>
    setVociPrec((vs) => vs.map((v) => (v.id === id ? { ...v, [campo]: val } : v)));
  const delVocePrec = (id) => setVociPrec((vs) => vs.filter((v) => v.id !== id));
  const addVocePrec = (sezione) =>
    setVociPrec((vs) => [...vs, { id: newId(), nome: "", importo: "", sezione, classe: "da_classificare" }]);

  const fileToBase64 = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = () => rej(new Error("Lettura del file non riuscita"));
      r.readAsDataURL(file);
    });

  async function fileToContent(file) {
    if (file.type === "application/pdf") {
      const data = await fileToBase64(file);
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    }
    if (file.type.startsWith("image/")) {
      const data = await fileToBase64(file);
      return { type: "image", source: { type: "base64", media_type: file.type, data } };
    }
    const text = await file.text();
    return { type: "text", text: "Contenuto del documento:\n\n" + text.slice(0, 60000) };
  }

  const NI_CHUNK_PAGES = 25;
  const loadPdfLib = () => {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (window.__pdfLibPromise) return window.__pdfLibPromise;
    window.__pdfLibPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      s.onload = () => (window.PDFLib ? res(window.PDFLib) : rej(new Error("Libreria PDF non disponibile")));
      s.onerror = () => rej(new Error("Impossibile caricare la libreria di suddivisione PDF"));
      document.head.appendChild(s);
    });
    return window.__pdfLibPromise;
  };

  async function pdfToChunks(file) {
    try {
      const { PDFDocument } = await loadPdfLib();
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const nPages = doc.getPageCount();
      if (nPages <= NI_CHUNK_PAGES && file.size <= 8 * 1024 * 1024) {
        return [{ data: await fileToBase64(file), from: 1, to: nPages }];
      }
      const chunks = [];
      for (let start = 0; start < nPages; start += NI_CHUNK_PAGES) {
        const end = Math.min(start + NI_CHUNK_PAGES, nPages);
        const sub = await PDFDocument.create();
        const pages = await sub.copyPages(doc, Array.from({ length: end - start }, (_, i) => start + i));
        pages.forEach((p) => sub.addPage(p));
        chunks.push({ data: await sub.saveAsBase64(), from: start + 1, to: end });
      }
      return chunks;
    } catch {
      return [{ data: await fileToBase64(file), from: 1, to: null }];
    }
  }

  // ── LETTURA DEI PDF CON OPENAI: RASTERIZZAZIONE LATO CLIENT ──────────
  // L'endpoint chat/completions di OpenAI accetta immagini (image_url) ma non
  // il PDF grezzo. Le pagine vengono quindi renderizzate su canvas con pdf.js
  // e inviate come immagini: funzionano così anche le scansioni e i file
  // prodotti con «Stampa su PDF», privi di testo selezionabile.

  // Larghezza in pixel a cui viene renderizzata ogni pagina: 1500 px è il
  // compromesso tra leggibilità delle tabelle di bilancio e peso del payload.
  const PDF_IMG_WIDTH = 1500;
  // Numero massimo di pagine convertite per singolo blocco `document`
  // (i chunk creati da pdfToChunks sono già da NI_CHUNK_PAGES = 25 pagine).
  const PDF_IMG_MAX_PAGES = 30;
  // Tetto indicativo in byte di ogni pagina: se superato la pagina viene
  // ricodificata con qualità inferiore, per non sforare i limiti di
  // dimensione della richiesta OpenAI.
  const PDF_IMG_MAX_BYTES_PAGE = 420 * 1024;

  // Si usa la build UMD 3.11.174: è l'ultima servita da cdnjs come script
  // classico (le 4.x sono solo ESM) e quindi l'unica utilizzabile con un
  // semplice <script> iniettato a runtime.
  const PDFJS_VER = "3.11.174";
  const loadPdfJs = () => {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window.__pdfJsPromise) return window.__pdfJsPromise;
    window.__pdfJsPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
      s.onload = () => {
        const lib = window.pdfjsLib;
        if (!lib) return rej(new Error("Libreria pdf.js non disponibile"));
        const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;
        try {
          // Un Worker non può essere creato direttamente da un URL cross-origin:
          // si crea un piccolo worker locale (blob) che importa quello del CDN.
          const shim = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: "application/javascript" });
          lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(shim);
        } catch {
          // Fallback: pdf.js userà il "fake worker" sul thread principale.
          lib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        res(lib);
      };
      s.onerror = () => rej(new Error("Impossibile caricare la libreria di conversione PDF (pdf.js)"));
      document.head.appendChild(s);
    });
    return window.__pdfJsPromise;
  };

  // Accetta File/Blob, ArrayBuffer, Uint8Array oppure una stringa base64 (con o
  // senza prefisso data:), così la stessa funzione serve sia i file caricati
  // dall'utente sia i blocchi `document` già presenti in callAI.
  async function pdfToUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof Blob !== "undefined" && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    if (typeof input === "string") {
      const b64 = input.startsWith("data:") && input.includes(",") ? input.split(",")[1] : input;
      const bin = atob(b64.replace(/\s/g, ""));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    throw new Error("Formato del PDF non riconosciuto per la conversione in immagini");
  }

  // Converte un PDF in un array di immagini base64, una per pagina:
  // [{ page, mediaType, data, dataUrl }, …]
  async function pdfToImages(input, opts = {}) {
    const {
      maxPages = PDF_IMG_MAX_PAGES,
      targetWidth = PDF_IMG_WIDTH,
      mimeType = "image/jpeg",
      onProgress = null,
    } = opts;

    const pdfjsLib = await loadPdfJs();
    const data = await pdfToUint8Array(input);
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const nPagine = Math.min(doc.numPages, maxPages);
    const immagini = [];

    try {
      for (let i = 1; i <= nPagine; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1, targetWidth / base.width));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: false });
        // Sfondo bianco: senza questo il JPEG renderebbe nere le aree trasparenti.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;

        // Qualità decrescente finché la pagina non rientra nel budget di peso.
        let dataUrl = "";
        for (const q of [0.82, 0.65, 0.5, 0.38]) {
          dataUrl = canvas.toDataURL(mimeType, q);
          if (dataUrl.length * 0.75 <= PDF_IMG_MAX_BYTES_PAGE) break;
        }

        immagini.push({ page: i, mediaType: mimeType, data: dataUrl.split(",")[1] || "", dataUrl });

        // Libera subito la memoria del canvas (i bilanci hanno molte pagine).
        canvas.width = 0;
        canvas.height = 0;
        if (typeof page.cleanup === "function") page.cleanup();
        if (onProgress) onProgress(i, nPagine);
      }
    } finally {
      if (typeof doc.destroy === "function") await doc.destroy();
    }

    if (!immagini.length) throw new Error("Il PDF non contiene pagine convertibili in immagini");
    return immagini;
  }

  // Lo stesso PDF viene inviato a più prompt (SP, NI, RG, fase 1 e fase 2):
  // senza cache la rasterizzazione verrebbe ripetuta a ogni chiamata.
  const pdfImgCacheKey = (b64) => `${b64.length}|${b64.slice(0, 96)}|${b64.slice(-48)}`;

  async function pdfToImagesCached(b64, opts) {
    if (!window.__pdfImgCache) window.__pdfImgCache = new Map();
    const cache = window.__pdfImgCache;
    const key = pdfImgCacheKey(b64);
    if (cache.has(key)) return cache.get(key);
    const p = pdfToImages(b64, opts).catch((e) => {
      cache.delete(key); // un errore non deve restare memorizzato
      throw e;
    });
    cache.set(key, p);
    // Cache volutamente piccola: si tengono al massimo 6 documenti.
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return p;
  }

  // Traduce gli allegati nel formato OpenAI: le immagini restano tali, i PDF
  // vengono rasterizzati e inseriti come altrettanti blocchi `image_url`,
  // preceduti da un'etichetta di pagina che aiuta il modello nei riferimenti.
  async function allegatiPerOpenAI(allegati) {
    const parti = [];
    for (const b of allegati) {
      if (b.type === "image") {
        parti.push({
          type: "image_url",
          image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: "high" },
        });
        continue;
      }
      if (b.type === "document" && b.source?.media_type === "application/pdf") {
        let pagine;
        try {
          pagine = await pdfToImagesCached(b.source.data);
        } catch (e) {
          throw new Error(
            `Conversione del PDF in immagini non riuscita (${e.message}). ` +
              "Riprova oppure seleziona Claude o Gemini, che leggono il PDF nel formato nativo."
          );
        }
        pagine.forEach((p) => {
          parti.push({ type: "text", text: `— Pagina ${p.page} del documento —` });
          parti.push({
            type: "image_url",
            image_url: { url: `data:${p.mediaType};base64,${p.data}`, detail: "high" },
          });
        });
        continue;
      }
      // Eventuali allegati non gestiti vengono ignorati senza bloccare la chiamata.
    }
    return parti;
  }

  // I blocchi di contenuto (text/image/document) sono nel formato nativo
  // dell'API Anthropic. Per OpenAI e Gemini vengono tradotti al volo, così i
  // ~13 punti di chiamata restano invariati.
  // Con OpenAI i PDF non vengono più rifiutati: sono convertiti in immagini
  // lato client con pdf.js (funzionano quindi anche le scansioni) e inviati
  // come blocchi image_url.
  // La chiamata riprova automaticamente in caso di errori temporanei
  // (Overloaded / rate-limit / errori server / problemi di rete) con
  // attesa esponenziale, così un singolo "occupato" non fa fallire
  // l'intero caricamento e non costringe a ricaricare il file.
  async function callAI(content, maxTokens = 4000) {
    const blocchi = Array.isArray(content) ? content : [content];
    if (statoServer === "offline")
      throw new Error("Il servizio /api/chat non risponde: verifica che il deploy sia attivo (in locale avvia «npm run dev» oppure «npm run build && npm start»).");
    if (!iaAttiva)
      throw new Error(`Nessuna chiave API per ${provider === "openai" ? "OpenAI" : provider === "gemini" ? "Google Gemini" : "Claude"}: incollala nel riquadro «🔑 Configurazione IA» qui sopra.`);

    // ── Traduzione dei blocchi nel formato del provider selezionato ──
    const testo = conScalaMilioni(blocchi.filter((b) => b.type === "text").map((b) => b.text).join("\n\n"));
    const allegati = blocchi.filter((b) => b.type === "document" || b.type === "image");

    // Con OpenAI la rasterizzazione dei PDF avviene UNA sola volta, fuori dal
    // ciclo di retry (ed è comunque memorizzata in cache tra le chiamate).
    const partiOpenAI = provider === "openai" ? await allegatiPerOpenAI(allegati) : null;

    // Gli allegati vengono preparati nel formato atteso dal provider: la
    // rasterizzazione dei PDF per OpenAI richiede pdf.js e resta quindi lato
    // browser. Il backend riceve blocchi già pronti e li impacchetta.
    const partiModificate =
      provider === "openai"
        ? partiOpenAI
        : provider === "gemini"
        ? allegati.map((b) => ({ inline_data: { mime_type: b.source.media_type, data: b.source.data } }))
        : allegati;

    const etichettaProvider = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Claude";

    // Chiamata unica al backend serverless: le API key restano sul server e
    // la risposta arriva già normalizzata come { raw: "..." }.
    const eseguiChiamata = async () => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          modello: modello[provider],
          maxTokens,
          testo,
          allegati: partiModificate,
          // Chiave digitata a schermo. Se vuota il proxy ricade sulla variabile
          // d'ambiente dell'hosting, se configurata.
          apiKey: chiaveCorrente || undefined,
        }),
      });

      if (!res.ok) {
        // L'errore del provider viene solo propagato: il ciclo di retry qui
        // sotto decide se è temporaneo e vale la pena riprovare.
        const errData = await res.json().catch(() => ({}));
        return {
          errore: errData.errore || errData.error?.message || `HTTP ${res.status}`,
          tipo: errData.tipo || errData.error?.type || "",
          status: res.status,
          etichetta: errData.etichetta || etichettaProvider,
        };
      }

      const data = await res.json();
      return { raw: typeof data.raw === "string" ? data.raw : "" };
    };

    const MAX_RETRY = 5;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let ultimoErrore;

    for (let tentativo = 0; tentativo <= MAX_RETRY; tentativo++) {
      try {
        const esito = await eseguiChiamata();

        if (esito.errore !== undefined) {
          const errorMsg = esito.errore || `HTTP ${esito.status}`;
          const errorType = esito.tipo || "";
          const temporaneo =
            [429, 500, 502, 503, 504, 529].includes(esito.status) ||
            /overload|rate.?limit|timeout|temporan|try again|capacity/i.test(errorMsg) ||
            /overload|rate.?limit|timeout|api_error/i.test(errorType);

          if (temporaneo && tentativo < MAX_RETRY) {
            const attesa = Math.min(1500 * Math.pow(2, tentativo), 20000) + Math.random() * 750;
            console.warn(`${esito.etichetta} occupato (${errorMsg}). Nuovo tentativo tra ${Math.round(attesa)} ms… (${tentativo + 1}/${MAX_RETRY})`);
            await sleep(attesa);
            continue;
          }
          throw new Error(`Errore API ${esito.etichetta}: ${String(errorMsg).slice(0, 200)}`);
        }

        const raw = esito.raw;
        if (!raw) throw new Error("Nessun contenuto nella risposta dell'IA");

        const clean = raw.replace(/```json|```/g, "").trim();
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start < 0 || end < 0) {
          console.error("Risposta non è JSON valido:", raw.slice(0, 200));
          throw new Error("L'IA non ha restituito dati JSON leggibili");
        }
        return JSON.parse(clean.slice(start, end + 1));

      } catch (err) {
        ultimoErrore = err;
        // Errori di rete (fetch fallito) → tipicamente TypeError: riprova.
        const erroreDiRete = err instanceof TypeError;
        if (erroreDiRete && tentativo < MAX_RETRY) {
          const attesa = Math.min(1500 * Math.pow(2, tentativo), 20000) + Math.random() * 750;
          console.warn(`Errore di rete verso il provider IA. Nuovo tentativo tra ${Math.round(attesa)} ms… (${tentativo + 1}/${MAX_RETRY})`);
          await sleep(attesa);
          continue;
        }
        // Errori non temporanei (JSON illeggibile, errore API definitivo…): esci.
        throw err;
      }
    }
    throw ultimoErrore || new Error("Errore API: servizio temporaneamente non disponibile dopo più tentativi");
  }

  // ── ANALISI DI UN BILANCIO COMPLETO (10-K / 20-F) IN UN PASSAGGIO ──
  // Helper NUOVO (non tocca i flussi SP/NI/RG esistenti): applica alle voci
  // le proposte di riclassificazione/scomposizione restituite dal MASTER_PROMPT
  // e le normalizza nella forma attesa dalle tabelle d'impatto delle sezioni 2 e 3
  // ({nome, importo, classePrima, classeDopo} e {originale, importoOrig, parti…}).
  function applicaProposteVoci(vociBase, riclassificazioni, scomposizioni) {
    let next = [...vociBase];
    const impRiclass = [], impScomp = [];
    let scartate = 0;
    const findByName = (nome) => {
      const t = String(nome || "").trim().toLowerCase();
      if (!t) return null;
      return next.find((v) => v.nome.trim().toLowerCase() === t) ||
             next.find((v) => v.nome.trim().toLowerCase().includes(t) || t.includes(v.nome.trim().toLowerCase()));
    };
    for (const rr of Array.isArray(riclassificazioni) ? riclassificazioni : []) {
      const target = findByName(rr?.voce);
      if (target && CLASSI[rr.classe]) {
        impRiclass.push({
          nome: target.nome, importo: parse(target.importo),
          classePrima: target.classe, classeDopo: rr.classe,
          motivo: typeof rr.motivo === "string" ? rr.motivo.trim() : "",
        });
        next = next.map((v) => (v.id === target.id ? { ...v, classe: rr.classe } : v));
      } else scartate++;
    }
    for (const s of Array.isArray(scomposizioni) ? scomposizioni : []) {
      const target = findByName(s?.voce_originale);
      const dett = (Array.isArray(s?.dettagli) ? s.dettagli : [])
        .filter((x) => x && typeof x.nome === "string" && !isNaN(Number(x.importo)) && Number(x.importo) > 0 && CLASSI[x.classe]);
      if (!target || dett.length === 0) { scartate++; continue; }
      const somma = dett.reduce((a, x) => a + Number(x.importo), 0);
      const orig = parse(target.importo);
      if (somma > orig + tolleranzaMilioni(orig)) { scartate++; continue; }
      const residuo = orig - somma;
      impScomp.push({
        originale: target.nome, importoOrig: orig, classeOrig: target.classe,
        residuo: residuo > tolleranzaMilioni(orig) ? residuo : 0,
        motivo: typeof s.motivo === "string" ? s.motivo.trim() : "",
        parti: dett.map((x) => ({ nome: x.nome.trim(), importo: Number(x.importo), classe: x.classe })),
      });
      next = next.flatMap((v) => {
        if (v.id !== target.id) return [v];
        const nuovi = dett.map((x) => ({ id: newId(), nome: x.nome.trim(), importo: sImp(Number(x.importo)), sezione: v.sezione, classe: x.classe }));
        return residuo > tolleranzaMilioni(orig) ? [{ ...v, nome: `${v.nome} (residuo)`, importo: sImp(residuo) }, ...nuovi] : nuovi;
      });
    }
    return { next, impRiclass, impScomp, scartate };
  }

  async function handleMasterFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAiFor("master", { loading: true, error: null, ok: null });
    setSpFlow("corrente"); setNiFlow("corrente"); // reset flussi

    try {
      const content = await fileToContent(file);

      const MASTER_PROMPT = `Sei un analista di bilancio senior. Il documento allegato è un bilancio annuale completo (es. Form 20-F, Form 10-K, o Relazione Finanziaria equivalente). Devi analizzarlo integralmente per riclassificare lo STATO PATRIMONIALE (Consolidated Statement of Financial Position / Balance Sheet).
FASE 1: NAVIGAZIONE DEL DOCUMENTO
Individua all'interno del documento le seguenti macro-sezioni: 1. I Prospetti Contabili (tipicamente "Item 8" nel 10-K, "Item 18" o pagine "F-" nel 20-F). 2. Le Note ai Prospetti (Nota Integrativa). 3. L'Operating and Financial Review and Prospects / MD&A ("Item 7" o "Item 5").
FASE 2: ESTRAZIONE VOCI
Identifica lo schema (ifrs o us_gaap) ed estrai TUTTE le voci originali di dettaglio (non i totali), con il loro importo esatto e la classe gestionale più appropriata (ATTIVO: att_op_magazzino, att_op_corrente, att_op_immobilizzata, att_accessoria, att_fin_liquidita, att_fin_altre. PASSIVO: pn, pass_op_corrente, pass_op_non_corrente, pass_fin_corrente, pass_fin_non_corrente). Usa "da_classificare" se ambiguo.
FASE 3: ANALISI NOTA INTEGRATIVA
Dalle Note, estrai (max 15 estratti) info su scadenze, natura crediti, TFR/fondi, attività estranee, garanzie. Formula riclassificazioni o scomposizioni.
⚠ REGOLE RIGIDE E TASSATIVE DI SCOMPOSIZIONE E CLASSIFICAZIONE (valgono sia per le voci della FASE 2 sia per le scomposizioni delle FASI 3 e 4):
0) VINCOLO MATEMATICO ASSOLUTO: non calcolare MAI la quota a lungo termine e non fare sottrazioni per nessuna voce (crediti, debiti, fondi). Nell'array "dettagli" fornisci ESCLUSIVAMENTE un singolo elemento con l'importo esatto della quota a BREVE termine/corrente letto nel documento. Il sistema calcolerà automaticamente il residuo a lungo termine per differenza matematica.
0-bis) CLASSE DEL RESIDUO: il residuo eredita la classe della voce originale. Se tale classe non è quella corretta per il lungo termine, aggiungi OBBLIGATORIAMENTE in "riclassificazioni" lo spostamento della voce originale alla classe di lungo termine appropriata.
1) FISCALITÀ DIFFERITA (IAS 12): 'Deferred tax assets' → SEMPRE E SOLO "att_op_immobilizzata"; 'Deferred tax liabilities' → SEMPRE E SOLO "pass_op_non_corrente". È SEVERAMENTE VIETATO scomporle tra quota corrente e non corrente: ignora qualsiasi ripartizione "entro/oltre 12 mesi" indicata nelle Note.
2) DEBITI FINANZIARI ('Debt'/'Borrowings'/'Bonds'/'Notes payable'): cerca la quota a breve ('current portion of long-term debt', 'short-term borrowings', 'commercial paper'), generane UN SOLO dettaglio in "pass_fin_corrente" e riclassifica la voce originale in "pass_fin_non_corrente" se non lo è già.
3) CREDITI FINANZIARI ('Receivables from financing activities'/'Finance receivables', captive finance): hanno scadenze miste. Genera UN SOLO dettaglio con la quota a BREVE termine in "att_op_corrente" e riclassifica contestualmente la voce originale in "att_op_immobilizzata", così il residuo rappresenta la quota a lungo termine. Non allocare MAI il 100% a breve termine.
4) FONDI RISCHI E ONERI ('Provisions'): i fondi per garanzie ('warranties') o richiami legati al ciclo di vendita hanno quasi sempre impatto a breve termine. Genera UN SOLO dettaglio con la quota corrente in "pass_op_corrente" e riclassifica la voce originale in "pass_op_non_corrente" se non lo è già.
Per le regole 2), 3) e 4) non inventare importi: se il documento non fornisce la quota a breve, lascia la voce invariata e segnalalo in "osservazioni". La regola 1) si applica SEMPRE.
FASE 4: ANALISI RELAZIONE GESTIONE
Dall'MD&A, estrai info catalogate in: 1) Contesto macro/settore, 2) Modello di business/ASA, 3) Fatti di rilievo/Straordinari, 4) Evoluzione prevedibile. Formula riclassificazioni o scomposizioni nel rispetto delle REGOLE RIGIDE sopra indicate.
Restituisci ESCLUSIVAMENTE un JSON valido:
{"schemaInfo": {"schema": "ifrs/us_gaap/oic", "valuta": "...", "unita": "...", "indizi": "..."}, "esercizio": "...", "voci": [{"nome": "...", "importo": 0, "sezione": "attivo/passivo", "classe": "..."}], "notaIntegrativa": {"estratti": [{"pagina": 0, "tema": "...", "contenuto": "..."}], "impatto": {"riclassificazioni": [{"voce": "...", "classe": "...", "motivo": "..."}], "scomposizioni": [{"voce_originale": "...", "dettagli": [{"nome": "...", "importo": 0, "classe": "..."}], "motivo": "..."}]}, "osservazioni": ["..."]}, "relazioneGestione": {"estratti": [{"sezione": 1, "pagina": 0, "tema": "...", "contenuto": "..."}], "impatto": {"riclassificazioni": [], "scomposizioni": []}, "osservazioni": ["..."]}}`;

      // Modalità singolo anno: forza l'estrazione sul solo anno indicato.
      // Il flusso master non popola comunque lo stato T-1 (vociPrec resta vuoto),
      // quindi la sola iniezione dell'istruzione è sufficiente a bloccare il T-1.
      const singoloAnnoIstr = (modalitaSingoloAnno && annoSpecifico)
        ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Estrai ed elabora ESCLUSIVAMENTE i dati, gli importi e le voci relativi all'anno ${annoSpecifico} (Stato Patrimoniale, Nota Integrativa e Relazione sulla Gestione). Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi.`
        : "";
      const parsed = await callAI([content, { type: "text", text: MASTER_PROMPT + singoloAnnoIstr }]);

      // 1. Applica Voci e Schema (sanificate: classe validata, importo numerico)
      let vociCorr = sanificaVoci(parsed.voci);
      if (vociCorr.length === 0)
        throw new Error("Nessuna voce estratta dai prospetti contabili: verifica che il documento contenga lo Stato Patrimoniale consolidato");
      const esMaster = typeof parsed.esercizio === "string" ? parsed.esercizio : "";
      setEsercizio(singoloAnnoAttivo && !esMaster.includes(annoRif) ? `31/12/${annoRif}` : esMaster);
      if (parsed.schemaInfo && systemPrompts.SCHEMI[parsed.schemaInfo.schema]) setSchemaInfo(parsed.schemaInfo);

      // 2. Applica Nota Integrativa (estratti + impatto realmente applicato alle voci)
      let nRiclass = 0, nScomp = 0;
      if (parsed.notaIntegrativa) {
        const estrattiNI = (parsed.notaIntegrativa.estratti || [])
          .filter((x) => x && typeof x.contenuto === "string" && x.contenuto.trim())
          .map((x, i) => ({ id: `eni_${i}_${Date.now() % 100000}`, pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina), tema: String(x.tema || "Informazione").trim(), contenuto: String(x.contenuto).trim().slice(0, 600), incluso: true }));
        const resNI = applicaProposteVoci(vociCorr, parsed.notaIntegrativa.impatto?.riclassificazioni, parsed.notaIntegrativa.impatto?.scomposizioni);
        vociCorr = resNI.next;
        nRiclass += resNI.impRiclass.length; nScomp += resNI.impScomp.length;
        setNiFiltro({ pagine: [], estratti: estrattiNI, applicato: true });
        setNiOss(Array.isArray(parsed.notaIntegrativa.osservazioni) ? parsed.notaIntegrativa.osservazioni.filter((o) => typeof o === "string") : []);
        setNiImpatto({ riclass: resNI.impRiclass, scomp: resNI.impScomp, scartate: resNI.scartate });
      }

      // 3. Applica Relazione sulla Gestione (sulle voci già aggiornate dalla NI)
      if (parsed.relazioneGestione) {
        const estrattiRG = (parsed.relazioneGestione.estratti || [])
          .filter((x) => x && typeof x.contenuto === "string" && x.contenuto.trim())
          .map((x, i) => {
            const sez = Number(x.sezione);
            return { id: `erg_${i}_${Date.now() % 100000}`, sezione: sez >= 1 && sez <= 4 ? sez : 1, pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina), tema: String(x.tema || "Informazione").trim(), contenuto: String(x.contenuto).trim().slice(0, 600), incluso: true };
          });
        const resRG = applicaProposteVoci(vociCorr, parsed.relazioneGestione.impatto?.riclassificazioni, parsed.relazioneGestione.impatto?.scomposizioni);
        vociCorr = resRG.next;
        nRiclass += resRG.impRiclass.length; nScomp += resRG.impScomp.length;
        setRgFiltro({ pagine: [], estratti: estrattiRG, applicato: true });
        setRgOss(Array.isArray(parsed.relazioneGestione.osservazioni) ? parsed.relazioneGestione.osservazioni.filter((o) => typeof o === "string") : []);
        setRgImpatto({ riclass: resRG.impRiclass, scomp: resRG.impScomp, scartate: resRG.scartate });
      }

      setVoci(vociCorr);
      setNiEval({ loading: false, error: null, data: null });
      const daClass = vociCorr.filter((v) => v.classe === "da_classificare").length;
      setAiFor("master", { loading: false, error: null, ok: `Bilancio completo «${file.name}» analizzato: ${vociCorr.length} voci estratte${parsed.esercizio ? ` · esercizio ${parsed.esercizio}` : ""} → ${nRiclass} riclassificazioni e ${nScomp} scomposizioni applicate da Note e MD&A.${daClass ? ` ${daClass} voci da classificare.` : ""} Ricontrolla i risultati nella validazione.` });
      setValidato(false);
      setTab("dati");

    } catch (err) {
      setAiFor("master", { loading: false, error: err.message || "Errore durante l'analisi del bilancio", ok: null });
    } finally {
      if (masterFileRef.current) masterFileRef.current.value = "";
    }
  }

  async function handleSpFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSp(file, false);
    if (spFileRef.current) spFileRef.current.value = "";
  }

  async function handleSpFilePrec(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSp(file, true);
    if (spPrecFileRef.current) spPrecFileRef.current.value = "";
  }

  // Estrazione dello Stato Patrimoniale.
  //  · prec=false (caricamento iniziale): Fase 1 schema, Fase 2 estrazione
  //    dell'esercizio corrente (2025) e Fase 3 estrazione della colonna
  //    comparativa dell'esercizio precedente (2024) DALLO STESSO documento,
  //    così le sezioni 8-10 si popolano da sole senza un secondo upload.
  //  · prec=true (pulsante dedicato sezione 8): estrae solo il 2024 da un
  //    documento fornito a parte. Le due code IA restano indipendenti.
  async function processSp(file, prec) {
    const aiKey = prec ? "spPrec" : "sp";
    // La seconda passata automatica per il T-1 parte SOLO se la modalità
    // singolo anno è disattivata.
    const combined = !prec && !modalitaSingoloAnno; // il flusso corrente estrae anche il precedente
    setSpFlow(combined ? "entrambi" : (prec ? "precedente" : "corrente"));
    setAiFor(aiKey, { loading: true, error: null, ok: null });
    if (combined) setAiFor("spPrec", { loading: true, error: null, ok: null });
    try {
      const content = await fileToContent(file);

      setSpFase(1);
      let sch = { schema: "altro", note_contabili: [] };
      try {
        const det = await callAI([content, { type: "text", text: SCHEMA_DETECT_PROMPT }], 1500);
        if (det && systemPrompts.SCHEMI[det.schema]) sch = det;
      } catch { /* riconoscimento fallito: si prosegue con regole generiche */ }
      if (!prec || !schemaInfo) setSchemaInfo(sch);

      // Estrae e normalizza le voci per l'esercizio richiesto (corrente/precedente)
      const estrai = async (isPrec) => {
        const parsed = await callAI([content, { type: "text", text: buildSpPrompt(sch, isPrec, modalitaSingoloAnno, annoSpecifico, systemPrompts, annoSpecificoPrec) }]);
        const arr = Array.isArray(parsed.voci) ? parsed.voci : [];
        const nuove = arr
          .filter((x) => x && typeof x.nome === "string" && x.nome.trim() && !isNaN(Number(x.importo)))
          .map((x) => ({
            id: newId(),
            nome: x.nome.trim(),
            importo: sImp(Number(x.importo)),
            sezione: x.sezione === "passivo" ? "passivo" : "attivo",
            classe: CLASSI[x.classe] ? x.classe : "da_classificare",
          }));
        return { nuove, esParsed: typeof parsed.esercizio === "string" ? parsed.esercizio.trim() : "" };
      };

      const schLabel = systemPrompts.SCHEMI[sch.schema]?.label || "schema non riconosciuto";
      const unitaTxt = sch.unita && sch.unita !== "unità" ? ` (importi in ${sch.unita})` : "";

      // ── Fase 2: esercizio principale del flusso ──
      setSpFase(2);
      const primo = await estrai(prec);
      if (primo.nuove.length === 0)
        throw new Error(prec
          ? (modalitaSingoloAnno
              ? `Nessuna voce estratta: verifica che il documento caricato sia il bilancio autonomo dell'esercizio ${annoRifPrec || "precedente"}`
              : `Nessuna voce estratta: verifica che il documento contenga la colonna comparativa dell'esercizio precedente (${annoRifPrec})`)
          : `Nessuna voce estratta: verifica che il documento contenga la colonna dell'esercizio ${annoRif}`);
      const daClass1 = primo.nuove.filter((x) => x.classe === "da_classificare").length;
      const es1 = primo.esParsed ? ` · esercizio ${primo.esParsed}` : "";
      if (prec) {
        setVociPrec(primo.nuove);
        /* In Modalità Singolo Anno l'anno atteso è dichiarato dall'utente:
           se l'IA restituisce un'etichetta diversa (o vuota) si normalizza
           l'esercizio sull'anno richiesto, lasciando comunque l'avviso. */
        const esPrecFinale = (modalitaSingoloAnno && annoRifPrec && !String(primo.esParsed || "").includes(annoRifPrec))
          ? `31/12/${annoRifPrec}` : primo.esParsed;
        setEsercizioPrec(esPrecFinale);
        const warn = annoRifPrec && primo.esParsed && !primo.esParsed.includes(annoRifPrec)
          ? ` ⚠ L'esercizio letto non sembra riferirsi al ${annoRifPrec}.` : "";
        setAiFor("spPrec", { loading: false, error: null,
          ok: `SP dell'esercizio precedente riconosciuto come ${schLabel}${unitaTxt}: estratte ${primo.nuove.length} voci da «${file.name}»${es1}.${warn}${daClass1 ? ` ${daClass1} voci da classificare.` : ""}` });
        setTab("datiPrec");
        return;
      }
      setVoci(primo.nuove);
      const esFinale = (singoloAnnoAttivo && !String(primo.esParsed || "").includes(annoRif))
        ? `31/12/${annoRif}` : primo.esParsed;
      setEsercizio(esFinale);
      setValidato(false);
      const warnAnno = primo.esParsed && !primo.esParsed.includes(annoRif) ? ` ⚠ La colonna letta non sembra riferirsi al ${annoRif}.` : "";

      // ── Fase 3: estrazione della colonna comparativa (esercizio precedente) ──
      // Eseguita SOLO se la modalità singolo anno è disattivata (combined).
      let precMsg = "";
      if (combined) {
        setSpFase(3);
        try {
          const secondo = await estrai(true);
          if (secondo.nuove.length > 0) {
            setVociPrec(secondo.nuove);
            setEsercizioPrec(secondo.esParsed);
            const daClassP = secondo.nuove.filter((x) => x.classe === "da_classificare").length;
            precMsg = ` Dalla colonna comparativa estratte anche ${secondo.nuove.length} voci dell'esercizio precedente${secondo.esParsed ? ` (${secondo.esParsed})` : ""} → sezioni 8-10.`;
            setAiFor("spPrec", { loading: false, error: null,
              ok: `Esercizio precedente estratto dalla colonna comparativa dello stesso documento: ${secondo.nuove.length} voci${secondo.esParsed ? ` · ${secondo.esParsed}` : ""}.${daClassP ? ` ${daClassP} voci da classificare.` : ""}` });
          } else {
            precMsg = " Nessuna colonna comparativa dell'anno precedente rilevata nel documento: usa «Carica SP Precedente» nella sezione 8 se vuoi caricarlo a parte.";
            setAiFor("spPrec", { loading: false, error: null, ok: null });
          }
        } catch {
          precMsg = " Estrazione dell'esercizio precedente non riuscita: puoi caricarlo a parte dalla sezione 8.";
          setAiFor("spPrec", { loading: false, error: `Estrazione automatica del ${annoRifPrec} non riuscita: carica il documento dalla sezione 8.`, ok: null });
        }
      } else if (modalitaSingoloAnno) {
        precMsg = ` Modalità singolo anno attiva${annoSpecifico ? ` (${annoSpecifico})` : ""}: estrazione dell'esercizio precedente (T-1) disattivata.`;
      }

      setAiFor("sp", { loading: false, error: null,
        ok: `SP riconosciuto come ${schLabel}${unitaTxt}: estratte ${primo.nuove.length} voci da «${file.name}»${es1}.${warnAnno}${daClass1 ? ` ${daClass1} voci da classificare.` : ""}${precMsg} Passa alla validazione.` });
      setTab("dati");
    } catch (err) {
      setAiFor(aiKey, { loading: false, error: err.message || "Errore durante l'estrazione", ok: null });
      if (combined) setAiFor("spPrec", { loading: false, error: null, ok: null });
    } finally {
      setSpFase(null);
      setSpFlow("corrente");
    }
  }

  async function handleNiFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processNi(file, false);
    if (niFileRef.current) niFileRef.current.value = "";
  }

  async function handleNiFilePrec(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processNi(file, true);
    if (niPrecFileRef.current) niPrecFileRef.current.value = "";
  }

  // Analisi della Nota Integrativa.
  //  · prec=false (caricamento iniziale): Fase 1-2 analizzano e applicano le
  //    informazioni dell'esercizio corrente (2025); Fase 3-4 rieseguono
  //    scansione e applicazione cercando i dati dell'esercizio precedente
  //    (2024) DALLO STESSO documento, popolando le sezioni 8-10. Le porzioni
  //    PDF vengono calcolate una sola volta e riusate per entrambe le passate.
  //  · prec=true (pulsante dedicato sezione 8): analizza solo il 2024 da un
  //    documento fornito a parte.
  async function processNi(file, prec) {
    // La seconda passata automatica per il T-1 parte SOLO se la modalità
    // singolo anno è disattivata.
    const combined = !prec && !modalitaSingoloAnno;
    const aiKey = prec ? "niPrec" : "ni";
    setNiFlow(combined ? "entrambi" : (prec ? "precedente" : "corrente"));
    if (prec) { setNiFiltroPrec(null); setNiImpattoPrec(null); }
    else { setNiFiltro(null); setNiImpatto(null); }
    setAiFor(aiKey, { loading: true, error: null, ok: null });
    if (combined) setAiFor("niPrec", { loading: true, error: null, ok: null });
    try {
      const schemaCtx = schemaInfo
        ? `\nCONTESTO CONTABILE: il bilancio segue lo schema ${systemPrompts.SCHEMI[schemaInfo.schema]?.label || schemaInfo.schema}. Interpreta le informazioni tenendo conto delle convenzioni di questo sistema contabile${Array.isArray(schemaInfo.note_contabili) && schemaInfo.note_contabili.length ? ` (${schemaInfo.note_contabili.join("; ")})` : ""}.`
        : "";

      // Prepara UNA sola volta le porzioni (o il contenuto singolo), riusate
      // sia per la scansione 2025 sia per quella 2024.
      let chunks = null, singleContent = null;
      if (file.type === "application/pdf") chunks = await pdfToChunks(file);
      else singleContent = await fileToContent(file);
      const nPorzioni = chunks ? chunks.length : 1;

      // Scansione+filtro: individua gli estratti rilevanti per l'anno indicato
      // dal prompt di filtro. Ritorna estratti normalizzati e pagine.
      const scan = async (filterPromptBase, faseScan) => {
        setNiFase(faseScan);
        let estrattiRaw = [], pagineRaw = [], porzioniFallite = 0;
        if (chunks) {
          for (let c = 0; c < chunks.length; c++) {
            setNiChunks({ tot: chunks.length, done: c });
            const promptChunk = (chunks.length > 1
              ? `${filterPromptBase}\nATTENZIONE: il documento allegato è SOLO la porzione dalle pagine ${chunks[c].from} a ${chunks[c].to} della Nota Integrativa completa. In "pagina" indica il numero di pagina COME APPARE NELL'ALLEGATO (1 = prima pagina dell'allegato). Se in questa porzione non c'è nulla di utile, restituisci array vuoti.`
              : filterPromptBase) + schemaCtx;
            try {
              const f1 = await callAI([
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunks[c].data } },
                { type: "text", text: promptChunk },
              ]);
              const off = chunks[c].from - 1;
              const es = Array.isArray(f1.estratti) ? f1.estratti : [];
              estrattiRaw.push(...es.map((x) => ({ ...x, pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina) + off })));
              const pg = Array.isArray(f1.pagine_rilevanti) ? f1.pagine_rilevanti : [];
              pagineRaw.push(...pg.filter((p) => !isNaN(Number(p))).map((p) => Number(p) + off));
            } catch { porzioniFallite++; }
          }
          setNiChunks({ tot: chunks.length, done: chunks.length });
          if (porzioniFallite === chunks.length)
            throw new Error("Analisi non riuscita su nessuna porzione del documento: riprova o verifica che il file non sia protetto o danneggiato");
        } else {
          const f1 = await callAI([singleContent, { type: "text", text: filterPromptBase + schemaCtx }]);
          estrattiRaw = Array.isArray(f1.estratti) ? f1.estratti : [];
          pagineRaw = (Array.isArray(f1.pagine_rilevanti) ? f1.pagine_rilevanti : []).filter((p) => !isNaN(Number(p))).map(Number);
        }
        const estratti = estrattiRaw
          .filter((x) => x && typeof x.contenuto === "string" && x.contenuto.trim())
          .slice(0, 20)
          .map((x, i) => ({
            id: `e${i}_${Date.now() % 100000}`,
            pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina),
            tema: String(x.tema || "Informazione").trim(),
            contenuto: x.contenuto.trim().slice(0, 600),
            incluso: true,
          }));
        const pagine = [...new Set(pagineRaw)].sort((a, b) => a - b);
        return { estratti, pagine, porzioniFallite };
      };

      // Applicazione: chiede all'IA di riclassificare/scomporre le voci target
      // sulla base degli estratti. Ritorna il nuovo elenco voci e i dettagli.
      const apply = async (estratti, vociTarget, isPrec, faseApply) => {
        setNiFase(faseApply);
        const elenco = vociTarget.map((v) => `- ${v.nome} → ${fmt(parse(v.importo))} → ${v.classe}`).join("\n") || "(nessuna voce ancora estratta)";
        const estrattiTxt = estratti.map((x) => `[${x.pagina != null ? `p. ${x.pagina} — ` : ""}${x.tema}]\n${x.contenuto}`).join("\n\n");
        const annoCtx = isPrec
          ? (modalitaSingoloAnno
              ? `\nATTENZIONE: le voci e le informazioni provengono da un DOCUMENTO AUTONOMO dell'esercizio ${annoRifPrec || "precedente"} (Modalità Singolo Anno): usa esclusivamente i dati di quell'esercizio, che in quel documento è la colonna principale.`
              : `\nATTENZIONE: le voci e le informazioni si riferiscono all'ESERCIZIO PRECEDENTE (colonna comparativa, ${annoRifPrec}): usa esclusivamente i dati di quell'esercizio.`)
          : "";
        const prompt = buildNiApplyPrompt(systemPrompts.CLASSI_DOC).replace("{{VOCI}}", elenco).replace("{{ESTRATTI}}", estrattiTxt) + schemaCtx + annoCtx + istrSingoloAnno(isPrec);
        const f2 = await callAI([{ type: "text", text: prompt }]);

        let applicateR = 0, applicateS = 0, scartate = 0;
        let next = [...vociTarget];
        const impRiclass = [], impScomp = [];
        const findByName = (nome) => {
          const t = String(nome || "").trim().toLowerCase();
          return next.find((v) => v.nome.trim().toLowerCase() === t) ||
                 next.find((v) => v.nome.trim().toLowerCase().includes(t) || t.includes(v.nome.trim().toLowerCase()));
        };
        for (const rr of Array.isArray(f2.riclassificazioni) ? f2.riclassificazioni : []) {
          const target = findByName(rr.voce);
          if (target && CLASSI[rr.classe]) {
            impRiclass.push({ nome: target.nome, importo: parse(target.importo), classePrima: target.classe, classeDopo: rr.classe, motivo: typeof rr.motivo === "string" ? rr.motivo.trim() : "" });
            next = next.map((v) => (v.id === target.id ? { ...v, classe: rr.classe } : v));
            applicateR++;
          } else scartate++;
        }
        for (const s of Array.isArray(f2.scomposizioni) ? f2.scomposizioni : []) {
          const target = findByName(s.voce_originale);
          const dett = (Array.isArray(s.dettagli) ? s.dettagli : [])
            .filter((x) => x && typeof x.nome === "string" && !isNaN(Number(x.importo)) && Number(x.importo) > 0 && CLASSI[x.classe]);
          if (!target || dett.length === 0) { scartate++; continue; }
          const somma = dett.reduce((a, x) => a + Number(x.importo), 0);
          const orig = parse(target.importo);
          if (somma > orig + tolleranzaMilioni(orig)) { scartate++; continue; }
          const residuo = orig - somma;
          impScomp.push({
            originale: target.nome, importoOrig: orig, classeOrig: target.classe,
            residuo: residuo > tolleranzaMilioni(orig) ? residuo : 0, motivo: typeof s.motivo === "string" ? s.motivo.trim() : "",
            parti: dett.map((x) => ({ nome: x.nome.trim(), importo: Number(x.importo), classe: x.classe })),
          });
          next = next.flatMap((v) => {
            if (v.id !== target.id) return [v];
            const nuovi = dett.map((x) => ({ id: newId(), nome: x.nome.trim(), importo: sImp(Number(x.importo)), sezione: v.sezione, classe: x.classe }));
            return residuo > tolleranzaMilioni(orig) ? [{ ...v, nome: `${v.nome} (residuo)`, importo: sImp(residuo) }, ...nuovi] : nuovi;
          });
          applicateS++;
        }
        const oss = Array.isArray(f2.osservazioni) ? f2.osservazioni.filter((o) => typeof o === "string" && o.trim()).slice(0, 4) : [];
        return { next, oss, impRiclass, impScomp, applicateR, applicateS, scartate };
      };

      const riepilogo = (nome, estratti, pagine, res, nPorz, porzFallite, isPrec) => {
        const pg = pagine.length ? ` (pagine rilevanti: ${pagine.join(", ")})` : "";
        return `Nota Integrativa ${isPrec ? "dell'esercizio precedente " : ""}«${nome}» analizzata${nPorz > 1 ? ` (suddivisa in ${nPorz} porzioni${porzFallite ? `, ${porzFallite} non analizzabili` : ""})` : ""}: ${estratti.length} informazioni utili${pg} → ${res.applicateR} riclassificazioni e ${res.applicateS} scomposizioni${res.scartate ? `, ${res.scartate} scartate` : ""}.`;
      };

      // ─────────── PASSATA 1: esercizio principale del flusso ───────────
      // In Modalità Singolo Anno il documento T-1 è autonomo: la variante
      // «comparativa» va sostituita da quella «documento autonomo».
      const scan1 = await scan(prec
        ? (modalitaSingoloAnno
            ? buildNiFilterPromptPrecAutonomo(annoRifPrec) + istrSingoloAnno(true)
            : buildNiFilterPromptPrec(annoRif))
        : buildNiFilterPrompt(annoRif) + istrSingoloAnno(false), 1);
      if (scan1.estratti.length === 0)
        throw new Error(prec
          ? (modalitaSingoloAnno
              ? `Nessuna informazione utile trovata: verifica che il documento sia la Nota Integrativa dell'esercizio ${annoRifPrec || "precedente"}`
              : `Nessuna informazione utile trovata: verifica che la Nota Integrativa contenga i dati comparativi riferiti all'esercizio precedente (${annoRifPrec})`)
          : `Nessuna informazione utile alla riclassificazione trovata nel documento: verifica che sia la Nota Integrativa del bilancio ${annoRif}`);
      (prec ? setNiFiltroPrec : setNiFiltro)({ pagine: scan1.pagine, estratti: scan1.estratti, applicato: false });
      const res1 = await apply(scan1.estratti, prec ? vociPrec : voci, prec, 2);
      (prec ? setVociPrec : setVoci)(res1.next);
      (prec ? setNiOssPrec : setNiOss)(res1.oss);
      (prec ? setNiFiltroPrec : setNiFiltro)({ pagine: scan1.pagine, estratti: scan1.estratti, applicato: true });
      (prec ? setNiImpattoPrec : setNiImpatto)({ riclass: res1.impRiclass, scomp: res1.impScomp, scartate: res1.scartate });

      if (prec) {
        setAiFor("niPrec", { loading: false, error: null, ok: `${riepilogo(file.name, scan1.estratti, scan1.pagine, res1, nPorzioni, scan1.porzioniFallite, true)} Vedi la sezione «8».` });
        setTab("datiPrec");
        return;
      }

      // Solo per l'anno corrente: la valutazione IA (sezione 2) va rigenerata
      setNiEval({ loading: false, error: null, data: null });
      setValidato(false);

      // ─────────── PASSATA 2: esercizio precedente (stesso documento) ───────────
      // Eseguita SOLO se la modalità singolo anno è disattivata (combined).
      let precMsg = "";
      if (combined) {
        try {
          const scan2 = await scan(buildNiFilterPromptPrec(annoRif), 3);
          if (scan2.estratti.length > 0) {
            setNiFiltroPrec({ pagine: scan2.pagine, estratti: scan2.estratti, applicato: false });
            const res2 = await apply(scan2.estratti, vociPrec, true, 4);
            setVociPrec(res2.next);
            setNiOssPrec(res2.oss);
            setNiFiltroPrec({ pagine: scan2.pagine, estratti: scan2.estratti, applicato: true });
            setNiImpattoPrec({ riclass: res2.impRiclass, scomp: res2.impScomp, scartate: res2.scartate });
            precMsg = ` Individuate anche ${scan2.estratti.length} informazioni riferite all'esercizio precedente → applicate alle sezioni 8-10.`;
            setAiFor("niPrec", { loading: false, error: null, ok: `${riepilogo(file.name, scan2.estratti, scan2.pagine, res2, nPorzioni, scan2.porzioniFallite, true)} Estratte dallo stesso documento.` });
          } else {
            precMsg = " Nessuna informazione riferita all'esercizio precedente individuata nella Nota Integrativa.";
            setNiFiltroPrec(null); setNiOssPrec([]); setNiImpattoPrec(null);
            setAiFor("niPrec", { loading: false, error: null, ok: null });
          }
        } catch {
          precMsg = " Analisi dell'esercizio precedente non riuscita: puoi caricare la NI a parte dalla sezione 8.";
          setAiFor("niPrec", { loading: false, error: `Analisi automatica del ${annoRifPrec} non riuscita: carica la NI dalla sezione 8.`, ok: null });
        }
      } else if (modalitaSingoloAnno) {
        precMsg = ` Modalità singolo anno attiva${annoSpecifico ? ` (${annoSpecifico})` : ""}: analisi della NI dell'esercizio precedente (T-1) disattivata.`;
      }

      setAiFor("ni", { loading: false, error: null, ok: `${riepilogo(file.name, scan1.estratti, scan1.pagine, res1, nPorzioni, scan1.porzioniFallite, false)}${precMsg} Vedi la sezione «2» per il dettaglio.` });
      setTab("nota");
    } catch (err) {
      setAiFor(aiKey, { loading: false, error: err.message || "Errore durante l'analisi della Nota Integrativa", ok: null });
      if (combined) setAiFor("niPrec", { loading: false, error: null, ok: null });
    } finally {
      setNiFase(null);
      setNiChunks(null);
      setNiFlow("corrente");
    }
  }

  async function handleRgFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processRg(file, false);
    // Doppia passata: lo stesso documento viene riletto isolando l'esercizio
    // comparativo (T-1). Bloccata in Modalità Singolo Anno. Il fallimento
    // della seconda passata non invalida il risultato della prima.
    if (!modalitaSingoloAnno) {
      try {
        await processRg(file, true);
      } catch (e2) {
        setAiFor("rgPrec", { loading: false, error: `Analisi RG T-1 non riuscita: ${e2.message}`, ok: null });
      }
    }
    if (rgFileRef.current) rgFileRef.current.value = "";
  }

  async function handleRgFilePrec(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processRg(file, true);
    if (rgPrecFileRef.current) rgPrecFileRef.current.value = "";
  }

  // Analisi della RELAZIONE SULLA GESTIONE — flusso gemello di processNi:
  // Fase 1 filtro tematico (4 sezioni) con chunking dei PDF grandi, Fase 2
  // applicazione delle riclassificazioni/scomposizioni alle voci correnti.
  async function processRg(file, isPrec = false) {
    // Target dinamici: un solo corpo funzione, due destinazioni di stato.
    const aiKey = isPrec ? "rgPrec" : "rg";
    const setFiltroT = isPrec ? setRgFiltroPrec : setRgFiltro;
    const setOssT = isPrec ? setRgOssPrec : setRgOss;
    const setImpattoT = isPrec ? setRgImpattoPrec : setRgImpatto;
    const setVociT = isPrec ? setVociPrec : setVoci;
    const vociT = isPrec ? vociPrec : voci;
    setFiltroT(null);
    setImpattoT(null);
    setAiFor(aiKey, { loading: true, error: null, ok: null });
    try {
      const schemaCtx = schemaInfo
        ? `\nCONTESTO CONTABILE: il bilancio segue lo schema ${systemPrompts.SCHEMI[schemaInfo.schema]?.label || schemaInfo.schema}. Interpreta le informazioni tenendo conto delle convenzioni di questo sistema contabile${Array.isArray(schemaInfo.note_contabili) && schemaInfo.note_contabili.length ? ` (${schemaInfo.note_contabili.join("; ")})` : ""}.`
        : "";
      // Prompt di filtro: la passata T-1 usa la variante «comparativa» oppure,
      // in Modalità Singolo Anno, quella «documento autonomo». L'istruzione
      // singolo-anno è differenziata per slot (T → annoSpecifico, T-1 →
      // annoSpecificoPrec).
      const RG_FILTER_BASE = isPrec
        ? (modalitaSingoloAnno
            ? buildRgFilterPromptPrecAutonomo(annoRifPrec) + istrSingoloAnno(true)
            : buildRgFilterPromptPrec(annoRif))
        : buildRgFilterPrompt(annoRif) + istrSingoloAnno(false);

      // Porzioni calcolate una sola volta (come in processNi).
      let chunks = null, singleContent = null;
      if (file.type === "application/pdf") chunks = await pdfToChunks(file);
      else singleContent = await fileToContent(file);
      const nPorzioni = chunks ? chunks.length : 1;

      // ── Fase 1: filtro tematico a 4 sezioni ──
      setRgFase(1);
      let estrattiRaw = [], pagineRaw = [], porzioniFallite = 0;
      if (chunks) {
        for (let c = 0; c < chunks.length; c++) {
          setNiChunks({ tot: chunks.length, done: c });
          const promptChunk = (chunks.length > 1
            ? `${RG_FILTER_BASE}\nATTENZIONE: il documento allegato è SOLO la porzione dalle pagine ${chunks[c].from} a ${chunks[c].to} della Relazione sulla Gestione completa. In "pagina" indica il numero di pagina COME APPARE NELL'ALLEGATO (1 = prima pagina dell'allegato). Se in questa porzione non c'è nulla di utile, restituisci array vuoti.`
            : RG_FILTER_BASE) + schemaCtx;
          try {
            const f1 = await callAI([
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunks[c].data } },
              { type: "text", text: promptChunk },
            ]);
            const off = chunks[c].from - 1;
            const es = Array.isArray(f1.estratti) ? f1.estratti : [];
            estrattiRaw.push(...es.map((x) => ({ ...x, pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina) + off })));
            const pg = Array.isArray(f1.pagine_rilevanti) ? f1.pagine_rilevanti : [];
            pagineRaw.push(...pg.filter((p) => !isNaN(Number(p))).map((p) => Number(p) + off));
          } catch { porzioniFallite++; }
        }
        setNiChunks({ tot: chunks.length, done: chunks.length });
        if (porzioniFallite === chunks.length)
          throw new Error("Analisi non riuscita su nessuna porzione del documento: riprova o verifica che il file non sia protetto o danneggiato");
      } else {
        const f1 = await callAI([singleContent, { type: "text", text: RG_FILTER_BASE + schemaCtx }]);
        estrattiRaw = Array.isArray(f1.estratti) ? f1.estratti : [];
        pagineRaw = (Array.isArray(f1.pagine_rilevanti) ? f1.pagine_rilevanti : []).filter((p) => !isNaN(Number(p))).map(Number);
      }
      const estratti = estrattiRaw
        .filter((x) => x && typeof x.contenuto === "string" && x.contenuto.trim())
        .slice(0, 20)
        .map((x, i) => {
          const sez = Number(x.sezione);
          return {
            id: `rg${isPrec ? "p" : ""}${i}_${Date.now() % 100000}`,
            sezione: sez >= 1 && sez <= 4 ? sez : 1,
            pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina),
            tema: String(x.tema || "Informazione").trim(),
            contenuto: x.contenuto.trim().slice(0, 600),
            incluso: true,
          };
        });
      const pagine = [...new Set(pagineRaw)].sort((a, b) => a - b);
      if (estratti.length === 0)
        throw new Error(isPrec
          ? (modalitaSingoloAnno
              ? `Nessuna informazione riferita all'esercizio ${annoRifPrec || "precedente"} trovata: verifica che il documento sia la Relazione sulla Gestione di quell'esercizio`
              : `Nessuna informazione riferita all'esercizio precedente trovata: verifica che la Relazione sulla Gestione contenga il raffronto con l'anno comparativo (${annoRifPrec})`)
          : "Nessuna informazione utile alla riclassificazione trovata: verifica che il documento sia la Relazione sulla Gestione");
      setFiltroT({ pagine, estratti, applicato: false });

      // ── Fase 2: applicazione alle voci del bilancio (come la NI) ──
      setRgFase(2);
      const elenco = vociT.map((v) => `- ${v.nome} → ${fmt(parse(v.importo))} → ${v.classe}`).join("\n") || "(nessuna voce ancora estratta)";
      const estrattiTxt = estratti.map((x) => `[sez. ${x.sezione}${x.pagina != null ? ` · p. ${x.pagina}` : ""} — ${x.tema}]\n${x.contenuto}`).join("\n\n");
      const prompt = buildRgApplyPrompt(systemPrompts.CLASSI_DOC).replace("{{VOCI}}", elenco).replace("{{ESTRATTI}}", estrattiTxt) + schemaCtx
        + (isPrec
          ? "\n\n⚠ Le VOCI elencate sopra sono quelle dell'ESERCIZIO PRECEDENTE (T-1) e le informazioni filtrate sono riferite allo stesso esercizio: applica le rettifiche solo a queste voci." + istrSingoloAnno(true)
          : istrSingoloAnno(false));
      const f2 = await callAI([{ type: "text", text: prompt }]);

      let applicateR = 0, applicateS = 0, scartate = 0;
      let next = [...vociT];
      const impRiclass = [], impScomp = [];
      const findByName = (nome) => {
        const t = String(nome || "").trim().toLowerCase();
        return next.find((v) => v.nome.trim().toLowerCase() === t) ||
               next.find((v) => v.nome.trim().toLowerCase().includes(t) || t.includes(v.nome.trim().toLowerCase()));
      };
      for (const rr of Array.isArray(f2.riclassificazioni) ? f2.riclassificazioni : []) {
        const target = findByName(rr.voce);
        if (target && CLASSI[rr.classe]) {
          impRiclass.push({ nome: target.nome, importo: parse(target.importo), classePrima: target.classe, classeDopo: rr.classe, motivo: typeof rr.motivo === "string" ? rr.motivo.trim() : "" });
          next = next.map((v) => (v.id === target.id ? { ...v, classe: rr.classe } : v));
          applicateR++;
        } else scartate++;
      }
      for (const s of Array.isArray(f2.scomposizioni) ? f2.scomposizioni : []) {
        const target = findByName(s.voce_originale);
        const dett = (Array.isArray(s.dettagli) ? s.dettagli : [])
          .filter((x) => x && typeof x.nome === "string" && !isNaN(Number(x.importo)) && Number(x.importo) > 0 && CLASSI[x.classe]);
        if (!target || dett.length === 0) { scartate++; continue; }
        const somma = dett.reduce((a, x) => a + Number(x.importo), 0);
        const orig = parse(target.importo);
        if (somma > orig + tolleranzaMilioni(orig)) { scartate++; continue; }
        const residuo = orig - somma;
        impScomp.push({
          originale: target.nome, importoOrig: orig, classeOrig: target.classe,
          residuo: residuo > tolleranzaMilioni(orig) ? residuo : 0, motivo: typeof s.motivo === "string" ? s.motivo.trim() : "",
          parti: dett.map((x) => ({ nome: x.nome.trim(), importo: Number(x.importo), classe: x.classe })),
        });
        next = next.flatMap((v) => {
          if (v.id !== target.id) return [v];
          const nuovi = dett.map((x) => ({ id: newId(), nome: x.nome.trim(), importo: sImp(Number(x.importo)), sezione: v.sezione, classe: x.classe }));
          return residuo > tolleranzaMilioni(orig) ? [{ ...v, nome: `${v.nome} (residuo)`, importo: sImp(residuo) }, ...nuovi] : nuovi;
        });
        applicateS++;
      }
      const oss = Array.isArray(f2.osservazioni) ? f2.osservazioni.filter((o) => typeof o === "string" && o.trim()).slice(0, 4) : [];

      setVociT(next);
      setOssT(oss);
      setFiltroT({ pagine, estratti, applicato: true });
      setImpattoT({ riclass: impRiclass, scomp: impScomp, scartate });
      // Solo l'anno corrente invalida la validazione e la valutazione IA della
      // NI: la passata T-1 tocca vociPrec e non deve azzerare il lavoro su voci.
      if (!isPrec) {
        setNiEval({ loading: false, error: null, data: null }); // la valutazione NI va rigenerata sui dati aggiornati
        setValidato(false);
      }

      const pg = pagine.length ? ` (pagine rilevanti: ${pagine.join(", ")})` : "";
      setAiFor(aiKey, {
        loading: false, error: null,
        ok: `Relazione sulla Gestione ${isPrec ? "dell'esercizio precedente " : ""}«${file.name}» analizzata${nPorzioni > 1 ? ` (suddivisa in ${nPorzioni} porzioni${porzioniFallite ? `, ${porzioniFallite} non analizzabili` : ""})` : ""}: ${estratti.length} informazioni utili${pg} → ${applicateR} riclassificazioni e ${applicateS} scomposizioni${scartate ? `, ${scartate} scartate` : ""}. Vedi la sezione «${isPrec ? "8" : "3"}».`,
      });
      // La passata T-1 non cambia scheda: in doppia passata l'utente resta
      // sulla sezione 3, in caricamento manuale è già sulla sezione 8.
      if (!isPrec) setTab("rg");
    } catch (err) {
      setAiFor(aiKey, { loading: false, error: err.message || "Errore durante l'analisi della Relazione sulla Gestione", ok: null });
    } finally {
      setRgFase(null);
      setNiChunks(null);
    }
  }

  // Esercizio corrente ed esercizio precedente processati dalla STESSA
  // funzione pura: rPrec elabora vociPrec esattamente come r elabora voci.
  const r = useMemo(() => riclassificaVoci(voci), [voci]);
  const rPrec = useMemo(() => riclassificaVoci(vociPrec), [vociPrec]);

  // ── GATEKEEPER ALGEBRICO DI COERENZA CLASSIFICATORIA ──────────
  // Rete di sicurezza matematica INDIPENDENTE dall'IA: confronta il peso
  // dell'Attivo Corrente sul totale impieghi tra i due esercizi. Uno shift
  // ≥ 10 punti percentuali è quasi sempre sintomo di una macro-voce (tipico
  // caso: crediti da finanziamento) scomposta in un anno e non nell'altro,
  // non di un reale cambiamento della struttura patrimoniale.
  const gatekeeper = useMemo(() => {
    if (!voci.length || !vociPrec.length || r.totImpieghi === 0 || rPrec.totImpieghi === 0) return null;

    const pesoCorrenteT = r.attivoCircolante / r.totImpieghi;
    const pesoCorrenteT1 = rPrec.attivoCircolante / rPrec.totImpieghi;
    const shiftCorrente = pesoCorrenteT - pesoCorrenteT1;

    if (Math.abs(shiftCorrente) >= 0.10) {
      return {
        allerta: true,
        valore: shiftCorrente,
        messaggio: `Rilevato uno shift anomalo del ${(Math.abs(shiftCorrente) * 100).toFixed(1)}% nella composizione dell'Attivo (Corrente vs Non Corrente) tra i due esercizi. Verifica i criteri di scomposizione delle macro-voci (es. crediti da finanziamento) prima di interpretare gli indici, poiché variazioni così brusche possono falsare modelli come il Beneish M-Score.`
      };
    }
    return null;
  }, [r, rPrec, voci.length, vociPrec.length]);

  // ── MOTORE DEI DELTA PATRIMONIALI (ponte verso il Rendiconto Finanziario) ──
  // Differenza algebrica rigorosa (anno corrente − anno precedente) dei
  // principali aggregati: sono le grandezze del Metodo Indiretto (ΔCCNO,
  // ΔTFR e Fondi), del CAPEX (ΔImmobilizzazioni) e della dinamica
  // finanziaria a breve (ΔPFNbt) e patrimoniale (ΔPN).
  const deltaPatrimoniali = useMemo(() => ({
    ccno: { label: "Δ CCNO — Capitale circolante netto operativo", corrente: r.ccno, precedente: rPrec.ccno, delta: r.ccno - rPrec.ccno },
    immobilizzazioni: { label: "Δ Immobilizzazioni operative (proxy CAPEX)", corrente: r.immobOper, precedente: rPrec.immobOper, delta: r.immobOper - rPrec.immobOper },
    pfnBreve: { label: "Δ PFN a breve termine", corrente: r.pfnBreve, precedente: rPrec.pfnBreve, delta: r.pfnBreve - rPrec.pfnBreve },
    tfrFondi: { label: "Δ TFR e Fondi (passività operative non correnti)", corrente: r.passOpNC, precedente: rPrec.passOpNC, delta: r.passOpNC - rPrec.passOpNC },
    patrimonioNetto: { label: "Δ Patrimonio netto", corrente: r.pn, precedente: rPrec.pn, delta: r.pn - rPrec.pn },
    debFinNC: { label: "Δ Debiti finanziari non correnti", corrente: r.debFinNC, precedente: rPrec.debFinNC, delta: r.debFinNC - rPrec.debFinNC },
    accessoriFin: { label: "Δ Impieghi accessori e altre attività finanziarie", corrente: r.accessori + r.finAltre, precedente: rPrec.accessori + rPrec.finAltre, delta: (r.accessori + r.finAltre) - (rPrec.accessori + rPrec.finAltre) },
    liquidita: { label: "Δ Liquidità immediata", corrente: r.liq, precedente: rPrec.liq, delta: r.liq - rPrec.liq },
  }), [r, rPrec]);

  const d = useMemo(() => {
    const fat = parse(det.fatturato);
    const cons = parse(det.consumi);
    const acq = parse(det.acquisti);
    const cred = det.crediti !== "" ? parse(det.crediti) : r.attOpCorr;
    const scor = det.scorte !== "" ? parse(det.scorte) : r.attOpMag;
    const forn = det.fornitori !== "" ? parse(det.fornitori) : r.passOpCorr;
    const ccnc = cred + scor - forn;
    const ggClienti = fat > 0 ? (cred / fat) * 360 : null;
    const ggScorte = cons > 0 ? (scor / cons) * 360 : null;
    const ggFornitori = acq > 0 ? (forn / acq) * 360 : null;
    const cicloAttivo = ggClienti != null && ggScorte != null ? ggClienti + ggScorte : null;
    const cicloMonetario = cicloAttivo != null && ggFornitori != null ? cicloAttivo - ggFornitori : null;
    const ggScortePond = ggScorte != null && fat > 0 ? ggScorte * (cons / fat) : null;
    const ggFornPond = ggFornitori != null && fat > 0 ? ggFornitori * (acq / fat) : null;
    const cicloPond = ggClienti != null && ggScortePond != null && ggFornPond != null ? ggClienti + ggScortePond - ggFornPond : null;
    const ccncVerifica = cicloPond != null && fat > 0 ? (fat / 360) * cicloPond : null;
    const aliquota = fat > 0 ? ccnc / fat : null;
    const crescita = parse(det.crescita);
    const deltaFat = fat * (crescita / 100);
    const deltaCcnc = aliquota != null ? aliquota * deltaFat : null;
    const durPct = Math.min(Math.max(parse(det.durevolePct), 0), 100);
    const durevole = ccnc * (durPct / 100);
    const fluttuante = ccnc - durevole;
    const sostenibilita = fluttuante > 0 ? r.debFinC / fluttuante : null;
    const ready = fat > 0 && cons > 0 && acq > 0;
    return { fat, cons, acq, cred, scor, forn, ccnc, ggClienti, ggScorte, ggFornitori, cicloAttivo, cicloMonetario, ggScortePond, ggFornPond, cicloPond, ccncVerifica, aliquota, crescita, deltaFat, deltaCcnc, durPct, durevole, fluttuante, sostenibilita, ready };
  }, [det, r]);

  const seg = useMemo(() => {
    const vociSeg = voci.filter((v) => CLASSI_SEGMENTABILI.includes(v.classe));
    const dests = [...asaList.map((a) => a.id), "comune"];
    const agg = {};
    dests.forEach((dst) => { agg[dst] = { mag: 0, cred: 0, passC: 0, immob: 0, passNC: 0 }; });
    vociSeg.forEach((v) => {
      const dst = asaMap[v.id] && dests.includes(asaMap[v.id]) ? asaMap[v.id] : "comune";
      const imp = parse(v.importo);
      const a = agg[dst];
      if (v.classe === "att_op_magazzino") a.mag += imp;
      else if (v.classe === "att_op_corrente") a.cred += imp;
      else if (v.classe === "pass_op_corrente") a.passC += imp;
      else if (v.classe === "att_op_immobilizzata") a.immob += imp;
      else if (v.classe === "pass_op_non_corrente") a.passNC += imp;
    });
    const cols = dests.map((dst) => {
      const a = agg[dst];
      const ccnc = a.mag + a.cred - a.passC;
      const strutt = a.immob - a.passNC;
      const coin = ccnc + strutt;
      const nome = dst === "comune" ? "Comune" : (asaList.find((x) => x.id === dst)?.nome || dst);
      return { dst, nome, ...a, ccnc, strutt, coin };
    });
    const tot = cols.reduce(
      (s, c) => ({ mag: s.mag + c.mag, cred: s.cred + c.cred, passC: s.passC + c.passC, immob: s.immob + c.immob, passNC: s.passNC + c.passNC, ccnc: s.ccnc + c.ccnc, strutt: s.strutt + c.strutt, coin: s.coin + c.coin }),
      { mag: 0, cred: 0, passC: 0, immob: 0, passNC: 0, ccnc: 0, strutt: 0, coin: 0 }
    );
    const nAssegnate = vociSeg.filter((v) => asaMap[v.id] && asaMap[v.id] !== "comune" && dests.includes(asaMap[v.id])).length;
    const quadraturaOk = Math.abs(tot.coin - r.cinOper) < tolleranzaMilioni(tot.coin, r.cinOper);
    return { vociSeg, cols, tot, nAssegnate, quadraturaOk };
  }, [voci, asaList, asaMap, r]);

  async function suggerisciAsaAllocazione() {
    setAsaAi({ loading: true, error: null, ok: null });
    try {
      if (seg.vociSeg.length === 0) throw new Error("Nessuna voce operativa segmentabile: carica prima un bilancio");
      const asaTxt = asaList.map((a) => `${a.id}: ${a.nome}`).join("\n");
      const vociTxt = seg.vociSeg.map((v) => `${v.id} | ${v.nome} | ${CLASSI[v.classe]?.label || v.classe} | ${fmt(parse(v.importo))}`).join("\n");
      const niTxt = [
        ...(niFiltro?.estratti || []).filter((x) => x.incluso).map((x) => `- [${x.tema}] ${x.contenuto}`),
        ...niOss.map((o) => `- ${o}`),
      ].join("\n");
      const prompt = ASA_PROMPT
        .replace("{{ASA}}", asaTxt)
        .replace("{{NI}}", niTxt || "(nessuna)")
        .replace("{{VOCI}}", vociTxt);
      const parsed = await callAI([{ type: "text", text: prompt }]);
      const alloc = Array.isArray(parsed.allocazioni) ? parsed.allocazioni : [];
      const validDest = new Set([...asaList.map((a) => a.id), "comune"]);
      const validVoci = new Set(seg.vociSeg.map((v) => v.id));
      let applicate = 0;
      const nuovaMappa = {};
      alloc.forEach((a) => {
        if (a && validVoci.has(a.voce) && validDest.has(a.dest)) {
          nuovaMappa[a.voce] = a.dest;
          if (a.dest !== "comune") applicate++;
        }
      });
      setAsaMap((m) => ({ ...m, ...nuovaMappa }));
      setAsaAi({
        loading: false, error: null,
        ok: `Proposta IA applicata: ${applicate} voci allocate alle ASA, ${seg.vociSeg.length - applicate} lasciate in «Comune» (criterio prudenziale). Ricontrolla e correggi liberamente le assegnazioni.`,
      });
    } catch (err) {
      setAsaAi({ loading: false, error: err.message || "Errore durante il suggerimento IA", ok: null });
    }
  }
  const hasData = voci.length > 0;
  const sbilancio = r.totAttivoContab - r.totPassivoContab;
  const quadra = Math.abs(sbilancio) < tolleranzaMilioni(r.totAttivoContab, r.totPassivoContab);
  const quadraFun = Math.abs(r.totImpieghiFun - r.totFontiFun) < tolleranzaMilioni(r.totImpieghiFun, r.totFontiFun);
  const nNonClass = r.nonClass.length;

  // ── Derivate per l'esercizio precedente ─────────────────────
  const hasDataPrec = vociPrec.length > 0;
  const sbilancioPrec = rPrec.totAttivoContab - rPrec.totPassivoContab;
  const quadraPrec = Math.abs(sbilancioPrec) < tolleranzaMilioni(rPrec.totAttivoContab, rPrec.totPassivoContab);
  const quadraFunPrec = Math.abs(rPrec.totImpieghiFun - rPrec.totFontiFun) < tolleranzaMilioni(rPrec.totImpieghiFun, rPrec.totFontiFun);
  const nNonClassPrec = rPrec.nonClass.length;
  const annoCorr = (esercizio.match(/\d{4}/) || [])[0] || annoRif;
  const annoPrec = (esercizioPrec.match(/\d{4}/) || [])[0] || annoRifPrec;

  // ═══════════════════════════════════════════════════════════
  // TAB 11 · AUDIT & AUTO-FIX
  // ═══════════════════════════════════════════════════════════
  // L'audit NON tocca la logica di calcolo (calcKit, riclassificaVoci,
  // deltaPatrimoniali): legge il loro output e lo sottopone a revisione IA.

  // Elenco compatto con id espliciti: l'IA deve poter referenziare la voce
  // esatta da correggere, non il nome (che può essere ambiguo o duplicato).
  // Gli importi vanno in forma NUMERICA GREZZA (punto decimale, nessun
  // separatore di migliaia): il punto 1 della checklist ragiona sugli ordini di
  // grandezza e la formattazione italiana ("1.234.567") sarebbe ambigua.
  const elencoVociAudit = (arr) =>
    arr.length
      ? arr.map((v) => `[${v.id}] ${v.nome} | ${parse(v.importo)} | ${v.sezione} | ${v.classe}`).join("\n")
      : "(nessuna voce presente per questo esercizio)";

  async function eseguiAudit() {
    setAuditState({ loading: true, data: null, error: null });
    setAuditAzioni({});
    try {
      if (!voci.length && !vociPrec.length)
        throw new Error("Nessuna voce da controllare: carica e valida almeno un esercizio nella sezione 1.");

      const deltaTxt = Object.values(deltaPatrimoniali)
        .map((dd) => `- ${dd.label}: ${annoCorr} = ${Math.round(dd.corrente)} | ${annoPrec} = ${Math.round(dd.precedente)} | Δ = ${Math.round(dd.delta)}${dd.precedente !== 0 ? ` (${((dd.delta / Math.abs(dd.precedente)) * 100).toFixed(1)}%)` : ""}`)
        .join("\n");

      const schemaTxt = schemaInfo
        ? `SCHEMA CONTABILE RICONOSCIUTO: ${systemPrompts.SCHEMI[schemaInfo.schema]?.label || schemaInfo.schema}${schemaInfo.valuta ? ` — valuta ${schemaInfo.valuta}` : ""}${schemaInfo.unita && schemaInfo.unita !== "unità" ? ` — importi espressi in ${schemaInfo.unita}` : ""}.\nREGOLE DELLO SCHEMA DA FAR RISPETTARE:\n${systemPrompts.SCHEMI[schemaInfo.schema]?.regole || systemPrompts.SCHEMI.altro.regole}`
        : `SCHEMA CONTABILE NON RICONOSCIUTO: applica il principio di prevalenza della sostanza economica sulla forma.\n${systemPrompts.SCHEMI.altro.regole}`;

      const prompt = buildAuditPrompt({
        classiDoc: systemPrompts.CLASSI_DOC,
        annoCorr,
        annoPrec,
        vociTxt: elencoVociAudit(voci),
        vociPrecTxt: elencoVociAudit(vociPrec),
        deltaTxt: vociPrec.length ? deltaTxt : "(esercizio precedente non caricato: i punti 2 e 4 della checklist non sono applicabili)",
        schemaTxt,
      });

      const parsed = await callAI([{ type: "text", text: prompt }], 8000);

      const anomalie = sanificaAnomalie(parsed, voci, vociPrec);
      const esito = anomalie.length === 0 ? "superato" : "errori";
      setAuditState({
        loading: false,
        error: null,
        data: {
          esito,
          messaggioGenerale:
            String(parsed?.messaggioGenerale || "").trim() ||
            (esito === "superato"
              ? "Il controllo non ha rilevato violazioni della checklist sui dati validati."
              : `Il controllo ha rilevato ${anomalie.length} anomalie da esaminare.`),
          anomalie,
          scartate: Math.max((Array.isArray(parsed?.anomalie) ? parsed.anomalie.length : 0) - anomalie.length, 0),
          quando: new Date().toLocaleString("it-IT"),
        },
      });
    } catch (err) {
      setAuditState({ loading: false, data: null, error: err.message });
    }
  }

  // ✨ Correzione automatica: riusa gli editor esistenti delle voci, così la
  // catena reattiva (riclassificaVoci → calcKit → deltaPatrimoniali) si
  // ricalcola da sola senza alcuna scorciatoia sui dati.
  const auditCorreggi = (an, i) => {
    if (!an.autoFix?.eseguibile || !an.autoFix.nuovaClasse) return;
    if (an.esercizio === "corrente") updVoce(an.idVoce, "classe", an.autoFix.nuovaClasse);
    else updVocePrec(an.idVoce, "classe", an.autoFix.nuovaClasse);
    setAuditAzioni((s) => ({ ...s, [i]: { ...(s[i] || {}), fix: true } }));
  };

  // 🧠 Apprendimento: la regola viene appesa ai prompt di sistema e persistita.
  // target CLASSI_DOC → coda del blocco classi; target SCHEMI → coda delle
  // regole dello schema riconosciuto (o di tutti, se non ancora riconosciuto,
  // così la regola non va perduta qualunque schema venga poi rilevato).
  const auditInsegna = (an, i) => {
    const sug = an.promptUpdateSuggestion;
    if (!sug) return;
    salvaSystemPrompts(applicaRegolaAppresa(systemPrompts, sug, schemaInfo?.schema));
    setAuditAzioni((s) => ({ ...s, [i]: { ...(s[i] || {}), learn: true } }));
  };

  // ── MAPPATURA DEI Δ PATRIMONIALI PER LE CARD INTERATTIVE (Blocco B) ──
  // Ogni oggetto alimenta un CardInd: cliccando si apre DettaglioModal con
  // formula, composizione (saldo corrente vs precedente) e significato nel
  // Rendiconto Finanziario. Il colore segue la logica economica del segno:
  // per gli assorbimenti di cassa (CCNO, accessori/finanziari, liquidità)
  // un Δ positivo è "peggiore" (assorbe cassa) → RED; per le fonti di cassa
  // (debiti finanziari) un Δ positivo è "meglio" (nuova provvista) → GREEN;
  // per grandezze neutre (immobilizzazioni, TFR/Fondi, PN) il colore resta INK.
  const deltaCards = [
    {
      nome: "Δ Capitale Circolante Netto Operativo", val: deltaPatrimoniali.ccno.delta,
      colVal: deltaPatrimoniali.ccno.delta > 0 ? RED : deltaPatrimoniali.ccno.delta < 0 ? GREEN : INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione del capitale circolante netto operativo tra i due esercizi.",
      comp: [{ l: `CCNO ${annoCorr}`, v: deltaPatrimoniali.ccno.corrente }, { l: `CCNO ${annoPrec}`, v: deltaPatrimoniali.ccno.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.ccno.corrente)} − ${fmt(deltaPatrimoniali.ccno.precedente)} = ${fmt(deltaPatrimoniali.ccno.delta)}`,
      sig: "Alimenta il Metodo Indiretto. Un aumento del circolante assorbe liquidità operativa; una diminuzione la libera.",
      giud: ["info", "Area: Metodo Indiretto"],
    },
    {
      nome: "Δ Immobilizzazioni operative", val: deltaPatrimoniali.immobilizzazioni.delta,
      colVal: INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione grezza dell'attivo operativo immobilizzato tra i due esercizi.",
      comp: [{ l: `Immobilizzazioni ${annoCorr}`, v: deltaPatrimoniali.immobilizzazioni.corrente }, { l: `Immobilizzazioni ${annoPrec}`, v: deltaPatrimoniali.immobilizzazioni.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.immobilizzazioni.corrente)} − ${fmt(deltaPatrimoniali.immobilizzazioni.precedente)} = ${fmt(deltaPatrimoniali.immobilizzazioni.delta)}`,
      sig: "Rappresenta la variazione grezza del CAPEX. Andrà rettificata con ammortamenti e plus/minusvalenze per ottenere l'esborso monetario per investimenti.",
      giud: ["info", "Area: CAPEX"],
    },
    {
      nome: "Δ TFR e Fondi", val: deltaPatrimoniali.tfrFondi.delta,
      colVal: INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione delle passività operative non correnti (TFR, fondi rischi e oneri) tra i due esercizi.",
      comp: [{ l: `TFR e Fondi ${annoCorr}`, v: deltaPatrimoniali.tfrFondi.corrente }, { l: `TFR e Fondi ${annoPrec}`, v: deltaPatrimoniali.tfrFondi.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.tfrFondi.corrente)} − ${fmt(deltaPatrimoniali.tfrFondi.precedente)} = ${fmt(deltaPatrimoniali.tfrFondi.delta)}`,
      sig: "Alimenta il Metodo Indiretto. La variazione va confrontata con gli accantonamenti a Conto Economico per determinare i pagamenti reali effettuati nell'anno.",
      giud: ["info", "Area: Metodo Indiretto"],
    },
    {
      nome: "Δ Patrimonio Netto", val: deltaPatrimoniali.patrimonioNetto.delta,
      colVal: INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione del patrimonio netto complessivo tra i due esercizi.",
      comp: [{ l: `Patrimonio netto ${annoCorr}`, v: deltaPatrimoniali.patrimonioNetto.corrente }, { l: `Patrimonio netto ${annoPrec}`, v: deltaPatrimoniali.patrimonioNetto.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.patrimonioNetto.corrente)} − ${fmt(deltaPatrimoniali.patrimonioNetto.precedente)} = ${fmt(deltaPatrimoniali.patrimonioNetto.delta)}`,
      sig: "Gestione dell'Equity. Contiene l'utile d'esercizio (da depurare) e i movimenti con i soci come aumenti di capitale e distribuzione dividendi.",
      giud: ["info", "Area: Equity"],
    },
    {
      nome: "Δ PFN a breve termine", val: deltaPatrimoniali.pfnBreve.delta,
      colVal: deltaPatrimoniali.pfnBreve.delta > 0 ? RED : deltaPatrimoniali.pfnBreve.delta < 0 ? GREEN : INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione della posizione finanziaria netta a breve termine tra i due esercizi.",
      comp: [{ l: `PFN a breve ${annoCorr}`, v: deltaPatrimoniali.pfnBreve.corrente }, { l: `PFN a breve ${annoPrec}`, v: deltaPatrimoniali.pfnBreve.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.pfnBreve.corrente)} − ${fmt(deltaPatrimoniali.pfnBreve.precedente)} = ${fmt(deltaPatrimoniali.pfnBreve.delta)}`,
      sig: "Variazione dell'indebitamento finanziario a breve e della cassa non vincolata.",
      giud: ["info", "Area: Metodo Indiretto"],
    },
    {
      nome: "Δ Debiti Finanziari M/L termine", val: deltaPatrimoniali.debFinNC.delta,
      colVal: deltaPatrimoniali.debFinNC.delta > 0 ? GREEN : deltaPatrimoniali.debFinNC.delta < 0 ? RED : INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione dei debiti finanziari non correnti (mutui, obbligazioni, leasing oltre 12 mesi) tra i due esercizi.",
      comp: [{ l: `Debiti fin. M/L ${annoCorr}`, v: deltaPatrimoniali.debFinNC.corrente }, { l: `Debiti fin. M/L ${annoPrec}`, v: deltaPatrimoniali.debFinNC.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.debFinNC.corrente)} − ${fmt(deltaPatrimoniali.debFinNC.precedente)} = ${fmt(deltaPatrimoniali.debFinNC.delta)}`,
      sig: "Gestione Finanziaria Passiva. Mostra i capitali raccolti tramite nuovi mutui o le uscite per il rimborso delle quote capitale.",
      giud: ["info", "Area: Finanziamenti"],
    },
    {
      nome: "Δ Accessori e Finanziari", val: deltaPatrimoniali.accessoriFin.delta,
      colVal: deltaPatrimoniali.accessoriFin.delta > 0 ? RED : deltaPatrimoniali.accessoriFin.delta < 0 ? GREEN : INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione di impieghi accessori e altre attività finanziarie (titoli, crediti finanziari) tra i due esercizi.",
      comp: [{ l: `Accessori e fin. ${annoCorr}`, v: deltaPatrimoniali.accessoriFin.corrente }, { l: `Accessori e fin. ${annoPrec}`, v: deltaPatrimoniali.accessoriFin.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.accessoriFin.corrente)} − ${fmt(deltaPatrimoniali.accessoriFin.precedente)} = ${fmt(deltaPatrimoniali.accessoriFin.delta)}`,
      sig: "Gestione Finanziaria Attiva e Accessoria. Mostra la cassa assorbita o generata da investimenti non legati al core business.",
      giud: ["info", "Area: Investimenti"],
    },
    {
      nome: "Δ Liquidità Immediata", val: deltaPatrimoniali.liquidita.delta,
      colVal: INK,
      formula: `Saldo ${annoCorr} − Saldo ${annoPrec}`,
      desc: "Variazione della liquidità immediata (cassa e banche attive) tra i due esercizi.",
      comp: [{ l: `Liquidità ${annoCorr}`, v: deltaPatrimoniali.liquidita.corrente }, { l: `Liquidità ${annoPrec}`, v: deltaPatrimoniali.liquidita.precedente, s: "−" }],
      calc: `${fmt(deltaPatrimoniali.liquidita.corrente)} − ${fmt(deltaPatrimoniali.liquidita.precedente)} = ${fmt(deltaPatrimoniali.liquidita.delta)}`,
      sig: "È la quadratura assoluta del Rendiconto Finanziario (Failsafe). La somma algebrica di tutti i flussi di cassa (Operativo, Investimenti, Finanziamenti) dovrà coincidere esattamente con questo valore.",
      giud: ["info", "Area: Failsafe"],
    },
  ];

  // ── ESPORTAZIONE JSON (ponte verso il Rendiconto Finanziario) ──
  // Esporta i due esercizi (voci + Nota Integrativa) e, in un blocco
  // dedicato, i deltaPatrimoniali: il motore matematico (Metodo Indiretto
  // e CAPEX) che alimenterà il calcolo del Rendiconto Finanziario.
  function salvaDati() {
    const aggrega = (k) => ({
      ccno: k.ccno, immobOper: k.immobOper, pfnBreve: k.pfnBreve, passOpNC: k.passOpNC, pn: k.pn,
      attOpMag: k.attOpMag, attOpCorr: k.attOpCorr, passOpCorr: k.passOpCorr, accessori: k.accessori,
      liq: k.liq, finAltre: k.finAltre, debFinC: k.debFinC, debFinNC: k.debFinNC,
      pfn: k.pfn, fosn: k.fosn, cinOper: k.cinOper, cinTot: k.cinTot,
      totImpieghi: k.totImpieghi, totFonti: k.totFonti,
      totAttivoContab: k.totAttivoContab, totPassivoContab: k.totPassivoContab,
    });
    const stripId = (vs) => vs.map(({ nome, importo, sezione, classe }) => ({ nome, importo: parse(importo), sezione, classe }));
    const niBlock = (filtro, oss, impatto) => ({
      estratti: (filtro?.estratti || []).filter((x) => x.incluso).map(({ pagina, tema, contenuto }) => ({ pagina, tema, contenuto })),
      pagineRilevanti: filtro?.pagine || [],
      osservazioni: oss,
      impatto: impatto || { riclass: [], scomp: [], scartate: 0 },
    });
    const dati = {
      applicazione: "Riclassificazione SP — schema dinamico",
      formatoSalvataggio: 2,
      generato: new Date().toISOString(),
      schemaContabile: schemaInfo,
      esercizioCorrente: {
        esercizio: esercizio || annoCorr,
        voci: stripId(voci),
        aggregati: aggrega(r),
        notaIntegrativa: niBlock(niFiltro, niOss, niImpatto),
      },
      esercizioPrecedente: {
        esercizio: esercizioPrec || annoPrec,
        voci: stripId(vociPrec),
        aggregati: aggrega(rPrec),
        notaIntegrativa: niBlock(niFiltroPrec, niOssPrec, niImpattoPrec),
      },
      // ── STATO COMPLETO DELL'APPLICAZIONE (per il ricaricamento) ──
      // A differenza dei blocchi sopra (pensati per il consumo esterno, es.
      // Rendiconto Finanziario), questo blocco conserva gli stati React così
      // come sono — inclusi gli id delle voci, necessari per ripristinare le
      // allocazioni ASA — e consente di riprendere il lavoro esattamente da
      // dove era stato salvato con «📂 Carica dati salvati».
      statoApplicazione: {
        voci, esercizio, schemaInfo, validato,
        niFiltro, niOss, niImpatto,
        rgFiltro, rgOss, rgImpatto,
        vociPrec, esercizioPrec, niFiltroPrec, niOssPrec, niImpattoPrec,
        rgFiltroPrec, rgOssPrec, rgImpattoPrec,
        niEvalData: niEval.data,
        det, asaList, asaMap,
        modalitaSingoloAnno, annoSpecifico, annoSpecificoPrec,
      },
      // Blocco dedicato: motore dei Δ per il Rendiconto Finanziario
      deltaPatrimoniali: {
        nota: "Variazioni algebriche (anno corrente − anno precedente) degli aggregati patrimoniali: ΔCCNO e ΔTFR/Fondi alimentano il Metodo Indiretto, ΔImmobilizzazioni il CAPEX, ΔPFNbt, ΔDebFinNC e ΔAccessoriFin la dinamica finanziaria, ΔPN la dinamica patrimoniale, ΔLiquidità è la quadratura assoluta (failsafe) del Rendiconto.",
        deltaCCNO: deltaPatrimoniali.ccno.delta,
        deltaImmobilizzazioni: deltaPatrimoniali.immobilizzazioni.delta,
        deltaPFNbt: deltaPatrimoniali.pfnBreve.delta,
        deltaTfrEFondi: deltaPatrimoniali.tfrFondi.delta,
        deltaPatrimonioNetto: deltaPatrimoniali.patrimonioNetto.delta,
        deltaDebFinNC: deltaPatrimoniali.debFinNC.delta,
        deltaAccessoriFin: deltaPatrimoniali.accessoriFin.delta,
        deltaLiquidita: deltaPatrimoniali.liquidita.delta,
        dettaglio: deltaPatrimoniali,
      },
    };
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // In Modalità Singolo Anno senza dati T-1 il nome «X-vs-Y» sarebbe fuorviante.
    a.download = vociPrec.length
      ? `riclassificazione-sp_${annoCorr}-vs-${annoPrec}.json`
      : `riclassificazione-sp_${annoCorr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── CARICAMENTO DI UN SALVATAGGIO JSON ──────────────────────
  // Ripristina lo stato dell'applicazione da un file esportato con
  // «💾 Esporta JSON». Supporta due formati:
  //  · formato 2 (attuale): blocco statoApplicazione con gli stati completi;
  //  · formato 1 (retrocompatibile): i soli blocchi esercizioCorrente /
  //    esercizioPrecedente dei vecchi export, dai quali si ricostruisce il
  //    possibile (voci, esercizi, estratti e impatti NI; niente rettifiche).
  // Ogni voce viene sanificata: classe validata contro CLASSI (altrimenti
  // «da_classificare»), importo forzato a numero, sezione normalizzata.
  function sanificaVoci(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((v) => v && typeof v.nome === "string" && v.nome.trim())
      .map((v) => {
        const n = parseIA(v.importo);
        return {
          id: typeof v.id === "string" && v.id ? v.id : newId(),
          nome: v.nome,
          importo: sImp(isNaN(n) ? 0 : n),
          sezione: v.sezione === "passivo" ? "passivo" : "attivo",
          classe: CLASSI[v.classe] ? v.classe : "da_classificare",
        };
      });
  }

  function sanificaFiltroNi(filtro) {
    if (!filtro || !Array.isArray(filtro.estratti) || filtro.estratti.length === 0) return null;
    return {
      pagine: Array.isArray(filtro.pagine) ? filtro.pagine.filter((p) => !isNaN(Number(p))).map(Number) : [],
      estratti: filtro.estratti
        .filter((x) => x && typeof x.contenuto === "string")
        .map((x, i) => ({
          id: typeof x.id === "string" && x.id ? x.id : `imp${i}_${Date.now() % 100000}`,
          pagina: isNaN(Number(x.pagina)) ? null : Number(x.pagina),
          tema: String(x.tema || "Informazione"),
          contenuto: x.contenuto,
          incluso: x.incluso !== false,
        })),
      applicato: filtro.applicato !== false,
    };
  }

  function caricaDati(dati) {
    const st = dati?.statoApplicazione;
    const resetAi = { master: { loading: false, error: null, ok: null }, sp: { loading: false, error: null, ok: null }, ni: { loading: false, error: null, ok: null }, rg: { loading: false, error: null, ok: null }, spPrec: { loading: false, error: null, ok: null }, niPrec: { loading: false, error: null, ok: null }, rgPrec: { loading: false, error: null, ok: null } };

    if (st && Array.isArray(st.voci)) {
      // ── Formato 2: stato completo ──
      const v = sanificaVoci(st.voci);
      if (v.length === 0) throw new Error("il salvataggio non contiene voci valide dell'esercizio corrente");
      setVoci(v);
      setEsercizio(typeof st.esercizio === "string" ? st.esercizio : "");
      setSchemaInfo(st.schemaInfo && systemPrompts.SCHEMI[st.schemaInfo.schema] ? st.schemaInfo : null);
      setValidato(!!st.validato);
      setNiFiltro(sanificaFiltroNi(st.niFiltro));
      setNiOss(Array.isArray(st.niOss) ? st.niOss.filter((o) => typeof o === "string") : []);
      setNiImpatto(st.niImpatto && (Array.isArray(st.niImpatto.riclass) || Array.isArray(st.niImpatto.scomp))
        ? { riclass: st.niImpatto.riclass || [], scomp: st.niImpatto.scomp || [], scartate: Number(st.niImpatto.scartate) || 0 } : null);
      setVociPrec(sanificaVoci(st.vociPrec));
      setEsercizioPrec(typeof st.esercizioPrec === "string" ? st.esercizioPrec : "");
      setNiFiltroPrec(sanificaFiltroNi(st.niFiltroPrec));
      setNiOssPrec(Array.isArray(st.niOssPrec) ? st.niOssPrec.filter((o) => typeof o === "string") : []);
      setNiImpattoPrec(st.niImpattoPrec && (Array.isArray(st.niImpattoPrec.riclass) || Array.isArray(st.niImpattoPrec.scomp))
        ? { riclass: st.niImpattoPrec.riclass || [], scomp: st.niImpattoPrec.scomp || [], scartate: Number(st.niImpattoPrec.scartate) || 0 } : null);
      // Relazione sulla Gestione (Sezione 3)
      setRgFiltro(sanificaFiltroNi(st.rgFiltro));
      setRgOss(Array.isArray(st.rgOss) ? st.rgOss.filter((o) => typeof o === "string") : []);
      setRgImpatto(st.rgImpatto && (Array.isArray(st.rgImpatto.riclass) || Array.isArray(st.rgImpatto.scomp))
        ? { riclass: st.rgImpatto.riclass || [], scomp: st.rgImpatto.scomp || [], scartate: Number(st.rgImpatto.scartate) || 0 } : null);
      // Relazione sulla Gestione — esercizio precedente (Sezione 8)
      setRgFiltroPrec(sanificaFiltroNi(st.rgFiltroPrec));
      setRgOssPrec(Array.isArray(st.rgOssPrec) ? st.rgOssPrec.filter((o) => typeof o === "string") : []);
      setRgImpattoPrec(st.rgImpattoPrec && (Array.isArray(st.rgImpattoPrec.riclass) || Array.isArray(st.rgImpattoPrec.scomp))
        ? { riclass: st.rgImpattoPrec.riclass || [], scomp: st.rgImpattoPrec.scomp || [], scartate: Number(st.rgImpattoPrec.scartate) || 0 } : null);
      const rgOk = !!(st.rgImpatto || (st.rgFiltro && Array.isArray(st.rgFiltro.estratti) && st.rgFiltro.estratti.length));
      setNiEval({ loading: false, error: null, data: st.niEvalData || null });
      if (st.det && typeof st.det === "object")
        setDet({ fatturato: "", consumi: "", acquisti: "", crediti: "", scorte: "", fornitori: "", crescita: "10", durevolePct: "60", ...st.det });
      if (Array.isArray(st.asaList) && st.asaList.length > 0)
        setAsaList(st.asaList.filter((a) => a && typeof a.id === "string" && typeof a.nome === "string"));
      setAsaMap(st.asaMap && typeof st.asaMap === "object" ? st.asaMap : {});
      // Modalità Singolo Anno: ripristino della modalità e dei due anni, così
      // il lavoro riprende con la stessa ancora temporale con cui era iniziato.
      setModalitaSingoloAnno(!!st.modalitaSingoloAnno);
      setAnnoSpecifico(typeof st.annoSpecifico === "string" ? st.annoSpecifico : "");
      setAnnoSpecificoPrec(typeof st.annoSpecificoPrec === "string" ? st.annoSpecificoPrec : "");
      setAi(resetAi);
      const nPrec = Array.isArray(st.vociPrec) ? sanificaVoci(st.vociPrec).length : 0;
      setImportEsito({ level: "ok", text: `Salvataggio caricato: ${v.length} voci ${st.esercizio || ""}${nPrec ? ` + ${nPrec} voci dell'esercizio precedente` : ""}${rgOk ? " · Relazione sulla Gestione ripristinata" : ""}. Puoi riprendere il lavoro da dove l'avevi lasciato.` });
      setTab("dati");
      return;
    }

    // ── Formato 1 (retrocompatibile): solo blocchi dati ──
    const ec = dati?.esercizioCorrente, ep = dati?.esercizioPrecedente;
    if ((ec && Array.isArray(ec.voci)) || (ep && Array.isArray(ep.voci))) {
      const ricostruisciNi = (blocco) => {
        const niB = blocco?.notaIntegrativa;
        return {
          filtro: sanificaFiltroNi(niB ? { estratti: niB.estratti, pagine: niB.pagineRilevanti, applicato: true } : null),
          oss: Array.isArray(niB?.osservazioni) ? niB.osservazioni.filter((o) => typeof o === "string") : [],
          impatto: niB?.impatto && (Array.isArray(niB.impatto.riclass) || Array.isArray(niB.impatto.scomp))
            ? { riclass: niB.impatto.riclass || [], scomp: niB.impatto.scomp || [], scartate: Number(niB.impatto.scartate) || 0 } : null,
        };
      };
      const vC = sanificaVoci(ec?.voci);
      const vP = sanificaVoci(ep?.voci);
      if (vC.length === 0 && vP.length === 0) throw new Error("il salvataggio non contiene voci valide");
      const niC = ricostruisciNi(ec), niP = ricostruisciNi(ep);
      setVoci(vC);
      setEsercizio(typeof ec?.esercizio === "string" ? ec.esercizio : "");
      setSchemaInfo(dati.schemaContabile && systemPrompts.SCHEMI[dati.schemaContabile.schema] ? dati.schemaContabile : null);
      setValidato(false);
      setNiFiltro(niC.filtro); setNiOss(niC.oss); setNiImpatto(niC.impatto);
      setVociPrec(vP);
      setEsercizioPrec(typeof ep?.esercizio === "string" ? ep.esercizio : "");
      setNiFiltroPrec(niP.filtro); setNiOssPrec(niP.oss); setNiImpattoPrec(niP.impatto);
      setRgFiltro(null); setRgOss([]); setRgImpatto(null);
      setRgFiltroPrec(null); setRgOssPrec([]); setRgImpattoPrec(null);
      setNiEval({ loading: false, error: null, data: null });
      setAsaMap({});
      setAi(resetAi);
      setImportEsito({ level: "ok", text: `Salvataggio (formato precedente) caricato: ${vC.length} voci${vP.length ? ` + ${vP.length} voci dell'esercizio precedente` : ""}. Relazione sulla Gestione e allocazioni ASA non presenti nel vecchio formato: potrai rigenerarle.` });
      setTab("dati");
      return;
    }

    throw new Error("struttura non riconosciuta: seleziona un file esportato da questa applicazione con «💾 Esporta JSON»");
  }

  async function handleJsonFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const testo = await file.text();
      let dati;
      try { dati = JSON.parse(testo); }
      catch { throw new Error("il file non è un JSON valido"); }
      caricaDati(dati);
    } catch (err) {
      setImportEsito({ level: "bad", text: `Caricamento non riuscito: ${err.message || "errore imprevisto"}` });
    } finally {
      if (jsonFileRef.current) jsonFileRef.current.value = "";
    }
  }

  const g = {
    msPrimario: r.msPrimario >= 0 ? ["ok", "Autocopertura delle immobilizzazioni: struttura molto solida"] : ["info", "Negativo: fisiologico se coperto dal margine secondario"],
    msSecondario: r.msSecondario >= 0 ? ["ok", "Le fonti durevoli coprono l'attivo fisso: equilibrio strutturale"] : ["bad", "Immobilizzazioni finanziate con debiti a breve: squilibrio"],
    ccn: r.ccn > 0 ? ["ok", "L'attivo circolante copre i debiti a breve"] : ["bad", "Rischio di tensione finanziaria a breve termine"],
    mt: r.mt >= 0 ? ["ok", "Liquidità sufficienti anche senza smobilizzare il magazzino"] : r.ccn > 0 ? ["warn", "Equilibrio a breve dipendente dal realizzo del magazzino"] : ["bad", "Deficit di tesoreria"],
    autonomia: r.autonomia >= 0.66 ? ["ok", "Ottima capitalizzazione"] : r.autonomia >= 0.33 ? ["warn", "Capitalizzazione da monitorare"] : ["bad", "Sottocapitalizzazione: forte dipendenza da terzi"],
    leverage: r.leverage == null ? ["bad", "PN nullo o negativo"] : r.leverage <= 2 ? ["ok", "Indebitamento equilibrato"] : r.leverage <= 3 ? ["warn", "Indebitamento significativo"] : ["bad", "Leva finanziaria eccessiva"],
    copPrimaria: r.copPrimaria == null ? ["info", "—"] : r.copPrimaria >= 1 ? ["ok", "≥ 1: autocopertura"] : ["info", "< 1: verificare copertura secondaria"],
    copSecondaria: r.copSecondaria == null ? ["info", "—"] : r.copSecondaria >= 1 ? ["ok", "≥ 1: correlazione fonti-impieghi rispettata"] : ["bad", "< 1: squilibrio strutturale"],
    current: r.current == null ? ["info", "—"] : r.current >= 2 ? ["ok", "Ottima disponibilità"] : r.current >= 1 ? ["warn", "Accettabile, da monitorare"] : ["bad", "Insufficiente"],
    quick: r.quick == null ? ["info", "—"] : r.quick >= 1 ? ["ok", "Buona liquidità"] : r.quick >= 0.7 ? ["warn", "Liquidità tesa"] : ["bad", "Liquidità insufficiente"],
    pfn: r.pfn <= 0 ? ["ok", "Cassa netta: liquidità superiori ai debiti finanziari"] : ["info", "Debito finanziario netto da valutare rispetto a PN e redditività"],
    pfnBreve: r.pfnBreve <= 0 ? ["ok", "Le attività finanziarie coprono i debiti finanziari a breve"] : ["warn", "Debiti finanziari a breve non coperti dalle attività finanziarie"],
    gearing: r.gearing == null ? ["bad", "PN nullo o negativo"] : r.gearing <= 0 ? ["ok", "Posizione di cassa netta"] : r.gearing <= 1 ? ["ok", "Struttura finanziaria equilibrata"] : r.gearing <= 2 ? ["warn", "Indebitamento finanziario significativo"] : ["bad", "Indebitamento finanziario eccessivo"],
    ccno: r.ccno >= 0 ? ["info", "Il circolante operativo assorbe risorse finanziarie"] : ["info", "Circolante negativo: la gestione operativa genera risorse"],
  };

  const margini = [
    { nome: "Margine di struttura primario", formula: "PN − Attivo fisso", val: r.msPrimario, giud: g.msPrimario,
      desc: "Capacità del capitale proprio di finanziare da solo l'attivo immobilizzato.",
      comp: [{ l: "Patrimonio netto", v: r.pn, s: "+" }, { l: "Attivo fisso (immob. operative + accessorie)", v: r.attivoFisso, s: "−" }],
      calc: `${fmt(r.pn)} − ${fmt(r.attivoFisso)} = ${fmt(r.msPrimario)}`,
      sig: "Se positivo, i soci finanziano da soli tutti gli investimenti durevoli: l'azienda non dipende da terzi per la propria struttura. Se negativo non è necessariamente un problema: conta che la parte scoperta sia coperta da fonti a medio-lungo termine (verificalo con il margine secondario) e non da debiti a breve." },
    { nome: "Margine di struttura secondario", formula: "(PN + Pass. consolidate) − Attivo fisso", val: r.msSecondario, giud: g.msSecondario,
      desc: "Correlazione tra fonti durevoli e impieghi a lungo ciclo di utilizzo.",
      comp: [{ l: "Patrimonio netto", v: r.pn, s: "+" }, { l: "Passività consolidate (oltre 12 mesi)", v: r.passConsolidate, s: "+" }, { l: "Attivo fisso", v: r.attivoFisso, s: "−" }],
      calc: `${fmt(r.pn)} + ${fmt(r.passConsolidate)} − ${fmt(r.attivoFisso)} = ${fmt(r.msSecondario)}`,
      sig: "Verifica la regola d'oro della finanza: gli investimenti che rientrano in molti anni (impianti, immobili) devono essere finanziati da fonti che scadono in molti anni (capitale proprio + mutui). Se negativo, parte delle immobilizzazioni è finanziata con debiti a breve: a ogni rinnovo l'azienda è esposta a tensioni di liquidità." },
    { nome: "Capitale circolante netto (CCN)", formula: "Attivo circolante − Pass. correnti", val: r.ccn, giud: g.ccn,
      desc: "Equilibrio finanziario di breve periodo (criterio finanziario).",
      comp: [{ l: "Attivo circolante (magazzino + liq. differite + liq. immediate)", v: r.attivoCircolante, s: "+" }, { l: "Passività correnti (operative + finanziarie a breve)", v: r.passCorrenti, s: "−" }],
      calc: `${fmt(r.attivoCircolante)} − ${fmt(r.passCorrenti)} = ${fmt(r.ccn)}`,
      sig: "È il cuscinetto di breve periodo: quanto resta dell'attivo che si trasforma in cassa entro 12 mesi dopo aver pagato tutti i debiti in scadenza nello stesso periodo. Positivo = gli impegni a breve si onorano con il normale ciclo di incassi; negativo = servirà rifinanziarsi o smobilizzare attività durevoli." },
    { nome: "Margine di tesoreria", formula: "(Liq. immediate + differite) − Pass. correnti", val: r.mt, giud: g.mt,
      desc: "Solvibilità a breve escluso il magazzino.",
      comp: [{ l: "Liquidità immediate (cassa e banche)", v: r.liq, s: "+" }, { l: "Liquidità differite (crediti e attività fin. a breve)", v: r.liqDifferite, s: "+" }, { l: "Passività correnti", v: r.passCorrenti, s: "−" }],
      calc: `${fmt(r.liq)} + ${fmt(r.liqDifferite)} − ${fmt(r.passCorrenti)} = ${fmt(r.mt)}`,
      sig: "Come il CCN, ma senza contare il magazzino, che è la posta più lenta e incerta da trasformare in denaro. Risponde alla domanda: se le scorte non si vendessero, l'azienda riuscirebbe comunque a pagare i debiti in scadenza? Se negativo, la solvibilità a breve dipende interamente dalla rotazione del magazzino." },
  ];

  const marginiFun = [
    { nome: "Fabbisogno finanziario lordo", formula: "Totale impieghi = Attivo fisso + Attivo circolante", val: r.totImpieghi, giud: ["info", "Dimensione complessiva del capitale da finanziare"], colVal: INK,
      desc: "Totale delle risorse investite in azienda, prima di qualsiasi copertura.",
      comp: [{ l: "Attivo fisso (immob. operative + accessorie)", v: r.attivoFisso, s: "+" }, { l: "Attivo circolante (magazzino, crediti, liquidità, attività fin.)", v: r.attivoCircolante, s: "+" }],
      calc: `${fmt(r.attivoFisso)} + ${fmt(r.attivoCircolante)} = ${fmt(r.totImpieghi)}`,
      sig: "È l'intero capitale investito nell'azienda: immobilizzazioni, magazzino, crediti, liquidità. Rappresenta il fabbisogno complessivo di risorse che deve in qualche modo essere finanziato, da qualsiasi fonte (soci, banche, fornitori). Indica la «taglia» finanziaria dell'impresa." },
    { nome: "Fabbisogno finanziario netto", formula: "Fabbisogno lordo − Passività operative (spontanee)", val: r.totImpieghiFun, giud: ["info", "Capitale da coprire con PN e debiti finanziari"], colVal: INK,
      desc: "Fabbisogno al netto delle fonti spontanee generate dal ciclo operativo.",
      comp: [{ l: "Fabbisogno finanziario lordo", v: r.totImpieghi, s: "+" }, { l: "Passività operative correnti (fornitori, imposte, ecc.)", v: r.passOpCorr, s: "−" }, { l: "Passività operative non correnti (TFR, fondi, ecc.)", v: r.passOpNC, s: "−" }],
      calc: `${fmt(r.totImpieghi)} − ${fmt(r.passOpCorr)} − ${fmt(r.passOpNC)} = ${fmt(r.totImpieghiFun)}`,
      sig: "Dal fabbisogno lordo si sottraggono le passività «spontanee» (fornitori, TFR, fondi), che nascono automaticamente dal ciclo operativo senza costo esplicito. Quello che resta è il capitale che l'azienda deve effettivamente reperire con fonti onerose: patrimonio netto e debiti finanziari. Per costruzione coincide con PN + debiti finanziari." },
    { nome: "Capitale circolante netto operativo (CCNO)", formula: "Attività operative correnti − Passività operative correnti", val: r.ccno, giud: g.ccno,
      desc: "Fabbisogno del ciclo operativo del core business.",
      comp: [{ l: "Rimanenze di magazzino", v: r.attOpMag, s: "+" }, { l: "Crediti commerciali e altre attività operative correnti", v: r.attOpCorr, s: "+" }, { l: "Passività operative correnti (fornitori, imposte, ratei…)", v: r.passOpCorr, s: "−" }],
      calc: `${fmt(r.attOpMag)} + ${fmt(r.attOpCorr)} − ${fmt(r.passOpCorr)} = ${fmt(r.ccno)}`,
      sig: "Misura i soldi «intrappolati» nel ciclo operativo quotidiano: crediti verso clienti e scorte, al netto del credito ottenuto da fornitori e altre passività operative. Se positivo, ogni euro di crescita del fatturato assorbe cassa (più clienti e più magazzino da finanziare); se negativo, il business si autofinanzia perché incassa prima di pagare (tipico della grande distribuzione)." },
    { nome: "Fabbisogno operativo strutturale netto (FOSN)", formula: "Immob. operative − Passività operative non correnti", val: r.fosn, giud: ["info", "Investimenti strutturali netti del core business"], colVal: INK,
      desc: "Componente durevole del fabbisogno della gestione caratteristica.",
      comp: [{ l: "Attivo operativo immobilizzato", v: r.immobOper, s: "+" }, { l: "Passività operative non correnti (TFR, fondi, debiti op. oltre 12 m.)", v: r.passOpNC, s: "−" }],
      calc: `${fmt(r.immobOper)} − ${fmt(r.passOpNC)} = ${fmt(r.fosn)}`,
      sig: "È la parte «pesante» e duratura del fabbisogno del core business: gli investimenti strutturali (impianti, immobili strumentali, immateriali) al netto delle passività operative a lungo termine che li finanziano spontaneamente (TFR, fondi). Rappresenta capitale bloccato per anni, che va coperto con fonti altrettanto durature." },
    { nome: "Capitale operativo investito netto (COIN)", formula: "CCNO + FOSN", val: r.cinOper, giud: ["info", "Capitale assorbito dalla gestione caratteristica"], colVal: INK,
      desc: "Risorse nette investite nel core business: base per il ROI operativo.",
      comp: [{ l: "Capitale circolante netto operativo (CCNO)", v: r.ccno, s: "+" }, { l: "Fabbisogno operativo strutturale netto (FOSN)", v: r.fosn, s: "+" }],
      calc: `${fmt(r.ccno)} + ${fmt(r.fosn)} = ${fmt(r.cinOper)}`,
      sig: "Somma il fabbisogno del ciclo operativo (CCNO) e quello strutturale (FOSN): è il totale delle risorse nette assorbite dalla gestione caratteristica. È la base per calcolare il ROI operativo (reddito operativo / COIN) e va confrontato con le fonti che lo coprono: patrimonio netto e debiti finanziari." },
    { nome: "Posizione finanziaria netta complessiva (PFN)", formula: "Debiti finanziari totali − Attività finanziarie totali", val: r.pfn, giud: g.pfn, colVal: r.pfn <= 0 ? GREEN : INK,
      desc: "Debito finanziario al netto delle disponibilità: grandezza chiave per la valutazione (EV − PFN = Equity).",
      comp: [{ l: "Debiti finanziari correnti (banche entro 12 m.)", v: r.debFinC, s: "+" }, { l: "Debiti finanziari non correnti (mutui, leasing oltre 12 m.)", v: r.debFinNC, s: "+" }, { l: "Liquidità immediate", v: r.liq, s: "−" }, { l: "Altre attività finanziarie (titoli, crediti fin.)", v: r.finAltre, s: "−" }],
      calc: `${fmt(r.debFinC)} + ${fmt(r.debFinNC)} − ${fmt(r.liq)} − ${fmt(r.finAltre)} = ${fmt(r.pfn)}`,
      sig: "Confronta tutti i debiti di natura finanziaria (banche, mutui, obbligazioni) con tutte le attività finanziarie (cassa, titoli, crediti finanziari). Se positiva è il debito «vero» che grava sull'azienda; se negativa l'azienda è in cassa netta. È la grandezza usata da banche e investitori (es. covenant PFN/EBITDA) e nella valutazione d'azienda: Equity = Enterprise Value − PFN." },
    { nome: "Posizione finanziaria netta a breve termine", formula: "Debiti finanziari correnti − Attività finanziarie", val: r.pfnBreve, giud: g.pfnBreve, colVal: r.pfnBreve <= 0 ? GREEN : "#8A6414",
      desc: "Esposizione finanziaria netta in scadenza entro 12 mesi.",
      comp: [{ l: "Debiti finanziari correnti (banche e finanziamenti entro 12 m.)", v: r.debFinC, s: "+" }, { l: "Liquidità immediate", v: r.liq, s: "−" }, { l: "Altre attività finanziarie a breve (titoli, crediti fin.)", v: r.finAltre, s: "−" }],
      calc: `${fmt(r.debFinC)} − ${fmt(r.liq)} − ${fmt(r.finAltre)} = ${fmt(r.pfnBreve)}`,
      sig: "Isola la parte di debito finanziario che scade entro 12 mesi e la confronta con le risorse finanziarie prontamente disponibili. Se positiva, l'azienda dovrà rimborsare o rinnovare debiti a breve senza avere liquidità sufficiente: segnale di pressione sulla tesoreria. Se negativa, la liquidità copre integralmente le scadenze finanziarie a breve." },
  ];

  const indici = [
    { sez: "Composizione", nome: "Rigidità degli impieghi", formula: "Attivo fisso / Tot. impieghi", val: pct(r.rigidita), giud: ["info", "Struttura " + (r.rigidita > 0.5 ? "rigida" : "elastica")],
      comp: [{ l: "Attivo fisso", v: r.attivoFisso }, { l: "Totale impieghi", v: r.totImpieghi }],
      calc: `${fmt(r.attivoFisso)} / ${fmt(r.totImpieghi)} = ${pct(r.rigidita)}`,
      sig: "Indica quanta parte del capitale è «bloccata» in investimenti durevoli. Una struttura rigida (>50%) rende l'azienda meno capace di adattarsi a cali di fatturato, perché gli investimenti fissi restano anche se le vendite scendono. Va letta rispetto al settore: un'industria manifatturiera è fisiologicamente più rigida di una società di servizi." },
    { sez: "Composizione", nome: "Elasticità degli impieghi", formula: "Attivo circolante / Tot. impieghi", val: pct(r.elasticita), giud: ["info", "Complementare alla rigidità"],
      comp: [{ l: "Attivo circolante", v: r.attivoCircolante }, { l: "Totale impieghi", v: r.totImpieghi }],
      calc: `${fmt(r.attivoCircolante)} / ${fmt(r.totImpieghi)} = ${pct(r.elasticita)}`,
      sig: "Quota di capitale investita in poste che tornano liquide entro l'anno. Più è alta, più l'azienda può ridimensionarsi rapidamente e liberare cassa in caso di necessità: è la faccia complementare della rigidità." },
    { sez: "Solidità", nome: "Autonomia finanziaria", formula: "PN / Tot. fonti", val: pct(r.autonomia), giud: g.autonomia,
      comp: [{ l: "Patrimonio netto", v: r.pn }, { l: "Totale fonti", v: r.totFonti }],
      calc: `${fmt(r.pn)} / ${fmt(r.totFonti)} = ${pct(r.autonomia)}`,
      sig: "Quota degli investimenti finanziata con mezzi propri. Sopra il 66% l'azienda è molto solida e ha ampio spazio per indebitarsi; sotto il 33% dipende fortemente da terzi: ogni tensione con le banche può diventare critica e gli oneri finanziari pesano sul conto economico." },
    { sez: "Solidità", nome: "Dipendenza finanziaria", formula: "Capitale di terzi / Tot. fonti", val: pct(r.dipendenza), giud: ["info", "Complementare all'autonomia"],
      comp: [{ l: "Capitale di terzi (pass. correnti + consolidate)", v: r.capitaleTerzi }, { l: "Totale fonti", v: r.totFonti }],
      calc: `${fmt(r.capitaleTerzi)} / ${fmt(r.totFonti)} = ${pct(r.dipendenza)}`,
      sig: "Quota finanziata da terzi (banche, fornitori, fondi). Un valore alto non è di per sé negativo se il debito è ben strutturato per scadenze e sostenibile con la redditività, ma aumenta il rischio finanziario e la vulnerabilità dell'azienda." },
    { sez: "Solidità", nome: "Leverage", formula: "Tot. impieghi / PN", val: r.leverage == null ? "n.d." : fmt2(r.leverage), giud: g.leverage,
      comp: [{ l: "Totale impieghi", v: r.totImpieghi }, { l: "Patrimonio netto", v: r.pn }],
      calc: r.leverage == null ? "PN nullo o negativo: non calcolabile" : `${fmt(r.totImpieghi)} / ${fmt(r.pn)} = ${fmt2(r.leverage)}`,
      sig: "Moltiplicatore del capitale proprio: quante volte gli investimenti superano il patrimonio netto. Un leverage pari a 2 significa che per ogni euro dei soci ce n'è uno di terzi. Amplifica la redditività quando il rendimento degli investimenti supera il costo del debito, ma amplifica allo stesso modo le perdite." },
    { sez: "Solidità", nome: "Copertura primaria immobilizzazioni", formula: "PN / Attivo fisso", val: r.copPrimaria == null ? "n.d." : fmt2(r.copPrimaria), giud: g.copPrimaria,
      comp: [{ l: "Patrimonio netto", v: r.pn }, { l: "Attivo fisso", v: r.attivoFisso }],
      calc: r.copPrimaria == null ? "Attivo fisso nullo: non calcolabile" : `${fmt(r.pn)} / ${fmt(r.attivoFisso)} = ${fmt2(r.copPrimaria)}`,
      sig: "Versione a indice del margine di struttura primario: se ≥ 1 il patrimonio netto copre da solo tutto l'attivo immobilizzato. Sotto 1 non è un allarme in sé: bisogna verificare che la parte scoperta sia finanziata da fonti a lungo termine (copertura secondaria)." },
    { sez: "Solidità", nome: "Copertura secondaria immobilizzazioni", formula: "(PN + Pass. consolidate) / Attivo fisso", val: r.copSecondaria == null ? "n.d." : fmt2(r.copSecondaria), giud: g.copSecondaria,
      comp: [{ l: "Patrimonio netto", v: r.pn }, { l: "Passività consolidate", v: r.passConsolidate }, { l: "Attivo fisso", v: r.attivoFisso }],
      calc: r.copSecondaria == null ? "Attivo fisso nullo: non calcolabile" : `(${fmt(r.pn)} + ${fmt(r.passConsolidate)}) / ${fmt(r.attivoFisso)} = ${fmt2(r.copSecondaria)}`,
      sig: "Versione a indice del margine di struttura secondario: deve essere ≥ 1, altrimenti parte degli investimenti durevoli è finanziata da debiti a breve, con rischio di crisi di liquidità a ogni rinnovo delle linee di credito." },
    { sez: "Liquidità", nome: "Indice di disponibilità (current ratio)", formula: "Attivo circolante / Pass. correnti", val: r.current == null ? "n.d." : fmt2(r.current), giud: g.current,
      comp: [{ l: "Attivo circolante", v: r.attivoCircolante }, { l: "Passività correnti", v: r.passCorrenti }],
      calc: r.current == null ? "Passività correnti nulle: non calcolabile" : `${fmt(r.attivoCircolante)} / ${fmt(r.passCorrenti)} = ${fmt2(r.current)}`,
      sig: "Per ogni euro di debiti in scadenza entro 12 mesi, quanti euro di attività si trasformeranno in cassa nello stesso periodo. Sotto 1 l'azienda non copre le scadenze con il circolante; il valore ottimale della prassi è ≥ 2, ma dipende molto dal settore e dalla velocità del ciclo incassi/pagamenti." },
    { sez: "Liquidità", nome: "Indice di liquidità (quick ratio)", formula: "(Liq. imm. + diff.) / Pass. correnti", val: r.quick == null ? "n.d." : fmt2(r.quick), giud: g.quick,
      comp: [{ l: "Liquidità immediate", v: r.liq }, { l: "Liquidità differite (crediti e att. fin. a breve)", v: r.liqDifferite }, { l: "Passività correnti", v: r.passCorrenti }],
      calc: r.quick == null ? "Passività correnti nulle: non calcolabile" : `(${fmt(r.liq)} + ${fmt(r.liqDifferite)}) / ${fmt(r.passCorrenti)} = ${fmt2(r.quick)}`,
      sig: "Come il current ratio ma escludendo il magazzino: misura la capacità di pagare i debiti a breve contando solo su cassa e crediti. È il test di liquidità più usato dagli analisti: ≥ 1 è considerato equilibrato, sotto 0,7 la liquidità è in tensione." },
    { sez: "Liquidità", nome: "Liquidità immediata", formula: "Liq. immediate / Pass. correnti", val: r.liqSecca == null ? "n.d." : fmt2(r.liqSecca), giud: ["info", "Riserva di cassa"],
      comp: [{ l: "Liquidità immediate (cassa e banche attive)", v: r.liq }, { l: "Passività correnti", v: r.passCorrenti }],
      calc: r.liqSecca == null ? "Passività correnti nulle: non calcolabile" : `${fmt(r.liq)} / ${fmt(r.passCorrenti)} = ${fmt2(r.liqSecca)}`,
      sig: "Quota dei debiti a breve pagabile immediatamente con la sola cassa, senza attendere incassi. Valori tipici tra 0,1 e 0,3: un valore molto alto può segnalare liquidità inutilizzata che potrebbe rendere di più se investita." },
  ];

  const indiciFun = [
    { nome: "Gearing (PFN / PN)", formula: "PFN / Patrimonio netto", val: r.gearing == null ? "n.d." : fmt2(r.gearing), giud: g.gearing,
      comp: [{ l: "Posizione finanziaria netta", v: r.pfn }, { l: "Patrimonio netto", v: r.pn }],
      calc: r.gearing == null ? "PN nullo o negativo: non calcolabile" : `${fmt(r.pfn)} / ${fmt(r.pn)} = ${fmt2(r.gearing)}`,
      sig: "Rapporto tra debito finanziario netto e mezzi propri: misura chi sta davvero finanziando l'azienda. ≤ 1 è equilibrato (i soci mettono almeno quanto le banche); > 2 indica una struttura sbilanciata sul debito, vulnerabile a rialzi dei tassi e a cali di redditività. Valori ≤ 0 indicano cassa netta." },
    { nome: "PFN / Capitale investito", formula: "PFN / CIN complessivo", val: r.pfnSuCin == null ? "n.d." : pct(r.pfnSuCin), giud: ["info", "Quota del capitale investito finanziata da debito"],
      comp: [{ l: "Posizione finanziaria netta", v: r.pfn }, { l: "CIN complessivo (COIN + accessori)", v: r.cinTot }],
      calc: r.pfnSuCin == null ? "CIN nullo: non calcolabile" : `${fmt(r.pfn)} / ${fmt(r.cinTot)} = ${pct(r.pfnSuCin)}`,
      sig: "Quota del capitale investito nella gestione finanziata da debito oneroso anziché da patrimonio. Più è alta, più il rendimento operativo deve superare il costo del debito perché resti valore per i soci: è il complemento del ragionamento sulla leva finanziaria." },
    { nome: "Incidenza gestione accessoria", formula: "Impieghi accessori / CIN complessivo", val: r.incidenzaAccessoria == null ? "n.d." : pct(r.incidenzaAccessoria), giud: r.incidenzaAccessoria != null && r.incidenzaAccessoria > 0.25 ? ["warn", "Peso rilevante di attività estranee al core"] : ["info", "Peso delle attività extra-caratteristiche"],
      comp: [{ l: "Impieghi accessori (immobili civili, partecipazioni non strategiche…)", v: r.accessori }, { l: "CIN complessivo", v: r.cinTot }],
      calc: r.incidenzaAccessoria == null ? "CIN nullo: non calcolabile" : `${fmt(r.accessori)} / ${fmt(r.cinTot)} = ${pct(r.incidenzaAccessoria)}`,
      sig: "Peso degli investimenti estranei al core business (immobili civili, partecipazioni non strategiche, investimenti patrimoniali). Se rilevante (> 25%), parte del capitale non lavora per il business principale: può essere una riserva di valore, ma anche un impiego inefficiente da valutare per un'eventuale dismissione a favore del core o della riduzione del debito." },
    { nome: "Peso del circolante operativo", formula: "CCNO / CIN complessivo", val: r.pesoCcno == null ? "n.d." : pct(r.pesoCcno), giud: ["info", "Intensità di capitale circolante del business"],
      comp: [{ l: "Capitale circolante netto operativo (CCNO)", v: r.ccno }, { l: "CIN complessivo", v: r.cinTot }],
      calc: r.pesoCcno == null ? "CIN nullo: non calcolabile" : `${fmt(r.ccno)} / ${fmt(r.cinTot)} = ${pct(r.pesoCcno)}`,
      sig: "Quanto del capitale investito è assorbito dal ciclo commerciale (clienti + scorte − fornitori). Un peso alto rende il fabbisogno finanziario molto sensibile alla crescita del fatturato e alla puntualità degli incassi: crescere costa cassa e i ritardi dei clienti si sentono subito sulla tesoreria." },
  ];

  async function generaValutazioneNi() {
    setNiEval((s) => ({ ...s, loading: true, error: null }));
    try {
      const estrattiTxt = (niFiltro?.estratti || [])
        .filter((x) => x.incluso)
        .map((x) => `[${x.pagina != null ? `p. ${x.pagina} — ` : ""}${x.tema}] ${x.contenuto}`)
        .join("\n");
      const ossTxt = niOss.map((o) => `- ${o}`).join("\n");
      const quadro = [
        ...marginiFun.map((m) => `${m.nome}: ${typeof m.val === "number" ? fmt(m.val) : m.val} (${m.giud[1]})`),
        ...margini.map((m) => `${m.nome}: ${typeof m.val === "number" ? fmt(m.val) : m.val} (${m.giud[1]})`),
        ...indici.map((i) => `${i.nome}: ${i.val} (${i.giud[1]})`),
        ...indiciFun.map((i) => `${i.nome}: ${i.val} (${i.giud[1]})`),
      ].join("\n");
      const prompt = NI_EVAL_PROMPT
        .replace("{{ESTRATTI}}", estrattiTxt || "(nessun estratto disponibile)")
        .replace("{{OSSERVAZIONI}}", ossTxt || "(nessuna)")
        .replace("{{QUADRO}}", quadro);
      const parsed = await callAI([{ type: "text", text: prompt }]);
      const valutazioni = (Array.isArray(parsed.valutazioni) ? parsed.valutazioni : [])
        .filter((v) => v && typeof v.spiegazione === "string" && v.spiegazione.trim())
        .slice(0, 8)
        .map((v) => ({
          tema: String(v.tema || "Valutazione").trim(),
          livello: ["ok", "warn", "bad", "info"].includes(v.livello) ? v.livello : "info",
          spiegazione: v.spiegazione.trim(),
          indici: typeof v.indici_collegati === "string" ? v.indici_collegati.trim() : "",
        }));
      const sintesi = typeof parsed.sintesi === "string" ? parsed.sintesi.trim() : "";
      if (valutazioni.length === 0 && !sintesi)
        throw new Error("L'IA non ha prodotto una valutazione leggibile: riprova");
      setNiEval({ loading: false, error: null, data: { sintesi, valutazioni } });
    } catch (err) {
      setNiEval((s) => ({ ...s, loading: false, error: err.message || "Errore durante la valutazione" }));
    }
  }

  const detDurate = d.ready ? [
    { nome: "Giorni clienti (durata dilazione crediti)", formula: "(Crediti commerciali / Fatturato) × 360", val: `${fmt1(d.ggClienti)} gg`, colVal: INK,
      giud: ["info", "Tempo medio tra vendita e incasso"],
      desc: "Denaro bloccato in fatture in attesa di riscossione.",
      comp: [{ l: "Crediti commerciali", v: d.cred }, { l: "Fatturato", v: d.fat }],
      calc: `(${fmt(d.cred)} / ${fmt(d.fat)}) × 360 = ${fmt1(d.ggClienti)} giorni`,
      sig: "Esprime quanti giorni in media passano tra la vendita e l'incasso effettivo: prodotti già venduti per cui i costi sono stati sostenuti, ma il corrispettivo non è ancora entrato in cassa. Per ridurlo non si «taglia il CCNO», ma si agisce sui driver: stringere le politiche di dilazione (es. da 60 a 30 giorni) o migliorare l'efficienza del recupero crediti." },
    { nome: "Giorni scorte (durata giacenza magazzino)", formula: "(Rimanenze / Consumi) × 360", val: `${fmt1(d.ggScorte)} gg`, colVal: INK,
      giud: ["info", "Tempo medio di permanenza in magazzino"],
      desc: "Costi già sostenuti ma non ancora recuperati con la vendita.",
      comp: [{ l: "Rimanenze di magazzino", v: d.scor }, { l: "Consumi / costo del venduto", v: d.cons }],
      calc: `(${fmt(d.scor)} / ${fmt(d.cons)}) × 360 = ${fmt1(d.ggScorte)} giorni`,
      sig: "Quanti giorni le scorte restano ferme in magazzino prima della vendita: sono soldi bloccati fisicamente in materie, semilavorati e prodotti. I driver su cui agire: efficienza della produzione (ridurre i tempi tecnici), approvvigionamenti just-in-time, maggiore rotazione. Attenzione: la fotografia di fine anno può essere distorta dalla stagionalità e mascherare picchi di fabbisogno infra-annuali." },
    { nome: "Giorni fornitori (durata dilazione debiti)", formula: "(Debiti verso fornitori / Acquisti) × 360", val: `${fmt1(d.ggFornitori)} gg`, colVal: INK,
      giud: ["info", "Dilazione media ottenuta dai fornitori"],
      desc: "Cassa «risparmiata» che finanzia gratuitamente parte del ciclo.",
      comp: [{ l: "Debiti verso fornitori", v: d.forn }, { l: "Acquisti (materie e servizi)", v: d.acq }],
      calc: `(${fmt(d.forn)} / ${fmt(d.acq)}) × 360 = ${fmt1(d.ggFornitori)} giorni`,
      sig: "Quanti giorni in media l'azienda impiega a pagare i fornitori: ogni giorno di dilazione è un finanziamento spontaneo e gratuito del ciclo operativo. Si allunga sfruttando il potere contrattuale (come fa la GDO, che paga a 90–120 giorni), ma valori anomali rispetto al settore possono anche segnalare difficoltà nei pagamenti." },
  ] : [];

  const detCiclo = d.ready ? [
    { nome: "Ciclo monetario semplice (non ponderato)", formula: "Gg clienti + Gg scorte − Gg fornitori", val: `${fmt1(d.cicloMonetario)} gg`, colVal: INK,
      giud: ["warn", "Ingannevole: somma giorni non omogenei"],
      desc: "La somma «grezza» delle durate, da leggere con cautela.",
      comp: [{ l: "Giorni clienti", v: d.ggClienti, s: "+" }, { l: "Giorni scorte", v: d.ggScorte, s: "+" }, { l: "Giorni fornitori", v: d.ggFornitori, s: "−" }],
      calc: `${fmt1(d.ggClienti)} + ${fmt1(d.ggScorte)} − ${fmt1(d.ggFornitori)} = ${fmt1(d.cicloMonetario)} giorni`,
      sig: "È il calcolo intuitivo ma insidioso: un giorno non vale l'altro. I fornitori fanno credito solo sui costi di acquisto, mentre il fatturato include anche stipendi, ammortamenti e margine di profitto. Quindi un giorno di dilazione dal fornitore «pesa» monetariamente meno di un giorno di credito al cliente. Questo indice può mostrare un ciclo perfettamente coperto (anche zero giorni) quando in realtà esiste un fabbisogno monetario positivo: è il paradosso della ponderazione." },
    { nome: "Ciclo monetario ponderato", formula: "Gg clienti + Gg scorte × (Consumi/Fatt.) − Gg fornitori × (Acquisti/Fatt.)", val: `${fmt1(d.cicloPond)} gg`, colVal: d.cicloPond <= 0 ? GREEN : INK,
      giud: d.cicloPond <= 0 ? ["ok", "Ciclo autofinanziato: il circolante genera cassa"] : ["info", `${fmt1(d.cicloPond)} giorni realmente «scoperti» da finanziare`],
      desc: "Le durate uniformate alla base comune del fatturato: la misura corretta.",
      comp: [{ l: "Giorni clienti (già su base fatturato)", v: d.ggClienti, s: "+" }, { l: `Giorni scorte ponderati (${fmt1(d.ggScorte)} × ${pct(d.cons / d.fat)})`, v: d.ggScortePond, s: "+" }, { l: `Giorni fornitori ponderati (${fmt1(d.ggFornitori)} × ${pct(d.acq / d.fat)})`, v: d.ggFornPond, s: "−" }],
      calc: `${fmt1(d.ggClienti)} + ${fmt1(d.ggScortePond)} − ${fmt1(d.ggFornPond)} = ${fmt1(d.cicloPond)} giorni`,
      sig: "Risolve il paradosso: i giorni scorte si moltiplicano per il peso dei consumi sul fatturato, i giorni fornitori per il peso degli acquisti sul fatturato; i giorni clienti restano invariati perché già rapportati ai ricavi. Il risultato è il numero di giorni realmente scoperti: moltiplicato per il fatturato giornaliero (Fatturato / 360) restituisce esattamente il CCNc contabile in euro." },
  ] : [];

  const detAliquota = d.ready ? { nome: "Aliquota di circolante", formula: "CCNc / Fatturato", val: d.aliquota == null ? "n.d." : pct(d.aliquota), colVal: INK,
    giud: ["info", "Fabbisogno di circolante per ogni euro di fatturato"],
    desc: "Lo strumento predittivo del fabbisogno legato alla crescita.",
    comp: [{ l: "CCNc (crediti + scorte − fornitori)", v: d.ccnc }, { l: "Fatturato", v: d.fat }],
    calc: `${fmt(d.ccnc)} / ${fmt(d.fat)} = ${pct(d.aliquota)}`,
    sig: "Esprime quanti centesimi di CCNc servono per sostenere ogni euro di fatturato aggiuntivo. Attenzione analitica: perché abbia valenza predittiva, il CCNc al numeratore va «normalizzato», cioè depurato dalle anomalie momentanee che non si ripeteranno — crediti inesigibili non ancora stralciati e scorte gonfiate da acquisti speculativi una tantum — altrimenti le proiezioni del fabbisogno futuro risulteranno distorte." } : null;

  const detSost = d.ready ? { nome: "Sostenibilità dei debiti finanziari a breve", formula: "Debiti finanziari a breve / CCNc fluttuante", val: d.sostenibilita == null ? "n.d." : fmt2(d.sostenibilita),
    giud: d.sostenibilita == null ? ["info", "CCNc fluttuante nullo o negativo: indice non calcolabile"] : d.sostenibilita < 1 ? ["ok", "< 1: debito a breve sano e autoliquidante"] : ["bad", "> 1: irrigidimento finanziario, il breve termine finanzia fabbisogno durevole"],
    desc: "Verifica che il debito bancario a breve copra solo i picchi transitori.",
    comp: [{ l: "Debiti finanziari a breve (dallo Stato Patrimoniale)", v: r.debFinC }, { l: `CCNc fluttuante (${fmt(100 - d.durPct)}% del CCNc)`, v: d.fluttuante }],
    calc: d.sostenibilita == null ? "CCNc fluttuante ≤ 0: non calcolabile" : `${fmt(r.debFinC)} / ${fmt(d.fluttuante)} = ${fmt2(d.sostenibilita)}`,
    sig: "Applica la regola aurea della solvibilità al circolante. Sotto 1, i debiti bancari a breve coprono soltanto i picchi fisiologici e transitori: il debito è autoliquidante, si estingue da solo alla chiusura del ciclo monetario di scorte e crediti stagionali. Sopra 1 è un segnale d'allarme critico: l'azienda usa scoperti e linee a revoca per finanziare la componente durevole del circolante (o peggio, le immobilizzazioni), esponendosi a crisi di liquidità immediate in caso di restrizione del credito (credit crunch). Un circolante lento a ruotare, inoltre, gonfia gli oneri finanziari fino a erodere l'utile." } : null;

  const giudiziValutabili = [
    ...margini.map((m) => m.giud), ...marginiFun.map((m) => m.giud),
    ...indici.map((i) => i.giud), ...indiciFun.map((i) => i.giud),
  ].filter((x) => x[0] !== "info");
  const conta = (lev) => giudiziValutabili.filter((x) => x[0] === lev).length;

  const barSeg = (val, tot, color, label) => {
    const h = tot > 0 ? Math.max((val / tot) * 100, 0) : 0;
    if (h <= 0.2) return null;
    return (
      <div key={label} className="w-full flex items-center justify-center overflow-hidden"
        style={{ height: `${h}%`, background: color, transition: "height .4s" }} title={`${label}: ${fmt(val)}`}>
        {h > 9 && <span className="text-[10px] font-semibold text-white text-center leading-tight px-1">{label} · {pct(val / tot)}</span>}
      </div>
    );
  };

  const tabs = [
    { id: "dati", label: "1 · Dati & Validazione" },
    { id: "nota", label: "2 · Nota Integrativa" },
    { id: "rg", label: "3 · Relazione sulla Gestione" },
    { id: "sp", label: "4 · SP riclassificato" },
    { id: "margini", label: "5 · Margini & Indici" },
    { id: "ccno", label: "6 · Determinanti CCNO" },
    { id: "asa", label: "7 · Segment Reporting (ASA)" },
    { id: "datiPrec", label: `8 · Dati & NI ${annoPrec}` },
    { id: "spPrec", label: `9 · SP riclassificato ${annoPrec}` },
    { id: "delta", label: `10 · Indici ${annoPrec} & Δ (Rendiconto)` },
    { id: "audit", label: "11 · Audit & Auto-Fix" },
  ];

  const selectStyle = { borderColor: LINE, background: "#FDFDFB", fontFamily: "'IBM Plex Sans', sans-serif" };

  // Tabella di validazione riutilizzabile: con prec=true opera su vociPrec
  // (esercizio precedente) con gli editor dedicati.
  const VociTable = ({ sezione, tone, prec = false }) => {
    const source = prec ? vociPrec : voci;
    const upd = prec ? updVocePrec : updVoce;
    const del = prec ? delVocePrec : delVoce;
    const add = prec ? addVocePrec : addVoce;
    const list = source.filter((v) => v.sezione === sezione);
    const classiOk = sezione === "attivo" ? CLASSI_ATTIVO : CLASSI_PASSIVO;
    const tot = list.reduce((a, v) => a + parse(v.importo), 0);
    return (
      <SectionCard title={`${sezione === "attivo" ? "Attivo" : "Passivo"}${prec ? ` ${annoPrec}` : ""} — voci del bilancio (${list.length})`} tone={tone}>
        <div className="space-y-1.5 py-1">
          {list.map((v) => (
            <div key={v.id} className="rounded border p-2 space-y-1.5"
              style={{ borderColor: v.classe === "da_classificare" ? AMBER : LINE, background: v.classe === "da_classificare" ? "#FDF8EC" : "#FDFDFB" }}>
              <div className="flex gap-2 items-center">
                <input type="text" value={v.nome} placeholder="Denominazione voce"
                  onChange={(e) => upd(v.id, "nome", e.target.value)}
                  className="flex-1 text-sm px-2 py-1 rounded border outline-none min-w-0"
                  style={{ borderColor: LINE, background: "#fff" }} />
                <input type="text" inputMode="decimal" value={v.importo} placeholder="0"
                  onChange={(e) => upd(v.id, "importo", e.target.value)}
                  className="w-28 flex-shrink-0 text-right text-sm px-2 py-1 rounded border outline-none"
                  style={{ borderColor: LINE, background: "#fff", fontFamily: "'IBM Plex Mono', monospace" }} />
                <button onClick={() => del(v.id)} title="Elimina voce"
                  className="flex-shrink-0 w-7 h-7 rounded text-sm font-bold" style={{ background: "#F6E5E3", color: RED }}>×</button>
              </div>
              <select value={v.classe} onChange={(e) => upd(v.id, "classe", e.target.value)}
                className="w-full text-xs px-2 py-1 rounded border outline-none" style={selectStyle}>
                <option value="da_classificare">{CLASSI.da_classificare.label}</option>
                {classiOk.map((k) => (
                  <option key={k} value={k}>{CLASSI[k].area} · {CLASSI[k].label}</option>
                ))}
              </select>
            </div>
          ))}
          {list.length === 0 && <div className="text-xs opacity-40 py-2 text-center">Nessuna voce: carica un bilancio o aggiungi manualmente.</div>}
        </div>
        <div className="flex items-center justify-between pt-2 pb-1" style={{ borderTop: `2px solid ${INK}` }}>
          <button onClick={() => add(sezione)} className="px-3 py-1 text-xs rounded font-semibold border"
            style={{ borderColor: INK, color: INK }}>+ Aggiungi voce</button>
          <span className="text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            Totale: {fmt(tot)}
          </span>
        </div>
      </SectionCard>
    );
  };

  return (
    <div style={{ background: PAPER, minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: INK }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@600;800&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;600&display=swap');
        input::placeholder { color: #B7BCB3; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <header className="px-6 pt-8 pb-0 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 pb-4" style={{ borderColor: INK }}>
          <div>
            <div className="text-xs tracking-[0.2em] uppercase mb-1"
              style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif", fontWeight: 800 }}>
              Analisi di bilancio · schema dinamico
            </div>
            <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "'Libre Franklin', sans-serif", fontWeight: 800 }}>
              Riclassificazione dello Stato Patrimoniale
            </h1>
            <p className="text-sm mt-1 opacity-70">
              Fase 1: riconoscimento schema (OIC · IAS/IFRS · US GAAP) · Fase 2: estrazione adattata · validazione modificabile
              {schemaInfo ? ` · ${systemPrompts.SCHEMI[schemaInfo.schema]?.label || schemaInfo.schema}` : ""}
              {esercizio ? ` · esercizio ${esercizio}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* ── Toggle MODALITÀ SINGOLO ANNO ─────────────────────────────
                Se attivo, l'IA estrae SOLO l'anno indicato (sezioni T) e la
                seconda passata automatica per il T-1 viene bloccata. */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border w-full sm:w-auto"
              style={{ borderColor: modalitaSingoloAnno ? AMBER : LINE, background: modalitaSingoloAnno ? "#FFF8EC" : CARD }}>
              <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none" style={{ color: INK }}>
                <input type="checkbox" checked={modalitaSingoloAnno}
                  onChange={(e) => setModalitaSingoloAnno(e.target.checked)}
                  style={{ accentColor: AMBER }} />
                🎯 Modalità singolo anno
              </label>
              {modalitaSingoloAnno && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold">
                    Anno T
                    <input type="text" inputMode="numeric" placeholder="es. 2023" value={annoSpecifico}
                      onChange={(e) => setAnnoSpecifico(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                      className="w-20 px-2 py-1 text-sm rounded border"
                      style={{ borderColor: AMBER, fontFamily: "'IBM Plex Mono', monospace" }} />
                  </label>
                  {/* Secondo anno: i documenti caricati negli slot T-1 sono
                      bilanci AUTONOMI di un altro esercizio, non colonne
                      comparative, e vanno letti sulla loro colonna principale. */}
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold">
                    Anno documenti T-1
                    <input type="text" inputMode="numeric" placeholder="es. 2022" value={annoSpecificoPrec}
                      onChange={(e) => setAnnoSpecificoPrec(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                      className="w-20 px-2 py-1 text-sm rounded border"
                      style={{ borderColor: AMBER, fontFamily: "'IBM Plex Mono', monospace" }} />
                  </label>
                  <span className="text-[10px] leading-tight opacity-70 w-full">
                    L'IA estrarrà <b>solo</b> i dati dell'anno T nelle sezioni dell'anno corrente e
                    l'estrazione automatica della colonna comparativa è bloccata. I caricamenti T-1
                    (sezione 8) restano disponibili: carica il bilancio autonomo di un altro esercizio
                    per costruire a mano la serie storica — l'IA leggerà la <b>colonna principale</b> di
                    quel documento, non la sua comparativa.
                  </span>
                  {!annoSingoloValido && (
                    <span className="text-[10px] leading-tight w-full font-semibold" style={{ color: RED }}>
                      ⚠ Indica un anno di 4 cifre: finché manca, i prompt restano ancorati all'esercizio
                      di default ({ANNO_RIF_DEFAULT}).
                    </span>
                  )}
                </>
              )}
            </div>
            {/* ── CONFIGURAZIONE IA (provider + chiavi API) ── */}
            <div className="w-full rounded-lg border p-4 space-y-3" style={{ borderColor: LINE, background: CARD }}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest opacity-60" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                  🔑 Configurazione IA
                </span>
                <div className="flex rounded-lg border overflow-hidden text-sm" style={{ borderColor: LINE }}>
                  {[["claude", "Claude"], ["openai", "OpenAI"], ["gemini", "Google Gemini"]].map(([id, nome]) => (
                    <button key={id} onClick={() => setProvider(id)}
                      className="px-3 py-1.5 font-semibold"
                      style={{ background: provider === id ? BLUE : "#F5F5F2", color: provider === id ? "#fff" : INK, opacity: provider === id ? 1 : 0.55 }}>
                      {nome}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] opacity-60 leading-relaxed">
                {provider === "openai"
                  ? <>📄 Con <b>OpenAI</b> il PDF viene convertito in immagini <b>nel browser</b> (pdf.js) prima dell'invio: funzionano anche le scansioni e i file creati con «Stampa su PDF», privi di testo selezionabile. La conversione richiede qualche secondo e consuma più token rispetto a <b>Claude</b> e <b>Gemini</b>, che ricevono il PDF nel formato nativo. I documenti lunghi vengono suddivisi automaticamente in porzioni da {NI_CHUNK_PAGES} pagine.</>
                  : <>📄 Il PDF viene inviato nel formato nativo e letto <b>pagina per pagina</b>: funzionano anche le scansioni e i file creati con «Stampa su PDF», privi di testo selezionabile. I documenti lunghi vengono suddivisi automaticamente in porzioni da {NI_CHUNK_PAGES} pagine.</>}
              </p>
              <div className="flex flex-wrap gap-3 items-center">
                {/* ── CAMPO CHIAVE API ── */}
                <div className="flex-1 min-w-[280px] flex items-center gap-2 rounded-lg border px-2 py-1.5"
                  style={
                    fonteChiave === "utente"
                      ? { borderColor: GREEN, background: "#E4F1EA" }
                      : { borderColor: LINE, background: CARD }
                  }>
                  <span className="text-sm" style={{ color: fonteChiave === "utente" ? GREEN : INK, opacity: fonteChiave === "utente" ? 1 : 0.5 }}>
                    {fonteChiave === "utente" ? "✓" : "🔑"}
                  </span>
                  <input
                    type={mostraChiave ? "text" : "password"}
                    value={chiaviUtente[provider] || ""}
                    onChange={(e) => setChiave(provider, e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    name={`api-key-${provider}`}
                    placeholder={
                      provider === "openai" ? "Incolla qui la chiave OpenAI (sk-…)"
                        : provider === "gemini" ? "Incolla qui la chiave Google AI Studio (AIza…)"
                          : "Incolla qui la chiave Anthropic (sk-ant-…)"
                    }
                    aria-label={`Chiave API ${provider === "openai" ? "OpenAI" : provider === "gemini" ? "Google Gemini" : "Claude"}`}
                    className="flex-1 min-w-0 bg-transparent text-sm px-1 py-1 outline-none"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: INK }}
                  />
                  <button onClick={() => setMostraChiave((v) => !v)}
                    className="px-1.5 py-0.5 text-xs rounded shrink-0"
                    style={{ opacity: 0.6 }}
                    title={mostraChiave ? "Nascondi la chiave" : "Mostra la chiave"}>
                    {mostraChiave ? "🙈" : "👁"}
                  </button>
                  {chiaveCorrente && (
                    <button onClick={() => cancellaChiave(provider)}
                      className="px-1.5 py-0.5 text-xs rounded shrink-0"
                      style={{ opacity: 0.6 }}
                      title="Cancella la chiave di questo provider">
                      ✕
                    </button>
                  )}
                </div>
                {provider === "claude" ? (
                  <select value={modello.claude} onChange={(e) => setModello((m) => ({ ...m, claude: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm w-56" style={{ borderColor: LINE, background: CARD }} aria-label="Modello Claude">
                    <optgroup label="Sonnet — bilancio qualità/costo">
                      <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (consigliato)</option>
                      <option value="claude-sonnet-5">Claude Sonnet 5</option>
                    </optgroup>
                    <optgroup label="Opus — massima qualità">
                      <option value="claude-opus-5">Claude Opus 5</option>
                      <option value="claude-opus-4-6">Claude Opus 4.6</option>
                    </optgroup>
                    <optgroup label="Haiku — veloce ed economico">
                      <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                    </optgroup>
                  </select>
                ) : (
                  <input value={modello[provider]} onChange={(e) => setModello((m) => ({ ...m, [provider]: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm w-44" style={{ borderColor: LINE, background: CARD }} aria-label="Modello" />
                )}
              </div>
              {/* ── MEMORIZZAZIONE NEL BROWSER ── */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: INK, opacity: 0.75 }}>
                  <input type="checkbox" checked={ricordaChiavi} onChange={(e) => toggleRicorda(e.target.checked)} />
                  Ricorda le chiavi in questo browser
                </label>
                {ricordaChiavi && (
                  <span className="text-[10px] opacity-50">
                    Salvate in <code>localStorage</code> (<code>{SP_KEYS_KEY}</code>) — usa la casella per rimuoverle.
                  </span>
                )}
                {avvisoFormaChiave && (
                  <span className="text-[11px] font-semibold" style={{ color: AMBER }}>⚠ {avvisoFormaChiave}</span>
                )}
              </div>

              <p className="text-sm font-semibold" style={{ color: iaAttiva ? GREEN : INK, opacity: iaAttiva ? 1 : 0.45 }}>
                {statoServer === "verifica"
                  ? "Verifica del servizio in corso…"
                  : statoServer === "offline"
                  ? "⚠ Servizio /api/chat non raggiungibile: in locale avvia «npm run dev» (oppure «npm run build && npm start»)"
                  : fonteChiave === "utente"
                  ? `Chiave inserita (${chiaveMascherata(chiaveCorrente)}): funzionalità IA attive`
                  : fonteChiave === "server"
                  ? "Nessuna chiave digitata: verrà usata quella configurata sull'hosting — funzionalità IA attive"
                  : "Inserisci la chiave API qui sopra per attivare le funzionalità IA"}
              </p>
              <p className="text-[11px] opacity-50 leading-relaxed">
                La chiave resta <b>nel tuo browser</b> e viene trasmessa al proxy <code>/api/chat</code> solo al
                momento della singola chiamata: il server la inoltra al provider e la dimentica, non la scrive
                su disco né nei log, e non finisce nel JSON di salvataggio del lavoro. In alternativa puoi
                lasciare il campo vuoto e configurare sull'hosting le variabili d'ambiente
                <code> ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>GEMINI_API_KEY</code>: se
                presenti, vengono usate come ripiego. Ogni provider ha il proprio campo, che cambia insieme al
                pulsante selezionato qui sopra. Tutte le funzioni IA (SP, Nota Integrativa, Relazione sulla
                Gestione, esercizio precedente e allocazione ASA) usano il provider e il modello scelti qui.
              </p>
            </div>
            <input ref={masterFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleMasterFile} className="hidden" />
            <input ref={spFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleSpFile} className="hidden" />
            <input ref={niFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleNiFile} className="hidden" />
            <input ref={rgFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleRgFile} className="hidden" />
            <input ref={spPrecFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleSpFilePrec} className="hidden" />
            <input ref={niPrecFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleNiFilePrec} className="hidden" />
            <input ref={rgPrecFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.htm,.html" onChange={handleRgFilePrec} className="hidden" />
            <input ref={jsonFileRef} type="file" accept=".json,application/json" onChange={handleJsonFile} className="hidden" />
            <button onClick={() => masterFileRef.current?.click()} disabled={ai.master.loading || !iaAttiva}
              className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
              style={{ background: "#0f172a", color: "#fff", opacity: ai.master.loading || !iaAttiva ? 0.6 : 1 }}>
              {ai.master.loading ? <><Spinner/> Analisi Completa 10-K/20-F in corso…</> : <>📖 Carica Bilancio Completo (Unico File)</>}
            </button>
            <button onClick={() => spFileRef.current?.click()} disabled={ai.sp.loading || !iaAttiva}
              className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
              style={{ background: GREEN, color: "#fff", opacity: ai.sp.loading || !iaAttiva ? 0.6 : 1 }}>
              {ai.sp.loading ? <><Spinner /> Estrazione SP…</> : <>📄 Carica Stato Patrimoniale (IA)</>}
            </button>
            <button onClick={() => niFileRef.current?.click()} disabled={ai.ni.loading || !hasData || !iaAttiva}
              title={!hasData ? "Prima estrai lo Stato Patrimoniale" : ""}
              className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
              style={{ background: BLUE, color: "#fff", opacity: ai.ni.loading || !hasData || !iaAttiva ? 0.6 : 1 }}>
              {ai.ni.loading ? <><Spinner /> Lettura NI…</> : <>📑 Carica Nota Integrativa (IA)</>}
            </button>
            <button onClick={() => rgFileRef.current?.click()} disabled={ai.rg.loading || !hasData || !iaAttiva}
              title={!hasData ? "Prima estrai lo Stato Patrimoniale" : ""}
              className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
              style={{ background: PURPLE, color: "#fff", opacity: ai.rg.loading || !hasData || !iaAttiva ? 0.6 : 1 }}>
              {ai.rg.loading ? <><Spinner /> Lettura RG…</> : <>📎 Carica Relazione Gestione (IA)</>}
            </button>
            <button onClick={() => { setVoci(ESEMPIO_VOCI.map((v) => ({ ...v, id: newId() }))); setEsercizio("31/12/2025"); setSchemaInfo({ schema: "oic", paese: "Italia", valuta: "EUR", unita: "unità", indizi: "Dati d'esempio in schema civilistico italiano", note_contabili: ["TFR classificato tra le passività operative non correnti", "Ratei e risconti esposti in voci separate", "Leasing non capitalizzato (canoni fuori bilancio, a differenza di IFRS 16)"] }); setNiOss(["Esempio: mutuo ipotecario garantito da immobile strumentale, residuo € 460.000.", "Esempio: immobile civile non strumentale iscritto tra le immobilizzazioni per € 110.000."]); setNiFiltro(null); setNiImpatto(null); setRgFiltro(null); setRgOss([]); setRgImpatto(null); setRgFiltroPrec(null); setRgOssPrec([]); setRgImpattoPrec(null); setValidato(false); }}
              className="px-3 py-1.5 text-sm rounded font-semibold" style={{ background: INK, color: "#fff" }}>
              Carica esempio
            </button>
            <button onClick={salvaDati} disabled={!hasData && !hasDataPrec}
              title={!hasData && !hasDataPrec ? "Carica prima almeno un bilancio" : "Salva l'intero stato del lavoro (voci, NI, RG, ASA) + i Δ patrimoniali per il Rendiconto Finanziario"}
              className="px-3 py-1.5 text-sm rounded font-semibold border"
              style={{ borderColor: GREEN, color: GREEN, opacity: !hasData && !hasDataPrec ? 0.5 : 1 }}>
              💾 Salva dati (JSON)
            </button>
            <button onClick={() => jsonFileRef.current?.click()}
              title="Ripristina un salvataggio JSON esportato in precedenza da questa applicazione"
              className="px-3 py-1.5 text-sm rounded font-semibold border"
              style={{ borderColor: BLUE, color: BLUE }}>
              📂 Carica dati salvati
            </button>
            <button onClick={() => { setVoci([]); setEsercizio(""); setSchemaInfo(null); setNiOss([]); setNiFiltro(null); setNiImpatto(null); setNiEval({ loading: false, error: null, data: null }); setRgFiltro(null); setRgOss([]); setRgImpatto(null); setValidato(false); setVociPrec([]); setEsercizioPrec(""); setNiFiltroPrec(null); setNiOssPrec([]); setNiImpattoPrec(null); setImportEsito(null); setAi({ master: { loading: false, error: null, ok: null }, sp: { loading: false, error: null, ok: null }, ni: { loading: false, error: null, ok: null }, rg: { loading: false, error: null, ok: null }, spPrec: { loading: false, error: null, ok: null }, niPrec: { loading: false, error: null, ok: null } }); }}
              className="px-3 py-1.5 text-sm rounded font-semibold border" style={{ borderColor: INK, color: INK }}>
              Azzera
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border p-3 flex flex-wrap items-center gap-3"
          style={{ borderColor: LINE, background: CARD }}>
          <span className="text-xl">✅</span>
          <div className="text-xs font-semibold uppercase tracking-widest flex-shrink-0"
            style={{ fontFamily: "'Libre Franklin', sans-serif", color: INK }}>
            IA — Claude
          </div>
          <Badge level="ok" text="Funzionalità IA attive: nessuna API key da configurare" />
          <p className="text-[11px] opacity-50 w-full">
            Tutte le funzioni IA (estrazione SP, Nota Integrativa, valutazioni, allocazione ASA) usano direttamente il
            modello Claude tramite il tuo account già collegato a questa conversazione: non serve inserire alcuna chiave
            API. Questo funziona quando il programma è eseguito come artifact dentro l'interfaccia di Claude (claude.ai /
            app Claude); se lo esporti ed esegui altrove dovrai integrare una tua chiamata API.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {importEsito && <Badge level={importEsito.level} text={importEsito.text} />}
          {schemaInfo && (
            <Badge level="info" text={`Schema contabile: ${systemPrompts.SCHEMI[schemaInfo.schema]?.label || schemaInfo.schema}${schemaInfo.valuta ? ` · ${schemaInfo.valuta}` : ""}${schemaInfo.unita && schemaInfo.unita !== "unità" ? ` · importi in ${schemaInfo.unita}` : ""}`} />
          )}
          {ai.master.ok && <Badge level="ok" text={ai.master.ok} />}
          {ai.master.error && <Badge level="bad" text={`Bilancio completo: ${ai.master.error}`} />}
          {ai.sp.ok && <Badge level="ok" text={ai.sp.ok} />}
          {ai.sp.error && <Badge level="bad" text={`SP: ${ai.sp.error}`} />}
          {ai.ni.ok && <Badge level="ok" text={ai.ni.ok} />}
          {ai.ni.error && <Badge level="bad" text={`Nota Integrativa: ${ai.ni.error}`} />}
          {ai.rg.ok && <Badge level="ok" text={ai.rg.ok} />}
          {ai.rg.error && <Badge level="bad" text={`Relazione sulla Gestione: ${ai.rg.error}`} />}
          {hasData && (quadra
            ? <Badge level="ok" text={`Quadratura contabile: attivo ${fmt(r.totAttivoContab)} = passivo ${fmt(r.totPassivoContab)}`} />
            : <Badge level="bad" text={`Attivo ${fmt(r.totAttivoContab)} ≠ passivo ${fmt(r.totPassivoContab)} (sbilancio ${fmt(sbilancio)}): manca qualche voce o un importo è errato`} />)}
          {hasData && nNonClass > 0 && (
            <Badge level="warn" text={`${nNonClass} voci da classificare (attivo ${fmt(r.nonClassAtt)}, passivo ${fmt(r.nonClassPass)}): escluse dai calcoli finché non assegnate`} />
          )}
          {hasData && nNonClass === 0 && validato && <Badge level="ok" text="Validazione confermata: tutte le voci sono classificate" />}
        </div>

        <nav className="mt-5 flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-4 py-2 text-sm font-semibold rounded-t-lg border border-b-0"
              style={{
                fontFamily: "'Libre Franklin', sans-serif",
                background: tab === t.id ? CARD : "transparent",
                borderColor: tab === t.id ? LINE : "transparent",
                color: tab === t.id ? INK : "#6B7280",
              }}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {spFase && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="rounded-lg max-w-md w-full shadow-lg p-6 space-y-3" style={{ background: CARD }}>
            <h3 className="font-semibold" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
              {spFlow === "entrambi" ? "Analisi dello Stato Patrimoniale in tre fasi" : spFlow === "precedente" ? "Estrazione dell'esercizio precedente" : "Analisi dello Stato Patrimoniale in due fasi"}
            </h3>
            {[
              { n: 1, t: "Riconoscimento dello schema contabile", d: "L'IA identifica il tipo di prospetto — italiano civilistico (OIC), internazionale (IAS/IFRS dello IASB) o statunitense (US GAAP) — da lingua, struttura, valuta e voci tipiche." },
              { n: 2, t: spFlow === "precedente" ? `Estrazione dell'esercizio precedente (${annoRifPrec})` : `Estrazione dell'esercizio ${annoRif}`, d: "Le voci vengono estratte e classificate con regole specifiche del sistema riconosciuto, tenendo conto delle differenze contabili: leasing IFRS 16, TFR, treasury stock, ratei/risconti, ordine di liquidità US GAAP…" },
              ...(spFlow === "entrambi" ? [{ n: 3, t: `Estrazione della colonna comparativa (${annoRifPrec})`, d: "Dallo stesso documento l'IA legge ESCLUSIVAMENTE la colonna dell'esercizio precedente, che alimenta le sezioni 8-10 e il calcolo dei Δ patrimoniali per il Rendiconto Finanziario. Nessun secondo caricamento necessario." }] : []),
            ].map((s) => (
              <div key={s.n} className="flex gap-3 items-start rounded border p-3"
                style={{
                  borderColor: spFase === s.n ? GREEN : LINE,
                  background: spFase > s.n ? "#E4F1EA" : spFase === s.n ? "#F0F7F3" : "#FDFDFB",
                  opacity: spFase < s.n ? 0.5 : 1,
                }}>
                <span className="flex-shrink-0 mt-0.5 w-4 text-center">
                  {spFase > s.n
                    ? <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
                    : spFase === s.n
                    ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2"
                        style={{ borderColor: GREEN, borderTopColor: "transparent", animation: "spin .8s linear infinite" }} />
                    : <span className="opacity-40">•</span>}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Fase {s.n} · {s.t}</span>
                  <span className="block text-xs opacity-70 mt-0.5">{s.d}</span>
                  {s.n === 1 && spFase >= 2 && schemaInfo && (
                    <span className="block text-xs font-semibold mt-1" style={{ color: GREEN }}>
                      Riconosciuto: {systemPrompts.SCHEMI[schemaInfo.schema]?.label}{schemaInfo.indizi ? ` — ${schemaInfo.indizi}` : ""}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <p className="text-[11px] opacity-50">
              {spFlow === "entrambi"
                ? "Un solo caricamento: dallo stesso bilancio vengono estratti sia l'esercizio corrente sia la colonna comparativa dell'anno precedente."
                : "Il riconoscimento guida tutta l'analisi successiva: estrazione, riclassificazione e lettura della Nota Integrativa terranno conto delle differenze contabili tra i sistemi."}
            </p>
          </div>
        </div>
      )}

      {niFase && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="rounded-lg max-w-md w-full shadow-lg p-6 space-y-3" style={{ background: CARD }}>
            <h3 className="font-semibold" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
              {niFlow === "entrambi" ? "Analisi della Nota Integrativa — corrente + precedente" : niFlow === "precedente" ? "Analisi della Nota Integrativa — esercizio precedente" : "Analisi automatica della Nota Integrativa"}
            </h3>
            {[
              { n: 1, t: niFlow === "precedente" ? "Scansione e filtro (esercizio precedente)" : "Scansione e filtro delle pagine utili", d: "L'IA legge l'intero documento e individua da sola le sole sezioni rilevanti (natura e scadenza dei debiti, crediti, immobilizzazioni, fondi, garanzie…), ignorando tutto il resto." },
              { n: 2, t: "Riclassificazione definitiva delle voci", d: "Le informazioni filtrate vengono applicate automaticamente allo Stato Patrimoniale: spostamenti di classe e scomposizioni delle voci aggregate." },
              ...(niFlow === "entrambi" ? [
                { n: 3, t: "Scansione dei dati dell'esercizio precedente", d: `Sullo STESSO documento l'IA cerca le informazioni riferite alla colonna comparativa (${annoRifPrec}), riusando le porzioni già suddivise: nessun secondo caricamento.` },
                { n: 4, t: "Riclassificazione delle voci dell'anno precedente", d: `Le informazioni del ${annoRifPrec} vengono applicate alle voci della sezione 8, alimentando SP riclassificato ${annoRifPrec} e Δ patrimoniali.` },
              ] : []),
            ].map((s) => (
              <div key={s.n} className="flex gap-3 items-start rounded border p-3"
                style={{
                  borderColor: niFase === s.n ? BLUE : LINE,
                  background: niFase > s.n ? "#E4F1EA" : niFase === s.n ? "#F4F8FD" : "#FDFDFB",
                  opacity: niFase < s.n ? 0.5 : 1,
                }}>
                <span className="flex-shrink-0 mt-0.5 w-4 text-center">
                  {niFase > s.n
                    ? <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
                    : niFase === s.n
                    ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2"
                        style={{ borderColor: BLUE, borderTopColor: "transparent", animation: "spin .8s linear infinite" }} />
                    : <span className="opacity-40">•</span>}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Fase {s.n} · {s.t}</span>
                  <span className="block text-xs opacity-70 mt-0.5">{s.d}</span>
                  {(s.n === 1 || s.n === 3) && niFase === s.n && niChunks && niChunks.tot > 1 && (
                    <span className="block text-xs font-semibold mt-1" style={{ color: BLUE }}>
                      Documento grande: suddiviso in {niChunks.tot} porzioni · analisi porzione {Math.min(niChunks.done + 1, niChunks.tot)} di {niChunks.tot}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <p className="text-[11px] opacity-50">
              {niFlow === "entrambi"
                ? "Un solo caricamento: la stessa Nota Integrativa viene analizzata per l'esercizio corrente e per quello precedente (colonna comparativa)."
                : "Nessun intervento richiesto: al termine il risultato compare nella schermata di validazione, dove puoi sempre correggere a mano classi, importi e denominazioni."}
            </p>
          </div>
        </div>
      )}

      {rgFase && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="rounded-lg max-w-md w-full shadow-lg p-6 space-y-3" style={{ background: CARD }}>
            <h3 className="font-semibold" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
              Analisi automatica della Relazione sulla Gestione{ai.rgPrec.loading ? ` — esercizio ${annoPrec}` : ""}
            </h3>
            {[
              { n: 1, t: "Filtro tematico in 4 sezioni", d: "L'IA legge l'intero documento e organizza le informazioni rilevanti in quattro aree: contesto e settore, modello di business e ASA, fatti di rilievo e operazioni straordinarie, evoluzione e continuità." },
              { n: 2, t: "Riclassificazione delle voci", d: "Le informazioni filtrate vengono applicate allo Stato Patrimoniale: spostamenti di classe e scomposizioni delle voci aggregate, ancorati alla Relazione sulla Gestione." },
            ].map((s) => (
              <div key={s.n} className="flex gap-3 items-start rounded border p-3"
                style={{
                  borderColor: rgFase === s.n ? PURPLE : LINE,
                  background: rgFase > s.n ? "#E4F1EA" : rgFase === s.n ? "#F3EEFC" : "#FDFDFB",
                  opacity: rgFase < s.n ? 0.5 : 1,
                }}>
                <span className="flex-shrink-0 mt-0.5 w-4 text-center">
                  {rgFase > s.n
                    ? <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
                    : rgFase === s.n
                    ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2"
                        style={{ borderColor: PURPLE, borderTopColor: "transparent", animation: "spin .8s linear infinite" }} />
                    : <span className="opacity-40">•</span>}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Fase {s.n} · {s.t}</span>
                  <span className="block text-xs opacity-70 mt-0.5">{s.d}</span>
                  {s.n === 1 && rgFase === 1 && niChunks && niChunks.tot > 1 && (
                    <span className="block text-xs font-semibold mt-1" style={{ color: PURPLE }}>
                      Documento grande: suddiviso in {niChunks.tot} porzioni · analisi porzione {Math.min(niChunks.done + 1, niChunks.tot)} di {niChunks.tot}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <p className="text-[11px] opacity-50">
              La Relazione sulla Gestione affina la riclassificazione già impostata da SP e Nota Integrativa: al termine il
              risultato compare nella sezione 3 e le voci aggiornate restano modificabili nella validazione.
            </p>
          </div>
        </div>
      )}

      <DettaglioModal m={dettaglio} onClose={() => setDettaglio(null)} />

      <main className="px-6 pb-12 max-w-6xl mx-auto">
        <div className="border-t" style={{ borderColor: LINE }} />
        <div className="pt-6 space-y-8">

          {tab === "dati" && (
            <>
              {gatekeeper?.allerta && (
                <div className="rounded-lg border p-4 flex flex-wrap items-center gap-3 shadow-sm" style={{ borderColor: RED, background: "#FDF2F2" }}>
                  <span className="text-2xl">⚠️</span>
                  <div className="flex-1 min-w-[260px]">
                    <p className="text-sm font-bold" style={{ color: RED }}>Gatekeeper di Coerenza Classificatoria</p>
                    <p className="text-sm font-semibold mt-1" style={{ color: INK }}>{gatekeeper.messaggio}</p>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                <span className="text-2xl">🧩</span>
                <div className="flex-1 min-w-[260px]">
                  <p className="text-sm font-semibold">Come funziona lo schema dinamico</p>
                  <p className="text-xs opacity-70">
                    L'IA estrae <b>tutte le voci originali</b> del bilancio (qualunque schema: civilistico, abbreviato, IFRS)
                    e propone per ciascuna una <b>classe di pertinenza gestionale</b>. Qui sotto validi il lavoro: correggi
                    nomi, importi e classi, elimini o aggiungi voci. Le formule della riclassificazione aggregano le voci
                    per classe, quindi <b>si adattano automaticamente</b>: se una voce non esiste nel bilancio, semplicemente
                    non entra in alcuna formula. Le voci «da classificare» restano escluse dai calcoli finché non le assegni.
                  </p>
                </div>
              </div>

              {hasData ? (
                <>
                  <section className="grid lg:grid-cols-2 gap-4 items-start">
                    <VociTable sezione="attivo" tone={GREEN} />
                    <VociTable sezione="passivo" tone={RED} />
                  </section>

                  {(niFiltro?.applicato || niOss.length > 0) && (
                    <div className="rounded-lg border p-4 flex flex-wrap items-center gap-3" style={{ borderColor: BLUE, background: "#EEF3FB" }}>
                      <span className="text-xl">📑</span>
                      <p className="text-sm flex-1 min-w-[240px]">
                        Le informazioni ricavate dalla <b>Nota Integrativa</b> e il loro impatto su questi dati sono ora
                        raccolti nella sezione <b>«2 · Nota Integrativa»</b>.
                      </p>
                      <button onClick={() => setTab("nota")} className="px-4 py-1.5 rounded font-semibold text-sm"
                        style={{ background: BLUE, color: "#fff" }}>
                        Vai alla Nota Integrativa →
                      </button>
                    </div>
                  )}

                  <div className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: LINE, background: CARD }}>
                    <div className="text-sm">
                      <span className="font-semibold">Validazione: </span>
                      {nNonClass > 0
                        ? <span style={{ color: "#8A6414" }}>{nNonClass} voci ancora da classificare (evidenziate in giallo).</span>
                        : quadra
                        ? <span style={{ color: GREEN }}>tutte le voci classificate e bilancio in quadratura.</span>
                        : <span style={{ color: RED }}>voci classificate ma il bilancio non quadra: controlla gli importi.</span>}
                    </div>
                    <button onClick={() => { setValidato(true); setTab("sp"); }}
                      disabled={nNonClass > 0}
                      className="px-5 py-2 rounded font-semibold text-sm"
                      style={{ background: nNonClass > 0 ? "#9CA3AF" : INK, color: "#fff" }}>
                      ✓ Conferma validazione e riclassifica →
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState onLoad={() => spFileRef.current?.click()} />
              )}
            </>
          )}

          {tab === "nota" && (
            (niFiltro?.applicato || niOss.length > 0) ? (
              <section className="space-y-4">
                <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: LINE, background: "#EEF3FB" }}>
                  <span className="text-2xl">📑</span>
                  <div className="flex-1 min-w-[260px]">
                    <p className="text-sm font-semibold">Cosa contiene questa sezione</p>
                    <p className="text-xs opacity-70">
                      Qui trovi tutte le <b>informazioni ricavate dalla Nota Integrativa</b> e la spiegazione di{" "}
                      <b>come cambiano i dati della sezione 1</b> (voci e classi dello Stato Patrimoniale) alla luce di
                      queste informazioni. Le modifiche sono <b>già applicate</b>: le ritrovi nella validazione (sezione 1)
                      e in tutti i prospetti successivi. Per aggiornarle, ricarica la Nota Integrativa dal pulsante{" "}
                      <b>«Carica Nota Integrativa (IA)»</b> in alto.
                    </p>
                  </div>
                </div>

                {/* ── PARTE A: informazioni ricavate ─────────────────── */}
                <div>
                  <H2>Informazioni ricavate dalla Nota Integrativa</H2>
                  {niFiltro?.applicato && niFiltro.estratti.filter((x) => x.incluso).length > 0 ? (
                    <SectionCard title={`Informazioni non-financial estratte${niFiltro.pagine.length ? ` (pagine ${niFiltro.pagine.join(", ")})` : ""}`} tone={BLUE}>
                      {niFiltro.estratti.filter((x) => x.incluso).map((x, i) => (
                        <div key={x.id} className="py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                          <div className="text-xs font-semibold">{x.tema}{x.pagina != null ? <span className="opacity-50 font-normal"> · pagina {x.pagina}</span> : null}</div>
                          <div className="text-xs opacity-70 mt-0.5">{x.contenuto}</div>
                        </div>
                      ))}
                    </SectionCard>
                  ) : (
                    <Badge level="info" text="Nessuna informazione non-financial estratta dal documento." />
                  )}
                </div>

                {niOss.length > 0 && (
                  <SectionCard title="Osservazioni di sintesi — garanzie, impegni, rischi, parti correlate" tone={INK}>
                    {niOss.map((o, i) => (
                      <div key={i} className="flex gap-2 py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                        <span style={{ color: BLUE }}>▸</span>
                        <span>{o}</span>
                      </div>
                    ))}
                  </SectionCard>
                )}

                {/* ── PARTE B: come cambiano i dati della sezione 1 ───── */}
                <div className="pt-2">
                  <H2>Come cambiano i dati della sezione 1</H2>
                  {niImpatto && (niImpatto.riclass.length > 0 || niImpatto.scomp.length > 0) ? (
                    <div className="space-y-4">
                      <p className="text-sm opacity-70">
                        Le informazioni qui sopra hanno prodotto{" "}
                        <b>{niImpatto.riclass.length} riclassificazion{niImpatto.riclass.length === 1 ? "e" : "i"}</b> (voci
                        spostate di classe gestionale) e{" "}
                        <b>{niImpatto.scomp.length} scomposizion{niImpatto.scomp.length === 1 ? "e" : "i"}</b> (voci aggregate
                        divise per natura o scadenza). Ecco il dettaglio <b>prima → dopo</b>:
                      </p>

                      {niImpatto.riclass.length > 0 && (
                        <SectionCard title="Voci spostate di classe (riclassificazioni)" tone={AMBER}>
                          {niImpatto.riclass.map((r, i) => (
                            <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{r.nome}</span>
                                <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.importo)}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                                <ClasseChip code={r.classePrima} />
                                <span className="text-xs opacity-40">→</span>
                                <ClasseChip code={r.classeDopo} />
                              </div>
                              {r.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {r.motivo}</div>}
                            </div>
                          ))}
                        </SectionCard>
                      )}

                      {niImpatto.scomp.length > 0 && (
                        <SectionCard title="Voci scomposte per natura/scadenza (scomposizioni)" tone={PURPLE}>
                          {niImpatto.scomp.map((s, i) => (
                            <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{s.originale}</span>
                                <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.importoOrig)}</span>
                              </div>
                              <div className="text-xs opacity-40 my-1">si scompone in:</div>
                              <div className="space-y-1.5 pl-2">
                                {s.parti.map((p, j) => (
                                  <div key={j} className="flex items-baseline justify-between gap-2 flex-wrap">
                                    <span className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs opacity-40">•</span>
                                      <span className="text-sm">{p.nome}</span>
                                      <ClasseChip code={p.classe} />
                                    </span>
                                    <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.importo)}</span>
                                  </div>
                                ))}
                                {s.residuo > 0 && (
                                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                    <span className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs opacity-40">•</span>
                                      <span className="text-sm opacity-70">{s.originale} (residuo)</span>
                                      <ClasseChip code={s.classeOrig} />
                                    </span>
                                    <span className="text-sm opacity-70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.residuo)}</span>
                                  </div>
                                )}
                              </div>
                              {s.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {s.motivo}</div>}
                            </div>
                          ))}
                        </SectionCard>
                      )}

                      <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                        <span className="text-2xl">🧭</span>
                        <p className="text-xs flex-1 min-w-[220px]">
                          <b>Effetto sui dati:</b> spostare una voce da una classe all'altra (es. da «operativa» a
                          «finanziaria», o da «corrente» a «non corrente») <b>non cambia il totale</b> dello Stato
                          Patrimoniale, ma <b>ne cambia la lettura</b>. Poiché le formule aggregano per classe, questi
                          spostamenti si propagano automaticamente allo <b>SP riclassificato (sezione 3)</b>, ai{" "}
                          <b>margini e indici (sezione 4)</b> — in particolare Posizione Finanziaria Netta, indici di
                          liquidità e di struttura — e alle <b>determinanti del CCNO (sezione 6)</b>. Le scomposizioni
                          separano le componenti di una voce aggregata (tipicamente entro/oltre 12 mesi o
                          finanziaria/operativa), rendendo più accurati gli indici di scadenza. Le voci con importi stimati
                          vanno sempre verificate sul documento originale.
                        </p>
                      </div>
                      {niImpatto.scartate > 0 && (
                        <Badge level="warn" text={`${niImpatto.scartate} proposte dell'IA sono state scartate per incoerenza (voce non trovata o somma dei dettagli superiore all'importo originale).`} />
                      )}
                    </div>
                  ) : (
                    <Badge level="ok" text="La Nota Integrativa è stata analizzata ma non ha comportato spostamenti di classe né scomposizioni: le voci della sezione 1 restano invariate. Le osservazioni qui sopra restano comunque rilevanti per la valutazione." />
                  )}
                </div>
              </section>
            ) : (
              <div className="rounded-lg border p-8 text-center" style={{ borderColor: LINE, background: CARD }}>
                <div className="text-4xl mb-3">📑</div>
                <p className="text-lg font-semibold mb-1" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>Nessuna Nota Integrativa caricata</p>
                <p className="text-sm opacity-70 mb-4 max-w-md mx-auto">
                  Usa il pulsante <b>«📑 Carica Nota Integrativa (IA)»</b> in alto: l'IA estrarrà le informazioni
                  non-financial (garanzie, scadenze, natura dei debiti, parti correlate…) e le informazioni compariranno
                  qui automaticamente, insieme a come modificano la classificazione delle voci della sezione 1. Non serve
                  caricare il documento una seconda volta.
                </p>
                {ai.ni.loading && (
                  <div className="flex justify-center"><Badge level="info" text="Analisi della Nota Integrativa in corso…" /></div>
                )}
                {!hasData && <p className="text-xs opacity-50 mt-1">Devi prima caricare lo Stato Patrimoniale nella sezione 1.</p>}
                {ai.ni.error && <div className="mt-3 flex justify-center"><Badge level="bad" text={ai.ni.error} /></div>}
              </div>
            )
          )}

          {tab === "rg" && (hasData ? (
            (rgFiltro?.applicato || rgOss.length > 0 || rgImpatto) ? (
              <section className="space-y-6">
                <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: PURPLE, background: "#F3EEFC" }}>
                  <span className="text-2xl">📎</span>
                  <div className="text-xs flex-1 min-w-[240px] space-y-1.5">
                    <p className="text-sm font-semibold" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                      Che cosa fa l'IA in questa sezione
                    </p>
                    <p className="opacity-70">
                      La <b>Relazione sulla Gestione</b> viene letta e organizzata in <b>quattro aree tematiche</b>. Le
                      informazioni rilevanti affinano la riclassificazione già impostata da SP e Nota Integrativa: le
                      modifiche alle voci sono <b>già applicate</b> e si ritrovano nella validazione (sezione 1) e nei
                      prospetti successivi. Per aggiornarle, ricarica il documento dal pulsante{" "}
                      <b>«📎 Carica Relazione Gestione (IA)»</b> in alto.
                    </p>
                  </div>
                </div>

                {/* ── PARTE A: 4 riquadri tematici ─────────────────── */}
                <div>
                  <H2>Informazioni ricavate dalla Relazione sulla Gestione{rgFiltro?.pagine?.length ? ` (pagine ${rgFiltro.pagine.join(", ")})` : ""}</H2>
                  <div className="grid md:grid-cols-2 gap-4">
                    {RG_SEZIONI.map((sez) => {
                      const items = (rgFiltro?.estratti || []).filter((x) => x.incluso && x.sezione === sez.n);
                      return (
                        <SectionCard key={sez.n} title={`${sez.icona} ${sez.n}. ${sez.titolo}`} tone={sez.tone}>
                          {items.length > 0 ? items.map((x, i) => (
                            <div key={x.id} className="py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                              <div className="text-xs font-semibold">{x.tema}{x.pagina != null ? <span className="opacity-50 font-normal"> · pagina {x.pagina}</span> : null}</div>
                              <div className="text-xs opacity-70 mt-0.5">{x.contenuto}</div>
                            </div>
                          )) : (
                            <div className="text-xs opacity-40 py-2 text-center">Nessuna informazione rilevante in quest'area.</div>
                          )}
                        </SectionCard>
                      );
                    })}
                  </div>
                </div>

                {rgOss.length > 0 && (
                  <SectionCard title="Osservazioni di sintesi — contesto, business, operazioni straordinarie, continuità" tone={INK}>
                    {rgOss.map((o, i) => (
                      <div key={i} className="flex gap-2 py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                        <span style={{ color: PURPLE }}>▸</span>
                        <span>{o}</span>
                      </div>
                    ))}
                  </SectionCard>
                )}

                {/* ── PARTE B: Tabella riepilogativa dell'impatto ───── */}
                <div className="pt-2">
                  <H2>Tabella riepilogativa dell'impatto sui dati</H2>
                  {rgImpatto && (rgImpatto.riclass.length > 0 || rgImpatto.scomp.length > 0) ? (
                    <div className="space-y-4">
                      <p className="text-sm opacity-70">
                        Le informazioni della Relazione hanno prodotto{" "}
                        <b>{rgImpatto.riclass.length} riclassificazion{rgImpatto.riclass.length === 1 ? "e" : "i"}</b> e{" "}
                        <b>{rgImpatto.scomp.length} scomposizion{rgImpatto.scomp.length === 1 ? "e" : "i"}</b>. Ecco il
                        dettaglio <b>prima → dopo</b>:
                      </p>

                      {rgImpatto.riclass.length > 0 && (
                        <SectionCard title="Voci spostate di classe (riclassificazioni)" tone={AMBER}>
                          {rgImpatto.riclass.map((r, i) => (
                            <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{r.nome}</span>
                                <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.importo)}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                                <ClasseChip code={r.classePrima} />
                                <span className="text-xs opacity-40">→</span>
                                <ClasseChip code={r.classeDopo} />
                              </div>
                              {r.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {r.motivo}</div>}
                            </div>
                          ))}
                        </SectionCard>
                      )}

                      {rgImpatto.scomp.length > 0 && (
                        <SectionCard title="Voci scomposte per natura/scadenza (scomposizioni)" tone={PURPLE}>
                          {rgImpatto.scomp.map((s, i) => (
                            <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{s.originale}</span>
                                <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.importoOrig)}</span>
                              </div>
                              <div className="text-xs opacity-40 my-1">si scompone in:</div>
                              <div className="space-y-1.5 pl-2">
                                {s.parti.map((p, j) => (
                                  <div key={j} className="flex items-baseline justify-between gap-2 flex-wrap">
                                    <span className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs opacity-40">•</span>
                                      <span className="text-sm">{p.nome}</span>
                                      <ClasseChip code={p.classe} />
                                    </span>
                                    <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.importo)}</span>
                                  </div>
                                ))}
                                {s.residuo > 0 && (
                                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                    <span className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs opacity-40">•</span>
                                      <span className="text-sm opacity-70">{s.originale} (residuo)</span>
                                      <ClasseChip code={s.classeOrig} />
                                    </span>
                                    <span className="text-sm opacity-70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.residuo)}</span>
                                  </div>
                                )}
                              </div>
                              {s.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {s.motivo}</div>}
                            </div>
                          ))}
                        </SectionCard>
                      )}

                      <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start" style={{ borderColor: LINE, background: "#F3EEFC" }}>
                        <span className="text-2xl">🧭</span>
                        <p className="text-xs flex-1 min-w-[220px]">
                          <b>Effetto sui dati:</b> come per la Nota Integrativa, gli spostamenti di classe non cambiano il
                          totale dello Stato Patrimoniale ma ne cambiano la lettura, propagandosi automaticamente allo{" "}
                          <b>SP riclassificato (sezione 4)</b>, ai <b>margini e indici (sezione 5)</b> e alle{" "}
                          <b>determinanti del CCNO (sezione 6)</b>. Le informazioni della Relazione sulla Gestione sono
                          spesso qualitative (contesto, business, prospettive): incidono soprattutto sulla distinzione tra
                          gestione caratteristica e accessoria e sul riconoscimento di poste connesse a operazioni
                          straordinarie o rischi di continuità.
                        </p>
                      </div>
                      {rgImpatto.scartate > 0 && (
                        <Badge level="warn" text={`${rgImpatto.scartate} proposte dell'IA sono state scartate per incoerenza (voce non trovata o somma dei dettagli superiore all'importo originale).`} />
                      )}
                    </div>
                  ) : (
                    <Badge level="ok" text="La Relazione sulla Gestione è stata analizzata ma non ha comportato spostamenti di classe né scomposizioni: le voci della sezione 1 restano invariate. Gli estratti qui sopra restano comunque utili alla lettura del bilancio." />
                  )}
                </div>
              </section>
            ) : (
              <div className="rounded-lg border p-8 text-center" style={{ borderColor: LINE, background: CARD }}>
                <div className="text-4xl mb-3">📎</div>
                <p className="text-lg font-semibold mb-1" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>Nessuna Relazione sulla Gestione caricata</p>
                <p className="text-sm opacity-70 mb-4 max-w-md mx-auto">
                  Usa il pulsante <b>«📎 Carica Relazione Gestione (IA)»</b> in alto: l'IA organizzerà il documento in
                  quattro aree tematiche (contesto e settore, modello di business e ASA, fatti di rilievo, evoluzione e
                  continuità) e applicherà le eventuali riclassificazioni alle voci della sezione 1.
                </p>
                {ai.rg.loading && (
                  <div className="flex justify-center"><Badge level="info" text="Analisi della Relazione sulla Gestione in corso…" /></div>
                )}
                {!hasData && <p className="text-xs opacity-50 mt-1">Devi prima caricare lo Stato Patrimoniale nella sezione 1.</p>}
                {ai.rg.error && <div className="mt-3 flex justify-center"><Badge level="bad" text={ai.rg.error} /></div>}
              </div>
            )
          ) : (
            <div className="rounded-lg border p-8 text-center" style={{ borderColor: LINE, background: CARD }}>
              <div className="text-4xl mb-3">📎</div>
              <p className="text-lg font-semibold mb-1" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>Prima carica lo Stato Patrimoniale</p>
              <p className="text-sm opacity-70 mb-4 max-w-md mx-auto">
                La Relazione sulla Gestione affina una riclassificazione esistente: carica prima lo Stato Patrimoniale
                nella sezione 1.
              </p>
              <button onClick={() => setTab("dati")} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
                ← Vai a dati e validazione
              </button>
            </div>
          ))}

          {tab === "sp" && (hasData ? (
            <section>
              {nNonClass > 0 && (
                <div className="mb-4">
                  <Badge level="warn" text={`${nNonClass} voci non classificate sono escluse da questo prospetto: torna alla validazione per assegnarle.`} />
                </div>
              )}
              <div className="mb-4">
                <H2>Stato Patrimoniale riclassificato — criterio di pertinenza gestionale</H2>
              </div>
                  <div className="rounded-lg border p-4 mb-4 flex flex-wrap gap-4 items-center" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                    <span className="text-2xl">🎯</span>
                    <p className="text-xs flex-1 min-w-[260px]">
                      <b>Criterio di pertinenza gestionale:</b> distingue il <b>core business</b> (gestione caratteristica)
                      dalle attività di <b>reperimento</b> (debiti finanziari) e <b>investimento</b> (liquidità, titoli,
                      crediti finanziari) di risorse finanziarie, isolando la gestione accessoria. Ogni riga sotto è una
                      voce reale del bilancio caricato: il prospetto si adatta alle voci presenti.
                    </p>
                  </div>
                  <TabelleAree r={r} />

                  <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
                    <SectionCard title="Impieghi — Capitale investito per area di gestione" tone={GREEN}>
                      <div className="text-[11px] uppercase tracking-widest pt-1 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: GREEN }}>
                        A · Gestione caratteristica — core business
                      </div>
                      <GruppoVoci voci={r.of("att_op_magazzino", "att_op_corrente")} subtot={r.attOpCorrTot}
                        subtotLabel="Attività operative correnti" color={GREEN} segno="+" />
                      <GruppoVoci voci={r.of("pass_op_corrente")} subtot={r.passOpCorr}
                        subtotLabel="Passività operative correnti" color={GREEN} segno="−" />
                      <div style={{ borderTop: `1px solid ${LINE}` }}>
                        <Row label="CAPITALE CIRCOLANTE NETTO OPERATIVO (CCNO)" value={r.ccno} bold color={GREEN} />
                      </div>
                      <GruppoVoci voci={r.of("att_op_immobilizzata")} subtot={r.immobOper}
                        subtotLabel="Attivo operativo immobilizzato" color={GREEN} segno="+" />
                      <GruppoVoci voci={r.of("pass_op_non_corrente")} subtot={r.passOpNC}
                        subtotLabel="Passività operative non correnti" color={GREEN} segno="−" />
                      <div style={{ borderTop: `1px solid ${LINE}` }}>
                        <Row label="CAPITALE INVESTITO NEL CORE BUSINESS (CIN)" value={r.cinOper} bold color={GREEN} />
                      </div>

                      <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: PURPLE }}>
                        B · Gestione accessoria — patrimoniale
                      </div>
                      <GruppoVoci voci={r.of("att_accessoria")} subtot={r.accessori}
                        subtotLabel="Impieghi accessori" color={PURPLE} segno="+" />

                      <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: BLUE }}>
                        C · Gestione finanziaria — investimento di risorse
                      </div>
                      <GruppoVoci voci={r.of("att_fin_liquidita", "att_fin_altre")} subtot={r.attFin}
                        subtotLabel="Attività finanziarie totali" color={BLUE} segno="+" />

                      <div style={{ borderTop: `2px solid ${INK}` }}>
                        <Row label="TOTALE CAPITALE INVESTITO (A + B + C)" value={r.totImpieghiFun} bold />
                      </div>
                    </SectionCard>

                    <div className="flex gap-3 justify-center items-end py-2">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-20 h-64 rounded overflow-hidden flex flex-col border" style={{ borderColor: LINE }}>
                          {barSeg(Math.max(r.cinOper, 0), r.totImpieghiFun, "#2C6E54", "Core business")}
                          {barSeg(r.accessori, r.totImpieghiFun, "#6D28D9", "Accessoria")}
                          {barSeg(r.attFin, r.totImpieghiFun, "#2E5EAA", "Finanziaria")}
                        </div>
                        <span className="text-xs font-semibold">Impieghi</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-20 h-64 rounded overflow-hidden flex flex-col border" style={{ borderColor: LINE }}>
                          {barSeg(r.pn, r.totFontiFun, "#7A2F29", "PN")}
                          {barSeg(r.debFin, r.totFontiFun, "#B3423A", "Debiti fin.")}
                        </div>
                        <span className="text-xs font-semibold">Fonti</span>
                      </div>
                    </div>

                    <div className="space-y-4 flex flex-col">
                      <SectionCard title="Fonti — Reperimento delle risorse finanziarie" tone={RED}>
                        <div className="text-[11px] uppercase tracking-widest pt-1 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: RED }}>
                          Capitale di rischio
                        </div>
                        <GruppoVoci voci={r.of("pn")} subtot={r.pn} subtotLabel="PATRIMONIO NETTO" color={RED} segno="+" />

                        <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: BLUE }}>
                          Gestione finanziaria — reperimento di risorse
                        </div>
                        <GruppoVoci voci={r.of("pass_fin_corrente", "pass_fin_non_corrente")} subtot={r.debFin}
                          subtotLabel="DEBITI FINANZIARI TOTALI" color={BLUE} segno="+" />

                        <div style={{ borderTop: `2px solid ${INK}` }}>
                          <Row label="TOTALE FONTI FINANZIARIE (PN + Debiti fin.)" value={r.totFontiFun} bold />
                        </div>
                        <div className="mt-2 pt-2" style={{ borderTop: `1px dashed ${LINE}` }}>
                          <Row label="di cui Posizione finanziaria netta (Debiti fin. − Attività fin.)" value={r.pfn} bold color={r.pfn <= 0 ? GREEN : INK} />
                        </div>
                      </SectionCard>

                      <div className="rounded-lg border p-4" style={{ borderColor: LINE, background: CARD }}>
                        {quadraFun
                          ? <Badge level="ok" text={`Quadratura verificata: Capitale investito ${fmt(r.totImpieghiFun)} = PN + Debiti finanziari ${fmt(r.totFontiFun)}`} />
                          : <Badge level="warn" text={`Capitale investito ${fmt(r.totImpieghiFun)} ≠ Fonti ${fmt(r.totFontiFun)} (differenza ${fmt(r.totImpieghiFun - r.totFontiFun)}): controlla classificazioni e voci non classificate`} />}
                        <p className="text-xs mt-2 opacity-60">
                          Le <b>passività operative</b> (correnti e non correnti) nascono spontaneamente dal ciclo operativo e
                          sono portate in diminuzione degli impieghi del core business, non tra le fonti. Le uniche vere fonti
                          sono il capitale di rischio (PN) e il capitale di debito oneroso. In forma netta: CIN complessivo =
                          PN + PFN.
                        </p>
                      </div>
                    </div>
                  </div>
              <div className="text-center mt-6">
                <button onClick={() => setTab("margini")} className="px-5 py-2 rounded font-semibold text-sm"
                  style={{ background: INK, color: "#fff" }}>
                  Vai a margini e indici →
                </button>
              </div>
            </section>
          ) : (
            <EmptyState onLoad={() => setTab("dati")} />
          ))}

          {tab === "margini" && (hasData ? (
            <>
              {nNonClass > 0 && (
                <Badge level="warn" text={`${nNonClass} voci non classificate escluse dai calcoli: i valori sotto potrebbero essere incompleti.`} />
              )}
              <section className="rounded-lg border p-4 flex flex-wrap items-center gap-4" style={{ borderColor: LINE, background: CARD }}>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xs uppercase tracking-widest opacity-60"
                    style={{ fontFamily: "'Libre Franklin', sans-serif", fontWeight: 800 }}>
                    Sintesi della valutazione
                  </div>
                  <p className="text-sm mt-1">
                    Su {giudiziValutabili.length} margini e indici valutati, derivati dalle voci classificate dello Stato
                    Patrimoniale{esercizio ? ` (esercizio ${esercizio})` : ""}.
                  </p>
                  <p className="text-xs mt-1" style={{ color: BLUE }}>
                    💡 Clicca su qualsiasi margine o indice per vedere come è stato calcolato con i dati del bilancio e cosa significa in pratica.
                  </p>
                </div>
                <div className="flex gap-3">
                  {[["ok", GREEN, "Positivi"], ["warn", AMBER, "Da monitorare"], ["bad", RED, "Critici"]].map(([lev, col, lab]) => (
                    <div key={lev} className="text-center px-4 py-2 rounded-lg border" style={{ borderColor: LINE }}>
                      <div className="text-2xl" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: col }}>
                        {conta(lev)}
                      </div>
                      <div className="text-xs opacity-70">{lab}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <H2>Fabbisogno finanziario e grandezze della pertinenza gestionale</H2>
                <div className="grid sm:grid-cols-3 gap-3">
                  {marginiFun.map((m) => (
                    <CardInd key={m.nome} m={m} onOpen={setDettaglio} />
                  ))}
                </div>
              </section>

              <section>
                <H2>Margini del criterio finanziario</H2>
                <div className="grid sm:grid-cols-2 gap-3">
                  {margini.map((m) => (
                    <CardInd key={m.nome} m={m} onOpen={setDettaglio} />
                  ))}
                </div>
              </section>

              <section>
                <H2>Indici patrimoniali e finanziari</H2>
                {["Composizione", "Solidità", "Liquidità"].map((area) => (
                  <div key={area} className="mb-4">
                    <div className="text-xs uppercase tracking-widest mb-2 font-semibold"
                      style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>
                      Indici di {area.toLowerCase()}
                    </div>
                    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: LINE, background: CARD }}>
                      <table className="w-full text-sm" style={{ minWidth: 620 }}>
                        <tbody>
                          {indici.filter((i) => i.sez === area).map((i, k) => (
                            <tr key={i.nome} onClick={() => setDettaglio(i)} title="Clicca per vedere calcolo e interpretazione"
                              className="cursor-pointer hover:bg-gray-50"
                              style={{ borderTop: k ? `1px solid ${LINE}` : "none" }}>
                              <td className="px-4 py-2.5 font-medium w-1/3">{i.nome} <span className="text-[10px] px-1 py-0.5 rounded-full font-semibold" style={{ background: "#E8EDF6", color: BLUE }}>ⓘ</span></td>
                              <td className="px-4 py-2.5 text-xs opacity-70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{i.formula}</td>
                              <td className="px-4 py-2.5 text-right w-24" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{i.val}</td>
                              <td className="px-4 py-2.5"><Badge level={i.giud[0]} text={i.giud[1]} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                <div className="text-xs uppercase tracking-widest mb-2 font-semibold"
                  style={{ color: BLUE, fontFamily: "'Libre Franklin', sans-serif" }}>
                  Indici della struttura finanziaria (pertinenza gestionale)
                </div>
                <div className="rounded-lg border overflow-x-auto" style={{ borderColor: LINE, background: CARD }}>
                  <table className="w-full text-sm" style={{ minWidth: 620 }}>
                    <tbody>
                      {indiciFun.map((i, k) => (
                        <tr key={i.nome} onClick={() => setDettaglio(i)} title="Clicca per vedere calcolo e interpretazione"
                          className="cursor-pointer hover:bg-gray-50"
                          style={{ borderTop: k ? `1px solid ${LINE}` : "none" }}>
                          <td className="px-4 py-2.5 font-medium w-1/3">{i.nome} <span className="text-[10px] px-1 py-0.5 rounded-full font-semibold" style={{ background: "#E8EDF6", color: BLUE }}>ⓘ</span></td>
                          <td className="px-4 py-2.5 text-xs opacity-70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{i.formula}</td>
                          <td className="px-4 py-2.5 text-right w-24" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{i.val}</td>
                          <td className="px-4 py-2.5"><Badge level={i.giud[0]} text={i.giud[1]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {niOss.length > 0 && (
                  <div className="mt-4 rounded-lg border p-4" style={{ borderColor: LINE, background: CARD }}>
                    <div className="text-xs uppercase tracking-widest mb-2 font-semibold"
                      style={{ color: INK, fontFamily: "'Libre Franklin', sans-serif" }}>
                      Elementi qualitativi dalla Nota Integrativa da considerare nella valutazione
                    </div>
                    {niOss.map((o, i) => (
                      <div key={i} className="flex gap-2 py-1 text-sm">
                        <span style={{ color: BLUE }}>▸</span>
                        <span>{o}</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs mt-3 opacity-60 max-w-3xl">
                  Tutti i margini e gli indici derivano dall'aggregazione per classi delle voci validate: le formule si
                  adattano alle voci effettivamente presenti nel bilancio caricato. Gli indici con denominatore assente
                  mostrano «n.d.». Le soglie di giudizio riflettono la prassi dell'analisi di bilancio e vanno
                  contestualizzate rispetto al settore e all'andamento pluriennale.
                </p>
              </section>

              <section>
                <H2>Valutazione IA delle informazioni della Nota Integrativa</H2>
                {!(niFiltro?.applicato || niOss.length > 0) ? (
                  <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                    <p className="font-semibold mb-1">Nessuna informazione dalla Nota Integrativa</p>
                    <p className="text-sm opacity-70">
                      Carica prima la Nota Integrativa con il pulsante in alto: le informazioni estratte e applicate
                      alla riclassificazione verranno valutate qui dall'IA insieme a margini e indici.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border p-4 flex flex-wrap items-center gap-3" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                      <span className="text-2xl">🧠</span>
                      <p className="text-xs flex-1 min-w-[220px]">
                        L'IA rilegge le informazioni non-financial della Nota Integrativa <b>alla luce dei margini e degli
                        indici calcolati sopra</b>: per ogni elemento spiega l'impatto pratico su solidità e liquidità,
                        indica quali indici ne risentono (o quali giudizi automatici vanno letti con più cautela) e
                        segnala i rischi da tenere d'occhio: garanzie, covenant, scadenze concentrate, parti correlate.
                      </p>
                      <button onClick={generaValutazioneNi} disabled={niEval.loading}
                        className="px-4 py-2 rounded font-semibold text-sm flex items-center gap-2"
                        style={{ background: BLUE, color: "#fff", opacity: niEval.loading ? 0.6 : 1 }}>
                        {niEval.loading ? <><Spinner /> Valutazione in corso…</> : niEval.data ? <>↻ Rigenera valutazione</> : <>✦ Genera valutazione IA</>}
                      </button>
                    </div>
                    {niEval.error && <Badge level="bad" text={niEval.error} />}
                    {niEval.data && (
                      <>
                        {niEval.data.sintesi && (
                          <SectionCard title="Sintesi della valutazione" tone={INK}>
                            <p className="text-sm leading-relaxed py-1">{niEval.data.sintesi}</p>
                          </SectionCard>
                        )}
                        <div className="grid md:grid-cols-2 gap-3">
                          {niEval.data.valutazioni.map((v, i) => (
                            <div key={i} className="rounded-lg border p-4 space-y-2" style={{ borderColor: LINE, background: CARD }}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-sm font-semibold leading-snug">{v.tema}</div>
                                <span className="flex-shrink-0">
                                  <Badge level={v.livello} text={{ ok: "Rassicurante", warn: "Da monitorare", bad: "Critico", info: "Neutro" }[v.livello]} />
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed">{v.spiegazione}</p>
                              {v.indici && (
                                <p className="text-[11px] opacity-60" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                  Indici collegati: {v.indici}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] opacity-50">
                          Valutazione generata dall'IA sulla base delle informazioni filtrate dalla Nota Integrativa e dei
                          valori calcolati dall'applicazione: verifica sempre i punti critici sul documento originale.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : (
            <EmptyState onLoad={() => setTab("dati")} />
          ))}

          {tab === "ccno" && (hasData ? (
            <>
              <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                <span className="text-2xl">🔄</span>
                <div className="flex-1 min-w-[260px]">
                  <p className="text-sm font-semibold">Le determinanti del Capitale Circolante Netto Operativo</p>
                  <p className="text-xs opacity-70">
                    Il CCNO ci dice quanta liquidità l'azienda «brucia» o «genera» tenendo aperte le serrande ogni giorno,
                    e non è un numero isolato: deriva da <b>due macro-variabili</b> — il <b>volume di attività</b> (fatturato
                    e correlati acquisti e consumi) e le <b>politiche commerciali e produttive</b> (dilazioni concesse ai
                    clienti, giacenza delle scorte, dilazioni ottenute dai fornitori). Inserisci i dati di Conto Economico
                    qui sotto per calcolare durate, ciclo monetario, aliquota di circolante e sostenibilità del debito a breve.
                  </p>
                </div>
              </div>

              <section className="grid lg:grid-cols-2 gap-4 items-start">
                <SectionCard title="Dati di Conto Economico — da inserire" tone={INK}>
                  {[
                    { campo: "fatturato", label: "Fatturato (ricavi di vendita)", hint: "Base di tutte le durate: include costi, stipendi, ammortamenti e margine." },
                    { campo: "consumi", label: "Consumi / costo del venduto", hint: "Denominatore dei giorni scorte: il costo dei beni transitati dal magazzino." },
                    { campo: "acquisti", label: "Acquisti (materie e servizi con dilazione)", hint: "Denominatore dei giorni fornitori: solo ciò su cui i fornitori fanno credito." },
                  ].map((f) => (
                    <div key={f.campo} className="py-1.5">
                      <label className="block text-xs font-semibold mb-1">{f.label}</label>
                      <input type="text" inputMode="decimal" value={det[f.campo]} placeholder="0"
                        onChange={(e) => updDet(f.campo, e.target.value)}
                        className="w-full text-sm px-2 py-1.5 rounded border outline-none"
                        style={{ borderColor: LINE, background: "#fff", fontFamily: "'IBM Plex Mono', monospace" }} />
                      <p className="text-[11px] opacity-50 mt-0.5">{f.hint}</p>
                    </div>
                  ))}
                </SectionCard>
                <SectionCard title="Componenti del CCNc — proposte dallo SP, modificabili" tone={GREEN}>
                  {[
                    { campo: "crediti", label: "Crediti commerciali", def: r.attOpCorr, hint: "Vuoto = attività operative correnti dallo SP (include anche ratei/altre attività: per maggior precisione indica qui i soli crediti verso clienti)." },
                    { campo: "scorte", label: "Rimanenze di magazzino", def: r.attOpMag, hint: "Vuoto = rimanenze dallo SP." },
                    { campo: "fornitori", label: "Debiti verso fornitori", def: r.passOpCorr, hint: "Vuoto = passività operative correnti dallo SP (include anche imposte e altre passività: per maggior precisione indica qui i soli debiti verso fornitori)." },
                  ].map((f) => (
                    <div key={f.campo} className="py-1.5">
                      <label className="block text-xs font-semibold mb-1">{f.label}</label>
                      <input type="text" inputMode="decimal" value={det[f.campo]} placeholder={fmt(f.def)}
                        onChange={(e) => updDet(f.campo, e.target.value)}
                        className="w-full text-sm px-2 py-1.5 rounded border outline-none"
                        style={{ borderColor: LINE, background: "#fff", fontFamily: "'IBM Plex Mono', monospace" }} />
                      <p className="text-[11px] opacity-50 mt-0.5">{f.hint}</p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: `2px solid ${INK}` }}>
                    <span className="text-sm font-semibold">CCNc = Crediti + Scorte − Fornitori</span>
                    <span className="text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: d.ccnc >= 0 ? GREEN : RED }}>{fmt(d.ccnc)}</span>
                  </div>
                  <p className="text-[11px] opacity-50 py-1">
                    {d.ccnc >= 0
                      ? "CCNc positivo: il ciclo operativo assorbe liquidità che va finanziata."
                      : "CCNc negativo: le passività spontanee superano le attività correnti — il ciclo genera un surplus temporaneo di liquidità (caso tipico della GDO: incassi immediati, scorte a rapido turnover, fornitori pagati a 90–120 giorni)."}
                  </p>
                </SectionCard>
              </section>

              {!d.ready && (
                <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                  <p className="font-semibold mb-1">Inserisci Fatturato, Consumi e Acquisti</p>
                  <p className="text-sm opacity-70">Con i tre dati di Conto Economico l'analisi calcola indici di durata, ciclo monetario ponderato, aliquota di circolante e sostenibilità del debito a breve.</p>
                </div>
              )}

              {d.ready && (
                <>
                  <section>
                    <H2>Indici di durata del ciclo operativo</H2>
                    <div className="grid sm:grid-cols-3 gap-3">
                      {detDurate.map((m) => (
                        <CardInd key={m.nome} m={m} onOpen={setDettaglio} />
                      ))}
                    </div>
                  </section>

                  <section>
                    <H2>Il ciclo monetario</H2>
                    <div className="rounded-lg border p-4 space-y-3 mb-4" style={{ borderColor: LINE, background: CARD }}>
                      <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>
                        Linea temporale: dall'uscita di cassa per i fattori produttivi all'incasso delle vendite
                      </div>
                      {(() => {
                        const T = Math.max(d.cicloAttivo, d.ggFornitori, 1);
                        const W = (x) => `${Math.max((x / T) * 100, 0)}%`;
                        const gap = d.cicloAttivo - d.ggFornitori;
                        return (
                          <>
                            <div>
                              <div className="text-[11px] opacity-60 mb-1">Ciclo attivo — denaro investito operativamente ({fmt1(d.cicloAttivo)} gg)</div>
                              <div className="flex h-9 rounded overflow-hidden border" style={{ borderColor: LINE }}>
                                <div style={{ width: W(d.ggScorte), background: AMBER }} className="flex items-center justify-center text-[10px] text-white font-semibold px-1 overflow-hidden whitespace-nowrap">Scorte · {fmt1(d.ggScorte)} gg</div>
                                <div style={{ width: W(d.ggClienti), background: BLUE }} className="flex items-center justify-center text-[10px] text-white font-semibold px-1 overflow-hidden whitespace-nowrap">Crediti · {fmt1(d.ggClienti)} gg</div>
                              </div>
                              <div className="flex justify-between text-[10px] opacity-60 mt-0.5"><span>Acquisto fattori</span><span>Vendita</span><span>Riscossione</span></div>
                            </div>
                            <div>
                              <div className="text-[11px] opacity-60 mb-1">Ciclo passivo — cassa «risparmiata» grazie ai fornitori ({fmt1(d.ggFornitori)} gg)</div>
                              <div className="flex h-9 rounded overflow-hidden border" style={{ borderColor: LINE }}>
                                <div style={{ width: W(d.ggFornitori), background: GREEN }} className="flex items-center justify-center text-[10px] text-white font-semibold px-1 overflow-hidden whitespace-nowrap">Fornitori · {fmt1(d.ggFornitori)} gg</div>
                                {gap > 0 && <div style={{ width: W(gap), background: RED }} className="flex items-center justify-center text-[10px] text-white font-semibold px-1 overflow-hidden whitespace-nowrap">GAP · {fmt1(gap)} gg</div>}
                              </div>
                              <div className="flex justify-between text-[10px] opacity-60 mt-0.5"><span>Acquisto fattori</span><span>Pagamento acquisti</span><span>{gap > 0 ? "Riscossione" : ""}</span></div>
                            </div>
                            <p className="text-xs opacity-70">
                              {gap > 0
                                ? "Il tratto rosso è l'intervallo cruciale tra il pagamento degli acquisti e la riscossione delle vendite: il tempo in cui l'azienda deve anticipare liquidità di tasca propria o farsela prestare. Più è lungo, maggiore è il fabbisogno."
                                : "Qui il gap è nullo o negativo: si incassa dalle vendite prima di pagare i fornitori, quindi il ciclo operativo genera cassa anziché assorbirla."}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 mb-4">
                      {detCiclo.map((m) => (
                        <CardInd key={m.nome} m={m} onOpen={setDettaglio} />
                      ))}
                    </div>
                    <div className="rounded-lg border p-4" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                      <Badge level="ok" text={`Verifica del paradosso della ponderazione: (${fmt(d.fat)} / 360) × ${fmt1(d.cicloPond)} gg = ${fmt(d.ccncVerifica)} = CCNc contabile ${fmt(d.ccnc)}`} />
                      <p className="text-xs mt-2 opacity-70">
                        Il ciclo semplice può indicare copertura perfetta anche quando esiste un fabbisogno reale, perché somma
                        giorni calcolati su basi diverse (fatturato, consumi, acquisti). Solo il ciclo <b>ponderato</b> — con
                        scorte × {pct(d.cons / d.fat)} (peso dei consumi sul fatturato) e fornitori × {pct(d.acq / d.fat)} (peso
                        degli acquisti sul fatturato) — spiega esattamente il CCNc in euro: nei {fmt1(d.cicloPond)} giorni realmente
                        «scoperti» si materializzano i {fmt(d.ccnc)} di circolante da finanziare.
                      </p>
                    </div>
                  </section>

                  <section>
                    <H2>Aliquota di circolante e rischio di crescita</H2>
                    <div className="grid md:grid-cols-2 gap-3">
                      <CardInd m={detAliquota} onOpen={setDettaglio} />
                      <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: LINE, background: CARD }}>
                        <div className="text-sm font-semibold">Simulatore: il paradosso della crescita</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm">Se il fatturato cresce del</span>
                          <input type="text" inputMode="decimal" value={det.crescita}
                            onChange={(e) => updDet("crescita", e.target.value)}
                            className="w-16 text-right text-sm px-2 py-1 rounded border outline-none"
                            style={{ borderColor: LINE, background: "#fff", fontFamily: "'IBM Plex Mono', monospace" }} />
                          <span className="text-sm font-semibold">%</span>
                        </div>
                        <p className="text-sm">
                          Fatturato: {fmt(d.fat)} → <b>{fmt(d.fat + d.deltaFat)}</b> (+{fmt(d.deltaFat)}).
                          A parità di politiche commerciali, il CCNc cresce proporzionalmente di{" "}
                          <b style={{ color: d.deltaCcnc >= 0 ? RED : GREEN, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(d.deltaCcnc)}</b>:
                          {d.deltaCcnc >= 0 ? " liquidità da anticipare prima di incassare dai nuovi clienti." : " cassa aggiuntiva generata dal ciclo (CCNc negativo)."}
                        </p>
                        <p className="text-xs opacity-70">
                          Il meccanismo del rischio: più vendite → più scorte e più crediti da finanziare → fornitori e stipendi
                          da pagare <i>prima</i> di incassare. Senza riserve di cassa o fidi per coprire il gap, anche un'azienda
                          sana e in crescita può trovarsi senza liquidità («morire di successo», overtrading).
                        </p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <H2>Componente durevole e fluttuante del CCNc</H2>
                    <div className="rounded-lg border p-4 space-y-3 mb-3" style={{ borderColor: LINE, background: CARD }}>
                      <p className="text-xs opacity-70">
                        Comprimere il circolante all'infinito è impossibile e dannoso: il CCNc si divide in una quota{" "}
                        <b>durevole</b> (incomprimibile, legata a vincoli tecnici di processo — es. cantieristica, invecchiamento
                        vini — o competitivi/settoriali — es. dilazioni imposte dalla GDO) e una quota <b>fluttuante</b>{" "}
                        (comprimibile: stagionalità, acquisti speculativi una tantum). Stima qui sotto la ripartizione per il
                        bilancio in esame.
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="text-sm font-semibold whitespace-nowrap">Quota durevole del CCNc:</label>
                        <input type="range" min="0" max="100" value={d.durPct}
                          onChange={(e) => updDet("durevolePct", e.target.value)} className="flex-1 min-w-[140px]" />
                        <span className="text-sm font-semibold w-12 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(d.durPct)}%</span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="rounded border p-3" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                          <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>Durevole (incomprimibile)</div>
                          <div className="text-xl mb-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{fmt(d.durevole)}</div>
                          <p className="text-xs opacity-70">Fabbisogno costante che non si azzera mai durante l'anno: va coperto con <b>capitali permanenti</b> (patrimonio netto e debiti a medio-lungo termine). Finanziarlo con fidi a breve espone al rischio continuo di mancato rinnovo.</p>
                        </div>
                        <div className="rounded border p-3" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                          <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: BLUE, fontFamily: "'Libre Franklin', sans-serif" }}>Fluttuante (comprimibile)</div>
                          <div className="text-xl mb-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{fmt(d.fluttuante)}</div>
                          <p className="text-xs opacity-70">Picchi temporanei, ciclici o stagionali: vanno coperti con <b>finanziamenti a breve elastici</b> (fidi di cassa, scoperti, anticipo fatture) che si estinguono da soli quando il picco rientra.</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <CardInd m={detSost} onOpen={setDettaglio} />
                      <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                        <span className="text-2xl">💰</span>
                        <p className="text-xs flex-1 min-w-[220px]">
                          <b>Collegamento con la valutazione d'impresa (DCF):</b> nel Free Cash Flow la variazione del CCNc entra
                          con segno negativo (FCF = flusso operativo − investimenti − ΔCCNc): un circolante che cresce «congela»
                          liquidità in magazzino e crediti anziché renderla disponibile, riducendo i flussi di cassa futuri e
                          quindi il valore attuale dell'impresa. Agire sui driver del CCNc — dilazioni, rotazione delle scorte,
                          condizioni con i fornitori — significa creare valore, non solo gestire la tesoreria.
                        </p>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <EmptyState onLoad={() => setTab("dati")} />
          ))}

          {tab === "asa" && (hasData ? (
            <>
              <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: LINE, background: "#F1EDFA" }}>
                <span className="text-2xl">🧩</span>
                <div className="text-xs flex-1 min-w-[240px] space-y-1.5">
                  <p>
                    <b>Segment Reporting — riclassificazione per Aree Strategiche d'Affari (ASA / SBU).</b>{" "}
                    Nelle aziende multi-business i dati aggregati compensano e mascherano le dinamiche interne: le ottime
                    performance di un'area possono nascondere le inefficienze di un'altra. Lo «spaccato» per ASA segue tre regole auree:
                  </p>
                  <p><b>1 · Si segmenta l'operatività corrente e strutturale</b> — il CCNc (crediti + scorte − fornitori) e gli investimenti strutturali dedicati vengono imputati direttamente alla ASA che li ha generati.</p>
                  <p><b>2 · Si isolano i valori comuni</b> — gli asset condivisi non allocabili in modo oggettivo (sede centrale, sistemi informatici di gruppo, logistica centralizzata) confluiscono nel <b>COIN Comune</b>. Quadratura: Σ COIN<sub>ASA</sub> + COIN Comune = COIN operativo totale.</p>
                  <p><b>3 · NON si segmenta la finanza</b> (principio di unicità finanziaria) — attività finanziarie, debiti finanziari e patrimonio netto restano esclusivamente a livello corporate: il mix di copertura e il merito creditizio riguardano la società nella sua totalità.</p>
                </div>
              </div>

              <section>
                <H2>Definisci le Aree Strategiche d'Affari</H2>
                <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: LINE, background: CARD }}>
                  <div className="flex flex-wrap gap-2 items-center">
                    {asaList.map((a, i) => (
                      <div key={a.id} className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: LINE, background: "#FDFDFB" }}>
                        <span className="text-xs font-semibold" style={{ color: PURPLE }}>{i + 1}</span>
                        <input type="text" value={a.nome} onChange={(e) => renameAsa(a.id, e.target.value)}
                          className="text-sm px-1 py-0.5 rounded border-0 outline-none w-40" style={{ background: "transparent" }}
                          placeholder={`Nome ASA ${i + 1}`} />
                        {asaList.length > 1 && (
                          <button onClick={() => removeAsa(a.id)} title="Rimuovi ASA (le voci tornano in Comune)"
                            className="text-sm leading-none opacity-50 hover:opacity-100 px-1">×</button>
                        )}
                      </div>
                    ))}
                    {asaList.length < 6 && (
                      <button onClick={addAsa} className="px-3 py-1.5 rounded text-sm font-semibold border border-dashed"
                        style={{ borderColor: PURPLE, color: PURPLE, background: "transparent" }}>
                        + Aggiungi ASA
                      </button>
                    )}
                  </div>
                  <p className="text-xs opacity-60">
                    Rinomina le aree secondo i business reali dell'azienda (es. «Divisione Retail», «Export», «Servizi post-vendita»).
                    Rimuovendo una ASA le sue voci tornano automaticamente in «Comune».
                  </p>
                </div>
              </section>

              <section>
                <H2>Allocazione delle voci operative ({seg.vociSeg.length})</H2>
                <div className="rounded-lg border p-4 flex flex-wrap items-center gap-3 mb-3" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                  <span className="text-2xl">🤖</span>
                  <p className="text-xs flex-1 min-w-[220px]">
                    L'IA può proporre un'allocazione iniziale basandosi sulla denominazione delle voci e sulle informazioni
                    della Nota Integrativa (se caricata). Criterio prudenziale: nel dubbio la voce resta in «Comune».
                    La proposta è sempre modificabile voce per voce.
                  </p>
                  <button onClick={suggerisciAsaAllocazione} disabled={asaAi.loading || !iaAttiva}
                    className="px-4 py-2 rounded font-semibold text-sm flex items-center gap-2"
                    style={{ background: PURPLE, color: "#fff", opacity: asaAi.loading || !iaAttiva ? 0.6 : 1 }}>
                    {asaAi.loading ? <><Spinner /> Allocazione in corso…</> : <>✦ Proponi allocazione con IA</>}
                  </button>
                </div>
                {asaAi.error && <div className="mb-3"><Badge level="bad" text={asaAi.error} /></div>}
                {asaAi.ok && <div className="mb-3"><Badge level="ok" text={asaAi.ok} /></div>}
                <div className="rounded-lg border overflow-x-auto" style={{ borderColor: LINE, background: CARD }}>
                  <table className="w-full text-sm" style={{ minWidth: 560 }}>
                    <thead>
                      <tr className="text-xs uppercase tracking-wider" style={{ background: PAPER, fontFamily: "'Libre Franklin', sans-serif" }}>
                        <th className="text-left px-4 py-2.5 font-semibold">Voce operativa</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Classe</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Importo</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Destinazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seg.vociSeg.map((v) => {
                        const dest = asaMap[v.id] && [...asaList.map((a) => a.id), "comune"].includes(asaMap[v.id]) ? asaMap[v.id] : "comune";
                        return (
                          <tr key={v.id} className="border-t" style={{ borderColor: LINE, background: dest === "comune" ? "#FDFDFB" : "#F7F4FC" }}>
                            <td className="px-4 py-2">{v.nome}</td>
                            <td className="px-4 py-2 text-xs opacity-70">{CLASSI[v.classe]?.area} — {v.sezione === "attivo" ? "attivo" : "passivo"}</td>
                            <td className="px-4 py-2 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(parse(v.importo))}</td>
                            <td className="px-4 py-2">
                              <select value={dest} onChange={(e) => setAlloc(v.id, e.target.value)}
                                className="text-sm px-2 py-1 rounded border outline-none w-full" style={selectStyle}>
                                <option value="comune">Comune (condiviso)</option>
                                {asaList.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs mt-2 opacity-60">
                  Compaiono qui solo le classi operative (magazzino, crediti e altre attività correnti, immobilizzazioni
                  operative, debiti operativi correnti e strutturali). Gestione accessoria, attività finanziarie, debiti
                  finanziari e patrimonio netto sono esclusi per costruzione (regola 3) e restano nel riquadro corporate più sotto.
                </p>
              </section>

              <section>
                <H2>Matrice di Segment Reporting</H2>
                <div className="rounded-lg border overflow-x-auto" style={{ borderColor: LINE, background: CARD }}>
                  <table className="w-full text-sm" style={{ minWidth: 640 }}>
                    <thead>
                      <tr className="text-xs uppercase tracking-wider" style={{ background: INK, color: "#fff", fontFamily: "'Libre Franklin', sans-serif" }}>
                        <th className="text-left px-4 py-2.5 font-semibold">Grandezza</th>
                        {seg.cols.map((c) => (
                          <th key={c.dst} className="text-right px-4 py-2.5 font-semibold" style={{ color: c.dst === "comune" ? "#F3C96B" : "#fff" }}>
                            {c.nome}
                          </th>
                        ))}
                        <th className="text-right px-4 py-2.5 font-semibold" style={{ background: "#0D1830" }}>Totale</th>
                      </tr>
                    </thead>
                    <tbody style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {[
                        { l: "+ Crediti e altre attività correnti", k: "cred" },
                        { l: "+ Rimanenze di magazzino", k: "mag" },
                        { l: "− Debiti operativi correnti", k: "passC", neg: true },
                        { l: "= CCNc di segmento", k: "ccnc", tot: true },
                        { l: "+ Immobilizzazioni operative dedicate", k: "immob" },
                        { l: "− Passività operative strutturali", k: "passNC", neg: true },
                        { l: "= COIN di segmento", k: "coin", tot: true, hl: true },
                      ].map((row) => (
                        <tr key={row.k} className="border-t" style={{ borderColor: LINE, background: row.hl ? "#F1EDFA" : row.tot ? "#FAFBF8" : "transparent" }}>
                          <td className="px-4 py-2 text-left" style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: row.tot ? 600 : 400 }}>{row.l}</td>
                          {seg.cols.map((c) => {
                            const v = row.neg ? -c[row.k] : c[row.k];
                            return (
                              <td key={c.dst} className="px-4 py-2 text-right" style={{ fontWeight: row.tot ? 600 : 400, color: row.tot ? (c[row.k] >= 0 ? INK : RED) : "inherit" }}>
                                {fmt(v)}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right" style={{ fontWeight: row.tot ? 700 : 400, background: "#FAFBF8" }}>
                            {fmt(row.neg ? -seg.tot[row.k] : seg.tot[row.k])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <Badge level={seg.quadraturaOk ? "ok" : "bad"}
                    text={seg.quadraturaOk
                      ? `Quadratura verificata: Σ COIN ASA + COIN Comune = ${fmt(seg.tot.coin)} = COIN operativo aggregato`
                      : `Quadratura non verificata: Σ COIN segmenti = ${fmt(seg.tot.coin)} ≠ COIN operativo ${fmt(r.cinOper)}`} />
                  <Badge level="info" text={`${seg.nAssegnate} voci allocate alle ASA · ${seg.vociSeg.length - seg.nAssegnate} in Comune`} />
                </div>
              </section>

              <section>
                <H2>Livello corporate — non segmentato</H2>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: INK, background: CARD }}>
                  <div className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-white"
                    style={{ background: BLUE, fontFamily: "'Libre Franklin', sans-serif" }}>
                    Principio di unicità finanziaria — resta a livello di società
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { l: "Gestione accessoria", v: r.accessori, d: "Immobili civili, partecipazioni non strategiche, investimenti patrimoniali" },
                      { l: "Attività finanziarie", v: r.attFin, d: "Liquidità immediate, titoli e crediti finanziari" },
                      { l: "Debiti finanziari (PFN lorda)", v: r.debFin, d: "Banche, mutui, obbligazioni: breve e medio-lungo" },
                      { l: "Patrimonio netto", v: r.pn, d: "Capitale, riserve, risultato d'esercizio" },
                    ].map((x, i) => (
                      <div key={x.l} className="p-4 border-t sm:border-t-0" style={{ borderColor: LINE, borderLeft: i ? `1px solid ${LINE}` : "none" }}>
                        <div className="text-xs uppercase tracking-widest font-semibold mb-1 opacity-60" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>{x.l}</div>
                        <div className="text-lg" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{fmt(x.v)}</div>
                        <p className="text-[11px] opacity-60 mt-1">{x.d}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs mt-2 opacity-60 max-w-3xl">
                  Le decisioni sul mix di copertura (capitale di rischio vs capitale di debito) e il merito creditizio
                  riguardano la società nella sua totalità economico-giuridica di fronte al mercato e agli istituti di
                  credito, non le singole divisioni operative interne: per questo la finanza non viene mai spaccata per ASA.
                </p>
              </section>

              <section>
                <H2>Lettura strategica della mappa</H2>
                <div className="grid md:grid-cols-2 gap-3">
                  {seg.cols.map((c) => {
                    const isComune = c.dst === "comune";
                    const quota = seg.tot.coin !== 0 ? c.coin / seg.tot.coin : null;
                    const giud = isComune
                      ? ["info", "Asset condivisi a supporto di tutte le aree: da presidiare come costo di struttura"]
                      : c.coin <= 0 && c.ccnc < 0
                        ? ["ok", "Genera cassa: il ciclo operativo finanzia sé stesso (potenziale cash cow)"]
                        : c.ccnc < 0
                          ? ["ok", "Circolante negativo: la gestione corrente genera risorse per il gruppo"]
                          : quota != null && quota > 0.5
                            ? ["warn", "Assorbe oltre metà del capitale operativo investito: verificare rendimento e rotazione"]
                            : ["info", "Assorbe capitale operativo: da confrontare con la redditività di area"];
                    return (
                      <div key={c.dst} className="rounded-lg border p-4 space-y-2" style={{ borderColor: isComune ? AMBER : LINE, background: CARD }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-semibold">{isComune ? "COIN Comune" : c.nome}</div>
                          {quota != null && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                              style={{ background: "#F1EDFA", color: PURPLE, fontFamily: "'IBM Plex Mono', monospace" }}>
                              {pct(quota)} del COIN
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest opacity-50" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>CCNc</div>
                            <div style={{ fontWeight: 600, color: c.ccnc >= 0 ? INK : GREEN }}>{fmt(c.ccnc)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest opacity-50" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>COIN</div>
                            <div style={{ fontWeight: 600, color: c.coin >= 0 ? INK : GREEN }}>{fmt(c.coin)}</div>
                          </div>
                        </div>
                        <Badge level={giud[0]} text={giud[1]} />
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start mt-3" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                  <span className="text-2xl">🎯</span>
                  <p className="text-xs flex-1 min-w-[220px]">
                    <b>Obiettivo del modello:</b> individuare quali arene competitive stanno assorbendo e «bruciando» liquidità
                    sotto forma di circolante inefficiente o immobilizzazioni improduttive, quali divisioni agiscono da
                    generatori di cassa finanziando lo sviluppo del gruppo, e quale ASA esprime il miglior bilanciamento tra
                    rischio e rendimento. Per completare l'analisi rischio-rendimento, affianca a questa matrice patrimoniale
                    il conto economico di segmento (ricavi ed EBIT per ASA): il rapporto EBIT/COIN di area è il ROI di segmento.
                  </p>
                </div>
              </section>
            </>
          ) : (
            <EmptyState onLoad={() => setTab("dati")} />
          ))}

          {/* ═══ SEZIONE 8 · DATI & NOTA INTEGRATIVA DELL'ESERCIZIO PRECEDENTE ═══ */}
          {tab === "datiPrec" && (
            <>
              <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3" style={{ borderColor: LINE, background: "#EDF3EF" }}>
                <span className="text-2xl">🕰️</span>
                <div className="flex-1 min-w-[260px]">
                  <p className="text-sm font-semibold">Esercizio precedente ({annoPrec}) — estratto automaticamente dai caricamenti iniziali</p>
                  <p className="text-xs opacity-70">
                    I dati dell'anno precedente vengono ricavati <b>automaticamente dalla colonna comparativa</b> dello
                    Stato Patrimoniale e della Nota Integrativa già caricati nelle sezioni 1 e 2: un'apposita fase
                    aggiuntiva del caricamento legge <b>esclusivamente i valori dell'esercizio {annoPrec}</b>, senza
                    bisogno di un secondo upload. I pulsanti qui sotto servono solo se vuoi <b>sovrascrivere</b> questi
                    dati con un documento separato (es. un bilancio a sé). I dati validati alimentano lo{" "}
                    <b>SP riclassificato {annoPrec} (sezione 9)</b> e il <b>motore dei Δ patrimoniali (sezione 10)</b>,
                    necessari al Rendiconto Finanziario (Metodo Indiretto e CAPEX).
                  </p>
                </div>
              </div>

              {/* In Modalità Singolo Anno la colonna comparativa non viene mai
                  letta: questi slot sono l'unico modo di popolare il T-1, e i
                  documenti attesi sono bilanci autonomi di un altro esercizio. */}
              {modalitaSingoloAnno && (
                <div className="rounded-lg border p-4 flex flex-wrap items-start gap-3"
                  style={{ borderColor: AMBER, background: "#FFF8EC" }}>
                  <span className="text-2xl">🎯</span>
                  <div className="flex-1 min-w-[260px]">
                    <p className="text-sm font-semibold">
                      Modalità singolo anno attiva{annoSingoloValido ? ` (T = ${annoRif})` : ""} — il T-1 va caricato a parte
                    </p>
                    <p className="text-xs opacity-70">
                      L'estrazione automatica della colonna comparativa è disattivata: i pulsanti qui sotto non
                      sono una sovrascrittura, ma <b>l'unico modo</b> di popolare queste sezioni. Carica documenti
                      <b> autonomi</b> dell'esercizio {annoRifPrec || "precedente"} (bilancio, Nota Integrativa,
                      Relazione sulla Gestione di quell'anno): l'IA leggerà la <b>colonna principale</b> di quei
                      documenti, non la loro comparativa.
                      {!annoValidoStr(annoSpecificoPrec) && " Indica l'«Anno documenti T-1» in alto per ancorare l'estrazione all'anno giusto."}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-4 flex flex-wrap items-center gap-2" style={{ borderColor: LINE, background: CARD }}>
                <span className="text-xs font-semibold uppercase tracking-widest opacity-60 w-full" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                  {modalitaSingoloAnno ? "Caricamento dei documenti T-1 (documenti autonomi)" : "Sovrascrittura manuale (opzionale)"}
                </span>
                <button onClick={() => spPrecFileRef.current?.click()} disabled={ai.spPrec.loading || !iaAttiva}
                  className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
                  style={{ background: GREEN, color: "#fff", opacity: ai.spPrec.loading || !iaAttiva ? 0.6 : 1 }}>
                  {ai.spPrec.loading ? <><Spinner /> Estrazione SP {annoPrec}…</> : <>📄 Carica SP Precedente (IA)</>}
                </button>
                <button onClick={() => niPrecFileRef.current?.click()} disabled={ai.niPrec.loading || !hasDataPrec || !iaAttiva}
                  title={!hasDataPrec ? "Prima estrai lo Stato Patrimoniale dell'esercizio precedente" : ""}
                  className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
                  style={{ background: BLUE, color: "#fff", opacity: ai.niPrec.loading || !hasDataPrec || !iaAttiva ? 0.6 : 1 }}>
                  {ai.niPrec.loading ? <><Spinner /> Lettura NI {annoPrec}…</> : <>📑 Carica NI Precedente (IA)</>}
                </button>
                <button onClick={() => rgPrecFileRef.current?.click()} disabled={ai.rgPrec.loading || !hasDataPrec || !iaAttiva}
                  title={!hasDataPrec ? "Prima estrai lo Stato Patrimoniale dell'esercizio precedente" : ""}
                  className="px-3 py-1.5 text-sm rounded font-semibold flex items-center gap-2"
                  style={{ background: PURPLE, color: "#fff", opacity: ai.rgPrec.loading || !hasDataPrec || !iaAttiva ? 0.6 : 1 }}>
                  {ai.rgPrec.loading ? <><Spinner /> Lettura RG {annoPrec}…</> : <>📎 Carica RG Precedente (IA)</>}
                </button>
                <p className="text-[11px] opacity-50 w-full">
                  Usa questi pulsanti solo per caricare un documento separato dell'anno precedente: il prompt IA estrae
                  comunque <b>esclusivamente la colonna dell'anno precedente</b> per lo SP e filtra la Nota Integrativa
                  <b> cercando i dati riferiti all'esercizio precedente</b>. In assenza di sovrascrittura valgono i dati
                  estratti automaticamente dai caricamenti delle sezioni 1 e 2.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {ai.spPrec.ok && <Badge level="ok" text={ai.spPrec.ok} />}
                {ai.spPrec.error && <Badge level="bad" text={`SP ${annoPrec}: ${ai.spPrec.error}`} />}
                {ai.niPrec.ok && <Badge level="ok" text={ai.niPrec.ok} />}
                {ai.niPrec.error && <Badge level="bad" text={`NI ${annoPrec}: ${ai.niPrec.error}`} />}
                {ai.rgPrec.ok && <Badge level="ok" text={ai.rgPrec.ok} />}
                {ai.rgPrec.error && <Badge level="bad" text={`RG ${annoPrec}: ${ai.rgPrec.error}`} />}
                {hasDataPrec && (quadraPrec
                  ? <Badge level="ok" text={`Quadratura contabile ${annoPrec}: attivo ${fmt(rPrec.totAttivoContab)} = passivo ${fmt(rPrec.totPassivoContab)}`} />
                  : <Badge level="bad" text={`${annoPrec}: attivo ${fmt(rPrec.totAttivoContab)} ≠ passivo ${fmt(rPrec.totPassivoContab)} (sbilancio ${fmt(sbilancioPrec)})`} />)}
                {hasDataPrec && nNonClassPrec > 0 && (
                  <Badge level="warn" text={`${nNonClassPrec} voci ${annoPrec} da classificare (attivo ${fmt(rPrec.nonClassAtt)}, passivo ${fmt(rPrec.nonClassPass)}): escluse dai calcoli e dai Δ finché non assegnate`} />
                )}
              </div>

              {hasDataPrec ? (
                <>
                  <section className="grid lg:grid-cols-2 gap-4 items-start">
                    <VociTable sezione="attivo" tone={GREEN} prec />
                    <VociTable sezione="passivo" tone={RED} prec />
                  </section>

                  {/* Impatti della NI precedente sui dati */}
                  {(niFiltroPrec?.applicato || niOssPrec.length > 0) ? (
                    <section className="space-y-4">
                      <H2>Nota Integrativa {annoPrec} — informazioni e impatto sui dati</H2>
                      <div className="grid lg:grid-cols-2 gap-4 items-start">
                        <div className="space-y-4">
                          {niFiltroPrec?.applicato && niFiltroPrec.estratti.filter((x) => x.incluso).length > 0 ? (
                            <SectionCard title={`Informazioni estratte (esercizio ${annoPrec})${niFiltroPrec.pagine.length ? ` · pagine ${niFiltroPrec.pagine.join(", ")}` : ""}`} tone={BLUE}>
                              {niFiltroPrec.estratti.filter((x) => x.incluso).map((x, i) => (
                                <div key={x.id} className="py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                                  <div className="text-xs font-semibold">{x.tema}{x.pagina != null ? <span className="opacity-50 font-normal"> · pagina {x.pagina}</span> : null}</div>
                                  <div className="text-xs opacity-70 mt-0.5">{x.contenuto}</div>
                                </div>
                              ))}
                            </SectionCard>
                          ) : (
                            <Badge level="info" text="Nessuna informazione non-financial estratta per l'esercizio precedente." />
                          )}
                          {niOssPrec.length > 0 && (
                            <SectionCard title={`Osservazioni ${annoPrec} — garanzie, impegni, rischi`} tone={INK}>
                              {niOssPrec.map((o, i) => (
                                <div key={i} className="flex gap-2 py-1.5 text-sm" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                                  <span style={{ color: BLUE }}>▸</span>
                                  <span>{o}</span>
                                </div>
                              ))}
                            </SectionCard>
                          )}
                        </div>

                        <div className="space-y-4">
                          {niImpattoPrec && (niImpattoPrec.riclass.length > 0 || niImpattoPrec.scomp.length > 0) ? (
                            <>
                              {niImpattoPrec.riclass.length > 0 && (
                                <SectionCard title={`Riclassificazioni applicate alle voci ${annoPrec}`} tone={AMBER}>
                                  {niImpattoPrec.riclass.map((x, i) => (
                                    <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                        <span className="text-sm font-semibold">{x.nome}</span>
                                        <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(x.importo)}</span>
                                      </div>
                                      <div className="flex items-center gap-2 flex-wrap mt-1.5">
                                        <ClasseChip code={x.classePrima} />
                                        <span className="text-xs opacity-40">→</span>
                                        <ClasseChip code={x.classeDopo} />
                                      </div>
                                      {x.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {x.motivo}</div>}
                                    </div>
                                  ))}
                                </SectionCard>
                              )}
                              {niImpattoPrec.scomp.length > 0 && (
                                <SectionCard title={`Scomposizioni applicate alle voci ${annoPrec}`} tone={PURPLE}>
                                  {niImpattoPrec.scomp.map((s, i) => (
                                    <div key={i} className="py-2" style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}>
                                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                        <span className="text-sm font-semibold">{s.originale}</span>
                                        <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.importoOrig)}</span>
                                      </div>
                                      <div className="text-xs opacity-40 my-1">si scompone in:</div>
                                      <div className="space-y-1.5 pl-2">
                                        {s.parti.map((p, j) => (
                                          <div key={j} className="flex items-baseline justify-between gap-2 flex-wrap">
                                            <span className="flex items-center gap-1.5 flex-wrap">
                                              <span className="text-xs opacity-40">•</span>
                                              <span className="text-sm">{p.nome}</span>
                                              <ClasseChip code={p.classe} />
                                            </span>
                                            <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.importo)}</span>
                                          </div>
                                        ))}
                                        {s.residuo > 0 && (
                                          <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                            <span className="flex items-center gap-1.5 flex-wrap">
                                              <span className="text-xs opacity-40">•</span>
                                              <span className="text-sm opacity-70">{s.originale} (residuo)</span>
                                              <ClasseChip code={s.classeOrig} />
                                            </span>
                                            <span className="text-sm opacity-70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.residuo)}</span>
                                          </div>
                                        )}
                                      </div>
                                      {s.motivo && <div className="text-xs opacity-70 mt-1.5">↪ {s.motivo}</div>}
                                    </div>
                                  ))}
                                </SectionCard>
                              )}
                              {niImpattoPrec.scartate > 0 && (
                                <Badge level="warn" text={`${niImpattoPrec.scartate} proposte dell'IA scartate per incoerenza.`} />
                              )}
                            </>
                          ) : (
                            <Badge level="ok" text={`La Nota Integrativa ${annoPrec} non ha comportato spostamenti di classe né scomposizioni: le voci restano invariate.`} />
                          )}
                        </div>
                      </div>
                    </section>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                      <p className="font-semibold mb-1">Nota Integrativa {annoPrec} non ancora caricata</p>
                      <p className="text-sm opacity-70">
                        Usa il pulsante «📑 Carica NI Precedente (IA)» qui sopra: l'IA filtrerà il documento cercando i
                        dati riferiti all'esercizio precedente e ne applicherà l'impatto (riclassificazioni e
                        scomposizioni) alle voci di questa sezione.
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: LINE, background: CARD }}>
                    <div className="text-sm">
                      <span className="font-semibold">Validazione {annoPrec}: </span>
                      {nNonClassPrec > 0
                        ? <span style={{ color: "#8A6414" }}>{nNonClassPrec} voci ancora da classificare (evidenziate in giallo).</span>
                        : quadraPrec
                        ? <span style={{ color: GREEN }}>tutte le voci classificate e bilancio in quadratura.</span>
                        : <span style={{ color: RED }}>voci classificate ma il bilancio non quadra: controlla gli importi.</span>}
                    </div>
                    <button onClick={() => setTab("spPrec")} disabled={nNonClassPrec > 0}
                      className="px-5 py-2 rounded font-semibold text-sm"
                      style={{ background: nNonClassPrec > 0 ? "#9CA3AF" : INK, color: "#fff" }}>
                      ✓ Vai allo SP riclassificato {annoPrec} →
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                  <p className="font-semibold mb-1">Nessun dato dell'esercizio precedente</p>
                  <p className="text-sm opacity-70 mb-4">
                    I dati del {annoPrec} si estraggono automaticamente quando carichi lo Stato Patrimoniale nella{" "}
                    <b>sezione 1</b> (la fase aggiuntiva legge la colonna comparativa). Se il bilancio non contiene la
                    colonna dell'anno precedente, puoi caricare un documento separato qui sotto.
                  </p>
                  <div className="flex gap-2 justify-center flex-wrap">
                    <button onClick={() => setTab("dati")} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
                      ← Vai alla sezione 1 (caricamento SP)
                    </button>
                    <button onClick={() => spPrecFileRef.current?.click()} className="px-4 py-2 rounded font-semibold text-sm border" style={{ borderColor: INK, color: INK }}>
                      📄 Carica SP Precedente a parte (IA)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══ SEZIONE 9 · SP RICLASSIFICATO DELL'ESERCIZIO PRECEDENTE ═══ */}
          {tab === "spPrec" && (hasDataPrec ? (
            <section>
              {nNonClassPrec > 0 && (
                <div className="mb-4">
                  <Badge level="warn" text={`${nNonClassPrec} voci non classificate sono escluse da questo prospetto: torna alla sezione 8 per assegnarle.`} />
                </div>
              )}
              <div className="mb-4">
                <H2>Stato Patrimoniale riclassificato {annoPrec} — criterio di pertinenza gestionale</H2>
              </div>
              <div className="rounded-lg border p-4 mb-4 flex flex-wrap gap-4 items-center" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                <span className="text-2xl">🎯</span>
                <p className="text-xs flex-1 min-w-[260px]">
                  <b>Gemello della sezione 3, alimentato dai dati dell'esercizio precedente ({esercizioPrec || annoPrec}):</b>{" "}
                  stessa architettura per pertinenza gestionale (core business, gestione accessoria, gestione finanziaria),
                  stessa quadratura Impieghi = Fonti. Confrontandolo con la sezione 3 leggi l'evoluzione della struttura
                  patrimoniale tra i due esercizi; i Δ esatti sono nella sezione 10.
                </p>
              </div>
              <TabelleAree r={rPrec} />

              <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
                <SectionCard title={`Impieghi ${annoPrec} — Capitale investito per area di gestione`} tone={GREEN}>
                  <div className="text-[11px] uppercase tracking-widest pt-1 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: GREEN }}>
                    A · Gestione caratteristica — core business
                  </div>
                  <GruppoVoci voci={rPrec.of("att_op_magazzino", "att_op_corrente")} subtot={rPrec.attOpCorrTot}
                    subtotLabel="Attività operative correnti" color={GREEN} segno="+" />
                  <GruppoVoci voci={rPrec.of("pass_op_corrente")} subtot={rPrec.passOpCorr}
                    subtotLabel="Passività operative correnti" color={GREEN} segno="−" />
                  <div style={{ borderTop: `1px solid ${LINE}` }}>
                    <Row label="CAPITALE CIRCOLANTE NETTO OPERATIVO (CCNO)" value={rPrec.ccno} bold color={GREEN} />
                  </div>
                  <GruppoVoci voci={rPrec.of("att_op_immobilizzata")} subtot={rPrec.immobOper}
                    subtotLabel="Attivo operativo immobilizzato" color={GREEN} segno="+" />
                  <GruppoVoci voci={rPrec.of("pass_op_non_corrente")} subtot={rPrec.passOpNC}
                    subtotLabel="Passività operative non correnti" color={GREEN} segno="−" />
                  <div style={{ borderTop: `1px solid ${LINE}` }}>
                    <Row label="CAPITALE INVESTITO NEL CORE BUSINESS (CIN)" value={rPrec.cinOper} bold color={GREEN} />
                  </div>

                  <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: PURPLE }}>
                    B · Gestione accessoria — patrimoniale
                  </div>
                  <GruppoVoci voci={rPrec.of("att_accessoria")} subtot={rPrec.accessori}
                    subtotLabel="Impieghi accessori" color={PURPLE} segno="+" />

                  <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: BLUE }}>
                    C · Gestione finanziaria — investimento di risorse
                  </div>
                  <GruppoVoci voci={rPrec.of("att_fin_liquidita", "att_fin_altre")} subtot={rPrec.attFin}
                    subtotLabel="Attività finanziarie totali" color={BLUE} segno="+" />

                  <div style={{ borderTop: `2px solid ${INK}` }}>
                    <Row label="TOTALE CAPITALE INVESTITO (A + B + C)" value={rPrec.totImpieghiFun} bold />
                  </div>
                </SectionCard>

                <div className="flex gap-3 justify-center items-end py-2">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-20 h-64 rounded overflow-hidden flex flex-col border" style={{ borderColor: LINE }}>
                      {barSeg(Math.max(rPrec.cinOper, 0), rPrec.totImpieghiFun, "#2C6E54", "Core business")}
                      {barSeg(rPrec.accessori, rPrec.totImpieghiFun, "#6D28D9", "Accessoria")}
                      {barSeg(rPrec.attFin, rPrec.totImpieghiFun, "#2E5EAA", "Finanziaria")}
                    </div>
                    <span className="text-xs font-semibold">Impieghi {annoPrec}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-20 h-64 rounded overflow-hidden flex flex-col border" style={{ borderColor: LINE }}>
                      {barSeg(rPrec.pn, rPrec.totFontiFun, "#7A2F29", "PN")}
                      {barSeg(rPrec.debFin, rPrec.totFontiFun, "#B3423A", "Debiti fin.")}
                    </div>
                    <span className="text-xs font-semibold">Fonti {annoPrec}</span>
                  </div>
                </div>

                <div className="space-y-4 flex flex-col">
                  <SectionCard title={`Fonti ${annoPrec} — Reperimento delle risorse finanziarie`} tone={RED}>
                    <div className="text-[11px] uppercase tracking-widest pt-1 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: RED }}>
                      Capitale di rischio
                    </div>
                    <GruppoVoci voci={rPrec.of("pn")} subtot={rPrec.pn} subtotLabel="PATRIMONIO NETTO" color={RED} segno="+" />

                    <div className="text-[11px] uppercase tracking-widest pt-3 font-bold" style={{ fontFamily: "'Libre Franklin', sans-serif", color: BLUE }}>
                      Gestione finanziaria — reperimento di risorse
                    </div>
                    <GruppoVoci voci={rPrec.of("pass_fin_corrente", "pass_fin_non_corrente")} subtot={rPrec.debFin}
                      subtotLabel="DEBITI FINANZIARI TOTALI" color={BLUE} segno="+" />

                    <div style={{ borderTop: `2px solid ${INK}` }}>
                      <Row label="TOTALE FONTI FINANZIARIE (PN + Debiti fin.)" value={rPrec.totFontiFun} bold />
                    </div>
                    <div className="mt-2 pt-2" style={{ borderTop: `1px dashed ${LINE}` }}>
                      <Row label="di cui Posizione finanziaria netta (Debiti fin. − Attività fin.)" value={rPrec.pfn} bold color={rPrec.pfn <= 0 ? GREEN : INK} />
                    </div>
                  </SectionCard>

                  <div className="rounded-lg border p-4" style={{ borderColor: LINE, background: CARD }}>
                    {quadraFunPrec
                      ? <Badge level="ok" text={`Quadratura ${annoPrec} verificata: Capitale investito ${fmt(rPrec.totImpieghiFun)} = PN + Debiti finanziari ${fmt(rPrec.totFontiFun)}`} />
                      : <Badge level="warn" text={`${annoPrec}: Capitale investito ${fmt(rPrec.totImpieghiFun)} ≠ Fonti ${fmt(rPrec.totFontiFun)} (differenza ${fmt(rPrec.totImpieghiFun - rPrec.totFontiFun)}): controlla classificazioni e voci non classificate`} />}
                    <p className="text-xs mt-2 opacity-60">
                      Anche per l'esercizio precedente le <b>passività operative</b> sono portate in diminuzione degli
                      impieghi del core business, non tra le fonti: CIN complessivo = PN + PFN. La quadratura
                      attivo = passivo del prospetto contabile è verificata nella sezione 8.
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-center mt-6">
                <button onClick={() => setTab("delta")} className="px-5 py-2 rounded font-semibold text-sm"
                  style={{ background: INK, color: "#fff" }}>
                  Vai a indici {annoPrec} e Δ patrimoniali →
                </button>
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
              <p className="font-semibold mb-1">Nessun dato dell'esercizio precedente</p>
              <p className="text-sm opacity-70 mb-4">Carica prima lo Stato Patrimoniale dell'anno precedente nella sezione 8.</p>
              <button onClick={() => setTab("datiPrec")} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
                ← Vai a dati & NI {annoPrec}
              </button>
            </div>
          ))}

          {/* ═══ SEZIONE 10 · INDICI ANNO PRECEDENTE & MOTORE DEI DELTA (PONTE RENDICONTO) ═══ */}
          {tab === "delta" && (hasDataPrec ? (
            <>
              {/* ── BLOCCO A · Indici dell'esercizio precedente (forma compatta) ── */}
              <section>
                <H2>Blocco A — Margini e indici {annoPrec} (forma compatta)</H2>
                <p className="text-sm opacity-70 mb-3">
                  Gli stessi indicatori di solidità e liquidità della sezione 4, calcolati sui dati validati
                  dell'esercizio {esercizioPrec || annoPrec} (senza analisi forense, riservata all'esercizio corrente).
                </p>
                {[...new Set(CONFRONTO_ROWS.map((x) => x.sez))].map((sezione) => (
                  <div key={sezione} className="mb-4">
                    <div className="text-xs uppercase tracking-widest mb-2 font-semibold"
                      style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>
                      {sezione}
                    </div>
                    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: LINE, background: CARD }}>
                      <table className="w-full text-sm" style={{ minWidth: 560 }}>
                        <tbody>
                          {CONFRONTO_ROWS.filter((x) => x.sez === sezione).map((row, k) => {
                            const v = rPrec[row.k];
                            const lev = row.lev(v);
                            return (
                              <tr key={row.k} style={{ borderTop: k ? `1px solid ${LINE}` : "none" }}>
                                <td className="px-4 py-2 font-medium">{row.nome}</td>
                                <td className="px-4 py-2 text-right w-28 whitespace-nowrap"
                                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                                  {row.f(v)}
                                </td>
                                <td className="px-4 py-2 w-10">
                                  <span className="inline-block w-2 h-2 rounded-full" title={lev}
                                    style={{ background: { ok: GREEN, warn: AMBER, bad: RED, info: "#9CA3AF" }[lev] || "#9CA3AF" }} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>

              {/* ── BLOCCO B · Motore dei Delta — preparazione Rendiconto ── */}
              <section>
                <H2>Blocco B — Motore dei Δ patrimoniali (ponte verso il Rendiconto Finanziario)</H2>
                {hasData ? (
                  <>
                    <p className="text-sm opacity-70 mb-3">
                      Dashboard interattiva dei Δ patrimoniali tra {annoCorr} e {annoPrec}: clicca su ogni card per
                      vedere il calcolo esatto (saldo corrente − saldo precedente) e il suo ruolo nel Rendiconto
                      Finanziario.
                    </p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      {deltaCards.map((c) => (
                        <CardInd key={c.nome} m={c} onOpen={setDettaglio} />
                      ))}
                    </div>

                    <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start mb-4" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                      <span className="text-2xl">🌉</span>
                      <p className="text-xs flex-1 min-w-[240px]">
                        <b>Nota a margine — il motore matematico del Rendiconto:</b> le otto card qui sopra costituiscono
                        il cuore del futuro Rendiconto Finanziario. Il <b>Δ CCNO</b> e il <b>Δ TFR e Fondi</b> alimentano
                        il <b>Metodo Indiretto</b>; il <b>Δ Immobilizzazioni</b> è la base del <b>CAPEX</b> (da
                        rettificare con gli ammortamenti del conto economico); il <b>Δ PFN a breve</b>, il{" "}
                        <b>Δ Debiti Finanziari M/L termine</b> e il <b>Δ Accessori e Finanziari</b> coprono la dinamica
                        finanziaria e degli investimenti accessori; il <b>Δ Patrimonio Netto</b> riflette utile e
                        movimenti con i soci; il <b>Δ Liquidità Immediata</b> è la quadratura assoluta (failsafe) a cui
                        la somma di tutti i flussi dovrà coincidere. Queste variazioni vengono <b>esportate via JSON</b>{" "}
                        con il pulsante qui sotto (o «💾 Salva dati (JSON)» in alto) per alimentare il calcolo del Rendiconto
                        Finanziario.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={salvaDati} className="px-5 py-2 rounded font-semibold text-sm"
                        style={{ background: GREEN, color: "#fff" }}>
                        💾 Esporta JSON con Δ patrimoniali (ponte Rendiconto)
                      </button>
                      {!quadra && <Badge level="warn" text={`Il bilancio ${annoCorr} non quadra: verifica i dati prima di esportare i Δ.`} />}
                      {!quadraPrec && <Badge level="warn" text={`Il bilancio ${annoPrec} non quadra: verifica i dati prima di esportare i Δ.`} />}
                      {(nNonClass > 0 || nNonClassPrec > 0) && (
                        <Badge level="warn" text={`Voci non classificate (${nNonClass} nel ${annoCorr}, ${nNonClassPrec} nel ${annoPrec}) sono escluse dai Δ: i valori potrebbero essere incompleti.`} />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                    <p className="font-semibold mb-1">Manca l'esercizio corrente</p>
                    <p className="text-sm opacity-70 mb-3">
                      I Δ patrimoniali richiedono entrambi gli esercizi: carica anche lo Stato Patrimoniale {annoCorr} nella sezione 1.
                    </p>
                    <button onClick={() => setTab("dati")} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
                      ← Vai a dati e validazione {annoCorr}
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
              <p className="font-semibold mb-1">Nessun dato dell'esercizio precedente</p>
              <p className="text-sm opacity-70 mb-4">
                Gli indici {annoPrec} e i Δ patrimoniali richiedono i dati dell'anno precedente: caricali nella sezione 8.
              </p>
              <button onClick={() => setTab("datiPrec")} className="px-4 py-2 rounded font-semibold text-sm" style={{ background: INK, color: "#fff" }}>
                ← Vai a dati & NI {annoPrec}
              </button>
            </div>
          ))}

          {/* ═══ SEZIONE 11 · AUDIT & AUTO-FIX (REVISIONE IA AUTO-APPRENDENTE) ═══ */}
          {tab === "audit" && (
            <section className="space-y-4">
              <H2>Audit & Auto-Fix — la checklist del revisore</H2>
              <p className="text-sm opacity-70">
                Un secondo passaggio dell'IA, in veste di <b>revisore</b>, ricontrolla il lavoro già svolto sui dati
                validati: quadratura e allucinazioni matematiche, coerenza classificatoria tra {annoCorr} e {annoPrec},
                regole IAS/IFRS inviolabili, Δ patrimoniali anomali generati da cambi di classificazione e voci rimaste
                orfane. Ogni anomalia arriva con la <b>correzione applicabile con un clic</b> e con la{" "}
                <b>regola da insegnare al sistema</b>, che viene appesa ai prompt e salvata nel browser: da quel momento
                l'IA non ripeterà più quell'errore, nemmeno su bilanci diversi.
              </p>

              {/* ── Barra comandi ── */}
              <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-center" style={{ borderColor: LINE, background: CARD }}>
                <button
                  onClick={eseguiAudit}
                  disabled={auditState.loading || !iaAttiva || (!hasData && !hasDataPrec)}
                  className="px-5 py-2 rounded font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
                  style={{ background: PURPLE, color: "#fff" }}>
                  {auditState.loading && <Spinner />}
                  {auditState.loading ? "Audit in corso…" : "🔎 Esegui Audit IA"}
                </button>

                <button
                  onClick={resetSystemPrompts}
                  className="px-3 py-1.5 rounded text-xs font-semibold border"
                  style={{ borderColor: LINE, background: "#FDFDFB", color: INK }}
                  title="Svuota il localStorage e ripristina i prompt di sistema originali">
                  ♻ Reset Regole IA
                </button>

                <Badge
                  level={(systemPrompts.regoleApprese || []).length ? "info" : "warn"}
                  text={
                    (systemPrompts.regoleApprese || []).length
                      ? `${systemPrompts.regoleApprese.length} regole apprese e memorizzate nel browser`
                      : "Nessuna regola appresa: i prompt sono quelli di default"
                  }
                />
                {!iaAttiva && <Badge level="bad" text="Nessuna chiave IA configurata sul server: l'audit non è eseguibile." />}
                {!hasDataPrec && hasData && (
                  <Badge level="warn" text={`Esercizio ${annoPrec} assente: i controlli di coerenza tra gli anni e sui Δ non saranno eseguiti.`} />
                )}
                {auditState.data && <Badge level="info" text={`Ultimo audit: ${auditState.data.quando}`} />}
              </div>

              {auditState.error && <Badge level="bad" text={`Audit: ${auditState.error}`} />}

              {/* ── Esito positivo ── */}
              {auditState.data && auditState.data.esito === "superato" && (
                <div className="rounded-lg border p-5 flex gap-4 items-start" style={{ borderColor: GREEN, background: "#E4F1EA" }}>
                  <span className="text-3xl leading-none">✅</span>
                  <div>
                    <p className="font-semibold mb-1" style={{ color: GREEN, fontFamily: "'Libre Franklin', sans-serif" }}>
                      Audit superato — nessuna anomalia rilevata
                    </p>
                    <p className="text-sm">{auditState.data.messaggioGenerale}</p>
                  </div>
                </div>
              )}

              {/* ── Anomalie ── */}
              {auditState.data && auditState.data.esito === "errori" && (
                <>
                  <div className="rounded-lg border p-4 flex gap-4 items-start" style={{ borderColor: RED, background: "#F6E5E3" }}>
                    <span className="text-3xl leading-none">⚠</span>
                    <div>
                      <p className="font-semibold mb-1" style={{ color: RED, fontFamily: "'Libre Franklin', sans-serif" }}>
                        {auditState.data.anomalie.length} anomalie da esaminare
                      </p>
                      <p className="text-sm">{auditState.data.messaggioGenerale}</p>
                      {auditState.data.scartate > 0 && (
                        <p className="text-xs opacity-70 mt-1">
                          {auditState.data.scartate} segnalazioni sono state scartate perché non riconducibili a una voce
                          esistente o perché proponevano una classe incompatibile con la sezione della voce.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {auditState.data.anomalie.map((an, i) => {
                      const az = auditAzioni[i] || {};
                      return (
                        <SectionCard key={`${an.idVoce}_${i}`} title={`${i + 1} · ${an.titoloErrore}`} tone={az.fix ? GREEN : RED}>
                          <div className="py-2 space-y-3">
                            {/* Voce interessata */}
                            <div className="rounded border p-3" style={{ borderColor: LINE, background: "#FDFDFB" }}>
                              <div className="flex flex-wrap gap-2 items-center justify-between mb-1.5">
                                <span className="font-semibold text-sm">{an.nomeVoce}</span>
                                <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(an.importo)}</span>
                              </div>
                              <div className="flex flex-wrap gap-2 items-center">
                                <Badge level="info" text={`Esercizio ${an.esercizio === "corrente" ? annoCorr : annoPrec}`} />
                                <ClasseChip code={an.classeAttuale} />
                                {an.autoFix.eseguibile && (
                                  <>
                                    <span className="text-xs opacity-60">→</span>
                                    <ClasseChip code={an.autoFix.nuovaClasse} />
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Spiegazione */}
                            <p className="text-sm leading-relaxed">{an.spiegazioneErrore}</p>

                            {/* Regola proposta */}
                            {an.promptUpdateSuggestion && (
                              <div className="rounded border p-3 text-xs" style={{ borderColor: LINE, background: "#EAF0F8" }}>
                                <div className="font-semibold mb-1" style={{ color: BLUE }}>
                                  🧠 Regola proposta per i prompt di sistema · target {an.promptUpdateSuggestion.target}
                                </div>
                                <p className="italic leading-relaxed">{an.promptUpdateSuggestion.nuovaRegola}</p>
                              </div>
                            )}

                            {/* Azioni */}
                            <div className="flex flex-wrap gap-2 items-center pt-1">
                              {an.autoFix.eseguibile && (
                                <button
                                  onClick={() => auditCorreggi(an, i)}
                                  disabled={az.fix}
                                  className="px-4 py-2 rounded font-semibold text-sm disabled:opacity-60"
                                  style={{ background: az.fix ? "#9CA3AF" : GREEN, color: "#fff" }}>
                                  {az.fix ? "✓ Risolto" : "✨ Correggi in automatico"}
                                </button>
                              )}
                              {an.promptUpdateSuggestion && (
                                <button
                                  onClick={() => auditInsegna(an, i)}
                                  disabled={az.learn}
                                  className="px-4 py-2 rounded font-semibold text-sm disabled:opacity-60"
                                  style={{ background: az.learn ? "#9CA3AF" : PURPLE, color: "#fff" }}>
                                  {az.learn ? "✓ Regola memorizzata!" : "🧠 Insegna al sistema"}
                                </button>
                              )}
                              {!an.autoFix.eseguibile && (
                                <Badge level="warn" text="Correzione non automatizzabile: intervieni a mano nella sezione dati." />
                              )}
                              {az.fix && (
                                <button
                                  onClick={() => setTab(an.esercizio === "corrente" ? "dati" : "datiPrec")}
                                  className="px-3 py-1.5 rounded text-xs font-semibold border"
                                  style={{ borderColor: LINE, background: "#FDFDFB", color: INK }}>
                                  Verifica nella sezione dati →
                                </button>
                              )}
                            </div>
                          </div>
                        </SectionCard>
                      );
                    })}
                  </div>

                  <div className="rounded-lg border p-4 flex flex-wrap gap-3 items-start" style={{ borderColor: LINE, background: "#F7EEDB" }}>
                    <span className="text-2xl">↩</span>
                    <p className="text-xs flex-1 min-w-[240px]">
                      <b>Dopo le correzioni:</b> ogni auto-fix riporta la voce allo stato «da riconfermare» nella sezione 1,
                      perché margini, indici e Δ patrimoniali vengono ricalcolati. Riesegui l'audit per verificare che le
                      anomalie residue siano rientrate; le regole insegnate agiranno invece sulle <i>prossime</i> estrazioni,
                      non retroattivamente sui dati già in memoria.
                    </p>
                  </div>
                </>
              )}

              {/* ── Registro delle regole apprese ── */}
              {(systemPrompts.regoleApprese || []).length > 0 && (
                <SectionCard title="Memoria del sistema — regole apprese dai prompt" tone={PURPLE}>
                  <div className="py-2 space-y-2">
                    {systemPrompts.regoleApprese.map((rg, k) => (
                      <div key={k} className="rounded border p-2.5 text-xs" style={{ borderColor: LINE, background: "#FDFDFB" }}>
                        <div className="flex flex-wrap gap-2 items-center mb-1">
                          <Badge level="info" text={rg.target} />
                          <span className="opacity-60">{rg.quando}</span>
                        </div>
                        <p className="leading-relaxed">{rg.testo}</p>
                      </div>
                    ))}
                    <p className="text-xs opacity-70 pt-1">
                      Queste regole sono già incorporate nei prompt di sistema e vengono inviate a ogni chiamata IA
                      (estrazione SP, Nota Integrativa, Relazione sulla Gestione). Sono salvate nel localStorage del
                      browser con la chiave <code>{SP_PROMPTS_KEY}</code>: il pulsante «Reset Regole IA» le rimuove tutte.
                    </p>
                  </div>
                </SectionCard>
              )}

              {/* ── Stato iniziale ── */}
              {!auditState.data && !auditState.loading && !auditState.error && (
                <div className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "#C4C9BF", background: CARD }}>
                  <p className="font-semibold mb-1">Audit non ancora eseguito</p>
                  <p className="text-sm opacity-70">
                    {hasData || hasDataPrec
                      ? "Avvia il controllo con «Esegui Audit IA»: i dati validati verranno sottoposti alla checklist del revisore in 5 punti."
                      : "Carica e valida almeno un esercizio nella sezione 1 prima di eseguire l'audit."}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
