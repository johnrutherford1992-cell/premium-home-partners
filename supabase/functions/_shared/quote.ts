// fanout-quote logic that doesn't touch the network: which network vendors
// bid, when, at what price and availability date.
// Runtime-neutral so it is unit-tested under `node --test`.

export interface NetworkVendor {
  /** vendors.company for a row with profile_id null. */
  company: string;
  /** Multiplier on quote_requests.base. */
  factor: number;
  /** available_on = today in Chicago + days. */
  days: number;
  /** Delay after the previous bid (or the request) before this bid lands. */
  delayMs: number;
}

export const NETWORK_VENDORS: readonly NetworkVendor[] = [
  { company: 'Summit Pro Services', factor: 0.88, days: 4, delayMs: 1500 },
  { company: 'Clearview & Sons', factor: 1.14, days: 6, delayMs: 1300 },
];

/** Whole-dollar bid: round(base × factor), with float noise removed first. */
export function networkBidPrice(base: unknown, factor: number): number | null {
  const b = typeof base === 'number' ? base : typeof base === 'string' && base.trim() ? Number(base) : NaN;
  if (!Number.isFinite(b) || b <= 0) return null;
  return Math.round(Number((b * factor).toFixed(6)));
}

/** 'YYYY-MM-DD' for `now` in America/Chicago. */
export function chicagoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export type SkipReason = 'not_open' | 'already_bid' | 'no_vendor' | 'no_price' | null;

/** Why a network vendor should not bid right now, or null to bid. */
export function skipReason(opts: {
  status: string | null | undefined;
  vendorId: string | null | undefined;
  alreadyBid: boolean;
  price: number | null;
}): SkipReason {
  if (opts.status !== 'open') return 'not_open';
  if (!opts.vendorId) return 'no_vendor';
  if (opts.alreadyBid) return 'already_bid';
  if (opts.price === null) return 'no_price';
  return null;
}
