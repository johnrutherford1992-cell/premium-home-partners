// node --test --experimental-strip-types supabase/functions/_shared/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_STEPS,
  INITIAL_STEP,
  STEP_INTERVAL_MS,
  buildOptions,
  countTasks,
  homeProfile,
  lowestInStock,
  matchModels,
  partNumbersToPrice,
  pricingInputs,
  waitBeforeNext,
} from './plan.ts';
import { DEFAULT_FREQ, DEFAULT_MINUTES, DEFAULT_SETTINGS, TASKS, priceAllTiers } from './pricing.ts';

test('step plan matches the contract', () => {
  assert.deepEqual(INITIAL_STEP, { step: 'reading', progress: 2 });
  assert.deepEqual(
    BUILD_STEPS.map((s) => `${s.progress} ${s.step}`),
    ['8 reading', '28 manuals', '50 tasks', '74 parts', '94 adjusting', '100 ready'],
  );
  assert.equal(STEP_INTERVAL_MS, 700);
  // Strictly increasing progress.
  BUILD_STEPS.forEach((s, i) => i && assert.ok(s.progress > BUILD_STEPS[i - 1].progress));
});

test('waitBeforeNext paces updates ~700 ms apart', () => {
  assert.equal(waitBeforeNext(1000, 1000), 700);
  assert.equal(waitBeforeNext(1000, 1500), 200);
  assert.equal(waitBeforeNext(1000, 2000), 0);
});

// Rows as seed_demo writes them (PRICING.md defaults).
const SETTINGS_ROW = { labor_rate: 94, trip_fee: 35, parts_markup: 0.25, tech_cost: 38, vehicle_cost: 12 };
const DEFAULT_ROWS = [
  { task_key: 'hvac', labor_min: 20, freq_high: 6, freq_recommended: 6, freq_medium: 4, freq_low: 2 },
  { task_key: 'fridge', labor_min: 10, freq_high: 2, freq_recommended: 2, freq_medium: 2, freq_low: 1 },
  { task_key: 'ice', labor_min: 25, freq_high: 4, freq_recommended: 2, freq_medium: 2, freq_low: 1 },
  { task_key: 'dish', labor_min: 15, freq_high: 12, freq_recommended: 6, freq_medium: 4, freq_low: 2 },
  { task_key: 'wh', labor_min: 40, freq_high: 2, freq_recommended: 2, freq_medium: 1, freq_low: 1 },
  { task_key: 'dryer', labor_min: 30, freq_high: 2, freq_recommended: 1, freq_medium: 1, freq_low: 0 },
  { task_key: 'smoke', labor_min: 10, freq_high: 4, freq_recommended: 2, freq_medium: 2, freq_low: 1 },
];

test('live rows at the defaults price exactly like the pricing module defaults', () => {
  const inputs = pricingInputs(SETTINGS_ROW, DEFAULT_ROWS);
  assert.deepEqual(inputs.settings, DEFAULT_SETTINGS);
  assert.deepEqual(inputs.minutes, DEFAULT_MINUTES);
  assert.deepEqual(inputs.freq, DEFAULT_FREQ);
  const home = { pets: true, water: 'city_hard' };
  const live = buildOptions(SETTINGS_ROW, DEFAULT_ROWS, home);
  const expected = priceAllTiers({ settings: DEFAULT_SETTINGS, minutes: DEFAULT_MINUTES, freq: DEFAULT_FREQ, home: { pets: true, water: 'city_hard' } });
  assert.deepEqual(live, expected);
  // Elena's seeded plan: PHP Recommended at $137.58/mo.
  assert.equal(live[1].monthly.toFixed(2), '137.58');
});

test('office edits flow into the quote (numeric strings, fraction markup)', () => {
  const inputs = pricingInputs(
    { labor_rate: '100', trip_fee: '40', parts_markup: '0.28', tech_cost: 38, vehicle_cost: 12 },
    [{ task_key: 'hvac', labor_min: 25, freq_high: 6, freq_recommended: 4, freq_medium: 4, freq_low: 2 }],
  );
  assert.equal(inputs.settings.rate, 100);
  assert.equal(inputs.settings.trip, 40);
  assert.equal(inputs.settings.markup, 28);
  assert.equal(inputs.minutes.hvac, 25);
  assert.deepEqual(inputs.freq.hvac, [6, 4, 4, 2]);
  // Untouched tasks keep defaults.
  assert.equal(inputs.minutes.wh, DEFAULT_MINUTES.wh);
  const higher = buildOptions({ ...SETTINGS_ROW, labor_rate: 120 }, DEFAULT_ROWS, { pets: true, water: 'city_hard' });
  const base = buildOptions(SETTINGS_ROW, DEFAULT_ROWS, { pets: true, water: 'city_hard' });
  assert.ok(higher[1].monthly > base[1].monthly);
});

