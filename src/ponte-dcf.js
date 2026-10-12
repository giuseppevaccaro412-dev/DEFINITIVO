/* =============================================================================
   «Bilancio pro-forma e DCF» dentro la suite.

   Il programma è una pagina già compilata (src/moduli/BilancioProformaDCF.html)
   e resta invariata: la suite la mostra in un riquadro e le aggiunge in coda
   un piccolo script con due compiti.

   1. Pulsante «📦 Carica ZIP dell'azienda». Parte SOLO quando lo usi tu: la
      suite non passa nulla in automatico, così carichi lo ZIP ultimo e
      definitivo (riclassificazioni + Redditività e Solvibilità + Quality of
      Earnings). Lo script apre «Fase 0 → Carica file», svuota i riquadri e
      consegna ogni JSON al riquadro del suo tipo, come un file trascinato:
        formato «analisi-bilancio»      → Indici di redditività e solvibilità
        «Riclassificazione SP»          → Stato Patrimoniale
        formato «ce-riclassificato…»    → Conto Economico
        modulo «rendiconto_finanziario» → Rendiconto Finanziario
        salvataggio «Qualità Contabile» → Qualità del bilancio
      (gli stessi criteri con cui la pagina riconosce i file).
      Se lo ZIP è quello della sessione con più aziende («aziende/<Nome>/…»)
      chiede quale caricare, proponendo quella della scheda in cui si trova;
      i documenti originali («documenti/…») e la comparazione sono esclusi.

   2. I file che la pagina fa scaricare passano dalla suite, che nell'artifact
      li consegna con la capability «downloads» (un link nel riquadro non
      scaricherebbe nulla).
   ============================================================================= */

