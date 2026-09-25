// Email + password auth against Supabase, plus the signed-in user's profile.
// <SessionProvider> is mounted by the root layout in live mode only.

import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FriendlyError, SIGN_IN_MSG, friendlyError, isAuthExpiredError, isNetworkError, signInErrorMessage, toFriendlyError } from './errors';
import { queryClient } from './queryClient';
import { clearStoredSession, supabase } from './supabase';

export type Role = 'homeowner' | 'tech' | 'vendor' | 'office';
export type RoleHome = '/homeowner' | '/tech' | '/vendor' | '/office';

export const ROLE_HOME: Record<Role, RoleHome> = {
  homeowner: '/homeowner',
  tech: '/tech',
  vendor: '/vendor',
  office: '/office',
};

export interface Profile {
  id: string;
  role: Role;
  fullName: string;
}

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionValue {
  status: SessionStatus;
  userId: string | null;
  profile: Profile | null;
  /** Set when signed in but the profile couldn't be loaded (status is 'signedIn', profile null). */
  profileError: string | null;
  refreshProfile(): void;
  /** Resolves `{}` on success or `{ error }` with a message written for users. */
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
}

const SIGNED_OUT: SessionValue = {
  status: 'signedOut',
  userId: null,
  profile: null,
  profileError: null,
  refreshProfile: () => {},
  signIn: async () => ({ error: SIGN_IN_MSG.network }),
  signOut: async () => {},
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Internal to lib/demoAccess.tsx: after it moves the auth client to another
 * account's session, it reports the new user id here, the way signIn does.
 */
const AdoptContext = createContext<((userId: string) => void) | null>(null);
const noAdopt = () => {};

/** @internal The SessionProvider's "this user is now signed in" setter (a no-op outside it). */
export function useAdoptSession(): (userId: string) => void {
  return useContext(AdoptContext) ?? noAdopt;
}

const ROLES: readonly Role[] = ['homeowner', 'tech', 'vendor', 'office'];

export const profileKey = (userId: string | null) => ['session', 'profile', userId] as const;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error('Request timed out');
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------
//
// Sign-out is local only: it never waits on the network. supabase-js's
// signOut({ scope: 'local' }) still POSTs /logout first and only then removes
// "the current session" from storage. If that request is slow, a sign-in made
// meanwhile has already saved a new session, and the late removal deletes the
// NEW user's session and emits SIGNED_OUT (which clears the query cache): you
// sign in as the vendor and land back on /login. So we
//   1. remove the stored session ourselves (clearStoredSession, no network);
//   2. call signOut({ scope: 'local' }), which now finds no session, skips the
//      /logout request and just clears auth-js's state and emits SIGNED_OUT;
//   3. keep that promise in `signingOut`; signIn waits for it before it
//      signs in, so nothing from the old session can touch the new one.
// The server-side revoke is skipped on purpose: the refresh token is gone from
// this device either way, the demo accounts are shared, and it keeps a stage
// network hiccup out of the sign-out path. (Revoking would also end a
// duplicated tab's copy of the same session.)

let signingOut: Promise<void> | null = null;

/** Local-only sign-out (see above). Also used by lib/demoAccess.tsx to switch accounts. */
export function localSignOut(sb: SupabaseClient): Promise<void> {
  const run: Promise<void> = (async () => {
    await clearStoredSession();
    await sb.auth.signOut({ scope: 'local' });
  })()
    .catch(() => {
      // Storage is already cleared; auth-js state resets on its next read.
    })
    .finally(() => {
      if (signingOut === run) signingOut = null;
    });
  signingOut = run;
  return run;
}

/** How long a sign-in waits for a sign-out still in progress (it is local, so normally milliseconds). */
export const SIGN_OUT_WAIT_MS = 12_000;

/** Wait for a sign-out still in progress. False if it didn't finish within `ms`. */
export async function waitForSignOut(ms: number = SIGN_OUT_WAIT_MS): Promise<boolean> {
  const pending = signingOut;
  if (!pending) return true;
  try {
    await withTimeout(pending, ms);
    return true;
  } catch {
    return false;
  }
}

async function fetchProfile(userId: string): Promise<Profile> {
  if (!supabase) throw new FriendlyError('Supabase is not configured.');
  const { data, error, status } = await supabase.from('profiles').select('id, role, full_name, email').eq('id', userId).maybeSingle();
  if (error) throw toFriendlyError(status === 0 ? { ...error, status: 0 } : error);
  if (!data) throw new FriendlyError("Your account isn't set up yet. Ask the office to finish it.");
  const role = ROLES.includes(data.role as Role) ? (data.role as Role) : 'homeowner';
  const email = typeof data.email === 'string' ? data.email : '';
  return { id: data.id as string, role, fullName: (data.full_name as string | null)?.trim() || email.split('@')[0] || '' };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // undefined = not known yet, null = signed out.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const lastUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setUserId(null);
      return;
    }
    let alive = true;
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      const next = session?.user?.id ?? null;
      setUserId(next);
      if (event === 'SIGNED_OUT') setTimeout(() => queryClient.clear(), 0);
    });
    // If auth never reports an initial session (storage or network stuck), fall back to the sign-in screen.
    const fallback = setTimeout(() => {
      if (alive) setUserId((u) => (u === undefined ? null : u));
    }, 8000);
    return () => {
      alive = false;
      clearTimeout(fallback);
      data.subscription.unsubscribe();
    };
  }, []);

  // A different user on this device never sees the previous user's cache.
  useEffect(() => {
    const prev = lastUser.current;
    lastUser.current = userId;
    if (prev && userId && prev !== userId) queryClient.clear();
  }, [userId]);

  const profileQ = useQuery({
    queryKey: profileKey(userId ?? null),
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    meta: { tables: ['profiles'] },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // An expired JWT (e.g. the device slept through a refresh) surfaces as a
  // query error: try one refresh, and sign out locally if the session is gone.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let last = 0;
    return queryClient.getQueryCache().subscribe((ev) => {
      if (ev.type !== 'updated' || ev.action.type !== 'error' || !isAuthExpiredError(ev.action.error)) return;
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      void sb.auth.refreshSession().then(({ error }) => {
        if (error && !isNetworkError(error)) void localSignOut(sb);
      });
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error?: string }> => {
    const sb = supabase;
    const e = email.trim().toLowerCase();
    if (!e || !password) return { error: SIGN_IN_MSG.missing };
    if (!sb) return { error: SIGN_IN_MSG.network };
    // Finish a sign-out still in progress first (the button keeps saying "Signing in…").
    const pending = signingOut;
    if (pending) {
      try {
        await withTimeout(pending, SIGN_OUT_WAIT_MS);
      } catch {
        return { error: SIGN_IN_MSG.generic };
      }
    }
    try {
      // Requests time out after 15 s (timeoutFetch in ./supabase); this is only a backstop.
      const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email: e, password }), 20_000);
      if (error) return { error: signInErrorMessage(error) };
      if (data.session?.user?.id) setUserId(data.session.user.id);
      return {};
    } catch (err) {
      return { error: signInErrorMessage(err) };
    }
  }, []);

  const signOut = useCallback(async () => {
    const sb = supabase;
    // Flip the UI first so guarded screens unmount before the cache is cleared.
    setUserId(null);
    if (sb) {
      try {
        // Local only (see localSignOut): other devices and tabs on the same demo account stay signed in.
        await withTimeout(localSignOut(sb), 4000);
      } catch {
        // Still finishing in the background; signIn waits for it.
      }
    }
    setTimeout(() => queryClient.clear(), 0);
  }, []);

  const refreshProfile = useCallback(() => {
    void profileQ.refetch();
  }, [profileQ.refetch]);

  const adopt = useCallback((id: string) => setUserId(id), []);

  const value = useMemo<SessionValue>(() => {
    let status: SessionStatus;
    let profileError: string | null = null;
    if (userId === undefined) status = 'loading';
    else if (userId === null) status = 'signedOut';
    else if (profileQ.data) status = 'signedIn';
    else if (profileQ.isError) {
      status = 'signedIn';
      profileError = friendlyError(profileQ.error);
    } else status = 'loading';
    return {
      status,
      userId: userId ?? null,
      profile: userId && profileQ.data && profileQ.data.id === userId ? profileQ.data : null,
      profileError,
      refreshProfile,
      signIn,
      signOut,
    };
  }, [userId, profileQ.data, profileQ.isError, profileQ.error, refreshProfile, signIn, signOut]);

  return (
    <AdoptContext.Provider value={adopt}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </AdoptContext.Provider>
  );
}

/** The live session. Outside <SessionProvider> (offline demo) it reads as signed out. */
export function useSession(): SessionValue {
  return useContext(SessionContext) ?? SIGNED_OUT;
}
