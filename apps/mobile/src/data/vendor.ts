// Vendor data: the signed-in vendor's company, the quote requests in its
// categories, and its own bids. Live reads come from Supabase; demo reads the
// shared zustand store, so offline demo behaves exactly as before.
//
// Privacy: the vendor never reads `homes` or `profiles`. A request's location
// comes only from `quote_requests.area` + `home_sqft`, and RLS returns only
// this vendor's own `bids` and `vendors` row (docs/LIVE_ARCHITECTURE.md §4).

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { VendorViewInput } from '../components/vendorView';
import { useSession } from '../lib/auth';
import { addDays, fmtShortDate, todayChicago } from '../lib/dates';
import { useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { invalidateTables } from '../lib/realtime';
import { friendlyError, rpc, unwrap } from '../lib/rpc';
import { requireSupabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useApp, type QuoteRequest } from '../store/app';
import { useHomeNames } from '../store/derived';
import { ADD_ONS, MY_VENDOR, VENDOR_DATES } from './seed';

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export interface VendorMe {
  id: string;
  company: string;
  rating: number | null;
  categories: string[];
}

export interface VendorBidVM {
  id: string;
  price: number;
  /** `'YYYY-MM-DD'` in live mode; the chip label in demo. */
  availableOn: string | null;
}

export interface VendorRequestVM extends VendorViewInput {
  id: string;
  category: string;
  /** Service name, from ADD_ONS by category. */
  name: string;
  /** Scope line: the request's scope, else the add-on's. */
  sub: string;
  /** `'12 Linden Court · Dallas 75205'`: street and city only, never the owner. */
  area: string;
  /** `area` up to the first ' · '. */
  street: string;
  sqft: number | null;
  /** Suggested starting price. */
  base: number;
  bidCount: number;
  /** This vendor's own bid, if any. */
  myBid: VendorBidVM | null;
  status: 'open' | 'booked' | 'canceled';
  bookedBidId: string | null;
  createdAt: string | null;
}

/** Live hooks return friendly error text, only when there's nothing to show. */
export interface VendorQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Live queries
// ---------------------------------------------------------------------------

/** The only columns the vendor app reads: no home id, no owner. */
export const VENDOR_REQUEST_SELECT =
  'id,category,scope,status,area,home_sqft,base,bid_count,booked_bid_id,created_at,bids!bids_request_id_fkey(id,price,available_on)';
export const VENDOR_TABLES = ['quote_requests', 'bids'];

export const vendorKeys = {
  me: (userId: string | null) => ['vendor', 'me', userId] as const,
  requests: (userId: string | null) => ['vendor', 'requests', userId] as const,
  request: (id: string, userId: string | null) => ['vendor', 'request', id, userId] as const,
};

/** Bid dates offered to the vendor: today (Chicago) + 3, + 5 and + 8 days. */
export const VENDOR_DAY_OFFSETS = [3, 5, 8];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (x: unknown, fallback: number) => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

interface BidRow {
  id: string;
  price: unknown;
  available_on: string | null;
}
interface RequestRow {
  id: string;
  category: string | null;
  scope: string | null;
  status: string | null;
  area: string | null;
  home_sqft: unknown;
  base: unknown;
  bid_count: unknown;
  booked_bid_id: string | null;
  created_at: string | null;
  bids?: BidRow[] | null;
}

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** A `quote_requests` row (with this vendor's embedded bids) → VendorRequestVM. */
export function mapVendorRequest(row: RequestRow): VendorRequestVM {
  const category = str(row.category);
  const addOn = ADD_ONS.find((a) => a.id === category);
  const area = str(row.area);
  const bid = (row.bids ?? [])[0];
  const myBid: VendorBidVM | null = bid ? { id: bid.id, price: num(bid.price, 0), availableOn: bid.available_on ?? null } : null;
  const status = row.status === 'booked' || row.status === 'canceled' ? row.status : 'open';
  const sqft = row.home_sqft == null ? null : num(row.home_sqft, NaN);
  return {
    id: row.id,
    category,
    name: addOn?.name ?? (titleCase(category) || 'Service request'),
    sub: str(row.scope) || addOn?.sub || '',
    area,
    street: area.split(' · ')[0],
    sqft: sqft != null && Number.isFinite(sqft) ? sqft : null,
    base: num(row.base, addOn?.base ?? 0),
    bidCount: Math.max(num(row.bid_count, 0), myBid ? 1 : 0),
    myBid,
    status,
    bookedBidId: row.booked_bid_id ?? null,
    createdAt: row.created_at ?? null,
  };
}

async function fetchVendorMe(userId: string): Promise<VendorMe | null> {
  const res = await requireSupabase()
    .from('vendors')
    .select('id,company,rating,categories')
    .eq('profile_id', userId)
    .order('company')
    .limit(1)
    .maybeSingle();
  const row = unwrap<{ id: string; company: string | null; rating: unknown; categories: string[] | null } | null>(res);
  if (!row) return null;
  return { id: row.id, company: str(row.company), rating: row.rating == null ? null : num(row.rating, 0), categories: row.categories ?? [] };
}

async function fetchVendorRequests(): Promise<VendorRequestVM[]> {
  const res = await requireSupabase()
    .from('quote_requests')
    .select(VENDOR_REQUEST_SELECT)
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .order('id');
  return (unwrap<RequestRow[]>(res) ?? []).map(mapVendorRequest);
}

async function fetchVendorRequest(id: string): Promise<VendorRequestVM | null> {
  const res = await requireSupabase().from('quote_requests').select(VENDOR_REQUEST_SELECT).eq('id', id).maybeSingle();
  const row = unwrap<RequestRow | null>(res);
  return row ? mapVendorRequest(row) : null;
}

const noop = () => {};

function result<T>(q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }): VendorQueryResult<T> {
  return {
    data: q.data,
    isLoading: q.isLoading,
    error: q.data === undefined && q.error ? friendlyError(q.error) : null,
    refetch: () => void q.refetch(),
  };
}

function useLiveVendorMe(): VendorQueryResult<VendorMe | null> {
  const { userId } = useSession();
  const q = useQuery({
    queryKey: vendorKeys.me(userId),
    queryFn: () => fetchVendorMe(userId!),
    enabled: !!userId,
    // `vendors` isn't in the realtime publication and rarely changes.
    staleTime: 60_000,
    refetchInterval: 60_000,
    meta: { tables: ['vendors'] },
  });
  return result(q);
}

function useLiveVendorRequests(): VendorQueryResult<VendorRequestVM[]> {
  const { userId } = useSession();
  const q = useQuery({
    queryKey: vendorKeys.requests(userId),
    queryFn: fetchVendorRequests,
    enabled: !!userId,
    meta: { tables: VENDOR_TABLES },
  });
  return result(q);
}

function useLiveVendorRequest(id: string | undefined): VendorQueryResult<VendorRequestVM | null> {
  const { userId } = useSession();
  const valid = typeof id === 'string' && UUID_RE.test(id);
  const q = useQuery({
    queryKey: vendorKeys.request(id ?? '', userId),
    queryFn: () => fetchVendorRequest(id!),
    enabled: !!userId && valid,
    // Opening a card from the list shows it straight away.
    placeholderData: () => queryClient.getQueryData<VendorRequestVM[]>(vendorKeys.requests(userId))?.find((r) => r.id === id),
    meta: { tables: VENDOR_TABLES },
  });
  const res = result(q);
  // Not a request id at all: the same "no longer available" screen as a deleted one.
  return valid ? res : { data: null, isLoading: false, error: null, refetch: noop };
}

// ---------------------------------------------------------------------------
// Demo adapters (the shared zustand store)
// ---------------------------------------------------------------------------

function demoRequest(r: QuoteRequest, street: string, sqft: number): VendorRequestVM {
  const mi = r.bids.findIndex((b) => b.mine);
  const mine = mi >= 0 ? r.bids[mi] : null;
  return {
    id: r.id,
    category: r.id,
    name: r.name,
    sub: r.sub,
    area: `${street} · Dallas 75205`,
    street,
    sqft,
    base: r.base,
    bidCount: r.bids.length,
    myBid: mine ? { id: String(mi), price: mine.price, availableOn: mine.when } : null,
    status: r.booked != null ? 'booked' : 'open',
    bookedBidId: r.booked != null ? String(r.booked) : null,
    createdAt: null,
  };
}

const DEMO_ME: VendorMe = { id: 'demo-vendor', company: MY_VENDOR.vendor, rating: MY_VENDOR.rating, categories: ADD_ONS.map((a) => a.id) };

function useDemoVendorMe(): VendorQueryResult<VendorMe | null> {
  return useMemo(() => ({ data: DEMO_ME, isLoading: false, error: null, refetch: noop }), []);
}

function useDemoVendorRequests(): VendorQueryResult<VendorRequestVM[]> {
  const { reqs, sqft } = useApp(useShallow((s) => ({ reqs: s.reqs, sqft: s.sqft })));
  const { street } = useHomeNames();
  return useMemo(
    () => ({ data: reqs.map((r) => demoRequest(r, street, sqft)), isLoading: false, error: null, refetch: noop }),
    [reqs, street, sqft],
  );
}

function useDemoVendorRequest(id: string | undefined): VendorQueryResult<VendorRequestVM | null> {
  const all = useDemoVendorRequests();
  return useMemo(() => ({ ...all, data: all.data?.find((r) => r.id === id) ?? null }), [all, id]);
}

// ---------------------------------------------------------------------------
// Mode-dispatching hooks
// ---------------------------------------------------------------------------

/** The signed-in vendor's company row (live: `vendors` where profile_id = me). */
export function useVendorMe(): VendorQueryResult<VendorMe | null> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveVendorMe : useDemoVendorMe;
  return useImpl();
}

