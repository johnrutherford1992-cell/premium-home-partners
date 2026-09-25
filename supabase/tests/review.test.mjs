// Fixes from the live-backend review (supabase/migrations/20260925020000_review_fixes.sql):
// booking money hidden from vendors, task-key and schedule limits, deletable
// homes + the demo lock, unique notices, confirm_visit guard, profile email,
// and model-number normalization.

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { HOME, MIGRATIONS, SEED_COUNTS, U, VENDOR, VISIT, applyMigration, as, count, counts, createDb, one, rows, rpc } from './harness.mjs';

const REVIEW = '20260925020000_review_fixes.sql';

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

const reset = () => as(db, U.office, (tx) => rpc(tx, 'reset_demo'));
const call = (userId, fn, args) => as(db, userId, (tx) => rpc(tx, fn, args));
/** Expect a user-facing RPC error (errcode P0001) with exactly this message. */
const fails = (promise, message) => assert.rejects(promise, (e) => {
  assert.equal(e.message, message);
  assert.equal(e.code, 'P0001');
  return true;
});
const networkBid = async (requestId, vendorId, price) =>
  (await db.query(`insert into bids (request_id, vendor_id, price, available_on) values ($1, $2, $3, current_date + 4) returning *`,
    [requestId, vendorId, price])).rows[0];
/** A Postgres text[] literal. */
const pgArray = (xs) => `{${xs.map((x) => `"${x}"`).join(',')}}`;
const junkKeys = (n) => Array.from({ length: n }, (_, i) => `fake-task-${i}`);
const REAL_KEYS = ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'];
const BAD_SCHEDULE = "We couldn't build a schedule for that plan. Try again.";

const homeArgs = {
  p_full_name: 'Jordan Lee', p_address: '5 Elm St, Homewood, AL 35209', p_sqft: 1800, p_year: 2001, p_beds: 3, p_baths: 2,
  p_floors: 1, p_zones: 1, p_pets: false, p_water: 'city_hard',
};
const planArgs = (homeId, schedule) => ({
  p_home: homeId, p_tier: 'recommended', p_monthly: 116.36, p_annual: 1396.34, p_materials: 606.67, p_labor: 789.67, p_schedule: schedule,
});

/** Visit tasks whose key or name doesn't come from task_defaults (should always be zero). */
const foreignTasks = () => count(db, 'visit_tasks t',
  'not exists (select 1 from task_defaults d where d.task_key = t.task_key and d.name = t.name)');

