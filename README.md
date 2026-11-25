# Cavallette – Serramenti Longato

Applicazione web per seguire le cavallette (vetrerie + nostre) dal piazzale al cantiere e ritorno.
Legge l'Excel scaricato da Smartsheet e gestisce da sola ciò che Smartsheet non può fare.

- Frontend: React + TypeScript + Vite (sito statico, su GitHub Pages o Netlify)
- Dati e accessi: Supabase (Postgres + login + regole per ruolo)

## 1. Supabase (10 minuti)

1. Crea un progetto su supabase.com.
2. **SQL Editor** → incolla tutto `supabase/schema.sql` → *Run*. Si può rilanciare senza danni.
3. **Authentication → Users → Add user**: crea un utente (email + password) per ognuno: tu, Nicole, logistica, peso, magazziniere.
   (Authentication → Providers → Email: disattiva «Confirm email» se non vuoi mail di conferma; disattiva anche le iscrizioni libere.)
4. Rendi te stesso admin, nello SQL Editor:
   ```sql
   update public.profili set ruolo = 'admin' where email = 'tua@email.it';
   ```
   Gli altri ruoli li assegni poi dall'app, schermata **Utenti**.
5. **Project Settings → API**: copia *Project URL* e la chiave *anon public*.

## 2. Provarla sul tuo computer (serve Node 22+)

```
cp .env.example .env      # incolla URL e chiave anon
npm install
npm test
npm run dev
```

## 3. Pubblicarla con GitHub

