// Technician data: the route and one visit, plus the visit mutations.
// Live reads visits with VISIT_SELECT (RLS scopes them to the signed-in tech)
// and writes through the advance_visit / set_task_done / add_visit_photo /
// complete_visit RPCs. Demo adapts the shared zustand store, unchanged.

import { DEFAULT_MINUTES, type LaborMinutes, type PhotoKind } from '@php/pricing';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { usePhotoCapture } from '../components/camera';
import { useSession } from '../lib/auth';
import { addDays, chicagoDate, fmtTime, startOfDayChicagoIso, todayChicago } from '../lib/dates';
import { friendlyError } from '../lib/errors';
import { useMode } from '../lib/mode';
import { uploadVisitPhoto, type CapturedPhoto } from '../lib/photos';
import { queryClient } from '../lib/queryClient';
import { invalidateTables } from '../lib/realtime';
import { rpc, unwrap } from '../lib/rpc';
import { requireSupabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useApp } from '../store/app';
import { useHomeNames, useTiers, useVisit } from '../store/derived';
import { usePricingInputs } from './pricing';
import { OTHER_JOBS, TECH } from './seed';
import { VISIT_SELECT, VISIT_TABLES, mapVisit, type TaskPhotoKind, type TaskVM, type VisitRow, type VisitStatus, type VisitVM } from './visits';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface RouteStats {
  /** Visits on the first visit's day. */
  stops: number;
  /** Tasks on the active job. */
  tasks: number;
  /** `Math.round(stops * 12.7)` */
  miles: number;
}

export interface TechRoute {
  /** Ordered by window start. */
  visits: VisitVM[];
  /** The first visit that isn't done (demo: always the client's visit). */
  active: VisitVM | null;
  stats: RouteStats;
}

export interface TechRouteResult {
  /** Header name, upper case: `'MARCUS REYES'`. */
  techName: string;
  /** `'VAN 214'`, or `''` when the profile has no van number. */
  van: string;
  /** Live: every stop opens its own job. Demo: only the active job opens, as in the prototype. */
  live: boolean;
  data?: TechRoute;
  isLoading: boolean;
  /** Friendly message, only when there's nothing to show. */
  error: string | null;
  refetch: () => void;
}