describe('fix 1: booking money lives in quote_bookings (owner + office only)', () => {
  let lawn;
  let win;
  let davidTree;
  let samLawnBid;
  let summitLawnBid;
  before(async () => {
    await reset();
    lawn = await call(U.elena, 'request_quote', { p_category: 'lawn' });
    samLawnBid = await call(U.sam, 'submit_bid', { p_request: lawn.id, p_price: 60, p_available_on: '2026-10-16' });
    summitLawnBid = await networkBid(lawn.id, VENDOR.summit, 57);
    await call(U.elena, 'book_bid', { p_bid: summitLawnBid.id });
    win = await call(U.elena, 'request_quote', { p_category: 'win' });
    // David books a network vendor on a request Sam never bid on.
    davidTree = await call(U.david, 'request_quote', { p_category: 'tree' });
    const b = await networkBid(davidTree.id, VENDOR.clearview, 800);
    await call(U.david, 'book_bid', { p_bid: b.id });
  });

  test('quote_requests no longer has coordination_fee or booked_at', async () => {
    const cols = (await rows(db, `select column_name from information_schema.columns
                                  where table_schema = 'public' and table_name = 'quote_requests'`)).map((r) => r.column_name);
    assert.ok(cols.includes('booked_bid_id') && cols.includes('status') && cols.includes('bid_count'));
    assert.equal(cols.includes('coordination_fee'), false);
    assert.equal(cols.includes('booked_at'), false);
    await assert.rejects(as(db, U.sam, (tx) => tx.query('select coordination_fee from quote_requests')), { code: '42703' });
    await assert.rejects(as(db, U.sam, (tx) => tx.query('select booked_at from quote_requests')), { code: '42703' });
  });

  test('a vendor reads no bookings; owners read their own; office reads all', async () => {
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'quote_bookings')), 0);
    assert.equal(await as(db, U.marcus, (tx) => count(tx, 'quote_bookings')), 0);
    assert.equal(await as(db, U.jordan, (tx) => count(tx, 'quote_bookings')), 0);
    const elena = await as(db, U.elena, (tx) => rows(tx, 'select request_id, bid_id, coordination_fee::text as fee from quote_bookings'));
    assert.deepEqual(elena, [{ request_id: lawn.id, bid_id: summitLawnBid.id, fee: '5.70' }]);
    const david = await as(db, U.david, (tx) => rows(tx, 'select request_id, coordination_fee::text as fee from quote_bookings'));
    assert.deepEqual(david, [{ request_id: davidTree.id, fee: '80.00' }]);
    assert.equal(await as(db, U.office, (tx) => count(tx, 'quote_bookings')), 2);
    assert.equal(await as(db, U.office, (tx) => count(tx, 'quote_bookings', 'booked_at is not null')), 2);
  });

  test('a vendor sees open requests in its categories and requests it bid on, nothing else', async () => {
    const seen = await as(db, U.sam, (tx) => rows(tx, 'select id, status, booked_bid_id from quote_requests order by created_at'));
    assert.deepEqual(seen.map((r) => r.id).sort(), [lawn.id, win.id].sort());
    // Lost: booked, but not with Sam's bid ("Not selected").
    const lost = seen.find((r) => r.id === lawn.id);
    assert.equal(lost.status, 'booked');
    assert.notEqual(lost.booked_bid_id, samLawnBid.id);
    // David's booked request (no bid from Sam) is gone from Sam's view.
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'quote_requests', 'id = $1', [davidTree.id])), 0);
    // Office still sees all three.
    assert.equal(await as(db, U.office, (tx) => count(tx, 'quote_requests')), 3);
  });

  test('a vendor whose bid wins still sees the request and its own winning bid ("Won")', async () => {
    const press = await call(U.elena, 'request_quote', { p_category: 'press' });
    const bid = await call(U.sam, 'submit_bid', { p_request: press.id, p_price: 300, p_available_on: '2026-10-16' });
    await call(U.elena, 'book_bid', { p_bid: bid.id });
    const r = await as(db, U.sam, (tx) => rows(tx, 'select status, booked_bid_id from quote_requests where id = $1', [press.id]));
    assert.deepEqual(r, [{ status: 'booked', booked_bid_id: bid.id }]);
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'quote_bookings')), 0);
  });

  test('an unvetted or out-of-category vendor sees no requests, even ones it bid on', async () => {
    await db.query(`update vendors set vetted = false where id = $1`, [VENDOR.evergreen]);
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'quote_requests')), 0);
    await db.query(`update vendors set vetted = true, categories = array['tree'] where id = $1`, [VENDOR.evergreen]);
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'quote_requests')), 0);
    await db.query(`update vendors set categories = array['lawn','land','win','press','lights','tree'] where id = $1`, [VENDOR.evergreen]);
    assert.ok(await as(db, U.sam, (tx) => count(tx, 'quote_requests')) > 0);
  });

  test('nobody writes quote_bookings directly; one booking per request', async () => {
    for (const who of [U.elena, U.sam, U.office]) {
      await assert.rejects(
        as(db, who, (tx) => tx.query(`insert into quote_bookings (request_id, bid_id, coordination_fee) values ($1, $2, 0)`,
          [win.id, samLawnBid.id])),
        { code: '42501' },
      );
      await assert.rejects(as(db, who, (tx) => tx.query('update quote_bookings set coordination_fee = 0')), { code: '42501' });
      await assert.rejects(as(db, who, (tx) => tx.query('delete from quote_bookings')), { code: '42501' });
    }
    const priv = await one(db, `select has_table_privilege('authenticated', 'public.quote_bookings', 'select') as sel,
                                       has_table_privilege('authenticated', 'public.quote_bookings', 'insert') as ins,
                                       has_table_privilege('authenticated', 'public.quote_bookings', 'update') as upd,
                                       has_table_privilege('authenticated', 'public.quote_bookings', 'delete') as del,
                                       has_table_privilege('authenticated', 'public.quote_bookings', 'truncate') as trunc,
                                       has_table_privilege('anon', 'public.quote_bookings', 'truncate') as anon_trunc`);
    assert.deepEqual(priv, { sel: true, ins: false, upd: false, del: false, trunc: false, anon_trunc: false });
    await assert.rejects(
      db.query(`insert into quote_bookings (request_id, bid_id, coordination_fee) values ($1, $2, 1)`, [lawn.id, samLawnBid.id]),
      { code: '23505' },
    );
    assert.equal(await count(db, 'quote_bookings', 'request_id = $1', [lawn.id]), 1);
  });

  test('deleting a booked bid or request removes its booking; reset clears them all', async () => {
    await db.query('delete from quote_requests where id = $1', [davidTree.id]);
    assert.equal(await count(db, 'quote_bookings', 'request_id = $1', [davidTree.id]), 0);
    assert.ok(await count(db, 'quote_bookings') > 0);
    await reset();
    assert.equal(await count(db, 'quote_bookings'), 0);
    assert.deepEqual(await counts(db), SEED_COUNTS);
  });
});

