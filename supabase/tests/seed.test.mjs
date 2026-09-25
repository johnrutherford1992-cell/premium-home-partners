// Demo accounts and scenario (docs/LIVE_ARCHITECTURE.md §6).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { HOME, SEED_COUNTS, U, VENDOR, VISIT, count, counts, createDb, one, rows } from './harness.mjs';

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

describe('seed', () => {
  test('seed.sql produces the expected row counts', async () => {
    assert.deepEqual(await counts(db), SEED_COUNTS);
  });

  test('seed_demo twice and ensure_demo_users twice yield identical counts', async () => {
    const before = await counts(db);
    await db.exec('select public.seed_demo(); select public.seed_demo(); select public.ensure_demo_users(); select public.ensure_demo_users();');
    assert.deepEqual(await counts(db), before);
    // Running the whole seed file again is also a no-op on counts.
    await db.exec('select public.ensure_demo_users(); select public.seed_demo();');
    assert.deepEqual(await counts(db), SEED_COUNTS);
  });

  test('seed_demo with a fixed date is deterministic', async () => {
    await db.query(`select public.seed_demo('2026-10-14')`);
    const v = await rows(db, `
      select id, tech_id,
             to_char(window_start at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI') as s,
             to_char(window_end at time zone 'America/Chicago', 'HH24:MI') as e,
             confirmed_at is not null as confirmed, status
      from visits order by window_start`);
    assert.deepEqual(v, [
      { id: VISIT.elena, tech_id: U.marcus, s: '2026-10-14 09:00', e: '11:00', confirmed: false, status: 'scheduled' },
      { id: VISIT.david, tech_id: U.marcus, s: '2026-10-14 12:00', e: '14:00', confirmed: true, status: 'scheduled' },
      { id: VISIT.whit, tech_id: U.marcus, s: '2026-10-14 15:00', e: '17:00', confirmed: true, status: 'scheduled' },
      { id: VISIT.priya, tech_id: U.dana, s: '2026-10-15 09:00', e: '11:00', confirmed: false, status: 'scheduled' },
      { id: VISIT.bell, tech_id: U.dana, s: '2026-10-16 10:00', e: '12:00', confirmed: true, status: 'scheduled' },
    ]);
    const slots = (await one(db, 'select offered_slots from visits where id = $1', [VISIT.elena])).offered_slots;
    assert.deepEqual(slots, [
      { start: '2026-10-14T14:00:00Z', end: '2026-10-14T16:00:00Z' },
      { start: '2026-10-15T18:00:00Z', end: '2026-10-15T20:00:00Z' },
      { start: '2026-10-17T13:00:00Z', end: '2026-10-17T15:00:00Z' },
    ]);
    await db.query('select public.seed_demo()');
  });
});

