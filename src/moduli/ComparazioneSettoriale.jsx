/**
 * ComparazioneSettoriale.jsx
 * ---------------------------------------------------------------------------
 * COMPARAZIONE INTERAZIENDALE DI BILANCIO
 * Quinta applicazione della suite. Riceve i JSON prodotti dagli altri moduli
 * (escluso «Generatore Bilancio TTM») e mette a confronto più aziende dello
 * stesso settore su sei pilastri, per decretare quale sia la migliore.
 *
 * RIFERIMENTI NORMATIVI
 *   · «Comparazioni di bilancio», cap. 7 — presupposti della comparazione
 *     (attendibilità, omogeneità, completezza), comparazione nel tempo
 *     (numeri indice, CAGR, medie mobili), comparazione nello spazio
 *     (quartili anziché medie), indici teorici o standard.
 *   · Framework a 6 pilastri: qualità operativa, qualità degli utili,
 *     struttura del capitale, valutazione relativa, allocazione del capitale,
 *     valore intrinseco (DCF) contro prezzo di mercato.
 *
 * FORMATI IN INGRESSO (riconosciuti automaticamente)
 *   · "Riclassificazione SP — schema dinamico"  (formatoSalvataggio 2)
 *   · "ce-riclassificato/2.0"
 *   · modulo "rendiconto_finanziario"           (versione 2)
 *   · "analisi-bilancio/1.0"    → porta più aziende, tutti gli esercizi e i
 *                                 parametri in un solo file: è l'input più
 *                                 economico, uno per azienda.
 *   · "proforma-dcf/1.0"        → Enterprise Value e WACC per lo spread
 *                                 ROIC−WACC, per il pilastro 4 e — con il
 *                                 valore per azione — per il pilastro 6.
 *   · Quality of Earnings Fase 1 → Quality Score e red flag per direttrice.
 *   · JSON piatti {anno, ce, sp, rf} tramite parser semplice.
 *
 * LE SEI SCHEDE
 *   0. Fase 0 — ingestione a trascinamento in un riquadro per azienda (è il
 *      riquadro, non il nome scritto nel file, a decidere dove finiscono i
 *      dati), riconoscimento del formato, anagrafica di settore e
 *      dimensione, normalizzazioni del §7.2 (scala, valuta, deflazionamento
 *      IPC, patrimonio netto tangibile, allineamento degli esercizi).
 *   1. Matrice — heatmap metriche × aziende colorata per quartile, punteggi di
 *      pilastro, penalità e classifica. Pesi regolabili con preset di settore.
 *      Ogni metrica è cliccabile (che cosa calcola, perché conta) e ogni valore
 *      apre la tendina che spiega il perché del suo colore.
 *   2. Scorecard — radar a sei assi sovrapponibile e scheda per azienda con
 *      il dettaglio di tutte le metriche.
 *   3. Testa a testa — confronto diretto fra due imprese, metrica per metrica,
 *      con verdetto contato sui pilastri vinti.
 *   4. Serie storiche — numeri indice a base fissa e mobile, CAGR geometrico,
 *      medie mobili e livellamento esponenziale, banda interquartile del gruppo
 *      ricalcolata per esercizio (§7.3 – §7.6, §7.12).
 *   5. Posizionamento — isoquanti del ROI, piano delle componenti principali,
 *      fade diagram del ritorno verso la mediana (§7.10, §7.12, §7.13).
 *   6. Relazione — analisi documentale dei peer con l'IA, relazione comparativa
 *      ragionata sulla griglia, nota metodologica e stampa.
 *
 * IL PUNTO FERMO DEL MOTORE
 *   Una metrica non determinabile è NEUTRA: esce dalla media del pilastro e non
 *   penalizza. Trattarla come uno zero premierebbe chi ha caricato più file,
 *   che non è un merito industriale. La copertura dei dati è esposta per ogni
 *   azienda proprio perché un punteggio costruito su metà delle informazioni
 *   vale meno di uno costruito su tutte, e chi legge deve saperlo.
 *
 * NESSUN ANNO È CABLATO. Gli esercizi sono dedotti dal campo `esercizio` dei
 * JSON importati; l'unico riferimento temporale generato dall'applicazione è
 * quello del dataset dimostrativo, ancorato all'orologio di sistema.
 *
 * Requisiti runtime: React >= 18, Tailwind CSS (solo layout).
 * ---------------------------------------------------------------------------
 */

import { useState, useMemo, useRef, useEffect, Fragment, Component } from "react";

/* ============================================================
   [0] ERROR BOUNDARY — cattura errori di rendering
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
          <p style={{ color: "#666", marginBottom: "10px" }}>{this.state.errore.toString()}</p>
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

/* ═══════════════════════════════════════════════════════════════════════════
   [1] DESIGN SYSTEM — palette condivisa con il resto della suite
   ═══════════════════════════════════════════════════════════════════════════ */

export const INK = "#14213D";
export const PAPER = "#F5F6F3";
export const CARD = "#FFFFFF";
export const GREEN = "#1F7A5C";
export const RED = "#B3423A";
export const AMBER = "#C9962B";
export const BLUE = "#2E5EAA";
export const PURPLE = "#6D28D9";
export const TEAL = "#0E6E75";
export const LINE = "#DDE1DA";

const FONT_HEAD = "'Libre Franklin', sans-serif";
const FONT_BODY = "'IBM Plex Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

/* Scala di riempimento della heatmap, dal quartile peggiore al migliore.
   I colori sono tenui di proposito: la griglia deve restare leggibile con
   otto colonne affiancate, e il colore serve a orientare, non a gridare. */
const FASCE = [
  {
    id: 0, label: "Q1 — quarto peggiore", sfondo: "#F6DEDC", testo: "#7A2A24", bordo: "#E4B8B3",
    giudizio: "Sfavorevole", tono: "bad",
    perche:
      "Il valore cade nel quarto peggiore del gruppo: tre aziende su quattro fanno meglio. Non è una bocciatura in sé — " +
      "un intero settore può stare male insieme — ma è la posizione che richiede una spiegazione industriale, e in assenza " +
      "di quella spiegazione è ciò che più abbassa il punteggio del pilastro.",
  },
  {
    id: 1, label: "Q2 — sotto la mediana", sfondo: "#FAECD8", testo: "#7A5A16", bordo: "#EBD4AC",
    giudizio: "Dubbio", tono: "warn",
    perche:
      "Il valore sta fra il primo quartile e la mediana: sotto la metà del gruppo, ma lontano dalla coda peggiore. " +
      "È la fascia dell'attenzione — da sola non condanna, ma se si ripete su più metriche dello stesso pilastro descrive " +
      "un'azienda che insegue i concorrenti anziché dettare il passo.",
  },
  {
    id: 2, label: "Q3 — sopra la mediana", sfondo: "#E2EFE6", testo: "#1E5A44", bordo: "#BFDBCA",
    giudizio: "Favorevole", tono: "ok",
    perche:
      "Il valore supera la mediana del gruppo senza raggiungere il quarto migliore: l'azienda sta nella metà buona. " +
      "È una posizione solida, e nel punteggio pesa positivamente in proporzione a quanto è distante dalla mediana.",
  },
  {
    id: 3, label: "Q4 — quarto migliore", sfondo: "#C9E3D2", testo: "#14503A", bordo: "#9BC9AE",
    giudizio: "Molto favorevole", tono: "ok",
    perche:
      "Il valore è nel quarto migliore del gruppo: nessuna azienda, o quasi, fa meglio su questa metrica. " +
      "Va comunque letto insieme alla qualità degli utili — un primato costruito su utili non sorretti da cassa " +
      "è un primato contabile, e il pilastro 2 esiste apposta per smascherarlo.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   [2] UTILITY NUMERICHE E DI FORMATTAZIONE (locale it-IT)
   ═══════════════════════════════════════════════════════════════════════════ */

export const isNum = (v) => typeof v === "number" && isFinite(v);

export const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
};

export const safeDiv = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

export const somma = (...xs) => {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export const media = (a, b) => {
  if (isNum(a) && isNum(b)) return (a + b) / 2;
  if (isNum(a)) return a;
  if (isNum(b)) return b;
  return null;
};

export const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Accetta "2025", "31/12/2025", "2025-12-31", "esercizio 2025". */
export const annoDa = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && v >= 1900 && v <= 2200) return Math.trunc(v);
  const m = String(v).match(/(19|20)\d{2}/g);
  if (!m || !m.length) return null;
  return Number(m[m.length - 1]);
};

export const fmt = (n, dec = 0) =>
  isNum(n) ? n.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "n.d.";

export const pct = (n, dec = 1, segno = false) => {
  if (!isNum(n)) return "n.d.";
  const v = n * 100;
  return `${segno && v > 0 ? "+" : ""}${v.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
};

export const mult = (n, dec = 2, segno = false) => {
  if (!isNum(n)) return "n.d.";
  return `${segno && n > 0 ? "+" : ""}${n.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec })}x`;
};

export const pp = (n, dec = 1) => {
  if (!isNum(n)) return "n.d.";
  const v = n * 100;
  return `${v > 0 ? "+" : ""}${v.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec })} pp`;
};

export const gg = (n) => (isNum(n) ? `${Math.round(n)} gg` : "n.d.");

/** Formatta un valore secondo l'unità dichiarata dalla metrica. */
export function formattaValore(v, unita) {
  if (!isNum(v)) return "n.d.";
  switch (unita) {
    case "%": return pct(v, 1);
    case "pp": return pp(v, 1);
    case "x": return mult(v, 2);
    case "gg": return gg(v);
    case "n": return fmt(v, 0);
    case "€": return fmt(v, 0);
    default: return fmt(v, 2);
  }
}

/* ── Guida alle metriche in parole semplici ─────────────────────────────────
   Per ogni metrica: che cosa dice in una frase, come si legge (valori alti e
   bassi, ordini di grandezza tipici), un esempio con i numeri, le trappole, e
   una frase che traduce il valore di ogni azienda caricata. Le percentuali
   arrivano come frazioni (0,25 = 25%). */
const vx = (v, d = 1) => `${fmt(v, d)} volte`;

const GUIDA_METRICHE = {
  roic: {
    semplice: "Quanto rende ogni euro investito nell'attività operativa (impianti, magazzino, crediti meno debiti verso fornitori), dopo le imposte.",
    leggere: "Più è alto meglio è. Sotto il 6-8% l'azienda rende quanto o meno di quanto costa il capitale; 10-15% è buono; sopra il 20% indica un vantaggio competitivo forte (marchio, brevetti, effetti di rete).",
    esempio: "Capitale operativo 100, utile operativo dopo le imposte 15 → ROIC 15%: ogni 100 investiti ne tornano 15 all'anno.",
    attenzione: "Le aziende con molti beni immateriali non capitalizzati (software, R&S spesata) mostrano ROIC altissimi perché il capitale investito a bilancio è sottostimato.",
    frase: (v, V, n) => `Per ogni 100 di capitale operativo investito, ${n} genera ${fmt(v * 100, 1)} di utile operativo netto all'anno.`,
  },
  spread_roic_wacc: {
    semplice: "La differenza fra quanto l'azienda rende (ROIC) e quanto le costa il capitale che usa (WACC): dice se crea o distrugge valore.",
    leggere: "Positivo = crea valore: ogni euro reinvestito vale più di un euro. Negativo = distrugge valore anche se è in utile. Oltre +5 punti è un margine solido.",
    esempio: "ROIC 12%, WACC 8% → spread +4 punti: ogni 100 investiti producono 4 di valore in più di quanto chiedono azionisti e banche.",
    attenzione: "Dipende dal WACC: se nel DCF o in Redditività il WACC è sbagliato (es. tasso privo di rischio a zero) lo spread è gonfiato.",
    frase: (v, V, n) => v >= 0 ? `${n} rende ${V} in più del costo del suo capitale: crea valore.` : `${n} rende ${V} rispetto al costo del suo capitale: distrugge valore.`,
  },
  ebitda_margin: {
    semplice: "Quanta parte dei ricavi resta dopo i costi operativi, prima di ammortamenti, interessi e imposte.",
    leggere: "Più alto è meglio. Va confrontato solo dentro lo stesso settore: software 30-40%, industria 10-20%, distribuzione 3-8%.",
    esempio: "Ricavi 100, EBITDA 30 → margine 30%: su 100 euro venduti ne restano 30 per pagare investimenti, debito e imposte.",
    attenzione: "Ignora gli investimenti: un'azienda che deve rinnovare continuamente impianti può avere un EBITDA alto e poca cassa.",
    frase: (v, V, n) => `Su 100 di ricavi, a ${n} restano ${fmt(v * 100, 1)} di margine operativo lordo.`,
  },
  ebit_margin: {
    semplice: "Come l'EBITDA margin ma dopo gli ammortamenti: il guadagno operativo vero, che tiene conto dell'usura degli impianti.",
    leggere: "Più alto è meglio. La distanza dall'EBITDA margin dice quanto pesano gli investimenti fissi.",
    esempio: "Ricavi 100, EBITDA 30, ammortamenti 10 → EBIT 20, margine 20%.",
    frase: (v, V, n) => `Su 100 di ricavi, a ${n} restano ${fmt(v * 100, 1)} di risultato operativo.`,
  },
  fcf_conversion: {
    semplice: "Quanta parte del margine operativo lordo diventa davvero cassa libera, dopo investimenti e capitale circolante.",
    leggere: "Più alto è meglio. Sopra il 60-70% gli utili si trasformano in cassa; sotto il 30% gran parte del margine resta bloccata in investimenti o crediti.",
    esempio: "EBITDA 100, cassa libera 70 → conversione 70%.",
    attenzione: "Un anno di forti investimenti la abbassa anche in un'azienda sana: guarda più esercizi.",
    frase: (v, V, n) => `${n} trasforma in cassa libera ${V} del suo margine operativo lordo.`,
  },
  ccc: {
    semplice: "Quanti giorni passano fra quando l'azienda paga i fornitori e quando incassa dai clienti (magazzino + crediti − debiti verso fornitori).",
    leggere: "Più basso è meglio: meno giorni = meno soldi immobilizzati. Un valore negativo vuol dire che incassa prima di pagare (lo fanno supermercati, piattaforme online).",
    esempio: "Magazzino 40 giorni + incasso clienti 60 − pagamento fornitori 50 = 50 giorni di cassa ferma.",
    frase: (v, V, n) => v < 0 ? `${n} incassa dai clienti ${V.replace("-", "")} prima di pagare i fornitori: i fornitori finanziano la sua attività.` : `${n} tiene ferma la cassa per ${V} fra pagamento dei fornitori e incasso dai clienti.`,
  },
  asset_turnover: {
    semplice: "Quanti euro di ricavi produce ogni euro di capitale investito.",
    leggere: "Più alto è meglio, a parità di margine. Il commercio gira il capitale 2-3 volte l'anno, l'industria pesante meno di 1.",
    esempio: "Capitale investito 50, ricavi 100 → rotazione 2: ogni euro investito genera 2 euro di vendite.",
    frase: (v, V, n) => `Ogni euro di capitale investito da ${n} produce ${fmt(v, 2)} euro di ricavi.`,
  },
  accrual_ratio: {
    semplice: "Quanta parte dell'utile è fatta di scritture contabili e non di cassa incassata.",
    leggere: "Più basso è meglio. Vicino a zero gli utili sono cassa vera; sopra il 10% gli utili dipendono molto da stime e rinvii, e storicamente tendono a scendere.",
    esempio: "Utile 100, flusso di cassa operativo 90, attivo medio 1.000 → (100 − 90) ÷ 1.000 = 1%.",
    frase: (v, V, n) => `Gli utili di ${n} superano la cassa operativa per una quota pari al ${V} dell'attivo.`,
  },
  tax_ratio: {
    semplice: "Le imposte che l'azienda paga davvero confrontate con l'aliquota di legge.",
    leggere: "Intorno a 1 è normale. Molto sotto 1 = paga meno del previsto (agevolazioni, utili in paesi a bassa tassazione: a volte sostenibile, a volte no). Molto sopra 1 = costi non deducibili o perdite non sfruttate.",
    esempio: "Aliquota di legge 21%, imposte effettive 17% → rapporto 0,81.",
    frase: (v, V, n) => `${n} paga imposte pari a ${fmt(v, 2)} volte quelle dell'aliquota di legge.`,
  },
  quota_capitalizzata: {
    semplice: "Quanta parte dei costi l'azienda non mette nel conto economico ma iscrive nell'attivo come investimento (sviluppo, software interno).",
    leggere: "Più bassa è meglio per la qualità degli utili: capitalizzare sposta costi negli anni futuri e fa sembrare più alto l'utile di oggi.",
    esempio: "Costi di sviluppo 20, di cui 8 capitalizzati → 40% capitalizzato.",
    frase: (v, V, n) => `${n} capitalizza ${V} dei costi che potrebbe spesare.`,
  },
  peso_immateriali: {
    semplice: "Quanto del patrimonio netto è fatto di beni immateriali (avviamento da acquisizioni, marchi, brevetti).",
    leggere: "Più basso è più prudente: gli immateriali non si vendono facilmente e possono essere svalutati di colpo. Sopra il 100% il patrimonio, tolti gli immateriali, sarebbe negativo.",
    esempio: "Patrimonio netto 100, immateriali 60 → 60%: tolti gli immateriali restano 40.",
    frase: (v, V, n) => `Gli immateriali di ${n} valgono il ${V} del suo patrimonio netto.`,
  },
  ammortamento_ppe: {
    semplice: "Quanto vengono ammortizzati ogni anno impianti e macchinari rispetto al loro valore.",
    leggere: "Più alto è più prudente. Un valore molto basso rispetto ai concorrenti può voler dire vite utili allungate per gonfiare l'utile.",
    esempio: "Impianti 100, ammortamento 10 → 10%: vita media implicita 10 anni.",
    frase: (v, V, n) => `${n} ammortizza ogni anno il ${V} dei suoi impianti (vita media implicita circa ${isNum(v) && v > 0 ? fmt(1 / v, 0) : "—"} anni).`,
  },
  qoe_score: {
    semplice: "Il punteggio di qualità del bilancio calcolato da Quality of Earnings (0-100).",
    leggere: "Più alto è meglio. Sopra 75 i numeri sono affidabili; sotto 50 vanno verificati prima di usarli in una valutazione.",
    esempio: "78/100: bilancio affidabile con qualche punto di attenzione.",
    frase: (v, V, n) => `Il bilancio di ${n} ottiene ${V}/100 in Quality of Earnings.`,
  },
  qoe_redflag: {
    semplice: "Quante aree critiche (red flag) ha trovato Quality of Earnings.",
    leggere: "Più basso è meglio: zero è l'ideale. Ogni red flag è un punto del bilancio da andare a controllare.",
    esempio: "1 red flag: per esempio una distribuzione delle cifre anomala (legge di Benford).",
    frase: (v, V, n) => `Quality of Earnings ha trovato ${V} red flag nel bilancio di ${n}.`,
  },
  doc_reperti: {
    semplice: "Quanti elementi critici sono emersi leggendo i documenti (note, relazioni): contenziosi, garanzie, rilievi del revisore.",
    leggere: "Più basso è meglio.",
    esempio: "2 reperti: un contenzioso rilevante e una garanzia fuori bilancio.",
    frase: (v, V, n) => `Nei documenti di ${n} sono emersi ${V} elementi critici.`,
  },
  nd_ebitda: {
    semplice: "Quanti anni di margine operativo lordo servirebbero per ripagare tutto il debito finanziario netto.",
    leggere: "Più basso è meglio. Sotto 1 il debito è quasi irrilevante; 1-3 normale; oltre 3-4 le banche cominciano a preoccuparsi. Negativo = l'azienda ha più cassa che debiti.",
    esempio: "Debito netto 300, EBITDA 100 → 3 anni.",
    frase: (v, V, n) => v < 0 ? `${n} ha più liquidità che debiti finanziari: debito netto negativo.` : `A ${n} servirebbero circa ${fmt(v, 1)} anni di EBITDA per ripagare il debito netto.`,
  },
  interest_coverage: {
    semplice: "Quante volte il risultato operativo copre gli interessi da pagare sul debito.",
    leggere: "Più alto è meglio. Sotto 1,5 l'azienda fatica a pagare gli interessi; sopra 5 è tranquilla.",
    esempio: "EBIT 50, interessi 10 → copertura 5 volte.",
    frase: (v, V, n) => `Il risultato operativo di ${n} copre ${vx(v)} gli interessi.`,
  },
  fco_oneri: {
    semplice: "Come la copertura degli interessi, ma con la cassa operativa invece dell'utile: quanto la cassa generata basta a pagare gli oneri finanziari.",
    leggere: "Più alto è meglio; sotto 1 la cassa non basta e serve nuovo debito per pagare gli interessi.",
    esempio: "Cassa operativa 80, oneri finanziari 10 → 8 volte.",
    frase: (v, V, n) => `La cassa operativa di ${n} copre ${vx(v)} gli oneri finanziari.`,
  },
  quota_debito_breve: {
    semplice: "Quanta parte del debito finanziario scade entro un anno.",
    leggere: "Più bassa è meglio: debito a breve = da rinnovare presto, rischio se le banche chiudono i rubinetti.",
    esempio: "Debito totale 100, di cui 30 entro l'anno → 30%.",
    frase: (v, V, n) => `Il ${V} del debito di ${n} scade entro dodici mesi.`,
  },
  leverage: {
    semplice: "Il debito finanziario netto rispetto al patrimonio degli azionisti.",
    leggere: "Più basso è più solido. Sotto 0,5 poco indebitata; sopra 1,5-2 molto indebitata. Negativo = più cassa che debiti.",
    esempio: "Debito netto 50, patrimonio netto 100 → 0,5.",
    frase: (v, V, n) => v < 0 ? `${n} ha più liquidità che debiti finanziari.` : `Per ogni 100 di patrimonio, ${n} ha ${fmt(v * 100, 0)} di debito finanziario netto.`,
  },
  current_ratio: {
    semplice: "Le attività che diventano cassa entro un anno confrontate con i debiti da pagare entro un anno.",
    leggere: "Più alto è più tranquillo: sopra 1 i debiti a breve sono coperti; sotto 1 l'azienda dipende da nuovi incassi o finanziamenti per pagarli.",
    esempio: "Attività correnti 150, passività correnti 100 → 1,5.",
    frase: (v, V, n) => `${n} ha ${fmt(v, 2)} euro di attività a breve per ogni euro di debiti a breve.`,
  },
  ev_ebitda: {
    semplice: "Quante volte il margine operativo lordo annuo paga chi compra tutta l'azienda (azioni più debiti, meno cassa). È il «prezzo» dell'azienda in anni di EBITDA.",
    leggere: "Più basso = più a buon mercato. Il valore di riferimento dipende dal settore: industria e banche 6-9 volte, mercato in media 10-12, tecnologia e software di qualità 15-25. Molto sotto i concorrenti può voler dire occasione oppure problemi che il mercato vede.",
    esempio: "Capitalizzazione 900 + debito netto 100 = valore d'impresa (EV) 1.000; EBITDA 100 → 10 volte: comprando tutto, servirebbero 10 anni di EBITDA per rientrare.",
    attenzione: "Usa la capitalizzazione di borsa (da Redditività o dal DCF) più la PFN; se manca la capitalizzazione usa l'EV del DCF. Se capitalizzazione o EV sono in una scala sbagliata il numero non ha senso: controlla i «dati usati» qui sotto.",
    frase: (v, V, n) => `Chi comprasse tutta ${n} pagherebbe ${vx(v)} il suo EBITDA annuo.`,
  },
  ev_ebit: {
    semplice: "Come EV ÷ EBITDA ma rispetto al risultato operativo dopo gli ammortamenti: tiene conto di quanto l'azienda deve reinvestire negli impianti.",
    leggere: "Più basso = più a buon mercato. Di solito 8-15 volte; i settori ad alta intensità di capitale risultano più cari qui che su EBITDA.",
    esempio: "EV 1.000, EBIT 80 → 12,5 volte.",
    frase: (v, V, n) => `Chi comprasse tutta ${n} pagherebbe ${vx(v)} il suo risultato operativo annuo.`,
  },
  fcf_yield: {
    semplice: "La cassa libera generata in un anno divisa per la capitalizzazione: il «rendimento in cassa» che otterrebbe chi compra le azioni.",
    leggere: "Più alto è meglio. Confrontalo con il rendimento di un titolo di Stato: 5% contro un BTP al 3,5% è interessante; 2% è caro a meno di forte crescita.",
    esempio: "Capitalizzazione 1.000, cassa libera 50 → 5% l'anno.",
    frase: (v, V, n) => `Comprando le azioni di ${n} al prezzo attuale si «riceverebbe» un ${V} annuo di cassa libera.`,
  },
  pe: {
    semplice: "Il prezzo di borsa diviso per l'utile netto: quanti anni di utili costa l'azienda.",
    leggere: "Più basso = più a buon mercato. Media storica dei mercati 15-18; sotto 10 economico (o rischioso); sopra 30 il mercato sconta forte crescita.",
    esempio: "Capitalizzazione 2.000, utile 100 → P/E 20.",
    attenzione: "Va letto solo se gli utili sono di qualità: un utile gonfiato fa sembrare il titolo economico.",
    frase: (v, V, n) => `Il mercato paga ${n} ${vx(v)} il suo utile netto annuo.`,
  },
  peg: {
    semplice: "Il P/E corretto per la crescita: P/E diviso il tasso di crescita annuo atteso.",
    leggere: "Sotto 1 il prezzo è basso rispetto alla crescita; intorno a 1 equo; sopra 2 caro anche considerando la crescita.",
    esempio: "P/E 20, crescita 20% l'anno → PEG 1.",
    frase: (v, V, n) => `Tenendo conto della crescita, il prezzo di ${n} vale ${fmt(v, 2)} (sotto 1 conveniente, sopra 2 caro).`,
  },
  goodwill_attivo: {
    semplice: "Quanto dell'attivo totale è fatto di beni immateriali.",
    leggere: "Più basso è meglio per la solidità: sopra il 30-40% l'azienda è cresciuta molto per acquisizioni e c'è rischio di svalutazioni.",
    esempio: "Attivo 1.000, immateriali 300 → 30%.",
    frase: (v, V, n) => `Il ${V} dell'attivo di ${n} è fatto di beni immateriali.`,
  },
  delta_roic: {
    semplice: "Di quanto è cambiato il ROIC rispetto all'anno prima.",
    leggere: "Positivo = l'azienda sta investendo bene (i nuovi investimenti rendono di più); negativo = rendimenti in calo.",
    esempio: "ROIC da 12% a 14% → +2 punti.",
    frase: (v, V, n) => `Il ROIC di ${n} è cambiato di ${V} rispetto all'esercizio precedente.`,
  },
  capex_ammortamenti: {
    semplice: "Quanto l'azienda investe in impianti rispetto a quanto si consumano (ammortamenti).",
    leggere: "Intorno a 1 mantiene la capacità produttiva; sopra 1,5 sta crescendo; sotto 1 la sta lasciando invecchiare (più cassa oggi, problemi domani).",
    esempio: "Investimenti 150, ammortamenti 100 → 1,5: investe più di quanto consuma.",
    frase: (v, V, n) => `${n} investe ${vx(v, 2)} quanto ammortizza.`,
  },
  payout: {
    semplice: "Quanta parte dell'utile viene distribuita agli azionisti come dividendo.",
    leggere: "Non c'è un valore giusto: 30-60% è equilibrato. Vicino o sopra il 100% distribuisce più di quanto guadagna (non sostenibile a lungo); vicino a zero reinveste tutto.",
    esempio: "Utile 100, dividendi 40 → payout 40%.",
    frase: (v, V, n) => `${n} distribuisce il ${V} dell'utile come dividendi.`,
  },
  upside_dcf: {
    semplice: "Di quanto il valore calcolato con il DCF è sopra (o sotto) il prezzo di borsa.",
    leggere: "Positivo = secondo il DCF il titolo vale più del prezzo (potenziale guadagno); negativo = il mercato lo paga più di quanto vale secondo le tue stime.",
    esempio: "Prezzo 100, valore DCF 130 → upside +30%.",
    attenzione: "Vale quanto valgono le ipotesi del DCF: con un WACC troppo basso l'upside esplode.",
    frase: (v, V, n) => v >= 0 ? `Secondo il DCF, ${n} vale il ${V} in più del prezzo di borsa.` : `Secondo il DCF, ${n} vale il ${V.replace("-", "")} in meno del prezzo di borsa.`,
  },
  margine_sicurezza: {
    semplice: "Lo sconto del prezzo rispetto al valore DCF, misurato sul valore: quanto potresti sbagliare le stime prima di perdere.",
    leggere: "Più alto è meglio. Gli investitori «value» cercano almeno il 20-30%.",
    esempio: "Valore DCF 130, prezzo 100 → margine 23%: il valore potrebbe essere sovrastimato del 23% senza perdere.",
    frase: (v, V, n) => `Il prezzo di ${n} è ${v >= 0 ? "sotto" : "sopra"} il valore DCF del ${V.replace("-", "")}.`,
  },
  prezzo_su_valore: {
    semplice: "Quanto paghi in borsa per ogni euro di valore stimato dal DCF.",
    leggere: "Sotto 1 paghi meno di quanto vale (0,7 = 70 centesimi per 1 euro di valore); sopra 1 paghi di più; sopra 1,3 il mercato sconta uno scenario migliore del tuo.",
    esempio: "Prezzo 80, valore 100 → 0,8.",
    frase: (v, V, n) => `Per ${n} si pagano ${fmt(v, 2)} euro in borsa per ogni euro di valore DCF.`,
  },
  ev_mercato_su_dcf: {
    semplice: "Il valore d'impresa che il mercato attribuisce (capitalizzazione + debito netto) diviso per quello del DCF: lo stesso confronto prezzo/valore ma sull'intera azienda, senza l'effetto del debito.",
    leggere: "Sotto 1 il mercato paga l'azienda operativa meno del tuo DCF; sopra 1 di più.",
    esempio: "EV di mercato 900, EV del DCF 1.000 → 0,9.",
    frase: (v, V, n) => `Il mercato valuta l'azienda operativa di ${n} ${fmt(v, 2)} volte quanto il DCF.`,
  },
};

/* Perché una metrica resta «n.d.» per un'azienda, in parole semplici. */
function perchéMancante(id, ctx) {
  if (!ctx) return null;
  const prezzo = num(ctx.mercato?.prezzoAzione);
  const cap = num(ctx.mercato?.capitalizzazione);
  const valore = num(ctx.mercato?.valorePerAzione);
  const daMercato = ["upside_dcf", "margine_sicurezza", "prezzo_su_valore", "ev_mercato_su_dcf", "pe", "fcf_yield", "peg"];
  if (daMercato.includes(id) && !isNum(prezzo) && !isNum(cap)) {
    return "Manca il prezzo di borsa dell'azione (o la capitalizzazione): senza, non si può confrontare il valore con il mercato. " +
      "Scrivilo nel DCF (Assumption → Tributaria e valutazione → «Prezzo attuale dell'azione sul mercato») e premi «↻ Aggiorna la comparazione», " +
      "oppure scrivilo qui nella scheda dell'azienda (Fase 0, campo «Prezzo azione»).";
  }
  if (["upside_dcf", "margine_sicurezza", "prezzo_su_valore"].includes(id) && !isNum(valore) && !isNum(num(ctx.dcf?.equityValue)))
    return "Manca il valore per azione del DCF: nel DCF serve il numero di azioni.";
  if (id === "capex_ammortamenti") return "Mancano gli investimenti (capex) o gli ammortamenti nel rendiconto finanziario di questo esercizio.";
  return null;
}

/* Le grandezze da cui nasce il valore di una metrica, per controllarlo. */
function datiUsati(id, ctx) {
  if (!ctx) return [];
  const cap = num(ctx.mercato?.capitalizzazione);
  const pfn = ctx.sp?.pfn;
  const evDcf = num(ctx.dcf?.enterpriseValue);
  const ev = isNum(cap) ? cap + (isNum(pfn) ? pfn : 0) : evDcf;
  const fonteEv = isNum(cap) ? (isNum(pfn) ? "capitalizzazione + PFN" : "capitalizzazione") : isNum(evDcf) ? "EV del DCF" : "—";
  const A = (x) => (isNum(x) ? fmt(x, 0) : "—");
  const base = { ev_ebitda: [["EV usato", `${A(ev)} (${fonteEv})`], ["capitalizzazione", A(cap)], ["PFN", A(pfn)], ["EBITDA", A(ctx.ce?.ebitda)]],
    ev_ebit: [["EV usato", `${A(ev)} (${fonteEv})`], ["capitalizzazione", A(cap)], ["PFN", A(pfn)], ["EBIT", A(ctx.ce?.ebit)]],
    pe: [["capitalizzazione", A(cap)], ["utile netto", A(ctx.ce?.utileNetto)]],
    fcf_yield: [["capitalizzazione", A(cap)]],
    nd_ebitda: [["PFN", A(pfn)], ["EBITDA", A(ctx.ce?.ebitda)]],
    leverage: [["PFN", A(pfn)], ["patrimonio netto", A(ctx.sp?.patrimonioNetto)]],
    ebitda_margin: [["EBITDA", A(ctx.ce?.ebitda)], ["ricavi", A(ctx.ce?.ricavi)]],
    ebit_margin: [["EBIT", A(ctx.ce?.ebit)], ["ricavi", A(ctx.ce?.ricavi)]],
    ev_mercato_su_dcf: [["EV di mercato", `${A(isNum(cap) ? cap + (isNum(pfn) ? pfn : 0) : null)}`], ["EV del DCF", A(evDcf)]],
    upside_dcf: [["prezzo", isNum(ctx.mercato?.prezzoAzione) ? fmt(ctx.mercato.prezzoAzione, 2) : "—"], ["valore DCF per azione", isNum(ctx.mercato?.valorePerAzione) ? fmt(ctx.mercato.valorePerAzione, 2) : "—"],
      ["capitalizzazione", A(cap)], ["equity del DCF", A(num(ctx.dcf?.equityValue))]],
  };
  base.margine_sicurezza = base.upside_dcf;
  base.prezzo_su_valore = base.upside_dcf;
  return base[id] || [];
}


/* ═══════════════════════════════════════════════════════════════════════════
   [3] LETTURA DEI JSON DELLA SUITE
   ═══════════════════════════════════════════════════════════════════════════
   Il blocco riprende la logica di ingestione già rodata in «redditività e
   solvibilità»: stessi discriminanti di formato, stessi costruttori di blocco,
   stessa forma canonica del dataset (anno → { ce, sp, rf, presenti }).
   Le aggiunte sono tre: il riconoscimento di «analisi-bilancio/1.0» (che porta
   più aziende in un colpo solo), di «proforma-dcf/1.0» (Enterprise Value e
   WACC) e dei salvataggi di Quality of Earnings (Quality Score e red flag).
   ─────────────────────────────────────────────────────────────────────────── */

/** Somma gli importi delle voci di una data classe (case-insensitive). */
const sommaClasse = (voci, classe) => {
  if (!Array.isArray(voci)) return null;
  const sel = voci.filter((v) => slug(v?.classe) === slug(classe));
  if (!sel.length) return null;
  return sel.reduce((acc, v) => acc + (num(v.importo) || 0), 0);
};

/* Scomposizione dell'attivo immobilizzato. La priorità non è un dettaglio:
   «immobilizzazioni immateriali» contiene la stringa «materiali», e senza un
   ordine finirebbe fra le tecniche. */
const RE_IMMATERIALI =
  /goodwill|avviament|intangib|immaterial|brevett|marchi|concession|licenz|software|know.?how|ricerca e svilupp|oneri pluriennal|diritti di utilizz/i;
const RE_PARTECIPAZIONI =
  /partecipaz|equity.?method|collegat|controllat|joint venture|associat|shareholding|investiment[oi] in imprese/i;
const RE_TECNICHE =
  /property.*plant|plant.*equipment|immobili|material|impiant|macchinar|terren|fabbricat|attrezzatur|automezz|right.?of.?use|leasehold|beni strumental/i;

function classificaImmobilizzazioni(voci) {
  if (!Array.isArray(voci)) return { immateriali: null, partecipazioni: null, ppe: null };
  let immateriali = null;
  let partecipazioni = null;
  let ppe = null;
  const accumula = (acc, v) => (acc ?? 0) + (num(v) || 0);
  voci.forEach((v) => {
    const cl = slug(v?.classe);
    if (cl !== slug("att_op_immobilizzata") && cl !== slug("att_fin_immobilizzata")) return;
    const nome = String(v?.nome || "");
    if (RE_IMMATERIALI.test(nome)) immateriali = accumula(immateriali, v.importo);
    else if (RE_PARTECIPAZIONI.test(nome)) partecipazioni = accumula(partecipazioni, v.importo);
    else if (RE_TECNICHE.test(nome)) ppe = accumula(ppe, v.importo);
  });
  return { immateriali, partecipazioni, ppe };
}

function bloccoCE(e) {
  const ag = e?.aggregati || {};
  const oneriDaVoci = sommaClasse(e?.voci, "ONERI_FIN");
  const proventiDaVoci = sommaClasse(e?.voci, "PROVENTI_FIN");
  const gf = num(ag.gestioneFinanziaria);
  const oneriFinanziari = isNum(oneriDaVoci) ? Math.abs(oneriDaVoci) : isNum(gf) && gf < 0 ? -gf : null;
  const rai = num(ag.risultatoAnteImposte);
  return {
    ricavi: num(ag.ricavi) ?? num(ag.valoreProduzione),
    ebitda: num(ag.ebitda),
    ebit: num(ag.ebit) ?? num(ag.redditoOperativoCaratteristica),
    // MON = reddito operativo della sola gestione caratteristica: è il
    // numeratore corretto del ROIC, distinto dall'EBIT che può includere
    // la gestione accessoria.
    mon: num(ag.redditoOperativoCaratteristica) ?? num(ag.ebit),
    utileNetto: num(ag.utileNetto),
    oneriFinanziari,
    proventiFinanziari: isNum(proventiDaVoci) ? proventiDaVoci : isNum(gf) && gf > 0 ? gf : null,
    gestioneFinanziaria: gf,
    gestioneNonCorrente: num(ag.gestioneNonCorrente),
    ammortamenti: sommaClasse(e?.voci, "AMMORTAMENTI"),
    accantonamenti: sommaClasse(e?.voci, "ACCANTONAMENTI"),
    costoVenduto: sommaClasse(e?.voci, "ACQUISTI"),
    costoLavoro: sommaClasse(e?.voci, "PERSONALE"),
    costiServizi: sommaClasse(e?.voci, "SERVIZI"),
    // Incrementi di immobilizzazioni per lavori interni: è la voce che misura
    // direttamente le politiche di capitalizzazione del pilastro 2. Esiste
    // solo se il file porta con sé le voci di dettaglio.
    lavoriInterni: sommaClasse(e?.voci, "LAVORI_INTERNI"),
    valoreAggiunto: num(ag.valoreAggiunto),
    risultatoAnteImposte: rai,
    imposte: num(ag.imposte),
    raof: somma(rai, oneriFinanziari),
  };
}

function bloccoSP(e) {
  const ag = e?.aggregati || {};
  const scomposte = classificaImmobilizzazioni(e?.voci);
  const attOpCorr = num(ag.attOpCorr);
  const attOpMag = num(ag.attOpMag);
  const liq = num(ag.liq);
  const finAltre = num(ag.finAltre);
  const passOpCorr = num(ag.passOpCorr);
  const debFinC = num(ag.debFinC);
  return {
    capitaleInvestitoNetto: num(ag.cinTot) ?? num(ag.cinOper),
    coin: num(ag.cinOper) ?? num(ag.cinTot),
    ccno: num(ag.ccno),
    immobilizzazioniOperative: num(ag.immobOper),
    passivitaOperativeNonCorrenti: num(ag.passOpNC),
    attivitaOperativeCorrenti: attOpCorr,
    passivitaOperativeCorrenti: passOpCorr,
    attivitaOperative: somma(num(ag.immobOper), attOpMag, attOpCorr),
    passivitaOperative: somma(passOpCorr, num(ag.passOpNC)),
    accessori: num(ag.accessori),
    investimentiFinanziari: somma(liq, finAltre),
    patrimonioNetto: num(ag.pn),
    pfn: num(ag.pfn),
    rimanenze: attOpMag,
    attivoCircolante: somma(attOpCorr, attOpMag, liq, finAltre),
    passivoCorrente: somma(passOpCorr, debFinC),
    liquidita: liq,
    debitiFinanziariBreve: debFinC,
    debitiFinanziariLungo: num(ag.debFinNC),
    pfnBreve: num(ag.pfnBreve),
    totaleAttivo: num(ag.totAttivoContab) ?? num(ag.totImpieghi),
    immateriali: scomposte.immateriali,
    partecipazioni: scomposte.partecipazioni,
    ppe: scomposte.ppe,
  };
}

function bloccoRF(e) {
  const ag = e?.aggregati || {};
  return {
    liquidita: num(e?.cassaFinale),
    liquiditaIniziale: num(e?.cassaIniziale),
    flussoOperativo: num(ag.flussoOperativoCorrente) ?? num(ag.flussoGestioneCorrente),
    fcfo: num(ag.fcfo),
    fcfe: num(ag.fcfe),
    capex: num(ag.capex),
    servizioDelDebito: num(ag.servizioDelDebito),
    dividendi: num(ag.equityDividendi),
    raccolta: num(ag.raccolta),
  };
}

const COSTRUTTORI = { ce: bloccoCE, sp: bloccoSP, rf: bloccoRF };

/**
 * Riconosce il tipo del file. L'ordine conta: i formati con un'intestazione
 * esplicita vengono prima dell'euristica sulle chiavi degli aggregati.
 */
export function rilevaTipo(obj) {
  if (!obj || typeof obj !== "object") return null;

  const formato = slug(obj.formato || "");
  if (formato.startsWith("analisibilancio")) return "analisi";
  if (formato.startsWith("proformadcf")) return "dcf";
  if (formato.startsWith("cericlassificato")) return "ce";
  if (formato.startsWith("bilanciottm")) return "ttm";

  if (slug(obj.modulo || "").includes("rendicontofinanziario")) return "rf";

  const app = slug(obj.applicazione || "");
  if (app.includes("riclassificazionesp")) return "sp";
  if (app.includes("qualitacontabile") || app.includes("validazioneequalita")) return "qoe";
  if (obj.statoApplicazione && (obj.risultanzeRischio || obj.statoApplicazione.esiti)) return "qoe";

  const ag = obj?.esercizioCorrente?.aggregati || {};
  if ("ebitda" in ag || "valoreAggiunto" in ag) return "ce";
  if ("cinTot" in ag || "pfnBreve" in ag || "totImpieghi" in ag) return "sp";
  if ("fcfo" in ag || "flussoOperativoCorrente" in ag) return "rf";
  if (obj?.esercizioCorrente?.cassaFinale !== undefined) return "rf";

  return null;
}

/** Metadati (azienda, valuta, unità) dedotti dall'intestazione del file. */
function metaDa(obj) {
  const s = obj?.schemaCE || obj?.schemaContabile || obj?.esercizioCorrente?.schemaRF || obj?.meta || {};
  return {
    azienda: obj?.azienda || null,
    valuta: s.valuta || null,
    unita: s.unita || null,
    schema: s.schema || null,
    aliquota: num(obj?.aliquota),
  };
}

/* ── Parser "semplice": JSON piatti {anno, ce, sp, rf} ─────────────────────── */

const ALIAS = {
  ce: {
    ricavi: ["ricavi", "ricaviVendite", "fatturato", "revenue", "valoreProduzione"],
    ebitda: ["ebitda", "margineOperativoLordo", "mol"],
    ebit: ["ebit", "risultatoOperativo", "redditoOperativo"],
    mon: ["mon", "redditoOperativoCaratteristica", "ebit"],
    oneriFinanziari: ["oneriFinanziari", "interessiPassivi", "interestExpense"],
    utileNetto: ["utileNetto", "risultatoNetto", "utileEsercizio", "netIncome"],
    imposte: ["imposte", "imposteSulReddito", "taxes"],
    risultatoAnteImposte: ["risultatoAnteImposte", "utileAnteImposte", "ebt"],
    ammortamenti: ["ammortamenti", "ammortamentiSvalutazioni", "depreciation"],
    costoVenduto: ["costoVenduto", "acquisti", "cogs"],
  },
  sp: {
    capitaleInvestitoNetto: ["capitaleInvestitoNetto", "cin", "cinTot", "capitaleInvestito"],
    coin: ["coin", "cinOper", "capitaleOperativoInvestitoNetto"],
    patrimonioNetto: ["patrimonioNetto", "pn", "mezziPropri", "equity"],
    attivoCircolante: ["attivoCircolante", "attivoCorrente", "currentAssets"],
    passivoCorrente: ["passivoCorrente", "passivitaCorrenti", "currentLiabilities"],
    rimanenze: ["rimanenze", "magazzino", "scorte", "inventory"],
    pfn: ["pfn", "posizioneFinanziariaNetta", "netDebt"],
    liquidita: ["liquidita", "disponibilitaLiquide", "cassa", "cash"],
    immateriali: ["immateriali", "immobilizzazioniImmateriali", "goodwill", "intangibles"],
    totaleAttivo: ["totaleAttivo", "totAttivo", "totalAssets"],
  },
  rf: {
    liquidita: ["liquidita", "cassaFinale", "disponibilitaLiquide", "cash"],
    flussoOperativo: ["flussoOperativo", "flussoCassaOperativo", "ocf"],
    fcfo: ["fcfo", "freeCashFlowOperativo"],
    capex: ["capex", "investimenti"],
    dividendi: ["dividendi", "dividends"],
    servizioDelDebito: ["servizioDelDebito", "debtService"],
  },
};

const pick = (obj, aliases) => {
  if (!obj || typeof obj !== "object") return null;
  const map = {};
  Object.keys(obj).forEach((k) => (map[slug(k)] = obj[k]));
  for (const a of aliases) {
    const v = num(map[slug(a)]);
    if (v !== null) return v;
  }
  return null;
};

const sezione = (obj, nomi) => {
  if (!obj || typeof obj !== "object") return obj || {};
  for (const k of Object.keys(obj)) if (nomi.some((n) => slug(n) === slug(k))) return obj[k] || {};
  return obj;
};

function parserSemplice(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap(parserSemplice);
  if (raw.anni || raw.annualita || raw.esercizi)
    return parserSemplice(raw.anni || raw.annualita || raw.esercizi);

  const costruisci = (anno, body) => ({
    anno,
    blocchi: {
      ce: Object.fromEntries(
        Object.entries(ALIAS.ce).map(([k, a]) => [k, pick(sezione(body, ["ce", "contoEconomico"]), a)])
      ),
      sp: Object.fromEntries(
        Object.entries(ALIAS.sp).map(([k, a]) => [k, pick(sezione(body, ["sp", "statoPatrimoniale"]), a)])
      ),
      rf: Object.fromEntries(
        Object.entries(ALIAS.rf).map(([k, a]) => [k, pick(sezione(body, ["rf", "rendicontoFinanziario"]), a)])
      ),
    },
  });

  const anno = annoDa(raw.anno ?? raw.year ?? raw.esercizio ?? raw.periodo);
  if (anno) return [costruisci(anno, raw)];

  const chiaviAnno = Object.keys(raw).filter((k) => /^(19|20)\d{2}$/.test(String(k).trim()));
  if (chiaviAnno.length) return chiaviAnno.map((k) => costruisci(Number(k), raw[k]));
  return [];
}

/* ── Estrattori dei formati compositi ──────────────────────────────────────── */

/**
 * «analisi-bilancio/1.0» porta un'intera analisi: più aziende, ciascuna con
 * il proprio dataset già fuso (anno → {ce, sp, rf, presenti}) e i parametri.
 * È l'unico input che può popolare più aziende con un solo file, quindi
 * restituisce una lista di contributi anziché uno solo.
 */
function estraiDaAnalisi(obj) {
  const contributi = [];
  const aziende = obj?.aziende && typeof obj.aziende === "object" ? obj.aziende : {};
  const par = obj?.par || null;

  Object.entries(aziende).forEach(([chiave, impresa]) => {
    const esercizi = impresa?.esercizi;
    if (!esercizi || typeof esercizi !== "object") return;
    const record = [];
    Object.keys(esercizi).forEach((k) => {
      const anno = annoDa(k);
      if (!anno) return;
      const e = esercizi[k] || {};
      record.push({ anno, blocchi: { ce: e.ce || null, sp: e.sp || null, rf: e.rf || null } });
    });
    if (!record.length) return;
    /* Parametri compilati in Redditività e solvibilità (per anno) dell'azienda
       principale: valgono per lei sola. Si prende l'ultimo esercizio intero. */
    let parametriAnalisi = null;
    let mercatoAnalisi = null;
    if (chiave === "principale" && par && typeof par === "object") {
      const perAnno = par.perAnno && typeof par.perAnno === "object" ? par.perAnno : {};
      const interi = Object.keys(perAnno).filter((k) => /^\d{4}$/.test(k)).sort();
      const ultimo = interi[interi.length - 1] || null;
      const campi = ultimo ? perAnno[ultimo] || {} : {};
      /* Le celle che Redditività riempie da sola copiando lo Stato Patrimoniale
         (par.autoDaSP) non sono dati di mercato: «valore di mercato dell'equity»
         copiato dal patrimonio netto contabile non è la capitalizzazione. */
      const copiati = (ultimo && par.autoDaSP?.[ultimo]) || {};
      const daSP = (k) => copiati[k] != null && String(copiati[k]) === String(campi[k]);
      parametriAnalisi = {
        anno: ultimo ? Number(ultimo) : null,
        campi: Object.fromEntries(Object.entries(campi).filter(([, v]) => v !== "" && v !== null && v !== undefined && typeof v !== "object")),
        copiatiDaSP: Object.keys(campi).filter(daSP),
        aliquota: num(par.aliquota),
        wacc: isNum(num(par.wacc)) ? (num(par.wacc) > 1 ? num(par.wacc) / 100 : num(par.wacc)) : null,
        capm: par.capm && typeof par.capm === "object" ? par.capm : null,
      };
      const cap = (daSP("equityMercato") ? null : num(campi.equityMercato)) ?? num(campi.capitalizzazione);
      mercatoAnalisi = {
        capitalizzazione: isNum(cap) && cap > 0 ? cap : null,
        prezzoAzione: num(campi.prezzoAzione) ?? null,
        numeroAzioni: num(campi.numeroAzioni) ?? null,
      };
    }
    contributi.push({
      parametriAnalisi,
      mercatoAnalisi,
      nome: impresa?.nome || impresa?.azienda || (chiave === "principale" ? obj?.azienda : null) || chiave,
      meta: {
        azienda: impresa?.nome || null,
        valuta: impresa?.meta?.valuta || null,
        unita: impresa?.meta?.unita || null,
        schema: impresa?.meta?.schema || null,
        // L'aliquota nominale sta nei parametri dell'analisi, non nell'impresa.
        aliquota: chiave === "principale" ? num(par?.aliquota) : null,
      },
      record,
      // Il WACC dei parametri vale per l'azienda principale dell'analisi.
      wacc: chiave === "principale" && isNum(num(par?.wacc)) ? (num(par.wacc) > 1 ? num(par.wacc) / 100 : num(par.wacc)) : null,
    });
  });

  return contributi;
}

/**
 * «proforma-dcf/1.0»: interessano l'Enterprise Value, il WACC e il valore per
 * azione. Il DCF porta anche lo storico, che viene raccolto quando c'è: un
 * file solo può quindi bastare a popolare un'azienda intera.
 */
function estraiDaDcf(obj) {
  const val = obj?.valutazione || {};
  const cc = val.costoCapitale || {};
  const record = [];
  const storico = obj?.storico?.esercizi;
  if (storico && typeof storico === "object") {
    Object.keys(storico).forEach((k) => {
      // Solo esercizi interi: un periodo TTM («2025.5») non deve finire sopra il 2025.
      if (!/^\s*(19|20)\d{2}\s*$/.test(String(k))) return;
      const anno = annoDa(k);
      if (!anno) return;
      const e = storico[k] || {};
      record.push({ anno, blocchi: { ce: e.ce || null, sp: e.sp || null, rf: e.rf || null } });
    });
  }
  const av = obj?.assumption?.valutazione || {};
  const qc = obj?.qualitaContabile || {};
  const azioni = num(av.numeroAzioni);
  const prezzo = num(av.prezzoMercatoAzione);
  const vpa = num(val.valorePerAzione);
  const cambio = num(av.cambioEur) ?? num(val.cambioEur);
  const giudizio = isNum(prezzo) && isNum(vpa) && vpa > 0 && prezzo > 0
    ? (vpa / prezzo - 1 > 0.1 ? "BUY" : vpa / prezzo - 1 < -0.1 ? "SELL" : "HOLD") : null;
  return {
    nome: obj?.azienda || null,
    meta: {
      azienda: obj?.azienda || null,
      valuta: obj?.meta?.valuta || null,
      unita: obj?.meta?.unita || null,
      schema: obj?.meta?.schema || null,
      aliquota: num(obj?.assumption?.aliquota),
    },
    record,
    dcf: {
      enterpriseValue: num(val.enterpriseValue),
      equityValue: num(val.equityAssetSide) ?? num(val.equityEquitySide),
      valorePerAzione: num(val.valorePerAzione),
      prezzoMercatoAzione: num(obj?.assumption?.valutazione?.prezzoMercatoAzione),
      wacc: num(cc.wacc),
      ke: num(cc.ke),
      annoBase: annoDa(obj?.meta?.annoBase),
      // Tutto il resto della valutazione, per la scheda azienda e l'esportazione.
      periodoBase: obj?.meta?.annoBase ?? null,
      orizzonte: num(obj?.meta?.orizzonte) ?? num(obj?.assumption?.orizzonte),
      equityAssetSide: num(val.equityAssetSide),
      equityEquitySide: num(val.equityEquitySide),
      divergenza: num(val.divergenza),
      pfnIniziale: num(val.pfnIniziale),
      vaEsplicito: num(val.vaEsplicitoAsset),
      vaTerminal: num(val.vaTerminalAsset),
      pesoTerminal: num(val.pesoTerminal),
      gRichiesto: num(av.gTerminal),
      gUtilizzato: num(val.gUtilizzato),
      gSostenibile: num(val.gSostenibile),
      kdLordo: num(cc.kdLordo),
      kdNetto: num(cc.kdNetto),
      betaLevered: num(cc.betaLevered),
      betaUnlevered: num(cc.betaUnlevered),
      pesoEquity: num(cc.pesoEquity),
      pesoDebito: num(cc.pesoDebito),
      rf: num(av.rf),
      erp: num(av.erp),
      spreadInformativo: num(av.spreadInformativo),
      trustScore: num(qc.trustScore),
      numeroAzioni: azioni,
      capitalizzazione: isNum(prezzo) && isNum(azioni) ? prezzo * azioni : null,
      cambioEur: cambio,
      valorePerAzioneEur: isNum(vpa) && isNum(cambio) && cambio > 0 ? vpa / cambio : null,
      prezzoEur: isNum(prezzo) && isNum(cambio) && cambio > 0 ? prezzo / cambio : null,
      upside: isNum(prezzo) && isNum(vpa) && prezzo > 0 ? vpa / prezzo - 1 : null,
      giudizio,
      avvisi: [...(obj?.statoApplicazione?.avvisiValutazione || [])].slice(0, 6),
    },
  };
}

/** Livelli di gravità dei moduli QoE, dal più grave al neutro. */
const GRAVITA = { critico: 3, alto: 3, attenzione: 2, medio: 2, presidiato: 1, basso: 1, non_determinabile: 0 };

/**
 * Salvataggio di Quality of Earnings. Interessano il punteggio complessivo e
 * il conteggio delle direttrici in stato critico: sono le «bandiere rosse» che
 * il framework chiede di penalizzare pesantemente.
 */
function estraiDaQoe(obj) {
  /* Il salvataggio unificato di QoE (formato della suite) porta le risultanze
     dentro «fase1»; i salvataggi di sola Fase 1 le portano in cima. */
  const ris = obj?.risultanzeRischio || obj?.fase1?.risultanzeRischio || obj?.statoApplicazione?.esiti || {};
  const moduli = Array.isArray(ris.moduli) ? ris.moduli : [];
  let redFlag = 0;
  const dettaglio = [];
  moduli.forEach((m) => {
    const liv = slug(m?.livello || "");
    const peso = GRAVITA[liv] ?? 0;
    if (peso >= 3) redFlag += 1;
    dettaglio.push({ modulo: m?.modulo || null, titolo: m?.titolo || null, livello: m?.livello || null });
    if (Array.isArray(m?.direttrici)) {
      m.direttrici.forEach((d) => {
        const l = slug(d?.livello || "");
        if ((GRAVITA[l] ?? 0) >= 3) redFlag += 1;
      });
    }
  });
  const punteggio = num(ris?.punteggio?.valore) ?? num(ris?.punteggio?.punteggio) ?? num(ris?.punteggio) ?? num(obj?.riepilogo?.punteggioQualita) ?? null;
  return {
    nome: obj?.azienda || null,
    settore: obj?.settore || null,
    qoe: {
      punteggio,
      redFlag,
      moduli: dettaglio,
      sintesi: ris?.sintesiEsecutiva || null,
    },
  };
}

/**
 * Legge un file e restituisce i contributi che porta.
 * Ogni contributo è { nome, meta, record, dcf?, qoe?, wacc? }: un file di
 * riclassificazione ne produce uno, «analisi-bilancio» anche più di uno.
 */
export function analizzaFile(raw) {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  const tipo = rilevaTipo(obj);

  if (tipo === "ttm") {
    const err = new Error(
      "Il bilancio TTM è escluso dalla comparazione: è un anno base costruito per il DCF, " +
        "non un esercizio chiuso, e accostarlo a bilanci annuali violerebbe l'omogeneità del periodo contabile."
    );
    err.escluso = true;
    throw err;
  }

  if (tipo === "analisi") {
    const contributi = estraiDaAnalisi(obj);
    if (!contributi.length) throw new Error("Il file «analisi-bilancio» non contiene alcun esercizio leggibile.");
    return { tipo, contributi };
  }

  if (tipo === "dcf") return { tipo, contributi: [estraiDaDcf(obj)] };
  if (tipo === "qoe") return { tipo, contributi: [estraiDaQoe(obj)] };

  if (tipo === "sp" || tipo === "ce" || tipo === "rf") {
    const record = [];
    ["esercizioCorrente", "esercizioPrecedente"].forEach((k) => {
      const e = obj[k];
      if (!e) return;
      const anno = annoDa(e.esercizio);
      if (!anno) return;
      record.push({ anno, blocchi: { [tipo]: COSTRUTTORI[tipo](e) } });
    });
    if (!record.length) throw new Error("Nessun esercizio datato trovato: manca il campo «esercizio».");
    const meta = metaDa(obj);
    return { tipo, contributi: [{ nome: meta.azienda, meta, record }] };
  }

  const record = parserSemplice(obj);
  if (!record.length) throw new Error("Formato non riconosciuto e nessun esercizio deducibile dal contenuto.");
  return { tipo: "semplice", contributi: [{ nome: metaDa(obj).azienda, meta: metaDa(obj), record }] };
}

/** Merge incrementale: aggiunge blocchi senza cancellare i moduli già presenti. */
export function fondiRecord(dataset, record) {
  const next = { ...dataset };
  record.forEach(({ anno, blocchi }) => {
    const esistente = next[anno] || { ce: {}, sp: {}, rf: {}, presenti: {} };
    const presenti = { ...esistente.presenti };
    const agg = { ...esistente };
    Object.entries(blocchi || {}).forEach(([k, v]) => {
      if (!v) return;
      agg[k] = { ...(esistente[k] || {}), ...v };
      if (Object.values(v).some(isNum)) presenti[k] = true;
    });
    next[anno] = { ...agg, presenti };
  });
  return next;
}

/**
 * Chiave di raggruppamento di un'azienda a partire dal nome dichiarato nel
 * JSON. Normalizza maiuscole, forma societaria e punteggiatura: «ALFA S.p.A.»,
 * «Alfa SpA» e «alfa s.p.a.» devono finire nello stesso gruppo, altrimenti la
 * stessa azienda comparirebbe tre volte nella griglia.
 */
export function chiaveAzienda(nome) {
  const base = String(nome ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?s?\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?c\.?a\.?r\.?l\.?|societa|spa|srl|plc|ltd|gmbh|inc|corp|nv|ag|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return base || null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   [4] NORMALIZZAZIONI — i presupposti della comparazione (§7.2)
   ═══════════════════════════════════════════════════════════════════════════
   «Non si possono mischiare mele con pere»: prima di confrontare qualsiasi
   numero, i bilanci devono parlare la stessa lingua. Qui si trattano le tre
   omogeneità che sono meccanizzabili — scala, valuta e potere d'acquisto — e
   si segnalano quelle che non lo sono (schemi e criteri di stima diversi).
   ─────────────────────────────────────────────────────────────────────────── */

const SCALE = { unita: 1, unità: 1, euro: 1, migliaia: 1e3, mgl: 1e3, k: 1e3, milioni: 1e6, mln: 1e6, m: 1e6, miliardi: 1e9 };

export const fattoreScala = (unita) => {
  const s = slug(unita);
  if (!s) return 1;
  for (const [k, v] of Object.entries(SCALE)) if (slug(k) === s) return v;
  return 1;
};

/** Applica un fattore moltiplicativo a tutti gli importi di un esercizio.
    `presenti` non è un importo e va ricopiato tale e quale. */
function scalaEsercizio(e, fattore) {
  if (!e || fattore === 1) return e;
  const out = { presenti: e.presenti };
  ["ce", "sp", "rf"].forEach((b) => {
    if (!e[b]) return;
    out[b] = Object.fromEntries(
      Object.entries(e[b]).map(([k, v]) => [k, isNum(v) ? v * fattore : v])
    );
  });
  return out;
}

/**
 * Porta un'azienda alla scala e alla valuta di confronto e, se richiesto, ne
 * deflaziona gli importi al potere d'acquisto dell'anno base.
 *
 * Il deflazionamento non è un vezzo: come mostra l'esempio Hera del §7.5, una
 * crescita nominale del +3% può nascondere una crescita reale nulla. Si applica
 * però solo dove ha senso — sui valori assoluti — e i rapporti restano identici
 * perché numeratore e denominatore vengono deflazionati insieme.
 */
export function normalizzaAzienda(azienda, norm) {
  const esercizi = azienda.esercizi || {};
  const fattoreUnita = fattoreScala(azienda.meta?.unita) / fattoreScala(norm.unitaTarget);
  const out = {};
  const avvisi = [];

  const valutaAz = (azienda.meta?.valuta || "").toUpperCase();
  const valutaTg = (norm.valutaTarget || "").toUpperCase();
  const serveCambio = valutaAz && valutaTg && valutaAz !== valutaTg;

  Object.keys(esercizi).forEach((k) => {
    const anno = Number(k);
    let fattore = fattoreUnita;

    if (serveCambio) {
      const tasso = num(norm.cambi?.[azienda.chiave]?.[anno]) ?? num(norm.cambi?.[azienda.chiave]?.default);
      if (isNum(tasso) && tasso > 0) fattore *= tasso;
      else avvisi.push(`Cambio ${valutaAz}→${valutaTg} mancante per l'esercizio ${anno}: i valori restano in ${valutaAz}.`);
    }

    if (norm.ipcAttivo) {
      const ipcAnno = num(norm.ipc?.[anno]);
      const ipcBase = num(norm.ipc?.[norm.annoBaseIpc]);
      if (isNum(ipcAnno) && isNum(ipcBase) && ipcAnno > 0) fattore *= ipcBase / ipcAnno;
      else if (anno !== norm.annoBaseIpc)
        avvisi.push(`Indice IPC mancante per l'esercizio ${anno}: i valori restano nominali.`);
    }

    out[anno] = scalaEsercizio(esercizi[anno], fattore);
  });

  return { ...azienda, esercizi: out, avvisiNorm: avvisi };
}

/**
 * Patrimonio netto tangibile: PN al netto degli immateriali (§7.2, restatement).
 * Rende comparabile chi è cresciuto per acquisizioni con chi è cresciuto per
 * linee interne, e alimenta la lettura del rischio impairment del pilastro 5.
 */
export const pnTangibile = (sp) => {
  if (!isNum(sp?.patrimonioNetto)) return null;
  return sp.patrimonioNetto - (isNum(sp.immateriali) ? sp.immateriali : 0);
};

/**
 * Verifica l'allineamento degli esercizi fra le aziende caricate. Non blocca
 * il confronto — sarebbe eccessivo con dati di provenienza eterogenea — ma
 * marca gli anni in cui non tutte le aziende sono presenti, perché una colonna
 * con quattro aziende su otto ha quartili che valgono poco.
 */
export function verificaAllineamento(aziende) {
  const lista = Object.values(aziende);
  const anni = new Set();
  lista.forEach((a) => Object.keys(a.esercizi || {}).forEach((k) => anni.add(Number(k))));
  const ordinati = [...anni].sort((a, b) => b - a);
  return ordinati.map((anno) => {
    const presenti = lista.filter((a) => a.esercizi?.[anno]).map((a) => a.chiave);
    return {
      anno,
      presenti,
      mancanti: lista.filter((a) => !a.esercizi?.[anno]).map((a) => a.nome),
      completo: presenti.length === lista.length && lista.length > 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   [5] IL CATALOGO DELLE METRICHE — i sei pilastri
   ═══════════════════════════════════════════════════════════════════════════
   Ogni metrica dichiara: a quale pilastro appartiene, in che unità si esprime,
   in quale verso è «meglio» (alto, basso, o dentro una banda), quale soglia
   teorica del §7.15 la governa, la formula in chiaro e la funzione di calcolo.
   Il verso è il perno di tutto: da lì discendono il colore della cella, il
   punteggio e la classifica.
   ─────────────────────────────────────────────────────────────────────────── */

export const PILASTRI = [
  { id: "quality", n: 1, titolo: "Qualità operativa e generazione di cassa", breve: "Qualità", accento: GREEN,
    scopo: "Individuare chi ha un reale vantaggio competitivo e la struttura di costi più efficiente." },
  { id: "earnings", n: 2, titolo: "Forensic accounting e qualità degli utili", breve: "Earnings Q.", accento: PURPLE,
    scopo: "Scovare anomalie contabili, earnings management e utili non sorretti da cassa." },
  { id: "solvency", n: 3, titolo: "Struttura del capitale e rischio", breve: "Solvibilità", accento: BLUE,
    scopo: "Verificare che l'eccellenza non sia vulnerabile a shock o a strette creditizie." },
  { id: "pricing", n: 4, titolo: "Valutazione relativa", breve: "Pricing", accento: AMBER,
    scopo: "Solo dopo aver accertato qualità e veridicità dei numeri, si valuta il prezzo." },
  { id: "capital", n: 5, titolo: "Governance e allocazione del capitale", breve: "Capital all.", accento: INK,
    scopo: "Misurare l'efficienza manageriale nel reinvestire la cassa prodotta." },
  { id: "value", n: 6, titolo: "Valore intrinseco e margine di sicurezza", breve: "DCF vs prezzo", accento: TEAL,
    scopo: "Confrontare il valore calcolato col DCF e il prezzo che il mercato chiede oggi, per dire quale azione è la più conveniente." },
];

/* Aliquota nominale di riferimento quando il file non la dichiara: IRES+IRAP
   ordinaria italiana. È un default dichiarato, non un dato: la scheda azienda
   permette di sovrascriverlo. */
const ALIQUOTA_DEFAULT = 0.279;

/** Tasso d'imposta effettivo, letto dal conto economico e non dal nominale. */
const taxEffettivo = (ce) => {
  const rai = ce?.risultatoAnteImposte;
  const imp = ce?.imposte;
  if (!isNum(rai) || !isNum(imp) || rai === 0) return null;
  // Un RAI negativo rende il rapporto privo di significato economico.
  if (rai < 0) return null;
  return Math.abs(imp) / rai;
};

/** NOPAT sul reddito della sola gestione caratteristica. */
const nopat = (ctx) => {
  const mon = ctx.ce?.mon ?? ctx.ce?.ebit;
  if (!isNum(mon)) return null;
  const t = taxEffettivo(ctx.ce) ?? ctx.meta?.aliquota ?? ALIQUOTA_DEFAULT;
  const aliq = isNum(t) ? Math.min(Math.max(t, 0), 0.75) : ALIQUOTA_DEFAULT;
  return mon * (1 - aliq);
};

/** Capitale operativo investito netto medio fra apertura e chiusura. */
const coinMedio = (ctx) => media(ctx.sp?.coin, ctx.prec?.sp?.coin);

/** Costi esterni: denominatore delle rotazioni del ciclo del circolante. */
const costiEsterni = (ce) => {
  const v = somma(
    isNum(ce?.costoVenduto) ? Math.abs(ce.costoVenduto) : null,
    isNum(ce?.costiServizi) ? Math.abs(ce.costiServizi) : null
  );
  return isNum(v) && v > 0 ? v : null;
};

/** Enterprise Value: dal mercato se c'è la capitalizzazione, dal DCF altrimenti. */
const enterpriseValue = (ctx) => {
  const cap = num(ctx.mercato?.capitalizzazione);
  const pfn = ctx.sp?.pfn;
  if (isNum(cap) && isNum(pfn)) return cap + pfn;
  if (isNum(cap)) return cap;
  return num(ctx.dcf?.enterpriseValue);
};

/* ── Pilastro 6: il valore del DCF contro il prezzo del mercato ──────────────
   Le tre funzioni che seguono cercano il confronto al massimo dettaglio
   disponibile e degradano con ordine. Il confronto per azione è il più pulito
   perché immune alla dimensione; quando manca il prezzo unitario si ripiega
   sugli aggregati di equity, che dicono la stessa cosa con più rumore. Se non
   c'è né l'uno né l'altro la metrica è NEUTRA, non zero: un DCF non caricato
   non è un titolo caro. */

/** Prezzo unitario di borsa: digitato nella scheda azienda o preso dal DCF. */
const prezzoDiMercato = (ctx) => num(ctx.mercato?.prezzoAzione) ?? num(ctx.dcf?.prezzoMercatoAzione);

/** Valore intrinseco unitario: digitato nella scheda azienda o dal DCF. */
const valoreIntrinseco = (ctx) => num(ctx.mercato?.valorePerAzione) ?? num(ctx.dcf?.valorePerAzione);

/**
 * Prezzo ÷ valore intrinseco, la grandezza da cui discendono tutte le metriche
 * del sesto pilastro. Restituisce anche da dove viene il confronto, perché un
 * rapporto per azione e uno costruito sugli aggregati non hanno la stessa
 * attendibilità e chi legge deve poterlo sapere.
 */
export function confrontoValore(ctx) {
  if (!ctx) return null;
  const prezzo = prezzoDiMercato(ctx);
  const valore = valoreIntrinseco(ctx);
  if (isNum(prezzo) && isNum(valore) && valore > 0 && prezzo > 0) {
    return { rapporto: prezzo / valore, prezzo, valore, base: "azione" };
  }
  const cap = num(ctx.mercato?.capitalizzazione);
  const eq = num(ctx.dcf?.equityValue);
  if (isNum(cap) && isNum(eq) && eq > 0 && cap > 0) {
    return { rapporto: cap / eq, prezzo: cap, valore: eq, base: "equity" };
  }
  return null;
}

const prezzoSuValore = (ctx) => confrontoValore(ctx)?.rapporto ?? null;

export const METRICHE = [
  /* ── Pilastro 1 · Qualità operativa e generazione di cassa ──────────────── */
  {
    id: "roic", pilastro: "quality", label: "ROIC", unita: "%", verso: "alto", peso: 3,
    formula: "NOPAT ÷ COIN medio — NOPAT = MON × (1 − aliquota effettiva)",
    nota: "L'indicatore definitivo dell'efficienza del business: rendimento del capitale operativo netto.",
    calcola: (ctx) => safeDiv(nopat(ctx), coinMedio(ctx)),
  },
  {
    id: "spread_roic_wacc", pilastro: "quality", label: "Spread ROIC − WACC", unita: "pp", verso: "alto", peso: 3,
    formula: "ROIC − WACC (dal DCF o digitato nella scheda azienda)",
    nota: "Un ROIC strutturalmente superiore al WACC è creazione di valore; sotto, è distruzione.",
    soglia: { tipo: "min", valore: 0, etichetta: "> 0 — sopra il costo del capitale" },
    calcola: (ctx) => {
      const roic = safeDiv(nopat(ctx), coinMedio(ctx));
      const wacc = num(ctx.wacc) ?? num(ctx.dcf?.wacc);
      if (!isNum(roic) || !isNum(wacc)) return null;
      return roic - (wacc > 1 ? wacc / 100 : wacc);
    },
  },
  {
    id: "ebitda_margin", pilastro: "quality", label: "EBITDA margin", unita: "%", verso: "alto", peso: 2,
    formula: "EBITDA ÷ ricavi",
    nota: "Chi mantiene o espande i margini durante cicli inflattivi possiede pricing power.",
    calcola: (ctx) => safeDiv(ctx.ce?.ebitda, ctx.ce?.ricavi),
  },
  {
    id: "ebit_margin", pilastro: "quality", label: "EBIT margin", unita: "%", verso: "alto", peso: 2,
    formula: "EBIT ÷ ricavi",
    nota: "A differenza dell'EBITDA sconta gli ammortamenti: penalizza correttamente i business capital intensive.",
    calcola: (ctx) => safeDiv(ctx.ce?.ebit, ctx.ce?.ricavi),
  },
  {
    id: "fcf_conversion", pilastro: "quality", label: "FCF conversion", unita: "%", verso: "alto", peso: 3,
    formula: "FCFO ÷ utile netto",
    nota: "Quanta parte dell'utile contabile diventa liquidità reale. Stabilmente ≥ 100% è ottima efficienza.",
    soglia: { tipo: "min", valore: 0.8, etichetta: "≥ 80% — l'utile si trasforma in cassa" },
    calcola: (ctx) => {
      const un = ctx.ce?.utileNetto;
      // Con un utile netto negativo il rapporto cambia segno e diventa
      // illeggibile: meglio dichiararlo non determinabile.
      if (!isNum(un) || un <= 0) return null;
      return safeDiv(ctx.rf?.fcfo, un);
    },
  },
  {
    id: "ccc", pilastro: "quality", label: "Cash Conversion Cycle", unita: "gg", verso: "basso", peso: 2,
    formula: "DSO + DIO − DPO, su crediti e debiti operativi e costi esterni",
    nota: "Chi incassa presto e paga tardi finanzia la crescita a costo zero. Approssimato sugli aggregati operativi: i crediti commerciali non sono isolati dagli altri crediti operativi.",
    calcola: (ctx) => {
      const ric = ctx.ce?.ricavi;
      const ce = costiEsterni(ctx.ce);
      const dso = safeDiv(ctx.sp?.attivitaOperativeCorrenti, ric);
      const dio = safeDiv(ctx.sp?.rimanenze, ce);
      const dpo = safeDiv(ctx.sp?.passivitaOperativeCorrenti, ce);
      if (!isNum(dso) && !isNum(dio) && !isNum(dpo)) return null;
      const v = somma(isNum(dso) ? dso : null, isNum(dio) ? dio : null);
      if (!isNum(v)) return null;
      return (v - (isNum(dpo) ? dpo : 0)) * 365;
    },
  },
  {
    id: "asset_turnover", pilastro: "quality", label: "Rotazione del capitale", unita: "x", verso: "alto", peso: 1,
    formula: "ricavi ÷ COIN",
    nota: "Il volume che l'azienda estrae da ogni euro investito: è l'asse verticale degli isoquanti.",
    calcola: (ctx) => safeDiv(ctx.ce?.ricavi, ctx.sp?.coin),
  },

  /* ── Pilastro 2 · Forensic accounting e qualità degli utili ─────────────── */
  {
    id: "accrual_ratio", pilastro: "earnings", label: "Accrual ratio", unita: "%", verso: "basso", peso: 3,
    formula: "(utile netto − FCFO) ÷ CIN medio",
    nota: "Un utile trainato da componenti non monetarie è il principale segnale d'allarme di earnings management.",
    soglia: { tipo: "max", valore: 0.05, etichetta: "≤ 5% — utile sorretto dalla cassa" },
    calcola: (ctx) => {
      const un = ctx.ce?.utileNetto;
      const fcfo = ctx.rf?.fcfo;
      if (!isNum(un) || !isNum(fcfo)) return null;
      const cin = media(ctx.sp?.capitaleInvestitoNetto, ctx.prec?.sp?.capitaleInvestitoNetto);
      return safeDiv(un - fcfo, cin);
    },
  },
  {
    id: "tax_ratio", pilastro: "earnings", label: "Tax effettivo ÷ nominale", unita: "x", verso: "banda", peso: 2,
    banda: [0.85, 1.15],
    formula: "(imposte ÷ risultato ante imposte) ÷ aliquota nominale",
    nota: "Margini netti superiori ai peer ottenuti solo con ottimizzazione fiscale aggressiva sono rischio normativo, non merito industriale.",
    calcola: (ctx) => {
      const eff = taxEffettivo(ctx.ce);
      const nom = isNum(ctx.meta?.aliquota)
        ? (ctx.meta.aliquota > 1 ? ctx.meta.aliquota / 100 : ctx.meta.aliquota)
        : ALIQUOTA_DEFAULT;
      return safeDiv(eff, nom);
    },
  },
  {
    id: "quota_capitalizzata", pilastro: "earnings", label: "Quota capitalizzata", unita: "%", verso: "basso", peso: 2,
    formula: "incrementi di immobilizzazioni per lavori interni ÷ ricavi",
    nota: "Capitalizzazioni aggressive di costi operativi gonfiano EBITDA e utile di breve. Richiede le voci di dettaglio: nei file che portano i soli aggregati resta n.d.",
    soglia: { tipo: "max", valore: 0.08, etichetta: "≤ 8% dei ricavi" },
    calcola: (ctx) => {
      const li = ctx.ce?.lavoriInterni;
      if (!isNum(li)) return null;
      return safeDiv(Math.abs(li), ctx.ce?.ricavi);
    },
  },
  {
    id: "peso_immateriali", pilastro: "earnings", label: "Immateriali ÷ PN", unita: "%", verso: "basso", peso: 2,
    formula: "immobilizzazioni immateriali ÷ patrimonio netto",
    nota: "Misura quanta parte del patrimonio è fatta di valori discrezionali. Oltre il 100% il patrimonio netto tangibile è negativo.",
    calcola: (ctx) => safeDiv(ctx.sp?.immateriali, ctx.sp?.patrimonioNetto),
  },
  {
    id: "ammortamento_ppe", pilastro: "earnings", label: "Ammortamenti ÷ PPE", unita: "%", verso: "alto", peso: 1,
    formula: "ammortamenti ÷ immobilizzazioni tecniche",
    nota: "Un tasso basso rispetto ai peer segnala vite utili allungate, cioè utili di breve periodo gonfiati.",
    calcola: (ctx) => {
      const amm = ctx.ce?.ammortamenti;
      if (!isNum(amm)) return null;
      return safeDiv(Math.abs(amm), ctx.sp?.ppe);
    },
  },
  {
    id: "qoe_score", pilastro: "earnings", label: "Quality Score (QoE)", unita: "n", verso: "alto", peso: 3,
    formula: "punteggio complessivo importato dal modulo Quality of Earnings",
    nota: "Presente solo per le aziende che sono già passate dal modulo di validazione contabile.",
    calcola: (ctx) => num(ctx.qoe?.punteggio),
  },
  {
    id: "qoe_redflag", pilastro: "earnings", label: "Red flag (QoE)", unita: "n", verso: "basso", peso: 3,
    formula: "numero di direttrici in stato critico nel modulo Quality of Earnings",
    nota: "Ogni bandiera rossa attiva una penalità sul punteggio complessivo, non solo un peggioramento della cella.",
    calcola: (ctx) => (ctx.qoe ? num(ctx.qoe.redFlag) ?? 0 : null),
  },
  {
    id: "doc_reperti", pilastro: "earnings", label: "Reperti documentali critici", unita: "n", verso: "basso", peso: 3,
    formula: "reperti in stato critico trovati dall'IA nelle note integrative e nelle relazioni del peer",
    nota: "Reverse factoring, cartolarizzazioni, leasing non capitalizzati, contenziosi, capitalizzazioni aggressive: cose che nei numeri non compaiono e che vanno cercate nei documenti. Vale solo per le aziende di cui sono stati caricati i PDF.",
    calcola: (ctx) => (ctx.documentale ? num(ctx.documentale.critici) ?? 0 : null),
  },

  /* ── Pilastro 3 · Struttura del capitale e rischio ──────────────────────── */
  {
    id: "nd_ebitda", pilastro: "solvency", label: "Net Debt ÷ EBITDA", unita: "x", verso: "basso", peso: 3,
    formula: "posizione finanziaria netta ÷ EBITDA",
    nota: "Quanti anni di margine operativo servono ad azzerare il debito netto.",
    soglia: { tipo: "max", valore: 2.5, etichetta: "< 2,5x" },
    calcola: (ctx) => {
      const eb = ctx.ce?.ebitda;
      if (!isNum(eb) || eb <= 0) return null;
      return safeDiv(ctx.sp?.pfn, eb);
    },
  },
  {
    id: "interest_coverage", pilastro: "solvency", label: "Interest coverage", unita: "x", verso: "alto", peso: 3,
    formula: "EBIT ÷ oneri finanziari",
    nota: "Il margine di sicurezza sul pagamento degli oneri finanziari.",
    soglia: { tipo: "min", valore: 5, etichetta: "> 5,0x" },
    calcola: (ctx) => {
      const of = ctx.ce?.oneriFinanziari;
      if (!isNum(of) || of <= 0) return null;
      return safeDiv(ctx.ce?.ebit, of);
    },
  },
  {
    id: "fco_oneri", pilastro: "solvency", label: "Flusso operativo ÷ oneri fin.", unita: "x", verso: "alto", peso: 2,
    formula: "flusso di cassa della gestione corrente ÷ oneri finanziari",
    nota: "L'indice teorico del §7.15: se incassi 100 dall'operatività e devi 120 di interessi, non importa cosa fa il mercato.",
    soglia: { tipo: "min", valore: 1, etichetta: "> 1,0x — soglia logica di sicurezza" },
    calcola: (ctx) => {
      const of = ctx.ce?.oneriFinanziari;
      if (!isNum(of) || of <= 0) return null;
      return safeDiv(ctx.rf?.flussoOperativo, of);
    },
  },
  {
    id: "quota_debito_breve", pilastro: "solvency", label: "Debito a breve ÷ debito tot.", unita: "%", verso: "basso", peso: 2,
    formula: "debiti finanziari a breve ÷ (breve + lungo)",
    nota: "Profilo di scadenza: la concentrazione sul breve è rischio di rifinanziamento a tassi maggiori.",
    calcola: (ctx) => {
      const b = ctx.sp?.debitiFinanziariBreve;
      const l = ctx.sp?.debitiFinanziariLungo;
      const tot = somma(b, l);
      if (!isNum(tot) || tot <= 0) return null;
      return safeDiv(b, tot);
    },
  },
  {
    id: "leverage", pilastro: "solvency", label: "PFN ÷ patrimonio netto", unita: "x", verso: "basso", peso: 2,
    formula: "posizione finanziaria netta ÷ patrimonio netto",
    nota: "Il rapporto di indebitamento classico. Con patrimonio netto negativo il valore non è determinabile.",
    soglia: { tipo: "max", valore: 1.5, etichetta: "< 1,5x" },
    calcola: (ctx) => {
      const pn = ctx.sp?.patrimonioNetto;
      if (!isNum(pn) || pn <= 0) return null;
      return safeDiv(ctx.sp?.pfn, pn);
    },
  },
  {
    id: "current_ratio", pilastro: "solvency", label: "Current ratio", unita: "x", verso: "alto", peso: 1,
    formula: "attivo circolante ÷ passivo corrente",
    nota: "Le scadenze a breve si pagano con i mezzi a breve: è il più elementare degli indici teorici.",
    soglia: { tipo: "min", valore: 1.2, etichetta: "> 1,2x" },
    calcola: (ctx) => safeDiv(ctx.sp?.attivoCircolante, ctx.sp?.passivoCorrente),
  },

  /* ── Pilastro 4 · Valutazione relativa ──────────────────────────────────── */
  {
    id: "ev_ebitda", pilastro: "pricing", label: "EV ÷ EBITDA", unita: "x", verso: "basso", peso: 3,
    formula: "(capitalizzazione + PFN) ÷ EBITDA, oppure EV del DCF",
    nota: "Neutralizza struttura del capitale e politiche fiscali: rende paragonabili aziende di paesi diversi.",
    calcola: (ctx) => {
      const eb = ctx.ce?.ebitda;
      if (!isNum(eb) || eb <= 0) return null;
      return safeDiv(enterpriseValue(ctx), eb);
    },
  },
  {
    id: "ev_ebit", pilastro: "pricing", label: "EV ÷ EBIT", unita: "x", verso: "basso", peso: 2,
    formula: "(capitalizzazione + PFN) ÷ EBIT",
    nota: "Penalizza correttamente le capital intensive, che l'EV/EBITDA fa sembrare a buon mercato.",
    calcola: (ctx) => {
      const eb = ctx.ce?.ebit;
      if (!isNum(eb) || eb <= 0) return null;
      return safeDiv(enterpriseValue(ctx), eb);
    },
  },
  {
    id: "fcf_yield", pilastro: "pricing", label: "FCF yield", unita: "%", verso: "alto", peso: 3,
    formula: "FCFO ÷ Enterprise Value",
    nota: "Il rendimento reale per chi investe. Meglio del P/E perché non è inquinato dagli accruals.",
    calcola: (ctx) => {
      const ev = enterpriseValue(ctx);
      if (!isNum(ev) || ev <= 0) return null;
      return safeDiv(ctx.rf?.fcfo, ev);
    },
  },
  {
    id: "pe", pilastro: "pricing", label: "P ÷ E", unita: "x", verso: "basso", peso: 1,
    formula: "capitalizzazione ÷ utile netto",
    nota: "Presente per completezza: da leggere solo dopo aver accertato la qualità degli utili.",
    calcola: (ctx) => {
      const un = ctx.ce?.utileNetto;
      const cap = num(ctx.mercato?.capitalizzazione);
      if (!isNum(un) || un <= 0 || !isNum(cap)) return null;
      return cap / un;
    },
  },
  {
    id: "peg", pilastro: "pricing", label: "PEG", unita: "x", verso: "basso", peso: 2,
    formula: "P/E ÷ crescita attesa in % (in assenza di stime, CAGR storico dei ricavi)",
    nota: "Un P/E di 25x è conveniente per chi cresce del 30% annuo, eccessivo per chi cresce del 5%.",
    calcola: (ctx) => {
      const un = ctx.ce?.utileNetto;
      const cap = num(ctx.mercato?.capitalizzazione);
      if (!isNum(un) || un <= 0 || !isNum(cap)) return null;
      const g = num(ctx.mercato?.crescitaAttesa) ?? ctx.serie?.cagrRicavi;
      if (!isNum(g) || g <= 0) return null;
      const gPct = g > 1 ? g : g * 100;
      return (cap / un) / gPct;
    },
  },

  /* ── Pilastro 5 · Governance e allocazione del capitale ─────────────────── */
  {
    id: "goodwill_attivo", pilastro: "capital", label: "Immateriali ÷ totale attivo", unita: "%", verso: "basso", peso: 2,
    formula: "immobilizzazioni immateriali ÷ totale attivo",
    nota: "Avviamenti ingenti da acquisizioni storiche sono esposti a impairment: la crescita organica è più solida.",
    calcola: (ctx) => safeDiv(ctx.sp?.immateriali, ctx.sp?.totaleAttivo),
  },
  {
    id: "delta_roic", pilastro: "capital", label: "Variazione ROIC", unita: "pp", verso: "alto", peso: 3,
    formula: "ROIC dell'esercizio − ROIC dell'esercizio precedente",
    nota: "Il vero test del track record M&A: se le acquisizioni non alzano il ROIC, hanno solo prodotto avviamento.",
    calcola: (ctx) => {
      const roic = safeDiv(nopat(ctx), coinMedio(ctx));
      if (!ctx.prec || !isNum(roic)) return null;
      const ctxPrec = { ...ctx, ce: ctx.prec.ce, sp: ctx.prec.sp, rf: ctx.prec.rf, prec: ctx.precPrec };
      const roicPrec = safeDiv(nopat(ctxPrec), media(ctx.prec?.sp?.coin, ctx.precPrec?.sp?.coin));
      if (!isNum(roicPrec)) return null;
      return roic - roicPrec;
    },
  },
  {
    id: "capex_ammortamenti", pilastro: "capital", label: "Capex ÷ ammortamenti", unita: "x", verso: "banda", peso: 2,
    banda: [0.9, 1.6],
    formula: "investimenti in immobilizzazioni ÷ ammortamenti",
    nota: "Sotto 1 l'azienda non rimpiazza nemmeno ciò che consuma; molto sopra, sta investendo in espansione (o capitalizzando troppo).",
    calcola: (ctx) => {
      const cap = ctx.rf?.capex;
      const amm = ctx.ce?.ammortamenti;
      if (!isNum(cap) || !isNum(amm) || amm === 0) return null;
      return Math.abs(cap) / Math.abs(amm);
    },
  },
  {
    id: "payout", pilastro: "capital", label: "Payout", unita: "%", verso: "banda", peso: 1,
    banda: [0.2, 0.6],
    formula: "dividendi distribuiti ÷ utile netto",
    nota: "Distribuire troppo affama la crescita, non distribuire nulla accumula cassa che il management potrebbe allocare male.",
    calcola: (ctx) => {
      const un = ctx.ce?.utileNetto;
      const div = ctx.rf?.dividendi;
      if (!isNum(un) || un <= 0 || !isNum(div)) return null;
      return Math.abs(div) / un;
    },
  },

  /* ── Pilastro 6 · Valore intrinseco e margine di sicurezza ──────────────── */
  {
    id: "upside_dcf", pilastro: "value", label: "Upside sul valore DCF", unita: "%", verso: "alto", peso: 3,
    formula: "valore intrinseco ÷ prezzo di mercato − 1, per azione quando c'è il prezzo unitario, altrimenti equity value DCF ÷ capitalizzazione − 1",
    nota: "Quanto il titolo dovrebbe salire per arrivare al valore che il DCF gli attribuisce. È il numero che risponde alla domanda «quale azione è più conveniente»: a parità di qualità industriale, si compra dove il divario fra valore e prezzo è più largo.",
    perche: "Il prezzo è ciò che paghi, il valore è ciò che ricevi. Un upside positivo dice che il mercato quota l'azienda sotto il valore attualizzato dei suoi flussi di cassa attesi; uno negativo dice che sta già scontando più di quanto il piano prometta. Il segno conta più del decimale: un DCF è una funzione del WACC e del tasso di crescita terminale, e cambiando quelli di un punto il numero si muove parecchio.",
    soglia: { tipo: "min", valore: 0, etichetta: "> 0 — quota sotto il valore DCF" },
    benchFisso: { q1: -0.15, mediana: 0.05, q3: 0.3 },
    calcola: (ctx) => {
      const r = prezzoSuValore(ctx);
      if (!isNum(r) || r <= 0) return null;
      return 1 / r - 1;
    },
  },
  {
    id: "margine_sicurezza", pilastro: "value", label: "Margine di sicurezza", unita: "%", verso: "alto", peso: 3,
    formula: "(valore intrinseco − prezzo di mercato) ÷ valore intrinseco",
    nota: "Lo sconto sul valore stimato. È il cuscinetto che assorbe gli errori del modello: se il DCF sbaglia del 20% e il margine di sicurezza è del 30%, l'investimento regge lo stesso.",
    perche: "Il margine di sicurezza non serve a guadagnare di più, serve a sbagliare senza rovinarsi. Un DCF è una stima costruita su assunzioni discutibili — crescita, marginalità a regime, WACC — e comprare a sconto è il modo di rendere sopportabile l'errore. Sotto il 20% il cuscinetto è troppo sottile perché l'ipotesi regga uno scenario avverso.",
    soglia: { tipo: "min", valore: 0.2, etichetta: "≥ 20% — cuscinetto sufficiente" },
    benchFisso: { q1: -0.2, mediana: 0.05, q3: 0.25 },
    calcola: (ctx) => {
      const r = prezzoSuValore(ctx);
      if (!isNum(r)) return null;
      return 1 - r;
    },
  },
  {
    id: "prezzo_su_valore", pilastro: "value", label: "Prezzo ÷ valore DCF", unita: "x", verso: "basso", peso: 2,
    formula: "prezzo di mercato ÷ valore intrinseco del DCF",
    nota: "Sotto 1 il mercato chiede meno di quanto il DCF stima; sopra 1 chiede di più. È lo stesso confronto dell'upside, letto come multiplo anziché come percentuale.",
    perche: "Il rapporto rende confrontabili aziende di dimensione diversa senza passare per gli assoluti: 0,7× vuol dire che si paga settanta centesimi per un euro di valore stimato, che sia un titolo da 3 euro o da 300. Sopra 1,3× il mercato sta scontando uno scenario migliore di quello del piano, e il rischio non è più sul valore ma sull'esecuzione.",
    soglia: { tipo: "max", valore: 1, etichetta: "≤ 1,00× — prezzo sotto il valore" },
    benchFisso: { q1: 0.75, mediana: 0.95, q3: 1.25 },
    calcola: (ctx) => prezzoSuValore(ctx),
  },
  {
    id: "ev_mercato_su_dcf", pilastro: "value", label: "EV mercato ÷ EV del DCF", unita: "x", verso: "basso", peso: 2,
    formula: "(capitalizzazione + PFN) ÷ Enterprise Value del DCF",
    nota: "Lo stesso confronto condotto sull'intera struttura del capitale anziché sul solo equity: non risente della leva e resta leggibile anche quando il patrimonio netto è sottile o negativo.",
    perche: "Due aziende con lo stesso sconto sull'equity possono avere rischi opposti se una è indebitata e l'altra no: lo sconto sull'equity di una società molto levereggiata è in buona parte un effetto della leva, non un giudizio sul business. Confrontare gli enterprise value neutralizza la struttura finanziaria e dice quanto il mercato paga l'azienda operativa in quanto tale.",
    soglia: { tipo: "max", valore: 1, etichetta: "≤ 1,00× — impresa quotata sotto il DCF" },
    benchFisso: { q1: 0.8, mediana: 1.0, q3: 1.3 },
    calcola: (ctx) => {
      const evDcf = num(ctx.dcf?.enterpriseValue);
      const cap = num(ctx.mercato?.capitalizzazione);
      if (!isNum(evDcf) || evDcf <= 0 || !isNum(cap)) return null;
      const pfn = ctx.sp?.pfn;
      const evMercato = isNum(pfn) ? cap + pfn : cap;
      return evMercato / evDcf;
    },
  },
];

export const METRICA_DI = Object.fromEntries(METRICHE.map((m) => [m.id, m]));
export const METRICHE_DEL = (pilastro) => METRICHE.filter((m) => m.pilastro === pilastro);

/* ═══════════════════════════════════════════════════════════════════════════
   [6] STATISTICA DEL PEER GROUP — quantili, non medie (§7.10-7.11)
   ═══════════════════════════════════════════════════════════════════════════
   Gli indici di bilancio hanno distribuzioni asimmetriche con code lunghe: la
   media aritmetica viene distrutta da un solo outlier o da un denominatore che
   si avvicina a zero, e la media ponderata finisce per raccontare l'andamento
   del colosso del gruppo anziché quello del settore. Si usano quindi mediana e
   quartili, dove l'azienda gigantesca «vale 1» esattamente come la più piccola.
   ─────────────────────────────────────────────────────────────────────────── */

/** Quantile con interpolazione lineare (convenzione tipo 7, come in Excel). */
export function quantile(valori, q) {
  const a = valori.filter(isNum).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  return a[base + 1] !== undefined ? a[base] + resto * (a[base + 1] - a[base]) : a[base];
}

/**
 * Distribuzione di riferimento per una metrica.
 * Con almeno tre valori validi si usano i peer effettivamente caricati; sotto
 * quella soglia i quartili interni non direbbero nulla e si ripiega sulla
 * tabella di settore, quando la metrica ne ha una.
 */
export function distribuzione(valori, fallbackSettore) {
  const validi = valori.filter(isNum);
  if (validi.length >= 3) {
    return {
      fonte: "peer",
      n: validi.length,
      q1: quantile(validi, 0.25),
      mediana: quantile(validi, 0.5),
      q3: quantile(validi, 0.75),
      min: Math.min(...validi),
      max: Math.max(...validi),
    };
  }
  if (fallbackSettore) return { fonte: "settore", n: validi.length, ...fallbackSettore };
  if (validi.length) {
    return {
      fonte: "peer",
      n: validi.length,
      q1: Math.min(...validi),
      mediana: quantile(validi, 0.5),
      q3: Math.max(...validi),
      min: Math.min(...validi),
      max: Math.max(...validi),
    };
  }
  return null;
}

/**
 * Fascia di appartenenza (0 = quarto peggiore, 3 = quarto migliore), già
 * orientata secondo il verso della metrica.
 */
export function fasciaDi(valore, dist, verso, banda) {
  if (!isNum(valore) || !dist) return null;
  if (verso === "banda") {
    if (!Array.isArray(banda)) return null;
    const [lo, hi] = banda;
    if (valore >= lo && valore <= hi) return 3;
    const ampiezza = hi - lo || 1;
    const scarto = valore < lo ? (lo - valore) / ampiezza : (valore - hi) / ampiezza;
    if (scarto <= 0.5) return 2;
    if (scarto <= 1.5) return 1;
    return 0;
  }
  const { q1, mediana, q3 } = dist;
  if (!isNum(q1) || !isNum(mediana) || !isNum(q3)) return null;
  let f;
  if (valore >= q3) f = 3;
  else if (valore >= mediana) f = 2;
  else if (valore >= q1) f = 1;
  else f = 0;
  return verso === "basso" ? 3 - f : f;
}

/**
 * Punteggio 0-100 di una singola metrica: posizione percentile nel peer group,
 * orientata secondo il verso. Con le bande il punteggio decade linearmente
 * allontanandosi dall'intervallo obiettivo.
 */
export function punteggioMetrica(valore, valori, verso, banda) {
  if (!isNum(valore)) return null;

  if (verso === "banda") {
    if (!Array.isArray(banda)) return null;
    const [lo, hi] = banda;
    if (valore >= lo && valore <= hi) return 100;
    const ampiezza = hi - lo || 1;
    const scarto = valore < lo ? (lo - valore) / ampiezza : (valore - hi) / ampiezza;
    return Math.max(0, 100 - scarto * 60);
  }

  const validi = valori.filter(isNum);
  if (validi.length < 2) return 50; // niente distribuzione: posizione neutra
  const minori = validi.filter((v) => v < valore).length;
  const pari = validi.filter((v) => v === valore).length;
  const percentile = (minori + pari / 2) / validi.length;
  const p = verso === "basso" ? 1 - percentile : percentile;
  return Math.max(0, Math.min(100, p * 100));
}

/** Verifica di una soglia teorica (§7.15). Restituisce true/false/null. */
export function rispettaSoglia(valore, soglia) {
  if (!isNum(valore) || !soglia) return null;
  return soglia.tipo === "min" ? valore >= soglia.valore : valore <= soglia.valore;
}

/* ═══════════════════════════════════════════════════════════════════════════
   [7] BENCHMARK DI SETTORE PRECARICATI
   ═══════════════════════════════════════════════════════════════════════════
   ATTENZIONE: sono ordini di grandezza indicativi, coerenti con la letteratura
   di settore, NON dati di mercato aggiornati. Servono da rete di sicurezza
   quando le aziende caricate sono meno di tre e i quartili interni non
   direbbero nulla. Il confronto sui peer effettivi ha sempre la precedenza.
   ─────────────────────────────────────────────────────────────────────────── */

export const SETTORI = {
  generico: { label: "Generico / non specificato", dist: {
    roic: { q1: 0.05, mediana: 0.09, q3: 0.15 },
    ebitda_margin: { q1: 0.08, mediana: 0.13, q3: 0.2 },
    ebit_margin: { q1: 0.04, mediana: 0.08, q3: 0.13 },
    nd_ebitda: { q1: 0.8, mediana: 2.0, q3: 3.5 },
    interest_coverage: { q1: 2.5, mediana: 6.0, q3: 14.0 },
    ccc: { q1: 30, mediana: 65, q3: 110 },
  } },
  software: { label: "Software e servizi IT", dist: {
    roic: { q1: 0.08, mediana: 0.15, q3: 0.24 },
    ebitda_margin: { q1: 0.14, mediana: 0.22, q3: 0.32 },
    ebit_margin: { q1: 0.08, mediana: 0.16, q3: 0.25 },
    nd_ebitda: { q1: 0.0, mediana: 0.8, q3: 2.0 },
    interest_coverage: { q1: 6.0, mediana: 15.0, q3: 40.0 },
    ccc: { q1: 20, mediana: 55, q3: 95 },
  } },
  machinery: { label: "Meccanica e industria", dist: {
    roic: { q1: 0.07, mediana: 0.11, q3: 0.16 },
    ebitda_margin: { q1: 0.09, mediana: 0.14, q3: 0.19 },
    ebit_margin: { q1: 0.05, mediana: 0.09, q3: 0.14 },
    nd_ebitda: { q1: 1.0, mediana: 2.2, q3: 3.6 },
    interest_coverage: { q1: 3.0, mediana: 7.0, q3: 15.0 },
    ccc: { q1: 70, mediana: 115, q3: 165 },
  } },
  retail: { label: "Retail e distribuzione", dist: {
    roic: { q1: 0.06, mediana: 0.1, q3: 0.15 },
    ebitda_margin: { q1: 0.04, mediana: 0.07, q3: 0.11 },
    ebit_margin: { q1: 0.02, mediana: 0.04, q3: 0.07 },
    nd_ebitda: { q1: 1.2, mediana: 2.6, q3: 4.2 },
    interest_coverage: { q1: 2.0, mediana: 5.0, q3: 11.0 },
    ccc: { q1: -10, mediana: 25, q3: 60 },
  } },
  food: { label: "Alimentare e bevande", dist: {
    roic: { q1: 0.06, mediana: 0.1, q3: 0.15 },
    ebitda_margin: { q1: 0.07, mediana: 0.11, q3: 0.16 },
    ebit_margin: { q1: 0.04, mediana: 0.07, q3: 0.11 },
    nd_ebitda: { q1: 1.2, mediana: 2.4, q3: 3.8 },
    interest_coverage: { q1: 2.5, mediana: 6.0, q3: 12.0 },
    ccc: { q1: 45, mediana: 85, q3: 130 },
  } },
  construction: { label: "Costruzioni e materiali", dist: {
    roic: { q1: 0.04, mediana: 0.08, q3: 0.12 },
    ebitda_margin: { q1: 0.05, mediana: 0.09, q3: 0.14 },
    ebit_margin: { q1: 0.02, mediana: 0.05, q3: 0.09 },
    nd_ebitda: { q1: 1.5, mediana: 3.0, q3: 4.8 },
    interest_coverage: { q1: 1.8, mediana: 4.0, q3: 9.0 },
    ccc: { q1: 90, mediana: 145, q3: 210 },
  } },
  utilities: { label: "Utility e reti", dist: {
    roic: { q1: 0.05, mediana: 0.065, q3: 0.08 },
    ebitda_margin: { q1: 0.15, mediana: 0.22, q3: 0.3 },
    ebit_margin: { q1: 0.08, mediana: 0.12, q3: 0.17 },
    nd_ebitda: { q1: 2.2, mediana: 3.4, q3: 4.6 },
    interest_coverage: { q1: 2.5, mediana: 4.5, q3: 8.0 },
    ccc: { q1: 20, mediana: 50, q3: 85 },
  } },
  pharma: { label: "Farmaceutico e biotech", dist: {
    roic: { q1: 0.12, mediana: 0.2, q3: 0.28 },
    ebitda_margin: { q1: 0.16, mediana: 0.25, q3: 0.35 },
    ebit_margin: { q1: 0.1, mediana: 0.18, q3: 0.28 },
    nd_ebitda: { q1: 0.3, mediana: 1.4, q3: 2.6 },
    interest_coverage: { q1: 5.0, mediana: 12.0, q3: 28.0 },
    ccc: { q1: 80, mediana: 130, q3: 185 },
  } },
  luxury: { label: "Lusso e moda", dist: {
    roic: { q1: 0.1, mediana: 0.16, q3: 0.24 },
    ebitda_margin: { q1: 0.12, mediana: 0.2, q3: 0.29 },
    ebit_margin: { q1: 0.07, mediana: 0.14, q3: 0.22 },
    nd_ebitda: { q1: 0.5, mediana: 1.6, q3: 2.9 },
    interest_coverage: { q1: 4.0, mediana: 10.0, q3: 22.0 },
    ccc: { q1: 100, mediana: 160, q3: 230 },
  } },
};

/** Fasce di fatturato per la soglia minima del §7.11. */
export const FASCE_FATTURATO = [
  { id: "micro", label: "Micro — fino a 2 mln", max: 2e6 },
  { id: "piccola", label: "Piccola — 2÷10 mln", max: 1e7 },
  { id: "media", label: "Media — 10÷50 mln", max: 5e7 },
  { id: "grande", label: "Grande — 50÷250 mln", max: 2.5e8 },
  { id: "molto_grande", label: "Molto grande — oltre 250 mln", max: Infinity },
];

/* ═══════════════════════════════════════════════════════════════════════════
   [8] PUNTEGGIO E PESI
   ═══════════════════════════════════════════════════════════════════════════
   Il metodo del framework: sistema a punti con pesi maggiori sulle metriche
   fondamentali per il settore specifico, penalizzando pesantemente chi presenta
   bandiere rosse nell'accrual ratio o nelle politiche di capitalizzazione.
   I pesi non sono nascosti: sono modificabili, mostrati, e salvati nel JSON
   esportato — un punteggio di cui non si conoscono i pesi non è riproducibile.
   ─────────────────────────────────────────────────────────────────────────── */

export const PRESET_SETTORE = {
  generico: {
    label: "Generico — equilibrato",
    pilastri: { quality: 30, earnings: 25, solvency: 25, pricing: 10, capital: 10, value: 10 },
    boost: {},
  },
  software: {
    label: "Software — margini e capitalizzazioni",
    pilastri: { quality: 32, earnings: 32, solvency: 14, pricing: 12, capital: 10, value: 10 },
    boost: { quota_capitalizzata: 3, peso_immateriali: 2, ebitda_margin: 2, ammortamento_ppe: 2 },
  },
  retail: {
    label: "Retail — rotazione e circolante",
    pilastri: { quality: 36, earnings: 20, solvency: 24, pricing: 10, capital: 10, value: 8 },
    boost: { asset_turnover: 3, ccc: 3, ebit_margin: 2 },
  },
  machinery: {
    label: "Meccanica — struttura e ciclo",
    pilastri: { quality: 30, earnings: 20, solvency: 30, pricing: 10, capital: 10, value: 10 },
    boost: { ccc: 2, nd_ebitda: 2, capex_ammortamenti: 2 },
  },
  utilities: {
    label: "Utility — solvibilità e capex",
    pilastri: { quality: 24, earnings: 18, solvency: 38, pricing: 10, capital: 10, value: 8 },
    boost: { nd_ebitda: 3, interest_coverage: 3, capex_ammortamenti: 2, quota_debito_breve: 2 },
  },
  construction: {
    label: "Costruzioni — circolante e debito",
    pilastri: { quality: 24, earnings: 24, solvency: 36, pricing: 6, capital: 10, value: 6 },
    boost: { ccc: 3, fco_oneri: 3, accrual_ratio: 2 },
  },
  pharma: {
    label: "Farmaceutico — margini e R&S",
    pilastri: { quality: 34, earnings: 28, solvency: 18, pricing: 10, capital: 10, value: 10 },
    boost: { ebitda_margin: 2, quota_capitalizzata: 3, peso_immateriali: 2 },
  },
};

/** Penalità del framework: le bandiere rosse non peggiorano una cella, tolgono punti. */
export const PENALITA = [
  {
    id: "accrual_grave", etichetta: "Accrual ratio oltre il 10%", punti: 15,
    verifica: (m) => isNum(m.accrual_ratio) && m.accrual_ratio > 0.1,
    motivo: "L'utile è trainato in misura rilevante da componenti non monetarie.",
  },
  {
    id: "accrual_alto", etichetta: "Accrual ratio fra 5% e 10%", punti: 8,
    verifica: (m) => isNum(m.accrual_ratio) && m.accrual_ratio > 0.05 && m.accrual_ratio <= 0.1,
    motivo: "Scostamento fra utile contabile e cassa oltre la soglia di sicurezza.",
  },
  {
    id: "capitalizzazioni", etichetta: "Capitalizzazioni oltre l'8% dei ricavi", punti: 8,
    verifica: (m) => isNum(m.quota_capitalizzata) && m.quota_capitalizzata > 0.08,
    motivo: "Costi operativi portati a stato patrimoniale gonfiano EBITDA e utile di breve.",
  },
  {
    id: "coverage", etichetta: "Interest coverage sotto 1,0x", punti: 15,
    verifica: (m) => isNum(m.interest_coverage) && m.interest_coverage < 1,
    motivo: "Il reddito operativo non copre gli oneri finanziari.",
  },
  {
    id: "fco_oneri", etichetta: "Flusso operativo sotto gli oneri finanziari", punti: 10,
    verifica: (m) => isNum(m.fco_oneri) && m.fco_oneri < 1,
    motivo: "Violata la soglia logica del §7.15: la cassa operativa non paga gli interessi.",
  },
  {
    id: "leva", etichetta: "Net Debt ÷ EBITDA oltre 5,0x", punti: 10,
    verifica: (m) => isNum(m.nd_ebitda) && m.nd_ebitda > 5,
    motivo: "Indebitamento oltre il doppio della soglia teorica di sicurezza.",
  },
  {
    id: "redflag", etichetta: "Red flag dal modulo Quality of Earnings", punti: 5,
    perUnita: true, massimo: 20,
    verifica: (m) => isNum(m.qoe_redflag) && m.qoe_redflag > 0,
    quantita: (m) => m.qoe_redflag,
    motivo: "Direttrici in stato critico rilevate dall'analisi di qualità contabile.",
  },
  {
    id: "doc_critici", etichetta: "Reperti critici nei documenti", punti: 6,
    perUnita: true, massimo: 18,
    verifica: (m) => isNum(m.doc_reperti) && m.doc_reperti > 0,
    quantita: (m) => m.doc_reperti,
    motivo: "Anomalie trovate nelle note integrative che i soli numeri non mostrano.",
  },
];

export const PENALITA_MASSIMA = 40;

/* ═══════════════════════════════════════════════════════════════════════════
   [9] MOTORE DI CALCOLO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serie storiche di un'azienda: CAGR geometrico e numeri indice.
 * Il testo è esplicito sul punto (§7.5): la media aritmetica delle variazioni
 * può dire che stai crescendo mentre hai perso soldi. Si usa la geometrica.
 */
export function serieDi(esercizi) {
  const anni = Object.keys(esercizi || {}).map(Number).sort((a, b) => a - b);
  if (!anni.length) return null;
  const ricavi = anni.map((a) => esercizi[a]?.ce?.ricavi ?? null);
  const primo = ricavi.find(isNum);
  const ultimoIdx = [...ricavi].reverse().findIndex(isNum);
  const ultimo = ultimoIdx === -1 ? null : ricavi[ricavi.length - 1 - ultimoIdx];
  const n = anni.length - 1;

  let cagrRicavi = null;
  if (isNum(primo) && isNum(ultimo) && primo > 0 && n > 0) {
    cagrRicavi = Math.pow(ultimo / primo, 1 / n) - 1;
  }

  return {
    anni,
    cagrRicavi,
    // Numeri indice a base fissa sul primo esercizio disponibile (§7.4).
    indiceRicavi: Object.fromEntries(
      anni.map((a, i) => [a, isNum(ricavi[i]) && isNum(primo) && primo !== 0 ? (ricavi[i] / primo) * 100 : null])
    ),
  };
}

/** Contesto di calcolo per un'azienda in un dato esercizio. */
export function contestoDi(azienda, anno) {
  const es = azienda.esercizi || {};
  const anni = Object.keys(es).map(Number).sort((a, b) => b - a);
  const idx = anni.indexOf(anno);
  const corrente = es[anno];
  if (!corrente) return null;
  const prec = idx >= 0 && anni[idx + 1] !== undefined ? es[anni[idx + 1]] : null;
  const precPrec = idx >= 0 && anni[idx + 2] !== undefined ? es[anni[idx + 2]] : null;
  return {
    anno,
    ce: corrente.ce || {},
    sp: corrente.sp || {},
    rf: corrente.rf || {},
    prec,
    precPrec,
    meta: azienda.meta || {},
    mercato: azienda.mercato || {},
    dcf: azienda.dcf || null,
    qoe: azienda.qoe || null,
    documentale: azienda.documentale || null,
    wacc: azienda.wacc ?? null,
    serie: azienda.serie || null,
  };
}

/** Calcola tutte le metriche di un'azienda per un esercizio. */
export function metricheDi(azienda, anno) {
  const ctx = contestoDi(azienda, anno);
  if (!ctx) return null;
  const out = {};
  METRICHE.forEach((m) => {
    let v = null;
    try {
      v = m.calcola(ctx);
    } catch (e) {
      v = null;
    }
    out[m.id] = isNum(v) ? v : null;
  });
  return out;
}

/**
 * Costruisce l'intera comparazione per un esercizio: metriche di tutte le
 * aziende, distribuzioni, fasce, punteggi di metrica, di pilastro e finali.
 *
 * Le metriche non determinabili sono NEUTRE: non entrano nella media del
 * pilastro e non penalizzano. Una cella vuota è un'informazione mancante, non
 * un giudizio negativo — trattarla come uno zero falserebbe la classifica in
 * favore di chi ha caricato più file.
 */
export function costruisciComparazione({ aziende, anno, pesi, settoreBench }) {
  const lista = Object.values(aziende).filter((a) => a.esercizi?.[anno]);
  if (!lista.length) return null;

  // 1. metriche grezze
  const grezze = {};
  lista.forEach((a) => {
    grezze[a.chiave] = metricheDi(a, anno) || {};
  });

  // 2. soglia minima di fatturato: chi sta sotto resta in griglia ma esce dai
  //    quartili, per non far sporcare la statistica dalle troppo piccole (§7.11)
  const inStatistica = lista.filter((a) => !a.escludiDaStatistica);

  // 3. distribuzioni per metrica
  const dist = {};
  METRICHE.forEach((m) => {
    const valori = inStatistica.map((a) => grezze[a.chiave]?.[m.id]).filter(isNum);
    /* Le metriche di valutazione contro il DCF hanno un riferimento assoluto
       (il pari valore, 1,00×) che non dipende dal settore: quando i peer sono
       troppo pochi per fare quartili si usa quello, invece di lasciare la
       cella senza colore. */
    const fb = settoreBench?.dist?.[m.id] || m.benchFisso || null;
    dist[m.id] = distribuzione(valori, fb);
  });

  // 4. celle: valore, fascia, punteggio, rispetto della soglia teorica
  const celle = {};
  lista.forEach((a) => {
    celle[a.chiave] = {};
    METRICHE.forEach((m) => {
      const v = grezze[a.chiave]?.[m.id] ?? null;
      const valoriPeer = inStatistica.map((x) => grezze[x.chiave]?.[m.id]).filter(isNum);
      celle[a.chiave][m.id] = {
        valore: v,
        fascia: fasciaDi(v, dist[m.id], m.verso, m.banda),
        punteggio: punteggioMetrica(v, valoriPeer, m.verso, m.banda),
        soglia: rispettaSoglia(v, m.soglia),
      };
    });
  });

  // 5. punteggi di pilastro e complessivo
  const esiti = {};
  lista.forEach((a) => {
    const preset = PRESET_SETTORE[pesi.preset] || PRESET_SETTORE.generico;
    const perPilastro = {};
    let copertePunt = 0;
    let totaliPunt = 0;

    PILASTRI.forEach((p) => {
      let sommaPesata = 0;
      let sommaPesi = 0;
      let coperte = 0;
      const metriche = METRICHE_DEL(p.id);
      metriche.forEach((m) => {
        totaliPunt += 1;
        const c = celle[a.chiave][m.id];
        if (!isNum(c.punteggio)) return;
        coperte += 1;
        copertePunt += 1;
        const pesoBase = pesi.metriche?.[m.id] ?? m.peso ?? 1;
        const peso = pesoBase * (preset.boost?.[m.id] ? preset.boost[m.id] : 1);
        sommaPesata += c.punteggio * peso;
        sommaPesi += peso;
      });
      perPilastro[p.id] = {
        punteggio: sommaPesi > 0 ? sommaPesata / sommaPesi : null,
        coperte,
        totali: metriche.length,
      };
    });

    // media dei pilastri, pesata, saltando quelli senza alcuna metrica
    let sp = 0;
    let spesi = 0;
    PILASTRI.forEach((p) => {
      const v = perPilastro[p.id].punteggio;
      if (!isNum(v)) return;
      const w = pesi.pilastri?.[p.id] ?? preset.pilastri[p.id] ?? 0;
      sp += v * w;
      spesi += w;
    });
    const base = spesi > 0 ? sp / spesi : null;

    // penalità
    const applicate = [];
    let totalePenalita = 0;
    PENALITA.forEach((pen) => {
      if (!pen.verifica(grezze[a.chiave] || {})) return;
      let punti = pen.punti;
      if (pen.perUnita) {
        const q = pen.quantita(grezze[a.chiave]) || 0;
        punti = Math.min(pen.punti * q, pen.massimo ?? Infinity);
      }
      applicate.push({ id: pen.id, etichetta: pen.etichetta, punti, motivo: pen.motivo });
      totalePenalita += punti;
    });
    totalePenalita = Math.min(totalePenalita, PENALITA_MASSIMA);

    esiti[a.chiave] = {
      pilastri: perPilastro,
      base,
      penalita: applicate,
      totalePenalita,
      punteggio: isNum(base) ? Math.max(0, base - totalePenalita) : null,
      copertura: totaliPunt > 0 ? copertePunt / totaliPunt : 0,
    };
  });

  // 6. classifica
  const classifica = lista
    .map((a) => ({ chiave: a.chiave, punteggio: esiti[a.chiave].punteggio }))
    .filter((x) => isNum(x.punteggio))
    .sort((a, b) => b.punteggio - a.punteggio);
  classifica.forEach((x, i) => {
    esiti[x.chiave].rango = i + 1;
  });

  return { anno, lista, grezze, dist, celle, esiti, classifica, nStatistica: inStatistica.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   [10] COMPONENTI DI INTERFACCIA
   ═══════════════════════════════════════════════════════════════════════════ */

function Badge({ tono = "info", children }) {
  const colori = {
    ok: { bg: "#E2EFE6", fg: "#14503A", bd: "#BFDBCA" },
    warn: { bg: "#FAECD8", fg: "#7A5A16", bd: "#EBD4AC" },
    bad: { bg: "#F6DEDC", fg: "#7A2A24", bd: "#E4B8B3" },
    info: { bg: "#E6ECF5", fg: "#1F3B66", bd: "#C3D0E4" },
    neutro: { bg: "#EFF0ED", fg: "#5A6159", bd: "#DDE1DA" },
  };
  const c = colori[tono] || colori.info;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, fontFamily: FONT_BODY }}
    >
      {children}
    </span>
  );
}

function Intestazione({ titolo, eyebrow, nota, azione }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        {eyebrow ? (
          <div className="text-[11px] font-bold tracking-widest uppercase mb-1" style={{ color: BLUE, fontFamily: FONT_BODY }}>
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-2xl font-extrabold leading-tight" style={{ color: INK, fontFamily: FONT_HEAD }}>
          {titolo}
        </h2>
        {nota ? (
          <p className="text-[13px] mt-1 max-w-3xl" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            {nota}
          </p>
        ) : null}
      </div>
      {azione}
    </div>
  );
}

function SectionCard({ titolo, accento = GREEN, eyebrow, toolbar, children }) {
  return (
    <section
      className="rounded-lg mb-5 overflow-hidden"
      style={{ background: CARD, border: `1px solid ${LINE}`, borderTop: `3px solid ${accento}` }}
    >
      {(titolo || toolbar) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div>
            {eyebrow ? (
              <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accento, fontFamily: FONT_BODY }}>
                {eyebrow}
              </div>
            ) : null}
            <h3 className="text-[15px] font-bold" style={{ color: INK, fontFamily: FONT_HEAD }}>
              {titolo}
            </h3>
          </div>
          {toolbar}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Dropzone({ onFile, attivo, testo, sottotesto, compatta, accento = GREEN }) {
  const [sopra, setSopra] = useState(false);
  const input = useRef(null);

  const gestisci = (files) => {
    if (!files || !files.length) return;
    [...files].forEach((f) => onFile(f));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setSopra(true);
      }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSopra(false);
        gestisci(e.dataTransfer.files);
      }}
      onClick={() => input.current?.click()}
      className={`rounded-lg text-center cursor-pointer transition-colors ${compatta ? "p-4" : "p-8"}`}
      style={{
        border: `2px dashed ${sopra ? accento : LINE}`,
        background: sopra ? "#EDF5F0" : "#FAFBF9",
        opacity: attivo ? 0.6 : 1,
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        onChange={(e) => {
          gestisci(e.target.files);
          e.target.value = "";
        }}
      />
      <div className={compatta ? "text-xl mb-1" : "text-3xl mb-2"}>📥</div>
      <div className={`font-bold ${compatta ? "text-[12.5px]" : "text-[15px]"}`} style={{ color: INK, fontFamily: FONT_HEAD }}>
        {testo}
      </div>
      <div className={`mt-1 ${compatta ? "text-[11px]" : "text-[12.5px]"}`} style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
        {sottotesto}
      </div>
    </div>
  );
}

/**
 * Un riquadro per azienda: i file trascinati qui dentro finiscono in QUESTA
 * azienda e in nessun'altra, qualunque nome dichiarino al loro interno.
 *
 * È il rimedio all'unico punto fragile del raggruppamento automatico: due
 * moduli della suite che scrivono la stessa ragione sociale in due modi —
 * «Alfa S.p.A.» e «ALFA SPA», o con una sigla diversa — producono due colonne
 * distinte, e la comparazione confronta un'azienda con la propria metà. Qui
 * l'identità la decide chi carica, non la stringa dentro al file.
 */
function RiquadroAzienda({ slot, azienda, fonti, attivo, onFile, onSvuota, onRinomina, onElimina, eliminabile }) {
  const nFile = fonti.length;
  const errori = fonti.filter((f) => f.errore).length;
  const anni = azienda ? Object.keys(azienda.esercizi || {}).map(Number).sort((a, b) => b - a) : [];
  const moduli = azienda
    ? ["ce", "sp", "rf"].filter((m) => anni.some((a) => azienda.esercizi[a]?.presenti?.[m]))
    : [];

  return (
    <div className="rounded-lg flex flex-col" style={{ background: CARD, border: `1px solid ${LINE}`, borderTop: `3px solid ${azienda ? GREEN : LINE}` }}>
      <div className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: azienda ? GREEN : "#8A917F", fontFamily: FONT_BODY }}>
            {slot.etichetta}
          </div>
          <input
            type="text"
            value={azienda?.nome ?? slot.nomeAtteso ?? ""}
            onChange={(e) => onRinomina(e.target.value)}
            placeholder="Nome dell'azienda"
            className="w-full px-1 py-0.5 rounded text-[13px] font-bold"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_HEAD, background: CARD }}
          />
        </div>
        {eliminabile ? (
          <button
            onClick={onElimina}
            title="Togli questo riquadro"
            className="text-[13px] shrink-0 px-1"
            style={{ color: "#8A917F" }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <Dropzone
          compatta
          attivo={attivo}
          onFile={onFile}
          testo="Trascina qui i JSON"
          sottotesto="di questa azienda soltanto"
        />

        {azienda ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {moduli.length ? moduli.map((m) => <Badge key={m} tono="ok">{m.toUpperCase()}</Badge>) : null}
            {azienda.dcf ? <Badge tono="info">DCF</Badge> : null}
            {azienda.qoe ? <Badge tono={azienda.qoe.redFlag > 0 ? "warn" : "ok"}>QoE</Badge> : null}
            {anni.length ? (
              <Badge tono="neutro">
                {anni.length === 1 ? anni[0] : `${anni[anni.length - 1]}–${anni[0]}`}
              </Badge>
            ) : null}
          </div>
        ) : (
          <div className="text-[11.5px]" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            Ancora vuoto. SP, CE, rendiconto, analisi-bilancio, pro-forma DCF e Quality of Earnings della stessa azienda
            vanno tutti qui.
          </div>
        )}

        {nFile ? (
          <ul className="space-y-0.5">
            {fonti.map((f) => (
              <li key={f.id} className="text-[11px] truncate" style={{ color: f.errore ? RED : "#5A6159", fontFamily: FONT_MONO }} title={f.errore || f.nome}>
                {f.errore ? "⚠ " : "· "}
                {f.nome}
              </li>
            ))}
          </ul>
        ) : null}

        {azienda || nFile ? (
          <button
            onClick={onSvuota}
            className="mt-auto px-2 py-1 rounded text-[11px] font-semibold self-start"
            style={{ border: `1px solid ${LINE}`, color: RED, background: CARD }}
          >
            Svuota il riquadro
          </button>
        ) : null}

        {errori ? (
          <div className="text-[11px]" style={{ color: RED, fontFamily: FONT_BODY }}>
            {errori} file non letto{errori === 1 ? "" : "i"}: controlla che sia un JSON prodotto dalla suite.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CampoNumero({ label, valore, onChange, suffisso, larghezza = "w-32", placeholder }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
        {label}
      </span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={valore ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${larghezza} px-2 py-1 rounded text-[13px]`}
          style={{ border: `1px solid ${LINE}`, fontFamily: FONT_MONO, color: INK }}
        />
        {suffisso ? (
          <span className="text-[11px]" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            {suffisso}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [11] FASE 0 — INGESTIONE
   ═══════════════════════════════════════════════════════════════════════════ */

const ETICHETTA_TIPO = {
  sp: "Stato patrimoniale riclassificato",
  ce: "Conto economico riclassificato",
  rf: "Rendiconto finanziario",
  analisi: "Analisi di bilancio (multi-azienda)",
  dcf: "Bilancio pro-forma e DCF",
  qoe: "Quality of Earnings",
  semplice: "JSON generico",
};

function PannelloFonti({ fonti, onRimuovi }) {
  if (!fonti.length) return null;
  return (
    <div className="space-y-1.5">
      {fonti.map((f) => (
        <div
          key={f.id}
          className="flex items-center justify-between gap-3 px-3 py-2 rounded text-[12.5px]"
          style={{ background: f.errore ? "#FDF3F2" : "#FAFBF9", border: `1px solid ${f.errore ? "#E4B8B3" : LINE}`, fontFamily: FONT_BODY }}
        >
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate" style={{ color: INK }}>
              {f.nome}
            </div>
            <div className="text-[11.5px]" style={{ color: f.errore ? RED : "#5A6159" }}>
              {f.errore
                ? f.errore
                : `${ETICHETTA_TIPO[f.tipo] || f.tipo} · ${f.aziende.join(", ")} · esercizi ${f.esercizi.join(", ") || "—"}`}
            </div>
            {f.nota ? (
              <div className="text-[11.5px] mt-0.5" style={{ color: "#7A5A16" }}>
                {f.nota}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => onRimuovi(f.id)}
            className="px-2 py-1 rounded text-[11px] font-semibold shrink-0"
            style={{ border: `1px solid ${LINE}`, color: "#5A6159", background: CARD }}
          >
            Rimuovi
          </button>
        </div>
      ))}
    </div>
  );
}

/* Quanto arriva dal DCF e da Redditività e solvibilità per questa azienda:
   i campi qui sopra lasciati vuoti usano questi valori. */
function DatiCollegati({ azienda }) {
  const d = azienda.dcf;
  const p = azienda.parametriAnalisi;
  if (!d && !p) return null;
  const v = (azienda.meta?.valuta || "").toUpperCase();
  const u = azienda.meta?.unita || "";
  const pct = (x, dec = 2) => (isNum(x) ? `${fmt(x * 100, dec)}%` : "—");
  const n = (x, dec = 0) => (isNum(x) ? fmt(x, dec) : "—");
  /* Cambio: quello scritto nel DCF, altrimenti il cambio BCE del giorno della suite. */
  let cambio = isNum(d?.cambioEur) ? d.cambioEur : null;
  let fonteCambio = cambio ? "dal DCF" : "";
  if (!cambio && v && v !== "EUR") {
    try {
      const c = typeof window !== "undefined" ? window.__suiteCambi : null;
      const r = num(c?.rates?.[v]);
      if (isNum(r) && r > 0) { cambio = r; fonteCambio = `BCE ${c.data || ""}`.trim(); }
    } catch { /* nessun cambio */ }
  }
  const inEuro = (x) => (isNum(x) && isNum(cambio) && cambio > 0 ? ` (€ ${fmt(x / cambio, 2)})` : "");
  const voce = (k, val) => (
    <div key={k} className="flex justify-between gap-2 py-0.5" style={{ borderBottom: `1px dotted ${LINE}` }}>
      <span style={{ color: "#5A6159" }}>{k}</span><span style={{ color: INK, fontWeight: 600, textAlign: "right" }}>{val}</span>
    </div>
  );
  return (
    <div className="mt-3 grid md:grid-cols-2 gap-3 text-[11.5px]" style={{ fontFamily: FONT_BODY }}>
      {d ? (
        <div className="rounded p-2" style={{ border: `1px solid ${LINE}`, background: "#F7F9FB" }}>
          <div className="font-semibold mb-1" style={{ color: INK }}>Dal DCF{d.periodoBase ? ` · base ${String(d.periodoBase).replace(".", ",")}` : ""}{d.orizzonte ? ` · ${d.orizzonte} anni` : ""}</div>
          {voce("Enterprise value", `${n(d.enterpriseValue)} ${u}`)}
          {voce("Equity (asset / equity side)", `${n(d.equityAssetSide)} / ${n(d.equityEquitySide)}`)}
          {voce("Valore per azione", isNum(d.valorePerAzione) ? `${v} ${fmt(d.valorePerAzione, 2)}${inEuro(d.valorePerAzione)}` : "—")}
          {voce("Prezzo di mercato", isNum(d.prezzoMercatoAzione) ? `${v} ${fmt(d.prezzoMercatoAzione, 2)}${inEuro(d.prezzoMercatoAzione)}` : "—")}
          {voce("Upside · giudizio", isNum(d.upside) ? `${pct(d.upside, 1)} · ${d.giudizio || "—"}` : "—")}
          {voce("Numero di azioni · capitalizzazione", `${n(d.numeroAzioni, 2)} · ${n(d.capitalizzazione)}`)}
          {voce("WACC · Ke · Kd netto", `${pct(d.wacc)} · ${pct(d.ke)} · ${pct(d.kdNetto)}`)}
          {voce("Rf · ERP · β levered", `${pct(d.rf)} · ${pct(d.erp)} · ${n(d.betaLevered, 2)}`)}
          {voce("Spread informativo · Trust Score", `${pct(d.spreadInformativo)} · ${isNum(d.trustScore) ? `${d.trustScore}/100` : "—"}`)}
          {voce("g richiesto · usato · sostenibile", `${pct(d.gRichiesto)} · ${pct(d.gUtilizzato)} · ${pct(d.gSostenibile)}`)}
          {voce("Peso del valore terminale · scarto", `${pct(d.pesoTerminal, 0)} · ${pct(d.divergenza, 1)}`)}
          {voce("Cambio (per 1 €)", isNum(cambio) ? `${fmt(cambio, 4)} ${v} · ${fonteCambio}` : "—")}
        </div>
      ) : null}
      {p ? (
        <div className="rounded p-2" style={{ border: `1px solid ${LINE}`, background: "#F7F9FB" }}>
          <div className="font-semibold mb-1" style={{ color: INK }}>Da Redditività e solvibilità{p.anno ? ` · parametri ${p.anno}` : ""}</div>
          {voce("WACC", isNum(p.wacc) ? `${fmt(p.wacc * 100, 2)}%` : "—")}
          {voce("Aliquota", isNum(p.aliquota) ? pct(p.aliquota > 1 ? p.aliquota / 100 : p.aliquota, 1) : "—")}
          {p.capm ? voce("Settore (t · D/E · leva)", `${p.capm.tSettore ?? "—"} · ${p.capm.deSettore ?? "—"} · ${p.capm.gloSettore ?? "—"}`) : null}
          {Object.entries(p.campi || {}).slice(0, 30).map(([k, val]) => voce(k, `${val}${(p.copiatiDaSP || []).includes(k) ? " (copiato dallo SP)" : ""}`))}
        </div>
      ) : null}
    </div>
  );
}

function SchedaAzienda({ azienda, onCambia, onElimina, aziende }) {
  const anni = Object.keys(azienda.esercizi || {}).map(Number).sort((a, b) => b - a);
  const ultimo = anni.length ? azienda.esercizi[anni[0]] : null;
  const ricavi = ultimo?.ce?.ricavi;
  const moduli = ["ce", "sp", "rf"].filter((m) => anni.some((a) => azienda.esercizi[a]?.presenti?.[m]));

  return (
    <div className="rounded-lg p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={azienda.nome}
            onChange={(e) => onCambia({ nome: e.target.value })}
            className="w-full px-2 py-1 rounded text-[14px] font-bold"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_HEAD }}
          />
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {moduli.length ? moduli.map((m) => <Badge key={m} tono="ok">{m.toUpperCase()}</Badge>) : <Badge tono="bad">nessun prospetto</Badge>}
            {azienda.qoe ? <Badge tono={azienda.qoe.redFlag > 0 ? "warn" : "ok"}>QoE {azienda.qoe.redFlag > 0 ? `· ${azienda.qoe.redFlag} red flag` : "· nessuna red flag"}</Badge> : null}
            {azienda.dcf ? <Badge tono="info">DCF</Badge> : null}
            <Badge tono="neutro">{anni.length} eserciz{anni.length === 1 ? "io" : "i"}</Badge>
          </div>
          <div className="text-[11.5px] mt-1.5" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            {anni.length ? `Esercizi ${anni[anni.length - 1]}–${anni[0]}` : "Nessun esercizio"}
            {isNum(ricavi) ? ` · ricavi ${fmt(ricavi, 0)} (${azienda.meta?.unita || "unità"})` : ""}
          </div>
        </div>
        <button
          onClick={onElimina}
          className="px-2 py-1 rounded text-[11px] font-semibold shrink-0"
          style={{ border: `1px solid ${LINE}`, color: RED, background: CARD }}
        >
          Elimina
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Settore
          </span>
          <select
            value={azienda.settore || "generico"}
            onChange={(e) => onCambia({ settore: e.target.value })}
            className="px-2 py-1 rounded text-[12.5px]"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY, background: CARD }}
          >
            {Object.entries(SETTORI).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Fascia di fatturato
          </span>
          <select
            value={azienda.fascia || "media"}
            onChange={(e) => onCambia({ fascia: e.target.value })}
            className="px-2 py-1 rounded text-[12.5px]"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY, background: CARD }}
          >
            {FASCE_FATTURATO.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <CampoNumero
          label="Capitalizzazione"
          valore={azienda.mercato?.capitalizzazione ?? ""}
          onChange={(v) => onCambia({ mercato: { ...azienda.mercato, capitalizzazione: v } })}
          suffisso={azienda.meta?.unita || ""}
          larghezza="w-full"
          placeholder={isNum(azienda.dcf?.capitalizzazione) ? `${fmt(azienda.dcf.capitalizzazione, 0)} dal DCF` : isNum(azienda.mercatoAnalisi?.capitalizzazione) ? `${fmt(azienda.mercatoAnalisi.capitalizzazione, 0)} da Redditività` : "pilastro 4"}
        />

        <CampoNumero
          label="WACC"
          valore={azienda.waccManuale ?? ""}
          onChange={(v) => onCambia({ waccManuale: v })}
          suffisso="%"
          larghezza="w-full"
          placeholder={isNum(azienda.dcf?.wacc) ? `${fmt(azienda.dcf.wacc * (azienda.dcf.wacc < 1 ? 100 : 1), 1)} dal DCF` : isNum(azienda.parametriAnalisi?.wacc) ? `${fmt(azienda.parametriAnalisi.wacc * 100, 2)} da Redditività` : "spread ROIC"}
        />

        {/* I due campi del sesto pilastro. Il prezzo di borsa non arriva da
            nessun bilancio: o lo porta il file DCF, o lo digita chi legge. */}
        <CampoNumero
          label="Prezzo azione"
          valore={azienda.mercato?.prezzoAzione ?? ""}
          onChange={(v) => onCambia({ mercato: { ...azienda.mercato, prezzoAzione: v } })}
          suffisso={(azienda.meta?.valuta || "EUR").toUpperCase()}
          larghezza="w-full"
          placeholder={isNum(azienda.dcf?.prezzoMercatoAzione) ? `${fmt(azienda.dcf.prezzoMercatoAzione, 2)} dal DCF` : "pilastro 6"}
        />

        <CampoNumero
          label="Valore DCF / azione"
          valore={azienda.mercato?.valorePerAzione ?? ""}
          onChange={(v) => onCambia({ mercato: { ...azienda.mercato, valorePerAzione: v } })}
          suffisso={(azienda.meta?.valuta || "EUR").toUpperCase()}
          larghezza="w-full"
          placeholder={isNum(azienda.dcf?.valorePerAzione) ? `${fmt(azienda.dcf.valorePerAzione, 2)} dal DCF` : "pilastro 6"}
        />
      </div>

      <DatiCollegati azienda={azienda} />

      <div className="mt-2 flex items-center gap-3">
        <label className="flex items-center gap-2 text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          <input
            type="checkbox"
            checked={!!azienda.escludiDaStatistica}
            onChange={(e) => onCambia({ escludiDaStatistica: e.target.checked })}
          />
          Escludi dal calcolo dei quartili (resta in griglia)
        </label>
        {aziende > 1 && azienda.escludiDaStatistica ? (
          <Badge tono="warn">fuori statistica</Badge>
        ) : null}
      </div>
    </div>
  );
}

function PannelloNormalizzazioni({ norm, onCambia, anni, aziende }) {
  const valute = [...new Set(Object.values(aziende).map((a) => (a.meta?.valuta || "").toUpperCase()).filter(Boolean))];
  const unita = [...new Set(Object.values(aziende).map((a) => a.meta?.unita).filter(Boolean))];
  const disomogeneo = valute.length > 1 || unita.length > 1;

  return (
    <div className="space-y-4">
      {disomogeneo ? (
        <div className="rounded p-3 text-[12.5px]" style={{ background: "#FAECD8", border: "1px solid #EBD4AC", color: "#7A5A16", fontFamily: FONT_BODY }}>
          <strong>Bilanci non omogenei.</strong>{" "}
          {unita.length > 1 ? `Scale diverse in ingresso: ${unita.join(", ")}. ` : ""}
          {valute.length > 1 ? `Valute diverse in ingresso: ${valute.join(", ")}. ` : ""}
          Senza la conversione la classifica non ha significato: sono mele con pere.
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Scala di confronto
          </span>
          <select
            value={norm.unitaTarget}
            onChange={(e) => onCambia({ unitaTarget: e.target.value })}
            className="px-2 py-1 rounded text-[12.5px]"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY, background: CARD }}
          >
            <option value="unita">Unità</option>
            <option value="migliaia">Migliaia</option>
            <option value="milioni">Milioni</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Valuta di confronto
          </span>
          <input
            type="text"
            value={norm.valutaTarget}
            onChange={(e) => onCambia({ valutaTarget: e.target.value.toUpperCase() })}
            className="px-2 py-1 rounded text-[12.5px]"
            style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO, background: CARD }}
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Deflazionamento IPC (§7.5)
          </span>
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!norm.ipcAttivo}
              onChange={(e) => onCambia({ ipcAttivo: e.target.checked })}
            />
            <span className="text-[12px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Riporta gli importi al potere d'acquisto dell'anno base
            </span>
            {norm.ipcAttivo ? (
              <select
                value={norm.annoBaseIpc || anni[0] || ""}
                onChange={(e) => onCambia({ annoBaseIpc: Number(e.target.value) })}
                className="px-2 py-1 rounded text-[12px]"
                style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO, background: CARD }}
              >
                {anni.map((a) => (
                  <option key={a} value={a}>
                    base {a}
                  </option>
                ))}
              </select>
            ) : null}
          </span>
        </label>
      </div>

      {norm.ipcAttivo ? (
        <div>
          <div className="text-[11.5px] mb-2" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Indice dei prezzi al consumo per esercizio. Gli anni senza indice restano nominali e vengono segnalati.
          </div>
          <div className="flex flex-wrap gap-3">
            {anni.map((a) => (
              <CampoNumero
                key={a}
                label={String(a)}
                valore={norm.ipc?.[a] ?? ""}
                onChange={(v) => onCambia({ ipc: { ...norm.ipc, [a]: v === "" ? null : num(v) } })}
                larghezza="w-24"
                placeholder="100,0"
              />
            ))}
          </div>
        </div>
      ) : null}

      {valute.length > 1 ? (
        <div>
          <div className="text-[11.5px] mb-2" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Tasso di cambio verso {norm.valutaTarget} per le aziende in valuta diversa.
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.values(aziende)
              .filter((a) => (a.meta?.valuta || "").toUpperCase() && (a.meta?.valuta || "").toUpperCase() !== norm.valutaTarget)
              .map((a) => (
                <CampoNumero
                  key={a.chiave}
                  label={`${a.nome} (${a.meta.valuta})`}
                  valore={norm.cambi?.[a.chiave]?.default ?? ""}
                  onChange={(v) =>
                    onCambia({ cambi: { ...norm.cambi, [a.chiave]: { ...(norm.cambi?.[a.chiave] || {}), default: num(v) } } })
                  }
                  larghezza="w-28"
                  placeholder="1,0000"
                />
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PannelloAllineamento({ allineamento }) {
  const problematici = allineamento.filter((a) => !a.completo);
  if (!allineamento.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {allineamento.map((a) => (
          <Badge key={a.anno} tono={a.completo ? "ok" : "warn"}>
            {a.anno} · {a.presenti.length} azienda{a.presenti.length === 1 ? "" : "e"}
          </Badge>
        ))}
      </div>
      {problematici.length ? (
        <div className="text-[12px]" style={{ color: "#7A5A16", fontFamily: FONT_BODY }}>
          Negli esercizi incompleti i quartili sono calcolati sulle sole aziende presenti: la loro solidità statistica è
          minore, e la colonna va letta con cautela.{" "}
          {problematici.slice(0, 3).map((p) => `${p.anno} manca ${p.mancanti.join(", ")}`).join("; ")}
          {problematici.length > 3 ? "…" : "."}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12] MATRICE COMPARATIVA
   ═══════════════════════════════════════════════════════════════════════════
   La griglia non è solo una tabella colorata: ogni riga e ogni cella sono
   interrogabili. Cliccando il nome di una metrica si apre la scheda che dice
   che cosa calcola e perché conta; cliccando un valore si apre il perché di
   quel colore, con i numeri del confronto in chiaro. Un colore che non sa
   spiegarsi è un colore di cui non ci si può fidare.
   ─────────────────────────────────────────────────────────────────────────── */

/** Verso della metrica detto a parole, per le spiegazioni. */
function versoInParole(metrica) {
  if (metrica.verso === "alto") return "per questa metrica sono migliori i valori alti";
  if (metrica.verso === "basso") return "per questa metrica sono migliori i valori bassi";
  if (metrica.verso === "banda" && Array.isArray(metrica.banda))
    return `per questa metrica è migliore restare fra ${formattaValore(metrica.banda[0], metrica.unita)} e ${formattaValore(metrica.banda[1], metrica.unita)}`;
  return "il verso di lettura non è definito";
}

/** Da dove vengono i riferimenti: peer effettivi o tabella di settore. */
function fonteInParole(dist) {
  if (!dist) return "Non ci sono riferimenti: nessun valore confrontabile nel gruppo.";
  if (dist.fonte === "peer")
    return `Riferimenti calcolati sui ${dist.n} peer effettivamente caricati con questo dato.`;
  return `I peer con questo dato sono ${dist.n}: troppo pochi per fare quartili, quindi il confronto usa il benchmark di settore precaricato — un ordine di grandezza, non un dato di mercato.`;
}

/**
 * Il ragionamento dietro il colore di una cella, con i numeri espliciti.
 * Restituisce anche l'obiettivo del salto di fascia successivo, perché sapere
 * quanto manca è più utile che sapere di stare male.
 */
function spiegaColore(cella, metrica, dist) {
  if (!cella || !isNum(cella.valore)) {
    return {
      fascia: null,
      confronto: "Il dato non è determinabile: manca una delle voci della formula, oppure il denominatore è nullo o di segno tale da rendere il rapporto privo di significato.",
      obiettivo: "La cella è neutra — esce dalla media del pilastro e non toglie punti. Trattarla come uno zero premierebbe chi ha caricato più file, che non è un merito industriale.",
    };
  }
  const v = cella.valore;
  const f = isNum(cella.fascia) ? FASCE[cella.fascia] : null;
  const V = (x) => formattaValore(x, metrica.unita);

  if (metrica.verso === "banda" && Array.isArray(metrica.banda)) {
    const [lo, hi] = metrica.banda;
    const dentro = v >= lo && v <= hi;
    return {
      fascia: f,
      confronto: dentro
        ? `${V(v)} cade dentro la banda obiettivo ${V(lo)} – ${V(hi)}: qui non vince chi va più in alto, vince chi sta nell'intervallo, perché sia il difetto sia l'eccesso segnalano un problema.`
        : `${V(v)} sta ${v < lo ? "sotto" : "sopra"} la banda obiettivo ${V(lo)} – ${V(hi)}. Il punteggio decade in proporzione a quanto ci si allontana dall'intervallo, non a gradini.`,
      obiettivo: dentro ? null : `Per rientrare servirebbe un valore fra ${V(lo)} e ${V(hi)}.`,
    };
  }

  if (!dist || !isNum(dist.q1) || !isNum(dist.mediana) || !isNum(dist.q3)) {
    return {
      fascia: f,
      confronto: `${V(v)} non è confrontabile: il gruppo non offre abbastanza valori validi per costruire i quartili di questa metrica.`,
      obiettivo: null,
    };
  }

  const { q1, mediana, q3 } = dist;
  const alto = metrica.verso !== "basso";
  const posizione =
    v >= q3 ? "nel quarto superiore" : v >= mediana ? "fra la mediana e il terzo quartile" : v >= q1 ? "fra il primo quartile e la mediana" : "nel quarto inferiore";

  const confronto =
    `${V(v)} si colloca ${posizione} della distribuzione del gruppo — Q1 ${V(q1)}, mediana ${V(mediana)}, Q3 ${V(q3)} — e ` +
    `${alto ? "per questa metrica sono migliori i valori alti" : "per questa metrica sono migliori i valori bassi"}: ` +
    `${alto ? "stare in alto" : "stare in basso"} vale il colore ${f ? f.giudizio.toLowerCase() : "assegnato"}.`;

  // Quanto manca per la fascia superiore, letto nel verso giusto.
  let obiettivo = null;
  const fasciaOra = cella.fascia;
  if (isNum(fasciaOra) && fasciaOra < 3) {
    const soglie = alto ? { 0: q1, 1: mediana, 2: q3 } : { 0: q3, 1: mediana, 2: q1 };
    const target = soglie[fasciaOra];
    if (isNum(target)) {
      const delta = Math.abs(target - v);
      obiettivo = `Per salire di una fascia servirebbe ${alto ? "almeno" : "al massimo"} ${V(target)}: ${V(delta)} di distanza dal valore attuale.`;
    }
  } else if (fasciaOra === 3) {
    obiettivo = "È già la fascia migliore del gruppo su questa metrica.";
  }

  return { fascia: f, confronto, obiettivo };
}

/** Riquadro chiave-valore usato nelle schede di spiegazione. */
function VoceSpiegazione({ etichetta, children, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: `1px solid ${LINE}` }}>
      <span className="text-[11.5px] shrink-0" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
        {etichetta}
      </span>
      <span className="text-[12px] font-semibold text-right" style={{ color: INK, fontFamily: mono ? FONT_MONO : FONT_BODY }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Scheda della metrica: si apre cliccando il nome nella prima colonna.
 * Dice che cosa calcola, perché conta, come viene letta e dove si collocano
 * le aziende caricate.
 */
function ModaleMetrica({ metrica, comparazione, pesi, onChiudi }) {
  if (!metrica) return null;
  const pil = PILASTRI.find((p) => p.id === metrica.pilastro);
  const dist = comparazione?.dist?.[metrica.id] || null;
  const preset = PRESET_SETTORE[pesi?.preset] || PRESET_SETTORE.generico;
  const pesoBase = pesi?.metriche?.[metrica.id] ?? metrica.peso ?? 1;
  const boost = preset.boost?.[metrica.id] || null;
  const V = (x) => formattaValore(x, metrica.unita);
  const guida = GUIDA_METRICHE[metrica.id] || null;

  const righe = (comparazione?.lista || [])
    .map((a) => ({ azienda: a, cella: comparazione.celle[a.chiave]?.[metrica.id] }))
    .sort((x, y) => {
      const vx = x.cella?.punteggio;
      const vy = y.cella?.punteggio;
      if (!isNum(vx) && !isNum(vy)) return 0;
      if (!isNum(vx)) return 1;
      if (!isNum(vy)) return -1;
      return vy - vx;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,33,61,0.55)" }} onClick={onChiudi}>
      <div
        className="rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ background: CARD, border: `1px solid ${LINE}`, borderTop: `4px solid ${pil?.accento || INK}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: pil?.accento || BLUE, fontFamily: FONT_BODY }}>
              pilastro {pil?.n} · {pil?.breve}
            </div>
            <h3 className="text-[17px] font-bold" style={{ color: INK, fontFamily: FONT_HEAD }}>
              {metrica.label}
            </h3>
          </div>
          <button onClick={onChiudi} className="px-2 py-1 text-[13px] shrink-0" style={{ color: "#5A6159" }} aria-label="Chiudi">
            ✕
          </button>
        </header>

        <div className="p-4 overflow-auto flex-1 space-y-4">
          {guida ? (
            <section className="rounded p-3 space-y-2" style={{ background: "#F4F7FB", border: `1px solid ${LINE}` }}>
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: pil?.accento || BLUE, fontFamily: FONT_BODY }}>in parole semplici</div>
                <p className="text-[14px] leading-relaxed" style={{ color: INK, fontFamily: FONT_BODY }}>{guida.semplice}</p>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: pil?.accento || BLUE, fontFamily: FONT_BODY }}>come si legge</div>
                <p className="text-[13px] leading-relaxed" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>{guida.leggere}</p>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: pil?.accento || BLUE, fontFamily: FONT_BODY }}>esempio</div>
                <p className="text-[13px] leading-relaxed" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>{guida.esempio}</p>
              </div>
              {guida.attenzione ? (
                <div>
                  <div className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: "#9A6A12", fontFamily: FONT_BODY }}>attenzione</div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "#5C4512", fontFamily: FONT_BODY }}>{guida.attenzione}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <section>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              formula
            </div>
            <div className="rounded p-2 text-[12.5px]" style={{ background: "#FAFBF9", border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO }}>
              {metrica.formula}
            </div>
          </section>

          <section>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              perché conta nel confronto
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>
              {metrica.nota}
            </p>
            {metrica.perche ? (
              <p className="text-[13px] leading-relaxed mt-2" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>
                {metrica.perche}
              </p>
            ) : null}
          </section>

          <section>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              come viene letta
            </div>
            <VoceSpiegazione etichetta="Verso">{versoInParole(metrica)}</VoceSpiegazione>
            <VoceSpiegazione etichetta="Unità">{metrica.unita === "pp" ? "punti percentuali" : metrica.unita}</VoceSpiegazione>
            <VoceSpiegazione etichetta="Peso nel pilastro" mono>
              {pesoBase}
              {boost ? ` × ${boost} (preset ${preset.label.split(" —")[0]})` : ""}
            </VoceSpiegazione>
            <VoceSpiegazione etichetta="Soglia teorica">
              {metrica.soglia ? metrica.soglia.etichetta : "nessuna — conta solo la posizione nel gruppo"}
            </VoceSpiegazione>
            <p className="text-[11.5px] mt-2" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Il punteggio (0-100) non è un voto assoluto: dice come si piazza l'azienda rispetto alle altre caricate. 100 = la migliore
              del gruppo per questa metrica, 0 = la peggiore. Con due sole aziende una prende sempre il punteggio alto e l'altra
              quello basso, anche se sono vicine: guarda anche il valore e la sua lettura. Se il valore manca la cella resta neutra.
            </p>
          </section>

          <section>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              riferimenti del gruppo
            </div>
            {dist ? (
              <>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {[
                    ["min", dist.min], ["Q1", dist.q1], ["mediana", dist.mediana], ["Q3", dist.q3], ["max", dist.max],
                  ].map(([et, val]) => (
                    <div key={et} className="rounded p-1.5" style={{ background: "#FAFBF9", border: `1px solid ${LINE}` }}>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
                        {et}
                      </div>
                      <div className="text-[12px] font-bold" style={{ color: INK, fontFamily: FONT_MONO }}>
                        {isNum(val) ? V(val) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11.5px] mt-2" style={{ color: dist.fonte === "settore" ? "#7A5A16" : "#5A6159", fontFamily: FONT_BODY }}>
                  {fonteInParole(dist)}
                </p>
              </>
            ) : (
              <p className="text-[12.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                {fonteInParole(dist)}
              </p>
            )}
          </section>

          <section>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              come stanno le aziende caricate
            </div>
            <div className="space-y-1">
              {righe.map(({ azienda, cella }) => {
                const f = isNum(cella?.fascia) ? FASCE[cella.fascia] : null;
                let frase = null;
                try { frase = guida?.frase && isNum(cella?.valore) ? guida.frase(cella.valore, V(cella.valore), azienda.nome) : null; } catch { frase = null; }
                let dati = [];
                try { dati = datiUsati(metrica.id, contestoDi(azienda, comparazione.anno)); } catch { dati = []; }
                return (
                  <div
                    key={azienda.chiave}
                    className="rounded px-2 py-1"
                    style={{ background: f ? f.sfondo : "#FAFBF9", border: `1px solid ${f ? f.bordo : LINE}` }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] font-semibold truncate" style={{ color: f ? f.testo : "#8A917F", fontFamily: FONT_BODY }}>
                        {azienda.nome}
                      </span>
                      <span className="text-[12px] font-bold shrink-0" style={{ color: f ? f.testo : "#A8AFA2", fontFamily: FONT_MONO }}>
                        {isNum(cella?.valore) ? V(cella.valore) : "n.d."}
                        {isNum(cella?.punteggio) ? <span className="font-normal"> · {fmt(cella.punteggio, 0)}/100 nel gruppo</span> : null}
                      </span>
                    </div>
                    {frase ? <div className="text-[12px] mt-0.5" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>{frase}</div> : null}
                    {!isNum(cella?.valore) ? (() => {
                      let m = null;
                      try { m = perchéMancante(metrica.id, contestoDi(azienda, comparazione.anno)); } catch { m = null; }
                      return m ? <div className="text-[12px] mt-0.5" style={{ color: "#7A5A16", fontFamily: FONT_BODY }}>{m}</div> : null;
                    })() : null}
                    {dati.length ? (
                      <div className="text-[11px] mt-0.5" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                        Dati usati ({comparazione.anno}, importi nella scala del confronto): {dati.map(([k, v]) => `${k} ${v}`).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Menu a tendina del valore: si apre cliccando una cella colorata e spiega
 * perché quel colore è favorevole, dubbio o sfavorevole. Si posiziona sotto
 * la cella cliccata, rientrando nei bordi della finestra.
 */
function TendinaCella({ apertura, onChiudi }) {
  if (!apertura) return null;
  const { cella, metrica, azienda, dist, anno, x, y } = apertura;
  let mancante = null;
  if (!isNum(cella?.valore)) { try { mancante = perchéMancante(metrica.id, contestoDi(azienda, anno)); } catch { mancante = null; } }
  const spiegazione = spiegaColore(cella, metrica, dist);
  const f = spiegazione.fascia;
  const larghezza = 380;
  const sinistra = Math.min(Math.max(12, x - larghezza / 2), Math.max(12, window.innerWidth - larghezza - 12));
  const alto = Math.min(y + 10, Math.max(12, window.innerHeight - 340));

  return (
    <div className="fixed inset-0 z-50" onClick={onChiudi}>
      <div
        className="absolute rounded-lg shadow-xl"
        style={{
          left: sinistra, top: alto, width: larghezza,
          background: CARD, border: `1px solid ${LINE}`,
          borderTop: `4px solid ${f ? f.bordo : LINE}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-widest uppercase truncate" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
              {azienda.nome}
            </div>
            <div className="text-[14px] font-bold" style={{ color: INK, fontFamily: FONT_HEAD }}>
              {metrica.label}
            </div>
          </div>
          <button onClick={onChiudi} className="text-[13px] shrink-0" style={{ color: "#5A6159" }} aria-label="Chiudi">
            ✕
          </button>
        </header>

        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[20px] font-bold" style={{ color: f ? f.testo : "#A8AFA2", fontFamily: FONT_MONO }}>
              {isNum(cella?.valore) ? formattaValore(cella.valore, metrica.unita) : "n.d."}
            </span>
            {f ? <Badge tono={f.tono}>{f.giudizio} · {f.label}</Badge> : <Badge tono="neutro">Non determinabile</Badge>}
          </div>

          {mancante ? (
            <div className="rounded p-2 text-[12.5px] leading-relaxed" style={{ background: "#FBF4E4", border: "1px solid #E8D3A0", color: "#5C4512", fontFamily: FONT_BODY }}>
              {mancante}
            </div>
          ) : null}
          {(() => {
            const g = GUIDA_METRICHE[metrica.id];
            let fr = null;
            try { fr = g?.frase && isNum(cella?.valore) ? g.frase(cella.valore, formattaValore(cella.valore, metrica.unita), azienda?.nome || "L'azienda") : null; } catch { fr = null; }
            return g ? (
              <div className="rounded p-2 text-[12.5px] leading-relaxed" style={{ background: "#F4F7FB", border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY }}>
                {fr ? <div className="font-semibold">{fr}</div> : null}
                <div className="mt-0.5" style={{ color: "#3F4A3F" }}>{g.leggere}</div>
              </div>
            ) : null;
          })()}

          <p className="text-[12.5px] leading-relaxed" style={{ color: "#3F4A3F", fontFamily: FONT_BODY }}>
            {spiegazione.confronto}
          </p>

          {f ? (
            <p className="text-[12px] leading-relaxed" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              {f.perche}
            </p>
          ) : null}

          {spiegazione.obiettivo ? (
            <div className="rounded p-2 text-[12px]" style={{ background: "#FAFBF9", border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY }}>
              {spiegazione.obiettivo}
            </div>
          ) : null}

          {metrica.soglia && cella?.soglia !== null && cella?.soglia !== undefined ? (
            <div
              className="rounded p-2 text-[12px]"
              style={{
                background: cella.soglia ? "#E2EFE6" : "#F6DEDC",
                border: `1px solid ${cella.soglia ? "#BFDBCA" : "#E4B8B3"}`,
                color: cella.soglia ? "#1E5A44" : "#7A2A24",
                fontFamily: FONT_BODY,
              }}
            >
              <strong>Soglia teorica {metrica.soglia.etichetta}:</strong> {cella.soglia ? "rispettata" : "NON rispettata"}.{" "}
              {cella.soglia
                ? "Vale a prescindere dal gruppo: anche se i concorrenti stessero peggio, questo valore reggerebbe."
                : "La soglia non dipende dal gruppo: se tutto il settore la viola, l'intero settore è esposto, e il colore del quartile non basta a rassicurare."}
            </div>
          ) : null}

          {isNum(cella?.punteggio) ? (
            <div className="text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Punteggio della cella <strong style={{ fontFamily: FONT_MONO }}>{fmt(cella.punteggio, 0)}/100</strong> — è la posizione
              percentile nel gruppo, ed è questo numero (non il colore) a entrare nella media del pilastro.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CellaMetrica({ cella, metrica, larga, onApri }) {
  /* Il click apre la tendina che spiega il colore. Si passano le coordinate
     del bersaglio e non quelle del puntatore, così la tendina esce sotto la
     cella anche quando il click arriva da tastiera. */
  const apri = (e) => {
    if (!onApri) return;
    const r = e.currentTarget.getBoundingClientRect();
    onApri({ x: r.left + r.width / 2, y: r.bottom });
  };
  const tastiera = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      apri(e);
    }
  };

  if (!cella || !isNum(cella.valore)) {
    return (
      <td
        className="px-2 py-1.5 text-center text-[12px] cursor-pointer"
        style={{ border: `1px solid ${LINE}`, color: "#A8AFA2", background: "#FAFBF9", fontFamily: FONT_MONO }}
        title="Non determinabile: dato assente. La cella è neutra e non entra nel punteggio. Clicca per la spiegazione."
        onClick={apri}
        onKeyDown={tastiera}
        tabIndex={0}
        role="button"
      >
        n.d.
      </td>
    );
  }
  const f = isNum(cella.fascia) ? FASCE[cella.fascia] : null;
  const violaSoglia = cella.soglia === false;
  return (
    <td
      className={`px-2 py-1.5 text-center text-[12.5px] font-semibold cursor-pointer ${larga ? "min-w-[110px]" : ""}`}
      style={{
        border: `1px solid ${violaSoglia ? "#E4B8B3" : LINE}`,
        background: f ? f.sfondo : CARD,
        color: f ? f.testo : INK,
        fontFamily: FONT_MONO,
        boxShadow: violaSoglia ? `inset 0 0 0 1px ${RED}` : undefined,
      }}
      title={
        `${metrica.label}: ${formattaValore(cella.valore, metrica.unita)}` +
        (f ? ` — ${f.giudizio}, ${f.label}` : "") +
        (metrica.soglia ? ` — soglia teorica ${metrica.soglia.etichetta}: ${violaSoglia ? "NON rispettata" : "rispettata"}` : "") +
        " · clicca per sapere perché questo colore"
      }
      onClick={apri}
      onKeyDown={tastiera}
      tabIndex={0}
      role="button"
    >
      {formattaValore(cella.valore, metrica.unita)}
      {violaSoglia ? <span style={{ color: RED }}> ⚠</span> : null}
    </td>
  );
}

function RigaPunteggio({ ordinate, etichetta, valoriDi, formato }) {
  return (
    <tr>
      <th
        className="px-3 py-2 text-left text-[12.5px] font-bold sticky left-0 z-10"
        style={{ border: `1px solid ${LINE}`, background: "#EFF0ED", color: INK, fontFamily: FONT_BODY }}
      >
        {etichetta}
      </th>
      {ordinate.map((a) => {
        const v = valoriDi(a);
        return (
          <td
            key={a.chiave}
            className="px-2 py-2 text-center text-[13px] font-bold"
            style={{ border: `1px solid ${LINE}`, background: "#EFF0ED", color: INK, fontFamily: FONT_MONO }}
          >
            {formato(v)}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Verdetto del sesto pilastro: quale titolo costa meno di quanto vale.
 * Sta sotto la matrice e non sopra di proposito — il framework vuole che la
 * convenienza si guardi soltanto dopo aver accertato qualità dei numeri e
 * solidità della struttura, mai prima.
 */
function ConvenienzaDiBorsa({ comparazione, ordinate, onMetrica }) {
  if (!comparazione) return null;
  const { celle, esiti } = comparazione;

  const righe = ordinate
    .map((a) => {
      const upside = celle[a.chiave]?.upside_dcf?.valore ?? null;
      const margine = celle[a.chiave]?.margine_sicurezza?.valore ?? null;
      const rapporto = celle[a.chiave]?.prezzo_su_valore?.valore ?? null;
      return { azienda: a, upside, margine, rapporto, punteggio: esiti[a.chiave]?.punteggio ?? null };
    })
    .filter((r) => isNum(r.upside) || isNum(r.rapporto))
    .sort((x, y) => (y.upside ?? -Infinity) - (x.upside ?? -Infinity));

  const verdetto = (r) => {
    if (!isNum(r.rapporto)) return { testo: "non determinabile", tono: "neutro" };
    if (r.rapporto <= 0.8) return { testo: "sottovalutata", tono: "ok" };
    if (r.rapporto <= 1.0) return { testo: "sconto contenuto", tono: "ok" };
    if (r.rapporto <= 1.2) return { testo: "prezzo allineato", tono: "warn" };
    return { testo: "sopravvalutata", tono: "bad" };
  };

  return (
    <SectionCard
      titolo="Convenienza di borsa — il DCF contro il prezzo"
      eyebrow="pilastro 6 · quale azione conviene"
      accento={TEAL}
    >
      {!righe.length ? (
        <div className="text-[13px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Nessun confronto possibile: serve, per almeno un'azienda, il valore intrinseco del DCF insieme al prezzo di
          mercato. Carica un file «proforma-dcf/1.0», oppure digita prezzo dell'azione e valore per azione nella scheda
          dell'azienda in Fase 0. Finché mancano, le metriche del sesto pilastro restano neutre e non tolgono punti a
          nessuno.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ fontFamily: FONT_BODY }}>
              <thead>
                <tr>
                  {["Azienda", "Prezzo ÷ valore", "Upside sul DCF", "Margine di sicurezza", "Verdetto", "Punteggio complessivo"].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider"
                      style={{ border: `1px solid ${LINE}`, background: "#F4F6F2", color: "#5A6159" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righe.map((r, i) => {
                  const v = verdetto(r);
                  return (
                    <tr key={r.azienda.chiave}>
                      <td className="px-2 py-1.5 text-[12.5px] font-semibold" style={{ border: `1px solid ${LINE}`, color: INK }}>
                        {i === 0 && isNum(r.upside) && r.upside > 0 ? (
                          <span className="mr-1.5" style={{ color: TEAL }} title="Divario fra valore e prezzo più ampio del gruppo">
                            ★
                          </span>
                        ) : null}
                        {r.azienda.nome}
                      </td>
                      <td className="px-2 py-1.5 text-[12.5px]" style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO }}>
                        {isNum(r.rapporto) ? mult(r.rapporto, 2) : "n.d."}
                      </td>
                      <td
                        className="px-2 py-1.5 text-[12.5px] font-semibold"
                        style={{ border: `1px solid ${LINE}`, color: isNum(r.upside) ? (r.upside >= 0 ? GREEN : RED) : "#A8AFA2", fontFamily: FONT_MONO }}
                      >
                        {isNum(r.upside) ? pct(r.upside, 1, true) : "n.d."}
                      </td>
                      <td className="px-2 py-1.5 text-[12.5px]" style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO }}>
                        {isNum(r.margine) ? pct(r.margine, 1, true) : "n.d."}
                      </td>
                      <td className="px-2 py-1.5" style={{ border: `1px solid ${LINE}` }}>
                        <Badge tono={v.tono}>{v.testo}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-[12.5px] font-bold" style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO }}>
                        {isNum(r.punteggio) ? `${fmt(r.punteggio, 0)}/100` : "n.d."}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[12px] mt-3 leading-relaxed" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            La riga con la stella è quella col divario più ampio fra valore stimato e prezzo richiesto: a parità di qualità
            industriale è l'azione più conveniente del gruppo. «A parità di qualità» non è una formula di cortesia — uno
            sconto largo su un'azienda con utili non sorretti da cassa non è un'occasione, è il mercato che ha già capito.
            Per questo il sesto pilastro pesa nel punteggio complessivo accanto agli altri cinque, e non al posto loro.{" "}
            {onMetrica ? (
              <button
                onClick={() => onMetrica(METRICA_DI.upside_dcf)}
                className="underline font-semibold"
                style={{ color: TEAL, fontFamily: FONT_BODY }}
              >
                Come si calcola l'upside
              </button>
            ) : null}
          </p>
        </>
      )}
    </SectionCard>
  );
}

function Matrice({ comparazione, pesi, onPesi, aziende }) {
  const [ordinaPer, setOrdinaPer] = useState("punteggio");
  const [mostraPesi, setMostraPesi] = useState(false);
  // Scheda della metrica (click sul nome) e tendina del valore (click su una cella).
  const [metricaAperta, setMetricaAperta] = useState(null);
  const [cellaAperta, setCellaAperta] = useState(null);

  /* L'ordinamento sta prima di qualunque uscita anticipata: gli hook non
     possono essere chiamati in modo condizionale, e con la comparazione ancora
     assente la lista è semplicemente vuota. */
  const ordinate = useMemo(() => {
    if (!comparazione) return [];
    const { lista, celle, esiti } = comparazione;
    const copia = [...lista];
    if (ordinaPer === "punteggio") {
      copia.sort((a, b) => (esiti[b.chiave].punteggio ?? -1) - (esiti[a.chiave].punteggio ?? -1));
    } else if (ordinaPer === "nome") {
      copia.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    } else {
      const m = METRICA_DI[ordinaPer];
      copia.sort((a, b) => {
        const va = celle[a.chiave][ordinaPer]?.valore;
        const vb = celle[b.chiave][ordinaPer]?.valore;
        if (!isNum(va) && !isNum(vb)) return 0;
        if (!isNum(va)) return 1;
        if (!isNum(vb)) return -1;
        return m.verso === "basso" ? va - vb : vb - va;
      });
    }
    return copia;
  }, [comparazione, ordinaPer]);

  if (!comparazione) return null;
  const { celle, esiti, dist } = comparazione;

  const preset = PRESET_SETTORE[pesi.preset] || PRESET_SETTORE.generico;

  return (
    <div>
      <SectionCard
        titolo="Pesi e preset di settore"
        eyebrow="come si forma il punteggio"
        accento={AMBER}
        toolbar={
          <button
            onClick={() => setMostraPesi((v) => !v)}
            className="px-3 py-1.5 rounded text-[12px] font-semibold"
            style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
          >
            {mostraPesi ? "Nascondi" : "Regola i pesi"}
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[12px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Preset
            </span>
            <select
              value={pesi.preset}
              onChange={(e) => onPesi({ ...pesi, preset: e.target.value, pilastri: { ...PRESET_SETTORE[e.target.value].pilastri } })}
              className="px-2 py-1 rounded text-[12.5px]"
              style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY, background: CARD }}
            >
              {Object.entries(PRESET_SETTORE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          {Object.keys(preset.boost || {}).length ? (
            <div className="text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Metriche rafforzate:{" "}
              {Object.entries(preset.boost)
                .map(([id, mult]) => `${METRICA_DI[id]?.label || id} ×${mult}`)
                .join(", ")}
            </div>
          ) : null}
        </div>

        {mostraPesi ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {PILASTRI.map((p) => (
              <div key={p.id} className="rounded p-2" style={{ border: `1px solid ${LINE}`, borderTop: `3px solid ${p.accento}` }}>
                <div className="text-[11.5px] font-bold mb-1" style={{ color: INK, fontFamily: FONT_BODY }}>
                  {p.n}. {p.breve}
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={pesi.pilastri?.[p.id] ?? preset.pilastri[p.id]}
                  onChange={(e) => onPesi({ ...pesi, pilastri: { ...pesi.pilastri, [p.id]: Number(e.target.value) } })}
                  className="w-full"
                />
                <div className="text-[12px] font-bold text-center" style={{ color: p.accento, fontFamily: FONT_MONO }}>
                  {pesi.pilastri?.[p.id] ?? preset.pilastri[p.id]}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        titolo="Matrice comparativa"
        eyebrow={`esercizio ${comparazione.anno} · quartili su ${comparazione.nStatistica} aziende`}
        accento={GREEN}
        toolbar={
          <label className="flex items-center gap-2">
            <span className="text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Ordina per
            </span>
            <select
              value={ordinaPer}
              onChange={(e) => setOrdinaPer(e.target.value)}
              className="px-2 py-1 rounded text-[12px]"
              style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY, background: CARD }}
            >
              <option value="punteggio">Punteggio</option>
              <option value="nome">Nome</option>
              {METRICHE.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ fontFamily: FONT_BODY }}>
            <thead>
              <tr>
                <th
                  className="px-3 py-2 text-left text-[12px] font-bold sticky left-0 z-20 min-w-[230px]"
                  style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}
                >
                  Metrica
                </th>
                {ordinate.map((a) => (
                  <th
                    key={a.chiave}
                    className="px-2 py-2 text-center text-[12px] font-bold min-w-[110px]"
                    style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}
                  >
                    <div className="truncate" title={a.nome}>
                      {a.nome}
                    </div>
                    {isNum(esiti[a.chiave].rango) ? (
                      <div className="text-[10.5px] font-normal" style={{ color: "#B9C4D6" }}>
                        {esiti[a.chiave].rango}° · copertura {pct(esiti[a.chiave].copertura, 0)}
                      </div>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PILASTRI.map((p) => {
                const metriche = METRICHE_DEL(p.id);
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <th
                        colSpan={ordinate.length + 1}
                        className="px-3 py-1.5 text-left text-[11.5px] font-bold uppercase tracking-wider"
                        style={{ border: `1px solid ${LINE}`, background: p.accento, color: "#fff" }}
                      >
                        {p.n}. {p.titolo}
                      </th>
                    </tr>
                    {metriche.map((m) => (
                      <tr key={m.id}>
                        <th
                          className="px-3 py-1.5 text-left text-[12px] font-normal sticky left-0 z-10 cursor-pointer"
                          style={{ border: `1px solid ${LINE}`, background: CARD, color: INK }}
                          title={`${m.formula}\n\n${m.nota}\n\nClicca per la scheda completa della metrica.`}
                          onClick={() => setMetricaAperta(m)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setMetricaAperta(m);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                        >
                          <span className="font-semibold" style={{ borderBottom: `1px dotted ${BLUE}` }}>
                            {m.label}
                          </span>
                          <span className="ml-1 text-[10px] align-super" style={{ color: BLUE }}>
                            ⓘ
                          </span>
                          {m.soglia ? (
                            <span className="ml-1.5 text-[10.5px]" style={{ color: BLUE }}>
                              [{m.soglia.etichetta}]
                            </span>
                          ) : null}
                          {dist[m.id]?.fonte === "settore" ? (
                            <span className="ml-1.5 text-[10.5px]" style={{ color: AMBER }}>
                              ·benchmark settore
                            </span>
                          ) : null}
                        </th>
                        {ordinate.map((a) => (
                          <CellaMetrica
                            key={a.chiave}
                            cella={celle[a.chiave][m.id]}
                            metrica={m}
                            onApri={({ x, y }) =>
                              setCellaAperta({ cella: celle[a.chiave][m.id], metrica: m, azienda: a, dist: dist[m.id], anno: comparazione?.anno, x, y })
                            }
                          />
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th
                        className="px-3 py-1.5 text-left text-[12px] font-bold sticky left-0 z-10"
                        style={{ border: `1px solid ${LINE}`, background: "#F4F6F2", color: p.accento }}
                      >
                        Punteggio pilastro {p.n}
                      </th>
                      {ordinate.map((a) => {
                        const s = esiti[a.chiave].pilastri[p.id];
                        return (
                          <td
                            key={a.chiave}
                            className="px-2 py-1.5 text-center text-[12.5px] font-bold"
                            style={{ border: `1px solid ${LINE}`, background: "#F4F6F2", color: p.accento, fontFamily: FONT_MONO }}
                            title={`${s.coperte} metriche su ${s.totali} disponibili`}
                          >
                            {isNum(s.punteggio) ? fmt(s.punteggio, 0) : "n.d."}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}

              <RigaPunteggio
                ordinate={ordinate}
                etichetta="Penalità applicate"
                valoriDi={(a) => esiti[a.chiave].totalePenalita}
                formato={(v) => (v > 0 ? `−${fmt(v, 0)}` : "—")}
              />
              <RigaPunteggio
                ordinate={ordinate}
                etichetta="PUNTEGGIO COMPLESSIVO"
                valoriDi={(a) => esiti[a.chiave].punteggio}
                formato={(v) => (isNum(v) ? `${fmt(v, 0)}/100` : "n.d.")}
              />
              <RigaPunteggio
                ordinate={ordinate}
                etichetta="Classifica"
                valoriDi={(a) => esiti[a.chiave].rango}
                formato={(v) => (isNum(v) ? `${v}°` : "—")}
              />
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4 text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          <span className="font-semibold">Legenda:</span>
          {FASCE.slice().reverse().map((f) => (
            <span key={f.id} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded" style={{ background: f.sfondo, border: `1px solid ${f.bordo}` }} />
              {f.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span style={{ color: RED }}>⚠</span> soglia teorica non rispettata
          </span>
          <span style={{ color: BLUE }}>
            Clicca il nome di una metrica per la sua scheda, e un valore per sapere perché ha quel colore.
          </span>
        </div>
      </SectionCard>

      <ConvenienzaDiBorsa comparazione={comparazione} ordinate={ordinate} onMetrica={setMetricaAperta} />

      <SectionCard titolo="Penalità e bandiere rosse" eyebrow="cosa ha tolto punti" accento={RED}>
        {ordinate.every((a) => !esiti[a.chiave].penalita.length) ? (
          <div className="text-[13px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Nessuna penalità: nessuna azienda supera le soglie di allarme su accrual ratio, capitalizzazioni, copertura
            degli oneri finanziari o leva.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ordinate
              .filter((a) => esiti[a.chiave].penalita.length)
              .map((a) => (
                <div key={a.chiave} className="rounded p-3" style={{ border: `1px solid ${LINE}` }}>
                  <div className="font-bold text-[13px] mb-1.5" style={{ color: INK, fontFamily: FONT_HEAD }}>
                    {a.nome} — {fmt(esiti[a.chiave].totalePenalita, 0)} punti
                  </div>
                  <ul className="space-y-1">
                    {esiti[a.chiave].penalita.map((p) => (
                      <li key={p.id} className="text-[12px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                        <span className="font-semibold" style={{ color: RED }}>
                          −{p.punti}
                        </span>{" "}
                        {p.etichetta} — {p.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </SectionCard>

      <ModaleMetrica metrica={metricaAperta} comparazione={comparazione} pesi={pesi} onChiudi={() => setMetricaAperta(null)} />
      <TendinaCella apertura={cellaAperta} onChiudi={() => setCellaAperta(null)} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-bis] STRUMENTI DELLA COMPARAZIONE NEL TEMPO (§7.3 – §7.6)
   ═══════════════════════════════════════════════════════════════════════════
   Una serie storica non è una linea: è un trend di fondo sporcato da ciclo,
   stagionalità ed eventi irregolari. Gli strumenti qui sotto servono a
   ripulirla — numeri indice per leggere le proporzioni, tassi medi per
   riassumerla in un numero, medie mobili e livellamento per smussarla.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Numeri indice a base fissa (§7.4-A): il primo esercizio disponibile vale 100.
 * Mostra a colpo d'occhio l'evoluzione complessiva del periodo, ma non dice se
 * la crescita è stata costante o se un crollo è stato seguito da un rimbalzo.
 */
export function baseFissa(valori) {
  const primo = valori.find(isNum);
  if (!isNum(primo) || primo === 0) return valori.map(() => null);
  return valori.map((v) => (isNum(v) ? (v / primo) * 100 : null));
}

/**
 * Numeri indice a base mobile (§7.4-B): ogni valore è rapportato a quello
 * immediatamente precedente. È l'accelerazione o la frenata anno su anno —
 * quello che la base fissa nasconde.
 */
export function baseMobile(valori) {
  return valori.map((v, i) => {
    if (i === 0) return null;
    const p = valori[i - 1];
    if (!isNum(v) || !isNum(p) || p === 0) return null;
    return (v / p - 1) * 100;
  });
}

/**
 * Tasso medio composto (§7.5). Si calcola sul primo e sull'ultimo valore
 * disponibili, non sulla media delle variazioni: con un +80% seguito da un
 * −60% la media aritmetica direbbe che stai crescendo, mentre hai perso soldi.
 */
export function cagr(valori) {
  const validi = valori.map((v, i) => ({ v, i })).filter((x) => isNum(x.v));
  if (validi.length < 2) return null;
  const primo = validi[0];
  const ultimo = validi[validi.length - 1];
  const n = ultimo.i - primo.i;
  if (n <= 0 || primo.v === 0) return null;
  const rapporto = ultimo.v / primo.v;
  // Un cambio di segno rende la radice n-esima priva di significato.
  if (rapporto <= 0) return null;
  return Math.pow(rapporto, 1 / n) - 1;
}

/** Media aritmetica semplice delle variazioni: esposta solo per contrasto col CAGR. */
export function mediaAritmeticaVariazioni(valori) {
  const var_ = baseMobile(valori).filter(isNum);
  if (!var_.length) return null;
  return var_.reduce((a, b) => a + b, 0) / var_.length / 100;
}

/**
 * Media mobile (§7.6-A). Con `ponderata` i dati più recenti pesano di più —
 * la semplice dà lo stesso peso a un dato di cinque anni fa e a quello di ieri.
 */
export function mediaMobile(valori, finestra = 3, ponderata = false) {
  return valori.map((_, i) => {
    if (i < finestra - 1) return null;
    const blocco = valori.slice(i - finestra + 1, i + 1);
    if (blocco.some((v) => !isNum(v))) return null;
    if (!ponderata) return blocco.reduce((a, b) => a + b, 0) / finestra;
    let somma = 0;
    let pesi = 0;
    blocco.forEach((v, j) => {
      const w = j + 1;
      somma += v * w;
      pesi += w;
    });
    return somma / pesi;
  });
}

/**
 * Livellamento esponenziale (§7.6-B): peso W all'ultimo dato reale, 1−W alla
 * storia precedente. W alto se si crede che l'ultimo evento cambi tutto, W
 * basso se contano i cicli lunghi.
 */
export function livellamentoEsponenziale(valori, w = 0.5) {
  let prec = null;
  return valori.map((v) => {
    if (!isNum(v)) return null;
    if (prec === null) {
      prec = v;
      return v;
    }
    prec = w * v + (1 - w) * prec;
    return prec;
  });
}

/** Grandezze assolute su cui hanno senso i numeri indice, oltre alle metriche. */
export const GRANDEZZE = [
  { id: "g_ricavi", label: "Ricavi", unita: "€", verso: "alto", leggi: (e) => e?.ce?.ricavi ?? null },
  { id: "g_ebitda", label: "EBITDA", unita: "€", verso: "alto", leggi: (e) => e?.ce?.ebitda ?? null },
  { id: "g_ebit", label: "EBIT", unita: "€", verso: "alto", leggi: (e) => e?.ce?.ebit ?? null },
  { id: "g_utile", label: "Utile netto", unita: "€", verso: "alto", leggi: (e) => e?.ce?.utileNetto ?? null },
  { id: "g_fcfo", label: "FCFO", unita: "€", verso: "alto", leggi: (e) => e?.rf?.fcfo ?? null },
  { id: "g_coin", label: "Capitale operativo investito", unita: "€", verso: "basso", leggi: (e) => e?.sp?.coin ?? null },
  { id: "g_pfn", label: "Posizione finanziaria netta", unita: "€", verso: "basso", leggi: (e) => e?.sp?.pfn ?? null },
  { id: "g_pn", label: "Patrimonio netto", unita: "€", verso: "alto", leggi: (e) => e?.sp?.patrimonioNetto ?? null },
  { id: "g_pnt", label: "Patrimonio netto tangibile", unita: "€", verso: "alto", leggi: (e) => pnTangibile(e?.sp) },
];

export const GRANDEZZA_DI = Object.fromEntries(GRANDEZZE.map((g) => [g.id, g]));

/** Risolve una voce di serie storica: metrica calcolata o grandezza assoluta. */
export function voceSerie(id) {
  return METRICA_DI[id] || GRANDEZZA_DI[id] || null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-ter] GRAFICI — SVG scritti a mano
   ═══════════════════════════════════════════════════════════════════════════
   Nessuna libreria di grafici: la suite non ne usa, e le forme necessarie qui
   (radar a sei assi, linee con banda interquartile, barre di confronto)
   sono poche e specifiche. Un SVG scritto a mano resta leggibile e non porta
   dentro un albero di dipendenze per disegnare cinque poligoni.
   ─────────────────────────────────────────────────────────────────────────── */

const COLORI_AZIENDA = ["#2E5EAA", "#1F7A5C", "#C9962B", "#B3423A", "#6D28D9", "#0E7490", "#A16207", "#4D7C0F"];

export const coloreDi = (indice) => COLORI_AZIENDA[indice % COLORI_AZIENDA.length];

/**
 * Radar a sei assi, uno per pilastro, scala 0-100.
 * Sovrapporre più aziende è il punto: il profilo di chi ha tutto sopra la
 * media si distingue a colpo d'occhio da chi eccelle su un asse solo.
 */
function Radar({ voci, lato = 300 }) {
  const cx = lato / 2;
  const cy = lato / 2 + 6;
  const R = lato * 0.34;
  const n = PILASTRI.length;
  const angolo = (i) => (-90 + (360 / n) * i) * (Math.PI / 180);
  const punto = (i, v) => {
    const a = angolo(i);
    const r = R * (Math.max(0, Math.min(100, v)) / 100);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poligono = (v) =>
    PILASTRI.map((_, i) => punto(i, isNum(v[i]) ? v[i] : 0).join(",")).join(" ");

  const griglia = [25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${lato} ${lato + 20}`} style={{ width: "100%", maxWidth: lato, height: "auto" }}>
      {griglia.map((g) => (
        <polygon
          key={g}
          points={PILASTRI.map((_, i) => punto(i, g).join(",")).join(" ")}
          fill="none"
          stroke={LINE}
          strokeWidth={g === 100 ? 1.4 : 0.8}
        />
      ))}
      {PILASTRI.map((p, i) => {
        const [x, y] = punto(i, 100);
        return <line key={p.id} x1={cx} y1={cy} x2={x} y2={y} stroke={LINE} strokeWidth="0.8" />;
      })}

      {voci.map((v) => (
        <g key={v.chiave}>
          <polygon points={poligono(v.valori)} fill={v.colore} fillOpacity="0.13" stroke={v.colore} strokeWidth="2" />
          {PILASTRI.map((p, i) => {
            if (!isNum(v.valori[i])) return null;
            const [x, y] = punto(i, v.valori[i]);
            return <circle key={p.id} cx={x} cy={y} r="3" fill={v.colore} />;
          })}
        </g>
      ))}

      {PILASTRI.map((p, i) => {
        const a = angolo(i);
        const x = cx + (R + 26) * Math.cos(a);
        const y = cy + (R + 26) * Math.sin(a);
        const ancora = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        return (
          <text
            key={p.id}
            x={x}
            y={y}
            textAnchor={ancora}
            dominantBaseline="middle"
            style={{ fontSize: 10.5, fontWeight: 700, fill: p.accento, fontFamily: FONT_BODY }}
          >
            {p.breve}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Grafico a linee con banda interquartile del settore (§7.12).
 * Le tre linee fisse — Q1, mediana, Q3 — dicono a colpo d'occhio se negli anni
 * l'azienda è stata fra le peggiori, nella media, o se sta salendo per
 * agganciare le migliori.
 */
function GraficoLinee({ anni, serie, banda, unita, altezza = 260 }) {
  const L = 62;
  const R = 16;
  const T = 14;
  const B = 30;
  const W = 720;
  const H = altezza;

  const tutti = [
    ...serie.flatMap((s) => s.valori.filter(isNum)),
    ...(banda ? banda.flatMap((b) => [b.q1, b.mediana, b.q3].filter(isNum)) : []),
  ];
  if (!tutti.length || anni.length < 2) {
    return (
      <div className="text-[12.5px] py-6 text-center" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
        Servono almeno due esercizi con un valore per disegnare una serie.
      </div>
    );
  }

  let min = Math.min(...tutti);
  let max = Math.max(...tutti);
  if (min === max) {
    min -= Math.abs(min) * 0.1 || 1;
    max += Math.abs(max) * 0.1 || 1;
  }
  const margine = (max - min) * 0.08;
  min -= margine;
  max += margine;

  const x = (i) => L + (i / (anni.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);

  const percorso = (valori) => {
    let d = "";
    let aperto = false;
    valori.forEach((v, i) => {
      if (!isNum(v)) {
        aperto = false;
        return;
      }
      d += `${aperto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      aperto = true;
    });
    return d.trim();
  };

  const tacche = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);

  /* Contorno chiuso della banda interquartile: bordo superiore in avanti sui
     Q3 definiti, bordo inferiore all'indietro sui Q1 definiti. */
  const sopra = banda ? banda.map((b, i) => ({ i, v: b.q3 })).filter((p) => isNum(p.v)) : [];
  const sotto = banda ? banda.map((b, i) => ({ i, v: b.q1 })).filter((p) => isNum(p.v)) : [];
  const dBanda =
    sopra.length >= 2 && sotto.length >= 2
      ? sopra.map((p, j) => `${j === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ") +
        " " +
        [...sotto].reverse().map((p) => `L${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ") +
        " Z"
      : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {tacche.map((t, i) => (
        <g key={i}>
          <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} stroke={LINE} strokeWidth="0.8" strokeDasharray={i === 0 ? "" : "3 3"} />
          <text
            x={L - 6}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            style={{ fontSize: 10, fill: "#8A917F", fontFamily: FONT_MONO }}
          >
            {formattaValore(t, unita)}
          </text>
        </g>
      ))}

      {anni.map((a, i) => (
        <text
          key={a}
          x={x(i)}
          y={H - B + 16}
          textAnchor="middle"
          style={{ fontSize: 10.5, fill: "#5A6159", fontFamily: FONT_MONO }}
        >
          {a}
        </text>
      ))}

      {/* Banda interquartile del peer group: la fascia in cui sta la metà
          centrale delle aziende, con la mediana come linea di riferimento.
          Il tracciato si costruisce sui soli punti definiti: un anno in cui i
          quartili non esistono va saltato, non disegnato a zero, e il percorso
          deve comunque cominciare con un «M» o il browser lo scarta. */}
      {dBanda ? <path d={dBanda} fill="#8A917F" fillOpacity="0.1" stroke="none" /> : null}
      {banda ? (
        <path
          d={percorso(banda.map((b) => b.mediana))}
          fill="none"
          stroke="#8A917F"
          strokeWidth="1.6"
          strokeDasharray="6 4"
        />
      ) : null}

      {serie.map((s) => (
        <g key={s.chiave}>
          <path d={percorso(s.valori)} fill="none" stroke={s.colore} strokeWidth="2.2" strokeLinejoin="round" />
          {s.valori.map((v, i) =>
            isNum(v) ? <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill={s.colore} /> : null
          )}
        </g>
      ))}
    </svg>
  );
}

/** Barra orizzontale di confronto fra due valori normalizzati 0-100. */
function BarraConfronto({ sinistra, destra, coloreSin, coloreDes }) {
  const a = isNum(sinistra) ? Math.max(0, Math.min(100, sinistra)) : 0;
  const b = isNum(destra) ? Math.max(0, Math.min(100, destra)) : 0;
  const tot = a + b || 1;
  return (
    <div className="flex items-center h-3 rounded overflow-hidden" style={{ background: "#EFF0ED" }}>
      <div style={{ width: `${(a / tot) * 100}%`, background: coloreSin, height: "100%" }} />
      <div style={{ width: `${(b / tot) * 100}%`, background: coloreDes, height: "100%" }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-quater] SCORECARD
   ═══════════════════════════════════════════════════════════════════════════ */

function DettaglioMetriche({ chiave, comparazione }) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
      {PILASTRI.map((p) => (
        <div key={p.id} className="mb-3 last:mb-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: p.accento, fontFamily: FONT_BODY }}>
            {p.n}. {p.breve}
          </div>
          <div className="space-y-0.5">
            {METRICHE_DEL(p.id).map((m) => {
              const c = comparazione.celle[chiave][m.id];
              const f = isNum(c.fascia) ? FASCE[c.fascia] : null;
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 text-[11.5px]" title={m.formula}>
                  <span className="truncate" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                    {m.label}
                    {c.soglia === false ? <span style={{ color: RED }}> ⚠</span> : null}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded font-semibold shrink-0"
                    style={{
                      background: f ? f.sfondo : "transparent",
                      color: f ? f.testo : "#A8AFA2",
                      fontFamily: FONT_MONO,
                    }}
                  >
                    {formattaValore(c.valore, m.unita)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Scorecard({ comparazione }) {
  const { lista, esiti } = comparazione;
  const ordinate = [...lista].sort((a, b) => (esiti[b.chiave].punteggio ?? -1) - (esiti[a.chiave].punteggio ?? -1));
  const colori = Object.fromEntries(ordinate.map((a, i) => [a.chiave, coloreDi(i)]));

  const [aperta, setAperta] = useState(null);
  const [sovrapposte, setSovrapposte] = useState(() => ordinate.slice(0, 3).map((a) => a.chiave));

  const vociRadar = ordinate
    .filter((a) => sovrapposte.includes(a.chiave))
    .map((a) => ({
      chiave: a.chiave,
      nome: a.nome,
      colore: colori[a.chiave],
      valori: PILASTRI.map((p) => esiti[a.chiave].pilastri[p.id].punteggio),
    }));

  return (
    <div>
      <SectionCard titolo="Profilo comparato" eyebrow="radar a sei assi" accento={PURPLE}>
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="shrink-0 mx-auto lg:mx-0">
            {vociRadar.length ? (
              <Radar voci={vociRadar} lato={320} />
            ) : (
              <div className="text-[12.5px] py-12 px-8 text-center" style={{ color: "#8A917F" }}>
                Seleziona almeno un'azienda da sovrapporre.
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Il radar rende visibile la <strong>forma</strong> di un'azienda, non solo il suo punteggio: chi ha un
              pentagono regolare è solido ovunque, chi ha una punta sola eccelle su un fronte e scopre gli altri. Due
              aziende con lo stesso totale possono avere profili opposti.
            </div>
            <div className="space-y-1.5">
              {ordinate.map((a) => (
                <label
                  key={a.chiave}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer"
                  style={{ background: sovrapposte.includes(a.chiave) ? "#FAFBF9" : "transparent" }}
                >
                  <input
                    type="checkbox"
                    checked={sovrapposte.includes(a.chiave)}
                    onChange={(e) =>
                      setSovrapposte((s) => (e.target.checked ? [...s, a.chiave] : s.filter((x) => x !== a.chiave)))
                    }
                  />
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: colori[a.chiave] }} />
                  <span className="text-[12.5px] font-semibold truncate flex-1" style={{ color: INK, fontFamily: FONT_BODY }}>
                    {a.nome}
                  </span>
                  <span className="text-[12.5px] font-bold shrink-0" style={{ color: colori[a.chiave], fontFamily: FONT_MONO }}>
                    {isNum(esiti[a.chiave].punteggio) ? fmt(esiti[a.chiave].punteggio, 0) : "n.d."}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ordinate.map((a) => {
          const e = esiti[a.chiave];
          const colore = colori[a.chiave];
          return (
            <div
              key={a.chiave}
              className="rounded-lg overflow-hidden"
              style={{ background: CARD, border: `1px solid ${LINE}`, borderLeft: `4px solid ${colore}` }}
            >
              <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="min-w-0">
                  <div className="font-bold text-[15px] truncate" style={{ color: INK, fontFamily: FONT_HEAD }}>
                    {a.nome}
                  </div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                    {SETTORI[a.settore]?.label || "settore non indicato"} · copertura dati {pct(e.copertura, 0)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[26px] font-extrabold leading-none" style={{ color: colore, fontFamily: FONT_HEAD }}>
                    {isNum(e.punteggio) ? fmt(e.punteggio, 0) : "—"}
                  </div>
                  <div className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                    {isNum(e.rango) ? `${e.rango}° su ${comparazione.classifica.length}` : "non classificata"}
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 space-y-2">
                {PILASTRI.map((p) => {
                  const s = e.pilastri[p.id];
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between text-[11.5px] mb-0.5">
                        <span style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                          {p.n}. {p.breve}
                          <span className="ml-1" style={{ color: "#A8AFA2" }}>
                            ({s.coperte}/{s.totali})
                          </span>
                        </span>
                        <span className="font-bold" style={{ color: p.accento, fontFamily: FONT_MONO }}>
                          {isNum(s.punteggio) ? fmt(s.punteggio, 0) : "n.d."}
                        </span>
                      </div>
                      <div className="h-2 rounded overflow-hidden" style={{ background: "#EFF0ED" }}>
                        <div
                          style={{
                            width: `${isNum(s.punteggio) ? s.punteggio : 0}%`,
                            background: p.accento,
                            height: "100%",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                {e.penalita.length ? (
                  <div className="pt-2 flex flex-wrap gap-1.5">
                    {e.penalita.map((p) => (
                      <Badge key={p.id} tono="bad">
                        −{p.punti} {p.etichetta}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="pt-2">
                    <Badge tono="ok">nessuna bandiera rossa</Badge>
                  </div>
                )}

                <button
                  onClick={() => setAperta(aperta === a.chiave ? null : a.chiave)}
                  className="text-[11.5px] font-semibold mt-1"
                  style={{ color: BLUE, fontFamily: FONT_BODY }}
                >
                  {aperta === a.chiave ? "▴ Nascondi le metriche" : `▾ Mostra tutte le ${METRICHE.length} metriche`}
                </button>

                {aperta === a.chiave ? <DettaglioMetriche chiave={a.chiave} comparazione={comparazione} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-quinquies] TESTA A TESTA
   ═══════════════════════════════════════════════════════════════════════════ */

/** Distanza da una banda obiettivo: 0 se dentro, crescente man mano che se ne esce. */
const distanzaDaBanda = (v, banda) => {
  if (!Array.isArray(banda) || !isNum(v)) return null;
  const [lo, hi] = banda;
  if (v >= lo && v <= hi) return 0;
  return v < lo ? lo - v : v - hi;
};

/** Chi vince su una metrica, tenuto conto del verso. */
export function vincitoreMetrica(vA, vB, metrica) {
  if (!isNum(vA) && !isNum(vB)) return null;
  if (!isNum(vA)) return "B";
  if (!isNum(vB)) return "A";
  if (metrica.verso === "banda") {
    const dA = distanzaDaBanda(vA, metrica.banda);
    const dB = distanzaDaBanda(vB, metrica.banda);
    if (dA === dB) return "pari";
    return dA < dB ? "A" : "B";
  }
  if (vA === vB) return "pari";
  const aVince = metrica.verso === "basso" ? vA < vB : vA > vB;
  return aVince ? "A" : "B";
}

function formattaDelta(d, unita) {
  if (!isNum(d)) return "—";
  switch (unita) {
    case "%":
    case "pp":
      return pp(d, 1);
    case "x":
      return mult(d, 2, true);
    case "gg":
      return `${d > 0 ? "+" : ""}${Math.round(d)} gg`;
    default:
      return `${d > 0 ? "+" : ""}${fmt(d, 0)}`;
  }
}

/* Definito a livello di modulo e non dentro TestaATesta: un componente creato
   dentro il corpo di un altro cambia identità a ogni render, e React smonta e
   rimonta la <select> — il menu a tendina si chiuderebbe da solo mentre lo si
   sta usando. */
function SelettoreAzienda({ valore, onChange, colore, lista }) {
  return (
    <select
      value={valore}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1.5 rounded text-[13px] font-bold w-full"
      style={{ border: `2px solid ${colore}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
    >
      {lista.map((a) => (
        <option key={a.chiave} value={a.chiave}>
          {a.nome}
        </option>
      ))}
    </select>
  );
}

function TestaATesta({ comparazione }) {
  const { lista, celle, esiti } = comparazione;
  const ordinate = [...lista].sort((a, b) => (esiti[b.chiave].punteggio ?? -1) - (esiti[a.chiave].punteggio ?? -1));

  const [sinistra, setSinistra] = useState(ordinate[0]?.chiave ?? null);
  const [destra, setDestra] = useState(ordinate[1]?.chiave ?? ordinate[0]?.chiave ?? null);

  /* Le due selezioni sono memorizzate per chiave: se l'azienda scelta viene
     eliminata dalla Fase 0, la chiave resta ma non corrisponde più a nulla e la
     scheda si svuoterebbe senza dire perché. Si ripiega quindi sulle prime due
     in classifica invece di lasciare la pagina bianca. */
  const presenti = lista.map((a) => a.chiave);
  const chiaveA = presenti.includes(sinistra) ? sinistra : ordinate[0]?.chiave;
  const chiaveB = presenti.includes(destra) ? destra : ordinate[1]?.chiave ?? ordinate[0]?.chiave;

  const A = lista.find((x) => x.chiave === chiaveA);
  const B = lista.find((x) => x.chiave === chiaveB);
  if (!A || !B) return null;

  const colA = COLORI_AZIENDA[0];
  const colB = COLORI_AZIENDA[3];

  const esitiPilastri = PILASTRI.map((p) => {
    const a = esiti[A.chiave].pilastri[p.id].punteggio;
    const b = esiti[B.chiave].pilastri[p.id].punteggio;
    let vince = null;
    if (isNum(a) && isNum(b)) vince = a === b ? "pari" : a > b ? "A" : "B";
    else if (isNum(a)) vince = "A";
    else if (isNum(b)) vince = "B";
    return { pilastro: p, a, b, vince };
  });

  const vintiA = esitiPilastri.filter((x) => x.vince === "A").length;
  const vintiB = esitiPilastri.filter((x) => x.vince === "B").length;

  return (
    <div>
      <SectionCard titolo="Confronto diretto" eyebrow="testa a testa" accento={BLUE}>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-5">
          <SelettoreAzienda valore={chiaveA} onChange={setSinistra} colore={colA} lista={lista} />
          <span className="text-[18px] font-bold px-2" style={{ color: "#8A917F" }}>
            vs
          </span>
          <SelettoreAzienda valore={chiaveB} onChange={setDestra} colore={colB} lista={lista} />
        </div>

        {A.chiave === B.chiave ? (
          <div className="rounded p-3 text-[12.5px]" style={{ background: "#FAECD8", border: "1px solid #EBD4AC", color: "#7A5A16" }}>
            Hai scelto due volte la stessa azienda: seleziona un secondo termine di confronto.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-5">
              <div className="text-right">
                <div className="text-[32px] font-extrabold leading-none" style={{ color: colA, fontFamily: FONT_HEAD }}>
                  {isNum(esiti[A.chiave].punteggio) ? fmt(esiti[A.chiave].punteggio, 0) : "—"}
                </div>
                <div className="text-[11.5px]" style={{ color: "#5A6159" }}>
                  {isNum(esiti[A.chiave].rango) ? `${esiti[A.chiave].rango}° in classifica` : ""}
                </div>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-widest px-3" style={{ color: "#8A917F" }}>
                punteggio
              </div>
              <div>
                <div className="text-[32px] font-extrabold leading-none" style={{ color: colB, fontFamily: FONT_HEAD }}>
                  {isNum(esiti[B.chiave].punteggio) ? fmt(esiti[B.chiave].punteggio, 0) : "—"}
                </div>
                <div className="text-[11.5px]" style={{ color: "#5A6159" }}>
                  {isNum(esiti[B.chiave].rango) ? `${esiti[B.chiave].rango}° in classifica` : ""}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 mb-5">
              {esitiPilastri.map(({ pilastro, a, b, vince }) => (
                <div key={pilastro.id}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className="font-bold" style={{ color: vince === "A" ? colA : "#5A6159", fontFamily: FONT_MONO, width: 44 }}>
                      {isNum(a) ? fmt(a, 0) : "n.d."}
                    </span>
                    <span className="font-semibold" style={{ color: pilastro.accento, fontFamily: FONT_BODY }}>
                      {pilastro.n}. {pilastro.breve}
                    </span>
                    <span
                      className="font-bold text-right"
                      style={{ color: vince === "B" ? colB : "#5A6159", fontFamily: FONT_MONO, width: 44 }}
                    >
                      {isNum(b) ? fmt(b, 0) : "n.d."}
                    </span>
                  </div>
                  <BarraConfronto sinistra={a} destra={b} coloreSin={colA} coloreDes={colB} />
                </div>
              ))}
            </div>

            <div
              className="rounded-lg px-4 py-3 text-center"
              style={{ background: vintiA === vintiB ? "#EFF0ED" : vintiA > vintiB ? "#E2EFE6" : "#E6ECF5" }}
            >
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "#5A6159" }}>
                Verdetto
              </div>
              <div className="text-[15px] font-bold" style={{ color: INK, fontFamily: FONT_HEAD }}>
                {vintiA === vintiB
                  ? `Pareggio: ${vintiA} pilastri a testa`
                  : `${vintiA > vintiB ? A.nome : B.nome} vince ${Math.max(vintiA, vintiB)} pilastri su ${PILASTRI.length}`}
              </div>
              <div className="text-[12px] mt-1" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                Il verdetto conta i pilastri vinti, non la somma dei punti: vincere di misura su più fronti è cosa
                diversa dal dominare su uno solo. Se le due letture divergono, la matrice dice quale delle due sta
                reggendo il punteggio.
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {A.chiave !== B.chiave ? (
        <SectionCard titolo="Metrica per metrica" eyebrow="dove si decide il confronto" accento={GREEN}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ fontFamily: FONT_BODY }}>
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-[12px] font-bold" style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}>
                    Metrica
                  </th>
                  <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[110px]" style={{ border: `1px solid ${LINE}`, background: colA, color: "#fff" }}>
                    {A.nome}
                  </th>
                  <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[110px]" style={{ border: `1px solid ${LINE}`, background: colB, color: "#fff" }}>
                    {B.nome}
                  </th>
                  <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[100px]" style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}>
                    Scarto
                  </th>
                  <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[120px]" style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}>
                    Vince
                  </th>
                </tr>
              </thead>
              <tbody>
                {PILASTRI.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <th
                        colSpan={5}
                        className="px-3 py-1.5 text-left text-[11.5px] font-bold uppercase tracking-wider"
                        style={{ border: `1px solid ${LINE}`, background: p.accento, color: "#fff" }}
                      >
                        {p.n}. {p.titolo}
                      </th>
                    </tr>
                    {METRICHE_DEL(p.id).map((m) => {
                      const vA = celle[A.chiave][m.id].valore;
                      const vB = celle[B.chiave][m.id].valore;
                      const vince = vincitoreMetrica(vA, vB, m);
                      const delta = isNum(vA) && isNum(vB) ? vA - vB : null;
                      return (
                        <tr key={m.id}>
                          <th
                            className="px-3 py-1.5 text-left text-[12px] font-normal"
                            style={{ border: `1px solid ${LINE}`, background: CARD, color: INK }}
                            title={`${m.formula}\n\n${m.nota}`}
                          >
                            <span className="font-semibold">{m.label}</span>
                            {celle[A.chiave][m.id].soglia === false || celle[B.chiave][m.id].soglia === false ? (
                              <span className="ml-1.5 text-[10.5px]" style={{ color: RED }}>
                                soglia violata
                              </span>
                            ) : null}
                          </th>
                          {[
                            { v: vA, mio: "A", col: colA },
                            { v: vB, mio: "B", col: colB },
                          ].map(({ v, mio, col }) => (
                            <td
                              key={mio}
                              className="px-2 py-1.5 text-center text-[12.5px] font-semibold"
                              style={{
                                border: `1px solid ${LINE}`,
                                background: vince === mio ? "#E2EFE6" : CARD,
                                color: isNum(v) ? (vince === mio ? "#14503A" : INK) : "#A8AFA2",
                                fontFamily: FONT_MONO,
                              }}
                            >
                              {formattaValore(v, m.unita)}
                            </td>
                          ))}
                          <td
                            className="px-2 py-1.5 text-center text-[12px]"
                            style={{ border: `1px solid ${LINE}`, color: "#5A6159", fontFamily: FONT_MONO }}
                          >
                            {formattaDelta(delta, m.unita)}
                          </td>
                          <td
                            className="px-2 py-1.5 text-center text-[11.5px] font-semibold"
                            style={{
                              border: `1px solid ${LINE}`,
                              color: vince === "A" ? colA : vince === "B" ? colB : "#8A917F",
                              fontFamily: FONT_BODY,
                            }}
                          >
                            {vince === "A" ? A.nome : vince === "B" ? B.nome : vince === "pari" ? "pari" : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] mt-3" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            Quando una sola delle due ha il dato, vince per assenza di contraddittorio: è un'aggiudicazione debole, e la
            colonna «copertura dati» della scorecard dice quanto pesa.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-sexies] SERIE STORICHE
   ═══════════════════════════════════════════════════════════════════════════ */

function SerieStoriche({ aziende, anni, serieComparazioni }) {
  const [voceId, setVoceId] = useState("g_ricavi");
  const [smussamento, setSmussamento] = useState("nessuno");
  const [mostraBanda, setMostraBanda] = useState(true);
  const [selezionate, setSelezionate] = useState(() => Object.keys(aziende).slice(0, 4));

  const voce = voceSerie(voceId);
  const anniCrescenti = [...anni].sort((a, b) => a - b);
  const lista = Object.values(aziende);
  const colori = Object.fromEntries(lista.map((a, i) => [a.chiave, coloreDi(i)]));

  /* Valori grezzi per azienda lungo tutti gli esercizi. Le metriche calcolate
     si leggono dalla comparazione dell'anno, le grandezze assolute dal dataset:
     sono due strade diverse per la stessa domanda. */
  const valoriDi = (chiave) =>
    anniCrescenti.map((anno) => {
      if (GRANDEZZA_DI[voceId]) return GRANDEZZA_DI[voceId].leggi(aziende[chiave]?.esercizi?.[anno]);
      const comp = serieComparazioni[anno];
      return comp?.celle?.[chiave]?.[voceId]?.valore ?? null;
    });

  const grezzi = Object.fromEntries(lista.map((a) => [a.chiave, valoriDi(a.chiave)]));

  const trasforma = (v) => {
    if (smussamento === "mm3") return mediaMobile(v, 3, false);
    if (smussamento === "mm3p") return mediaMobile(v, 3, true);
    if (smussamento === "exp") return livellamentoEsponenziale(v, 0.5);
    return v;
  };

  const serie = lista
    .filter((a) => selezionate.includes(a.chiave))
    .map((a) => ({
      chiave: a.chiave,
      nome: a.nome,
      colore: colori[a.chiave],
      valori: trasforma(grezzi[a.chiave]),
    }));

  /* Banda interquartile per esercizio: si calcola sui valori effettivi di
     quell'anno, non su una distribuzione fissa, perché il settore si muove. */
  const banda = mostraBanda
    ? anniCrescenti.map((anno, i) => {
        const valori = lista.map((a) => grezzi[a.chiave][i]).filter(isNum);
        if (valori.length < 3) return { q1: null, mediana: null, q3: null };
        return { q1: quantile(valori, 0.25), mediana: quantile(valori, 0.5), q3: quantile(valori, 0.75) };
      })
    : null;

  return (
    <div>
      <SectionCard
        titolo="Comparazione nel tempo"
        eyebrow="§7.3 – §7.6 · serie storiche"
        accento={BLUE}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={voceId}
              onChange={(e) => setVoceId(e.target.value)}
              className="px-2 py-1 rounded text-[12px]"
              style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
            >
              <optgroup label="Grandezze assolute">
                {GRANDEZZE.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </optgroup>
              {PILASTRI.map((p) => (
                <optgroup key={p.id} label={`${p.n}. ${p.breve}`}>
                  {METRICHE_DEL(p.id).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={smussamento}
              onChange={(e) => setSmussamento(e.target.value)}
              className="px-2 py-1 rounded text-[12px]"
              style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
            >
              <option value="nessuno">Valori grezzi</option>
              <option value="mm3">Media mobile 3 anni</option>
              <option value="mm3p">Media mobile ponderata 3 anni</option>
              <option value="exp">Livellamento esponenziale (W 0,5)</option>
            </select>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {lista.map((a) => (
            <label key={a.chiave} className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ fontFamily: FONT_BODY }}>
              <input
                type="checkbox"
                checked={selezionate.includes(a.chiave)}
                onChange={(e) =>
                  setSelezionate((s) => (e.target.checked ? [...s, a.chiave] : s.filter((x) => x !== a.chiave)))
                }
              />
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: colori[a.chiave] }} />
              <span style={{ color: INK }}>{a.nome}</span>
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[12px] ml-auto cursor-pointer" style={{ fontFamily: FONT_BODY }}>
            <input type="checkbox" checked={mostraBanda} onChange={(e) => setMostraBanda(e.target.checked)} />
            <span style={{ color: "#5A6159" }}>Banda Q1–Q3 e mediana del gruppo</span>
          </label>
        </div>

        <GraficoLinee
          anni={anniCrescenti}
          serie={serie}
          banda={banda}
          unita={voce?.unita || "%"}
        />

        <p className="text-[11.5px] mt-2" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
          {smussamento === "nessuno"
            ? "I valori grezzi contengono trend, ciclo, stagionalità ed eventi irregolari tutti insieme. Il smussamento serve a far emergere il trend di fondo."
            : smussamento === "exp"
            ? "Il livellamento esponenziale dà peso 0,5 all'ultimo dato e 0,5 alla storia: alza W se credi che l'ultimo evento cambi tutto, abbassalo se contano i cicli lunghi."
            : "La media mobile smussa le oscillazioni casuali. La versione ponderata dà più importanza ai dati recenti, che la semplice tratta come quelli di cinque anni fa."}
          {mostraBanda ? " La banda grigia è l'intervallo fra primo e terzo quartile del gruppo, la tratteggiata è la mediana: dice se l'azienda sta agganciando le migliori o scivolando fra le peggiori." : ""}
        </p>
      </SectionCard>

      <SectionCard titolo="Numeri indice e tassi di crescita" eyebrow="§7.4 – §7.5" accento={GREEN}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ fontFamily: FONT_BODY }}>
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-[12px] font-bold sticky left-0 z-10 min-w-[200px]" style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}>
                  {voce?.label || "—"}
                </th>
                {anniCrescenti.map((a) => (
                  <th key={a} className="px-2 py-2 text-center text-[12px] font-bold min-w-[92px]" style={{ border: `1px solid ${LINE}`, background: INK, color: "#fff" }}>
                    {a}
                  </th>
                ))}
                <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[92px]" style={{ border: `1px solid ${LINE}`, background: GREEN, color: "#fff" }}>
                  CAGR
                </th>
                <th className="px-2 py-2 text-center text-[12px] font-bold min-w-[92px]" style={{ border: `1px solid ${LINE}`, background: "#8A917F", color: "#fff" }} title="Media aritmetica delle variazioni annue: esposta solo per contrasto, non è la crescita reale.">
                  Media sempl.
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const v = grezzi[a.chiave];
                const bf = baseFissa(v);
                const bm = baseMobile(v);
                const g = cagr(v);
                const ms = mediaAritmeticaVariazioni(v);
                return (
                  <Fragment key={a.chiave}>
                    <tr>
                      <th
                        rowSpan={3}
                        className="px-3 py-1.5 text-left text-[12px] font-semibold sticky left-0 z-10 align-top"
                        style={{ border: `1px solid ${LINE}`, background: CARD, color: INK, borderLeft: `4px solid ${colori[a.chiave]}` }}
                      >
                        {a.nome}
                      </th>
                      {v.map((x, i) => (
                        <td key={i} className="px-2 py-1.5 text-center text-[12.5px] font-semibold" style={{ border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_MONO }}>
                          {formattaValore(x, voce?.unita)}
                        </td>
                      ))}
                      <td
                        rowSpan={3}
                        className="px-2 py-1.5 text-center text-[13px] font-bold align-middle"
                        style={{ border: `1px solid ${LINE}`, background: "#E2EFE6", color: "#14503A", fontFamily: FONT_MONO }}
                      >
                        {isNum(g) ? pct(g, 2, true) : "n.d."}
                      </td>
                      <td
                        rowSpan={3}
                        className="px-2 py-1.5 text-center text-[12.5px] align-middle"
                        style={{ border: `1px solid ${LINE}`, background: "#F4F6F2", color: "#5A6159", fontFamily: FONT_MONO }}
                      >
                        {isNum(ms) ? pct(ms, 2, true) : "n.d."}
                      </td>
                    </tr>
                    <tr>
                      {bf.map((x, i) => (
                        <td
                          key={i}
                          className="px-2 py-1 text-center text-[11.5px]"
                          style={{ border: `1px solid ${LINE}`, color: "#5A6159", fontFamily: FONT_MONO, background: "#FAFBF9" }}
                          title="Numero indice a base fissa: il primo esercizio disponibile vale 100."
                        >
                          {isNum(x) ? fmt(x, 1) : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      {bm.map((x, i) => (
                        <td
                          key={i}
                          className="px-2 py-1 text-center text-[11.5px] font-semibold"
                          style={{
                            border: `1px solid ${LINE}`,
                            color: !isNum(x) ? "#A8AFA2" : x >= 0 ? GREEN : RED,
                            fontFamily: FONT_MONO,
                            background: "#FAFBF9",
                          }}
                          title="Numero indice a base mobile: variazione rispetto all'esercizio precedente."
                        >
                          {isNum(x) ? `${x > 0 ? "+" : ""}${fmt(x, 1)}%` : "—"}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-[11.5px] space-y-1" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          <div>
            Tre righe per azienda: <strong>valore</strong>, <strong>numero indice a base fissa</strong> (primo esercizio
            = 100, mostra l'evoluzione complessiva) e <strong>base mobile</strong> (variazione anno su anno, mostra
            accelerazioni e frenate che la base fissa nasconde).
          </div>
          <div>
            La colonna <strong>CAGR</strong> è la media geometrica, l'unica misura corretta della crescita composta. La
            colonna grigia accanto è la media aritmetica delle variazioni, esposta solo per contrasto: quando le due
            divergono nettamente, la seconda sta mentendo.
            {(() => {
              const divergenti = lista
                .map((a) => {
                  const v = grezzi[a.chiave];
                  const g = cagr(v);
                  const ms = mediaAritmeticaVariazioni(v);
                  return isNum(g) && isNum(ms) && Math.abs(ms - g) > 0.02 ? a.nome : null;
                })
                .filter(Boolean);
              return divergenti.length ? ` Qui divergono di oltre 2 punti su: ${divergenti.join(", ")}.` : "";
            })()}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-septies] MOTORE IA E LETTURA DEI DOCUMENTI
   ═══════════════════════════════════════════════════════════════════════════
   Blocco ripreso dal modulo «Rendiconto Finanziario Riclassificato», dove è già
   rodato: chiamata multi-provider, ritentativi con backoff, parsing JSON
   robusto, lettura nativa dei PDF con suddivisione in porzioni. Cambiano solo i
   prompt — là si cercavano rettifiche ai flussi di cassa, qui si cerca la
   relazione comparativa e i reperti nelle note integrative dei peer.

   Qui non si usa `import.meta`: è sintassi legale solo dentro un modulo ES e
   farebbe fallire il parsing quando il componente viene incollato in un
   artifact.
   ─────────────────────────────────────────────────────────────────────────── */

const CHIAVE_CONFIG_IA = "comparazione_config_ia";

const ENDPOINT_API_DIRETTA = "https://api.anthropic.com/v1/messages";

/** Il proxy esiste solo dove l'applicazione è servita da un backend proprio. */
const hostConProxy = () => {
  if (typeof window === "undefined") return false;
  const proto = (window.location && window.location.protocol) || "";
  const host = (window.location && window.location.hostname) || "";
  if (proto === "file:" || proto === "blob:") return false;
  if (/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(host)) return false;
  return true;
};

/**
 * Destinazione della chiamata, decisa AL MOMENTO DELLA CHIAMATA e non una volta
 * per tutte al caricamento, perché dipende da un dato che al caricamento non si
 * conosce: se l'analista ha digitato una propria chiave. Con una chiave in mano
 * si parla direttamente con l'API, ed è l'unico modo che funzioni quando la
 * pagina è un file autonomo aperto dal browser, dove `/api/anthropic` è un
 * percorso relativo che non risolve nulla.
 */
const endpointClaude = (apiKey) => {
  /* eslint-disable-next-line no-undef */
  if (typeof __CLAUDE_ENDPOINT__ === "string" && __CLAUDE_ENDPOINT__) return __CLAUDE_ENDPOINT__;
  if (typeof window !== "undefined") {
    const manuale = window.__CLAUDE_ENDPOINT__;
    if (typeof manuale === "string" && manuale) return manuale;
  }
  const conChiave = apiKey && apiKey !== "__subscription__";
  if (conChiave) return ENDPOINT_API_DIRETTA;
  return hostConProxy() ? "/api/anthropic" : ENDPOINT_API_DIRETTA;
};

/* Vero solo dove è l'ambiente ospite a mettere le credenziali (un artifact su
   claude.ai): lì la chiave non va chiesta. Ovunque altro — file aperto da
   disco, sito proprio, intranet — la chiave serve, e l'interfaccia deve
   chiederla invece di annunciare un'autenticazione che non esiste. */
const AMBIENTE_AUTENTICA =
  typeof window !== "undefined" &&
  /(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(
    (window.location && window.location.hostname) || ""
  );

/* Il segnaposto "__subscription__" indica che l'utente non ha digitato alcuna
   chiave: non parte alcun header e autentica l'ambiente ospite o il server. */
const headerClaude = (apiKey) => {
  const chiave = apiKey && apiKey !== "__subscription__" ? apiKey : null;
  if (!chiave) return { "Content-Type": "application/json" };
  return endpointClaude(apiKey) === ENDPOINT_API_DIRETTA
    ? {
        "Content-Type": "application/json",
        "x-api-key": chiave,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }
    : { "Content-Type": "application/json", "x-user-key": chiave };
};

const MODELLI = {
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — equilibrato" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8 — il più capace" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — rapido ed economico" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini — rapido" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
};

const ISTRUZIONE_JSON =
  "\n\nIMPORTANTE: rispondi esclusivamente con l'oggetto JSON richiesto, senza testo introduttivo, senza commenti e senza blocchi ```.";

async function chiamaIA({ provider, apiKey, model, prompt, pdfBase64 = null }) {
  if (provider === "openai") {
    /* chat/completions non accetta il PDF grezzo ma legge le immagini: le
       pagine vengono rasterizzate nel browser e allegate come «image_url».
       Funzionano così anche le scansioni e i file «Stampa su PDF». */
    const contenuto = pdfBase64
      ? [...(await pdfBase64ToPartiOpenAI(pdfBase64)), { type: "text", text: prompt + ISTRUZIONE_JSON }]
      : prompt;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: contenuto }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (provider === "claude") {
    const contenuto = pdfBase64
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt + ISTRUZIONE_JSON },
        ]
      : [{ type: "text", text: prompt + ISTRUZIONE_JSON }];
    const res = await fetch(endpointClaude(apiKey), {
      method: "POST",
      headers: headerClaude(apiKey),
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: "user", content: contenuto }] }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
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
      body: JSON.stringify({ contents: [{ parts: parti }], generationConfig: { responseMimeType: "application/json" } }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates[0].content.parts.map((p) => p.text).join("");
}

function erroreTransitorio(err) {
  const m = String(err?.message || err).toLowerCase();
  return (
    /(^|[^\d])(429|500|502|503|504|529)([^\d]|$)/.test(m) ||
    m.includes("overloaded") || m.includes("rate") || m.includes("timeout") ||
    m.includes("network") || m.includes("failed to fetch") || m.includes("fetch failed") ||
    m.includes("econnreset") || m.includes("temporar") || m.includes("unavailable")
  );
}

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

/* ---------- Parsing JSON robusto ----------
   Due modalità di fallimento con logiche opposte: (1) TRONCAMENTO, che si
   ripara chiudendo stringhe e parentesi rimaste aperte; (2) CONTENUTO EXTRA
   dopo un JSON completo, che si risolve scartando tutto ciò che segue la fine
   del primo valore. Si prova prima il caso (2): tentare la riparazione da
   troncamento su un JSON già completo riporterebbe allo stesso errore. */

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

export function parseJsonRobusto(raw) {
  let s = String(raw).replace(/```json|```/g, "").trim();
  const inizio = s.indexOf("{");
  if (inizio > 0) s = s.slice(inizio);

  try {
    return JSON.parse(s);
  } catch {
    /* non valido: si prosegue con le due riparazioni */
  }

  /* ---- Caso 2: JSON completo con testo extra incollato dopo ---- */
  const fineValore = trovaFineValoreJson(s);
  if (fineValore != null) {
    try {
      return JSON.parse(s.slice(0, fineValore));
    } catch {
      /* non valido comunque: si prosegue con il caso 1 */
    }
  }

  /* ---- Caso 1: riparazione da troncamento ----
     Si cerca l'ultima posizione in cui un VALORE si è concluso. Il punto
     delicato sono le stringhe: una stringa seguita da «:» è il NOME di una
     proprietà, non un valore, e troncare subito dopo lascerebbe una proprietà
     senza valore — `{"x"}` — che non è JSON. Per questo, prima di considerare
     sicura la chiusura di una stringa, si guarda cosa la segue. */
  const primoNonSpazioDopo = (i) => {
    for (let j = i; j < s.length; j++) if (!/\s/.test(s[j])) return s[j];
    return "";
  };
  const primoNonSpazioPrima = (i) => {
    for (let j = i - 1; j >= 0; j--) if (!/\s/.test(s[j])) return s[j];
    return "";
  };

  let inString = false;
  let escaped = false;
  let lastSafe = 0;
  let aperturaStringa = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        if (primoNonSpazioDopo(i + 1) !== ":") lastSafe = i + 1;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      aperturaStringa = i;
    } else if (c === "}" || c === "]") lastSafe = i + 1;
    else if (c === ",") lastSafe = i;
  }

  /* Se il testo si è interrotto DENTRO il valore di una stringa, la si chiude
     conservando il frammento: una frase troncata resta comunque informativa,
     mentre buttarla via perderebbe l'ultima sezione della risposta. */
  let riparato =
    inString && primoNonSpazioPrima(aperturaStringa) === ":"
      ? `${s}"`
      : s.slice(0, lastSafe).replace(/,\s*$/, "");

  if (!riparato.trim()) throw new SyntaxError("Risposta non interpretabile come JSON");

  inString = false;
  escaped = false;
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

  const data = JSON.parse(riparato);
  data.__troncato = true;
  return data;
}

/* ---------- Lettura dei PDF ----------
   pdf.js legge solo il layer di testo: un file da scansione ne è privo e
   restituisce zero caratteri. Per questo il PDF viene inviato al modello nel
   formato NATIVO, come blocco base64: il modello lo legge visivamente pagina
   per pagina. I file voluminosi vengono suddivisi in porzioni. */

const PDFJS_VER = "3.11.174";
const PAGINE_PER_PORZIONE = 25;
const SOGLIA_PORZIONE_BYTE = 8 * 1024 * 1024;
const PDF_IMG_WIDTH = 1500;
const PDF_IMG_MAX_PAGES = 30;
const PDF_IMG_MAX_BYTES_PAGE = 420 * 1024;

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
           piccolo worker locale che importa quello del CDN. Senza questo pdf.js
           ripiega sul «fake worker» e lavora sul thread principale, bloccando
           l'interfaccia durante la rasterizzazione. */
        const shim = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: "application/javascript" });
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

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Lettura del file non riuscita"));
    r.readAsDataURL(file);
  });
}

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

async function pdfToImages(input, opts = {}) {
  const { maxPages = PDF_IMG_MAX_PAGES, targetWidth = PDF_IMG_WIDTH, mimeType = "image/jpeg" } = opts;
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
      // Sfondo bianco: senza, il JPEG renderebbe nere le aree trasparenti.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
      let dataUrl = "";
      for (const q of [0.82, 0.65, 0.5, 0.38]) {
        dataUrl = canvas.toDataURL(mimeType, q);
        if (dataUrl.length * 0.75 <= PDF_IMG_MAX_BYTES_PAGE) break;
      }
      immagini.push({ page: i, mediaType: mimeType, data: dataUrl.split(",")[1] || "" });
      canvas.width = 0;
      canvas.height = 0;
      if (typeof page.cleanup === "function") page.cleanup();
    }
  } finally {
    if (typeof doc.destroy === "function") await doc.destroy();
  }
  if (!immagini.length) throw new Error("Il PDF non contiene pagine convertibili in immagini");
  return immagini;
}

/* La stessa porzione può essere inviata più volte e ogni chiamata può essere
   ripetuta fino a cinque volte dai ritentativi: senza cache la rasterizzazione
   verrebbe rifatta a ogni giro. */
const pdfImgCacheKey = (b64) => `${b64.length}|${b64.slice(0, 96)}|${b64.slice(-48)}`;

async function pdfToImagesCached(b64, opts) {
  if (!window.__pdfImgCache) window.__pdfImgCache = new Map();
  const cache = window.__pdfImgCache;
  const key = pdfImgCacheKey(b64);
  if (cache.has(key)) return cache.get(key);
  const p = pdfToImages(b64, opts).catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, p);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return p;
}

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
    parti.push({ type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}`, detail: "high" } });
  }
  return parti;
}

/* ---------- Prompt ---------- */

const arrotonda = (v, d = 3) => (isNum(v) ? Number(v.toFixed(d)) : null);

/**
 * Compone il dossier numerico da consegnare al modello. Volutamente compatto:
 * il modello deve commentare la griglia, non riceverne una copia integrale che
 * ne consumi il contesto. Ogni metrica arriva con valore, fascia e verso, così
 * che «basso è meglio» non debba essere indovinato.
 */
export function dossierComparativo({ comparazione, aziende, serieComparazioni, anni }) {
  const { lista, celle, esiti, dist } = comparazione;
  return {
    esercizio: comparazione.anno,
    esercizi_disponibili: anni,
    aziende_in_quartili: comparazione.nStatistica,
    metriche: METRICHE.map((m) => ({
      id: m.id, nome: m.label, pilastro: m.pilastro, unita: m.unita,
      meglio: m.verso === "banda" ? `dentro ${m.banda?.[0]}–${m.banda?.[1]}` : m.verso,
      soglia_teorica: m.soglia?.etichetta ?? null,
      distribuzione: dist[m.id]
        ? { fonte: dist[m.id].fonte, q1: arrotonda(dist[m.id].q1), mediana: arrotonda(dist[m.id].mediana), q3: arrotonda(dist[m.id].q3) }
        : null,
    })),
    imprese: lista.map((a) => {
      const e = esiti[a.chiave];
      return {
        nome: a.nome,
        settore: SETTORI[a.settore]?.label || a.settore,
        fascia_fatturato: FASCE_FATTURATO.find((f) => f.id === a.fascia)?.label ?? null,
        punteggio: arrotonda(e.punteggio, 1),
        posizione: e.rango ?? null,
        copertura_dati: arrotonda(e.copertura, 2),
        punteggi_pilastro: Object.fromEntries(
          PILASTRI.map((p) => [p.id, arrotonda(e.pilastri[p.id].punteggio, 1)])
        ),
        penalita: e.penalita.map((p) => ({ voce: p.etichetta, punti: p.punti, motivo: p.motivo })),
        valori: Object.fromEntries(
          METRICHE.map((m) => {
            const c = celle[a.chiave][m.id];
            return [
              m.id,
              c.valore === null
                ? null
                : { v: arrotonda(c.valore, 4), fascia: c.fascia, soglia_rispettata: c.soglia },
            ];
          })
        ),
        andamento: serieAndamento(a.chiave, aziende, serieComparazioni, anni),
        reperti_documentali: a.documentale?.reperti?.map((r) => ({
          tema: r.tema, gravita: r.gravita, sintesi: r.sintesi, pagina: r.pagina ?? null,
        })) ?? null,
        quality_of_earnings: a.qoe
          ? { punteggio: a.qoe.punteggio, red_flag: a.qoe.redFlag, sintesi: a.qoe.sintesi }
          : null,
      };
    }),
  };
}

/** Andamento pluriennale sintetico: CAGR e traiettoria delle voci decisive. */
function serieAndamento(chiave, aziende, serieComparazioni, anni) {
  const cresc = [...anni].sort((a, b) => a - b);
  const az = aziende[chiave];
  if (!az || cresc.length < 2) return null;
  const leggi = (id) => cresc.map((a) => serieComparazioni?.[a]?.celle?.[chiave]?.[id]?.valore ?? null);
  const ricavi = cresc.map((a) => az.esercizi?.[a]?.ce?.ricavi ?? null);
  return {
    anni: cresc,
    cagr_ricavi: arrotonda(cagr(ricavi), 4),
    ricavi: ricavi.map((v) => arrotonda(v, 0)),
    roic: leggi("roic").map((v) => arrotonda(v, 4)),
    ebitda_margin: leggi("ebitda_margin").map((v) => arrotonda(v, 4)),
    fcf_conversion: leggi("fcf_conversion").map((v) => arrotonda(v, 4)),
    nd_ebitda: leggi("nd_ebitda").map((v) => arrotonda(v, 3)),
    accrual_ratio: leggi("accrual_ratio").map((v) => arrotonda(v, 4)),
  };
}

const PROMPT_RELAZIONE = `Sei un analista finanziario che redige una relazione di COMPARAZIONE INTERAZIENDALE fra imprese dello stesso settore.

Ricevi un dossier già calcolato: metriche, quartili del peer group, soglie teoriche, punteggi per pilastro, penalità e serie storiche. NON ricalcolare nulla e NON inventare numeri che non ci sono: il tuo compito è interpretare, non computare. Se una voce è null, è un dato mancante e va trattato come tale, mai come uno zero.

Il quadro metodologico è quello classico dell'analisi di bilancio:
· La comparazione risponde a due domande: dove si trova oggi l'impresa e dove si troverà domani.
· Le anomalie che emergono vanno distinte in TRANSITORIE (evento eccezionale destinato a sparire) e PERMANENTI (strutturali, da riportare nelle previsioni). È la distinzione più importante che devi fare.
· Essere nella media del settore non significa stare bene: se tutti i concorrenti sono sovraindebitati, l'intero settore è a rischio. Per questo esistono le soglie teoriche, che non dipendono da cosa fa il mercato.
· Vale la mean reversion: un rendimento molto sopra la mediana tende a scendere verso di essa, a meno di vantaggi competitivi difendibili (brevetti, posizione dominante, costi strutturalmente più bassi). Se un'impresa ha un ROIC molto sopra il gruppo, chiediti se sia difendibile e dillo.
· Un margine alto non è qualità se non si trasforma in cassa. La conversione dell'utile in FCF e l'accrual ratio hanno la precedenza sul margine dichiarato.

Nel giudizio pesa questi elementi nell'ordine: prima la veridicità dei numeri (accrual, capitalizzazioni, reperti documentali, red flag), poi la qualità operativa e la solvibilità, e solo alla fine il prezzo. Un'impresa con bandiere rosse contabili non può essere raccomandata perché costa poco.

· Il sesto pilastro confronta il valore intrinseco stimato col DCF e il prezzo che il mercato chiede oggi: upside, margine di sicurezza e rapporto prezzo/valore. Trattalo come l'ultimo dei criteri, mai come il primo — uno sconto ampio su un'impresa con utili di bassa qualità non è un'occasione, è il mercato che ha già scontato il problema. Quando lo commenti, ricorda che un DCF dipende dalle assunzioni su WACC e crescita terminale: il segno del divario conta più della sua precisione, e le imprese non quotate restano fuori da questo confronto senza che ciò le penalizzi.

Attenzione alla copertura dei dati: un'impresa con copertura bassa ha un punteggio costruito su meno informazioni, e la sua posizione in classifica è meno affidabile. Dillo esplicitamente quando accade.

Rispondi in italiano, con questa struttura JSON esatta:
{
  "sintesi": "<tre o quattro frasi: chi è la migliore, chi la peggiore, e qual è il fatto più importante emerso>",
  "vincitore": {
    "azienda": "<nome>",
    "perche": "<le due o tre ragioni decisive>",
    "a_quali_condizioni": "<cosa dovrebbe restare vero perché il giudizio regga>"
  },
  "classifica_commentata": [
    { "azienda": "<nome>", "posizione": <numero>, "giudizio": "<due o tre frasi>",
      "punti_di_forza": ["<...>"], "punti_di_debolezza": ["<...>"],
      "affidabilita_del_giudizio": "alta|media|bassa",
      "perche_affidabilita": "<una frase, tipicamente sulla copertura dei dati>" }
  ],
  "anomalie": [
    { "azienda": "<nome>", "voce": "<quale metrica o fenomeno>",
      "natura": "transitoria|permanente|da_verificare",
      "spiegazione": "<perché la classifichi così>" }
  ],
  "dove_il_punteggio_inganna": ["<casi in cui la classifica numerica dice una cosa e la lettura ragionata un'altra>"],
  "mean_reversion": ["<imprese il cui rendimento è lontano dalla mediana e cosa aspettarsi>"],
  "cosa_verificare_sui_documenti": ["<verifiche che i soli numeri non permettono di chiudere>"],
  "avvertenze_metodologiche": ["<limiti di questa comparazione: omogeneità, dati mancanti, dimensione del campione>"]
}`;

const PROMPT_DOCUMENTALE = `Sei un analista forense di bilancio. Ricevi la NOTA INTEGRATIVA o la RELAZIONE SULLA GESTIONE di un'impresa e devi cercare esclusivamente ciò che i prospetti contabili NON mostrano ma che altera il giudizio comparativo.

Cerca, e riporta solo se effettivamente presente nel documento:

1. DEBITO OCCULTO — operazioni di reverse factoring, confirming, cartolarizzazioni, cessioni pro-solvendo di crediti e anticipi salvo buon fine. Sono debito finanziario travestito da debito commerciale: gonfiano il free cash flow e migliorano artificialmente la posizione finanziaria netta. Se l'impresa cede crediti pro-solvendo, il rischio resta suo e il credito andrebbe reinserito fra le attività con l'anticipo bancario fra i debiti finanziari.
2. LEASING NON CAPITALIZZATO — beni usati ma non iscritti all'attivo, con i relativi debiti fuori dal passivo. Riporta i canoni futuri se indicati.
3. POLITICHE DI CAPITALIZZAZIONE — costi di sviluppo, software, ricerca portati a stato patrimoniale anziché a conto economico, e i criteri di ammortamento applicati. Segnala vite utili anomale rispetto alla prassi.
4. PASSIVITÀ POTENZIALI — contenziosi in corso, accertamenti tributari, garanzie prestate, impegni fuori bilancio, fondi rischi ritenuti incapienti.
5. PARTI CORRELATE — operazioni infragruppo a condizioni non di mercato.
6. FISCALITÀ — strutture transfrontaliere e aliquote effettive lontane dalla nominale.
7. CRITERI DI VALUTAZIONE — cambiamenti di principio contabile, di stima o di perimetro che rompono la comparabilità con gli esercizi precedenti o con i concorrenti.

Regole tassative:
· Riporta SOLO ciò che è scritto nel documento. Non dedurre, non stimare, non completare.
· Ogni reperto deve avere una citazione testuale breve presa dal documento.
· Se non trovi nulla su un tema, semplicemente non lo includi: un elenco corto e vero vale più di uno lungo e inventato.
· La gravità è "critico" solo se il reperto cambierebbe il giudizio comparativo; "attenzione" se merita una verifica; "presidiato" se il documento stesso ne dà conto in modo adeguato.

Rispondi in italiano con questo JSON esatto:
{
  "sintesi": "<due frasi: cosa dice il documento che i numeri non dicono>",
  "reperti": [
    { "tema": "debito_occulto|leasing|capitalizzazioni|passivita_potenziali|parti_correlate|fiscalita|criteri_valutazione",
      "gravita": "critico|attenzione|presidiato",
      "sintesi": "<una o due frasi>",
      "citazione": "<estratto testuale breve dal documento>",
      "pagina": <numero o null>,
      "effetto_sul_confronto": "<quale metrica falserebbe e in che direzione>" }
  ]
}`;

/* ═══════════════════════════════════════════════════════════════════════════
   [12-octies] ANALISI MULTIVARIATA E MEAN REVERSION (§7.10, §7.13)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Autovalori e autovettori di una matrice simmetrica, con il metodo di Jacobi
 * ciclico. Serve all'analisi delle componenti principali: non c'è una libreria
 * da importare, e per una matrice di dieci variabili il metodo converge in
 * poche spazzate.
 */
export function jacobiEigen(matrice, spazzate = 60) {
  const n = matrice.length;
  const a = matrice.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let s = 0; s < spazzate; s++) {
    let fuoriDiagonale = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) fuoriDiagonale += a[i][j] * a[i][j];
    if (fuoriDiagonale < 1e-14) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const segno = theta >= 0 ? 1 : -1;
        const t = segno / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - sn * akq;
          a[k][q] = sn * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - sn * aqk;
          a[q][k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - sn * vkq;
          V[k][q] = sn * vkp + c * vkq;
        }
      }
    }
  }

  return a
    .map((r, i) => ({ valore: r[i], vettore: V.map((riga) => riga[i]) }))
    .sort((x, y) => y.valore - x.valore);
}

/** Metriche su cui si costruisce il piano fattoriale: poche e non ridondanti. */
export const VARIABILI_ACP = [
  "roic", "ebitda_margin", "fcf_conversion", "ccc", "asset_turnover",
  "accrual_ratio", "nd_ebitda", "interest_coverage", "leverage", "delta_roic",
];

/**
 * Analisi delle componenti principali (§7.13-A).
 *
 * Molti indici misurano la stessa cosa: il metodo li fonde in poche variabili
 * di sintesi, così che un piano cartesiano basti a posizionare tutte le
 * imprese insieme. Le variabili con verso «basso è meglio» vengono invertite di
 * segno prima della standardizzazione: senza, la prima componente mescolerebbe
 * pregi e difetti e non sarebbe leggibile come «salute complessiva».
 *
 * I valori mancanti sono imputati con la media della colonna — cioè con zero
 * dopo la standardizzazione: è l'imputazione neutra, coerente con il
 * trattamento riservato altrove ai dati assenti.
 */
export function componentiPrincipali(comparazione, variabili = VARIABILI_ACP) {
  const lista = comparazione.lista;
  if (lista.length < 3) return null;

  const usabili = variabili.filter((id) => {
    const m = METRICA_DI[id];
    if (!m) return false;
    const validi = lista.filter((a) => isNum(comparazione.celle[a.chiave][id].valore)).length;
    return validi >= Math.max(2, Math.ceil(lista.length / 2));
  });
  if (usabili.length < 2) return null;

  /* 1. matrice grezza, con il segno già orientato a «più alto = meglio» */
  const grezza = lista.map((a) =>
    usabili.map((id) => {
      const v = comparazione.celle[a.chiave][id].valore;
      if (!isNum(v)) return null;
      return METRICA_DI[id].verso === "basso" ? -v : v;
    })
  );

  /* 2. standardizzazione per colonna, con imputazione dei mancanti alla media */
  const p = usabili.length;
  const medie = [];
  const scarti = [];
  for (let j = 0; j < p; j++) {
    const col = grezza.map((r) => r[j]).filter(isNum);
    const mu = col.reduce((s, x) => s + x, 0) / col.length;
    const sd = Math.sqrt(col.reduce((s, x) => s + (x - mu) ** 2, 0) / col.length) || 1;
    medie.push(mu);
    scarti.push(sd);
  }
  const Z = grezza.map((r) => r.map((v, j) => (isNum(v) ? (v - medie[j]) / scarti[j] : 0)));

  /* 3. matrice di correlazione e sue componenti principali */
  const n = Z.length;
  const C = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) / Math.max(1, n - 1))
  );
  const eigen = jacobiEigen(C);
  const totale = eigen.reduce((s, e) => s + Math.max(0, e.valore), 0) || 1;

  const c1 = eigen[0];
  const c2 = eigen[1] || { valore: 0, vettore: usabili.map(() => 0) };

  /* 4. proiezione delle imprese sul piano. Il verso di C1 è arbitrario
     (un autovettore e il suo opposto valgono uguale): lo si fissa in modo che
     valori alti significhino salute, altrimenti il grafico si leggerebbe al
     contrario a ogni ricalcolo. */
  const segno1 = c1.vettore.reduce((s, x) => s + x, 0) >= 0 ? 1 : -1;
  const segno2 = c2.vettore.reduce((s, x) => s + x, 0) >= 0 ? 1 : -1;

  const punti = lista.map((a, i) => ({
    chiave: a.chiave,
    nome: a.nome,
    c1: segno1 * Z[i].reduce((s, z, j) => s + z * c1.vettore[j], 0),
    c2: segno2 * Z[i].reduce((s, z, j) => s + z * c2.vettore[j], 0),
  }));

  const carichi = usabili.map((id, j) => ({
    id,
    label: METRICA_DI[id].label,
    c1: segno1 * c1.vettore[j],
    c2: segno2 * c2.vettore[j],
  }));

  return {
    punti,
    carichi,
    variabili: usabili,
    varianzaC1: Math.max(0, c1.valore) / totale,
    varianzaC2: Math.max(0, c2.valore) / totale,
    robusta: lista.length >= usabili.length,
  };
}

/**
 * Traiettoria di ritorno verso la mediana (§7.10, fade diagram).
 *
 * Nel tempo i rendimenti tendono a tornare verso la media: se un'impresa
 * guadagna molto, i concorrenti la copiano, entrano nuovi rivali, i prezzi
 * scendono. Se perde, fallisce o cambia strategia. La proiezione chiude una
 * quota fissa del divario ogni anno — non è una previsione, è la domanda che
 * l'analista deve porsi: che cosa rende difendibile questo scarto?
 */
export function traiettoriaFade(valorePartenza, mediana, anni = 5, velocita = 0.25) {
  if (!isNum(valorePartenza) || !isNum(mediana)) return [];
  const out = [];
  let v = valorePartenza;
  for (let i = 1; i <= anni; i++) {
    v = mediana + (v - mediana) * (1 - velocita);
    out.push(v);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-novies] POSIZIONAMENTO — isoquanti, piano fattoriale, fade diagram
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Isoquanti del ROI (§7.12).
 *
 * L'identità è esatta e non approssimata:
 *     ROI = MON / COIN = (MON / ricavi) × (ricavi / COIN) = ROS × rotazione
 * Ogni curva del grafico unisce quindi i punti che producono lo stesso ROI, e
 * mostra che due imprese possono guadagnare identicamente con modelli opposti:
 * una vende poco a prezzi alti (in alto a sinistra), l'altra vende molto a
 * prezzi bassi (in basso a destra). È il modello competitivo, che il solo
 * numero del ROI nasconde.
 */
function Isoquanti({ aziende, anno, colori }) {
  const L = 62;
  const R = 20;
  const T = 18;
  const B = 44;
  const W = 720;
  const H = 400;

  const punti = Object.values(aziende)
    .map((a) => {
      const e = a.esercizi?.[anno];
      const mon = e?.ce?.mon ?? e?.ce?.ebit;
      const ricavi = e?.ce?.ricavi;
      const coin = e?.sp?.coin;
      const ros = safeDiv(mon, ricavi);
      const pc = safeDiv(ricavi, coin);
      if (!isNum(ros) || !isNum(pc)) return null;
      return { chiave: a.chiave, nome: a.nome, ros, pc, roi: ros * pc };
    })
    .filter(Boolean);

  if (punti.length < 2) {
    return (
      <div className="text-[12.5px] py-8 text-center" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
        Servono almeno due aziende con MON, ricavi e capitale operativo per l'esercizio {anno}.
      </div>
    );
  }

  const rosMax = Math.max(0.02, Math.max(...punti.map((p) => p.ros)) * 1.35);
  const pcMax = Math.max(0.3, Math.max(...punti.map((p) => p.pc)) * 1.3);
  const rosMin = Math.min(0, Math.min(...punti.map((p) => p.ros)) * 1.2);

  const x = (v) => L + ((v - rosMin) / (rosMax - rosMin)) * (W - L - R);
  const y = (v) => T + (1 - v / pcMax) * (H - T - B);

  /* Livelli di ROI da tracciare: quelli che attraversano davvero l'area del
     grafico, per non disegnare curve che nessuno può raggiungere. */
  const livelli = [0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35].filter(
    (r) => r / rosMax < pcMax && r / Math.max(rosMin, 0.005) > 0
  );

  const curva = (roi) => {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const ros = Math.max(0.002, rosMin) + (rosMax - Math.max(0.002, rosMin)) * (i / 80);
      const pc = roi / ros;
      if (pc > pcMax || pc <= 0) continue;
      pts.push(`${pts.length === 0 ? "M" : "L"}${x(ros).toFixed(1)},${y(pc).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = pcMax * f;
        return (
          <g key={`h${f}`}>
            <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={LINE} strokeWidth="0.8" />
            <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" style={{ fontSize: 10, fill: "#8A917F", fontFamily: FONT_MONO }}>
              {v.toFixed(2)}x
            </text>
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = rosMin + (rosMax - rosMin) * f;
        return (
          <g key={`v${f}`}>
            <line x1={x(v)} y1={T} x2={x(v)} y2={H - B} stroke={LINE} strokeWidth="0.8" />
            <text x={x(v)} y={H - B + 16} textAnchor="middle" style={{ fontSize: 10, fill: "#8A917F", fontFamily: FONT_MONO }}>
              {pct(v, 0)}
            </text>
          </g>
        );
      })}

      {livelli.map((roi) => {
        const d = curva(roi);
        if (!d) return null;
        // Etichetta sulla curva, all'altezza in cui incontra il bordo destro.
        const rosEtichetta = rosMax * 0.86;
        const pcEtichetta = roi / rosEtichetta;
        return (
          <g key={roi}>
            <path d={d} fill="none" stroke="#B6BDB0" strokeWidth="1.1" strokeDasharray="4 3" />
            {pcEtichetta > 0 && pcEtichetta < pcMax * 0.96 ? (
              <text
                x={x(rosEtichetta)}
                y={y(pcEtichetta) - 5}
                textAnchor="middle"
                style={{ fontSize: 9.5, fill: "#8A917F", fontFamily: FONT_MONO, fontWeight: 700 }}
              >
                ROI {pct(roi, 0)}
              </text>
            ) : null}
          </g>
        );
      })}

      {punti.map((p) => (
        <g key={p.chiave}>
          <circle cx={x(p.ros)} cy={y(p.pc)} r="7" fill={colori[p.chiave]} fillOpacity="0.85" stroke="#fff" strokeWidth="1.6" />
          <text
            x={x(p.ros)}
            y={y(p.pc) - 13}
            textAnchor="middle"
            style={{ fontSize: 10.5, fontWeight: 700, fill: colori[p.chiave], fontFamily: FONT_BODY }}
          >
            {p.nome.split(" ")[0]}
          </text>
          <text
            x={x(p.ros)}
            y={y(p.pc) + 20}
            textAnchor="middle"
            style={{ fontSize: 9.5, fill: "#5A6159", fontFamily: FONT_MONO }}
          >
            ROI {pct(p.roi, 1)}
          </text>
        </g>
      ))}

      <text x={(W + L) / 2} y={H - 8} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: INK, fontFamily: FONT_BODY }}>
        Redditività delle vendite — ROS = MON ÷ ricavi
      </text>
      <text
        x={14}
        y={(H - B + T) / 2}
        textAnchor="middle"
        transform={`rotate(-90 14 ${(H - B + T) / 2})`}
        style={{ fontSize: 11, fontWeight: 700, fill: INK, fontFamily: FONT_BODY }}
      >
        Produttività del capitale — ricavi ÷ COIN
      </text>
    </svg>
  );
}

/**
 * Piano fattoriale delle componenti principali (§7.13-A).
 * Con dieci indici e otto imprese la mente umana non regge il confronto
 * simultaneo: le componenti li fondono in due assi di sintesi, e un piano
 * cartesiano basta a collocare tutti.
 */
function PianoACP({ acp, colori }) {
  const L = 54;
  const R = 20;
  const T = 20;
  const B = 46;
  const W = 720;
  const H = 420;

  if (!acp) {
    return (
      <div className="text-[12.5px] py-8 text-center" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
        Servono almeno tre aziende e due variabili sufficientemente popolate per costruire il piano fattoriale.
      </div>
    );
  }

  const xs = acp.punti.map((p) => p.c1);
  const ys = acp.punti.map((p) => p.c2);
  const ampiezza = (arr) => {
    const m = Math.max(Math.abs(Math.min(...arr)), Math.abs(Math.max(...arr)));
    return Math.max(0.6, m * 1.3);
  };
  const ax = ampiezza(xs);
  const ay = ampiezza(ys);

  const x = (v) => L + ((v + ax) / (2 * ax)) * (W - L - R);
  const y = (v) => T + (1 - (v + ay) / (2 * ay)) * (H - T - B);

  const quadranti = [
    { testo: "solide e finanziariamente equilibrate", qx: 0.75, qy: 0.2 },
    { testo: "redditizie ma tirate finanziariamente", qx: 0.75, qy: 0.82 },
    { testo: "prudenti ma poco redditizie", qx: 0.2, qy: 0.2 },
    { testo: "fragili su entrambi i fronti", qx: 0.2, qy: 0.82 },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="#FAFBF9" stroke={LINE} />
      {quadranti.map((q, i) => (
        <text
          key={i}
          x={L + (W - L - R) * q.qx}
          y={T + (H - T - B) * q.qy}
          textAnchor="middle"
          style={{ fontSize: 10, fill: "#C2C8BC", fontFamily: FONT_BODY, fontStyle: "italic" }}
        >
          {q.testo}
        </text>
      ))}

      <line x1={x(0)} y1={T} x2={x(0)} y2={H - B} stroke="#8A917F" strokeWidth="1.2" />
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke="#8A917F" strokeWidth="1.2" />

      {/* Carichi delle variabili: dicono che cosa significano gli assi. */}
      {acp.carichi.map((c) => {
        const fx = x(c.c1 * ax * 0.78);
        const fy = y(c.c2 * ay * 0.78);
        return (
          <g key={c.id}>
            <line x1={x(0)} y1={y(0)} x2={fx} y2={fy} stroke="#C2C8BC" strokeWidth="0.9" />
            <text
              x={fx}
              y={fy}
              textAnchor={c.c1 >= 0 ? "start" : "end"}
              dominantBaseline="middle"
              style={{ fontSize: 8.5, fill: "#96A08F", fontFamily: FONT_BODY }}
            >
              {c.label}
            </text>
          </g>
        );
      })}

      {acp.punti.map((p) => (
        <g key={p.chiave}>
          <circle cx={x(p.c1)} cy={y(p.c2)} r="8" fill={colori[p.chiave]} fillOpacity="0.9" stroke="#fff" strokeWidth="2" />
          <text
            x={x(p.c1)}
            y={y(p.c2) - 14}
            textAnchor="middle"
            style={{ fontSize: 11, fontWeight: 700, fill: colori[p.chiave], fontFamily: FONT_BODY }}
          >
            {p.nome.split(" ")[0]}
          </text>
        </g>
      ))}

      <text x={(W + L) / 2} y={H - 8} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: INK, fontFamily: FONT_BODY }}>
        C1 — sintesi della salute complessiva ({pct(acp.varianzaC1, 0)} della varianza)
      </text>
      <text
        x={14}
        y={(H - B + T) / 2}
        textAnchor="middle"
        transform={`rotate(-90 14 ${(H - B + T) / 2})`}
        style={{ fontSize: 11, fontWeight: 700, fill: INK, fontFamily: FONT_BODY }}
      >
        C2 — secondo contrasto ({pct(acp.varianzaC2, 0)})
      </text>
    </svg>
  );
}

/**
 * Fade diagram (§7.10): la traiettoria storica del ROIC e la proiezione del
 * ritorno verso la mediana del gruppo. Non è una previsione — è la domanda che
 * l'analista deve porsi davanti a uno scarto molto ampio.
 */
function FadeDiagram({ aziende, anni, serieComparazioni, colori, velocita }) {
  const cresc = [...anni].sort((a, b) => a - b);
  const lista = Object.values(aziende);
  const orizzonte = 5;

  const storici = lista.map((a) => ({
    chiave: a.chiave,
    nome: a.nome,
    valori: cresc.map((anno) => serieComparazioni?.[anno]?.celle?.[a.chiave]?.roic?.valore ?? null),
  }));

  const ultimoAnno = cresc[cresc.length - 1];
  const valoriUltimi = lista
    .map((a) => serieComparazioni?.[ultimoAnno]?.celle?.[a.chiave]?.roic?.valore)
    .filter(isNum);
  const mediana = quantile(valoriUltimi, 0.5);

  if (!isNum(mediana) || cresc.length < 2) {
    return (
      <div className="text-[12.5px] py-8 text-center" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
        Servono almeno due esercizi e un ROIC calcolabile per disegnare il ritorno verso la mediana.
      </div>
    );
  }

  const proiezioni = storici.map((s) => {
    const ultimo = s.valori[s.valori.length - 1];
    return { ...s, futuro: traiettoriaFade(ultimo, mediana, orizzonte, velocita) };
  });

  const L = 62;
  const R = 20;
  const T = 16;
  const B = 34;
  const W = 720;
  const H = 320;

  const etichette = [...cresc, ...Array.from({ length: orizzonte }, (_, i) => ultimoAnno + i + 1)];
  const tutti = [
    ...storici.flatMap((s) => s.valori.filter(isNum)),
    ...proiezioni.flatMap((s) => s.futuro),
    mediana,
  ];
  let min = Math.min(...tutti);
  let max = Math.max(...tutti);
  const marg = (max - min) * 0.12 || 0.02;
  min -= marg;
  max += marg;

  const x = (i) => L + (i / (etichette.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);

  const percorso = (valori, offset = 0) => {
    let d = "";
    let aperto = false;
    valori.forEach((v, i) => {
      if (!isNum(v)) {
        aperto = false;
        return;
      }
      d += `${aperto ? "L" : "M"}${x(i + offset).toFixed(1)},${y(v).toFixed(1)} `;
      aperto = true;
    });
    return d.trim();
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = min + (max - min) * f;
        return (
          <g key={f}>
            <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={LINE} strokeWidth="0.8" />
            <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" style={{ fontSize: 10, fill: "#8A917F", fontFamily: FONT_MONO }}>
              {pct(v, 1)}
            </text>
          </g>
        );
      })}

      <rect x={x(cresc.length - 1)} y={T} width={W - R - x(cresc.length - 1)} height={H - T - B} fill="#8A917F" fillOpacity="0.05" />
      <line x1={x(cresc.length - 1)} y1={T} x2={x(cresc.length - 1)} y2={H - B} stroke="#8A917F" strokeWidth="1" strokeDasharray="3 3" />

      <line x1={L} y1={y(mediana)} x2={W - R} y2={y(mediana)} stroke="#8A917F" strokeWidth="1.8" strokeDasharray="7 4" />
      <text x={W - R - 4} y={y(mediana) - 6} textAnchor="end" style={{ fontSize: 10, fontWeight: 700, fill: "#5A6159", fontFamily: FONT_BODY }}>
        mediana del gruppo {pct(mediana, 1)}
      </text>

      {etichette.map((a, i) =>
        i % 2 === 0 || i === etichette.length - 1 ? (
          <text key={a} x={x(i)} y={H - B + 15} textAnchor="middle" style={{ fontSize: 10, fill: i >= cresc.length ? "#A8AFA2" : "#5A6159", fontFamily: FONT_MONO }}>
            {a}
          </text>
        ) : null
      )}

      {proiezioni.map((s) => (
        <g key={s.chiave}>
          <path d={percorso(s.valori)} fill="none" stroke={colori[s.chiave]} strokeWidth="2.2" />
          <path
            d={percorso([s.valori[s.valori.length - 1], ...s.futuro], cresc.length - 1)}
            fill="none"
            stroke={colori[s.chiave]}
            strokeWidth="1.8"
            strokeDasharray="5 4"
            opacity="0.75"
          />
          {s.valori.map((v, i) => (isNum(v) ? <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={colori[s.chiave]} /> : null))}
        </g>
      ))}
    </svg>
  );
}

function Posizionamento({ aziende, anno, anni, comparazione, serieComparazioni }) {
  const [velocita, setVelocita] = useState(0.25);
  const lista = comparazione.lista;
  const colori = Object.fromEntries(
    [...lista]
      .sort((a, b) => (comparazione.esiti[b.chiave].punteggio ?? -1) - (comparazione.esiti[a.chiave].punteggio ?? -1))
      .map((a, i) => [a.chiave, coloreDi(i)])
  );
  const acp = useMemo(() => componentiPrincipali(comparazione), [comparazione]);

  return (
    <div>
      <SectionCard titolo="Isoquanti del ROI" eyebrow="§7.12 · il modello competitivo" accento={GREEN}>
        <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          L'identità è esatta: <strong>ROI = ROS × rotazione del capitale</strong>. Ogni curva tratteggiata unisce i
          punti che producono lo stesso ROI. Due imprese sulla stessa curva guadagnano identicamente ma con modelli
          opposti: in alto a sinistra chi vende poco a margini alti, in basso a destra chi vende molto a margini
          sottili. È la differenza fra un produttore di lusso e un distributore di volume — e il solo numero del ROI la
          nasconde del tutto.
        </p>
        <Isoquanti aziende={aziende} anno={anno} colori={colori} />
      </SectionCard>

      <SectionCard
        titolo="Piano delle componenti principali"
        eyebrow="§7.13 · analisi multivariata"
        accento={PURPLE}
      >
        <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Molti indici misurano la stessa cosa. L'analisi delle componenti principali li fonde in due variabili di
          sintesi, così che un piano cartesiano basti a collocare tutte le imprese insieme. I raggi grigi sono i
          carichi delle variabili originarie: indicano in quale direzione tira ciascun indice, e quindi cosa
          significano davvero gli assi in questo specifico gruppo.
        </p>
        <PianoACP acp={acp} colori={colori} />
        {acp ? (
          <div className="mt-2 text-[11.5px]" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            Le due componenti spiegano insieme il {pct(acp.varianzaC1 + acp.varianzaC2, 0)} della varianza su{" "}
            {acp.variabili.length} indici.
            {!acp.robusta ? (
              <>
                {" "}
                <strong style={{ color: AMBER }}>
                  Con {lista.length} imprese e {acp.variabili.length} variabili il piano è descrittivo, non
                  statisticamente robusto:
                </strong>{" "}
                serve almeno un'impresa per variabile perché le componenti abbiano un fondamento. Leggilo come una mappa
                delle somiglianze, non come un risultato inferenziale.
              </>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        titolo="Ritorno verso la mediana"
        eyebrow="§7.10 · fade diagram"
        accento={BLUE}
        toolbar={
          <label className="flex items-center gap-2">
            <span className="text-[11.5px]" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
              Velocità di convergenza
            </span>
            <input
              type="range"
              min="5"
              max="60"
              value={Math.round(velocita * 100)}
              onChange={(e) => setVelocita(Number(e.target.value) / 100)}
              style={{ width: 120 }}
            />
            <span className="text-[12px] font-bold" style={{ color: BLUE, fontFamily: FONT_MONO }}>
              {Math.round(velocita * 100)}%
            </span>
          </label>
        }
      >
        <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Nel tempo i rendimenti tendono a tornare verso la media: chi guadagna molto viene copiato, attira nuovi
          concorrenti e vede scendere i prezzi; chi perde fallisce o cambia strategia. Il tratteggio proietta la chiusura
          di una quota fissa del divario ogni anno. <strong>Non è una previsione</strong>: è la domanda che l'analista
          deve porsi davanti a uno scarto ampio — che cosa lo rende difendibile? Brevetti, posizione dominante, costi
          strutturalmente più bassi? Se la risposta non c'è, nelle proiezioni va ipotizzata la discesa.
        </p>
        <FadeDiagram
          aziende={aziende}
          anni={anni}
          serieComparazioni={serieComparazioni}
          colori={colori}
          velocita={velocita}
        />
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [12-decies] RELAZIONE COMPARATIVA E ANALISI DOCUMENTALE
   ═══════════════════════════════════════════════════════════════════════════ */

function ConfigIA({ config, onCambia }) {
  const modelli = MODELLI[config.provider] || MODELLI.claude;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Provider
        </span>
        <select
          value={config.provider}
          onChange={(e) => {
            const p = e.target.value;
            onCambia({ provider: p, model: MODELLI[p][0].id });
          }}
          className="px-2 py-1 rounded text-[12.5px]"
          style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
        >
          <option value="claude">Claude (Anthropic)</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Modello
        </span>
        <select
          value={config.model}
          onChange={(e) => onCambia({ model: e.target.value })}
          className="px-2 py-1 rounded text-[12.5px]"
          style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
        >
          {modelli.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
          Chiave API
          {config.provider === "claude" && AMBIENTE_AUTENTICA ? " (non necessaria qui)" : ""}
        </span>
        <input
          type="password"
          value={config.apiKey === "__subscription__" ? "" : config.apiKey}
          placeholder={config.provider === "claude" && AMBIENTE_AUTENTICA ? "autentica l'ambiente ospite" : "sk-…"}
          onChange={(e) => onCambia({ apiKey: e.target.value || "__subscription__" })}
          className="px-2 py-1 rounded text-[12.5px]"
          style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_MONO }}
        />
      </label>
    </div>
  );
}

function ElencoPuntato({ titolo, voci, colore }) {
  if (!Array.isArray(voci) || !voci.length) return null;
  return (
    <div className="mb-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: colore, fontFamily: FONT_BODY }}>
        {titolo}
      </div>
      <ul className="space-y-1">
        {voci.map((v, i) => (
          <li key={i} className="text-[12.5px] pl-3 relative" style={{ color: "#3A4139", fontFamily: FONT_BODY }}>
            <span className="absolute left-0" style={{ color: colore }}>
              ·
            </span>
            {typeof v === "string" ? v : JSON.stringify(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelazioneRenderizzata({ r }) {
  if (!r) return null;
  const tono = { alta: "ok", media: "warn", bassa: "bad" };
  return (
    <div>
      {r.sintesi ? (
        <div className="rounded-lg p-4 mb-4" style={{ background: "#F4F6F2", borderLeft: `4px solid ${INK}` }}>
          <div className="text-[10.5px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#5A6159" }}>
            Sintesi
          </div>
          <p className="text-[13.5px] leading-relaxed" style={{ color: INK, fontFamily: FONT_BODY }}>
            {r.sintesi}
          </p>
        </div>
      ) : null}

      {r.vincitore?.azienda ? (
        <div className="rounded-lg p-4 mb-4" style={{ background: "#E2EFE6", border: "1px solid #BFDBCA" }}>
          <div className="text-[10.5px] font-bold uppercase tracking-widest mb-1" style={{ color: "#14503A" }}>
            La migliore del gruppo
          </div>
          <div className="text-[17px] font-extrabold mb-1.5" style={{ color: "#14503A", fontFamily: FONT_HEAD }}>
            {r.vincitore.azienda}
          </div>
          <p className="text-[13px] mb-2" style={{ color: "#1E5A44", fontFamily: FONT_BODY }}>
            {r.vincitore.perche}
          </p>
          {r.vincitore.a_quali_condizioni ? (
            <p className="text-[12px]" style={{ color: "#3E6B57", fontFamily: FONT_BODY }}>
              <strong>A quali condizioni:</strong> {r.vincitore.a_quali_condizioni}
            </p>
          ) : null}
        </div>
      ) : null}

      {Array.isArray(r.classifica_commentata) && r.classifica_commentata.length ? (
        <div className="space-y-3 mb-4">
          {r.classifica_commentata.map((c, i) => (
            <div key={i} className="rounded-lg p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="font-bold text-[14px]" style={{ color: INK, fontFamily: FONT_HEAD }}>
                  {isNum(c.posizione) ? `${c.posizione}° · ` : ""}
                  {c.azienda}
                </div>
                {c.affidabilita_del_giudizio ? (
                  <Badge tono={tono[c.affidabilita_del_giudizio] || "neutro"}>
                    affidabilità {c.affidabilita_del_giudizio}
                  </Badge>
                ) : null}
              </div>
              <p className="text-[12.5px] mb-2" style={{ color: "#3A4139", fontFamily: FONT_BODY }}>
                {c.giudizio}
              </p>
              {c.perche_affidabilita ? (
                <p className="text-[11.5px] mb-2" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
                  {c.perche_affidabilita}
                </p>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ElencoPuntato titolo="Punti di forza" voci={c.punti_di_forza} colore={GREEN} />
                <ElencoPuntato titolo="Punti di debolezza" voci={c.punti_di_debolezza} colore={RED} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {Array.isArray(r.anomalie) && r.anomalie.length ? (
        <div className="rounded-lg p-4 mb-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <div className="text-[10.5px] font-bold uppercase tracking-widest mb-2" style={{ color: PURPLE }}>
            Anomalie — transitorie o permanenti
          </div>
          <p className="text-[11.5px] mb-2.5" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            È la distinzione decisiva: un'anomalia transitoria sparirà da sola, una permanente va riportata nelle
            previsioni future.
          </p>
          <div className="space-y-2">
            {r.anomalie.map((a, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Badge tono={a.natura === "permanente" ? "bad" : a.natura === "transitoria" ? "warn" : "neutro"}>
                  {a.natura}
                </Badge>
                <div className="text-[12.5px] flex-1" style={{ color: "#3A4139", fontFamily: FONT_BODY }}>
                  <strong>{a.azienda}</strong>
                  {a.voce ? ` — ${a.voce}` : ""}: {a.spiegazione}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <ElencoPuntato titolo="Dove il punteggio inganna" voci={r.dove_il_punteggio_inganna} colore={AMBER} />
          <ElencoPuntato titolo="Ritorno verso la media" voci={r.mean_reversion} colore={BLUE} />
        </div>
        <div className="rounded-lg p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <ElencoPuntato titolo="Da verificare sui documenti" voci={r.cosa_verificare_sui_documenti} colore={PURPLE} />
          <ElencoPuntato titolo="Avvertenze metodologiche" voci={r.avvertenze_metodologiche} colore={"#5A6159"} />
        </div>
      </div>

      {r.__troncato ? (
        <div className="mt-3 rounded p-2.5 text-[12px]" style={{ background: "#FAECD8", border: "1px solid #EBD4AC", color: "#7A5A16" }}>
          La risposta del modello è arrivata troncata ed è stata riparata: le ultime sezioni potrebbero essere
          incomplete. Rigenerala per averla intera.
        </div>
      ) : null}
    </div>
  );
}

const GRAVITA_TONO = { critico: "bad", attenzione: "warn", presidiato: "ok" };

const TEMI_DOC = {
  debito_occulto: "Debito occulto",
  leasing: "Leasing non capitalizzato",
  capitalizzazioni: "Politiche di capitalizzazione",
  passivita_potenziali: "Passività potenziali",
  parti_correlate: "Parti correlate",
  fiscalita: "Fiscalità",
  criteri_valutazione: "Criteri di valutazione",
};

function AnalisiDocumentale({ aziende, config, onRisultato }) {
  const [stato, setStato] = useState({});
  const input = useRef(null);
  const [bersaglio, setBersaglio] = useState(null);

  const analizza = async (chiave, file) => {
    setStato((s) => ({ ...s, [chiave]: { fase: "Suddivisione del PDF", errore: null } }));
    try {
      const porzioni = await pdfToChunks(file);
      const reperti = [];
      let sintesi = [];

      for (let i = 0; i < porzioni.length; i++) {
        setStato((s) => ({
          ...s,
          [chiave]: { fase: `Lettura porzione ${i + 1} di ${porzioni.length}`, errore: null },
        }));
        const testo = await chiamaIAConRitentativi(
          {
            provider: config.provider,
            apiKey: config.apiKey,
            model: config.model,
            prompt:
              PROMPT_DOCUMENTALE +
              `\n\nAzienda: ${aziende[chiave]?.nome || "—"}.` +
              (porzioni[i].to
                ? `\nQuesta porzione copre le pagine da ${porzioni[i].from} a ${porzioni[i].to} del documento originale: usa questa numerazione nel campo "pagina".`
                : ""),
            pdfBase64: porzioni[i].data,
          },
          {
            onRitento: (n, attesa) =>
              setStato((s) => ({
                ...s,
                [chiave]: { fase: `Ritentativo ${n} fra ${Math.round(attesa / 100) / 10}s`, errore: null },
              })),
          }
        );
        const parsed = parseJsonRobusto(testo);
        if (Array.isArray(parsed.reperti)) reperti.push(...parsed.reperti.filter(Boolean));
        if (parsed.sintesi) sintesi.push(parsed.sintesi);
      }

      const critici = reperti.filter((r) => slug(r.gravita) === "critico").length;
      onRisultato(chiave, { reperti, critici, sintesi: sintesi.join(" "), documento: file.name });
      setStato((s) => ({ ...s, [chiave]: { fase: null, errore: null, fatto: reperti.length } }));
    } catch (e) {
      setStato((s) => ({ ...s, [chiave]: { fase: null, errore: e?.message || String(e) } }));
    }
  };

  return (
    <div className="space-y-2.5">
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && bersaglio) analizza(bersaglio, f);
          e.target.value = "";
        }}
      />
      {Object.values(aziende).map((a) => {
        const s = stato[a.chiave] || {};
        const doc = a.documentale;
        return (
          <div key={a.chiave} className="rounded p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-[13px] truncate" style={{ color: INK, fontFamily: FONT_BODY }}>
                  {a.nome}
                </div>
                <div className="text-[11.5px]" style={{ color: s.errore ? RED : "#5A6159", fontFamily: FONT_BODY }}>
                  {s.errore
                    ? s.errore
                    : s.fase
                    ? s.fase
                    : doc
                    ? `${doc.documento} — ${doc.reperti.length} reperti, ${doc.critici} critici`
                    : "nessun documento analizzato"}
                </div>
              </div>
              <button
                disabled={!!s.fase}
                onClick={() => {
                  setBersaglio(a.chiave);
                  setTimeout(() => input.current?.click(), 0);
                }}
                className="px-3 py-1.5 rounded text-[12px] font-semibold shrink-0"
                style={{
                  border: `1px solid ${LINE}`,
                  color: s.fase ? "#A8AFA2" : INK,
                  background: CARD,
                  cursor: s.fase ? "wait" : "pointer",
                }}
              >
                {s.fase ? "Lettura…" : doc ? "Sostituisci PDF" : "Carica nota integrativa"}
              </button>
            </div>

            {doc && doc.reperti.length ? (
              <div className="mt-2.5 pt-2.5 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
                {doc.reperti.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge tono={GRAVITA_TONO[slug(r.gravita)] || "neutro"}>{r.gravita}</Badge>
                    <div className="text-[12px] flex-1" style={{ color: "#3A4139", fontFamily: FONT_BODY }}>
                      <strong>{TEMI_DOC[slug(r.tema)] || r.tema}</strong>
                      {isNum(num(r.pagina)) ? <span style={{ color: "#8A917F" }}> · p. {r.pagina}</span> : null}
                      <div>{r.sintesi}</div>
                      {r.citazione ? (
                        <div className="mt-0.5 pl-2 text-[11.5px] italic" style={{ borderLeft: `2px solid ${LINE}`, color: "#5A6159" }}>
                          «{r.citazione}»
                        </div>
                      ) : null}
                      {r.effetto_sul_confronto ? (
                        <div className="mt-0.5 text-[11.5px]" style={{ color: PURPLE }}>
                          Effetto sul confronto: {r.effetto_sul_confronto}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Relazione({
  comparazione, aziende, anni, serieComparazioni, pesi, norm,
  config, onConfig, relazione, onRelazione, onDocumentale,
}) {
  const [stato, setStato] = useState({ corso: false, errore: null, fase: null });

  const genera = async () => {
    setStato({ corso: true, errore: null, fase: "Composizione del dossier" });
    try {
      const dossier = dossierComparativo({ comparazione, aziende, serieComparazioni, anni });
      setStato({ corso: true, errore: null, fase: "Interrogazione del modello" });
      const testo = await chiamaIAConRitentativi(
        {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          prompt: `${PROMPT_RELAZIONE}\n\nDOSSIER:\n${JSON.stringify(dossier)}`,
        },
        { onRitento: (n, attesa) => setStato({ corso: true, errore: null, fase: `Ritentativo ${n} fra ${Math.round(attesa / 100) / 10}s` }) }
      );
      onRelazione(parseJsonRobusto(testo));
      setStato({ corso: false, errore: null, fase: null });
    } catch (e) {
      setStato({ corso: false, errore: e?.message || String(e), fase: null });
    }
  };

  const preset = PRESET_SETTORE[pesi.preset] || PRESET_SETTORE.generico;
  const ordinate = [...comparazione.lista].sort(
    (a, b) => (comparazione.esiti[b.chiave].punteggio ?? -1) - (comparazione.esiti[a.chiave].punteggio ?? -1)
  );

  return (
    <div>
      <div className="no-print">
        <SectionCard titolo="Motore di analisi" eyebrow="configurazione" accento={AMBER}>
          <ConfigIA config={config} onCambia={(patch) => onConfig({ ...config, ...patch })} />
          <p className="text-[11.5px] mt-2.5" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            {config.provider === "claude" && AMBIENTE_AUTENTICA
              ? "Dentro un artifact la richiesta è autenticata dall'ambiente ospite e va diritta all'API: non serve alcuna chiave."
              : "La chiave resta nel browser e viaggia solo verso il provider scelto. Fuori da un artifact serve sempre: un percorso relativo verso un proxy inesistente restituirebbe un 404 travestito da errore del modello."}
          </p>
        </SectionCard>

        <SectionCard
          titolo="Analisi documentale dei peer"
          eyebrow="pilastro 2 · ciò che i numeri non dicono"
          accento={PURPLE}
        >
          <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            Reverse factoring, cartolarizzazioni, leasing non capitalizzati, contenziosi, capitalizzazioni aggressive:
            sono le voci del framework che nei prospetti non compaiono. Carica la nota integrativa o la relazione sulla
            gestione di ciascun peer e l'IA le cerca, con la citazione testuale a supporto. I reperti critici entrano in
            griglia come metrica e attivano una penalità.
          </p>
          <AnalisiDocumentale aziende={aziende} config={config} onRisultato={onDocumentale} />
        </SectionCard>
      </div>

      <SectionCard
        titolo="Relazione comparativa"
        eyebrow="giudizio ragionato sulla griglia"
        accento={INK}
        toolbar={
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={genera}
              disabled={stato.corso}
              className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
              style={{ background: stato.corso ? "#8A917F" : INK, color: "#fff", cursor: stato.corso ? "wait" : "pointer" }}
            >
              {stato.corso ? stato.fase || "In corso…" : relazione ? "Rigenera" : "Genera la relazione"}
            </button>
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
              style={{ border: `1px solid ${LINE}`, color: INK, background: CARD }}
            >
              Stampa
            </button>
          </div>
        }
      >
        {stato.errore ? (
          <div className="rounded p-3 mb-3 text-[12.5px]" style={{ background: "#FDF3F2", border: "1px solid #E4B8B3", color: "#7A2A24" }}>
            {stato.errore}
          </div>
        ) : null}

        {relazione ? (
          <RelazioneRenderizzata r={relazione} />
        ) : (
          <div className="text-[13px] py-6 text-center" style={{ color: "#8A917F", fontFamily: FONT_BODY }}>
            {stato.corso
              ? "Il modello sta leggendo la griglia…"
              : "L'IA riceve la griglia già calcolata — valori, quartili, soglie, punteggi, penalità e serie storiche — e la commenta. Non produce numeri: li interpreta."}
          </div>
        )}
      </SectionCard>

      {/* Nota metodologica: accompagna la stampa, perché una classifica senza
          il metodo con cui è stata costruita non è consegnabile a nessuno. */}
      <SectionCard titolo="Nota metodologica" eyebrow="come è stata costruita questa comparazione" accento={"#5A6159"}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12.5px]" style={{ color: "#3A4139", fontFamily: FONT_BODY }}>
          <div>
            <div className="font-bold mb-1" style={{ color: INK }}>
              Perimetro
            </div>
            <p className="mb-3">
              {comparazione.lista.length} imprese, esercizio {comparazione.anno}, esercizi disponibili{" "}
              {[...anni].sort((a, b) => a - b).join(", ")}. I quartili sono calcolati su {comparazione.nStatistica}{" "}
              imprese
              {comparazione.nStatistica < comparazione.lista.length
                ? " (le altre restano in griglia ma sono escluse dalla statistica)"
                : ""}
              .
            </p>

            <div className="font-bold mb-1" style={{ color: INK }}>
              Omogeneità
            </div>
            <p className="mb-3">
              Valori riportati a {norm.unitaTarget} di {norm.valutaTarget}.
              {norm.ipcAttivo
                ? ` Importi deflazionati al potere d'acquisto dell'esercizio ${norm.annoBaseIpc} con indici IPC digitati a mano.`
                : " Nessun deflazionamento applicato: i valori sono nominali, e su orizzonti lunghi ciò sovrastima la crescita reale."}
            </p>

            <div className="font-bold mb-1" style={{ color: INK }}>
              Riferimenti statistici
            </div>
            <p>
              Mediana e quartili del gruppo, non medie: gli indici di bilancio hanno distribuzioni asimmetriche che una
              sola anomalia o un denominatore vicino a zero distruggerebbero. Sotto le tre imprese si ripiega sui
              benchmark di settore precaricati, che sono ordini di grandezza indicativi e non dati di mercato
              aggiornati. Le soglie teoriche sono espresse in fasce e non dipendono da cosa fa il mercato.
            </p>
          </div>

          <div>
            <div className="font-bold mb-1" style={{ color: INK }}>
              Costruzione del punteggio
            </div>
            <p className="mb-2">
              Preset «{preset.label}». Pesi per pilastro:{" "}
              {PILASTRI.map((p) => `${p.breve} ${pesi.pilastri?.[p.id] ?? preset.pilastri[p.id]}`).join(", ")}.
              {Object.keys(preset.boost || {}).length
                ? ` Metriche rafforzate: ${Object.entries(preset.boost)
                    .map(([id, m]) => `${METRICA_DI[id]?.label || id} ×${m}`)
                    .join(", ")}.`
                : ""}
            </p>
            <p className="mb-3">
              Ogni metrica riceve un punteggio dalla propria posizione percentile nel gruppo, orientata secondo il verso
              (alto, basso o dentro una banda). Le metriche non determinabili sono <strong>neutre</strong>: escono dalla
              media del pilastro e non penalizzano, perché una cella vuota è un'informazione mancante e non un giudizio
              negativo. Le penalità sono cumulabili fino a {PENALITA_MASSIMA} punti.
            </p>

            <div className="font-bold mb-1" style={{ color: INK }}>
              Copertura dei dati
            </div>
            <ul className="space-y-0.5">
              {ordinate.map((a) => (
                <li key={a.chiave}>
                  {a.nome}: {pct(comparazione.esiti[a.chiave].copertura, 0)}
                  {comparazione.esiti[a.chiave].copertura < 0.7 ? (
                    <span style={{ color: AMBER }}> — giudizio meno affidabile</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [13] DATI DIMOSTRATIVI
   ═══════════════════════════════════════════════════════════════════════════
   Quattro aziende costruite per esibire i casi che la griglia deve saper
   distinguere: l'eccellente con cassa vera, quella con margini alti ma utili
   di carta, quella indebitata, la piccola in ripresa. Gli anni sono ancorati
   all'orologio di sistema, mai cablati.
   ─────────────────────────────────────────────────────────────────────────── */

function esercizioDemo({ ricavi, ebitda, ebit, rai, imposte, utile, pn, amm, oneri, coin, magazzino, crediti, debitiOp, liq, immat, ppe, fcfo, capex, dividendi, lavoriInterni }) {
  /* La posizione finanziaria netta non è un parametro libero: discende
     dall'identità capitale investito netto = mezzi propri + PFN. Il patrimonio
     netto a sua volta si accumula dagli utili non distribuiti. Fissare i tre
     valori a mano darebbe uno stato patrimoniale che non quadra, e la prima
     cosa che un analista verifica in un dato dimostrativo è se quadra. */
  const pfn = coin + liq - pn;
  return {
    ce: {
      ricavi, ebitda, ebit, mon: ebit, utileNetto: utile,
      oneriFinanziari: oneri, proventiFinanziari: null, gestioneFinanziaria: -oneri,
      gestioneNonCorrente: 0, ammortamenti: amm, accantonamenti: null,
      costoVenduto: ricavi * 0.42, costoLavoro: ricavi * 0.21, costiServizi: ricavi * 0.14,
      lavoriInterni, valoreAggiunto: ebitda + ricavi * 0.21,
      risultatoAnteImposte: rai, imposte, raof: rai + oneri,
    },
    sp: {
      capitaleInvestitoNetto: coin + liq, coin, ccno: crediti + magazzino - debitiOp,
      immobilizzazioniOperative: ppe + immat, passivitaOperativeNonCorrenti: ricavi * 0.02,
      attivitaOperativeCorrenti: crediti, passivitaOperativeCorrenti: debitiOp,
      attivitaOperative: ppe + immat + magazzino + crediti, passivitaOperative: debitiOp + ricavi * 0.02,
      accessori: 0, investimentiFinanziari: liq, patrimonioNetto: pn, pfn,
      rimanenze: magazzino, attivoCircolante: crediti + magazzino + liq,
      passivoCorrente: debitiOp + Math.max(pfn, 0) * 0.35,
      liquidita: liq, debitiFinanziariBreve: Math.max(pfn + liq, 0) * 0.35,
      debitiFinanziariLungo: Math.max(pfn + liq, 0) * 0.65, pfnBreve: pfn * 0.3,
      totaleAttivo: ppe + immat + magazzino + crediti + liq,
      immateriali: immat, partecipazioni: 0, ppe,
    },
    rf: {
      liquidita: liq, liquiditaIniziale: liq * 0.9,
      flussoOperativo: fcfo + capex, fcfo, fcfe: fcfo - oneri,
      capex, servizioDelDebito: oneri, dividendi, raccolta: 0,
    },
    presenti: { ce: true, sp: true, rf: true },
  };
}

export function generaEsempio(annoPiuRecente = new Date().getFullYear() - 1) {
  const anni = [annoPiuRecente - 3, annoPiuRecente - 2, annoPiuRecente - 1, annoPiuRecente];

  /* Ogni profilo ha, oltre alla base dell'ultimo esercizio, due traiettorie
     che si applicano agli anni precedenti: `mrg` sui margini e `fcfo` sulla
     cassa operativa. Servono a far accadere qualcosa nel tempo — senza,
     scalando tutto con lo stesso fattore di crescita, ogni rapporto sarebbe
     una linea perfettamente piatta e la comparazione temporale non avrebbe
     nulla da mostrare. L'ultimo elemento è sempre 1: è l'anno di riferimento. */
  const profili = [
    {
      chiave: "alfa", nome: "Alfa Industriale S.p.A.", settore: "machinery", fascia: "grande",
      mercato: { capitalizzazione: 520000, prezzoAzione: 13.0, valorePerAzione: 15.6 },
      dcfDemo: { enterpriseValue: 600000, equityValue: 624000, valorePerAzione: 15.6, prezzoMercatoAzione: 13.0, wacc: 0.084 },
      waccManuale: "8,4", pnFinale: 172000,
      /* Il profilo sano: margini in lenta espansione, cassa che segue l'utile,
         debito che si riduce anno dopo anno grazie agli utili trattenuti. */
      base: { ricavi: 240000, mrgEbitda: 0.221, mrgEbit: 0.163, amm: 13900, oneri: 1750,
        coin: 178000, magazzino: 38000, crediti: 31000, debitiOp: 34000,
        liq: 21000, immat: 8200, ppe: 135000, fcfo: 27800, capex: 15200, dividendi: 9000, lavoriInterni: 2100 },
      crescita: 0.062,
      mrg: [0.92, 0.95, 0.98, 1.0],
      fcfo: [0.82, 0.9, 0.96, 1.0],
    },
    {
      chiave: "beta", nome: "Beta Sistemi S.p.A.", settore: "machinery", fascia: "grande",
      mercato: { capitalizzazione: 410000, prezzoAzione: 13.67, valorePerAzione: 10.9 },
      dcfDemo: { enterpriseValue: 505000, equityValue: 327000, valorePerAzione: 10.9, prezzoMercatoAzione: 13.67, wacc: 0.091 },
      waccManuale: "9,1", pnFinale: 113000,
      /* Il caso da smascherare: margine EBITDA il più alto del gruppo e stabile
         nel tempo, ma la conversione in cassa crolla da oltre il 130% al 64%
         mentre le capitalizzazioni restano aggressive. Sul solo margine
         sembrerebbe la migliore; è la serie storica del FCFO a tradirla. */
      base: { ricavi: 198000, mrgEbitda: 0.28, mrgEbit: 0.181, amm: 11500, oneri: 8900,
        coin: 252000, magazzino: 61000, crediti: 58000, debitiOp: 29000,
        liq: 9000, immat: 44000, ppe: 118000, fcfo: 13400, capex: 24800, dividendi: 0, lavoriInterni: 17800 },
      crescita: 0.041,
      mrg: [0.99, 1.0, 1.0, 1.0],
      fcfo: [2.1, 1.7, 1.3, 1.0],
    },
    {
      chiave: "gamma", nome: "Gamma Meccanica S.r.l.", settore: "machinery", fascia: "media",
      mercato: {}, waccManuale: "9,8", pnFinale: 46000,
      /* La piccola con l'anno nero nel mezzo, poi il rimbalzo parziale: è il
         caso in cui numeri indice a base fissa e a base mobile raccontano due
         storie diverse, e il §7.4 dice di guardarli insieme. Non è quotata,
         quindi i pilastri 4 e 6 restano n.d. */
      base: { ricavi: 74000, mrgEbitda: 0.142, mrgEbit: 0.081, amm: 4500, oneri: 2400,
        coin: 82000, magazzino: 21000, crediti: 19000, debitiOp: 12000,
        liq: 3000, immat: 1800, ppe: 52000, fcfo: 4100, capex: 4900, dividendi: 0, lavoriInterni: 400 },
      crescita: 0.018,
      mrg: [1.3, 0.55, 0.85, 1.0],
      fcfo: [1.6, 0.25, 0.8, 1.0],
    },
    {
      chiave: "delta", nome: "Delta Componenti S.p.A.", settore: "machinery", fascia: "grande",
      mercato: { capitalizzazione: 690000, prezzoAzione: 15.33, valorePerAzione: 19.8 },
      dcfDemo: { enterpriseValue: 830000, equityValue: 891000, valorePerAzione: 19.8, prezzoMercatoAzione: 15.33, wacc: 0.079 },
      waccManuale: "7,9", pnFinale: 222000,
      /* L'eccellente: ROIC ben sopra il WACC, margini in espansione costante,
         cassa abbondante, circolante negativo grazie alle dilazioni ottenute. */
      base: { ricavi: 286000, mrgEbitda: 0.235, mrgEbit: 0.191, amm: 12600, oneri: 1100,
        coin: 199000, magazzino: 33000, crediti: 34000, debitiOp: 41000,
        liq: 38000, immat: 5100, ppe: 168000, fcfo: 41200, capex: 16800, dividendi: 14000, lavoriInterni: 1600 },
      crescita: 0.078,
      mrg: [0.9, 0.94, 0.97, 1.0],
      fcfo: [0.8, 0.88, 0.95, 1.0],
    },
  ];

  /* Aliquota effettiva di ciascun profilo, dedotta dall'ultimo esercizio, così
     che le imposte seguano il risultato ante imposte invece di essere scalate
     alla cieca: un anno in perdita deve pagare meno tasse, non le stesse. */
  const ALIQUOTE = { alfa: 0.273, beta: 0.226, gamma: 0.25, delta: 0.273 };

  const aziende = {};
  profili.forEach((p) => {
    const b = p.base;

    /* 1. Conto economico e grandezze patrimoniali di ogni esercizio. */
    const righe = anni.map((anno, i) => {
      const k = Math.pow(1 + p.crescita, i - (anni.length - 1));
      const mm = p.mrg[i];
      const ricavi = b.ricavi * k;
      const ebitda = ricavi * b.mrgEbitda * mm;
      const ebit = ricavi * b.mrgEbit * mm;
      const oneri = b.oneri * k;
      const rai = ebit - oneri;
      const imposte = Math.max(0, rai) * ALIQUOTE[p.chiave];
      return {
        anno, k, ricavi, ebitda, ebit, oneri, rai, imposte,
        utile: rai - imposte,
        amm: b.amm * k,
        coin: b.coin * k,
        magazzino: b.magazzino * k, crediti: b.crediti * k, debitiOp: b.debitiOp * k,
        liq: b.liq * k, immat: b.immat * k, ppe: b.ppe * k,
        fcfo: b.fcfo * k * p.fcfo[i],
        capex: b.capex * k, dividendi: b.dividendi * k,
        lavoriInterni: b.lavoriInterni * k,
      };
    });

    /* 2. Patrimonio netto a ritroso dal valore finale: PN(t−1) = PN(t) − utile(t)
       + dividendi(t). Così l'equity si accumula davvero dagli utili trattenuti
       e la PFN che ne discende racconta una leva che si muove per una ragione,
       invece di essere un numero scelto a piacere. */
    const pn = new Array(righe.length);
    pn[righe.length - 1] = p.pnFinale;
    for (let i = righe.length - 2; i >= 0; i--) {
      pn[i] = pn[i + 1] - righe[i + 1].utile + righe[i + 1].dividendi;
    }

    const esercizi = {};
    righe.forEach((r, i) => {
      esercizi[r.anno] = esercizioDemo({ ...r, pn: pn[i] });
    });

    aziende[p.chiave] = {
      chiave: p.chiave,
      nome: p.nome,
      settore: p.settore,
      fascia: p.fascia,
      esercizi,
      meta: { azienda: p.nome, valuta: "EUR", unita: "migliaia", schema: "cee_ordinario", aliquota: 0.279 },
      mercato: p.mercato,
      waccManuale: p.waccManuale,
      dcf: p.dcfDemo || null,
      qoe:
        p.chiave === "beta"
          ? { punteggio: 41, redFlag: 3, moduli: [], sintesi: "Accruals elevati e capitalizzazioni aggressive." }
          : p.chiave === "gamma"
          ? { punteggio: 63, redFlag: 1, moduli: [], sintesi: "Tensione sul circolante." }
          : { punteggio: 88, redFlag: 0, moduli: [], sintesi: "Nessuna anomalia rilevata." },
      fonti: [{ nome: "dati dimostrativi", tipo: "demo" }],
    };
  });

  return aziende;
}

/* ═══════════════════════════════════════════════════════════════════════════
   [14] ESPORTAZIONE
   ═══════════════════════════════════════════════════════════════════════════ */

function componiSalvataggio({ aziende, comparazione, pesi, norm, relazione, serieComparazioni, anni }) {
  const preset = PRESET_SETTORE[pesi.preset] || PRESET_SETTORE.generico;
  return {
    formato: "comparazione-settore/1.0",
    generatoIl: new Date().toISOString(),
    esercizio: comparazione?.anno ?? null,

    // Come è stato costruito il punteggio: senza questo blocco il numero
    // finale non è riproducibile e non vale nulla.
    metodo: {
      preset: pesi.preset,
      pesiPilastri: { ...preset.pilastri, ...(pesi.pilastri || {}) },
      boostMetriche: preset.boost || {},
      pesiMetrica: Object.fromEntries(METRICHE.map((m) => [m.id, pesi.metriche?.[m.id] ?? m.peso ?? 1])),
      penalitaMassima: PENALITA_MASSIMA,
      normalizzazioni: {
        unitaTarget: norm.unitaTarget,
        valutaTarget: norm.valutaTarget,
        deflazionamentoIpc: !!norm.ipcAttivo,
        annoBaseIpc: norm.ipcAttivo ? norm.annoBaseIpc : null,
        indiciIpc: norm.ipcAttivo ? norm.ipc : null,
        cambi: norm.cambi || {},
      },
    },

    catalogoMetriche: METRICHE.map((m) => ({
      id: m.id, label: m.label, pilastro: m.pilastro, unita: m.unita,
      verso: m.verso, banda: m.banda ?? null, soglia: m.soglia ?? null, formula: m.formula,
    })),

    aziende: Object.values(aziende).map((a) => ({
      chiave: a.chiave, nome: a.nome, settore: a.settore, fascia: a.fascia,
      meta: a.meta, mercato: a.mercato || {}, wacc: a.waccManuale ?? a.dcf?.wacc ?? null,
      dcf: a.dcf || null,
      parametri_redditivita: a.parametriAnalisi || null,
      mercato_da_redditivita: a.mercatoAnalisi || null,
      esclusaDaiQuartili: !!a.escludiDaStatistica,
      esercizi: Object.keys(a.esercizi || {}).map(Number).sort((x, y) => y - x),
      qoe: a.qoe || null,
      reperti_documentali: a.documentale || null,
      andamento: serieAndamento(a.chiave, aziende, serieComparazioni, anni || []),
      fonti: (a.fonti || []).map((f) => f.nome),
    })),

    distribuzioni: comparazione
      ? Object.fromEntries(Object.entries(comparazione.dist).filter(([, v]) => v).map(([k, v]) => [k, v]))
      : {},

    esiti: comparazione
      ? Object.fromEntries(
          Object.entries(comparazione.esiti).map(([k, e]) => [
            k,
            {
              punteggio: e.punteggio, rango: e.rango ?? null, copertura: e.copertura,
              pilastri: e.pilastri, penalita: e.penalita, totalePenalita: e.totalePenalita,
              metriche: comparazione.grezze[k],
            },
          ])
        )
      : {},

    classifica: comparazione?.classifica || [],

    /* La relazione dell'IA viaggia col file, ma marcata per quello che è: un
       commento generato su questa griglia, non un dato di bilancio. */
    relazione: relazione
      ? { generataDa: "modello linguistico", commentaEsercizio: comparazione?.anno ?? null, contenuto: relazione }
      : null,
  };
}

function ModaleEsporta({ dati, onChiudi }) {
  const [copiato, setCopiato] = useState(false);
  if (!dati) return null;
  const testo = JSON.stringify(dati.oggetto, null, 2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(20,33,61,0.55)" }}
      onClick={onChiudi}
    >
      <div
        className="rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={{ background: CARD, border: `1px solid ${LINE}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: BLUE, fontFamily: FONT_BODY }}>
              {dati.oggetto?.formato || "comparazione-settore/1.0"}
            </div>
            <h3 className="text-[15px] font-bold" style={{ color: INK, fontFamily: FONT_HEAD }}>
              {dati.nome}
            </h3>
          </div>
          <button onClick={onChiudi} className="px-2 py-1 text-[13px]" style={{ color: "#5A6159" }}>
            ✕
          </button>
        </header>

        <div className="p-4 overflow-auto flex-1">
          <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
            {dati.oggetto?.formato === FORMATO_SESSIONE
              ? "Questa è la sessione di lavoro completa: i bilanci caricati, i riquadri delle aziende, i pesi, le normalizzazioni e la relazione. Salvala e riaprila con «Riapri sessione» per riprendere esattamente da qui. La chiave API non è dentro al file."
              : "Il file porta con sé i pesi con cui il punteggio è stato costruito e le normalizzazioni applicate: senza quelli il numero finale non sarebbe riproducibile."}{" "}
            Se il download automatico è bloccato dall'ambiente, usa «Copia negli appunti».
          </p>
          <textarea
            readOnly
            value={testo}
            className="w-full h-64 p-2 rounded text-[11px]"
            style={{ border: `1px solid ${LINE}`, fontFamily: FONT_MONO, color: INK, background: "#FAFBF9" }}
          />
        </div>

        <footer className="px-4 py-3 flex items-center justify-end gap-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <button
            onClick={() => {
              try {
                const blob = new Blob([testo], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = dati.nome;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error(e);
              }
            }}
            className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
            style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_BODY }}
          >
            Scarica
          </button>
          <button
            onClick={() => {
              try {
                navigator.clipboard.writeText(testo);
                setCopiato(true);
                setTimeout(() => setCopiato(false), 1800);
              } catch (e) {
                console.error(e);
              }
            }}
            className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
            style={{ background: INK, color: "#fff", fontFamily: FONT_BODY }}
          >
            {copiato ? "Copiato ✓" : "Copia negli appunti"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   [15] APPLICAZIONE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Quanti riquadri di caricamento aprire all'avvio, e quanti al massimo. */
const SLOT_INIZIALI = 4;
const SLOT_MASSIMI = 8;

/* ── Sessione di lavoro ─────────────────────────────────────────────────────
   Il file «Esporta JSON» è un dossier: porta i risultati, non il materiale
   grezzo, e serve a chi legge la comparazione. La sessione è un'altra cosa —
   è il tavolo di lavoro così com'è: i bilanci caricati, i riquadri, i pesi,
   le normalizzazioni, la relazione già scritta. Si salva per riprendere
   domani da dove si è smesso, e per passare il lavoro a un collega senza
   fargli ricaricare dodici file.

   Nel salvataggio non finisce mai la chiave API: resta nel browser di chi
   l'ha digitata, e un file di sessione gira per posta. */
const FORMATO_SESSIONE = "comparazione-sessione/1.0";
const CHIAVE_SESSIONE = "comparazione_sessione_corrente";

function componiSessione({ aziende, slot, fonti, pesi, norm, annoSel, relazione, configIA, vista }) {
  return {
    formato: FORMATO_SESSIONE,
    salvataIl: new Date().toISOString(),
    applicazione: "Comparazione interaziendale di bilancio",
    /* Le aziende vengono salvate NON normalizzate: la normalizzazione è una
       lente, e va riapplicata al ricarico insieme ai suoi parametri. Salvare
       il risultato già scalato significherebbe scalarlo una seconda volta. */
    aziende,
    slot,
    fonti,
    pesi,
    normalizzazioni: norm,
    esercizioSelezionato: annoSel,
    relazione,
    vista,
    ia: configIA ? { provider: configIA.provider, model: configIA.model } : null,
  };
}

/** Legge un file di sessione, con i controlli che servono a non rompere lo stato. */
function leggiSessione(testo) {
  const obj = JSON.parse(testo);
  if (!obj || typeof obj !== "object") throw new Error("Il file non contiene un oggetto JSON.");
  if (obj.formato !== FORMATO_SESSIONE) {
    throw new Error(
      obj.formato === "comparazione-settore/1.0"
        ? "Questo è un file di esportazione dei risultati, non una sessione: contiene i punteggi ma non i bilanci, e da solo non permette di riprendere il lavoro."
        : `Formato non riconosciuto${obj.formato ? ` («${obj.formato}»)` : ""}: atteso «${FORMATO_SESSIONE}».`
    );
  }
  if (!obj.aziende || typeof obj.aziende !== "object") throw new Error("La sessione non contiene aziende.");
  return obj;
}

/** I riquadri di partenza: quattro, come le aziende di un confronto tipico. */
const slotIniziali = () =>
  Array.from({ length: SLOT_INIZIALI }, (_, i) => ({ id: `azienda-${i + 1}`, etichetta: `Azienda ${i + 1}` }));

function ComparazioneSettorialeInterna({
  /* Integrazione con la suite di riclassificazione (facoltativa).
     aziendeSuite: [{ id, nome, file: [File] }] — un riquadro per azienda, con
     i JSON della suite (analisi di Redditività, riclassificazioni, QoE, DCF);
     ogni nuovo elenco sostituisce aziende e file, pesi e normalizzazioni restano.
     sessioneIniziale: testo di una sessione salvata da ripristinare all'avvio.
     apiRef: riceve { esporta() } con la sessione corrente { nome, testo }. */
  aziendeSuite = null,
  sessioneIniziale = null,
  apiRef = null,
} = {}) {
  const inSuite = Array.isArray(aziendeSuite) || !!sessioneIniziale || !!apiRef;
  const [aziende, setAziende] = useState({});
  const [fonti, setFonti] = useState([]);
  /* I riquadri della Fase 0, uno per azienda: l'id del riquadro è anche la
     chiave dell'azienda nel registro, e questo è ciò che impedisce a un file
     di finire nella colonna sbagliata. */
  const [slot, setSlot] = useState(slotIniziali);
  const [vista, setVista] = useState("fase0");
  const [annoSel, setAnnoSel] = useState(null);
  const [esporta, setEsporta] = useState(null);
  const [caricamento, setCaricamento] = useState(false);

  const [norm, setNorm] = useState({
    unitaTarget: "migliaia",
    valutaTarget: "EUR",
    cambi: {},
    ipc: {},
    ipcAttivo: false,
    annoBaseIpc: null,
  });

  const [pesi, setPesi] = useState({
    preset: "generico",
    pilastri: { ...PRESET_SETTORE.generico.pilastri },
    metriche: {},
  });

  const [relazione, setRelazione] = useState(null);
  const [avvisoSessione, setAvvisoSessione] = useState(null);
  /* Copia di lavoro trovata nel browser all'avvio: si propone, non si impone —
     ricaricare da soli il lavoro di ieri sopra quello di oggi sarebbe un
     danno, non un servizio. */
  const [sessioneInSospeso, setSessioneInSospeso] = useState(() => {
    if (inSuite) return null; // nella suite la sessione la conserva la suite
    try {
      const grezzo = localStorage.getItem(CHIAVE_SESSIONE);
      if (!grezzo) return null;
      const obj = JSON.parse(grezzo);
      return obj?.formato === FORMATO_SESSIONE && Object.keys(obj.aziende || {}).length ? obj : null;
    } catch {
      return null;
    }
  });

  /* La configurazione del provider è ripresa dal browser, con la stessa
     convenzione degli altri moduli. La lettura sta dentro l'inizializzatore di
     useState, così avviene una volta sola e non a ogni render. */
  const [configIA, setConfigIA] = useState(() => {
    const base = { provider: "claude", model: MODELLI.claude[0].id, apiKey: "__subscription__" };
    try {
      const salvata = JSON.parse(localStorage.getItem(CHIAVE_CONFIG_IA) || "null");
      return salvata && typeof salvata === "object" ? { ...base, ...salvata } : base;
    } catch {
      return base;
    }
  });

  const aggiornaConfigIA = (c) => {
    setConfigIA(c);
    try {
      localStorage.setItem(CHIAVE_CONFIG_IA, JSON.stringify(c));
    } catch {
      /* localStorage può essere negato: la configurazione resta valida per la
         sessione e non c'è nulla da riparare. */
    }
  };

  /* ── Ingestione ─────────────────────────────────────────────────────────── */

  /**
   * Assorbe un contributo nel registro. Con `riquadro` valorizzato l'azienda di
   * destinazione è decisa dal riquadro in cui il file è stato trascinato: il
   * nome scritto dentro al file serve solo a battezzare la colonna la prima
   * volta, e non può più spostare i dati altrove.
   */
  const assorbiContributo = (contributo, nomeFile, tipo, registro, riquadro) => {
    const nome = contributo.nome || contributo.meta?.azienda || null;
    const segnaposto = riquadro?.etichetta || "Azienda senza nome";
    const chiave = riquadro?.id || chiaveAzienda(nome) || `senza-nome-${Object.keys(registro).length + 1}`;

    const esistente = registro[chiave] || {
      chiave,
      nome: riquadro?.nomeAtteso || nome || segnaposto,
      settore: "generico",
      fascia: "media",
      esercizi: {},
      meta: {},
      mercato: {},
      fonti: [],
    };

    const esercizi = contributo.record?.length ? fondiRecord(esistente.esercizi, contributo.record) : esistente.esercizi;

    registro[chiave] = {
      ...esistente,
      /* Il nome dichiarato subentra solo al segnaposto: se chi carica ha già
         scritto un nome nel riquadro, quello vince — è lui a sapere che «Alfa
         S.p.A.» e «ALFA SPA» sono la stessa impresa. */
      nome: (esistente.nome === segnaposto || esistente.nome === "Azienda senza nome") && nome ? nome : esistente.nome,
      esercizi,
      meta: { ...esistente.meta, ...Object.fromEntries(Object.entries(contributo.meta || {}).filter(([, v]) => v !== null && v !== undefined)) },
      dcf: contributo.dcf || esistente.dcf || null,
      qoe: contributo.qoe || esistente.qoe || null,
      parametriAnalisi: contributo.parametriAnalisi || esistente.parametriAnalisi || null,
      mercatoAnalisi: contributo.mercatoAnalisi || esistente.mercatoAnalisi || null,
      settore: contributo.settore && SETTORI[contributo.settore] ? contributo.settore : esistente.settore,
      waccManuale: esistente.waccManuale,
      waccAnalisi: isNum(contributo.wacc) ? contributo.wacc : esistente.waccAnalisi ?? null,
      fonti: [...esistente.fonti, { nome: nomeFile, tipo }],
    };

    return { chiave, nome: registro[chiave].nome, anni: (contributo.record || []).map((r) => r.anno) };
  };

  const caricaFile = async (file, slotId) => {
    setCaricamento(true);
    const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const testo = await file.text();
      const risultato = analizzaFile(testo);

      /* Un file di «analisi-bilancio/1.0» può portare più aziende in una volta
         sola. In quel caso il riquadro bersaglio prende la prima e le altre
         vanno nei riquadri ancora liberi — mai accorpate, che sarebbe il
         guaio esatto che i riquadri servono a evitare. */
      let riquadri = slot;
      const destinazioni = [];
      if (slotId) {
        const liberi = slot.filter((s) => s.id !== slotId && !aziende[s.id]).map((s) => s.id);
        risultato.contributi.forEach((c, i) => {
          if (i === 0) {
            destinazioni.push(slotId);
            return;
          }
          const prossimo = liberi.shift();
          if (prossimo) {
            destinazioni.push(prossimo);
            return;
          }
          if (riquadri.length >= SLOT_MASSIMI) {
            destinazioni.push(null); // oltre il massimo si torna al raggruppamento per nome
            return;
          }
          const nuovo = { id: `azienda-${Date.now()}-${i}`, etichetta: `Azienda ${riquadri.length + 1}` };
          riquadri = [...riquadri, nuovo];
          destinazioni.push(nuovo.id);
        });
        if (riquadri !== slot) setSlot(riquadri);
      }
      const riquadroDi = (idSlot) => riquadri.find((s) => s.id === idSlot) || null;

      /* La riga di riepilogo del file si ricava dai contributi, che sono già
         tutto ciò che serve: nomi dichiarati ed esercizi datati. Ricavarla
         dentro l'updater di `setAziende` sarebbe un effetto collaterale in una
         funzione che React può eseguire due volte, e la lista dei file
         acquisiti finirebbe per raddoppiare. */
      const nomi = [
        ...new Set(
          risultato.contributi.map((c) => c.nome || c.meta?.azienda || "Azienda senza nome")
        ),
      ];
      const esercizi = [
        ...new Set(risultato.contributi.flatMap((c) => (c.record || []).map((r) => r.anno))),
      ].sort((a, b) => b - a);

      setAziende((prev) => {
        const registro = { ...prev };
        risultato.contributi.forEach((c, i) =>
          assorbiContributo(c, file.name, risultato.tipo, registro, riquadroDi(destinazioni[i]))
        );
        return registro;
      });

      setFonti((f) => [
        ...f,
        {
          id,
          slot: slotId || null,
          nome: file.name,
          tipo: risultato.tipo,
          aziende: nomi,
          esercizi,
          nota:
            slotId && risultato.contributi.length > 1
              ? `Il file dichiara ${risultato.contributi.length} aziende: la prima è rimasta in questo riquadro, le altre sono andate nei riquadri liberi.`
              : null,
        },
      ]);
    } catch (err) {
      setFonti((f) => [
        ...f,
        { id, slot: slotId || null, nome: file.name, errore: err?.message || String(err), aziende: [], esercizi: [] },
      ]);
    } finally {
      setCaricamento(false);
    }
  };

  const caricaEsempio = () => {
    const demo = Object.values(generaEsempio());
    const riquadri = slotIniziali();
    /* Anche l'esempio passa dai riquadri: quattro aziende, quattro riquadri,
       così ciò che si vede provando l'app è la stessa meccanica del lavoro
       vero. */
    const registro = {};
    const fontiDemo = [];
    demo.forEach((a, i) => {
      const s = riquadri[i];
      if (!s) return;
      registro[s.id] = { ...a, chiave: s.id };
      fontiDemo.push({
        id: `demo-${s.id}`,
        slot: s.id,
        nome: `Dati dimostrativi — ${a.nome}`,
        tipo: "semplice",
        aziende: [a.nome],
        esercizi: Object.keys(a.esercizi).map(Number).sort((x, y) => y - x),
      });
    });
    setSlot(riquadri);
    setAziende(registro);
    setFonti(fontiDemo);
    setPesi((p) => ({ ...p, preset: "machinery", pilastri: { ...PRESET_SETTORE.machinery.pilastri } }));
  };

  const azzera = () => {
    setAziende({});
    setFonti([]);
    setSlot(slotIniziali());
    setAnnoSel(null);
    setRelazione(null);
    try {
      localStorage.removeItem(CHIAVE_SESSIONE);
    } catch {
      /* storage negato: non c'è nulla da ripulire */
    }
    setSessioneInSospeso(null);
  };

  /* ── Sessione: salvataggio, ripristino, ripresa automatica ──────────────── */

  const inputSessione = useRef(null);

  const sessioneCorrente = () =>
    componiSessione({ aziende, slot, fonti, pesi, norm, annoSel, relazione, configIA, vista });

  const salvaSessione = () => {
    const oggetto = sessioneCorrente();
    const data = new Date().toISOString().slice(0, 10);
    setEsporta({ nome: `comparazione-sessione_${data}.json`, oggetto });
  };

  const applicaSessione = (obj) => {
    setAziende(obj.aziende || {});
    setSlot(Array.isArray(obj.slot) && obj.slot.length ? obj.slot : slotIniziali());
    setFonti(Array.isArray(obj.fonti) ? obj.fonti : []);
    setPesi((p) => ({
      preset: obj.pesi?.preset || p.preset,
      pilastri: { ...(PRESET_SETTORE[obj.pesi?.preset]?.pilastri || p.pilastri), ...(obj.pesi?.pilastri || {}) },
      metriche: obj.pesi?.metriche || {},
    }));
    setNorm((n) => ({ ...n, ...(obj.normalizzazioni || {}) }));
    setAnnoSel(isNum(obj.esercizioSelezionato) ? obj.esercizioSelezionato : null);
    setRelazione(obj.relazione || null);
    if (obj.vista && TAB.some((t) => t.id === obj.vista)) setVista(obj.vista);
    setSessioneInSospeso(null);
  };

  const apriSessione = async (file) => {
    try {
      const obj = leggiSessione(await file.text());
      applicaSessione(obj);
      const n = Object.keys(obj.aziende || {}).length;
      setAvvisoSessione({
        tono: "ok",
        testo: `Sessione ripristinata: ${n} aziend${n === 1 ? "a" : "e"}, salvata il ${new Date(obj.salvataIl).toLocaleString("it-IT")}.`,
      });
    } catch (err) {
      setAvvisoSessione({ tono: "bad", testo: `Sessione non caricata. ${err?.message || String(err)}` });
    }
  };

  /* Copia di lavoro nel browser: non sostituisce il file di sessione (il
     localStorage si svuota da solo, cambiando macchina non c'è), ma evita di
     perdere un'ora di lavoro per una scheda chiusa per sbaglio. */
  useEffect(() => {
    if (inSuite || !Object.keys(aziende).length) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(sessioneCorrente()));
      } catch {
        /* quota esaurita o storage negato: la sessione corrente resta valida */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [aziende, slot, fonti, pesi, norm, annoSel, relazione, vista]);

  /* ── Integrazione con la suite ──────────────────────────────────────────── */
  if (apiRef) {
    apiRef.current = {
      esporta: () =>
        Object.keys(aziende).length
          ? { nome: "comparazione-sessione.json", testo: JSON.stringify(sessioneCorrente(), null, 2) }
          : null,
      aziende: () => Object.keys(aziende).length,
      inCaricamento: () => !!suiteInAttesa || caricamento,
    };
  }
  const sessioneRipristinata = useRef(false);
  useEffect(() => {
    if (!sessioneIniziale || sessioneRipristinata.current) return;
    sessioneRipristinata.current = true;
    try {
      applicaSessione(leggiSessione(sessioneIniziale));
    } catch (err) {
      setAvvisoSessione({ tono: "bad", testo: `Sessione della suite non ripristinata. ${err?.message || String(err)}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessioneIniziale]);
  /* Un nuovo elenco dalla suite: prima i riquadri (uno per azienda, già con il
     nome), poi — al render successivo, quando i riquadri esistono — i file,
     ciascuno nel riquadro della sua azienda. */
  const [suiteInAttesa, setSuiteInAttesa] = useState(null);
  useEffect(() => {
    if (!Array.isArray(aziendeSuite)) return;
    const riquadri = aziendeSuite.map((a, i) => ({ id: `suite-${a.id}`, etichetta: `Azienda ${i + 1}`, nomeAtteso: a.nome }));
    setAziende({});
    setFonti([]);
    setRelazione(null);
    setSlot(riquadri.length ? riquadri : slotIniziali());
    setSuiteInAttesa(aziendeSuite);
    setAvvisoSessione(null);
  }, [aziendeSuite]);
  useEffect(() => {
    if (!suiteInAttesa) return;
    if (!suiteInAttesa.every((a) => slot.some((x) => x.id === `suite-${a.id}`))) return;
    const elenco = suiteInAttesa;
    let annullato = false;
    (async () => {
      for (const a of elenco) {
        for (const f of a.file || []) {
          if (annullato) return;
          await caricaFile(f, `suite-${a.id}`);
        }
      }
      if (annullato) return;
      setSuiteInAttesa(null);
      const n = elenco.filter((a) => (a.file || []).length).length;
      setAvvisoSessione({
        tono: n >= 2 ? "ok" : "warn",
        testo: n >= 2
          ? `Dati della suite caricati: ${elenco.map((a) => a.nome).join(", ")}. Pesi e normalizzazioni restano quelli scelti.`
          : "Dalla suite è arrivata una sola azienda con dati: per la comparazione ne servono almeno due.",
      });
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suiteInAttesa, slot]);

  /* ── Riquadri della Fase 0 ──────────────────────────────────────────────── */

  /** Svuota un riquadro: via l'azienda e via i file che ci erano stati messi. */
  const svuotaSlot = (idSlot) => {
    setAziende((prev) => {
      const c = { ...prev };
      delete c[idSlot];
      return c;
    });
    setFonti((f) => f.filter((x) => x.slot !== idSlot));
    setRelazione(null);
  };

  /** Rinomina: se l'azienda esiste si rinomina quella, altrimenti il riquadro. */
  const rinominaSlot = (idSlot, nome) => {
    setAziende((prev) => (prev[idSlot] ? { ...prev, [idSlot]: { ...prev[idSlot], nome } } : prev));
    setSlot((s) => s.map((x) => (x.id === idSlot ? { ...x, nomeAtteso: nome } : x)));
  };

  const aggiungiSlot = () =>
    setSlot((s) =>
      s.length >= SLOT_MASSIMI ? s : [...s, { id: `azienda-${Date.now()}`, etichetta: `Azienda ${s.length + 1}` }]
    );

  const togliSlot = (idSlot) => {
    svuotaSlot(idSlot);
    setSlot((s) => (s.length <= 2 ? s : s.filter((x) => x.id !== idSlot)));
  };

  /* I reperti documentali arrivano dall'IA e vengono scritti sull'azienda: da
     lì alimentano la metrica «reperti critici» e la penalità corrispondente,
     passando per lo stesso motore di calcolo di tutto il resto. */
  const registraDocumentale = (chiave, risultato) => {
    setAziende((prev) => (prev[chiave] ? { ...prev, [chiave]: { ...prev[chiave], documentale: risultato } } : prev));
  };

  /* ── Derivati ───────────────────────────────────────────────────────────── */

  const aziendeNormalizzate = useMemo(() => {
    const out = {};
    Object.values(aziende).forEach((a) => {
      const n = normalizzaAzienda(a, norm);
      const serie = serieDi(n.esercizi);
      const wacc = isNum(num(a.waccManuale)) ? num(a.waccManuale) / 100 : a.dcf?.wacc ?? null;
      /* Gli esercizi sono riportati alla scala (e valuta) del confronto: lo
         stesso vale per gli importi assoluti di mercato e del DCF, altrimenti
         EV = capitalizzazione + PFN sommerebbe milioni e migliaia. */
      const valutaAz = (a.meta?.valuta || "").toUpperCase();
      const valutaTg = (norm.valutaTarget || "").toUpperCase();
      let fattore = fattoreScala(a.meta?.unita) / fattoreScala(norm.unitaTarget);
      if (valutaAz && valutaTg && valutaAz !== valutaTg) {
        const t = num(norm.cambi?.[a.chiave]?.default);
        if (isNum(t) && t > 0) fattore *= t;
      }
      const scala = (v) => (isNum(v) ? v * fattore : null);
      const scelto = (k) => num(a.mercato?.[k]) ?? num(a.dcf?.[k === "prezzoAzione" ? "prezzoMercatoAzione" : k]) ?? num(a.mercatoAnalisi?.[k]);
      out[a.chiave] = {
        ...n,
        serie,
        wacc: wacc ?? a.waccAnalisi ?? a.parametriAnalisi?.wacc ?? null,
        dcf: a.dcf ? { ...a.dcf, enterpriseValue: scala(a.dcf.enterpriseValue), equityValue: scala(a.dcf.equityValue) } : null,
        mercato: {
          ...a.mercato,
          capitalizzazione: scala(scelto("capitalizzazione")),
          crescitaAttesa: num(a.mercato?.crescitaAttesa),
          prezzoAzione: scelto("prezzoAzione"),
          valorePerAzione: num(a.mercato?.valorePerAzione) ?? num(a.dcf?.valorePerAzione),
        },
      };
    });
    return out;
  }, [aziende, norm]);

  const anniDisponibili = useMemo(() => {
    const s = new Set();
    Object.values(aziendeNormalizzate).forEach((a) => Object.keys(a.esercizi || {}).forEach((k) => s.add(Number(k))));
    return [...s].sort((a, b) => b - a);
  }, [aziendeNormalizzate]);

  const annoCorrente = annoSel && anniDisponibili.includes(annoSel) ? annoSel : anniDisponibili[0] ?? null;

  const allineamento = useMemo(() => verificaAllineamento(aziendeNormalizzate), [aziendeNormalizzate]);

  const settoreBench = useMemo(() => {
    // Il benchmark di settore usato come rete di sicurezza è quello prevalente
    // fra le aziende caricate: un peer group ben costruito è omogeneo, e se non
    // lo è il ripiego statistico è comunque preferibile al nulla.
    const conteggio = {};
    Object.values(aziende).forEach((a) => {
      const s = a.settore || "generico";
      conteggio[s] = (conteggio[s] || 0) + 1;
    });
    const prevalente = Object.entries(conteggio).sort((a, b) => b[1] - a[1])[0]?.[0] || "generico";
    return SETTORI[prevalente] || SETTORI.generico;
  }, [aziende]);

  const comparazione = useMemo(() => {
    if (!annoCorrente) return null;
    return costruisciComparazione({ aziende: aziendeNormalizzate, anno: annoCorrente, pesi, settoreBench });
  }, [aziendeNormalizzate, annoCorrente, pesi, settoreBench]);

  /* Le serie storiche hanno bisogno delle metriche di TUTTI gli esercizi, non
     solo di quello selezionato: si costruisce una comparazione per anno. Con
     otto aziende e cinque esercizi sono quaranta contesti di calcolo, un costo
     trascurabile a fronte di una logica che resta una sola. */
  const serieComparazioni = useMemo(() => {
    const out = {};
    anniDisponibili.forEach((anno) => {
      out[anno] = costruisciComparazione({ aziende: aziendeNormalizzate, anno, pesi, settoreBench });
    });
    return out;
  }, [aziendeNormalizzate, anniDisponibili, pesi, settoreBench]);

  const nAziende = Object.keys(aziende).length;
  const pronta = nAziende >= 2 && !!comparazione;

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const TAB = [
    { id: "fase0", label: "Fase 0 · Dati", attiva: true },
    { id: "matrice", label: "Matrice", attiva: pronta },
    { id: "scorecard", label: "Scorecard", attiva: pronta },
    { id: "testa", label: "Testa a testa", attiva: pronta },
    {
      id: "serie",
      label: "Serie storiche",
      attiva: pronta && anniDisponibili.length >= 2,
      motivo: anniDisponibili.length < 2 ? "serve più di un esercizio" : null,
    },
    {
      id: "posizionamento",
      label: "Posizionamento",
      attiva: pronta && anniDisponibili.length >= 2,
      motivo: anniDisponibili.length < 2 ? "il fade diagram ha bisogno di più esercizi" : null,
    },
    { id: "relazione", label: "Relazione", attiva: pronta },
  ];

  /* Se la scheda aperta smette di essere disponibile — si azzerano i dati, o
     si elimina l'azienda che rendeva possibile il confronto — si torna alla
     Fase 0 invece di mostrare un'area di contenuto vuota senza spiegazione. */
  const vistaCorrente = TAB.find((t) => t.id === vista)?.attiva ? vista : "fase0";

  return (
    <div style={{ background: PAPER, minHeight: "100vh", fontFamily: FONT_BODY }}>
      {/* La stampa non è una vista separata: è la stessa pagina senza i comandi.
          Costruire un secondo albero solo per il PDF avrebbe voluto dire tenerne
          allineati due, e il secondo sarebbe rimasto indietro. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          section { break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc !important; }
          table { font-size: 9px !important; }
          th, td { padding: 2px 3px !important; }
          svg { max-width: 100% !important; }
          @page { margin: 14mm; size: A4; }
        }
      `}</style>
      <div className="max-w-[1400px] mx-auto px-5 py-6">
        <Intestazione
          eyebrow="comparazione interaziendale · cap. 7"
          titolo="Comparazione di bilancio fra aziende del settore"
          nota="Riceve i JSON prodotti dagli altri moduli della suite e mette a confronto le aziende su sei pilastri: qualità operativa, qualità degli utili, struttura del capitale, valutazione relativa, allocazione del capitale e valore intrinseco del DCF contro il prezzo di mercato. I riferimenti sono i quartili del peer group caricato, le soglie teoriche e i benchmark di settore."
          azione={
            <div className="flex items-center gap-2">
              {/* Sessione: salvare il tavolo di lavoro e riprenderlo dopo. */}
              <input
                ref={inputSessione}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) apriSessione(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => inputSessione.current?.click()}
                title="Riapre un file di sessione salvato in precedenza: bilanci, riquadri, pesi, normalizzazioni e relazione"
                className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                style={{ border: `1px solid ${LINE}`, color: INK, background: CARD }}
              >
                Riapri sessione
              </button>
              {nAziende ? (
                <button
                  onClick={salvaSessione}
                  title="Salva tutto il lavoro in un file JSON: i bilanci caricati, i riquadri, i pesi, le normalizzazioni e la relazione"
                  className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                  style={{ border: `1px solid ${GREEN}`, color: GREEN, background: CARD }}
                >
                  Salva sessione
                </button>
              ) : null}
              {nAziende ? (
                <button
                  onClick={azzera}
                  className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                  style={{ border: `1px solid ${LINE}`, color: RED, background: CARD }}
                >
                  Azzera
                </button>
              ) : null}
              {pronta ? (
                <button
                  onClick={() =>
                    setEsporta({
                      nome: `comparazione-settore_${annoCorrente}.json`,
                      oggetto: componiSalvataggio({
                        aziende: aziendeNormalizzate,
                        comparazione,
                        pesi,
                        norm,
                        relazione,
                        serieComparazioni,
                        anni: anniDisponibili,
                      }),
                    })
                  }
                  className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                  style={{ background: INK, color: "#fff" }}
                >
                  Esporta JSON
                </button>
              ) : null}
            </div>
          }
        />

        {/* Esito dell'ultimo caricamento di sessione, e proposta di riprendere
            la copia di lavoro trovata nel browser. */}
        {avvisoSessione ? (
          <div
            className="rounded p-2.5 mb-3 text-[12.5px] flex items-start justify-between gap-3 no-print"
            style={{
              background: avvisoSessione.tono === "bad" ? "#FDF3F2" : "#EDF5F0",
              border: `1px solid ${avvisoSessione.tono === "bad" ? "#E4B8B3" : "#BFDBCA"}`,
              color: avvisoSessione.tono === "bad" ? "#7A2A24" : "#1E5A44",
              fontFamily: FONT_BODY,
            }}
          >
            <span>{avvisoSessione.testo}</span>
            <button onClick={() => setAvvisoSessione(null)} className="shrink-0" style={{ color: "inherit" }} aria-label="Chiudi">
              ✕
            </button>
          </div>
        ) : null}

        {sessioneInSospeso && !nAziende ? (
          <div
            className="rounded p-2.5 mb-3 text-[12.5px] flex flex-wrap items-center gap-3 no-print"
            style={{ background: "#FAFBF9", border: `1px solid ${LINE}`, color: INK, fontFamily: FONT_BODY }}
          >
            <span>
              C'è una sessione lasciata aperta in questo browser —{" "}
              {Object.keys(sessioneInSospeso.aziende || {}).length} aziende, salvata il{" "}
              {new Date(sessioneInSospeso.salvataIl).toLocaleString("it-IT")}.
            </span>
            <button
              onClick={() => {
                applicaSessione(sessioneInSospeso);
                setAvvisoSessione({ tono: "ok", testo: "Ripresa la sessione salvata nel browser." });
              }}
              className="px-3 py-1 rounded text-[12px] font-semibold"
              style={{ border: `1px solid ${GREEN}`, color: GREEN, background: CARD }}
            >
              Riprendi
            </button>
            <button
              onClick={() => {
                setSessioneInSospeso(null);
                try {
                  localStorage.removeItem(CHIAVE_SESSIONE);
                } catch {
                  /* nulla da ripulire */
                }
              }}
              className="px-3 py-1 rounded text-[12px]"
              style={{ border: `1px solid ${LINE}`, color: "#5A6159", background: CARD }}
            >
              Scarta
            </button>
          </div>
        ) : null}

        <nav className="flex items-center gap-1 mb-5 no-print" style={{ borderBottom: `2px solid ${LINE}` }}>
          {TAB.map((t) => (
            <button
              key={t.id}
              disabled={!t.attiva}
              onClick={() => setVista(t.id)}
              title={t.attiva ? undefined : t.motivo || "servono almeno due aziende"}
              className="px-4 py-2 text-[13px] font-semibold"
              style={{
                color: vistaCorrente === t.id ? INK : t.attiva ? "#5A6159" : "#B4BAAE",
                borderBottom: vistaCorrente === t.id ? `2px solid ${GREEN}` : "2px solid transparent",
                marginBottom: "-2px",
                cursor: t.attiva ? "pointer" : "not-allowed",
                fontFamily: FONT_BODY,
              }}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-2">
            {anniDisponibili.length > 1 ? (
              <label className="flex items-center gap-2">
                <span className="text-[11.5px]" style={{ color: "#5A6159" }}>
                  Esercizio
                </span>
                <select
                  value={annoCorrente ?? ""}
                  onChange={(e) => setAnnoSel(Number(e.target.value))}
                  className="px-2 py-1 rounded text-[12.5px]"
                  style={{ border: `1px solid ${LINE}`, color: INK, background: CARD, fontFamily: FONT_MONO }}
                >
                  {anniDisponibili.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </nav>

        {vistaCorrente === "fase0" ? (
          <>
            <SectionCard titolo="Ingestione dei file" eyebrow="fase 0" accento={GREEN}>
              <p className="text-[12.5px] mb-3" style={{ color: "#5A6159", fontFamily: FONT_BODY }}>
                Un riquadro per azienda: SP, CE, rendiconto finanziario, analisi-bilancio, pro-forma DCF e Quality of
                Earnings di una stessa impresa vanno trascinati nel suo riquadro, anche tutti insieme. Il riquadro
                decide a quale azienda appartengono i dati, così due file che scrivono la ragione sociale in modo
                diverso — «Alfa S.p.A.» e «ALFA SPA» — non aprono due colonne separate.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {slot.map((s) => (
                  <RiquadroAzienda
                    key={s.id}
                    slot={s}
                    azienda={aziende[s.id] || null}
                    fonti={fonti.filter((f) => f.slot === s.id)}
                    attivo={caricamento}
                    onFile={(file) => caricaFile(file, s.id)}
                    onSvuota={() => svuotaSlot(s.id)}
                    onRinomina={(nome) => rinominaSlot(s.id, nome)}
                    onElimina={() => togliSlot(s.id)}
                    eliminabile={slot.length > 2}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={aggiungiSlot}
                  disabled={slot.length >= SLOT_MASSIMI}
                  className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                  style={{
                    border: `1px solid ${LINE}`,
                    color: slot.length >= SLOT_MASSIMI ? "#A8AFA2" : GREEN,
                    background: CARD,
                    cursor: slot.length >= SLOT_MASSIMI ? "not-allowed" : "pointer",
                  }}
                >
                  + Aggiungi un'azienda
                </button>
                <button
                  onClick={caricaEsempio}
                  className="px-3 py-1.5 rounded text-[12.5px] font-semibold"
                  style={{ border: `1px solid ${LINE}`, color: INK, background: CARD }}
                >
                  Carica dati dimostrativi
                </button>
                <span className="text-[11.5px]" style={{ color: "#8A917F" }}>
                  {slot.length >= SLOT_MASSIMI
                    ? "Otto riquadri sono il massimo: oltre, le colonne della matrice diventano illeggibili."
                    : "Quattro aziende meccaniche su quattro esercizi, per provare la griglia senza file veri."}
                </span>
              </div>

              {fonti.length ? (
                <div className="mt-4">
                  <div className="text-[11px] font-bold tracking-widest uppercase mb-2" style={{ color: BLUE }}>
                    File acquisiti
                  </div>
                  <PannelloFonti fonti={fonti} onRimuovi={(id) => setFonti((f) => f.filter((x) => x.id !== id))} />
                  <p className="text-[11.5px] mt-2" style={{ color: "#8A917F" }}>
                    Rimuovere un file dalla lista non ne toglie i dati dalle aziende già popolate: per ripartire pulito
                    usa «Azzera».
                  </p>
                </div>
              ) : null}
            </SectionCard>

            {nAziende ? (
              <>
                <SectionCard
                  titolo={`Aziende in comparazione (${nAziende})`}
                  eyebrow="anagrafica e perimetro"
                  accento={BLUE}
                >
                  {nAziende > 8 ? (
                    <div className="rounded p-2.5 mb-3 text-[12.5px]" style={{ background: "#FAECD8", border: "1px solid #EBD4AC", color: "#7A5A16" }}>
                      La griglia è tarata su otto aziende: oltre quel numero le colonne diventano strette e il confronto
                      a colpo d'occhio si perde.
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    {Object.values(aziende).map((a) => (
                      <SchedaAzienda
                        key={a.chiave}
                        azienda={a}
                        aziende={nAziende}
                        onCambia={(patch) => setAziende((prev) => ({ ...prev, [a.chiave]: { ...prev[a.chiave], ...patch } }))}
                        onElimina={() =>
                          setAziende((prev) => {
                            const c = { ...prev };
                            delete c[a.chiave];
                            return c;
                          })
                        }
                      />
                    ))}
                  </div>
                </SectionCard>

                <SectionCard titolo="Presupposti della comparazione" eyebrow="§7.2 · omogeneità" accento={AMBER}>
                  <PannelloNormalizzazioni
                    norm={norm}
                    onCambia={(patch) => setNorm((n) => ({ ...n, ...patch }))}
                    anni={anniDisponibili}
                    aziende={aziende}
                  />
                  <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
                    <div className="text-[11px] font-bold tracking-widest uppercase mb-2" style={{ color: BLUE }}>
                      Allineamento degli esercizi
                    </div>
                    <PannelloAllineamento allineamento={allineamento} />
                  </div>
                </SectionCard>

                {!pronta ? (
                  <div
                    className="rounded-lg p-4 text-[13px]"
                    style={{ background: "#FAECD8", border: "1px solid #EBD4AC", color: "#7A5A16" }}
                  >
                    Serve almeno una seconda azienda perché ci sia qualcosa da comparare. Con una sola, la griglia non
                    avrebbe alcun termine di confronto: né quartili, né classifica.
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {vistaCorrente === "matrice" ? (
          <Matrice comparazione={comparazione} pesi={pesi} onPesi={setPesi} aziende={aziendeNormalizzate} />
        ) : null}

        {vistaCorrente === "scorecard" ? <Scorecard comparazione={comparazione} /> : null}

        {vistaCorrente === "testa" ? <TestaATesta comparazione={comparazione} /> : null}

        {vistaCorrente === "serie" ? (
          <SerieStoriche
            aziende={aziendeNormalizzate}
            anni={anniDisponibili}
            serieComparazioni={serieComparazioni}
          />
        ) : null}

        {vistaCorrente === "posizionamento" ? (
          <Posizionamento
            aziende={aziendeNormalizzate}
            anno={annoCorrente}
            anni={anniDisponibili}
            comparazione={comparazione}
            serieComparazioni={serieComparazioni}
          />
        ) : null}

        {vistaCorrente === "relazione" ? (
          <Relazione
            comparazione={comparazione}
            aziende={aziendeNormalizzate}
            anni={anniDisponibili}
            serieComparazioni={serieComparazioni}
            pesi={pesi}
            norm={norm}
            config={configIA}
            onConfig={aggiornaConfigIA}
            relazione={relazione}
            onRelazione={setRelazione}
            onDocumentale={registraDocumentale}
          />
        ) : null}

        <footer className="mt-8 pt-4 text-[11.5px]" style={{ borderTop: `1px solid ${LINE}`, color: "#8A917F" }}>
          I benchmark di settore precaricati sono ordini di grandezza indicativi, non dati di mercato aggiornati: il
          confronto sui peer effettivamente caricati ha sempre la precedenza. La relazione dell'IA commenta una griglia
          già calcolata e non produce numeri propri; i reperti documentali riportano ciò che è scritto nei documenti
          caricati e vanno verificati sull'originale prima di qualunque decisione.
        </footer>
      </div>

      <ModaleEsporta dati={esporta} onChiudi={() => setEsporta(null)} />
    </div>
  );
}

export default function ComparazioneSettoriale(props) {
  return (
    <ErrorBoundary>
      <ComparazioneSettorialeInterna {...props} />
    </ErrorBoundary>
  );
}