const SCRIPT_PONTE = String.raw`
(function () {
  if (window.__ponteZipDcf) return;
  window.__ponteZipDcf = true;

  /* ---------- download inoltrati alla pagina che ospita ---------- */
  var consegna = null;
  try { consegna = window.parent && window.parent !== window && window.parent.__suiteConsegnaFile; } catch (e) { consegna = null; }
  if (typeof consegna === "function") {
    var blobDiUrl = new Map();
    var creaUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (o) {
      var u = creaUrl(o);
      if (o instanceof Blob) { blobDiUrl.set(u, o); setTimeout(function () { blobDiUrl.delete(u); }, 60000); }
      return u;
    };
    var clickOriginale = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      var b = this.download && blobDiUrl.get(this.href);
      if (!b) return clickOriginale.call(this);
      consegna(this.download, b, window);
    };
  }

  /* ---------- prezzo per azione anche in euro ----------
     Cambio BCE del giorno (fonte: api.frankfurter.app, che pubblica i cambi di
     riferimento della BCE; riserva: open.er-api.com). Un cambio scritto a mano
     nelle Assumption prevale sempre su quello automatico. */
  var cambi = null; // { data, fonte, rates: { USD: 1.08, ... } } — valuta per 1 euro
  function codiceValuta(v) {
    v = String(v || "").trim().toUpperCase();
    if (!v || v === "EUR" || v === "€" || v === "EURO") return null;
    if (v === "$" || v === "US$" || v === "USD" || v === "DOLLARI") return "USD";
    if (v === "£" || v === "GBP") return "GBP";
    return /^[A-Z]{3}$/.test(v) ? v : null;
  }
  function scaricaCambi() {
    return fetch("https://api.frankfurter.app/latest?from=EUR").then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.rates) throw new Error("vuoto"); return { data: j.date, fonte: "BCE", rates: j.rates }; })
      .catch(function () {
        return fetch("https://open.er-api.com/v6/latest/EUR").then(function (r) { return r.json(); })
          .then(function (j) { if (!j || !j.rates) throw new Error("vuoto"); return { data: String(j.time_last_update_utc || "").slice(5, 16), fonte: "open.er-api", rates: j.rates }; });
      });
  }
  try {
    var limite = setTimeout(function () { if (!cambi) cambi = { errore: true, rates: {} }; }, 6000);
    scaricaCambi().then(function (c) { clearTimeout(limite); cambi = c; }).catch(function () { clearTimeout(limite); cambi = { errore: true, rates: {} }; });
  } catch (e) { cambi = { errore: true, rates: {} }; }
  /* Ultimo cambio scritto a mano, per valuta: vale anche per le altre aziende
     e per le prossime aperture quando il cambio BCE non è raggiungibile (nella
     pagina pubblicata su claude.ai le richieste a siti esterni sono bloccate). */
  function cambioRicordato(k) {
    try { var x = JSON.parse(localStorage.getItem("dcf-cambio-" + k) || "null"); return x && x.v > 0 ? x : null; } catch (e) { return null; }
  }
  function ricordaCambio(k, v) {
    try {
      var x = cambioRicordato(k);
      if (!x || Math.abs(x.v - v) > 1e-9) localStorage.setItem("dcf-cambio-" + k, JSON.stringify({ v: v, data: new Date().toISOString().slice(0, 10) }));
    } catch (e) {}
  }
  /* Cambi cercati ogni giorno da Claude e salvati dalla suite (window.__suiteCambi):
     hanno la precedenza; poi la lettura diretta dalla BCE, se il sito risponde. */
  function cambiSuite() {
    try {
      var c = window.parent && window.parent !== window && window.parent.__suiteCambi;
      return c && c.rates ? { data: c.data, fonte: c.fonte || "BCE (ricerca giornaliera di Claude)", rates: c.rates } : null;
    } catch (e) { return null; }
  }
  function cambiAttuali() {
    var s = cambiSuite();
    if (s) return s;
    return cambi && cambi.rates && Object.keys(cambi.rates).length ? cambi : null;
  }
  window.__dcfCambioAuto = function (valuta) {
    var k = codiceValuta(valuta);
    if (!k) return null;
    var ca = cambiAttuali();
    if (ca && ca.rates[k]) return Number(ca.rates[k]);
    var r = cambioRicordato(k);
    return r ? r.v : null;
  };
  window.__dcfEur = function (v, cambio, valuta) {
    var k = codiceValuta(valuta);
    if (v === null || v === undefined || !isFinite(v) || !k) return "";
    if (cambio) ricordaCambio(k, cambio);
    var r = cambio || window.__dcfCambioAuto(valuta);
    if (!r) return " (€ —: manca il cambio, Assumption → Tributaria e valutazione)";
    return " (€ " + (v / r).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ")";
  };
  window.__dcfNotaCambio = function (valuta, cambio, prezzo) {
    var k = codiceValuta(valuta);
    if (!k) return "";
    if (cambio) ricordaCambio(k, cambio);
    var ca = cambiAttuali();
    var bce = ca && ca.rates[k] ? Number(ca.rates[k]) : null;
    var ric = cambioRicordato(k);
    var fmt = function (x, c) { return Number(x).toLocaleString("it-IT", { minimumFractionDigits: c, maximumFractionDigits: c }); };
    var t = cambio
      ? "Cambio inserito a mano: 1 € = " + fmt(cambio, 4) + " " + k + (bce ? " (BCE " + (ca.data || "") + ": " + fmt(bce, 4) + ")" : "") + ". Vale anche per le altre aziende in " + k + "; metti 0 per usare il cambio del giorno."
      : bce
        ? "Cambio di riferimento " + ca.fonte + " del " + (ca.data || "giorno") + ": 1 € = " + fmt(bce, 4) + " " + k + ". Scrivi un valore per sostituirlo."
        : ric
          ? "Cambio BCE non raggiungibile da qui: uso l'ultimo cambio che hai scritto (" + ric.data + "): 1 € = " + fmt(ric.v, 4) + " " + k + ". Scrivi un valore per aggiornarlo."
          : cambi && cambi.errore
            ? "Cambio BCE non raggiungibile da qui: scrivi quanti " + k + " vale 1 euro (es. 1,085). Lo ricordo anche per le altre aziende."
            : "Lettura del cambio BCE in corso…";
    var r = cambio || bce || (ric && ric.v);
    if (r && prezzo) t += " Prezzo di mercato in euro: € " + fmt(prezzo / r, 2) + ".";
    return t + " Valore e prezzo per azione sono mostrati anche in euro.";
  };

  /* ---------- spread da rischio informativo dalla suite ----------
     Ogni 1,5 secondi la pagina chiede alla suite lo spread di Quality of
     Earnings della SUA azienda e lo scrive nelle Assumption («Spread da rischio
     informativo su Ke»), senza bisogno di ricaricare lo ZIP. Se lo scrivi a mano,
     il tuo valore resta (metti 0 per tornare a quello automatico). */
  var spreadSuite = null;
  function leggiSpreadSuite() {
    try {
      var f = window.parent && window.parent !== window && window.parent.__suiteSpreadDi;
      spreadSuite = typeof f === "function" ? f(window) : null;
    } catch (e) { spreadSuite = null; }
    if (spreadSuite && isFinite(spreadSuite.pct) && typeof window.__dcfImpostaSpread === "function") {
      try { window.__dcfImpostaSpread(spreadSuite.pct / 100); } catch (e) {}
    }
  }
  setInterval(leggiSpreadSuite, 1500);
  setTimeout(leggiSpreadSuite, 300);
  window.__dcfSpreadSuiteOra = function () { return spreadSuite && isFinite(spreadSuite.pct) ? spreadSuite.pct / 100 : null; };
  window.__dcfNotaSpread = function (u) {
    if (!spreadSuite || !isFinite(spreadSuite.pct)) return null;
    var v = String(spreadSuite.pct).replace(".", ",") + "%";
    var ts = spreadSuite.trust != null ? " · Trust Score " + spreadSuite.trust + "/100" : "";
    var ks = spreadSuite.investibile === false ? " Attenzione: in Quality of Earnings è scattato il kill switch (investable_flag = false)." : "";
    return u && u.spreadManuale
      ? "Valore scritto a mano. Quality of Earnings di " + spreadSuite.azienda + ": " + v + ts + ". Metti 0 per tornare al valore automatico." + ks
      : "Dal Quality of Earnings di " + spreadSuite.azienda + " (" + spreadSuite.fonte + "): " + v + ts + ". Si aggiorna da solo; scrivi un valore per sostituirlo." + ks;
  };

  /* ---------- DCF salvato nella sessione ----------
     Alla prima apertura della pagina, se la suite ha per questa azienda un DCF
     salvato (ZIP della sessione riaperto, o sessione dell'artifact) e la pagina
     è vuota, lo riapre da solo. */
  var ripresaFatta = false;
  function riprendiSalvato() {
    if (ripresaFatta || typeof window.__dcfHaDati !== "function") return;
    ripresaFatta = true;
    if (window.__dcfHaDati()) return;
    try {
      var f = window.parent && window.parent !== window && window.parent.__suiteDcfSalvato;
      var salvato = typeof f === "function" ? f(window) : null;
      if (!salvato || !salvato.testo) return;
      window.__dcfRiprendi(JSON.parse(salvato.testo));
      setTimeout(function () {
        if (typeof mostra === "function") mostra("✓ Riaperto il DCF salvato nella sessione (" + salvato.nome + "): assunzioni, cambio e spread come li avevi lasciati.", false);
      }, 400);
    } catch (e) {
      setTimeout(function () { if (typeof mostra === "function") mostra("DCF salvato non riaperto: " + (e && e.message ? e.message : e), true); }, 400);
    }
  }
  setInterval(riprendiSalvato, 700);
  window.__dcfRipresaFatta = function () { return ripresaFatta; };

  /* «Riaggiorna tutto» della suite: dati nuovi dallo ZIP dell'azienda (nuovo
     TTM o nuovo annuale), poi le assunzioni che c'erano prima. */
  window.__dcfAggiornaDaZip = async function (file) {
    ripresaFatta = true;
    var prima = typeof window.__dcfAssunzioni === "function" ? window.__dcfAssunzioni() : null;
    var storicoPrima = typeof window.__dcfStorico === "function" ? window.__dcfStorico() : null;
    var annoPrima = storicoPrima && storicoPrima.esercizi ? Object.keys(storicoPrima.esercizi).sort().pop() : null;
    await carica(file);
    var nuovo = null;
    for (var i = 0; i < 75; i++) {
      await attendi(400);
      nuovo = window.__dcfStorico();
      if (nuovo && nuovo !== storicoPrima) break;
    }
    if (!nuovo || nuovo === storicoPrima) return { ok: false, messaggio: "i dati nuovi non sono entrati nel DCF: riprova con «↻ Aggiorna il DCF»" };
    // I riquadri di Fase 0 ricostruiscono la serie a ogni file: si aspetta che smetta di cambiare.
    var fermoDa = Date.now(), ultimo = nuovo;
    for (var j = 0; j < 100 && Date.now() - fermoDa < 2500; j++) {
      await attendi(300);
      var ora = window.__dcfStorico();
      if (ora !== ultimo) { ultimo = ora; fermoDa = Date.now(); }
    }
    nuovo = ultimo;
    if (prima) {
      try { window.__dcfApplica(prima); } catch (e) { return { ok: false, messaggio: "dati aggiornati, ma le assunzioni di prima non si sono riapplicate: " + (e && e.message ? e.message : e) }; }
      await attendi(800);
    }
    var annoDopo = nuovo.esercizi ? Object.keys(nuovo.esercizi).sort().pop() : null;
    var periodo = annoDopo ? String(annoDopo).replace(".", ",") : "";
    mostra("✓ DCF aggiornato con i dati nuovi" + (periodo ? " (ultimo periodo " + periodo + (annoPrima && annoPrima !== annoDopo ? ", prima " + String(annoPrima).replace(".", ",") : "") + ")" : "") +
      (prima ? ": riapplicate le assunzioni di prima (crescite, margini, azioni, cambio, spread scritto a mano)." : "."), false);
    return { ok: true, messaggio: "ultimo periodo " + (periodo || "—") + (prima ? " · assunzioni di prima riapplicate" : " · assunzioni predefinite (non c'era un DCF)") };
  };

  /* ---------- interfaccia ---------- */
  var stile = document.createElement("style");
  stile.textContent =
    ".zipdcf{position:fixed;right:16px;bottom:16px;z-index:9999;max-width:340px;font-family:Segoe UI,system-ui,sans-serif;font-size:13px}" +
    ".zipdcf__btn{background:#c8641e;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(17,48,78,.25);font-family:inherit;font-size:13px}" +
    ".zipdcf__btn:disabled{opacity:.6;cursor:default}" +
    ".zipdcf__esito{margin-top:8px;background:#fff;border:1px solid #d8e0e7;border-radius:8px;padding:9px 11px;color:#1c2b38;line-height:1.45;box-shadow:0 4px 14px rgba(17,48,78,.12)}" +
    ".zipdcf__esito--errore{border-color:#a83232;color:#a83232}" +
    ".zipdcf__chiudi{float:right;background:none;border:0;cursor:pointer;color:#5b6b7a;font-size:14px;margin-left:6px}" +
    /* riquadro in cima a «Carica file» */
    ".zipdcf-box{background:#fff;border:2px solid #c8641e;border-radius:12px;padding:16px 18px;margin:0 0 18px 0;font-family:inherit}" +
    ".zipdcf-box__testa{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}" +
    ".zipdcf-box__titolo{font-weight:600;font-size:15px;color:#11304e}" +
    ".zipdcf-box__aiuto{margin:6px 0 10px;color:#5b6b7a;font-size:13px;line-height:1.45}" +
    ".zipdcf-box__zona{border:1.5px dashed #c8641e;border-radius:10px;background:#fdf5ef;padding:18px;text-align:center;color:#8a4a1a;cursor:pointer;font-size:13.5px}" +
    ".zipdcf-box__zona--sopra{background:#f9e3d3}" +
    ".zipdcf-box .zipdcf__esito{box-shadow:none}";
  document.head.appendChild(stile);

  /* Pulsante flottante: serve nelle altre schermate, dove il riquadro non c'è. */
  var box = document.createElement("div");
  box.className = "zipdcf";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "zipdcf__btn";
  btn.textContent = "📦 Carica ZIP dell'azienda";
  btn.title = "Carica lo ZIP delle fasi precedenti: sostituisce i file già caricati in Fase 0";
  var input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,application/zip,application/x-zip-compressed";
  input.hidden = true;
  var esito = document.createElement("div");
  esito.hidden = true;
  box.appendChild(btn);
  box.appendChild(input);
  box.appendChild(esito);
  document.body.appendChild(box);

  /* Riquadro in cima a «Fase 0 → Carica file», sopra i riquadri JSON. */
  var riquadro = document.createElement("div");
  riquadro.className = "zipdcf-box";
  riquadro.innerHTML =
    '<div class="zipdcf-box__testa"><span class="zipdcf-box__titolo">📦 ZIP delle fasi precedenti</span></div>' +
    '<p class="zipdcf-box__aiuto">Lo ZIP della suite (riclassificazioni SP, CE e RF di ogni esercizio, analisi di Redditività e solvibilità, ' +
    'salvataggio di Quality of Earnings) entra qui in un colpo solo: ogni file va nel riquadro del suo tipo. ' +
    'Sostituisce i file già caricati, quindi usa lo ZIP ultimo e definitivo.</p>' +
    '<div class="zipdcf-box__zona" role="button" tabindex="0">Trascina qui lo ZIP o fai clic per selezionarlo</div>';
  var zona = riquadro.querySelector(".zipdcf-box__zona");
  var esitoRiquadro = document.createElement("div");
  esitoRiquadro.hidden = true;
  riquadro.appendChild(esitoRiquadro);
  zona.onclick = function () { input.click(); };
  zona.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  zona.ondragover = function (e) { e.preventDefault(); zona.classList.add("zipdcf-box__zona--sopra"); };
  zona.ondragleave = function () { zona.classList.remove("zipdcf-box__zona--sopra"); };

  /* Il riquadro si rimette al suo posto ogni volta che la pagina ridisegna
     «Carica file»; il pulsante flottante compare solo dove il riquadro manca. */
  function posiziona() {
    var area = document.querySelector(".area-caricamento");
    if (area && riquadro.nextSibling !== area) area.parentNode.insertBefore(riquadro, area);
    if (!area && riquadro.parentNode) riquadro.parentNode.removeChild(riquadro);
    box.style.display = area ? "none" : "";
  }
  new MutationObserver(posiziona).observe(document.body, { childList: true, subtree: true });
  posiziona();

  /* Uno ZIP lasciato cadere ovunque (anche su un riquadro JSON) viene letto qui:
     i riquadri della pagina accettano solo JSON e lo scarterebbero. */
  window.addEventListener("dragover", function (e) {
    if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (i) { return /zip/i.test(i.type); })) e.preventDefault();
  }, true);
  window.addEventListener("drop", function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    var zip = files && Array.prototype.find.call(files, function (f) { return /\.zip$/i.test(f.name) || /zip/i.test(f.type); });
    if (!zip) return;
    e.preventDefault();
    e.stopPropagation();
    zona.classList.remove("zipdcf-box__zona--sopra");
    carica(zip);
  }, true);

  function scrivi(el, testo, errore) {
    el.hidden = false;
    el.className = "zipdcf__esito" + (errore ? " zipdcf__esito--errore" : "");
    el.textContent = testo;
    var x = document.createElement("button");
    x.className = "zipdcf__chiudi";
    x.type = "button";
    x.textContent = "✕";
    x.onclick = function () { el.hidden = true; };
    el.prepend(x);
  }
  function mostra(testo, errore) {
    scrivi(esito, testo, errore);
    scrivi(esitoRiquadro, testo, errore);
  }
  function occupato(si) {
    btn.disabled = si;
    btn.textContent = si ? "⏳ Lettura dello ZIP…" : "📦 Carica ZIP dell'azienda";
    zona.textContent = si ? "⏳ Lettura dello ZIP…" : "Trascina qui lo ZIP o fai clic per selezionarlo";
  }

  btn.onclick = function () { input.click(); };
  input.onchange = function () {
    var f = input.files && input.files[0];
    input.value = "";
    if (f) carica(f);
  };

  /* ---------- JSZip: quello della suite, se c'è, altrimenti da cdnjs ---------- */
  var promessaZip = null;
  function jszip() {
    try { if (window.parent && window.parent.JSZip) return Promise.resolve(window.parent.JSZip); } catch (e) {}
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!promessaZip) promessaZip = new Promise(function (ok, ko) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = function () { window.JSZip ? ok(window.JSZip) : ko(new Error("JSZip non disponibile")); };
      s.onerror = function () { promessaZip = null; ko(new Error("JSZip non caricato")); };
      document.head.appendChild(s);
    });
    return promessaZip;
  }

  /* Stessi criteri con cui la pagina riconosce i file. */
  function tipoDi(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    var formato = String(o.formato || ""), app = String(o.applicazione || "");
    if (formato.indexOf("analisi-bilancio") === 0 && o.aziende) return "master";
    if (formato.indexOf("ce-riclassificato") === 0) return "ce";
    if (app.indexOf("Riclassificazione SP") >= 0) return "sp";
    if (o.modulo === "rendiconto_finanziario") return "rf";
    if (app.indexOf("Qualità Contabile") >= 0 || o.fase2 || o.schema === "qoe.output.v1") return "qoe";
    return null;
  }
  var TITOLI = {
    "indici di redditività e solvibilità": "master",
    "riclassificazione — stato patrimoniale": "sp",
    "riclassificazione — conto economico": "ce",
    "rendiconto finanziario": "rf",
    "qualità del bilancio": "qoe"
  };
  var NOMI = { master: "sintesi redditività", sp: "SP", ce: "CE", rf: "RF", qoe: "Quality of Earnings" };

  var attendi = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function riquadri() {
    var out = {};
    document.querySelectorAll(".riquadro-carica").forEach(function (r) {
      var t = r.querySelector(".riquadro-carica__titolo");
      var k = t && TITOLI[t.textContent.trim().toLowerCase()];
      var i = r.querySelector('input[type="file"]');
      if (k && i) out[k] = i;
    });
    return out;
  }
  function clicTesto(selettore, re) {
    var b = Array.prototype.find.call(document.querySelectorAll(selettore), function (x) { return re.test(x.textContent); });
    if (b) b.click();
    return !!b;
  }
  /* Porta la pagina su «Fase 0 → Carica file», dove stanno i riquadri. */
  async function apriCaricamento() {
    for (var i = 0; i < 3; i++) {
      if (Object.keys(riquadri()).length) return riquadri();
      var voci = document.querySelectorAll(".barra__voce");
      if (voci.length) voci[0].click();
      await attendi(250);
      clicTesto(".schede__voce", /Carica file/);
      await attendi(350);
    }
    return riquadri();
  }

  /* Nome dell'azienda di questa scheda: il riquadro della suite si chiama
     «Bilancio pro-forma e DCF · <nome>». */
  function aziendaDellaScheda() {
    try {
      var t = window.frameElement && window.frameElement.title || "";
      var i = t.lastIndexOf("·");
      return i >= 0 ? t.slice(i + 1).trim() : "";
    } catch (e) { return ""; }
  }
  var semplice = function (x) { return String(x || "").toLowerCase().replace(/[^a-z0-9à-ü]+/g, ""); };

  /* Scelta dell'azienda quando lo ZIP della sessione ne contiene più d'una. */
  function mostraScelta(file, gruppi, predefinita) {
    [esito, esitoRiquadro].forEach(function (el) {
      el.hidden = false;
      el.className = "zipdcf__esito";
      el.textContent = "";
      var x = document.createElement("button");
      x.className = "zipdcf__chiudi";
      x.type = "button";
      x.textContent = "✕";
      x.onclick = function () { esito.hidden = true; esitoRiquadro.hidden = true; };
      el.appendChild(x);
      var p = document.createElement("div");
      p.style.cssText = "font-weight:600;color:#11304e;margin-bottom:6px";
      p.textContent = file.name + " contiene " + gruppi.length + " aziende: quale carico in questo DCF?";
      el.appendChild(p);
      gruppi.forEach(function (g) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "zipdcf__scelta";
        var pred = g.cartella === predefinita;
        b.style.cssText = "display:block;width:100%;text-align:left;margin:5px 0;padding:8px 10px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;" +
          (pred ? "background:#c8641e;color:#fff;border:1px solid #c8641e" : "background:#fff;color:#1c2b38;border:1px solid #d8e0e7");
        var riga = document.createElement("div");
        riga.style.fontWeight = "600";
        riga.textContent = g.nome + (g.ruolo ? " · " + g.ruolo : "") + (pred ? " · questa scheda" : "");
        var det = document.createElement("div");
        det.style.cssText = "font-size:12px;opacity:.85;margin-top:2px";
        det.textContent = Object.keys(g.perTipo).filter(function (k) { return g.perTipo[k].length; })
          .map(function (k) { return NOMI[k] + " " + g.perTipo[k].length; }).join(" · ") +
          (!g.perTipo.qoe.length ? " · senza Quality of Earnings (spread informativo non disponibile)"
            : g.spread == null ? " · Quality of Earnings senza spread nello ZIP (versione precedente): si usa quello attuale della suite, se c'è"
            : " · spread informativo " + String(g.spread).replace(".", ",") + "%");
        b.appendChild(riga);
        b.appendChild(det);
        b.onclick = function () { consegnaGruppo(file, g, gruppi.length); };
        el.appendChild(b);
      });
    });
  }

  async function carica(file) {
    occupato(true);
    try {
      var JSZip = await jszip();
      var zip = await JSZip.loadAsync(file);
      /* Indice della sessione: nome e ruolo di ogni cartella «aziende/<X>/». */
      var indice = {};
      var radice = zip.file("sessione.json");
      if (radice) {
        try {
          (JSON.parse(await radice.async("string")).aziende || []).forEach(function (a) {
            if (a && a.cartella) indice[a.cartella] = a;
          });
        } catch (e) {}
      }
      var gruppiDi = {};
      var ignorati = [];
      var conTtm = false;
      var percorsi = Object.keys(zip.files);
      for (var i = 0; i < percorsi.length; i++) {
        var p = percorsi[i], v = zip.files[p];
        if (v.dir || /(^|\/)(__MACOSX\/|\._)/.test(p) || !/\.json$/i.test(p) || /(^|\/)sessione\.json$/i.test(p)) continue;
        // Documenti originali (anche i filing in JSON) e comparazione non sono file della catena.
        if (/(^|\/)(documenti|comparazione)\//i.test(p)) continue;
        var m = /^aziende\/([^\/]+)\//.exec(p);
        var cartella = m ? m[1] : "";
        var testo = await v.async("string");
        var nome = p.split("/").pop();
        var t = null, o = null;
        try { o = JSON.parse(testo); t = tipoDi(o); } catch (e) { t = null; }
        if (!t) {
          if (/"formato"\s*:\s*"bilancio-ttm/.test(testo.slice(0, 400))) { conTtm = true; continue; }
          ignorati.push(nome);
          continue;
        }
        var g = gruppiDi[cartella] || (gruppiDi[cartella] = {
          cartella: cartella,
          nome: (indice[cartella] && indice[cartella].nome) || cartella || file.name.replace(/\.zip$/i, ""),
          ruolo: indice[cartella] && indice[cartella].ruolo || "",
          nomeSessione: indice[cartella] && indice[cartella].nome || null,
          perTipo: { master: [], sp: [], ce: [], rf: [], qoe: [] },
          conTtm: false,
          ignorati: ignorati
        });
        g.perTipo[t].push(new File([testo], nome, { type: "application/json" }));
        if (t === "qoe") g.spread = o.information_risk_premium_pct == null ? null : Number(o.information_risk_premium_pct);
      }
      var gruppi = Object.keys(gruppiDi).map(function (k) { return gruppiDi[k]; });
      if (!gruppi.length) throw new Error("nello ZIP non ci sono file della catena (riclassificazioni, sintesi, Quality of Earnings)");
      gruppi.forEach(function (g) { g.conTtm = conTtm; });
      if (gruppi.length === 1) return await consegnaGruppo(file, gruppi[0], 1);

      // Principale prima, poi in ordine di nome.
      gruppi.sort(function (x, y) {
        return (y.ruolo === "principale") - (x.ruolo === "principale") || x.nome.localeCompare(y.nome);
      });
      var qui = semplice(aziendaDellaScheda());
      var pred = gruppi.find(function (g) { return qui && (semplice(g.nome) === qui || semplice(g.cartella) === qui); });
      occupato(false);
      mostraScelta(file, gruppi, pred ? pred.cartella : null);
    } catch (e) {
      mostra("ZIP non caricato: " + (e && e.message ? e.message : e), true);
      occupato(false);
    }
  }

  /* Consegna ai riquadri di Fase 0 i file di UNA azienda. */
  async function consegnaGruppo(file, gruppo, quante) {
    occupato(true);
    try {
      var perTipo = gruppo.perTipo;
      /* Salvataggio QoE senza spread (versione precedente) o assente: si prende
         quello attuale dalla suite, se c'è e ha lo spread. */
      var dallaSuite = false;
      if (gruppo.spread == null) {
        try {
          var cerca = window.parent && window.parent !== window && window.parent.__suiteQoeAttuale;
          var att = typeof cerca === "function" ? cerca(window, gruppo.nomeSessione) : null;
          var oo = att && att.testo ? JSON.parse(att.testo) : null;
          if (oo && oo.information_risk_premium_pct != null) {
            perTipo.qoe = [new File([att.testo], att.nome || "qoe.json", { type: "application/json" })];
            gruppo.spread = Number(oo.information_risk_premium_pct);
            dallaSuite = true;
          }
        } catch (e) {}
      }
      var mappa = await apriCaricamento();
      if (!Object.keys(mappa).length) throw new Error("apri «Fase 0 — Ingestione», scheda «Carica file», e riprova");

      /* ZIP definitivo: i file già caricati vengono tolti. */
      for (var n = 0; n < 200; n++) {
        var x = document.querySelector(".riquadro-carica__rimuovi");
        if (!x) break;
        x.click();
        await attendi(30);
      }
      await attendi(200);
      mappa = riquadri();

      var mancanti = [];
      Object.keys(perTipo).forEach(function (k) {
        if (!perTipo[k].length) return;
        var el = mappa[k];
        if (!el) { mancanti.push(NOMI[k]); return; }
        var dt = new DataTransfer();
        perTipo[k].forEach(function (f) { dt.items.add(f); });
        el.files = dt.files;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      var riepilogo = Object.keys(perTipo).filter(function (k) { return perTipo[k].length; })
        .map(function (k) { return NOMI[k] + " " + perTipo[k].length; }).join(" · ");
      mostra("✓ " + file.name + (quante > 1 ? " → " + gruppo.nome : "") + ": " + riepilogo + "." +
        (!perTipo.qoe.length ? " Nessun salvataggio di Quality of Earnings per questa azienda: lo spread da rischio informativo resta a zero."
          : gruppo.spread == null ? " Il salvataggio di Quality of Earnings di " + gruppo.nome + " è di una versione precedente e non contiene lo spread: nella suite apri Quality of Earnings su " + gruppo.nome + ", poi riscarica lo ZIP."
          : " Spread da rischio informativo dal Quality of Earnings" + (dallaSuite ? " attuale della suite (quello nello ZIP non lo conteneva)" : "") + ": " + String(gruppo.spread).replace(".", ",") + "%.") +
        (mancanti.length ? " Riquadri non trovati: " + mancanti.join(", ") + "." : "") +
        (gruppo.ignorati.length ? " Ignorati: " + gruppo.ignorati.join(", ") + "." : "") +
        (gruppo.conTtm ? " Il bilancio TTM arriva dentro la sintesi di Redditività e solvibilità come periodo più recente (anno base): imposta la data di valutazione alla sua data di riferimento." : ""), false);
      if (quante > 1) {
        [esito, esitoRiquadro].forEach(function (el) {
          var c = document.createElement("button");
          c.type = "button";
          c.style.cssText = "display:block;margin-top:6px;background:none;border:0;padding:0;color:#c8641e;cursor:pointer;font-family:inherit;font-size:12.5px;text-decoration:underline";
          c.textContent = "Carica un'altra azienda dello stesso ZIP";
          c.onclick = function () { carica(file); };
          el.appendChild(c);
        });
      }
    } catch (e) {
      mostra("ZIP non caricato: " + (e && e.message ? e.message : e), true);
    } finally {
      occupato(false);
    }
  }
})();
`;

