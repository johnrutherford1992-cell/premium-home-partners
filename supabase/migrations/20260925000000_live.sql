-- Premium Home Partners: live multi-user backend.
-- Implements docs/LIVE_ARCHITECTURE.md §4 on top of 20260924000000_init.sql:
-- new columns, service categories, bid bookkeeping triggers, select-only RLS
-- for clients, storage policies, realtime publication, the RPC catalog and the
-- demo seed (seed_demo / ensure_demo_users).
--
-- Conventions
--   * Every client write goes through a `security definer` RPC in `public`
--     (search_path pinned to public, executable by `authenticated` only).
--   * RPC errors meant for people use errcode P0001 so the app shows them as-is.
--   * RLS helpers and trigger functions live in the `private` schema, which the
--     Data API does not expose. They are security definer so policies never
--     recurse (profiles -> visits -> homes -> visits ...).
--
-- Supabase advisors (checked on the hosted project after applying this file):
--   * Lint 0029 "authenticated can execute SECURITY DEFINER function" is expected
--     for the 15 RPCs in section 10: they are the only client write path and
--     each one checks the caller's role and ownership itself. anon can execute
--     none of them, and seed_demo / ensure_demo_users / auth_role /
--     handle_new_user are revoked from anon and authenticated.
--   * Lint 0006 "multiple permissive policies" is accepted: policies stay one
--     per audience (owner_*, tech_*, office_*) as named in LIVE_ARCHITECTURE §4,
--     and every helper call is wrapped in (select ...) so it runs once per query.
--   * No function_search_path_mutable, auth_rls_initplan, unindexed_foreign_keys
--     or rls_disabled findings, so no follow-up migration was needed.

-- ---------------------------------------------------------------------------
-- 0. Private schema
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists email text,
  add column if not exists title text,
  add column if not exists vehicle text;

alter table homes
  add column if not exists notes text;

alter table appliance_models
  add column if not exists name text,
  add column if not exists note text;

-- What the homeowner entered or scanned, kept even when the model is not in the cache.
alter table appliances
  add column if not exists brand text,
  add column if not exists name text,
  add column if not exists model text;

alter table plan_builds
  add column if not exists step text,
  add column if not exists summary jsonb,
  add column if not exists error text,
  add column if not exists updated_at timestamptz default now();

alter table visits
  add column if not exists offered_slots jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table quote_requests
  add column if not exists area text,
  add column if not exists home_sqft int,
  add column if not exists base numeric(10, 2),
  add column if not exists bid_count int not null default 0,
  add column if not exists coordination_fee numeric(10, 2),
  add column if not exists booked_at timestamptz;

alter table bids
  add column if not exists vendor_name text,
  add column if not exists vendor_rating numeric(2, 1);

-- ---------------------------------------------------------------------------
-- 2. Service categories (add-on brokerage)
-- ---------------------------------------------------------------------------

create table if not exists service_categories (
  id text primary key,
  name text not null,
  sub text,
  base numeric
);

insert into service_categories (id, name, sub, base) values
  ('lawn',   'Lawn care',        'Weekly mow, edge and blow',     65),
  ('land',   'Landscaping',      'Beds, mulch, seasonal color',   1400),
  ('win',    'Window washing',   'Inside and out, screens',       420),
  ('press',  'Pressure washing', 'Driveway, walks, siding',       340),
  ('lights', 'Holiday lights',   'Roofline install and removal',  1150),
  ('tree',   'Tree service',     'Trim, removal, stump grind',    780)
on conflict (id) do update set name = excluded.name, sub = excluded.sub, base = excluded.base;

-- One active (open or booked) request per home and category.
create unique index if not exists quote_requests_one_active
  on quote_requests (home_id, category) where status in ('open', 'booked');

-- ---------------------------------------------------------------------------
-- 3. Indexes for foreign keys and RLS lookups
-- ---------------------------------------------------------------------------

create index if not exists homes_owner_id_idx on homes (owner_id);
create index if not exists appliances_home_id_idx on appliances (home_id);
create index if not exists appliances_model_id_idx on appliances (model_id);
create index if not exists appliance_models_norm_model_idx on appliance_models (upper(regexp_replace(model, '\s+', '', 'g')));
create index if not exists model_tasks_model_id_idx on model_tasks (model_id);
create index if not exists part_prices_part_id_idx on part_prices (part_id);
create index if not exists plan_builds_home_id_idx on plan_builds (home_id);
create index if not exists plans_home_id_idx on plans (home_id);
create index if not exists visits_home_id_idx on visits (home_id);
create index if not exists visits_plan_id_idx on visits (plan_id);
create index if not exists visits_tech_id_idx on visits (tech_id);
create index if not exists visits_window_start_idx on visits (window_start);
create index if not exists visit_tasks_visit_id_idx on visit_tasks (visit_id);
create index if not exists visit_tasks_appliance_id_idx on visit_tasks (appliance_id);
create index if not exists visit_tasks_part_id_idx on visit_tasks (part_id);
create index if not exists visit_photos_visit_task_id_idx on visit_photos (visit_task_id);
create index if not exists notices_visit_id_idx on notices (visit_id);
create index if not exists vendors_profile_id_idx on vendors (profile_id);
create index if not exists quote_requests_home_id_idx on quote_requests (home_id);
create index if not exists bids_vendor_id_idx on bids (vendor_id);

-- ---------------------------------------------------------------------------
-- 4. Small pure helpers
-- ---------------------------------------------------------------------------

-- Today's date in Chicago.
create or replace function private.chicago_today() returns date
  language sql stable set search_path = public
  as $$ select (now() at time zone 'America/Chicago')::date $$;

-- A wall-clock time on a Chicago date, as a timestamptz.
create or replace function private.chicago_at(p_day date, p_time time) returns timestamptz
  language sql stable set search_path = public
  as $$ select (p_day + p_time) at time zone 'America/Chicago' $$;

-- ISO 8601 in UTC, used inside offered_slots so the JSON never depends on the session time zone.
create or replace function private.iso(p_ts timestamptz) returns text
  language sql immutable set search_path = public
  as $$ select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

create or replace function private.slot(p_day date, p_start time, p_end time) returns jsonb
  language sql stable set search_path = public
  as $$ select jsonb_build_object('start', private.iso(private.chicago_at(p_day, p_start)),
                                  'end',   private.iso(private.chicago_at(p_day, p_end))) $$;

-- The first Monday–Friday on or after a date.
create or replace function private.weekday_on_or_after(p_day date) returns date
  language sql immutable set search_path = public
  as $$ select p_day + case extract(isodow from p_day)::int when 6 then 2 when 7 then 1 else 0 end $$;

-- The first Monday–Friday strictly after a date.
create or replace function private.next_weekday(p_day date) returns date
  language sql immutable set search_path = public
  as $$ select private.weekday_on_or_after(p_day + 1) $$;

-- p_day moved forward by n weekdays.
create or replace function private.add_weekdays(p_day date, p_n int) returns date
  language plpgsql immutable set search_path = public
  as $$
declare d date := p_day;
begin
  for i in 1 .. greatest(coalesce(p_n, 0), 0) loop
    d := private.next_weekday(d);
  end loop;
  return d;
end $$;

-- Case- and space-insensitive model number.
create or replace function private.norm_model(p_model text) returns text
  language sql immutable set search_path = public
  as $$ select upper(regexp_replace(coalesce(p_model, ''), '\s+', '', 'g')) $$;

-- "12 Linden Court, Dallas, TX 75205" -> "12 Linden Court · Dallas 75205". Never includes a name.
create or replace function private.home_area(p_address text) returns text
  language sql immutable set search_path = public
  as $$
  with p as (
    select array(select btrim(x) from unnest(string_to_array(coalesce(p_address, ''), ',')) x where btrim(x) <> '') as a
  )
  select case
    when cardinality(a) = 0 then null
    when cardinality(a) = 1 then a[1]
    else a[1] || ' · ' || btrim(concat_ws(' ',
      case when cardinality(a) >= 3 then a[2] end,
      coalesce(substring(a[cardinality(a)] from '\d{5}'), case when cardinality(a) = 2 then a[2] end)))
  end
  from p
$$;

-- Part used by a task (reference parts seeded by seed_demo).
create or replace function private.task_part_id(p_task_key text) returns uuid
  language sql stable security definer set search_path = public
  as $$
  select id from parts where part_number = case p_task_key
    when 'hvac' then '16x25x4-MERV11'
    when 'fridge' then 'LT1000P'
    when 'ice' then 'ICE-SANI'
    when 'dish' then 'AFFRESH-DW'
    when 'wh' then 'WH-DRAIN'
    when 'smoke' then '9V'
  end
