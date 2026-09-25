#!/usr/bin/env node
// Copies packages/pricing/src/index.ts to supabase/functions/_shared/pricing.ts
// so the edge functions price plans with the exact same code as the app.
//
//   npm run sync:pricing                      write the copy
//   node scripts/sync-pricing.mjs --check     exit 1 if the copy has drifted

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/pricing/src/index.ts');
const target = join(root, 'supabase/functions/_shared/pricing.ts');

const HEADER = [
  '// GENERATED FILE. Do not edit by hand.',
  '// Source: packages/pricing/src/index.ts, copied by `npm run sync:pricing`.',
  '// `node scripts/sync-pricing.mjs --check` (and packages/pricing/test/sync.test.ts) fail when it drifts.',
  '',
  '',
].join('\n');

const expected = HEADER + readFileSync(source, 'utf8');
const rel = (p) => relative(root, p);

if (process.argv.includes('--check')) {
  let current = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = null;
  }
  if (current !== expected) {
    console.error(`${rel(target)} is out of date with ${rel(source)}. Run: npm run sync:pricing`);
    process.exit(1);
  }
  console.log(`${rel(target)} is in sync.`);
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${rel(target)} from ${rel(source)}.`);
}
