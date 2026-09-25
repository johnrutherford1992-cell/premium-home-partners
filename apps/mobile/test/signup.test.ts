/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_SIGNUP, SIGNUP_MSG, signupFullName, signupPayload, validateSignup, validateSignupField, type SignupValues } from '../src/lib/signup';

const ok: SignupValues = { firstName: 'Taylor', lastName: 'Kim', email: 'taylor@example.com', phone: '' };

test('a complete form has no errors; phone is optional', () => {
  assert.deepEqual(validateSignup(ok), {});
  assert.deepEqual(validateSignup({ ...ok, phone: '(214) 555-0100' }), {});
});

test('first name, last name and email are required', () => {
  assert.deepEqual(validateSignup(EMPTY_SIGNUP), {
    firstName: SIGNUP_MSG.firstName,
    lastName: SIGNUP_MSG.lastName,
    email: SIGNUP_MSG.email,
  });
  assert.equal(validateSignupField('firstName', { ...ok, firstName: '   ' }), SIGNUP_MSG.firstName);
  assert.equal(validateSignupField('lastName', { ...ok, lastName: '\t' }), SIGNUP_MSG.lastName);
});

test('email format', () => {
  for (const e of ['taylor@example.com', ' t.kim+demo@mail.example.co ', 'a@b.io']) {
    assert.equal(validateSignupField('email', { ...ok, email: e }), undefined, e);
  }
  for (const e of ['taylor', 'taylor@', '@example.com', 'taylor@example', 'tay lor@example.com', 'taylor@example.c', 'a@b..com']) {
    assert.equal(validateSignupField('email', { ...ok, email: e }), SIGNUP_MSG.emailFormat, e);
  }
});

test('phone: digits, spaces, + ( ) - . only; 7–20 digits; 30 characters at most', () => {
  for (const p of ['2145550100', '+1 (214) 555-0100', '214.555.0100', '555 0100', '1'.repeat(20)]) {
    assert.equal(validateSignupField('phone', { ...ok, phone: p }), undefined, p);
  }
  assert.equal(validateSignupField('phone', { ...ok, phone: '214-555-01OO' }), SIGNUP_MSG.phoneChars);
  assert.equal(validateSignupField('phone', { ...ok, phone: 'ext 12' }), SIGNUP_MSG.phoneChars);
  assert.equal(validateSignupField('phone', { ...ok, phone: '555-010' }), SIGNUP_MSG.phoneDigits);
  assert.equal(validateSignupField('phone', { ...ok, phone: '1'.repeat(21) }), SIGNUP_MSG.phoneDigits);
  // 20 digits, but longer than the server's 30-character limit once formatted.
  assert.equal(validateSignupField('phone', { ...ok, phone: '+1 (214) 555-0100 . 1234 567 89' }), SIGNUP_MSG.phoneLength);
});

test('the full name is trimmed, single-spaced and at most 80 characters', () => {
  assert.equal(signupFullName({ firstName: '  Taylor ', lastName: ' Kim  ' }), 'Taylor Kim');
  assert.equal(signupFullName({ firstName: 'Mary  Ann', lastName: 'de  la Cruz' }), 'Mary Ann de la Cruz');
  const first = 'A'.repeat(40);
  assert.equal(validateSignupField('lastName', { ...ok, firstName: first, lastName: 'B'.repeat(39) }), undefined);
  assert.equal(validateSignupField('lastName', { ...ok, firstName: first, lastName: 'B'.repeat(40) }), SIGNUP_MSG.nameTooLong);
});

test('payload for startNewCustomer', () => {
  assert.deepEqual(signupPayload({ firstName: ' Taylor', lastName: 'Kim ', email: ' taylor@example.com ', phone: '  ' }), {
    fullName: 'Taylor Kim',
    email: 'taylor@example.com',
  });
  assert.deepEqual(signupPayload({ ...ok, phone: ' 214 555 0100 ' }), { fullName: 'Taylor Kim', email: 'taylor@example.com', phone: '214 555 0100' });
});
