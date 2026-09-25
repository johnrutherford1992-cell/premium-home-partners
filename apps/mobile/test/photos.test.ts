/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMERA_OFF,
  JPEG_QUALITY,
  MAX_EDGE,
  PHOTO_BUCKET,
  SignedUrlCache,
  base64ToArrayBuffer,
  base64ToBytes,
  createSignedUrlLoader,
  fitWithin,
  isDuplicateUploadError,
  isRetryableUploadError,
  photoPath,
  stripDataUrl,
} from '../src/components/camera/photoUtils';

test('constants match the contract', () => {
  assert.equal(MAX_EDGE, 1600);
  assert.equal(JPEG_QUALITY, 0.7);
  assert.equal(PHOTO_BUCKET, 'visit-photos');
  assert.equal(CAMERA_OFF, 'Camera access is off. Enable it in Settings.');
});

test('fitWithin scales the long edge down to 1600 and keeps the ratio', () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200, scale: 1600 / 4032 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: 1600, scale: 1600 / 4032 });
  assert.deepEqual(fitWithin(4000, 4000), { width: 1600, height: 1600, scale: 0.4 });
  assert.deepEqual(fitWithin(1920, 1080), { width: 1600, height: 900, scale: 1600 / 1920 });
  // Very thin images never collapse to 0.
  assert.deepEqual(fitWithin(20000, 3).height, 1);
});

test('fitWithin leaves small images alone', () => {
  assert.deepEqual(fitWithin(1600, 1200), { width: 1600, height: 1200, scale: 1 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600, scale: 1 });
  assert.deepEqual(fitWithin(640, 480, 320), { width: 320, height: 240, scale: 0.5 });
  // Nonsense sizes become 1×1 instead of NaN.
  assert.deepEqual(fitWithin(0, Number.NaN), { width: 1, height: 1, scale: 1 });
});

test('base64ToBytes matches Buffer for every padding case', () => {
  for (let n = 0; n < 260; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 13) & 0xff);
    const b64 = Buffer.from(bytes).toString('base64');
    assert.deepEqual(base64ToBytes(b64), bytes, `length ${n}`);
    // Unpadded and URL-safe variants decode to the same bytes.
    assert.deepEqual(base64ToBytes(b64.replace(/=+$/, '')), bytes);
    assert.deepEqual(base64ToBytes(Buffer.from(bytes).toString('base64url')), bytes);
  }
});

test('base64ToBytes strips data: prefixes and whitespace, and rejects garbage', () => {
  const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const b64 = Buffer.from(jpegHeader).toString('base64');
  assert.deepEqual(base64ToBytes(`data:image/jpeg;base64,${b64}`), jpegHeader);
  assert.deepEqual(base64ToBytes(b64.slice(0, 4) + '\n' + b64.slice(4, 9) + ' ' + b64.slice(9)), jpegHeader);
  assert.equal(stripDataUrl('data:image/jpeg;base64,QUJD'), 'QUJD');
  assert.equal(stripDataUrl('QUJD'), 'QUJD');
  assert.throws(() => base64ToBytes('QU*D'));
  assert.throws(() => base64ToBytes('QUJDR'));
  assert.throws(() => base64ToBytes('QUJé'));
});

test('base64ToArrayBuffer returns a buffer of exactly the decoded bytes', () => {
  const buf = base64ToArrayBuffer(Buffer.from('hello photo').toString('base64'));
  assert.ok(buf instanceof ArrayBuffer);
  assert.equal(buf.byteLength, 11);
  assert.equal(Buffer.from(buf).toString(), 'hello photo');
});

test('photoPath follows {visit_id}/{task_id}/{kind}-{epoch_ms}.jpg', () => {
  const visit = '6f1c2d3e-0000-4000-8000-00000000abcd';
  const task = '0a1b2c3d-0000-4000-8000-000000000001';
  assert.equal(photoPath(visit, task, 'after', 1790000000123), `${visit}/${task}/after-1790000000123.jpg`);
  assert.equal(photoPath('v', 't', 'drain', 12.9), 'v/t/drain-12.jpg');
  assert.match(photoPath('v', 't', 'before'), /^v\/t\/before-\d{13}\.jpg$/);
  assert.throws(() => photoPath('', task, 'after'));
  assert.throws(() => photoPath('a/b', task, 'after'));
  assert.throws(() => photoPath(visit, task, '../after'));
});

