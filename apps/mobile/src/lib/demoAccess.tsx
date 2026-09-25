// Demo access: every side of the live app opens without a login form.
//
// Each side ("account") silently signs in to its seeded demo login, so the
// app still runs on live data with real RLS and Realtime. Switching is local:
// the outgoing account is signed out on this device only (no POST /logout),
// so its refresh token stays valid and its session is cached for this tab.
// Coming back restores that cached session instead of signing in again:
// Supabase allows ~30 password sign-ins per 5 minutes per IP, and venue wifi
// puts every device behind one IP.
//
// EXPO_PUBLIC_DEMO_ACCESS=0 turns all of this off: the app is login-gated
// exactly as before (the launcher, auto-switching and "‹ All apps" go away).
//
// Cache: per browser tab in sessionStorage under `php-demo-sessions-<tabId>`
// (next to the tab's auth session, see lib/supabase.ts), in memory on native.
// It is kept current from auth events: every SIGNED_IN / TOKEN_REFRESHED
// (and INITIAL_SESSION) stores that account's latest tokens, because Supabase
// rotates refresh tokens and reusing a stale one can revoke the session.

import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { HO_KEYS, resetOnboardingDraft } from '../data/homeowner';
import { localSignOut, profileKey, useAdoptSession, waitForSignOut, withTimeout, type Role } from './auth';
import { SIGN_IN_MSG, friendlyError, isNetworkError, signInErrorMessage } from './errors';
import { queryClient } from './queryClient';
import { rpc } from './rpc';
import { supabase, webTabId } from './supabase';

/** On unless EXPO_PUBLIC_DEMO_ACCESS=0 (then the app is login-gated as before). */
export const DEMO_ACCESS = process.env.EXPO_PUBLIC_DEMO_ACCESS !== '0';

/** Public client config: every seeded demo login uses it (docs/DEMO_RUNBOOK.md). */
export const DEMO_PASSWORD = 'phpdemo2026';

export type DemoAccount = 'homeowner' | 'newhome' | 'tech' | 'vendor' | 'office';

export interface DemoAccountInfo {
  email: string;
  name: string;
  role: Role;
  /** Fixed by seed_demo / ensure_demo_users (docs/LIVE_ARCHITECTURE.md §6). */
  userId: string;
}

export const DEMO_ACCOUNTS: Record<DemoAccount, DemoAccountInfo> = {
  homeowner: { email: 'homeowner@php.test', name: 'Elena Alvarez', role: 'homeowner', userId: 'a0000000-0000-4000-8000-000000000005' },
  newhome: { email: 'newhome@php.test', name: 'Jordan Lee', role: 'homeowner', userId: 'a0000000-0000-4000-8000-000000000006' },
  tech: { email: 'tech@php.test', name: 'Marcus Reyes', role: 'tech', userId: 'a0000000-0000-4000-8000-000000000002' },
  vendor: { email: 'vendor@php.test', name: 'Sam Ortiz', role: 'vendor', userId: 'a0000000-0000-4000-8000-000000000004' },
  office: { email: 'office@php.test', name: 'Avery Brooks', role: 'office', userId: 'a0000000-0000-4000-8000-000000000001' },
};

const ACCOUNT_KEYS = Object.keys(DEMO_ACCOUNTS) as DemoAccount[];

/** The account a role's screens switch to when opened signed out or as another role. */
export const ROLE_ACCOUNT: Record<Role, DemoAccount> = { homeowner: 'homeowner', tech: 'tech', vendor: 'vendor', office: 'office' };

/** Which demo account a signed-in user is (by email, else by the fixed id). */
export function demoAccountOf(user: { id?: string | null; email?: string | null } | null | undefined): DemoAccount | null {
  if (!user) return null;
  const email = user.email?.trim().toLowerCase();
  return ACCOUNT_KEYS.find((a) => (email ? DEMO_ACCOUNTS[a].email === email : false) || DEMO_ACCOUNTS[a].userId === user.id) ?? null;
}

