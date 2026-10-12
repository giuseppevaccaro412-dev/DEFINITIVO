# Suite di riclassificazione

Una schermata per caricare i documenti una sola volta. I file passano ai tre programmi
originali, che partono insieme e restano invariati nelle schede SP, CE e RF.

## Struttura
- `src/moduli/`: i quattro programmi originali. Unica aggiunta: SP e CE accettano la prop
  `annoRiferimento` (l'esercizio T scritto nella suite); senza prop si comportano come prima
  (default 2025). `npm run build` controlla l'impronta con `scripts/moduli.sha256`.
- `src/App.jsx`: la schermata di caricamento e le tre schede.
- `api/chat.js` (usato dallo SP) e `api/anthropic.js` (usato da CE e RF): i proxy. Se nel tuo
  progetto Vercel hai già i tuoi proxy funzionanti, sostituisci questi file con i tuoi.

## Come funziona
1. Aggiungi un esercizio per ogni anno («+ Aggiungi esercizio»), scrivi tu l'anno e carica
   prospetti (obbligatori), Nota Integrativa e Relazione sulla Gestione.
2. «Avvia» fa girare gli esercizi uno alla volta, dal più vecchio. Tra un esercizio e l'altro i
   tre programmi vengono rimontati da zero. Per ogni esercizio, in parallelo in SP, CE e RF:
   prospetti T → NI T → RG T → documenti dell'esercizio precedente come T-1 (se caricati;
   altrimenti i programmi usano la colonna comparativa) → JSON di SP e CE nel tab 4 dell'RF →
   salvataggio dei tre JSON (gli stessi di «Salva dati»).
3. Un passo parte quando le chiamate IA del passo precedente sono finite in tutti e tre i
   programmi, cioè dopo 25 secondi senza richieste.
4. «Riclassificazioni pronte»: tabella per esercizio con i file (clic per scaricarne uno solo)
   e «Scarica ZIP», con una cartella per esercizio (`2024-2025/`, `2025-2026/`, …) che contiene
   i JSON di SP, CE e RF. Se un programma ha letto un esercizio diverso da quello che hai scritto,
   la tabella lo segnala.
5. Scegliere l'esercizio da vedere: nella tabella, «Visualizza» carica nelle schede SP, CE e RF i
   JSON di quell'esercizio (con «Carica dati salvati» dei programmi). Le modifiche fatte nelle
   schede vengono riprese (con «Salva dati») quando passi a un altro esercizio, scarichi lo ZIP o un
   singolo file. Se modifichi SP o CE, il tab 4 dell'RF riceve i JSON aggiornati prima di salvare
   l'RF. La barra in alto mostra «In vista: 2025-2026».
6. «Riapri sessione da ZIP» (in alto): carica lo ZIP scaricato da qui (anche estratto e ricompresso)
   e riapre l'azienda: esercizi, JSON di SP, CE e RF nelle schede, tabella dei risultati. Puoi aggiungere
   nuovi esercizi: vengono elaborati solo quelli con documenti caricati, gli altri restano come sono.
   Lo ZIP contiene anche `sessione.json` (azienda ed elenco degli esercizi).
7. Controllo reale dell'esito: un passo è «fatto» solo se Claude ha risposto davvero, e un esercizio è
   riuscito solo se i JSON salvati contengono voci (la tabella mostra «N voci T · N voci T-1» o
   «✗ vuoto»). Prima di partire la schermata verifica che Claude sia raggiungibile e autorizzato.
   I documenti lunghi non vengono più tagliati dall'inizio: si inviano le pagine più pertinenti.
8. Esercizio di riferimento: l'anno che scrivi per ogni esercizio arriva ai programmi. Lo SP
   non cerca più sempre la colonna 2025 (era fisso nel codice) e ogni richiesta a Claude dei tre
   programmi si apre con una nota «T = anno scritto, T-1 = anno precedente».