describe('fix 1: upgrading a database that already has bookings', () => {
  let old;
  before(async () => {
    old = await createDb({ migrations: MIGRATIONS.filter((f) => f < REVIEW) });
  });
  after(async () => {
    await old?.close();
  });

  test('moves the fee and booked_at into quote_bookings, drops the columns, dedupes notices, backfills emails', async () => {
    const req = await as(old, U.elena, (tx) => rpc(tx, 'request_quote', { p_category: 'lawn' }));
    const bid = (await old.query(`insert into bids (request_id, vendor_id, price, available_on) values ($1, $2, 57, current_date) returning id`,
      [req.id, VENDOR.summit])).rows[0];
    const booked = await as(old, U.elena, (tx) => rpc(tx, 'book_bid', { p_bid: bid.id }));
    assert.equal(Number(booked.coordination_fee), 5.7);
    // Duplicate notices from the old race, and a profile without an email.
    await old.query(`insert into notices (visit_id, kind, channel) values ($1, '7d', 'email'), ($1, '48h', 'push'), ($1, '48h', 'push'),
                                                                         ($1, 'enroute', 'push'), ($1, 'enroute', 'push')`, [VISIT.elena]);
    await old.query(`update profiles set email = null where id = $1`, [U.jordan]);

    await applyMigration(old, REVIEW);

    const b = await one(old, 'select bid_id, coordination_fee::text as fee, booked_at from quote_bookings where request_id = $1', [req.id]);
    assert.equal(b.bid_id, bid.id);
    assert.equal(b.fee, '5.70');
    assert.equal(new Date(b.booked_at).getTime(), new Date(booked.booked_at).getTime());
    assert.equal(await count(old, 'information_schema.columns',
      `table_schema = 'public' and table_name = 'quote_requests' and column_name in ('coordination_fee', 'booked_at')`), 0);
    assert.equal(await count(old, 'notices', `visit_id = $1 and kind = '7d'`, [VISIT.elena]), 1);
    assert.equal(await count(old, 'notices', `visit_id = $1 and kind = '48h'`, [VISIT.elena]), 1);
    assert.equal(await count(old, 'notices', `visit_id = $1 and kind = 'enroute'`, [VISIT.elena]), 2);
    assert.equal((await one(old, 'select email from profiles where id = $1', [U.jordan])).email, 'newhome@php.test');
  });

  test('the migration is safe to run again', async () => {
    const before = await counts(old);
    await applyMigration(old, REVIEW);
    assert.deepEqual(await counts(old), before);
    await old.exec('select public.seed_demo()');
    assert.deepEqual(await counts(old), SEED_COUNTS);
  });
});

