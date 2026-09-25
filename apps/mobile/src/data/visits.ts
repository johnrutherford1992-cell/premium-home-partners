// Visit view models shared by the homeowner, tech and office apps.
// Pure (no React, no client): the per-role hooks fetch with VISIT_SELECT and
// map rows with mapVisit(). Unit-tested in test/visits.test.ts.

import { TASKS, TIERS, type LaborMinutes, type PhotoKind } from '@php/pricing';
import { fmtDay, fmtDuration, fmtWindow } from '../lib/dates';

export type VisitStatus = 'scheduled' | 'enroute' | 'onsite' | 'done';
export type TaskPhotoKind = 'before' | 'after' | 'drain';

export interface TaskPhotoVM {
  id: string;
  kind: string;
  path: string;
}

export interface TaskVM {
  id: string;
  key: string;
  name: string;
  short: string;
  part: string;
  min: number;
  done: boolean;
  /** Which photo the checklist asks for: dirty → before, clean/ice → after, drain → drain. */
  photoKind: TaskPhotoKind;
  photos: TaskPhotoVM[];
}

export interface TechVM {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  title: string;
  van: string;
}

export interface VisitVM {
  id: string;
  homeId: string;
  status: VisitStatus;
  confirmed: boolean;
  windowStart: string;
  windowEnd: string;
  /** `'Fri · Sep 25'` */
  day: string;
  /** `'9:00 – 11:00 AM'` */
  time: string;
  /** `'3 hr 5 min'` */
  duration: string;
  client: { name: string; firstName: string; street: string; address: string; pets: boolean; notes: string };
  tierIndex: number;
  tierName: string;
  tech: TechVM | null;
  tasks: TaskVM[];
  doneCount: number;
  notices: { d7: boolean; h48: boolean; dayOf: boolean; report: boolean };
  reportId: string | null;
  /** Reschedule options, `{ start, end }` ISO pairs (homeowner). */
  offeredSlots: { start: string; end: string }[];
}

/**
 * PostgREST select for one visit with everything a VisitVM needs. Use it as
 * `supabase.from('visits').select(VISIT_SELECT)` and add `meta: { tables: VISIT_TABLES }`.
 */
export const VISIT_SELECT = [
  'id,home_id,plan_id,tech_id,status,window_start,window_end,confirmed_at,offered_slots,started_at,arrived_at,completed_at',
  'homes(id,address,pets,water,notes,owner:profiles!homes_owner_id_fkey(full_name))',
  'plans(tier)',
  'tech:profiles!visits_tech_id_fkey(id,full_name,title,vehicle)',
  'visit_tasks(id,task_key,name,done,visit_photos(id,kind,path))',
  'notices(kind)',
  'reports(id)',
].join(',');

/** Tables VISIT_SELECT reads; pass as `meta.tables` so realtime and RPCs refetch it. */
export const VISIT_TABLES = ['visits', 'visit_tasks', 'visit_photos', 'notices', 'reports', 'homes', 'plans', 'profiles'];

// Row shape returned by VISIT_SELECT. Embeds may come back as an object or a
// one-element array depending on how PostgREST reads the relationship.
type One<T> = T | T[] | null | undefined;

export interface VisitRow {
  id: string;
  home_id: string | null;
  plan_id?: string | null;
  tech_id?: string | null;
  status: string | null;
  window_start: string | null;
  window_end: string | null;
  confirmed_at: string | null;
  offered_slots?: unknown;
  started_at?: string | null;
  arrived_at?: string | null;
  completed_at?: string | null;
  homes?: One<{
    id?: string;
    address: string | null;
    pets: boolean | null;
    water?: string | null;
    notes?: string | null;
    owner?: One<{ full_name: string | null }>;
  }>;
  plans?: One<{ tier: string | null }>;
  tech?: One<{ id: string; full_name: string | null; title?: string | null; vehicle?: string | null }>;
  visit_tasks?: {
    id: string;
    task_key: string | null;
    name: string | null;
    done: boolean | null;
    visit_photos?: { id: string; kind: string | null; path: string }[] | null;
  }[] | null;
  notices?: { kind: string | null }[] | null;
  reports?: One<{ id: string }>;
}

