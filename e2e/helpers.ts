// Shared helpers: demo accounts, UI sign-in, per-role browser contexts,
// Supabase API clients (resetDemo, RLS checks), RPC assertions.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page, Response } from '@playwright/test';
import { BASE_URL, DESKTOP, PHONE, ROOT, backendConfig, liveSkipReason, type BackendConfig } from './env';
import { expect, guardConsole, test } from './fixtures';

// ---------------------------------------------------------------------------
// Accounts and seed ids (docs/LIVE_ARCHITECTURE.md §6, seed_demo())
// ---------------------------------------------------------------------------

export type Account = 'homeowner' | 'newhome' | 'tech' | 'vendor' | 'office';

export const PASSWORD = 'phpdemo2026';

export const ACCOUNTS: Record<Account, { email: string; name: string; userId: string; landingPath: string; landing: RegExp }> = {
  homeowner: { email: 'homeowner@php.test', name: 'Elena Alvarez', userId: 'a0000000-0000-4000-8000-000000000005', landingPath: '/homeowner', landing: /\/homeowner\/home\/?$/ },
  newhome: { email: 'newhome@php.test', name: 'Jordan Lee', userId: 'a0000000-0000-4000-8000-000000000006', landingPath: '/homeowner', landing: /\/homeowner\/onboarding\/?$/ },
  tech: { email: 'tech@php.test', name: 'Marcus Reyes', userId: 'a0000000-0000-4000-8000-000000000002', landingPath: '/tech', landing: /\/tech\/?$/ },
  vendor: { email: 'vendor@php.test', name: 'Sam Ortiz', userId: 'a0000000-0000-4000-8000-000000000004', landingPath: '/vendor', landing: /\/vendor\/?$/ },
  office: { email: 'office@php.test', name: 'Avery Brooks', userId: 'a0000000-0000-4000-8000-000000000001', landingPath: '/office', landing: /\/office\/pricing\/?$/ },
};

/** Fixed ids created by seed_demo() (supabase/migrations/20260925000000_live.sql). */
export const SEED = {
  users: {
    office: 'a0000000-0000-4000-8000-000000000001',
    marcus: 'a0000000-0000-4000-8000-000000000002',
    dana: 'a0000000-0000-4000-8000-000000000003',
    sam: 'a0000000-0000-4000-8000-000000000004',
    elena: 'a0000000-0000-4000-8000-000000000005',
    jordan: 'a0000000-0000-4000-8000-000000000006',
  },
  homes: { elena: 'b0000000-0000-4000-8000-000000000005' },
  visits: { elena: 'd0000000-0000-4000-8000-000000000005', priya: 'd0000000-0000-4000-8000-000000000009' },
  vendors: { evergreen: 'e0000000-0000-4000-8000-000000000001' },
  /** Elena's checklist (recommended tier, all seven tasks). */
  taskKeys: ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'],
} as const;

/** A small real JPEG for the tech "+ Photo" upload. */
export const FILTER_JPG = join(ROOT, 'e2e/fixtures/filter.jpg');

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export { DESKTOP, PHONE };

/** Office runs on a desktop; everyone else on a phone. */
export const deviceFor = (a: Account): BrowserContextOptions => (a === 'office' ? DESKTOP : PHONE);

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

/** Call inside a describe: skips it when no Supabase project is configured (see e2e/env.ts). */
export function requireBackend(): void {
  const reason = liveSkipReason();
  test.skip(reason !== null, reason ?? '');
}

function backend(): BackendConfig {
  const cfg = backendConfig();
  if (!cfg) throw new Error(liveSkipReason() ?? 'No Supabase project configured.');
  return cfg;
}

/**
 * On web the app keeps one session per browser tab, in sessionStorage
 * (apps/mobile/src/lib/supabase.ts): the tab's id under `php-tab-id`, and the
 * session under `sb-php-auth-<tab id>`. Keep these two in step with TAB_ID_KEY
 * and webAuthStorageKey() there.
 */
export const TAB_ID_KEY = 'php-tab-id';
export function webAuthStorageKey(tabId: string): string {
  return `sb-php-auth-${tabId}`;
}

/** The tab's demo-access session cache (apps/mobile/src/lib/demoAccess.tsx): `{ [account]: tokens }`. */
export function demoSessionsKey(tabId: string): string {
  return `php-demo-sessions-${tabId}`;
}