$$;

-- The home's appliance whose cached model has this task, if any.
create or replace function private.home_appliance_for(p_home uuid, p_task_key text) returns uuid
  language sql stable security definer set search_path = public
  as $$
  select a.id
  from appliances a
  join model_tasks mt on mt.model_id = a.model_id
  where a.home_id = p_home and mt.task_key = p_task_key
  order by a.id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS helpers (security definer: they read past RLS so policies never recurse)
-- ---------------------------------------------------------------------------

create or replace function private.my_role() returns user_role
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() $$;

create or replace function private.owned_home_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select id from homes where owner_id = auth.uid() $$;

create or replace function private.owned_visit_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select v.id from visits v join homes h on h.id = v.home_id where h.owner_id = auth.uid() $$;

create or replace function private.owned_task_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$
  select t.id from visit_tasks t join visits v on v.id = t.visit_id join homes h on h.id = v.home_id
  where h.owner_id = auth.uid()
$$;

create or replace function private.owned_request_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select q.id from quote_requests q join homes h on h.id = q.home_id where h.owner_id = auth.uid() $$;

create or replace function private.tech_visit_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select id from visits where tech_id = auth.uid() $$;

create or replace function private.tech_task_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select t.id from visit_tasks t join visits v on v.id = t.visit_id where v.tech_id = auth.uid() $$;

create or replace function private.tech_home_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select distinct home_id from visits where tech_id = auth.uid() and home_id is not null $$;

-- Techs assigned to visits at the caller's homes.
create or replace function private.visit_tech_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$
  select distinct v.tech_id from visits v join homes h on h.id = v.home_id
  where h.owner_id = auth.uid() and v.tech_id is not null
$$;

-- Owners of the homes on the caller's (tech) visits.
create or replace function private.visit_owner_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select distinct h.owner_id from visits v join homes h on h.id = v.home_id where v.tech_id = auth.uid() $$;

create or replace function private.vendor_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select id from vendors where profile_id = auth.uid() $$;

-- Categories the caller serves as a vetted vendor.
create or replace function private.vendor_categories() returns text[]
  language sql stable security definer set search_path = public
  as $$
  select coalesce(array_agg(distinct c), '{}')
  from vendors v cross join lateral unnest(v.categories) c
  where v.profile_id = auth.uid() and v.vetted
$$;

-- Storage: first path segment is the visit id.
create or replace function private.can_upload_visit_photo(p_folder text) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from visits where id::text = p_folder and tech_id = auth.uid()) $$;

create or replace function private.can_read_visit_photo(p_folder text) returns boolean
  language sql stable security definer set search_path = public
  as $$
  select exists (
    select 1 from visits v left join homes h on h.id = v.home_id
    where v.id::text = p_folder and (v.tech_id = auth.uid() or h.owner_id = auth.uid())
  ) or coalesce((select role = 'office' from profiles where id = auth.uid()), false)
$$;

-- Role guard used by every RPC. Returns the caller's role.
create or replace function private.require_role(variadic p_roles user_role[]) returns user_role
  language plpgsql stable security definer set search_path = public
  as $$
declare r user_role;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = 'P0001';
  end if;
  select role into r from profiles where id = auth.uid();
  if r is null or not (r = any (p_roles)) then
    raise exception 'You don''t have access to that.' using errcode = 'P0001';
  end if;
  return r;
end $$;

-- The homeowner's "current visit": earliest by window_start that is not done,
-- or is done and ended at/after the start of today in Chicago.
create or replace function private.current_visit_id(p_home uuid) returns uuid
  language sql stable security definer set search_path = public
  as $$
  select id from visits
  where home_id = p_home
    and status <> 'canceled'
    and (status <> 'done' or window_end >= private.chicago_at(private.chicago_today(), time '00:00'))
  order by window_start
  limit 1
$$;

create or replace function private.default_tech() returns uuid
  language sql stable security definer set search_path = public
  as $$
  select id from profiles where role = 'tech'
  order by (id = 'a0000000-0000-4000-8000-000000000002'::uuid) desc, created_at, id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------

-- bids.vendor_name / vendor_rating are copied from vendors, so homeowners never need to read vendors.
create or replace function private.bids_copy_vendor() returns trigger
  language plpgsql security definer set search_path = public
  as $$
begin
  select v.company, v.rating into new.vendor_name, new.vendor_rating from vendors v where v.id = new.vendor_id;
  return new;
end $$;

drop trigger if exists bids_copy_vendor on bids;
create trigger bids_copy_vendor before insert on bids
  for each row execute function private.bids_copy_vendor();

-- quote_requests.bid_count follows bids inserts and deletes.
create or replace function private.bids_sync_count() returns trigger
  language plpgsql security definer set search_path = public
  as $$
declare r uuid;
begin
  for r in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.request_id end,
      case when tg_op <> 'DELETE' then new.request_id end]) x
    where x is not null
  loop
    update quote_requests q set bid_count = (select count(*) from bids b where b.request_id = r) where q.id = r;
  end loop;
  return null;
end $$;

drop trigger if exists bids_sync_count on bids;
create trigger bids_sync_count after insert or delete or update of request_id on bids
  for each row execute function private.bids_sync_count();

create or replace function private.touch_updated_at() returns trigger
  language plpgsql set search_path = public
  as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists plan_builds_touch on plan_builds;
create trigger plan_builds_touch before update on plan_builds
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Row-level security: clients read, RPCs write
-- ---------------------------------------------------------------------------

alter table service_categories enable row level security;

-- Drop every policy from the init migration; the full set is recreated below.
drop policy if exists self_profile on profiles;
drop policy if exists self_profile_update on profiles;
drop policy if exists owner_sees_tech on profiles;
drop policy if exists tech_sees_clients on profiles;
drop policy if exists owner_homes on homes;
drop policy if exists staff_homes on homes;
drop policy if exists office_homes on homes;
drop policy if exists tech_homes on homes;
drop policy if exists owner_appliances on appliances;
drop policy if exists staff_appliances on appliances;
drop policy if exists office_appliances on appliances;
drop policy if exists tech_appliances on appliances;
drop policy if exists read_models on appliance_models;
drop policy if exists read_model_tasks on model_tasks;
drop policy if exists read_parts on parts;
drop policy if exists read_part_prices on part_prices;
drop policy if exists read_task_defaults on task_defaults;
drop policy if exists office_task_defaults on task_defaults;
drop policy if exists office_task_defaults_insert on task_defaults;
drop policy if exists office_task_defaults_update on task_defaults;
drop policy if exists office_task_defaults_delete on task_defaults;
drop policy if exists read_pricing on pricing_settings;
drop policy if exists office_pricing on pricing_settings;
drop policy if exists owner_builds on plan_builds;
drop policy if exists office_builds on plan_builds;
drop policy if exists owner_plans on plans;
drop policy if exists office_plans on plans;
drop policy if exists tech_plans on plans;
drop policy if exists owner_visits on visits;
drop policy if exists owner_confirm on visits;
drop policy if exists tech_visits on visits;
drop policy if exists office_visits on visits;
drop policy if exists owner_visit_tasks on visit_tasks;
drop policy if exists tech_visit_tasks on visit_tasks;
drop policy if exists office_visit_tasks on visit_tasks;
drop policy if exists owner_photos on visit_photos;
drop policy if exists tech_photos on visit_photos;
drop policy if exists office_photos on visit_photos;
drop policy if exists owner_reports on reports;
drop policy if exists staff_reports on reports;
drop policy if exists office_reports on reports;
drop policy if exists tech_reports on reports;
drop policy if exists office_notices on notices;
drop policy if exists owner_notices on notices;
drop policy if exists tech_notices on notices;
drop policy if exists self_vendor on vendors;
drop policy if exists office_vendors on vendors;
drop policy if exists owner_requests on quote_requests;
drop policy if exists vendor_requests on quote_requests;
drop policy if exists office_requests on quote_requests;
drop policy if exists vendor_bids on bids;
drop policy if exists owner_bids on bids;
drop policy if exists office_bids on bids;
drop policy if exists read_service_categories on service_categories;

-- profiles: yourself; office reads everyone; homeowner reads their visits' techs;
-- tech reads their visits' homeowners. Vendors read no one else.
create policy self_profile on profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.my_role()) = 'office');
create policy owner_sees_tech on profiles for select to authenticated
  using (id in (select private.visit_tech_ids()));
