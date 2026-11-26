-- ============================================================================
-- Psycho 304 — schéma Supabase (lot 1 bis : compte personnel + synchronisation)
-- À exécuter UNE fois : Supabase → SQL Editor → New query → coller → Run.
-- Ré-exécutable sans risque (aucune donnée n'est supprimée).
-- ============================================================================

-- Séquence commune : chaque écriture reçoit un numéro croissant, utilisé par
-- l'appli pour ne télécharger que les nouveautés.
create sequence if not exists public.psycho304_sync_seq;

create or replace function public.psycho304_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.row_seq := nextval('public.psycho304_sync_seq');
  return new;
end $$;

-- « La version la plus récente gagne » : une mise à jour plus ancienne (ou identique)
-- que la ligne existante est ignorée (aucun écrasement par un appareil en retard).
create or replace function public.psycho304_keep_newest() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  new.row_seq := nextval('public.psycho304_sync_seq');
  return new;
end $$;

-- Réponses : journal en ajout seul ----------------------------------------------
create table if not exists public.attempts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  answered_at timestamptz not null,
  data jsonb not null,
  row_seq bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_seq on public.attempts (user_id, row_seq);

-- Sessions d'entraînement --------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_at timestamptz not null,
  data jsonb not null,
  row_seq bigint not null default 0
);
create index if not exists sessions_user_seq on public.sessions (user_id, row_seq);

-- Réglages (date d'examen, barème…) ---------------------------------------------
create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null,
  row_seq bigint not null default 0,
  primary key (user_id, key)
);
create index if not exists settings_user_seq on public.settings (user_id, row_seq);

-- Modules importés (paquets JSON bruts) -----------------------------------------
create table if not exists public.content_packs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,                    -- "<pack.id>@<pack.version>"
  imported_at timestamptz not null,
  data jsonb not null,
  row_seq bigint not null default 0,
  primary key (user_id, key)
);
create index if not exists content_packs_user_seq on public.content_packs (user_id, row_seq);

-- Déclencheurs ---------------------------------------------------------------------
drop trigger if exists attempts_stamp on public.attempts;
create trigger attempts_stamp before insert on public.attempts
  for each row execute function public.psycho304_stamp();

drop trigger if exists content_packs_stamp on public.content_packs;
create trigger content_packs_stamp before insert on public.content_packs
  for each row execute function public.psycho304_stamp();

drop trigger if exists sessions_stamp on public.sessions;
create trigger sessions_stamp before insert on public.sessions
  for each row execute function public.psycho304_stamp();
drop trigger if exists sessions_newest on public.sessions;
create trigger sessions_newest before update on public.sessions
  for each row execute function public.psycho304_keep_newest();

drop trigger if exists settings_stamp on public.settings;
create trigger settings_stamp before insert on public.settings
  for each row execute function public.psycho304_stamp();
drop trigger if exists settings_newest on public.settings;
create trigger settings_newest before update on public.settings
  for each row execute function public.psycho304_keep_newest();

-- Sécurité : chaque utilisateur ne voit et ne modifie que ses propres lignes ------
alter table public.attempts enable row level security;
alter table public.sessions enable row level security;
alter table public.settings enable row level security;
alter table public.content_packs enable row level security;

drop policy if exists "psycho304 own rows" on public.attempts;
create policy "psycho304 own rows" on public.attempts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "psycho304 own rows" on public.sessions;
create policy "psycho304 own rows" on public.sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "psycho304 own rows" on public.settings;
create policy "psycho304 own rows" on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "psycho304 own rows" on public.content_packs;
create policy "psycho304 own rows" on public.content_packs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Les réponses et les modules ne sont jamais modifiés ni supprimés par l'appli.
revoke update, delete on public.attempts from authenticated, anon;
revoke update, delete on public.content_packs from authenticated, anon;
revoke delete on public.sessions, public.settings from authenticated, anon;
grant select, insert on public.attempts, public.content_packs to authenticated;
grant select, insert, update on public.sessions, public.settings to authenticated;
grant usage on sequence public.psycho304_sync_seq to authenticated;
revoke all on public.attempts, public.sessions, public.settings, public.content_packs from anon;
