// Dates and times, always in America/Chicago (the service area), whatever the
// device's own time zone. Pure functions, unit-tested in test/dates.test.ts.
// Names and AM/PM are built by hand rather than taken from Intl output, so
// every engine (Hermes, V8, JSC) prints identical strings.

export const TZ = 'America/Chicago';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wall-clock fields in Chicago. `m` is 1–12, `wd` is 0 (Sun) – 6 (Sat). */
export interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  wd: number;
}

type DateInput = string | number | Date;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

let fmt: Intl.DateTimeFormat | null = null;
function formatter(): Intl.DateTimeFormat {
  fmt ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return fmt;
}

const pad = (n: number) => String(n).padStart(2, '0');
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const x = DATE_ONLY.exec(ymd);
  if (!x) throw new RangeError(`Expected YYYY-MM-DD, got "${ymd}"`);
  return { y: +x[1], m: +x[2], d: +x[3] };
}

/**
 * Chicago wall-clock fields for an instant. A bare `YYYY-MM-DD` is a calendar
 * date, not an instant, so it's taken as-is (midnight) with no zone shift.
 */
export function wallClock(input: DateInput): Wall {
  if (typeof input === 'string' && DATE_ONLY.test(input)) {
    const { y, m, d } = ymdParts(input);
    return { y, m, d, h: 0, mi: 0, wd: weekday(y, m, d) };
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(input)}`);
  const f = formatter();
  let y = 0;
  let m = 0;
  let d = 0;
  let h = 0;
  let mi = 0;
  if (typeof f.formatToParts === 'function') {
    for (const p of f.formatToParts(date)) {
      if (p.type === 'year') y = +p.value;
      else if (p.type === 'month') m = +p.value;
      else if (p.type === 'day') d = +p.value;
      else if (p.type === 'hour') h = +p.value;
      else if (p.type === 'minute') mi = +p.value;
    }
  } else {
    // "09/25/2026, 14:05"
    const x = /(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/.exec(f.format(date));
    if (x) [m, d, y, h, mi] = [+x[1], +x[2], +x[3], +x[4], +x[5]];
  }
  if (h === 24) h = 0;
  return { y, m, d, h, mi, wd: weekday(y, m, d) };
}

/** `'YYYY-MM-DD'` of the Chicago calendar day an instant falls on. */
export function chicagoDate(input: DateInput): string {
  const w = wallClock(input);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** Today's date in Chicago, `'YYYY-MM-DD'`. */
export function todayChicago(now: DateInput = new Date()): string {
  return chicagoDate(now);
}

/** `addDays('2026-09-25', 3)` → `'2026-09-28'`. Calendar arithmetic, no zone involved. */
export function addDays(ymd: string, n: number): string {
  const { y, m, d } = ymdParts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (both `'YYYY-MM-DD'`). */
export function daysBetween(a: string, b: string): number {
  const x = ymdParts(a);
  const y = ymdParts(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86_400_000);
}

/** ISO instant for a Chicago wall time: `chicagoTimeToIso('2026-09-25', 9)` → `'2026-09-25T14:00:00.000Z'`. */
export function chicagoTimeToIso(ymd: string, hour: number, minute = 0): string {
  const { y, m, d } = ymdParts(ymd);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let ts = target;
  // Two passes settle the offset, including across a DST change.
  for (let i = 0; i < 2; i++) {
    const w = wallClock(ts);
    ts += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  }
  return new Date(ts).toISOString();
}

/** Midnight in Chicago at the start of `ymd` (default today), as an ISO instant. */
export function startOfDayChicagoIso(ymd: string = todayChicago()): string {
  return chicagoTimeToIso(ymd, 0);
}

/** `'Fri · Sep 25'` */
export function fmtDay(iso: DateInput): string {
  const w = wallClock(iso);
  return `${WEEKDAYS[w.wd]} · ${MONTHS[w.m - 1]} ${w.d}`;
}

const clock = (w: Wall) => `${w.h % 12 || 12}:${pad(w.mi)}`;
const meridiem = (w: Wall) => (w.h < 12 ? 'AM' : 'PM');

/** `'9:00 AM'` */
export function fmtTime(iso: DateInput): string {
  const w = wallClock(iso);
  return `${clock(w)} ${meridiem(w)}`;
}

/**
 * `'9:00 – 11:00 AM'`, or `'11:00 AM – 1:00 PM'` when the window crosses noon.
 * With no end, just the start time: `'9:00 AM'`.
 */
export function fmtWindow(startIso: DateInput, endIso?: DateInput | null): string {
  const a = wallClock(startIso);
  if (endIso == null || endIso === '') return `${clock(a)} ${meridiem(a)}`;
  const b = wallClock(endIso);
  return meridiem(a) === meridiem(b) ? `${clock(a)} – ${clock(b)} ${meridiem(b)}` : `${clock(a)} ${meridiem(a)} – ${clock(b)} ${meridiem(b)}`;
}

/** `fmtShortDate('2026-10-18')` → `'Sun, Oct 18'` (also takes an ISO instant). */
export function fmtShortDate(date: DateInput): string {
  const w = wallClock(date);
  return `${WEEKDAYS[w.wd]}, ${MONTHS[w.m - 1]} ${w.d}`;
}

/** `'Oct'` */
export function fmtMonth(iso: DateInput): string {
  return MONTHS[wallClock(iso).m - 1];
}

/** `'WEEK OF SEP 21'`: the Monday of the week `date` falls in. */
export function weekOfLabel(date: DateInput = new Date()): string {
  const w = wallClock(date);
  const monday = addDays(`${w.y}-${pad(w.m)}-${pad(w.d)}`, -((w.wd + 6) % 7));
  const { m, d } = ymdParts(monday);
  return `WEEK OF ${MONTHS[m - 1].toUpperCase()} ${d}`;
}

/** `'Today'`, `'Tomorrow'`, else `fmtDay`. */
export function dayLabel(iso: DateInput, today: string = todayChicago()): string {
  const n = daysBetween(today, chicagoDate(iso));
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return fmtDay(iso);
}

/** `'3 hr 5 min'`, the visit-duration format used across the apps. */
export function fmtDuration(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}
