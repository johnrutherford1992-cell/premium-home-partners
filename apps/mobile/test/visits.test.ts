/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MINUTES } from '@php/pricing';
import { VISIT_SELECT, VISIT_TABLES, initials, mapVisit, type VisitRow } from '../src/data/visits';

// Elena's visit as VISIT_SELECT returns it (tasks deliberately out of order).
const elena: VisitRow = {
  id: 'v-elena',
  home_id: 'h-elena',
  plan_id: 'p-elena',
  tech_id: 'a0000000-0000-4000-8000-000000000002',
  status: 'onsite',
  window_start: '2026-09-25T14:00:00+00:00',
  window_end: '2026-09-25T16:00:00+00:00',
  confirmed_at: '2026-09-24T18:00:00+00:00',
  offered_slots: [
    { start: '2026-09-25T14:00:00+00:00', end: '2026-09-25T16:00:00+00:00' },
    { start: '2026-09-26T18:00:00+00:00', end: '2026-09-26T20:00:00+00:00' },
    { bogus: true },
  ],
  started_at: '2026-09-25T13:40:00+00:00',
  arrived_at: '2026-09-25T14:02:00+00:00',
  completed_at: null,
  homes: {
    id: 'h-elena',
    address: '12 Linden Court, Mountain Brook, AL 35213',
    pets: true,
    water: 'city_hard',
    notes: 'Gate code 4471. Heater in garage, back left.',
    owner: { full_name: 'Elena Alvarez' },
  },
  plans: { tier: 'recommended' },
  tech: {
    id: 'a0000000-0000-4000-8000-000000000002',
    full_name: 'Marcus Reyes',
    title: 'Senior technician · 4.9 · 212 visits',
    vehicle: 'Silver Transit van · PHP-214',
  },
  visit_tasks: [
    { id: 't-smoke', task_key: 'smoke', name: 'Test smoke & CO detectors', done: false, visit_photos: [] },
    { id: 't-hvac', task_key: 'hvac', name: 'Replace HVAC filters ×2', done: true, visit_photos: [{ id: 'ph1', kind: 'before', path: 'v-elena/t-hvac/before-1.jpg' }] },
    { id: 't-wh', task_key: 'wh', name: 'Flush water heater', done: false, visit_photos: null },
    { id: 't-fridge', task_key: 'fridge', name: 'Replace fridge water filter', done: true },
    { id: 't-ice', task_key: 'ice', name: 'Drain & sanitize ice maker', done: false },
    { id: 't-dish', task_key: 'dish', name: 'Clean dishwasher filter & sump', done: false },
    { id: 't-dryer', task_key: 'dryer', name: 'Clean dryer vent', done: false },
  ],
  notices: [{ kind: '7d' }, { kind: 'enroute' }],
  reports: null,
};

test('mapVisit builds the Elena view model', () => {
  const v = mapVisit(elena, DEFAULT_MINUTES);
  assert.equal(v.id, 'v-elena');
  assert.equal(v.homeId, 'h-elena');
  assert.equal(v.status, 'onsite');
  assert.equal(v.confirmed, true);
  assert.equal(v.day, 'Fri · Sep 25');
  assert.equal(v.time, '9:00 – 11:00 AM');
  // 20 + 10 + 25 + 15 + 40 + 30 + 10 = 150 minutes
  assert.equal(v.duration, '2 hr 30 min');
  assert.deepEqual(v.client, {
    name: 'Elena Alvarez',
    firstName: 'Elena',
    street: '12 Linden Court',
    address: '12 Linden Court, Mountain Brook, AL 35213',
    pets: true,
    notes: 'Gate code 4471. Heater in garage, back left.',
  });
  assert.equal(v.tierIndex, 1);
  assert.equal(v.tierName, 'PHP Recommended');
  assert.deepEqual(v.tech, {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Marcus Reyes',
    firstName: 'Marcus',
    initials: 'MR',
    title: 'Senior technician · 4.9 · 212 visits',
    van: 'Silver Transit van · PHP-214',
  });
  assert.deepEqual(
    v.tasks.map((t) => t.key),
    ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'],
  );
  assert.equal(v.doneCount, 2);
  assert.deepEqual(v.notices, { d7: true, h48: false, dayOf: true, report: false });
  assert.equal(v.reportId, null);
  assert.equal(v.offeredSlots.length, 2);
});

