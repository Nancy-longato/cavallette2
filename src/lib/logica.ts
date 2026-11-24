import type { Cavalletta } from './types.ts';
import { LONGATO } from './types.ts';
import { diffDays, giorniLavorativiTra, oggiRoma } from './dates.ts';

/** Giorni lavorativi da quando la cavalletta è dal cliente (null se non è dal cliente) */
export function giorniInCantiere(c: Cavalletta, oggi: string, chiusure: ReadonlySet<string>): number | null {
  if (c.luogo !== 'cliente' || !c.data_consegna) return null;
  return giorniLavorativiTra(c.data_consegna, oggi, chiusure);
}

/** Dal cliente da almeno `soglia` giorni lavorativi: presumibilmente vuota, da andare a ritirare */
export function daRitirare(c: Cavalletta, oggi: string, chiusure: ReadonlySet<string>, soglia: number): boolean {
  if (inGiro(c)) return false; // il giro di raccolta è già stato programmato
  const g = giorniInCantiere(c, oggi, chiusure);
  return g !== null && g >= soglia;
}

/** Giro di raccolta programmato (la cavalletta è «grigia» finché non passano le ore) */
export function inGiro(c: Cavalletta): boolean {
  return c.luogo === 'cliente' && !!c.in_giro_il;
}

/** Ore che mancano al rientro automatico in piazzale (0 se già scadute) */
export function oreAlRientro(c: Cavalletta, oreGiro: number, adesso: Date = new Date()): number {
  if (!c.in_giro_il) return 0;
  const fine = new Date(c.in_giro_il).getTime() + oreGiro * 3_600_000;
  return Math.max(0, (fine - adesso.getTime()) / 3_600_000);
}

export type Step = 'vetri' | 'serramenti_piazzale' | 'dal_cliente' | 'in_giro' | 'vuota';

export const NOMI_STEP: Record<Step, string> = {
  vetri: 'Piena di vetri',
  serramenti_piazzale: 'Serramenti in piazzale',
  dal_cliente: 'Dal cliente',
  in_giro: 'In giro di raccolta',
  vuota: 'Vuota in piazzale',
};

export function stepDi(c: Cavalletta): Step {
  if (c.luogo === 'cliente') return inGiro(c) ? 'in_giro' : 'dal_cliente';
  if (c.stato === 'piena_vetri') return 'vetri';
  if (c.stato === 'piena_serramenti') return 'serramenti_piazzale';
  return 'vuota';
}

/** Data (YYYY-MM-DD) in cui la cavalletta è entrata nello step in cui si trova adesso */
export function inizioStep(c: Cavalletta): string {
  const romaDa = (iso: string): string => oggiRoma(new Date(iso));
  switch (stepDi(c)) {
    case 'in_giro': return c.in_giro_il ? romaDa(c.in_giro_il) : c.stato_dal;
    case 'dal_cliente': return c.data_consegna ?? c.stato_dal;
    case 'vetri': return c.data_arrivo ?? c.stato_dal;
    default: return c.stato_dal;
  }
}

/** Giorni (di calendario) che la cavalletta è ferma nello step attuale */
export function giorniNelloStep(c: Cavalletta, oggi: string): number {
  return Math.max(0, diffDays(inizioStep(c), oggi));
}

/** Giorni di calendario da quando la cavalletta del fornitore è in sede (null per le nostre) */
export function giacenza(c: Cavalletta, oggi: string): number | null {
  if (c.vetreria === LONGATO || !c.data_arrivo) return null;
  return Math.max(0, diffDays(c.data_arrivo, oggi));
}

export function etichettaStato(c: Cavalletta, inAllerta: boolean): string {
  if (inGiro(c)) return 'In ritiro (giro)';
  if (inAllerta) return 'Vuota (da ritirare)';
  if (c.stato === 'piena_vetri') return 'Piena (vetri)';
  if (c.stato === 'piena_serramenti') return 'Piena (serramenti)';
  return 'Vuota';
}

export function etichettaLuogo(c: Cavalletta): string {
  return c.luogo === 'cliente' ? 'Dal cliente' : 'Piazzale';
}

import { nomeProvincia } from './province.ts';

export const SENZA_PROVINCIA = 'Provincia non indicata';

/**
 * Provincia dall'indirizzo, scritta tra parentesi in fondo: "VIA ROMA 22, CASTELFRANCO VENETO (TREVISO)" -> "Treviso".
 * Sigle e nomi si uniscono: "(VE)", "(Ve)" e "(VENEZIA)" -> "Venezia".
 */
export function provinciaDa(indirizzo: string | null | undefined): string {
  const m = /\(([^()]+)\)\s*$/.exec(indirizzo ?? '');
  const t = m ? m[1].trim().replace(/\s+/g, ' ') : '';
  if (!t) return SENZA_PROVINCIA;
  const nome = nomeProvincia(t);
  if (nome) return nome;
  if (t.length <= 2) return t.toUpperCase();
  return t.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (x) => x.toUpperCase());
}