9. Quarta scheda «📊 Redditività e solvibilità» (`src/moduli/RedditivitaSolvibilita.jsx`): appena finiscono
   le riclassificazioni riceve lo ZIP di tutti gli esercizi (lo stesso di «Scarica ZIP») e calcola gli
   indici; lo riceve anche quando riapri una sessione da ZIP. «↻ Aggiorna con le modifiche» (nel riquadro
   dei risultati) gli ripassa lo ZIP con le correzioni fatte nelle schede SP, CE e RF: l'analisi riparte da
   zero, quindi i parametri inseriti a mano (CAPM, aliquota…) vanno reinseriti. Il programma accetta lo ZIP
   anche da solo, dal suo pulsante «Seleziona file JSON o ZIP…»: i file si importano dal più recente al più
   vecchio, così ogni anno tiene i valori del proprio bilancio e non la colonna comparativa dell'anno dopo.
   Con la suite non chiede una chiave sua: usa l'account Claude (artifact) o la chiave unica.
   Integrazione documentale: il programma riceve TUTTI i documenti caricati all'inizio (prospetti, NI, RG di
   ogni esercizio) e li analizza in automatico uno dopo l'altro, dal più recente; li puoi rianalizzare da
   «2 · Integrazione Documentale». Lo ZIP («Scarica ZIP», anche dalla barra in alto: «⬇ Scarica ZIP aggiornato»)
   contiene anche `redditivita-solvibilita/analisi-bilancio_….json`, lo stesso file di «Salva analisi»:
   «Riapri sessione da ZIP» lo ripristina, e «↻ Aggiorna con le modifiche» conserva parametri manuali, CAPM e
   valori dell'integrazione documentale.
   Parametri di settore dai concorrenti: aggiungendo comparable nel «3 · Peer Group» (con il loro ZIP o i
   JSON) si calcolano da soli e compilano i campi CAPM — aliquota effettiva (media degli esercizi in utile
   con aliquota 0–60%, poi mediana), D/E contabile (debiti finanziari ÷ patrimonio netto dell'ultimo
   esercizio, mediana) e grado di leva operativa (MdC ÷ MON con la regressione dei costi variabili, altrimenti
   mediana delle coppie ΔMON% ÷ ΔRicavi% con ricavi in variazione di almeno il 3%). Da 4 concorrenti in su i
   valori estremi sono esclusi (Tukey, 1,5×IQR). Un campo modificato a mano resta manuale («↺ usa i
   concorrenti» lo riporta al calcolo). Beta, ERP e tasso privo di rischio restano da compilare.
10. Importi in milioni: SP, CE e RF chiedono a Claude tutti gli importi in MILIONI della valuta (convertendo
   da migliaia o unità secondo l'intestazione del documento), con decimali. La regola è aggiunta a ogni
   richiesta dei programmi (`REGOLA_SCALA_MILIONI`); le tolleranze di quadratura sono relative (1.000 € o lo
   0,05% della grandezza). Lo SP conserva gli importi nel formato italiano «1234,567». Anche l'integrazione
   documentale di «Redditività e solvibilità» lavora in milioni.
11. «🧾 Quality of Earnings» (`src/moduli/QualityOfEarnings.jsx`): modificata solo la Fase 0 (più il minimo
   nel guscio per ricevere lo ZIP e consegnare il salvataggio). La prima volta che apri la scheda riceve lo ZIP
   della sessione (riclassificazioni + analisi di Redditività e solvibilità) e lo apre da solo; in Fase 0
   «Carica ZIP» accetta qualunque ZIP della suite e «Scarica ZIP aggiornato» restituisce l'archivio con in più
   `quality-of-earnings/qoe_….json` (anche «⬇ Scarica ZIP aggiornato» in alto lo include). «Riapri sessione da
   ZIP» ripristina il lavoro di QoE da quel file. Usato da solo, il programma compone lo ZIP aggiornato da sé.
   Fase 0 di QoE: il riquadro per il JSON di Redditività è stato tolto (arriva nello ZIP). Il riquadro
   «Confronto con i comparables» mostra i concorrenti del Peer Group di Redditività con margine EBITDA ed
   EBIT, crescita, PFN/EBITDA, costo del debito e rotazione del magazzino (stesse formule di QoE, ultimo
   esercizio; DSO non calcolabile per i concorrenti): entrano in Fase 1 come parametri esterni «peer»
   (mediana per i riferimenti, serie per il clustering). «Documenti iniziali della suite»: i PDF caricati
   all'inizio dell'ultimo esercizio vengono analizzati da soli nel Master File (tipo 10-K = relazione
   annuale), quelli degli altri esercizi con «Analizza». Partono solo dopo la prima apertura della scheda.
   Aggiornamento: QoE lavora su una fotografia dei dati; se Redditività (comparables, parametri) o le
   riclassificazioni cambiano, la scheda mostra un avviso e «↻ Aggiorna Quality of Earnings», che reimporta
   lo ZIP in Fase 0 senza perdere il lavoro e consegna il materiale alla Fase 1.
   Nell'export di Redditività «target» è sempre «principale» (l'impresa in analisi), anche se a schermo la
   destinazione dei caricamenti è un concorrente.
   Aliquota fiscale (Conto Economico): non più fissa al 27,9%. Si ricava dai documenti: 1) aliquota nominale
   dichiarata in Nota Integrativa (campo «aliquotaNominale» dell'estrazione), 2) aliquota effettiva media T e
   T-1 (imposte ÷ utile ante imposte, esclusi anni in perdita o fuori 0–60%), 3) aliquota legale dello schema
   come ripiego segnalato. La fonte è mostrata accanto al campo e salvata nel JSON («aliquotaFonte»); una
   modifica a mano resta manuale. Redditività e solvibilità segue l'aliquota del CE dell'impresa principale
   (non quella dei concorrenti), con la fonte, finché non la modifichi a mano.
   Bilancio TTM (dal Generatore Bilancio TTM, formato «bilancio-ttm/2.0»): si carica nella schermata
   Documenti (riquadro «📈 Bilancio TTM»), è già riclassificato e non passa da SP, CE e RF. Viaggia nello
   ZIP in «ttm/». In Redditività e solvibilità entra come periodo distinto con la chiave decimale del
   generatore (FY 2025 + 6 mesi → 2025,5, etichetta «TTM 06/2026») senza toccare il FY; i selettori
   avvisano quando un confronto non copre dodici mesi; il TTM è escluso dalla regressione dei costi
   variabili e dall'integrazione documentale; quando arriva l'esercizio chiuso successivo viene tolto.
   Quality of Earnings lo esclude. Nel Pro-forma e DCF arriva dentro la sintesi come anno base: la pagina
   compilata leggeva solo le quattro cifre dell'anno (il TTM finiva sopra il FY 2025), corretto in
   `src/ponte-dcf.js` (funzione «Oo»: le chiavi decimali restano decimali). La pagina DCF ha in cima a
   «Carica file» il riquadro «📦 ZIP delle fasi precedenti» (anche trascinando lo ZIP su un riquadro JSON).