describe('fix 2: plan task keys come only from task_defaults', () => {
  beforeEach(reset);

  test('set_plan_tier: 2000 fake keys around real ones yields only the real tasks, named from task_defaults', async () => {
    const junk = junkKeys(2000);
    const keys = [...junk.slice(0, 1000), 'smoke', '<b>Free TV</b>', 'hvac', 'smoke', ...junk.slice(1000)];
    await call(U.elena, 'set_plan_tier', {
      p_tier: 'high', p_monthly: 1, p_annual: 12, p_materials: 6, p_labor: 6, p_next_tasks: pgArray(keys),
    });
    const t = await rows(db, `select t.task_key, t.name = d.name as named from visit_tasks t join task_defaults d on d.task_key = t.task_key
                              where t.visit_id = $1 order by t.task_key`, [VISIT.elena]);
    assert.deepEqual(t, [{ task_key: 'hvac', named: true }, { task_key: 'smoke', named: true }]);
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 2);
  });

  test('set_plan_tier: every real key repeated 300 times still yields at most 7 tasks', async () => {
    const keys = [...Array.from({ length: 300 }, () => REAL_KEYS).flat(), ...junkKeys(2000)];
    await call(U.elena, 'set_plan_tier', {
      p_tier: 'high', p_monthly: 1, p_annual: 12, p_materials: 6, p_labor: 6, p_next_tasks: pgArray(keys),
    });
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 7);
    assert.equal(await foreignTasks(), 0);
  });

  test('set_plan_tier caps the checklist at 7 even when task_defaults has more', async () => {
    await db.query(`insert into task_defaults (task_key, name, labor_min) values ('gutter', 'Clean gutters', 30)`);
    await call(U.elena, 'set_plan_tier', {
      p_tier: 'high', p_monthly: 1, p_annual: 12, p_materials: 6, p_labor: 6, p_next_tasks: pgArray(['gutter', ...REAL_KEYS]),
    });
    const keys = (await rows(db, 'select task_key from visit_tasks where visit_id = $1', [VISIT.elena])).map((r) => r.task_key).sort();
    // The first seven in the order sent: 'smoke' (eighth) is dropped.
    assert.deepEqual(keys, ['dish', 'dryer', 'fridge', 'gutter', 'hvac', 'ice', 'wh']);
  });

  test('set_plan_tier with only unknown keys changes the tier but leaves the checklist alone', async () => {
    const p = await call(U.elena, 'set_plan_tier', {
      p_tier: 'low', p_monthly: 1, p_annual: 12, p_materials: 6, p_labor: 6, p_next_tasks: pgArray(junkKeys(2000)),
    });
    assert.equal(p.tier, 'low');
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 7);
    assert.equal(await foreignTasks(), 0);
  });

  test('start_plan: the 2000-key attack yields at most 7 real tasks per visit', async () => {
    const home = await call(U.jordan, 'save_home', homeArgs);
    const p = await call(U.jordan, 'start_plan', planArgs(home.id, [
      { month_offset: 0, task_keys: [...junkKeys(2000), 'hvac', 'Evil task', 'dish', 'hvac', 42, null, { k: 'wh' }] },
      { month_offset: 6, task_keys: [...Array.from({ length: 300 }, () => REAL_KEYS).flat(), ...junkKeys(2000)] },
      { month_offset: 9, task_keys: 'hvac' },
    ]));
    const v = await rows(db, `select (select array_agg(t.task_key order by t.task_key) from visit_tasks t where t.visit_id = v.id) as keys
                              from visits v where v.plan_id = $1 order by v.window_start`, [p.id]);
    assert.deepEqual(v.map((x) => x.keys), [['dish', 'hvac'], [...REAL_KEYS].sort(), null]);
    assert.equal(await count(db, 'visit_tasks t join visits v on v.id = t.visit_id', 'v.plan_id = $1', [p.id]), 9);
    assert.equal(await foreignTasks(), 0);
  });

  test('start_plan rejects month offsets outside the plan year and more than 12 visits', async () => {
    const home = await call(U.jordan, 'save_home', homeArgs);
    for (const month_offset of [-1, -0.5, 12, 12.5, 1e9]) {
      await fails(call(U.jordan, 'start_plan', planArgs(home.id, [{ month_offset: 0, task_keys: ['hvac'] }, { month_offset, task_keys: ['hvac'] }])),
        BAD_SCHEDULE);
    }
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ month_offset: Math.min(i, 11), task_keys: ['hvac'] }));
    await fails(call(U.jordan, 'start_plan', planArgs(home.id, thirteen)), BAD_SCHEDULE);
    assert.equal(await count(db, 'plans', 'home_id = $1', [home.id]), 0);
    // The whole year (offsets 0..11, the high tier) is fine.
    const twelve = Array.from({ length: 12 }, (_, i) => ({ month_offset: i, task_keys: ['hvac'] }));
    const p = await call(U.jordan, 'start_plan', planArgs(home.id, twelve));
    assert.equal(await count(db, 'visits', 'plan_id = $1', [p.id]), 12);
  });
});

