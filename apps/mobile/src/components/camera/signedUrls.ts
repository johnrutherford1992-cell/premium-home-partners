// Signed URLs for private visit photos: createSignedUrls with a 1 h expiry,
// cached per path until ~5 min before expiry, batched per tick so a grid of
// tiles makes one request.

import { useEffect, useState } from 'react';
import { FriendlyError, friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { PHOTO_BUCKET, SIGNED_URL_TTL_S, createSignedUrlLoader } from './photoUtils';

const loader = createSignedUrlLoader(async (paths) => {
  if (!supabase) return {};
  let res: Awaited<ReturnType<ReturnType<typeof supabase.storage.from>['createSignedUrls']>>;
  try {
    res = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S);
  } catch (e) {
    throw new FriendlyError(friendlyError(e));
  }
  if (res.error) throw new FriendlyError(friendlyError(res.error));
  const out: Record<string, string> = {};
  for (const r of res.data) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
});

/** Signed URLs for many storage paths (bucket `visit-photos`). Paths that can't be signed are left out. */
export function getSignedUrls(paths: readonly string[]): Promise<Record<string, string>> {
  return loader.getMany(paths);
}

/** One signed URL, or null when the path can't be signed (e.g. the object is gone). */
export function getSignedUrl(path: string): Promise<string | null> {
  return loader.get(path);
}

/**
 * A signed URL for `path`, or null while it loads, when `path` is empty, or
 * when it can't be signed. Retries with backoff while the server is
 * unreachable, and re-signs shortly before the URL expires.
 */
export function useSignedPhotoUrl(path: string | null | undefined): string | null {
  const [state, setState] = useState<{ path: string | null | undefined; url: string | null }>(() => ({
    path,
    url: path ? loader.peek(path) : null,
  }));

  useEffect(() => {
    if (!path || !supabase) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const load = () => {
      loader.get(path).then(
        (url) => {
          if (!alive) return;
          failures = 0;
          setState((s) => (s.path === path && s.url === url ? s : { path, url }));
          const staleAt = loader.cache.staleAt(path);
          if (url && staleAt !== null) timer = setTimeout(load, Math.max(1_000, staleAt - Date.now() + 50));
        },
        () => {
          if (!alive) return;
          failures++;
          timer = setTimeout(load, Math.min(15_000, 2_000 * failures));
        },
      );
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [path]);

  if (!path) return null;
  return state.path === path ? state.url : loader.peek(path);
}
