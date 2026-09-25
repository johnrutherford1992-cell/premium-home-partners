// node --test --experimental-strip-types supabase/functions/_shared/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATE_SCHEMA,
  PLATE_SYSTEM_PROMPT,
  TASK_KEYS,
  clampInterval,
  cleanBase64,
  cleanModel,
  modelLikePattern,
  normModel,
  normalizePlate,
  parsePlateReply,
  pickCachedModel,
  platePrompt,
  resolveMediaType,
  tasksFromRows,
} from './appliance.ts';
import { TASKS } from './pricing.ts';

test('task keys are exactly the pricing tasks', () => {
  assert.deepEqual([...TASK_KEYS], TASKS.map((t) => t.id));
});

test('normModel ignores case, spaces and dashes', () => {
  assert.equal(normModel('lrmvs 3006s'), 'LRMVS3006S');
  assert.equal(normModel(' LRMVS-3006S '), 'LRMVS3006S');
  assert.equal(normModel('LRMVS–3006S'), 'LRMVS3006S');
  assert.equal(normModel('FD9912 00471'), 'FD991200471');
  assert.equal(normModel(null), '');
  assert.equal(cleanModel('  lrmvs   3006s '), 'LRMVS 3006S');
});

test('modelLikePattern allows separators between characters and escapes wildcards', () => {
  assert.equal(modelLikePattern('AB1'), 'A%B%1');
  assert.equal(modelLikePattern('A_1%'), 'A%\\_%1%\\%');
  assert.equal(modelLikePattern(''), '');
});

test('pickCachedModel confirms the over-matching ILIKE result', () => {
  const rows = [
    { id: '1', model: 'LRMVS3006SX' },
    { id: '2', model: 'LRMVS 3006S' },
  ];
  assert.equal(pickCachedModel(rows, 'LRMVS3006S')?.id, '2');
  assert.equal(pickCachedModel(rows, 'NOPE'), null);
  assert.equal(pickCachedModel(null, 'X'), null);
  assert.equal(pickCachedModel(rows, ''), null);
});

test('clampInterval rounds into 1..24', () => {
  assert.equal(clampInterval(0), 1);
  assert.equal(clampInterval(-5), 1);
  assert.equal(clampInterval(6.4), 6);
  assert.equal(clampInterval(60), 24);
  assert.equal(clampInterval('3'), 3);
  assert.equal(clampInterval('x'), null);
  assert.equal(clampInterval(null), null);
});

test('tasksFromRows keeps known keys in TASKS order', () => {
  const tasks = tasksFromRows([
    { task_key: 'ice', name: 'Drain & sanitize ice maker', interval_months: '6', part_number: 'ICE-SANI' },
    { task_key: 'bogus', name: 'x', interval_months: 1, part_number: null },
    { task_key: 'fridge', name: null, interval_months: 6, part_number: 'LT1000P' },
  ]);
  assert.deepEqual(tasks, [
    { task_key: 'fridge', name: 'Replace fridge water filter', interval_months: 6, part_number: 'LT1000P' },
    { task_key: 'ice', name: 'Drain & sanitize ice maker', interval_months: 6, part_number: 'ICE-SANI' },
  ]);
});

test('schema is structured-output friendly: every object closed with all keys required', () => {
  const walk = (s: Record<string, unknown>) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      const props = Object.keys(s.properties as object);
      assert.deepEqual([...(s.required as string[])].sort(), [...props].sort());
      for (const p of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(p);
    }
    if (s.type === 'array') walk(s.items as Record<string, unknown>);
    // Numeric/string constraints are not supported by structured outputs.
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength']) assert.ok(!(k in s), k);
  };
  walk(PLATE_SCHEMA as unknown as Record<string, unknown>);
  assert.deepEqual([...PLATE_SCHEMA.properties.tasks.items.properties.task_key.enum], [...TASK_KEYS]);
});

test('prompts name every task key and pass hints', () => {
  for (const k of TASK_KEYS) assert.match(PLATE_SYSTEM_PROMPT, new RegExp(`- ${k}: `));
  assert.equal(platePrompt({}), 'Read this appliance plate.');
  const p = platePrompt({ brand: ' LG ', model: 'LRMVS3006S', serial: '' });
  assert.match(p, /brand: LG/);
  assert.match(p, /model: LRMVS3006S/);
  assert.doesNotMatch(p, /serial:/);
});

