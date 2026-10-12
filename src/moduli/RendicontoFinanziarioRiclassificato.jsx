import { useState, useRef, useMemo, useEffect, Component } from "react";

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

/* ============================================================
   ERROR BOUNDARY — cattura errori di rendering
   (identico ai moduli SP e CE)
   ============================================================ */

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { errore: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { errore: error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary catturato:", error, errorInfo);
    this.setState({ info: errorInfo });
  }

  render() {
    if (this.state.errore) {
      return (
        <div style={{ padding: "20px", textAlign: "center", fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#dc2626" }}>❌ Errore durante il rendering</h2>
          <p style={{ color: "#666", marginBottom: "10px" }}>
            {this.state.errore.toString()}
          </p>
          <details style={{ textAlign: "left", color: "#999", fontSize: "12px" }}>
            <summary>Dettagli errore (apri per debug)</summary>
            <pre style={{ background: "#f5f5f5", padding: "10px", overflow: "auto" }}>
              {this.state.info?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: "15px", padding: "8px 16px", background: "#0ea5e9", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            🔄 Ricarica pagina
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   RENDICONTO FINANZIARIO RICLASSIFICATO — Metodo Indiretto
   PARTE 1: infrastruttura + Fase 0 + Fase 1 + Sezione 1.
   PARTE 2: Sezione 2 (Nota Integrativa) — rettifiche a partita
   doppia, red flags, auto-avvio con firma.
   PARTE 3: Sezione 3 (Dati SP & CE + quadratura), Sezione 4
   (Riclassificazione a cascata), Sezione 5 (Margini e indici).
   ============================================================ */

/* ---------- Utility (identiche al modulo CE) ---------- */

const fmt = (n) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n || 0);
const pct = (n, base) => (base ? ((n / base) * 100).toFixed(1).replace(".", ",") + "%" : "—");
let _id = 0;
const nuovoId = () => `v${Date.now()}_${_id++}`;

/* formattazione "contabile": negativi tra parentesi (come nei prospetti CE) */
const fmtC = (n) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

/* ---------- CLASSI DI PERTINENZA DEL RENDICONTO ---------- */

const CLASSI_RF = {
  flusso_operativo_corrente: { label: "Flusso operativo corrente",            area: "operativo",            segnoAtteso: null },
  flusso_operativo_fondi:    { label: "Flusso operativo — TFR e Fondi",       area: "operativo",            segnoAtteso: null },
  capex_uscite:              { label: "CAPEX — investimenti (uscite)",        area: "investimenti",         segnoAtteso: -1 },
  capex_entrate:             { label: "CAPEX — disinvestimenti (entrate)",    area: "investimenti",         segnoAtteso: +1 },
  finanza_attiva:            { label: "Gestione finanziaria attiva",          area: "operativo",            segnoAtteso: null },
  finanza_passiva_raccolta:  { label: "Finanza passiva — raccolta debito",    area: "finanziamento_debito", segnoAtteso: +1 },
  finanza_passiva_servizio:  { label: "Finanza passiva — servizio del debito", area: "finanziamento_debito", segnoAtteso: -1 },
  equity_aumenti:            { label: "Equity — aumenti di capitale",         area: "finanziamento_equity", segnoAtteso: +1 },
  equity_dividendi:          { label: "Equity — dividendi e rimborsi",        area: "finanziamento_equity", segnoAtteso: -1 },
  equity_buyback:            { label: "Equity — acquisto azioni proprie",     area: "finanziamento_equity", segnoAtteso: -1 },
  componenti_anomali:        { label: "Componenti anomali / Discontinue",     area: "straordinaria",        segnoAtteso: null },
  effetto_cambi_liquidita:   { label: "Effetto cambi sulle disp. liquide",    area: "riconciliazione",      segnoAtteso: null },
  da_classificare:           { label: "Da classificare",                      area: null,                   segnoAtteso: null },
};


/* ============================================================
   AUDIT DEL REVISORE — utilità a livello di modulo (RF)
   ============================================================
   Motore dei controlli di revisione sulla cascata dei
   flussi: convenzione dei segni, quadratura con i saldi di
   cassa, coerenza di classificazione fra T e T-1, tenuta delle
   rettifiche (scomposizione del debito e storni non monetari)
   e voci rimaste orfane. La parte deterministica sta qui e nel
   componente (auditLocale); l'IA interviene sui casi di
   giudizio (eseguiAuditIA). I due strati confluiscono poi in
   un elenco unico (auditUnificato), rinumerato sulla scala
   canonica in 8 punti di CHECKLIST_RF.
   ============================================================ */

/* Confronto dei nomi voce fra i due esercizi: si ignorano maiuscole, accenti,
   punteggiatura e spazi multipli, perché la stessa posta è raramente trascritta
   in modo identico nelle due colonne del rendiconto. */
const auditNormalizzaNome = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* Vocabolario per dedurre la classe di destinazione di una voce orfana.
   L'ordine conta: le regole più specifiche precedono quelle generiche.
   In particolare i dividendi INCASSATI (finanza attiva) vanno riconosciuti
   prima dei dividendi PAGATI (equity), altrimenti finirebbero fra le uscite. */
const AUDIT_REGOLE_CLASSE_RF = [
  [/(dividend|provent).*(incassat|ricevut|percepit)|dividendi da partecipat/, "finanza_attiva"],
  [/(interess).*(attiv|incassat)|proventi finanziari incassati/, "finanza_attiva"],
  [/(acquist.*azioni proprie|acquisiz.*azioni proprie|riacquist.*azioni|share repurchase|repurchase of.*share|buyback|buy back|treasury share|treasury stock)/, "equity_buyback"],
  [/(dividend|distribuzion.*utili|rimbors.*capital.*soci)/, "equity_dividendi"],
  [/(aumento di capital|versament.*soci|conferiment|sottoscrizion.*capital|emissione.*azioni)/, "equity_aumenti"],
  [/(accension|erogazion|nuovi finanziament|assunzion.*debit|emissione.*obbligaz|raccolta)/, "finanza_passiva_raccolta"],
  [/(rimbors|quota capitale|estinzion|ammortamento mutu|interess.*passiv|oneri finanziari pagati|servizio del debito|canoni.*leasing)/, "finanza_passiva_servizio"],
  [/(disinvestiment|cession|realizzo|vendita.*immobilizz|prezzo di realizzo|proceeds from sale)/, "capex_entrate"],
  [/(investiment|acquisizion|acquist.*immobilizz|capex|capitalizzaz|immobilizzazioni.*acquis)/, "capex_uscite"],
  [/(tfr|trattamento di fine rapporto|utilizzo fondi|accantonament.*fondi|fondi rischi)/, "flusso_operativo_fondi"],
  [/(differenze cambi|effetto cambi|adeguamento cambi)/, "effetto_cambi_liquidita"],
  [/(discontinu|straordinari|non ricorrent|discontinued operation)/, "componenti_anomali"],
  [/(circolante|credit|debit|rimanenz|magazzino|imposte pagate|utile.*esercizio|ammortament|accantonament|flusso.*operativ|gestione reddituale)/, "flusso_operativo_corrente"],
];

const auditSuggerisciClasseRF = (nome) => {
  const n = auditNormalizzaNome(nome);
  if (!n) return null;
  for (const [regola, classe] of AUDIT_REGOLE_CLASSE_RF) if (regola.test(n)) return classe;
  return null;
};

/* Tolleranza di arrotondamento: vedi tolleranzaMilioni (importi in milioni). */

const AREE_RF = {
  operativo:            { label: "Area operativa",              stile: "bg-teal-100 text-teal-800 border-teal-200" },
  investimenti:         { label: "Area investimenti (CAPEX)",   stile: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  finanziamento_debito: { label: "Finanziamento — debito",      stile: "bg-amber-100 text-amber-800 border-amber-200" },
  finanziamento_equity: { label: "Finanziamento — equity",      stile: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  straordinaria:        { label: "Componenti anomali / straordinari", stile: "bg-slate-100 text-slate-800 border-slate-200" },
  riconciliazione:      { label: "Riconciliazione cassa",       stile: "bg-slate-100 text-slate-800 border-slate-200" },
};

/* ============================================================
   CHECKLIST UNIFICATA IN 8 PUNTI
   ============================================================
   I due strati dell'audit — controlli deterministici e revisione
   IA — parlavano due lingue diverse: i primi numeravano i propri
   controlli da 1 a 5, la seconda da 1 a 8, con significati non
   sovrapponibili. Da qui in avanti la scala canonica è UNA sola,
   quella in 8 punti del prompt del revisore; i controlli
   deterministici vi vengono rimappati da CONTROLLO_UNIFICATO.
   ============================================================ */
const CHECKLIST_RF = {
  1: "Inquinamento da Stato Patrimoniale e Conto Economico",
  2: "Duplicazioni e subtotali di sezione",
  3: "Coerenza fra gli esercizi",
  4: "Area di classificazione del flusso (OIC 10 / IAS 7)",
  5: "Convenzione dei segni",
  6: "Tenuta delle rettifiche (scomposizione del debito e poste non monetarie)",
  7: "Quadratura fra flussi e saldi di cassa",
  8: "Voci orfane",
};

/* Vecchia numerazione deterministica (1..5) → scala canonica (1..8) */
const CONTROLLO_UNIFICATO = { 1: 5, 2: 7, 3: 3, 4: 6, 5: 8 };

/* Il campo `sezione` dei rilievi deterministici è testo per l'utente
   («Tab 2 · NI / Tab 3 · RG»): qui viene tradotto nell'id di tab su cui deve
   atterrare il pulsante «Vai al tab». Nel Rendiconto gli id coincidono con la
   numerazione mostrata, a differenza del modulo CE. */
const tabDaSezione = (sezione = "") => {
  const s = String(sezione);
  if (/Tab 7/.test(s)) return 7;
  if (/Tab 2/.test(s)) return 2;
  if (/Tab 3/.test(s)) return 3;
  if (/Tab 9/.test(s)) return 9;
  return 1;
};

const ORDINE_GRAVITA = { grave: 0, medio: 1, info: 2 };

/* ============================================================================
   SISTEMA AUTO-APPRENDENTE — PROMPT DI SISTEMA PERSISTENTI (Tab 10 · Audit)
   ============================================================================
   L'Audit non si limita a produrre una lista di rilievi: ogni anomalia porta
   con sé (a) la correzione applicabile con un clic e (b) la REGOLA
   generalizzabile da memorizzare. Le regole apprese vivono nel localStorage
   del browser e vengono ri-iniettate in TUTTE le estrazioni successive
   (buildRfPrompt e MASTER_PROMPT), così l'IA non ripete l'errore nemmeno su
   bilanci diversi.
   ========================================================================= */

const RF_PROMPTS_KEY = "rf_system_prompts";

/* Regole INVIOLABILI di fabbrica: nascono dalle allucinazioni ricorrenti
   dell'IA sul Rendiconto Finanziario (segni ribaltati dalla tipografia del
   documento, subtotali estratti insieme al dettaglio, saldi patrimoniali
   scambiati per flussi, poste non monetarie trasformate in rettifiche). Non
   sono "apprese": sono cablate nel prompt e NON vengono rimosse dal pulsante
   «Reset Regole IA», che azzera solo ciò che l'audit ha imparato sul campo. */
const REGOLE_RF_INVIOLABILI = [
  "CONVENZIONE DEI SEGNI TASSATIVA: Per i flussi di investimento e finanziamento, le ENTRATE sono POSITIVE e le USCITE sono NEGATIVE. TUTTAVIA, nell'area operativa (Metodo Indiretto), le voci che rettificano l'utile (come Ammortamenti, Accantonamenti, Interessi passivi) NON SONO uscite di cassa, ma storni: mantieni rigorosamente il segno matematico (+ o -) esposto nel documento originale, senza forzarlo a diventare negativo solo perché è un costo.",
  "DIVIETO DI ESTRARRE SUBTOTALI E TOTALI: non estrarre mai righe come «Flusso della gestione reddituale», «Flusso dell'attività di investimento», «Net cash provided by operating activities», «Cash flow from financing activities» o i totali di sezione. Devi estrarre SOLO le voci elementari, altrimenti la quadratura conta due volte gli stessi importi.",
  "ESCLUDI TASSATIVAMENTE le voci che non sono flussi: saldi di Stato Patrimoniale (crediti, debiti, rimanenze in valore assoluto anziché come variazione), voci di Conto Economico non rettificate e le righe di riconciliazione delle disponibilità liquide iniziali e finali, che vanno nei campi dedicati cassaIniziale/cassaFinale e non nell'elenco delle voci.",
  "POSTE NON MONETARIE: le nuove iscrizioni di diritti d'uso (leasing IFRS 16), le conversioni di debito in equity e le altre operazioni puramente patrimoniali NON transitano per la cassa e non vanno mai inserite fra le voci di flusso. Generano al più un estratto informativo, e diventano una rettifica di tipo non_cash solo se il documento afferma esplicitamente che la posta è confluita per errore nei flussi.",
  "ESCLUDI TASSATIVAMENTE l'OTHER COMPREHENSIVE INCOME (OCI): Voci come fair value di derivati (cash flow hedges), differenze di conversione su controllate estere (translation reserve) e ricalcoli attuariali (piani a benefici definiti), inclusi i relativi impatti fiscali (related tax impact), NON sono flussi di cassa. Non estrarre queste voci a meno che non appaiano esplicitamente come storno all'interno dell'area operativa del rendiconto.",
];

const promptsDiDefaultRF = () => ({ regoleApprese: [] });

/* Lettura difensiva: storage disabilitato, JSON corrotto o struttura obsoleta
   dopo un aggiornamento fanno sempre ricadere sui default, mai in crash. */
const caricaSystemPrompts = () => {
  const base = promptsDiDefaultRF();
  try {
    if (typeof window === "undefined" || !window.localStorage) return base;
    const grezzo = window.localStorage.getItem(RF_PROMPTS_KEY);
    if (!grezzo) return base;
    const salvato = JSON.parse(grezzo);
    if (!salvato || typeof salvato !== "object") return base;
    return {
      regoleApprese: Array.isArray(salvato.regoleApprese)
        ? salvato.regoleApprese.filter((r) => r && typeof r.testo === "string" && r.testo.trim())
        : [],
    };
  } catch {
    return base;
  }
};

const scriviSystemPrompts = (p) => {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      window.localStorage.setItem(RF_PROMPTS_KEY, JSON.stringify(p));
  } catch {
    /* quota esaurita o storage negato: la sessione corrente resta comunque valida */
  }
};

/* PURA: restituisce un NUOVO oggetto systemPrompts con la regola appesa, senza
   mutare quello ricevuto (compatibile con lo state immutabile di React). Le
   regole già presenti alla lettera non vengono duplicate. */
function applicaRegolaAppresa(sp, sug) {
  const testo = String(sug?.nuovaRegola || "").trim();
  if (!testo) return sp;
  const gia = (sp.regoleApprese || []).some((r) => r.testo.trim() === testo);
  if (gia) return sp;
  return {
    ...sp,
    regoleApprese: [
      ...(sp.regoleApprese || []),
      {
        testo,
        target: sug.target === "SCHEMI" ? "SCHEMI" : "CLASSI_DOC",
        quando: new Date().toLocaleString("it-IT"),
      },
    ],
  };
}

/* Blocco di regole da anteporre a ogni estrazione: le quattro inviolabili di
   fabbrica più quelle apprese dall'audit. */
function bloccoRegoleRF(regoleApprese = []) {
  const apprese = (regoleApprese || [])
    .map((r) => (typeof r === "string" ? r : r && r.testo))
    .filter((t) => t && String(t).trim());
  const fisse = REGOLE_RF_INVIOLABILI.map((r, i) => `  ${i + 1}. ${r}`).join("\n");
  const bloccoApprese = apprese.length
    ? `\n\n⚠ REGOLE APPRESE DALL'AUDIT DA RISPETTARE TASSATIVAMENTE:\n${apprese
        .map((t, i) => `  ${i + 1}. ${String(t).trim()}`)
        .join("\n")}`
    : "";
  return `\n\n⚠ REGOLE INVIOLABILI DI ESTRAZIONE DEL RENDICONTO FINANZIARIO:\n${fisse}${bloccoApprese}`;
}

/* ---------- Tab 10 · Prompt dell'Audit (checklist del revisore) ----------
   L'IA qui NON riclassifica: CONTROLLA il lavoro già svolto e restituisce
   anomalie ancorate all'id esatto della voce, con autoFix e regola da
   memorizzare. "ELIMINA" e "INVERTI_SEGNO" sono due nuovaClasse speciali: la
   prima significa che la voce non appartiene al Rendiconto (o è un duplicato
   o un subtotale), la seconda che la classe è giusta ma il segno è ribaltato,
   che nel Rendiconto è l'errore più frequente e più distruttivo. */
const buildAuditPromptRF = ({ annoCorr, annoPrec, vociTxt, vociPrecTxt, schemaTxt, classiTxt, regoleTxt, datiTxt }) =>
  `Sei un REVISORE CONTABILE SENIOR incaricato di sottoporre a controllo di qualità una riclassificazione di RENDICONTO FINANZIARIO già eseguita da un altro analista (OIC 10, IAS 7, US GAAP ASC 230). Il tuo compito NON è riclassificare da zero: devi trovare gli ERRORI del lavoro esistente, spiegarli e indicare come correggerli.
${schemaTxt}
FORMATO NUMERICO: tutti gli importi che seguono sono numeri grezzi, con il punto come separatore decimale e NESSUN separatore delle migliaia. Le ENTRATE di cassa sono positive, le USCITE negative.

VOCI DELL'ESERCIZIO CORRENTE ${annoCorr} (formato: [id] nome | importo | classe):
${vociTxt}

VOCI DELL'ESERCIZIO PRECEDENTE ${annoPrec} (stesso formato):
${vociPrecTxt}

CLASSI AMMESSE:
${classiTxt}
${regoleTxt}

CONTESTO ANALITICO COMPLETO (saldi di cassa, rettifiche di Nota Integrativa e Relazione sulla Gestione, cascata calcolata, delta dei flussi e rilievi deterministici già prodotti dall'applicazione):
${datiTxt}

ESEGUI ORA, NELL'ORDINE, QUESTA CHECKLIST DEL REVISORE PER IL RENDICONTO FINANZIARIO:

1) INQUINAMENTO DA STATO PATRIMONIALE E CONTO ECONOMICO — Individua le voci che non sono flussi di cassa: saldi patrimoniali riportati in valore assoluto anziché come variazione (es. "Crediti verso clienti" senza "variazione"), componenti di Conto Economico estranee alla rettifica dell'utile, righe di riconciliazione delle disponibilità liquide iniziali e finali (che appartengono ai campi cassaIniziale/cassaFinale, non all'elenco delle voci). In questi casi la correzione NON è un cambio di classe ma l'eliminazione della voce: usa autoFix con "nuovaClasse": "ELIMINA".

2) DUPLICAZIONI E SUBTOTALI — Segnala i totali di sezione estratti insieme al proprio dettaglio ("Flusso della gestione reddituale", "Net cash provided by operating activities", "Cash flow from investing activities") e le voci di contenuto identico ripetute con id diversi nello stesso esercizio: entrambi fanno contare due volte gli stessi importi e distruggono la quadratura. Indica come anomalia il subtotale o il duplicato da rimuovere (NON l'occorrenza elementare da tenere) e usa autoFix con "nuovaClasse": "ELIMINA".

3) COERENZA TRA GLI ANNI — Lo STESSO flusso (o un flusso di denominazione equivalente) presente in entrambi gli esercizi DEVE avere la STESSA classe, salvo un reale cambiamento di natura. Ogni disallineamento fra ${annoCorr} e ${annoPrec} è un errore: stabilisci quale dei due anni è classificato male e correggi QUELLO SOLTANTO, non entrambi. FCFO, FCFE e i delta confrontano altrimenti perimetri diversi.

4) AREA DI CLASSIFICAZIONE DEL FLUSSO — Verifica che ogni flusso stia nell'area giusta anche quando il segno è corretto. Punti critici: interessi pagati → finanza_passiva_servizio; interessi e dividendi incassati → finanza_attiva; dividendi pagati ai soci → equity_dividendi; riacquisto di azioni proprie → equity_buyback; quota capitale dei canoni di leasing → finanza_passiva_servizio; acquisti e cessioni di immobilizzazioni → capex_uscite / capex_entrate; TFR e utilizzo fondi → flusso_operativo_fondi; differenze cambi sulle disponibilità liquide → effetto_cambi_liquidita, che è una riconciliazione e non un flusso operativo. Un investimento collocato fra i flussi operativi gonfia il FCFO e falsa ogni giudizio sulla capacità di autofinanziamento.

5) CONVENZIONE DEI SEGNI — Regola inviolabile: entrate positive, uscite negative. Le voci in capex_uscite, finanza_passiva_servizio, equity_dividendi ed equity_buyback devono avere importo NEGATIVO; quelle in capex_entrate, finanza_passiva_raccolta ed equity_aumenti devono averlo POSITIVO. Quando la classe è corretta e sbagliato è solo il segno, usa autoFix con "nuovaClasse": "INVERTI_SEGNO".

6) TENUTA DELLE RETTIFICHE — Per le scomposizioni del debito la somma di raccolta (+) e rimborso (−) deve ricostruire esattamente il netto della voce di origine, altrimenti la scomposizione crea o distrugge cassa. Le poste non monetarie (IFRS 16, conversioni debito/equity) vanno trattate come non_cash, con il solo storno e NESSUNA classe di destinazione. Segnala anche le rettifiche che ti aspetteresti di trovare e che mancano.

7) QUADRATURA DELLA CASSA — La differenza fra cassaFinale e cassaIniziale deve coincidere con la somma algebrica dei flussi, al lordo delle rettifiche. In caso di scarto risali alla causa: un flusso saltato in estrazione, un importo letto male, un segno invertito o una voce rimasta orfana ed esclusa dai totali. Segnala LA VOCE che genera lo scarto, non lo scarto in astratto.

8) VOCI ORFANE — Segnala ogni voce rimasta in da_classificare nei due esercizi e proponi la classe corretta desumibile dalla denominazione: finché resta orfana l'importo è escluso da tutti i totali e dalla quadratura.

Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza blocchi di codice:
{
 "esito": "superato",
 "messaggioGenerale": "Testo riassuntivo dell'esito complessivo del controllo, 2-4 frasi.",
 "anomalie": [
  {
   "idVoce": "id esatto della voce errata, copiato dalle parentesi quadre degli elenchi sopra",
   "esercizio": "corrente",
   "titoloErrore": "titolo breve del tipo di errore, es. Segno invertito su un'uscita per investimenti",
   "spiegazioneErrore": "2-4 frasi: perché è un errore, quale punto della checklist viola e quale effetto produce su FCFO, FCFE, quadratura della cassa o delta dei flussi",
   "gravita": "grave",
   "controllo": 5,
   "autoFix": { "eseguibile": true, "nuovaClasse": "codice classe corretto oppure ELIMINA oppure INVERTI_SEGNO" },
   "promptUpdateSuggestion": { "target": "CLASSI_DOC", "nuovaRegola": "Regola operativa da aggiungere ai prompt di sistema affinché l'errore non si ripeta nelle estrazioni future." }
  }
 ]
}
Regole tassative sul formato:
- "esito" vale "superato" SOLO se non hai trovato alcuna anomalia (e allora "anomalie" è un array vuoto); altrimenti vale "errori".
- "idVoce" deve essere un id ESISTENTE copiato letteralmente dagli elenchi: non inventarlo e non usare il nome della voce. Se l'anomalia non è riconducibile a una voce specifica, ometti l'anomalia.
- "esercizio" vale "corrente" se l'id appartiene all'elenco ${annoCorr}, "precedente" se appartiene all'elenco ${annoPrec}.
- "gravita" vale "grave", "medio" o "info"; "controllo" è il numero (1-8) del punto della checklist violato.
- "autoFix.eseguibile" è true SOLO se la correzione consiste nel cambio di classe di quella singola voce, nell'inversione del suo segno o nella sua eliminazione. "nuovaClasse" deve essere uno dei codici classe ammessi elencati sopra, oppure la parola chiave "ELIMINA" (voce estranea al Rendiconto, subtotale o duplicato), oppure la parola chiave "INVERTI_SEGNO" (classe corretta, segno ribaltato). Se invece la correzione richiede una scomposizione, la lettura di un importo dal documento o un intervento manuale, metti "eseguibile": false, ometti "nuovaClasse" e spiega nel testo cosa deve fare l'utente.
- "promptUpdateSuggestion.target" vale "CLASSI_DOC" se la regola riguarda la natura o la definizione delle classi, "SCHEMI" se riguarda una convenzione specifica dello schema contabile (OIC 10, IAS 7, US GAAP). "nuovaRegola" deve essere una frase imperativa, autoconclusiva e generalizzabile (NON riferita a questa singola azienda o a questo singolo importo), massimo 400 caratteri. Ometti l'intero campo se l'errore è un refuso irripetibile e non generalizzabile.
- Massimo 15 anomalie, ordinate per gravità decrescente. Non segnalare come errore una scelta semplicemente opinabile ma difendibile: solo violazioni effettive della checklist.
Rispondi SOLO con il JSON.`;

/* Sanificazione della risposta di audit — funzione PURA e testabile a parte.
   Tiene solo le anomalie ancorate a un id di voce realmente esistente e
   declassa ad "eseguibile: false" ogni autoFix che proponga una classe
   inesistente o identica a quella attuale. "ELIMINA" e "INVERTI_SEGNO" sono
   sempre ammesse — la seconda solo se la voce ha un importo diverso da zero,
   perché invertire il segno di uno zero non è una correzione. */
function sanificaAnomalieRF(parsed, vociCorr, vociPrec) {
  const indice = new Map();
  (vociCorr || []).forEach((v) => indice.set(v.id, { voce: v, esercizio: "corrente" }));
  (vociPrec || []).forEach((v) => indice.set(v.id, { voce: v, esercizio: "precedente" }));

  const visti = new Set();
  return (Array.isArray(parsed?.anomalie) ? parsed.anomalie : [])
    .map((a) => {
      const id = String(a?.idVoce || "").trim();
      const hit = indice.get(id);
      if (!hit) return null;
      const { voce, esercizio } = hit;
      const importo = Number(voce.importo) || 0;
      const nuovaClasse = a?.autoFix?.nuovaClasse;
      const classeOk =
        nuovaClasse === "ELIMINA" ||
        (nuovaClasse === "INVERTI_SEGNO" && importo !== 0) ||
        (!!CLASSI_RF[nuovaClasse] && nuovaClasse !== voce.classe);
      const sug = a?.promptUpdateSuggestion;
      const sugOk = !!sug && typeof sug.nuovaRegola === "string" && sug.nuovaRegola.trim().length > 10;
      const gravita = ["grave", "medio", "info"].includes(a?.gravita) ? a.gravita : "medio";
      const controllo = Number(a?.controllo) >= 1 && Number(a?.controllo) <= 8 ? Number(a.controllo) : null;
      /* una stessa voce non può essere segnalata due volte: la prima vince */
      if (visti.has(id)) return null;
      visti.add(id);
      return {
        idVoce: id,
        esercizio,
        nomeVoce: voce.nome,
        classeAttuale: voce.classe,
        importo,
        titoloErrore: String(a?.titoloErrore || "Anomalia rilevata").trim(),
        spiegazioneErrore: String(a?.spiegazioneErrore || "").trim(),
        gravita,
        controllo,
        autoFix: {
          eseguibile: !!a?.autoFix?.eseguibile && classeOk,
          nuovaClasse: classeOk ? nuovaClasse : null,
        },
        promptUpdateSuggestion: sugOk
          ? { target: sug.target === "SCHEMI" ? "SCHEMI" : "CLASSI_DOC", nuovaRegola: sug.nuovaRegola.trim() }
          : null,
      };
    })
    .filter(Boolean);
}

/* ---------- FASE 0 — Prompt di rilevamento schema ---------- */

const RF_SCHEMA_DETECT_PROMPT = `Sei un analista di bilancio esperto. Ricevi l'estratto di un documento che contiene (o potrebbe contenere) un RENDICONTO FINANZIARIO.

COMPITO: identifica lo schema espositivo del rendiconto, SENZA estrarre le voci.

Schemi possibili:
- "oic10_indiretto": schema OIC 10 con flusso dell'attività operativa determinato con il metodo INDIRETTO (parte dall'utile/perdita dell'esercizio e rettifica per elementi non monetari e variazioni di capitale circolante netto).
- "oic10_diretto": schema OIC 10 con metodo DIRETTO (espone incassi da clienti e pagamenti a fornitori/dipendenti come flussi lordi, senza partire dall'utile).
- "ias7": schema IAS 7 (Statement of Cash Flows internazionale, tre sezioni Operating / Investing / Financing, terminologia IFRS).

Rileva inoltre:
- "valuta": codice ISO della valuta di esposizione (es. "EUR").
- "unita": sempre "milioni" (gli importi vengono estratti in milioni, vedi SCALA DEGLI IMPORTI).
- "indizi": una frase breve con i segnali testuali che ti hanno fatto riconoscere schema e unità.

Se lo schema è "oic10_diretto" segnala nel campo indizi che il documento non espone i margini intermedi del metodo indiretto e che le voci andranno mappate direttamente sui flussi.

Rispondi SOLO con JSON valido, senza markdown né commenti, nel formato:
{"schema":"oic10_indiretto","valuta":"EUR","unita":"milioni","indizi":"..."}`;

/* ---------- FASE 1 — Prompt di estrazione guidato dallo schema ---------- */

/* Blocco tassativo che dirotta l'estrazione sulla COLONNA COMPARATIVA (T-1).
   È volutamente ridondante e ripetuto in testa e in coda al prompt: nei
   rendiconti a due colonne il rischio maggiore è che il modello mescoli le
   due annualità o si "dimentichi" del vincolo dopo migliaia di token. */
const annoValidoStr = (a) => (/^\d{4}$/.test(String(a || "").trim()) ? String(a).trim() : "");

const bloccoPrecRf = (annoPrec = "") => `ESERCIZIO: estrai ESCLUSIVAMENTE la colonna dell'ANNO PRECEDENTE${annoValidoStr(annoPrec) ? ` (${annoValidoStr(annoPrec)})` : ""}, la colonna comparativa. Non mescolarla con l'anno corrente. Estrai anche la cassaIniziale e cassaFinale dell'anno precedente.
- PRIMA di estrarre, individua l'esatta intestazione delle colonne (es. 2025, 2024, 2023).
- Per ogni riga, leggi i numeri scorrendo da sinistra a destra e associa ogni importo all'anno corretto.
- Se la cella corrispondente all'anno richiesto è VUOTA o contiene un trattino, devi estrarre il valore 0. NON copiare mai il valore di un anno adiacente se l'anno richiesto non ha importi.
- Il campo "esercizio" del JSON deve riportare l'ANNO PRECEDENTE, non quello corrente.
- Se il documento espone una sola colonna (nessun comparativo), restituisci "voci": [] con cassaIniziale e cassaFinale null: NON duplicare i valori dell'anno corrente.`;

/* Variante «documento autonomo» del blocco T-1 (Modalità Singolo Anno).
   Quando la serie storica si costruisce a mano — un rendiconto per file — il
   documento caricato negli slot T-1 è il bilancio a sé stante di un altro
   esercizio: l'anno da leggere è la colonna PRINCIPALE, non la comparativa.
   Senza questo ribaltamento l'IA restituirebbe il T-2 o una lista vuota. */
const bloccoPrecRfAutonomo = (annoPrec = "") => `ESERCIZIO — DOCUMENTO AUTONOMO DELL'ANNO PRECEDENTE (Modalità Singolo Anno): il documento che stai analizzando è il rendiconto a sé stante dell'esercizio ${annoValidoStr(annoPrec) || "precedente"}, NON quello dell'anno corrente. Estrai anche la cassaIniziale e cassaFinale di quell'esercizio.
- Estrai i dati dell'esercizio ${annoValidoStr(annoPrec) || "di chiusura di questo documento"}: qui è la colonna PRINCIPALE del prospetto (nei prospetti a due colonne è la PRIMA colonna numerica), NON la comparativa.
- PRIMA di estrarre, individua l'esatta intestazione delle colonne e verifica l'anno di chiusura.
- Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi presenti in questo documento.
- Se la cella dell'anno richiesto è VUOTA o contiene un trattino, estrai il valore 0: non copiare mai il valore di un anno adiacente.
- Il campo "esercizio" del JSON deve riportare l'anno di chiusura effettivamente letto${annoValidoStr(annoPrec) ? ` (atteso: ${annoValidoStr(annoPrec)})` : ""}.
- Se il documento non contiene l'esercizio richiesto, restituisci "voci": [] con cassaIniziale e cassaFinale null anziché ripiegare su un altro anno.`;

function buildRfPrompt(testoBilancio = null, schemaInfo = null, isPrec = false, vincoloAnno = "", regoleApprese = [], modalitaSingoloAnno = false, annoPrecTarget = "") {
  /* In Modalità Singolo Anno lo slot T-1 è alimentato da un documento
     autonomo, non dalla colonna comparativa: il vincolo va ribaltato. */
  const bloccoPrecTesto = modalitaSingoloAnno ? bloccoPrecRfAutonomo(annoPrecTarget) : bloccoPrecRf(annoPrecTarget);
  const bloccoPrec = isPrec ? `\n⚠ VINCOLO TASSATIVO SULL'ANNUALITÀ\n${bloccoPrecTesto}\n` : "";
  const bloccoSchema = schemaInfo?.schema
    ? `\nSCHEMA GIÀ RILEVATO: ${schemaInfo.schema}${schemaInfo.unita ? ` · importi in ${schemaInfo.unita}` : ""}.\n${
        schemaInfo.schema === "oic10_diretto"
          ? "ATTENZIONE: metodo DIRETTO — il documento non espone i margini intermedi del metodo indiretto. Mappa i flussi lordi (incassi da clienti, pagamenti a fornitori e dipendenti…) direttamente sulle classi, aggregandoli nella classe flusso_operativo_corrente per l'area operativa."
          : schemaInfo.schema === "ias7"
          ? "Schema IAS 7: riconduci le tre sezioni Operating/Investing/Financing alle classi sottostanti; presta attenzione agli interessi e ai dividendi, che in IAS 7 possono comparire in sezioni diverse (classificali per natura: interessi pagati → finanza_passiva_servizio; interessi/dividendi incassati → finanza_attiva; dividendi pagati → equity_dividendi)."
          : "Schema OIC 10 indiretto: la sezione A parte dall'utile (perdita) dell'esercizio con le rettifiche per elementi non monetari e le variazioni del capitale circolante netto; estrai le voci della sezione A come classe flusso_operativo_corrente."
      }\n`
    : "";
  return `Sei un analista di bilancio esperto. Ricevi il testo di un RENDICONTO FINANZIARIO (schema OIC 10 — metodo diretto o indiretto — oppure IAS 7).
${vincoloAnno}${bloccoPrec}${bloccoSchema}
COMPITO: estrai TUTTE le voci di flusso originali del rendiconto, ciascuna con il proprio importo (numeri JSON in MILIONI, vedi SCALA DEGLI IMPORTI), e proponi per ciascuna una "classe" tra:
${Object.keys(CLASSI_RF).filter((c) => c !== "da_classificare").map((c) => `- "${c}" (${CLASSI_RF[c].label} · area ${CLASSI_RF[c].area})`).join("\n")}

CONVENZIONI DI SEGNO — TASSATIVE:
- ENTRATE di cassa con importo POSITIVO (+), USCITE di cassa con importo NEGATIVO (−), qualunque sia la convenzione tipografica del documento (parentesi, colonna dare/avere, segno esplicito).
- capex_uscite e finanza_passiva_servizio ed equity_dividendi ed equity_buyback sono quindi tipicamente NEGATIVI; capex_entrate, finanza_passiva_raccolta ed equity_aumenti tipicamente POSITIVI.
- NON invertire il segno per "aggiustare" una classificazione: se il segno di una voce contraddice la sua natura apparente, mantieni il segno del documento e usa la classe "da_classificare".

USO DELLE CLASSI OPERATIVE E STRAORDINARIE:
- "flusso_operativo_fondi": isola le POLITICHE DI AUTO-ASSICURAZIONE, cioè le variazioni monetarie di TFR e fondi rischi/oneri (accantonamenti al netto degli utilizzi, pagamenti di TFR, utilizzo fondi). Usala solo per queste poste specifiche; il resto del ciclo operativo (utile, rettifiche non monetarie, variazioni di CCN) resta in "flusso_operativo_corrente".
- "componenti_anomali": usala per componenti ANOMALI, NON RICORRENTI o da attività DISCONTINUE (plusvalenze/minusvalenze straordinarie confluite nei flussi, indennizzi una tantum, oneri di ristrutturazione, flussi di rami d'azienda in dismissione). Servono a non inquinare i flussi ordinari con eventi eccezionali. Se un flusso è chiaramente ordinario, NON metterlo qui.
- "effetto_cambi_liquidita": se incontri voci relative a differenze cambio o traduzione sulle disponibilità liquide (es. "Translation exchange differences", "Effetto delle variazioni dei cambi sulle disponibilità liquide", "Effect of exchange rate changes on cash"), assegnale TASSATIVAMENTE a questa classe. Sono poste di RICONCILIAZIONE della cassa: non appartengono ai flussi operativi, di investimento o di finanziamento, ma servono a far quadrare la variazione netta delle disponibilità liquide. Mantieni il segno del documento.
- "equity_buyback": riservala AL SOLO riacquisto di azioni proprie ("Acquisto di azioni proprie", "Share repurchase", "Purchase of treasury shares", "Buyback"). È una remunerazione dei soci alternativa al dividendo, ma va tenuta separata perché discrezionale e non ricorrente: i dividendi ordinari restano in "equity_dividendi". L'eventuale RIVENDITA di azioni proprie è invece un'entrata e va in "equity_aumenti".
- "finanza_passiva_servizio" / "finanza_passiva_raccolta" per ATTIVITÀ FINANZIARIE CAPTIVE: Se l'azienda ha una divisione di servizi finanziari (es. finanziamenti per l'acquisto di veicoli), classifica le variazioni dei 'receivables from financing activities' e le relative cartolarizzazioni nell'area finanziaria, per non inquinare il flusso operativo industriale.

REGOLE:
- Estrai solo voci realmente presenti nel documento: NON inventare voci, NON stimare importi mancanti.
- Se una voce è ambigua o non riconducibile con certezza a una classe, usa "da_classificare".
- Ignora i subtotali e i totali di sezione (es. "Flusso finanziario dell'attività operativa (A)"): estrai solo le voci elementari, per evitare doppi conteggi.
- Riporta anche disponibilità liquide iniziali e finali, se presenti, nei campi dedicati "cassaIniziale" e "cassaFinale" (non tra le voci).

${bloccoRegoleRF(regoleApprese)}

VERIFICA FINALE (SELF-CORRECTION):
Prima di generare il JSON, somma algebricamente tutti i flussi che hai estratto. Il totale deve coincidere esattamente con la voce 'Variazione netta delle disponibilità liquide' (Net increase/decrease in cash) stampata nel documento per quell'anno. Se non coincide, ricontrolla di non aver invertito un segno o saltato una riga, e correggi il dato prima di generare l'output.

Rispondi SOLO con JSON valido, senza markdown né commenti, nel formato:
{"schemaRilevato":"oic10_indiretto","azienda":"...","esercizio":"...","valuta":"EUR","unita":"milioni","cassaIniziale":0,"cassaFinale":0,"voci":[{"nome":"...","importo":0,"classe":"..."}]}
${isPrec ? `\nRICORDA — VINCOLO SULL'ANNUALITÀ:\n${bloccoPrecTesto}\n` : ""}${
    testoBilancio
      ? `TESTO DEL RENDICONTO:\n"""\n${testoBilancio}\n"""`
      : `Il rendiconto da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle dei prospetti contabili.`
  }`;
}

/* ---------- Rilevamento schema (chiamata IA separata) ---------- */

async function rilevaSchemaRf({ provider, apiKey, model, fonte }) {
  /* Il riconoscimento dello schema richiede solo le prime pagine: per i PDF
     nativi si invia la PRIMA porzione (ambito equivalente alla versione
     testuale, che si fermava ai primi 15.000 caratteri). */
  if (fonte.tipo === "pdf") {
    const prompt = `${RF_SCHEMA_DETECT_PROMPT}\n\nIl documento da esaminare è il PDF ALLEGATO a questo messaggio: leggilo direttamente.`;
    return parseJsonRobusto(await chiamaIA({ provider, apiKey, model, prompt, pdfBase64: fonte.chunks[0].data }));
  }
  const prompt = `${RF_SCHEMA_DETECT_PROMPT}\n\nDOCUMENTO (estratto):\n"""\n${fonte.testo.slice(0, 15000)}\n"""`;
  return parseJsonRobusto(await chiamaIA({ provider, apiKey, model, prompt }));
}

/* ============================================================
   SEZIONE 2 — NOTA INTEGRATIVA (4 sezioni tematiche del RF)
   ============================================================ */

const NI_SEZIONI_RF = {
  1: { titolo: "Debito finanziario — mutui vs rimborsi",  color: "bg-amber-50 border-amber-200 text-amber-900",     badge: "bg-amber-600" },
  2: { titolo: "Dividendi e rapporti con i soci",         color: "bg-emerald-50 border-emerald-200 text-emerald-900", badge: "bg-emerald-600" },
  3: { titolo: "Operazioni non monetarie (non-cash)",     color: "bg-indigo-50 border-indigo-200 text-indigo-900",  badge: "bg-indigo-600" },
  4: { titolo: "Altre informazioni sulla cassa",          color: "bg-teal-50 border-teal-200 text-teal-900",        badge: "bg-teal-600" },
};

const RF_RETT_TIPI = {
  scomposizione_debito: { label: "Scomposizione debito",  sezione: 1, color: "bg-amber-100 text-amber-700 border-amber-200" },
  dividendi_cassa:      { label: "Dividendi per cassa",   sezione: 2, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  non_cash:             { label: "Storno non-cash",       sezione: 3, color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
};

const RF_FLAG_LABELS = {
  leasing_non_cash: "Leasing / diritti d'uso non monetari nei flussi",
  conversione_debito_equity: "Conversione debito ↔ equity senza cassa",
  dividendi_non_allineati: "Dividendi deliberati ≠ dividendi pagati",
  altro: "Altra anomalia sui flussi di cassa",
};

/* Semaforo a 3 fasce (identico a GRAVITA_STYLE del CE):
   ok/bassa = emerald · warn/media = amber · bad/alta = rose */
const GRAVITA_STYLE = {
  alta: "bg-rose-100 text-rose-700 border-rose-200",
  media: "bg-amber-100 text-amber-700 border-amber-200",
  bassa: "bg-slate-100 text-slate-600 border-slate-200",
};
const SEMAFORO_STYLE = {
  ok:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  warn: "bg-amber-100 text-amber-700 border-amber-200",
  bad:  "bg-rose-100 text-rose-700 border-rose-200",
  info: "bg-slate-100 text-slate-600 border-slate-200",
};

/* ---- Prompt multi-output della Nota Integrativa ---- */

const NI_RF_PROMPT = `Sei un analista di bilancio esperto. Ricevi il testo di una NOTA INTEGRATIVA e devi estrarre ESCLUSIVAMENTE le informazioni utili all'analisi del RENDICONTO FINANZIARIO, organizzate in QUATTRO SEZIONI TEMATICHE. Ogni informazione estratta deve appartenere a UNA sola sezione.

SEZIONE 1 — DEBITO FINANZIARIO (MUTUI vs RIMBORSI). Cerca e estrai:
- accensioni di nuovi finanziamenti, mutui, prestiti obbligazionari nell'esercizio (importi lordi RACCOLTI);
- rimborsi di quote capitale, estinzioni anticipate, scadenze rimborsate nell'esercizio (importi lordi RIMBORSATI);
- interessi pagati (se distinti dagli interessi di competenza), commissioni e oneri accessori del debito;
- piani di ammortamento, covenant, garanzie che qualificano la natura del debito;
- ogni informazione che permetta di SCOMPORRE una variazione netta dei debiti finanziari in raccolta (+) e rimborso (−).

SEZIONE 2 — DIVIDENDI E RAPPORTI CON I SOCI. Cerca e estrai:
- dividendi deliberati sull'utile dell'esercizio precedente e dividendi EFFETTIVAMENTE PAGATI per cassa nell'esercizio (se differiscono, riporta entrambi gli importi);
- aumenti di capitale sottoscritti e la quota effettivamente VERSATA per cassa;
- versamenti soci in conto capitale, finanziamenti soci (erogazioni e rimborsi), rinunce a crediti da parte dei soci;
- acquisti/vendite di azioni proprie, distribuzione di riserve.

SEZIONE 3 — OPERAZIONI NON MONETARIE (NON-CASH). Cerca e estrai:
- acquisizioni di beni tramite leasing finanziario o iscrizione di diritti d'uso (IFRS 16) SENZA uscita di cassa;
- conversioni di debito in capitale (o viceversa), compensazioni di partite;
- conferimenti in natura, permute di beni, acquisizioni pagate in azioni;
- ogni operazione che modifica attivo/passivo SENZA movimento di disponibilità liquide ma che potrebbe essere confluita nei flussi lordi del rendiconto.

SEZIONE 4 — ALTRE INFORMAZIONI SULLA CASSA. Cerca e estrai:
- composizione delle disponibilità liquide (depositi vincolati, cassa non disponibile, saldi in valuta);
- linee di credito accordate e non utilizzate, anticipazioni bancarie;
- effetti cambio sulle disponibilità liquide;
- eventi successivi con impatto sulla liquidità; restrizioni al trasferimento di cassa infragruppo.

Oltre agli estratti, individua le RETTIFICHE quantificate da applicare alle voci del rendiconto e i RED FLAG.

RETTIFICHE — tipi ammessi e convenzioni:
- "scomposizione_debito": la variazione NETTA dei debiti finanziari esposta nel rendiconto va separata in raccolta e rimborso. Genera UNA rettifica per ciascuna componente: la componente di raccolta con "importo" POSITIVO e "classeDestinazione":"finanza_passiva_raccolta"; la componente di rimborso con "importo" NEGATIVO e "classeDestinazione":"finanza_passiva_servizio". In entrambe, "classeOrigine" è la classe della voce netta da scomporre. La SOMMA degli importi delle rettifiche di scomposizione deve essere pari alla variazione netta esposta nella voce di origine.
- "dividendi_cassa": rettifica la differenza tra dividendi contabilizzati e dividendi pagati per cassa. "importo" = componente NON monetaria inclusa nella voce di origine, con il suo segno (es. dividendi esposti −300 ma pagati −250 → importo −50, che verrà stornato). "classeOrigine" = classe della voce interessata (tipicamente equity_dividendi). "classeDestinazione": null se la componente va solo neutralizzata; una classe valida se il flusso va ricollocato.
- "non_cash": storna una posta NON monetaria confluita nei flussi lordi, neutralizzandola. "importo" = valore della posta così come inclusa nella voce di origine, con il suo segno. "classeDestinazione" DEVE essere null (viene generato SOLO lo storno).
ATTENZIONE AL RISCHIO DI FALSI POSITIVI SUI FLUSSI: le nuove iscrizioni di diritti d'uso (leasing IFRS 16), le conversioni di debito in equity o altre operazioni puramente patrimoniali sono operazioni NON monetarie che, nei bilanci redatti correttamente (es. IAS 7), NON transitano mai nei flussi di cassa del rendiconto. Pertanto, per queste operazioni devi SOLO creare un 'estratto' testuale nella Sezione 3, ma NON DEVI MAI generare una 'rettifica' di storno (tipo non_cash), a meno che il testo della Nota Integrativa non affermi esplicitamente che tale posta non monetaria è erroneamente confluita nei flussi del rendiconto. Nel dubbio, genera l'estratto ma NON generare la rettifica.
⚠ REGOLA RIGIDA ANTI-DUPLICAZIONE: Se un flusso monetario (es. dividendi pagati, rimborso di obbligazioni) esposto nella Nota Integrativa o Relazione sulla Gestione COINCIDE già (anche al netto di lievi arrotondamenti o differenze di scala) con la voce, l'importo e il segno esposti nel documento del Rendiconto, NON DEVI GENERARE ALCUNA RETTIFICA (nemmeno a somma zero). Crea una 'rettifica' SOLO ed ESCLUSIVAMENTE se l'informazione ti obbliga a MODIFICARE l'importo originario o a SCORPORARE un valore fuso con altri.

Classi ammesse per classeOrigine/classeDestinazione: ${Object.keys(CLASSI_RF).filter((c) => c !== "da_classificare").join(", ")}.
Proponi SOLO rettifiche supportate da importi ESPLICITI trovati nella Nota Integrativa: NON stimare, NON inventare. Se un'informazione è qualitativa ma non quantificata, mettila negli estratti, non nelle rettifiche.

RED FLAG — flag ammessi: "leasing_non_cash", "conversione_debito_equity", "dividendi_non_allineati", "altro". Gravità: "alta", "media", "bassa". Riporta l'evidenza testuale sintetica e la pagina.

Rispondi SOLO con JSON valido, senza markdown né commenti, nel formato:
{"estratti":[{"sezione":1,"tema":"...","contenuto":"sintesi compatta con gli importi ESATTI trovati","pagina":12}],
 "rettifiche":[{"descrizione":"...","importo":0,"classeOrigine":"...","classeDestinazione":"...","tipo":"scomposizione_debito","motivazione":"max 1 frase: quale informazione della NI giustifica la rettifica","pagina":12}],
 "redFlags":[{"flag":"leasing_non_cash","evidenza":"...","gravita":"media","pagina":12}]}
Regole finali: massimo 20 estratti, ciascuno massimo 600 caratteri; "pagina" è il numero di pagina del documento (null se non deducibile); se nulla è rilevante restituisci array vuoti. Rispondi SOLO con il JSON.`;

/* ---- Sezioni tematiche e prompt della RELAZIONE SULLA GESTIONE (RG) ----
   La RG è prospettica/discorsiva: i manager spiegano strategia, scelte di
   finanziamento, politica dei dividendi e dinamica del circolante. Le 4
   sezioni sono focalizzate sui flussi di cassa (diverse da quelle della NI). */
const RG_SEZIONI_RF = {
  1: { titolo: "Strategia di investimento e CAPEX futuri",       color: "bg-indigo-50 border-indigo-200 text-indigo-900",  badge: "bg-indigo-600" },
  2: { titolo: "Politiche di finanziamento e struttura del debito", color: "bg-amber-50 border-amber-200 text-amber-900",   badge: "bg-amber-600" },
  3: { titolo: "Remunerazione degli azionisti e dividendi",      color: "bg-emerald-50 border-emerald-200 text-emerald-900", badge: "bg-emerald-600" },
  4: { titolo: "Dinamica del capitale circolante",               color: "bg-teal-50 border-teal-200 text-teal-900",        badge: "bg-teal-600" },
};

const RG_RF_PROMPT = `Sei un analista di bilancio esperto. Ricevi il testo di una RELAZIONE SULLA GESTIONE (il documento discorsivo degli amministratori allegato al bilancio) e devi estrarre ESCLUSIVAMENTE le informazioni utili all'analisi del RENDICONTO FINANZIARIO e alla lettura prospettica dei flussi di cassa, organizzate in QUATTRO SEZIONI TEMATICHE. Ogni informazione estratta deve appartenere a UNA sola sezione.

SEZIONE 1 — STRATEGIA DI INVESTIMENTO E CAPEX FUTURI. Cerca e estrai:
- piani di investimento annunciati o in corso (nuovi impianti, capacità produttiva, digitalizzazione, M&A, ricerca e sviluppo capitalizzata);
- entità attesa dei CAPEX futuri e loro fonte di copertura dichiarata (autofinanziamento, debito, aumenti di capitale);
- disinvestimenti, dismissioni di rami d'azienda o cespiti, razionalizzazioni;
- ogni indicazione sull'intensità di capitale prospettica e sull'impatto atteso sui flussi di investimento.

SEZIONE 2 — POLITICHE DI FINANZIAMENTO E STRUTTURA DEL DEBITO. Cerca e estrai:
- nuove linee di credito, mutui o emissioni obbligazionarie negoziati o attesi; rifinanziamenti e ristrutturazioni del debito;
- piani di rimborso, scadenze significative, covenant e rispetto dei parametri finanziari;
- obiettivi dichiarati di leva finanziaria (rapporto PFN/EBITDA), politica di gestione della liquidità;
- ogni dettaglio sui rimborsi di mutui che permetta di SCOMPORRE una variazione netta del debito in raccolta (+) e rimborso (−).

SEZIONE 3 — REMUNERAZIONE DEGLI AZIONISTI E DIVIDENDI. Cerca e estrai:
- proposta di destinazione dell'utile, dividendi proposti/deliberati e dividendi attesi per gli esercizi futuri;
- politica dei dividendi dichiarata (payout target), acquisti di azioni proprie (buyback);
- eventuali aumenti di capitale o versamenti soci previsti;
- differenze tra dividendi deliberati e dividendi effettivamente pagati per cassa, se esplicitate.

SEZIONE 4 — DINAMICA DEL CAPITALE CIRCOLANTE. Cerca e estrai:
- spiegazioni dei manager sull'andamento di crediti verso clienti, rimanenze di magazzino e debiti verso fornitori;
- politiche commerciali (dilazioni concesse/ottenute), stagionalità, tensioni o miglioramenti nell'incasso;
- azioni pianificate sul circolante (riduzione DSO, ottimizzazione scorte) e impatto atteso sulla cassa;
- ogni elemento che spieghi l'effetto "spugna" del capitale circolante netto operativo sui flussi.

Oltre agli estratti, individua le RETTIFICHE quantificate da applicare alle voci del rendiconto e i RED FLAG, MA SOLO se la Relazione sulla Gestione riporta importi ESPLICITI.

RETTIFICHE — tipi ammessi e convenzioni (identici a quelli della Nota Integrativa):
- "scomposizione_debito": se la RG esplicita accensioni e rimborsi di mutui distinti, scomponi la variazione netta in raccolta (+, "classeDestinazione":"finanza_passiva_raccolta") e rimborso (−, "classeDestinazione":"finanza_passiva_servizio"); "classeOrigine" è la classe della voce netta.
- "dividendi_cassa": se la RG distingue dividendi deliberati da dividendi pagati per cassa, rettifica la differenza NON monetaria ("classeOrigine" tipicamente equity_dividendi).
- "non_cash": storna una posta NON monetaria confluita nei flussi lordi; "classeDestinazione" DEVE essere null.
ATTENZIONE AL RISCHIO DI FALSI POSITIVI SUI FLUSSI: le operazioni puramente prospettiche o non monetarie descritte nella RG (piani futuri, leasing IFRS 16, conversioni debito/equity) NON transitano nei flussi di cassa del rendiconto dell'esercizio. Per queste crea SOLO un 'estratto', NON una 'rettifica', a meno che la RG affermi ESPLICITAMENTE che una posta non monetaria è erroneamente confluita nei flussi. Nel dubbio, genera l'estratto ma NON la rettifica.
⚠ REGOLA RIGIDA ANTI-DUPLICAZIONE: Se un flusso monetario (es. dividendi pagati, rimborso di obbligazioni) esposto nella Nota Integrativa o Relazione sulla Gestione COINCIDE già (anche al netto di lievi arrotondamenti o differenze di scala) con la voce, l'importo e il segno esposti nel documento del Rendiconto, NON DEVI GENERARE ALCUNA RETTIFICA (nemmeno a somma zero). Crea una 'rettifica' SOLO ed ESCLUSIVAMENTE se l'informazione ti obbliga a MODIFICARE l'importo originario o a SCORPORARE un valore fuso con altri.

Classi ammesse per classeOrigine/classeDestinazione: ${Object.keys(CLASSI_RF).filter((c) => c !== "da_classificare").join(", ")}.
Proponi SOLO rettifiche supportate da importi ESPLICITI trovati nella Relazione: NON stimare, NON inventare. Le informazioni prospettiche o qualitative vanno negli estratti, mai nelle rettifiche.

RED FLAG — flag ammessi: "leasing_non_cash", "conversione_debito_equity", "dividendi_non_allineati", "altro". Gravità: "alta", "media", "bassa". Riporta l'evidenza testuale sintetica e la pagina.

Rispondi SOLO con JSON valido, senza markdown né commenti, nel formato:
{"estratti":[{"sezione":1,"tema":"...","contenuto":"sintesi compatta con eventuali importi ESATTI","pagina":12}],
 "rettifiche":[{"descrizione":"...","importo":0,"classeOrigine":"...","classeDestinazione":"...","tipo":"scomposizione_debito","motivazione":"max 1 frase: quale informazione della RG giustifica la rettifica","pagina":12}],
 "redFlags":[{"flag":"altro","evidenza":"...","gravita":"media","pagina":12}]}
Regole finali: massimo 20 estratti, ciascuno massimo 600 caratteri; "pagina" è il numero di pagina del documento (null se non deducibile); se nulla è rilevante restituisci array vuoti. Rispondi SOLO con il JSON.`;

/* ============================================================
   PROMPT GEMELLI PER L'ESERCIZIO PRECEDENTE (T-1)
   ============================================================
   Nota Integrativa e Relazione sulla Gestione parlano per loro natura di
   PIÙ esercizi: la stessa nota sul debito espone tipicamente accensioni e
   rimborsi dell'anno corrente E del comparativo. I prompt gemelli
   riutilizzano integralmente le regole degli originali (stesse 4 sezioni,
   stessi tipi di rettifica, stesso schema JSON) aggiungendo un filtro
   TASSATIVO sull'annualità di riferimento, così le rettifiche generate
   colpiscono vociPrec e non le voci dell'anno corrente. */

const bloccoPrecDoc = (annoPrec = "") => `⚠ VINCOLO TASSATIVO SULL'ANNUALITÀ — LEGGI PRIMA DI TUTTO IL RESTO
Stai analizzando il documento per ricostruire i flussi dell'ESERCIZIO PRECEDENTE (l'anno comparativo${annoValidoStr(annoPrec) ? `, ${annoValidoStr(annoPrec)}` : ""}), NON dell'esercizio corrente.
- Cerca ESCLUSIVAMENTE rettifiche e informazioni riferite all'ANNO PRECEDENTE: scomposizione_debito (accensioni e rimborsi di mutui avvenuti nell'anno precedente), storni non_cash di poste non monetarie confluite nei flussi dell'anno precedente, dividendi pagati per cassa nell'anno precedente.
- Le note e le tabelle comparative espongono spesso due colonne o due periodi: prendi SEMPRE il dato del periodo comparativo (il più vecchio dei due) e ignora quello dell'esercizio corrente.
- Se un'informazione è riferita SOLO all'esercizio corrente, o se non riesci ad attribuirla con certezza all'anno precedente, NON generarla: né come estratto né come rettifica. Meglio un array vuoto che un dato attribuito all'anno sbagliato.
- Le informazioni PROSPETTICHE (piani futuri, obiettivi, guidance) non riguardano l'anno precedente: ignorale.
- Negli "estratti" indica sempre, nel campo "contenuto", l'anno a cui l'importo si riferisce.`;

/* Variante «documento autonomo» del vincolo T-1 (Modalità Singolo Anno):
   il documento caricato negli slot T-1 parla del PROPRIO esercizio di
   chiusura, quindi le istruzioni sulla colonna comparativa vanno invertite. */
const bloccoPrecDocAutonomo = (annoPrec = "") => `⚠ VINCOLO TASSATIVO SULL'ANNUALITÀ — LEGGI PRIMA DI TUTTO IL RESTO
Stai analizzando un DOCUMENTO AUTONOMO dell'esercizio ${annoValidoStr(annoPrec) || "precedente"} (Modalità Singolo Anno): il documento NON è quello dell'anno corrente, ma il bilancio a sé stante di un esercizio già chiuso.
- Estrai rettifiche e informazioni riferite all'esercizio PRINCIPALE di questo documento (il suo anno di chiusura): scomposizione_debito, storni non_cash, dividendi pagati per cassa in quell'esercizio.
- Nelle tabelle a due colonne prendi SEMPRE la colonna PRINCIPALE (l'esercizio di chiusura del documento) e ignora la sua comparativa.
- Quando una nota commenta una variazione («il debito passa da X a Y»), il valore da estrarre è quello di ARRIVO Y.
- Le informazioni PROSPETTICHE (piani futuri, obiettivi, guidance) vanno ignorate.
- Negli "estratti" indica sempre, nel campo "contenuto", l'anno a cui l'importo si riferisce.`;

const buildNiRfPromptPrec = (annoPrec = "") => `${bloccoPrecDoc(annoPrec)}

${NI_RF_PROMPT}

RICORDA: tutte le rettifiche e gli estratti che restituisci devono riferirsi all'ESERCIZIO PRECEDENTE (colonna comparativa). Se la Nota Integrativa non fornisce dati comparativi utili, restituisci array vuoti.`;

const buildNiRfPromptPrecAutonomo = (annoPrec = "") => `${bloccoPrecDocAutonomo(annoPrec)}

${NI_RF_PROMPT}

RICORDA: tutte le rettifiche e gli estratti devono riferirsi all'esercizio ${annoValidoStr(annoPrec) || "di chiusura di questo documento"}, letto sulla colonna principale. Se la Nota Integrativa non fornisce dati utili per quell'esercizio, restituisci array vuoti.`;

const buildRgRfPromptPrec = (annoPrec = "") => `${bloccoPrecDoc(annoPrec)}

${RG_RF_PROMPT}

RICORDA: tutte le rettifiche e gli estratti che restituisci devono riferirsi all'ESERCIZIO PRECEDENTE (colonna comparativa). La Relazione sulla Gestione è in larga parte prospettica: estrai solo i CONSUNTIVI dell'anno precedente, mai gli obiettivi futuri. Se non trovi dati comparativi utili, restituisci array vuoti.`;

const buildRgRfPromptPrecAutonomo = (annoPrec = "") => `${bloccoPrecDocAutonomo(annoPrec)}

${RG_RF_PROMPT}

RICORDA: tutte le rettifiche e gli estratti devono riferirsi all'esercizio ${annoValidoStr(annoPrec) || "di chiusura di questo documento"}. La Relazione sulla Gestione è in larga parte prospettica: estrai solo i CONSUNTIVI di quell'esercizio, mai gli obiettivi futuri.`;

/* ---------- Chiamata IA multi-provider (identica al modulo CE) ----------
   `pdfBase64`, se presente, allega il documento nel formato nativo del provider
   (blocco «document» per Claude, «inline_data» per Gemini). Con OpenAI, che non
   accetta PDF grezzi, le pagine vengono prima convertite in immagini lato
   client e allegate come «image_url»: il risultato per l'utente è lo stesso. */

/* ---------- Destinazione delle chiamate al provider Claude ----------
   Di norma il proxy del progetto (/api/anthropic), che custodisce la chiave
   lato server. La destinazione viene decisa una sola volta, in tre passaggi:

     1. costante di build `__CLAUDE_ENDPOINT__`, che vite.config.js valorizza
        con `define` a partire da VITE_CLAUDE_ENDPOINT;
     2. `window.__CLAUDE_ENDPOINT__`, per un override a runtime senza
        ricompilare (per esempio da index.html);
     3. rilevamento dell'host: dentro un artifact di Claude il proxy non
        esiste ed è l'ambiente stesso ad autenticare la richiesta, quindi si
        chiama direttamente l'API.

   Un solo file serve così entrambi gli scenari — artifact e deploy — senza le
   quattro divergenze che finora andavano riallineate a mano a ogni modifica.
   NB: qui non si usa `import.meta`, che è sintassi legale solo dentro un
   modulo ES e fa fallire il parsing quando il componente viene incollato in un
   artifact o in un bundle non modulare. */
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

/* Chiamata diretta all'API: cambiano gli header di autenticazione, perché non
   c'è più un proxy che traduca la chiave dell'utente in quella del server. */
const CLAUDE_DIRETTO = CLAUDE_ENDPOINT === ENDPOINT_API_DIRETTA;

/* La chiave inserita a schermo vale per la singola richiesta. Il segnaposto
   "__subscription__" indica che l'utente non ne ha digitata alcuna: in quel
   caso non parte alcun header e autentica l'ambiente ospite (artifact) o il
   server (deploy, con ANTHROPIC_API_KEY). */
const headerClaude = (apiKey) => {
  const chiave = apiKey && apiKey !== "__subscription__" ? apiKey : null;
  if (!chiave) return { "Content-Type": "application/json" };
  return CLAUDE_DIRETTO
    ? {
        "Content-Type": "application/json",
        "x-api-key": chiave,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }
    : { "Content-Type": "application/json", "x-user-key": chiave };
};

async function chiamaIA({ provider, apiKey, model, prompt, pdfBase64 = null }) {
  prompt = conScalaMilioni(prompt);
  if (provider === "openai") {
    /* L'endpoint chat/completions non accetta il PDF grezzo, ma legge le
       immagini: le pagine vengono quindi rasterizzate nel browser (pdfToImages)
       e allegate come blocchi «image_url». Funzionano così anche le scansioni e
       i file «Stampa su PDF». Senza allegato il contenuto resta la semplice
       stringa già usata finora. */
    const istruzioneJsonOpenAi =
      "\n\nIMPORTANTE: rispondi esclusivamente con l'oggetto JSON richiesto, senza testo introduttivo, senza commenti e senza blocchi ```.";
    const contenutoOpenAi = pdfBase64
      ? [...(await pdfBase64ToPartiOpenAI(pdfBase64)), { type: "text", text: prompt + istruzioneJsonOpenAi }]
      : prompt;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: contenutoOpenAi }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }
  if (provider === "claude") {
    // La destinazione la decide CLAUDE_ENDPOINT: chiamata diretta a
    // /v1/messages dentro un artifact, proxy /api/anthropic in deploy.
    // Quando è presente un PDF viene allegato come blocco «document» nativo:
    // il modello lo legge direttamente, senza bisogno di un layer di testo.
    const istruzioneJson =
      "\n\nIMPORTANTE: rispondi esclusivamente con l'oggetto JSON richiesto, senza testo introduttivo, senza commenti e senza blocchi ```.";
    const contenuto = pdfBase64
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt + istruzioneJson },
        ]
      : [{ type: "text", text: prompt + istruzioneJson }];
    const res = await fetch(CLAUDE_ENDPOINT, {
      method: "POST",
      headers: headerClaude(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages: [{ role: "user", content: contenuto }],
      }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  // Gemini: il PDF viaggia come inline_data con mime type application/pdf.
  const parti = pdfBase64
    ? [{ inline_data: { mime_type: "application/pdf", data: pdfBase64 } }, { text: prompt }]
    : [{ text: prompt }];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parti }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates[0].content.parts.map((p) => p.text).join("");
}

/* ---- Errore transitorio? (per i ritentativi con backoff) ---- */
function erroreTransitorio(err) {
  const m = String(err?.message || err).toLowerCase();
  return (
    /(^|[^\d])(429|500|502|503|504|529)([^\d]|$)/.test(m) ||
    m.includes("overloaded") || m.includes("rate") || m.includes("timeout") ||
    m.includes("network") || m.includes("failed to fetch") || m.includes("fetch failed") ||
    m.includes("econnreset") || m.includes("temporar") || m.includes("unavailable")
  );
}

/* ---- chiamaIA con ritentativi automatici e backoff esponenziale (come CE) ---- */
async function chiamaIAConRitentativi(args, { tentativi = 5, baseMs = 900, onRitento } = {}) {
  let ultimo;
  for (let i = 0; i < tentativi; i++) {
    try {
      return await chiamaIA(args);
    } catch (e) {
      ultimo = e;
      if (i === tentativi - 1 || !erroreTransitorio(e)) throw e;
      const attesa = Math.round(baseMs * 2 ** i + Math.random() * 400);
      if (onRitento) onRitento(i + 1, attesa, e);
      await new Promise((r) => setTimeout(r, attesa));
    }
  }
  throw ultimo;
}

/* ---------- Parsing JSON robusto — identico al CE ----------
   Due modalità di fallimento, con logiche opposte:
   1) TRONCAMENTO (fine token a metà stringa/array) → si ripara chiudendo
      stringhe e parentesi rimaste aperte;
   2) CONTENUTO EXTRA DOPO UN JSON COMPLETO (l'IA aggiunge una spiegazione o
      un secondo blocco incollato) → si individua la fine del primo valore di
      primo livello e si scarta tutto ciò che segue.
   Si prova prima il caso (2): tentare la riparazione da troncamento su un
   JSON già completo riporterebbe allo stesso errore. ---- */

function parseJsonRobusto(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  const inizio = s.indexOf("{");
  if (inizio > 0) s = s.slice(inizio);
  try {
    return JSON.parse(s);
  } catch {
    /* ---- Caso 2: JSON completo con testo extra incollato dopo ---- */
    const fineValore = trovaFineValoreJson(s);
    if (fineValore != null) {
      try {
        return JSON.parse(s.slice(0, fineValore));
      } catch {
        /* non valido comunque: si prosegue con il caso 1 */
      }
    }

    /* ---- Caso 1: riparazione da troncamento ---- */
    let inString = false;
    let escaped = false;
    const stack = [];
    let lastSafe = 0; // ultima posizione subito dopo un valore completo
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') { inString = false; lastSafe = i + 1; }
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") { stack.pop(); lastSafe = i + 1; }
      else if (c === ",") lastSafe = i;
    }
    let riparato = s.slice(0, lastSafe).replace(/,\s*$/, "");
    inString = false; escaped = false;
    const aperte = [];
    for (let i = 0; i < riparato.length; i++) {
      const c = riparato[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") aperte.push("}");
      else if (c === "[") aperte.push("]");
      else if (c === "}" || c === "]") aperte.pop();
    }
    if (inString) riparato += '"';
    riparato += aperte.reverse().join("");
    const data = JSON.parse(riparato); // se fallisce anche qui, l'errore risale al chiamante
    data.__troncato = true;
    return data;
  }
}

/* Indice subito dopo la chiusura del primo valore JSON di primo livello,
   oppure null se la struttura non si richiude mai (allora è un troncamento). */
function trovaFineValoreJson(s) {
  let inString = false;
  let escaped = false;
  let profondita = 0;
  let iniziato = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{" || c === "[") { profondita++; iniziato = true; }
    else if (c === "}" || c === "]") {
      profondita--;
      if (iniziato && profondita === 0) return i + 1;
    }
  }
  return null;
}

/* ---------- Lettura file (testo + PDF via pdf.js da cdnjs) — identica al CE ---------- */

/* Caricamento condiviso di pdf.js: la stessa istanza serve sia l'estrazione
   testuale sia la rasterizzazione delle pagine per OpenAI (vedi pdfToImages).
   Resta la build UMD 3.11.174: le 4.x su cdnjs sono solo ESM e non si possono
   caricare con uno <script> iniettato a runtime. */
const PDFJS_VER = "3.11.174";

function caricaPdfJs() {
  if (window.pdfjsLib && window.__pdfJsPronto) return Promise.resolve(window.pdfjsLib);
  if (window.__pdfJsPromise) return window.__pdfJsPromise;
  window.__pdfJsPromise = new Promise((res, rej) => {
    const avvia = () => {
      const lib = window.pdfjsLib;
      if (!lib) return rej(new Error("Libreria pdf.js non disponibile"));
      const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;
      try {
        /* Un Worker non può essere costruito da un URL cross-origin: si crea un
           piccolo worker locale (blob) che importa quello del CDN. Senza questo
           accorgimento pdf.js ripiega sul «fake worker» e lavora sul thread
           principale, bloccando l'interfaccia durante la rasterizzazione. */
        const shim = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], {
          type: "application/javascript",
        });
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(shim);
      } catch {
        lib.GlobalWorkerOptions.workerSrc = workerUrl;
      }
      window.__pdfJsPronto = true;
      res(lib);
    };
    if (window.pdfjsLib) return avvia();
    const s = document.createElement("script");
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
    s.onload = avvia;
    s.onerror = () => rej(new Error("Impossibile caricare pdf.js"));
    document.head.appendChild(s);
  });
  return window.__pdfJsPromise;
}

async function estraiTesto(file) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjsLib = await caricaPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let testo = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      testo += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return testo;
  }
  return file.text();
}

/* ============================================================
   LETTURA NATIVA DEI PDF (senza estrazione del layer di testo)
   ============================================================
   pdf.js legge SOLO il layer di testo incorporato nel PDF: un file prodotto
   da scansione o da «Stampa su PDF» ne è privo e restituisce zero caratteri,
   rendendo impossibile qualunque analisi (l'IA riceve una stringa vuota).
   Per questo il PDF viene inviato al modello nel suo formato NATIVO, come
   blocco «document» in base64: il modello lo legge visivamente pagina per
   pagina, quindi anche scansioni e documenti "stampati" restano analizzabili.
   I file voluminosi vengono suddivisi in porzioni per rispettare i limiti di
   dimensione della singola richiesta.
   ============================================================ */

const PAGINE_PER_PORZIONE = 25;
const SOGLIA_PORZIONE_BYTE = 8 * 1024 * 1024; // oltre questa dimensione si suddivide comunque

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Lettura del file non riuscita"));
    r.readAsDataURL(file);
  });
}

function caricaPdfLib() {
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
}

/* Suddivide il PDF in porzioni da PAGINE_PER_PORZIONE pagine, conservando
   l'intervallo di pagine originario (from/to) per riallineare i riferimenti
   di pagina restituiti dal modello. */
async function pdfToChunks(file) {
  try {
    const { PDFDocument } = await caricaPdfLib();
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const nPagine = doc.getPageCount();
    if (nPagine <= PAGINE_PER_PORZIONE && file.size <= SOGLIA_PORZIONE_BYTE)
      return [{ data: await fileToBase64(file), from: 1, to: nPagine }];
    const chunks = [];
    for (let start = 0; start < nPagine; start += PAGINE_PER_PORZIONE) {
      const end = Math.min(start + PAGINE_PER_PORZIONE, nPagine);
      const sub = await PDFDocument.create();
      const pagine = await sub.copyPages(doc, Array.from({ length: end - start }, (_, i) => start + i));
      pagine.forEach((p) => sub.addPage(p));
      chunks.push({ data: await sub.saveAsBase64(), from: start + 1, to: end });
    }
    return chunks;
  } catch (e) {
    console.warn("Suddivisione PDF non riuscita, invio il file intero:", e);
    return [{ data: await fileToBase64(file), from: 1, to: null }];
  }
}

/* ============================================================
   RASTERIZZAZIONE DELLE PAGINE PER OPENAI
   ============================================================
   L'endpoint chat/completions di OpenAI accetta immagini (image_url)
   ma rifiuta il PDF grezzo. Le porzioni prodotte da pdfToChunks
   vengono quindi renderizzate pagina per pagina su canvas con pdf.js
   e inviate come immagini: anche con OpenAI diventano perciò
   analizzabili i documenti scansionati o creati con «Stampa su PDF»,
   privi di layer di testo.
   ============================================================ */

// Larghezza in pixel a cui viene renderizzata ogni pagina: 1500 px è il
// compromesso tra leggibilità dei prospetti di bilancio e peso della richiesta.
const PDF_IMG_WIDTH = 1500;
// Pagine massime convertite per singola porzione (le porzioni prodotte da
// pdfToChunks sono già da PAGINE_PER_PORZIONE = 25 pagine).
const PDF_IMG_MAX_PAGES = 30;
// Tetto indicativo in byte per pagina: se superato la pagina viene ricodificata
// con qualità inferiore, per non sforare i limiti di dimensione della richiesta.
const PDF_IMG_MAX_BYTES_PAGE = 420 * 1024;

/* Accetta File/Blob, ArrayBuffer, Uint8Array oppure una stringa base64 (con o
   senza prefisso data:): nel flusso dell'applicazione il PDF arriva già come
   base64 (le porzioni di pdfToChunks), ma la funzione resta utilizzabile anche
   passando direttamente il File. */
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

/* Converte un PDF in immagini base64, una per pagina:
   [{ page, mediaType, data, dataUrl }, …] */
async function pdfToImages(input, opts = {}) {
  const {
    maxPages = PDF_IMG_MAX_PAGES,
    targetWidth = PDF_IMG_WIDTH,
    mimeType = "image/jpeg",
    onProgress = null,
  } = opts;

  const pdfjsLib = await caricaPdfJs();
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

      // Libera subito la memoria del canvas (un bilancio ha molte pagine).
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

/* La stessa porzione viene inviata più volte (rendiconto, nota integrativa,
   relazione sulla gestione, esercizio precedente…) e ogni chiamata può essere
   ripetuta fino a 5 volte da chiamaIAConRitentativi: senza cache la
   rasterizzazione verrebbe rifatta a ogni giro. La
   chiave è una firma leggera del base64, per non tenere in memoria la stringa
   intera come chiave. */
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
  // Cache volutamente piccola: si tengono al massimo 6 porzioni.
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return p;
}

/* Traduce una porzione di PDF nei blocchi «image_url» attesi da
   chat/completions. L'etichetta di pagina che precede ogni immagine aiuta il
   modello a compilare correttamente il campo "pagina" dei JSON restituiti. */
async function pdfBase64ToPartiOpenAI(pdfBase64) {
  let pagine;
  try {
    pagine = await pdfToImagesCached(pdfBase64);
  } catch (e) {
    throw new Error(
      `Conversione del PDF in immagini non riuscita (${e?.message || e}). ` +
        "Riprova oppure seleziona Claude o Gemini, che leggono il PDF nel formato nativo."
    );
  }
  const parti = [];
  for (const p of pagine) {
    parti.push({ type: "text", text: `— Pagina ${p.page} del documento allegato —` });
    parti.push({
      type: "image_url",
      image_url: { url: `data:${p.mediaType};base64,${p.data}`, detail: "high" },
    });
  }
  return parti;
}

/* Prepara la «fonte» da sottoporre al modello:
   · PDF (con qualunque provider) → porzioni base64;
   · ogni altro caso → estrazione testuale (pdf.js oppure file di testo).
   Tutti e tre i provider leggono ormai il documento visivamente: Claude e
   Gemini ricevono il PDF nel formato nativo, OpenAI le stesse porzioni
   convertite in immagini al momento dell'invio. Non serve quindi più
   distinguere per provider, né interrompere l'analisi quando il PDF è privo di
   testo estraibile. */
async function preparaFonte(file, provider) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const chunks = await pdfToChunks(file);
    return { tipo: "pdf", chunks, nome: file.name };
  }
  const testo = await estraiTesto(file);
  return { tipo: "testo", testo, nome: file.name };
}

/* Impronta dimensionale della fonte: sostituisce testo.length nelle firme
   usate per evitare ri-analisi ridondanti. */
function dimensioneFonte(fonte) {
  if (!fonte) return 0;
  if (fonte.tipo === "pdf") return fonte.chunks.reduce((a, c) => a + (c.data?.length || 0), 0);
  return (fonte.testo || "").length;
}

/* Esegue il prompt sulla fonte, porzione per porzione, restituendo l'elenco
   dei JSON ottenuti (uno per porzione analizzata con successo).
   `costruisciPrompt(testo)` riceve il testo da incorporare nel prompt, oppure
   null quando il documento viaggia come allegato PDF nativo. */
async function eseguiSuFonte({ provider, apiKey, model, costruisciPrompt, fonte, limiteTesto = 120000, onPorzione, onRitento }) {
  const opzioni = onRitento ? { onRitento } : {};
  if (fonte.tipo === "testo") {
    const prompt = costruisciPrompt(fonte.testo.slice(0, limiteTesto));
    return [parseJsonRobusto(await chiamaIAConRitentativi({ provider, apiKey, model, prompt }, opzioni))];
  }
  const risultati = [];
  const tot = fonte.chunks.length;
  for (let c = 0; c < tot; c++) {
    const ch = fonte.chunks[c];
    if (onPorzione) onPorzione(c, tot);
    const nota =
      tot > 1
        ? `\n\n⚠ Il documento allegato è SOLO la porzione con le pagine da ${ch.from} a ${ch.to} del documento completo. Analizza esclusivamente ciò che vedi nell'allegato e, nel campo "pagina", indica il numero COME APPARE NELL'ALLEGATO (1 = prima pagina dell'allegato). Se in questa porzione non c'è nulla di pertinente, restituisci gli array vuoti senza inventare dati.`
        : "";
    try {
      const raw = await chiamaIAConRitentativi(
        { provider, apiKey, model, prompt: costruisciPrompt(null) + nota, pdfBase64: ch.data },
        opzioni
      );
      const data = parseJsonRobusto(raw);
      data.__offsetPagina = (Number(ch.from) || 1) - 1;
      risultati.push(data);
    } catch (e) {
      console.warn(`Porzione ${c + 1}/${tot} non analizzata:`, e);
    }
  }
  if (!risultati.length)
    throw new Error(
      "Nessuna porzione del documento è stata analizzata: riprova, oppure verifica che il file non sia protetto o danneggiato."
    );
  if (onPorzione) onPorzione(tot, tot);
  return risultati;
}

/* ---- Fusione dei risultati delle singole porzioni ---- */

function leggiPercorso(obj, percorso) {
  return String(percorso)
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* Concatena il campo-array indicato (anche annidato, es. "ni.estratti") di
   tutte le porzioni, riportando i numeri di pagina alla numerazione del
   documento completo. */
function fondiArray(risultati, percorso) {
  const out = [];
  for (const r of risultati) {
    const arr = leggiPercorso(r, percorso);
    if (!Array.isArray(arr)) continue;
    const off = Number(r?.__offsetPagina) || 0;
    for (const el of arr) {
      if (el && typeof el === "object" && !Array.isArray(el) && el.pagina != null && Number.isFinite(Number(el.pagina)))
        out.push({ ...el, pagina: Number(el.pagina) + off });
      else out.push(el);
    }
  }
  return out;
}

/* Primo valore utile (non vuoto) per un campo scalare o oggetto. */
function fondiScalare(risultati, percorso) {
  for (const r of risultati) {
    const v = leggiPercorso(r, percorso);
    if (v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
    return v;
  }
  return undefined;
}

/* Primo numero finito, preferendo i valori diversi da zero: nei documenti
   suddivisi molte porzioni riportano 0 per cassa iniziale/finale perché il
   prospetto non ricade in quella porzione. */
function fondiNumero(risultati, percorso) {
  let primoFinito;
  for (const r of risultati) {
    const n = Number(leggiPercorso(r, percorso));
    if (!Number.isFinite(n)) continue;
    if (n !== 0) return n;
    if (primoFinito === undefined) primoFinito = n;
  }
  return primoFinito;
}

/* True se almeno una porzione è stata riparata da troncamento. */
function qualcheTroncamento(risultati) {
  return risultati.some((r) => r?.__troncato);
}

/* True se almeno una porzione contiene il ramo indicato (per non azzerare
   stati già popolati quando il modello omette del tutto una sezione). */
function qualchePresenza(risultati, percorso) {
  return risultati.some((r) => leggiPercorso(r, percorso) != null);
}

/* ---------- Etichette leggibili dello schema rilevato ---------- */

const SCHEMI_RF_LABEL = {
  oic10_indiretto: "OIC 10 — metodo indiretto",
  oic10_diretto: "OIC 10 — metodo diretto",
  ias7: "IAS 7 — Statement of Cash Flows",
};

/* ============================================================
   SEZIONE 3 — Import JSON SP/CE: funzioni di calcolo derivate
   ============================================================ */

/* ---- Campi per l'inserimento MANUALE degli aggregati (alternativa al JSON) ----
   Le chiavi coincidono con quelle degli aggregati del JSON SP/CE, così i
   dati inseriti a mano alimentano le identiche funzioni di calcolo senza
   duplicare la logica (calcolaDeltaPatrimoniali e calcolaCeDaJson). */
const CAMPI_SP = [
  ["ccno",     "CCNO — capitale circolante netto operativo"],
  ["immobOper","Immobilizzazioni operative nette"],
  ["pfnBreve", "PFN a breve termine"],
  ["passOpNC", "Fondi, TFR e passività operative non correnti"],
  ["pn",       "Patrimonio netto"],
  ["liq",      "Disponibilità liquide"],
  ["debFinC",  "Debiti finanziari correnti (entro 12 mesi)"],
  ["debFinNC", "Debiti finanziari non correnti (oltre 12 mesi)"],
  ["pfn",      "Posizione finanziaria netta (totale)"],
];
const CAMPI_CE = [
  ["ricavi",       "Ricavi delle vendite"],
  ["ebitda",       "EBITDA"],
  ["ebit",         "EBIT"],
  ["ammortamenti", "Ammortamenti e svalutazioni"],
  ["oneriFin",     "Oneri finanziari (competenza) — valore positivo"],
  ["utileNetto",   "Utile netto"],
];

/* ---- Δ patrimoniali dal JSON esportato dal modulo SP ----
   Il JSON SP (salvaDati del modulo «Riclassificazione SP») contiene
   esercizioCorrente.aggregati ed esercizioPrecedente.aggregati con i
   campi: ccno, immobOper, pfnBreve, passOpNC, pn, liq, debFinC,
   debFinNC, … I Δ sono calcolati qui (corrente − precedente) invece di
   fidarsi di eventuali blocchi precalcolati, così il risultato è sempre
   coerente con i dati validati nel modulo SP. Funziona identico sia sui
   dati caricati da JSON sia su quelli inseriti manualmente (stessa forma). */
function calcolaDeltaPatrimoniali(spJson) {
  if (!spJson) return null;
  const corr = spJson.esercizioCorrente?.aggregati;
  const prec = spJson.esercizioPrecedente?.aggregati;
  if (!corr || !prec) return null;
  const N = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const d = (campo) => N(corr[campo]) - N(prec[campo]);
  return {
    /* Δ per il Metodo Indiretto */
    deltaCcno: d("ccno"),                 // ΔCCNO: se cresce, assorbe cassa
    deltaImmob: d("immobOper"),           // ΔImmobilizzazioni operative nette (proxy CAPEX netto contabile)
    deltaPfnBreve: d("pfnBreve"),         // ΔPFN a breve termine
    deltaPn: d("pn"),                     // ΔPatrimonio netto
    deltaLiquidita: d("liq"),             // ΔDisponibilità liquide → failsafe di quadratura
    deltaFondi: d("passOpNC"),            // ΔFondi/TFR e passività operative strutturali
    /* stock utili agli indici (esercizio corrente) */
    debFinTot: N(corr.debFinC) + N(corr.debFinNC),
    debFinC: N(corr.debFinC),
    liq: N(corr.liq),
    pfn: N(corr.pfn),
    esercizioCorr: spJson.esercizioCorrente?.esercizio || null,
    esercizioPrec: spJson.esercizioPrecedente?.esercizio || null,
  };
}

/* ---- Normalizzazione del JSON esportato dal modulo CE ----
   Il modulo CE ha adottato l'architettura a MACRO-NODI (formato
   «ce-riclassificato/2.0»): le voci non stanno più in cima al file ma
   dentro «esercizioCorrente». Il modulo SP era già stato adeguato
   (calcolaDeltaPatrimoniali legge esercizioCorrente.aggregati), il
   percorso CE no: restituiva «Struttura non riconosciuta» su ogni file
   esportato dalla versione nuova. Qui le due forme vengono ricondotte a
   una sola, così il resto del codice continua a lavorare su «voci» piatte
   e i file storici restano leggibili. */
function normalizzaCeJson(ceJson) {
  if (!ceJson || typeof ceJson !== "object") return null;
  /* percorso manuale: nessuna voce da ricondurre */
  if (ceJson.aggregatiManuali) return ceJson;
  /* formato piatto (esportazioni precedenti) */
  if (Array.isArray(ceJson.voci) && ceJson.voci.length) return ceJson;
  /* formato a macro-nodi: si usa l'esercizio CORRENTE, che è quello a cui
     si riferisce la riclassificazione del rendiconto. */
  const nodo = ceJson.esercizioCorrente;
  if (nodo && Array.isArray(nodo.voci) && nodo.voci.length) {
    return {
      ...ceJson,
      voci: nodo.voci,
      esercizio: nodo.esercizio ?? ceJson.esercizio,
      aggregati: nodo.aggregati,
      schemaRilevato: nodo.schemaRilevato ?? ceJson.schemaRilevato,
    };
  }
  return null;
}

/* ---- Aggregati economici dal JSON esportato dal modulo CE ----
   Replica compatta di calcolaCE del modulo CE, applicata alle voci del
   JSON (classi RICAVI, ACQUISTI, PERSONALE, AMMORTAMENTI, ONERI_FIN, …).
   Le voci DA_CLASSIFICARE restano escluse, come nel modulo di origine. */
function calcolaCeDaJson(ceJsonGrezzo) {
  const ceJson = normalizzaCeJson(ceJsonGrezzo);
  if (!ceJson) return null;
  /* percorso INSERIMENTO MANUALE: l'utente fornisce già le grandezze di
     sintesi, quindi non c'è nulla da ricostruire dalle voci. */
  if (ceJson.aggregatiManuali) {
    const N = (x) => Number(x) || 0;
    const a = ceJson.aggregatiManuali;
    const oneriFin = N(a.oneriFin);
    return {
      ricavi: N(a.ricavi), valoreProduzione: N(a.ricavi), valoreAggiunto: 0,
      ebitda: N(a.ebitda), ammortamenti: N(a.ammortamenti), accantonamenti: 0,
      ebit: N(a.ebit), proventiFin: 0, oneriFin,
      gestioneFinanziaria: -oneriFin, risultatoAnteImposte: 0, imposte: 0,
      utileNetto: N(a.utileNetto), __manuale: true,
    };
  }
  if (!Array.isArray(ceJson.voci) || !ceJson.voci.length) return null;
  const attive = ceJson.voci.filter((v) => v.classe && v.classe !== "DA_CLASSIFICARE");
  const S = (classe) =>
    attive.filter((v) => v.classe === classe).reduce((a, v) => a + (Number(v.importo) || 0), 0);

  const ricavi = S("RICAVI");
  const valoreProduzione = ricavi + S("VAR_RIM_PF") + S("LAVORI_INTERNI") + S("ALTRI_RICAVI");
  const consumi = S("ACQUISTI") - S("VAR_RIM_MATERIE");
  const costiEsterni = consumi + S("SERVIZI") + S("GODIMENTO") + S("ONERI_DIVERSI");
  const valoreAggiunto = valoreProduzione - costiEsterni;
  const personale = S("PERSONALE");
  const ebitda = valoreAggiunto - personale;
  const ammortamenti = S("AMMORTAMENTI");
  const accantonamenti = S("ACCANTONAMENTI");
  const redditoOperativoCaratteristica = ebitda - ammortamenti - accantonamenti;
  const gestioneAccessoria = S("PROVENTI_ACCESSORI") - S("ONERI_ACCESSORI");
  const ebit = redditoOperativoCaratteristica + gestioneAccessoria;
  const proventiFin = S("PROVENTI_FIN");
  const oneriFin = S("ONERI_FIN");
  const gestioneFinanziaria = proventiFin - oneriFin;
  const gestioneNonCorrente = S("NON_CORRENTE");
  const extraGestione = S("EXTRA_GESTIONE");
  const risultatoAnteImposte = ebit + gestioneFinanziaria + gestioneNonCorrente + extraGestione;
  const imposte = S("IMPOSTE");
  const utileNetto = risultatoAnteImposte - imposte;
  return {
    ricavi, valoreProduzione, valoreAggiunto, ebitda, ammortamenti, accantonamenti,
    ebit, proventiFin, oneriFin, gestioneFinanziaria, risultatoAnteImposte, imposte, utileNetto,
  };
}

/* ============================================================
   SEZIONE 4 — Motore della riclassificazione a cascata
   ============================================================
   Convenzione: tutte le voci portano il segno di cassa (entrate +,
   uscite −), quindi le somme algebriche coincidono con le formule
   richieste: "capex = entrate − uscite" equivale a Σ(capex_entrate)
   + Σ(capex_uscite) essendo le uscite già negative. */
function calcolaRF(voci) {
  const attive = voci.filter((v) => v.classe !== "da_classificare");
  const S = (classe) =>
    attive.filter((v) => v.classe === classe).reduce((a, v) => a + (Number(v.importo) || 0), 0);

  const flussoGestioneCorrente = S("flusso_operativo_corrente");
  const flussoFondi = S("flusso_operativo_fondi");           // TFR e fondi: auto-assicurazione
  const finanzaAttiva = S("finanza_attiva");
  const flussoOperativoCorrente = flussoGestioneCorrente + flussoFondi + finanzaAttiva;

  const capexEntrate = S("capex_entrate");
  const capexUscite = S("capex_uscite"); // già negativo
  const capex = capexEntrate + capexUscite; // = entrate − |uscite|

  const fcfo = flussoOperativoCorrente + capex;       // Free Cash Flow from Operations
  const fcfd = fcfo;                                  // la finanza attiva è già centralizzata nell'operativo: nessuna duplicazione

  const servizioDelDebito = S("finanza_passiva_servizio"); // già negativo
  const fcfe = fcfd + servizioDelDebito;              // flusso al servizio dei soci

  const componentiAnomali = S("componenti_anomali");  // eventi non ricorrenti / discontinui, isolati

  const equityAumenti = S("equity_aumenti");
  const equityDividendi = S("equity_dividendi");
  const equityBuyback = S("equity_buyback");
  const flussiConSoci = equityDividendi + equityAumenti + equityBuyback;

  const raccolta = S("finanza_passiva_raccolta");
  /* i componenti anomali confluiscono nel saldo finale (impattano comunque
     la cassa) ma restano su una riga a sé, senza inquinare i margini ordinari */
  const variazionePfnBt = fcfe + componentiAnomali + flussiConSoci + raccolta;

  /* effetto cambi sulle disponibilità liquide: posta di RICONCILIAZIONE.
     Non è un flusso gestionale, ma va sommata per far quadrare la variazione
     netta della cassa con la ΔLiquidità dello SP (IAS 7 §28 / OIC 10). */
  const effettoCambi = S("effetto_cambi_liquidita");
  const variazioneLiquiditaTotale = variazionePfnBt + effettoCambi;

  const daClassificare = voci.filter((v) => v.classe === "da_classificare").length;
  return {
    flussoGestioneCorrente, flussoFondi, finanzaAttiva, flussoOperativoCorrente,
    capexEntrate, capexUscite, capex,
    fcfo, fcfd, servizioDelDebito, fcfe,
    componentiAnomali,
    equityAumenti, equityDividendi, equityBuyback, flussiConSoci,
    raccolta, variazionePfnBt,
    effettoCambi, variazioneLiquiditaTotale,
    daClassificare,
  };
}

/* ============================================================
   COMPONENTI RIUSABILI
   ============================================================ */

/* ---- Prospetto a cascata ----
   righe: [{ tipo: "sub"|"margine"|"nota", label, val }]
   base: denominatore per l'incidenza % (es. ricavi dal CE); vuoto:
   messaggio quando non ci sono dati. Stile: margini in teal-50/teal-900
   extrabold, sub in prosa slate, negativi tra parentesi in rose. */
function Prospetto({ titolo, righe, base, vuoto }) {
  if (!righe || !righe.length) {
    return (
      <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
        {vuoto || "Nessun dato disponibile."}
      </div>
    );
  }
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {titolo && (
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">{titolo}</p>
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          {righe.map((r, i) => {
            if (r.tipo === "nota") {
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td colSpan={3} className="px-5 py-2 text-xs text-slate-500 italic leading-relaxed">{r.label}</td>
                </tr>
              );
            }
            const margine = r.tipo === "margine";
            const val = Number(r.val) || 0;
            return (
              <tr key={i} className={`border-t border-slate-100 ${margine ? "bg-teal-50" : ""}`}>
                <td className={`px-5 py-2 ${margine ? "font-extrabold text-teal-900" : "text-slate-700"}`}>
                  {r.label}
                </td>
                <td className={`px-4 py-2 text-right font-mono w-40 ${margine ? `font-extrabold ${val < 0 ? "text-rose-700" : "text-teal-900"}` : val < 0 ? "text-rose-700" : "text-slate-600"}`}>
                  {fmtC(val)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-slate-400 w-24">
                  {base ? pct(val, base) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {base ? (
        <div className="px-5 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          Incidenze % calcolate sui ricavi delle vendite (dal JSON del CE caricato nel tab 4).
        </div>
      ) : null}
    </div>
  );
}

/* ---- Tabella di validazione delle voci (condivisa T e T-1) ----
   Estratta dal Tab 1 per essere riusata identica dal Tab 7 «Dati &
   Validazione T-1»: stessa griglia, stessi colori, stessa gestione delle
   righe generate dalle rettifiche (bordo indaco, non editabili). */
function TabellaVoci({ voci, aggiorna, elimina }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-bold tracking-widest text-slate-500 uppercase">
            <th className="px-4 py-3">Voce del rendiconto</th>
            <th className="px-4 py-3 text-right">Importo</th>
            <th className="px-4 py-3">Classe gestionale</th>
            <th className="px-4 py-3">Area</th>
            <th className="px-2 py-3" />
          </tr>
        </thead>
        <tbody>
          {voci.map((v) => {
            const cls = CLASSI_RF[v.classe];
            const area = cls?.area ? AREE_RF[cls.area] : null;
            const imp = Number(v.importo) || 0;
            const segnoAnomalo =
              !v.rettificaNI && cls?.segnoAtteso != null && imp !== 0 && Math.sign(imp) !== cls.segnoAtteso;
            const daClass = v.classe === "da_classificare";
            return (
              <tr key={v.id} className={`border-t border-slate-100 ${daClass ? "bg-amber-50" : v.rettificaNI ? "bg-indigo-50/50 border-l-4 border-l-indigo-300" : ""}`}>
                <td className="px-4 py-2">
                  {v.rettificaNI ? (
                    <span className="py-1 text-slate-600 italic">{v.nome}</span>
                  ) : (
                    <input
                      value={v.nome}
                      onChange={(e) => aggiorna(v.id, { nome: e.target.value })}
                      placeholder="Nome della voce"
                      className="w-full bg-transparent outline-none border-b border-transparent focus:border-slate-300 py-1"
                      aria-label="Nome voce"
                    />
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {v.rettificaNI ? (
                    <span className={`font-mono py-1 ${imp < 0 ? "text-rose-700" : "text-slate-900"}`}>{fmt(imp)}</span>
                  ) : (
                    <input
                      type="number"
                      value={v.importo}
                      onChange={(e) => aggiorna(v.id, { importo: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className={`w-32 text-right font-mono bg-transparent outline-none border-b border-transparent focus:border-slate-300 py-1 ${imp < 0 ? "text-rose-700" : "text-slate-900"} ${segnoAnomalo ? "bg-amber-100 rounded" : ""}`}
                      aria-label="Importo"
                      title={segnoAnomalo ? `Segno contrario a quello atteso per «${cls.label}» (atteso ${cls.segnoAtteso > 0 ? "+" : "−"})` : undefined}
                    />
                  )}
                </td>
                <td className="px-4 py-2">
                  {v.rettificaNI ? (
                    <span className="text-sm text-slate-600 py-1.5 inline-block">{cls?.label || v.classe}</span>
                  ) : (
                    <select
                      value={v.classe}
                      onChange={(e) => aggiorna(v.id, { classe: e.target.value })}
                      className={`border rounded-lg px-2 py-1.5 text-sm w-full ${daClass ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300"}`}
                      aria-label="Classe gestionale"
                    >
                      {Object.entries(CLASSI_RF).map(([k, c]) => (
                        <option key={k} value={k}>{c.label}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-2">
                  {area ? (
                    <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${area.stile}`}>
                      {area.label}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  {!v.rettificaNI && (
                    <button
                      onClick={() => elimina(v.id)}
                      className="text-rose-500 font-bold px-1"
                      aria-label="Elimina voce"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Riga di variazione Δ (Tab 9 · Variazioni e Trend) ----
   Mostra corrente vs precedente, il Δ assoluto, la variazione % e una
   barra proporzionale bidirezionale. `positivoBuono` inverte la lettura
   cromatica per le grandezze in cui la crescita è un costo (es. CAPEX). */
function RigaDelta({ label, corr, prec, descrizione, positivoBuono = true, scala }) {
  const delta = (Number(corr) || 0) - (Number(prec) || 0);
  const variazione = Math.abs(Number(prec) || 0) > 1e-9 ? delta / Math.abs(Number(prec)) : null;
  const buono = delta === 0 ? null : positivoBuono ? delta > 0 : delta < 0;
  const colore = buono === null ? "text-slate-500" : buono ? "text-emerald-700" : "text-rose-700";
  const barra = buono === null ? "bg-slate-300" : buono ? "bg-emerald-500" : "bg-rose-500";
  const larghezza = scala > 0 ? Math.min(100, (Math.abs(delta) / scala) * 100) : 0;
  return (
    <div className="border border-slate-200 rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
        <div>
          <p className="font-bold text-sm text-slate-900">{label}</p>
          {descrizione && <p className="text-xs text-slate-500 mt-0.5">{descrizione}</p>}
        </div>
        <div className="text-right">
          <span className={`block text-xl font-extrabold font-mono ${colore}`}>
            {delta > 0 ? "+" : ""}{fmt(delta)}
          </span>
          <span className="block text-xs text-slate-500 font-mono">
            {variazione != null ? `${variazione > 0 ? "+" : ""}${(variazione * 100).toFixed(1).replace(".", ",")}%` : "var. % n.d."}
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div className={`h-full rounded-full ${barra}`} style={{ width: `${larghezza}%` }} />
      </div>
      <div className="flex justify-between text-xs font-mono text-slate-500">
        <span>T-1: <b className={(Number(prec) || 0) < 0 ? "text-rose-600" : "text-slate-700"}>{fmtC(Number(prec) || 0)}</b></span>
        <span>T: <b className={(Number(corr) || 0) < 0 ? "text-rose-600" : "text-slate-700"}>{fmtC(Number(corr) || 0)}</b></span>
      </div>
    </div>
  );
}

/* ---- Indicatore espandibile (modello IndicatoreEspandibile del CE) ----
   dettaglio: { formula, perche, cosaIndica, valutazione } — solo HTML/testo,
   nessuna formula in LaTeX. evidenzia: "ok"|"warn"|"bad"|"info" → semaforo
   a 3 fasce (verde/giallo/rosso, stile GRAVITA_STYLE). */
function IndicatoreEspandibile({ nome, valore, sub, dettaglio, evidenzia = "info" }) {
  const [aperto, setAperto] = useState(false);
  const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", info: "bg-slate-400" }[evidenzia];
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setAperto((a) => !a)}
        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-slate-50"
        aria-expanded={aperto}
      >
        <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${dot}`} title={evidenzia} />
        <span className="flex-1 font-bold text-sm text-slate-900">{nome}</span>
        <span className="text-right">
          <span className="block text-xl font-extrabold font-mono">{valore}</span>
          {sub && <span className="block text-xs text-slate-500 font-mono">{sub}</span>}
        </span>
        <span className="text-slate-400 text-sm">{aperto ? "▲" : "▼"}</span>
      </button>
      {aperto && dettaglio && (
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 space-y-3 text-sm leading-relaxed">
          {dettaglio.formula && (
            <p><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-0.5">Formula e calcolo</span><span className="font-mono text-xs text-slate-700">{dettaglio.formula}</span></p>
          )}
          {dettaglio.perche && (
            <p><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-0.5">Perché è importante</span><span className="text-slate-600">{dettaglio.perche}</span></p>
          )}
          {dettaglio.cosaIndica && (
            <p><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-0.5">Cosa indica</span><span className="text-slate-600">{dettaglio.cosaIndica}</span></p>
          )}
          {dettaglio.valutazione && (
            <p className={`px-3 py-2 rounded-lg border text-xs ${SEMAFORO_STYLE[evidenzia]}`}>{dettaglio.valutazione}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Accordion di livello FATTORE (raggruppa più IndicatoreEspandibile) ----
   Header con numero, titolo, badge di sintesi (semaforo a 3 fasce) e sintesi
   numerica; espande una descrizione teorica e i sotto-indicatori. Stesso
   linguaggio visivo di IndicatoreEspandibile per coerenza. */
const GIUDIZIO_LABEL = { ok: "Solido", warn: "Da monitorare", bad: "Critico", info: "n.d." };

function FattoreEspandibile({ numero, titolo, sintesi, giudizio = "info", descrizione, children, apertoDefault = false }) {
  const [aperto, setAperto] = useState(apertoDefault);
  const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", info: "bg-slate-400" }[giudizio];
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setAperto((a) => !a)}
        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-slate-50"
        aria-expanded={aperto}
      >
        <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold font-mono">{numero}</span>
        <span className="flex-1">
          <span className="block font-bold text-sm text-slate-900">{titolo}</span>
          {sintesi && <span className="block text-xs text-slate-500 mt-0.5">{sintesi}</span>}
        </span>
        <span className={`shrink-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${SEMAFORO_STYLE[giudizio]}`}>
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          {GIUDIZIO_LABEL[giudizio]}
        </span>
        <span className="text-slate-400 text-sm">{aperto ? "▲" : "▼"}</span>
      </button>
      {aperto && (
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60 space-y-4">
          {descrizione && <p className="text-sm text-slate-600 leading-relaxed">{descrizione}</p>}
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </div>
  );
}

const ESEMPIO_RF = {
  azienda: "Esempio S.p.A.",
  esercizio: "2025",
  fonte: "Esempio dimostrativo OIC 10 indiretto",
  schema: { schema: "oic10_indiretto", valuta: "EUR", unita: "migliaia", indizi: "Esempio precaricato" },
  cassaIniziale: 1250,
  cassaFinale: 1850,
  voci: [
    { nome: "Utile (perdita) dell'esercizio", importo: 820, classe: "flusso_operativo_corrente" },
    { nome: "Imposte sul reddito", importo: 310, classe: "flusso_operativo_corrente" },
    { nome: "Interessi passivi (al netto degli attivi)", importo: 145, classe: "flusso_operativo_corrente" },
    { nome: "Ammortamenti delle immobilizzazioni", importo: 640, classe: "flusso_operativo_corrente" },
    { nome: "Accantonamenti netti a TFR e fondi rischi", importo: 90, classe: "flusso_operativo_fondi" },
    { nome: "Decremento/(incremento) delle rimanenze", importo: -180, classe: "flusso_operativo_corrente" },
    { nome: "Decremento/(incremento) dei crediti verso clienti", importo: -260, classe: "flusso_operativo_corrente" },
    { nome: "Incremento/(decremento) dei debiti verso fornitori", importo: 130, classe: "flusso_operativo_corrente" },
    { nome: "Imposte sul reddito pagate", importo: -295, classe: "flusso_operativo_corrente" },
    { nome: "Investimenti in immobilizzazioni materiali", importo: -720, classe: "capex_uscite" },
    { nome: "Investimenti in immobilizzazioni immateriali", importo: -110, classe: "capex_uscite" },
    { nome: "Disinvestimenti di immobilizzazioni materiali", importo: 65, classe: "capex_entrate" },
    { nome: "Interessi incassati su titoli e depositi", importo: 22, classe: "finanza_attiva" },
    { nome: "Accensione nuovi finanziamenti a m/l termine", importo: 900, classe: "finanza_passiva_raccolta" },
    { nome: "Rimborso quote capitale finanziamenti", importo: -540, classe: "finanza_passiva_servizio" },
    { nome: "Interessi pagati", importo: -167, classe: "finanza_passiva_servizio" },
    { nome: "Dividendi pagati", importo: -250, classe: "equity_dividendi" },
  ],
};

/* Esercizio precedente dell'esempio: stessa struttura, grandezze
   leggermente diverse, così il tab «Variazioni e Trend» ha da subito
   dei Δ significativi da mostrare (motore operativo in crescita, CAPEX
   in forte accelerazione, FCFO in contrazione). */
const ESEMPIO_RF_PREC = {
  esercizio: "2024",
  fonte: "Esempio dimostrativo OIC 10 indiretto — comparativo",
  schema: { schema: "oic10_indiretto", valuta: "EUR", unita: "migliaia", indizi: "Esempio precaricato (colonna comparativa)" },
  cassaIniziale: 770,
  cassaFinale: 1250,
  voci: [
    { nome: "Utile (perdita) dell'esercizio", importo: 690, classe: "flusso_operativo_corrente" },
    { nome: "Imposte sul reddito", importo: 265, classe: "flusso_operativo_corrente" },
    { nome: "Interessi passivi (al netto degli attivi)", importo: 120, classe: "flusso_operativo_corrente" },
    { nome: "Ammortamenti delle immobilizzazioni", importo: 580, classe: "flusso_operativo_corrente" },
    { nome: "Accantonamenti netti a TFR e fondi rischi", importo: 75, classe: "flusso_operativo_fondi" },
    { nome: "Decremento/(incremento) delle rimanenze", importo: -95, classe: "flusso_operativo_corrente" },
    { nome: "Decremento/(incremento) dei crediti verso clienti", importo: -140, classe: "flusso_operativo_corrente" },
    { nome: "Incremento/(decremento) dei debiti verso fornitori", importo: 85, classe: "flusso_operativo_corrente" },
    { nome: "Imposte sul reddito pagate", importo: -250, classe: "flusso_operativo_corrente" },
    { nome: "Investimenti in immobilizzazioni materiali", importo: -430, classe: "capex_uscite" },
    { nome: "Investimenti in immobilizzazioni immateriali", importo: -70, classe: "capex_uscite" },
    { nome: "Disinvestimenti di immobilizzazioni materiali", importo: 40, classe: "capex_entrate" },
    { nome: "Interessi incassati su titoli e depositi", importo: 18, classe: "finanza_attiva" },
    { nome: "Accensione nuovi finanziamenti a m/l termine", importo: 400, classe: "finanza_passiva_raccolta" },
    { nome: "Rimborso quote capitale finanziamenti", importo: -490, classe: "finanza_passiva_servizio" },
    { nome: "Interessi pagati", importo: -138, classe: "finanza_passiva_servizio" },
    { nome: "Dividendi pagati", importo: -180, classe: "equity_dividendi" },
  ],
};

/* ============================================================
   COMPONENTE PRINCIPALE
   ============================================================ */

export default function RendicontoFinanziarioRiclassificato() {
  /* ---- stato base UI ---- */
  const [tab, setTab] = useState(1);
  const [statoIA, setStatoIA] = useState(null); // { tipo: "info"|"successo"|"errore", msg }
  const [caricamento, setCaricamento] = useState(false);
  const [caricamentoMaster, setCaricamentoMaster] = useState(false); // analisi bilancio completo (unico file)
  const [esporta, setEsporta] = useState(null); // { nome, testo, copiato }

  /* ---- configurazione IA (come modulo CE) ---- */
  const [provider, setProvider] = useState("claude");
  const [chiavi, setChiavi] = useState({ claude: "", openai: "", gemini: "" });
  const [mostraChiave, setMostraChiave] = useState(false);
  const [modello, setModello] = useState({
    claude: "claude-sonnet-4-6",
    openai: "gpt-4o-mini",
    gemini: "gemini-2.0-flash",
  });
  const apiKey = provider === "claude" ? (chiavi.claude || "__subscription__") : chiavi[provider];
  const iaAttiva = provider === "claude" || !!chiavi[provider];

  /* ---- dati del rendiconto ---- */
  const [voci, setVoci] = useState([]);
  const [azienda, setAzienda] = useState("");
  const [esercizio, setEsercizio] = useState("");
  const [schemaRF, setSchemaRF] = useState(null); // output Fase 0: { schema, valuta, unita, indizi }

  /* ---- Modalità Singolo Anno (opzionale) ----
     Quando attiva, l'IA estrae ESCLUSIVAMENTE l'anno indicato in
     annoSpecifico, riversandolo nelle sole sezioni dell'anno corrente (T),
     e la seconda passata automatica sul comparativo (T-1) viene bloccata. */
  const [modalitaSingoloAnno, setModalitaSingoloAnno] = useState(false);
  const [annoSpecifico, setAnnoSpecifico] = useState("");
  /* Modalità Singolo Anno · anno dei documenti caricati negli slot T-1.
     In questa modalità il T-1 non arriva dalla colonna comparativa del
     documento corrente ma da documenti AUTONOMI di un altro esercizio:
     serve quindi un secondo anno di riferimento. */
  const [annoSpecificoPrec, setAnnoSpecificoPrec] = useState("");

  /* Vincolo da iniettare nei prompt IA quando la modalità è attiva e l'anno
     è valorizzato, differenziato per slot di destinazione: annoSpecifico per
     il T, annoSpecificoPrec per il T-1. Vuoto in modalità normale → i prompt
     restano invariati. */
  const vincoloSingoloAnnoPer = (perPrec = false) => {
    const target = String(perPrec ? annoSpecificoPrec : annoSpecifico).trim();
    return modalitaSingoloAnno && target
      ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Estrai ESCLUSIVAMENTE i flussi finanziari, i dati e i valori relativi all'anno ${target}. Ignora qualsiasi colonna di confronto o dato riferito ad altri anni.`
      : "";
  };
  const vincoloSingoloAnno = vincoloSingoloAnnoPer(false);
  /* Anno atteso nello slot T-1: in Modalità Singolo Anno è quello dei
     documenti autonomi, altrimenti si desume dall'esercizio corrente. */
  const annoPrecComparativo = (() => {
    const m = String(esercizio || "").match(/\d{4}/);
    return m ? String(Number(m[0]) - 1) : "";
  })();
  const annoPrecTarget = modalitaSingoloAnno ? annoSpecificoPrec : annoPrecComparativo;
  const annoSingoloValido = !!annoValidoStr(annoSpecifico);
  const [cassaIniziale, setCassaIniziale] = useState(null);
  const [cassaFinale, setCassaFinale] = useState(null);
  const [fonte, setFonte] = useState(null);
  const [aliquotaFiscale, setAliquotaFiscale] = useState(24); // % per lo scudo fiscale (FCFO Unlevered)

  /* ---- Sezione 2 · Nota Integrativa ---- */
  const [niFile, setNiFile] = useState(null); // { nome, fonte }
  const [niEstratti, setNiEstratti] = useState([]);
  const [niRettifiche, setNiRettifiche] = useState([]);
  const [niRedFlags, setNiRedFlags] = useState([]);
  const [niFonte, setNiFonte] = useState(null);
  const [caricamentoNI, setCaricamentoNI] = useState(false);
  const niFirma = useRef(null);

  /* ---- Sezione 3 · Relazione sulla Gestione (RG) ---- */
  const [rgFile, setRgFile] = useState(null); // { nome, fonte }
  const [rgEstratti, setRgEstratti] = useState([]);
  const [rgRettifiche, setRgRettifiche] = useState([]);
  const [rgRedFlags, setRgRedFlags] = useState([]);
  const [rgFonte, setRgFonte] = useState(null);
  const [caricamentoRG, setCaricamentoRG] = useState(false);
  const rgFirma = useRef(null);

  /* ============================================================
     ESERCIZIO PRECEDENTE (T-1) — stati gemelli
     ============================================================
     Controparti esatte degli stati dell'esercizio corrente, come nei
     moduli SP e CE. Ogni stato T-1 è indipendente: può essere alimentato
     dalla seconda passata IA automatica (colonna comparativa dello stesso
     documento) oppure da file dedicati caricati a parte. */
  const [vociPrec, setVociPrec] = useState([]);
  const [esercizioPrec, setEsercizioPrec] = useState("");
  const [schemaRFPrec, setSchemaRFPrec] = useState(null);
  const [cassaInizialePrec, setCassaInizialePrec] = useState(null);
  const [cassaFinalePrec, setCassaFinalePrec] = useState(null);
  const [fontePrec, setFontePrec] = useState(null);

  const [niEstrattiPrec, setNiEstrattiPrec] = useState([]);
  const [niRettifichePrec, setNiRettifichePrec] = useState([]);
  const [niRedFlagsPrec, setNiRedFlagsPrec] = useState([]);
  const [niFontePrec, setNiFontePrec] = useState(null);

  const [rgEstrattiPrec, setRgEstrattiPrec] = useState([]);
  const [rgRettifichePrec, setRgRettifichePrec] = useState([]);
  const [rgRedFlagsPrec, setRgRedFlagsPrec] = useState([]);
  const [rgFontePrec, setRgFontePrec] = useState(null);

  const [statoIAPrec, setStatoIAPrec] = useState(null); // { tipo, msg } — canale di stato separato
  const [caricamentoPrec, setCaricamentoPrec] = useState(false);

  /* ---- Sezione 3 · JSON dei moduli SP e CE ---- */
  const [spData, setSpData] = useState(null);
  const [spFonte, setSpFonte] = useState(null);
  const [ceData, setCeData] = useState(null);
  const [ceFonte, setCeFonte] = useState(null);
  /* modalità di alimentazione della Sezione 3: "file" (JSON) o "manuale" */
  const [modoInputDati, setModoInputDati] = useState("file");
  const [spManCorr, setSpManCorr] = useState({}); // aggregati SP esercizio corrente
  const [spManPrec, setSpManPrec] = useState({}); // aggregati SP esercizio precedente
  const [spManAnni, setSpManAnni] = useState({ corr: "", prec: "" });
  const [ceMan, setCeMan] = useState({});         // grandezze CE inserite a mano

  const fileRF = useRef(null);
  const fileMaster = useRef(null);
  const fileNI = useRef(null);
  const fileRG = useRef(null);
  const fileJSON = useRef(null);
  const fileSP = useRef(null);
  const fileCE = useRef(null);
  /* input dedicati al caricamento separato dell'esercizio precedente */
  const fileRFPrec = useRef(null);
  const fileNIPrec = useRef(null);
  const fileRGPrec = useRef(null);

  /* ---- calcoli di sintesi per la validazione (tab 1) ---- */
  const sintesi = useMemo(() => {
    const attive = voci.filter((v) => v.classe !== "da_classificare");
    const somma = (pred) => attive.filter(pred).reduce((a, v) => a + (Number(v.importo) || 0), 0);
    const perArea = {};
    Object.keys(AREE_RF).forEach((a) => {
      perArea[a] = somma((v) => CLASSI_RF[v.classe]?.area === a);
    });
    const totale = Object.values(perArea).reduce((a, b) => a + b, 0);
    const daClassificare = voci.filter((v) => v.classe === "da_classificare").length;
    const segniAnomali = voci.filter((v) => {
      if (v.rettificaNI) return false;
      const s = CLASSI_RF[v.classe]?.segnoAtteso;
      const imp = Number(v.importo) || 0;
      return s != null && imp !== 0 && Math.sign(imp) !== s;
    }).length;
    /* quadratura con la cassa del DOCUMENTO: calcolata al lordo delle
       rettifiche NI per non generare falsi allarmi sugli storni non-cash */
    const totaleLordo = voci
      .filter((v) => v.classe !== "da_classificare" && !v.rettificaNI)
      .reduce((a, v) => a + (Number(v.importo) || 0), 0);
    const deltaCassa =
      cassaIniziale != null && cassaFinale != null ? Number(cassaFinale) - Number(cassaIniziale) : null;
    const quadra = deltaCassa != null && Math.abs(totaleLordo - deltaCassa) < tolleranzaMilioni(totaleLordo, deltaCassa);
    return { perArea, totale, totaleLordo, daClassificare, segniAnomali, deltaCassa, quadra };
  }, [voci, cassaIniziale, cassaFinale]);

  const nVociBase = voci.filter((v) => !v.rettificaNI).length;

  /* ---- calcoli di sintesi T-1 (gemelli del memo «sintesi») ---- */
  const sintesiPrec = useMemo(() => {
    const attive = vociPrec.filter((v) => v.classe !== "da_classificare");
    const somma = (pred) => attive.filter(pred).reduce((a, v) => a + (Number(v.importo) || 0), 0);
    const perArea = {};
    Object.keys(AREE_RF).forEach((a) => {
      perArea[a] = somma((v) => CLASSI_RF[v.classe]?.area === a);
    });
    const totale = Object.values(perArea).reduce((a, b) => a + b, 0);
    const daClassificare = vociPrec.filter((v) => v.classe === "da_classificare").length;
    const segniAnomali = vociPrec.filter((v) => {
      if (v.rettificaNI) return false;
      const s = CLASSI_RF[v.classe]?.segnoAtteso;
      const imp = Number(v.importo) || 0;
      return s != null && imp !== 0 && Math.sign(imp) !== s;
    }).length;
    const totaleLordo = vociPrec
      .filter((v) => v.classe !== "da_classificare" && !v.rettificaNI)
      .reduce((a, v) => a + (Number(v.importo) || 0), 0);
    const deltaCassa =
      cassaInizialePrec != null && cassaFinalePrec != null
        ? Number(cassaFinalePrec) - Number(cassaInizialePrec)
        : null;
    const quadra = deltaCassa != null && Math.abs(totaleLordo - deltaCassa) < tolleranzaMilioni(totaleLordo, deltaCassa);
    return { perArea, totale, totaleLordo, daClassificare, segniAnomali, deltaCassa, quadra };
  }, [vociPrec, cassaInizialePrec, cassaFinalePrec]);

  const nVociBasePrec = vociPrec.filter((v) => !v.rettificaNI).length;

  /* ---- Sezione 3: derivati SP/CE (nessuna chiamata IA) ----
     I dati possono arrivare da JSON (spData/ceData) o dall'inserimento
     manuale (spManObj/ceManObj), che vengono modellati nella STESSA forma
     dei JSON così le funzioni di calcolo restano uniche. La modalità
     attiva (modoInputDati) decide quale fonte alimenta i memo. */
  const spManObj = useMemo(() => {
    const anyC = CAMPI_SP.some(([k]) => spManCorr[k] !== undefined && spManCorr[k] !== "");
    const anyP = CAMPI_SP.some(([k]) => spManPrec[k] !== undefined && spManPrec[k] !== "");
    if (!anyC && !anyP) return null;
    const num = (o) => { const r = {}; CAMPI_SP.forEach(([k]) => { r[k] = Number(o[k]) || 0; }); return r; };
    return {
      esercizioCorrente: { esercizio: spManAnni.corr || null, aggregati: num(spManCorr) },
      esercizioPrecedente: { esercizio: spManAnni.prec || null, aggregati: num(spManPrec) },
      __manuale: true,
    };
  }, [spManCorr, spManPrec, spManAnni]);

  const ceManObj = useMemo(() => {
    const any = CAMPI_CE.some(([k]) => ceMan[k] !== undefined && ceMan[k] !== "");
    if (!any) return null;
    const a = {}; CAMPI_CE.forEach(([k]) => { a[k] = Number(ceMan[k]) || 0; });
    return { aggregatiManuali: a, esercizio: esercizio || null, __manuale: true };
  }, [ceMan, esercizio]);

  const spDelta = useMemo(
    () => calcolaDeltaPatrimoniali(modoInputDati === "manuale" ? spManObj : spData),
    [modoInputDati, spManObj, spData]
  );
  const ceCalc = useMemo(
    () => calcolaCeDaJson(modoInputDati === "manuale" ? ceManObj : ceData),
    [modoInputDati, ceManObj, ceData]
  );

  /* fonte effettiva (per le righe di stato), coerente con la modalità attiva */
  const spFonteEff = modoInputDati === "manuale" ? (spManObj ? "inserimento manuale" : null) : spFonte;
  const ceFonteEff = modoInputDati === "manuale" ? (ceManObj ? "inserimento manuale" : null) : ceFonte;

  /* ---- Sezione 4: cascata del rendiconto (voci corrette dalla NI) ---- */
  const rf = useMemo(() => calcolaRF(voci), [voci]);

  /* ---- Cascata dell'esercizio precedente: stesso motore, altre voci ---- */
  const rfPrec = useMemo(() => calcolaRF(vociPrec), [vociPrec]);

  /* ---- Δ FLUSSI — gemello di deltaEconomici dei moduli SP e CE ----
     Variazioni assolute (T − T-1) sui flussi chiave della cascata. Ogni
     riga porta con sé i due valori di partenza, il Δ assoluto e la
     variazione %, così la UI del tab «Variazioni e Trend» non deve
     ricalcolare nulla e l'oggetto è esportabile tale e quale nel JSON.
     `positivoBuono: false` marca le grandezze in cui la crescita è un
     assorbimento di cassa (CAPEX) e va letta in rosso. */
  const deltaFlussi = useMemo(() => {
    const disponibile = voci.length > 0 && vociPrec.length > 0;
    const riga = (chiave, positivoBuono = true) => {
      const corrente = Number(rf[chiave]) || 0;
      const precedente = Number(rfPrec[chiave]) || 0;
      const delta = corrente - precedente;
      return {
        corrente,
        precedente,
        delta,
        variazionePct: Math.abs(precedente) > 1e-9 ? delta / Math.abs(precedente) : null,
        positivoBuono,
      };
    };
    return {
      disponibile,
      esercizioCorrente: esercizio || null,
      esercizioPrecedente: esercizioPrec || null,
      flussoOperativoCorrente: riga("flussoOperativoCorrente"),
      capex: riga("capex", false),
      fcfo: riga("fcfo"),
      fcfe: riga("fcfe"),
      variazionePfnBt: riga("variazionePfnBt"),
      /* grandezze accessorie: utili in lettura ma fuori dai 5 flussi chiave */
      capexUscite: riga("capexUscite", false),
      servizioDelDebito: riga("servizioDelDebito"),
      variazioneLiquiditaTotale: riga("variazioneLiquiditaTotale"),
    };
  }, [rf, rfPrec, voci.length, vociPrec.length, esercizio, esercizioPrec]);

  /* ---- Check quadratura RF ↔ ΔLiquidità dello SP ----
     Confronta la somma dei flussi del RF (voci corrette dalle rettifiche NI)
     con la ΔLiquidità calcolata dallo SP. Tolleranza di arrotondamento: 1
     unità di esposizione. */
  const checkQuadratura = useMemo(() => {
    if (!spDelta || !voci.length) return null;
    const flussiRF = sintesi.totale; // POST rettifiche NI (voci corrette)
    const scarto = flussiRF - spDelta.deltaLiquidita;
    const ok = Math.abs(scarto) <= tolleranzaMilioni(flussiRF, spDelta.deltaLiquidita);
    return { flussiRF, deltaLiq: spDelta.deltaLiquidita, scarto, ok };
  }, [spDelta, voci.length, sintesi.totale]);

  /* ============================================================
     AUDIT DEL REVISORE — controlli deterministici (tab 10)
     ============================================================
     I controlli girano su due strati. Qui il primo:
     aritmetica e confronti meccanici, eseguiti in JavaScript,
     che non consumano token e danno sempre lo stesso esito sugli
     stessi dati. Il secondo strato (eseguiAuditIA) sottopone al
     modello i casi di giudizio, insieme a questi rilievi. I
     rilievi ancorati a una voce (idVoce + autoFix) diventano
     correggibili con un clic nel tab 10.
     ============================================================ */

  /* Voci «vere»: si escludono quelle generate dalle rettifiche (rettificaNI),
     non modificabili a mano e quindi non azionabili in un audit. */
  const vociBase = (vs) => (vs || []).filter((v) => !v.rettificaNI);

  /* ---- Memoria del sistema: prompt appresi dall'audit ----
     Vive accanto ai dati perché entra nei prompt usati dall'IA in estrazione e
     persiste nel localStorage del browser, così le regole apprese sopravvivono
     al reload e ai cambi di bilancio. ---- */
  const [systemPrompts, setSystemPrompts] = useState(() => caricaSystemPrompts());
  /* unico punto di persistenza: stato React + localStorage in un colpo solo */
  const salvaSystemPrompts = (next) => { setSystemPrompts(next); scriviSystemPrompts(next); };
  const resetSystemPrompts = () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(RF_PROMPTS_KEY);
    } catch { /* noop */ }
    setSystemPrompts(promptsDiDefaultRF());
  };
  /* Esiti delle azioni per chiave di anomalia: { [key]: { fix: bool, learn: bool } } */
  const [auditAzioni, setAuditAzioni] = useState({});

  const auditLocale = useMemo(() => {
    const rilievi = [];
    const agg = (r) => rilievi.push(r);
    const nomeAnno = (prec) => (prec ? esercizioPrec || "T-1" : esercizio || "T");
    const sezione = (prec) => (prec ? "Tab 7 · Dati & Validazione T-1" : "Tab 1 · Dati & Validazione");

    const baseT = vociBase(voci);
    const baseT1 = vociBase(vociPrec);

    /* ---- Controllo 1 · convenzione dei segni ---- */
    const verificaSegni = (vs, prec) => {
      vs.forEach((v) => {
        const cls = CLASSI_RF[v.classe];
        const atteso = cls?.segnoAtteso;
        const imp = Number(v.importo) || 0;
        if (atteso == null || imp === 0) return;
        if (Math.sign(imp) !== atteso) {
          const verso = atteso === -1 ? "un'uscita" : "un'entrata";
          agg({
            controllo: 1, gravita: "grave", anno: nomeAnno(prec), sezione: sezione(prec),
            voce: v.nome || "(voce senza nome)",
            /* L'ancoraggio rende il rilievo correggibile con un clic: la classe
               è quella dichiarata dall'analista, quindi il fix reversibile è
               l'inversione del segno, non un cambio di classe. */
            idVoce: v.id, esercizio: prec ? "precedente" : "corrente",
            autoFix: {
              tipo: "invertiSegno",
              etichetta: `✨ Inverti il segno in ${fmt(-imp)}`,
            },
            errore: `ERRORE GRAVE — segno contrario alla natura della classe: «${cls.label}» rappresenta ${verso} e richiede importo ${atteso === -1 ? "NEGATIVO" : "POSITIVO"}, ma la voce vale ${fmt(imp)}. Con questo segno la cascata somma il flusso nella direzione sbagliata, con un effetto doppio sul totale.`,
            azione: `Inverti il segno dell'importo portandolo a ${fmt(-imp)}. Se invece il segno del documento è corretto, la classe è sbagliata: cambiala dalla tendina.`,
          });
        }
      });
    };
    verificaSegni(baseT, false);
    verificaSegni(baseT1, true);

    /* ---- Controllo 2 · quadratura con i saldi di cassa ----
       Il confronto avviene al LORDO delle rettifiche: gli storni non monetari
       correggono i flussi ma non toccano i saldi di cassa del documento, quindi
       includerli genererebbe un falso scarto. */
    const verificaQuadratura = (vs, cIni, cFin, prec) => {
      if (cIni == null || cFin == null) {
        agg({
          controllo: 2, gravita: "medio", anno: nomeAnno(prec), sezione: sezione(prec),
          voce: "Disponibilità liquide iniziali e finali",
          errore: `Saldi di cassa non disponibili per ${nomeAnno(prec)}: la quadratura fra somma dei flussi e variazione della liquidità non è verificabile, e con essa il controllo più efficace sull'estrazione.`,
          azione: `Compila i campi «cassa iniziale» e «cassa finale» dell'esercizio ${nomeAnno(prec)} leggendoli dal rendiconto.`,
        });
        return null;
      }
      const totale = vs
        .filter((v) => v.classe !== "da_classificare")
        .reduce((a, v) => a + (Number(v.importo) || 0), 0);
      const deltaCassa = Number(cFin) - Number(cIni);
      const scarto = totale - deltaCassa;
      const AUDIT_TOLLERANZA_RF = tolleranzaMilioni(totale, deltaCassa, cIni, cFin);
      if (Math.abs(scarto) <= AUDIT_TOLLERANZA_RF) return { totale, deltaCassa, scarto, ok: true };

      /* Attribuzione dello scarto. Uno scarto pari al DOPPIO di una voce indica
         quasi sempre un segno invertito su quella voce; uno scarto pari a una
         voce indica un flusso mancante o duplicato. */
      const candidatiSegno = vs.filter(
        (v) => Math.abs(2 * (Number(v.importo) || 0) - scarto) <= AUDIT_TOLLERANZA_RF && Number(v.importo) !== 0
      );
      const candidatiMancanti = vs.filter(
        (v) => Math.abs((Number(v.importo) || 0) - scarto) <= AUDIT_TOLLERANZA_RF && Number(v.importo) !== 0
      );
      const orfane = vs.filter((v) => v.classe === "da_classificare");
      const sommaOrfane = orfane.reduce((a, v) => a + (Number(v.importo) || 0), 0);

      let pista;
      if (candidatiSegno.length)
        pista = `Lo scarto è esattamente il doppio di «${candidatiSegno[0].nome}» (${fmt(candidatiSegno[0].importo)}): quella voce ha con ogni probabilità il segno invertito.`;
      else if (Math.abs(sommaOrfane - scarto) <= AUDIT_TOLLERANZA_RF && orfane.length)
        pista = `Lo scarto coincide con la somma delle ${orfane.length} voci ancora in «da_classificare», che sono escluse dai totali: classificarle chiude la quadratura.`;
      else if (candidatiMancanti.length)
        pista = `Lo scarto coincide con «${candidatiMancanti[0].nome}» (${fmt(candidatiMancanti[0].importo)}): quella voce potrebbe essere stata duplicata in estrazione, oppure ne manca una di pari importo e segno opposto.`;
      else pista = `Nessuna singola voce spiega lo scarto: probabilmente manca un flusso in estrazione oppure un importo è stato letto male.`;

      agg({
        controllo: 2, gravita: "grave", anno: nomeAnno(prec), sezione: sezione(prec),
        voce: "Quadratura complessiva della cassa",
        errore: `ERRORE GRAVE — la somma dei flussi (${fmt(totale)}) non coincide con la variazione della liquidità (${fmt(cFin)} − ${fmt(cIni)} = ${fmt(deltaCassa)}). Scarto: ${fmt(scarto)}. ${pista}`,
        azione: candidatiSegno.length
          ? `Verifica la voce «${candidatiSegno[0].nome}» e, se il segno è errato, invertilo.`
          : orfane.length
          ? `Classifica le voci ancora in «da_classificare» e ricontrolla la quadratura.`
          : `Confronta voce per voce l'elenco estratto con il rendiconto originale: manca un flusso o un importo è stato letto male.`,
      });
      return { totale, deltaCassa, scarto, ok: false };
    };

    const quadraturaT = verificaQuadratura(baseT, cassaIniziale, cassaFinale, false);
    const quadraturaT1 = baseT1.length ? verificaQuadratura(baseT1, cassaInizialePrec, cassaFinalePrec, true) : null;

    /* ---- Controllo 3 · coerenza di classificazione fra gli esercizi ---- */
    const indicizza = (vs) => {
      const m = new Map();
      vs.forEach((v) => {
        const k = auditNormalizzaNome(v.nome);
        if (!k) return;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(v);
      });
      return m;
    };
    const classiIncoerenti = [];
    if (baseT.length && baseT1.length) {
      const mapT = indicizza(baseT);
      const mapT1 = indicizza(baseT1);
      mapT.forEach((lista, chiave) => {
        const gemelle = mapT1.get(chiave);
        if (!gemelle) {
          agg({
            controllo: 3, gravita: "info", anno: nomeAnno(false), sezione: sezione(false),
            voce: lista[0].nome,
            errore: `La voce non trova corrispondenza in ${nomeAnno(true)}: il confronto fra esercizi su questo flusso non è verificabile.`,
            azione: `Verifica in ${nomeAnno(true)} se la stessa posta compare sotto un nome diverso e allinea la denominazione; se il flusso è effettivamente nuovo, ignora la segnalazione.`,
          });
          return;
        }
        const cT = lista[0].classe;
        const cT1 = gemelle[0].classe;
        if (cT !== cT1) {
          classiIncoerenti.push({ nome: lista[0].nome, cT, cT1 });
          agg({
            controllo: 3, gravita: "grave", anno: `${nomeAnno(false)} / ${nomeAnno(true)}`, sezione: "Tab 7 · Dati & Validazione T-1",
            voce: lista[0].nome,
            /* L'ancoraggio è sulla voce di T-1 perché l'auto-fix proposto
               allinea il comparativo all'esercizio corrente: è la scelta
               reversibile, e il testo lascia esplicita l'alternativa. */
            idVoce: gemelle[0].id, esercizio: "precedente",
            autoFix: {
              tipo: "cambiaClasse", nuovaClasse: cT,
              etichetta: `✨ Allinea ${nomeAnno(true)} a ${cT}`,
            },
            errore: `ERRORE GRAVE — stesso flusso classificato in modo diverso nei due esercizi: ${CLASSI_RF[cT]?.label || cT} in ${nomeAnno(false)}, ${CLASSI_RF[cT1]?.label || cT1} in ${nomeAnno(true)}. FCFO, FCFE e Δ flussi confrontano perimetri diversi.`,
            azione: `Decidi la classe corretta e allineala: cambia la classe dalla tendina in ${cT} nel tab 7, oppure in ${cT1} nel tab 1.`,
          });
        }
      });
      mapT1.forEach((lista, chiave) => {
        if (mapT.has(chiave)) return;
        agg({
          controllo: 3, gravita: "info", anno: nomeAnno(true), sezione: sezione(true),
          voce: lista[0].nome,
          errore: `La voce non trova corrispondenza in ${nomeAnno(false)}: flusso cessato oppure rinominato.`,
          azione: `Verifica in ${nomeAnno(false)} se la stessa posta compare sotto un altro nome e allinea la denominazione.`,
        });
      });
    }

    /* ---- Controllo 4 · rettifiche: scomposizione del debito e storni non-cash ---- */
    const verificaRettifiche = (retts, vs, prec, fonte) => {
      const attive = (retts || []).filter((r) => r.attiva);
      if (!attive.length) return { presenti: 0, scomposizioni: 0, nonCash: 0 };

      let scomposizioni = 0;
      let nonCash = 0;
      const perOrigine = {};

      attive.forEach((r) => {
        const imp = Number(r.importo) || 0;
        if (r.tipo === "scomposizione_debito") {
          scomposizioni++;
          perOrigine[r.classeOrigine] = (perOrigine[r.classeOrigine] || 0) + imp;
          if (imp > 0 && r.classeDestinazione !== "finanza_passiva_raccolta")
            agg({
              controllo: 4, gravita: "grave", anno: nomeAnno(prec), sezione: fonte,
              voce: r.descrizione,
              errore: `Scomposizione del debito con importo positivo (${fmt(imp)}), quindi componente di RACCOLTA, ma destinata a ${CLASSI_RF[r.classeDestinazione]?.label || r.classeDestinazione || "nessuna classe"}. La raccolta va imputata a finanza_passiva_raccolta.`,
              azione: `Cambia la classe di destinazione della rettifica «${r.descrizione}» in finanza_passiva_raccolta.`,
            });
          if (imp < 0 && r.classeDestinazione !== "finanza_passiva_servizio")
            agg({
              controllo: 4, gravita: "grave", anno: nomeAnno(prec), sezione: fonte,
              voce: r.descrizione,
              errore: `Scomposizione del debito con importo negativo (${fmt(imp)}), quindi componente di RIMBORSO, ma destinata a ${CLASSI_RF[r.classeDestinazione]?.label || r.classeDestinazione || "nessuna classe"}. Il rimborso va imputato a finanza_passiva_servizio.`,
              azione: `Cambia la classe di destinazione della rettifica «${r.descrizione}» in finanza_passiva_servizio.`,
            });
        }
        if (r.tipo === "non_cash") {
          nonCash++;
          if (r.classeDestinazione)
            agg({
              controllo: 4, gravita: "grave", anno: nomeAnno(prec), sezione: fonte,
              voce: r.descrizione,
              errore: `Storno non-cash con classe di destinazione valorizzata (${CLASSI_RF[r.classeDestinazione]?.label || r.classeDestinazione}). Una posta non monetaria va soltanto neutralizzata: la destinazione la reimmette nella cascata come se fosse un flusso di cassa reale.`,
              azione: `Azzera la classe di destinazione della rettifica «${r.descrizione}»: deve restare vuota.`,
            });
        }
        if (imp === 0)
          agg({
            controllo: 4, gravita: "medio", anno: nomeAnno(prec), sezione: fonte,
            voce: r.descrizione,
            errore: `Rettifica attiva di importo nullo: non produce alcun effetto sulla cascata.`,
            azione: `Inserisci l'importo corretto della rettifica «${r.descrizione}» oppure disattivala.`,
          });
        if (!CLASSI_RF[r.classeOrigine])
          agg({
            controllo: 4, gravita: "grave", anno: nomeAnno(prec), sezione: fonte,
            voce: r.descrizione,
            errore: `Classe di origine non riconosciuta (${r.classeOrigine || "assente"}): la rettifica viene ignorata e non genera alcuno storno.`,
            azione: `Assegna alla rettifica «${r.descrizione}» la classe di origine corretta.`,
          });
      });

      /* La somma delle scomposizioni su una classe deve corrispondere alla
         variazione netta esposta dalla voce originaria di quella classe. */
      Object.entries(perOrigine).forEach(([classe, sommaScomp]) => {
        const netto = vs
          .filter((v) => !v.rettificaNI && v.classe === classe)
          .reduce((a, v) => a + (Number(v.importo) || 0), 0);
        if (Math.abs(sommaScomp - netto) > tolleranzaMilioni(sommaScomp, netto))
          agg({
            controllo: 4, gravita: "grave", anno: nomeAnno(prec), sezione: fonte,
            voce: `Scomposizioni con origine ${CLASSI_RF[classe]?.label || classe}`,
            errore: `La somma delle componenti scomposte (${fmt(sommaScomp)}) non coincide con la variazione netta della classe di origine (${fmt(netto)}). Scarto: ${fmt(sommaScomp - netto)}. Raccolta e rimborso devono ricostruire esattamente il netto esposto nel rendiconto, altrimenti la scomposizione crea o distrugge cassa.`,
            azione: `Correggi gli importi delle rettifiche di scomposizione con origine ${classe} finché la loro somma non è pari a ${fmt(netto)}.`,
          });
      });

      return { presenti: attive.length, scomposizioni, nonCash };
    };

    const rettT = verificaRettifiche([...(niRettifiche || []), ...(rgRettifiche || [])], voci, false, "Tab 2 · NI / Tab 3 · RG");
    const rettT1 = verificaRettifiche([...(niRettifichePrec || []), ...(rgRettifichePrec || [])], vociPrec, true, "Tab 2 · NI (T-1) / Tab 3 · RG (T-1)");

    /* ---- Controllo 5 · voci orfane ---- */
    const verificaOrfane = (vs, gemelle, prec) => {
      vs.filter((v) => v.classe === "da_classificare").forEach((v) => {
        const suggerita = auditSuggerisciClasseRF(v.nome);
        const gemella = gemelle.find(
          (g) => auditNormalizzaNome(g.nome) === auditNormalizzaNome(v.nome) && g.classe !== "da_classificare"
        );
        const finale = gemella?.classe || suggerita;
        const imp = Number(v.importo) || 0;
        agg({
          controllo: 5, gravita: "grave", anno: nomeAnno(prec), sezione: sezione(prec),
          voce: v.nome || "(voce senza nome)",
          idVoce: v.id, esercizio: prec ? "precedente" : "corrente",
          /* Il fix c'è solo se una classe è davvero deducibile: dalla gemella
             dell'altro esercizio, altrimenti dal nome. Senza indizi il rilievo
             resta segnalazione pura e la scelta torna all'utente. */
          autoFix: finale
            ? {
                tipo: "cambiaClasse", nuovaClasse: finale,
                etichetta: `✨ Classifica in ${finale}`,
              }
            : null,
          errore: `Voce orfana: resta in «da_classificare» ed è quindi ESCLUSA da tutti i totali e dalla quadratura. Importo non considerato: ${fmt(imp)}.`,
          azione: finale
            ? `Cambia la classe dalla tendina in ${finale}${gemella ? " (come la voce omonima dell'altro esercizio)" : " (suggerita dal nome della voce)"}.${
                CLASSI_RF[finale]?.segnoAtteso != null && Math.sign(imp) !== CLASSI_RF[finale].segnoAtteso && imp !== 0
                  ? ` Attenzione: con quella classe il segno atteso è ${CLASSI_RF[finale].segnoAtteso === -1 ? "negativo" : "positivo"}, quindi verifica anche l'importo.`
                  : ""
              }`
            : `Assegna una classe dalla tendina: il nome della voce non consente di dedurla automaticamente.`,
        });
      });
    };
    verificaOrfane(baseT, baseT1, false);
    verificaOrfane(baseT1, baseT, true);

    const gravi = rilievi.filter((r) => r.gravita === "grave").length;
    const medi = rilievi.filter((r) => r.gravita === "medio").length;
    return {
      rilievi, gravi, medi, info: rilievi.length - gravi - medi,
      quadraturaT, quadraturaT1, rettT, rettT1,
      dueAnni: baseT.length > 0 && baseT1.length > 0,
      superato: gravi === 0 && medi === 0,
    };
  }, [
    voci, vociPrec, cassaIniziale, cassaFinale, cassaInizialePrec, cassaFinalePrec,
    niRettifiche, niRettifichePrec, rgRettifiche, rgRettifichePrec, esercizio, esercizioPrec,
  ]);

  /* ---- Secondo strato: revisione IA sui casi di giudizio ---- */
  const [auditIA, setAuditIA] = useState({
    loading: false, errore: null, righe: null, sintesi: null, esito: null,
    anomalie: null, scartate: 0, quando: null, messaggioGenerale: null,
  });

  /* Elenco delle voci nel formato atteso dal prompt del revisore: l'id in
     testa è ciò che permette all'IA di ancorare ogni anomalia a una voce
     esatta, e all'applicazione di correggerla con un clic. */
  const elencoVociAudit = (arr) => {
    const vs = vociBase(arr);
    return vs.length
      ? vs.map((v) => `[${v.id}] ${v.nome} | ${Number(v.importo) || 0} | ${v.classe}`).join("\n")
      : "(nessuna voce presente per questo esercizio)";
  };

  /* ============================================================
     AUDIT UNIFICATO — fusione dei due strati
     ============================================================
     Un solo elenco di anomalie, due fonti. I controlli deterministici
     (fonte "auto") sono sempre presenti, gratuiti e ricalcolati a ogni
     modifica; la revisione IA (fonte "ia") si aggiunge su richiesta.
     Quando entrambi colpiscono la STESSA voce sullo STESSO controllo la
     segnalazione è una sola, marcata "auto+ia".
     ============================================================ */
  const auditUnificato = useMemo(() => {
    const items = [];
    const perAncora = new Map(); // "esercizio:idVoce:controllo" → item già presente

    const indiceVoci = new Map();
    vociBase(voci).forEach((v) => indiceVoci.set(v.id, { voce: v, esercizio: "corrente" }));
    vociBase(vociPrec).forEach((v) => indiceVoci.set(v.id, { voce: v, esercizio: "precedente" }));

    /* ---- Strato 1 · controlli deterministici ---- */
    (auditLocale.rilievi || []).forEach((r, i) => {
      const controllo = CONTROLLO_UNIFICATO[r.controllo] || r.controllo;
      const hit = r.idVoce ? indiceVoci.get(r.idVoce) : null;
      /* Un rilievo ancorato a una voce che nel frattempo è stata eliminata o
         corretta non deve sopravvivere come fantasma: l'ancoraggio decade. */
      const idVoce = hit ? r.idVoce : null;
      const autoFix = idVoce && r.autoFix ? { eseguibile: true, ...r.autoFix } : { eseguibile: false };
      const item = {
        /* chiave stabile e senza collisioni: due rilievi diversi possono
           insistere sulla stessa voce e sullo stesso controllo, quindi
           l'indice resta come discriminante. */
        key: `auto_${i}_${controllo}_${idVoce || "x"}`,
        fonte: "auto",
        controllo,
        gravita: r.gravita,
        titolo: CHECKLIST_RF[controllo] || "Rilievo",
        voce: r.voce,
        idVoce,
        esercizio: idVoce ? r.esercizio : null,
        importo: hit ? Number(hit.voce.importo) || 0 : null,
        classeAttuale: hit ? hit.voce.classe : null,
        anno: r.anno,
        sezione: r.sezione,
        tab: tabDaSezione(r.sezione),
        errore: r.errore,
        azione: r.azione,
        autoFix,
        promptUpdateSuggestion: null,
        spiegazioneIA: null,
      };
      items.push(item);
      const ancora = `${r.esercizio}:${idVoce}:${controllo}`;
      if (idVoce && !perAncora.has(ancora)) perAncora.set(ancora, item);
    });

    /* ---- Strato 2 · revisione IA ---- */
    (auditIA.anomalie || []).forEach((a, i) => {
      const elimina_ = a.autoFix?.nuovaClasse === "ELIMINA";
      const inverti_ = a.autoFix?.nuovaClasse === "INVERTI_SEGNO";
      const azione = a.autoFix?.eseguibile
        ? elimina_
          ? "Elimina la voce dal prospetto: non è un flusso di cassa, oppure è un subtotale o un duplicato."
          : inverti_
          ? `Inverti il segno dell'importo portandolo a ${fmt(-(a.importo || 0))}.`
          : `Cambia la classe in ${a.autoFix.nuovaClasse}.`
        : "Correzione non automatizzabile: intervieni a mano nel tab dei dati.";
      const chiave = `${a.esercizio}:${a.idVoce}:${a.controllo}`;
      const gemello = a.controllo ? perAncora.get(chiave) : null;

      if (gemello) {
        /* Fusione: il rilievo deterministico è confermato dall'IA. */
        gemello.fonte = "auto+ia";
        gemello.spiegazioneIA = a.spiegazioneErrore;
        gemello.promptUpdateSuggestion = a.promptUpdateSuggestion;
        if (a.gravita === "grave") gemello.gravita = "grave";
        /* L'auto-fix dell'IA prevale solo se quello deterministico non c'è:
           sui fatti meccanici il calcolo locale resta la fonte migliore. */
        if (!gemello.autoFix.eseguibile && a.autoFix?.eseguibile) {
          gemello.autoFix = {
            eseguibile: true,
            tipo: elimina_ ? "elimina" : inverti_ ? "invertiSegno" : "cambiaClasse",
            nuovaClasse: elimina_ || inverti_ ? null : a.autoFix.nuovaClasse,
            etichetta: elimina_
              ? "🗑 Elimina in automatico"
              : inverti_
              ? `✨ Inverti il segno in ${fmt(-(a.importo || 0))}`
              : `✨ Correggi in ${a.autoFix.nuovaClasse}`,
          };
          gemello.azione = azione;
        }
        return;
      }

      items.push({
        key: `ia_${i}_${a.idVoce}`,
        fonte: "ia",
        controllo: a.controllo,
        gravita: a.gravita,
        titolo: a.titoloErrore || CHECKLIST_RF[a.controllo] || "Anomalia rilevata",
        voce: a.nomeVoce,
        idVoce: a.idVoce,
        esercizio: a.esercizio,
        importo: a.importo,
        classeAttuale: a.classeAttuale,
        anno: a.esercizio === "corrente" ? esercizio || "T" : esercizioPrec || "T-1",
        sezione: a.esercizio === "corrente" ? "Tab 1 · Dati & Validazione" : "Tab 7 · Dati & Validazione T-1",
        tab: a.esercizio === "corrente" ? 1 : 7,
        errore: a.spiegazioneErrore,
        azione,
        autoFix: a.autoFix?.eseguibile
          ? {
              eseguibile: true,
              tipo: elimina_ ? "elimina" : inverti_ ? "invertiSegno" : "cambiaClasse",
              nuovaClasse: elimina_ || inverti_ ? null : a.autoFix.nuovaClasse,
              etichetta: elimina_
                ? "🗑 Elimina in automatico"
                : inverti_
                ? `✨ Inverti il segno in ${fmt(-(a.importo || 0))}`
                : `✨ Correggi in ${a.autoFix.nuovaClasse}`,
            }
          : { eseguibile: false },
        promptUpdateSuggestion: a.promptUpdateSuggestion,
        spiegazioneIA: null,
      });
    });

    items.sort(
      (x, y) =>
        (ORDINE_GRAVITA[x.gravita] ?? 3) - (ORDINE_GRAVITA[y.gravita] ?? 3) ||
        (x.controllo || 99) - (y.controllo || 99)
    );

    const gravi = items.filter((r) => r.gravita === "grave").length;
    const medi = items.filter((r) => r.gravita === "medio").length;
    return {
      items,
      gravi,
      medi,
      info: items.length - gravi - medi,
      correggibili: items.filter((r) => r.autoFix.eseguibile).length,
      insegnabili: items.filter((r) => r.promptUpdateSuggestion).length,
      fusi: items.filter((r) => r.fonte === "auto+ia").length,
    };
  }, [auditLocale, auditIA.anomalie, voci, vociPrec, esercizio, esercizioPrec]);

  const eseguiAuditIA = async () => {
    if (!iaAttiva) {
      setAuditIA((s) => ({ ...s, errore: "Configura il provider IA nel pannello «Configurazione IA» per eseguire questa analisi." }));
      return;
    }
    if (!vociBase(voci).length && !vociBase(vociPrec).length) {
      setAuditIA((s) => ({ ...s, errore: "Nessuna voce da controllare: carica e valida almeno un esercizio nel tab «Dati & Validazione»." }));
      return;
    }
    setAuditIA({
      loading: true, errore: null, righe: null, sintesi: null, esito: null,
      anomalie: null, scartate: 0, quando: null, messaggioGenerale: null,
    });
    setAuditAzioni({});
    try {
      const rettCompatte = (a, b) =>
        [...(a || []), ...(b || [])]
          .filter((r) => r.attiva)
          .map((r) => ({
            descrizione: r.descrizione, importo: Number(r.importo) || 0, tipo: r.tipo,
            classeOrigine: r.classeOrigine, classeDestinazione: r.classeDestinazione || null,
          }));

      /* Contesto analitico: saldi, rettifiche, cascata, delta e rilievi
         deterministici. Le VOCI viaggiano invece negli elenchi con id, non
         qui, per non duplicarle nel prompt. */
      const dati = {
        azienda,
        schemaRF,
        esercizioCorrente: {
          esercizio,
          cassaIniziale, cassaFinale,
          rettifiche: rettCompatte(niRettifiche, rgRettifiche),
          cascata: {
            flussoOperativoCorrente: rf.flussoOperativoCorrente, capex: rf.capex,
            fcfo: rf.fcfo, fcfe: rf.fcfe, variazioneLiquiditaTotale: rf.variazioneLiquiditaTotale,
          },
        },
        esercizioPrecedente: {
          esercizio: esercizioPrec,
          cassaIniziale: cassaInizialePrec, cassaFinale: cassaFinalePrec,
          rettifiche: rettCompatte(niRettifichePrec, rgRettifichePrec),
          cascata: {
            flussoOperativoCorrente: rfPrec.flussoOperativoCorrente, capex: rfPrec.capex,
            fcfo: rfPrec.fcfo, fcfe: rfPrec.fcfe, variazioneLiquiditaTotale: rfPrec.variazioneLiquiditaTotale,
          },
        },
        deltaFlussi: deltaFlussi.disponibile ? deltaFlussi : null,
        /* I rilievi deterministici viaggiano già rinumerati sulla scala
           canonica in 8 punti, la stessa che il prompt chiede di usare: senza
           la rimappatura il modello leggerebbe «controllo 2» intendendo le
           duplicazioni mentre l'applicazione intende la quadratura. */
        rilieviAutomatici: auditLocale.rilievi.map((r) => ({
          controllo: CONTROLLO_UNIFICATO[r.controllo] || r.controllo,
          gravita: r.gravita, voce: r.voce, errore: r.errore,
        })),
      };

      const schemaTxt = schemaRF?.schema
        ? `SCHEMA CONTABILE RICONOSCIUTO: ${SCHEMI_RF_LABEL[schemaRF.schema] || schemaRF.schema}${schemaRF.valuta ? ` — valuta ${schemaRF.valuta}` : ""}${schemaRF.unita ? ` — importi espressi in ${schemaRF.unita}` : ""}.${
            schemaRF.schema === "oic10_diretto"
              ? "\nATTENZIONE: metodo DIRETTO — il rendiconto espone incassi e pagamenti lordi e non i margini intermedi del metodo indiretto: non pretendere di ritrovare l'utile d'esercizio in testa all'area operativa."
              : schemaRF.schema === "ias7"
              ? "\nSchema IAS 7: interessi e dividendi possono comparire in sezioni diverse a seconda della policy adottata; ciò che conta è la coerenza fra i due esercizi e la classificazione per natura."
              : ""
          }`
        : "SCHEMA CONTABILE NON RICONOSCIUTO: applica il principio di prevalenza della sostanza economica sulla forma.";

      const classiTxt = Object.entries(CLASSI_RF)
        .map(([k, v]) => `- ${k}: ${v.label} · area ${v.area || "—"}${v.segnoAtteso ? ` · segno atteso ${v.segnoAtteso === -1 ? "NEGATIVO" : "POSITIVO"}` : ""}`)
        .join("\n");

      const prompt = buildAuditPromptRF({
        annoCorr: esercizio || "T",
        annoPrec: esercizioPrec || "T-1",
        vociTxt: elencoVociAudit(voci),
        vociPrecTxt: elencoVociAudit(vociPrec),
        schemaTxt,
        classiTxt,
        regoleTxt: bloccoRegoleRF(systemPrompts.regoleApprese),
        datiTxt: JSON.stringify(dati),
      });

      const raw = await chiamaIAConRitentativi({ provider, apiKey, model: modello[provider], prompt });
      const data = parseJsonRobusto(raw);

      const anomalie = sanificaAnomalieRF(data, vociBase(voci), vociBase(vociPrec));
      const esito = anomalie.length === 0 ? "superato" : "errori";
      const grezze = Array.isArray(data?.anomalie) ? data.anomalie.length : 0;

      /* Vista appiattita per «Copia l'audit». */
      const righe = anomalie.map((a) => ({
        anno: a.esercizio === "corrente" ? esercizio : esercizioPrec,
        sezione: a.esercizio === "corrente" ? "Tab 1 · Dati & Validazione" : "Tab 7 · Dati & Validazione T-1",
        voce: a.nomeVoce,
        errore: a.spiegazioneErrore,
        azione: a.autoFix.eseguibile
          ? a.autoFix.nuovaClasse === "ELIMINA"
            ? "Elimina la voce dal prospetto (non è un flusso di cassa, oppure è un subtotale o un duplicato)"
            : a.autoFix.nuovaClasse === "INVERTI_SEGNO"
            ? `Inverti il segno dell'importo portandolo a ${fmt(-(a.importo || 0))}`
            : `Cambia la classe in ${a.autoFix.nuovaClasse}`
          : "Correzione non automatizzabile: intervieni a mano nel tab dei dati",
        gravita: a.gravita,
        controllo: a.controllo,
      }));

      setAuditIA({
        loading: false,
        errore: null,
        esito,
        sintesi: String(data?.sintesi || "").trim() || null,
        messaggioGenerale:
          String(data?.messaggioGenerale || data?.sintesi || "").trim() ||
          (esito === "superato"
            ? "Il controllo non ha rilevato violazioni della checklist sui dati validati."
            : `Il controllo ha rilevato ${anomalie.length} anomalie da esaminare.`),
        anomalie,
        righe,
        scartate: Math.max(grezze - anomalie.length, 0),
        quando: new Date().toLocaleString("it-IT"),
      });
    } catch (e) {
      setAuditIA({
        loading: false, errore: e?.message || String(e), righe: null, sintesi: null,
        esito: null, anomalie: null, scartate: 0, quando: null, messaggioGenerale: null,
      });
    }
  };

  /* Testo dell'audit in formato copiabile, nella struttura a lista puntata. */
  const auditTestuale = () => {
    const etichettaFonte = {
      auto: "controllo automatico",
      ia: "revisione IA",
      "auto+ia": "controllo automatico, confermato dall'IA",
    };
    const righe = auditUnificato.items.map((r) => ({
      anno: r.anno,
      sezione: r.sezione,
      voce: r.voce,
      errore: r.spiegazioneIA ? `${r.errore} — Nota del revisore IA: ${r.spiegazioneIA}` : r.errore,
      azione: r.azione,
      fonte: etichettaFonte[r.fonte] || r.fonte,
      controllo: r.controllo,
    }));
    if (!righe.length)
      return "Audit superato. I flussi quadrano con i saldi di cassa in entrambi gli esercizi, i segni rispettano i principi contabili e la classificazione è coerente anno su anno. Nessuna correzione manuale richiesta.";
    const perAnno = {};
    righe.forEach((r) => {
      const k = r.anno || "—";
      (perAnno[k] = perAnno[k] || []).push(r);
    });
    return Object.entries(perAnno)
      .map(([anno, lista]) =>
        [
          `═══ ${anno} ═══`,
          ...lista.map(
            (r) =>
              `* ${r.sezione || "Dati"} (${anno}) · controllo ${r.controllo || "—"} · ${r.fonte}: Cerca la voce "${r.voce}".\n  👉 Errore rilevato: ${r.errore}\n  👉 Azione da compiere: ${r.azione}`
          ),
        ].join("\n")
      )
      .join("\n\n");
  };

  /* ---- azioni sulle voci ---- */
  const aggiorna = (id, patch) =>
    setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const elimina = (id) => setVoci((vs) => vs.filter((v) => v.id !== id));
  const aggiungi = () =>
    setVoci((vs) => [...vs, { id: nuovoId(), nome: "", importo: 0, classe: "da_classificare" }]);

  /* ---- azioni gemelle sulle voci dell'esercizio precedente ---- */
  const aggiornaPrec = (id, patch) =>
    setVociPrec((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const eliminaPrec = (id) => setVociPrec((vs) => vs.filter((v) => v.id !== id));
  const aggiungiPrec = () =>
    setVociPrec((vs) => [...vs, { id: nuovoId(), nome: "", importo: 0, classe: "da_classificare" }]);

  /* ============================================================
     TAB 10 · AZIONI DELL'AUDIT AUTO-APPRENDENTE
     ============================================================
     ✨ auditCorreggi riusa gli editor esistenti delle voci (aggiorna /
     elimina e i gemelli T-1), così l'intera catena reattiva — cascata rf,
     rfPrec, delta dei flussi, auditLocale — si ricalcola da sola senza
     alcuna scorciatoia sui dati. Tre tipi di correzione: "invertiSegno" per
     la convenzione dei segni, che nel Rendiconto è l'errore più frequente;
     "cambiaClasse" per area e voci orfane; "elimina" quando la voce non è un
     flusso di cassa, oppure è un subtotale o un duplicato. ---- */
  const auditCorreggi = (an) => {
    const fix = an?.autoFix;
    if (!fix?.eseguibile || !an.idVoce) return;
    const prec = an.esercizio === "precedente";
    const scrivi = prec ? aggiornaPrec : aggiorna;

    if (fix.tipo === "elimina") {
      (prec ? eliminaPrec : elimina)(an.idVoce);
    } else if (fix.tipo === "invertiSegno") {
      /* Si rilegge l'importo dallo stato invece di usare quello fotografato
         nell'anomalia: fra la diagnosi e il clic l'utente può averlo
         modificato a mano, e invertire un valore stantio lo sovrascriverebbe. */
      const lista = prec ? vociPrec : voci;
      const corrente = lista.find((v) => v.id === an.idVoce);
      if (!corrente) return;
      scrivi(an.idVoce, { importo: -(Number(corrente.importo) || 0) });
    } else if (fix.tipo === "cambiaClasse" && fix.nuovaClasse) {
      scrivi(an.idVoce, { classe: fix.nuovaClasse });
    } else return;

    setAuditAzioni((st) => ({ ...st, [an.key]: { ...(st[an.key] || {}), fix: true } }));
  };

  /* 🧠 auditInsegna: la regola viene appesa ai prompt di sistema e persistita
     nel localStorage. Da quel momento entra in TUTTE le estrazioni successive
     (buildRfPrompt e MASTER_PROMPT), anche su bilanci di aziende diverse.
     Non agisce retroattivamente sui dati già in memoria. ---- */
  const auditInsegna = (an) => {
    const sug = an?.promptUpdateSuggestion;
    if (!sug) return;
    salvaSystemPrompts(applicaRegolaAppresa(systemPrompts, sug));
    setAuditAzioni((st) => ({ ...st, [an.key]: { ...(st[an.key] || {}), learn: true } }));
  };

  const azzera = () => {
    setVoci([]);
    setAzienda("");
    setEsercizio("");
    setSchemaRF(null);
    setCassaIniziale(null);
    setCassaFinale(null);
    setAliquotaFiscale(24);
    setFonte(null);
    setNiFile(null);
    setNiEstratti([]);
    setNiRettifiche([]);
    setNiRedFlags([]);
    setNiFonte(null);
    niFirma.current = null;
    setRgFile(null);
    setRgEstratti([]);
    setRgRettifiche([]);
    setRgRedFlags([]);
    setRgFonte(null);
    rgFirma.current = null;
    setSpData(null);
    setSpFonte(null);
    setCeData(null);
    setCeFonte(null);
    setModoInputDati("file");
    setSpManCorr({});
    setSpManPrec({});
    setSpManAnni({ corr: "", prec: "" });
    setCeMan({});
    setStatoIA(null);
    /* ---- esercizio precedente (T-1) ---- */
    setVociPrec([]);
    setEsercizioPrec("");
    setSchemaRFPrec(null);
    setCassaInizialePrec(null);
    setCassaFinalePrec(null);
    setFontePrec(null);
    setNiEstrattiPrec([]);
    setNiRettifichePrec([]);
    setNiRedFlagsPrec([]);
    setNiFontePrec(null);
    setRgEstrattiPrec([]);
    setRgRettifichePrec([]);
    setRgRedFlagsPrec([]);
    setRgFontePrec(null);
    setStatoIAPrec(null);
  };

  const caricaEsempio = () => {
    setVoci(ESEMPIO_RF.voci.map((v) => ({ ...v, id: nuovoId() })));
    setAzienda(ESEMPIO_RF.azienda);
    setEsercizio(ESEMPIO_RF.esercizio);
    setSchemaRF(ESEMPIO_RF.schema);
    setCassaIniziale(ESEMPIO_RF.cassaIniziale);
    setCassaFinale(ESEMPIO_RF.cassaFinale);
    setFonte(`«${ESEMPIO_RF.fonte}» (${ESEMPIO_RF.voci.length} voci)`);
    /* carica anche il comparativo: il tab «Variazioni e Trend» è subito vivo */
    setVociPrec(ESEMPIO_RF_PREC.voci.map((v) => ({ ...v, id: nuovoId() })));
    setEsercizioPrec(ESEMPIO_RF_PREC.esercizio);
    setSchemaRFPrec(ESEMPIO_RF_PREC.schema);
    setCassaInizialePrec(ESEMPIO_RF_PREC.cassaIniziale);
    setCassaFinalePrec(ESEMPIO_RF_PREC.cassaFinale);
    setFontePrec(`«${ESEMPIO_RF_PREC.fonte}» (${ESEMPIO_RF_PREC.voci.length} voci)`);
    setStatoIA(null);
    setStatoIAPrec(null);
  };

  /* ============================================================
     ESTRAZIONE IA DEL RENDICONTO — logica a DOPPIA PASSATA
     ============================================================
     processRf() è il motore unico: riceve già il testo estratto e una
     bandiera isPrec che decide (a) quale prompt costruire — con o senza
     il vincolo sulla colonna comparativa — e (b) su quale famiglia di
     stati riversare il risultato. Il chiamante estraiConIA() legge il
     file UNA sola volta e, per il caricamento iniziale, lancia in
     automatico la seconda passata sullo stesso testo con isPrec = true.
     Lo schema rilevato in Fase 2a viene riusato dalla seconda passata:
     è lo stesso documento, quindi la detection non va ripetuta. */
  const processRf = async (fonte, nomeFile, isPrec = false, schemaGia = null) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const etichetta = isPrec ? "T-1 · " : "";

    let schemaInfo = schemaGia;
    if (!schemaInfo) {
      setStato({ tipo: "info", msg: `${etichetta}Fase 2a: riconoscimento dello schema del rendiconto (OIC 10 diretto/indiretto · IAS 7)…` });
      try {
        schemaInfo = await rilevaSchemaRf({
          provider,
          apiKey,
          model: modello[provider],
          fonte,
        });
      } catch (e) {
        console.warn("Schema detection fallita, procedo con estrazione generica:", e);
      }
    }

    setStato({
      tipo: "info",
      msg: schemaInfo?.schema
        ? `${etichetta}Fase 2b: estrazione ${isPrec ? "della colonna comparativa " : ""}adattata con regole per ${SCHEMI_RF_LABEL[schemaInfo.schema] || schemaInfo.schema}…`
        : `${etichetta}Fase 2b: estrazione ${isPrec ? "della colonna comparativa " : ""}adattata via IA…`,
    });

    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) => buildRfPrompt(t, schemaInfo, isPrec, vincoloSingoloAnnoPer(isPrec), systemPrompts.regoleApprese, modalitaSingoloAnno, annoPrecTarget),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({ tipo: "info", msg: `${etichetta}Fase 2b: analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…` });
      },
      onRitento: (n, attesa) =>
        setStato({ tipo: "info", msg: `${etichetta}Errore temporaneo del modello: nuovo tentativo ${n} tra ${(attesa / 1000).toFixed(1)}s…` }),
    });
    /* Nei documenti suddivisi il rendiconto ricade tipicamente in una sola
       porzione: le voci vengono unite, mentre metadati e cassa prendono il
       primo valore utile (per la cassa si privilegiano i valori non nulli). */
    const data = {
      voci: fondiArray(risultati, "voci"),
      azienda: fondiScalare(risultati, "azienda"),
      esercizio: fondiScalare(risultati, "esercizio"),
      schemaRilevato: fondiScalare(risultati, "schemaRilevato"),
      valuta: fondiScalare(risultati, "valuta"),
      unita: fondiScalare(risultati, "unita"),
      cassaIniziale: fondiNumero(risultati, "cassaIniziale"),
      cassaFinale: fondiNumero(risultati, "cassaFinale"),
      __troncato: qualcheTroncamento(risultati),
    };

    const nuove = (data.voci || [])
      .filter((v) => v && v.nome)
      .map((v) => ({
        id: nuovoId(),
        nome: String(v.nome),
        importo: Number(v.importo) || 0,
        classe: CLASSI_RF[v.classe] ? v.classe : "da_classificare",
      }));

    const schemaFinale =
      schemaInfo || (data.schemaRilevato ? { schema: data.schemaRilevato, valuta: data.valuta, unita: data.unita } : null);
    const cIni = Number.isFinite(Number(data.cassaIniziale)) ? Number(data.cassaIniziale) : null;
    const cFin = Number.isFinite(Number(data.cassaFinale)) ? Number(data.cassaFinale) : null;

    if (isPrec) {
      /* nessun comparativo nel documento: non sovrascrivo con dati vuoti,
         segnalo e lascio all'utente il caricamento separato del T-1 */
      if (!nuove.length) {
        setStatoIAPrec({
          tipo: "info",
          msg: "Nessuna colonna comparativa trovata nel documento: carica il rendiconto dell'esercizio precedente a parte dal tab «7 · Dati & Validazione T-1».",
        });
        return { voci: [], schema: schemaFinale };
      }
      setVociPrec(nuove);
      if (data.esercizio) setEsercizioPrec(String(data.esercizio));
      setSchemaRFPrec(schemaFinale);
      setCassaInizialePrec(cIni);
      setCassaFinalePrec(cFin);
      setFontePrec(`«${nomeFile}» via estrazione IA — colonna comparativa (${nuove.length} voci)`);
      setStatoIAPrec({
        tipo: "successo",
        msg: `T-1 · estrazione completata: ${nuove.length} voci dell'esercizio precedente.${data.__troncato ? " ⚠ Risposta troncata: le ultime voci potrebbero mancare." : ""}`,
      });
    } else {
      setVoci(nuove);
      if (data.azienda) setAzienda(String(data.azienda));
      if (data.esercizio) setEsercizio(String(data.esercizio));
      setSchemaRF(schemaFinale);
      setCassaIniziale(cIni);
      setCassaFinale(cFin);
      setFonte(`«${nomeFile}» via estrazione IA (${nuove.length} voci)`);
      setStatoIA({
        tipo: "successo",
        msg: `Estrazione completata: ${nuove.length} voci proposte.${data.__troncato ? " ⚠ Risposta troncata: le ultime voci potrebbero mancare." : ""}`,
      });
    }
    return { voci: nuove, schema: schemaFinale };
  };

  /* ---- estrazione IA: Fase 0 (schema) + Fase 1 (voci) ----
     isPrec = false → caricamento iniziale: estrae l'anno corrente e poi
     rilancia in automatico la seconda passata sulla colonna comparativa.
     isPrec = true  → caricamento dedicato di un file separato per il T-1. */
  const estraiConIA = async (file, isPrec = false) => {
    if (!iaAttiva) {
      const msg = "Inserisci la chiave API del provider selezionato per attivare le funzionalità IA.";
      (isPrec ? setStatoIAPrec : setStatoIA)({ tipo: "errore", msg });
      return;
    }
    const setCarico = isPrec ? setCaricamentoPrec : setCaricamento;
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    setCarico(true);
    setStato({ tipo: "info", msg: `${isPrec ? "T-1 · " : ""}Fase 1: lettura di «${file.name}»…` });
    try {
      /* Fonte preparata UNA sola volta (porzioni PDF native o testo) e riusata
         per entrambe le passate T e T-1. */
      const fonte = await preparaFonte(file, provider);
      if (fonte.tipo === "pdf" && fonte.chunks.length > 1)
        setStato({ tipo: "info", msg: `${isPrec ? "T-1 · " : ""}Documento suddiviso in ${fonte.chunks.length} porzioni per l'analisi…` });
      const esito = await processRf(fonte, file.name, isPrec);

      /* seconda passata automatica sulla colonna comparativa dello stesso
         documento: non richiede una nuova lettura del PDF né una nuova
         detection dello schema. In MODALITÀ SINGOLO ANNO è disattivata. */
      if (!isPrec && !modalitaSingoloAnno) {
        setCaricamentoPrec(true);
        try {
          await processRf(fonte, file.name, true, esito?.schema || null);
        } catch (e2) {
          console.error("Estrazione T-1 non riuscita:", e2);
          setStatoIAPrec({ tipo: "errore", msg: `T-1 · estrazione della colonna comparativa non riuscita: ${e2.message}` });
        } finally {
          setCaricamentoPrec(false);
        }
      }
    } catch (e) {
      console.error("Estrazione RF non riuscita:", e);
      setStato({ tipo: "errore", msg: `${isPrec ? "T-1 · e" : "E"}strazione non riuscita: ${e.message}` });
    } finally {
      setCarico(false);
    }
  };

  /* ============================================================
     SEZIONE 2 — Nota Integrativa (logica invariata dalla Parte 2)
     ============================================================ */

  /* ---- Motore delle rettifiche a partita doppia (NI + RG cumulative) ----
     Le voci generate dalle rettifiche portano tutte il flag rettificaNI:true
     (marcatore generico di "riga generata da documento", per compatibilità
     con tutti i filtri esistenti) e un campo `fonte` ("NI"|"RG") per la
     tracciabilità nell'etichetta. Il ricalcolo parte SEMPRE dalle voci base
     (non generate) e riapplica entrambe le liste, così le due fonti
     coesistono e restano indipendenti. */
  const generaVociRettifiche = (retts, fonte) => {
    const tag = fonte === "RG" ? "RG" : "NI";
    const out = [];
    (retts || [])
      .filter((r) => r.attiva && CLASSI_RF[r.classeOrigine])
      .forEach((r) => {
        const imp = Number(r.importo) || 0;
        if (!imp) return;
        out.push({
          id: nuovoId(), rettificaNI: true, fonte: tag,
          nome: `Storno ${tag}: ${r.descrizione}`,
          importo: -imp,
          classe: r.classeOrigine,
        });
        if (r.tipo !== "non_cash" && CLASSI_RF[r.classeDestinazione]) {
          out.push({
            id: nuovoId(), rettificaNI: true, fonte: tag,
            nome: `Rettifica ${tag} (${RF_RETT_TIPI[r.tipo]?.label || r.tipo}): ${r.descrizione}`,
            importo: imp,
            classe: r.classeDestinazione,
          });
        }
      });
    return out;
  };

  /* isPrec = true → le rettifiche colpiscono vociPrec generando le
     rispettive voci di storno T-1 in partita doppia. Il ricalcolo parte
     sempre dalle voci base della famiglia interessata, quindi le due
     annualità restano completamente indipendenti. */
  const applicaTutteRettifiche = (niList, rgList, isPrec = false) => {
    const setter = isPrec ? setVociPrec : setVoci;
    setter((vs) => {
      const base = vs.filter((v) => !v.rettificaNI);
      return [
        ...base,
        ...generaVociRettifiche(niList, "NI"),
        ...generaVociRettifiche(rgList, "RG"),
      ];
    });
  };

  /* wrapper: aggiorna una fonte mantenendo l'altra dallo stato corrente */
  const applicaRettifiche = (niList) => applicaTutteRettifiche(niList, rgRettifiche);
  const applicaRettificheRG = (rgList) => applicaTutteRettifiche(niRettifiche, rgList);
  const applicaRettifichePrec = (niList) => applicaTutteRettifiche(niList, rgRettifichePrec, true);
  const applicaRettificheRGPrec = (rgList) => applicaTutteRettifiche(niRettifichePrec, rgList, true);

  const aggiornaRettificaNI = (idx, patch) => {
    setNiRettifiche((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      applicaRettifiche(next);
      return next;
    });
  };

  const rimuoviRettificaNI = (idx) => {
    setNiRettifiche((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      applicaRettifiche(next);
      return next;
    });
  };

  const aggiornaRettificaRG = (idx, patch) => {
    setRgRettifiche((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      applicaRettificheRG(next);
      return next;
    });
  };

  const rimuoviRettificaRG = (idx) => {
    setRgRettifiche((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      applicaRettificheRG(next);
      return next;
    });
  };

  /* ---- handler gemelli per le rettifiche dell'esercizio precedente ---- */
  const aggiornaRettificaNIPrec = (idx, patch) => {
    setNiRettifichePrec((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      applicaRettifichePrec(next);
      return next;
    });
  };

  const rimuoviRettificaNIPrec = (idx) => {
    setNiRettifichePrec((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      applicaRettifichePrec(next);
      return next;
    });
  };

  const aggiornaRettificaRGPrec = (idx, patch) => {
    setRgRettifichePrec((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      applicaRettificheRGPrec(next);
      return next;
    });
  };

  const rimuoviRettificaRGPrec = (idx) => {
    setRgRettifichePrec((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      applicaRettificheRGPrec(next);
      return next;
    });
  };

  const handleNiFile = async (file) => {
    try {
      setStatoIA({ tipo: "info", msg: `Nota Integrativa · lettura di «${file.name}»…` });
      const fonte = await preparaFonte(file, provider);
      setNiFile({ nome: file.name, fonte });
      niFirma.current = null;
      if (!voci.length) {
        setStatoIA({ tipo: "info", msg: `Nota Integrativa «${file.name}» pronta: l'analisi partirà automaticamente appena estrai o carichi le voci del rendiconto (sezione 1).` });
      }
    } catch (e) {
      console.error("Lettura NI non riuscita:", e);
      setStatoIA({ tipo: "errore", msg: `Lettura della Nota Integrativa non riuscita: ${e.message}` });
    }
  };

  /* ---- Parser condiviso delle rettifiche (NI e RG, T e T-1) ---- */
  const normalizzaRettifiche = (arr) =>
    (arr || [])
      .filter((r) => r.descrizione && Number(r.importo))
      .map((r) => {
        const tipo = RF_RETT_TIPI[r.tipo] ? r.tipo : "non_cash";
        const classeOrigine =
          CLASSI_RF[r.classeOrigine] && r.classeOrigine !== "da_classificare" ? r.classeOrigine : null;
        const classeDestinazione =
          tipo === "non_cash"
            ? null
            : CLASSI_RF[r.classeDestinazione] && r.classeDestinazione !== "da_classificare"
            ? r.classeDestinazione
            : null;
        return {
          descrizione: String(r.descrizione),
          importo: Number(r.importo) || 0,
          classeOrigine,
          classeDestinazione,
          tipo,
          motivazione: r.motivazione ? String(r.motivazione) : "",
          pagina: r.pagina != null && Number.isFinite(Number(r.pagina)) ? Number(r.pagina) : null,
          attiva: !!classeOrigine, // senza classe di origine resta in attesa: mai imputata a caso
        };
      });

  const normalizzaEstratti = (arr) =>
    (arr || [])
      .filter((e) => e.tema && e.contenuto && [1, 2, 3, 4].includes(Number(e.sezione)))
      .map((e) => ({
        sezione: Number(e.sezione),
        tema: String(e.tema),
        contenuto: String(e.contenuto),
        pagina: e.pagina != null && Number.isFinite(Number(e.pagina)) ? Number(e.pagina) : null,
      }));

  const normalizzaFlags = (arr) =>
    (arr || [])
      .filter((f) => f.evidenza)
      .map((f) => ({
        flag: RF_FLAG_LABELS[f.flag] ? f.flag : "altro",
        evidenza: String(f.evidenza),
        gravita: ["alta", "media", "bassa"].includes(f.gravita) ? f.gravita : "media",
        pagina: f.pagina != null && Number.isFinite(Number(f.pagina)) ? Number(f.pagina) : null,
      }));

  /* ============================================================
     NOTA INTEGRATIVA — motore unico a doppia passata
     ============================================================
     processNi() riceve il testo già estratto e la bandiera isPrec, che
     seleziona il prompt (NI_RF_PROMPT vs variante T-1 comparativa o
     «documento autonomo» in Modalità Singolo Anno), la lista di
     voci da passare come contesto e la famiglia di stati da alimentare. */
  const processNi = async (fonte, nomeFile, isPrec = false) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const etichetta = isPrec ? "T-1 · " : "";
    /* contesto: le voci dell'annualità analizzata; se il T-1 non è ancora
       stato estratto uso quelle correnti come riferimento strutturale */
    const vociContesto = isPrec ? (vociPrec.length ? vociPrec : voci) : voci;
    const vociTxt = vociContesto
      .filter((v) => !v.rettificaNI)
      .map((v) => `- ${v.nome} → ${fmt(Number(v.importo) || 0)} → ${v.classe}`)
      .join("\n");

    setStato({ tipo: "info", msg: `${etichetta}Nota Integrativa · estrazione in 4 sezioni tematiche via IA…` });
    const promptBaseNi = isPrec
      ? (modalitaSingoloAnno ? buildNiRfPromptPrecAutonomo(annoPrecTarget) : buildNiRfPromptPrec(annoPrecTarget))
      : NI_RF_PROMPT;
    const intestazione = `${promptBaseNi}${vincoloSingoloAnnoPer(isPrec)}\n\nVOCI ATTUALI DEL RENDICONTO (nome → importo → classe)${isPrec ? " — struttura di riferimento" : ""}:\n${vociTxt}`;
    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) =>
        intestazione +
        (t
          ? `\n\nTESTO DELLA NOTA INTEGRATIVA:\n"""\n${t}\n"""`
          : `\n\nLa Nota Integrativa da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle.`),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({ tipo: "info", msg: `${etichetta}Nota Integrativa · analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…` });
      },
      onRitento: (n, attesa) =>
        setStato({ tipo: "info", msg: `${etichetta}Errore temporaneo del modello: nuovo tentativo ${n} tra ${(attesa / 1000).toFixed(1)}s…` }),
    });
    const data = {
      estratti: fondiArray(risultati, "estratti"),
      rettifiche: fondiArray(risultati, "rettifiche"),
      redFlags: fondiArray(risultati, "redFlags"),
      __troncato: qualcheTroncamento(risultati),
    };

    const items = normalizzaEstratti(data.estratti);
    const retts = normalizzaRettifiche(data.rettifiche);
    const flags = normalizzaFlags(data.redFlags);

    if (isPrec) {
      setNiEstrattiPrec(items);
      setNiRettifichePrec(retts);
      applicaRettifichePrec(retts);
      setNiRedFlagsPrec(flags);
      setNiFontePrec(`«${nomeFile}» via estrazione IA — esercizio precedente (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    } else {
      setNiEstratti(items);
      setNiRettifiche(retts);
      applicaRettifiche(retts);
      setNiRedFlags(flags);
      setNiFonte(`«${nomeFile}» via estrazione IA (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    }

    const senzaOrigine = retts.filter((r) => !r.classeOrigine).length;
    setStato({
      tipo: "successo",
      msg: `${etichetta}Nota Integrativa analizzata: ${items.length} estratti, ${retts.length} rettifiche (${retts.filter((r) => r.attiva).length} applicate${senzaOrigine ? `, ${senzaOrigine} in attesa di classe di origine` : ""}), ${flags.length} red flag.${data.__troncato ? " ⚠ Risposta troncata: gli ultimi elementi potrebbero mancare." : ""}`,
    });
    return retts;
  };

  const estraiNI = async () => {
    if (!iaAttiva) {
      setStatoIA({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Nota Integrativa." });
      return;
    }
    if (!niFile) {
      setStatoIA({ tipo: "errore", msg: "Carica prima il file della Nota Integrativa." });
      return;
    }
    if (!voci.length) {
      setStatoIA({ tipo: "errore", msg: "Servono le voci del rendiconto (sezione 1) prima di analizzare la Nota Integrativa." });
      return;
    }
    setCaricamentoNI(true);
    try {
      await processNi(niFile.fonte, niFile.nome, false);
      /* seconda passata automatica sul comparativo: la stessa Nota
         Integrativa contiene di norma i dati di entrambe le annualità.
         In MODALITÀ SINGOLO ANNO è disattivata. */
      if (!modalitaSingoloAnno) {
        try {
          await processNi(niFile.fonte, niFile.nome, true);
        } catch (e2) {
          console.error("Analisi NI T-1 non riuscita:", e2);
          setStatoIAPrec({ tipo: "errore", msg: `T-1 · analisi della Nota Integrativa non riuscita: ${e2.message}` });
        }
      }
    } catch (e) {
      console.error("Analisi NI non riuscita:", e);
      setStatoIA({ tipo: "errore", msg: `Analisi della Nota Integrativa non riuscita: ${e.message}` });
    } finally {
      setCaricamentoNI(false);
    }
  };

  /* ---- caricamento DEDICATO di una Nota Integrativa per il solo T-1 ---- */
  const handleNiFilePrec = async (file) => {
    if (!iaAttiva) {
      setStatoIAPrec({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Nota Integrativa dell'esercizio precedente." });
      return;
    }
    setCaricamentoPrec(true);
    setStatoIAPrec({ tipo: "info", msg: `T-1 · lettura della Nota Integrativa «${file.name}»…` });
    try {
      const fonte = await preparaFonte(file, provider);
      await processNi(fonte, file.name, true);
    } catch (e) {
      console.error("Analisi NI T-1 non riuscita:", e);
      setStatoIAPrec({ tipo: "errore", msg: `T-1 · analisi della Nota Integrativa non riuscita: ${e.message}` });
    } finally {
      setCaricamentoPrec(false);
    }
  };

  /* ---- AUTO-AVVIO analisi NI (firma su voci base, come da Parte 2) ---- */
  useEffect(() => {
    const pronto = nVociBase > 0 && !!niFile && iaAttiva && !caricamentoNI;
    if (!pronto) {
      if (!niFile) niFirma.current = null;
      return;
    }
    const firma = `${niFile.nome}·${dimensioneFonte(niFile.fonte)}·${nVociBase}`;
    if (niFirma.current === firma) return;
    niFirma.current = firma;
    estraiNI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [niFile, nVociBase, iaAttiva]);

  /* ============================================================
     SEZIONE 3 — Relazione sulla Gestione (RG): lettura, estrazione,
     rettifiche a partita doppia (cumulative con la NI), auto-avvio
     ============================================================ */

  const handleRgFile = async (file) => {
    try {
      setStatoIA({ tipo: "info", msg: `Relazione sulla Gestione · lettura di «${file.name}»…` });
      const fonte = await preparaFonte(file, provider);
      setRgFile({ nome: file.name, fonte });
      rgFirma.current = null;
      if (!voci.length) {
        setStatoIA({ tipo: "info", msg: `Relazione sulla Gestione «${file.name}» pronta: l'analisi partirà automaticamente appena estrai o carichi le voci del rendiconto (sezione 1).` });
      }
    } catch (e) {
      console.error("Lettura RG non riuscita:", e);
      setStatoIA({ tipo: "errore", msg: `Lettura della Relazione sulla Gestione non riuscita: ${e.message}` });
    }
  };

  /* ============================================================
     RELAZIONE SULLA GESTIONE — motore unico a doppia passata
     ============================================================ */
  const processRg = async (fonte, nomeFile, isPrec = false) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const etichetta = isPrec ? "T-1 · " : "";
    const vociContesto = isPrec ? (vociPrec.length ? vociPrec : voci) : voci;
    const vociTxt = vociContesto
      .filter((v) => !v.rettificaNI)
      .map((v) => `- ${v.nome} → ${fmt(Number(v.importo) || 0)} → ${v.classe}`)
      .join("\n");

    setStato({ tipo: "info", msg: `${etichetta}Relazione sulla Gestione · estrazione in 4 sezioni tematiche via IA…` });
    const promptBaseRg = isPrec
      ? (modalitaSingoloAnno ? buildRgRfPromptPrecAutonomo(annoPrecTarget) : buildRgRfPromptPrec(annoPrecTarget))
      : RG_RF_PROMPT;
    const intestazione = `${promptBaseRg}${vincoloSingoloAnnoPer(isPrec)}\n\nVOCI ATTUALI DEL RENDICONTO (nome → importo → classe)${isPrec ? " — struttura di riferimento" : ""}:\n${vociTxt}`;
    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) =>
        intestazione +
        (t
          ? `\n\nTESTO DELLA RELAZIONE SULLA GESTIONE:\n"""\n${t}\n"""`
          : `\n\nLa Relazione sulla Gestione da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle.`),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({ tipo: "info", msg: `${etichetta}Relazione sulla Gestione · analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…` });
      },
      onRitento: (n, attesa) =>
        setStato({ tipo: "info", msg: `${etichetta}Errore temporaneo del modello: nuovo tentativo ${n} tra ${(attesa / 1000).toFixed(1)}s…` }),
    });
    const data = {
      estratti: fondiArray(risultati, "estratti"),
      rettifiche: fondiArray(risultati, "rettifiche"),
      redFlags: fondiArray(risultati, "redFlags"),
      __troncato: qualcheTroncamento(risultati),
    };

    const items = normalizzaEstratti(data.estratti);
    const retts = normalizzaRettifiche(data.rettifiche);
    const flags = normalizzaFlags(data.redFlags);

    if (isPrec) {
      setRgEstrattiPrec(items);
      setRgRettifichePrec(retts);
      applicaRettificheRGPrec(retts);
      setRgRedFlagsPrec(flags);
      setRgFontePrec(`«${nomeFile}» via estrazione IA — esercizio precedente (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    } else {
      setRgEstratti(items);
      setRgRettifiche(retts);
      applicaRettificheRG(retts);
      setRgRedFlags(flags);
      setRgFonte(`«${nomeFile}» via estrazione IA (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    }

    const senzaOrigine = retts.filter((r) => !r.classeOrigine).length;
    setStato({
      tipo: "successo",
      msg: `${etichetta}Relazione sulla Gestione analizzata: ${items.length} estratti, ${retts.length} rettifiche (${retts.filter((r) => r.attiva).length} applicate${senzaOrigine ? `, ${senzaOrigine} in attesa di classe di origine` : ""}), ${flags.length} red flag.${data.__troncato ? " ⚠ Risposta troncata: gli ultimi elementi potrebbero mancare." : ""}`,
    });
    return retts;
  };

  const estraiRG = async () => {
    if (!iaAttiva) {
      setStatoIA({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Relazione sulla Gestione." });
      return;
    }
    if (!rgFile) {
      setStatoIA({ tipo: "errore", msg: "Carica prima il file della Relazione sulla Gestione." });
      return;
    }
    if (!voci.length) {
      setStatoIA({ tipo: "errore", msg: "Servono le voci del rendiconto (sezione 1) prima di analizzare la Relazione sulla Gestione." });
      return;
    }
    setCaricamentoRG(true);
    try {
      await processRg(rgFile.fonte, rgFile.nome, false);
      /* seconda passata automatica sul comparativo — disattivata in
         MODALITÀ SINGOLO ANNO. */
      if (!modalitaSingoloAnno) {
        try {
          await processRg(rgFile.fonte, rgFile.nome, true);
        } catch (e2) {
          console.error("Analisi RG T-1 non riuscita:", e2);
          setStatoIAPrec({ tipo: "errore", msg: `T-1 · analisi della Relazione sulla Gestione non riuscita: ${e2.message}` });
        }
      }
    } catch (e) {
      console.error("Analisi RG non riuscita:", e);
      setStatoIA({ tipo: "errore", msg: `Analisi della Relazione sulla Gestione non riuscita: ${e.message}` });
    } finally {
      setCaricamentoRG(false);
    }
  };

  /* ---- caricamento DEDICATO di una Relazione sulla Gestione per il T-1 ---- */
  const handleRgFilePrec = async (file) => {
    if (!iaAttiva) {
      setStatoIAPrec({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Relazione sulla Gestione dell'esercizio precedente." });
      return;
    }
    setCaricamentoPrec(true);
    setStatoIAPrec({ tipo: "info", msg: `T-1 · lettura della Relazione sulla Gestione «${file.name}»…` });
    try {
      const fonte = await preparaFonte(file, provider);
      await processRg(fonte, file.name, true);
    } catch (e) {
      console.error("Analisi RG T-1 non riuscita:", e);
      setStatoIAPrec({ tipo: "errore", msg: `T-1 · analisi della Relazione sulla Gestione non riuscita: ${e.message}` });
    } finally {
      setCaricamentoPrec(false);
    }
  };

  /* ---- AUTO-AVVIO analisi RG (stessa logica della NI, firma indipendente) ---- */
  useEffect(() => {
    const pronto = nVociBase > 0 && !!rgFile && iaAttiva && !caricamentoRG;
    if (!pronto) {
      if (!rgFile) rgFirma.current = null;
      return;
    }
    const firma = `${rgFile.nome}·${dimensioneFonte(rgFile.fonte)}·${nVociBase}`;
    if (rgFirma.current === firma) return;
    rgFirma.current = firma;
    estraiRG();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rgFile, nVociBase, iaAttiva]);

  /* ============================================================
     ANALISI "MASTER" — bilancio completo in un solo passaggio
     Un unico documento (10-K, 20-F, fascicolo di bilancio) viene
     navigato dall'IA per estrarre in una sola chiamata: rendiconto
     finanziario, Nota Integrativa e Relazione sulla Gestione/MD&A.
     Le rettifiche NI e RG vengono applicate INSIEME (una sola
     chiamata a applicaTutteRettifiche) per evitare che la seconda
     sovrascriva la prima leggendo uno stato non ancora aggiornato.
     ============================================================ */
  const handleMasterFile = async (file) => {
    if (!iaAttiva) {
      setStatoIA({ tipo: "errore", msg: "Attiva un provider IA per l'analisi completa." });
      return;
    }
    setCaricamentoMaster(true);
    setStatoIA({ tipo: "info", msg: `Lettura del bilancio completo «${file.name}»…` });
    try {
      const fonte = await preparaFonte(file, provider);
      if (fonte.tipo === "pdf" && fonte.chunks.length > 1)
        setStatoIA({ tipo: "info", msg: `Bilancio suddiviso in ${fonte.chunks.length} porzioni per l'analisi…` });
      setStatoIA({ tipo: "info", msg: "Estrazione Rendiconto, Note e MD&A via IA (potrebbe richiedere un po')..." });

      const MASTER_PROMPT = `Sei un analista di bilancio esperto. Il documento allegato è un bilancio annuale completo (es. Form 20-F, Form 10-K). Analizzalo integralmente per riclassificare il RENDICONTO FINANZIARIO.
FASE 1: NAVIGAZIONE
Individua: 1) Prospetti Contabili ("Item 8" / "Item 18"), 2) Notes to Financial Statements, 3) MD&A.
FASE 2: ESTRAZIONE FLUSSI
Identifica il Cash Flow Statement. Rileva schema ("ias7", "us_gaap"). Estrai cassa iniziale, cassa finale, e TUTTE le voci di flusso (mantenendo i segni del documento: + entrate, - uscite). Classe tra: "flusso_operativo_corrente", "flusso_operativo_fondi", "capex_uscite", "capex_entrate", "finanza_attiva", "finanza_passiva_raccolta", "finanza_passiva_servizio", "equity_aumenti", "equity_dividendi", "equity_buyback", "componenti_anomali", "effetto_cambi_liquidita".
Ignora i subtotali e i totali di sezione: estrai solo le voci elementari, per evitare doppi conteggi. Se una voce è ambigua usa "da_classificare": NON inventare voci e NON stimare importi mancanti.
FASE 3: ANALISI NOTA INTEGRATIVA
Dalle Note estrai info su: 1) Debito, 2) Dividendi/Soci, 3) Operazioni non-cash, 4) Altre info cassa. Genera "rettifiche" a partita doppia (tipo: "scomposizione_debito", "dividendi_cassa", "non_cash"). Segnala "redFlags".
ATTENZIONE AL RISCHIO DI FALSI POSITIVI SUI FLUSSI: le nuove iscrizioni di diritti d'uso (leasing IFRS 16), le conversioni di debito in equity o altre operazioni puramente patrimoniali NON transitano nei flussi di cassa dei bilanci redatti correttamente. Per queste crea SOLO un "estratto", MAI una "rettifica" di tipo non_cash, a meno che il documento affermi esplicitamente che la posta è erroneamente confluita nei flussi. Nel dubbio, genera l'estratto ma NON la rettifica.
FASE 4: ANALISI RELAZIONE GESTIONE
Dall'MD&A estrai info su: 1) Strategia CAPEX, 2) Debito/Finanziamento, 3) Remunerazione, 4) Dinamica Capitale Circolante. Genera "rettifiche" o "redFlags" se vi sono info quantitative. Le informazioni prospettiche o qualitative vanno negli "estratti", mai nelle "rettifiche".
Restituisci ESCLUSIVAMENTE un JSON valido:
{"schemaRF": {"schema": "ias7/us_gaap", "valuta": "...", "unita": "...", "indizi": "..."}, "azienda": "...", "esercizio": "...", "cassaIniziale": 0, "cassaFinale": 0, "voci": [{"nome": "...", "importo": 0, "classe": "..."}], "ni": {"estratti": [{"sezione": 1, "tema": "...", "contenuto": "...", "pagina": 0}], "rettifiche": [{"descrizione": "...", "importo": 0, "classeOrigine": "...", "classeDestinazione": "...", "tipo": "non_cash", "motivazione": "...", "pagina": 0}], "redFlags": []}, "rg": {"estratti": [{"sezione": 1, "tema": "...", "contenuto": "...", "pagina": 0}], "rettifiche": [], "redFlags": []}}`;

      const risultati = await eseguiSuFonte({
        provider,
        apiKey,
        model: modello[provider],
        fonte,
        costruisciPrompt: (t) =>
          `${MASTER_PROMPT}${vincoloSingoloAnno}${bloccoRegoleRF(systemPrompts.regoleApprese)}` +
          (t
            ? `\n\nTESTO DEL BILANCIO:\n"""\n${t}\n"""`
            : `\n\nIl bilancio da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo integralmente, pagina per pagina, comprese le tabelle dei prospetti contabili.`),
        onPorzione: (fatte, tot) => {
          if (tot > 1)
            setStatoIA({ tipo: "info", msg: `Analisi completa · porzione ${Math.min(fatte + 1, tot)} di ${tot}…` });
        },
        onRitento: (n, attesa) =>
          setStatoIA({ tipo: "info", msg: `Errore temporaneo del modello: nuovo tentativo ${n} tra ${(attesa / 1000).toFixed(1)}s…` }),
      });

      /* Fusione delle porzioni: gli array vengono concatenati riallineando i
         numeri di pagina, i campi scalari prendono il primo valore utile e la
         cassa privilegia i valori non nulli. I rami «ni» e «rg» si creano solo
         se almeno una porzione li contiene, per non azzerare stati già
         popolati quando il modello omette del tutto una sezione. */
      const data = {
        voci: qualchePresenza(risultati, "voci") ? fondiArray(risultati, "voci") : null,
        azienda: fondiScalare(risultati, "azienda"),
        esercizio: fondiScalare(risultati, "esercizio"),
        schemaRF: fondiScalare(risultati, "schemaRF"),
        cassaIniziale: fondiNumero(risultati, "cassaIniziale"),
        cassaFinale: fondiNumero(risultati, "cassaFinale"),
        __troncato: qualcheTroncamento(risultati),
        ni: qualchePresenza(risultati, "ni")
          ? {
              estratti: fondiArray(risultati, "ni.estratti"),
              rettifiche: fondiArray(risultati, "ni.rettifiche"),
              redFlags: fondiArray(risultati, "ni.redFlags"),
            }
          : null,
        rg: qualchePresenza(risultati, "rg")
          ? {
              estratti: fondiArray(risultati, "rg.estratti"),
              rettifiche: fondiArray(risultati, "rg.rettifiche"),
              redFlags: fondiArray(risultati, "rg.redFlags"),
            }
          : null,
      };

      // 1. Popola Dati RF
      if (data.voci) {
        setVoci(
          data.voci
            .filter((v) => v && v.nome)
            .map((v) => ({
              ...v,
              id: nuovoId(),
              importo: Number(v.importo) || 0,
              classe: CLASSI_RF[v.classe] ? v.classe : "da_classificare",
            }))
        );
        if (data.azienda) setAzienda(String(data.azienda));
        if (data.esercizio) setEsercizio(String(data.esercizio));
        if (data.schemaRF) setSchemaRF(data.schemaRF);
        setCassaIniziale(Number.isFinite(Number(data.cassaIniziale)) ? Number(data.cassaIniziale) : null);
        setCassaFinale(Number.isFinite(Number(data.cassaFinale)) ? Number(data.cassaFinale) : null);
      }

      /* Helper per pulire le rettifiche: normalizza anche il "tipo"
         (un tipo non previsto manderebbe in errore i badge della UI) e
         forza classeDestinazione a null per le poste non_cash, come già
         fanno estraiNI/estraiRG. */
      const pulisciRett = (arr) =>
        (arr || [])
          .filter((r) => r && r.descrizione && Number(r.importo))
          .map((r) => {
            const tipo = RF_RETT_TIPI[r.tipo] ? r.tipo : "non_cash";
            const classeOrigine =
              CLASSI_RF[r.classeOrigine] && r.classeOrigine !== "da_classificare" ? r.classeOrigine : null;
            const classeDestinazione =
              tipo === "non_cash"
                ? null
                : CLASSI_RF[r.classeDestinazione] && r.classeDestinazione !== "da_classificare"
                ? r.classeDestinazione
                : null;
            return {
              descrizione: String(r.descrizione),
              importo: Number(r.importo) || 0,
              classeOrigine,
              classeDestinazione,
              tipo,
              motivazione: r.motivazione ? String(r.motivazione) : "",
              pagina: r.pagina != null && Number.isFinite(Number(r.pagina)) ? Number(r.pagina) : null,
              attiva: !!classeOrigine,
            };
          });

      // 2. Popola NI
      const nR = data.ni ? pulisciRett(data.ni.rettifiche) : [];
      if (data.ni) {
        setNiEstratti(
          (data.ni.estratti || [])
            .filter((e) => e.tema && e.contenuto && [1, 2, 3, 4].includes(Number(e.sezione)))
            .map((e) => ({
              sezione: Number(e.sezione),
              tema: String(e.tema),
              contenuto: String(e.contenuto),
              pagina: e.pagina != null && Number.isFinite(Number(e.pagina)) ? Number(e.pagina) : null,
            }))
        );
        setNiRedFlags(
          (data.ni.redFlags || [])
            .filter((f) => f.evidenza)
            .map((f) => ({
              flag: RF_FLAG_LABELS[f.flag] ? f.flag : "altro",
              evidenza: String(f.evidenza),
              gravita: ["alta", "media", "bassa"].includes(f.gravita) ? f.gravita : "media",
              pagina: f.pagina != null && Number.isFinite(Number(f.pagina)) ? Number(f.pagina) : null,
            }))
        );
        setNiRettifiche(nR);
        setNiFonte(`«${file.name}» · sezione Note (analisi completa)`);
      }

      // 3. Popola RG
      const rR = data.rg ? pulisciRett(data.rg.rettifiche) : [];
      if (data.rg) {
        setRgEstratti(
          (data.rg.estratti || [])
            .filter((e) => e.tema && e.contenuto && [1, 2, 3, 4].includes(Number(e.sezione)))
            .map((e) => ({
              sezione: Number(e.sezione),
              tema: String(e.tema),
              contenuto: String(e.contenuto),
              pagina: e.pagina != null && Number.isFinite(Number(e.pagina)) ? Number(e.pagina) : null,
            }))
        );
        setRgRedFlags(
          (data.rg.redFlags || [])
            .filter((f) => f.evidenza)
            .map((f) => ({
              flag: RF_FLAG_LABELS[f.flag] ? f.flag : "altro",
              evidenza: String(f.evidenza),
              gravita: ["alta", "media", "bassa"].includes(f.gravita) ? f.gravita : "media",
              pagina: f.pagina != null && Number.isFinite(Number(f.pagina)) ? Number(f.pagina) : null,
            }))
        );
        setRgRettifiche(rR);
        setRgFonte(`«${file.name}» · sezione MD&A (analisi completa)`);
      }

      /* 4. Applica ENTRAMBE le liste in una sola passata: i wrapper
         applicaRettifiche/applicaRettificheRG leggono l'altra lista dallo
         stato corrente, quindi chiamarli in sequenza qui azzererebbe le
         rettifiche appena impostate. */
      applicaTutteRettifiche(nR, rR);

      /* i file NI/RG separati non sono stati caricati: azzero le firme
         così un eventuale upload successivo riparte pulito */
      niFirma.current = null;
      rgFirma.current = null;

      setFonte(`«${file.name}» (Analisi Completa)`);
      setStatoIA({
        tipo: "successo",
        msg: `Analisi completa di «${file.name}» terminata. Flussi, NI e RG estratte e fuse nel prospetto.${data.__troncato ? " ⚠ Risposta troncata: gli ultimi elementi potrebbero mancare." : ""}`,
      });

      /* seconda passata sul comparativo: il documento è già in memoria,
         quindi il T-1 costa una sola chiamata aggiuntiva. In MODALITÀ
         SINGOLO ANNO è disattivata: si resta sul solo anno richiesto. */
      if (!modalitaSingoloAnno) {
        setCaricamentoPrec(true);
        try {
          await processRf(fonte, file.name, true, data.schemaRF || null);
        } catch (e2) {
          console.error("Estrazione T-1 non riuscita:", e2);
          setStatoIAPrec({ tipo: "errore", msg: `T-1 · estrazione della colonna comparativa non riuscita: ${e2.message}` });
        } finally {
          setCaricamentoPrec(false);
        }
      }

      setTab(1);
    } catch (e) {
      console.error("Analisi completa non riuscita:", e);
      setStatoIA({ tipo: "errore", msg: `Analisi completa fallita: ${e.message}` });
    } finally {
      setCaricamentoMaster(false);
      if (fileMaster.current) fileMaster.current.value = "";
    }
  };

  /* ============================================================
     SEZIONE 3 — Import JSON SP e CE (nessuna chiamata IA)
     ============================================================ */

  const caricaJsonSP = async (file) => {
    try {
      const testo = await file.text();
      const data = JSON.parse(testo);
      if (!data || typeof data !== "object") throw new Error("File JSON non valido");
      /* validazione struttura: serve il blocco degli aggregati dei DUE esercizi
         (è ciò che alimenta i Δ patrimoniali del Metodo Indiretto) */
      if (!data.esercizioCorrente?.aggregati || !data.esercizioPrecedente?.aggregati) {
        throw new Error(
          "Struttura non riconosciuta: il file non contiene esercizioCorrente/esercizioPrecedente con gli aggregati. Esporta il JSON dal modulo «Riclassificazione SP» (che include entrambi gli esercizi)."
        );
      }
      setSpData(data);
      setModoInputDati("file");
      /* pre-compila lo specchio manuale così l'utente può passare a
         «inserimento manuale» e ritoccare i valori caricati */
      const specchio = (agg) => { const r = {}; CAMPI_SP.forEach(([k]) => { r[k] = agg?.[k] ?? ""; }); return r; };
      setSpManCorr(specchio(data.esercizioCorrente.aggregati));
      setSpManPrec(specchio(data.esercizioPrecedente.aggregati));
      setSpManAnni({ corr: data.esercizioCorrente?.esercizio || "", prec: data.esercizioPrecedente?.esercizio || "" });
      setSpFonte(`«${file.name}» (esercizi ${data.esercizioCorrente?.esercizio || "?"} · ${data.esercizioPrecedente?.esercizio || "?"})`);
      setStatoIA({ tipo: "successo", msg: `✓ JSON SP caricato: ${file.name}` });
      setTimeout(() => setStatoIA(null), 2500);
    } catch (err) {
      console.error("Errore caricamento JSON SP:", err);
      setStatoIA({ tipo: "errore", msg: `❌ JSON SP: ${err.message || "file non valido"}` });
    }
  };

  const caricaJsonCE = async (file) => {
    try {
      const testo = await file.text();
      const data = JSON.parse(testo);
      if (!data || typeof data !== "object") throw new Error("File JSON non valido");
      /* validazione struttura: le voci con le classi del modulo CE, sia nel
         formato piatto delle esportazioni storiche sia dentro il macro-nodo
         «esercizioCorrente» del formato ce-riclassificato/2.0 */
      const normalizzato = normalizzaCeJson(data);
      if (!normalizzato || !Array.isArray(normalizzato.voci) || !normalizzato.voci.length || !normalizzato.voci.some((v) => v.classe)) {
        throw new Error(
          "Struttura non riconosciuta: non trovo le voci del CE con le loro classi, né in cima al file né dentro «esercizioCorrente». Esporta il JSON dal modulo «Conto Economico Riclassificato»."
        );
      }
      setCeData(normalizzato);
      setModoInputDati("file");
      /* pre-compila lo specchio manuale con le grandezze di sintesi calcolate */
      const c = calcolaCeDaJson(normalizzato);
      if (c) setCeMan({ ricavi: c.ricavi, ebitda: c.ebitda, ebit: c.ebit, ammortamenti: c.ammortamenti, oneriFin: c.oneriFin, utileNetto: c.utileNetto });
      setCeFonte(`«${file.name}» (${normalizzato.voci.length} voci · esercizio ${normalizzato.esercizio || "?"})`);
      setStatoIA({ tipo: "successo", msg: `✓ JSON CE caricato: ${file.name}` });
      setTimeout(() => setStatoIA(null), 2500);
    } catch (err) {
      console.error("Errore caricamento JSON CE:", err);
      setStatoIA({ tipo: "errore", msg: `❌ JSON CE: ${err.message || "file non valido"}` });
    }
  };

  /* ============================================================
     SALVATAGGIO — architettura a MACRO-NODI (gemella di SP e CE)
     ============================================================
     Il JSON non è più piatto: espone quattro nodi di primo livello
     («esercizioCorrente», «esercizioPrecedente», «deltaFlussi»,
     «statoApplicazione») così un consumatore esterno — o un altro
     modulo della suite — può leggere una sola annualità senza
     conoscere la struttura interna dell'app. Gli aggregati calcolati
     da calcolaRF sono serializzati insieme alle voci: chi legge il file
     non deve ricalcolare la cascata per avere FCFO, FCFE e Δ PFN. */
  const salvaDati = () => {
    try {
      const datiSalvare = {
        modulo: "rendiconto_finanziario",
        versione: 2,
        azienda,

        esercizioCorrente: {
          esercizio,
          schemaRF,
          cassaIniziale,
          cassaFinale,
          fonte,
          voci,
          aggregati: rf,
          ni: {
            estratti: niEstratti,
            rettifiche: niRettifiche,
            redFlags: niRedFlags,
            fonte: niFonte,
          },
          rg: {
            estratti: rgEstratti,
            rettifiche: rgRettifiche,
            redFlags: rgRedFlags,
            fonte: rgFonte,
          },
        },

        esercizioPrecedente: {
          esercizio: esercizioPrec,
          schemaRF: schemaRFPrec,
          cassaIniziale: cassaInizialePrec,
          cassaFinale: cassaFinalePrec,
          fonte: fontePrec,
          voci: vociPrec,
          aggregati: rfPrec,
          ni: {
            estratti: niEstrattiPrec,
            rettifiche: niRettifichePrec,
            redFlags: niRedFlagsPrec,
            fonte: niFontePrec,
          },
          rg: {
            estratti: rgEstrattiPrec,
            rettifiche: rgRettifichePrec,
            redFlags: rgRedFlagsPrec,
            fonte: rgFontePrec,
          },
        },

        deltaFlussi,

        statoApplicazione: {
          aliquotaFiscale,
          modalitaSingoloAnno,
          annoSpecifico,
          annoSpecificoPrec,
          modoInputDati,
          spData,
          spFonte,
          ceData,
          ceFonte,
          spManCorr,
          spManPrec,
          spManAnni,
          ceMan,
        },
      };
      const datiPuliti = JSON.parse(JSON.stringify(datiSalvare));
      const testoJSON = JSON.stringify(datiPuliti, null, 2);
      const nomeFile = `rendiconto-finanziario_${(esercizio || "dati").replaceAll("/", "_")}.json`;
      // Apri la modale di esportazione (il download diretto è bloccato
      // negli ambienti sandbox come gli artifact: causava pagina bianca)
      setEsporta({ nome: nomeFile, testo: testoJSON, copiato: false });
    } catch (err) {
      console.error("Errore durante il salvataggio:", err);
      setStatoIA({ tipo: "errore", msg: `❌ Errore salvataggio: ${err.message || err}` });
    }
  };

  const copiaEsporta = async () => {
    if (!esporta) return;
    try {
      await navigator.clipboard.writeText(esporta.testo);
      setEsporta((e) => ({ ...e, copiato: true }));
    } catch {
      const ta = document.getElementById("export-json-textarea");
      if (ta) {
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
          setEsporta((e) => ({ ...e, copiato: true }));
        } catch {
          setStatoIA({ tipo: "errore", msg: "Copia automatica non riuscita: seleziona il testo e copia manualmente (Ctrl+C)." });
        }
      }
    }
  };

  const scaricaEsporta = () => {
    if (!esporta) return;
    try {
      const blob = new Blob([esporta.testo], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = esporta.nome;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Download non riuscito:", err);
      setStatoIA({ tipo: "errore", msg: "Download bloccato dall'ambiente: usa «Copia negli appunti» e incolla in un file .json." });
    }
  };

  /* ---- Reidratazione speculare del JSON a macro-nodi ----
     Retrocompatibile: i file salvati con la versione piatta (versione 1)
     vengono normalizzati nella stessa forma prima di alimentare gli
     stati, così un'analisi vecchia continua ad aprirsi senza perdite —
     semplicemente con il nodo dell'esercizio precedente vuoto. */
  const caricaJSON = async (file) => {
    try {
      const testo = await file.text();
      const data = JSON.parse(testo);
      if (!data || typeof data !== "object") throw new Error("File JSON non valido: formato non riconosciuto");

      const nuovoFormato = !!data.esercizioCorrente;

      /* --- normalizzazione: da piatto (v1) a macro-nodi (v2) --- */
      const corr = nuovoFormato
        ? data.esercizioCorrente
        : {
            esercizio: data.esercizio,
            schemaRF: data.schemaRF,
            cassaIniziale: data.cassaIniziale,
            cassaFinale: data.cassaFinale,
            fonte: null,
            voci: data.voci,
            ni: { estratti: data.niEstratti, rettifiche: data.niRettifiche, redFlags: data.niRedFlags, fonte: data.niFonte },
            rg: { estratti: data.rgEstratti, rettifiche: data.rgRettifiche, redFlags: data.rgRedFlags, fonte: data.rgFonte },
          };
      const prec = (nuovoFormato && data.esercizioPrecedente) || {};
      const stato = nuovoFormato
        ? data.statoApplicazione || {}
        : {
            aliquotaFiscale: data.aliquotaFiscale,
            modoInputDati: data.modoInputDati,
            spData: data.spData,
            spFonte: data.spFonte,
            ceData: data.ceData,
            ceFonte: data.ceFonte,
            spManCorr: data.spManCorr,
            spManPrec: data.spManPrec,
            spManAnni: data.spManAnni,
            ceMan: data.ceMan,
          };

      const idratraVoci = (arr) =>
        (arr || []).map((v) => ({
          ...v,
          id: v.id || nuovoId(),
          importo: Number(v.importo) || 0,
          classe: CLASSI_RF[v.classe] ? v.classe : "da_classificare",
        }));
      const num = (x, fallback = null) => (Number.isFinite(Number(x)) ? Number(x) : fallback);

      /* --- esercizio corrente --- */
      setVoci(idratraVoci(corr.voci));
      if (data.azienda) setAzienda(data.azienda);
      if (corr.esercizio) setEsercizio(corr.esercizio);
      setSchemaRF(corr.schemaRF || null);
      setCassaIniziale(num(corr.cassaIniziale));
      setCassaFinale(num(corr.cassaFinale));
      setNiEstratti(corr.ni?.estratti || []);
      setNiRettifiche(corr.ni?.rettifiche || []);
      setNiRedFlags(corr.ni?.redFlags || []);
      setNiFonte(corr.ni?.fonte || null);
      setRgEstratti(corr.rg?.estratti || []);
      setRgRettifiche(corr.rg?.rettifiche || []);
      setRgRedFlags(corr.rg?.redFlags || []);
      setRgFonte(corr.rg?.fonte || null);

      /* --- esercizio precedente --- */
      setVociPrec(idratraVoci(prec.voci));
      setEsercizioPrec(prec.esercizio || "");
      setSchemaRFPrec(prec.schemaRF || null);
      setCassaInizialePrec(num(prec.cassaIniziale));
      setCassaFinalePrec(num(prec.cassaFinale));
      setFontePrec(prec.fonte || null);
      setNiEstrattiPrec(prec.ni?.estratti || []);
      setNiRettifichePrec(prec.ni?.rettifiche || []);
      setNiRedFlagsPrec(prec.ni?.redFlags || []);
      setNiFontePrec(prec.ni?.fonte || null);
      setRgEstrattiPrec(prec.rg?.estratti || []);
      setRgRettifichePrec(prec.rg?.rettifiche || []);
      setRgRedFlagsPrec(prec.rg?.redFlags || []);
      setRgFontePrec(prec.rg?.fonte || null);

      /* --- stato applicazione --- */
      setAliquotaFiscale(num(stato.aliquotaFiscale, 24));
      /* Modalità Singolo Anno: si riprende il lavoro con la stessa ancora
         temporale (anno T e anno dei documenti T-1) con cui era iniziato. */
      setModalitaSingoloAnno(!!stato.modalitaSingoloAnno);
      setAnnoSpecifico(typeof stato.annoSpecifico === "string" ? stato.annoSpecifico : "");
      setAnnoSpecificoPrec(typeof stato.annoSpecificoPrec === "string" ? stato.annoSpecificoPrec : "");
      setSpData(stato.spData || null);
      setSpFonte(stato.spFonte || null);
      setCeData(stato.ceData || null);
      setCeFonte(stato.ceFonte || null);
      setModoInputDati(stato.modoInputDati || "file");
      setSpManCorr(stato.spManCorr || {});
      setSpManPrec(stato.spManPrec || {});
      setSpManAnni(stato.spManAnni || { corr: "", prec: "" });
      setCeMan(stato.ceMan || {});

      setNiFile(null); // il testo della NI non viaggia nel JSON: per rianalizzare, ricaricare il file
      niFirma.current = null;
      setRgFile(null); // idem per la Relazione sulla Gestione
      rgFirma.current = null;

      const nCorr = (corr.voci || []).length;
      const nPrec = (prec.voci || []).length;
      setFonte(corr.fonte || `«${file.name}» (${nCorr} voci)`);
      setStatoIA({
        tipo: "successo",
        msg: `✓ File caricato: ${file.name} — ${nCorr} voci esercizio corrente${nPrec ? `, ${nPrec} voci esercizio precedente` : " (nessun comparativo nel file)"}${nuovoFormato ? "" : " · formato legacy convertito"}`,
      });
      setStatoIAPrec(null);
      setTimeout(() => setStatoIA(null), 3000);
    } catch (err) {
      console.error("Errore caricamento JSON:", err);
      setStatoIA({ tipo: "errore", msg: `❌ Errore caricamento: ${err.message || "File JSON non valido"}` });
    }
  };

  /* ---- rettifiche NI raggruppate per sezione tematica (per la UI) ---- */
  const rettifichePerSezione = useMemo(() => {
    const map = { 1: [], 2: [], 3: [], 4: [] };
    niRettifiche.forEach((r, idx) => {
      const sez = RF_RETT_TIPI[r.tipo]?.sezione || 4;
      map[sez].push({ ...r, idx });
    });
    return map;
  }, [niRettifiche]);

  const rettificheApplicate = niRettifiche.filter((r) => r.attiva && r.classeOrigine).length;
  const rettificheApplicateRG = rgRettifiche.filter((r) => r.attiva && r.classeOrigine).length;

  /* ============================================================
     SEZIONE 5 — Indicatori con soglie esplicite a 3 fasce
     ============================================================ */
  const indicatori = useMemo(() => {
    /* oneri finanziari PAGATI dal RF: somma delle voci di servizio del
       debito il cui nome contiene «interess»; se il rendiconto non li
       distingue, fallback prudente sull'intero servizio del debito
       (segnalato nel testo dell'indicatore). */
    const vociInteressi = voci.filter(
      (v) => v.classe === "finanza_passiva_servizio" && /interess/i.test(v.nome)
    );
    const oneriPagati = vociInteressi.length
      ? vociInteressi.reduce((a, v) => a + (Number(v.importo) || 0), 0)
      : rf.servizioDelDebito;
    const oneriDaInteressi = vociInteressi.length > 0;

    /* 1 · Cash Flow to Debt Ratio = FCFO / Debiti finanziari totali (da SP)
       Soglie: ≥ 20% verde (debito rimborsabile in ≤ 5 anni col solo FCFO) ·
       10–20% giallo · < 10% rosso. */
    let cfDebt = null, cfDebtGiud = "info";
    if (spDelta && spDelta.debFinTot > 0 && voci.length) {
      cfDebt = rf.fcfo / spDelta.debFinTot;
      cfDebtGiud = cfDebt >= 0.2 ? "ok" : cfDebt >= 0.1 ? "warn" : "bad";
    } else if (spDelta && spDelta.debFinTot === 0 && voci.length) {
      cfDebtGiud = "ok"; // azienda senza debito finanziario
    }

    /* 2 · Copertura oneri per cassa = Flusso operativo corrente / |oneri pagati|
       Soglie: ≥ 5× verde · 2–5× giallo · < 2× rosso (coerenti con l'interest
       coverage del modulo CE). */
    let copertura = null, coperturaGiud = "info";
    if (voci.length) {
      if (Math.abs(oneriPagati) < 1e-9) {
        coperturaGiud = "ok"; // nessun onere pagato rilevato
      } else {
        copertura = rf.flussoOperativoCorrente / Math.abs(oneriPagati);
        coperturaGiud = copertura >= 5 ? "ok" : copertura >= 2 ? "warn" : "bad";
      }
    }

    /* 3 · Cash Flow Margin = FCFO / Ricavi (da CE)
       Soglie: ≥ 10% verde · 5–10% giallo · < 5% rosso. */
    let cfMargin = null, cfMarginGiud = "info";
    if (ceCalc && ceCalc.ricavi > 0 && voci.length) {
      cfMargin = rf.fcfo / ceCalc.ricavi;
      cfMarginGiud = cfMargin >= 0.10 ? "ok" : cfMargin >= 0.05 ? "warn" : "bad";
    }

    /* 4 · FCFO Unlevered (asset side) = FCFO + scudo fiscale del debito
       Lo scudo fiscale = |oneri finanziari pagati| × aliquota: è il minor
       carico d'imposte che l'azienda ha ottenuto grazie alla deducibilità
       degli interessi. Sommandolo al FCFO si ottiene il flusso operativo
       "come se" l'azienda fosse priva di debito (unlevered), utile per una
       valutazione asset-side indipendente dalla struttura finanziaria. */
    let fcfoUnlevered = null, fcfoUnlevGiud = "info", taxShield = 0;
    if (voci.length) {
      const aliq = (Number(aliquotaFiscale) || 0) / 100;
      taxShield = Math.abs(oneriPagati) * aliq;
      fcfoUnlevered = rf.fcfo + taxShield;
      fcfoUnlevGiud = fcfoUnlevered > 0 ? "ok" : fcfoUnlevered === 0 ? "warn" : "bad";
    }

    /* ============================================================
       4 FATTORI CHIAVE DELLA SOLIDITÀ FINANZIARIA
       Ogni fattore raggruppa più indicatori; il giudizio del fattore
       è il "peggiore" tra i sotto-indicatori disponibili (info escluso).
       ============================================================ */
    const rank = { bad: 3, warn: 2, ok: 1, info: 0 };
    const peggiore = (...gs) => gs.reduce((acc, g) => (rank[g] > rank[acc] ? g : acc), "info");

    /* — FATTORE 1 · MOTORE OPERATIVO — */
    /* Cash conversion: quanta EBITDA diventa davvero flusso operativo corrente.
       Soglie: ≥ 70% verde · 40–70% giallo · < 40% rosso. */
    let cashConv = null, cashConvGiud = "info";
    if (ceCalc && ceCalc.ebitda > 0 && voci.length) {
      cashConv = rf.flussoOperativoCorrente / ceCalc.ebitda;
      cashConvGiud = cashConv >= 0.7 ? "ok" : cashConv >= 0.4 ? "warn" : "bad";
    }
    /* Effetto "spugna" del CCNO: ΔCCNO > 0 assorbe cassa, < 0 la libera.
       Rapportato all'EBITDA se disponibile. */
    const spugna = spDelta ? spDelta.deltaCcno : null;
    let spugnaSuEbitda = null, spugnaGiud = "info";
    if (spDelta && voci.length) {
      if (ceCalc && ceCalc.ebitda > 0) {
        spugnaSuEbitda = spugna / ceCalc.ebitda; // quota di EBITDA assorbita (se > 0)
        spugnaGiud = spugnaSuEbitda <= 0 ? "ok" : spugnaSuEbitda <= 0.3 ? "warn" : "bad";
      } else {
        spugnaGiud = spugna <= 0 ? "ok" : "warn";
      }
    }
    const f1Giud = peggiore(cashConvGiud, cfMarginGiud, spugnaGiud);

    /* — FATTORE 2 · SOSTENIBILITÀ DEGLI INVESTIMENTI — */
    /* Copertura degli investimenti = Flusso operativo corrente / |CAPEX uscite|.
       Soglie: ≥ 1× verde (autofinanzia i CAPEX) · 0,6–1× giallo · < 0,6× rosso. */
    let coperturaInvest = null, coperturaInvestGiud = "info";
    const capexOut = Math.abs(rf.capexUscite);
    if (voci.length && capexOut > 1e-9) {
      coperturaInvest = rf.flussoOperativoCorrente / capexOut;
      coperturaInvestGiud = coperturaInvest >= 1 ? "ok" : coperturaInvest >= 0.6 ? "warn" : "bad";
    } else if (voci.length && capexOut <= 1e-9) {
      coperturaInvestGiud = "ok"; // nessun investimento nell'esercizio
    }
    /* FCFO come autofinanziamento dopo i CAPEX (segno). */
    const fcfoGiud = voci.length ? (rf.fcfo > 0 ? "ok" : rf.fcfo === 0 ? "warn" : "bad") : "info";
    const f2Giud = peggiore(coperturaInvestGiud, fcfoGiud, fcfoUnlevGiud);

    /* — FATTORE 3 · SOLVIBILITÀ E SERVIZIO DEL DEBITO — */
    /* DSCR per cassa = FCFO / |servizio del debito| (dopo gli investimenti).
       Soglie: ≥ 1,2× verde · 1–1,2× giallo · < 1× rosso. */
    let dscr = null, dscrGiud = "info";
    const servAbs = Math.abs(rf.servizioDelDebito);
    if (voci.length && servAbs > 1e-9) {
      dscr = rf.fcfo / servAbs;
      dscrGiud = dscr >= 1.2 ? "ok" : dscr >= 1 ? "warn" : "bad";
    } else if (voci.length && servAbs <= 1e-9) {
      dscrGiud = "ok"; // nessun servizio del debito nell'esercizio
    }
    /* FCFE: cassa residua per i soci dopo il servizio del debito (segno). */
    const fcfeGiud = voci.length ? (rf.fcfe > 0 ? "ok" : rf.fcfe === 0 ? "warn" : "bad") : "info";
    const f3Giud = peggiore(dscrGiud, coperturaGiud, fcfeGiud);

    /* — FATTORE 4 · NATURA DELLA COPERTURA E PFN A BREVE — */
    /* Variazione della PFN a breve: > 0 miglioramento (riduce il fabbisogno),
       < 0 peggioramento (nuove tensioni a breve). */
    const pfnGiud = voci.length ? (rf.variazionePfnBt > 0 ? "ok" : rf.variazionePfnBt === 0 ? "warn" : "bad") : "info";
    /* Natura della copertura del fabbisogno complessivo. */
    let naturaCop = "info", naturaCopTxt = "n.d.";
    if (voci.length) {
      if (rf.fcfe >= Math.abs(rf.flussiConSoci) && rf.raccolta <= 0) {
        naturaCop = "ok"; naturaCopTxt = "surplus strutturale di cassa";
      } else if (rf.raccolta > 0 && rf.raccolta >= rf.equityAumenti) {
        naturaCop = "bad"; naturaCopTxt = "ricorso a nuovo debito";
      } else if (rf.equityAumenti > 0) {
        naturaCop = "warn"; naturaCopTxt = "ricorso ai soci (aumenti di capitale)";
      } else if (rf.equityDividendi < 0 && rf.fcfe < Math.abs(rf.flussiConSoci)) {
        naturaCop = "warn"; naturaCopTxt = "erosione di riserve (dividendi oltre l'FCFE)";
      } else {
        naturaCop = "info"; naturaCopTxt = "copertura mista / non determinabile con certezza";
      }
    }
    const f4Giud = peggiore(pfnGiud, cfDebtGiud, naturaCop);

    return {
      oneriPagati, oneriDaInteressi,
      cfDebt, cfDebtGiud, copertura, coperturaGiud, cfMargin, cfMarginGiud,
      fcfoUnlevered, fcfoUnlevGiud, taxShield,
      // fattore 1
      cashConv, cashConvGiud, spugna, spugnaSuEbitda, spugnaGiud, f1Giud,
      // fattore 2
      coperturaInvest, coperturaInvestGiud, fcfoGiud, f2Giud,
      // fattore 3
      dscr, dscrGiud, fcfeGiud, f3Giud,
      // fattore 4
      pfnGiud, naturaCop, naturaCopTxt, f4Giud,
    };
  }, [voci, rf, spDelta, ceCalc, aliquotaFiscale]);

  /* ============================ RENDER ============================ */

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>

        {/* ---------- Modale esportazione JSON ---------- */}
        {esporta && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(15,23,42,0.55)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setEsporta(null); }}
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 flex flex-col gap-4 max-h-[85vh]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold tracking-widest text-teal-700 uppercase mb-1">
                    💾 Esporta analisi
                  </p>
                  <p className="text-sm text-slate-600">
                    File: <span className="font-mono font-semibold">{esporta.nome}</span> ·{" "}
                    {(esporta.testo.length / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={() => setEsporta(null)}
                  className="text-slate-400 hover:text-slate-700 text-xl font-bold leading-none"
                  aria-label="Chiudi"
                >
                  ×
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                In questo ambiente il download automatico può essere bloccato. Usa{" "}
                <b>«Copia negli appunti»</b> e incolla il contenuto in un file di testo salvato come{" "}
                <span className="font-mono">{esporta.nome}</span>, oppure prova il download diretto.
                Per ricaricare l'analisi in futuro usa «📂 Carica dati salvati».
              </p>
              <textarea
                id="export-json-textarea"
                readOnly
                value={esporta.testo}
                className="flex-1 min-h-[180px] border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 resize-none"
              />
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={copiaEsporta}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${esporta.copiato ? "bg-emerald-600 text-white" : "bg-slate-900 text-white hover:bg-slate-700"}`}
                >
                  {esporta.copiato ? "✓ Copiato" : "📋 Copia negli appunti"}
                </button>
                <button
                  onClick={scaricaEsporta}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
                >
                  ⬇ Download diretto
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-6 py-8">

          {/* ---------- Intestazione ---------- */}
          <p className="text-xs font-bold tracking-widest text-teal-700 uppercase mb-1">
            Analisi di bilancio · modulo 3 di 3
          </p>
          <h1 className="text-2xl font-extrabold mb-1">Rendiconto Finanziario Riclassificato — Metodo Indiretto</h1>
          <p className="text-sm text-slate-500 mb-6">
            Estrazione IA del rendiconto (OIC 10 diretto/indiretto · IAS 7), validazione delle voci,
            rettifiche dalla Nota Integrativa, riclassificazione a cascata per aree gestionali e indici di
            cassa. Importa i JSON esportati dai moduli SP e CE per chiudere il Metodo Indiretto completo.
          </p>

          {/* ---------- Anagrafica ---------- */}
          <div className="flex flex-wrap gap-3 mb-6">
            <input
              value={azienda}
              onChange={(e) => setAzienda(e.target.value)}
              placeholder="Azienda"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
              aria-label="Azienda"
            />
            <input
              value={esercizio}
              onChange={(e) => setEsercizio(e.target.value)}
              placeholder="Esercizio (es. 2025)"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40"
              aria-label="Esercizio"
            />
          </div>

          {/* ---------- Modalità Singolo Anno ---------- */}
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={modalitaSingoloAnno}
                onChange={(e) => setModalitaSingoloAnno(e.target.checked)}
                className="w-4 h-4 accent-amber-600"
              />
              <span className="text-sm font-semibold text-amber-900">📌 Modalità Singolo Anno</span>
            </label>
            {modalitaSingoloAnno && (
              <label className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                Anno T
                <input
                  value={annoSpecifico}
                  onChange={(e) => setAnnoSpecifico(e.target.value)}
                  placeholder="es. 2023"
                  inputMode="numeric"
                  className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  aria-label="Anno specifico da estrarre"
                />
              </label>
            )}
            {/* Secondo anno: i documenti caricati negli slot T-1 sono bilanci
                AUTONOMI di un altro esercizio, non colonne comparative, e
                vanno letti sulla loro colonna principale. */}
            {modalitaSingoloAnno && (
              <label className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                Anno documenti T-1
                <input
                  value={annoSpecificoPrec}
                  onChange={(e) => setAnnoSpecificoPrec(e.target.value)}
                  placeholder="es. 2022"
                  inputMode="numeric"
                  className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  aria-label="Anno dei documenti caricati negli slot T-1"
                />
              </label>
            )}
            <p className="text-xs text-amber-700 flex-1 min-w-[240px] leading-snug">
              {modalitaSingoloAnno
                ? `L'IA estrarrà ESCLUSIVAMENTE i flussi dell'anno ${annoSpecifico.trim() || "indicato"} nelle sezioni dell'anno corrente (T) e l'estrazione automatica della colonna comparativa è bloccata. I caricamenti T-1 restano disponibili: carica il rendiconto (o la NI/RG) autonomo dell'esercizio ${annoSpecificoPrec.trim() || "precedente"} per costruire a mano la serie storica — l'IA leggerà la colonna PRINCIPALE di quel documento, non la sua comparativa.`
                : "Attiva per estrarre e analizzare un solo esercizio specifico: l'IA leggerà i flussi del solo anno indicato, senza la doppia estrazione automatica T / T-1."}
            </p>
            {modalitaSingoloAnno && !annoSingoloValido && (
              <p className="text-xs font-semibold text-red-700 basis-full">
                ⚠ Indica un anno di 4 cifre: finché manca, il vincolo sull'annualità non viene iniettato nei prompt.
              </p>
            )}
          </div>

          {/* ---------- Pulsantiera ---------- */}
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => fileMaster.current?.click()}
              disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoMaster}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {caricamentoMaster ? "⏳ Analisi in corso..." : "📖 Carica Bilancio Completo (Unico File)"}
            </button>
            <button
              onClick={() => fileRF.current?.click()}
              disabled={caricamento}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${caricamento ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-700"}`}
            >
              {caricamento ? "⏳ Estrazione in corso…" : "📎 Carica rendiconto (estrazione IA)"}
            </button>
            <button
              onClick={() => fileNI.current?.click()}
              disabled={caricamentoNI}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoNI ? "border-slate-200 text-slate-300" : "border-slate-300 hover:bg-slate-50"}`}
            >
              {caricamentoNI ? "⏳ Analisi NI in corso…" : "📑 Carica Nota Integrativa (IA)"}
            </button>
            <button
              onClick={() => fileRG.current?.click()}
              disabled={caricamentoRG}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoRG ? "border-slate-200 text-slate-300" : "border-slate-300 hover:bg-slate-50"}`}
            >
              {caricamentoRG ? "⏳ Analisi RG in corso…" : "📎 Carica Rel. Gestione (IA)"}
            </button>
            <button
              onClick={() => fileSP.current?.click()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
            >
              📂 Carica JSON SP
            </button>
            <button
              onClick={() => fileCE.current?.click()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
            >
              📂 Carica JSON CE
            </button>
            <button
              onClick={() => fileJSON.current?.click()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
            >
              📂 Carica dati salvati
            </button>
            <button
              onClick={salvaDati}
              disabled={!voci.length}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border ${voci.length ? "border-slate-300 hover:bg-slate-50" : "border-slate-200 text-slate-300"}`}
            >
              💾 Salva dati (JSON)
            </button>
            <button
              onClick={caricaEsempio}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
            >
              🧪 Carica esempio
            </button>
            <button
              onClick={azzera}
              disabled={!voci.length && !niFile && !rgFile && !spData && !ceData && !spManObj && !ceManObj}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border ${voci.length || niFile || rgFile || spData || ceData || spManObj || ceManObj ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-slate-200 text-slate-300"}`}
            >
              🗑 Azzera
            </button>
            <input ref={fileMaster} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMasterFile(f); }} />
            <input ref={fileRF} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) estraiConIA(f); e.target.value = ""; }} />
            <input ref={fileNI} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleNiFile(f); e.target.value = ""; }} />
            <input ref={fileRG} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRgFile(f); e.target.value = ""; }} />
            <input ref={fileSP} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaJsonSP(f); e.target.value = ""; }} />
            <input ref={fileCE} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaJsonCE(f); e.target.value = ""; }} />
            <input ref={fileJSON} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaJSON(f); e.target.value = ""; }} />
            {/* input dedicati all'esercizio precedente (pulsanti nel tab 7) */}
            <input ref={fileRFPrec} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) estraiConIA(f, true); e.target.value = ""; }} />
            <input ref={fileNIPrec} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleNiFilePrec(f); e.target.value = ""; }} />
            <input ref={fileRGPrec} type="file" accept=".pdf,.txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRgFilePrec(f); e.target.value = ""; }} />
          </div>

          {/* ---------- Configurazione IA ---------- */}
          <div className="border border-slate-200 rounded-xl p-5 mb-6">
            <div className="flex flex-wrap items-center gap-4 mb-3">
              <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">🔑 Configurazione IA</span>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                {[["claude", "Claude"], ["openai", "OpenAI"], ["gemini", "Google Gemini"]].map(([id, nome]) => (
                  <button
                    key={id}
                    onClick={() => setProvider(id)}
                    className={`px-4 py-1.5 font-semibold ${provider === id ? "bg-white text-slate-900" : "bg-slate-50 text-slate-400"}`}
                  >
                    {nome}
                  </button>
                ))}
              </div>
            </div>
            {/* Nota sulla lettura dei PDF: Claude e Gemini ricevono il file nel
                formato nativo, OpenAI le stesse pagine convertite in immagini
                nel browser. In tutti e tre i casi il documento è letto
                visivamente, quindi funzionano anche scansioni e file
                «Stampa su PDF». */}
            <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
              {provider === "openai" ? (
                <>
                  📄 Con <b>OpenAI</b> le pagine del PDF vengono convertite in immagini <b>nel browser</b>
                  prima dell'invio: funzionano anche le scansioni e i file creati con «Stampa su PDF», privi
                  di testo selezionabile. La conversione richiede qualche secondo e consuma più token rispetto
                  a <b>Claude</b> e <b>Gemini</b>, che ricevono il PDF nel formato nativo. I documenti lunghi
                  vengono suddivisi automaticamente in porzioni da {PAGINE_PER_PORZIONE} pagine.
                </>
              ) : (
                <>
                  📄 Il PDF viene inviato nel formato nativo e letto <b>pagina per pagina</b>: funzionano anche
                  le scansioni e i file creati con «Stampa su PDF», privi di testo selezionabile. I documenti
                  lunghi vengono suddivisi automaticamente in porzioni da {PAGINE_PER_PORZIONE} pagine.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-3 items-center mb-2">
              {provider === "claude" && CLAUDE_DIRETTO ? (
                <div className="flex-1 min-w-[240px] flex items-center border border-teal-200 bg-teal-50 rounded-lg px-3 py-2 text-sm text-teal-800">
                  <span className="mr-2">✓</span>
                  Claude autenticato dall'ambiente ospite — nessuna chiave da inserire
                </div>
              ) : (
                <div className="flex-1 min-w-[240px] flex items-center border border-slate-300 rounded-lg px-3">
                  <input
                    type={mostraChiave ? "text" : "password"}
                    value={chiavi[provider] || ""}
                    onChange={(e) => setChiavi((k) => ({ ...k, [provider]: e.target.value }))}
                    placeholder={provider === "openai" ? "sk-…" : provider === "claude" ? "sk-ant-… (lascia vuoto per usare quella del server)" : "AIza…"}
                    className="flex-1 py-2 text-sm outline-none bg-transparent"
                    aria-label="Chiave API"
                  />
                  <button onClick={() => setMostraChiave((s) => !s)} className="text-slate-400 hover:text-slate-700" aria-label="Mostra chiave">👁</button>
                </div>
              )}
              <input
                value={modello[provider]}
                onChange={(e) => setModello((m) => ({ ...m, [provider]: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono w-56"
                aria-label="Modello IA"
              />
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {provider === "claude" ? (
                CLAUDE_DIRETTO ? (
                  <>
                    Con Claude non serve gestire alcuna chiave: dentro un artifact la richiesta è autenticata
                    dall'ambiente ospite. Le funzioni IA (rilevamento schema, estrazione voci, analisi NI)
                    usano il provider e il modello scelti qui; l'import dei JSON SP/CE e tutti i calcoli dei
                    tab 4-6 sono locali e non usano l'IA.
                  </>
                ) : (
                  <>
                    Lascia il campo vuoto per usare la chiave configurata sul server (variabile d'ambiente{" "}
                    <code>ANTHROPIC_API_KEY</code>); oppure inserisci qui la tua chiave Anthropic (<code>sk-ant-…</code>)
                    per non doverla configurare come variabile d'ambiente — in quel caso viene usata solo dal tuo
                    browser per la sessione corrente e passa dalla funzione «/api/anthropic», che la inoltra ad
                    Anthropic senza mai salvarla su disco né scriverla nei log del server. Le funzioni IA
                    (rilevamento schema, estrazione voci, analisi NI) usano il provider e il modello scelti qui;
                    l'import dei JSON SP/CE e tutti i calcoli dei tab 4-6 sono locali e non usano l'IA.
                  </>
                )
              ) : (
                <>
                  La chiave del provider selezionato viene usata solo dal tuo browser per chiamare
                  direttamente l'API scelta e resta esclusivamente in memoria durante la sessione: non viene
                  salvata né inviata altrove. Le funzioni IA (rilevamento schema, estrazione voci, analisi NI)
                  usano il provider e il modello scelti qui; l'import dei JSON SP/CE e tutti i calcoli dei
                  tab 4-6 sono locali e non usano l'IA.
                </>
              )}
            </p>
          </div>

          {/* ---------- Righe di stato ---------- */}
          <div className="space-y-1 mb-6 text-sm">
            {schemaRF?.schema && (
              <p className="text-teal-700">
                Schema del rendiconto: {SCHEMI_RF_LABEL[schemaRF.schema] || schemaRF.schema}
                {schemaRF.valuta && ` · ${schemaRF.valuta}`}
                {schemaRF.unita && ` · importi in ${schemaRF.unita}`}
              </p>
            )}
            {schemaRF?.schema === "oic10_diretto" && (
              <p className="text-amber-600">
                ⚠ Metodo diretto rilevato: il documento non espone i margini intermedi del metodo indiretto;
                le voci sono state mappate direttamente sui flussi, senza subtotali intermedi.
              </p>
            )}
            {schemaRF?.indizi && (
              <p className="text-slate-500 text-xs italic">Segnali di riconoscimento: {schemaRF.indizi}</p>
            )}
            {fonte && <p className="text-teal-700">Dati caricati da {fonte}.</p>}
            {niFonte && <p className="text-teal-700">Nota Integrativa: {niFonte}.</p>}
            {niFile && !niFonte && !caricamentoNI && (
              <p className="text-slate-500">
                Nota Integrativa «{niFile.nome}» pronta: l'analisi parte automaticamente appena le voci del
                rendiconto sono disponibili.
              </p>
            )}
            {rgFonte && <p className="text-teal-700">Relazione sulla Gestione: {rgFonte}.</p>}
            {rgFile && !rgFonte && !caricamentoRG && (
              <p className="text-slate-500">
                Relazione sulla Gestione «{rgFile.nome}» pronta: l'analisi parte automaticamente appena le
                voci del rendiconto sono disponibili.
              </p>
            )}
            {spFonteEff && <p className="text-teal-700">Stato Patrimoniale: {spFonteEff}.</p>}
            {ceFonteEff && <p className="text-teal-700">Conto Economico: {ceFonteEff}.</p>}
            {niRettifiche.length > 0 && (
              <p className={rettificheApplicate < niRettifiche.length ? "text-amber-600" : "text-teal-700"}>
                Rettifiche NI: {niRettifiche.length} individuate · {rettificheApplicate} applicate al rendiconto
                {rettificheApplicate < niRettifiche.length &&
                  ` · ${niRettifiche.length - rettificheApplicate} escluse o in attesa di classe di origine (tab 2)`}
              </p>
            )}
            {rgRettifiche.length > 0 && (
              <p className={rettificheApplicateRG < rgRettifiche.length ? "text-amber-600" : "text-teal-700"}>
                Rettifiche RG: {rgRettifiche.length} individuate · {rettificheApplicateRG} applicate al rendiconto
                {rettificheApplicateRG < rgRettifiche.length &&
                  ` · ${rgRettifiche.length - rettificheApplicateRG} escluse o in attesa di classe di origine (tab 3)`}
              </p>
            )}
            {voci.length > 0 && (
              <p className={sintesi.daClassificare ? "text-amber-600" : "text-teal-700"}>
                {sintesi.daClassificare
                  ? `Voci da classificare: ${sintesi.daClassificare} — escluse dai calcoli finché non assegnate`
                  : sintesi.deltaCassa != null
                  ? `Quadratura con la cassa: Σ flussi del documento ${fmt(sintesi.totaleLordo)} · Δ disponibilità liquide ${fmt(sintesi.deltaCassa)} ${sintesi.quadra ? "✓" : "✗ (verifica voci mancanti o segni)"}`
                  : `Σ flussi classificati: ${fmt(sintesi.totale)} — disponibilità iniziali/finali non rilevate: quadratura con la cassa non verificabile`}
              </p>
            )}
            {checkQuadratura && (
              <p className={checkQuadratura.ok ? "text-teal-700" : "text-rose-600"}>
                {checkQuadratura.ok
                  ? `Quadratura RF ↔ SP: Σ flussi RF ${fmt(checkQuadratura.flussiRF)} = ΔLiquidità SP ${fmt(checkQuadratura.deltaLiq)} ✓`
                  : `Quadratura RF ↔ SP non riuscita: scarto ${fmt(Math.abs(checkQuadratura.scarto))} — dettagli nel tab 4`}
              </p>
            )}
            {voci.length > 0 && sintesi.segniAnomali > 0 && (
              <p className="text-amber-600">
                ⚠ {sintesi.segniAnomali} voce/i con segno contrario a quello atteso dalla classe: verifica
                nella tabella (evidenziate in ambra).
              </p>
            )}
            {fontePrec && <p className="text-indigo-700">Esercizio precedente ({esercizioPrec || "T-1"}): dati da {fontePrec}.</p>}
            {niFontePrec && <p className="text-indigo-700">Nota Integrativa T-1: {niFontePrec}.</p>}
            {rgFontePrec && <p className="text-indigo-700">Relazione sulla Gestione T-1: {rgFontePrec}.</p>}
            {vociPrec.length > 0 && (
              <p className={sintesiPrec.daClassificare ? "text-amber-600" : "text-indigo-700"}>
                {sintesiPrec.daClassificare
                  ? `T-1 · voci da classificare: ${sintesiPrec.daClassificare} — escluse dai calcoli finché non assegnate (tab 7)`
                  : sintesiPrec.deltaCassa != null
                  ? `T-1 · quadratura con la cassa: Σ flussi ${fmt(sintesiPrec.totaleLordo)} · Δ disponibilità liquide ${fmt(sintesiPrec.deltaCassa)} ${sintesiPrec.quadra ? "✓" : "✗ (verifica voci mancanti o segni)"}`
                  : `T-1 · Σ flussi classificati: ${fmt(sintesiPrec.totale)} — disponibilità iniziali/finali non rilevate`}
              </p>
            )}
            {statoIA && (
              <p className={statoIA.tipo === "errore" ? "text-rose-600" : "text-teal-700"}>{statoIA.msg}</p>
            )}
            {(statoIAPrec || caricamentoPrec) && (
              <p className={statoIAPrec?.tipo === "errore" ? "text-rose-600" : "text-indigo-700"}>
                {caricamentoPrec && !statoIAPrec ? "T-1 · elaborazione dell'esercizio precedente in corso…" : statoIAPrec?.msg}
              </p>
            )}
          </div>

          {/* ---------- Tabs ---------- */}
          <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-slate-200 mb-6 text-sm font-semibold">
            {[
              [1, "1 · Dati & Validazione"],
              [2, `2 · Nota Integrativa${niEstratti.length ? ` (${niEstratti.length})` : ""}`],
              [3, `3 · Relazione sulla Gestione${rgEstratti.length ? ` (${rgEstratti.length})` : ""}`],
              [4, "4 · Dati SP & CE"],
              [5, "5 · Riclassificazione RF"],
              [6, "6 · Margini e indici"],
              [7, `7 · Dati & Validazione T-1${vociPrec.length ? ` (${vociPrec.length})` : ""}`],
              [8, "8 · Riclassificazione RF T-1"],
              [9, "9 · Variazioni e Trend (Δ Flussi)"],
              [10, `10 · Audit del Revisore${auditUnificato.gravi ? ` (${auditUnificato.gravi})` : ""}`],
            ].map(([id, nome]) => {
              const isPrecTab = Number(id) >= 7 && Number(id) <= 9;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`pb-3 -mb-px border-b-2 ${
                    tab === id
                      ? isPrecTab
                        ? "border-indigo-600 text-indigo-700"
                        : "border-slate-900 text-slate-900"
                      : `border-transparent ${isPrecTab ? "text-indigo-400 hover:text-indigo-700" : "text-slate-500 hover:text-slate-800"}`
                  }`}
                >
                  {nome}
                </button>
              );
            })}
          </div>

          {/* ================= TAB 1 · DATI & VALIDAZIONE ================= */}
          {tab === 1 && (
            <>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">🧩 Come funziona lo schema dinamico</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  L'IA rileva prima lo <b>schema del rendiconto</b> (OIC 10 diretto o indiretto, oppure IAS 7),
                  poi estrae <b>tutte le voci di flusso originali</b> e propone per ciascuna una{" "}
                  <b>classe di pertinenza gestionale</b> articolata per aree: <b>operativa</b> (flusso corrente
                  e gestione finanziaria attiva), <b>investimenti</b> (CAPEX in uscita e in entrata),{" "}
                  <b>finanziamento — debito</b> (raccolta e servizio) e <b>finanziamento — equity</b> (aumenti
                  di capitale e dividendi). Convenzione di segno: <b>entrate positive, uscite negative</b>. Qui
                  sotto validi il lavoro: correggi nomi, importi e classi, elimini o aggiungi voci. Le formule
                  della riclassificazione (tab 5) aggregano le voci per classe, adattandosi automaticamente;
                  le voci «da classificare» restano escluse dai calcoli finché non le assegni. Le voci con
                  bordo indaco sono generate dalle <b>rettifiche della Nota Integrativa</b> (tab 2): si
                  modificano da lì, non qui.
                </p>
              </div>

              {voci.length === 0 && (
                <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                  Nessuna voce presente. Carica un rendiconto finanziario con l'estrattore IA, apri un file di
                  dati salvati oppure usa «Carica esempio» per iniziare.
                </div>
              )}

              {voci.length > 0 && (
                <>
                  {/* ---- Disponibilità liquide iniziali/finali ---- */}
                  <div className="flex flex-wrap gap-3 mb-4 items-end">
                    {[
                      ["Disponibilità liquide iniziali", cassaIniziale, setCassaIniziale],
                      ["Disponibilità liquide finali", cassaFinale, setCassaFinale],
                    ].map(([label, val, setter]) => (
                      <div key={label}>
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">{label}</p>
                        <input
                          type="number"
                          value={val ?? ""}
                          onChange={(e) => setter(e.target.value === "" ? null : Number(e.target.value))}
                          placeholder="n/d"
                          className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono w-44 text-right"
                          aria-label={label}
                        />
                      </div>
                    ))}
                    {sintesi.deltaCassa != null && (
                      <div className="text-sm text-slate-600 pb-2">
                        Δ disponibilità: <span className="font-mono font-bold">{fmt(sintesi.deltaCassa)}</span>
                      </div>
                    )}
                  </div>

                  {/* ---- Tabella di validazione (componente condiviso con il tab 7) ---- */}
                  <TabellaVoci voci={voci} aggiorna={aggiorna} elimina={elimina} />

                  <button
                    onClick={aggiungi}
                    className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50 mb-6"
                  >
                    ＋ Aggiungi voce
                  </button>

                  {/* ---- Subtotali per area (anteprima) ---- */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {Object.entries(AREE_RF).map(([k, a]) => (
                      <div key={k} className="border border-slate-200 rounded-xl p-5">
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">{a.label}</p>
                        <p className={`text-2xl font-extrabold font-mono ${sintesi.perArea[k] < 0 ? "text-rose-700" : "text-slate-900"}`}>
                          {fmtC(sintesi.perArea[k])}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {sintesi.totale ? pct(Math.abs(sintesi.perArea[k]), Math.abs(sintesi.totale)) : "—"} del flusso netto
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="border border-teal-200 bg-teal-50 rounded-xl p-5 text-sm text-teal-900 leading-relaxed">
                    <b>Prossimi passi.</b> Questi subtotali sono un'anteprima di controllo: la cascata completa
                    (Flusso operativo corrente → FCFO → FCFE → Δ PFN a breve) è nel tab «4 · Riclassificazione
                    RF»; nel tab «3 · Dati SP & CE» carichi i JSON degli altri due moduli per il check di
                    quadratura e gli indici del tab 6.
                  </div>
                </>
              )}
            </>
          )}

          {/* ================= TAB 2 · NOTA INTEGRATIVA (4 SEZIONI) ================= */}
          {tab === 2 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">📑 Nota Integrativa filtrata in 4 sezioni tematiche</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  L'IA legge la Nota Integrativa e ne estrae SOLO le informazioni utili all'analisi del
                  Rendiconto Finanziario, organizzate in quattro sezioni: <b>1) Debito finanziario</b> (per
                  separare la raccolta dai rimborsi quando il rendiconto espone solo la variazione netta),{" "}
                  <b>2) Dividendi e soci</b> (deliberati vs effettivamente pagati per cassa),{" "}
                  <b>3) Operazioni non monetarie</b> (leasing, conversioni, permute da stornare dai flussi) e{" "}
                  <b>4) Altre informazioni sulla cassa</b>. Dalle informazioni quantificate nascono{" "}
                  <b>rettifiche in partita doppia</b> — storno nella classe di origine + contropartita nella
                  classe di destinazione (solo storno per le poste non-cash) — che alimentano direttamente le
                  voci della sezione 1. Ogni rettifica ha un interruttore includi/escludi e un importo
                  modificabile. L'analisi parte <b>automaticamente</b> appena rendiconto e Nota Integrativa
                  sono entrambi disponibili.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-6">
                <button
                  onClick={() => fileNI.current?.click()}
                  disabled={caricamentoNI}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${caricamentoNI ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-700"}`}
                >
                  {caricamentoNI ? "⏳ Analisi in corso…" : "📑 Carica Nota Integrativa (IA)"}
                </button>
                <button
                  onClick={() => { niFirma.current = null; estraiNI(); }}
                  disabled={caricamentoNI || !niFile || !voci.length}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoNI || !niFile || !voci.length ? "border-slate-200 text-slate-300" : "border-slate-300 hover:bg-slate-50"}`}
                  title={!niFile ? "Carica prima il file della Nota Integrativa" : !voci.length ? "Servono le voci del rendiconto (sezione 1)" : ""}
                >
                  ↻ Rigenera analisi
                </button>
                {niFile && (
                  <span className="text-xs text-slate-500">
                    File pronto: <span className="font-mono">{niFile.nome}</span>
                  </span>
                )}
              </div>

              {niEstratti.length === 0 && !caricamentoNI && (
                <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                  {niFile
                    ? voci.length
                      ? "Nessun estratto disponibile: l'analisi non ha trovato informazioni rilevanti, oppure non è ancora partita. Usa «↻ Rigenera analisi»."
                      : "Nota Integrativa pronta: l'analisi partirà automaticamente appena estrai o carichi le voci del rendiconto (sezione 1)."
                    : "Nessuna Nota Integrativa caricata. Usa «📑 Carica Nota Integrativa (IA)»: l'analisi partirà da sola appena anche le voci del rendiconto saranno disponibili."}
                </div>
              )}

              {(niEstratti.length > 0 || niRettifiche.length > 0) && (
                <div className="space-y-6 mb-6">
                  {[1, 2, 3, 4].map((sez) => {
                    const cfg = NI_SEZIONI_RF[sez];
                    const estratti = niEstratti.filter((e) => e.sezione === sez);
                    const retts = rettifichePerSezione[sez];
                    if (!estratti.length && !retts.length) return null;
                    return (
                      <div key={sez} className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className={`px-5 py-3 border-b ${cfg.color}`}>
                          <p className="text-sm font-bold flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-bold ${cfg.badge}`}>{sez}</span>
                            {cfg.titolo}
                            <span className="font-normal text-xs opacity-70">
                              · {estratti.length} estratt{estratti.length === 1 ? "o" : "i"}
                              {retts.length ? ` · ${retts.length} rettific${retts.length === 1 ? "a" : "he"}` : ""}
                            </span>
                          </p>
                        </div>
                        <div className="px-5 py-4 bg-white space-y-3">
                          {estratti.length === 0 && (
                            <p className="text-sm text-slate-500">Nessun estratto per questa sezione.</p>
                          )}
                          {estratti.map((e, i) => (
                            <div key={i} className={`text-sm ${i ? "pt-3 border-t border-slate-100" : ""}`}>
                              <p className="font-semibold text-slate-800">
                                {e.tema}
                                {e.pagina != null && <span className="font-normal text-slate-400 text-xs"> · pagina {e.pagina}</span>}
                              </p>
                              <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">{e.contenuto}</p>
                            </div>
                          ))}

                          {retts.length > 0 && (
                            <div className="pt-3 border-t border-slate-200 space-y-3">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                Rettifiche collegate — applicate in partita doppia alle voci della sezione 1
                              </p>
                              {retts.map((r) => {
                                const t = RF_RETT_TIPI[r.tipo];
                                const applicabile = !!r.classeOrigine;
                                return (
                                  <div key={r.idx} className={`border rounded-xl px-4 py-3 ${r.attiva && applicabile ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                                    <div className="flex items-start gap-3 flex-wrap">
                                      <button
                                        onClick={() => aggiornaRettificaNI(r.idx, { attiva: !r.attiva })}
                                        role="switch"
                                        aria-checked={r.attiva}
                                        disabled={!applicabile}
                                        className={`shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors relative ${r.attiva && applicabile ? "bg-teal-600" : "bg-slate-300"}`}
                                        aria-label={r.attiva ? "Escludi rettifica" : "Includi rettifica"}
                                        title={!applicabile ? "Assegna prima la classe di origine" : ""}
                                      >
                                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${r.attiva && applicabile ? "left-[1.125rem]" : "left-0.5"}`} />
                                      </button>
                                      <div className="flex-1 min-w-[12rem]">
                                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${t.color}`}>{t.label}</span>
                                          {r.pagina != null && (
                                            <span className="text-[11px] text-slate-400 font-mono">· pagina {r.pagina}</span>
                                          )}
                                          {!applicabile && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                                              classe di origine mancante
                                            </span>
                                          )}
                                        </div>
                                        <p className="font-bold text-sm text-slate-900">{r.descrizione}</p>
                                        {r.motivazione && (
                                          <p className="text-xs text-slate-500 mt-0.5">{r.motivazione}</p>
                                        )}
                                        <div className="flex flex-wrap gap-3 mt-2 items-center text-xs">
                                          <label className="flex items-center gap-1.5 text-slate-500">
                                            Origine
                                            <select
                                              value={r.classeOrigine || ""}
                                              onChange={(e) => aggiornaRettificaNI(r.idx, { classeOrigine: e.target.value || null })}
                                              className={`border rounded-lg px-2 py-1 ${!r.classeOrigine ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300"}`}
                                              aria-label="Classe di origine"
                                            >
                                              <option value="">— scegli —</option>
                                              {Object.entries(CLASSI_RF).filter(([k]) => k !== "da_classificare").map(([k, c]) => (
                                                <option key={k} value={k}>{c.label}</option>
                                              ))}
                                            </select>
                                          </label>
                                          {r.tipo !== "non_cash" ? (
                                            <label className="flex items-center gap-1.5 text-slate-500">
                                              Destinazione
                                              <select
                                                value={r.classeDestinazione || ""}
                                                onChange={(e) => aggiornaRettificaNI(r.idx, { classeDestinazione: e.target.value || null })}
                                                className="border border-slate-300 rounded-lg px-2 py-1"
                                                aria-label="Classe di destinazione"
                                              >
                                                <option value="">— solo storno —</option>
                                                {Object.entries(CLASSI_RF).filter(([k]) => k !== "da_classificare").map(([k, c]) => (
                                                  <option key={k} value={k}>{c.label}</option>
                                                ))}
                                              </select>
                                            </label>
                                          ) : (
                                            <span className="text-slate-400 italic">solo storno: neutralizza la posta non monetaria</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Importo</span>
                                        <input
                                          type="number"
                                          value={r.importo}
                                          onChange={(e) => aggiornaRettificaNI(r.idx, { importo: Number(e.target.value) || 0 })}
                                          className={`w-32 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono text-sm bg-white ${r.importo < 0 ? "text-rose-700" : "text-slate-900"}`}
                                          aria-label="Importo rettifica"
                                        />
                                        <button
                                          onClick={() => rimuoviRettificaNI(r.idx)}
                                          className="text-xs text-rose-500 hover:text-rose-700 font-semibold"
                                          aria-label="Elimina rettifica"
                                        >
                                          elimina
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {niRedFlags.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <p className="text-sm font-bold">🚩 Red flag sui flussi di cassa ({niRedFlags.length})</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Anomalie segnalate dalla Nota Integrativa: non generano rettifiche automatiche, ma
                      orientano la lettura del rendiconto riclassificato (tab 5-6).
                    </p>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {niRedFlags.map((f, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${GRAVITA_STYLE[f.gravita]}`}>
                          {f.gravita}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-800">
                            {RF_FLAG_LABELS[f.flag] || RF_FLAG_LABELS.altro}
                            {f.pagina != null && <span className="font-normal text-slate-400 text-xs"> · pagina {f.pagina}</span>}
                          </p>
                          <p className="text-xs text-slate-600 mt-0.5">{f.evidenza}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(niEstratti.length > 0 || niRettifiche.length > 0) && (
                <div className="border border-teal-200 bg-teal-50 rounded-xl p-5 text-sm text-teal-900 leading-relaxed">
                  <b>Le rettifiche attive sono già applicate.</b> Ogni rettifica inclusa genera nella sezione 1
                  una coppia di voci in partita doppia con bordo indaco — «Storno NI: …» nella classe di
                  origine e «Rettifica NI: …» nella classe di destinazione (solo lo storno per le poste
                  non-cash) — che confluiscono nella cascata del tab 5. La quadratura con la cassa del
                  documento resta calcolata al lordo degli storni, per non generare falsi allarmi.
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 3 · RELAZIONE SULLA GESTIONE ================= */}
          {tab === 3 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">📎 Relazione sulla Gestione filtrata in 4 sezioni tematiche</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  L'IA legge la Relazione sulla Gestione (il documento discorsivo degli amministratori) e ne
                  estrae SOLO le informazioni utili alla lettura prospettica dei flussi di cassa, organizzate in
                  quattro sezioni: <b>1) Strategia di investimento e CAPEX futuri</b>, <b>2) Politiche di
                  finanziamento e struttura del debito</b>, <b>3) Remunerazione degli azionisti e dividendi</b>{" "}
                  e <b>4) Dinamica del capitale circolante</b> (le spiegazioni dei manager su crediti,
                  magazzino e fornitori). Se la Relazione esplicita importi (es. rimborsi di mutui o poste
                  non-cash erroneamente confluite nei flussi), l'IA propone anche <b>rettifiche in partita
                  doppia</b>, che si sommano a quelle della Nota Integrativa nel prospetto a cascata (tab 5).
                  L'analisi parte <b>automaticamente</b> appena rendiconto e Relazione sono entrambi disponibili.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-6">
                <button
                  onClick={() => fileRG.current?.click()}
                  disabled={caricamentoRG}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${caricamentoRG ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-700"}`}
                >
                  {caricamentoRG ? "⏳ Analisi in corso…" : "📎 Carica Rel. Gestione (IA)"}
                </button>
                <button
                  onClick={() => { rgFirma.current = null; estraiRG(); }}
                  disabled={caricamentoRG || !rgFile || !voci.length}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoRG || !rgFile || !voci.length ? "border-slate-200 text-slate-300" : "border-slate-300 hover:bg-slate-50"}`}
                  title={!rgFile ? "Carica prima il file della Relazione sulla Gestione" : !voci.length ? "Servono le voci del rendiconto (sezione 1)" : ""}
                >
                  ↻ Rigenera analisi
                </button>
                {rgFile && (
                  <span className="text-xs text-slate-500">
                    File pronto: <span className="font-mono">{rgFile.nome}</span>
                  </span>
                )}
              </div>

              {rgEstratti.length === 0 && !caricamentoRG && (
                <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                  {rgFile
                    ? voci.length
                      ? "Nessun estratto disponibile: l'analisi non ha trovato informazioni rilevanti, oppure non è ancora partita. Usa «↻ Rigenera analisi»."
                      : "Relazione sulla Gestione pronta: l'analisi partirà automaticamente appena estrai o carichi le voci del rendiconto (sezione 1)."
                    : "Nessuna Relazione sulla Gestione caricata. Usa «📎 Carica Rel. Gestione (IA)»: l'analisi partirà da sola appena anche le voci del rendiconto saranno disponibili."}
                </div>
              )}

              {/* 4 riquadri tematici degli estratti */}
              {rgEstratti.length > 0 && (
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  {[1, 2, 3, 4].map((sez) => {
                    const cfg = RG_SEZIONI_RF[sez];
                    const estratti = rgEstratti.filter((e) => e.sezione === sez);
                    return (
                      <div key={sez} className={`border rounded-xl overflow-hidden ${cfg.color.split(" ").filter((c) => c.startsWith("border")).join(" ")}`}>
                        <div className={`px-5 py-3 border-b ${cfg.color}`}>
                          <p className="text-sm font-bold flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-bold ${cfg.badge}`}>{sez}</span>
                            {cfg.titolo}
                            <span className="font-normal text-xs opacity-70">· {estratti.length} estratt{estratti.length === 1 ? "o" : "i"}</span>
                          </p>
                        </div>
                        <div className="px-5 py-4 bg-white space-y-3 min-h-[80px]">
                          {estratti.length === 0 && (
                            <p className="text-sm text-slate-400">Nessun estratto per questa sezione.</p>
                          )}
                          {estratti.map((e, i) => (
                            <div key={i} className={`text-sm ${i ? "pt-3 border-t border-slate-100" : ""}`}>
                              <p className="font-semibold text-slate-800">
                                {e.tema}
                                {e.pagina != null && <span className="font-normal text-slate-400 text-xs"> · pagina {e.pagina}</span>}
                              </p>
                              <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">{e.contenuto}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tabella riepilogativa delle rettifiche RG */}
              {rgRettifiche.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <p className="text-sm font-bold">🧾 Tabella riepilogativa delle rettifiche (RG)</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rettifiche a partita doppia scaturite dalla Relazione: attiva/disattiva ciascuna con lo
                      switch. Le rettifiche attive si sommano a quelle della Nota Integrativa nella cascata (tab 5).
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          <th className="px-4 py-2">Attiva</th>
                          <th className="px-4 py-2">Descrizione</th>
                          <th className="px-4 py-2">Classe di origine</th>
                          <th className="px-4 py-2">Classe di destinazione</th>
                          <th className="px-4 py-2 text-right">Importo</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rgRettifiche.map((r, idx) => {
                          const t = RF_RETT_TIPI[r.tipo];
                          const applicabile = !!r.classeOrigine;
                          return (
                            <tr key={idx} className={`border-t border-slate-100 ${r.attiva && applicabile ? "" : "opacity-60"}`}>
                              <td className="px-4 py-2">
                                <button
                                  onClick={() => aggiornaRettificaRG(idx, { attiva: !r.attiva })}
                                  role="switch"
                                  aria-checked={r.attiva}
                                  disabled={!applicabile}
                                  className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${r.attiva && applicabile ? "bg-teal-600" : "bg-slate-300"}`}
                                  aria-label={r.attiva ? "Escludi rettifica" : "Includi rettifica"}
                                  title={!applicabile ? "Assegna prima la classe di origine" : ""}
                                >
                                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${r.attiva && applicabile ? "left-[1.125rem]" : "left-0.5"}`} />
                                </button>
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                  {t && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${t.color}`}>{t.label}</span>}
                                  {r.pagina != null && <span className="text-[11px] text-slate-400 font-mono">· pag. {r.pagina}</span>}
                                  {!applicabile && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                                      origine mancante
                                    </span>
                                  )}
                                </div>
                                <p className="font-semibold text-slate-900">{r.descrizione}</p>
                                {r.motivazione && <p className="text-xs text-slate-500 mt-0.5">{r.motivazione}</p>}
                              </td>
                              <td className="px-4 py-2">
                                <select
                                  value={r.classeOrigine || ""}
                                  onChange={(e) => aggiornaRettificaRG(idx, { classeOrigine: e.target.value || null })}
                                  className={`border rounded-lg px-2 py-1 text-xs ${!r.classeOrigine ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300"}`}
                                  aria-label="Classe di origine"
                                >
                                  <option value="">— scegli —</option>
                                  {Object.entries(CLASSI_RF).filter(([k]) => k !== "da_classificare").map(([k, c]) => (
                                    <option key={k} value={k}>{c.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-2">
                                {r.tipo !== "non_cash" ? (
                                  <select
                                    value={r.classeDestinazione || ""}
                                    onChange={(e) => aggiornaRettificaRG(idx, { classeDestinazione: e.target.value || null })}
                                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs"
                                    aria-label="Classe di destinazione"
                                  >
                                    <option value="">— solo storno —</option>
                                    {Object.entries(CLASSI_RF).filter(([k]) => k !== "da_classificare").map(([k, c]) => (
                                      <option key={k} value={k}>{c.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-xs text-slate-400 italic">solo storno (non-cash)</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <input
                                  type="number"
                                  value={r.importo}
                                  onChange={(e) => aggiornaRettificaRG(idx, { importo: Number(e.target.value) || 0 })}
                                  className={`w-28 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-sm bg-white ${r.importo < 0 ? "text-rose-700" : "text-slate-900"}`}
                                  aria-label="Importo rettifica"
                                />
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  onClick={() => rimuoviRettificaRG(idx)}
                                  className="text-rose-500 hover:text-rose-700 font-bold px-1"
                                  aria-label="Elimina rettifica"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* red flag RG */}
              {rgRedFlags.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <p className="text-sm font-bold">🚩 Red flag dalla Relazione sulla Gestione ({rgRedFlags.length})</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Segnali prospettici o di attenzione emersi dalla Relazione: non generano rettifiche
                      automatiche, ma orientano la lettura dei flussi.
                    </p>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {rgRedFlags.map((f, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${GRAVITA_STYLE[f.gravita]}`}>
                          {f.gravita}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-800">
                            {RF_FLAG_LABELS[f.flag] || RF_FLAG_LABELS.altro}
                            {f.pagina != null && <span className="font-normal text-slate-400 text-xs"> · pagina {f.pagina}</span>}
                          </p>
                          <p className="text-xs text-slate-600 mt-0.5">{f.evidenza}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(rgEstratti.length > 0 || rgRettifiche.length > 0) && (
                <div className="border border-teal-200 bg-teal-50 rounded-xl p-5 text-sm text-teal-900 leading-relaxed">
                  <b>Le rettifiche RG attive sono già applicate.</b> Ogni rettifica inclusa genera nella
                  sezione 1 una coppia di voci in partita doppia con bordo indaco (etichettate «Storno RG» /
                  «Rettifica RG»), che si sommano a quelle della Nota Integrativa e confluiscono nella cascata
                  del tab 5. Escludendo o modificando una rettifica qui, le voci collegate si aggiornano
                  immediatamente.
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 4 · DATI SP & CE (nessuna chiamata IA) ================= */}
          {tab === 4 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">🔗 Dati derivati dai moduli SP e CE — nessuna chiamata IA</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Carica i file JSON esportati dagli altri due moduli dell'ecosistema. Dallo{" "}
                  <b>Stato Patrimoniale</b> (che contiene entrambi gli esercizi) vengono calcolati i{" "}
                  <b>Δ patrimoniali</b> del Metodo Indiretto: ΔCCNO (la «spugna»), ΔImmobilizzazioni nette
                  (proxy del CAPEX contabile), ΔPFN a breve, ΔPN, ΔFondi/TFR e ΔLiquidità (il <b>failsafe</b>{" "}
                  di quadratura). Dal <b>Conto Economico</b> arrivano EBITDA, EBIT, oneri finanziari e ricavi
                  che alimentano il ponte con il rendiconto e gli indici del tab 6. Tutti i calcoli sono
                  locali e deterministici. Puoi <b>caricare i JSON</b> esportati dagli altri moduli oppure{" "}
                  <b>inserire i dati a mano</b>: i due metodi alimentano gli stessi calcoli. Se carichi un JSON
                  e poi passi a «inserimento manuale», i campi arrivano già precompilati e pronti da ritoccare.
                </p>
              </div>

              {/* selettore modalità: file JSON vs inserimento manuale */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm mb-6 w-fit">
                {[["file", "📂 Da file JSON"], ["manuale", "✏️ Inserimento manuale"]].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setModoInputDati(id)}
                    className={`px-4 py-1.5 font-semibold ${modoInputDati === id ? "bg-white text-slate-900" : "bg-slate-50 text-slate-400"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* ---- MODALITÀ FILE ---- */}
              {modoInputDati === "file" && (
                <>
                  <div className="flex flex-wrap gap-2 mb-6">
                    <button
                      onClick={() => fileSP.current?.click()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700"
                    >
                      📂 Carica JSON SP
                    </button>
                    <button
                      onClick={() => fileCE.current?.click()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700"
                    >
                      📂 Carica JSON CE
                    </button>
                    {spFonte && <span className="text-xs text-teal-700 self-center">SP: {spFonte}</span>}
                    {ceFonte && <span className="text-xs text-teal-700 self-center">CE: {ceFonte}</span>}
                  </div>

                  {!spData && !ceData && (
                    <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                      Nessun JSON caricato. Esporta i dati dai moduli «Riclassificazione SP» e «Conto Economico
                      Riclassificato» (pulsante «💾 Salva dati») e caricali qui, oppure passa a «✏️ Inserimento
                      manuale».
                    </div>
                  )}
                </>
              )}

              {/* ---- MODALITÀ INSERIMENTO MANUALE ---- */}
              {modoInputDati === "manuale" && (
                <div className="space-y-6 mb-6">
                  {/* SP — aggregati per i due esercizi */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                        Stato Patrimoniale — aggregati per esercizio
                      </p>
                      <input
                        value={spManAnni.corr}
                        onChange={(e) => setSpManAnni((a) => ({ ...a, corr: e.target.value }))}
                        placeholder="Es. corrente (2025)"
                        className="ml-auto border border-slate-300 rounded-lg px-2 py-1 text-xs w-36"
                        aria-label="Esercizio corrente"
                      />
                      <input
                        value={spManAnni.prec}
                        onChange={(e) => setSpManAnni((a) => ({ ...a, prec: e.target.value }))}
                        placeholder="Es. precedente (2024)"
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-36"
                        aria-label="Esercizio precedente"
                      />
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/50">
                          <th className="px-5 py-2">Aggregato</th>
                          <th className="px-4 py-2 text-right">{spManAnni.corr || "Esercizio corrente"}</th>
                          <th className="px-4 py-2 text-right">{spManAnni.prec || "Esercizio precedente"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CAMPI_SP.map(([k, label]) => (
                          <tr key={k} className="border-t border-slate-100">
                            <td className="px-5 py-1.5 text-slate-700">{label}</td>
                            <td className="px-4 py-1.5 text-right">
                              <input
                                type="number"
                                value={spManCorr[k] ?? ""}
                                onChange={(e) => setSpManCorr((o) => ({ ...o, [k]: e.target.value }))}
                                placeholder="0"
                                className="w-32 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-sm"
                                aria-label={`${label} — esercizio corrente`}
                              />
                            </td>
                            <td className="px-4 py-1.5 text-right">
                              <input
                                type="number"
                                value={spManPrec[k] ?? ""}
                                onChange={(e) => setSpManPrec((o) => ({ ...o, [k]: e.target.value }))}
                                placeholder="0"
                                className="w-32 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-sm"
                                aria-label={`${label} — esercizio precedente`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-5 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 leading-relaxed">
                      Inserisci gli aggregati con lo stesso segno e la stessa unità del rendiconto. I Δ e il
                      check di quadratura qui sotto si aggiornano automaticamente. La PFN a breve, la
                      liquidità e i debiti finanziari servono anche agli indici del tab 6.
                    </div>
                  </div>

                  {/* CE — grandezze di sintesi */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                        Conto Economico — grandezze di sintesi
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {CAMPI_CE.map(([k, label], i) => (
                          <tr key={k} className={i ? "border-t border-slate-100" : ""}>
                            <td className="px-5 py-1.5 text-slate-700">{label}</td>
                            <td className="px-4 py-1.5 text-right">
                              <input
                                type="number"
                                value={ceMan[k] ?? ""}
                                onChange={(e) => setCeMan((o) => ({ ...o, [k]: e.target.value }))}
                                placeholder="0"
                                className="w-40 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-sm"
                                aria-label={label}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-5 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 leading-relaxed">
                      Gli oneri finanziari vanno inseriti come valore POSITIVO (il modulo li tratta come
                      costo). Bastano ricavi, EBITDA, EBIT e oneri finanziari per attivare tutti e tre gli
                      indici del tab 6; ammortamenti e utile netto sono facoltativi.
                    </div>
                  </div>
                </div>
              )}

              {/* ---- Card CE ---- */}
              {ceCalc && (
                <>
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-3">
                    Grandezze economiche dal CE riclassificato
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {[
                      ["EBITDA", ceCalc.ebitda, "Autofinanziamento lordo: il «rubinetto» del flusso operativo potenziale"],
                      ["EBIT", ceCalc.ebit, "Reddito operativo dopo ammortamenti e accantonamenti"],
                      ["Oneri finanziari (competenza)", -ceCalc.oneriFin, "Costo del debito a conto economico — confrontalo con gli interessi PAGATI del RF"],
                      ["Ricavi delle vendite", ceCalc.ricavi, "Base delle incidenze % del prospetto (tab 5) e del Cash Flow Margin (tab 6)"],
                    ].map(([nome, val, desc]) => (
                      <div key={nome} className="border border-slate-200 rounded-xl p-5">
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">{nome}</p>
                        <p className={`text-2xl font-extrabold font-mono mb-2 ${val < 0 ? "text-rose-700" : "text-slate-900"}`}>{fmtC(val)}</p>
                        <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ---- Card Δ patrimoniali SP ---- */}
              {spDelta && (
                <>
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-3">
                    Δ patrimoniali dallo SP ({spDelta.esercizioCorr || "corrente"} − {spDelta.esercizioPrec || "precedente"})
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                    {[
                      ["Δ CCNO", spDelta.deltaCcno, "La «spugna»: se cresce assorbe cassa dal flusso operativo, se cala la libera"],
                      ["Δ Immobilizzazioni operative nette", spDelta.deltaImmob, "Proxy contabile del CAPEX netto: variazione al netto di ammortamenti e dismissioni"],
                      ["Δ PFN a breve termine", spDelta.deltaPfnBreve, "Variazione dell'esposizione finanziaria netta entro 12 mesi: il saldo finale della cascata"],
                      ["Δ Patrimonio netto", spDelta.deltaPn, "Utile trattenuto + aumenti − dividendi/riserve distribuite: la dinamica dell'equity"],
                      ["Δ Liquidità", spDelta.deltaLiquidita, "Il failsafe assoluto: la somma di TUTTI i flussi del rendiconto deve coincidere con questo valore"],
                      ["Δ Fondi e TFR (pass. op. strutturali)", spDelta.deltaFondi, "Accantonamenti non monetari al netto degli utilizzi: auto-assicurazione che trattiene o rilascia cassa"],
                    ].map(([nome, val, desc]) => (
                      <div key={nome} className="border border-slate-200 rounded-xl p-5">
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">{nome}</p>
                        <p className={`text-2xl font-extrabold font-mono mb-2 ${val < 0 ? "text-rose-700" : "text-slate-900"}`}>{fmtC(val)}</p>
                        <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ---- Check quadratura RF ↔ ΔLiquidità ---- */}
              {spDelta && voci.length > 0 && checkQuadratura && (
                <div className={`border rounded-xl p-5 mb-6 ${checkQuadratura.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                  <p className={`font-bold text-sm mb-2 ${checkQuadratura.ok ? "text-emerald-800" : "text-rose-800"}`}>
                    {checkQuadratura.ok ? "✓ Check quadratura superato" : "✗ Check quadratura NON superato"}
                  </p>
                  <div className="grid sm:grid-cols-3 gap-4 mb-2">
                    {[
                      ["Σ flussi del Rendiconto (post rettifiche NI)", checkQuadratura.flussiRF],
                      ["Δ Liquidità dallo Stato Patrimoniale", checkQuadratura.deltaLiq],
                      ["Scarto", checkQuadratura.scarto],
                    ].map(([lbl, val]) => (
                      <div key={lbl}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{lbl}</p>
                        <p className={`text-xl font-extrabold font-mono ${val < 0 ? "text-rose-700" : "text-slate-900"}`}>{fmtC(val)}</p>
                      </div>
                    ))}
                  </div>
                  <p className={`text-xs leading-relaxed ${checkQuadratura.ok ? "text-emerald-800" : "text-rose-800"}`}>
                    {checkQuadratura.ok
                      ? "La somma dei flussi del rendiconto coincide con la variazione delle disponibilità liquide dello SP (tolleranza di arrotondamento: 1 unità): «la cassa è un fatto» e i due moduli raccontano la stessa storia."
                      : `Scarto di ${fmt(Math.abs(checkQuadratura.scarto))} in valore assoluto (${pct(Math.abs(checkQuadratura.scarto), Math.abs(checkQuadratura.deltaLiq) || Math.abs(checkQuadratura.flussiRF))} della ΔLiquidità). Cause tipiche: voci del rendiconto mancanti o con segno errato (tab 1), rettifiche NI da rivedere (tab 2), unità di misura diverse tra i moduli, oppure esercizi non allineati tra RF e SP.`}
                  </p>
                </div>
              )}
              {spDelta && !voci.length && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 text-sm text-amber-800">
                  Δ patrimoniali pronti: estrai o carica le voci del rendiconto (sezione 1) per attivare il
                  check di quadratura.
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 5 · RICLASSIFICAZIONE RF ================= */}
          {tab === 5 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">🌊 La cascata dei flussi per aree gestionali</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Il prospetto aggrega le voci validate (incluse le rettifiche NI attive) per classe e le
                  dispone nella sequenza logica del modello: dal <b>flusso operativo corrente</b> (che include
                  la gestione finanziaria attiva, centralizzata qui per evitare duplicazioni) si sottrae il{" "}
                  <b>CAPEX netto</b> per ottenere il <b>FCFO</b>; il servizio del debito porta al <b>FCFE</b>;
                  i flussi con i soci e la raccolta di nuovo debito chiudono sulla{" "}
                  <b>variazione della PFN a breve termine</b>. Tutte le somme sono algebriche (entrate +,
                  uscite −), quindi «CAPEX = entrate − uscite» coincide con la somma delle voci.
                </p>
              </div>

              <Prospetto
                titolo={`Rendiconto finanziario riclassificato${azienda ? ` — ${azienda}` : ""}${esercizio ? ` · ${esercizio}` : ""}${schemaRF?.unita ? ` · importi in ${schemaRF.unita}` : ""}`}
                base={ceCalc?.ricavi || null}
                vuoto="Nessuna voce disponibile: estrai o carica il rendiconto nel tab «1 · Dati & Validazione»."
                righe={voci.length ? [
                  { tipo: "sub",     label: "Flusso della gestione operativa corrente", val: rf.flussoGestioneCorrente },
                  { tipo: "sub",     label: "Flusso operativo — TFR e Fondi (auto-assicurazione)", val: rf.flussoFondi },
                  { tipo: "sub",     label: "Gestione finanziaria attiva (interessi e dividendi incassati)", val: rf.finanzaAttiva },
                  { tipo: "margine", label: "Flusso operativo corrente", val: rf.flussoOperativoCorrente },
                  { tipo: "sub",     label: "CAPEX — disinvestimenti (entrate)", val: rf.capexEntrate },
                  { tipo: "sub",     label: "CAPEX — investimenti (uscite)", val: rf.capexUscite },
                  { tipo: "sub",     label: "CAPEX netto", val: rf.capex },
                  { tipo: "margine", label: "FCFO — Free Cash Flow from Operations", val: rf.fcfo },
                  { tipo: "nota",    label: "FCFD = FCFO: la gestione finanziaria attiva è già centralizzata nell'area operativa, quindi il flusso disponibile per il servizio del debito coincide con il FCFO senza duplicazioni." },
                  { tipo: "sub",     label: "Servizio del debito (interessi pagati e rimborsi di quote capitale)", val: rf.servizioDelDebito },
                  { tipo: "margine", label: "FCFE — Flusso al servizio dei soci", val: rf.fcfe },
                  { tipo: "sub",     label: "Componenti anomali / discontinue (non ricorrenti)", val: rf.componentiAnomali },
                  { tipo: "nota",    label: "I componenti anomali sono isolati su una riga dedicata dopo il FCFE: impattano la cassa e quindi il saldo finale, ma non inquinano i margini ordinari (FCFO, FCFE), che restano espressivi della gestione ricorrente." },
                  { tipo: "sub",     label: "Dividendi e rimborsi ai soci", val: rf.equityDividendi },
                  { tipo: "sub",     label: "Acquisto azioni proprie (Buyback)", val: rf.equityBuyback },
                  { tipo: "sub",     label: "Aumenti di capitale versati", val: rf.equityAumenti },
                  { tipo: "sub",     label: "Raccolta di nuovo debito (coperture)", val: rf.raccolta },
                  { tipo: "margine", label: "Variazione della PFN a breve termine", val: rf.variazionePfnBt },
                  { tipo: "nota",    label: "Lettura del saldo: le coperture (nuovo debito m/l, aumenti di capitale) entrano nella cascata con il proprio segno di cassa, così che il saldo si concili con la variazione effettiva delle disponibilità liquide dell'esercizio." },
                  { tipo: "sub",     label: "Effetto cambi sulle disponibilità liquide", val: rf.effettoCambi },
                  { tipo: "margine", label: "Variazione netta delle disponibilità liquide", val: rf.variazioneLiquiditaTotale },
                  { tipo: "nota",    label: "L'effetto cambi è una posta di riconciliazione (non un flusso gestionale): sommato alla variazione della PFN a breve riconduce alla variazione netta delle disponibilità liquide dell'esercizio, che deve coincidere con la ΔLiquidità dello Stato Patrimoniale (tab 4)." },
                ] : []}
              />

              {voci.length > 0 && rf.daClassificare > 0 && (
                <p className="text-amber-600 text-sm mt-4">
                  ⚠ {rf.daClassificare} voce/i «da classificare» escluse dalla cascata: assegnale nel tab 1
                  per un prospetto completo.
                </p>
              )}
              {voci.length > 0 && !ceCalc && (
                <p className="text-slate-500 text-xs mt-4">
                  Suggerimento: carica il JSON del CE nel tab 4 per vedere le incidenze % sui ricavi accanto a
                  ogni riga.
                </p>
              )}
            </div>
          )}

          {/* ================= TAB 6 · MARGINI E INDICI — 4 FATTORI ================= */}
          {tab === 6 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">📐 Analisi della solidità finanziaria — «l'utile è un'opinione, la cassa è un fatto»</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  La valutazione è organizzata sui <b>4 pilastri</b> della solidità finanziaria letti dal
                  rendiconto: <b>1) il motore operativo</b> (quanta cassa vera nasce dall'EBITDA, al netto
                  dell'effetto «spugna» del circolante), <b>2) la sostenibilità degli investimenti</b> (se
                  l'azienda autofinanzia i CAPEX o brucia cassa per crescere), <b>3) la solvibilità e il
                  servizio del debito</b> (capacità di onorare interessi e quote capitale dopo gli
                  investimenti) e <b>4) la natura della copertura e la PFN a breve</b> (come viene coperto il
                  fabbisogno complessivo). Ogni fattore è un menu a tendina con dentro i singoli indicatori,
                  a loro volta espandibili: al click vedi <b>formula e calcolo</b>, <b>spiegazione teorica</b>{" "}
                  e <b>valutazione a semaforo</b> (verde/giallo/rosso) sui dati dell'azienda caricata. Se un
                  dato manca (JSON SP o CE non caricati nel tab 4), l'indice resta «n.d.» segnalando cosa serve.
                </p>
              </div>

              {!voci.length ? (
                <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
                  Nessun dato: estrai o carica le voci del rendiconto nel tab «1 · Dati & Validazione».
                </div>
              ) : (
                <div className="space-y-4">
                  {/* input aliquota fiscale (scudo fiscale · FCFO Unlevered) */}
                  <div className="flex flex-wrap items-center gap-3 border border-slate-200 rounded-xl px-5 py-3">
                    <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">Aliquota fiscale</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={aliquotaFiscale}
                        onChange={(e) => setAliquotaFiscale(e.target.value === "" ? 0 : Number(e.target.value))}
                        min="0"
                        max="100"
                        step="0.5"
                        className="border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-sm w-20"
                        aria-label="Aliquota fiscale in percentuale"
                      />
                      <span className="text-slate-500 text-sm">%</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      usata per lo scudo fiscale del debito nel calcolo dell'FCFO Unlevered (default IRES 24%).
                    </span>
                  </div>

                  {/* ============ FATTORE 1 · IL MOTORE OPERATIVO ============ */}
                  <FattoreEspandibile
                    numero="1"
                    titolo="Il motore operativo"
                    sintesi="Cassa vera dall'EBITDA, al netto dell'effetto «spugna» del circolante"
                    giudizio={indicatori.f1Giud}
                    apertoDefault
                    descrizione="Il primo pilastro verifica se la redditività economica (EBITDA) si trasforma davvero in cassa. Il capitale circolante netto operativo (CCNO) agisce come una spugna: quando cresce (più crediti e magazzino, meno debiti verso fornitori) trattiene la cassa che il conto economico aveva già registrato come utile."
                  >
                    <IndicatoreEspandibile
                      nome="Cash conversion (Flusso op. corrente / EBITDA)"
                      valore={indicatori.cashConv != null ? pct(indicatori.cashConv, 1) : "n.d."}
                      sub={ceCalc ? `Flusso op. corrente ${fmt(rf.flussoOperativoCorrente)} / EBITDA ${fmt(ceCalc.ebitda)}` : "carica il JSON CE (tab 4)"}
                      evidenzia={indicatori.cashConvGiud}
                      dettaglio={{
                        formula: ceCalc && ceCalc.ebitda > 0
                          ? `Flusso operativo corrente / EBITDA = ${fmt(rf.flussoOperativoCorrente)} / ${fmt(ceCalc.ebitda)} = ${pct(indicatori.cashConv, 1)}`
                          : "Non calcolabile: serve l'EBITDA dal JSON del Conto Economico (tab 4).",
                        perche: "È il tasso di conversione della redditività in cassa: misura quanta parte dell'EBITDA (autofinanziamento potenziale) sopravvive al passaggio attraverso imposte pagate, oneri finanziari, variazioni di TFR/fondi e soprattutto attraverso la spugna del circolante, diventando flusso operativo corrente effettivo.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 70% (l'EBITDA si traduce quasi integralmente in cassa); GIALLO tra 40% e 70% (una quota rilevante resta intrappolata nel circolante o assorbita dagli oneri); ROSSO se < 40% (la redditività economica non diventa cassa: attenzione a crediti, magazzino e sostenibilità).",
                        valutazione: !ceCalc
                          ? "n.d. — carica il JSON del CE nel tab 4 per attivare l'indice."
                          : indicatori.cashConvGiud === "ok"
                          ? `Conversione elevata: l'EBITDA di ${fmt(ceCalc.ebitda)} genera ${fmt(rf.flussoOperativoCorrente)} di flusso operativo corrente. Il motore trasforma efficacemente utile in cassa.`
                          : indicatori.cashConvGiud === "warn"
                          ? "Conversione parziale: una quota significativa dell'EBITDA non arriva in cassa. Verifica sotto l'effetto spugna del CCNO e nel tab 4 la dinamica di crediti/magazzino."
                          : "Conversione debole: l'EBITDA resta in larga parte «sulla carta». È il segnale classico di crescita che assorbe circolante o di crediti che non si incassano.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Effetto «spugna» del CCNO (ΔCCNO)"
                      valore={indicatori.spugna != null ? fmt(indicatori.spugna) : "n.d."}
                      sub={indicatori.spugna != null ? (indicatori.spugna > 0 ? "assorbe cassa" : indicatori.spugna < 0 ? "libera cassa" : "neutro") + (indicatori.spugnaSuEbitda != null ? ` · ${pct(Math.abs(indicatori.spugnaSuEbitda), 1)} dell'EBITDA` : "") : "carica il JSON SP (tab 4)"}
                      evidenzia={indicatori.spugnaGiud}
                      dettaglio={{
                        formula: spDelta
                          ? `ΔCCNO (SP: corrente − precedente) = ${fmt(indicatori.spugna)}${indicatori.spugnaSuEbitda != null ? ` · su EBITDA = ${pct(indicatori.spugnaSuEbitda, 1)}` : ""}. Convenzione: ΔCCNO > 0 ASSORBE cassa, ΔCCNO < 0 la LIBERA.`
                          : "Non calcolabile: serve il CCNO dei due esercizi dal JSON dello Stato Patrimoniale (tab 4).",
                        perche: "Il circolante è la «spugna» tra reddito e cassa. Un CCNO in crescita significa che l'azienda ha finanziato clienti e magazzino: l'utile è stato prodotto ma la cassa corrispondente è ancora immobilizzata. È qui che molte aziende in forte crescita entrano in tensione pur essendo redditizie.",
                        cosaIndica: "Soglie di riferimento (quota di EBITDA assorbita): VERDE se ΔCCNO ≤ 0 (il circolante libera cassa); GIALLO se assorbe fino al 30% dell'EBITDA (fisiologico in crescita); ROSSO se assorbe oltre il 30% (la spugna sta drenando gran parte dell'autofinanziamento).",
                        valutazione: !spDelta
                          ? "n.d. — carica il JSON dello SP nel tab 4 per attivare l'indice."
                          : indicatori.spugnaGiud === "ok"
                          ? `Il circolante ha ${indicatori.spugna < 0 ? "liberato" : "lasciato invariata la"} cassa (${fmt(indicatori.spugna)}): la gestione del capitale circolante sostiene il flusso operativo invece di eroderlo.`
                          : indicatori.spugnaGiud === "warn"
                          ? `Il circolante ha assorbito ${fmt(indicatori.spugna)}${indicatori.spugnaSuEbitda != null ? ` (${pct(indicatori.spugnaSuEbitda, 1)} dell'EBITDA)` : ""}: assorbimento fisiologico, ma da tenere sotto controllo se la crescita continua.`
                          : `Il circolante ha assorbito ${fmt(indicatori.spugna)}${indicatori.spugnaSuEbitda != null ? ` (${pct(indicatori.spugnaSuEbitda, 1)} dell'EBITDA)` : ""}: la spugna sta drenando gran parte dell'autofinanziamento — priorità alla gestione di crediti e scorte.`,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Cash Flow Margin (FCFO / Ricavi)"
                      valore={indicatori.cfMargin != null ? pct(indicatori.cfMargin, 1) : "n.d."}
                      sub={ceCalc ? `FCFO ${fmt(rf.fcfo)} / Ricavi ${fmt(ceCalc.ricavi)}` : "carica il JSON CE (tab 4)"}
                      evidenzia={indicatori.cfMarginGiud}
                      dettaglio={{
                        formula: ceCalc && ceCalc.ricavi > 0
                          ? `FCFO / Ricavi delle vendite (dal CE) = ${fmt(rf.fcfo)} / ${fmt(ceCalc.ricavi)} = ${pct(indicatori.cfMargin, 1)}`
                          : "Non calcolabile: servono i ricavi dal JSON del Conto Economico (tab 4).",
                        perche: "Traduce ogni euro di fatturato in centesimi di cassa libera dopo circolante e investimenti. Confrontato con l'EBITDA margin, rivela quanta marginalità economica si perde per strada tra la «spugna» del CCNO e il CAPEX.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 10% (conversione eccellente del fatturato in cassa libera); GIALLO tra 5% e 10% (conversione discreta, tipica di business con circolante o CAPEX fisiologici); ROSSO se < 5% (il fatturato genera poca o nessuna cassa: crescita che brucia liquidità o investimenti che divorano il flusso corrente).",
                        valutazione: !ceCalc
                          ? "n.d. — carica il JSON del CE nel tab 4 per attivare l'indice."
                          : indicatori.cfMarginGiud === "ok"
                          ? `Ogni 100 di fatturato restano ${(indicatori.cfMargin * 100).toFixed(1).replace(".", ",")} di cassa libera dopo circolante e CAPEX: modello di business fortemente cash-generative.`
                          : indicatori.cfMarginGiud === "warn"
                          ? "Conversione in cassa discreta: verifica nel tab 4 se l'assorbimento arriva dal ΔCCNO (politiche commerciali) o dal CAPEX (ciclo di investimenti)."
                          : `${rf.fcfo <= 0 ? "FCFO negativo: l'azienda brucia cassa nonostante il fatturato — il classico rischio di crack finanziario se la crescita del CCNO supera la generazione di EBITDA" : "Conversione in cassa debole: gran parte della marginalità economica è trattenuta da circolante e investimenti"}.`,
                      }}
                    />
                  </FattoreEspandibile>

                  {/* ============ FATTORE 2 · SOSTENIBILITÀ DEGLI INVESTIMENTI ============ */}
                  <FattoreEspandibile
                    numero="2"
                    titolo="La sostenibilità degli investimenti"
                    sintesi="L'azienda autofinanzia i CAPEX o brucia cassa per crescere?"
                    giudizio={indicatori.f2Giud}
                    descrizione="Il secondo pilastro verifica se il flusso operativo corrente basta a coprire gli investimenti strutturali (CAPEX). Un'azienda sana finanzia la propria crescita con la cassa che genera; se deve ricorrere sistematicamente a debito o aumenti di capitale per gli investimenti ordinari, la crescita sta bruciando valore anziché crearlo."
                  >
                    <IndicatoreEspandibile
                      nome="Copertura degli investimenti (Flusso op. corrente / |CAPEX|)"
                      valore={indicatori.coperturaInvest != null ? indicatori.coperturaInvest.toFixed(2).replace(".", ",") + "×" : Math.abs(rf.capexUscite) < 1e-9 ? "n/a" : "n.d."}
                      sub={`Flusso op. corrente ${fmt(rf.flussoOperativoCorrente)} / |CAPEX uscite| ${fmt(Math.abs(rf.capexUscite))}`}
                      evidenzia={indicatori.coperturaInvestGiud}
                      dettaglio={{
                        formula: Math.abs(rf.capexUscite) < 1e-9
                          ? "Nessun investimento (CAPEX in uscita) rilevato nell'esercizio: indice non applicabile."
                          : `Flusso operativo corrente / |CAPEX uscite| = ${fmt(rf.flussoOperativoCorrente)} / ${fmt(Math.abs(rf.capexUscite))} = ${indicatori.coperturaInvest.toFixed(2).replace(".", ",")}×`,
                        perche: "Misura quante volte la cassa operativa copre gli investimenti dell'esercizio. È il discrimine tra crescita autofinanziata e crescita «a debito»: sopra 1× l'azienda paga i CAPEX con la propria cassa e ne avanza per debito e soci; sotto 1× ogni euro investito richiede finanziamento esterno.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 1× (i CAPEX sono interamente autofinanziati); GIALLO tra 0,6× e 1× (autofinanziamento parziale, il resto va coperto); ROSSO se < 0,6× (la gran parte degli investimenti dipende da finanziamento esterno).",
                        valutazione: Math.abs(rf.capexUscite) < 1e-9
                          ? "Nessun CAPEX nell'esercizio: l'azienda non ha investito in immobilizzazioni, quindi non c'è fabbisogno di copertura da valutare qui."
                          : indicatori.coperturaInvestGiud === "ok"
                          ? `Investimenti autofinanziati: la cassa operativa (${fmt(rf.flussoOperativoCorrente)}) copre ${indicatori.coperturaInvest.toFixed(2).replace(".", ",")}× i CAPEX. La crescita non erode la struttura finanziaria.`
                          : indicatori.coperturaInvestGiud === "warn"
                          ? "Autofinanziamento parziale: la cassa operativa copre solo una parte dei CAPEX; il resto è stato finanziato con debito o soci. Sostenibile se temporaneo, da monitorare se strutturale."
                          : "Investimenti a debito: la cassa operativa copre una frazione minima dei CAPEX. La crescita sta bruciando cassa e dipende dal finanziamento esterno — verifica che generi ritorni adeguati.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="FCFO — autofinanziamento dopo i CAPEX"
                      valore={fmt(rf.fcfo)}
                      sub={`Flusso op. corrente ${fmt(rf.flussoOperativoCorrente)} + CAPEX netto ${fmt(rf.capex)}`}
                      evidenzia={indicatori.fcfoGiud}
                      dettaglio={{
                        formula: `FCFO = Flusso operativo corrente + CAPEX netto = ${fmt(rf.flussoOperativoCorrente)} + (${fmt(rf.capex)}) = ${fmt(rf.fcfo)}`,
                        perche: "Il Free Cash Flow from Operations è la cassa che resta dopo aver pagato gli investimenti strutturali: è la vera cassa «libera» prodotta dalla gestione operativa, quella disponibile per servire il debito e remunerare i soci. È il numero più importante dell'intero rendiconto.",
                        cosaIndica: "Soglie di riferimento: VERDE se positivo (la gestione operativa autofinanzia gli investimenti e genera surplus); GIALLO se nullo (equilibrio esatto, nessun margine); ROSSO se negativo (dopo i CAPEX la gestione operativa brucia cassa).",
                        valutazione: indicatori.fcfoGiud === "ok"
                          ? `FCFO positivo di ${fmt(rf.fcfo)}: dopo aver pagato gli investimenti resta cassa libera per il debito e i soci. È la condizione di un'azienda finanziariamente autonoma.`
                          : indicatori.fcfoGiud === "warn"
                          ? "FCFO nullo: la cassa operativa copre esattamente gli investimenti, senza margine per debito e soci. Equilibrio da rafforzare."
                          : "FCFO negativo: dopo i CAPEX la gestione brucia cassa. Il fabbisogno va coperto con debito o capitale — sostenibile solo se gli investimenti sono di espansione e temporanei.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="FCFO Unlevered (Asset Side)"
                      valore={indicatori.fcfoUnlevered != null ? fmt(indicatori.fcfoUnlevered) : "n.d."}
                      sub={`FCFO ${fmt(rf.fcfo)} + scudo fiscale ${fmt(indicatori.taxShield)} (${(Number(aliquotaFiscale) || 0).toString().replace(".", ",")}%)`}
                      evidenzia={indicatori.fcfoUnlevGiud}
                      dettaglio={{
                        formula: `FCFO + (|Oneri finanziari pagati| × aliquota) = ${fmt(rf.fcfo)} + (${fmt(Math.abs(indicatori.oneriPagati))} × ${(Number(aliquotaFiscale) || 0).toString().replace(".", ",")}%) = ${fmt(rf.fcfo)} + ${fmt(indicatori.taxShield)} = ${fmt(indicatori.fcfoUnlevered)}`,
                        perche: "Le imposte a Conto Economico sono abbattute dagli interessi passivi, che sono fiscalmente deducibili: l'azienda indebitata paga meno tasse di un'identica azienda senza debito. Per valutare la gestione operativa prescindendo dalla struttura finanziaria (ottica asset-side, come nel DCF unlevered), occorre neutralizzare questo effetto: si somma al FCFO il risparmio d'imposta generato dal debito, cioè il tax shield = |oneri finanziari pagati| × aliquota. Il risultato è il flusso operativo «come se» l'azienda fosse interamente equity-financed.",
                        cosaIndica: "Isola la capacità dell'attivo di generare cassa, confrontabile tra aziende con leve finanziarie diverse. Il tax shield qui aggiunto misura quanto la deducibilità degli interessi ha alleggerito il carico fiscale. Soglie di riferimento: VERDE se ampiamente positivo (l'attivo genera cassa a prescindere dal finanziamento); GIALLO se nullo; ROSSO se negativo (nemmeno al lordo dell'effetto leva la gestione operativa produce cassa).",
                        valutazione: indicatori.fcfoUnlevGiud === "ok"
                          ? `FCFO Unlevered di ${fmt(indicatori.fcfoUnlevered)}, ampiamente positivo: l'attivo aziendale genera cassa operativa solida indipendentemente dalla struttura finanziaria. Lo scudo fiscale del debito vale ${fmt(indicatori.taxShield)} (${aliquotaFiscale}% degli oneri pagati).`
                          : indicatori.fcfoUnlevGiud === "warn"
                          ? "FCFO Unlevered nullo: la gestione operativa, anche neutralizzando l'effetto leva, non produce cassa netta — situazione di equilibrio precario da monitorare."
                          : "FCFO Unlevered negativo: nemmeno al lordo del beneficio fiscale del debito l'attivo genera cassa operativa. È un segnale asset-side critico, indipendente dalle scelte di finanziamento.",
                      }}
                    />
                  </FattoreEspandibile>

                  {/* ============ FATTORE 3 · SOLVIBILITÀ E SERVIZIO DEL DEBITO ============ */}
                  <FattoreEspandibile
                    numero="3"
                    titolo="La solvibilità e il servizio del debito"
                    sintesi="Capacità di onorare interessi e quote capitale dopo gli investimenti"
                    giudizio={indicatori.f3Giud}
                    descrizione="Il terzo pilastro verifica se, dopo aver autofinanziato gli investimenti, resta cassa sufficiente per servire il debito (interessi + quote capitale). È il cuore della solvibilità: qui si misura se l'azienda regge il proprio debito con la cassa generata o se dipende dal rifinanziamento continuo."
                  >
                    <IndicatoreEspandibile
                      nome="DSCR per cassa (FCFO / |servizio del debito|)"
                      valore={indicatori.dscr != null ? indicatori.dscr.toFixed(2).replace(".", ",") + "×" : Math.abs(rf.servizioDelDebito) < 1e-9 ? "n/a" : "n.d."}
                      sub={`FCFO ${fmt(rf.fcfo)} / |servizio debito| ${fmt(Math.abs(rf.servizioDelDebito))}`}
                      evidenzia={indicatori.dscrGiud}
                      dettaglio={{
                        formula: Math.abs(rf.servizioDelDebito) < 1e-9
                          ? "Nessun servizio del debito (interessi + quote capitale) rilevato nell'esercizio: indice non applicabile."
                          : `FCFO / |Servizio del debito| = ${fmt(rf.fcfo)} / ${fmt(Math.abs(rf.servizioDelDebito))} = ${indicatori.dscr.toFixed(2).replace(".", ",")}×`,
                        perche: "È il Debt Service Coverage Ratio in ottica di cassa: confronta la cassa disponibile dopo gli investimenti (FCFO) con l'intero servizio del debito dell'esercizio (interessi pagati + rimborsi di quote capitale). È l'indicatore che banche e finanziatori guardano per primo: sotto 1× l'azienda non genera abbastanza cassa per onorare il debito e deve attingere a riserve o nuova finanza.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 1,2× (margine di sicurezza sul servizio del debito); GIALLO tra 1× e 1,2× (copertura giusta ma senza cuscinetto); ROSSO se < 1× (la cassa dopo gli investimenti non basta a servire il debito).",
                        valutazione: Math.abs(rf.servizioDelDebito) < 1e-9
                          ? "Nessun servizio del debito nell'esercizio: nessun rimborso o interesse in uscita rilevato tra i flussi finanziari."
                          : indicatori.dscrGiud === "ok"
                          ? `Servizio del debito ampiamente coperto: l'FCFO (${fmt(rf.fcfo)}) copre ${indicatori.dscr.toFixed(2).replace(".", ",")}× interessi e quote capitale, con un cuscinetto di sicurezza.`
                          : indicatori.dscrGiud === "warn"
                          ? "Copertura giusta ma senza margine: l'FCFO basta appena a servire il debito. Un calo dell'EBITDA o un assorbimento di circolante metterebbe l'azienda sotto 1×."
                          : "Copertura insufficiente: dopo gli investimenti la cassa non basta a servire il debito. L'azienda dipende dal rifinanziamento o dall'erosione di riserve — situazione di solvibilità critica.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Tasso di copertura degli oneri finanziari per cassa"
                      valore={indicatori.copertura != null ? indicatori.copertura.toFixed(1).replace(".", ",") + "×" : Math.abs(indicatori.oneriPagati) < 1e-9 ? "∞" : "n.d."}
                      sub={`Flusso op. corrente ${fmt(rf.flussoOperativoCorrente)} / |oneri pagati| ${fmt(Math.abs(indicatori.oneriPagati))}`}
                      evidenzia={indicatori.coperturaGiud}
                      dettaglio={{
                        formula: Math.abs(indicatori.oneriPagati) < 1e-9
                          ? "Nessun onere finanziario pagato rilevato nel rendiconto: copertura integrale per costruzione."
                          : `Flusso operativo corrente / |Oneri finanziari pagati| = ${fmt(rf.flussoOperativoCorrente)} / ${fmt(Math.abs(indicatori.oneriPagati))} = ${indicatori.copertura.toFixed(1).replace(".", ",")}×${indicatori.oneriDaInteressi ? " (oneri pagati = voci di servizio del debito con «interessi» nel nome)" : " (il rendiconto non distingue gli interessi: usato prudenzialmente l'intero servizio del debito, quote capitale incluse)"}`,
                        perche: "È l'interest coverage «per cassa»: a differenza del rapporto EBIT/oneri di competenza del CE, confronta la cassa realmente generata dal ciclo operativo con gli interessi realmente usciti. Gli interessi si pagano con la cassa, non con l'utile.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 5× (il flusso corrente copre ampiamente il costo del debito); GIALLO tra 2× e 5× (copertura adeguata ma fragile a shock di circolante); ROSSO se < 2× (gran parte della cassa operativa è assorbita dal costo del debito: tensione di tesoreria).",
                        valutazione: Math.abs(indicatori.oneriPagati) < 1e-9
                          ? "Nessuna uscita per oneri finanziari nel rendiconto: il flusso operativo è interamente disponibile per investimenti e soci."
                          : indicatori.coperturaGiud === "ok"
                          ? "Copertura confortevole: il ciclo operativo genera cassa più che sufficiente per il costo del debito, lasciando spazio a CAPEX e remunerazione dei soci."
                          : indicatori.coperturaGiud === "warn"
                          ? "Copertura adeguata ma da monitorare: un'espansione del CCNO o un calo dell'EBITDA comprimerebbe rapidamente il margine di sicurezza."
                          : "Copertura fragile: la cassa operativa basta a malapena (o non basta) per gli oneri pagati — segnale di pressione sulla tesoreria e dipendenza dal rinnovo delle linee.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="FCFE — flusso al servizio dei soci"
                      valore={fmt(rf.fcfe)}
                      sub={`FCFO ${fmt(rf.fcfo)} + servizio del debito ${fmt(rf.servizioDelDebito)}`}
                      evidenzia={indicatori.fcfeGiud}
                      dettaglio={{
                        formula: `FCFE = FCFO + Servizio del debito = ${fmt(rf.fcfo)} + (${fmt(rf.servizioDelDebito)}) = ${fmt(rf.fcfe)}`,
                        perche: "Il Free Cash Flow to Equity è la cassa che resta ai soci dopo che il debito è stato servito: è la base per dividendi e riserve. Un FCFE positivo significa che l'azienda, pagati investimenti e debito, produce ancora cassa per chi ha investito il capitale di rischio.",
                        cosaIndica: "Soglie di riferimento: VERDE se positivo (resta cassa per i soci dopo investimenti e debito); GIALLO se nullo (nulla per i soci, ma il debito è servito); ROSSO se negativo (dopo il servizio del debito manca cassa: eventuali dividendi erodono riserve o richiedono nuova finanza).",
                        valutazione: indicatori.fcfeGiud === "ok"
                          ? `FCFE positivo di ${fmt(rf.fcfe)}: dopo investimenti e servizio del debito resta cassa per remunerare i soci. È il segno di un'azienda che crea valore per l'azionista in modo sostenibile.`
                          : indicatori.fcfeGiud === "warn"
                          ? "FCFE nullo: il debito è servito ma non resta cassa per i soci. Eventuali dividendi andrebbero a intaccare le riserve."
                          : "FCFE negativo: dopo il servizio del debito la cassa è già in rosso. Distribuire dividendi in questa situazione significa erodere il patrimonio o ricorrere a nuova finanza.",
                      }}
                    />
                  </FattoreEspandibile>

                  {/* ============ FATTORE 4 · NATURA DELLA COPERTURA E PFNbt ============ */}
                  <FattoreEspandibile
                    numero="4"
                    titolo="La natura della copertura e la PFN a breve"
                    sintesi="Come viene coperto il fabbisogno: surplus, riserve o tensioni a breve?"
                    giudizio={indicatori.f4Giud}
                    descrizione="Il quarto pilastro chiude il cerchio: guarda come è stato coperto l'eventuale fabbisogno finanziario complessivo dell'esercizio. Non conta solo quanta cassa manca, ma come la si è trovata — un surplus strutturale, l'erosione di riserve, il ricorso ai soci o l'accensione di nuovo debito a breve — perché la qualità della copertura determina la sostenibilità futura."
                  >
                    <IndicatoreEspandibile
                      nome="Variazione della PFN a breve termine"
                      valore={fmt(rf.variazionePfnBt)}
                      sub={rf.variazionePfnBt > 0 ? "miglioramento (riduce il fabbisogno)" : rf.variazionePfnBt < 0 ? "peggioramento (nuove tensioni)" : "invariata"}
                      evidenzia={indicatori.pfnGiud}
                      dettaglio={{
                        formula: `Variazione PFN a breve = FCFE + Componenti anomali + Flussi con i soci + Raccolta di nuovo debito = ${fmt(rf.fcfe)} + (${fmt(rf.componentiAnomali)}) + (${fmt(rf.flussiConSoci)}) + (${fmt(rf.raccolta)}) = ${fmt(rf.variazionePfnBt)}`,
                        perche: "È il saldo finale della cascata prima dell'effetto cambi: sintetizza se, dopo aver servito debito e soci e considerato le coperture, la posizione finanziaria netta a breve dell'azienda è migliorata o peggiorata. È la fotografia della tensione (o del respiro) di tesoreria dell'esercizio.",
                        cosaIndica: "Soglie di riferimento: VERDE se > 0 (l'esercizio ha ridotto il fabbisogno finanziario a breve, generando respiro di tesoreria); GIALLO se nullo (posizione stabile); ROSSO se < 0 (l'esercizio ha accresciuto le tensioni finanziarie a breve).",
                        valutazione: indicatori.pfnGiud === "ok"
                          ? `La posizione finanziaria a breve è migliorata di ${fmt(rf.variazionePfnBt)}: l'azienda ha generato respiro di tesoreria, riducendo la dipendenza dalle linee a breve.`
                          : indicatori.pfnGiud === "warn"
                          ? "La posizione finanziaria a breve è rimasta sostanzialmente stabile: nessun miglioramento ma nemmeno nuove tensioni."
                          : `La posizione finanziaria a breve è peggiorata di ${fmt(Math.abs(rf.variazionePfnBt))}: l'esercizio ha accresciuto le tensioni di tesoreria — verifica sotto la natura della copertura.`,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Natura della copertura del fabbisogno"
                      valore={indicatori.naturaCopTxt}
                      sub="qualità della fonte che ha coperto il fabbisogno complessivo"
                      evidenzia={indicatori.naturaCop}
                      dettaglio={{
                        formula: `Confronto tra FCFE (${fmt(rf.fcfe)}), flussi con i soci (${fmt(rf.flussiConSoci)}) e raccolta di nuovo debito (${fmt(rf.raccolta)}) → esito: «${indicatori.naturaCopTxt}».`,
                        perche: "Due aziende con lo stesso saldo di cassa possono avere salute opposta a seconda di COME l'hanno raggiunto. Coprire il fabbisogno con surplus operativo è sano; farlo erodendo riserve, chiedendo ai soci o accendendo nuovo debito a breve segnala fragilità crescente. Questo indicatore qualitativo legge la sequenza della cascata per classificare la fonte prevalente di copertura.",
                        cosaIndica: "Classificazione: VERDE «surplus strutturale» (l'FCFE copre i flussi con i soci senza nuovo debito); GIALLO «ricorso ai soci» o «erosione di riserve» (l'equilibrio dipende da aumenti di capitale o dalla distribuzione oltre l'FCFE); ROSSO «ricorso a nuovo debito» (il fabbisogno è coperto accendendo finanziamenti, spesso a breve).",
                        valutazione: indicatori.naturaCop === "ok"
                          ? "Copertura sana: il fabbisogno è coperto dal surplus di cassa strutturale generato dalla gestione. L'azienda non dipende da fonti esterne per stare in equilibrio."
                          : indicatori.naturaCop === "warn"
                          ? `Copertura da monitorare («${indicatori.naturaCopTxt}»): l'equilibrio finanziario dipende da fonti non operative (soci o riserve). Sostenibile una tantum, fragile se strutturale.`
                          : indicatori.naturaCop === "bad"
                          ? `Copertura fragile («${indicatori.naturaCopTxt}»): il fabbisogno è stato coperto con nuovo debito. Se ricorrente, l'azienda finanzia la gestione ordinaria con la leva — segnale di tensione crescente.`
                          : "Natura della copertura non determinabile con certezza dai flussi disponibili: verifica manualmente la composizione di soci, debito e surplus operativo.",
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Cash Flow to Debt Ratio"
                      valore={indicatori.cfDebt != null ? pct(indicatori.cfDebt, 1) : spDelta && spDelta.debFinTot === 0 ? "∞" : "n.d."}
                      sub={spDelta ? `FCFO ${fmt(rf.fcfo)} / Debiti fin. ${fmt(spDelta.debFinTot)}` : "carica il JSON SP (tab 4)"}
                      evidenzia={indicatori.cfDebtGiud}
                      dettaglio={{
                        formula: spDelta
                          ? spDelta.debFinTot > 0
                            ? `FCFO / Debiti finanziari totali (SP: entro + oltre 12 mesi) = ${fmt(rf.fcfo)} / ${fmt(spDelta.debFinTot)} = ${pct(indicatori.cfDebt, 1)}`
                            : "Debiti finanziari totali pari a zero: l'azienda non ha debito da rimborsare."
                          : "Non calcolabile: servono i debiti finanziari totali dal JSON dello Stato Patrimoniale (tab 4).",
                        perche: "Misura quanta parte del debito finanziario l'azienda potrebbe rimborsare in un anno con la sola cassa operativa dopo gli investimenti (FCFO). È il reciproco degli anni teorici di rimborso: 20% ≈ 5 anni, 10% ≈ 10 anni. Guarda la sostenibilità strutturale del debito, non solo il servizio dell'anno.",
                        cosaIndica: "Soglie di riferimento: VERDE se ≥ 20% (debito rimborsabile in ≤ 5 anni: sostenibilità piena); GIALLO tra 10% e 20% (rimborso in 5-10 anni: sostenibile ma da monitorare); ROSSO se < 10% (oltre 10 anni: il debito dipende dal rinnovo continuo, non dalla capacità di rimborso).",
                        valutazione: !spDelta
                          ? "n.d. — carica il JSON dello SP nel tab 4 per attivare l'indice."
                          : spDelta.debFinTot === 0
                          ? "Azienda priva di debito finanziario: nessun vincolo di rimborso sulla cassa operativa."
                          : indicatori.cfDebtGiud === "ok"
                          ? `Con un FCFO annuo di ${fmt(rf.fcfo)} il debito di ${fmt(spDelta.debFinTot)} è teoricamente rimborsabile in ${(spDelta.debFinTot / Math.max(rf.fcfo, 1)).toFixed(1).replace(".", ",")} anni: struttura finanziaria sostenibile.`
                          : indicatori.cfDebtGiud === "warn"
                          ? `Rimborso teorico in ${rf.fcfo > 0 ? (spDelta.debFinTot / rf.fcfo).toFixed(1).replace(".", ",") : "∞"} anni: sostenibile ma sensibile a cali dell'EBITDA o a nuovi assorbimenti di circolante.`
                          : `FCFO ${rf.fcfo <= 0 ? "negativo o nullo: il debito non è rimborsabile con la cassa operativa e dipende interamente dal rifinanziamento" : `insufficiente: servirebbero oltre ${(spDelta.debFinTot / rf.fcfo).toFixed(0)} anni di flussi correnti per azzerare il debito`}.`,
                      }}
                    />
                  </FattoreEspandibile>
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 7 · DATI & VALIDAZIONE T-1 ================= */}
          {tab === 7 && (
            <>
              <div className="border border-indigo-200 rounded-xl p-5 mb-6 bg-indigo-50/60">
                <p className="font-bold text-sm mb-1 text-indigo-900">🕐 Esercizio precedente (T-1) — la colonna comparativa</p>
                <p className="text-sm text-indigo-900/80 leading-relaxed">
                  Questa tabella è la gemella del tab 1, ma alimenta lo stato <b>vociPrec</b>: le voci
                  dell'<b>anno comparativo</b>. Vengono popolate automaticamente dalla seconda passata IA
                  lanciata quando carichi il rendiconto (o il bilancio completo): l'IA rilegge lo stesso
                  documento con l'istruzione tassativa di estrarre <b>solo la colonna dell'anno precedente</b>.
                  Se il documento non espone il comparativo — o se preferisci partire da un fascicolo separato —
                  usa i pulsanti dedicati qui sotto per caricare i file del T-1 a parte. Le due annualità
                  restano <b>completamente indipendenti</b>: rettifiche, storni e cascata sono calcolati
                  separatamente e si incontrano solo nel tab 9.
                </p>
              </div>

              {/* ---- Caricamenti dedicati T-1 ---- */}
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => fileRFPrec.current?.click()}
                  disabled={caricamentoPrec}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${caricamentoPrec ? "bg-slate-200 text-slate-400" : "bg-indigo-700 text-white hover:bg-indigo-600"}`}
                >
                  {caricamentoPrec ? "⏳ Elaborazione T-1…" : "📄 Carica RF Precedente a parte"}
                </button>
                <button
                  onClick={() => fileNIPrec.current?.click()}
                  disabled={caricamentoPrec}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoPrec ? "border-slate-200 text-slate-300" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"}`}
                >
                  📑 Carica NI Precedente a parte
                </button>
                <button
                  onClick={() => fileRGPrec.current?.click()}
                  disabled={caricamentoPrec}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border ${caricamentoPrec ? "border-slate-200 text-slate-300" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"}`}
                >
                  📎 Carica RG Precedente a parte
                </button>
                <button
                  onClick={aggiungiPrec}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 hover:bg-slate-50"
                >
                  ＋ Aggiungi voce T-1
                </button>
              </div>

              {/* ---- Anagrafica dell'esercizio precedente ---- */}
              <div className="flex flex-wrap gap-3 mb-6 items-end">
                <div>
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Esercizio precedente</p>
                  <input
                    value={esercizioPrec}
                    onChange={(e) => setEsercizioPrec(e.target.value)}
                    placeholder="es. 2024"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40"
                    aria-label="Esercizio precedente"
                  />
                </div>
                {[
                  ["Disponibilità liquide iniziali T-1", cassaInizialePrec, setCassaInizialePrec],
                  ["Disponibilità liquide finali T-1", cassaFinalePrec, setCassaFinalePrec],
                ].map(([label, val, setter]) => (
                  <div key={label}>
                    <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">{label}</p>
                    <input
                      type="number"
                      value={val ?? ""}
                      onChange={(e) => setter(e.target.value === "" ? null : Number(e.target.value))}
                      placeholder="n/d"
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono w-44 text-right"
                      aria-label={label}
                    />
                  </div>
                ))}
                {sintesiPrec.deltaCassa != null && (
                  <div className="text-sm text-slate-600 pb-2">
                    Δ disponibilità T-1: <span className="font-mono font-bold">{fmt(sintesiPrec.deltaCassa)}</span>
                  </div>
                )}
              </div>

              {vociPrec.length === 0 ? (
                <div className="border border-dashed border-indigo-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                  Nessuna voce per l'esercizio precedente. Carica il rendiconto nel tab 1 — la colonna
                  comparativa viene estratta in automatico — oppure usa «📄 Carica RF Precedente a parte»
                  per un fascicolo separato.
                </div>
              ) : (
                <>
                  <TabellaVoci voci={vociPrec} aggiorna={aggiornaPrec} elimina={eliminaPrec} />

                  {/* ---- Subtotali per area T-1 ---- */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {Object.entries(AREE_RF).map(([k, a]) => (
                      <div key={k} className="border border-slate-200 rounded-xl p-5">
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">{a.label}</p>
                        <p className={`text-2xl font-extrabold font-mono ${sintesiPrec.perArea[k] < 0 ? "text-rose-700" : "text-slate-900"}`}>
                          {fmtC(sintesiPrec.perArea[k])}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {sintesiPrec.totale ? pct(Math.abs(sintesiPrec.perArea[k]), Math.abs(sintesiPrec.totale)) : "—"} del flusso netto
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ---- Rettifiche NI e RG dell'esercizio precedente ---- */}
              {(niRettifichePrec.length > 0 || rgRettifichePrec.length > 0) && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                    <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                      Rettifiche a partita doppia · esercizio precedente
                    </p>
                  </div>
                  <div className="p-5 space-y-3">
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Ogni rettifica attiva genera su <b>vociPrec</b> uno storno di segno opposto sulla classe
                      di origine e — se non è una posta non-cash — la corrispondente riallocazione sulla classe
                      di destinazione. Disattivare una rettifica la rimuove dal prospetto senza cancellarla.
                    </p>
                    {[
                      ["NI", niRettifichePrec, aggiornaRettificaNIPrec, rimuoviRettificaNIPrec],
                      ["RG", rgRettifichePrec, aggiornaRettificaRGPrec, rimuoviRettificaRGPrec],
                    ].map(([tag, lista, aggiornaFn, rimuoviFn]) =>
                      lista.map((r, idx) => (
                        <div
                          key={`${tag}-${idx}`}
                          className={`border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 ${r.attiva ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-60"}`}
                        >
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                              type="checkbox"
                              checked={!!r.attiva}
                              disabled={!r.classeOrigine}
                              onChange={(e) => aggiornaFn(idx, { attiva: e.target.checked })}
                            />
                            {tag}
                          </label>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${RF_RETT_TIPI[r.tipo]?.color || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                            {RF_RETT_TIPI[r.tipo]?.label || r.tipo}
                          </span>
                          <span className="flex-1 min-w-[220px] text-sm text-slate-700">
                            {r.descrizione}
                            {r.motivazione && <span className="block text-xs text-slate-400 italic">{r.motivazione}</span>}
                          </span>
                          <span className={`font-mono text-sm font-bold ${r.importo < 0 ? "text-rose-700" : "text-slate-900"}`}>
                            {fmtC(Number(r.importo) || 0)}
                          </span>
                          <span className="text-xs text-slate-500 min-w-[150px]">
                            {CLASSI_RF[r.classeOrigine]?.label || "⚠ classe di origine mancante"}
                            {r.classeDestinazione ? ` → ${CLASSI_RF[r.classeDestinazione]?.label}` : ""}
                          </span>
                          <button onClick={() => rimuoviFn(idx)} className="text-rose-500 font-bold px-1" aria-label="Rimuovi rettifica">×</button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {(niEstrattiPrec.length > 0 || rgEstrattiPrec.length > 0) && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                    <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                      Estratti documentali riferiti all'esercizio precedente
                    </p>
                  </div>
                  <div className="p-5 space-y-2">
                    {[["NI", niEstrattiPrec, NI_SEZIONI_RF], ["RG", rgEstrattiPrec, RG_SEZIONI_RF]].map(([tag, lista, sezioni]) =>
                      lista.map((e, i) => (
                        <div key={`${tag}-${i}`} className={`border rounded-lg px-4 py-3 ${sezioni[e.sezione]?.color || "bg-slate-50 border-slate-200"}`}>
                          <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">
                            {tag} · {sezioni[e.sezione]?.titolo || `Sezione ${e.sezione}`}
                            {e.pagina != null && ` · p. ${e.pagina}`}
                          </p>
                          <p className="text-sm font-semibold">{e.tema}</p>
                          <p className="text-sm opacity-90 leading-relaxed">{e.contenuto}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ================= TAB 8 · RICLASSIFICAZIONE RF T-1 ================= */}
          {tab === 8 && (
            <div>
              <div className="border border-indigo-200 rounded-xl p-5 mb-6 bg-indigo-50/60">
                <p className="font-bold text-sm mb-1 text-indigo-900">🌊 La cascata dei flussi — esercizio precedente</p>
                <p className="text-sm text-indigo-900/80 leading-relaxed">
                  Prospetto identico al tab 5 ma alimentato da <b>rfPrec</b>, cioè dalla stessa funzione{" "}
                  <b>calcolaRF</b> applicata alle voci dell'anno comparativo. Avere la cascata del T-1
                  costruita con il medesimo motore è ciò che rende i Δ del tab 9 confrontabili: nessuna
                  differenza di metodo può inquinare il confronto, solo differenze di gestione.
                </p>
              </div>

              <Prospetto
                titolo={`Rendiconto finanziario riclassificato — esercizio precedente${azienda ? ` · ${azienda}` : ""}${esercizioPrec ? ` · ${esercizioPrec}` : ""}${schemaRFPrec?.unita ? ` · importi in ${schemaRFPrec.unita}` : ""}`}
                base={null}
                vuoto="Nessuna voce disponibile per l'esercizio precedente: estraila dal tab «7 · Dati & Validazione T-1»."
                righe={vociPrec.length ? [
                  { tipo: "sub",     label: "Flusso della gestione operativa corrente", val: rfPrec.flussoGestioneCorrente },
                  { tipo: "sub",     label: "Flusso operativo — TFR e Fondi (auto-assicurazione)", val: rfPrec.flussoFondi },
                  { tipo: "sub",     label: "Gestione finanziaria attiva (interessi e dividendi incassati)", val: rfPrec.finanzaAttiva },
                  { tipo: "margine", label: "Flusso operativo corrente", val: rfPrec.flussoOperativoCorrente },
                  { tipo: "sub",     label: "CAPEX — disinvestimenti (entrate)", val: rfPrec.capexEntrate },
                  { tipo: "sub",     label: "CAPEX — investimenti (uscite)", val: rfPrec.capexUscite },
                  { tipo: "sub",     label: "CAPEX netto", val: rfPrec.capex },
                  { tipo: "margine", label: "FCFO — Free Cash Flow from Operations", val: rfPrec.fcfo },
                  { tipo: "sub",     label: "Servizio del debito (interessi pagati e rimborsi di quote capitale)", val: rfPrec.servizioDelDebito },
                  { tipo: "margine", label: "FCFE — Flusso al servizio dei soci", val: rfPrec.fcfe },
                  { tipo: "sub",     label: "Componenti anomali / discontinue (non ricorrenti)", val: rfPrec.componentiAnomali },
                  { tipo: "sub",     label: "Dividendi e rimborsi ai soci", val: rfPrec.equityDividendi },
                  { tipo: "sub",     label: "Acquisto azioni proprie (Buyback)", val: rfPrec.equityBuyback },
                  { tipo: "sub",     label: "Aumenti di capitale versati", val: rfPrec.equityAumenti },
                  { tipo: "sub",     label: "Raccolta di nuovo debito (coperture)", val: rfPrec.raccolta },
                  { tipo: "margine", label: "Variazione della PFN a breve termine", val: rfPrec.variazionePfnBt },
                  { tipo: "sub",     label: "Effetto cambi sulle disponibilità liquide", val: rfPrec.effettoCambi },
                  { tipo: "margine", label: "Variazione netta delle disponibilità liquide", val: rfPrec.variazioneLiquiditaTotale },
                  { tipo: "nota",    label: "Il prospetto usa il medesimo motore di calcolo dell'esercizio corrente: ogni scostamento visibile nel tab 9 è quindi attribuibile alla gestione, non a differenze di riclassificazione." },
                ] : []}
              />

              {vociPrec.length > 0 && rfPrec.daClassificare > 0 && (
                <p className="text-amber-600 text-sm mt-4">
                  ⚠ {rfPrec.daClassificare} voce/i «da classificare» escluse dalla cascata T-1: assegnale nel
                  tab 7 per un prospetto completo e per rendere confrontabili i Δ del tab 9.
                </p>
              )}
            </div>
          )}

          {/* ================= TAB 9 · VARIAZIONI E TREND (Δ FLUSSI) ================= */}
          {tab === 9 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">📊 Variazioni e trend — l'azienda sta migliorando o peggiorando?</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Un rendiconto isolato dice quanta cassa è stata generata; due rendiconti a confronto dicono
                  se la <b>capacità di generarla</b> sta crescendo o deteriorandosi. Qui trovi i Δ assoluti e
                  percentuali sui cinque flussi chiave della cascata. La lettura cromatica non è meccanica:
                  per il <b>CAPEX</b> un Δ negativo (più investimenti) è colorato in rosso perché assorbe
                  cassa, ma può essere il segno di una crescita voluta — va letto insieme al Δ del flusso
                  operativo, che dice se l'azienda se lo può permettere.
                </p>
              </div>

              {!deltaFlussi.disponibile ? (
                <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
                  Confronto non disponibile: servono le voci di <b>entrambi</b> gli esercizi.
                  {!voci.length && " Estrai il rendiconto corrente nel tab 1."}
                  {!vociPrec.length && " Estrai o carica l'esercizio precedente nel tab 7."}
                </div>
              ) : (
                <>
                  {/* ---- Sintesi dei due esercizi ---- */}
                  <div className="grid sm:grid-cols-3 gap-4 mb-6">
                    {[
                      ["Esercizio corrente", esercizio || "T", rf.variazioneLiquiditaTotale, "text-teal-900"],
                      ["Esercizio precedente", esercizioPrec || "T-1", rfPrec.variazioneLiquiditaTotale, "text-indigo-900"],
                      ["Δ variazione netta di cassa", "T − (T-1)", rf.variazioneLiquiditaTotale - rfPrec.variazioneLiquiditaTotale, "text-slate-900"],
                    ].map(([label, sub, val, colore]) => (
                      <div key={label} className="border border-slate-200 rounded-xl p-5">
                        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">{label}</p>
                        <p className="text-[11px] text-slate-400 font-mono mb-2">{sub}</p>
                        <p className={`text-2xl font-extrabold font-mono ${val < 0 ? "text-rose-700" : colore}`}>{fmtC(val)}</p>
                      </div>
                    ))}
                  </div>

                  {/* ---- Δ sui flussi chiave ---- */}
                  {(() => {
                    const chiavi = [
                      ["flussoOperativoCorrente", "Δ Flusso operativo corrente", "La cassa prodotta dalla gestione ordinaria, prima degli investimenti: è il motore di tutto il resto.", true],
                      ["capex", "Δ CAPEX netto", "Investimenti al netto dei disinvestimenti. Un Δ negativo significa che l'azienda sta investendo di più.", false],
                      ["fcfo", "Δ FCFO", "Free Cash Flow from Operations: quanto resta dopo aver finanziato gli investimenti.", true],
                      ["fcfe", "Δ FCFE", "Cassa residua per i soci dopo il servizio del debito.", true],
                      ["variazionePfnBt", "Δ Variazione PFN a breve", "Dinamica della tensione di tesoreria: in miglioramento o in peggioramento?", true],
                    ];
                    const scala = Math.max(
                      1,
                      ...chiavi.map(([k]) => Math.abs(deltaFlussi[k].delta))
                    );
                    return (
                      <div className="grid md:grid-cols-2 gap-4 mb-6">
                        {chiavi.map(([k, label, descrizione, positivoBuono]) => (
                          <RigaDelta
                            key={k}
                            label={label}
                            descrizione={descrizione}
                            corr={deltaFlussi[k].corrente}
                            prec={deltaFlussi[k].precedente}
                            positivoBuono={positivoBuono}
                            scala={scala}
                          />
                        ))}
                      </div>
                    );
                  })()}

                  {/* ---- Tabella comparativa completa ---- */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                        Confronto integrale della cascata
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500 uppercase border-b border-slate-200">
                          <th className="px-5 py-2 text-left">Grandezza</th>
                          <th className="px-4 py-2 text-right">{esercizio || "T"}</th>
                          <th className="px-4 py-2 text-right">{esercizioPrec || "T-1"}</th>
                          <th className="px-4 py-2 text-right">Δ assoluto</th>
                          <th className="px-4 py-2 text-right">Δ %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["Flusso della gestione operativa corrente", "flussoGestioneCorrente", false],
                          ["Flusso operativo — TFR e Fondi", "flussoFondi", false],
                          ["Gestione finanziaria attiva", "finanzaAttiva", false],
                          ["Flusso operativo corrente", "flussoOperativoCorrente", true],
                          ["CAPEX — investimenti (uscite)", "capexUscite", false],
                          ["CAPEX netto", "capex", false],
                          ["FCFO", "fcfo", true],
                          ["Servizio del debito", "servizioDelDebito", false],
                          ["FCFE", "fcfe", true],
                          ["Componenti anomali", "componentiAnomali", false],
                          ["Dividendi e rimborsi ai soci", "equityDividendi", false],
                          ["Acquisto azioni proprie (Buyback)", "equityBuyback", false],
                          ["Flussi totali con i soci", "flussiConSoci", false],
                          ["Raccolta di nuovo debito", "raccolta", false],
                          ["Variazione della PFN a breve", "variazionePfnBt", true],
                          ["Variazione netta delle disponibilità liquide", "variazioneLiquiditaTotale", true],
                        ].map(([label, chiave, margine]) => {
                          const c = Number(rf[chiave]) || 0;
                          const pr = Number(rfPrec[chiave]) || 0;
                          const d = c - pr;
                          const vp = Math.abs(pr) > 1e-9 ? (d / Math.abs(pr)) * 100 : null;
                          return (
                            <tr key={chiave} className={`border-t border-slate-100 ${margine ? "bg-teal-50" : ""}`}>
                              <td className={`px-5 py-2 ${margine ? "font-extrabold text-teal-900" : "text-slate-700"}`}>{label}</td>
                              <td className={`px-4 py-2 text-right font-mono ${c < 0 ? "text-rose-700" : "text-slate-700"}`}>{fmtC(c)}</td>
                              <td className={`px-4 py-2 text-right font-mono ${pr < 0 ? "text-rose-600" : "text-slate-500"}`}>{fmtC(pr)}</td>
                              <td className={`px-4 py-2 text-right font-mono font-bold ${d < 0 ? "text-rose-700" : d > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                                {d > 0 ? "+" : ""}{fmt(d)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs text-slate-400">
                                {vp != null ? `${vp > 0 ? "+" : ""}${vp.toFixed(1).replace(".", ",")}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ---- Lettura di sintesi ---- */}
                  <div className={`border rounded-xl p-5 text-sm leading-relaxed ${
                    deltaFlussi.fcfo.delta > 0 && deltaFlussi.flussoOperativoCorrente.delta > 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : deltaFlussi.fcfo.delta < 0 && deltaFlussi.flussoOperativoCorrente.delta < 0
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}>
                    <b>Lettura di sintesi.</b>{" "}
                    {deltaFlussi.flussoOperativoCorrente.delta > 0
                      ? `Il motore operativo è in miglioramento (${deltaFlussi.flussoOperativoCorrente.delta > 0 ? "+" : ""}${fmt(deltaFlussi.flussoOperativoCorrente.delta)}): la gestione ordinaria genera più cassa dell'anno precedente. `
                      : deltaFlussi.flussoOperativoCorrente.delta < 0
                      ? `Il motore operativo si è indebolito (${fmt(deltaFlussi.flussoOperativoCorrente.delta)}): la gestione ordinaria genera meno cassa dell'anno precedente. `
                      : "Il flusso operativo corrente è sostanzialmente invariato. "}
                    {deltaFlussi.capex.delta < 0
                      ? `Gli investimenti sono aumentati di ${fmt(Math.abs(deltaFlussi.capex.delta))}: verifica nel tab 6 se il flusso operativo li copre ancora. `
                      : deltaFlussi.capex.delta > 0
                      ? `Gli investimenti si sono ridotti di ${fmt(deltaFlussi.capex.delta)}: attenzione a distinguere una razionalizzazione da un sotto-investimento che rinvia il problema. `
                      : "Il CAPEX netto è stabile. "}
                    {deltaFlussi.fcfo.delta > 0
                      ? `L'effetto combinato porta l'FCFO in crescita di ${fmt(deltaFlussi.fcfo.delta)}.`
                      : deltaFlussi.fcfo.delta < 0
                      ? `L'effetto combinato comprime l'FCFO di ${fmt(Math.abs(deltaFlussi.fcfo.delta))}: è la grandezza da monitorare, perché è ciò che resta per debito e soci.`
                      : "L'FCFO resta invariato."}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================= TAB 10 · AUDIT DEL REVISORE (UNIFICATO) ================= */}
          {tab === 10 && (
            <div>
              <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
                <p className="font-bold text-sm mb-1">🔍 Audit del Revisore — checklist unificata in otto controlli</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Un solo elenco di anomalie, alimentato da due fonti. I <b>controlli automatici</b> sono
                  deterministici, si aggiornano a ogni modifica e non consumano token: sui fatti aritmetici —
                  convenzione dei segni, quadratura fra somma dei flussi e variazione della liquidità, tenuta
                  delle scomposizioni del debito, voci orfane, disallineamenti fra gli esercizi — restano la
                  fonte più affidabile. La <b>revisione IA</b> si aggiunge su richiesta per i casi di giudizio:
                  inquinamento da Stato Patrimoniale e Conto Economico, subtotali estratti insieme al dettaglio,
                  area di classificazione del flusso, poste non monetarie. Quando entrambe le fonti colpiscono la
                  stessa voce sullo stesso controllo la segnalazione è <b>una sola</b>, marcata come confermata.
                  Dove possibile ogni anomalia porta con sé la <b>correzione applicabile con un clic</b>; quando
                  la diagnosi viene dall'IA porta anche la <b>regola da insegnare al sistema</b>, che viene
                  appesa ai prompt e salvata nel browser.
                </p>
              </div>

              {/* ---- Barra comandi ---- */}
              <div className="border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={eseguiAuditIA}
                  disabled={auditIA.loading || !iaAttiva}
                  className="text-xs font-semibold rounded-lg px-4 py-2 bg-purple-700 text-white disabled:opacity-40"
                >
                  {auditIA.loading ? "Revisione in corso…" : "🔎 Aggiungi la revisione IA"}
                </button>
                <button
                  onClick={() => navigator.clipboard?.writeText(auditTestuale())}
                  className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white hover:bg-slate-50"
                >
                  📋 Copia l'audit
                </button>
                <button
                  onClick={resetSystemPrompts}
                  className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white hover:bg-slate-50"
                  title="Svuota il localStorage e ripristina i prompt di sistema originali (le quattro regole inviolabili di fabbrica restano attive)"
                >
                  ♻ Reset Regole IA
                </button>

                <span
                  className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    (systemPrompts.regoleApprese || []).length
                      ? "bg-indigo-100 text-indigo-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {(systemPrompts.regoleApprese || []).length
                    ? `${systemPrompts.regoleApprese.length} regole apprese e memorizzate nel browser`
                    : "Nessuna regola appresa: attive solo le 4 regole inviolabili di fabbrica"}
                </span>
                {!iaAttiva && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                    Provider IA non configurato: restano attivi i soli controlli automatici
                  </span>
                )}
                {!auditLocale.dueAnni && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Manca un esercizio: coerenza fra gli anni e delta non verificabili
                  </span>
                )}
                {auditIA.quando && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Ultima revisione IA: {auditIA.quando}
                  </span>
                )}
              </div>

              {auditIA.errore && (
                <p className="border border-red-200 bg-red-50 rounded-xl p-4 mb-6 text-sm text-red-700">⚠ {auditIA.errore}</p>
              )}

              {/* ---- Cruscotto ---- */}
              <div className="grid sm:grid-cols-4 gap-4 mb-6">
                {[
                  ["Rilievi gravi", auditUnificato.gravi, auditUnificato.gravi ? "text-red-700" : "text-emerald-700"],
                  ["Rilievi medi", auditUnificato.medi, auditUnificato.medi ? "text-amber-700" : "text-emerald-700"],
                  ["Segnalazioni", auditUnificato.info, "text-slate-700"],
                  ["Correggibili con un clic", auditUnificato.correggibili, auditUnificato.correggibili ? "text-purple-700" : "text-slate-400"],
                ].map(([label, valore, colore]) => (
                  <div key={label} className="border border-slate-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1">{label}</p>
                    <p className={`text-3xl font-extrabold font-mono ${colore}`}>{valore}</p>
                  </div>
                ))}
              </div>

              {/* ---- Esito ---- */}
              {auditUnificato.items.length === 0 ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 mb-6 flex gap-4 items-start">
                  <span className="text-3xl leading-none">✅</span>
                  <div>
                    <p className="font-bold text-sm text-emerald-800 mb-1">Audit superato — nessuna anomalia rilevata</p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {(auditIA.esito === "superato" && auditIA.messaggioGenerale) ||
                        "I flussi quadrano con i saldi di cassa in entrambi gli esercizi, i segni rispettano i principi contabili e la classificazione è coerente anno su anno. Nessuna correzione manuale richiesta."}
                    </p>
                    {!auditIA.quando && iaAttiva && (
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Hanno risposto finora i soli controlli automatici: aggiungi la revisione IA per sottoporre
                        al modello anche i casi di giudizio.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-red-300 bg-red-50 p-4 mb-6 flex gap-4 items-start">
                  <span className="text-3xl leading-none">⚠</span>
                  <div>
                    <p className="font-bold text-sm text-red-800 mb-1">
                      {auditUnificato.items.length} anomalie da esaminare
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {(auditIA.anomalie?.length && auditIA.messaggioGenerale) ||
                        "Elenco prodotto dai controlli automatici. Aggiungi la revisione IA per estenderlo ai controlli che richiedono giudizio contabile."}
                    </p>
                    {auditUnificato.fusi > 0 && (
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        {auditUnificato.fusi} rilievi automatici sono stati confermati dalla revisione IA e compaiono
                        una volta sola.
                      </p>
                    )}
                    {auditIA.scartate > 0 && (
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        {auditIA.scartate} segnalazioni dell'IA sono state scartate perché non riconducibili a una
                        voce esistente, perché duplicate sulla stessa voce o perché proponevano una classe
                        inesistente.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ---- Elenco unificato delle anomalie ---- */}
              <div className="space-y-4 mb-6">
                {auditUnificato.items.map((an, i) => {
                  const az = auditAzioni[an.key] || {};
                  const eliminaVoce = an.autoFix.tipo === "elimina";
                  const invertiVoce = an.autoFix.tipo === "invertiSegno";
                  const fonteBadge =
                    an.fonte === "auto"
                      ? ["Controllo automatico", "bg-slate-200 text-slate-700"]
                      : an.fonte === "ia"
                      ? ["Revisione IA", "bg-purple-100 text-purple-800"]
                      : ["Automatico · confermato dall'IA", "bg-indigo-100 text-indigo-800"];
                  return (
                    <div
                      key={an.key}
                      className={`border rounded-xl overflow-hidden ${az.fix ? "border-emerald-300" : "border-slate-200"}`}
                    >
                      <div
                        className={`px-5 py-3 border-b flex flex-wrap items-center gap-2 ${
                          az.fix ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        <p className="font-bold text-sm flex-1 min-w-[180px]">
                          {i + 1} · {an.titolo}
                        </p>
                        <span
                          className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            an.gravita === "grave"
                              ? "bg-red-100 text-red-800"
                              : an.gravita === "medio"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {an.gravita === "grave" ? "Errore grave" : an.gravita === "medio" ? "Da verificare" : "Segnalazione"}
                        </span>
                        <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${fonteBadge[1]}`}>
                          {fonteBadge[0]}
                        </span>
                        {an.controllo && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Controllo {an.controllo}/8
                          </span>
                        )}
                      </div>

                      <div className="p-5 space-y-3">
                        {/* Voce interessata */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap gap-2 items-center justify-between mb-1.5">
                            <span className="font-bold text-sm text-slate-800">
                              {an.idVoce ? an.voce : `Cerca la voce «${an.voce}»`}
                            </span>
                            {an.importo != null && <span className="text-sm font-mono">{fmtC(an.importo)}</span>}
                          </div>
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                              {an.anno}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{an.sezione}</span>
                            {an.classeAttuale && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-300 text-slate-700">
                                {an.classeAttuale}
                              </span>
                            )}
                            {an.autoFix.eseguibile && (
                              <>
                                <span className="text-xs text-slate-400">→</span>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    eliminaVoce
                                      ? "bg-red-50 border-red-300 text-red-700"
                                      : "bg-emerald-50 border-emerald-300 text-emerald-800"
                                  }`}
                                >
                                  {eliminaVoce
                                    ? "🗑 ELIMINA la voce"
                                    : invertiVoce
                                    ? `SEGNO · ${fmtC(-(an.importo || 0))}`
                                    : an.autoFix.nuovaClasse}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Errore e azione */}
                        <p className="text-sm text-slate-700 leading-relaxed">👉 Errore rilevato: {an.errore}</p>
                        {an.spiegazioneIA && (
                          <p className="text-sm text-slate-700 leading-relaxed border-l-2 border-purple-300 pl-3">
                            🤖 Nota del revisore IA: {an.spiegazioneIA}
                          </p>
                        )}
                        <p className="text-sm text-slate-800 leading-relaxed font-medium">
                          👉 Azione da compiere: {an.azione}
                        </p>

                        {/* Regola proposta */}
                        {an.promptUpdateSuggestion && (
                          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                            <p className="text-[11px] font-bold text-sky-800 mb-1">
                              🧠 Regola proposta per i prompt di sistema · target {an.promptUpdateSuggestion.target}
                            </p>
                            <p className="text-xs italic text-slate-700 leading-relaxed">
                              {an.promptUpdateSuggestion.nuovaRegola}
                            </p>
                          </div>
                        )}

                        {/* Azioni */}
                        <div className="flex flex-wrap gap-2 items-center pt-1">
                          {an.autoFix.eseguibile && (
                            <button
                              onClick={() => auditCorreggi(an)}
                              disabled={az.fix}
                              className={`text-xs font-semibold rounded-lg px-4 py-2 text-white disabled:opacity-60 ${
                                az.fix ? "bg-slate-400" : eliminaVoce ? "bg-red-600" : "bg-emerald-600"
                              }`}
                            >
                              {az.fix ? "✓ Risolto" : an.autoFix.etichetta || "✨ Correggi in automatico"}
                            </button>
                          )}
                          {an.promptUpdateSuggestion && (
                            <button
                              onClick={() => auditInsegna(an)}
                              disabled={az.learn}
                              className={`text-xs font-semibold rounded-lg px-4 py-2 text-white disabled:opacity-60 ${
                                az.learn ? "bg-slate-400" : "bg-purple-700"
                              }`}
                            >
                              {az.learn ? "✓ Regola memorizzata!" : "🧠 Insegna al sistema"}
                            </button>
                          )}
                          {!an.autoFix.eseguibile && (
                            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              Correzione non automatizzabile: intervieni a mano
                            </span>
                          )}
                          <button
                            onClick={() => setTab(an.tab)}
                            className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white hover:bg-slate-50"
                          >
                            {az.fix ? "Verifica nel tab →" : "Vai al tab interessato →"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {auditUnificato.items.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-6 flex gap-3 items-start">
                  <span className="text-2xl leading-none">↩</span>
                  <p className="text-[11px] text-slate-700 leading-relaxed flex-1">
                    <b>Dopo le correzioni:</b> ogni auto-fix modifica direttamente le voci validate, quindi
                    cascata dei flussi, FCFO, FCFE, delta e controlli automatici vengono ricalcolati all'istante —
                    i rilievi deterministici rientrati spariscono da soli dall'elenco. I rilievi prodotti dall'IA,
                    invece, restano com'erano finché non rilanci la revisione. Le regole insegnate agiscono sulle{" "}
                    <i>prossime</i> estrazioni, non retroattivamente sui dati già in memoria.
                  </p>
                </div>
              )}

              {/* ---- Quadratura flussi ↔ saldi di cassa ---- */}
              <div className="border border-slate-200 rounded-xl p-5 mb-6">
                <p className="font-bold text-sm mb-3">Controllo 7 · Quadratura fra flussi e saldi di cassa</p>
                {[
                  [esercizio || "Esercizio corrente", auditLocale.quadraturaT],
                  [esercizioPrec || "Esercizio precedente", auditLocale.quadraturaT1],
                ].map(([anno, q]) => (
                  <p key={anno} className="text-sm text-slate-600 mb-1">
                    <b>{anno}</b>:{" "}
                    {!q ? (
                      <span className="text-slate-500">
                        dati non disponibili — controllo non eseguito (diverso da «quadratura riuscita»).
                      </span>
                    ) : q.ok ? (
                      <>
                        somma dei flussi <span className="font-mono">{fmt(q.totale)}</span> · Δ liquidità{" "}
                        <span className="font-mono">{fmt(q.deltaCassa)}</span> ·{" "}
                        <span className="text-emerald-700 font-semibold">quadra ✓</span>
                      </>
                    ) : (
                      <>
                        somma dei flussi <span className="font-mono">{fmt(q.totale)}</span> · Δ liquidità{" "}
                        <span className="font-mono">{fmt(q.deltaCassa)}</span> ·{" "}
                        <span className="text-red-700 font-semibold">scarto {fmt(q.scarto)}</span>
                      </>
                    )}
                  </p>
                ))}
                <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
                  Il confronto avviene al <b>lordo delle rettifiche</b>: gli storni non monetari correggono i
                  flussi ma non toccano i saldi di cassa del documento, quindi includerli produrrebbe uno scarto
                  solo apparente. Le voci in «da_classificare» restano invece escluse dai totali, ed è la ragione
                  più frequente di mancata quadratura. I rilievi dell'elenco qui sopra riguardano perciò gli
                  errori che la quadratura da sola non intercetta — segni ribaltati che si compensano, flussi
                  collocati nell'area sbagliata, scomposizioni del debito che non ricostruiscono il netto.
                </p>
              </div>

              {/* ---- Registro delle regole apprese ---- */}
              {(systemPrompts.regoleApprese || []).length > 0 && (
                <div className="border border-purple-200 rounded-xl overflow-hidden mb-6">
                  <p className="px-4 py-2.5 bg-purple-50 border-b border-purple-200 font-bold text-sm text-purple-900">
                    Memoria del sistema — regole apprese dai prompt
                  </p>
                  <div className="p-4 space-y-2">
                    {systemPrompts.regoleApprese.map((rg, k) => (
                      <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <div className="flex flex-wrap gap-2 items-center mb-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                            {rg.target}
                          </span>
                          <span className="text-[10px] text-slate-400">{rg.quando}</span>
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">{rg.testo}</p>
                      </div>
                    ))}
                    <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                      Queste regole sono già incorporate nei prompt di sistema e vengono inviate a ogni chiamata IA
                      di estrazione (rendiconto, analisi del bilancio completo, colonna comparativa T-1). Sono
                      salvate nel localStorage del browser con la chiave <code>{RF_PROMPTS_KEY}</code>: il pulsante
                      «Reset Regole IA» le rimuove tutte, mentre le quattro regole inviolabili di fabbrica restano
                      sempre attive.
                    </p>
                  </div>
                </div>
              )}

              <p className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 leading-relaxed">
                L'audit è un secondo parere, non una certificazione: i rilievi vanno valutati prima di modificare
                le classificazioni. In caso di contrasto fra le due fonti prevale il controllo automatico sui
                fatti aritmetici — segni, quadrature, voci orfane, somma delle scomposizioni — mentre sul merito
                contabile, se una posta sia davvero non monetaria o in quale area vada collocato un flusso, il
                giudizio resta tuo.
              </p>
            </div>
          )}

        </div>
      </div>
    </ErrorBoundary>
  );
}
