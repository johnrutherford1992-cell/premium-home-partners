// Row-level security: each role sees what it should and nothing more, and
// clients cannot write around the RPCs.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { HOME, U, VISIT, as, asAnon, count, createDb, rows, rpc } from './harness.mjs';

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

/** Count rows of every table visible to userId. */
async function visible(userId, tables) {
  return as(db, userId, async (tx) => {
    const out = {};
    for (const t of tables) out[t] = await count(tx, t);
    return out;
  });
}

const ALL = [
  'profiles', 'homes', 'appliances', 'plans', 'plan_builds', 'visits', 'visit_tasks', 'visit_photos', 'reports',
  'notices', 'vendors', 'quote_requests', 'bids', 'service_categories', 'appliance_models', 'model_tasks',
  'parts', 'part_prices', 'pricing_settings', 'task_defaults',
];

const REFERENCE = { service_categories: 6, appliance_models: 5, model_tasks: 6, parts: 9, part_prices: 27, pricing_settings: 1, task_defaults: 7 };

describe('select visibility after seeding', () => {
  test('homeowner Elena sees her home, visit, tasks, notices and her tech only', async () => {
    assert.deepEqual(await visible(U.elena, ALL), {
      profiles: 2, homes: 1, appliances: 5, plans: 1, plan_builds: 0, visits: 1, visit_tasks: 7, visit_photos: 0,
      reports: 0, notices: 1, vendors: 0, quote_requests: 0, bids: 0, ...REFERENCE,
    });
    const profiles = await as(db, U.elena, (tx) => rows(tx, 'select id, role from profiles order by id'));
    assert.deepEqual(profiles.map((p) => p.id), [U.marcus, U.elena]);
  });

  test('Elena cannot see David\'s home, visit, plan, notices or profile', async () => {
    await as(db, U.elena, async (tx) => {
      assert.equal(await count(tx, 'homes', 'id = $1', [HOME.david]), 0);
      assert.equal(await count(tx, 'visits', 'id = $1', [VISIT.david]), 0);
      assert.equal(await count(tx, 'visit_tasks', 'visit_id = $1', [VISIT.david]), 0);
      assert.equal(await count(tx, 'notices', 'visit_id = $1', [VISIT.david]), 0);
      assert.equal(await count(tx, 'plans', 'home_id = $1', [HOME.david]), 0);
      assert.equal(await count(tx, 'profiles', 'id = $1', [U.david]), 0);
    });
  });

  test('homeowner Jordan (no home yet) sees only himself and reference data', async () => {
    assert.deepEqual(await visible(U.jordan, ALL), {
      profiles: 1, homes: 0, appliances: 0, plans: 0, plan_builds: 0, visits: 0, visit_tasks: 0, visit_photos: 0,
      reports: 0, notices: 0, vendors: 0, quote_requests: 0, bids: 0, ...REFERENCE,
    });
  });

  test('tech Marcus sees only his three visits and those clients', async () => {
    assert.deepEqual(await visible(U.marcus, ALL), {
      profiles: 4, homes: 3, appliances: 5, plans: 3, plan_builds: 0, visits: 3, visit_tasks: 21, visit_photos: 0,
      reports: 0, notices: 3, vendors: 0, quote_requests: 0, bids: 0, ...REFERENCE,
    });
    await as(db, U.marcus, async (tx) => {
      const ids = (await rows(tx, 'select id from visits order by window_start')).map((r) => r.id);
      assert.deepEqual(ids, [VISIT.elena, VISIT.david, VISIT.whit]);
      const people = (await rows(tx, 'select id from profiles order by id')).map((r) => r.id);
      assert.deepEqual(people, [U.marcus, U.elena, U.david, U.whit]);
      assert.equal(await count(tx, 'visits', 'id = $1', [VISIT.priya]), 0);
      assert.equal(await count(tx, 'homes', 'id = $1', [HOME.priya]), 0);
    });
  });

  test('tech Dana sees only her two visits', async () => {
    assert.deepEqual(await visible(U.dana, ['profiles', 'homes', 'visits', 'visit_tasks', 'notices', 'plans', 'appliances']), {
      profiles: 3, homes: 2, visits: 2, visit_tasks: 13, notices: 2, plans: 2, appliances: 0,
    });
  });

  test('vendor Sam sees no homeowner homes/profiles/visits, only his own vendor row', async () => {
    assert.deepEqual(await visible(U.sam, ALL), {
      profiles: 1, homes: 0, appliances: 0, plans: 0, plan_builds: 0, visits: 0, visit_tasks: 0, visit_photos: 0,
      reports: 0, notices: 0, vendors: 1, quote_requests: 0, bids: 0, ...REFERENCE,
    });
  });

  test('office sees everything', async () => {
    assert.deepEqual(await visible(U.office, ALL), {
      profiles: 10, homes: 5, appliances: 5, plans: 5, plan_builds: 0, visits: 5, visit_tasks: 34, visit_photos: 0,
      reports: 0, notices: 5, vendors: 3, quote_requests: 0, bids: 0, ...REFERENCE,
    });
  });

  test('anon sees nothing and cannot call RPCs', async () => {
    const seen = await asAnon(db, async (tx) => {
      const out = {};
      for (const t of ALL) out[t] = await count(tx, t);
      return out;
    });
    for (const t of ALL) assert.equal(seen[t], 0, t);
    await assert.rejects(asAnon(db, (tx) => rpc(tx, 'request_quote', { p_category: 'lawn' })), { code: '42501' });
    await assert.rejects(asAnon(db, (tx) => rpc(tx, 'reset_demo')), { code: '42501' });
  });
});

