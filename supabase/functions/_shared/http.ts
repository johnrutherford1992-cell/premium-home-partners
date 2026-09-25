// HTTP helpers shared by every edge function: CORS, JSON responses with
// user-facing error text, body parsing and background work.
// Runtime-neutral (no Deno APIs) so it is unit-tested under `node --test`.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/** Error text shown to people as-is (docs/LIVE_ARCHITECTURE.md §3). */
export const MSG = {
  auth: 'Your session expired. Sign in again.',
  forbidden: "You don't have access to that.",
  badRequest: "Something's off with that request. Try again.",
  method: "That action isn't supported.",
  server: 'Something went wrong. Try again.',
} as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** `{ error, code }` with the given status. `error` is written for users. */
export function fail(status: number, error: string, code: string): Response {
  return json({ error, code }, status);
}

/** Answers a CORS preflight; returns null for every other method. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response('ok', { status: 200, headers: corsHeaders });
}

/** Rejects methods the function doesn't serve (after preflight). */
export function allowMethods(req: Request, methods: string[]): Response | null {
  if (methods.includes(req.method)) return null;
  return fail(405, MSG.method, 'method');
}

/** The JSON object body, or null when the body is missing or not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** The bearer token from an Authorization header, or null. */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  const token = m?.[1]?.trim();
  return token ? token : null;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Keeps the function alive until `task` settles, without delaying the response.
 * Uses EdgeRuntime.waitUntil on Supabase; elsewhere the promise just runs.
 */
export function background(task: Promise<unknown>): void {
  const guarded = task.catch((e) => console.error('background task failed:', errorText(e)));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(guarded);
}

/** A loggable one-line description of anything thrown. Never includes request headers or keys. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const x = e as { message?: unknown; code?: unknown; details?: unknown };
    const parts = [x.code, x.message, x.details].filter((p) => typeof p === 'string' && p);
    if (parts.length) return parts.join(' | ');
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