/** Requests in this vendor's categories, newest first (live), with this vendor's own bid. */
export function useVendorRequests(): VendorQueryResult<VendorRequestVM[]> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveVendorRequests : useDemoVendorRequests;
  return useImpl();
}

/** One request. `data` is null when it doesn't exist (or isn't visible to this vendor). */
export function useVendorRequest(id: string | undefined): VendorQueryResult<VendorRequestVM | null> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveVendorRequest : useDemoVendorRequest;
  return useImpl(id);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface SubmitBidArgs {
  requestId: string;
  price: number;
  /** `'YYYY-MM-DD'` */
  availableOn: string;
}

/**
 * Live: `submit_bid(p_request, p_price, p_available_on)`. Shows the bid in the
 * vendor's caches straight away, then refetches the tables it touched.
 */
export async function submitBid({ requestId, price, availableOn }: SubmitBidArgs): Promise<VendorBidVM> {
  const row = await rpc<BidRow>('submit_bid', { p_request: requestId, p_price: price, p_available_on: availableOn });
  const bid: VendorBidVM = { id: row.id, price: num(row.price, price), availableOn: row.available_on ?? availableOn };
  const withBid = (r: VendorRequestVM): VendorRequestVM =>
    r.id !== requestId || r.myBid ? r : { ...r, myBid: bid, bidCount: r.bidCount + 1 };
  queryClient.setQueriesData<VendorRequestVM[]>({ queryKey: ['vendor', 'requests'] }, (old) => old?.map(withBid));
  queryClient.setQueriesData<VendorRequestVM | null>({ queryKey: ['vendor', 'request', requestId] }, (old) => (old ? withBid(old) : old));
  await invalidateTables(VENDOR_TABLES);
  return bid;
}