/** Which demo account a user id is, if any. */
export function demoAccountForUserId(userId: string | null | undefined): DemoAccount | null {
  return userId ? (ACCOUNT_KEYS.find((a) => DEMO_ACCOUNTS[a].userId === userId) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Session cache (per tab)
// ---------------------------------------------------------------------------

interface CachedSession {
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_at?: number;
}

type Cache = Partial<Record<DemoAccount, CachedSession>>;

const isWeb = Platform.OS === 'web';
let cache: Cache | null = null;

function tabStorage(): Storage | null {
  if (!isWeb) return null;
  try {
    return (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null; // storage blocked: memory only
  }
}

const cacheKey = () => `php-demo-sessions-${webTabId()}`;

function isCached(x: unknown): x is CachedSession {
  const c = x as Partial<CachedSession> | null;
  return !!c && typeof c.access_token === 'string' && typeof c.refresh_token === 'string' && typeof c.user_id === 'string';
}

function loadCache(): Cache {
  if (cache) return cache;
  const out: Cache = {};
  try {
    const raw = tabStorage()?.getItem(cacheKey());
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const a of ACCOUNT_KEYS) if (isCached(parsed[a])) out[a] = parsed[a] as CachedSession;
  } catch {
    // Unreadable: start empty (the next switch signs in with the password).
  }
  cache = out;
  return out;
}

function saveCache(next: Cache) {
  cache = next;
  try {
    tabStorage()?.setItem(cacheKey(), JSON.stringify(next));
  } catch {
    // Storage full or blocked: the in-memory copy still works until reload.
  }
}

function remember(session: Session | null | undefined) {
  const account = demoAccountOf(session?.user);
  if (!session || !account || !session.access_token || !session.refresh_token) return;
  const prev = loadCache()[account];
  if (prev && prev.access_token === session.access_token && prev.refresh_token === session.refresh_token) return;
  saveCache({
    ...loadCache(),
    [account]: { access_token: session.access_token, refresh_token: session.refresh_token, user_id: session.user.id, expires_at: session.expires_at },
  });
}

function forget(account: DemoAccount) {
  const c = loadCache();
  if (!c[account]) return;
  const next = { ...c };
  delete next[account];
  saveCache(next);
}

// ---------------------------------------------------------------------------
// Keep the cache current from auth events (whole app lifetime)
// ---------------------------------------------------------------------------

/** True while a switch runs: its SIGNED_OUT events are expected. */
let switchBusy = false;
/** The demo account of the session the auth client last reported. */
let lastAccount: DemoAccount | null = null;

if (supabase && DEMO_ACCESS) {
  // Only storage writes in here: calling back into supabase.auth from this callback can deadlock.
  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
      remember(session);
      lastAccount = demoAccountOf(session.user);
    } else if (event === 'SIGNED_OUT') {
      // Not ours (the session died, or the profile-error screen signed out): don't restore it again.
      if (!switchBusy && lastAccount) forget(lastAccount);
      lastAccount = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

export interface SwitchResult {
  /** A message written for users. */
  error?: string;
  /** A later switch replaced this one before it finished: the caller should do nothing. */
  superseded?: boolean;
}

/** How long one auth request may take before the switch gives up (requests also time out at 15 s). */
const AUTH_TIMEOUT_MS = 20_000;

let latestToken = 0;
let latest: { token: number; target: DemoAccount; promise: Promise<SwitchResult> } | null = null;
/** Switches run one at a time, in call order. */
let queue: Promise<unknown> = Promise.resolve();

// `switching` for React: the target of the latest switch still running.
let switchingTarget: DemoAccount | null = null;
const listeners = new Set<() => void>();
function setSwitching(t: DemoAccount | null) {
  if (switchingTarget === t) return;
  switchingTarget = t;
  for (const l of listeners) l();
}
const subscribeSwitching = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSwitching = () => switchingTarget;

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

async function currentSession(): Promise<{ session: Session | null; known: boolean }> {
  const sb = supabase!;
  try {
    const { data } = await withTimeout(sb.auth.getSession(), AUTH_TIMEOUT_MS);
    return { session: data.session ?? null, known: true };
  } catch {
    return { session: null, known: false };
  }
}

/**
 * One switch, from whatever this tab is signed in as to `target`:
 *  1. already `target` → done (no network);
 *  2. local sign-out of the current session (its refresh token stays valid);
 *  3. restore `target`'s cached session (setSession), else sign in with the password.
 * A newer switch requested meanwhile makes this one stop before it signs in,
 * leaving this tab signed out (never half-switched) for the newer one to finish.
 */
async function runSwitch(target: DemoAccount, token: number, adopt: (userId: string) => void): Promise<SwitchResult> {
  const sb = supabase;
  if (!sb) return { error: SIGN_IN_MSG.network };
  const info = DEMO_ACCOUNTS[target];
  const superseded = () => token !== latestToken;

  if (!(await waitForSignOut())) return { error: SIGN_IN_MSG.generic };
  const now = await currentSession();
  if (now.session && demoAccountOf(now.session.user) === target) {
    adopt(now.session.user.id);
    return {};
  }
  if (superseded()) return { superseded: true };

  if (now.session || !now.known) {
    try {
      await withTimeout(localSignOut(sb), 4_000);
    } catch {
      // Still clearing: wait for it like signIn does, so nothing of the old session lingers.
      if (!(await waitForSignOut())) return { error: SIGN_IN_MSG.generic };
    }
  }
  // SIGNED_OUT already scheduled a cache clear; wait for it, then make sure
  // nothing from the previous account survives into the next one.
  await nextTask();
  queryClient.clear();
  if (superseded()) return { superseded: true };

  const cached = loadCache()[target];
  if (cached) {
    try {
      const { data, error } = await withTimeout(
        sb.auth.setSession({ access_token: cached.access_token, refresh_token: cached.refresh_token }),
        AUTH_TIMEOUT_MS,
      );
      if (!error && data.session && demoAccountOf(data.session.user) === target) {
        remember(data.session);
        adopt(data.session.user.id);
        return {};
      }
      // A transport failure says nothing about the tokens: keep them, and don't
      // spend a password attempt that would fail the same way.
      if (error && isNetworkError(error)) return { error: SIGN_IN_MSG.network };
    } catch (e) {
      if (isNetworkError(e)) return { error: SIGN_IN_MSG.network };
    }
    // Revoked, expired for good, or someone else's: never try it again.
    forget(target);
    const after = await currentSession();
    if (after.session && demoAccountOf(after.session.user) !== target) {
      try {
        await withTimeout(localSignOut(sb), 4_000);
      } catch {
        if (!(await waitForSignOut())) return { error: SIGN_IN_MSG.generic };
      }
    }
    if (superseded()) return { superseded: true };
  }

  try {
    const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email: info.email, password: DEMO_PASSWORD }), AUTH_TIMEOUT_MS);
    if (error) return { error: signInErrorMessage(error) };
    if (!data.session?.user?.id) return { error: SIGN_IN_MSG.generic };
    remember(data.session);
    adopt(data.session.user.id);
    return {};
  } catch (e) {
    return { error: signInErrorMessage(e) };
  }
}

