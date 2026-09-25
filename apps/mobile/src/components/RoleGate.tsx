import { Redirect, router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ROLE_HOME, useSession, type Role } from '../lib/auth';
import { useMode } from '../lib/mode';
import { Screen, TextLink } from '../ui/controls';
import { usePalette } from '../ui/theme';
import { ErrorState } from './States';

/** Blank field, shown while the session resolves. */
export function BlankField() {
  const c = usePalette();
  return <View style={{ flex: 1, backgroundColor: c.field }} />;
}

/** Signed in, but the profile couldn't be loaded: retry or sign out. */
export function SessionErrorScreen() {
  const { profileError, refreshProfile, signOut } = useSession();
  return (
    <Screen>
      <ErrorState title="We couldn't load your account" message={profileError ?? "Can't reach the server. Retrying…"} onRetry={refreshProfile} />
      <TextLink
        onPress={() => {
          void signOut();
          router.replace('/login');
        }}
      >
        Sign out
      </TextLink>
    </Screen>
  );
}

/**
 * Guards a role's screens. Offline demo: renders children. Live: blank field
 * while loading, signed-out users go to /login, other roles go to their own home.
 */
export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { mode } = useMode();
  const s = useSession();
  if (mode === 'demo') return <>{children}</>;
  if (s.status === 'loading') return <BlankField />;
  if (s.status === 'signedOut') return <Redirect href="/login" />;
  if (!s.profile) return <SessionErrorScreen />;
  if (s.profile.role !== role) return <Redirect href={ROLE_HOME[s.profile.role]} />;
  return <>{children}</>;
}