/* Correzione mirata del codice compilato: la funzione che legge l'anno di un
   esercizio («Oo») teneva solo le quattro cifre, quindi la chiave «2025.5» di
   un periodo TTM finiva sopra il bilancio annuale 2025, sostituendolo. Ora una
   chiave decimale resta decimale; per tutto il resto non cambia nulla. */
const ANNO_ORIGINALE = 'function Oo(r){if(r==null)return null;if(typeof r=="number"&&r>1900&&r<2200)return Math.trunc(r);';
const ANNO_CORRETTO = 'function Oo(r){if(r==null)return null;if(typeof r=="number"&&r>1900&&r<2200)return Math.trunc(r);if(/^\\s*(19|20)\\d{2}\\.\\d+\\s*$/.test(String(r)))return Number(r);';

/* Numero di azioni nella STESSA scala degli importi. Nella suite importi e
   azioni sono in milioni: valore per azione = equity ÷ azioni e
   capitalizzazione = prezzo × azioni, senza il fattore 1000 che la pagina
   applicava (pensata per importi in migliaia e azioni in unità). Il campo
   diventa «Numero di azioni (milioni)» e l'esempio dimostrativo, in migliaia,
   porta le azioni in migliaia (12.000) perché i conti restino giusti. */
const SCALA_AZIONI = [
  ["C.valorePerAzione=C.equityAssetSide*1e3/u.numeroAzioni", "C.valorePerAzione=C.equityAssetSide/u.numeroAzioni"],
  ["(u.prezzoMercatoAzione*u.numeroAzioni/1e3)", "(u.prezzoMercatoAzione*u.numeroAzioni)"],
  ["d.prezzoMercato*g.numeroAzioni/1e3", "d.prezzoMercato*g.numeroAzioni"],
  ['etichetta:"Numero di azioni",children:a.jsx(ze,{valore:u.numeroAzioni,onCambia:S=>f("numeroAzioni",S),passo:1e3,min:0,cifre:0})',
   'etichetta:"Numero di azioni (milioni, stessa scala degli importi)",children:a.jsx(ze,{valore:u.numeroAzioni,onCambia:S=>f("numeroAzioni",S),passo:1,min:0,cifre:2})'],
  ["numeroAzioni:12e6,", "numeroAzioni:12e3,"],
];

