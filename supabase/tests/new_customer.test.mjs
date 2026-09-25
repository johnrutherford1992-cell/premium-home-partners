// "New customer" sign-up (supabase/migrations/20260925030000_new_customer.sql):
// start_new_customer resets Jordan Lee (newhome@php.test) to a brand-new
// customer. Only Jordan can call it, it removes only Jordan's rows, and a demo
// reset restores his profile.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { HOME, SEED_COUNTS, TABLES, U, VENDOR, VISIT, as, asAnon, count, counts, createDb, one, rows, rpc } from './harness.mjs';

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

const reset = () => as(db, U.office, (tx) => rpc(tx, 'reset_demo'));
const call = (userId, fn, args) => as(db, userId, (tx) => rpc(tx, fn, args));
/** start_new_customer returns void, so it isn't wrapped in to_jsonb like harness rpc(). */
const startNew = (userId, fullName, phone = null) =>
  as(db, userId, (tx) => tx.query('select public.start_new_customer(p_full_name => $1, p_phone => $2)', [fullName, phone]));
const fails = (promise, message) => assert.rejects(promise, (e) => {
  assert.equal(e.message, message);
  assert.equal(e.code, 'P0001');
  return true;
});
const profile = (id) => one(db, 'select full_name, phone from profiles where id = $1', [id]);

const NO_ACCESS = "You don't have access to that.";