test('upload errors: duplicates and retryable failures', () => {
  // storage-js StorageApiError shapes
  assert.equal(isDuplicateUploadError({ name: 'StorageApiError', message: 'The resource already exists', status: 409, statusCode: '409' }), true);
  assert.equal(isDuplicateUploadError({ name: 'StorageApiError', message: 'x', status: 400, statusCode: '409', code: 'Duplicate' }), true);
  assert.equal(isDuplicateUploadError({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 403, statusCode: '403' }), false);
  assert.equal(isRetryableUploadError({ name: 'StorageUnknownError', message: 'Failed to fetch' }), true);
  assert.equal(isRetryableUploadError(new TypeError('Network request failed')), true);
  assert.equal(isRetryableUploadError({ name: 'StorageApiError', message: 'Bad Gateway', status: 502, statusCode: '502' }), true);
  assert.equal(isRetryableUploadError({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 403, statusCode: '403' }), false);
  assert.equal(isRetryableUploadError({ name: 'StorageApiError', message: 'The resource already exists', status: 409, statusCode: '409' }), false);
  assert.equal(isRetryableUploadError(null), false);
});

test('SignedUrlCache keeps a URL until 5 minutes before its 1 h expiry', () => {
  const cache = new SignedUrlCache();
  const t0 = 1_000_000;
  cache.set('v/t/after-1.jpg', 'https://x/sign/1', t0);
  assert.equal(cache.get('v/t/after-1.jpg', t0), 'https://x/sign/1');
  assert.equal(cache.get('v/t/after-1.jpg', t0 + 54 * 60_000 + 59_999), 'https://x/sign/1');
  assert.equal(cache.staleAt('v/t/after-1.jpg'), t0 + 55 * 60_000);
  assert.equal(cache.get('v/t/after-1.jpg', t0 + 55 * 60_000), null);
  // Stale entries are dropped.
  assert.equal(cache.staleAt('v/t/after-1.jpg'), null);
  assert.equal(cache.get('missing'), null);
});

function fakeSigner() {
  const calls: string[][] = [];
  let n = 0;
  let fail = false;
  const sign = async (paths: string[]) => {
    calls.push(paths);
    if (fail) throw new Error("Can't reach the server. Retrying…");
    n++;
    const out: Record<string, string> = {};
    for (const p of paths) if (!p.startsWith('gone/')) out[p] = `https://x/sign/${p}?v=${n}`;
    return out;
  };
  return {
    calls,
    sign,
    setFail(v: boolean) {
      fail = v;
    },
  };
}

test('loader batches same-tick requests into one sign call and caches them', async () => {
  let now = 5_000_000;
  const s = fakeSigner();
  const loader = createSignedUrlLoader(s.sign, { now: () => now });
  const [a, b, a2, gone] = await Promise.all([loader.get('a.jpg'), loader.get('b.jpg'), loader.get('a.jpg'), loader.get('gone/c.jpg')]);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0], ['a.jpg', 'b.jpg', 'gone/c.jpg']);
  assert.equal(a, 'https://x/sign/a.jpg?v=1');
  assert.equal(a2, a);
  assert.equal(b, 'https://x/sign/b.jpg?v=1');
  assert.equal(gone, null);
  assert.equal(loader.peek('a.jpg'), a);

  // Cached: no new request.
  assert.deepEqual(await loader.getMany(['a.jpg', 'b.jpg', 'a.jpg']), { 'a.jpg': a, 'b.jpg': b });
  assert.equal(s.calls.length, 1);

  // Unsignable paths are left out and not cached.
  assert.deepEqual(await loader.getMany(['a.jpg', 'gone/c.jpg']), { 'a.jpg': a });
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[1], ['gone/c.jpg']);

  // 55 minutes later the URL is re-signed.
  now += 55 * 60_000;
  assert.equal(loader.peek('a.jpg'), null);
  assert.equal(await loader.get('a.jpg'), 'https://x/sign/a.jpg?v=3');
  assert.equal(s.calls.length, 3);
});

test('loader errors reject every waiter and are not cached', async () => {
  const s = fakeSigner();
  const loader = createSignedUrlLoader(s.sign);
  s.setFail(true);
  const results = await Promise.allSettled([loader.get('a.jpg'), loader.getMany(['b.jpg'])]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['rejected', 'rejected'],
  );
  s.setFail(false);
  assert.equal(await loader.get('a.jpg'), 'https://x/sign/a.jpg?v=1');
});

test('loader splits big batches', async () => {
  const s = fakeSigner();
  const loader = createSignedUrlLoader(s.sign, { maxBatch: 2 });
  const out = await loader.getMany(['1', '2', '3', '4', '5']);
  assert.equal(Object.keys(out).length, 5);
  assert.deepEqual(
    s.calls.map((c) => c.length),
    [2, 2, 1],
  );
});