create policy tech_sees_clients on profiles for select to authenticated
  using (id in (select private.visit_owner_ids()));

-- homes / appliances: owner, office, and the tech assigned to a visit there. Never vendors.
create policy owner_homes on homes for select to authenticated
  using (owner_id = (select auth.uid()));
create policy office_homes on homes for select to authenticated
  using ((select private.my_role()) = 'office');
create policy tech_homes on homes for select to authenticated
  using (id in (select private.tech_home_ids()));

create policy owner_appliances on appliances for select to authenticated
  using (home_id in (select private.owned_home_ids()));
create policy office_appliances on appliances for select to authenticated
  using ((select private.my_role()) = 'office');
create policy tech_appliances on appliances for select to authenticated
  using (home_id in (select private.tech_home_ids()));

-- Reference data: any signed-in user reads; written by seed_demo and edge functions (service role).
create policy read_models on appliance_models for select to authenticated using (true);
create policy read_model_tasks on model_tasks for select to authenticated using (true);
create policy read_parts on parts for select to authenticated using (true);
create policy read_part_prices on part_prices for select to authenticated using (true);
create policy read_service_categories on service_categories for select to authenticated using (true);

-- Pricing tables: everyone reads, office writes directly.
create policy read_task_defaults on task_defaults for select to authenticated using (true);
create policy office_task_defaults_insert on task_defaults for insert to authenticated
  with check ((select private.my_role()) = 'office');
create policy office_task_defaults_update on task_defaults for update to authenticated
  using ((select private.my_role()) = 'office') with check ((select private.my_role()) = 'office');
create policy office_task_defaults_delete on task_defaults for delete to authenticated
  using ((select private.my_role()) = 'office');
create policy read_pricing on pricing_settings for select to authenticated using (true);
create policy office_pricing on pricing_settings for update to authenticated
  using ((select private.my_role()) = 'office') with check ((select private.my_role()) = 'office');

create policy owner_builds on plan_builds for select to authenticated
  using (home_id in (select private.owned_home_ids()));
create policy office_builds on plan_builds for select to authenticated
  using ((select private.my_role()) = 'office');

create policy owner_plans on plans for select to authenticated
  using (home_id in (select private.owned_home_ids()));
create policy office_plans on plans for select to authenticated
  using ((select private.my_role()) = 'office');
create policy tech_plans on plans for select to authenticated
  using (home_id in (select private.tech_home_ids()));

create policy owner_visits on visits for select to authenticated
  using (home_id in (select private.owned_home_ids()));
create policy tech_visits on visits for select to authenticated
  using (tech_id = (select auth.uid()));
create policy office_visits on visits for select to authenticated
  using ((select private.my_role()) = 'office');

create policy owner_visit_tasks on visit_tasks for select to authenticated
  using (visit_id in (select private.owned_visit_ids()));
create policy tech_visit_tasks on visit_tasks for select to authenticated
  using (visit_id in (select private.tech_visit_ids()));
create policy office_visit_tasks on visit_tasks for select to authenticated
  using ((select private.my_role()) = 'office');

create policy owner_photos on visit_photos for select to authenticated
  using (visit_task_id in (select private.owned_task_ids()));
create policy tech_photos on visit_photos for select to authenticated
  using (visit_task_id in (select private.tech_task_ids()));
create policy office_photos on visit_photos for select to authenticated
  using ((select private.my_role()) = 'office');

create policy owner_reports on reports for select to authenticated
  using (visit_id in (select private.owned_visit_ids()));
create policy tech_reports on reports for select to authenticated
  using (visit_id in (select private.tech_visit_ids()));
create policy office_reports on reports for select to authenticated
  using ((select private.my_role()) = 'office');

create policy owner_notices on notices for select to authenticated
  using (visit_id in (select private.owned_visit_ids()));
create policy tech_notices on notices for select to authenticated
  using (visit_id in (select private.tech_visit_ids()));
create policy office_notices on notices for select to authenticated
  using ((select private.my_role()) = 'office');

create policy self_vendor on vendors for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.my_role()) = 'office');

-- Vendors see requests in their categories (location comes only from area + home_sqft).
create policy owner_requests on quote_requests for select to authenticated
  using (home_id in (select private.owned_home_ids()));
create policy vendor_requests on quote_requests for select to authenticated
  using (category = any (array(select unnest(private.vendor_categories()))));
create policy office_requests on quote_requests for select to authenticated
  using ((select private.my_role()) = 'office');

-- A vendor sees only its own bids.
create policy vendor_bids on bids for select to authenticated
  using (vendor_id in (select private.vendor_ids()));
create policy owner_bids on bids for select to authenticated
  using (request_id in (select private.owned_request_ids()));
create policy office_bids on bids for select to authenticated
  using ((select private.my_role()) = 'office');

-- The init helper is superseded by private.my_role(); keep it, but not callable from the API.
revoke execute on function public.auth_role() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage: visit-photos/{visit_id}/{task_id}/{kind}-{epoch_ms}.jpg
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('visit-photos', 'visit-photos', false)
on conflict (id) do update set public = false;

drop policy if exists visit_photos_tech_insert on storage.objects;
create policy visit_photos_tech_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and private.can_upload_visit_photo((storage.foldername(name))[1]));