describe('fix 3: deletable homes, the demo lock, and re-linking only unstarted visits', () => {
  beforeEach(reset);

  test('visit_tasks.appliance_id is ON DELETE SET NULL', async () => {
    const c = await one(db, `select confdeltype from pg_constraint where conname = 'visit_tasks_appliance_id_fkey'`);
    assert.equal(c.confdeltype, 'n');
  });

  test('deleting an onboarded home, a seeded home or a homeowner account succeeds', async () => {
    const home = await call(U.jordan, 'save_home', homeArgs);
    await call(U.jordan, 'set_home_appliances', { p_home: home.id, p_items: [{ model: '59TN6B100V21' }, { model: 'WED5620HW' }] });
    const p = await call(U.jordan, 'start_plan', planArgs(home.id, [{ month_offset: 0, task_keys: ['hvac', 'dryer'] }]));
    assert.equal(await count(db, 'visit_tasks t join visits v on v.id = t.visit_id', 'v.plan_id = $1 and t.appliance_id is not null', [p.id]), 2);

    await db.query('delete from homes where id = $1', [home.id]);
    assert.equal(await count(db, 'visits', 'home_id = $1', [home.id]), 0);
    assert.equal(await count(db, 'appliances', 'home_id = $1', [home.id]), 0);

    await db.query('delete from homes where id = $1', [HOME.whit]);
    assert.equal(await count(db, 'homes', 'id = $1', [HOME.whit]), 0);

    // Elena's appliances back her visit's checklist.
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1 and appliance_id is not null', [VISIT.elena]), 6);
    await db.query('delete from auth.users where id = $1', [U.elena]);
    assert.equal(await count(db, 'homes', 'id = $1', [HOME.elena]), 0);
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 0);
    // reset_demo restores the account and the scenario.
    await reset();
    assert.deepEqual(await counts(db), SEED_COUNTS);
  });

  test('deleting one appliance just unlinks its tasks', async () => {
    const heater = (await one(db, `select id from appliances where home_id = $1 and model = 'XE50T10H45U0'`, [HOME.elena])).id;
    await db.query('delete from appliances where id = $1', [heater]);
    assert.equal(await count(db, 'visit_tasks', `visit_id = $1 and task_key = 'wh' and appliance_id is null`, [VISIT.elena]), 1);
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 7);
  });

  test('seed_demo takes the demo lock exclusively; onboarding RPCs take it shared', async () => {
    const KEY = `classid::bigint = (hashtextextended('php:demo-data', 0) >> 32) & 4294967295
                 and objid::bigint = hashtextextended('php:demo-data', 0) & 4294967295 and objsubid = 1`;
    const demoLock = async (tx) => (await rows(tx, `select mode from pg_locks where locktype = 'advisory' and granted and ${KEY}`)).map((r) => r.mode);

    assert.deepEqual(await db.transaction(async (tx) => {
      await tx.query('select public.seed_demo()');
      return demoLock(tx);
    }), ['ExclusiveLock']);

    let homeId;
    assert.deepEqual(await as(db, U.jordan, async (tx) => {
      homeId = (await rpc(tx, 'save_home', homeArgs)).id;
      return demoLock(tx);
    }), ['ShareLock']);
    assert.deepEqual(await as(db, U.jordan, async (tx) => {
      await rpc(tx, 'set_home_appliances', { p_home: homeId, p_items: [{ model: '59TN6B100V21' }] });
      return demoLock(tx);
    }), ['ShareLock']);
    assert.deepEqual(await as(db, U.jordan, async (tx) => {
      await rpc(tx, 'start_plan', planArgs(homeId, [{ month_offset: 0, task_keys: ['hvac'] }]));
      return demoLock(tx);
    }), ['ShareLock']);
    // Transaction-scoped: nothing is left held afterwards.
    assert.equal(await count(db, 'pg_locks', `locktype = 'advisory' and ${KEY}`), 0);
  });

  test('set_home_appliances re-links scheduled visits only, never a done one', async () => {
    // Finish Elena's visit.
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    for (const r of await rows(db, 'select id from visit_tasks where visit_id = $1', [VISIT.elena])) {
      await call(U.marcus, 'set_task_done', { p_task: r.id, p_done: true });
    }
    await call(U.marcus, 'complete_visit', { p_visit: VISIT.elena });
    // A later visit that hasn't started, and one already on site.
    const later = (await one(db, `insert into visits (plan_id, home_id, tech_id, window_start, window_end, status)
      values ('c0000000-0000-4000-8000-000000000005', $1, $2, now() + interval '60 days', now() + interval '60 days 2 hours', 'confirmed')
      returning id`, [HOME.elena, U.marcus])).id;
    const onsite = (await one(db, `insert into visits (plan_id, home_id, tech_id, window_start, window_end, status)
      values ('c0000000-0000-4000-8000-000000000005', $1, $2, now(), now() + interval '2 hours', 'onsite')
      returning id`, [HOME.elena, U.marcus])).id;
    await db.query(`insert into visit_tasks (visit_id, task_key, name) values ($1, 'wh', 'Flush water heater'), ($2, 'wh', 'Flush water heater')`,
      [later, onsite]);

    assert.equal(await call(U.elena, 'set_home_appliances', {
      p_home: HOME.elena, p_items: [{ model: 'XE50T10H45U0', serial: 'NEW1', brand: 'RHEEM MFG CO.', name: 'Rheem water heater' }],
    }), 1);
    const heater = (await one(db, 'select id from appliances where home_id = $1', [HOME.elena])).id;
    assert.equal((await one(db, `select appliance_id from visit_tasks where visit_id = $1 and task_key = 'wh'`, [later])).appliance_id, heater);
    assert.equal((await one(db, `select appliance_id from visit_tasks where visit_id = $1 and task_key = 'wh'`, [onsite])).appliance_id, null);
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1 and appliance_id is not null', [VISIT.elena]), 0);
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1 and done', [VISIT.elena]), 7);
  });
});

