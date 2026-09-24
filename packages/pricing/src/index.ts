// Shared tier pricing + visit scheduling for Premium Home Partners.
// Used by the homeowner tier screen, the office pricing calculator and the
// `build-plan` edge function, so every surface quotes the same number.

export type TierKey = 'high' | 'recommended' | 'medium' | 'low';
export type Water = 'city_hard' | 'well' | 'softened';
export type PhotoKind = 'dirty' | 'clean' | 'drain' | 'ice';

export interface Task {
  id: string;
  name: string;
  short: string;
  part: string;
  /** AI-researched lowest in-stock price for the part(s) used per service. */
  cost: number;
  photo: PhotoKind;
}

export interface Tier {
  key: TierKey;
  name: string;
  short: string;
  tag: string;
  visits: number;
  /** Share of manufacturer-recommended service covered, in percent. */
  coverage: number;
}

export interface PricingSettings {
  /** Labor $/hr billed to the homeowner. */
  rate: number;
  /** Trip fee per visit. */
  trip: number;
  /** Parts markup in percent (25 = 25%). */
  markup: number;
  /** Loaded tech cost $/hr, used for margin only. */
  techCost: number;
  /** Vehicle cost per visit, used for margin only. */
  vehicleCostPerVisit: number;
}

/** Labor minutes per task id. */
export type LaborMinutes = Record<string, number>;
/** Times per year per task id, indexed by tier order (high, recommended, medium, low). */
export type Frequencies = Record<string, number[]>;

export interface HomeProfile {
  pets: boolean;
  water: Water;
}

export const TASKS: Task[] = [
  { id: 'hvac', name: 'Replace HVAC filters ×2', short: 'HVAC filters', part: '16×25×4 MERV 11 ×2', cost: 76.8, photo: 'dirty' },
  { id: 'fridge', name: 'Replace fridge water filter', short: 'Fridge filter', part: 'LG LT1000P', cost: 49.97, photo: 'clean' },
  { id: 'ice', name: 'Drain & sanitize ice maker', short: 'Ice maker', part: 'Sanitizer kit', cost: 8.5, photo: 'ice' },
  { id: 'dish', name: 'Clean dishwasher filter & sump', short: 'Dishwasher', part: 'Affresh tablets', cost: 4.2, photo: 'dirty' },
  { id: 'wh', name: 'Flush water heater', short: 'Heater flush', part: 'Drain hose kit', cost: 6, photo: 'drain' },
  { id: 'dryer', name: 'Clean dryer vent', short: 'Dryer vent', part: '—', cost: 0, photo: 'dirty' },
  { id: 'smoke', name: 'Test smoke & CO detectors', short: 'Smoke & CO', part: '9V batteries ×4', cost: 12, photo: 'clean' },
];

export const TIERS: Tier[] = [
  { key: 'high', name: 'High', short: 'HIGH', tag: 'Manufacturer max', visits: 12, coverage: 100 },
  { key: 'recommended', name: 'PHP Recommended', short: 'REC.', tag: 'Best value', visits: 6, coverage: 92 },
  { key: 'medium', name: 'Medium', short: 'MED.', tag: 'Essentials+', visits: 4, coverage: 78 },
  { key: 'low', name: 'Low', short: 'LOW', tag: 'Core only', visits: 2, coverage: 55 },
];

export const DEFAULT_SETTINGS: PricingSettings = {
  rate: 94,
  trip: 35,
  markup: 25,
  techCost: 38,
  vehicleCostPerVisit: 12,
};

export const DEFAULT_MINUTES: LaborMinutes = { hvac: 20, fridge: 10, ice: 25, dish: 15, wh: 40, dryer: 30, smoke: 10 };

export const DEFAULT_FREQ: Frequencies = {
  hvac: [6, 6, 4, 2],
  fridge: [2, 2, 2, 1],
  ice: [4, 2, 2, 1],
  dish: [12, 6, 4, 2],
  wh: [2, 2, 1, 1],
  dryer: [2, 1, 1, 0],
  smoke: [4, 2, 2, 1],
};

/** PHP coordination fee on brokered add-on work. */
export const COORDINATION_FEE = 0.1;

/** Frequency after home adjustments, capped at the tier's visit count. */
export function adjustedFreq(taskId: string, tierIndex: number, freq: Frequencies, home: HomeProfile): number {
  let f = freq[taskId]?.[tierIndex] ?? 0;
  if (taskId === 'hvac' && !home.pets) f = Math.min(f, 4);
  if (taskId === 'wh' && home.water === 'well') f = Math.max(1, f - 1);
  return Math.min(f, TIERS[tierIndex].visits);
}

export interface TierQuote {
  tier: Tier;
  index: number;
  partsRaw: number;
  materials: number;
  hours: number;
  labor: number;
  annual: number;
  monthly: number;
  cost: number;
  margin: number;
}

export function priceTier(
  tierIndex: number,
  opts: { settings: PricingSettings; minutes: LaborMinutes; freq: Frequencies; home: HomeProfile; tasks?: Task[] },
): TierQuote {
  const { settings, minutes, freq, home } = opts;
  const tasks = opts.tasks ?? TASKS;
  const tier = TIERS[tierIndex];
  const visits = tier.visits;
  let partsRaw = 0;
  let mins = 0;
  for (const t of tasks) {
    const f = adjustedFreq(t.id, tierIndex, freq, home);
    partsRaw += f * t.cost;
    mins += f * (minutes[t.id] ?? 0);
  }
  const hours = mins / 60;
  const materials = partsRaw * (1 + settings.markup / 100);
  const labor = hours * settings.rate + visits * settings.trip;
  const annual = materials + labor;
  const cost = partsRaw + hours * settings.techCost + visits * settings.vehicleCostPerVisit;
  const margin = annual > 0 ? (annual - cost) / annual : 0;
  return { tier, index: tierIndex, partsRaw, materials, hours, labor, annual, monthly: annual / 12, cost, margin };
}

export function priceAllTiers(opts: Parameters<typeof priceTier>[1]): TierQuote[] {
  return TIERS.map((_, i) => priceTier(i, opts));
}

export interface ScheduledVisit {
  /** 0-based visit number within the plan year. */
  index: number;
  /** Months after the plan start. */
  monthOffset: number;
  taskIds: string[];
}

/**
 * Visits are spaced every 12 / visits months. Task t lands in visit k when
 * (k · f) mod visits < f, which spreads each task evenly and puts every active
 * task in the first (baseline) visit.
 */
export function buildSchedule(tierIndex: number, freq: Frequencies, home: HomeProfile, tasks: Task[] = TASKS): ScheduledVisit[] {
  const visits = TIERS[tierIndex].visits;
  const step = 12 / visits;
  const out: ScheduledVisit[] = [];
  for (let k = 0; k < visits; k++) {
    const taskIds = tasks
      .filter((t) => {
        const f = adjustedFreq(t.id, tierIndex, freq, home);
        return f > 0 && (k * f) % visits < f;
      })
      .map((t) => t.id);
    out.push({ index: k, monthOffset: k * step, taskIds });
  }
  return out;
}

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
