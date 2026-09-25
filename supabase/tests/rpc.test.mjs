// RPC catalog (docs/LIVE_ARCHITECTURE.md §4): happy paths, guard errors,
// idempotency, first-wins booking, and reset_demo.

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { HOME, SEED_COUNTS, U, VENDOR, VISIT, as, count, counts, createDb, one, rows, rpc } from './harness.mjs';

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
const NO_ACCESS = "You don't have access to that.";

const taskIds = async (visitId) =>
  Object.fromEntries((await rows(db, 'select task_key, id from visit_tasks where visit_id = $1', [visitId])).map((r) => [r.task_key, r.id]));

describe('confirm_visit / reschedule_visit', () => {
  before(reset);

  test('owner confirms; others are refused', async () => {
    await call(U.elena, 'confirm_visit', { p_visit: VISIT.elena });
    assert.ok((await one(db, 'select confirmed_at from visits where id = $1', [VISIT.elena])).confirmed_at);
    await fails(call(U.david, 'confirm_visit', { p_visit: VISIT.elena }), "We couldn't find that visit.");
    await fails(call(U.marcus, 'confirm_visit', { p_visit: VISIT.elena }), NO_ACCESS);
    await fails(call(U.sam, 'confirm_visit', { p_visit: VISIT.elena }), NO_ACCESS);
  });

  test('reschedule cycles through offered_slots and clears confirmation', async () => {
    const { offered_slots: slots, window_start: start0 } = await one(db, 'select offered_slots, window_start from visits where id = $1', [VISIT.elena]);
    assert.equal(slots.length, 3);
    assert.equal(new Date(slots[0].start).getTime(), new Date(start0).getTime());
    for (const i of [1, 2, 0, 1]) {
      const v = await call(U.elena, 'reschedule_visit', { p_visit: VISIT.elena });
      assert.equal(new Date(v.window_start).getTime(), new Date(slots[i].start).getTime(), `slot ${i}`);
      assert.equal(new Date(v.window_end).getTime(), new Date(slots[i].end).getTime());
      assert.equal(v.confirmed_at, null);
    }
    // Slot 1 is tomorrow 1–3 PM Chicago.
    const local = await one(db, `select to_char(window_start at time zone 'America/Chicago', 'HH24:MI') as t0,
                                        to_char(window_end at time zone 'America/Chicago', 'HH24:MI') as t1,
                                        (window_start at time zone 'America/Chicago')::date - (now() at time zone 'America/Chicago')::date as day
                                 from visits where id = $1`, [VISIT.elena]);
    assert.deepEqual(local, { t0: '13:00', t1: '15:00', day: 1 });
    await fails(call(U.david, 'reschedule_visit', { p_visit: VISIT.elena }), "We couldn't find that visit.");
    await fails(call(U.marcus, 'reschedule_visit', { p_visit: VISIT.elena }), NO_ACCESS);
  });
});

