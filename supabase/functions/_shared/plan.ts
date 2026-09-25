// build-plan logic that doesn't touch the network: the step plan, pricing
// inputs from live rows, model matching and parts pricing.
// Runtime-neutral so it is unit-tested under `node --test`.

import { normModel } from './appliance.ts';
import { DEFAULT_FREQ, DEFAULT_MINUTES, DEFAULT_SETTINGS, TASKS, priceAllTiers } from './pricing.ts';
import type { Frequencies, HomeProfile, LaborMinutes, PricingSettings, TierQuote, Water } from './pricing.ts';

/** Minimum time between progress updates, so the research screen reads as a sequence. */
export const STEP_INTERVAL_MS = 700;

export type BuildStep = 'reading' | 'manuals' | 'tasks' | 'parts' | 'adjusting' | 'ready' | 'error';

/** Written when the build row is created, before the 202 response. */
export const INITIAL_STEP = { step: 'reading', progress: 2 } as const satisfies { step: BuildStep; progress: number };

/** Background steps, in order (docs/LIVE_ARCHITECTURE.md §5). */
export const BUILD_STEPS = [
  { step: 'reading', progress: 8 },
  { step: 'manuals', progress: 28 },
  { step: 'tasks', progress: 50 },
  { step: 'parts', progress: 74 },
  { step: 'adjusting', progress: 94 },
  { step: 'ready', progress: 100 },
] as const satisfies readonly { step: BuildStep; progress: number }[];

export const BUILD_ERROR = "We couldn't finish building your plan. Try again.";

export interface PartPrice {
  name: string;
  price: number;
  part_number: string;
  supplier: string;
}

export interface BuildSummary {
  appliances: number;
  manuals: number;
  tasks: number;
  parts: PartPrice[];
  suppliers: number;
}

export const emptySummary = (): BuildSummary => ({ appliances: 0, manuals: 0, tasks: 0, parts: [], suppliers: 0 });

/** Default consumable per task (matches private.task_part_id in the live migration). */
export const TASK_PART_NUMBERS: Record<string, string> = {
  hvac: '16x25x4-MERV11',
  fridge: 'LT1000P',
  ice: 'ICE-SANI',
  dish: 'AFFRESH-DW',
  wh: 'WH-DRAIN',
  smoke: '9V',
};

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export interface SettingsRow {
  labor_rate?: unknown;
  trip_fee?: unknown;
  parts_markup?: unknown;
  tech_cost?: unknown;
  vehicle_cost?: unknown;
}

export interface TaskDefaultRow {
  task_key: string;
  labor_min?: unknown;
  freq_high?: unknown;
  freq_recommended?: unknown;
  freq_medium?: unknown;
  freq_low?: unknown;
}

/** Live pricing_settings + task_defaults rows as pricing-module inputs. Missing values fall back to the defaults. */
export function pricingInputs(
  s: SettingsRow | null | undefined,
  defaults: TaskDefaultRow[] | null | undefined,
): { settings: PricingSettings; minutes: LaborMinutes; freq: Frequencies } {
  const settings: PricingSettings = s
    ? {
        rate: num(s.labor_rate, DEFAULT_SETTINGS.rate),
        trip: num(s.trip_fee, DEFAULT_SETTINGS.trip),
        // The DB stores the markup as a fraction (0.25); the pricing module wants percent.
        markup: s.parts_markup == null ? DEFAULT_SETTINGS.markup : Math.round(num(s.parts_markup, 0.25) * 100 * 1e6) / 1e6,
        techCost: num(s.tech_cost, DEFAULT_SETTINGS.techCost),
        vehicleCostPerVisit: num(s.vehicle_cost, DEFAULT_SETTINGS.vehicleCostPerVisit),
      }
    : { ...DEFAULT_SETTINGS };
  const minutes: LaborMinutes = { ...DEFAULT_MINUTES };
  const freq: Frequencies = Object.fromEntries(Object.entries(DEFAULT_FREQ).map(([k, v]) => [k, [...v]]));
  for (const d of defaults ?? []) {
    if (!d || typeof d.task_key !== 'string') continue;
    const k = d.task_key;
    const base = freq[k] ?? [0, 0, 0, 0];
    minutes[k] = num(d.labor_min, minutes[k] ?? 0);
    freq[k] = [
      num(d.freq_high, base[0]),
      num(d.freq_recommended, base[1]),
      num(d.freq_medium, base[2]),
      num(d.freq_low, base[3]),
    ];
  }
  return { settings, minutes, freq };
}