12. «📈 Pro-forma e DCF» (`src/moduli/BilancioProformaDCF.html`, pagina compilata, invariata): la suite la
   mostra in un riquadro e le aggiunge `src/ponte-dcf.js`. Non riceve nulla in automatico: il pulsante
   «📦 Carica ZIP dell'azienda» (in basso a destra) apre «Fase 0 → Carica file», svuota i riquadri e consegna
   ogni JSON dello ZIP al riquadro del suo tipo (sintesi, SP, CE, RF, Quality of Earnings).
13. «Azzera tutto» (in alto, con conferma) svuota aziende, esercizi, documenti, risultati e i tre
   programmi. Restano la chiave API e le regole apprese dagli audit.
14. Più aziende (concorrenti), tappa 1. Nella schermata Documenti ogni azienda è una scheda
   («Test SpA (in analisi) · Alfa · Beta · + Aggiungi azienda»), identica alla schermata singola: esercizi,
   prospetti, NI, RG, TTM facoltativo. Nella scheda: nome (modificabile; finché non lo cambi prende quello
   letto dai JSON), «📦 Carica ZIP in questa azienda» (lo ZIP di un'azienda già riclassificata),
   «Imposta come azienda in analisi», «Rimuovi azienda». In alto «Azienda: …» sceglie l'azienda aperta nelle
   schede SP, CE, RF e Redditività: le modifiche fatte nelle schede vengono riprese prima del cambio, come tra
   un esercizio e l'altro.
   Un solo «▶ Avvia» per tutte, in coda e per fasi: Fase 1 tutte le riclassificazioni (prima l'azienda in
   analisi, poi le altre nell'ordine delle schede); Fase 2 Redditività e solvibilità di ogni azienda con tutte
   le altre come Peer Group (peer «suite_<id>», sostituiti a ogni passaggio; quelli aggiunti a mano restano) e
   l'integrazione documentale sui suoi documenti. I parametri di settore (aliquota, D/E, GLO) si calcolano
   quindi sempre escludendo l'azienda stessa. Barra di avanzamento («Fase 1 · Alfa · esercizio 2024 · Nota
   Integrativa T · passo 14 di 27»), «Interrompi» e «▶ Riprendi (dal passo N)»: riparte dal primo passo non
   completato (un esercizio interrotto si rifà da capo). Se Claude risponde «limite di utilizzo» o non è più
   autorizzato, la coda si sospende da sola. Redditività segue l'azienda aperta e mostra in alto «Analisi di
   … · Peer Group: …» (con «↻ Aggiorna» se il Peer Group è cambiato).
   Tappa 2 · Fase 3 della coda: Quality of Earnings in automatico per ogni azienda (prima quella in analisi):
   ZIP con riclassificazioni e Redditività (comparables compresi), documenti dell'ultimo esercizio, consegna alla
   Fase 1 e diagnosi forense; il passo è finito dopo 10 secondi senza lavoro né chiamate a Claude. Se l'azienda
   aveva già un lavoro QoE, prima si ripristina e poi si aggiorna con i dati nuovi. La scheda QoE segue
   l'azienda aperta: il lavoro di ciascuna resta nella sua scheda, nello ZIP (`quality-of-earnings/`) e nel
   salvataggio; un salvataggio ripristinato non rianalizza i documenti già letti (`QualityOfEarnings.jsx`:
   apiRef.stato()/consegna(), contatori del lavoro, documenti della suite passati dopo il ripristino).
   Pro-forma e DCF: una pagina per azienda, creata alla prima apertura e tenuta in memoria (nascosta) quando
   cambi azienda; parte solo con lo ZIP caricato a mano («⬇ ZIP di <azienda>» nella barra della scheda). Le
   pagine DCF non si salvano nell'artifact: dopo una riapertura si ricarica lo ZIP.
15. «⚖️ Comparazione» (`src/moduli/ComparazioneSettoriale.jsx`, dopo Pro-forma e DCF): mette a confronto tutte le
   aziende della sessione su sei pilastri (matrice per quartili, scorecard, testa a testa, serie storiche,
   posizionamento, relazione). Un riquadro per azienda, già con il nome della scheda, con: l'analisi di
   Redditività ridotta all'azienda stessa e ai soli esercizi chiusi (oppure, se manca, i JSON di SP, CE e RF),
   il salvataggio di Quality of Earnings e l'ultima esportazione JSON del suo Pro-forma e DCF (catturata da
   sola quando la scarichi dalla pagina DCF: entra anche nello ZIP in `proforma-dcf/`). Parte in automatico
   come Fase 4 della coda, quando riapri una sessione da ZIP o carichi lo ZIP completo di un'azienda (con
   almeno due aziende) e dopo un'esportazione del DCF; negli altri casi la scheda segnala «dati cambiati» con
   «↻ Aggiorna la comparazione». Pesi e normalizzazioni scelti restano a ogni aggiornamento; la relazione IA
   si rifà. La sessione della comparazione va nello ZIP di sessione (`comparazione/`) e nel salvataggio
   dell'artifact. Modifiche al modulo: props `aziendeSuite`, `sessioneIniziale`, `apiRef`; nella suite non usa
   il proprio salvataggio nel browser; legge il punteggio QoE anche dal salvataggio unificato (`fase1`).
   ZIP: «⬇ ZIP sessione (N aziende)» con `aziende/<Nome>/…` (in ciascuna la struttura di sempre) e un
   `sessione.json` generale (formato `suite-riclassificazione/2`, ruolo principale/concorrente); «⬇ ZIP di
   <azienda>» nel formato di sempre. «Riapri sessione da ZIP» accetta entrambi.
   Salvataggio nell'artifact (`src/persistenza.js`): indice nel database dell'artifact («sessione/corrente»)
   e file (PDF, JSON, analisi, salvataggio QoE) come asset; si salva da solo dopo ogni modifica e ogni passo
   della coda, più un controllo ogni 30 s per i parametri cambiati dentro Redditività e QoE. Alla riapertura
   della pagina la sessione torna com'era, con «Riprendi» se la coda era a metà. Riquadro «💾 Sessione
   salvata» con lo spazio usato e «Svuota sessione salvata». File oltre 20 MB non salvati (segnalati). Fuori
   dall'artifact, o per chi vede l'artifact in sola lettura, il salvataggio è assente e tutto funziona come prima.