describe('tech flow: advance_visit, set_task_done, add_visit_photo, complete_visit', () => {
  let tasks;
  before(async () => {
    await reset();
    tasks = await taskIds(VISIT.elena);
  });

  test('checklist and photos are locked until on site', async () => {
    await fails(call(U.marcus, 'set_task_done', { p_task: tasks.hvac, p_done: true }), 'Mark yourself on site to start the checklist.');
    await fails(
      call(U.marcus, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'before', p_path: `${VISIT.elena}/${tasks.hvac}/before-1.jpg` }),
      'Mark yourself on site to add photos.',
    );
    await fails(call(U.marcus, 'complete_visit', { p_visit: VISIT.elena }), 'Mark yourself on site before completing the visit.');
  });

  test('advance guards: wrong role, wrong tech', async () => {
    await fails(call(U.elena, 'advance_visit', { p_visit: VISIT.elena }), NO_ACCESS);
    await fails(call(U.sam, 'advance_visit', { p_visit: VISIT.elena }), NO_ACCESS);
    await fails(call(U.dana, 'advance_visit', { p_visit: VISIT.elena }), "We couldn't find that visit.");
  });

  test('scheduled -> enroute sends the enroute notice; then reschedule is refused', async () => {
    const v = await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    assert.equal(v.status, 'enroute');
    assert.ok(v.started_at);
    assert.equal(await count(db, 'notices', `visit_id = $1 and kind = 'enroute' and channel = 'push'`, [VISIT.elena]), 1);
    assert.equal(await as(db, U.elena, (tx) => count(tx, 'notices', `kind = 'enroute'`)), 1);
    await fails(
      call(U.elena, 'reschedule_visit', { p_visit: VISIT.elena }),
      "This visit can't be rescheduled once the technician is on the way.",
    );
    await fails(call(U.marcus, 'set_task_done', { p_task: tasks.hvac, p_done: true }), 'Mark yourself on site to start the checklist.');
  });

  test('enroute -> onsite, then any further advance is refused', async () => {
    const v = await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    assert.equal(v.status, 'onsite');
    assert.ok(v.arrived_at);
    await fails(call(U.marcus, 'advance_visit', { p_visit: VISIT.elena }), 'This visit is already on site.');
  });

  test('complete needs every task done', async () => {
    await fails(call(U.marcus, 'complete_visit', { p_visit: VISIT.elena }), 'Check off every task before completing the visit.');
  });

  test('set_task_done: only the assigned tech; toggles done/done_at', async () => {
    await fails(call(U.dana, 'set_task_done', { p_task: tasks.hvac, p_done: true }), "We couldn't find that task.");
    await fails(call(U.elena, 'set_task_done', { p_task: tasks.hvac, p_done: true }), NO_ACCESS);
    let t = await call(U.marcus, 'set_task_done', { p_task: tasks.hvac, p_done: true });
    assert.equal(t.done, true);
    assert.ok(t.done_at);
    t = await call(U.marcus, 'set_task_done', { p_task: tasks.hvac, p_done: false });
    assert.equal(t.done, false);
    assert.equal(t.done_at, null);
    for (const id of Object.values(tasks)) await call(U.marcus, 'set_task_done', { p_task: id, p_done: true });
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1 and done and done_at is not null', [VISIT.elena]), 7);
  });

  test('add_visit_photo validates path and kind, and is idempotent per path', async () => {
    const path = `${VISIT.elena}/${tasks.hvac}/before-1727265600000.jpg`;
    await fails(call(U.marcus, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'before', p_path: `${VISIT.david}/x.jpg` }),
      "That photo doesn't belong to this visit.");
    await fails(call(U.marcus, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'selfie', p_path: path }), "That photo type isn't supported.");
    await fails(call(U.dana, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'before', p_path: path }), "We couldn't find that task.");
    const a = await call(U.marcus, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'before', p_path: path });
    const b = await call(U.marcus, 'add_visit_photo', { p_task: tasks.hvac, p_kind: 'before', p_path: path });
    assert.equal(a.id, b.id);
    assert.equal(a.kind, 'before');
    await call(U.marcus, 'add_visit_photo', { p_task: tasks.wh, p_kind: 'drain', p_path: `${VISIT.elena}/${tasks.wh}/drain-1727265600001.jpg` });
    assert.equal(await count(db, 'visit_photos'), 2);
    assert.equal(await as(db, U.elena, (tx) => count(tx, 'visit_photos')), 2);
    assert.equal(await as(db, U.david, (tx) => count(tx, 'visit_photos')), 0);
  });

  test('complete_visit publishes the report once (idempotent)', async () => {
    await fails(call(U.dana, 'complete_visit', { p_visit: VISIT.elena }), "We couldn't find that visit.");
    await fails(call(U.elena, 'complete_visit', { p_visit: VISIT.elena }), NO_ACCESS);
    const r1 = await call(U.marcus, 'complete_visit', { p_visit: VISIT.elena });
    assert.equal(r1.health_score, 86);
    assert.deepEqual(r1.findings, [
      { text: 'Anode rod 70% depleted', tone: 'ochre', badge: 'Quote $185' },
      { text: 'Dryer vent airflow normal', tone: 'forest', badge: 'Good' },
    ]);
    const r2 = await call(U.marcus, 'complete_visit', { p_visit: VISIT.elena });
    assert.equal(r2.id, r1.id);
    assert.equal(await count(db, 'reports'), 1);
    assert.equal(await count(db, 'notices', `visit_id = $1 and kind = 'report' and channel = 'push'`, [VISIT.elena]), 1);
    const v = await one(db, 'select status, completed_at from visits where id = $1', [VISIT.elena]);
    assert.equal(v.status, 'done');
    assert.ok(v.completed_at);
    await fails(call(U.marcus, 'set_task_done', { p_task: tasks.hvac, p_done: false }), 'Mark yourself on site to start the checklist.');
    // Photos still attach after completion.
    await call(U.marcus, 'add_visit_photo', { p_task: tasks.smoke, p_kind: 'after', p_path: `${VISIT.elena}/${tasks.smoke}/after-1.jpg` });
  });

  test('report visibility: owner, assigned tech, office', async () => {
    assert.equal(await as(db, U.elena, (tx) => count(tx, 'reports')), 1);
    assert.equal(await as(db, U.marcus, (tx) => count(tx, 'reports')), 1);
    assert.equal(await as(db, U.office, (tx) => count(tx, 'reports')), 1);
    assert.equal(await as(db, U.david, (tx) => count(tx, 'reports')), 0);
    assert.equal(await as(db, U.dana, (tx) => count(tx, 'reports')), 0);
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'reports')), 0);
  });

  test('a home without a water heater or dryer gets no findings', async () => {
    const t = await taskIds(VISIT.david);
    await call(U.office, 'advance_visit', { p_visit: VISIT.david });
    await call(U.office, 'advance_visit', { p_visit: VISIT.david });
    for (const id of Object.values(t)) await call(U.marcus, 'set_task_done', { p_task: id, p_done: true });
    const r = await call(U.marcus, 'complete_visit', { p_visit: VISIT.david });
    assert.deepEqual(r.findings, []);
  });
});

