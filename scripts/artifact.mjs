/* Impacchetta la build di Vite in un'unica pagina per l'artifact di Claude.
   Uso: npm run build && node scripts/artifact.mjs <out.html> */
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const dist = new URL("../dist/", import.meta.url).pathname;
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const js = html.match(/<script type="module" crossorigin src="\/(assets\/[^"]+\.js)"/)[1];
const css = html.match(/<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+\.css)"/)[1];
const codice = fs.readFileSync(path.join(dist, js), "utf8").replace(/<\/script/gi, "<\\/script");
const stile = fs.readFileSync(path.join(dist, css), "utf8");
const pagina = `<title>Riclassificazione di bilancio</title>
<style>
:root { --fondo: #f8fafc; color-scheme: light; }
body { background: var(--fondo); }
${stile}
</style>
<div id="root"></div>
<script type="module">
${codice}
</script>
`;
fs.writeFileSync(out, pagina);
console.log(`Pagina artifact: ${out} (${(pagina.length / 1024).toFixed(0)} KB)`);