// ---------------------------------------------------------------------------
// Sessions and API clients
// ---------------------------------------------------------------------------
//
// Supabase allows 30 password sign-ins per 5 minutes per IP by default, and
// the bar is 3 full runs in a row. So only auth.spec signs in through the UI;
// every other spec signs each role in once over the API and hands that session
// to the browser (the same per-tab sessionStorage entries the app itself
// writes; see injectSession). Sessions
// are cached in e2e/output/.auth (git-ignored, never uploaded by e2e.yml) and
// reused across runs while they have 20+ minutes left. The browser never needs
// to refresh them, so contexts sharing one session don't race on refresh-token
// rotation. E2E_LOGIN=ui makes openAs() use the sign-in form instead.

const SESSION_DIR = join(ROOT, 'e2e/output/.auth');
const MIN_TTL_S = 20 * 60;
const sessions = new Map<Account, Session>();
const clients = new Map<Account, SupabaseClient>();

const NO_PERSIST = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Enough life left for a spec file: 20 minutes, or half the token lifetime if the project issues shorter ones. */
function fresh(s: Session | undefined | null): s is Session {
  if (!s?.access_token || !s.expires_at) return false;
  const need = Math.min(MIN_TTL_S, (s.expires_in || 3600) / 2);
  return s.expires_at - Date.now() / 1000 > need;
}

/** A signed-in session for this demo account (cached; see above). */
export async function sessionFor(account: Account): Promise<Session> {
  const cfg = backend();
  const mem = sessions.get(account);
  if (fresh(mem)) return mem;
  const file = join(SESSION_DIR, `${account}.json`);
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { url: string; session: Session };
    if (saved.url === cfg.url && fresh(saved.session)) {
      sessions.set(account, saved.session);
      return saved.session;
    }
  } catch {
    // No usable cached session: sign in below.
  }
  const sb = createClient(cfg.url, cfg.anonKey, { auth: NO_PERSIST });
  const { data, error } = await sb.auth.signInWithPassword({ email: ACCOUNTS[account].email, password: PASSWORD });
  if (error || !data.session) {
    throw new Error(`API sign-in as ${ACCOUNTS[account].email} failed: ${error?.message ?? 'no session'} (Supabase from ${cfg.source})`);
  }
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ url: cfg.url, session: data.session }));
  sessions.set(account, data.session);
  clients.delete(account);
  return data.session;
}

/** supabase-js client acting as this demo account (PostgREST, RPCs, functions). */
export async function api(account: Account): Promise<SupabaseClient> {
  const session = await sessionFor(account);
  const hit = clients.get(account);
  if (hit) return hit;
  const cfg = backend();
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: NO_PERSIST,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  clients.set(account, sb);
  return sb;
}

/** supabase-js client with no user (the anon role). */
export function anonClient(): SupabaseClient {
  const cfg = backend();
  return createClient(cfg.url, cfg.anonKey, { auth: NO_PERSIST });
}

/** Restore the demo scenario: rpc reset_demo as the office manager. */
export async function resetDemo(): Promise<void> {
  const sb = await api('office');
  const { error } = await sb.rpc('reset_demo');
  if (error) throw new Error(`reset_demo failed: ${error.message} (${error.code ?? 'no code'})`);
}

/** YYYY-MM-DD in America/Chicago, `days` from today. */
export function chicagoDate(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

// ---------------------------------------------------------------------------
// UI sign-in
// ---------------------------------------------------------------------------
//
// The live app opens every side without a login (demo access): the launcher
// at / and every role's screens switch the tab to that role's default demo
// account (/homeowner → Elena). So a page that must be a *specific* account
// (Jordan) signs in through /login explicitly, or gets an injected session,
// and expectAccount() checks who the tab really is.

/** The user id this tab is signed in as, from the app's per-tab auth storage (null when signed out). */
export async function signedInUserId(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ tabIdKey, prefix }) => {
      try {
        const id = sessionStorage.getItem(tabIdKey);
        const raw = id ? sessionStorage.getItem(prefix + id) : null;
        const s = raw ? (JSON.parse(raw) as { user?: { id?: string } }) : null;
        return s?.user?.id ?? null;
      } catch {
        return null;
      }
    },
    { tabIdKey: TAB_ID_KEY, prefix: webAuthStorageKey('') },
  );
}

/** The tab is signed in as exactly this demo account (not just the right role). */
export async function expectAccount(page: Page, account: Account): Promise<void> {
  const a = ACCOUNTS[account];
  await expect
    .poll(() => signedInUserId(page), { timeout: 30_000, message: `this tab should be signed in as ${a.email}` })
    .toBe(a.userId);
}