16. Documenti nello ZIP e ripresa dopo un'interruzione. «⬇ ZIP sessione» e «⬇ ZIP di <azienda>» contengono anche i
   documenti caricati (PDF e testo), in `documenti/<2024-2025>/<prospetti|ni|rg>/<file>` dentro la cartella
   dell'azienda; il `sessione.json` dell'azienda li elenca con `elaborato` (già riclassificati con quei documenti) e
   `documentiIntegrati` (già letti dall'integrazione documentale di Redditività). Se la coda era a metà, lo ZIP porta
   anche `coda` (nel `sessione.json` generale, aziende indicate per cartella): «Riapri sessione da ZIP» rimette i
   documenti nei riquadri, ricrea gli esercizi che avevano solo documenti e mostra «▶ Riprendi (dal passo N)».
   Gli ZIP passati ai programmi (Redditività, QoE, DCF) restano senza documenti.
   Un esercizio riclassificato con i documenti presenti è segnato «Riclassificato con questi documenti · non viene
   rifatto»: un nuovo «Avvia» lo salta (anche dopo la riapertura), e lo rifà solo se cambi un suo documento o premi
   «Rielabora». Redditività rilegge i documenti di un'azienda se non li ha ancora letti o se sono cambiati. Con tutti
   gli esercizi già riclassificati il pulsante diventa «▶ Avvia le analisi» (Redditività, QoE, comparazione).
   Esercizi riaperti da uno ZIP senza documenti a cui ricarichi i documenti: «Non rifare» (sull'esercizio, o il
   pulsante sopra «Avvia» per tutti) li tiene come sono; i documenti servono solo alle analisi.
   Il riquadro «📈 Bilancio TTM» accetta il JSON anche trascinandolo sopra.
17. La comparazione non parte più da sola (né come Fase 4 della coda, né dopo uno ZIP o un export del DCF): la
   coda si ferma a Quality of Earnings. Dopo aver corretto i dati e calcolato WACC e DCF, la avvii dalla scheda
   «⚖️ Comparazione» («▶ Componi la comparazione» / «↻ Aggiorna la comparazione»), oppure dai lo ZIP di sessione al
   programma di comparazione. Le code salvate con la vecchia Fase 4 la perdono alla riapertura.

18. «Redditività e solvibilità» → «2 · Integrazione Documentale» (`src/moduli/RedditivitaSolvibilita.jsx`, impronta
   aggiornata in `scripts/moduli.sha256`): con un bilancio TTM in memoria compare anche il riquadro del periodo
   (es. «2025,5 · TTM 06/2026»), con le stesse 29 grandezze degli esercizi. Si compila caricando la relazione
   trimestrale o semestrale (10-Q, half-year report) alla data del TTM: stock alla data infrannuale; flussi sui dodici
   mesi, presi così se il documento li espone, altrimenti calcolati come esercizio base + progressivo − progressivo
   dell'anno prima (serve il valore dell'esercizio base, letto prima dal suo bilancio). Il blocco «infrannuale» della
   risposta è accettato solo se il documento dichiara la data di riferimento e cade nello stesso mese del TTM: un
   bilancio annuale non lo compila. I valori vanno in `par.perAnno["2025.5"]`, la colonna del periodo nel sub-tab Base.

