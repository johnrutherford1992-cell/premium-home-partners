// One shared store for the four roles. In demo mode every role runs on the same
// device, exactly like the connected prototype, so actions in one app show up
// in the others. With Supabase configured these slices are replaced by
// React Query + Realtime over the tables in supabase/migrations.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_FREQ,
  DEFAULT_MINUTES,
  DEFAULT_SETTINGS,
  type Frequencies,
  type LaborMinutes,
  type Water,
} from '@php/pricing';
import { ADD_ONS, APPLIANCES, MY_VENDOR, OTHER_VENDORS } from '../data/seed';

export type TechStatus = 'scheduled' | 'enroute' | 'onsite' | 'done';

export interface Bid {
  vendor: string;
  rating: number;
  when: string;
  price: number;
  mine?: boolean;
}

export interface QuoteRequest {
  id: string;
  name: string;
  sub: string;
  base: number;
  bids: Bid[];
  /** Index into bids of the booked bid. */
  booked: number | null;
}

export interface AppState {
  dark: boolean;
  // Homeowner onboarding
  step: number; // 0 welcome · 1–5 onboarding · 6 onboarded
  name: string;
  addr: string;
  scanned: number;
  scanning: boolean;
  sqft: number;
  year: number;
  beds: number;
  baths: number;
  floors: number;
  zones: number;
  pets: boolean;
  water: Water;
  research: number;
  tier: number;
  // Visit
  slot: number;
  confirmed: boolean;
  tech: TechStatus;
  done: Record<string, boolean>;
  shots: Record<string, boolean>;
  report: boolean;
  reminders: boolean;
  // Office pricing
  rate: number;
  trip: number;
  markup: number;
  techCost: number;
  mins: LaborMinutes;
  freq: Frequencies;
  // Brokerage
  reqs: QuoteRequest[];
  vPrice: Record<string, number>;
  vWhen: number;
}

type NumKey = 'sqft' | 'year' | 'beds' | 'baths' | 'floors' | 'zones' | 'rate' | 'trip' | 'markup' | 'techCost';

interface Actions {
  set: (p: Partial<AppState>) => void;
  reset: () => void;
  bump: (k: NumKey, d: number, min: number, max: number) => void;
  goStep: (n: number) => void;
  shutter: () => void;
  techAdvance: () => void;
  toggleTask: (id: string) => void;
  togglePhoto: (id: string) => void;
  completeVisit: () => void;
  setMinutes: (id: string, d: number) => void;
  setFreq: (id: string, tier: number, d: number) => void;
  requestQuote: (addOnId: string) => void;
  book: (reqId: string, bidIndex: number) => void;
  submitBid: (reqId: string, price: number, when: string) => void;
  resumePending: () => void;
}

const initial = (): AppState => ({
  dark: false,
  step: 0,
  name: 'Elena Alvarez',
  addr: '12 Linden Court, Mountain Brook, AL 35213',
  scanned: 0,
  scanning: false,
  sqft: 3420,
  year: 2006,
  beds: 4,
  baths: 3.5,
  floors: 2,
  zones: 2,
  pets: true,
  water: 'city_hard',
  research: 0,
  tier: 1,
  slot: 0,
  confirmed: false,
  tech: 'scheduled',
  done: {},
  shots: {},
  report: false,
  reminders: false,
  rate: DEFAULT_SETTINGS.rate,
  trip: DEFAULT_SETTINGS.trip,
  markup: DEFAULT_SETTINGS.markup,
  techCost: DEFAULT_SETTINGS.techCost,
  mins: { ...DEFAULT_MINUTES },
  freq: Object.fromEntries(Object.entries(DEFAULT_FREQ).map(([k, v]) => [k, [...v]])),
  reqs: [],
  vPrice: {},
  vWhen: 0,
});

let timers: ReturnType<typeof setTimeout>[] = [];
const clearTimers = () => {
  timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  timers = [];
};

