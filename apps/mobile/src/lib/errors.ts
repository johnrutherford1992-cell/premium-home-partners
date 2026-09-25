// User-facing error text. Pure (no React Native imports) so it's unit-tested
// under node --test. Supabase errors are never shown raw.

export const MSG = {
  network: "Can't reach the server. Retrying…",
  access: "You don't have access to that.",
  expired: 'Your session expired. Sign in again.',
  notFound: "We couldn't find that.",
  generic: 'Something went wrong. Try again.',
} as const;

export const SIGN_IN_MSG = {
  missing: 'Enter your email and password.',
  mismatch: "That email and password don't match.",
  network: "Can't reach the server. Check your connection or switch to offline demo mode.",
  unconfirmed: "This account hasn't been confirmed yet.",
  rateLimited: 'Too many attempts. Wait a minute, then try again.',
  disabled: 'This account is turned off. Ask the office to turn it back on.',
  server: 'The server had a problem. Try again in a moment.',
  generic: "Couldn't sign you in. Try again.",
} as const;

/** An error whose message is already written for users. */
export class FriendlyError extends Error {
  /** Machine code when the server sent one (e.g. an edge function's `code`). */
  code?: string;
  status?: number;
  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message);
    this.name = 'FriendlyError';
    this.code = opts?.code;
    this.status = opts?.status;
  }
}

const NETWORK_RE =
  /failed to fetch|network request failed|networkerror|network error|load failed|fetch failed|fetcherror|err_(?:name|internet|connection|network|address)|econn|enotfound|eai_again|etimedout|timed? ?out|aborted|socket hang up|could not connect/i;
const ACCESS_RE = /row-level security|permission denied|not authorized|unauthorized|forbidden|insufficient.privilege/i;
const EXPIRED_RE = /jwt expired|invalid jwt|token (?:is )?expired|invalid refresh token|refresh token not found/i;

type ErrLike = { name?: unknown; message?: unknown; code?: unknown; status?: unknown };

function parts(e: unknown): { name: string; message: string; code: string; status: number | undefined } {
  const x = (e && typeof e === 'object' ? e : {}) as ErrLike;
  return {
    name: typeof x.name === 'string' ? x.name : '',
    message: typeof x.message === 'string' ? x.message : '',
    code: typeof x.code === 'string' ? x.code : x.code != null ? String(x.code) : '',
    status: typeof x.status === 'number' ? x.status : undefined,
  };
}

/** True for transport failures (the server never answered). */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  if (typeof e === 'string') return NETWORK_RE.test(e);
  if (typeof e !== 'object') return false;
  const { name, message, status } = parts(e);
  if (name === 'AuthRetryableFetchError' || name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return true;
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  if (status === 0) return true;
  return NETWORK_RE.test(message);
}

/**
 * True when the error means the JWT is no longer valid. Also true for a
 * FriendlyError that already carries MSG.expired: fetchers throw wrapped
 * errors, and that is what the query cache's expired-session listener sees.
 */
export function isAuthExpiredError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, message } = parts(e);
  if (e instanceof FriendlyError && message === MSG.expired) return true;
  return code === 'PGRST301' || code === 'PGRST303' || EXPIRED_RE.test(message);
}

/**
 * Map any error to a sentence a person can act on:
 * network → "Can't reach the server. Retrying…", RLS/permission → "You don't
 * have access to that.", RPC exceptions raised with errcode P0001 pass through.
 */
export function friendlyError(e: unknown): string {
  if (e == null) return MSG.generic;
  if (e instanceof FriendlyError) return e.message;
  if (typeof e === 'string') return isNetworkError(e) ? MSG.network : e.trim() || MSG.generic;
  if (typeof e !== 'object') return MSG.generic;

  const { name, message, code, status } = parts(e);

  // Messages written for users by the RPCs (raise … using errcode = 'P0001').
  if (code === 'P0001' && message) return message;
  if (isNetworkError(e)) return MSG.network;
  if (isAuthExpiredError(e)) return MSG.expired;
  if (code === '42501' || code === 'PGRST302' || status === 401 || status === 403 || ACCESS_RE.test(message)) return MSG.access;
  if (code === 'PGRST116' || status === 404) return MSG.notFound;

  // A plain `new Error('…')` thrown by app code carries a readable message.
  // Anything from a Supabase library (Postgrest*, Auth*, Functions*, Storage*) or with a code does not.
  const libError = /^(Postgrest|Auth|Functions|Storage)/.test(name) || code !== '';
  if (!libError && name === 'Error' && message && message.length < 160) return message;
  return MSG.generic;
}

/**
 * Wrap any error for users: the friendlyError() message, keeping the original
 * `code` and `status` so callers can still tell an expired JWT (PGRST303) or a
 * transport failure (status 0) apart. A FriendlyError passes through as is.
 */
export function toFriendlyError(e: unknown): FriendlyError {
  if (e instanceof FriendlyError) return e;
  const { code, status } = parts(e);
  return new FriendlyError(friendlyError(e), { code: code || undefined, status });
}

/** Sign-in failures, from supabase-js AuthError shapes (or a thrown timeout). */
export function signInErrorMessage(e: unknown): string {
  if (!e) return SIGN_IN_MSG.generic;
  const { code, message, status } = parts(e);
  if (isNetworkError(e)) return SIGN_IN_MSG.network;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return SIGN_IN_MSG.mismatch;
  if (code === 'validation_failed' && /email|password/i.test(message)) return SIGN_IN_MSG.mismatch;
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return SIGN_IN_MSG.unconfirmed;
  if (code === 'user_banned') return SIGN_IN_MSG.disabled;
  if (status === 429 || /rate.?limit|too many/i.test(code + ' ' + message)) return SIGN_IN_MSG.rateLimited;
  if (status === 400 || status === 422) return SIGN_IN_MSG.mismatch;
  if (status !== undefined && status >= 500) return SIGN_IN_MSG.server;
  return SIGN_IN_MSG.generic;
}
