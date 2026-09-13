-- ============================================================================
-- Nexora Dispos : disponibilites des chatteurs du pole chatting
-- A coller dans Supabase > SQL Editor > Run. Relancable : les fonctions dispos_
-- sont supprimees puis recreees, les tables sont creees si absentes.
-- Ne touche a aucune autre table du projet (tout est prefixe dispos_).
--
-- Modele d'acces :
--   - un chatteur se connecte UNE fois avec son code a 6 chiffres
--     (dispos_connexion) et recoit un jeton aleatoire de 192 bits ;
--   - toutes les autres fonctions s'appellent avec ce jeton ; seul son hash
--     sha256 est stocke ;
--   - l'admin fait pareil avec un code a 8 chiffres (dispos_admin_connexion) ;
--   - changer le code d'un chatteur, le desactiver, ou changer le code admin
--     revoque automatiquement les jetons concernes.
--
-- Garde-fous :
--   - RLS activee sans aucune policy, droits retires : aucun acces direct ;
--   - fonctions SECURITY DEFINER avec search_path fixe ;
--   - connexions refusees dans une transaction en lecture seule (GET PostgREST),
--     avant toute comparaison, pour qu'un echec soit toujours compte ;
--   - tentatives serialisees par cle (verrou consultatif) ;
--   - blocage : 5 echecs en 15 min ou 20 en 24 h pour une cle, 30 echecs en
--     15 min tous chatteurs confondus ; un jeton deja emis n'est jamais bloque ;
--   - echecs comptes uniquement pour un prenom reel : table bornee ;
--   - plafonds 8 creneaux par personne et 5 personnes par creneau, verifies
--     sous verrou ; chatteurs desactives exclus partout.
--
-- Les codes ne sont PAS dans ce fichier. Ils se seedent a part (voir README).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if (select extnamespace::regnamespace::text from pg_extension where extname = 'pgcrypto')
     is distinct from 'extensions' then
    raise exception 'pgcrypto n''est pas dans le schema extensions : adapter extensions.crypt/digest/gen_random_bytes';
  end if;
end $$;

-- repartir de zero sur les fonctions (evite surcharges orphelines et
-- changements de type de retour)
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'dispos\_%'
  loop
    execute 'drop function ' || f || ' cascade';
  end loop;
end $$;

-- ---------------------------------------------------------------- tables ----

create table if not exists public.dispos_chatteurs (
  slug   text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  nom    text not null check (char_length(nom) between 1 and 40),
  pin    text not null check (pin ~ '^[0-9]{6}$'),
  ordre  int  not null default 0,
  actif  boolean not null default true
);

create table if not exists public.dispos_reponses (
  semaine  date not null check (extract(isodow from semaine) = 1),
  slug     text not null references public.dispos_chatteurs(slug) on delete cascade,
  slots    text[] not null default '{}',
  indispos text not null default '' check (char_length(indispos) <= 1000),
  heures   int  not null default 0,
  maj      timestamptz not null default now(),
  primary key (semaine, slug)
);

create table if not exists public.dispos_envois (
  semaine date not null,
  slug    text not null references public.dispos_chatteurs(slug) on delete cascade,
  maj     timestamptz not null default now(),
  primary key (semaine, slug)
);

create table if not exists public.dispos_config (
  cle    text primary key,
  valeur text not null
);

create table if not exists public.dispos_tentatives (
  id  bigserial primary key,
  cle text not null,
  ts  timestamptz not null default now()
);
create index if not exists dispos_tentatives_cle_ts on public.dispos_tentatives (cle, ts);
create index if not exists dispos_tentatives_ts on public.dispos_tentatives (ts);

create table if not exists public.dispos_jetons (
  hash    text primary key,
  slug    text references public.dispos_chatteurs(slug) on delete cascade,
  admin   boolean not null default false,
  cree    timestamptz not null default now(),
  expire  timestamptz not null,
  check ((admin and slug is null) or (not admin and slug is not null))
);
create index if not exists dispos_jetons_slug on public.dispos_jetons (slug);

alter table public.dispos_chatteurs  enable row level security;
alter table public.dispos_reponses   enable row level security;
alter table public.dispos_envois     enable row level security;
alter table public.dispos_config     enable row level security;
alter table public.dispos_tentatives enable row level security;
alter table public.dispos_jetons     enable row level security;

revoke all on table public.dispos_chatteurs  from anon, authenticated;
revoke all on table public.dispos_reponses   from anon, authenticated;
revoke all on table public.dispos_envois     from anon, authenticated;
revoke all on table public.dispos_config     from anon, authenticated;
revoke all on table public.dispos_tentatives from anon, authenticated;
revoke all on table public.dispos_jetons     from anon, authenticated;
revoke all on sequence public.dispos_tentatives_id_seq from anon, authenticated;

