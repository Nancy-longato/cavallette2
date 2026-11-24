-- =====================================================================
-- CAVALLETTE - schema Supabase
-- Incolla tutto in: Supabase > SQL Editor > New query > Run.
-- Si può rieseguire senza danni (usa "if not exists" / "or replace").
-- =====================================================================

-- ---------- RUOLI ----------------------------------------------------
do $$ begin
  create type public.ruolo_app as enum ('admin', 'ufficio', 'logistica', 'amministrazione', 'magazziniere', 'produzione', 'autista', 'nessuno');
exception when duplicate_object then null; end $$;

create table if not exists public.profili (
  id        uuid primary key references auth.users (id) on delete cascade,
  email     text,
  nome      text,
  ruolo     public.ruolo_app not null default 'nessuno',
  creato_il timestamptz not null default now()
);

-- Ogni nuovo utente (creato da Authentication > Users) riceve un profilo
-- con ruolo "nessuno": non vede nulla finché l'admin non gli assegna un ruolo.
create or replace function public.nuovo_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists su_nuovo_utente on auth.users;
create trigger su_nuovo_utente after insert on auth.users
  for each row execute function public.nuovo_utente();

-- Utenti già esistenti prima di eseguire questo script
insert into public.profili (id, email, nome)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

create or replace function public.ruolo_corrente() returns public.ruolo_app
language sql stable security definer set search_path = public as $$
  select coalesce((select ruolo from public.profili where id = auth.uid()), 'nessuno'::public.ruolo_app)
$$;

-- ---------- TABELLE --------------------------------------------------
create table if not exists public.vetrerie (
  codice      text primary key,            -- P, F, B, PG, L
  nome        text not null,
  restituibile boolean not null default true,  -- false = nostre (Longato)
  ordine      int not null default 0
);

insert into public.vetrerie (codice, nome, restituibile, ordine) values
  ('P',  'Pescini',     true,  1),
  ('F',  'Feca',        true,  2),
  ('B',  'Bizzotto',    true,  3),
  ('PG', 'Press Glass', true,  4),
  ('L',  'Longato',     false, 5)
on conflict (codice) do nothing;

create table if not exists public.restituzioni (
  id         uuid primary key default gen_random_uuid(),
  vetreria   text not null references public.vetrerie (codice),
  data       date not null default (timezone('Europe/Rome', now()))::date,
  creata_da  uuid default auth.uid(),
  creata_il  timestamptz not null default now()
);

create table if not exists public.cavallette (
  id              uuid primary key default gen_random_uuid(),
  numero          text not null,                 -- chiave normalizzata (es. PE82, 62)
  vetreria        text not null references public.vetrerie (codice),
  etichetta       text,                          -- codice come stampato sul DDT
  contenuto       text,                          -- vetri contenuti (solo mentre è piena di vetri)
  data_arrivo     date,                          -- solo cavallette dei fornitori
  ddt_arrivo      text,
  luogo           text not null default 'piazzale' check (luogo in ('piazzale', 'cliente')),
  stato           text not null default 'vuota'   check (stato in ('piena_vetri', 'piena_serramenti', 'vuota')),
  commessa        text,
  cliente         text,
  indirizzo       text,
  data_uscita     date,                          -- da Smartsheet (colonna data uscita)
  data_consegna   date,                          -- da quando è dal cliente (base dei 10 giorni)
  note            text,
  restituita      boolean not null default false,
  restituita_il   timestamptz,
  restituzione_id uuid references public.restituzioni (id),
  creata_il       timestamptz not null default now(),
  aggiornata_il   timestamptz not null default now()
);

-- Un numero può essere riusato solo dopo che la vecchia cavalletta è stata restituita.
create unique index if not exists cavallette_numero_attive on public.cavallette (numero) where not restituita;
create index if not exists cavallette_restituzione on public.cavallette (restituzione_id);

-- Un "ciclo" = una cavalletta abbinata a una commessa (1 imballata, 2 dal cliente, 3 rientrata).
-- Serve a rendere l'import di Smartsheet ripetibile senza duplicati né passi indietro.
create table if not exists public.cicli (
  id            uuid primary key default gen_random_uuid(),
  cavalletta_id uuid not null references public.cavallette (id) on delete cascade,
  commessa      text not null,
  fase          smallint not null check (fase between 1 and 3),
  cliente       text,
  indirizzo     text,
  data_uscita   date,
  data_consegna date,
  data_rientro  date,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (cavalletta_id, commessa)
);

