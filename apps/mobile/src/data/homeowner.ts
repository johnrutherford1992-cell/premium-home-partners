// Homeowner app data: my home + plan, the current visit, tiers, the year of
// care, reports, add-on quote requests, and the onboarding flow. Live reads
// come from Supabase (owner RLS); every write goes through an RPC. Demo
// adapts the shared zustand store exactly as the screens did before.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_FREQ,
  DEFAULT_MINUTES,
  DEFAULT_SETTINGS,
  COORDINATION_FEE,
  TASKS,
  TIERS,
  adjustedFreq,
  buildSchedule,
  type HomeProfile,
  type Water,
} from '@php/pricing';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { useSession } from '../lib/auth';
import { chicagoDate, fmtDay, fmtMonth, fmtShortDate, fmtWindow, startOfDayChicagoIso, todayChicago } from '../lib/dates';
import { FriendlyError, friendlyError } from '../lib/errors';
import { useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { invalidateTables } from '../lib/realtime';
import { invokeFunction, rpc, unwrap } from '../lib/rpc';
import { requireSupabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useApp } from '../store/app';
import { useHomeNames, useTiers, useVisit, useYearOfCare as useDemoYearOfCareStore } from '../store/derived';
import { STATUS, type Tone } from '../theme/tokens';
import { tierViewsFor, usePricingInputs, type PricingInputs, type TierView } from './pricing';
import { ADD_ONS, APPLIANCES, SLOTS, TECH } from './seed';
import { VISIT_SELECT, VISIT_TABLES, mapVisit, type VisitRow, type VisitVM } from './visits';

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

/** A read hook's result. `error` is only set when there's no data to show. */
export interface HoQuery<T> {
  data?: T;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const noop = () => {};

function useResult<T>(q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }): HoQuery<T> {
  const { data, isLoading, error, refetch } = q;
  return useMemo(
    () => ({
      data,
      isLoading: data === undefined && !error,
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

/** A PostgREST result whose select string isn't a literal (so supabase-js can't type it). */
type Res = { data: unknown; error: unknown; status?: number };

const WATERS: readonly Water[] = ['city_hard', 'well', 'softened'];
const asWater = (w: unknown): Water => (WATERS.includes(w as Water) ? (w as Water) : 'city_hard');

/**
 * Writes not yet confirmed by a refetch. They're layered over fetched data, so
 * a poll landing mid-mutation can't snap the screen back to the old value.
 */
interface Pending {
  /** Plan tier being saved. */
  tier: number | null;
  /** Visit ids being confirmed. */
  confirming: string[];
}
const usePending = create<Pending>(() => ({ tier: null, confirming: [] }));

/** Query keys. Everything the homeowner app caches starts with 'homeowner'. */
export const HO_KEYS = {
  all: ['homeowner'] as const,
  myHome: (userId: string | null) => ['homeowner', 'myHome', userId] as const,
  currentVisit: (userId: string | null) => ['homeowner', 'currentVisit', userId] as const,
  reports: (userId: string | null) => ['homeowner', 'reports', userId] as const,
  requests: (userId: string | null) => ['homeowner', 'quoteRequests', userId] as const,
  planBuild: (buildId: string | null) => ['homeowner', 'planBuild', buildId] as const,
};

// ---------------------------------------------------------------------------
// My home + plan
// ---------------------------------------------------------------------------

export interface HomeVM {
  id: string;
  address: string;
  street: string;
  sqft: number;
  year: number;
  beds: number;
  baths: number;
  floors: number;
  zones: number;
  pets: boolean;
  water: Water;
  notes: string;
}

export interface PlanVM {
  id: string;
  tierIndex: number;
  monthly: number;
  annual: number;
  materials: number;
  labor: number;
  /** 'YYYY-MM-DD', the plan's first visit day. */
  startsOn: string | null;
}

export interface MyHomeVM {
  home: HomeVM | null;
  plan: PlanVM | null;
  name: string;
  firstName: string;
  street: string;
  /** Has a home and an active plan. */
  onboarded: boolean;
}

interface HomeRow {
  id: string;
  address: string | null;
  sqft: number | null;
  year_built: number | null;
  bedrooms: unknown;
  bathrooms: unknown;
  floors: number | null;
  hvac_zones: number | null;
  pets: boolean | null;
  water: string | null;
  notes: string | null;
  plans?: {
    id: string;
    tier: string | null;
    monthly: unknown;
    annual: unknown;
    materials: unknown;
    labor: unknown;
    starts_on: string | null;
    active: boolean | null;
  }[] | null;
}

const HOME_SELECT =
  'id,address,sqft,year_built,bedrooms,bathrooms,floors,hvac_zones,pets,water,notes,plans(id,tier,monthly,annual,materials,labor,starts_on,active)';
export const MY_HOME_TABLES = ['homes', 'plans', 'profiles'];

function mapHome(row: HomeRow | null): { home: HomeVM | null; plan: PlanVM | null } {
  if (!row) return { home: null, plan: null };
  const address = row.address ?? '';
  const home: HomeVM = {
    id: row.id,
    address,
    street: address.split(',')[0]?.trim() ?? '',
    sqft: num(row.sqft, 0),
    year: num(row.year_built, 0),
    beds: num(row.bedrooms, 0),
    baths: num(row.bathrooms, 0),
    floors: num(row.floors, 0),
    zones: num(row.hvac_zones, 0),
    pets: !!row.pets,
    water: asWater(row.water),
    notes: row.notes ?? '',
  };
  const active = (row.plans ?? [])
    .filter((p) => p.active)
    .sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? '') || a.id.localeCompare(b.id))[0];
  const tierIndex = active ? TIERS.findIndex((t) => t.key === active.tier) : -1;
  const plan: PlanVM | null = active
    ? {
        id: active.id,
        tierIndex: tierIndex < 0 ? 1 : tierIndex,
        monthly: num(active.monthly),
        annual: num(active.annual),
        materials: num(active.materials),
        labor: num(active.labor),
        startsOn: active.starts_on,
      }
    : null;
  return { home, plan };
}

async function fetchMyHome(userId: string): Promise<{ home: HomeVM | null; plan: PlanVM | null }> {
  const res = await requireSupabase()
    .from('homes')
    .select(HOME_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1);
  const rows = unwrap<HomeRow[] | null>(res) ?? [];
  return mapHome(rows[0] ?? null);
}

function names(fullName: string, address: string) {
  const name = fullName.trim();
  return { name, firstName: name.split(' ')[0] || 'there', street: address.split(',')[0]?.trim() ?? '' };
}

function useLiveMyHome(): HoQuery<MyHomeVM> {
  const { userId, profile } = useSession();
  const q = useQuery({
    queryKey: HO_KEYS.myHome(userId),
    queryFn: () => fetchMyHome(userId!),
    enabled: !!userId,
    meta: { tables: MY_HOME_TABLES },
  });
  const fullName = profile?.fullName ?? '';
  const pendingTier = usePending((p) => p.tier);
  const data = useMemo<MyHomeVM | undefined>(() => {
    if (!q.data) return undefined;
    const { home } = q.data;
    const plan = q.data.plan && pendingTier !== null ? { ...q.data.plan, tierIndex: pendingTier } : q.data.plan;
    return { home, plan, ...names(fullName, home?.address ?? ''), onboarded: !!home && !!plan };
  }, [q.data, fullName, pendingTier]);
  return useResult({ data, isLoading: q.isLoading, error: q.error, refetch: q.refetch });
}

function useDemoMyHome(): HoQuery<MyHomeVM> {
  const s = useApp(
    useShallow((x) => ({
      step: x.step,
      addr: x.addr,
      sqft: x.sqft,
      year: x.year,
      beds: x.beds,
      baths: x.baths,
      floors: x.floors,
      zones: x.zones,
      pets: x.pets,
      water: x.water,
      tier: x.tier,
    })),
  );
  const { name, firstName, street } = useHomeNames();
  const { cur } = useTiers();
  return useMemo(() => {
    const home: HomeVM = {
      id: 'demo-home',
      address: s.addr,
      street,
      sqft: s.sqft,
      year: s.year,
      beds: s.beds,
      baths: s.baths,
      floors: s.floors,
      zones: s.zones,
      pets: s.pets,
      water: s.water,
      notes: '',
    };
    const onboarded = s.step >= 6;
    const plan: PlanVM | null = onboarded
      ? { id: 'demo-plan', tierIndex: s.tier, monthly: cur.monthly, annual: cur.annual, materials: cur.materials, labor: cur.labor, startsOn: null }
      : null;
    return { data: { home, plan, name, firstName, street, onboarded }, isLoading: false, error: null, refetch: noop };
  }, [s, name, firstName, street, cur]);
}

/** My home, my name, my active plan, and whether onboarding is done. */
export function useMyHome(): HoQuery<MyHomeVM> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveMyHome : useDemoMyHome;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface TiersVM {
  tiers: TierView[];
  cur: TierView;
  /** Pricing inputs used (live), for the tier change's next-visit tasks. */
  inputs: PricingInputs | null;
  home: HomeProfile;
}

function useLiveHomeownerTiers(): HoQuery<TiersVM> {
  const pricing = usePricingInputs();
  const my = useLiveMyHome();
  const pets = my.data?.home?.pets ?? false;
  const water = my.data?.home?.water ?? 'city_hard';
  const tierIndex = my.data?.plan?.tierIndex ?? 1;
  const data = useMemo<TiersVM | undefined>(() => {
    if (!pricing.data || !my.data) return undefined;
    const home = { pets, water };
    const tiers = tierViewsFor(pricing.data, home);
    return { tiers, cur: tiers[tierIndex] ?? tiers[1], inputs: pricing.data, home };
  }, [pricing.data, my.data, pets, water, tierIndex]);
  const error = data ? null : (my.error ?? (pricing.error ? friendlyError(pricing.error) : null));
  const refetchPricing = pricing.refetch;
  const refetchHome = my.refetch;
  return useMemo(
    () => ({
      data,
      isLoading: !data && !error,
      error,
      refetch: () => {
        refetchPricing();
        refetchHome();
      },
    }),
    [data, error, refetchPricing, refetchHome],
  );
}

function useDemoHomeownerTiers(): HoQuery<TiersVM> {
  const { tiers, cur } = useTiers();
  const { pets, water } = useApp(useShallow((s) => ({ pets: s.pets, water: s.water })));
  return useMemo(
    () => ({ data: { tiers, cur, inputs: null, home: { pets, water } }, isLoading: false, error: null, refetch: noop }),
    [tiers, cur, pets, water],
  );
}

/** Every tier priced for my home, and my plan's tier (`cur`). */
export function useHomeownerTiers(): HoQuery<TiersVM> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveHomeownerTiers : useDemoHomeownerTiers;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Current visit
// ---------------------------------------------------------------------------

async function fetchCurrentVisit(): Promise<VisitRow | null> {
  // "Current" = earliest by window_start that isn't done, or is done and ended today or later.
  const since = startOfDayChicagoIso();
  const res = await requireSupabase()
    .from('visits')
    .select(VISIT_SELECT)
    .neq('status', 'canceled')
    .or(`status.neq.done,window_end.gte."${since}"`)
    .order('window_start', { ascending: true })
    .limit(1);
  const rows = (unwrap(res as Res) as VisitRow[] | null) ?? [];
  return rows[0] ?? null;
}

function useLiveCurrentVisit(): HoQuery<VisitVM | null> {
  const { userId } = useSession();
  const pricing = usePricingInputs();
  const q = useQuery({
    queryKey: HO_KEYS.currentVisit(userId),
    queryFn: fetchCurrentVisit,
    enabled: !!userId,
    meta: { tables: VISIT_TABLES },
  });
  // Durations use the office's live labor minutes; the defaults stand in if pricing can't load.
  const mins = pricing.data?.mins ?? (pricing.error ? DEFAULT_MINUTES : null);
  const confirming = usePending((p) => p.confirming);
  const data = useMemo<VisitVM | null | undefined>(() => {
    if (q.data === undefined || !mins) return undefined;
    if (!q.data) return null;
    const vm = mapVisit(q.data, mins);
    return confirming.includes(vm.id) ? { ...vm, confirmed: true } : vm;
  }, [q.data, mins, confirming]);
  return useResult({ data, isLoading: q.isLoading || (!mins && !pricing.error), error: q.error, refetch: q.refetch });
}

function useDemoCurrentVisit(): HoQuery<VisitVM | null> {
  const s = useApp(
    useShallow((x) => ({ tech: x.tech, confirmed: x.confirmed, reminders: x.reminders, report: x.report, done: x.done, shots: x.shots, tier: x.tier, pets: x.pets })),
  );
  const visit = useVisit();
  const { name, firstName, street, addr } = useHomeNames();
  return useMemo(() => {
    const tech = {
      id: 'demo-tech',
      name: TECH.name,
      firstName: TECH.name.split(' ')[0],
      initials: TECH.initials,
      title: TECH.title,
      van: TECH.van,
    };
    const vm: VisitVM = {
      id: 'demo-visit',
      homeId: 'demo-home',
      status: s.tech,
      confirmed: s.confirmed,
      windowStart: '',
      windowEnd: '',
      day: visit.day,
      time: visit.time,
      duration: visit.duration,
      client: { name, firstName, street, address: addr, pets: s.pets, notes: '' },
      tierIndex: s.tier,
      tierName: TIERS[s.tier].name,
      tech,
      tasks: visit.tasks.map((t) => ({
        id: t.id,
        key: t.id,
        name: t.name,
        short: t.short,
        part: t.part,
        min: t.min,
        done: !!s.done[t.id],
        photoKind: t.photo === 'clean' || t.photo === 'ice' ? 'after' : t.photo === 'drain' ? 'drain' : 'before',
        photos: [],
      })),
      doneCount: visit.doneCount,
      notices: { d7: true, h48: s.reminders, dayOf: s.tech !== 'scheduled', report: s.report },
      reportId: s.report ? 'demo-report' : null,
      offeredSlots: [],
    };
    return { data: vm, isLoading: false, error: null, refetch: noop };
  }, [s, visit, name, firstName, street, addr]);
}

/** The next visit (or today's, until the day ends), or null when none is booked. */
export function useCurrentVisit(): HoQuery<VisitVM | null> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveCurrentVisit : useDemoCurrentVisit;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Year of care
// ---------------------------------------------------------------------------

export interface YearVisitVM {
  month: string;
  label: string;
  first: boolean;
  items: string;
}

/** `'2026-09-25'` + 2 months → `'Nov'`. */
function monthLabel(startYmd: string, offset: number): string {
  const [y, m] = startYmd.split('-').map(Number);
  const total = m - 1 + Math.round(offset);
  const yy = y + Math.floor(total / 12);
  const mm = ((total % 12) + 12) % 12;
  return fmtMonth(`${yy}-${String(mm + 1).padStart(2, '0')}-01`);
}

function useLiveYearOfCare(): HoQuery<YearVisitVM[]> {
  const tiers = useLiveHomeownerTiers();
  const my = useLiveMyHome();
  const visit = useLiveCurrentVisit();
  const inputs = tiers.data?.inputs ?? null;
  const home = tiers.data?.home ?? null;
  const tierIndex = my.data?.plan?.tierIndex ?? 1;
  const startsOn = my.data?.plan?.startsOn ?? null;
  const cv = visit.data;
  const data = useMemo<YearVisitVM[] | undefined>(() => {
    if (!inputs || !home || !my.data) return undefined;
    // Month labels run from the plan's first visit month.
    const start = startsOn ?? (cv?.windowStart ? chicagoDate(cv.windowStart) : todayChicago());
    const firstDone = cv?.status === 'done';
    return buildSchedule(tierIndex, inputs.freq, home).map((v) => ({
      month: monthLabel(start, v.monthOffset),
      label: v.index === 0 ? (firstDone ? 'Done' : 'Next') : `Visit ${v.index + 1}`,
      first: v.index === 0,
      items: v.taskIds.map((id) => TASKS.find((t) => t.id === id)?.short ?? id).join(' · '),
    }));
  }, [inputs, home, my.data, tierIndex, startsOn, cv]);
  const error = data ? null : tiers.error;
  const refetch = tiers.refetch;
  return useMemo(() => ({ data, isLoading: !data && !error, error, refetch }), [data, error, refetch]);
}

function useDemoYearOfCare(): HoQuery<YearVisitVM[]> {
  const year = useDemoYearOfCareStore();
  return useMemo(() => ({ data: year, isLoading: false, error: null, refetch: noop }), [year]);
}

/** The plan year: one row per visit with its month and tasks. */
export function useYearOfCare(): HoQuery<YearVisitVM[]> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveYearOfCare : useDemoYearOfCare;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportPhotoVM {
  key: string;
  /** Storage path in `visit-photos` (live), null in demo. */
  path: string | null;
  kind: string;
  /** Chip text, e.g. 'AFTER'. */
  tag: string;
  taskKey: string;
  taskShort: string;
}

export interface FindingVM {
  text: string;
  tone: Tone;
  badge: string;
}

export interface ReportVM {
  id: string;
  visitId: string;
  day: string;
  techShort: string;
  photos: ReportPhotoVM[];
  doneCount: number;
  health: number;
  findings: FindingVM[];
}

const REPORT_TABLES = ['reports', 'visits', 'visit_tasks', 'visit_photos', 'profiles'];
const REPORT_SELECT =
  'id,visit_id,health_score,findings,published_at,' +
  'visits(id,window_start,tech:profiles!visits_tech_id_fkey(id,full_name),visit_tasks(id,task_key,name,done,visit_photos(id,kind,path,taken_at)))';

interface ReportRow {
  id: string;
  visit_id: string | null;
  health_score: number | null;
  findings: unknown;
  published_at: string | null;
  visits?: One<{
    id: string;
    window_start: string | null;
    tech?: One<{ id: string; full_name: string | null }>;
    visit_tasks?: {
      id: string;
      task_key: string | null;
      name: string | null;
      done: boolean | null;
      visit_photos?: { id: string; kind: string | null; path: string; taken_at?: string | null }[] | null;
    }[] | null;
  }>;
}

const TONES: readonly Tone[] = ['neutral', ...(Object.keys(STATUS) as (keyof typeof STATUS)[])];

function mapFindings(x: unknown): FindingVM[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { text?: unknown }).text === 'string')
    .map((f) => ({
      text: String(f.text),
      tone: TONES.includes(f.tone as Tone) ? (f.tone as Tone) : 'neutral',
      badge: typeof f.badge === 'string' ? f.badge : '',
    }));
}

export function shortName(full: string | null | undefined): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Your technician';
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

const taskOrder = (key: string) => {
  const i = TASKS.findIndex((t) => t.id === key);
  return i < 0 ? TASKS.length : i;
};

function mapReport(r: ReportRow): ReportVM {
  const v = one(r.visits);
  const tasks = [...(v?.visit_tasks ?? [])].sort((a, b) => taskOrder(a.task_key ?? '') - taskOrder(b.task_key ?? ''));
  const photos: ReportPhotoVM[] = [];
  for (const t of tasks) {
    const def = TASKS.find((d) => d.id === t.task_key);
    const shots = [...(t.visit_photos ?? [])].sort((a, b) => (a.taken_at ?? '').localeCompare(b.taken_at ?? ''));
    for (const p of shots) {
      photos.push({
        key: p.id,
        path: p.path,
        kind: p.kind ?? '',
        tag: (p.kind ?? 'photo').toUpperCase(),
        taskKey: t.task_key ?? '',
        taskShort: def?.short ?? (t.name?.trim() || t.task_key || 'Photo'),
      });
    }
  }
  const tech = one(v?.tech);
  return {
    id: r.id,
    visitId: r.visit_id ?? v?.id ?? '',
    day: v?.window_start ? fmtDay(v.window_start) : r.published_at ? fmtDay(r.published_at) : '',
    techShort: shortName(tech?.full_name),
    photos,
    doneCount: tasks.filter((t) => t.done).length,
    health: num(r.health_score, 86),
    findings: mapFindings(r.findings),
  };
}

function useLiveReports(): HoQuery<ReportVM[]> {
  const { userId } = useSession();
  const q = useQuery({
    queryKey: HO_KEYS.reports(userId),
    enabled: !!userId,
    meta: { tables: REPORT_TABLES },
    queryFn: async () => {
      const res = await requireSupabase().from('reports').select(REPORT_SELECT).order('published_at', { ascending: false });
      return ((unwrap(res as Res) as ReportRow[] | null) ?? []).map(mapReport);
    },
  });
  return useResult({ data: q.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch });
}

const DEMO_TECH_SHORT = TECH.name.split(' ')[0] + ' ' + TECH.name.split(' ')[1][0] + '.';
const DEMO_FINDINGS: FindingVM[] = [
  { text: 'Anode rod 70% depleted', tone: 'ochre', badge: 'Quote $185' },
  { text: 'Dryer vent airflow normal', tone: 'forest', badge: 'Good' },
];

function useDemoReports(): HoQuery<ReportVM[]> {
  const { report, shots } = useApp(useShallow((s) => ({ report: s.report, shots: s.shots })));
  const visit = useVisit();
  return useMemo(() => {
    if (!report) return { data: [], isLoading: false, error: null, refetch: noop };
    const photos: ReportPhotoVM[] = TASKS.filter((t) => shots[t.id]).map((t) => ({
      key: t.id,
      path: null,
      kind: t.photo,
      tag: t.photo === 'clean' ? 'AFTER' : t.photo === 'drain' ? 'DRAIN' : 'BEFORE',
      taskKey: t.id,
      taskShort: t.short,
    }));
    const r: ReportVM = {
      id: 'demo-report',
      visitId: 'demo-visit',
      day: visit.day,
      techShort: DEMO_TECH_SHORT,
      photos,
      doneCount: visit.doneCount,
      health: 86,
      findings: DEMO_FINDINGS,
    };
    return { data: [r], isLoading: false, error: null, refetch: noop };
  }, [report, shots, visit]);
}

/** Published visit reports, newest first. */
export function useReports(): HoQuery<ReportVM[]> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveReports : useDemoReports;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Add-on quote requests
// ---------------------------------------------------------------------------

export interface BidVM {
  id: string;
  vendor: string;
  rating: number;
  /** `'Sun, Oct 18'` */
  when: string;
  price: number;
}

export interface QuoteRequestVM {
  id: string;
  category: string;
  name: string;
  sub: string;
  bids: BidVM[];
  bookedBidId: string | null;
  booked: boolean;
}

const REQUEST_TABLES = ['quote_requests', 'bids'];
const REQUEST_SELECT = 'id,category,scope,status,booked_bid_id,created_at,bids(id,vendor_name,vendor_rating,price,available_on,created_at)';

interface RequestRow {
  id: string;
  category: string | null;
  scope: string | null;
  status: string | null;
  booked_bid_id: string | null;
  created_at: string | null;
  bids?: { id: string; vendor_name: string | null; vendor_rating: unknown; price: unknown; available_on: string | null; created_at: string | null }[] | null;
}

function mapRequest(r: RequestRow): QuoteRequestVM {
  const a = ADD_ONS.find((x) => x.id === r.category);
  const bids = [...(r.bids ?? [])]
    .sort((x, y) => (x.created_at ?? '').localeCompare(y.created_at ?? '') || x.id.localeCompare(y.id))
    .map((b) => ({
      id: b.id,
      vendor: b.vendor_name?.trim() || 'Vetted pro',
      rating: num(b.vendor_rating, 0),
      when: b.available_on ? fmtShortDate(b.available_on) : '',
      price: num(b.price, 0),
    }));
  return {
    id: r.id,
    category: r.category ?? '',
    name: a?.name ?? r.category ?? 'Service',
    sub: a?.sub ?? r.scope ?? '',
    bids,
    bookedBidId: r.status === 'booked' ? r.booked_bid_id : null,
    booked: r.status === 'booked',
  };
}

function useLiveQuoteRequests(): HoQuery<QuoteRequestVM[]> {
  const { userId } = useSession();
  const q = useQuery({
    queryKey: HO_KEYS.requests(userId),
    enabled: !!userId,
    meta: { tables: REQUEST_TABLES },
    queryFn: async () => {
      const res = await requireSupabase()
        .from('quote_requests')
        .select(REQUEST_SELECT)
        .neq('status', 'canceled')
        .order('created_at', { ascending: false });
      return (unwrap<RequestRow[] | null>(res) ?? []).map(mapRequest);
    },
  });
  return useResult({ data: q.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch });
}

const demoBidId = (reqId: string, j: number) => `${reqId}#${j}`;

function useDemoQuoteRequests(): HoQuery<QuoteRequestVM[]> {
  const reqs = useApp((s) => s.reqs);
  return useMemo(() => {
    const data = [...reqs].reverse().map((r) => ({
      id: r.id,
      category: r.id,
      name: r.name,
      sub: r.sub,
      bids: r.bids.map((b, j) => ({ id: demoBidId(r.id, j), vendor: b.vendor, rating: b.rating, when: b.when, price: b.price })),
      bookedBidId: r.booked != null ? demoBidId(r.id, r.booked) : null,
      booked: r.booked != null,
    }));
    return { data, isLoading: false, error: null, refetch: noop };
  }, [reqs]);
}

/** My add-on requests with their bids, newest first. */
export function useQuoteRequests(): HoQuery<QuoteRequestVM[]> {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveQuoteRequests : useDemoQuoteRequests;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Mutations (home, plan, services)
// ---------------------------------------------------------------------------

export interface HoMutation<A> {
  mutate: (arg: A) => void;
  isPending: boolean;
  /** The argument of the call in flight. */
  variables: A | undefined;
}

const toastError = (e: unknown) => toast(friendlyError(e), 'brick');

/** Owner confirms the visit. Live: optimistic, then `confirm_visit`. */
export function useConfirmVisit(): HoMutation<string> {
  const { mode } = useMode();
  const set = useApp((s) => s.set);
  const m = useMutation({
    mutationFn: (visitId: string) => rpc<void>('confirm_visit', { p_visit: visitId }),
    onMutate: (visitId: string) => {
      usePending.setState((p) => ({ confirming: [...p.confirming, visitId] }));
    },
    onError: toastError,
    onSettled: async (_d, _e, visitId) => {
      // Refetch first so the confirmed row is in the cache before the overlay goes.
      await invalidateTables(['visits']);
      usePending.setState((p) => ({ confirming: p.confirming.filter((x) => x !== visitId) }));
    },
  });
  if (mode === 'demo') return { mutate: () => set({ confirmed: true }), isPending: false, variables: undefined };
  return { mutate: m.mutate, isPending: m.isPending, variables: m.variables };
}

/** Owner moves the visit to the next offered time. Live: toast with the new day and window. */
export function useRescheduleVisit(): HoMutation<string> {
  const { mode } = useMode();
  const set = useApp((s) => s.set);
  const slot = useApp((s) => s.slot);
  const m = useMutation({
    mutationFn: (visitId: string) => rpc<{ window_start: string | null; window_end: string | null } | null>('reschedule_visit', { p_visit: visitId }),
    onError: toastError,
    onSuccess: (v) => {
      void invalidateTables(['visits']);
      if (v?.window_start) toast(`Moved to ${fmtDay(v.window_start)} · ${fmtWindow(v.window_start, v.window_end)}`, 'forest');
    },
  });
  if (mode === 'demo') return { mutate: () => set({ slot: (slot + 1) % SLOTS.length, confirmed: false }), isPending: false, variables: undefined };
  return { mutate: m.mutate, isPending: m.isPending, variables: m.variables };
}

/** Next-visit checklist for a tier: every task the tier does at least once a year. */
export function nextVisitTasks(tierIndex: number, freq: PricingInputs['freq'], home: HomeProfile): string[] {
  return TASKS.filter((t) => adjustedFreq(t.id, tierIndex, freq, home) > 0).map((t) => t.id);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Switch my plan's tier. Live: optimistic, `set_plan_tier`, revert + toast on error. */
export function useSetTier(): HoMutation<number> {
  const { mode } = useMode();
  const set = useApp((s) => s.set);
  const tiers = useHomeownerTiers();
  const m = useMutation({
    mutationFn: async (tierIndex: number) => {
      const t = tiers.data;
      const q = t?.tiers[tierIndex];
      if (!t || !q || !t.inputs) throw new Error('Prices are still loading. Try again in a moment.');
      return rpc('set_plan_tier', {
        p_tier: TIERS[tierIndex].key,
        p_monthly: round2(q.monthly),
        p_annual: round2(q.annual),
        p_materials: round2(q.materials),
        p_labor: round2(q.labor),
        p_next_tasks: nextVisitTasks(tierIndex, t.inputs.freq, t.home),
      });
    },
    // Optimistic: the overlay shows the new tier right away; an error drops it (revert).
    onMutate: (tierIndex: number) => {
      usePending.setState({ tier: tierIndex });
    },
    onError: (e) => {
      usePending.setState({ tier: null });
      toastError(e);
    },
    onSuccess: async (_d, tierIndex) => {
      await invalidateTables(['plans', 'visits', 'visit_tasks']);
      if (usePending.getState().tier === tierIndex) usePending.setState({ tier: null });
    },
  });
  if (mode === 'demo') return { mutate: (i: number) => set({ tier: i }), isPending: false, variables: undefined };
  return { mutate: m.mutate, isPending: m.isPending, variables: m.variables };
}

/** Ask vetted pros for quotes. Live: `request_quote`, then fan the request out (fire-and-forget). */
export function useRequestQuote(): HoMutation<string> {
  const { mode } = useMode();
  const requestQuote = useApp((s) => s.requestQuote);
  const m = useMutation({
    mutationFn: async (category: string) => {
      const req = await rpc<{ id: string } | null>('request_quote', { p_category: category });
      if (req?.id) invokeFunction('fanout-quote', { request_id: req.id }).catch(() => {});
      return req;
    },
    onError: toastError,
    onSuccess: () => invalidateTables(REQUEST_TABLES),
  });
  if (mode === 'demo') return { mutate: requestQuote, isPending: false, variables: undefined };
  return { mutate: m.mutate, isPending: m.isPending, variables: m.variables };
}

/** Book one bid. First booking wins. */
export function useBookBid(): HoMutation<string> {
  const { mode } = useMode();
  const book = useApp((s) => s.book);
  const m = useMutation({
    mutationFn: (bidId: string) => rpc('book_bid', { p_bid: bidId }),
    onError: (e) => {
      toastError(e);
      void invalidateTables(REQUEST_TABLES);
    },
    onSuccess: () => invalidateTables(REQUEST_TABLES),
  });
  const demoBook = useCallback(
    (bidId: string) => {
      const i = bidId.lastIndexOf('#');
      if (i > 0) book(bidId.slice(0, i), Number(bidId.slice(i + 1)));
    },
    [book],
  );
  if (mode === 'demo') return { mutate: demoBook, isPending: false, variables: undefined };
  return { mutate: m.mutate, isPending: m.isPending, variables: m.variables };
}

// ---------------------------------------------------------------------------
// Onboarding (live): draft, appliance lookups, save + build + start
// ---------------------------------------------------------------------------

export type ApplianceBadge = 'matched' | 'ai' | 'unverified';

export interface DraftAppliance {
  key: string;
  brand: string;
  name: string;
  model: string;
  serial: string;
  note: string;
  badge: ApplianceBadge;
}

export interface OnboardingDraft {
  /** 0 welcome · 1–5 steps. */
  step: number;
  name: string;
  addr: string;
  appliances: DraftAppliance[];
  sqft: number;
  year: number;
  beds: number;
  baths: number;
  floors: number;
  zones: number;
  pets: boolean;
  water: Water;
  /** Local tier selection on step 5. */
  tier: number;
  homeId: string | null;
  buildId: string | null;
  /** Step 5 reached through "Use standard pricing". */
  standardPricing: boolean;
}

export type DraftNumKey = 'sqft' | 'year' | 'beds' | 'baths' | 'floors' | 'zones';

interface DraftActions {
  set: (p: Partial<OnboardingDraft>) => void;
  bump: (k: DraftNumKey, d: number, min: number, max: number) => void;
  addAppliance: (a: Omit<DraftAppliance, 'key'>) => void;
  clear: () => void;
}

function makeDraftStore(userId: string, fullName: string) {
  let seq = 0;
  return create<OnboardingDraft & DraftActions>()(
    persist(
      (set) => ({
        ...initialDraft(fullName),
        set: (p) => set(p),
        bump: (k, d, min, max) => set((x) => ({ [k]: Math.max(min, Math.min(max, +(x[k] + d).toFixed(1))) }) as Partial<OnboardingDraft>),
        addAppliance: (a) => set((x) => ({ appliances: [...x.appliances, { ...a, key: `${Date.now()}-${++seq}` }] })),
        clear: () => set(initialDraft(fullName)),
      }),
      {
        name: `php-onboarding-${userId}`,
        storage: createJSONStorage(() => AsyncStorage),
        partialize: ({ set: _s, bump: _b, addAppliance: _a, clear: _c, ...rest }) => rest,
      },
    ),
  );
}

type DraftStore = ReturnType<typeof makeDraftStore>;

const initialDraft = (fullName: string): OnboardingDraft => ({
  step: 0,
  name: fullName,
  addr: '',
  appliances: [],
  sqft: 3420,
  year: 2006,
  beds: 4,
  baths: 3.5,
  floors: 2,
  zones: 2,
  pets: true,
  water: 'city_hard',
  tier: 1,
  homeId: null,
  buildId: null,
  standardPricing: false,
});

const draftStores = new Map<string, DraftStore>();

function draftStore(userId: string, fullName: string): DraftStore {
  let s = draftStores.get(userId);
  if (!s) {
    s = makeDraftStore(userId, fullName);
    draftStores.set(userId, s);
  }
  return s;
}

/** Throwaway store for the render before a user id exists (never persisted). */
const EMPTY_STORE = create<OnboardingDraft & DraftActions>()(() => ({
  ...initialDraft(''),
  set: noop,
  bump: noop,
  addAppliance: noop,
  clear: noop,
}));

/**
 * The signed-in homeowner's onboarding draft, persisted per user
 * (`php-onboarding-<userId>`). `hydrated` turns true once storage has been read
 * (or after 1.5 s if storage never answers).
 */
export function useOnboardingDraft(): { draft: OnboardingDraft & DraftActions; hydrated: boolean } {
  const { userId, profile } = useSession();
  const store = useMemo(() => (userId ? draftStore(userId, profile?.fullName ?? '') : null), [userId, profile?.fullName]);
  const draft = (store ?? EMPTY_STORE)();
  const persisted = useSyncExternalStore(
    useCallback((cb: () => void) => (store ? store.persist.onFinishHydration(cb) : noop), [store]),
    () => (store ? store.persist.hasHydrated() : false),
    () => (store ? store.persist.hasHydrated() : false),
  );
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, []);
  return { draft, hydrated: !!store && (persisted || timedOut) };
}

const draftStorageKey = (userId: string) => `php-onboarding-${userId}`;

/** Remove the persisted draft (after the plan starts, or for a new sign-up). */
export function clearOnboardingDraft(userId: string | null) {
  if (!userId) return;
  const s = draftStores.get(userId);
  // No setState: the screen that's leaving keeps its last frame, and the next
  // visit to onboarding builds a fresh store from the (now empty) storage.
  draftStores.delete(userId);
  if (s) s.persist.clearStorage();
  // A draft saved in an earlier session has no store in memory yet: remove it from storage directly.
  else void AsyncStorage.removeItem(draftStorageKey(userId)).catch(() => {});
}

/**
 * Start `userId`'s onboarding over for a new customer: the old draft is
 * discarded and the new one opens on step 1 ("Where's home?") with `fullName`
 * filled in. Resolves once the draft is stored, so onboarding opens on it.
 */
export async function resetOnboardingDraft(userId: string, fullName: string): Promise<void> {
  const old = draftStores.get(userId);
  draftStores.delete(userId);
  try {
    old?.persist.clearStorage();
    await AsyncStorage.removeItem(draftStorageKey(userId));
  } catch {
    // Storage unavailable: the new store below still starts empty in memory.
  }
  const s = draftStore(userId, fullName);
  // Storage is empty now, so hydration only confirms the defaults; wait for it
  // so it can't overwrite the state set below. Never block on a stuck storage.
  if (!s.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1500);
      const unsub = s.persist.onFinishHydration(() => {
        clearTimeout(t);
        unsub();
        resolve();
      });
      if (s.persist.hasHydrated()) {
        clearTimeout(t);
        unsub();
        resolve();
      }
    });
  }
  s.setState({ ...initialDraft(fullName), step: 1 });
}