describe('quote requests and bids', () => {
  let elenaReq;
  let davidReq;
  before(async () => {
    elenaReq = await as(db, U.elena, (tx) => rpc(tx, 'request_quote', { p_category: 'lawn' }));
    davidReq = await as(db, U.david, (tx) => rpc(tx, 'request_quote', { p_category: 'win' }));
    await as(db, U.sam, (tx) => rpc(tx, 'submit_bid', { p_request: elenaReq.id, p_price: 60, p_available_on: '2026-10-16' }));
    // Network vendors bid through the fanout-quote edge function (service role).
    await db.query(
      `insert into bids (request_id, vendor_id, price, available_on) values ($1, 'e0000000-0000-4000-8000-000000000002', 57, current_date + 4),
                                                                          ($2, 'e0000000-0000-4000-8000-000000000002', 370, current_date + 4)`,
      [elenaReq.id, davidReq.id],
    );
  });

  test('homeowners see only their own requests and bids', async () => {
    await as(db, U.elena, async (tx) => {
      assert.equal(await count(tx, 'quote_requests'), 1);
      assert.equal(await count(tx, 'quote_requests', 'id = $1', [davidReq.id]), 0);
      assert.equal(await count(tx, 'bids'), 2);
      assert.equal(await count(tx, 'bids', 'request_id = $1', [davidReq.id]), 0);
    });
    await as(db, U.david, async (tx) => {
      assert.equal(await count(tx, 'quote_requests'), 1);
      assert.equal(await count(tx, 'bids'), 1);
    });
  });

  test('vendor sees requests in its categories with area only, and only its own bids', async () => {
    await as(db, U.sam, async (tx) => {
      const reqs = await rows(tx, 'select id, area, home_sqft, bid_count from quote_requests order by created_at');
      assert.equal(reqs.length, 2);
      assert.deepEqual(reqs.map((r) => r.area).sort(), ['12 Linden Court · Dallas 75205', '4410 Bryn Mawr Dr · Dallas 75225']);
      assert.equal(await count(tx, 'bids'), 1);
      assert.equal(await count(tx, 'bids', 'vendor_id <> $1', ['e0000000-0000-4000-8000-000000000001']), 0);
      assert.equal(await count(tx, 'homes'), 0);
      assert.equal(await count(tx, 'profiles'), 1);
    });
  });

  test('tech sees no requests or bids', async () => {
    assert.deepEqual(await visible(U.marcus, ['quote_requests', 'bids', 'vendors']), { quote_requests: 0, bids: 0, vendors: 0 });
  });

  test('office sees all requests and bids', async () => {
    assert.deepEqual(await visible(U.office, ['quote_requests', 'bids']), { quote_requests: 2, bids: 3 });
  });
});

