// node --test --experimental-strip-types supabase/functions/_shared/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowMethods, background, bearer, corsHeaders, errorText, fail, isUuid, json, preflight, readJsonObject } from './http.ts';

test('CORS headers allow browser calls from the web build', () => {
  assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*');
  assert.equal(corsHeaders['Access-Control-Allow-Headers'], 'authorization, x-client-info, apikey, content-type');
  assert.equal(corsHeaders['Access-Control-Allow-Methods'], 'POST, GET, OPTIONS');
});

test('OPTIONS preflight answers 200 with CORS headers; other methods pass through', async () => {
  const res = preflight(new Request('https://x.test/fn', { method: 'OPTIONS' }));
  assert.ok(res);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, GET, OPTIONS');
  assert.equal(preflight(new Request('https://x.test/fn', { method: 'POST', body: '{}' })), null);
});

test('json and fail carry CORS + JSON content type', async () => {
  const ok = json({ build_id: 'b' }, 202);
  assert.equal(ok.status, 202);
  assert.equal(ok.headers.get('content-type'), 'application/json');
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await ok.json(), { build_id: 'b' });

  const err = fail(503, 'Plate reading is not configured.', 'no_key');
  assert.equal(err.status, 503);
  assert.deepEqual(await err.json(), { error: 'Plate reading is not configured.', code: 'no_key' });
});

test('allowMethods returns 405 for unsupported methods', async () => {
  assert.equal(allowMethods(new Request('https://x.test', { method: 'POST' }), ['POST']), null);
  const res = allowMethods(new Request('https://x.test', { method: 'DELETE' }), ['POST', 'GET']);
  assert.equal(res?.status, 405);
  assert.equal((await res!.json()).code, 'method');
});

test('readJsonObject accepts objects only', async () => {
  const post = (body: string) => new Request('https://x.test', { method: 'POST', body });
  assert.deepEqual(await readJsonObject(post('{"home_id":"h"}')), { home_id: 'h' });
  assert.equal(await readJsonObject(post('[1,2]')), null);
  assert.equal(await readJsonObject(post('not json')), null);
  assert.equal(await readJsonObject(post('')), null);
});

test('isUuid and bearer', () => {
  assert.ok(isUuid('a0000000-0000-4000-8000-000000000005'));
  assert.ok(!isUuid('a0000000-0000-4000-8000-00000000000'));
  assert.ok(!isUuid(42));
  assert.equal(bearer('Bearer abc.def'), 'abc.def');
  assert.equal(bearer('bearer  abc'), 'abc');
  assert.equal(bearer('Basic abc'), null);
  assert.equal(bearer(null), null);
});

test('errorText describes errors and PostgREST error objects', () => {
  assert.equal(errorText(new TypeError('boom')), 'TypeError: boom');
  assert.equal(errorText({ code: '23505', message: 'duplicate key' }), '23505 | duplicate key');
  assert.equal(errorText('plain'), 'plain');
});

test('background swallows rejections and uses EdgeRuntime.waitUntil when present', async () => {
  const seen: Promise<unknown>[] = [];
  const g = globalThis as { EdgeRuntime?: unknown };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => seen.push(p) };
  const origError = console.error;
  console.error = () => {};
  try {
    background(Promise.reject(new Error('nope')));
    assert.equal(seen.length, 1);
    await seen[0]; // resolves: the rejection was handled
  } finally {
    console.error = origError;
    delete g.EdgeRuntime;
  }
});
