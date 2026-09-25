// Pricing inputs (office settings + task defaults) for every surface that
// quotes a price, plus the office's pricing edits. Live reads come from
// `pricing_settings` + `task_defaults`; demo reads the zustand store.

import {
  COORDINATION_FEE,
  DEFAULT_FREQ,
  DEFAULT_MINUTES,
  DEFAULT_SETTINGS,
  TIERS,
  money,
  priceAllTiers,
  type Frequencies,
  type HomeProfile,
  type LaborMinutes,
  type PricingSettings,
  type TierQuote,
} from '@php/pricing';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { FriendlyError, MSG, friendlyError } from '../lib/errors';
import { useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { invalidateTables } from '../lib/realtime';
import { unwrap } from '../lib/rpc';
import { requireSupabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useApp } from '../store/app';

// ---------------------------------------------------------------------------
// Tier views (formatting shared by the homeowner tiers and the office calculator)
// ---------------------------------------------------------------------------

export interface TierView extends TierQuote {
  name: string;
  visitsTxt: string;
  monthlyTxt: string;
  annualTxt: string;
  matTxt: string;
  labTxt: string;
  hoursTxt: string;
  marginTxt: string;
  covTxt: string;
}

export function toTierViews(quotes: TierQuote[]): TierView[] {
  return quotes.map((q) => ({
    ...q,
    name: q.tier.name,
    visitsTxt: `${q.tier.visits} visits / yr`,
    monthlyTxt: money(q.monthly),
    annualTxt: money(q.annual),
    matTxt: money(q.materials),
    labTxt: money(q.labor),
    hoursTxt: q.hours.toFixed(1) + ' hr',
    marginTxt: Math.round(q.margin * 100) + '%',
    covTxt: q.tier.coverage + '%',
  }));
}

/** Every tier priced for one home: `priceAllTiers` + `toTierViews`. */
export function tierViewsFor(inputs: PricingInputs, home: HomeProfile): TierView[] {
  return toTierViews(priceAllTiers({ settings: inputs.settings, minutes: inputs.mins, freq: inputs.freq, home }));
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PricingInputs {
  settings: PricingSettings;
  mins: LaborMinutes;
  freq: Frequencies;
  /** Fraction of a booked add-on price (0.1 = 10%). */
  coordinationFee: number;
}

export interface PricingInputsResult {
  data?: PricingInputs;
  isLoading: boolean;
  /** Only set when there's no data to show; a failed background refetch keeps the last data. */
  error: Error | null;
  refetch: () => void;
}

export const PRICING_KEY = ['pricing', 'inputs'] as const;
export const PRICING_TABLES = ['pricing_settings', 'task_defaults'];

export type SettingKey = 'rate' | 'trip' | 'markup' | 'techCost';

/** Office input ranges and step sizes (the same bounds the demo stepper uses). */
export const SETTING_LIMITS: Record<SettingKey, { min: number; max: number; step: number }> = {
  rate: { min: 40, max: 250, step: 2 },
  trip: { min: 0, max: 150, step: 5 },
  markup: { min: 0, max: 100, step: 5 },
  techCost: { min: 15, max: 120, step: 2 },
};
export const MINUTES_MIN = 5;
export const FREQ_MAX = 12;

const SETTING_COLUMN: Record<SettingKey, string> = {
  rate: 'labor_rate',
  trip: 'trip_fee',
  markup: 'parts_markup',
  techCost: 'tech_cost',
};

const clampSetting = (k: SettingKey, v: number) => Math.max(SETTING_LIMITS[k].min, Math.min(SETTING_LIMITS[k].max, +v.toFixed(1)));
const clampMinutes = (v: number) => Math.max(MINUTES_MIN, Math.round(v));
const clampFreq = (v: number) => Math.max(0, Math.min(FREQ_MAX, Math.round(v)));

const num = (x: unknown, fallback: number) => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

interface SettingsRow {
  labor_rate: unknown;
  trip_fee: unknown;
  parts_markup: unknown;
  tech_cost: unknown;
  vehicle_cost: unknown;
  coordination_fee: unknown;
}
interface TaskDefaultRow {
  task_key: string;
  labor_min: unknown;
  freq_high: unknown;
  freq_recommended: unknown;
  freq_medium: unknown;
  freq_low: unknown;
}

/** DB rows → app inputs. `parts_markup` is stored as a fraction (0.25); the app uses percent (25). */
export function rowsToPricingInputs(s: SettingsRow | null, rows: TaskDefaultRow[]): PricingInputs {
  const settings: PricingSettings = {
    rate: num(s?.labor_rate, DEFAULT_SETTINGS.rate),
    trip: num(s?.trip_fee, DEFAULT_SETTINGS.trip),
    markup: s ? Math.round(num(s.parts_markup, DEFAULT_SETTINGS.markup / 100) * 10_000) / 100 : DEFAULT_SETTINGS.markup,
    techCost: num(s?.tech_cost, DEFAULT_SETTINGS.techCost),
    vehicleCostPerVisit: num(s?.vehicle_cost, DEFAULT_SETTINGS.vehicleCostPerVisit),
  };
  const mins: LaborMinutes = { ...DEFAULT_MINUTES };
  const freq: Frequencies = Object.fromEntries(Object.entries(DEFAULT_FREQ).map(([k, v]) => [k, [...v]]));
  for (const r of rows) {
    mins[r.task_key] = num(r.labor_min, DEFAULT_MINUTES[r.task_key] ?? 0);
    const d = DEFAULT_FREQ[r.task_key] ?? [0, 0, 0, 0];
    freq[r.task_key] = [num(r.freq_high, d[0]), num(r.freq_recommended, d[1]), num(r.freq_medium, d[2]), num(r.freq_low, d[3])];
  }
  return { settings, mins, freq, coordinationFee: num(s?.coordination_fee, COORDINATION_FEE) };
}

export async function fetchPricingInputs(): Promise<PricingInputs> {
  const sb = requireSupabase();
  const [s, t] = await Promise.all([
    sb.from('pricing_settings').select('labor_rate,trip_fee,parts_markup,tech_cost,vehicle_cost,coordination_fee').eq('id', 1).maybeSingle(),
    sb.from('task_defaults').select('task_key,labor_min,freq_high,freq_recommended,freq_medium,freq_low'),
  ]);
  return rowsToPricingInputs(unwrap<SettingsRow | null>(s), unwrap<TaskDefaultRow[]>(t) ?? []);
}

// Office edits not yet confirmed by the server. They're layered over fetched
// data so a poll or realtime refetch mid-edit can't snap a value back.
interface Pending {
  settings: Partial<Record<SettingKey, number>>;
  mins: Record<string, number>;
  /** Keyed `${taskKey}:${tierIndex}`. */
  freq: Record<string, number>;
}
const usePending = create<Pending>(() => ({ settings: {}, mins: {}, freq: {} }));

function applyPending(d: PricingInputs, p: Pending): PricingInputs {
  const hasFreq = Object.keys(p.freq).length > 0;
  if (!Object.keys(p.settings).length && !Object.keys(p.mins).length && !hasFreq) return d;
  const freq = hasFreq ? Object.fromEntries(Object.entries(d.freq).map(([k, v]) => [k, [...v]])) : d.freq;
  for (const [id, v] of Object.entries(p.freq)) {
    const [key, tier] = id.split(':');
    if (freq[key]) freq[key][+tier] = v;
  }
  return { ...d, settings: { ...d.settings, ...p.settings }, mins: { ...d.mins, ...p.mins }, freq };
}

function useLivePricingInputs(): PricingInputsResult {
  const q = useQuery({ queryKey: PRICING_KEY, queryFn: fetchPricingInputs, meta: { tables: PRICING_TABLES } });
  const pending = usePending();
  const data = useMemo(() => (q.data ? applyPending(q.data, pending) : undefined), [q.data, pending]);
  const refetch = q.refetch;
  return useMemo(
    () => ({ data, isLoading: q.isLoading, error: data ? null : q.error, refetch: () => void refetch() }),
    [data, q.isLoading, q.error, refetch],
  );
}

const noop = () => {};

function useDemoPricingInputs(): PricingInputsResult {
  const p = useApp(
    useShallow((s) => ({ rate: s.rate, trip: s.trip, markup: s.markup, techCost: s.techCost, mins: s.mins, freq: s.freq })),
  );
  return useMemo(
    () => ({
      data: {
        settings: { ...DEFAULT_SETTINGS, rate: p.rate, trip: p.trip, markup: p.markup, techCost: p.techCost },
        mins: p.mins,
        freq: p.freq,
        coordinationFee: COORDINATION_FEE,
      },
      isLoading: false,
      error: null,
      refetch: noop,
    }),
    [p],
  );
}

/** Office settings + task defaults. Live: `pricing_settings` + `task_defaults`. Demo: the shared store. */
export function usePricingInputs(): PricingInputsResult {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLivePricingInputs : useDemoPricingInputs;
  return useImpl();
}

// ---------------------------------------------------------------------------
// Office mutations
// ---------------------------------------------------------------------------

export interface OfficePricingMutations {
  /** Absolute value in app units (markup in percent). Clamped to SETTING_LIMITS. */
  setSetting(k: SettingKey, value: number): void;
  /** Absolute labor minutes (at least 5). */
  setMinutes(taskKey: string, value: number): void;
  /** Absolute times per year for one tier (0–12). */
  setFreq(taskKey: string, tierIndex: number, value: number): void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(id: string, fn: () => void) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      fn();
    }, 250),
  );
}

