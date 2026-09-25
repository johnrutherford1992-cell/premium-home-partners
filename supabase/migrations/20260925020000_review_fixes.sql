-- Premium Home Partners: fixes from the live-backend review.
-- Applies on top of 20260925000000_live.sql. Idempotent where practical.
--
--   1. Booking money moves out of quote_requests into quote_bookings (owner +
--      office only), so a vendor can no longer divide a booked request's
--      coordination_fee by pricing_settings.coordination_fee to get a rival's
--      winning price. Vendors now see a request only while it is open, or when
--      they bid on it (enough for "Won" / "Not selected").
--   2. set_plan_tier / start_plan accept only task keys from task_defaults
--      (deduped, at most 7 per visit, names always from task_defaults), and
--      start_plan rejects month offsets outside the plan year.
--   3. visit_tasks.appliance_id is ON DELETE SET NULL (deleting a home or user
--      no longer fails); seed_demo and the onboarding RPCs share an advisory
--      lock, so a reset can't interleave with onboarding; set_home_appliances
--      never re-links tasks on visits that have started.
--   4. One 7d / 48h / report notice per visit (unique index + ON CONFLICT DO
--      NOTHING), so concurrent send_48h_reminders calls can't duplicate.
--   5. confirm_visit only confirms a visit that hasn't started.
--   6. handle_new_user copies auth.users.email into profiles.email.
--   7. Model numbers normalize like the edge functions (_shared/appliance.ts
--      normModel): uppercase, without whitespace, hyphens or Unicode dashes.
--
-- Function signatures, SECURITY DEFINER, search_path and grants are unchanged.
--
-- Supabase advisors after applying this file to the hosted project: nothing new
-- on security (the same 15 expected lint-0029 RPCs as before). On performance,
-- quote_bookings joins the accepted lint 0006 "multiple permissive policies"
-- pattern (owner_bookings + office_bookings, one policy per audience).

-- ---------------------------------------------------------------------------
-- 7. Model-number normalization (before anything that uses it)
-- ---------------------------------------------------------------------------

-- Case-, space- and dash-insensitive model number. Same separators as
-- normModel() in supabase/functions/_shared/appliance.ts: whitespace,
-- hyphen-minus, U+2010..U+2015 and U+2212. The last three are written as the
-- literal characters (a range U+2010-U+2015, then U+2212), exactly as applied
-- to the hosted project.
create or replace function private.norm_model(p_model text) returns text
  language sql immutable set search_path = public
  as $$ select upper(regexp_replace(coalesce(p_model, ''), '[\s\-‐-―−]+', '', 'g')) $$;

-- The index follows the function (rebuilt because the expression changed).
drop index if exists public.appliance_models_norm_model_idx;
create index appliance_models_norm_model_idx on public.appliance_models (private.norm_model(model));

-- ---------------------------------------------------------------------------
-- 3a. visit_tasks.appliance_id: ON DELETE SET NULL
-- ---------------------------------------------------------------------------