export interface LookupAppliance {
  brand: string | null;
  name: string | null;
  model: string;
  serial: string | null;
  category: string | null;
  note: string | null;
  model_id: string | null;
}

export interface LookupResult {
  source: 'cache' | 'ai';
  appliance: LookupAppliance;
  tasks: { task_key: string; name: string; interval_months: number; part_number: string | null }[];
}

interface ModelRow {
  id: string;
  brand: string | null;
  model: string | null;
  name: string | null;
  note: string | null;
  category: string | null;
}

/** Case-insensitive exact model match in the cache (`appliance_models`, readable by any signed-in user). */
export async function findCachedModel(model: string): Promise<ModelRow | null> {
  const m = model.trim();
  if (!m) return null;
  const escaped = m.replace(/[\\%_]/g, (c) => '\\' + c);
  const res = await requireSupabase().from('appliance_models').select('id,brand,model,name,note,category').ilike('model', escaped).limit(1);
  const rows = unwrap<ModelRow[] | null>(res) ?? [];
  return rows[0] ?? null;
}

/** A sample plate: the model from the cache, or the built-in sample if the cache can't be read. Never calls an edge function. */
export async function readSamplePlate(index: number): Promise<Omit<DraftAppliance, 'key'>> {
  const s = APPLIANCES[index];
  let row: ModelRow | null = null;
  try {
    // A slow network never holds the shutter up: after 2.5 s the built-in sample stands in.
    row = await Promise.race([findCachedModel(s.model), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
  } catch {
    row = null;
  }
  return {
    brand: row?.brand?.trim() || s.brand,
    name: row?.name?.trim() || s.name,
    model: row?.model?.trim() || s.model,
    serial: s.serial,
    note: row?.note?.trim() || s.note,
    badge: 'matched',
  };
}

/** A plate photo read by `lookup-appliance` (cache, else Claude). Throws a FriendlyError. */
export async function readPlatePhoto(base64: string): Promise<Omit<DraftAppliance, 'key'>> {
  let r: LookupResult;
  try {
    r = await invokeFunction<LookupResult>('lookup-appliance', { image: base64, media_type: 'image/jpeg' });
  } catch (e) {
    // Plate reading isn't set up on this server: the manual entry that opens next is the way in.
    if (e instanceof FriendlyError && e.code === 'no_key') throw new FriendlyError(PLATE_OFF, { code: e.code, status: e.status });
    throw e;
  }
  return fromLookup(r, {});
}

/** Shown when the server can't read plate photos (lookup-appliance 503 `no_key`). */
export const PLATE_OFF = "We can't read plate photos right now. Enter the details instead.";

function fromLookup(r: LookupResult, typed: { brand?: string; serial?: string }): Omit<DraftAppliance, 'key'> {
  const a = r?.appliance;
  if (!a || !a.model) throw new Error("We couldn't read that plate. Try again or enter it manually.");
  const brand = a.brand?.trim() || typed.brand?.trim() || '';
  return {
    brand,
    name: a.name?.trim() || (brand ? `${brand} ${a.category ?? 'appliance'}`.trim() : 'Appliance'),
    model: a.model,
    serial: a.serial?.trim() || typed.serial?.trim() || '',
    note: a.note?.trim() || '',
    badge: r.source === 'ai' ? 'ai' : 'matched',
  };
}

/** Typed entry: cache → lookup-appliance → "Unverified". Never throws. */
export async function lookupTypedAppliance(input: { brand: string; model: string; serial: string }): Promise<Omit<DraftAppliance, 'key'>> {
  const brand = input.brand.trim();
  const model = input.model.trim();
  const serial = input.serial.trim();
  try {
    const row = await findCachedModel(model);
    if (row) {
      return {
        brand: row.brand?.trim() || brand,
        name: row.name?.trim() || (brand ? `${brand} appliance` : 'Appliance'),
        model: row.model?.trim() || model,
        serial,
        note: row.note?.trim() || '',
        badge: 'matched',
      };
    }
  } catch {
    // Fall through to the edge function.
  }
  try {
    const r = await invokeFunction<LookupResult>('lookup-appliance', { brand, model, serial });
    return fromLookup(r, { brand, serial });
  } catch {
    return { brand, name: brand ? `${brand} appliance` : 'Appliance', model, serial, note: serial ? `SN ${serial}` : '', badge: 'unverified' };
  }
}

/**
 * Step 3 → 4: save the home, replace its appliances, and start the plan
 * build. Returns the home and build ids. Throws a FriendlyError.
 */
export async function saveHomeAndBuild(d: OnboardingDraft): Promise<{ homeId: string; buildId: string }> {
  const homeId = await ensureHome(d);
  const buildId = await buildPlan(homeId);
  return { homeId, buildId };
}

/**
 * Save (upsert) the caller's home and its appliances from the draft and return
 * the home id. Safe to repeat: onboarding calls it again before a retry or
 * Start plan, so a demo reset that deleted the home just recreates it.
 */
export async function ensureHome(d: OnboardingDraft): Promise<string> {
  const home = await rpc<{ id: string } | null>('save_home', {
    p_full_name: d.name.trim(),
    p_address: d.addr.trim(),
    p_sqft: Math.round(d.sqft),
    p_year: Math.round(d.year),
    p_beds: d.beds,
    p_baths: d.baths,
    p_floors: Math.round(d.floors),
    p_zones: Math.round(d.zones),
    p_pets: d.pets,
    p_water: d.water,
  });
  if (!home?.id) throw new Error("We couldn't save your home. Try again.");
  void invalidateTables(['profiles', 'homes']);
  await setAppliances(home.id, d.appliances);
  return home.id;
}

/** `set_home_appliances`: replaces the home's appliances. */
export async function setAppliances(homeId: string, items: DraftAppliance[]): Promise<number> {
  const n = await rpc<number>('set_home_appliances', {
    p_home: homeId,
    p_items: items.map((a) => ({ model: a.model, serial: a.serial, brand: a.brand, name: a.name })),
  });
  void invalidateTables(['appliances']);
  return n;
}

/** Start the research run (`build-plan`). Returns the plan_builds id. */
export async function buildPlan(homeId: string): Promise<string> {
  const r = await invokeFunction<{ build_id?: string }>('build-plan', { home_id: homeId });
  if (!r?.build_id) throw new Error("We couldn't start building your plan. Try again.");
  return r.build_id;
}

export interface PlanBuildVM {
  id: string;
  step: string;
  progress: number;
  error: string | null;
  summary: { appliances: number; manuals: number; tasks: number; parts: { name: string; price: number }[]; suppliers: number } | null;
  updatedAt: string | null;
}

interface PlanBuildRow {
  id: string;
  step: string | null;
  status: string | null;
  progress: number | null;
  summary: unknown;
  error: string | null;
  updated_at: string | null;
}

function mapSummary(x: unknown): PlanBuildVM['summary'] {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  const parts = Array.isArray(s.parts)
    ? s.parts
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ name: String(p.name ?? p.part_number ?? 'Part'), price: num(p.price, 0) }))
    : [];
  return { appliances: num(s.appliances), manuals: num(s.manuals), tasks: num(s.tasks), parts, suppliers: num(s.suppliers) };
}

