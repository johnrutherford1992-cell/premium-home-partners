// Pure photo helpers: resize math, base64 decoding, storage paths, upload
// error classification and the signed-URL cache. No React Native imports, so
// they're unit-tested under `node --test` (test/photos.test.ts).

import { isNetworkError } from '../../lib/errors';

/** Photos are downscaled so their long edge is at most this many pixels. */
export const MAX_EDGE = 1600;
/** JPEG quality used when re-encoding (0–1). */
export const JPEG_QUALITY = 0.7;
/** Private bucket for visit photos (docs/LIVE_ARCHITECTURE.md §4 Storage). */
export const PHOTO_BUCKET = 'visit-photos';
/** Signed URLs live for an hour… */
export const SIGNED_URL_TTL_S = 3600;
/** …and are re-signed about 5 minutes before they expire. */
export const SIGNED_URL_MARGIN_MS = 5 * 60_000;

export type PhotoKind = 'before' | 'after' | 'drain';

/** Shown wherever the camera permission is denied. */
export const CAMERA_OFF = 'Camera access is off. Enable it in Settings.';

// ---------------------------------------------------------------------------
// Resize math

/**
 * Scale `width × height` down so the long edge is at most `maxEdge`, keeping
 * the aspect ratio. Images already small enough keep their size.
 */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_EDGE): { width: number; height: number; scale: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: Math.round(w), height: Math.round(h), scale: 1 };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, w >= h ? maxEdge : Math.round(w * scale)),
    height: Math.max(1, h > w ? maxEdge : Math.round(h * scale)),
    scale,
  };
}

// ---------------------------------------------------------------------------
// Base64

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
// URL-safe variants decode too.
LOOKUP['-'.charCodeAt(0)] = 62;
LOOKUP['_'.charCodeAt(0)] = 63;

/** Drop a leading `data:…;base64,` prefix if there is one. */
export function stripDataUrl(s: string): string {
  return s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
}

/**
 * Decode base64 (standard or URL-safe, padded or not, with or without a
 * `data:` prefix) to bytes. Throws on characters outside the alphabet.
 */
export function base64ToBytes(input: string): Uint8Array {
  let s = stripDataUrl(input).replace(/\s+/g, '');
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 61 /* = */) end--;
  s = s.slice(0, end);
  if (s.length % 4 === 1) throw new Error('Invalid base64 length');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) throw new Error('Invalid base64 character');
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buf >> bits) & 0xff;
    }
  }
  return out;
}

