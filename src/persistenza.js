/* =============================================================================
   Salvataggio della sessione dentro l'artifact.

   - L'indice della sessione (aziende, esercizi, nomi dei file, stato della
     coda) è un documento del database dell'artifact: «sessione/corrente».
   - I file veri (PDF caricati, JSON delle riclassificazioni, analisi di
     Redditività e solvibilità, salvataggio di Quality of Earnings) sono
     «assets» dell'artifact: l'indice ne conserva solo l'id.

   Fuori dall'artifact (hosting con chiave API) o per chi vede l'artifact in
   sola lettura, apriPersistenza() restituisce null e la suite funziona come
   prima, senza salvataggio.
   ============================================================================= */

const PERCORSO = "sessione/corrente";
const LIMITE_FILE = 20 * 1024 * 1024;

const TIPI = { pdf: "application/pdf", json: "application/json", txt: "text/plain", md: "text/markdown", csv: "text/csv" };
const tipoDa = (nome, blob) => {
  const est = String(nome || "").toLowerCase().split(".").pop();
  if (TIPI[est]) return TIPI[est];
  const t = String(blob?.type || "").split(";")[0].trim();
  return Object.values(TIPI).includes(t) ? t : null;
};

export async function apriPersistenza() {
  try {
    if (typeof window === "undefined" || !window.claude?.use) return null;
    const [db, assets] = await Promise.all([
      window.claude.use("db").catch(() => null),
      window.claude.use("assets").catch(() => null),
    ]);
    if (!db || !assets) return null;
    return creaPersistenza(db, assets);
  } catch {
    return null;
  }
}

function creaPersistenza(db, assets) {
  /* Un caricamento per oggetto: lo stesso File o Blob non viene ricaricato. */
  let caricati = new WeakMap(); // Blob -> Promise<id|null>
  const testi = new Map(); // testo -> Promise<id|null> (analisi, QoE)
  const errori = [];

  async function carica(blob, nome) {
    if (!blob) return null;
    if (caricati.has(blob)) return caricati.get(blob);
    const p = (async () => {
      const tipo = tipoDa(nome, blob);
      if (!tipo) { errori.push(`${nome}: formato non salvabile`); return null; }
      if (blob.size > LIMITE_FILE) { errori.push(`${nome}: oltre 20 MB, non salvato`); return null; }
      if (!blob.size) return null;
      for (let tentativo = 0; tentativo < 2; tentativo++) {
        try {
          const r = await assets.upload(blob, { type: tipo });
          return r.id;
        } catch (e) {
          if (e?.code === "store_unavailable" && tentativo === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
          errori.push(`${nome}: ${e?.code === "quota_or_state" ? "spazio esaurito" : e?.message || e?.code || "non salvato"}`);
          return null;
        }
      }
      return null;
    })();
    caricati.set(blob, p);
    p.then((id) => { if (!id) caricati.delete(blob); });
    return p;
  }

  async function caricaTesto(testo, nome) {
    if (!testo) return null;
    /* L'ora di generazione cambia a ogni esportazione: non conta come modifica. */
    const chiave = String(testo).replace(/"(generato|generatoIl|generataIl|generato_il|salvatoIl)"\s*:\s*"\d{4}-[^"]*"/g, '"$1":""');
    if (testi.has(chiave)) return testi.get(chiave);
    const p = carica(new Blob([testo], { type: "application/json" }), nome);
    testi.set(chiave, p);
    if (testi.size > 40) testi.delete(testi.keys().next().value);
    return p;
  }

  /* Il blob caricato ha già un id: lo si registra senza ricaricarlo. */
  const ricorda = (blob, id) => { if (blob && id) caricati.set(blob, Promise.resolve(id)); };
  const ricordaTesto = (testo, id) => {
    if (testo && id) testi.set(String(testo).replace(/"(generato|generatoIl|generataIl|generato_il|salvatoIl)"\s*:\s*"\d{4}-[^"]*"/g, '"$1":""'), Promise.resolve(id));
  };

  async function leggiFile(id, nome, tipo) {
    const r = await fetch("/_blob/" + id);
    if (!r.ok) throw new Error(`${nome}: non più disponibile (${r.status})`);
    const b = await r.blob();
    const f = new File([b], nome, { type: tipo || b.type || tipoDa(nome) || "" });
    ricorda(f, id);
    return f;
  }
  async function leggiTesto(id) {
    const r = await fetch("/_blob/" + id);
    if (!r.ok) throw new Error(`file salvato non più disponibile (${r.status})`);
    const t = await r.text();
    ricordaTesto(t, id);
    return t;
  }

  async function leggiIndice() {
    const snap = await db.doc(PERCORSO).get();
    return snap.exists ? snap.data() : null;
  }
  let ultimiId = null; // id referenziati dall'ultimo indice scritto
  async function scriviIndice(indice, idReferenziati) {
    await db.doc(PERCORSO).set(JSON.parse(JSON.stringify(indice)));
    /* Gli asset che l'indice precedente usava e questo no (file sostituiti o
       tolti) vengono eliminati: nessun altro documento li indica. */
    if (ultimiId) {
      const ora = new Set(idReferenziati);
      for (const id of ultimiId) if (!ora.has(id)) assets.delete(id).catch(() => {});
    }
    ultimiId = [...new Set(idReferenziati)];
  }
  const impostaRiferimenti = (ids) => { ultimiId = [...new Set(ids)]; };

  async function uso() {
    try { return (await assets.list()).usage; } catch { return null; }
  }
  /* «Svuota sessione salvata»: indice e tutti i file. */
  async function svuota() {
    await db.doc(PERCORSO).delete().catch(() => {});
    const { assets: tutti } = await assets.list();
    for (const a of tutti) await assets.delete(a.id).catch(() => {});
    ultimiId = [];
    testi.clear();
    caricati = new WeakMap();
  }

  return { carica, caricaTesto, leggiFile, leggiTesto, leggiIndice, scriviIndice, impostaRiferimenti, uso, svuota, errori };
}