create table if not exists public.eventi (
  id            bigint generated always as identity primary key,
  cavalletta_id uuid not null references public.cavallette (id) on delete cascade,
  tipo          text not null,
  dettaglio     jsonb not null default '{}'::jsonb,
  utente        uuid default auth.uid(),
  creato_il     timestamptz not null default now()
);
create index if not exists eventi_cavalletta on public.eventi (cavalletta_id, creato_il desc);

create table if not exists public.anomalie (
  id         bigint generated always as identity primary key,
  tipo       text not null,                -- sconosciuta | gia_in_uso
  numero     text not null,
  commessa   text not null default '',
  dettaglio  text,
  creata_il  timestamptz not null default now(),
  risolta    boolean not null default false,
  risolta_il timestamptz,
  risolta_da uuid
);
create unique index if not exists anomalie_aperte on public.anomalie (tipo, numero, commessa) where not risolta;

create table if not exists public.chiusure (
  data        date primary key,
  descrizione text
);

create table if not exists public.impostazioni (
  chiave text primary key,
  valore text not null
);
insert into public.impostazioni (chiave, valore) values ('giorni_alert', '10') on conflict (chiave) do nothing;

-- aggiornata_il automatico
create or replace function public.tocca_aggiornata() returns trigger language plpgsql as $$
begin
  new.aggiornata_il = now();
  return new;
end $$;
drop trigger if exists cavallette_tocca on public.cavallette;
create trigger cavallette_tocca before update on public.cavallette
  for each row execute function public.tocca_aggiornata();

create or replace function public.tocca_aggiornato() returns trigger language plpgsql as $$
begin
  new.aggiornato_il = now();
  return new;
end $$;
drop trigger if exists cicli_tocca on public.cicli;
create trigger cicli_tocca before update on public.cicli
  for each row execute function public.tocca_aggiornato();

-- ---------- SICUREZZA (RLS) -----------------------------------------
alter table public.profili       enable row level security;
alter table public.vetrerie      enable row level security;
alter table public.restituzioni  enable row level security;
alter table public.cavallette    enable row level security;
alter table public.cicli         enable row level security;
alter table public.eventi        enable row level security;
alter table public.anomalie      enable row level security;
alter table public.chiusure      enable row level security;
alter table public.impostazioni  enable row level security;

-- profili
drop policy if exists profili_select on public.profili;
create policy profili_select on public.profili for select to authenticated
  using (id = auth.uid() or public.ruolo_corrente() = 'admin');
drop policy if exists profili_update on public.profili;
create policy profili_update on public.profili for update to authenticated
  using (public.ruolo_corrente() = 'admin') with check (public.ruolo_corrente() = 'admin');

-- vetrerie, chiusure, impostazioni: leggono tutti i ruoli abilitati, scrive l'admin
drop policy if exists vetrerie_select on public.vetrerie;
create policy vetrerie_select on public.vetrerie for select to authenticated
  using (public.ruolo_corrente() <> 'nessuno');
drop policy if exists chiusure_select on public.chiusure;
create policy chiusure_select on public.chiusure for select to authenticated
  using (public.ruolo_corrente() <> 'nessuno');
drop policy if exists chiusure_admin on public.chiusure;
create policy chiusure_admin on public.chiusure for all to authenticated
  using (public.ruolo_corrente() = 'admin') with check (public.ruolo_corrente() = 'admin');
drop policy if exists impostazioni_select on public.impostazioni;
create policy impostazioni_select on public.impostazioni for select to authenticated
  using (public.ruolo_corrente() <> 'nessuno');
drop policy if exists impostazioni_admin on public.impostazioni;
create policy impostazioni_admin on public.impostazioni for all to authenticated
  using (public.ruolo_corrente() = 'admin') with check (public.ruolo_corrente() = 'admin');

-- cavallette
drop policy if exists cavallette_select_staff on public.cavallette;
create policy cavallette_select_staff on public.cavallette for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione', 'autista', 'magazziniere'));
-- (il magazziniere e gli autisti vedono il Cruscotto; modificano solo tramite le funzioni qui sotto)
drop policy if exists cavallette_select_magazziniere on public.cavallette;
drop policy if exists cavallette_insert on public.cavallette;
create policy cavallette_insert on public.cavallette for insert to authenticated
  with check (public.ruolo_corrente() in ('admin', 'ufficio'));