function patchCache(fn: (d: PricingInputs) => PricingInputs) {
  queryClient.setQueryData<PricingInputs>(PRICING_KEY, (old) => (old ? fn(old) : old));
}

/** Write, refetch, then drop the pending overlay (if no newer edit replaced it). Errors roll back to the server value. */
async function commit(
  table: 'pricing_settings' | 'task_defaults',
  write: () => PromiseLike<{ data: unknown[] | null; error: unknown; status?: number }>,
  clear: () => void,
) {
  try {
    const rows = unwrap(await write());
    if (!rows || rows.length === 0) throw new FriendlyError(MSG.access);
    // Refetch first so the confirmed value is in the cache before the overlay goes.
    await invalidateTables([table]);
    clear();
  } catch (e) {
    toast(friendlyError(e), 'brick');
    clear();
    void invalidateTables([table]);
  }
}

const LIVE: OfficePricingMutations = {
  setSetting(k, value) {
    const v = clampSetting(k, value);
    usePending.setState((p) => ({ settings: { ...p.settings, [k]: v } }));
    patchCache((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));
    debounce(`s:${k}`, () =>
      commit(
        'pricing_settings',
        () => requireSupabase().from('pricing_settings').update({ [SETTING_COLUMN[k]]: k === 'markup' ? v / 100 : v }).eq('id', 1).select('id'),
        () =>
          usePending.setState((p) => {
            if (p.settings[k] !== v) return p;
            const { [k]: _, ...rest } = p.settings;
            return { settings: rest };
          }),
      ),
    );
  },
  setMinutes(taskKey, value) {
    const v = clampMinutes(value);
    usePending.setState((p) => ({ mins: { ...p.mins, [taskKey]: v } }));
    patchCache((d) => ({ ...d, mins: { ...d.mins, [taskKey]: v } }));
    debounce(`m:${taskKey}`, () =>
      commit(
        'task_defaults',
        () => requireSupabase().from('task_defaults').update({ labor_min: v }).eq('task_key', taskKey).select('task_key'),
        () =>
          usePending.setState((p) => {
            if (p.mins[taskKey] !== v) return p;
            const { [taskKey]: _, ...rest } = p.mins;
            return { mins: rest };
          }),
      ),
    );
  },
  setFreq(taskKey, tierIndex, value) {
    const tier = TIERS[tierIndex];
    if (!tier) return;
    const v = clampFreq(value);
    const id = `${taskKey}:${tierIndex}`;
    usePending.setState((p) => ({ freq: { ...p.freq, [id]: v } }));
    patchCache((d) => {
      const row = [...(d.freq[taskKey] ?? [0, 0, 0, 0])];
      row[tierIndex] = v;
      return { ...d, freq: { ...d.freq, [taskKey]: row } };
    });
    debounce(`f:${id}`, () =>
      commit(
        'task_defaults',
        () => requireSupabase().from('task_defaults').update({ [`freq_${tier.key}`]: v }).eq('task_key', taskKey).select('task_key'),
        () =>
          usePending.setState((p) => {
            if (p.freq[id] !== v) return p;
            const { [id]: _, ...rest } = p.freq;
            return { freq: rest };
          }),
      ),
    );
  },
};

// Demo: the store's bump / setMinutes / setFreq rules, with absolute values.
const DEMO: OfficePricingMutations = {
  setSetting(k, value) {
    useApp.setState({ [k]: clampSetting(k, value) } as Partial<ReturnType<typeof useApp.getState>>);
  },
  setMinutes(taskKey, value) {
    useApp.setState((s) => ({ mins: { ...s.mins, [taskKey]: clampMinutes(value) } }));
  },
  setFreq(taskKey, tierIndex, value) {
    useApp.setState((s) => {
      const a = [...(s.freq[taskKey] ?? [0, 0, 0, 0])];
      a[tierIndex] = clampFreq(value);
      return { freq: { ...s.freq, [taskKey]: a } };
    });
  },
};

/** Office pricing edits: optimistic, with a debounced (250 ms) write of the absolute value. */
export function useOfficePricingMutations(): OfficePricingMutations {
  const { mode } = useMode();
  return mode === 'live' ? LIVE : DEMO;
}