describe('demo accounts', () => {
  test('ten users, all with password phpdemo2026, confirmed, with email identities', async () => {
    const users = await rows(db, `
      select email from auth.users
      where encrypted_password = extensions.crypt('phpdemo2026', encrypted_password)
        and email_confirmed_at is not null and aud = 'authenticated' and role = 'authenticated'
        and instance_id = '00000000-0000-0000-0000-000000000000'
        and raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb
      order by email`);
    assert.deepEqual(users.map((u) => u.email), [
      'bell@php.test', 'dana@php.test', 'david@php.test', 'homeowner@php.test', 'newhome@php.test', 'office@php.test',
      'priya@php.test', 'tech@php.test', 'vendor@php.test', 'whitfield@php.test',
    ]);
    assert.equal(await count(db, 'auth.identities', `provider = 'email' and provider_id = user_id::text
      and identity_data ->> 'sub' = user_id::text and (identity_data ->> 'email_verified')::boolean`), 10);
  });

  test('GoTrue string columns are empty strings, never NULL', async () => {
    const cols = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'phone_change',
      'phone_change_token', 'email_change_token_current', 'reauthentication_token'];
    for (const c of cols) assert.equal(await count(db, 'auth.users', `${c} is null`), 0, c);
  });

  test('profiles carry role, name, email, title and vehicle', async () => {
    const p = await rows(db, 'select id, role, full_name, email, title, vehicle from profiles order by id');
    assert.deepEqual(p.map((r) => [r.role, r.full_name, r.email]), [
      ['office', 'Avery Brooks', 'office@php.test'],
      ['tech', 'Marcus Reyes', 'tech@php.test'],
      ['tech', 'Dana Liu', 'dana@php.test'],
      ['vendor', 'Sam Ortiz', 'vendor@php.test'],
      ['homeowner', 'Elena Alvarez', 'homeowner@php.test'],
      ['homeowner', 'Jordan Lee', 'newhome@php.test'],
      ['homeowner', 'David Okafor', 'david@php.test'],
      ['homeowner', 'The Whitfields', 'whitfield@php.test'],
      ['homeowner', 'Priya Shah', 'priya@php.test'],
      ['homeowner', 'Mark & Jo Bell', 'bell@php.test'],
    ]);
    assert.deepEqual(p[1].title, 'Senior technician · 4.9 · 212 visits');
    assert.deepEqual(p[1].vehicle, 'Silver Transit van · PHP-214');
    assert.deepEqual(p[2].title, 'Technician · 4.8 · 96 visits');
  });

  test('handle_new_user still fires for the auth service role after its EXECUTE was revoked', async () => {
    const id = '0f000000-0000-4000-8000-000000000001';
    await db.transaction(async (tx) => {
      await tx.exec('set local role auth_admin');
      await tx.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'x@php.test', '{"full_name":"X"}')`, [id]);
    });
    assert.deepEqual(await one(db, 'select role, full_name from profiles where id = $1', [id]), { role: 'homeowner', full_name: 'X' });
    await db.query('delete from auth.users where id = $1', [id]);
  });
});

describe('scenario', () => {
  test('Elena: home, five cached appliances, recommended plan, all seven tasks, unconfirmed', async () => {
    const h = await one(db, 'select * from homes where id = $1', [HOME.elena]);
    assert.equal(h.owner_id, U.elena);
    assert.equal(h.address, '12 Linden Court, Dallas, TX 75205');
    assert.deepEqual([h.sqft, h.year_built, Number(h.bedrooms), Number(h.bathrooms), h.floors, h.hvac_zones, h.pets, h.water],
      [3420, 2006, 4, 3.5, 2, 2, true, 'city_hard']);
    assert.equal(h.notes, 'Gate code 4471. Heater in garage, back left.');
    const a = await rows(db, `select a.name, a.model, a.serial, m.id is not null as cached from appliances a
                              left join appliance_models m on m.id = a.model_id where a.home_id = $1 order by a.name`, [HOME.elena]);
    assert.equal(a.length, 5);
    assert.ok(a.every((x) => x.cached));
    const plan = await one(db, 'select tier, monthly, annual, materials, labor, active from plans where home_id = $1', [HOME.elena]);
    assert.deepEqual({ ...plan, monthly: Number(plan.monthly), annual: Number(plan.annual), materials: Number(plan.materials), labor: Number(plan.labor) },
      { tier: 'recommended', monthly: 137.58, annual: 1651.01, materials: 798.68, labor: 852.33, active: true });
    const tasks = await rows(db, 'select task_key, name, done from visit_tasks where visit_id = $1 order by task_key', [VISIT.elena]);
    assert.deepEqual(tasks.map((t) => t.task_key), ['dish', 'dryer', 'fridge', 'hvac', 'ice', 'smoke', 'wh']);
    assert.ok(tasks.every((t) => !t.done));
    assert.equal(tasks.find((t) => t.task_key === 'hvac').name, 'Replace HVAC filters ×2');
  });

  test('plans and baselines for the other clients', async () => {
    const p = await rows(db, `
      select h.owner_id, pl.tier, pl.monthly::text, (select count(*)::int from visit_tasks t join visits v on v.id = t.visit_id where v.home_id = h.id) as tasks
      from plans pl join homes h on h.id = pl.home_id order by h.owner_id`);
    assert.deepEqual(p, [
      { owner_id: U.elena, tier: 'recommended', monthly: '137.58', tasks: 7 },
      { owner_id: U.david, tier: 'medium', monthly: '99.89', tasks: 7 },
      { owner_id: U.whit, tier: 'high', monthly: '186.79', tasks: 7 },
      { owner_id: U.priya, tier: 'recommended', monthly: '110.51', tasks: 7 },
      { owner_id: U.bell, tier: 'low', monthly: '50.91', tasks: 6 },
    ]);
    assert.equal(await count(db, 'visit_tasks', `visit_id = $1 and task_key = 'dryer'`, [VISIT.bell]), 0);
  });

  test('every seeded visit already has its 7-day email notice, and nothing else', async () => {
    assert.equal(await count(db, 'notices', `kind = '7d' and channel = 'email'`), 5);
    assert.equal(await count(db, 'notices', `kind <> '7d'`), 0);
    assert.equal(await count(db, 'visits v', `not exists (select 1 from notices n where n.visit_id = v.id and n.kind = '7d')`), 0);
  });

  test('reference data: lowest in-stock part prices match packages/pricing TASKS costs', async () => {
    const lowest = await rows(db, `
      select p.part_number, min(pp.price)::text as price, count(distinct pp.supplier)::int as suppliers
      from parts p join part_prices pp on pp.part_id = p.id and pp.in_stock
      group by p.part_number order by p.part_number`);
    const byPart = Object.fromEntries(lowest.map((r) => [r.part_number, r.price]));
    assert.equal(byPart['16x25x4-MERV11'], '76.80');
    assert.equal(byPart.LT1000P, '49.97');
    assert.equal(byPart['ICE-SANI'], '8.50');
    assert.equal(byPart['AFFRESH-DW'], '4.20');
    assert.equal(byPart['WH-DRAIN'], '6.00');
    assert.equal(byPart['9V'], '12.00');
    assert.equal((await one(db, 'select count(distinct supplier)::int as n from part_prices')).n, 5);
    const mt = await rows(db, `select m.model, mt.task_key, mt.interval_months::int as every, mt.part_number
                               from model_tasks mt join appliance_models m on m.id = mt.model_id order by m.model, mt.task_key`);
    assert.deepEqual(mt, [
      { model: '59TN6B100V21', task_key: 'hvac', every: 2, part_number: '16x25x4-MERV11' },
      { model: 'LRMVS3006S', task_key: 'fridge', every: 6, part_number: 'LT1000P' },
      { model: 'LRMVS3006S', task_key: 'ice', every: 6, part_number: 'ICE-SANI' },
      { model: 'SHPM88Z75N', task_key: 'dish', every: 1, part_number: 'AFFRESH-DW' },
      { model: 'WED5620HW', task_key: 'dryer', every: 12, part_number: null },
      { model: 'XE50T10H45U0', task_key: 'wh', every: 6, part_number: 'WH-DRAIN' },
    ]);
  });

  test('vendors: Evergreen (Sam), Summit, Clearview — vetted, all six categories', async () => {
    const v = await rows(db, 'select id, profile_id, company, rating::text, vetted, categories from vendors order by id');
    assert.deepEqual(v.map((x) => [x.id, x.profile_id, x.company, x.rating, x.vetted]), [
      [VENDOR.evergreen, U.sam, 'Evergreen Outdoor Co.', '4.9', true],
      [VENDOR.summit, null, 'Summit Pro Services', '4.8', true],
      [VENDOR.clearview, null, 'Clearview & Sons', '4.7', true],
    ]);
    for (const x of v) assert.deepEqual([...x.categories].sort(), ['land', 'lawn', 'lights', 'press', 'tree', 'win']);
  });

  test('pricing defaults', async () => {
    const s = await one(db, 'select labor_rate::float, trip_fee::float, parts_markup::float, tech_cost::float, vehicle_cost::float, coordination_fee::float from pricing_settings');
    assert.deepEqual(Object.values(s), [94, 35, 0.25, 38, 12, 0.1]);
    const td = await rows(db, 'select task_key, labor_min, freq_high, freq_recommended, freq_medium, freq_low from task_defaults order by task_key');
    assert.deepEqual(td.map((r) => [r.task_key, r.labor_min, r.freq_high, r.freq_recommended, r.freq_medium, r.freq_low]), [
      ['dish', 15, 12, 6, 4, 2], ['dryer', 30, 2, 1, 1, 0], ['fridge', 10, 2, 2, 2, 1], ['hvac', 20, 6, 6, 4, 2],
      ['ice', 25, 4, 2, 2, 1], ['smoke', 10, 4, 2, 2, 1], ['wh', 40, 2, 2, 1, 1],
    ]);
  });
});
