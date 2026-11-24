import type { ReactNode } from 'react';

export type Tono = 'verde' | 'giallo' | 'rosso' | 'blu' | 'grigio';

export function Badge(props: { tono: Tono; children: ReactNode }) {
  return <span className={`badge badge-${props.tono}`}>{props.children}</span>;
}

/** Piccola «i» cerchiata: il testo compare passandoci sopra o toccandola */
export function Info(props: { children: ReactNode; etichetta?: string; allineaDestra?: boolean }) {
  return (
    <span className="info" tabIndex={0} role="note" aria-label={props.etichetta ?? 'Informazioni'}>
      <span className="info-i" aria-hidden="true">i</span>
      <span className={`info-box ${props.allineaDestra ? 'destra' : ''}`}>{props.children}</span>
    </span>
  );
}

export function Messaggio(props: { tipo: 'errore' | 'ok' | 'info' | 'avviso'; children: ReactNode }) {
  return <div className={`messaggio messaggio-${props.tipo}`}>{props.children}</div>;
}

export function Titolo(props: { titolo: string; sotto?: string; azioni?: ReactNode }) {
  return (
    <div className="titolo">
      <div>
        <h1>{props.titolo}</h1>
        {props.sotto && <p className="sotto">{props.sotto}</p>}
      </div>
      {props.azioni && <div className="azioni">{props.azioni}</div>}
    </div>
  );
}

export function dataOra(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
}

/** Logo Longato (cartella public/) */
export const LOGO = `${import.meta.env.BASE_URL}logo.png`;
