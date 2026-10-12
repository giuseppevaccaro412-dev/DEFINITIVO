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
   RICLASSIFICAZIONE DEL CONTO ECONOMICO — schema dinamico
   Riclassificazione a VALORE AGGIUNTO articolata per aree di
   gestione:
     · GESTIONE CORRENTE → caratteristica · finanziaria · accessoria
     · GESTIONE NON CORRENTE → componenti straordinarie/non ricorrenti
   Tab dedicati: Collegamento CCNO e Segment Reporting (ASA).
   ============================================================ */

/* ---------- Classi di pertinenza gestionale ----------
   area: corrente_caratteristica | corrente_finanziaria |
         corrente_accessoria | non_corrente | tributaria      */

const CLASSI = {
  RICAVI: {
    label: "Gestione corrente · Caratteristica — Ricavi delle vendite e prestazioni (fatturato)",
    area: "corrente_caratteristica", asa: true,
  },
  VAR_RIM_PF: {
    label: "Gestione corrente · Caratteristica — Variazione rimanenze prodotti/semilavorati (segno + se incremento)",
    area: "corrente_caratteristica", signed: true, asa: true,
  },
  LAVORI_INTERNI: {
    label: "Gestione corrente · Caratteristica — Incrementi di immobilizzazioni per lavori interni",
    area: "corrente_caratteristica", asa: true,
  },
  ALTRI_RICAVI: {
    label: "Gestione corrente · Caratteristica — Altri ricavi e proventi operativi",
    area: "corrente_caratteristica", asa: true,
  },
  ACQUISTI: {
    label: "Gestione corrente · Caratteristica — Acquisti materie prime, sussidiarie, di consumo e merci",
    area: "corrente_caratteristica", asa: true,
  },
  VAR_RIM_MATERIE: {
    label: "Gestione corrente · Caratteristica — Variazione rimanenze materie (segno + se incremento: riduce i consumi)",
    area: "corrente_caratteristica", signed: true, asa: true,
  },
  SERVIZI: {
    label: "Gestione corrente · Caratteristica — Costi per servizi (lavorazioni, utenze, consulenze, trasporti)",
    area: "corrente_caratteristica", asa: true,
  },
  GODIMENTO: {
    label: "Gestione corrente · Caratteristica — Godimento beni di terzi (affitti, canoni, leasing operativi)",
    area: "corrente_caratteristica", asa: true,
  },
  PERSONALE: {
    label: "Gestione corrente · Caratteristica — Costo del personale (salari, oneri sociali, TFR)",
    area: "corrente_caratteristica", asa: true,
  },
  AMMORTAMENTI: {
    label: "Gestione corrente · Caratteristica — Ammortamenti e svalutazioni operative",
    area: "corrente_caratteristica", asa: true,
  },
  ACCANTONAMENTI: {
    label: "Gestione corrente · Caratteristica — Accantonamenti per rischi e altri fondi",
    area: "corrente_caratteristica", asa: true,
  },
  ONERI_DIVERSI: {
    label: "Gestione corrente · Caratteristica — Oneri diversi di gestione",
    area: "corrente_caratteristica", asa: true,
  },
  PROVENTI_FIN: {
    label: "Gestione corrente · Finanziaria — Proventi finanziari (interessi attivi, dividendi, utili su cambi)",
    area: "corrente_finanziaria",
  },
  ONERI_FIN: {
    label: "Gestione corrente · Finanziaria — Oneri finanziari (interessi passivi, perdite su cambi)",
    area: "corrente_finanziaria",
  },
  PROVENTI_ACCESSORI: {
    label: "Gestione corrente · Accessoria — Proventi accessori (immobili civili, partecipazioni non strategiche)",
    area: "corrente_accessoria",
  },
  ONERI_ACCESSORI: {
    label: "Gestione corrente · Accessoria — Oneri accessori (costi dei beni patrimoniali estranei)",
    area: "corrente_accessoria",
  },
  NON_CORRENTE: {
    label: "Gestione non corrente — Componenti straordinarie/non ricorrenti (segno +/-)",
    area: "non_corrente", signed: true,
  },
  EXTRA_GESTIONE: {
    label: "Area Extra-Gestione — Poste da contabilità creativa/window dressing stornate (segno +/-)",
    area: "extra_gestione", signed: true,
  },
  IMPOSTE: {
    label: "Gestione tributaria — Imposte sul reddito dell'esercizio (correnti, differite, anticipate)",
    area: "tributaria",
  },
  DA_CLASSIFICARE: {
    label: "Da classificare — esclusa dai calcoli finché non assegnata",
    area: "corrente_caratteristica",
  },
};

const RICAVI_CLASSI = ["RICAVI", "VAR_RIM_PF", "LAVORI_INTERNI", "ALTRI_RICAVI", "PROVENTI_FIN", "PROVENTI_ACCESSORI"];
const ASA_COMUNE = "__comune__";

/* ============================================================
   AUDIT DEL REVISORE — utilità a livello di modulo
   ============================================================
   Motore dei cinque controlli di revisione eseguiti sul piano
   voci dei due esercizi, sulle rettifiche di normalizzazione e
   sulle riallocazioni per natura. La parte deterministica sta
   qui e nel componente (auditLocale); l'IA interviene in un
   secondo momento sui casi di giudizio (auditIA).
   ============================================================ */

/* Confronto dei nomi voce fra T e T-1: si ignorano maiuscole, accenti,
   punteggiatura e spazi multipli, perché la stessa voce raramente viene
   trascritta in modo identico nei due bilanci («Costi per servizi ind.li»
   vs «Costi per servizi industriali»). */
const auditNormalizzaNome = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* Vocabolario per riconoscere la natura di una posta dal suo nome.
   L'ordine conta: le regole più specifiche vanno prima di quelle generiche
   (le variazioni di rimanenze prima degli acquisti, le imposte sul reddito
   prima delle imposte indirette, che sono oneri diversi di gestione). */
const AUDIT_REGOLE_CLASSE = [
  [/variazion.*rimanenz.*(prodott|semilavorat|finit|corso di lavorazion)/, "VAR_RIM_PF"],
  [/variazion.*rimanenz.*(materi|merc|sussidiar|consumo)/, "VAR_RIM_MATERIE"],
  [/(increment|capitalizzaz).*(immobilizzaz|lavori intern)|lavori intern/, "LAVORI_INTERNI"],
  [/impost.*(sul reddito|corrent|different|anticipat)|ires|irap|tax expense/, "IMPOSTE"],
  [/(interess|oner).*(passiv|finanziar)|perdite su cambi|interest expense/, "ONERI_FIN"],
  [/(interess.*attiv|provent.*finanziar|dividend|utili su cambi|interest income)/, "PROVENTI_FIN"],
  [/(ammortament|svalutazion|impairment|depreciation|amortisation|amortization)/, "AMMORTAMENTI"],
  [/(accantonament|fondo rischi|provision)/, "ACCANTONAMENTI"],
  [/(personale|salari|stipend|retribuz|oneri social|tfr|dipendent|employee|payroll)/, "PERSONALE"],
  [/(godiment|affitt|canon|leasing|locazion|noleggi|\brent\b)/, "GODIMENTO"],
  [/(acquist|materie prime|component|merci|consumi di materi|raw material)/, "ACQUISTI"],
  [/(servizi|consulenz|utenz|trasport|manutenzion|pubblicit|marketing|assicuraz|professional fee)/, "SERVIZI"],
  [/(ricav|vendite|fatturat|sponsor|prestazioni|revenue|net sales)/, "RICAVI"],
  [/(altri ricavi|altri provent|contribut|sopravvenienze attiv|other income)/, "ALTRI_RICAVI"],
  [/(straordinari|non ricorrent|ristrutturazion|restructuring|one.?off)/, "NON_CORRENTE"],
  [/(oneri divers|imposte indirett|tasse|sopravvenienze passiv|multe|sanzion)/, "ONERI_DIVERSI"],
  [/(provent.*accessor|immobili civili|partecipazioni non strategiche)/, "PROVENTI_ACCESSORI"],
  [/(oner.*accessor|beni patrimoniali estranei)/, "ONERI_ACCESSORI"],
];

const auditSuggerisciClasse = (nome) => {
  const n = auditNormalizzaNome(nome);
  if (!n) return null;
  for (const [regola, classe] of AUDIT_REGOLE_CLASSE) if (regola.test(n)) return classe;
  return null;
};

/* Natura della posta stornata, per il controllo sui segni:
   un onere stornato deve avere importo NEGATIVO, un provento POSITIVO. */
const AUDIT_PAROLE_ONERE =
  /(oner|cost|spes|svalutazion|accantonament|perdit|multa|sanzion|penale|ristrutturazion|impairment|write.?down|write.?off|contenzios|esubero|licenziament|indennit.*uscita|minusvalenz)/;
const AUDIT_PAROLE_PROVENTO =
  /(provent|ricav|plusvalenz|rivalutazion|indennizz|risarciment|contribut|sopravvenienz.*attiv|utile|gain|rilascio fondo|insussistenz.*passiv)/;

const auditNaturaPosta = (descrizione) => {
  const d = auditNormalizzaNome(descrizione);
  const onere = AUDIT_PAROLE_ONERE.test(d);
  const provento = AUDIT_PAROLE_PROVENTO.test(d);
  if (onere && !provento) return "onere";
  if (provento && !onere) return "provento";
  return "ambigua"; // nessuna segnalazione: il segno non è verificabile dal nome
};

/* Classi «per natura»: destinazioni legittime di una riallocazione IAS 1.104
   (da CE per funzione a CE per natura). Le classi funzionali di origine sono
   invece quelle che aggregano costi eterogenei. */
const AUDIT_CLASSI_NATURA = ["PERSONALE", "AMMORTAMENTI", "ACCANTONAMENTI", "GODIMENTO", "ONERI_DIVERSI", "ONERI_FIN"];

/* Soglia oltre la quale una variazione di margine viene sottoposta a verifica.
   Non è di per sé un errore: è l'innesco dell'analisi di attribuzione. */
const AUDIT_SOGLIA_DELTA_PCT = 40;

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
const CHECKLIST_CE = {
  1: "Inquinamento da Rendiconto Finanziario e OCI",
  2: "Duplicazioni",
  3: "Coerenza fra gli esercizi",
  4: "Natura contro funzione",
  5: "Quadratura delle riallocazioni (IAS 1.104)",
  6: "Segno delle rettifiche di normalizzazione",
  7: "Plausibilità dei delta economici",
  8: "Voci orfane",
};

/* Vecchia numerazione deterministica (1..5) → scala canonica (1..8) */
const CONTROLLO_UNIFICATO = { 1: 3, 2: 5, 3: 6, 4: 7, 5: 8 };

/* Il campo `sezione` dei rilievi deterministici è testo per l'utente
   («Tab 2 · Nota Integrativa»): qui viene tradotto nell'id di tab su cui
   deve atterrare il pulsante «Vai al tab». Gli id NON coincidono con la
   numerazione mostrata: il tab dei dati T-1 ha id 10, non 9. */
const tabDaSezione = (sezione = "") => {
  const s = String(sezione);
  if (/^Tab 9/.test(s)) return 10;
  if (/^Tab 2/.test(s)) return 2;
  if (/^Tab 3/.test(s)) return 9;
  if (/^Tab 11/.test(s)) return 12;
  return 1;
};

const ORDINE_GRAVITA = { grave: 0, medio: 1, info: 2 };

/* ---------- Dati d'esempio (Ferrari N.V., 31/12/2025, migliaia EUR) ---------- */

const ESEMPIO = {
  azienda: "Ferrari N.V.",
  esercizio: "31/12/2025",
  fonte: "riclassificazione-ce_31_12_2025 Completo.json",
  asa: ["Auto e ricambi", "Sponsorship & Brand", "Motori"],
  voci: [
    { nome: "Ricavi netti veicoli e ricambi", importo: 6150000, classe: "RICAVI", asa: "Auto e ricambi" },
    { nome: "Ricavi sponsorship, commerciale e brand", importo: 620000, classe: "RICAVI", asa: "Sponsorship & Brand" },
    { nome: "Ricavi motori", importo: 330000, classe: "RICAVI", asa: "Motori" },
    { nome: "Altri ricavi e proventi operativi", importo: 180000, classe: "ALTRI_RICAVI", asa: null },
    { nome: "Variazione rimanenze prodotti finiti e in corso", importo: 85000, classe: "VAR_RIM_PF", asa: "Auto e ricambi" },
    { nome: "Acquisti materie e componenti — auto", importo: 2250000, classe: "ACQUISTI", asa: "Auto e ricambi" },
    { nome: "Acquisti materie e componenti — motori", importo: 200000, classe: "ACQUISTI", asa: "Motori" },
    { nome: "Variazione rimanenze materie prime", importo: 35000, classe: "VAR_RIM_MATERIE", asa: "Auto e ricambi" },
    { nome: "Costi per servizi industriali — auto", importo: 560000, classe: "SERVIZI", asa: "Auto e ricambi" },
    { nome: "Costi per servizi industriali — motori", importo: 80000, classe: "SERVIZI", asa: "Motori" },
    { nome: "Costi per servizi commerciali e racing", importo: 310000, classe: "SERVIZI", asa: "Sponsorship & Brand" },
    { nome: "Costi per servizi amministrativi", importo: 200000, classe: "SERVIZI", asa: null },
    { nome: "Godimento beni di terzi", importo: 65000, classe: "GODIMENTO", asa: "Auto e ricambi" },
    { nome: "Costo del personale — produzione", importo: 560000, classe: "PERSONALE", asa: "Auto e ricambi" },
    { nome: "Costo del personale — R&S", importo: 120000, classe: "PERSONALE", asa: "Auto e ricambi" },
    { nome: "Costo del personale — commerciale", importo: 170000, classe: "PERSONALE", asa: null },
    { nome: "Costo del personale — amministrativo", importo: 130000, classe: "PERSONALE", asa: null },
    { nome: "Ammortamenti immobilizzazioni industriali", importo: 600000, classe: "AMMORTAMENTI", asa: "Auto e ricambi" },
    { nome: "Ammortamenti costi di sviluppo", importo: 160000, classe: "AMMORTAMENTI", asa: "Auto e ricambi" },
    { nome: "Accantonamenti per rischi", importo: 45000, classe: "ACCANTONAMENTI", asa: null },
    { nome: "Oneri diversi di gestione", importo: 120000, classe: "ONERI_DIVERSI", asa: null },
    { nome: "Proventi finanziari (incl. financial services)", importo: 95000, classe: "PROVENTI_FIN" },
    { nome: "Oneri finanziari", importo: 140000, classe: "ONERI_FIN" },
    { nome: "Proventi da immobili civili e partecipazioni non strategiche", importo: 12000, classe: "PROVENTI_ACCESSORI" },
    { nome: "Imposte sul reddito", importo: 620000, classe: "IMPOSTE" },
  ],
};

/* ============================================================
   ai/prompts.js — schema detection + format-specific rules per CE
   ============================================================ */

export const NI_SEZIONI_CE = {
  1: {
    titolo: "Ricavi e valore della produzione",
    color: "bg-teal-50 border-teal-200 text-teal-900",
    badge: "bg-teal-600",
  },
  2: {
    titolo: "Costi della produzione e personale",
    color: "bg-amber-50 border-amber-200 text-amber-900",
    badge: "bg-amber-600",
  },
  3: {
    titolo: "Gestione finanziaria, rettifiche e non ricorrenti",
    color: "bg-indigo-50 border-indigo-200 text-indigo-900",
    badge: "bg-indigo-600",
  },
  4: {
    titolo: "Imposte, risultato e altre informazioni rilevanti",
    color: "bg-rose-50 border-rose-200 text-rose-900",
    badge: "bg-rose-600",
  },
};

export const NI_CE_FILTER_PROMPT = `Sei un analista di bilancio esperto. Ricevi il testo di una NOTA INTEGRATIVA e devi estrarre esclusivamente le informazioni utili all'analisi del CONTO ECONOMICO, organizzate in QUATTRO SEZIONI TEMATICHE. Ogni informazione estratta deve appartenere a UNA sola sezione.

SEZIONE 1 — RICAVI E VALORE DELLA PRODUZIONE. Cerca e estrai:
- composizione dei ricavi per categoria, linea di business, area geografica, canale;
- criteri di riconoscimento ricavi (OIC 15 / IFRS 15), contratti pluriennali, lavori in corso su ordinazione, percentuale di completamento;
- natura delle variazioni di rimanenze di prodotti finiti/WIP;
- contributi in conto esercizio o in conto capitale (di competenza);
- ricavi non ricorrenti o non caratteristici nascosti tra i ricavi ordinari (es. rimborsi assicurativi, indennizzi, sopravvenienze attive imputate a A5).

SEZIONE 2 — COSTI DELLA PRODUZIONE E PERSONALE. Cerca e estrai:
- dettaglio dei costi per servizi (consulenze, provvigioni, manutenzioni, trasporti) quando aggregati in bilancio in un'unica voce;
- costo del personale: numero medio dipendenti, costo medio pro-capite, piani di incentivazione/stock option, componente TFR;
- Estrai sempre l'importo esatto della quota di accantonamento TFR di competenza dell'esercizio, separandola dal costo totale del personale;
- aliquote e criteri di ammortamento, eventuali cambi di stima che impattano la comparabilità anno-su-anno;
- svalutazioni di crediti e la loro adeguatezza;
- costi capitalizzati (R&S, impianto e ampliamento, pubblicità): natura, importo e congruità;
- se lo schema del CE è "costo del venduto": cerca qui la disclosure per natura richiesta da IAS 1.104 (personale, ammortamenti, materie), INDISPENSABILE per calcolare valore aggiunto ed EBITDA quando il prospetto è per funzione.

SEZIONE 3 — GESTIONE FINANZIARIA, RETTIFICHE E COMPONENTI NON RICORRENTI. Cerca e estrai:
- dettaglio di proventi/oneri finanziari (interessi per controparte, differenze cambio realizzate e da valutazione);
- rettifiche di valore di attività finanziarie (svalutazioni/rivalutazioni di partecipazioni, con motivazione, es. esito di impairment test);
- componenti straordinarie/non ricorrenti: plus/minusvalenze da cessioni di cespiti o rami d'azienda, sopravvenienze, cause legali concluse con effetto a conto economico;
- proventi/oneri verso parti correlate (se rilevanti anche a conto economico).

SEZIONE 4 — IMPOSTE, RISULTATO E ALTRE INFORMAZIONI RILEVANTI. Cerca e estrai:
- imposte correnti, differite e anticipate; riconciliazione aliquota effettiva vs nominale, se esposta;
- destinazione proposta del risultato d'esercizio;
- impegni, garanzie, contenziosi con impatto reddituale prospettico (accantonamenti futuri attesi);
- eventi successivi alla chiusura con impatto sul conto economico;
- eventuali informazioni sulla continuità aziendale (going concern) che condizionano la lettura della redditività.

IGNORA sempre (non estrarre mai): criteri di valutazione generici già coperti dall'analisi dello SP, commento discorsivo privo di importi, informativa non quantitativa sulla governance.

Per OGNI informazione estratta produci un oggetto con esattamente questi campi:
- "sezione": intero 1, 2, 3 o 4
- "tema": etichetta breve, 2-5 parole (es. "Composizione ricavi", "IAS 1.104 costi per natura", "Impairment goodwill")
- "contenuto": paragrafo sintetico con i numeri e i fatti rilevanti (una frase densa, non copia integrale del testo)
- "pagina": numero di pagina, come intero, se deducibile dal documento; altrimenti ometti il campo

Oltre agli estratti, produci DUE elenchi aggiuntivi per la NORMALIZZAZIONE DEL REDDITO (Earnings Power), fondamentali dopo l'abolizione della macroclasse E (D.Lgs. 139/2015) che ha "sparpagliato" le componenti straordinarie nelle voci ordinarie.

RETTIFICHE DI NORMALIZZAZIONE ("rettifiche") — individua riga per riga le poste da stornare dalla gestione corrente:
- tipo "special_item": componenti straordinarie/non ricorrenti annidate nelle voci ordinarie: plusvalenze straordinarie e sopravvenienze attive in A5 (Altri ricavi), svalutazioni delle immobilizzazioni in B10c, minusvalenze straordinarie e sopravvenienze passive in B14 (Oneri diversi), proventi da partecipazioni in C15, minusvalenze di natura finanziaria in C17, risultati di Attività Operative Cessate (Discontinued Operations) da separare integralmente dal reddito corrente.
- tipo "extra_gestione": poste da contabilità creativa (window dressing) architettate dal management: plusvalenze da rivalutazione imputate a CE anziché a Patrimonio Netto, rinunce a crediti da parte dei soci registrate come insussistenze attive (in realtà versamenti di capitale), accantonamenti fasulli creati per nascondere utili o differire perdite.
- tipo "capex_item": assegna questo tipo ESCLUSIVAMENTE alle plusvalenze e minusvalenze derivanti dall'alienazione di immobilizzazioni (materiali, immateriali o finanziarie). È vitale perché nel Rendiconto Finanziario tali componenti dovranno essere neutralizzate all'interno del calcolo del CAPEX (flusso degli investimenti) e NON nella gestione operativa: non usare "special_item" per queste poste, ma "capex_item".
Per OGNI rettifica produci: {"descrizione":"...","importo":N,"classeOrigine":"ALTRI_RICAVI","tipo":"special_item","motivazione":"...","pagina":N}
Convenzione di segno per "importo": POSITIVO se provento (gonfia il risultato corrente), NEGATIVO se onere (lo deprime). "classeOrigine" è la classe in cui la posta è oggi annidata, una tra: RICAVI, ALTRI_RICAVI, VAR_RIM_PF, LAVORI_INTERNI, ACQUISTI, SERVIZI, GODIMENTO, PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, ONERI_DIVERSI, PROVENTI_FIN, ONERI_FIN, PROVENTI_ACCESSORI, ONERI_ACCESSORI. Riporta gli importi solo se quantificati nella nota; non inventare importi.

RIALLOCAZIONI PER NATURA ("riallocazioni") — REGOLA OBBLIGATORIA SE IL CE È PER FUNZIONE (US GAAP o IFRS cost of sales): DEVI TASSATIVAMENTE cercare nella nota integrativa la scomposizione per natura dei costi (in particolare gli Ammortamenti/Depreciation e il Costo del Personale). Senza questi dati non si può calcolare l'EBITDA. Costruisci le coppie di riallocazione per spostare questi importi dalle macro-voci funzionali (es. ACQUISTI o SERVIZI) alle classi per natura di arrivo (una tra PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, GODIMENTO, ONERI_FIN). Per ogni componente per natura quantificata in nota (costo del personale, ammortamenti PP&E e intangibili, svalutazioni operative, accantonamenti, componenti IFRS 16):
- "classeOrigine": la classe FUNZIONALE in cui il costo è oggi annidato nel CE estratto (tipicamente ACQUISTI se la voce funzionale è stata mappata dal cost of sales, SERVIZI se da SG&A o da R&D spesati, ONERI_DIVERSI se da other expenses);
- "classeDestinazione": la classe PER NATURA di arrivo, una tra PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, GODIMENTO, ONERI_FIN (es. interest expense su lease liability IFRS 16).
Per OGNI riallocazione produci: {"descrizione":"Costo del personale da cost of sales","importo":N,"classeOrigine":"ACQUISTI","classeDestinazione":"PERSONALE","motivazione":"Disclosure per natura IAS 1.104","pagina":N}
Convenzioni: "importo" SEMPRE POSITIVO (ammontare di costo spostato dalla funzione alla natura). ATTENZIONE AL DOPPIO CONTEGGIO: (a) se la nota espone il personale al lordo delle quote capitalizzate, rialloca solo la componente spesata quando distinguibile, altrimenti segnala il lordo in "motivazione"; (b) non riallocare ammortamenti già esposti come riga separata nel prospetto; (c) l'ammortamento dei costi di sviluppo capitalizzati incluso in R&D va riallocato da SERVIZI (o dalla classe che ospita R&D) ad AMMORTAMENTI, non contato due volte; (d) se la nota non ripartisce un costo per natura tra le funzioni, imputa l'intero importo alla funzione prevalente e dichiaralo in "motivazione". Se il CE è già per natura, restituisci "riallocazioni" come lista vuota.
- ⚠ REGOLA RIGIDA CAPTIVE FINANCE: Nelle società automobilistiche (es. Ferrari), cerca SEMPRE gli oneri finanziari della divisione finanziaria inclusi nel 'Cost of sales' o in altre voci operative. Quando li trovi, inseriscili TASSATIVAMENTE nell'array "riallocazioni" (con classeDestinazione: "ONERI_FIN") e MAI nell'array "rettifiche". Non sono componenti straordinari, ma oneri finanziari spostati dalla gestione caratteristica a quella finanziaria.

RED FLAGS ("redFlags") — segnala i campanelli d'allarme di earnings management rilevabili dalla nota:
- "capitalizzazione": capitalizzazione aggressiva di costi operativi (sviluppo software interno, spese di marketing) tra immobilizzazioni immateriali o lavori in economia per gonfiare EBITDA e utile;
- "channel_stuffing": crediti verso clienti in crescita molto più rapida del fatturato, dilazioni anomale, vendite forzate ai distributori a fine anno;
- "big_bath": svalutazioni catastrofiche concentrate in un unico esercizio (magazzino, crediti, cespiti), spesso in concomitanza con un cambio di vertice manageriale;
- "altro": ogni altro indizio (politiche di magazzino aggressive, accantonamenti anomali, operazioni con parti correlate opache).
Per OGNI red flag produci: {"flag":"capitalizzazione","evidenza":"fatto concreto con importi","gravita":"alta","pagina":N} con "gravita" tra "alta", "media", "bassa".

CHANNEL STUFFING — INDICATORE QUANTITATIVO ("channelStuffing"). Cerca nello Stato Patrimoniale e nel Conto Economico (o nelle relative note di dettaglio) i tre dati che servono al calcolo del rapporto Δ crediti / Δ fatturato:
- "creditiClientiCorrente": saldo dei crediti verso clienti (netto fondo svalutazione) alla data di chiusura dell'esercizio in analisi;
- "creditiClientiPrecedente": saldo dei crediti verso clienti alla data di chiusura dell'esercizio precedente (colonna comparativa dello Stato Patrimoniale);
- "fatturatoPrecedente": ricavi delle vendite e prestazioni dell'esercizio precedente (colonna comparativa del Conto Economico o disclosure sui ricavi);
- "pagina": numero di pagina da cui è tratto il dato; se le fonti sono su pagine diverse, cita la principale (SP crediti).
Riporta gli importi in MILIONI, come tutti gli altri dati (vedi SCALA DEGLI IMPORTI). Se un dato non è deducibile con certezza, omettilo. Se nessuno dei tre è disponibile, ometti l'intero oggetto "channelStuffing".

ALIQUOTA FISCALE NOMINALE ("aliquotaNominale"). Nella nota sulle imposte cerca l'aliquota teorica che la società dichiara di applicare: di norma è il punto di partenza della tabella di riconciliazione tra onere fiscale teorico ed effettivo (es. «IRES 24% + IRAP 3,9%», «U.S. federal statutory rate 21%», «Dutch statutory tax rate 25.8%», «aliquota teorica 27,9%»). Formato:
{"valore": 27.9, "componenti": "IRES 24% + IRAP 3,9%", "pagina": N, "citazione": "frase del documento, tradotta fedelmente in italiano se in altra lingua"}
"valore" è la percentuale complessiva dichiarata (27.9, non 0.279) e non va mai riscalato. Riporta solo un'aliquota DICHIARATA nel documento: non usare l'aliquota effettiva (imposte ÷ utile) e non dedurla dalla normativa. Se la nota non la dichiara, ometti l'oggetto "aliquotaNominale".

Rispondi ESCLUSIVAMENTE con JSON valido, senza testo prima o dopo e senza backtick:
{"estratti":[{"sezione":1,"tema":"Composizione ricavi","contenuto":"Ricavi 2025 …","pagina":22}],"rettifiche":[{"descrizione":"Plusvalenza cessione capannone","importo":1200,"classeOrigine":"ALTRI_RICAVI","tipo":"special_item","motivazione":"Cessione una tantum","pagina":31}],"riallocazioni":[{"descrizione":"Costo del personale da cost of sales","importo":450000,"classeOrigine":"ACQUISTI","classeDestinazione":"PERSONALE","motivazione":"Disclosure per natura IAS 1.104","pagina":238}],"redFlags":[{"flag":"capitalizzazione","evidenza":"Capitalizzati 800 di costi di sviluppo software interno","gravita":"media","pagina":18}],"channelStuffing":{"creditiClientiCorrente":1450,"creditiClientiPrecedente":1120,"fatturatoPrecedente":6800,"pagina":45},"aliquotaNominale":{"valore":27.9,"componenti":"IRES 24% + IRAP 3,9%","pagina":52,"citazione":"L'aliquota teorica applicabile è pari al 27,9% (IRES 24% e IRAP 3,9%)."}}`;

/* ---- Variante T-1 della Nota Integrativa ----
   Stesse regole di estrazione, ma l'IA deve isolare esclusivamente le
   informazioni riferite all'esercizio PRECEDENTE (colonna comparativa). ---- */
export const NI_CE_FILTER_PROMPT_PREC = `${NI_CE_FILTER_PROMPT}

⚠⚠ ESERCIZIO DI RIFERIMENTO — ANNO PRECEDENTE (T-1). Sovrascrive ogni indicazione precedente sull'esercizio:
- Estrai ESCLUSIVAMENTE dati, importi, rettifiche, riallocazioni e red flag riferiti all'ANNO PRECEDENTE (la colonna comparativa, es. 2024). Non mescolarli con l'anno corrente.
- Le note integrative espongono quasi sempre tabelle a due colonne (esercizio corrente / esercizio precedente): leggi SEMPRE la colonna del comparativo, verificando l'intestazione con la data di chiusura più vecchia.
- Quando la nota commenta una variazione ("il costo del personale passa da X a Y"), il valore dell'anno PRECEDENTE è X (il valore di partenza), non Y.
- Le rettifiche di normalizzazione e le riallocazioni per natura devono riguardare componenti dell'esercizio precedente: se una posta straordinaria è dichiarata come avvenuta nell'anno corrente, NON estrarla.
- Se per una voce non esiste il dato comparativo, OMETTILA: non riportare mai l'importo dell'anno corrente al posto di quello precedente.
- Per "channelStuffing" riporta i crediti verso clienti e il fatturato riferiti all'esercizio PRECEDENTE e a quello ancora antecedente (T-2), coerentemente con lo slittamento di un anno.`;

/* ---- Variante «documento autonomo» della NI T-1 (Modalità Singolo Anno) ----
   Quando la serie storica si costruisce a mano, un anno per file, la Nota
   Integrativa destinata agli slot T-1 è quella dell'esercizio principale di
   quel documento: le istruzioni sulla «colonna comparativa» andrebbero a
   pescare l'anno sbagliato (T-2) e vanno quindi ribaltate. ---- */
export const NI_CE_FILTER_PROMPT_PREC_AUTONOMO = `${NI_CE_FILTER_PROMPT}

⚠⚠ ESERCIZIO DI RIFERIMENTO — DOCUMENTO AUTONOMO (Modalità Singolo Anno). Sovrascrive ogni indicazione precedente sull'esercizio:
- Il documento che stai analizzando è la Nota Integrativa a sé stante di un esercizio già chiuso, NON la nota dell'anno corrente.
- Estrai dati, importi, rettifiche, riallocazioni e red flag dell'esercizio PRINCIPALE di questo documento, cioè quello a cui la nota si riferisce: nelle tabelle a due colonne è la PRIMA colonna (l'esercizio di chiusura), non il comparativo.
- Ignora tassativamente la colonna comparativa e i dati riferiti ad altri esercizi presenti in questo stesso documento.
- Quando la nota commenta una variazione ("il costo del personale passa da X a Y"), il valore da estrarre è quello di ARRIVO Y, riferito all'esercizio della nota.
- Per "channelStuffing" riporta i crediti verso clienti e il fatturato dell'esercizio della nota e di quello immediatamente precedente.`;

/* ============================================================
   RELAZIONE SULLA GESTIONE (RG) — schema a 4 sezioni tematiche
   Documento discorsivo ex art. 2428 c.c.: commento del management su
   andamento, mercato, dinamiche di costo, eventi straordinari e
   investimenti. Serve a NORMALIZZARE la marginalità ordinaria (special
   items) e ad arricchire la lettura qualitativa del CE riclassificato.
   ============================================================ */

export const RG_SEZIONI_CE = {
  1: {
    titolo: "Andamento dei ricavi e quote di mercato",
    color: "bg-teal-50 border-teal-200 text-teal-900",
    badge: "bg-teal-600",
  },
  2: {
    titolo: "Dinamiche dei costi operativi (rincari, inflazione)",
    color: "bg-amber-50 border-amber-200 text-amber-900",
    badge: "bg-amber-600",
  },
  3: {
    titolo: "Eventi straordinari e ristrutturazioni",
    color: "bg-indigo-50 border-indigo-200 text-indigo-900",
    badge: "bg-indigo-600",
  },
  4: {
    titolo: "Investimenti strategici e R&S",
    color: "bg-rose-50 border-rose-200 text-rose-900",
    badge: "bg-rose-600",
  },
};

export const RG_CE_FILTER_PROMPT = `Sei un analista di bilancio esperto. Ricevi il testo di una RELAZIONE SULLA GESTIONE (art. 2428 c.c. / Management Commentary) e devi estrarre esclusivamente le informazioni utili all'analisi del CONTO ECONOMICO, organizzate in QUATTRO SEZIONI TEMATICHE. Ogni informazione estratta deve appartenere a UNA sola sezione. La Relazione sulla Gestione è un documento DISCORSIVO: il tuo compito è tradurre il commento del management in fatti densi e, dove possibile, quantificati.

SEZIONE 1 — ANDAMENTO DEI RICAVI E QUOTE DI MERCATO. Cerca e estrai:
- crescita/flessione del fatturato commentata dal management (variazioni % anno su anno, per prodotto, area geografica, canale, segmento);
- quote di mercato, posizionamento competitivo, andamento della domanda e del settore;
- portafoglio ordini, backlog, contratti pluriennali acquisiti, pipeline commerciale;
- effetti prezzo/volume/mix dichiarati; impatto dei tassi di cambio sui ricavi;
- ricavi non ricorrenti o eccezionali segnalati come tali dal management.

SEZIONE 2 — DINAMICHE DEI COSTI OPERATIVI. Cerca e estrai:
- rincari delle materie prime, dell'energia e dei noli; pressioni inflazionistiche sui costi;
- dinamica del costo del lavoro (rinnovi contrattuali, organico, produttività);
- efficienze, risparmi di costo, programmi di cost cutting e loro impatto atteso a CE;
- variazioni dei margini industriali/lordi commentate; leva operativa;
- tensioni sulla catena di fornitura con effetto reddituale.

SEZIONE 3 — EVENTI STRAORDINARI E RISTRUTTURAZIONI (chiave per NORMALIZZARE l'EBITDA). Cerca e estrai:
- oneri/proventi di ristrutturazione, riorganizzazione, chiusura di siti, esuberi, incentivi all'esodo;
- plus/minusvalenze da cessione di rami d'azienda, cespiti o partecipazioni; impairment una tantum;
- contenziosi, transazioni legali, indennizzi assicurativi, sopravvenienze eccezionali con impatto a CE;
- effetti una tantum di eventi esogeni (pandemie, calamità, sanzioni, shock geopolitici) isolati dal management;
- ogni componente che il management stesso qualifica come non ricorrente / adjusted / special item.

SEZIONE 4 — INVESTIMENTI STRATEGICI E R&S. Cerca e estrai:
- investimenti (CAPEX) programmati o realizzati, ampliamenti di capacità, nuovi impianti;
- spesa in Ricerca & Sviluppo, quota capitalizzata vs spesata, progetti di innovazione;
- acquisizioni, joint venture, partnership strategiche con effetto prospettico sui margini;
- digitalizzazione, transizione ecologica, piani industriali pluriennali e target dichiarati.

IGNORA sempre (non estrarre mai): dichiarazioni di intenti generiche prive di contenuto quantitativo o fattuale, ripetizioni di dati già nel prospetto senza commento aggiuntivo, informativa su governance e organi sociali priva di impatto reddituale.

Per OGNI informazione estratta produci un oggetto con esattamente questi campi:
- "sezione": intero 1, 2, 3 o 4
- "tema": etichetta breve, 2-5 parole (es. "Crescita ricavi EMEA", "Rincaro energia", "Oneri ristrutturazione", "CAPEX nuovo stabilimento")
- "contenuto": paragrafo sintetico con i numeri e i fatti rilevanti (una frase densa, non copia integrale del testo)
- "pagina": numero di pagina, come intero, se deducibile dal documento; altrimenti ometti il campo

Oltre agli estratti, produci DUE elenchi aggiuntivi.

RETTIFICHE DI NORMALIZZAZIONE ("rettifiche") — di tipo "special_item", con gli STESSI criteri della Nota Integrativa: individua le componenti straordinarie/non ricorrenti che il management commenta nella Relazione e che vanno stornate dalla gestione corrente per ottenere l'Earnings Power (EBITDA/EBIT normalizzati). Rientrano qui: oneri e proventi di ristrutturazione, plus/minusvalenze e impairment una tantum, indennizzi/sopravvenienze eccezionali, effetti isolati di eventi esogeni.
Per OGNI rettifica produci: {"descrizione":"...","importo":N,"classeOrigine":"ONERI_DIVERSI","tipo":"special_item","motivazione":"...","pagina":N}
Convenzione di segno per "importo": POSITIVO se provento (gonfia il risultato corrente), NEGATIVO se onere (lo deprime). "classeOrigine" è la classe in cui la posta è oggi annidata, una tra: RICAVI, ALTRI_RICAVI, VAR_RIM_PF, LAVORI_INTERNI, ACQUISTI, SERVIZI, GODIMENTO, PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, ONERI_DIVERSI, PROVENTI_FIN, ONERI_FIN, PROVENTI_ACCESSORI, ONERI_ACCESSORI. Riporta gli importi SOLO se quantificati nella Relazione; non inventare importi.

RED FLAGS ("redFlags") — segnala i campanelli d'allarme di earnings management deducibili dal tono e dai contenuti della Relazione:
- "capitalizzazione": enfasi su costi capitalizzati (sviluppo, marketing) per sostenere l'EBITDA;
- "channel_stuffing": crescita dei ricavi trainata da vendite forzate/dilazioni a fine periodo;
- "big_bath": concentrazione di svalutazioni/oneri in un unico esercizio (spesso con cambio di vertice);
- "altro": ogni altra dissonanza tra narrazione ottimistica e sostanza dei numeri.
Per OGNI red flag produci: {"flag":"capitalizzazione","evidenza":"fatto concreto con importi","gravita":"alta","pagina":N} con "gravita" tra "alta", "media", "bassa".

Rispondi ESCLUSIVAMENTE con JSON valido, senza testo prima o dopo e senza backtick:
{"estratti":[{"sezione":1,"tema":"Crescita ricavi","contenuto":"Ricavi +12% a …","pagina":4}],"rettifiche":[{"descrizione":"Oneri di ristrutturazione stabilimento","importo":-3500,"classeOrigine":"ONERI_DIVERSI","tipo":"special_item","motivazione":"Piano di riorganizzazione una tantum descritto in Relazione","pagina":7}],"redFlags":[{"flag":"capitalizzazione","evidenza":"Enfasi su 900 di sviluppo capitalizzato","gravita":"media","pagina":9}]}`;

/* ---- Variante T-1 della Relazione sulla Gestione ----
   Il management commenta di regola l'esercizio chiuso raffrontandolo al
   precedente: qui l'IA deve isolare i fatti dell'anno PRECEDENTE. ---- */
export const RG_CE_FILTER_PROMPT_PREC = `${RG_CE_FILTER_PROMPT}

⚠⚠ ESERCIZIO DI RIFERIMENTO — ANNO PRECEDENTE (T-1). Sovrascrive ogni indicazione precedente sull'esercizio:
- Estrai ESCLUSIVAMENTE fatti, importi, special items e red flag riferiti all'ANNO PRECEDENTE (es. 2024). Non mescolarli con l'anno corrente.
- Quando il management raffronta due esercizi ("i ricavi salgono da X a Y", "rispetto al 2024"), il dato dell'anno PRECEDENTE è il termine di paragone X, non il valore di arrivo Y.
- Gli eventi straordinari e le ristrutturazioni vanno estratti solo se COMPETONO all'esercizio precedente: escludi quelli dichiarati come avvenuti nell'anno corrente o come eventi successivi alla chiusura.
- Se la Relazione riguarda un solo esercizio e non contiene raffronti quantificati con il precedente, restituisci liste vuote anziché riportare i dati dell'anno corrente.`;

/* ---- Variante «documento autonomo» della RG T-1 (Modalità Singolo Anno) ---- */
export const RG_CE_FILTER_PROMPT_PREC_AUTONOMO = `${RG_CE_FILTER_PROMPT}

⚠⚠ ESERCIZIO DI RIFERIMENTO — DOCUMENTO AUTONOMO (Modalità Singolo Anno). Sovrascrive ogni indicazione precedente sull'esercizio:
- Il documento che stai analizzando è la Relazione sulla Gestione a sé stante di un esercizio già chiuso, NON la relazione dell'anno corrente.
- Estrai fatti, importi, special items e red flag dell'esercizio a cui la relazione si riferisce (l'esercizio di chiusura del documento).
- Quando il management raffronta due esercizi ("i ricavi salgono da X a Y"), il dato da estrarre è il valore di ARRIVO Y, non il termine di paragone X.
- Gli eventi straordinari e le ristrutturazioni vanno estratti se COMPETONO all'esercizio di chiusura del documento; escludi quelli presentati come eventi successivi alla chiusura.`;

export const CE_SCHEMA_DETECT_PROMPT = `Sei un esperto di principi contabili nazionali e internazionali. Nel documento è presente un Conto Economico / Income Statement.
Identifica: (1) lo SCHEMA CONTABILE — stessi criteri già noti: art. 2424/2425 c.c. e terminologia italiana = OIC; distinzione current/non-current altrove nel bilancio, terminologia IASB = IAS/IFRS; terminologia e ordine tipici USA = US GAAP; (2) il FORMATO ESPOSITIVO del conto economico stesso, osservando le voci di dettaglio presenti.
Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza backtick:
{"schema":"oic","formato":"valore_aggiunto","valuta":"EUR","unita":"unità","indizi":"1 frase sui segnali che hanno permesso il riconoscimento"}
Regole: "schema" può essere SOLO "oic", "ifrs", "us_gaap" oppure "altro"; "formato" può essere SOLO "valore_aggiunto" (forma scalare civilistica italiana, macroclassi A-B-C-D), "per_natura" (costi raggruppati per natura ma non nella forma scalare OIC, es. IFRS by nature), "costo_venduto" (Revenue/Cost of sales/Gross profit, IFRS by function o US GAAP multi-step) oppure "single_step" (unico blocco ricavi meno costi, US GAAP); "unita" come nello SP. Rispondi SOLO con il JSON.`;

export const SCHEMI_CE = {
  oic_valore_aggiunto: {
    label: "OIC · forma scalare a valore della produzione e valore aggiunto (art. 2425 c.c.)",
    regole: [
      "A) Valore della produzione: A1 ricavi, A2 variazione rimanenze prodotti (segno + se incremento), A3 lavori interni, A4 incrementi imm. per lavori interni, A5 altri ricavi (attenzione: A5 include poste che negli schemi pre-2015 erano straordinarie — segnalale come NON_CORRENTE quando la natura è chiaramente non ricorrente).",
      "B) Costi della produzione: B6 acquisti materie, B7 servizi, B8 godimento beni di terzi (leasing operativi restano qui), B9 personale (incl. TFR), B10 ammortamenti e svalutazioni, B11 variazione rimanenze materie (segno inverso ad A2), B12 accantonamenti per rischi, B13 altri accantonamenti, B14 oneri diversi di gestione (attenzione: B14 può contenere poste ex-straordinarie da segnalare come NON_CORRENTE).",
      "C) Proventi e oneri finanziari: C15 proventi da partecipazioni → gestione accessoria; C16 altri proventi finanziari → PROVENTI_FIN; C17 interessi e altri oneri finanziari → ONERI_FIN; C17-bis utili/perdite su cambi → PROVENTI_FIN/ONERI_FIN.",
      "D) Rettifiche di valore di attività finanziarie: rivalutazioni/svalutazioni di partecipazioni e titoli → gestione accessoria.",
      "La macroclasse E (proventi/oneri straordinari) è ABOLITA dal D.Lgs. 139/2015: cerca poste non ricorrenti dentro A5 e B14 e riclassifica come NON_CORRENTE.",
    ],
  },
  ifrs_per_natura: {
    label: "IFRS · by nature (IAS 1.99, costi per natura)",
    regole: [
      "Revenue → RICAVI; other income → ALTRI_RICAVI o PROVENTI_ACCESSORI a seconda della natura (fair value gain su investment property = accessoria).",
      "Changes in inventories of finished goods and WIP → VAR_RIM_PF; work performed and capitalised → LAVORI_INTERNI.",
      "Raw materials and consumables used → ACQUISTI netti delle variazioni materie (spesso già presentati al netto); se separati, VAR_RIM_MATERIE va indicata a parte.",
      "Employee benefits expense → PERSONALE; depreciation and amortisation → AMMORTAMENTI; impairment losses → AMMORTAMENTI se operative, gestione accessoria se su asset finanziari.",
      "IFRS 16: gli affitti/leasing NON restano tra i costi per godimento — sono scomposti in ammortamento del right-of-use asset (→ AMMORTAMENTI) e interessi passivi sulla lease liability (→ ONERI_FIN). GODIMENTO resta per short-term/low-value lease.",
      "Finance income / finance costs → PROVENTI_FIN / ONERI_FIN; share of profit of equity-accounted investees → gestione accessoria.",
      "Voci etichettate 'non-recurring', 'restructuring', 'impairment (one-off)' → NON_CORRENTE.",
    ],
  },
  ifrs_costo_venduto: {
    label: "IFRS · by function / costo del venduto (IAS 1.103)",
    regole: [
      "Il prospetto in faccia mostra Revenue, Cost of sales, Gross profit, Selling costs, Administrative expenses, R&D, Other operating income/expenses.",
      "IAS 1.104 OBBLIGA la disclosure in nota della ripartizione dei costi per natura (personale, ammortamenti, materie): usa PRIORITARIAMENTE la nota integrativa per estrarre le voci per natura (ACQUISTI, SERVIZI, PERSONALE, AMMORTAMENTI, ecc.) — è il punto di aggancio naturale con lo schema a valore aggiunto.",
      "Se la nota per natura NON è disponibile, estrai le voci per funzione così come sono e segna con nome esplicito 'Costo del venduto', 'Costi commerciali', ecc., mappandole tutte su ACQUISTI/SERVIZI/PERSONALE con la migliore stima possibile; segnala l'incertezza nel campo indizi.",
      "IFRS 16, non ricorrenti, equity-accounted investees: stesse regole del formato per natura.",
    ],
  },
  us_gaap_costo_venduto: {
    label: "US GAAP · multi-step income statement",
    regole: [
      "Sequenza tipica: Net revenues → Cost of goods sold (COGS) → Gross profit → S&M, G&A, R&D → Operating income → Other income/expense → Interest expense → Pre-tax income → Income tax → Net income.",
      "COGS e operating expenses vanno mappati su ACQUISTI/SERVIZI/PERSONALE/AMMORTAMENTI usando la nota (spesso presente come 'Nature of expenses' o 'Depreciation and amortisation' voci disclosed a parte).",
      "Restructuring charges, impairment of goodwill, gain/loss on sale of business → NON_CORRENTE.",
      "Interest income / interest expense → PROVENTI_FIN / ONERI_FIN; equity in earnings of affiliates → gestione accessoria.",
    ],
  },
  us_gaap_single_step: {
    label: "US GAAP · single-step income statement",
    regole: [
      "Tutti i ricavi in un blocco unico, tutti i costi in un blocco unico, un solo margine (Income before taxes).",
      "La separazione tra gestione caratteristica, accessoria e finanziaria è possibile SOLO dalla nota integrativa: fai leva sui dettagli per natura là dove disponibili.",
      "Se la nota non è sufficiente, segnala l'incertezza nel campo indizi e lascia più voci come DA_CLASSIFICARE anziché forzare la mappatura.",
    ],
  },
};

/* ============================================================================
   SISTEMA AUTO-APPRENDENTE — PROMPT DI SISTEMA PERSISTENTI (Tab 13 · Audit)
   ============================================================================
   L'Audit del Tab 13 non si limita più a produrre una lista di rilievi: ogni
   anomalia porta con sé (a) la correzione applicabile con un clic e (b) la
   REGOLA generalizzabile da memorizzare. Le regole apprese vivono nel
   localStorage del browser e vengono ri-iniettate in TUTTE le estrazioni
   successive (buildCePrompt e MASTER_PROMPT), così l'IA non ripete l'errore
   nemmeno su bilanci diversi.
   ========================================================================= */

const CE_PROMPTS_KEY = "ce_system_prompts";

/* Regole INVIOLABILI di fabbrica: nascono dalle tre allucinazioni ricorrenti
   dell'IA sul Conto Economico (inquinamento da Rendiconto/OCI, duplicazione
   delle voci, mappatura forzata natura↔funzione). Non sono "apprese": sono
   cablate nel prompt e NON vengono rimosse dal pulsante «Reset Regole IA»,
   che azzera invece solo ciò che l'audit ha imparato sul campo. */
const REGOLE_CE_INVIOLABILI = [
  "ESCLUDI TASSATIVAMENTE le voci del Rendiconto Finanziario (es. 'Total cash flows...', 'Proceeds from...', 'Change in receivables/inventory...', 'Net cash provided by...') e le voci del Prospetto OCI / Comprehensive Income (es. 'Items that will not be reclassified...', 'Cash flow hedging', 'Currency translation differences'). L'estrazione del Conto Economico deve fermarsi rigorosamente alla voce Utile Netto ('Net profit' o 'Net income').",
  "DIVIETO DI DUPLICAZIONE: ogni riga del Conto Economico deve essere estratta una e una sola volta. Non sdoppiare mai una voce (es. 'Research and development costs') in più classi durante l'estrazione principale, e non estrarre mai insieme un totale e i suoi dettagli.",
  "SE IL CE È A COSTO DEL VENDUTO (BY FUNCTION): non tentare di mappare forzatamente 'Cost of sales', 'SG&A' o 'R&D' su PERSONALE o AMMORTAMENTI. Assegna l'intera macro-voce alla classe prevalente (es. ACQUISTI per Cost of sales, SERVIZI per SG&A e R&D) e lascia che sia ESCLUSIVAMENTE l'analisi della Nota Integrativa (IAS 1.104) a generare le riallocazioni verso Personale e Ammortamenti.",
  "ESCLUDI I SUB-TOTALI E I TOTALI MATEMATICI: non estrarre MAI righe come 'Gross profit', 'Operating profit (EBIT)', 'Profit before taxes', 'Income tax' o 'Net profit'. Devi estrarre SOLO le voci elementari di costo e ricavo, altrimenti i calcoli verranno duplicati.",
];

/* Interruttore riutilizzato da tutti gli elenchi di rettifiche e riallocazioni,
   in entrambi gli esercizi. Sta a livello di modulo di proposito: definito
   dentro il componente sarebbe un tipo nuovo a ogni render e React lo
   rimonterebbe ogni volta. */
const InterruttoreAttiva = ({ attiva, onToggle, titolo }) => (
  <button
    onClick={onToggle}
    title={titolo || (attiva ? "Disattiva: la posta resta in elenco ma non incide sul prospetto" : "Riattiva la posta")}
    className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border transition-colors ${
      attiva
        ? "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100"
        : "bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200"
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${attiva ? "bg-teal-500" : "bg-slate-400"}`} />
    {attiva ? "Attiva" : "Sospesa"}
  </button>
);

const promptsDiDefaultCE = () => ({ regoleApprese: [] });

/* Lettura difensiva: storage disabilitato, JSON corrotto o struttura obsoleta
   dopo un aggiornamento fanno sempre ricadere sui default, mai in crash. */
const caricaSystemPrompts = () => {
  const base = promptsDiDefaultCE();
  try {
    if (typeof window === "undefined" || !window.localStorage) return base;
    const grezzo = window.localStorage.getItem(CE_PROMPTS_KEY);
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
      window.localStorage.setItem(CE_PROMPTS_KEY, JSON.stringify(p));
  } catch {
    /* quota esaurita o storage negato: la sessione corrente resta comunque valida */
  }
};

/* PURA: restituisce un NUOVO oggetto systemPrompts con la regola appesa,
   senza mutare quello ricevuto (compatibile con lo state immutabile React).
   Le regole già presenti alla lettera non vengono duplicate. */
function applicaRegolaAppresa(sp, sug) {
  const testo = String(sug?.nuovaRegola || "").trim();
  if (!testo) return sp;
  const gia = (sp.regoleApprese || []).some((r) => r.testo.trim() === testo);
  if (gia) return sp;
  return {
    ...sp,
    regoleApprese: [
      ...(sp.regoleApprese || []),
      { target: sug.target || "CLASSI_DOC", testo, quando: new Date().toLocaleString("it-IT") },
    ],
  };
}

/* Blocco di testo iniettato in coda a OGNI prompt di estrazione: regole di
   fabbrica + regole apprese dall'audit. È la memoria operativa del sistema. */
function bloccoRegoleCE(regoleApprese = []) {
  const apprese = (regoleApprese || [])
    .map((r) => (typeof r === "string" ? r : r && r.testo))
    .filter((t) => t && String(t).trim());
  const fisse = REGOLE_CE_INVIOLABILI.map((r, i) => `  ${i + 1}. ${r}`).join("\n");
  const bloccoApprese = apprese.length
    ? `\n\n⚠ REGOLE APPRESE DALL'AUDIT DA RISPETTARE TASSATIVAMENTE:\n${apprese
        .map((t, i) => `  ${i + 1}. ${String(t).trim()}`)
        .join("\n")}`
    : "";
  return `\n\n⚠ REGOLE INVIOLABILI DI ESTRAZIONE DEL CONTO ECONOMICO:\n${fisse}${bloccoApprese}`;
}

/* ---------- Tab 13 · Prompt dell'Audit (checklist del revisore) ---------- */
/* L'IA qui NON riclassifica: CONTROLLA il lavoro già svolto e restituisce
   anomalie ancorate all'id esatto della voce, con autoFix e regola da
   memorizzare. "ELIMINA" è una nuovaClasse speciale: significa che la voce
   non appartiene proprio al Conto Economico e va rimossa dal prospetto. */
const buildAuditPromptCE = ({ annoCorr, annoPrec, vociTxt, vociPrecTxt, schemaTxt, classiTxt, regoleTxt, datiTxt }) =>
  `Sei un REVISORE CONTABILE SENIOR incaricato di sottoporre a controllo di qualità una riclassificazione di CONTO ECONOMICO già eseguita da un altro analista (OIC, IAS/IFRS, US GAAP). Il tuo compito NON è riclassificare da zero: devi trovare gli ERRORI del lavoro esistente, spiegarli e indicare come correggerli.
${schemaTxt}
FORMATO NUMERICO: tutti gli importi che seguono sono numeri grezzi, con il punto come separatore decimale e NESSUN separatore delle migliaia.

VOCI DELL'ESERCIZIO CORRENTE ${annoCorr} (formato: [id] nome | importo | classe | asa):
${vociTxt}

VOCI DELL'ESERCIZIO PRECEDENTE ${annoPrec} (stesso formato):
${vociPrecTxt}

CLASSI AMMESSE:
${classiTxt}
${regoleTxt}

CONTESTO ANALITICO COMPLETO (aggregati, rettifiche, riallocazioni, delta economici e rilievi deterministici già prodotti dall'applicazione):
${datiTxt}

ESEGUI ORA, NELL'ORDINE, QUESTA CHECKLIST DEL REVISORE PER IL CONTO ECONOMICO:

1) INQUINAMENTO DA RENDICONTO FINANZIARIO E OCI — Individua le voci palesemente NON appartenenti al Conto Economico perché provenienti dal Rendiconto Finanziario (es. "Total cash flows...", "Proceeds from...", "Change in receivables", "Net cash provided by operating activities", "Capital expenditures") o dal prospetto Other Comprehensive Income / Comprehensive Income (es. "Items that will not be reclassified to profit or loss", "Cash flow hedging reserve", "Currency translation differences"). Il Conto Economico si ferma alla voce Utile Netto: tutto ciò che sta oltre è inquinamento. In questi casi la correzione NON è un cambio di classe ma l'eliminazione della voce: usa autoFix con "nuovaClasse": "ELIMINA".

2) DUPLICAZIONI — Segnala le voci di contenuto identico ripetute con id diversi nello stesso esercizio (caso tipico: un doppio "Research and development costs", oppure una macro-voce estratta sia come totale sia come dettaglio). Indica come anomalia il duplicato da rimuovere (NON l'occorrenza da tenere) e usa autoFix con "nuovaClasse": "ELIMINA". Attenzione: due voci con nome simile ma importo diverso e natura diversa NON sono duplicati.

3) COERENZA TRA GLI ANNI — La STESSA voce (o una voce di denominazione equivalente) presente in entrambi gli esercizi DEVE avere la STESSA classe e la STESSA asa, salvo un reale cambiamento di natura. Ogni disallineamento fra ${annoCorr} e ${annoPrec} è un errore: stabilisci quale dei due anni è classificato male e correggi QUELLO SOLTANTO, non entrambi.

4) NATURA CONTRO FUNZIONE — Se il Conto Economico è a costo del venduto (by function), voci come "Cost of sales", "Selling, general and administrative expenses" o "Research and development" NON devono mai risultare mappate forzatamente su PERSONALE o AMMORTAMENTI nell'estrazione primaria: quelle classi per natura devono essere alimentate ESCLUSIVAMENTE dalle riallocazioni della Nota Integrativa (IAS 1.104). Se trovi una macro-voce funzionale classificata per natura, correggila riportandola alla classe prevalente (ACQUISTI per il costo del venduto, SERVIZI per SG&A e R&D).

5) QUADRATURA DELLE RIALLOCAZIONI (IAS 1.104) — Gli storni devono essere negativi e le destinazioni positive; le destinazioni devono essere classi per natura (PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, GODIMENTO); nessuna classe di origine può essere stornata oltre il proprio saldo.

6) SEGNO DELLE RETTIFICHE DI NORMALIZZAZIONE — Regola inviolabile: onere/costo stornato produce importo NEGATIVO; provento stornato produce importo POSITIVO. Vale sia per gli special_item sia per le poste di extra-gestione.

7) TEST DEI DELTA ECONOMICI — Individua variazioni macroscopiche di Valore Aggiunto, EBITDA ed EBIT che non siano spiegabili da una reale dinamica aziendale ma siano il sintomo di uno spostamento arbitrario di classe fra ${annoCorr} e ${annoPrec}: risali alla voce che le genera e segnala QUELLA voce.

8) VOCI ORFANE — Segnala ogni voce rimasta in DA_CLASSIFICARE nei due esercizi e proponi la classe corretta desumibile dalla denominazione.

Restituisci ESCLUSIVAMENTE un JSON valido, senza testo prima o dopo e senza blocchi di codice:
{
 "esito": "superato",
 "messaggioGenerale": "Testo riassuntivo dell'esito complessivo del controllo, 2-4 frasi.",
 "anomalie": [
  {
   "idVoce": "id esatto della voce errata, copiato dalle parentesi quadre degli elenchi sopra",
   "esercizio": "corrente",
   "titoloErrore": "titolo breve del tipo di errore, es. Inquinamento da Rendiconto Finanziario",
   "spiegazioneErrore": "2-4 frasi: perché è un errore, quale punto della checklist viola e quale effetto produce su margini, aggregati o delta economici",
   "gravita": "grave",
   "controllo": 1,
   "autoFix": { "eseguibile": true, "nuovaClasse": "codice classe corretto oppure ELIMINA" },
   "promptUpdateSuggestion": { "target": "CLASSI_DOC", "nuovaRegola": "Regola operativa da aggiungere ai prompt di sistema affinché l'errore non si ripeta nelle estrazioni future." }
  }
 ]
}
Regole tassative sul formato:
- "esito" vale "superato" SOLO se non hai trovato alcuna anomalia (e allora "anomalie" è un array vuoto); altrimenti vale "errori".
- "idVoce" deve essere un id ESISTENTE copiato letteralmente dagli elenchi: non inventarlo e non usare il nome della voce. Se l'anomalia non è riconducibile a una voce specifica, ometti l'anomalia.
- "esercizio" vale "corrente" se l'id appartiene all'elenco ${annoCorr}, "precedente" se appartiene all'elenco ${annoPrec}.
- "gravita" vale "grave", "medio" o "info"; "controllo" è il numero (1-8) del punto della checklist violato.
- "autoFix.eseguibile" è true SOLO se la correzione consiste nel cambio di classe di quella singola voce oppure nella sua eliminazione. "nuovaClasse" deve essere uno dei codici classe ammessi elencati sopra, oppure la parola chiave speciale "ELIMINA" quando la voce non appartiene al Conto Economico o è un duplicato. Se invece la correzione richiede una scomposizione, una rettifica di importo o un intervento manuale, metti "eseguibile": false, ometti "nuovaClasse" e spiega nel testo cosa deve fare l'utente.
- "promptUpdateSuggestion.target" vale "CLASSI_DOC" se la regola riguarda la natura o la definizione delle classi, "SCHEMI" se riguarda una convenzione specifica del sistema contabile. "nuovaRegola" deve essere una frase imperativa, autoconclusiva e generalizzabile (NON riferita a questa singola azienda o a questo singolo importo), massimo 400 caratteri. Ometti l'intero campo se l'errore è un refuso irripetibile e non generalizzabile.
- Massimo 15 anomalie, ordinate per gravità decrescente. Non segnalare come errore una scelta semplicemente opinabile ma difendibile: solo violazioni effettive della checklist.
Rispondi SOLO con il JSON.`;

/* Sanificazione della risposta di audit — funzione PURA e testabile a parte.
   Tiene solo le anomalie ancorate a un id di voce realmente esistente e
   declassa ad "eseguibile: false" ogni autoFix che proponga una classe
   inesistente o identica a quella attuale. "ELIMINA" è sempre ammessa. */
function sanificaAnomalieCE(parsed, vociCorr, vociPrec) {
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
      const nuovaClasse = a?.autoFix?.nuovaClasse;
      const classeOk =
        nuovaClasse === "ELIMINA" || (!!CLASSI[nuovaClasse] && nuovaClasse !== voce.classe);
      const sug = a?.promptUpdateSuggestion;
      const sugOk =
        !!sug && typeof sug.nuovaRegola === "string" && sug.nuovaRegola.trim().length > 10;
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
        asaAttuale: voce.asa || null,
        importo: Number(voce.importo) || 0,
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

/* ---------- Estrattore IA: buildCePrompt (analogo a buildSpPrompt) ---------- */

function buildCePrompt(testoBilancio = null, schemaInfo = null, isPrec = false, modalitaSingoloAnno = false, annoSpecifico = "", regoleApprese = [], annoSpecificoPrec = "") {
  const chiaveSchema = schemaInfo
    ? `${schemaInfo.schema}_${schemaInfo.formato}`
    : null;
  const config = chiaveSchema && SCHEMI_CE[chiaveSchema];
  const bloccoRegole = config
    ? `\n\nSCHEMA GIA' RILEVATO: ${config.label}\nApplica queste regole di classificazione specifiche del formato:\n${config.regole.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}\n`
    : "";
  /* ---- Selettore di colonna: corrente (T) oppure comparativa (T-1) ----
     Il bilancio espone due colonne affiancate. Quando isPrec è true l'IA
     deve leggere ESCLUSIVAMENTE la colonna comparativa dell'esercizio
     precedente, senza contaminazioni con l'anno corrente.
     Eccezione — Modalità Singolo Anno: il T-1 non arriva più dalla colonna
     comparativa del bilancio corrente ma da un DOCUMENTO AUTONOMO (l'analisi
     manuale di una serie storica carica un bilancio per anno). Lì l'esercizio
     da leggere è la colonna PRINCIPALE del documento, non la comparativa:
     invertire l'istruzione è indispensabile, altrimenti l'IA restituirebbe
     l'anno sbagliato o una lista vuota. ---- */
  const annoPrecTarget = String(annoSpecificoPrec || "").trim();
  const bloccoEsercizio = !isPrec
    ? ""
    : modalitaSingoloAnno
    ? `\n\n⚠⚠ ESERCIZIO — DOCUMENTO AUTONOMO DELL'ANNO PRECEDENTE (Modalità Singolo Anno): il documento che stai analizzando è il bilancio a sé stante dell'esercizio${annoPrecTarget ? ` ${annoPrecTarget}` : " precedente"}, NON il bilancio dell'anno corrente.
ISTRUZIONI TASSATIVE SULLA COLONNA:
- Estrai i dati dell'esercizio${annoPrecTarget ? ` ${annoPrecTarget}` : " di chiusura di questo documento"}, che qui è la colonna PRINCIPALE del prospetto (nei prospetti a due colonne è la PRIMA colonna numerica).
- Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi presenti in questo documento.
- Verifica sempre l'intestazione di colonna (anno/data di chiusura) prima di leggere il numero.
- Nel campo "esercizio" riporta la data/anno di chiusura effettivamente letta${annoPrecTarget ? ` (attesa: ${annoPrecTarget})` : ""}.
- Se il documento non contiene l'esercizio richiesto, restituisci "voci": [] anziché ripiegare su un altro anno.\n`
    : `\n\n⚠⚠ ESERCIZIO: estrai ESCLUSIVAMENTE la colonna dell'ANNO PRECEDENTE (es. 2024), la colonna comparativa. Non mescolarla con l'anno corrente.
ISTRUZIONI TASSATIVE SULLA COLONNA:
- Nei prospetti a due colonne la PRIMA colonna numerica è quasi sempre l'esercizio corrente e la SECONDA è il comparativo T-1: prendi la SECONDA.
- Verifica sempre l'intestazione di colonna (anno/data di chiusura) prima di leggere il numero: l'anno T-1 è quello con data di chiusura PIÙ VECCHIA.
- Se una voce esiste solo nell'anno corrente e non ha comparativo, OMETTILA (non riportarla con l'importo dell'anno corrente).
- Se il documento contiene un solo esercizio (nessuna colonna comparativa), restituisci "voci": [] e valorizza "esercizio" con una stringa vuota: non inventare dati.
- Nel campo "esercizio" riporta la data/anno di chiusura DELL'ANNO PRECEDENTE (es. "31/12/2024").\n`;
  /* ---- Modalità Singolo Anno (solo estrazione principale T, isPrec === false) ----
     Quando l'utente ha attivato la modalità e ha indicato un anno, l'IA deve
     leggere ESCLUSIVAMENTE quell'esercizio, ignorando qualsiasi colonna
     comparativa. Non ha effetto sulla passata T-1 (che in questa modalità
     non viene comunque lanciata). ---- */
  const bloccoSingoloAnno =
    !isPrec && modalitaSingoloAnno && String(annoSpecifico).trim()
      ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Estrai ESCLUSIVAMENTE i dati, gli importi e le voci relativi all'anno ${annoSpecifico}. Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi.`
      : "";
  const bloccoTesto = testoBilancio
    ? `\n\nTESTO DEL BILANCIO:\n"""\n${testoBilancio}\n"""`
    : `\n\nIl bilancio da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle dei prospetti contabili.`;
  return `Sei un analista di bilancio esperto. Ricevi il testo di un CONTO ECONOMICO (qualunque schema: civilistico art. 2425, abbreviato, IFRS per natura, IFRS per funzione, gestionale a margine di contribuzione).${bloccoRegole}${bloccoEsercizio}${bloccoSingoloAnno}
FASE 1 — RICONOSCIMENTO SCHEMA: identifica lo schema di partenza tra "valore_aggiunto" (per natura), "costo_del_venduto" (per funzione), "margine_di_contribuzione" (variabili/fissi) o "civilistico".

FASE 2 — ESTRAZIONE ADATTATA: estrai TUTTE le voci originali con il loro importo (numeri puri, in migliaia se il bilancio è in migliaia) e proponi per ciascuna:
- "classe": una tra ${Object.keys(CLASSI).filter((c) => c !== "DA_CLASSIFICARE").join(", ")}
  (le classi appartengono alle aree di gestione: CORRENTE caratteristica/finanziaria/accessoria, NON CORRENTE, tributaria)
- "asa" (facoltativa, solo per le classi della gestione caratteristica): l'Area Strategica d'Affari / segmento di business a cui la voce è riferibile, se il bilancio o il segment reporting lo rendono deducibile; altrimenti ometti il campo (voce comune/corporate).

Convenzioni di segno: costi con importo POSITIVO; variazioni rimanenze con segno + se incremento; classe NON_CORRENTE con segno +/- secondo natura (provento/onere non ricorrente).
Se una voce è ambigua usa classe "DA_CLASSIFICARE". Non inventare voci non presenti.

Rispondi SOLO con JSON valido, senza markdown né commenti, nel formato:
{"schemaRilevato":"...","azienda":"...","esercizio":"...","valuta":"EUR","unita":"milioni","voci":[{"nome":"...","importo":0,"classe":"...","asa":"..."}]}${bloccoRegoleCE(regoleApprese)}${bloccoTesto}`;
}

/* ---------- Parsing JSON robusto (gestisce risposte troncate O con testo extra dopo il JSON) ----------
   L'IA può fallire il JSON puro in due modi distinti, che vanno gestiti
   con logiche opposte:
   1) TRONCAMENTO — la risposta si interrompe a metà stringa/array per fine
      token: qui si ripara chiudendo stringhe e parentesi rimaste aperte.
   2) CONTENUTO EXTRA DOPO UN JSON COMPLETO — l'IA restituisce un oggetto
      JSON valido e poi, incollato subito dopo senza separatori, altro testo
      (commento, spiegazione, o persino un secondo blocco JSON duplicato).
      Qui la struttura non è affatto troncata: va invece individuata la fine
      del primo valore di primo livello e scartato tutto ciò che segue.
   Si prova prima il caso (2), perché tentare la riparazione da troncamento
   su un JSON già completo porta a "ripercorrere" lo stesso errore. ---- */

function parseJsonRobusto(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  const inizio = s.indexOf("{");
  if (inizio > 0) s = s.slice(inizio);
  try {
    return JSON.parse(s);
  } catch {
    /* ---- Caso 2: JSON completo ma con testo extra incollato subito dopo ---- */
    const fineValore = trovaFineValoreJson(s);
    if (fineValore != null) {
      const candidato = s.slice(0, fineValore);
      try {
        return JSON.parse(candidato);
      } catch {
        /* il candidato non è comunque valido: si prosegue con il caso 1 */
      }
    }

    /* ---- Caso 1: risposta troncata — scansione char per char per capire cosa è rimasto aperto ---- */
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
    /* taglia all'ultimo punto sicuro ed elimina l'elemento incompleto */
    let riparato = s.slice(0, lastSafe).replace(/,\s*$/, "");
    /* ricalcola le parentesi ancora aperte sul testo tagliato */
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

/* ---------- Individua la fine del primo valore JSON di primo livello ----------
   Scansiona la stringa tracciando stringhe/escape e la profondità di
   parentesi {}/[]. Restituisce l'indice subito dopo la chiusura del primo
   oggetto/array di primo livello (cioè quando la profondità torna a 0),
   oppure null se la struttura non si richiude mai entro la fine della
   stringa (nel qual caso è un troncamento, non contenuto extra, e la
   gestione spetta al caso 1). ---- */

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

/* ---------- Rilevamento schema+formato (chiamata IA separata) ---------- */

async function rilevaSchemaCe({ provider, apiKey, model, fonte }) {
  /* Il riconoscimento dello schema richiede solo le prime pagine: per i PDF
     nativi si invia la PRIMA porzione (ambito equivalente alla versione
     testuale, che si fermava ai primi 15.000 caratteri). */
  if (fonte.tipo === "pdf") {
    const prompt = `${CE_SCHEMA_DETECT_PROMPT}\n\nIl documento da esaminare è il PDF ALLEGATO a questo messaggio: leggilo direttamente.`;
    return parseJsonRobusto(await chiamaIA({ provider, apiKey, model, prompt, pdfBase64: fonte.chunks[0].data }));
  }
  const prompt = `${CE_SCHEMA_DETECT_PROMPT}\n\nDOCUMENTO (estratto):\n"""\n${fonte.testo.slice(0, 15000)}\n"""`;
  return parseJsonRobusto(await chiamaIA({ provider, apiKey, model, prompt }));
}

/* Singola chiamata al provider. `pdfBase64`, se presente, allega il PDF nel
   formato nativo del provider (blocco «document» per Claude, «inline_data»
   per Gemini) così il modello lo legge pagina per pagina anche quando il file
   è privo di layer di testo. Con OpenAI, che non accetta PDF grezzi, le pagine
   vengono prima convertite in immagini lato client e allegate come «image_url»:
   il risultato per l'utente è lo stesso. */
/* ---------- Destinazione delle chiamate al provider Claude ----------
   Di norma il proxy del progetto (/api/anthropic), che custodisce la chiave
   lato server. La destinazione viene decisa una sola volta, in tre passaggi:

     1. costante di build `__CLAUDE_ENDPOINT__`, che vite.config.js valorizza
        con `define` a partire da VITE_CLAUDE_ENDPOINT;
     2. `window.__CLAUDE_ENDPOINT__`, utile per un override a runtime senza
        ricompilare (per esempio da index.html);
     3. rilevamento dell'host: dentro un artifact di Claude il proxy non
        esiste ed è l'ambiente stesso ad autenticare la richiesta, quindi si
        chiama direttamente l'API.

   ⚠ Qui NON si usa `import.meta.env`: `import.meta` è sintassi legale solo
   all'interno di un modulo ES e fa fallire il *parsing* — non l'esecuzione —
   quando il componente viene incollato in un artifact o in un bundle non
   modulare («Cannot use 'import.meta' outside a module»). Nemmeno
   `typeof import.meta !== "undefined"` protegge, perché l'errore avviene
   prima che quella riga venga eseguita. */
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

const ENDPOINT_CLAUDE = rilevaEndpointClaude();

/* Chiamata diretta all'API: cambiano gli header di autenticazione, perché non
   c'è più un proxy che traduca `x-user-key` nella chiave del server. */
const CLAUDE_DIRETTO = ENDPOINT_CLAUDE === ENDPOINT_API_DIRETTA;

async function chiamaIAUnaVolta({ provider, apiKey, model, prompt, pdfBase64 = null }) {
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
    if (!res.ok) throw creaErroreHttp("OpenAI", res.status, await res.text());
    const data = await res.json();
    return data.choices[0].message.content;
  }
  if (provider === "claude") {
    // Fuori dall'artifact la chiamata NON può partire dal browser verso
    // api.anthropic.com: viaggerebbe senza chiave e verrebbe comunque bloccata
    // da CORS. Il body resta identico, cambia solo la destinazione: la funzione
    // serverless api/anthropic.js vi aggiunge x-api-key e anthropic-version e
    // restituisce la risposta invariata, status compreso, così il retry
    // esponenziale di chiamaIA continua a riconoscere 429 e 529.
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
    const res = await fetch(ENDPOINT_CLAUDE, {
      method: "POST",
      /* Con il proxy, la chiave digitata a schermo viaggia in un header
         dedicato e vale per la singola richiesta: il proxy la usa e la
         dimentica; a campo vuoto l'header non parte e il server usa la
         propria. In chiamata diretta il proxy non c'è: la chiave va nei
         header nativi dell'API, e senza chiave si lascia autenticare
         l'ambiente ospite (è il caso dell'artifact di Claude). */
      headers: {
        "Content-Type": "application/json",
        ...(apiKey
          ? CLAUDE_DIRETTO
            ? {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
              }
            : { "x-user-key": apiKey }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages: [{ role: "user", content: contenuto }],
      }),
    });
    if (!res.ok) throw creaErroreHttp("Claude", res.status, await res.text());
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
  if (!res.ok) throw creaErroreHttp("Gemini", res.status, await res.text());
  const data = await res.json();
  return data.candidates[0].content.parts.map((p) => p.text).join("");
}

function creaErroreHttp(etichetta, status, testo) {
  const err = new Error(`${etichetta} ${status}: ${String(testo).slice(0, 200)}`);
  err.status = status;
  return err;
}

/* Un modello occupato o un limite di frequenza non devono far fallire l'intero
   caricamento: gli errori temporanei vengono ritentati con attesa esponenziale
   (stessa strategia del modulo Stato Patrimoniale). */
async function chiamaIA({ provider, apiKey, model, prompt, pdfBase64 = null }) {
  prompt = conScalaMilioni(prompt);
  const MAX_RETRY = 5;
  const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
  let ultimoErrore;
  for (let tentativo = 0; tentativo <= MAX_RETRY; tentativo++) {
    try {
      return await chiamaIAUnaVolta({ provider, apiKey, model, prompt, pdfBase64 });
    } catch (e) {
      ultimoErrore = e;
      const msg = String(e?.message || "");
      const temporaneo =
        [429, 500, 502, 503, 504, 529].includes(e?.status) ||
        /overload|rate.?limit|timeout|temporan|try again|capacity|network|failed to fetch/i.test(msg);
      if (!temporaneo || tentativo === MAX_RETRY) throw e;
      const attesa = Math.min(1500 * Math.pow(2, tentativo), 20000) + Math.random() * 750;
      console.warn(`Provider occupato (${msg}). Nuovo tentativo tra ${Math.round(attesa)} ms… (${tentativo + 1}/${MAX_RETRY})`);
      await attendi(attesa);
    }
  }
  throw ultimoErrore;
}

/* ---------- Lettura file (testo + PDF via pdf.js da cdnjs) ---------- */

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
   pdf.js legge SOLO il layer di testo incorporato nel PDF: un file
   prodotto da scansione o da «Stampa su PDF» ne è privo e restituisce
   zero caratteri, rendendo impossibile qualunque analisi (l'IA riceve
   una stringa vuota e non può che rispondere a vuoto).
   Per questo il PDF viene inviato al modello nel suo formato NATIVO, come
   blocco «document» in base64: il modello lo legge visivamente pagina per
   pagina, esattamente come farebbe una persona, quindi anche i documenti
   scansionati o "stampati" diventano analizzabili.
   I file voluminosi vengono suddivisi in porzioni per rispettare i limiti
   di dimensione della singola richiesta.
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

/* Suddivide il PDF in porzioni da PAGINE_PER_PORZIONE pagine. Ogni porzione
   conserva l'intervallo di pagine originario (from/to), così i riferimenti di
   pagina restituiti dal modello possono essere riallineati al documento
   completo. Se la suddivisione fallisce si invia comunque il file intero. */
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
// compromesso tra leggibilità delle tabelle di conto economico e peso della
// richiesta.
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

/* La stessa porzione viene inviata più volte (rilevamento schema, conto
   economico, nota integrativa, relazione sulla gestione, esercizio
   precedente…) e ogni chiamata può essere ritentata fino a 5 volte da
   chiamaIA: senza cache la rasterizzazione verrebbe rifatta ogni giro. La
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

/* Esegue il prompt sulla fonte, porzione per porzione, restituendo l'elenco
   dei JSON ottenuti (uno per ogni porzione analizzata con successo).
   `costruisciPrompt(testo)` riceve il testo da incorporare nel prompt oppure
   null quando il documento viaggia come allegato PDF nativo. */
async function eseguiSuFonte({ provider, apiKey, model, costruisciPrompt, fonte, limiteTesto = 120000, onPorzione }) {
  if (fonte.tipo === "testo") {
    const prompt = costruisciPrompt(fonte.testo.slice(0, limiteTesto));
    return [parseJsonRobusto(await chiamaIA({ provider, apiKey, model, prompt }))];
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
      const raw = await chiamaIA({
        provider,
        apiKey,
        model,
        prompt: costruisciPrompt(null) + nota,
        pdfBase64: ch.data,
      });
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

/* True se almeno una porzione ha richiesto la riparazione da troncamento. */
function qualcheTroncamento(risultati) {
  return risultati.some((r) => r?.__troncato);
}

/* True se almeno una porzione contiene il ramo indicato (per non azzerare
   stati già popolati quando il modello omette del tutto una sezione). */
function qualchePresenza(risultati, percorso) {
  return risultati.some((r) => leggiPercorso(r, percorso) != null);
}

/* ---------- domain/calcoli.js — estensione CE ---------- */

function calcolaCE(voci) {
  const attive = voci.filter((v) => v.classe !== "DA_CLASSIFICARE");
  const S = (classe) =>
    attive.filter((v) => v.classe === classe).reduce((a, v) => a + (Number(v.importo) || 0), 0);

  /* ---- Gestione corrente · CARATTERISTICA ---- */
  const ricavi = S("RICAVI");
  const varRimPF = S("VAR_RIM_PF");
  const lavoriInterni = S("LAVORI_INTERNI");
  const altriRicavi = S("ALTRI_RICAVI");
  const valoreProduzione = ricavi + varRimPF + lavoriInterni + altriRicavi;

  const acquisti = S("ACQUISTI");
  const varRimMaterie = S("VAR_RIM_MATERIE");
  const consumi = acquisti - varRimMaterie;
  const servizi = S("SERVIZI");
  const godimento = S("GODIMENTO");
  const oneriDiversi = S("ONERI_DIVERSI");
  const costiEsterni = consumi + servizi + godimento + oneriDiversi;

  const valoreAggiunto = valoreProduzione - costiEsterni;
  const personale = S("PERSONALE");
  const ebitda = valoreAggiunto - personale;
  const ammortamenti = S("AMMORTAMENTI");
  const accantonamenti = S("ACCANTONAMENTI");
  const redditoOperativoCaratteristica = ebitda - ammortamenti - accantonamenti; // EBIT caratteristico

  /* ---- Gestione corrente · ACCESSORIA ---- */
  const proventiAccessori = S("PROVENTI_ACCESSORI");
  const oneriAccessori = S("ONERI_ACCESSORI");
  const gestioneAccessoria = proventiAccessori - oneriAccessori;

  /* ---- EBIT complessivo (caratteristica + accessoria) ---- */
  const ebit = redditoOperativoCaratteristica + gestioneAccessoria;

  /* ---- Gestione corrente · FINANZIARIA ---- */
  const proventiFin = S("PROVENTI_FIN");
  const oneriFin = S("ONERI_FIN");
  const gestioneFinanziaria = proventiFin - oneriFin;

  /* ---- Risultato della GESTIONE CORRENTE ---- */
  const risultatoCorrente = ebit + gestioneFinanziaria;

  /* ---- GESTIONE NON CORRENTE ---- */
  const gestioneNonCorrente = S("NON_CORRENTE");

  /* ---- AREA EXTRA-GESTIONE (window dressing stornato) ---- */
  const extraGestione = S("EXTRA_GESTIONE");

  /* ---- Gestione tributaria e risultato netto ---- */
  const risultatoAnteImposte = risultatoCorrente + gestioneNonCorrente + extraGestione;
  const imposte = S("IMPOSTE");
  const utileNetto = risultatoAnteImposte - imposte;

  const daClassificare = voci.filter((v) => v.classe === "DA_CLASSIFICARE").length;

  return {
    ricavi, varRimPF, lavoriInterni, altriRicavi, valoreProduzione,
    acquisti, varRimMaterie, consumi, servizi, godimento, oneriDiversi, costiEsterni,
    valoreAggiunto, personale, ebitda, ammortamenti, accantonamenti,
    redditoOperativoCaratteristica, proventiAccessori, oneriAccessori, gestioneAccessoria, ebit,
    proventiFin, oneriFin, gestioneFinanziaria, risultatoCorrente,
    gestioneNonCorrente, extraGestione, risultatoAnteImposte, imposte, utileNetto, daClassificare,
  };
}

/* ---- Segment reporting: mini-CE caratteristico per ASA ---- */

function calcolaSegmenti(voci, asaList) {
  const chiavi = [...asaList, ASA_COMUNE];
  const seg = {};
  chiavi.forEach((k) => {
    seg[k] = { ricavi: 0, altriComponenti: 0, costiEsterni: 0, personale: 0, ammAcc: 0 };
  });
  voci
    .filter((v) => CLASSI[v.classe]?.asa && v.classe !== "DA_CLASSIFICARE")
    .forEach((v) => {
      const k = v.asa && asaList.includes(v.asa) ? v.asa : ASA_COMUNE;
      const val = Number(v.importo) || 0;
      const s = seg[k];
      switch (v.classe) {
        case "RICAVI": s.ricavi += val; break;
        case "VAR_RIM_PF":
        case "LAVORI_INTERNI":
        case "ALTRI_RICAVI": s.altriComponenti += val; break;
        case "ACQUISTI":
        case "SERVIZI":
        case "GODIMENTO":
        case "ONERI_DIVERSI": s.costiEsterni += val; break;
        case "VAR_RIM_MATERIE": s.costiEsterni -= val; break;
        case "PERSONALE": s.personale += val; break;
        case "AMMORTAMENTI":
        case "ACCANTONAMENTI": s.ammAcc += val; break;
        default: break;
      }
    });
  chiavi.forEach((k) => {
    const s = seg[k];
    s.valoreProduzione = s.ricavi + s.altriComponenti;
    s.valoreAggiunto = s.valoreProduzione - s.costiEsterni;
    s.ebitda = s.valoreAggiunto - s.personale;
    s.ebit = s.ebitda - s.ammAcc;
  });
  return seg;
}

/* ---- Direct costing evoluto: margini di contribuzione per ASA ----
   Innesta sulla riclassificazione per ASA la logica variabili/fissi:
   · MLC  (Margine Lordo di Contribuzione)      = Ricavi ASA − Costi Variabili (Speciali) ASA
   · MSLC (Margine Semi-Lordo di Contribuzione) = MLC − Costi Fissi Speciali ASA
   La partizione variabili/fissi è pilotata da `variabiliSet` (elenco
   delle classi di costo considerate variabili); tutte le voci della
   colonna comune/corporate — qualunque ne sia la natura — confluiscono
   nei Costi Fissi Comuni sottratti in blocco dopo la Σ dei MSLC.
   VAR_RIM_MATERIE segue il bucket di ACQUISTI con segno invertito
   (un incremento di rimanenze materie riduce i consumi). ---- */

const CLASSI_COSTO_NATURA = [
  ["ACQUISTI", "Consumi di materie (acquisti − Δ rimanenze)"],
  ["SERVIZI", "Costi per servizi"],
  ["GODIMENTO", "Godimento beni di terzi"],
  ["ONERI_DIVERSI", "Oneri diversi di gestione"],
  ["PERSONALE", "Costo del personale"],
  ["AMMORTAMENTI", "Ammortamenti e svalutazioni"],
  ["ACCANTONAMENTI", "Accantonamenti"],
];
const CLASSI_RICAVO_ASA = ["RICAVI", "VAR_RIM_PF", "LAVORI_INTERNI", "ALTRI_RICAVI"];

function calcolaContribuzione(voci, asaList, variabiliSet) {
  const chiavi = [...asaList, ASA_COMUNE];
  const seg = {};
  chiavi.forEach((k) => {
    seg[k] = { ricavi: 0, costiVariabili: 0, costiFissi: 0 };
  });
  voci
    .filter((v) => CLASSI[v.classe]?.asa && v.classe !== "DA_CLASSIFICARE")
    .forEach((v) => {
      const k = v.asa && asaList.includes(v.asa) ? v.asa : ASA_COMUNE;
      const val = Number(v.importo) || 0;
      const s = seg[k];
      if (CLASSI_RICAVO_ASA.includes(v.classe)) {
        s.ricavi += val;
        return;
      }
      const bucket = v.classe === "VAR_RIM_MATERIE" ? "ACQUISTI" : v.classe;
      const segno = v.classe === "VAR_RIM_MATERIE" ? -1 : 1;
      if (variabiliSet.includes(bucket)) s.costiVariabili += segno * val;
      else s.costiFissi += segno * val;
    });
  chiavi.forEach((k) => {
    const s = seg[k];
    s.mlc = s.ricavi - s.costiVariabili;   // Margine Lordo di Contribuzione
    s.mslc = s.mlc - s.costiFissi;         // Margine Semi-Lordo di Contribuzione
  });
  return seg;
}

/* ---------- Utility ---------- */

const fmt = (n) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n || 0);
const pct = (n, base) => (base ? ((n / base) * 100).toFixed(1).replace(".", ",") + "%" : "—");
let _id = 0;
const nuovoId = () => `v${Date.now()}_${_id++}`;

/* ---- (Sezione 5 «window dressing» e tabelle Red Flags / Area Extra-Gestione
   rimosse: i relativi helper forensi non sono più necessari.) ---- */

/* ============================================================
   COMPONENTE PRINCIPALE
   ============================================================ */

/* ── Aliquota fiscale: aiuti ─────────────────────────────────────────── */
/** Aliquota effettiva di un esercizio (0–1), null se in perdita o fuori 0–60%. */
function aliquotaEffettivaCE(c) {
  const rai = Number(c?.risultatoAnteImposte);
  const un = Number(c?.utileNetto);
  if (!Number.isFinite(rai) || rai <= 0 || !Number.isFinite(un)) return null;
  const t = (rai - un) / rai;
  return t >= 0 && t <= 0.6 ? t : null;
}
/** Ultimo ripiego: aliquota legale dello schema riconosciuto. */
const ALIQUOTA_LEGALE = {
  oic: { valore: 27.9, testo: "Aliquota legale italiana (IRES 24% + IRAP 3,9%): ripiego, i documenti non permettono di ricavarla. L'IRAP ha una base diversa dall'utile: è un ordine di grandezza." },
  us_gaap: { valore: 25, testo: "Aliquota legale USA indicativa (21% federale + circa 4% statale medio): ripiego, i documenti non permettono di ricavarla." },
  ifrs: { valore: 27.9, testo: "Ripiego: aliquota legale italiana (IRES 24% + IRAP 3,9%). Lo schema IFRS non indica il Paese: verifica e correggi se la società non è italiana." },
  altro: { valore: 27.9, testo: "Ripiego: aliquota legale italiana (IRES 24% + IRAP 3,9%). Verifica e correggi se la società non è italiana." },
};
/** Aliquota nominale dalla risposta dell'IA: percentuale 0–60, altrimenti null. */
function normalizzaAliquotaNI(a, prec, documento) {
  if (!a || typeof a !== "object") return null;
  let v = Number(String(a.valore ?? "").replace(",", "."));
  if (!Number.isFinite(v)) return null;
  if (v > 0 && v < 1) v *= 100; // 0,279 → 27,9
  if (v <= 0 || v > 60) return null;
  return {
    valore: Math.round(v * 100) / 100,
    componenti: a.componenti ? String(a.componenti) : "",
    pagina: a.pagina != null && Number.isFinite(Number(a.pagina)) ? Number(a.pagina) : null,
    citazione: a.citazione ? String(a.citazione) : "",
    prec: !!prec,
    documento: documento || "",
  };
}

export default function ContoEconomicoRiclassificato({ annoRiferimento } = {}) {
  /* Esercizio di riferimento passato da chi monta il programma (es. la suite
     di caricamento): fissa le etichette iniziali T e T-1. */
  const annoRifCE = /^\d{4}$/.test(String(annoRiferimento || "").trim()) ? Number(String(annoRiferimento).trim()) : 2025;
  const [voci, setVoci] = useState([]);
  const [asaList, setAsaList] = useState([]);
  const [azienda, setAzienda] = useState("Ferrari N.V.");
  const [esercizio, setEsercizio] = useState(`31/12/${annoRifCE}`);
  const [fonte, setFonte] = useState(null);
  const [schemaRilevato, setSchemaRilevato] = useState(null);
  const [schemaCE, setSchemaCE] = useState(null); // { schema, formato, valuta, unita, indizi }
  const [tab, setTab] = useState(1);
  const [provider, setProvider] = useState("claude");
  const [chiavi, setChiavi] = useState({ claude: "", openai: "", gemini: "" });
  const [mostraChiave, setMostraChiave] = useState(false);
  const [modello, setModello] = useState({
    openai: "gpt-5.4-mini",
    gemini: "gemini-2.5-flash",
    claude: "claude-sonnet-4-6",
  });
  const [statoIA, setStatoIA] = useState(null);
  const [caricamento, setCaricamento] = useState(false);
  /* ---- Analisi "bilancio completo" (Form 10-K / 20-F) in un solo passaggio:
     una singola chiamata IA popola contemporaneamente voci CE, Nota
     Integrativa e Relazione sulla Gestione. Loading state dedicato. ---- */
  const [caricamentoMaster, setCaricamentoMaster] = useState(false);
  const [niEstratti, setNiEstratti] = useState([]);
  const [niFonte, setNiFonte] = useState(null);
  const [caricamentoNI, setCaricamentoNI] = useState(false);
  const [niRettifiche, setNiRettifiche] = useState([]);
  const [niRiallocazioni, setNiRiallocazioni] = useState([]);
  const [niRedFlags, setNiRedFlags] = useState([]);
  /* ---- Relazione sulla Gestione (RG) — 4 sezioni tematiche + special items ---- */
  const [rgEstratti, setRgEstratti] = useState([]);
  const [rgFonte, setRgFonte] = useState(null);
  const [caricamentoRG, setCaricamentoRG] = useState(false);
  const [rgRettifiche, setRgRettifiche] = useState([]);
  const [rgRedFlags, setRgRedFlags] = useState([]);
  /* ── ALIQUOTA FISCALE ORDINARIA ─────────────────────────────────────────
     Non più fissa al 27,9%: si ricava dai documenti, in quest'ordine
       1. aliquota NOMINALE dichiarata nella Nota Integrativa (riconciliazione
          tra onere teorico ed effettivo o nota sulle imposte);
       2. aliquota EFFETTIVA media degli esercizi T e T-1 (imposte ÷ utile ante
          imposte), esclusi gli esercizi in perdita e quelli fuori 0–60%;
       3. aliquota LEGALE dello schema riconosciuto, come ultimo ripiego.
     Una modifica a mano la rende «manuale» e il calcolo non la tocca più finché
     non si sceglie «ricava dai documenti». La fonte viaggia nel JSON salvato. */
  const [aliquota, setAliquota] = useState(27.9);
  const [aliquotaNI, setAliquotaNI] = useState(null); // { valore, componenti, pagina, citazione, prec, documento }
  const [fonteAliquota, setFonteAliquota] = useState({ tipo: "auto" }); // auto | ni | effettiva | legale | manuale

  /* ---- Modalità Singolo Anno (opzionale) ----
     Se attiva, l'IA estrae ESCLUSIVAMENTE l'anno indicato in `annoSpecifico`,
     popolando solo le sezioni dell'esercizio corrente (T) e bloccando ogni
     seconda passata automatica sulla colonna comparativa (T-1). ---- */
  const [modalitaSingoloAnno, setModalitaSingoloAnno] = useState(false);
  const [annoSpecifico, setAnnoSpecifico] = useState("");
  /* Modalità Singolo Anno · anno del documento T-1 caricato a parte.
     Nell'analisi manuale di una serie storica ogni esercizio arriva da un
     bilancio autonomo: qui si dichiara quale anno contiene il documento
     destinato agli slot T-1, così il prompt legge la colonna PRINCIPALE di
     quel documento invece della sua colonna comparativa. */
  const [annoSpecificoPrec, setAnnoSpecificoPrec] = useState("");

  /* ---- Prompt di sistema auto-apprendenti (Tab 13 · Audit) ----
     Il contenuto vive qui, viene letto da tutte le funzioni che chiamano
     l'IA in estrazione e persiste nel localStorage del browser, così le
     regole apprese sopravvivono al reload e ai cambi di bilancio. ---- */
  const [systemPrompts, setSystemPrompts] = useState(() => caricaSystemPrompts());
  /* unico punto di persistenza: stato React + localStorage in un colpo solo */
  const salvaSystemPrompts = (next) => { setSystemPrompts(next); scriviSystemPrompts(next); };
  const resetSystemPrompts = () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(CE_PROMPTS_KEY);
    } catch { /* noop */ }
    setSystemPrompts(promptsDiDefaultCE());
  };
  /* Esiti delle azioni per indice di anomalia: { [i]: { fix: bool, learn: bool } } */
  const [auditAzioni, setAuditAzioni] = useState({});

  /* ============================================================
     ESERCIZIO PRECEDENTE (T-1) — stati gemelli
     ============================================================
     Ogni stato dell'esercizio corrente ha qui la sua controparte, così
     il raffronto T / T-1 è organico e non richiede input manuali. ---- */
  const [vociPrec, setVociPrec] = useState([]);
  const [esercizioPrec, setEsercizioPrec] = useState(`31/12/${annoRifCE - 1}`);
  const [fontePrec, setFontePrec] = useState(null);
  const [schemaRilevatoPrec, setSchemaRilevatoPrec] = useState(null);
  const [statoIAPrec, setStatoIAPrec] = useState(null);
  const [caricamentoPrec, setCaricamentoPrec] = useState(false);
  const [niEstrattiPrec, setNiEstrattiPrec] = useState([]);
  const [niFontePrec, setNiFontePrec] = useState(null);
  const [niRettifichePrec, setNiRettifichePrec] = useState([]);
  const [niRiallocazioniPrec, setNiRiallocazioniPrec] = useState([]);
  const [niRedFlagsPrec, setNiRedFlagsPrec] = useState([]);
  const [rgEstrattiPrec, setRgEstrattiPrec] = useState([]);
  const [rgFontePrec, setRgFontePrec] = useState(null);
  const [rgRettifichePrec, setRgRettifichePrec] = useState([]);
  const [rgRedFlagsPrec, setRgRedFlagsPrec] = useState([]);

  /* ---- Crediti verso clienti per l'indicatore di channel stuffing ----
     I crediti sono una posta PATRIMONIALE: non essendo voci di conto
     economico non possono derivare dal raffronto voci / vociPrec, quindi
     restano alimentati dalla Nota Integrativa (blocco "channelStuffing").
     Il fatturato di raffronto, invece, è ora ORGANICO: viene letto da
     calcPrec.ricavi, non più da un campo digitato a mano. ---- */
  const [creditiClienti, setCreditiClienti] = useState({ corrente: "", precedente: "", pagina: null, auto: false });
  const [valutazione, setValutazione] = useState({ equity: "", pfn: "", leasing: "" });
  const [classiVariabili, setClassiVariabili] = useState(["ACQUISTI", "SERVIZI", "ONERI_DIVERSI"]); // partizione variabili/fissi per il direct costing ASA
  const [esporta, setEsporta] = useState(null); // { nome, testo, copiato } — modale di esportazione JSON
  const fileIA = useRef(null);
  const fileNI = useRef(null);
  const fileRG = useRef(null);
  const fileJSON = useRef(null);
  /* ---- input unico per il bilancio completo (prospetti + note + MD&A) ---- */
  const fileMaster = useRef(null);
  /* ---- input dedicati al caricamento separato dell'esercizio T-1 ---- */
  const fileIAPrec = useRef(null);
  const fileNIPrec = useRef(null);
  const fileRGPrec = useRef(null);

  const calc = useMemo(() => calcolaCE(voci), [voci]);
  const segmenti = useMemo(() => calcolaSegmenti(voci, asaList), [voci, asaList]);
  const contrib = useMemo(() => calcolaContribuzione(voci, asaList, classiVariabili), [voci, asaList, classiVariabili]);

  /* ============================================================
     MOTORE DI CALCOLO T-1 e VARIAZIONI (Δ ECONOMICI)
     ============================================================ */
  const calcPrec = useMemo(() => calcolaCE(vociPrec), [vociPrec]);

  /* Aliquota proposta dai documenti (vedi ALIQUOTA FISCALE ORDINARIA). */
  const aliquotaProposta = useMemo(() => {
    if (aliquotaNI && Number.isFinite(aliquotaNI.valore)) {
      return {
        tipo: "ni", valore: aliquotaNI.valore,
        testo: `Aliquota nominale dichiarata nella Nota Integrativa${aliquotaNI.prec ? " del T-1" : ""}` +
          `${aliquotaNI.componenti ? ` (${aliquotaNI.componenti})` : ""}${aliquotaNI.pagina != null ? `, pag. ${aliquotaNI.pagina}` : ""}`,
        citazione: aliquotaNI.citazione || "",
      };
    }
    const effettive = [
      [esercizio, calc], [esercizioPrec, calcPrec],
    ].map(([es, c]) => ({ es, t: aliquotaEffettivaCE(c) })).filter((x) => x.t !== null);
    if (effettive.length) {
      const media = effettive.reduce((a, x) => a + x.t, 0) / effettive.length;
      return {
        tipo: "effettiva", valore: Math.round(media * 1000) / 10,
        testo: `Aliquota effettiva media (imposte ÷ utile ante imposte): ${effettive.map((x) => `${x.es || "—"} ${(x.t * 100).toFixed(1).replace(".", ",")}%`).join(", ")}. La Nota Integrativa non dichiara l'aliquota nominale.`,
      };
    }
    const legale = ALIQUOTA_LEGALE[schemaCE?.schema] || ALIQUOTA_LEGALE.altro;
    return { tipo: "legale", valore: legale.valore, testo: legale.testo };
  }, [aliquotaNI, calc, calcPrec, esercizio, esercizioPrec, schemaCE]);

  /* Finché non è manuale, l'aliquota segue la proposta. */
  useEffect(() => {
    if (fonteAliquota.tipo === "manuale") return;
    if (aliquota !== aliquotaProposta.valore) setAliquota(aliquotaProposta.valore);
    if (fonteAliquota.tipo !== aliquotaProposta.tipo || fonteAliquota.testo !== aliquotaProposta.testo)
      setFonteAliquota({ tipo: aliquotaProposta.tipo, testo: aliquotaProposta.testo, citazione: aliquotaProposta.citazione || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliquotaProposta, fonteAliquota.tipo]);
  const segmentiPrec = useMemo(() => calcolaSegmenti(vociPrec, asaList), [vociPrec, asaList]);
  const contribPrec = useMemo(
    () => calcolaContribuzione(vociPrec, asaList, classiVariabili),
    [vociPrec, asaList, classiVariabili]
  );

  /* ---- Δ economici: variazione assoluta e percentuale dei margini chiave ----
     Gemello di `deltaPatrimoniali` dello Stato Patrimoniale. La variazione
     percentuale è calcolata sul VALORE ASSOLUTO della base T-1, così il
     segno del Δ% resta leggibile anche quando la base è negativa (una
     perdita che si riduce produce un Δ% positivo, cioè un miglioramento).
     Se la base T-1 è nulla la percentuale non è definita (null). ---- */
  const deltaEconomici = useMemo(() => {
    const disponibile = voci.length > 0 && vociPrec.length > 0;
    const metriche = [
      ["ricavi", "Ricavi delle vendite", (c) => c.ricavi],
      ["valoreProduzione", "Valore della produzione", (c) => c.valoreProduzione],
      ["valoreAggiunto", "Valore aggiunto", (c) => c.valoreAggiunto],
      ["ebitda", "EBITDA — Margine operativo lordo", (c) => c.ebitda],
      ["ebit", "EBIT — Reddito operativo", (c) => c.ebit],
      ["risultatoCorrente", "Risultato della gestione corrente", (c) => c.risultatoCorrente],
      ["utileNetto", "Utile netto", (c) => c.utileNetto],
    ];
    const voci_ = {};
    metriche.forEach(([chiave, label, sel]) => {
      const t = sel(calc);
      const t1 = sel(calcPrec);
      const assoluto = t - t1;
      const base = Math.abs(t1);
      voci_[chiave] = {
        chiave,
        label,
        corrente: t,
        precedente: t1,
        assoluto,
        percentuale: base > 1e-9 ? (assoluto / base) * 100 : null,
      };
    });
    return { disponibile, ...voci_, elenco: metriche.map(([k]) => voci_[k]) };
  }, [calc, calcPrec, voci.length, vociPrec.length]);

  /* ============================================================
     AUDIT DEL REVISORE — controlli deterministici (tab 12)
     ============================================================
     I cinque controlli della checklist vengono eseguiti in due
     strati. Qui sta il primo: aritmetica e confronti meccanici,
     che non richiedono l'IA, non consumano token e danno sempre
     lo stesso esito sugli stessi dati. Il secondo strato
     (eseguiAuditIA) sottopone al modello i casi di giudizio —
     nomi voce diversi ma di natura identica, plausibilità
     economica delle variazioni — insieme a questi rilievi.
     ============================================================ */

  /* Voci «vere»: si escludono quelle generate automaticamente dagli storni
     (rettificaNI) e dalle riallocazioni (riallocazioneNI), che non sono
     modificabili a mano dall'utente e falserebbero il confronto fra anni. */
  const vociOriginali = (vs) => (vs || []).filter((v) => !v.rettificaNI && !v.riallocazioneNI);

  const auditLocale = useMemo(() => {
    const rilievi = [];
    const agg = (r) => rilievi.push(r);
    const nomeAnno = (prec) => (prec ? esercizioPrec || "T-1" : esercizio || "T");
    const sezione = (prec) => (prec ? "Tab 9 · Dati & Validazione T-1" : "Tab 1 · Dati & Validazione");

    const vociT = vociOriginali(voci);
    const vociT1 = vociOriginali(vociPrec);
    const dueAnni = vociT.length > 0 && vociT1.length > 0;

    /* ---- Controllo 1 · coerenza di classe e ASA fra i due esercizi ---- */
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
    const mapT = indicizza(vociT);
    const mapT1 = indicizza(vociT1);
    const classiIncoerenti = [];

    if (dueAnni) {
      mapT.forEach((lista, chiave) => {
        const gemelle = mapT1.get(chiave);
        if (!gemelle) {
          agg({
            controllo: 1, gravita: "info", anno: nomeAnno(false), sezione: sezione(false),
            voce: lista[0].nome,
            errore: `La voce non trova corrispondenza in ${nomeAnno(true)}: il confronto fra esercizi su questa posta non è verificabile.`,
            azione: `Verifica in ${nomeAnno(true)} se la stessa posta esiste sotto un nome diverso; in caso affermativo allinea la denominazione, altrimenti ignora questa segnalazione (voce effettivamente nuova).`,
          });
          return;
        }
        const classeT = lista[0].classe;
        const classeT1 = gemelle[0].classe;
        if (classeT !== classeT1) {
          classiIncoerenti.push({ nome: lista[0].nome, classeT, classeT1 });
          agg({
            controllo: 1, gravita: "grave", anno: `${nomeAnno(false)} / ${nomeAnno(true)}`, sezione: "Tab 9 · Dati & Validazione T-1",
            voce: lista[0].nome,
            /* L'ancoraggio è sulla voce di T-1 perché l'auto-fix proposto
               allinea il comparativo all'esercizio corrente: è la scelta
               reversibile, e il testo lascia esplicita l'alternativa. */
            idVoce: gemelle[0].id, esercizio: "precedente",
            autoFix: {
              tipo: "cambiaClasse", nuovaClasse: classeT,
              etichetta: `✨ Allinea ${nomeAnno(true)} a ${classeT}`,
            },
            errore: `ERRORE GRAVE — stessa voce classificata in modo diverso nei due esercizi: ${classeT} in ${nomeAnno(false)}, ${classeT1} in ${nomeAnno(true)}. I margini dei due anni non sono confrontabili e il Δ risulta falsato.`,
            azione: `Decidi quale dei due anni è classificato male. L'auto-fix allinea ${nomeAnno(true)} a ${classeT}; se invece è ${nomeAnno(false)} a essere sbagliato, cambia lì la classe in ${classeT1}.`,
          });
        }
        const asaT = lista[0].asa || null;
        const asaT1 = gemelle[0].asa || null;
        if (asaT !== asaT1 && CLASSI[classeT]?.asa) {
          agg({
            controllo: 1, gravita: "grave", anno: `${nomeAnno(false)} / ${nomeAnno(true)}`, sezione: "Tab 9 · Dati & Validazione T-1",
            voce: lista[0].nome,
            idVoce: gemelle[0].id, esercizio: "precedente",
            autoFix: asaT
              ? { tipo: "cambiaAsa", nuovaAsa: asaT, etichetta: `✨ Allinea ${nomeAnno(true)} all'ASA «${asaT}»` }
              : null,
            errore: `ERRORE GRAVE — ASA disallineata fra gli esercizi: ${asaT || "nessuna"} in ${nomeAnno(false)}, ${asaT1 || "nessuna"} in ${nomeAnno(true)}. Il Segment Reporting confronta perimetri diversi.`,
            azione: asaT
              ? `Assegna l'ASA «${asaT}» anche nell'esercizio ${nomeAnno(true)} (tab 9).`
              : `Assegna l'ASA «${asaT1}» anche nell'esercizio ${nomeAnno(false)} (tab 1), oppure rimuovila da ${nomeAnno(true)}.`,
          });
        }
      });
      mapT1.forEach((lista, chiave) => {
        if (mapT.has(chiave)) return;
        agg({
          controllo: 1, gravita: "info", anno: nomeAnno(true), sezione: sezione(true),
          voce: lista[0].nome,
          errore: `La voce non trova corrispondenza in ${nomeAnno(false)}: potrebbe essere una posta cessata oppure rinominata.`,
          azione: `Verifica in ${nomeAnno(false)} se la stessa posta compare sotto un altro nome e allinea la denominazione.`,
        });
      });
    } else {
      agg({
        controllo: 1, gravita: "info", anno: "—", sezione: "Tab 1 e Tab 9",
        voce: "(nessuna)",
        errore: "Controllo non applicabile: manca il piano voci di uno dei due esercizi.",
        azione: "Carica anche il bilancio comparativo per abilitare il confronto fra esercizi.",
      });
    }

    /* ---- Controllo 2 · quadratura delle riallocazioni per natura ---- */
    const saldoClasse = (vs, classe) =>
      vs.filter((v) => v.classe === classe).reduce((a, v) => a + (Number(v.importo) || 0), 0);

    const verificaRiall = (rialls, vsOriginali, prec) => {
      const lista = rialls || [];
      if (!lista.length) return { presenti: 0, storni: 0, destinazioni: 0 };
      let storni = 0;
      let destinazioni = 0;
      const perOrigine = {};
      lista.forEach((r) => {
        const imp = Number(r.importo) || 0;
        const abs = Math.abs(imp);
        storni += abs;
        destinazioni += abs;
        perOrigine[r.classeOrigine] = (perOrigine[r.classeOrigine] || 0) + abs;

        if (!(imp > 0))
          agg({
            controllo: 2, gravita: "grave", anno: nomeAnno(prec), sezione: prec ? "Tab 2 · NI (T-1)" : "Tab 2 · Nota Integrativa",
            voce: r.descrizione,
            errore: `Riallocazione con importo ${imp === 0 ? "nullo" : "negativo"} (${imp}). L'importo va indicato come valore assoluto: il segno lo genera l'applicazione, negativo sullo storno e positivo sulla destinazione.`,
            azione: `Correggi l'importo della riallocazione «${r.descrizione}» indicando il valore assoluto.`,
          });
        if (r.classeOrigine === r.classeDestinazione)
          agg({
            controllo: 2, gravita: "grave", anno: nomeAnno(prec), sezione: prec ? "Tab 2 · NI (T-1)" : "Tab 2 · Nota Integrativa",
            voce: r.descrizione,
            errore: `Classe di origine e di destinazione coincidenti (${r.classeOrigine}): la riallocazione genera due voci che si annullano e non produce alcun effetto.`,
            azione: `Correggi la classe di destinazione, oppure rimuovi la riallocazione «${r.descrizione}».`,
          });
        if (!CLASSI[r.classeOrigine] || !CLASSI[r.classeDestinazione])
          agg({
            controllo: 2, gravita: "grave", anno: nomeAnno(prec), sezione: prec ? "Tab 2 · NI (T-1)" : "Tab 2 · Nota Integrativa",
            voce: r.descrizione,
            errore: `Classe non riconosciuta (origine ${r.classeOrigine}, destinazione ${r.classeDestinazione}): la riallocazione non viene applicata al prospetto.`,
            azione: `Rimuovi la riallocazione «${r.descrizione}» e reinseriscila scegliendo le classi dalla tendina.`,
          });
        if (!AUDIT_CLASSI_NATURA.includes(r.classeDestinazione))
          agg({
            controllo: 2, gravita: "medio", anno: nomeAnno(prec), sezione: prec ? "Tab 2 · NI (T-1)" : "Tab 2 · Nota Integrativa",
            voce: r.descrizione,
            errore: `Destinazione ${r.classeDestinazione}: non è una classe per natura. Lo scopo della riallocazione IAS 1.104 è isolare PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, GODIMENTO, ONERI_DIVERSI e ONERI_FIN (oneri finanziari captive o IFRS 16) dalle macro-voci funzionali.`,
            azione: `Verifica la destinazione della riallocazione «${r.descrizione}»: se il costo è di natura mista, spezzalo in più riallocazioni.`,
          });
      });

      /* Sovra-riallocazione: gli storni cumulati su una classe non possono
         eccedere il saldo lordo della classe stessa, altrimenti il costo
         funzionale diventa negativo (un ricavo). */
      Object.entries(perOrigine).forEach(([classe, stornato]) => {
        const saldo = Math.abs(saldoClasse(vsOriginali, classe));
        if (stornato > saldo + 1e-6)
          agg({
            controllo: 2, gravita: "grave", anno: nomeAnno(prec), sezione: prec ? "Tab 2 · NI (T-1)" : "Tab 2 · Nota Integrativa",
            voce: `Riallocazioni con origine ${classe}`,
            errore: `Storni cumulati (${stornato.toLocaleString("it-IT")}) superiori al saldo della classe ${classe} (${saldo.toLocaleString("it-IT")}): la macro-voce funzionale diventa negativa e il Valore Aggiunto risulta gonfiato.`,
            azione: `Riduci gli importi riallocati con origine ${classe} entro il saldo disponibile, oppure verifica di non aver riallocato due volte lo stesso costo.`,
          });
      });

      return { presenti: lista.length, storni, destinazioni };
    };

    const quadraturaT = verificaRiall(niRiallocazioni, vociT, false);
    const quadraturaT1 = verificaRiall(niRiallocazioniPrec, vociT1, true);

    /* ---- Controllo 3 · segno delle rettifiche di normalizzazione ---- */
    const verificaSegni = (retts, prec, origine) => {
      (retts || []).forEach((r) => {
        const imp = Number(r.importo) || 0;
        const natura = auditNaturaPosta(r.descrizione);
        const tipo = r.tipo === "extra_gestione" ? "extra-gestione" : "special item";
        if (imp === 0) {
          agg({
            controllo: 3, gravita: "medio", anno: nomeAnno(prec), sezione: origine,
            voce: r.descrizione,
            errore: `Rettifica di importo nullo: non produce alcuno storno e sporca l'elenco delle normalizzazioni.`,
            azione: `Inserisci l'importo corretto della rettifica «${r.descrizione}» oppure rimuovila.`,
          });
          return;
        }
        if (natura === "onere" && imp > 0)
          agg({
            controllo: 3, gravita: "grave", anno: nomeAnno(prec), sezione: origine,
            voce: r.descrizione,
            errore: `Segno errato — la posta è un onere ma è registrata come ${tipo} con importo POSITIVO (${imp.toLocaleString("it-IT")}). Lo storno di un costo non ricorrente deve essere NEGATIVO: così com'è, l'Earnings Power viene ridotto invece che ripulito.`,
            azione: `Correggi l'importo della rettifica «${r.descrizione}» in ${(-Math.abs(imp)).toLocaleString("it-IT")}.`,
          });
        if (natura === "provento" && imp < 0)
          agg({
            controllo: 3, gravita: "grave", anno: nomeAnno(prec), sezione: origine,
            voce: r.descrizione,
            errore: `Segno errato — la posta è un provento ma è registrata come ${tipo} con importo NEGATIVO (${imp.toLocaleString("it-IT")}). Lo storno di un ricavo non ricorrente deve essere POSITIVO.`,
            azione: `Correggi l'importo della rettifica «${r.descrizione}» in ${Math.abs(imp).toLocaleString("it-IT")}.`,
          });
        if (!["special_item", "extra_gestione"].includes(r.tipo))
          agg({
            controllo: 3, gravita: "medio", anno: nomeAnno(prec), sezione: origine,
            voce: r.descrizione,
            errore: `Tipo di rettifica non riconosciuto (${r.tipo || "assente"}): l'applicazione la tratta come special item riallocandola in NON_CORRENTE.`,
            azione: `Verifica che «${r.descrizione}» sia una posta non ricorrente (special item) o di contabilità creativa (extra-gestione) e reinseriscila con il tipo corretto.`,
          });
      });
    };

    verificaSegni(niRettifiche, false, "Tab 2 · Nota Integrativa");
    verificaSegni(rgRettifiche, false, "Tab 3 · Relazione sulla Gestione");
    verificaSegni(niRettifichePrec, true, "Tab 2 · NI (T-1)");
    verificaSegni(rgRettifichePrec, true, "Tab 3 · RG (T-1)");

    /* ---- Controllo 4 · plausibilità dei delta economici ---- */
    if (deltaEconomici.disponibile) {
      /* Attribuzione della variazione: si confrontano i saldi per classe fra i
         due esercizi, così una distorsione da cambio di classificazione emerge
         come coppia di scostamenti uguali e opposti. */
      const classiTutte = new Set([...vociT, ...vociT1].map((v) => v.classe));
      const scostamenti = [...classiTutte]
        .map((c) => ({ classe: c, delta: saldoClasse(vociT, c) - saldoClasse(vociT1, c) }))
        .filter((x) => Math.abs(x.delta) > 1e-9)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      ["valoreAggiunto", "ebitda", "ebit"].forEach((chiave) => {
        const d = deltaEconomici[chiave];
        if (!d) return;
        const inversione = d.corrente * d.precedente < 0;
        const esplosione = d.percentuale != null && Math.abs(d.percentuale) > AUDIT_SOGLIA_DELTA_PCT;
        if (!inversione && !esplosione) return;

        const principali = scostamenti.slice(0, 3).map((s) => `${s.classe} (${s.delta > 0 ? "+" : ""}${Math.round(s.delta).toLocaleString("it-IT")})`).join(", ");
        const sospetta = classiIncoerenti.length
          ? ` Attenzione: ${classiIncoerenti.length} voce/i risultano classificate diversamente nei due anni (${classiIncoerenti.slice(0, 3).map((c) => `«${c.nome}»`).join(", ")}): è la causa più probabile della distorsione.`
          : "";
        agg({
          controllo: 4, gravita: classiIncoerenti.length ? "grave" : "medio", anno: `${nomeAnno(true)} → ${nomeAnno(false)}`, sezione: "Tab 11 · Variazioni e Trend",
          voce: d.label,
          errore: `${inversione ? "Inversione di segno" : "Variazione anomala"} del margine: ${Math.round(d.precedente).toLocaleString("it-IT")} → ${Math.round(d.corrente).toLocaleString("it-IT")}${d.percentuale != null ? ` (${d.percentuale > 0 ? "+" : ""}${d.percentuale.toFixed(1)}%)` : ""}. Classi che pesano di più sullo scostamento: ${principali || "n/d"}.${sospetta}`,
          azione: classiIncoerenti.length
            ? `Prima di interpretare il Δ, allinea le classi segnalate dal controllo 1: la variazione va riletta a classificazione omogenea.`
            : `Verifica che la variazione abbia una spiegazione economica (volumi, prezzi, perimetro) e non derivi da una diversa classificazione: se è ricorrente va commentata, altrimenti valuta una rettifica di normalizzazione.`,
        });
      });
    }

    /* ---- Controllo 5 · voci orfane (DA_CLASSIFICARE) ---- */
    const verificaOrfane = (vs, gemelle, prec) => {
      vs.filter((v) => v.classe === "DA_CLASSIFICARE").forEach((v) => {
        const suggerita = auditSuggerisciClasse(v.nome);
        const gemella = gemelle.find(
          (g) => auditNormalizzaNome(g.nome) === auditNormalizzaNome(v.nome) && g.classe !== "DA_CLASSIFICARE"
        );
        const classeFinale = gemella?.classe || suggerita;
        const asaFinale = gemella?.asa || null;
        agg({
          controllo: 5, gravita: "grave", anno: nomeAnno(prec), sezione: sezione(prec),
          voce: v.nome || "(voce senza nome)",
          idVoce: v.id, esercizio: prec ? "precedente" : "corrente",
          /* La classe proposta viene dalla voce gemella dell'altro esercizio
             (più affidabile) o, in mancanza, dal vocabolario a regex. Senza
             né l'una né l'altra non c'è nulla da automatizzare. */
          autoFix: classeFinale
            ? {
                tipo: "cambiaClasse", nuovaClasse: classeFinale,
                nuovaAsa: CLASSI[classeFinale]?.asa ? asaFinale : null,
                etichetta: `✨ Classifica in ${classeFinale}`,
              }
            : null,
          errore: `Voce orfana: resta in DA_CLASSIFICARE ed è quindi ESCLUSA da tutti i calcoli. Importo non considerato: ${Math.round(Number(v.importo) || 0).toLocaleString("it-IT")}.`,
          azione: classeFinale
            ? `Cambia la classe dalla tendina in ${classeFinale}${gemella ? ` (come la voce omonima dell'altro esercizio)` : ` (suggerita dal nome della voce)`}${asaFinale ? ` e assegna l'ASA «${asaFinale}»` : CLASSI[classeFinale]?.asa ? " e assegna l'ASA di pertinenza" : ""}.`
            : `Assegna una classe dalla tendina: il nome della voce non consente di dedurla automaticamente.`,
        });
      });
    };
    verificaOrfane(vociT, vociT1, false);
    verificaOrfane(vociT1, vociT, true);

    const gravi = rilievi.filter((r) => r.gravita === "grave").length;
    const medi = rilievi.filter((r) => r.gravita === "medio").length;
    return {
      rilievi,
      gravi,
      medi,
      info: rilievi.length - gravi - medi,
      quadraturaT,
      quadraturaT1,
      dueAnni,
      superato: gravi === 0 && medi === 0,
    };
  }, [
    voci, vociPrec, niRettifiche, niRettifichePrec, rgRettifiche, rgRettifichePrec,
    niRiallocazioni, niRiallocazioniPrec, deltaEconomici, esercizio, esercizioPrec,
  ]);

  /* ---- Secondo strato: revisione IA auto-apprendente con auto-fix ----
     Lo stato conserva sia le `anomalie` strutturate (che alimentano le card
     con i pulsanti «Correggi» e «Insegna») sia `righe`, la vista appiattita
     che tiene in vita, senza modifiche, auditTestuale() e il pulsante
     «Copia l'audit». ---- */
  const [auditIA, setAuditIA] = useState({
    loading: false, errore: null, righe: null, sintesi: null, esito: null,
    anomalie: null, scartate: 0, quando: null, messaggioGenerale: null,
  });

  /* Elenco compatto con id espliciti: l'IA deve poter referenziare la voce
     esatta da correggere, non il nome (ambiguo e talvolta duplicato).
     Gli importi vanno in forma NUMERICA GREZZA: il punto 7 della checklist
     ragiona sugli ordini di grandezza e la formattazione italiana sarebbe
     ambigua. Si escludono le voci sintetiche generate da rettifiche e
     riallocazioni, che l'utente non può correggere a mano. */
  const elencoVociAudit = (arr) => {
    const vs = vociOriginali(arr);
    return vs.length
      ? vs
          .map((v) => `[${v.id}] ${v.nome} | ${Number(v.importo) || 0} | ${v.classe} | ${v.asa || "—"}`)
          .join("\n")
      : "(nessuna voce presente per questo esercizio)";
  };

  /* ============================================================
     AUDIT UNIFICATO — fusione dei due strati
     ============================================================
     Un solo elenco di anomalie, due fonti. I controlli
     deterministici (fonte "auto") sono sempre presenti, gratuiti e
     ricalcolati a ogni modifica; la revisione IA (fonte "ia") si
     aggiunge su richiesta. Quando entrambi colpiscono la STESSA
     voce sullo STESSO punto di checklist le due segnalazioni non
     vengono mostrate due volte: si fondono in una sola card
     (fonte "auto+ia"), che tiene l'auto-fix più informato dei due
     e la regola da insegnare, che solo l'IA sa produrre.
     ============================================================ */
  const auditUnificato = useMemo(() => {
    const items = [];
    const perAncora = new Map(); // "esercizio:idVoce:controllo" → item già presente

    const indiceVoci = new Map();
    vociOriginali(voci).forEach((v) => indiceVoci.set(v.id, { voce: v, esercizio: "corrente" }));
    vociOriginali(vociPrec).forEach((v) => indiceVoci.set(v.id, { voce: v, esercizio: "precedente" }));

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
           insistere sulla stessa voce e sullo stesso controllo (classe e ASA
           disallineate), quindi l'indice resta come discriminante. */
        key: `auto_${i}_${controllo}_${idVoce || "x"}`,
        fonte: "auto",
        controllo,
        gravita: r.gravita,
        titolo: CHECKLIST_CE[controllo] || "Rilievo",
        voce: r.voce,
        idVoce,
        esercizio: idVoce ? r.esercizio : null,
        importo: hit ? Number(hit.voce.importo) || 0 : null,
        classeAttuale: hit ? hit.voce.classe : null,
        asaAttuale: hit ? hit.voce.asa || null : null,
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
      const azione = a.autoFix?.eseguibile
        ? elimina_
          ? "Elimina la voce dal prospetto: non appartiene al Conto Economico o è un duplicato."
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
            tipo: elimina_ ? "elimina" : "cambiaClasse",
            nuovaClasse: elimina_ ? null : a.autoFix.nuovaClasse,
            etichetta: elimina_ ? "✨ Elimina in automatico" : `✨ Correggi in ${a.autoFix.nuovaClasse}`,
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
        titolo: a.titoloErrore || CHECKLIST_CE[a.controllo] || "Anomalia rilevata",
        voce: a.nomeVoce,
        idVoce: a.idVoce,
        esercizio: a.esercizio,
        importo: a.importo,
        classeAttuale: a.classeAttuale,
        asaAttuale: a.asaAttuale,
        anno: a.esercizio === "corrente" ? esercizio || "T" : esercizioPrec || "T-1",
        sezione: a.esercizio === "corrente" ? "Tab 1 · Dati & Validazione" : "Tab 9 · Dati & Validazione T-1",
        tab: a.esercizio === "corrente" ? 1 : 10,
        errore: a.spiegazioneErrore,
        azione,
        autoFix: a.autoFix?.eseguibile
          ? {
              eseguibile: true,
              tipo: elimina_ ? "elimina" : "cambiaClasse",
              nuovaClasse: elimina_ ? null : a.autoFix.nuovaClasse,
              etichetta: elimina_ ? "🗑 Elimina in automatico" : `✨ Correggi in ${a.autoFix.nuovaClasse}`,
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
    if (!vociOriginali(voci).length && !vociOriginali(vociPrec).length) {
      setAuditIA((s) => ({ ...s, errore: "Nessuna voce da controllare: carica e valida almeno un esercizio nel tab «Dati & Validazione»." }));
      return;
    }
    setAuditIA({
      loading: true, errore: null, righe: null, sintesi: null, esito: null,
      anomalie: null, scartate: 0, quando: null, messaggioGenerale: null,
    });
    setAuditAzioni({});
    try {
      const aggregatiCompatti = (c) => ({
        ricavi: c.ricavi, valoreProduzione: c.valoreProduzione, valoreAggiunto: c.valoreAggiunto,
        ebitda: c.ebitda, ebit: c.ebit, risultatoCorrente: c.risultatoCorrente, utileNetto: c.utileNetto,
      });

      /* Contesto analitico: resta identico a prima (aggregati, rettifiche,
         riallocazioni, delta, rilievi deterministici). Le VOCI viaggiano
         invece negli elenchi con id, non più qui, per non duplicarle. */
      const dati = {
        azienda,
        schemaCE,
        asaDisponibili: asaList,
        esercizioCorrente: {
          esercizio,
          aggregati: aggregatiCompatti(calc),
          rettifiche: [...(niRettifiche || []), ...(rgRettifiche || [])],
          riallocazioni: niRiallocazioni || [],
        },
        esercizioPrecedente: {
          esercizio: esercizioPrec,
          aggregati: aggregatiCompatti(calcPrec),
          rettifiche: [...(niRettifichePrec || []), ...(rgRettifichePrec || [])],
          riallocazioni: niRiallocazioniPrec || [],
        },
        deltaEconomici: deltaEconomici.disponibile ? deltaEconomici.elenco : null,
        /* I rilievi deterministici viaggiano già rinumerati sulla scala
           canonica in 8 punti, la stessa che il prompt chiede di usare: senza
           la rimappatura il modello leggerebbe «controllo 2» intendendo le
           duplicazioni mentre l'applicazione intende le riallocazioni. */
        rilieviAutomatici: auditLocale.rilievi.map((r) => ({
          controllo: CONTROLLO_UNIFICATO[r.controllo] || r.controllo,
          gravita: r.gravita, voce: r.voce, errore: r.errore,
        })),
      };

      const schemaTxt = schemaCE
        ? `SCHEMA CONTABILE RICONOSCIUTO: ${String(schemaCE.schema || "").toUpperCase()} · ${schemaCE.formato || "formato non specificato"}${schemaCE.valuta ? ` — valuta ${schemaCE.valuta}` : ""}${schemaCE.unita ? ` — importi espressi in ${schemaCE.unita}` : ""}.${SCHEMI_CE[`${schemaCE.schema}_${schemaCE.formato}`] ? `\nREGOLE DELLO SCHEMA DA FAR RISPETTARE:\n${SCHEMI_CE[`${schemaCE.schema}_${schemaCE.formato}`].regole.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}` : ""}`
        : `SCHEMA CONTABILE NON RICONOSCIUTO: applica il principio di prevalenza della sostanza economica sulla forma.${schemaRilevato ? ` Lo schema dichiarato dall'estrazione è «${schemaRilevato}».` : ""}`;

      const classiTxt = Object.entries(CLASSI)
        .map(([k, v]) => `- ${k}: ${v.label}`)
        .join("\n");

      const prompt = buildAuditPromptCE({
        annoCorr: esercizio || "T",
        annoPrec: esercizioPrec || "T-1",
        vociTxt: elencoVociAudit(voci),
        vociPrecTxt: elencoVociAudit(vociPrec),
        schemaTxt,
        classiTxt,
        regoleTxt: bloccoRegoleCE(systemPrompts.regoleApprese),
        datiTxt: JSON.stringify(dati),
      });

      const raw = await chiamaIA({ provider, apiKey, model: modello[provider], prompt });
      const data = parseJsonRobusto(raw);

      const anomalie = sanificaAnomalieCE(data, vociOriginali(voci), vociOriginali(vociPrec));
      const esito = anomalie.length === 0 ? "superato" : "errori";
      const grezze = Array.isArray(data?.anomalie) ? data.anomalie.length : 0;

      /* Vista appiattita per «Copia l'audit»: nessuna modifica a auditTestuale(). */
      const righe = anomalie.map((a) => ({
        anno: a.esercizio === "corrente" ? esercizio : esercizioPrec,
        sezione: a.esercizio === "corrente" ? "Tab 1 · Dati & Validazione" : "Tab 9 · Dati & Validazione T-1",
        voce: a.nomeVoce,
        errore: a.spiegazioneErrore,
        azione: a.autoFix.eseguibile
          ? a.autoFix.nuovaClasse === "ELIMINA"
            ? "Elimina la voce dal prospetto (non appartiene al Conto Economico o è un duplicato)"
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
      return "Audit superato. Il Conto Economico è coerente tra gli anni, le rettifiche/riallocazioni quadrano matematicamente e le variazioni sono fluide. Nessuna correzione manuale richiesta.";
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


  /* Con Claude la chiave può anche non esserci nel browser: il proxy
     /api/anthropic ricade sulla variabile d'ambiente dell'hosting. Per questo
     il provider resta "attivo" anche a campo vuoto — sarà semmai il server a
     rispondere con un errore parlante. */
  const apiKey = provider === "claude" ? chiavi.claude || "" : chiavi[provider];
  const iaAttiva = provider === "claude" || !!chiavi[provider];

  /* ---- azioni voci ---- */
  const aggiorna = (id, patch) =>
    setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const elimina = (id) => setVoci((vs) => vs.filter((v) => v.id !== id));
  const aggiungi = (sezione) =>
    setVoci((vs) => [
      ...vs,
      { id: nuovoId(), nome: "", importo: 0, classe: "DA_CLASSIFICARE", asa: null, sezionePreferita: sezione },
    ]);

  /* ---- azioni voci · esercizio precedente (T-1) ---- */
  const aggiornaPrec = (id, patch) =>
    setVociPrec((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const eliminaPrec = (id) => setVociPrec((vs) => vs.filter((v) => v.id !== id));
  const aggiungiPrec = (sezione) =>
    setVociPrec((vs) => [
      ...vs,
      { id: nuovoId(), nome: "", importo: 0, classe: "DA_CLASSIFICARE", asa: null, sezionePreferita: sezione },
    ]);

  /* ============================================================
     TAB 13 · AZIONI DELL'AUDIT AUTO-APPRENDENTE
     ============================================================
     ✨ auditCorreggi riusa gli editor esistenti delle voci (aggiorna /
     elimina e i gemelli T-1), così l'intera catena reattiva — calc,
     calcPrec, deltaEconomici, auditLocale — si ricalcola da sola senza
     alcuna scorciatoia sui dati. Caso speciale "ELIMINA": la voce non
     appartiene al Conto Economico (inquinamento da Rendiconto/OCI) o è un
     duplicato, quindi va rimossa anziché riclassificata. ---- */
  const auditCorreggi = (an) => {
    const fix = an?.autoFix;
    if (!fix?.eseguibile || !an.idVoce) return;
    const prec = an.esercizio === "precedente";
    const scrivi = prec ? aggiornaPrec : aggiorna;

    if (fix.tipo === "elimina") {
      (prec ? eliminaPrec : elimina)(an.idVoce);
    } else if (fix.tipo === "cambiaAsa") {
      scrivi(an.idVoce, { asa: fix.nuovaAsa || null });
    } else if (fix.tipo === "cambiaClasse" && fix.nuovaClasse) {
      scrivi(an.idVoce, {
        classe: fix.nuovaClasse,
        /* l'ASA sopravvive solo se la nuova classe la prevede ancora; se il
           fix ne porta una esplicita (voce orfana allineata alla gemella)
           quella vince. */
        asa: CLASSI[fix.nuovaClasse]?.asa ? fix.nuovaAsa ?? an.asaAttuale ?? null : null,
      });
    } else return;

    setAuditAzioni((st) => ({ ...st, [an.key]: { ...(st[an.key] || {}), fix: true } }));
  };

  /* 🧠 auditInsegna: la regola viene appesa ai prompt di sistema e persistita
     nel localStorage. Da quel momento entra in TUTTE le estrazioni successive
     (buildCePrompt e MASTER_PROMPT), anche su bilanci di aziende diverse.
     Non agisce retroattivamente sui dati già in memoria. ---- */
  const auditInsegna = (an) => {
    const sug = an?.promptUpdateSuggestion;
    if (!sug) return;
    salvaSystemPrompts(applicaRegolaAppresa(systemPrompts, sug));
    setAuditAzioni((st) => ({ ...st, [an.key]: { ...(st[an.key] || {}), learn: true } }));
  };

  /* ---- azioni ASA ---- */
  const aggiungiAsa = () => setAsaList((l) => [...l, `ASA ${l.length + 1}`]);
  const rinominaAsa = (i, nuovo) => {
    const vecchio = asaList[i];
    setAsaList((l) => l.map((a, j) => (j === i ? nuovo : a)));
    setVoci((vs) => vs.map((v) => (v.asa === vecchio ? { ...v, asa: nuovo } : v)));
  };
  const eliminaAsa = (i) => {
    const nome = asaList[i];
    setAsaList((l) => l.filter((_, j) => j !== i));
    setVoci((vs) => vs.map((v) => (v.asa === nome ? { ...v, asa: null } : v)));
  };

  const caricaEsempio = () => {
    setVoci(ESEMPIO.voci.map((v) => ({ ...v, id: nuovoId(), asa: v.asa || null })));
    setAsaList(ESEMPIO.asa);
    setAzienda(ESEMPIO.azienda);
    setEsercizio(ESEMPIO.esercizio);
    setFonte(`«${ESEMPIO.fonte}» (${ESEMPIO.voci.length} voci)`);
    setSchemaRilevato(SCHEMI_CE.ifrs_per_natura.label);
    setSchemaCE({ schema: "ifrs", formato: "per_natura", valuta: "EUR", unita: "migliaia", indizi: "Terminologia IASB, right-of-use IFRS 16, financial services separati." });
    setStatoIA(null);
    /* ---- Esercizio precedente dimostrativo ----
       Ricavi al 88% e costi al 92% dell'anno corrente: l'esempio mostra
       una crescita dei ricavi accompagnata da un miglioramento dei
       margini, così il tab dei Δ economici è immediatamente leggibile. ---- */
    const RICAVO_CLASSI_ES = ["RICAVI", "VAR_RIM_PF", "LAVORI_INTERNI", "ALTRI_RICAVI", "PROVENTI_FIN", "PROVENTI_ACCESSORI"];
    setVociPrec(
      ESEMPIO.voci.map((v) => ({
        ...v,
        id: nuovoId(),
        asa: v.asa || null,
        importo: Math.round(v.importo * (RICAVO_CLASSI_ES.includes(v.classe) ? 0.88 : 0.92)),
      }))
    );
    setEsercizioPrec("31/12/2024");
    setFontePrec(`«${ESEMPIO.fonte}» — esercizio precedente dimostrativo (${ESEMPIO.voci.length} voci)`);
    setSchemaRilevatoPrec(SCHEMI_CE.ifrs_per_natura.label);
    setCreditiClienti({ corrente: "1450", precedente: "1120", pagina: null, auto: false });
    setStatoIAPrec(null);
  };

  const azzera = () => {
    setVoci([]);
    setAsaList([]);
    setFonte(null);
    setSchemaRilevato(null);
    setSchemaCE(null);
    setNiEstratti([]);
    setNiFonte(null);
    setNiRettifiche([]);
    setNiRiallocazioni([]);
    setNiRedFlags([]);
    setRgEstratti([]);
    setRgFonte(null);
    setRgRettifiche([]);
    setRgRedFlags([]);
    setCreditiClienti({ corrente: "", precedente: "", pagina: null, auto: false });
    setValutazione({ equity: "", pfn: "", leasing: "" });
    setStatoIA(null);
    /* ---- azzeramento dell'esercizio precedente (T-1) ---- */
    setVociPrec([]);
    setFontePrec(null);
    setSchemaRilevatoPrec(null);
    setNiEstrattiPrec([]);
    setNiFontePrec(null);
    setNiRettifichePrec([]);
    setNiRiallocazioniPrec([]);
    setNiRedFlagsPrec([]);
    setRgEstrattiPrec([]);
    setRgFontePrec(null);
    setRgRettifichePrec([]);
    setRgRedFlagsPrec([]);
    setStatoIAPrec(null);
  };

  /* ---- normalizzazione: applica gli storni al piano delle voci ----
     Per ogni rettifica genera una coppia di voci in partita doppia:
     (a) storno nella classe di origine (rimuove la posta dalla gestione
         corrente → i margini di tab 3 diventano automaticamente
         l'Earnings Power normalizzato);
     (b) riallocazione "sotto la linea" in NON_CORRENTE (special items)
         o EXTRA_GESTIONE (window dressing).
     L'utile netto contabile resta invariato: cambia solo dove il valore
     è esposto nel prospetto riclassificato. ---- */
  /* `attiva === false` disattiva la singola rettifica senza cancellarla: la
     posta resta nell'elenco, con la sua motivazione e il riferimento di pagina,
     ma non genera più la coppia di voci in partita doppia. Le rettifiche prive
     del campo (quelle estratte prima di questa versione) restano attive. */
  const costruisciVociRettificate = (vs, retts) => {
    const base = vs.filter((v) => !v.rettificaNI);
    const nuove = [];
    (retts || []).filter((r) => r.attiva !== false).forEach((r) => {
      const origine = r.classeOrigine || (r.importo >= 0 ? "ALTRI_RICAVI" : "ONERI_DIVERSI");
      const lato = RICAVI_CLASSI.includes(origine) ? -1 : 1;
      nuove.push({
        id: nuovoId(), rettificaNI: true, asa: null,
        nome: `Storno NI: ${r.descrizione}`,
        importo: lato * r.importo,
        classe: origine,
      });
      nuove.push({
        id: nuovoId(), rettificaNI: true, asa: null,
        nome: `${r.tipo === "extra_gestione" ? "Extra-gestione" : "Special item"} NI: ${r.descrizione}`,
        importo: r.importo,
        classe: r.tipo === "extra_gestione" ? "EXTRA_GESTIONE" : "NON_CORRENTE",
      });
    });
    return [...base, ...nuove];
  };

  const applicaRettifiche = (retts) => setVoci((vs) => costruisciVociRettificate(vs, retts));
  /* gemello T-1: stessa partita doppia applicata al piano voci precedente */
  const applicaRettifichePrec = (retts) => setVociPrec((vs) => costruisciVociRettificate(vs, retts));

  const rimuoviRettifica = (idx) => {
    const rimaste = niRettifiche.filter((_, i) => i !== idx);
    setNiRettifiche(rimaste);
    // Ri-applica le NI residue insieme alle rettifiche della Relazione sulla
    // Gestione, così lo storno di una posta NI non cancella gli special items RG.
    applicaRettifiche([...rimaste, ...rgRettifiche]);
  };

  /* ---- riallocazione per natura (IAS 1.104): funzione → natura ----
     Converte un CE per funzione in uno per natura tramite coppie in
     partita doppia: (a) storno del costo dalla classe funzionale di
     origine (importo negativo: riduce ACQUISTI/SERVIZI/…); (b) pari
     imputazione alla classe per natura di destinazione (PERSONALE,
     AMMORTAMENTI, …). Il totale costi — e quindi l'utile netto — resta
     invariato: cambia solo la collocazione, rendendo calcolabili
     Valore Aggiunto ed EBITDA. Le voci generate hanno il flag
     riallocazioneNI, distinto da rettificaNI, così i due meccanismi
     non si sovrascrivono a vicenda. ---- */
  /* Stessa logica di attivazione delle rettifiche: `attiva === false` sospende
     la riallocazione lasciandola visibile nell'elenco. */
  const costruisciVociRiallocate = (vs, rialls) => {
    const base = vs.filter((v) => !v.riallocazioneNI);
    const nuove = [];
    (rialls || []).filter((r) => r.attiva !== false).forEach((r) => {
      const imp = Math.abs(Number(r.importo) || 0);
      if (!imp) return;
      /* Classi non riconosciute — o svuotate dai select di correzione manuale —
         non producono scritture: la riallocazione resta visibile nell'elenco e
         il controllo 5 la segnala come non applicata al prospetto. */
      if (!CLASSI[r.classeOrigine] || !CLASSI[r.classeDestinazione]) return;
      nuove.push({
        id: nuovoId(), riallocazioneNI: true, asa: null,
        nome: `Riall. natura (storno): ${r.descrizione}`,
        importo: -imp,
        classe: r.classeOrigine,
      });
      nuove.push({
        id: nuovoId(), riallocazioneNI: true, asa: null,
        nome: `Riall. natura: ${r.descrizione}`,
        importo: imp,
        classe: r.classeDestinazione,
      });
    });
    return [...base, ...nuove];
  };

  const applicaRiallocazioni = (rialls) => setVoci((vs) => costruisciVociRiallocate(vs, rialls));
  /* gemello T-1 */
  const applicaRiallocazioniPrec = (rialls) => setVociPrec((vs) => costruisciVociRiallocate(vs, rialls));

  const rimuoviRiallocazione = (idx) => {
    const rimaste = niRiallocazioni.filter((_, i) => i !== idx);
    setNiRiallocazioni(rimaste);
    applicaRiallocazioni(rimaste);
  };

  /* ---- Attivazione e disattivazione di rettifiche e riallocazioni ----
     Ogni interruttore ribalta il flag `attiva` della singola posta e ri-applica
     l'intera lista della famiglia interessata, così il prospetto si aggiorna
     subito. Le rettifiche NI e RG condividono lo stesso piano voci e vanno
     quindi sempre riapplicate insieme, altrimenti disattivare una posta NI
     cancellerebbe gli special item della Relazione sulla Gestione. */
  const commutaAttiva = (lista, idx) =>
    lista.map((r, i) => (i === idx ? { ...r, attiva: r.attiva === false } : r));

  const toggleRettificaNI = (idx) => {
    const nuove = commutaAttiva(niRettifiche, idx);
    setNiRettifiche(nuove);
    applicaRettifiche([...nuove, ...rgRettifiche]);
  };
  const toggleRettificaRG = (idx) => {
    const nuove = commutaAttiva(rgRettifiche, idx);
    setRgRettifiche(nuove);
    applicaRettifiche([...niRettifiche, ...nuove]);
  };
  const toggleRiallocazioneNI = (idx) => {
    const nuove = commutaAttiva(niRiallocazioni, idx);
    setNiRiallocazioni(nuove);
    applicaRiallocazioni(nuove);
  };

  /* gemelli T-1 */
  const toggleRettificaNIPrec = (idx) => {
    const nuove = commutaAttiva(niRettifichePrec, idx);
    setNiRettifichePrec(nuove);
    applicaRettifichePrec([...nuove, ...rgRettifichePrec]);
  };
  const toggleRettificaRGPrec = (idx) => {
    const nuove = commutaAttiva(rgRettifichePrec, idx);
    setRgRettifichePrec(nuove);
    applicaRettifichePrec([...niRettifichePrec, ...nuove]);
  };
  const toggleRiallocazioneNIPrec = (idx) => {
    const nuove = commutaAttiva(niRiallocazioniPrec, idx);
    setNiRiallocazioniPrec(nuove);
    applicaRiallocazioniPrec(nuove);
  };

  /* ---- Correzione manuale delle classi di una riallocazione ----
     L'estrazione IA può sbagliare la classe di origine (tipico: storno da una
     macro-voce funzionale che nel CE estratto è vuota) o quella di
     destinazione. Finora l'unico rimedio era esportare il JSON, correggerlo a
     mano e ri-importarlo. Queste due funzioni scrivono il campo direttamente
     nello stato e ri-applicano subito l'intera lista, così le due scritture in
     partita doppia (storno negativo sull'origine, addebito positivo sulla
     destinazione) vengono ricostruite sul piano voci senza passaggi manuali. */
  const modificaRiallocazioneNI = (idx, campo, nuovoValore) => {
    const nuova = niRiallocazioni.map((r, i) => (i === idx ? { ...r, [campo]: nuovoValore } : r));
    setNiRiallocazioni(nuova);
    applicaRiallocazioni(nuova);
  };

  /* gemello T-1 */
  const modificaRiallocazioneNIPrec = (idx, campo, nuovoValore) => {
    const nuova = niRiallocazioniPrec.map((r, i) => (i === idx ? { ...r, [campo]: nuovoValore } : r));
    setNiRiallocazioniPrec(nuova);
    applicaRiallocazioniPrec(nuova);
  };


  /* ---- estrazione Nota Integrativa (4 sezioni tematiche) ----
     Architettura a fasi gemella di quella dello Stato Patrimoniale:
     `processNi` è il motore puro (prompt → parsing robusto → stati),
     `caricaNI` l'orchestratore che, sul caricamento iniziale, lancia in
     automatico la seconda passata sulla colonna comparativa T-1. ---- */
  const processNi = async (fonte, nomeFile, isPrec) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const et = isPrec ? " (T-1)" : "";
    setStato({ tipo: "info", msg: `Nota Integrativa${et} · estrazione in 4 sezioni tematiche via IA…` });
    const promptBase = isPrec
      ? (modalitaSingoloAnno ? NI_CE_FILTER_PROMPT_PREC_AUTONOMO : NI_CE_FILTER_PROMPT_PREC)
      : NI_CE_FILTER_PROMPT;
    /* Modalità Singolo Anno: l'anno da isolare cambia a seconda dello slot
       di destinazione — annoSpecifico per T, annoSpecificoPrec per T-1. */
    const annoTarget = isPrec ? annoSpecificoPrec : annoSpecifico;
    const bloccoSingoloAnno =
      modalitaSingoloAnno && String(annoTarget).trim()
        ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Leggi ed estrai ESCLUSIVAMENTE le informazioni e gli importi relativi all'anno ${annoTarget}. Ignora tassativamente qualsiasi raffronto, colonna comparativa o dato riferito ad altri esercizi.`
        : "";
    /* Analisi porzione per porzione (PDF nativo) o in un colpo solo (testo):
       i risultati parziali vengono poi fusi, riallineando i numeri di pagina. */
    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) =>
        `${promptBase}${bloccoSingoloAnno}` +
        (t
          ? `\n\nTESTO DELLA NOTA INTEGRATIVA:\n"""\n${t}\n"""`
          : `\n\nLa Nota Integrativa da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle.`),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({
            tipo: "info",
            msg: `Nota Integrativa${et} · analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…`,
          });
      },
    });
    const data = {
      estratti: fondiArray(risultati, "estratti"),
      rettifiche: fondiArray(risultati, "rettifiche"),
      riallocazioni: fondiArray(risultati, "riallocazioni"),
      redFlags: fondiArray(risultati, "redFlags"),
      channelStuffing: fondiScalare(risultati, "channelStuffing"),
      aliquotaNominale: fondiScalare(risultati, "aliquotaNominale"),
      __troncato: qualcheTroncamento(risultati),
    };

    const items = (data.estratti || [])
      .filter((e) => e.tema && e.contenuto && [1, 2, 3, 4].includes(Number(e.sezione)))
      .map((e) => ({
        sezione: Number(e.sezione),
        tema: String(e.tema),
        contenuto: String(e.contenuto),
        pagina: e.pagina != null ? Number(e.pagina) : null,
      }));
    const retts = (data.rettifiche || [])
      .filter((r) => r.descrizione && Number(r.importo))
      .map((r) => ({
        descrizione: String(r.descrizione),
        importo: Number(r.importo) || 0,
        classeOrigine: CLASSI[r.classeOrigine] && r.classeOrigine !== "DA_CLASSIFICARE" ? r.classeOrigine : null,
        // capex_item conservato per il Ponte Rendiconto (neutralizzazione nel CAPEX);
        // ai fini dello storno di normalizzazione si comporta come special_item.
        tipo: r.tipo === "extra_gestione" ? "extra_gestione" : r.tipo === "capex_item" ? "capex_item" : "special_item",
        motivazione: r.motivazione ? String(r.motivazione) : "",
        pagina: r.pagina != null ? Number(r.pagina) : null,
      }));
    const flags = (data.redFlags || [])
      .filter((f) => f.evidenza)
      .map((f) => ({
        flag: ["capitalizzazione", "channel_stuffing", "big_bath"].includes(f.flag) ? f.flag : "altro",
        evidenza: String(f.evidenza),
        gravita: ["alta", "media", "bassa"].includes(f.gravita) ? f.gravita : "media",
        pagina: f.pagina != null ? Number(f.pagina) : null,
      }));
    const NATURA_DEST = ["PERSONALE", "AMMORTAMENTI", "ACCANTONAMENTI", "GODIMENTO", "ONERI_FIN"];
    const rialls = (data.riallocazioni || [])
      .filter(
        (r) =>
          r.descrizione &&
          Number(r.importo) &&
          CLASSI[r.classeOrigine] && r.classeOrigine !== "DA_CLASSIFICARE" &&
          NATURA_DEST.includes(r.classeDestinazione) &&
          r.classeOrigine !== r.classeDestinazione
      )
      .map((r) => ({
        descrizione: String(r.descrizione),
        importo: Math.abs(Number(r.importo) || 0),
        classeOrigine: r.classeOrigine,
        classeDestinazione: r.classeDestinazione,
        motivazione: r.motivazione ? String(r.motivazione) : "",
        pagina: r.pagina != null ? Number(r.pagina) : null,
      }));

    /* Aliquota nominale dichiarata: quella della NI dell'esercizio T prevale,
       quella del T-1 vale solo se manca la prima. */
    const aliqNI = normalizzaAliquotaNI(data.aliquotaNominale, isPrec, nomeFile);
    if (aliqNI) setAliquotaNI((p) => (isPrec && p && !p.prec ? p : aliqNI));

    if (isPrec) {
      setNiEstrattiPrec(items);
      setNiRettifichePrec(retts);
      setNiRiallocazioniPrec(rialls);
      setNiRedFlagsPrec(flags);
      if (retts.length || rgRettifichePrec.length) applicaRettifichePrec([...retts, ...rgRettifichePrec]);
      if (rialls.length) applicaRiallocazioniPrec(rialls);
      setNiFontePrec(`«${nomeFile}» T-1 (${items.length} estratti · ${retts.length} rettifiche · ${rialls.length} riallocazioni · ${flags.length} red flag)`);
    } else {
      setNiEstratti(items);
      setNiRettifiche(retts);
      setNiRiallocazioni(rialls);
      setNiRedFlags(flags);

      /* ---- Channel stuffing: crediti verso clienti (posta patrimoniale) ----
         Il fatturato di raffronto NON viene più letto da qui: deriva
         organicamente da calcPrec.ricavi (voci dell'esercizio T-1). ---- */
      const cs = data.channelStuffing;
      if (cs && typeof cs === "object") {
        const c0 = Number(cs.creditiClientiCorrente);
        const c1 = Number(cs.creditiClientiPrecedente);
        const pag = cs.pagina != null && Number.isFinite(Number(cs.pagina)) ? Number(cs.pagina) : null;
        setCreditiClienti((p) => ({
          corrente: p.corrente === "" && Number.isFinite(c0) ? String(c0) : p.corrente,
          precedente: p.precedente === "" && Number.isFinite(c1) ? String(c1) : p.precedente,
          pagina: pag != null ? pag : p.pagina,
          auto: p.auto || Number.isFinite(c0) || Number.isFinite(c1),
        }));
      }

      if (retts.length || rgRettifiche.length) applicaRettifiche([...retts, ...rgRettifiche]);
      if (rialls.length) applicaRiallocazioni(rialls);
      setNiFonte(`«${nomeFile}» (${items.length} estratti · ${retts.length} rettifiche · ${rialls.length} riallocazioni per natura · ${flags.length} red flag)`);
    }

    const perSezione = [1, 2, 3, 4].map((s) => items.filter((i) => i.sezione === s).length);
    setStato({
      tipo: "info",
      msg: `Nota Integrativa${et} estratta: ${items.length} elementi (S1 ${perSezione[0]} · S2 ${perSezione[1]} · S3 ${perSezione[2]} · S4 ${perSezione[3]})${retts.length ? ` · ${retts.length} rettifiche di normalizzazione stornate automaticamente` : ""}${rialls.length ? ` · ${rialls.length} riallocazioni per natura (IAS 1.104) applicate` : ""}${flags.length ? ` · ${flags.length} red flag` : ""}.${data.__troncato ? " ⚠ La risposta IA era troncata: recuperati gli elementi completi, ma alcuni estratti finali potrebbero mancare — riprova con un documento più corto o un modello con più capacità." : ""}`,
    });
    return items.length;
  };

  const caricaNI = async (file, isPrec = false) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    if (!iaAttiva) {
      setStato({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Nota Integrativa." });
      return;
    }
    if (isPrec) setCaricamentoPrec(true);
    setCaricamentoNI(true);
    setStato({ tipo: "info", msg: `Nota Integrativa${isPrec ? " (T-1)" : ""} · lettura di «${file.name}»…` });
    try {
      /* La fonte (porzioni PDF native oppure testo) viene preparata UNA sola
         volta e riusata per entrambe le passate T e T-1. */
      const fonte = await preparaFonte(file, provider);
      await processNi(fonte, file.name, isPrec);
      if (!isPrec) {
        setTab(2);
        /* ---- Seconda passata automatica: colonna comparativa T-1 ----
           La stessa fonte viene rianalizzata con il prompt T-1. Un errore
           qui non compromette l'estrazione dell'anno corrente.
           Bloccata quando è attiva la Modalità Singolo Anno. ---- */
        if (!modalitaSingoloAnno) {
          setCaricamentoPrec(true);
          try {
            await processNi(fonte, file.name, true);
          } catch (e2) {
            setStatoIAPrec({ tipo: "errore", msg: `Nota Integrativa T-1 non estratta: ${e2.message}` });
          } finally {
            setCaricamentoPrec(false);
          }
        }
      }
    } catch (e) {
      setStato({ tipo: "errore", msg: `Estrazione Nota Integrativa${isPrec ? " (T-1)" : ""} non riuscita: ${e.message}` });
    } finally {
      setCaricamentoNI(false);
      if (isPrec) setCaricamentoPrec(false);
    }
  };

  /* ========================================================
     RELAZIONE SULLA GESTIONE (RG) · estrazione in 4 sezioni
     tematiche + special items da normalizzazione
     ======================================================== */

  /* ---- estrazione Relazione sulla Gestione (4 sezioni tematiche) ----
     Stessa architettura di caricaNI: la fonte è il PDF letto pagina per pagina
     (o il testo, quando il file caricato non è un PDF), l'analisi procede per
     porzioni, il JSON viene parsato in modo robusto e popola gli estratti, le
     rettifiche special_item e i red flag. Al termine chiama applicaRettifiche
     combinando NI + RG, così l'Earnings Power del CE a valore aggiunto
     riflette anche gli storni della RG. ---- */
  const processRg = async (fonte, nomeFile, isPrec) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const et = isPrec ? " (T-1)" : "";
    setStato({ tipo: "info", msg: `Relazione sulla Gestione${et} · estrazione in 4 sezioni tematiche via IA…` });
    const promptBase = isPrec
      ? (modalitaSingoloAnno ? RG_CE_FILTER_PROMPT_PREC_AUTONOMO : RG_CE_FILTER_PROMPT_PREC)
      : RG_CE_FILTER_PROMPT;
    /* Modalità Singolo Anno: anno target differenziato per slot T / T-1. */
    const annoTarget = isPrec ? annoSpecificoPrec : annoSpecifico;
    const bloccoSingoloAnno =
      modalitaSingoloAnno && String(annoTarget).trim()
        ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Leggi ed estrai ESCLUSIVAMENTE le informazioni e gli importi relativi all'anno ${annoTarget}. Ignora tassativamente qualsiasi raffronto, colonna comparativa o dato riferito ad altri esercizi.`
        : "";
    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) =>
        `${promptBase}${bloccoSingoloAnno}` +
        (t
          ? `\n\nTESTO DELLA RELAZIONE SULLA GESTIONE:\n"""\n${t}\n"""`
          : `\n\nLa Relazione sulla Gestione da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle.`),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({
            tipo: "info",
            msg: `Relazione sulla Gestione${et} · analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…`,
          });
      },
    });
    const data = {
      estratti: fondiArray(risultati, "estratti"),
      rettifiche: fondiArray(risultati, "rettifiche"),
      redFlags: fondiArray(risultati, "redFlags"),
      __troncato: qualcheTroncamento(risultati),
    };

    const items = (data.estratti || [])
      .filter((e) => e.tema && e.contenuto && [1, 2, 3, 4].includes(Number(e.sezione)))
      .map((e) => ({
        sezione: Number(e.sezione),
        tema: String(e.tema),
        contenuto: String(e.contenuto),
        pagina: e.pagina != null ? Number(e.pagina) : null,
      }));
    const retts = (data.rettifiche || [])
      .filter((r) => r.descrizione && Number(r.importo))
      .map((r) => ({
        descrizione: String(r.descrizione),
        importo: Number(r.importo) || 0,
        classeOrigine: CLASSI[r.classeOrigine] && r.classeOrigine !== "DA_CLASSIFICARE" ? r.classeOrigine : null,
        // La RG produce esclusivamente special_item (stessi criteri della NI).
        tipo: "special_item",
        motivazione: r.motivazione ? String(r.motivazione) : "",
        pagina: r.pagina != null ? Number(r.pagina) : null,
      }));
    const flags = (data.redFlags || [])
      .filter((f) => f.evidenza)
      .map((f) => ({
        flag: ["capitalizzazione", "channel_stuffing", "big_bath"].includes(f.flag) ? f.flag : "altro",
        evidenza: String(f.evidenza),
        gravita: ["alta", "media", "bassa"].includes(f.gravita) ? f.gravita : "media",
        pagina: f.pagina != null ? Number(f.pagina) : null,
      }));

    /* ---- Applicazione sui dati: gli special items della RG vengono stornati
       nel piano voci INSIEME a quelli della Nota Integrativa del medesimo
       esercizio, così i margini normalizzati incorporano entrambe le fonti. ---- */
    if (isPrec) {
      setRgEstrattiPrec(items);
      setRgRettifichePrec(retts);
      setRgRedFlagsPrec(flags);
      if (retts.length || niRettifichePrec.length) applicaRettifichePrec([...niRettifichePrec, ...retts]);
      setRgFontePrec(`«${nomeFile}» T-1 (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    } else {
      setRgEstratti(items);
      setRgRettifiche(retts);
      setRgRedFlags(flags);
      if (retts.length || niRettifiche.length) applicaRettifiche([...niRettifiche, ...retts]);
      setRgFonte(`«${nomeFile}» (${items.length} estratti · ${retts.length} rettifiche · ${flags.length} red flag)`);
    }

    const perSezione = [1, 2, 3, 4].map((x) => items.filter((i) => i.sezione === x).length);
    setStato({
      tipo: "info",
      msg: `Relazione sulla Gestione${et} estratta: ${items.length} elementi (S1 ${perSezione[0]} · S2 ${perSezione[1]} · S3 ${perSezione[2]} · S4 ${perSezione[3]})${retts.length ? ` · ${retts.length} special items stornati e combinati con le rettifiche della Nota Integrativa` : ""}${flags.length ? ` · ${flags.length} red flag` : ""}.${data.__troncato ? " ⚠ La risposta IA era troncata: recuperati gli elementi completi, ma alcuni estratti finali potrebbero mancare — riprova con un documento più corto o un modello con più capacità." : ""}`,
    });
    return items.length;
  };

  const caricaRG = async (file, isPrec = false) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    if (!iaAttiva) {
      setStato({ tipo: "errore", msg: "Attiva un provider IA per estrarre la Relazione sulla Gestione." });
      return;
    }
    if (isPrec) setCaricamentoPrec(true);
    setCaricamentoRG(true);
    setStato({ tipo: "info", msg: `Relazione sulla Gestione${isPrec ? " (T-1)" : ""} · lettura di «${file.name}»…` });
    try {
      /* Fonte preparata una sola volta e riusata per T e T-1. */
      const fonte = await preparaFonte(file, provider);
      await processRg(fonte, file.name, isPrec);
      if (!isPrec) {
        setTab(9);
        /* seconda passata automatica sull'esercizio precedente
           (bloccata quando è attiva la Modalità Singolo Anno) */
        if (!modalitaSingoloAnno) {
          setCaricamentoPrec(true);
          try {
            await processRg(fonte, file.name, true);
          } catch (e2) {
            setStatoIAPrec({ tipo: "errore", msg: `Relazione sulla Gestione T-1 non estratta: ${e2.message}` });
          } finally {
            setCaricamentoPrec(false);
          }
        }
      }
    } catch (e) {
      setStato({ tipo: "errore", msg: `Estrazione Relazione sulla Gestione${isPrec ? " (T-1)" : ""} non riuscita: ${e.message}` });
    } finally {
      setCaricamentoRG(false);
      if (isPrec) setCaricamentoPrec(false);
    }
  };

  /* ---- salva / carica JSON ---- */
  /* ---- Esportazione a macro-nodi (architettura gemella dello SP) ----
     Il JSON non è più piatto: espone "esercizioCorrente", "esercizioPrecedente",
     "deltaEconomici" e "statoApplicazione", così il file è insieme un
     archivio dell'analisi e un formato di reimportazione fedele. ---- */
  const salvaDati = () => {
    try {
      const aggregati = (c) => ({
        ricavi: c.ricavi,
        valoreProduzione: c.valoreProduzione,
        valoreAggiunto: c.valoreAggiunto,
        ebitda: c.ebitda,
        redditoOperativoCaratteristica: c.redditoOperativoCaratteristica,
        ebit: c.ebit,
        gestioneFinanziaria: c.gestioneFinanziaria,
        risultatoCorrente: c.risultatoCorrente,
        gestioneNonCorrente: c.gestioneNonCorrente,
        extraGestione: c.extraGestione,
        risultatoAnteImposte: c.risultatoAnteImposte,
        imposte: c.imposte,
        utileNetto: c.utileNetto,
      });

      const datiSalvare = {
        formato: "ce-riclassificato/2.0",
        generatoIl: new Date().toISOString(),
        azienda,
        asa: asaList,
        schemaCE,
        aliquota,
        aliquotaFonte: fonteAliquota,
        aliquotaNominaleNI: aliquotaNI,
        valutazione,
        creditiClienti,

        esercizioCorrente: {
          esercizio,
          schemaRilevato,
          fonte,
          voci,
          aggregati: aggregati(calc),
          notaIntegrativa: {
            fonte: niFonte,
            estratti: niEstratti,
            rettifiche: niRettifiche,
            riallocazioni: niRiallocazioni,
            redFlags: niRedFlags,
          },
          relazioneGestione: {
            fonte: rgFonte,
            estratti: rgEstratti,
            rettifiche: rgRettifiche,
            redFlags: rgRedFlags,
          },
        },

        esercizioPrecedente: {
          esercizio: esercizioPrec,
          schemaRilevato: schemaRilevatoPrec,
          fonte: fontePrec,
          voci: vociPrec,
          aggregati: aggregati(calcPrec),
          notaIntegrativa: {
            fonte: niFontePrec,
            estratti: niEstrattiPrec,
            rettifiche: niRettifichePrec,
            riallocazioni: niRiallocazioniPrec,
            redFlags: niRedFlagsPrec,
          },
          relazioneGestione: {
            fonte: rgFontePrec,
            estratti: rgEstrattiPrec,
            rettifiche: rgRettifichePrec,
            redFlags: rgRedFlagsPrec,
          },
        },

        deltaEconomici: {
          disponibile: deltaEconomici.disponibile,
          margini: deltaEconomici.elenco.map((d) => ({
            chiave: d.chiave,
            label: d.label,
            corrente: d.corrente,
            precedente: d.precedente,
            assoluto: d.assoluto,
            percentuale: d.percentuale,
          })),
          channelStuffing: {
            deltaCrediti,
            deltaFatturato,
            allerta: channelStuffingAlert,
          },
        },

        statoApplicazione: {
          tab,
          classiVariabili,
          rettificheApplicate,
          rettificheMancanti: rettificheMancanti.length,
          riallocazioniApplicate,
          riallocazioniMancanti: riallocazioniMancanti.length,
          vociDaClassificare: calc.daClassificare,
          vociDaClassificarePrec: calcPrec.daClassificare,
        },
      };

      // Validazione: rimuovi eventuali proprietà con funzioni o cicli
      const datiPuliti = JSON.parse(JSON.stringify(datiSalvare));

      const testoJSON = JSON.stringify(datiPuliti, null, 2);
      const nomeFile = `riclassificazione-ce_${esercizio.replaceAll("/", "_")}.json`;

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
      // Fallback: seleziona il testo nella textarea
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

  /* ---- Reidratazione: legge sia il nuovo formato a macro-nodi (2.0)
     sia il vecchio formato piatto (1.x), così i file già salvati
     continuano ad aprirsi senza errori. ---- */
  const caricaJSON = async (file) => {
    try {
      const testo = await file.text();
      const data = JSON.parse(testo);

      // Validazione struttura minima
      if (!data || typeof data !== "object") throw new Error("File JSON non valido: formato non riconosciuto");

      const conId = (arr) => (arr || []).map((v) => ({ ...v, id: v.id || nuovoId() }));
      const nuovoFormato = !!(data.esercizioCorrente || data.esercizioPrecedente);
      const cur = data.esercizioCorrente || {};
      const pre = data.esercizioPrecedente || {};
      const curNI = cur.notaIntegrativa || {};
      const curRG = cur.relazioneGestione || {};
      const preNI = pre.notaIntegrativa || {};
      const preRG = pre.relazioneGestione || {};

      /* ---- esercizio corrente ---- */
      const vociCur = nuovoFormato ? cur.voci : data.voci;
      setVoci(conId(vociCur));
      setAsaList(data.asa || []);
      if (data.azienda) setAzienda(data.azienda);
      const escCur = nuovoFormato ? cur.esercizio : data.esercizio;
      if (escCur) setEsercizio(escCur);
      const schemaCur = nuovoFormato ? cur.schemaRilevato : data.schemaRilevato;
      if (schemaCur) setSchemaRilevato(schemaCur);
      if (data.schemaCE) setSchemaCE(data.schemaCE);
      setNiEstratti((nuovoFormato ? curNI.estratti : data.niEstratti) || []);
      setNiFonte((nuovoFormato ? curNI.fonte : data.niFonte) || null);
      setNiRettifiche((nuovoFormato ? curNI.rettifiche : data.niRettifiche) || []);
      setNiRiallocazioni((nuovoFormato ? curNI.riallocazioni : data.niRiallocazioni) || []);
      setNiRedFlags((nuovoFormato ? curNI.redFlags : data.niRedFlags) || []);
      setRgEstratti((nuovoFormato ? curRG.estratti : data.rgEstratti) || []);
      setRgFonte((nuovoFormato ? curRG.fonte : data.rgFonte) || null);
      setRgRettifiche((nuovoFormato ? curRG.rettifiche : data.rgRettifiche) || []);
      setRgRedFlags((nuovoFormato ? curRG.redFlags : data.rgRedFlags) || []);

      /* ---- esercizio precedente (T-1) ---- */
      setVociPrec(conId(pre.voci));
      if (pre.esercizio) setEsercizioPrec(pre.esercizio);
      setSchemaRilevatoPrec(pre.schemaRilevato || null);
      setFontePrec(pre.fonte || null);
      setNiEstrattiPrec(preNI.estratti || []);
      setNiFontePrec(preNI.fonte || null);
      setNiRettifichePrec(preNI.rettifiche || []);
      setNiRiallocazioniPrec(preNI.riallocazioni || []);
      setNiRedFlagsPrec(preNI.redFlags || []);
      setRgEstrattiPrec(preRG.estratti || []);
      setRgFontePrec(preRG.fonte || null);
      setRgRettifichePrec(preRG.rettifiche || []);
      setRgRedFlagsPrec(preRG.redFlags || []);

      /* ---- impostazioni trasversali e stato di applicazione ---- */
      if (data.aliquota != null) setAliquota(Number(data.aliquota));
      setAliquotaNI(data.aliquotaNominaleNI && typeof data.aliquotaNominaleNI === "object" ? data.aliquotaNominaleNI : null);
      /* Salvataggi precedenti senza fonte: un valore diverso dal vecchio 27,9
         fisso era stato scelto a mano; il 27,9 si ricalcola dai documenti. */
      if (data.aliquotaFonte && typeof data.aliquotaFonte === "object") setFonteAliquota(data.aliquotaFonte);
      else setFonteAliquota(data.aliquota != null && Number(data.aliquota) !== 27.9 ? { tipo: "manuale" } : { tipo: "auto" });
      if (data.valutazione) setValutazione(data.valutazione);
      if (data.creditiClienti) setCreditiClienti(data.creditiClienti);
      else if (data.prec) {
        // retro-compatibilità 1.x: i vecchi campi di channel stuffing
        setCreditiClienti({
          corrente: data.prec.crediti0 ?? "",
          precedente: data.prec.crediti1 ?? "",
          pagina: null,
          auto: false,
        });
      }
      const st = data.statoApplicazione || {};
      if (Array.isArray(st.classiVariabili) && st.classiVariabili.length) setClassiVariabili(st.classiVariabili);

      const nVoci = (vociCur || []).length;
      const nPrec = (pre.voci || []).length;
      setFonte(`«${file.name}» (${nVoci} voci${nPrec ? ` · ${nPrec} voci T-1` : ""})`);
      setStatoIA({ tipo: "successo", msg: `✓ File caricato: ${file.name}${nPrec ? ` — incluso l'esercizio precedente (${nPrec} voci)` : ""}` });
      setTimeout(() => setStatoIA(null), 2500);
    } catch (err) {
      console.error("Errore caricamento JSON:", err);
      setStatoIA({ tipo: "errore", msg: `❌ Errore caricamento: ${err.message || "File JSON non valido"}` });
    }
  };

  const processCe = async (fonte, nomeFile, isPrec, schemaInfoIn) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    const et = isPrec ? " (T-1)" : "";
    setStato({
      tipo: "info",
      msg: schemaInfoIn
        ? `Estrazione${et} adattata con regole per ${String(schemaInfoIn.schema).toUpperCase()} · ${schemaInfoIn.formato}…`
        : `Estrazione${et} adattata via IA…`,
    });
    const risultati = await eseguiSuFonte({
      provider,
      apiKey,
      model: modello[provider],
      fonte,
      costruisciPrompt: (t) =>
        buildCePrompt(t, schemaInfoIn, isPrec, modalitaSingoloAnno, annoSpecifico, systemPrompts.regoleApprese, annoSpecificoPrec),
      onPorzione: (fatte, tot) => {
        if (tot > 1)
          setStato({ tipo: "info", msg: `Estrazione${et} · analisi porzione ${Math.min(fatte + 1, tot)} di ${tot}…` });
      },
    });
    /* Nei documenti voluminosi il Conto Economico può ricadere in una sola
       porzione: le voci di tutte le porzioni vengono unite, mentre azienda,
       esercizio e schema prendono il primo valore utile incontrato. */
    const data = {
      voci: fondiArray(risultati, "voci"),
      azienda: fondiScalare(risultati, "azienda"),
      esercizio: fondiScalare(risultati, "esercizio"),
      schemaRilevato: fondiScalare(risultati, "schemaRilevato"),
    };
    const nuove = (data.voci || [])
      .filter((v) => v && v.nome)
      .map((v) => ({
        id: nuovoId(),
        nome: String(v.nome),
        importo: Number(v.importo) || 0,
        classe: CLASSI[v.classe] ? v.classe : "DA_CLASSIFICARE",
        asa: v.asa ? String(v.asa) : null,
      }));

    const labelSchema = schemaInfoIn && SCHEMI_CE[`${schemaInfoIn.schema}_${schemaInfoIn.formato}`]?.label;
    const etichettaSchema =
      labelSchema ||
      { valore_aggiunto: "A valore aggiunto (per natura)", costo_del_venduto: "A costo del venduto (per funzione)", margine_di_contribuzione: "A margine di contribuzione", civilistico: "Civilistico art. 2425" }[data.schemaRilevato] ||
      data.schemaRilevato ||
      null;

    if (isPrec) {
      setVociPrec(nuove);
      if (data.esercizio) setEsercizioPrec(data.esercizio);
      setSchemaRilevatoPrec(etichettaSchema);
      setFontePrec(`«${nomeFile}» via estrazione IA — colonna comparativa T-1 (${nuove.length} voci)`);
      setStato({
        tipo: nuove.length ? "info" : "errore",
        msg: nuove.length
          ? `Esercizio precedente estratto: ${nuove.length} voci dalla colonna comparativa. Valida classi e importi nel tab «Dati & Validazione T-1».`
          : "Nessuna colonna comparativa T-1 individuata nel documento: carica un file dedicato all'esercizio precedente con «📄 Carica CE Precedente a parte».",
      });
    } else {
      setVoci(nuove);
      /* Le ASA rilevate sull'anno corrente restano il riferimento comune:
         il segment reporting T-1 usa la stessa lista per essere confrontabile. */
      setAsaList([...new Set(nuove.map((v) => v.asa).filter(Boolean))]);
      if (data.azienda) setAzienda(data.azienda);
      if (data.esercizio) setEsercizio(data.esercizio);
      setSchemaCE(schemaInfoIn);
      setSchemaRilevato(etichettaSchema);
      setFonte(`«${nomeFile}» via estrazione IA (${nuove.length} voci)`);
      setStato({ tipo: "info", msg: `Estrazione completata: ${nuove.length} voci proposte. Valida classi, importi e allocazione ASA qui sotto.` });
    }
    return nuove.length;
  };

  /* ---- estrazione IA del Conto Economico ----
     Caricamento iniziale (isPrec = false): estrae l'anno corrente e poi
     rilancia in automatico una seconda chiamata sullo STESSO testo con
     isPrec = true, per popolare la colonna comparativa T-1.
     Caricamento dedicato (isPrec = true): analizza un file separato che
     contiene il bilancio dell'esercizio precedente. ---- */
  const estraiConIA = async (file, isPrec = false) => {
    const setStato = isPrec ? setStatoIAPrec : setStatoIA;
    if (!iaAttiva) {
      setStato({ tipo: "errore", msg: "Inserisci la chiave API del provider selezionato per attivare le funzionalità IA." });
      return;
    }
    if (isPrec) setCaricamentoPrec(true);
    else setCaricamento(true);
    setStato({ tipo: "info", msg: `Fase 1: lettura di «${file.name}»…` });
    try {
      const fonte = await preparaFonte(file, provider);
      if (fonte.tipo === "pdf" && fonte.chunks.length > 1)
        setStato({ tipo: "info", msg: `Documento suddiviso in ${fonte.chunks.length} porzioni per l'analisi…` });

      // Fase 2a — rilevamento schema + formato espositivo
      setStato({ tipo: "info", msg: "Fase 2a: riconoscimento schema contabile e formato espositivo del CE…" });
      let schemaInfo = null;
      try {
        schemaInfo = await rilevaSchemaCe({
          provider,
          apiKey,
          model: modello[provider],
          fonte,
        });
      } catch (e) {
        console.warn("Schema detection fallita, procedo con estrazione generica:", e);
      }

      // Fase 2b — estrazione adattata al formato rilevato
      await processCe(fonte, file.name, isPrec, schemaInfo);

      // Fase 3 — passata automatica sulla colonna comparativa T-1
      // (bloccata quando è attiva la Modalità Singolo Anno)
      if (!isPrec && !modalitaSingoloAnno) {
        setCaricamentoPrec(true);
        try {
          await processCe(fonte, file.name, true, schemaInfo);
        } catch (e2) {
          setStatoIAPrec({ tipo: "errore", msg: `Estrazione T-1 non riuscita: ${e2.message}` });
        } finally {
          setCaricamentoPrec(false);
        }
      }
    } catch (e) {
      setStato({ tipo: "errore", msg: `Estrazione${isPrec ? " (T-1)" : ""} non riuscita: ${e.message}` });
    } finally {
      if (isPrec) setCaricamentoPrec(false);
      else setCaricamento(false);
    }
  };

  /* ============================================================
     ANALISI BILANCIO COMPLETO IN UN SOLO PASSAGGIO (Form 10-K / 20-F)
     ============================================================
     Flusso alternativo — NON sostituisce i caricamenti separati di CE,
     Nota Integrativa e Relazione sulla Gestione, che restano invariati.
     Una sola chiamata IA naviga l'intero documento (prospetti contabili ·
     Notes to Financial Statements · MD&A) e restituisce un unico JSON che
     popola simultaneamente: schema CE, voci, estratti/rettifiche/
     riallocazioni/red flag della NI e della RG, oltre ai crediti verso
     clienti per l'indicatore di channel stuffing.
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
      setStatoIA({ tipo: "info", msg: "Estrazione voci, Nota Integrativa ed MD&A via IA (potrebbe richiedere un po')…" });

      const MASTER_PROMPT = `Sei un analista di bilancio esperto. Il documento allegato è un bilancio annuale completo (es. Form 20-F, Form 10-K). Analizzalo integralmente per riclassificare il CONTO ECONOMICO.
FASE 1: NAVIGAZIONE
Individua: 1) Prospetti Contabili, 2) Notes to Financial Statements, 3) MD&A / Management's Discussion.
FASE 2: ESTRAZIONE VOCI
Identifica il Conto Economico. Rileva schema ("ifrs", "us_gaap") e formato ("valore_aggiunto", "per_natura", "costo_venduto", "single_step"). Estrai TUTTE le voci con importo e classe tra: RICAVI, VAR_RIM_PF, LAVORI_INTERNI, ALTRI_RICAVI, ACQUISTI, VAR_RIM_MATERIE, SERVIZI, GODIMENTO, PERSONALE, AMMORTAMENTI, ACCANTONAMENTI, ONERI_DIVERSI, PROVENTI_FIN, ONERI_FIN, PROVENTI_ACCESSORI, ONERI_ACCESSORI, NON_CORRENTE, EXTRA_GESTIONE, IMPOSTE.
FASE 3: ANALISI NOTA INTEGRATIVA
Dalle Note estrai info catalogate in: 1) Ricavi/Valore Prod, 2) Costi/Personale, 3) Finanza/Straord, 4) Imposte. Identifica: "rettifiche", "riallocazioni" (fondamentale per IAS 1.104 se CE è per funzione), "redFlags", "channelStuffing", "aliquotaNominale" (l'aliquota fiscale teorica DICHIARATA nella nota sulle imposte o nella riconciliazione: {"valore": percentuale es. 27.9, "componenti": "...", "pagina": N, "citazione": "..."}; ometti se non dichiarata, mai l'aliquota effettiva).
FASE 4: ANALISI RELAZIONE GESTIONE
Dall'MD&A estrai info su: 1) Andamento ricavi, 2) Dinamiche costi, 3) Eventi straord, 4) Investimenti. Aggiungi "rettifiche" e "redFlags".
Restituisci ESCLUSIVAMENTE un JSON valido:
{"schemaCE": {"schema": "...", "formato": "...", "valuta": "...", "unita": "...", "indizi": "..."}, "azienda": "...", "esercizio": "...", "voci": [{"nome": "...", "importo": 0, "classe": "...", "asa": null}], "ni": {"estratti": [{"sezione": 1, "tema": "...", "contenuto": "...", "pagina": 0}], "rettifiche": [{"descrizione": "...", "importo": 0, "classeOrigine": "...", "tipo": "special_item", "motivazione": "...", "pagina": 0}], "riallocazioni": [{"descrizione": "...", "importo": 0, "classeOrigine": "...", "classeDestinazione": "...", "motivazione": "...", "pagina": 0}], "redFlags": [], "channelStuffing": {}, "aliquotaNominale": null}, "rg": {"estratti": [{"sezione": 1, "tema": "...", "contenuto": "...", "pagina": 0}], "rettifiche": [], "redFlags": []}}`;

      /* handleMasterFile popola SOLO gli stati dell'esercizio corrente (T): non
         imposta mai vociPrec/niEstrattiPrec/rgEstrattiPrec ecc. Nulla da bloccare
         lato Prec. In Modalità Singolo Anno rafforziamo però il prompt affinché
         l'IA si concentri esclusivamente sull'anno richiesto. */
      const bloccoSingoloAnnoMaster =
        modalitaSingoloAnno && String(annoSpecifico).trim()
          ? `\n\n⚠⚠ ATTENZIONE - MODALITÀ SINGOLO ANNO: Estrai ESCLUSIVAMENTE i dati, gli importi e le voci (CE, Nota Integrativa, Relazione sulla Gestione) relativi all'anno ${annoSpecifico}. Ignora tassativamente qualsiasi colonna comparativa o dato riferito ad altri esercizi.`
          : "";

      const risultati = await eseguiSuFonte({
        provider,
        apiKey,
        model: modello[provider],
        fonte,
        costruisciPrompt: (t) =>
          `${MASTER_PROMPT}${bloccoSingoloAnnoMaster}${bloccoRegoleCE(systemPrompts.regoleApprese)}` +
          (t
            ? `\n\nTESTO DEL BILANCIO:\n"""\n${t}\n"""`
            : `\n\nIl bilancio da analizzare è il documento PDF ALLEGATO a questo messaggio: leggilo integralmente, pagina per pagina, comprese le tabelle dei prospetti contabili.`),
        onPorzione: (fatte, tot) => {
          if (tot > 1)
            setStatoIA({
              tipo: "info",
              msg: `Analisi completa · porzione ${Math.min(fatte + 1, tot)} di ${tot}…`,
            });
        },
      });

      /* Fusione delle porzioni: gli array (voci, estratti, rettifiche…) vengono
         concatenati riallineando i numeri di pagina, mentre i campi scalari
         prendono il primo valore utile. I rami «ni» e «rg» si costruiscono solo
         se almeno una porzione li contiene, per non azzerare stati già
         popolati quando il modello omette del tutto una sezione. */
      const data = {
        voci: qualchePresenza(risultati, "voci") ? fondiArray(risultati, "voci") : null,
        azienda: fondiScalare(risultati, "azienda"),
        esercizio: fondiScalare(risultati, "esercizio"),
        schemaCE: fondiScalare(risultati, "schemaCE"),
        ni: qualchePresenza(risultati, "ni")
          ? {
              estratti: fondiArray(risultati, "ni.estratti"),
              rettifiche: fondiArray(risultati, "ni.rettifiche"),
              riallocazioni: fondiArray(risultati, "ni.riallocazioni"),
              redFlags: fondiArray(risultati, "ni.redFlags"),
              channelStuffing: fondiScalare(risultati, "ni.channelStuffing"),
              aliquotaNominale: fondiScalare(risultati, "ni.aliquotaNominale"),
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

      /* ---- 1. Voci del Conto Economico + schema rilevato ---- */
      if (data.voci) {
        setVoci(
          data.voci
            .filter((v) => v && v.nome)
            .map((v) => ({
              ...v,
              id: nuovoId(),
              importo: Number(v.importo) || 0,
              classe: CLASSI[v.classe] ? v.classe : "DA_CLASSIFICARE",
              asa: v.asa ? String(v.asa) : null,
            }))
        );
        setAsaList([...new Set(data.voci.map((v) => v?.asa).filter(Boolean))]);
        if (data.azienda) setAzienda(data.azienda);
        if (data.esercizio) setEsercizio(data.esercizio);
        if (data.schemaCE) {
          setSchemaCE(data.schemaCE);
          setSchemaRilevato(
            SCHEMI_CE[`${data.schemaCE.schema}_${data.schemaCE.formato}`]?.label || data.schemaCE.schema
          );
        }
      }

      /* ---- 2. Nota Integrativa: estratti, rettifiche, riallocazioni, red flag ---- */
      if (data.ni) {
        setNiEstratti((data.ni.estratti || []).map((e) => ({ ...e, sezione: Number(e.sezione) })));
        setNiRettifiche(data.ni.rettifiche || []);
        setNiRiallocazioni(data.ni.riallocazioni || []);
        setNiRedFlags(data.ni.redFlags || []);
        setNiFonte(
          `«${file.name}» — analisi completa (${(data.ni.estratti || []).length} estratti · ${(data.ni.rettifiche || []).length} rettifiche · ${(data.ni.riallocazioni || []).length} riallocazioni · ${(data.ni.redFlags || []).length} red flag)`
        );

        const aliqNIc = normalizzaAliquotaNI(data.ni.aliquotaNominale, false, file.name);
        if (aliqNIc) setAliquotaNI(aliqNIc);

        if (data.ni.rettifiche?.length || data.rg?.rettifiche?.length)
          applicaRettifiche([...(data.ni.rettifiche || []), ...(data.rg?.rettifiche || [])]);
        if (data.ni.riallocazioni?.length) applicaRiallocazioni(data.ni.riallocazioni);

        /* Channel stuffing: i crediti verso clienti sono una posta patrimoniale
           e restano alimentati dalla Nota Integrativa. Il fatturato di raffronto
           deriva invece da calcPrec.ricavi (esercizio T-1). */
        const cs = data.ni.channelStuffing;
        if (cs && typeof cs === "object") {
          const c0 = Number(cs.creditiClientiCorrente);
          const c1 = Number(cs.creditiClientiPrecedente);
          const pag = cs.pagina != null && Number.isFinite(Number(cs.pagina)) ? Number(cs.pagina) : null;
          setCreditiClienti((p) => ({
            corrente: Number.isFinite(c0) ? String(c0) : p.corrente,
            precedente: Number.isFinite(c1) ? String(c1) : p.precedente,
            pagina: pag != null ? pag : p.pagina,
            auto: Number.isFinite(c0) || Number.isFinite(c1),
          }));
        }
      }

      /* ---- 3. Relazione sulla Gestione / MD&A ---- */
      if (data.rg) {
        setRgEstratti((data.rg.estratti || []).map((e) => ({ ...e, sezione: Number(e.sezione) })));
        setRgRettifiche(data.rg.rettifiche || []);
        setRgRedFlags(data.rg.redFlags || []);
        setRgFonte(
          `«${file.name}» — analisi completa (${(data.rg.estratti || []).length} estratti · ${(data.rg.rettifiche || []).length} rettifiche · ${(data.rg.redFlags || []).length} red flag)`
        );
      }

      setFonte(`«${file.name}» (Analisi Completa)`);
      setStatoIA({
        tipo: "successo",
        msg: `Analisi completa di «${file.name}» terminata. Voci, NI e RG estratte e fuse nel prospetto.`,
      });
      setTab(1);
    } catch (e) {
      setStatoIA({ tipo: "errore", msg: `Analisi completa fallita: ${e.message}` });
    } finally {
      setCaricamentoMaster(false);
      if (fileMaster.current) fileMaster.current.value = "";
    }
  };

  /* ---- ripartizione voci per sezione UI ---- */
  const vociRicavi = voci.filter(
    (v) => RICAVI_CLASSI.includes(v.classe) || (v.classe === "DA_CLASSIFICARE" && v.sezionePreferita === "ricavi")
  );
  const vociCosti = voci.filter((v) => !vociRicavi.includes(v));
  const totRicavi = vociRicavi.reduce((a, v) => a + (Number(v.importo) || 0), 0);
  const totCosti = vociCosti.reduce((a, v) => a + (Number(v.importo) || 0), 0);

  const validato = voci.length > 0 && calc.daClassificare === 0;

  /* ---- ripartizione voci T-1 per sezione UI (gemella della corrente) ---- */
  const vociRicaviPrec = vociPrec.filter(
    (v) => RICAVI_CLASSI.includes(v.classe) || (v.classe === "DA_CLASSIFICARE" && v.sezionePreferita === "ricavi")
  );
  const vociCostiPrec = vociPrec.filter((v) => !vociRicaviPrec.includes(v));
  const totRicaviPrec = vociRicaviPrec.reduce((a, v) => a + (Number(v.importo) || 0), 0);
  const totCostiPrec = vociCostiPrec.reduce((a, v) => a + (Number(v.importo) || 0), 0);
  const validatoPrec = vociPrec.length > 0 && calcPrec.daClassificare === 0;
  const asaTotEbit = asaList.reduce((a, k) => a + (segmenti[k]?.ebit || 0), 0) + (segmenti[ASA_COMUNE]?.ebit || 0);

  /* ---- Normalizzazione & Earnings Power (derivati) ---- */
  const t = (Number(aliquota) || 0) / 100;
  const totSpecial = niRettifiche.filter((r) => r.tipo === "special_item").reduce((a, r) => a + r.importo, 0);
  const totExtra = niRettifiche.filter((r) => r.tipo === "extra_gestione").reduce((a, r) => a + r.importo, 0);
  /* ---- stato di applicazione delle rettifiche NI nel piano voci ----
     Ogni rettifica applicata genera una voce "Storno NI: <descrizione>":
     confrontando le descrizioni si individuano le rettifiche estratte
     dalla Nota Integrativa (tab 2) ma non ancora presenti nel CE
     riclassificato (tab 3). ---- */
  const descrizioniStornate = new Set(
    voci
      .filter((v) => v.rettificaNI && String(v.nome).startsWith("Storno NI: "))
      .map((v) => String(v.nome).slice("Storno NI: ".length))
  );
  const rettificheMancanti = niRettifiche.filter((r) => !descrizioniStornate.has(r.descrizione));
  const rettificheApplicate = niRettifiche.length - rettificheMancanti.length;
  /* ---- stato di applicazione delle riallocazioni per natura ----
     stessa logica delle rettifiche, su voci con flag riallocazioneNI e
     prefisso "Riall. natura (storno): ". ---- */
  const descrizioniRiallocate = new Set(
    voci
      .filter((v) => v.riallocazioneNI && String(v.nome).startsWith("Riall. natura (storno): "))
      .map((v) => String(v.nome).slice("Riall. natura (storno): ".length))
  );
  const riallocazioniMancanti = niRiallocazioni.filter((r) => !descrizioniRiallocate.has(r.descrizione));
  const riallocazioniApplicate = niRiallocazioni.length - riallocazioniMancanti.length;
  /* effetto atteso sull'EBITDA delle riallocazioni mancanti: spostare
     un costo verso AMMORTAMENTI/ACCANTONAMENTI/ONERI_FIN lo toglie da
     sopra l'EBITDA (che quindi SALE); verso PERSONALE/GODIMENTO resta
     sopra la linea EBITDA (impatto nullo su EBITDA, ma il Valore
     Aggiunto cambia se la destinazione è PERSONALE). */
  const SOTTO_EBITDA = ["AMMORTAMENTI", "ACCANTONAMENTI", "ONERI_FIN"];
  const impattoEbitdaRiallMancanti = riallocazioniMancanti
    .filter((r) => SOTTO_EBITDA.includes(r.classeDestinazione))
    .reduce((a, r) => a + r.importo, 0);
  /* impatto delle rettifiche mancanti sui margini caratteristici:
     solo gli storni con classe di origine nell'area caratteristica
     modificano EBITDA/EBIT; il segno dell'effetto è l'opposto
     dell'importo della posta stornata (un provento gonfiava i margini,
     stornarlo li riduce; un onere li deprimeva, stornarlo li rialza). */
  const CLASSI_EBITDA = ["RICAVI", "VAR_RIM_PF", "LAVORI_INTERNI", "ALTRI_RICAVI", "ACQUISTI", "VAR_RIM_MATERIE", "SERVIZI", "GODIMENTO", "ONERI_DIVERSI", "PERSONALE"];
  const CLASSI_EBIT_EXTRA = ["AMMORTAMENTI", "ACCANTONAMENTI", "PROVENTI_ACCESSORI", "ONERI_ACCESSORI"];
  const impattoEbitdaMancanti = rettificheMancanti
    .filter((r) => CLASSI_EBITDA.includes(r.classeOrigine))
    .reduce((a, r) => a - r.importo, 0);
  const impattoEbitMancanti = rettificheMancanti
    .filter((r) => CLASSI_EBITDA.includes(r.classeOrigine) || CLASSI_EBIT_EXTRA.includes(r.classeOrigine))
    .reduce((a, r) => a - r.importo, 0);
  const risultatoCorrenteGrezzo = calc.risultatoCorrente + totSpecial + totExtra; // ante storni NI
  /* Fiscometria: aliquota ordinaria sul reddito normalizzato; anomali esposti al netto dell'effetto fiscale */
  const imposteTeoriche = calc.risultatoCorrente > 0 ? calc.risultatoCorrente * t : 0;
  const earningsPower = calc.risultatoCorrente - imposteTeoriche; // utile netto normalizzato
  const nopat = calc.ebit > 0 ? calc.ebit * (1 - t) : calc.ebit; // NOPAT = EBIT × (1 − t)
  const nonCorrenteNetto = calc.gestioneNonCorrente * (1 - t);
  const extraNetto = calc.extraGestione * (1 - t);
  /* Utile netto normalizzato complessivo: Earnings Power (gestione corrente
     al netto delle imposte teoriche) + componenti non correnti ed extra-gestione
     esposte al netto del loro effetto fiscale. La differenza rispetto
     all'utile netto contabile è l'effetto fiscale anomalo (scostamento tra
     imposte contabili iscritte e carico fiscale teorico ad aliquota ordinaria). */
  const utileNettoNormalizzato = earningsPower + nonCorrenteNetto + extraNetto;
  const effettoFiscaleAnomalo = calc.utileNetto - utileNettoNormalizzato;
  /* ---- Fiscometria dell'esercizio precedente (stesse formule su calcPrec) ---- */
  const imposteTeorichePrec = calcPrec.risultatoCorrente > 0 ? calcPrec.risultatoCorrente * t : 0;
  const earningsPowerPrec = calcPrec.risultatoCorrente - imposteTeorichePrec;
  const nonCorrenteNettoPrec = calcPrec.gestioneNonCorrente * (1 - t);
  const extraNettoPrec = calcPrec.extraGestione * (1 - t);
  const utileNettoNormalizzatoPrec = earningsPowerPrec + nonCorrenteNettoPrec + extraNettoPrec;
  const effettoFiscaleAnomaloPrec = calcPrec.utileNetto - utileNettoNormalizzatoPrec;
  /* Red flag quantitativi */
  const quotaCapitalizzata = calc.valoreProduzione ? (calc.lavoriInterni / calc.valoreProduzione) * 100 : 0;
  /* ---- Channel stuffing su base ORGANICA ----
     Il Δ fatturato non richiede più un input manuale: nasce dal raffronto
     fra i ricavi dell'esercizio corrente (calc) e quelli del precedente
     (calcPrec), cioè direttamente da `voci` e `vociPrec`. I crediti verso
     clienti, essendo poste patrimoniali, restano alimentati dalla NI. ---- */
  const deltaCrediti =
    Number(creditiClienti.precedente) > 0 && creditiClienti.corrente !== ""
      ? ((Number(creditiClienti.corrente) - Number(creditiClienti.precedente)) / Number(creditiClienti.precedente)) * 100
      : null;
  const deltaFatturato =
    vociPrec.length > 0 && Math.abs(calcPrec.ricavi) > 1e-9
      ? ((calc.ricavi - calcPrec.ricavi) / Math.abs(calcPrec.ricavi)) * 100
      : null;
  const channelStuffingAlert = deltaCrediti != null && deltaFatturato != null && deltaCrediti > deltaFatturato * 1.5 && deltaCrediti > 10;

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
                onFocus={(e) => e.target.select()}
                className="w-full flex-1 min-h-[200px] font-mono text-xs border border-slate-300 rounded-lg p-3 bg-slate-50 resize-none"
              />

              <div className="flex flex-wrap gap-3 justify-end">
                <button
                  onClick={copiaEsporta}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                    esporta.copiato
                      ? "bg-teal-600 text-white"
                      : "bg-slate-900 text-white hover:bg-slate-700"
                  }`}
                >
                  {esporta.copiato ? "✓ Copiato!" : "📋 Copia negli appunti"}
                </button>
                <button
                  onClick={scaricaEsporta}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
                >
                  ⬇ Prova download diretto
                </button>
                <button
                  onClick={() => setEsporta(null)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:text-slate-800"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto px-6 py-10">

        {/* ---------- Intestazione ---------- */}
        <p className="text-xs font-bold tracking-widest text-teal-700 uppercase mb-2">
          Analisi di bilancio · Schema dinamico
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight mb-1">
          Riclassificazione del Conto Economico
        </h1>
        <input
          value={azienda}
          onChange={(e) => setAzienda(e.target.value)}
          className="text-teal-700 font-semibold bg-transparent outline-none w-full mb-2"
          aria-label="Nome azienda"
        />
        <p className="text-sm text-slate-600 mb-6">
          Fase 1: riconoscimento schema (a valore aggiunto · a costo del venduto · a margine di
          contribuzione) · Fase 2: estrazione adattata · validazione modificabile · aree di gestione
          corrente/non corrente ·{" "}
          <span className="whitespace-nowrap">
            esercizio{" "}
            <input
              value={esercizio}
              onChange={(e) => setEsercizio(e.target.value)}
              className="inline-block w-24 bg-transparent border-b border-slate-300 outline-none text-slate-700"
              aria-label="Esercizio"
            />
          </span>
        </p>

        {/* ---------- Modalità Singolo Anno (opzionale) ----------
             Quando attiva, l'IA estrae un solo esercizio (quello digitato) e lo
             inserisce nelle sole sezioni dell'anno corrente (T); la seconda
             passata automatica sull'anno precedente (T-1) viene bloccata. ---- */}
        <div className="border border-amber-200 bg-amber-50/60 rounded-xl px-5 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={modalitaSingoloAnno}
              onChange={(e) => setModalitaSingoloAnno(e.target.checked)}
              className="w-4 h-4 accent-amber-600"
            />
            <span className="text-sm font-bold text-amber-900">📅 Modalità Singolo Anno</span>
          </label>
          {modalitaSingoloAnno && (
            <span className="flex items-center gap-2 text-sm text-amber-900">
              Anno da estrarre:
              <input
                type="text"
                value={annoSpecifico}
                onChange={(e) => setAnnoSpecifico(e.target.value)}
                placeholder="es. 2023"
                inputMode="numeric"
                className="w-24 bg-white border border-amber-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-400"
                aria-label="Anno specifico da estrarre"
              />
            </span>
          )}
          {modalitaSingoloAnno && (
            <span className="flex items-center gap-2 text-sm text-amber-900">
              Anno dei documenti T-1:
              <input
                type="text"
                value={annoSpecificoPrec}
                onChange={(e) => setAnnoSpecificoPrec(e.target.value)}
                placeholder="es. 2022"
                inputMode="numeric"
                className="w-24 bg-white border border-amber-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-400"
                aria-label="Anno dei documenti caricati negli slot T-1"
              />
            </span>
          )}
          <span className="text-xs text-amber-700 basis-full">
            {modalitaSingoloAnno
              ? "Attiva: l'IA estrarrà ESCLUSIVAMENTE i dati dell'anno indicato, popolando le sezioni dell'anno corrente (T). L'estrazione automatica della colonna comparativa è bloccata, ma i caricamenti T-1 restano disponibili: carica un bilancio autonomo di un altro esercizio negli slot T-1 per costruire a mano la serie storica (l'IA leggerà la colonna principale di quel documento, non la sua comparativa)."
              : "Se attivata, l'IA estrarrà i dati di un solo anno specifico (nelle sezioni T) e non estrarrà automaticamente l'anno precedente (T-1), che resterà comunque caricabile da un documento separato."}
          </span>
        </div>

        {/* ---------- Barra comandi ---------- */}
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={() => fileMaster.current?.click()}
            disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoMaster}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-50 flex items-center gap-2"
          >
            {caricamentoMaster ? "⏳ Analisi Completa in corso…" : "📖 Carica Bilancio Completo (Unico File)"}
          </button>
          <button
            onClick={() => fileIA.current?.click()}
            disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoMaster}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            📄 Carica Conto Economico (IA)
          </button>
          <button
            onClick={() => fileNI.current?.click()}
            disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoMaster}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            📎 Carica Nota Integrativa (IA)
          </button>
          <button
            onClick={() => fileRG.current?.click()}
            disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoMaster}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            📎 Carica Relazione sulla Gestione (IA)
          </button>
          <button
            onClick={() => fileJSON.current?.click()}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
          >
            📂 Carica dati salvati
          </button>
          <button
            onClick={salvaDati}
            disabled={!voci.length && !niEstratti.length}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            💾 Salva dati
          </button>
          <button
            onClick={caricaEsempio}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            Carica esempio
          </button>
          <button
            onClick={azzera}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
          >
            Azzera
          </button>
          {/* ---- input unico: bilancio completo (prospetti + note + MD&A) ---- */}
          <input ref={fileMaster} type="file" accept=".pdf,.txt,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMasterFile(f); }} />
          <input ref={fileIA} type="file" accept=".pdf,.txt,.md,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) estraiConIA(f, false); e.target.value = ""; }} />
          <input ref={fileNI} type="file" accept=".pdf,.txt,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaNI(f, false); e.target.value = ""; }} />
          <input ref={fileRG} type="file" accept=".pdf,.txt,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaRG(f, false); e.target.value = ""; }} />
          <input ref={fileJSON} type="file" accept=".json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaJSON(f); e.target.value = ""; }} />
          {/* ---- input dedicati all'esercizio precedente (file separati) ---- */}
          <input ref={fileIAPrec} type="file" accept=".pdf,.txt,.md,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) estraiConIA(f, true); e.target.value = ""; }} />
          <input ref={fileNIPrec} type="file" accept=".pdf,.txt,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaNI(f, true); e.target.value = ""; }} />
          <input ref={fileRGPrec} type="file" accept=".pdf,.txt,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) caricaRG(f, true); e.target.value = ""; }} />
        </div>

        {/* ---------- Barra comandi · esercizio precedente (T-1) ----------
             Spostata nel tab «9 · Dati & Validazione T-1»: i comandi vivono
             ora accanto alle voci che popolano, invece di occupare la testa
             della pagina in ogni tab. Gli input file nascosti restano nella
             barra comandi qui sopra, sempre montati, così i ref funzionano
             da qualunque tab. Resta qui solo una riga di stato: la passata
             automatica sulla colonna comparativa parte dal tab 1 e senza
             questo avviso procederebbe in silenzio. ---- */}
        {(caricamentoPrec || statoIAPrec) && tab !== 10 && (
          <p
            className={`-mt-4 mb-8 text-sm ${statoIAPrec?.tipo === "errore" ? "text-rose-600" : "text-slate-500"}`}
          >
            {caricamentoPrec && <span className="inline-block animate-pulse mr-1">●</span>}
            {statoIAPrec?.msg || "Estrazione dell'esercizio precedente (T-1) in corso…"}{" "}
            <button
              onClick={() => setTab(10)}
              className="underline font-semibold hover:text-slate-800"
            >
              vai al tab 9 · Dati &amp; Validazione T-1
            </button>
          </p>
        )}

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
              formato nativo, OpenAI le stesse pagine convertite in immagini nel
              browser. In tutti e tre i casi il documento è letto visivamente,
              quindi funzionano anche scansioni e file «Stampa su PDF». */}
          <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
            {provider === "openai" ? (
              <>
                📄 Con <b>OpenAI</b> le pagine del PDF vengono convertite in immagini <b>nel browser</b> prima
                dell'invio: funzionano anche le scansioni e i file creati con «Stampa su PDF», privi di testo
                selezionabile. La conversione richiede qualche secondo e consuma più token rispetto a{" "}
                <b>Claude</b> e <b>Gemini</b>, che ricevono il PDF nel formato nativo. I documenti lunghi
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
            {provider === "claude" ? (
              <div className="flex-1 min-w-[240px] flex items-center border border-slate-300 rounded-lg px-3">
                <input
                  type={mostraChiave ? "text" : "password"}
                  value={chiavi.claude || ""}
                  onChange={(e) => setChiavi((k) => ({ ...k, claude: e.target.value }))}
                  placeholder="sk-ant-… (facoltativa se la chiave è configurata sull'hosting)"
                  className="flex-1 py-2 text-sm outline-none bg-transparent"
                  aria-label="Chiave API Anthropic"
                />
                <button onClick={() => setMostraChiave((s) => !s)} className="text-slate-400 hover:text-slate-700" aria-label="Mostra chiave">👁</button>
              </div>
            ) : (
              <div className="flex-1 min-w-[240px] flex items-center border border-slate-300 rounded-lg px-3">
                <input
                  type={mostraChiave ? "text" : "password"}
                  value={chiavi[provider] || ""}
                  onChange={(e) => setChiavi((k) => ({ ...k, [provider]: e.target.value }))}
                  placeholder={provider === "openai" ? "sk-…" : "AIza…"}
                  className="flex-1 py-2 text-sm outline-none bg-transparent"
                  aria-label="Chiave API"
                />
                <button onClick={() => setMostraChiave((s) => !s)} className="text-slate-400 hover:text-slate-700" aria-label="Mostra chiave">👁</button>
              </div>
            )}
            {provider === "claude" ? (
              <select
                value={modello.claude}
                onChange={(e) => setModello((m) => ({ ...m, claude: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-56 bg-white"
                aria-label="Modello Claude"
              >
                <optgroup label="Sonnet — bilancio qualità/costo">
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (consigliato)</option>
                  <option value="claude-sonnet-5">Claude Sonnet 5</option>
                </optgroup>
                <optgroup label="Opus — massima qualità">
                  <option value="claude-opus-4-8">Claude Opus 4.8</option>
                  <option value="claude-opus-4-7">Claude Opus 4.7</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                </optgroup>
                <optgroup label="Haiku — veloce ed economico">
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </optgroup>
                <optgroup label="Fable">
                  <option value="claude-fable-5">Claude Fable 5</option>
                </optgroup>
              </select>
            ) : (
              <input
                value={modello[provider]}
                onChange={(e) => setModello((m) => ({ ...m, [provider]: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44"
                aria-label="Modello"
              />
            )}
          </div>
          <p className={`text-sm mb-2 ${iaAttiva ? "text-teal-700" : "text-slate-400"}`}>
            {provider === "claude"
              ? chiavi.claude
                ? "Chiave impostata: funzionalità IA attive"
                : "Nessuna chiave a schermo: si userà quella configurata sull'hosting, se presente"
              : iaAttiva
              ? "Chiave impostata: funzionalità IA attive"
              : "Nessuna chiave: funzionalità IA disattivate"}
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            {provider === "claude" ? (
              <>
                Con Claude le chiamate passano dal proxy dell'applicazione (<code>/api/anthropic</code>),
                che aggiunge l'autenticazione lato server: la chiave non è mai esposta nel codice della
                pagina. Puoi incollarla qui sopra — vale per la sessione corrente, viaggia in un header
                dedicato e il server la dimentica dopo ogni richiesta — oppure lasciare il campo vuoto e
                configurare <code>ANTHROPIC_API_KEY</code> sull'hosting, così l'app funziona per chiunque
                la apra. Per OpenAI e Gemini la chiave resta invece nel browser e chiama direttamente
                l'API scelta. Tutte le funzioni IA (estrazione CE, riconoscimento schema, proposta classi
                e allocazione ASA) usano il provider e il modello scelti qui.
              </>
            ) : (
              <>
                La chiave del provider selezionato viene usata solo dal tuo browser per chiamare
                direttamente l'API scelta e resta esclusivamente in memoria durante la sessione: non viene
                salvata né inviata altrove. Ogni provider ricorda la propria chiave mentre cambi selezione,
                ma alla chiusura o al ricaricamento della pagina andrà reinserita. Tutte le funzioni IA
                (estrazione CE, riconoscimento schema, proposta classi e allocazione ASA) usano il
                provider e il modello scelti qui.
              </>
            )}
          </p>
        </div>

        {/* ---------- Righe di stato ---------- */}
        <div className="space-y-1 mb-6 text-sm">
          {schemaRilevato && (
            <p className="text-teal-700">
              Schema contabile: {schemaRilevato}
              {schemaCE?.valuta && ` · ${schemaCE.valuta}`}
              {schemaCE?.unita && ` · importi in ${schemaCE.unita}`}
            </p>
          )}
          {schemaCE?.indizi && (
            <p className="text-slate-500 text-xs italic">Segnali di riconoscimento: {schemaCE.indizi}</p>
          )}
          {fonte && <p className="text-teal-700">Dati caricati da {fonte}.</p>}
          {voci.length > 0 && (
            <p className={calc.daClassificare ? "text-amber-600" : "text-teal-700"}>
              {calc.daClassificare
                ? `Voci da classificare: ${calc.daClassificare} — escluse dai calcoli finché non assegnate`
                : `Quadratura gestionale: utile netto ${fmt(calc.utileNetto)} · EBIT caratteristica + comune per ASA = EBIT riclassificato ${Math.round(asaTotEbit) === Math.round(calc.redditoOperativoCaratteristica) ? "✓" : "✗"}`}
            </p>
          )}
          {statoIA && (
            <p className={statoIA.tipo === "errore" ? "text-rose-600" : "text-teal-700"}>{statoIA.msg}</p>
          )}
        </div>

        {/* ---------- Tabs ---------- */}
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-slate-200 mb-6 text-sm font-semibold">
          {[
            [1, "1 · Dati & Validazione"],
            [2, `2 · Nota Integrativa${niEstratti.length ? ` (${niEstratti.length})` : ""}`],
            [9, `3 · Relazione sulla Gestione${rgEstratti.length ? ` (${rgEstratti.length})` : ""}`],
            [3, "4 · CE a valore aggiunto"],
            [4, "5 · Margini e indici rettificati"],
            [5, "6 · Collegamento CCNO"],
            [6, "7 · Segment Reporting (ASA)"],
            [8, "8 · Ponte Rendiconto"],
            [10, `9 · Dati & Validazione T-1${vociPrec.length ? ` (${vociPrec.length})` : ""}`],
            [11, "10 · CE a valore aggiunto T-1"],
            [12, "11 · Variazioni e Trend (Δ Economici)"],
            [13, `12 · Audit del Revisore${auditUnificato.gravi ? ` (${auditUnificato.gravi})` : ""}`],
          ].map(([id, nome]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`pb-3 -mb-px border-b-2 ${tab === id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {nome}
            </button>
          ))}
        </div>

        {/* ================= TAB 1 · DATI & VALIDAZIONE ================= */}
        {tab === 1 && (
          <>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">🧩 Come funziona lo schema dinamico</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                L'IA estrae <b>tutte le voci originali</b> del conto economico (qualunque schema di
                partenza) e propone per ciascuna una <b>classe di pertinenza gestionale</b> articolata per{" "}
                <b>aree di gestione</b>: gestione <b>corrente</b> (caratteristica · finanziaria ·
                accessoria) e gestione <b>non corrente</b> (componenti straordinarie). Per le voci della
                gestione caratteristica puoi anche assegnare l'<b>ASA</b> (Area Strategica d'Affari) usata
                dal segment reporting. Qui sotto validi il lavoro: correggi nomi, importi, classi e ASA,
                elimini o aggiungi voci. Le formule della riclassificazione aggregano le voci per classe,
                quindi <b>si adattano automaticamente</b>: se una voce non esiste nel bilancio,
                semplicemente non entra in alcuna formula. Le voci «da classificare» restano escluse dai
                calcoli finché non le assegni.
              </p>
            </div>

            {voci.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Nessuna voce presente. Carica un conto economico con l'estrattore IA, apri un file di dati
                salvati oppure usa «Carica esempio» per iniziare.
              </div>
            )}

            {voci.length > 0 &&
              [["Ricavi e proventi — voci del bilancio", vociRicavi, totRicavi, "ricavi"],
                ["Costi, oneri e imposte — voci del bilancio", vociCosti, totCosti, "costi"]].map(
                ([titolo, lista, totale, sezione]) => (
                  <div key={sezione} className="border border-slate-200 rounded-xl p-5 mb-6">
                    <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">
                      {titolo} ({lista.length})
                    </p>
                    <div className="space-y-4">
                      {lista.map((v) => (
                        <div key={v.id} className="space-y-1.5">
                          <div className="flex gap-2 items-center">
                            <input
                              value={v.nome}
                              onChange={(e) => aggiorna(v.id, { nome: e.target.value })}
                              placeholder="Nome voce"
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <input
                              type="number"
                              value={v.importo}
                              onChange={(e) => aggiorna(v.id, { importo: e.target.value === "" ? 0 : Number(e.target.value) })}
                              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm text-right"
                              aria-label="Importo"
                            />
                            <button onClick={() => elimina(v.id)} className="text-rose-500 font-bold px-1" aria-label="Elimina voce">×</button>
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={v.classe}
                              onChange={(e) => aggiorna(v.id, { classe: e.target.value, asa: CLASSI[e.target.value]?.asa ? v.asa : null })}
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-600 bg-white"
                              aria-label="Classe gestionale"
                            >
                              {Object.entries(CLASSI).map(([id, c]) => (
                                <option key={id} value={id}>{c.label}</option>
                              ))}
                            </select>
                            {CLASSI[v.classe]?.asa && (asaList.length > 0 || v.asa) && (
                              <select
                                value={v.asa || ""}
                                onChange={(e) => aggiorna(v.id, { asa: e.target.value || null })}
                                className="w-56 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-600 bg-white"
                                aria-label="Area Strategica d'Affari"
                              >
                                <option value="">ASA: comune / corporate</option>
                                {asaList.map((a) => (
                                  <option key={a} value={a}>ASA: {a}</option>
                                ))}
                                {v.asa && !asaList.includes(v.asa) && (
                                  <option value={v.asa}>ASA: {v.asa} (non in elenco)</option>
                                )}
                              </select>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-5">
                      <button
                        onClick={() => aggiungi(sezione)}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
                      >
                        + Aggiungi voce
                      </button>
                      <p className="font-mono font-bold text-sm">Totale: {fmt(totale)}</p>
                    </div>
                  </div>
                )
              )}

            {voci.length > 0 && (
              <div className="border border-slate-200 rounded-xl p-5">
                <p className="text-sm">
                  <b>Validazione:</b>{" "}
                  <span className={validato ? "text-teal-700" : "text-amber-600"}>
                    {calc.daClassificare
                      ? `${calc.daClassificare} voci ancora da classificare.`
                      : "tutte le voci classificate per area di gestione; riclassificazione e segment reporting aggiornati."}
                  </span>
                </p>
                <button
                  onClick={() => setTab(3)}
                  className="mt-4 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
                >
                  ✓ Conferma validazione e riclassifica →
                </button>
              </div>
            )}
          </>
        )}

        {/* ================= TAB 3 · CE A VALORE AGGIUNTO ================= */}
        {tab === 3 && (
          <>
            {(niRettifiche.length > 0 || niRiallocazioni.length > 0) && (
              <div className="border border-teal-200 bg-teal-50 rounded-xl p-4 mb-4 text-sm text-teal-900 leading-relaxed">
                <b>CE normalizzato con la Nota Integrativa.</b>{" "}
                {niRiallocazioni.length > 0 && (
                  <>
                    {niRiallocazioni.length} riallocazioni per natura (IAS 1.104) hanno ricostruito
                    personale, ammortamenti e le altre componenti per natura dalle voci funzionali (cost of
                    sales, SG&A, R&D): il CE per funzione è stato convertito in valore aggiunto.{" "}
                  </>
                )}
                {niRettifiche.length > 0 && (
                  <>
                    {niRettifiche.length} rettifiche sono state stornate automaticamente dalla gestione
                    corrente: Valore Aggiunto, EBITDA ed EBIT esposti qui sotto rappresentano
                    l'<b>Earnings Power</b> depurato dalle alterazioni congiunturali. Special items e poste
                    extra-gestione sono isolati «sotto la linea».{" "}
                  </>
                )}
                L'utile netto contabile non cambia. Red flag nel tab «2 · Nota Integrativa»; il
                dettaglio delle riallocazioni per natura, la normalizzazione (Earnings Power) e la
                fiscometria si trovano più sotto in questo stesso tab.
              </div>
            )}
            <Prospetto
            titolo="Conto economico riclassificato a valore aggiunto — per aree di gestione"
            base={calc.ricavi}
            vuoto={!voci.length}
            righe={[
              { l: "GESTIONE CORRENTE — Area caratteristica", tipo: "area" },
              { l: "Ricavi delle vendite e delle prestazioni", v: calc.ricavi },
              { l: "Variazione rimanenze prodotti e semilavorati", v: calc.varRimPF },
              { l: "Incrementi di immobilizzazioni per lavori interni", v: calc.lavoriInterni },
              { l: "Altri ricavi e proventi operativi", v: calc.altriRicavi },
              { l: "Valore della produzione", v: calc.valoreProduzione, tipo: "sub" },
              { l: "Consumi di materie (acquisti − Δ rimanenze materie)", v: -calc.consumi },
              { l: "Costi per servizi", v: -calc.servizi },
              { l: "Godimento beni di terzi", v: -calc.godimento },
              { l: "Oneri diversi di gestione", v: -calc.oneriDiversi },
              { l: "VALORE AGGIUNTO", v: calc.valoreAggiunto, tipo: "margine" },
              { l: "Costo del personale", v: -calc.personale },
              { l: "EBITDA — Margine operativo lordo", v: calc.ebitda, tipo: "margine" },
              { l: "Ammortamenti e svalutazioni", v: -calc.ammortamenti },
              { l: "Accantonamenti", v: -calc.accantonamenti },
              { l: "REDDITO OPERATIVO DELLA GESTIONE CARATTERISTICA", v: calc.redditoOperativoCaratteristica, tipo: "margine" },
              { l: "GESTIONE CORRENTE — Area accessoria", tipo: "area" },
              { l: "Proventi accessori", v: calc.proventiAccessori },
              { l: "Oneri accessori", v: -calc.oneriAccessori },
              { l: "EBIT — Reddito operativo (caratteristica + accessoria)", v: calc.ebit, tipo: "margine" },
              { l: "GESTIONE CORRENTE — Area finanziaria", tipo: "area" },
              { l: "Proventi finanziari", v: calc.proventiFin },
              { l: "Oneri finanziari", v: -calc.oneriFin },
              { l: "RISULTATO DELLA GESTIONE CORRENTE", v: calc.risultatoCorrente, tipo: "margine" },
              { l: "GESTIONE NON CORRENTE", tipo: "area" },
              { l: "Componenti straordinarie e non ricorrenti (+/-)", v: calc.gestioneNonCorrente },
              { l: "AREA EXTRA-GESTIONE (window dressing)", tipo: "area" },
              { l: "Poste da contabilità creativa stornate (+/-)", v: calc.extraGestione },
              { l: "Risultato ante imposte", v: calc.risultatoAnteImposte, tipo: "sub" },
              { l: "Imposte sul reddito (contabili, iscritte in bilancio)", v: -calc.imposte },
              { l: "UTILE NETTO CONTABILE", v: calc.utileNetto, tipo: "margine" },
              { l: `GESTIONE TRIBUTARIA NORMALIZZATA — Fiscometria (aliquota ordinaria ${aliquota}%, v. tabella B in fondo)`, tipo: "area" },
              { l: "Risultato della gestione corrente normalizzato (Earnings Power ante imposte)", v: calc.risultatoCorrente, tipo: "sub" },
              { l: `Imposte teoriche (${aliquota}% sul solo reddito corrente normalizzato)`, v: -imposteTeoriche },
              { l: "EARNINGS POWER — Utile netto normalizzato della gestione corrente", v: earningsPower, tipo: "margine" },
              { l: "Gestione non corrente al netto dell'effetto fiscale", v: nonCorrenteNetto },
              { l: "Area extra-gestione al netto dell'effetto fiscale", v: extraNetto },
              { l: "UTILE NETTO NORMALIZZATO COMPLESSIVO", v: utileNettoNormalizzato, tipo: "margine" },
              { l: "Δ Effetto fiscale anomalo (utile contabile − utile normalizzato)", v: effettoFiscaleAnomalo },
            ]}
          />

          {/* ---------- Normalizzazione con le rettifiche della Nota Integrativa ---------- */}
          {voci.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-5 mt-6">
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">
                Normalizzazione da Nota Integrativa — EBITDA ed EBIT depurati
              </p>

              {niRettifiche.length === 0 && niRiallocazioni.length === 0 ? (
                <p className="text-sm text-slate-500 leading-relaxed">
                  Nessuna rettifica o riallocazione disponibile: carica la Nota Integrativa con il
                  pulsante <b>«📎 Carica Nota Integrativa (IA)»</b> in cima alla pagina. L'IA estrae
                  special items, poste extra-gestione e — se il CE è per funzione — le riallocazioni per
                  natura ex IAS 1.104 (tab «2 · Nota Integrativa») che da qui potrai incorporare nella
                  riclassificazione per ottenere margini normalizzati.
                </p>
              ) : (
                <>
                  {niRiallocazioni.length > 0 && (
                    <div className="border-b border-slate-200 pb-4 mb-4">
                      <p className="text-sm text-slate-600 leading-relaxed mb-3">
                        Riallocazioni per natura (IAS 1.104): <b>{niRiallocazioni.length}</b> · già
                        incorporate nel CE riclassificato: <b>{riallocazioniApplicate}</b> · mancanti:{" "}
                        <b className={riallocazioniMancanti.length ? "text-amber-600" : "text-teal-700"}>
                          {riallocazioniMancanti.length}
                        </b>
                        {riallocazioniMancanti.length > 0 && (
                          <>
                            {" "}— effetto atteso sull'applicazione: EBITDA{" "}
                            <span className="font-mono">+{fmt(impattoEbitdaRiallMancanti)}</span> (i costi
                            spostati sotto la linea EBITDA — ammortamenti, accantonamenti, interessi lease
                            — escono dai costi esterni); Valore Aggiunto e ripartizione per natura
                            ricostruiti.
                          </>
                        )}
                      </p>
                      {riallocazioniMancanti.length > 0 && (
                        <>
                          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-4 text-xs text-amber-900 space-y-1">
                            <p className="font-bold">Riallocazioni non ancora incorporate:</p>
                            {riallocazioniMancanti.map((r, i) => (
                              <p key={i} className="font-mono">
                                · {r.descrizione} ({fmt(r.importo)} · {r.classeOrigine} →{" "}
                                {r.classeDestinazione})
                              </p>
                            ))}
                          </div>
                          <button
                            onClick={() => applicaRiallocazioni(niRiallocazioni)}
                            className="px-5 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-600"
                          >
                            ⇄ Applica riallocazioni per natura → CE a valore aggiunto
                          </button>
                        </>
                      )}
                      {riallocazioniMancanti.length === 0 && (
                        <p className="text-sm text-teal-800">
                          ✓ Tutte le riallocazioni per natura sono incorporate: personale{" "}
                          <span className="font-mono font-bold">{fmt(calc.personale)}</span> e
                          ammortamenti <span className="font-mono font-bold">{fmt(calc.ammortamenti)}</span>{" "}
                          ora esposti nel prospetto; l'utile netto è invariato.
                        </p>
                      )}
                    </div>
                  )}
                  {niRettifiche.length === 0 && (
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Nessuna rettifica di normalizzazione (special items / extra-gestione) individuata
                      nella Nota Integrativa.
                    </p>
                  )}
                  {niRettifiche.length > 0 && (
                  <>
                  <p className="text-sm text-slate-600 leading-relaxed mb-3">
                    Rettifiche estratte dalla Nota Integrativa: <b>{niRettifiche.length}</b> · già
                    incorporate nel CE riclassificato: <b>{rettificheApplicate}</b> · mancanti:{" "}
                    <b className={rettificheMancanti.length ? "text-amber-600" : "text-teal-700"}>
                      {rettificheMancanti.length}
                    </b>
                    {rettificheMancanti.length > 0 && (
                      <>
                        {" "}— effetto atteso sull'applicazione: EBITDA{" "}
                        <span className="font-mono">
                          {impattoEbitdaMancanti >= 0 ? "+" : "−"}{fmt(Math.abs(impattoEbitdaMancanti))}
                        </span>
                        , EBIT{" "}
                        <span className="font-mono">
                          {impattoEbitMancanti >= 0 ? "+" : "−"}{fmt(Math.abs(impattoEbitMancanti))}
                        </span>
                        .
                      </>
                    )}
                  </p>

                  {rettificheMancanti.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-4 text-xs text-amber-900 space-y-1">
                      <p className="font-bold">Rettifiche non ancora incorporate:</p>
                      {rettificheMancanti.map((r, i) => (
                        <p key={i} className="font-mono">
                          · {r.descrizione} ({r.importo >= 0 ? "+" : "−"}{fmt(Math.abs(r.importo))}
                          {r.classeOrigine ? ` · da ${r.classeOrigine}` : ""} ·{" "}
                          {r.tipo === "extra_gestione" ? "extra-gestione" : "special item"})
                        </p>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => applicaRettifiche([...niRettifiche, ...rgRettifiche])}
                    disabled={rettificheMancanti.length === 0}
                    className="px-5 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ⚗ Applica le rettifiche NI mancanti → EBITDA / EBIT depurati
                  </button>

                  {rettificheMancanti.length === 0 && (
                    <div className="mt-4 border border-teal-200 bg-teal-50 rounded-lg p-4 text-sm text-teal-900 leading-relaxed">
                      <b>✓ Tutte le rettifiche della Nota Integrativa sono incorporate.</b> I margini
                      esposti nel prospetto qui sopra sono già depurati (Earnings Power):
                      <span className="block mt-2 font-mono">
                        EBITDA depurato: <b>{fmt(calc.ebitda)}</b> ({pct(calc.ebitda, calc.ricavi)} dei ricavi)
                        {" "}· EBIT depurato: <b>{fmt(calc.ebit)}</b> ({pct(calc.ebit, calc.ricavi)} dei ricavi)
                      </span>
                      <span className="block mt-1 text-xs">
                        Special items ({fmt(totSpecial)}) ed extra-gestione ({fmt(totExtra)}) sono
                        isolati «sotto la linea» nelle rispettive aree; l'utile netto contabile resta
                        invariato. Dettaglio storni nel tab «2 · Nota Integrativa».
                      </span>
                    </div>
                  )}
                  </>
                  )}
                </>
              )}
            </div>
          )}
            {/* ---- A-bis · Riallocazioni per natura (IAS 1.104) ---- */}
            {voci.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                  <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                    A-bis · Riallocazione per natura — da CE per funzione a valore aggiunto (IAS 1.104)
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Quando il prospetto è per funzione (cost of sales, SG&A, R&D), la disclosure per natura
                    obbligatoria ex IAS 1.104 permette di ricostruire personale, ammortamenti e le altre
                    componenti per natura. Ogni riallocazione genera una coppia in partita doppia: storno
                    dalla classe funzionale di origine + imputazione alla classe per natura di
                    destinazione. Il totale costi e l'utile netto restano invariati; Valore Aggiunto ed
                    EBITDA diventano calcolabili.
                  </p>
                </div>
                <div className="px-5 py-4">
                  {niRiallocazioni.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nessuna riallocazione: o il CE è già per natura, oppure la Nota Integrativa non è
                      stata ancora caricata / non contiene la disclosure per natura. Usa «📎 Carica Nota
                      Integrativa (IA)» per attivare la conversione automatica.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-slate-600 mb-3">
                        Riallocazioni estratte: <b>{niRiallocazioni.length}</b> · applicate:{" "}
                        <b>{riallocazioniApplicate}</b> · mancanti:{" "}
                        <b className={riallocazioniMancanti.length ? "text-amber-600" : "text-teal-700"}>
                          {riallocazioniMancanti.length}
                        </b>
                        {riallocazioniMancanti.length > 0 && (
                          <>
                            {" "}·{" "}
                            <button
                              onClick={() => applicaRiallocazioni(niRiallocazioni)}
                              className="underline text-teal-700 font-semibold hover:text-teal-900"
                            >
                              applica ora
                            </button>
                          </>
                        )}
                      </p>
                      <div className="space-y-3">
                        {niRiallocazioni.map((r, i) => (
                          <div key={i} className={`flex items-start gap-3 text-sm ${r.attiva === false ? "opacity-45" : ""}`}>
                            <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRiallocazioneNI(i)} />
                            <div className="shrink-0 flex items-center gap-1">
                              <select
                                value={r.classeOrigine || ""}
                                onChange={(e) => modificaRiallocazioneNI(i, "classeOrigine", e.target.value)}
                                className="text-xs font-semibold text-teal-800 bg-white border border-teal-200 rounded px-1.5 py-1 max-w-[10.5rem]"
                                title={CLASSI[r.classeOrigine]?.label || "Classe di origine"}
                                aria-label="Classe di origine della riallocazione"
                              >
                                <option value="">— origine —</option>
                                {Object.keys(CLASSI).map((id) => (
                                  <option key={id} value={id}>{id}</option>
                                ))}
                              </select>
                              <span className="text-teal-700 font-bold">→</span>
                              <select
                                value={r.classeDestinazione || ""}
                                onChange={(e) => modificaRiallocazioneNI(i, "classeDestinazione", e.target.value)}
                                className="text-xs font-semibold text-teal-800 bg-white border border-teal-200 rounded px-1.5 py-1 max-w-[10.5rem]"
                                title={CLASSI[r.classeDestinazione]?.label || "Classe di destinazione"}
                                aria-label="Classe di destinazione della riallocazione"
                              >
                                <option value="">— destinazione —</option>
                                {Object.keys(CLASSI).map((id) => (
                                  <option key={id} value={id}>{id}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-800">
                                {r.descrizione}
                                {r.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono"> · pagina {r.pagina}</span>
                                )}
                              </p>
                              {r.motivazione && (
                                <p className="text-xs text-slate-500">{r.motivazione}</p>
                              )}
                            </div>
                            <span className="font-mono font-bold whitespace-nowrap">{fmt(r.importo)}</span>
                            <button
                              onClick={() => rimuoviRiallocazione(i)}
                              className="text-rose-500 font-bold px-1"
                              aria-label="Rimuovi riallocazione"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      {riallocazioniMancanti.length === 0 && (
                        <p className="mt-4 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg p-3 leading-relaxed">
                          ✓ CE convertito per natura: personale{" "}
                          <span className="font-mono font-bold">{fmt(calc.personale)}</span> · ammortamenti{" "}
                          <span className="font-mono font-bold">{fmt(calc.ammortamenti)}</span> ·
                          accantonamenti{" "}
                          <span className="font-mono font-bold">{fmt(calc.accantonamenti)}</span> ora
                          esposti nelle rispettive righe del prospetto qui sopra; le classi funzionali di
                          origine sono state ridotte in pari misura, quindi l'utile netto non cambia.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {/* ---- A · Normalizzazione del reddito & Earnings Power ---- */}
            {voci.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-8">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                  <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                    A · Normalizzazione del reddito — Earnings Power
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Le poste anomale individuate dalla Nota Integrativa sono stornate automaticamente dalla
                    gestione corrente («sopra la linea») e isolate in fondo al CE riclassificato («sotto la
                    linea»): special items in Gestione non corrente, contabilità creativa in Area
                    Extra-Gestione. I margini del CE riclassificato qui sopra sono quindi già l'Earnings Power depurato.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">Risultato gestione corrente grezzo (ante storni NI)</td>
                      <td className="px-5 py-2 text-right font-mono">{fmt(risultatoCorrenteGrezzo)}</td>
                    </tr>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">− Special items stornati → Gestione non corrente</td>
                      <td className="px-5 py-2 text-right font-mono text-slate-600">
                        {totSpecial < 0 ? `(${fmt(-totSpecial)})` : fmt(totSpecial)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">− Poste extra-gestione stornate (window dressing)</td>
                      <td className="px-5 py-2 text-right font-mono text-slate-600">
                        {totExtra < 0 ? `(${fmt(-totExtra)})` : fmt(totExtra)}
                      </td>
                    </tr>
                    <tr className="bg-teal-50 border-y border-teal-100">
                      <td className="px-5 py-2 font-extrabold text-teal-900">RISULTATO GESTIONE CORRENTE NORMALIZZATO</td>
                      <td className="px-5 py-2 text-right font-mono font-extrabold text-teal-900">{fmt(calc.risultatoCorrente)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="px-5 py-4 border-t border-slate-200">
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-3">
                    Rettifiche applicate ({niRettifiche.length})
                  </p>
                  {niRettifiche.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nessuna rettifica: carica la Nota Integrativa con il pulsante «📎 Carica Nota
                      Integrativa (IA)» per individuare special items e poste da contabilità creativa
                      annidate nelle voci ordinarie (A5, B10c, B14, C15, C17…).
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {niRettifiche.map((r, i) => (
                        <div key={i} className={`flex items-start gap-3 text-sm ${r.attiva === false ? "opacity-45" : ""}`}>
                          <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRettificaNI(i)} />
                          <span
                            className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${r.tipo === "extra_gestione" ? "bg-rose-100 text-rose-700 border-rose-200" : "bg-indigo-100 text-indigo-700 border-indigo-200"}`}
                          >
                            {r.tipo === "extra_gestione" ? "Extra-gestione" : "Special item"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800">
                              {r.descrizione}
                              {r.pagina != null && <span className="text-xs text-slate-400 font-mono"> · pagina {r.pagina}</span>}
                            </p>
                            <p className="text-xs text-slate-500">
                              {r.importo >= 0 ? "Provento" : "Onere"} stornato da{" "}
                              {r.classeOrigine ? CLASSI[r.classeOrigine].label.split("— ")[1] || r.classeOrigine : "voce ordinaria"}
                              {r.motivazione && ` — ${r.motivazione}`}
                            </p>
                          </div>
                          <span className="font-mono font-bold whitespace-nowrap">
                            {r.importo < 0 ? `(${fmt(-r.importo)})` : fmt(r.importo)}
                          </span>
                          <button onClick={() => rimuoviRettifica(i)} className="text-rose-500 font-bold px-1" aria-label="Rimuovi rettifica">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* ---- B · Fiscometria e NOPAT ---- */}
            {voci.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                      B · Fiscometria — normalizzazione del carico fiscale
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-lg">
                      Le imposte di bilancio gravano sul reddito totale lordo. Qui l'aliquota ordinaria è
                      applicata al solo reddito corrente normalizzato; le componenti anomale sono esposte
                      al netto del loro effetto fiscale.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 max-w-sm">
                    <label className="flex items-center gap-2 text-sm text-slate-700 whitespace-nowrap">
                      Aliquota ordinaria
                      <input
                        type="number"
                        step="0.1"
                        value={aliquota}
                        onChange={(e) => {
                          setAliquota(e.target.value === "" ? 0 : Number(e.target.value));
                          setFonteAliquota({ tipo: "manuale", testo: "Inserita a mano" });
                        }}
                        className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-right bg-white"
                        aria-label="Aliquota fiscale ordinaria %"
                      />
                      %
                    </label>
                    <p className={`text-[11px] leading-snug text-right ${fonteAliquota.tipo === "legale" ? "text-amber-700" : "text-slate-500"}`}>
                      <b>Fonte:</b> {fonteAliquota.tipo === "manuale" ? "inserita a mano" : fonteAliquota.testo || "—"}
                      {fonteAliquota.tipo !== "manuale" && fonteAliquota.citazione ? <> · «{fonteAliquota.citazione}»</> : null}
                      {fonteAliquota.tipo === "manuale" && (
                        <button type="button" onClick={() => setFonteAliquota({ tipo: "auto" })}
                          className="ml-1 underline text-indigo-700">
                          ↺ ricava dai documenti ({String(aliquotaProposta.valore).replace(".", ",")}%)
                        </button>
                      )}
                    </p>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">Risultato gestione corrente normalizzato</td>
                      <td className="px-5 py-2 text-right font-mono">{fmt(calc.risultatoCorrente)}</td>
                    </tr>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">Imposte teoriche ({aliquota}% sul reddito normalizzato)</td>
                      <td className="px-5 py-2 text-right font-mono text-slate-600">({fmt(imposteTeoriche)})</td>
                    </tr>
                    <tr className="bg-teal-50 border-y border-teal-100">
                      <td className="px-5 py-2 font-extrabold text-teal-900">EARNINGS POWER — utile netto normalizzato</td>
                      <td className="px-5 py-2 text-right font-mono font-extrabold text-teal-900">{fmt(earningsPower)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-5 py-2 font-bold">NOPAT = EBIT × (1 − {aliquota}%)</td>
                      <td className="px-5 py-2 text-right font-mono font-bold">{fmt(nopat)}</td>
                    </tr>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">Gestione non corrente al netto dell'effetto fiscale</td>
                      <td className="px-5 py-2 text-right font-mono">
                        {nonCorrenteNetto < 0 ? `(${fmt(-nonCorrenteNetto)})` : fmt(nonCorrenteNetto)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-5 py-2 text-slate-700">Area extra-gestione al netto dell'effetto fiscale</td>
                      <td className="px-5 py-2 text-right font-mono">
                        {extraNetto < 0 ? `(${fmt(-extraNetto)})` : fmt(extraNetto)}
                      </td>
                    </tr>
                    <tr className="bg-teal-50 border-y border-teal-100">
                      <td className="px-5 py-2 font-extrabold text-teal-900">
                        UTILE NETTO NORMALIZZATO COMPLESSIVO (Earnings Power + componenti anomale nette)
                      </td>
                      <td className={`px-5 py-2 text-right font-mono font-extrabold ${utileNettoNormalizzato < 0 ? "text-rose-700" : "text-teal-900"}`}>
                        {utileNettoNormalizzato < 0 ? `(${fmt(-utileNettoNormalizzato)})` : fmt(utileNettoNormalizzato)}
                      </td>
                    </tr>
                    <tr className="border-t border-slate-200 text-xs text-slate-500">
                      <td className="px-5 py-2 italic">Confronto: imposte contabili iscritte in bilancio</td>
                      <td className="px-5 py-2 text-right font-mono">({fmt(calc.imposte)})</td>
                    </tr>
                    <tr className="text-xs text-slate-500">
                      <td className="px-5 py-2 italic">Confronto: utile netto contabile</td>
                      <td className="px-5 py-2 text-right font-mono">{fmt(calc.utileNetto)}</td>
                    </tr>
                    <tr className="text-xs text-slate-500 border-t border-slate-100">
                      <td className="px-5 py-2 italic">
                        Δ Effetto fiscale anomalo (utile contabile − utile normalizzato): scostamento tra
                        carico fiscale effettivo e teorico ad aliquota ordinaria — se rilevante, indaga
                        agevolazioni, perdite pregresse, fiscalità differita o pianificazione aggressiva
                      </td>
                      <td className={`px-5 py-2 text-right font-mono font-bold ${Math.abs(effettoFiscaleAnomalo) > Math.abs(utileNettoNormalizzato) * 0.1 ? "text-amber-600" : "text-slate-500"}`}>
                        {effettoFiscaleAnomalo < 0 ? `(${fmt(-effettoFiscaleAnomalo)})` : fmt(effettoFiscaleAnomalo)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="px-5 py-3 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
                  <b>Collegamento con il prospetto riclassificato.</b> Le righe di questa tabella sono le
                  stesse esposte nell'area «Gestione tributaria normalizzata» in coda al CE a valore
                  aggiunto qui sopra: l'Utile Netto Normalizzato Complessivo ({fmt(utileNettoNormalizzato)})
                  è il reddito che l'azienda produrrebbe applicando l'aliquota ordinaria del {aliquota}% al
                  solo reddito corrente ripetibile, con le componenti anomale nettizzate alla stessa
                  aliquota. Il Δ effetto fiscale anomalo riconcilia questo valore con l'utile netto
                  contabile ({fmt(calc.utileNetto)}). Modificando l'aliquota qui sopra si aggiornano in
                  tempo reale entrambe le esposizioni.
                </p>
              </div>
            )}
          </>
        )}

        {/* ================= TAB 4 · MARGINI E INDICI RETTIFICATI ================= */}
        {tab === 4 && (
          <div>
            {voci.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Nessun dato: carica o inserisci le voci nel tab «1 · Dati & Validazione».
              </div>
            )}

            {voci.length > 0 && (() => {
              /* ---- grandezze normalizzate (già depurate da storni NI,
                     riallocazioni IAS 1.104 e poste extra-gestione) ---- */
              const fx = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d).replace(".", ","));
              const ebitdaMarginN = calc.ricavi > 0 ? (calc.ebitda / calc.ricavi) * 100 : null;
              const ebitdar = calc.ebitda + calc.godimento;
              const ebitdarMarginN = calc.ricavi > 0 ? (ebitdar / calc.ricavi) * 100 : null;

              /* ---- input di valutazione ---- */
              const eq = valutazione.equity !== "" ? Number(valutazione.equity) : null;
              const pfn = valutazione.pfn !== "" ? Number(valutazione.pfn) : null;
              const leas = valutazione.leasing !== "" ? Number(valutazione.leasing) : 0;
              const evBase = eq != null && pfn != null ? eq + pfn : null;
              const evPost = evBase != null ? evBase + leas : null;
              const evEbitda = evBase != null && calc.ebitda > 0 ? evBase / calc.ebitda : null;
              const evEbitdarPost = evPost != null && ebitdar > 0 ? evPost / ebitdar : null;

              /* ---- giudizi dinamici ---- */
              const giudizioEbitdaMargin =
                ebitdaMarginN == null ? "Ricavi assenti: margine non calcolabile."
                : ebitdaMarginN > 20 ? `Con un EBITDA Margin del ${fx(ebitdaMarginN)}%, ben oltre la soglia del 20%, ${azienda || "l'azienda"} si qualifica come altamente fiorente e profittevole: la gestione caratteristica genera liquidità operativa abbondante, capace di autofinanziare investimenti e servizio del debito — profilo ideale per un'operazione di acquisizione.`
                : ebitdaMarginN > 10 ? `Il ${fx(ebitdaMarginN)}% colloca ${azienda || "l'azienda"} in area di solidità, ma sotto la soglia d'eccellenza del 20% che denota le aziende altamente fiorenti: la capacità di autofinanziamento c'è, ma un acquirente valuterà i margini di miglioramento operativo prima di pagare multipli pieni.`
                : ebitdaMarginN > 0 ? `Un margine del ${fx(ebitdaMarginN)}% è modesto: la gestione operativa copre a fatica ammortamenti e oneri finanziari futuri. In un'ottica di acquisizione, la capacità di autofinanziamento tramite liquidità operativa è debole e il pricing ne risentirà.`
                : `EBITDA Margin negativo (${fx(ebitdaMarginN)}%): la gestione caratteristica distrugge cassa prima ancora di ammortamenti e oneri finanziari. Situazione critica che rende l'azienda finanziabile solo in ottica turnaround.`;

              const pesoCanoni = calc.ebitda !== 0 ? (calc.godimento / Math.abs(calc.ebitda)) * 100 : null;
              const giudizioEbitdar =
                calc.godimento === 0
                  ? `Nessun canone di godimento beni di terzi rilevato: EBITDAR ed EBITDA coincidono. ${azienda || "L'azienda"} opera con asset di proprietà (o i canoni sono già capitalizzati ex IFRS 16 sotto forma di ammortamenti): il confronto con competitor che affittano va fatto proprio su questo indicatore.`
                  : `I canoni sterilizzati ammontano a ${fmt(calc.godimento)} (${fx(pesoCanoni)}% dell'EBITDA): ${pesoCanoni > 30 ? "una mole massiccia di contratti d'affitto sostiene la marginalità apparente — attenzione: parte della redditività operativa è in realtà assorbita dalla struttura locativa" : "un peso contenuto della struttura locativa: la marginalità EBITDA è genuinamente operativa e il divario con l'EBITDAR è fisiologico"}. L'EBITDAR Margin del ${fx(ebitdarMarginN)}% è la base corretta per confrontare ${azienda || "l'azienda"} con competitor proprietari dei propri asset.`;

              const giudizioEv =
                evBase == null ? "Inserisci Capitalizzazione di mercato e Posizione Finanziaria Netta per calcolare l'Enterprise Value."
                : `L'EV di ${fmt(evBase)} è il prezzo «pieno» di ${azienda || "questa azienda"}: chi la compra paga ${fmt(eq)} agli azionisti e si accolla ${pfn >= 0 ? `${fmt(pfn)} di debito netto` : `una cassa netta di ${fmt(-pfn)} (che riduce l'esborso effettivo)`}${leas ? `; sommando ${fmt(leas)} di debito da leasing IFRS 16 l'EV post-IFRS 16 sale a ${fmt(evPost)}` : ""}.`;

              const giudizioMultiplo =
                evEbitda == null
                  ? (calc.ebitda <= 0 ? "EBITDA normalizzato nullo o negativo: il multiplo EV/EBITDA non è significativo — si passa a metriche alternative (EV/Sales, metodi patrimoniali)." : "Compila gli input di valutazione qui sopra per calcolare il multiplo.")
                  : `Il multiplo di ${fx(evEbitda)}× indica che, a parità di condizioni strutturali, la gestione operativa pura di ${azienda || "questa azienda"} ripagherebbe il costo di acquisizione (equity + debito) in circa ${fx(evEbitda)} anni. ${evEbitda < 5 ? "Sotto 5×: valutazione a sconto, tipica di settori maturi, aziende in difficoltà o situazioni di special situation — potenziale occasione, ma da verificare la qualità dell'EBITDA." : evEbitda <= 8 ? "Tra 5× e 8×: pieno range del mid-market Private Equity — pricing equilibrato per un'azienda sana in un settore tradizionale." : evEbitda <= 12 ? "Tra 8× e 12×: valutazione premium, giustificabile solo da crescita attesa, marginalità difendibile o asset strategici." : "Oltre 12×: valutazione molto piena, da settore growth o asset-light — rischio concreto di overpricing se la crescita non si materializza."}`;

              const giudizioMultiploPost =
                evEbitdarPost == null ? "Richiede EV completo del debito da leasing ed EBITDAR positivo."
                : `Il multiplo lease-neutral di ${fx(evEbitdarPost)}× consente il confronto «mele con mele» tra aziende con strutture proprietarie e locative diverse. ${evEbitda != null && Math.abs(evEbitda - evEbitdarPost) > 1 ? `Lo scarto rispetto al multiplo base (${fx(evEbitda)}×) rivela che la struttura degli affitti/leasing incide materialmente sulla valutazione di ${azienda || "questa azienda"}: una marginalità apparentemente stellare potrebbe nascondere contratti d'affitto capitalizzati.` : "Lo scarto contenuto rispetto al multiplo base conferma che leasing e affitti non distorcono la comparazione settoriale."}`;

              return (
                <>
                  {/* ---------- Margini rettificati (cliccabili) ---------- */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-baseline flex-wrap gap-2">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                        Margini rettificati — dopo riallocazioni per natura (IAS 1.104) e storni NI
                      </p>
                      <p className="text-xs text-slate-400">EUR · migliaia · % sui ricavi</p>
                    </div>

                    <IndicatoreEspandibile
                      nome="Valore aggiunto rettificato"
                      valore={fmt(calc.valoreAggiunto)}
                      sub={pct(calc.valoreAggiunto, calc.ricavi)}
                      dettaglio={{
                        formula: `Valore della produzione (${fmt(calc.valoreProduzione)}) − Costi esterni per acquisti, servizi, godimento e oneri diversi (${fmt(calc.costiEsterni)}) = ${fmt(calc.valoreAggiunto)}. I costi esterni incorporano già le riallocazioni per natura ex IAS 1.104 e gli storni delle poste non ricorrenti individuate dalla Nota Integrativa.`,
                        perche: "Misura la ricchezza che l'azienda crea trasformando i fattori acquistati all'esterno, prima di remunerare lavoro, capitale tecnico (ammortamenti), capitale di credito e fisco. È il primo margine della riclassificazione a valore aggiunto e la base del confronto tra imprese labour-intensive e capital-intensive.",
                        cosaIndica: "Un'incidenza alta sui ricavi segnala forte integrazione verticale o elevato contenuto di trasformazione interna; un'incidenza bassa indica un modello di business che compra e rivende con poca trasformazione (trading, distribuzione).",
                        valutazione: `Il valore aggiunto assorbe il ${pct(calc.personale, calc.valoreAggiunto)} in costo del lavoro: ${calc.valoreAggiunto > 0 && calc.personale / calc.valoreAggiunto > 0.7 ? "oltre il 70% della ricchezza creata va al fattore lavoro — la redditività residua per capitale e azionisti è compressa e ogni rinnovo contrattuale incide direttamente sull'EBITDA" : "la quota destinata al lavoro lascia spazio adeguato alla remunerazione del capitale tecnico e finanziario"}.`,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="EBITDA rettificato — Margine operativo lordo"
                      valore={fmt(calc.ebitda)}
                      sub={pct(calc.ebitda, calc.ricavi)}
                      evidenzia
                      dettaglio={{
                        formula: `Valore aggiunto (${fmt(calc.valoreAggiunto)}) − Costo del personale (${fmt(calc.personale)}) = ${fmt(calc.ebitda)}. È l'EBITDA NORMALIZZATO: depurato dalle componenti non ricorrenti stornate via Nota Integrativa e dalle poste di window dressing isolate nell'Area Extra-Gestione.`,
                        perche: "È la proxy più usata della liquidità generata dalla gestione operativa: esclude ammortamenti e accantonamenti (costi non monetari), oneri finanziari e imposte. Nelle operazioni di M&A e nel Private Equity è la grandezza-cardine su cui si costruiscono pricing e covenant bancari.",
                        cosaIndica: "Quanta cassa potenziale la gestione caratteristica produce prima delle politiche di investimento, finanziamento e fiscali. La versione normalizzata è confrontabile nel tempo e tra imprese, perché ripulita dalle distorsioni contabili.",
                        valutazione: `Gli ammortamenti e accantonamenti assorbono il ${pct(calc.ammortamenti + calc.accantonamenti, calc.ebitda)} dell'EBITDA: ${calc.ebitda > 0 && (calc.ammortamenti + calc.accantonamenti) / calc.ebitda > 0.6 ? "un assorbimento elevato che segnala forte intensità di capitale — gran parte della cassa operativa è impegnata a ricostituire gli asset" : "un assorbimento fisiologico che lascia ampio flusso disponibile per debito e azionisti"}. Vedi l'EBITDA Margin nella sezione 4.1 per il giudizio di profittabilità.`,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="EBIT rettificato (caratteristica + accessoria)"
                      valore={fmt(calc.ebit)}
                      sub={pct(calc.ebit, calc.ricavi)}
                      dettaglio={{
                        formula: `EBITDA (${fmt(calc.ebitda)}) − Ammortamenti e svalutazioni operative (${fmt(calc.ammortamenti)}) − Accantonamenti (${fmt(calc.accantonamenti)}) = Reddito operativo caratteristico (${fmt(calc.redditoOperativoCaratteristica)}); + Gestione accessoria (${fmt(calc.gestioneAccessoria)}) = ${fmt(calc.ebit)}.`,
                        perche: "Misura la redditività operativa DOPO il consumo del capitale tecnico: è la grandezza su cui si calcolano ROI e ROS e il punto di partenza per giudicare se l'azienda remunera il capitale investito più di quanto costi finanziarlo.",
                        cosaIndica: "Un EBIT positivo e stabile indica che il modello di business regge anche considerando il logorio degli investimenti; un divario ampio tra EBITDA ed EBIT rivela intensità di capitale o politiche di ammortamento aggressive/prudenti da indagare in nota.",
                        valutazione: `${calc.ebit > 0 ? `L'EBIT copre ${calc.oneriFin > 0 ? `${fx(calc.ebit / calc.oneriFin)} volte gli oneri finanziari (interest coverage)` : "integralmente oneri finanziari assenti o trascurabili"}: ${calc.oneriFin > 0 && calc.ebit / calc.oneriFin < 3 ? "una copertura sotto 3× è considerata fragile dai finanziatori" : "copertura confortevole per il servizio del debito"}` : "EBIT negativo: la gestione operativa non copre nemmeno il consumo del capitale tecnico — redditività strutturale assente"}.`,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Risultato della gestione corrente normalizzato"
                      valore={fmt(calc.risultatoCorrente)}
                      sub={pct(calc.risultatoCorrente, calc.ricavi)}
                      dettaglio={{
                        formula: `EBIT (${fmt(calc.ebit)}) + Gestione finanziaria netta (${fmt(calc.gestioneFinanziaria)}) = ${fmt(calc.risultatoCorrente)}. Esclude per costruzione la gestione non corrente (${fmt(calc.gestioneNonCorrente)}) e l'Area Extra-Gestione (${fmt(calc.extraGestione)}), esposte «sotto la linea».`,
                        perche: "È l'Earnings Power: il reddito che l'azienda è strutturalmente capace di ripetere anno dopo anno, al netto di eventi straordinari e artifici contabili. Dopo l'abolizione della macroclasse E (D.Lgs. 139/2015) va ricostruito dall'analista, come fatto qui via Nota Integrativa.",
                        cosaIndica: "La sostenibilità del reddito nel tempo: se il risultato corrente diverge molto dall'utile netto contabile, la qualità degli utili dipende da componenti una tantum e va scontata nel pricing.",
                        valutazione: `${Math.abs(calc.gestioneNonCorrente + calc.extraGestione) > Math.abs(calc.risultatoCorrente) * 0.2 ? `Le componenti non correnti ed extra-gestione (${fmt(calc.gestioneNonCorrente + calc.extraGestione)}) pesano oltre il 20% del risultato corrente: la qualità degli utili contabili è bassa e il reddito «vero» è quello qui esposto` : "Le componenti straordinarie sono marginali: l'utile contabile riflette fedelmente la capacità reddituale ripetibile"}. Gestione finanziaria ${calc.gestioneFinanziaria < 0 ? `negativa per ${fmt(-calc.gestioneFinanziaria)}: il debito erode il risultato operativo` : "non penalizzante"}.`,
                      }}
                    />

                    <div className="px-5 py-3 grid sm:grid-cols-3 gap-x-6 gap-y-2 border-t border-slate-200 text-xs text-slate-600">
                      <p>
                        Incidenza costo del lavoro su Valore Aggiunto:{" "}
                        <b className="font-mono">{pct(calc.personale, calc.valoreAggiunto)}</b>
                      </p>
                      <p>
                        Incidenza ammortamenti e accantonamenti su EBITDA:{" "}
                        <b className="font-mono">{pct(calc.ammortamenti + calc.accantonamenti, calc.ebitda)}</b>
                      </p>
                      <p>
                        Tax rate contabile vs aliquota teorica:{" "}
                        <b className="font-mono">
                          {pct(calc.imposte, calc.risultatoAnteImposte)} / {aliquota}%
                        </b>
                      </p>
                    </div>
                    <p className="px-5 py-3 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
                      I margini esposti derivano dal prospetto del tab «3 · CE a valore aggiunto» già
                      incorporante le riallocazioni per natura e gli storni della Nota Integrativa: sono
                      quindi i margini «puliti» confrontabili nel tempo e tra imprese. Clicca su ogni riga
                      per formula, finalità, lettura e giudizio pratico.
                    </p>
                  </div>

                  {/* ---------- 4.1 · EBITDA Margin & EBITDAR ---------- */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                        4.1 · EBITDA Margin ed EBITDAR — profittabilità e autofinanziamento
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Indici calcolati sull'EBITDA <b>normalizzato</b> grazie alla Nota Integrativa. Nelle
                        acquisizioni aziendali l'EBITDA Margin è il primo indicatore osservato per valutare la
                        capacità della target di autofinanziarsi con liquidità operativa: sopra il 20% denota
                        un'azienda altamente fiorente e profittevole.
                      </p>
                    </div>

                    <IndicatoreEspandibile
                      nome="EBITDA Margin"
                      valore={ebitdaMarginN != null ? `${fx(ebitdaMarginN)}%` : "—"}
                      evidenzia
                      dettaglio={{
                        formula: `EBITDA normalizzato (${fmt(calc.ebitda)}) ÷ Ricavi delle vendite e prestazioni (${fmt(calc.ricavi)}) × 100 = ${fx(ebitdaMarginN)}%.`,
                        perche: "È l'indicatore prioritario degli analisti nelle operazioni di acquisizione: misura quanta liquidità operativa l'azienda estrae da ogni euro di fatturato, e quindi la sua capacità di autofinanziarsi senza ricorrere a capitale esterno.",
                        cosaIndica: "Soglie di lettura consolidate: oltre il 20% azienda altamente fiorente e profittevole; 10–20% profittabilità solida; sotto il 10% marginalità debole; negativo distruzione di cassa operativa. Il confronto va sempre fatto con la mediana del settore.",
                        valutazione: giudizioEbitdaMargin,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="EBITDAR — EBITDA before Rent"
                      valore={fmt(ebitdar)}
                      sub={ebitdarMarginN != null ? `${fx(ebitdarMarginN)}%` : "—"}
                      dettaglio={{
                        formula: `EBITDA normalizzato (${fmt(calc.ebitda)}) + Canoni per godimento beni di terzi — affitti, noleggi, leasing operativi (${fmt(calc.godimento)}) = ${fmt(ebitdar)}. EBITDAR Margin = ${fx(ebitdarMarginN)}% dei ricavi.`,
                        perche: "Elimina del tutto la distorsione contabile tra aziende che ACQUISTANO i macchinari (generando ammortamento, sotto l'EBITDA) e aziende che li AFFITTANO (generando canoni, dentro l'EBITDA): sterilizzando anche i canoni di locazione, rende comparabili i due modelli.",
                        cosaIndica: "La redditività operativa «pura» della gestione, indipendente dalla scelta proprietà-vs-affitto degli asset. Fondamentale in settori ad alta intensità locativa (retail, hôtellerie, trasporto aereo) e nel confronto OIC (canoni a CE) vs IFRS 16 (canoni capitalizzati).",
                        valutazione: giudizioEbitdar,
                      }}
                    />
                  </div>

                  {/* ---------- 4.2 · Multipli di valutazione EV/EBITDA ---------- */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                        4.2 · Multipli di valutazione — Enterprise Value / EBITDA
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed mb-3">
                        Il metodo più impiegato nel Private Equity per il pricing aziendale. Inserisci i dati
                        patrimoniali e di mercato (stessa unità di misura del CE — migliaia EUR); l'EBITDA
                        usato è quello normalizzato via Nota Integrativa.
                      </p>
                      <div className="flex flex-wrap gap-3 items-start text-xs">
                        {[
                          { k: "equity", label: "Capitalizzazione / Equity Value", aria: "Capitalizzazione di mercato o valore dell'equity" },
                          { k: "pfn", label: "Posizione Finanziaria Netta", aria: "Posizione finanziaria netta (debito netto, negativo se cassa netta)" },
                          { k: "leasing", label: "Debito da leasing IFRS 16 (opz.)", aria: "Debito da leasing IFRS 16 opzionale" },
                        ].map(({ k, label, aria }) => (
                          <div key={k} className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
                            <input
                              type="number"
                              value={valutazione[k]}
                              placeholder={label}
                              onChange={(e) => setValutazione((v) => ({ ...v, [k]: e.target.value }))}
                              className="w-52 border border-slate-300 rounded-lg px-2 py-1.5 text-right bg-white"
                              aria-label={aria}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <IndicatoreEspandibile
                      nome="Enterprise Value (EV)"
                      valore={evBase != null ? fmt(evBase) : "—"}
                      sub={leas && evPost != null ? `post-IFRS16 ${fmt(evPost)}` : null}
                      dettaglio={{
                        formula: evBase != null
                          ? `Capitalizzazione di mercato / Equity Value (${fmt(eq)}) + Posizione Finanziaria Netta (${fmt(pfn)}) = ${fmt(evBase)}${leas ? `; + Debito da leasing IFRS 16 (${fmt(leas)}) = EV post-IFRS 16 ${fmt(evPost)}` : ""}.`
                          : "Capitalizzazione di mercato (o valore dell'Equity immesso dagli azionisti) + Posizione Finanziaria Netta (debito netto verso le banche); per aziende IFRS il debito da leasing va SEMPRE sommato alla PFN.",
                        perche: "Rappresenta il valore totale dell'asset aziendale: quanto costa davvero acquisire l'impresa, comprando l'equity dagli azionisti e accollandosi il debito netto. È il numeratore di tutti i multipli «unlevered».",
                        cosaIndica: "A differenza della sola capitalizzazione, l'EV è neutro rispetto alla struttura finanziaria: due aziende identiche operativamente, ma con leve diverse, hanno lo stesso EV pur avendo equity value diversissimi.",
                        valutazione: giudizioEv,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Multiplo EV / EBITDA"
                      valore={evEbitda != null ? `${fx(evEbitda)}×` : "—"}
                      evidenzia
                      dettaglio={{
                        formula: evEbitda != null
                          ? `EV (${fmt(evBase)}) ÷ EBITDA normalizzato (${fmt(calc.ebitda)}) = ${fx(evEbitda)}×.`
                          : "EV ÷ EBITDA normalizzato. Richiede EV calcolabile (equity + PFN) ed EBITDA positivo.",
                        perche: "È il metodo di pricing più impiegato nel Private Equity: essendo «unlevered» e «tax-neutral», a differenza del rudimentale P/E — distorto da politiche fiscali e leva finanziaria del management — consente di comparare in modo chirurgico aziende dello stesso settore con strutture finanziarie dissimili.",
                        cosaIndica: "In quanti anni la gestione operativa pura, in un quadro di invarianza strutturale, ripagherebbe integralmente il costo di acquisizione dell'azienda e l'assunzione del suo debito.",
                        valutazione: giudizioMultiplo,
                      }}
                    />
                    <IndicatoreEspandibile
                      nome="Multiplo EV / EBITDAR (post-IFRS 16, lease-neutral)"
                      valore={evEbitdarPost != null ? `${fx(evEbitdarPost)}×` : "—"}
                      dettaglio={{
                        formula: evEbitdarPost != null
                          ? `EV incluso debito da leasing (${fmt(evPost)}) ÷ EBITDAR (${fmt(ebitdar)}) = ${fx(evEbitdarPost)}×.`
                          : "(EV + debito da leasing IFRS 16) ÷ EBITDAR. Compila gli input, incluso il debito da leasing, per attivare il calcolo.",
                        perche: "Per confrontare «mele con mele»: l'IFRS 16 capitalizza i contratti d'affitto gonfiando EBITDA e debito rispetto a chi applica OIC o possiede gli asset. Rettificando numeratore (EV + lease debt) e denominatore (EBITDAR) l'effetto è sterilizzato in modo coerente.",
                        cosaIndica: "Il multiplo di valutazione depurato dalla scelta proprietà-vs-locazione: se diverge molto dal multiplo base, una marginalità apparentemente stellare nasconde una mole massiccia di contratti d'affitto capitalizzati.",
                        valutazione: giudizioMultiploPost,
                      }}
                    />
                  </div>
                </>
              );
            })()}


          </div>
        )}

        {/* ================= TAB 5 · COLLEGAMENTO CCNO ================= */}
        {tab === 5 && (
          <div>
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">
              Grandezze economiche derivate — collegate automaticamente al tab «Determinanti CCNO»
            </p>
            <div className="grid sm:grid-cols-3 gap-4 mb-6">
              {[
                ["Fatturato", calc.ricavi, "Σ Ricavi delle vendite e prestazioni — alimenta i giorni di dilazione clienti (DSO)"],
                ["Consumi di materie", calc.consumi, "Acquisti − Δ rimanenze materie — alimenta i giorni di giacenza scorte (DIO)"],
                ["Acquisti", calc.acquisti, "Σ Acquisti materie, sussidiarie e merci — alimenta i giorni di dilazione fornitori (DPO)"],
              ].map(([nome, val, desc]) => (
                <div key={nome} className="border border-slate-200 rounded-xl p-5">
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">{nome}</p>
                  <p className="text-2xl font-extrabold font-mono mb-2">{voci.length ? fmt(val) : "—"}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="border border-teal-200 bg-teal-50 rounded-xl p-5 text-sm text-teal-900 leading-relaxed">
              <b>Collegamento automatico attivo.</b> Fatturato, consumi e acquisti non vanno più digitati a
              mano nel tab «Determinanti CCNO»: sono derivati dalle voci della gestione caratteristica
              validate nel tab 1 e si aggiornano in tempo reale a ogni modifica di importi o classi. In
              integrazione con l'app completa, <code className="font-mono text-xs">domain/calcoli.js</code>{" "}
              espone <code className="font-mono text-xs">calcolaCE(voci)</code> e il tab CCNO legge{" "}
              <code className="font-mono text-xs">{"{ ricavi, consumi, acquisti }"}</code> da questo modulo.
            </div>
          </div>
        )}

        {/* ================= TAB 6 · SEGMENT REPORTING (ASA) ================= */}
        {tab === 6 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6">
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-3">
                Aree Strategiche d'Affari ({asaList.length})
              </p>
              <div className="space-y-2 mb-4">
                {asaList.map((a, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      value={a}
                      onChange={(e) => rinominaAsa(i, e.target.value)}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      aria-label="Nome ASA"
                    />
                    <button onClick={() => eliminaAsa(i)} className="text-rose-500 font-bold px-1" aria-label="Elimina ASA">×</button>
                  </div>
                ))}
                {asaList.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Nessuna ASA definita. Aggiungi le Aree Strategiche d'Affari, poi assegna le voci della
                    gestione caratteristica dal tab «Dati & Validazione»; le voci non assegnate confluiscono
                    nella colonna «Comune / corporate».
                  </p>
                )}
              </div>
              <button
                onClick={aggiungiAsa}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
              >
                + Aggiungi ASA
              </button>
            </div>

            {voci.length > 0 && asaList.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-x-auto mb-6">
                <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-baseline flex-wrap gap-2">
                  <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                    Segment reporting — gestione caratteristica per ASA
                  </p>
                  <p className="text-xs text-slate-400">EUR · migliaia</p>
                </div>
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="px-5 py-2 text-left font-semibold"> </th>
                      {asaList.map((a) => (
                        <th key={a} className="px-4 py-2 text-right font-bold text-slate-700">{a}</th>
                      ))}
                      <th className="px-4 py-2 text-right font-semibold italic">Comune / corporate</th>
                      <th className="px-4 py-2 text-right font-bold text-slate-900">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Ricavi caratteristici", "ricavi", false],
                      ["Altri componenti valore produzione", "altriComponenti", false],
                      ["Valore della produzione", "valoreProduzione", "sub"],
                      ["Costi esterni", "costiEsterni", false, true],
                      ["Valore aggiunto", "valoreAggiunto", "sub"],
                      ["Costo del personale", "personale", false, true],
                      ["EBITDA", "ebitda", "margine"],
                      ["Ammortamenti e accantonamenti", "ammAcc", false, true],
                      ["EBIT di ASA", "ebit", "margine"],
                    ].map(([label, campo, tipo, negativo]) => {
                      const tot =
                        asaList.reduce((a, k) => a + segmenti[k][campo], 0) + segmenti[ASA_COMUNE][campo];
                      const cella = (val, chiaveExtra) => (
                        <td
                          key={chiaveExtra}
                          className={`px-4 py-2 text-right font-mono ${tipo === "margine" ? "font-extrabold text-teal-900" : tipo === "sub" ? "font-bold" : "text-slate-600"}`}
                        >
                          {negativo && val !== 0 ? `(${fmt(val)})` : fmt(val)}
                        </td>
                      );
                      return (
                        <tr
                          key={label}
                          className={tipo === "margine" ? "bg-teal-50 border-y border-teal-100" : tipo === "sub" ? "bg-slate-50" : ""}
                        >
                          <td className={`px-5 py-2 ${tipo === "margine" ? "font-extrabold text-teal-900" : tipo === "sub" ? "font-bold" : "text-slate-700"}`}>
                            {label}
                          </td>
                          {asaList.map((a) => cella(segmenti[a][campo], a))}
                          {cella(segmenti[ASA_COMUNE][campo], "comune")}
                          {cella(tot, "tot")}
                        </tr>
                      );
                    })}
                    <tr className="border-t border-slate-200 text-xs text-slate-500">
                      <td className="px-5 py-2 italic">EBITDA % sui ricavi di ASA</td>
                      {asaList.map((a) => (
                        <td key={a} className="px-4 py-2 text-right font-mono">{pct(segmenti[a].ebitda, segmenti[a].ricavi)}</td>
                      ))}
                      <td className="px-4 py-2 text-right font-mono">—</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{pct(calc.ebitda, calc.ricavi)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {voci.length > 0 && asaList.length > 0 && (
              <div className="border border-teal-200 bg-teal-50 rounded-xl p-5 text-sm text-teal-900 leading-relaxed">
                <b>Riconciliazione.</b> La somma degli EBIT di ASA e della colonna comune/corporate coincide
                con il reddito operativo della gestione caratteristica del CE riclassificato (
                <span className="font-mono">{fmt(calc.redditoOperativoCaratteristica)}</span>
                {Math.round(asaList.reduce((a, k) => a + segmenti[k].ebit, 0) + segmenti[ASA_COMUNE].ebit) === Math.round(calc.redditoOperativoCaratteristica) ? " ✓" : " ✗ — verifica le allocazioni"}
                ). Le gestioni finanziaria, accessoria e non corrente restano a livello di gruppo e non sono
                allocate alle ASA.
              </div>
            )}

            {/* ================= 6.1 · DIRECT COSTING EVOLUTO — MARGINI DI CONTRIBUZIONE PER ASA ================= */}
            {voci.length > 0 && asaList.length > 0 && (() => {
              const fx = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d).replace(".", ","));

              /* ---- aggregati sulle sole ASA (esclusa colonna comune) ---- */
              const totali = asaList.reduce(
                (t, a) => ({
                  ricavi: t.ricavi + contrib[a].ricavi,
                  costiVariabili: t.costiVariabili + contrib[a].costiVariabili,
                  costiFissi: t.costiFissi + contrib[a].costiFissi,
                  mlc: t.mlc + contrib[a].mlc,
                  mslc: t.mslc + contrib[a].mslc,
                }),
                { ricavi: 0, costiVariabili: 0, costiFissi: 0, mlc: 0, mslc: 0 }
              );
              const com = contrib[ASA_COMUNE];
              /* Costi Fissi Comuni netti: tutti i costi della colonna comune/corporate
                 (qualunque natura) al netto degli eventuali ricavi comuni */
              const costiComuniNetti = com.costiVariabili + com.costiFissi - com.ricavi;
              const roCorporate = totali.mslc - costiComuniNetti;
              const quadra = Math.round(roCorporate) === Math.round(calc.redditoOperativoCaratteristica);

              /* ---- classifica delle ASA per MSLC ---- */
              const ordinate = [...asaList].sort((x, y) => contrib[y].mslc - contrib[x].mslc);
              const migliore = ordinate[0];
              const peggiore = ordinate[ordinate.length - 1];
              const mslcNegative = asaList.filter((a) => contrib[a].mslc < 0);
              const mlcNegative = asaList.filter((a) => contrib[a].mlc < 0);
              const copertura = costiComuniNetti > 0 ? (totali.mslc / costiComuniNetti) : null;

              const etichetteVar = CLASSI_COSTO_NATURA.filter(([k]) => classiVariabili.includes(k)).map(([, l]) => l).join(", ") || "nessuna classe";
              const etichetteFisse = CLASSI_COSTO_NATURA.filter(([k]) => !classiVariabili.includes(k)).map(([, l]) => l).join(", ") || "nessuna classe";

              /* ---- giudizi dinamici ---- */
              const giudizioMlc =
                totali.ricavi <= 0
                  ? "Ricavi di ASA assenti: margine non calcolabile."
                  : `Il MLC complessivo delle ASA è ${fmt(totali.mlc)} (${pct(totali.mlc, totali.ricavi)} dei ricavi di ASA). ${
                      mlcNegative.length
                        ? `⚠ ${mlcNegative.map((a) => `«${a}»`).join(", ")} present${mlcNegative.length === 1 ? "a" : "ano"} MLC NEGATIVO: il prezzo di vendita non copre nemmeno i costi variabili — ogni unità venduta genera una perdita incrementale. Salvo motivazioni strategiche documentate (prodotto civetta, penetrazione di mercato), la produzione va sospesa immediatamente.`
                        : `Tutte le ASA hanno MLC positivo: l'efficienza industriale di base è verificata per ogni business — ogni unità venduta contribuisce alla copertura dei costi fissi. La migliore per incidenza è «${[...asaList].sort((x, y) => (contrib[y].ricavi ? contrib[y].mlc / contrib[y].ricavi : -1) - (contrib[x].ricavi ? contrib[x].mlc / contrib[x].ricavi : -1))[0]}».`
                    }`;

              const giudizioMslc =
                `La classifica per MSLC vede «${migliore}» al vertice con ${fmt(contrib[migliore].mslc)} (${pct(contrib[migliore].mslc, contrib[migliore].ricavi)} dei suoi ricavi)${asaList.length > 1 ? ` e «${peggiore}» in coda con ${fmt(contrib[peggiore].mslc)} (${pct(contrib[peggiore].mslc, contrib[peggiore].ricavi)})` : ""}. ${
                  mslcNegative.length
                    ? `⚠ ${mslcNegative.map((a) => `«${a}»`).join(", ")} ${mslcNegative.length === 1 ? "ha" : "hanno"} MSLC NEGATIVO: il business non copre nemmeno i propri costi fissi speciali e distrugge valore anche prima di considerare i costi comuni — candidat${mslcNegative.length === 1 ? "o" : "i"} al taglio chirurgico (dismissione o ristrutturazione radicale), poiché eliminandol${mslcNegative.length === 1 ? "o" : "i"} sparirebbero anche i relativi costi fissi speciali.`
                    : `Tutte le ASA hanno MSLC positivo: ogni business ha la forza reale per contribuire alla copertura dei costi comuni del quartier generale. Gli investimenti incrementali vanno indirizzati prioritariamente verso «${migliore}», che presenta la contribuzione più robusta.`
                }`;

              const giudizioRo =
                `La Σ dei MSLC (${fmt(totali.mslc)}) copre ${copertura != null ? `${fx(copertura * 100, 0)}% dei` : "i"} Costi Fissi Comuni (${fmt(costiComuniNetti)}): ${
                  roCorporate > 0
                    ? copertura != null && copertura < 1.3
                      ? "il Reddito Operativo Corporate è positivo ma la copertura è risicata (sotto 1,3×) — la struttura centrale assorbe quasi tutta la contribuzione dei business e ogni flessione di un'ASA rischia di portare il consolidato in perdita operativa. Valutare snellimento dei costi di quartier generale."
                      : "il Reddito Operativo Corporate è positivo con margine di sicurezza adeguato: i business generano contribuzione ben oltre il fabbisogno della struttura centrale."
                    : "⚠ Reddito Operativo Corporate NEGATIVO: la somma delle contribuzioni dei business non basta a pagare il quartier generale. Le opzioni sono due, non alternative: potenziare le ASA a MSLC alto e tagliare quelle a MSLC negativo, oppure ridimensionare drasticamente i costi fissi comuni."
                } ${quadra ? "La quadratura con il reddito operativo della gestione caratteristica del CE riclassificato è verificata ✓." : "⚠ La quadratura con il CE riclassificato non torna: verifica le allocazioni ASA nel tab 1."}`;

              return (
                <>
                  {/* ---------- Intro metodologica + configurazione variabili/fissi ---------- */}
                  <div className="border border-slate-200 rounded-xl p-5 mt-8 mb-6 bg-slate-50">
                    <p className="font-bold text-sm mb-1">⚙ 6.1 · Direct costing evoluto — margini di contribuzione per ASA</p>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">
                      Innestando la logica disaggregata variabili/fissi sul segment reporting si ottengono
                      due margini specifici per valutare la salute del singolo business: il{" "}
                      <b>Margine Lordo di Contribuzione</b> (Ricavi ASA − Costi Variabili Speciali), che
                      misura l'efficienza industriale di base del prodotto, e il{" "}
                      <b>Margine Semi-Lordo di Contribuzione</b> (MLC − Costi Fissi Speciali),
                      l'indicatore strategico per eccellenza: comunica quale business ha la forza reale
                      di contribuire alla copertura dei costi comuni del quartier generale. Sommati i
                      MSLC di tutte le ASA e sottratti in blocco i <b>Costi Fissi Comuni</b>, si giunge
                      all'unico grande <b>Reddito Operativo (Corporate)</b>; da lì in poi gestione
                      finanziaria e fiscale sono trattate unitariamente per tutta l'impresa.
                    </p>
                    <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-2">
                      Partizione dei costi speciali: spunta le classi da trattare come VARIABILI
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {CLASSI_COSTO_NATURA.map(([k, label]) => (
                        <label key={k} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={classiVariabili.includes(k)}
                            onChange={() =>
                              setClassiVariabili((prev) =>
                                prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
                              )
                            }
                            className="accent-teal-700"
                          />
                          {label}
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${classiVariabili.includes(k) ? "bg-teal-100 text-teal-700 border-teal-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                            {classiVariabili.includes(k) ? "variabile" : "fisso speciale"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                      Le classi non spuntate sono trattate come Costi Fissi Speciali dell'ASA di
                      appartenenza. Tutte le voci della colonna «Comune / corporate» — qualunque ne sia
                      la natura — confluiscono nei Costi Fissi Comuni sottratti in blocco dopo la Σ dei
                      MSLC. La variazione rimanenze materie segue il bucket dei consumi con segno
                      invertito.
                    </p>
                  </div>

                  {/* ---------- Prospetto a margini di contribuzione per ASA ---------- */}
                  <div className="border border-slate-200 rounded-xl overflow-x-auto mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-baseline flex-wrap gap-2">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                        Conto economico a margini di contribuzione — per ASA
                      </p>
                      <p className="text-xs text-slate-400">EUR · migliaia</p>
                    </div>
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="px-5 py-2 text-left font-semibold"> </th>
                          {asaList.map((a) => (
                            <th key={a} className="px-4 py-2 text-right font-bold text-slate-700">{a}</th>
                          ))}
                          <th className="px-4 py-2 text-right font-bold text-slate-900">Totale ASA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["Ricavi e componenti di ASA", "ricavi", false, false],
                          ["Costi variabili (speciali)", "costiVariabili", false, true],
                          ["MARGINE LORDO DI CONTRIBUZIONE (MLC)", "mlc", "margine", false],
                          ["Costi fissi speciali", "costiFissi", false, true],
                          ["MARGINE SEMI-LORDO DI CONTRIBUZIONE (MSLC)", "mslc", "margine", false],
                        ].map(([label, campo, tipo, negativo]) => (
                          <tr
                            key={label}
                            className={tipo === "margine" ? "bg-teal-50 border-y border-teal-100" : ""}
                          >
                            <td className={`px-5 py-2 ${tipo === "margine" ? "font-extrabold text-teal-900" : "text-slate-700"}`}>
                              {label}
                            </td>
                            {asaList.map((a) => {
                              const val = contrib[a][campo];
                              return (
                                <td
                                  key={a}
                                  className={`px-4 py-2 text-right font-mono ${tipo === "margine" ? `font-extrabold ${val < 0 ? "text-rose-700" : "text-teal-900"}` : "text-slate-600"}`}
                                >
                                  {negativo && val !== 0 ? `(${fmt(val)})` : val < 0 && tipo === "margine" ? `(${fmt(-val)})` : fmt(val)}
                                </td>
                              );
                            })}
                            <td className={`px-4 py-2 text-right font-mono ${tipo === "margine" ? `font-extrabold ${totali[campo] < 0 ? "text-rose-700" : "text-teal-900"}` : "font-bold text-slate-700"}`}>
                              {negativo && totali[campo] !== 0 ? `(${fmt(totali[campo])})` : totali[campo] < 0 && tipo === "margine" ? `(${fmt(-totali[campo])})` : fmt(totali[campo])}
                            </td>
                          </tr>
                        ))}
                        <tr className="text-xs text-slate-500">
                          <td className="px-5 py-2 italic">MLC % sui ricavi di ASA</td>
                          {asaList.map((a) => (
                            <td key={a} className="px-4 py-2 text-right font-mono">{pct(contrib[a].mlc, contrib[a].ricavi)}</td>
                          ))}
                          <td className="px-4 py-2 text-right font-mono font-bold">{pct(totali.mlc, totali.ricavi)}</td>
                        </tr>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <td className="px-5 py-2 italic">MSLC % sui ricavi di ASA</td>
                          {asaList.map((a) => (
                            <td key={a} className="px-4 py-2 text-right font-mono">{pct(contrib[a].mslc, contrib[a].ricavi)}</td>
                          ))}
                          <td className="px-4 py-2 text-right font-mono font-bold">{pct(totali.mslc, totali.ricavi)}</td>
                        </tr>
                        {/* discesa al Reddito Operativo Corporate */}
                        <tr className="bg-slate-50">
                          <td className="px-5 py-2 font-bold" colSpan={asaList.length + 1}>Σ Margini semi-lordi di contribuzione delle ASA</td>
                          <td className="px-4 py-2 text-right font-mono font-bold">{fmt(totali.mslc)}</td>
                        </tr>
                        <tr>
                          <td className="px-5 py-2 text-slate-700" colSpan={asaList.length + 1}>
                            Costi fissi comuni (quartier generale{com.ricavi ? ", al netto dei ricavi comuni" : ""})
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-slate-600">({fmt(costiComuniNetti)})</td>
                        </tr>
                        <tr className="bg-teal-50 border-y border-teal-100">
                          <td className="px-5 py-2 font-extrabold text-teal-900" colSpan={asaList.length + 1}>
                            REDDITO OPERATIVO (CORPORATE) {quadra ? "✓" : "✗ — verifica allocazioni"}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono font-extrabold ${roCorporate < 0 ? "text-rose-700" : "text-teal-900"}`}>
                            {roCorporate < 0 ? `(${fmt(-roCorporate)})` : fmt(roCorporate)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* ---------- Indicatori espandibili: MLC · MSLC per ASA · RO Corporate ---------- */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                        Margini di contribuzione — analisi guidata (clicca ogni riga)
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Ogni indicatore si apre a tendina con formula, finalità, lettura del valore e
                        valutazione pratica sull'azienda in analisi. Partizione corrente: variabili ={" "}
                        {etichetteVar}; fissi speciali = {etichetteFisse}.
                      </p>
                    </div>

                    <IndicatoreEspandibile
                      nome="Margine Lordo di Contribuzione (MLC) — totale ASA"
                      valore={fmt(totali.mlc)}
                      sub={pct(totali.mlc, totali.ricavi)}
                      dettaglio={{
                        formula: `Ricavi e componenti delle ASA (${fmt(totali.ricavi)}) − Costi Variabili Speciali (${fmt(totali.costiVariabili)}) = ${fmt(totali.mlc)}. I costi variabili sono le classi spuntate nella configurazione qui sopra (${etichetteVar}), attribuite a ciascuna ASA secondo le allocazioni del tab 1; la variazione rimanenze materie segue i consumi con segno invertito.`,
                        perche: "Misura l'efficienza industriale di base del prodotto: quanto ogni euro di ricavo lascia sul tavolo dopo aver pagato i soli costi che variano con i volumi. È il primo test di sopravvivenza di un business — se non è positivo, produrre di più significa solo perdere di più — ed è la grandezza su cui si costruiscono break-even analysis e decisioni di make-or-buy.",
                        cosaIndica: "Un MLC% alto segnala pricing power o struttura produttiva snella sui costi diretti; un MLC% basso indica un business a volumi in cui la redditività dipende dalla saturazione della capacità. Un MLC negativo è patologico: il prezzo non copre nemmeno la distinta base e la manodopera variabile.",
                        valutazione: giudizioMlc,
                      }}
                    />

                    {asaList.map((a) => {
                      const s = contrib[a];
                      const quotaSuTot = totali.mslc > 0 ? (s.mslc / totali.mslc) * 100 : null;
                      return (
                        <IndicatoreEspandibile
                          key={a}
                          nome={`Margine Semi-Lordo di Contribuzione — «${a}»`}
                          valore={fmt(s.mslc)}
                          sub={pct(s.mslc, s.ricavi)}
                          evidenzia={a === migliore}
                          dettaglio={{
                            formula: `MLC di «${a}» (Ricavi ${fmt(s.ricavi)} − Costi variabili ${fmt(s.costiVariabili)} = ${fmt(s.mlc)}) − Costi Fissi Speciali dell'ASA (${fmt(s.costiFissi)}) = ${fmt(s.mslc)}.`,
                            perche: "È l'indicatore strategico per eccellenza a livello di singolo business: comunica in modo inequivocabile se questa ASA ha la forza reale per contribuire alla copertura dei costi comuni del quartier generale. A differenza del MLC, incorpora anche i costi fissi che esistono SOLO perché esiste questo business (impianti dedicati, personale dedicato, ammortamenti specifici) e che sparirebbero eliminandolo.",
                            cosaIndica: "MSLC positivo: il business si autofinanzia e versa un contributo netto al centro — la domanda diventa quanto spingerlo con investimenti ulteriori. MSLC negativo: il business brucia cassa anche prima dei costi comuni — la domanda diventa se tagliarlo chirurgicamente, perché la sua eliminazione libererebbe integralmente i costi fissi speciali qui esposti.",
                            valutazione:
                              s.mslc < 0
                                ? `«${a}» distrugge ${fmt(-s.mslc)} di valore prima ancora dei costi comuni: candidata al taglio chirurgico o a una ristrutturazione radicale (repricing, ridisegno del perimetro dei costi fissi speciali ${fmt(s.costiFissi)}). Da verificare eventuali interdipendenze commerciali con le altre ASA prima della dismissione.`
                                : `«${a}» contribuisce con ${fmt(s.mslc)} alla copertura dei costi comuni${quotaSuTot != null ? `, pari al ${quotaSuTot.toFixed(1).replace(".", ",")}% della contribuzione complessiva` : ""}. ${a === migliore ? "È il business più forte del portafoglio: destinazione prioritaria per gli investimenti incrementali." : a === peggiore && asaList.length > 1 ? "È il business più debole del portafoglio: positivo ma da monitorare — un'analisi di sensitività sui volumi dirà quanto margine di sicurezza resta prima dell'azzeramento." : "Contribuzione solida, da presidiare mantenendo l'attuale struttura di costi speciali."}`,
                          }}
                        />
                      );
                    })}

                    <IndicatoreEspandibile
                      nome="Σ Margini Semi-Lordi − Costi Fissi Comuni = Reddito Operativo (Corporate)"
                      valore={fmt(roCorporate)}
                      sub={pct(roCorporate, totali.ricavi)}
                      evidenzia
                      dettaglio={{
                        formula: `Σ MSLC delle ${asaList.length} ASA (${fmt(totali.mslc)}) − Costi Fissi Comuni del quartier generale (${fmt(costiComuniNetti)}${com.ricavi ? `, già al netto di ${fmt(com.ricavi)} di ricavi comuni` : ""}) = ${fmt(roCorporate)}. I costi comuni sono tutte le voci della colonna «Comune / corporate», sottratte in blocco senza alcun ribaltamento arbitrario sulle ASA.`,
                        perche: "Chiude la piramide del direct costing evoluto: dopo aver misurato la forza di ogni business con il suo MSLC, i costi comuni — che per definizione non sono attribuibili in modo oggettivo a nessuna ASA — vengono sottratti in un unico blocco a livello corporate, evitando i ribaltamenti convenzionali del full costing che distorcono i giudizi sui singoli business. Da questo livello in poi, la gestione finanziaria e fiscale è trattata unitariamente per tutta l'impresa.",
                        cosaIndica: "Il rapporto tra Σ MSLC e costi comuni misura la sostenibilità della struttura centrale: sopra 1,5× il quartier generale è ampiamente finanziato dai business; tra 1× e 1,3× la copertura è risicata; sotto 1× la holding vive al di sopra dei propri mezzi. La quadratura con il reddito operativo caratteristico del CE riclassificato certifica la coerenza delle allocazioni.",
                        valutazione: giudizioRo,
                      }}
                    />
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ================= TAB 3 · RELAZIONE SULLA GESTIONE (4 SEZIONI) ================= */}
        {/* NB: id interno 9 — posizionato come Tab 3 nella barra di navigazione. */}
        {tab === 9 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">📎 Relazione sulla Gestione filtrata in 4 sezioni tematiche</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                L'IA legge la <b>Relazione sulla Gestione</b> (art. 2428 c.c. / Management Commentary) — un
                documento discorsivo — e ne estrae SOLO i fatti utili all'analisi del CE, organizzati in
                quattro sezioni tematiche: <b>1) Andamento dei ricavi e quote di mercato</b>,{" "}
                <b>2) Dinamiche dei costi operativi</b> (rincari materie, inflazione),{" "}
                <b>3) Eventi straordinari e ristrutturazioni</b> (chiave per normalizzare l'EBITDA) e{" "}
                <b>4) Investimenti strategici e R&S</b>. Gli eventi straordinari commentati dal management
                generano <b>special items</b> che vengono stornati dalla marginalità ordinaria e{" "}
                <b>combinati con le rettifiche della Nota Integrativa</b> nel CE a valore aggiunto.
              </p>
            </div>

            {rgFonte && (
              <p className="text-sm text-teal-700 mb-4">Relazione sulla Gestione caricata da {rgFonte}.</p>
            )}

            {rgEstratti.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Nessuna Relazione sulla Gestione caricata. Usa il pulsante{" "}
                <b>«📎 Carica Relazione sulla Gestione (IA)»</b> in cima alla pagina per attivare
                l'estrazione tematica.
              </div>
            )}

            {/* ---- I 4 blocchi tematici: tema · contenuto · pagina ---- */}
            {rgEstratti.length > 0 && (
              <div className="space-y-6">
                {[1, 2, 3, 4].map((s) => {
                  const items = rgEstratti.filter((i) => i.sezione === s);
                  const sez = RG_SEZIONI_CE[s];
                  return (
                    <div key={s} className={`border rounded-xl overflow-hidden ${sez.color}`}>
                      <div className="px-5 py-3 flex items-center gap-3 border-b border-current/10">
                        <span className={`${sez.badge} text-white text-xs font-extrabold rounded-full w-7 h-7 flex items-center justify-center`}>
                          {s}
                        </span>
                        <p className="font-bold text-sm flex-1">{sez.titolo}</p>
                        <span className="text-xs font-mono opacity-70">
                          {items.length} estratt{items.length === 1 ? "o" : "i"}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <p className="px-5 py-4 text-xs italic opacity-70">
                          Nessun elemento pertinente estratto per questa sezione.
                        </p>
                      ) : (
                        <div className="divide-y divide-current/10 bg-white">
                          {items.map((it, i) => (
                            <div key={i} className="px-5 py-4">
                              <div className="flex justify-between items-baseline gap-3 mb-1">
                                <p className="font-bold text-sm text-slate-900">{it.tema}</p>
                                {it.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                                    · pagina {it.pagina}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-700 leading-relaxed">{it.contenuto}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---- Tabella riepilogativa: Rettifiche (special items) imposte dalla RG ---- */}
            {rgEstratti.length > 0 && (
              <div className="border border-indigo-200 rounded-xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-indigo-200 bg-indigo-50">
                  <p className="text-xs font-bold tracking-widest text-indigo-700 uppercase mb-1">
                    Rettifiche di normalizzazione dalla Relazione sulla Gestione
                  </p>
                  <p className="text-xs text-indigo-900/70 leading-relaxed">
                    Gli special items che il management commenta nella Relazione (oneri di ristrutturazione,
                    plus/minusvalenze e impairment una tantum, indennizzi eccezionali) vengono stornati dalla
                    gestione corrente ed esposti «sotto la linea», così la marginalità ordinaria (EBITDA /
                    EBIT / Earnings Power) è depurata. Questi storni sono <b>combinati con quelli della Nota
                    Integrativa</b> nel CE a valore aggiunto.
                  </p>
                </div>
                {rgRettifiche.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500 leading-relaxed">
                    {rgFonte
                      ? "✓ Dalla Relazione sulla Gestione non emergono componenti straordinarie quantificabili da stornare: la marginalità ordinaria non richiede rettifiche da questa fonte."
                      : "Nessuna Relazione analizzata: carica il documento per attivare la ricerca automatica degli special items."}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                        <th className="px-4 py-2 text-left">Descrizione</th>
                        <th className="px-4 py-2 text-left">Classe di origine</th>
                        <th className="px-4 py-2 text-left">Motivazione</th>
                        <th className="px-4 py-2 text-right">Pag.</th>
                        <th className="px-4 py-2 text-right">Importo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rgRettifiche.map((r, i) => (
                        <tr key={i} className={`border-t border-slate-100 align-top ${r.attiva === false ? "opacity-45" : ""}`}>
                          <td className="px-4 py-2.5 font-semibold text-slate-800">
                            <div className="flex items-center gap-2">
                              <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRettificaRG(i)} />
                              <span>{r.descrizione}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">
                            {r.classeOrigine ? (CLASSI[r.classeOrigine]?.label.split("— ")[1] || r.classeOrigine) : "voce ordinaria"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 leading-relaxed">{r.motivazione || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-400 font-mono whitespace-nowrap">
                            {r.pagina != null ? r.pagina : "—"}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap ${r.importo < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                            {r.importo < 0 ? `(${fmt(-r.importo)})` : fmt(r.importo)}
                          </td>
                        </tr>
                      ))}
                      {(() => {
                        /* Il totale considera solo le rettifiche attive: una posta
                           sospesa resta in elenco ma non incide sul prospetto. */
                        const tot = rgRettifiche
                          .filter((r) => r.attiva !== false)
                          .reduce((a, r) => a + (Number(r.importo) || 0), 0);
                        return (
                          <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                            <td colSpan={4} className="px-4 py-2.5 font-extrabold text-indigo-900">
                              TOTALE SPECIAL ITEMS RG (effetto sul risultato corrente)
                            </td>
                            <td className={`px-4 py-2.5 text-right font-mono font-extrabold whitespace-nowrap ${tot < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              {tot < 0 ? `(${fmt(-tot)})` : fmt(tot)}
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                )}
                {rgRettifiche.length > 0 && (
                  <div className="px-5 py-3 border-t border-indigo-200 bg-indigo-50/50 text-[11px] text-slate-500 leading-relaxed">
                    Convenzione di segno: importo <b>negativo</b> = onere non ricorrente (deprimeva il
                    risultato), <b>positivo</b> = provento non ricorrente (lo gonfiava). Lo storno riporta la
                    componente alla gestione non corrente, lasciando invariato l'utile netto contabile ma
                    normalizzando i margini caratteristici del CE a valore aggiunto.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2 · NOTA INTEGRATIVA (4 SEZIONI) ================= */}
        {tab === 2 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">📎 Nota Integrativa filtrata in 4 sezioni tematiche</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                L'IA legge la Nota Integrativa e ne estrae SOLO le informazioni utili all'analisi del CE,
                organizzate in quattro sezioni tematiche: <b>1) Ricavi e valore della produzione</b>,{" "}
                <b>2) Costi della produzione e personale</b>, <b>3) Gestione finanziaria, rettifiche e
                componenti non ricorrenti</b>, <b>4) Imposte, risultato e altre informazioni rilevanti</b>.
                Ogni estratto porta con sé il numero di pagina, così torni al documento originale in un
                click. Se lo schema CE è «costo del venduto», la sezione 2 è particolarmente critica perché
                contiene la disclosure per natura obbligatoria ex IAS 1.104, senza cui non si calcolano
                Valore Aggiunto ed EBITDA.
              </p>
            </div>

            {niFonte && (
              <p className="text-sm text-teal-700 mb-4">Nota Integrativa caricata da {niFonte}.</p>
            )}

            {niEstratti.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Nessuna Nota Integrativa caricata. Usa il pulsante <b>«📎 Carica Nota Integrativa (IA)»</b>{" "}
                in cima alla pagina per attivare l'estrazione tematica.
              </div>
            )}

            {niEstratti.length > 0 && (
              <div className="space-y-6">
                {[1, 2, 3, 4].map((s) => {
                  const items = niEstratti.filter((i) => i.sezione === s);
                  const sez = NI_SEZIONI_CE[s];
                  return (
                    <div key={s} className={`border rounded-xl overflow-hidden ${sez.color}`}>
                      <div className="px-5 py-3 flex items-center gap-3 border-b border-current/10">
                        <span className={`${sez.badge} text-white text-xs font-extrabold rounded-full w-7 h-7 flex items-center justify-center`}>
                          {s}
                        </span>
                        <p className="font-bold text-sm flex-1">{sez.titolo}</p>
                        <span className="text-xs font-mono opacity-70">
                          {items.length} estratt{items.length === 1 ? "o" : "i"}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <p className="px-5 py-4 text-xs italic opacity-70">
                          Nessun elemento pertinente estratto per questa sezione.
                        </p>
                      ) : (
                        <div className="divide-y divide-current/10 bg-white">
                          {items.map((it, i) => (
                            <div key={i} className="px-5 py-4">
                              <div className="flex justify-between items-baseline gap-3 mb-1">
                                <p className="font-bold text-sm text-slate-900">{it.tema}</p>
                                {it.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                                    · pagina {it.pagina}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-700 leading-relaxed">{it.contenuto}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 9 · DATI & VALIDAZIONE T-1 ================= */}
        {/* NB: id interno 10 — gemello del Tab 1, alimentato da vociPrec. */}
        {tab === 10 && (
          <>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">🕘 Validazione dell'esercizio precedente (T-1)</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Qui validi le voci dell'<b>esercizio precedente</b> ({esercizioPrec}), estratte dalla
                colonna comparativa del bilancio oppure da un documento dedicato. La struttura è identica
                al tab «1 · Dati &amp; Validazione»: correggi nomi, importi, classi gestionali e ASA. Le
                classi alimentano <b>calcPrec</b>, che genera il prospetto T-1 e i Δ economici. Le ASA
                restano quelle dell'anno corrente, così il raffronto per segmento è omogeneo.
              </p>
            </div>

            {/* ---- CARICAMENTO DEDICATO T-1 (sovrascrittura manuale, opzionale) ----
                 Gli stessi comandi della barra in testa alla pagina, replicati qui
                 dove l'utente sta effettivamente lavorando sull'esercizio
                 comparativo: Conto Economico, Nota Integrativa e Relazione sulla
                 Gestione dell'anno T-1 da documenti separati. Condividono refs,
                 handler e stati con la barra superiore (estraiConIA/caricaNI/
                 caricaRG con isPrec = true): nessuna logica duplicata. ---- */}
            <div className="border border-slate-200 rounded-xl px-5 py-4 mb-6 bg-slate-50">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                  📥 Caricamento documenti dell'esercizio precedente (T-1)
                </p>
                <span className="text-xs text-slate-400">
                  esercizio{" "}
                  <input
                    value={esercizioPrec}
                    onChange={(e) => setEsercizioPrec(e.target.value)}
                    className="inline-block w-24 bg-transparent border-b border-slate-300 outline-none text-slate-600"
                    aria-label="Esercizio precedente"
                  />
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                {modalitaSingoloAnno ? (
                  <>
                    <b>Modalità Singolo Anno attiva.</b> La lettura automatica della colonna comparativa è
                    disattivata: questi slot T-1 si popolano <b>solo</b> con i documenti che carichi qui. È il
                    percorso per analizzare a mano una <b>serie di esercizi</b>, un bilancio autonomo per volta.
                    Indica nel riquadro «Modalità Singolo Anno», in testa alla pagina, l'
                    <b>anno dei documenti T-1</b>: l'IA leggerà la <b>colonna principale</b> di quel documento
                    (non la sua comparativa), evitando di scivolare di un ulteriore esercizio all'indietro.
                  </>
                ) : (
                  <>
                    I dati del {esercizioPrec} vengono ricavati <b>automaticamente dalla colonna comparativa</b> dei
                    documenti caricati per l'anno corrente: una fase aggiuntiva della lettura estrae
                    <b> esclusivamente i valori dell'esercizio {esercizioPrec}</b>, senza bisogno di un secondo
                    upload. Usa i pulsanti qui sotto solo per <b>sovrascrivere</b> quei dati con documenti separati
                    (un bilancio a sé dell'anno precedente). Anche in questo caso il prompt IA filtra il documento
                    cercando i dati riferiti all'esercizio {esercizioPrec}.
                  </>
                )}
              </p>

              {modalitaSingoloAnno && (
                <div className="flex items-center gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  <span className="text-xs font-semibold">Anno dei documenti T-1:</span>
                  <input
                    type="text"
                    value={annoSpecificoPrec}
                    onChange={(e) => setAnnoSpecificoPrec(e.target.value)}
                    placeholder="es. 2022"
                    inputMode="numeric"
                    className="w-24 bg-white border border-amber-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Anno dei documenti caricati negli slot T-1"
                  />
                  {!String(annoSpecificoPrec).trim() && (
                    <span className="text-xs text-amber-700">
                      se lasciato vuoto l'IA legge comunque l'esercizio principale del documento caricato
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => fileIAPrec.current?.click()}
                      disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoPrec || caricamentoMaster}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      {caricamentoPrec ? "⏳ Estrazione CE T-1…" : "📄 Carica Conto Economico T-1 (IA)"}
                    </button>
                    <button
                      onClick={() => fileNIPrec.current?.click()}
                      disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoPrec || caricamentoMaster}
                      title={!vociPrec.length ? "Consigliato: estrai prima il Conto Economico dell'esercizio precedente" : ""}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      {caricamentoNI ? "⏳ Lettura NI T-1…" : "📑 Carica Nota Integrativa T-1 (IA)"}
                    </button>
                    <button
                      onClick={() => fileRGPrec.current?.click()}
                      disabled={caricamento || caricamentoNI || caricamentoRG || caricamentoPrec || caricamentoMaster}
                      title={!vociPrec.length ? "Consigliato: estrai prima il Conto Economico dell'esercizio precedente" : ""}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      {caricamentoRG ? "⏳ Lettura RG T-1…" : "📎 Carica Relazione sulla Gestione T-1 (IA)"}
                    </button>
                  </div>

                  <div className="mt-3 space-y-1 text-sm">
                    {fontePrec && <p className="text-teal-700">Conto Economico T-1: {fontePrec}.</p>}
                    {niFontePrec && <p className="text-teal-700">Nota Integrativa T-1: {niFontePrec}.</p>}
                    {rgFontePrec && <p className="text-teal-700">Relazione sulla Gestione T-1: {rgFontePrec}.</p>}
                    {statoIAPrec && (
                      <p className={statoIAPrec.tipo === "errore" ? "text-rose-600" : "text-slate-500"}>
                        {caricamentoPrec && <span className="inline-block animate-pulse mr-1">●</span>}
                        {statoIAPrec.msg}
                      </p>
                    )}
                    {!niFontePrec && !rgFontePrec && (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Nota Integrativa e Relazione sulla Gestione del {esercizioPrec} alimentano rettifiche di
                        normalizzazione, riallocazioni per natura e red flag dell'anno comparativo, riepilogati in
                        fondo a questa sezione.
                      </p>
                    )}
                  </div>
            </div>

            {vociPrec.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Nessuna voce T-1 presente. Carica il Conto Economico dell'anno corrente (la colonna
                comparativa viene letta in automatico) oppure usa{" "}
                <b>«📄 Carica Conto Economico T-1 (IA)»</b> qui sopra se l'esercizio precedente è su un file
                separato.
              </div>
            )}

            {vociPrec.length > 0 &&
              [["Ricavi e proventi — esercizio precedente", vociRicaviPrec, totRicaviPrec, "ricavi"],
                ["Costi, oneri e imposte — esercizio precedente", vociCostiPrec, totCostiPrec, "costi"]].map(
                ([titolo, lista, totale, sezione]) => (
                  <div key={sezione} className="border border-slate-200 rounded-xl p-5 mb-6">
                    <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">
                      {titolo} ({lista.length})
                    </p>
                    <div className="space-y-4">
                      {lista.map((v) => (
                        <div key={v.id} className="space-y-1.5">
                          <div className="flex gap-2 items-center">
                            <input
                              value={v.nome}
                              onChange={(e) => aggiornaPrec(v.id, { nome: e.target.value })}
                              placeholder="Nome voce"
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <input
                              type="number"
                              value={v.importo}
                              onChange={(e) => aggiornaPrec(v.id, { importo: e.target.value === "" ? 0 : Number(e.target.value) })}
                              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm text-right"
                              aria-label="Importo T-1"
                            />
                            <button onClick={() => eliminaPrec(v.id)} className="text-rose-500 font-bold px-1" aria-label="Elimina voce T-1">×</button>
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={v.classe}
                              onChange={(e) => aggiornaPrec(v.id, { classe: e.target.value, asa: CLASSI[e.target.value]?.asa ? v.asa : null })}
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-600 bg-white"
                              aria-label="Classe gestionale T-1"
                            >
                              {Object.entries(CLASSI).map(([id, c]) => (
                                <option key={id} value={id}>{c.label}</option>
                              ))}
                            </select>
                            {CLASSI[v.classe]?.asa && (asaList.length > 0 || v.asa) && (
                              <select
                                value={v.asa || ""}
                                onChange={(e) => aggiornaPrec(v.id, { asa: e.target.value || null })}
                                className="w-56 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-600 bg-white"
                                aria-label="Area Strategica d'Affari T-1"
                              >
                                <option value="">ASA: comune / corporate</option>
                                {asaList.map((a) => (
                                  <option key={a} value={a}>ASA: {a}</option>
                                ))}
                                {v.asa && !asaList.includes(v.asa) && (
                                  <option value={v.asa}>ASA: {v.asa} (non in elenco)</option>
                                )}
                              </select>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-5">
                      <button
                        onClick={() => aggiungiPrec(sezione)}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
                      >
                        + Aggiungi voce T-1
                      </button>
                      <p className="font-mono font-bold text-sm">Totale: {fmt(totale)}</p>
                    </div>
                  </div>
                )
              )}

            {vociPrec.length > 0 && (
              <div className="border border-slate-200 rounded-xl p-5">
                <p className="text-sm">
                  <b>Validazione T-1:</b>{" "}
                  <span className={validatoPrec ? "text-teal-700" : "text-amber-600"}>
                    {calcPrec.daClassificare
                      ? `${calcPrec.daClassificare} voci ancora da classificare.`
                      : "tutte le voci T-1 classificate; prospetto precedente e Δ economici aggiornati."}
                  </span>
                </p>
                <button
                  onClick={() => setTab(11)}
                  className="mt-4 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
                >
                  ✓ Vai al CE a valore aggiunto T-1 →
                </button>
              </div>
            )}

            {/* ---- NOTA INTEGRATIVA E RELAZIONE SULLA GESTIONE — T-1 ----
                 Gli esiti documentali dell'esercizio comparativo vivevano finora
                 solo dentro il piano voci, senza un punto in cui leggerli e
                 governarli. Qui sono raccolti in coda alla sezione: estratti
                 tematici, rettifiche di normalizzazione, riallocazioni per
                 natura e red flag, ciascuna posta attivabile o sospendibile
                 senza cancellarla. ---- */}
            {(niEstrattiPrec.length > 0 ||
              niRettifichePrec.length > 0 ||
              niRiallocazioniPrec.length > 0 ||
              niRedFlagsPrec.length > 0 ||
              rgEstrattiPrec.length > 0 ||
              rgRettifichePrec.length > 0 ||
              rgRedFlagsPrec.length > 0) && (
              <div className="border border-indigo-200 rounded-xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-indigo-200 bg-indigo-50">
                  <p className="text-xs font-bold tracking-widest text-indigo-700 uppercase mb-1">
                    Documenti dell'esercizio precedente {esercizioPrec ? `— ${esercizioPrec}` : ""}
                  </p>
                  <p className="text-xs text-indigo-900/70 leading-relaxed max-w-3xl">
                    Nota Integrativa e Relazione sulla Gestione T-1. Ogni rettifica e ogni riallocazione può
                    essere <b>sospesa</b> con l'interruttore: la posta resta in elenco con la sua motivazione e
                    il riferimento di pagina, ma smette di generare voci nel prospetto T-1, così puoi misurare
                    subito quanto pesa sui margini comparativi senza perdere il lavoro di estrazione.
                  </p>
                </div>

                <div className="p-5 space-y-6">
                  {/* --- Rettifiche di normalizzazione NI T-1 --- */}
                  {niRettifichePrec.length > 0 && (
                    <div>
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
                        Rettifiche Nota Integrativa T-1 ({niRettifichePrec.filter((r) => r.attiva !== false).length}/
                        {niRettifichePrec.length} attive)
                      </p>
                      <div className="space-y-3">
                        {niRettifichePrec.map((r, i) => (
                          <div key={i} className={`flex items-start gap-3 text-sm ${r.attiva === false ? "opacity-45" : ""}`}>
                            <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRettificaNIPrec(i)} />
                            <span
                              className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
                                r.tipo === "extra_gestione"
                                  ? "bg-rose-100 text-rose-700 border-rose-200"
                                  : "bg-indigo-100 text-indigo-700 border-indigo-200"
                              }`}
                            >
                              {r.tipo === "extra_gestione" ? "Extra-gestione" : "Special item"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-800">
                                {r.descrizione}
                                {r.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono"> · pagina {r.pagina}</span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500">
                                {r.importo >= 0 ? "Provento" : "Onere"} stornato da{" "}
                                {r.classeOrigine
                                  ? CLASSI[r.classeOrigine]?.label.split("— ")[1] || r.classeOrigine
                                  : "voce ordinaria"}
                                {r.motivazione && ` — ${r.motivazione}`}
                              </p>
                            </div>
                            <span className="font-mono font-bold whitespace-nowrap">
                              {r.importo < 0 ? `(${fmt(-r.importo)})` : fmt(r.importo)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* --- Riallocazioni per natura NI T-1 --- */}
                  {niRiallocazioniPrec.length > 0 && (
                    <div>
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
                        Riallocazioni per natura T-1 — IAS 1.104 (
                        {niRiallocazioniPrec.filter((r) => r.attiva !== false).length}/{niRiallocazioniPrec.length} attive)
                      </p>
                      <div className="space-y-3">
                        {niRiallocazioniPrec.map((r, i) => (
                          <div key={i} className={`flex items-start gap-3 text-sm ${r.attiva === false ? "opacity-45" : ""}`}>
                            <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRiallocazioneNIPrec(i)} />
                            <div className="shrink-0 flex items-center gap-1">
                              <select
                                value={r.classeOrigine || ""}
                                onChange={(e) => modificaRiallocazioneNIPrec(i, "classeOrigine", e.target.value)}
                                className="text-xs font-semibold text-teal-800 bg-white border border-teal-200 rounded px-1.5 py-1 max-w-[10.5rem]"
                                title={CLASSI[r.classeOrigine]?.label || "Classe di origine T-1"}
                                aria-label="Classe di origine della riallocazione T-1"
                              >
                                <option value="">— origine —</option>
                                {Object.keys(CLASSI).map((id) => (
                                  <option key={id} value={id}>{id}</option>
                                ))}
                              </select>
                              <span className="text-teal-700 font-bold">→</span>
                              <select
                                value={r.classeDestinazione || ""}
                                onChange={(e) => modificaRiallocazioneNIPrec(i, "classeDestinazione", e.target.value)}
                                className="text-xs font-semibold text-teal-800 bg-white border border-teal-200 rounded px-1.5 py-1 max-w-[10.5rem]"
                                title={CLASSI[r.classeDestinazione]?.label || "Classe di destinazione T-1"}
                                aria-label="Classe di destinazione della riallocazione T-1"
                              >
                                <option value="">— destinazione —</option>
                                {Object.keys(CLASSI).map((id) => (
                                  <option key={id} value={id}>{id}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-800">
                                {r.descrizione}
                                {r.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono"> · pagina {r.pagina}</span>
                                )}
                              </p>
                              {r.motivazione && <p className="text-xs text-slate-500">{r.motivazione}</p>}
                            </div>
                            <span className="font-mono font-bold whitespace-nowrap">{fmt(r.importo)}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
                        Sospendendo una riallocazione il costo torna nella macro-voce funzionale di origine:
                        Valore Aggiunto ed EBITDA T-1 cambiano di conseguenza, mentre l'utile netto resta
                        invariato.
                      </p>
                    </div>
                  )}

                  {/* --- Rettifiche RG T-1 --- */}
                  {rgRettifichePrec.length > 0 && (
                    <div>
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
                        Special items Relazione sulla Gestione T-1 (
                        {rgRettifichePrec.filter((r) => r.attiva !== false).length}/{rgRettifichePrec.length} attive)
                      </p>
                      <div className="space-y-3">
                        {rgRettifichePrec.map((r, i) => (
                          <div key={i} className={`flex items-start gap-3 text-sm ${r.attiva === false ? "opacity-45" : ""}`}>
                            <InterruttoreAttiva attiva={r.attiva !== false} onToggle={() => toggleRettificaRGPrec(i)} />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-800">
                                {r.descrizione}
                                {r.pagina != null && (
                                  <span className="text-xs text-slate-400 font-mono"> · pagina {r.pagina}</span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500">
                                {r.classeOrigine
                                  ? CLASSI[r.classeOrigine]?.label.split("— ")[1] || r.classeOrigine
                                  : "voce ordinaria"}
                                {r.motivazione && ` — ${r.motivazione}`}
                              </p>
                            </div>
                            <span
                              className={`font-mono font-bold whitespace-nowrap ${
                                r.importo < 0 ? "text-rose-700" : "text-emerald-700"
                              }`}
                            >
                              {r.importo < 0 ? `(${fmt(-r.importo)})` : fmt(r.importo)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* --- Estratti tematici NI e RG T-1 --- */}
                  {(niEstrattiPrec.length > 0 || rgEstrattiPrec.length > 0) && (
                    <div>
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
                        Estratti tematici T-1 ({niEstrattiPrec.length} da NI · {rgEstrattiPrec.length} da RG)
                      </p>
                      <div className="grid md:grid-cols-2 gap-3">
                        {[
                          ...niEstrattiPrec.map((e) => ({ ...e, fonte: "NI" })),
                          ...rgEstrattiPrec.map((e) => ({ ...e, fonte: "RG" })),
                        ].map((e, i) => {
                          const sez = NI_SEZIONI_CE[e.sezione];
                          return (
                            <div key={i} className={`border rounded-lg p-3 ${sez?.color || "bg-slate-50 border-slate-200"}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[9px] font-bold uppercase tracking-wider text-white px-1.5 py-0.5 rounded ${sez?.badge || "bg-slate-500"}`}>
                                  {e.fonte}
                                </span>
                                <p className="text-xs font-bold flex-1 truncate">{e.tema}</p>
                                {e.pagina != null && <span className="text-[10px] font-mono opacity-60">p. {e.pagina}</span>}
                              </div>
                              <p className="text-xs leading-relaxed opacity-90">{e.contenuto}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* --- Red flag T-1 --- */}
                  {(niRedFlagsPrec.length > 0 || rgRedFlagsPrec.length > 0) && (
                    <div>
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
                        Red flag T-1 ({niRedFlagsPrec.length + rgRedFlagsPrec.length})
                      </p>
                      <div className="space-y-2">
                        {[
                          ...niRedFlagsPrec.map((f) => ({ ...f, fonte: "NI" })),
                          ...rgRedFlagsPrec.map((f) => ({ ...f, fonte: "RG" })),
                        ].map((f, i) => (
                          <div key={i} className="flex items-start gap-3 text-sm border border-amber-200 bg-amber-50 rounded-lg p-3">
                            <span
                              className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
                                f.gravita === "alta"
                                  ? "bg-red-200 text-red-800"
                                  : f.gravita === "bassa"
                                  ? "bg-slate-200 text-slate-700"
                                  : "bg-amber-200 text-amber-800"
                              }`}
                            >
                              {f.fonte} · {f.gravita}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">{f.flag}</p>
                              <p className="text-xs text-amber-900/80 leading-relaxed">
                                {f.evidenza}
                                {f.pagina != null && <span className="font-mono opacity-60"> · p. {f.pagina}</span>}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= TAB 10 · CE A VALORE AGGIUNTO T-1 ================= */}
        {/* NB: id interno 11 — stesso prospetto del Tab 4, alimentato da calcPrec. */}
        {tab === 11 && (
          <>
            <div className="border border-slate-200 rounded-xl p-4 mb-4 text-sm text-slate-600 leading-relaxed bg-slate-50">
              Prospetto dell'<b>esercizio precedente ({esercizioPrec})</b>, costruito con le stesse formule
              dell'anno corrente a partire da <b>calcPrec</b>. Le rettifiche di normalizzazione estratte
              dalla Nota Integrativa e dalla Relazione sulla Gestione T-1 sono già stornate, quindi Valore
              Aggiunto, EBITDA ed EBIT qui esposti sono direttamente confrontabili con quelli del tab
              «4 · CE a valore aggiunto».
            </div>
            <Prospetto
              titolo={`Conto economico riclassificato a valore aggiunto — esercizio precedente ${esercizioPrec}`}
              base={calcPrec.ricavi}
              vuoto={!vociPrec.length}
              righe={[
                { l: "GESTIONE CORRENTE — Area caratteristica", tipo: "area" },
                { l: "Ricavi delle vendite e delle prestazioni", v: calcPrec.ricavi },
                { l: "Variazione rimanenze prodotti e semilavorati", v: calcPrec.varRimPF },
                { l: "Incrementi di immobilizzazioni per lavori interni", v: calcPrec.lavoriInterni },
                { l: "Altri ricavi e proventi operativi", v: calcPrec.altriRicavi },
                { l: "Valore della produzione", v: calcPrec.valoreProduzione, tipo: "sub" },
                { l: "Consumi di materie (acquisti − Δ rimanenze materie)", v: -calcPrec.consumi },
                { l: "Costi per servizi", v: -calcPrec.servizi },
                { l: "Godimento beni di terzi", v: -calcPrec.godimento },
                { l: "Oneri diversi di gestione", v: -calcPrec.oneriDiversi },
                { l: "VALORE AGGIUNTO", v: calcPrec.valoreAggiunto, tipo: "margine" },
                { l: "Costo del personale", v: -calcPrec.personale },
                { l: "EBITDA — Margine operativo lordo", v: calcPrec.ebitda, tipo: "margine" },
                { l: "Ammortamenti e svalutazioni", v: -calcPrec.ammortamenti },
                { l: "Accantonamenti", v: -calcPrec.accantonamenti },
                { l: "REDDITO OPERATIVO DELLA GESTIONE CARATTERISTICA", v: calcPrec.redditoOperativoCaratteristica, tipo: "margine" },
                { l: "GESTIONE CORRENTE — Area accessoria", tipo: "area" },
                { l: "Proventi accessori", v: calcPrec.proventiAccessori },
                { l: "Oneri accessori", v: -calcPrec.oneriAccessori },
                { l: "EBIT — Reddito operativo (caratteristica + accessoria)", v: calcPrec.ebit, tipo: "margine" },
                { l: "GESTIONE CORRENTE — Area finanziaria", tipo: "area" },
                { l: "Proventi finanziari", v: calcPrec.proventiFin },
                { l: "Oneri finanziari", v: -calcPrec.oneriFin },
                { l: "RISULTATO DELLA GESTIONE CORRENTE", v: calcPrec.risultatoCorrente, tipo: "margine" },
                { l: "GESTIONE NON CORRENTE", tipo: "area" },
                { l: "Componenti straordinarie e non ricorrenti (+/-)", v: calcPrec.gestioneNonCorrente },
                { l: "AREA EXTRA-GESTIONE", tipo: "area" },
                { l: "Poste da contabilità creativa stornate (+/-)", v: calcPrec.extraGestione },
                { l: "Risultato ante imposte", v: calcPrec.risultatoAnteImposte, tipo: "sub" },
                { l: "Imposte sul reddito (contabili, iscritte in bilancio)", v: -calcPrec.imposte },
                { l: "UTILE NETTO CONTABILE", v: calcPrec.utileNetto, tipo: "margine" },
                { l: `GESTIONE TRIBUTARIA NORMALIZZATA — Fiscometria (aliquota ordinaria ${aliquota}%)`, tipo: "area" },
                { l: "Risultato della gestione corrente normalizzato (Earnings Power ante imposte)", v: calcPrec.risultatoCorrente, tipo: "sub" },
                { l: `Imposte teoriche (${aliquota}% sul solo reddito corrente normalizzato)`, v: -imposteTeorichePrec },
                { l: "EARNINGS POWER — Utile netto normalizzato della gestione corrente", v: earningsPowerPrec, tipo: "margine" },
                { l: "Gestione non corrente al netto dell'effetto fiscale", v: nonCorrenteNettoPrec },
                { l: "Area extra-gestione al netto dell'effetto fiscale", v: extraNettoPrec },
                { l: "UTILE NETTO NORMALIZZATO COMPLESSIVO", v: utileNettoNormalizzatoPrec, tipo: "margine" },
                { l: "Δ Effetto fiscale anomalo (utile contabile − utile normalizzato)", v: effettoFiscaleAnomaloPrec },
              ]}
            />
          </>
        )}

        {/* ================= TAB 11 · VARIAZIONI E TREND (Δ ECONOMICI) ================= */}
        {/* NB: id interno 12. */}
        {tab === 12 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">
                📈 Variazioni e Trend — Δ economici {esercizioPrec} → {esercizio}
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Raffronto fra i margini dell'esercizio corrente e quelli del precedente. La variazione
                percentuale è calcolata sul <b>valore assoluto</b> della base T-1, così il segno resta
                leggibile anche quando si parte da un risultato negativo: una perdita che si riduce
                produce un Δ positivo. Le barre confrontano l'intensità relativa delle variazioni.
              </p>
            </div>

            {!deltaEconomici.disponibile && (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500 mb-6">
                Servono entrambi gli esercizi: valida le voci nel tab «1 · Dati &amp; Validazione» e quelle
                del tab «9 · Dati &amp; Validazione T-1». Caricando il CE dell'anno corrente la colonna
                comparativa viene letta in automatico.
              </div>
            )}

            {deltaEconomici.disponibile && (() => {
              const maxPerc = Math.max(
                1,
                ...deltaEconomici.elenco.map((d) => (d.percentuale == null ? 0 : Math.abs(d.percentuale)))
              );
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    {[
                      ["Crescita Ricavi", deltaEconomici.ricavi],
                      ["Δ Valore aggiunto", deltaEconomici.valoreAggiunto],
                      ["Δ EBITDA", deltaEconomici.ebitda],
                      ["Δ Utile netto", deltaEconomici.utileNetto],
                    ].map(([lbl, d]) => {
                      const pos = d.assoluto > 1e-9;
                      const neg = d.assoluto < -1e-9;
                      return (
                        <div
                          key={lbl}
                          className={`border rounded-xl p-4 ${pos ? "border-emerald-200 bg-emerald-50" : neg ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}
                        >
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{lbl}</p>
                          <p className={`text-xl font-extrabold font-mono ${pos ? "text-emerald-700" : neg ? "text-rose-700" : "text-slate-700"}`}>
                            {d.percentuale == null ? "n/d" : `${d.percentuale > 0 ? "+" : ""}${d.percentuale.toFixed(1).replace(".", ",")}%`}
                          </p>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">
                            {d.assoluto > 0 ? "+" : ""}{fmt(d.assoluto)}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                    <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                      <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                        A · Margini a confronto — {esercizio} vs {esercizioPrec}
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                          <th className="px-5 py-2 text-left">Margine</th>
                          <th className="px-3 py-2 text-right">{esercizioPrec}</th>
                          <th className="px-3 py-2 text-right">{esercizio}</th>
                          <th className="px-3 py-2 text-right">Δ assoluto</th>
                          <th className="px-3 py-2 text-right w-20">Δ %</th>
                          <th className="px-5 py-2 text-left w-32">Intensità</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deltaEconomici.elenco.map((d) => {
                          const pos = d.assoluto > 1e-9;
                          const neg = d.assoluto < -1e-9;
                          const larghezza = d.percentuale == null ? 0 : Math.min(100, (Math.abs(d.percentuale) / maxPerc) * 100);
                          return (
                            <tr key={d.chiave} className="border-b border-slate-100 last:border-0">
                              <td className="px-5 py-2 text-slate-700">{d.label}</td>
                              <td className="px-3 py-2 text-right font-mono text-slate-500">
                                {d.precedente < 0 ? `(${fmt(-d.precedente)})` : fmt(d.precedente)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                                {d.corrente < 0 ? `(${fmt(-d.corrente)})` : fmt(d.corrente)}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono ${pos ? "text-emerald-700" : neg ? "text-rose-700" : "text-slate-400"}`}>
                                {d.assoluto > 0 ? "+" : ""}{fmt(d.assoluto)}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono font-bold ${pos ? "text-emerald-700" : neg ? "text-rose-700" : "text-slate-400"}`}>
                                {d.percentuale == null ? "—" : `${d.percentuale > 0 ? "+" : ""}${d.percentuale.toFixed(1).replace(".", ",")}%`}
                              </td>
                              <td className="px-5 py-2">
                                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${pos ? "bg-emerald-500" : neg ? "bg-rose-500" : "bg-slate-300"}`}
                                    style={{ width: `${larghezza}%` }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

            {/* ---- B · Channel stuffing automatizzato ---- */}
            <div className={`border rounded-xl overflow-hidden ${channelStuffingAlert ? "border-rose-200" : "border-slate-200"}`}>
              <div className={`px-5 py-4 border-b ${channelStuffingAlert ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className={`text-xs font-bold tracking-widest uppercase mb-1 ${channelStuffingAlert ? "text-rose-700" : "text-slate-500"}`}>
                      B · Channel stuffing — Δ crediti vs Δ fatturato
                    </p>
                    <p className={`text-xs leading-relaxed ${channelStuffingAlert ? "text-rose-900/70" : "text-slate-500"}`}>
                      Se i crediti verso clienti crescono molto più del fatturato, i ricavi possono essere
                      stati forzati a fine esercizio (vendite spinte ai distributori, dilazioni anomale).
                      Il <b>Δ fatturato è calcolato in automatico</b> dal raffronto fra i ricavi
                      dell'esercizio corrente e quelli del T-1; i crediti, essendo poste patrimoniali,
                      provengono dalla Nota Integrativa e restano modificabili qui sotto.
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${channelStuffingAlert ? "bg-rose-100 text-rose-700 border-rose-200" : deltaCrediti != null && deltaFatturato != null ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-400 border-slate-200"}`}>
                    {channelStuffingAlert ? "Allerta" : deltaCrediti != null && deltaFatturato != null ? "Nessun segnale" : "Dati incompleti"}
                  </span>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Crediti clienti {esercizio}
                    </label>
                    <input
                      type="number"
                      value={creditiClienti.corrente}
                      onChange={(e) => setCreditiClienti((c) => ({ ...c, corrente: e.target.value }))}
                      placeholder="da Nota Integrativa"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-right font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Crediti clienti {esercizioPrec}
                    </label>
                    <input
                      type="number"
                      value={creditiClienti.precedente}
                      onChange={(e) => setCreditiClienti((c) => ({ ...c, precedente: e.target.value }))}
                      placeholder="da Nota Integrativa"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-right font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Ricavi {esercizioPrec} (automatico)
                    </label>
                    <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-right font-mono text-slate-600">
                      {vociPrec.length ? fmt(calcPrec.ricavi) : "—"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-center">
                  {[
                    ["Δ Crediti clienti", deltaCrediti],
                    ["Δ Fatturato (organico)", deltaFatturato],
                  ].map(([lbl, val]) => (
                    <div key={lbl} className="border border-slate-200 rounded-lg p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{lbl}</p>
                      <p className="text-lg font-extrabold font-mono text-slate-800">
                        {val == null ? "n/d" : `${val > 0 ? "+" : ""}${val.toFixed(1).replace(".", ",")}%`}
                      </p>
                    </div>
                  ))}
                  <div className="border border-slate-200 rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Scostamento</p>
                    <p className={`text-lg font-extrabold font-mono ${channelStuffingAlert ? "text-rose-700" : "text-slate-800"}`}>
                      {deltaCrediti == null || deltaFatturato == null
                        ? "n/d"
                        : `${deltaCrediti - deltaFatturato > 0 ? "+" : ""}${(deltaCrediti - deltaFatturato).toFixed(1).replace(".", ",")} p.p.`}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  {deltaCrediti == null || deltaFatturato == null
                    ? "Per attivare l'indicatore servono i crediti verso clienti dei due esercizi (dalla Nota Integrativa o digitati qui sopra) e le voci dell'esercizio T-1."
                    : channelStuffingAlert
                    ? "⚠ I crediti crescono in misura sensibilmente superiore al fatturato (oltre 1,5 volte, con incremento superiore al 10%): verifica le condizioni di incasso, le vendite di fine periodo e l'adeguatezza del fondo svalutazione crediti."
                    : "✓ La dinamica dei crediti è coerente con quella del fatturato: nessun segnale di vendite forzate a fine esercizio."}
                </p>
              </div>
            </div>

            {/* ---- C · Segment reporting a confronto (EBIT per ASA) ---- */}
            {deltaEconomici.disponibile && asaList.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                  <p className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-1">
                    C · Segment reporting a confronto — ricavi ed EBIT per ASA
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Il raffronto per Area Strategica d'Affari usa la stessa lista ASA nei due esercizi,
                    così la performance di ciascun segmento è confrontabile. La colonna comune/corporate
                    accoglie le voci non attribuibili a un singolo segmento.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                      <th className="px-5 py-2 text-left">ASA</th>
                      <th className="px-3 py-2 text-right">Ricavi {esercizioPrec}</th>
                      <th className="px-3 py-2 text-right">Ricavi {esercizio}</th>
                      <th className="px-3 py-2 text-right">Δ Ricavi</th>
                      <th className="px-3 py-2 text-right">EBIT {esercizioPrec}</th>
                      <th className="px-5 py-2 text-right">EBIT {esercizio}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...asaList, ASA_COMUNE].map((k) => {
                      const c = segmenti[k] || {};
                      const p = segmentiPrec[k] || {};
                      const dRic = (c.ricavi || 0) - (p.ricavi || 0);
                      return (
                        <tr key={k} className="border-b border-slate-100 last:border-0">
                          <td className="px-5 py-2 text-slate-700">{k}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500">{fmt(p.ricavi || 0)}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{fmt(c.ricavi || 0)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${dRic > 1e-9 ? "text-emerald-700" : dRic < -1e-9 ? "text-rose-700" : "text-slate-400"}`}>
                            {dRic > 0 ? "+" : ""}{fmt(dRic)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500">
                            {(p.ebit || 0) < 0 ? `(${fmt(-(p.ebit || 0))})` : fmt(p.ebit || 0)}
                          </td>
                          <td className="px-5 py-2 text-right font-mono font-bold text-slate-900">
                            {(c.ebit || 0) < 0 ? `(${fmt(-(c.ebit || 0))})` : fmt(c.ebit || 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 7 · PONTE RENDICONTO (Metodo Indiretto) ================= */}
        {/* NB: id interno 8 per non collidere con il tab 5 «window dressing» (id 7). */}
        {tab === 8 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">🌉 Ponte verso il Rendiconto Finanziario (Metodo Indiretto)</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Questa sezione non esegue nuovi calcoli: è un <b>riepilogo visivo</b> delle grandezze del
                Conto Economico che alimenteranno la costruzione del Rendiconto Finanziario con il{" "}
                <b>Metodo Indiretto</b>. Il flusso operativo parte dal risultato reddituale, ne{" "}
                <b>neutralizza le componenti non monetarie</b> (ammortamenti, accantonamenti) e le poste da
                ricondurre ad altre aree (plus/minusvalenze da alienazione → CAPEX), e viene poi{" "}
                <b>raccordato alla cassa</b> tramite le variazioni patrimoniali dello Stato Patrimoniale.
              </p>
            </div>

            {voci.length === 0 ? (
              <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
                Nessun dato: estrai o inserisci le voci nel tab «1 · Dati & Validazione» per popolare il ponte.
              </div>
            ) : (
              <div className="space-y-6">
                {/* ---- Blocco 1 · Flusso Operativo ---- */}
                <div className="border border-teal-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-teal-50 border-b border-teal-200 flex items-center gap-3">
                    <span className="bg-teal-600 text-white text-xs font-extrabold rounded-full w-7 h-7 flex items-center justify-center">1</span>
                    <p className="font-bold text-sm text-teal-900 flex-1">Flusso Operativo — punto di partenza</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">competenza → cassa</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4 p-5">
                    <div className="border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">EBITDA</p>
                      <p className="text-2xl font-extrabold font-mono mb-2">{fmt(calc.ebitda)}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Margine operativo lordo: base del flusso di cassa della gestione corrente, ancora al
                        lordo delle variazioni del capitale circolante netto operativo (CCNO).
                      </p>
                    </div>
                    <div className="border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">Imposte di competenza</p>
                      <p className="text-2xl font-extrabold font-mono mb-2">{fmt(calc.imposte)}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Valore a Conto Economico (competenza). In sede di Rendiconto andrà{" "}
                        <b>rettificato con la variazione patrimoniale dei debiti tributari</b> (Δ debiti per
                        imposte dello SP), per passare dall'imposta di competenza a quella effettivamente
                        versata (cassa).
                      </p>
                    </div>
                  </div>
                </div>

                {/* ---- Blocco 2 · Non-Cash e CAPEX ---- */}
                <div className="border border-amber-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
                    <span className="bg-amber-600 text-white text-xs font-extrabold rounded-full w-7 h-7 flex items-center justify-center">2</span>
                    <p className="font-bold text-sm text-amber-900 flex-1">Non-Cash e CAPEX — rettifiche non monetarie</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">da ri-sommare / neutralizzare</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4 p-5">
                    <div className="border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">Ammortamenti</p>
                      <p className="text-2xl font-extrabold font-mono mb-2">{fmt(calc.ammortamenti)}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Costo non monetario: nel Metodo Indiretto va <b>ri-sommato</b> al risultato operativo
                        (non comporta uscita di cassa).
                      </p>
                    </div>
                    <div className="border border-slate-200 rounded-xl p-5">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">Accantonamenti</p>
                      <p className="text-2xl font-extrabold font-mono mb-2">{fmt(calc.accantonamenti)}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Costo non monetario: <b>ri-sommato</b> al risultato; l'uscita di cassa emergerà solo
                        al futuro utilizzo del fondo (variazione patrimoniale dei fondi).
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const capex = niRettifiche.filter((r) => r.tipo === "capex_item");
                    return (
                      <div className="px-5 pb-5">
                        <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4 text-xs text-amber-900 leading-relaxed">
                          <b>Plus/minusvalenze da alienazione (tag «capex_item»).</b> Vanno neutralizzate qui e
                          ricondotte al <b>flusso degli investimenti (CAPEX)</b>, non alla gestione operativa.
                          {capex.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {capex.map((r, i) => (
                                <li key={i} className="flex justify-between gap-3 font-mono">
                                  <span className="font-sans">{r.descrizione}</span>
                                  <span className={r.importo < 0 ? "text-rose-700" : "text-emerald-700"}>
                                    {r.importo < 0 ? `(${fmt(-r.importo)})` : fmt(r.importo)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span> Nessuna posta «capex_item» individuata nella Nota Integrativa finora.</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* ---- Blocco 3 · Servizio del Debito ---- */}
                <div className="border border-indigo-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3">
                    <span className="bg-indigo-600 text-white text-xs font-extrabold rounded-full w-7 h-7 flex items-center justify-center">3</span>
                    <p className="font-bold text-sm text-indigo-900 flex-1">Servizio del Debito</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">flusso finanziario</span>
                  </div>
                  <div className="p-5">
                    <div className="border border-slate-200 rounded-xl p-5 sm:max-w-sm">
                      <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">Oneri finanziari</p>
                      <p className="text-2xl font-extrabold font-mono mb-2">{fmt(calc.oneriFin)}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Interessi passivi e altri oneri: rappresentano il <b>servizio del debito</b>. Nel
                        Rendiconto sono tipicamente esposti separatamente o riclassificati nel flusso
                        finanziario, distinti dal flusso operativo puro.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 text-[11px] text-slate-500 leading-relaxed">
                  Riepilogo dei dati che verranno esportati verso il modulo Rendiconto. Nessun valore è
                  calcolato o modificato in questa sezione: EBITDA, imposte, ammortamenti, accantonamenti e
                  oneri finanziari sono letti direttamente da <code className="font-mono">calcolaCE(voci)</code>.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 13 · AUDIT DEL REVISORE (UNIFICATO) ================= */}
        {tab === 13 && (
          <div>
            <div className="border border-slate-200 rounded-xl p-5 mb-6 bg-slate-50">
              <p className="font-bold text-sm mb-1">🔍 Audit del Revisore — checklist unificata in otto controlli</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Un solo elenco di anomalie, alimentato da due fonti. I <b>controlli automatici</b> sono
                deterministici, si aggiornano a ogni modifica e non consumano token: sui fatti aritmetici —
                segni delle rettifiche, quadratura delle riallocazioni IAS 1.104, voci orfane, disallineamenti
                fra gli esercizi — restano la fonte più affidabile. La <b>revisione IA</b> si aggiunge su
                richiesta per i casi di giudizio: inquinamento da Rendiconto Finanziario e OCI, duplicazioni,
                natura contro funzione, voci con nomi diversi ma natura identica. Quando entrambe le fonti
                colpiscono la stessa voce sullo stesso controllo la segnalazione è <b>una sola</b>, marcata come
                confermata. Dove possibile ogni anomalia porta con sé la <b>correzione applicabile con un
                clic</b>; quando la diagnosi viene dall'IA porta anche la <b>regola da insegnare al sistema</b>,
                che viene appesa ai prompt e salvata nel browser.
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
                title="Svuota il localStorage e ripristina i prompt di sistema originali (le tre regole inviolabili di fabbrica restano attive)"
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
                  : "Nessuna regola appresa: attive solo le 3 regole inviolabili di fabbrica"}
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
                      "Il Conto Economico è coerente tra gli anni, le rettifiche e le riallocazioni quadrano matematicamente e le variazioni sono fluide. Nessuna correzione manuale richiesta."}
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
                          {an.importo != null && <span className="text-sm font-mono">{fmt(an.importo)}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                            {an.anno}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{an.sezione}</span>
                          {an.classeAttuale && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-300 text-slate-700">
                              {an.classeAttuale}
                              {an.asaAttuale ? ` · ${an.asaAttuale}` : ""}
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
                                  : an.autoFix.tipo === "cambiaAsa"
                                  ? `ASA · ${an.autoFix.nuovaAsa}`
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
                  aggregati, delta economici e controlli automatici vengono ricalcolati all'istante — i rilievi
                  deterministici rientrati spariscono da soli dall'elenco. I rilievi prodotti dall'IA, invece,
                  restano com'erano finché non rilanci la revisione. Le regole insegnate agiscono sulle{" "}
                  <i>prossime</i> estrazioni, non retroattivamente sui dati già in memoria.
                </p>
              </div>
            )}

            {/* ---- Quadratura riallocazioni ---- */}
            <div className="border border-slate-200 rounded-xl p-5 mb-6">
              <p className="font-bold text-sm mb-3">Controllo 5 · Quadratura delle riallocazioni (IAS 1.104)</p>
              {[
                [esercizio, auditLocale.quadraturaT],
                [esercizioPrec, auditLocale.quadraturaT1],
              ].map(([anno, q]) => (
                <p key={anno} className="text-sm text-slate-600 mb-1">
                  <b>{anno}</b>:{" "}
                  {q.presenti === 0 ? (
                    <span className="text-slate-500">
                      nessuna riallocazione presente — controllo non applicabile (diverso da «quadratura riuscita»).
                    </span>
                  ) : (
                    <>
                      {q.presenti} riallocazion{q.presenti === 1 ? "e" : "i"} · storni{" "}
                      <span className="font-mono">{fmt(-q.storni)}</span> · destinazioni{" "}
                      <span className="font-mono">{fmt(q.destinazioni)}</span> ·{" "}
                      <span className="text-emerald-700 font-semibold">saldo netto nullo ✓</span>
                    </>
                  )}
                </p>
              ))}
              <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
                La partita doppia è garantita per costruzione: l'applicazione genera lo storno negativo e la
                destinazione positiva dallo stesso importo, quindi l'utile netto non cambia mai. I rilievi
                dell'elenco qui sopra riguardano perciò gli errori che la quadratura da sola non intercetta —
                importi negativi o nulli, origine uguale a destinazione, destinazioni non «per natura», storni
                superiori al saldo della classe di origine.
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
                    di estrazione (CE, analisi del bilancio completo, colonna comparativa T-1). Sono salvate nel
                    localStorage del browser con la chiave <code>{CE_PROMPTS_KEY}</code>: il pulsante «Reset Regole
                    IA» le rimuove tutte, mentre le tre regole inviolabili di fabbrica restano sempre attive.
                  </p>
                </div>
              </div>
            )}

            <p className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 leading-relaxed">
              L'audit è un secondo parere, non una certificazione: i rilievi vanno valutati prima di modificare le
              classificazioni. In caso di contrasto fra le due fonti prevale il controllo automatico sui fatti
              aritmetici — segni, quadrature, voci orfane, disallineamenti fra gli anni — mentre sul merito
              contabile, se una posta sia davvero non ricorrente o se due voci abbiano la stessa natura, il
              giudizio resta tuo.
            </p>
          </div>
        )}
      </div>
      </div>
    </ErrorBoundary>
  );
}

/* ---------- Prospetto riclassificato ---------- */

function Prospetto({ titolo, righe, base, vuoto }) {
  if (vuoto)
    return (
      <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
        Nessun dato: carica o inserisci le voci nel tab «Dati & Validazione».
      </div>
    );
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-baseline flex-wrap gap-2">
        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">{titolo}</p>
        <p className="text-xs text-slate-400">EUR · migliaia · % sui ricavi</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {righe.map((r, i) => {
            if (r.tipo === "area")
              return (
                <tr key={i} className="bg-slate-100">
                  <td colSpan={3} className="px-5 py-1.5 text-[11px] font-bold tracking-widest text-slate-500 uppercase">
                    {r.l}
                  </td>
                </tr>
              );
            const margine = r.tipo === "margine";
            const sub = r.tipo === "sub";
            return (
              <tr key={i} className={margine ? "bg-teal-50 border-y border-teal-100" : sub ? "bg-slate-50" : ""}>
                <td className={`px-5 py-2 ${margine ? "font-extrabold text-teal-900" : sub ? "font-bold" : "text-slate-700"}`}>
                  {r.l}
                </td>
                <td className={`px-5 py-2 text-right font-mono ${margine ? "font-extrabold text-teal-900" : sub ? "font-bold" : ""} ${r.v < 0 && !margine ? "text-slate-600" : ""}`}>
                  {r.v < 0 ? `(${fmt(-r.v)})` : fmt(r.v)}
                </td>
                <td className={`px-5 py-2 text-right w-20 text-xs ${margine ? "font-bold text-teal-700" : "text-slate-400"}`}>
                  {pct(Math.abs(r.v), base)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Indicatore espandibile (click → spiegazione a tendina) ----------
   Ogni riga di margine/indice è un pulsante: al click si apre un pannello
   con quattro sezioni fisse — come si calcola, perché si calcola, cosa
   indica il valore e la valutazione pratica sull'azienda in analisi. */

function IndicatoreEspandibile({ nome, valore, sub, dettaglio, evidenzia }) {
  const [aperto, setAperto] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setAperto((o) => !o)}
        aria-expanded={aperto}
        className={`w-full flex items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors ${aperto ? "bg-slate-50" : "hover:bg-slate-50"}`}
      >
        <span className={`shrink-0 text-[10px] text-slate-400 transition-transform ${aperto ? "rotate-90" : ""}`}>▶</span>
        <span className={`flex-1 ${evidenzia ? "font-extrabold text-teal-900" : "font-bold text-slate-800"}`}>
          {nome}
          <span className="ml-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">clicca per la spiegazione</span>
        </span>
        <span className={`font-mono font-extrabold whitespace-nowrap ${evidenzia ? "text-teal-900" : "text-slate-800"}`}>{valore}</span>
        {sub != null && <span className="w-24 text-right text-xs font-bold text-teal-700 whitespace-nowrap">{sub}</span>}
      </button>
      {aperto && dettaglio && (
        <div className="px-5 pb-4 pt-2 ml-6 border-l-2 border-teal-200 space-y-3 text-xs leading-relaxed bg-white">
          {[
            ["📐 Come si calcola", dettaglio.formula],
            ["🎯 Perché si calcola", dettaglio.perche],
            ["🔍 Cosa indica questo valore", dettaglio.cosaIndica],
            ["⚖ Valutazione pratica sull'azienda", dettaglio.valutazione],
          ].map(
            ([t, testo]) =>
              testo && (
                <div key={t} className="pl-3">
                  <p className="font-bold tracking-widest text-slate-400 uppercase text-[10px] mb-0.5">{t}</p>
                  <p className="text-slate-600">{testo}</p>
                </div>
              )
          )}
        </div>
      )}
    </div>
  );
}

