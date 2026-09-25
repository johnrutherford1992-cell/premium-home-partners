// Visit photos in Storage (bucket `visit-photos`, private). Paths are
// `{visit_id}/{task_id}/{kind}-{epoch_ms}.jpg` (docs/LIVE_ARCHITECTURE.md §4).
// Pure helpers live in components/camera/photoUtils.ts (unit-tested).

import { PHOTO_BUCKET, base64ToArrayBuffer, isDuplicateUploadError, isRetryableUploadError, photoPath, type PhotoKind } from '../components/camera/photoUtils';
import type { CapturedPhoto } from '../components/camera/types';
import { FriendlyError, friendlyError } from './errors';
import { invalidateTables } from './realtime';
import { rpc } from './rpc';
import { requireSupabase } from './supabase';

export { RemotePhoto } from '../components/camera/RemotePhoto';
export { getSignedUrl, getSignedUrls, useSignedPhotoUrl } from '../components/camera/signedUrls';
export { PHOTO_BUCKET, photoPath, type PhotoKind } from '../components/camera/photoUtils';
export type { CapturedPhoto } from '../components/camera/types';

const RETRY_DELAY_MS = 800;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function uploadWithRetry(path: string, body: Blob | ArrayBuffer): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let err: unknown = null;
    try {
      const res = await requireSupabase()
        .storage.from(PHOTO_BUCKET)
        .upload(path, body, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      err = res.error;
    } catch (e) {
      err = e;
    }
    if (!err) return;
    // The first attempt landed but its answer was lost: the object is there.
    if (attempt > 0 && isDuplicateUploadError(err)) return;
    if (attempt === 0 && isRetryableUploadError(err)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new FriendlyError(friendlyError(err));
  }
}

/**
 * Upload a captured photo for a visit task and record it with
 * `add_visit_photo`. Retries the upload once on a network error. Throws a
 * FriendlyError whose message can go straight into a toast. Invalidates
 * `visit_photos` queries on success.
 */
export async function uploadVisitPhoto({
  visitId,
  taskId,
  kind,
  photo,
}: {
  visitId: string;
  taskId: string;
  kind: PhotoKind | (string & {});
  photo: CapturedPhoto;
}): Promise<{ path: string }> {
  const path = photoPath(visitId, taskId, kind);
  let body: Blob | ArrayBuffer;
  try {
    // Web sends the Blob; React Native uploads an ArrayBuffer (supabase-js can't send RN Blobs).
    body = photo.blob ?? base64ToArrayBuffer(photo.base64);
  } catch {
    throw new FriendlyError("We couldn't read that photo. Try again.");
  }
  await uploadWithRetry(path, body);
  await rpc('add_visit_photo', { p_task: taskId, p_kind: kind, p_path: path });
  void invalidateTables(['visit_photos']);
  return { path };
}