/* Spread da rischio informativo: il QoE lo scrive in punti percentuali
   («information_risk_premium_pct»: 0.32 = 0,32%). La pagina lo leggeva con la
   regola generica «sopra 1 è una percentuale, sotto 1 è già una frazione», che
   per uno spread tipico (sotto l'1%) dava 32% invece di 0,32%. Ora il campo _pct
   si divide sempre per 100; se manca si usa quello in punti base. */
const SPREAD_ORIGINALE = "const h=Fo(r.information_risk_premium_pct),p=lt(r.accounting_trust_score);";
const SPREAD_CORRETTO = "const h=(lt(r.information_risk_premium_pct)!==null?lt(r.information_risk_premium_pct)/100:lt(r.information_risk_premium_bps)!==null?lt(r.information_risk_premium_bps)/1e4:null),p=lt(r.accounting_trust_score);";

/* Prezzo e valore per azione anche in euro. Il cambio (quanti <valuta> per
   1 euro) sta in assunzioni.valutazione.cambioEur: vuoto = cambio BCE del giorno
   letto dallo script del ponte. La valutazione se lo porta dietro (cambioEur)
   e ogni punto che mostra un valore per azione aggiunge «(€ …)». */
const EUR = (v, c, val) => `(window.__dcfEur?window.__dcfEur(${v},${c},${val}):"")`;
const EURO_PER_AZIONE = [
  ["return u.numeroAzioni&&(C.valorePerAzione=C.equityAssetSide/u.numeroAzioni),C}",
   "return C.cambioEur=u.cambioEur||null,u.numeroAzioni&&(C.valorePerAzione=C.equityAssetSide/u.numeroAzioni),C}"],
  ['onCambia:S=>f("prezzoMercatoAzione",S>0?S:null),passo:.1,min:0,cifre:2})}),',
   'onCambia:S=>f("prezzoMercatoAzione",S>0?S:null),passo:.1,min:0,cifre:2})}),' +
   '(window.__dcfCambioAuto&&(s.valuta||"EUR").toUpperCase()!=="EUR")?a.jsx(ge,{etichetta:`Cambio: ${s.valuta} per 1 euro`,' +
   'aiuto:window.__dcfNotaCambio(s.valuta,u.cambioEur,u.prezzoMercatoAzione),' +
   'children:a.jsx(ze,{valore:u.cambioEur??(window.__dcfCambioAuto(s.valuta)||0),onCambia:S=>f("cambioEur",S>0?S:null),passo:.0001,min:0,cifre:4})}):null,'],
  ["H.valutazione.prezzoMercatoAzione=(($=h==null?void 0:h.valutazione)==null?void 0:$.prezzoMercatoAzione)??null,",
   "H.valutazione.prezzoMercatoAzione=(($=h==null?void 0:h.valutazione)==null?void 0:$.prezzoMercatoAzione)??null,H.valutazione.cambioEur=h&&h.valutazione&&h.valutazione.cambioEur||null,"],
  ['aiuto:"Dato esterno al modello: serve solo come termine di confronto per il giudizio finale.",children:a.jsx(ze,{valore:y??0,onCambia:G,',
   'aiuto:"Dato esterno al modello: serve solo come termine di confronto per il giudizio finale."+(y?" In euro:"+(' + EUR("y", "f.cambioEur", "l.valuta") + ').replace(/[()]/g,""):""),children:a.jsx(ze,{valore:y??0,onCambia:G,'],
  ['etichetta:"Valore intrinseco per azione",valore:f.valorePerAzione!==null?`${l.valuta} ${O(f.valorePerAzione,2)}`',
   'etichetta:"Valore intrinseco per azione",valore:f.valorePerAzione!==null?`${l.valuta} ${O(f.valorePerAzione,2)}${' + EUR("f.valorePerAzione", "f.cambioEur", "l.valuta") + '}`'],
  ['{etichetta:"Valore per azione",valori:[`${l.valuta} ${O(f.valorePerAzione,2)}`]',
   '{etichetta:"Valore per azione",valori:[`${l.valuta} ${O(f.valorePerAzione,2)}${' + EUR("f.valorePerAzione", "f.cambioEur", "l.valuta") + '}`]'],
  ['a.jsx(J,{etichetta:"Valore per azione",valore:`${l.valuta} ${O(s.valorePerAzione,2)}`})',
   'a.jsx(J,{etichetta:"Valore per azione",valore:`${l.valuta} ${O(s.valorePerAzione,2)}${' + EUR("s.valorePerAzione", "s.cambioEur", "l.valuta") + '}`})'],
  ['["per azione: ",l.valuta," ",O(k.valorePerAzione,2)]',
   '["per azione: ",l.valuta," ",O(k.valorePerAzione,2),' + EUR("k.valorePerAzione", "k.cambioEur", "l.valuta") + ']'],
  ['["Valore intrinseco per azione (DCF)",`${h} ${ie(l.valorePerAzione,2)}`]',
   '["Valore intrinseco per azione (DCF)",`${h} ${ie(l.valorePerAzione,2)}${' + EUR("l.valorePerAzione", "l.cambioEur", "h") + '}`]'],
  ['["Prezzo corrente di mercato",`${h} ${ie(d.prezzoMercato,2)}`]',
   '["Prezzo corrente di mercato",`${h} ${ie(d.prezzoMercato,2)}${' + EUR("d.prezzoMercato", "l.cambioEur", "h") + '}`]'],
  ['["Differenza per azione",`${h} ${ie(l.valorePerAzione-d.prezzoMercato,2)}`]',
   '["Differenza per azione",`${h} ${ie(l.valorePerAzione-d.prezzoMercato,2)}${' + EUR("l.valorePerAzione-d.prezzoMercato", "l.cambioEur", "h") + '}`]'],
  ['["Valore intrinseco per azione",`${p} ${ie(l.valorePerAzione,2)}`]',
   '["Valore intrinseco per azione",`${p} ${ie(l.valorePerAzione,2)}${' + EUR("l.valorePerAzione", "l.cambioEur", "p") + '}`]'],
];

