import { useEffect, useMemo, useState } from 'react';
import { cercaCommessa, imballa } from '../lib/api.ts';
import { useDati } from '../lib/dati.tsx';
import { chiaveDaCodice, confrontaNumeri, trovaNumero } from '../lib/keys.ts';
import { Info, Messaggio, Titolo } from '../components/ui.tsx';

export default function Produzione() {
  const { cavallette, vetrerie, nomeVetreria, errore, ricarica } = useDati();
  const [commessa, setCommessa] = useState('');
  const [cliente, setCliente] = useState('');
  const [indirizzo, setIndirizzo] = useState('');
  const [trovata, setTrovata] = useState<'si' | 'no' | null>(null);
  const [vetreria, setVetreria] = useState('');
  const [codice, setCodice] = useState('');
  const [scelte, setScelte] = useState<string[]>([]);
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
    setScelte((s) => (s.includes(numero) ? s : [...s, numero]));
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
    setOccupato(true);
    try {
      await imballa(commessa.trim(), cliente, indirizzo, scelte);
      setEsito(`Commessa ${commessa.trim()}: ${scelte.length} ${scelte.length === 1 ? 'cavalletta imballata' : 'cavallette imballate'}. Ora sono in piazzale con i serramenti.`);
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
      <Titolo titolo="Produzione: imballo commessa" sotto="Scrivi la commessa, scegli la vetreria e il numero delle cavallette che hai riempito di serramenti." />
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
        <h2>2. Cavallette usate</h2>
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
            <button key={c.id} className={`chip ${scelte.includes(c.numero) ? 'chip-scelto' : ''}`} onClick={() => (scelte.includes(c.numero) ? setScelte(scelte.filter((n) => n !== c.numero)) : aggiungi(c.numero))}>
              {c.numero} {c.stato === 'piena_vetri' ? '· vetri' : '· vuota'}
            </button>
          ))}
        </div>
      </div>

      <div className="barra-riepilogo">
        <div>
          <strong>{scelte.length} {scelte.length === 1 ? 'cavalletta' : 'cavallette'}</strong>
          {scelte.length > 0 ? (
            <div className="chip-lista">
              {scelte.map((n) => (
                <button key={n} className="chip chip-scelto" onClick={() => setScelte(scelte.filter((x) => x !== n))}>{n} ✕</button>
              ))}
            </div>
          ) : (
            <div className="sotto">Nessuna cavalletta aggiunta</div>
          )}
        </div>
        <div className="riga-bottoni">
          <Info etichetta="Cosa succede all'invio" allineaDestra>Le cavallette risultano «piena di serramenti» in piazzale.</Info>
          <button className="btn btn-primary btn-big" disabled={scelte.length === 0 || !commessa.trim() || occupato} onClick={() => void invia()}>
            {occupato ? 'Invio…' : 'Segna come imballate'}
          </button>
        </div>
      </div>
    </>
  );
}
