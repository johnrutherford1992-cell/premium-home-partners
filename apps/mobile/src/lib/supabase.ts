import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const isWeb = Platform.OS === 'web';

/** True when a Supabase project is configured through the EXPO_PUBLIC_* env vars. */
export const isSupabaseConfigured = Boolean(url && anonKey);

// ---------------------------------------------------------------------------
// Request timeouts
// ---------------------------------------------------------------------------
//
// fetch() has no timeout, so a stalled connection (conference wifi) would leave
// a query loading and a button saying "Submitting…" forever. Every Supabase
// request gets a deadline; the abort surfaces as a transport error, which
// friendlyError() maps to "Can't reach the server…" and React Query retries or
// polls again.

/** Photo uploads are large; lookup-appliance can take ~20 s. Everything else is small. */
export function requestTimeoutMs(requestUrl: string): number {
  if (requestUrl.includes('/storage/v1/')) return 45_000;
  if (requestUrl.includes('/functions/v1/')) return 35_000;
  return 15_000;
}

type FetchInput = Parameters<typeof fetch>[0];

function inputUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input && typeof (input as { href?: unknown }).href === 'string') return (input as URL).href;
  return String((input as Request)?.url ?? '');
}

function timeoutError(): Error {
  const e = new Error('Request timed out');
  e.name = 'TimeoutError';
  return e;
}

/** fetch with a deadline (see requestTimeoutMs). A caller's own signal still aborts it. */
export const timeoutFetch: typeof fetch = (input, init) => {
  const ctl = new AbortController();
  const caller = init?.signal ?? (input && typeof input === 'object' ? (input as Request).signal : undefined) ?? undefined;
  const onCallerAbort = () => ctl.abort(caller?.reason);
  if (caller) {
    if (caller.aborted) ctl.abort(caller.reason);
    else caller.addEventListener('abort', onCallerAbort);
  }
  const timer = setTimeout(() => ctl.abort(timeoutError()), requestTimeoutMs(inputUrl(input)));
  const done = () => {
    clearTimeout(timer);
    caller?.removeEventListener('abort', onCallerAbort);
  };
  return globalThis.fetch(input, { ...init, signal: ctl.signal }).then(
    (res) => {
      done();
      return res;
    },
    (err: unknown) => {
      done();
      throw err;
    },
  );
};

// ---------------------------------------------------------------------------
// Where the session lives
// ---------------------------------------------------------------------------
//
// Native: AsyncStorage under supabase-js's default key (unchanged).
//
// Web: every browser tab has its own session, so the four roles can be demoed
// side by side in four tabs of one browser. The session goes in sessionStorage
// (per tab, survives a reload) under `sb-php-auth-<tabId>`. auth-js names its
// cross-tab BroadcastChannel and its Web Lock after that key, so tabs don't
// hear each other's SIGNED_IN / SIGNED_OUT either.

/** sessionStorage key holding this tab's id (e2e/helpers.ts writes the same keys). */
export const TAB_ID_KEY = 'php-tab-id';

/** The auth storage key for a browser tab. */
export function webAuthStorageKey(tabId: string = webTabId()): string {
  return `sb-php-auth-${tabId}`;
}

function newTabId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const r = typeof c?.randomUUID === 'function' ? c.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2);
  return r.slice(0, 12) + Date.now().toString(36).slice(-4);
}

function webStore(name: 'sessionStorage' | 'localStorage'): Storage | null {
  try {
    const s = (globalThis as unknown as Record<string, Storage | undefined>)[name];
    return s ?? null;
  } catch {
    return null; // storage blocked
  }
}

let tabIdCache: string | null = null;

/**
 * This tab's id: created once and kept in sessionStorage, so a reload keeps
 * it (and the session). No duplicate-tab detection on purpose: telling a
 * duplicated tab from a reload needs unload events, which iOS Safari skips when
 * it reloads a page it killed in the background (for example after taking a
 * photo), and a false positive would sign the user out mid-visit. Open extra
 * roles in new tabs rather than with "Duplicate tab".
 */
export function webTabId(): string {
  if (tabIdCache) return tabIdCache;
  const ss = webStore('sessionStorage');
  let id: string | null = null;
  try {
    id = ss?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    id = null;
  }
  if (!id) {
    id = newTabId();
    try {
      ss?.setItem(TAB_ID_KEY, id);
    } catch {
      // sessionStorage blocked: this page load still gets its own id.
    }
  }
  tabIdCache = id;
  return id;
}

/** sessionStorage, or memory when the browser blocks it (the session then lasts until reload). */
function tabSessionStorage(): SupportedStorage {
  const mem = new Map<string, string>();
  const ss = () => webStore('sessionStorage');
  return {
    getItem: (k) => {
      try {
        const s = ss();
        return s ? s.getItem(k) : (mem.get(k) ?? null);
      } catch {
        return mem.get(k) ?? null;
      }
    },
    setItem: (k, v) => {
      try {
        const s = ss();
        if (s) s.setItem(k, v);
        else mem.set(k, v);
      } catch {
        mem.set(k, v);
      }
    },
    removeItem: (k) => {
      mem.delete(k);
      try {
        ss()?.removeItem(k);
      } catch {
        // Nothing stored there.
      }
    },
  };
}

/** supabase-js's default key, `sb-<project ref>-auth-token` (no URL parsing: RN's URL is partial). */
function defaultStorageKey(projectUrl: string): string {
  const host = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(projectUrl)?.[1] ?? '').toLowerCase();
  return `sb-${host.split('.')[0]}-auth-token`;
}

/** The storage and key this client keeps its session under (null when not configured). */
export const authStorage: { storage: SupportedStorage; key: string } | null = isSupabaseConfigured
  ? isWeb
    ? { storage: tabSessionStorage(), key: webAuthStorageKey() }
    : { storage: AsyncStorage, key: defaultStorageKey(url!) }
  : null;

/**
 * Remove the stored session directly, without a network call. Storage is
 * auth-js's source of truth, so a signOut() that follows finds no session,
 * skips POST /logout and only clears local state (see signOut in auth.tsx).
 */
export async function clearStoredSession(): Promise<void> {
  if (!authStorage) return;
  const { storage, key } = authStorage;
  for (const k of [key, `${key}-user`, `${key}-code-verifier`]) {
    try {
      await storage.removeItem(k);
    } catch {
      // Already gone, or storage unavailable: signOut() still clears the rest.
    }
  }
}

/**
 * Supabase client, or null when no project is configured (offline demo only).
 *
 * Magic links and OAuth are not used, so the URL is never parsed for a
 * session. Native uses an in-process lock; web keeps the default Web Locks
 * implementation (named after the per-tab storage key).
 */
export const supabase: SupabaseClient | null =
  isSupabaseConfigured && authStorage
    ? createClient(url!, anonKey!, {
        auth: {
          storage: authStorage.storage,
          ...(isWeb ? { storageKey: authStorage.key } : {}),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          ...(isWeb ? {} : { lock: processLock }),
        },
        // React Query owns retries (2, with backoff). PostgREST's own GET retry
        // (3 more per attempt) would stack to ~25 s before an error shows.
        db: { retry: false },
        global: { fetch: timeoutFetch },
      })
    : null;

/** The configured client. Only call this from live-mode code paths. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Native apps don't get visibility events, so token refresh only runs while
// the app is in the foreground (the pattern the Supabase React Native guide uses).
if (supabase && !isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** @deprecated Use `useMode()` from `src/lib/mode.ts`; kept for older imports. */
export const isDemoMode = supabase === null;
