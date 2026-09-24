import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FREQ,
  DEFAULT_MINUTES,
  DEFAULT_SETTINGS,
  adjustedFreq,
  buildSchedule,
  priceAllTiers,
  TASKS,
} from '../src/index.ts';

const home = { pets: true, water: 'city_hard' as const };
const base = { settings: DEFAULT_SETTINGS, minutes: DEFAULT_MINUTES, freq: DEFAULT_FREQ, home };

test('PHP Recommended matches the prototype default quote', () => {
  const rec = priceAllTiers(base)[1];
  // parts: 6·76.8 + 2·49.97 + 2·8.5 + 6·4.2 + 2·6 + 0 + 2·12 = 638.94
  assert.equal(rec.partsRaw.toFixed(2), '638.94');
  // minutes: 6·20 + 2·10 + 2·25 + 6·15 + 2·40 + 1·30 + 2·10 = 410
  assert.equal(rec.hours.toFixed(4), (410 / 60).toFixed(4));
  assert.equal(Math.round(rec.annual), Math.round(638.94 * 1.25 + (410 / 60) * 94 + 6 * 35));
});

test('tiers are ordered by price', () => {
  const m = priceAllTiers(base).map((q) => q.monthly);
  assert.ok(m[0] > m[1] && m[1] > m[2] && m[2] > m[3]);
});

test('no pets caps HVAC filters at 4/yr', () => {
  assert.equal(adjustedFreq('hvac', 0, DEFAULT_FREQ, { pets: false, water: 'city_hard' }), 4);
  assert.equal(adjustedFreq('hvac', 0, DEFAULT_FREQ, home), 6);
});

test('well water drops a heater flush but keeps at least one', () => {
  assert.equal(adjustedFreq('wh', 0, DEFAULT_FREQ, { pets: true, water: 'well' }), 1);
  assert.equal(adjustedFreq('wh', 3, DEFAULT_FREQ, { pets: true, water: 'well' }), 1);
});

test('frequency never exceeds visit count', () => {
  // dishwasher is 12/yr on High but Low only visits twice
  assert.equal(adjustedFreq('dish', 3, { ...DEFAULT_FREQ, dish: [12, 12, 12, 12] }, home), 2);
});

test('first visit is the baseline with every active task', () => {
  const s = buildSchedule(1, DEFAULT_FREQ, home);
  assert.equal(s.length, 6);
  assert.deepEqual(s[0].taskIds, TASKS.map((t) => t.id));
  // each task appears exactly f times across the year
  for (const t of TASKS) {
    const f = adjustedFreq(t.id, 1, DEFAULT_FREQ, home);
    assert.equal(s.filter((v) => v.taskIds.includes(t.id)).length, f, t.id);
  }
});

test('margin is positive at default settings', () => {
  for (const q of priceAllTiers(base)) assert.ok(q.margin > 0.2, q.tier.name);
});