drop policy if exists visit_photos_read on storage.objects;
create policy visit_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and private.can_read_visit_photo((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------------
-- 9. Realtime publication
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['visits', 'visit_tasks', 'quote_requests', 'bids', 'plan_builds',
                           'pricing_settings', 'task_defaults', 'reports', 'visit_photos', 'notices'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. RPC catalog
-- ---------------------------------------------------------------------------

-- Owner confirms a visit.
create or replace function public.confirm_visit(p_visit uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
declare v_visit visits;
begin
  perform private.require_role('homeowner');
  select * into v_visit from visits
  where id = p_visit and home_id in (select id from homes where owner_id = auth.uid())
  for update;
  if not found then
    raise exception 'We couldn''t find that visit.' using errcode = 'P0001';
  end if;
  update visits set confirmed_at = coalesce(confirmed_at, now()) where id = v_visit.id;
end $$;

-- Owner moves the visit to the next offered slot (cyclic) and un-confirms it.
create or replace function public.reschedule_visit(p_visit uuid) returns visits
  language plpgsql security definer set search_path = public
  as $$
declare
  v_visit visits;
  v_n int;
  v_idx int;
  v_next jsonb;
begin
  perform private.require_role('homeowner');
  select * into v_visit from visits
  where id = p_visit and home_id in (select id from homes where owner_id = auth.uid())
  for update;
  if not found then
    raise exception 'We couldn''t find that visit.' using errcode = 'P0001';
  end if;
  if v_visit.status not in ('scheduled', 'confirmed') then
    raise exception 'This visit can''t be rescheduled once the technician is on the way.' using errcode = 'P0001';
  end if;
  v_n := case when jsonb_typeof(v_visit.offered_slots) = 'array' then jsonb_array_length(v_visit.offered_slots) else 0 end;
  if v_n = 0 then
    raise exception 'There are no other times to offer for this visit yet.' using errcode = 'P0001';
  end if;
  select (e.i - 1)::int into v_idx
  from jsonb_array_elements(v_visit.offered_slots) with ordinality e(s, i)
  where (e.s ->> 'start')::timestamptz = v_visit.window_start
  order by e.i
  limit 1;
  v_next := v_visit.offered_slots -> ((coalesce(v_idx, -1) + 1) % v_n);
  update visits
  set window_start = (v_next ->> 'start')::timestamptz,
      window_end = (v_next ->> 'end')::timestamptz,
      confirmed_at = null
  where id = v_visit.id
  returning * into v_visit;
  return v_visit;
end $$;

-- Assigned tech (or office): scheduled -> enroute -> onsite.
create or replace function public.advance_visit(p_visit uuid) returns visits
  language plpgsql security definer set search_path = public
  as $$
declare
  v_role user_role;
  v_visit visits;
begin
  v_role := private.require_role('tech', 'office');
  select * into v_visit from visits
  where id = p_visit and (v_role = 'office' or tech_id = auth.uid())
  for update;
  if not found then
    raise exception 'We couldn''t find that visit.' using errcode = 'P0001';
  end if;
  if v_visit.status in ('scheduled', 'confirmed') then
    update visits set status = 'enroute', started_at = now() where id = v_visit.id returning * into v_visit;
    insert into notices (visit_id, kind, channel) values (v_visit.id, 'enroute', 'push');
  elsif v_visit.status = 'enroute' then
    update visits set status = 'onsite', arrived_at = now() where id = v_visit.id returning * into v_visit;
  else
    raise exception 'This visit is already on site.' using errcode = 'P0001';
  end if;
  return v_visit;
end $$;

-- Assigned tech checks a task off (only while on site).
create or replace function public.set_task_done(p_task uuid, p_done boolean) returns visit_tasks
  language plpgsql security definer set search_path = public
  as $$
declare
  v_task visit_tasks;
  v_visit visits;
begin
  perform private.require_role('tech');
  select vt.* into v_task from visit_tasks vt join visits v on v.id = vt.visit_id
  where vt.id = p_task and v.tech_id = auth.uid();
  if not found then
    raise exception 'We couldn''t find that task.' using errcode = 'P0001';
  end if;
  select * into v_visit from visits where id = v_task.visit_id for update;
  if v_visit.status <> 'onsite' then
    raise exception 'Mark yourself on site to start the checklist.' using errcode = 'P0001';
  end if;
  update visit_tasks
  set done = coalesce(p_done, false),
      done_at = case when coalesce(p_done, false) then coalesce(done_at, now()) end
  where id = v_task.id
  returning * into v_task;
  return v_task;
end $$;

-- Assigned tech records an uploaded photo. Same path twice returns the existing row.
create or replace function public.add_visit_photo(p_task uuid, p_kind text, p_path text) returns visit_photos
  language plpgsql security definer set search_path = public
  as $$
declare
  v_task visit_tasks;
  v_visit visits;
  v_photo visit_photos;
begin
  perform private.require_role('tech');
  select vt.* into v_task from visit_tasks vt join visits v on v.id = vt.visit_id
  where vt.id = p_task and v.tech_id = auth.uid();
  if not found then
    raise exception 'We couldn''t find that task.' using errcode = 'P0001';
  end if;
  select * into v_visit from visits where id = v_task.visit_id;
  if v_visit.status not in ('onsite', 'done') then
    raise exception 'Mark yourself on site to add photos.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('before', 'after', 'drain', 'finding') then
    raise exception 'That photo type isn''t supported.' using errcode = 'P0001';
  end if;
  if p_path is null or left(p_path, length(v_visit.id::text) + 1) <> v_visit.id::text || '/' then
    raise exception 'That photo doesn''t belong to this visit.' using errcode = 'P0001';
  end if;
  select * into v_photo from visit_photos where visit_task_id = v_task.id and path = p_path limit 1;
  if found then
    return v_photo;
  end if;
  insert into visit_photos (visit_task_id, kind, path) values (v_task.id, p_kind, p_path) returning * into v_photo;
  return v_photo;
end $$;

-- Assigned tech completes the visit and publishes the report. Idempotent.
create or replace function public.complete_visit(p_visit uuid) returns reports
  language plpgsql security definer set search_path = public
  as $$
declare
  v_visit visits;
  v_report reports;
  v_pending int;
  v_has_findings boolean;
begin
  perform private.require_role('tech');
  select * into v_visit from visits where id = p_visit and tech_id = auth.uid() for update;
  if not found then
    raise exception 'We couldn''t find that visit.' using errcode = 'P0001';
  end if;
  select * into v_report from reports where visit_id = v_visit.id;
  if found then
    return v_report;
  end if;
  if v_visit.status not in ('onsite', 'done') then
    raise exception 'Mark yourself on site before completing the visit.' using errcode = 'P0001';
  end if;
  select count(*) into v_pending from visit_tasks where visit_id = v_visit.id and not coalesce(done, false);
  if v_pending > 0 then
    raise exception 'Check off every task before completing the visit.' using errcode = 'P0001';
  end if;
  select exists (
    select 1 from appliances a left join appliance_models m on m.id = a.model_id
    where a.home_id = v_visit.home_id and (
      m.category in ('water_heater', 'dryer')
      or exists (select 1 from model_tasks mt where mt.model_id = a.model_id and mt.task_key in ('wh', 'dryer'))
      or coalesce(a.name, m.name, '') ~* '(water heater|dryer)'
    )
  ) into v_has_findings;
  update visits set status = 'done', completed_at = coalesce(completed_at, now()) where id = v_visit.id;
  insert into reports (visit_id, health_score, findings)
  values (v_visit.id, 86, case when v_has_findings then
    '[{"text":"Anode rod 70% depleted","tone":"ochre","badge":"Quote $185"},{"text":"Dryer vent airflow normal","tone":"forest","badge":"Good"}]'::jsonb
    else '[]'::jsonb end)
  returning * into v_report;
  insert into notices (visit_id, kind, channel) values (v_visit.id, 'report', 'push');
  return v_report;
end $$;

-- Homeowner asks for bids on an add-on. Idempotent per home and category.
create or replace function public.request_quote(p_category text) returns quote_requests
  language plpgsql security definer set search_path = public
  as $$
declare
  v_home homes;
  v_cat service_categories;
  v_req quote_requests;
begin
  perform private.require_role('homeowner');
  select * into v_home from homes where owner_id = auth.uid() order by created_at, id limit 1;
  if not found then
    raise exception 'Add your home before requesting quotes.' using errcode = 'P0001';
  end if;
  select * into v_cat from service_categories where id = p_category;
  if not found then
    raise exception 'That service isn''t available yet.' using errcode = 'P0001';
  end if;
  select * into v_req from quote_requests
  where home_id = v_home.id and category = v_cat.id and status in ('open', 'booked')
  order by created_at desc limit 1;
  if found then
    return v_req;
  end if;
  insert into quote_requests (home_id, category, scope, status, base, area, home_sqft)
  values (v_home.id, v_cat.id, v_cat.sub, 'open', v_cat.base, private.home_area(v_home.address), v_home.sqft)
  on conflict (home_id, category) where status in ('open', 'booked') do nothing
  returning * into v_req;
  if not found then
    select * into v_req from quote_requests
    where home_id = v_home.id and category = v_cat.id and status in ('open', 'booked')
    order by created_at desc limit 1;
  end if;
  return v_req;
end $$;

-- Vetted vendor bids on an open request in one of its categories. One bid per vendor.
create or replace function public.submit_bid(p_request uuid, p_price numeric, p_available_on date) returns bids
  language plpgsql security definer set search_path = public
  as $$
declare
  v_req quote_requests;
  v_vendor vendors;
  v_bid bids;
begin
  perform private.require_role('vendor');
  if not exists (select 1 from vendors where profile_id = auth.uid() and vetted) then
    raise exception 'Your vendor account isn''t approved yet.' using errcode = 'P0001';
  end if;
  select * into v_req from quote_requests where id = p_request for update;
  if found then
    select * into v_vendor from vendors
    where profile_id = auth.uid() and vetted and v_req.category = any (categories)
    order by company, id limit 1;
  end if;
  if v_req.id is null or v_vendor.id is null then
    raise exception 'We couldn''t find that request.' using errcode = 'P0001';
  end if;
  select * into v_bid from bids where request_id = v_req.id and vendor_id = v_vendor.id;
  if found then
    return v_bid;
  end if;
  if v_req.status <> 'open' then
    raise exception 'This request is closed.' using errcode = 'P0001';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a price above $0.' using errcode = 'P0001';
  end if;
  if p_price >= 1000000 then
    raise exception 'Enter a price under $1,000,000.' using errcode = 'P0001';
  end if;
  if p_available_on is null then
    raise exception 'Pick a date you''re available.' using errcode = 'P0001';
  end if;
  insert into bids (request_id, vendor_id, price, available_on)
  values (v_req.id, v_vendor.id, round(p_price, 2), p_available_on)
  on conflict (request_id, vendor_id) do nothing
  returning * into v_bid;
  if not found then
    select * into v_bid from bids where request_id = v_req.id and vendor_id = v_vendor.id;
  end if;
  return v_bid;
end $$;

-- Owner books a bid. First booking wins.
create or replace function public.book_bid(p_bid uuid) returns quote_requests
  language plpgsql security definer set search_path = public
  as $$
declare
  v_bid bids;
  v_req quote_requests;
  v_fee numeric;
begin
  perform private.require_role('homeowner');
  select * into v_bid from bids where id = p_bid;
  if found then
    select * into v_req from quote_requests
    where id = v_bid.request_id and home_id in (select id from homes where owner_id = auth.uid())
    for update;
  end if;
  if v_bid.id is null or v_req.id is null then
    raise exception 'We couldn''t find that bid.' using errcode = 'P0001';
  end if;
  if v_req.status = 'booked' and v_req.booked_bid_id = v_bid.id then
    return v_req;
  end if;
  if v_req.status <> 'open' then
    raise exception 'This request was already booked.' using errcode = 'P0001';
  end if;
  select coordination_fee into v_fee from pricing_settings where id = 1;
  update quote_requests
  set status = 'booked',
      booked_bid_id = v_bid.id,
      booked_at = now(),
      coordination_fee = round(v_bid.price * coalesce(v_fee, 0.10), 2)
  where id = v_req.id
  returning * into v_req;
  return v_req;
end $$;

-- Office sends the 48-hour reminder for every upcoming visit that hasn't had one.
create or replace function public.send_48h_reminders() returns int
  language plpgsql security definer set search_path = public
  as $$
declare v_count int;
begin
  perform private.require_role('office');
  with ins as (
    insert into notices (visit_id, kind, channel)
    select v.id, '48h', 'push'
    from visits v
    where v.status not in ('done', 'canceled')
      and v.window_start >= private.chicago_at(private.chicago_today(), time '00:00')
      and v.window_start < now() + interval '7 days'
      and not exists (select 1 from notices n where n.visit_id = v.id and n.kind = '48h')
    returning 1
  )
  select count(*)::int into v_count from ins;
  return v_count;
end $$;

-- Owner switches tier. The current visit's checklist follows when nothing has started.
create or replace function public.set_plan_tier(
  p_tier tier_key, p_monthly numeric, p_annual numeric, p_materials numeric, p_labor numeric, p_next_tasks text[]
) returns plans
  language plpgsql security definer set search_path = public
  as $$
declare
  v_plan plans;
  v_visit visits;
begin
  perform private.require_role('homeowner');
  if p_tier is null then
    raise exception 'Pick a plan tier.' using errcode = 'P0001';
  end if;
  if p_monthly is null or p_annual is null or p_materials is null or p_labor is null
     or p_monthly < 0 or p_annual < 0 or p_materials < 0 or p_labor < 0 then
    raise exception 'Something''s off with that price. Try again.' using errcode = 'P0001';
  end if;
  select pl.* into v_plan from plans pl join homes h on h.id = pl.home_id
  where h.owner_id = auth.uid() and pl.active
  order by pl.starts_on desc nulls last, pl.id
  limit 1
  for update of pl;
  if not found then
    raise exception 'Start a plan first.' using errcode = 'P0001';
  end if;
  update plans
  set tier = p_tier, monthly = round(p_monthly, 2), annual = round(p_annual, 2),
      materials = round(p_materials, 2), labor = round(p_labor, 2)
  where id = v_plan.id
  returning * into v_plan;

  select * into v_visit from visits where id = private.current_visit_id(v_plan.home_id) for update;
  if found
     and v_visit.status in ('scheduled', 'confirmed')
     and coalesce(cardinality(p_next_tasks), 0) > 0
     and not exists (select 1 from visit_tasks where visit_id = v_visit.id and done) then
    delete from visit_tasks where visit_id = v_visit.id;
    insert into visit_tasks (visit_id, task_key, name, part_id, appliance_id)
    select v_visit.id, k.key, coalesce(td.name, k.key), private.task_part_id(k.key),
           private.home_appliance_for(v_visit.home_id, k.key)
    from (
      select u.key, min(u.ord) as ord
      from unnest(p_next_tasks) with ordinality u(key, ord)
      where nullif(btrim(u.key), '') is not null
      group by u.key
    ) k
    left join task_defaults td on td.task_key = k.key
    order by k.ord;
  end if;
  return v_plan;
end $$;

-- Homeowner creates or updates their single home and their name.
create or replace function public.save_home(
  p_full_name text, p_address text, p_sqft int, p_year int, p_beds numeric, p_baths numeric,
  p_floors int, p_zones int, p_pets boolean, p_water text
) returns homes
  language plpgsql security definer set search_path = public
  as $$
declare v_home homes;
begin
  perform private.require_role('homeowner');
  if nullif(btrim(p_address), '') is null then
    raise exception 'Enter your home address.' using errcode = 'P0001';
  end if;
  if p_water is not null and p_water not in ('city_hard', 'well', 'softened') then
    raise exception 'Pick a water type.' using errcode = 'P0001';
  end if;
  if coalesce(p_sqft, 0) < 0 or coalesce(p_year, 0) < 0 or coalesce(p_beds, 0) < 0 or coalesce(p_baths, 0) < 0
     or coalesce(p_floors, 0) < 0 or coalesce(p_zones, 0) < 0 then
    raise exception 'Check the home details and try again.' using errcode = 'P0001';
  end if;
  -- One home per owner, even with a double tap.
  perform pg_advisory_xact_lock(hashtextextended('save_home:' || auth.uid()::text, 0));
  if nullif(btrim(p_full_name), '') is not null then
    update profiles set full_name = btrim(p_full_name) where id = auth.uid();
  end if;
  select * into v_home from homes where owner_id = auth.uid() order by created_at, id limit 1 for update;
  if found then
    update homes
    set address = btrim(p_address), sqft = p_sqft, year_built = p_year, bedrooms = p_beds, bathrooms = p_baths,
        floors = p_floors, hvac_zones = p_zones, pets = coalesce(p_pets, false), water = coalesce(p_water, 'city_hard')
    where id = v_home.id
    returning * into v_home;
  else
    insert into homes (owner_id, address, sqft, year_built, bedrooms, bathrooms, floors, hvac_zones, pets, water)
    values (auth.uid(), btrim(p_address), p_sqft, p_year, p_beds, p_baths, p_floors, p_zones,
            coalesce(p_pets, false), coalesce(p_water, 'city_hard'))
    returning * into v_home;
  end if;
  return v_home;
end $$;

-- Owner replaces the home's appliances. Items: {model, serial, brand, name}.
create or replace function public.set_home_appliances(p_home uuid, p_items jsonb) returns int
  language plpgsql security definer set search_path = public
  as $$
declare
  v_home homes;
  v_count int;
begin
  perform private.require_role('homeowner');
  select * into v_home from homes where id = p_home and owner_id = auth.uid() for update;
  if not found then
    raise exception 'We couldn''t find that home.' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Something''s off with that appliance list. Try again.' using errcode = 'P0001';
  end if;
  update visit_tasks set appliance_id = null
  where appliance_id in (select id from appliances where home_id = v_home.id);
  delete from appliances where home_id = v_home.id;
  insert into appliances (home_id, model_id, model, serial, brand, name)
  select v_home.id,
         (select m.id from appliance_models m
          where upper(regexp_replace(m.model, '\s+', '', 'g')) = private.norm_model(e.item ->> 'model')
            and private.norm_model(e.item ->> 'model') <> ''
          order by m.id limit 1),
         nullif(btrim(e.item ->> 'model'), ''),
         nullif(btrim(e.item ->> 'serial'), ''),
         nullif(btrim(e.item ->> 'brand'), ''),
         nullif(btrim(e.item ->> 'name'), '')
  from jsonb_array_elements(p_items) with ordinality e(item, ord)
  where jsonb_typeof(e.item) = 'object'
  order by e.ord;
  get diagnostics v_count = row_count;
  -- Re-link open checklist items to the new appliances.
  update visit_tasks vt set appliance_id = private.home_appliance_for(v_home.id, vt.task_key)
  from visits v
  where v.id = vt.visit_id and v.home_id = v_home.id and vt.appliance_id is null;
  return v_count;
end $$;

-- Owner starts a plan: deactivates old plans, creates the year of visits from the schedule.
create or replace function public.start_plan(
  p_home uuid, p_tier tier_key, p_monthly numeric, p_annual numeric, p_materials numeric, p_labor numeric, p_schedule jsonb
) returns plans
  language plpgsql security definer set search_path = public
  as $$
declare
  v_home homes;
  v_plan plans;
  v_first date;
  v_day date;
  v_tech uuid;
  v_entry record;
  v_offset numeric;
  v_keys text[];
  v_visit_id uuid;
begin
  perform private.require_role('homeowner');
  select * into v_home from homes where id = p_home and owner_id = auth.uid() for update;
  if not found then
    raise exception 'We couldn''t find that home.' using errcode = 'P0001';
  end if;
  if p_tier is null then
    raise exception 'Pick a plan tier.' using errcode = 'P0001';
  end if;
  if p_monthly is null or p_annual is null or p_materials is null or p_labor is null
     or p_monthly < 0 or p_annual < 0 or p_materials < 0 or p_labor < 0 then
    raise exception 'Something''s off with that price. Try again.' using errcode = 'P0001';
  end if;
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array'
     or jsonb_array_length(p_schedule) = 0 or jsonb_array_length(p_schedule) > 12 then
    raise exception 'We couldn''t build a schedule for that plan. Try again.' using errcode = 'P0001';
  end if;

  -- Old plans: drop their visits that haven't started, then deactivate.
  delete from visits v
  where v.plan_id in (select id from plans where home_id = v_home.id and active)
    and v.status in ('scheduled', 'confirmed')
    and not exists (select 1 from visit_tasks t where t.visit_id = v.id and t.done);
  update plans set active = false where home_id = v_home.id and active;

  v_first := private.next_weekday(private.chicago_today());
  v_tech := private.default_tech();

  insert into plans (home_id, tier, monthly, annual, materials, labor, starts_on, active)
  values (v_home.id, p_tier, round(p_monthly, 2), round(p_annual, 2), round(p_materials, 2), round(p_labor, 2), v_first, true)
  returning * into v_plan;

  for v_entry in
    select e.value as item, e.ord from jsonb_array_elements(p_schedule) with ordinality e(value, ord) order by e.ord
  loop
    v_offset := case when jsonb_typeof(v_entry.item -> 'month_offset') = 'number'
                     then (v_entry.item ->> 'month_offset')::numeric else 0 end;
    v_day := private.weekday_on_or_after((v_first + v_offset * interval '1 month')::date);
    v_keys := array(
      select x.k from (
        select t.k, min(t.o) as o
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_entry.item -> 'task_keys') = 'array' then v_entry.item -> 'task_keys' else '[]'::jsonb end
        ) with ordinality t(k, o)
        where nullif(btrim(t.k), '') is not null
        group by t.k
      ) x
      order by x.o
    );

    insert into visits (plan_id, home_id, tech_id, window_start, window_end, status, offered_slots)
    values (
      v_plan.id, v_home.id, v_tech,
      private.chicago_at(v_day, time '09:00'), private.chicago_at(v_day, time '11:00'),
      'scheduled',
      case when v_entry.ord = 1 then jsonb_build_array(
        private.slot(v_day, time '09:00', time '11:00'),
        private.slot(private.next_weekday(v_day), time '13:00', time '15:00'),
        private.slot(private.add_weekdays(v_day, 3), time '08:00', time '10:00'))
      end)
    returning id into v_visit_id;

    insert into visit_tasks (visit_id, task_key, name, part_id, appliance_id)
    select v_visit_id, k.key, coalesce(td.name, k.key), private.task_part_id(k.key),
           private.home_appliance_for(v_home.id, k.key)
    from unnest(v_keys) with ordinality k(key, ord)
    left join task_defaults td on td.task_key = k.key
    order by k.ord;

    if v_entry.ord = 1 then
      insert into notices (visit_id, kind, channel) values (v_visit_id, '7d', 'email');
    end if;
  end loop;

  return v_plan;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Demo accounts and scenario (docs/LIVE_ARCHITECTURE.md §6)
-- ---------------------------------------------------------------------------

create or replace function private.demo_users()
  returns table (id uuid, email text, full_name text, role user_role, title text, vehicle text)
  language sql immutable set search_path = public
  as $$
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'office@php.test',     'Avery Brooks',   'office'::user_role,    'Office manager',                       null::text),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'tech@php.test',       'Marcus Reyes',   'tech'::user_role,      'Senior technician · 4.9 · 212 visits', 'Silver Transit van · PHP-214'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'dana@php.test',       'Dana Liu',       'tech'::user_role,      'Technician · 4.8 · 96 visits',         'White Transit van · PHP-208'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'vendor@php.test',     'Sam Ortiz',      'vendor'::user_role,    null,                                   null),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'homeowner@php.test',  'Elena Alvarez',  'homeowner'::user_role, null,                                   null),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'newhome@php.test',    'Jordan Lee',     'homeowner'::user_role, null,                                   null),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'david@php.test',      'David Okafor',   'homeowner'::user_role, null,                                   null),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'whitfield@php.test',  'The Whitfields', 'homeowner'::user_role, null,                                   null),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'priya@php.test',      'Priya Shah',     'homeowner'::user_role, null,                                   null),
    ('a0000000-0000-4000-8000-000000000010'::uuid, 'bell@php.test',       'Mark & Jo Bell', 'homeowner'::user_role, null,                                   null)