describe('brokerage: request_quote, submit_bid, book_bid', () => {
  let req;
  let samBid;
  let summitBid;
  before(reset);

  const networkBid = async (requestId, vendorId, price) =>
    (await db.query(`insert into bids (request_id, vendor_id, price, available_on) values ($1, $2, $3, current_date + 4) returning *`,
      [requestId, vendorId, price])).rows[0];

  test('request_quote creates one request with area, sqft, scope and base', async () => {
    req = await call(U.elena, 'request_quote', { p_category: 'lawn' });
    assert.equal(req.status, 'open');
    assert.equal(req.category, 'lawn');
    assert.equal(req.scope, 'Weekly mow, edge and blow');
    assert.equal(Number(req.base), 65);
    assert.equal(req.area, '12 Linden Court · Mountain Brook 35213');
    assert.equal(req.home_sqft, 3420);
    assert.equal(req.bid_count, 0);
    assert.equal(req.home_id, HOME.elena);
  });

  test('request_quote is idempotent', async () => {
    const again = await call(U.elena, 'request_quote', { p_category: 'lawn' });
    assert.equal(again.id, req.id);
    assert.equal(await count(db, 'quote_requests'), 1);
  });

  test('request_quote guards', async () => {
    await fails(call(U.jordan, 'request_quote', { p_category: 'lawn' }), 'Add your home before requesting quotes.');
    await fails(call(U.elena, 'request_quote', { p_category: 'pool' }), "That service isn't available yet.");
    await fails(call(U.sam, 'request_quote', { p_category: 'lawn' }), NO_ACCESS);
    await fails(call(U.marcus, 'request_quote', { p_category: 'lawn' }), NO_ACCESS);
    await fails(call(U.office, 'request_quote', { p_category: 'lawn' }), NO_ACCESS);
  });

  test('submit_bid copies vendor name/rating and bumps bid_count; repeat returns the same bid', async () => {
    samBid = await call(U.sam, 'submit_bid', { p_request: req.id, p_price: 60.004, p_available_on: '2026-10-16' });
    assert.equal(samBid.vendor_id, VENDOR.evergreen);
    assert.equal(samBid.vendor_name, 'Evergreen Outdoor Co.');
    assert.equal(Number(samBid.vendor_rating), 4.9);
    assert.equal(Number(samBid.price), 60);
    assert.equal((await one(db, 'select bid_count from quote_requests where id = $1', [req.id])).bid_count, 1);
    const again = await call(U.sam, 'submit_bid', { p_request: req.id, p_price: 999, p_available_on: '2026-10-20' });
    assert.equal(again.id, samBid.id);
    assert.equal(Number(again.price), 60);
    assert.equal(await count(db, 'bids'), 1);
  });

  test('submit_bid guards', async () => {
    const other = await call(U.elena, 'request_quote', { p_category: 'win' });
    await fails(call(U.sam, 'submit_bid', { p_request: other.id, p_price: 0, p_available_on: '2026-10-16' }), 'Enter a price above $0.');
    await fails(call(U.sam, 'submit_bid', { p_request: other.id, p_price: -5, p_available_on: '2026-10-16' }), 'Enter a price above $0.');
    await fails(call(U.sam, 'submit_bid', { p_request: '00000000-0000-4000-8000-000000000000', p_price: 10, p_available_on: '2026-10-16' }),
      "We couldn't find that request.");
    await fails(call(U.elena, 'submit_bid', { p_request: other.id, p_price: 10, p_available_on: '2026-10-16' }), NO_ACCESS);
    await fails(call(U.marcus, 'submit_bid', { p_request: other.id, p_price: 10, p_available_on: '2026-10-16' }), NO_ACCESS);
    // A vendor outside the category cannot bid.
    await db.query(`update vendors set categories = array['tree'] where id = $1`, [VENDOR.evergreen]);
    await fails(call(U.sam, 'submit_bid', { p_request: other.id, p_price: 10, p_available_on: '2026-10-16' }), "We couldn't find that request.");
    await db.query(`update vendors set vetted = false where id = $1`, [VENDOR.evergreen]);
    await fails(call(U.sam, 'submit_bid', { p_request: other.id, p_price: 10, p_available_on: '2026-10-16' }), "Your vendor account isn't approved yet.");
    await db.query(`update vendors set vetted = true, categories = array['lawn','land','win','press','lights','tree'] where id = $1`, [VENDOR.evergreen]);
  });

  test('network bids (edge function, service role) also copy vendor fields and count', async () => {
    summitBid = await networkBid(req.id, VENDOR.summit, 57);
    assert.equal(summitBid.vendor_name, 'Summit Pro Services');
    assert.equal(Number(summitBid.vendor_rating), 4.8);
    await networkBid(req.id, VENDOR.clearview, 74);
    assert.equal((await one(db, 'select bid_count from quote_requests where id = $1', [req.id])).bid_count, 3);
    // Deleting a bid keeps the count in sync.
    await db.query('delete from bids where request_id = $1 and vendor_id = $2', [req.id, VENDOR.clearview]);
    assert.equal((await one(db, 'select bid_count from quote_requests where id = $1', [req.id])).bid_count, 2);
    assert.equal(await as(db, U.sam, (tx) => count(tx, 'bids', 'request_id = $1', [req.id])), 1);
    assert.equal(await as(db, U.elena, (tx) => count(tx, 'bids', 'request_id = $1', [req.id])), 2);
  });

  test('book_bid guards', async () => {
    await fails(call(U.david, 'book_bid', { p_bid: summitBid.id }), "We couldn't find that bid.");
    await fails(call(U.sam, 'book_bid', { p_bid: summitBid.id }), NO_ACCESS);
    await fails(call(U.elena, 'book_bid', { p_bid: '00000000-0000-4000-8000-000000000000' }), "We couldn't find that bid.");
  });

  test('book_bid: first booking wins, fee = 10% of price (recorded in quote_bookings)', async () => {
    const booked = await call(U.elena, 'book_bid', { p_bid: summitBid.id });
    assert.equal(booked.status, 'booked');
    assert.equal(booked.booked_bid_id, summitBid.id);
    // The money is no longer on the request row vendors can read.
    assert.equal('coordination_fee' in booked, false);
    assert.equal('booked_at' in booked, false);
    const booking = await one(db, 'select bid_id, coordination_fee, booked_at from quote_bookings where request_id = $1', [req.id]);
    assert.equal(booking.bid_id, summitBid.id);
    assert.equal(Number(booking.coordination_fee), 5.7);
    assert.ok(booking.booked_at);
    // Same bid again (double tap) returns the booking; another bid loses.
    assert.equal((await call(U.elena, 'book_bid', { p_bid: summitBid.id })).booked_bid_id, summitBid.id);
    await fails(call(U.elena, 'book_bid', { p_bid: samBid.id }), 'This request was already booked.');
    const after = await one(db, 'select booked_bid_id from quote_requests where id = $1', [req.id]);
    assert.equal(after.booked_bid_id, summitBid.id);
    assert.deepEqual(await rows(db, 'select bid_id, coordination_fee::text as fee from quote_bookings where request_id = $1', [req.id]),
      [{ bid_id: summitBid.id, fee: '5.70' }]);
  });

  test('a booked request is closed to new bids and still returned by request_quote', async () => {
    const tree = await call(U.elena, 'request_quote', { p_category: 'tree' });
    const b = await networkBid(tree.id, VENDOR.summit, 700);
    await call(U.elena, 'book_bid', { p_bid: b.id });
    await fails(call(U.sam, 'submit_bid', { p_request: tree.id, p_price: 650, p_available_on: '2026-10-16' }), 'This request is closed.');
    assert.equal((await call(U.elena, 'request_quote', { p_category: 'lawn' })).id, req.id);
    // Sam's existing bid on the booked lawn request is still returned, not an error.
    assert.equal((await call(U.sam, 'submit_bid', { p_request: req.id, p_price: 1, p_available_on: '2026-10-16' })).id, samBid.id);
  });

  test('the partial unique index allows only one active request per home and category', async () => {
    await assert.rejects(
      db.query(`insert into quote_requests (home_id, category, status) values ($1, 'lawn', 'open')`, [HOME.elena]),
      { code: '23505' },
    );
    await db.query(`insert into quote_requests (home_id, category, status) values ($1, 'lawn', 'canceled')`, [HOME.elena]);
  });
});