/** Wait for the account's landing screen: its URL and the app-exit link ("‹ All apps", or "Sign out" when login-gated). */
export async function expectLanding(page: Page, account: Account): Promise<void> {
  const a = ACCOUNTS[account];
  await expect(page, `${a.email} should land on ${a.landing}`).toHaveURL(a.landing, { timeout: 30_000 });
  await expect(shown(page.getByTestId('app-exit'))).toBeVisible();
}

/**
 * Sign in through the real login screen (login-email / login-password /
 * login-submit), always at /login itself: a guarded screen would switch to
 * the role's default account instead.
 */
export async function login(page: Page, account: Account): Promise<void> {
  const a = ACCOUNTS[account];
  await page.goto('/login');
  await expect(
    page.getByTestId('login-email'),
    'The sign-in form never appeared. Is the app under test a live build (EXPO_PUBLIC_SUPABASE_URL set at build time)?',
  ).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('login-email').fill(a.email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  // Either we leave /login or the form shows an error; report the error text.
  const loginError = page.getByTestId('login-error');
  await expect
    .poll(
      async () => ((await loginError.isVisible()) ? 'error' : /\/login\/?$/.test(new URL(page.url()).pathname) ? 'pending' : 'left'),
      { timeout: 30_000, message: `sign-in as ${a.email} never completed` },
    )
    .not.toBe('pending');
  if (await loginError.isVisible()) throw new Error(`Sign-in as ${a.email} failed: ${await loginError.innerText()}`);
  await expectLanding(page, account);
  await expectAccount(page, account);
}

// ---------------------------------------------------------------------------
// Per-role browser contexts (multi-device specs)
// ---------------------------------------------------------------------------

export interface RolePage {
  account: Account;
  context: BrowserContext;
  page: Page;
}

/**
 * Sign every page (browser tab) this context opens in with `session`: on a
 * tab's first load, give it a tab id and the session under that tab's key,
 * exactly as the app stores it. Later loads in the same tab (reloads,
 * page.goto) keep whatever the app has written since, so a sign-out sticks.
 * Each tab gets its own id, as real tabs do; the app treats a second live tab
 * with the same id as a duplicate and signs it out.
 */
async function injectSession(context: BrowserContext, session: Session): Promise<void> {
  await context.addInitScript(
    ({ value, tabIdKey, keyPrefix }) => {
      try {
        if (sessionStorage.getItem(tabIdKey)) return;
        const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(tabIdKey, id);
        sessionStorage.setItem(keyPrefix + id, value);
      } catch {
        // about:blank and other opaque origins have no sessionStorage.
      }
    },
    { value: JSON.stringify(session), tabIdKey: TAB_ID_KEY, keyPrefix: webAuthStorageKey('') },
  );
}

/**
 * A signed-in device for exactly this account: its own browser context
 * (office on a 1280×900 desktop, everyone else on a 390×844 phone) with the
 * console guard attached. Opens `path` (default: the account's landing
 * screen), waits for `ready` (default: the app-exit link), then checks the
 * tab is this account and not a role default the app switched to (e.g. Elena
 * instead of Jordan, if the injected session had been refused).
 */
export async function openAs(
  browser: Browser,
  account: Account,
  opts: {
    path?: string;
    ready?: (page: Page) => Locator;
    device?: BrowserContextOptions;
    /** Runs before the first navigation, e.g. to add context.route() handlers. */
    setup?: (context: BrowserContext) => Promise<void>;
  } = {},
): Promise<RolePage> {
  const viaForm = process.env.E2E_LOGIN === 'ui';
  const session = viaForm ? null : await sessionFor(account);
  const context = await browser.newContext({
    ...(opts.device ?? deviceFor(account)),
    baseURL: BASE_URL,
  });
  if (session) await injectSession(context, session);
  guardConsole(context, account);
  await opts.setup?.(context);
  const page = await context.newPage();
  if (session) {
    await page.goto(opts.path ?? ACCOUNTS[account].landingPath);
  } else {
    await login(page, account);
    if (opts.path) await page.goto(opts.path);
  }
  const ready = opts.ready ? opts.ready(page) : page.getByTestId('app-exit');
  const loginForm = page.getByTestId('login-email');
  await expect(ready.or(loginForm).first()).toBeVisible({ timeout: 30_000 });
  if (await loginForm.isVisible()) {
    throw new Error(
      `${account}: the app showed the sign-in form, so it did not accept the injected session. ` +
        `Check that the app under test (${BASE_URL}) was built against ${backend().url}.`,
    );
  }
  await expect(ready).toBeVisible();
  const who = await signedInUserId(page);
  if (who !== ACCOUNTS[account].userId) {
    throw new Error(
      `${account}: the tab is signed in as ${who ?? 'nobody'}, not ${ACCOUNTS[account].email} (${ACCOUNTS[account].userId}). ` +
        `The app did not accept the ${session ? 'injected session' : 'form sign-in'}; check that ${BASE_URL} was built against ${backend().url}.`,
    );
  }
  return { account, context, page };
}

// ---------------------------------------------------------------------------
// Offline demo
// ---------------------------------------------------------------------------

/**
 * Start this page in offline demo mode (the persisted mode store, as if the
 * login screen's toggle had been used) and, optionally, with part of the demo
 * store preset (e.g. { step: 6 } = onboarded). Only fills keys the app hasn't
 * written yet, so it survives reloads. Call before the first page.goto().
 */
export async function presetDemo(page: Page, demoState?: Record<string, unknown>): Promise<void> {
  await page.addInitScript((state) => {
    try {
      if (!localStorage.getItem('php-mode-v1')) localStorage.setItem('php-mode-v1', JSON.stringify({ state: { mode: 'demo' }, version: 0 }));
      if (state && !localStorage.getItem('php-demo-v1')) localStorage.setItem('php-demo-v1', JSON.stringify({ state, version: 0 }));
    } catch {
      // Storage blocked: the app falls back to its defaults.
    }
  }, demoState ?? null);
}

export async function closeAll(...roles: (RolePage | undefined)[]): Promise<void> {
  await Promise.all(roles.map((r) => r?.context.close().catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Run `action` and wait for the app's POST /rest/v1/rpc/<fn>. Asserts it
 * succeeded and, when given, that the request body contains `args`.
 */
export async function expectRpc(
  page: Page,
  fn: string,
  action: () => Promise<unknown>,
  args?: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; response: Response }> {
  const waiting = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/rest/v1/rpc/${fn}`),
    { timeout: 30_000 },
  );
  await action();
  const response = await waiting;
  const body = (response.request().postDataJSON() ?? {}) as Record<string, unknown>;
  expect(response.ok(), `rpc ${fn} answered HTTP ${response.status()}: ${await response.text().catch(() => '')}`).toBe(true);
  if (args) expect(body, `rpc ${fn} arguments`).toMatchObject(args);
  return { body, response };
}

/** Mark the document so expectNoReload() can prove an update arrived without a page load. */
export async function markNoReload(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload = true;
  });
}

export async function expectNoReload(page: Page): Promise<void> {
  const same = await page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload === true);
  expect(same, 'the page reloaded; the update should have arrived live').toBe(true);
}

/**
 * Only the rendered matches. The web stack keeps screens you navigated away
 * from mounted but hidden (display: none), so text can exist twice.
 */
export function shown(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/** "$1,234" → 1234 (the first dollar amount in the text). */
export function dollars(text: string): number {
  const m = /\$\s*(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error(`No dollar amount in "${text}"`);
  return Number(m[1].replace(/,/g, ''));
}

/**
 * Nothing runs off the side at this viewport:
 * 1. the document never scrolls sideways (scrollWidth ≤ innerWidth), and
 * 2. no vertical scroller (a React Native ScrollView) holds content wider than
 *    itself. RN-web clips those with overflow-x: hidden, so an overflow there is
 *    cut off without ever widening the document. Horizontal scrollers (the
 *    office tables) are meant to scroll and are skipped.
 */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const m = await page.evaluate(() => {
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.clientWidth === 0) continue; // hidden stack screens measure 0
      const vertical = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      const horizontal = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      if (vertical && !horizontal && el.scrollWidth > el.clientWidth + 1) {
        const id = el.closest('[data-testid]')?.getAttribute('data-testid');
        clipped.push(`${el.tagName.toLowerCase()}${id ? ` in [data-testid=${id}]` : ''}: content ${el.scrollWidth}px in ${el.clientWidth}px`);
      }
    }
    return { scrollWidth: (document.scrollingElement ?? document.documentElement).scrollWidth, innerWidth: window.innerWidth, clipped };
  });
  expect(m.scrollWidth, `${label}: document scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`).toBeLessThanOrEqual(m.innerWidth);
  expect(m.clipped, `${label}: content wider than its scroll view`).toEqual([]);
}