const GOOD = {
  readable: true,
  brand: 'GE APPLIANCES',
  model: 'gne27jymfs',
  serial: 'ZS123456',
  name: 'GE refrigerator',
  category: 'refrigerator',
  note: 'Filter XWFE',
  tasks: [
    { task_key: 'ice', name: 'Sanitize ice maker', interval_months: 6, part_number: '' },
    { task_key: 'fridge', name: 'Replace water filter', interval_months: 6, part_number: 'xwfe' },
    { task_key: 'fridge', name: 'Duplicate', interval_months: 3, part_number: 'X' },
    { task_key: 'vacuum', name: 'Not ours', interval_months: 3, part_number: '' },
    { task_key: 'dish', name: 'Bad interval', interval_months: 'soon', part_number: '' },
    { task_key: 'wh', name: 'Way too long', interval_months: 120, part_number: '' },
  ],
};

test('normalizePlate validates, dedupes, clamps and orders', () => {
  const r = normalizePlate(GOOD);
  assert.ok(r);
  assert.equal(r.model, 'GNE27JYMFS');
  assert.equal(r.brand, 'GE APPLIANCES');
  assert.equal(r.serial, 'ZS123456');
  assert.equal(r.category, 'refrigerator');
  assert.equal(r.note, 'Filter XWFE');
  assert.deepEqual(r.tasks, [
    { task_key: 'fridge', name: 'Replace water filter', interval_months: 6, part_number: 'XWFE' },
    { task_key: 'ice', name: 'Sanitize ice maker', interval_months: 6, part_number: null },
    { task_key: 'wh', name: 'Way too long', interval_months: 24, part_number: null },
  ]);
});

test('normalizePlate rejects unreadable or unusable replies', () => {
  assert.equal(normalizePlate({ ...GOOD, readable: false }), null);
  assert.equal(normalizePlate({ ...GOOD, model: '' }), null);
  assert.equal(normalizePlate({ ...GOOD, model: '--' }), null);
  assert.equal(normalizePlate(null), null);
  assert.equal(normalizePlate([GOOD]), null);
  assert.equal(parsePlateReply('{not json'), null);
  assert.equal(parsePlateReply(''), null);
  assert.equal(parsePlateReply(JSON.stringify(GOOD))?.model, 'GNE27JYMFS');
});

test('normalizePlate fills gaps from hints and safe defaults', () => {
  const r = normalizePlate(
    { readable: true, brand: '', model: 'ABC123', serial: '', name: '', category: 'spaceship', note: '', tasks: 'nope' },
    { brand: 'Acme', serial: 'S-1' },
  );
  assert.deepEqual(r, { brand: 'Acme', model: 'ABC123', serial: 'S-1', name: 'Acme appliance', category: 'other', note: null, tasks: [] });
});

test('cleanBase64 strips data URLs and whitespace, converts URL-safe base64', () => {
  assert.deepEqual(cleanBase64('data:image/png;base64,iVBORw0K\nGgo='), { data: 'iVBORw0KGgo=', mediaType: 'image/png' });
  assert.deepEqual(cleanBase64('data:image/jpg;base64,/9j/4AAQ'), { data: '/9j/4AAQ', mediaType: 'image/jpeg' });
  assert.deepEqual(cleanBase64('ab-_'), { data: 'ab+/', mediaType: null });
  assert.equal(cleanBase64('not base64!'), null);
  assert.equal(cleanBase64(''), null);
  assert.equal(cleanBase64(42), null);
});

test('resolveMediaType prefers explicit, then prefix, then magic bytes', () => {
  assert.equal(resolveMediaType('image/webp', null, '/9j/'), 'image/webp');
  assert.equal(resolveMediaType('application/pdf', null, '/9j/'), null);
  assert.equal(resolveMediaType(undefined, 'image/gif', '/9j/'), 'image/gif');
  assert.equal(resolveMediaType(undefined, null, 'iVBORw0KGgoAAA'), 'image/png');
  assert.equal(resolveMediaType(undefined, null, '/9j/4AAQ'), 'image/jpeg');
});
