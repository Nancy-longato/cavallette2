import { useEffect, useMemo, useState } from 'react';
import { caricaRegistro, caricaRestituzioni } from '../lib/api.ts';
import type { Cavalletta, MovimentoRegistro, Restituzione } from '../lib/types.ts';
import { addDays, formattaData, parseIso } from '../lib/dates.ts';
import { normalizzaChiave } from '../lib/keys.ts';
import { useDati } from '../lib/dati.tsx';
import CavallettaDialog from '../components/CavallettaDialog.tsx';
import { Badge, Messaggio, Titolo, dataOra } from '../components/ui.tsx';
import { nomiCarico } from '../lib/types.ts';
import type { Tono } from '../components/ui.tsx';

export const NOMI_MOVIMENTO: Record<string, string> = {
  carico: 'Carico: arrivo dalla vetreria',
  carico_interna: 'Carico: cavalletta Longato',
  imballata: 'Cavalletta caricata (pronta per il cliente)',
  consegna: 'Consegna al cliente',
  giro_programmato: 'Giro di raccolta programmato',
  giro_annullato: 'Giro di raccolta annullato',
  rientro: 'Rientro in piazzale (vuota)',
  non_usata: 'Vuota: non usata in produzione',
  restituzione: 'Scarico: restituita alla vetreria',
  correzione_manuale: 'Correzione manuale (amministratore)',
  modifica: 'Modifica',
  eliminazione: 'Eliminata (errore di inserimento)',
};

const TONO: Record<string, Tono> = {
  carico: 'blu', carico_interna: 'blu', imballata: 'giallo', consegna: 'giallo', giro_programmato: 'grigio', giro_annullato: 'grigio',
  rientro: 'verde', non_usata: 'verde', restituzione: 'verde', correzione_manuale: 'rosso', eliminazione: 'rosso', modifica: 'grigio',
};

const ENTRATE = new Set(['carico', 'carico_interna']);
const NOMI_CAMPO: Record<string, string> = {
  luogo: 'luogo', stato: 'stato', commessa: 'commessa', cliente: 'cliente', indirizzo: 'indirizzo', note: 'note', contenuto: 'contenuto',
  carico: 'carico', data_consegna: 'dal cliente da', data_uscita: 'data uscita', ddt_consegna: 'DDT consegna', in_giro_il: 'giro di raccolta',
};

function cambi(m: MovimentoRegistro): string {
  const c = (m.dettaglio.cambi ?? {}) as Record<string, { da: unknown; a: unknown }>;
  return Object.entries(c)
    .filter(([k]) => NOMI_CAMPO[k])
    .map(([k, v]) => `${NOMI_CAMPO[k]}: ${String(v.da ?? '–')} → ${String(v.a ?? '–')}`)
    .join(' · ');
}

function oraRoma(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
}

