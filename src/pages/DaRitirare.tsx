import { useMemo, useState } from 'react';
import { annullaGiro, programmaGiro } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDati } from '../lib/dati.tsx';
import { aggiungiGiorniLavorativi, formattaData } from '../lib/dates.ts';
import { daRitirare, giorniInCantiere, inGiro, oreAlRientro, provinciaDa, SENZA_PROVINCIA } from '../lib/logica.ts';
import { dataOra, Badge, Messaggio, Titolo } from '../components/ui.tsx';
import type { Cavalletta } from '../lib/types.ts';

interface Riga {
  c: Cavalletta;
  giorni: number;
}

function oreTesto(ore: number): string {
  const minuti = Math.max(1, Math.ceil(ore * 60));
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function DaRitirare() {
  const { cavallette, oggi, chiusure, soglia, oreGiro, nomeVetreria, errore, ricarica } = useDati();
  const { profilo } = useAuth();
  const puoProgrammare = profilo?.ruolo === 'admin' || profilo?.ruolo === 'ufficio' || profilo?.ruolo === 'logistica' || profilo?.ruolo === 'autista';
  const [copiato, setCopiato] = useState(false);
  const [modoGiro, setModoGiro] = useState(false);
  const [scelte, setScelte] = useState<Set<string>>(new Set());
  const [occupato, setOccupato] = useState(false);
  const [errAzione, setErrAzione] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [cercaAnt, setCercaAnt] = useState('');

  const righe = useMemo<Riga[]>(
    () =>
      cavallette
        .filter((c) => daRitirare(c, oggi, chiusure, soglia))
        .map((c) => ({ c, giorni: giorniInCantiere(c, oggi, chiusure) ?? 0 }))
        .sort((a, b) => b.giorni - a.giorni),
    [cavallette, oggi, chiusure, soglia],
  );

  // divise per provincia (ordine alfabetico, «non indicata» in fondo)
  const perProvincia = useMemo(() => {
    const m = new Map<string, Riga[]>();
    for (const r of righe) {
      const k = provinciaDa(r.c.indirizzo);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === SENZA_PROVINCIA ? 1 : b === SENZA_PROVINCIA ? -1 : a.localeCompare(b, 'it')));
  }, [righe]);

  // prossime in scadenza (ultimi 3 giorni lavorativi prima della soglia)
  const inArrivo = useMemo<Riga[]>(
    () =>
      cavallette
        .filter((c) => c.luogo === 'cliente' && !inGiro(c) && !daRitirare(c, oggi, chiusure, soglia))
        .map((c) => ({ c, giorni: giorniInCantiere(c, oggi, chiusure) ?? 0 }))
        .filter((x) => x.giorni >= soglia - 3)
        .sort((a, b) => b.giorni - a.giorni),
    [cavallette, oggi, chiusure, soglia],
  );

  // giri programmati: grigie, tornano vuote in piazzale da sole
  const ingiro = useMemo(
    () => cavallette.filter(inGiro).sort((a, b) => (a.in_giro_il ?? '').localeCompare(b.in_giro_il ?? '') || a.numero.localeCompare(b.numero, 'it', { numeric: true })),
    [cavallette],
  );

  // caso eccezionale: anche le cavallette dal cliente da meno di 10 giorni si possono ritirare in anticipo
  const anticipate = useMemo(() => {
    const gia = new Set([...righe, ...inArrivo].map((r) => r.c.id));
    return cavallette
      .filter((c) => c.luogo === 'cliente' && !inGiro(c) && !gia.has(c.id))
      .map((c) => ({ c, giorni: giorniInCantiere(c, oggi, chiusure) ?? 0 }))
      .sort((a, b) => b.giorni - a.giorni);
  }, [cavallette, righe, inArrivo, oggi, chiusure]);
  const anticipateVisibili = useMemo(() => {
    const q = cercaAnt.trim().toLowerCase();
    if (!q) return anticipate;
    return anticipate.filter(({ c }) => [c.numero, c.cliente, c.commessa, c.indirizzo].some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [anticipate, cercaAnt]);

  const scegliibili = useMemo(() => new Set([...righe, ...inArrivo, ...anticipate].map((r) => r.c.id)), [righe, inArrivo, anticipate]);
  const nScelte = [...scelte].filter((id) => scegliibili.has(id)).length;
  const nAnticipate = anticipate.filter(({ c }) => scelte.has(c.id)).length;

  function alterna(id: string): void {
    setScelte((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function tutteDel(elenco: Riga[], su: boolean): void {
    setScelte((s) => {
      const n = new Set(s);
      for (const { c } of elenco) {
        if (su) n.add(c.id);
        else n.delete(c.id);
      }
      return n;
    });
  }
  function chiudiModo(): void {
    setModoGiro(false);
    setScelte(new Set());
    setMotivo('');
    setCercaAnt('');
  }

  async function invia(): Promise<void> {
    const ids = [...scelte].filter((id) => scegliibili.has(id));
    if (!ids.length) return;
    setErrAzione(null);
    setEsito(null);
    if (nAnticipate > 0 && !motivo.trim()) {
      setErrAzione('Per ritirare cavallette in anticipo scrivi il motivo (resta nel registro).');
      return;
    }
    setOccupato(true);
    try {
      await programmaGiro(ids, nAnticipate > 0 ? motivo.trim() : undefined);
      setEsito(`Giro programmato: ${ids.length} ${ids.length === 1 ? 'cavalletta' : 'cavallette'}. Dopo ${oreGiro} ore tornano vuote in piazzale.`);
      chiudiModo();
      await ricarica();
    } catch (e) {
      setErrAzione(e instanceof Error ? e.message : 'Errore');
    } finally {
      setOccupato(false);
    }
  }

  async function annulla(ids: string[]): Promise<void> {
    setOccupato(true);
    setErrAzione(null);
    setEsito(null);
    try {
      await annullaGiro(ids);
      setEsito(ids.length === 1 ? 'Giro annullato: la cavalletta risulta di nuovo dal cliente.' : 'Giro annullato per le cavallette indicate.');
      await ricarica();
    } catch (e) {
      setErrAzione(e instanceof Error ? e.message : 'Errore');
    } finally {
      setOccupato(false);
    }
  }

  async function copia(): Promise<void> {
    const testo = perProvincia
      .map(([prov, elenco]) =>
        [`${prov} (${elenco.length})`, ...elenco.map(({ c }) => [c.numero, nomeVetreria(c.vetreria), c.cliente ?? '', c.indirizzo ?? '', c.commessa ?? ''].join(' | '))].join('\n'),
      )
      .join('\n\n');
    await navigator.clipboard.writeText(testo);
    setCopiato(true);
    window.setTimeout(() => setCopiato(false), 2500);
  }

  const Spunta = (p: { c: Cavalletta }) => (
    <td className="spunta-col">
      <input type="checkbox" aria-label={`Seleziona ${p.c.numero}`} checked={scelte.has(p.c.id)} onChange={() => alterna(p.c.id)} />
    </td>
  );

  return (
    <>
      <Titolo
        titolo="Cavallette da ritirare"
        sotto={`Dal cliente da almeno ${soglia} giorni lavorativi, divise per provincia: presumibilmente vuote. Con «Programma giro di raccolta» l'autista sceglie quelle che va a recuperare.`}
        azioni={
          <>
            {puoProgrammare && !modoGiro && (righe.length > 0 || inArrivo.length > 0 || anticipate.length > 0) && (
              <button className="btn btn-primary" onClick={() => setModoGiro(true)}>Programma giro di raccolta</button>
            )}
            {righe.length > 0 && <button className="btn" onClick={() => void copia()}>{copiato ? 'Copiato!' : 'Copia elenco'}</button>}
          </>
        }
      />
      {errore && <Messaggio tipo="errore">{errore}</Messaggio>}
      {errAzione && <Messaggio tipo="errore">{errAzione}</Messaggio>}
      {esito && <Messaggio tipo="ok">{esito}</Messaggio>}
      {modoGiro && (
        <Messaggio tipo="info">
          Spunta le cavallette che l'autista va a ritirare e premi <strong>Invia giro</strong>: diventano grigie («In ritiro»). Dopo {oreGiro} ore le ritrovi vuote in piazzale, pronte per la restituzione o per un nuovo giro.
        </Messaggio>
      )}

      {ingiro.length > 0 && (
        <section className="gruppo giro">
          <h2>
            In giro di raccolta <span className="sotto">· {ingiro.length} {ingiro.length === 1 ? 'cavalletta' : 'cavallette'}</span>
          </h2>
          <div className="scorri">
            <table className="tabella righe-grigie">
              <thead>
                <tr><th>N.</th><th>Vetreria</th><th>Cliente</th><th>Indirizzo</th><th>Partito il</th><th>Rientra in piazzale</th>{puoProgrammare && <th />}</tr>
              </thead>
              <tbody>
                {ingiro.map((c) => (
                  <tr key={c.id}>
                    <td className="numero">{c.numero}</td>
                    <td>{nomeVetreria(c.vetreria)}</td>
                    <td>{c.cliente}</td>
                    <td>{c.indirizzo}</td>
                    <td>{c.in_giro_il ? dataOra(c.in_giro_il) : ''}</td>
                    <td><Badge tono="grigio">tra {oreTesto(oreAlRientro(c, oreGiro))}</Badge></td>
                    {puoProgrammare && (
                      <td><button className="btn" disabled={occupato} onClick={() => void annulla([c.id])}>Annulla giro</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {righe.length === 0 ? (
        <p className="vuoto">Nessuna cavalletta da ritirare in questo momento.</p>
      ) : (
        perProvincia.map(([prov, elenco]) => {
          const tutte = elenco.every(({ c }) => scelte.has(c.id));
          return (
            <section key={prov} className="gruppo">
              <h2>
                {prov} <span className="sotto">· {elenco.length} {elenco.length === 1 ? 'cavalletta' : 'cavallette'}</span>
                {modoGiro && (
                  <button className="btn btn-piccolo" onClick={() => tutteDel(elenco, !tutte)}>{tutte ? 'Deseleziona' : 'Seleziona tutte'}</button>
                )}
              </h2>
              <div className="scorri">
                <table className="tabella">
                  <thead>
                    <tr>{modoGiro && <th />}<th>N.</th><th>Vetreria</th><th>Cliente</th><th>Indirizzo</th><th>Commessa</th><th>Dal cliente da</th><th>Giorni lav.</th></tr>
                  </thead>
                  <tbody>
                    {elenco.map(({ c, giorni }) => (
                      <tr key={c.id} className={scelte.has(c.id) ? 'riga-scelta' : ''}>
                        {modoGiro && <Spunta c={c} />}
                        <td className="numero">{c.numero}</td>
                        <td>{nomeVetreria(c.vetreria)}</td>
                        <td>{c.cliente}</td>
                        <td>{c.indirizzo}</td>
                        <td>{c.commessa}</td>
                        <td>{formattaData(c.data_consegna)}</td>
                        <td className="num"><strong>{giorni}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {inArrivo.length > 0 && (
        <>
          <h2>Presto da ritirare</h2>
          <div className="scorri">
            <table className="tabella">
              <thead>
                <tr>{modoGiro && <th />}<th>N.</th><th>Provincia</th><th>Cliente</th><th>Indirizzo</th><th>Giorni lav.</th><th>Scatta il</th></tr>
              </thead>
              <tbody>
                {inArrivo.map(({ c, giorni }) => (
                  <tr key={c.id} className={scelte.has(c.id) ? 'riga-scelta' : ''}>
                    {modoGiro && <Spunta c={c} />}
                    <td className="numero">{c.numero}</td>
                    <td>{provinciaDa(c.indirizzo)}</td>
                    <td>{c.cliente}</td>
                    <td>{c.indirizzo}</td>
                    <td className="num">{giorni}</td>
                    <td>{c.data_consegna ? formattaData(aggiungiGiorniLavorativi(c.data_consegna, soglia, chiusure)) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modoGiro && anticipate.length > 0 && (
        <>
          <h2>Ritiro anticipato <span className="sotto">· caso eccezionale, prima dei {soglia} giorni lavorativi</span></h2>
          <div className="toolbar">
            <input className="cerca" placeholder="Cerca per numero, cliente, commessa…" value={cercaAnt} onChange={(e) => setCercaAnt(e.target.value)} />
          </div>
          <div className="scorri">
            <table className="tabella">
              <thead>
                <tr><th /><th>N.</th><th>Provincia</th><th>Cliente</th><th>Commessa</th><th>Giorni lav.</th></tr>
              </thead>
              <tbody>
                {anticipateVisibili.map(({ c, giorni }) => (
                  <tr key={c.id} className={scelte.has(c.id) ? 'riga-scelta' : ''}>
                    <Spunta c={c} />
                    <td className="numero col-numero">{c.numero}</td>
                    <td>{provinciaDa(c.indirizzo)}</td>
                    <td>{c.cliente}</td>
                    <td>{c.commessa}</td>
                    <td className="num">{giorni}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modoGiro && (
        <div className="barra-riepilogo">
          <div>
            <strong>{nScelte} {nScelte === 1 ? 'cavalletta selezionata' : 'cavallette selezionate'}</strong>
            {nAnticipate > 0 ? (
              <label className="form">
                Motivo del ritiro anticipato ({nAnticipate} {nAnticipate === 1 ? 'cavalletta' : 'cavallette'} prima dei {soglia} giorni)
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="es. il cliente ha finito, serve la cavalletta" />
              </label>
            ) : (
              <div className="sotto">Diventano grigie e dopo {oreGiro} ore rientrano vuote in piazzale.</div>
            )}
          </div>
          <div className="riga-bottoni">
            <button className="btn btn-primary" disabled={nScelte === 0 || occupato} onClick={() => void invia()}>{occupato ? 'Invio…' : 'Invia giro'}</button>
            <button className="btn" disabled={occupato} onClick={chiudiModo}>Annulla</button>
          </div>
        </div>
      )}
    </>
  );
}