describe('office: send_48h_reminders, reset_demo', () => {
  before(reset);

  test('sends one 48h notice per upcoming visit, once', async () => {
    await fails(call(U.elena, 'send_48h_reminders', {}), NO_ACCESS);
    await fails(call(U.marcus, 'send_48h_reminders', {}), NO_ACCESS);
    assert.equal(await call(U.office, 'send_48h_reminders', {}), 5);
    assert.equal(await count(db, 'notices', `kind = '48h' and channel = 'push'`), 5);
    assert.equal(await call(U.office, 'send_48h_reminders', {}), 0);
    assert.equal(await as(db, U.elena, (tx) => count(tx, 'notices', `kind = '48h'`)), 1);
    assert.equal(await as(db, U.marcus, (tx) => count(tx, 'notices', `kind = '48h'`)), 3);
  });

  test('reset_demo is office-only and restores counts exactly', async () => {
    await fails(call(U.elena, 'reset_demo', {}), NO_ACCESS);
    await fails(call(U.marcus, 'reset_demo', {}), NO_ACCESS);
    await fails(call(U.sam, 'reset_demo', {}), NO_ACCESS);
    // Make a mess across every table.
    const r = await call(U.elena, 'request_quote', { p_category: 'press' });
    const b = await call(U.sam, 'submit_bid', { p_request: r.id, p_price: 300, p_available_on: '2026-10-16' });
    await call(U.elena, 'book_bid', { p_bid: b.id });
    assert.equal(await count(db, 'quote_bookings'), 1);
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.whit });
    await call(U.jordan, 'save_home', {
      p_full_name: 'Jordan Q. Lee', p_address: '5 Elm St, Homewood, AL 35209', p_sqft: 1800, p_year: 2001, p_beds: 3, p_baths: 2,
      p_floors: 1, p_zones: 1, p_pets: false, p_water: 'city_hard',
    });
    await db.query(`update pricing_settings set labor_rate = 120, coordination_fee = 0.2 where id = 1`);
    await db.query(`update task_defaults set labor_min = 99, name = 'x' where task_key = 'wh'`);
    await db.query(`insert into task_defaults (task_key, name, labor_min) values ('gutter', 'Gutters', 30)`);
    await db.query(`insert into plan_builds (home_id, status) values ($1, 'running')`, [HOME.elena]);
    await db.query(`update profiles set full_name = 'Nope', role = 'homeowner' where id = $1`, [U.marcus]);

    await call(U.office, 'reset_demo', {});
    assert.deepEqual(await counts(db), SEED_COUNTS);
    const ps = await one(db, 'select labor_rate, trip_fee, parts_markup, tech_cost, vehicle_cost, coordination_fee from pricing_settings where id = 1');
    assert.deepEqual(Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, Number(v)])),
      { labor_rate: 94, trip_fee: 35, parts_markup: 0.25, tech_cost: 38, vehicle_cost: 12, coordination_fee: 0.1 });
    assert.deepEqual(await one(db, `select name, labor_min from task_defaults where task_key = 'wh'`), { name: 'Flush water heater', labor_min: 40 });
    assert.deepEqual(await one(db, 'select full_name, role, title from profiles where id = $1', [U.marcus]),
      { full_name: 'Marcus Reyes', role: 'tech', title: 'Senior technician · 4.9 · 212 visits' });
    assert.equal((await one(db, 'select full_name from profiles where id = $1', [U.jordan])).full_name, 'Jordan Lee');
  });
});