/** The quote form on a request: price stepper, date chips and submit. */
export interface BidDraft {
  price: number;
  /** 50 above $500, else 5. The price never goes below one step. */
  step: number;
  setPrice(p: number): void;
  /** Chip labels, e.g. 'Sun, Oct 18'. */
  dates: readonly string[];
  when: number;
  setWhen(i: number): void;
  submit(): void;
  submitting: boolean;
  /** Friendly text for the last failed submit. */
  error: string | null;
}

const stepFor = (base: number) => (base > 500 ? 50 : 5);

function useLiveBidDraft(r: VendorRequestVM): BidDraft {
  const [override, setOverride] = useState<number | null>(null);
  const [when, setWhen] = useState(0);
  const step = stepFor(r.base);
  const price = override ?? r.base;
  const ymds = useMemo(() => {
    const today = todayChicago();
    return VENDOR_DAY_OFFSETS.map((n) => addDays(today, n));
  }, []);
  const dates = useMemo(() => ymds.map((d) => fmtShortDate(d)), [ymds]);
  const m = useMutation({
    mutationKey: ['vendor', 'submitBid'],
    mutationFn: submitBid,
    onError: (e) => {
      toast(friendlyError(e), 'brick');
      // e.g. "This request is closed.": refetch so the screen shows the new state.
      void invalidateTables(VENDOR_TABLES);
    },
  });
  return {
    price,
    step,
    setPrice: (p) => setOverride(Math.max(step, p)),
    dates,
    when,
    setWhen,
    submit: () => {
      if (m.isPending) return;
      m.mutate({ requestId: r.id, price, availableOn: ymds[when] ?? ymds[0] });
    },
    submitting: m.isPending,
    error: m.error ? friendlyError(m.error) : null,
  };
}

// Demo: the store's shared vPrice / vWhen and submitBid, exactly as before.
function useDemoBidDraft(r: VendorRequestVM): BidDraft {
  const { vPrice, vWhen, set, submit } = useApp(
    useShallow((s) => ({ vPrice: s.vPrice, vWhen: s.vWhen, set: s.set, submit: s.submitBid })),
  );
  const step = stepFor(r.base);
  const price = vPrice[r.id] ?? r.base;
  return {
    price,
    step,
    setPrice: (p) => set({ vPrice: { ...vPrice, [r.id]: Math.max(step, p) } }),
    dates: VENDOR_DATES,
    when: vWhen,
    setWhen: (i) => set({ vWhen: i }),
    submit: () => submit(r.id, price, VENDOR_DATES[vWhen]),
    submitting: false,
    error: null,
  };
}

export function useBidDraft(r: VendorRequestVM): BidDraft {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveBidDraft : useDemoBidDraft;
  return useImpl(r);
}
