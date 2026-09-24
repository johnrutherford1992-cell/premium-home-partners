-- Premium Home Partners — Supabase schema (outline)
create type user_role as enum ('homeowner','tech','vendor','office');
create type visit_status as enum ('scheduled','confirmed','enroute','onsite','done','canceled');
create type tier_key as enum ('high','recommended','medium','low');

create table profiles (id uuid primary key references auth.users, role user_role not null, full_name text, phone text, created_at timestamptz default now());

create table homes (
  id uuid primary key default gen_random_uuid(), owner_id uuid references profiles not null,
  address text not null, geo point, sqft int, year_built int, bedrooms numeric, bathrooms numeric,
  floors int, hvac_zones int, pets boolean default false, water text check (water in ('city_hard','well','softened')),
  exterior_photo_path text, created_at timestamptz default now());

create table appliance_models (
  id uuid primary key default gen_random_uuid(), brand text, model text unique, category text,
  manual_url text, extracted_at timestamptz);

create table model_tasks (
  id uuid primary key default gen_random_uuid(), model_id uuid references appliance_models,
  task_key text, name text, interval_months numeric, part_number text, source_url text, source_page text);

create table appliances (
  id uuid primary key default gen_random_uuid(), home_id uuid references homes on delete cascade,
  model_id uuid references appliance_models, serial text, mfg_date date, room text, plate_photo_path text);

create table parts (id uuid primary key default gen_random_uuid(), part_number text unique, description text);
create table part_prices (id bigserial primary key, part_id uuid references parts, supplier text, price numeric(10,2), url text, in_stock boolean, fetched_at timestamptz default now());

create table pricing_settings (id int primary key default 1, labor_rate numeric default 94, trip_fee numeric default 35, parts_markup numeric default 0.25, tech_cost numeric default 38, vehicle_cost numeric default 12, coordination_fee numeric default 0.10);
create table task_defaults (task_key text primary key, name text, labor_min int, freq_high int, freq_recommended int, freq_medium int, freq_low int);

create table plan_builds (id uuid primary key default gen_random_uuid(), home_id uuid references homes, status text, progress int default 0, options jsonb, created_at timestamptz default now());

create table plans (
  id uuid primary key default gen_random_uuid(), home_id uuid references homes, tier tier_key not null,
  monthly numeric(10,2), annual numeric(10,2), materials numeric(10,2), labor numeric(10,2),
  stripe_subscription_id text, starts_on date, active boolean default true);

create table visits (
  id uuid primary key default gen_random_uuid(), plan_id uuid references plans, home_id uuid references homes,
  tech_id uuid references profiles, window_start timestamptz, window_end timestamptz,
  status visit_status default 'scheduled', confirmed_at timestamptz);

create table visit_tasks (
  id uuid primary key default gen_random_uuid(), visit_id uuid references visits on delete cascade,
  appliance_id uuid references appliances, task_key text, name text, part_id uuid references parts,
  done boolean default false, done_at timestamptz, notes text);

create table visit_photos (id uuid primary key default gen_random_uuid(), visit_task_id uuid references visit_tasks on delete cascade, kind text check (kind in ('before','after','drain','finding')), path text not null, taken_at timestamptz default now());

create table reports (id uuid primary key default gen_random_uuid(), visit_id uuid references visits unique, health_score int, findings jsonb, published_at timestamptz default now());

create table notices (id bigserial primary key, visit_id uuid references visits, kind text check (kind in ('7d','48h','enroute','report')), channel text, sent_at timestamptz default now());

create table vendors (id uuid primary key default gen_random_uuid(), profile_id uuid references profiles, company text, categories text[], rating numeric(2,1), service_radius_mi int, stripe_account_id text, vetted boolean default false);

create table quote_requests (id uuid primary key default gen_random_uuid(), home_id uuid references homes, category text, scope text, status text default 'open' check (status in ('open','booked','canceled')), booked_bid_id uuid, created_at timestamptz default now());
create table bids (id uuid primary key default gen_random_uuid(), request_id uuid references quote_requests on delete cascade, vendor_id uuid references vendors, price numeric(10,2), available_on date, created_at timestamptz default now(), unique (request_id, vendor_id));

-- RLS outline
alter table homes enable row level security;
create policy owner_homes on homes for all using (owner_id = auth.uid());
create policy staff_homes on homes for select using ((select role from profiles where id = auth.uid()) in ('office','tech'));
alter table visits enable row level security;
create policy owner_visits on visits for select using (home_id in (select id from homes where owner_id = auth.uid()));
create policy tech_visits on visits for all using (tech_id = auth.uid());
alter table bids enable row level security;
create policy vendor_bids on bids for all using (vendor_id in (select id from vendors where profile_id = auth.uid()));
-- Vendors see quote_requests only for their categories and radius, and see only the street + ZIP (never the full owner profile).