describe('set_plan_tier', () => {
  beforeEach(reset);

  test('updates the active plan and swaps the untouched current visit\'s checklist', async () => {
    const p = await call(U.elena, 'set_plan_tier', {
      p_tier: 'high', p_monthly: 186.785, p_annual: 2241.43, p_materials: 881.42, p_labor: 1360, p_next_tasks: '{hvac,dish,hvac}',
    });
    assert.equal(p.tier, 'high');
    assert.equal(Number(p.monthly), 186.79);
    const t = await rows(db, 'select task_key, name, part_id is not null as has_part, appliance_id is not null as has_appliance from visit_tasks where visit_id = $1 order by task_key', [VISIT.elena]);
    assert.deepEqual(t, [
      { task_key: 'dish', name: 'Clean dishwasher filter & sump', has_part: true, has_appliance: true },
      { task_key: 'hvac', name: 'Replace HVAC filters ×2', has_part: true, has_appliance: true },
    ]);
  });

  test('leaves the checklist alone once work has started', async () => {
    await call(U.marcus, 'advance_visit', { p_visit: VISIT.elena });
    const p = await call(U.elena, 'set_plan_tier', {
      p_tier: 'low', p_monthly: 50, p_annual: 600, p_materials: 300, p_labor: 300, p_next_tasks: '{hvac}',
    });
    assert.equal(p.tier, 'low');
    assert.equal(await count(db, 'visit_tasks', 'visit_id = $1', [VISIT.elena]), 7);
  });

  test('guards', async () => {
    const args = { p_tier: 'high', p_monthly: 1, p_annual: 12, p_materials: 6, p_labor: 6, p_next_tasks: '{hvac}' };
    await fails(call(U.jordan, 'set_plan_tier', args), 'Start a plan first.');
    await fails(call(U.marcus, 'set_plan_tier', args), NO_ACCESS);
    await fails(call(U.office, 'set_plan_tier', args), NO_ACCESS);
    await fails(call(U.elena, 'set_plan_tier', { ...args, p_monthly: -1 }), "Something's off with that price. Try again.");
    // David's plan is untouched by Elena's calls.
    await call(U.elena, 'set_plan_tier', args);
    assert.equal((await one(db, 'select tier from plans where home_id = $1', [HOME.david])).tier, 'medium');
  });
});

