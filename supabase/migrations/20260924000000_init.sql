-- Premium Home Partners: initial schema.
-- Source: design handoff DATA_MODEL.sql, with RLS completed for every table.

create extension if not exists pgcrypto;

create type user_role as enum ('homeowner', 'tech', 'vendor', 'office');
create type visit_status as enum ('scheduled', 'confirmed', 'enroute', 'onsite', 'done', 'canceled');
create type tier_key as enum ('high', 'recommended', 'medium', 'low');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'homeowner',
  full_name text,
  phone text,
  created_at timestamptz default now()
);

-- Role lookup that bypasses RLS on profiles, so policies can call it without recursion.
create function public.auth_role() returns user_role
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() $$;

create table homes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles on delete cascade,
  address text not null,
  geo point,
  sqft int,
  year_built int,
  bedrooms numeric,
  bathrooms numeric,
  floors int,
  hvac_zones int,
  pets boolean default false,
  water text check (water in ('city_hard', 'well', 'softened')),
  exterior_photo_path text,
  created_at timestamptz default now()
);

create table appliance_models (
  id uuid primary key default gen_random_uuid(),
  brand text,
  model text unique,
  category text,
  manual_url text,
  extracted_at timestamptz
);

create table model_tasks (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references appliance_models on delete cascade,
  task_key text,
  name text,
  interval_months numeric,
  part_number text,
  source_url text,
  source_page text
);

create table appliances (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes on delete cascade,
  model_id uuid references appliance_models,
  serial text,
  mfg_date date,
  room text,
  plate_photo_path text
);

create table parts (
  id uuid primary key default gen_random_uuid(),
  part_number text unique,
  description text
);

create table part_prices (
  id bigserial primary key,
  part_id uuid references parts on delete cascade,
  supplier text,
  price numeric(10, 2),
  url text,
  in_stock boolean,
  fetched_at timestamptz default now()
);

create table pricing_settings (
  id int primary key default 1 check (id = 1),
  labor_rate numeric default 94,
  trip_fee numeric default 35,
  parts_markup numeric default 0.25,
  tech_cost numeric default 38,
  vehicle_cost numeric default 12,
  coordination_fee numeric default 0.10
);

create table task_defaults (
  task_key text primary key,
  name text,
  labor_min int,
  freq_high int,
  freq_recommended int,
  freq_medium int,
  freq_low int
);

create table plan_builds (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes on delete cascade,
  status text,
  progress int default 0,
  options jsonb,
  created_at timestamptz default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes on delete cascade,
  tier tier_key not null,
  monthly numeric(10, 2),
  annual numeric(10, 2),
  materials numeric(10, 2),
  labor numeric(10, 2),
  stripe_subscription_id text,
  starts_on date,
  active boolean default true
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references plans on delete cascade,
  home_id uuid references homes on delete cascade,
  tech_id uuid references profiles,
  window_start timestamptz,
  window_end timestamptz,
  status visit_status default 'scheduled',
  confirmed_at timestamptz
);

create table visit_tasks (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits on delete cascade,
  appliance_id uuid references appliances,
  task_key text,
  name text,
  part_id uuid references parts,
  done boolean default false,
  done_at timestamptz,
  notes text
);

create table visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_task_id uuid references visit_tasks on delete cascade,
  kind text check (kind in ('before', 'after', 'drain', 'finding')),
  path text not null,
  taken_at timestamptz default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits on delete cascade unique,
  health_score int,
  findings jsonb,
  published_at timestamptz default now()
);

create table notices (
  id bigserial primary key,
  visit_id uuid references visits on delete cascade,
  kind text check (kind in ('7d', '48h', 'enroute', 'report')),
  channel text,
  sent_at timestamptz default now()
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles on delete cascade,
  company text,
  categories text[],
  rating numeric(2, 1),
  service_radius_mi int,
  stripe_account_id text,
  vetted boolean default false
);

create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes on delete cascade,
  category text,
  scope text,
  status text default 'open' check (status in ('open', 'booked', 'canceled')),
  booked_bid_id uuid,
  created_at timestamptz default now()
);

