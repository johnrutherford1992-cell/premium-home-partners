import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True when a Supabase project is configured through the EXPO_PUBLIC_* env vars. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase client, or null when no project is configured (offline demo only).
 *
 * Sessions persist through AsyncStorage, which is backed by localStorage on
 * web. Magic links and OAuth are not used, so the URL is never parsed for a
 * session. Native uses an in-process lock; web keeps the default Web Locks
 * implementation so several tabs share one refresh.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        ...(Platform.OS === 'web' ? {} : { lock: processLock }),
      },
      // React Query owns retries (2, with backoff). PostgREST's own GET retry
      // (3 more per attempt) would stack to ~25 s before an error shows.
      db: { retry: false },
    })
  : null;

/** The configured client. Only call this from live-mode code paths. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Native apps don't get visibility events, so token refresh only runs while
// the app is in the foreground (the pattern the Supabase React Native guide uses).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** @deprecated Use `useMode()` from `src/lib/mode.ts`; kept for older imports. */
export const isDemoMode = supabase === null;