describe('onboarding: save_home, set_home_appliances, start_plan', () => {
  let home;
  before(reset);

  const homeArgs = {
    p_full_name: 'Jordan Lee', p_address: '5 Elm St, Homewood, AL 35209', p_sqft: 1800, p_year: 2001, p_beds: 3, p_baths: 2,
    p_floors: 1, p_zones: 1, p_pets: false, p_water: 'city_hard',
  };

  test('save_home creates then updates the single home and sets the name', async () => {
    home = await call(U.jordan, 'save_home', { ...homeArgs, p_full_name: '  Jordan Q. Lee ' });
    assert.equal(home.owner_id, U.jordan);
    assert.equal(home.sqft, 1800);
    assert.equal((await one(db, 'select full_name from profiles where id = $1', [U.jordan])).full_name, 'Jordan Q. Lee');
    const again = await call(U.jordan, 'save_home', { ...homeArgs, p_full_name: '', p_sqft: 1900, p_pets: true });
    assert.equal(again.id, home.id);
    assert.equal(again.sqft, 1900);
    assert.equal(again.pets, true);
    assert.equal(await count(db, 'homes', 'owner_id = $1', [U.jordan]), 1);
    assert.equal((await one(db, 'select full_name from profiles where id = $1', [U.jordan])).full_name, 'Jordan Q. Lee');
    assert.equal(await as(db, U.jordan, (tx) => count(tx, 'homes')), 1);
  });

  test('save_home guards', async () => {
    await fails(call(U.jordan, 'save_home', { ...homeArgs, p_water: 'river' }), 'Pick a water type.');
    await fails(call(U.jordan, 'save_home', { ...homeArgs, p_address: '  ' }), 'Enter your home address.');
    await fails(call(U.jordan, 'save_home', { ...homeArgs, p_sqft: -1 }), 'Check the home details and try again.');
    await fails(call(U.marcus, 'save_home', homeArgs), NO_ACCESS);
    await fails(call(U.sam, 'save_home', homeArgs), NO_ACCESS);
  });

  test('set_home_appliances replaces the list and resolves cached models', async () => {
    const n = await call(U.jordan, 'set_home_appliances', {
      p_home: home.id,
      p_items: [
        { model: ' 59tn6b100v21', serial: 'S1', brand: 'CARRIER CORP.', name: 'Carrier Infinity furnace' },
        { model: 'MYSTERY-9000', serial: 'S2', brand: 'ACME', name: 'Mystery unit' },
      ],
    });
    assert.equal(n, 2);
    const a = await rows(db, 'select model, model_id is not null as cached from appliances where home_id = $1 order by model', [home.id]);
    assert.deepEqual(a, [{ model: '59tn6b100v21', cached: true }, { model: 'MYSTERY-9000', cached: false }]);
    assert.equal(await call(U.jordan, 'set_home_appliances', { p_home: home.id, p_items: [{ model: 'WED5620HW', serial: 'S3' }] }), 1);
    assert.equal(await count(db, 'appliances', 'home_id = $1', [home.id]), 1);
    assert.equal(await as(db, U.jordan, (tx) => count(tx, 'appliances')), 1);
  });

  test('set_home_appliances guards', async () => {
    await fails(call(U.elena, 'set_home_appliances', { p_home: home.id, p_items: [] }), "We couldn't find that home.");
    await fails(call(U.jordan, 'set_home_appliances', { p_home: home.id, p_items: { model: 'x' } }),
      "Something's off with that appliance list. Try again.");
    await fails(call(U.marcus, 'set_home_appliances', { p_home: home.id, p_items: [] }), NO_ACCESS);
    // Elena can replace her own appliances even though her visit's tasks point at them.
    assert.equal(await call(U.elena, 'set_home_appliances', {
      p_home: HOME.elena, p_items: [{ model: 'XE50T10H45U0', serial: 'Q1', brand: 'RHEEM MFG CO.', name: 'Rheem water heater' }],
    }), 1);
    assert.equal(await count(db, 'visit_tasks', `visit_id = $1 and task_key = 'wh' and appliance_id is not null`, [VISIT.elena]), 1);
  });

  // buildSchedule(1 /* recommended */, DEFAULT_FREQ, { pets: false, water: 'city_hard' }) from packages/pricing.
  const schedule = [
    { month_offset: 0, task_keys: ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'] },
    { month_offset: 2, task_keys: ['dish'] },
    { month_offset: 4, task_keys: ['hvac', 'dish'] },
    { month_offset: 6, task_keys: ['hvac', 'fridge', 'ice', 'dish', 'wh', 'smoke'] },
    { month_offset: 8, task_keys: ['dish'] },
    { month_offset: 10, task_keys: ['hvac', 'dish'] },
  ];
  const planArgs = () => ({
    p_home: home.id, p_tier: 'recommended', p_monthly: 116.36, p_annual: 1396.34, p_materials: 606.67, p_labor: 789.67, p_schedule: schedule,
  });

  test('start_plan creates the plan, a year of weekday visits, tasks, slots and the 7d notice', async () => {
    const p = await call(U.jordan, 'start_plan', planArgs());
    assert.equal(p.tier, 'recommended');
    assert.equal(p.active, true);
    const visits = await rows(db, `
      select id, tech_id, status, offered_slots,
             (window_start at time zone 'America/Chicago')::date as day,
             to_char(window_start at time zone 'America/Chicago', 'HH24:MI') as t0,
             to_char(window_end at time zone 'America/Chicago', 'HH24:MI') as t1,
             extract(isodow from (window_start at time zone 'America/Chicago'))::int as dow,
             (select count(*)::int from visit_tasks t where t.visit_id = v.id) as tasks
      from visits v where plan_id = $1 order by window_start`, [p.id]);
    assert.equal(visits.length, 6);
    assert.deepEqual(visits.map((v) => v.tasks), [7, 1, 2, 6, 1, 2]);
    for (const v of visits) {
      assert.equal(v.tech_id, U.marcus);
      assert.equal(v.status, 'scheduled');
      assert.equal(v.t0, '09:00');
      assert.equal(v.t1, '11:00');
      assert.ok(v.dow >= 1 && v.dow <= 5, 'weekday');
    }
    const first = visits[0];
    const today = (await one(db, `select (now() at time zone 'America/Chicago')::date as d`)).d;
    assert.ok(new Date(first.day) > new Date(today), 'first visit after today');
    assert.equal(p.starts_on.slice(0, 10), new Date(first.day).toISOString().slice(0, 10));
    assert.equal(first.offered_slots.length, 3);
    assert.equal(visits[1].offered_slots, null);
    const slotLocal = await rows(db, `
      select to_char((s->>'start')::timestamptz at time zone 'America/Chicago', 'HH24:MI') as t0,
             extract(isodow from ((s->>'start')::timestamptz at time zone 'America/Chicago'))::int as dow
      from visits, jsonb_array_elements(offered_slots) s where id = $1`, [first.id]);
    assert.deepEqual(slotLocal.map((s) => s.t0), ['09:00', '13:00', '08:00']);
    for (const s of slotLocal) assert.ok(s.dow >= 1 && s.dow <= 5);
    assert.equal(await count(db, 'notices', `visit_id = $1 and kind = '7d' and channel = 'email'`, [first.id]), 1);
    assert.equal(await count(db, 'notices', `visit_id in (select id from visits where plan_id = $1)`, [p.id]), 1);
    // Tasks link the cached appliance (the Whirlpool dryer) where one matches.
    assert.equal(await count(db, 'visit_tasks', `visit_id = $1 and task_key = 'dryer' and appliance_id is not null`, [first.id]), 1);
    // Marcus now sees Jordan and his visits; Jordan sees Marcus.
    assert.equal(await as(db, U.marcus, (tx) => count(tx, 'profiles', 'id = $1', [U.jordan])), 1);
    assert.equal(await as(db, U.marcus, (tx) => count(tx, 'visits', 'home_id = $1', [home.id])), 6);
    assert.equal(await as(db, U.jordan, (tx) => count(tx, 'profiles', 'id = $1', [U.marcus])), 1);
    assert.equal(await as(db, U.jordan, (tx) => count(tx, 'visits')), 6);
  });

  test('starting again replaces the unstarted year and keeps one active plan', async () => {
    await call(U.jordan, 'start_plan', { ...planArgs(), p_tier: 'low', p_schedule: schedule.slice(0, 2) });
    assert.equal(await count(db, 'plans', 'home_id = $1 and active', [home.id]), 1);
    assert.equal(await count(db, 'plans', 'home_id = $1', [home.id]), 2);
    assert.equal(await count(db, 'visits', 'home_id = $1', [home.id]), 2);
  });

  test('start_plan guards', async () => {
    await fails(call(U.elena, 'start_plan', planArgs()), "We couldn't find that home.");
    await fails(call(U.marcus, 'start_plan', planArgs()), NO_ACCESS);
    await fails(call(U.jordan, 'start_plan', { ...planArgs(), p_schedule: [] }), "We couldn't build a schedule for that plan. Try again.");
    await fails(call(U.jordan, 'start_plan', { ...planArgs(), p_schedule: { month_offset: 0 } }),
      "We couldn't build a schedule for that plan. Try again.");
    await fails(call(U.jordan, 'start_plan', { ...planArgs(), p_labor: null }), "Something's off with that price. Try again.");
  });
});

describe('RPC privileges', () => {
  test('every catalog RPC is security definer with a pinned search_path, executable by authenticated but not anon', async () => {
    const fns = await rows(db, `
      select p.proname, p.prosecdef, p.proconfig,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any ($1) order by 1`, [[
      'confirm_visit', 'reschedule_visit', 'advance_visit', 'set_task_done', 'add_visit_photo', 'complete_visit', 'request_quote',
      'submit_bid', 'book_bid', 'send_48h_reminders', 'set_plan_tier', 'save_home', 'set_home_appliances', 'start_plan', 'reset_demo',
    ]]);
    assert.equal(fns.length, 15);
    for (const f of fns) {
      assert.equal(f.prosecdef, true, f.proname);
      assert.deepEqual(f.proconfig, ['search_path=public'], f.proname);
      assert.equal(f.auth_exec, true, f.proname);
      assert.equal(f.anon_exec, false, f.proname);
    }
    const seeders = await rows(db, `
      select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('seed_demo', 'ensure_demo_users', 'auth_role', 'handle_new_user')`);
    for (const f of seeders) {
      assert.equal(f.auth_exec, false, f.proname);
      assert.equal(f.anon_exec, false, f.proname);
    }
  });
});
