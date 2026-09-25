/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  chicagoDate,
  chicagoTimeToIso,
  dayLabel,
  daysBetween,
  fmtDay,
  fmtDuration,
  fmtMonth,
  fmtShortDate,
  fmtTime,
  fmtWindow,
  startOfDayChicagoIso,
  todayChicago,
  weekOfLabel,
} from '../src/lib/dates';

// 2026-09-25 is a Friday. Chicago is UTC-5 (CDT) until Nov 1, then UTC-6 (CST).

test('fmtDay prints the Chicago calendar day', () => {
  assert.equal(fmtDay('2026-09-25T14:00:00Z'), 'Fri · Sep 25');
  // 10 PM Friday in Chicago is already Saturday in UTC.
  assert.equal(fmtDay('2026-09-26T03:00:00Z'), 'Fri · Sep 25');
  assert.equal(fmtDay('2026-09-25T14:00:00+00:00'), 'Fri · Sep 25');
  assert.equal(fmtDay(new Date('2026-12-01T15:00:00Z')), 'Tue · Dec 1');
});

test('fmtWindow collapses the meridiem unless the window crosses noon', () => {
  assert.equal(fmtWindow('2026-09-25T14:00:00Z', '2026-09-25T16:00:00Z'), '9:00 – 11:00 AM');
  assert.equal(fmtWindow('2026-09-25T16:00:00Z', '2026-09-25T18:00:00Z'), '11:00 AM – 1:00 PM');
  assert.equal(fmtWindow('2026-09-25T17:00:00Z', '2026-09-25T19:00:00Z'), '12:00 – 2:00 PM');
  assert.equal(fmtWindow('2026-09-25T20:00:00Z', '2026-09-25T22:00:00Z'), '3:00 – 5:00 PM');
  assert.equal(fmtWindow('2026-09-25T13:30:00Z', '2026-09-25T15:00:00Z'), '8:30 – 10:00 AM');
  // Winter: CST
  assert.equal(fmtWindow('2026-12-01T15:00:00Z', '2026-12-01T17:00:00Z'), '9:00 – 11:00 AM');
  // No end: just the start
  assert.equal(fmtWindow('2026-09-26T14:00:00Z'), '9:00 AM');
  assert.equal(fmtWindow('2026-09-26T14:00:00Z', null), '9:00 AM');
});

test('fmtTime handles midnight and noon', () => {
  assert.equal(fmtTime('2026-09-25T05:00:00Z'), '12:00 AM');
  assert.equal(fmtTime('2026-09-25T17:00:00Z'), '12:00 PM');
  assert.equal(fmtTime('2026-09-25T17:05:00Z'), '12:05 PM');
});

test('fmtShortDate treats a bare date as a calendar date', () => {
  assert.equal(fmtShortDate('2026-10-18'), 'Sun, Oct 18');
  assert.equal(fmtShortDate('2026-10-20'), 'Tue, Oct 20');
  assert.equal(fmtShortDate('2026-10-18T02:00:00Z'), 'Sat, Oct 17');
});

test('fmtMonth', () => {
  assert.equal(fmtMonth('2026-10-05T15:00:00Z'), 'Oct');
  assert.equal(fmtMonth('2026-11-01T04:00:00Z'), 'Oct'); // 11 PM Oct 31 in Chicago
  assert.equal(fmtMonth('2027-01-15'), 'Jan');
});

test('weekOfLabel is the Monday of the week', () => {
  assert.equal(weekOfLabel('2026-09-25'), 'WEEK OF SEP 21');
  assert.equal(weekOfLabel('2026-09-21'), 'WEEK OF SEP 21');
  assert.equal(weekOfLabel('2026-09-27'), 'WEEK OF SEP 21'); // Sunday
  assert.equal(weekOfLabel('2026-09-28'), 'WEEK OF SEP 28');
  assert.equal(weekOfLabel(new Date('2026-09-28T03:00:00Z')), 'WEEK OF SEP 21'); // Sunday night in Chicago
  assert.equal(weekOfLabel('2026-10-01'), 'WEEK OF SEP 28');
  assert.equal(weekOfLabel('2027-01-01'), 'WEEK OF DEC 28');
});

test('todayChicago / chicagoDate use the Chicago day', () => {
  assert.equal(todayChicago(new Date('2026-09-26T03:00:00Z')), '2026-09-25');
  assert.equal(todayChicago(new Date('2026-09-26T05:00:00Z')), '2026-09-26');
  assert.equal(chicagoDate('2026-12-01T05:59:00Z'), '2026-11-30');
  assert.match(todayChicago(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays and daysBetween are plain calendar arithmetic', () => {
  assert.equal(addDays('2026-09-25', 1), '2026-09-26');
  assert.equal(addDays('2026-09-25', 7), '2026-10-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02'); // DST end
  assert.equal(daysBetween('2026-09-25', '2026-09-28'), 3);
  assert.equal(daysBetween('2026-09-28', '2026-09-25'), -3);
  assert.throws(() => addDays('Sep 25', 1), RangeError);
});

test('chicagoTimeToIso converts Chicago wall time, across DST', () => {
  assert.equal(chicagoTimeToIso('2026-09-25', 9), '2026-09-25T14:00:00.000Z');
  assert.equal(chicagoTimeToIso('2026-09-25', 13, 30), '2026-09-25T18:30:00.000Z');
  assert.equal(chicagoTimeToIso('2026-12-01', 9), '2026-12-01T15:00:00.000Z');
  assert.equal(chicagoTimeToIso('2026-11-01', 9), '2026-11-01T15:00:00.000Z'); // CST from 2 AM
  assert.equal(chicagoTimeToIso('2026-03-08', 9), '2026-03-08T14:00:00.000Z'); // CDT from 2 AM
  assert.equal(startOfDayChicagoIso('2026-09-25'), '2026-09-25T05:00:00.000Z');
  assert.equal(startOfDayChicagoIso('2026-12-01'), '2026-12-01T06:00:00.000Z');
});

test('dayLabel and fmtDuration', () => {
  assert.equal(dayLabel('2026-09-25T14:00:00Z', '2026-09-25'), 'Today');
  assert.equal(dayLabel('2026-09-26T14:00:00Z', '2026-09-25'), 'Tomorrow');
  assert.equal(dayLabel('2026-09-27T15:00:00Z', '2026-09-25'), 'Sun · Sep 27');
  assert.equal(fmtDuration(185), '3 hr 5 min');
  assert.equal(fmtDuration(150), '2 hr 30 min');
  assert.equal(fmtDuration(0), '0 hr 0 min');
});