test('task view models carry pricing-package details and photo kinds', () => {
  const v = mapVisit(elena, { ...DEFAULT_MINUTES, hvac: 25 });
  const byKey = Object.fromEntries(v.tasks.map((t) => [t.key, t]));
  assert.deepEqual(byKey.hvac, {
    id: 't-hvac',
    key: 'hvac',
    name: 'Replace HVAC filters ×2',
    short: 'HVAC filters',
    part: '16×25×4 MERV 11 ×2',
    min: 25,
    done: true,
    photoKind: 'before',
    photos: [{ id: 'ph1', kind: 'before', path: 'v-elena/t-hvac/before-1.jpg' }],
  });
  assert.equal(byKey.fridge.photoKind, 'after'); // clean
  assert.equal(byKey.ice.photoKind, 'after'); // ice
  assert.equal(byKey.wh.photoKind, 'drain');
  assert.equal(byKey.dish.photoKind, 'before'); // dirty
  assert.deepEqual(byKey.wh.photos, []);
});

test('embeds as arrays, confirmed status, missing pieces', () => {
  const row: VisitRow = {
    ...elena,
    status: 'confirmed',
    confirmed_at: null,
    homes: [{ address: '88 Beverly Dr, Mountain Brook, AL 35223', pets: false, owner: [{ full_name: 'The Whitfields' }] }],
    plans: [{ tier: 'high' }],
    tech: null,
    visit_tasks: [],
    notices: [{ kind: '48h' }, { kind: 'report' }],
    reports: [{ id: 'r1' }],
    window_start: '2026-09-25T20:00:00+00:00',
    window_end: '2026-09-25T22:00:00+00:00',
  };
  const v = mapVisit(row, DEFAULT_MINUTES);
  assert.equal(v.status, 'scheduled');
  assert.equal(v.confirmed, true);
  assert.equal(v.client.street, '88 Beverly Dr');
  assert.equal(v.client.notes, '');
  assert.equal(v.client.pets, false);
  assert.equal(v.tierIndex, 0);
  assert.equal(v.tierName, 'High');
  assert.equal(v.tech, null);
  assert.equal(v.time, '3:00 – 5:00 PM');
  assert.equal(v.duration, '0 hr 0 min');
  assert.deepEqual(v.notices, { d7: false, h48: true, dayOf: false, report: true });
  assert.equal(v.reportId, 'r1');

  const bare = mapVisit({ id: 'x', home_id: null, status: null, window_start: null, window_end: null, confirmed_at: null }, DEFAULT_MINUTES);
  assert.equal(bare.status, 'scheduled');
  assert.equal(bare.confirmed, false);
  assert.equal(bare.day, '');
  assert.equal(bare.tierIndex, 1);
  assert.equal(bare.client.firstName, 'there');
});

test('initials', () => {
  assert.equal(initials('Marcus Reyes'), 'MR');
  assert.equal(initials('Dana Liu'), 'DL');
  assert.equal(initials('Mark & Jo Bell'), 'MJ');
  assert.equal(initials('avery'), 'A');
});

test('VISIT_SELECT embeds what the view model needs', () => {
  for (const part of [
    'owner:profiles!homes_owner_id_fkey(full_name)',
    'plans(tier)',
    'tech:profiles!visits_tech_id_fkey(id,full_name,title,vehicle)',
    'visit_tasks(id,task_key,name,done,visit_photos(id,kind,path))',
    'notices(kind)',
    'reports(id)',
    'offered_slots',
    'notes',
  ]) {
    assert.ok(VISIT_SELECT.includes(part), part);
  }
  assert.ok(!/\s/.test(VISIT_SELECT), 'no whitespace in the select');
  assert.deepEqual(VISIT_TABLES, ['visits', 'visit_tasks', 'visit_photos', 'notices', 'reports', 'homes', 'plans', 'profiles']);
});