1. Crea un repository, carica questa cartella (`samples/` e `.env` sono già esclusi da `.gitignore`).
2. Settings → Secrets and variables → Actions → aggiungi `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Settings → Pages → Source: **GitHub Actions**. Ad ogni push su `main` il sito si ricostruisce e si pubblica.

La chiave anon è pubblica per progettazione: la sicurezza sta nelle regole del database, non nel nasconderla.
Non mettere mai la chiave `service_role` nell'app.

## 4. Ruoli

| Ruolo | Cosa vede / fa |
|---|---|
| admin (tu) | tutto, correzioni a mano, utenti, impostazioni |
| ufficio (Nicole) | tutto in lettura, carica DDT/Excel, import Smartsheet |
| amministrazione | tutto in lettura, può correggere a mano le cavallette |
| logistica / peso | tutto in lettura, schermata «Da ritirare» con il segnale |
| produzione | solo «Produzione»: scrive la commessa e segna le cavallette riempite di serramenti |
| autista | Cruscotto, «Da ritirare» (programma il giro di raccolta) e «Da consegnare» (conferma le consegne con il DDT) |
| magazziniere | «Restituzione» + Cruscotto in sola lettura (parte dalla Restituzione) |
| nessuno | utente appena creato, non vede nulla finché non gli dai un ruolo |

## 5. Come si usa

- **Arrivo vetri** (Nicole): carica il PDF del DDT (o un Excel con i codici) → controlla l'anteprima → Salva. Le cavallette entrano in piazzale, piene di vetri.
  Si può anche inserire a mano (pulsante «Inserisci a mano»). La data di arrivo è quella del DDT.
  Regola dei codici: prefisso della vetreria, trattino, codice stampato (E82 su Pescini → `P-E82`). In Smartsheet va bene anche `PE82` o `p e82`. Le nostre (Longato) sono numeri semplici, aggiungibili a intervalli (`1-50`).
- **Da Smartsheet**: esporta la tabella in Excel e caricala. Si vede un'anteprima, poi si conferma. Si può ripetere tutte le volte che serve: niente doppioni, le correzioni a mano non vengono sovrascritte.
  - N° CAVALLETTE + IMBALLAGGIO → piazzale, piena di serramenti, con commessa/cliente/indirizzo
  - DDT CONS. RIENTRATO → dal cliente
  - DDT RIENTRO CAVALLETTA → piazzale, vuota, commessa/cliente/indirizzo cancellati
  - Cavalletta non in anagrafica → **Segnalazione**
  - Colonne lette per nome: COMMESSA, CLIENTE, INDIRIZZO CANTIERE / PAESE / PROVINCIA, IMBALLAGGIO, N° CAVALLETTE, DDT CONS. RIENTRATO, DATA CONS. RIENTRATO, DDT RIENTRO CAVALLETTA, DAT DDT RIENTRO CAVALLETTA. Le due colonne data sono facoltative: danno la data di consegna al cliente (da cui partono i 10 giorni lavorativi) e la data di rientro; senza date si usa il giorno in cui carichi il file.
  - Al primo import usa il filtro «dal» per saltare lo storico vecchio.
- **Da ritirare**: dopo 10 giorni *lavorativi* (esclusi sabati, domeniche, festivi italiani e chiusure aziendali) dalla consegna. Soglia e chiusure si cambiano in **Impostazioni**. Il magazziniere non la vede; gli autisti sì e possono programmare il giro.
- **Restituzione** (magazziniere): sceglie la vetreria, spunta le cavallette, Invia. Spariscono dal cruscotto e restano nello **Storico** (data + elenco).
- Le cavallette Longato non si restituiscono mai, ma restano sempre visibili nel cruscotto. «Giacenza» = giorni dall'arrivo per quelle dei fornitori.

## 5bis. Novità della versione 2

- **Da ritirare → «Programma giro di raccolta»** (admin, ufficio, logistica): si spuntano le cavallette che l'autista va a prendere e si preme *Invia giro*. Diventano grigie («In ritiro»); dopo 6 ore (impostazione `ore_giro`) tornano da sole vuote in piazzale, senza commessa/cliente/indirizzo. Fino ad allora si può *Annullare il giro*.
- **Da consegnare**: la data è quella di oggi; si scrive il numero di commessa, si spuntano le cavallette caricate, si inserisce il **DDT dell'amministrazione** e si conferma: risultano dal cliente con i serramenti (da lì partono i 10 giorni lavorativi).
- **Produzione** (ruolo `produzione`, oppure admin/ufficio): si scrive la commessa (cliente e indirizzo si compilano dall'ultimo Excel di Smartsheet caricato dall'ufficio, oppure a mano), si sceglie **cosa si carica** (serramenti, vetri, portoncino, HST, scuri, serramenti in alluminio: anche più voci insieme), poi la vetreria e il numero di ogni cavalletta. Le cavallette risultano piene in piazzale con quel carico. L'imballo non si legge più da Smartsheet: è la conseguenza di questa schermata.
- **Correzione a mano**: se una cavalletta viene messa «vuota in piazzale» si cancellano anche commessa, cliente, indirizzo, carico e date, e il ciclo della commessa si chiude.
- **Cruscotto**: colonna «Ferma da (gg)» = da quanti giorni la cavalletta è nello step attuale (vetri / serramenti in piazzale / dal cliente / in giro / vuota); sulle schede la media e il massimo; filtro «ferme da almeno N giorni».
- **Registro movimenti** (ex Storico): come un magazzino fiscale. Ogni movimento ha un numero progressivo senza buchi, data, ora, utente, e una catena di controllo (ogni riga contiene l'impronta della precedente). Non si può modificare né cancellare, nemmeno dall'amministratore: un errore si corregge con un nuovo movimento. Le correzioni fatte a mano da admin/ufficio/amministrazione entrano nel registro come «modificato a mano» con il nome di chi le ha fatte e il motivo. Ricerca per cavalletta, commessa, DDT, cliente; raggruppato per data; esportabile in CSV.
- Database già esistente? Esegui `supabase/aggiorna_ruolo_produzione.sql` (da solo, una volta), poi tutto `supabase/schema.sql`.

## 6. Cose da sapere

- L'aggiornamento automatico giornaliero da Smartsheet non c'è ancora: servirebbe un token API di Smartsheet e una Edge Function pianificata di Supabase (fase 2). Il token va messo solo nei segreti di Supabase, mai in chat o nel codice.
- Una cavalletta è unica per (numero, commessa): una seconda commessa sulla stessa cavalletta ancora occupata genera una segnalazione.
- Se avevi già eseguito `schema.sql` prima del ruolo amministrazione, esegui prima `supabase/aggiorna_ruolo_amministrazione.sql` (riga 1, da sola) e poi di nuovo `schema.sql`.
- I cavalletti «Ritirati» sul DDT vengono ignorati.
- Se una cavalletta risulta rientrata senza prima «consegnata», si sistema con una correzione a mano (admin).
