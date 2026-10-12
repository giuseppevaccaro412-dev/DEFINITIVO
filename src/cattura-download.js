/* =============================================================================
   Salvataggi dei programmi («Salva dati»).

   I programmi salvano creando un Blob, un URL e un link <a download> su cui
   fanno click. Qui si ricorda il Blob di ogni URL creato e si intercetta quel
   click, senza modificare i programmi:
   - se la schermata ha chiesto di catturare il prossimo salvataggio (per
     passare i JSON di SP e CE al tab 4 del Rendiconto), il file viene
     consegnato alla schermata e non scaricato;
   - nell'artifact di Claude, dove i link di download sono inerti, il file
     passa alla capability «downloads» (chi guarda conferma il salvataggio);
   - altrimenti il click prosegue normalmente.
   ============================================================================= */
import { modalitaArtifact } from "./ponte-artifact.js";

let attesa = null; // { risolvi, timer }

export function catturaProssimoDownload(ms = 15_000) {
  if (attesa) { clearTimeout(attesa.timer); attesa.risolvi(null); }
  return new Promise((risolvi) => {
    const timer = setTimeout(() => { attesa = null; risolvi(null); }, ms);
    attesa = { risolvi, timer };
  });
}

let creaUrl = null;
let clickNativo = null;

/* Consegna un file a chi usa la pagina: download normale su Vercel,
   capability «downloads» nell'artifact. Ritorna "salvato" | "annullato" | "non disponibile". */
export async function consegnaAllUtente(nome, blob) {
  if (modalitaArtifact) {
    const dl = window.claude?.use ? await window.claude.use("downloads") : null;
    if (!dl) return "non disponibile";
    try { await dl.save({ filename: nome, data: blob }); return "salvato"; }
    catch (e) { return e?.code === "declined" ? "annullato" : "non disponibile"; }
  }
  const a = document.createElement("a");
  const u = creaUrl(blob);
  a.href = u;
  a.download = nome;
  document.body.appendChild(a);
  clickNativo.call(a);
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
  return "salvato";
}

if (typeof window !== "undefined") {
  const blobDiUrl = new Map();
  const creaOriginale = URL.createObjectURL.bind(URL);
  creaUrl = creaOriginale;
  URL.createObjectURL = (oggetto) => {
    const u = creaOriginale(oggetto);
    if (oggetto instanceof Blob) {
      blobDiUrl.set(u, oggetto);
      setTimeout(() => blobDiUrl.delete(u), 60_000);
    }
    return u;
  };

  const clickOriginale = HTMLAnchorElement.prototype.click;
  clickNativo = clickOriginale;
  HTMLAnchorElement.prototype.click = function () {
    const blob = this.download && blobDiUrl.get(this.href);
    if (!blob) return clickOriginale.call(this);
    const nome = this.download;

    if (attesa) {
      const { risolvi, timer } = attesa;
      attesa = null;
      clearTimeout(timer);
      risolvi({ nome, blob });
      return;
    }
    if (!modalitaArtifact) return clickOriginale.call(this);

    (async () => {
      const dl = window.claude?.use ? await window.claude.use("downloads") : null;
      if (!dl) return;
      try { await dl.save({ filename: nome, data: blob }); }
      catch (e) { if (e?.code !== "declined") console.warn("Salvataggio non riuscito:", e?.code, e?.message); }
    })();
  };
}