create table bids (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references quote_requests on delete cascade,
  vendor_id uuid references vendors on delete cascade,
  price numeric(10, 2),
  available_on date,
  created_at timestamptz default now(),
  unique (request_id, vendor_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
create policy self_profile on profiles for select using (id = auth.uid() or auth_role() = 'office');
create policy self_profile_update on profiles for update using (id = auth.uid()) with check (role = (select role from profiles where id = auth.uid()));

alter table homes enable row level security;
create policy owner_homes on homes for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy staff_homes on homes for select using (auth_role() in ('office', 'tech'));

alter table appliances enable row level security;
create policy owner_appliances on appliances for all using (home_id in (select id from homes where owner_id = auth.uid()));
create policy staff_appliances on appliances for select using (auth_role() in ('office', 'tech'));

-- Reference data: readable by any signed-in user, written by office or edge functions (service role).
alter table appliance_models enable row level security;
create policy read_models on appliance_models for select using (auth.uid() is not null);
alter table model_tasks enable row level security;
create policy read_model_tasks on model_tasks for select using (auth.uid() is not null);
alter table parts enable row level security;
create policy read_parts on parts for select using (auth.uid() is not null);
alter table part_prices enable row level security;
create policy read_part_prices on part_prices for select using (auth.uid() is not null);
alter table task_defaults enable row level security;
create policy read_task_defaults on task_defaults for select using (auth.uid() is not null);
create policy office_task_defaults on task_defaults for all using (auth_role() = 'office');
alter table pricing_settings enable row level security;
create policy read_pricing on pricing_settings for select using (auth.uid() is not null);
create policy office_pricing on pricing_settings for update using (auth_role() = 'office');

alter table plan_builds enable row level security;
create policy owner_builds on plan_builds for select using (home_id in (select id from homes where owner_id = auth.uid()));
create policy office_builds on plan_builds for select using (auth_role() = 'office');

alter table plans enable row level security;
create policy owner_plans on plans for select using (home_id in (select id from homes where owner_id = auth.uid()));
create policy office_plans on plans for all using (auth_role() = 'office');

alter table visits enable row level security;
create policy owner_visits on visits for select using (home_id in (select id from homes where owner_id = auth.uid()));
create policy owner_confirm on visits for update using (home_id in (select id from homes where owner_id = auth.uid()));
create policy tech_visits on visits for all using (tech_id = auth.uid());
create policy office_visits on visits for all using (auth_role() = 'office');

alter table visit_tasks enable row level security;
create policy owner_visit_tasks on visit_tasks for select using (visit_id in (select v.id from visits v join homes h on h.id = v.home_id where h.owner_id = auth.uid()));
create policy tech_visit_tasks on visit_tasks for all using (visit_id in (select id from visits where tech_id = auth.uid()));
create policy office_visit_tasks on visit_tasks for all using (auth_role() = 'office');

alter table visit_photos enable row level security;
create policy owner_photos on visit_photos for select using (
  visit_task_id in (select vt.id from visit_tasks vt join visits v on v.id = vt.visit_id join homes h on h.id = v.home_id where h.owner_id = auth.uid()));
create policy tech_photos on visit_photos for all using (
  visit_task_id in (select vt.id from visit_tasks vt join visits v on v.id = vt.visit_id where v.tech_id = auth.uid()));
create policy office_photos on visit_photos for select using (auth_role() = 'office');

alter table reports enable row level security;
create policy owner_reports on reports for select using (visit_id in (select v.id from visits v join homes h on h.id = v.home_id where h.owner_id = auth.uid()));
create policy staff_reports on reports for select using (auth_role() in ('office', 'tech'));

alter table notices enable row level security;
create policy office_notices on notices for select using (auth_role() = 'office');

alter table vendors enable row level security;
create policy self_vendor on vendors for select using (profile_id = auth.uid() or auth_role() = 'office');
create policy office_vendors on vendors for all using (auth_role() = 'office');

alter table quote_requests enable row level security;
create policy owner_requests on quote_requests for all using (home_id in (select id from homes where owner_id = auth.uid())) with check (home_id in (select id from homes where owner_id = auth.uid()));
-- Vendors see open requests in their categories. The client must only select the street + ZIP from homes (never the owner profile).
create policy vendor_requests on quote_requests for select using (
  exists (select 1 from vendors v where v.profile_id = auth.uid() and v.vetted and quote_requests.category = any (v.categories)));
create policy office_requests on quote_requests for all using (auth_role() = 'office');

alter table bids enable row level security;
create policy vendor_bids on bids for all using (vendor_id in (select id from vendors where profile_id = auth.uid()));
create policy owner_bids on bids for select using (request_id in (select q.id from quote_requests q join homes h on h.id = q.home_id where h.owner_id = auth.uid()));
create policy office_bids on bids for select using (auth_role() = 'office');

-- Realtime for the live surfaces (tech status, checklist, bids, plan build progress).
alter publication supabase_realtime add table visits, visit_tasks, quote_requests, bids, plan_builds;

-- Storage bucket for tech photos: visit-photos/{visit_id}/{task_id}/{before|after}.jpg
insert into storage.buckets (id, name, public) values ('visit-photos', 'visit-photos', false) on conflict do nothing;

-- New auth users get a homeowner profile by default; office promotes techs/vendors.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$ begin insert into profiles (id, full_name, phone) values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