$$;

-- Creates the demo logins (password phpdemo2026) and their profiles. Idempotent.
create or replace function public.ensure_demo_users() returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  v_col text;
  v_ids uuid[] := array(select id from private.demo_users());
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt('phpdemo2026', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name),
         now(), now()
  from private.demo_users() u
  where not exists (select 1 from auth.users a where a.id = u.id or lower(a.email) = lower(u.email))
  on conflict do nothing;

  -- GoTrue scans these as strings; NULL breaks sign-in.
  foreach v_col in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                               'phone_change', 'phone_change_token', 'email_change_token_current',
                               'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = v_col) then
      execute format('update auth.users set %1$I = '''' where %1$I is null and id = any ($1)', v_col) using v_ids;
    end if;
  end loop;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from private.demo_users() u
  where exists (select 1 from auth.users a where a.id = u.id)
  on conflict do nothing;

  -- handle_new_user created homeowner profiles; set the real roles and details.
  insert into profiles (id, role, full_name, email, title, vehicle)
  select u.id, u.role, u.full_name, u.email, u.title, u.vehicle
  from private.demo_users() u
  where exists (select 1 from auth.users a where a.id = u.id)
  on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name, email = excluded.email,
      title = excluded.title, vehicle = excluded.vehicle;
end $$;

-- Rebuilds the demo scenario relative to p_today (Chicago). Never deletes auth users.
create or replace function public.seed_demo(p_today date default (now() at time zone 'America/Chicago')::date) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  d date := coalesce(p_today, private.chicago_today());
  all_cats constant text[] := array['lawn', 'land', 'win', 'press', 'lights', 'tree'];
  all_tasks constant text[] := array['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'];
  u_marcus constant uuid := 'a0000000-0000-4000-8000-000000000002';
  u_dana   constant uuid := 'a0000000-0000-4000-8000-000000000003';
  u_sam    constant uuid := 'a0000000-0000-4000-8000-000000000004';
  u_elena  constant uuid := 'a0000000-0000-4000-8000-000000000005';
  u_david  constant uuid := 'a0000000-0000-4000-8000-000000000007';
  u_whit   constant uuid := 'a0000000-0000-4000-8000-000000000008';
  u_priya  constant uuid := 'a0000000-0000-4000-8000-000000000009';
  u_bell   constant uuid := 'a0000000-0000-4000-8000-000000000010';
  h_elena  constant uuid := 'b0000000-0000-4000-8000-000000000005';
  h_david  constant uuid := 'b0000000-0000-4000-8000-000000000007';
  h_whit   constant uuid := 'b0000000-0000-4000-8000-000000000008';
  h_priya  constant uuid := 'b0000000-0000-4000-8000-000000000009';
  h_bell   constant uuid := 'b0000000-0000-4000-8000-000000000010';
  p_elena  constant uuid := 'c0000000-0000-4000-8000-000000000005';
  p_david  constant uuid := 'c0000000-0000-4000-8000-000000000007';
  p_whit   constant uuid := 'c0000000-0000-4000-8000-000000000008';
  p_priya  constant uuid := 'c0000000-0000-4000-8000-000000000009';
  p_bell   constant uuid := 'c0000000-0000-4000-8000-000000000010';
  v_elena  constant uuid := 'd0000000-0000-4000-8000-000000000005';
  v_david  constant uuid := 'd0000000-0000-4000-8000-000000000007';
  v_whit   constant uuid := 'd0000000-0000-4000-8000-000000000008';
  v_priya  constant uuid := 'd0000000-0000-4000-8000-000000000009';
  v_bell   constant uuid := 'd0000000-0000-4000-8000-000000000010';
  vd_evergreen constant uuid := 'e0000000-0000-4000-8000-000000000001';
  vd_summit    constant uuid := 'e0000000-0000-4000-8000-000000000002';
  vd_clear     constant uuid := 'e0000000-0000-4000-8000-000000000003';
begin
  -- Best effort: the demo logins exist and their profiles are restored.
  begin
    perform public.ensure_demo_users();
  exception when others then
    raise notice 'ensure_demo_users skipped: %', sqlerrm;
  end;

  -- 1. Transactional rows (WHERE true keeps safeupdate happy when called through the API).
  delete from bids where true;
  delete from quote_requests where true;
  delete from reports where true;
  delete from visit_photos where true;
  delete from notices where true;
  delete from visit_tasks where true;
  delete from visits where true;
  delete from plans where true;
  delete from plan_builds where true;
  delete from appliances where true;
  delete from homes where true;

  -- 2. Pricing defaults (PRICING.md).
  insert into pricing_settings (id, labor_rate, trip_fee, parts_markup, tech_cost, vehicle_cost, coordination_fee)
  values (1, 94, 35, 0.25, 38, 12, 0.10)
  on conflict (id) do update
  set labor_rate = excluded.labor_rate, trip_fee = excluded.trip_fee, parts_markup = excluded.parts_markup,
      tech_cost = excluded.tech_cost, vehicle_cost = excluded.vehicle_cost, coordination_fee = excluded.coordination_fee;

  delete from task_defaults where task_key <> all (all_tasks);
  insert into task_defaults (task_key, name, labor_min, freq_high, freq_recommended, freq_medium, freq_low) values
    ('hvac',   'Replace HVAC filters ×2',        20,  6, 6, 4, 2),
    ('fridge', 'Replace fridge water filter',    10,  2, 2, 2, 1),
    ('ice',    'Drain & sanitize ice maker',     25,  4, 2, 2, 1),
    ('dish',   'Clean dishwasher filter & sump', 15, 12, 6, 4, 2),
    ('wh',     'Flush water heater',             40,  2, 2, 1, 1),
    ('dryer',  'Clean dryer vent',               30,  2, 1, 1, 0),
    ('smoke',  'Test smoke & CO detectors',      10,  4, 2, 2, 1)
  on conflict (task_key) do update
  set name = excluded.name, labor_min = excluded.labor_min, freq_high = excluded.freq_high,
      freq_recommended = excluded.freq_recommended, freq_medium = excluded.freq_medium, freq_low = excluded.freq_low;

  -- 3. Reference data.
  insert into service_categories (id, name, sub, base) values
    ('lawn',   'Lawn care',        'Weekly mow, edge and blow',     65),
    ('land',   'Landscaping',      'Beds, mulch, seasonal color',   1400),
    ('win',    'Window washing',   'Inside and out, screens',       420),
    ('press',  'Pressure washing', 'Driveway, walks, siding',       340),
    ('lights', 'Holiday lights',   'Roofline install and removal',  1150),
    ('tree',   'Tree service',     'Trim, removal, stump grind',    780)
  on conflict (id) do update set name = excluded.name, sub = excluded.sub, base = excluded.base;
  delete from service_categories where id <> all (all_cats);

  insert into parts (part_number, description) values
    ('16x25x4-MERV11',  '16×25×4 MERV 11 filter, 2-pack'),
    ('LT1000P',         'LG LT1000P fridge water filter'),
    ('ICE-SANI',        'Ice maker sanitizer kit'),
    ('AFFRESH-DW',      'Affresh dishwasher cleaner tablets'),
    ('WH-DRAIN',        'Water heater drain hose kit'),
    ('9V',              '9V batteries, 4-pack'),
    ('DV-BRUSH',        'Dryer vent cleaning brush kit'),
    ('SMOKE-CO-10Y',    '10-year smoke & CO alarm'),
    ('16x25x4-MERV13',  '16×25×4 MERV 13 filter, 2-pack')
  on conflict (part_number) do update set description = excluded.description;

  delete from part_prices where part_id in (select id from parts where part_number in
    ('16x25x4-MERV11', 'LT1000P', 'ICE-SANI', 'AFFRESH-DW', 'WH-DRAIN', '9V', 'DV-BRUSH', 'SMOKE-CO-10Y', '16x25x4-MERV13'));
  -- Lowest in-stock price per part matches TASKS[].cost in packages/pricing.
  insert into part_prices (part_id, supplier, price, url, in_stock, fetched_at)
  select p.id, x.supplier, x.price, null, x.in_stock, now()
  from (values
    ('16x25x4-MERV11', 'Amazon',      76.80, true),
    ('16x25x4-MERV11', 'Lowe''s',     79.98, true),
    ('16x25x4-MERV11', 'Home Depot',  82.47, true),
    ('16x25x4-MERV11', 'Ferguson',    74.20, false),
    ('16x25x4-MERV11', 'SupplyHouse', 88.00, true),
    ('LT1000P',        'Amazon',      49.97, true),
    ('LT1000P',        'Lowe''s',     52.99, true),
    ('LT1000P',        'Home Depot',  54.97, true),
    ('LT1000P',        'SupplyHouse', 47.50, false),
    ('ICE-SANI',       'Amazon',       8.50, true),
    ('ICE-SANI',       'Home Depot',   9.98, true),
    ('AFFRESH-DW',     'Amazon',       4.20, true),
    ('AFFRESH-DW',     'Lowe''s',      4.48, true),
    ('AFFRESH-DW',     'Home Depot',   4.75, true),
    ('WH-DRAIN',       'Home Depot',   6.00, true),
    ('WH-DRAIN',       'SupplyHouse',  6.49, true),
    ('WH-DRAIN',       'Ferguson',     7.25, true),
    ('9V',             'Home Depot',  12.00, true),
    ('9V',             'Amazon',      12.49, true),
    ('9V',             'Lowe''s',     13.98, true),
    ('DV-BRUSH',       'Amazon',      19.99, true),
    ('DV-BRUSH',       'Home Depot',  24.97, true),
    ('SMOKE-CO-10Y',   'Home Depot',  42.97, true),
    ('SMOKE-CO-10Y',   'Lowe''s',     44.98, true),
    ('16x25x4-MERV13', 'Ferguson',    92.40, true),
    ('16x25x4-MERV13', 'Amazon',      94.99, true),
    ('16x25x4-MERV13', 'SupplyHouse', 96.00, false)
  ) as x(part_number, supplier, price, in_stock)
  join parts p on p.part_number = x.part_number;

  insert into appliance_models (brand, model, category, name, note, manual_url, extracted_at) values
    ('CARRIER CORP.',   '59TN6B100V21', 'hvac',         'Carrier Infinity furnace', 'Filter 16×25×4', null, now()),
    ('LG ELECTRONICS',  'LRMVS3006S',   'refrigerator', 'LG refrigerator',          'Filter LT1000P', null, now()),
    ('BSH HOME APPL.',  'SHPM88Z75N',   'dishwasher',   'Bosch 800 dishwasher',     'Filter monthly', null, now()),
    ('RHEEM MFG CO.',   'XE50T10H45U0', 'water_heater', 'Rheem water heater',       '11 yrs · flush', null, now()),
    ('WHIRLPOOL CORP.', 'WED5620HW',    'dryer',        'Whirlpool dryer',          'Vent yearly',    null, now())
  on conflict (model) do update
  set brand = excluded.brand, category = excluded.category, name = excluded.name, note = excluded.note;

  delete from model_tasks where model_id in (select id from appliance_models where model in
    ('59TN6B100V21', 'LRMVS3006S', 'SHPM88Z75N', 'XE50T10H45U0', 'WED5620HW'));
  insert into model_tasks (model_id, task_key, name, interval_months, part_number)
  select m.id, x.task_key, td.name, x.interval_months, x.part_number
  from (values
    ('59TN6B100V21', 'hvac',   2,  '16x25x4-MERV11'),
    ('LRMVS3006S',   'fridge', 6,  'LT1000P'),
    ('LRMVS3006S',   'ice',    6,  'ICE-SANI'),
    ('SHPM88Z75N',   'dish',   1,  'AFFRESH-DW'),
    ('XE50T10H45U0', 'wh',     6,  'WH-DRAIN'),
    ('WED5620HW',    'dryer',  12, null)
  ) as x(model, task_key, interval_months, part_number)
  join appliance_models m on m.model = x.model
  left join task_defaults td on td.task_key = x.task_key;

  insert into vendors (id, profile_id, company, categories, rating, service_radius_mi, vetted) values
    (vd_evergreen, (select id from profiles where id = u_sam), 'Evergreen Outdoor Co.', all_cats, 4.9, 25, true),
    (vd_summit,    null,                                       'Summit Pro Services',   all_cats, 4.8, 30, true),
    (vd_clear,     null,                                       'Clearview & Sons',      all_cats, 4.7, 30, true)
  on conflict (id) do update
  set profile_id = excluded.profile_id, company = excluded.company, categories = excluded.categories,
      rating = excluded.rating, service_radius_mi = excluded.service_radius_mi, vetted = excluded.vetted;
  delete from vendors where id not in (vd_evergreen, vd_summit, vd_clear);

  -- 4. Homes.
  insert into homes (id, owner_id, address, sqft, year_built, bedrooms, bathrooms, floors, hvac_zones, pets, water, notes, created_at) values
    (h_elena, u_elena, '12 Linden Court, Dallas, TX 75205',    3420, 2006, 4, 3.5, 2, 2, true,  'city_hard',
     'Gate code 4471. Heater in garage, back left.', now()),
    (h_david, u_david, '4410 Bryn Mawr Dr, Dallas, TX 75225',  2850, 1998, 4, 3,   2, 2, false, 'city_hard',
     'Side gate latch sticks. Furnace in the attic.', now()),
    (h_whit,  u_whit,  '88 Beverly Dr, Dallas, TX 75205',      5200, 1989, 5, 4.5, 2, 3, true,  'softened',
     'Two friendly dogs. Park in the circle drive.', now()),
    (h_priya, u_priya, '17 Stonebridge Dr, Dallas, TX 75204',  2100, 2015, 3, 2.5, 2, 1, false, 'well',
     'Ring the side door. Water heater in the utility closet.', now()),
    (h_bell,  u_bell,  '203 Lakewood Blvd, Dallas, TX 75214',  2600, 1952, 3, 2,   1, 1, false, 'city_hard',
     'Garage code 0214. Please use the back entrance.', now());

  -- Elena's five appliances (apps/mobile/src/data/seed.ts APPLIANCES), linked to the model cache.
  insert into appliances (home_id, model_id, model, serial, brand, name, room)
  select h_elena, m.id, x.model, x.serial, x.brand, x.name, x.room
  from (values
    (1, 'CARRIER CORP.',   'Carrier Infinity furnace', '59TN6B100V21', '2419A83715',   'Utility closet'),
    (2, 'LG ELECTRONICS',  'LG refrigerator',          'LRMVS3006S',   '309KRBD4Y771', 'Kitchen'),
    (3, 'BSH HOME APPL.',  'Bosch 800 dishwasher',     'SHPM88Z75N',   'FD9912 00471', 'Kitchen'),
    (4, 'RHEEM MFG CO.',   'Rheem water heater',       'XE50T10H45U0', 'Q461504231',   'Garage'),
    (5, 'WHIRLPOOL CORP.', 'Whirlpool dryer',          'WED5620HW',    'C92814553',    'Laundry')
  ) as x(ord, brand, name, model, serial, room)
  join appliance_models m on m.model = x.model
  order by x.ord;

  -- 5. Plans (monthly/annual/materials/labor from packages/pricing at the defaults).
  insert into plans (id, home_id, tier, monthly, annual, materials, labor, starts_on, active) values
    (p_elena, h_elena, 'recommended', 137.58, 1651.01, 798.68,  852.33, d, true),
    (p_david, h_david, 'medium',       99.89, 1198.67, 588.67,  610.00, d, true),
    (p_whit,  h_whit,  'high',        186.79, 2241.43, 881.42, 1360.00, d, true),
    (p_priya, h_priya, 'recommended', 110.51, 1326.17, 599.17,  727.00, d, true),
    (p_bell,  h_bell,  'low',          50.91,  610.92, 298.09,  312.83, d, true);

  -- 6. Visits.
  insert into visits (id, plan_id, home_id, tech_id, window_start, window_end, status, confirmed_at, offered_slots)
  select x.id, x.plan_id, x.home_id, x.tech_id,
         private.chicago_at(d + x.day, x.t0), private.chicago_at(d + x.day, x.t1),
         'scheduled',
         case when x.confirmed then private.chicago_at(d - 2, time '10:00') end,
         jsonb_build_array(
           private.slot(d + x.day, x.t0, x.t1),
           private.slot(d + x.day + 1, time '13:00', time '15:00'),
           private.slot(d + x.day + 3, time '08:00', time '10:00'))
  from (values
    (v_elena, p_elena, h_elena, u_marcus, 0, time '09:00', time '11:00', false),
    (v_david, p_david, h_david, u_marcus, 0, time '12:00', time '14:00', true),
    (v_whit,  p_whit,  h_whit,  u_marcus, 0, time '15:00', time '17:00', true),
    (v_priya, p_priya, h_priya, u_dana,   1, time '09:00', time '11:00', false),
    (v_bell,  p_bell,  h_bell,  u_dana,   2, time '10:00', time '12:00', true)
  ) as x(id, plan_id, home_id, tech_id, day, t0, t1, confirmed);

  -- Baseline checklist per tier and home (adjustedFreq > 0). Only the Bells' low tier drops the dryer vent.
  insert into visit_tasks (visit_id, task_key, name, part_id, appliance_id)
  select x.visit_id, k.key, coalesce(td.name, k.key), private.task_part_id(k.key),
         private.home_appliance_for(x.home_id, k.key)
  from (values
    (v_elena, h_elena, all_tasks),
    (v_david, h_david, all_tasks),
    (v_whit,  h_whit,  all_tasks),
    (v_priya, h_priya, all_tasks),
    (v_bell,  h_bell,  array['hvac', 'fridge', 'ice', 'dish', 'wh', 'smoke'])
  ) as x(visit_id, home_id, keys)
  cross join lateral unnest(x.keys) with ordinality k(key, ord)
  left join task_defaults td on td.task_key = k.key
  order by x.visit_id, k.ord;

  -- The 7-day notice already went out for every visit.
  insert into notices (visit_id, kind, channel, sent_at)
  select v.id, '7d', 'email', v.window_start - interval '7 days'
  from visits v
  order by v.window_start;
end $$;

-- Office: restore the demo scenario.
create or replace function public.reset_demo() returns void
  language plpgsql security definer set search_path = public
  as $$
begin
  perform private.require_role('office');
  perform public.seed_demo();
end $$;

-- ---------------------------------------------------------------------------
-- 12. Privileges
-- ---------------------------------------------------------------------------

-- Private helpers: callable by RLS (authenticated) but not exposed by the Data API.
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.my_role(), private.owned_home_ids(), private.owned_visit_ids(), private.owned_task_ids(),
  private.owned_request_ids(), private.tech_visit_ids(), private.tech_task_ids(), private.tech_home_ids(),
  private.visit_tech_ids(), private.visit_owner_ids(), private.vendor_ids(), private.vendor_categories(),
  private.can_upload_visit_photo(text), private.can_read_visit_photo(text)
  to authenticated;
grant execute on all functions in schema private to service_role;

-- Client RPCs: signed-in users only.
revoke execute on function
  public.confirm_visit(uuid), public.reschedule_visit(uuid), public.advance_visit(uuid),
  public.set_task_done(uuid, boolean), public.add_visit_photo(uuid, text, text), public.complete_visit(uuid),
  public.request_quote(text), public.submit_bid(uuid, numeric, date), public.book_bid(uuid),
  public.send_48h_reminders(), public.set_plan_tier(tier_key, numeric, numeric, numeric, numeric, text[]),
  public.save_home(text, text, int, int, numeric, numeric, int, int, boolean, text),
  public.set_home_appliances(uuid, jsonb),
  public.start_plan(uuid, tier_key, numeric, numeric, numeric, numeric, jsonb),
  public.reset_demo()
  from public, anon;
grant execute on function
  public.confirm_visit(uuid), public.reschedule_visit(uuid), public.advance_visit(uuid),
  public.set_task_done(uuid, boolean), public.add_visit_photo(uuid, text, text), public.complete_visit(uuid),
  public.request_quote(text), public.submit_bid(uuid, numeric, date), public.book_bid(uuid),
  public.send_48h_reminders(), public.set_plan_tier(tier_key, numeric, numeric, numeric, numeric, text[]),
  public.save_home(text, text, int, int, numeric, numeric, int, int, boolean, text),
  public.set_home_appliances(uuid, jsonb),
  public.start_plan(uuid, tier_key, numeric, numeric, numeric, numeric, jsonb),
  public.reset_demo()
  to authenticated;

-- Seeding: database owner (and service role) only.
revoke execute on function public.seed_demo(date), public.ensure_demo_users() from public, anon, authenticated;
