// Server calls with user-facing errors. Supabase errors are never shown raw.

import { FriendlyError, MSG, toFriendlyError } from './errors';
import { requireSupabase } from './supabase';

export { FriendlyError, MSG, friendlyError, isAuthExpiredError, isNetworkError, toFriendlyError } from './errors';

type Result<T> = { data: T | null; error: unknown; status?: number };

/**
 * Return a `{ data, error }` result's data, or throw a FriendlyError. The
 * FriendlyError keeps the PostgREST `code` (e.g. PGRST303, an expired JWT) and
 * the HTTP status, so isAuthExpiredError() / isNetworkError() still work on it.
 */
export function unwrap<T>(res: Result<T>): T {
  if (res.error) {
    // PostgREST reports transport failures (including timeouts) as status 0 with an empty code.
    const err = res.status === 0 && typeof res.error === 'object' ? { ...(res.error as object), status: 0 } : res.error;
    const fe = toFriendlyError(err);
    if (fe.status === undefined && typeof res.status === 'number') fe.status = res.status;
    throw fe;
  }
  return res.data as T;
}

/**
 * `supabase.rpc` that throws `Error(friendlyError(e))` and returns `data as T`.
 * After it resolves, call `invalidateTables([...])` from `./realtime`.
 */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res: Result<unknown>;
  try {
    res = await requireSupabase().rpc(fn, args);
  } catch (e) {
    throw toFriendlyError(e);
  }
  return unwrap(res) as T;
}

/**
 * Invoke an edge function. Non-2xx responses carry `{ error, code }` already
 * written for users (docs/LIVE_ARCHITECTURE.md §5); they surface as a
 * FriendlyError with that message, plus `code` and the HTTP `status`.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: unknown };
  try {
    res = await requireSupabase().functions.invoke(name, { body });
  } catch (e) {
    throw toFriendlyError(e);
  }
  if (res.error) {
    const err = res.error as { name?: string; context?: unknown };
    const ctx = err.context as Response | undefined;
    if (err.name === 'FunctionsHttpError' && ctx && typeof ctx.json === 'function') {
      let payload: { error?: unknown; code?: unknown } | null = null;
      try {
        payload = await ctx.clone().json();
      } catch {
        payload = null;
      }
      const text = typeof payload?.error === 'string' ? payload.error : null;
      const code = typeof payload?.code === 'string' ? payload.code : undefined;
      const fallback = ctx.status === 401 || ctx.status === 403 ? MSG.access : MSG.generic;
      throw new FriendlyError(text ?? fallback, { code, status: ctx.status });
    }
    throw toFriendlyError(res.error);
  }
  return res.data as T;
}