/* Spread da rischio informativo sempre allineato a Quality of Earnings della
   suite: il gestore delle assunzioni espone un setter (__dcfImpostaSpread) che
   lo scrive finché non lo modifichi a mano (spreadManuale); il campo mostra
   da dove arriva il valore. */
const SPREAD_DALLA_SUITE = [
  ["aggiornaAssunzioni(R){p(H=>({...H,...R}))},",
   "aggiornaAssunzioni(R){p(H=>({...H,...R}))},__spread:(window.__dcfImpostaSpread=function(x){p(function(H){return H&&H.valutazione&&!H.valutazione.spreadManuale&&Number.isFinite(x)&&Math.abs((H.valutazione.spreadInformativo||0)-x)>1e-9?{...H,valutazione:{...H.valutazione,spreadInformativo:x}}:H})}),"],
  ["aiuto:((p=s.qoe)==null?void 0:p.spreadRischioInformativo)!==null",
   "aiuto:(window.__dcfNotaSpread&&window.__dcfNotaSpread(u))||(((p=s.qoe)==null?void 0:p.spreadRischioInformativo)!==null"],
  ['impostabile manualmente.",children:a.jsx(ze,{valore:u.spreadInformativo*100,onCambia:S=>f("spreadInformativo",S/100)',
   'impostabile manualmente."),children:a.jsx(ze,{valore:u.spreadInformativo*100,onCambia:S=>l({valutazione:{...u,spreadInformativo:S>0?S/100:(window.__dcfSpreadSuiteOra&&window.__dcfSpreadSuiteOra())??0,spreadManuale:S>0&&!(window.__dcfSpreadSuiteOra&&window.__dcfSpreadSuiteOra()!==null&&Math.abs(window.__dcfSpreadSuiteOra()*100-S)<1e-6)}})'],
];

