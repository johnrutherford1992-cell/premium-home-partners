// node --test --experimental-strip-types supabase/functions/_shared/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_VENDORS, addDays, chicagoToday, networkBidPrice, skipReason } from './quote.ts';

test('network vendors, timing and pricing match the contract', () => {
  assert.deepEqual(
    NETWORK_VENDORS.map((v) => [v.company, v.factor, v.days, v.delayMs]),
    [
      ['Summit Pro Services', 0.88, 4, 1500],
      ['Clearview & Sons', 1.14, 6, 1300],
    ],
  );
});

test('bid prices are whole dollars of base × factor', () => {
  // The six service categories' bases.
  const cases: [number, number, number][] = [
    [65, 0.88, 57],
    [65, 1.14, 74],
    [1400, 0.88, 1232],
    [1400, 1.14, 1596],
    [420, 0.88, 370],
    [420, 1.14, 479],
    [340, 0.88, 299],
    [340, 1.14, 388],
    [1150, 0.88, 1012],
    [1150, 1.14, 1311],
    [780, 0.88, 686],
    [780, 1.14, 889],
  ];
  for (const [base, f, want] of cases) assert.equal(networkBidPrice(base, f), want, `${base} × ${f}`);
  assert.equal(networkBidPrice('420.00', 0.88), 370);
  assert.equal(networkBidPrice(null, 0.88), null);
  assert.equal(networkBidPrice(0, 0.88), null);
});

test('chicagoToday uses the Chicago calendar day', () => {
  // 03:30 UTC on Sep 26 is still Sep 25 in Chicago (CDT, UTC-5).
  assert.equal(chicagoToday(new Date('2026-09-26T03:30:00Z')), '2026-09-25');
  assert.equal(chicagoToday(new Date('2026-09-26T05:30:00Z')), '2026-09-26');
  // Winter (CST, UTC-6).
  assert.equal(chicagoToday(new Date('2026-01-01T05:59:00Z')), '2025-12-31');
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-09-25', 4), '2026-09-29');
  assert.equal(addDays('2026-09-28', 6), '2026-10-04');
  assert.equal(addDays('2026-12-30', 6), '2027-01-05');
});

test('skipReason: only open requests, one bid per vendor', () => {
  const ok = { status: 'open', vendorId: 'v', alreadyBid: false, price: 57 };
  assert.equal(skipReason(ok), null);
  assert.equal(skipReason({ ...ok, status: 'booked' }), 'not_open');
  assert.equal(skipReason({ ...ok, status: undefined }), 'not_open');
  assert.equal(skipReason({ ...ok, alreadyBid: true }), 'already_bid');
  assert.equal(skipReason({ ...ok, vendorId: null }), 'no_vendor');
  assert.equal(skipReason({ ...ok, price: null }), 'no_price');
});
