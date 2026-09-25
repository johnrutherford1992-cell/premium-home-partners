// Email + password auth against Supabase, plus the signed-in user's profile.
// <SessionProvider> is mounted by the root layout in live mode only.

import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FriendlyError, SIGN_IN_MSG, friendlyError, isAuthExpiredError, isNetworkError, signInErrorMessage } from './errors';
import { queryClient } from './queryClient';
import { supabase } from './supabase';

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

const ROLES: readonly Role[] = ['homeowner', 'tech', 'vendor', 'office'];

export const profileKey = (userId: string | null) => ['session', 'profile', userId] as const;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

async function fetchProfile(userId: string): Promise<Profile> {
  if (!supabase) throw new FriendlyError('Supabase is not configured.');
  const { data, error, status } = await supabase.from('profiles').select('id, role, full_name, email').eq('id', userId).maybeSingle();
  if (error) throw new FriendlyError(friendlyError(status === 0 ? { ...error, status: 0 } : error));
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
        if (error && !isNetworkError(error)) void sb.auth.signOut({ scope: 'local' });
      });
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error?: string }> => {
    const sb = supabase;
    const e = email.trim().toLowerCase();
    if (!e || !password) return { error: SIGN_IN_MSG.missing };
    if (!sb) return { error: SIGN_IN_MSG.network };
    try {
      const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email: e, password }), 15_000);
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
        // Local scope: other devices signed in to the same demo account stay signed in.
        await withTimeout(sb.auth.signOut({ scope: 'local' }), 4000);
      } catch {
        // The local session is removed even when the server can't be reached.
      }
    }
    setTimeout(() => queryClient.clear(), 0);
  }, []);

  const refreshProfile = useCallback(() => {
    void profileQ.refetch();
  }, [profileQ.refetch]);

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

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The live session. Outside <SessionProvider> (offline demo) it reads as signed out. */
export function useSession(): SessionValue {
  return useContext(SessionContext) ?? SIGNED_OUT;
}