-- ------------------------------------------------------ helpers internes ----

create or replace function public.dispos_refuser_lecture_seule()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'dispos : appel en lecture seule refuse' using errcode = '25006';
  end if;
  if coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'prefer', '') ilike '%tx=rollback%' then
    raise exception 'dispos : transaction annulee refusee' using errcode = '25006';
  end if;
end;
$$;

create or replace function public.dispos_hash(p_jeton text)
returns text
language sql immutable security definer
set search_path = public
as $$
  select encode(extensions.digest(p_jeton, 'sha256'), 'hex');
$$;

-- true si la cle doit refuser toute nouvelle tentative
create or replace function public.dispos_bloque(p_cle text, p_global text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    (select count(*) from public.dispos_tentatives
      where cle = p_cle and ts > now() - interval '15 minutes') >= 5
    or (select count(*) from public.dispos_tentatives
      where cle = p_cle and ts > now() - interval '24 hours') >= 20
    or (p_global is not null and (select count(*) from public.dispos_tentatives
      where cle like p_global and ts > now() - interval '15 minutes') >= 30);
$$;

create or replace function public.dispos_echec(p_cle text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.dispos_tentatives (cle) values (p_cle);
  delete from public.dispos_tentatives where ts < now() - interval '2 days';
end;
$$;

create or replace function public.dispos_nouveau_jeton(p_slug text, p_admin boolean)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from public.dispos_jetons where expire < now();
  insert into public.dispos_jetons (hash, slug, admin, expire)
  values (public.dispos_hash(v_tok), case when p_admin then null else p_slug end, p_admin,
          now() + case when p_admin then interval '90 days' else interval '180 days' end);
  -- au plus 5 appareils par chatteur, 5 appareils admin
  delete from public.dispos_jetons
  where hash in (
    select hash from public.dispos_jetons
    where (p_admin and admin) or (not p_admin and slug = p_slug)
    order by cree desc
    offset 5
  );
  return v_tok;
end;
$$;

-- slug du chatteur actif porteur du jeton, sinon null
create or replace function public.dispos_qui(p_jeton text)
returns text
language sql stable security definer
set search_path = public
as $$
  select j.slug
  from public.dispos_jetons j
  join public.dispos_chatteurs c on c.slug = j.slug and c.actif
  where p_jeton ~ '^[0-9a-f]{48}$'
    and j.hash = public.dispos_hash(p_jeton)
    and not j.admin
    and j.expire > now();
$$;

create or replace function public.dispos_est_admin(p_jeton text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(p_jeton ~ '^[0-9a-f]{48}$', false) and exists (
    select 1 from public.dispos_jetons
    where hash = public.dispos_hash(p_jeton) and admin and expire > now());
$$;

-- semaine ouverte aux chatteurs : de la semaine en cours a dans 3 semaines (Paris)
create or replace function public.dispos_semaine_ok(p_semaine date)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_semaine is not null
     and extract(isodow from p_semaine) = 1
     and p_semaine between
         (date_trunc('week', (now() at time zone 'Europe/Paris'))::date)
     and (date_trunc('week', (now() at time zone 'Europe/Paris'))::date + 21);
$$;

-- revocation automatique des jetons
create or replace function public.dispos_revoquer_chatteur()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.pin is distinct from old.pin or new.actif is distinct from old.actif then
    delete from public.dispos_jetons where slug = old.slug;
  end if;
  return new;
end;
$$;
drop trigger if exists dispos_revoquer_chatteur on public.dispos_chatteurs;
create trigger dispos_revoquer_chatteur
after update on public.dispos_chatteurs
for each row execute function public.dispos_revoquer_chatteur();

create or replace function public.dispos_revoquer_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.cle = 'code_admin' and (tg_op = 'INSERT' or new.valeur is distinct from old.valeur) then
    delete from public.dispos_jetons where admin;
  end if;
  return new;
end;
$$;
drop trigger if exists dispos_revoquer_admin on public.dispos_config;
create trigger dispos_revoquer_admin
after insert or update on public.dispos_config
for each row execute function public.dispos_revoquer_admin();

-- ------------------------------------------------------ API publique -------

create or replace function public.dispos_liste()
returns json
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    json_agg(json_build_object('nom', nom, 'slug', slug) order by ordre, nom),
    '[]'::json)
  from public.dispos_chatteurs
  where actif;
$$;

create or replace function public.dispos_etat(p_semaine date)
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'compte', coalesce((
      select json_object_agg(t.s, t.n)
      from (
        select s, count(*) as n
        from public.dispos_reponses r
        join public.dispos_chatteurs c on c.slug = r.slug and c.actif
        cross join lateral unnest(r.slots) as s
        where r.semaine = p_semaine
        group by s
      ) t
    ), '{}'::json),
    'repondu', coalesce((
      select json_agg(r.slug order by r.slug)
      from public.dispos_reponses r
      join public.dispos_chatteurs c on c.slug = r.slug and c.actif
      where r.semaine = p_semaine
    ), '[]'::json),
    'ouverte', public.dispos_semaine_ok(p_semaine)
  );
$$;

-- code du chatteur -> jeton
create or replace function public.dispos_connexion(p_slug text, p_pin text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_cle text;
  v_pin text;
begin
  perform public.dispos_refuser_lecture_seule();

  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,40}$'
     or p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return json_build_object('ok', false, 'erreur', 'faux');
  end if;

  select pin into v_pin from public.dispos_chatteurs where slug = p_slug and actif;
  if v_pin is null then
    return json_build_object('ok', false, 'erreur', 'faux');
  end if;

  v_cle := 'pin:' || p_slug;
  perform pg_advisory_xact_lock(1, hashtext(v_cle));

  if public.dispos_bloque(v_cle, 'pin:%') then
    return json_build_object('ok', false, 'erreur', 'bloque');
  end if;

  if v_pin = p_pin then
    delete from public.dispos_tentatives where cle = v_cle;
    return json_build_object('ok', true, 'jeton', public.dispos_nouveau_jeton(p_slug, false));
  end if;

  perform public.dispos_echec(v_cle);
  return json_build_object('ok', false, 'erreur', 'faux');
end;
$$;

-- jeton -> dispos deja enregistrees
create or replace function public.dispos_charger(p_semaine date, p_jeton text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_slug text;
  v_slots text[];
  v_ind text;
begin
  v_slug := public.dispos_qui(p_jeton);
  if v_slug is null then
    return json_build_object('ok', false, 'erreur', 'jeton');
  end if;
  select r.slots, r.indispos into v_slots, v_ind
  from public.dispos_reponses r
  where r.semaine = p_semaine and r.slug = v_slug;
  return json_build_object(
    'ok', true,
    'slug', v_slug,
    'slots', coalesce(to_json(v_slots), '[]'::json),
    'indispos', coalesce(v_ind, ''),
    'existe', v_slots is not null,
    'ouverte', public.dispos_semaine_ok(p_semaine)
  );
end;
$$;

create or replace function public.dispos_enregistrer(
  p_semaine date, p_jeton text, p_slots text[], p_indispos text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  c_maxh constant int := 8;
  c_maxp constant int := 5;
  v_slug text;
  v_clean text[];
  v_bad int;
  v_n int;
  v_s text;
  v_autres int;
  v_plein text[] := '{}';
begin
  v_slug := public.dispos_qui(p_jeton);
  if v_slug is null then
    return json_build_object('ok', false, 'erreur', 'jeton');
  end if;

  if not public.dispos_semaine_ok(p_semaine) then
    return json_build_object('ok', false, 'erreur', 'semaine');
  end if;

  if coalesce(array_length(p_slots, 1), 0) > 28 then
    return json_build_object('ok', false, 'erreur', 'creneau_invalide');
  end if;

  select count(*) into v_bad
  from unnest(coalesce(p_slots, '{}'::text[])) as x
  where x is null or x !~ '^[0-6]-(nuit|matin|aprem|soir)$';
  if v_bad > 0 then
    return json_build_object('ok', false, 'erreur', 'creneau_invalide');
  end if;

  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_clean
  from unnest(coalesce(p_slots, '{}'::text[])) as x;
  v_n := coalesce(array_length(v_clean, 1), 0);

  if v_n > c_maxh then
    return json_build_object('ok', false, 'erreur', 'trop_de_creneaux', 'max', c_maxh);
  end if;
  if char_length(coalesce(p_indispos, '')) > 1000 then
    return json_build_object('ok', false, 'erreur', 'indispos_trop_long');
  end if;

  -- une ecriture a la fois par semaine : empeche deux chatteurs de prendre
  -- la derniere place d'un creneau au meme instant
  perform pg_advisory_xact_lock(2, hashtext(p_semaine::text));

  foreach v_s in array v_clean loop
    select count(*) into v_autres
    from public.dispos_reponses r
    join public.dispos_chatteurs c on c.slug = r.slug and c.actif
    where r.semaine = p_semaine and r.slug <> v_slug and v_s = any(r.slots);
    if v_autres >= c_maxp then
      v_plein := v_plein || v_s;
    end if;
  end loop;
  if coalesce(array_length(v_plein, 1), 0) > 0 then
    return json_build_object('ok', false, 'erreur', 'complet', 'creneaux', to_json(v_plein));
  end if;

  insert into public.dispos_reponses (semaine, slug, slots, indispos, heures, maj)
  values (p_semaine, v_slug, v_clean, coalesce(p_indispos, ''), v_n * 6, now())
  on conflict (semaine, slug) do update
    set slots = excluded.slots,
        indispos = excluded.indispos,
        heures = excluded.heures,
        maj = now();

  return json_build_object('ok', true, 'heures', v_n * 6);
end;
$$;

create or replace function public.dispos_deconnexion(p_jeton text)
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  if p_jeton ~ '^[0-9a-f]{48}$' then
    delete from public.dispos_jetons where hash = public.dispos_hash(p_jeton);
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------ API admin ----

create or replace function public.dispos_admin_connexion(p_code text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  perform public.dispos_refuser_lecture_seule();

  if p_code is null or p_code !~ '^[0-9]{8}$' then
    return json_build_object('ok', false, 'erreur', 'faux');
  end if;

  perform pg_advisory_xact_lock(1, hashtext('admin'));

  if public.dispos_bloque('admin', null) then
    return json_build_object('ok', false, 'erreur', 'bloque');
  end if;

  select valeur into v_hash from public.dispos_config where cle = 'code_admin';
  if v_hash is not null and v_hash = extensions.crypt(p_code, v_hash) then
    delete from public.dispos_tentatives where cle = 'admin';
    return json_build_object('ok', true, 'jeton', public.dispos_nouveau_jeton(null, true));
  end if;

  perform public.dispos_echec('admin');
  return json_build_object('ok', false, 'erreur', 'faux');
end;
$$;

create or replace function public.dispos_admin(p_jeton text, p_semaine date)
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.dispos_est_admin(p_jeton) then
    return json_build_object('ok', false, 'erreur', 'jeton');
  end if;
  return json_build_object(
    'ok', true,
    'semaine', p_semaine,
    'chatteurs', coalesce((
      select json_agg(json_build_object('nom', c.nom, 'slug', c.slug, 'pin', c.pin)
                      order by c.ordre, c.nom)
      from public.dispos_chatteurs c
      where c.actif
    ), '[]'::json),
    'reponses', coalesce((
      select json_agg(json_build_object(
               'slug', r.slug, 'nom', c.nom, 'slots', r.slots,
               'indispos', r.indispos, 'heures', r.heures, 'maj', r.maj)
             order by r.heures desc, c.nom)
      from public.dispos_reponses r
      join public.dispos_chatteurs c on c.slug = r.slug and c.actif
      where r.semaine = p_semaine
    ), '[]'::json),
    'envois', coalesce((
      select json_agg(e.slug order by e.slug)
      from public.dispos_envois e
      join public.dispos_chatteurs c on c.slug = e.slug and c.actif
      where e.semaine = p_semaine
    ), '[]'::json)
  );
end;
$$;

create or replace function public.dispos_envoi(p_jeton text, p_semaine date, p_slug text, p_fait boolean)
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.dispos_est_admin(p_jeton) then
    return json_build_object('ok', false, 'erreur', 'jeton');
  end if;
  if p_semaine is null or not exists (select 1 from public.dispos_chatteurs where slug = p_slug) then
    return json_build_object('ok', false, 'erreur', 'inconnu');
  end if;
  if p_fait then
    insert into public.dispos_envois (semaine, slug) values (p_semaine, p_slug)
    on conflict (semaine, slug) do update set maj = now();
  else
    delete from public.dispos_envois where semaine = p_semaine and slug = p_slug;
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.dispos_envois_reset(p_jeton text, p_semaine date)
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.dispos_est_admin(p_jeton) then
    return json_build_object('ok', false, 'erreur', 'jeton');
  end if;
  delete from public.dispos_envois where semaine = p_semaine;
  return json_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------- droits ------
-- Supabase accorde par defaut EXECUTE a anon sur toute fonction creee dans
-- public : on retire tout, puis on n'ouvre que l'API.

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'dispos\_%'
  loop
    execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

grant execute on function public.dispos_liste()                                    to anon, authenticated;
grant execute on function public.dispos_etat(date)                                 to anon, authenticated;
grant execute on function public.dispos_connexion(text, text)                      to anon, authenticated;
grant execute on function public.dispos_charger(date, text)                        to anon, authenticated;
grant execute on function public.dispos_enregistrer(date, text, text[], text)      to anon, authenticated;
grant execute on function public.dispos_deconnexion(text)                          to anon, authenticated;
grant execute on function public.dispos_admin_connexion(text)                      to anon, authenticated;
grant execute on function public.dispos_admin(text, date)                          to anon, authenticated;
grant execute on function public.dispos_envoi(text, date, text, boolean)           to anon, authenticated;
grant execute on function public.dispos_envois_reset(text, date)                   to anon, authenticated;

notify pgrst, 'reload schema';