/** Follows one plan build: realtime invalidates it, and it polls every second until it's done. */
export function usePlanBuild(buildId: string | null): HoQuery<PlanBuildVM> & { dataUpdatedAt: number } {
  const q = useQuery({
    queryKey: HO_KEYS.planBuild(buildId),
    enabled: !!buildId,
    meta: { tables: ['plan_builds'] },
    retry: 1,
    refetchInterval: (query) => {
      const d = query.state.data as PlanBuildVM | undefined;
      return d && (d.progress >= 100 || d.step === 'error') ? false : 1000;
    },
    queryFn: async (): Promise<PlanBuildVM> => {
      const res = await requireSupabase()
        .from('plan_builds')
        .select('id,step,status,progress,summary,error,updated_at')
        .eq('id', buildId!)
        .maybeSingle();
      const row = unwrap<PlanBuildRow | null>(res);
      if (!row) throw new Error("We couldn't find your plan build. Try again.");
      const step = row.step ?? (row.status === 'error' ? 'error' : 'reading');
      return {
        id: row.id,
        step: row.status === 'error' ? 'error' : step,
        progress: Math.max(0, Math.min(100, num(row.progress, 0))),
        error: row.error,
        summary: mapSummary(row.summary),
        updatedAt: row.updated_at,
      };
    },
  });
  const r = useResult({ data: q.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch });
  return { ...r, dataUpdatedAt: q.dataUpdatedAt };
}

