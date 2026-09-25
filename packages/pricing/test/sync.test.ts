// The edge functions import supabase/functions/_shared/pricing.ts, a generated
// copy of src/index.ts. This fails when the copy drifts; fix with `npm run sync:pricing`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(join(root, 'packages/pricing/src/index.ts'), 'utf8');
const copy = readFileSync(join(root, 'supabase/functions/_shared/pricing.ts'), 'utf8');

test('edge function pricing copy matches packages/pricing (modulo the generated header)', () => {
  assert.ok(copy.endsWith(source), 'supabase/functions/_shared/pricing.ts is stale. Run: npm run sync:pricing');
  const header = copy.slice(0, copy.length - source.length);
  assert.match(header, /GENERATED FILE/);
  for (const line of header.split('\n')) {
    assert.ok(line === '' || line.startsWith('//'), `header must be comments only, got: ${line}`);
  }
});

test('sync-pricing --check agrees', () => {
  const res = spawnSync(process.execPath, [join(root, 'scripts/sync-pricing.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});
