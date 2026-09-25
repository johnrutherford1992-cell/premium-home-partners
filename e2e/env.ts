// Where the tests point: the app under test (E2E_BASE_URL or a local static
// server) and the Supabase project behind it (for API-level helpers).
// Shared by playwright.config.ts and the helpers, so it has no Playwright imports.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..');

/** Viewports: office on a desktop, every other role on a phone. */
export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 };
export const DESKTOP = { viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 };

/** Port for the local static server (e2e/serve.mjs) when E2E_BASE_URL is unset. */
export const PORT = Number(process.env.E2E_PORT || 8105);

/** Set when testing an already-running or deployed app. */
export const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL?.trim().replace(/\/+$/, '') || '';

export const BASE_URL = EXTERNAL_BASE_URL || `http://localhost:${PORT}`;

/** The exported web app the local server serves (npx expo export --platform web). */
export const DIST_DIR = resolve(ROOT, process.env.E2E_DIST_DIR || 'apps/mobile/dist');

export interface BackendConfig {
  url: string;
  anonKey: string;
  /** Where the values came from, for error messages. */
  source: string;
}

function parseDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

let cached: BackendConfig | null | undefined;

/**
 * The Supabase project for API helpers (resetDemo, RLS checks, session setup):
 * E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY, else EXPO_PUBLIC_SUPABASE_URL /
 * EXPO_PUBLIC_SUPABASE_ANON_KEY from apps/mobile/.env.local or apps/mobile/.env
 * (both git-ignored). The anon key is public client config, not a secret.
 */
export function backendConfig(): BackendConfig | null {
  if (cached !== undefined) return cached;
  const url = process.env.E2E_SUPABASE_URL?.trim();
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey) return (cached = { url: url.replace(/\/+$/, ''), anonKey, source: 'E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY' });
  for (const rel of ['apps/mobile/.env.local', 'apps/mobile/.env']) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) continue;
    const env = parseDotenv(file);
    const u = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
    const k = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (u && k) return (cached = { url: u.replace(/\/+$/, ''), anonKey: k, source: rel });
  }
  return (cached = null);
}

/** Live (backend) specs run unless no Supabase project is configured or E2E_OFFLINE=1. */
export function liveSkipReason(): string | null {
  if (process.env.E2E_OFFLINE === '1') return 'E2E_OFFLINE=1: live specs skipped.';
  if (!backendConfig()) {
    return 'No Supabase project configured: set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY (or apps/mobile/.env).';
  }
  return null;
}
