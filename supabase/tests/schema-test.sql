-- Tests du schéma (exécutés en tant que rôle « authenticated », comme l'appli).
\set ON_ERROR_STOP on
create temp table results (name text, ok boolean);
grant all on results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- 1. Envoi des réponses (comme PostgREST : insert ... on conflict do nothing)
insert into public.attempts (id, answered_at, data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', now(), '{"q":"Q1"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', now(), '{"q":"Q2"}')
  on conflict (id) do nothing;
insert into public.attempts (id, answered_at, data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', now(), '{"q":"MODIFIE"}')
  on conflict (id) do nothing;
insert into results select 'réponses : doublon ignoré, original conservé', (select data->>'q' from public.attempts where id='aaaaaaaa-0000-0000-0000-000000000001') = 'Q1';
insert into results select 'réponses : propriétaire renseigné automatiquement', (select count(*) from public.attempts where user_id = '11111111-1111-1111-1111-111111111111') = 2;
insert into results select 'numéros de synchronisation croissants', (select count(distinct row_seq) = 2 and min(row_seq) > 0 from public.attempts);

-- 2. Sessions : la plus récente gagne
insert into public.sessions (id, updated_at, data) values ('bbbbbbbb-0000-0000-0000-000000000001', '2026-11-26 10:00+00', '{"answered":5}')
  on conflict (id) do update set updated_at = excluded.updated_at, data = excluded.data;
insert into public.sessions (id, updated_at, data) values ('bbbbbbbb-0000-0000-0000-000000000001', '2026-11-26 09:00+00', '{"answered":2}')
  on conflict (id) do update set updated_at = excluded.updated_at, data = excluded.data;
insert into results select 'session : version plus ancienne ignorée', (select data->>'answered' from public.sessions) = '5';
insert into public.sessions (id, updated_at, data) values ('bbbbbbbb-0000-0000-0000-000000000001', '2026-11-26 11:00+00', '{"answered":9}')
  on conflict (id) do update set updated_at = excluded.updated_at, data = excluded.data;
insert into results select 'session : version plus récente appliquée et renumérotée', (select data->>'answered' = '9' and row_seq > (select max(row_seq) from public.attempts) from public.sessions);

-- 3. Réglages : clé par utilisateur, la plus récente gagne
insert into public.settings (key, value, updated_at) values ('exam_date', '"2026-12-18"', '2026-11-26 10:00+00')
  on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
insert into public.settings (key, value, updated_at) values ('exam_date', '"2026-12-01"', '2026-11-25 10:00+00')
  on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
insert into results select 'réglage : ancienne valeur ignorée', (select value #>> '{}' from public.settings) = '2026-12-18';

-- 4. Modules
insert into public.content_packs (key, imported_at, data) values ('p1-m01@1', now(), '{"pack":{"id":"p1-m01"}}') on conflict (user_id, key) do nothing;
insert into public.content_packs (key, imported_at, data) values ('p1-m01@1', now(), '{"pack":{"id":"ECRASE"}}') on conflict (user_id, key) do nothing;
insert into results select 'module : jamais écrasé', (select data#>>'{pack,id}' from public.content_packs) = 'p1-m01';

-- 5. Interdictions : modifier ou supprimer une réponse
do $$ begin
  begin update public.attempts set data = '{}'; insert into results values ('réponses : modification interdite', false);
  exception when insufficient_privilege then insert into results values ('réponses : modification interdite', true); end;
  begin delete from public.attempts; insert into results values ('réponses : suppression interdite', false);
  exception when insufficient_privilege then insert into results values ('réponses : suppression interdite', true); end;
  begin delete from public.sessions; insert into results values ('sessions : suppression interdite', false);
  exception when insufficient_privilege then insert into results values ('sessions : suppression interdite', true); end;
end $$;

-- 6. Isolation : un autre compte ne voit rien et ne peut rien écrire au nom du premier
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into results select 'isolation : autre compte ne voit aucune donnée', (select count(*) from public.attempts) + (select count(*) from public.sessions) + (select count(*) from public.settings) + (select count(*) from public.content_packs) = 0;
do $$ begin
  begin insert into public.attempts (id, user_id, answered_at, data) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', now(), '{}');
    insert into results values ('isolation : écriture au nom d''un autre refusée', false);
  exception when insufficient_privilege or check_violation then insert into results values ('isolation : écriture au nom d''un autre refusée', true); end;
end $$;
-- même identifiant de réponse qu'un autre compte : ignoré, sans fuite
insert into public.attempts (id, answered_at, data) values ('aaaaaaaa-0000-0000-0000-000000000001', now(), '{"q":"pirate"}') on conflict (id) do nothing;
insert into results select 'isolation : collision d''identifiant sans effet', (select count(*) from public.attempts) = 0;

-- 7. Sans connexion (anon) : aucun accès
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.attempts; insert into results values ('sans connexion : accès refusé', false);
  exception when insufficient_privilege then insert into results values ('sans connexion : accès refusé', true); end;
end $$;
reset role;
select (case when ok then '✓ ' else '✗ ' end) || name from results;
select case when bool_and(ok) then 'TOUS LES TESTS SQL RÉUSSIS (' || count(*) || ')' else 'ÉCHEC' end from results;