function giornoLungo(iso: string): string {
  return parseIso(iso).toLocaleDateString('it-IT', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function csv(righe: MovimentoRegistro[]): string {
  const campo = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const testa = ['Progressivo', 'Data', 'Ora', 'Movimento', 'Cavalletta', 'Vetreria', 'Commessa', 'Cliente', 'DDT', 'Da', 'A', 'Utente', 'Modifica manuale', 'Dettaglio'];
  const corpo = righe.map((m) =>
    [m.progressivo, formattaData(m.data_mov), oraRoma(m.creato_il), NOMI_MOVIMENTO[m.tipo] ?? m.tipo, m.numero, m.vetreria, m.commessa, m.cliente, m.ddt,
      [m.da_luogo, m.da_stato].filter(Boolean).join('/'), [m.a_luogo, m.a_stato].filter(Boolean).join('/'), m.utente_email, m.manuale ? 'sì' : '', cambi(m)]
      .map(campo)
      .join(';'),
  );
  return `﻿${[testa.map(campo).join(';'), ...corpo].join('\r\n')}`;
}

function Registro() {
  const { oggi, cavallette, nomeVetreria } = useDati();
  const [da, setDa] = useState(addDays(oggi, -30));
  const [a, setA] = useState(oggi);
  const [dati, setDati] = useState<MovimentoRegistro[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState('');
  const [tipo, setTipo] = useState('');
  const [soloManuali, setSoloManuali] = useState(false);
  const [aperta, setAperta] = useState<Cavalletta | null>(null);

  useEffect(() => {
    let annullato = false;
    setDati(null);
    caricaRegistro({ da: da || undefined, a: a || undefined })
      .then((d) => {
        if (!annullato) setDati(d);
      })
      .catch((e: unknown) => {
        if (!annullato) setErrore(e instanceof Error ? e.message : 'Errore di caricamento');
      });
    return () => {
      annullato = true;
    };
  }, [da, a]);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const qn = normalizzaChiave(cerca);
    return (dati ?? []).filter((m) => {
      if (tipo && m.tipo !== tipo) return false;
      if (soloManuali && !m.manuale) return false;
      if (!q) return true;
      return (
        (qn !== '' && normalizzaChiave(m.numero).includes(qn)) ||
        [m.commessa, m.cliente, m.ddt, m.utente_email].some((v) => (v ?? '').toLowerCase().includes(q))
      );
    });
  }, [dati, cerca, tipo, soloManuali]);

  const perGiorno = useMemo(() => {
    const m = new Map<string, MovimentoRegistro[]>();
    for (const r of filtrati) m.set(r.data_mov, [...(m.get(r.data_mov) ?? []), r]);
    return [...m.entries()].sort(([x], [y]) => y.localeCompare(x));
  }, [filtrati]);

  function scarica(): void {
    const blob = new Blob([csv([...filtrati].sort((x, y) => x.progressivo - y.progressivo))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `registro-cavallette_${da || 'inizio'}_${a || oggi}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function apri(m: MovimentoRegistro): void {
    const c = cavallette.find((x) => x.id === m.cavalletta_id);
    if (c) setAperta(c);
  }

  return (
    <>
      {errore && <Messaggio tipo="errore">{errore}</Messaggio>}
      <div className="toolbar">
        <input className="cerca" placeholder="Cerca cavalletta (es. P-E82), commessa, DDT, cliente…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <label className="inline">Dal<input type="date" value={da} max={a || undefined} onChange={(e) => setDa(e.target.value)} /></label>
        <label className="inline">Al<input type="date" value={a} min={da || undefined} onChange={(e) => setA(e.target.value)} /></label>
        <button className="btn" onClick={() => { setDa(''); setA(oggi); }}>Tutto</button>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Tutti i movimenti</option>
          {Object.entries(NOMI_MOVIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="inline"><input type="checkbox" checked={soloManuali} onChange={(e) => setSoloManuali(e.target.checked)} /> Solo correzioni manuali</label>
        <button className="btn" disabled={filtrati.length === 0} onClick={scarica}>Scarica Excel (CSV)</button>
      </div>

      {dati === null ? (
        <p className="vuoto">Caricamento…</p>
      ) : filtrati.length === 0 ? (
        <p className="vuoto">Nessun movimento nel periodo e con i filtri scelti.</p>
      ) : (
        <>
          <p className="nota">{filtrati.length} movimenti · dal registro progressivo n. {Math.min(...filtrati.map((m) => m.progressivo))} al n. {Math.max(...filtrati.map((m) => m.progressivo))}</p>
          {perGiorno.map(([giorno, righe]) => {
            const entrate = righe.filter((m) => ENTRATE.has(m.tipo)).length;
            const uscite = righe.filter((m) => m.tipo === 'restituzione').length;
            return (
              <section key={giorno} className="gruppo">
                <h2>
                  {giornoLungo(giorno)}{' '}
                  <span className="sotto">· {righe.length} movimenti{entrate ? ` · ${entrate} in carico` : ''}{uscite ? ` · ${uscite} restituite` : ''}</span>
                </h2>
                <div className="scorri">
                  <table className="tabella">
                    <thead>
                      <tr><th>N. reg.</th><th>Ora</th><th>Movimento</th><th>Cavalletta</th><th>Commessa / cliente</th><th>DDT</th><th>Utente</th></tr>
                    </thead>
                    <tbody>
                      {[...righe].sort((x, y) => y.progressivo - x.progressivo).map((m) => (
                        <tr key={m.progressivo} className={m.manuale ? 'riga-manuale' : ''}>
                          <td className="num">{m.progressivo}</td>
                          <td>{oraRoma(m.creato_il)}</td>
                          <td>
                            <Badge tono={TONO[m.tipo] ?? 'grigio'}>{NOMI_MOVIMENTO[m.tipo] ?? m.tipo}</Badge>
                            {Array.isArray(m.dettaglio.carico) && <div className="sotto">Carico: {nomiCarico(m.dettaglio.carico as string[])}</div>}
                            {cambi(m) && <div className="sotto">{cambi(m)}</div>}
                            {typeof m.dettaglio.motivo === 'string' && <div className="sotto">Motivo: {m.dettaglio.motivo}</div>}
                          </td>
                          <td className="numero">
                            {m.cavalletta_id && cavallette.some((c) => c.id === m.cavalletta_id) ? (
                              <button className="link" onClick={() => apri(m)}>{m.numero}</button>
                            ) : (
                              m.numero
                            )}
                            {m.vetreria && <div className="sotto">{nomeVetreria(m.vetreria)}</div>}
                          </td>
                          <td>{[m.commessa, m.cliente].filter(Boolean).join(' · ')}</td>
                          <td>{m.ddt}</td>
                          <td>
                            {m.utente_email ?? ''}
                            {m.manuale && <div><Badge tono="rosso">modificato a mano</Badge></div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
      {aperta && <CavallettaDialog key={aperta.id} cavalletta={aperta} onChiudi={() => setAperta(null)} onModificata={() => setAperta(null)} />}
    </>
  );
}

function Restituzioni() {
  const { nomeVetreria } = useDati();
  const [dati, setDati] = useState<{ restituzione: Restituzione; cavallette: Cavalletta[] }[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState('');
  const [aperta, setAperta] = useState<Cavalletta | null>(null);

  useEffect(() => {
    caricaRestituzioni().then(setDati).catch((e: unknown) => setErrore(e instanceof Error ? e.message : 'Errore di caricamento'));
  }, []);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (!dati) return [];
    if (!q) return dati;
    return dati.filter((d) => nomeVetreria(d.restituzione.vetreria).toLowerCase().includes(q) || d.cavallette.some((c) => c.numero.toLowerCase().includes(q)));
  }, [dati, cerca, nomeVetreria]);

  return (
    <>
      {errore && <Messaggio tipo="errore">{errore}</Messaggio>}
      <p className="nota">Le cavallette riportate alle vetrerie: data e elenco di ogni restituzione.</p>
      <div className="toolbar">
        <input className="cerca" placeholder="Cerca vetreria o numero cavalletta…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
      </div>
      {dati === null ? (
        <p className="vuoto">Caricamento…</p>
      ) : filtrati.length === 0 ? (
        <p className="vuoto">Nessuna restituzione trovata.</p>
      ) : (
        <ul className="lista-card">
          {filtrati.map(({ restituzione: r, cavallette }) => (
            <li key={r.id} className="card">
              <details>
                <summary>
                  <strong>{formattaData(r.data)}</strong> · {nomeVetreria(r.vetreria)} · {cavallette.length} cavallette <span className="sotto">({dataOra(r.creata_il)})</span>
                </summary>
                <div className="chip-lista">
                  {cavallette.map((c) => (
                    <button key={c.id} className="chip" onClick={() => setAperta(c)}>{c.numero}</button>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {aperta && <CavallettaDialog key={aperta.id} cavalletta={aperta} onChiudi={() => setAperta(null)} onModificata={() => setAperta(null)} />}
    </>
  );
}

export default function Storico() {
  const [vista, setVista] = useState<'registro' | 'restituzioni'>('registro');
  return (
    <>
      <Titolo
        titolo="Registro movimenti"
        sotto="Come un magazzino fiscale: ogni movimento ha un numero progressivo, data, ora e utente. Non si può cancellare né modificare; un errore si corregge con un nuovo movimento."
      />
      <div className="segmenti">
        <button className={`segmento ${vista === 'registro' ? 'attivo' : ''}`} onClick={() => setVista('registro')}>Movimenti per data</button>
        <button className={`segmento ${vista === 'restituzioni' ? 'attivo' : ''}`} onClick={() => setVista('restituzioni')}>Restituzioni alle vetrerie</button>
      </div>
      {vista === 'registro' ? <Registro /> : <Restituzioni />}
    </>
  );
}