drop policy if exists cavallette_update on public.cavallette;
create policy cavallette_update on public.cavallette for update to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'amministrazione'))
  with check (public.ruolo_corrente() in ('admin', 'ufficio', 'amministrazione'));
drop policy if exists cavallette_delete on public.cavallette;
create policy cavallette_delete on public.cavallette for delete to authenticated
  using (public.ruolo_corrente() = 'admin');

-- cicli
drop policy if exists cicli_select on public.cicli;
create policy cicli_select on public.cicli for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'));
drop policy if exists cicli_write on public.cicli;
create policy cicli_write on public.cicli for all to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio'))
  with check (public.ruolo_corrente() in ('admin', 'ufficio'));

-- eventi
drop policy if exists eventi_select on public.eventi;
create policy eventi_select on public.eventi for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione', 'autista', 'magazziniere'));
drop policy if exists eventi_insert on public.eventi;
create policy eventi_insert on public.eventi for insert to authenticated
  with check (public.ruolo_corrente() in ('admin', 'ufficio', 'amministrazione'));

-- anomalie
drop policy if exists anomalie_select on public.anomalie;
create policy anomalie_select on public.anomalie for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'));
drop policy if exists anomalie_insert on public.anomalie;
create policy anomalie_insert on public.anomalie for insert to authenticated
  with check (public.ruolo_corrente() in ('admin', 'ufficio'));
