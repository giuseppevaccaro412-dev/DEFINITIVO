/* Controlla che i tre programmi in src/moduli siano identici agli originali
   registrati in scripts/moduli.sha256. Se aggiorni un programma, sostituisci
   il file e rigenera l'impronta con:  sha256sum src/moduli/*.jsx > scripts/moduli.sha256 */
import { createHash } from "node:crypto";
import fs from "node:fs";

const righe = fs.readFileSync(new URL("./moduli.sha256", import.meta.url), "utf8").trim().split("\n");
let ok = true;
for (const r of righe) {
  const [atteso, percorso] = r.split(/\s+\*?/);
  const reale = createHash("sha256").update(fs.readFileSync(percorso)).digest("hex");
  const uguale = reale === atteso;
  ok &&= uguale;
  console.log(`${uguale ? "✓ invariato " : "✗ MODIFICATO"}  ${percorso}`);
}
if (!ok) {
  console.error("\nUno dei programmi è diverso dall'originale registrato: se è voluto, rigenera scripts/moduli.sha256.");
  process.exit(1);
}
