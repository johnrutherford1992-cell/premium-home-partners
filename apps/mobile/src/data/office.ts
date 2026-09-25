// Office console data: dispatch board, brokered add-on quotes, the pricing
// calculator's reference home, and the demo reset. Live reads come from
// Supabase (office RLS reads everything); demo adapts the shared zustand store
// exactly as the screens did before.

import { COORDINATION_FEE, DEFAULT_MINUTES, TIERS, type HomeProfile, type Water } from '@php/pricing';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TECH_STATUS } from '../components/techStatus';
import { addDays, fmtDay, fmtTime, startOfDayChicagoIso, todayChicago, wallClock, weekOfLabel } from '../lib/dates';
import { friendlyError } from '../lib/errors';
import { getMode, useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { invalidateTables } from '../lib/realtime';
import { rpc, unwrap } from '../lib/rpc';
import { requireSupabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useApp } from '../store/app';
import { useHomeNames, useVisit } from '../store/derived';
import { ADD_ONS, TECH } from './seed';
import { mapVisit, type VisitRow } from './visits';

/** Result shape shared by the office read hooks. `error` is only set when there's no data to show. */
export interface OfficeQuery<T> {
  data?: T;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const noop = () => {};

function useResult<T>(q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }): OfficeQuery<T> {
  const { data, isLoading, error, refetch } = q;
  return useMemo(
    () => ({
      data,
      isLoading: isLoading && data === undefined,
      error: data === undefined && error ? friendlyError(error) : null,
      refetch: () => void refetch(),
    }),
    [data, isLoading, error, refetch],
  );
}

const num = (x: unknown, fallback = 0) => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

type One<T> = T | T[] | null | undefined;
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

// ---------------------------------------------------------------------------
// Pricing calculator: reference home + selected tier column
// ---------------------------------------------------------------------------

/** Elena's home, the one the office calculator prices for. */
export const REFERENCE_STREET = '12 Linden Court';
const REFERENCE_FALLBACK: HomeProfile = { pets: true, water: 'city_hard' };
const WATERS: readonly Water[] = ['city_hard', 'well', 'softened'];

export interface ReferenceHome {
  street: string;
  home: HomeProfile;
  isLoading: boolean;
}

function useLiveReferenceHome(): ReferenceHome {
  const q = useQuery({
    queryKey: ['office', 'referenceHome'],
    meta: { tables: ['homes'] },
    queryFn: async () => {
      const res = await requireSupabase()
        .from('homes')
        .select('id,address,pets,water')
        .ilike('address', `${REFERENCE_STREET}%`)
        .order('created_at', { ascending: true })
        .limit(1);
      const rows = unwrap<{ id: string; address: string | null; pets: boolean | null; water: string | null }[] | null>(res) ?? [];
      return rows[0] ?? null;
    },
  });
  const row = q.data;
  return useMemo(() => {
    // Missing or unreadable home: the calculator still works with Elena's profile.
    if (!row) return { street: REFERENCE_STREET, home: REFERENCE_FALLBACK, isLoading: q.isLoading };
    const water = WATERS.includes(row.water as Water) ? (row.water as Water) : REFERENCE_FALLBACK.water;
    return {
      street: (row.address ?? '').split(',')[0]?.trim() || REFERENCE_STREET,
      home: { pets: !!row.pets, water },
      isLoading: false,
    };
  }, [row, q.isLoading]);
}

function useDemoReferenceHome(): ReferenceHome {
  const { street } = useHomeNames();
  const { pets, water } = useApp(useShallow((s) => ({ pets: s.pets, water: s.water })));
  return useMemo(() => ({ street, home: { pets, water }, isLoading: false }), [street, pets, water]);
}

/** The home the pricing calculator quotes: Elena's (live, by address) or the demo store's. */
export function useReferenceHome(): ReferenceHome {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveReferenceHome : useDemoReferenceHome;
  return useImpl();
}

function useLiveOfficeTier(): [number, (i: number) => void] {
  return useState(1);
}

function useDemoOfficeTier(): [number, (i: number) => void] {
  const tier = useApp((s) => s.tier);
  const set = useCallback((i: number) => useApp.getState().set({ tier: i }), []);
  return [tier, set];
}

/** The highlighted tier column. Live: local UI state (default PHP Recommended). Demo: the shared store's tier. */
export function useOfficeTier(): [number, (i: number) => void] {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveOfficeTier : useDemoOfficeTier;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type DispatchTone = 'ink' | 'muted' | 'accent' | 'forest' | 'ochre';

export interface DispatchRow {
  id: string;
  /** `'Fri · Sep 25 9:00 AM'` */
  when: string;
  client: string;
  addr: string;
  tech: string;
  tier: string;
  d7: string;
  d7Tone: DispatchTone;
  n48: string;
  n48Tone: DispatchTone;
  status: string;
  statusTone: DispatchTone;
}

export interface DispatchData {
  /** `'WEEK OF SEP 21'` */
  weekLabel: string;
  rows: DispatchRow[];
  /** Every row that can still get a 48-hour reminder already has one. */
  allSent: boolean;
}

const DISPATCH_SELECT = [
  'id,home_id,status,window_start,window_end,confirmed_at',
  'homes(id,address,pets,notes,owner:profiles!homes_owner_id_fkey(full_name))',
  'plans(tier)',
  'tech:profiles!visits_tech_id_fkey(id,full_name,title,vehicle)',
  'notices(kind)',
].join(',');
const DISPATCH_TABLES = ['visits', 'notices', 'homes', 'plans', 'profiles'];

/** Monday–Sunday (Chicago) around `today`, as `[startIso, endIso)`. */
export function chicagoWeek(today: string = todayChicago()): { monday: string; startIso: string; endIso: string } {
  const monday = addDays(today, -((wallClock(today).wd + 6) % 7));
  return { monday, startIso: startOfDayChicagoIso(monday), endIso: startOfDayChicagoIso(addDays(monday, 7)) };
}

const isReferenceStreet = (street: string) => street.trim().toLowerCase().startsWith(REFERENCE_STREET.toLowerCase());

/** One dispatch row per visit (pure, so it's shared by the live hook and tests). */
export function toDispatchRows(rows: VisitRow[], todayStartIso: string): { rows: DispatchRow[]; allSent: boolean } {
  const todayStart = Date.parse(todayStartIso);
  let eligible = 0;
  let waiting = 0;
  const out = rows.map((row): DispatchRow => {
    const v = mapVisit(row, DEFAULT_MINUTES);
    const start = v.windowStart ? Date.parse(v.windowStart) : NaN;
    // send_48h_reminders covers visits from today on that aren't done.
    const canSend = v.status !== 'done' && Number.isFinite(start) && start >= todayStart;
    if (canSend) {
      eligible += 1;
      if (!v.notices.h48) waiting += 1;
    }
    const unconfirmed = v.status === 'scheduled' && !v.confirmed;
    const awaiting = unconfirmed && !isReferenceStreet(v.client.street);
    return {
      id: v.id,
      when: v.windowStart ? `${fmtDay(v.windowStart)} ${fmtTime(v.windowStart)}` : '—',
      client: v.client.name || 'Client',
      addr: v.client.street,
      tech: v.tech?.name ?? 'Unassigned',
      tier: v.tierName,
      d7: v.notices.d7 ? '✓' : '—',
      d7Tone: v.notices.d7 ? 'forest' : 'muted',
      n48: v.notices.h48 ? '✓' : canSend ? 'Queued' : '—',
      n48Tone: v.notices.h48 ? 'forest' : 'muted',
      status: awaiting ? 'Awaiting' : TECH_STATUS[v.status].label + (v.confirmed && v.status === 'scheduled' ? ' · conf.' : ''),
      statusTone: awaiting ? 'ochre' : v.status === 'done' ? 'forest' : v.status === 'scheduled' ? 'ink' : 'accent',
    };
  });
  return { rows: out, allSent: eligible > 0 && waiting === 0 };
}

function useLiveDispatch(): OfficeQuery<DispatchData> {
  const today = todayChicago();
  const { startIso, endIso } = chicagoWeek(today);
  const q = useQuery({
    queryKey: ['office', 'dispatch', startIso],
    meta: { tables: DISPATCH_TABLES },
    queryFn: async (): Promise<DispatchData> => {
      const res = await requireSupabase()
        .from('visits')
        .select(DISPATCH_SELECT)
        .gte('window_start', startIso)
        .lt('window_start', endIso)
        .neq('status', 'canceled')
        .order('window_start', { ascending: true });
      const rows = unwrap<VisitRow[] | null>(res as { data: VisitRow[] | null; error: unknown; status?: number }) ?? [];
      return { weekLabel: weekOfLabel(today), ...toDispatchRows(rows, startOfDayChicagoIso(today)) };
    },
  });
  return useResult(q);
}

function useDemoDispatch(): OfficeQuery<DispatchData> {
  const { step, tech, confirmed, reminders, tier } = useApp(
    useShallow((s) => ({ step: s.step, tech: s.tech, confirmed: s.confirmed, reminders: s.reminders, tier: s.tier })),
  );
  const visit = useVisit();
  const { name, street } = useHomeNames();
  return useMemo(() => {
    const main = step >= 6;
    const n48 = reminders ? '✓' : 'Queued';
    const n48Tone: DispatchTone = reminders ? 'forest' : 'muted';
    const base = { d7: '✓', d7Tone: 'forest' as DispatchTone, n48, n48Tone };
    const rows: DispatchRow[] = [
      {
        ...base,
        id: 'elena',
        when: `${visit.day} ${visit.time.split(' – ')[0]}`,
        client: name,
        addr: street,
        tech: TECH.name,
        tier: main ? TIERS[tier].name : 'Onboarding',
        status: main ? TECH_STATUS[tech].label + (confirmed && tech === 'scheduled' ? ' · conf.' : '') : 'Pending',
        statusTone: tech === 'done' ? 'forest' : tech === 'scheduled' ? 'ink' : 'accent',
      },
      { ...base, id: 'david', when: 'Tue · Oct 14 12:00 PM', client: 'David Okafor', addr: '4410 Bryn Mawr', tech: TECH.name, tier: 'Medium', status: 'Confirmed', statusTone: 'ink' },
      { ...base, id: 'whit', when: 'Tue · Oct 14 3:00 PM', client: 'The Whitfields', addr: '88 Beverly Dr', tech: TECH.name, tier: 'High', status: 'Confirmed', statusTone: 'ink' },
      { ...base, id: 'priya', when: 'Wed · Oct 15 9:00 AM', client: 'Priya Shah', addr: '17 Stonebridge', tech: 'Dana Liu', tier: 'PHP Recommended', n48: '—', n48Tone: 'muted', status: 'Awaiting', statusTone: 'ochre' },
      { ...base, id: 'bell', when: 'Thu · Oct 16 10:00 AM', client: 'Mark & Jo Bell', addr: '203 Lakewood', tech: 'Dana Liu', tier: 'Low', n48: '—', n48Tone: 'muted', status: 'Confirmed', statusTone: 'ink' },
    ];
    return { data: { weekLabel: 'WEEK OF OCT 13', rows, allSent: reminders }, isLoading: false, error: null, refetch: noop };
  }, [step, tech, confirmed, reminders, tier, visit.day, visit.time, name, street]);
}

/** This week's visits (Mon–Sun, Chicago) for every tech, ordered by window. */
export function useDispatch(): OfficeQuery<DispatchData> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveDispatch : useDemoDispatch;
  return useImpl();
}

export interface OfficeAction {
  run(): void;
  pending: boolean;
}

/**
 * Send the 48-hour reminder for every upcoming visit that hasn't had one.
 * Live: rpc send_48h_reminders, then refetch notices. Demo: the store flag
 * (set synchronously, as before). Resolves to the number of reminders sent.
 */
export async function sendReminders(): Promise<number> {
  if (getMode() === 'demo') {
    const already = useApp.getState().reminders;
    useApp.getState().set({ reminders: true });
    return already ? 0 : 3;
  }
  const n = num(await rpc<number>('send_48h_reminders'));
  await invalidateTables(['notices']);
  return n;
}

function useLiveSendReminders(): OfficeAction {
  const m = useMutation({
    mutationFn: sendReminders,
    onSuccess: (n) => toast(`Sent ${n} reminder${n === 1 ? '' : 's'}`, 'forest'),
    onError: (e) => toast(friendlyError(e), 'brick'),
  });
  const { mutate, isPending } = m;
  return useMemo(() => ({ run: () => mutate(), pending: isPending }), [mutate, isPending]);
}

// Demo keeps today's instant, silent toggle.
const DEMO_SEND: OfficeAction = { run: () => void sendReminders(), pending: false };
function useDemoSendReminders(): OfficeAction {
  return DEMO_SEND;
}

/** "Send 48-hr reminders" button state: toast "Sent n reminders" (live), disabled while in flight. */
export function useSendReminders(): OfficeAction {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveSendReminders : useDemoSendReminders;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Add-on quotes
// ---------------------------------------------------------------------------

export interface OfficeQuoteRow {
  id: string;
  category: string;
  name: string;
  client: string;
  bidCount: number;
  lowest: number | null;
  booked: boolean;
  /** Company of the booked bid, when booked. */
  bookedVendor: string | null;
}

export interface OfficeQuotesData {
  rows: OfficeQuoteRow[];
  open: number;
  booked: number;
  /** Sum of coordination fees on booked requests, in dollars. */
  fees: number;
  vettedVendors: number;
}

interface QuoteRow {
  id: string;
  category: string | null;
  status: string | null;
  created_at: string | null;
  booked_bid_id: string | null;
  bid_count: number | null;
  /** One-to-one on request_id (PostgREST returns an object or null; an array is tolerated too). */
  quote_bookings?: One<{ coordination_fee: unknown }>;
  homes?: One<{ owner?: One<{ full_name: string | null }> }>;
  bids?: { id: string; price: unknown; vendor_name: string | null }[] | null;
}

// The coordination fee lives in quote_bookings (owner + office only), never on the request vendors read.
const QUOTES_SELECT =
  'id,category,status,created_at,booked_bid_id,bid_count,quote_bookings(coordination_fee),homes(owner:profiles!homes_owner_id_fkey(full_name)),bids(id,price,vendor_name)';
const QUOTES_TABLES = ['quote_requests', 'quote_bookings', 'bids', 'homes', 'profiles', 'vendors'];

/** Request rows → the office table and stats (pure). */
export function toOfficeQuotes(rows: QuoteRow[], vettedVendors: number): OfficeQuotesData {
  const out = rows.map((r): OfficeQuoteRow => {
    const bids = r.bids ?? [];
    const prices = bids.map((b) => num(b.price, NaN)).filter((p) => Number.isFinite(p));
    const bookedBid = r.booked_bid_id ? bids.find((b) => b.id === r.booked_bid_id) : undefined;
    const booked = r.status === 'booked';
    const category = r.category ?? '';
    return {
      id: r.id,
      category,
      name: ADD_ONS.find((a) => a.id === category)?.name ?? category,
      client: one(one(r.homes)?.owner)?.full_name?.trim() || 'Client',
      bidCount: Math.max(bids.length, num(r.bid_count)),
      lowest: prices.length ? Math.min(...prices) : null,
      booked,
      bookedVendor: booked ? (bookedBid?.vendor_name ?? null) : null,
    };
  });
  const booked = rows.filter((r) => r.status === 'booked');
  return {
    rows: out,
    open: rows.filter((r) => r.status === 'open').length,
    booked: booked.length,
    fees: Math.round(booked.reduce((a, r) => a + num(one(r.quote_bookings)?.coordination_fee), 0) * 100) / 100,
    vettedVendors,
  };
}

function useLiveOfficeQuotes(): OfficeQuery<OfficeQuotesData> {
  const q = useQuery({
    queryKey: ['office', 'quotes'],
    meta: { tables: QUOTES_TABLES },
    queryFn: async (): Promise<OfficeQuotesData> => {
      const sb = requireSupabase();
      const [reqs, vendors] = await Promise.all([
        sb.from('quote_requests').select(QUOTES_SELECT).neq('status', 'canceled').order('created_at', { ascending: true }),
        sb.from('vendors').select('id').eq('vetted', true),
      ]);
      const rows = unwrap<QuoteRow[] | null>(reqs as { data: QuoteRow[] | null; error: unknown; status?: number }) ?? [];
      const vetted = unwrap<{ id: string }[] | null>(vendors) ?? [];
      return toOfficeQuotes(rows, vetted.length);
    },
  });
  return useResult(q);
}

function useDemoOfficeQuotes(): OfficeQuery<OfficeQuotesData> {
  const reqs = useApp((s) => s.reqs);
  const { name } = useHomeNames();
  return useMemo(() => {
    const booked = reqs.filter((r) => r.booked != null);
    const fees = booked.reduce((a, r) => a + r.bids[r.booked!].price * COORDINATION_FEE, 0);
    const rows: OfficeQuoteRow[] = reqs.map((r) => ({
      id: r.id,
      category: r.id,
      name: r.name,
      client: name,
      bidCount: r.bids.length,
      lowest: r.bids.length ? Math.min(...r.bids.map((b) => b.price)) : null,
      booked: r.booked != null,
      bookedVendor: r.booked != null ? r.bids[r.booked].vendor : null,
    }));
    return {
      data: { rows, open: reqs.length - booked.length, booked: booked.length, fees, vettedVendors: 38 },
      isLoading: false,
      error: null,
      refetch: noop,
    };
  }, [reqs, name]);
}

/** Every add-on request with its client, bids and coordination fee. */
export function useOfficeQuotes(): OfficeQuery<OfficeQuotesData> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveOfficeQuotes : useDemoOfficeQuotes;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Reset demo data
// ---------------------------------------------------------------------------

/** Restore the demo scenario: rpc reset_demo (live) or the store's reset (demo), then refetch every query. */
export async function resetDemo(): Promise<void> {
  if (getMode() === 'live') await rpc<void>('reset_demo');
  else useApp.getState().reset();
  await queryClient.invalidateQueries();
}

/** "Reset demo data": disabled while in flight, toast "Demo data restored" (forest) or the error (brick). */
export function useResetDemo(): OfficeAction {
  const m = useMutation({
    mutationFn: resetDemo,
    onSuccess: () => toast('Demo data restored', 'forest'),
    onError: (e) => toast(friendlyError(e), 'brick'),
  });
  const { mutate, isPending } = m;
  return useMemo(() => ({ run: () => mutate(), pending: isPending }), [mutate, isPending]);
}