describe('clients cannot write around the RPCs', () => {
  const affected = async (userId, sql, params = []) => as(db, userId, async (tx) => (await tx.query(sql, params)).affectedRows);

  test('homeowner updates/deletes touch nothing; inserts are rejected', async () => {
    assert.equal(await affected(U.elena, 'update visits set confirmed_at = now()'), 0);
    assert.equal(await affected(U.elena, 'update homes set sqft = 1'), 0);
    assert.equal(await affected(U.elena, 'delete from homes'), 0);
    assert.equal(await affected(U.elena, `update profiles set role = 'office' where id = $1`, [U.elena]), 0);
    assert.equal(await affected(U.elena, 'update pricing_settings set labor_rate = 1'), 0);
    assert.equal(await affected(U.elena, 'update quote_requests set status = \'booked\''), 0);
    await assert.rejects(
      as(db, U.elena, (tx) => tx.query(`insert into quote_requests (home_id, category) values ($1, 'tree')`, [HOME.elena])),
      { code: '42501' },
    );
    await assert.rejects(
      as(db, U.elena, (tx) => tx.query(`insert into homes (owner_id, address) values ($1, 'x')`, [U.elena])),
      { code: '42501' },
    );
  });

  test('tech cannot change visits, tasks or photos directly', async () => {
    assert.equal(await affected(U.marcus, `update visits set status = 'done'`), 0);
    assert.equal(await affected(U.marcus, 'update visit_tasks set done = true'), 0);
    assert.equal(await affected(U.marcus, 'delete from visit_tasks'), 0);
    await assert.rejects(
      as(db, U.marcus, (tx) =>
        tx.query(`insert into visit_photos (visit_task_id, kind, path) select id, 'before', 'x' from visit_tasks limit 1`)),
      { code: '42501' },
    );
  });

  test('vendor cannot insert or edit bids directly', async () => {
    await assert.rejects(
      as(db, U.sam, (tx) =>
        tx.query(`insert into bids (request_id, vendor_id, price) select id, 'e0000000-0000-4000-8000-000000000001', 1 from quote_requests limit 1`)),
      { code: '42501' },
    );
    assert.equal(await affected(U.sam, 'update bids set price = 1'), 0);
    assert.equal(await affected(U.sam, 'update vendors set rating = 5'), 0);
  });

  test('office writes pricing tables directly but nothing else', async () => {
    assert.equal(await affected(U.office, 'update pricing_settings set labor_rate = 95 where id = 1'), 1);
    assert.equal(await affected(U.office, `update task_defaults set labor_min = 21 where task_key = 'hvac'`), 1);
    assert.equal(await affected(U.office, `update visits set status = 'done'`), 0);
    assert.equal(await affected(U.office, 'update plans set monthly = 1'), 0);
    assert.equal(await affected(U.office, 'update vendors set rating = 1'), 0);
    // Non-office cannot touch task_defaults.
    assert.equal(await affected(U.marcus, `update task_defaults set labor_min = 99 where task_key = 'hvac'`), 0);
    await db.query(`update pricing_settings set labor_rate = 94 where id = 1; `);
    await db.query(`update task_defaults set labor_min = 20 where task_key = 'hvac'`);
  });

  test('seeding functions are not callable by signed-in users', async () => {
    await assert.rejects(as(db, U.office, (tx) => rpc(tx, 'seed_demo')), { code: '42501' });
    await assert.rejects(as(db, U.office, (tx) => rpc(tx, 'ensure_demo_users')), { code: '42501' });
  });
});

describe('storage: visit-photos bucket', () => {
  let taskId;
  before(async () => {
    taskId = (await db.query(`select id from visit_tasks where visit_id = $1 and task_key = 'hvac'`, [VISIT.elena])).rows[0].id;
  });
  const put = (userId, name) =>
    as(db, userId, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('visit-photos', $1, auth.uid())`, [name]));
  const seen = (userId) => as(db, userId, (tx) => count(tx, 'storage.objects', `bucket_id = 'visit-photos'`));

  test('the assigned tech uploads under the visit folder; others cannot', async () => {
    await put(U.marcus, `${VISIT.elena}/${taskId}/before-1700000000000.jpg`);
    await assert.rejects(put(U.dana, `${VISIT.elena}/${taskId}/before-1700000000001.jpg`), { code: '42501' });
    await assert.rejects(put(U.marcus, `${VISIT.priya}/x/before-1700000000002.jpg`), { code: '42501' });
    await assert.rejects(put(U.marcus, `not-a-uuid/x/before-1700000000003.jpg`), { code: '42501' });
    await assert.rejects(put(U.elena, `${VISIT.elena}/${taskId}/before-1700000000004.jpg`), { code: '42501' });
    await assert.rejects(put(U.office, `${VISIT.elena}/${taskId}/before-1700000000005.jpg`), { code: '42501' });
  });

  test('the tech, the home owner and office can read it; nobody else', async () => {
    assert.equal(await seen(U.marcus), 1);
    assert.equal(await seen(U.elena), 1);
    assert.equal(await seen(U.office), 1);
    assert.equal(await seen(U.david), 0);
    assert.equal(await seen(U.dana), 0);
    assert.equal(await seen(U.sam), 0);
    assert.equal(await asAnon(db, (tx) => count(tx, 'storage.objects')), 0);
  });
});

describe('realtime publication', () => {
  test('includes every live table', async () => {
    const t = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((r) => r.tablename);
    assert.deepEqual(t, [
      'bids', 'notices', 'plan_builds', 'pricing_settings', 'quote_requests', 'reports', 'task_defaults', 'visit_photos',
      'visit_tasks', 'visits',
    ]);
  });
});