const homeArgs = {
  p_full_name: 'Jordan Lee', p_address: '45 Maple Ave, Homewood, AL 35209', p_sqft: 1800, p_year: 2001, p_beds: 3, p_baths: 2,
  p_floors: 1, p_zones: 1, p_pets: false, p_water: 'city_hard',
};
const schedule = [
  { month_offset: 0, task_keys: ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'] },
  { month_offset: 4, task_keys: ['hvac', 'dish'] },
];

/**
 * Jordan finishes onboarding and uses everything that hangs off a home: a
 * plan build, a plan with visits, tasks and notices, a photo and a report on
 * his first visit, and a booked add-on quote (bids + booking).
 */
async function onboardJordan() {
  const home = await call(U.jordan, 'save_home', homeArgs);
  await call(U.jordan, 'set_home_appliances', {
    p_home: home.id,
    p_items: [{ model: '59TN6B100V21', serial: 'S1', brand: 'CARRIER', name: 'Carrier Infinity furnace' }],
  });
  await db.query(`insert into plan_builds (home_id, status, progress, step) values ($1, 'ready', 100, 'ready')`, [home.id]);
  const plan = await call(U.jordan, 'start_plan', {
    p_home: home.id, p_tier: 'recommended', p_monthly: 116.36, p_annual: 1396.34, p_materials: 606.67, p_labor: 789.67,
    p_schedule: schedule,
  });
  const first = await one(db, 'select id from visits where plan_id = $1 order by window_start limit 1', [plan.id]);
  const task = await one(db, 'select id from visit_tasks where visit_id = $1 order by task_key limit 1', [first.id]);
  await db.query(`insert into visit_photos (visit_task_id, kind, path) values ($1, 'after', $2)`, [task.id, `${first.id}/${task.id}/after-1.jpg`]);
  await db.query(`insert into reports (visit_id, health_score, findings) values ($1, 86, '[]')`, [first.id]);
  await db.query(`insert into notices (visit_id, kind, channel) values ($1, 'enroute', 'push')`, [first.id]);
  const req = await call(U.jordan, 'request_quote', { p_category: 'lawn' });
  const bid = await call(U.sam, 'submit_bid', { p_request: req.id, p_price: 60, p_available_on: '2026-10-16' });
  await call(U.jordan, 'book_bid', { p_bid: bid.id });
  await call(U.jordan, 'request_quote', { p_category: 'win' });
  return home;
}

/** Elena also has quote activity, so "only Jordan's rows" is tested against real neighbors. */
async function elenaQuote() {
  const req = await call(U.elena, 'request_quote', { p_category: 'lawn' });
  const bid = await call(U.sam, 'submit_bid', { p_request: req.id, p_price: 75, p_available_on: '2026-10-17' });
  await db.query(`insert into bids (request_id, vendor_id, price, available_on) values ($1, $2, 70, current_date + 4)`, [req.id, VENDOR.summit]);
  await call(U.elena, 'book_bid', { p_bid: bid.id });
}

/** Rows that belong to Jordan's homes, per table (as the database owner). */
async function jordanRows() {
  const h = `(select id from homes where owner_id = '${U.jordan}')`;
  const v = `(select id from visits where home_id in ${h})`;
  const q = `(select id from quote_requests where home_id in ${h})`;
  return {
    homes: await count(db, 'homes', `id in ${h}`),
    appliances: await count(db, 'appliances', `home_id in ${h}`),
    plan_builds: await count(db, 'plan_builds', `home_id in ${h}`),
    plans: await count(db, 'plans', `home_id in ${h}`),
    visits: await count(db, 'visits', `id in ${v}`),
    visit_tasks: await count(db, 'visit_tasks', `visit_id in ${v}`),
    visit_photos: await count(db, 'visit_photos', `visit_task_id in (select id from visit_tasks where visit_id in ${v})`),
    reports: await count(db, 'reports', `visit_id in ${v}`),
    notices: await count(db, 'notices', `visit_id in ${v}`),
    quote_requests: await count(db, 'quote_requests', `id in ${q}`),
    bids: await count(db, 'bids', `request_id in ${q}`),
    quote_bookings: await count(db, 'quote_bookings', `request_id in ${q}`),
  };
}

/** Everything Elena owns, row by row, so an accidental change shows up as a diff. */
async function elenaSnapshot() {
  const h = [HOME.elena];
  return {
    home: await rows(db, 'select * from homes where id = any ($1)', [h]),
    appliances: await rows(db, 'select * from appliances where home_id = any ($1) order by id', [h]),
    plans: await rows(db, 'select * from plans where home_id = any ($1) order by id', [h]),
    visits: await rows(db, 'select * from visits where home_id = any ($1) order by id', [h]),
    tasks: await rows(db, 'select * from visit_tasks where visit_id = $1 order by id', [VISIT.elena]),
    notices: await rows(db, 'select * from notices where visit_id = $1 order by id', [VISIT.elena]),
    requests: await rows(db, 'select * from quote_requests where home_id = any ($1) order by id', [h]),
    bids: await rows(db, 'select * from bids where request_id in (select id from quote_requests where home_id = any ($1)) order by id', [h]),
    bookings: await rows(db, 'select * from quote_bookings where request_id in (select id from quote_requests where home_id = any ($1))', [h]),
    profile: await one(db, 'select * from profiles where id = $1', [U.elena]),
  };
}

describe('start_new_customer', () => {
  test('is a security definer RPC with a pinned search_path, for authenticated only', async () => {
    const f = await one(db, `
      select p.prosecdef, p.proconfig,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('public', p.oid, 'execute') as public_exec,
             pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'start_new_customer'`);
    assert.equal(f.prosecdef, true);
    assert.deepEqual(f.proconfig, ['search_path=public']);
    assert.equal(f.auth_exec, true);
    assert.equal(f.anon_exec, false);
    assert.equal(f.public_exec, false);
    // The same exclusive lock seed_demo takes.
    assert.match(f.def, /pg_advisory_xact_lock\(hashtextextended\('php:demo-data', 0\)\)/);
    // ensure_demo_users is still owner-only after being replaced.
    const e = await one(db, `
      select has_function_privilege('authenticated', 'public.ensure_demo_users()', 'execute') as auth_exec,
             has_function_privilege('anon', 'public.ensure_demo_users()', 'execute') as anon_exec`);
    assert.deepEqual(e, { auth_exec: false, anon_exec: false });
  });

  test('only Jordan can call it', async () => {
    await reset();
    for (const who of [U.elena, U.marcus, U.sam, U.office, U.david]) {
      await fails(startNew(who, 'Taylor Kim'), NO_ACCESS);
    }
    await assert.rejects(asAnon(db, (tx) => tx.query(`select public.start_new_customer('Taylor Kim', null)`)), { code: '42501' });
    // Nobody's name changed.
    assert.equal((await profile(U.jordan)).full_name, 'Jordan Lee');
    assert.equal((await profile(U.elena)).full_name, 'Elena Alvarez');
  });

  test("removes Jordan's home and everything on it, and nothing else", async () => {
    await reset();
    await onboardJordan();
    await elenaQuote();
    const mine = await jordanRows();
    for (const [t, n] of Object.entries(mine)) assert.ok(n > 0, `setup: Jordan has ${t}`);
    const before = await counts(db);
    const elena = await elenaSnapshot();

    await startNew(U.jordan, 'Taylor Kim', '(214) 555-0100');

    const gone = await jordanRows();
    for (const [t, n] of Object.entries(gone)) assert.equal(n, 0, `Jordan's ${t}`);
    assert.equal(await count(db, 'homes', 'owner_id = $1', [U.jordan]), 0);
    // Every other row is still there: each table lost exactly Jordan's rows.
    const afterCounts = await counts(db);
    for (const t of [...TABLES, 'auth.users', 'auth.identities', 'storage.objects']) {
      assert.equal(afterCounts[t], before[t] - (mine[t] ?? 0), t);
    }
    assert.deepEqual(await elenaSnapshot(), elena);
    // The seeded scenario (other homes, Marcus's route) is intact.
    assert.equal(await count(db, 'visits', 'id = any ($1)', [Object.values(VISIT)]), 5);
    assert.equal(await count(db, 'homes'), SEED_COUNTS.homes);
  });

  test('sets the name and phone, trimmed; a blank phone clears it', async () => {
    await startNew(U.jordan, '  Taylor Kim  ', ' 214 555 0100 ');
    assert.deepEqual(await profile(U.jordan), { full_name: 'Taylor Kim', phone: '214 555 0100' });
    await startNew(U.jordan, 'Sam Rivera', '   ');
    assert.deepEqual(await profile(U.jordan), { full_name: 'Sam Rivera', phone: null });
    await startNew(U.jordan, 'Sam Rivera', null);
    assert.deepEqual(await profile(U.jordan), { full_name: 'Sam Rivera', phone: null });
  });

  test('works again with no home (a second sign-up in a row)', async () => {
    assert.equal(await count(db, 'homes', 'owner_id = $1', [U.jordan]), 0);
    await startNew(U.jordan, 'Alex Morgan', '+1 214-555-0199');
    assert.deepEqual(await profile(U.jordan), { full_name: 'Alex Morgan', phone: '+1 214-555-0199' });
    // Jordan can onboard afresh straight after.
    const home = await call(U.jordan, 'save_home', { ...homeArgs, p_full_name: 'Alex Morgan' });
    assert.equal(home.owner_id, U.jordan);
    assert.equal(await count(db, 'homes', 'owner_id = $1', [U.jordan]), 1);
  });

  test('validates the name (1–80 characters) and the phone (up to 30)', async () => {
    await reset();
    await onboardJordan();
    const n = await count(db, 'homes', 'owner_id = $1', [U.jordan]);
    await fails(startNew(U.jordan, ''), 'Enter your name.');
    await fails(startNew(U.jordan, '   '), 'Enter your name.');
    await fails(startNew(U.jordan, null), 'Enter your name.');
    await fails(startNew(U.jordan, 'x'.repeat(81)), 'Use a name of 80 characters or fewer.');
    await fails(startNew(U.jordan, 'Taylor Kim', '1'.repeat(31)), 'Check the phone number and try again.');
    // A rejected call changes nothing.
    assert.equal(await count(db, 'homes', 'owner_id = $1', [U.jordan]), n);
    assert.deepEqual(await profile(U.jordan), { full_name: 'Jordan Lee', phone: null });
    // The limits themselves are allowed.
    await startNew(U.jordan, ` ${'y'.repeat(80)} `, '2'.repeat(30));
    assert.deepEqual(await profile(U.jordan), { full_name: 'y'.repeat(80), phone: '2'.repeat(30) });
  });

  test("a demo reset restores Jordan's name and clears his phone", async () => {
    await startNew(U.jordan, 'Taylor Kim', '(214) 555-0100');
    await reset();
    assert.deepEqual(await profile(U.jordan), { full_name: 'Jordan Lee', phone: null });
    const c = await counts(db);
    for (const [t, n] of Object.entries(SEED_COUNTS)) assert.equal(c[t], n, t);
  });
});
