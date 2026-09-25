import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { realtimeHealthy } from './realtimeStatus';

declare module '@tanstack/react-query' {
  interface Register {
    /** Every live query lists the tables it reads, so invalidateTables() can find it. */
    queryMeta: { tables?: readonly string[] };
  }
}

/**
 * The one QueryClient. Realtime only invalidates; polling is the floor
 * (15 s while the realtime channel is healthy, 3 s while it isn't).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 2_000,
      refetchOnWindowFocus: true,
      refetchInterval: () => (realtimeHealthy() ? 15_000 : 3_000),
    },
  },
});

// On native, "window focus" means the app returning to the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
}