/* Salvataggio e ripristino automatici per lo ZIP della sessione: il
   gestore espone l'esportazione JSON (la stessa di «Scarica il JSON», con gli
   indici storici) e la ripresa di un'analisi (la stessa di «Riapri questa
   analisi»). Le assunzioni ricaricate tengono anche cambio ed eventuale spread
   scritto a mano: le chiavi vanno nel modello predefinito, altrimenti la
   ripresa le scarterebbe. */
const SALVA_RIPRENDI = [
  ["aggiornaAssunzioni(R){p(H=>({...H,...R}))},",
   "aggiornaAssunzioni(R){p(H=>({...H,...R}))}," +
   "__esporta:(window.__dcfEsporta=function(){if(!l||!h||!C||!k)return null;const K=Cd(C,h,k.costoCapitale.wacc,k.terminalValueAsset);return $m({storico:l,assunzioni:h,proforma:C,valutazione:k,quadri:d,banca:K,crescita:wd(C),leve:Nd(C)})})," +
   "__riprendi:(window.__dcfRiprendi=function(I){const G=Gm(I),V=Km(I,G);if(!V||!V.storico)throw new Error(\"il file non contiene la serie storica\");b.riprendiAnalisi(V.storico,G);return!0})," +
   "__haDati:(window.__dcfHaDati=function(){return!!l})," +
   "__storico:(window.__dcfStorico=function(){return l})," +
   "__assunzioni:(window.__dcfAssunzioni=function(){return h})," +
   "__applica:(window.__dcfApplica=function(A){b.impostaAssunzioni(A)}),"],
  ["numeroAzioni:0,prezzoMercatoAzione:null,spreadInformativo:0}",
   "numeroAzioni:0,prezzoMercatoAzione:null,spreadInformativo:0,cambioEur:null,spreadManuale:!1}"],
];

/** La pagina del programma con lo script del ZIP in coda. */
export function paginaDcfConZip(html) {
  if (html.includes(ANNO_ORIGINALE)) html = html.replace(ANNO_ORIGINALE, ANNO_CORRETTO);
  for (const [prima, dopo] of SCALA_AZIONI) html = html.split(prima).join(dopo);
  if (html.includes(SPREAD_ORIGINALE)) html = html.replace(SPREAD_ORIGINALE, SPREAD_CORRETTO);
  for (const [prima, dopo] of [...EURO_PER_AZIONE, ...SPREAD_DALLA_SUITE, ...SALVA_RIPRENDI]) {
    if (html.split(prima).length !== 2) console.warn("ponte-dcf: punto da correggere non trovato o non univoco", prima.slice(0, 60));
    html = html.split(prima).join(dopo);
  }
  const codice = `<script>${SCRIPT_PONTE.replace(/<\/script/gi, "<\\/script")}</script>`;
  const i = html.lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + codice + html.slice(i) : html + codice;
}