drop policy if exists anomalie_update on public.anomalie;
create policy anomalie_update on public.anomalie for update to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'))
  with check (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'));

-- restituzioni: lettura per lo staff; la scrittura passa solo dalla funzione qui sotto
drop policy if exists restituzioni_select on public.restituzioni;
create policy restituzioni_select on public.restituzioni for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'));

-- ---------- RESTITUZIONE ALLA VETRERIA -------------------------------
-- Unico punto in cui il magazziniere può modificare dati. Controlla tutto lato server.
create or replace function public.restituisci_cavallette(p_vetreria text, p_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_ok int;
begin
  if public.ruolo_corrente() not in ('admin', 'magazziniere') then
    raise exception 'Non autorizzato';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Nessuna cavalletta selezionata';
  end if;
  if not exists (select 1 from vetrerie where codice = p_vetreria and restituibile) then
    raise exception 'Vetreria non valida o non restituibile';
  end if;
  select count(*) into v_ok from cavallette
   where id = any (v_ids) and vetreria = p_vetreria and not restituita
     and stato = 'vuota' and luogo = 'piazzale';
  if v_ok <> array_length(v_ids, 1) then
    raise exception 'Alcune cavallette non sono restituibili (non vuote, non in piazzale o di un''altra vetreria)';
  end if;

  insert into restituzioni (vetreria, creata_da) values (p_vetreria, auth.uid()) returning id into v_id;
  update cavallette set restituita = true, restituita_il = now(), restituzione_id = v_id
   where id = any (v_ids);
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select x, 'restituita', jsonb_build_object('vetreria', p_vetreria, 'restituzione_id', v_id), auth.uid()
    from unnest(v_ids) as x;
  -- le segnalazioni "non usata in produzione" si chiudono quando la cavalletta torna alla vetreria
  update anomalie set risolta = true, risolta_il = now()
   where tipo = 'non_usata' and not risolta
     and numero in (select numero from cavallette where id = any (v_ids));
  return v_id;
end $$;

revoke all on function public.restituisci_cavallette(text, uuid[]) from public, anon;
grant execute on function public.restituisci_cavallette(text, uuid[]) to authenticated;

-- =====================================================================
-- VERSIONE 2: giro di raccolta, consegne, produzione, registro movimenti
-- =====================================================================

-- ---------- NUOVE COLONNE --------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cavallette' and column_name = 'stato_dal') then
    alter table public.cavallette add column stato_dal date;
    -- per le cavallette già presenti: giorno dell'ultimo movimento registrato (o di creazione)
    update public.cavallette c set stato_dal = coalesce(
      (select (max(e.creato_il) at time zone 'Europe/Rome')::date from public.eventi e where e.cavalletta_id = c.id),
      (c.creata_il at time zone 'Europe/Rome')::date);
    alter table public.cavallette alter column stato_dal set not null;
    alter table public.cavallette alter column stato_dal set default (timezone('Europe/Rome', now()))::date;
  end if;
end $$;
alter table public.cavallette add column if not exists in_giro_il timestamptz;   -- giro di raccolta programmato
alter table public.cavallette add column if not exists ddt_consegna text;        -- DDT dell'amministrazione alla consegna

insert into public.impostazioni (chiave, valore) values ('ore_giro', '6') on conflict (chiave) do nothing;

-- "stato_dal" = da quando la cavalletta è nello step attuale; chi torna in piazzale esce dal giro
create or replace function public.tocca_aggiornata() returns trigger language plpgsql as $$
begin
  new.aggiornata_il = now();
  if new.luogo = 'piazzale' then new.in_giro_il = null; end if;
  if (new.stato, new.luogo, new.in_giro_il is not null) is distinct from (old.stato, old.luogo, old.in_giro_il is not null) then
    new.stato_dal = (timezone('Europe/Rome', now()))::date;
  end if;
  return new;
end $$;

-- ---------- COMMESSE (dati presi da Smartsheet) ----------------------
create table if not exists public.commesse (
  commessa      text primary key,
  cliente       text,
  indirizzo     text,
  aggiornata_il timestamptz not null default now()
);
alter table public.commesse enable row level security;
drop policy if exists commesse_select on public.commesse;
create policy commesse_select on public.commesse for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione', 'produzione'));
drop policy if exists commesse_write on public.commesse;
create policy commesse_write on public.commesse for all to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio')) with check (public.ruolo_corrente() in ('admin', 'ufficio'));

-- la produzione vede solo le cavallette in piazzale con vetri o vuote (nessun dato cliente)
drop policy if exists cavallette_select_produzione on public.cavallette;
create policy cavallette_select_produzione on public.cavallette for select to authenticated
  using (public.ruolo_corrente() = 'produzione' and not restituita and luogo = 'piazzale' and stato in ('piena_vetri', 'vuota'));

-- ---------- REGISTRO MOVIMENTI (non modificabile) --------------------
create table if not exists public.registro (
  progressivo   bigint primary key,            -- numero progressivo senza buchi
  creato_il     timestamptz not null default now(),
  data_mov      date not null default (timezone('Europe/Rome', now()))::date,
  tipo          text not null,
  cavalletta_id uuid,                          -- niente vincolo: il registro resta anche se la cavalletta viene eliminata
  numero        text not null,
  vetreria      text,
  da_luogo      text, da_stato text,
  a_luogo       text, a_stato  text,
  commessa      text, cliente text, ddt text,
  utente        uuid, utente_email text, utente_ruolo text,
  manuale       boolean not null default false, -- true = correzione fatta a mano dall'amministratore
  dettaglio     jsonb not null default '{}'::jsonb,
  hash_prec     text,
  hash          text
);
create index if not exists registro_data on public.registro (data_mov desc, progressivo desc);
create index if not exists registro_numero on public.registro (numero);
create index if not exists registro_cav on public.registro (cavalletta_id);

-- numero progressivo + catena di controllo (ogni riga contiene l'impronta della precedente)
create or replace function public.registro_prepara() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prec text; v_n bigint;
begin
  perform pg_advisory_xact_lock(7243001);
  select progressivo, hash into v_n, v_prec from registro order by progressivo desc limit 1;
  new.progressivo := coalesce(v_n, 0) + 1;
  new.hash_prec := coalesce(v_prec, '');
  new.hash := encode(sha256(convert_to(concat_ws('|', new.hash_prec, new.progressivo, new.creato_il, new.data_mov, new.tipo, new.numero,
      coalesce(new.commessa, ''), coalesce(new.ddt, ''), coalesce(new.a_luogo, ''), coalesce(new.a_stato, ''), coalesce(new.utente::text, ''), new.manuale), 'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists registro_prepara on public.registro;
create trigger registro_prepara before insert on public.registro for each row execute function public.registro_prepara();

create or replace function public.registro_blocca() returns trigger language plpgsql as $$
begin
  raise exception 'Il registro movimenti non è modificabile: per correggere un errore si aggiunge un nuovo movimento.';
end $$;
drop trigger if exists registro_no_modifiche on public.registro;
create trigger registro_no_modifiche before update or delete on public.registro for each row execute function public.registro_blocca();
drop trigger if exists registro_no_svuota on public.registro;
create trigger registro_no_svuota before truncate on public.registro for each statement execute function public.registro_blocca();

alter table public.registro enable row level security;
revoke all on public.registro from anon, authenticated;
grant select on public.registro to authenticated;
drop policy if exists registro_select on public.registro;
create policy registro_select on public.registro for select to authenticated
  using (public.ruolo_corrente() in ('admin', 'ufficio', 'logistica', 'amministrazione'));

-- Ogni cambiamento di una cavalletta finisce nel registro, comunque avvenga (import, schermate, correzioni).
create or replace function public.registra_movimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_orig  text := current_setting('app.origine', true);
  v_mot   text := current_setting('app.motivo', true);
  v_tipi  text[] := '{}';
  v_tipo  text;
  v_man   boolean := false;
  v_cambi jsonb := '{}'::jsonb;
  v_email text;
  v_ruolo text;
  r       public.cavallette;
begin
  select email, ruolo::text into v_email, v_ruolo from profili where id = auth.uid();
  if v_orig = 'sistema' then v_email := 'sistema'; v_ruolo := 'sistema'; end if;

  if tg_op = 'INSERT' then
    v_tipi := array[case when new.vetreria = 'L' then 'carico_interna' else 'carico' end];
    r := new;
  elsif tg_op = 'DELETE' then
    v_tipi := array['eliminazione']; v_man := true; r := old;
  else
    r := new;
    select coalesce(jsonb_object_agg(o.key, jsonb_build_object('da', o.value, 'a', n.value)), '{}'::jsonb) into v_cambi
      from jsonb_each(to_jsonb(old)) o join jsonb_each(to_jsonb(new)) n on n.key = o.key
     where o.value is distinct from n.value and o.key not in ('aggiornata_il', 'stato_dal');
    if v_cambi = '{}'::jsonb then return null; end if;
    if v_orig = 'correzione' then
      v_tipi := array['correzione_manuale']; v_man := true;
    elsif new.restituita and not old.restituita then
      v_tipi := array['restituzione'];
    else
      if old.stato <> 'piena_serramenti' and new.stato = 'piena_serramenti' then v_tipi := array_append(v_tipi, 'imballata'); end if;
      if old.luogo = 'piazzale' and new.luogo = 'cliente' then v_tipi := array_append(v_tipi, 'consegna'); end if;
      if old.in_giro_il is null and new.in_giro_il is not null then v_tipi := array_append(v_tipi, 'giro_programmato'); end if;
      if old.in_giro_il is not null and new.in_giro_il is null and new.luogo = 'cliente' then v_tipi := array_append(v_tipi, 'giro_annullato'); end if;
      if old.luogo = 'cliente' and new.luogo = 'piazzale' then v_tipi := array_append(v_tipi, 'rientro'); end if;
      if old.stato = 'piena_vetri' and new.stato = 'vuota' and new.luogo = old.luogo then v_tipi := array_append(v_tipi, 'non_usata'); end if;
      if cardinality(v_tipi) = 0 then
        v_tipi := array['modifica'];
      end if;
    end if;
  end if;

  foreach v_tipo in array v_tipi loop
    insert into registro (tipo, cavalletta_id, numero, vetreria, da_luogo, da_stato, a_luogo, a_stato, commessa, cliente, ddt,
                          utente, utente_email, utente_ruolo, manuale, dettaglio)
    values (
      v_tipo, r.id, r.numero, r.vetreria,
      case when tg_op = 'INSERT' then null else old.luogo end, case when tg_op = 'INSERT' then null else old.stato end,
      case when tg_op = 'DELETE' then null else r.luogo end, case when tg_op = 'DELETE' then null else r.stato end,
      coalesce(r.commessa, case when tg_op = 'UPDATE' then old.commessa end),
      coalesce(r.cliente, case when tg_op = 'UPDATE' then old.cliente end),
      case when v_tipo in ('carico', 'carico_interna') then r.ddt_arrivo when v_tipo = 'consegna' then r.ddt_consegna else null end,
      case when v_orig = 'sistema' then null else auth.uid() end, v_email, v_ruolo, v_man,
      jsonb_strip_nulls(jsonb_build_object(
        'cambi', case when tg_op = 'UPDATE' and v_tipo in ('correzione_manuale', 'modifica') then v_cambi else null end,
        'motivo', nullif(v_mot, ''),
        'restituzione_id', case when v_tipo = 'restituzione' then r.restituzione_id else null end,
        'contenuto', case when v_tipo = 'carico' then r.contenuto else null end,
        'origine', nullif(v_orig, '')))
    );
  end loop;
  return null;
end $$;
drop trigger if exists cavallette_registro on public.cavallette;
create trigger cavallette_registro after insert or update or delete on public.cavallette
  for each row execute function public.registra_movimento();

-- Storico già esistente (da prima del registro): si ricostruisce una volta sola dagli eventi
do $$ begin
  if not exists (select 1 from public.registro) then
    perform set_config('app.origine', 'migrazione', true);
    insert into public.registro (tipo, data_mov, creato_il, cavalletta_id, numero, vetreria, commessa, cliente, ddt, utente, manuale, dettaglio)
    select case e.tipo when 'arrivata' then 'carico' when 'interna' then 'carico_interna' when 'consegnata' then 'consegna'
                       when 'rientrata' then 'rientro' when 'restituita' then 'restituzione' when 'correzione' then 'correzione_manuale' else e.tipo end,
           (e.creato_il at time zone 'Europe/Rome')::date, e.creato_il, c.id, c.numero, c.vetreria,
           e.dettaglio ->> 'commessa', e.dettaglio ->> 'cliente', e.dettaglio ->> 'ddt', e.utente, e.tipo = 'correzione',
           jsonb_build_object('origine', 'migrazione')
      from public.eventi e join public.cavallette c on c.id = e.cavalletta_id
     order by e.creato_il, e.id;
  end if;
end $$;

-- ---------- GIRO DI RACCOLTA -----------------------------------------
create or replace function public.programma_giro(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_ok int;
begin
  if public.ruolo_corrente() not in ('admin', 'ufficio', 'logistica', 'autista') then raise exception 'Non autorizzato'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) as x;
  if cardinality(v_ids) = 0 then raise exception 'Nessuna cavalletta selezionata'; end if;
  select count(*) into v_ok from cavallette where id = any (v_ids) and not restituita and luogo = 'cliente' and in_giro_il is null;
  if v_ok <> cardinality(v_ids) then raise exception 'Alcune cavallette non sono dal cliente oppure sono già in un giro di raccolta'; end if;
  update cavallette set in_giro_il = now() where id = any (v_ids);
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select id, 'giro_programmato', jsonb_build_object('commessa', commessa, 'cliente', cliente), auth.uid() from cavallette where id = any (v_ids);
  return cardinality(v_ids);
end $$;

create or replace function public.annulla_giro(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_ok int;
begin
  if public.ruolo_corrente() not in ('admin', 'ufficio', 'logistica', 'autista') then raise exception 'Non autorizzato'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) as x;
  if cardinality(v_ids) = 0 then raise exception 'Nessuna cavalletta selezionata'; end if;
  select count(*) into v_ok from cavallette where id = any (v_ids) and luogo = 'cliente' and in_giro_il is not null;
  if v_ok <> cardinality(v_ids) then raise exception 'Alcune cavallette non sono più in un giro di raccolta (forse sono già rientrate)'; end if;
  update cavallette set in_giro_il = null where id = any (v_ids);
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select id, 'giro_annullato', jsonb_build_object('commessa', commessa, 'cliente', cliente), auth.uid() from cavallette where id = any (v_ids);
  return cardinality(v_ids);
end $$;

-- Passate le ore del giro (impostazione "ore_giro", 6) le cavallette tornano vuote in piazzale.
create or replace function public.chiudi_giri_scaduti() returns int
language plpgsql security definer set search_path = public as $$
declare v_ore int; v_ids uuid[]; v_oggi date := (timezone('Europe/Rome', now()))::date;
begin
  if auth.uid() is not null and public.ruolo_corrente() = 'nessuno' then raise exception 'Non autorizzato'; end if;
  select coalesce((select valore::int from impostazioni where chiave = 'ore_giro' and valore ~ '^[0-9]+$'), 6) into v_ore;
  select coalesce(array_agg(id), '{}') into v_ids from cavallette
   where in_giro_il is not null and not restituita and luogo = 'cliente' and in_giro_il <= now() - make_interval(hours => v_ore);
  if cardinality(v_ids) = 0 then return 0; end if;
  perform set_config('app.origine', 'sistema', true);
  update cicli ci set fase = 3, data_rientro = coalesce(ci.data_rientro, v_oggi)
    from cavallette c where c.id = any (v_ids) and ci.cavalletta_id = c.id and ci.commessa = c.commessa and ci.fase < 3;
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select id, 'rientrata', jsonb_build_object('commessa', commessa, 'cliente', cliente, 'fonte', 'giro di raccolta'), null from cavallette where id = any (v_ids);
  update cavallette set stato = 'vuota', luogo = 'piazzale', contenuto = null, commessa = null, cliente = null, indirizzo = null,
         data_uscita = null, data_consegna = null, ddt_consegna = null, in_giro_il = null
   where id = any (v_ids);
  return cardinality(v_ids);
end $$;

-- ---------- CONSEGNA AL CLIENTE (con DDT dell'amministrazione) -------
create or replace function public.consegna_cavallette(p_commessa text, p_ddt text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_ok int; v_oggi date := (timezone('Europe/Rome', now()))::date;
begin
  if public.ruolo_corrente() not in ('admin', 'ufficio', 'logistica', 'autista') then raise exception 'Non autorizzato'; end if;
  if coalesce(trim(p_ddt), '') = '' then raise exception 'Inserisci il DDT dell''amministrazione'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) as x;
  if cardinality(v_ids) = 0 then raise exception 'Nessuna cavalletta selezionata'; end if;
  select count(*) into v_ok from cavallette
   where id = any (v_ids) and not restituita and luogo = 'piazzale' and stato = 'piena_serramenti' and commessa = p_commessa;
  if v_ok <> cardinality(v_ids) then raise exception 'Alcune cavallette non sono più in piazzale con i serramenti di questa commessa'; end if;
  insert into cicli (cavalletta_id, commessa, fase, cliente, indirizzo, data_uscita, data_consegna)
  select id, commessa, 2, cliente, indirizzo, v_oggi, v_oggi from cavallette where id = any (v_ids)
  on conflict (cavalletta_id, commessa) do update
    set fase = greatest(cicli.fase, 2), data_uscita = coalesce(cicli.data_uscita, excluded.data_uscita), data_consegna = coalesce(cicli.data_consegna, excluded.data_consegna);
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select id, 'consegnata', jsonb_build_object('commessa', commessa, 'cliente', cliente, 'ddt', trim(p_ddt), 'fonte', 'consegna'), auth.uid()
    from cavallette where id = any (v_ids);
  update cavallette set luogo = 'cliente', data_consegna = v_oggi, data_uscita = v_oggi, ddt_consegna = trim(p_ddt) where id = any (v_ids);
  return cardinality(v_ids);
end $$;

-- ---------- PRODUZIONE: imballo di una commessa ----------------------
create or replace function public.imballa_cavallette(p_commessa text, p_cliente text, p_indirizzo text, p_numeri text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_num text[]; v_ids uuid[]; v_mancano text[]; v_cl text := nullif(trim(p_cliente), ''); v_ind text := nullif(trim(p_indirizzo), '');
begin
  if public.ruolo_corrente() not in ('admin', 'ufficio', 'produzione') then raise exception 'Non autorizzato'; end if;
  if coalesce(trim(p_commessa), '') = '' then raise exception 'Inserisci il numero di commessa'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_num from unnest(p_numeri) as x;
  if cardinality(v_num) = 0 then raise exception 'Nessuna cavalletta selezionata'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from cavallette
   where numero = any (v_num) and not restituita and luogo = 'piazzale' and stato in ('piena_vetri', 'vuota');
  if cardinality(v_ids) <> cardinality(v_num) then
    select array_agg(n) into v_mancano from unnest(v_num) n
     where n not in (select numero from cavallette where id = any (v_ids));
    raise exception 'Cavallette non trovate o non disponibili in piazzale: %', array_to_string(v_mancano, ', ');
  end if;
  update cavallette set stato = 'piena_serramenti', commessa = trim(p_commessa), cliente = v_cl, indirizzo = v_ind, contenuto = null
   where id = any (v_ids);
  insert into cicli (cavalletta_id, commessa, fase, cliente, indirizzo)
  select id, trim(p_commessa), 1, v_cl, v_ind from cavallette where id = any (v_ids)
  on conflict (cavalletta_id, commessa) do nothing;
  insert into eventi (cavalletta_id, tipo, dettaglio, utente)
  select id, 'imballata', jsonb_build_object('commessa', trim(p_commessa), 'cliente', v_cl, 'fonte', 'produzione'), auth.uid()
    from cavallette where id = any (v_ids);
  if v_cl is not null or v_ind is not null then
    insert into commesse (commessa, cliente, indirizzo) values (trim(p_commessa), v_cl, v_ind)
    on conflict (commessa) do update set cliente = coalesce(excluded.cliente, commesse.cliente),
      indirizzo = coalesce(excluded.indirizzo, commesse.indirizzo), aggiornata_il = now();
  end if;
  return cardinality(v_ids);
end $$;

-- ---------- CORREZIONI MANUALI (finiscono nel registro come tali) ----
create or replace function public.correggi_cavalletta(p_id uuid, p_patch jsonb, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.ruolo_corrente() not in ('admin', 'ufficio', 'amministrazione') then raise exception 'Non autorizzato'; end if;
  perform set_config('app.origine', 'correzione', true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);
  update cavallette c set
    luogo         = case when p_patch ? 'luogo' then p_patch ->> 'luogo' else c.luogo end,
    stato         = case when p_patch ? 'stato' then p_patch ->> 'stato' else c.stato end,
    commessa      = case when p_patch ? 'commessa' then nullif(p_patch ->> 'commessa', '') else c.commessa end,
    cliente       = case when p_patch ? 'cliente' then nullif(p_patch ->> 'cliente', '') else c.cliente end,
    indirizzo     = case when p_patch ? 'indirizzo' then nullif(p_patch ->> 'indirizzo', '') else c.indirizzo end,
    contenuto     = case when p_patch ? 'contenuto' then nullif(p_patch ->> 'contenuto', '') else c.contenuto end,
    note          = case when p_patch ? 'note' then nullif(p_patch ->> 'note', '') else c.note end,
    ddt_consegna  = case when p_patch ? 'ddt_consegna' then nullif(p_patch ->> 'ddt_consegna', '') else c.ddt_consegna end,
    data_consegna = case when p_patch ? 'data_consegna' then nullif(p_patch ->> 'data_consegna', '')::date else c.data_consegna end,
    data_uscita   = case when p_patch ? 'data_uscita' then nullif(p_patch ->> 'data_uscita', '')::date else c.data_uscita end
  where c.id = p_id;
  if not found then raise exception 'Cavalletta non trovata'; end if;
end $$;

create or replace function public.elimina_cavalletta(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.ruolo_corrente() <> 'admin' then raise exception 'Non autorizzato'; end if;
  perform set_config('app.origine', 'correzione', true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);
  delete from cavallette where id = p_id;
  if not found then raise exception 'Cavalletta non trovata'; end if;
end $$;

revoke all on function public.programma_giro(uuid[]), public.annulla_giro(uuid[]), public.chiudi_giri_scaduti(),
  public.consegna_cavallette(text, text, uuid[]), public.imballa_cavallette(text, text, text, text[]),
  public.correggi_cavalletta(uuid, jsonb, text), public.elimina_cavalletta(uuid, text) from public, anon;
grant execute on function public.programma_giro(uuid[]), public.annulla_giro(uuid[]), public.chiudi_giri_scaduti(),
  public.consegna_cavallette(text, text, uuid[]), public.imballa_cavallette(text, text, text, text[]),
  public.correggi_cavalletta(uuid, jsonb, text), public.elimina_cavalletta(uuid, text) to authenticated;

-- Controllo automatico ogni 10 minuti (se l'estensione pg_cron è disponibile).
-- In ogni caso l'app chiude i giri scaduti ogni volta che qualcuno la apre o la aggiorna.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'chiudi-giri-scaduti';
  perform cron.schedule('chiudi-giri-scaduti', '*/10 * * * *', 'select public.chiudi_giri_scaduti()');
exception when others then
  raise notice 'pg_cron non disponibile: i giri vengono chiusi quando qualcuno apre l''app (%)', sqlerrm;
end $$;

-- ---------- PRIMO ADMIN ----------------------------------------------
-- Dopo aver creato il tuo utente in Authentication > Users, esegui (con la tua email):
--   update public.profili set ruolo = 'admin' where email = 'tua@email.it';