/** Base64 → a standalone ArrayBuffer (what supabase-js uploads best on React Native). */
export function base64ToArrayBuffer(input: string): ArrayBuffer {
  const bytes = base64ToBytes(input);
  return bytes.buffer.byteLength === bytes.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Storage paths

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** `{visit_id}/{task_id}/{kind}-{epoch_ms}.jpg`, the layout the Storage policies expect. */
export function photoPath(visitId: string, taskId: string, kind: string, now: number = Date.now()): string {
  for (const [name, v] of [
    ['visitId', visitId],
    ['taskId', taskId],
    ['kind', kind],
  ] as const) {
    if (!v || !SEGMENT_RE.test(v)) throw new Error(`Invalid photo ${name}: ${JSON.stringify(v)}`);
  }
  return `${visitId}/${taskId}/${kind}-${Math.floor(now)}.jpg`;
}

// ---------------------------------------------------------------------------
// Upload error classification

type ErrShape = { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown };

function shape(e: unknown): ErrShape {
  return e && typeof e === 'object' ? (e as ErrShape) : {};
}

/** The object already exists (a retried upload that had in fact landed). */
export function isDuplicateUploadError(e: unknown): boolean {
  const x = shape(e);
  if (x.status === 409 || x.statusCode === '409' || x.statusCode === 409) return true;
  if (x.code === 'Duplicate' || x.code === 'ResourceAlreadyExists') return true;
  return typeof x.message === 'string' && /already exists|duplicate/i.test(x.message);
}

/** Worth one more try: the request never got an answer, or the gateway hiccuped. */
export function isRetryableUploadError(e: unknown): boolean {
  if (isNetworkError(e)) return true;
  const x = shape(e);
  const status = typeof x.status === 'number' ? x.status : Number(x.statusCode);
  return Number.isFinite(status) && status >= 500 && status < 600;
}

// ---------------------------------------------------------------------------
// Signed-URL cache + batching loader

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/** path → signed URL, fresh until `marginMs` before the URL expires. */
export class SignedUrlCache {
  entries: Map<string, CacheEntry> = new Map();
  ttlMs: number;
  marginMs: number;

  constructor(ttlS: number = SIGNED_URL_TTL_S, marginMs: number = SIGNED_URL_MARGIN_MS) {
    this.ttlMs = ttlS * 1000;
    this.marginMs = marginMs;
  }

  /** The URL while it's fresh, else null (stale entries are dropped). */
  get(path: string, now: number = Date.now()): string | null {
    const e = this.entries.get(path);
    if (!e) return null;
    if (now >= e.expiresAt - this.marginMs) {
      this.entries.delete(path);
      return null;
    }
    return e.url;
  }

  /** Store a URL signed at `signedAt` (take the time before the request, to be safe). */
  set(path: string, url: string, signedAt: number = Date.now()): void {
    this.entries.set(path, { url, expiresAt: signedAt + this.ttlMs });
  }

  /** When the cached URL for `path` stops being fresh, or null if none is cached. */
  staleAt(path: string): number | null {
    const e = this.entries.get(path);
    return e ? e.expiresAt - this.marginMs : null;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Signs a batch of paths. Paths it can't sign are left out of the result. */
export type SignBatch = (paths: string[]) => Promise<Record<string, string>>;

export interface SignedUrlLoader {
  cache: SignedUrlCache;
  /** Cached fresh URL, synchronously. */
  peek(path: string): string | null;
  /** One URL; calls made in the same tick share a single sign request. Null when the path can't be signed. */
  get(path: string): Promise<string | null>;
  /** Many URLs at once; unsignable paths are left out. */
  getMany(paths: readonly string[]): Promise<Record<string, string>>;
}

interface Waiter {
  resolve: (url: string | null) => void;
  reject: (e: unknown) => void;
}

/**
 * Wraps a batch signer with the cache, in-flight de-duplication and
 * same-tick batching, so a grid of tiles makes one request.
 */
export function createSignedUrlLoader(
  sign: SignBatch,
  opts: { now?: () => number; ttlS?: number; marginMs?: number; maxBatch?: number } = {},
): SignedUrlLoader {
  const now = opts.now ?? Date.now;
  const maxBatch = opts.maxBatch ?? 100;
  const cache = new SignedUrlCache(opts.ttlS, opts.marginMs);
  const inflight = new Map<string, Promise<string | null>>();
  let queue = new Map<string, Waiter>();
  let scheduled = false;

  async function run(batch: Map<string, Waiter>) {
    const paths = [...batch.keys()];
    const signedAt = now();
    try {
      const res = await sign(paths);
      for (const [path, w] of batch) {
        const url = res[path] ?? null;
        if (url) cache.set(path, url, signedAt);
        w.resolve(url);
      }
    } catch (e) {
      for (const w of batch.values()) w.reject(e);
    }
  }

  function flush() {
    scheduled = false;
    const all = [...queue];
    queue = new Map();
    for (let i = 0; i < all.length; i += maxBatch) void run(new Map(all.slice(i, i + maxBatch)));
  }

  function get(path: string): Promise<string | null> {
    const hit = cache.get(path, now());
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(path);
    if (pending) return pending;
    const p = new Promise<string | null>((resolve, reject) => {
      queue.set(path, { resolve, reject });
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
    inflight.set(path, p);
    const clear = () => {
      if (inflight.get(path) === p) inflight.delete(path);
    };
    p.then(clear, clear);
    return p;
  }

  async function getMany(paths: readonly string[]): Promise<Record<string, string>> {
    const unique = [...new Set(paths.filter(Boolean))];
    const urls = await Promise.all(unique.map(get));
    const out: Record<string, string> = {};
    unique.forEach((p, i) => {
      const u = urls[i];
      if (u) out[p] = u;
    });
    return out;
  }

  return { cache, peek: (path) => cache.get(path, now()), get, getMany };
}