19. Aliquota fiscale di settore (Redditività, «4 · Dati macro & CAPM»): ora è la MEDIA delle aliquote effettive di
   tutte le aziende della sessione, compresa quella in analisi, quindi è la stessa in ogni analisi (con Alphabet e
   Adobe: (15,9% + 18,9%) ÷ 2). Per ogni azienda: media degli esercizi chiusi (il TTM non entra), esclusi quelli in
   perdita, quelli con imposte a zero («imposte non rilevate»: riga delle imposte non letta dalla riclassificazione) e le
   aliquote oltre il 60%. Anche D/E e grado di leva operativa sono la MEDIA fra tutte le aziende, compresa quella in
   analisi, calcolati sui soli esercizi chiusi (il TTM non entra in nessuno dei tre).

20. Integrazione documentale e relazioni infrannuali (`RedditivitaSolvibilita.jsx`, `src/ponte-dcf.js`):
   - testo dei PDF ricostruito RIGA PER RIGA dalle coordinate di pdf.js (prima ogni pagina diventava una sola fila di
     parole e le tabelle a più colonne — tre/sei mesi, due anni, classi di azioni — perdevano la struttura);
   - fusione delle porzioni per CONFIDENZA (alta > media > bassa), con valore, pagina e citazione della stessa porzione;
   - prompt: ordine delle colonne deciso dall'intestazione (i 10-Q mettono l'anno precedente a sinistra), guida alla
     struttura del 10-Q, numero di azioni con le strade dei filing USA (colonna «Consolidated» o somma delle classi A/B/C,
     poi frontespizio o stato patrimoniale);
   - NUMERO DI AZIONI IN MILIONI, come gli importi: EPS = utile netto ÷ azioni senza fattori; i valori salvati in unità
     (oltre un milione) vengono riportati in milioni da soli. Nel Pro-forma e DCF (patch in `ponte-dcf.js`, la pagina
     compilata resta invariata) valore per azione = equity ÷ azioni e capitalizzazione = prezzo × azioni, senza il
     fattore 1000 pensato per importi in migliaia e azioni in unità; il campo è «Numero di azioni (milioni)».

21. Parametri per esercizio di Redditività: le colonne che lo Stato Patrimoniale già conosce (valore dell'equity =
   patrimonio netto, PP&E, immateriali, partecipazioni, liquidità immediate, scoperti = debiti finanziari a breve) vengono
   COMPILATE nelle celle vuote invece di restare segnaposto grigi (`par.autoDaSP` ricorda il valore copiato). Se lo SP
   cambia, una cella ancora uguale al valore copiato si aggiorna; una cella scritta a mano o dai documenti non si tocca.
   I calcoli non cambiano (usavano già questi valori come ripiego) e le fonti restano «valori contabili» / «aggregato SP».

