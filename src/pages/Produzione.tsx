import { useEffect, useMemo, useState } from 'react';
import { cercaCommessa, imballa } from '../lib/api.ts';
import { useDati } from '../lib/dati.tsx';
import { chiaveDaCodice, confrontaNumeri, trovaNumero } from '../lib/keys.ts';
import { Info, Messaggio, Titolo } from '../components/ui.tsx';
import { CARICHI, nomiCarico } from '../lib/types.ts';

export default function Produzione() {
  const { cavallette, vetrerie, nomeVetreria, errore, ricarica } = useDati();
  const [commessa, setCommessa] = useState('');
  const [cliente, setCliente] = useState('');
  const [indirizzo, setIndirizzo] = useState('');
  const [trovata, setTrovata] = useState<'si' | 'no' | null>(null);
  const [vetreria, setVetreria] = useState('');
  const [codice, setCodice] = useState('');
  const [scelte, setScelte] = useState<{ numero: string; carico: string[] }[]>([]);
  const [occupato, setOccupato] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);

  // cavallette che si possono imballare: in piazzale, con i vetri già scaricati o vuote
  const disponibili = useMemo(
    () => cavallette.filter((c) => !c.restituita && c.luogo === 'piazzale' && (c.stato === 'piena_vetri' || c.stato === 'vuota')),
    [cavallette],
  );
  const numeriDisp = useMemo(() => disponibili.map((c) => c.numero), [disponibili]);

  // dati della commessa (cliente, indirizzo) dall'ultimo Excel di Smartsheet caricato
  useEffect(() => {
    const k = commessa.trim();
    setTrovata(null);
    if (!k) return;
    let annullato = false;
    const t = window.setTimeout(() => {
      cercaCommessa(k)
        .then((c) => {
          if (annullato) return;
          setTrovata(c ? 'si' : 'no');
          if (c) {
            setCliente(c.cliente ?? '');
            setIndirizzo(c.indirizzo ?? '');
          }
        })
        .catch(() => {
          if (!annullato) setTrovata('no');
        });
    }, 350);
    return () => {
      annullato = true;
      window.clearTimeout(t);
    };
  }, [commessa]);

  function aggiungi(numero: string): void {
    setScelte((s) => (s.some((x) => x.numero === numero) ? s : [...s, { numero, carico: ['serramenti'] }]));
  }

  function aggiungiDaCodice(): void {
    setErr(null);
    const testo = codice.trim();
    if (!testo) return;
    if (!vetreria) {
      setErr('Scegli prima la vetreria (oppure «Longato» se è una nostra).');
      return;
    }
    const chiave = chiaveDaCodice(testo, vetreria);
    const numero = trovaNumero(chiave, numeriDisp);
    if (!numero) {
      setErr(`La cavalletta ${chiave} non risulta in piazzale (piena di vetri o vuota). Controlla il numero: se è nuova, va prima registrata da Arrivo vetri.`);
      return;
    }
    aggiungi(numero);
    setCodice('');
  }

  async function invia(): Promise<void> {
    setErr(null);
    setEsito(null);
    if (!commessa.trim()) {
      setErr('Scrivi il numero di commessa.');
      return;
    }
    const senza = scelte.find((x) => x.carico.length === 0);
    if (senza) {
      setErr(`Scegli cosa c'è sulla cavalletta ${senza.numero} (serramenti, vetri, portoncino, HST, scuri, alluminio).`);
      return;
    }
    setOccupato(true);
    try {
      await imballa(commessa.trim(), cliente, indirizzo, scelte);
      setEsito(`Commessa ${commessa.trim()}: ${scelte.length} ${scelte.length === 1 ? 'cavalletta pronta' : 'cavallette pronte'} in piazzale (${scelte.map((x) => `${x.numero}: ${nomiCarico(x.carico).toLowerCase()}`).join('; ')}).`);
      setScelte([]);
      setCommessa('');
      setCliente('');
      setIndirizzo('');
      setTrovata(null);
      await ricarica();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Errore');
    } finally {
      setOccupato(false);
    }
  }

  const proposte = useMemo(
    () => disponibili.filter((c) => !vetreria || c.vetreria === vetreria).sort((a, b) => confrontaNumeri(a.numero, b.numero)),
    [disponibili, vetreria],
  );

  return (
    <>
      <Titolo titolo="Produzione: imballo commessa" sotto="Scrivi la commessa, scegli la vetreria e il numero di ogni cavalletta e indica cosa c'è sopra (serramenti, solo vetri, portoncino…)." />
      {errore && <Messaggio tipo="errore">{errore}</Messaggio>}
      {err && <Messaggio tipo="errore">{err}</Messaggio>}
      {esito && <Messaggio tipo="ok">{esito}</Messaggio>}

      <div className="card">
        <h2>1. Commessa</h2>
        <label className="form">
          Numero di commessa
          <input className="cerca-grande" autoFocus autoComplete="off" placeholder="es. 26031" value={commessa} onChange={(e) => setCommessa(e.target.value)} />
        </label>
        {trovata === 'si' && <p className="nota">Dati presi da Smartsheet. Puoi correggerli se serve.</p>}
        {trovata === 'no' && commessa.trim() && (
          <p className="nota">Commessa non presente nell'ultimo Excel caricato dall'ufficio: puoi scrivere cliente e indirizzo a mano (facoltativo).</p>
        )}
        <div className="form">
          <label>Cliente<input value={cliente} onChange={(e) => setCliente(e.target.value)} /></label>
          <label>Indirizzo cantiere<input value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} placeholder="es. VIA ROMA 22, CASTELFRANCO VENETO (TREVISO)" /></label>
        </div>
      </div>

      <div className="card">
        <h2>2. Quali cavallette</h2>
        <div className="segmenti">
          {vetrerie.map((v) => (
            <button key={v.codice} className={`segmento ${vetreria === v.codice ? 'attivo' : ''}`} onClick={() => setVetreria(vetreria === v.codice ? '' : v.codice)}>
              {v.codice === 'L' ? 'Nostre (Longato)' : v.nome}
            </button>
          ))}
        </div>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            aggiungiDaCodice();
          }}
        >
          <input
            className="cerca"
            placeholder={vetreria === 'L' ? 'numero (es. 62)' : 'codice stampato (es. E82)'}
            value={codice}
            autoComplete="off"
            onChange={(e) => setCodice(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Aggiungi</button>
        </form>

        <p className="nota">Oppure tocca una cavalletta in piazzale{vetreria ? ` (${nomeVetreria(vetreria)})` : ''}:</p>
        <div className="chip-lista">
          {proposte.length === 0 && <span className="nota">Nessuna cavalletta disponibile.</span>}
          {proposte.map((c) => (
            <button key={c.id} className={`chip ${scelte.some((x) => x.numero === c.numero) ? 'chip-scelto' : ''}`} onClick={() => (scelte.some((x) => x.numero === c.numero) ? setScelte(scelte.filter((x) => x.numero !== c.numero)) : aggiungi(c.numero))}>
              {c.numero} {c.stato === 'piena_vetri' ? '· vetri' : '· vuota'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>3. Cosa c'è su ogni cavalletta</h2>
        {scelte.length === 0 ? (
          <p className="nota">Aggiungi le cavallette qui sopra: ognuna parte con «Serramenti», cambia se serve (anche più voci).</p>
        ) : (
          <ul className="lista-carico">
            {scelte.map((x) => (
              <li key={x.numero}>
                <div className="lista-carico-testa">
                  <strong className="numero">{x.numero}</strong>
                  <button className="link" onClick={() => setScelte(scelte.filter((y) => y.numero !== x.numero))}>Togli</button>
                </div>
                <div className="chip-lista">
                  {CARICHI.map((c) => (
                    <button
                      key={c.k}
                      className={`chip ${x.carico.includes(c.k) ? 'chip-scelto' : ''}`}
                      onClick={() => setScelte(scelte.map((y) => (y.numero === x.numero ? { ...y, carico: y.carico.includes(c.k) ? y.carico.filter((k) => k !== c.k) : [...y.carico, c.k] } : y)))}
                    >
                      {c.nome}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="barra-riepilogo">
        <div>
          <strong>{scelte.length} {scelte.length === 1 ? 'cavalletta' : 'cavallette'}</strong>
          <div className="sotto">{scelte.length ? 'Ognuna con il suo carico' : 'Nessuna cavalletta aggiunta'}</div>
        </div>
        <div className="riga-bottoni">
          <Info etichetta="Cosa succede all'invio" allineaDestra>Le cavallette risultano piene (con quello che hai indicato per ognuna) in piazzale, pronte da consegnare.</Info>
          <button className="btn btn-primary btn-big" disabled={scelte.length === 0 || !commessa.trim() || occupato} onClick={() => void invia()}>
            {occupato ? 'Invio…' : 'Segna come pronte'}
          </button>
        </div>
      </div>
    </>
  );
}
