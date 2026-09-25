// Live vs offline-demo mode. Persisted per device under `php-mode-v1`.
// The root layout waits for `hydrated`, then keys the whole tree on `mode`,
// so data hooks can pick their live or demo implementation once per mount.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { isSupabaseConfigured } from './supabase';

export type Mode = 'live' | 'demo';

/** Demo is forced when no Supabase project is configured or EXPO_PUBLIC_DEMO_MODE=1. */
export const MODE_FORCED = !isSupabaseConfigured || process.env.EXPO_PUBLIC_DEMO_MODE === '1';

interface ModeState {
  mode: Mode;
  hydrated: boolean;
  setMode: (m: Mode) => void;
}

const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: 'live',
      hydrated: false,
      setMode: (m) => set({ mode: m }),
    }),
    {
      name: 'php-mode-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ mode: s.mode }),
      // Mark hydrated even when storage fails, so the app never stays blank.
      onRehydrateStorage: () => () => {
        useModeStore.setState({ hydrated: true });
      },
    },
  ),
);

// Belt and braces: if storage never answers, show the app after 1.5 s anyway.
setTimeout(() => {
  if (!useModeStore.getState().hydrated) useModeStore.setState({ hydrated: true });
}, 1500);

export function useMode(): { mode: Mode; hydrated: boolean; forced: boolean; setMode: (m: Mode) => void } {
  const s = useModeStore(useShallow((x) => ({ mode: x.mode, hydrated: x.hydrated, setMode: x.setMode })));
  return {
    mode: MODE_FORCED ? 'demo' : s.mode,
    hydrated: MODE_FORCED || s.hydrated,
    forced: MODE_FORCED,
    setMode: s.setMode,
  };
}

/** Current mode outside React (event handlers, fetchers). */
export function getMode(): Mode {
  return MODE_FORCED ? 'demo' : useModeStore.getState().mode;
}

export function setMode(m: Mode) {
  useModeStore.getState().setMode(m);
}
