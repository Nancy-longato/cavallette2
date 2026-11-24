import { useMemo, useState } from 'react';
import type { Cavalletta } from '../lib/types.ts';
import { LONGATO } from '../lib/types.ts';
import { daRitirare, giorniNelloStep, stepDi } from '../lib/logica.ts';
import { useDati } from '../lib/dati.tsx';
import { Link } from '../lib/router.tsx';
import CavallettaTable from '../components/CavallettaTable.tsx';
import CavallettaDialog from '../components/CavallettaDialog.tsx';
import { Info, Messaggio, Titolo } from '../components/ui.tsx';

type Gruppo = 'tutte' | 'fornitori' | 'interne';
type Filtro = 'tutti' | 'vetri' | 'serramenti_piazzale' | 'cliente' | 'in_giro' | 'vuote' | 'da_ritirare';

export default function Dashboard() {
  const { cavallette, vetrerie, oggi, chiusure, soglia, nomeVetreria, caricamento, errore, anomalieAperte, ricarica } = useDati();
  const [gruppo, setGruppo] = useState<Gruppo>('tutte');
  const [filtro, setFiltro] = useState<Filtro>('tutti');
  const [vetreria, setVetreria] = useState('');
  const [cerca, setCerca] = useState('');
  const [minGiorni, setMinGiorni] = useState('');
  const [aperta, setAperta] = useState<Cavalletta | null>(null);

  const allerta = (c: Cavalletta): boolean => daRitirare(c, oggi, chiusure, soglia);

  const base = useMemo(
    () => cavallette.filter((c) => gruppo === 'tutte' || (gruppo === 'interne') === (c.vetreria === LONGATO)),
    [cavallette, gruppo],
  );

  const passa = (c: Cavalletta, f: Filtro): boolean => {
    switch (f) {
      case 'tutti': return true;
      case 'vetri': return stepDi(c) === 'vetri';
      case 'serramenti_piazzale': return stepDi(c) === 'serramenti_piazzale';
      case 'cliente': return c.luogo === 'cliente' && stepDi(c) !== 'in_giro';
      case 'in_giro': return stepDi(c) === 'in_giro';
      case 'vuote': return stepDi(c) === 'vuota';
      case 'da_ritirare': return allerta(c);
    }
  };

  const conta = (f: Filtro): number => base.filter((c) => passa(c, f)).length;
  /** giorni medi e massimi che le cavallette di uno step restano ferme */
  const tempi = (f: Filtro): { media: number; max: number } | null => {
    const g = base.filter((c) => passa(c, f)).map((c) => giorniNelloStep(c, oggi));
    if (!g.length) return null;
    return { media: Math.round(g.reduce((a, b) => a + b, 0) / g.length), max: Math.max(...g) };
  };
  const minimo = Number(minGiorni);

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return base.filter((c) => {
      if (!passa(c, filtro)) return false;
      if (vetreria && c.vetreria !== vetreria) return false;
      if (minGiorni !== '' && Number.isFinite(minimo) && giorniNelloStep(c, oggi) < minimo) return false;
      if (!q) return true;
      return [c.numero, c.commessa, c.cliente, c.indirizzo, c.contenuto].some((v) => (v ?? '').toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filtro, vetreria, cerca, minGiorni, oggi, chiusure, soglia]);

  const schede: { f: Filtro; titolo: string; classe?: string }[] = [
    { f: 'tutti', titolo: 'In sede / in giro' },
    { f: 'vetri', titolo: 'Piene di vetri' },
    { f: 'serramenti_piazzale', titolo: 'Serramenti in piazzale' },
    { f: 'cliente', titolo: 'Dal cliente' },
    { f: 'in_giro', titolo: 'In ritiro (giro)' },
    { f: 'vuote', titolo: 'Vuote in piazzale' },
    { f: 'da_ritirare', titolo: 'Da ritirare', classe: 'allerta' },
  ];

  return (
    <>
      <Titolo
        titolo="Cruscotto cavallette"
        sotto="Situazione in tempo reale e da quanti giorni ogni cavalletta è ferma nel suo step (vetri, serramenti in piazzale, dal cliente, vuota). Clicca una riga per vedere lo storico."
        azioni={<button className="btn" onClick={() => void ricarica()}>Aggiorna</button>}
      />
      {errore && <Messaggio tipo="errore">{errore}</Messaggio>}
      {anomalieAperte > 0 && (
        <Messaggio tipo="avviso">
          Ci sono <strong>{anomalieAperte}</strong> segnalazioni da controllare. <Link to="/segnalazioni">Vai alle segnalazioni</Link>
        </Messaggio>
      )}

      <div className="segmenti">
        {(['tutte', 'fornitori', 'interne'] as Gruppo[]).map((g) => (
          <button key={g} className={`segmento ${gruppo === g ? 'attivo' : ''}`} onClick={() => setGruppo(g)}>
            {g === 'tutte' ? 'Tutte' : g === 'fornitori' ? 'Dei fornitori' : 'Nostre (Longato)'}
          </button>
        ))}
      </div>

      <div className="stats">
        {schede.map((s) => (
          <div key={s.f} className="stat-wrap">
            <button
              className={`stat ${filtro === s.f ? 'attivo' : ''} ${s.classe && conta(s.f) > 0 ? s.classe : ''}`}
              onClick={() => setFiltro(filtro === s.f ? 'tutti' : s.f)}
            >
              <span className="stat-n">{conta(s.f)}</span>
              <span className="stat-t">{s.titolo}</span>
            </button>
            {s.f !== 'tutti' && s.f !== 'da_ritirare' && tempi(s.f) && (
              <Info etichetta={`Tempi di fermo: ${s.titolo}`} allineaDestra>
                Ferme in questo step
                <br />
                in media <strong>{tempi(s.f)!.media} gg</strong> · al massimo <strong>{tempi(s.f)!.max} gg</strong>
              </Info>
            )}
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input className="cerca" placeholder="Cerca numero, commessa, cliente, indirizzo…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <select value={vetreria} onChange={(e) => setVetreria(e.target.value)}>
          <option value="">Tutte le vetrerie</option>
          {vetrerie.map((v) => (
            <option key={v.codice} value={v.codice}>{v.nome}</option>
          ))}
        </select>
        <label className="inline">
          Ferme nello step da almeno
          <input className="num-corto" type="number" min={0} inputMode="numeric" placeholder="gg" value={minGiorni} onChange={(e) => setMinGiorni(e.target.value)} />
          giorni
        </label>
        <span className="nota">{visibili.length} cavallette</span>
      </div>

      {caricamento ? (
        <p className="vuoto">Caricamento…</p>
      ) : (
        <CavallettaTable righe={visibili} oggi={oggi} chiusure={chiusure} soglia={soglia} nomeVetreria={nomeVetreria} onSeleziona={setAperta} />
      )}

      {aperta && (
        <CavallettaDialog
          key={aperta.id}
          cavalletta={aperta}
          onChiudi={() => setAperta(null)}
          onModificata={() => {
            setAperta(null);
            void ricarica();
          }}
        />
      )}
    </>
  );
}