22. WACC calcolato dal sistema (Redditività): il campo «WACC» di «1 · Base» (e del blocco EVA) si compila da solo con il
   WACC ricostruito Kd(1−t)·D/(D+E) + Ke·E/(D+E) dell'esercizio più recente con dati attendibili (`waccAutomatico`):
   si saltano i periodi con costo lordo del debito nullo o oltre il 20% (oneri o debiti finanziari letti male) e i WACC
   fuori da (0, 30%). Sotto il campo si legge da quale esercizio viene, con Kd, Ke e peso del debito. Scrivere un valore lo
   rende manuale («↺ usa il WACC calcolato» torna al calcolo); un WACC inserito a mano in un'analisi salvata prima resta.

23. Documenti JSON e testi lunghi nell'integrazione documentale (`preparaFonte`): prima un file non PDF andava al
   modello in una sola richiesta TRONCATA a 120.000 caratteri (un 10-Q in JSON da 2,6 MB era letto per meno del 5%:
   frontespizio e poco altro; lo stesso per note integrative e relazioni in JSON). Ora il JSON di un filing (array di
   blocchi con «text») diventa una pagina per blocco, ESCLUSI gli allegati (doc_part «exhibits»: contratti,
   certificazioni, copie del documento, fino al 90% del file), e si legge per intero in porzioni come un PDF; ogni altro
   testo lungo si divide in pagine da ~4.000 caratteri. Il JSON si sceglie anche dalle finestre di caricamento.
   Periodo TTM: il blocco infrannuale è accettato se il documento chiude nello STESSO MESE del TTM anche con un anno di
   differenza (alcuni file TTM hanno l'anno sbagliato: Adobe 30/05/2025 invece di 29/05/2026), con un avviso.
24. Spread da rischio informativo nel DCF: il salvataggio di Quality of Earnings ora porta al primo livello l'esito
   della Fase 5 (`accounting_trust_score`, `information_risk_premium_pct`/`_bps`, `investable_flag`, e il blocco
   `fase5` completo), che il DCF legge per «Spread da rischio informativo su Ke (%)». Nel DCF lo spread `_pct` si
   divide sempre per 100 (prima 0,32 diventava 32%: patch `SPREAD_*` in `ponte-dcf.js`). Un salvataggio QoE fatto
   prima di questa versione non ha lo spread: si rigenera aprendo Quality of Earnings su quell'azienda nella suite.
25. DCF e ZIP della sessione con più aziende: il caricatore chiede quale azienda caricare (proposta quella della
   scheda, dal titolo del riquadro), mostra per ciascuna i file e lo spread; esclude «documenti/» e «comparazione/».
   Se il QoE nello ZIP non ha lo spread, il DCF chiede alla suite quello attuale (`window.__suiteQoeAttuale`, per
   nome dell'azienda o per riquadro): con Quality of Earnings aperto su quell'azienda lo spread arriva comunque.
26. Valore e prezzo per azione anche in euro nel DCF (`EURO_PER_AZIONE` in `ponte-dcf.js`): cambio BCE del giorno
   (api.frankfurter.app, riserva open.er-api.com) oppure scritto a mano nelle Assumption («Cambio: USD per 1 euro»,
   `assunzioni.valutazione.cambioEur`, salvato con l'analisi). «(€ …)» compare in Valutazione DCF, barra laterale,
   Esportazione, tabelle e report Word. Per importi già in euro non compare nulla.
   Nella pagina pubblicata su claude.ai il cambio BCE di norma non arriva (richieste esterne bloccate): senza cambio
   compare «(€ —: manca il cambio…)»; il cambio scritto a mano si ricorda per valuta (localStorage) e vale anche per le
   altre aziende e le aperture successive.
   Cambio del giorno cercato da Claude: un'attività pianificata (giorni feriali, dopo la pubblicazione delle 16:00
   della BCE) legge i cambi di riferimento sul sito della BCE e li scrive nel database dell'artifact, documento
   «cambi/bce» { data, fonte, rates, aggiornato }. La suite li legge all'apertura e ogni 30 minuti
   (`window.__suiteCambi`) e hanno la precedenza sul resto; un cambio scritto a mano nel DCF resta (0 = cambio del giorno).
27. Spread sempre allineato a Quality of Earnings (`SPREAD_DALLA_SUITE`): ogni 1,5 s la pagina DCF chiede alla suite
   (`window.__suiteSpreadDi`) lo spread della SUA azienda e lo scrive nelle Assumption, senza ricaricare lo ZIP. Fonte:
   QoE aperto su quell'azienda, altrimenti il suo ultimo salvataggio; se il salvataggio è di una versione precedente
   lo spread si ricalcola dai dati salvati (`esitoFase5DaSalvataggio` in QualityOfEarnings.jsx, stessa catena pura
   della Fase 5). Un valore scritto a mano resta (`spreadManuale`); 0 torna all'automatico.
28. DCF nello ZIP della sessione senza esportarlo a mano (`SALVA_RIPRENDI`): allo ZIP (e al salvataggio
   nell'artifact, e alla comparazione) la suite legge da ogni pagina DCF aperta l'esportazione JSON completa
   (`window.__dcfEsporta`) in `aziende/<Nome>/proforma-dcf/`. Riaprendo lo ZIP, la pagina DCF di ogni azienda si
   riapre da sola con quel file (`window.__suiteDcfSalvato` → `window.__dcfRiprendi`), con assunzioni, numero di
   azioni, cambio e spread manuale (chiavi aggiunte al modello predefinito perché la ripresa non le scarti).
29. Comparazione dallo ZIP della sessione: in cima alla scheda Comparazione un riquadro accetta (trascinamento o
   clic) lo ZIP scaricato con «⬇ ZIP sessione» dopo i DCF. `aziendeDaZipComparazione` legge ogni
   `aziende/<Nome>/` (analisi di Redditività ridotta all'azienda e agli esercizi interi, altrimenti i JSON di SP, CE
   e RF; Quality of Earnings, con la Fase 5 ricalcolata se manca; DCF) e passa le aziende alla comparazione, la
   principale per prima. Lo stesso `componiFileComparazione` serve il passaggio con i dati della suite.
30. «↻ Aggiorna la comparazione» sempre disponibile (con almeno due aziende) e rilegge tutto: modifiche nelle schede
   SP/CE/RF, Redditività (dal programma se aperto), QoE (con Fase 5), DCF di ogni pagina aperta. La comparazione ora
   usa anche: dal DCF tutta la valutazione (EV, equity asset/equity side, valore per azione e in euro, prezzo,
   upside e giudizio, azioni e capitalizzazione, WACC/Ke/Kd/β/Rf/ERP, spread e Trust Score, g richiesto/usato/
   sostenibile, peso del TV, cambio); da Redditività i parametri compilati dell'ultimo esercizio intero (par.perAnno),
   aliquota, WACC e parametri di settore; capitalizzazione da equityMercato. Riquadro «Dal DCF / Da Redditività»
   nella scheda di ogni azienda; tutto anche nell'esportazione JSON. Corretto: il periodo TTM dello storico del DCF
   («2025.5») finiva sopra l'esercizio 2025; capitalizzazione ed EV del DCF ora sono portati alla scala del confronto.
31. Nuovo bilancio (trimestrale, semestrale o annuale) e «🔄 Riaggiorna tutto» in Documenti.
   - Relazione infrannuale del TTM: riquadro nel box TTM, `file["ttm.doc"]` (CHIAVE_DOC_TTM), nello ZIP in
     `documenti/ttm/`; va all'integrazione documentale di Redditività come tipo «infrannuale» (letta per ultima, dopo
     l'esercizio base). Sostituendo il TTM con uno di data diversa, la relazione precedente si toglie.
   - Integrazione incrementale: `docVisti` (per azienda; nello ZIP `documentiVisti`) tiene i documenti già letti da
     Redditività; la coda integra solo quelli nuovi (`documentiNuovi`). Le sessioni precedenti (solo
     `docIntegrati`) valgono come «tutti letti».
   - `avvia(false, { aggiornamento: true })`: toglie i TTM superati da un nuovo annuale (`togliTtmSuperati`), poi
     Fase 1 (esercizi nuovi), Fase 2 Redditività per tutte le aziende, Fase 3 QoE (con un nuovo annuale), Fase 5 DCF
     di ogni azienda che ne ha uno (`eseguiDcf`: ZIP dell'azienda nella pagina, poi le assunzioni di prima con
     `window.__dcfAggiornaDaZip`), Fase 6 comparazione con almeno due aziende.
32. Comparazione, spiegazioni delle metriche (`GUIDA_METRICHE` in ComparazioneSettoriale.jsx): per ogni metrica «in
   parole semplici», «come si legge» (valori tipici), un esempio con i numeri, le trappole; per ogni azienda una frase
   che traduce il suo valore e i «dati usati» (`datiUsati`: EV e da dove viene, capitalizzazione, PFN, EBITDA…).
   Anche nel riquadro che si apre cliccando una cella. Corretto: il «valore di mercato dell'equity» che Redditività
   copia dal patrimonio netto contabile (par.autoDaSP) non è più usato come capitalizzazione (EV ÷ EBITDA di
   Alphabet a 2,5x).
33. Scheda Pro-forma e DCF: la barra in alto (prima testo + «⬇ ZIP di …») ora ha «↻ Aggiorna il DCF» (`aggiornaDcf`):
   riprende le modifiche delle schede, l'analisi di Redditività e il QoE attuali, passa lo ZIP dell'azienda alla
   pagina e riapplica le assunzioni di prima (`__dcfAggiornaDaZip`); senza un DCF precedente parte dalle predefinite.
34. Comparazione, WACC: Redditività salva `par.wacc` come frazione (0,0851); la comparazione lo divideva ancora per
   100 (0,09%) e lo scriveva nel campo «WACC» come se fosse digitato, sopra quello del DCF. Ora è una frazione,
   resta in `waccAnalisi` e vale dopo il WACC del DCF (ordine: scritto a mano → DCF → Redditività). Le celle «n.d.»
   spiegano che cosa manca (`perchéMancante`: prezzo di borsa, valore per azione, capex).
35. «🔎 Ricerca Aziende» come prima scheda, prima di Documenti: la pagina `src/moduli/RicercaAziende.html` (versione
   dimostrativa, con dati inventati) è mostrata invariata in un riquadro (srcdoc), montata alla prima apertura e poi
   tenuta viva. Per aggiornarla basta sostituire il file e rigenerare l'impronta in scripts/moduli.sha256.
36. «🧭 Analisi strategica» (`src/moduli/AnalisiStrategica.jsx`, invariato) fra Redditività e solvibilità e Quality of
   Earnings, montato alla prima apertura e poi tenuto vivo. Nell'artifact le chiamate a Claude passano dal ponte
   come per gli altri programmi; la ricerca web (strumenti web_search/web_fetch) non è disponibile con «sample»: il
   ponte risponde con un errore chiaro invece di lasciare che Claude inventi fonti (`ponte-artifact.js`).
37. Una chiave per tutte le app (`src/chiave-unica.js`, solo fuori dall'artifact): in Documenti scegli il fornitore
   (OpenAI o Anthropic), il modello OpenAI (predefinito gpt-5.4-mini) e la chiave. Con OpenAI ogni richiesta a Claude
   dei programmi (/api/chat, /api/anthropic, api.anthropic.com/v1/messages) è tradotta in Chat Completions (PDF come
   input «file», reasoning_effort low, tetto di token allargato) e la risposta torna nel formato atteso; la ricerca
   web di Analisi strategica usa la Responses API (web_search_preview) e torna come blocchi web_search_tool_result.
   Configurazione in localStorage «suite_config_ia» (la chiave solo con «Ricorda in questo browser»).
   Nell'artifact di claude.ai non si usa: lì tutte le app vanno al Claude dell'account.

## Chiave API unica
Nella schermata «Documenti» c'è un campo per la chiave Anthropic. Vale per tutti e tre i
programmi (`src/chiave-unica.js`):
- per lo SP va nel campo `apiKey` delle richieste a `/api/chat`;
- per CE e RF va nell'header `x-user-key` delle richieste a `/api/anthropic`.

È lo stesso punto in cui la metterebbe ciascun programma se la digitassi nel suo riquadro
«Configurazione IA», e una chiave digitata dentro un programma ha comunque la precedenza.
Se il campo resta vuoto si usa `ANTHROPIC_API_KEY` dell'hosting. «Ricorda in questo browser»
salva la chiave nel localStorage; altrimenti resta solo nella memoria della pagina.
Nell'artifact su claude.ai il campo non c'è: lì le estrazioni usano l'account Claude di chi
apre la pagina (`src/ponte-artifact.js`).

## Deploy
Variabili d'ambiente: `ANTHROPIC_API_KEY` (più `OPENAI_API_KEY` / `GEMINI_API_KEY` se usi
quei provider nello SP). Poi `npm i` e `npm run build`; su Vercel basta importare il progetto.

## Aggiornare un programma
Sostituisci il file in `src/moduli/` (stesso nome) e rigenera l'impronta:
`sha256sum src/moduli/*.jsx > scripts/moduli.sha256`.
Se il programma cambia l'ordine o il numero dei suoi pulsanti di caricamento, la schermata si
ferma con un messaggio. In quel caso va aggiornata la mappa `PROGRAMMI` in `App.jsx`.
