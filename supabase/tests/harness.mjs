// PGlite harness: a throwaway in-memory Postgres with Supabase stand-ins, all
// migrations in order, and supabase/seed.sql. Lets RLS and RPC tests run in CI
// without Docker or a Supabase project.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = join(here, '..');

const read = (...p) => readFileSync(join(supabaseDir, ...p), 'utf8');

const uid = (nn) => `a0000000-0000-4000-8000-0000000000${nn}`;

export const U = {
  office: uid('01'),
  marcus: uid('02'),
  dana: uid('03'),
  sam: uid('04'),
  elena: uid('05'),
  jordan: uid('06'),
  david: uid('07'),
  whit: uid('08'),
  priya: uid('09'),
  bell: uid('10'),
};

export const HOME = {
  elena: 'b0000000-0000-4000-8000-000000000005',
  david: 'b0000000-0000-4000-8000-000000000007',
  whit: 'b0000000-0000-4000-8000-000000000008',
  priya: 'b0000000-0000-4000-8000-000000000009',
  bell: 'b0000000-0000-4000-8000-000000000010',
};

export const VISIT = {
  elena: 'd0000000-0000-4000-8000-000000000005',
  david: 'd0000000-0000-4000-8000-000000000007',
  whit: 'd0000000-0000-4000-8000-000000000008',
  priya: 'd0000000-0000-4000-8000-000000000009',
  bell: 'd0000000-0000-4000-8000-000000000010',
};

export const VENDOR = {
  evergreen: 'e0000000-0000-4000-8000-000000000001',
  summit: 'e0000000-0000-4000-8000-000000000002',
  clearview: 'e0000000-0000-4000-8000-000000000003',
};

export const MIGRATIONS = readdirSync(join(supabaseDir, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** Fresh database: stubs, every migration, then seed.sql. */
export async function createDb({ seed = true } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read('tests', 'supabase-stubs.sql'));
  for (const f of MIGRATIONS) {
    try {
      await db.exec(read('migrations', f));
    } catch (e) {
      e.message = `${f}: ${e.message}`;
      throw e;
    }
  }
  if (seed) await db.exec(read('seed.sql'));
  return db;
}

/** Run fn(tx) as a signed-in user (role authenticated, JWT sub = userId), like PostgREST does. */
export function as(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    return fn(tx);
  });
}

/** Run fn(tx) as the anon role (no JWT subject). */
export function asAnon(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
    return fn(tx);
  });
}

const VOID_RPCS = new Set(['confirm_visit', 'reset_demo', 'seed_demo', 'ensure_demo_users']);

/**
 * Call public.<fn>(p_x => $1, ...) the way supabase.rpc does. Returns the row
 * as a plain object (composite results), the scalar, or null for void.
 */
export async function rpc(tx, fn, args = {}) {
  const names = Object.keys(args);
  const params = names.map((n) => {
    const v = args[n];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
  if (VOID_RPCS.has(fn)) {
    await tx.query(`select ${call}`, params);
    return null;
  }
  const r = await tx.query(`select to_jsonb(${call}) as r`, params);
  return r.rows[0].r;
}

export async function rows(tx, sql, params = []) {
  return (await tx.query(sql, params)).rows;
}

export async function one(tx, sql, params = []) {
  return (await tx.query(sql, params)).rows[0];
}

export async function count(tx, table, where = 'true', params = []) {
  const r = await tx.query(`select count(*)::int as n from ${table} where ${where}`, params);
  return r.rows[0].n;
}

export const TABLES = [
  'profiles', 'homes', 'appliances', 'appliance_models', 'model_tasks', 'parts', 'part_prices',
  'pricing_settings', 'task_defaults', 'plan_builds', 'plans', 'visits', 'visit_tasks', 'visit_photos',
  'reports', 'notices', 'vendors', 'quote_requests', 'bids', 'service_categories',
];

/** Row counts of every public table plus auth users/identities (as the database owner). */
export async function counts(db) {
  const out = {};
  for (const t of [...TABLES, 'auth.users', 'auth.identities', 'storage.objects']) out[t] = await count(db, t);
  return out;
}

/** The seeded scenario, table by table. */
export const SEED_COUNTS = {
  profiles: 10,
  homes: 5,
  appliances: 5,
  appliance_models: 5,
  model_tasks: 6,
  parts: 9,
  part_prices: 27,
  pricing_settings: 1,
  task_defaults: 7,
  plan_builds: 0,
  plans: 5,
  visits: 5,
  visit_tasks: 34,
  visit_photos: 0,
  reports: 0,
  notices: 5,
  vendors: 3,
  quote_requests: 0,
  bids: 0,
  service_categories: 6,
  'auth.users': 10,
  'auth.identities': 10,
  'storage.objects': 0,
};