test('missing rows fall back to the defaults', () => {
  const inputs = pricingInputs(null, null);
  assert.deepEqual(inputs.settings, DEFAULT_SETTINGS);
  assert.deepEqual(inputs.freq, DEFAULT_FREQ);
  // Defaults are copied, not shared.
  inputs.freq.hvac[0] = 99;
  assert.equal(DEFAULT_FREQ.hvac[0], 6);
});

test('homeProfile validates water and pets', () => {
  assert.deepEqual(homeProfile({ pets: true, water: 'well' }), { pets: true, water: 'well' });
  assert.deepEqual(homeProfile({ pets: null, water: 'lake' }), { pets: false, water: 'city_hard' });
  assert.deepEqual(homeProfile(null), { pets: false, water: 'city_hard' });
});

test('matchModels uses links first, then normalized model numbers', () => {
  const models = [
    { id: 'm-lg', model: 'LRMVS3006S' },
    { id: 'm-bosch', model: 'SHPM 88Z75N' },
  ];
  const ids = matchModels(
    [
      { model_id: 'm-carrier', model: '59TN6B100V21' },
      { model_id: null, model: 'lrmvs-3006s' },
      { model_id: null, model: 'SHPM88Z75N' },
      { model_id: null, model: 'UNKNOWN-1' },
      { model_id: 'm-carrier', model: '59TN6B100V21' },
    ],
    models,
  );
  assert.deepEqual(ids, ['m-carrier', 'm-lg', 'm-bosch']);
});

// Elena's model_tasks (seed_demo).
const ELENA_TASKS = [
  { task_key: 'hvac', part_number: '16x25x4-MERV11' },
  { task_key: 'fridge', part_number: 'LT1000P' },
  { task_key: 'ice', part_number: 'ICE-SANI' },
  { task_key: 'dish', part_number: 'AFFRESH-DW' },
  { task_key: 'wh', part_number: 'WH-DRAIN' },
  { task_key: 'dryer', part_number: null },
];

test('tasks and parts for Elena', () => {
  assert.equal(countTasks(ELENA_TASKS), 6);
  assert.deepEqual(partNumbersToPrice(ELENA_TASKS), ['16x25x4-MERV11', 'LT1000P', 'ICE-SANI', 'AFFRESH-DW', 'WH-DRAIN', '9V']);
  // A home with no manuals still prices every task's default part.
  assert.deepEqual(partNumbersToPrice([]), ['16x25x4-MERV11', 'LT1000P', 'ICE-SANI', 'AFFRESH-DW', 'WH-DRAIN', '9V']);
  // A manual's own part replaces the default for that task.
  assert.equal(partNumbersToPrice([{ task_key: 'hvac', part_number: '16x25x4-MERV13' }])[0], '16x25x4-MERV13');
});

test('lowestInStock picks the cheapest in-stock offer and counts suppliers', () => {
  const rows = [
    { part_number: '16x25x4-MERV11', description: 'MERV 11', supplier: 'Amazon', price: 76.8, in_stock: true },
    { part_number: '16x25x4-MERV11', description: 'MERV 11', supplier: "Lowe's", price: '79.98', in_stock: true },
    { part_number: '16x25x4-MERV11', description: 'MERV 11', supplier: 'Ferguson', price: 74.2, in_stock: false },
    { part_number: 'LT1000P', description: 'LG LT1000P', supplier: 'SupplyHouse', price: 47.5, in_stock: false },
    { part_number: 'LT1000P', description: 'LG LT1000P', supplier: 'Amazon', price: 49.97, in_stock: true },
    { part_number: 'WH-DRAIN', description: null, supplier: 'Home Depot', price: 6, in_stock: true },
    { part_number: 'NOPE', description: 'Out', supplier: 'Amazon', price: 5, in_stock: false },
  ];
  const { parts, suppliers } = lowestInStock(['16x25x4-MERV11', 'LT1000P', 'WH-DRAIN', 'NOPE'], rows);
  assert.deepEqual(
    parts.map((p) => [p.name, p.price, p.supplier]),
    [
      ['MERV 11', 76.8, 'Amazon'],
      ['LG LT1000P', 49.97, 'Amazon'],
      ['WH-DRAIN', 6, 'Home Depot'],
    ],
  );
  assert.equal(suppliers, 5);
});

test('seeded lowest prices match TASKS[].cost', () => {
  const byTask: Record<string, number> = { hvac: 76.8, fridge: 49.97, ice: 8.5, dish: 4.2, wh: 6, smoke: 12 };
  for (const t of TASKS) if (byTask[t.id] !== undefined) assert.equal(t.cost, byTask[t.id], t.id);
});
