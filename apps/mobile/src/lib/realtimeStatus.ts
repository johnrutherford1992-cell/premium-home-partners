// Realtime channel health, kept apart from realtime.tsx so the query client
// can read it without an import cycle.

import { useSyncExternalStore } from 'react';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

let status: RealtimeStatus = 'offline';
const listeners = new Set<() => void>();

export function setRealtimeStatus(next: RealtimeStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((l) => l());
}

export function getRealtimeStatus(): RealtimeStatus {
  return status;
}

/** True only while the channel is SUBSCRIBED. Queries poll every 15 s then, 3 s otherwise. */
export function realtimeHealthy(): boolean {
  return status === 'live';
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribe, getRealtimeStatus, getRealtimeStatus);
}