export const useApp = create<AppState & Actions>()(
  persist(
    (set, get) => {
      const addBid = (id: string, b: Bid) =>
        set((s) => ({ reqs: s.reqs.map((r) => (r.id === id ? { ...r, bids: [...r.bids, b] } : r)) }));

      // Network vendors answer each request a few seconds apart.
      const scheduleNetworkBids = (id: string, base: number) => {
        const have = new Set(get().reqs.find((r) => r.id === id)?.bids.map((b) => b.vendor));
        OTHER_VENDORS.filter((o) => !have.has(o.vendor)).forEach((o, k) =>
          timers.push(
            setTimeout(() => addBid(id, { vendor: o.vendor, rating: o.rating, when: o.when, price: Math.round(base * o.m) }), 1500 + k * 1300),
          ),
        );
      };

      const runResearch = () => {
        if (get().research >= 100) return;
        const iv = setInterval(() => {
          const r = Math.min(100, get().research + 3);
          set({ research: r });
          if (r >= 100) clearInterval(iv);
        }, 90);
        timers.push(iv);
      };

      return {
        ...initial(),
        set: (p) => set(p),
        reset: () => {
          clearTimers();
          set({ ...initial(), dark: get().dark });
        },
        bump: (k, d, min, max) => set((s) => ({ [k]: Math.max(min, Math.min(max, +(s[k] + d).toFixed(1))) }) as Partial<AppState>),
        goStep: (n) => {
          set({ step: n });
          if (n === 4) runResearch();
        },
        shutter: () => {
          const s = get();
          if (s.scanning || s.scanned >= APPLIANCES.length) return;
          set({ scanning: true });
          timers.push(setTimeout(() => set((x) => ({ scanning: false, scanned: x.scanned + 1 })), 1100));
        },
        techAdvance: () => set((s) => ({ tech: s.tech === 'scheduled' ? 'enroute' : 'onsite' })),
        toggleTask: (id) => set((s) => (s.tech === 'onsite' ? { done: { ...s.done, [id]: !s.done[id] } } : {})),
        togglePhoto: (id) => set((s) => (s.tech === 'onsite' ? { shots: { ...s.shots, [id]: !s.shots[id] } } : {})),
        completeVisit: () => set({ tech: 'done', report: true }),
        setMinutes: (id, d) => set((s) => ({ mins: { ...s.mins, [id]: Math.max(5, (s.mins[id] ?? 0) + d) } })),
        setFreq: (id, tier, d) =>
          set((s) => {
            const a = [...s.freq[id]];
            a[tier] = Math.max(0, Math.min(12, a[tier] + d));
            return { freq: { ...s.freq, [id]: a } };
          }),
        requestQuote: (addOnId) => {
          const a = ADD_ONS.find((x) => x.id === addOnId);
          if (!a || get().reqs.some((r) => r.id === a.id)) return;
          set((s) => ({
            reqs: [...s.reqs, { id: a.id, name: a.name, sub: a.sub, base: a.base, bids: [], booked: null }],
            vPrice: { ...s.vPrice, [a.id]: a.base },
          }));
          scheduleNetworkBids(a.id, a.base);
        },
        book: (reqId, j) =>
          set((s) => ({ reqs: s.reqs.map((r) => (r.id === reqId && r.booked == null ? { ...r, booked: j } : r)) })),
        submitBid: (reqId, price, when) => addBid(reqId, { ...MY_VENDOR, when, price, mine: true }),
        resumePending: () => {
          const s = get();
          if (s.step === 4 && s.research < 100) runResearch();
          s.reqs.filter((r) => r.booked == null).forEach((r) => scheduleNetworkBids(r.id, r.base));
        },
      };
    },
    {
      name: 'php-demo-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Transient UI (scan in flight) is never restored.
      partialize: ({ scanning, ...rest }) => rest,
      onRehydrateStorage: () => (s) => {
        // Resume timers (research run, incoming bids) interrupted by a reload.
        s?.resumePending();
      },
    },
  ),
);
