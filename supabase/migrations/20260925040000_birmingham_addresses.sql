-- Birmingham, Alabama demo addresses.
--
-- Premium Home Partners is based in Birmingham (2601 Highland Park Avenue
-- South, 35205), so the seeded clients now live in Birmingham and its
-- neighbors instead of Dallas. Street names, house details and everything
-- else in the scenario are unchanged; only city, state and ZIP move:
--
--   Elena Alvarez     12 Linden Court      Mountain Brook, AL 35213
--   David Okafor      4410 Bryn Mawr Dr    Homewood, AL 35209
--   The Whitfields    88 Beverly Dr        Mountain Brook, AL 35223
--   Priya Shah        17 Stonebridge Dr    Vestavia Hills, AL 35216
--   Mark & Jo Bell    203 Lakewood Blvd    Birmingham, AL 35205
--
-- seed_demo below is 20260925020000_review_fixes.sql's definition with only
-- those five address literals changed. Addresses are data, so run
-- `select seed_demo();` (or Office -> Reset demo data) after applying.

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
    (h_elena, u_elena, '12 Linden Court, Mountain Brook, AL 35213', 3420, 2006, 4, 3.5, 2, 2, true,  'city_hard',
     'Gate code 4471. Heater in garage, back left.', now()),
    (h_david, u_david, '4410 Bryn Mawr Dr, Homewood, AL 35209',    2850, 1998, 4, 3,   2, 2, false, 'city_hard',
     'Side gate latch sticks. Furnace in the attic.', now()),
    (h_whit,  u_whit,  '88 Beverly Dr, Mountain Brook, AL 35223',    5200, 1989, 5, 4.5, 2, 3, true,  'softened',
     'Two friendly dogs. Park in the circle drive.', now()),
    (h_priya, u_priya, '17 Stonebridge Dr, Vestavia Hills, AL 35216', 2100, 2015, 3, 2.5, 2, 1, false, 'well',
     'Ring the side door. Water heater in the utility closet.', now()),
    (h_bell,  u_bell,  '203 Lakewood Blvd, Birmingham, AL 35205',   2600, 1952, 3, 2,   1, 1, false, 'city_hard',
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

-- create or replace keeps the existing grants; restated so this file stands alone.
revoke execute on function public.seed_demo(date) from public, anon, authenticated;