alter table public.visit_tasks drop constraint if exists visit_tasks_appliance_id_fkey;
alter table public.visit_tasks
  add constraint visit_tasks_appliance_id_fkey foreign key (appliance_id)
  references public.appliances (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4a. One 7d / 48h / report notice per visit
-- ---------------------------------------------------------------------------

-- Keep the earliest of any duplicates, then enforce it.
delete from public.notices n
using public.notices m
where n.visit_id = m.visit_id
  and n.kind = m.kind
  and n.kind in ('7d', '48h', 'report')
  and n.id > m.id;

create unique index if not exists notices_one_per_visit_kind
  on public.notices (visit_id, kind) where kind in ('7d', '48h', 'report');

-- ---------------------------------------------------------------------------
-- 1a. quote_bookings: the booked bid's money, owner + office only
-- ---------------------------------------------------------------------------

create table if not exists public.quote_bookings (
  request_id uuid primary key references public.quote_requests on delete cascade,
  bid_id uuid not null references public.bids on delete cascade,
  coordination_fee numeric(10, 2) not null,
  booked_at timestamptz not null default now()
);
create index if not exists quote_bookings_bid_id_idx on public.quote_bookings (bid_id);

-- Existing bookings move over, then the columns vendors could read go away.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'quote_requests' and column_name = 'coordination_fee') then
    execute $sql$
      insert into public.quote_bookings (request_id, bid_id, coordination_fee, booked_at)
      select q.id, q.booked_bid_id,
             coalesce(q.coordination_fee,
                      round(coalesce(b.price, 0) * coalesce((select s.coordination_fee from public.pricing_settings s where s.id = 1), 0.10), 2)),
             coalesce(q.booked_at, q.created_at, now())
      from public.quote_requests q
      join public.bids b on b.id = q.booked_bid_id
      where q.status = 'booked'
      on conflict (request_id) do nothing
    $sql$;
  end if;
end $$;

alter table public.quote_requests
  drop column if exists coordination_fee,
  drop column if exists booked_at;

alter table public.quote_bookings enable row level security;

drop policy if exists owner_bookings on public.quote_bookings;
drop policy if exists office_bookings on public.quote_bookings;
create policy owner_bookings on public.quote_bookings for select to authenticated
  using (request_id in (select private.owned_request_ids()));
create policy office_bookings on public.quote_bookings for select to authenticated
  using ((select private.my_role()) = 'office');

-- Written only by book_bid (security definer). RLS already refuses client
-- writes; TRUNCATE bypasses RLS, so take write privileges away as well.
revoke insert, update, delete, truncate on public.quote_bookings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Vendors: open requests in their categories, plus the ones they bid on
-- ---------------------------------------------------------------------------

-- Requests the caller (as a vendor) has bid on.
create or replace function private.vendor_bid_request_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$
  select b.request_id from bids b join vendors v on v.id = b.vendor_id
  where v.profile_id = auth.uid() and b.request_id is not null
$$;

revoke execute on function private.vendor_bid_request_ids() from public, anon;
grant execute on function private.vendor_bid_request_ids() to authenticated, service_role;

drop policy if exists vendor_requests on public.quote_requests;
create policy vendor_requests on public.quote_requests for select to authenticated
  using (category = any (array(select unnest(private.vendor_categories())))
         and (status = 'open' or id in (select private.vendor_bid_request_ids())));

-- ---------------------------------------------------------------------------
-- 1c. Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_bookings') then
    alter publication supabase_realtime add table public.quote_bookings;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. handle_new_user: also copy the email
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
begin
  insert into profiles (id, full_name, phone, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone, new.email);
  return new;
end $$;

-- Profiles created before this fix.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null and u.email is not null;

-- ---------------------------------------------------------------------------
-- RPCs (full bodies from 20260925000000_live.sql, changes marked "Review fix")
-- ---------------------------------------------------------------------------

-- Owner confirms a visit that hasn't started.
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
  -- Review fix 5: nothing to confirm once the technician is on the way.
  if v_visit.status not in ('scheduled', 'confirmed') then
    raise exception '%', case v_visit.status
        when 'done' then 'This visit is already complete.'
        when 'canceled' then 'This visit was canceled.'
        else 'This visit is already under way.'
      end
      using errcode = 'P0001';
  end if;
  update visits set confirmed_at = coalesce(confirmed_at, now()) where id = v_visit.id;
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
  -- Review fix 4: one report notice per visit.
  insert into notices (visit_id, kind, channel) values (v_visit.id, 'report', 'push')
  on conflict do nothing;
  return v_report;
end $$;