/** Tier quotes for the onboarding draft: live pricing inputs, or the standard defaults if they can't load. */
export function useDraftTiers(home: HomeProfile): { tiers: TierView[] | null; inputs: PricingInputs | null; isLoading: boolean } {
  const pricing = usePricingInputs();
  const standard = useMemo<PricingInputs>(
    () => ({
      settings: { ...DEFAULT_SETTINGS },
      mins: { ...DEFAULT_MINUTES },
      freq: Object.fromEntries(Object.entries(DEFAULT_FREQ).map(([k, v]) => [k, [...v]])),
      coordinationFee: COORDINATION_FEE,
    }),
    [],
  );
  const inputs = pricing.data ?? (pricing.error ? standard : null);
  const tiers = useMemo(() => (inputs ? tierViewsFor(inputs, home) : null), [inputs, home]);
  return { tiers, inputs, isLoading: !inputs };
}

/**
 * Step 5: start the plan with the chosen tier's quote and its year of visits.
 * The home query is updated before it resolves, so the tab guard sees the plan.
 */
export async function startPlan(args: { userId: string | null; homeId: string; tierIndex: number; tier: TierView; inputs: PricingInputs; home: HomeProfile }) {
  const { homeId, tierIndex, tier, inputs, home } = args;
  const schedule = buildSchedule(tierIndex, inputs.freq, home).map((v) => ({ month_offset: v.monthOffset, task_keys: v.taskIds }));
  const plan = await rpc<{ id: string; tier: string; monthly: unknown; annual: unknown; materials: unknown; labor: unknown; starts_on: string | null } | null>(
    'start_plan',
    {
      p_home: homeId,
      p_tier: TIERS[tierIndex].key,
      p_monthly: round2(tier.monthly),
      p_annual: round2(tier.annual),
      p_materials: round2(tier.materials),
      p_labor: round2(tier.labor),
      p_schedule: schedule,
    },
  );
  const key = HO_KEYS.myHome(args.userId);
  // Refetch my home so the tabs' guard sees the new plan; if that fails, patch the cache.
  try {
    await queryClient.fetchQuery({ queryKey: key, queryFn: () => fetchMyHome(args.userId!), staleTime: 0 });
  } catch {
    const prev = queryClient.getQueryData<{ home: HomeVM | null; plan: PlanVM | null }>(key);
    if (prev?.home && plan) {
      queryClient.setQueryData(key, {
        ...prev,
        plan: {
          id: plan.id,
          tierIndex,
          monthly: num(plan.monthly),
          annual: num(plan.annual),
          materials: num(plan.materials),
          labor: num(plan.labor),
          startsOn: plan.starts_on,
        },
      });
    }
  }
  void queryClient.invalidateQueries({ queryKey: HO_KEYS.all });
  void invalidateTables(['plans', 'visits', 'visit_tasks', 'notices']);
}

// ---------------------------------------------------------------------------
// Small helpers for the screens
// ---------------------------------------------------------------------------

/** The sample plate the shutter reads next (the first not yet captured), or null when all five are in. */
export function nextSampleIndex(appliances: DraftAppliance[]): number | null {
  const have = new Set(appliances.map((a) => a.model.toUpperCase().replace(/\s+/g, '')));
  const i = APPLIANCES.findIndex((a) => !have.has(a.model.toUpperCase().replace(/\s+/g, '')));
  return i < 0 ? null : i;
}
