-- Nexora Diary — schéma Supabase
-- À exécuter dans le SQL editor du projet Supabase (bvcnbtbdfkoiefuedxem).
-- Toutes les tables sont préfixées `diary_` pour cohabiter avec le CRM SFS.

-- =========================================================================
-- 1. Extensions
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- 2. Tables
-- =========================================================================

-- Responsables de pôle (mappés 1:1 sur auth.users via l'email)
create table if not exists diary_responsables (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique not null,
  nom text not null,
  role text not null default 'responsable' check (role in ('responsable', 'ops', 'admin')),
  telegram_id text,
  created_at timestamptz not null default now()
);

-- Pôles (chaque responsable en a 2 en général)
create table if not exists diary_poles (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  responsable_id uuid not null references diary_responsables(id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists diary_poles_resp_idx on diary_poles(responsable_id);

-- Clippers rattachés à un pôle
create table if not exists diary_clippers (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  pole_id uuid not null references diary_poles(id) on delete cascade,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists diary_clippers_pole_idx on diary_clippers(pole_id);

-- Fiche du jour (1 par responsable/date)
create table if not exists diary_daily_entries (
  id uuid primary key default gen_random_uuid(),
  responsable_id uuid not null references diary_responsables(id) on delete cascade,
  date date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  reopened_at timestamptz,
  reopened_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (responsable_id, date)
);

create index if not exists diary_daily_resp_date_idx on diary_daily_entries(responsable_id, date desc);

-- Contrôles pôle (les 9 items de la checklist "Tes contrôles du jour")
create table if not exists diary_pole_checks (
  id uuid primary key default gen_random_uuid(),
  daily_entry_id uuid not null references diary_daily_entries(id) on delete cascade,
  pole_id uuid not null references diary_poles(id) on delete cascade,
  posting boolean not null default false,
  cadence boolean not null default false,
  habillage boolean not null default false,
  aucun_compte_banni boolean not null default false,
  contenu_telegram_ok boolean not null default false,
  clics_suivis boolean not null default false,
  reels_performants_remontes boolean not null default false,
  clipper_aide boolean not null default false,
  retour_envoye boolean not null default false,
  retour_ro text default '',
  updated_at timestamptz not null default now(),
  unique (daily_entry_id, pole_id)
);

-- Contrôles clipper (les 6 items "compte bien tenu" + toggles rouges + note)
create table if not exists diary_clipper_checks (
  id uuid primary key default gen_random_uuid(),
  daily_entry_id uuid not null references diary_daily_entries(id) on delete cascade,
  clipper_id uuid not null references diary_clippers(id) on delete cascade,
  habillage_complet boolean not null default false,
  lien_ok boolean not null default false,
  trois_reels_postes boolean not null default false,
  story_postee boolean not null default false,
  voyants_verts boolean not null default false,
  contenu_telegram_dispo boolean not null default false,
  note_libre text default '',
  en_difficulte boolean not null default false,
  compte_banni boolean not null default false,
  contenu_manquant boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (daily_entry_id, clipper_id)
);

-- Reels perfs à remonter (0..N par clipper_check)
create table if not exists diary_reels_perf (
  id uuid primary key default gen_random_uuid(),
  clipper_check_id uuid not null references diary_clipper_checks(id) on delete cascade,
  url text not null,
  note text default '',
  created_at timestamptz not null default now()
);

-- Alertes live (créées automatiquement dès qu'un toggle rouge passe à true)
create table if not exists diary_alerts (
  id uuid primary key default gen_random_uuid(),
  daily_entry_id uuid not null references diary_daily_entries(id) on delete cascade,
  clipper_id uuid references diary_clippers(id) on delete cascade,
  responsable_id uuid not null references diary_responsables(id) on delete cascade,
  type text not null check (type in ('ban', 'contenu_manquant', 'difficulte')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references diary_responsables(id) on delete set null
);

create index if not exists diary_alerts_open_idx on diary_alerts(resolved_at) where resolved_at is null;

-- =========================================================================
-- 3. Triggers
-- =========================================================================

-- updated_at auto
create or replace function diary_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_diary_daily_touch on diary_daily_entries;
create trigger trg_diary_daily_touch before update on diary_daily_entries
  for each row execute function diary_touch_updated_at();

drop trigger if exists trg_diary_pole_touch on diary_pole_checks;
create trigger trg_diary_pole_touch before update on diary_pole_checks
  for each row execute function diary_touch_updated_at();

drop trigger if exists trg_diary_clipper_touch on diary_clipper_checks;
create trigger trg_diary_clipper_touch before update on diary_clipper_checks
  for each row execute function diary_touch_updated_at();

-- Génère/résout les alertes automatiquement en fonction des toggles rouges.
-- SECURITY DEFINER : le trigger insère dans diary_alerts en bypassant la RLS
-- (sinon un responsable ne peut pas déclencher une alerte car aucune policy
-- INSERT n'est ouverte, seulement SELECT).
create or replace function diary_sync_alerts() returns trigger as $$
declare
  resp_id uuid;
begin
  select responsable_id into resp_id from diary_daily_entries where id = new.daily_entry_id;

  -- ban
  if new.compte_banni and (tg_op = 'INSERT' or old.compte_banni is distinct from new.compte_banni) then
    insert into diary_alerts (daily_entry_id, clipper_id, responsable_id, type)
    values (new.daily_entry_id, new.clipper_id, resp_id, 'ban');
  elsif tg_op = 'UPDATE' and old.compte_banni and not new.compte_banni then
    update diary_alerts set resolved_at = now()
      where daily_entry_id = new.daily_entry_id and clipper_id = new.clipper_id
        and type = 'ban' and resolved_at is null;
  end if;

  -- contenu_manquant
  if new.contenu_manquant and (tg_op = 'INSERT' or old.contenu_manquant is distinct from new.contenu_manquant) then
    insert into diary_alerts (daily_entry_id, clipper_id, responsable_id, type)
    values (new.daily_entry_id, new.clipper_id, resp_id, 'contenu_manquant');
  elsif tg_op = 'UPDATE' and old.contenu_manquant and not new.contenu_manquant then
    update diary_alerts set resolved_at = now()
      where daily_entry_id = new.daily_entry_id and clipper_id = new.clipper_id
        and type = 'contenu_manquant' and resolved_at is null;
  end if;

  -- difficulte
  if new.en_difficulte and (tg_op = 'INSERT' or old.en_difficulte is distinct from new.en_difficulte) then
    insert into diary_alerts (daily_entry_id, clipper_id, responsable_id, type)
    values (new.daily_entry_id, new.clipper_id, resp_id, 'difficulte');
  elsif tg_op = 'UPDATE' and old.en_difficulte and not new.en_difficulte then
    update diary_alerts set resolved_at = now()
      where daily_entry_id = new.daily_entry_id and clipper_id = new.clipper_id
        and type = 'difficulte' and resolved_at is null;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_diary_alerts_sync on diary_clipper_checks;
create trigger trg_diary_alerts_sync after insert or update on diary_clipper_checks
  for each row execute function diary_sync_alerts();

-- =========================================================================
-- 4. Helpers RLS
-- =========================================================================

-- SECURITY DEFINER : les helpers sont appelés depuis les RLS policies de
-- diary_responsables → sans DEFINER, chaque appel re-trigger la policy qui
-- appelle le helper → récursion infinie ("stack depth limit exceeded" pour
-- tout user non-admin qui charge sa fiche).
create or replace function diary_current_responsable_id() returns uuid as $$
  select id from diary_responsables where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function diary_is_ops() returns boolean as $$
  select exists (
    select 1 from diary_responsables
    where auth_user_id = auth.uid() and role in ('ops', 'admin')
  );
$$ language sql stable security definer;

-- =========================================================================
-- 5. Row Level Security
-- =========================================================================

alter table diary_responsables enable row level security;
alter table diary_poles enable row level security;
alter table diary_clippers enable row level security;
alter table diary_daily_entries enable row level security;
alter table diary_pole_checks enable row level security;
alter table diary_clipper_checks enable row level security;
alter table diary_reels_perf enable row level security;
alter table diary_alerts enable row level security;

-- responsables : chacun se voit, ops voit tout
drop policy if exists diary_resp_read on diary_responsables;
create policy diary_resp_read on diary_responsables for select
  using (auth_user_id = auth.uid() or diary_is_ops());

drop policy if exists diary_resp_update_self on diary_responsables;
create policy diary_resp_update_self on diary_responsables for update
  using (auth_user_id = auth.uid());

-- poles : responsable voit les siens, ops voit tout
drop policy if exists diary_poles_read on diary_poles;
create policy diary_poles_read on diary_poles for select
  using (responsable_id = diary_current_responsable_id() or diary_is_ops());

-- clippers : idem via jointure pole
drop policy if exists diary_clippers_read on diary_clippers;
create policy diary_clippers_read on diary_clippers for select
  using (
    diary_is_ops() or exists (
      select 1 from diary_poles p
      where p.id = diary_clippers.pole_id
        and p.responsable_id = diary_current_responsable_id()
    )
  );

-- daily_entries : responsable CRUD sur les siennes ; ops read-all + update pour rouvrir
drop policy if exists diary_daily_owner_all on diary_daily_entries;
create policy diary_daily_owner_all on diary_daily_entries for all
  using (responsable_id = diary_current_responsable_id())
  with check (responsable_id = diary_current_responsable_id());

drop policy if exists diary_daily_ops_read on diary_daily_entries;
create policy diary_daily_ops_read on diary_daily_entries for select
  using (diary_is_ops());

drop policy if exists diary_daily_ops_update on diary_daily_entries;
create policy diary_daily_ops_update on diary_daily_entries for update
  using (diary_is_ops());

-- pole_checks
drop policy if exists diary_pole_checks_owner on diary_pole_checks;
create policy diary_pole_checks_owner on diary_pole_checks for all
  using (exists (
    select 1 from diary_daily_entries d
    where d.id = diary_pole_checks.daily_entry_id
      and d.responsable_id = diary_current_responsable_id()
  ))
  with check (exists (
    select 1 from diary_daily_entries d
    where d.id = diary_pole_checks.daily_entry_id
      and d.responsable_id = diary_current_responsable_id()
      and d.status = 'draft'
  ));

drop policy if exists diary_pole_checks_ops_read on diary_pole_checks;
create policy diary_pole_checks_ops_read on diary_pole_checks for select
  using (diary_is_ops());

-- clipper_checks
drop policy if exists diary_clipper_checks_owner on diary_clipper_checks;
create policy diary_clipper_checks_owner on diary_clipper_checks for all
  using (exists (
    select 1 from diary_daily_entries d
    where d.id = diary_clipper_checks.daily_entry_id
      and d.responsable_id = diary_current_responsable_id()
  ))
  with check (exists (
    select 1 from diary_daily_entries d
    where d.id = diary_clipper_checks.daily_entry_id
      and d.responsable_id = diary_current_responsable_id()
      and d.status = 'draft'
  ));

drop policy if exists diary_clipper_checks_ops_read on diary_clipper_checks;
create policy diary_clipper_checks_ops_read on diary_clipper_checks for select
  using (diary_is_ops());

-- reels_perf
drop policy if exists diary_reels_owner on diary_reels_perf;
create policy diary_reels_owner on diary_reels_perf for all
  using (exists (
    select 1 from diary_clipper_checks cc
    join diary_daily_entries d on d.id = cc.daily_entry_id
    where cc.id = diary_reels_perf.clipper_check_id
      and d.responsable_id = diary_current_responsable_id()
  ))
  with check (exists (
    select 1 from diary_clipper_checks cc
    join diary_daily_entries d on d.id = cc.daily_entry_id
    where cc.id = diary_reels_perf.clipper_check_id
      and d.responsable_id = diary_current_responsable_id()
      and d.status = 'draft'
  ));

drop policy if exists diary_reels_ops_read on diary_reels_perf;
create policy diary_reels_ops_read on diary_reels_perf for select
  using (diary_is_ops());

-- alerts
drop policy if exists diary_alerts_owner_read on diary_alerts;
create policy diary_alerts_owner_read on diary_alerts for select
  using (responsable_id = diary_current_responsable_id() or diary_is_ops());

drop policy if exists diary_alerts_ops_update on diary_alerts;
create policy diary_alerts_ops_update on diary_alerts for update
  using (diary_is_ops());

-- =========================================================================
-- 6. Auto-clôture 06h le lendemain
-- =========================================================================
-- À câbler dans pg_cron (extension Supabase) : passe en submitted toute
-- fiche draft dont la date est < today() (donc jour précédent au + tôt à 00:00 UTC).
-- Ajuster le timing dans Supabase → Database → Cron : `0 6 * * *` en heure Paris.

create or replace function diary_auto_submit_yesterday() returns void as $$
  update diary_daily_entries
     set status = 'submitted',
         submitted_at = now(),
         auto_submitted = true
   where status = 'draft'
     and date < (current_date at time zone 'Europe/Paris')::date;
$$ language sql security definer;

-- Exemple d'activation (à faire dans Supabase Studio après avoir activé pg_cron):
--   select cron.schedule('diary-auto-submit', '0 6 * * *', $$select diary_auto_submit_yesterday()$$);

-- =========================================================================
-- 7. Seed template (à adapter, décommenter)
-- =========================================================================

-- Étape 1 — inviter l'utilisateur dans Auth > Users (Supabase Studio),
-- puis récupérer son auth uuid et l'insérer ci-dessous.

-- insert into diary_responsables (auth_user_id, email, nom, role) values
--   ('00000000-0000-0000-0000-000000000000', 'titouan@nexora.fr', 'Titouan', 'admin');

-- insert into diary_poles (nom, responsable_id) values
--   ('Pôle A', (select id from diary_responsables where email='titouan@nexora.fr')),
--   ('Pôle B', (select id from diary_responsables where email='titouan@nexora.fr'));

-- insert into diary_clippers (nom, pole_id) values
--   ('Clipper 1', (select id from diary_poles where nom='Pôle A')),
--   ('Clipper 2', (select id from diary_poles where nom='Pôle A')),
--   ('Clipper 3', (select id from diary_poles where nom='Pôle B'));