export interface TechVisitResult {
  /** `null` when the visit doesn't exist or isn't on this tech's route. */
  data: VisitVM | null | undefined;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface TechVisitActions {
  advance: () => void;
  advancing: boolean;
  toggleTask: (task: TaskVM) => void;
  /** A checkbox write is in flight for this task. */
  taskBusy: (taskId: string) => boolean;
  /** "+ Photo" is tappable. */
  canPhoto: boolean;
  /** Call straight from the press handler: on web the file picker must open inside the tap. */
  addPhoto: (task: TaskVM) => void;
  photoBusy: (taskId: string) => boolean;
  complete: () => void;
  completing: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `'Silver Transit van · PHP-214'` → `'VAN 214'`; `''` when there's no trailing number. */
export function vanLabel(vehicle: string | null | undefined): string {
  const m = /(\d+)\s*$/.exec(vehicle ?? '');
  return m ? `VAN ${m[1]}` : '';
}

/** Route time line: today's stops show the window, other days show the day and start ("Sat · Sep 27 · 9:00 AM"). */
export function stopWhen(v: VisitVM, today: string = todayChicago()): string {
  if (!v.windowStart) return v.time;
  return chicagoDate(v.windowStart) === today ? v.time : `${v.day} · ${fmtTime(v.windowStart)}`;
}

export function routeStats(visits: VisitVM[], active: VisitVM | null): RouteStats {
  const dayOf = (v: VisitVM) => (v.windowStart ? chicagoDate(v.windowStart) : '');
  const first = visits[0];
  const stops = first ? visits.filter((v) => dayOf(v) === dayOf(first)).length : 0;
  return { stops, tasks: active?.tasks.length ?? 0, miles: Math.round(stops * 12.7) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How far ahead the route looks. Covers a rescheduled visit and a new client's first visit. */
export const ROUTE_DAYS = 14;

// ---------------------------------------------------------------------------
// Live: queries
// ---------------------------------------------------------------------------

interface RouteData {
  rows: VisitRow[];
  fullName: string | null;
  vehicle: string | null;
}

type Res = { data: unknown; error: unknown; status?: number };

const routeKey = (userId: string | null) => ['tech', 'route', userId] as const;
const visitKey = (id: string | undefined) => ['tech', 'visit', id ?? null] as const;

/**
 * The tech's visits that aren't done, or start today or later (within
 * ROUTE_DAYS), ordered by window start, plus the tech's own name and van.
 */
async function fetchRoute(userId: string): Promise<RouteData> {
  const sb = requireSupabase();
  const today = todayChicago();
  const from = startOfDayChicagoIso(today);
  const until = startOfDayChicagoIso(addDays(today, ROUTE_DAYS));
  const [v, me] = await Promise.all([
    sb
      .from('visits')
      .select(VISIT_SELECT)
      .eq('tech_id', userId)
      .neq('status', 'canceled')
      .or(`status.neq.done,window_start.gte."${from}"`)
      .lt('window_start', until)
      .order('window_start', { ascending: true }),
    sb.from('profiles').select('full_name,vehicle').eq('id', userId).maybeSingle(),
  ]);
  const rows = (unwrap(v as Res) as VisitRow[] | null) ?? [];
  const profile = unwrap(me as Res) as { full_name: string | null; vehicle: string | null } | null;
  return { rows, fullName: profile?.full_name ?? null, vehicle: profile?.vehicle ?? null };
}

async function fetchVisit(id: string): Promise<VisitRow | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await requireSupabase().from('visits').select(VISIT_SELECT).eq('id', id).neq('status', 'canceled').maybeSingle();
  return (unwrap(res as Res) as VisitRow | null) ?? null;
}

/** Labor minutes for durations; defaults if pricing can't load (only the minute labels depend on it). */
function useMins(): LaborMinutes | null {
  const p = usePricingInputs();
  if (p.data) return p.data.mins;
  return p.isLoading ? null : DEFAULT_MINUTES;
}

// Checkbox writes in flight, layered over fetched rows so a poll landing
// mid-write can't flip a box back. Cleared once the server state is refetched.
const usePendingTasks = create<{ done: Record<string, boolean> }>(() => ({ done: {} }));
function setPendingTask(taskId: string, value: boolean | null) {
  usePendingTasks.setState((s) => {
    const done = { ...s.done };
    if (value === null) delete done[taskId];
    else done[taskId] = value;
    return { done };
  });
}

// Photo uploads in flight, by task id. Kept outside the screen so leaving and
// reopening the job mid-upload still shows "Uploading…".
const useUploads = create<{ busy: Record<string, true> }>(() => ({ busy: {} }));
function setUploading(taskId: string, on: boolean) {
  useUploads.setState((s) => {
    const busy = { ...s.busy };
    if (on) busy[taskId] = true;
    else delete busy[taskId];
    return { busy };
  });
}

function withPending(v: VisitVM, pending: Record<string, boolean>): VisitVM {
  if (!v.tasks.some((t) => t.id in pending)) return v;
  const tasks = v.tasks.map((t) => (t.id in pending ? { ...t, done: pending[t.id] } : t));
  return { ...v, tasks, doneCount: tasks.filter((t) => t.done).length };
}

function useLiveTechRoute(): TechRouteResult {
  const { userId, profile } = useSession();
  const mins = useMins();
  const pending = usePendingTasks((s) => s.done);
  const q = useQuery({
    queryKey: routeKey(userId),
    queryFn: () => fetchRoute(userId!),
    enabled: !!userId,
    meta: { tables: VISIT_TABLES },
  });
  const rows = q.data?.rows;
  const data = useMemo<TechRoute | undefined>(() => {
    if (!rows || !mins) return undefined;
    const visits = rows.map((r) => withPending(mapVisit(r, mins), pending));
    const active = visits.find((v) => v.status !== 'done') ?? null;
    return { visits, active, stats: routeStats(visits, active) };
  }, [rows, mins, pending]);
  const name = (q.data?.fullName?.trim() || profile?.fullName || '').toUpperCase();
  const van = vanLabel(q.data?.vehicle);
  const error = !data && q.error ? friendlyError(q.error) : null;
  const refetch = q.refetch;
  return {
    techName: name,
    van,
    live: true,
    data,
    isLoading: !data && !error,
    error,
    refetch: () => void refetch(),
  };
}

function useLiveTechVisit(idParam: string | undefined): TechVisitResult {
  const { userId } = useSession();
  const mins = useMins();
  const pending = usePendingTasks((s) => s.done);
  // No id in the URL (a deep link to /tech/job): open the active job from the route.
  const routeQ = useQuery({
    queryKey: routeKey(userId),
    queryFn: () => fetchRoute(userId!),
    enabled: !idParam && !!userId,
    meta: { tables: VISIT_TABLES },
  });
  const fallbackId = routeQ.data ? (routeQ.data.rows.find((r) => r.status !== 'done') ?? routeQ.data.rows[0])?.id ?? null : undefined;
  const id = idParam ?? fallbackId ?? undefined;
  const q = useQuery({
    queryKey: visitKey(id),
    queryFn: () => fetchVisit(id!),
    enabled: !!id,
    meta: { tables: VISIT_TABLES },
    // Opened from the route: show the row we already have while the visit loads.
    placeholderData: () => {
      if (!id) return undefined;
      const cached = queryClient.getQueryData<RouteData>(routeKey(userId));
      return cached?.rows.find((r) => r.id === id);
    },
  });
  const row = q.data;
  const data = useMemo<VisitVM | null | undefined>(() => {
    if (row === null) return null;
    if (!row || !mins) return undefined;
    return withPending(mapVisit(row, mins), pending);
  }, [row, mins, pending]);

  // An empty route with no id means there's nothing to open.
  if (!idParam && fallbackId === null) {
    return { data: null, isLoading: false, error: null, refetch: () => void routeQ.refetch() };
  }
  const srcError = !idParam && !routeQ.data ? routeQ.error : q.error;
  const error = data === undefined && srcError ? friendlyError(srcError) : null;
  return {
    data,
    isLoading: data === undefined && !error,
    error,
    refetch: () => {
      if (!idParam && !routeQ.data) void routeQ.refetch();
      else void q.refetch();
    },
  };
}

// ---------------------------------------------------------------------------
// Live: mutations
// ---------------------------------------------------------------------------

/** Patch a visit row in every tech cache (route + visit) until the refetch lands. */
function patchVisitRow(visitId: string, patch: (r: VisitRow) => VisitRow) {
  queryClient.setQueriesData<VisitRow | null>({ queryKey: ['tech', 'visit', visitId] }, (old) => (old ? patch(old) : old));
  queryClient.setQueriesData<RouteData>({ queryKey: ['tech', 'route'] }, (old) =>
    old ? { ...old, rows: old.rows.map((r) => (r.id === visitId ? patch(r) : r)) } : old,
  );
}

function patchTaskRow(taskId: string, done: boolean) {
  const patch = (r: VisitRow): VisitRow =>
    r.visit_tasks?.some((t) => t.id === taskId) ? { ...r, visit_tasks: r.visit_tasks.map((t) => (t.id === taskId ? { ...t, done } : t)) } : r;
  queryClient.setQueriesData<VisitRow | null>({ queryKey: ['tech', 'visit'] }, (old) => (old ? patch(old) : old));
  queryClient.setQueriesData<RouteData>({ queryKey: ['tech', 'route'] }, (old) => (old ? { ...old, rows: old.rows.map(patch) } : old));
}

/** scheduled → enroute (notifies the client) → onsite. */
export async function advanceVisit(visitId: string): Promise<void> {
  const row = await rpc<{ status?: string } | null>('advance_visit', { p_visit: visitId });
  if (row?.status) patchVisitRow(visitId, (r) => ({ ...r, status: row.status! }));
  await invalidateTables(['visits', 'notices']);
}

/** Check a task off (or back on). Only while the visit is on site. */
export async function setTaskDone(taskId: string, done: boolean): Promise<void> {
  await rpc('set_task_done', { p_task: taskId, p_done: done });
  patchTaskRow(taskId, done);
  await invalidateTables(['visit_tasks']);
}

/** Upload a captured photo for a task and record it (add_visit_photo). */
export async function addPhoto({ visitId, task, photo }: { visitId: string; task: TaskVM; photo: CapturedPhoto }): Promise<void> {
  await uploadVisitPhoto({ visitId, taskId: task.id, kind: task.photoKind, photo });
  await invalidateTables(['visit_photos']);
}

/** Finish the visit and publish the report. Idempotent on the server. */
export async function completeVisit(visitId: string): Promise<void> {
  const report = await rpc<{ id?: string } | null>('complete_visit', { p_visit: visitId });
  patchVisitRow(visitId, (r) => ({ ...r, status: 'done', reports: report?.id ? { id: report.id } : r.reports }));
  await invalidateTables(['visits', 'reports', 'notices']);
}

const toastError = (e: unknown) => toast(friendlyError(e), 'brick');

function useLiveActions(visit: VisitVM | undefined): TechVisitActions {
  const { capture } = usePhotoCapture();
  const pending = usePendingTasks((s) => s.done);
  const uploads = useUploads((s) => s.busy);
  // On failure, resync with the server too (e.g. the office already moved the visit on).
  const advanceM = useMutation({
    mutationFn: advanceVisit,
    onError: (e) => {
      toastError(e);
      void invalidateTables(['visits']);
    },
  });
  const completeM = useMutation({
    mutationFn: completeVisit,
    onError: (e) => {
      toastError(e);
      void invalidateTables(['visits', 'visit_tasks', 'reports']);
    },
  });
  const status = visit?.status;

  return {
    advance: () => {
      if (visit && !advanceM.isPending) advanceM.mutate(visit.id);
    },
    advancing: advanceM.isPending,
    toggleTask: (task) => {
      if (task.id in usePendingTasks.getState().done) return;
      const next = !task.done;
      setPendingTask(task.id, next);
      setTaskDone(task.id, next)
        .catch((e) => {
          toastError(e);
          void invalidateTables(['visits', 'visit_tasks']);
        })
        .finally(() => setPendingTask(task.id, null));
    },
    taskBusy: (taskId) => taskId in pending,
    canPhoto: status === 'onsite' || status === 'done',
    addPhoto: (task) => {
      if (!visit || useUploads.getState().busy[task.id]) return;
      const visitId = visit.id;
      let picked: Promise<CapturedPhoto | null>;
      try {
        // No await before this: on web the picker has to open inside the tap.
        picked = capture({ title: task.name });
      } catch (e) {
        toastError(e);
        return;
      }
      picked
        .then(async (photo) => {
          if (!photo) return; // cancelled
          setUploading(task.id, true);
          try {
            await addPhoto({ visitId, task, photo });
          } finally {
            setUploading(task.id, false);
          }
        })
        .catch(toastError);
    },
    photoBusy: (taskId) => !!uploads[taskId],
    complete: () => {
      if (visit && !completeM.isPending) completeM.mutate(visit.id);
    },
    completing: completeM.isPending,
  };
}

// ---------------------------------------------------------------------------
// Demo adapters (the shared zustand store, exactly as before)
// ---------------------------------------------------------------------------

const DEMO_VISIT_ID = 'demo-visit';
const DEMO_NOTES = 'Gate code 4471. Heater in garage, back left.';
const DEMO_PHOTO_KIND: Record<PhotoKind, TaskPhotoKind> = { dirty: 'before', clean: 'after', ice: 'after', drain: 'drain' };

function useDemoVisitVM(): VisitVM {
  const visit = useVisit();
  const { cur } = useTiers();
  const { name, firstName, street, addr } = useHomeNames();
  const s = useApp(
    useShallow((x) => ({ tech: x.tech, pets: x.pets, tier: x.tier, confirmed: x.confirmed, done: x.done, shots: x.shots, report: x.report, reminders: x.reminders })),
  );
  return useMemo<VisitVM>(() => {
    const tasks: TaskVM[] = visit.tasks.map((t) => ({
      id: t.id,
      key: t.id,
      name: t.name,
      short: t.short,
      part: t.part,
      min: t.min,
      done: !!s.done[t.id],
      photoKind: DEMO_PHOTO_KIND[t.photo],
      photos: s.shots[t.id] ? [{ id: `demo-${t.id}`, kind: DEMO_PHOTO_KIND[t.photo], path: '' }] : [],
    }));
    return {
      id: DEMO_VISIT_ID,
      homeId: 'demo-home',
      status: s.tech as VisitStatus,
      confirmed: s.confirmed,
      windowStart: '',
      windowEnd: '',
      day: visit.day,
      time: visit.time,
      duration: visit.duration,
      client: { name, firstName, street, address: addr, pets: s.pets, notes: DEMO_NOTES },
      tierIndex: s.tier,
      tierName: cur.name,
      tech: { id: 'demo-tech', name: TECH.name, firstName: TECH.name.split(' ')[0], initials: TECH.initials, title: TECH.title, van: TECH.van },
      tasks,
      doneCount: visit.doneCount,
      notices: { d7: true, h48: s.reminders, dayOf: s.tech !== 'scheduled', report: s.report },
      reportId: s.report ? 'demo-report' : null,
      offeredSlots: [],
    };
  }, [visit, cur.name, name, firstName, street, addr, s]);
}

/** The prototype's two other stops, as dimmed, read-only visits. */
const DEMO_OTHERS: VisitVM[] = OTHER_JOBS.map((j, i) => ({
  id: `demo-other-${i}`,
  homeId: '',
  status: 'scheduled',
  confirmed: true,
  windowStart: '',
  windowEnd: '',
  day: '',
  time: j.time,
  duration: '',
  client: { name: j.name, firstName: j.name.split(' ')[0], street: j.addr, address: j.addr, pets: false, notes: '' },
  tierIndex: 0,
  tierName: j.tier,
  tech: null,
  tasks: [],
  doneCount: 0,
  notices: { d7: true, h48: false, dayOf: false, report: false },
  reportId: null,
  offeredSlots: [],
}));

function useDemoTechRoute(): TechRouteResult {
  const visit = useDemoVisitVM();
  const data = useMemo<TechRoute>(() => {
    const visits = [visit, ...DEMO_OTHERS];
    return { visits, active: visit, stats: routeStats(visits, visit) };
  }, [visit]);
  return {
    techName: TECH.name.toUpperCase(),
    van: vanLabel(TECH.van),
    live: false,
    data,
    isLoading: false,
    error: null,
    refetch: () => {},
  };
}

function useDemoTechVisit(_id: string | undefined): TechVisitResult {
  const data = useDemoVisitVM();
  return { data, isLoading: false, error: null, refetch: () => {} };
}

function useDemoActions(_visit: VisitVM | undefined): TechVisitActions {
  const { tech, techAdvance, toggleTask, togglePhoto, completeVisit: complete } = useApp(
    useShallow((s) => ({ tech: s.tech, techAdvance: s.techAdvance, toggleTask: s.toggleTask, togglePhoto: s.togglePhoto, completeVisit: s.completeVisit })),
  );
  return {
    advance: techAdvance,
    advancing: false,
    toggleTask: (t) => toggleTask(t.id),
    taskBusy: () => false,
    canPhoto: tech === 'onsite',
    addPhoto: (t) => togglePhoto(t.id),
    photoBusy: () => false,
    complete,
    completing: false,
  };
}

// ---------------------------------------------------------------------------
// Mode-dispatching hooks (the mode is fixed per mount: the root keys on it)
// ---------------------------------------------------------------------------

/** Today's route: visits, the active job and the header stats. */
export function useTechRoute(): TechRouteResult {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveTechRoute : useDemoTechRoute;
  return useImpl();
}

/** One visit by id (live; without an id, the active job). Demo ignores the id. */
export function useTechVisit(id: string | undefined): TechVisitResult {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveTechVisit : useDemoTechVisit;
  return useImpl(id);
}

/** The job screen's buttons: advance, checklist, photos and complete. */
export function useTechVisitActions(visit: VisitVM | undefined): TechVisitActions {
  const { mode } = useMode();
  const useImpl = mode === 'live' ? useLiveActions : useDemoActions;
  return useImpl(visit);
}