const WATERS: Water[] = ['city_hard', 'well', 'softened'];

export function homeProfile(home: { pets?: unknown; water?: unknown } | null | undefined): HomeProfile {
  const water = WATERS.includes(home?.water as Water) ? (home!.water as Water) : 'city_hard';
  return { pets: home?.pets === true, water };
}

/** All four tier quotes for a home at the live settings. */
export function buildOptions(
  s: SettingsRow | null | undefined,
  defaults: TaskDefaultRow[] | null | undefined,
  home: { pets?: unknown; water?: unknown } | null | undefined,
): TierQuote[] {
  return priceAllTiers({ ...pricingInputs(s, defaults), home: homeProfile(home) });
}

export interface ApplianceRow {
  model_id: string | null;
  model: string | null;
}

export interface ModelRow {
  id: string;
  model: string | null;
}

/**
 * Resolves each appliance to a cached model: its model_id when linked, else a
 * normalized model-number match. Returns the distinct model ids found.
 */
export function matchModels(appliances: ApplianceRow[], models: ModelRow[]): string[] {
  const byNorm = new Map<string, string>();
  for (const m of models) {
    const n = normModel(m.model);
    if (n && !byNorm.has(n)) byNorm.set(n, m.id);
  }
  const ids: string[] = [];
  for (const a of appliances) {
    const id = a.model_id ?? byNorm.get(normModel(a.model)) ?? null;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Distinct task keys the matched manuals cover. */
export function countTasks(modelTasks: { task_key: string | null }[]): number {
  return new Set(modelTasks.map((t) => t.task_key).filter((k): k is string => !!k)).size;
}

/**
 * Part numbers to price, in TASKS order: the parts the home's manuals name for
 * each task, or the task's default part when no manual covers it (the plan
 * prices every task).
 */
export function partNumbersToPrice(modelTasks: { task_key: string | null; part_number: string | null }[]): string[] {
  const out: string[] = [];
  const add = (p: string | null | undefined) => {
    const v = p?.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  for (const t of TASKS) {
    const fromManuals = modelTasks.filter((m) => m.task_key === t.id && m.part_number?.trim());
    if (fromManuals.length) fromManuals.forEach((m) => add(m.part_number));
    else add(TASK_PART_NUMBERS[t.id]);
  }
  // Parts named by manuals for tasks outside TASKS still get priced, last.
  modelTasks.forEach((m) => add(m.part_number));
  return out;
}

export interface PriceRow {
  part_number: string;
  description: string | null;
  supplier: string | null;
  price: unknown;
  in_stock: boolean | null;
}

export const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lowest in-stock price per part (skipping parts with none) and how many suppliers were checked. */
export function lowestInStock(partNumbers: string[], rows: PriceRow[]): { parts: PartPrice[]; suppliers: number } {
  const parts: PartPrice[] = [];
  const suppliers = new Set<string>();
  for (const pn of partNumbers) {
    let best: PartPrice | null = null;
    for (const r of rows) {
      if (r.part_number !== pn) continue;
      if (r.supplier) suppliers.add(r.supplier);
      const price = num(r.price, NaN);
      if (!r.in_stock || !Number.isFinite(price) || price <= 0) continue;
      if (!best || price < best.price || (price === best.price && (r.supplier ?? '') < best.supplier)) {
        best = { name: r.description?.trim() || pn, price: roundCents(price), part_number: pn, supplier: r.supplier ?? '' };
      }
    }
    if (best) parts.push(best);
  }
  return { parts, suppliers: suppliers.size };
}

/** How long to wait so consecutive updates are at least STEP_INTERVAL_MS apart. */
export const waitBeforeNext = (lastAt: number, now: number, interval = STEP_INTERVAL_MS) =>
  Math.max(0, lastAt + interval - now);