-- Owner books a bid. First booking wins. The fee is recorded in quote_bookings.
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
  -- Review fix 1: the money goes to quote_bookings, which vendors can't read.
  -- The request row is locked and still open, so any existing booking row is stale.
  insert into quote_bookings (request_id, bid_id, coordination_fee, booked_at)
  values (v_req.id, v_bid.id, round(coalesce(v_bid.price, 0) * coalesce(v_fee, 0.10), 2), now())
  on conflict (request_id) do update
  set bid_id = excluded.bid_id, coordination_fee = excluded.coordination_fee, booked_at = excluded.booked_at;
  update quote_requests
  set status = 'booked',
      booked_bid_id = v_bid.id
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
  -- Review fix 4: the unique index settles concurrent calls; only rows actually inserted are counted.
  with ins as (
    insert into notices (visit_id, kind, channel)
    select v.id, '48h', 'push'
    from visits v
    where v.status not in ('done', 'canceled')
      and v.window_start >= private.chicago_at(private.chicago_today(), time '00:00')
      and v.window_start < now() + interval '7 days'
      and not exists (select 1 from notices n where n.visit_id = v.id and n.kind = '48h')
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_count from ins;
  return v_count;
end $$;

-- Owner switches tier. The current visit's checklist follows when nothing has started.
-- Prices are stored as sent: nothing reads plans.monthly/annual for money yet.
-- Billing must compute prices server-side (packages/pricing + pricing_settings), never trust these.
create or replace function public.set_plan_tier(
  p_tier tier_key, p_monthly numeric, p_annual numeric, p_materials numeric, p_labor numeric, p_next_tasks text[]
) returns plans
  language plpgsql security definer set search_path = public
  as $$
declare
  v_plan plans;
  v_visit visits;
  v_keys text[];
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

  -- Review fix 2: only real task keys, first occurrence wins, at most 7.
  v_keys := array(
    select k.key from (
      select td.task_key as key, min(u.ord) as ord
      from unnest(coalesce(p_next_tasks, '{}'::text[])) with ordinality u(key, ord)
      join task_defaults td on td.task_key = u.key
      group by td.task_key
    ) k
    order by k.ord
    limit 7
  );

  select * into v_visit from visits where id = private.current_visit_id(v_plan.home_id) for update;
  if found
     and v_visit.status in ('scheduled', 'confirmed')
     and cardinality(v_keys) > 0
     and not exists (select 1 from visit_tasks where visit_id = v_visit.id and done) then
    delete from visit_tasks where visit_id = v_visit.id;
    insert into visit_tasks (visit_id, task_key, name, part_id, appliance_id)
    select v_visit.id, td.task_key, coalesce(td.name, td.task_key), private.task_part_id(td.task_key),
           private.home_appliance_for(v_visit.home_id, td.task_key)
    from unnest(v_keys) with ordinality k(key, ord)
    join task_defaults td on td.task_key = k.key
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
  -- Review fix 3: a demo reset (seed_demo, exclusive) never interleaves with onboarding.
  perform pg_advisory_xact_lock_shared(hashtextextended('php:demo-data', 0));
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
  -- Review fix 3: a demo reset (seed_demo, exclusive) never interleaves with onboarding.
  perform pg_advisory_xact_lock_shared(hashtextextended('php:demo-data', 0));
  select * into v_home from homes where id = p_home and owner_id = auth.uid() for update;
  if not found then
    raise exception 'We couldn''t find that home.' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Something''s off with that appliance list. Try again.' using errcode = 'P0001';
  end if;
  -- (The foreign key is ON DELETE SET NULL too; done visits lose the link, never gain a new one.)
  update visit_tasks set appliance_id = null
  where appliance_id in (select id from appliances where home_id = v_home.id);
  delete from appliances where home_id = v_home.id;
  insert into appliances (home_id, model_id, model, serial, brand, name)
  select v_home.id,
         -- Review fix 7: same normalization as the edge functions.
         (select m.id from appliance_models m
          where private.norm_model(m.model) = private.norm_model(e.item ->> 'model')
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
  -- Review fix 3: only on visits that haven't started; never rewrite done visits.
  update visit_tasks vt set appliance_id = private.home_appliance_for(v_home.id, vt.task_key)
  from visits v
  where v.id = vt.visit_id and v.home_id = v_home.id and vt.appliance_id is null
    and v.status in ('scheduled', 'confirmed');
  return v_count;
end $$;

-- Owner starts a plan: deactivates old plans, creates the year of visits from the schedule.
-- Prices are stored as sent: nothing reads plans.monthly/annual for money yet.
-- Billing must compute prices server-side (packages/pricing + pricing_settings), never trust these.
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
  -- Review fix 3: a demo reset (seed_demo, exclusive) never interleaves with onboarding.
  perform pg_advisory_xact_lock_shared(hashtextextended('php:demo-data', 0));
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
  -- Review fix 2: every visit falls inside the plan year.
  if exists (
    select 1 from jsonb_array_elements(p_schedule) e(item)
    where jsonb_typeof(e.item -> 'month_offset') = 'number'
      and ((e.item ->> 'month_offset')::numeric < 0 or (e.item ->> 'month_offset')::numeric >= 12)
  ) then
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
    -- Review fix 2: only real task keys, first occurrence wins, at most 7.
    v_keys := array(
      select x.k from (
        select td.task_key as k, min(t.o) as o
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_entry.item -> 'task_keys') = 'array' then v_entry.item -> 'task_keys' else '[]'::jsonb end
        ) with ordinality t(k, o)
        join task_defaults td on td.task_key = t.k
        group by td.task_key
      ) x
      order by x.o
      limit 7
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
    select v_visit_id, td.task_key, coalesce(td.name, td.task_key), private.task_part_id(td.task_key),
           private.home_appliance_for(v_home.id, td.task_key)
    from unnest(v_keys) with ordinality k(key, ord)
    join task_defaults td on td.task_key = k.key
    order by k.ord;

    if v_entry.ord = 1 then
      insert into notices (visit_id, kind, channel) values (v_visit_id, '7d', 'email')
      on conflict do nothing;
    end if;
  end loop;

  return v_plan;
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
  -- Review fix 3: wait for in-flight onboarding (save_home, set_home_appliances,
  -- start_plan hold this lock shared) and keep new onboarding out until the reset commits.
  perform pg_advisory_xact_lock(hashtextextended('php:demo-data', 0));

  -- Best effort: the demo logins exist and their profiles are restored.
  begin
    perform public.ensure_demo_users();
  exception when others then
    raise notice 'ensure_demo_users skipped: %', sqlerrm;
  end;

  -- 1. Transactional rows (WHERE true keeps safeupdate happy when called through the API).
  delete from quote_bookings where true;
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
  order by v.window_start
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges (unchanged from 20260925000000_live.sql; restated so a replaced
-- function can never widen them)
-- ---------------------------------------------------------------------------

revoke execute on function private.norm_model(text) from public, anon;
grant execute on function private.norm_model(text) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function
  public.confirm_visit(uuid), public.complete_visit(uuid), public.book_bid(uuid), public.send_48h_reminders(),
  public.set_plan_tier(tier_key, numeric, numeric, numeric, numeric, text[]),
  public.save_home(text, text, int, int, numeric, numeric, int, int, boolean, text),
  public.set_home_appliances(uuid, jsonb),
  public.start_plan(uuid, tier_key, numeric, numeric, numeric, numeric, jsonb)
  from public, anon;
grant execute on function
  public.confirm_visit(uuid), public.complete_visit(uuid), public.book_bid(uuid), public.send_48h_reminders(),
  public.set_plan_tier(tier_key, numeric, numeric, numeric, numeric, text[]),
  public.save_home(text, text, int, int, numeric, numeric, int, int, boolean, text),
  public.set_home_appliances(uuid, jsonb),
  public.start_plan(uuid, tier_key, numeric, numeric, numeric, numeric, jsonb)
  to authenticated;

revoke execute on function public.seed_demo(date) from public, anon, authenticated;
