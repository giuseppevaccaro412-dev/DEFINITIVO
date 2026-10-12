/**
 * AnalisiBilancio.jsx
 * ---------------------------------------------------------------------------
 * Single Page Application per la valutazione di redditività e solvibilità
 * aziendale con confronto storico multi-annualità.
 *
 * INGESTIONE DATI
 * L'app legge nativamente i tre moduli di riclassificazione:
 *   • SP  — "Riclassificazione SP — schema dinamico"   (formatoSalvataggio 2)
 *   • CE  — "ce-riclassificato/2.0"
 *   • RF  — modulo "rendiconto_finanziario"            (versione 2)
 * Ogni file contiene `esercizioCorrente` ed `esercizioPrecedente`: una terna di
 * moduli popola quindi DUE esercizi; caricando la terna dei due esercizi
 * anteriori se ne aggiungono altri due, senza perdere i precedenti.
 * I valori sono letti dal blocco `aggregati` già quadrato dal modulo a monte;
 * gli Oneri Finanziari, non presenti negli aggregati, sono sommati dalle voci
 * di classe ONERI_FIN.
 * È mantenuto anche un parser "semplice" per JSON piatti {anno, ce, sp, rf}.
 *
 * NESSUN ANNO È CABLATO NEL CODICE. Gli esercizi sono dedotti esclusivamente
 * dal campo `esercizio` dei JSON importati (che accetta sia "2025" sia
 * "31/12/2025"), ordinati dal più recente al più remoto e resi disponibili ai
 * selettori. L'unico riferimento temporale generato dall'applicazione è quello
 * del dataset dimostrativo, ancorato all'orologio di sistema.
 *
 * NAVIGAZIONE. L'interfaccia è a pagine (linguette): una pagina di
 * caricamento dati e sette pagine di analisi — redditività operativa,
 * determinanti del ROI, solvibilità, liquidità (statica e dinamica),
 * assorbimento e servizio finanziario, raccolta e costo del capitale,
 * redditività netta —
 * ciascuna con il proprio selettore di annualità indipendente, che resta
 * memorizzato anche cambiando pagina.
 *
 * Requisiti runtime:
 *   - React >= 18
 *   - Tailwind CSS (solo layout: flex/grid/spacing/scala tipografica)
 *   - I colori del Design System sono applicati via style inline (vedi palette)
 *
 * Font (se non si usa il loader automatico in fondo al file):
 *   @import url('https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   1. DESIGN SYSTEM — palette tassativa
   ═══════════════════════════════════════════════════════════════════════════ */

export const INK = "#14213D";
export const PAPER = "#F5F6F3";
export const CARD = "#FFFFFF";
export const GREEN = "#1F7A5C";
export const RED = "#B3423A";
export const AMBER = "#C9962B";
export const BLUE = "#2E5EAA";
export const PURPLE = "#6D28D9";
export const LINE = "#DDE1DA";

const FONT_HEAD = "'Libre Franklin', sans-serif";
const FONT_BODY = "'IBM Plex Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const LEVEL_COLOR = { ok: GREEN, warn: AMBER, bad: RED, info: BLUE };

const MODULI = { sp: "SP", ce: "CE", rf: "RF" };

/* ═══════════════════════════════════════════════════════════════════════════
   2. UTILITY DI FORMATTAZIONE (locale it-IT)
   ═══════════════════════════════════════════════════════════════════════════ */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Divisione protetta: null se il denominatore non è utilizzabile. */
export const safeDiv = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

/** Somma protetta: null solo se NESSUN addendo è valorizzato. */
export const somma = (...xs) => {
  const validi = xs.filter(isNum);
  return validi.length ? validi.reduce((a, b) => a + b, 0) : null;
};

/** Sottrazione protetta: il minuendo deve esistere, il sottraendo è opzionale. */
export const sottrai = (a, b) => (isNum(a) ? a - (isNum(b) ? b : 0) : null);

/** Intero formattato it-IT (es. 1.234.567). */
/* Senza `dec` gli importi (in milioni) mostrano fino a 2 decimali. */
export const fmt = (n, dec) =>
  isNum(n)
    ? n.toLocaleString("it-IT", dec == null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: dec, maximumFractionDigits: dec })
    : "n.d.";

/** Percentuale con 1 decimale (es. 12,5%). Riceve il valore in forma decimale. */
export const pct = (n, dec = 1, segno = false) => {
  if (!isNum(n)) return "n.d.";
  const s = (n * 100).toLocaleString("it-IT", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return `${segno && n > 0 ? "+" : ""}${s}%`;
};

/** Multiplo / indice puro (es. 1,45x). */
export const mult = (n, dec = 2, segno = false) => {
  if (!isNum(n)) return "n.d.";
  const s = n.toLocaleString("it-IT", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return `${segno && n > 0 ? "+" : ""}${s}x`;
};

/** Punti percentuali, per i delta su indicatori espressi in % (es. +2,5 p.p.). */
export const pp = (n, dec = 1) => {
  if (!isNum(n)) return "n.d.";
  const s = (n * 100).toLocaleString("it-IT", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return `${n > 0 ? "+" : ""}${s} p.p.`;
};

/** Valore assoluto con segno esplicito, per i delta su grandezze monetarie. */
export const segnato = (n) => (isNum(n) ? `${n > 0 ? "+" : ""}${fmt(n)}` : "n.d.");

/** Media aritmetica protetta: richiede ENTRAMBI i termini. */
export const media = (a, b) => (isNum(a) && isNum(b) ? (a + b) / 2 : null);

/** unit: "pct" (percentuale) · "x" (multiplo) · "val" (importo assoluto) ·
 *  "dec" (grandezza pura con due decimali: anni, valori per azione). */
const fmtValore = (v, unit) =>
  unit === "pct" ? pct(v) : unit === "val" ? fmt(v) : unit === "dec" ? fmt(v, 2) : mult(v);

/** Formattazione del delta coerente con l'unità dell'indicatore. */
const fmtDelta = (d, unit) =>
  unit === "pct"
    ? pp(d)
    : unit === "val"
    ? segnato(d)
    : unit === "dec"
    ? isNum(d)
      ? `${d > 0 ? "+" : ""}${fmt(d, 2)}`
      : "n.d."
    : mult(d, 2, true);

/* ═══════════════════════════════════════════════════════════════════════════
   3. PARSING DEI MODULI DI RICLASSIFICAZIONE
   ═══════════════════════════════════════════════════════════════════════════ */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Converte in numero accettando anche stringhe in formato italiano. */
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Estrae l'anno da "2025", "31/12/2025", "esercizio 2025"… */
const annoDa = (v) => {
  const m = String(v ?? "").match(/(19|20)\d{2}/g);
  return m ? Number(m[m.length - 1]) : null;
};

/* ═══════════════════════════════════════════════════════════════════════════
   ALLINEAMENTO DEL DATASET AI PARAMETRI MANUALI
   ═══════════════════════════════════════════════════════════════════════════
   I parametri di Fase 1 sono correzioni all'aggregato letto dai moduli: il
   costo del lavoro dichiarato nelle note è più attendibile di quello che il
   riclassificatore riesce a isolare dai costi operativi. Gli indici lo sanno e
   leggono l'override, ma il nodo `ce` del dataset conserva il valore vecchio.
   Finché le due letture convivono solo a schermo il danno è contenuto; nel
   momento in cui il dataset viene serializzato — salvataggio dell'analisi,
   riapertura, riuso a valle — quel disallineamento diventa un file che si
   contraddice da solo: `ce.costoLavoro` a null mentre il parametro vale
   662.496, e un valore aggiunto rimasto appiattito sull'EBITDA.

   `stabilizzaDataset` riscrive il nodo `ce` in modo che rispetti la scala del
   conto economico a valore aggiunto, che ha due gradini e vanno chiusi
   entrambi:

       Ricavi − Costi esterni  = Valore aggiunto
       Valore aggiunto − Lavoro = MOL (EBITDA)

   Ricavi ed EBITDA sono gli ancoraggi: vengono dal bilancio e non si toccano.
   Correggere il solo costo del lavoro sposterebbe il primo gradino, perché nei
   bilanci anglosassoni il costo del personale industriale è dentro il «cost of
   sales»: portarlo fuori senza sgravare i costi esterni lo conterebbe due
   volte. La funzione quindi ricalcola il valore aggiunto sul gradino basso e
   sgrava della stessa differenza i costi esterni, sul costo del venduto o —
   se anche quello è stato corretto a mano — sui servizi.

   Non inventa nulla: se mancano gli ancoraggi lascia l'esercizio com'è.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Chiavi che il modulo di Fase 1 sovrascrive direttamente sul conto economico. */
const OVERRIDE_CE = [
  { parKey: "costoLavoro", ceKey: "costoLavoro", assoluto: true },
  { parKey: "costoVenduto", ceKey: "costoVenduto", assoluto: true },
  { parKey: "gestNonCorrente", ceKey: "gestioneNonCorrente", assoluto: false },
];

/**
 * Allinea il dataset ai parametri manuali prima della serializzazione.
 *
 * @param {object} dataset  mappa anno → { ce, sp, rf, presenti }
 * @param {object} par      stato dei parametri, con `perAnno`
 * @returns {object} copia profonda del dataset, con il nodo `ce` riconciliato.
 *                   L'originale non viene modificato.
 */
export function stabilizzaDataset(dataset, par) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const copia = JSON.parse(JSON.stringify(dataset));

  Object.keys(copia).forEach((anno) => {
    const ce = copia[anno]?.ce;
    const manuali = par?.perAnno?.[anno];
    if (!ce || !manuali) return;

    /* ---- 1. gli override che hanno un gemello nel conto economico ---- */
    const corretto = {};
    OVERRIDE_CE.forEach(({ parKey, ceKey, assoluto }) => {
      const v = num(manuali[parKey]);
      if (!isNum(v)) return;
      ce[ceKey] = assoluto ? Math.abs(v) : v;
      corretto[ceKey] = true;
    });
    if (!corretto.costoLavoro) return;

    /* ---- 2. gradino basso: il valore aggiunto segue il costo del lavoro ---- */
    if (!isNum(ce.ebitda)) return;
    ce.valoreAggiunto = ce.ebitda + ce.costoLavoro;

    /* ---- 3. gradino alto: i costi esterni si sgravano della differenza ----
       Il personale estratto dalle note era compreso nei costi esterni letti dal
       riclassificatore: lasciarli intatti lo conterebbe due volte. */
    if (!isNum(ce.ricavi)) return;
    const esterniAttesi = ce.ricavi - ce.valoreAggiunto;
    const esterniCorrenti = somma(
      isNum(ce.costoVenduto) ? Math.abs(ce.costoVenduto) : null,
      isNum(ce.costiServizi) ? Math.abs(ce.costiServizi) : null
    );
    if (!isNum(esterniCorrenti)) return;

    const scarto = esterniCorrenti - esterniAttesi;
    if (Math.abs(scarto) < 0.5) return; // la scala era già chiusa

    /* Si sgrava il costo del venduto, dove il personale industriale è sepolto.
       Se però il costo del venduto è a sua volta un dato corretto a mano, la
       rettifica passa ai servizi per non disfare la correzione dell'analista. */
    const suServizi = corretto.costoVenduto || !isNum(ce.costoVenduto);
    const bersaglio = suServizi ? "costiServizi" : "costoVenduto";
    if (!isNum(ce[bersaglio])) return;

    const nuovo = Math.abs(ce[bersaglio]) - scarto;
    /* Una rettifica che porterebbe la voce sotto zero non è una riconciliazione
       ma un sintomo: si lascia la voce dov'è e la scala resta aperta, visibile. */
    if (nuovo < 0) return;
    ce[bersaglio] = nuovo;
  });

  return copia;
}

/** Riconosce il modulo dal file, con fallback sulla forma degli aggregati. */
export function rilevaModulo(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (slug(obj.modulo || "").includes("rendicontofinanziario")) return "rf";
  if (slug(obj.formato || "").startsWith("cericlassificato")) return "ce";
  if (slug(obj.applicazione || "").includes("riclassificazionesp")) return "sp";

  const ag = obj?.esercizioCorrente?.aggregati || {};
  if ("ebitda" in ag || "valoreAggiunto" in ag) return "ce";
  if ("cinTot" in ag || "pfnBreve" in ag || "totImpieghi" in ag) return "sp";
  if ("fcfo" in ag || "flussoOperativoCorrente" in ag) return "rf";
  if (obj?.esercizioCorrente?.cassaFinale !== undefined) return "rf";
  return null;
}

/** Somma gli importi delle voci di una data classe (case-insensitive). */
const sommaClasse = (voci, classe) => {
  if (!Array.isArray(voci)) return null;
  const sel = voci.filter((v) => slug(v?.classe) === slug(classe));
  if (!sel.length) return null;
  return sel.reduce((acc, v) => acc + (num(v.importo) || 0), 0);
};

/* ── Mapping da `aggregati` alle grandezze canoniche ───────────────────────── */

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
    // MON = reddito operativo della sola gestione caratteristica (numeratore del ROI operativo)
    mon: num(ag.redditoOperativoCaratteristica) ?? num(ag.ebit),
    utileNetto: num(ag.utileNetto),
    // Oneri finanziari LORDI: non sono negli aggregati, si sommano dalle voci.
    // Fallback: valore assoluto della gestione finanziaria se questa è negativa.
    oneriFinanziari,
    // Saldo della gestione finanziaria ATTIVA (proventi da investimenti finanziari)
    proventiFinanziari: isNum(proventiDaVoci) ? proventiDaVoci : isNum(gf) && gf > 0 ? gf : null,
    gestioneFinanziaria: gf,
    gestioneNonCorrente: num(ag.gestioneNonCorrente),
    ammortamenti: sommaClasse(e?.voci, "AMMORTAMENTI"),
    accantonamenti: sommaClasse(e?.voci, "ACCANTONAMENTI"),
    costoVenduto: sommaClasse(e?.voci, "ACQUISTI"),
    costoLavoro: sommaClasse(e?.voci, "PERSONALE"),
    costiServizi: sommaClasse(e?.voci, "SERVIZI"),
    valoreAggiunto: num(ag.valoreAggiunto),
    risultatoAnteImposte: rai,
    imposte: num(ag.imposte),
    // RAOF = Risultato Ante Oneri Finanziari: reddito complessivo prodotto
    // dall'attivo prima della remunerazione del debito.
    raof: somma(rai, oneriFinanziari),
  };
}

/* ---------------------------------------------------------------------------
   Scomposizione delle immobilizzazioni per l'analisi di correlazione.
   Gli aggregati si fermano a «immobOper»: i margini di struttura hanno però
   bisogno di distinguere immateriali, immobilizzazioni tecniche e
   partecipazioni, che nei moduli SP restano solo come singole voci. Si
   classificano quindi per denominazione, con priorità: immateriali →
   partecipazioni → tecniche. La priorità non è un dettaglio — «immobilizzazioni
   immateriali» contiene la stringa «materiali», e senza un ordine finirebbe
   fra le tecniche.
   Ogni valore resta sovrascrivibile a mano dai parametri per esercizio: il
   riconoscimento per nome è un aiuto, non un verdetto.
   --------------------------------------------------------------------------- */
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
    // Solo l'attivo immobilizzato: crediti e liquidità non c'entrano.
    if (cl !== slug("att_op_immobilizzata") && cl !== slug("att_fin_immobilizzata")) return;
    const nome = String(v?.nome || "");
    if (RE_IMMATERIALI.test(nome)) immateriali = accumula(immateriali, v.importo);
    else if (RE_PARTECIPAZIONI.test(nome)) partecipazioni = accumula(partecipazioni, v.importo);
    else if (RE_TECNICHE.test(nome)) ppe = accumula(ppe, v.importo);
  });
  return { immateriali, partecipazioni, ppe };
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
    // COIN = capitale operativo investito netto, denominatore del ROI operativo
    coin: num(ag.cinOper) ?? num(ag.cinTot),
    ccno: num(ag.ccno),
    immobilizzazioniOperative: num(ag.immobOper),
    passivitaOperativeNonCorrenti: num(ag.passOpNC),
    attivitaOperativeCorrenti: attOpCorr,
    passivitaOperativeCorrenti: passOpCorr,
    // Attività e passività operative LORDE: COIN = AttOp − PassOp (leva commerciale)
    attivitaOperative: somma(num(ag.immobOper), attOpMag, attOpCorr),
    passivitaOperative: somma(passOpCorr, num(ag.passOpNC)),
    accessori: num(ag.accessori),
    // Investimenti finanziari = liquidità + altre attività finanziarie
    investimentiFinanziari: somma(liq, finAltre),
    patrimonioNetto: num(ag.pn),
    pfn: num(ag.pfn),
    rimanenze: attOpMag,
    // Attivo circolante = crediti operativi + magazzino + liquidità + attività finanziarie
    attivoCircolante: somma(attOpCorr, attOpMag, liq, finAltre),
    // Passivo corrente = passività operative correnti + debiti finanziari a breve
    passivoCorrente: somma(passOpCorr, debFinC),
    liquidita: liq,
    debitiFinanziariBreve: debFinC,
    debitiFinanziariLungo: num(ag.debFinNC),
    pfnBreve: num(ag.pfnBreve),
    totaleAttivo: num(ag.totAttivoContab) ?? num(ag.totImpieghi),
    // Scomposizione dell'attivo immobilizzato per i margini di struttura.
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

/** Metadati (azienda, valuta, unità) dedotti dall'intestazione del file. */
function metaDa(obj) {
  const s = obj?.schemaCE || obj?.schemaContabile || obj?.esercizioCorrente?.schemaRF || {};
  return {
    azienda: obj?.azienda || null,
    valuta: s.valuta || null,
    unita: s.unita || null,
    schema: s.schema || null,
    // Aliquota fiscale dichiarata dal modulo CE: alimenta il NOPAT. Con la
    // sua fonte (nominale da NI, effettiva media, legale o inserita a mano).
    aliquota: num(obj?.aliquota),
    aliquotaFonte:
      obj?.aliquotaFonte && typeof obj.aliquotaFonte === "object"
        ? obj.aliquotaFonte.tipo === "manuale" ? "Inserita a mano nel Conto Economico" : obj.aliquotaFonte.testo || null
        : null,
  };
}

/* ── Parser "semplice": JSON piatti {anno, ce, sp, rf} ─────────────────────── */

const ALIAS = {
  ce: {
    ricavi: ["ricavi", "ricaviVendite", "fatturato", "revenue", "valoreProduzione"],
    ebitda: ["ebitda", "margineOperativoLordo", "mol"],
    ebit: ["ebit", "risultatoOperativo", "redditoOperativo"],
    oneriFinanziari: ["oneriFinanziari", "interessiPassivi", "interestExpense"],
    utileNetto: ["utileNetto", "risultatoNetto", "utileEsercizio", "netIncome"],
  },
  sp: {
    capitaleInvestitoNetto: ["capitaleInvestitoNetto", "cin", "cinTot", "capitaleInvestito"],
    patrimonioNetto: ["patrimonioNetto", "pn", "mezziPropri", "equity"],
    attivoCircolante: ["attivoCircolante", "attivoCorrente", "currentAssets"],
    passivoCorrente: ["passivoCorrente", "passivitaCorrenti", "currentLiabilities"],
    rimanenze: ["rimanenze", "magazzino", "scorte", "inventory"],
    pfn: ["pfn", "posizioneFinanziariaNetta", "netDebt"],
    liquidita: ["liquidita", "disponibilitaLiquide", "cassa", "cash"],
  },
  rf: {
    liquidita: ["liquidita", "cassaFinale", "disponibilitaLiquide", "cash"],
    flussoOperativo: ["flussoOperativo", "flussoCassaOperativo", "ocf"],
    fcfo: ["fcfo", "freeCashFlowOperativo"],
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

/* ── Parser principale ─────────────────────────────────────────────────────── */

/**
 * Restituisce { modulo, meta, record: [{ anno, blocchi:{sp?,ce?,rf?} }] }.
 * `modulo` è null quando il file è stato letto con il parser semplice.
 */
export function analizzaFile(raw) {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  const modulo = rilevaModulo(obj);

  if (modulo) {
    const record = [];
    ["esercizioCorrente", "esercizioPrecedente"].forEach((k) => {
      const e = obj[k];
      if (!e) return;
      const anno = annoDa(e.esercizio);
      if (!anno) return;
      record.push({ anno, blocchi: { [modulo]: COSTRUTTORI[modulo](e) } });
    });
    return { modulo, meta: metaDa(obj), record };
  }

  return { modulo: null, meta: metaDa(obj), record: parserSemplice(obj) };
}

/** Merge incrementale: aggiunge blocchi senza cancellare i moduli già presenti. */
export function fondiRecord(dataset, record) {
  const next = { ...dataset };
  record.forEach(({ anno, blocchi }) => {
    const esistente = next[anno] || { ce: {}, sp: {}, rf: {}, presenti: {} };
    const presenti = { ...esistente.presenti };
    const agg = { ...esistente };
    Object.entries(blocchi).forEach(([k, v]) => {
      if (!v) return;
      agg[k] = { ...(esistente[k] || {}), ...v };
      if (Object.values(v).some(isNum)) presenti[k] = true;
    });
    next[anno] = { ...agg, presenti };
  });
  return next;
}

/* ── BILANCIO TTM (Generatore Bilancio TTM, formato «bilancio-ttm/2.0») ───────
   Il TTM non è un esercizio: è la finestra degli ultimi dodici mesi chiusa a
   una data infrannuale. Entra nell'impresa in analisi come PERIODO DISTINTO,
   con la chiave decimale del generatore (FY 2025 + 6 mesi → 2025,5: sei mesi
   dopo la chiusura del 2025), così si colloca fra il 2025 e il 2026 senza
   sovrascrivere il bilancio annuale. Quando arriva l'esercizio successivo
   chiuso (2026), il TTM è superato e viene tolto.
   Il file porta solo la colonna TTM: CE e RF sono flussi di dodici mesi, lo SP
   è la fotografia alla data infrannuale (possibile stagionalità del circolante). */
export const eBilancioTtm = (o) => typeof o?.formato === "string" && o.formato.startsWith("bilancio-ttm");
/** Etichette dei periodi TTM registrati, per i selettori: chiave → «TTM 06/2026». */
let ETICHETTE_PERIODO = {};
export const etichettaPeriodo = (a) => ETICHETTE_PERIODO[a] || String(a).replace(".", ",");
export const ePeriodoTtm = (a) => !!ETICHETTE_PERIODO[a];

function etichettaTtm(o) {
  const d = String(o?.esercizioCorrente?.dataRiferimento || o?.periodoZero?.dataRiferimento || "");
  const m = d.match(/(\d{4})-(\d{2})/) || d.match(/(\d{1,2})[/.-](\d{4})$/);
  if (m) return m[1].length === 4 ? `TTM ${m[2]}/${m[1]}` : `TTM ${String(m[1]).padStart(2, "0")}/${m[2]}`;
  const mm = d.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (mm) return `TTM ${String(mm[2]).padStart(2, "0")}/${mm[3]}`;
  return String(o?.esercizioCorrente?.esercizio || "TTM");
}

/** bilancio-ttm → { chiave, record, meta } nel formato dei record di questo programma. */
export function recordDaTtm(o, nomeFile = "") {
  const ec = o?.esercizioCorrente || {};
  const chiave = Number(ec.annoDecimale ?? o?.periodoZero?.annoDecimale ?? o?.periodoZero?.anno);
  if (!Number.isFinite(chiave)) throw new Error("il file TTM non dichiara l'anno decimale del periodo");
  if (Number.isInteger(chiave)) throw new Error("il periodo TTM coincide con un esercizio intero: è un bilancio annuale?");
  const ce = ec.aggregatiCE || ec.aggregati || {};
  const sp = ec.aggregatiSP || {};
  const rf = ec.aggregatiRF || {};
  const n = (x) => num(x);
  const somma2 = (...xs) => (xs.some((x) => isNum(n(x))) ? xs.reduce((a, x) => a + (n(x) || 0), 0) : null);
  /* SP: il generatore espone le componenti (crediti, rimanenze, altri crediti…)
     invece degli aggregati del modulo SP: si ricompongono qui, campo per campo. */
  const attOpCorr = somma2(sp.creditiComm, sp.altriCreditiOp);
  const passOpCorr = somma2(sp.debitiComm, sp.altriDebitiOp);
  const liq = n(sp.liq);
  const finAltre = n(sp.attFinNonOper);
  const blocchiSp = {
    capitaleInvestitoNetto: n(sp.cin),
    coin: n(sp.cin),
    ccno: n(sp.ccno),
    immobilizzazioniOperative: n(sp.immobOper),
    passivitaOperativeNonCorrenti: n(sp.passOpNC),
    attivitaOperativeCorrenti: attOpCorr,
    passivitaOperativeCorrenti: passOpCorr,
    attivitaOperative: somma(n(sp.immobOper), n(sp.rimanenze), attOpCorr),
    passivitaOperative: somma(passOpCorr, n(sp.passOpNC)),
    accessori: null,
    investimentiFinanziari: somma(liq, finAltre),
    patrimonioNetto: n(sp.pn),
    pfn: n(sp.pfn),
    rimanenze: n(sp.rimanenze),
    attivoCircolante: somma(attOpCorr, n(sp.rimanenze), liq, finAltre),
    passivoCorrente: somma(passOpCorr, n(sp.debFinC)),
    liquidita: liq,
    debitiFinanziariBreve: n(sp.debFinC),
    debitiFinanziariLungo: n(sp.debFinNC),
    pfnBreve: n(sp.pfnBreve),
    totaleAttivo: somma(n(sp.immobOper), n(sp.rimanenze), attOpCorr, liq, finAltre),
    immateriali: n(sp.immobImm),
    partecipazioni: n(sp.immobFin),
    ppe: somma(n(sp.immobMat), n(sp.dirittiUso)),
  };
  const record = {
    ce: Object.keys(ce).length ? bloccoCE({ aggregati: ce, voci: Array.isArray(ec.voci) ? ec.voci : [] }) : {},
    sp: Object.keys(sp).length ? blocchiSp : {},
    rf: Object.keys(rf).length ? bloccoRF({ aggregati: rf, cassaFinale: sp.liq }) : {},
  };
  const presenti = {};
  ["ce", "sp", "rf"].forEach((k) => { if (Object.values(record[k]).some(isNum)) presenti[k] = true; });
  return {
    chiave,
    record: { ...record, presenti },
    meta: {
      chiave,
      etichetta: etichettaTtm(o),
      dataRiferimento: ec.dataRiferimento || null,
      mesiCoperti: num(ec.mesiCoperti ?? o?.periodoZero?.mesiCoperti),
      esercizioBase: o?.periodoZero?.esercizioBase || null,
      unita: o?.unita || null,
      valuta: o?.valuta || null,
      nomeFile,
      generatoIl: o?.generatoIl || null,
    },
  };
}

/** Toglie il TTM superato: esiste già l'esercizio chiuso che lo comprende. */
export function ttmSuperato(esercizi, ttm) {
  return !!(ttm && esercizi?.[Math.floor(ttm.chiave) + 1]);
}

/* ── ZIP delle riclassificazioni ─────────────────────────────────────────────
   Lo ZIP prodotto dalla suite di riclassificazione ha una cartella per
   esercizio («2024-2025/») con i JSON di SP, CE e RF. Ogni JSON porta due
   esercizi (T e T-1) e un file letto dopo sovrascrive i campi già presenti:
   i file si importano quindi dal più RECENTE al più remoto, così ogni anno
   resta con i valori del proprio bilancio e non con la colonna comparativa
   dell'esercizio successivo. JSZip: quello della pagina, se c'è, altrimenti
   da cdnjs. */
let promessaJsZip = null;
const caricaJsZip = () => {
  if (typeof window !== "undefined" && window.JSZip) return Promise.resolve(window.JSZip);
  if (!promessaJsZip)
    promessaJsZip = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => (window.JSZip ? ok(window.JSZip) : ko(new Error("JSZip non disponibile")));
      s.onerror = () => { promessaJsZip = null; ko(new Error("JSZip non caricato")); };
      document.head.appendChild(s);
    });
  return promessaJsZip;
};
export const eZip = (f) => /\.zip$/i.test(f?.name || "") || /zip/i.test(f?.type || "");

/** ZIP → [{ origine, testo }] dei JSON di riclassificazione, dal più recente. */
export async function leggiZipRiclassificazioni(file) {
  const JSZip = await caricaJsZip();
  const zip = await JSZip.loadAsync(file);
  const voci = [];
  for (const [percorso, v] of Object.entries(zip.files)) {
    if (v.dir || /(^|\/)(__MACOSX\/|\._)/.test(percorso) || !/\.json$/i.test(percorso)) continue;
    if (/(^|\/)sessione\.json$/i.test(percorso)) continue; // indice della suite, non un modulo
    const testo = await v.async("string");
    if (/"formato"\s*:\s*"analisi-bilancio\//.test(testo.slice(0, 400))) continue; // analisi salvata, non un modulo
    if (/"applicazione"\s*:\s*"[^"]*Qualit[àa] Contabile/.test(testo.slice(0, 600))) continue; // salvataggio di Quality of Earnings
    if (/"formato"\s*:\s*"bilancio-ttm/.test(testo.slice(0, 400))) { voci.push({ origine: percorso, testo, anno: 0, ttm: true }); continue; }
    if (/"formato"\s*:\s*"(proforma-dcf|comparazione-)/.test(testo.slice(0, 400))) continue; // DCF e comparazione della suite
    const cartella = percorso.match(/(?:^|\/)(\d{4})-(\d{4})\/[^/]+$/);
    let anno = cartella ? Number(cartella[2]) : 0;
    if (!anno) {
      try {
        const o = JSON.parse(testo);
        anno = annoDa(o?.esercizioCorrente?.esercizio ?? o?.esercizio) || 0;
      } catch { /* resta 0: va in fondo */ }
    }
    voci.push({ origine: percorso, testo, anno });
  }
  voci.sort((a, b) => b.anno - a.anno || a.origine.localeCompare(b.origine));
  return voci;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3-bis. MOTORE IA E LETTURA DOCUMENTI
   ═══════════════════════════════════════════════════════════════════════════
   Blocco ripreso dal modulo «Rendiconto Finanziario Riclassificato» e usato
   qui dalla Fase 1 · sub-tab «Integrazione Documentale». Cambia soltanto il
   prompt: là si cercavano rettifiche ai flussi di cassa, qui si cercano i
   PARAMETRI MANCANTI da iniettare in par.perAnno[anno]. Tutto il resto —
   chiamata multi-provider, ritentativi con backoff, parsing JSON robusto,
   lettura nativa dei PDF con suddivisione in porzioni — è identico, perché è
   la parte già rodata e non c'è ragione di riscriverla.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ---------- Destinazione delle chiamate al provider Claude ----------
   Di norma il proxy del progetto (/api/anthropic), che custodisce la chiave
   lato server; dentro un artifact il proxy non esiste ed è l'ambiente stesso
   ad autenticare, quindi si chiama direttamente l'API. Un override a runtime
   resta possibile via window.__CLAUDE_ENDPOINT__. Qui non si usa
   `import.meta`: è sintassi legale solo dentro un modulo ES e farebbe fallire
   il parsing quando il componente viene incollato in un artifact. */
const ENDPOINT_API_DIRETTA = "https://api.anthropic.com/v1/messages";

/** Il proxy esiste solo dove l'applicazione è servita da un backend proprio. */
const hostConProxy = () => {
  if (typeof window === "undefined") return false;
  const proto = (window.location && window.location.protocol) || "";
  const host = (window.location && window.location.hostname) || "";
  /* Una pagina aperta da disco (file://) o servita da un host che ospita
     artifact non ha alcun /api/anthropic dietro di sé. */
  if (proto === "file:" || proto === "blob:") return false;
  if (/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(host)) return false;
  return true;
};

/**
 * Destinazione della chiamata. Decisa AL MOMENTO DELLA CHIAMATA e non una
 * volta per tutte al caricamento, perché dipende da un dato che al
 * caricamento non si conosce: se l'analista ha digitato una propria chiave.
 *
 * Con una chiave in mano si parla direttamente con l'API, ed è l'unico modo
 * che funzioni quando la pagina è un file autonomo aperto dal browser: il
 * proxy `/api/anthropic` è un percorso relativo che lì non risolve nulla, e
 * la richiesta moriva con un 404 travestito da errore del modello.
 * Senza chiave si usa il proxy, che la custodisce lato server, oppure l'API
 * diretta quando è l'ambiente ospite ad autenticare.
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
/* Impostato da chi monta il programma (prop «iaEsterna», es. la suite di
   riclassificazione): le credenziali le aggiunge l'ospite (artifact su
   claude.ai o chiave unica della suite), quindi qui la chiave non va chiesta. */
let IA_ESTERNA = false;
/* Stato dell'analisi in blocco dei documenti della suite («Analizza tutti»):
   chi ospita il programma lo legge da apiRef.statoIntegrazione() per sapere
   quando l'integrazione documentale è finita. Si azzera a ogni montaggio. */
let STATO_LOTTO = { avviato: false, inCorso: false, finito: false, fatti: 0, totale: 0, bloccante: "" };
let CONTA_ISTANZE = 0;
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

/* `pdfBase64`, se presente, allega il documento nel formato nativo del
   provider (blocco «document» per Claude, «inline_data» per Gemini). Con
   OpenAI, che non accetta PDF grezzi, le pagine vengono prima convertite in
   immagini lato client e allegate come «image_url». */
/* Le richieste di questo programma sono contrassegnate nel momento in cui
   partono: chi lo ospita (la suite di riclassificazione) le riconosce e non
   vi aggiunge istruzioni pensate per un singolo esercizio. */
const fetchRS = (...argomenti) => {
  if (typeof window === "undefined") return fetch(...argomenti);
  window.__richiestaRedditivita = true;
  try { return fetch(...argomenti); } finally { window.__richiestaRedditivita = false; }
};

async function chiamaIA({ provider, apiKey, model, prompt, pdfBase64 = null, onAvviso = null }) {
  const istruzioneJson =
    "\n\nIMPORTANTE: rispondi esclusivamente con l'oggetto JSON richiesto, senza testo introduttivo, senza commenti e senza blocchi ```.";

  if (provider === "openai") {
    const contenutoOpenAi = pdfBase64
      ? [...(await pdfBase64ToPartiOpenAI(pdfBase64, onAvviso)), { type: "text", text: prompt + istruzioneJson }]
      : prompt + istruzioneJson;
    const res = await fetchRS("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: contenutoOpenAi }],
        response_format: { type: "json_object" },
        temperature: 0,
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
          { type: "text", text: prompt + istruzioneJson },
        ]
      : [{ type: "text", text: prompt + istruzioneJson }];
    const res = await fetchRS(endpointClaude(apiKey), {
      method: "POST",
      headers: headerClaude(apiKey),
      body: JSON.stringify({ model, max_tokens: 16000, temperature: 0, messages: [{ role: "user", content: contenuto }] }),
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
  const res = await fetchRS(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parti }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
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

/* ---------- Regolatore di ritmo ------------------------------------------
   Il ritentativo con backoff governa la singola chiamata; su un documento di
   duecento pagine il problema è però un altro, e sta a monte: venticinque
   richieste ravvicinate saturano il limite di token al minuto del piano
   tariffario, e da lì in poi fallisce tutto — non perché il documento sia
   illeggibile, ma perché è stato chiesto troppo in fretta. Il ritentativo da
   solo non basta: riprova dentro la stessa congestione che ha appena creato.

   Il regolatore fa tre cose. Serializza, perché il limite è sui token al
   minuto e la concorrenza qui non fa guadagnare nulla. Distanzia, con un
   intervallo minimo fra due partenze. Si adatta: l'intervallo raddoppia a ogni
   congestione e rientra dopo una serie di successi, così il passo si accorda
   da sé al limite effettivo del piano invece di essere una costante indovinata
   a tavolino. */
const INTERVALLO_BASE_IA = 1100;
const INTERVALLO_MAX_IA = 45000;
const SUCCESSI_PER_ACCELERARE = 4;
/* Pausa prima di riprovare le porzioni non lette: serve a lasciar rientrare la
   finestra del limite, non a «dare tempo» al modello. */
const PAUSA_PRIMA_DELLA_RIPRESA = 20000;

const ritmoIA = { intervallo: INTERVALLO_BASE_IA, ultimaPartenza: 0, coda: Promise.resolve(), successi: 0 };

function segnalaCongestione() {
  ritmoIA.successi = 0;
  ritmoIA.intervallo = Math.min(INTERVALLO_MAX_IA, Math.max(2500, Math.round(ritmoIA.intervallo * 2)));
}

function segnalaSuccesso() {
  ritmoIA.successi++;
  if (ritmoIA.successi >= SUCCESSI_PER_ACCELERARE && ritmoIA.intervallo > INTERVALLO_BASE_IA) {
    ritmoIA.successi = 0;
    ritmoIA.intervallo = Math.max(INTERVALLO_BASE_IA, Math.round(ritmoIA.intervallo * 0.7));
  }
}

/** Accoda una chiamata rispettando l'intervallo corrente. */
function inCodaIA(fn) {
  const mia = ritmoIA.coda.then(async () => {
    const daAspettare = ritmoIA.intervallo - (Date.now() - ritmoIA.ultimaPartenza);
    if (daAspettare > 0) await attesa(daAspettare);
    ritmoIA.ultimaPartenza = Date.now();
    return fn();
  });
  /* La coda non deve rompersi per un errore: il fallimento appartiene al
     chiamante, non alla catena che ordina le chiamate successive. */
  ritmoIA.coda = mia.then(
    () => {},
    () => {}
  );
  return mia;
}

async function chiamaIAConRitentativi(args, { tentativi = 5, baseMs = 900, onRitento } = {}) {
  let ultimo;
  for (let i = 0; i < tentativi; i++) {
    try {
      const out = await inCodaIA(() => chiamaIA(args));
      segnalaSuccesso();
      return out;
    } catch (e) {
      ultimo = e;
      if (!erroreTransitorio(e)) throw e;
      segnalaCongestione();
      if (i === tentativi - 1) throw e;
      const pausa = Math.round(baseMs * 2 ** i + Math.random() * 400);
      if (onRitento) onRitento(i + 1, pausa, e);
      await attesa(pausa);
    }
  }
  throw ultimo;
}

/* ---------- Parsing JSON robusto ----------
   Due modalità di fallimento con logiche opposte:
   1) TRONCAMENTO (fine token a metà stringa/array) → si ripara chiudendo
      stringhe e parentesi rimaste aperte;
   2) CONTENUTO EXTRA DOPO UN JSON COMPLETO → si individua la fine del primo
      valore di primo livello e si scarta tutto ciò che segue.
   Si prova prima il caso (2): tentare la riparazione da troncamento su un
   JSON già completo riporterebbe allo stesso errore. */
function parseJsonRobusto(raw) {
  let s = String(raw).replace(/```json|```/g, "").trim();
  const inizio = s.indexOf("{");
  if (inizio > 0) s = s.slice(inizio);
  try {
    return JSON.parse(s);
  } catch {
    const fineValore = trovaFineValoreJson(s);
    if (fineValore != null) {
      try {
        return JSON.parse(s.slice(0, fineValore));
      } catch {
        /* non valido comunque: si prosegue con la riparazione da troncamento */
      }
    }
    let inString = false;
    let escaped = false;
    let lastSafe = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') { inString = false; lastSafe = i + 1; }
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "}" || c === "]") lastSafe = i + 1;
      else if (c === ",") lastSafe = i;
    }
    let riparato = s.slice(0, lastSafe).replace(/,\s*$/, "");
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

/* ---------- Lettura file: testo + PDF via pdf.js da cdnjs ----------
   Resta la build UMD 3.11.174: le 4.x su cdnjs sono solo ESM e non si possono
   caricare con uno <script> iniettato a runtime. */
const PDFJS_VER = "3.11.174";

/* Sorgente del worker: se la pagina incorpora pdf.js (bundle locale) espone
   anche il codice del worker in `window.__PDFJS_WORKER_SRC__`, che viene
   trasformato in un blob-URL same-origin. Solo in assenza del bundle si
   ripiega sul CDN, che una Content-Security-Policy restrittiva blocca. */
function sorgenteWorkerPdfJs() {
  const codice = window.__PDFJS_WORKER_CODE__;
  if (typeof codice === "string" && codice.length > 1000) {
    try {
      return URL.createObjectURL(new Blob([codice], { type: "application/javascript" }));
    } catch {
      /* prosegue con il CDN */
    }
  }
  const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;
  try {
    /* Un Worker non può essere costruito da un URL cross-origin: si crea un
       piccolo worker locale (blob) che importa quello del CDN. Senza questo
       accorgimento pdf.js ripiega sul «fake worker» e lavora sul thread
       principale, bloccando l'interfaccia durante la rasterizzazione. */
    const shim = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: "application/javascript" });
    return URL.createObjectURL(shim);
  } catch {
    return workerUrl;
  }
}

function caricaPdfJs() {
  if (window.pdfjsLib && window.__pdfJsPronto) return Promise.resolve(window.pdfjsLib);
  if (window.__pdfJsPromise) return window.__pdfJsPromise;
  window.__pdfJsPromise = new Promise((res, rej) => {
    const avvia = () => {
      const lib = window.pdfjsLib;
      if (!lib) return rej(new Error("Libreria pdf.js non disponibile"));
      lib.GlobalWorkerOptions.workerSrc = sorgenteWorkerPdfJs();
      window.__pdfJsPronto = true;
      res(lib);
    };
    /* La libreria incorporata nella pagina è già qui: nessuna rete, nessuna
       CSP da soddisfare. È il caso normale. */
    if (window.pdfjsLib) return avvia();
    const s = document.createElement("script");
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
    s.onload = avvia;
    s.onerror = () =>
      rej(
        new Error(
          "pdf.js non è disponibile: la libreria non è incorporata nella pagina e il caricamento dal CDN è bloccato " +
            "(tipico dentro un artifact o dietro una Content-Security-Policy restrittiva)."
        )
      );
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

/* ---------- Estrazione del testo PAGINA PER PAGINA ------------------------
   Quando il PDF ha un vero layer di testo — ed è il caso della quasi totalità
   dei filing SEC e dei bilanci depositati — inviare le pagine come immagine
   del PDF nativo è la strada più costosa possibile: duecento pagine native
   consumano un ordine di grandezza in più di token rispetto allo stesso
   contenuto in testo, e obbligano a una richiesta ogni dieci-dodici pagine.
   Estraendo il testo si passa da venticinque chiamate a otto, con lo stesso
   contenuto sotto gli occhi del modello.

   Il numero di pagina viene conservato come marcatore dentro il testo: senza,
   le citazioni tornerebbero prive di riferimento e non si potrebbe più
   risalire alla riga da cui il valore è stato preso. */
/* Testo di una pagina RIGA PER RIGA. pdf.js restituisce frammenti con le loro
   coordinate: unirli con uno spazio appiattiva ogni prospetto in una sola fila
   di numeri, e in una tabella a otto colonne (tre mesi e sei mesi, due anni,
   tre classi di azioni più il consolidato) il modello non poteva più sapere
   quale cifra stesse sotto quale intestazione. Qui i frammenti con la stessa
   ordinata formano una riga, ordinata da sinistra a destra; uno spazio largo
   fra due frammenti diventa una separazione di colonna ben visibile. */
function righeDaTesto(items) {
  const pezzi = (items || [])
    .filter((it) => it && typeof it.str === "string" && it.str.trim() && Array.isArray(it.transform))
    .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 8 }));
  if (!pezzi.length) return (items || []).map((it) => it?.str || "").join(" ");
  pezzi.sort((a, b) => b.y - a.y || a.x - b.x);
  const righe = [];
  for (const p of pezzi) {
    const r = righe[righe.length - 1];
    if (r && Math.abs(r.y - p.y) <= Math.max(2, Math.min(r.h, p.h) * 0.45)) r.parti.push(p);
    else righe.push({ y: p.y, h: p.h, parti: [p] });
  }
  return righe
    .map((r) => {
      r.parti.sort((a, b) => a.x - b.x);
      let out = "";
      let fine = null;
      for (const p of r.parti) {
        if (fine != null) {
          const gap = p.x - fine;
          out += gap > Math.max(10, p.h * 1.2) ? "   " : gap > 0.8 ? " " : "";
        }
        out += p.s;
        fine = p.x + p.w;
      }
      return out.trim();
    })
    .filter(Boolean)
    .join("\n");
}

async function estraiTestoPagine(file, onProgresso) {
  const pdfjsLib = await caricaPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pagine = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pagine.push({ pagina: i, testo: righeDaTesto(content.items) });
    if (typeof page.cleanup === "function") page.cleanup();
    /* Duecento pagine impiegano parecchi secondi: senza avanzamento la fase di
       preparazione è indistinguibile da un blocco dell'interfaccia. */
    if (onProgresso) onProgresso(i, pdf.numPages);
  }
  return pagine;
}

/* Tetto di caratteri per porzione testuale. Un bilancio rende 2.500–4.000
   caratteri per pagina: 90.000 caratteri sono quindi 25-35 pagine per
   richiesta, molte più di quante ne reggerebbe il PDF nativo, perché il testo
   non porta con sé né la grafica né i font. */
const CARATTERI_PER_PORZIONE = 90000;

/* ═══════════════════════════════════════════════════════════════════════════
   SELEZIONE DELLE PAGINE CONTABILI
   ═══════════════════════════════════════════════════════════════════════════
   Un Form 20-F di trecento pagine è per due terzi prosa: fattori di rischio,
   descrizione del business, governance, remunerazione, sostenibilità. Le
   grandezze cercate qui stanno nei prospetti e nelle note, e leggere anche il
   resto significa pagare tre volte la stessa analisi e — problema peggiore —
   diluire i prospetti in mezzo a materiale che non c'entra, dove il modello ha
   più occasioni di rispondere con dei null.

   Il criterio è deliberatamente GENEROSO, perché l'errore costoso non è tenere
   una pagina di troppo ma scartarne una che serviva: si richiede la compresenza
   di lessico contabile e di numeri formattati alla maniera dei prospetti
   (separatore delle migliaia), e si tengono comunque le pagine molto dense di
   cifre anche senza lessico — sono le tabelle — e quelle molto ricche di
   lessico anche senza cifre, che sono le intestazioni delle note.
   Ogni pagina scelta si porta dietro la precedente e la successiva, perché un
   prospetto che comincia in fondo a una pagina finisce nella seguente.

   La selezione NON altera i numeri di pagina: i marcatori [[ pagina N ]]
   restano quelli del documento originale, quindi le citazioni continuano a
   rimandare al fascicolo vero. */
const LESSICO_CONTABILE = new RegExp(
  [
    /* conto economico e costi */
    "employee benefit|personnel|labou?r cost|wages|salaries|compensation expense",
    "depreciation|amortisation|amortization|impairment",
    "revenue|cost of sales|operating (profit|income|expense)|ebit",
    /* stato patrimoniale */
    "trade (receivable|payable)|receivable|payable|inventor(y|ies)",
    "goodwill|intangible|property,? plant|tangible asset|right.of.use",
    "treasury share|own share|share capital|retained earnings|equity",
    "borrowing|indebtedness|overdraft|lease liabilit|financial liabilit|debt",
    "provision|contingen|commitment|guarantee",
    "associate|joint venture|investment in|equity method",
    /* rendiconto finanziario */
    "cash flow|capital expenditure|capex|proceeds from (sale|disposal)",
    "repayment|principal|dividend",
    /* intestazioni dei prospetti e dati per azione */
    "income statement|financial position|balance sheet|comprehensive income|changes in equity",
    "number of employees|headcount|full.time equivalent",
    "shares outstanding|weighted average|per share",
    /* nomenclatura italiana */
    "costo del (lavoro|personale)|ammortament|svalutazion",
    "crediti verso|debiti verso|azioni proprie|dividendi|patrimonio netto",
    "immobilizzazion|rimanenze|fondo (rischi|ammortamento|tfr)|accantonament",
  ].join("|"),
  "gi"
);

/* Numeri con separatore delle migliaia, nelle due convenzioni: «1,234,567» e
   «1.234.567». Un numero isolato non dice nulla, la loro densità sì. */
const CIFRE_DI_PROSPETTO = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g;

/** @returns {{pagine: Array, tenute: number, totali: number, applicata: boolean}} */
function selezionaPagineContabili(pagine, { minPagine = 60 } = {}) {
  const totali = pagine.length;
  /* Sotto una certa lunghezza non c'è nulla da guadagnare, e il rischio di
     scartare qualcosa non è compensato da alcun risparmio. */
  if (totali < minPagine) return { pagine, tenute: totali, totali, applicata: false };

  const rilevante = pagine.map((p) => {
    const t = p.testo || "";
    LESSICO_CONTABILE.lastIndex = 0;
    const termini = new Set((t.match(LESSICO_CONTABILE) || []).map((s) => s.toLowerCase()));
    const cifre = (t.match(CIFRE_DI_PROSPETTO) || []).length;
    return (termini.size >= 2 && cifre >= 6) || cifre >= 25 || termini.size >= 6;
  });

  /* Dilatazione al vicinato: un prospetto a cavallo di due pagine deve restare
     intero, e l'intestazione di una tabella sta spesso sulla pagina prima. */
  const tenuta = rilevante.map((v, i) => v || rilevante[i - 1] || rilevante[i + 1] || false);
  const scelte = pagine.filter((_, i) => tenuta[i]);
  const quota = scelte.length / totali;

  /* Due guardie. Se resta quasi tutto il filtro non serve; se resta quasi
     nulla il filtro ha frainteso il documento (lingua inattesa, testo mal
     estratto) e fidarsene significherebbe non leggere il bilancio. In
     entrambi i casi si torna al documento intero. */
  if (quota > 0.8 || quota < 0.1) return { pagine, tenute: totali, totali, applicata: false };

  return { pagine: scelte, tenute: scelte.length, totali, applicata: true };
}

/**
 * Raggruppa le pagine in porzioni testuali che non superano il tetto di
 * caratteri, ripetendo in testa a ciascuna le ultime pagine della precedente
 * (stessa logica di sovrapposizione della suddivisione del PDF).
 * Le porzioni conservano l'intervallo reale di pagine: i numeri citati dal
 * modello sono già quelli del documento completo, senza offset da riallineare.
 */
function porzioniDiTesto(pagine, sovrapposizione = 1, maxCaratteri = CARATTERI_PER_PORZIONE) {
  const utili = pagine.filter((p) => p.testo && p.testo.trim());
  if (!utili.length) return [];

  const componi = (elenco) => ({
    testo: elenco.map((p) => `\n[[ pagina ${p.pagina} ]]\n${p.testo}`).join("\n"),
    from: elenco[0].pagina,
    to: elenco[elenco.length - 1].pagina,
  });

  const porzioni = [];
  let corrente = [];
  let caratteri = 0;
  for (const p of utili) {
    const costo = p.testo.length + 24;
    if (corrente.length && caratteri + costo > maxCaratteri) {
      porzioni.push(componi(corrente));
      /* La coda ripetuta è in PAGINE, non in caratteri: una tabella spezzata
         sta a cavallo di due pagine, ed è quella l'unità da ripetere. */
      corrente = sovrapposizione > 0 ? corrente.slice(-sovrapposizione) : [];
      caratteri = corrente.reduce((s, q) => s + q.testo.length + 24, 0);
    }
    corrente.push(p);
    caratteri += costo;
  }
  if (corrente.length) porzioni.push(componi(corrente));
  return porzioni;
}

/* ---------- Lettura NATIVA dei PDF (senza estrazione del layer di testo) ----
   pdf.js legge SOLO il layer di testo incorporato: un file prodotto da
   scansione, da «Stampa su PDF» o con i caratteri convertiti in tracciati
   vettoriali ne è privo e restituisce zero caratteri. Per questo il PDF viene
   inviato al modello nel suo formato nativo, in base64: il modello lo legge
   visivamente pagina per pagina. I file voluminosi vengono suddivisi in
   porzioni per rispettare i limiti di richiesta.

   DUE VINCOLI INDIPENDENTI governano la dimensione di una porzione, ed è un
   errore governarne uno solo:
   1) le PAGINE, perché ogni pagina consuma finestra di contesto (≈1.500–3.000
      token) e una porzione troppo lunga la satura prima di arrivare in fondo;
   2) i BYTE, perché il corpo della richiesta ha un tetto rigido (32 MB per
      l'API Anthropic) e il base64 gonfia il binario di 4/3. Un bilancio con il
      testo vettorializzato pesa anche 400 KB per pagina: 25 pagine sforano il
      tetto pur restando poche pagine.
   La suddivisione parte quindi dal numero di pagine e, se la porzione risultante
   supera il tetto in byte, la dimezza ricorsivamente finché rientra.

   ESISTE UN TERZO VINCOLO, e si manifesta solo sui documenti molto lunghi: la
   FINESTRA DI USCITA. Un Form 20-F o un 10-K supera abitualmente le duecento
   pagine; con porzioni grandi il modello riceve più materiale di quanto possa
   riportare in una risposta, e allora non sbaglia — sceglie. Ciò che lascia
   indietro non lo dichiara, e l'estrazione risulta «riuscita» su un documento
   letto a metà. Per questo la dimensione della porzione non è una costante ma
   una funzione della lunghezza: più il fascicolo è lungo, più le porzioni si
   accorciano.

   La SOVRAPPOSIZIONE serve a un problema ancora diverso. Il prospetto delle
   immobilizzazioni, la tabella dei dividendi o la nota sui debiti finanziari
   cadono spesso a cavallo di due porzioni, e vengono troncati in entrambe.
   Ripetendo le ultime pagine di una porzione in testa alla successiva il
   prospetto resta integro almeno una volta; i doppioni non fanno danno, perché
   la fusione a valle sceglie il primo valore utile campo per campo. */

/** Tetto di pagine per porzione sui documenti brevi. Resta il riferimento per
 *  la rasterizzazione (PDF_IMG_MAX_PAGES) e per i testi dell'interfaccia. */
const PAGINE_PER_PORZIONE = 20;

/**
 * Piano di suddivisione adattivo. Le soglie non sono arbitrarie: un fascicolo
 * di bilancio italiano sta sotto le cento pagine, un Annual Report fra cento e
 * duecento, un 20-F o un 10-K fra le duecento e le quattrocento. Ogni scaglione
 * accorcia la porzione e allarga la sovrapposizione.
 */
function pianoSuddivisione(nPagine) {
  if (nPagine <= 25) return { paginePerPorzione: 20, sovrapposizione: 0, profilo: "documento breve" };
  if (nPagine <= 120) return { paginePerPorzione: 16, sovrapposizione: 1, profilo: "documento medio" };
  if (nPagine <= 400) return { paginePerPorzione: 12, sovrapposizione: 2, profilo: "documento lungo" };
  return { paginePerPorzione: 10, sovrapposizione: 2, profilo: "documento molto lungo" };
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

/* Tetto rigido del corpo della richiesta lato provider. */
const LIMITE_RICHIESTA_BYTE = 32 * 1024 * 1024;
/* Tetto operativo del base64 di UNA porzione: si lascia margine per il prompt,
   gli header e l'overhead JSON, che viaggiano nello stesso corpo. */
const SOGLIA_PORZIONE_BASE64 = 18 * 1024 * 1024;
/* Sotto questa soglia il file non si tocca: si invia in un colpo solo. */
const SOGLIA_PORZIONE_BYTE = 8 * 1024 * 1024;
/* Oltre questa profondità di dimezzamento ci si ferma: una singola pagina che
   da sola sfora il tetto non è divisibile oltre. */
const MAX_DIMEZZAMENTI = 6;
/* Tetto di PAGINE per singolo PDF allegato a una richiesta. È un vincolo dei
   provider distinto da quello in byte, e su un Form 20-F è il primo a mordere:
   trecento pagine restano largamente sotto il tetto in byte e vengono comunque
   rifiutate. */
const MAX_PAGINE_ALLEGATO = 100;

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Lettura del file non riuscita"));
    r.readAsDataURL(file);
  });
}

function caricaPdfLib() {
  /* Come per pdf.js: la copia incorporata nella pagina ha la precedenza, il
     CDN è solo la via di riserva quando la pagina non la incorpora. */
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (window.__pdfLibPromise) return window.__pdfLibPromise;
  window.__pdfLibPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    s.onload = () => (window.PDFLib ? res(window.PDFLib) : rej(new Error("Libreria PDF non disponibile")));
    s.onerror = () =>
      rej(
        new Error(
          "la libreria di suddivisione PDF non è incorporata nella pagina e il CDN è irraggiungibile o bloccato dalla CSP"
        )
      );
    document.head.appendChild(s);
  });
  return window.__pdfLibPromise;
}

/* Estrae in base64 l'intervallo di pagine [start, end) del documento. */
export async function estraiPorzione(PDFDocument, doc, start, end) {
  const sub = await PDFDocument.create();
  const pagine = await sub.copyPages(doc, Array.from({ length: end - start }, (_, i) => start + i));
  pagine.forEach((p) => sub.addPage(p));
  return sub.saveAsBase64();
}

/* Produce le porzioni dell'intervallo [start, end) rispettando il tetto in
   byte: se la porzione sfora, la si dimezza e si ricorre sulle due metà.
   Una singola pagina troppo pesante non è divisibile: viene restituita
   comunque, marcata `sovradimensionata`, così il chiamante può avvisare invece
   di far fallire silenziosamente la richiesta. */
export async function porzioniAdattive(PDFDocument, doc, start, end, profondita, onProgresso) {
  const data = await estraiPorzione(PDFDocument, doc, start, end);
  const nPagine = end - start;

  if (data.length <= SOGLIA_PORZIONE_BASE64 || nPagine <= 1 || profondita >= MAX_DIMEZZAMENTI) {
    if (onProgresso) onProgresso(end);
    return [
      {
        data,
        from: start + 1,
        to: end,
        byte: data.length,
        sovradimensionata: data.length > SOGLIA_PORZIONE_BASE64,
      },
    ];
  }

  const meta = start + Math.ceil(nPagine / 2);
  const sinistra = await porzioniAdattive(PDFDocument, doc, start, meta, profondita + 1, onProgresso);
  const destra = await porzioniAdattive(PDFDocument, doc, meta, end, profondita + 1, onProgresso);
  return [...sinistra, ...destra];
}

/* Suddivide il PDF in porzioni secondo il piano adattivo, conservando
   l'intervallo di pagine originario (from/to) per riallineare i riferimenti di
   pagina restituiti dal modello.
   Restituisce { chunks, avvisi, piano, nPagine }: gli avvisi risalgono fino
   all'interfaccia. */
export async function pdfToChunks(file, onProgresso) {
  const avvisi = [];
  const base64Intero = Math.ceil(file.size / 3) * 4;

  try {
    const { PDFDocument } = await caricaPdfLib();
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const nPagine = doc.getPageCount();
    const piano = pianoSuddivisione(nPagine);

    /* File piccolo e corto: nessuna suddivisione. */
    if (nPagine <= piano.paginePerPorzione && file.size <= SOGLIA_PORZIONE_BYTE) {
      if (onProgresso) onProgresso(nPagine, nPagine);
      return {
        chunks: [{ data: await fileToBase64(file), from: 1, to: nPagine, byte: base64Intero }],
        avvisi,
        piano,
        nPagine,
      };
    }

    /* Il passo è più corto della porzione: la differenza è la sovrapposizione,
       cioè le pagine di coda che vengono ripetute in testa alla porzione
       successiva perché un prospetto a cavallo non resti troncato in entrambe. */
    const passo = Math.max(1, piano.paginePerPorzione - piano.sovrapposizione);
    const chunks = [];
    for (let start = 0; start < nPagine; start += passo) {
      const end = Math.min(start + piano.paginePerPorzione, nPagine);
      const parti = await porzioniAdattive(PDFDocument, doc, start, end, 0, (fatte) => {
        if (onProgresso) onProgresso(Math.min(fatte, nPagine), nPagine);
      });
      chunks.push(...parti);
      if (end >= nPagine) break;
    }

    const sovra = chunks.filter((c) => c.sovradimensionata);
    if (sovra.length)
      avvisi.push(
        `${sovra.length} porzione/i resta/no oltre il limite di richiesta anche dopo la suddivisione massima ` +
          `(pagine ${sovra.map((c) => (c.from === c.to ? c.from : `${c.from}–${c.to}`)).join(", ")}): ` +
          "il documento contiene pagine molto pesanti. Se il modello le rifiuta, riduci il PDF alle sole pagine dei prospetti."
      );

    if (chunks.length > 1)
      avvisi.push(
        `${nPagine} pagine · ${piano.profilo}: suddiviso in ${chunks.length} porzioni da ${piano.paginePerPorzione} pagine` +
          (piano.sovrapposizione ? ` con ${piano.sovrapposizione} pagina/e di sovrapposizione` : "") +
          `. L'analisi richiederà qualche minuto.`
      );

    return { chunks, avvisi, piano, nPagine };
  } catch (e) {
    console.warn("Suddivisione PDF non riuscita:", e);

    /* ---- Il fallback «invio il file intero» ha DUE tetti, non uno ---------
       Il tetto in byte è quello ovvio. Quello che faceva fallire i 20-F è
       l'altro: i provider accettano un PDF allegato fino a un centinaio di
       pagine, e un Form 20-F ne ha trecento. Spedito intero tornava un errore
       del provider — non un 413 leggibile, ma un rifiuto sul numero di pagine —
       e l'analisi si fermava lì. Quando la suddivisione non riesce e il
       documento è troppo lungo si dichiara subito il motivo vero, indicando la
       via d'uscita praticabile. */
    let paginePresunte = null;
    try {
      const lib = await caricaPdfJs();
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      paginePresunte = doc.numPages;
    } catch {
      /* se nemmeno pdf.js risponde si giudica sui soli byte */
    }

    if (isNum(paginePresunte) && paginePresunte > MAX_PAGINE_ALLEGATO)
      throw new Error(
        `Il PDF ha ${paginePresunte} pagine e non è stato possibile suddividerlo (${e?.message || e}). ` +
          `Un PDF allegato non può superare ${MAX_PAGINE_ALLEGATO} pagine per richiesta, quindi non è inviabile intero. ` +
          "Se il documento ha testo selezionabile verrà letto come testo e il limite non si applica: " +
          "il problema si presenta solo su scansioni molto lunghe, per le quali va caricato il solo estratto dei prospetti contabili."
      );

    if (base64Intero > LIMITE_RICHIESTA_BYTE)
      throw new Error(
        `Il PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB e non è stato possibile suddividerlo ` +
          `(${e?.message || e}). Oltre il limite di ${LIMITE_RICHIESTA_BYTE / 1024 / 1024} MB per richiesta il file non è inviabile: ` +
          "estrai le sole pagine dei prospetti contabili e ricarica quelle."
      );
    avvisi.push(`Suddivisione non riuscita (${e?.message || e}): il file viene inviato in un'unica richiesta.`);
    return {
      chunks: [{ data: await fileToBase64(file), from: 1, to: paginePresunte, byte: base64Intero }],
      avvisi,
      piano: pianoSuddivisione(1),
      nPagine: paginePresunte,
    };
  }
}

/* ---------- Rasterizzazione delle pagine per OpenAI ----------
   chat/completions accetta immagini ma rifiuta il PDF grezzo: le porzioni
   vengono renderizzate su canvas con pdf.js e inviate come immagini. */
const PDF_IMG_WIDTH = 1500;
/* Deve stare AL DI SOPRA di PAGINE_PER_PORZIONE: la rasterizzazione lavora su
   una porzione già suddivisa, e un tetto più basso della porzione ne
   amputerebbe la coda senza che nessuno se ne accorga. */
const PDF_IMG_MAX_PAGES = Math.max(40, PAGINE_PER_PORZIONE * 2);
const PDF_IMG_MAX_BYTES_PAGE = 420 * 1024;

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
  const { maxPages = PDF_IMG_MAX_PAGES, targetWidth = PDF_IMG_WIDTH, mimeType = "image/jpeg", onProgress = null } = opts;
  const pdfjsLib = await caricaPdfJs();
  const data = await pdfToUint8Array(input);
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  /* Va letto PRIMA della distruzione del documento: dopo `doc.destroy()` la
     proprietà non è più interrogabile. */
  const pagineTotali = doc.numPages;
  const nPagine = Math.min(pagineTotali, maxPages);
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
      let dataUrl = "";
      for (const q of [0.82, 0.65, 0.5, 0.38]) {
        dataUrl = canvas.toDataURL(mimeType, q);
        if (dataUrl.length * 0.75 <= PDF_IMG_MAX_BYTES_PAGE) break;
      }
      immagini.push({ page: i, mediaType: mimeType, data: dataUrl.split(",")[1] || "", dataUrl });
      canvas.width = 0;
      canvas.height = 0;
      if (typeof page.cleanup === "function") page.cleanup();
      if (onProgress) onProgress(i, nPagine);
    }
  } finally {
    if (typeof doc.destroy === "function") await doc.destroy();
  }
  if (!immagini.length) throw new Error("Il PDF non contiene pagine convertibili in immagini");
  /* Se il tetto ha tagliato delle pagine lo si dichiara sull'oggetto restituito:
     il chiamante lo trasforma in un avviso visibile. Un troncamento silenzioso
     produrrebbe un'estrazione «riuscita» su un documento letto a metà. */
  immagini.scartate = Math.max(0, pagineTotali - nPagine);
  immagini.totali = pagineTotali;
  return immagini;
}

/* La stessa porzione può essere inviata più volte (NI e RG di anni diversi) e
   ogni chiamata può essere ripetuta fino a 5 volte: senza cache la
   rasterizzazione verrebbe rifatta a ogni giro. */
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

async function pdfBase64ToPartiOpenAI(pdfBase64, onAvviso) {
  let pagine;
  try {
    pagine = await pdfToImagesCached(pdfBase64);
  } catch (e) {
    throw new Error(
      `Conversione del PDF in immagini non riuscita (${e?.message || e}). ` +
        "Riprova oppure seleziona Claude o Gemini, che leggono il PDF nel formato nativo."
    );
  }
  if (pagine.scartate > 0) {
    const msg =
      `Rasterizzazione per OpenAI: analizzate solo le prime ${pagine.length} pagine di ${pagine.totali} ` +
      `(${pagine.scartate} scartate dal limite di conversione). Usa Claude o Gemini per leggere l'intero documento.`;
    if (onAvviso) onAvviso(msg);
    else console.warn(msg);
  }
  const parti = [];
  for (const p of pagine) {
    parti.push({ type: "text", text: `— Pagina ${p.page} del documento allegato —` });
    parti.push({ type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}`, detail: "high" } });
  }
  return parti;
}

/* ---------- Sonda del layer di testo ----------
   Distingue i tre modi in cui un PDF può presentarsi, che richiedono strategie
   diverse e producono errori diversi:
   • «testo»       — il layer è presente e leggibile senza modello;
   • «vettoriale»  — i caratteri sono stati convertiti in tracciati (tipico di
                     «Stampa su PDF» e degli export da visualizzatore): a schermo
                     si legge benissimo, ma non esiste un solo carattere
                     estraibile, e il file pesa un ordine di grandezza in più;
   • «scansione»   — pagine come immagini, nessun testo.
   In tutti e tre i casi il PDF viene letto visivamente dal modello; la sonda
   serve a spiegare all'utente perché un file «di testo» si comporta come una
   scansione, e a dissuaderlo dai provider che richiedono rasterizzazione. */
export async function sondaTestoPdf(file, maxPagine = 12) {
  try {
    const pdfjsLib = await caricaPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const totali = pdf.numPages;

    /* ---- Campionamento DISTRIBUITO, non le prime pagine ------------------
       Le prime pagine di un Form 20-F o di un 10-K sono la copertina, il
       frontespizio e l'indice: poche righe di testo, a volte un logo e nulla
       più. Giudicando il documento da lì, un fascicolo con un ottimo layer di
       testo veniva classificato «scansione» e dirottato sulla lettura visiva —
       trecento pagine di immagini invece di ottocentomila caratteri di testo.
       Si campiona quindi a passo costante lungo TUTTO il documento, che è
       l'unico modo di vedere anche i prospetti contabili, che stanno in fondo. */
    const n = Math.min(totali, Math.max(4, maxPagine));
    const indici = [];
    for (let k = 0; k < n; k++) {
      const p = 1 + Math.round((k * (totali - 1)) / Math.max(1, n - 1));
      if (!indici.includes(p)) indici.push(p);
    }

    let caratteri = 0;
    let immagini = 0;
    let conTesto = 0;
    for (const i of indici) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const c = content.items.reduce((s, it) => s + String(it.str || "").trim().length, 0);
      caratteri += c;
      if (c >= 200) conTesto += 1;
      try {
        const ops = await page.getOperatorList();
        const OPS = pdfjsLib.OPS || {};
        immagini += ops.fnArray.filter(
          (f) => f === OPS.paintImageXObject || f === OPS.paintJpegXObject || f === OPS.paintInlineImageXObject
        ).length;
      } catch {
        /* la lista operatori è un di più: se non arriva, si giudica sul testo */
      }
      if (typeof page.cleanup === "function") page.cleanup();
    }
    const perPagina = caratteri / Math.max(1, indici.length);
    const quotaConTesto = conTesto / Math.max(1, indici.length);

    /* Basta che UN TERZO delle pagine campionate abbia testo perché convenga
       tentare la via testuale: la verifica seria è la copertura calcolata
       dopo l'estrazione completa, in `preparaFonte`, che sa ripiegare da sé.
       Qui si decide solo quale strada tentare per prima, e sbagliare per
       eccesso di ottimismo costa un'estrazione locale di pochi secondi,
       mentre sbagliare per difetto costa l'intera analisi. */
    const natura =
      perPagina >= 200 || quotaConTesto >= 0.34 ? "testo" : immagini > 0 ? "scansione" : "vettoriale";
    return {
      natura,
      caratteriPerPagina: Math.round(perPagina),
      pagine: totali,
      campionate: indici.length,
      quotaConTesto,
    };
  } catch (e) {
    console.warn("Sonda del layer di testo non riuscita:", e);
    return { natura: "ignota", caratteriPerPagina: null, pagine: null };
  }
}

/* Prepara la «fonte» da sottoporre al modello: PDF → porzioni base64, ogni
   altro caso → estrazione testuale. Restituisce anche gli avvisi diagnostici
   raccolti lungo il percorso, che l'interfaccia mostra all'analista. */
export async function preparaFonte(file, provider, onProgresso, { soloPagineContabili = true } = {}) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const sonda = await sondaTestoPdf(file);

    /* ---- Via testuale, quando il layer di testo c'è davvero ----------------
       È la differenza fra un'analisi di otto chiamate e una di venticinque
       sullo stesso 20-F. Si tenta per prima, e si ripiega sul PDF nativo se il
       testo estratto risulta troppo rado: un layer presente sul frontespizio e
       assente sui prospetti (capita nei fascicoli assemblati da fonti diverse)
       produrrebbe altrimenti un'estrazione che cerca numeri dove non ce ne
       sono. */
    if (sonda.natura === "testo" || sonda.natura === "ignota") {
      try {
        const pagine = await estraiTestoPagine(file, onProgresso);
        const conTesto = pagine.filter((p) => p.testo.trim().length >= 200).length;
        const copertura = pagine.length ? conTesto / pagine.length : 0;
        const caratteriTotali = pagine.reduce((s, p) => s + p.testo.trim().length, 0);
        /* Si accetta la via testuale quando il testo estratto è abbastanza da
           reggere l'analisi. La sola percentuale di pagine non basta: un
           fascicolo che allega decine di tavole grafiche in coda abbassa la
           copertura sotto la soglia pur avendo tutti i prospetti in testo. Il
           secondo criterio guarda quindi alla sostanza — quante pagine di
           testo e quanti caratteri — invece che alla proporzione. */
        const abbastanza = copertura >= 0.5 || (conTesto >= 20 && caratteriTotali >= 40000);
        if (abbastanza) {
          const avvisi = [];

          /* Sui fascicoli lunghi si tengono le sole pagine contabili: su un
             20-F sono circa un terzo del documento, e le altre due terzi sono
             prosa in cui non c'è nulla da estrarre. */
          const filtro = soloPagineContabili
            ? selezionaPagineContabili(pagine)
            : { pagine, tenute: pagine.length, totali: pagine.length, applicata: false };
          const daLeggere = filtro.pagine;

          const piano = pianoSuddivisione(pagine.length);
          const porzioni = porzioniDiTesto(daLeggere, Math.max(1, piano.sovrapposizione));
          if (onProgresso) onProgresso(pagine.length, pagine.length);

          if (porzioni.length > 1)
            avvisi.push(
              `${pagine.length} pagine con testo selezionabile · ${piano.profilo}: lette come TESTO in ${porzioni.length} porzioni ` +
                "invece che come immagini del PDF. È la via più rapida e molto meno costosa in token, a parità di contenuto letto."
            );
          if (filtro.applicata)
            avvisi.push(
              `Selezione delle pagine contabili: ${filtro.tenute} pagine su ${filtro.totali} contengono prospetti, note o ` +
                "tabelle di valori e vengono analizzate; le altre sono prosa discorsiva (fattori di rischio, governance, " +
                "descrizione dell'attività) e vengono saltate. I numeri di pagina citati restano quelli del documento originale. " +
                "Se un valore atteso risulta assente, ripeti l'estrazione togliendo la spunta «solo pagine contabili»."
            );
          if (copertura < 1)
            avvisi.push(
              `${pagine.length - conTesto} pagina/e su ${pagine.length} sono prive di testo estraibile (probabili tabelle ` +
                "vettorializzate o scansionate) e non entrano nell'analisi testuale: se un valore atteso risulta assente, " +
                "ricarica il solo estratto di quelle pagine."
            );
          return {
            tipo: "testoPaginato",
            chunks: porzioni,
            nome: file.name,
            sonda,
            piano,
            nPagine: pagine.length,
            filtro,
            avvisi,
          };
        }
      } catch (e) {
        console.warn("Lettura del layer di testo non riuscita, si procede con il PDF nativo:", e);
      }
    }

    const { chunks, avvisi, piano, nPagine } = await pdfToChunks(file, onProgresso);

    if (sonda.natura === "vettoriale")
      avvisi.unshift(
        `Il PDF non ha un layer di testo: i caratteri sono tracciati vettoriali (tipico di «Stampa su PDF»). ` +
          "Sarà letto visivamente dal modello — è supportato, ma più lento e più costoso di un PDF con testo."
      );
    else if (sonda.natura === "scansione")
      avvisi.unshift("Il PDF è una scansione: sarà letto visivamente dal modello, pagina per pagina.");

    if (provider === "openai" && sonda.natura !== "testo")
      avvisi.push(
        "Con OpenAI ogni pagina va prima convertita in immagine dal browser: su un documento di questo tipo " +
          "l'operazione è lenta e può esaurire la memoria. Claude e Gemini leggono il PDF nel formato nativo."
      );

    return { tipo: "pdf", chunks, nome: file.name, sonda, piano, nPagine, avvisi };
  }
  const testo = await estraiTesto(file);
  /* File di testo e JSON: prima arrivavano al modello in una sola richiesta,
     TRONCATI ai primi 120.000 caratteri. Un filing SEC esportato in JSON
     (blocchi con «text» e «tables», 0,1–6 MB) veniva così letto per meno di un
     decimo: il frontespizio e poco altro. Ora il JSON di un filing diventa una
     serie di «pagine» (una per blocco, allegati esclusi) e ogni testo lungo si
     divide in porzioni come un PDF: si legge tutto. */
  const daJson = pagineDaJsonFiling(testo);
  const pagine = daJson?.pagine || (testo.length > CARATTERI_PER_PORZIONE ? pagineDaTestoLungo(testo) : null);
  if (pagine?.length) {
    const porzioni = porzioniDiTesto(pagine, 1);
    const avvisi = [];
    if (daJson)
      avvisi.push(
        `${file.name}: JSON di un filing con ${daJson.blocchi} blocchi di testo e tabelle` +
          (daJson.esclusi ? `; esclusi ${daJson.esclusi} blocchi degli allegati (exhibits: contratti, certificazioni, copie del documento)` : "") +
          `. Letto per intero in ${porzioni.length} porzion${porzioni.length === 1 ? "e" : "i"}; il «numero di pagina» citato è il numero del blocco.`
      );
    else if (porzioni.length > 1)
      avvisi.push(`${file.name}: testo lungo, letto per intero in ${porzioni.length} porzioni invece di essere troncato.`);
    return {
      tipo: "testoPaginato",
      chunks: porzioni,
      nome: file.name,
      nPagine: pagine.length,
      filtro: { pagine, tenute: pagine.length, totali: pagine.length, applicata: false },
      avvisi,
    };
  }
  return { tipo: "testo", testo, nome: file.name, avvisi: [] };
}

/* JSON di un filing scomposto in blocchi: un array di oggetti con il campo
   «text» (gli altri campi — tabelle cella per cella, hash, metadati — sono
   ridondanti col testo, che riporta già le tabelle in righe con «|»). Gli
   allegati (doc_part «exhibits») si escludono quando c'è altro: sono contratti,
   certificazioni o copie integrali dello stesso documento, e da soli pesano
   anche il 90% del file. */
function pagineDaJsonFiling(testo) {
  const t = String(testo || "").trimStart();
  if (!t.startsWith("[") && !t.startsWith("{")) return null;
  let dati;
  try {
    dati = JSON.parse(t);
  } catch {
    return null;
  }
  const blocchi = Array.isArray(dati) ? dati : Array.isArray(dati?.chunks) ? dati.chunks : Array.isArray(dati?.blocchi) ? dati.blocchi : null;
  if (!blocchi) return null;
  const validi = blocchi.filter((b) => b && typeof b === "object" && typeof b.text === "string" && b.text.trim());
  if (validi.length < 2) return null;
  const allegato = (b) => /exhibit/i.test(String(b.doc_part || "")) || /^exhibits?$/i.test(String(b.section || ""));
  const principali = validi.filter((b) => !allegato(b));
  const scelti = principali.length ? principali : validi;
  const pagine = scelti.map((b, i) => {
    const sezione = [b.doc_part, b.section].filter((x) => x && typeof x === "string").join(" · ");
    const periodo = b.period_end ? ` · periodo al ${b.period_end}` : "";
    return { pagina: i + 1, testo: `${sezione ? `[${sezione}${periodo}]\n` : ""}${b.text}` };
  });
  return { pagine, blocchi: validi.length, esclusi: validi.length - scelti.length };
}

/* Testo lungo qualunque: «pagine» di circa 4.000 caratteri tagliate a fine riga. */
function pagineDaTestoLungo(testo, passo = 4000) {
  const pagine = [];
  let i = 0;
  while (i < testo.length) {
    let fine = Math.min(testo.length, i + passo);
    if (fine < testo.length) {
      const a = testo.lastIndexOf("\n", fine);
      if (a > i + passo / 2) fine = a + 1;
    }
    pagine.push({ pagina: pagine.length + 1, testo: testo.slice(i, fine) });
    i = fine;
  }
  return pagine;
}

/* Esegue il prompt sulla fonte, porzione per porzione, restituendo l'elenco
   dei JSON ottenuti. `costruisciPrompt(testo)` riceve il testo da incorporare
   nel prompt, oppure null quando il documento viaggia come allegato PDF. */
export async function eseguiSuFonte({ provider, apiKey, model, costruisciPrompt, fonte, limiteTesto = 120000, onPorzione, onRitento, onAvviso }) {
  const opzioni = onRitento ? { onRitento } : {};
  if (fonte.tipo === "testo") {
    const prompt = costruisciPrompt(fonte.testo.slice(0, limiteTesto));
    const out = [parseJsonRobusto(await chiamaIAConRitentativi({ provider, apiKey, model, prompt }, opzioni))];
    out.__falliti = [];
    return out;
  }
  const risultati = [];
  const tot = fonte.chunks.length;
  const testuale = fonte.tipo === "testoPaginato";
  let fatte = 0;

  const etichettaIntervallo = (ch) => (ch.from === ch.to ? `${ch.from}` : `${ch.from}–${ch.to ?? "fine"}`);

  /** Una porzione. Restituisce null se è riuscita, l'errore se è fallita. */
  const leggiPorzione = async (ch, indice, ripresa) => {
    if (onPorzione) onPorzione(fatte, tot, { ripresa, intervallo: etichettaIntervallo(ch) });
    /* Nella via testuale i numeri di pagina sono già quelli del documento
       completo, perché viaggiano come marcatori dentro il testo; nella via
       nativa il modello vede un allegato che ricomincia da 1 e l'offset viene
       riportato a valle. Due contratti diversi, due istruzioni diverse: darne
       una sola sposterebbe tutte le citazioni di una porzione. */
    const nota =
      tot === 1
        ? ""
        : testuale
        ? `\n\n⚠ Questo è SOLO l'estratto delle pagine da ${ch.from} a ${ch.to} di un documento più lungo. Analizza esclusivamente questo testo. ATTENZIONE: In questa specifica porzione potresti trovare i dati relativi a un solo anno (es. solo 2024). NON inventare MAI i dati per gli altri anni richiesti se non li vedi scritti esplicitamente qui: ometti le chiavi per gli anni mancanti.`
        : `\n\n⚠ Il documento allegato è SOLO la porzione con le pagine da ${ch.from} a ${ch.to}. Analizza esclusivamente ciò che vedi nell'allegato. ATTENZIONE: Se l'allegato contiene solo i dati di alcune annualità e non di altre, NON inventare i dati mancanti, ma ometti le chiavi per gli anni che non vedi.`;
    const richiesta = testuale
      ? { provider, apiKey, model, prompt: costruisciPrompt(ch.testo.slice(0, limiteTesto)) + nota, onAvviso }
      : { provider, apiKey, model, prompt: costruisciPrompt(null) + nota, pdfBase64: ch.data, onAvviso };

    try {
      const data = parseJsonRobusto(await chiamaIAConRitentativi(richiesta, opzioni));
      data.__offsetPagina = testuale ? 0 : (Number(ch.from) || 1) - 1;
      risultati.push(data);
      fatte++;
      if (onPorzione) onPorzione(fatte, tot, { ripresa, intervallo: etichettaIntervallo(ch) });
      return null;
    } catch (e) {
      /* Una porzione persa NON è un dettaglio da relegare in console: significa
         che una parte del documento non è mai stata letta, e l'analista deve
         saperlo prima di fidarsi dei valori estratti dalle altre. */
      const msg = String(e?.message || e);
      console.warn(`Porzione ${indice + 1}/${tot} (pagine ${etichettaIntervallo(ch)}) non analizzata:`, e);
      return { intervallo: etichettaIntervallo(ch), errore: msg, chunk: ch, indice };
    }
  };

  let falliti = [];
  for (let c = 0; c < tot; c++) {
    const esito = await leggiPorzione(fonte.chunks[c], c, false);
    if (esito) falliti.push(esito);
  }

  /* SECONDA PASSATA sulle porzioni non lette. Una congestione dura molto meno
     dell'analisi di un fascicolo: quasi tutte queste porzioni rientrano al
     secondo tentativo. Riprovare subito, però, significherebbe riprovare dentro
     la stessa congestione che le ha fatte fallire — da qui la pausa. */
  if (falliti.length && risultati.length) {
    if (onAvviso)
      onAvviso(
        `${falliti.length} porzione/i non letta/e (pagine ${falliti.map((f) => f.intervallo).join(", ")}): ` +
          `nuovo tentativo fra ${PAUSA_PRIMA_DELLA_RIPRESA / 1000}s.`
      );
    if (onPorzione) onPorzione(fatte, tot, { attesaRipresa: true, mancanti: falliti.length });
    await attesa(PAUSA_PRIMA_DELLA_RIPRESA);
    const residui = [];
    for (const f of falliti) {
      const esito = await leggiPorzione(f.chunk, f.indice, true);
      if (esito) residui.push(esito);
    }
    falliti = residui;
  }

  falliti.forEach((f) => {
    if (onAvviso) onAvviso(`Pagine ${f.intervallo} non analizzate: ${f.errore.slice(0, 160)}`);
  });

  if (!risultati.length) {
    const dettaglio = falliti.length
      ? ` Errori riscontrati: ${[...new Set(falliti.map((f) => f.errore.slice(0, 120)))].join(" · ")}`
      : "";
    throw new Error(
      `Nessuna delle ${tot} porzioni del documento è stata analizzata.${dettaglio} ` +
        "Verifica la chiave API e che il file non sia protetto o danneggiato."
    );
  }
  if (onPorzione) onPorzione(tot, tot);
  /* Il chunk viaggia insieme all'errore solo per consentire la ripresa: non
     deve sopravvivere al ritorno, o l'intero base64 del documento resterebbe
     agganciato al risultato per tutta la sessione. */
  risultati.__falliti = falliti.map((f) => ({ intervallo: f.intervallo, errore: f.errore }));
  risultati.__totPorzioni = tot;
  return risultati;
}

/* ---- Fusione dei risultati delle singole porzioni ---- */
function leggiPercorso(obj, percorso) {
  return String(percorso)
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* Primo valore utile per un campo scalare o oggetto. */
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
   suddivisi molte porzioni riportano 0 perché il prospetto non ricade lì. */
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

/* Concatena il campo-array indicato di tutte le porzioni, riportando i numeri
   di pagina alla numerazione del documento completo. */
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

/* Il blocco di un campo dalla porzione più affidabile: confidenza alta, poi
   media, poi bassa; a parità, il primo valore non nullo. Valore, pagina e
   citazione restano quelli della STESSA porzione (prima si prendevano da porzioni
   diverse, e il primo valore trovato vinceva anche se un'altra porzione ne aveva
   uno più solido: le azioni in circolazione a luglio sulla media del semestre). */
const PESO_CONFIDENZA = { alta: 3, media: 2, bassa: 1 };
function bloccoMigliore(risultati, percorso, utile) {
  let migliore = null;
  let punti = -1;
  for (const r of risultati) {
    const o = leggiPercorso(r, percorso);
    if (!o || typeof o !== "object" || Array.isArray(o) || !utile(o)) continue;
    const pt = (PESO_CONFIDENZA[String(o.confidenza || "").toLowerCase()] || 0) * 2 + (Number(o.valore) !== 0 ? 1 : 0);
    if (pt > punti) {
      migliore = o;
      punti = pt;
    }
  }
  return migliore;
}

/* True se almeno una porzione è stata riparata da troncamento. */
function qualcheTroncamento(risultati) {
  return risultati.some((r) => r?.__troncato);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3-ter. PROMPT DI INTEGRAZIONE DOCUMENTALE
   ═══════════════════════════════════════════════════════════════════════════
   Nel modulo di riferimento l'IA cercava rettifiche ai flussi di cassa. Qui lo
   scopo è diverso: raccogliere in un solo passaggio TUTTE le grandezze che le
   riclassificazioni SP/CE/RF non espongono, e che restano il collo di bottiglia
   delle Fasi 2, 2.1, 3.1, 3.2, 3.3 e 4, per iniettarle in par.perAnno.

   Il bersaglio non è un estratto di poche pagine ma il bilancio INTEGRALE
   dell'impresa — un Form 20-F o 10-K, un Annual Report, un fascicolo di
   bilancio — dal quale si attingono i parametri elencati in
   CAMPI_INTEGRAZIONE, sparsi fra stato patrimoniale, conto economico,
   rendiconto finanziario, note e MD&A.

   UNA SOLA LETTURA, TUTTI GLI ESERCIZI. Un 20-F espone il conto economico su
   tre annualità e lo stato patrimoniale su due: le colonne comparative sono
   già affiancate nello stesso prospetto. Chiedere un anno per volta
   significherebbe rileggere duecento pagine tre volte per estrarre dati che
   il modello ha avuto sotto gli occhi tutti insieme fin dalla prima. Il prompt
   chiede quindi la matrice completa esercizio × parametro, e il vincolo si
   sposta di conseguenza: non «leggi la colonna giusta» ma «assegna ogni valore
   alla colonna a cui appartiene».

   TRE VINCOLI GOVERNANO QUESTA SEZIONE, e ignorarne uno produce numeri
   plausibili e sbagliati, che è il modo peggiore di fallire:

   1) IL SEGNO. L'applicazione non normalizza tutto. Su alcuni parametri
      applica Math.abs() e il segno è quindi indifferente; su altri usa il
      valore così com'è, e un negativo preso da un rendiconto finanziario
      («Cash dividends paid (1.234)») entrerebbe nei calcoli col segno
      rovesciato. La proprietà `segno` di ciascun campo dichiara il regime e
      alimenta le istruzioni del prompt.

   2) LA SCALA. Gli importi vanno lasciati nell'unità del documento (migliaia,
      milioni) perché l'app li confronta con le riclassificazioni e segnala la
      scala all'analista. I CONTEGGI però — addetti, numero di azioni — non
      sono importi: non vanno mai riscalati, anche quando il prospetto che li
      ospita è espresso in migliaia. La proprietà `natura` distingue i due casi.

   3) LA COERENZA VALORE-CITAZIONE. Il documento arriva al modello in porzioni,
      e la fusione a valle sceglie il primo valore utile campo per campo. Se una
      porzione restituisce una citazione senza il valore, citazione e valore
      finiscono per provenire da porzioni diverse e il riferimento non verifica
      più nulla. Il prompt impone perciò di OMETTERE l'intera chiave quando il
      valore non c'è — che risolve anche un secondo problema: su un documento
      lungo la risposta più corta è quella che non si tronca, e un troncamento
      fa perdere dati che erano già stati trovati.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Grandezze cercate: chiave del prompt → chiave di par.perAnno.
 *
 * `jsonKey` e `parKey` sono contrattuali: la prima è la chiave attesa nel JSON
 * di risposta, la seconda DEVE coincidere con una `k` di COLONNE_PARAMETRI,
 * altrimenti il valore viene scritto in una casella che nessun indice legge e
 * l'estrazione fallisce in silenzio. La corrispondenza è verificata dai test.
 *
 * `segno` — regime applicato dall'applicazione al valore manuale:
 *   "positivo"    grandezza da riportare sempre positiva; l'app NON normalizza
 *                 e un segno sbagliato si propaga ai calcoli;
 *   "assoluto"    l'app applica Math.abs(): il segno è indifferente, ma si
 *                 chiede comunque il positivo per leggibilità della tabella;
 *   "firmato"     il segno è informazione: va riportato come sta nel bilancio.
 *
 * `natura` — "importo" (soggetto alla scala del documento) oppure "conteggio"
 *   (numero puro, mai riscalato).
 */
const CAMPI_INTEGRAZIONE = [
  { jsonKey: "quotaCostiVariabili", parKey: "quotaVariabile", label: "Quota di costi variabili sui ricavi (%)", dove: "Percentuale dei costi operativi che varia con i volumi. Quasi nessun bilancio la espone come tale: cercala in questo ordine — (1) nota «costs by nature» / «costi per natura» che separa materie prime e consumi dai costi di struttura; (2) MD&A o Operating review dove il management commenta la componente fissa e variabile della struttura di costo; (3) informativa di settore o commento sull'incidenza dei costi industriali. Se il documento consente solo di sommare le voci per natura, calcola (materie prime + consumi + lavorazioni esterne + provvigioni + royalty sui volumi) ÷ ricavi × 100 e dichiara confidenza «media». Se nessuna di queste strade è percorribile OMETTI la chiave: l'applicazione stima da sé la quota per regressione sulla serie storica, e un numero inventato qui produrrebbe un punto di pareggio falso.", segno: "positivo", natura: "percentuale" },
  { jsonKey: "costoLavoro", parKey: "costoLavoro", label: "Costo del Lavoro", dove: "Costi per il personale, oneri sociali. Cerca nel conto economico o Note al bilancio (Employee benefits expense).", segno: "positivo", natura: "importo" },
  { jsonKey: "costoVenduto", parKey: "costoVenduto", label: "Costo del Venduto", dove: "Costo industriale del venduto (Cost of sales / Cost of revenues). Cerca nel Conto Economico. Non confonderlo con i costi operativi totali: escludi spese commerciali, generali e amministrative e R&S esposte su righe distinte.", segno: "positivo", natura: "importo" },
  { jsonKey: "fondoAmmortamentoCumulato", parKey: "fondoAmm", label: "Fondo Ammortamento Cumulato", dove: "Totale dei fondi ammortamento a fine esercizio. Cerca nel prospetto PP&E nelle Note.", segno: "positivo", natura: "importo" },
  { jsonKey: "saldoGestioneNonCorrente", parKey: "gestNonCorrente", label: "Saldo Gestione Non Corrente", dove: "Saldo netto di componenti straordinarie o non ricorrenti. Cerca nel Conto Economico o Note.", segno: "firmato", natura: "importo" },
  { jsonKey: "creditiCommerciali", parKey: "creditiComm", label: "Crediti Commerciali", dove: "Crediti verso clienti a fine anno (Trade Receivables). Cerca nello Stato Patrimoniale o Note (escludi crediti non commerciali).", segno: "positivo", natura: "importo" },
  { jsonKey: "debitiCommerciali", parKey: "debitiComm", label: "Debiti Commerciali", dove: "Debiti verso fornitori a fine anno (Trade Payables). Cerca nello Stato Patrimoniale o Note.", segno: "positivo", natura: "importo" },
  { jsonKey: "addetti", parKey: "addetti", label: "Numero Addetti", dove: "Numero di dipendenti (Employees). Cerca nella Relazione sulla Gestione o Form 20-F (Item 6.D).", segno: "positivo", natura: "conteggio" },
  { jsonKey: "immateriali", parKey: "immateriali", label: "Attività Immateriali", dove: "Valore netto di asset intangibili inclusi avviamento e marchi (Intangible Assets). Cerca nello Stato Patrimoniale.", segno: "positivo", natura: "importo" },
  { jsonKey: "ppe", parKey: "ppe", label: "Immobilizzazioni Tecniche", dove: "Valore netto di impianti e macchinari (Property, Plant & Equipment). Cerca nello Stato Patrimoniale.", segno: "positivo", natura: "importo" },
  { jsonKey: "partecipazioni", parKey: "partecipazioni", label: "Partecipazioni non liquide", dove: "Investimenti in società collegate o joint venture (Equity method investments). Cerca nello Stato Patrimoniale.", segno: "positivo", natura: "importo" },
  { jsonKey: "azioniProprie", parKey: "azioniProprie", label: "Azioni Proprie", dove: "Valore delle azioni proprie in portafoglio (Treasury Shares). Cerca nel prospetto variazioni Patrimonio Netto.", segno: "assoluto", natura: "importo" },
  { jsonKey: "passivitaPotenziali", parKey: "passivitaPotenziali", label: "Passività Potenziali", dove: "Fondi per rischi legali, impegni o contenziosi non a bilancio (Contingencies). Cerca nelle Note.", segno: "assoluto", natura: "importo" },
  { jsonKey: "quoteCapitale", parKey: "quoteCapitale", label: "Quote Capitale Rimborsate", dove: "Rimborsi della quota capitale dei debiti finanziari nell'anno (Principal debt repayments). Cerca nel Rendiconto Finanziario.", segno: "assoluto", natura: "importo" },
  { jsonKey: "capexMantenimento", parKey: "capexMantenimento", label: "Capex di Mantenimento", dove: "Spese per mantenere in efficienza la struttura (Maintenance Capex), se specificato distinto dallo sviluppo. Cerca in MD&A.", segno: "assoluto", natura: "importo" },
  { jsonKey: "dividendiDistribuiti", parKey: "dividendiDistribuiti", label: "Dividendi Distribuiti", dove: "Dividendi pagati cash nell'anno (Cash dividends paid). Cerca nel Rendiconto Finanziario.", segno: "positivo", natura: "importo" },
  { jsonKey: "numeroAzioni", parKey: "numeroAzioni", label: "Numero Azioni in Circolazione (milioni)", dove: "Numero medio ponderato di azioni ordinarie in circolazione nel periodo, IN MILIONI DI AZIONI. Dove cercarlo, in quest'ordine: (1) nota sull'utile per azione (Earnings per share / Net income per share) — riga «Weighted-average shares outstanding — basic», «Shares used to compute basic net income per share», «Number of shares used in basic computation» o «Number of shares used in per share computation» (base, non diluita); (2) in calce al conto economico; (3) se manca il medio ponderato, le azioni in circolazione alla data di chiusura: frontespizio del 10-K / 10-Q / 20-F («there were N shares of … outstanding» alla data più recente) oppure stato patrimoniale («N shares issued and outstanding»), con confidenza «media». ⚠ Se l'utile per azione è esposto PER CLASSE di azioni (Class A, Class B, Class C…) prendi la colonna «Consolidated»/«Total» se c'è, altrimenti SOMMA le classi: è la stessa società. Escludi le azioni privilegiate e quelle proprie. Nei 10-Q usa il progressivo (Six/Nine Months Ended), non il solo trimestre.", segno: "positivo", natura: "milioniAzioni" },
  { jsonKey: "scopertiCc", parKey: "scopertiCc", label: "Scoperti di conto corrente", dove: "Banche c/c passivi a revoca (Bank overdrafts). Cerca nelle Note sui debiti a breve.", segno: "positivo", natura: "importo" },
  { jsonKey: "passBreveStretto", parKey: "passBreveStretto", label: "Passività a breve in senso stretto", dove: "Passività correnti escludendo fornitori e scoperti. Calcolato o cercato in MD&A.", segno: "positivo", natura: "importo" },
  { jsonKey: "disinvestimenti", parKey: "disinvestimenti", label: "Disinvestimenti di struttura", dove: "Cassa incassata dalla vendita di asset fissi (Proceeds from sale of PP&E). Cerca nel Rendiconto Finanziario.", segno: "assoluto", natura: "importo" },
  { jsonKey: "utiliNonDistribuiti", parKey: "utiliNonDistribuiti", label: "Utili non distribuiti", dove: "Riserve di utili accumulati (Retained Earnings). Cerca nello Stato Patrimoniale, sezione Equity.", segno: "firmato", natura: "importo" },
  { jsonKey: "liquiditaImmediate", parKey: "liquiditaImmediate", label: "Liquidità immediate", dove: "Cassa e mezzi equivalenti disponibili senza vincolo (Cash and cash equivalents). Cerca nello Stato Patrimoniale. ESCLUDI la cassa vincolata (restricted cash) e i titoli non prontamente liquidabili, che le Note segnalano a parte.", segno: "positivo", natura: "importo" },
  { jsonKey: "dividendiPrivilegiati", parKey: "dividendiPrivilegiati", label: "Dividendi vincolati", dove: "Dividendi su azioni privilegiate, di risparmio o su interessenze di terzi (Preferred dividends, Dividends to non-controlling interests). Cerca nel prospetto variazioni del Patrimonio Netto o nel Rendiconto Finanziario. Se la società non ha capitale privilegiato ometti la chiave.", segno: "positivo", natura: "importo" },
  { jsonKey: "capitalePrivilegiato", parKey: "capitalePrivilegiato", label: "Capitale privilegiato", dove: "Valore del capitale con diritti di priorità: azioni privilegiate o di risparmio, interessenze di terzi (Preferred stock, Non-controlling interests). Cerca nello Stato Patrimoniale, sezione Equity. Se assente ometti la chiave.", segno: "positivo", natura: "importo" },
  { jsonKey: "creditiSoci", parKey: "creditiSoci", label: "Crediti verso soci", dove: "Crediti per versamenti ancora dovuti dai soci (Receivables from shareholders, Subscriptions receivable). Cerca nello Stato Patrimoniale o nelle Note sull'Equity. Nei bilanci quotati è di norma assente: in quel caso ometti la chiave.", segno: "positivo", natura: "importo" },
  { jsonKey: "durationDebito", parKey: "durationDebito", label: "Duration del debito (anni)", dove: "Scadenza media ponderata dei debiti finanziari. Cerca la tabella delle scadenze nelle Note sul debito (Maturity analysis / Contractual maturities of debt), che espone gli importi in scadenza per anno. Calcola la media ponderata: Σ(importo × anni alla scadenza) ÷ debito totale. Se il documento dichiara direttamente una «weighted average maturity» usa quella.", segno: "positivo", natura: "anni" },
  { jsonKey: "debitoMercato", parKey: "debitoMercato", label: "Valore di mercato del debito", dove: "Fair value dei debiti finanziari. Cerca nelle Note sugli strumenti finanziari il confronto fra valore contabile e fair value (Fair value of debt / Carrying amount vs fair value), che gli IFRS 7 e l'ASC 825 impongono di esporre. Somma il fair value delle obbligazioni e dei finanziamenti a medio-lungo termine.", segno: "positivo", natura: "importo" },
  { jsonKey: "equityMercato", parKey: "equityMercato", label: "Valore di mercato dell'equity", dove: "Capitalizzazione di borsa a fine esercizio. Nel 20-F la copertina dichiara l'«aggregate market value of shares held by non-affiliates»; in alternativa moltiplica il numero di azioni in circolazione per la quotazione di chiusura dell'esercizio riportata nell'Item 9 (Markets / Share price history). Riporta il risultato nella STESSA scala del resto del documento.", segno: "positivo", natura: "importo" },
  { jsonKey: "rodStandardMercato", parKey: "rodStandard", label: "ROD standard di mercato (%)", dove: "Tasso di mercato al quale l'impresa si finanzierebbe oggi, cioè il costo MARGINALE del debito, non quello medio storico. Cerca il tasso cedolare delle emissioni obbligazionarie o dei finanziamenti accesi NELL'ESERCIZIO, nelle Note sul debito o nella sezione Liquidity and Capital Resources del MD&A. Se il documento espone soltanto il tasso medio ponderato del debito in essere (weighted average interest rate) riportalo dichiarando confidenza «bassa», perché è il ROD effettivo e non quello standard. Se non trovi nessuna delle due grandezze ometti la chiave: è un parametro di mercato che l'analista reperisce dai bollettini delle banche centrali.", segno: "positivo", natura: "percentuale" },
];

/* Grandezze di FLUSSO: per il periodo TTM servono sui dodici mesi. Se la
   relazione infrannuale non le espone già così, il modello riporta il
   progressivo dell'esercizio (ytd) e quello dell'anno prima (ytdPrecedente) e
   il TTM si calcola qui: esercizio base + ytd − ytdPrecedente. */
const FLUSSI_INTEGRAZIONE = new Set([
  "costoLavoro", "costoVenduto", "saldoGestioneNonCorrente", "quoteCapitale",
  "capexMantenimento", "dividendiDistribuiti", "disinvestimenti", "dividendiPrivilegiati",
]);

/* Il campo che richiede la scomposizione in addendi: è l'unico costruito per
   somma algebrica di voci sparse, e senza l'elenco degli addendi l'analista non
   può rifare il conto. */
const CAMPO_CON_COMPONENTI = "saldoGestioneNonCorrente";

/** Istruzione di segno resa esplicita, campo per campo. */
const REGOLA_SEGNO = {
  positivo:
    "riporta SEMPRE un numero POSITIVO, anche quando il prospetto lo espone fra parentesi o preceduto dal meno (è un'uscita di cassa o una posta in detrazione): l'applicazione usa questo valore così com'è e un segno negativo ne rovescerebbe l'effetto sugli indici",
  assoluto:
    "riporta un numero POSITIVO (l'applicazione ne prende comunque il valore assoluto)",
  firmato:
    "riporta il valore CON IL SUO SEGNO: negativo se è un onere netto o un saldo in perdita, positivo se è un provento netto o un saldo attivo",
};

/** Avvertenze di scala per le grandezze che NON sono importi monetari: sono i
 *  campi su cui la scala del documento non va applicata, ed è l'errore che
 *  altrimenti si ripete a ogni lettura. */
const NOTA_NATURA = {
  conteggio:
    "⚠ È un CONTEGGIO, non un importo: riportalo in unità assolute e NON applicargli mai la scala del documento (se il prospetto dichiara «in thousands» e le azioni sono espresse in migliaia, moltiplica per mille e riporta il numero pieno).",
  percentuale:
    "⚠ È una PERCENTUALE: riportala in punti percentuali (52.9 significa 52,9%), mai in forma decimale (0.529) e mai riscalata dall'unità del documento. Se la ricavi da un rapporto fra due importi, moltiplica per cento prima di trascriverla.",
  milioniAzioni:
    "⚠ È un NUMERO DI AZIONI espresso in MILIONI di azioni (12125 significa 12 miliardi e 125 milioni di azioni): non è un importo in valuta. Se il documento le dà in milioni («in millions, except per share amounts») riportale così; in migliaia dividi per mille; in unità dividi per un milione. Usa il punto come decimale (es. 836.5).",
  anni:
    "⚠ È una DURATA IN ANNI: riportala come numero puro con al più due decimali (es. 4.35), mai riscalata dall'unità del documento.",
};

/** Riga descrittiva di un campo dentro l'elenco del prompt. */
const rigaCampo = (c, i) =>
  `${i + 1}. ${c.label} → chiave JSON "${c.jsonKey}"\n` +
  `   Dove: ${c.dove}\n` +
  `   Segno: ${REGOLA_SEGNO[c.segno] || REGOLA_SEGNO.positivo}.` +
  (NOTA_NATURA[c.natura] ? `\n   ${NOTA_NATURA[c.natura]}` : "");

/** Schema JSON di un campo, generato dall'array per non doverlo mantenere due volte. */
const rigaSchema = (c) =>
  `  // Se il dato è assente, OMETTI l'intero blocco "${c.jsonKey}". Se presente:\n` +
  `  "${c.jsonKey}": { "valore": numero, "pagina": numero, "citazione": "…", "confidenza": "alta|media|bassa"` +
  (c.jsonKey === CAMPO_CON_COMPONENTI ? `, "componenti": [{ "voce": "…", "importo": numero }]` : "") +
  " },";

/**
 * Prompt per l'estrazione dei parametri mancanti da un bilancio completo.
 *
 * Il documento è UNO — il fascicolo integrale dell'impresa — e gli esercizi
 * sono TUTTI quelli in memoria: un 20-F espone il conto economico su tre
 * annualità e lo stato patrimoniale su due, quindi una sola lettura può
 * riempire l'intera tabella dei parametri. Chiedere un anno per volta
 * significherebbe rileggere duecento pagine tre volte per estrarne colonne
 * che stavano già affiancate nello stesso prospetto.
 *
 * @param {Array<number|string>} anni  esercizi in memoria, dal più recente
 * @param {object} contesto            { azienda, valuta, unita, gia } per disambiguare
 */
function buildIntegrazionePrompt(anni, contesto = {}) {
  const elencoAnni = anni.map(String);
  const { azienda, valuta, unita, gia, ttm } = contesto;
  const elenco = CAMPI_INTEGRAZIONE.map(rigaCampo).join("\n\n");
  /* La virgola di coda va tolta: lo schema viene ora annidato dentro un
     oggetto per esercizio, e un esempio malformato è il primo posto da cui il
     modello copia l'errore. */
  const schema = CAMPI_INTEGRAZIONE.map(rigaSchema).join("\n").replace(/,\s*$/, "");
  const blocchiAnno = elencoAnni
    .map((a) => `  "${a}": {\n${schema}\n  }`)
    .join(",\n");
  const giaNoti =
    gia && Object.keys(gia).length
      ? `\n\nVALORI GIÀ PRESENTI IN APPLICAZIONE (servono solo come ordine di grandezza per accorgerti di eventuali incoerenze; NON copiarli, estrai dal documento):\n${Object.entries(gia)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}`
      : "";

  /* Periodo TTM in memoria: blocco «infrannuale», da compilare solo con una
     relazione trimestrale o semestrale alla sua data. */
  const base = ttm ? String(annoDa(ttm.esercizioBase) || Math.floor(ttm.chiave)) : "";
  const dataTtm = ttm?.dataRiferimento ? String(ttm.dataRiferimento) : "";
  const sezioneTtm = ttm
    ? `

PERIODO INFRANNUALE (TTM) — ${ttm.etichetta || "TTM"}${dataTtm ? `, data di riferimento ${dataTtm}` : ""}${ttm.mesiCoperti ? `, ${ttm.mesiCoperti} mesi dopo la chiusura dell'esercizio ${base}` : ""}
Oltre agli esercizi, in applicazione c'è un periodo degli ultimi dodici mesi chiuso a una data infrannuale. Compila il blocco "infrannuale" SOLO se il documento è (o contiene) una relazione infrannuale — trimestrale, semestrale, Form 10-Q, 6-K, half-year o interim report — con i prospetti alla data${dataTtm ? ` ${dataTtm} (o al trimestre/semestre che chiude in quel mese; se il documento chiude nello stesso mese ma con l'anno successivo o precedente, compilalo comunque e segnalalo in "note")` : " infrannuale"}. Se il documento è soltanto un bilancio annuale, OMETTI del tutto la chiave "infrannuale": un saldo di fine esercizio scritto lì al posto di quello infrannuale falserebbe ogni indice del periodo.
- "dataRiferimento": la data di chiusura del periodo infrannuale come la leggi nel documento (AAAA-MM-GG). È obbligatoria: senza, il blocco viene scartato.
- grandezze di STOCK: saldo alla data INFRANNUALE (la colonna del periodo, non quella di fine esercizio che la relazione affianca per confronto). Quel saldo di fine esercizio, se ti serve, appartiene all'esercizio ${base || "precedente"}, non al blocco infrannuale.
- grandezze di FLUSSO (costo del lavoro, costo del venduto, saldo gestione non corrente, dividendi ordinari e vincolati, quote capitale, disinvestimenti, capex di mantenimento): servono sui DODICI MESI che terminano alla data infrannuale. Se il documento li espone già così («trailing twelve months», «ultimi dodici mesi», «LTM») riportali in "valore". Altrimenti NON scrivere "valore" e riporta "ytd" = progressivo dall'inizio dell'esercizio alla data infrannuale («Six months ended…», «Nine months ended…», «primo semestre») e "ytdPrecedente" = lo stesso progressivo dell'esercizio precedente (la colonna comparativa): i dodici mesi li calcola l'applicazione come esercizio ${base || "base"} + ytd − ytdPrecedente. Usa le colonne PROGRESSIVE, non quelle del solo trimestre («Three months ended»), salvo che il trimestre coincida col progressivo.
- grandezze di STRUTTURA, numero di addetti e numero di azioni: alla data (o sul periodo) infrannuale; per le azioni il medio ponderato del progressivo (es. «Six Months Ended», colonna «Consolidated» o somma delle classi), altrimenti quelle in circolazione indicate nel frontespizio.
- COME È FATTO UN 10-Q: stato patrimoniale su due colonne («As of December 31, 2025 | As of June 30, 2026»): la colonna infrannuale va nel blocco "infrannuale", quella di fine esercizio nell'esercizio ${base || "precedente"}. Conto economico su «Three Months Ended» e «Six/Nine Months Ended», ciascuno con l'anno precedente e quello corrente: per "ytd" e "ytdPrecedente" usa i «Six/Nine Months Ended». Rendiconto finanziario solo progressivo. Molte voci (dividendi pagati, rimborsi del debito, acquisti di azioni) stanno nel rendiconto o nella nota sul patrimonio netto.
- scala, separatori, parentesi, segni, citazioni e confidenza: le stesse regole degli esercizi.
- VICEVERSA: le colonne progressive di una relazione infrannuale non vanno MAI scritte negli esercizi interi, che vogliono il totale dei dodici mesi dell'esercizio.`
    : "";
  const schemaTtm = ttm
    ? `,
  // Solo con una relazione infrannuale alla data del periodo TTM, altrimenti OMETTI la chiave:
  "infrannuale": {
    "dataRiferimento": "AAAA-MM-GG",
    // stessi campi degli esercizi; per le grandezze di FLUSSO, se mancano i dodici mesi, al posto di "valore":
    // "ytd": numero, "ytdPrecedente": numero (più "pagina", "citazione", "confidenza")
${schema}
  }`
    : "";

  return `Sei un analista di bilancio esperto. Ricevi il BILANCIO INTEGRALE${azienda ? ` di ${azienda}` : ""} e devi estrarre i ${CAMPI_INTEGRAZIONE.length} valori elencati sotto per CIASCUNO di questi esercizi: ${elencoAnni.join(", ")}${ttm ? `, e — solo se il documento è una relazione infrannuale — per il periodo TTM ${ttm.etichetta || ""}` : ""}.

NATURA DEL DOCUMENTO
Può essere un Form 20-F o 10-K depositato presso la SEC, un Annual Report, un bilancio consolidato IFRS o un fascicolo di bilancio ex art. 2427 c.c., in italiano o in inglese: NON dare per scontato lo schema italiano. Adatta la ricerca a ciò che hai davanti e non pretendere le etichette dello schema sbagliato. Se il documento è un consolidato usa i valori CONSOLIDATI di gruppo, non quelli della capogruppo separata quando compaiono entrambi. Dichiara nel campo "schema" quale hai riconosciuto.

I valori sono sparsi per tutto il fascicolo: stato patrimoniale, conto economico, rendiconto finanziario, note esplicative, MD&A e — nel 20-F — gli Item numerati. Percorri tutto ciò che ti viene mostrato prima di dichiarare che un valore non c'è.

Il documento può esserti sottoposto anche solo come PORZIONE di un fascicolo molto lungo: in quel caso limitati a ciò che vedi, ometti tutto il resto e NON lamentare l'assenza delle parti che non ti sono state mostrate. Le porzioni vengono ricomposte a valle.

⚠ VINCOLO TASSATIVO SULLE COLONNE — LEGGI PRIMA DI TUTTO IL RESTO
Questi documenti espongono ogni prospetto su due o tre colonne, una per esercizio. Il tuo compito NON è scegliere una colonna: è assegnare OGNI valore all'esercizio a cui appartiene. Leggi l'intestazione della colonna prima di trascrivere il numero — «For the years ended December 31, 2024 / 2023 / 2022», «At December 31, 2024 / 2023», «Esercizio 2024 / 2023» — e attenzione agli esercizi non solari («fiscal year ended June 30, 2024»: è l'esercizio 2024). L'ordine delle colonne NON è fisso: i 10-K mettono di solito l'anno più recente a sinistra, molti 10-Q e relazioni infrannuali USA l'anno PRECEDENTE a sinistra («2025 | 2026», «As of December 31, 2025 | As of June 30, 2026»). Decide sempre l'intestazione, mai la posizione. Un valore attribuito alla colonna sbagliata è l'errore più grave possibile qui, perché produce un delta storico inventato di sana pianta.
- grandezze di STOCK (stato patrimoniale: crediti, debiti commerciali, PP&E, immateriali, partecipazioni, azioni proprie, utili non distribuiti, fondo ammortamento, passività potenziali, scoperti, liquidità immediate, capitale privilegiato, crediti verso soci, valore di mercato del debito e dell'equity): saldo di CHIUSURA dell'esercizio;
- grandezze di FLUSSO (conto economico e rendiconto: costo del lavoro, costo del venduto, dividendi ordinari e vincolati, quote capitale, disinvestimenti, capex, saldo gestione non corrente): totale dell'esercizio;
- grandezze di STRUTTURA (quota di costi variabili, duration del debito, ROD standard): riferite alla configurazione in essere alla chiusura dell'esercizio.
Se un esercizio richiesto non compare nel documento, restituisci per quell'anno un oggetto vuoto {} e spiegalo in "note". Non interpolare, non riportare l'anno sbagliato «perché è l'unico disponibile», non riusare il valore di un anno per un altro.${sezioneTtm}

VALORI DA TROVARE (per ciascun esercizio)
${elenco}

REGOLE DI ESTRAZIONE
- SCALA E CONVERSIONE: L'applicazione lavora ESCLUSIVAMENTE in ${unita || "milioni"}. Leggi la scala del documento nelle intestazioni dei prospetti o delle note («in migliaia di euro», «€/000», «in thousands», «in millions»; se non è indicata, gli importi sono in unità di valuta) e converti OBBLIGATORIAMENTE ogni importo in ${unita || "milioni"} prima di scriverlo nel JSON. Esempi verso i milioni: documento in migliaia che riporta "15.000" → scrivi 15; documento in unità che riporta "2.500.000" → scrivi 2.5; documento in milioni → nessuna conversione. I campi marcati come CONTEGGIO o PERCENTUALE non vanno mai riscalati; il numero di azioni va sempre in MILIONI di azioni. Nel campo "unita" della risposta riporta invece la scala DEL DOCUMENTO letto.
- SEPARATORI: usa il punto come separatore decimale e nessun separatore delle migliaia (es. 1234567.89). Nei documenti anglosassoni la virgola separa le migliaia e il punto è decimale: «1,234,567.89» → 1234567.89. Nei documenti italiani è l'inverso: «1.234.567,89» → 1234567.89.
- PARENTESI: negli schemi anglosassoni gli importi fra parentesi tonde sono NEGATIVI: «(1,234)» vale -1234. Applica poi la regola di segno del campo, che può richiederti comunque il positivo.
- OMISSIONE: se un valore NON è presente, o non è ricavabile con certezza, OMETTI del tutto la sua chiave invece di scrivere null. Non stimare, non dedurre da altri anni, non ricavarlo per differenza da grandezze che non hai verificato, non inventare: quel numero finisce direttamente negli indici di bilancio senza ulteriori filtri. Omettere accorcia la risposta e la mette al riparo dal troncamento, che su un documento lungo è il modo più comune di perdere dati già trovati.
- CITAZIONI: per ogni valore riportato indica la pagina e una citazione letterale BREVE (massimo 90 caratteri) della riga da cui l'hai preso, comprensiva dell'intestazione di colonna quando serve a dimostrare l'anno.
- CONFIDENZA: "alta" se il valore è esposto esplicitamente come tale, "media" se l'hai composto sommando voci dichiarate, "bassa" se l'attribuzione è dubbia.
- COMPONENTI: se hai composto il Saldo Gestione Non Corrente sommando più voci, elenca gli addendi (nome e importo firmato) in "componenti". Negli IFRS la categoria «extraordinary items» è vietata: la fonte più affidabile è la riconciliazione fra risultato IFRS e le misure non-GAAP (Adjusted EBIT / Adjusted EBITDA), dove l'elenco degli adjustments è esplicito.
- QUOTA DI COSTI VARIABILI: è il parametro che sblocca leva operativa, punto di pareggio e margine di sicurezza, ed è anche quello che più facilmente si inventa. Riportalo SOLO se il documento separa davvero i costi per natura o commenta esplicitamente la struttura fissa/variabile. NON dedurlo dal rapporto «costo del venduto ÷ ricavi»: il costo del venduto contiene ammortamenti industriali e manodopera indiretta, che sono costi fissi, e usarlo come proxy gonfia la quota variabile e appiattisce la leva operativa. In assenza di informativa, omettere è la risposta corretta: l'applicazione ricava la quota per regressione sulla serie storica degli esercizi in memoria.
- BREVITÀ: non aggiungere campi non richiesti e non allungare le citazioni oltre il limite: la risposta deve restare compatta per non troncarsi.${giaNoti}

RESTITUISCI ESCLUSIVAMENTE QUESTO JSON (le chiavi dei valori non trovati vanno OMESSE):
{
  "schema": "codice civile | IFRS | US-GAAP | altro | null",
  "valuta": "EUR | USD | … oppure null",
  "unita": "unità | migliaia | milioni oppure null",
  "eserciziPresenti": ["gli esercizi effettivamente esposti in questo documento o porzione"],
  "esercizi": {
${blocchiAnno}
  }${schemaTtm},
  "note": ["osservazioni sull'affidabilità dell'estrazione, incoerenze, esercizi richiesti ma assenti"]
}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. DATASET DIMOSTRATIVO
   ═══════════════════════════════════════════════════════════════════════════
   Non contiene alcun anno cablato: la serie viene ancorata all'ultimo
   esercizio presumibilmente chiuso alla data di sistema, così l'esempio resta
   valido negli anni a venire senza toccare il codice.
   ─────────────────────────────────────────────────────────────────────────── */

/** Profilo di un'azienda in progressivo miglioramento, dal più recente.
 *  Gli aggregati sono internamente coerenti — MON + proventi finanziari =
 *  EBIT, RAOF = risultato ante imposte + oneri finanziari, COIN = attività
 *  operative − passività operative, CIN totale = COIN + investimenti
 *  finanziari — perché la serie dimostrativa deve alimentare anche le Fasi 2
 *  e 2.1, non solo gli indici di solvibilità e redditività netta.
 *  Il capitale netto è fissato a CIN − PFN, come impone lo schema a posizione
 *  finanziaria netta: senza questa quadratura l'identità additivo-moltiplicativa
 *  della Fase 4 non chiuderebbe sul ROE contabile, e l'esempio insegnerebbe a
 *  convivere con uno scarto che nei dati reali va invece indagato. */
const PROFILO_ESEMPIO = [
  {
    ce: {
      ricavi: 11200000, ebitda: 1792000, ebit: 1232000, mon: 1198000,
      proventiFinanziari: 34000, oneriFinanziari: 156000, gestioneFinanziaria: -122000,
      risultatoAnteImposte: 1076000, raof: 1232000, imposte: 334000, utileNetto: 742000,
      ammortamenti: 500000, accantonamenti: 60000, valoreAggiunto: 4032000,
      costoLavoro: 2240000, costoVenduto: 4760000, costiServizi: 1690000,
      gestioneNonCorrente: -42000,
    },
    sp: {
      capitaleInvestitoNetto: 6150000, coin: 5540000, patrimonioNetto: 3840000,
      immobilizzazioniOperative: 3360000, attivitaOperativeCorrenti: 2520000, rimanenze: 1150000,
      passivitaOperativeCorrenti: 1330000, passivitaOperativeNonCorrenti: 160000,
      attivitaOperative: 7030000, passivitaOperative: 1490000, ccno: 2340000,
      investimentiFinanziari: 610000, attivoCircolante: 4280000, passivoCorrente: 2960000,
      debitiFinanziariBreve: 1630000, debitiFinanziariLungo: 1290000,
      pfn: 2310000, liquidita: 610000,
    },
    rf: {
      liquidita: 610000, liquiditaIniziale: 425000, flussoOperativo: 1280000, capex: -580000,
      fcfo: 700000, servizioDelDebito: -430000, fcfe: 270000, dividendi: -150000, raccolta: 65000,
    },
  },
  {
    ce: {
      ricavi: 9750000, ebitda: 1365000, ebit: 897000, mon: 869000,
      proventiFinanziari: 28000, oneriFinanziari: 148000, gestioneFinanziaria: -120000,
      risultatoAnteImposte: 749000, raof: 897000, imposte: 237000, utileNetto: 512000,
      ammortamenti: 420000, accantonamenti: 48000, valoreAggiunto: 3375000,
      costoLavoro: 2010000, costoVenduto: 4290000, costiServizi: 1520000,
      gestioneNonCorrente: -66000,
    },
    sp: {
      capitaleInvestitoNetto: 5680000, coin: 5255000, patrimonioNetto: 3200000,
      immobilizzazioniOperative: 3180000, attivitaOperativeCorrenti: 2195000, rimanenze: 1020000,
      passivitaOperativeCorrenti: 1010000, passivitaOperativeNonCorrenti: 130000,
      attivitaOperative: 6395000, passivitaOperative: 1140000, ccno: 2205000,
      investimentiFinanziari: 425000, attivoCircolante: 3640000, passivoCorrente: 2720000,
      debitiFinanziariBreve: 1710000, debitiFinanziariLungo: 1195000,
      pfn: 2480000, liquidita: 425000,
    },
    rf: {
      liquidita: 425000, liquiditaIniziale: 310000, flussoOperativo: 985000, capex: -510000,
      fcfo: 475000, servizioDelDebito: -360000, fcfe: 115000, dividendi: -80000, raccolta: 80000,
    },
  },
  {
    ce: {
      ricavi: 8400000, ebitda: 966000, ebit: 588000, mon: 566000,
      proventiFinanziari: 22000, oneriFinanziari: 132000, gestioneFinanziaria: -110000,
      risultatoAnteImposte: 456000, raof: 588000, imposte: 151000, utileNetto: 305000,
      ammortamenti: 340000, accantonamenti: 38000, valoreAggiunto: 2772000,
      costoLavoro: 1806000, costoVenduto: 3780000, costiServizi: 1420000,
      gestioneNonCorrente: -85000,
    },
    sp: {
      capitaleInvestitoNetto: 5200000, coin: 4890000, patrimonioNetto: 2560000,
      immobilizzazioniOperative: 3150000, attivitaOperativeCorrenti: 1810000, rimanenze: 980000,
      passivitaOperativeCorrenti: 930000, passivitaOperativeNonCorrenti: 120000,
      attivitaOperative: 5940000, passivitaOperative: 1050000, ccno: 1860000,
      investimentiFinanziari: 310000, attivoCircolante: 3100000, passivoCorrente: 2480000,
      debitiFinanziariBreve: 1550000, debitiFinanziariLungo: 1400000,
      pfn: 2640000, liquidita: 310000,
    },
    rf: {
      liquidita: 310000, liquiditaIniziale: 260000, flussoOperativo: 640000, capex: -420000,
      fcfo: 220000, servizioDelDebito: -300000, fcfe: -80000, dividendi: 0, raccolta: 130000,
    },
  },
];

/** Costruisce la serie dimostrativa a partire dall'anno indicato, a ritroso. */
export function generaEsempio(annoPiuRecente = new Date().getFullYear() - 1) {
  const out = {};
  PROFILO_ESEMPIO.forEach((p, i) => {
    out[annoPiuRecente - i] = { ...p, presenti: { ce: true, sp: true, rf: true } };
  });
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DEFINIZIONE DEGLI INDICATORI
   ═══════════════════════════════════════════════════════════════════════════ */

const sogliaCrescente = (bad, warn, testi) => (v) => {
  if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per esprimere un giudizio" };
  if (v < bad) return { level: "bad", testo: testi[0] };
  if (v < warn) return { level: "warn", testo: testi[1] };
  return { level: "ok", testo: testi[2] };
};

const sogliaDecrescente = (ok, warn, testi) => (v) => {
  if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per esprimere un giudizio" };
  if (v <= ok) return { level: "ok", testo: testi[2] };
  if (v <= warn) return { level: "warn", testo: testi[1] };
  return { level: "bad", testo: testi[0] };
};

/* ── Sezione 1 · Redditività Operativa ─────────────────────────────────────── */

const IND_REDDITIVITA_OPERATIVA = [
  {
    id: "ebitdaMargin",
    nome: "EBITDA Margin",
    sub: "EBITDA / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d.ce.ebitda, d.ce.ricavi),
    raw: (d) => [
      { label: "EBITDA", value: d.ce.ebitda },
      { label: "Ricavi", value: d.ce.ricavi },
    ],
    formula: "EBITDA ÷ Ricavi × 100",
    significato:
      "Misura quanta parte del fatturato resta come margine dalla sola gestione caratteristica, prima di ammortamenti, oneri finanziari e imposte. È l'indice più vicino alla capacità dell'azienda di generare cassa operativa: un margine in contrazione a ricavi crescenti segnala che la crescita sta avvenendo erodendo il prezzo o comprimendo l'efficienza di costo.",
    giudizio: sogliaCrescente(0.08, 0.15, [
      "Margine operativo lordo compresso: struttura di costo poco elastica",
      "Margine accettabile ma sotto la mediana di molti settori industriali",
      "Marginalità operativa lorda solida",
    ]),
  },
  {
    id: "ebitMargin",
    nome: "EBIT Margin (ROS)",
    sub: "EBIT / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d.ce.ebit, d.ce.ricavi),
    raw: (d) => [
      { label: "EBIT", value: d.ce.ebit },
      { label: "Ricavi", value: d.ce.ricavi },
    ],
    formula: "EBIT ÷ Ricavi × 100",
    significato:
      "Return On Sales: reddito operativo per ogni euro di ricavo, al netto degli ammortamenti. Rispetto all'EBITDA Margin incorpora il peso degli investimenti già sostenuti, quindi il divario fra i due indici racconta quanto l'azienda sia capital intensive.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Reddito operativo insufficiente a remunerare stabilmente il capitale",
      "ROS nella fascia intermedia: sostenibile ma vulnerabile a shock di costo",
      "ROS elevato, buon potere di prezzo o efficienza industriale",
    ]),
  },
  {
    id: "roi",
    nome: "ROI",
    sub: "EBIT / Capitale Investito Netto",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.ebit, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "EBIT", value: d.ce.ebit },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "EBIT ÷ Capitale Investito Netto × 100",
    significato:
      "Return On Investment: rendimento del capitale complessivamente impiegato nella gestione, indipendentemente da come è stato finanziato. Va sempre confrontato con il costo medio del debito: se il ROI supera il costo del denaro la leva finanziaria amplifica il ROE, altrimenti lo distrugge.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Rendimento del capitale investito inferiore al costo tipico del debito",
      "ROI positivo ma con spread ridotto rispetto al costo del debito",
      "Il capitale investito rende sensibilmente più di quanto costa finanziarlo",
    ]),
  },
  {
    id: "assetTurnover",
    nome: "Asset Turnover",
    sub: "Ricavi / Capitale Investito Netto",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.ricavi, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Ricavi ÷ Capitale Investito Netto",
    significato:
      "Quante volte il capitale investito viene «rigirato» dal fatturato in un esercizio. È il secondo fattore della scomposizione DuPont del ROI (ROI = ROS × Asset Turnover): due aziende con lo stesso ROI possono arrivarci per vie opposte, una con margini alti e rotazione lenta, l'altra con margini sottili e rotazione rapida. La soglia è fortemente settoriale.",
    giudizio: sogliaCrescente(0.8, 1.5, [
      "Rotazione lenta del capitale: verificare immobilizzi e capitale circolante",
      "Rotazione nella norma per settori a media intensità di capitale",
      "Capitale impiegato con efficienza, rotazione elevata",
    ]),
  },
];

/* ── Grandezze derivate condivise dai blocchi della Redditività Operativa ──── */

/** Aliquota fiscale in forma decimale (dai parametri di Fase 1 o dal modulo CE). */
const aliquotaDi = (ctx) => (isNum(ctx?.par?.aliquota) ? ctx.par.aliquota : null);

/** NOPAT = MON × (1 − aliquota): reddito operativo netto d'imposta figurativa. */
const nopatDi = (d, ctx) => {
  const t = aliquotaDi(ctx);
  return isNum(d?.ce?.mon) && isNum(t) ? d.ce.mon * (1 - t) : null;
};

/** Parametri manuali dell'esercizio, dalla tabella di Fase 1. */
const perAnno = (ctx, chiave) => num(ctx?.par?.perAnno?.[ctx?.anno]?.[chiave]);

/** Fondo ammortamento cumulato dell'esercizio, inserito manualmente in Fase 1. */
const fondoAmmDi = (ctx) => perAnno(ctx, "fondoAmm");

/** Capitale investito LORDO = CIN + fondo ammortamento cumulato. */
const capitaleLordoDi = (d, ctx) => {
  const f = fondoAmmDi(ctx);
  return isNum(f) && isNum(d?.sp?.capitaleInvestitoNetto) ? d.sp.capitaleInvestitoNetto + f : null;
};

/** Variazione del capitale operativo investito rispetto all'esercizio precedente. */
const deltaCoinDi = (d, ctx) => {
  const a = d?.sp?.coin;
  const b = ctx?.prec?.sp?.coin;
  return isNum(a) && isNum(b) ? a - b : null;
};

/** ROI operativo, riusato da spread, EVA e crescita sostenibile. */
const roiOperativoDi = (d) => safeDiv(d?.ce?.mon, d?.sp?.coin);

/** Crescita dei ricavi rispetto all'esercizio precedente. */
const crescitaRicaviDi = (d, ctx) => {
  const r1 = d?.ce?.ricavi;
  const r0 = ctx?.prec?.ce?.ricavi;
  return isNum(r1) && isNum(r0) && r0 !== 0 ? r1 / r0 - 1 : null;
};

const chiedePrecedente = (ctx) =>
  ctx?.prec ? null : "Richiede l'esercizio immediatamente precedente in memoria";
const chiedeWacc = (ctx) => (isNum(ctx?.par?.wacc) ? null : "Richiede il WACC (Fase 1 · Parametri, provvisorio)");
const chiedeAliquota = (ctx) => (isNum(aliquotaDi(ctx)) ? null : "Richiede l'aliquota fiscale (Fase 1 · Parametri)");

/* ── Blocco A · Varianti dell'indice di rendimento ─────────────────────────── */

const IND_VARIANTI_RENDIMENTO = [
  {
    id: "roiOperativo",
    nome: "ROI operativo",
    sub: "MON / COIN — analogo a ROIC e ROCE",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => roiOperativoDi(d),
    raw: (d) => [
      { label: "MON — reddito operativo caratteristico", value: d.ce.mon },
      { label: "COIN — capitale operativo investito netto", value: d.sp.coin },
    ],
    formula: "MON ÷ COIN × 100",
    significato:
      "È l'indice della sola gestione caratteristica: rendimento del capitale impiegato nelle attività tipiche, depurato sia della gestione finanziaria attiva sia di quella accessoria. Per evitare ambiguità terminologiche sui mercati finanziari va qualificato rigorosamente come ROI operativo, espressione analoga al ROIC (Return on Invested Capital) e al ROCE (Return on Capital Employed). È questo — non il rendimento del CIN totale — il valore da confrontare con il WACC.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Rendimento del capitale operativo inferiore al costo tipico del debito",
      "ROI operativo positivo ma con spread ridotto rispetto al costo del capitale",
      "Il capitale operativo rende sensibilmente più di quanto costa finanziarlo",
    ]),
  },
  {
    id: "rendimentoCin",
    nome: "Rendimento del CIN totale",
    sub: "RAOF / Capitale Investito Netto",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.raof, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "RAOF — risultato ante oneri finanziari", value: d.ce.raof },
      { label: "   di cui risultato ante imposte", value: d.ce.risultatoAnteImposte },
      { label: "   di cui oneri finanziari riaggiunti", value: d.ce.oneriFinanziari },
      { label: "Capitale Investito Netto totale", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "RAOF ÷ CIN × 100",
    significato:
      "Redditività globale dell'intero attivo aziendale prima degli oneri del debito: al numeratore il Risultato Ante Oneri Finanziari, ottenuto riaggiungendo al risultato ante imposte il costo del debito, al denominatore il capitale investito netto totale comprensivo della gestione finanziaria e accessoria. Misura quanto rende l'azienda nel suo complesso, indipendentemente da chi ne ha finanziato l'attivo. Il divario rispetto al ROI operativo isola il contributo delle aree non caratteristiche.",
    giudizio: sogliaCrescente(0.04, 0.09, [
      "L'attivo nel suo complesso rende meno del costo del debito",
      "Rendimento complessivo dell'attivo nella fascia intermedia",
      "L'attivo complessivo genera un rendimento solido prima degli oneri finanziari",
    ]),
  },
  {
    id: "rendimentoInvFin",
    nome: "Rendimento investimenti finanziari",
    sub: "Saldo gestione finanziaria attiva / Investimenti finanziari",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.proventiFinanziari, d.sp.investimentiFinanziari),
    raw: (d) => [
      { label: "Saldo gestione finanziaria attiva (proventi)", value: d.ce.proventiFinanziari },
      { label: "Investimenti finanziari", value: d.sp.investimentiFinanziari },
      { label: "   di cui liquidità", value: d.sp.liquidita },
      { label: "   di cui altre attività finanziarie", value: sottrai(d.sp.investimentiFinanziari, d.sp.liquidita) },
    ],
    formula: "Saldo gestione finanziaria attiva ÷ Investimenti finanziari × 100",
    significato:
      "Misura la redditività della gestione finanziaria attiva, cioè quanto rendono le risorse parcheggiate in liquidità e attività finanziarie anziché impiegate nel business. Il termine di paragone naturale non è il ROI operativo ma il rendimento privo di rischio: se un'azienda immobilizza cassa a un rendimento inferiore ai titoli di Stato a breve, sta distruggendo valore per pura inerzia di tesoreria.",
    giudizio: sogliaCrescente(0.01, 0.03, [
      "Liquidità sostanzialmente infruttifera: costo-opportunità elevato",
      "Rendimento modesto, da confrontare con il tasso privo di rischio corrente",
      "Gestione della liquidità remunerativa",
    ]),
  },
];

/* ── Blocco B · Correzione delle distorsioni contabili ─────────────────────── */

const IND_CORREZIONI = [
  {
    id: "tassoLordo",
    nome: "Tasso lordo di redditività operativa",
    sub: "MOL / Capitale investito lordo",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) =>
      fondoAmmDi(ctx) === null ? "Richiede il fondo ammortamento cumulato (Fase 1 · Parametri)" : null,
    calc: (d, ctx) => safeDiv(d.ce.ebitda, capitaleLordoDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "MOL (EBITDA)", value: d.ce.ebitda },
      { label: "Capitale investito lordo", value: capitaleLordoDi(d, ctx) },
      { label: "   di cui CIN contabile", value: d.sp.capitaleInvestitoNetto },
      { label: "   di cui fondo ammortamento cumulato", value: fondoAmmDi(ctx) },
    ],
    formula: "MOL ÷ (CIN + fondo ammortamento cumulato) × 100",
    significato:
      "Neutralizza la principale distorsione contabile del ROI. L'ammortamento riduce progressivamente il valore contabile delle immobilizzazioni, cioè il denominatore: un'azienda con MON perfettamente costante vedrebbe il proprio ROI crescere nel tempo per pura anzianità del parco immobilizzazioni, un'illusione contabile e non un reale miglioramento. Usando MOL al numeratore e capitale lordo al denominatore l'incidenza delle politiche di ammortamento si azzera, e il dato torna confrontabile sia nella serie storica sia con i concorrenti che adottano aliquote diverse.",
    giudizio: sogliaCrescente(0.04, 0.09, [
      "Redditività lorda del capitale bassa anche al netto delle politiche di ammortamento",
      "Redditività lorda nella fascia intermedia",
      "Redditività lorda solida: il risultato non dipende dalle scelte di ammortamento",
    ]),
  },
  {
    id: "roace",
    nome: "ROACE",
    sub: "MON / Capitale impiegato medio",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => safeDiv(d.ce.mon, media(d.sp.coin, ctx?.prec?.sp?.coin)),
    raw: (d, ctx) => [
      { label: "MON", value: d.ce.mon },
      { label: "COIN di fine esercizio", value: d.sp.coin },
      { label: "COIN di inizio esercizio", value: ctx?.prec?.sp?.coin },
      { label: "Capitale impiegato medio (semisomma)", value: media(d.sp.coin, ctx?.prec?.sp?.coin) },
    ],
    formula: "MON ÷ [(COIN inizio + COIN fine) ÷ 2] × 100",
    significato:
      "Return on Average Capital Employed. Il capitale impiegato non è statico ma varia continuamente durante l'anno: usare al denominatore il solo valore puntuale di fine esercizio è impreciso e premia artificiosamente chi ha disinvestito a dicembre o penalizza chi ha appena completato un investimento. La semisomma fra apertura e chiusura restituisce una misura molto più fedele del capitale effettivamente a disposizione della gestione. Lo scarto fra ROI e ROACE è tanto più ampio quanto più il capitale si è mosso nell'esercizio.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Rendimento del capitale medio impiegato insufficiente",
      "ROACE nella fascia intermedia",
      "Il capitale mediamente impiegato è remunerato in modo soddisfacente",
    ]),
  },
];

/* ── Blocco D · Confronto con il costo del capitale ────────────────────────── */

const IND_VALORE = [
  {
    id: "nopat",
    nome: "NOPAT",
    sub: "MON × (1 − aliquota)",
    unit: "val",
    betterWhen: "up",
    moduli: ["ce"],
    richiede: chiedeAliquota,
    calc: (d, ctx) => nopatDi(d, ctx),
    raw: (d, ctx) => [
      { label: "MON", value: d.ce.mon },
      { label: "Aliquota applicata (%)", value: isNum(aliquotaDi(ctx)) ? aliquotaDi(ctx) * 100 : null },
      { label: "Imposte figurative sul reddito operativo", value: isNum(nopatDi(d, ctx)) ? d.ce.mon - nopatDi(d, ctx) : null },
    ],
    formula: "MON × (1 − aliquota fiscale)",
    significato:
      "Net Operating Profit After Taxes: il reddito operativo al netto delle sole imposte teoriche che graverebbero su di esso, depurato dello scudo fiscale degli oneri finanziari. È la rettifica indispensabile per l'EVA, perché il beneficio fiscale del debito è già incorporato nel WACC: contarlo anche al numeratore lo conteggerebbe due volte.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "La gestione operativa produce reddito anche al netto delle imposte figurative" }
        : { level: "bad", testo: "Reddito operativo netto d'imposta negativo" },
  },
  {
    id: "spread",
    nome: "Spread ROI − WACC",
    sub: "Extra-rendimento sul costo del capitale",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: chiedeWacc,
    calc: (d, ctx) => {
      const roi = roiOperativoDi(d);
      const w = ctx?.par?.wacc;
      return isNum(roi) && isNum(w) ? roi - w : null;
    },
    raw: (d, ctx) => [
      { label: "ROI operativo (%)", value: isNum(roiOperativoDi(d)) ? roiOperativoDi(d) * 100 : null },
      { label: "WACC (%)", value: isNum(ctx?.par?.wacc) ? ctx.par.wacc * 100 : null },
    ],
    formula: "ROI operativo − WACC",
    significato:
      "Il ROI operativo misura la redditività dei capitali investiti nelle attività caratteristiche; il WACC esprime il costo di quei capitali, ovvero la remunerazione media richiesta da azionisti e finanziatori terzi. La regola aurea impone che il ROI operativo superi il WACC: solo in quello scenario la gestione genera un extra-profitto che accresce il valore fondamentale del capitale investito e massimizza la ricchezza degli azionisti. Uno spread negativo significa che l'azienda distrugge valore anche se il bilancio chiude in utile.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Inserire il WACC per attivare il confronto" }
        : v > 0.02
        ? { level: "ok", testo: "Il rendimento operativo supera nettamente il costo del capitale: creazione di valore" }
        : v > 0
        ? { level: "warn", testo: "Spread positivo ma sottile: la creazione di valore è fragile" }
        : { level: "bad", testo: "Il rendimento operativo non copre il costo del capitale: distruzione di valore" },
  },
  {
    id: "eva",
    nome: "EVA",
    sub: "NOPAT − WACC × COIN",
    unit: "val",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => chiedeWacc(ctx) || chiedeAliquota(ctx),
    calc: (d, ctx) => {
      const n = nopatDi(d, ctx);
      const w = ctx?.par?.wacc;
      return isNum(n) && isNum(w) && isNum(d.sp.coin) ? n - w * d.sp.coin : null;
    },
    raw: (d, ctx) => [
      { label: "NOPAT", value: nopatDi(d, ctx) },
      { label: "COIN", value: d.sp.coin },
      { label: "Costo figurativo del capitale (WACC × COIN)", value: isNum(ctx?.par?.wacc) && isNum(d.sp.coin) ? ctx.par.wacc * d.sp.coin : null },
    ],
    formula: "EVA = NOPAT − (WACC × COIN)  ≡  (ROI netto − WACC) × COIN",
    significato:
      "Economic Value Added: quantifica in termini assoluti la ricchezza creata in un esercizio, cioè quanto reddito operativo residua dopo aver remunerato per intero tutti i capitali impiegati, debito e capitale di rischio. È l'assunto teorico che traduce lo spread ROI−WACC in euro. Attualizzando al WACC gli EVA futuri attesi e sommandoli al COIN corrente si ottiene un valore economico degli investimenti operativi che coincide perfettamente con quello del metodo Discounted Cash Flow in configurazione asset side.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Inserire WACC e aliquota per calcolare l'EVA" }
        : v > 0
        ? { level: "ok", testo: "Valore economico creato nell'esercizio" }
        : { level: "bad", testo: "Valore economico distrutto: i capitali non sono stati remunerati per intero" },
  },
];

/* ── Blocco E · Crescita, leva di cassa e Free Cash Flow ───────────────────── */

const IND_CRESCITA = [
  {
    id: "crescitaRicavi",
    nome: "Crescita dei ricavi",
    sub: "Variazione del fatturato sull'esercizio precedente",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => crescitaRicaviDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Ricavi esercizio", value: d.ce.ricavi },
      { label: "Ricavi esercizio precedente", value: ctx?.prec?.ce?.ricavi },
    ],
    formula: "(Ricavi t ÷ Ricavi t-1) − 1",
    significato:
      "È l'asse orizzontale della matrice strategica e il motore della leva di cassa. La crescita dimensionale agisce su due fronti contrapposti: alimenta l'autofinanziamento incrementando il valore assoluto del MON, ma assorbe risorse richiedendo continui investimenti in capitale circolante commerciale e in capacità produttiva.",
    giudizio: (v, ctx) => {
      const rif = ctx?.benchmark?.crescitaMediana;
      if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per esprimere un giudizio" };
      if (!isNum(rif)) return { level: "info", testo: "Nessun riferimento settoriale impostato per la crescita" };
      return v >= rif
        ? { level: "ok", testo: `Crescita superiore al riferimento settoriale (${pct(rif)})` }
        : { level: "warn", testo: `Crescita inferiore al riferimento settoriale (${pct(rif)})` };
    },
  },
  {
    id: "assorbimentoCapitale",
    nome: "Assorbimento di capitale (ΔCOIN)",
    sub: "Risorse assorbite dalla crescita",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => deltaCoinDi(d, ctx),
    raw: (d, ctx) => [
      { label: "COIN esercizio", value: d.sp.coin },
      { label: "COIN esercizio precedente", value: ctx?.prec?.sp?.coin },
      { label: "ΔCCNO — capitale circolante netto commerciale", value: isNum(d.sp.ccno) && isNum(ctx?.prec?.sp?.ccno) ? d.sp.ccno - ctx.prec.sp.ccno : null },
      { label: "ΔImmobilizzazioni operative — capacità produttiva", value: isNum(d.sp.immobilizzazioniOperative) && isNum(ctx?.prec?.sp?.immobilizzazioniOperative) ? d.sp.immobilizzazioniOperative - ctx.prec.sp.immobilizzazioniOperative : null },
    ],
    formula: "ΔCOIN = ΔCCNO + ΔImmobilizzazioni operative",
    significato:
      "L'assorbimento finanziario della crescita, scomposto nelle sue due determinanti: l'aumento del capitale circolante netto commerciale necessario a finanziare crediti e magazzino, e gli investimenti strutturali in capacità produttiva. Leggere le due componenti separatamente è dirimente: un assorbimento guidato dal circolante segnala tensione sul ciclo monetario, uno guidato dalle immobilizzazioni segnala una scelta di espansione della capacità.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 0
        ? { level: "ok", testo: "Il capitale investito si è ridotto: la gestione ha liberato risorse" }
        : { level: "info", testo: "La crescita ha assorbito capitale: verificarne la copertura con il MON" },
  },
  {
    id: "fcfLevaCassa",
    nome: "Free Cash Flow (leva di cassa)",
    sub: "NOPAT − ΔCOIN",
    unit: "val",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => chiedePrecedente(ctx) || chiedeAliquota(ctx),
    calc: (d, ctx) => {
      const n = nopatDi(d, ctx);
      const dc = deltaCoinDi(d, ctx);
      return isNum(n) && isNum(dc) ? n - dc : null;
    },
    raw: (d, ctx) => [
      { label: "NOPAT", value: nopatDi(d, ctx) },
      { label: "ΔCOIN assorbito", value: deltaCoinDi(d, ctx) },
      { label: "FCFO dal Rendiconto Finanziario (riscontro)", value: d.rf?.fcfo },
    ],
    formula: "FCF = NOPAT − ΔCapitale investito",
    significato:
      "La formulazione lineare fondamentale della leva di cassa: il flusso di cassa effettivamente disponibile è ciò che resta del reddito operativo netto una volta finanziato l'incremento di capitale che la crescita richiede. Se disponibile, il FCFO del Rendiconto Finanziario funge da riscontro indipendente: divergenze marcate segnalano componenti non monetarie o rettifiche di riclassificazione da indagare.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "La gestione operativa autofinanzia la propria crescita e libera cassa" }
        : { level: "warn", testo: "La crescita assorbe più cassa di quanta la gestione ne produca" },
  },
  {
    id: "tassoReinvestimento",
    nome: "Tasso di reinvestimento",
    sub: "ΔCOIN / NOPAT",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => chiedePrecedente(ctx) || chiedeAliquota(ctx),
    calc: (d, ctx) => safeDiv(deltaCoinDi(d, ctx), nopatDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "ΔCOIN reinvestito", value: deltaCoinDi(d, ctx) },
      { label: "NOPAT", value: nopatDi(d, ctx) },
    ],
    formula: "Tasso di reinvestimento = ΔCapitale investito ÷ NOPAT",
    significato:
      "La quota percentuale di reddito operativo netto sistematicamente trattenuta e reimpiegata in azienda per sostenere i processi di sviluppo ed espansione. È il complemento della quota distribuibile: più alto il tasso, meno cassa resta libera, ma maggiore la base di capitale su cui il ROI potrà produrre reddito negli esercizi futuri.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v < 0
        ? { level: "info", testo: "Reinvestimento negativo: l'azienda sta liberando capitale, non assorbendolo" }
        : v > 1
        ? { level: "warn", testo: "Reinvestimento superiore al reddito operativo netto: la crescita richiede finanza esterna" }
        : { level: "ok", testo: "Reinvestimento coperto dal reddito operativo netto" },
  },
  {
    id: "gSostenibile",
    nome: "Crescita sostenibile (g)",
    sub: "ROI operativo × tasso di reinvestimento",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => chiedePrecedente(ctx) || chiedeAliquota(ctx),
    calc: (d, ctx) => {
      const roi = roiOperativoDi(d);
      const tr = safeDiv(deltaCoinDi(d, ctx), nopatDi(d, ctx));
      return isNum(roi) && isNum(tr) ? roi * tr : null;
    },
    raw: (d, ctx) => [
      { label: "ROI operativo (%)", value: isNum(roiOperativoDi(d)) ? roiOperativoDi(d) * 100 : null },
      { label: "Tasso di reinvestimento (%)", value: isNum(safeDiv(deltaCoinDi(d, ctx), nopatDi(d, ctx))) ? safeDiv(deltaCoinDi(d, ctx), nopatDi(d, ctx)) * 100 : null },
      { label: "Crescita effettiva dei ricavi (%)", value: isNum(crescitaRicaviDi(d, ctx)) ? crescitaRicaviDi(d, ctx) * 100 : null },
    ],
    formula: "g = ROI × Tasso di reinvestimento",
    significato:
      "Ipotizzando stabilità strutturale della redditività — costanza del rapporto MON/Ricavi e proporzionalità del capitale rispetto al fatturato — il tasso di crescita sostenibile del reddito operativo è univocamente definito dal prodotto fra redditività degli investimenti e quota di utili trattenuta per finanziarli. Confrontarlo con la crescita effettiva dei ricavi dice se lo sviluppo in corso sia autofinanziabile o richieda apporti esterni di capitale.",
    giudizio: (v, ctx) => {
      if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per esprimere un giudizio" };
      const eff = isNum(ctx?.crescitaEffettiva) ? ctx.crescitaEffettiva : null;
      if (!isNum(eff)) return { level: "info", testo: "Crescita effettiva non confrontabile in questo esercizio" };
      return v >= eff
        ? { level: "ok", testo: `Lo sviluppo in corso (${pct(eff)}) è interamente autofinanziabile` }
        : { level: "warn", testo: `La crescita effettiva (${pct(eff)}) eccede quella sostenibile: serve finanza esterna` };
    },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-ter. DETERMINANTI DEL ROI — grandezze derivate
   ═══════════════════════════════════════════════════════════════════════════ */

/** Produttività del capitale (Capital Turnover): quante volte il COIN ruota. */
const pcDi = (d) => safeDiv(d?.ce?.ricavi, d?.sp?.coin);
/** Redditività delle vendite netta. */
const rosDi = (d) => safeDiv(d?.ce?.mon, d?.ce?.ricavi);
/** Redditività delle vendite lorda, immune dalle politiche di ammortamento. */
const rosLordoDi = (d) => safeDiv(d?.ce?.ebitda, d?.ce?.ricavi);
/** Intensità di capitale: euro di COIN per euro di ricavo. */
const intensitaCapitaleDi = (d) => safeDiv(d?.sp?.coin, d?.ce?.ricavi);
/** ROA calcolato sulle attività operative LORDE (senza compensare i fornitori). */
const roaDi = (d) => safeDiv(d?.ce?.mon, d?.sp?.attivitaOperative);
/** Leva commerciale: quanto le passività operative sgonfiano il capitale da finanziare. */
const levComDi = (d) => safeDiv(d?.sp?.attivitaOperative, d?.sp?.coin);

/** Ammortamenti: dalla classe del CE, con ripiego sulla differenza MOL − MON. */
const ammortamentiDi = (d) =>
  isNum(d?.ce?.ammortamenti) && d.ce.ammortamenti !== 0
    ? Math.abs(d.ce.ammortamenti)
    : isNum(d?.ce?.ebitda) && isNum(d?.ce?.mon)
    ? d.ce.ebitda - d.ce.mon
    : null;

/** Immobilizzazioni operative LORDE = nette + fondo ammortamento cumulato. */
const immobLordeDi = (d, ctx) => {
  const f = fondoAmmDi(ctx);
  return isNum(f) && isNum(d?.sp?.immobilizzazioniOperative) ? d.sp.immobilizzazioniOperative + f : null;
};

/** Grandezze con override manuale: il parametro di Fase 1 vince sul dato del CE. */
const costoVendutoDi = (d, ctx) => perAnno(ctx, "costoVenduto") ?? (isNum(d?.ce?.costoVenduto) ? Math.abs(d.ce.costoVenduto) : null);
const costoLavoroDi = (d, ctx) => perAnno(ctx, "costoLavoro") ?? (isNum(d?.ce?.costoLavoro) ? Math.abs(d.ce.costoLavoro) : null);
const creditiCommDi = (d, ctx) => perAnno(ctx, "creditiComm") ?? d?.sp?.attivitaOperativeCorrenti ?? null;
const debitiCommDi = (d, ctx) => perAnno(ctx, "debitiComm") ?? d?.sp?.passivitaOperativeCorrenti ?? null;

/* ── Separazione dei costi in quota fissa e quota variabile ─────────────────
   Nessuno schema di bilancio obbligatorio — né il codice civile, né gli IFRS,
   né gli US-GAAP — impone di distinguere i costi fissi dai variabili: è una
   classificazione gestionale, e nei bilanci pubblici semplicemente non c'è.
   Chiederla a un modello che legge il fascicolo significa quasi sempre farsela
   inventare. La via rigorosa è quella che la contabilità analitica usa da
   sempre quando il dato manca: osservare come i costi si muovono al muovere
   dei ricavi lungo la serie storica.

   Sulla retta  Costi operativi = F + v · Ricavi  la pendenza v è la quota
   variabile e l'intercetta F il costo fisso di struttura. Con tre o più
   esercizi si stima per minimi quadrati; l'indice R² dice quanto la retta
   spiega davvero i dati, ed è il criterio con cui accettare o rifiutare la
   stima. Il metodo presuppone che la struttura non sia stata riorganizzata nel
   periodo: un R² basso è proprio il segnale che quel presupposto è caduto.
   ─────────────────────────────────────────────────────────────────────────── */

/** Costi operativi totali dell'esercizio, per differenza fra ricavi e reddito
 *  operativo: è l'aggregato che la retta di costo deve spiegare. */
const costiOperativiDi = (d) => sottraiStretto(d?.ce?.ricavi, d?.ce?.mon);

/**
 * Regressione dei costi operativi sui ricavi lungo la serie storica.
 *
 * @param {object} dataset  mappa anno → { ce, sp, rf }
 * @param {Array}  anni     esercizi da usare (default: tutti quelli del dataset)
 * @returns {null|{quota:number, costiFissi:number, r2:number, n:number,
 *                 anni:Array<number>, affidabile:boolean, motivo:string}}
 *          `quota` è espressa in punti percentuali, come il campo del modulo.
 */
export function stimaQuotaVariabile(dataset, anni = null) {
  const elenco = (anni || Object.keys(dataset || {}))
    .map(Number)
    // Solo esercizi interi: un TTM si sovrappone all'anno prima e falserebbe la retta.
    .filter((a) => Number.isFinite(a) && Number.isInteger(a))
    .sort((a, b) => a - b);

  const punti = elenco
    .map((a) => ({ anno: a, x: dataset?.[a]?.ce?.ricavi, y: costiOperativiDi(dataset?.[a]) }))
    .filter((p) => isNum(p.x) && isNum(p.y) && p.x > 0);

  if (punti.length < 3) return null;

  const n = punti.length;
  const mx = punti.reduce((s, p) => s + p.x, 0) / n;
  const my = punti.reduce((s, p) => s + p.y, 0) / n;
  const sxy = punti.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = punti.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;

  const v = sxy / sxx;
  const F = my - v * mx;

  /* R²: quota della varianza dei costi spiegata dalla retta.
     Con tre soli punti l'R² è quasi sempre prossimo a 1 — due parametri
     stimati su tre osservazioni lasciano un unico grado di libertà — e non
     costituisce quindi una verifica. L'R² corretto per i gradi di libertà lo
     dice apertamente, e la stima va allora presa come primo ordine di
     grandezza da confermare su una serie più lunga. */
  const syy = punti.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const residui = punti.reduce((s, p) => s + (p.y - (F + v * p.x)) ** 2, 0);
  const r2 = syy === 0 ? 1 : 1 - residui / syy;
  const r2corretto = n > 2 ? 1 - ((1 - r2) * (n - 1)) / (n - 2) : null;

  /* Una pendenza fuori dall'intervallo [0,1] non descrive una struttura di
     costo: significa che i costi calano al crescere dei ricavi, o che crescono
     più dei ricavi stessi. In entrambi i casi la stima non va usata. */
  const motivo =
    v <= 0
      ? "La regressione restituisce una quota variabile negativa: nel periodo i costi operativi calano al crescere dei ricavi, segno di una discontinuità gestionale che la retta non può descrivere."
      : v >= 1
      ? "La regressione restituisce una quota variabile pari o superiore al 100%: i costi crescono quanto o più dei ricavi e il margine di contribuzione risulterebbe nullo o negativo."
      : r2 < 0.8
      ? "La retta spiega meno dell'80% della variabilità dei costi: nel periodo la struttura è probabilmente cambiata e la separazione va rifatta su esercizi omogenei."
      : "";

  /* Avvertenza distinta dal rifiuto: la stima resta utilizzabile, ma su tre
     osservazioni la bontà dell'adattamento non è verificabile. */
  const cautela =
    !motivo && n === 3
      ? "La retta è stimata su tre soli esercizi: con due parametri e un unico grado di libertà l'adattamento risulta quasi perfetto per costruzione e non dimostra nulla. Tratta la quota come un primo ordine di grandezza e confermala appena lo storico si allunga."
      : "";

  return {
    quota: v * 100,
    costiFissi: F,
    r2,
    r2corretto,
    n,
    anni: punti.map((p) => p.anno),
    affidabile: !motivo,
    motivo,
    cautela,
  };
}

/** Costi variabili e margine di contribuzione dalla quota di variabilità dichiarata. */
const costiVariabiliDi = (d, ctx) => {
  const q = perAnno(ctx, "quotaVariabile");
  return isNum(q) && isNum(d?.ce?.ricavi) ? (d.ce.ricavi * q) / 100 : null;
};
const mdcDi = (d, ctx) => sottraiStretto(d?.ce?.ricavi, costiVariabiliDi(d, ctx));
const costiFissiDi = (d, ctx) => sottraiStretto(mdcDi(d, ctx), d?.ce?.mon);

/** Sottrazione che pretende entrambi i termini (a differenza di `sottrai`). */
function sottraiStretto(a, b) {
  return isNum(a) && isNum(b) ? a - b : null;
}

/** Scomposizione dello scostamento del ROI fra due esercizi. */
export function scostamentiRoi(d1, d0) {
  const ros1 = rosDi(d1);
  const ros0 = rosDi(d0);
  const pc1 = pcDi(d1);
  const pc0 = pcDi(d0);
  if (![ros1, ros0, pc1, pc0].every(isNum)) return null;
  const effettoRos = (ros1 - ros0) * pc0;
  const effettoPc = (pc1 - pc0) * ros0;
  const congiunto = (ros1 - ros0) * (pc1 - pc0);
  return {
    roi0: ros0 * pc0,
    roi1: ros1 * pc1,
    delta: ros1 * pc1 - ros0 * pc0,
    effettoRos,
    effettoPc,
    congiunto,
  };
}

/**
 * Depurazione del beta in quattro passaggi + rilevering sull'impresa.
 * βU settore = βL / [1 + (1−t)·D/E]      → via il rischio finanziario di settore
 * Business Beta = βU settore / (1 + GLO settore) → via i costi fissi di settore
 * βU impresa = Business Beta × (1 + GLO impresa) → i costi fissi DI QUESTA impresa
 * βL impresa = βU impresa × [1 + (1−t)·D/E impresa] → per il CAPM
 */
export function depurazioneBeta({ betaL, deSettore, tSettore, gloSettore, gloImpresa, deImpresa, tImpresa, rf, erp }) {
  const out = { betaUSettore: null, businessBeta: null, betaUImpresa: null, betaLImpresa: null, ke: null };
  if (isNum(betaL) && isNum(deSettore) && isNum(tSettore)) {
    const den = 1 + (1 - tSettore) * deSettore;
    if (den !== 0) out.betaUSettore = betaL / den;
  }
  if (isNum(out.betaUSettore) && isNum(gloSettore) && 1 + gloSettore !== 0)
    out.businessBeta = out.betaUSettore / (1 + gloSettore);
  if (isNum(out.businessBeta) && isNum(gloImpresa)) out.betaUImpresa = out.businessBeta * (1 + gloImpresa);
  if (isNum(out.betaUImpresa) && isNum(deImpresa) && isNum(tImpresa))
    out.betaLImpresa = out.betaUImpresa * (1 + (1 - tImpresa) * deImpresa);
  if (isNum(out.betaLImpresa) && isNum(rf) && isNum(erp)) out.ke = rf + out.betaLImpresa * erp;
  return out;
}

/** Classificazione BCG di una singola area strategica d'affari. */
export function classeBcg(quotaRelativa, crescitaMercato, sogliaCrescita = 0.1) {
  if (!isNum(quotaRelativa) || !isNum(crescitaMercato)) return null;
  const forte = quotaRelativa >= 1;
  const veloce = crescitaMercato >= sogliaCrescita;
  if (forte && veloce) return { id: "star", nome: "Star", colore: GREEN, testo: "Quota di leadership in un mercato in espansione: assorbe risorse per difendere la posizione, ma è la cash cow di domani." };
  if (forte) return { id: "cow", nome: "Cash cow", colore: BLUE, testo: "Leadership in un mercato maturo: genera cassa in eccesso rispetto al fabbisogno di reinvestimento ed è la fonte che finanzia le Star e le Question mark." };
  if (veloce) return { id: "question", nome: "Question mark", colore: AMBER, testo: "Mercato attraente ma posizione debole: richiede investimenti massicci per diventare Star, o va dismessa prima che consumi risorse." };
  return { id: "dog", nome: "Dog", colore: RED, testo: "Posizione debole in un mercato fermo: candidata naturale alla dismissione, salvo ragioni di completamento di gamma." };
}

/* ── Blocco A · Il modello DuPont ──────────────────────────────────────────── */

const IND_DUPONT = [
  {
    id: "pc",
    nome: "Produttività del capitale",
    sub: "Ricavi / COIN — Capital Turnover",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => pcDi(d),
    raw: (d) => [
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "COIN", value: d.sp.coin },
      { label: "Giorni del ciclo capitalistico", value: isNum(pcDi(d)) ? 360 / pcDi(d) : null },
    ],
    formula: "Ricavi ÷ COIN",
    significato:
      "Quanto output riesci a generare con un dato input: quante volte in un anno il capitale investito rientra sotto forma di vendite, cioè quanti cicli capitalistici l'impresa completa. Dividendo 360 per questo valore si ottengono i giorni necessari a chiudere un ciclo. È la prima delle due leve del ROI e quella su cui agiscono le strategie di volume.",
    giudizio: sogliaCrescente(0.8, 1.5, [
      "Rotazione lenta: il capitale resta immobilizzato a lungo prima di tornare in forma di ricavo",
      "Rotazione nella norma dei settori a media intensità di capitale",
      "Capitale che ruota rapidamente: tipico dei settori leggeri e delle strategie di volume",
    ]),
  },
  {
    id: "giorniCiclo",
    nome: "Durata del ciclo capitalistico",
    sub: "360 / Produttività del capitale",
    unit: "val",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => (isNum(pcDi(d)) && pcDi(d) !== 0 ? 360 / pcDi(d) : null),
    raw: (d) => [
      { label: "Produttività del capitale (×100)", value: isNum(pcDi(d)) ? pcDi(d) * 100 : null },
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "COIN", value: d.sp.coin },
    ],
    formula: "360 ÷ (Ricavi ÷ COIN)",
    significato:
      "I giorni necessari perché il capitale investito ritorni integralmente sotto forma di vendite. È la stessa informazione della produttività del capitale, espressa in una grandezza che il management legge in modo più immediato quando deve confrontarsi con i tempi del ciclo operativo.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 240
        ? { level: "ok", testo: "Ciclo capitalistico breve" }
        : v <= 450
        ? { level: "warn", testo: "Ciclo capitalistico di media durata" }
        : { level: "bad", testo: "Ciclo capitalistico lungo: capitale immobilizzato per oltre un anno di vendite" },
  },
  {
    id: "rosDupont",
    nome: "Redditività delle vendite (ROS)",
    sub: "MON / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => rosDi(d),
    raw: (d) => [
      { label: "MON", value: d.ce.mon },
      { label: "Ricavi", value: d.ce.ricavi },
    ],
    formula: "MON ÷ Ricavi × 100",
    significato:
      "La capacità di estrarre profitto dalle vendite: la seconda leva del ROI, quella su cui agiscono le strategie di differenziazione e di prezzo. Insieme alla produttività del capitale esaurisce la spiegazione del rendimento: ROI = ROS × PC.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Marginalità sulle vendite compressa: il rendimento può venire solo dalla rotazione",
      "Marginalità intermedia",
      "Marginalità elevata: potere di prezzo o posizione differenziata",
    ]),
  },
  {
    id: "rosLordo",
    nome: "ROS lordo",
    sub: "MOL / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => rosLordoDi(d),
    raw: (d) => [
      { label: "MOL (EBITDA)", value: d.ce.ebitda },
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "Scarto rispetto al ROS netto (ammortamenti e accantonamenti)", value: sottraiStretto(d.ce.ebitda, d.ce.mon) },
    ],
    formula: "MOL ÷ Ricavi × 100",
    significato:
      "La stessa leva depurata dalle politiche di bilancio: usando il Margine Operativo Lordo anziché quello Netto si elimina l'effetto delle aliquote di ammortamento, rendendo il confronto omogeneo fra esercizi e fra concorrenti che adottano criteri diversi. Lo scarto rispetto al ROS netto misura esattamente quanta marginalità viene assorbita dalla struttura già investita.",
    giudizio: sogliaCrescente(0.08, 0.15, [
      "Marginalità lorda compressa anche prima degli ammortamenti",
      "Marginalità lorda intermedia",
      "Marginalità lorda solida",
    ]),
  },
  {
    id: "intensitaCapitale",
    nome: "Intensità di capitale",
    sub: "COIN / Ricavi",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => intensitaCapitaleDi(d),
    raw: (d) => [
      { label: "COIN", value: d.sp.coin },
      { label: "Ricavi", value: d.ce.ricavi },
    ],
    formula: "COIN ÷ Ricavi",
    significato:
      "Il reciproco della produttività del capitale: quanti euro di capitale investito servono per generare un euro di ricavo. È il moltiplicatore che, applicato al tasso di sviluppo delle vendite, dice quanto capitale la crescita assorbirà. La condizione di crescita equilibrata è proprio TSV × intensità di capitale = ROS.",
    giudizio: sogliaDecrescente(0.7, 1.3, [
      "Struttura molto capital intensive: ogni euro di crescita ne assorbe più di uno di capitale",
      "Intensità di capitale nella norma",
      "Struttura leggera: la crescita assorbe poco capitale",
    ]),
  },
];

/* ── Blocco D · Leva commerciale ───────────────────────────────────────────── */

const IND_LEVA_COMMERCIALE = [
  {
    id: "roa",
    nome: "ROA sulle attività operative",
    sub: "MON / Attività operative lorde",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => roaDi(d),
    raw: (d) => [
      { label: "MON", value: d.ce.mon },
      { label: "Attività operative lorde", value: d.sp.attivitaOperative },
      { label: "   di cui immobilizzazioni operative", value: d.sp.immobilizzazioniOperative },
      { label: "   di cui magazzino", value: d.sp.rimanenze },
      { label: "   di cui attività operative correnti", value: d.sp.attivitaOperativeCorrenti },
    ],
    formula: "MON ÷ Attività operative lorde × 100",
    significato:
      "Il ROA rapporta il reddito alle attività LORDE, senza compensare le passività operative. È un indicatore incoerente e penalizzante: i fornitori fanno pagare un costo implicito per le dilazioni concesse — merci più care — che abbassa il MON al numeratore, mentre il beneficio finanziario di quelle dilazioni non compare al denominatore. Il ROA registra il costo e ignora il vantaggio.",
    giudizio: sogliaCrescente(0.04, 0.09, [
      "Rendimento delle attività operative basso",
      "Rendimento delle attività operative intermedio",
      "Rendimento delle attività operative elevato",
    ]),
  },
  {
    id: "levCom",
    nome: "Leva commerciale",
    sub: "Attività operative / COIN",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => levComDi(d),
    raw: (d) => [
      { label: "Attività operative lorde", value: d.sp.attivitaOperative },
      { label: "Passività operative", value: d.sp.passivitaOperative },
      { label: "   di cui passività operative correnti", value: d.sp.passivitaOperativeCorrenti },
      { label: "   di cui passività operative non correnti", value: d.sp.passivitaOperativeNonCorrenti },
      { label: "COIN = AttOp − PassOp", value: d.sp.coin },
    ],
    formula: "Attività operative ÷ COIN",
    significato:
      "Le passività operative — in primo luogo i debiti verso fornitori — sono una spugna: finanziano una parte dell'attivo senza ricorrere a capitale oneroso, banche o soci. La leva commerciale misura di quanto questo effetto spugna amplifica il rendimento: ROI = ROA × Leva commerciale. Se ti finanzi con i fornitori a un costo implicito inferiore al rendimento delle attività, il differenziale resta interamente ai soci.",
    giudizio: sogliaCrescente(1.05, 1.3, [
      "Le passività operative finanziano una quota trascurabile dell'attivo",
      "Effetto spugna moderato",
      "Effetto spugna rilevante: quota significativa dell'attivo finanziata dal ciclo commerciale",
    ]),
  },
];

/* ── Blocco E · Produttività delle immobilizzazioni ────────────────────────── */

const IND_IMMOBILIZZAZIONI = [
  {
    id: "sgfa",
    nome: "SGFA",
    sub: "Ricavi / Immobilizzazioni operative lorde",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => (fondoAmmDi(ctx) === null ? "Richiede il fondo ammortamento cumulato (Fase 1)" : null),
    calc: (d, ctx) => safeDiv(d.ce.ricavi, immobLordeDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "Immobilizzazioni operative lorde", value: immobLordeDi(d, ctx) },
      { label: "   di cui valore netto contabile", value: d.sp.immobilizzazioniOperative },
      { label: "   di cui fondo ammortamento", value: fondoAmmDi(ctx) },
    ],
    formula: "Ricavi ÷ Immobilizzazioni operative lorde",
    significato:
      "Sales on Gross Fixed Assets: misura lo sfruttamento effettivo degli impianti al loro costo storico, non al valore residuo. È l'unico modo per confrontare l'efficienza produttiva di un'azienda con impianti vecchi e quasi ammortizzati con quella di un concorrente che ha appena rinnovato: il valore netto contabile renderebbe il confronto privo di significato.",
    giudizio: sogliaCrescente(0.7, 1.5, [
      "Impianti sottoutilizzati rispetto al capitale storicamente investito",
      "Sfruttamento degli impianti nella norma",
      "Impianti sfruttati intensamente",
    ]),
  },
  {
    id: "produttivitaVa",
    nome: "Produttività sul valore aggiunto",
    sub: "Valore aggiunto / Immobilizzazioni operative",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.valoreAggiunto, d.sp.immobilizzazioniOperative),
    raw: (d) => [
      { label: "Valore aggiunto", value: d.ce.valoreAggiunto },
      { label: "Immobilizzazioni operative nette", value: d.sp.immobilizzazioniOperative },
    ],
    formula: "Valore aggiunto ÷ Immobilizzazioni operative",
    significato:
      "Sostituendo i ricavi con il valore aggiunto si sterilizza l'effetto delle esternalizzazioni: un'azienda che compra semilavorati anziché produrli mostra ricavi identici ma un valore aggiunto molto più basso, e la produttività calcolata sui ricavi la premierebbe indebitamente. Questa versione misura la ricchezza realmente prodotta dagli impianti.",
    giudizio: sogliaCrescente(0.2, 0.5, [
      "Ricchezza generata dagli impianti modesta rispetto al capitale investito",
      "Produttività degli impianti nella norma",
      "Impianti molto produttivi in termini di ricchezza generata",
    ]),
  },
  {
    id: "indiceSostituzione",
    nome: "Indice di sostituzione",
    sub: "CAPEX / Ammortamenti",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(Math.abs(d.rf?.capex ?? NaN), ammortamentiDi(d)),
    raw: (d) => [
      { label: "CAPEX del periodo (valore assoluto)", value: isNum(d.rf?.capex) ? Math.abs(d.rf.capex) : null },
      { label: "Ammortamenti", value: ammortamentiDi(d) },
    ],
    formula: "|CAPEX| ÷ Ammortamenti",
    significato:
      "Dice se l'impresa stia sviluppando la propria capacità produttiva o si limiti a mantenerla. Sopra 1 gli investimenti eccedono il consumo del capitale fisso e la struttura si espande; a 1 l'azienda sostituisce esattamente ciò che consuma; sotto 1 sta vivendo di rendita sugli impianti esistenti, con un ROI che migliorerà per pura anzianità contabile mentre la capacità competitiva si erode.",
    giudizio: sogliaCrescente(0.8, 1.1, [
      "Investimenti inferiori al consumo del capitale fisso: struttura in progressivo invecchiamento",
      "Investimenti di puro mantenimento della capacità produttiva",
      "Investimenti in espansione della capacità produttiva",
    ]),
  },
  {
    id: "gradoAmmortamento",
    nome: "Grado di ammortamento",
    sub: "Fondo ammortamento / Immobilizzazioni lorde",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    richiede: (ctx) => (fondoAmmDi(ctx) === null ? "Richiede il fondo ammortamento cumulato (Fase 1)" : null),
    calc: (d, ctx) => safeDiv(fondoAmmDi(ctx), immobLordeDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Fondo ammortamento cumulato", value: fondoAmmDi(ctx) },
      { label: "Immobilizzazioni operative lorde", value: immobLordeDi(d, ctx) },
    ],
    formula: "Fondo ammortamento ÷ Immobilizzazioni lorde × 100",
    significato:
      "Quanta parte del costo storico degli impianti è già stata spesata a conto economico. Un grado elevato segnala una struttura invecchiata, prossima a richiedere un ciclo di rinnovo: è il contraltare del ROI che cresce da solo per effetto degli ammortamenti, e va letto insieme all'indice di sostituzione.",
    giudizio: sogliaDecrescente(0.4, 0.65, [
      "Struttura fortemente ammortizzata: rinnovo imminente e ROI contabilmente gonfiato",
      "Struttura di media anzianità",
      "Struttura recente o rinnovata di recente",
    ]),
  },
  {
    id: "vitaResidua",
    nome: "Vita utile residua",
    sub: "Immobilizzazioni nette / Ammortamenti",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp", "ce"],
    calc: (d) => safeDiv(d.sp.immobilizzazioniOperative, ammortamentiDi(d)),
    raw: (d) => [
      { label: "Immobilizzazioni operative nette", value: d.sp.immobilizzazioniOperative },
      { label: "Ammortamenti dell'esercizio", value: ammortamentiDi(d) },
    ],
    formula: "Immobilizzazioni nette ÷ Ammortamenti (anni)",
    significato:
      "Gli anni che, all'attuale ritmo di ammortamento, mancano all'esaurimento contabile del parco immobilizzazioni. Una vita residua breve accompagnata da un indice di sostituzione sotto 1 è il segnale anticipatore di un fabbisogno di investimento che il piano finanziario deve già prevedere.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v >= 8
        ? { level: "ok", testo: "Ampia vita utile residua" }
        : v >= 4
        ? { level: "warn", testo: "Vita utile residua intermedia: pianificare il ciclo di rinnovo" }
        : { level: "bad", testo: "Vita utile residua breve: fabbisogno di rinnovo imminente" },
  },
];

/* ── Blocco F · Rotazione del capitale circolante ──────────────────────────── */

const IND_CIRCOLANTE = [
  {
    id: "ccnc",
    nome: "Capitale circolante netto commerciale",
    sub: "Magazzino + crediti − debiti operativi correnti",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => d.sp.ccno,
    raw: (d) => [
      { label: "Magazzino", value: d.sp.rimanenze },
      { label: "Attività operative correnti", value: d.sp.attivitaOperativeCorrenti },
      { label: "Passività operative correnti", value: d.sp.passivitaOperativeCorrenti },
    ],
    formula: "CCNC = Magazzino + Attività op. correnti − Passività op. correnti",
    significato:
      "La quota di COIN assorbita dal ciclo commerciale. Un CCNC negativo significa che il ciclo si autofinanzia: l'impresa incassa dai clienti prima di pagare i fornitori, e i fornitori finanziano anche parte delle immobilizzazioni. È la condizione tipica della grande distribuzione e di chi vende su anticipo.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 0
        ? { level: "ok", testo: "Ciclo commerciale autofinanziato: il circolante libera cassa anziché assorbirla" }
        : { level: "info", testo: "Il ciclo commerciale assorbe capitale: verificarne la durata nei giorni" },
  },
  {
    id: "giorniScorte",
    nome: "Giorni di giacenza scorte",
    sub: "Magazzino / Costo del venduto × 360",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => {
      const r = safeDiv(d.sp.rimanenze, costoVendutoDi(d, ctx));
      return isNum(r) ? r * 360 : null;
    },
    raw: (d, ctx) => [
      { label: "Magazzino", value: d.sp.rimanenze },
      { label: "Costo del venduto", value: costoVendutoDi(d, ctx) },
    ],
    formula: "Magazzino ÷ Costo del venduto × 360",
    significato:
      "I giorni medi di permanenza delle scorte in magazzino, primo tratto del ciclo attivo. Attenzione a leggerlo meccanicamente: scorte alte non sono necessariamente un male, possono essere un accumulo deliberato per anticipare rincari delle materie prime o per sostenere una campagna di espansione commerciale già decisa.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 60
        ? { level: "ok", testo: "Rotazione del magazzino rapida" }
        : v <= 120
        ? { level: "warn", testo: "Giacenze di media durata" }
        : { level: "bad", testo: "Giacenze elevate: verificare se siano deliberate o segnalino invenduto" },
  },
  {
    id: "giorniCrediti",
    nome: "Giorni di incasso crediti",
    sub: "Crediti commerciali / Ricavi × 360",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => {
      const r = safeDiv(creditiCommDi(d, ctx), d.ce.ricavi);
      return isNum(r) ? r * 360 : null;
    },
    raw: (d, ctx) => [
      { label: "Crediti commerciali", value: creditiCommDi(d, ctx) },
      { label: "Ricavi", value: d.ce.ricavi },
      {
        label: perAnno(ctx, "creditiComm") === null ? "Fonte: attività operative correnti (proxy)" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Crediti commerciali ÷ Ricavi × 360",
    significato:
      "Il tempo medio di incasso, secondo tratto del ciclo attivo. In assenza di un dettaglio dei crediti nella riclassificazione, l'indice usa come proxy le attività operative correnti, che includono anche crediti tributari e altre poste: se il dettaglio è disponibile, inserirlo fra i parametri di Fase 1 rende la misura esatta.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 60
        ? { level: "ok", testo: "Incasso rapido" }
        : v <= 100
        ? { level: "warn", testo: "Tempi di incasso allungati" }
        : { level: "bad", testo: "Tempi di incasso critici: verificare la qualità del credito" },
  },
  {
    id: "giorniFornitori",
    nome: "Giorni di pagamento fornitori",
    sub: "Debiti commerciali / Costo del venduto × 360",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => {
      const r = safeDiv(debitiCommDi(d, ctx), costoVendutoDi(d, ctx));
      return isNum(r) ? r * 360 : null;
    },
    raw: (d, ctx) => [
      { label: "Debiti commerciali", value: debitiCommDi(d, ctx) },
      { label: "Costo del venduto", value: costoVendutoDi(d, ctx) },
      {
        label: perAnno(ctx, "debitiComm") === null ? "Fonte: passività operative correnti (proxy)" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Debiti commerciali ÷ Costo del venduto × 360",
    significato:
      "Il ciclo passivo: quanto l'impresa riesce a dilazionare i pagamenti, cioè quanto i fornitori ne finanziano il capitale circolante. Va letto con prudenza strategica: tirare troppo i tempi di pagamento comprime il COIN e migliora il ROI sulla carta, ma deteriora i rapporti di fornitura e si traduce in condizioni di acquisto peggiori, cioè in un ROS più basso.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v >= 90
        ? { level: "warn", testo: "Dilazioni molto lunghe: verificare la tenuta dei rapporti di fornitura" }
        : v >= 45
        ? { level: "ok", testo: "Dilazioni in linea con le prassi commerciali" }
        : { level: "warn", testo: "Dilazioni brevi: il ciclo commerciale è finanziato prevalentemente in proprio" },
  },
  {
    id: "cicloCircolante",
    nome: "Ciclo del circolante",
    sub: "Ciclo attivo − ciclo passivo",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => {
      const sc = safeDiv(d.sp.rimanenze, costoVendutoDi(d, ctx));
      const cr = safeDiv(creditiCommDi(d, ctx), d.ce.ricavi);
      const fo = safeDiv(debitiCommDi(d, ctx), costoVendutoDi(d, ctx));
      return isNum(sc) && isNum(cr) && isNum(fo) ? (sc + cr - fo) * 360 : null;
    },
    raw: (d, ctx) => {
      const sc = safeDiv(d.sp.rimanenze, costoVendutoDi(d, ctx));
      const cr = safeDiv(creditiCommDi(d, ctx), d.ce.ricavi);
      const fo = safeDiv(debitiCommDi(d, ctx), costoVendutoDi(d, ctx));
      return [
        { label: "Giorni scorte", value: isNum(sc) ? sc * 360 : null },
        { label: "Giorni crediti", value: isNum(cr) ? cr * 360 : null },
        { label: "Ciclo attivo", value: isNum(sc) && isNum(cr) ? (sc + cr) * 360 : null },
        { label: "Ciclo passivo (fornitori)", value: isNum(fo) ? fo * 360 : null },
      ];
    },
    formula: "(Giorni scorte + Giorni crediti) − Giorni fornitori",
    significato:
      "I giorni in cui l'impresa resta scoperta di cassa: il ciclo attivo misura quanto tempo passa fra l'acquisto e l'incasso, il ciclo passivo quanto i fornitori ne coprono. La differenza è il fabbisogno finanziario generato dalla gestione corrente, ed è il numero che si moltiplica per ogni euro di crescita del fatturato.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 0
        ? { level: "ok", testo: "Ciclo negativo: la gestione corrente genera cassa mentre cresce" }
        : v <= 60
        ? { level: "ok", testo: "Fabbisogno del circolante contenuto" }
        : v <= 120
        ? { level: "warn", testo: "Fabbisogno del circolante rilevante" }
        : { level: "bad", testo: "Fabbisogno del circolante molto elevato: la crescita assorbirà cassa in proporzione" },
  },
];

/* ── Blocco G · ROS, valore aggiunto e produttività del lavoro ─────────────── */

const IND_VALORE_AGGIUNTO = [
  {
    id: "incidenzaVa",
    nome: "Incidenza del valore aggiunto",
    sub: "Valore aggiunto / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d.ce.valoreAggiunto, d.ce.ricavi),
    raw: (d) => [
      { label: "Valore aggiunto", value: d.ce.valoreAggiunto },
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "Costi esterni assorbiti", value: sottraiStretto(d.ce.ricavi, d.ce.valoreAggiunto) },
    ],
    formula: "Valore aggiunto ÷ Ricavi × 100",
    significato:
      "Il valore aggiunto è il punto di incontro fra efficienza — non sprecare risorse acquistate all'esterno — ed efficacia — vendere a un buon prezzo. È anche la ricchezza lorda con cui l'impresa paga tutti: dipendenti, Stato, banche e soci. Un'incidenza in calo può significare perdita di potere di prezzo oppure una scelta deliberata di outsourcing: le due letture sono opposte e vanno distinte guardando i costi fissi.",
    giudizio: sogliaCrescente(0.2, 0.35, [
      "Valore aggiunto sottile: l'impresa trattiene poca ricchezza rispetto a quanto acquista all'esterno",
      "Incidenza intermedia",
      "Quota elevata di ricchezza trattenuta internamente",
    ]),
  },
  {
    id: "clup",
    nome: "CLUP",
    sub: "Costo del lavoro / Valore aggiunto",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d, ctx) => safeDiv(costoLavoroDi(d, ctx), d.ce.valoreAggiunto),
    raw: (d, ctx) => [
      { label: "Costo del lavoro", value: costoLavoroDi(d, ctx) },
      { label: "Valore aggiunto", value: d.ce.valoreAggiunto },
    ],
    formula: "Costo del lavoro ÷ Valore aggiunto × 100",
    significato:
      "Costo del lavoro per unità di ricchezza prodotta. Non è un indice da minimizzare in assoluto: un dipendente molto pagato è un ottimo affare se genera un valore aggiunto ancora maggiore, e il CLUP cattura esattamente questo rapporto. Nei conti economici riclassificati per funzione il costo del lavoro è spesso incorporato nel costo del venduto: se il valore risulta implausibilmente basso, va inserito a mano fra i parametri di Fase 1.",
    giudizio: sogliaDecrescente(0.55, 0.75, [
      "Costo del lavoro che assorbe quasi tutta la ricchezza prodotta",
      "Incidenza del lavoro elevata ma sostenibile",
      "Buon rapporto fra costo del lavoro e ricchezza generata",
    ]),
  },
  {
    id: "redditoAddetto",
    nome: "Valore aggiunto per addetto",
    sub: "Valore aggiunto / N. addetti",
    unit: "val",
    betterWhen: "up",
    moduli: ["ce"],
    richiede: (ctx) => (perAnno(ctx, "addetti") === null ? "Richiede il numero di addetti (Fase 1)" : null),
    calc: (d, ctx) => safeDiv(d.ce.valoreAggiunto, perAnno(ctx, "addetti")),
    raw: (d, ctx) => [
      { label: "Valore aggiunto", value: d.ce.valoreAggiunto },
      { label: "Numero di addetti", value: perAnno(ctx, "addetti") },
      { label: "MON per addetto", value: safeDiv(d.ce.mon, perAnno(ctx, "addetti")) },
      { label: "Ricavi per addetto", value: safeDiv(d.ce.ricavi, perAnno(ctx, "addetti")) },
    ],
    formula: "Valore aggiunto ÷ Numero di addetti",
    significato:
      "Il parametro moderno della produttività del lavoro: non guarda al dipendente come costo da comprimere ma come capitale intangibile da rendere più produttivo. La sua crescita nel tempo è uno dei driver che i mercati premiano con maggiore continuità, perché segnala che l'impresa sta scalando la catena del valore anziché competere sul prezzo del lavoro.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Inserire il numero di addetti per attivare l'indice" }
        : { level: "info", testo: "Da valutare nella dinamica temporale e nel confronto con i comparable, non in assoluto" },
  },
];

/* ── Blocco H · Struttura dei costi e rischio operativo ────────────────────── */

const IND_RISCHIO_OPERATIVO = [
  {
    id: "gloEmpirico",
    nome: "Leva operativa empirica",
    sub: "Δ% MON / Δ% Ricavi",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => {
      const m0 = ctx?.prec?.ce?.mon;
      const r0 = ctx?.prec?.ce?.ricavi;
      if (![d?.ce?.mon, m0, d?.ce?.ricavi, r0].every(isNum) || m0 === 0 || r0 === 0) return null;
      const dm = (d.ce.mon - m0) / Math.abs(m0);
      const dr = (d.ce.ricavi - r0) / Math.abs(r0);
      return dr === 0 ? null : dm / dr;
    },
    raw: (d, ctx) => [
      { label: "MON esercizio", value: d.ce.mon },
      { label: "MON esercizio precedente", value: ctx?.prec?.ce?.mon },
      { label: "Ricavi esercizio", value: d.ce.ricavi },
      { label: "Ricavi esercizio precedente", value: ctx?.prec?.ce?.ricavi },
    ],
    formula: "(ΔMON ÷ MON₀) ÷ (ΔRicavi ÷ Ricavi₀)",
    significato:
      "La leva operativa misurata sui fatti anziché sulla struttura teorica dei costi: di quante volte il reddito operativo si è mosso rispetto al fatturato. Un valore alto conferma una struttura a forte incidenza di costi fissi, quindi molto scalabile in espansione e molto fragile in contrazione. Va letto su più esercizi, perché una singola coppia può essere distorta da componenti straordinarie.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v < 0
        ? { level: "warn", testo: "Reddito e ricavi si sono mossi in direzioni opposte: leva non interpretabile su questa coppia" }
        : v <= 1.5
        ? { level: "ok", testo: "Struttura elastica: il reddito segue i volumi senza amplificarli" }
        : v <= 3
        ? { level: "warn", testo: "Leva operativa apprezzabile: rischio e scalabilità entrambi significativi" }
        : { level: "bad", testo: "Leva operativa molto alta: una flessione modesta dei ricavi comprime drasticamente il reddito" },
  },
  {
    id: "gloStrutturale",
    nome: "Grado di leva operativa",
    sub: "Margine di contribuzione / MON",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce"],
    richiede: (ctx) => (perAnno(ctx, "quotaVariabile") === null ? "Richiede la quota di costi variabili (Fase 1)" : null),
    calc: (d, ctx) => safeDiv(mdcDi(d, ctx), d.ce.mon),
    raw: (d, ctx) => [
      { label: "Ricavi", value: d.ce.ricavi },
      { label: "Costi variabili", value: costiVariabiliDi(d, ctx) },
      { label: "Margine di contribuzione", value: mdcDi(d, ctx) },
      { label: "Costi fissi", value: costiFissiDi(d, ctx) },
      { label: "MON", value: d.ce.mon },
    ],
    formula: "Margine di contribuzione ÷ MON",
    significato:
      "Il grado di leva operativa costruito sulla struttura dei costi: quanto il rischio di mercato — la volatilità delle vendite — viene amplificato dall'incidenza dei costi fissi prima di arrivare al reddito operativo. È il ponte fra rischio commerciale e rischio operativo, e alimenta la depurazione del beta nel blocco successivo.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Inserire la quota di costi variabili per attivare l'indice" }
        : v <= 1.5
        ? { level: "ok", testo: "Struttura prevalentemente variabile: rischio operativo contenuto" }
        : v <= 3
        ? { level: "warn", testo: "Incidenza dei costi fissi significativa" }
        : { level: "bad", testo: "Struttura fortemente rigida: elevata esposizione a cali di volume" },
  },
  {
    id: "bep",
    nome: "Punto di pareggio",
    sub: "Costi fissi / Margine di contribuzione %",
    unit: "val",
    betterWhen: "down",
    moduli: ["ce"],
    richiede: (ctx) => (perAnno(ctx, "quotaVariabile") === null ? "Richiede la quota di costi variabili (Fase 1)" : null),
    calc: (d, ctx) => {
      const mdcPct = safeDiv(mdcDi(d, ctx), d.ce.ricavi);
      return safeDiv(costiFissiDi(d, ctx), mdcPct);
    },
    raw: (d, ctx) => [
      { label: "Costi fissi", value: costiFissiDi(d, ctx) },
      { label: "Margine di contribuzione %", value: isNum(safeDiv(mdcDi(d, ctx), d.ce.ricavi)) ? safeDiv(mdcDi(d, ctx), d.ce.ricavi) * 100 : null },
      { label: "Ricavi effettivi", value: d.ce.ricavi },
    ],
    formula: "Costi fissi ÷ (Margine di contribuzione ÷ Ricavi)",
    significato:
      "Il fatturato al quale il reddito operativo si azzera. Sopra quel livello ogni euro di vendita aggiuntivo contribuisce al reddito nella misura del margine di contribuzione unitario; sotto, ogni euro mancante lo erode nella stessa misura.",
    giudizio: (v) =>
      !isNum(v) ? { level: "info", testo: "Inserire la quota di costi variabili per attivare l'indice" } : { level: "info", testo: "Da leggere insieme al margine di sicurezza" },
  },
  {
    id: "margineSicurezza",
    nome: "Margine di sicurezza",
    sub: "(Ricavi − BEP) / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    richiede: (ctx) => (perAnno(ctx, "quotaVariabile") === null ? "Richiede la quota di costi variabili (Fase 1)" : null),
    calc: (d, ctx) => {
      const mdcPct = safeDiv(mdcDi(d, ctx), d.ce.ricavi);
      const bep = safeDiv(costiFissiDi(d, ctx), mdcPct);
      return isNum(bep) && isNum(d.ce.ricavi) && d.ce.ricavi !== 0 ? (d.ce.ricavi - bep) / d.ce.ricavi : null;
    },
    raw: (d, ctx) => {
      const mdcPct = safeDiv(mdcDi(d, ctx), d.ce.ricavi);
      const bep = safeDiv(costiFissiDi(d, ctx), mdcPct);
      return [
        { label: "Ricavi effettivi", value: d.ce.ricavi },
        { label: "Punto di pareggio", value: bep },
        { label: "Distanza dal pareggio", value: sottraiStretto(d.ce.ricavi, bep) },
      ];
    },
    formula: "(Ricavi − Punto di pareggio) ÷ Ricavi × 100",
    significato:
      "Di quanto possono cadere le vendite prima che l'impresa entri in perdita operativa. Le aziende ad alta leva operativa hanno un margine di sicurezza ristretto: bastano flessioni modeste per finire sotto il pareggio. È il rovescio della medaglia della scalabilità.",
    giudizio: sogliaCrescente(0.15, 0.3, [
      "Margine di sicurezza sottile: l'impresa è vicina al punto di pareggio",
      "Margine di sicurezza intermedio",
      "Ampio margine prima del pareggio operativo",
    ]),
  },
];

/* ── Sezione 2 · Solvibilità ───────────────────────────────────────────────── */

const IND_SOLVIBILITA = [
  {
    id: "leverage",
    nome: "Leverage (Debt/Equity)",
    sub: "PFN / Patrimonio Netto",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.pfn, d.sp.patrimonioNetto),
    raw: (d) => [
      { label: "Posizione Finanziaria Netta", value: d.sp.pfn },
      { label: "Patrimonio Netto", value: d.sp.patrimonioNetto },
    ],
    formula: "PFN ÷ Patrimonio Netto",
    significato:
      "Rapporto fra debito finanziario netto e mezzi propri: dice quanti euro di debito gravano su ogni euro di capitale di rischio. Un valore negativo indica cassa netta positiva (più liquidità che debito). Oltre 2x la struttura diventa fragile e le banche irrigidiscono i covenant.",
    giudizio: sogliaDecrescente(1, 2, [
      "Struttura finanziaria squilibrata verso il debito",
      "Indebitamento sostenibile ma da monitorare",
      "Struttura patrimoniale equilibrata",
    ]),
  },
  {
    id: "pfnEbitda",
    nome: "PFN / EBITDA",
    sub: "Anni teorici di rimborso",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d) => safeDiv(d.sp.pfn, d.ce.ebitda),
    raw: (d) => [
      { label: "Posizione Finanziaria Netta", value: d.sp.pfn },
      { label: "EBITDA", value: d.ce.ebitda },
    ],
    formula: "PFN ÷ EBITDA",
    significato:
      "Quanti esercizi di margine operativo lordo servirebbero, a parità di condizioni, per azzerare il debito netto. È il covenant bancario più diffuso in assoluto: sopra 3,5–4x l'accesso a nuova finanza si restringe rapidamente. Sotto zero significa cassa netta.",
    giudizio: sogliaDecrescente(2, 3.5, [
      "Debito netto elevato rispetto alla generazione di margine",
      "Livello di indebitamento nella fascia di attenzione dei covenant",
      "Debito netto ampiamente coperto dalla redditività operativa",
    ]),
  },
  {
    id: "interestCoverage",
    nome: "Interest Coverage Ratio",
    sub: "EBIT / Oneri Finanziari",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d.ce.ebit, d.ce.oneriFinanziari),
    raw: (d) => [
      { label: "EBIT", value: d.ce.ebit },
      { label: "Oneri Finanziari (classe ONERI_FIN)", value: d.ce.oneriFinanziari },
    ],
    formula: "EBIT ÷ Oneri Finanziari",
    significato:
      "Quante volte il reddito operativo copre il costo del debito. È il termometro immediato del rischio di default: sotto 2x un rialzo dei tassi o una flessione dei margini basta a mettere in tensione il servizio del debito, sopra 5x l'azienda ha margine di manovra. Gli oneri sono presi al lordo dei proventi finanziari, sommando le voci di classe ONERI_FIN del CE riclassificato.",
    giudizio: sogliaCrescente(2, 5, [
      "Copertura degli oneri finanziari critica",
      "Copertura sufficiente ma sensibile a rialzi dei tassi",
      "Ampia capacità di far fronte al costo del debito",
    ]),
  },
  {
    id: "currentRatio",
    nome: "Current Ratio",
    sub: "Attivo Circolante / Passivo Corrente",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.attivoCircolante, d.sp.passivoCorrente),
    raw: (d) => [
      { label: "Attivo Circolante", value: d.sp.attivoCircolante },
      { label: "Passivo Corrente", value: d.sp.passivoCorrente },
    ],
    formula: "Attivo Circolante ÷ Passivo Corrente",
    significato:
      "Indice di liquidità corrente: verifica se le attività che si monetizzano entro dodici mesi bastano a coprire le passività in scadenza nello stesso arco. Sotto 1 l'azienda finanzia l'attivo immobilizzato con debito a breve, condizione classica di squilibrio delle fonti. L'attivo circolante è ricostruito come attività operative correnti + magazzino + liquidità + attività finanziarie; il passivo corrente come passività operative correnti + debiti finanziari a breve.",
    giudizio: sogliaCrescente(1, 1.5, [
      "Squilibrio fra fonti a breve e impieghi correnti",
      "Equilibrio corrente sottile, poco margine di sicurezza",
      "Buon equilibrio fra impieghi e fonti a breve termine",
    ]),
  },
  {
    id: "quickRatio",
    nome: "Quick Ratio",
    sub: "(Attivo Circolante − Rimanenze) / Passivo Corrente",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(sottrai(d.sp.attivoCircolante, d.sp.rimanenze), d.sp.passivoCorrente),
    raw: (d) => [
      { label: "Attivo Circolante", value: d.sp.attivoCircolante },
      { label: "Rimanenze", value: d.sp.rimanenze },
      { label: "Passivo Corrente", value: d.sp.passivoCorrente },
    ],
    formula: "(Attivo Circolante − Rimanenze) ÷ Passivo Corrente",
    significato:
      "Detto anche acid test: ripete la verifica di liquidità escludendo il magazzino, la posta meno prontamente liquidabile e la più esposta a svalutazioni. Il divario rispetto al Current Ratio misura quanto l'equilibrio corrente dipenda dallo smobilizzo delle scorte.",
    giudizio: sogliaCrescente(0.7, 1, [
      "Liquidità immediata insufficiente senza smobilizzo del magazzino",
      "Copertura quasi integrale delle passività correnti",
      "Passività correnti coperte senza ricorrere alle rimanenze",
    ]),
  },
  {
    id: "dscr",
    nome: "Debt Service Coverage",
    sub: "FCFO / Servizio del Debito",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf"],
    calc: (d) => safeDiv(d.rf.fcfo, Math.abs(d.rf.servizioDelDebito ?? NaN)),
    raw: (d) => [
      { label: "FCFO (free cash flow operativo)", value: d.rf.fcfo },
      { label: "Servizio del Debito", value: d.rf.servizioDelDebito },
    ],
    formula: "FCFO ÷ |Servizio del Debito|",
    significato:
      "L'unico indice di solvibilità costruito su flussi di cassa effettivi anziché su saldi contabili: confronta la cassa che la gestione operativa lascia libera dopo gli investimenti con quella assorbita da rimborsi e interessi nell'esercizio. Sotto 1 l'azienda ha rimborsato il debito attingendo a cassa preesistente o a nuova raccolta, non alla propria generazione di cassa.",
    giudizio: sogliaCrescente(1.1, 1.5, [
      "Il servizio del debito non è coperto dalla cassa generata nell'esercizio",
      "Copertura del servizio del debito appena sufficiente",
      "Il servizio del debito è ampiamente coperto dai flussi operativi",
    ]),
  },
];

/* ── Sezione 3 · Redditività Netta ─────────────────────────────────────────── */

const IND_REDDITIVITA_NETTA = [
  {
    id: "roe",
    nome: "ROE",
    sub: "Utile Netto / Patrimonio Netto",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d.ce.utileNetto, d.sp.patrimonioNetto),
    raw: (d) => [
      { label: "Utile Netto", value: d.ce.utileNetto },
      { label: "Patrimonio Netto", value: d.sp.patrimonioNetto },
    ],
    formula: "Utile Netto ÷ Patrimonio Netto × 100",
    significato:
      "Return On Equity: rendimento contabile del capitale di rischio, il numero che interessa direttamente il socio. Va letto insieme al leverage: un ROE alto ottenuto con un patrimonio netto sottile non è forza reddituale ma rischio finanziario travestito da performance.",
    giudizio: sogliaCrescente(0.04, 0.1, [
      "Remunerazione del capitale proprio inferiore ad alternative prive di rischio",
      "ROE positivo ma con premio al rischio contenuto",
      "Capitale di rischio remunerato in modo soddisfacente",
    ]),
  },
  {
    id: "netMargin",
    nome: "Net Profit Margin",
    sub: "Utile Netto / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d.ce.utileNetto, d.ce.ricavi),
    raw: (d) => [
      { label: "Utile Netto", value: d.ce.utileNetto },
      { label: "Ricavi", value: d.ce.ricavi },
    ],
    formula: "Utile Netto ÷ Ricavi × 100",
    significato:
      "Quanto di ogni euro fatturato arriva effettivamente a fondo conto economico, dopo ammortamenti, gestione finanziaria, componenti non correnti e imposte. Confrontato con l'EBIT Margin quantifica esattamente quanto margine operativo viene assorbito da banche e fisco.",
    giudizio: sogliaCrescente(0.02, 0.05, [
      "Utile residuale: il margine operativo viene quasi interamente assorbito",
      "Redditività netta modesta ma positiva",
      "Buona conversione del fatturato in utile netto",
    ]),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-quater. SOLIDITÀ PATRIMONIALE — GRANDEZZE DERIVATE
   ═══════════════════════════════════════════════════════════════════════════
   L'analisi di solvibilità incrocia due letture dello stesso Stato
   Patrimoniale: una VERTICALE, che pesa ogni aggregato sul Capitale Investito
   Netto (composizione), e una ORIZZONTALE, che confronta categorie di
   investimenti con categorie di finanziamenti (correlazione). Le grandezze
   qui sotto servono alla seconda, che ha bisogno di scomporre l'attivo
   immobilizzato e di rettificare il capitale netto contabile.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Attività immateriali: dal riconoscimento per nome, o sovrascritte a mano. */
const immaterialiDi = (d, ctx) => perAnno(ctx, "immateriali") ?? (isNum(d?.sp?.immateriali) ? d.sp.immateriali : null);

/** Partecipazioni non liquide (rischio di leva azionaria delle holding). */
const partecipazioniDi = (d, ctx) =>
  perAnno(ctx, "partecipazioni") ?? (isNum(d?.sp?.partecipazioni) ? d.sp.partecipazioni : null);

/** Immobilizzazioni tecniche (PP&E), denominatore del margine di struttura primario. */
const ppeDi = (d, ctx) => perAnno(ctx, "ppe") ?? (isNum(d?.sp?.ppe) ? d.sp.ppe : null);

/**
 * Capitale netto RETTIFICATO in via precauzionale: dal patrimonio netto
 * contabile si tolgono le poste fittizie — crediti verso soci per versamenti
 * ancora dovuti e azioni proprie — che figurano all'attivo ma non
 * rappresentano ricchezza disponibile a garanzia dei terzi.
 * Senza rettifiche indicate a mano coincide con il patrimonio netto contabile.
 */
const capitaleNettoRettificatoDi = (d, ctx) => {
  const pn = d?.sp?.patrimonioNetto;
  if (!isNum(pn)) return null;
  const soci = perAnno(ctx, "creditiSoci") || 0;
  const proprie = perAnno(ctx, "azioniProprie") || 0;
  return pn - Math.abs(soci) - Math.abs(proprie);
};

/**
 * Indebitamento finanziario netto RETTIFICATO: alla PFN si aggiungono le
 * passività potenziali che l'analista ritiene non accantonate (contenziosi,
 * garanzie prestate). È l'altra metà della prudenza: sottrarre all'equity ciò
 * che è fittizio, e sommare al debito ciò che è taciuto.
 */
const debitoNettoRettificatoDi = (d, ctx) => {
  const pfn = d?.sp?.pfn;
  if (!isNum(pfn)) return null;
  const potenziali = perAnno(ctx, "passivitaPotenziali") || 0;
  return pfn + Math.abs(potenziali);
};

/** Posizione finanziaria netta a breve = PFN totale − debito finanziario a m/l. */
const pfnCorrenteDi = (d) => {
  if (isNum(d?.sp?.pfnBreve)) return d.sp.pfnBreve;
  return isNum(d?.sp?.pfn) && isNum(d?.sp?.debitiFinanziariLungo) ? d.sp.pfn - d.sp.debitiFinanziariLungo : null;
};

/** Etichetta della zona di autonomia patrimoniale (soglie dottrinali). */
const ZONE_AUTONOMIA = [
  { fino: 0.335, id: "rischio", nome: "Zona di rischio", level: "bad", colore: RED },
  { fino: 0.505, id: "sorveglianza", nome: "Zona di sorveglianza", level: "warn", colore: AMBER },
  { fino: 0.665, id: "normalita", nome: "Zona di normalità", level: "ok", colore: GREEN },
  { fino: 1.01, id: "crescita", nome: "Zona di crescita", level: "info", colore: BLUE },
];

const zonaAutonomia = (v) => (isNum(v) ? ZONE_AUTONOMIA.find((z) => v < z.fino) || ZONE_AUTONOMIA[3] : null);

/** Giudizio a quattro zone per l'indice di autonomia patrimoniale. */
const giudizioAutonomia = (v) => {
  const z = zonaAutonomia(v);
  if (!z) return { level: "info", testo: "Dato non disponibile." };
  const testi = {
    rischio:
      "Sotto un terzo del capitale investito: in ipotesi di liquidazione le falcidie sui valori contabili dell'attivo assorbirebbero l'intero cuscinetto dei mezzi propri e intaccherebbero il debito. Il capitale di credito finisce per sopportare il rischio tipico del capitale proprio.",
    sorveglianza:
      "Mezzi propri fra un terzo e la metà del capitale investito: la struttura regge, ma il margine rispetto alla soglia prudenziale è sottile e va sorvegliato a ogni nuovo investimento finanziato a debito.",
    normalita:
      "Capitale netto oltre la metà del capitale investito: struttura equilibrata, con un cuscinetto capiente rispetto alle perdite fisiologiche di liquidazione.",
    crescita:
      "Oltre due terzi di mezzi propri. Solidità fuori discussione, ma un'autonomia così alta può segnalare capitale immobilizzato senza impiego redditizio: da leggere insieme al ROE e allo spread ROI−WACC prima di chiamarla una virtù.",
  };
  return { level: z.level, testo: testi[z.id] };
};

/* ── Indici di composizione · analisi verticale (tutto ÷ CIN) ────────────── */

/** Descrive senza classificare: la composizione non è di per sé buona o cattiva. */
const descrittivo = (testo) => () => ({ level: "info", testo });

const IND_COMPOSIZIONE_IMPIEGHI = [
  {
    id: "pesoCcn",
    nome: "Peso del circolante netto",
    sub: "CCNc / CIN — grado di elasticità",
    unit: "pct",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.ccno, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Capitale circolante netto commerciale", value: d.sp.ccno },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "CCNc ÷ CIN × 100",
    significato:
      "Quanta parte del capitale investito è assorbita dal circolante commerciale. Più l'incidenza è alta, più la struttura è elastica e, in linea teorica, riconvertibile in caso di mutamenti del mercato. Un valore negativo non è un difetto: significa che fornitori e acconti finanziano l'intero ciclo commerciale e liberano capitale, la condizione tipica di chi incassa prima di pagare.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v < 0
        ? {
            level: "ok",
            testo:
              "Circolante negativo: il ciclo commerciale non assorbe capitale, lo genera. I fornitori finanziano magazzino e crediti, e il capitale investito ne risulta alleggerito.",
          }
        : v > 0.4
        ? {
            level: "warn",
            testo:
              "Oltre due quinti del capitale investito è bloccato nel circolante: struttura molto elastica ma esposta, perché ogni euro di crescita del fatturato ne richiede altrettanti di finanziamento.",
          }
        : {
            level: "info",
            testo: "Incidenza del circolante nella norma: la struttura non è né rigida né particolarmente assorbente.",
          },
  },
  {
    id: "pesoImmobilizzazioni",
    nome: "Peso delle immobilizzazioni operative",
    sub: "Immobilizzazioni / CIN — grado di rigidità",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.immobilizzazioniOperative, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Immobilizzazioni operative", value: d.sp.immobilizzazioniOperative },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Immobilizzazioni operative ÷ CIN × 100",
    significato:
      "L'incidenza degli investimenti strutturali misura la rigidità della struttura patrimoniale: capitale vincolato per anni, che si riconverte in cassa solo lentamente attraverso gli ammortamenti. Alta rigidità significa alte barriere all'uscita e forte leva operativa, quindi utili amplificati nelle fasi espansive e perdite amplificate in quelle recessive.",
    giudizio: descrittivo(
      "Va letto contro il settore, non contro una soglia: un'utility è rigida per costruzione, un distributore è elastico per costruzione. Il segnale è la variazione nel tempo a parità di comparto."
    ),
  },
  {
    id: "pesoInvestimentiFinanziari",
    nome: "Peso degli investimenti finanziari",
    sub: "Investimenti finanziari / CIN",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.investimentiFinanziari, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Investimenti finanziari (liquidità e att. fin.)", value: d.sp.investimentiFinanziari },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Investimenti finanziari ÷ CIN × 100",
    significato:
      "Quota del capitale investito parcheggiata in liquidità e attività finanziarie invece che nel business. È la riserva di flessibilità dell'impresa, ma è anche capitale che rende il tasso di mercato invece del ROI operativo: un'incidenza elevata e persistente diluisce il rendimento complessivo e va giustificata da un piano di impieghi. Nota di schema: nella riclassificazione a posizione finanziaria netta questi importi non figurano fra gli impieghi ma sono già portati in detrazione del debito, sul lato delle fonti — il rapporto resta significativo, ma non è uno strato della pila degli investimenti.",
    giudizio: descrittivo(
      "Un peso elevato non è un difetto in sé: può essere tesoreria di guerra in attesa di un'acquisizione. Diventa un problema quando resta immobile per più esercizi mentre il rendimento del CIN totale scende sotto il ROI operativo."
    ),
  },
];

const IND_COMPOSIZIONE_FONTI = [
  {
    id: "pesoEquity",
    nome: "Peso del capitale netto",
    sub: "Capitale Netto / CIN",
    unit: "pct",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.patrimonioNetto, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Patrimonio Netto", value: d.sp.patrimonioNetto },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Capitale Netto ÷ CIN × 100",
    significato:
      "L'incidenza dei mezzi propri sul totale delle fonti. È la stessa grandezza dell'indice di autonomia patrimoniale, letta qui come tassello della composizione: quanta parte del capitale investito non ha scadenza di rimborso e non genera rischio di insolvenza.",
    giudizio: giudizioAutonomia,
  },
  {
    id: "pesoDebitoMl",
    nome: "Peso del debito a medio-lungo",
    sub: "Debiti finanziari m/l / CIN",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => safeDiv(d.sp.debitiFinanziariLungo, d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Debiti finanziari a medio-lungo termine", value: d.sp.debitiFinanziariLungo },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Debiti finanziari m/l ÷ CIN × 100",
    significato:
      "La quota di fonti stabile ma onerosa. Il debito strutturato riduce il rischio di liquidità — non va rimborsato domani — ma irrigidisce il conto economico e, se contratto a tasso fisso in una fase di tassi calanti, penalizza la redditività per tutta la durata del piano di ammortamento.",
    giudizio: descrittivo(
      "La convenienza a sbilanciare la struttura verso il medio-lungo dipende dalle attese sui tassi, non da una soglia: fissare oggi un costo alto per dieci anni è prudente sul rischio di liquidità e costoso sulla redditività."
    ),
  },
  {
    id: "pesoPfnCorrente",
    nome: "Peso della posizione finanziaria a breve",
    sub: "PFN corrente / CIN",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => safeDiv(pfnCorrenteDi(d), d.sp.capitaleInvestitoNetto),
    raw: (d) => [
      { label: "Posizione finanziaria netta a breve", value: pfnCorrenteDi(d) },
      { label: "   di cui debiti finanziari correnti", value: d.sp.debitiFinanziariBreve },
      { label: "   di cui liquidità e att. finanziarie", value: d.sp.investimentiFinanziari },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "(Debiti fin. correnti − Liquidità) ÷ CIN × 100",
    significato:
      "La componente più mobile della struttura finanziaria. Un valore negativo indica che la liquidità supera il debito a breve: l'impresa è creditrice netta sull'orizzonte corrente. Un valore positivo elevato è la configurazione aggressiva — costo del denaro più basso, ma esposizione piena al rinnovo degli affidamenti.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v < 0
        ? {
            level: "ok",
            testo:
              "Posizione a breve creditoria: la liquidità eccede il debito corrente. Nessuna dipendenza dal rinnovo degli affidamenti bancari nel breve periodo.",
          }
        : v > 0.25
        ? {
            level: "warn",
            testo:
              "Oltre un quarto del capitale investito poggia su debito a breve netto: struttura aggressiva, che scommette sulla continuità del credito bancario e sulla stabilità dei tassi.",
          }
        : { level: "info", testo: "Esposizione a breve contenuta rispetto al capitale investito." },
  },
];

/* ── Grado di indebitamento e rischio di liquidazione ────────────────────── */

const IND_INDEBITAMENTO = [
  {
    id: "autonomiaPatrimoniale",
    nome: "Indice di autonomia patrimoniale",
    sub: "Capitale Netto / CIN — soglia prudenziale 1/3",
    unit: "pct",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(capitaleNettoRettificatoDi(d, ctx), d.sp.capitaleInvestitoNetto),
    raw: (d, ctx) => [
      { label: "Patrimonio Netto contabile", value: d.sp.patrimonioNetto },
      { label: "   − crediti verso soci", value: perAnno(ctx, "creditiSoci") },
      { label: "   − azioni proprie", value: perAnno(ctx, "azioniProprie") },
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
    ],
    formula: "Capitale Netto rettificato ÷ CIN × 100",
    significato:
      "Il grado di indipendenza dai terzi. La soglia di attenzione di un terzo non è convenzionale: nasce dall'ipotesi di liquidazione. I valori contabili dell'attivo sono estratti da una logica di azienda in funzionamento e, liquidati, subiscono falcidie stimabili attorno a un terzo. Se i mezzi propri non arrivano a coprire quella perdita, le falcidie intaccano il debito e i creditori restano insoddisfatti.",
    giudizio: giudizioAutonomia,
  },
  {
    id: "financialLeverage",
    nome: "Financial leverage (gearing)",
    sub: "CIN / Capitale Netto — reciproco dell'autonomia",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(d.sp.capitaleInvestitoNetto, capitaleNettoRettificatoDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Capitale Investito Netto", value: d.sp.capitaleInvestitoNetto },
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
    ],
    formula: "CIN ÷ Capitale Netto",
    significato:
      "Quante volte il capitale investito supera i mezzi propri: è l'esatto reciproco dell'autonomia patrimoniale, e più cresce più aumenta la dipendenza dai terzi. Alla soglia prudenziale di un terzo di mezzi propri corrisponde un gearing di 3.",
    giudizio: sogliaDecrescente(2, 3, [
      "Capitale investito oltre il triplo dei mezzi propri: dipendenza dai terzi oltre la soglia prudenziale",
      "Gearing nella fascia di sorveglianza",
      "Capitale investito coperto in larga parte da mezzi propri",
    ]),
  },
  {
    id: "debtEquityStrutturale",
    nome: "Debt / Equity strutturale",
    sub: "Debiti finanziari netti / Capitale Netto — limite 2",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(debitoNettoRettificatoDi(d, ctx), capitaleNettoRettificatoDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Posizione Finanziaria Netta", value: d.sp.pfn },
      { label: "   + passività potenziali non accantonate", value: perAnno(ctx, "passivitaPotenziali") },
      { label: "Debito netto rettificato", value: debitoNettoRettificatoDi(d, ctx) },
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
    ],
    formula: "Debiti finanziari netti ÷ Capitale Netto",
    significato:
      "Il rapporto di rischio in forma diretta. Se il limite prudenziale dei mezzi propri è un terzo del capitale investito, i restanti due terzi sono debito: il rapporto estremo si attesta quindi su 2. I debiti non dovrebbero mai superare il doppio dei mezzi propri — oltre quel punto il rischio di perdita del creditore si impenna, perché non resta cuscinetto fra le falcidie di liquidazione e il capitale prestato.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v < 0
        ? {
            level: "ok",
            testo:
              "Debito netto negativo: la liquidità supera l'indebitamento finanziario. Il rapporto perde significato segnaletico — non c'è leva da misurare.",
          }
        : v > 2
        ? {
            level: "bad",
            testo:
              "Oltre il limite prudenziale di 2: superata la soglia dei due terzi di debito sul capitale investito, il rischio di perdita del creditore cresce in modo esponenziale e il capitale di credito assume di fatto il rischio del capitale proprio.",
          }
        : v > 1
        ? {
            level: "warn",
            testo: "Debito superiore ai mezzi propri ma entro il limite di 2: fascia di sorveglianza.",
          }
        : { level: "ok", testo: "Debito netto inferiore ai mezzi propri: struttura conservativa." },
  },
];

/* ── Indici di correlazione · analisi orizzontale ─────────────────────────── */

const IND_CORRELAZIONE = [
  {
    id: "capitaleRischioNetto",
    nome: "Capitale di rischio netto",
    sub: "Capitale Netto − Partecipazioni",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => {
      const cn = capitaleNettoRettificatoDi(d, ctx);
      const p = partecipazioniDi(d, ctx);
      return isNum(cn) ? cn - (p || 0) : null;
    },
    raw: (d, ctx) => [
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      // Nessuna partecipazione riconosciuta significa zero, non «dato mancante»:
      // il margine coincide allora con il capitale netto, ed è corretto così.
      { label: "Partecipazioni non liquide", value: partecipazioniDi(d, ctx) ?? 0 },
    ],
    formula: "Capitale Netto − Partecipazioni non liquide",
    significato:
      "Primo strato della sbucciatura. Misura il rischio di leva azionaria, tipico delle holding: il capitale netto serve a garantire l'azienda, ma se viene impiegato per comprare partecipazioni in società terze — a loro volta magari indebitate — i creditori della capogruppo finiscono per garantire involontariamente operazioni di società fuori dal loro controllo. Un valore negativo è un campanello d'allarme forte per il creditore primario.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v < 0
        ? {
            level: "bad",
            testo:
              "Le partecipazioni assorbono più dell'intero capitale netto: la garanzia dei creditori dipende da società che non controllano e di cui non leggono i bilanci.",
          }
        : { level: "ok", testo: "Il capitale netto resta capiente al netto delle partecipazioni." },
  },
  {
    id: "capitaleNettoTangibile",
    nome: "Capitale netto tangibile",
    sub: "Capitale Netto − Attività immateriali",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => {
      const cn = capitaleNettoRettificatoDi(d, ctx);
      const i = immaterialiDi(d, ctx);
      return isNum(cn) && isNum(i) ? cn - i : null;
    },
    raw: (d, ctx) => [
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      { label: "Attività immateriali (avviamento inclusi)", value: immaterialiDi(d, ctx) },
    ],
    formula: "Capitale Netto − Attività Immateriali",
    significato:
      "Secondo strato. Per estrema prudenza l'analista sconta a zero avviamento, oneri pluriennali e spesso anche brevetti e R&S troppo specifici: sono asset esposti a obsolescenza rapida e, fuori dal contesto aziendale in cui sono nati, privi di mercato e di valore di liquidazione. Se il capitale netto depurato di queste voci risulta negativo, l'impresa poggia su basi fragilissime.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v < 0
        ? {
            level: "bad",
            testo:
              "Capitale netto tangibile negativo: tolti gli immateriali non resta patrimonio. In liquidazione non ci sarebbe nulla da distribuire ai creditori oltre l'attivo materiale già impegnato.",
          }
        : { level: "ok", testo: "Il patrimonio resta positivo anche azzerando integralmente gli immateriali." },
    richiede: () => "Richiede le attività immateriali: non riconosciute nei moduli, indicale nei parametri per esercizio.",
  },
  {
    id: "margineStruttura",
    nome: "Margine di struttura primario",
    sub: "Capitale Netto − Immobilizzazioni tecniche",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => {
      const cn = capitaleNettoRettificatoDi(d, ctx);
      const p = ppeDi(d, ctx);
      return isNum(cn) && isNum(p) ? cn - p : null;
    },
    raw: (d, ctx) => [
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      { label: "Immobilizzazioni tecniche (PP&E)", value: ppeDi(d, ctx) },
    ],
    formula: "Capitale Netto − PP&E",
    significato:
      "Terzo strato, il più citato. Le immobilizzazioni tecniche restano vincolate per anni e si traducono in cassa solo lentamente, tramite gli ammortamenti: la fonte coerente è il capitale netto, l'unica che non impone scadenze di rimborso. Autocostruire gli impianti con mezzi propri garantisce indipendenza — il flusso degli ammortamenti resta in azienda e finanzia il rinnovo, invece di essere drenato dalle banche.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dato non disponibile." }
        : v >= 0
        ? {
            level: "ok",
            testo:
              "Le immobilizzazioni tecniche sono interamente coperte dai mezzi propri: il rinnovo della struttura non dipende dalle strette creditizie del mercato.",
          }
        : {
            level: "warn",
            testo:
              "Parte degli impianti è finanziata a debito. Il rischio dipende dalla scadenza: con debito a breve è imminente — si rimborsano rapidamente prestiti con beni che diventano cassa in decenni — e l'unica via d'uscita è sostituire il passivo con nuovo debito. Con debito a medio-lungo è mitigato ma non nullo: l'obsolescenza anticipata azzererebbe i ricavi che servono a pagare la rata.",
          },
    richiede: () => "Richiede le immobilizzazioni tecniche: non riconosciute nei moduli, indicale nei parametri per esercizio.",
  },
  {
    id: "indiceCoperturaPpe",
    nome: "Indice di copertura delle immobilizzazioni tecniche",
    sub: "Capitale Netto / PP&E — soglia 1",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(capitaleNettoRettificatoDi(d, ctx), ppeDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      { label: "Immobilizzazioni tecniche (PP&E)", value: ppeDi(d, ctx) },
    ],
    formula: "Capitale Netto ÷ PP&E",
    significato:
      "Lo stesso confronto del margine di struttura, espresso in forma di quoziente per renderlo confrontabile fra imprese di dimensioni diverse. Deve idealmente assumere valori superiori a 1: sotto 1 una parte delle immobilizzazioni materiali è finanziata dal debito.",
    giudizio: sogliaCrescente(0.7, 1, [
      "Larga parte degli impianti finanziata a debito",
      "Copertura quasi integrale, ma ancora sotto la soglia di 1",
      "Immobilizzazioni tecniche coperte dai soli mezzi propri",
    ]),
    richiede: () => "Richiede le immobilizzazioni tecniche: indicale nei parametri per esercizio.",
  },
  {
    id: "coperturaGenerale",
    nome: "Tasso di copertura generale",
    sub: "(Capitale Netto + Debiti m/l) / Immobilizzazioni — soglia 1",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) =>
      safeDiv(somma(capitaleNettoRettificatoDi(d, ctx), d.sp.debitiFinanziariLungo), d.sp.immobilizzazioniOperative),
    raw: (d, ctx) => [
      { label: "Capitale Netto rettificato", value: capitaleNettoRettificatoDi(d, ctx) },
      { label: "Debiti finanziari a medio-lungo termine", value: d.sp.debitiFinanziariLungo },
      { label: "Fonti durevoli complessive", value: somma(capitaleNettoRettificatoDi(d, ctx), d.sp.debitiFinanziariLungo) },
      { label: "Investimenti durevoli (immobilizzazioni)", value: d.sp.immobilizzazioniOperative },
    ],
    formula: "(Capitale Netto + Debiti fin. m/l) ÷ Immobilizzazioni",
    significato:
      "Margine di struttura secondario, allargato all'intera dotazione stabile. Deve tassativamente superare 1, e non perché lo dica una convenzione: oltre alle immobilizzazioni, anche una quota fisiologica del magazzino — le scorte di sicurezza — e i crediti a rotazione lentissima assorbono risorse in modo permanente. Le fonti stabili devono quindi coprire tutte le immobilizzazioni e lasciare un avanzo per la parte rigida del circolante.",
    giudizio: sogliaCrescente(1, 1.15, [
      "Fonti durevoli insufficienti a coprire gli investimenti durevoli: il fabbisogno permanente è finanziato a breve",
      "Copertura appena sufficiente: nessun avanzo per la quota rigida del circolante",
      "Fonti durevoli capienti, con avanzo disponibile a finanziare la parte permanente del circolante",
    ]),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-quinquies. LIQUIDITÀ — GRANDEZZE DERIVATE (analisi statica e dinamica)
   ═══════════════════════════════════════════════════════════════════════════
   La solidità patrimoniale è la struttura portante che garantisce i
   finanziatori nel lungo periodo; la liquidità è la condizione operativa
   quotidiana senza la quale l'impresa, pur patrimonialmente solida, si trova
   tecnicamente insolvente. Si indaga per due vie complementari:

     • ANALISI STATICA — confronta masse di stock riclassificate secondo la
       facilità di conversione in moneta (Stato Patrimoniale finanziario). È
       una fotografia a una certa data.
     • ANALISI DINAMICA — misura i tempi del ciclo monetario e i flussi di
       cassa che si formano nel periodo. È il filmato dell'attività.

   La riclassificazione finanziaria capovolge la logica gestionale: le
   attività non sono più investimenti da finanziare ma FONTI DI COPERTURA
   (attitudine a procurare mezzi finanziari), le passività non sono più
   risorse raccolte ma FABBISOGNI (attitudine a richiedere mezzi finanziari).
   Il criterio di aggregazione è la facilità di conversione in moneta, sotto
   due vincoli: entro i 12 mesi convenzionali, e senza pregiudicare il
   funzionamento dell'impresa (going concern).

   ATTENZIONE ALLO SCHEMA A MONTE. I moduli di riclassificazione in uso
   adottano lo schema a posizione finanziaria netta; le zone dello Stato
   Patrimoniale finanziario sono perciò ricostruite dagli aggregati
   disponibili e le grandezze che il modulo non espone (liquidità immediate
   distinte, scoperti di conto corrente, passività a breve in senso stretto)
   sono stimate con proxy dichiarate sulla card e sovrascrivibili nella
   tabella dei parametri per esercizio.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Anno commerciale convenzionale: la durata dei cicli si esprime su 360 giorni. */
const GIORNI_ANNO = 360;

/** Attività correnti (capitale circolante lordo): conversione attesa entro 12 mesi. */
const attivitaCorrentiDi = (d) => (isNum(d?.sp?.attivoCircolante) ? d.sp.attivoCircolante : null);

/** Passività correnti: rimborso atteso entro 12 mesi o a revoca. */
const passivitaCorrentiDi = (d) => (isNum(d?.sp?.passivoCorrente) ? d.sp.passivoCorrente : null);

/** Liquidità immediate: cassa, banche attive e titoli smobilizzabili a vista. */
const liquiditaImmediateDi = (d, ctx) =>
  perAnno(ctx, "liquiditaImmediate") ?? (isNum(d?.sp?.liquidita) ? d.sp.liquidita : null);

/** Disponibilità: scorte di magazzino, il tratto più lento del circolante. */
const disponibilitaDi = (d) => (isNum(d?.sp?.rimanenze) ? d.sp.rimanenze : null);

/** Liquidità differite: crediti e titoli non a vista = AC − scorte − liquidità immediate. */
const liquiditaDifferiteDi = (d, ctx) => {
  const ac = attivitaCorrentiDi(d);
  if (!isNum(ac)) return null;
  const mag = disponibilitaDi(d);
  const li = liquiditaImmediateDi(d, ctx);
  return ac - (isNum(mag) ? mag : 0) - (isNum(li) ? li : 0);
};

/** Attività immobilizzate: conversione oltre i 12 mesi, o non convertibili senza
 *  pregiudicare il funzionamento. Dal totale attivo quando disponibile. */
const attivitaImmobilizzateDi = (d) => {
  const tot = d?.sp?.totaleAttivo;
  const ac = attivitaCorrentiDi(d);
  if (isNum(tot) && isNum(ac)) return tot - ac;
  return somma(d?.sp?.immobilizzazioniOperative, d?.sp?.accessori);
};

/** Passività differite (consolidate): debiti finanziari m/l + fondi, TFR, imposte differite. */
const passivitaDifferiteDi = (d) => somma(d?.sp?.debitiFinanziariLungo, d?.sp?.passivitaOperativeNonCorrenti);

/** Capitali permanenti: passività differite + capitale netto, cioè le fonti
 *  durevolmente vincolate oltre i 12 mesi. */
const capitaliPermanentiDi = (d) => somma(passivitaDifferiteDi(d), d?.sp?.patrimonioNetto);

/** CCNf — capitale circolante netto FINANZIARIO: AC − PC. */
const ccnfDi = (d) => sottraiStretto(attivitaCorrentiDi(d), passivitaCorrentiDi(d));

/** Margine di tesoreria: (AC − scorte) − PC. Depura il CCNf dall'illusione del magazzino. */
const margineTesoreriaDi = (d) => {
  const ac = attivitaCorrentiDi(d);
  const pc = passivitaCorrentiDi(d);
  if (!isNum(ac) || !isNum(pc)) return null;
  const mag = disponibilitaDi(d);
  return ac - (isNum(mag) ? mag : 0) - pc;
};

/** Scoperti di conto corrente: passività a scadenza indeterminata che si
 *  rinnovano stabilmente. Proxy sui debiti finanziari a breve. */
const scopertiDi = (d, ctx) =>
  perAnno(ctx, "scopertiCc") ?? (isNum(d?.sp?.debitiFinanziariBreve) ? d.sp.debitiFinanziariBreve : null);

/**
 * Passività a breve IN SENSO STRETTO: uscite monetarie certe e improrogabili
 * (rate di mutuo in scadenza, debiti tributari, dividendi deliberati). Si
 * ricavano per differenza togliendo alle passività correnti gli scoperti di
 * conto — che si presumono rinnovati — e i debiti di fornitura, che si
 * rinnovano con il ciclo degli acquisti.
 */
const passivitaStretteDi = (d, ctx) => {
  const diretta = perAnno(ctx, "passBreveStretto");
  if (isNum(diretta)) return diretta;
  const pc = passivitaCorrentiDi(d);
  if (!isNum(pc)) return null;
  const sc = scopertiDi(d, ctx);
  const forn = debitiCommDi(d, ctx);
  const residuo = pc - (isNum(sc) ? sc : 0) - (isNum(forn) ? forn : 0);
  return residuo > 0 ? residuo : 0;
};

/** Passività a rotazione: i debiti verso fornitori, rinnovati dal ciclo passivo. */
const passivitaRotazioneDi = (d, ctx) => debitiCommDi(d, ctx);

/** Flusso di cassa della gestione operativa corrente (dal Rendiconto). */
const flussoCorrenteDi = (d) => (isNum(d?.rf?.flussoOperativo) ? d.rf.flussoOperativo : null);

/** Flusso della struttura operativa (capex), firmato in uscita. Se il
 *  rendiconto non lo espone si deduce come FCFO − flusso corrente. */
const capexDi = (d) => {
  if (isNum(d?.rf?.capex)) return -Math.abs(d.rf.capex);
  return isNum(d?.rf?.fcfo) && isNum(d?.rf?.flussoOperativo) ? d.rf.fcfo - d.rf.flussoOperativo : null;
};

/** Free cash flow a servizio dell'equity: FCFO al netto del servizio del debito. */
const fcfeDi = (d) => {
  if (isNum(d?.rf?.fcfe)) return d.rf.fcfe;
  return isNum(d?.rf?.fcfo) && isNum(d?.rf?.servizioDelDebito)
    ? d.rf.fcfo - Math.abs(d.rf.servizioDelDebito)
    : null;
};

/** Autofinanziamento NETTO: utile netto restituito ai suoi componenti non monetari. */
const autofinanziamentoNettoDi = (d) => {
  const u = d?.ce?.utileNetto;
  if (!isNum(u)) return null;
  const amm = ammortamentiDi(d);
  const acc = isNum(d?.ce?.accantonamenti) ? Math.abs(d.ce.accantonamenti) : 0;
  return u + (isNum(amm) ? Math.abs(amm) : 0) + acc;
};

/** Debiti finanziari LORDI: a breve + a medio-lungo termine. */
const debitiFinanziariDi = (d) => somma(d?.sp?.debitiFinanziariBreve, d?.sp?.debitiFinanziariLungo);

/** Cassa disponibile a fine esercizio, dallo SP o dal Rendiconto. */
const cassaDi = (d, ctx) => liquiditaImmediateDi(d, ctx) ?? (isNum(d?.rf?.liquidita) ? d.rf.liquidita : null);

/* ── Durate del ciclo monetario ────────────────────────────────────────────── */

const giorniScorteDi = (d, ctx) => {
  const r = safeDiv(disponibilitaDi(d), costoVendutoDi(d, ctx));
  return isNum(r) ? r * GIORNI_ANNO : null;
};
const giorniCreditiDi = (d, ctx) => {
  const r = safeDiv(creditiCommDi(d, ctx), d?.ce?.ricavi);
  return isNum(r) ? r * GIORNI_ANNO : null;
};
const giorniFornitoriDi = (d, ctx) => {
  const r = safeDiv(debitiCommDi(d, ctx), costoVendutoDi(d, ctx));
  return isNum(r) ? r * GIORNI_ANNO : null;
};
/** Ciclo attivo: dall'acquisto dei fattori all'incasso delle vendite. */
const cicloAttivoDi = (d, ctx) => {
  const s = giorniScorteDi(d, ctx);
  const c = giorniCreditiDi(d, ctx);
  return isNum(s) && isNum(c) ? s + c : null;
};
/** Ciclo monetario: divario netto fra uscite per acquisti ed entrate da vendite. */
const cicloMonetarioDi = (d, ctx) => {
  const a = cicloAttivoDi(d, ctx);
  const p = giorniFornitoriDi(d, ctx);
  return isNum(a) && isNum(p) ? a - p : null;
};

/** Burn rate: quanta parte del disavanzo operativo annuo la cassa riesce a coprire. */
const burnRateDi = (d, ctx) => {
  const f = flussoCorrenteDi(d);
  const cassa = cassaDi(d, ctx);
  return isNum(f) && f < 0 && isNum(cassa) ? cassa / Math.abs(f) : null;
};
/** Defensive interval: i giorni di autonomia liquida residua. */
const defensiveIntervalDi = (d, ctx) => {
  const b = burnRateDi(d, ctx);
  return isNum(b) ? b * GIORNI_ANNO : null;
};

/* ── Sezione 3.1 · Blocco B — CCNf e liquidità generale ────────────────────── */

const IND_LIQUIDITA_STATICA = [
  {
    id: "ccnf",
    nome: "Capitale circolante netto finanziario",
    sub: "Attività correnti − Passività correnti",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => ccnfDi(d),
    raw: (d) => [
      { label: "Attività correnti (entro 12 mesi)", value: attivitaCorrentiDi(d) },
      { label: "   di cui disponibilità (magazzino)", value: disponibilitaDi(d) },
      { label: "Passività correnti (entro 12 mesi)", value: passivitaCorrentiDi(d) },
    ],
    formula: "CCNf = Attività correnti − Passività correnti",
    significato:
      "Il margine di sintesi dell'analisi statica: confronta la zona delle entrate attese entro dodici mesi con quella delle uscite attese nello stesso arco. Un CCNf positivo è la condizione minima di equilibrio monetario; se le passività superano le attività correnti, l'impresa si trova nell'impossibilità matematica di pagare i debiti a breve con le entrate a breve. Resta però una condizione necessaria e non sufficiente: dice che i valori ci sono, non che arriveranno al momento giusto.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "Le entrate attese a breve eccedono le uscite attese a breve: equilibrio monetario contabile" }
        : { level: "bad", testo: "Passività correnti superiori alle attività correnti: rischio di liquidità conclamato" },
  },
  {
    id: "liquiditaGenerale",
    nome: "Indice di liquidità generale",
    sub: "Attività correnti / Passività correnti — Current Ratio",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(attivitaCorrentiDi(d), passivitaCorrentiDi(d)),
    raw: (d) => [
      { label: "Attività correnti", value: attivitaCorrentiDi(d) },
      { label: "Passività correnti", value: passivitaCorrentiDi(d) },
      { label: "CCNf corrispondente", value: ccnfDi(d) },
    ],
    formula: "Attività correnti ÷ Passività correnti",
    significato:
      "Lo stesso saldo del CCNf espresso in forma di quoziente, così da rendere confrontabili imprese di dimensione diversa. La prassi professionale colloca il valore rassicurante attorno a 2: le attività a breve dovrebbero essere circa il doppio delle uscite attese, perché una parte del circolante è in realtà rigida e una parte dei valori contabili non si monetizzerà mai per intero.",
    giudizio: sogliaCrescente(1, 1.8, [
      "Sotto l'unità: le uscite a breve eccedono le entrate a breve",
      "Sopra l'unità ma lontano dalla soglia prudenziale di 2",
      "Copertura ampia delle passività correnti",
    ]),
  },
  {
    id: "margineTesoreria",
    nome: "Margine di tesoreria",
    sub: "(Attività correnti − Scorte) − Passività correnti",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => margineTesoreriaDi(d),
    raw: (d) => [
      { label: "Attività correnti", value: attivitaCorrentiDi(d) },
      { label: "Scorte di magazzino escluse", value: disponibilitaDi(d) },
      { label: "Liquidità (immediate + differite)", value: sottrai(attivitaCorrentiDi(d), disponibilitaDi(d)) },
      { label: "Passività correnti", value: passivitaCorrentiDi(d) },
    ],
    formula: "Margine di tesoreria = (Attività correnti − Scorte) − Passività correnti",
    significato:
      "Elimina dal CCNf il fattore di rischio legato alla vendibilità delle scorte. Un capitale circolante netto imponente può essere trainato da un magazzino enorme ma obsoleto o bloccato dal mercato: la liquidità apparirebbe florida sulla carta ed essere nulla nei fatti. Qui restano solo cassa e crediti già maturati.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "Le liquidità coprono per intero le passività correnti senza smobilizzare il magazzino" }
        : { level: "warn", testo: "Senza lo smobilizzo delle scorte le passività correnti non sono coperte" },
  },
  {
    id: "liquiditaPrimaria",
    nome: "Indice di liquidità primaria",
    sub: "(Attività correnti − Scorte) / Passività correnti",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d) => safeDiv(sottrai(attivitaCorrentiDi(d), disponibilitaDi(d)), passivitaCorrentiDi(d)),
    raw: (d, ctx) => [
      { label: "Liquidità immediate", value: liquiditaImmediateDi(d, ctx) },
      { label: "Liquidità differite (crediti e titoli)", value: liquiditaDifferiteDi(d, ctx) },
      { label: "Totale liquidità", value: sottrai(attivitaCorrentiDi(d), disponibilitaDi(d)) },
      { label: "Passività correnti", value: passivitaCorrentiDi(d) },
    ],
    formula: "(Attività correnti − Scorte) ÷ Passività correnti",
    significato:
      "Il margine di tesoreria in forma di quoziente. Il suo valore non dovrebbe mai scendere sotto l'unità: un'impresa sana deve potersi permettere, almeno in teoria, di pagare tutti i debiti a breve ricorrendo esclusivamente alla cassa presente e agli incassi dei crediti già maturati, senza dipendere dalla vendita delle scorte.",
    giudizio: sogliaCrescente(0.8, 1, [
      "Liquidità insufficiente: il pagamento dei debiti a breve dipende dallo smobilizzo del magazzino",
      "Copertura quasi integrale, ma sotto la soglia di 1",
      "Debiti a breve coperti da cassa e crediti già maturati",
    ]),
  },
  {
    id: "liquiditaSecca",
    nome: "Indice di liquidità secca",
    sub: "Liquidità immediate / Passività correnti — Quick Ratio",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(liquiditaImmediateDi(d, ctx), passivitaCorrentiDi(d)),
    raw: (d, ctx) => [
      { label: "Liquidità immediate", value: liquiditaImmediateDi(d, ctx) },
      { label: "Passività correnti", value: passivitaCorrentiDi(d) },
      {
        label: perAnno(ctx, "liquiditaImmediate") === null || daSP(ctx, "liquiditaImmediate") ? "Fonte: liquidità dell'aggregato SP" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Liquidità immediate ÷ Passività correnti",
    significato:
      "Anche i crediti comportano un'attesa di incasso e il rischio di insolvenza del cliente: questo test più rigoroso depura il numeratore limitandolo al denaro effettivamente disponibile. Risponde alla domanda «in che misura i conti correnti attuali reggerebbero un'immediata richiesta di saldo da parte di tutti i creditori a breve». È una prova di stress, non una condizione ordinaria: nessuna impresa efficiente tiene ferma tanta cassa.",
    giudizio: sogliaCrescente(0.1, 0.25, [
      "Cassa marginale rispetto all'indebitamento a breve: nessun cuscinetto per shock improvvisi",
      "Cuscinetto di cassa sottile ma presente",
      "Ampia dotazione di cassa rispetto alle passività correnti",
    ]),
  },
  {
    id: "cashRatio",
    nome: "Indice della prova acida",
    sub: "Liquidità immediate / Passività a breve in senso stretto",
    unit: "x",
    betterWhen: "up",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(liquiditaImmediateDi(d, ctx), passivitaStretteDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Liquidità immediate", value: liquiditaImmediateDi(d, ctx) },
      { label: "Passività correnti totali", value: passivitaCorrentiDi(d) },
      { label: "   − scoperti di c/c (si presumono rinnovati)", value: scopertiDi(d, ctx) },
      { label: "   − debiti di fornitura (a rotazione)", value: passivitaRotazioneDi(d, ctx) },
      { label: "= Passività a breve in senso stretto", value: passivitaStretteDi(d, ctx) },
    ],
    formula: "Liquidità immediate ÷ Passività a breve in senso stretto",
    significato:
      "L'indicatore estremo di solvibilità stringe il perimetro su entrambi i lati. Dal denominatore escono gli scoperti di conto corrente, che in condizioni ordinarie la banca rinnova, e i debiti di fornitura, che si rinnovano con il ciclo passivo: restano solo le uscite certe, improrogabili e strutturali — rate di mutuo in scadenza, Fisco, dividendi deliberati. È il test che dice se l'impresa regge le scadenze che nessuno può rinviare.",
    giudizio: sogliaCrescente(0.5, 1, [
      "La cassa non copre le uscite improrogabili in scadenza",
      "Copertura parziale delle uscite improrogabili",
      "Le uscite certe e improrogabili sono coperte dalla sola cassa",
    ]),
    richiede: () =>
      "Con lo schema a PFN la stima per differenza si annulla: indica le passività a breve in senso stretto nei parametri per esercizio",
  },
];

/* ── Sezione 3.1 · Blocco D — Ciclo monetario e fabbisogno del circolante ──── */

const IND_CICLO_MONETARIO = [
  {
    id: "cicloAttivo",
    nome: "Durata del ciclo attivo",
    sub: "Giacenza scorte + incasso crediti",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => cicloAttivoDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Giorni di giacenza delle scorte", value: giorniScorteDi(d, ctx) },
      { label: "Giorni di incasso dei crediti", value: giorniCreditiDi(d, ctx) },
      { label: "Magazzino", value: disponibilitaDi(d) },
      { label: "Crediti commerciali", value: creditiCommDi(d, ctx) },
    ],
    formula: "Ciclo attivo = giorni di giacenza + giorni di incasso",
    significato:
      "Il tempo che separa l'acquisto dei fattori produttivi dall'incasso delle vendite. Sono i giorni in cui il capitale resta immobilizzato prima di tornare in forma di moneta: ogni giorno in più è capitale che qualcuno deve finanziare.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 90
        ? { level: "ok", testo: "Ciclo attivo contenuto" }
        : v <= 180
        ? { level: "warn", testo: "Ciclo attivo lungo: verificare quale dei due tratti lo determini" }
        : { level: "bad", testo: "Ciclo attivo molto lungo: il capitale resta immobilizzato oltre mezzo esercizio" },
  },
  {
    id: "cicloPassivo",
    nome: "Durata del ciclo passivo",
    sub: "Dilazione media ottenuta dai fornitori",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => giorniFornitoriDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Debiti verso fornitori", value: debitiCommDi(d, ctx) },
      { label: "Costo del venduto", value: costoVendutoDi(d, ctx) },
      {
        label: perAnno(ctx, "debitiComm") === null ? "Fonte: passività operative correnti (proxy)" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Debiti verso fornitori ÷ Costo del venduto × 360",
    significato:
      "Il tempo che intercorre fra l'acquisto dei fattori e il loro effettivo pagamento: è la quota di ciclo che i fornitori finanziano al posto dell'impresa. Va letto con sospetto quando è patologicamente lungo in aziende con scarso potere contrattuale: non è efficienza negoziale ma spia di insolvenza latente, e prelude al blocco delle forniture.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v >= 120
        ? { level: "bad", testo: "Dilazione anomala: verificare se sia negoziata o subita per tensione di cassa" }
        : v >= 90
        ? { level: "warn", testo: "Dilazione molto lunga: sorvegliare la tenuta dei rapporti di fornitura" }
        : v >= 45
        ? { level: "ok", testo: "Dilazione in linea con le prassi commerciali" }
        : { level: "warn", testo: "Dilazione breve: il ciclo è finanziato prevalentemente in proprio" },
  },
  {
    id: "cicloMonetario",
    nome: "Durata del ciclo monetario",
    sub: "Ciclo attivo − ciclo passivo",
    unit: "val",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d, ctx) => cicloMonetarioDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Ciclo attivo", value: cicloAttivoDi(d, ctx) },
      { label: "Ciclo passivo (fornitori)", value: giorniFornitoriDi(d, ctx) },
      { label: "Fabbisogno medio giornaliero (ricavi ÷ 360)", value: safeDiv(d?.ce?.ricavi, GIORNI_ANNO) },
    ],
    formula: "Ciclo monetario = (giacenza + incasso) − pagamento fornitori",
    significato:
      "L'intervallo netto che separa in media le uscite finanziarie dalle entrate della gestione corrente. Quanto più l'incasso è posticipato rispetto al pagamento, tanto più si allarga il buco monetario che l'impresa deve coprire con fonti esterne — tipicamente debito bancario a breve. È il numero che si moltiplica per ogni euro di crescita del fatturato.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v <= 0
        ? { level: "ok", testo: "Ciclo monetario negativo: l'impresa incassa prima di pagare e la crescita libera cassa" }
        : v <= 60
        ? { level: "ok", testo: "Buco monetario contenuto" }
        : v <= 120
        ? { level: "warn", testo: "Buco monetario rilevante: tensione di liquidità strutturale da finanziare" }
        : { level: "bad", testo: "Buco monetario molto ampio: ogni euro di crescita assorbirà cassa in proporzione" },
  },
  {
    id: "intensitaCircolante",
    nome: "Tasso di intensità del circolante",
    sub: "CCNc / Ricavi di vendita",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp", "ce"],
    calc: (d) => safeDiv(d?.sp?.ccno, d?.ce?.ricavi),
    raw: (d) => [
      { label: "CCNc — circolante netto commerciale", value: d?.sp?.ccno },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
    ],
    formula: "CCNc ÷ Ricavi di vendita × 100",
    significato:
      "Il fabbisogno finanziario corrente necessario a sostenere ogni unità di fatturato. Un aumento denota inefficienze nel governo del ciclo — crediti bloccati, scorte in accumulo. Comprimerlo troppo, però, è controproducente: restringere il credito ai clienti mette l'impresa fuori mercato e distrugge i ricavi futuri, con un danno che eccede il beneficio di cassa.",
    giudizio: sogliaDecrescente(0.15, 0.3, [
      "Il circolante assorbe una quota molto elevata del fatturato",
      "Assorbimento del circolante nella fascia intermedia",
      "Ciclo corrente poco assorbente rispetto ai volumi",
    ]),
  },
  {
    id: "gradoFinanziamentoBreve",
    nome: "Grado di finanziamento bancario a breve",
    sub: "Banche c/c passivi / CCNc",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d, ctx) => safeDiv(scopertiDi(d, ctx), d?.sp?.ccno),
    raw: (d, ctx) => [
      { label: "Banche c/c passivi (scoperti)", value: scopertiDi(d, ctx) },
      { label: "CCNc — circolante netto commerciale", value: d?.sp?.ccno },
      {
        label: perAnno(ctx, "scopertiCc") === null || daSP(ctx, "scopertiCc") ? "Fonte: debiti finanziari a breve (proxy)" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Banche c/c passivi ÷ CCNc",
    significato:
      "Misura quanta parte del buco monetario è coperta da debito bancario a breve. Fino a 1 il debito si limita al fabbisogno corrente fisiologico e mantiene carattere elastico e autoliquidante: si riduce da sé quando il ciclo si chiude. Oltre 1 il debito a breve eccede il circolante e sta di fatto finanziando investimenti durevoli — un errore di copertura gravissimo, perché fonti revocabili sostengono impieghi che non si smobilizzano.",
    giudizio: sogliaDecrescente(0.8, 1, [
      "Il debito a breve eccede il circolante: sta finanziando investimenti durevoli",
      "Debito a breve al limite del fabbisogno corrente",
      "Debito bancario elastico, contenuto entro il fabbisogno del ciclo",
    ]),
  },
];

/* ── Sezione 3.1 · Blocco E — Costo del finanziamento del ciclo ────────────── */

const IND_ONERI_FINANZIARI = [
  {
    id: "incidenzaOneri",
    nome: "Incidenza degli oneri finanziari",
    sub: "Oneri finanziari / Ricavi — soglia di guardia 5%",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d) => safeDiv(d?.ce?.oneriFinanziari, d?.ce?.ricavi),
    raw: (d) => [
      { label: "Oneri finanziari", value: d?.ce?.oneriFinanziari },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
      { label: "EBIT di confronto", value: d?.ce?.ebit },
    ],
    formula: "Oneri finanziari ÷ Ricavi di vendita × 100",
    significato:
      "Quanta parte del fatturato viene assorbita dal costo del debito. Oltre la soglia di guardia del 5% l'indebitamento sta mangiando la redditività aziendale: il margine operativo, per quanto buono, non arriva più a fondo conto economico. È l'indicatore che traduce la tensione finanziaria in un numero che il conto economico non può nascondere.",
    giudizio: sogliaDecrescente(0.03, 0.05, [
      "Oltre la soglia di guardia: gli oneri finanziari erodono la redditività",
      "Incidenza in avvicinamento alla soglia di guardia del 5%",
      "Costo del debito sostenibile rispetto ai volumi",
    ]),
  },
  {
    id: "rodLiquidita",
    nome: "Costo medio dell'indebitamento (ROD)",
    sub: "Oneri finanziari / Debiti finanziari",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(d?.ce?.oneriFinanziari, debitiFinanziariDi(d)),
    raw: (d) => [
      { label: "Oneri finanziari", value: d?.ce?.oneriFinanziari },
      { label: "Debiti finanziari a breve", value: d?.sp?.debitiFinanziariBreve },
      { label: "Debiti finanziari a medio-lungo", value: d?.sp?.debitiFinanziariLungo },
      { label: "Debiti finanziari totali", value: debitiFinanziariDi(d) },
    ],
    formula: "Oneri finanziari ÷ Debiti finanziari × 100",
    significato:
      "Il primo dei due fattori dell'incidenza: il tasso di interesse effettivo pagato ai creditori, che dipende dal merito di credito, dalla forma tecnica dei finanziamenti e dalle condizioni di mercato. È il termine di paragone naturale del ROI: finché il rendimento del capitale investito supera il ROD, la leva finanziaria amplifica il ROE.",
    giudizio: sogliaDecrescente(0.05, 0.08, [
      "Costo del debito elevato: merito di credito o forme tecniche penalizzanti",
      "Costo del debito nella fascia intermedia",
      "Costo del debito contenuto",
    ]),
  },
  {
    id: "intensitaIndebitamento",
    nome: "Intensità dell'indebitamento",
    sub: "Debiti finanziari / Ricavi — il «punto di non ritorno»",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(debitiFinanziariDi(d), d?.ce?.ricavi),
    raw: (d) => [
      { label: "Debiti finanziari totali", value: debitiFinanziariDi(d) },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
    ],
    formula: "Debiti finanziari ÷ Ricavi di vendita",
    significato:
      "Il secondo fattore dell'incidenza, e il più insidioso. Finché i debiti restano inferiori al fatturato il rapporto frena il peso degli oneri; quando lo superano agisce da moltiplicatore espansivo, e un lieve calo delle vendite basta a rendere impossibile servire il debito, trasformandolo in una passività rigida che innesca la crisi. Da qui la locuzione «punto di non ritorno».",
    giudizio: sogliaDecrescente(0.5, 1, [
      "Debiti finanziari superiori al fatturato: oltre il punto di non ritorno",
      "Debiti finanziari vicini al livello del fatturato",
      "Indebitamento contenuto rispetto ai volumi di vendita",
    ]),
  },
];

/* ── Sezione 3.1 · Blocco F — Produzione di moneta e qualità del flusso ────── */

const IND_FLUSSI_LIQUIDITA = [
  {
    id: "monetaPotenziale",
    nome: "Moneta potenzialmente estratta",
    sub: "EBITDA / Ricavi — EBITDA Margin",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d?.ce?.ebitda, d?.ce?.ricavi),
    raw: (d) => [
      { label: "Autofinanziamento lordo (EBITDA)", value: d?.ce?.ebitda },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
    ],
    formula: "EBITDA ÷ Ricavi di vendita × 100",
    significato:
      "Il primo gradino della scala: la moneta che la gestione caratteristica potrebbe estrarre da ogni euro di fatturato, prima che il circolante la trattenga. La sua consistenza dipende dal differenziale fra i ricavi — mix, volumi, prezzi — e i costi monetari operativi, legati alla produttività interna e ai prezzi d'acquisto.",
    giudizio: sogliaCrescente(0.08, 0.15, [
      "Autofinanziamento potenziale compresso",
      "Autofinanziamento potenziale nella fascia intermedia",
      "Ampio potenziale di generazione monetaria",
    ]),
  },
  {
    id: "cashReturnOnSales",
    nome: "Moneta effettivamente estratta",
    sub: "Flusso operativo corrente / Ricavi — Cash Return on Sales",
    unit: "pct",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(flussoCorrenteDi(d), d?.ce?.ricavi),
    raw: (d) => [
      { label: "Flusso di cassa operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
      { label: "EBITDA di confronto", value: d?.ce?.ebitda },
    ],
    formula: "Flusso operativo corrente ÷ Ricavi di vendita × 100",
    significato:
      "L'efficienza monetaria della gestione caratteristica: quanta cassa arriva davvero in banca per ogni euro venduto. Più l'indice è alto, migliore è la qualità del reddito, che non resta sulla carta ma diventa moneta incassata. Il divario rispetto all'EBITDA Margin è tutto e solo assorbimento di circolante.",
    giudizio: sogliaCrescente(0.03, 0.08, [
      "La gestione corrente estrae pochissima cassa dalle vendite",
      "Estrazione di cassa modesta: verificare l'assorbimento del circolante",
      "Buona conversione del fatturato in moneta",
    ]),
  },
  {
    id: "fcfSuRicavi",
    nome: "Moneta al netto dei reinvestimenti",
    sub: "Free cash flow operativo / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(d?.rf?.fcfo, d?.ce?.ricavi),
    raw: (d) => [
      { label: "FCFO — free cash flow operativo", value: d?.rf?.fcfo },
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Flusso della struttura operativa (capex)", value: capexDi(d) },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
    ],
    formula: "FCFO ÷ Ricavi di vendita × 100",
    significato:
      "Il terzo gradino: la cassa che resta dopo aver rifinanziato la struttura operativa. È la moneta effettivamente disponibile per servire il debito e remunerare i soci, e l'unica grandezza che le agenzie di rating considerano davvero libera.",
    giudizio: sogliaCrescente(0, 0.05, [
      "Gli investimenti in struttura assorbono più cassa di quanta la gestione ne produca",
      "Cassa libera positiva ma sottile",
      "La gestione libera cassa anche dopo aver rinnovato la struttura",
    ]),
  },
  {
    id: "qualitaAutofinanziamento",
    nome: "Qualità dell'autofinanziamento",
    sub: "Ammortamenti / EBITDA",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d) => safeDiv(ammortamentiDi(d), d?.ce?.ebitda),
    raw: (d) => [
      { label: "Ammortamenti", value: ammortamentiDi(d) },
      { label: "Autofinanziamento lordo (EBITDA)", value: d?.ce?.ebitda },
      { label: "Quota libera da vincolo di rigenerazione", value: sottrai(d?.ce?.ebitda, ammortamentiDi(d)) },
    ],
    formula: "Ammortamenti ÷ EBITDA × 100",
    significato:
      "L'ammortamento è un flusso vincolato alla rigenerazione fisiologica della struttura tecnica: quella quota di autofinanziamento andrà reinvestita per mantenere efficiente ciò che già esiste. Più incide sull'EBITDA, minore è la cassa realmente libera di pagare debiti o finanziare espansioni.",
    giudizio: sogliaDecrescente(0.35, 0.6, [
      "Autofinanziamento quasi interamente vincolato al rinnovo della struttura esistente",
      "Vincolo di rigenerazione significativo",
      "Autofinanziamento in larga parte libero da vincoli di rinnovo",
    ]),
  },
  {
    id: "impattoCircolante",
    nome: "Impatto del circolante",
    sub: "Flusso operativo corrente / Autofinanziamento netto",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(flussoCorrenteDi(d), autofinanziamentoNettoDi(d)),
    raw: (d) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Autofinanziamento netto", value: autofinanziamentoNettoDi(d) },
      { label: "   di cui utile netto", value: d?.ce?.utileNetto },
      { label: "   di cui ammortamenti e accantonamenti", value: somma(ammortamentiDi(d), d?.ce?.accantonamenti) },
    ],
    formula: "Flusso operativo corrente ÷ Autofinanziamento netto",
    significato:
      "L'autofinanziamento potenziale diventa flusso di cassa solo dopo aver attraversato le dinamiche del circolante. Sotto 1 il CCNc sta assorbendo cassa — espansione sproporzionata di crediti e magazzino, spia classica di overtrading. Sopra 1 il circolante rilascia risorse, ma spremere clienti e magazzino espone a colli di bottiglia e perdita di quote: il beneficio è effimero.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v >= 1
        ? { level: "ok", testo: "Il circolante rilascia risorse: verificare che la compressione sia sostenibile" }
        : v >= 0.6
        ? { level: "warn", testo: "Il circolante trattiene una quota apprezzabile del potenziale monetario" }
        : { level: "bad", testo: "Forte assorbimento del circolante: il potenziale monetario resta bloccato in crediti e scorte" },
  },
  {
    id: "cashInterestCoverage",
    nome: "Copertura monetaria degli oneri",
    sub: "Flusso operativo corrente / Oneri finanziari",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(flussoCorrenteDi(d), d?.ce?.oneriFinanziari),
    raw: (d) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Oneri finanziari", value: d?.ce?.oneriFinanziari },
      { label: "Servizio del debito complessivo", value: d?.rf?.servizioDelDebito },
    ],
    formula: "Flusso operativo corrente ÷ Oneri finanziari",
    significato:
      "La versione monetaria dell'interest coverage: al numeratore non il reddito operativo, che contiene componenti non incassate, ma la cassa effettivamente prodotta dalla gestione corrente. È la misura che le agenzie di rating preferiscono, perché immune dalle politiche di bilancio su ammortamenti e svalutazioni.",
    giudizio: sogliaCrescente(2, 5, [
      "La cassa corrente copre a stento il costo del debito",
      "Copertura monetaria sufficiente ma sensibile a rialzi dei tassi",
      "Ampia copertura monetaria degli oneri finanziari",
    ]),
  },
  {
    id: "defensiveInterval",
    nome: "Defensive interval",
    sub: "Burn rate × 360 — giorni di autonomia liquida",
    unit: "val",
    betterWhen: "up",
    moduli: ["rf", "sp"],
    calc: (d, ctx) => defensiveIntervalDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Disponibilità liquide (cassa)", value: cassaDi(d, ctx) },
      { label: "Flusso operativo corrente (disavanzo)", value: flussoCorrenteDi(d) },
      { label: "Burn rate (×100)", value: isNum(burnRateDi(d, ctx)) ? burnRateDi(d, ctx) * 100 : null },
    ],
    formula: "Defensive interval = (Cassa ÷ |Disavanzo operativo|) × 360",
    significato:
      "Si calcola solo quando il flusso operativo corrente è negativo, cioè quando l'impresa brucia cassa per gestire le operazioni basilari — condizione tollerabile solo per startup o in ristrutturazioni controllate. Il burn rate dice quanta parte del disavanzo annuo la cassa riesce a coprire; moltiplicato per 360 restituisce i giorni di autonomia residua prima del collasso.",
    giudizio: (v) =>
      !isNum(v)
        ? {
            level: "info",
            testo:
              "L'indice si valorizza solo in presenza di un disavanzo operativo: se il flusso corrente è positivo l'impresa non sta bruciando cassa e la misura non ha oggetto.",
          }
        : v >= 360
        ? { level: "warn", testo: "Oltre un anno di autonomia, ma il flusso corrente resta negativo" }
        : v >= 180
        ? { level: "warn", testo: "Autonomia superiore al semestre: c'è tempo per un piano di rientro" }
        : { level: "bad", testo: "Autonomia liquida inferiore a sei mesi: il rientro va avviato subito" },
    richiede: () => "Si valorizza solo con flusso operativo corrente negativo (cassa in combustione)",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-sexies. ASSORBIMENTO DI MONETA E SERVIZIO FINANZIARIO — grandezze derivate
   ═══════════════════════════════════════════════════════════════════════════
   Se la gestione operativa corrente è il motore che produce liquidità, quella
   moneta è fisiologicamente destinata a essere consumata dalle altre aree:
   la struttura operativa (Capex) e la gestione finanziaria passiva (oneri,
   rimborsi, dividendi). L'indagine risponde a due domande distinte:

     • COMPOSIZIONE — dove sono state assorbite le risorse?
     • COPERTURA — quelle prodotte bastano a coprire le esigenze?

   La prima è una diagnosi strutturale che gli indici reddituali non vedono:
   un'impresa in forte espansione con assorbimento esiguo per investimenti e
   massiccio per il servizio del debito non sta finanziando la crescita, sta
   pagando il passato. La seconda si biforca in capacità di sviluppo autonomo
   (verso la struttura) e grado di solvibilità (verso i finanziatori).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Capex in valore assoluto: il fabbisogno della struttura operativa. */
const capexTotaleDi = (d) => {
  const c = capexDi(d);
  return isNum(c) ? Math.abs(c) : null;
};

/** Oneri finanziari in valore assoluto. */
const oneriDi = (d) => (isNum(d?.ce?.oneriFinanziari) ? Math.abs(d.ce.oneriFinanziari) : null);

/**
 * Quote capitale rimborsate nell'esercizio. Il rendiconto espone il servizio
 * del debito complessivo: la quota capitale si ottiene per differenza dagli
 * oneri finanziari, salvo indicazione manuale.
 */
const quoteCapitaleDi = (d, ctx) => {
  const manuale = perAnno(ctx, "quoteCapitale");
  if (isNum(manuale)) return Math.abs(manuale);
  const serv = d?.rf?.servizioDelDebito;
  if (!isNum(serv)) return null;
  const on = oneriDi(d);
  const q = Math.abs(serv) - (isNum(on) ? on : 0);
  return q > 0 ? q : 0;
};

/** Dividendi e riacquisto di azioni proprie effettivamente pagati. */
const dividendiPagatiDi = (d, ctx) =>
  perAnno(ctx, "dividendiDistribuiti") ?? (isNum(d?.rf?.dividendi) ? Math.abs(d.rf.dividendi) : null);

/** Servizio dei finanziatori: oneri + quote capitale + dividendi. */
const servizioFinanziatoriDi = (d, ctx) =>
  somma(oneriDi(d), quoteCapitaleDi(d, ctx), dividendiPagatiDi(d, ctx));

/** Fabbisogno finanziario complessivo dell'esercizio (struttura + fonti). */
const fabbisognoTotaleDi = (d, ctx) => somma(capexTotaleDi(d), servizioFinanziatoriDi(d, ctx));

/**
 * Capex di MANTENIMENTO (mandatory): il fabbisogno inderogabile per non
 * perdere capacità produttiva. In assenza del dato puntuale si stima con
 * l'ammortamento dell'esercizio, che misura appunto l'usura da rigenerare,
 * senza mai eccedere il capex effettivamente sostenuto.
 */
const capexMantenimentoDi = (d, ctx) => {
  const m = perAnno(ctx, "capexMantenimento");
  if (isNum(m)) return Math.abs(m);
  const amm = ammortamentiDi(d);
  const cap = capexTotaleDi(d);
  return isNum(amm) && isNum(cap) ? Math.min(Math.abs(amm), cap) : null;
};

/** Capex di SVILUPPO (discretionary): la parte legata a scelte di espansione. */
const capexSviluppoDi = (d, ctx) => {
  const cap = capexTotaleDi(d);
  const man = capexMantenimentoDi(d, ctx);
  return isNum(cap) && isNum(man) ? cap - man : null;
};

/** Free cash flow disponibile per i pagamenti VINCOLATI: flusso corrente al
 *  netto del solo capex di mantenimento. È il numeratore dell'indice di
 *  solvibilità più severo. */
const fcfVincolatiDi = (d, ctx) => {
  const f = flussoCorrenteDi(d);
  const m = capexMantenimentoDi(d, ctx);
  return isNum(f) && isNum(m) ? f - m : null;
};

/** Rendimento monetario del capitale operativo investito. */
const cashFlowRoiDi = (d) => safeDiv(d?.rf?.fcfo, d?.sp?.coin);

/** Numero di azioni in circolazione (solo da parametro manuale). */
/* Le azioni sono in MILIONI, come gli importi: l'utile per azione è utile netto
   (milioni) ÷ azioni (milioni). Un valore oltre il milione viene da un
   salvataggio precedente in unità e si riporta in milioni. */
const azioniInMilioni = (v) => (isNum(v) && v > 1e6 ? v / 1e6 : v);
const azioniDi = (ctx) => azioniInMilioni(perAnno(ctx, "numeroAzioni"));

/**
 * Fase del ciclo di vita dedotta dalla combinazione di margine, crescita,
 * free cash flow e intensità degli investimenti. Serve a evitare l'errore
 * più comune nella lettura del FCF: leggerne il segno senza il contesto.
 */
const faseCicloVita = (d, ctx) => {
  const ebitda = d?.ce?.ebitda;
  const fcf = d?.rf?.fcfo;
  const g = crescitaRicaviDi(d, ctx);
  const rinnovo = safeDiv(capexTotaleDi(d), ammortamentiDi(d));
  if (!isNum(ebitda) || !isNum(fcf)) return null;
  if (ebitda <= 0)
    return {
      id: "introduzione",
      nome: "Introduzione",
      level: "info",
      testo:
        "Margine operativo lordo ancora non positivo e cassa in uscita: costi alti, ricavi bassi e investimenti necessari. Un free cash flow profondamente negativo è qui fisiologico, non patologico.",
    };
  if (isNum(g) && g > 0.1 && fcf <= 0)
    return {
      id: "sviluppo",
      nome: "Sviluppo",
      level: "info",
      testo:
        "Crescita sostenuta con free cash flow ancora negativo: il boom del circolante commerciale e gli investimenti in capacità produttiva assorbono più cassa di quanta l'EBITDA, pur positivo, ne produca. Fisiologico, purché la finanza esterna sia disponibile e coerente.",
    };
  if (isNum(g) && g < 0)
    return fcf > 0
      ? {
          id: "declino",
          nome: "Declino · protetto dalle dismissioni",
          level: "warn",
          testo:
            "Ricavi in arretramento ma cassa ancora positiva: nella prima fase del declino il free cash flow è sostenuto dal disinvestimento degli asset, che genera liquidità una tantum. È un sostegno destinato a esaurirsi.",
        }
      : {
          id: "declino",
          nome: "Declino",
          level: "bad",
          testo:
            "Ricavi in arretramento e cassa in uscita: il crollo fisiologico del free cash flow è in corso e richiede una revisione del portafoglio di attività.",
        };
  if (fcf > 0 && (!isNum(rinnovo) || rinnovo < 1.3))
    return {
      id: "maturita",
      nome: "Maturità",
      level: "ok",
      testo:
        "Free cash flow positivo e abbondante con investimenti che si limitano al rinnovo: è la fase che massimizza la cassa disponibile, quella che deve finanziare le aree emergenti del portafoglio.",
    };
  if (fcf <= 0)
    return {
      id: "allarme",
      nome: "Allarme · cassa negativa fuori dalla fase di sviluppo",
      level: "bad",
      testo:
        "Free cash flow negativo senza la giustificazione di una crescita in corso né di una fase di avvio: qui il segno negativo non è fisiologico e va indagato come segnale strategico grave.",
    };
  return {
    id: "espansione",
    nome: "Maturità in espansione",
    level: "ok",
    testo:
      "Cassa positiva pur in presenza di investimenti superiori al rinnovo: la struttura si sta ampliando restando autofinanziata, la condizione più solida fra quelle possibili.",
  };
};

/* ── Sezione 3.2 · Blocco C — Servizio della struttura produttiva ──────────── */

const IND_COPERTURA_STRUTTURA = [
  {
    id: "coperturaStruttura",
    nome: "Copertura della struttura",
    sub: "Flusso operativo corrente / Capex",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf"],
    calc: (d) => safeDiv(flussoCorrenteDi(d), capexTotaleDi(d)),
    raw: (d) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Capex (investimenti netti in struttura)", value: capexTotaleDi(d) },
      { label: "Free cash flow operativo residuo", value: d?.rf?.fcfo },
    ],
    formula: "Flusso operativo corrente ÷ Capex",
    significato:
      "Un'azienda sana finanzia da sé il mantenimento e lo sviluppo della propria struttura: è la condizione per conservare il vantaggio competitivo. Un valore sotto 1 va giudicato negativamente, salvo una fase di espansione strategica dichiarata e temporanea, finanziata consapevolmente con capitali esterni. Il punto non è ideologico ma di tempi: la finanza esterna è lenta rispetto alla velocità con cui si muove la concorrenza, e l'autonomia monetaria è ciò che rende possibile la tempestività strategica.",
    giudizio: sogliaCrescente(0.8, 1, [
      "La gestione corrente non copre gli investimenti in struttura: sviluppo dipendente da finanza esterna",
      "Copertura quasi integrale del fabbisogno strutturale",
      "Gli investimenti in struttura sono interamente autofinanziati",
    ]),
  },
  {
    id: "coperturaMantenimento",
    nome: "Copertura del mantenimento",
    sub: "Flusso operativo corrente / Capex di mantenimento",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d, ctx) => safeDiv(flussoCorrenteDi(d), capexMantenimentoDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Capex di mantenimento (mandatory)", value: capexMantenimentoDi(d, ctx) },
      { label: "Capex di sviluppo (discrezionale)", value: capexSviluppoDi(d, ctx) },
      {
        label: perAnno(ctx, "capexMantenimento") === null ? "Fonte: stimato sugli ammortamenti" : "Fonte: parametro manuale",
        value: null,
      },
    ],
    formula: "Flusso operativo corrente ÷ Capex di mantenimento",
    significato:
      "Il capex non è un blocco monolitico. La quota di mantenimento è un fabbisogno inderogabile — serve a non perdere capacità produttiva — e il flusso operativo deve assolutamente coprirla; la quota di sviluppo è discrezionale e può legittimamente richiedere finanza esterna. Solo il primo rapporto è un vincolo: è qui che si misura la sopravvivenza tecnologica della struttura.",
    giudizio: sogliaCrescente(1, 1.5, [
      "La gestione corrente non copre nemmeno il rinnovo della struttura esistente: erosione della capacità produttiva",
      "Il rinnovo è coperto, ma non resta margine per lo sviluppo",
      "Rinnovo coperto con avanzo destinabile allo sviluppo",
    ]),
  },
  {
    id: "tassoSviluppoInvestimenti",
    nome: "Tasso di sviluppo degli investimenti",
    sub: "Capex / Ammortamenti",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(capexTotaleDi(d), ammortamentiDi(d)),
    raw: (d) => [
      { label: "Capex dell'esercizio", value: capexTotaleDi(d) },
      { label: "Ammortamenti dell'esercizio", value: ammortamentiDi(d) },
      { label: "Immobilizzazioni operative nette", value: d?.sp?.immobilizzazioniOperative },
    ],
    formula: "Capex ÷ Ammortamenti",
    significato:
      "L'indicatore empirico che, dall'esterno, distingue il mantenimento dallo sviluppo. Intorno a 1 i nuovi investimenti si limitano a pareggiare l'usura fisiologica: la struttura si rinnova ma non cresce. Nettamente sopra 1 — tenuto conto dell'inflazione sui prezzi dei macchinari, che gonfia il numeratore a parità di capacità acquistata — segnala politiche attive di espansione. Stabilmente sotto 1 segnala disinvestimento silenzioso.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v < 0.8
        ? { level: "bad", testo: "Investimenti inferiori all'usura: la struttura si sta impoverendo" }
        : v <= 1.2
        ? { level: "warn", testo: "Investimenti di puro mantenimento: nessuna espansione della capacità" }
        : { level: "ok", testo: "Politica attiva di sviluppo della struttura produttiva" },
  },
];

/* ── Sezione 3.2 · Blocco D — Rendimento monetario netto ───────────────────── */

const IND_RENDIMENTO_MONETARIO = [
  {
    id: "cashFlowRos",
    nome: "Cash Flow ROS",
    sub: "Free cash flow operativo / Ricavi",
    unit: "pct",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d) => safeDiv(d?.rf?.fcfo, d?.ce?.ricavi),
    raw: (d) => [
      { label: "Free cash flow operativo", value: d?.rf?.fcfo },
      { label: "   di cui flusso corrente", value: flussoCorrenteDi(d) },
      { label: "   di cui capex", value: capexDi(d) },
      { label: "Ricavi di vendita", value: d?.ce?.ricavi },
    ],
    formula: "Free Cash Flow from Operations ÷ Ricavi di vendita × 100",
    significato:
      "La versione monetaria del ROS: quanta cassa netta — dopo aver pagato il circolante e rifinanziato la struttura — resta da ogni euro venduto. A differenza del margine contabile non è manovrabile con le politiche di ammortamento, e per questo è il numero che le agenzie di rating guardano per primo.",
    giudizio: sogliaCrescente(0, 0.05, [
      "Ogni euro di fatturato consuma cassa netta",
      "Rendimento monetario delle vendite positivo ma sottile",
      "Buona conversione del fatturato in cassa netta",
    ]),
  },
  {
    id: "cashFlowRoi",
    nome: "Cash Flow ROI",
    sub: "Free cash flow operativo / COIN",
    unit: "pct",
    betterWhen: "up",
    moduli: ["rf", "sp"],
    calc: (d) => cashFlowRoiDi(d),
    raw: (d) => [
      { label: "Free cash flow operativo", value: d?.rf?.fcfo },
      { label: "COIN — capitale operativo investito netto", value: d?.sp?.coin },
      { label: "ROI operativo contabile di confronto (%)", value: isNum(roiOperativoDi(d)) ? roiOperativoDi(d) * 100 : null },
    ],
    formula: "Free Cash Flow from Operations ÷ COIN × 100",
    significato:
      "Il rendimento monetario del capitale operativo investito: il benchmark da confrontare direttamente con il WACC. Se nel lungo periodo il rendimento di cassa resta inferiore al costo delle fonti, l'impresa distrugge valore in modo strutturale, e nessun utile contabile positivo può smentirlo — perché quell'utile non si è mai trasformato in moneta.",
    giudizio: sogliaCrescente(0.03, 0.07, [
      "Rendimento monetario del capitale investito molto basso o negativo",
      "Rendimento monetario positivo ma da confrontare con il costo del capitale",
      "Il capitale operativo produce un rendimento monetario solido",
    ]),
  },
  {
    id: "spreadMonetario",
    nome: "Spread monetario (Cash Flow ROI − WACC)",
    sub: "Creazione di valore misurata in cassa",
    unit: "pct",
    betterWhen: "up",
    moduli: ["rf", "sp"],
    richiede: chiedeWacc,
    calc: (d, ctx) => {
      const r = cashFlowRoiDi(d);
      const w = ctx?.par?.wacc;
      return isNum(r) && isNum(w) ? r - w : null;
    },
    raw: (d, ctx) => [
      { label: "Cash Flow ROI (%)", value: isNum(cashFlowRoiDi(d)) ? cashFlowRoiDi(d) * 100 : null },
      { label: "WACC (%)", value: isNum(ctx?.par?.wacc) ? ctx.par.wacc * 100 : null },
      { label: "ROI operativo contabile (%)", value: isNum(roiOperativoDi(d)) ? roiOperativoDi(d) * 100 : null },
    ],
    formula: "Cash Flow ROI − WACC",
    significato:
      "Lo stesso confronto dello spread ROI−WACC della Fase 2, condotto però su una grandezza monetaria anziché contabile. Il divario fra i due spread misura esattamente quanto della creazione di valore dichiarata a conto economico sia ancora ferma in crediti, scorte e immobilizzazioni, e quanto sia invece diventata cassa.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Inserire il WACC per attivare il confronto" }
        : v > 0.02
        ? { level: "ok", testo: "Il rendimento monetario supera nettamente il costo del capitale" }
        : v > 0
        ? { level: "warn", testo: "Spread monetario positivo ma fragile" }
        : { level: "bad", testo: "Il rendimento di cassa non copre il costo delle fonti: distruzione di valore strutturale" },
  },
];

/* ── Sezione 3.2 · Blocco F — Servizio del debito ──────────────────────────── */

const IND_SERVIZIO_DEBITO = [
  {
    id: "coperturaInteressiEbitda",
    nome: "Copertura degli interessi",
    sub: "EBITDA / Oneri finanziari",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => safeDiv(d?.ce?.ebitda, oneriDi(d)),
    raw: (d) => [
      { label: "EBITDA", value: d?.ce?.ebitda },
      { label: "Flusso operativo corrente (misura più severa)", value: flussoCorrenteDi(d) },
      { label: "Oneri finanziari", value: oneriDi(d) },
    ],
    formula: "EBITDA ÷ Oneri finanziari",
    significato:
      "Il primo pilastro delle metriche di rating. Deve tassativamente superare 1: sotto quella soglia l'impresa si sta indebitando ulteriormente solo per pagare gli interessi sul debito pregresso, lo schema tipico del tracollo finanziario. L'EBITDA è però un'approssimazione contabile lorda: dove il rendiconto è disponibile, il flusso operativo corrente è la misura da preferire.",
    giudizio: sogliaCrescente(2, 5, [
      "Copertura degli interessi critica",
      "Copertura sufficiente ma sensibile a rialzi dei tassi",
      "Ampia capacità di sostenere il costo del debito",
    ]),
  },
  {
    id: "coperturaQuoteCapitale",
    nome: "Copertura delle quote capitale",
    sub: "Flusso operativo corrente / Quote di rimborso",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf"],
    calc: (d, ctx) => safeDiv(flussoCorrenteDi(d), quoteCapitaleDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "EBITDA di confronto", value: d?.ce?.ebitda },
      { label: "Servizio del debito complessivo", value: d?.rf?.servizioDelDebito },
      { label: "   di cui oneri finanziari", value: oneriDi(d) },
      { label: "   di cui quote capitale", value: quoteCapitaleDi(d, ctx) },
    ],
    formula: "Flusso operativo corrente ÷ Quote capitale rimborsate",
    significato:
      "La quota capitale di un mutuo non è fiscalmente deducibile e si paga solo con cassa netta reale: per questo il numeratore corretto non è l'EBITDA ma un margine di cassa al netto delle imposte, e il flusso operativo corrente lo approssima molto meglio. Anche qui la soglia è 1: sotto, il rimborso avviene con nuova finanza, non con la gestione.",
    giudizio: sogliaCrescente(1, 1.5, [
      "Il rimborso del debito non è coperto dalla cassa prodotta: si rimborsa indebitandosi",
      "Copertura del rimborso appena sufficiente",
      "Rimborsi ampiamente coperti dalla gestione corrente",
    ]),
  },
  {
    id: "paybackDebito",
    nome: "Pay-back del debito",
    sub: "Anni teorici di rimborso a flussi costanti",
    unit: "dec",
    betterWhen: "down",
    moduli: ["rf", "sp"],
    calc: (d) => {
      const f = flussoCorrenteDi(d);
      return isNum(d?.sp?.pfn) && isNum(f) && f > 0 ? d.sp.pfn / f : null;
    },
    raw: (d, ctx) => [
      { label: "Indebitamento finanziario netto (PFN)", value: d?.sp?.pfn },
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "Indice flusso ÷ PFN (×100)", value: isNum(safeDiv(flussoCorrenteDi(d), d?.sp?.pfn)) ? safeDiv(flussoCorrenteDi(d), d.sp.pfn) * 100 : null },
      { label: "Duration media del debito dichiarata (anni)", value: perAnno(ctx, "durationDebito") },
    ],
    formula: "Pay-back = PFN ÷ Flusso operativo corrente  ≡  1 ÷ (Flusso ÷ PFN)",
    significato:
      "Quanti esercizi servirebbero, a flussi costanti, per azzerare lo stock di debito. Un indice flusso/debito di 0,2 significa cinque anni. Il numero non ha senso in assoluto: va confrontato con la scadenza media (duration) del debito in essere. Un pay-back di otto anni su un debito che scade in tre è un disallineamento che si risolverà solo con un rifinanziamento, cioè con il consenso di terzi.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Con flusso corrente non positivo il pay-back non è calcolabile" }
        : v <= 3
        ? { level: "ok", testo: "Debito rimborsabile in pochi esercizi con la cassa corrente" }
        : v <= 6
        ? { level: "warn", testo: "Orizzonte di rimborso lungo: verificare l'allineamento con la duration del debito" }
        : { level: "bad", testo: "Orizzonte di rimborso molto lungo: la restituzione dipende dal rifinanziamento" },
  },
  {
    id: "solvibilitaSevera",
    nome: "Solvibilità severa",
    sub: "FCF per pagamenti vincolati / (Oneri + Rimborsi)",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf", "ce"],
    calc: (d, ctx) => safeDiv(fcfVincolatiDi(d, ctx), somma(oneriDi(d), quoteCapitaleDi(d, ctx))),
    raw: (d, ctx) => [
      { label: "Flusso operativo corrente", value: flussoCorrenteDi(d) },
      { label: "− Capex di mantenimento", value: capexMantenimentoDi(d, ctx) },
      { label: "= FCF per pagamenti vincolati", value: fcfVincolatiDi(d, ctx) },
      { label: "Oneri finanziari", value: oneriDi(d) },
      { label: "Quote capitale", value: quoteCapitaleDi(d, ctx) },
      { label: "Servizio del debito totale", value: somma(oneriDi(d), quoteCapitaleDi(d, ctx)) },
    ],
    formula: "(Flusso corrente − Capex di mantenimento) ÷ (Oneri finanziari + Quote capitale)",
    significato:
      "L'indice più rappresentativo della solvibilità reale. Un'impresa è davvero solvibile solo se può pagare il debito dopo aver garantito la sopravvivenza tecnologica della propria struttura: pagare le banche lasciando deperire gli impianti non è solvibilità, è un rinvio. Il capex di sviluppo, che è discrezionale, resta invece fuori dal calcolo.",
    giudizio: sogliaCrescente(1, 1.5, [
      "Dopo il rinnovo della struttura non resta cassa per servire il debito",
      "Copertura del servizio del debito appena sufficiente al netto del mantenimento",
      "Il debito è servito con la cassa che avanza dopo il rinnovo della struttura",
    ]),
  },
];

/* ── Sezione 3.2 · Blocco G — Servizio dell'equity ─────────────────────────── */

const IND_SERVIZIO_EQUITY = [
  {
    id: "coperturaDividendi",
    nome: "Copertura dei dividendi",
    sub: "Free cash flow to equity / Dividendi distribuiti",
    unit: "x",
    betterWhen: "up",
    moduli: ["rf"],
    calc: (d, ctx) => safeDiv(fcfeDi(d), dividendiPagatiDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Free cash flow to equity", value: fcfeDi(d) },
      { label: "   di cui FCFO", value: d?.rf?.fcfo },
      { label: "   di cui servizio del debito", value: d?.rf?.servizioDelDebito },
      { label: "Dividendi distribuiti e buy-back", value: dividendiPagatiDi(d, ctx) },
    ],
    formula: "Free Cash Flow to Equity ÷ Dividendi distribuiti",
    significato:
      "Soddisfatto il debito, che ha priorità giuridica e finanziaria assoluta, la cassa residua è a disposizione degli azionisti. Sotto 1 l'impresa distribuisce dividendi consumando le scorte liquide o indebitandosi: erode valore aziendale per appagare i soci nel breve periodo, che è l'esatto contrario della funzione del dividendo.",
    giudizio: sogliaCrescente(1, 1.5, [
      "Dividendi distribuiti oltre la cassa disponibile: si attinge a liquidità o a nuovo debito",
      "Dividendi coperti di stretta misura",
      "Distribuzione ampiamente coperta dalla cassa residua",
    ]),
  },
  {
    id: "payout",
    nome: "Pay-out ratio",
    sub: "Dividendi / Utile netto",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d, ctx) => safeDiv(dividendiPagatiDi(d, ctx), d?.ce?.utileNetto),
    raw: (d, ctx) => [
      { label: "Dividendi distribuiti", value: dividendiPagatiDi(d, ctx) },
      { label: "Utile netto dell'esercizio", value: d?.ce?.utileNetto },
      { label: "Utile trattenuto (autofinanziamento)", value: sottrai(d?.ce?.utileNetto, dividendiPagatiDi(d, ctx)) },
    ],
    formula: "Dividendi distribuiti ÷ Utile netto × 100",
    significato:
      "La quota di utile che esce dall'impresa. Sopra il 100% si stanno staccando dividendi attingendo a riserve di utili accumulati in passato: una scelta legittima e talvolta dichiarata, che però non è ripetibile e va letta insieme alla copertura di cassa dei dividendi.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v < 0
        ? { level: "warn", testo: "Distribuzione in presenza di perdita: si attinge a riserve" }
        : v > 1
        ? { level: "bad", testo: "Distribuito più dell'utile dell'esercizio: si stanno erodendo le riserve" }
        : v > 0.7
        ? { level: "warn", testo: "Pay-out elevato: poco utile trattenuto per l'autofinanziamento" }
        : { level: "ok", testo: "Quota rilevante di utile trattenuta in azienda" },
  },
  {
    id: "flussoDiscrezionale",
    nome: "Flusso di cassa discrezionale",
    sub: "FCFE − dividendi vincolati",
    unit: "val",
    betterWhen: "up",
    moduli: ["rf"],
    calc: (d, ctx) => {
      const f = fcfeDi(d);
      const vinc = perAnno(ctx, "dividendiPrivilegiati");
      return isNum(f) ? f - (isNum(vinc) ? Math.abs(vinc) : 0) : null;
    },
    raw: (d, ctx) => [
      { label: "Free cash flow to equity", value: fcfeDi(d) },
      { label: "Dividendi privilegiati o statutariamente obbligatori", value: perAnno(ctx, "dividendiPrivilegiati") },
      { label: "Dividendi ordinari distribuiti", value: dividendiPagatiDi(d, ctx) },
    ],
    formula: "Flusso discrezionale = FCFE − dividendi statutariamente vincolati",
    significato:
      "Dove esistono azionisti privilegiati o di risparmio con dividendi statutariamente obbligatori, quegli esborsi si comportano come debiti e vanno decurtati a monte. Ciò che resta è l'unica risorsa realmente disponibile per l'espansione strategica libera: è su questo numero, non sul FCFE lordo, che si misura lo spazio di manovra del management.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "Resta cassa libera per scelte strategiche discrezionali" }
        : { level: "warn", testo: "Nessuno spazio di manovra: gli impegni assorbono l'intera cassa residua" },
  },
  {
    id: "eps",
    nome: "Utile per azione (EPS)",
    sub: "Utile netto / Numero azioni",
    unit: "dec",
    betterWhen: "up",
    moduli: ["ce"],
    richiede: (ctx) => (isNum(azioniDi(ctx)) ? null : "Richiede il numero di azioni in circolazione (parametri per esercizio)"),
    calc: (d, ctx) => safeDiv(d?.ce?.utileNetto, azioniDi(ctx)),
    raw: (d, ctx) => [
      { label: "Utile netto", value: d?.ce?.utileNetto },
      { label: "Numero di azioni", value: azioniDi(ctx) },
      { label: "Cash dividend per azione", value: safeDiv(dividendiPagatiDi(d, ctx), azioniDi(ctx)) },
    ],
    formula: "Utile netto ÷ Numero di azioni in circolazione",
    significato:
      "La grandezza che il mercato osserva per prima nelle società quotate, e il denominatore naturale del cash dividend per azione. Da leggere sempre in coppia con quest'ultimo: un EPS alto accompagnato da un dividendo per azione che il flusso di cassa non copre è un utile che esiste solo in bilancio.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Indicare il numero di azioni per attivare l'indice" }
        : v > 0
        ? { level: "ok", testo: "Utile per azione positivo" }
        : { level: "bad", testo: "Perdita per azione" },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-septies. RACCOLTA, RISCHIO FINANZIARIO E COSTO DEL CAPITALE
   ═══════════════════════════════════════════════════════════════════════════
   Chiusura obbligata dell'indagine sul Rendiconto: dopo la produzione e
   l'assorbimento, l'area della RACCOLTA — le operazioni con cui l'impresa
   acquisisce nuovi mezzi dal mercato finanziario esterno. Il giudizio non si
   dà sui flussi annuali isolati, ma lungo due coordinate: la proporzione fra
   mezzi propri e mezzi di terzi, e la congruenza temporale fra fonti durevoli
   e fonti a breve rispetto alla natura del fabbisogno manifestatosi.

   Da qui l'analisi trascolora nella misura del RISCHIO FINANZIARIO, che va
   incorporato nel costo del capitale: WACC e flussi di cassa sono le due
   variabili da cui dipende il valore fondamentale dell'impresa. Il rischio
   d'insolvenza impatta direttamente il costo del debito, attraverso il credit
   spread, e indirettamente ma severamente il costo dell'equity, attraverso la
   leva finanziaria e il beta re-levered.

   AVVERTENZA SULLE TABELLE DI RATING E SUI MODELLI. Le scale di rating, gli
   spread per classe e la mappa PD→rating implementate qui sono ordini di
   grandezza didattici, coerenti con le figure del testo di riferimento ma NON
   dati di mercato aggiornati: servono a rendere percorribile il ragionamento,
   non a sostituire il giudizio di un'agenzia. Lo scoring quantitativo, per
   sua natura, va sempre integrato con dati qualitativi (settore) e andamentali
   (Centrale dei Rischi).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Totale attivo, dal modulo SP o ricostruito dalle due zone finanziarie. */
const totaleAttivoDi = (d) =>
  isNum(d?.sp?.totaleAttivo) ? d.sp.totaleAttivo : somma(attivitaImmobilizzateDi(d), attivitaCorrentiDi(d));

/**
 * Aumenti di capitale di rischio dell'esercizio, per differenza: la variazione
 * di patrimonio netto depurata del risultato d'esercizio e dei dividendi
 * pagati è ciò che i soci hanno conferito (o prelevato, se negativo).
 */
const aumentiCapitaleDi = (d, ctx) => {
  const pn1 = d?.sp?.patrimonioNetto;
  const pn0 = ctx?.prec?.sp?.patrimonioNetto;
  if (!isNum(pn1) || !isNum(pn0)) return null;
  const utile = d?.ce?.utileNetto;
  const div = dividendiPagatiDi(d, ctx);
  return pn1 - pn0 - (isNum(utile) ? utile : 0) + (isNum(div) ? div : 0);
};

/** Variazione dei debiti finanziari a medio-lungo termine. */
const nuoviDebitiMlDi = (d, ctx) => sottraiStretto(d?.sp?.debitiFinanziariLungo, ctx?.prec?.sp?.debitiFinanziariLungo);

/** Variazione della posizione finanziaria netta a breve. */
const variazionePfnBreveDi = (d, ctx) => sottraiStretto(pfnCorrenteDi(d), pfnCorrenteDi(ctx?.prec));

/** Fonti durevoli nuove: equity conferito + debito a medio-lungo. */
const fontiDurevoliNuoveDi = (d, ctx) => somma(aumentiCapitaleDi(d, ctx), nuoviDebitiMlDi(d, ctx));

/** Raccolta NETTA dal mercato finanziario: accensioni meno rimborsi. */
const raccoltaTotaleDi = (d, ctx) => somma(fontiDurevoliNuoveDi(d, ctx), variazionePfnBreveDi(d, ctx));

/** Solo la parte in ENTRATA delle tre componenti: è la base su cui ha senso
 *  pesare il mix delle fonti, perché una componente in rimborso non è raccolta
 *  e mescolarla con le altre produrrebbe quozienti privi di significato. */
const positivo = (v) => (isNum(v) && v > 0 ? v : 0);
const raccoltaLordaDi = (d, ctx) => {
  const a = aumentiCapitaleDi(d, ctx);
  const m = nuoviDebitiMlDi(d, ctx);
  const b = variazionePfnBreveDi(d, ctx);
  if (![a, m, b].some(isNum)) return null;
  return positivo(a) + positivo(m) + positivo(b);
};
/** Quota durevole della sola raccolta in entrata. */
const durevoliLordeDi = (d, ctx) => {
  const a = aumentiCapitaleDi(d, ctx);
  const m = nuoviDebitiMlDi(d, ctx);
  if (!isNum(a) && !isNum(m)) return null;
  return positivo(a) + positivo(m);
};
/** Rimborsi netti dell'esercizio, cioè la parte in uscita delle stesse tre voci. */
const rimborsiNettiDi = (d, ctx) => {
  const negativi = [aumentiCapitaleDi(d, ctx), nuoviDebitiMlDi(d, ctx), variazionePfnBreveDi(d, ctx)]
    .filter(isNum)
    .filter((v) => v < 0);
  return negativi.length ? negativi.reduce((acc, v) => acc + v, 0) : null;
};

/** Disinvestimenti: capex di segno positivo, cioè realizzi netti di struttura. */
const disinvestimentiDi = (d, ctx) => {
  const m = perAnno(ctx, "disinvestimenti");
  if (isNum(m)) return Math.abs(m);
  const c = capexDi(d);
  return isNum(c) && c > 0 ? c : null;
};

/** Fonti prodotte internamente: autofinanziamento netto + disinvestimenti. */
const fonteInternaDi = (d, ctx) => somma(autofinanziamentoNettoDi(d), disinvestimentiDi(d, ctx));

/** Fabbisogno di FUNZIONAMENTO: espansione del circolante + esborsi ai soci. */
const fabbisognoFunzionamentoDi = (d, ctx) => {
  const dc = isNum(d?.sp?.ccno) && isNum(ctx?.prec?.sp?.ccno) ? d.sp.ccno - ctx.prec.sp.ccno : null;
  return somma(isNum(dc) && dc > 0 ? dc : null, dividendiPagatiDi(d, ctx));
};

/** Fabbisogno STRUTTURALE: investimenti durevoli dell'esercizio. */
const fabbisognoStrutturaleDi = (d) => capexTotaleDi(d);

/* ── Costo del capitale ────────────────────────────────────────────────────── */

/** Parametri CAPM normalizzati: nella tabella di Fase 1 sono in percentuale. */
const capmDi = (ctx) => {
  const c = ctx?.par?.capm || {};
  const perc = (v) => (isNum(num(v)) ? num(v) / 100 : null);
  return {
    betaL: num(c.betaL),
    deSettore: num(c.deSettore),
    tSettore: perc(c.tSettore),
    gloSettore: num(c.gloSettore),
    rf: perc(c.rf),
    erp: perc(c.erp),
  };
};

/** Costo lordo del debito, stimato sugli oneri effettivamente sostenuti. */
const kdLordoDi = (d) => safeDiv(oneriDi(d), debitiFinanziariDi(d));

/** Costo del debito al netto dello scudo fiscale: Kd × (1 − t). */
const kdNettoDi = (d, ctx) => {
  const kd = kdLordoDi(d);
  const t = aliquotaDi(ctx);
  return isNum(kd) && isNum(t) ? kd * (1 - t) : null;
};

/** Valore del debito e dell'equity: di mercato se indicati, altrimenti contabili. */
const debitoValoreDi = (d, ctx) => perAnno(ctx, "debitoMercato") ?? debitiFinanziariDi(d);
const equityValoreDi = (d, ctx) => perAnno(ctx, "equityMercato") ?? d?.sp?.patrimonioNetto ?? null;
/* Il valore della cella è quello copiato in automatico dallo Stato Patrimoniale
   (par.autoDaSP) e non un dato inserito dall'analista o letto nei documenti. */
const daSP = (ctx, k) => {
  const auto = ctx?.par?.autoDaSP?.[ctx?.anno]?.[k];
  return auto != null && String(ctx?.par?.perAnno?.[ctx?.anno]?.[k] ?? "") === String(auto);
};

/** Rapporto di indebitamento a valori di mercato (o contabili). */
const deDi = (d, ctx) => safeDiv(debitoValoreDi(d, ctx), equityValoreDi(d, ctx));

/** Peso del debito sul capitale complessivo: D / (D + E). */
const pesoDebitoDi = (d, ctx) => {
  const D = debitoValoreDi(d, ctx);
  const E = equityValoreDi(d, ctx);
  return isNum(D) && isNum(E) ? safeDiv(D, D + E) : null;
};

/** Beta unlevered di settore: il beta levered depurato della leva media di settore. */
const betaUnleveredSettoreDi = (ctx) => {
  const p = capmDi(ctx);
  if (!isNum(p.betaL) || !isNum(p.deSettore) || !isNum(p.tSettore)) return null;
  const den = 1 + (1 - p.tSettore) * p.deSettore;
  return den === 0 ? null : p.betaL / den;
};

/** Beta RE-LEVERED sull'effettivo D/E dell'impresa: βl = βu × [1 + (1−t)·D/E]. */
const betaRelevatoDi = (d, ctx) => {
  const bu = betaUnleveredSettoreDi(ctx);
  const de = deDi(d, ctx);
  const t = aliquotaDi(ctx) ?? capmDi(ctx).tSettore;
  return isNum(bu) && isNum(de) && isNum(t) ? bu * (1 + (1 - t) * de) : null;
};

/** Costo dell'equity dal CAPM, con il beta re-levered dell'impresa. */
const keDi = (d, ctx) => {
  const p = capmDi(ctx);
  const b = betaRelevatoDi(d, ctx);
  return isNum(b) && isNum(p.rf) && isNum(p.erp) ? p.rf + b * p.erp : null;
};

/** WACC ricostruito dai suoi componenti: Kd(1−t)·D/(D+E) + Ke·E/(D+E). */
const waccRicostruitoDi = (d, ctx) => {
  const kdn = kdNettoDi(d, ctx);
  const ke = keDi(d, ctx);
  const wd = pesoDebitoDi(d, ctx);
  return isNum(kdn) && isNum(ke) && isNum(wd) ? kdn * wd + ke * (1 - wd) : null;
};

/** WACC del sistema: il WACC ricostruito dell'esercizio più recente con dati
 *  attendibili. Si saltano i periodi in cui il costo lordo del debito
 *  (oneri finanziari ÷ debiti finanziari) è nullo o oltre il 20%, che indica
 *  oneri o debiti letti male, e i WACC fuori da (0, 30%). */
export function waccAutomatico(esercizi, par) {
  const anni = Object.keys(esercizi || {}).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  const scartati = [];
  for (const a of anni) {
    const d = esercizi[a];
    const ctx = { par, anno: a };
    const w = waccRicostruitoDi(d, ctx);
    const kd = kdLordoDi(d);
    if (!isNum(w) || !isNum(kd) || kd <= 0 || kd > 0.2 || w <= 0 || w >= 0.3) {
      if (isNum(d?.ce?.oneriFinanziari) || isNum(debitiFinanziariDi(d))) scartati.push(a);
      continue;
    }
    return { wacc: Math.round(w * 10000) / 10000, anno: a, kd, ke: keDi(d, ctx), wd: pesoDebitoDi(d, ctx), scartati };
  }
  return { wacc: null, anno: null, scartati };
}

/** Riga che dice da dove viene il WACC e permette di tornare al calcolo. */
function NotaWacc({ par, onPar }) {
  const fonte = par?.waccFonte ?? (isNum(par?.wacc) ? "manuale" : "auto");
  const a = par?.waccAuto;
  const pc = (v) => (isNum(v) ? `${(v * 100).toFixed(1).replace(".", ",")}%` : "n.d.");
  const anno = (x) => String(x).replace(".", ",");
  const testo =
    fonte === "manuale"
      ? "Inserito a mano: il calcolo automatico è sospeso."
      : a?.anno != null
      ? `Calcolato dal sistema: WACC ricostruito ${anno(a.anno)} (Kd ${pc(a.kd)} lordo, Ke ${pc(a.ke)}, peso del debito ${pc(a.wd)}).${a.scartati?.length ? ` Saltati ${a.scartati.map(anno).join(", ")}: costo del debito non attendibile (oneri o debiti finanziari da controllare).` : ""}`
      : "Il sistema non riesce a calcolarlo: servono Rf, ERP e beta di settore (sub-tab «4 · Dati macro & CAPM»), l'aliquota e oneri e debiti finanziari attendibili in almeno un esercizio.";
  return (
    <span className="text-[10px] leading-snug" style={{ fontFamily: FONT_BODY, color: fonte === "manuale" ? PURPLE : `${INK}90` }}>
      {testo}{" "}
      {fonte === "manuale" && (
        <button type="button" onClick={(e) => { e.preventDefault(); onPar({ waccFonte: "auto" }); }} className="underline" style={{ color: PURPLE }}>
          ↺ usa il WACC calcolato
        </button>
      )}
    </span>
  );
}

/** Grado di leva finanziaria: MON / reddito corrente ante imposte. */
const glfDi = (d) => {
  const mon = d?.ce?.mon;
  const on = oneriDi(d);
  if (!isNum(mon)) return null;
  const corrente = isNum(d?.ce?.risultatoAnteImposte)
    ? d.ce.risultatoAnteImposte
    : isNum(on)
    ? mon - on
    : null;
  return safeDiv(mon, corrente);
};

/* ── Rating sintetico ─────────────────────────────────────────────────────────
   Scala accorpata alle classi principali. Coverage: EBIT ÷ oneri finanziari.
   Gli spread e le mediane di Debt/EBITDA sono ORDINI DI GRANDEZZA didattici. */

const SCALA_RATING = [
  { classe: "AAA / Aaa", da: 8.5, spread: 0.0065, debtEbitda: "< 1,0", grado: "investment" },
  { classe: "AA / Aa", da: 6.5, spread: 0.0085, debtEbitda: "1,0 – 1,5", grado: "investment" },
  { classe: "A / A", da: 4.25, spread: 0.0118, debtEbitda: "1,5 – 2,0", grado: "investment" },
  { classe: "BBB / Baa", da: 2.5, spread: 0.02, debtEbitda: "2,0 – 3,0", grado: "investment" },
  { classe: "BB / Ba", da: 2.0, spread: 0.032, debtEbitda: "3,0 – 4,0", grado: "speculative" },
  { classe: "B / B", da: 1.25, spread: 0.048, debtEbitda: "4,0 – 5,5", grado: "speculative" },
  { classe: "CCC / Caa", da: 0.65, spread: 0.085, debtEbitda: "5,5 – 7,0", grado: "speculative" },
  { classe: "CC – D", da: -Infinity, spread: 0.13, debtEbitda: "> 7,0", grado: "speculative" },
];

/** Copertura degli interessi in versione «EBIT interest cover», usata dal rating. */
const ebitCoverDi = (d) => safeDiv(d?.ce?.ebit, oneriDi(d));

const classeRatingDi = (cover) => (isNum(cover) ? SCALA_RATING.find((r) => cover >= r.da) || SCALA_RATING[7] : null);

/* ── Modelli quantitativi di previsione dell'insolvenza ─────────────────────── */

/**
 * Z-Score di Altman nella versione per imprese NON quotate (Z'):
 * Z' = 0,717·X1 + 0,847·X2 + 3,107·X3 + 0,420·X4 + 0,998·X5
 * Soglie: sopra 2,90 area di sicurezza · 1,23–2,90 area grigia · sotto 1,23
 * area di insolvenza.
 */
const zScoreDi = (d, ctx) => {
  const ta = totaleAttivoDi(d);
  const ricavi = d?.ce?.ricavi;
  const pn = d?.sp?.patrimonioNetto;
  if (!isNum(ta) || ta === 0) return null;
  const debitiTot = isNum(pn) ? ta - pn : null;
  const riserve = perAnno(ctx, "utiliNonDistribuiti");
  const x1 = safeDiv(ccnfDi(d), ta);
  const x2 = safeDiv(riserve, ta);
  const x3 = safeDiv(d?.ce?.ebit, ta);
  const x4 = safeDiv(pn, debitiTot);
  const x5 = safeDiv(ricavi, ta);
  const termini = [
    { k: "X1", nome: "Capitale circolante netto / Totale attivo", peso: 0.717, valore: x1 },
    { k: "X2", nome: "Utili non distribuiti / Totale attivo", peso: 0.847, valore: x2 },
    { k: "X3", nome: "EBIT / Totale attivo", peso: 3.107, valore: x3 },
    { k: "X4", nome: "Patrimonio netto / Debiti totali", peso: 0.42, valore: x4 },
    { k: "X5", nome: "Ricavi / Totale attivo", peso: 0.998, valore: x5 },
  ];
  // X2 manca quasi sempre nei moduli: si tratta come zero, dichiarandolo.
  const disponibili = termini.filter((t) => isNum(t.valore));
  if (disponibili.length < 3) return null;
  const z = disponibili.reduce((acc, t) => acc + t.peso * t.valore, 0);
  return { z, termini, mancanti: termini.filter((t) => !isNum(t.valore)).map((t) => t.k) };
};

const zonaZScore = (z) =>
  !isNum(z)
    ? null
    : z >= 2.9
    ? { level: "ok", nome: "Area di sicurezza" }
    : z >= 1.23
    ? { level: "warn", nome: "Area grigia" }
    : { level: "bad", nome: "Area di insolvenza" };

/**
 * Modello Logit calibrato sulle PMI italiane, default a 18 mesi.
 * Scoring = −2,4169 + 43,2384·(OF/Ricavi) − 3,6288·(PN/TA) − 5,0998·(EBITDA/Ricavi)
 *           − 0,3578·(Rimanenze/Consumi) − 0,4535·(TA/Ricavi)
 * PD = 1 / (1 + e^(−Scoring)).
 */
const COEFF_LOGIT = [
  { k: "of", nome: "Oneri finanziari / Ricavi", peso: 43.2384 },
  { k: "pn", nome: "Patrimonio netto / Totale attivo", peso: -3.6288 },
  { k: "ebitda", nome: "EBITDA / Ricavi", peso: -5.0998 },
  { k: "scorte", nome: "Rimanenze / Consumo merci", peso: -0.3578 },
  { k: "attivo", nome: "Totale attivo / Ricavi", peso: -0.4535 },
];

const logitPmiDi = (d, ctx) => {
  const ta = totaleAttivoDi(d);
  const ricavi = d?.ce?.ricavi;
  const valori = {
    of: safeDiv(oneriDi(d), ricavi),
    pn: safeDiv(d?.sp?.patrimonioNetto, ta),
    ebitda: safeDiv(d?.ce?.ebitda, ricavi),
    scorte: safeDiv(disponibilitaDi(d), costoVendutoDi(d, ctx)),
    attivo: safeDiv(ta, ricavi),
  };
  const termini = COEFF_LOGIT.map((c) => ({ ...c, valore: valori[c.k], contributo: isNum(valori[c.k]) ? c.peso * valori[c.k] : null }));
  if (termini.some((t) => !isNum(t.contributo))) return null;
  const scoring = -2.4169 + termini.reduce((acc, t) => acc + t.contributo, 0);
  const pd = 1 / (1 + Math.exp(-scoring));
  return { scoring, pd, termini, intercetta: -2.4169 };
};

/** Mappa PD → classe di rating per PMI. Ordini di grandezza illustrativi. */
const SCALA_PD = [
  { fino: 0.0005, classe: "AAA" },
  { fino: 0.0015, classe: "AA" },
  { fino: 0.004, classe: "A" },
  { fino: 0.012, classe: "BBB" },
  { fino: 0.03, classe: "BB" },
  { fino: 0.08, classe: "B" },
  { fino: 0.2, classe: "CCC" },
  { fino: 0.35, classe: "CC" },
  { fino: 0.6, classe: "C" },
  { fino: 1.01, classe: "D" },
];

const classeDaPd = (pd) => (isNum(pd) ? SCALA_PD.find((r) => pd < r.fino) || SCALA_PD[9] : null);

/* ── Sezione 3.3 · Blocco A-B — Composizione della raccolta ────────────────── */

const IND_RACCOLTA = [
  {
    id: "aumentiCapitale",
    nome: "Aumenti di capitale di rischio",
    sub: "Variazione del PN depurata di utile e dividendi",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp", "ce"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => aumentiCapitaleDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Patrimonio netto di fine esercizio", value: d?.sp?.patrimonioNetto },
      { label: "Patrimonio netto di inizio esercizio", value: ctx?.prec?.sp?.patrimonioNetto },
      { label: "− Utile dell'esercizio", value: d?.ce?.utileNetto },
      { label: "+ Dividendi distribuiti", value: dividendiPagatiDi(d, ctx) },
    ],
    formula: "ΔPN − Utile netto + Dividendi distribuiti",
    significato:
      "Quanto capitale di rischio i soci hanno effettivamente conferito nell'esercizio. Il calcolo è per differenza perché il patrimonio netto varia per tre cause distinte — utile, distribuzioni e conferimenti — e solo la terza è raccolta vera e propria. Un valore negativo segnala rimborsi di capitale o riacquisto di azioni proprie.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "I soci hanno conferito nuovo capitale di rischio" }
        : v < 0
        ? { level: "warn", testo: "Capitale restituito ai soci: la base di rischio si è ridotta" }
        : { level: "info", testo: "Nessun movimento sul capitale di rischio" },
  },
  {
    id: "nuoviDebitiMl",
    nome: "Nuovi debiti a medio-lungo",
    sub: "Variazione dei debiti finanziari consolidati",
    unit: "val",
    betterWhen: "up",
    moduli: ["sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => nuoviDebitiMlDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Debiti finanziari m/l di fine esercizio", value: d?.sp?.debitiFinanziariLungo },
      { label: "Debiti finanziari m/l di inizio esercizio", value: ctx?.prec?.sp?.debitiFinanziariLungo },
      { label: "Quote capitale rimborsate nell'esercizio", value: quoteCapitaleDi(d, ctx) },
    ],
    formula: "Debiti m/l t − Debiti m/l t−1",
    significato:
      "La variazione netta del debito consolidato: accensioni meno rimborsi. È la seconda componente dei capitali permanenti, cioè dei mezzi che resteranno durevolmente a disposizione dell'impresa. Un valore negativo non è di per sé un bene: può significare deleveraging virtuoso oppure impossibilità di rinnovare le linee a medio termine, e la distinzione si fa guardando la variazione del breve.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "info", testo: "Raccolta netta di debito consolidato" }
        : { level: "info", testo: "Rimborso netto di debito consolidato" },
  },
  {
    id: "pesoFontiDurevoli",
    nome: "Peso delle fonti durevoli",
    sub: "(Equity + debito m/l) / Raccolta in entrata",
    unit: "pct",
    betterWhen: "up",
    moduli: ["sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => safeDiv(durevoliLordeDi(d, ctx), raccoltaLordaDi(d, ctx)),
    raw: (d, ctx) => [
      { label: "Aumenti di capitale", value: aumentiCapitaleDi(d, ctx) },
      { label: "Nuovi debiti a medio-lungo", value: nuoviDebitiMlDi(d, ctx) },
      { label: "Variazione della PFN a breve", value: variazionePfnBreveDi(d, ctx) },
      { label: "= Raccolta in entrata (sole componenti positive)", value: raccoltaLordaDi(d, ctx) },
      { label: "   di cui capitali permanenti", value: durevoliLordeDi(d, ctx) },
      { label: "Rimborsi netti dell'esercizio", value: rimborsiNettiDi(d, ctx) },
      { label: "= Raccolta netta", value: raccoltaTotaleDi(d, ctx) },
    ],
    formula: "Capitali permanenti raccolti ÷ Raccolta in entrata × 100",
    significato:
      "Il mix temporale delle fonti raccolte. Quanto più la raccolta poggia su capitali permanenti, tanto più l'impresa si è assicurata mezzi stabili; quanto più poggia sul breve, tanto più resta esposta alla revoca degli affidamenti. Il peso si calcola sulle sole componenti in entrata: una voce in rimborso non è raccolta, e sommarla alle altre produrrebbe un quoziente privo di significato. Il giudizio va poi dato confrontando il mix con la natura del fabbisogno che l'ha generato — è il blocco C.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Nessuna raccolta in entrata nell'esercizio, o dati insufficienti: l'anno si è chiuso con soli rimborsi" }
        : v >= 0.7
        ? { level: "ok", testo: "Raccolta prevalentemente durevole: mezzi stabilmente a disposizione" }
        : v >= 0.35
        ? { level: "warn", testo: "Raccolta mista: verificare la coerenza con la natura del fabbisogno" }
        : { level: "bad", testo: "Raccolta concentrata sul breve termine: esposizione alla revoca degli affidamenti" },
  },
  {
    id: "autosufficienza",
    nome: "Autosufficienza finanziaria",
    sub: "Fonti interne / Fonti complessive",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => {
      const interne = fonteInternaDi(d, ctx);
      const esterne = raccoltaLordaDi(d, ctx);
      const tot = somma(interne, esterne);
      return isNum(interne) && isNum(tot) && tot !== 0 ? interne / tot : null;
    },
    raw: (d, ctx) => [
      { label: "Autofinanziamento netto", value: autofinanziamentoNettoDi(d) },
      { label: "Disinvestimenti di struttura", value: disinvestimentiDi(d, ctx) },
      { label: "= Fonti prodotte internamente", value: fonteInternaDi(d, ctx) },
      { label: "Raccolta in entrata dal mercato finanziario", value: raccoltaLordaDi(d, ctx) },
      { label: "Rimborsi netti dell'esercizio", value: rimborsiNettiDi(d, ctx) },
    ],
    formula: "Fonti interne ÷ (Fonti interne + Raccolta esterna) × 100",
    significato:
      "La proporzione esatta fra autosufficienza aziendale e dipendenza dai mercati terzi. È la lettura allargata che completa il quadro della raccolta: un'impresa che copre da sé la quasi totalità delle proprie fonti conserva libertà strategica, perché non deve chiedere permesso a nessuno per muoversi — e i tempi della finanza esterna sono lenti rispetto a quelli della concorrenza.",
    giudizio: sogliaCrescente(0.4, 0.7, [
      "Fonti prevalentemente esterne: forte dipendenza dai mercati finanziari",
      "Equilibrio fra risorse proprie e mercato",
      "Fabbisogno coperto in larga parte con risorse autoprodotte",
    ]),
  },
];

/* ── Sezione 3.3 · Blocco D — Costo del capitale ───────────────────────────── */

const IND_COSTO_CAPITALE = [
  {
    id: "kdStimato",
    nome: "Costo del debito (Kd)",
    sub: "Oneri finanziari / Debiti finanziari",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => kdLordoDi(d),
    raw: (d, ctx) => [
      { label: "Oneri finanziari", value: oneriDi(d) },
      { label: "Debiti finanziari totali", value: debitiFinanziariDi(d) },
      { label: "Tasso privo di rischio dichiarato (%)", value: isNum(capmDi(ctx).rf) ? capmDi(ctx).rf * 100 : null },
      {
        label: "Premio implicito per il rischio di credito (%)",
        value: isNum(kdLordoDi(d)) && isNum(capmDi(ctx).rf) ? (kdLordoDi(d) - capmDi(ctx).rf) * 100 : null,
      },
    ],
    formula: "Kd = Oneri finanziari ÷ Debiti finanziari",
    significato:
      "Il costo effettivo del capitale di credito, ricavato dal bilancio. Si compone del tasso privo di rischio più un premio legato alla solvibilità specifica dell'impresa: sottraendo il risk-free si legge direttamente il credit spread che i finanziatori le applicano. Per le imprese con debiti quotati lo stesso premio si ottiene dallo Yield to Maturity dei titoli; per le non quotate si stima con il rating sintetico del blocco E.",
    giudizio: sogliaDecrescente(0.05, 0.08, [
      "Costo del debito elevato: il mercato prezza un rischio di credito significativo",
      "Costo del debito nella fascia intermedia",
      "Costo del debito contenuto: buona percezione del merito creditizio",
    ]),
  },
  {
    id: "kdNetto",
    nome: "Costo del debito netto d'imposta",
    sub: "Kd × (1 − t) — effetto dello scudo fiscale",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    richiede: chiedeAliquota,
    calc: (d, ctx) => kdNettoDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Kd lordo (%)", value: isNum(kdLordoDi(d)) ? kdLordoDi(d) * 100 : null },
      { label: "Aliquota fiscale (%)", value: isNum(aliquotaDi(ctx)) ? aliquotaDi(ctx) * 100 : null },
      { label: "Risparmio d'imposta sugli oneri", value: isNum(aliquotaDi(ctx)) ? oneriDi(d) * aliquotaDi(ctx) : null },
    ],
    formula: "Kd × (1 − aliquota fiscale)",
    significato:
      "Gli oneri finanziari sono deducibili: lo Stato ne finanzia una quota pari all'aliquota d'imposta. È questo il beneficio fiscale del debito che entra nel WACC — e la ragione per cui, nel calcolo dell'EVA, il numeratore va preso al netto delle sole imposte figurative: contarlo due volte sarebbe un errore metodologico.",
    giudizio: sogliaDecrescente(0.04, 0.06, [
      "Costo del debito elevato anche al netto dello scudo fiscale",
      "Costo netto del debito nella fascia intermedia",
      "Costo netto del debito contenuto",
    ]),
  },
  {
    id: "pesoDebito",
    nome: "Peso del debito nella struttura",
    sub: "D / (D + E) — a valori di mercato se indicati",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d, ctx) => pesoDebitoDi(d, ctx),
    raw: (d, ctx) => [
      { label: "D — valore del debito", value: debitoValoreDi(d, ctx) },
      { label: "E — valore dell'equity", value: equityValoreDi(d, ctx) },
      { label: "D/E", value: isNum(deDi(d, ctx)) ? deDi(d, ctx) * 100 : null },
      {
        label:
          perAnno(ctx, "equityMercato") === null || daSP(ctx, "equityMercato")
            ? "Fonte: valori contabili"
            : "Fonte: valori di mercato dichiarati",
        value: null,
      },
    ],
    formula: "D ÷ (D + E)",
    significato:
      "I pesi con cui Kd e Ke si combinano nel WACC. La teoria richiede valori di mercato, non contabili: per le quotate si usa la capitalizzazione, per le altre una stima del valore economico. Con i soli valori di bilancio il peso del debito risulta sistematicamente sovrastimato nelle imprese redditizie, perché l'equity contabile ignora il valore creato e non ancora distribuito.",
    giudizio: sogliaDecrescente(0.4, 0.6, [
      "Struttura fortemente sbilanciata sul debito",
      "Peso del debito significativo ma nella norma",
      "Struttura prevalentemente finanziata con capitale di rischio",
    ]),
  },
  {
    id: "keCapm",
    nome: "Costo dell'equity (Ke)",
    sub: "Rf + β re-levered × ERP",
    unit: "pct",
    betterWhen: "down",
    moduli: ["sp"],
    richiede: (ctx) =>
      isNum(betaUnleveredSettoreDi(ctx)) && isNum(capmDi(ctx).rf) && isNum(capmDi(ctx).erp)
        ? null
        : "Richiede beta di settore, D/E di settore, Rf ed ERP (sub-tab «4 · Dati Macro & CAPM»)",
    calc: (d, ctx) => keDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Tasso privo di rischio Rf (%)", value: isNum(capmDi(ctx).rf) ? capmDi(ctx).rf * 100 : null },
      { label: "Beta unlevered di settore", value: betaUnleveredSettoreDi(ctx) },
      { label: "D/E dell'impresa (%)", value: isNum(deDi(d, ctx)) ? deDi(d, ctx) * 100 : null },
      { label: "Beta re-levered dell'impresa", value: betaRelevatoDi(d, ctx) },
      { label: "Premio per il rischio di mercato ERP (%)", value: isNum(capmDi(ctx).erp) ? capmDi(ctx).erp * 100 : null },
    ],
    formula: "Ke = Rf + βl × ERP,  con βl = βu × [1 + (1 − t) × D/E]",
    significato:
      "Il costo del capitale di rischio secondo il CAPM, calcolato con il beta re-levered sull'effettivo grado di indebitamento dell'impresa. È il passaggio che riconnette la struttura finanziaria al costo dei mezzi propri: gli azionisti di un'impresa molto esposta al debito sopportano una variabilità maggiore dei rendimenti e pretendono, correttamente, di essere pagati di più.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Compilare i parametri CAPM per attivare il calcolo" }
        : v > 0.15
        ? { level: "warn", testo: "Costo dell'equity molto elevato: gli azionisti prezzano un rischio alto" }
        : { level: "info", testo: "Costo dell'equity nella norma dei mercati sviluppati" },
  },
  {
    id: "waccRicostruito",
    nome: "WACC ricostruito",
    sub: "Kd(1−t)·D/(D+E) + Ke·E/(D+E)",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    richiede: (ctx) => (isNum(betaUnleveredSettoreDi(ctx)) ? chiedeAliquota(ctx) : "Richiede i parametri CAPM e l'aliquota fiscale"),
    calc: (d, ctx) => waccRicostruitoDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Kd netto d'imposta (%)", value: isNum(kdNettoDi(d, ctx)) ? kdNettoDi(d, ctx) * 100 : null },
      { label: "Peso del debito D/(D+E) (%)", value: isNum(pesoDebitoDi(d, ctx)) ? pesoDebitoDi(d, ctx) * 100 : null },
      { label: "Ke (%)", value: isNum(keDi(d, ctx)) ? keDi(d, ctx) * 100 : null },
      { label: "WACC provvisorio inserito in Fase 1 (%)", value: isNum(ctx?.par?.wacc) ? ctx.par.wacc * 100 : null },
    ],
    formula: "WACC = Kd × (1 − t) × D/(D+E) + Ke × E/(D+E)",
    significato:
      "Il costo medio ponderato del capitale: insieme ai flussi di cassa è una delle due variabili da cui dipende il valore fondamentale dell'impresa nel modello Discounted Cash Flow. Ricostruirlo dai suoi componenti — anziché assumerlo — rende visibile quale parte del costo dipenda dal rischio operativo, quale dal rischio finanziario e quale dalla semplice struttura delle fonti.",
    giudizio: (v, ctx) => {
      if (!isNum(v)) return { level: "info", testo: "Compilare CAPM e aliquota per ricostruire il WACC" };
      const dichiarato = ctx?.par?.wacc;
      if (!isNum(dichiarato))
        return { level: "info", testo: `WACC ricostruito ${pct(v)}: riportarlo in Fase 1 per attivare spread ed EVA` };
      const scarto = v - dichiarato;
      return Math.abs(scarto) <= 0.01
        ? { level: "ok", testo: `Coerente con il WACC provvisorio dichiarato (${pct(dichiarato)})` }
        : { level: "warn", testo: `Scarto di ${pp(scarto)} rispetto al WACC provvisorio dichiarato (${pct(dichiarato)}): verificare quale dei due usare in Fase 2` };
    },
  },
];

/* ── Sezione 3.3 · Blocchi E-G — Rischio d'insolvenza e leva finanziaria ───── */

const IND_RISCHIO_INSOLVENZA = [
  {
    id: "ebitCover",
    nome: "EBIT interest cover",
    sub: "EBIT / Oneri finanziari — driver del rating",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => ebitCoverDi(d),
    raw: (d) => [
      { label: "EBIT", value: d?.ce?.ebit },
      { label: "Oneri finanziari", value: oneriDi(d) },
      { label: "Classe di rating sintetica associata", value: null },
    ],
    formula: "EBIT ÷ Oneri finanziari",
    significato:
      "In tutte le rilevazioni — statistiche accademiche e agenzie internazionali — la copertura degli interessi è l'indice con la massima capacità predittiva del default, e per questo è il primo parametro della classificazione sintetica. Scende precipitosamente passando dalle classi investment grade a quelle speculative, molto prima che altri indicatori diano segnali.",
    giudizio: sogliaCrescente(2.5, 4.25, [
      "Copertura da area speculativa: il margine operativo copre a stento il costo del debito",
      "Copertura da area investment grade bassa",
      "Copertura ampia, coerente con le classi investment grade superiori",
    ]),
  },
  {
    id: "oneriSuEbitda",
    nome: "Oneri finanziari / EBITDA",
    sub: "L'indice a massima capacità predittiva, in forma inversa",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d) => safeDiv(oneriDi(d), d?.ce?.ebitda),
    raw: (d) => [
      { label: "Oneri finanziari", value: oneriDi(d) },
      { label: "EBITDA", value: d?.ce?.ebitda },
      { label: "Margine residuo dopo gli oneri", value: sottrai(d?.ce?.ebitda, oneriDi(d)) },
    ],
    formula: "Oneri finanziari ÷ EBITDA × 100",
    significato:
      "L'inverso della copertura, nella forma in cui la ricerca empirica lo usa più spesso: le imprese che entreranno in crisi mostrano un'impennata di questo rapporto con anticipo rispetto al dissesto, mentre le altre lo mantengono piatto. È il singolo numero che vale la pena mettere in serie storica prima di ogni altro.",
    giudizio: sogliaDecrescente(0.15, 0.3, [
      "Gli oneri assorbono una quota critica del margine operativo lordo",
      "Assorbimento significativo del margine da parte del costo del debito",
      "Costo del debito ampiamente sostenibile dal margine",
    ]),
  },
  {
    id: "debtEbitda",
    nome: "Debiti finanziari / EBITDA",
    sub: "Il secondo parametro delle scale di rating",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => safeDiv(debitiFinanziariDi(d), d?.ce?.ebitda),
    raw: (d) => [
      { label: "Debiti finanziari lordi", value: debitiFinanziariDi(d) },
      { label: "Posizione finanziaria netta", value: d?.sp?.pfn },
      { label: "EBITDA", value: d?.ce?.ebitda },
    ],
    formula: "Debiti finanziari ÷ EBITDA",
    significato:
      "Si impenna passando dalle classi investment grade a quelle speculative, in modo speculare alla caduta della copertura degli interessi. A differenza del PFN/EBITDA della Fase 3, qui il numeratore è il debito lordo: è la convenzione delle scale di rating, che non riconoscono alla liquidità disponibile la stessa certezza che attribuiscono al debito.",
    giudizio: sogliaDecrescente(2, 4, [
      "Stock di debito elevato rispetto al margine: area speculativa",
      "Indebitamento nella fascia di attenzione",
      "Debito contenuto rispetto alla generazione di margine",
    ]),
  },
  {
    id: "glf",
    nome: "Grado di leva finanziaria (GLF)",
    sub: "MON / Reddito corrente ante imposte",
    unit: "x",
    betterWhen: "down",
    moduli: ["ce"],
    calc: (d) => glfDi(d),
    raw: (d) => [
      { label: "MON — reddito operativo", value: d?.ce?.mon },
      { label: "Oneri finanziari (costo fisso)", value: oneriDi(d) },
      { label: "Reddito corrente ante imposte", value: d?.ce?.risultatoAnteImposte },
      {
        label: "Effetto su un calo del 10% del MON (%)",
        value: isNum(glfDi(d)) ? -glfDi(d) * 10 : null,
      },
    ],
    formula: "GLF = MON ÷ Reddito corrente ante imposte",
    significato:
      "Gli oneri finanziari sono costi fissi, e come tutti i costi fissi amplificano la variabilità di ciò che sta a valle. Con un GLF pari a 2, una flessione del 10% del reddito operativo produce una caduta del 20% del risultato per gli azionisti. È il canale attraverso cui il rischio del creditore si trasferisce al socio, ed è la ragione per cui un azionista razionale pretende una remunerazione crescente al crescere del debito.",
    giudizio: sogliaDecrescente(1.3, 2, [
      "Leva finanziaria elevata: forte amplificazione delle oscillazioni del reddito operativo",
      "Amplificazione significativa ma gestibile",
      "Struttura poco sensibile: il debito non amplifica in modo rilevante",
    ]),
  },
];

const IND_MODELLI_DEFAULT = [
  {
    id: "zScore",
    nome: "Z-Score di Altman (Z′)",
    sub: "Analisi discriminante · versione per imprese non quotate",
    unit: "dec",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d, ctx) => zScoreDi(d, ctx)?.z ?? null,
    raw: (d, ctx) => {
      const z = zScoreDi(d, ctx);
      if (!z) return [{ label: "Dati insufficienti per il calcolo", value: null }];
      return z.termini.map((t) => ({
        label: `${t.k} · ${t.nome} × ${t.peso}`,
        value: isNum(t.valore) ? t.peso * t.valore : null,
      }));
    },
    formula: "Z′ = 0,717·X1 + 0,847·X2 + 3,107·X3 + 0,420·X4 + 0,998·X5",
    significato:
      "Il capostipite dei modelli quantitativi: l'analisi discriminante assegna pesi specifici a cinque variabili patrimoniali e reddituali per separare le imprese sane da quelle insolventi. Sopra 2,90 area di sicurezza, fra 1,23 e 2,90 area grigia, sotto 1,23 area di insolvenza. Il limite è nella natura stessa del cut-off: traccia una linea netta dove la realtà è continua, ed è per questo che i modelli moderni preferiscono la probabilità.",
    giudizio: (v) => {
      const z = zonaZScore(v);
      return z
        ? { level: z.level, testo: `${z.nome}. Le soglie sono quelle della versione Z′ per imprese non quotate; con voci mancanti il punteggio è calcolato sui soli termini disponibili e va letto come indicativo.` }
        : { level: "info", testo: "Dati insufficienti per il calcolo" };
    },
  },
  {
    id: "pdLogit",
    nome: "Probabilità di default a 18 mesi",
    sub: "Modello Logit calibrato sulle PMI italiane",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d, ctx) => logitPmiDi(d, ctx)?.pd ?? null,
    raw: (d, ctx) => {
      const l = logitPmiDi(d, ctx);
      if (!l) return [{ label: "Dati insufficienti per il calcolo", value: null }];
      return [
        { label: "Intercetta α", value: l.intercetta },
        ...l.termini.map((t) => ({ label: `${t.nome} × ${t.peso}`, value: t.contributo })),
        { label: "= Scoring", value: l.scoring },
      ];
    },
    formula: "PD = 1 / (1 + e^(−Scoring)),  Scoring = α + Σ βᵢ·Xᵢ",
    significato:
      "L'approccio logistico è preferito all'analisi discriminante per la robustezza ai dati non lineari o anomali e per la trasparenza del risultato: non una linea di demarcazione ma una percentuale continua di probabilità di fallimento, immediatamente associabile a una classe di rating. Nella ricerca applicata l'intercetta subisce calibrazioni sul campione asimmetrico — molte imprese sane, poche fallite — che questa implementazione non replica: il valore va letto come ordine di grandezza.",
    giudizio: (v) => {
      if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per il calcolo" };
      const c = classeDaPd(v);
      return v < 0.012
        ? { level: "ok", testo: `Probabilità di default contenuta · classe indicativa ${c?.classe}` }
        : v < 0.08
        ? { level: "warn", testo: `Probabilità di default apprezzabile · classe indicativa ${c?.classe}` }
        : { level: "bad", testo: `Probabilità di default elevata · classe indicativa ${c?.classe}` };
    },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-octies. REDDITIVITÀ NETTA — GRANDEZZE DERIVATE (Capitolo 14)
   ═══════════════════════════════════════════════════════════════════════════
   Il ROE è il terminale in cui confluiscono tutte le decisioni strategiche,
   operative e finanziarie: per questo la sua scomposizione ricompone a sistema
   l'intera analisi di bilancio. Due percorsi logici, non equivalenti:

     • ADDITIVO-MOLTIPLICATIVA (Modigliani-Miller)
       ROE = [ROI + (ROI − ROD) × D/E] × incidenza fiscale
       Separa l'efficienza operativa dagli effetti della struttura finanziaria
       e mostra apertamente lo spread ROI−ROD, cioè il cuore dell'effetto leva.
       Si presta all'analisi univariata degli scostamenti.

     • MOLTIPLICATIVA (DuPont)
       ROE = ROI × Leverage × IGE
       Storicamente diffusa ma oggi riduttiva: le sue variabili sono
       reciprocamente dipendenti, l'IGE mescola fisco, interessi e straordinari
       in un solo numero, e lo spread resta invisibile.

   Le identità qui implementate CHIUDONO esattamente sul ROE contabile quando
   lo schema è quello a posizione finanziaria netta (CIN = PN + PFN, RAOF =
   risultato ante imposte + oneri finanziari): ogni card espone il riscontro,
   così che uno scarto residuo si veda invece di nascondersi.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Capitale netto MEDIO fra apertura e chiusura: gli utili si formano mese per
 *  mese e vengono reinvestiti, quindi il solo dato puntuale distorce il ROE. */
const capitaleNettoMedioDi = (d, ctx) => media(d?.sp?.patrimonioNetto, ctx?.prec?.sp?.patrimonioNetto);

/** Saldo della gestione non corrente (straordinaria), firmato. */
const gestNonCorrDi = (d, ctx) =>
  perAnno(ctx, "gestNonCorrente") ?? (isNum(d?.ce?.gestioneNonCorrente) ? d.ce.gestioneNonCorrente : null);

/** Reddito corrente LORDO: risultato ante imposte depurato degli straordinari. */
const redditoCorrenteLordoDi = (d, ctx) => {
  const rai = d?.ce?.risultatoAnteImposte;
  if (!isNum(rai)) return null;
  const g = gestNonCorrDi(d, ctx);
  return rai - (isNum(g) ? g : 0);
};

/** Imposte dell'esercizio in valore assoluto. */
const imposteDi = (d) => (isNum(d?.ce?.imposte) ? Math.abs(d.ce.imposte) : null);

/** Reddito corrente NETTO: corrente lordo meno le imposte dell'esercizio. */
const redditoCorrenteNettoDi = (d, ctx) => {
  const rcl = redditoCorrenteLordoDi(d, ctx);
  const t = imposteDi(d);
  return isNum(rcl) && isNum(t) ? rcl - t : null;
};

/** Coefficiente di incidenza fiscale: reddito corrente netto ÷ corrente lordo. */
const incidenzaFiscaleDi = (d, ctx) => safeDiv(redditoCorrenteNettoDi(d, ctx), redditoCorrenteLordoDi(d, ctx));

/** Tax rate effettivo: imposte ÷ risultato ante imposte. */
const taxRateEffettivoDi = (d) => safeDiv(imposteDi(d), d?.ce?.risultatoAnteImposte);

/* ── Scomposizione additivo-moltiplicativa ─────────────────────────────────── */

/** ROI della formula: risultato ante oneri finanziari ÷ capitale investito netto. */
const roiMmDi = (d) => safeDiv(d?.ce?.raof, d?.sp?.capitaleInvestitoNetto);

/** ROD: oneri finanziari ÷ indebitamento finanziario netto. */
const rodMmDi = (d) => safeDiv(oneriDi(d), d?.sp?.pfn);

/** Grado di indebitamento della formula: PFN ÷ patrimonio netto. */
const deMmDi = (d) => safeDiv(d?.sp?.pfn, d?.sp?.patrimonioNetto);

/** Spread ROI − ROD: il differenziale che la leva moltiplica. */
const spreadRoiRodDi = (d) => {
  const roi = roiMmDi(d);
  const rod = rodMmDi(d);
  return isNum(roi) && isNum(rod) ? roi - rod : null;
};

/** Effetto leva: (ROI − ROD) × D/E. */
const effettoLevaDi = (d) => {
  const s = spreadRoiRodDi(d);
  const de = deMmDi(d);
  return isNum(s) && isNum(de) ? s * de : null;
};

/** ROE ante imposte ricostruito: ROI + (ROI − ROD) × D/E. */
const roeLordoDi = (d) => {
  const roi = roiMmDi(d);
  const e = effettoLevaDi(d);
  return isNum(roi) && isNum(e) ? roi + e : null;
};

/** Incidenza complessiva della gestione tributaria e straordinaria, così che
 *  l'identità chiuda esattamente sul ROE contabile. */
const incidenzaTotaleDi = (d) => safeDiv(d?.ce?.utileNetto, d?.ce?.risultatoAnteImposte);

/** ROE ricostruito dalla formula additivo-moltiplicativa. */
const roeRicostruitoDi = (d) => {
  const l = roeLordoDi(d);
  const s = incidenzaTotaleDi(d);
  return isNum(l) && isNum(s) ? l * s : null;
};

/** ROE contabile sul capitale netto medio. */
const roeMedioDi = (d, ctx) => safeDiv(d?.ce?.utileNetto, capitaleNettoMedioDi(d, ctx));

/** ROEAST: reddito corrente lordo ÷ capitale netto — neutrale al fisco. */
const roeastDi = (d, ctx) => safeDiv(redditoCorrenteLordoDi(d, ctx), capitaleNettoMedioDi(d, ctx) ?? d?.sp?.patrimonioNetto);

/** ROCE: rendimento dei soli azionisti ordinari, esposti al pieno rischio. */
const roceDi = (d, ctx) => {
  const rc = redditoCorrenteNettoDi(d, ctx);
  const pn = capitaleNettoMedioDi(d, ctx) ?? d?.sp?.patrimonioNetto;
  if (!isNum(rc) || !isNum(pn)) return null;
  const divPriv = perAnno(ctx, "dividendiPrivilegiati");
  const capPriv = perAnno(ctx, "capitalePrivilegiato");
  const num1 = rc - (isNum(divPriv) ? Math.abs(divPriv) : 0);
  const den = pn - (isNum(capPriv) ? Math.abs(capPriv) : 0);
  return den === 0 ? null : num1 / den;
};

/* ── Espansione: separare la gestione finanziaria attiva ───────────────────── */

/** Peso delle attività finanziarie sul capitale di rischio: AF / E. */
const afSuEquityDi = (d) => safeDiv(d?.sp?.investimentiFinanziari, d?.sp?.patrimonioNetto);

/** Rendimento delle attività finanziarie. */
const roiFinanziarioDi = (d) => safeDiv(d?.ce?.proventiFinanziari, d?.sp?.investimentiFinanziari);

/** Leva sulle attività finanziarie: −(ROI operativo − ROI finanziario) × AF/E.
 *  Il segno avverte che parcheggiare risorse in titoli meno redditizi del core
 *  business penalizza il ROE, in proporzione alla mole dei titoli detenuti. */
const levaAttivitaFinanziarieDi = (d) => {
  const rop = roiOperativoDi(d);
  const rfin = roiFinanziarioDi(d);
  const peso = afSuEquityDi(d);
  return isNum(rop) && isNum(rfin) && isNum(peso) ? -(rop - rfin) * peso : null;
};

/** Incidenza della gestione straordinaria: quanto ha gonfiato o sgonfiato l'utile. */
const incidenzaStraordinariaDi = (d, ctx) => safeDiv(d?.ce?.utileNetto, redditoCorrenteNettoDi(d, ctx));

/* ── Logica moltiplicativa (DuPont) ────────────────────────────────────────── */

/** Leverage indiretto: totale impieghi ÷ mezzi propri. */
const leverageDuPontDi = (d) => safeDiv(d?.sp?.capitaleInvestitoNetto, d?.sp?.patrimonioNetto);

/** IGE — incidenza della gestione extra-operativa: reddito netto ÷ RAOF. */
const igeDi = (d) => safeDiv(d?.ce?.utileNetto, d?.ce?.raof);

/* ── Trading on equity e ROD standard ──────────────────────────────────────── */

/** Costo medio di mercato del debito, dichiarato dall'analista (in %). */
const rodStandardDi = (ctx) => {
  const v = perAnno(ctx, "rodStandard");
  return isNum(v) ? v / 100 : null;
};

/** Efficienza industriale: ROI − ROD standard, cioè il merito della sola gestione. */
const efficienzaIndustrialeDi = (d, ctx) => {
  const roi = roiMmDi(d);
  const std = rodStandardDi(ctx);
  return isNum(roi) && isNum(std) ? roi - std : null;
};

/** Efficienza della funzione finanziaria: ROD standard − ROD effettivo. */
const efficienzaFinanziariaDi = (d, ctx) => {
  const std = rodStandardDi(ctx);
  const rod = rodMmDi(d);
  return isNum(std) && isNum(rod) ? std - rod : null;
};

/* ── Modigliani-Miller: il costo dell'equity al crescere della leva ────────── */

/** Ke di un'impresa unlevered: Rf + βu × ERP. */
const keUnleveredDi = (ctx) => {
  const p = capmDi(ctx);
  const bu = betaUnleveredSettoreDi(ctx);
  return isNum(bu) && isNum(p.rf) && isNum(p.erp) ? p.rf + bu * p.erp : null;
};

/** Proposizione II con imposte: Ke(L) = Ke(U) + [Ke(U) − Kd] × (1 − t) × D/E. */
const keLeveredMmDi = (keU, kd, t, de) =>
  isNum(keU) && isNum(kd) && isNum(t) && isNum(de) ? keU + (keU - kd) * (1 - t) * de : null;

/* ── Sezione 4 · Blocco B — Misure della redditività netta ─────────────────── */

const IND_ROE_MISURE = [
  {
    id: "roeMedio",
    nome: "ROE su capitale netto medio",
    sub: "Reddito netto / Capitale netto medio",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: chiedePrecedente,
    calc: (d, ctx) => roeMedioDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Reddito netto", value: d?.ce?.utileNetto },
      { label: "Capitale netto di fine esercizio", value: d?.sp?.patrimonioNetto },
      { label: "Capitale netto di inizio esercizio", value: ctx?.prec?.sp?.patrimonioNetto },
      { label: "Capitale netto medio (semisomma)", value: capitaleNettoMedioDi(d, ctx) },
      { label: "ROE su capitale puntuale (%)", value: isNum(safeDiv(d?.ce?.utileNetto, d?.sp?.patrimonioNetto)) ? safeDiv(d.ce.utileNetto, d.sp.patrimonioNetto) * 100 : null },
    ],
    formula: "Reddito netto ÷ [(Capitale netto iniziale + finale) ÷ 2] × 100",
    significato:
      "Il rendimento di ogni euro investito a titolo di rischio, legando il flusso di reddito del Conto Economico allo stock di capitale dello Stato Patrimoniale. Il denominatore va preso come media fra apertura e chiusura, e comprensivo del reddito formatosi durante l'anno: gli utili prodotti mese dopo mese vengono automaticamente reinvestiti nel processo produttivo, e usare il solo valore finale sottostima sistematicamente il capitale che ha davvero lavorato.",
    giudizio: sogliaCrescente(0.04, 0.1, [
      "Remunerazione del capitale proprio inferiore ad alternative prive di rischio",
      "ROE positivo ma con premio al rischio contenuto",
      "Capitale di rischio remunerato in modo soddisfacente",
    ]),
  },
  {
    id: "roeast",
    nome: "ROEAST",
    sub: "Reddito corrente lordo / Capitale netto",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d, ctx) => roeastDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Risultato ante imposte", value: d?.ce?.risultatoAnteImposte },
      { label: "− Saldo della gestione non corrente", value: gestNonCorrDi(d, ctx) },
      { label: "= Reddito corrente lordo", value: redditoCorrenteLordoDi(d, ctx) },
      { label: "Capitale netto medio", value: capitaleNettoMedioDi(d, ctx) },
    ],
    formula: "(Risultato ante imposte − straordinari) ÷ Capitale netto × 100",
    significato:
      "ROE ante componenti straordinari e imposte. Eliminando dal numeratore ciò che non è ripetibile e il carico fiscale, l'indice isola la gestione ordinaria e rende neutrale il confronto fra imprese soggette a regimi fiscali differenti — o fra esercizi della stessa impresa in cui il fisco ha pesato diversamente. È la misura da usare per giudicare la capacità di produrre ricchezza futura, non quella passata.",
    giudizio: sogliaCrescente(0.06, 0.14, [
      "Redditività ordinaria lorda insufficiente",
      "Redditività ordinaria lorda nella fascia intermedia",
      "Redditività ordinaria lorda solida, indipendente da fisco e straordinari",
    ]),
  },
  {
    id: "roce",
    nome: "ROCE · azionisti ordinari",
    sub: "(Reddito corrente netto − dividendi privilegiati) / Common equity",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d, ctx) => roceDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Reddito corrente netto", value: redditoCorrenteNettoDi(d, ctx) },
      { label: "− Dividendi privilegiati", value: perAnno(ctx, "dividendiPrivilegiati") },
      { label: "Capitale netto", value: capitaleNettoMedioDi(d, ctx) },
      { label: "− Capitale privilegiato", value: perAnno(ctx, "capitalePrivilegiato") },
    ],
    formula: "(Reddito corrente netto − dividendi privilegiati) ÷ (Capitale netto − capitale privilegiato)",
    significato:
      "Return on Common Equity. Le azioni privilegiate e di risparmio godono di dividendi statutariamente garantiti e si comportano quasi come debito: lasciarle nel denominatore e i loro dividendi nel numeratore diluisce il rendimento di chi sopporta davvero il rischio d'impresa. Senza capitale privilegiato dichiarato l'indice coincide con il ROE normalizzato.",
    giudizio: sogliaCrescente(0.04, 0.1, [
      "Rendimento degli azionisti ordinari insufficiente",
      "Rendimento degli azionisti ordinari contenuto",
      "Buon rendimento per chi sopporta il pieno rischio d'impresa",
    ]),
  },
  {
    id: "spreadRoeKe",
    nome: "Spread ROE − Ke",
    sub: "Extra-rendimento sul costo del capitale di rischio",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) => (isNum(betaUnleveredSettoreDi(ctx)) ? null : "Richiede i parametri CAPM (sub-tab «4 · Dati Macro & CAPM»)"),
    calc: (d, ctx) => {
      const roe = roeMedioDi(d, ctx) ?? safeDiv(d?.ce?.utileNetto, d?.sp?.patrimonioNetto);
      const ke = keDi(d, ctx);
      return isNum(roe) && isNum(ke) ? roe - ke : null;
    },
    raw: (d, ctx) => [
      { label: "ROE (%)", value: isNum(roeMedioDi(d, ctx)) ? roeMedioDi(d, ctx) * 100 : null },
      { label: "Ke — costo del capitale di rischio (%)", value: isNum(keDi(d, ctx)) ? keDi(d, ctx) * 100 : null },
      { label: "Extra-profitto sul capitale netto", value: isNum(roeMedioDi(d, ctx)) && isNum(keDi(d, ctx)) ? (roeMedioDi(d, ctx) - keDi(d, ctx)) * (capitaleNettoMedioDi(d, ctx) ?? 0) : null },
    ],
    formula: "ROE − Ke",
    significato:
      "Il ROE crea valore economico solo quando resta stabilmente superiore al costo del capitale di rischio. Un ROE del 6% con un Ke del 9% significa che gli azionisti stanno perdendo ricchezza pur leggendo un utile positivo in bilancio: la gestione non copre nemmeno il rendimento che quel capitale otterrebbe altrove, a parità di rischio.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Compilare i parametri CAPM per attivare il confronto" }
        : v > 0.02
        ? { level: "ok", testo: "Il rendimento per i soci supera nettamente il costo del capitale di rischio" }
        : v > 0
        ? { level: "warn", testo: "Extra-rendimento positivo ma sottile" }
        : { level: "bad", testo: "Il ROE non copre il costo del capitale di rischio: distruzione di ricchezza per i soci" },
  },
];

/* ── Sezione 4 · Blocco C — Scomposizione additivo-moltiplicativa ──────────── */

const IND_LEVA_ROE = [
  {
    id: "roiMm",
    nome: "ROI · rendimento del capitale investito",
    sub: "RAOF / Capitale investito netto",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => roiMmDi(d),
    raw: (d) => [
      { label: "RAOF — risultato ante oneri finanziari", value: d?.ce?.raof },
      { label: "Capitale investito netto", value: d?.sp?.capitaleInvestitoNetto },
      { label: "   di cui capitale netto", value: d?.sp?.patrimonioNetto },
      { label: "   di cui posizione finanziaria netta", value: d?.sp?.pfn },
    ],
    formula: "RAOF ÷ Capitale investito netto × 100",
    significato:
      "La prima delle tre cause del ROE: la redditività intrinseca degli investimenti, indipendente da come sono finanziati. È il termine su cui l'effetto leva lavora — senza un ROI robusto, nessuna struttura finanziaria può produrre un ROE sano, e l'indebitamento diventa un moltiplicatore di perdite anziché di guadagni.",
    giudizio: sogliaCrescente(0.05, 0.1, [
      "Rendimento del capitale investito inferiore al costo tipico del debito",
      "ROI positivo ma con spread ridotto rispetto al costo del debito",
      "Il capitale investito rende sensibilmente più di quanto costa finanziarlo",
    ]),
  },
  {
    id: "rodMm",
    nome: "ROD · costo medio del debito",
    sub: "Oneri finanziari / Indebitamento finanziario netto",
    unit: "pct",
    betterWhen: "down",
    moduli: ["ce", "sp"],
    calc: (d) => rodMmDi(d),
    raw: (d) => [
      { label: "Oneri finanziari", value: oneriDi(d) },
      { label: "Posizione finanziaria netta", value: d?.sp?.pfn },
      { label: "Debiti finanziari lordi (confronto)", value: debitiFinanziariDi(d) },
    ],
    formula: "Oneri finanziari ÷ Debiti finanziari netti × 100",
    significato:
      "La terza causa del ROE: quanto costa il denaro di terzi. Il denominatore è preso al netto della liquidità, coerentemente con il ROI calcolato sul capitale investito netto — così che l'identità additivo-moltiplicativa chiuda esattamente. Con una posizione finanziaria netta negativa, cioè con cassa netta, il ROD perde significato e la leva si inverte di segno.",
    giudizio: sogliaDecrescente(0.05, 0.08, [
      "Costo del debito elevato",
      "Costo del debito nella fascia intermedia",
      "Costo del debito contenuto",
    ]),
  },
  {
    id: "spreadRoiRod",
    nome: "Spread ROI − ROD",
    sub: "Il differenziale che la leva moltiplica",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => spreadRoiRodDi(d),
    raw: (d) => [
      { label: "ROI (%)", value: isNum(roiMmDi(d)) ? roiMmDi(d) * 100 : null },
      { label: "ROD (%)", value: isNum(rodMmDi(d)) ? rodMmDi(d) * 100 : null },
      { label: "Grado di indebitamento D/E", value: isNum(deMmDi(d)) ? deMmDi(d) * 100 : null },
    ],
    formula: "ROI − ROD",
    significato:
      "Il nucleo pulsante dell'equazione. Quando l'impresa si indebita investe i fondi di terzi ottenendo comunque il ROI, ma paga ai creditori il ROD: la differenza è margine puro che ricade nelle tasche dei soci. È la condizione del trading on equity — e se il ROD supera il ROI la stessa meccanica lavora al contrario, distruggendo ricchezza azionaria tanto più in fretta quanto più alto è il debito.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0.03
        ? { level: "ok", testo: "Spread ampio: l'indebitamento amplifica il rendimento dei soci" }
        : v > 0
        ? { level: "warn", testo: "Spread sottile: il beneficio della leva è fragile e si annulla al primo rialzo dei tassi" }
        : { level: "bad", testo: "Spread negativo: la leva finanziaria sta distruggendo ricchezza azionaria" },
  },
  {
    id: "gradoIndebitamentoRoe",
    nome: "Grado di indebitamento (D/E)",
    sub: "Posizione finanziaria netta / Capitale netto",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => deMmDi(d),
    raw: (d) => [
      { label: "Posizione finanziaria netta", value: d?.sp?.pfn },
      { label: "Capitale netto", value: d?.sp?.patrimonioNetto },
      { label: "Effetto leva prodotto (%)", value: isNum(effettoLevaDi(d)) ? effettoLevaDi(d) * 100 : null },
    ],
    formula: "D/E = Debiti finanziari netti ÷ Capitale netto",
    significato:
      "La seconda causa del ROE: il moltiplicatore dello spread. Va letto sempre insieme al segno di quello spread e alla volatilità del ROI: solo imprese con basso rischio operativo — flussi stabili, mercati anelastici, costi flessibili — possono spingere in sicurezza sul pedale dell'indebitamento, perché in recessione un ROI che scende sotto il ROD trasforma il moltiplicatore in un acceleratore di perdite.",
    giudizio: sogliaDecrescente(1, 2, [
      "Struttura finanziaria squilibrata verso il debito",
      "Indebitamento sostenibile ma da monitorare",
      "Struttura patrimoniale equilibrata",
    ]),
  },
  {
    id: "effettoLeva",
    nome: "Effetto leva finanziaria",
    sub: "(ROI − ROD) × D/E",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => effettoLevaDi(d),
    raw: (d) => [
      { label: "Spread ROI − ROD (%)", value: isNum(spreadRoiRodDi(d)) ? spreadRoiRodDi(d) * 100 : null },
      { label: "D/E", value: isNum(deMmDi(d)) ? deMmDi(d) * 100 : null },
      { label: "ROI (%)", value: isNum(roiMmDi(d)) ? roiMmDi(d) * 100 : null },
      { label: "ROE ante imposte ricostruito (%)", value: isNum(roeLordoDi(d)) ? roeLordoDi(d) * 100 : null },
    ],
    formula: "Effetto leva = (ROI − ROD) × D/E",
    significato:
      "Quanti punti di ROE, in più o in meno, l'impresa deve alla sola struttura finanziaria. Sommato al ROI restituisce il ROE ante imposte: è la misura esatta del trading on equity, e distingue il rendimento che nasce dal mestiere da quello che nasce dal modo di finanziarsi.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0
        ? { level: "ok", testo: "La leva finanziaria aggiunge rendimento al capitale dei soci" }
        : { level: "bad", testo: "La leva finanziaria sottrae rendimento: il debito costa più di quanto il capitale renda" },
  },
  {
    id: "incidenzaFiscale",
    nome: "Coefficiente di incidenza fiscale",
    sub: "Reddito corrente netto / Reddito corrente lordo",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d, ctx) => incidenzaFiscaleDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Reddito corrente lordo", value: redditoCorrenteLordoDi(d, ctx) },
      { label: "Imposte dell'esercizio", value: imposteDi(d) },
      { label: "Reddito corrente netto", value: redditoCorrenteNettoDi(d, ctx) },
      { label: "Tax rate effettivo (%)", value: isNum(taxRateEffettivoDi(d)) ? taxRateEffettivoDi(d) * 100 : null },
      { label: "Aliquota di legge dichiarata (%)", value: isNum(aliquotaDi(ctx)) ? aliquotaDi(ctx) * 100 : null },
    ],
    formula: "Reddito corrente netto ÷ Reddito corrente lordo",
    significato:
      "L'ultimo fattore moltiplicativo del ROE. L'analista ne valuta l'efficacia confrontando il tax rate effettivo con quello teorico calcolato all'aliquota di legge: se l'impresa sfrutta redditi esenti, crediti d'imposta o fiscalità differita, il carico reale risulta più leggero di quello potenziale, e il tax planning ha funzionato. Uno scarto in senso opposto segnala costi indeducibili o perdite non recuperabili.",
    giudizio: (v, ctx) => {
      if (!isNum(v)) return { level: "info", testo: "Dati insufficienti per esprimere un giudizio" };
      const teorico = isNum(aliquotaDi(ctx)) ? 1 - aliquotaDi(ctx) : null;
      if (!isNum(teorico))
        return { level: "info", testo: `Il ${pct(v, 0)} del reddito corrente lordo arriva a valle delle imposte. Indicare l'aliquota di legge in Fase 1 per il confronto con il carico teorico.` };
      return v >= teorico
        ? { level: "ok", testo: `Carico fiscale reale più leggero di quello teorico all'aliquota di legge (${pct(teorico, 0)} atteso): il tax planning sta funzionando` }
        : { level: "warn", testo: `Carico fiscale reale più pesante di quello teorico (${pct(teorico, 0)} atteso): verificare costi indeducibili e perdite non recuperabili` };
    },
  },
];

/* ── Sezione 4 · Blocco E — Espansione della formula ───────────────────────── */

const IND_LEVA_ESTESA = [
  {
    id: "pesoAttivitaFinanziarie",
    nome: "Peso delle attività finanziarie",
    sub: "Investimenti finanziari / Capitale netto",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => afSuEquityDi(d),
    raw: (d) => [
      { label: "Investimenti finanziari", value: d?.sp?.investimentiFinanziari },
      { label: "   di cui liquidità", value: d?.sp?.liquidita },
      { label: "Capitale netto", value: d?.sp?.patrimonioNetto },
    ],
    formula: "Investimenti finanziari ÷ Capitale netto",
    significato:
      "Il moltiplicatore della leva sulle attività finanziarie: quanto pesano, rispetto al capitale di rischio, le risorse parcheggiate fuori dal business. Più la mole è grande, più il divario di rendimento fra titoli e gestione caratteristica si trasferisce amplificato sul ROE.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v > 0.5
        ? { level: "warn", testo: "Quota rilevante di capitale immobilizzata fuori dalla gestione caratteristica" }
        : { level: "info", testo: "Attività finanziarie contenute rispetto al capitale di rischio" },
  },
  {
    id: "levaAttivitaFinanziarie",
    nome: "Leva sulle attività finanziarie",
    sub: "− (ROI operativo − ROI finanziario) × AF/E",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    calc: (d) => levaAttivitaFinanziarieDi(d),
    raw: (d) => [
      { label: "ROI operativo — MON/COIN (%)", value: isNum(roiOperativoDi(d)) ? roiOperativoDi(d) * 100 : null },
      { label: "Rendimento delle attività finanziarie (%)", value: isNum(roiFinanziarioDi(d)) ? roiFinanziarioDi(d) * 100 : null },
      { label: "Peso AF/E", value: isNum(afSuEquityDi(d)) ? afSuEquityDi(d) * 100 : null },
      { label: "Proventi finanziari", value: d?.ce?.proventiFinanziari },
    ],
    formula: "− (ROI operativo − ROI finanziario) × (Attività finanziarie ÷ Capitale netto)",
    significato:
      "Il limite della formula base è che il ROI confonde il rendimento degli impianti con quello di titoli e partecipazioni. Separandoli emerge una seconda leva, e il suo segno negativo è un avvertimento: se l'impresa detiene attività finanziarie che rendono meno del proprio core business, sta sprecando risorse preziose, e il ROE ne esce penalizzato in proporzione alla mole dei titoli detenuti.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : v >= 0
        ? { level: "ok", testo: "Le attività finanziarie rendono almeno quanto la gestione caratteristica" }
        : v > -0.01
        ? { level: "warn", testo: "Lieve penalizzazione: i titoli rendono meno del business, ma la mole è contenuta" }
        : { level: "bad", testo: "Penalizzazione rilevante: risorse ferme in impieghi meno redditizi del core business" },
  },
  {
    id: "incidenzaStraordinaria",
    nome: "Incidenza della gestione straordinaria",
    sub: "Reddito netto / Reddito corrente netto",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d, ctx) => incidenzaStraordinariaDi(d, ctx),
    raw: (d, ctx) => [
      { label: "Reddito corrente netto", value: redditoCorrenteNettoDi(d, ctx) },
      { label: "Saldo della gestione non corrente", value: gestNonCorrDi(d, ctx) },
      { label: "Reddito netto", value: d?.ce?.utileNetto },
    ],
    formula: "Reddito netto ÷ Risultato corrente al netto delle imposte",
    significato:
      "Il fattore che completa il quadro includendo le voci anomale o non ripetibili. Sopra l'unità la gestione straordinaria ha gonfiato l'utile dell'anno; sotto l'unità lo ha eroso. In entrambi i casi si tratta di ricchezza che non tornerà l'anno prossimo, e che va tolta prima di proiettare il ROE nel futuro.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Dati insufficienti per esprimere un giudizio" }
        : Math.abs(v - 1) < 0.05
        ? { level: "ok", testo: "Utile sostanzialmente ordinario: nessuna distorsione da componenti anomale" }
        : v > 1
        ? { level: "warn", testo: "L'utile dell'anno è gonfiato da componenti non ripetibili" }
        : { level: "warn", testo: "L'utile dell'anno è eroso da componenti non ripetibili" },
  },
];

/* ── Sezione 4 · Blocco F — Logica moltiplicativa (DuPont) ─────────────────── */

const IND_DUPONT_NETTA = [
  {
    id: "leverageDuPont",
    nome: "Leverage",
    sub: "Totale impieghi / Mezzi propri",
    unit: "x",
    betterWhen: "down",
    moduli: ["sp"],
    calc: (d) => leverageDuPontDi(d),
    raw: (d) => [
      { label: "Capitale investito netto (totale impieghi)", value: d?.sp?.capitaleInvestitoNetto },
      { label: "Capitale netto (mezzi propri)", value: d?.sp?.patrimonioNetto },
      { label: "D/E corrispondente", value: isNum(deMmDi(d)) ? deMmDi(d) * 100 : null },
    ],
    formula: "Totale impieghi ÷ Mezzi propri",
    significato:
      "Il grado di indebitamento espresso in forma indiretta: quante volte gli impieghi complessivi eccedono il capitale di rischio. Contiene la stessa informazione del D/E (leverage = 1 + D/E) ma la nasconde dentro un moltiplicatore, ed è uno dei motivi per cui la formula DuPont non rende visibile lo spread.",
    giudizio: sogliaDecrescente(2, 3, [
      "Impieghi molto superiori ai mezzi propri",
      "Leverage nella fascia di attenzione",
      "Rapporto equilibrato fra impieghi e mezzi propri",
    ]),
  },
  {
    id: "ige",
    nome: "IGE · incidenza gestione extra-operativa",
    sub: "Reddito netto / RAOF",
    unit: "x",
    betterWhen: "up",
    moduli: ["ce"],
    calc: (d) => igeDi(d),
    raw: (d) => [
      { label: "RAOF — risultato ante oneri finanziari", value: d?.ce?.raof },
      { label: "− Oneri finanziari", value: oneriDi(d) },
      { label: "− Imposte", value: imposteDi(d) },
      { label: "± Gestione non corrente", value: d?.ce?.gestioneNonCorrente },
      { label: "= Reddito netto", value: d?.ce?.utileNetto },
    ],
    formula: "Reddito netto ÷ Risultato ante oneri finanziari",
    significato:
      "Sintetizza in un solo numero tutto ciò che accade sotto la gestione operativa: interessi passivi, imposte e componenti anomali. È esattamente questo il suo limite — l'effetto «calderone». Un IGE in calo non dice se il problema sia il costo del debito, un aggravio fiscale o una svalutazione straordinaria, e i tre casi richiedono decisioni opposte.",
    giudizio: sogliaCrescente(0.4, 0.6, [
      "La gestione extra-operativa assorbe gran parte del risultato operativo",
      "Assorbimento significativo da parte di oneri, fisco e straordinari",
      "Buona conservazione del risultato operativo fino a fondo conto economico",
    ]),
  },
];

/* ── Sezione 4 · Blocco G — Trading on equity e ROD standard ───────────────── */

const IND_TRADING_EQUITY = [
  {
    id: "efficienzaIndustriale",
    nome: "Efficienza industriale",
    sub: "ROI − ROD standard",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) =>
      isNum(rodStandardDi(ctx)) ? null : "Richiede il ROD standard di mercato (parametri per esercizio)",
    calc: (d, ctx) => efficienzaIndustrialeDi(d, ctx),
    raw: (d, ctx) => [
      { label: "ROI (%)", value: isNum(roiMmDi(d)) ? roiMmDi(d) * 100 : null },
      { label: "ROD standard di mercato (%)", value: isNum(rodStandardDi(ctx)) ? rodStandardDi(ctx) * 100 : null },
      { label: "ROD effettivo dell'impresa (%)", value: isNum(rodMmDi(d)) ? rodMmDi(d) * 100 : null },
    ],
    formula: "ROI − ROD standard",
    significato:
      "Il vero merito gestionale, isolato da ogni condizione di favore: dice se la gestione operativa sarebbe in grado di remunerare i debiti ipotizzando che siano contratti a normali condizioni di mercato. Un valore negativo è un grave campanello d'allarme strutturale, anche quando il ROE contabile appare positivo.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Indicare il ROD standard per attivare il confronto" }
        : v > 0.02
        ? { level: "ok", testo: "La gestione operativa remunererebbe il debito anche a condizioni di puro mercato" }
        : v > 0
        ? { level: "warn", testo: "Margine industriale sottile rispetto al costo di mercato del denaro" }
        : { level: "bad", testo: "A condizioni di mercato la gestione non remunererebbe il debito: allarme strutturale" },
  },
  {
    id: "efficienzaFinanziaria",
    nome: "Efficienza della funzione finanziaria",
    sub: "ROD standard − ROD effettivo",
    unit: "pct",
    betterWhen: "up",
    moduli: ["ce", "sp"],
    richiede: (ctx) =>
      isNum(rodStandardDi(ctx)) ? null : "Richiede il ROD standard di mercato (parametri per esercizio)",
    calc: (d, ctx) => efficienzaFinanziariaDi(d, ctx),
    raw: (d, ctx) => [
      { label: "ROD standard di mercato (%)", value: isNum(rodStandardDi(ctx)) ? rodStandardDi(ctx) * 100 : null },
      { label: "ROD effettivo (%)", value: isNum(rodMmDi(d)) ? rodMmDi(d) * 100 : null },
      { label: "Risparmio (o maggior costo) sugli oneri", value: isNum(efficienzaFinanziariaDi(d, ctx)) && isNum(d?.sp?.pfn) ? efficienzaFinanziariaDi(d, ctx) * d.sp.pfn : null },
    ],
    formula: "ROD standard − ROD effettivo",
    significato:
      "Misura l'abilità nel reperire fondi, o l'esistenza di agevolazioni. Se positivo, l'impresa si finanzia sotto il costo di mercato — per bravura negoziale o per contributi in conto interessi. Se negativo, paga sopra mercato, tipicamente per debiti pregressi a tasso fisso stipulati in altre condizioni: un'impresa eccellente sul piano operativo può mostrare uno spread complessivo negativo proprio per questa ragione.",
    giudizio: (v) =>
      !isNum(v)
        ? { level: "info", testo: "Indicare il ROD standard per attivare il confronto" }
        : v > 0
        ? { level: "ok", testo: "L'impresa si finanzia a condizioni migliori di quelle di mercato" }
        : { level: "warn", testo: "L'impresa paga il denaro sopra le condizioni medie di mercato" },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   5-bis. BENCHMARK SETTORIALE E PEER GROUP
   ═══════════════════════════════════════════════════════════════════════════
   Il confronto cross-sectional non può fermarsi alla media di settore: le
   differenze di rendimento DENTRO un comparto sono spesso più marcate di quelle
   FRA comparti diversi. Per questo la distribuzione va mappata con quartili, e
   la posizione dell'impresa letta rispetto allo scarto interquartile.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Valori mediani e distribuzione del ROI per settore.
 * ATTENZIONE: sono ordini di grandezza indicativi, coerenti con le figure
 * 12.3 (valori mediani) e 12.4 (box & whisker) del testo di riferimento, NON
 * dati di mercato aggiornati. Servono come punto di partenza: ogni valore è
 * sovrascrivibile a mano in Fase 1, e il confronto sui peer effettivamente
 * caricati ha comunque la precedenza.
 */
export const SETTORI = {
  pharma: { label: "Pharmaceuticals, biotechnology", q1: 0.12, mediana: 0.2, q3: 0.28, min: 0.05, max: 0.35, crescitaMediana: 0.06 },
  household: { label: "Household & personal products", q1: 0.13, mediana: 0.19, q3: 0.26, min: 0.07, max: 0.32, crescitaMediana: 0.04 },
  luxury: { label: "Luxury goods", q1: 0.1, mediana: 0.16, q3: 0.24, min: 0.04, max: 0.33, crescitaMediana: 0.07 },
  software: { label: "Software", q1: 0.08, mediana: 0.15, q3: 0.24, min: 0.0, max: 0.34, crescitaMediana: 0.1 },
  food: { label: "Food & Beverage", q1: 0.08, mediana: 0.12, q3: 0.17, min: 0.03, max: 0.23, crescitaMediana: 0.03 },
  machinery: { label: "Machinery & industrials", q1: 0.07, mediana: 0.11, q3: 0.16, min: 0.02, max: 0.22, crescitaMediana: 0.04 },
  retail: { label: "Retail", q1: 0.06, mediana: 0.1, q3: 0.15, min: 0.01, max: 0.21, crescitaMediana: 0.04 },
  automotive: { label: "Automobiles & parts", q1: 0.05, mediana: 0.09, q3: 0.14, min: 0.0, max: 0.2, crescitaMediana: 0.04 },
  construction: { label: "Construction & materials", q1: 0.05, mediana: 0.08, q3: 0.12, min: 0.01, max: 0.17, crescitaMediana: 0.03 },
  telco: { label: "Telecommunication services", q1: 0.05, mediana: 0.08, q3: 0.11, min: 0.02, max: 0.14, crescitaMediana: 0.01 },
  utilities: { label: "Utilities", q1: 0.05, mediana: 0.065, q3: 0.08, min: 0.04, max: 0.09, crescitaMediana: 0.02 },
};

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
 * Metriche di posizionamento di un'azienda: ROI operativo e crescita dei
 * ricavi calcolati sui due esercizi più recenti che ha in memoria.
 */
/* ═══════════════════════════════════════════════════════════════════════════
   PARAMETRI DI SETTORE DAI CONCORRENTI (peer group)
   Dai moduli SP / CE dei comparable caricati si ricavano i tre parametri di
   settore che un bilancio può davvero dare: aliquota effettiva, D/E contabile
   e grado di leva operativa. Per ciascuno: un valore per concorrente, poi la
   MEDIANA fra i concorrenti, escludendo i valori estremi (regola di Tukey sullo
   scarto interquartile, da 4 concorrenti in su). Beta, ERP e tasso privo di
   rischio sono dati di mercato e non si ricavano dai bilanci.
   ═══════════════════════════════════════════════════════════════════════════ */
export const mediana = (valori) => {
  const v = valori.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Righe con il campo valorizzato, divise in tenute ed escluse (Tukey 1,5×IQR). */
function senzaEstremi(righe, campo) {
  const valide = righe.filter((r) => isNum(r[campo]));
  if (valide.length < 4) return { tenute: valide, escluse: [] };
  const v = valide.map((r) => r[campo]).sort((a, b) => a - b);
  const q = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const dentro = (x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr;
  return { tenute: valide.filter((r) => dentro(r[campo])), escluse: valide.filter((r) => !dentro(r[campo])) };
}

/**
 * Aliquota effettiva di un esercizio = imposte / utile ante imposte.
 * null se l'esercizio è in perdita (o a zero) o se mancano i dati. Il carico
 * fiscale si ricava come utile ante imposte − utile netto, che non dipende
 * dalla convenzione di segno delle imposte; senza utile netto si usa il valore
 * assoluto delle imposte.
 */
export function aliquotaEffettivaDi(ce) {
  const rai = ce?.risultatoAnteImposte;
  const imp = ce?.imposte;
  const un = ce?.utileNetto;
  if (!isNum(rai) || rai <= 0) return null;
  const carico = isNum(un) ? rai - un : isNum(imp) ? Math.abs(imp) : null;
  return isNum(carico) ? carico / rai : null;
}

const ALIQUOTA_MIN = 0;
const ALIQUOTA_MAX = 0.6;
const DE_MAX = 10;
const GLO_MAX = 25;
const VARIAZIONE_RICAVI_MIN = 0.03;

/** Parametri di un singolo concorrente. */
function parametriConcorrente(id, impresa) {
  /* Solo esercizi chiusi: il periodo TTM lo ha soltanto l'impresa in analisi, e
     includerlo darebbe parametri diversi da un'analisi all'altra. */
  const es = Object.fromEntries(Object.entries(impresa?.esercizi || {}).filter(([k]) => Number.isInteger(Number(k))));
  const anni = Object.keys(es).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const r = { id, nome: impresa?.nome || id, anni, t: null, tAnni: [], tScartati: [], de: null, deAnno: null, debiti: null, pn: null, glo: null, gloMetodo: null, gloDettaglio: "" };

  /* Aliquota: media degli esercizi CHIUSI validi (il periodo TTM no: lo hanno
     solo alcune aziende e renderebbe diverse le medie fra un'analisi e l'altra).
     Un'aliquota esattamente nulla è quasi sempre una riga delle imposte che la
     riclassificazione non ha letto: si scarta invece di trascinare giù la media. */
  const aliquote = [];
  anni.forEach((a) => {
    const t = aliquotaEffettivaDi(es[a]?.ce);
    if (!isNum(t)) {
      if (isNum(es[a]?.ce?.risultatoAnteImposte)) r.tScartati.push(`${a} (in perdita)`);
      return;
    }
    if (t === 0) {
      r.tScartati.push(`${a} (imposte non rilevate)`);
      return;
    }
    if (t < ALIQUOTA_MIN || t > ALIQUOTA_MAX) {
      r.tScartati.push(`${a} (${(t * 100).toFixed(1).replace(".", ",")}%)`);
      return;
    }
    aliquote.push(t);
    r.tAnni.push(a);
  });
  if (aliquote.length) r.t = aliquote.reduce((x, y) => x + y, 0) / aliquote.length;

  /* D/E contabile: ultimo esercizio con patrimonio netto positivo. */
  for (const a of [...anni].reverse()) {
    const sp = es[a]?.sp;
    const pn = sp?.patrimonioNetto;
    if (!isNum(pn) || pn <= 0) continue;
    if (!isNum(sp?.debitiFinanziariBreve) && !isNum(sp?.debitiFinanziariLungo)) continue;
    const debiti = (sp.debitiFinanziariBreve || 0) + (sp.debitiFinanziariLungo || 0);
    const de = debiti / pn;
    if (de < 0 || de > DE_MAX) continue;
    Object.assign(r, { de, deAnno: a, debiti, pn });
    break;
  }

  /* Grado di leva operativa. Prima scelta: margine di contribuzione / MON con
     la quota variabile stimata per regressione (se affidabile). Altrimenti la
     mediana delle coppie di anni ΔMON% / ΔRicavi%. */
  const q = anni.length >= 3 ? stimaQuotaVariabile(es) : null;
  if (q?.affidabile) {
    const a = [...anni].reverse().find((x) => isNum(es[x]?.ce?.ricavi) && es[x].ce.ricavi > 0 && isNum(es[x]?.ce?.mon) && es[x].ce.mon > 0);
    if (a) {
      const mdc = es[a].ce.ricavi * (1 - q.quota / 100);
      const g = mdc / es[a].ce.mon;
      if (g > 0 && g <= GLO_MAX) {
        r.glo = g;
        r.gloMetodo = "MdC / MON";
        r.gloDettaglio = `${a}, quota variabile ${q.quota.toFixed(1).replace(".", ",")}% su ${q.n} esercizi`;
      }
    }
  }
  if (!isNum(r.glo)) {
    const coppie = [];
    for (let i = 1; i < anni.length; i++) {
      const p = es[anni[i - 1]]?.ce;
      const c = es[anni[i]]?.ce;
      if (!(p?.ricavi > 0 && c?.ricavi > 0 && p?.mon > 0 && c?.mon > 0)) continue;
      const dR = (c.ricavi - p.ricavi) / p.ricavi;
      if (Math.abs(dR) < VARIAZIONE_RICAVI_MIN) continue;
      const g = (c.mon - p.mon) / p.mon / dR;
      if (g > 0 && g <= GLO_MAX) coppie.push({ g, da: anni[i - 1], a: anni[i] });
    }
    if (coppie.length) {
      r.glo = mediana(coppie.map((x) => x.g));
      r.gloMetodo = "ΔMON% / ΔRicavi%";
      r.gloDettaglio = coppie.map((x) => `${x.da}→${x.a}`).join(", ");
    } else if (anni.length >= 2) {
      r.gloDettaglio = "nessuna coppia di anni utilizzabile (ricavi quasi fermi o MON non positivo)";
    } else {
      r.gloDettaglio = "servono almeno 2 esercizi";
    }
  }
  return r;
}

/** Parametri di settore: aliquota, D/E e grado di leva operativa sono la MEDIA
 *  dei valori di TUTTE le aziende della sessione, compresa quella in analisi,
 *  così sono gli stessi in ogni analisi (serve almeno un concorrente). Da 4
 *  valori in su gli estremi si escludono (Tukey). */
export function parametriSettoreDaPeer(aziende) {
  const righe = Object.entries(aziende || {})
    .filter(([id, a]) => id !== "principale" && Object.keys(a?.esercizi || {}).length)
    .map(([id, a]) => parametriConcorrente(id, a));
  const pr = aziende?.principale;
  const principale = pr && Object.keys(pr.esercizi || {}).length
    ? { ...parametriConcorrente("principale", pr), nome: pr.nome || "Impresa in analisi", principale: true }
    : null;
  const tutte = principale ? [principale, ...righe] : righe;
  const formato = { t: (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`, de: (v) => v.toFixed(2).replace(".", ","), glo: (v) => v.toFixed(2).replace(".", ",") };
  const sintesi = (campo) => {
    if (!righe.some((r) => isNum(r[campo]))) return { valore: null, n: 0, esclusi: [], media: true };
    const { tenute, escluse } = senzaEstremi(tutte, campo);
    return {
      valore: tenute.reduce((x, r) => x + r[campo], 0) / tenute.length,
      n: tenute.length,
      esclusi: escluse.map((r) => r.nome),
      media: true,
      conPrincipale: !!principale && tenute.includes(principale),
      dettaglio: tenute.map((r) => `${r.nome} ${formato[campo](r[campo])}`).join(" · "),
    };
  };
  return { righe, principale, t: sintesi("t"), de: sintesi("de"), glo: sintesi("glo") };
}

/** Campi CAPM compilati dai concorrenti, con il formato dei campi a schermo. */
const CAMPI_DA_PEER = [
  { k: "tSettore", chiave: "t", campo: (v) => versoCampo(Math.round(v * 1000) / 10) },
  { k: "deSettore", chiave: "de", campo: (v) => versoCampo(Math.round(v * 100) / 100) },
  { k: "gloSettore", chiave: "glo", campo: (v) => versoCampo(Math.round(v * 100) / 100) },
];

export function metricheAzienda(esercizi) {
  const anni = Object.keys(esercizi || {}).map(Number).sort((a, b) => b - a);
  if (!anni.length) return null;
  const t = esercizi[anni[0]];
  const p = anni.length > 1 ? esercizi[anni[1]] : null;
  return {
    anno: anni[0],
    roi: roiOperativoDi(t),
    ros: safeDiv(t?.ce?.mon, t?.ce?.ricavi),
    pc: safeDiv(t?.ce?.ricavi, t?.sp?.coin),
    crescita: p ? crescitaRicaviDi(t, { prec: p }) : null,
    ricavi: t?.ce?.ricavi ?? null,
  };
}

/**
 * Risolve la distribuzione di riferimento.
 * modo "peer" usa i comparable effettivamente caricati (servono almeno 3 ROI
 * validi per quartili sensati); modo "settore" usa la tabella precaricata con
 * gli eventuali override manuali; "auto" preferisce i peer se sufficienti.
 */
export function risolviBenchmark({ modo = "auto", settore, override = {}, peers = [] }) {
  const roiPeer = peers.map((p) => p.roi).filter(isNum);
  const crescitaPeer = peers.map((p) => p.crescita).filter(isNum);
  const usaPeer = modo === "peer" || (modo === "auto" && roiPeer.length >= 3);

  if (usaPeer && roiPeer.length >= 2) {
    return {
      fonte: "peer",
      n: roiPeer.length,
      etichetta: `Distribuzione calcolata su ${roiPeer.length} comparable caricati`,
      q1: quantile(roiPeer, 0.25),
      mediana: quantile(roiPeer, 0.5),
      q3: quantile(roiPeer, 0.75),
      min: Math.min(...roiPeer),
      max: Math.max(...roiPeer),
      crescitaMediana: crescitaPeer.length ? quantile(crescitaPeer, 0.5) : null,
    };
  }

  const base = SETTORI[settore];
  if (!base) return { fonte: "assente", n: 0, etichetta: "Nessun riferimento settoriale impostato" };
  // Gli override sono digitati in punti percentuali, la tabella è in decimali.
  const val = (k) => {
    const o = num(override[k]);
    return isNum(o) ? o / 100 : base[k];
  };
  return {
    fonte: "settore",
    n: 0,
    etichetta: `Tabella settoriale · ${base.label}${roiPeer.length ? ` (${roiPeer.length} comparable caricati, insufficienti per i quartili)` : ""}`,
    q1: val("q1"),
    mediana: val("mediana"),
    q3: val("q3"),
    min: val("min"),
    max: val("max"),
    crescitaMediana: val("crescitaMediana"),
  };
}

/** Posizione dell'impresa rispetto allo scarto interquartile. */
export function posizionamento(valore, b) {
  if (!isNum(valore) || !b || !isNum(b.mediana)) return { level: "info", testo: "Riferimento settoriale non disponibile" };
  if (isNum(b.q3) && valore > b.q3)
    return { level: "ok", testo: `Sopra il terzo quartile (${pct(b.q3)}): vantaggio competitivo di redditività` };
  if (isNum(b.q1) && valore < b.q1)
    return { level: "bad", testo: `Sotto il primo quartile (${pct(b.q1)}): svantaggio competitivo strutturale` };
  return valore >= b.mediana
    ? { level: "warn", testo: `Nella metà alta dello scarto interquartile, sopra la mediana (${pct(b.mediana)})` }
    : { level: "warn", testo: `Nella metà bassa dello scarto interquartile, sotto la mediana (${pct(b.mediana)})` };
}

/** Quadrante della matrice strategica (efficienza × sviluppo). */
export function quadranteDi(roi, crescita, b) {
  if (!isNum(roi) || !isNum(crescita) || !isNum(b?.mediana) || !isNum(b?.crescitaMediana)) return null;
  const altoRoi = roi >= b.mediana;
  const altaCrescita = crescita >= b.crescitaMediana;
  if (altoRoi && altaCrescita)
    return {
      id: "II",
      nome: "Vincenti",
      colore: GREEN,
      level: "ok",
      testo: "Redditività e sviluppo entrambi sopra il riferimento settoriale: l'impresa cresce conquistando quote di mercato senza sacrificare l'efficienza del capitale. È il quadrante che genera la maggiore ricchezza.",
    };
  if (altoRoi)
    return {
      id: "I",
      nome: "Prudenti",
      colore: BLUE,
      level: "ok",
      testo: "Cash cow: mercato maturo e stabile, crescita contenuta ma capitale impiegato con efficienza elevata e fabbisogno di reinvestimento modesto. Genera cassa in abbondanza; il rischio è l'immobilismo strategico.",
    };
  if (altaCrescita)
    return {
      id: "III",
      nome: "In corsa",
      colore: AMBER,
      level: "warn",
      testo: "Profilo da scommessa: volumi in forte espansione ma margini sul capitale ancora bassi, con assorbimento di cassa elevato. Il futuro dipende interamente dalla capacità di tradurre i volumi in redditività prima che la finanza esterna si esaurisca.",
    };
  return {
    id: "IV",
    nome: "In difficoltà",
    colore: RED,
    level: "bad",
    testo: "Quote di mercato in erosione e capitali che non rendono: il quadrante delle imprese decotte. Richiede ristrutturazione drastica del portafoglio di attività o dismissione.",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. COMPONENTI UI
   ═══════════════════════════════════════════════════════════════════════════ */

/** Etichetta arrotondata con dot colorato. Livelli: ok | warn | bad | info. */
export function Badge({ level = "info", children }) {
  const c = LEVEL_COLOR[level] || BLUE;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `${c}14`,
        border: `1px solid ${c}40`,
        color: c,
        fontFamily: FONT_HEAD,
        letterSpacing: "0.02em",
      }}
    >
      <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
      {children}
    </span>
  );
}

function Label({ children, color = INK, className = "" }) {
  return (
    <div
      className={`text-[10px] font-bold uppercase tracking-widest ${className}`}
      style={{ fontFamily: FONT_HEAD, color }}
    >
      {children}
    </div>
  );
}

/**
 * Intestazione di un blocco interno a una card: eyebrow, titolo e una riga
 * di sommario facoltativa. È il gradino gerarchico che manca fra il titolo
 * della SectionCard e il testo corrente.
 */
export function Intestazione({ titolo, eyebrow, accento = INK, nota, azione }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <Label color={`${accento}C0`}>{eyebrow}</Label>}
        <p className="mt-0.5 text-sm font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
          {titolo}
        </p>
        {nota && (
          <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            {nota}
          </p>
        )}
      </div>
      {azione}
    </div>
  );
}

/**
 * Area di trascinamento riutilizzabile. Era il riquadro cablato dentro
 * l'upload dei moduli di riclassificazione: qui diventa un componente
 * parametrico, così ogni punto dell'applicazione che accetta file usa lo
 * stesso oggetto invece di una copia leggermente diversa.
 */
export function Dropzone({
  titolo = "Trascina qui i file, oppure",
  etichettaBottone = "Seleziona file…",
  accept,
  multiple = false,
  accento = PURPLE,
  disabilitato = false,
  onFiles,
  children,
}) {
  const [sopra, setSopra] = useState(false);
  const attivo = sopra && !disabilitato;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabilitato) setSopra(true);
      }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSopra(false);
        if (!disabilitato) onFiles(e.dataTransfer.files);
      }}
      className="rounded-md p-6 text-center"
      style={{
        backgroundColor: attivo ? `${accento}0D` : PAPER,
        border: `2px dashed ${attivo ? accento : LINE}`,
        opacity: disabilitato ? 0.55 : 1,
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      <Label color={`${INK}90`}>{titolo}</Label>
      <label
        className="mt-3 inline-block rounded-md px-4 py-2 text-[11px] font-bold uppercase tracking-widest"
        style={{
          fontFamily: FONT_HEAD,
          backgroundColor: disabilitato ? LINE : INK,
          color: disabilitato ? `${INK}70` : "#FFFFFF",
          cursor: disabilitato ? "default" : "pointer",
        }}
      >
        {etichettaBottone}
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabilitato}
          className="hidden"
          onChange={(e) => {
            if (!disabilitato) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {children && (
        <div className="mt-3 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Contenitore di sezione con fascia superiore colorata. */
export function SectionCard({ titolo, accento = GREEN, eyebrow, toolbar, children }) {
  return (
    <section className="rounded-lg overflow-hidden" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ backgroundColor: accento }}
      >
        <div>
          {eyebrow && (
            <div
              className="text-[9px] font-semibold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, color: "#FFFFFFB0" }}
            >
              {eyebrow}
            </div>
          )}
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: "#FFFFFF" }}>
            {titolo}
          </h2>
        </div>
        {toolbar}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Selettore di annualità INDIPENDENTE per singola sezione.
 * Tab per l'anno corrente + select per l'anno di confronto: consente sia le
 * coppie consecutive (t vs t-1) sia i confronti a distanza (t vs t-3).
 * L'elenco degli anni arriva interamente dai file importati.
 */
export function SelettoreAnnualita({ anni, value, onChange, accento = GREEN }) {
  if (anni.length < 2) {
    return (
      <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: "#FFFFFFC0" }}>
        Servono almeno due annualità per il confronto
      </span>
    );
  }

  const setCorrente = (a) => {
    const prec = value?.precedente !== a ? value?.precedente : null;
    // Confronto preferito: l'esercizio immediatamente precedente; se `a` è il
    // più remoto in memoria, si ripiega su quello immediatamente successivo.
    const fallback = anni.find((x) => x < a) ?? [...anni].reverse().find((x) => x > a);
    onChange({ corrente: a, precedente: prec ?? fallback });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-[9px] font-bold uppercase tracking-widest hidden sm:inline"
        style={{ fontFamily: FONT_HEAD, color: "#FFFFFFB0" }}
      >
        Annualità
      </span>
      <div className="flex flex-wrap gap-1 rounded-md p-1" style={{ backgroundColor: "#00000026" }}>
        {anni.map((a) => {
          const attivo = value?.corrente === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => setCorrente(a)}
              className="rounded px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors"
              style={{
                fontFamily: FONT_MONO,
                backgroundColor: attivo ? CARD : "transparent",
                color: attivo ? accento : "#FFFFFFD0",
              }}
            >
              {etichettaPeriodo(a)}
            </button>
          );
        })}
      </div>
      <span className="text-[10px]" style={{ fontFamily: FONT_HEAD, color: "#FFFFFFB0" }}>
        vs
      </span>
      <select
        value={value?.precedente ?? ""}
        onChange={(e) => onChange({ corrente: value?.corrente ?? anni[0], precedente: Number(e.target.value) })}
        className="rounded px-2 py-1 text-[11px] font-semibold tabular-nums"
        style={{ fontFamily: FONT_MONO, backgroundColor: CARD, color: accento, border: "none" }}
      >
        {anni
          .filter((a) => a !== value?.corrente)
          .slice()
          .map((a) => (
            <option key={a} value={a}>
              {etichettaPeriodo(a)}
            </option>
          ))}
      </select>
      {(() => {
        /* Confronto con un TTM: i due periodi non distano dodici mesi. */
        const c = value?.corrente, p = value?.precedente;
        if (!isNum(c) || !isNum(p) || !(ePeriodoTtm(c) || ePeriodoTtm(p))) return null;
        const mesi = Math.round(Math.abs(c - p) * 12);
        if (mesi === 12) return null;
        return (
          <span className="w-full text-[10px] leading-snug" style={{ fontFamily: FONT_BODY, color: "#FFFFFFE0" }}>
            ⚠ {mesi < 12
              ? `Periodi sovrapposti per ${12 - mesi} mesi: le variazioni coprono ${mesi} mesi di differenza, non un anno.`
              : `Periodi distanti ${mesi} mesi: le variazioni coprono più di un anno.`}{" "}
            Lo SP del TTM è alla data infrannuale: il circolante può risentire della stagionalità.
          </span>
        );
      })()}
    </div>
  );
}

function RigaRaw({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}B0` }}>
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums text-right" style={{ fontFamily: FONT_MONO, color: INK }}>
        {fmt(value)}
      </span>
    </div>
  );
}

/**
 * IndicatoreEspandibile (CardInd) — componente core.
 * Chiuso: nome a sinistra, valore gigante mono a destra, delta sotto.
 * Aperto: formula + numeri grezzi, "Cosa significa", Badge di giudizio.
 */
export function CardInd({ ind, datiCorrente, datiPrecedente, annoCorrente, annoPrecedente, ctx, ctxPrec }) {
  const [aperto, setAperto] = useState(false);

  // `ctx` porta il contesto extra-esercizio (anno precedente, parametri
  // manuali, benchmark): gli indici che non ne hanno bisogno lo ignorano.
  const v = datiCorrente ? ind.calc(datiCorrente, ctx) : null;
  const vPrev = datiPrecedente ? ind.calc(datiPrecedente, ctxPrec) : null;
  const giudizio = ind.giudizio(v, ctx);
  const colore = LEVEL_COLOR[giudizio.level] || BLUE;

  const mancanti = (ind.moduli || []).filter((m) => !datiCorrente?.presenti?.[m]);
  const parametriMancanti = !isNum(v) && typeof ind.richiede === "function" ? ind.richiede(ctx) : null;

  const delta = isNum(v) && isNum(vPrev) ? v - vPrev : null;
  const variazione = isNum(delta) && isNum(vPrev) && vPrev !== 0 ? delta / Math.abs(vPrev) : null;
  const migliorato = isNum(delta) ? (ind.betterWhen === "up" ? delta > 0 : delta < 0) : null;
  const coloreDelta = delta === null || delta === 0 ? `${INK}80` : migliorato ? GREEN : RED;

  return (
    <div
      className="rounded-lg transition-shadow"
      style={{
        backgroundColor: CARD,
        border: `1px solid ${aperto ? `${colore}55` : LINE}`,
        boxShadow: aperto ? `0 1px 0 0 ${colore}22` : "none",
      }}
    >
      <button
        type="button"
        onClick={() => setAperto((s) => !s)}
        className="w-full flex items-start justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
            {ind.nome}
          </div>
          <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
            {ind.sub}
          </div>
          {mancanti.length > 0 && (
            <div className="mt-2">
              <Badge level="info">Richiede il modulo {mancanti.map((m) => MODULI[m]).join(" + ")}</Badge>
            </div>
          )}
          {mancanti.length === 0 && parametriMancanti && (
            <div className="mt-2">
              <Badge level="warn">{parametriMancanti}</Badge>
            </div>
          )}
          <div
            className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest"
            style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}
          >
            {aperto ? "Chiudi dettaglio" : "Apri dettaglio"}
            <span style={{ transform: aperto ? "rotate(180deg)" : "none", display: "inline-block" }}>▾</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-3xl font-bold tabular-nums leading-none" style={{ fontFamily: FONT_MONO, color: colore }}>
            {fmtValore(v, ind.unit)}
          </div>
          <div className="mt-2 text-[11px] font-medium tabular-nums" style={{ fontFamily: FONT_MONO, color: coloreDelta }}>
            {delta === null ? "— n.d." : fmtDelta(delta, ind.unit)}
          </div>
          <div className="text-[10px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
            {isNum(variazione) ? `${pct(variazione, 1, true)} su ${annoPrecedente}` : `vs ${annoPrecedente}`}
          </div>
        </div>
      </button>

      {aperto && (
        <div className="px-4 pb-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <div className="grid gap-4 md:grid-cols-2 pt-4">
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Formula</Label>
              <div className="mt-2 text-xs font-semibold" style={{ fontFamily: FONT_MONO, color: BLUE }}>
                {ind.formula}
              </div>

              <div className="mt-4">
                <Label color={`${INK}90`}>Numeri grezzi · {annoCorrente}</Label>
                <div className="mt-1" style={{ borderTop: `1px dashed ${LINE}` }}>
                  {(datiCorrente ? ind.raw(datiCorrente, ctx) : []).map((r) => (
                    <RigaRaw key={r.label} label={r.label} value={r.value} />
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <Label color={`${INK}70`}>Confronto · {annoPrecedente}</Label>
                <div className="mt-1" style={{ borderTop: `1px dashed ${LINE}` }}>
                  {(datiPrecedente ? ind.raw(datiPrecedente, ctxPrec) : []).map((r) => (
                    <RigaRaw key={r.label} label={r.label} value={r.value} />
                  ))}
                </div>
                <div
                  className="mt-2 flex items-baseline justify-between text-xs font-semibold"
                  style={{ fontFamily: FONT_MONO, color: INK }}
                >
                  <span>{annoPrecedente}</span>
                  <span>{fmtValore(vPrev, ind.unit)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-4">
              <div>
                <Label color={`${INK}90`}>Cosa significa</Label>
                <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}D0` }}>
                  {ind.significato}
                </p>
              </div>

              <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
                <Label color={`${INK}90`}>Giudizio automatico · {annoCorrente}</Label>
                <div className="mt-2">
                  <Badge level={giudizio.level}>{fmtValore(v, ind.unit)}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                  {giudizio.testo}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Riquadro mostrato quando manca la materia prima per l'analisi. */
export function EmptyState({ titolo, testo, onVaiAiDati }) {
  return (
    <div
      className="rounded-lg border border-dashed p-10 text-center"
      style={{ borderColor: "#C4C9BF", backgroundColor: CARD }}
    >
      <p className="font-semibold" style={{ fontFamily: FONT_HEAD, color: INK }}>
        {titolo}
      </p>
      <p className="mt-1 mb-4 text-sm" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        {testo}
      </p>
      <button
        type="button"
        onClick={onVaiAiDati}
        className="rounded px-4 py-2 text-sm font-semibold"
        style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF" }}
      >
        ← Vai a caricamento dati
      </button>
    </div>
  );
}

/**
 * Pagina di analisi generica. Il selettore di annualità è INDIPENDENTE per
 * sezione ma il suo stato vive nell'App: così la scelta fatta su una pagina
 * sopravvive al cambio di linguetta.
 */
function PaginaAnalisi({ titolo, eyebrow, accento, indicatori, dataset, anni, coppia, onCoppia, onVaiAiDati }) {
  if (anni.length === 0) {
    return (
      <EmptyState
        titolo="Nessun esercizio caricato"
        testo="Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file, non serve indicarli a mano."
        onVaiAiDati={onVaiAiDati}
      />
    );
  }
  if (anni.length === 1) {
    return (
      <EmptyState
        titolo="Un solo esercizio in memoria"
        testo="Il confronto storico richiede almeno due esercizi: carica anche la terna di moduli dell'esercizio precedente."
        onVaiAiDati={onVaiAiDati}
      />
    );
  }

  const datiCorrente = coppia ? dataset[coppia.corrente] : null;
  const datiPrecedente = coppia ? dataset[coppia.precedente] : null;

  return (
    <SectionCard
      titolo={titolo}
      eyebrow={eyebrow}
      accento={accento}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={accento} />}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {indicatori.map((ind) => (
          <CardInd
            key={ind.id}
            ind={ind}
            datiCorrente={datiCorrente}
            datiPrecedente={datiPrecedente}
            annoCorrente={coppia?.corrente}
            annoPrecedente={coppia?.precedente}
          />
        ))}
      </div>
    </SectionCard>
  );
}

/* ── Grafici del confronto competitivo ─────────────────────────────────────
   Due sole identità in campo — l'impresa in analisi e il campo dei comparable —
   quindi nessuna palette categoriale: l'impresa è in evidenza, il campo è
   recessivo in grigio. Entrambi i grafici hanno la loro tabella gemella, così
   nessun valore è raggiungibile solo per via visiva.
   ─────────────────────────────────────────────────────────────────────────── */

const GRIGIO_PEER = "#8A9199";

/** Scala lineare con dominio ripulito dai valori non numerici. */
const scala = (valori, pad = 0.12) => {
  const v = valori.filter(isNum);
  if (!v.length) return null;
  let d0 = Math.min(...v);
  let d1 = Math.max(...v);
  if (d0 === d1) {
    d0 -= Math.abs(d0 || 0.05) * 0.5 + 0.02;
    d1 += Math.abs(d1 || 0.05) * 0.5 + 0.02;
  }
  const margine = (d1 - d0) * pad;
  return { d0: d0 - margine, d1: d1 + margine };
};

/**
 * Etichette non sovrapposte. La lista arriva già in ordine di IMPORTANZA:
 * si accetta la più importante che disti abbastanza da tutte le già accettate,
 * così quando lo spazio è poco cadono i minimi e i massimi, non i quartili.
 */
const diradaEtichette = (punti, distanzaMin = 54) => {
  const out = [];
  punti.forEach((p) => {
    if (out.every((q) => Math.abs(q.x - p.x) >= distanzaMin)) out.push(p);
  });
  return out.sort((a, b) => a.x - b.x);
};

/** Box & whisker della distribuzione settoriale del ROI, con l'impresa in evidenza. */
export function BoxPlotSettore({ b, valore, nomeAzienda, peers = [], coloreAzienda = INK }) {
  const W = 680;
  const H = 168;
  const L = 18;
  const R = 18;
  const centro = 62;
  const boxH = 42;

  const roiPeer = peers.map((p) => p.roi).filter(isNum);
  const dominio = scala([b?.min, b?.q1, b?.mediana, b?.q3, b?.max, valore, ...roiPeer]);
  if (!dominio || !isNum(b?.mediana))
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        Nessuna distribuzione di riferimento disponibile: scegli un settore o carica almeno due comparable in Fase 1.
      </p>
    );

  const x = (v) => L + ((v - dominio.d0) / (dominio.d1 - dominio.d0)) * (W - L - R);

  const tacche = diradaEtichette(
    // Ordine di importanza: i quartili prima degli estremi.
    [
      { v: b.mediana, testo: "mediana" },
      { v: b.q1, testo: "Q1" },
      { v: b.q3, testo: "Q3" },
      { v: b.min, testo: "min" },
      { v: b.max, testo: "max" },
    ]
      .filter((t) => isNum(t.v))
      .map((t) => ({ ...t, x: x(t.v) }))
  );

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", minWidth: 420 }}>
        <title>Distribuzione settoriale del ROI e posizione dell'impresa</title>

        {/* Baffi */}
        {isNum(b.min) && isNum(b.max) && (
          <>
            <line x1={x(b.min)} y1={centro} x2={x(b.max)} y2={centro} stroke={`${INK}55`} strokeWidth="1" />
            <line x1={x(b.min)} y1={centro - 11} x2={x(b.min)} y2={centro + 11} stroke={`${INK}55`} strokeWidth="1" />
            <line x1={x(b.max)} y1={centro - 11} x2={x(b.max)} y2={centro + 11} stroke={`${INK}55`} strokeWidth="1" />
          </>
        )}

        {/* Scarto interquartile */}
        {isNum(b.q1) && isNum(b.q3) && (
          <rect
            x={x(b.q1)}
            y={centro - boxH / 2}
            width={Math.max(2, x(b.q3) - x(b.q1))}
            height={boxH}
            rx="3"
            fill={`${BLUE}1F`}
            stroke={`${BLUE}66`}
            strokeWidth="1"
          />
        )}

        {/* Mediana */}
        <line
          x1={x(b.mediana)}
          y1={centro - boxH / 2}
          x2={x(b.mediana)}
          y2={centro + boxH / 2}
          stroke={BLUE}
          strokeWidth="2"
        />

        {/* Comparable */}
        {roiPeer.map((v, i) => (
          <circle key={i} cx={x(v)} cy={centro} r="4" fill={GRIGIO_PEER} stroke={CARD} strokeWidth="2" />
        ))}

        {/* Impresa in analisi */}
        {isNum(valore) && (
          <>
            <line
              x1={x(valore)}
              y1={centro - 30}
              x2={x(valore)}
              y2={centro + 30}
              stroke={coloreAzienda}
              strokeWidth="2"
            />
            <circle cx={x(valore)} cy={centro} r="6" fill={coloreAzienda} stroke={CARD} strokeWidth="2" />
            <text
              x={Math.min(Math.max(x(valore), L + 40), W - R - 40)}
              y={centro - 38}
              textAnchor="middle"
              style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, fill: INK }}
            >
              {pct(valore)}
            </text>
          </>
        )}

        {/* Asse */}
        <line x1={L} y1={112} x2={W - R} y2={112} stroke={LINE} strokeWidth="1" />
        {tacche.map((t) => (
          <g key={t.testo}>
            <line x1={t.x} y1={112} x2={t.x} y2={117} stroke={LINE} strokeWidth="1" />
            <text
              x={Math.min(Math.max(t.x, L + 22), W - R - 22)}
              y={130}
              textAnchor="middle"
              style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}
            >
              {pct(t.v)}
            </text>
            <text
              x={Math.min(Math.max(t.x, L + 22), W - R - 22)}
              y={142}
              textAnchor="middle"
              style={{ fontFamily: FONT_HEAD, fontSize: 8, letterSpacing: "0.12em", fill: `${INK}70` }}
            >
              {t.testo.toUpperCase()}
            </text>
          </g>
        ))}

        {/* Legenda */}
        <g transform={`translate(${L}, ${H - 6})`}>
          <circle cx="5" cy="-4" r="5" fill={coloreAzienda} stroke={CARD} strokeWidth="2" />
          <text x="16" y="0" style={{ fontFamily: FONT_BODY, fontSize: 11, fill: `${INK}C0` }}>
            {nomeAzienda || "Impresa in analisi"}
          </text>
          <circle cx="200" cy="-4" r="4" fill={GRIGIO_PEER} stroke={CARD} strokeWidth="2" />
          <text x="211" y="0" style={{ fontFamily: FONT_BODY, fontSize: 11, fill: `${INK}C0` }}>
            Comparable caricati
          </text>
          <rect x="360" y="-9" width="16" height="10" rx="2" fill={`${BLUE}1F`} stroke={`${BLUE}66`} />
          <text x="384" y="0" style={{ fontFamily: FONT_BODY, fontSize: 11, fill: `${INK}C0` }}>
            Scarto interquartile Q1–Q3
          </text>
        </g>
      </svg>
    </div>
  );
}

/** Matrice strategica: efficienza (ROI) × sviluppo (crescita ricavi). */
export function MatriceStrategica({ roi, crescita, b, peers = [], nomeAzienda }) {
  const W = 680;
  const H = 430;
  const L = 62;
  const R = 22;
  const T = 22;
  const B = 56;

  const xMed = b?.crescitaMediana;
  const yMed = b?.mediana;
  const dx = scala([crescita, xMed, ...peers.map((p) => p.crescita)], 0.3);
  const dy = scala([roi, yMed, ...peers.map((p) => p.roi)], 0.3);

  if (!dx || !dy || !isNum(xMed) || !isNum(yMed))
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        La matrice richiede il ROI e la crescita dell'impresa più i valori mediani di riferimento: imposta il settore
        o carica i comparable in Fase 1.
      </p>
    );

  const px = (v) => L + ((v - dx.d0) / (dx.d1 - dx.d0)) * (W - L - R);
  const py = (v) => H - B - ((v - dy.d0) / (dy.d1 - dy.d0)) * (H - T - B);
  const cx = px(xMed);
  const cy = py(yMed);
  const q = quadranteDi(roi, crescita, b);

  const quadranti = [
    { id: "I", nome: "Prudenti", colore: BLUE, x: L, y: T, w: cx - L, h: cy - T, ax: "start", ay: "top" },
    { id: "II", nome: "Vincenti", colore: GREEN, x: cx, y: T, w: W - R - cx, h: cy - T, ax: "end", ay: "top" },
    { id: "IV", nome: "In difficoltà", colore: RED, x: L, y: cy, w: cx - L, h: H - B - cy, ax: "start", ay: "bottom" },
    { id: "III", nome: "In corsa", colore: AMBER, x: cx, y: cy, w: W - R - cx, h: H - B - cy, ax: "end", ay: "bottom" },
  ];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", minWidth: 460 }}>
        <title>Matrice strategica: ROI operativo contro crescita dei ricavi</title>

        {quadranti.map((k) => (
          <rect key={k.id} x={k.x} y={k.y} width={Math.max(0, k.w)} height={Math.max(0, k.h)} fill={`${k.colore}0F`} />
        ))}

        {quadranti.map((k) => (
          <text
            key={`t-${k.id}`}
            x={k.ax === "start" ? k.x + 10 : k.x + k.w - 10}
            y={k.ay === "top" ? k.y + 18 : k.y + k.h - 10}
            textAnchor={k.ax === "start" ? "start" : "end"}
            style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${k.colore}C0` }}
          >
            {`${k.id} · ${k.nome.toUpperCase()}`}
          </text>
        ))}

        {/* Assi mediani */}
        <line x1={cx} y1={T} x2={cx} y2={H - B} stroke={`${INK}40`} strokeWidth="1" />
        <line x1={L} y1={cy} x2={W - R} y2={cy} stroke={`${INK}40`} strokeWidth="1" />

        {/* Cornice */}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke={LINE} strokeWidth="1" />

        {/* Comparable */}
        {peers
          .filter((p) => isNum(p.roi) && isNum(p.crescita))
          .map((p, i) => (
            <g key={i}>
              <circle cx={px(p.crescita)} cy={py(p.roi)} r="5" fill={GRIGIO_PEER} stroke={CARD} strokeWidth="2">
                <title>{`${p.nome}: ROI ${pct(p.roi)} · crescita ${pct(p.crescita)}`}</title>
              </circle>
            </g>
          ))}

        {/* Impresa in analisi */}
        {isNum(roi) && isNum(crescita) && (
          <>
            <circle cx={px(crescita)} cy={py(roi)} r="7" fill={q?.colore || INK} stroke={CARD} strokeWidth="2" />
            <text
              x={Math.min(px(crescita) + 12, W - R - 6)}
              y={py(roi) - 10}
              textAnchor={px(crescita) > W - R - 130 ? "end" : "start"}
              style={{ fontFamily: FONT_HEAD, fontSize: 11, fontWeight: 700, fill: INK }}
            >
              {nomeAzienda || "Impresa in analisi"}
            </text>
          </>
        )}

        {/* Tacche */}
        {[dx.d0, xMed, dx.d1].map((v, i) => (
          <text
            key={`x${i}`}
            x={px(v)}
            y={H - B + 18}
            textAnchor="middle"
            style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}
          >
            {pct(v)}
          </text>
        ))}
        {[dy.d0, yMed, dy.d1].map((v, i) => (
          <text
            key={`y${i}`}
            x={L - 8}
            y={py(v) + 3}
            textAnchor="end"
            style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}
          >
            {pct(v)}
          </text>
        ))}

        <text
          x={(L + W - R) / 2}
          y={H - 14}
          textAnchor="middle"
          style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}
        >
          SVILUPPO · CRESCITA DEI RICAVI
        </text>
        <text
          transform={`translate(16, ${(T + H - B) / 2}) rotate(-90)`}
          textAnchor="middle"
          style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}
        >
          EFFICIENZA · ROI OPERATIVO
        </text>
      </svg>
    </div>
  );
}

/** Tabella gemella dei grafici: ogni valore resta leggibile senza il grafico. */
export function TabellaConfronto({ nomeAzienda, roi, crescita, peers = [], b }) {
  const righe = [
    { nome: nomeAzienda || "Impresa in analisi", roi, crescita, evidenza: true },
    ...peers.map((p) => ({ nome: p.nome, roi: p.roi, crescita: p.crescita, anno: p.anno })),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Impresa", "ROI operativo", "Crescita ricavi", "Quadrante"].map((h) => (
              <th key={h} className="py-2 pr-3">
                <Label color={`${INK}80`}>{h}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {righe.map((r, i) => {
            const q = quadranteDi(r.roi, r.crescita, b);
            return (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td
                  className="py-2 pr-3 text-xs"
                  style={{ fontFamily: FONT_BODY, color: INK, fontWeight: r.evidenza ? 700 : 400 }}
                >
                  {r.nome}
                  {r.anno ? (
                    <span className="ml-2 text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
                      {r.anno}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {pct(r.roi)}
                </td>
                <td className="py-2 pr-3 text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {pct(r.crescita)}
                </td>
                <td className="py-2 pr-3 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}B0` }}>
                  {q ? `${q.id} · ${q.nome}` : "n.d."}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Piano degli isoquanti: PC in ascissa, ROS in ordinata, curve a ROI costante. */
export function IsoquantiRoi({ punti = [], peers = [] }) {
  const W = 680;
  const H = 380;
  const L = 60;
  const R = 64;
  const T = 20;
  const B = 46;

  const pcs = [...punti.map((p) => p.pc), ...peers.map((p) => p.pc)].filter(isNum);
  const ross = [...punti.map((p) => p.ros), ...peers.map((p) => p.ros)].filter(isNum);
  const dx = scala(pcs, 0.35);
  const dy = scala(ross, 0.35);
  if (!dx || !dy)
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        Servono ROS e produttività del capitale di almeno un esercizio per tracciare il piano degli isoquanti.
      </p>
    );

  const x0 = Math.max(dx.d0, 0.05);
  const x1 = Math.max(dx.d1, x0 + 0.1);
  const y0 = dy.d0;
  const y1 = dy.d1;
  const px = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const py = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);

  // Livelli di ROI da rappresentare: quattro curve di sfondo più quella dell'impresa
  const roiPunto = punti.find((p) => p.evidenza && isNum(p.pc) && isNum(p.ros));
  const roiImpresa = roiPunto ? roiPunto.pc * roiPunto.ros : null;
  const roiMin = Math.max(x0 * y0, 0.005);
  const roiMax = x1 * y1;
  // Curve di sfondo spaziate geometricamente, scartando quelle troppo vicine
  // alla curva dell'impresa (che è disegnata in evidenza e la coprirebbe).
  const livelli = [0.2, 0.4, 0.6, 0.8]
    .map((f) => roiMin * Math.pow(roiMax / roiMin, f))
    .filter(
      (v) =>
        Number.isFinite(v) &&
        v > 0 &&
        (!isNum(roiImpresa) || Math.abs(v - roiImpresa) / roiImpresa > 0.12)
    );

  const curva = (roi) => {
    const passi = 60;
    const pts = [];
    for (let i = 0; i <= passi; i++) {
      const x = x0 + ((x1 - x0) * i) / passi;
      const y = roi / x;
      if (y >= y0 && y <= y1) pts.push(`${px(x).toFixed(1)},${py(y).toFixed(1)}`);
    }
    return pts.length > 1 ? `M${pts.join(" L")}` : null;
  };

  // Etichette all'estremo destro delle curve, scartando quelle che
  // collidono verticalmente con una già collocata (l'impresa ha la precedenza).
  const yEtichette = [];
  const etichettaCurva = (roi) => {
    const y = roi / x1;
    if (!(y >= y0 && y <= y1)) return null;
    const yPix = py(y);
    if (yEtichette.some((v) => Math.abs(v - yPix) < 13)) return null;
    yEtichette.push(yPix);
    return { x: px(x1) + 6, y: yPix + 3 };
  };
  // L'impresa prenota per prima la propria posizione.
  if (isNum(roiImpresa)) etichettaCurva(roiImpresa);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", minWidth: 460 }}>
        <title>Piano degli isoquanti: combinazioni di ROS e produttività del capitale a ROI costante</title>

        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke={LINE} strokeWidth="1" />

        {livelli.map((roi, i) => {
          const dpath = curva(roi);
          const et = etichettaCurva(roi);
          return dpath ? (
            <g key={i}>
              <path d={dpath} fill="none" stroke={`${INK}33`} strokeWidth="1" />
              {et && (
                <text x={et.x} y={et.y} style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}80` }}>
                  {pct(roi)}
                </text>
              )}
            </g>
          ) : null;
        })}

        {isNum(roiImpresa) &&
          (() => {
            const dpath = curva(roiImpresa);
            const yr = roiImpresa / x1;
            const et = yr >= y0 && yr <= y1 ? { x: px(x1) + 6, y: py(yr) + 3 } : null;
            return dpath ? (
              <g>
                <path d={dpath} fill="none" stroke={GREEN} strokeWidth="2" />
                {et && (
                  <text x={et.x} y={et.y} style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700, fill: GREEN }}>
                    {pct(roiImpresa)}
                  </text>
                )}
              </g>
            ) : null;
          })()}

        {/* Comparable */}
        {peers
          .filter((p) => isNum(p.pc) && isNum(p.ros))
          .map((p, i) => (
            <circle key={i} cx={px(p.pc)} cy={py(p.ros)} r="5" fill={GRIGIO_PEER} stroke={CARD} strokeWidth="2">
              <title>{`${p.nome}: ROS ${pct(p.ros)} · PC ${mult(p.pc)}`}</title>
            </circle>
          ))}

        {/* Traiettoria fra i due esercizi */}
        {punti.length === 2 && punti.every((p) => isNum(p.pc) && isNum(p.ros)) && (
          <line
            x1={px(punti[1].pc)}
            y1={py(punti[1].ros)}
            x2={px(punti[0].pc)}
            y2={py(punti[0].ros)}
            stroke={`${INK}66`}
            strokeWidth="2"
          />
        )}

        {punti
          .filter((p) => isNum(p.pc) && isNum(p.ros))
          .map((p, i) => (
            <g key={i}>
              <circle
                cx={px(p.pc)}
                cy={py(p.ros)}
                r={p.evidenza ? 7 : 5}
                fill={p.evidenza ? GREEN : `${INK}80`}
                stroke={CARD}
                strokeWidth="2"
              />
              <text
                x={p.evidenza ? px(p.pc) + 11 : px(p.pc) - 11}
                y={p.evidenza ? py(p.ros) - 9 : py(p.ros) + 17}
                textAnchor={p.evidenza ? "start" : "end"}
                style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: p.evidenza ? 700 : 400, fill: `${INK}B0` }}
              >
                {p.label}
              </text>
            </g>
          ))}

        {[x0, (x0 + x1) / 2, x1].map((v, i) => (
          <text key={`x${i}`} x={px(v)} y={H - B + 17} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}>
            {mult(v)}
          </text>
        ))}
        {[y0, (y0 + y1) / 2, y1].map((v, i) => (
          <text key={`y${i}`} x={L - 8} y={py(v) + 3} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}>
            {pct(v)}
          </text>
        ))}

        <text x={(L + W - R) / 2} y={H - 12} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}>
          PRODUTTIVITÀ DEL CAPITALE
        </text>
        <text transform={`translate(15, ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}>
          ROS
        </text>
      </svg>
    </div>
  );
}

/** Scomposizione dello scostamento del ROI in barre orizzontali. */
export function GraficoScostamenti({ s }) {
  if (!s) return null;
  const voci = [
    { label: "Effetto ROS", v: s.effettoRos },
    { label: "Effetto produttività", v: s.effettoPc },
    { label: "Effetto congiunto", v: s.congiunto },
    { label: "Scostamento totale", v: s.delta, totale: true },
  ];
  const W = 680;
  const rigaH = 34;
  const H = voci.length * rigaH + 26;
  const L = 168;
  const R = 84;
  const maxAbs = Math.max(...voci.map((x) => Math.abs(x.v || 0)), 0.001);
  const haNegativi = voci.some((x) => isNum(x.v) && x.v < 0);
  const haPositivi = voci.some((x) => isNum(x.v) && x.v > 0);
  const spazio = W - L - R;
  // Lo zero sta al centro solo quando servono davvero entrambe le direzioni:
  // con effetti tutti dello stesso segno le barre partono dal bordo.
  const zero = haNegativi && haPositivi ? L + spazio / 2 : haNegativi ? W - R : L;
  const semi = haNegativi && haPositivi ? spazio / 2 : spazio;
  const larghezza = (v) => (Math.abs(v) / maxAbs) * semi * 0.9;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", minWidth: 460 }}>
        <title>Contributo di ROS e produttività del capitale allo scostamento del ROI</title>
        <line x1={zero} y1={8} x2={zero} y2={H - 18} stroke={LINE} strokeWidth="1" />
        {voci.map((x, i) => {
          const y = 14 + i * rigaH;
          const w = isNum(x.v) ? larghezza(x.v) : 0;
          const positivo = (x.v || 0) >= 0;
          const colore = x.totale ? INK : positivo ? GREEN : RED;
          return (
            <g key={x.label}>
              <text x={L - 12} y={y + 15} textAnchor="end" style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: x.totale ? 700 : 400, fill: INK }}>
                {x.label}
              </text>
              <rect
                x={positivo ? zero + 1 : zero - 1 - w}
                y={y + 3}
                width={Math.max(w, 1)}
                height={18}
                rx="3"
                fill={colore}
                opacity={x.totale ? 1 : 0.85}
              />
              <text
                x={positivo ? zero + w + 8 : zero - w - 8}
                y={y + 16}
                textAnchor={positivo ? "start" : "end"}
                style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: x.totale ? 700 : 500, fill: INK }}
              >
                {pp(x.v)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Matrice BCG delle aree strategiche d'affari. */
export function MatriceBcg({ asa = [], sogliaCrescita = 0.1 }) {
  // La tabella delle ASA restituisce stringhe (e la crescita in punti
  // percentuali): la normalizzazione va fatta qui, non a monte.
  const validi = asa
    .map((a) => ({
      nome: a.nome,
      ricavi: num(a.ricavi),
      quotaRelativa: num(a.quotaRelativa),
      crescitaMercato: isNum(num(a.crescitaMercato)) ? num(a.crescitaMercato) / 100 : null,
    }))
    .filter((a) => isNum(a.quotaRelativa) && isNum(a.crescitaMercato));
  const W = 680;
  const H = 400;
  const L = 62;
  const R = 22;
  const T = 20;
  const B = 52;
  const dx = scala([...validi.map((a) => a.quotaRelativa), 1, 0], 0.25);
  const dy = scala([...validi.map((a) => a.crescitaMercato), sogliaCrescita, 0], 0.25);
  if (!validi.length || !dx || !dy)
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        Compila la tabella delle ASA con quota di mercato relativa e tasso di crescita del mercato per costruire la
        matrice.
      </p>
    );

  // Una quota di mercato relativa non può essere negativa: il dominio si ferma a zero.
  const qx0 = Math.max(dx.d0, 0);
  const px = (v) => L + ((v - qx0) / (dx.d1 - qx0)) * (W - L - R);
  const py = (v) => H - B - ((v - dy.d0) / (dy.d1 - dy.d0)) * (H - T - B);
  const cx = px(1);
  const cy = py(sogliaCrescita);
  const maxRicavi = Math.max(...validi.map((a) => a.ricavi || 0), 1);

  const quadranti = [
    { nome: "QUESTION MARK", colore: AMBER, x: L, y: T, w: cx - L, h: cy - T, anchor: "start", vy: "top" },
    { nome: "STAR", colore: GREEN, x: cx, y: T, w: W - R - cx, h: cy - T, anchor: "end", vy: "top" },
    { nome: "DOG", colore: RED, x: L, y: cy, w: cx - L, h: H - B - cy, anchor: "start", vy: "bottom" },
    { nome: "CASH COW", colore: BLUE, x: cx, y: cy, w: W - R - cx, h: H - B - cy, anchor: "end", vy: "bottom" },
  ];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", minWidth: 460 }}>
        <title>Matrice BCG del portafoglio di aree strategiche d'affari</title>
        {quadranti.map((k) => (
          <rect key={k.nome} x={k.x} y={k.y} width={Math.max(0, k.w)} height={Math.max(0, k.h)} fill={`${k.colore}0F`} />
        ))}
        {quadranti.map((k) => (
          <text
            key={`t${k.nome}`}
            x={k.anchor === "start" ? k.x + 10 : k.x + k.w - 10}
            y={k.vy === "top" ? k.y + 18 : k.y + k.h - 10}
            textAnchor={k.anchor}
            style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${k.colore}C0` }}
          >
            {k.nome}
          </text>
        ))}
        <line x1={cx} y1={T} x2={cx} y2={H - B} stroke={`${INK}40`} strokeWidth="1" />
        <line x1={L} y1={cy} x2={W - R} y2={cy} stroke={`${INK}40`} strokeWidth="1" />
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke={LINE} strokeWidth="1" />

        {validi.map((a, i) => {
          const cls = classeBcg(a.quotaRelativa, a.crescitaMercato, sogliaCrescita);
          const r = 7 + 15 * Math.sqrt((a.ricavi || 0) / maxRicavi);
          return (
            <g key={i}>
              <circle
                cx={px(a.quotaRelativa)}
                cy={py(a.crescitaMercato)}
                r={r}
                fill={`${cls?.colore || INK}66`}
                stroke={CARD}
                strokeWidth="2"
              >
                <title>{`${a.nome}: quota relativa ${mult(a.quotaRelativa)} · crescita ${pct(a.crescitaMercato)} · ricavi ${fmt(a.ricavi)}`}</title>
              </circle>
              <text
                x={px(a.quotaRelativa)}
                y={py(a.crescitaMercato) - r - 6}
                textAnchor="middle"
                style={{ fontFamily: FONT_HEAD, fontSize: 10, fontWeight: 700, fill: INK }}
              >
                {a.nome}
              </text>
            </g>
          );
        })}

        {[qx0, 1, dx.d1].map((v, i) => (
          <text key={`x${i}`} x={px(v)} y={H - B + 17} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}>
            {mult(v)}
          </text>
        ))}
        {[dy.d0, sogliaCrescita, dy.d1].map((v, i) => (
          <text key={`y${i}`} x={L - 8} y={py(v) + 3} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}>
            {pct(v)}
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 12} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}>
          QUOTA DI MERCATO RELATIVA
        </text>
        <text transform={`translate(15, ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", fill: `${INK}90` }}>
          CRESCITA DEL MERCATO
        </text>
      </svg>
    </div>
  );
}

/** Sotto-sezione numerata all'interno di una pagina di analisi. */
/* ── Stato patrimoniale in common size (Fig. 13.4) ────────────────────────
   Due pile distinte, non due serie da confrontare voce per voce: a sinistra
   la composizione degli impieghi, a destra quella delle fonti, entrambe in
   percentuale del CIN. Ogni pila usa una sola tinta a gradazioni, perché gli
   strati sono ORDINATI (dal più durevole al più mobile) e non categorie
   indipendenti: una palette categoriale suggerirebbe accostamenti che non
   esistono. Le poste negative — un circolante che libera capitale invece di
   assorbirlo — scendono sotto la linea dello zero anziché essere nascoste o
   raddrizzate.
   ───────────────────────────────────────────────────────────────────────── */

/** Gradazioni di una tinta, dalla più scura (strato durevole) alla più chiara. */
const GRADAZIONI = ["", "C0", "80", "50"];

export function CommonSize({ impieghi, fonti, cin }) {
  const W = 660;
  const H = 300;
  const T = 26;
  const B = 46;
  const larghezza = 118;
  const cx = [W * 0.28, W * 0.72];

  const prep = (voci) =>
    voci
      .map((v) => ({ ...v, quota: isNum(v.valore) && isNum(cin) && cin !== 0 ? v.valore / cin : null }))
      .filter((v) => isNum(v.quota) && Math.abs(v.quota) > 0.0005);

  const pile = [prep(impieghi), prep(fonti)];
  if (!isNum(cin) || cin === 0 || !pile[0].length || !pile[1].length)
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        Serve il modulo SP dell'esercizio selezionato per costruire lo stato patrimoniale in percentuale.
      </p>
    );

  // Dominio comune alle due pile: si confrontano solo se condividono la scala.
  const estremi = pile.map((p) => {
    let su = 0;
    let giu = 0;
    p.forEach((v) => (v.quota >= 0 ? (su += v.quota) : (giu += v.quota)));
    return { su, giu };
  });
  const y1 = Math.max(1, ...estremi.map((e) => e.su));
  const y0 = Math.min(0, ...estremi.map((e) => e.giu));
  const py = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
  const zero = py(0);

  const GAP = 2; // separazione fra strati: è il fondo a dividerli, non un bordo

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Stato patrimoniale in percentuale del capitale investito netto">
      {/* riferimento al 100% e alla linea dello zero */}
      {[0, 1].map((v) => (
        <line
          key={v}
          x1={16}
          x2={W - 16}
          y1={py(v)}
          y2={py(v)}
          stroke={v === 0 ? `${INK}40` : LINE}
          strokeWidth={1}
        />
      ))}
      <text x={W - 16} y={py(1) - 5} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}70` }}>
        100% del CIN
      </text>

      {pile.map((voci, i) => {
        /* Si impila dall'alto verso il basso nell'ordine di elenco: è la
           disposizione dei prospetti — capitale netto in cima alle fonti,
           investimenti durevoli in cima agli impieghi — e leggerla al
           contrario disorienta chi arriva dal bilancio. */
        let cursoreSu = estremi[i].su;
        let cursoreGiu = 0;
        return (
          <g key={i}>
            {voci.map((v, j) => {
              const positivo = v.quota >= 0;
              const da = positivo ? cursoreSu - v.quota : cursoreGiu;
              const a = positivo ? cursoreSu : cursoreGiu + v.quota;
              if (positivo) cursoreSu = da;
              else cursoreGiu = a;
              const yTop = py(Math.max(da, a));
              const alt = Math.max(Math.abs(py(a) - py(da)) - GAP, 1);
              const colore = `${v.tinta}${GRADAZIONI[Math.min(j, GRADAZIONI.length - 1)]}`;
              const centro = yTop + alt / 2;
              // L'etichetta entra nello strato solo se ci sta con respiro.
              const dentro = alt >= 22;
              return (
                <g key={v.chiave}>
                  <rect x={cx[i] - larghezza / 2} y={yTop} width={larghezza} height={alt} fill={colore} rx={2} />
                  {dentro && (
                    <text
                      x={cx[i]}
                      y={centro + 4}
                      textAnchor="middle"
                      style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, fill: j === 0 ? "#FFFFFF" : INK }}
                    >
                      {pct(v.quota, 0)}
                    </text>
                  )}
                  {!dentro && (
                    <text
                      x={cx[i] + larghezza / 2 + 6}
                      y={centro + 3.5}
                      style={{ fontFamily: FONT_MONO, fontSize: 10, fill: `${INK}A0` }}
                    >
                      {pct(v.quota, 0)}
                    </text>
                  )}
                </g>
              );
            })}
            <text
              x={cx[i]}
              y={H - B + 18}
              textAnchor="middle"
              style={{ fontFamily: FONT_HEAD, fontSize: 10, fontWeight: 700, fill: INK, letterSpacing: "0.08em" }}
            >
              {i === 0 ? "IMPIEGHI" : "FONTI"}
            </text>
            <text
              x={cx[i]}
              y={H - B + 32}
              textAnchor="middle"
              style={{ fontFamily: FONT_BODY, fontSize: 9, fill: `${INK}90` }}
            >
              {i === 0 ? "struttura patrimoniale" : "struttura finanziaria"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Legenda + tabella gemella della common size: nessun valore solo visivo. */
function TabellaCommonSize({ voci, cin, titolo }) {
  return (
    <div>
      <Label color={`${INK}80`}>{titolo}</Label>
      <table className="mt-1.5 w-full" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {voci.map((v, j) => {
            const quota = isNum(v.valore) && isNum(cin) && cin !== 0 ? v.valore / cin : null;
            return (
              <tr key={v.chiave} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="py-1 pr-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: `${v.tinta}${GRADAZIONI[Math.min(j, GRADAZIONI.length - 1)]}` }}
                    />
                    <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                      {v.nome}
                    </span>
                  </span>
                </td>
                <td
                  className="py-1 pl-2 text-right text-[11px] tabular-nums whitespace-nowrap"
                  style={{ fontFamily: FONT_MONO, color: `${INK}A0` }}
                >
                  {fmt(v.valore)}
                </td>
                <td
                  className="py-1 pl-3 text-right text-xs font-bold tabular-nums whitespace-nowrap"
                  style={{ fontFamily: FONT_MONO, color: INK }}
                >
                  {pct(quota, 1)}
                </td>
              </tr>
            );
          })}
          <tr style={{ borderTop: `2px solid ${INK}30` }}>
            <td className="py-1 pr-2 text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
              Capitale Investito Netto
            </td>
            <td className="py-1 pl-2 text-right text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {fmt(cin)}
            </td>
            <td className="py-1 pl-3 text-right text-xs font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              100,0%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── Fascia dell'autonomia patrimoniale ───────────────────────────────────
   Le quattro zone dottrinali su un asse 0-100%, con il valore dell'impresa
   segnato sopra. Le zone non sono una scala di magnitudine ma un giudizio di
   stato, quindi usano i colori di stato — accompagnati dal nome scritto, mai
   dal solo colore.
   ───────────────────────────────────────────────────────────────────────── */
export function FasciaAutonomia({ valore, valorePrec, annoCorrente, annoPrecedente }) {
  const W = 660;
  const H = 132;
  const L = 16;
  const R = 16;
  const yFascia = 54;
  const altezza = 26;
  const x = (v) => L + Math.max(0, Math.min(1, v)) * (W - L - R);

  const zone = ZONE_AUTONOMIA.map((z, i) => ({
    ...z,
    da: i === 0 ? 0 : ZONE_AUTONOMIA[i - 1].fino,
    a: Math.min(z.fino, 1),
  }));

  const marcatore = (v, anno, principale) => {
    if (!isNum(v)) return null;
    const cx = x(v);
    return (
      <g key={anno}>
        <line
          x1={cx}
          x2={cx}
          y1={principale ? yFascia - 16 : yFascia + altezza}
          y2={principale ? yFascia + altezza : yFascia + altezza + 12}
          stroke={INK}
          strokeWidth={principale ? 2 : 1}
        />
        <circle cx={cx} cy={principale ? yFascia - 16 : yFascia + altezza + 12} r={principale ? 5 : 3.5} fill={INK} stroke={CARD} strokeWidth={2} />
        <text
          x={Math.min(Math.max(cx, L + 26), W - R - 26)}
          y={principale ? yFascia - 26 : yFascia + altezza + 28}
          textAnchor="middle"
          style={{
            fontFamily: FONT_MONO,
            fontSize: principale ? 13 : 10,
            fontWeight: 700,
            fill: principale ? INK : `${INK}90`,
          }}
        >
          {pct(v, 1)}
        </text>
        <text
          x={Math.min(Math.max(cx, L + 26), W - R - 26)}
          y={principale ? yFascia - 38 : yFascia + altezza + 39}
          textAnchor="middle"
          style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: `${INK}80`, letterSpacing: "0.06em" }}
        >
          {anno}
        </text>
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Fascia dell'indice di autonomia patrimoniale">
      {zone.map((z) => {
        const x0 = x(z.da);
        const x1 = x(z.a);
        return (
          <g key={z.id}>
            {/* il divisore fra zone è il fondo, non un tratto disegnato */}
            <rect x={x0 + 1} y={yFascia} width={Math.max(x1 - x0 - 2, 1)} height={altezza} fill={`${z.colore}30`} rx={2} />
            <text
              x={(x0 + x1) / 2}
              y={yFascia + altezza / 2 + 3.5}
              textAnchor="middle"
              style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, fill: z.colore, letterSpacing: "0.05em" }}
            >
              {z.nome.replace("Zona di ", "").toUpperCase()}
            </text>
            <text
              x={x1}
              y={yFascia + altezza + 13}
              textAnchor="middle"
              style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}70` }}
            >
              {z.a >= 1 ? "100%" : pct(z.fino, 0)}
            </text>
          </g>
        );
      })}
      <text x={L} y={yFascia + altezza + 13} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}70` }}>
        0%
      </text>
      {marcatore(valorePrec, annoPrecedente, false)}
      {marcatore(valore, annoCorrente, true)}
    </svg>
  );
}

export function Blocco({ numero, titolo, descrizione, accento = GREEN, children }) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] font-bold tabular-nums"
          style={{ fontFamily: FONT_MONO, color: accento }}
        >
          {numero}
        </span>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ fontFamily: FONT_HEAD, color: INK }}
        >
          {titolo}
        </h3>
      </div>
      {descrizione && (
        <p className="mt-1 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
          {descrizione}
        </p>
      )}
      <div className="mt-3" style={{ borderTop: `1px solid ${LINE}`, paddingTop: "0.9rem" }}>
        {children}
      </div>
    </section>
  );
}

/**
 * Pagina 2 — Redditività Operativa.
 * Sette blocchi distinti: varianti del rendimento, scomposizione DuPont,
 * correzione delle distorsioni contabili, confronto cross-sectional, confronto
 * con il costo del capitale, leva di cassa e matrice strategica.
 */
function PaginaRedditivitaOperativa({
  dataset,
  anni,
  coppia,
  onCoppia,
  onVaiAiDati,
  par,
  onPar,
  benchmark,
  peers,
  nomeAzienda,
}) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "Il confronto storico richiede almeno due esercizi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file, non serve indicarli a mano."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  /** Esercizio immediatamente precedente in memoria (non quello di confronto). */
  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;

  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    const prec = ap != null ? dataset[ap] : null;
    return {
      anno: a,
      annoPrecedente: ap,
      prec,
      par,
      benchmark,
      crescitaEffettiva: prec ? crescitaRicaviDi(dataset[a], { prec }) : null,
    };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  // Valori usati fuori dalle card (confronti, grafici, giudizi di sintesi)
  const roiOp = d ? roiOperativoDi(d) : null;
  const roace = d ? safeDiv(d.ce.mon, media(d.sp.coin, ctx?.prec?.sp?.coin)) : null;
  const tassoLordo = d ? safeDiv(d.ce.ebitda, capitaleLordoDi(d, ctx)) : null;
  const crescita = d ? crescitaRicaviDi(d, ctx) : null;
  const pos = posizionamento(roiOp, benchmark);
  const quad = quadranteDi(roiOp, crescita, benchmark);

  const waccPercento = isNum(par?.wacc) ? (par.wacc * 100).toString().replace(".", ",") : "";

  return (
    <SectionCard
      titolo="Redditività Operativa"
      eyebrow="Gestione caratteristica"
      accento={GREEN}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={GREEN} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="Varianti dell'indice di rendimento"
          descrizione="A seconda dell'oggetto di indagine il rendimento si configura in modi diversi: la sola gestione caratteristica, l'intero attivo prima degli oneri del debito, o la sola gestione finanziaria attiva. Confonderli è la prima fonte di errore interpretativo."
        >
          {griglia(IND_VARIANTI_RENDIMENTO)}
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="Margini e rotazione · scomposizione DuPont"
          descrizione="ROI = ROS × Asset Turnover. Due imprese con lo stesso rendimento possono arrivarci per vie opposte: margini alti con rotazione lenta, oppure margini sottili con rotazione rapida. La scomposizione dice quale delle due leve stia lavorando."
        >
          {griglia(IND_REDDITIVITA_OPERATIVA)}
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="Correzione delle distorsioni contabili"
          descrizione="Il ROI tradizionale è sensibile alle politiche di bilancio e alla fotografia puntuale di fine esercizio. Le due correzioni qui sotto neutralizzano rispettivamente l'effetto degli ammortamenti e la variabilità infrannuale del capitale impiegato."
        >
          {griglia(IND_CORREZIONI)}
          {(isNum(roace) || isNum(tassoLordo)) && isNum(roiOp) && (
            <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Lettura incrociata delle tre misure</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                    ROI operativo
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(roiOp)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                    ROACE
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(roace)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                    Tasso lordo
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(tassoLordo)}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                {isNum(roace) && Math.abs(roiOp - roace) > 0.01
                  ? `Lo scarto di ${pp(roiOp - roace)} fra ROI e ROACE segnala che il capitale impiegato si è mosso in modo significativo durante l'esercizio: il dato puntuale di fine anno ${roiOp > roace ? "sovrastima" : "sottostima"} la redditività effettiva.`
                  : isNum(roace)
                  ? "ROI e ROACE praticamente coincidono: il capitale impiegato è rimasto stabile nell'esercizio, quindi il dato puntuale non introduce distorsioni."
                  : "Carica l'esercizio precedente per attivare il ROACE e misurare la distorsione del dato puntuale."}
                {isNum(tassoLordo)
                  ? " Il tasso lordo, immune dalle politiche di ammortamento, è la misura da usare per il confronto con i concorrenti che adottano aliquote diverse."
                  : " Inserisci il fondo ammortamento cumulato in Fase 1 per ottenere anche la misura immune dalle politiche di ammortamento."}
              </p>
            </div>
          )}
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="Confronto settoriale e cross-sectional"
          descrizione="La struttura competitiva del settore condiziona la redditività di base, ma le differenze DENTRO un comparto sono spesso più marcate di quelle FRA comparti. Per questo il confronto non si ferma alla media: mappa l'intera distribuzione con i quartili e legge la posizione dell'impresa rispetto allo scarto interquartile."
          accento={GREEN}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge level={benchmark?.fonte === "peer" ? "ok" : benchmark?.fonte === "settore" ? "info" : "warn"}>
              {benchmark?.etichetta || "Nessun riferimento impostato"}
            </Badge>
            <Badge level={pos.level}>{pos.testo}</Badge>
          </div>
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <BoxPlotSettore
              b={benchmark}
              valore={roiOp}
              nomeAzienda={nomeAzienda}
              peers={peers}
              coloreAzienda={LEVEL_COLOR[pos.level] || INK}
            />
          </div>
          <details className="mt-3">
            <summary
              className="cursor-pointer text-[10px] font-bold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}
            >
              Vista tabellare dei comparable
            </summary>
            <div className="mt-2">
              <TabellaConfronto nomeAzienda={nomeAzienda} roi={roiOp} crescita={crescita} peers={peers} b={benchmark} />
            </div>
          </details>
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="Confronto con il costo del capitale · EVA"
          descrizione="Il ROI operativo misura quanto rendono i capitali investiti nella gestione caratteristica; il WACC quanto costano. La creazione di valore economico si realizza esclusivamente quando il primo supera il secondo."
          accento={BLUE}
        >
          <div
            className="flex flex-wrap items-center gap-3 rounded-md p-3"
            style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}
          >
            <Label color={`${INK}90`}>WACC</Label>
            <input
              type="text"
              inputMode="decimal"
              value={waccPercento}
              onChange={(e) => {
                const v = num(e.target.value);
                onPar({ wacc: v === null ? null : v / 100, waccFonte: v === null ? "auto" : "manuale" });
              }}
              placeholder="es. 8,5"
              className="w-24 rounded px-2 py-1 text-sm tabular-nums"
              style={{ fontFamily: FONT_MONO, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
            />
            <span className="text-sm" style={{ fontFamily: FONT_MONO, color: `${INK}A0` }}>
              %
            </span>
            <NotaWacc par={par} onPar={onPar} />
          </div>
          <div className="mt-4">{griglia(IND_VALORE)}</div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Attualizzando al WACC gli EVA futuri attesi e sommandoli al COIN corrente si ottiene un valore economico
            degli investimenti operativi che coincide con quello del metodo Discounted Cash Flow in configurazione
            asset side: le due strade portano allo stesso numero.
          </p>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="Crescita, leva di cassa e Free Cash Flow"
          descrizione="La crescita agisce su due fronti contrapposti: alimenta l'autofinanziamento incrementando il MON, e contemporaneamente assorbe risorse richiedendo investimenti in circolante commerciale e in capacità produttiva. La leva di cassa misura il saldo fra i due effetti."
          accento={BLUE}
        >
          {griglia(IND_CRESCITA)}
        </Blocco>

        {/* ── G ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="G"
          titolo="Matrice strategica · efficienza × sviluppo"
          descrizione="Incrociando redditività del capitale e tasso di sviluppo, entrambi letti rispetto ai valori mediani di riferimento, si ottiene la collocazione competitiva dell'impresa in uno dei quattro quadranti."
          accento={PURPLE}
        >
          {quad && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge level={quad.level}>{`Quadrante ${quad.id} · ${quad.nome}`}</Badge>
              <span className="text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}A0` }}>
                {`ROI ${pct(roiOp)} · crescita ${pct(crescita)}`}
              </span>
            </div>
          )}
          <div className="rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <MatriceStrategica b={benchmark} roi={roiOp} crescita={crescita} peers={peers} nomeAzienda={nomeAzienda} />
          </div>
          {quad && (
            <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
              {quad.testo}
            </p>
          )}
        </Blocco>
      </div>
    </SectionCard>
  );
}

/** Tabella editabile delle Aree Strategiche d'Affari (segment reporting). */
function EditorAsa({ asa, onAsa }) {
  const colonne = [
    { k: "nome", label: "ASA", w: "w-36", testo: true },
    { k: "ricavi", label: "Ricavi", w: "w-28" },
    { k: "msc", label: "Margine semilordo", w: "w-28" },
    { k: "coin", label: "COIN specifico", w: "w-28" },
    { k: "crescitaMercato", label: "Crescita mercato %", w: "w-24" },
    { k: "quotaRelativa", label: "Quota relativa", w: "w-24" },
  ];
  const agg = (i, k, v) => onAsa(asa.map((r, j) => (i === j ? { ...r, [k]: v } : r)));

  return (
    <div>
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              {colonne.map((c) => (
                <th key={c.k} className="py-1 px-1 text-left">
                  <Label color={`${INK}80`}>{c.label}</Label>
                </th>
              ))}
              {["ROS", "PC", "ROI", "BCG", ""].map((h, i) => (
                <th key={i} className="py-1 px-1 text-left">
                  <Label color={`${INK}80`}>{h}</Label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {asa.map((r, i) => {
              const ricavi = num(r.ricavi);
              const msc = num(r.msc);
              const coin = num(r.coin);
              const cls = classeBcg(num(r.quotaRelativa), isNum(num(r.crescitaMercato)) ? num(r.crescitaMercato) / 100 : null);
              return (
                <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                  {colonne.map((c) => (
                    <td key={c.k} className="py-1 px-1">
                      <input
                        type="text"
                        inputMode={c.testo ? "text" : "decimal"}
                        value={r[c.k] ?? ""}
                        placeholder="—"
                        onChange={(e) => agg(i, c.k, e.target.value)}
                        className={`${c.w} rounded px-2 py-1 text-xs ${c.testo ? "" : "tabular-nums"}`}
                        style={{
                          fontFamily: c.testo ? FONT_BODY : FONT_MONO,
                          backgroundColor: CARD,
                          border: `1px solid ${LINE}`,
                          color: INK,
                        }}
                      />
                    </td>
                  ))}
                  <td className="py-1 px-1 text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(safeDiv(msc, ricavi))}
                  </td>
                  <td className="py-1 px-1 text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {mult(safeDiv(ricavi, coin))}
                  </td>
                  <td className="py-1 px-1 text-xs font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(safeDiv(msc, coin))}
                  </td>
                  <td className="py-1 px-1">{cls ? <Badge level={cls.id === "dog" ? "bad" : cls.id === "question" ? "warn" : "ok"}>{cls.nome}</Badge> : null}</td>
                  <td className="py-1 px-1">
                    <button
                      type="button"
                      onClick={() => onAsa(asa.filter((_, j) => j !== i))}
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ fontFamily: FONT_HEAD, color: RED }}
                    >
                      togli
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onAsa([...asa, { nome: `ASA ${asa.length + 1}`, ricavi: "", msc: "", coin: "", crescitaMercato: "", quotaRelativa: "" }])}
        className="mt-3 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
        style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF" }}
      >
        Aggiungi ASA
      </button>
    </div>
  );
}

/** I quattro passaggi di depurazione del beta, esposti uno per uno. */
function PassaggiBeta({ capm, gloImpresa, deImpresa, aliquota }) {
  const p = {
    betaL: num(capm?.betaL),
    deSettore: num(capm?.deSettore),
    tSettore: isNum(num(capm?.tSettore)) ? num(capm.tSettore) / 100 : null,
    gloSettore: num(capm?.gloSettore),
    rf: isNum(num(capm?.rf)) ? num(capm.rf) / 100 : null,
    erp: isNum(num(capm?.erp)) ? num(capm.erp) / 100 : null,
  };
  const r = depurazioneBeta({
    betaL: p.betaL,
    deSettore: p.deSettore,
    tSettore: p.tSettore,
    gloSettore: p.gloSettore,
    gloImpresa,
    deImpresa,
    tImpresa: aliquota,
    rf: p.rf,
    erp: p.erp,
  });

  const passi = [
    {
      n: 1,
      titolo: "Beta levered di settore",
      formula: "media dei beta dei concorrenti quotati",
      valore: p.betaL,
      testo: "Il punto di partenza è il beta che si legge sui mercati. È «sporco»: contiene insieme il rischio del business, il rischio finanziario dell'indebitamento e l'effetto dei costi fissi medi del settore.",
      ingredienti: [{ label: "Beta levered di settore", value: p.betaL }],
    },
    {
      n: 2,
      titolo: "Beta unlevered di settore",
      formula: "βL ÷ [1 + (1 − t) × D/E]",
      valore: r.betaUSettore,
      testo: "Si toglie di mezzo il peso delle banche. Usando il rapporto di indebitamento e l'aliquota fiscale si depura il dato dal rischio finanziario: resta il rischio operativo medio del settore, cioè mercato più costi fissi.",
      ingredienti: [
        { label: "D/E di settore", value: p.deSettore },
        { label: "Aliquota di settore (%)", value: isNum(p.tSettore) ? p.tSettore * 100 : null },
      ],
    },
    {
      n: 3,
      titolo: "Business Beta — rischio puro di settore",
      formula: "βU settore ÷ (1 + GLO settore)",
      valore: r.businessBeta,
      testo: "L'indicatore precedente contiene ancora i costi fissi tipici del comparto. Togliendo l'effetto della leva operativa media si ottiene il rischio puro di mercato, spogliato di tutto: quanto è rischioso, di per sé, vendere quel prodotto.",
      ingredienti: [{ label: "GLO di settore", value: p.gloSettore }],
    },
    {
      n: 4,
      titolo: "Beta unlevered dell'impresa",
      formula: "Business Beta × (1 + GLO impresa)",
      valore: r.betaUImpresa,
      testo: "Al rischio puro si «cuce addosso» la struttura di costi fissi di questa specifica impresa, moltiplicandolo per il suo grado di leva operativa personale. Il risultato è la reale misura del suo rischio operativo.",
      ingredienti: [{ label: "GLO dell'impresa", value: gloImpresa }],
    },
    {
      n: 5,
      titolo: "Beta levered dell'impresa e costo dell'equity",
      formula: "βU impresa × [1 + (1 − t) × D/E impresa]   →   Ke = rf + β × ERP",
      valore: r.betaLImpresa,
      testo: "Passaggio conclusivo, necessario per il CAPM: si ri-applica la struttura finanziaria effettiva dell'impresa, ricavata dal rapporto fra posizione finanziaria netta e patrimonio netto. Il costo del capitale proprio che ne risulta è l'ingrediente che la Fase 3 userà per il WACC.",
      ingredienti: [
        { label: "D/E dell'impresa", value: deImpresa },
        { label: "Aliquota dell'impresa (%)", value: isNum(aliquota) ? aliquota * 100 : null },
        { label: "Tasso privo di rischio (%)", value: isNum(p.rf) ? p.rf * 100 : null },
        { label: "Premio per il rischio (%)", value: isNum(p.erp) ? p.erp * 100 : null },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {passi.map((s) => (
        <div key={s.n} className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: PURPLE }}>
                {s.n}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
                {s.titolo}
              </span>
            </div>
            <span className="text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: isNum(s.valore) ? INK : `${INK}55` }}>
              {isNum(s.valore) ? s.valore.toLocaleString("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "n.d."}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-semibold" style={{ fontFamily: FONT_MONO, color: BLUE }}>
            {s.formula}
          </div>
          <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            {s.testo}
          </p>
          <div className="mt-2" style={{ display: "flex", flexWrap: "wrap", columnGap: 20, rowGap: 4 }}>
            {s.ingredienti.map((g) => (
              <span key={g.label} className="text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
                {g.label}:{" "}
                <span className="tabular-nums font-semibold" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {isNum(g.value) ? g.value.toLocaleString("it-IT", { maximumFractionDigits: 3 }) : "n.d."}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-md p-3" style={{ backgroundColor: `${PURPLE}0D`, border: `1px solid ${PURPLE}44` }}>
        <Label color={PURPLE}>Costo del capitale proprio (CAPM)</Label>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: isNum(r.ke) ? PURPLE : `${INK}55` }}>
          {pct(r.ke)}
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
          Ke = tasso privo di rischio + beta levered dell'impresa × premio per il rischio di mercato. È il primo dei
          due ingredienti del WACC: il secondo, il costo del debito al netto dello scudo fiscale, sarà determinato
          nella Fase 3 insieme alla ponderazione fra le due fonti.
        </p>
      </div>
    </div>
  );
}

/**
 * Pagina 2.1 — Determinanti del ROI.
 * Dieci blocchi: DuPont e isoquanti, scostamenti, interpretazione, leva
 * commerciale, immobilizzazioni, circolante, valore aggiunto, rischio
 * operativo, CAPM e portafoglio ASA.
 */
function PaginaDeterminantiRoi({
  dataset,
  anni,
  coppia,
  onCoppia,
  onVaiAiDati,
  par,
  benchmark,
  peers,
  nomeAzienda,
  asa,
  onAsa,
}) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "L'analisi degli scostamenti e la leva operativa richiedono due esercizi: carica anche la terna dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;
  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    const prec = ap != null ? dataset[ap] : null;
    return { anno: a, annoPrecedente: ap, prec, par, benchmark, crescitaEffettiva: prec ? crescitaRicaviDi(dataset[a], { prec }) : null };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  const ros = rosDi(d);
  const pc = pcDi(d);
  const roi = roiOperativoDi(d);
  const roa = roaDi(d);
  const levCom = levComDi(d);
  const scost = scostamentiRoi(d, dPrec);
  const tsv = crescitaRicaviDi(d, ctx);
  const intensita = intensitaCapitaleDi(d);
  const assorbimentoCrescita = isNum(tsv) && isNum(intensita) ? tsv * intensita : null;

  // Profilo strategico dedotto dalla combinazione ROS / produttività
  const profilo =
    !isNum(ros) || !isNum(pc)
      ? null
      : pc >= 1.2 && ros < 0.1
      ? {
          nome: "Rotazione elevata, margine sottile",
          testo:
            "Il rendimento nasce dai volumi: è il profilo dei settori leggeri, dalla grande distribuzione all'alimentare, e delle strategie di leadership di costo. La difesa del ROI passa dall'efficienza operativa e dalla velocità del ciclo, non dal prezzo.",
          level: "info",
        }
      : pc < 0.8 && ros >= 0.15
      ? {
          nome: "Margine elevato, capitale immobilizzato",
          testo:
            "Il rendimento nasce dal margine: è il profilo dei settori pesanti, con grandi investimenti fissi che bloccano la produttività del capitale verso il basso, e delle strategie di differenziazione con prezzi premium. La difesa del ROI passa dal potere di prezzo.",
          level: "info",
        }
      : {
          nome: "Profilo bilanciato",
          testo:
            "Nessuna delle due leve domina in modo netto: il rendimento poggia in misura simile su margine e rotazione. È la configurazione più comune ma anche la più esposta, perché non gode né della protezione del prezzo né di quella dei volumi.",
          level: "info",
        };

  // Ciclo di vita dedotto dalla dinamica congiunta di ROS, produttività e ricavi
  const rosPrec = rosDi(dPrec);
  const pcPrec = pcDi(dPrec);
  const ciclo =
    !isNum(ros) || !isNum(rosPrec) || !isNum(pc) || !isNum(pcPrec)
      ? null
      : ros < 0
      ? { nome: "Introduzione", testo: "Reddito operativo negativo con volumi ancora insufficienti a coprire la struttura: la fase in cui il ROI non è ancora un indicatore utile." }
      : isNum(tsv) && tsv > 0.08 && ros > rosPrec && pc <= pcPrec
      ? { nome: "Sviluppo", testo: "Il margine migliora per effetto dell'esperienza e delle economie di scala, ma la produttività del capitale resta compressa dagli investimenti che la crescita richiede." }
      : ros >= rosPrec && pc >= pcPrec
      ? { nome: "Maturità", testo: "Margine e rotazione migliorano insieme: la fase più redditizia, con impianti in larga parte già ammortizzati e struttura commerciale a regime. Da sorvegliare l'indice di sostituzione, perché parte del miglioramento può essere puramente contabile." }
      : ros < rosPrec && pc < pcPrec
      ? { nome: "Declino", testo: "Entrambe le leve arretrano: il mercato non assorbe più i volumi e il margine si comprime. È la configurazione che richiede una revisione del portafoglio di attività." }
      : { nome: "Transizione", testo: "Le due leve si muovono in direzioni opposte: l'analisi degli scostamenti qui sopra dice quale delle due stia prevalendo." };

  // Common size dei costi operativi
  const commonSize = d
    ? [
        { label: "Ricavi", v: d.ce.ricavi },
        { label: "Costo del venduto", v: isNum(d.ce.costoVenduto) ? -Math.abs(d.ce.costoVenduto) : null },
        { label: "Servizi", v: isNum(d.ce.costiServizi) ? -Math.abs(d.ce.costiServizi) : null },
        { label: "Valore aggiunto", v: d.ce.valoreAggiunto, forte: true },
        { label: "Costo del lavoro", v: isNum(costoLavoroDi(d, ctx)) ? -Math.abs(costoLavoroDi(d, ctx)) : null },
        { label: "MOL (EBITDA)", v: d.ce.ebitda, forte: true },
        { label: "Ammortamenti e accantonamenti", v: isNum(sottraiStretto(d.ce.ebitda, d.ce.mon)) ? -sottraiStretto(d.ce.ebitda, d.ce.mon) : null },
        { label: "MON", v: d.ce.mon, forte: true },
      ]
    : [];

  // Riconciliazione corporate del portafoglio ASA
  const asaNum = asa.map((r) => ({ ...r, ricaviN: num(r.ricavi), mscN: num(r.msc), coinN: num(r.coin) }));
  const sommaRicaviAsa = somma(...asaNum.map((r) => r.ricaviN));
  const sommaMscAsa = somma(...asaNum.map((r) => r.mscN));
  const sommaCoinAsa = somma(...asaNum.map((r) => r.coinN));
  const costiCentrali = isNum(sommaMscAsa) && isNum(d?.ce?.mon) ? sommaMscAsa - d.ce.mon : null;
  const capitaleNonAllocato = isNum(sommaCoinAsa) && isNum(d?.sp?.coin) ? d.sp.coin - sommaCoinAsa : null;

  const gloImpresa = safeDiv(mdcDi(d, ctx), d?.ce?.mon);
  const deImpresa = safeDiv(d?.sp?.pfn, d?.sp?.patrimonioNetto);

  return (
    <SectionCard
      titolo="Determinanti del ROI"
      eyebrow="Modello DuPont · produttività · rischio operativo"
      accento={GREEN}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={GREEN} />}
    >
      <div className="space-y-8">
        {/* A · DuPont */}
        <Blocco
          numero="A"
          titolo="Il modello DuPont · le due leve del ROI"
          descrizione="Il ROI non è un blocco unico: nasce dalla combinazione di due capacità distinte, la produttività con cui l'impresa impiega il capitale e la redditività che estrae dalle vendite. Separarle è il primo passo per capire perché l'azienda ha performato in un certo modo."
        >
          {griglia(IND_DUPONT)}
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Verifica dell'identità DuPont</Label>
            <div
              className="mt-2 text-sm font-bold tabular-nums"
              style={{ fontFamily: FONT_MONO, color: INK }}
            >
              {`ROS ${pct(ros)} × PC ${mult(pc)} = ROI ${pct(isNum(ros) && isNum(pc) ? ros * pc : null)}`}
            </div>
            <p className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              {isNum(roi) && isNum(ros) && isNum(pc) && Math.abs(ros * pc - roi) < 1e-9
                ? "L'identità quadra esattamente con il ROI operativo calcolato in Fase 2."
                : "Il prodotto è calcolato sulle stesse grandezze del ROI operativo di Fase 2."}
            </p>
          </div>
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Piano degli isoquanti</Label>
            <p className="mt-1 mb-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Ogni curva unisce tutte le combinazioni di ROS e produttività che producono lo stesso ROI. Spostarsi
              lungo una curva significa cambiare strategia a rendimento invariato; salire a una curva superiore
              significa creare valore.
            </p>
            <IsoquantiRoi
              punti={[
                { label: String(coppia?.corrente ?? ""), pc, ros, evidenza: true },
                { label: String(coppia?.precedente ?? ""), pc: pcPrec, ros: rosPrec },
              ]}
              peers={peers}
            />
          </div>
        </Blocco>

        {/* B · Scostamenti */}
        <Blocco
          numero="B"
          titolo="Analisi degli scostamenti e equilibrio della crescita"
          descrizione="Quando il ROI cambia da un esercizio all'altro, la scomposizione dice chi abbia contribuito di più fra margine e rotazione, isolando anche l'effetto congiunto che nasce dal loro muoversi insieme."
        >
          {scost ? (
            <>
              <GraficoScostamenti s={scost} />
              <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                {`Il ROI passa da ${pct(scost.roi0)} a ${pct(scost.roi1)}. `}
                {Math.abs(scost.effettoRos) >= Math.abs(scost.effettoPc)
                  ? `Il contributo dominante viene dal margine (${pp(scost.effettoRos)}) più che dalla rotazione del capitale (${pp(scost.effettoPc)}).`
                  : `Il contributo dominante viene dalla rotazione del capitale (${pp(scost.effettoPc)}) più che dal margine (${pp(scost.effettoRos)}).`}
              </p>
            </>
          ) : (
            <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
              Servono ROS e produttività di entrambi gli esercizi selezionati.
            </p>
          )}

          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Condizione di crescita equilibrata</Label>
            <div className="mt-2 flex flex-wrap gap-5">
              {[
                { l: "Tasso di sviluppo vendite", v: pct(tsv) },
                { l: "× Intensità di capitale", v: mult(intensita) },
                { l: "= Capitale assorbito per euro di ricavo", v: pct(assorbimentoCrescita) },
                { l: "ROS disponibile", v: pct(ros) },
              ].map((x) => (
                <div key={x.l}>
                  <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                    {x.l}
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {x.v}
                  </div>
                </div>
              ))}
            </div>
            {isNum(assorbimentoCrescita) && isNum(ros) && (
              <div className="mt-2">
                <Badge level={assorbimentoCrescita <= ros ? "ok" : "warn"}>
                  {assorbimentoCrescita <= ros
                    ? "La crescita è finanziabile con il margine operativo che produce"
                    : "La crescita assorbe più capitale di quanto il margine ne generi: serve finanza esterna"}
                </Badge>
              </div>
            )}
          </div>
        </Blocco>

        {/* C · Interpretazione */}
        <Blocco
          numero="C"
          titolo="Interpretazione · settore, strategia e ciclo di vita"
          descrizione="Il ROI non si valuta nel vuoto: lo stesso valore significa cose diverse a seconda del comparto, della strategia competitiva perseguita e della fase del ciclo di vita in cui l'impresa si trova."
          accento={BLUE}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Configurazione delle leve</Label>
              {profilo ? (
                <>
                  <div className="mt-2">
                    <Badge level={profilo.level}>{profilo.nome}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                    {profilo.testo}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
                  Dati insufficienti.
                </p>
              )}
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Fase del ciclo di vita</Label>
              {ciclo ? (
                <>
                  <div className="mt-2">
                    <Badge level="info">{ciclo.nome}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                    {ciclo.testo}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
                  Servono due esercizi per leggere la dinamica.
                </p>
              )}
            </div>
          </div>

          {isNum(intensita) && intensita < 0.15 && (
            <div className="mt-3">
              <Badge level="warn">
                Capitale investito irrisorio rispetto ai ricavi: il ROI perde significato aritmetico, usare
                l'Economic Profit in valore assoluto (Fase 2, blocco E)
              </Badge>
            </div>
          )}
        </Blocco>

        {/* D · Leva commerciale */}
        <Blocco
          numero="D"
          titolo="Leva commerciale e arbitraggio sui fornitori"
          descrizione="Il COIN è la differenza fra attività e passività operative. I debiti verso fornitori sono una spugna che finanzia parte dell'attivo senza capitale oneroso: è la ragione per cui il ROI è coerente dove il ROA è fuorviante."
          accento={BLUE}
        >
          {griglia(IND_LEVA_COMMERCIALE)}
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Scomposizione dell'arbitraggio</Label>
            <div className="mt-2 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {`ROA ${pct(roa)} × Leva commerciale ${mult(levCom)} = ROI ${pct(isNum(roa) && isNum(levCom) ? roa * levCom : null)}`}
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
              {isNum(roa) && isNum(levCom)
                ? `L'effetto spinta delle passività operative vale ${pp(roa * levCom - roa)} di rendimento aggiuntivo: è il differenziale fra quanto rendono le attività e quanto costa implicitamente finanziarle con i fornitori, e resta interamente a vantaggio dei soci.`
                : "Servono attività e passività operative dal modulo SP per scomporre l'arbitraggio."}
            </p>
          </div>
        </Blocco>

        {/* E · Immobilizzazioni */}
        <Blocco
          numero="E"
          titolo="Produttività delle immobilizzazioni e politiche di investimento"
          descrizione="Prima direttrice di analisi del denominatore: quanto rendono gli impianti al loro costo storico, e se l'impresa li stia sviluppando o solo mantenendo."
          accento={BLUE}
        >
          {griglia(IND_IMMOBILIZZAZIONI)}
        </Blocco>

        {/* F · Circolante */}
        <Blocco
          numero="F"
          titolo="Rotazione del capitale circolante"
          descrizione="Seconda direttrice: il tempo in cui la gestione corrente assorbe cassa, dato dalla differenza fra il ciclo attivo — giacenza delle scorte più incasso dei crediti — e il ciclo passivo dei pagamenti ai fornitori."
          accento={BLUE}
        >
          {griglia(IND_CIRCOLANTE)}
        </Blocco>

        {/* G · Valore aggiunto */}
        <Blocco
          numero="G"
          titolo="Redditività delle vendite, valore aggiunto e produttività del lavoro"
          descrizione="Il ROS dipende dall'incidenza dei costi operativi, che si legge riclassificando il conto economico per natura in percentuale sui ricavi. Il parametro cruciale è il valore aggiunto, punto d'incontro fra efficienza ed efficacia."
          accento={PURPLE}
        >
          {griglia(IND_VALORE_AGGIUNTO)}
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Conto economico in common size · {coppia?.corrente}</Label>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 360 }}>
                <tbody>
                  {commonSize.map((r) => (
                    <tr key={r.label} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td
                        className="py-1 pr-3 text-xs"
                        style={{ fontFamily: FONT_BODY, color: INK, fontWeight: r.forte ? 700 : 400 }}
                      >
                        {r.label}
                      </td>
                      <td className="py-1 pr-3 text-right text-xs tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                        {fmt(r.v)}
                      </td>
                      <td
                        className="py-1 text-right text-xs tabular-nums"
                        style={{ fontFamily: FONT_MONO, color: r.forte ? INK : `${INK}A0`, fontWeight: r.forte ? 700 : 400 }}
                      >
                        {pct(safeDiv(r.v, d?.ce?.ricavi))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              L'outsourcing riduce il valore aggiunto ma dovrebbe abbattere i costi fissi in misura maggiore: la
              lettura congiunta di questa tabella e della leva operativa dice se lo scambio sia stato conveniente.
              Esternalizzare attività «core» è un'altra cosa, e costa il vantaggio competitivo.
            </p>
          </div>
        </Blocco>

        {/* H · Rischio operativo */}
        <Blocco
          numero="H"
          titolo="Struttura dei costi e rischio operativo"
          descrizione="ROS e produttività elevati non bastano se l'impresa è esposta a rischi letali. La volatilità del reddito operativo dipende dal rischio di mercato, amplificato dalla rigidità della struttura interna."
          accento={PURPLE}
        >
          {griglia(IND_RISCHIO_OPERATIVO)}
        </Blocco>

        {/* I · CAPM */}
        <Blocco
          numero="I"
          titolo="Dal rischio operativo al costo del capitale · depurazione del beta"
          descrizione="Il beta che si legge sui mercati è sporco: contiene il rischio del business, quello finanziario e i costi fissi medi del settore. Per isolare il rischio operativo di questa impresa servono quattro passaggi di depurazione, più il rilevering conclusivo."
          accento={PURPLE}
        >
          <PassaggiBeta capm={par?.capm} gloImpresa={gloImpresa} deImpresa={deImpresa} aliquota={par?.aliquota} />
        </Blocco>

        {/* J · ASA e BCG */}
        <Blocco
          numero="J"
          titolo="Aree strategiche d'affari e matrice BCG"
          descrizione="Le imprese complesse operano su più mercati: il ROI aggregato è una media che nasconde profili opposti. Il segment reporting scompone ricavi, margine semilordo di contribuzione e COIN per area, e la matrice BCG dice se il portafoglio sia equilibrato."
          accento={PURPLE}
        >
          <EditorAsa asa={asa} onAsa={onAsa} />

          {asa.length > 0 && (
            <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Riconciliazione con il ROI corporate</Label>
              <p className="mt-1 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                Il ROI aziendale non è la media dei ROI delle ASA: bisogna ponderare ROS e produttività, poi
                sottrarre i costi centrali dal margine e aggiungere il capitale comune non allocato al denominatore.
                Le due voci qui sotto sono ricavate per differenza fra i totali delle ASA e i valori di bilancio.
              </p>
              <div className="mt-3 flex flex-wrap gap-5">
                {[
                  { l: "Ricavi ASA", v: fmt(sommaRicaviAsa) },
                  { l: "Margine semilordo ASA", v: fmt(sommaMscAsa) },
                  { l: "COIN allocato", v: fmt(sommaCoinAsa) },
                  { l: "Costi centrali (per differenza)", v: fmt(costiCentrali) },
                  { l: "Capitale non allocato", v: fmt(capitaleNonAllocato) },
                  { l: "ROS ponderato ASA", v: pct(safeDiv(sommaMscAsa, sommaRicaviAsa)) },
                  { l: "ROI corporate di bilancio", v: pct(roi) },
                ].map((x) => (
                  <div key={x.l}>
                    <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                      {x.l}
                    </div>
                    <div className="text-base font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                      {x.v}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <MatriceBcg asa={asa} sogliaCrescita={isNum(benchmark?.crescitaMediana) ? benchmark.crescitaMediana : 0.1} />
            <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Un portafoglio equilibrato ha Cash cow che finanziano lo sviluppo delle Star e la selezione delle
              Question mark, e dismette i Dog. La soglia di crescita che separa i quadranti è quella mediana del
              riferimento settoriale impostato in Fase 1; la dimensione delle bolle è proporzionale ai ricavi
              dell'area.
            </p>
          </div>
        </Blocco>
      </div>
    </SectionCard>
  );
}

/**
 * Pagina 3 — Solvibilità e solidità patrimoniale.
 *
 * L'impianto segue la distinzione che regge tutta l'analisi patrimoniale:
 * gli indici di COMPOSIZIONE leggono lo Stato Patrimoniale in verticale,
 * pesando ogni aggregato sul Capitale Investito Netto; gli indici di
 * CORRELAZIONE lo tagliano in orizzontale, confrontando categorie di
 * investimenti con categorie di finanziamenti. Le due letture rispondono a
 * domande diverse — «com'è fatta la struttura» e «le scadenze sono
 * sincronizzate» — e tenerle separate è metà del lavoro dell'analista.
 */
function PaginaSolvibilita({ dataset, anni, coppia, onCoppia, onVaiAiDati, par }) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "Il confronto storico richiede almeno due esercizi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file, non serve indicarli a mano."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const ctxDi = (a) => (a == null ? null : { anno: a, par });
  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  const cin = d?.sp?.capitaleInvestitoNetto;

  /* Gli strati vanno dal più durevole al più mobile: è l'ordine che rende
     leggibile la gradazione di tinta, e coincide con quello dei prospetti.

     Attenzione allo schema: la riclassificazione in uso è a POSIZIONE
     FINANZIARIA NETTA, quindi liquidità e attività finanziarie non compaiono
     fra gli impieghi — sono già portate in detrazione del debito, sul lato
     delle fonti. Sul lato degli impieghi compaiono invece in detrazione le
     passività operative non correnti (fondi, TFR, imposte differite), che
     riducono il capitale da finanziare. */
  const quadra = (voci, totale) => {
    const somma = voci.reduce((acc, v) => acc + (num(v.valore) || 0), 0);
    if (!isNum(totale) || totale === 0) return voci;
    const residuo = totale - somma;
    // Sotto mezzo punto di CIN è arrotondamento, non una posta mancante.
    if (Math.abs(residuo) < Math.abs(totale) * 0.005) return voci;
    return [...voci, { chiave: "residuo", nome: "Altre poste · differenza di quadratura", valore: residuo, tinta: voci[0]?.tinta || INK }];
  };

  const vociImpieghi = quadra(
    [
      { chiave: "immob", nome: "Investimenti strutturali netti", valore: d?.sp?.immobilizzazioniOperative, tinta: BLUE },
      { chiave: "acc", nome: "Attività accessorie", valore: d?.sp?.accessori, tinta: BLUE },
      { chiave: "ccn", nome: "Capitale circolante netto commerciale", valore: d?.sp?.ccno, tinta: BLUE },
      {
        chiave: "passnc",
        nome: "Passività operative non correnti (in detrazione)",
        valore: isNum(d?.sp?.passivitaOperativeNonCorrenti) ? -d.sp.passivitaOperativeNonCorrenti : null,
        tinta: BLUE,
      },
    ],
    cin
  );
  const vociFonti = quadra(
    [
      { chiave: "pn", nome: "Capitale netto", valore: d?.sp?.patrimonioNetto, tinta: PURPLE },
      { chiave: "dml", nome: "Debiti finanziari m/l termine", valore: d?.sp?.debitiFinanziariLungo, tinta: PURPLE },
      { chiave: "pfnb", nome: "Posizione finanziaria netta a breve", valore: pfnCorrenteDi(d), tinta: PURPLE },
    ],
    cin
  );

  const autonomia = d ? safeDiv(capitaleNettoRettificatoDi(d, ctx), d.sp?.capitaleInvestitoNetto) : null;
  const autonomiaPrec = dPrec ? safeDiv(capitaleNettoRettificatoDi(dPrec, ctxPrec), dPrec.sp?.capitaleInvestitoNetto) : null;
  const zona = zonaAutonomia(autonomia);

  /* Sbucciatura a strati del capitale netto (Fig. 13.10): ogni passaggio
     toglie una posta e mostra cosa resta a garanzia dei creditori. */
  const cn = capitaleNettoRettificatoDi(d, ctx);
  const part = partecipazioniDi(d, ctx) || 0;
  const imm = immaterialiDi(d, ctx);
  const tec = ppeDi(d, ctx);
  const strati = [
    { nome: "Capitale netto rettificato", esito: null, valore: cn, tolto: null },
    { nome: "− Partecipazioni", esito: "Capitale di rischio netto", valore: isNum(cn) ? cn - part : null, tolto: part },
    {
      nome: "− Attività immateriali",
      esito: "Capitale netto tangibile",
      valore: isNum(cn) && isNum(imm) ? cn - part - imm : null,
      tolto: imm,
    },
    {
      nome: "− Immobilizzazioni tecniche",
      esito: "Margine di copertura strutturale puro",
      valore: isNum(cn) && isNum(imm) && isNum(tec) ? cn - part - imm - tec : null,
      tolto: tec,
    },
  ];
  const scalaStrati = Math.max(...strati.map((s) => Math.abs(num(s.valore) ?? 0)), Math.abs(num(cn) ?? 1), 1);

  return (
    <SectionCard
      titolo="Solvibilità e solidità patrimoniale"
      eyebrow="Struttura finanziaria · analisi verticale e orizzontale"
      accento={BLUE}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={BLUE} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="Stato patrimoniale in common size"
          descrizione="La verifica della solidità si fonda sull'esame incrociato di due dimensioni: la struttura patrimoniale, cioè il mix degli investimenti in essere, e la struttura finanziaria, cioè il mix dei finanziamenti raccolti. Pesando ogni aggregato sul capitale investito netto le due colonne diventano confrontabili fra esercizi e fra imprese di dimensioni diverse."
          accento={BLUE}
        >
          <CommonSize impieghi={vociImpieghi} fonti={vociFonti} cin={cin} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <TabellaCommonSize voci={vociImpieghi} cin={cin} titolo="Impieghi · struttura patrimoniale" />
            <TabellaCommonSize voci={vociFonti} cin={cin} titolo="Fonti · struttura finanziaria" />
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Le due pile usano ciascuna una sola tinta a gradazioni perché i loro strati sono ordinati, dal più durevole
            al più mobile: non sono categorie indipendenti da distinguere, ma sezioni di uno stesso totale. Una posta
            negativa — un circolante che libera capitale invece di assorbirlo, o la liquidità che riduce il debito netto
            — scende sotto la linea dello zero, così la somma degli strati positivi può correttamente superare il 100%
            del CIN.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Lo schema in uso è a <strong>posizione finanziaria netta</strong>: liquidità e attività finanziarie non
            compaiono fra gli impieghi, perché sono già portate in detrazione del debito sul lato delle fonti. Fra gli
            impieghi compaiono invece in detrazione le passività operative non correnti — fondi, TFR, imposte differite
            — che riducono il capitale da finanziare. Entrambe le pile chiudono per costruzione sul CIN; se una posta
            non fosse riconducibile agli aggregati, comparirebbe come esplicita differenza di quadratura anziché essere
            silenziosamente omessa.
          </p>
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="Indici di composizione · impieghi"
          descrizione="Analisi verticale del lato sinistro: quanto pesa ciascuna categoria di investimento sul capitale investito netto. Ne esce il grado di elasticità o rigidità della struttura patrimoniale — quanto rapidamente l'impresa può riconvertire i propri impieghi se il mercato cambia."
          accento={BLUE}
        >
          {griglia(IND_COMPOSIZIONE_IMPIEGHI)}
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="Indici di composizione · fonti"
          descrizione="Analisi verticale del lato destro: il mix dei finanziamenti determina il grado di rigidità finanziaria, il costo medio dell'indebitamento e l'esposizione al rischio di tasso. La convenienza a sbilanciarsi verso il breve o verso il medio-lungo non ha una risposta universale: dipende dalle attese sui tassi."
          accento={BLUE}
        >
          {griglia(IND_COMPOSIZIONE_FONTI)}
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="Grado di indebitamento e rischio di liquidazione"
          descrizione="L'indice di autonomia patrimoniale è il perno dell'intera analisi di solidità. Le sue soglie non sono convenzionali: derivano dall'ipotesi di liquidazione, dove i valori contabili dell'attivo — estratti da una logica di azienda in funzionamento — subiscono falcidie stimabili attorno a un terzo."
          accento={BLUE}
        >
          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label color={`${INK}90`}>Fascia di autonomia patrimoniale</Label>
              {zona && <Badge level={zona.level}>{zona.nome}</Badge>}
            </div>
            <div className="mt-2">
              <FasciaAutonomia
                valore={autonomia}
                valorePrec={autonomiaPrec}
                annoCorrente={coppia?.corrente}
                annoPrecedente={coppia?.precedente}
              />
            </div>
            <table className="mt-2 w-full" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {ZONE_AUTONOMIA.map((z, i) => {
                  const da = i === 0 ? 0 : ZONE_AUTONOMIA[i - 1].fino;
                  const attiva = zona?.id === z.id;
                  return (
                    <tr key={z.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `${z.colore}55` }} />
                          <span
                            className="text-[11px]"
                            style={{ fontFamily: FONT_BODY, color: INK, fontWeight: attiva ? 700 : 400 }}
                          >
                            {z.nome}
                          </span>
                        </span>
                      </td>
                      <td
                        className="py-1 text-right text-[11px] tabular-nums"
                        style={{ fontFamily: FONT_MONO, color: `${INK}A0`, fontWeight: attiva ? 700 : 400 }}
                      >
                        {pct(da, 0)} – {pct(Math.min(z.fino, 1), 0)}
                      </td>
                      <td className="w-6 py-1 text-right text-[11px]" style={{ fontFamily: FONT_MONO, color: INK }}>
                        {attiva ? "◀" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4">{griglia(IND_INDEBITAMENTO)}</div>
          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${AMBER}0F`, borderLeft: `3px solid ${AMBER}`, color: INK }}
          >
            <strong>Rettifiche precauzionali.</strong> Prima di leggere questi indici vanno sottratte al capitale netto
            contabile le poste fittizie — crediti verso soci per versamenti ancora dovuti, azioni proprie — e sommate al
            debito le passività potenziali che si ritengono non accantonate, come i contenziosi in corso. Gli importi si
            indicano nella tabella «Rettifiche precauzionali» del sub-tab «1 · Base»: senza, gli indici usano i valori
            contabili così come sono.
          </div>
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="Indici di correlazione · copertura degli investimenti durevoli"
          descrizione="Analisi orizzontale: si taglia trasversalmente lo Stato Patrimoniale per testare la sincronia delle scadenze. La logica è ferrea — gli investimenti che resteranno vincolati per anni dovrebbero essere finanziati dal capitale netto, l'unica fonte che non impone scadenze di rimborso e non genera rischio di insolvenza. Il capitale netto si sbuccia a strati, dal margine più restrittivo a quello più allargato."
          accento={BLUE}
        >
          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Sbucciatura del capitale netto · {coppia?.corrente}</Label>
            <div className="mt-2 space-y-1.5">
              {strati.map((s, i) => {
                const v = num(s.valore);
                const larghezza = isNum(v) ? Math.min(Math.abs(v) / scalaStrati, 1) * 100 : 0;
                const negativo = isNum(v) && v < 0;
                return (
                  <div key={s.nome} className="flex items-center gap-2">
                    <div className="w-60 shrink-0 text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                      {s.nome}
                      {i > 0 && isNum(num(s.tolto)) && (
                        <span className="ml-1 tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
                          ({fmt(num(s.tolto))})
                        </span>
                      )}
                      {s.esito && (
                        <span className="block text-[10px] italic leading-tight" style={{ color: `${INK}80` }}>
                          → {s.esito}
                        </span>
                      )}
                    </div>
                    <div className="h-4 flex-1 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
                      <div
                        className="h-4 rounded-sm"
                        style={{ width: `${larghezza}%`, backgroundColor: negativo ? RED : BLUE }}
                      />
                    </div>
                    <div
                      className="w-28 shrink-0 text-right text-xs font-bold tabular-nums"
                      style={{ fontFamily: FONT_MONO, color: negativo ? RED : INK }}
                    >
                      {isNum(v) ? fmt(v) : "n.d."}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
              La sbucciatura è <strong>progressiva</strong>: ogni riga toglie anche le poste delle righe superiori, fino
              al margine di copertura strutturale puro. Le card qui sotto misurano invece ciascun margine contro
              l'<strong>intero</strong> capitale netto, secondo la definizione propria di ogni indice — i due valori
              coincidono solo quando gli strati precedenti sono nulli. Le barre sono in scala rispetto al capitale netto
              di partenza; il rosso segnala un residuo negativo, cioè poste che superano il patrimonio disponibile.
            </p>
          </div>
          <div className="mt-4">{griglia(IND_CORRELAZIONE)}</div>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="Liquidità · il primo argine di rischio"
          descrizione="Il rischio finanziario si scompone in due argini progressivi. Il primo riguarda i TEMPI: la probabilità di non adempiere puntualmente alle scadenze. Il secondo riguarda gli IMPORTI: la probabilità di non rimborsare il capitale complessivamente ricevuto, e assorbe logicamente il primo. La solidità appena esaminata è il prerequisito strutturale per superare eventuali crisi temporanee di liquidità ricorrendo a fonti esterne."
          accento={BLUE}
        >
          {griglia(IND_SOLVIBILITA)}
          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${BLUE}0D`, borderLeft: `3px solid ${BLUE}`, color: INK }}
          >
            Questi indici sono il primo affaccio sulla liquidità, letta però con gli stessi aggregati della solidità. La
            trattazione completa — Stato Patrimoniale finanziario, CCNf, indici severi di tesoreria e prova acida per
            l'analisi statica; ciclo monetario, costo del finanziamento del circolante e indici di cash flow per quella
            dinamica — sta nella pagina <strong>«3.1 · Liquidità statica e dinamica»</strong>.
          </div>
        </Blocco>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-ter. COMPONENTI GRAFICI DELLA LIQUIDITÀ (Fase 3.1)
   ═══════════════════════════════════════════════════════════════════════════
   Ogni figura ha accanto i propri numeri: nessun valore è raggiungibile per
   la sola via visiva. Le altezze e le larghezze sono sempre in scala rispetto
   a un totale dichiarato, così il confronto fra le due colonne è legittimo.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Seleziona e ordina alcuni indicatori di una lista per id: serve quando un
 *  blocco ne mostra solo una parte, senza duplicare le definizioni. */
const perId = (lista, ids) => ids.map((id) => lista.find((x) => x.id === id)).filter(Boolean);

/** Riquadro di avviso quando manca la materia prima per una figura. */
function FiguraVuota({ testo }) {
  return (
    <div
      className="rounded-md px-3 py-6 text-center text-[11px]"
      style={{ fontFamily: FONT_BODY, backgroundColor: PAPER, border: `1px dashed ${LINE}`, color: `${INK}90` }}
    >
      {testo}
    </div>
  );
}

/**
 * FIG. 13.12 — Le zone dello Stato Patrimoniale finanziario.
 * A sinistra i tempi di conversione in moneta, a destra i tempi di richiesta
 * di rimborso. Le due colonne condividono la stessa scala verticale, perché
 * chiudono per costruzione sullo stesso totale.
 */
function SpFinanziario({ ac, ai, pc, pd, cn }) {
  const totAtt = somma(ac, ai);
  const totFonti = somma(pc, pd, cn);
  const scala = Math.max(Math.abs(num(totAtt) || 0), Math.abs(num(totFonti) || 0));
  if (!scala) return <FiguraVuota testo="Servono gli aggregati dello Stato Patrimoniale per ricostruire le quattro zone." />;

  const H = 300;
  const altezza = (v) => (isNum(v) ? Math.max((Math.abs(v) / scala) * H, 22) : 0);

  const blocco = (nome, sotto, v, tinta, opacita, totale) => (
    <div
      key={nome}
      className="flex flex-col justify-center rounded-sm px-2 py-1"
      style={{
        height: altezza(v),
        backgroundColor: `${tinta}${opacita}`,
        border: `1px solid ${tinta}55`,
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-widest leading-tight" style={{ fontFamily: FONT_HEAD, color: INK }}>
        {nome}
      </div>
      <div className="text-[9px] leading-tight" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        {sotto}
      </div>
      <div className="mt-0.5 text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {fmt(v)}{" "}
        <span style={{ fontWeight: 400, color: `${INK}80` }}>
          {isNum(v) && isNum(totale) && totale !== 0 ? `· ${pct(v / totale, 0)}` : ""}
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label color={`${BLUE}C0`}>Impieghi · tempi di conversione in moneta</Label>
          <div className="mt-2 flex flex-col gap-1">
            {blocco("Attività correnti", "capitale circolante lordo · entro 12 mesi", ac, BLUE, "33", totAtt)}
            {blocco("Attività immobilizzate", "capitale fisso · oltre 12 mesi", ai, BLUE, "14", totAtt)}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
              Totale impieghi
            </span>
            <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {fmt(totAtt)}
            </span>
          </div>
        </div>

        <div>
          <Label color={`${PURPLE}C0`}>Fonti · tempi di richiesta di rimborso</Label>
          <div className="mt-2 flex flex-col gap-1">
            {blocco("Passività correnti", "rimborso entro 12 mesi o a revoca", pc, PURPLE, "33", totFonti)}
            {blocco("Passività differite", "debiti consolidati oltre 12 mesi", pd, PURPLE, "20", totFonti)}
            {blocco("Capitale netto", "nessun obbligo di rimborso", cn, PURPLE, "0D", totFonti)}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
              Totale fonti
            </span>
            <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {fmt(totFonti)}
            </span>
          </div>
        </div>
      </div>

      {isNum(totAtt) && isNum(totFonti) && Math.abs(totAtt - totFonti) > Math.abs(scala) * 0.005 && (
        <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: AMBER }}>
          Le due colonne non quadrano per {fmt(totAtt - totFonti)}: lo schema a monte è a posizione finanziaria netta e
          alcune poste — tipicamente le passività operative non correnti e le attività accessorie — vi compaiono già
          compensate. La figura resta leggibile nelle proporzioni, ma i totali non vanno letti come un bilancio
          civilistico riquadrato.
        </p>
      )}
    </div>
  );
}

/**
 * FIG. 13.13 — Il capitale circolante netto finanziario.
 * La sottrazione resa visivamente: le passività correnti allineate in alto
 * sulle attività correnti, e lo spazio che avanza sotto è il margine.
 */
function MargineCcnf({ ac, pc }) {
  const scala = Math.max(Math.abs(num(ac) || 0), Math.abs(num(pc) || 0));
  if (!scala) return <FiguraVuota testo="Servono attività e passività correnti per rappresentare il margine." />;
  const H = 150;
  const hAc = isNum(ac) ? (Math.abs(ac) / scala) * H : 0;
  const hPc = isNum(pc) ? (Math.abs(pc) / scala) * H : 0;
  const ccnf = sottraiStretto(ac, pc);
  const positivo = isNum(ccnf) && ccnf >= 0;

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex items-start gap-6">
        <div style={{ width: 120 }}>
          <div className="rounded-sm" style={{ height: hAc, backgroundColor: `${BLUE}33`, border: `1px solid ${BLUE}66` }} />
          <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}90` }}>
            Attività correnti
          </div>
          <div className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {fmt(ac)}
          </div>
        </div>

        <div style={{ width: 120 }}>
          <div className="rounded-sm" style={{ height: hPc, backgroundColor: `${PURPLE}33`, border: `1px solid ${PURPLE}66` }} />
          {positivo && (
            <div
              className="mt-0 flex items-center justify-center rounded-sm"
              style={{
                height: Math.max(hAc - hPc, 0),
                border: `1px dashed ${GREEN}`,
                backgroundColor: `${GREEN}0F`,
              }}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: GREEN }}>
                CCNf
              </span>
            </div>
          )}
          <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}90` }}>
            Passività correnti
          </div>
          <div className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {fmt(pc)}
          </div>
        </div>

        <div className="flex-1">
          <Label color={`${INK}90`}>Condizione di liquidità contabile</Label>
          <div
            className="mt-1 text-2xl font-bold tabular-nums"
            style={{ fontFamily: FONT_MONO, color: positivo ? GREEN : RED }}
          >
            {fmt(ccnf)}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            {positivo
              ? "Lo spazio che avanza sotto le passività correnti è il margine: le entrate attese entro dodici mesi eccedono le uscite dello stesso arco."
              : "Le passività correnti superano le attività correnti: non esiste margine, e i debiti a breve non sono pagabili con le sole entrate a breve."}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * FIG. 13.14 — Il grado di urgenza monetaria.
 * Le due colonne scendono dal più urgente al meno urgente: a sinistra la
 * velocità con cui l'attivo diventa cassa, a destra la perentorietà con cui
 * il passivo la richiede.
 */
function ScalaUrgenza({ attivo, passivo }) {
  const totA = somma(...attivo.map((r) => r.valore));
  const totP = somma(...passivo.map((r) => r.valore));
  const scala = Math.max(Math.abs(num(totA) || 0), Math.abs(num(totP) || 0));
  if (!scala) return <FiguraVuota testo="Servono le componenti del circolante per costruire la scala di urgenza." />;

  const colonna = (titolo, righe, totale, tinta) => (
    <div>
      <Label color={`${tinta}C0`}>{titolo}</Label>
      <div className="mt-2 space-y-1.5">
        {righe.map((r, i) => {
          const larghezza = isNum(r.valore) ? Math.min(Math.abs(r.valore) / scala, 1) * 100 : 0;
          return (
            <div key={r.nome}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  {r.nome}
                  <span className="ml-1 text-[10px] italic" style={{ color: `${INK}80` }}>
                    {r.nota}
                  </span>
                </span>
                <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(r.valore)}
                </span>
              </div>
              <div className="mt-0.5 h-3 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
                <div
                  className="h-3 rounded-sm"
                  style={{ width: `${larghezza}%`, backgroundColor: tinta, opacity: 1 - i * 0.28 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
        <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
          Totale
        </span>
        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {fmt(totale)}
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
          ▲ più urgente in alto · meno urgente in basso
        </span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {colonna("Attività correnti · velocità di realizzo", attivo, totA, BLUE)}
        {colonna("Passività correnti · perentorietà dell'uscita", passivo, totP, PURPLE)}
      </div>
    </div>
  );
}

/**
 * FIG. 13.15 — Le misure di liquidità, a cascata.
 * Ogni gradino stringe il perimetro: prima sul numeratore, poi anche sul
 * denominatore. Il valore va letto insieme al perimetro che lo ha prodotto.
 */
function CascataLiquidita({ misure }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            <th className="py-1 pr-2 text-left">
              <Label color={`${INK}80`}>Indice</Label>
            </th>
            <th className="py-1 px-2 text-left">
              <Label color={`${INK}80`}>Numeratore</Label>
            </th>
            <th className="py-1 px-2 text-left">
              <Label color={`${INK}80`}>Denominatore</Label>
            </th>
            <th className="py-1 pl-2 text-right">
              <Label color={`${INK}80`}>Valore</Label>
            </th>
          </tr>
        </thead>
        <tbody>
          {misure.map((m, i) => (
            <tr key={m.nome} style={{ borderTop: `1px solid ${LINE}` }}>
              <td className="py-2 pr-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[10px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
                    {i + 1}
                  </span>
                  <span className="text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
                    {m.nome}
                  </span>
                </div>
              </td>
              <td className="py-2 px-2">
                <div className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  {m.numeratore}
                </div>
                <div className="text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}90` }}>
                  {fmt(m.vNum)}
                </div>
              </td>
              <td className="py-2 px-2">
                <div className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  {m.denominatore}
                </div>
                <div className="text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}90` }}>
                  {fmt(m.vDen)}
                </div>
              </td>
              <td className="py-2 pl-2 text-right">
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ fontFamily: FONT_MONO, color: LEVEL_COLOR[m.level] || INK }}
                >
                  {mult(safeDiv(m.vNum, m.vDen))}
                </span>
                <div className="text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
                  soglia {m.soglia}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * FIG. 13.16 — La ricostruzione del ciclo monetario.
 * Sopra la linea il ciclo attivo (giacenza + incasso), sotto il ciclo passivo
 * (dilazione fornitori). La freccia misura il divario netto.
 */
function CicloMonetario({ scorte, crediti, fornitori }) {
  if (![scorte, crediti, fornitori].every(isNum))
    return (
      <FiguraVuota testo="Servono giorni di giacenza, di incasso e di pagamento: indica costo del venduto, crediti e debiti commerciali nei parametri per esercizio." />
    );

  /* Il disegno è a fasce orizzontali fisse: etichette degli eventi in alto,
     ciclo attivo, linea del tempo, ciclo passivo, evento di pagamento e
     freccia del divario. Nessuna fascia invade quella accanto, così le
     etichette restano leggibili anche quando due eventi quasi coincidono. */
  const W = 680;
  const H = 190;
  const x0 = 24;
  const x1 = W - 24;
  const attivo = scorte + crediti;
  const maxG = Math.max(attivo, fornitori, 1);
  const x = (g) => x0 + (g / maxG) * (x1 - x0);
  const yEtichetta = 16;
  const yBarraAttiva = 40;
  const yLinea = 74;
  const yBarraPassiva = 84;
  const yEvento = 128;
  const yFreccia = 168;
  const ciclo = attivo - fornitori;
  const coloreCiclo = ciclo > 0 ? AMBER : GREEN;

  /* Alle estremità il testo centrato uscirebbe dal riquadro: si ancora al bordo. */
  const ancora = (px) => (px < x0 + 44 ? "start" : px > x1 - 44 ? "end" : "middle");

  /* Etichetta interna alla barra solo se il segmento è abbastanza largo:
     altrimenti il testo deborda su ciò che gli sta accanto. */
  const etichettaBarra = (xa, xb, testo, y) =>
    xb - xa >= 76 ? (
      <text x={(xa + xb) / 2} y={y} textAnchor="middle" style={{ fontFamily: FONT_BODY, fontSize: 9, fill: INK }}>
        {testo}
      </text>
    ) : null;

  const tacca = (g, label, sopra) => {
    const px = x(g);
    const y = sopra ? yEtichetta : yEvento;
    return (
      <g key={`${label}-${g}`}>
        <line
          x1={px}
          y1={sopra ? yLinea - 8 : yLinea + 8}
          x2={px}
          y2={sopra ? y + 6 : y - 14}
          stroke={`${INK}40`}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <text
          x={px}
          y={y}
          textAnchor={ancora(px)}
          style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, fill: INK, letterSpacing: "0.06em" }}
        >
          {label.toUpperCase()}
        </text>
        <text x={px} y={y + 11} textAnchor={ancora(px)} style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}90` }}>
          gg {fmt(g)}
        </text>
      </g>
    );
  };

  return (
    <div className="rounded-md p-2" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Ciclo monetario">
        {/* barre del ciclo attivo */}
        <rect x={x(0)} y={yBarraAttiva} width={x(scorte) - x(0)} height={18} rx="2" fill={`${BLUE}40`} stroke={`${BLUE}80`} />
        {etichettaBarra(x(0), x(scorte), "giacenza scorte", yBarraAttiva + 13)}
        <rect
          x={x(scorte)}
          y={yBarraAttiva}
          width={x(attivo) - x(scorte)}
          height={18}
          rx="2"
          fill={`${BLUE}22`}
          stroke={`${BLUE}80`}
        />
        {etichettaBarra(x(scorte), x(attivo), "incasso crediti", yBarraAttiva + 13)}
        <text
          x={x1}
          y={yLinea - 4}
          textAnchor="end"
          style={{ fontFamily: FONT_HEAD, fontSize: 8, fill: `${BLUE}C0`, letterSpacing: "0.1em" }}
        >
          CICLO ATTIVO
        </text>

        {/* linea del tempo */}
        <line x1={x0} y1={yLinea} x2={x1} y2={yLinea} stroke={INK} strokeWidth="1.5" />

        {/* barra del ciclo passivo */}
        <rect x={x(0)} y={yBarraPassiva} width={x(fornitori) - x(0)} height={18} rx="2" fill={`${PURPLE}30`} stroke={`${PURPLE}80`} />
        {etichettaBarra(x(0), x(fornitori), "dilazione fornitori", yBarraPassiva + 13)}
        <text
          x={x0}
          y={yBarraPassiva + 30}
          style={{ fontFamily: FONT_HEAD, fontSize: 8, fill: `${PURPLE}C0`, letterSpacing: "0.1em" }}
        >
          CICLO PASSIVO
        </text>

        {/* Tacche degli eventi. Quando due momenti quasi coincidono le
            etichette si sovrapporrebbero: si dirada tenendo le più
            informative, cioè l'inizio e la fine del ciclo attivo. */}
        {diradaEtichette(
          [
            { x: x(attivo), g: attivo, label: "Riscossione" },
            { x: x(0), g: 0, label: "Acquisto fattori" },
            { x: x(scorte), g: scorte, label: "Vendita" },
          ],
          118
        ).map((p) => tacca(p.g, p.label, true))}
        {tacca(fornitori, "Pagamento acquisti", false)}

        {/* freccia del divario netto */}
        <line
          x1={x(Math.min(fornitori, attivo))}
          y1={yFreccia}
          x2={x(Math.max(fornitori, attivo))}
          y2={yFreccia}
          stroke={coloreCiclo}
          strokeWidth="2"
        />
        <circle cx={x(fornitori)} cy={yFreccia} r="3.5" fill={coloreCiclo} />
        <circle cx={x(attivo)} cy={yFreccia} r="3.5" fill={coloreCiclo} />
        <text
          x={(x(fornitori) + x(attivo)) / 2}
          y={yFreccia - 8}
          textAnchor={ancora((x(fornitori) + x(attivo)) / 2)}
          style={{ fontFamily: FONT_HEAD, fontSize: 10, fontWeight: 700, fill: coloreCiclo }}
        >
          durata del ciclo monetario · {fmt(ciclo)} gg
        </text>
      </svg>
      <p className="mt-1 px-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        {ciclo > 0
          ? "Il buco monetario è la distanza fra il pagamento degli acquisti e la riscossione delle vendite: sono i giorni che l'impresa deve finanziare per ogni ciclo, e che si moltiplicano con il crescere del fatturato."
          : "L'incasso precede il pagamento: il ciclo si autofinanzia e la crescita, invece di assorbire cassa, ne libera."}
      </p>
    </div>
  );
}

/**
 * FIG. 13.17 — Le determinanti dell'incidenza degli oneri finanziari.
 * L'incidenza sul fatturato è il prodotto fra costo medio del debito e
 * intensità dell'indebitamento: due leve distinte, con rimedi distinti.
 */
function DeterminantiOneri({ incidenza, rod, intensita }) {
  const oltre = isNum(intensita) && intensita > 1;
  const casella = (titolo, valore, nota, colore) => (
    <div className="flex-1 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${colore}55` }}>
      <Label color={`${colore}C0`}>{titolo}</Label>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: colore }}>
        {valore}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        {nota}
      </p>
    </div>
  );

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-md rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${INK}30` }}>
        <Label color={`${INK}90`}>Incidenza degli oneri finanziari sui ricavi</Label>
        <div
          className="mt-1 text-2xl font-bold tabular-nums"
          style={{ fontFamily: FONT_MONO, color: isNum(incidenza) && incidenza > 0.05 ? RED : INK }}
        >
          {pct(incidenza)}
        </div>
        <div className="text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
          soglia di guardia 5,0%
        </div>
      </div>

      <div className="my-2 text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▲ prodotto di ▲
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {casella(
          "ROD · costo medio dell'indebitamento",
          pct(rod),
          "Il tasso effettivamente pagato ai creditori: dipende dal merito di credito, dalle forme tecniche e dal mercato.",
          BLUE
        )}
        <div className="flex items-center justify-center px-1 text-lg font-bold" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
          ×
        </div>
        {casella(
          "Intensità dell'indebitamento · Debiti / Ricavi",
          mult(intensita),
          oltre
            ? "Oltre il punto di non ritorno: superato l'1, il rapporto moltiplica il peso degli oneri e un lieve calo delle vendite rende impossibile servire il debito."
            : "Sotto l'unità il rapporto frena il peso degli oneri: è il fatturato a sostenere il debito, non il contrario.",
          oltre ? RED : GREEN
        )}
      </div>
    </div>
  );
}

/**
 * FIG. 13.18 — Le aree monetarie della gestione, a scalare.
 * Produzione, assorbimento netto e raccolta: la sequenza dice quale area
 * genera moneta e quale la consuma, prima di arrivare alla variazione di cassa.
 */
function CascataFlussi({ righe }) {
  const valori = righe.filter((r) => isNum(r.valore)).map((r) => Math.abs(r.valore));
  const scala = valori.length ? Math.max(...valori) : 0;
  if (!scala) return <FiguraVuota testo="Servono gli aggregati del Rendiconto Finanziario per ricostruire le aree monetarie." />;

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="space-y-1">
        {righe.map((r) => {
          const v = num(r.valore);
          const larghezza = isNum(v) ? Math.min(Math.abs(v) / scala, 1) * 100 : 0;
          const negativo = isNum(v) && v < 0;
          const tinta = r.totale ? INK : negativo ? RED : GREEN;
          return (
            <div key={r.nome} className="flex items-center gap-2">
              <div className="w-20 shrink-0 text-[9px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
                {r.zona || ""}
              </div>
              <div
                className="w-56 shrink-0 text-[11px]"
                style={{ fontFamily: FONT_BODY, color: INK, fontWeight: r.totale ? 700 : 400 }}
              >
                {r.nome}
              </div>
              <div className="h-3.5 flex-1 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
                <div className="h-3.5 rounded-sm" style={{ width: `${larghezza}%`, backgroundColor: tinta, opacity: r.totale ? 0.9 : 0.6 }} />
              </div>
              <div
                className="w-28 shrink-0 text-right text-xs tabular-nums"
                style={{ fontFamily: FONT_MONO, color: isNum(v) ? (negativo ? RED : INK) : `${INK}70`, fontWeight: r.totale ? 700 : 500 }}
              >
                {isNum(v) ? segnato(v) : "n.d."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Sintesi diagnostica: incrocia il verdetto statico (esistono i valori?) con
 * quello dinamico (arrivano al momento giusto?). Un CCNf positivo è condizione
 * necessaria ma non sufficiente; un CCNf negativo è invece una certezza di
 * allarme, e la lettura congiunta lo rende esplicito.
 */
function SintesiLiquidita({ ccnf, liquiditaGenerale, liquiditaPrimaria, ciclo, flusso, gradoFin }) {
  const staticaOk = isNum(liquiditaGenerale) ? liquiditaGenerale >= 1 && (!isNum(ccnf) || ccnf > 0) : null;
  const dinamicaOk = isNum(flusso) ? flusso > 0 : null;

  const diagnosi =
    staticaOk === null || dinamicaOk === null
      ? {
          level: "info",
          nome: "Diagnosi incompleta",
          testo:
            "Per incrociare le due letture servono sia gli aggregati patrimoniali sia il flusso operativo corrente del Rendiconto Finanziario.",
        }
      : staticaOk && dinamicaOk
      ? {
          level: "ok",
          nome: "Equilibrio confermato su entrambe le letture",
          testo:
            "Gli stock a breve coprono le uscite attese e la gestione corrente produce cassa. Resta da sorvegliare lo sfasamento infrannuale: l'anno convenzionale è un blocco unico, e debiti in scadenza a gennaio contro incassi previsti a novembre restano compatibili con un CCNf positivo.",
        }
      : staticaOk && !dinamicaOk
      ? {
          level: "warn",
          nome: "Equilibrio statico non confermato dai flussi",
          testo:
            "La fotografia patrimoniale è tranquillizzante ma la gestione corrente brucia cassa: il margine esiste in forma di crediti e scorte, non di moneta. È la configurazione tipica dell'overtrading, dove la crescita assorbe circolante più rapidamente di quanto il reddito lo rigeneri.",
        }
      : !staticaOk && dinamicaOk
      ? {
          level: "warn",
          nome: "Squilibrio statico compensato dai flussi",
          testo:
            "Gli stock a breve non coprono le passività correnti, ma la gestione corrente produce cassa: la tenuta dipende dalla continuità di quel flusso e dal rinnovo degli affidamenti bancari. È la condizione fisiologica di chi incassa prima di pagare, patologica in tutti gli altri casi.",
        }
      : {
          level: "bad",
          nome: "Squilibrio su entrambe le letture",
          testo:
            "Né gli stock a breve né i flussi coprono le uscite attese: la solvibilità dipende interamente da nuova finanza esterna. È la combinazione che precede le crisi di liquidità conclamate, e va letta insieme al grado di autonomia patrimoniale della Fase 3.",
        };

  const riga = (nome, valore, nota) => (
    <div key={nome} className="flex items-baseline justify-between gap-3 py-1" style={{ borderTop: `1px solid ${LINE}` }}>
      <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
        {nome}
        <span className="ml-1 text-[10px] italic" style={{ color: `${INK}80` }}>
          {nota}
        </span>
      </span>
      <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {valore}
      </span>
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
        <Label color={`${INK}90`}>Quadro sinottico</Label>
        <div className="mt-2">
          {riga("CCNf", fmt(ccnf), "statica · margine")}
          {riga("Indice di liquidità generale", mult(liquiditaGenerale), "statica · soglia 2")}
          {riga("Indice di liquidità primaria", mult(liquiditaPrimaria), "statica · soglia 1")}
          {riga("Durata del ciclo monetario", isNum(ciclo) ? `${fmt(ciclo)} gg` : "n.d.", "dinamica · tempi")}
          {riga("Flusso operativo corrente", fmt(flusso), "dinamica · cassa prodotta")}
          {riga("Grado di finanziamento bancario", mult(gradoFin), "dinamica · copertura del ciclo")}
        </div>
      </div>
      <div className="rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LEVEL_COLOR[diagnosi.level]}55` }}>
        <Label color={`${INK}90`}>Diagnosi congiunta</Label>
        <div className="mt-2">
          <Badge level={diagnosi.level}>{diagnosi.nome}</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}D0` }}>
          {diagnosi.testo}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-quater. PAGINA 3.1 — LIQUIDITÀ: ANALISI STATICA E DINAMICA
   ═══════════════════════════════════════════════════════════════════════════ */

function PaginaLiquidita({ dataset, anni, coppia, onCoppia, onVaiAiDati, par }) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "L'analisi dinamica confronta i tempi e i flussi fra due esercizi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file, non serve indicarli a mano."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;
  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    return { anno: a, annoPrecedente: ap, prec: ap != null ? dataset[ap] : null, par };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  /* ── Grandezze della pagina ─────────────────────────────────────────────── */
  const ac = attivitaCorrentiDi(d);
  const ai = attivitaImmobilizzateDi(d);
  const pc = passivitaCorrentiDi(d);
  const pd = passivitaDifferiteDi(d);
  const cn = d?.sp?.patrimonioNetto ?? null;
  const scorte = disponibilitaDi(d);
  const liqImm = liquiditaImmediateDi(d, ctx);
  const liqDiff = liquiditaDifferiteDi(d, ctx);
  const scoperti = scopertiDi(d, ctx);
  const rotazione = passivitaRotazioneDi(d, ctx);
  const strette = passivitaStretteDi(d, ctx);

  const ccnf = ccnfDi(d);
  const liqGenerale = safeDiv(ac, pc);
  const liqPrimaria = safeDiv(sottrai(ac, scorte), pc);
  const liqSecca = safeDiv(liqImm, pc);
  const provaAcida = safeDiv(liqImm, strette);

  const livello = (v, soglia) =>
    !isNum(v) ? "info" : v >= soglia ? "ok" : v >= soglia * 0.75 ? "warn" : "bad";

  const misureLiquidita = [
    {
      nome: "Liquidità generale",
      numeratore: "Attività correnti",
      denominatore: "Passività correnti",
      vNum: ac,
      vDen: pc,
      soglia: "≈ 2",
      level: livello(liqGenerale, 2),
    },
    {
      nome: "Liquidità primaria",
      numeratore: "Attività correnti − scorte",
      denominatore: "Passività correnti",
      vNum: sottrai(ac, scorte),
      vDen: pc,
      soglia: "≥ 1",
      level: livello(liqPrimaria, 1),
    },
    {
      nome: "Liquidità secca (quick ratio)",
      numeratore: "Liquidità immediate",
      denominatore: "Passività correnti",
      vNum: liqImm,
      vDen: pc,
      soglia: "prova di stress",
      level: livello(liqSecca, 0.25),
    },
    {
      nome: "Prova acida (cash ratio)",
      numeratore: "Liquidità immediate",
      denominatore: "Passività a breve in senso stretto",
      vNum: liqImm,
      vDen: strette,
      soglia: "≥ 1",
      level: livello(provaAcida, 1),
    },
  ];

  const flussoCorrente = flussoCorrenteDi(d);
  const capex = capexDi(d);
  const fcfo = d?.rf?.fcfo ?? null;
  const servizioDebito = isNum(d?.rf?.servizioDelDebito) ? -Math.abs(d.rf.servizioDelDebito) : null;
  const fcfe = fcfeDi(d);
  const dividendi = isNum(d?.rf?.dividendi) ? -Math.abs(d.rf.dividendi) : null;
  const raccolta = d?.rf?.raccolta ?? null;
  const fabbisogno = isNum(fcfe) ? fcfe + (isNum(dividendi) ? dividendi : 0) : null;
  const variazione = isNum(fabbisogno) && isNum(raccolta) ? fabbisogno + raccolta : null;

  const righeFlussi = [
    { zona: "Produzione", nome: "Flusso della gestione del ciclo operativo", valore: flussoCorrente },
    { zona: "", nome: "± Flusso della struttura operativa (capex)", valore: capex },
    { zona: "", nome: "= Free cash flow operativo", valore: fcfo, totale: true },
    { zona: "Assorbimento", nome: "− Flussi a servizio del debito", valore: servizioDebito },
    { zona: "", nome: "= Free cash flow a servizio dell'equity", valore: fcfe, totale: true },
    { zona: "", nome: "− Flussi a servizio dell'equity (dividendi)", valore: dividendi },
    { zona: "", nome: "= Fabbisogno finanziario residuo", valore: fabbisogno, totale: true },
    { zona: "Raccolta", nome: "+ Nuovi debiti e aumenti di capitale", valore: raccolta },
    { zona: "", nome: "= Variazione del saldo di cassa / PFN a breve", valore: variazione, totale: true },
  ];

  const ciclo = cicloMonetarioDi(d, ctx);
  const gradoFin = safeDiv(scoperti, d?.sp?.ccno);

  return (
    <SectionCard
      titolo="Liquidità · analisi statica e dinamica"
      eyebrow="Solvibilità · il respiro quotidiano dell'impresa"
      accento={BLUE}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={BLUE} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="Lo Stato Patrimoniale finanziario · le quattro zone"
          descrizione="Se la solidità patrimoniale è la struttura portante che garantisce i finanziatori nel lungo periodo, la liquidità è la condizione operativa quotidiana: la capacità di far fronte con le proprie entrate alle uscite in scadenza. Senza liquidità, anche un patrimonio solido non evita l'insolvenza tecnica. Per misurarla lo Stato Patrimoniale va riclassificato secondo la facilità di conversione in moneta, e la logica gestionale si capovolge: le attività diventano fonti di copertura, le passività fabbisogni da coprire."
          accento={BLUE}
        >
          <SpFinanziario ac={ac} ai={ai} pc={pc} pd={pd} cn={cn} />
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { nome: "Capitali permanenti", valore: fmt(capitaliPermanentiDi(d)), nota: "passività differite + capitale netto" },
              {
                nome: "Copertura degli impieghi durevoli",
                valore: mult(safeDiv(capitaliPermanentiDi(d), ai)),
                nota: "capitali permanenti ÷ attività immobilizzate",
              },
              { nome: "CCNf", valore: fmt(ccnf), nota: "attività correnti − passività correnti" },
            ].map((r) => (
              <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
                <Label color={`${INK}80`}>{r.nome}</Label>
                <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {r.valore}
                </div>
                <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                  {r.nota}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Le due grandezze sono lo stesso fatto visto dai due lati: se i capitali permanenti coprono più delle
            attività immobilizzate, l'eccedenza finanzia il circolante ed è esattamente il CCNf. Un quoziente sopra 1 e
            un CCNf positivo sono quindi la medesima condizione, letta una volta sulle scadenze lunghe e una volta su
            quelle brevi.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Primo vincolo · il tempo</Label>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                Calcolare la liquidità istante per istante è impossibile con bilanci annuali: si adotta per convenzione
                l'anno solare come spartiacque fra breve termine e medio-lungo. È una convenzione comoda e imprecisa, e
                l'analisi dinamica del blocco D serve proprio a correggerne i limiti.
              </p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${INK}90`}>Secondo vincolo · il funzionamento</Label>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                La conversione in moneta non deve pregiudicare l'operatività ordinaria (going concern). Un'obbligazione
                quotata di terzi si vende subito senza bloccare nulla ed è attività corrente; un macchinario
                indispensabile o una partecipazione strategica, pur vendibili in fretta, distruggerebbero l'attività:
                restano capitale fisso.
              </p>
            </div>
          </div>
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="Il capitale circolante netto finanziario e la liquidità generale"
          descrizione="Il cuore dell'analisi statica è il confronto diretto fra la zona delle entrate attese a breve e quella delle uscite attese a breve. Dalla stessa differenza, espressa in quoziente, nasce l'indice di liquidità generale."
          accento={BLUE}
        >
          <MargineCcnf ac={ac} pc={pc} />
          <div className="mt-4">{griglia(perId(IND_LIQUIDITA_STATICA, ["ccnf", "liquiditaGenerale"]))}</div>
          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${AMBER}0F`, borderLeft: `3px solid ${AMBER}`, color: INK }}
          >
            <strong>I limiti di una fotografia.</strong> Questi due indicatori misurano una liquidità <em>contabile</em>,
            e soffrono di tre limiti strutturali. <strong>L'illusione del magazzino</strong>: un CCNf elevato può essere
            trainato da scorte invendibili, e la liquidità florida sulla carta essere nulla nei fatti — è il limite che
            il blocco C rimuove. <strong>Lo sfasamento temporale interno</strong>: l'anno convenzionale è un blocco
            unico, e se i debiti scadono a gennaio mentre i crediti si incassano a novembre il CCNf di fine esercizio
            resta positivo mentre l'azienda va in default di cassa a inizio anno. <strong>L'assenza dei flussi
            futuri</strong>: la fotografia al 31/12 non intercetta le entrate e le uscite operative dei mesi successivi.
            Un CCNf positivo è dunque condizione necessaria ma non sufficiente; un CCNf negativo è invece una certezza di
            allarme.
          </div>
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="Indici severi · il grado di urgenza monetaria"
          descrizione="Per depurare gli indici dai limiti appena esposti, attività e passività correnti si scompongono secondo l'effettivo grado di urgenza temporale. A sinistra la velocità con cui l'attivo diventa cassa, a destra la perentorietà con cui il passivo la richiede: gli indici severi si costruiscono prendendo, di volta in volta, solo le righe più urgenti."
          accento={BLUE}
        >
          <ScalaUrgenza
            attivo={[
              { nome: "Liquidità immediate", nota: "cassa e titoli a vista", valore: liqImm },
              { nome: "Liquidità differite", nota: "crediti commerciali: manca solo l'incasso", valore: liqDiff },
              { nome: "Disponibilità", nota: "scorte: devono attraversare produzione, vendita e incasso", valore: scorte },
            ]}
            passivo={[
              { nome: "Passività a breve in senso stretto", nota: "rate di mutuo, Fisco, dividendi: inevitabili", valore: strette },
              { nome: "Passività a rotazione", nota: "fornitori: si rinnovano con il ciclo acquisti", valore: rotazione },
              { nome: "Passività a scadenza indeterminata", nota: "scoperti di c/c: si rinnovano salvo revoca", valore: scoperti },
            ]}
          />
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Le misure di liquidità, a cascata</Label>
            <p className="mt-1 mb-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Ogni gradino stringe il perimetro: prima esce il magazzino dal numeratore, poi escono i crediti, infine
              escono dal denominatore le passività che si rinnovano da sé. L'ultimo gradino risponde alla sola domanda
              che conta nelle crisi: la cassa copre le uscite che nessuno può rinviare?
            </p>
            <CascataLiquidita misure={misureLiquidita} />
            {!isNum(strette) || strette === 0 ? (
              <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: AMBER }}>
                L'ultimo gradino resta in <em>n.d.</em>: nello schema a posizione finanziaria netta le passività correnti
                coincidono con la somma di scoperti bancari e debiti operativi, e la stima per differenza si azzera. Per
                attivare la prova acida indica le passività a breve in senso stretto — rate di mutuo in scadenza, debiti
                tributari, dividendi deliberati — nella tabella dei parametri per esercizio del sub-tab «1 · Base».
              </p>
            ) : null}
          </div>
          <div className="mt-4">
            {griglia(perId(IND_LIQUIDITA_STATICA, ["margineTesoreria", "liquiditaPrimaria", "liquiditaSecca", "cashRatio"]))}
          </div>
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="Analisi dinamica · la durata del ciclo monetario"
          descrizione="L'analisi statica dice quanto si incasserà, non quando. Il ciclo monetario colma la lacuna misurando l'intervallo netto che separa in media le uscite per acquisti dalle entrate da vendite: è il fabbisogno che la gestione corrente genera per il solo fatto di funzionare, e che va coperto con fonti esterne."
          accento={BLUE}
        >
          <CicloMonetario
            scorte={giorniScorteDi(d, ctx)}
            crediti={giorniCreditiDi(d, ctx)}
            fornitori={giorniFornitoriDi(d, ctx)}
          />
          <div className="mt-4">{griglia(IND_CICLO_MONETARIO)}</div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Una dilazione fornitori patologicamente lunga, in imprese con scarso potere contrattuale, non è un segnale di
            efficienza negoziale ma la spia di un'insolvenza latente e di probabili blocchi imminenti delle forniture: il
            ciclo passivo si allunga perché l'impresa non paga, non perché abbia ottenuto condizioni migliori.
          </p>
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="Il costo del finanziamento del ciclo"
          descrizione="Il buco monetario viene coperto sistematicamente con debito bancario a breve — scoperti, anticipi salvo buon fine. Quel debito impatta il conto economico attraverso gli oneri finanziari, la cui incidenza sul fatturato si scompone in due determinanti dai rimedi opposti."
          accento={BLUE}
        >
          <DeterminantiOneri
            incidenza={safeDiv(d?.ce?.oneriFinanziari, d?.ce?.ricavi)}
            rod={safeDiv(d?.ce?.oneriFinanziari, debitiFinanziariDi(d))}
            intensita={safeDiv(debitiFinanziariDi(d), d?.ce?.ricavi)}
          />
          <div className="mt-4">{griglia(IND_ONERI_FINANZIARI)}</div>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="Le aree monetarie della gestione · produzione, assorbimento, raccolta"
          descrizione="L'analisi dinamica dei flussi indaga la cassa realmente entrata e uscita nel periodo, sfruttando il Rendiconto Finanziario. Serve a misurare la capacità di autoprodurre liquidità, a individuare quali aree assorbono risorse e quali le producono, e a verificare la congruità delle fonti esterne mobilitate. È la lettura che le agenzie di rating preferiscono, perché immune dalle politiche di bilancio su ammortamenti e svalutazioni."
          accento={BLUE}
        >
          <CascataFlussi righe={righeFlussi} />
          <div className="mt-4">{griglia(IND_FLUSSI_LIQUIDITA)}</div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            I primi tre indici formano una scala: la moneta <em>potenzialmente</em> estraibile dalle vendite (EBITDA
            Margin), quella <em>effettivamente</em> estratta dopo il passaggio nel circolante (Cash Return on Sales), e
            infine quella che resta dopo aver rifinanziato la struttura (FCFO sui ricavi). I due indici successivi
            spiegano il divario fra i primi due: la qualità dell'autofinanziamento dice quanta parte è vincolata al
            rinnovo degli impianti, l'impatto del circolante quanta ne trattengono crediti e magazzino.
          </p>
          <div
            className="mt-3 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${BLUE}0D`, borderLeft: `3px solid ${BLUE}`, color: INK }}
          >
            Questa pagina si ferma alla <strong>produzione</strong> di moneta e alla sequenza delle aree. Dove quella
            moneta finisca — composizione del fabbisogno, copertura della struttura fra mantenimento e sviluppo, indici
            di coverage verso banche e soci — è il contenuto della pagina{" "}
            <strong>«3.2 · Assorbimento e servizio finanziario»</strong>.
          </div>
        </Blocco>

        {/* ── G ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="G"
          titolo="Sintesi · gli stock e i flussi a confronto"
          descrizione="Le due analisi rispondono a domande diverse: la statica chiede se i valori ci sono, la dinamica se arrivano al momento giusto. Solo il loro incrocio produce una diagnosi di liquidità difendibile."
          accento={BLUE}
        >
          <SintesiLiquidita
            ccnf={ccnf}
            liquiditaGenerale={liqGenerale}
            liquiditaPrimaria={liqPrimaria}
            ciclo={ciclo}
            flusso={flussoCorrente}
            gradoFin={gradoFin}
          />
        </Blocco>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-quinquies. COMPONENTI GRAFICI DELL'ASSORBIMENTO (Fase 3.2)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * FIG. 13.23 — La composizione dell'area di assorbimento.
 * Il fabbisogno dell'esercizio suddiviso fra struttura e fonti di
 * finanziamento, pesato percentualmente: è il peso relativo, non l'importo
 * assoluto, a rivelare gli squilibri che gli indici reddituali non vedono.
 */
function ComposizioneAssorbimento({
  voci,
  gruppi = [
    { id: "struttura", titolo: "Fabbisogno legato alla struttura", tinta: BLUE },
    { id: "fonti", titolo: "Fabbisogno legato alle fonti di finanziamento", tinta: PURPLE },
  ],
  etichettaTotale = "Fabbisogno finanziario dell'esercizio",
  testoVuoto = "Servono capex, servizio del debito e dividendi per comporre il fabbisogno dell'esercizio.",
}) {
  const totale = somma(...voci.map((v) => v.valore));
  /* Le percentuali si pesano sul MOVIMENTO LORDO, non sul saldo: quando una
     voce è in uscita (un rimborso fra le fonti raccolte) il saldo netto si
     comprime e le quote calcolate su di esso perderebbero significato. Con
     tutte le voci dello stesso segno le due basi coincidono. */
  const lordo = voci.reduce((acc, v) => acc + Math.abs(num(v.valore) || 0), 0);
  const segniMisti = isNum(totale) && Math.abs(Math.abs(totale) - lordo) > lordo * 0.001;
  if (!lordo) return <FiguraVuota testo={testoVuoto} />;

  const tintaDi = (id) => gruppi.find((g) => g.id === id)?.tinta || INK;
  const quota = (v) => safeDiv(isNum(v) ? Math.abs(v) : null, lordo);

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      {/* barra unica: la proporzione si legge prima dei numeri */}
      <div className="flex h-6 w-full overflow-hidden rounded-sm" style={{ border: `1px solid ${LINE}` }}>
        {voci.map((v, i) => {
          const q = quota(v.valore) || 0;
          const tinta = tintaDi(v.gruppo);
          return q > 0 ? (
            <div
              key={v.nome}
              title={`${v.nome}: ${fmt(v.valore)}`}
              style={{ width: `${q * 100}%`, backgroundColor: tinta, opacity: 1 - (i % 3) * 0.22 }}
            />
          ) : null;
        })}
      </div>

      {gruppi.map((g) => {
        const righe = voci.filter((v) => v.gruppo === g.id);
        const somGruppo = somma(...righe.map((r) => r.valore));
        return (
          <div key={g.id} className="mt-3">
            <div className="flex items-baseline justify-between gap-2">
              <Label color={`${g.tinta}C0`}>{g.titolo}</Label>
              <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                {fmt(somGruppo)} · {pct(quota(somGruppo), 0)}
              </span>
            </div>
            {righe.map((r) => (
              <div
                key={r.nome}
                className="flex items-baseline justify-between gap-3 py-1"
                style={{ borderTop: `1px solid ${LINE}` }}
              >
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  {r.nome}
                  <span className="ml-1 text-[10px] italic" style={{ color: `${INK}80` }}>
                    {r.nota}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(r.valore)} <span style={{ color: `${INK}80` }}>· {pct(quota(r.valore), 0)}</span>
                </span>
              </div>
            ))}
          </div>
        );
      })}

      <div className="mt-3 flex items-baseline justify-between" style={{ borderTop: `2px solid ${INK}20`, paddingTop: 6 }}>
        <Label color={`${INK}90`}>{etichettaTotale}</Label>
        <span className="text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {fmt(totale)}
        </span>
      </div>

      {segniMisti && (
        <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
          Alcune voci hanno segno opposto alle altre — tipicamente un rimborso fra le fonti raccolte. Il totale qui
          sopra è il <strong>saldo netto</strong>, mentre le percentuali sono calcolate sul movimento lordo di{" "}
          {fmt(lordo)}: pesare una voce su un saldo che altre voci comprimono darebbe quote prive di significato.
        </p>
      )}
    </div>
  );
}

/**
 * FIG. 13.24 — La copertura del fabbisogno.
 * Dal flusso operativo corrente partono due rami: verso la struttura misura
 * la capacità di sviluppo autonomo, verso i finanziatori il grado di
 * solvibilità. Sono domande diverse e vanno tenute separate.
 */
function BiforcazioneCopertura({ flusso, capex, servizio }) {
  const ramo = (titolo, sotto, fabbisogno, esito, tinta) => {
    const q = safeDiv(flusso, fabbisogno);
    const ok = isNum(q) && q >= 1;
    return (
      <div className="flex-1 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${tinta}55` }}>
        <Label color={`${tinta}C0`}>{titolo}</Label>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            {sotto}
          </span>
          <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {fmt(fabbisogno)}
          </span>
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: isNum(q) ? (ok ? GREEN : RED) : `${INK}70` }}>
          {mult(q)}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
          {esito}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${GREEN}55` }}>
        <Label color={`${GREEN}C0`}>Flusso operativo corrente · risorse prodotte</Label>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: isNum(flusso) && flusso > 0 ? GREEN : RED }}>
          {fmt(flusso)}
        </div>
      </div>
      <div className="my-2 text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▼ si biforca su due fabbisogni ▼
      </div>
      <div className="flex flex-wrap gap-2">
        {ramo("Fabbisogno della struttura", "Capex dell'esercizio", capex, "Capacità di sviluppo autonomo", BLUE)}
        {ramo("Servizio dei finanziamenti", "Oneri + rimborsi + dividendi", servizio, "Grado di solvibilità", PURPLE)}
      </div>
    </div>
  );
}

/**
 * FIG. 13.25 — La copertura del fabbisogno strutturale.
 * Il capex spaccato in mantenimento (indifferibile) e sviluppo
 * (discrezionale), con il flusso corrente riportato in scala: si vede subito
 * fin dove arriva la cassa prodotta.
 */
function CapexMandatoryDiscretionary({ mantenimento, sviluppo, flusso }) {
  const tot = somma(mantenimento, sviluppo);
  const scala = Math.max(Math.abs(num(tot) || 0), Math.abs(num(flusso) || 0));
  if (!scala) return <FiguraVuota testo="Serve il capex dell'esercizio per separare mantenimento e sviluppo." />;
  const larg = (v) => (isNum(v) ? (Math.abs(v) / scala) * 100 : 0);

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <Label color={`${INK}90`}>Capex dell'esercizio · mandatory contro discretionary</Label>
      <div className="mt-2 flex h-7 w-full overflow-hidden rounded-sm" style={{ border: `1px solid ${LINE}`, backgroundColor: `${INK}08` }}>
        <div
          className="flex items-center justify-center"
          style={{ width: `${larg(mantenimento)}%`, backgroundColor: `${RED}55` }}
        >
          {larg(mantenimento) > 22 && (
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
              mantenimento
            </span>
          )}
        </div>
        <div className="flex items-center justify-center" style={{ width: `${larg(sviluppo)}%`, backgroundColor: `${BLUE}44` }}>
          {larg(sviluppo) > 20 && (
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
              sviluppo
            </span>
          )}
        </div>
      </div>

      <div className="relative mt-1 h-6">
        <div className="absolute left-0 top-0 h-3 rounded-sm" style={{ width: `${larg(flusso)}%`, backgroundColor: `${GREEN}66` }} />
        <div className="absolute left-0 top-3 text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
          fin dove arriva il flusso operativo corrente
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {[
          { nome: "Capex di mantenimento", valore: mantenimento, nota: "indifferibile · mandatory", tinta: RED },
          { nome: "Capex di sviluppo", valore: sviluppo, nota: "discrezionale · discretionary", tinta: BLUE },
          { nome: "Flusso operativo corrente", valore: flusso, nota: "risorse prodotte", tinta: GREEN },
        ].map((r) => (
          <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${r.tinta}C0`}>{r.nome}</Label>
            <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {fmt(r.valore)}
            </div>
            <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
              {r.nota}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * FIG. 13.26 — L'albero del Free Cash Flow.
 * Il margine si scompone nei tre driver che lo determinano, ciascuno con le
 * proprie leve fisiche: è il ponte fra le dinamiche operative e le uscite
 * monetarie.
 */
function AlberoFreeCashFlow({ ebitda, deltaCcnc, capex, fcfEffettivo }) {
  const ricostruito =
    isNum(ebitda) && isNum(deltaCcnc) && isNum(capex) ? ebitda - deltaCcnc - Math.abs(capex) : null;
  const scarto = isNum(ricostruito) && isNum(fcfEffettivo) ? fcfEffettivo - ricostruito : null;

  const nodo = (titolo, valore, leve, tinta, segno) => (
    <div key={titolo} className="flex-1 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${tinta}55`, minWidth: 170 }}>
      <Label color={`${tinta}C0`}>
        {segno} {titolo}
      </Label>
      <div className="mt-1 text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {fmt(valore)}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        {leve}
      </p>
    </div>
  );

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap gap-2">
        {nodo("EBITDA", ebitda, "Vendite e Opex: mix, volumi, prezzi di vendita, prezzi d'acquisto, produttività interna.", GREEN, "＋")}
        {nodo("Δ CCNc", deltaCcnc, "Crediti verso clienti, scorte e debiti verso fornitori: le condizioni di incasso e pagamento.", AMBER, "−")}
        {nodo("Capex", isNum(capex) ? Math.abs(capex) : null, "Investimenti e disinvestimenti in struttura operativa.", BLUE, "−")}
      </div>
      <div className="my-2 text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▼
      </div>
      <div className="mx-auto max-w-md rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${INK}30` }}>
        <Label color={`${INK}90`}>Free Cash Flow from Operations · ricostruito</Label>
        <div
          className="mt-1 text-2xl font-bold tabular-nums"
          style={{ fontFamily: FONT_MONO, color: isNum(ricostruito) && ricostruito >= 0 ? GREEN : RED }}
        >
          {fmt(ricostruito)}
        </div>
        {isNum(fcfEffettivo) && (
          <div className="mt-1 text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
            FCFO da rendiconto {fmt(fcfEffettivo)} · scarto {segnato(scarto)}
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        Lo scarto fra ricostruzione e rendiconto non è un errore: raccoglie imposte pagate, gestione non corrente e
        rettifiche non monetarie che l'albero, per costruzione, non rappresenta. Quando diventa grande è però il segnale
        che la cassa si perde in un'area che l'albero non sorveglia, e va indagato.
      </p>
    </div>
  );
}

/**
 * FIG. 13.27 — Free cash flow e ciclo di vita.
 * Un FCF negativo non è un verdetto: cambia significato con la fase. La
 * curva mostra l'andamento fisiologico e segnala dove si colloca l'impresa.
 */
function CicloVitaFcf({ fase }) {
  const W = 680;
  const H = 210;
  const L = 40;
  const R = 20;
  const yZero = 132;
  const banda = (W - L - R) / 4;
  const fasi = [
    { id: "introduzione", nome: "Introduzione" },
    { id: "sviluppo", nome: "Sviluppo" },
    { id: "maturita", nome: "Maturità" },
    { id: "declino", nome: "Declino" },
  ];
  /* La fase «allarme» non ha una banda propria: è una maturità con il segno
     sbagliato, e si evidenzia sulla banda della maturità. */
  const attiva = fase?.id === "allarme" || fase?.id === "espansione" ? "maturita" : fase?.id;

  const punti = [
    [L, 150],
    [L + banda * 0.5, 176],
    [L + banda * 1.1, 158],
    [L + banda * 1.8, 126],
    [L + banda * 2.4, 52],
    [L + banda * 2.9, 46],
    [L + banda * 3.3, 86],
    [W - R, 168],
  ];
  /* Catmull-Rom convertita in Bézier: una curva morbida senza librerie. */
  const percorso = punti
    .map((p, i, a) => {
      if (i === 0) return `M ${p[0]} ${p[1]}`;
      const p0 = a[i - 2] || a[i - 1];
      const p1 = a[i - 1];
      const p2 = p;
      const p3 = a[i + 1] || p;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      return `C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
    })
    .join(" ");

  return (
    <div className="rounded-md p-2" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Free cash flow e ciclo di vita">
        {fasi.map((f, i) => (
          <g key={f.id}>
            <rect
              x={L + banda * i}
              y={18}
              width={banda}
              height={H - 18 - 34}
              fill={attiva === f.id ? `${BLUE}12` : "transparent"}
              stroke={`${INK}12`}
            />
            <text
              x={L + banda * i + banda / 2}
              y={H - 18}
              textAnchor="middle"
              style={{
                fontFamily: FONT_HEAD,
                fontSize: 10,
                fontWeight: attiva === f.id ? 800 : 500,
                fill: attiva === f.id ? INK : `${INK}80`,
                letterSpacing: "0.08em",
              }}
            >
              {f.nome.toUpperCase()}
            </text>
          </g>
        ))}

        <line x1={L} y1={yZero} x2={W - R} y2={yZero} stroke={`${INK}60`} strokeWidth="1" strokeDasharray="4 3" />
        <text x={L - 6} y={yZero + 3} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}80` }}>
          0
        </text>
        <text
          x={L - 6}
          y={54}
          textAnchor="end"
          style={{ fontFamily: FONT_HEAD, fontSize: 8, fill: `${INK}70`, letterSpacing: "0.08em" }}
        >
          FCF
        </text>

        <path d={percorso} fill="none" stroke={BLUE} strokeWidth="2.5" />
      </svg>
      {fase && (
        <div className="px-1 pb-1">
          <Badge level={fase.level}>Fase dedotta: {fase.nome}</Badge>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            {fase.testo}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * FIG. 13.28 — Scelte di portafoglio e flussi di cassa.
 * La stessa matrice BCG della Fase 2.1, letta però in chiave monetaria: chi
 * produce il surplus e chi lo consuma.
 */
function PortafoglioFlussi({ asa = [] }) {
  const attesi = {
    star: { flusso: "Negativi o nulli · forte assorbimento", nota: "difendere la leadership in un mercato in corsa costa quanto conquistarla", colore: GREEN },
    question: { flusso: "Negativi · assorbimento", nota: "richiede investimenti massicci per diventare Star, o va dismessa", colore: AMBER },
    cow: { flusso: "Fortemente positivi · produzione", nota: "genera il surplus che finanzia il resto del portafoglio", colore: BLUE },
    dog: { flusso: "Negativi o esigui", nota: "candidata alla dismissione, che a sua volta libera cassa una tantum", colore: RED },
  };

  const righe = asa
    .map((a) => {
      const cls = classeBcg(num(a.quotaRelativa), isNum(num(a.crescitaMercato)) ? num(a.crescitaMercato) / 100 : null);
      return cls ? { nome: a.nome || "—", ricavi: num(a.ricavi), cls, atteso: attesi[cls.id] } : null;
    })
    .filter(Boolean);

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["cow", "Cash cow"],
          ["star", "Star"],
          ["question", "Question mark"],
          ["dog", "Dog"],
        ].map(([id, nome]) => (
          <div key={id} className="rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${attesi[id].colore}55` }}>
            <Label color={`${attesi[id].colore}C0`}>{nome}</Label>
            <div className="mt-0.5 text-[11px] font-bold" style={{ fontFamily: FONT_BODY, color: INK }}>
              {attesi[id].flusso}
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
              {attesi[id].nota}
            </p>
          </div>
        ))}
      </div>

      {righe.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr>
                {["Area strategica d'affari", "Ricavi", "Classe", "Comportamento monetario atteso"].map((h) => (
                  <th key={h} className="py-1 px-2 text-left">
                    <Label color={`${INK}80`}>{h}</Label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.nome} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-1.5 px-2 text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                    {r.nome}
                  </td>
                  <td className="py-1.5 px-2 text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {fmt(r.ricavi)}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className="text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: r.cls.colore }}>
                      {r.cls.nome}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                    {r.atteso.flusso}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
          Compilando la tabella delle aree strategiche d'affari nella pagina «2.1 · Determinanti del ROI» — con quota di
          mercato relativa e crescita del mercato — ogni ASA viene classificata e affiancata al comportamento monetario
          che le è proprio, così da verificare se il portafoglio sia finanziariamente equilibrato.
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-sexies. PAGINA 3.2 — ASSORBIMENTO DI MONETA E SERVIZIO FINANZIARIO
   ═══════════════════════════════════════════════════════════════════════════ */

function PaginaAssorbimento({ dataset, anni, coppia, onCoppia, onVaiAiDati, par, asa = [] }) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "L'analisi dell'assorbimento confronta fabbisogni e coperture fra due esercizi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: il Rendiconto Finanziario è qui la fonte principale."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;
  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    return { anno: a, annoPrecedente: ap, prec: ap != null ? dataset[ap] : null, par };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  const capex = capexTotaleDi(d);
  const oneri = oneriDi(d);
  const quote = quoteCapitaleDi(d, ctx);
  const dividendi = dividendiPagatiDi(d, ctx);
  const servizio = servizioFinanziatoriDi(d, ctx);
  const fabbisogno = fabbisognoTotaleDi(d, ctx);
  const flusso = flussoCorrenteDi(d);
  const mantenimento = capexMantenimentoDi(d, ctx);
  const sviluppo = capexSviluppoDi(d, ctx);
  const deltaCcnc = isNum(d?.sp?.ccno) && isNum(ctx?.prec?.sp?.ccno) ? d.sp.ccno - ctx.prec.sp.ccno : null;
  const fase = faseCicloVita(d, ctx);

  const vociAssorbimento = [
    { nome: "Capex", nota: "investimenti netti in struttura", valore: capex, gruppo: "struttura" },
    { nome: "Oneri finanziari", nota: "costo del debito", valore: oneri, gruppo: "fonti" },
    { nome: "Quote capitale di debito", nota: "rimborsi dell'esercizio", valore: quote, gruppo: "fonti" },
    { nome: "Dividendi e azioni proprie", nota: "esborsi verso i soci", valore: dividendi, gruppo: "fonti" },
  ];

  /* Diagnosi strutturale: il caso patologico che gli indici reddituali non
     vedono è la crescita finanziata dal passato — poco capex, molto debito. */
  const pesoStruttura = safeDiv(capex, fabbisogno);
  const pesoFonti = safeDiv(servizio, fabbisogno);
  const crescita = crescitaRicaviDi(d, ctx);
  const diagnosi =
    !isNum(pesoStruttura) || !isNum(pesoFonti)
      ? null
      : pesoStruttura < 0.3 && isNum(crescita) && crescita > 0.05
      ? {
          level: "bad",
          nome: "Squilibrio patologico",
          testo: `I ricavi crescono del ${pct(crescita)} ma solo il ${pct(pesoStruttura, 0)} del fabbisogno va alla struttura, mentre il ${pct(pesoFonti, 0)} serve i finanziatori. L'impresa non sta finanziando la crescita: sta pagando il passato. È lo squilibrio che gli indici reddituali non intercettano, perché il conto economico può restare in utile mentre accade.`,
        }
      : pesoStruttura < 0.3
      ? {
          level: "warn",
          nome: "Fabbisogno dominato dal servizio delle fonti",
          testo: `Il ${pct(pesoFonti, 0)} del fabbisogno è assorbito da oneri, rimborsi e dividendi, contro il ${pct(pesoStruttura, 0)} destinato alla struttura. In una fase matura può essere fisiologico; se la struttura non viene rinnovata a sufficienza, però, il vantaggio competitivo si consuma silenziosamente.`,
        }
      : pesoStruttura > 0.7
      ? {
          level: "info",
          nome: "Fabbisogno dominato dagli investimenti",
          testo: `Il ${pct(pesoStruttura, 0)} del fabbisogno va alla struttura produttiva: l'impresa sta investendo su sé stessa. La domanda successiva, cui risponde il blocco C, è se quegli investimenti siano di mantenimento o di sviluppo.`,
        }
      : {
          level: "ok",
          nome: "Composizione equilibrata",
          testo: `Struttura (${pct(pesoStruttura, 0)}) e servizio delle fonti (${pct(pesoFonti, 0)}) si dividono il fabbisogno senza che nessuna delle due aree lo monopolizzi.`,
        };

  return (
    <SectionCard
      titolo="Assorbimento di moneta e servizio finanziario"
      eyebrow="Solvibilità · dove finisce la cassa prodotta"
      accento={BLUE}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={BLUE} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="La composizione dell'area di assorbimento"
          descrizione="La moneta prodotta dalla gestione corrente è fisiologicamente destinata a essere consumata dalle altre aree: la struttura operativa, attraverso gli investimenti, e la gestione finanziaria passiva, attraverso oneri, rimborsi e dividendi. Il primo passo è mappare il fabbisogno complessivo e pesarne le componenti: è il peso relativo, non l'importo assoluto, a rivelare la natura del problema."
          accento={BLUE}
        >
          <ComposizioneAssorbimento voci={vociAssorbimento} />
          {diagnosi && (
            <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LEVEL_COLOR[diagnosi.level]}55` }}>
              <Label color={`${INK}90`}>Diagnosi strutturale · {coppia?.corrente}</Label>
              <div className="mt-2">
                <Badge level={diagnosi.level}>{diagnosi.nome}</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}D0` }}>
                {diagnosi.testo}
              </p>
            </div>
          )}
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="La copertura del fabbisogno · le due domande"
          descrizione="Valutata l'efficienza nella produzione di cassa, se ne valuta la sufficienza. Il flusso operativo corrente si biforca su due fabbisogni che rispondono a domande diverse: verso la struttura misura la capacità di sviluppo autonomo, verso i finanziatori il grado di solvibilità. Confonderle porta a diagnosi sbagliate, perché la prima ammette eccezioni strategiche e la seconda no."
          accento={BLUE}
        >
          <BiforcazioneCopertura flusso={flusso} capex={capex} servizio={servizio} />
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="Il servizio della struttura produttiva"
          descrizione="Il capex non va trattato come un blocco monolitico: la quota di mantenimento è un fabbisogno inderogabile e il flusso operativo deve coprirla, la quota di sviluppo è discrezionale e può legittimamente ricorrere a finanza esterna. La distinzione cambia il verdetto su un identico indice di copertura."
          accento={BLUE}
        >
          <CapexMandatoryDiscretionary mantenimento={mantenimento} sviluppo={sviluppo} flusso={flusso} />
          <div className="mt-4">{griglia(IND_COPERTURA_STRUTTURA)}</div>
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="L'albero del Free Cash Flow e il rendimento monetario"
          descrizione="Il free cash flow è l'apice di un modello ad albero che disgrega le macro-variabili finanziarie fino ai driver operativi elementari — prezzi di vendita, consumi, condizioni di credito — collegando le dinamiche fisiche alle uscite monetarie. Rapportato ai ricavi e al capitale investito genera le due misure di rendimento monetario netto."
          accento={BLUE}
        >
          <AlberoFreeCashFlow ebitda={d?.ce?.ebitda} deltaCcnc={deltaCcnc} capex={capex} fcfEffettivo={d?.rf?.fcfo} />
          <div className="mt-4">{griglia(IND_RENDIMENTO_MONETARIO)}</div>
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="Free cash flow e ciclo di vita · il segno non basta"
          descrizione="Interpretare un free cash flow negativo come un segnale univocamente drammatico è un errore: il suo significato dipende dalla fase attraversata dall'area strategica d'affari. Negativo in introduzione e in sviluppo è fisiologico; negativo in maturità è un allarme strategico grave."
          accento={BLUE}
        >
          <CicloVitaFcf fase={fase} />
          <div className="mt-4">
            <Label color={`${INK}90`}>Scelte di portafoglio e flussi di cassa</Label>
            <p className="mt-1 mb-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Un portafoglio sano è finanziariamente equilibrato: possiede abbastanza aree mature da generare il surplus
              che finanzia l'assorbimento delle aree emergenti, garantendo un ciclo inter-generazionale autonomo. Senza
              cash cow, le star e le question mark si finanziano solo con debito o con nuovo capitale.
            </p>
            <PortafoglioFlussi asa={asa} />
          </div>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="Il servizio del debito · gli indici di coverage"
          descrizione="La seconda macro-area di assorbimento guarda all'esterno, verso banche e obbligazionisti. Sono le metriche che le agenzie di rating usano come pilastro dell'affidabilità creditizia: tutte devono superare l'unità, perché sotto quella soglia l'impresa si indebita per pagare debiti pregressi — lo schema tipico del tracollo."
          accento={BLUE}
        >
          {griglia(IND_SERVIZIO_DEBITO)}
          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${AMBER}0F`, borderLeft: `3px solid ${AMBER}`, color: INK }}
          >
            <strong>Nota tecnica sul numeratore.</strong> L'EBITDA è un'approssimazione contabile lorda, comoda per il
            confronto fra imprese ma imprecisa: la quota capitale di un mutuo non è fiscalmente deducibile e si paga solo
            con cassa netta reale. Dove il Rendiconto Finanziario è disponibile — e in questa applicazione lo è — il
            flusso operativo corrente è il numeratore da preferire, e la card lo espone accanto all'EBITDA per rendere
            visibile la differenza fra le due letture.
          </div>
        </Blocco>

        {/* ── G ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="G"
          titolo="Il servizio dell'equity · la remunerazione dei soci"
          descrizione="Soddisfatto il debito, che ha priorità giuridica e finanziaria assoluta, la cassa residua è a disposizione degli azionisti. Qui la domanda non è se l'impresa possa pagare, ma se stia pagando con la cassa che ha prodotto o con quella che ha preso a prestito."
          accento={BLUE}
        >
          {griglia(IND_SERVIZIO_EQUITY)}
        </Blocco>

        {/* ── H ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="H"
          titolo="La gestione degli investimenti finanziari · produzione o assorbimento?"
          descrizione="L'area finanziaria attiva — partecipazioni, titoli, prestiti infragruppo — può figurare nel rendiconto su entrambi i lati, e la sua natura non si legge dall'importo ma dal contesto strategico."
          accento={BLUE}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${RED}C0`}>Assorbimento · acquisto di asset finanziari</Label>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                Va valutato contestualmente. Un'impresa priva di cassa che compra titoli azionari a breve sta compiendo
                un'operazione distruttiva; la stessa uscita, se serve ad acquisire una partecipazione che integra a monte
                un fornitore chiave, ha natura strategica ed è del tutto assimilabile al capex di sviluppo.
              </p>
              <div className="mt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  Investimenti finanziari in essere
                </span>
                <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(d?.sp?.investimentiFinanziari)}
                </span>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  Variazione sull'esercizio precedente
                </span>
                <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {isNum(d?.sp?.investimentiFinanziari) && isNum(ctx?.prec?.sp?.investimentiFinanziari)
                    ? segnato(d.sp.investimentiFinanziari - ctx.prec.sp.investimentiFinanziari)
                    : "n.d."}
                </span>
              </div>
            </div>

            <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
              <Label color={`${GREEN}C0`}>Produzione · realizzi, dividendi e cedole</Label>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                Gli incassi da vendita di titoli sono per natura occasionali; le cedole e i dividendi da partecipazioni
                strategiche consolidate sono invece ricorrenti, e nella prassi IAS/IFRS andrebbero integrati a pieno
                titolo nel flusso operativo corrente anziché tenuti in un'area separata.
              </p>
              <div className="mt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  Proventi della gestione finanziaria attiva
                </span>
                <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(d?.ce?.proventiFinanziari)}
                </span>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  Incidenza sul flusso operativo corrente
                </span>
                <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {pct(safeDiv(d?.ce?.proventiFinanziari, flusso))}
                </span>
              </div>
            </div>
          </div>

          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${BLUE}0D`, borderLeft: `3px solid ${BLUE}`, color: INK }}
          >
            <strong>Il perimetro della «risorsa».</strong> Il segno di queste operazioni dipende da come il rendiconto
            definisce la risorsa di riferimento. Se l'analisi è centrata sulla <strong>cassa</strong>, l'acquisto di
            titoli a brevissimo termine è un assorbimento, cioè un investimento. Se è centrata sulla{" "}
            <strong>posizione finanziaria netta</strong> — lo schema adottato dai moduli a monte di questa applicazione —
            quei titoli sono già inglobati nella liquidità: la loro compravendita è una transazione endogena e non
            modifica il saldo complessivo mostrato dal Rendiconto. Prima di giudicare un flusso finanziario, va verificato
            quale dei due perimetri si sta guardando.
          </div>
        </Blocco>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-septies. COMPONENTI GRAFICI DELLA RACCOLTA E DEL COSTO DEL CAPITALE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * FIG. 13.31 — Composizione per natura del fabbisogno.
 * A confronto la natura di ciò che è stato assorbito e la natura di ciò che è
 * stato raccolto: la congruenza temporale fra le due colonne è il criterio
 * del giudizio, non il livello assoluto dell'una o dell'altra.
 */
function NaturaFabbisogno({ funzionamento, strutturale, durevoli, breve }) {
  const totF = somma(funzionamento, strutturale);
  const totR = somma(durevoli, breve);
  const scala = Math.max(Math.abs(num(totF) || 0), Math.abs(num(totR) || 0));
  if (!scala) return <FiguraVuota testo="Servono due esercizi consecutivi per confrontare fabbisogni e fonti dell'anno." />;

  const colonna = (titolo, righe, totale) => (
    <div>
      <Label color={`${INK}90`}>{titolo}</Label>
      <div className="mt-2 space-y-2">
        {righe.map((r) => {
          const largh = isNum(r.valore) ? Math.min(Math.abs(r.valore) / scala, 1) * 100 : 0;
          return (
            <div key={r.nome}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                  {r.nome}
                  <span className="ml-1 text-[10px] italic" style={{ color: `${INK}80` }}>
                    {r.nota}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(r.valore)}
                </span>
              </div>
              <div className="mt-0.5 h-3 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
                <div className="h-3 rounded-sm" style={{ width: `${largh}%`, backgroundColor: r.tinta }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
        <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
          Totale
        </span>
        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {fmt(totale)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="grid gap-5 sm:grid-cols-2">
        {colonna(
          "Natura del fabbisogno manifestatosi",
          [
            { nome: "Fabbisogno di funzionamento", nota: "espansione del CCNc, dividendi", valore: funzionamento, tinta: AMBER },
            { nome: "Fabbisogno strutturale", nota: "capex, espansioni durevoli", valore: strutturale, tinta: BLUE },
          ],
          totF
        )}
        {colonna(
          "Natura delle fonti raccolte",
          [
            { nome: "Fonti durevoli", nota: "equity e debito a medio-lungo", valore: durevoli, tinta: PURPLE },
            { nome: "Fonti a breve", nota: "variazione della PFN corrente", valore: breve, tinta: `${PURPLE}` },
          ],
          totR
        )}
      </div>
    </div>
  );
}

/**
 * FIG. 13.32 / 13.39 — Solvibilità e determinanti del valore.
 * La formula dell'attualizzazione al centro, i flussi sopra e il costo del
 * capitale sotto, con i tre rischi che lo determinano.
 */
function MappaValore({ flusso, wacc, rischi }) {
  return (
    <div className="rounded-md p-4" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${GREEN}55` }}>
        <Label color={`${GREEN}C0`}>Flussi di cassa attesi</Label>
        <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {fmt(flusso)}
        </div>
      </div>
      <div className="my-1 text-center text-[11px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▼
      </div>
      <div
        className="mx-auto max-w-md rounded-md p-3 text-center"
        style={{ backgroundColor: CARD, border: `2px solid ${INK}30` }}
      >
        <Label color={`${INK}90`}>Valore fondamentale</Label>
        <div className="mt-1 text-sm font-bold" style={{ fontFamily: FONT_MONO, color: INK }}>
          W = Σ Flusso<sub>t</sub> ÷ (1 + WACC)<sup>t</sup>
        </div>
      </div>
      <div className="my-1 text-center text-[11px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▲
      </div>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${PURPLE}55` }}>
        <Label color={`${PURPLE}C0`}>Costo del capitale · WACC</Label>
        <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pct(wacc)}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {rischi.map((r) => (
          <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}80`}>{r.nome}</Label>
            <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {r.valore}
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
              {r.nota}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Composizione del WACC: quanto pesa ciascuna fonte e quanto costa. */
function WaccComposizione({ kdNetto, ke, pesoD, wacc }) {
  if (!isNum(wacc) || !isNum(pesoD))
    return <FiguraVuota testo="Compila i parametri CAPM e l'aliquota fiscale per ricostruire il WACC dai suoi componenti." />;
  const contributoD = isNum(kdNetto) ? kdNetto * pesoD : 0;
  const contributoE = isNum(ke) ? ke * (1 - pesoD) : 0;
  const tot = contributoD + contributoE || 1;

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex h-7 w-full overflow-hidden rounded-sm" style={{ border: `1px solid ${LINE}` }}>
        <div className="flex items-center justify-center" style={{ width: `${(contributoD / tot) * 100}%`, backgroundColor: `${PURPLE}55` }}>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
            debito
          </span>
        </div>
        <div className="flex items-center justify-center" style={{ width: `${(contributoE / tot) * 100}%`, backgroundColor: `${BLUE}44` }}>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
            equity
          </span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          { nome: "Contributo del debito", valore: pct(contributoD), nota: `Kd netto ${pct(kdNetto)} × peso ${pct(pesoD, 0)}` },
          { nome: "Contributo dell'equity", valore: pct(contributoE), nota: `Ke ${pct(ke)} × peso ${pct(1 - pesoD, 0)}` },
          { nome: "WACC", valore: pct(wacc), nota: "costo medio ponderato del capitale" },
        ].map((r) => (
          <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}80`}>{r.nome}</Label>
            <div className="mt-0.5 text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {r.valore}
            </div>
            <div className="text-[10px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
              {r.nota}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * FIG. 13.33 / 13.34 — Scale di rating e valori mediani degli indici.
 * La riga dell'impresa è evidenziata: dalla copertura degli interessi si
 * legge la classe e, da questa, lo spread da sommare al risk-free.
 */
function RatingSintetico({ cover, debtEbitda, rf }) {
  const classe = classeRatingDi(cover);
  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              {["Classe", "Grado", "EBIT interest cover", "Debt/EBITDA mediano", "Spread indicativo"].map((h) => (
                <th key={h} className="py-1 px-2 text-left">
                  <Label color={`${INK}80`}>{h}</Label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCALA_RATING.map((r, i) => {
              const attiva = classe?.classe === r.classe;
              const sup = i === 0 ? "≥ 8,5" : `${fmt(r.da, 2)} – ${fmt(SCALA_RATING[i - 1].da, 2)}`;
              return (
                <tr
                  key={r.classe}
                  style={{ borderTop: `1px solid ${LINE}`, backgroundColor: attiva ? `${BLUE}12` : "transparent" }}
                >
                  <td className="py-1.5 px-2">
                    <span
                      className="text-[11px]"
                      style={{ fontFamily: FONT_HEAD, color: INK, fontWeight: attiva ? 800 : 500 }}
                    >
                      {attiva ? "◀ " : ""}
                      {r.classe}
                    </span>
                  </td>
                  <td className="py-1.5 px-2">
                    <span
                      className="text-[10px] uppercase tracking-widest"
                      style={{ fontFamily: FONT_HEAD, color: r.grado === "investment" ? GREEN : AMBER }}
                    >
                      {r.grado === "investment" ? "investment" : "speculative"}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}C0` }}>
                    {i === SCALA_RATING.length - 1 ? "< 0,65" : sup}
                  </td>
                  <td className="py-1.5 px-2 text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}C0` }}>
                    {r.debtEbitda}
                  </td>
                  <td className="py-1.5 px-2 text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {pct(r.spread, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {[
          { nome: "EBIT interest cover", valore: mult(cover) },
          { nome: "Debt / EBITDA", valore: mult(debtEbitda) },
          { nome: "Classe sintetica", valore: classe?.classe ?? "n.d." },
          {
            nome: "Kd implicito = Rf + spread",
            valore: isNum(rf) && classe ? pct(rf + classe.spread) : "n.d.",
          },
        ].map((r) => (
          <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}80`}>{r.nome}</Label>
            <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {r.valore}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        Il limite dell'impostazione qualitativa è la discrezionalità: l'analista deve forzare la classificazione mediando
        fra indici che spesso danno segnali contrastanti — una copertura da BBB con un Debt/EBITDA da BB non è un caso
        raro. La tabella accorpa le classi principali e riporta spread e mediane come ordini di grandezza didattici, non
        come quotazioni correnti.
      </p>
    </div>
  );
}

/**
 * Modelli quantitativi: contributi dei singoli termini allo scoring, così che
 * si veda quale variabile sta spingendo la probabilità di default.
 */
function ScoringDefault({ logit, z }) {
  if (!logit && !z) return <FiguraVuota testo="Servono totale attivo, ricavi e i principali margini per calcolare gli scoring." />;

  const barre = logit ? logit.termini : [];
  const maxContributo = barre.length ? Math.max(...barre.map((t) => Math.abs(t.contributo)), Math.abs(logit.intercetta)) : 1;
  const classe = logit ? classeDaPd(logit.pd) : null;
  const zona = z ? zonaZScore(z.z) : null;

  const riga = (nome, contributo, tinta) => (
    <div key={nome} className="flex items-center gap-2">
      <div className="w-56 shrink-0 text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
        {nome}
      </div>
      <div className="relative h-3.5 flex-1 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
        <div
          className="absolute h-3.5 rounded-sm"
          style={{
            left: contributo >= 0 ? "50%" : `${50 - (Math.abs(contributo) / maxContributo) * 50}%`,
            width: `${(Math.abs(contributo) / maxContributo) * 50}%`,
            backgroundColor: tinta,
          }}
        />
        <div className="absolute h-3.5" style={{ left: "50%", width: 1, backgroundColor: `${INK}40` }} />
      </div>
      <div className="w-20 shrink-0 text-right text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {isNum(contributo) ? fmt(contributo, 2) : "n.d."}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {logit && (
        <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
          <Label color={`${INK}90`}>Modello Logit · contributi allo scoring</Label>
          <p className="mt-1 mb-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
            A destra della linea i termini che aumentano la probabilità di default, a sinistra quelli che la riducono.
          </p>
          <div className="space-y-1.5">
            {riga("Intercetta α", logit.intercetta, `${INK}60`)}
            {barre.map((t) => riga(t.nome, t.contributo, t.contributo >= 0 ? RED : GREEN))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { nome: "Scoring", valore: fmt(logit.scoring, 3) },
              { nome: "Probabilità di default (18 mesi)", valore: pct(logit.pd, 2) },
              { nome: "Classe indicativa", valore: classe?.classe ?? "n.d." },
            ].map((r) => (
              <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
                <Label color={`${INK}80`}>{r.nome}</Label>
                <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {r.valore}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {z && (
        <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label color={`${INK}90`}>Z-Score di Altman · termini ponderati</Label>
            {zona && <Badge level={zona.level}>{zona.nome}</Badge>}
          </div>
          <table className="mt-2 w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {z.termini.map((t) => (
                <tr key={t.k} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-1 pr-2 text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                    <span style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>{t.k}</span> · {t.nome}
                  </td>
                  <td className="py-1 px-2 text-right text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}90` }}>
                    × {t.peso}
                  </td>
                  <td className="py-1 pl-2 text-right text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {isNum(t.valore) ? fmt(t.peso * t.valore, 3) : "n.d."}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${INK}20` }}>
                <td className="py-1 pr-2 text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
                  Z′
                </td>
                <td />
                <td className="py-1 pl-2 text-right text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {fmt(z.z, 2)}
                </td>
              </tr>
            </tbody>
          </table>
          {z.mancanti.length > 0 && (
            <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: AMBER }}>
              Termini non calcolabili con i dati disponibili: {z.mancanti.join(", ")}. Il punteggio è la somma dei soli
              termini valorizzati e va letto come indicativo — le riserve di utili (X2) si indicano nei parametri per
              esercizio.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * FIG. 13.37 / 13.38 — Beta levered, unlevered e re-levered.
 * La cascata che porta dal beta medio di settore al beta calibrato sull'esatto
 * D/E dell'impresa, e da questo al costo dell'equity.
 */
function BetaRelevering({ betaLSettore, deSettore, tSettore, betaU, de, t, betaRel, rf, erp, ke }) {
  const passi = [
    {
      n: 1,
      nome: "Beta levered di settore",
      valore: isNum(betaLSettore) ? fmt(betaLSettore, 3) : "n.d.",
      nota: "media delle imprese del comparto: contiene sia il rischio operativo sia la leva media di settore",
    },
    {
      n: 2,
      nome: "Beta unlevered di settore",
      valore: isNum(betaU) ? fmt(betaU, 3) : "n.d.",
      nota: `βu = βl ÷ [1 + (1 − t) × D/E settore] · D/E ${isNum(deSettore) ? fmt(deSettore, 2) : "n.d."}, t ${pct(tSettore, 0)} — resta il solo rischio di mercato e operativo`,
    },
    {
      n: 3,
      nome: "Beta re-levered dell'impresa",
      valore: isNum(betaRel) ? fmt(betaRel, 3) : "n.d.",
      nota: `βl = βu × [1 + (1 − t) × D/E impresa] · D/E ${isNum(de) ? fmt(de, 2) : "n.d."}, t ${pct(t, 0)} — vi si inietta il rischio finanziario scelto dai vertici`,
    },
    {
      n: 4,
      nome: "Costo dell'equity",
      valore: pct(ke),
      nota: `Ke = Rf ${pct(rf)} + βl × ERP ${pct(erp)}`,
    },
  ];

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="space-y-2">
        {passi.map((p) => (
          <div key={p.n} className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ fontFamily: FONT_MONO, backgroundColor: `${BLUE}22`, color: BLUE }}
            >
              {p.n}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
                  {p.nome}
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                  {p.valore}
                </span>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
                {p.nota}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-octies. PAGINA 3.3 — RACCOLTA, RISCHIO FINANZIARIO E COSTO DEL CAPITALE
   ═══════════════════════════════════════════════════════════════════════════ */

function PaginaRaccolta({ dataset, anni, coppia, onCoppia, onVaiAiDati, par }) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "La raccolta si misura per differenza fra due stati patrimoniali consecutivi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;
  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    return { anno: a, annoPrecedente: ap, prec: ap != null ? dataset[ap] : null, par };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  /* ── Grandezze della pagina ─────────────────────────────────────────────── */
  const aumenti = aumentiCapitaleDi(d, ctx);
  const nuoviMl = nuoviDebitiMlDi(d, ctx);
  const varBreve = variazionePfnBreveDi(d, ctx);
  const durevoli = fontiDurevoliNuoveDi(d, ctx);
  const raccolta = raccoltaTotaleDi(d, ctx);
  const interne = fonteInternaDi(d, ctx);
  const funzionamento = fabbisognoFunzionamentoDi(d, ctx);
  const strutturale = fabbisognoStrutturaleDi(d);

  const p = capmDi(ctx);
  const aliquota = aliquotaDi(ctx);
  const betaU = betaUnleveredSettoreDi(ctx);
  const de = deDi(d, ctx);
  const betaRel = betaRelevatoDi(d, ctx);
  const ke = keDi(d, ctx);
  const kdNetto = kdNettoDi(d, ctx);
  const pesoD = pesoDebitoDi(d, ctx);
  const wacc = waccRicostruitoDi(d, ctx);
  const cover = ebitCoverDi(d);
  const logit = logitPmiDi(d, ctx);
  const z = zScoreDi(d, ctx);

  const vociRaccolta = [
    { nome: "Aumenti di capitale di rischio", nota: "conferimenti dei soci", valore: aumenti, gruppo: "durevoli" },
    { nome: "Nuovi debiti a medio-lungo termine", nota: "accensioni al netto dei rimborsi", valore: nuoviMl, gruppo: "durevoli" },
    { nome: "Variazione della PFN a breve", nota: "affidamenti e liquidità", valore: varBreve, gruppo: "breve" },
  ];

  /* Il quadro complessivo somma FONTI: le componenti in rimborso sono impieghi
     di risorse, non fonti, e comparirebbero qui con il segno sbagliato. */
  const soloEntrata = (v) => (isNum(v) ? Math.max(v, 0) : null);
  const nuoviDebitiEntrata =
    isNum(nuoviMl) || isNum(varBreve) ? (soloEntrata(nuoviMl) || 0) + (soloEntrata(varBreve) || 0) : null;
  const rimborsi = rimborsiNettiDi(d, ctx);

  const vociQuadro = [
    { nome: "Autofinanziamento netto", nota: "utile più componenti non monetarie", valore: autofinanziamentoNettoDi(d), gruppo: "interne" },
    { nome: "Disinvestimenti di struttura", nota: "realizzi da alienazione di asset", valore: disinvestimentiDi(d, ctx), gruppo: "interne" },
    { nome: "Aumenti di capitale", nota: "mercato dell'equity", valore: soloEntrata(aumenti), gruppo: "esterne" },
    { nome: "Nuovi debiti finanziari", nota: "mercato del credito, m/l e breve", valore: nuoviDebitiEntrata, gruppo: "esterne" },
  ];

  /* Congruenza temporale: il caso da non condannare in automatico è la
     raccolta durevole a fronte di fabbisogni correnti, quando serve a
     correggere una pregressa esposizione a breve. */
  const congruenza =
    !isNum(durevoli) || !isNum(strutturale)
      ? null
      : durevoli >= strutturale && isNum(varBreve) && varBreve <= 0
      ? {
          level: "ok",
          nome: "Fonti coerenti con la natura del fabbisogno",
          testo:
            "Le fonti durevoli coprono il fabbisogno strutturale e l'esposizione a breve non è cresciuta: la regola di congruenza temporale — impieghi durevoli finanziati da fonti durevoli — è rispettata.",
        }
      : durevoli >= somma(strutturale, funzionamento)
      ? {
          level: "info",
          nome: "Raccolta durevole eccedente il fabbisogno strutturale",
          testo:
            "Le fonti durevoli superano il fabbisogno di struttura e coprono anche parte di quello corrente. Isolata, sarebbe un'anomalia; ma trova piena giustificazione strategica se l'impresa sta correggendo una pregressa e pericolosa esposizione debitoria a breve termine — è il raccordo obbligato fra questa analisi dinamica e la fotografia statica della Fase 3.1.",
        }
      : isNum(varBreve) && varBreve > 0 && isNum(strutturale) && strutturale > 0 && durevoli < strutturale
      ? {
          level: "bad",
          nome: "Fabbisogno strutturale finanziato a breve",
          testo:
            "Le fonti durevoli non bastano a coprire gli investimenti in struttura e la differenza è stata presa a breve: è l'errore di copertura più grave, perché fonti revocabili sostengono impieghi che non si smobilizzano. Va letto insieme al grado di finanziamento bancario del circolante della Fase 3.1.",
        }
      : {
          level: "warn",
          nome: "Congruenza da verificare",
          testo:
            "Il mix delle fonti non riproduce con chiarezza la natura del fabbisogno: prima di giudicare, va confrontato con la struttura patrimoniale di partenza e con le scadenze del debito in essere.",
        };

  return (
    <SectionCard
      titolo="Raccolta, rischio finanziario e costo del capitale"
      eyebrow="Solvibilità · da dove arrivano le risorse e quanto costano"
      accento={BLUE}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={BLUE} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="La composizione delle nuove fonti di finanziamento"
          descrizione="L'indagine sul Rendiconto si chiude sull'area della raccolta: le operazioni con cui l'impresa acquisisce nuovi mezzi rivolgendosi al mercato finanziario esterno. Le macro-fonti sono due — capitale di rischio e nuovi debiti — e l'analisi di composizione ne pesa ciascuna sul totale, isolando i capitali permanenti, cioè i mezzi che resteranno durevolmente a disposizione."
          accento={BLUE}
        >
          <ComposizioneAssorbimento
            voci={vociRaccolta}
            gruppi={[
              { id: "durevoli", titolo: "Capitali permanenti", tinta: BLUE },
              { id: "breve", titolo: "Fonti a breve termine", tinta: PURPLE },
            ]}
            etichettaTotale="Totale della raccolta"
            testoVuoto="Servono due esercizi consecutivi con lo Stato Patrimoniale per misurare la raccolta per differenza."
          />
          <div className="mt-4">{griglia(perId(IND_RACCOLTA, ["aumentiCapitale", "nuoviDebitiMl", "pesoFontiDurevoli"]))}</div>
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="Il quadro complessivo delle fonti · interne contro esterne"
          descrizione="Alle fonti esterne vanno affiancate quelle generate internamente — autofinanziamento operativo netto e alienazione di asset — per quantificare l'esatta proporzione fra autosufficienza aziendale e dipendenza dai mercati terzi."
          accento={BLUE}
        >
          <ComposizioneAssorbimento
            voci={vociQuadro}
            gruppi={[
              { id: "interne", titolo: "Risorse prodotte internamente", tinta: GREEN },
              { id: "esterne", titolo: "Risorse raccolte esternamente", tinta: PURPLE },
            ]}
            etichettaTotale="Totale delle fonti complessive"
            testoVuoto="Servono autofinanziamento e variazioni patrimoniali per costruire il quadro complessivo."
          />
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Il quadro somma <strong>fonti</strong>: le componenti che nell'esercizio si sono mosse in rimborso non
            compaiono qui, perché sono impieghi di risorse e non provviste.{" "}
            {isNum(rimborsi)
              ? `Nell'esercizio i rimborsi netti ammontano a ${fmt(Math.abs(rimborsi))} e vanno letti nel blocco precedente, dove il saldo della raccolta li incorpora.`
              : "In questo esercizio nessuna componente della raccolta si è mossa in rimborso."}
          </p>
          <div className="mt-4">{griglia(perId(IND_RACCOLTA, ["autosufficienza"]))}</div>
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="Natura del fabbisogno e congruenza temporale delle fonti"
          descrizione="Il giudizio sulla raccolta non si dà osservando i flussi annuali isolati. Occorre confrontare la natura del fabbisogno manifestatosi nell'anno — funzionamento corrente contro struttura — con la tipologia delle fonti raccolte, e raccordare questa lettura dinamica con la fotografia statica dello Stato Patrimoniale."
          accento={BLUE}
        >
          <NaturaFabbisogno funzionamento={funzionamento} strutturale={strutturale} durevoli={durevoli} breve={varBreve} />
          {congruenza && (
            <div className="mt-4 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${LEVEL_COLOR[congruenza.level]}55` }}>
              <Label color={`${INK}90`}>Verifica di congruenza · {coppia?.corrente}</Label>
              <div className="mt-2">
                <Badge level={congruenza.level}>{congruenza.nome}</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}D0` }}>
                {congruenza.testo}
              </p>
            </div>
          )}
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="Il rischio finanziario dentro il costo del capitale"
          descrizione="La valutazione della solvibilità sfocia nella misura del rischio finanziario, che va incorporato nel costo del capitale: insieme ai flussi di cassa, il WACC è una delle due variabili da cui dipende il valore fondamentale dell'impresa. Kd e Ke si compongono entrambi di un tasso privo di rischio e di un premio che sconta rischio di mercato, rischio operativo e rischio d'insolvenza."
          accento={BLUE}
        >
          <MappaValore
            flusso={d?.rf?.fcfo}
            wacc={wacc ?? par?.wacc}
            rischi={[
              {
                nome: "Rischio di mercato",
                valore: pct(p.erp),
                nota: "variabilità dei ricavi legata ai cicli economici generali · premio ERP",
              },
              {
                nome: "Rischio operativo",
                valore: isNum(betaU) ? fmt(betaU, 2) : "n.d.",
                nota: "variabilità dei margini legata alla struttura dei costi · beta unlevered",
              },
              {
                nome: "Rischio finanziario",
                valore: isNum(de) ? `D/E ${fmt(de, 2)}` : "n.d.",
                nota: "capacità di onorare i debiti · struttura finanziaria adottata",
              },
            ]}
          />
          <div className="mt-4">
            <WaccComposizione kdNetto={kdNetto} ke={ke} pesoD={pesoD} wacc={wacc} />
          </div>
          <div className="mt-4">{griglia(IND_COSTO_CAPITALE)}</div>
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="Solvibilità e costo del debito · il rating sintetico"
          descrizione="Per le società con debiti quotati il premio al rischio si legge dal mercato: lo Yield to Maturity dei titoli meno il tasso risk-free. Dove i titoli non sono quotati o il mercato è illiquido, si assegna all'impresa una classe di rating simulata, comparando i suoi indici con i valori mediani delle aziende già coperte da rating ufficiale."
          accento={BLUE}
        >
          <RatingSintetico cover={cover} debtEbitda={safeDiv(debitiFinanziariDi(d), d?.ce?.ebitda)} rf={p.rf} />
          <div className="mt-4">{griglia(IND_RISCHIO_INSOLVENZA)}</div>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="I modelli quantitativi di previsione dell'insolvenza"
          descrizione="L'alternativa all'impostazione qualitativa sono gli algoritmi che calcolano un punteggio di rischio o direttamente la probabilità di default. Lo Z-Score di Altman traccia una linea di demarcazione; i modelli logit assegnano una percentuale continua, immediatamente associabile a una classe di rating. Il modello qui implementato è quello calibrato sulle PMI italiane per il default a 18 mesi, perché i grandi modelli anglosassoni non si adattano bene a quella realtà."
          accento={BLUE}
        >
          <ScoringDefault logit={logit} z={z} />
          <div className="mt-4">{griglia(IND_MODELLI_DEFAULT)}</div>
          <div
            className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
            style={{ fontFamily: FONT_BODY, backgroundColor: `${AMBER}0F`, borderLeft: `3px solid ${AMBER}`, color: INK }}
          >
            <strong>Che cosa manca a questi numeri.</strong> Nella ricerca applicata su popolazioni asimmetriche — molte
            imprese sane, poche fallite — il modello base subisce calibrazioni algebriche sull'intercetta, regolate da
            logaritmi e funzioni inverse della normale standard, per adattare il campione all'universo reale: qui
            l'intercetta è quella grezza, e la PD va letta come ordine di grandezza. Soprattutto, per un rating
            definitivo lo scoring quantitativo va sempre integrato con dati qualitativi — il settore economico — e
            andamentali, cioè le informazioni di regolarità bancaria della Centrale dei Rischi della Banca d'Italia, che
            nessun bilancio contiene.
          </div>
        </Blocco>

        {/* ── G ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="G"
          titolo="Solvibilità e costo dell'equity · leva finanziaria e beta re-levered"
          descrizione="È un errore comune pensare che l'indebitamento impatti solo il rischio del creditore. Gli oneri finanziari sono costi fissi: amplificano la variabilità del risultato che arriva agli azionisti, i quali — temendo la leva e il rischio di bancarotta, che azzera il capitale sociale e sposta il valore residuo verso le banche — pretendono razionalmente una remunerazione maggiore."
          accento={BLUE}
        >
          <BetaRelevering
            betaLSettore={p.betaL}
            deSettore={p.deSettore}
            tSettore={p.tSettore}
            betaU={betaU}
            de={de}
            t={aliquota ?? p.tSettore}
            betaRel={betaRel}
            rf={p.rf}
            erp={p.erp}
            ke={ke}
          />
          <div className="mt-4">{griglia(perId(IND_RISCHIO_INSOLVENZA, ["glf"]))}</div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            I beta medi di settore forniti dalle agenzie sono <strong>unlevered</strong>: riflettono la rischiosità di
            mercato e operativa del comparto, sterilizzata dall'indebitamento, perché ogni impresa del settore si
            finanzia a modo proprio. Il re-levering inietta nel beta il rischio finanziario specifico generato dal D/E
            scelto dai vertici aziendali, e riconnette così la struttura finanziaria al costo dei mezzi propri. La
            versione estesa di questa depurazione — con il passaggio intermedio per il Business Beta, che toglie anche
            l'effetto della leva operativa di settore — vive nel sub-tab «4 · Dati Macro &amp; CAPM» e nella pagina «2.1
            · Determinanti del ROI».
          </p>
        </Blocco>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-nonies. COMPONENTI GRAFICI DELLA REDDITIVITÀ NETTA (Capitolo 14)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * FIG. 14.1 — Convergenza fra flussi finanziari e reddituali.
 * In steady state — circolante fermo e capex pari agli ammortamenti — l'EBIT
 * converge sul free cash flow operativo e il reddito netto sul FCFE. Le due
 * colonne mostrano il caso reale accanto alla condizione teorica, e le righe
 * intermedie sono esattamente ciò che separa l'uno dall'altro.
 */
function ConvergenzaFlussi({ ebit, fcfo, deltaCcnc, capex, ammortamenti, redditoNetto, fcfe, nuoviDebiti }) {
  const riga = (nome, reale, steady, nota) => (
    <tr key={nome} style={{ borderTop: `1px solid ${LINE}` }}>
      <td className="py-1.5 pr-2">
        <div className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
          {nome}
        </div>
        {nota && (
          <div className="text-[10px] italic leading-tight" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
            {nota}
          </div>
        )}
      </td>
      <td className="py-1.5 px-2 text-right text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {typeof reale === "string" ? reale : fmt(reale)}
      </td>
      <td className="py-1.5 pl-2 text-right text-[11px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}90` }}>
        {typeof steady === "string" ? steady : fmt(steady)}
      </td>
    </tr>
  );

  const scartoOperativo = isNum(ebit) && isNum(fcfo) ? fcfo - ebit : null;
  const scartoNetto = isNum(redditoNetto) && isNum(fcfe) ? fcfe - redditoNetto : null;

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left">
                <Label color={`${INK}80`}>Voce</Label>
              </th>
              <th className="py-1 px-2 text-right">
                <Label color={`${INK}80`}>Caso reale</Label>
              </th>
              <th className="py-1 pl-2 text-right">
                <Label color={`${INK}80`}>Steady state</Label>
              </th>
            </tr>
          </thead>
          <tbody>
            {riga("Reddito operativo (EBIT)", ebit, ebit)}
            {riga("± Variazione del CCNc", isNum(deltaCcnc) ? -deltaCcnc : null, 0, "in steady state il circolante si stabilizza")}
            {riga(
              "± Capex al netto degli ammortamenti",
              isNum(capex) && isNum(ammortamenti) ? -(Math.abs(capex) - Math.abs(ammortamenti)) : null,
              0,
              "in steady state gli investimenti pareggiano l'usura"
            )}
            {riga("= Free cash flow operativo", fcfo, ebit, "in steady state coincide con l'EBIT")}
          </tbody>
          <tbody>
            {riga("Reddito netto", redditoNetto, redditoNetto)}
            {riga("± Nuovi debiti netti", nuoviDebiti, 0, "in steady state la struttura finanziaria resta costante")}
            {riga("= Free cash flow to equity", fcfe, redditoNetto, "in steady state coincide con il reddito netto")}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
          <Label color={`${INK}80`}>Distanza dalla convergenza · area operativa</Label>
          <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {isNum(scartoOperativo) ? segnato(scartoOperativo) : "n.d."}
          </div>
          <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
            FCFO − EBIT: quanto la crescita di circolante e struttura allontana il flusso dal reddito
          </div>
        </div>
        <div className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
          <Label color={`${INK}80`}>Distanza dalla convergenza · area netta</Label>
          <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {isNum(scartoNetto) ? segnato(scartoNetto) : "n.d."}
          </div>
          <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
            FCFE − Reddito netto: quanto la movimentazione del debito allontana il flusso dall'utile
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * FIG. 14.3 — Le misure della redditività netta, ad albero.
 * Dal ROE base si sale al ROE normalizzato e poi ci si biforca: a sinistra
 * verso la neutralità fiscale, a destra verso il rischio ordinario puro.
 */
function AlberoRoe({ roe, roeNorm, roeast, roce }) {
  const nodo = (titolo, valore, nota, tinta) => (
    <div className="flex-1 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${tinta}55`, minWidth: 180 }}>
      <Label color={`${tinta}C0`}>{titolo}</Label>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {pct(valore)}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
        {nota}
      </p>
    </div>
  );

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${PURPLE}55` }}>
        <Label color={`${PURPLE}C0`}>ROE base</Label>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pct(roe)}
        </div>
        <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
          reddito netto ÷ capitale netto medio
        </div>
      </div>
      <div className="my-1 text-center text-[11px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▼ si normalizza togliendo ciò che non si ripete ▼
      </div>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
        <Label color={`${INK}90`}>ROE normalizzato</Label>
        <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pct(roeNorm)}
        </div>
        <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
          reddito corrente netto ÷ capitale netto
        </div>
      </div>
      <div className="my-1 text-center text-[11px]" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▼ e si biforca ▼
      </div>
      <div className="flex flex-wrap gap-2">
        {nodo("ROEAST", roeast, "reddito corrente lordo: neutralizza il fisco e rende comparabili imprese con regimi diversi", BLUE)}
        {nodo("ROCE", roce, "al netto di capitale e dividendi privilegiati: isola chi sopporta il pieno rischio d'impresa", GREEN)}
      </div>
    </div>
  );
}

/**
 * Identità additivo-moltiplicativa resa esplicita, con il riscontro sul ROE
 * contabile: se lo scarto non è nullo, si vede.
 */
function IdentitaRoe({ roi, rod, de, effetto, roeLordo, incidenza, roeRicostruito, roeContabile }) {
  const cella = (etichetta, valore, tinta = INK) => (
    <div key={etichetta} className="rounded-md px-3 py-2 text-center" style={{ backgroundColor: CARD, border: `1px solid ${tinta}44` }}>
      <div className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${tinta}C0` }}>
        {etichetta}
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
        {valore}
      </div>
    </div>
  );
  const scarto = isNum(roeRicostruito) && isNum(roeContabile) ? roeRicostruito - roeContabile : null;

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: INK }}>
        ROE = [ ROI + (ROI − ROD) × D/E ] × incidenza fiscale
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {cella("ROI", pct(roi), BLUE)}
        {cella("ROD", pct(rod), PURPLE)}
        {cella("Spread", pct(isNum(roi) && isNum(rod) ? roi - rod : null), isNum(roi) && isNum(rod) && roi - rod >= 0 ? GREEN : RED)}
        {cella("D/E", mult(de), PURPLE)}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        {cella("Effetto leva", pct(effetto), isNum(effetto) && effetto >= 0 ? GREEN : RED)}
        {cella("ROE ante imposte", pct(roeLordo), INK)}
        {cella("Incidenza fiscale", pct(incidenza), AMBER)}
        {cella("ROE ricostruito", pct(roeRicostruito), INK)}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
        <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
          Riscontro sul ROE contabile {pct(roeContabile)}
        </span>
        <span
          className="text-[11px] font-bold tabular-nums"
          style={{ fontFamily: FONT_MONO, color: !isNum(scarto) ? `${INK}70` : Math.abs(scarto) < 0.0005 ? GREEN : AMBER }}
        >
          {!isNum(scarto) ? "n.d." : Math.abs(scarto) < 0.0005 ? "identità verificata" : `scarto ${pp(scarto)}`}
        </span>
      </div>
    </div>
  );
}

/**
 * Analisi univariata degli scostamenti del ROE: si tengono ferme tutte le
 * variabili all'anno zero e le si sostituisce una alla volta con i valori
 * dell'anno uno. La somma algebrica degli effetti parziali restituisce
 * esattamente la variazione complessiva.
 */
function scostamentiRoeLeva(d1, d0, ctx1, ctx0) {
  const v = (d) => ({ roi: roiMmDi(d), rod: rodMmDi(d), de: deMmDi(d), s: incidenzaTotaleDi(d) });
  const a = v(d1);
  const b = v(d0);
  if (![a.roi, a.rod, a.de, a.s, b.roi, b.rod, b.de, b.s].every(isNum)) return null;
  const f = (roi, rod, de, s) => (roi + (roi - rod) * de) * s;
  const base = f(b.roi, b.rod, b.de, b.s);
  const p1 = f(a.roi, b.rod, b.de, b.s);
  const p2 = f(a.roi, a.rod, b.de, b.s);
  const p3 = f(a.roi, a.rod, a.de, b.s);
  const p4 = f(a.roi, a.rod, a.de, a.s);
  return {
    roe0: base,
    roe1: p4,
    delta: p4 - base,
    effetti: [
      { nome: "Effetto ROI", valore: p1 - base, nota: `da ${pct(b.roi)} a ${pct(a.roi)}` },
      { nome: "Effetto ROD", valore: p2 - p1, nota: `da ${pct(b.rod)} a ${pct(a.rod)}` },
      { nome: "Effetto leva D/E", valore: p3 - p2, nota: `da ${mult(b.de)} a ${mult(a.de)}` },
      { nome: "Effetto fisco e straordinari", valore: p4 - p3, nota: `da ${pct(b.s)} a ${pct(a.s)}` },
    ],
  };
}

/** Rappresentazione a cascata degli scostamenti del ROE. */
function GraficoScostamentiRoe({ s, annoCorrente, annoPrecedente }) {
  if (!s) return <FiguraVuota testo="Servono due esercizi con risultato ante imposte, oneri finanziari e patrimonio netto per scomporre la variazione del ROE." />;
  const scala = Math.max(...s.effetti.map((e) => Math.abs(e.valore)), Math.abs(s.delta), 0.001);

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label color={`${INK}90`}>
          Dal ROE {annoPrecedente} al ROE {annoCorrente}
        </Label>
        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pct(s.roe0)} → {pct(s.roe1)} · {pp(s.delta)}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {s.effetti.map((e) => {
          const largh = (Math.abs(e.valore) / scala) * 45;
          const pos = e.valore >= 0;
          return (
            <div key={e.nome} className="flex items-center gap-2">
              <div className="w-52 shrink-0 text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
                {e.nome}
                <span className="block text-[10px] italic leading-tight" style={{ color: `${INK}80` }}>
                  {e.nota}
                </span>
              </div>
              <div className="relative h-4 flex-1 rounded-sm" style={{ backgroundColor: `${INK}0A` }}>
                <div
                  className="absolute h-4 rounded-sm"
                  style={{
                    left: pos ? "50%" : `${50 - largh}%`,
                    width: `${largh}%`,
                    backgroundColor: pos ? GREEN : RED,
                  }}
                />
                <div className="absolute h-4" style={{ left: "50%", width: 1, backgroundColor: `${INK}40` }} />
              </div>
              <div
                className="w-20 shrink-0 text-right text-[11px] font-bold tabular-nums"
                style={{ fontFamily: FONT_MONO, color: pos ? GREEN : RED }}
              >
                {pp(e.valore)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
        <span className="text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
          Somma algebrica degli effetti
        </span>
        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pp(s.effetti.reduce((acc, e) => acc + e.valore, 0))}
        </span>
      </div>
    </div>
  );
}

/**
 * FIG. 14.5 — ROE, rischio finanziario e costo del capitale.
 * Al crescere del D/E il costo dell'equity sale più che proporzionalmente
 * (proposizione II di Modigliani-Miller): il beneficio contabile del debito
 * sul ROE viene bilanciato dal rischio che gli azionisti prezzano.
 */
function CurvaKeLeva({ keU, kd, t, deImpresa, keImpresa }) {
  if (!isNum(keU) || !isNum(kd) || !isNum(t))
    return <FiguraVuota testo="Compila i parametri CAPM e l'aliquota fiscale per tracciare la curva del costo dell'equity." />;

  const W = 680;
  const H = 220;
  const L = 46;
  const R = 20;
  const T = 16;
  const B = 34;
  const deMax = Math.max(3, isNum(deImpresa) ? deImpresa * 1.4 : 3);
  const keDi_ = (x) => keU + (keU - kd) * (1 - t) * x;
  const yMax = Math.max(keDi_(deMax), keU) * 1.15;
  const px = (x) => L + (x / deMax) * (W - L - R);
  const py = (y) => H - B - (y / yMax) * (H - T - B);

  const punti = Array.from({ length: 41 }, (_, i) => {
    const x = (deMax * i) / 40;
    return `${px(x)},${py(keDi_(x))}`;
  }).join(" ");

  return (
    <div className="rounded-md p-2" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Costo dell'equity e leva finanziaria">
        {[0, 0.25, 0.5, 0.75, 1].map((q) => (
          <g key={q}>
            <line x1={L} y1={py(yMax * q)} x2={W - R} y2={py(yMax * q)} stroke={`${INK}12`} strokeWidth="1" />
            <text x={L - 6} y={py(yMax * q) + 3} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}80` }}>
              {pct(yMax * q, 0)}
            </text>
          </g>
        ))}
        <line x1={L} y1={py(kd)} x2={W - R} y2={py(kd)} stroke={PURPLE} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={W - R} y={py(kd) - 5} textAnchor="end" style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: PURPLE }}>
          Kd {pct(kd)}
        </text>
        <line x1={L} y1={py(keU)} x2={W - R} y2={py(keU)} stroke={`${GREEN}90`} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={W - R} y={py(keU) - 5} textAnchor="end" style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: GREEN }}>
          Ke unlevered {pct(keU)}
        </text>
        <polyline points={punti} fill="none" stroke={BLUE} strokeWidth="2.5" />
        <text x={px(deMax) - 4} y={py(keDi_(deMax)) - 8} textAnchor="end" style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: BLUE }}>
          Ke levered
        </text>

        {isNum(deImpresa) && deImpresa >= 0 && deImpresa <= deMax && (
          <g>
            <line x1={px(deImpresa)} y1={T} x2={px(deImpresa)} y2={H - B} stroke={INK} strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={px(deImpresa)} cy={py(keDi_(deImpresa))} r="4.5" fill={INK} />
            <text
              x={px(deImpresa)}
              y={py(keDi_(deImpresa)) - 10}
              textAnchor="middle"
              style={{ fontFamily: FONT_HEAD, fontSize: 10, fontWeight: 700, fill: INK }}
            >
              impresa · D/E {fmt(deImpresa, 2)}
            </text>
          </g>
        )}

        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={INK} strokeWidth="1" />
        {[0, 1, 2, 3].filter((x) => x <= deMax).map((x) => (
          <text key={x} x={px(x)} y={H - B + 14} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}90` }}>
            {x}
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: `${INK}80`, letterSpacing: "0.08em" }}>
          GRADO DI INDEBITAMENTO D/E
        </text>
      </svg>
      <p className="mt-1 px-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        Proposizione II con imposte: Ke(L) = Ke(U) + [Ke(U) − Kd] × (1 − t) × D/E. In un mercato perfetto i benefici
        contabili del debito sul ROE sono istantaneamente bilanciati dall'aumento del rendimento preteso dagli
        azionisti, e il valore globale resta invariato.
        {isNum(keImpresa) && isNum(deImpresa)
          ? ` Il Ke stimato dal CAPM con il beta re-levered è ${pct(keImpresa)}: la differenza rispetto alla curva dipende dal fatto che il beta di settore incorpora anche il rischio operativo del comparto.`
          : ""}
      </p>
    </div>
  );
}

/**
 * FIG. 14.6 — Trading on equity e valore fondamentale.
 * Curva a campana SCHEMATICA: lo scudo fiscale spinge il valore verso l'alto
 * finché i costi attesi di dissesto non prendono il sopravvento. La posizione
 * dell'impresa è quella reale; l'ottimo disegnato è illustrativo e non si
 * ricava dal bilancio.
 */
function CurvaValoreDebito({ deImpresa, aliquota }) {
  const W = 680;
  const H = 210;
  const L = 40;
  const R = 20;
  const T = 18;
  const B = 36;
  const deMax = Math.max(3, isNum(deImpresa) ? deImpresa * 1.4 : 3);
  const t = isNum(aliquota) ? aliquota : 0.24;
  /* Scudo fiscale crescente e concavo, costi di dissesto convessi: la campana
     nasce dalla loro somma. È una forma, non una stima. */
  const valore = (x) => 1 + t * (1 - Math.exp(-1.1 * x)) - 0.045 * Math.pow(x, 3);
  const xs = Array.from({ length: 61 }, (_, i) => (deMax * i) / 60);
  const ys = xs.map(valore);
  const yMin = Math.min(...ys, 1) - 0.05;
  const yMax = Math.max(...ys) + 0.05;
  const px = (x) => L + (x / deMax) * (W - L - R);
  const py = (y) => H - B - ((y - yMin) / (yMax - yMin)) * (H - T - B);
  const iOtt = ys.indexOf(Math.max(...ys));
  const xOtt = xs[iOtt];

  return (
    <div className="rounded-md p-2" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Valore fondamentale e indebitamento">
        <polyline points={xs.map((x, i) => `${px(x)},${py(ys[i])}`).join(" ")} fill="none" stroke={BLUE} strokeWidth="2.5" />
        <line x1={px(xOtt)} y1={py(ys[iOtt])} x2={px(xOtt)} y2={H - B} stroke={GREEN} strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={px(xOtt)} cy={py(ys[iOtt])} r="4" fill={GREEN} />
        <text x={px(xOtt)} y={py(ys[iOtt]) - 10} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fill: GREEN }}>
          indebitamento ottimale
        </text>
        <text x={px(xOtt * 0.45)} y={py(yMax) + 6} textAnchor="middle" style={{ fontFamily: FONT_BODY, fontSize: 9, fill: `${INK}90` }}>
          scudo fiscale
        </text>
        <text x={px(Math.min(deMax * 0.85, xOtt * 2.2))} y={py(yMin) - 12} textAnchor="middle" style={{ fontFamily: FONT_BODY, fontSize: 9, fill: RED }}>
          effetti di squilibrio finanziario
        </text>

        {isNum(deImpresa) && deImpresa >= 0 && deImpresa <= deMax && (
          <g>
            <line x1={px(deImpresa)} y1={T} x2={px(deImpresa)} y2={H - B} stroke={INK} strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={px(deImpresa)} cy={py(valore(deImpresa))} r="4.5" fill={INK} />
            <text x={px(deImpresa)} y={H - B + 26} textAnchor="middle" style={{ fontFamily: FONT_HEAD, fontSize: 9, fontWeight: 700, fill: INK }}>
              impresa · D/E {fmt(deImpresa, 2)}
            </text>
          </g>
        )}

        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={INK} strokeWidth="1" />
        {[0, 1, 2, 3].filter((x) => x <= deMax).map((x) => (
          <text key={x} x={px(x)} y={H - B + 13} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: `${INK}90` }}>
            {x}
          </text>
        ))}
        <text x={L - 6} y={py(yMax) + 4} textAnchor="end" style={{ fontFamily: FONT_HEAD, fontSize: 8, fill: `${INK}70` }}>
          VALORE
        </text>
      </svg>
      <p className="mt-1 px-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        <strong>Curva schematica.</strong> La forma nasce dal contrasto fra lo scudo fiscale — gli oneri finanziari sono
        deducibili e il debito accresce il valore — e i costi attesi di dissesto: spese legali, perdita di asset, fuga di
        talenti, clienti e fornitori. Il punto di ottimo qui disegnato è illustrativo: dipende da volatilità dei flussi,
        tangibilità degli asset e settore, e non si ricava dal solo bilancio. La posizione dell'impresa sull'asse è
        invece reale.
      </p>
    </div>
  );
}

/**
 * FIG. 14.7 / 14.8 — Il sistema degli indicatori.
 * La redditività netta come terminale in cui confluiscono le due ali
 * dell'analisi, attraversate dal vettore della crescita.
 */
function SistemaIndicatori({ roe, operativa, finanziaria, crescita }) {
  const ala = (titolo, righe, tinta) => (
    <div className="flex-1 rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${tinta}44`, minWidth: 240 }}>
      <Label color={`${tinta}C0`}>{titolo}</Label>
      <div className="mt-2">
        {righe.map((r) => (
          <div key={r.nome} className="flex items-baseline justify-between gap-3 py-1" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="text-[11px]" style={{ fontFamily: FONT_BODY, color: INK }}>
              {r.nome}
              <span className="ml-1 text-[10px] italic" style={{ color: `${INK}80` }}>
                {r.fase}
              </span>
            </span>
            <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {r.valore}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-sm rounded-md p-3 text-center" style={{ backgroundColor: CARD, border: `2px solid ${PURPLE}55` }}>
        <Label color={`${PURPLE}C0`}>Redditività netta · ROE</Label>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {pct(roe)}
        </div>
      </div>
      <div className="my-2 text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: `${INK}70` }}>
        ▲ vi confluiscono le due ali dell'analisi ▲
      </div>
      <div className="flex flex-wrap gap-2">
        {ala("Aree di affari · rendimento degli investimenti", operativa, BLUE)}
        {ala("Mercato finanziario · rendimento del capitale di rischio", finanziaria, PURPLE)}
      </div>
      <div className="mt-2 rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${GREEN}44` }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label color={`${GREEN}C0`}>Vettore trasversale · crescita</Label>
          <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
            {crescita}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
          Fa da cassa di risonanza: espande i volumi e con essi il reddito, ma stressa contestualmente gli assorbimenti
          di cassa — circolante commerciale e capex — che le due ali devono finanziare.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6-decies. PAGINA 4 — REDDITIVITÀ NETTA
   ═══════════════════════════════════════════════════════════════════════════ */

function PaginaRedditivitaNetta({ dataset, anni, coppia, onCoppia, onVaiAiDati, par }) {
  if (anni.length < 2)
    return (
      <EmptyState
        titolo={anni.length ? "Un solo esercizio in memoria" : "Nessun esercizio caricato"}
        testo={
          anni.length
            ? "Il capitale netto medio e l'analisi degli scostamenti richiedono due esercizi: carica anche la terna di moduli dell'esercizio precedente."
            : "Importa i moduli di riclassificazione SP, CE e RF: gli esercizi vengono dedotti dai file."
        }
        onVaiAiDati={onVaiAiDati}
      />
    );

  const annoPrimaDi = (a) => anni.find((x) => x < a) ?? null;
  const ctxDi = (a) => {
    if (a == null) return null;
    const ap = annoPrimaDi(a);
    return { anno: a, annoPrecedente: ap, prec: ap != null ? dataset[ap] : null, par };
  };

  const ctx = ctxDi(coppia?.corrente);
  const ctxPrec = ctxDi(coppia?.precedente);
  const d = coppia ? dataset[coppia.corrente] : null;
  const dPrec = coppia ? dataset[coppia.precedente] : null;

  const griglia = (lista) => (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((ind) => (
        <CardInd
          key={ind.id}
          ind={ind}
          datiCorrente={d}
          datiPrecedente={dPrec}
          annoCorrente={coppia?.corrente}
          annoPrecedente={coppia?.precedente}
          ctx={ctx}
          ctxPrec={ctxPrec}
        />
      ))}
    </div>
  );

  const roe = roeMedioDi(d, ctx) ?? safeDiv(d?.ce?.utileNetto, d?.sp?.patrimonioNetto);
  const roeNorm = safeDiv(redditoCorrenteNettoDi(d, ctx), capitaleNettoMedioDi(d, ctx) ?? d?.sp?.patrimonioNetto);
  const deltaCcnc = isNum(d?.sp?.ccno) && isNum(ctx?.prec?.sp?.ccno) ? d.sp.ccno - ctx.prec.sp.ccno : null;
  const nuoviDebitiNetti = somma(nuoviDebitiMlDi(d, ctx), variazionePfnBreveDi(d, ctx));
  const scost = scostamentiRoeLeva(d, dPrec, ctx, ctxPrec);

  const aliquota = aliquotaDi(ctx);
  const keU = keUnleveredDi(ctx);
  const kd = kdLordoDi(d);
  const de = deMmDi(d);

  /* Ricomposizione a sistema: i valori arrivano da tutte le fasi precedenti. */
  const alaOperativa = [
    { nome: "ROI", fase: "fase 2", valore: pct(roiMmDi(d)) },
    { nome: "ROS", fase: "fase 2.1", valore: pct(rosDi(d)) },
    { nome: "Produttività del capitale", fase: "fase 2.1", valore: mult(pcDi(d)) },
    { nome: "Ciclo monetario", fase: "fase 3.1", valore: isNum(cicloMonetarioDi(d, ctx)) ? `${fmt(cicloMonetarioDi(d, ctx))} gg` : "n.d." },
    { nome: "Rendimento monetario (Cash Flow ROI)", fase: "fase 3.2", valore: pct(cashFlowRoiDi(d)) },
  ];
  const alaFinanziaria = [
    { nome: "ROD", fase: "fase 4", valore: pct(rodMmDi(d)) },
    { nome: "Grado di indebitamento D/E", fase: "fase 4", valore: mult(de) },
    { nome: "Autonomia patrimoniale", fase: "fase 3", valore: pct(safeDiv(capitaleNettoRettificatoDi(d, ctx), d?.sp?.capitaleInvestitoNetto)) },
    { nome: "Liquidità generale", fase: "fase 3.1", valore: mult(safeDiv(attivitaCorrentiDi(d), passivitaCorrentiDi(d))) },
    { nome: "Copertura degli interessi", fase: "fase 3.3", valore: mult(ebitCoverDi(d)) },
  ];

  return (
    <SectionCard
      titolo="Redditività Netta"
      eyebrow="Remunerazione del capitale proprio · il terminale dell'analisi"
      accento={PURPLE}
      toolbar={<SelettoreAnnualita anni={anni} value={coppia} onChange={onCoppia} accento={PURPLE} />}
    >
      <div className="space-y-8">
        {/* ── A ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="A"
          titolo="Valore fondamentale e convergenza fra flussi e redditi"
          descrizione="Il valore fondamentale si determina attualizzando flussi di cassa: in logica asset side si sconta il free cash flow operativo per ottenere il valore del capitale operativo investito, da cui si sottrae l'indebitamento netto; in logica equity side si sconta direttamente il flusso che resta agli azionisti. In ipotesi di lungo termine, o in steady state, le due dimensioni convergono — ed è la ragione per cui i flussi di reddito restano la principale determinante strutturale dei flussi finanziari."
          accento={PURPLE}
        >
          <ConvergenzaFlussi
            ebit={d?.ce?.ebit}
            fcfo={d?.rf?.fcfo}
            deltaCcnc={deltaCcnc}
            capex={capexTotaleDi(d)}
            ammortamenti={ammortamentiDi(d)}
            redditoNetto={d?.ce?.utileNetto}
            fcfe={fcfeDi(d)}
            nuoviDebiti={nuoviDebitiNetti}
          />
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Guardare alla redditività netta significa privilegiare la prospettiva dell'azionista, ma nel lungo termine la
            remunerazione del capitale di rischio deve allinearsi al soddisfacimento di tutti gli stakeholder — clienti,
            dipendenti, creditori. Un'azienda che arricchisce i soci prosciugando le altre risorse aziendali perde il
            proprio vantaggio competitivo e finisce per distruggere valore anche per loro.
          </p>
        </Blocco>

        {/* ── B ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="B"
          titolo="Le misure della redditività netta e le loro rettifiche"
          descrizione="Il ROE lega il flusso di reddito del Conto Economico allo stock di capitale dello Stato Patrimoniale. Per misurare la capacità di produrre ricchezza futura, però, il dato contabile va normalizzato: togliendo ciò che non si ripete, neutralizzando il fisco, isolando gli azionisti che sopportano il pieno rischio."
          accento={PURPLE}
        >
          <AlberoRoe roe={roe} roeNorm={roeNorm} roeast={roeastDi(d, ctx)} roce={roceDi(d, ctx)} />
          <div className="mt-4">{griglia([...IND_REDDITIVITA_NETTA, ...IND_ROE_MISURE])}</div>
        </Blocco>

        {/* ── C ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="C"
          titolo="La scomposizione additivo-moltiplicativa · le tre cause del ROE"
          descrizione="Il ROE è un eccellente indicatore di sintesi ma non spiega perché quel risultato si sia prodotto. L'identità di Modigliani-Miller lo scompone nelle sue tre cause primarie — la redditività intrinseca degli investimenti, l'ammontare del debito e il suo costo — separando rigorosamente l'efficienza operativa dagli effetti della struttura finanziaria."
          accento={PURPLE}
        >
          <IdentitaRoe
            roi={roiMmDi(d)}
            rod={rodMmDi(d)}
            de={de}
            effetto={effettoLevaDi(d)}
            roeLordo={roeLordoDi(d)}
            incidenza={incidenzaTotaleDi(d)}
            roeRicostruito={roeRicostruitoDi(d)}
            roeContabile={safeDiv(d?.ce?.utileNetto, d?.sp?.patrimonioNetto)}
          />
          <div className="mt-4">{griglia(IND_LEVA_ROE)}</div>
        </Blocco>

        {/* ── D ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="D"
          titolo="L'analisi univariata degli scostamenti"
          descrizione="La forma additiva permette di isolare esattamente quale variabile abbia causato la variazione del ROE: si tengono ferme tutte le grandezze all'anno zero e le si sostituisce una alla volta con i valori dell'anno uno. Gli effetti parziali si sommano algebricamente restituendo, senza residui, la variazione complessiva — ed è questo che la logica moltiplicativa non consente."
          accento={PURPLE}
        >
          <GraficoScostamentiRoe s={scost} annoCorrente={coppia?.corrente} annoPrecedente={coppia?.precedente} />
        </Blocco>

        {/* ── E ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="E"
          titolo="L'espansione della formula · separare la gestione finanziaria"
          descrizione="Un limite della formula base è che il ROI confonde il rendimento operativo degli impianti con quello degli investimenti finanziari. Separandoli emergono due forze distinte: la leva finanziaria, positiva quando l'azienda rende più di quanto paga in interessi, e la leva sulle attività finanziarie, che porta il segno negativo perché parcheggiare risorse in titoli meno redditizi del core business penalizza il ROE."
          accento={PURPLE}
        >
          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <div className="text-center text-[11px] font-bold leading-relaxed" style={{ fontFamily: FONT_MONO, color: INK }}>
              ROE = [ ROI<sub>op</sub> + (ROI<sub>op</sub> − ROD) × D/E − (ROI<sub>op</sub> − ROI<sub>fin</sub>) × AF/E ] × incidenza fiscale × incidenza straordinaria
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { nome: "ROI operativo", valore: pct(roiOperativoDi(d)), nota: "MON ÷ COIN" },
                { nome: "Leva finanziaria", valore: pct(effettoLevaDi(d)), nota: "(ROI − ROD) × D/E" },
                { nome: "Leva sulle attività finanziarie", valore: pct(levaAttivitaFinanziarieDi(d)), nota: "−(ROIop − ROIfin) × AF/E" },
              ].map((r) => (
                <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
                  <Label color={`${INK}80`}>{r.nome}</Label>
                  <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {r.valore}
                  </div>
                  <div className="text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
                    {r.nota}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4">{griglia(IND_LEVA_ESTESA)}</div>
        </Blocco>

        {/* ── F ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="F"
          titolo="La logica moltiplicativa (DuPont) e i suoi quattro limiti"
          descrizione="La via alternativa decompone il ROE in una sequenza moltiplicativa pura: ROI × Leverage × IGE. È storicamente la più diffusa e la più semplice da calcolare, ma oggi è considerata riduttiva per quattro ragioni precise, che vale la pena conoscere prima di usarla."
          accento={PURPLE}
        >
          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <div className="text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: INK }}>
              ROE = ROI × Leverage × IGE = {pct(roiMmDi(d))} × {mult(leverageDuPontDi(d))} × {mult(igeDi(d))} ={" "}
              {pct(
                isNum(roiMmDi(d)) && isNum(leverageDuPontDi(d)) && isNum(igeDi(d))
                  ? roiMmDi(d) * leverageDuPontDi(d) * igeDi(d)
                  : null
              )}
            </div>
          </div>
          <div className="mt-4">{griglia(IND_DUPONT_NETTA)}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              {
                nome: "Reciprocità bloccante",
                testo:
                  "Se aumenta il leverage crescono matematicamente gli oneri finanziari, e l'IGE crolla. L'interdipendenza fra le variabili impedisce un'analisi degli scostamenti univariata: sostituirne una alla volta non ha significato quando muoverne una muove anche le altre.",
              },
              {
                nome: "Effetto «calderone»",
                testo:
                  "L'IGE mescola abilità fiscale, peso dell'indebitamento e gestione straordinaria in un unico numero. Un IGE che peggiora non dice quale dei tre sia il problema, e i tre problemi richiedono decisioni opposte.",
              },
              {
                nome: "Nasconde lo spread vitale",
                testo:
                  "La formula non mostra la differenza fra ROI e ROD: rivela l'effetto moltiplicatore del debito solo per via indiretta e poco intuitiva, proprio mentre quello spread è la variabile su cui si decide se indebitarsi.",
              },
              {
                nome: "Mischia gli investimenti",
                testo:
                  "Come la formula base, non separa l'efficienza degli asset operativi dal rendimento di titoli e partecipazioni: due gestioni con logiche e rischi diversi finiscono valutate con lo stesso metro.",
              },
            ].map((l) => (
              <div key={l.nome} className="rounded-md p-3" style={{ backgroundColor: CARD, border: `1px solid ${AMBER}44` }}>
                <Label color={`${AMBER}C0`}>{l.nome}</Label>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                  {l.testo}
                </p>
              </div>
            ))}
          </div>
        </Blocco>

        {/* ── G ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="G"
          titolo="Trading on equity, ROD standard ed equilibrio riflesso"
          descrizione="La regola aurea dice che finché il ROI supera il ROD, all'aumentare del D/E cresce il ROE. L'analista però deve rifuggire dalle semplificazioni: esistono imprese con ROE positivo salvate solo da finanziamenti agevolati, e imprese eccellenti con spread negativo per debiti pregressi a tassi fuori mercato. Introdurre un ROD standard di mercato separa il merito gestionale dalla fortuna finanziaria."
          accento={PURPLE}
        >
          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <div className="text-center text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: INK }}>
              ROE<sub>lordo</sub> = ROI + [ (ROI − ROD<sub>std</sub>) + (ROD<sub>std</sub> − ROD) ] × D/E
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                {
                  nome: "Efficienza industriale · ROI − RODstd",
                  valore: pct(efficienzaIndustrialeDi(d, ctx)),
                  nota: "il merito della gestione, a condizioni di puro mercato",
                  tinta: BLUE,
                },
                {
                  nome: "Efficienza finanziaria · RODstd − ROD",
                  valore: pct(efficienzaFinanziariaDi(d, ctx)),
                  nota: "abilità nel reperire fondi, o agevolazioni ricevute",
                  tinta: PURPLE,
                },
              ].map((r) => (
                <div key={r.nome} className="rounded-md px-3 py-2" style={{ backgroundColor: CARD, border: `1px solid ${r.tinta}44` }}>
                  <Label color={`${r.tinta}C0`}>{r.nome}</Label>
                  <div className="mt-0.5 text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                    {r.valore}
                  </div>
                  <div className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                    {r.nota}
                  </div>
                </div>
              ))}
            </div>
            {isNum(efficienzaIndustrialeDi(d, ctx)) && (
              <div className="mt-3">
                <Badge
                  level={
                    efficienzaIndustrialeDi(d, ctx) < 0 && (efficienzaFinanziariaDi(d, ctx) ?? 0) > 0
                      ? "bad"
                      : efficienzaIndustrialeDi(d, ctx) < 0
                      ? "bad"
                      : "ok"
                  }
                >
                  {efficienzaIndustrialeDi(d, ctx) < 0 && (efficienzaFinanziariaDi(d, ctx) ?? 0) > 0
                    ? "Equilibrio riflesso: il risultato dipende dalle condizioni di favore, non dalla gestione"
                    : efficienzaIndustrialeDi(d, ctx) < 0
                    ? "Squilibrio strutturale: a condizioni di mercato la gestione non remunererebbe il debito"
                    : "Equilibrio autentico: la gestione regge anche a condizioni di puro mercato"}
                </Badge>
                {efficienzaIndustrialeDi(d, ctx) < 0 && (efficienzaFinanziariaDi(d, ctx) ?? 0) > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                    L'impresa si sostiene unicamente grazie al secondo blocco: il suo vantaggio è altamente vulnerabile e
                    potrebbe svanire al primo mutamento dello scenario politico-creditizio.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="mt-4">{griglia(IND_TRADING_EQUITY)}</div>
        </Blocco>

        {/* ── H ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="H"
          titolo="Rischio operativo, rischio finanziario e indebitamento ottimale"
          descrizione="Il trading on equity potrebbe suggerire che indebitarsi all'inverosimile convenga sempre. È un miraggio pericoloso: la sostenibilità del debito dipende dalla robustezza del ROI, che in mercati ciclici e con alti costi fissi è volatile. Quando il ROI scende sotto il ROD la leva inverte il segno e amplifica le perdite, erodendo il patrimonio."
          accento={PURPLE}
        >
          <CurvaKeLeva keU={keU} kd={kd} t={aliquota} deImpresa={de} keImpresa={keDi(d, ctx)} />
          <div className="mt-4">{griglia(perId(IND_RISCHIO_INSOLVENZA, ["glf"]))}</div>
          <div className="mt-4">
            <CurvaValoreDebito deImpresa={de} aliquota={aliquota} />
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Il grado di indebitamento va inoltre armonizzato con la fase del ciclo di vita: basso nell'introduzione, dove
            il rischio operativo è alto e il valore di liquidazione degli asset è basso; crescente nello sviluppo e nella
            maturità, quando la cassa è stabile e gli asset valgono; di nuovo in contrazione nel declino.
          </p>
        </Blocco>

        {/* ── I ─────────────────────────────────────────────────────────── */}
        <Blocco
          numero="I"
          titolo="La ricomposizione dei sotto-sistemi · l'analisi torna a sistema"
          descrizione="La redditività netta è il terminale ultimo in cui confluiscono tutte le decisioni strategiche, operative e finanziarie: per questo consente di ricomporre ad albero l'intera analisi di bilancio, e di trasformarla da esercizio diagnostico sul passato in laboratorio di simulazione per il futuro."
          accento={PURPLE}
        >
          <SistemaIndicatori
            roe={roe}
            operativa={alaOperativa}
            finanziaria={alaFinanziaria}
            crescita={pct(crescitaRicaviDi(d, ctx))}
          />
          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            Comprese le relazioni di causa-effetto fra i sotto-sistemi, diventa possibile costruire bilanci pro-forma
            attendibili: prevedere l'impatto di una scelta strategica sul circolante, sul capex, sul debito e infine sul
            ROE, e da lì risalire per via di attualizzazione al valore fondamentale. È il passaggio che chiude il
            percorso e riapre l'analisi verso la valutazione d'azienda.
          </p>
        </Blocco>
      </div>
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. SEZIONE DI UPLOAD DATI GLOBALE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Matrice di copertura: per ogni anno mostra quali moduli sono stati caricati. */
function MatriceCopertura({ dataset, anni }) {
  if (!anni.length)
    return (
      <p className="text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
        Nessun esercizio in memoria: gli anni compariranno qui man mano che i file vengono importati.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th className="py-2 pr-3">
              <Label color={`${INK}80`}>Esercizio</Label>
            </th>
            {Object.entries(MODULI).map(([k, v]) => (
              <th key={k} className="py-2 pr-3">
                <Label color={`${INK}80`}>{v}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {anni.map((a) => (
            <tr key={a} style={{ borderTop: `1px solid ${LINE}` }}>
              <td className="py-2 pr-3 text-sm font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                {a}
              </td>
              {Object.keys(MODULI).map((k) => {
                const ok = !!dataset[a]?.presenti?.[k];
                return (
                  <td key={k} className="py-2 pr-3">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                      style={{ fontFamily: FONT_MONO, color: ok ? GREEN : `${INK}55` }}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: ok ? GREEN : LINE }}
                      />
                      {ok ? "caricato" : "assente"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Gestione del peer group: l'impresa in analisi più i comparable caricati. */
function GestionePeer({ aziende, target, onTarget, onNuovoPeer, onRinomina, onElimina, peers }) {
  const [nome, setNome] = useState("");
  const voci = Object.entries(aziende);

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <Label color={`${INK}90`}>Destinazione dell'import</Label>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        I file trascinati qui sopra vengono attribuiti all'impresa selezionata. Carica prima le terne dell'impresa in
        analisi, poi crea un comparable per ciascun concorrente e caricane i moduli: l'app ne calcola da sola ROI
        operativo e crescita e li usa per la distribuzione settoriale e per la matrice dei quadranti.
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        {voci.map(([id, a]) => {
          const attivo = id === target;
          const m = metricheAzienda(a.esercizi);
          const nEsercizi = Object.keys(a.esercizi || {}).length;
          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-2 rounded px-2 py-1.5"
              style={{
                backgroundColor: attivo ? CARD : "transparent",
                border: `1px solid ${attivo ? PURPLE : "transparent"}`,
              }}
            >
              <button
                type="button"
                onClick={() => onTarget(id)}
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, color: attivo ? PURPLE : `${INK}70` }}
              >
                {attivo ? "● attiva" : "○ seleziona"}
              </button>
              <input
                value={a.nome}
                onChange={(e) => onRinomina(id, e.target.value)}
                className="min-w-0 flex-1 rounded px-2 py-1 text-xs"
                style={{ fontFamily: FONT_BODY, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
              />
              <span className="text-[10px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
                {nEsercizi} es.
              </span>
              <span className="text-[10px] tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
                ROI {pct(m?.roi)}
              </span>
              {id !== "principale" && (
                <button
                  type="button"
                  onClick={() => onElimina(id)}
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ fontFamily: FONT_HEAD, color: RED }}
                >
                  elimina
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome del concorrente"
          className="min-w-0 flex-1 rounded px-2 py-1 text-xs"
          style={{ fontFamily: FONT_BODY, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
        />
        <button
          type="button"
          onClick={() => {
            if (!nome.trim()) return;
            onNuovoPeer(nome.trim());
            setNome("");
          }}
          className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
          style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF" }}
        >
          Aggiungi comparable
        </button>
      </div>

      {peers.length > 0 && (
        <p className="mt-2 text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
          {peers.filter((p) => isNum(p.roi)).length} comparable con ROI calcolabile ·{" "}
          {peers.filter((p) => isNum(p.crescita)).length} anche con crescita (servono due esercizi a testa).
        </p>
      )}
    </div>
  );
}

/** Riferimento settoriale: tabella precaricata con override manuale. */
function BenchmarkSettoriale({ bench, onBench, benchmark }) {
  const campi = [
    { k: "q1", label: "Primo quartile" },
    { k: "mediana", label: "Mediana" },
    { k: "q3", label: "Terzo quartile" },
    { k: "min", label: "Minimo" },
    { k: "max", label: "Massimo" },
    { k: "crescitaMediana", label: "Crescita mediana" },
  ];
  const base = SETTORI[bench.settore];

  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <Label color={`${INK}90`}>Riferimento settoriale</Label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={bench.settore}
          onChange={(e) => onBench({ settore: e.target.value, override: {} })}
          className="rounded px-2 py-1 text-xs"
          style={{ fontFamily: FONT_BODY, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
        >
          <option value="">— nessun settore —</option>
          {Object.entries(SETTORI).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>

        <select
          value={bench.modo}
          onChange={(e) => onBench({ modo: e.target.value })}
          className="rounded px-2 py-1 text-xs"
          style={{ fontFamily: FONT_BODY, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
        >
          <option value="auto">Fonte: automatica (peer se ≥ 3)</option>
          <option value="peer">Fonte: solo comparable caricati</option>
          <option value="settore">Fonte: solo tabella settoriale</option>
        </select>
      </div>

      {base && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {campi.map((c) => (
            <label key={c.k} className="flex flex-col gap-1">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
                {c.label}
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={bench.override[c.k] ?? ""}
                  placeholder={(base[c.k] * 100).toString().replace(".", ",")}
                  onChange={(e) => onBench({ override: { ...bench.override, [c.k]: e.target.value } })}
                  className="w-full rounded px-2 py-1 text-xs tabular-nums"
                  style={{ fontFamily: FONT_MONO, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
                />
                <span className="text-xs" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
                  %
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        I valori precaricati sono ordini di grandezza indicativi coerenti con le figure sui valori mediani e sulla
        distribuzione del ROI per settore, <strong>non dati di mercato aggiornati</strong>: vanno sostituiti con la
        distribuzione effettiva del comparto ogni volta che è disponibile. Il confronto sui comparable realmente
        caricati resta comunque la fonte più affidabile.
      </p>

      {benchmark?.fonte && (
        <div className="mt-2">
          <Badge level={benchmark.fonte === "peer" ? "ok" : benchmark.fonte === "settore" ? "info" : "warn"}>
            {benchmark.etichetta}
          </Badge>
        </div>
      )}
    </div>
  );
}

/** Parametri manuali che i moduli SP/CE/RF non contengono. */
/** Colonne della tabella dei parametri per esercizio. */
/* La tabella per esercizio è cresciuta oltre la larghezza leggibile: le
   colonne sono ora raggruppate per area di analisi e rese come tabelle
   separate, così ciascuna resta scorrevole e riconoscibile. */
const COLONNE_PARAMETRI = [
  { k: "fondoAmm", label: "F.do amm.to cumulato", gruppo: "reddituale", nota: "capitale investito lordo, grado di ammortamento" },
  { k: "costoLavoro", label: "Costo del lavoro", gruppo: "reddituale", nota: "CLUP — sovrascrive la classe PERSONALE del CE" },
  { k: "addetti", label: "N. addetti", gruppo: "reddituale", nota: "valore aggiunto e reddito per addetto" },
  { k: "costoVenduto", label: "Costo del venduto", gruppo: "reddituale", nota: "giorni di giacenza — sovrascrive la classe ACQUISTI" },
  { k: "creditiComm", label: "Crediti commerciali", gruppo: "reddituale", nota: "giorni di incasso" },
  { k: "debitiComm", label: "Debiti commerciali", gruppo: "reddituale", nota: "giorni di pagamento" },
  { k: "quotaVariabile", label: "% costi variabili", gruppo: "reddituale", nota: "leva operativa e punto di pareggio" },
  {
    k: "gestNonCorrente",
    label: "Saldo gestione non corrente",
    gruppo: "reddituale",
    nota: "componenti non ricorrenti da isolare dal reddito operativo — firmato",
  },

  /* ---- Solidità patrimoniale: scomposizione dell'attivo immobilizzato ----
     Riconosciute automaticamente dalle voci del modulo SP quando i nomi lo
     consentono; qui si sovrascrivono o si integrano. */
  {
    k: "ppe",
    label: "Immobilizzazioni tecniche",
    gruppo: "patrimoniale",
    auto: "ppe",
    nota: "PP&E — margine e indice di struttura primario",
  },
  {
    k: "immateriali",
    label: "Attività immateriali",
    gruppo: "patrimoniale",
    auto: "immateriali",
    nota: "avviamento e oneri pluriennali — capitale netto tangibile",
  },
  {
    k: "partecipazioni",
    label: "Partecipazioni non liquide",
    gruppo: "patrimoniale",
    auto: "partecipazioni",
    nota: "capitale di rischio netto — leva azionaria delle holding",
  },

  /* ---- Liquidità: le tre grandezze che lo schema a PFN non espone ----
     Tutte stimate con proxy quando il campo resta vuoto; il valore proxy è
     dichiarato sulla card dell'indice che lo usa. */
  {
    k: "liquiditaImmediate",
    label: "Liquidità immediate",
    gruppo: "liquidita",
    auto: "liquidita",
    nota: "cassa, banche attive e titoli a vista — liquidità secca e prova acida",
  },
  {
    k: "scopertiCc",
    label: "Banche c/c passivi",
    gruppo: "liquidita",
    auto: "debitiFinanziariBreve",
    nota: "scoperti a scadenza indeterminata — prova acida e grado di finanziamento del circolante",
  },
  {
    k: "passBreveStretto",
    label: "Passività a breve in senso stretto",
    gruppo: "liquidita",
    nota: "rate di mutuo in scadenza, debiti tributari, dividendi deliberati — denominatore del cash ratio",
  },

  /* ---- Assorbimento di moneta e servizio finanziario (Fase 3.2) ----
     Il rendiconto espone il servizio del debito aggregato e il capex come
     blocco unico: qui si separano le componenti che l'analisi tratta in modo
     diverso, perché diverso è il loro grado di inderogabilità. */
  {
    k: "capexMantenimento",
    label: "Capex di mantenimento",
    gruppo: "assorbimento",
    nota: "quota mandatory del capex — stimata sugli ammortamenti se il campo resta vuoto",
  },
  {
    k: "quoteCapitale",
    label: "Quote capitale rimborsate",
    gruppo: "assorbimento",
    nota: "rimborsi di debiti finanziari — stimati come servizio del debito meno oneri finanziari",
  },
  {
    k: "dividendiDistribuiti",
    label: "Dividendi e buy-back",
    gruppo: "assorbimento",
    nota: "esborsi verso i soci — dal rendiconto se il campo resta vuoto",
  },
  {
    k: "dividendiPrivilegiati",
    label: "Dividendi vincolati",
    gruppo: "assorbimento",
    nota: "azioni privilegiate o di risparmio: si comportano da debito e riducono il flusso discrezionale",
  },
  {
    k: "numeroAzioni",
    label: "N. azioni in circolazione (milioni)",
    gruppo: "assorbimento",
    nota: "EPS e cash dividend per azione",
  },
  {
    k: "durationDebito",
    label: "Duration del debito (anni)",
    gruppo: "assorbimento",
    nota: "scadenza media del debito in essere — termine di confronto del pay-back",
  },

  /* ---- Raccolta, rischio d'insolvenza e costo del capitale (Fase 3.3) ---- */
  {
    k: "disinvestimenti",
    label: "Disinvestimenti di struttura",
    gruppo: "capitale",
    nota: "realizzi da alienazione di immobilizzazioni — fonte interna di finanziamento",
  },
  {
    k: "utiliNonDistribuiti",
    label: "Riserve di utili",
    gruppo: "capitale",
    nota: "utili non distribuiti — variabile X2 dello Z-Score di Altman",
  },
  {
    k: "equityMercato",
    label: "Valore di mercato dell'equity",
    gruppo: "capitale",
    auto: "patrimonioNetto",
    nota: "capitalizzazione o stima del valore economico — pesi del WACC",
  },
  {
    k: "debitoMercato",
    label: "Valore di mercato del debito",
    gruppo: "capitale",
    nota: "corso dei titoli obbligazionari o valore contabile — pesi del WACC",
  },

  /* ---- Redditività netta (Fase 4) ---- */
  {
    k: "capitalePrivilegiato",
    label: "Capitale privilegiato",
    gruppo: "netta",
    nota: "azioni privilegiate e di risparmio: si tolgono dal denominatore del ROCE",
  },
  {
    k: "rodStandard",
    label: "ROD standard di mercato (%)",
    gruppo: "netta",
    nota: "costo medio dei prestiti bancari a breve praticato sul mercato — bollettini Banca d'Italia",
  },

  /* ---- Rettifiche precauzionali al capitale netto e al debito ---- */
  {
    k: "creditiSoci",
    label: "Crediti verso soci",
    gruppo: "rettifiche",
    nota: "posta fittizia: si sottrae al capitale netto",
  },
  {
    k: "azioniProprie",
    label: "Azioni proprie",
    gruppo: "rettifiche",
    nota: "posta fittizia: si sottrae al capitale netto",
  },
  {
    k: "passivitaPotenziali",
    label: "Passività potenziali",
    gruppo: "rettifiche",
    nota: "contenziosi e garanzie non accantonati: si sommano al debito",
  },
];

const GRUPPI_PARAMETRI = [
  { id: "reddituale", titolo: "Redditività e ciclo operativo", accento: GREEN },
  { id: "patrimoniale", titolo: "Solidità patrimoniale · scomposizione dell'attivo immobilizzato", accento: BLUE },
  { id: "liquidita", titolo: "Liquidità · grado di urgenza monetaria", accento: PURPLE },
  { id: "assorbimento", titolo: "Assorbimento di moneta · struttura, debito, equity", accento: PURPLE },
  { id: "capitale", titolo: "Raccolta e costo del capitale · fonti, rating, WACC", accento: BLUE },
  { id: "netta", titolo: "Redditività netta · rettifiche al ROE e confronti di mercato", accento: PURPLE },
  { id: "rettifiche", titolo: "Rettifiche precauzionali", accento: AMBER },
];

/** Parametri CAPM di settore, per la depurazione del beta.
 *  `fonte` dice da dove si reperisce il dato e guida le istruzioni a schermo;
 *  `daPeer` marca i due valori che l'Opzione 2 può ricalcolare sul peer group. */
const CAMPI_CAPM = [
  {
    k: "rf",
    label: "Tasso privo di rischio",
    sigla: "Rf",
    unita: "%",
    placeholder: "es. 3,6",
    fonte: "Titoli di Stato a 10 anni",
  },
  {
    k: "erp",
    label: "Premio per il rischio di mercato",
    sigla: "ERP",
    unita: "%",
    placeholder: "es. 5,8",
    fonte: "Damodaran · Risk Premiums for Other Markets",
  },
  {
    k: "betaL",
    label: "Beta levered medio di settore",
    sigla: "βL",
    unita: "",
    placeholder: "es. 1,12",
    fonte: "Damodaran · Levered and Unlevered Betas by Industry",
  },
  {
    k: "deSettore",
    label: "D/E medio di settore",
    sigla: "D/E",
    unita: "",
    placeholder: "es. 0,45",
    fonte: "Damodaran · Levered and Unlevered Betas by Industry",
    daPeer: true,
  },
  {
    k: "tSettore",
    label: "Aliquota fiscale di settore",
    sigla: "t",
    unita: "%",
    placeholder: "es. 24",
    fonte: "Damodaran · Levered and Unlevered Betas by Industry",
    daPeer: true,
  },
];

/** Complemento non-CAPM: serve alla sola correzione per leva operativa. */
const CAMPI_CAPM_EXTRA = [
  {
    k: "gloSettore",
    label: "Grado di leva operativa di settore",
    sigla: "GLO",
    unita: "",
    placeholder: "es. 1,8",
    fonte: "media di settore o stima interna",
  },
];

/**
 * Separazione dei costi fissi dai variabili quando il bilancio non la espone.
 *
 * È il caso normale, non l'eccezione: la distinzione è gestionale e nessuno
 * schema pubblico la impone. Il riquadro mostra la retta di costo stimata sulla
 * serie storica, il suo grado di adattamento, e lascia all'analista la scelta
 * di adottarla — senza mai scriverla di nascosto nei parametri.
 */
function StimaCostiVariabili({ dataset, anni, par, onPar }) {
  const stima = useMemo(() => stimaQuotaVariabile(dataset, anni), [dataset, anni]);
  const giaCompilati = anni.filter((a) => isNum(num(par?.perAnno?.[a]?.quotaVariabile)));

  const applica = () => {
    if (!stima) return;
    const v = versoCampo(Number(stima.quota.toFixed(2)));
    const perAnno = { ...(par.perAnno || {}) };
    anni.forEach((a) => {
      perAnno[a] = { ...(perAnno[a] || {}), quotaVariabile: v };
    });
    onPar({ perAnno });
  };

  const accento = !stima ? `${INK}80` : stima.affidabile ? GREEN : AMBER;

  return (
    <div className="mt-4 rounded p-3" style={{ border: `1px solid ${accento}40`, backgroundColor: `${accento}0A` }}>
      <Label color={accento}>Quota di costi variabili · separazione per regressione</Label>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        Nessuno schema di bilancio obbligatorio distingue i costi fissi dai variabili: è una classificazione
        gestionale che il fascicolo pubblico non contiene, e l'estrazione documentale la trova solo se il
        management la commenta. In sua assenza la si ricava osservando come i costi operativi si muovono al
        muovere dei ricavi lungo gli esercizi in memoria: sulla retta{" "}
        <span style={{ fontFamily: FONT_MONO }}>Costi = F + v × Ricavi</span> la pendenza è la quota variabile,
        l'intercetta il costo fisso di struttura.
      </p>

      {!stima ? (
        <p className="mt-2 text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
          Servono almeno tre esercizi con ricavi e reddito operativo entrambi valorizzati. Finché non ci sono, la
          quota va indicata a mano nella tabella qui sotto.
        </p>
      ) : (
        <>
          {/* Il foglio di stile incorporato non contiene le utility gap-x/gap-y:
              le distanze fra le colonne vanno dichiarate qui. */}
          <div
            className="mt-2"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", columnGap: 28, rowGap: 12 }}
          >
            {[
              { l: "Quota variabile", v: pct(stima.quota / 100), grande: true },
              { l: "Costi fissi di struttura", v: fmt(stima.costiFissi) },
              { l: "Adattamento R²", v: fmt(stima.r2, 3) },
              { l: "R² corretto per i gradi di libertà", v: fmt(stima.r2corretto, 3) },
              { l: "Esercizi usati", v: `${stima.n} · ${stima.anni.join("–")}` },
            ].map((x) => (
              <div key={x.l} style={{ whiteSpace: "nowrap" }}>
                <Label color={`${INK}80`}>{x.l}</Label>
                <div
                  className="tabular-nums"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: x.grande ? 20 : 13,
                    fontWeight: x.grande ? 700 : 500,
                    color: x.grande ? accento : INK,
                    lineHeight: 1.3,
                  }}
                >
                  {x.v}
                </div>
              </div>
            ))}
          </div>

          {(stima.motivo || stima.cautela) && (
            <p
              className="mt-2 text-[11px] leading-relaxed"
              style={{ fontFamily: FONT_BODY, color: stima.motivo ? AMBER : `${INK}A0` }}
            >
              ⚠ {stima.motivo || stima.cautela}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={applica}
              disabled={!anni.length}
              className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF", opacity: anni.length ? 1 : 0.4 }}
            >
              {giaCompilati.length ? "Sovrascrivi la quota su tutti gli esercizi" : "Applica a tutti gli esercizi"}
            </button>
            <span className="text-[10px]" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
              {giaCompilati.length
                ? `${giaCompilati.length} esercizi hanno già una quota indicata: verrà sostituita.`
                : "Il valore resta poi modificabile esercizio per esercizio nella tabella qui sotto."}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Parametri manuali che i moduli SP/CE/RF non contengono. */
function ParametriAnalisi({ par, onPar, anni, meta, dataset }) {
  const valPercento = (v) => (isNum(v) ? (v * 100).toString().replace(".", ",") : "");
  const cella = (anno, k) => par.perAnno?.[anno]?.[k] ?? "";
  const setCella = (anno, k, v) =>
    onPar({ perAnno: { ...par.perAnno, [anno]: { ...(par.perAnno?.[anno] || {}), [k]: v } } });
  const compilatiCapm = CAMPI_CAPM.filter((c) => isNum(num(par.capm?.[c.k]))).length;

  /* Il riquadro e il titolo li fornisce la SectionCard che avvolge questo
     componente: qui resta il solo contenuto, senza cornici annidate. */
  return (
    <div>
      <p className="text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        Grandezze che le riclassificazioni non contengono o che vi compaiono solo in forma aggregata. Sono tutte
        facoltative: gli indici che le richiedono restano in <em>n.d.</em> e lo dichiarano sulla propria card. Dove
        esiste un valore ricavabile dal CE (costo del venduto, costo del lavoro) il campo funge da sovrascrittura. Le
        grandezze che il sub-tab «2 · Integrazione Documentale» estrae dal bilancio integrale si scrivono qui e
        restano modificabili a mano.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
            Aliquota fiscale {par.aliquotaFonte === "ce" ? "(dal modulo CE)" : par.aliquotaFonte === "manuale" ? "(inserita a mano)" : ""}
          </span>
          <span className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={valPercento(par.aliquota)}
              placeholder={isNum(meta?.aliquota) ? String(meta.aliquota).replace(".", ",") : "es. 24"}
              onChange={(e) => {
                const v = num(e.target.value);
                onPar({ aliquota: v === null ? null : v / 100, aliquotaFonte: "manuale" });
              }}
              className="w-full rounded px-2 py-1 text-xs tabular-nums"
              style={{ fontFamily: FONT_MONO, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
            />
            <span className="text-xs" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>%</span>
          </span>
          {par.aliquotaFonte === "ce" && par.aliquotaFonteTesto && (
            <span className="text-[10px] leading-snug" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
              Fonte nel CE: {par.aliquotaFonteTesto}
            </span>
          )}
          {par.aliquotaFonte === "manuale" && isNum(meta?.aliquota) && (
            <button type="button"
              onClick={(e) => {
                e.preventDefault();
                onPar({ aliquota: meta.aliquota / 100, aliquotaFonte: "ce", aliquotaFonteTesto: meta.aliquotaFonte || "Conto Economico" });
              }}
              className="self-start text-[10px] underline" style={{ fontFamily: FONT_BODY, color: PURPLE }}>
              ↺ torna all'aliquota del Conto Economico ({String(meta.aliquota).replace(".", ",")}%)
            </button>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
            WACC · calcolato dal sistema
          </span>
          <span className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={valPercento(par.wacc)}
              placeholder="es. 8,5"
              onChange={(e) => {
                const v = num(e.target.value);
                onPar({ wacc: v === null ? null : v / 100, waccFonte: v === null ? "auto" : "manuale" });
              }}
              className="w-full rounded px-2 py-1 text-xs tabular-nums"
              style={{ fontFamily: FONT_MONO, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
            />
            <span className="text-xs" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>%</span>
          </span>
          <NotaWacc par={par} onPar={onPar} />
        </label>
      </div>

      <StimaCostiVariabili dataset={dataset} anni={anni} par={par} onPar={onPar} />

      {/* Tabelle per esercizio, una per area di analisi */}
      {anni.length > 0 &&
        GRUPPI_PARAMETRI.map((g) => {
          const colonne = COLONNE_PARAMETRI.filter((c) => c.gruppo === g.id);
          if (!colonne.length) return null;
          return (
            <div className="mt-4" key={g.id}>
              <Label color={`${g.accento}C0`}>{g.titolo}</Label>
              <div className="mt-2 overflow-x-auto">
                <table style={{ borderCollapse: "collapse", minWidth: 120 + colonne.length * 116 }}>
                  <thead>
                    <tr>
                      <th className="py-1 pr-2 text-left">
                        <Label color={`${INK}80`}>Esercizio</Label>
                      </th>
                      {colonne.map((c) => (
                        <th key={c.k} className="py-1 px-1 text-left" title={c.nota}>
                          <Label color={`${INK}80`}>{c.label}</Label>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {anni.map((a) => (
                      <tr key={a} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td className="py-1 pr-2 text-xs font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
                          {a}
                        </td>
                        {colonne.map((c) => {
                          /* Quando il modulo SP ha già riconosciuto la voce, il
                             valore riconosciuto compare come segnaposto: il campo
                             resta vuoto e serve solo a sovrascrivere. */
                          const auto = c.auto ? dataset?.[a]?.sp?.[c.auto] : null;
                          return (
                            <td key={c.k} className="py-1 px-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={cella(a, c.k)}
                                placeholder={isNum(auto) ? fmt(auto) : "—"}
                                title={
                                  isNum(auto) && par.autoDaSP?.[a]?.[c.k] != null && String(cella(a, c.k)) === String(par.autoDaSP[a][c.k])
                                    ? `Compilato dal modulo SP (${fmt(auto)}): si aggiorna se cambia lo Stato Patrimoniale. Scrivi un altro valore per sostituirlo.`
                                    : isNum(auto) ? `Riconosciuto dal modulo SP: ${fmt(auto)}. Compila per sovrascrivere.` : c.nota
                                }
                                onChange={(e) => setCella(a, c.k, e.target.value)}
                                className="w-24 rounded px-2 py-1 text-xs tabular-nums"
                                style={{
                                  fontFamily: FONT_MONO,
                                  backgroundColor: CARD,
                                  border: `1px solid ${LINE}`,
                                  color: INK,
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {g.id === "patrimoniale" && (
                <p className="mt-1.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                  I valori in grigio sono già riconosciuti dalle voci del modulo SP in base alla denominazione
                  («Goodwill», «Property, plant and equipment», «Partecipazioni»…). Compila la cella solo per
                  sovrascriverli: il riconoscimento per nome è un aiuto, non un verdetto, e su schemi in lingue o
                  nomenclature inusuali può mancare il bersaglio.
                </p>
              )}
              {g.id === "liquidita" && (
                <p className="mt-1.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                  Lo schema a posizione finanziaria netta non distingue la cassa dagli altri impieghi né gli scoperti di
                  conto dagli altri debiti a breve: senza queste tre celle la Fase 3.1 usa proxy — la liquidità
                  dell'aggregato SP, i debiti finanziari a breve, e le passività a breve in senso stretto ottenute per
                  differenza togliendo scoperti e debiti di fornitura. Le proxy sono dichiarate sulla card di ciascun
                  indice: compilando le celle gli indici di liquidità severi diventano esatti.
                </p>
              )}
              {g.id === "assorbimento" && (
                <p className="mt-1.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                  Il rendiconto espone il servizio del debito in un unico aggregato e il capex come blocco monolitico:
                  senza queste celle la Fase 3.2 separa le componenti con delle stime — le quote capitale come differenza
                  fra servizio del debito e oneri finanziari, il capex di mantenimento come pari agli ammortamenti. Sono
                  approssimazioni ragionevoli ma grossolane: dove la Nota Integrativa fornisce il dettaglio, compilarlo
                  cambia sensibilmente gli indici di copertura e di solvibilità severa.
                </p>
              )}
              {g.id === "rettifiche" && (
                <p className="mt-1.5 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                  Crediti verso soci e azioni proprie figurano all'attivo ma non sono ricchezza a garanzia dei terzi: si
                  sottraggono al capitale netto. Le passività potenziali che l'analista ritiene non accantonate si
                  sommano al debito. Indica gli importi in valore assoluto — il segno lo applica l'applicazione.
                </p>
              )}
            </div>
          );
        })}

      {/* I parametri CAPM vivono ora nel sub-tab «4 · Dati Macro & CAPM»,
          insieme alle istruzioni su dove reperirli: un solo posto, non due
          serie di campi sullo stesso stato. */}
      <div
        className="mt-4 rounded-r px-3 py-2 text-[11px] leading-relaxed"
        style={{ fontFamily: FONT_BODY, backgroundColor: `${BLUE}0D`, borderLeft: `3px solid ${BLUE}`, color: INK }}
      >
        I parametri di mercato e di settore per il CAPM — tasso privo di rischio, ERP, beta levered, D/E e aliquota di
        settore — si inseriscono nel sub-tab <strong>«4 · Dati Macro &amp; CAPM»</strong>, dove trovi anche le istruzioni
        su dove reperirli.{" "}
        {compilatiCapm > 0 ? `Al momento ne risultano compilati ${compilatiCapm} su ${CAMPI_CAPM.length}.` : "Al momento non ne risulta compilato nessuno."}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   7-bis. INTEGRAZIONE DOCUMENTALE (Fase 1 · sub-tab 2)
   ═══════════════════════════════════════════════════════════════════════════
   Il bilancio integrale dell'impresa letto dall'IA per colmare i buchi di
   par.perAnno. La meccanica (configurazione provider, badge di stato, note
   diagnostiche) è quella del modulo Rendiconto Finanziario; cambia la
   destinazione dei dati — non rettifiche ai flussi, ma parametri di analisi —
   e cambia l'unità di caricamento.

   UN SOLO CARICAMENTO PER IMPRESA. Prima c'erano due caselle per esercizio,
   «Nota Integrativa» e «Relazione sulla Gestione»: una partizione che ha senso
   nel fascicolo italiano e nessuno in un Form 20-F o 10-K, dove i due
   contenuti stanno nello stesso documento insieme ai prospetti. Con tre
   esercizi in memoria quella griglia chiedeva sei caricamenti dello stesso
   file da duecento pagine, e sei analisi complete a pagamento per estrarre
   colonne che nel prospetto erano affiancate.

   Ora il documento è uno, l'analisi è una, e riempie in un colpo solo la
   tabella dei parametri di TUTTI gli esercizi in memoria. Di conseguenza lo
   stato di caricamento torna a essere un booleano unico e non più una mappa
   per anno: i riquadri per esercizio restano, ma come resoconto di ciò che
   l'estrazione ha trovato, non come punti di ingresso.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Numero → stringa nel formato accettato da `num()` (virgola decimale). */
const versoCampo = (n) =>
  Number(n).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 6 }).replace(".", ",");

const PROVIDER_IA = [
  ["claude", "Claude"],
  ["openai", "OpenAI"],
  ["gemini", "Google Gemini"],
];

function ConfigurazioneIA({ provider, onProvider, chiavi, onChiavi, modello, onModello, mostraChiave, onMostraChiave }) {
  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-center gap-3">
        <Label color={`${INK}90`}>🔑 Configurazione IA</Label>
        <div className="flex overflow-hidden rounded-md" style={{ border: `1px solid ${LINE}` }}>
          {PROVIDER_IA.map(([id, nome]) => (
            <button
              key={id}
              type="button"
              onClick={() => onProvider(id)}
              className="px-3 py-1 text-[11px] font-bold uppercase tracking-widest"
              style={{
                fontFamily: FONT_HEAD,
                backgroundColor: provider === id ? CARD : "transparent",
                color: provider === id ? INK : `${INK}70`,
              }}
            >
              {nome}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        {provider === "openai" ? (
          <>
            📄 Con <strong>OpenAI</strong> le pagine del PDF vengono convertite in immagini <strong>nel browser</strong>{" "}
            prima dell'invio: funzionano anche le scansioni e i file creati con «Stampa su PDF», privi di testo
            selezionabile. La conversione richiede qualche secondo e consuma più token rispetto a Claude e Gemini, che
            ricevono il PDF nel formato nativo — <strong>su documenti lunghi o senza testo preferisci quelli</strong>.
          </>
        ) : (
          <>
            📄 Se il PDF ha un layer di testo viene letto <strong>come testo</strong>, con i numeri di pagina conservati
            come marcatori; altrimenti viene inviato nel formato nativo e letto <strong>pagina per pagina</strong>, così
            funzionano anche le scansioni e i file creati con «Stampa su PDF».
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {provider === "claude" && AMBIENTE_AUTENTICA ? (
          <div
            className="flex min-w-[240px] flex-1 items-center rounded-md px-3 py-2 text-xs"
            style={{ fontFamily: FONT_BODY, border: `1px solid ${GREEN}`, backgroundColor: `${GREEN}0D`, color: GREEN }}
          >
            <span className="mr-2">✓</span>
            Claude autenticato dall'ambiente ospite — nessuna chiave da inserire
          </div>
        ) : (
          <div
            className="flex min-w-[240px] flex-1 items-center rounded-md px-3"
            style={{ border: `1px solid ${LINE}`, backgroundColor: CARD }}
          >
            <input
              type={mostraChiave ? "text" : "password"}
              value={chiavi[provider] || ""}
              onChange={(e) => onChiavi({ ...chiavi, [provider]: e.target.value })}
              placeholder={
                provider === "openai"
                  ? "sk-…"
                  : provider === "claude"
                  ? "sk-ant-… (chiave Anthropic, necessaria fuori da claude.ai)"
                  : "AIza…"
              }
              className="flex-1 bg-transparent py-2 text-xs outline-none"
              style={{ fontFamily: FONT_MONO, color: INK }}
              aria-label="Chiave API"
            />
            <button
              type="button"
              onClick={() => onMostraChiave(!mostraChiave)}
              style={{ color: `${INK}80` }}
              aria-label="Mostra chiave"
            >
              👁
            </button>
          </div>
        )}
        <input
          value={modello[provider]}
          onChange={(e) => onModello({ ...modello, [provider]: e.target.value })}
          className="w-56 rounded-md px-3 py-2 text-xs"
          style={{ fontFamily: FONT_MONO, backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}
          aria-label="Modello IA"
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
        La chiave resta in memoria per la sola sessione corrente: non viene salvata né inviata altrove. L'import dei
        JSON di riclassificazione e tutti i calcoli delle Fasi 2, 2.1, 3 e 4 sono locali e non usano l'IA.
      </p>
    </div>
  );
}

/** Riquadro di un singolo esercizio: resoconto di ciò che la lettura del
 *  bilancio integrale ha trovato per quell'anno. Non è un punto di ingresso —
 *  il caricamento è uno solo, in testa alla sezione. */
function RiquadroAnno({ anno, par, esito, stato, ttm = null }) {
  const valori = par?.perAnno?.[anno] || {};
  const compilati = CAMPI_INTEGRAZIONE.filter((c) => isNum(num(valori[c.parKey]))).length;
  /* Quanti dei valori esposti vengono dall'ultima estrazione: distingue il
     riquadro «riempito a mano nel sub-tab Base» da quello che il documento ha
     effettivamente coperto. */
  const daDocumento = esito ? Object.keys(esito).length : 0;

  return (
    <div className="rounded-md p-4" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-lg font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
          {ttm ? String(anno).replace(".", ",") : anno}
          {ttm && (
            <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: AMBER }}>
              {ttm.etichetta || "TTM"}
            </span>
          )}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}70` }}>
          {compilati} / {CAMPI_INTEGRAZIONE.length} parametri
          {daDocumento ? ` · ${daDocumento} dal documento` : ""}
        </div>
      </div>

      {ttm && (
        <div className="mt-1 text-[10px] leading-snug" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
          Dalla relazione infrannuale{ttm.dataRiferimento ? ` al ${ttm.dataRiferimento}` : ""}: stock alla data infrannuale, flussi sugli
          ultimi dodici mesi (esercizio {annoDa(ttm.esercizioBase) || Math.floor(ttm.chiave)} + progressivo − progressivo dell'anno prima).
        </div>
      )}
      {/* Riga di stato: un riquadro con filetto laterale, non un badge a
          pillola — il messaggio è spesso lungo e una pillola su quattro righe
          si legge male. */}
      {stato && (
        <div
          className="mt-2 rounded-r px-2.5 py-1.5 text-[11px] leading-snug"
          style={{
            fontFamily: FONT_BODY,
            backgroundColor: `${LEVEL_COLOR[stato.tipo] || BLUE}0F`,
            borderLeft: `3px solid ${LEVEL_COLOR[stato.tipo] || BLUE}`,
            color: INK,
          }}
        >
          {stato.msg}
        </div>
      )}

      {/* Recap dei parametri: si popola non appena l'estrazione termina. */}
      <table className="mt-3 w-full" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {CAMPI_INTEGRAZIONE.map((c) => {
            const grezzo = valori[c.parKey];
            const v = num(grezzo);
            const d = esito?.[c.parKey];
            return (
              <tr key={c.parKey} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="py-1.5 pr-2 align-top">
                  <div className="text-[11px] leading-tight" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
                    {c.label}
                  </div>
                  {d?.citazione && (
                    <div
                      className="mt-0.5 text-[10px] italic leading-snug"
                      style={{ fontFamily: FONT_BODY, color: `${INK}80` }}
                      title={d.citazione}
                    >
                      «{d.citazione.slice(0, 90)}
                      {d.citazione.length > 90 ? "…" : ""}»
                      {d.pagina ? ` · p. ${d.pagina}` : ""}
                      {d.confidenza ? ` · confidenza ${d.confidenza}` : ""}
                      {d.fonte ? ` · ${d.fonte}` : ""}
                    </div>
                  )}
                </td>
                <td
                  className="py-1.5 text-right align-top text-xs font-bold tabular-nums whitespace-nowrap"
                  style={{ fontFamily: FONT_MONO, color: isNum(v) ? INK : `${INK}60` }}
                >
                  {isNum(v) ? fmt(v) : "n.d."}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sub-tab 2 · Integrazione Documentale.
 * Il cuore è `processaDocumento(file)`: legge il bilancio integrale, interroga
 * il modello con il prompt multi-esercizio e riversa ciò che ha trovato in
 * `par.perAnno` — tutti gli esercizi in memoria — tramite `onPar`.
 */
function IntegrazioneDocumentale({ anni, par, onPar, meta, nomeTarget, documentiSuite = null, avvioIntegrazione = false, periodoTtm = null }) {
  /* Riquadri: il periodo TTM (se c'è) in testa, poi gli esercizi interi. */
  const chiaveTtm = periodoTtm && Number.isFinite(Number(periodoTtm.chiave)) ? Number(periodoTtm.chiave) : null;
  const riquadri = chiaveTtm != null ? [chiaveTtm, ...anni.filter((a) => Number(a) !== chiaveTtm)] : anni;
  /* ---- configurazione IA (identica al modulo di riferimento) ---- */
  const [provider, setProvider] = useState("claude");
  const [chiavi, setChiavi] = useState({ claude: "", openai: "", gemini: "" });
  const [mostraChiave, setMostraChiave] = useState(false);
  const [modello, setModello] = useState({
    claude: "claude-sonnet-4-6",
    openai: "gpt-4o-mini",
    gemini: "gemini-2.0-flash",
  });
  const apiKey = provider === "claude" ? chiavi.claude || "__subscription__" : chiavi[provider];
  /* Con Claude la chiave si può omettere SOLO dove è l'ambiente ospite ad
     autenticare. Altrove va inserita: dichiarare attivo un provider che poi
     rifiuta la prima richiesta trasforma un requisito mancante in un errore
     del modello, che è la diagnosi sbagliata. */
  const iaAttiva = (provider === "claude" && (AMBIENTE_AUTENTICA || IA_ESTERNA)) || !!chiavi[provider];

  /* ---- stato dell'unica estrazione in corso ----
     Un solo documento, una sola analisi: lo stato torna scalare. Le mappe per
     anno che restano — `statoIA` ed `esiti` — non sono stati di caricamento ma
     il resoconto per esercizio di ciò che quell'unica lettura ha prodotto. */
  const [inCorso, setInCorso] = useState(false);
  const [avanzamento, setAvanzamento] = useState(null); // { fase, fatte, totali }
  const [statoGenerale, setStatoGenerale] = useState(null); // { tipo, msg }
  const [documento, setDocumento] = useState(null); // { nome, pagine, porzioni, profilo, via, schema, valuta, unita }
  const [statoIA, setStatoIA] = useState({}); // { [anno]: { tipo, msg } }
  const [esiti, setEsiti] = useState({}); // { [anno]: { [parKey]: { citazione, pagina, … } } }
  const [note, setNote] = useState([]);
  /* Sui fascicoli lunghi si analizzano per default le sole pagine contabili.
     La spunta esiste perché il criterio, per quanto generoso, resta un
     euristico: se manca un valore che l'analista sa esserci, deve poter
     rileggere il documento intero senza cambiare nulla d'altro. */
  const [soloPagineContabili, setSoloPagineContabili] = useState(true);

  const aggiungiNote = (righe) => {
    if (righe.length) setNote((prev) => [...righe, ...prev].slice(0, 10));
  };

  /**
   * Legge il bilancio integrale e inietta i parametri trovati in par.perAnno,
   * per TUTTI gli esercizi in memoria. Una sola lettura, una sola spesa.
   * @param {File} file
   */
  const processaDocumento = async (file) => {
    if (!file) return;
    if (!anni.length) {
      setStatoGenerale({ tipo: "bad", msg: "Nessun esercizio in memoria: carica prima le riclassificazioni." });
      return;
    }
    if (!iaAttiva) {
      setStatoGenerale({ tipo: "bad", msg: "Attiva un provider IA per estrarre dal documento." });
      return;
    }

    setInCorso(true);
    setStatoIA({});
    setAvanzamento({ fase: "Lettura del file", fatte: 0, totali: 0 });
    setStatoGenerale({ tipo: "info", msg: `Lettura di «${file.name}»…` });

    try {
      const fonte = await preparaFonte(
        file,
        provider,
        (fatte, totali) => setAvanzamento({ fase: "Preparazione del documento", fatte, totali, unita: "pagine" }),
        { soloPagineContabili }
      );

      const via = fonte.tipo === "testoPaginato" ? "testo selezionabile" : fonte.tipo === "pdf" ? "PDF nativo" : "testo";
      setDocumento({
        nome: file.name,
        pagine: fonte.nPagine ?? fonte.sonda?.pagine ?? null,
        porzioni: fonte.chunks?.length ?? 1,
        profilo: fonte.piano?.profilo || null,
        via,
        analizzate: fonte.filtro?.applicata ? fonte.filtro.tenute : null,
      });

      /* Gli avvisi diagnostici (assenza del layer di testo, suddivisione
         forzata, provider inadatto) devono raggiungere l'analista PRIMA dei
         risultati: spiegano in anticipo perché l'estrazione potrà essere
         parziale. */
      if (fonte.avvisi?.length) aggiungiNote(fonte.avvisi);

      /* Valori già noti: servono al modello solo come ordine di grandezza
         per accorgersi di eventuali incoerenze, non come risposta. */
      const gia = {};
      (chiaveTtm != null ? [...anni, chiaveTtm] : anni).forEach((a) => {
        CAMPI_INTEGRAZIONE.forEach((c) => {
          const v = num(par?.perAnno?.[a]?.[c.parKey]);
          if (isNum(v)) gia[`${a} · ${c.label}`] = fmt(v);
        });
      });

      const intestazione = buildIntegrazionePrompt(anni, {
        azienda: meta?.azienda,
        valuta: meta?.valuta,
        unita: meta?.unita,
        gia,
        ttm: chiaveTtm != null ? periodoTtm : null,
      });

      const risultati = await eseguiSuFonte({
        provider,
        apiKey,
        model: modello[provider],
        fonte,
        costruisciPrompt: (t) =>
          intestazione +
          (t
            ? `\n\nTESTO DEL BILANCIO (i marcatori [[ pagina N ]] indicano la pagina del documento originale):\n"""\n${t}\n"""`
            : `\n\nIl documento da analizzare è il PDF ALLEGATO a questo messaggio: leggilo direttamente, pagina per pagina, comprese le tabelle.`),
        onPorzione: (fatte, tot, info = {}) => {
          if (info.attesaRipresa) {
            setAvanzamento({
              fase: `Attesa prima di riprovare ${info.mancanti} porzione/i`,
              fatte,
              totali: tot,
              unita: "porzioni",
            });
            return;
          }
          setAvanzamento({
            fase: info.ripresa ? "Ripresa delle porzioni non lette" : "Analisi del documento",
            fatte,
            totali: tot,
            unita: "porzioni",
          });
        },
        onRitento: (n, pausa) =>
          setStatoGenerale({
            tipo: "info",
            msg: `Il modello è momentaneamente congestionato: nuovo tentativo ${n} fra ${(pausa / 1000).toFixed(1)}s. Il ritmo delle richieste si allarga da sé.`,
          }),
        onAvviso: (msg) => aggiungiNote([msg]),
      });

      /* ---- fusione delle porzioni, un esercizio per volta ----
         La stessa grandezza può comparire in porzioni diverse (le pagine
         sovrapposte, o il prospetto ripreso nelle note): `fondiNumero` prende
         il primo valore utile, preferendo i non-zero. */
      const dettagliPerAnno = {};
      const patchPerAnno = {};
      const conteggi = [];

      anni.forEach((a) => {
        const dettagli = {};
        const patch = {};
        CAMPI_INTEGRAZIONE.forEach((c) => {
          const base = `esercizi.${a}.${c.jsonKey}`;
          const scelto = bloccoMigliore(risultati, base, (o) => Number.isFinite(Number(o.valore)));
          if (!scelto) return;
          const v = Number(scelto.valore);
          const pagina = Number(scelto.pagina);
          const citazione = scelto.citazione;
          const confidenza = scelto.confidenza;
          patch[c.parKey] = versoCampo(c.parKey === "numeroAzioni" ? azioniInMilioni(v) : v);
          dettagli[c.parKey] = {
            pagina: Number.isFinite(pagina) ? pagina : null,
            citazione: typeof citazione === "string" ? citazione : "",
            confidenza: typeof confidenza === "string" ? confidenza : "",
            fonte: file.name,
          };
        });
        const quanti = Object.keys(patch).length;
        conteggi.push({ anno: a, quanti });
        if (quanti) {
          patchPerAnno[a] = patch;
          dettagliPerAnno[a] = dettagli;
        }
      });

      /* ---- periodo TTM: blocco «infrannuale» ----
         Accettato solo con la data di riferimento letta nel documento e, se il
         TTM ne dichiara una, nello stesso mese: è la difesa contro un bilancio
         annuale scambiato per una relazione infrannuale. */
      let statoTtm = null;
      if (chiaveTtm != null) {
        const letta = fondiScalare(risultati, "infrannuale.dataRiferimento");
        const meseDi = (d) => {
          const t = String(d || "");
          const m = t.match(/(\d{4})-(\d{1,2})/) || t.match(/(\d{1,2})[/.-](\d{4})$/);
          if (m) return m[1].length === 4 ? `${m[1]}-${Number(m[2])}` : `${m[2]}-${Number(m[1])}`;
          const mm = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
          return mm ? `${mm[3]}-${Number(mm[2])}` : null;
        };
        const atteso = meseDi(periodoTtm.dataRiferimento);
        const trovato = meseDi(letta);
        const [aA, mA] = String(atteso || "").split("-").map(Number);
        const [aT, mT] = String(trovato || "").split("-").map(Number);
        const stessoMese = !!atteso && !!trovato && mA === mT && Math.abs(aA - aT) <= 1;
        const annoDiverso = stessoMese && aA !== aT;
        const blocco = CAMPI_INTEGRAZIONE.some((c) => leggiPercorso(risultati.find((r) => leggiPercorso(r, `infrannuale.${c.jsonKey}`)) || {}, `infrannuale.${c.jsonKey}`));
        if (!blocco) {
          statoTtm = { tipo: "warn", msg: `Il documento non è una relazione infrannuale${periodoTtm.dataRiferimento ? ` al ${periodoTtm.dataRiferimento}` : ""}: per questo periodo carica la trimestrale o semestrale (10-Q, half-year report).` };
        } else if (!letta) {
          statoTtm = { tipo: "warn", msg: "Valori infrannuali scartati: il documento non dichiara la data di riferimento del periodo." };
        } else if (atteso && trovato && !stessoMese) {
          statoTtm = { tipo: "warn", msg: `Valori infrannuali scartati: il documento è al ${letta}, il periodo TTM al ${periodoTtm.dataRiferimento}.` };
        } else {
          const base = annoDa(periodoTtm.esercizioBase) || Math.floor(chiaveTtm);
          const dettagli = {};
          const patch = {};
          const senzaBase = [];
          CAMPI_INTEGRAZIONE.forEach((c) => {
            const radice = `infrannuale.${c.jsonKey}`;
            const conValore = bloccoMigliore(risultati, radice, (o) => Number.isFinite(Number(o.valore)));
            const conProgressivi = !conValore && FLUSSI_INTEGRAZIONE.has(c.jsonKey)
              ? bloccoMigliore(risultati, radice, (o) => Number.isFinite(Number(o.ytd)) && Number.isFinite(Number(o.ytdPrecedente)))
              : null;
            const scelto = conValore || conProgressivi;
            let v = conValore ? Number(conValore.valore) : NaN;
            let calcolo = "";
            if (conProgressivi) {
              const ytd = Number(conProgressivi.ytd);
              const ytdPrec = Number(conProgressivi.ytdPrecedente);
              {
                const fy = num(patchPerAnno[base]?.[c.parKey] ?? par?.perAnno?.[base]?.[c.parKey]);
                if (isNum(fy)) {
                  v = fy + ytd - ytdPrec;
                  calcolo = `${base} ${fmt(fy)} + progressivo ${fmt(ytd)} − progressivo anno prima ${fmt(ytdPrec)}`;
                } else senzaBase.push(c.label);
              }
            }
            if (!Number.isFinite(v)) return;
            const pagina = Number(scelto?.pagina);
            const citazione = scelto?.citazione;
            const confidenza = scelto?.confidenza;
            patch[c.parKey] = versoCampo(c.parKey === "numeroAzioni" ? azioniInMilioni(v) : v);
            dettagli[c.parKey] = {
              pagina: Number.isFinite(pagina) ? pagina : null,
              citazione: calcolo ? `TTM = ${calcolo}${typeof citazione === "string" && citazione ? ` · ${citazione}` : ""}` : typeof citazione === "string" ? citazione : "",
              confidenza: typeof confidenza === "string" ? confidenza : "",
              fonte: file.name,
            };
          });
          const quanti = Object.keys(patch).length;
          conteggi.push({ anno: chiaveTtm, quanti, ttm: true });
          if (quanti) {
            patchPerAnno[chiaveTtm] = patch;
            dettagliPerAnno[chiaveTtm] = dettagli;
          }
          statoTtm = quanti
            ? { tipo: senzaBase.length || annoDiverso ? "warn" : "ok", msg: `${quanti} parametri del periodo infrannuale al ${letta}.${annoDiverso ? ` ⚠ Il file TTM dichiara la data ${periodoTtm.dataRiferimento}: stesso mese, anno diverso; probabilmente è il file TTM ad avere l'anno sbagliato, controllalo.` : ""}${senzaBase.length ? ` Senza il valore dell'esercizio ${base} non si calcolano i dodici mesi di: ${senzaBase.join(", ")} (analizza prima il bilancio ${base}).` : ""}` }
            : { tipo: "warn", msg: `Relazione al ${letta}: nessun parametro estraibile con certezza.` };
        }
      }

      /* Un solo aggiornamento funzionale per tutti gli esercizi: scriverne uno
         per anno esporrebbe a sovrascritture fra chiamate ravvicinate. */
      if (Object.keys(patchPerAnno).length) {
        onPar((prev) => {
          const perAnno = { ...(prev.perAnno || {}) };
          Object.entries(patchPerAnno).forEach(([a, patch]) => {
            perAnno[a] = { ...(perAnno[a] || {}), ...patch };
          });
          return { perAnno };
        });
        setEsiti((prev) => {
          const next = { ...prev };
          Object.entries(dettagliPerAnno).forEach(([a, d]) => {
            next[a] = { ...(next[a] || {}), ...d };
          });
          return next;
        });
      }

      /* ---- diagnostica di lettura ---- */
      const unitaDoc = fondiScalare(risultati, "unita");
      const schemaDoc = fondiScalare(risultati, "schema");
      const troncato = qualcheTroncamento(risultati);
      const presenti = [
        ...new Set(
          fondiArray(risultati, "eserciziPresenti")
            .map((e) => annoDa(e))
            .filter(Boolean)
        ),
      ].sort((a, b) => b - a);
      const noteIa = fondiArray(risultati, "note").filter((n) => typeof n === "string" && n.trim());
      aggiungiNote(noteIa);

      setDocumento((d) => ({ ...(d || {}), schema: schemaDoc || null, valuta: fondiScalare(risultati, "valuta") || null, unita: unitaDoc || null, presenti }));

      /* Stato per esercizio: un riquadro a zero parametri non è un riquadro
         «in attesa», è un esito — e la ragione più frequente è che quell'anno
         nel documento non c'è. */
      const statiAnno = {};
      if (statoTtm) statiAnno[chiaveTtm] = statoTtm;
      conteggi.forEach(({ anno: a, quanti, ttm }) => {
        if (ttm) return;
        if (quanti) {
          statiAnno[a] = { tipo: "ok", msg: `${quanti} parametri estratti dal documento.` };
        } else if (presenti.length && !presenti.includes(Number(a))) {
          statiAnno[a] = {
            tipo: "warn",
            msg: `Il documento non espone l'esercizio ${a} (contiene ${presenti.join(", ")}): carica il fascicolo degli esercizi anteriori.`,
          };
        } else {
          statiAnno[a] = { tipo: "warn", msg: "Nessun parametro estraibile con certezza per questo esercizio." };
        }
      });
      setStatoIA(statiAnno);

      /* Copertura effettiva: un'estrazione condotta su 4 porzioni su 7 non è
         un'estrazione riuscita, ed è un'informazione che deve stare accanto al
         risultato, non solo fra le note. */
      const falliti = risultati.__falliti || [];
      const totPorzioni = risultati.__totPorzioni || 1;
      const copertura = falliti.length
        ? ` ⚠ ${falliti.length} porzione/i su ${totPorzioni} non analizzata/e (pagine ${falliti
            .map((f) => f.intervallo)
            .join(", ")}): la ricerca non ha coperto tutto il documento.`
        : "";
      const schemaLetto =
        schemaDoc && String(schemaDoc).trim() && !/^null$/i.test(String(schemaDoc).trim())
          ? ` Schema riconosciuto: ${schemaDoc}.`
          : "";
      /* L'unità si segnala solo quando è una scala (migliaia, milioni): in quel
         caso il numero estratto non è confrontabile con quelli delle
         riclassificazioni senza una verifica. */
      const scala = /migliaia|milioni|thousand|million|\bk\b|mln/i.test(String(unitaDoc || ""));
      const totaleTrovati = conteggi.reduce((s, c) => s + c.quanti, 0);
      const riepilogo = conteggi.map((c) => `${c.ttm ? periodoTtm.etichetta || String(c.anno).replace(".", ",") : c.anno}: ${c.quanti}`).join(" · ");

      const esitoFinale = {
        tipo: !totaleTrovati ? "warn" : falliti.length || troncato ? "warn" : "ok",
        trovati: totaleTrovati,
        msg: !totaleTrovati
          ? `Documento analizzato su ${totPorzioni} porzioni: nessun parametro è risultato estraibile con certezza.${schemaLetto}${copertura}`
          : `${totaleTrovati} parametri estratti su ${conteggi.length} periodi (${riepilogo}) da ${totPorzioni} porzioni.${schemaLetto}${
              scala ? ` Documento espresso in ${unitaDoc}: valori convertiti in ${meta?.unita || "milioni"}.` : ""
            }${troncato ? " ⚠ Una risposta è stata riparata da troncamento: alcuni valori potrebbero mancare." : ""}${copertura}`,
      };
      setStatoGenerale(esitoFinale);
      return esitoFinale;
    } catch (e) {
      console.error("Analisi del documento non riuscita:", e);
      const esitoErr = { tipo: "bad", trovati: 0, msg: `Analisi non riuscita: ${e.message || e}` };
      setStatoGenerale(esitoErr);
      return esitoErr;
    } finally {
      setInCorso(false);
      setAvanzamento(null);
    }
  };

  /* ---- Documenti ricevuti dalla suite di riclassificazione ----
     Tutti i file caricati all'inizio (prospetti, Nota Integrativa, Relazione
     sulla Gestione di ogni esercizio) vengono analizzati uno dopo l'altro.
     Ordine: dal più recente al più remoto e, nello stesso esercizio, RG →
     prospetti → NI. Ogni documento porta anche la colonna comparativa e un
     valore trovato dopo sostituisce quello precedente: così ogni esercizio
     resta con i valori letti nei SUOI documenti, e fra questi prevale la Nota
     Integrativa, dove le grandezze cercate sono esposte in dettaglio. */
  const PESO_TIPO = { rg: 0, prospetti: 1, ni: 2 };
  /* La relazione infrannuale del TTM va per ultima: i dodici mesi si calcolano
     dall'esercizio base, che deve essere già stato letto. */
  const documentiOrdinati = useMemo(
    () =>
      [...(documentiSuite || [])].sort(
        (a, b) => (a.tipo === "infrannuale") - (b.tipo === "infrannuale") ||
          (Number(b.anno) || 0) - (Number(a.anno) || 0) || (PESO_TIPO[a.tipo] ?? 1) - (PESO_TIPO[b.tipo] ?? 1)
      ),
    [documentiSuite]
  );
  const [esitiSuite, setEsitiSuite] = useState({}); // { [indice]: { tipo, msg, trovati } | { tipo: "corso" } }
  const [lottoInCorso, setLottoInCorso] = useState(false);
  const lottoRef = useRef(false);
  const avviatoRef = useRef(false);

  const analizzaTutti = async () => {
    if (lottoRef.current || !documentiOrdinati.length) return;
    lottoRef.current = true;
    setLottoInCorso(true);
    setEsitiSuite({});
    const token = {}; // un'analisi di un'istanza smontata non tocca lo stato della nuova
    STATO_LOTTO = { avviato: true, inCorso: true, finito: false, fatti: 0, totale: documentiOrdinati.length, bloccante: "", token };
    try {
      for (let i = 0; i < documentiOrdinati.length; i++) {
        setEsitiSuite((p) => ({ ...p, [i]: { tipo: "corso" } }));
        const e = await processaDocumento(documentiOrdinati[i].file);
        setEsitiSuite((p) => ({ ...p, [i]: e || { tipo: "bad", msg: "non analizzato" } }));
        if (STATO_LOTTO.token === token) STATO_LOTTO = { ...STATO_LOTTO, fatti: i + 1 };
        if (e?.tipo === "bad" && /non è (raggiungibile|stato autorizzato)|non è disponibile|Limite di utilizzo/i.test(e.msg)) { if (STATO_LOTTO.token === token) STATO_LOTTO = { ...STATO_LOTTO, bloccante: e.msg }; break; }
      }
    } finally {
      lottoRef.current = false;
      setLottoInCorso(false);
      if (STATO_LOTTO.token === token) STATO_LOTTO = { ...STATO_LOTTO, inCorso: false, finito: true };
    }
  };

  /* Avvio automatico, una volta, appena le riclassificazioni sono in memoria. */
  useEffect(() => {
    if (!avvioIntegrazione || avviatoRef.current || !documentiOrdinati.length || !anni.length || !iaAttiva) return;
    avviatoRef.current = true;
    analizzaTutti();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avvioIntegrazione, documentiOrdinati, anni.length, iaAttiva]);

  const ETICHETTA_TIPO = { prospetti: "Prospetti", ni: "Nota Integrativa", rg: "Relazione sulla Gestione", infrannuale: "Relazione infrannuale (TTM)" };
  const trovatiLotto = Object.values(esitiSuite).reduce((s, e) => s + (e?.trovati || 0), 0);
  const fattiLotto = Object.values(esitiSuite).filter((e) => e && e.tipo !== "corso").length;

  return (
    <div className="space-y-6">
      {documentiOrdinati.length > 0 && (
        <SectionCard
          titolo={`Documenti caricati nella suite · ${documentiOrdinati.length}`}
          eyebrow="Integrazione documentale automatica"
          accento={AMBER}
          toolbar={
            <button
              type="button"
              onClick={analizzaTutti}
              disabled={lottoInCorso || inCorso || !iaAttiva || !anni.length}
              className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest disabled:opacity-40"
              style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF" }}
            >
              {lottoInCorso ? `⏳ ${fattiLotto}/${documentiOrdinati.length} analizzati` : fattiLotto ? "↻ Rianalizza tutti" : "▶ Analizza tutti"}
            </button>
          }
        >
          <p className="text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            Sono i documenti che hai caricato all'inizio per le riclassificazioni. Vengono letti uno dopo l'altro, dal più
            recente al più remoto; in ogni esercizio la Nota Integrativa è letta per ultima, così i suoi valori prevalgono.
            {!anni.length && " In attesa delle riclassificazioni in memoria."}
            {lottoInCorso || fattiLotto ? ` Parametri trovati finora: ${trovatiLotto}.` : ""}
          </p>
          <ol className="mt-3 space-y-1.5">
            {documentiOrdinati.map((d, i) => {
              const e = esitiSuite[i];
              const colore = !e ? `${INK}60` : e.tipo === "corso" ? BLUE : e.tipo === "ok" ? GREEN : e.tipo === "bad" ? RED : AMBER;
              return (
                <li key={`${d.anno}-${d.tipo}-${d.file?.name}`} className="flex flex-wrap items-baseline gap-2 text-xs" style={{ fontFamily: FONT_BODY, color: INK }}>
                  <span className="rounded px-1.5 py-0.5 tabular-nums" style={{ fontFamily: FONT_MONO, backgroundColor: PAPER }}>{d.anno}</span>
                  <strong>{ETICHETTA_TIPO[d.tipo] || d.tipo}</strong>
                  <span style={{ color: `${INK}90` }}>{d.file?.name}</span>
                  <span className="ml-auto" style={{ color: colore }}>
                    {!e ? "in attesa" : e.tipo === "corso" ? "analisi in corso…" : e.tipo === "bad" ? e.msg : `${e.trovati} parametri`}
                  </span>
                  {!lottoInCorso && !inCorso && (
                    <button type="button" onClick={async () => {
                      setEsitiSuite((p) => ({ ...p, [i]: { tipo: "corso" } }));
                      const r = await processaDocumento(d.file);
                      setEsitiSuite((p) => ({ ...p, [i]: r }));
                    }} disabled={!iaAttiva || !anni.length} className="text-[10px] font-bold uppercase tracking-widest disabled:opacity-40" style={{ fontFamily: FONT_HEAD, color: AMBER }}>
                      Analizza
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </SectionCard>
      )}
      <SectionCard
        titolo="Integrazione documentale · Bilancio integrale dell'impresa"
        eyebrow={`Parametri mancanti · ${nomeTarget}`}
        accento={AMBER}
      >
        <div className="rounded-md p-4" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
          <p className="text-sm font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
            📑 {CAMPI_INTEGRAZIONE.length} grandezze che le riclassificazioni non espongono
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            I moduli SP / CE / RF si fermano agli aggregati: il <strong>costo del lavoro</strong> è dentro i costi
            operativi, il <strong>fondo ammortamento cumulato</strong> non compare affatto in uno stato patrimoniale
            riclassificato a valori netti e il <strong>saldo della gestione non corrente</strong> è disperso fra le
            componenti straordinarie. Sono però proprio i valori che sbloccano CLUP e reddito per addetto, capitale
            investito lordo e tasso lordo di redditività, la depurazione del reddito operativo dalle poste non
            ricorrenti, e — attraverso duration del debito, fair value dei finanziamenti e capitalizzazione di borsa —
            i pesi del WACC. Ogni valore resta <strong>modificabile a mano</strong> nel sub-tab «1 · Base»:
            l'estrazione precompila, non decide.
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            ⚖ <strong>Ciò che nessun bilancio contiene.</strong> La <strong>quota di costi variabili</strong> è
            richiesta al documento, ma va trovata solo se il management commenta davvero la struttura di costo: la
            distinzione fra fisso e variabile è gestionale e nessuno schema pubblico la impone. Quando manca, il
            riquadro di <strong>separazione per regressione</strong> nel sub-tab «1 · Base» la ricava dalla serie
            storica. Restano fuori dalla portata del fascicolo i parametri di mercato — tasso privo di rischio, premio
            per il rischio, beta e D/E di settore, grado di leva operativa del comparto — che si indicano nel sub-tab
            «4 · Dati macro & CAPM» e che per questo l'estrazione non chiede né inventa.
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            🌍 <strong>Un solo caricamento per impresa.</strong> Carica il fascicolo INTEGRALE — Form 20-F o 10-K,
            Annual Report, bilancio consolidato IFRS, fascicolo ex art. 2427 c.c., in italiano o in inglese — e
            l'estrazione riempie in un colpo solo i parametri di{" "}
            <strong>tutti gli esercizi in memoria{anni.length ? ` (${anni.join(", ")})` : ""}</strong>: nei prospetti le
            colonne comparative sono già affiancate, e rileggere duecento pagine una volta per anno sarebbe la stessa
            lettura pagata tre volte. La ricerca conosce sia le voci del codice civile sia la nomenclatura IFRS/US-GAAP
            («employee benefits expense», «accumulated depreciation», «other income and expenses, net») e riconosce le
            convenzioni anglosassoni sui numeri — virgola come separatore delle migliaia, parentesi per i negativi.
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            📚 <strong>Documenti oltre le duecento pagine.</strong> Il fascicolo viene suddiviso in porzioni tanto più
            corte quanto più è lungo, con alcune pagine ripetute a cavallo così che un prospetto spezzato resti integro
            almeno una volta. Se il PDF ha un layer di testo selezionabile — quasi tutti i filing SEC — viene letto come
            testo anziché come immagine: stesso contenuto, un ordine di grandezza in meno di token. Le richieste sono
            distanziate da un regolatore che allarga il passo appena il provider segnala congestione, e le porzioni non
            lette vengono riprovate una seconda volta prima di dichiararle mancanti.
          </p>
        </div>

        <div className="mt-4">
          <ConfigurazioneIA
            provider={provider}
            onProvider={setProvider}
            chiavi={chiavi}
            onChiavi={setChiavi}
            modello={modello}
            onModello={setModello}
            mostraChiave={mostraChiave}
            onMostraChiave={setMostraChiave}
          />
        </div>

        {anni.length === 0 ? (
          <div
            className="mt-4 rounded-md border border-dashed p-10 text-center"
            style={{ borderColor: "#C4C9BF", backgroundColor: CARD }}
          >
            <p className="font-semibold" style={{ fontFamily: FONT_HEAD, color: INK }}>
              Nessun esercizio in memoria
            </p>
            <p className="mt-1 text-sm" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Carica prima le riclassificazioni nel sub-tab «1 · Base»: gli esercizi da integrare vengono dedotti da lì,
              non digitati a mano.
            </p>
          </div>
        ) : (
          <>
            {/* Caricamento unico: un documento, tutti gli esercizi. */}
            <div className="mt-4">
              <Dropzone
                titolo={
                  inCorso
                    ? "Analisi in corso — attendi il completamento"
                    : `Trascina qui il bilancio integrale di ${nomeTarget}, oppure`
                }
                etichettaBottone={inCorso ? "⏳ Analisi in corso…" : chiaveTtm != null ? "📄 Carica il bilancio integrale o la relazione infrannuale (10-Q, semestrale…)" : "📄 Carica il bilancio integrale (20-F, 10-K, Annual Report…)"}
                accept=".pdf,.txt,.md,.json"
                accento={AMBER}
                disabilitato={inCorso || !iaAttiva}
                onFiles={(files) => processaDocumento(files?.[0])}
              >
                Un unico file per l'impresa. Anche 200+ pagine: la suddivisione, il ritmo delle richieste e il recupero
                delle porzioni non lette sono automatici.{" "}
                {chiaveTtm != null && (
                  <>Per il periodo {periodoTtm.etichetta || "TTM"} carica la relazione trimestrale o semestrale
                  {periodoTtm.dataRiferimento ? ` al ${periodoTtm.dataRiferimento}` : ""}: compila il suo riquadro.{" "}</>
                )}
                {!iaAttiva && (
                  <strong style={{ color: RED }}>Inserisci prima la chiave del provider selezionato.</strong>
                )}
              </Dropzone>

              {/* Ambito della lettura. Sta sotto la dropzone perché è una scelta
                  che si fa sul documento, non sul provider. */}
              <label
                className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed"
                style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}
              >
                <input
                  type="checkbox"
                  checked={soloPagineContabili}
                  onChange={(e) => setSoloPagineContabili(e.target.checked)}
                  disabled={inCorso}
                  className="mt-0.5 shrink-0"
                  style={{ accentColor: AMBER }}
                />
                <span>
                  <strong style={{ color: INK }}>Analizza le sole pagine contabili</strong> (consigliato sui fascicoli
                  oltre le 60 pagine). Prospetti, note e tabelle di valori vengono letti; i fattori di rischio, la
                  governance e la descrizione dell'attività no. Su un Form 20-F riduce la lettura a circa un terzo delle
                  pagine. Togli la spunta per rileggere il documento <em>integrale</em> quando manca un valore che sai
                  esserci.
                </span>
              </label>
            </div>

            {/* Avanzamento: porzione per porzione, con la fase dichiarata. Un
                documento lungo impiega minuti, e una barra ferma senza etichetta
                è indistinguibile da un blocco. */}
            {avanzamento && (
              <div className="mt-3 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: INK }}>
                    {avanzamento.fase}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}A0` }}>
                    {avanzamento.totali
                      ? `${avanzamento.fatte} / ${avanzamento.totali} ${avanzamento.unita || ""}`
                      : "…"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: LINE }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${avanzamento.totali ? Math.round((avanzamento.fatte / avanzamento.totali) * 100) : 4}%`,
                      backgroundColor: AMBER,
                      transition: "width 200ms ease",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Esito complessivo della lettura, prima del dettaglio per anno. */}
            {statoGenerale && (
              <div
                className="mt-3 rounded-r px-3 py-2 text-[11px] leading-snug"
                style={{
                  fontFamily: FONT_BODY,
                  backgroundColor: `${LEVEL_COLOR[statoGenerale.tipo] || BLUE}0F`,
                  borderLeft: `3px solid ${LEVEL_COLOR[statoGenerale.tipo] || BLUE}`,
                  color: INK,
                }}
              >
                {statoGenerale.msg}
              </div>
            )}

            {/* Carta d'identità del documento letto: dice CHE COSA è stato
                percorso, che è il presupposto per fidarsi di ciò che manca. */}
            {documento && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge level="info">{documento.nome}</Badge>
                {documento.pagine ? <Badge level="info">{documento.pagine} pagine</Badge> : null}
                {documento.analizzate ? (
                  <Badge level="warn">{`${documento.analizzate} pagine contabili analizzate`}</Badge>
                ) : null}
                <Badge level="info">
                  {documento.porzioni} porzion{documento.porzioni === 1 ? "e" : "i"} · letto come {documento.via}
                </Badge>
                {documento.profilo && <Badge level="info">{documento.profilo}</Badge>}
                {documento.schema && <Badge level="info">schema {documento.schema}</Badge>}
                {documento.unita && <Badge level="warn">{`importi in ${documento.unita}`}</Badge>}
                {documento.presenti?.length ? (
                  <Badge level="ok">{`esercizi nel documento: ${documento.presenti.join(", ")}`}</Badge>
                ) : null}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {riquadri.map((a) => (
                <RiquadroAnno key={a} anno={a} par={par} esito={esiti[a]} stato={statoIA[a]} ttm={Number(a) === chiaveTtm ? periodoTtm : null} />
              ))}
            </div>
          </>
        )}

        {note.length > 0 && (
          <div className="mt-4 rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Note dell'estrazione</Label>
            <ul className="mt-2 space-y-1">
              {note.map((n, i) => (
                <li key={i} className="text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                  · {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7-ter. DATI MACRO E DI SETTORE · PARAMETRI CAPM (Fase 1 · sub-tab 4)
   ═══════════════════════════════════════════════════════════════════════════
   Ke = Rf + β × ERP. Nessuno dei tre addendi sta in un bilancio: vanno
   reperiti fuori, e questa sezione esiste per dire ALL'UTENTE DOVE, invece di
   lasciargli sei campi vuoti da riempire a intuito. Due percorsi alternativi
   che scrivono sullo stesso stato (`par.capm`): le medie pubblicate di un
   database (Opzione 1) oppure un peer group ristretto costruito a mano
   (Opzione 2). La matematica del CAPM non è qui: sta nella Fase 2.1
   (`depurazioneBeta`, `PassaggiBeta`) e, per il WACC, nella Fase 3.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Riquadro delle istruzioni operative: passi numerati o puntati. */
function BoxIstruzioni({ titolo, passi, accento = INK }) {
  return (
    <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
      <Label color={`${accento}C0`}>{titolo}</Label>
      <ol className="mt-2 space-y-2">
        {passi.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums"
              style={{ fontFamily: FONT_MONO, backgroundColor: `${accento}1A`, color: accento }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
              {p}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Un campo CAPM: etichetta, sigla, input e provenienza attesa del dato. */
function CampoCapm({ campo, valore, onChange, evidenzia = false, nota = null, azione = null }) {
  const compilato = isNum(num(valore));
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}>
          {campo.label}
        </span>
        <span className="text-[10px]" style={{ fontFamily: FONT_MONO, color: `${INK}60` }}>
          {campo.sigla}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={valore ?? ""}
          placeholder={campo.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded px-2 py-1 text-xs tabular-nums"
          style={{
            fontFamily: FONT_MONO,
            backgroundColor: CARD,
            border: `1px solid ${evidenzia ? AMBER : compilato ? `${GREEN}80` : LINE}`,
            color: INK,
          }}
        />
        {campo.unita && (
          <span className="text-xs" style={{ fontFamily: FONT_MONO, color: `${INK}80` }}>
            {campo.unita}
          </span>
        )}
      </span>
      <span className="text-[10px] leading-snug" style={{ fontFamily: FONT_BODY, color: `${INK}70` }}>
        {campo.fonte}
      </span>
      {nota && (
        <span className="text-[10px] leading-snug font-semibold" style={{ fontFamily: FONT_BODY, color: AMBER }}>
          ⚙ {nota}
        </span>
      )}
      {azione && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); azione.onClick(); }}
          className="self-start text-[10px] font-semibold underline"
          style={{ fontFamily: FONT_BODY, color: AMBER }}
        >
          {azione.testo}
        </button>
      )}
    </label>
  );
}

/* ---------------------------------------------------------------------------
   ESTRAZIONE SIMULATA DAI BILANCI DEI CONCORRENTI
   ---------------------------------------------------------------------------
   ⚠ Questa funzione NON legge i PDF: produce numeri verosimili a partire dal
   nome del file, in modo deterministico, per far provare il flusso. È il mock
   richiesto in specifica, e l'interfaccia lo dichiara apertamente perché un
   D/E inventato che entra nel beta senza avvisi sarebbe indistinguibile da un
   D/E estratto davvero.

   Per passare all'estrazione vera basta sostituire il corpo con la stessa
   coppia già usata dall'Integrazione Documentale — `preparaFonte(file,
   provider)` seguito da `eseguiSuFonte({ …, costruisciPrompt })` con un
   prompt che chieda PFN, patrimonio netto e aliquota effettiva — e leggere i
   valori con `fondiNumero`. La forma del risultato qui sotto è già quella che
   servirebbe.
   --------------------------------------------------------------------------- */
function impronta(testo) {
  let h = 2166136261;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Media aritmetica su un elenco (la `media` globale lavora su due termini). */
const mediaElenco = (v) => {
  const validi = v.filter(isNum);
  return validi.length ? validi.reduce((a, b) => a + b, 0) / validi.length : null;
};

/** Numero puro a due decimali: D/E e beta non sono multipli, niente suffisso «x». */
const dec2 = (n) =>
  isNum(n) ? n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n.d.";


/**
 * Sub-tab 4 · Dati macro e di settore.
 * Ingestione e sola ingestione: qui si raccolgono i parametri, non si calcola
 * né il beta né il WACC.
 */
function ParametriCapmFase0({ par, onPar, nomeAzienda, anni, settorePeer = null }) {
  /* Una modifica a mano rende il campo «manuale»: il calcolo dai concorrenti
     non lo tocca più finché non si sceglie «usa il valore dei concorrenti». */
  const setCapm = (k, v) =>
    onPar((prev) => ({ capm: { ...prev.capm, [k]: v }, capmFonte: { ...(prev.capmFonte || {}), [k]: "manuale" } }));
  const usaPeer = (k) => onPar((prev) => ({ capmFonte: { ...(prev.capmFonte || {}), [k]: "peer" } }));
  const fonte = par.capmFonte || {};
  const sp = settorePeer || { righe: [], t: {}, de: {}, glo: {} };
  const perCampo = Object.fromEntries(CAMPI_DA_PEER.map((c) => [c.k, { ...c, ris: sp[c.chiave] }]));
  const notaPeer = (k) => {
    const c = perCampo[k];
    if (!c) return null;
    if (fonte[k] === "peer" && isNum(c.ris?.valore) && c.ris.media)
      return `Media di ${c.ris.n} ${c.ris.n === 1 ? "azienda" : "aziende"}${c.ris.conPrincipale ? ", compresa quella in analisi" : ""}: ${c.ris.dettaglio}${c.ris.esclusi?.length ? ` (esclusi come estremi: ${c.ris.esclusi.join(", ")})` : ""}`;
    if (fonte[k] === "peer" && isNum(c.ris?.valore))
      return `Mediana di ${c.ris.n} ${c.ris.n === 1 ? "concorrente" : "concorrenti"}${c.ris.esclusi?.length ? ` (esclusi come estremi: ${c.ris.esclusi.join(", ")})` : ""}`;
    return null;
  };
  const azionePeer = (k) => {
    const c = perCampo[k];
    if (!c || fonte[k] !== "manuale" || !isNum(c.ris?.valore)) return null;
    return { testo: `↺ usa i concorrenti (${c.campo(c.ris.valore)})`, onClick: () => usaPeer(k) };
  };
  const deDaPeerConBeta = fonte.deSettore === "peer" && isNum(num(par.capm?.betaL));

  const compilati = CAMPI_CAPM.filter((c) => isNum(num(par.capm?.[c.k]))).length;
  const mancanti = CAMPI_CAPM.filter((c) => !isNum(num(par.capm?.[c.k])));


  return (
    <div className="space-y-6">
      <SectionCard
        titolo="Dati macro e di settore · Parametri CAPM"
        eyebrow={`Costo del capitale proprio · ${nomeAzienda}`}
        accento={BLUE}
        toolbar={
          <span
            className="rounded px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ fontFamily: FONT_MONO, backgroundColor: CARD, color: compilati === CAMPI_CAPM.length ? GREEN : BLUE }}
          >
            {compilati}/{CAMPI_CAPM.length} parametri
          </span>
        }
      >
        <div className="rounded-md p-4" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
          <Intestazione
            eyebrow="A cosa serve questa sezione"
            titolo="Ke = Rf + β × ERP"
            accento={BLUE}
            nota="Il costo del capitale proprio è il tassello che manca al WACC, e il WACC è il metro con cui la Fase 2 giudica se il ROI operativo crea o distrugge valore. Qui si raccolgono soltanto gli ingredienti: la depurazione del beta resta nella Fase 2.1, il WACC nella Fase 3."
          />
          <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            Le due opzioni qui sotto sono <strong>alternative</strong>, non complementari, e scrivono negli stessi campi:
            scegli la strada che preferisci. L'Opzione 1 usa le medie pubblicate di un database; l'Opzione 2 ricostruisce
            D/E e aliquota su un gruppo ristretto di concorrenti scelti da te. Tasso privo di rischio, ERP e beta di
            settore restano comunque da reperire con l'Opzione 1: un peer group non li produce.
          </p>
        </div>

        {/* ═══════════ MODULO A ═══════════ */}
        <div className="mt-4 rounded-md p-4" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
          <Intestazione
            eyebrow="Modulo A · metodo database"
            titolo="Opzione 1: Medie di settore pre-calcolate (Database)"
            accento={BLUE}
          />

          <p className="mt-3 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            <strong>Perché serve.</strong> Nessun bilancio aziendale contiene il Tasso Privo di Rischio, l'ERP o il Beta.
            Per calcolare il costo dell'equity con il CAPM, e ri-levare il Beta puro del settore, devi usare dati
            macroeconomici di mercato.
          </p>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <BoxIstruzioni
              titolo="Come ottenerli · Tasso privo di rischio (Rf)"
              accento={BLUE}
              passi={[
                <>
                  Apri un portale finanziario — <strong>Investing.com</strong>, <strong>Bloomberg</strong>, il sito della
                  banca centrale.
                </>,
                <>
                  Cerca il rendimento dei <strong>Titoli di Stato a 10 anni</strong> del paese di riferimento (per
                  l'Italia il <strong>BTP decennale</strong>).
                </>,
                <>
                  Riporta il rendimento a scadenza in percentuale nel campo <em>Tasso privo di rischio</em>.
                </>,
              ]}
            />
            <BoxIstruzioni
              titolo="Come ottenerli · ERP, Beta, D/E e aliquota (Damodaran)"
              accento={BLUE}
              passi={[
                <>
                  Cerca <strong>«Damodaran Online NYU Stern»</strong>.
                </>,
                <>
                  Vai su <strong>Data</strong> → <strong>Current Data</strong>.
                </>,
                <>
                  Scarica <strong>«Risk Premiums for Other Markets»</strong> per l'<strong>ERP</strong>.
                </>,
                <>
                  Scarica <strong>«Levered and Unlevered Betas by Industry»</strong> per <strong>Beta</strong>,{" "}
                  <strong>D/E</strong> e <strong>aliquote</strong>.
                </>,
                <>Cerca la riga del tuo settore.</>,
              ]}
            />
          </div>

          <div className="mt-4">
            <Label color={`${INK}90`}>Campi da compilare</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CAMPI_CAPM.map((c) => (
                <CampoCapm
                  key={c.k}
                  campo={c}
                  valore={par.capm?.[c.k]}
                  onChange={(v) => setCapm(c.k, v)}
                  evidenzia={fonte[c.k] === "peer"}
                  nota={notaPeer(c.k)}
                  azione={azionePeer(c.k)}
                />
              ))}
            </div>

            <div className="mt-3">
              <Label color={`${INK}70`}>Complemento · non fa parte del CAPM</Label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {CAMPI_CAPM_EXTRA.map((c) => (
                  <CampoCapm
                    key={c.k}
                    campo={c}
                    valore={par.capm?.[c.k]}
                    onChange={(v) => setCapm(c.k, v)}
                    evidenzia={fonte[c.k] === "peer"}
                    nota={notaPeer(c.k)}
                    azione={azionePeer(c.k)}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}80` }}>
                Il grado di leva operativa di settore non entra nel CAPM: serve alla sola correzione del beta per la
                diversa struttura di costi dell'impresa, nel quinto passaggio della Fase 2.1. Lasciandolo vuoto quella
                correzione viene semplicemente saltata.
              </p>
            </div>

            {mancanti.length > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                Ancora da compilare: <strong>{mancanti.map((c) => c.label).join(", ")}</strong>. Ogni campo vuoto
                interrompe la catena a valle — i passaggi della Fase 2.1 che lo richiedono restano in <em>n.d.</em> e lo
                dichiarano, senza sostituirlo con un valore di comodo.
              </p>
            )}
          </div>
        </div>

        {/* ═══════════ MODULO B ═══════════ */}
        <div className="mt-4 rounded-md p-4" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
          <Intestazione
            eyebrow="Modulo B · metodo peer group"
            titolo="Opzione 2: Parametri di settore dai bilanci dei concorrenti"
            accento={AMBER}
          />
          <p className="mt-3 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}C0` }}>
            Aliquota, D/E e grado di leva operativa di settore si calcolano <strong>da soli</strong> dalle riclassificazioni
            dei concorrenti che aggiungi nel sub-tab «3 · Peer Group» (con il loro ZIP o i JSON, caricati dal sub-tab «1 ·
            Base»), e compilano i campi qui sopra. Per ogni parametro si prende la <strong>media</strong> fra tutte le aziende,
            compresa quella in analisi, così ogni analisi della sessione usa gli stessi valori; contano solo gli esercizi
            chiusi (il TTM no). Da 4 valori in su gli estremi vengono esclusi (scarto interquartile). Un campo che
            modifichi a mano resta tuo. Beta, ERP e tasso privo di rischio sono dati di mercato: non si ricavano dai
            bilanci.
          </p>
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}B0` }}>
            <li>
              <strong>Aliquota</strong>: imposte ÷ utile ante imposte di ogni esercizio chiuso, media degli esercizi di ogni
              azienda, poi media fra le aziende; esclusi gli esercizi in perdita, quelli con imposte a zero (riga delle imposte
              non letta) e le aliquote oltre il 60%. Il periodo TTM non entra.
            </li>
            <li>
              <strong>D/E</strong>: debiti finanziari (breve + lungo) ÷ patrimonio netto dell'ultimo esercizio, a valori{" "}
              <strong>contabili</strong> (Damodaran usa la capitalizzazione di borsa: per società quotate molto sopra il
              patrimonio netto il D/E contabile risulta più alto).
            </li>
            <li>
              <strong>Grado di leva operativa</strong>: margine di contribuzione ÷ MON quando la quota di costi variabili è
              stimabile per regressione (3+ esercizi); altrimenti mediana delle coppie di anni ΔMON% ÷ ΔRicavi%, scartando
              quelle con ricavi quasi fermi (sotto il 3%) o MON non positivo. Servono almeno 2 esercizi per concorrente.
            </li>
          </ul>

          {deDaPeerConBeta && (
            <div
              className="mt-3 rounded-r px-3 py-2 text-[11px] leading-relaxed"
              style={{ fontFamily: FONT_BODY, backgroundColor: `${AMBER}12`, borderLeft: `3px solid ${AMBER}`, color: INK }}
            >
              <strong>⚠ Coerenza fra beta e D/E.</strong> Il D/E viene dai tuoi concorrenti, il beta levered da un'altra fonte
              (es. Damodaran). La depurazione del beta usa D/E e aliquota per togliere la leva: se beta e D/E vengono da
              campioni diversi il beta unlevered ne risulta distorto. Se il beta è di Damodaran, inserisci a mano anche il
              suo D/E di settore.
            </div>
          )}

          {sp.righe.length === 0 ? (
            <p className="mt-3 text-[11px]" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
              Nessun concorrente con riclassificazioni caricate: aggiungilo in «3 · Peer Group», poi carica il suo ZIP in «1 ·
              Base» con il concorrente selezionato come destinazione.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table style={{ borderCollapse: "collapse", minWidth: 640, width: "100%" }}>
                <thead>
                  <tr>
                    {["Concorrente", "Aliquota", "D/E", "Leva operativa"].map((h, i) => (
                      <th key={h} className={`py-1 ${i ? "px-2 text-right" : "pr-2 text-left"}`}>
                        <Label color={`${INK}80`}>{h}</Label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...(sp.principale ? [sp.principale] : []), ...sp.righe].map((r) => {
                    const cella = (v, testo, dettaglio, escluso) => (
                      <td className="py-1.5 px-2 text-right align-top" style={{ fontFamily: FONT_MONO }}>
                        <span className="text-xs tabular-nums" style={{ color: isNum(v) ? (escluso ? `${INK}50` : INK) : `${INK}50`, textDecoration: escluso ? "line-through" : "none" }}>
                          {isNum(v) ? testo : "n.d."}
                        </span>
                        {dettaglio && (
                          <span className="block text-[9px] leading-snug" style={{ fontFamily: FONT_BODY, color: `${INK}70` }}>
                            {dettaglio}
                          </span>
                        )}
                      </td>
                    );
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td className="py-1.5 pr-2 text-[11px] align-top" style={{ fontFamily: FONT_BODY, color: INK }}>
                          {r.nome}{r.principale ? " (in analisi)" : ""}
                          <span className="block text-[9px]" style={{ color: `${INK}70` }}>
                            {r.anni.length ? `esercizi ${r.anni.join(", ")}` : ""}
                          </span>
                        </td>
                        {cella(
                          r.t,
                          pct(r.t),
                          [r.tAnni.length ? `media ${r.tAnni.join(", ")}` : "", r.tScartati.length ? `esclusi ${r.tScartati.join(", ")}` : ""].filter(Boolean).join(" · "),
                          sp.t.esclusi?.includes(r.nome)
                        )}
                        {cella(
                          r.de,
                          dec2(r.de),
                          isNum(r.de) ? `${r.deAnno}: ${fmt(r.debiti)} ÷ ${fmt(r.pn)}` : "manca il patrimonio netto o il debito",
                          sp.de.esclusi?.includes(r.nome)
                        )}
                        {cella(
                          r.glo,
                          dec2(r.glo),
                          [r.gloMetodo, r.gloDettaglio].filter(Boolean).join(" · "),
                          sp.glo.esclusi?.includes(r.nome)
                        )}
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${INK}30` }}>
                    <td className="py-1.5 pr-2 text-[11px] font-bold" style={{ fontFamily: FONT_HEAD, color: INK }}>
                      Settore
                      <span className="block text-[9px] font-normal" style={{ fontFamily: FONT_BODY, color: `${INK}70` }}>
                        media di tutte le aziende, compresa quella in analisi
                      </span>
                    </td>
                    {[
                      [sp.t, (v) => pct(v)],
                      [sp.de, (v) => dec2(v)],
                      [sp.glo, (v) => dec2(v)],
                    ].map(([x, f], i) => (
                      <td key={i} className="py-1.5 px-2 text-right align-top" style={{ fontFamily: FONT_MONO }}>
                        <span className="text-xs font-bold tabular-nums" style={{ color: isNum(x?.valore) ? AMBER : `${INK}50` }}>
                          {isNum(x?.valore) ? f(x.valore) : "n.d."}
                        </span>
                        <span className="block text-[9px]" style={{ fontFamily: FONT_BODY, color: `${INK}70` }}>
                          {x?.n ? `media di ${x.n} ${x.n === 1 ? "azienda" : "aziende"}` : ""}
                          {x?.esclusi?.length ? ` · esclusi ${x.esclusi.join(", ")}` : ""}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══════════ MODULO C ═══════════ */}
        <div
          className="mt-4 rounded-md p-4"
          style={{ backgroundColor: `${BLUE}0D`, border: `1px solid ${BLUE}40` }}
        >
          <Intestazione eyebrow="Modulo C · promemoria" titolo="I bilanci della tua azienda" accento={BLUE} />
          <p className="mt-2 text-xs leading-relaxed" style={{ fontFamily: FONT_BODY, color: INK }}>
            <strong>Ricorda:</strong> una volta stabiliti i dati del settore (tramite Opzione 1 o 2), il sistema
            utilizzerà automaticamente lo Stato Patrimoniale e il Conto Economico riclassificati della TUA azienda
            (caricati negli step precedenti) per estrarre la PFN, il Patrimonio Netto, l'aliquota e i costi
            fissi/variabili. Questo passaggio trasforma il Beta di settore nel Beta Levered specifico per la tua azienda.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            {anni.length
              ? `Storico attualmente in memoria: ${anni.length} ${anni.length === 1 ? "esercizio" : "esercizi"} (${anni
                  .slice()
                  .reverse()
                  .join(", ")}). La quota di costi variabili, che serve al grado di leva operativa dell'impresa, si trova nel sub-tab «1 · Base»: il riquadro di separazione per regressione la stima sulla serie storica, e resta poi correggibile esercizio per esercizio.`
              : "Nessun esercizio ancora caricato: i moduli SP e CE dell'impresa si importano dal sub-tab «1 · Base»."}
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function UploadDati({
  onTtm = null,
  settorePeer = null,
  dataset,
  anni,
  meta,
  onRecord,
  onMeta,
  onReset,
  onEsempio,
  anniPrincipale,
  aziende,
  target,
  onTarget,
  onNuovoPeer,
  onRinomina,
  onElimina,
  peers,
  bench,
  onBench,
  benchmark,
  par,
  onPar,
  documentiSuite = null,
  avvioIntegrazione = false,
}) {
  const [testo, setTesto] = useState("");
  const [log, setLog] = useState([]);
  /** Sub-linguetta attiva della Fase 1. */
  const [sub, setSub] = useState("base");

  const nomeTarget = aziende?.[target]?.nome || "impresa in analisi";
  const aggiungiLog = (voce) => setLog((l) => [voce, ...l].slice(0, 6));

  /** Quanti dei tre parametri documentali sono già valorizzati, su tutti gli esercizi. */
  const copertiDoc = anniPrincipale.reduce(
    (n, a) => n + CAMPI_INTEGRAZIONE.filter((c) => isNum(num(par?.perAnno?.[a]?.[c.parKey]))).length,
    0
  );
  const attesiDoc = anniPrincipale.length * CAMPI_INTEGRAZIONE.length;
  /** Quanti dei cinque parametri CAPM sono già valorizzati. */
  const compilatiCapm = CAMPI_CAPM.filter((c) => isNum(num(par?.capm?.[c.k]))).length;

  const SUB_TABS = [
    {
      id: "base",
      label: "1 · Base",
      badge: anni.length ? `${anni.length} es.` : null,
      titolo: "Import dei moduli SP / CE / RF e parametri manuali",
    },
    {
      id: "documenti",
      label: "2 · Integrazione Documentale",
      badge: attesiDoc ? `${copertiDoc}/${attesiDoc}` : null,
      titolo: `Parametri ricavati dal bilancio integrale (20-F, 10-K, Annual Report, fascicolo): ${copertiDoc} valorizzati su ${attesiDoc} attesi (${CAMPI_INTEGRAZIONE.length} per ciascuno dei ${anniPrincipale.length} esercizi)`,
    },
    {
      id: "peer",
      label: "3 · Peer Group",
      badge: peers.length ? `${peers.length}` : null,
      titolo: "Comparable caricati e distribuzione settoriale di riferimento",
    },
    {
      id: "capm",
      label: "4 · Dati Macro & CAPM",
      badge: `${compilatiCapm}/${CAMPI_CAPM.length}`,
      titolo: "Tasso privo di rischio, ERP, beta, D/E e aliquota di settore: dove reperirli e dove inserirli",
    },
  ];

  const importa = (raw, origine) => {
    try {
      const grezzo = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (eBilancioTtm(grezzo)) {
        if (target !== "principale") {
          aggiungiLog({ level: "bad", msg: `${origine}: un bilancio TTM si carica solo sull'impresa in analisi, non su un concorrente` });
          return;
        }
        const k = onTtm?.(grezzo, origine);
        aggiungiLog({ level: "ok", msg: `${origine} → bilancio TTM su «${nomeTarget}»: periodo ${String(k).replace(".", ",")}` });
        return;
      }
      const { modulo, meta: m, record } = analizzaFile(raw);
      if (!record.length) {
        aggiungiLog({ level: "bad", msg: `${origine}: nessun esercizio riconosciuto nel file` });
        return;
      }
      onRecord(record);
      if (m && (m.azienda || m.valuta || isNum(m.aliquota))) onMeta(m);
      const etichetta = modulo ? `modulo ${MODULI[modulo]}` : "schema semplice";
      aggiungiLog({
        level: "ok",
        msg: `${origine} → ${etichetta} su «${nomeTarget}»: esercizi ${record.map((r) => r.anno).join(", ")}`,
      });
    } catch (e) {
      aggiungiLog({ level: "bad", msg: `${origine}: JSON non valido — ${e.message}` });
    }
  };

  const leggiFiles = (files) => {
    Array.from(files || []).forEach(async (f) => {
      if (eZip(f)) {
        try {
          const voci = await leggiZipRiclassificazioni(f);
          if (!voci.length) {
            aggiungiLog({ level: "bad", msg: `${f.name}: nello ZIP non ci sono JSON di riclassificazione` });
            return;
          }
          voci.forEach((v) => importa(v.testo, `${f.name} › ${v.origine}`)); // i TTM sono riconosciuti in importa
        } catch (e) {
          aggiungiLog({ level: "bad", msg: `${f.name}: ZIP non leggibile — ${e.message}` });
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => importa(String(reader.result), f.name);
      reader.onerror = () => aggiungiLog({ level: "bad", msg: `${f.name}: lettura fallita` });
      reader.readAsText(f);
    });
  };

  return (
    <div className="space-y-6">
      {/* ---------- Sub-linguette della Fase 1 ----------
          Stessa meccanica delle linguette principali, ma resa come barra
          segmentata per non confondere i due livelli di navigazione. */}
      <div className="flex flex-wrap gap-1 rounded-md p-1" style={{ backgroundColor: `${INK}0A` }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            title={t.titolo}
            className="flex items-center gap-2 rounded px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
            style={{
              fontFamily: FONT_HEAD,
              backgroundColor: sub === t.id ? CARD : "transparent",
              border: `1px solid ${sub === t.id ? LINE : "transparent"}`,
              color: sub === t.id ? INK : `${INK}80`,
            }}
          >
            {t.label}
            {t.badge && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] tabular-nums"
                style={{
                  fontFamily: FONT_MONO,
                  backgroundColor: sub === t.id ? `${PURPLE}14` : `${INK}12`,
                  color: sub === t.id ? PURPLE : `${INK}90`,
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {sub === "base" && (
      <>
      <SectionCard
        titolo="Caricamento dati · Moduli SP · CE · RF"
        eyebrow={meta.azienda ? `${meta.azienda}${meta.unita ? ` · ${meta.valuta || ""} ${meta.unita}` : ""}` : "Input globale"}
        accento={PURPLE}
        toolbar={
          <div className="flex flex-wrap items-center gap-1">
            {anni.map((a) => (
              <span
                key={a}
                className="rounded px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{ fontFamily: FONT_MONO, backgroundColor: CARD, color: PURPLE }}
              >
                {a}
              </span>
            ))}
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Dropzone
              titolo="Trascina qui i file, oppure"
              etichettaBottone="Seleziona file JSON o ZIP…"
              accept=".json,application/json,.zip,application/zip,application/x-zip-compressed"
              multiple
              accento={PURPLE}
              onFiles={leggiFiles}
            >
              Destinazione corrente: <strong style={{ color: PURPLE }}>{nomeTarget}</strong>. Puoi caricare anche lo
              ZIP delle riclassificazioni (una cartella per esercizio con i JSON di SP, CE e RF): vengono letti tutti gli
              esercizi in un colpo solo. Il modulo (SP / CE / RF)
              viene riconosciuto automaticamente dal contenuto, gli anni sono letti dai file e ogni file porta con sé due
              esercizi. Caricando in seguito la terna degli esercizi anteriori lo storico si estende all'indietro senza
              sovrascrivere nulla.
            </Dropzone>

            <details className="mt-3">
              <summary
                className="cursor-pointer text-[10px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}
              >
                Incolla JSON manualmente
              </summary>
              <textarea
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder='{"modulo":"rendiconto_finanziario", …}  oppure  [{"anno":"…","ce":{…},"sp":{…}}]'
                className="mt-2 w-full rounded-md p-3 text-xs"
                style={{
                  fontFamily: FONT_MONO,
                  backgroundColor: PAPER,
                  border: `1px solid ${LINE}`,
                  color: INK,
                  resize: "vertical",
                }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => importa(testo, "Incollato")}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ fontFamily: FONT_HEAD, backgroundColor: INK, color: "#FFFFFF" }}
                >
                  Importa
                </button>
              </div>
            </details>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const anniEsempio = onEsempio();
                  setLog([{ level: "info", msg: `Serie dimostrativa generata: esercizi ${anniEsempio.join(", ")}` }]);
                }}
                className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${INK}`, color: INK }}
              >
                Carica esempio
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setLog([{ level: "info", msg: "Storico svuotato." }]);
                }}
                className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${LINE}`, color: `${INK}A0` }}
              >
                Azzera tutto
              </button>
            </div>

            {log.length > 0 && (
              <div className="mt-3 flex flex-col items-start gap-1.5">
                {log.map((l, i) => (
                  <Badge key={i} level={l.level}>
                    {l.msg}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md p-3" style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <Label color={`${INK}90`}>Copertura storico · {nomeTarget}</Label>
            <div className="mt-2">
              <MatriceCopertura dataset={dataset} anni={anni} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Gli indici si calcolano solo sui moduli disponibili: un esercizio con il solo CE mostrerà i margini e
              lascerà in <em>n.d.</em> ROI, leverage e liquidità.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        titolo="Parametri di analisi"
        eyebrow="Grandezze fuori dalle riclassificazioni"
        accento={AMBER}
        toolbar={
          attesiDoc ? (
            <button
              type="button"
              onClick={() => setSub("documenti")}
              className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${AMBER}`, color: AMBER }}
            >
              📑 Compila dai documenti →
            </button>
          ) : null
        }
      >
        <ParametriAnalisi
          par={par}
          onPar={onPar}
          anni={anniPrincipale}
          meta={meta}
          dataset={aziende?.principale?.esercizi || {}}
        />
      </SectionCard>
      </>
      )}

      {/* Sempre montata: un'analisi in corso non si interrompe cambiando sub-tab. */}
      <div hidden={sub !== "documenti"}>
        <IntegrazioneDocumentale
          anni={anniPrincipale.filter((a) => Number.isInteger(a))}
          par={par}
          onPar={onPar}
          meta={aziende?.principale?.meta || meta}
          nomeTarget={aziende?.principale?.nome || "impresa in analisi"}
          documentiSuite={documentiSuite}
          avvioIntegrazione={avvioIntegrazione}
          periodoTtm={aziende?.principale?.ttm || null}
        />
      </div>

      {sub === "peer" && (
        <SectionCard
          titolo="Peer group e benchmark settoriale"
          eyebrow="Documenti per il posizionamento competitivo"
          accento={BLUE}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <GestionePeer
              aziende={aziende}
              target={target}
              onTarget={onTarget}
              onNuovoPeer={onNuovoPeer}
              onRinomina={onRinomina}
              onElimina={onElimina}
              peers={peers}
            />
            <BenchmarkSettoriale bench={bench} onBench={onBench} benchmark={benchmark} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
            I moduli di un comparable si caricano dal sub-tab «1 · Base» dopo averlo selezionato come destinazione qui
            sopra: la destinazione dell'import resta quella scelta finché non la si cambia.
          </p>
        </SectionCard>
      )}

      {sub === "capm" && (
        <ParametriCapmFase0
          par={par}
          onPar={onPar}
          settorePeer={settorePeer}
          anni={anniPrincipale}
          nomeAzienda={meta?.azienda || aziende?.principale?.nome || "impresa in analisi"}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. APP
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AnalisiBilancio({
  zipRiclassificazioni = null,
  iaEsterna = false,
  documentiSuite = null,
  avvioIntegrazione = false,
  /* Testo JSON di un'analisi salvata («Salva analisi»): viene ripristinata
     PRIMA di leggere lo ZIP, così parametri manuali, CAPM, benchmark e valori
     dell'integrazione documentale restano e cambiano solo gli esercizi. */
  analisiIniziale = null,
  /* Oggetto ref: chi ospita il programma ottiene { esporta() } per mettere
     l'analisi nel proprio archivio (stesso contenuto di «Salva analisi»). */
  apiRef = null,
  /* Concorrenti elaborati nella suite: [{ id, nome, zip }]. Diventano peer
     con id «suite_<id>»; quelli aggiunti a mano qui restano come sono. */
  concorrentiSuite = null,
} = {}) {
  IA_ESTERNA = !!iaEsterna;
  const [istanza] = useState(() => {
    STATO_LOTTO = { avviato: false, inCorso: false, finito: false, fatti: 0, totale: 0, bloccante: "" };
    return ++CONTA_ISTANZE;
  });
  useFonts();

  /** Pagina attiva. Il pattern è quello a linguette del modulo di riclassificazione. */
  const [tab, setTab] = useState("dati");

  /**
   * Stato globale multi-impresa: l'impresa in analisi più i comparable.
   * Ogni voce conserva il proprio storico completo, indicizzato per esercizio.
   */
  const [aziende, setAziende] = useState({
    principale: { nome: "Impresa in analisi", esercizi: {}, meta: {} },
  });
  /** Impresa a cui vengono attribuiti i file caricati. */
  const [target, setTarget] = useState("principale");

  /** Parametri manuali (aliquota, WACC provvisorio, fondi ammortamento). */
  const [par, setPar] = useState({ aliquota: null, wacc: null, perAnno: {}, capm: {} });
  /** Configurazione del riferimento settoriale. */
  const [bench, setBench] = useState({ modo: "auto", settore: "", override: {} });
  /** Portafoglio di aree strategiche d'affari (segment reporting manuale). */
  const [asa, setAsa] = useState([]);

  /** Una coppia di esercizi per ciascuna pagina di analisi. */
  const [coppie, setCoppie] = useState({
    operativa: null,
    determinanti: null,
    solvibilita: null,
    liquidita: null,
    assorbimento: null,
    raccolta: null,
    netta: null,
  });

  const demoRef = useRef(false);
  const [demoAttivo, setDemoAttivo] = useState(false);

  /** Esportazione/importazione dell'intera analisi come singolo file JSON. */
  const [esporta, setEsporta] = useState(null); // { nome, testo, copiato }
  const [statoIO, setStatoIO] = useState(null); // { tipo: "ok" | "bad", msg }
  const fileAnalisiRef = useRef(null);

  const principale = aziende.principale;
  const meta = principale.meta || {};

  /* Il dataset che alimenta le pagine di analisi è già allineato ai parametri
     manuali: se lo fosse solo il file salvato, schermo e salvataggio
     racconterebbero due conti economici diversi — che è esattamente il difetto
     che `stabilizzaDataset` esiste per togliere di mezzo. */
  const dataset = useMemo(
    () => stabilizzaDataset(principale.esercizi, par),
    [principale.esercizi, par]
  );

  /** Esercizi disponibili, dal più recente al più remoto. Dedotti SOLO dai JSON. */
  const anni = useMemo(() => Object.keys(dataset).map(Number).sort((a, b) => b - a), [dataset]);

  /** Metriche di posizionamento dei comparable. */
  const peers = useMemo(
    () =>
      Object.entries(aziende)
        .filter(([id]) => id !== "principale")
        .map(([id, a]) => ({ id, nome: a.nome, ...(metricheAzienda(a.esercizi) || {}) })),
    [aziende]
  );

  /* Periodo TTM dell'impresa in analisi (vedi BILANCIO TTM). Le etichette
     servono ai selettori di annualità. */
  const ttmPrincipale = aziende.principale?.ttm || null;
  ETICHETTE_PERIODO = ttmPrincipale ? { [ttmPrincipale.chiave]: ttmPrincipale.etichetta } : {};

  /** Registra un bilancio TTM nell'impresa in analisi. */
  const applicaTtm = (obj, nomeFile, { silenzioso = false } = {}) => {
    const { chiave, record, meta: mt } = recordDaTtm(obj, nomeFile);
    let esito = null;
    setAziende((prev) => {
      const a = prev.principale;
      if (a.esercizi?.[Math.floor(chiave) + 1]) {
        esito = { tipo: "bad", msg: `${mt.etichetta}: l'esercizio ${Math.floor(chiave) + 1} è già in memoria e comprende questo periodo, il TTM non serve più.` };
        return prev;
      }
      const esercizi = { ...a.esercizi };
      if (a.ttm && a.ttm.chiave !== chiave) delete esercizi[a.ttm.chiave];
      esercizi[chiave] = record;
      return { ...prev, principale: { ...a, esercizi, ttm: mt } };
    });
    const unitaPrinc = aziende.principale?.meta?.unita;
    const avvisoUnita = mt.unita && unitaPrinc && slug(mt.unita) !== slug(unitaPrinc)
      ? ` ⚠ Unità diverse: TTM in ${mt.unita}, riclassificazioni in ${unitaPrinc}.` : "";
    if (!silenzioso || esito || avvisoUnita)
      setTimeout(() => setStatoIO(esito || { tipo: "ok", msg: `${mt.etichetta} caricato come periodo distinto (chiave ${String(chiave).replace(".", ",")}).${avvisoUnita}` }), 0);
    return chiave;
  };

  /* Un esercizio chiuso che arriva dopo il TTM lo rende superato: lo si toglie. */
  useEffect(() => {
    const a = aziende.principale;
    if (!a?.ttm || !ttmSuperato(a.esercizi, a.ttm)) return;
    const etich = a.ttm.etichetta;
    setAziende((prev) => {
      const p = prev.principale;
      if (!p?.ttm || !ttmSuperato(p.esercizi, p.ttm)) return prev;
      const esercizi = { ...p.esercizi };
      delete esercizi[p.ttm.chiave];
      const { ttm: _t, ...resto } = p;
      return { ...prev, principale: { ...resto, esercizi } };
    });
    setStatoIO({ tipo: "ok", msg: `${etich} tolto: è arrivato l'esercizio ${Math.floor(a.ttm.chiave) + 1}, che lo comprende.` });
  }, [aziende.principale]);

  /** Aliquota, D/E e grado di leva operativa di settore dai concorrenti. */
  const settorePeer = useMemo(() => parametriSettoreDaPeer(aziende), [aziende]);

  /* Compilazione automatica dei campi di settore: un campo vuoto, o già
     compilato dai concorrenti, segue il calcolo; un campo modificato a mano
     (capmFonte[k] = "manuale") resta com'è. */
  useEffect(() => {
    setPar((prev) => {
      const capm = { ...(prev.capm || {}) };
      const fonte = { ...(prev.capmFonte || {}) };
      let cambiato = false;
      CAMPI_DA_PEER.forEach(({ k, chiave, campo }) => {
        if (fonte[k] === "manuale") return;
        const ris = settorePeer[chiave];
        const nuovo = isNum(ris?.valore) ? campo(ris.valore) : null;
        if (nuovo !== null) {
          if (fonte[k] !== "peer" && isNum(num(capm[k]))) return; // valore già presente da altra fonte
          if (capm[k] !== nuovo) { capm[k] = nuovo; cambiato = true; }
          if (fonte[k] !== "peer") { fonte[k] = "peer"; cambiato = true; }
        } else if (fonte[k] === "peer") {
          capm[k] = "";
          delete fonte[k];
          cambiato = true;
        }
      });
      return cambiato ? { ...prev, capm, capmFonte: fonte } : prev;
    });
    // capmFonte: «usa i concorrenti» rimette subito il valore calcolato.
  }, [settorePeer, par.capmFonte]);

  /** Distribuzione di riferimento risolta secondo la fonte scelta. */
  const benchmark = useMemo(
    () => risolviBenchmark({ modo: bench.modo, settore: bench.settore, override: bench.override, peers }),
    [bench, peers]
  );

  /** Riallinea le tre coppie quando lo storico cambia. */
  useEffect(() => {
    setCoppie((prev) => {
      const fix = (c) =>
        c && anni.includes(c.corrente) && anni.includes(c.precedente) && c.corrente !== c.precedente
          ? c
          : anni.length >= 2
          ? { corrente: anni[0], precedente: anni[1] }
          : null;
      return {
        operativa: fix(prev.operativa),
        determinanti: fix(prev.determinanti),
        solvibilita: fix(prev.solvibilita),
        liquidita: fix(prev.liquidita),
        assorbimento: fix(prev.assorbimento),
        raccolta: fix(prev.raccolta),
        netta: fix(prev.netta),
      };
    });
  }, [anni]);

  const setCoppia = (chiave) => (c) => setCoppie((prev) => ({ ...prev, [chiave]: c }));

  /** I record importati confluiscono nell'impresa attualmente selezionata. */
  const aggiungiRecord = (record) => {
    const eraDemo = demoRef.current && target === "principale";
    if (eraDemo) demoRef.current = false;
    setAziende((prev) => {
      const a = prev[target] || { nome: "Comparable", esercizi: {}, meta: {} };
      return { ...prev, [target]: { ...a, esercizi: fondiRecord(eraDemo ? {} : a.esercizi, record) } };
    });
    if (eraDemo) setDemoAttivo(false);
  };

  /**
   * Aggiorna i parametri. Accetta sia un patch letterale sia una funzione
   * (prev) => patch: la forma funzionale serve all'integrazione documentale,
   * dove due estrazioni su esercizi diversi possono concludersi a breve
   * distanza e un patch calcolato su uno stato ormai vecchio cancellerebbe
   * i valori appena scritti dall'altra.
   */
  const aggiornaPar = (patch) =>
    setPar((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  /* Celle compilate dallo Stato Patrimoniale. Le colonne con «auto» (equity,
     PP&E, immateriali, partecipazioni, liquidità, scoperti) avevano il valore
     del modulo SP solo come segnaposto grigio: ora lo si SCRIVE nella cella
     vuota, e si annota in par.autoDaSP. Se lo SP cambia, una cella ancora
     uguale al valore copiato si aggiorna; una cella modificata a mano o
     compilata dai documenti non si tocca più. */
  const eserciziPrinc = aziende?.principale?.esercizi;
  useEffect(() => {
    const es = eserciziPrinc || {};
    const colonne = COLONNE_PARAMETRI.filter((c) => c.auto);
    const modifiche = [];
    Object.keys(es).forEach((a) => {
      colonne.forEach((c) => {
        const sp = es[a]?.sp?.[c.auto];
        if (!isNum(sp)) return;
        const attuale = par.perAnno?.[a]?.[c.k];
        const copiato = par.autoDaSP?.[a]?.[c.k];
        const vuota = attuale == null || String(attuale).trim() === "";
        const ancoraCopiato = copiato != null && String(attuale ?? "") === String(copiato);
        const nuovo = versoCampo(sp);
        if ((vuota || ancoraCopiato) && String(attuale ?? "") !== nuovo) modifiche.push([a, c.k, nuovo]);
        else if (!vuota && copiato != null && !ancoraCopiato) modifiche.push([a, c.k, null]);
      });
    });
    if (!modifiche.length) return;
    setPar((prev) => {
      const perAnnoNuovo = { ...(prev.perAnno || {}) };
      const autoNuovo = { ...(prev.autoDaSP || {}) };
      modifiche.forEach(([a, k, v]) => {
        if (v == null) {
          const { [k]: _, ...resto } = autoNuovo[a] || {};
          autoNuovo[a] = resto;
          return;
        }
        perAnnoNuovo[a] = { ...(perAnnoNuovo[a] || {}), [k]: v };
        autoNuovo[a] = { ...(autoNuovo[a] || {}), [k]: v };
      });
      return { ...prev, perAnno: perAnnoNuovo, autoDaSP: autoNuovo };
    });
  }, [eserciziPrinc, par.perAnno, par.autoDaSP]);

  /* WACC calcolato dal sistema (vedi waccAutomatico). Un valore inserito a mano
     prima di questa versione è considerato manuale e non si tocca. */
  useEffect(() => {
    const fonte = par.waccFonte ?? (isNum(par.wacc) ? "manuale" : "auto");
    if (fonte === "manuale") {
      if (par.waccFonte !== "manuale") setPar((prev) => ({ ...prev, waccFonte: "manuale" }));
      return;
    }
    const r = waccAutomatico(eserciziPrinc || {}, par);
    const info = r.anno != null ? { anno: r.anno, kd: r.kd, ke: r.ke, wd: r.wd, scartati: r.scartati } : { anno: null, scartati: r.scartati };
    if (par.wacc === r.wacc && par.waccFonte === "auto" && JSON.stringify(par.waccAuto || null) === JSON.stringify(info)) return;
    setPar((prev) => ({ ...prev, wacc: r.wacc, waccAuto: info, waccFonte: "auto" }));
  }, [eserciziPrinc, par.capm, par.aliquota, par.perAnno, par.waccFonte, par.wacc]);

  /* Azioni in milioni: un'analisi salvata quando si chiedevano in unità viene
     riportata in milioni (nessuna società ha mille miliardi di azioni). */
  useEffect(() => {
    const pa = par.perAnno || {};
    if (!Object.values(pa).some((r) => isNum(num(r?.numeroAzioni)) && num(r.numeroAzioni) > 1e6)) return;
    setPar((prev) => {
      const perAnnoNuovo = { ...(prev.perAnno || {}) };
      Object.entries(perAnnoNuovo).forEach(([a, r]) => {
        const v = num(r?.numeroAzioni);
        if (isNum(v) && v > 1e6) perAnnoNuovo[a] = { ...r, numeroAzioni: versoCampo(v / 1e6) };
      });
      return { ...prev, perAnno: perAnnoNuovo };
    });
  }, [par.perAnno]);

  /* Aliquota dell'impresa in analisi: segue quella del Conto Economico finché
     non la modifichi qui a mano (par.aliquotaFonte = "manuale"). Le aliquote
     dei CE dei concorrenti restano nel loro meta e non toccano i parametri. */
  const aliquotaDalCE = (m) => (prev) =>
    !isNum(m?.aliquota) || prev.aliquotaFonte === "manuale"
      ? prev
      : { ...prev, aliquota: m.aliquota / 100, aliquotaFonte: "ce", aliquotaFonteTesto: m.aliquotaFonte || "Conto Economico" };

  const aggiornaMeta = (m) => {
    const pulito = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined && v !== ""));
    setAziende((prev) => {
      const a = prev[target] || { nome: "Comparable", esercizi: {}, meta: {} };
      return { ...prev, [target]: { ...a, nome: pulito.azienda || a.nome, meta: { ...a.meta, ...pulito } } };
    });
    if (target === "principale") setPar(aliquotaDalCE(m));
  };

  /* ZIP passato da chi monta il programma (la suite di riclassificazione):
     l'impresa in analisi viene popolata con tutti gli esercizi dello ZIP. */
  useEffect(() => {
    if (!zipRiclassificazioni && !analisiIniziale) return;
    let annullato = false;
    (async () => {
      let ripristinata = false;
      if (analisiIniziale) {
        try {
          applicaAnalisi(JSON.parse(analisiIniziale));
          ripristinata = true;
        } catch (e) {
          setStatoIO({ tipo: "bad", msg: `Analisi salvata non leggibile: ${e.message}` });
        }
      }
      if (!zipRiclassificazioni) {
        if (ripristinata) setStatoIO({ tipo: "ok", msg: "Analisi salvata ripristinata." });
        return;
      }
      try {
        const voci = await leggiZipRiclassificazioni(zipRiclassificazioni);
        if (annullato) return;
        let esercizi = {};
        let m = {};
        let letti = 0;
        const ttmDaZip = voci.filter((v) => v.ttm);
        for (const v of voci) {
          if (v.ttm) continue;
          try {
            const { meta: mm, record } = analizzaFile(v.testo);
            if (!record.length) continue;
            esercizi = fondiRecord(esercizi, record);
            m = { ...Object.fromEntries(Object.entries(mm || {}).filter(([, x]) => x !== null && x !== undefined && x !== "")), ...m };
            letti++;
          } catch { /* file non valido: si prosegue */ }
        }
        if (!letti) {
          setStatoIO({ tipo: "bad", msg: "Nello ZIP non ci sono riclassificazioni leggibili" });
          return;
        }
        demoRef.current = false;
        setDemoAttivo(false);
        setTarget("principale");
        setAziende((prev) => ({
          ...prev,
          principale: { nome: m.azienda || prev.principale.nome, esercizi, meta: { ...prev.principale.meta, ...m } },
        }));
        setPar(aliquotaDalCE(m));
        for (const v of ttmDaZip) {
          try { applicaTtm(JSON.parse(v.testo), v.origine.split("/").pop(), { silenzioso: true }); }
          catch (e) { setStatoIO({ tipo: "bad", msg: `${v.origine}: TTM non leggibile — ${e.message}` }); }
        }
        const anniLetti = Object.keys(esercizi).map(Number).sort((a, b) => b - a);
        setStatoIO({
          tipo: "ok",
          msg: `${ripristinata ? "Analisi salvata ripristinata · " : ""}Riclassificazioni caricate: ${letti} file, esercizi ${anniLetti.join(", ")}` +
            (ttmDaZip.length ? ` · bilancio TTM incluso come periodo distinto` : ""),
        });
      } catch (e) {
        if (!annullato) setStatoIO({ tipo: "bad", msg: `ZIP non leggibile: ${e.message}` });
      }
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipRiclassificazioni, analisiIniziale]);

  /* Concorrenti della suite: ogni ZIP diventa un peer «suite_<id>» (sostituito
     per intero a ogni passaggio); i peer «suite_» non più presenti vengono
     tolti. Gira dopo il ripristino dell'analisi salvata, che li conteneva
     nella versione precedente. */
  useEffect(() => {
    if (!Array.isArray(concorrentiSuite)) return;
    let annullato = false;
    (async () => {
      const letti = {};
      for (const c of concorrentiSuite) {
        if (!c?.zip) continue;
        try {
          const voci = await leggiZipRiclassificazioni(c.zip);
          let esercizi = {};
          let m = {};
          for (const v of voci) {
            if (v.ttm) continue;
            try {
              const { meta: mm, record } = analizzaFile(v.testo);
              if (!record.length) continue;
              esercizi = fondiRecord(esercizi, record);
              m = { ...Object.fromEntries(Object.entries(mm || {}).filter(([, x]) => x !== null && x !== undefined && x !== "")), ...m };
            } catch { /* file non valido */ }
          }
          if (Object.keys(esercizi).length) letti[`suite_${c.id}`] = { nome: c.nome || m.azienda || "Concorrente", esercizi, meta: m, suite: true };
        } catch { /* ZIP non leggibile: il concorrente resta fuori */ }
      }
      if (annullato) return;
      setAziende((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith("suite_")));
        return { ...next, ...letti };
      });
      setTarget((t) => (t.startsWith("suite_") && !letti[t] ? "principale" : t));
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concorrentiSuite]);

  const caricaEsempio = () => {
    const esempio = generaEsempio();
    demoRef.current = true;
    setTarget("principale");
    setAziende((prev) => ({ ...prev, principale: { ...prev.principale, esercizi: esempio } }));
    setDemoAttivo(true);
    return Object.keys(esempio).map(Number).sort((a, b) => b - a);
  };

  const reset = () => {
    demoRef.current = false;
    setAziende({ principale: { nome: "Impresa in analisi", esercizi: {}, meta: {} } });
    setTarget("principale");
    setDemoAttivo(false);
    setPar({ aliquota: null, wacc: null, perAnno: {}, capm: {} });
  };

  const nuovoPeer = (nome) => {
    const id = `peer_${Object.keys(aziende).length}_${nome.replace(/\W+/g, "").slice(0, 12) || "x"}`;
    setAziende((prev) => ({ ...prev, [id]: { nome, esercizi: {}, meta: {} } }));
    setTarget(id);
  };

  const rinomina = (id, nome) =>
    setAziende((prev) => ({ ...prev, [id]: { ...prev[id], nome } }));

  const elimina = (id) =>
    setAziende((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  /* ---- Salva / carica l'intera analisi come singolo file JSON ----
     Persiste tutto lo stato che non è ricalcolabile dai soli moduli SP/CE/RF:
     imprese + storico multi-anno, peer group, benchmark, parametri (aliquota,
     WACC provvisorio, tabella per-anno, CAPM), portafoglio ASA e le coppie di
     annualità scelte in ciascuna pagina di analisi. Non salva "tab" né
     "demoAttivo": al ripristino si riparte dalla pagina Dati con dati reali. */
  /** Contenuto di «Salva analisi»: { nome, testo }. */
  const costruisciAnalisi = () => {
      /* Il file esce allineato ai parametri manuali: senza questo passaggio
         `ce.costoLavoro` conserverebbe il valore del riclassificatore mentre
         gli indici lavorano sull'override, e il salvataggio si contraddirebbe
         da solo alla prima riapertura. */
      const aziendeStabili = Object.fromEntries(
        Object.entries(aziende).map(([chiave, impresa]) => [
          chiave,
          {
            ...impresa,
            esercizi:
              chiave === "principale" ? dataset : stabilizzaDataset(impresa.esercizi, null),
          },
        ])
      );

      const datiSalvare = {
        formato: "analisi-bilancio/1.0",
        generatoIl: new Date().toISOString(),
        aziende: aziendeStabili,
        /* «target» nel file indica l'impresa in analisi: chi lo legge (Quality
           of Earnings, Pro-forma e DCF) la prende da qui. Resta quindi sempre
           «principale», anche se la destinazione dei caricamenti a schermo è
           un concorrente. */
        target: "principale",
        par,
        bench,
        asa,
        coppie,
      };
      // Validazione: rimuove eventuali proprietà non serializzabili
      const datiPuliti = JSON.parse(JSON.stringify(datiSalvare));
      const testoJSON = JSON.stringify(datiPuliti, null, 2);
      const primoAnno = anni.length ? anni[anni.length - 1] : "";
      const ultimoAnno = anni.length ? anni[0] : "";
      const suffisso = primoAnno && ultimoAnno ? `_${primoAnno}-${ultimoAnno}` : "";
      const nomeFile = `analisi-bilancio${suffisso}.json`;
      return { nome: nomeFile, testo: testoJSON };
  };
  if (apiRef) apiRef.current = {
    istanza,
    esporta: () => (anni.length ? costruisciAnalisi() : null),
    pronta: () => anni.length > 0,
    statoIntegrazione: () => ({ ...STATO_LOTTO }),
    peerSuite: () => Object.keys(aziende).filter((k) => k.startsWith("suite_")).length,
  };

  const salvaAnalisi = () => {
    try {
      const { nome: nomeFile, testo: testoJSON } = costruisciAnalisi();
      // Apre la modale di esportazione invece del download diretto: alcuni
      // ambienti sandbox bloccano il click programmatico su <a download>.
      setEsporta({ nome: nomeFile, testo: testoJSON, copiato: false });
    } catch (err) {
      setStatoIO({ tipo: "bad", msg: `Errore durante il salvataggio: ${err.message || err}` });
      setTimeout(() => setStatoIO(null), 5000);
    }
  };

  const copiaEsporta = async () => {
    if (!esporta) return;
    try {
      await navigator.clipboard.writeText(esporta.testo);
      setEsporta((e) => (e ? { ...e, copiato: true } : e));
    } catch {
      const ta = document.getElementById("export-analisi-textarea");
      if (ta) {
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
          setEsporta((e) => (e ? { ...e, copiato: true } : e));
        } catch {
          setStatoIO({ tipo: "bad", msg: "Copia automatica non riuscita: seleziona il testo e copia manualmente (Ctrl+C)." });
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
    } catch {
      setStatoIO({ tipo: "bad", msg: "Download bloccato dall'ambiente: usa «Copia negli appunti» e incolla in un file .json." });
      setTimeout(() => setStatoIO(null), 5000);
    }
  };

  /** Reidratazione: ripristina imprese, parametri, benchmark, ASA e coppie
   *  di annualità da un file salvato in precedenza con «Salva analisi». */
  /** Ripristina lo stato da un'analisi salvata (oggetto già letto). */
  const applicaAnalisi = (data) => {
      if (!data || typeof data !== "object") throw new Error("formato non riconosciuto");
      if (!data.aziende || typeof data.aziende !== "object" || !data.aziende.principale) {
        throw new Error('manca la sezione "aziende.principale"');
      }

      demoRef.current = false;
      setAziende(data.aziende);
      setTarget(typeof data.target === "string" && data.aziende[data.target] ? data.target : "principale");
      setPar({ aliquota: null, wacc: null, perAnno: {}, capm: {}, ...(data.par || {}) });
      setBench({ modo: "auto", settore: "", override: {}, ...(data.bench || {}) });
      setAsa(Array.isArray(data.asa) ? data.asa : []);
      setCoppie({
        operativa: data.coppie?.operativa ?? null,
        determinanti: data.coppie?.determinanti ?? null,
        solvibilita: data.coppie?.solvibilita ?? null,
        liquidita: data.coppie?.liquidita ?? null,
        assorbimento: data.coppie?.assorbimento ?? null,
        raccolta: data.coppie?.raccolta ?? null,
        netta: data.coppie?.netta ?? null,
      });
      setDemoAttivo(false);
      setTab("dati");
      return data;
  };

  const caricaAnalisi = async (file) => {
    try {
      const testo = await file.text();
      const data = applicaAnalisi(JSON.parse(testo));

      const imprese = Object.keys(data.aziende).length;
      const anniImpresa = Object.keys(data.aziende.principale.esercizi || {}).length;
      setStatoIO({
        tipo: "ok",
        msg: `Analisi ripristinata da «${file.name}»: ${imprese} ${imprese === 1 ? "impresa" : "imprese"}, ${anniImpresa} ${anniImpresa === 1 ? "esercizio" : "esercizi"} sull'impresa principale.`,
      });
      setTimeout(() => setStatoIO(null), 5000);
    } catch (err) {
      setStatoIO({ tipo: "bad", msg: `Errore durante il caricamento: ${err.message || "file JSON non valido"}` });
      setTimeout(() => setStatoIO(null), 6000);
    }
  };

  const vaiAiDati = () => setTab("dati");

  const tabs = [
    { id: "dati", label: "1 · Dati & Caricamento" },
    { id: "operativa", label: "2 · Redditività Operativa" },
    { id: "determinanti", label: "2.1 · Determinanti del ROI" },
    { id: "solvibilita", label: "3 · Solvibilità" },
    { id: "liquidita", label: "3.1 · Liquidità statica e dinamica" },
    { id: "assorbimento", label: "3.2 · Assorbimento e servizio finanziario" },
    { id: "raccolta", label: "3.3 · Raccolta, rischio e costo del capitale" },
    { id: "netta", label: "4 · Redditività Netta" },
  ];

  const intervallo = anni.length ? (anni.length === 1 ? `${anni[0]}` : `${anni[anni.length - 1]}–${anni[0]}`) : "—";

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: PAPER }}>
      {esporta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "#14213DB3" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEsporta(null);
          }}
        >
          <div
            className="flex w-full max-w-2xl flex-col gap-4 rounded-md p-6"
            style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, maxHeight: "85vh" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ fontFamily: FONT_HEAD, color: PURPLE }}
                >
                  💾 Esporta analisi
                </div>
                <p className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
                  File:{" "}
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: INK }}>{esporta.nome}</span> ·{" "}
                  {(esporta.testo.length / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEsporta(null)}
                className="text-xl font-bold leading-none"
                style={{ color: `${INK}80` }}
                aria-label="Chiudi"
              >
                ×
              </button>
            </div>

            <p className="text-[11px] leading-relaxed" style={{ fontFamily: FONT_BODY, color: `${INK}90` }}>
              Se il download automatico è bloccato dall'ambiente, usa <strong>«Copia negli appunti»</strong> e
              incolla il contenuto in un file di testo salvato come{" "}
              <span style={{ fontFamily: FONT_MONO }}>{esporta.nome}</span>. Per ripristinare l'analisi in futuro
              usa «📂 Carica analisi salvata».
            </p>

            <textarea
              id="export-analisi-textarea"
              readOnly
              value={esporta.testo}
              onFocus={(e) => e.target.select()}
              rows={10}
              className="w-full flex-1 resize-none rounded-md p-3 text-[11px]"
              style={{
                fontFamily: FONT_MONO,
                backgroundColor: PAPER,
                border: `1px solid ${LINE}`,
                color: INK,
                minHeight: 200,
              }}
            />

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={copiaEsporta}
                className="rounded-md px-4 py-2 text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, backgroundColor: esporta.copiato ? GREEN : INK, color: "#FFFFFF" }}
              >
                {esporta.copiato ? "✓ Copiato" : "📋 Copia negli appunti"}
              </button>
              <button
                type="button"
                onClick={scaricaEsporta}
                className="rounded-md px-4 py-2 text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${INK}`, color: INK }}
              >
                ⬇ Scarica file
              </button>
              <button
                type="button"
                onClick={() => setEsporta(null)}
                className="rounded-md px-4 py-2 text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: FONT_HEAD, color: `${INK}A0` }}
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="px-6 pt-8 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, color: `${INK}80` }}
            >
              Analisi di bilancio · Riclassificazioni SP / CE / RF
            </div>
            <h1
              className="mt-1 text-2xl font-extrabold uppercase tracking-widest"
              style={{ fontFamily: FONT_HEAD, color: INK }}
            >
              {meta.azienda || "Redditività & Solvibilità"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm" style={{ fontFamily: FONT_BODY, color: `${INK}A0` }}>
              Ogni pagina di analisi ha un selettore di annualità indipendente: i delta e i giudizi di quell'area
              pescano dallo storico globale solo la coppia di esercizi scelta lì.
            </p>
          </div>
          <div className="text-right">
            <Label color={`${INK}70`}>Storico in memoria</Label>
            <div className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: FONT_MONO, color: INK }}>
              {anni.length} {anni.length === 1 ? "esercizio" : "esercizi"}
            </div>
            <div className="text-sm font-semibold tabular-nums" style={{ fontFamily: FONT_MONO, color: `${INK}A0` }}>
              {intervallo}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {demoAttivo && <Badge level="warn">Serie dimostrativa generata: sostituita al primo import reale</Badge>}
          {(meta.valuta || meta.unita) && (
            <Badge level="info">{`Importi in ${[meta.valuta, meta.unita].filter(Boolean).join(" · ")}`}</Badge>
          )}
          {anni.length > 0 && !demoAttivo && <Badge level="ok">{`Esercizi dedotti dai file: ${anni.map(etichettaPeriodo).join(", ")}`}</Badge>}
          {peers.length > 0 && <Badge level="info">{`${peers.length} comparable nel peer group`}</Badge>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={salvaAnalisi}
            disabled={anni.length === 0}
            title="Esporta l'intera analisi (imprese, peer group, parametri, ASA, coppie di annualità) in un file JSON"
            className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest disabled:opacity-40"
            style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${GREEN}`, color: GREEN }}
          >
            💾 Salva analisi (JSON)
          </button>
          <button
            type="button"
            onClick={() => fileAnalisiRef.current?.click()}
            title="Ripristina un salvataggio JSON esportato in precedenza da questa applicazione"
            className="rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest"
            style={{ fontFamily: FONT_HEAD, backgroundColor: CARD, border: `1px solid ${BLUE}`, color: BLUE }}
          >
            📂 Carica analisi salvata
          </button>
          <input
            ref={fileAnalisiRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) caricaAnalisi(f);
              e.target.value = "";
            }}
          />
          {statoIO && <Badge level={statoIO.tipo === "ok" ? "ok" : "bad"}>{statoIO.msg}</Badge>}
        </div>

        <nav className="mt-5 flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-4 py-2 text-sm font-semibold rounded-t-lg border border-b-0"
              style={{
                fontFamily: FONT_HEAD,
                backgroundColor: tab === t.id ? CARD : "transparent",
                borderColor: tab === t.id ? LINE : "transparent",
                color: tab === t.id ? INK : "#6B7280",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-6 pb-12 max-w-6xl mx-auto">
        <div style={{ borderTop: `1px solid ${LINE}` }} />
        <div className="pt-6 space-y-8">
          {/* Sempre montata (nascosta fuori dalla sua linguetta): l'integrazione
              documentale avviata dalla suite prosegue anche cambiando pagina. */}
          <div hidden={tab !== "dati"}>
            <UploadDati
              dataset={aziende[target]?.esercizi || {}}
              anni={Object.keys(aziende[target]?.esercizi || {}).map(Number).sort((a, b) => b - a)}
              meta={aziende[target]?.meta || {}}
              onRecord={aggiungiRecord}
              onTtm={applicaTtm}
              onMeta={aggiornaMeta}
              onReset={reset}
              onEsempio={caricaEsempio}
              anniPrincipale={anni}
              aziende={aziende}
              target={target}
              onTarget={setTarget}
              onNuovoPeer={nuovoPeer}
              onRinomina={rinomina}
              onElimina={elimina}
              peers={peers}
              bench={bench}
              onBench={(patch) => setBench((prev) => ({ ...prev, ...patch }))}
              benchmark={benchmark}
              par={par}
              onPar={aggiornaPar}
              documentiSuite={documentiSuite}
              avvioIntegrazione={avvioIntegrazione}
              settorePeer={settorePeer}
            />
          </div>

          {tab === "operativa" && (
            <PaginaRedditivitaOperativa
              dataset={dataset}
              anni={anni}
              coppia={coppie.operativa}
              onCoppia={setCoppia("operativa")}
              onVaiAiDati={vaiAiDati}
              par={par}
              onPar={aggiornaPar}
              benchmark={benchmark}
              peers={peers}
              nomeAzienda={meta.azienda || principale.nome}
            />
          )}

          {tab === "determinanti" && (
            <PaginaDeterminantiRoi
              dataset={dataset}
              anni={anni}
              coppia={coppie.determinanti}
              onCoppia={setCoppia("determinanti")}
              onVaiAiDati={vaiAiDati}
              par={par}
              benchmark={benchmark}
              peers={peers}
              nomeAzienda={meta.azienda || principale.nome}
              asa={asa}
              onAsa={setAsa}
            />
          )}

          {tab === "solvibilita" && (
            <PaginaSolvibilita
              dataset={dataset}
              anni={anni}
              coppia={coppie.solvibilita}
              onCoppia={setCoppia("solvibilita")}
              onVaiAiDati={vaiAiDati}
              par={par}
            />
          )}

          {tab === "liquidita" && (
            <PaginaLiquidita
              dataset={dataset}
              anni={anni}
              coppia={coppie.liquidita}
              onCoppia={setCoppia("liquidita")}
              onVaiAiDati={vaiAiDati}
              par={par}
            />
          )}

          {tab === "assorbimento" && (
            <PaginaAssorbimento
              dataset={dataset}
              anni={anni}
              coppia={coppie.assorbimento}
              onCoppia={setCoppia("assorbimento")}
              onVaiAiDati={vaiAiDati}
              par={par}
              asa={asa}
            />
          )}

          {tab === "raccolta" && (
            <PaginaRaccolta
              dataset={dataset}
              anni={anni}
              coppia={coppie.raccolta}
              onCoppia={setCoppia("raccolta")}
              onVaiAiDati={vaiAiDati}
              par={par}
            />
          )}

          {tab === "netta" && (
            <PaginaRedditivitaNetta
              dataset={dataset}
              anni={anni}
              coppia={coppie.netta}
              onCoppia={setCoppia("netta")}
              onVaiAiDati={vaiAiDati}
              par={par}
            />
          )}

          <footer className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_HEAD, color: `${INK}60` }}>
            I giudizi automatici applicano soglie generaliste e non sostituiscono l'analisi settoriale.
          </footer>
        </div>
      </main>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   9. FONT LOADER (rimuovibile se i font sono già nel bundle/CSS globale)
   ═══════════════════════════════════════════════════════════════════════════ */

function useFonts() {
  useEffect(() => {
    const id = "ds-font-analisi-bilancio";
    if (typeof document === "undefined" || document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);
}
