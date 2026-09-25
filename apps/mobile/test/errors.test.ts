/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FriendlyError, MSG, SIGN_IN_MSG, friendlyError, isAuthExpiredError, isNetworkError, signInErrorMessage } from '../src/lib/errors';

test('network failures read as "Can\'t reach the server"', () => {
  // postgrest-js turns a rejected fetch into this shape
  assert.equal(friendlyError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }), MSG.network);
  assert.equal(friendlyError(new TypeError('Network request failed')), MSG.network);
  assert.equal(friendlyError({ name: 'AuthRetryableFetchError', message: '{}', status: 0 }), MSG.network);
  assert.equal(friendlyError({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), MSG.network);
  assert.equal(friendlyError({ message: 'x', code: '', status: 0 }), MSG.network);
  assert.equal(isNetworkError('Load failed'), true);
});

test('RPC exceptions (P0001) pass through', () => {
  const msg = "This visit can't be rescheduled once the technician is on the way.";
  assert.equal(friendlyError({ message: msg, code: 'P0001', details: null, hint: null }), msg);
});

test('RLS and permission errors', () => {
  assert.equal(friendlyError({ message: 'new row violates row-level security policy for table "visits"', code: '42501' }), MSG.access);
  assert.equal(friendlyError({ message: 'permission denied for function reset_demo', code: '42501' }), MSG.access);
  assert.equal(friendlyError({ message: 'anything', code: 'PGRST302' }), MSG.access);
});

test('expired JWT, not found and unknown errors', () => {
  const expired = { message: 'JWT expired', code: 'PGRST303' };
  assert.equal(isAuthExpiredError(expired), true);
  assert.equal(friendlyError(expired), MSG.expired);
  assert.equal(friendlyError({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }), MSG.notFound);
  assert.equal(friendlyError({ message: 'relation "x" does not exist', code: '42P01' }), MSG.generic);
  assert.equal(friendlyError(null), MSG.generic);
  assert.equal(friendlyError(42), MSG.generic);
});

test('app-written messages survive', () => {
  assert.equal(friendlyError(new FriendlyError('Enter a price above $0.')), 'Enter a price above $0.');
  assert.equal(friendlyError(new Error('Pick a day first.')), 'Pick a day first.');
  assert.equal(friendlyError('Plain words'), 'Plain words');
});

test('sign-in errors', () => {
  assert.equal(signInErrorMessage({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }), SIGN_IN_MSG.mismatch);
  assert.equal(signInErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }), SIGN_IN_MSG.network);
  const timeout = new Error('Request timed out');
  timeout.name = 'TimeoutError';
  assert.equal(signInErrorMessage(timeout), SIGN_IN_MSG.network);
  assert.equal(signInErrorMessage({ name: 'AuthApiError', message: 'Email not confirmed', status: 400, code: 'email_not_confirmed' }), SIGN_IN_MSG.unconfirmed);
  assert.equal(signInErrorMessage({ name: 'AuthApiError', message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' }), SIGN_IN_MSG.rateLimited);
  assert.equal(signInErrorMessage({ name: 'AuthUnknownError', message: 'boom', status: 500 }), SIGN_IN_MSG.server);
  assert.equal(signInErrorMessage(undefined), SIGN_IN_MSG.generic);
  assert.equal(SIGN_IN_MSG.mismatch, "That email and password don't match.");
  assert.equal(SIGN_IN_MSG.network, "Can't reach the server. Check your connection or switch to offline demo mode.");
});
