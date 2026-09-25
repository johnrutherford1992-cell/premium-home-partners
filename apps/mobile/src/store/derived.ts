import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_SETTINGS, TASKS, TIERS, adjustedFreq, buildSchedule, priceAllTiers } from '@php/pricing';
import { toTierViews, type TierView } from '../data/pricing';
import { MONTHS, SLOTS } from '../data/seed';
import { useApp } from './app';

export type { TierView } from '../data/pricing';

/** Pricing for every tier, recomputed whenever office settings or the home profile change. */
export function useTiers(): { tiers: TierView[]; cur: TierView } {
  const p = useApp(
    useShallow((s) => ({
      rate: s.rate,
      trip: s.trip,
      markup: s.markup,
      techCost: s.techCost,
      mins: s.mins,
      freq: s.freq,
      pets: s.pets,
      water: s.water,
      tier: s.tier,
    })),
  );
  return useMemo(() => {
    const tiers = toTierViews(
      priceAllTiers({
        settings: { ...DEFAULT_SETTINGS, rate: p.rate, trip: p.trip, markup: p.markup, techCost: p.techCost },
        minutes: p.mins,
        freq: p.freq,
        home: { pets: p.pets, water: p.water },
      }),
    );
    return { tiers, cur: tiers[p.tier] };
  }, [p]);
}

/** Tasks on the next visit (the baseline visit includes every active task). */
export function useVisit() {
  const { freq, pets, water, tier, mins, slot, done } = useApp(
    useShallow((s) => ({ freq: s.freq, pets: s.pets, water: s.water, tier: s.tier, mins: s.mins, slot: s.slot, done: s.done })),
  );
  return useMemo(() => {
    const home = { pets, water };
    const tasks = TASKS.filter((t) => adjustedFreq(t.id, tier, freq, home) > 0).map((t) => ({ ...t, min: mins[t.id] }));
    const totalMin = tasks.reduce((a, t) => a + t.min, 0);
    const doneCount = tasks.filter((t) => done[t.id]).length;
    return {
      tasks,
      duration: `${Math.floor(totalMin / 60)} hr ${totalMin % 60} min`,
      doneCount,
      day: SLOTS[slot][0],
      time: SLOTS[slot][1],
    };
  }, [freq, pets, water, tier, mins, slot, done]);
}

export function useYearOfCare() {
  const { freq, pets, water, tier, report } = useApp(
    useShallow((s) => ({ freq: s.freq, pets: s.pets, water: s.water, tier: s.tier, report: s.report })),
  );
  return useMemo(
    () =>
      buildSchedule(tier, freq, { pets, water }).map((v) => ({
        month: MONTHS[v.monthOffset],
        label: v.index === 0 ? (report ? 'Done' : 'Next') : `Visit ${v.index + 1}`,
        first: v.index === 0,
        items: v.taskIds.map((id) => TASKS.find((t) => t.id === id)!.short).join(' · '),
      })),
    [freq, pets, water, tier, report],
  );
}

export function useHomeNames() {
  const { name, addr } = useApp(useShallow((s) => ({ name: s.name, addr: s.addr })));
  return { firstName: name.split(' ')[0] || 'there', street: addr.split(',')[0], name, addr };
}

export const TIER_COUNT = TIERS.length;