/**
 * Switch this tab to `target`. Calls run one at a time and the last call wins:
 * an earlier call that hasn't signed in yet resolves `{ superseded: true }`.
 * Calling again for the target that is already on its way returns the same promise.
 */
export function switchTo(target: DemoAccount, adopt: (userId: string) => void): Promise<SwitchResult> {
  if (latest && latest.target === target && latest.token === latestToken) return latest.promise;
  const token = ++latestToken;
  setSwitching(target);
  const run = queue.then(async (): Promise<SwitchResult> => {
    if (token !== latestToken) return { superseded: true };
    switchBusy = true;
    try {
      return await runSwitch(target, token, adopt);
    } finally {
      switchBusy = false;
    }
  });
  queue = run.catch(() => undefined);
  const promise = run
    .catch((e: unknown): SwitchResult => ({ error: signInErrorMessage(e) }))
    .then((r) => {
      if (token === latestToken) {
        setSwitching(null);
        latest = null;
      }
      return r;
    });
  latest = { token, target, promise };
  return promise;
}

export interface NewCustomerInput {
  fullName: string;
  email: string;
  phone?: string;
}

/**
 * The "New customer" sign-up: switch to the onboarding account (Jordan Lee),
 * turn it back into a brand-new customer under `fullName` (rpc
 * start_new_customer: deletes his home and everything on it, sets name and
 * phone), and start a fresh onboarding draft on step 1 with the name filled
 * in. Resolves once /homeowner will open onboarding. `email` is only checked
 * by the form: the demo account keeps its own login email.
 */
export async function startNewCustomer(input: NewCustomerInput, adopt: (userId: string) => void): Promise<SwitchResult> {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (!fullName) return { error: 'Enter your name.' };
  const s = await switchTo('newhome', adopt);
  if (s.error || s.superseded) return s;
  const now = await currentSession();
  const userId = now.session?.user?.id;
  // Another switch landed in between: the server would refuse anyway.
  if (!userId || demoAccountOf(now.session?.user) !== 'newhome') return { superseded: true };
  try {
    await rpc('start_new_customer', { p_full_name: fullName, p_phone: input.phone?.trim() || null });
  } catch (e) {
    return { error: friendlyError(e) };
  }
  try {
    await resetOnboardingDraft(userId, fullName);
  } catch {
    // The draft falls back to a fresh one with the profile's (new) name.
  }
  // Drop the old home and plan from the cache, then load the new state, so
  // /homeowner routes to onboarding and greets the new name right away.
  queryClient.removeQueries({ queryKey: HO_KEYS.all, predicate: (q) => q.queryKey[1] !== 'myHome' });
  try {
    await withTimeout(
      Promise.all([
        queryClient.invalidateQueries({ queryKey: HO_KEYS.myHome(userId), refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: profileKey(userId), refetchType: 'all' }),
      ]),
      AUTH_TIMEOUT_MS,
    );
  } catch {
    // Still loading: the screens show their own loading state and poll.
  }
  return {};
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface DemoAccessValue {
  /** Switch this tab to a demo account. No-op when it's already that account. */
  switchTo(account: DemoAccount): Promise<SwitchResult>;
  /** The account a switch is on its way to, or null. */
  switching: DemoAccount | null;
  /** Sign up a "new customer" on the onboarding account (see startNewCustomer). */
  startNewCustomer(input: NewCustomerInput): Promise<SwitchResult>;
}

/** Demo access for live mode (inside <SessionProvider>). */
export function useDemoAccess(): DemoAccessValue {
  const adopt = useAdoptSession();
  const switching = useSyncExternalStore(subscribeSwitching, getSwitching, getSwitching);
  const doSwitch = useCallback((a: DemoAccount) => switchTo(a, adopt), [adopt]);
  const doNew = useCallback((input: NewCustomerInput) => startNewCustomer(input, adopt), [adopt]);
  return useMemo(() => ({ switchTo: doSwitch, switching, startNewCustomer: doNew }), [doSwitch, switching, doNew]);
}