const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

const PHOTO_KIND: Record<PhotoKind, TaskPhotoKind> = { dirty: 'before', clean: 'after', ice: 'after', drain: 'drain' };

const STATUSES: readonly VisitStatus[] = ['scheduled', 'enroute', 'onsite', 'done'];

/** `'Marcus Reyes'` → `'MR'`, `'The Whitfields'` → `'TW'`. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9À-ɏ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function mapTech(t: { id: string; full_name: string | null; title?: string | null; vehicle?: string | null }): TechVM {
  const name = t.full_name?.trim() || 'Your technician';
  return {
    id: t.id,
    name,
    firstName: name.split(' ')[0] || name,
    initials: initials(name) || '·',
    title: t.title ?? '',
    van: t.vehicle ?? '',
  };
}

function mapSlots(x: unknown): { start: string; end: string }[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((s): s is { start: string; end: string } => !!s && typeof s === 'object' && typeof (s as { start?: unknown }).start === 'string' && typeof (s as { end?: unknown }).end === 'string')
    .map((s) => ({ start: s.start, end: s.end }));
}

/** Map one VISIT_SELECT row to the view model the screens render. */
export function mapVisit(row: VisitRow, mins: LaborMinutes): VisitVM {
  const home = one(row.homes);
  const owner = one(home?.owner);
  const plan = one(row.plans);
  const techRow = one(row.tech);
  const report = one(row.reports);

  const order = (key: string) => {
    const i = TASKS.findIndex((t) => t.id === key);
    return i < 0 ? TASKS.length : i;
  };
  const tasks: TaskVM[] = (row.visit_tasks ?? [])
    .map((vt) => {
      const key = vt.task_key ?? '';
      const def = TASKS.find((t) => t.id === key);
      return {
        id: vt.id,
        key,
        name: vt.name?.trim() || def?.name || key,
        short: def?.short ?? (vt.name?.trim() || key),
        part: def?.part ?? '—',
        min: mins[key] ?? 0,
        done: !!vt.done,
        photoKind: def ? PHOTO_KIND[def.photo] : 'after',
        photos: (vt.visit_photos ?? []).map((p) => ({ id: p.id, kind: p.kind ?? '', path: p.path })),
      };
    })
    .sort((a, b) => order(a.key) - order(b.key) || a.name.localeCompare(b.name));

  const totalMin = tasks.reduce((a, t) => a + t.min, 0);
  const kinds = new Set((row.notices ?? []).map((n) => n.kind));
  const rawStatus = row.status ?? 'scheduled';
  const status: VisitStatus = (STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as VisitStatus) : 'scheduled';
  const tierIndex = Math.max(0, TIERS.findIndex((t) => t.key === plan?.tier));
  const address = home?.address ?? '';
  const name = owner?.full_name?.trim() || '';
  const windowStart = row.window_start ?? '';
  const windowEnd = row.window_end ?? '';

  return {
    id: row.id,
    homeId: row.home_id ?? home?.id ?? '',
    status,
    confirmed: row.confirmed_at != null || rawStatus === 'confirmed',
    windowStart,
    windowEnd,
    day: windowStart ? fmtDay(windowStart) : '',
    time: windowStart ? fmtWindow(windowStart, windowEnd || null) : '',
    duration: fmtDuration(totalMin),
    client: {
      name,
      firstName: name.split(' ')[0] || 'there',
      street: address.split(',')[0]?.trim() ?? '',
      address,
      pets: !!home?.pets,
      notes: home?.notes ?? '',
    },
    tierIndex: plan?.tier ? tierIndex : 1,
    tierName: TIERS[plan?.tier ? tierIndex : 1].name,
    tech: techRow ? mapTech(techRow) : null,
    tasks,
    doneCount: tasks.filter((t) => t.done).length,
    notices: { d7: kinds.has('7d'), h48: kinds.has('48h'), dayOf: kinds.has('enroute'), report: kinds.has('report') },
    reportId: report?.id ?? null,
    offeredSlots: mapSlots(row.offered_slots),
  };
}