describe('fix 4: one 7d / 48h / report notice per visit', () => {
  beforeEach(reset);

  test('the unique index refuses duplicates of those kinds only', async () => {
    for (const kind of ['7d', '48h', 'report']) {
      await db.query(`insert into notices (visit_id, kind, channel) values ($1, $2, 'push') on conflict do nothing`, [VISIT.david, kind]);
      await assert.rejects(db.query(`insert into notices (visit_id, kind, channel) values ($1, $2, 'push')`, [VISIT.david, kind]),
        { code: '23505' }, kind);
    }
    await db.query(`insert into notices (visit_id, kind, channel) values ($1, 'enroute', 'push'), ($1, 'enroute', 'push')`, [VISIT.david]);
    assert.equal(await count(db, 'notices', `visit_id = $1 and kind = 'enroute'`, [VISIT.david]), 2);
  });

  test('send_48h_reminders counts only the notices it inserted, and never duplicates', async () => {
    await db.query(`insert into notices (visit_id, kind, channel) values ($1, '48h', 'push')`, [VISIT.elena]);
    assert.equal(await call(U.office, 'send_48h_reminders', {}), 4);
    assert.equal(await call(U.office, 'send_48h_reminders', {}), 0);
    assert.equal(await count(db, 'notices', `kind = '48h'`), 5);
    assert.equal(await count(db, '(select visit_id from notices where kind = $1 group by visit_id having count(*) > 1) d', 'true', ['48h']), 0);
  });

  test('complete_visit publishes even when a report notice already exists, and keeps one', async () => {
    await db.query(`insert into notices (visit_id, kind, channel) values ($1, 'report', 'push')`, [VISIT.elena]);
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    for (const r of await rows(db, 'select id from visit_tasks where visit_id = $1', [VISIT.elena])) {
      await call(U.marcus, 'set_task_done', { p_task: r.id, p_done: true });
    }
    const r = await call(U.marcus, 'complete_visit', { p_visit: VISIT.elena });
    assert.equal(r.health_score, 86);
    assert.equal(await count(db, 'notices', `visit_id = $1 and kind = 'report'`, [VISIT.elena]), 1);
  });

  test('start_plan still sends the first visit its 7d notice', async () => {
    const home = await call(U.jordan, 'save_home', homeArgs);
    const p = await call(U.jordan, 'start_plan', planArgs(home.id, [{ month_offset: 0, task_keys: ['hvac'] }, { month_offset: 6, task_keys: ['hvac'] }]));
    assert.equal(await count(db, 'notices n join visits v on v.id = n.visit_id', `v.plan_id = $1 and n.kind = '7d'`, [p.id]), 1);
  });
});

