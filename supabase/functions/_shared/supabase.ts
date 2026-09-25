// Supabase clients for edge functions (Deno only).
//   userClient(req)  the caller's JWT, so reads obey RLS (ownership checks)
//   adminClient()    the service role, for writes the caller can't make directly

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { MSG, bearer, fail } from './http.ts';

function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v : undefined;
}

/** First key of a SUPABASE_*_KEYS JSON env var (new API keys), if present. */
function firstKey(name: string): string | undefined {
  const raw = env(name);
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const url = () => env('SUPABASE_URL') ?? '';
const anonKey = () => env('SUPABASE_ANON_KEY') ?? firstKey('SUPABASE_PUBLISHABLE_KEYS') ?? '';
const serviceKey = () => env('SUPABASE_SERVICE_ROLE_KEY') ?? firstKey('SUPABASE_SECRET_KEYS') ?? '';

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function userClient(token: string): SupabaseClient {
  return createClient(url(), anonKey(), {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(url(), serviceKey(), { auth: noSession });
  return admin;
}

export interface Caller {
  userId: string;
  db: SupabaseClient;
}

/**
 * The signed-in caller, or a 401 Response. The gateway already verified the
 * JWT (verify_jwt = true); this also rejects the bare anon key, which has no user.
 */
export async function requireCaller(req: Request): Promise<Caller | Response> {
  const token = bearer(req.headers.get('Authorization'));
  if (!token) return fail(401, MSG.auth, 'auth');
  const db = userClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return fail(401, MSG.auth, 'auth');
  return { userId: data.user.id, db };
}
