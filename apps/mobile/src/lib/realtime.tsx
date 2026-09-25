// Realtime is an accelerator, polling is the floor. Postgres changes only
// invalidate React Query caches; every query also polls (see queryClient.ts).

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { useSession } from './auth';
import { queryClient } from './queryClient';
import { setRealtimeStatus } from './realtimeStatus';
import { supabase } from './supabase';

export { realtimeHealthy, useRealtimeStatus, type RealtimeStatus } from './realtimeStatus';

/** Tables in the `supabase_realtime` publication (docs/LIVE_ARCHITECTURE.md §4). */
export const REALTIME_TABLES = [
  'visits',
  'visit_tasks',
  'quote_requests',
  'bids',
  'plan_builds',
  'pricing_settings',
  'task_defaults',
  'reports',
  'visit_photos',
  'notices',
] as const;

/**
 * Refetch every query whose `meta.tables` intersects `tables`. Call it after
 * every successful RPC so the actor's own UI updates without waiting for Realtime.
 */
export function invalidateTables(tables: readonly string[]): Promise<void> {
  if (!tables.length) return Promise.resolve();
  const want = new Set(tables);
  return queryClient.invalidateQueries({
    predicate: (q) => {
      const t = q.meta?.tables;
      return Array.isArray(t) && t.some((x) => want.has(x));
    },
  });
}

// Realtime events arrive in bursts (a demo reset touches every table), so
// they are coalesced into one invalidation per 60 ms.
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function queueInvalidate(table: string) {
  pending.add(table);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const tables = [...pending];
    pending = new Set();
    flushTimer = null;
    void invalidateTables(tables);
  }, 60);
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 10_000];

/**
 * One channel for every public table while signed in. Mounted by the root
 * layout in live mode; it tears down and rebuilds whenever the user changes,
 * so RLS evaluates against the new JWT.
 */
export function RealtimeBridge() {
  const { status, userId } = useSession();
  const active = status === 'signedIn' && !!userId;

  useEffect(() => {
    const sb = supabase;
    if (!sb || !active) {
      setRealtimeStatus('offline');
      return;
    }
    let disposed = false;
    let attempt = 0;
    let wasLive = false;
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const teardown = () => {
      if (channel) {
        const ch = channel;
        channel = null;
        void sb.removeChannel(ch);
      }
    };

    const scheduleRetry = () => {
      if (disposed || retry) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(() => {
        retry = null;
        teardown();
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      setRealtimeStatus('connecting');
      const ch = sb
        .channel(`php-live:${userId}:${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
          if (payload.table) queueInvalidate(payload.table);
        });
      channel = ch;
      ch.subscribe((st) => {
        if (disposed || channel !== ch) return;
        if (st === 'SUBSCRIBED') {
          attempt = 0;
          setRealtimeStatus('live');
          // After a reconnect, catch up on anything that changed while the socket was down.
          if (wasLive) void invalidateTables([...REALTIME_TABLES]);
          wasLive = true;
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          // CLOSED here is the server closing our channel (a realtime node
          // restart, a kick): our own teardown sets `channel` to null first, so
          // it never reaches this line. realtime-js won't rejoin a closed
          // channel, so resubscribe with backoff, the same as an error.
          setRealtimeStatus('offline');
          scheduleRetry();
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      teardown();
      setRealtimeStatus('offline');
    };
  }, [active, userId]);

  return null;
}