describe('fix 5: confirm_visit only before the visit starts', () => {
  beforeEach(reset);

  test('scheduled and confirmed visits confirm; started, done and canceled ones are refused', async () => {
    await call(U.elena, 'confirm_visit', { p_visit: VISIT.elena });
    await call(U.elena, 'confirm_visit', { p_visit: VISIT.elena });
    await db.query(`update visits set status = 'confirmed' where id = $1`, [VISIT.david]);
    await call(U.david, 'confirm_visit', { p_visit: VISIT.david });

    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    await fails(call(U.elena, 'confirm_visit', { p_visit: VISIT.elena }), 'This visit is already under way.');
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    await fails(call(U.elena, 'confirm_visit', { p_visit: VISIT.elena }), 'This visit is already under way.');
    await db.query(`update visits set status = 'done' where id = $1`, [VISIT.elena]);
    await fails(call(U.elena, 'confirm_visit', { p_visit: VISIT.elena }), 'This visit is already complete.');
    await db.query(`update visits set status = 'canceled' where id = $1`, [VISIT.priya]);
    await fails(call(U.priya, 'confirm_visit', { p_visit: VISIT.priya }), 'This visit was canceled.');
  });
});

describe('fix 6: handle_new_user copies the email', () => {
  test('a new sign-up gets a homeowner profile with its email', async () => {
    const id = '0f000000-0000-4000-8000-000000000006';
    await db.transaction(async (tx) => {
      await tx.exec('set local role auth_admin');
      await tx.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'new.owner@php.test', '{"full_name":"New Owner"}')`, [id]);
    });
    assert.deepEqual(await one(db, 'select role, full_name, email from profiles where id = $1', [id]),
      { role: 'homeowner', full_name: 'New Owner', email: 'new.owner@php.test' });
    await db.query('delete from auth.users where id = $1', [id]);
  });
});

describe('fix 7: model numbers normalize like the edge functions', () => {
  before(reset);

  test('norm_model drops whitespace, hyphens and Unicode dashes, and uppercases', async () => {
    const r = await one(db, `select private.norm_model(' 59tn6b-100 v21') as a, private.norm_model(E'59TN6B\\u2010100\\u2212V21\\t') as b,
                                    private.norm_model('lrmvs--3006s') as c, private.norm_model(null) as d, private.norm_model('A_B.C/D') as e`);
    assert.deepEqual(r, { a: '59TN6B100V21', b: '59TN6B100V21', c: 'LRMVS3006S', d: '', e: 'A_B.C/D' });
    const idx = await one(db, `select pg_get_indexdef('public.appliance_models_norm_model_idx'::regclass) as def`);
    assert.match(idx.def, /private\.norm_model\(model\)/);
  });

  test('set_home_appliances resolves dashed, spaced and lowercase model numbers to the cache', async () => {
    const home = await call(U.jordan, 'save_home', homeArgs);
    assert.equal(await call(U.jordan, 'set_home_appliances', {
      p_home: home.id,
      p_items: [
        { model: '59tn6b-100v21' },
        { model: 'LRMVS 3006-S' },
        { model: 'SHPM88Z75N\u2010' },
        { model: 'XE50T10H45U1' },
        { model: '---' },
      ],
    }), 5);
    const a = await rows(db, `select a.model, m.model as cached from appliances a left join appliance_models m on m.id = a.model_id
                              where a.home_id = $1 order by a.model`, [home.id]);
    assert.deepEqual(a, [
      { model: '---', cached: null },
      { model: '59tn6b-100v21', cached: '59TN6B100V21' },
      { model: 'LRMVS 3006-S', cached: 'LRMVS3006S' },
      { model: 'SHPM88Z75N\u2010', cached: 'SHPM88Z75N' },
      { model: 'XE50T10H45U1', cached: null },
    ]);
  });
});
