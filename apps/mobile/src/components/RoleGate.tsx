import { Redirect, router, usePathname } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { ROLE_HOME, useSession, type Role } from '../lib/auth';
import { DEMO_ACCESS, ROLE_ACCOUNT, useDemoAccess } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { Screen, TextLink } from '../ui/controls';
import { usePalette } from '../ui/theme';
import { ErrorState } from './States';

/** Blank field, shown while the session resolves. */
export function BlankField() {
  const c = usePalette();
  return <View style={{ flex: 1, backgroundColor: c.field }} />;
}

/**
 * Signed in, but the profile couldn't be loaded: retry, or leave. With demo
 * access, leaving means the launcher (signed out locally, so the launcher's
 * next switch starts clean); otherwise it signs out to /login.
 */
export function SessionErrorScreen() {
  const { profileError, refreshProfile, signOut } = useSession();
  return (
    <Screen>
      <ErrorState title="We couldn't load your account" message={profileError ?? "Can't reach the server. Retrying…"} onRetry={refreshProfile} />
      <TextLink
        onPress={() => {
          void signOut();
          router.replace(DEMO_ACCESS ? '/' : '/login');
        }}
      >
        {DEMO_ACCESS ? '‹ All apps' : 'Sign out'}
      </TextLink>
    </Screen>
  );
}

/**
 * Guards a role's screens. Offline demo: renders children. Live, login-gated
 * (EXPO_PUBLIC_DEMO_ACCESS=0): blank field while loading, signed-out users go
 * to /login, other roles go to their own home. Live with demo access: a
 * signed-out tab or another role switches to this role's demo account first,
 * so a deep link like /tech opens the technician app in a fresh tab.
 */
export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { mode } = useMode();
  if (mode === 'demo') return <>{children}</>;
  return DEMO_ACCESS ? <SwitchingGate role={role}>{children}</SwitchingGate> : <LoginGate role={role}>{children}</LoginGate>;
}

function LoginGate({ role, children }: { role: Role; children: ReactNode }) {
  const s = useSession();
  if (s.status === 'loading') return <BlankField />;
  if (s.status === 'signedOut') return <Redirect href="/login" />;
  if (!s.profile) return <SessionErrorScreen />;
  if (s.profile.role !== role) return <Redirect href={ROLE_HOME[s.profile.role]} />;
  return <>{children}</>;
}

function SwitchingGate({ role, children }: { role: Role; children: ReactNode }) {
  const s = useSession();
  const { switchTo, switching } = useDemoAccess();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const home = ROLE_HOME[role];
  // Only the screen on display switches: a guard still mounted behind the
  // launcher (closing animation, a hidden stack screen) must not fight it.
  const onScreen = pathname === home || pathname.startsWith(`${home}/`);
  // Any account with this role will do (Jordan counts as a homeowner).
  const needSwitch = s.status === 'signedOut' || (s.status === 'signedIn' && !!s.profile && s.profile.role !== role);
  const account = ROLE_ACCOUNT[role];

  useEffect(() => {
    if (!needSwitch || !onScreen || error) return;
    let alive = true;
    void switchTo(account).then((r) => {
      if (alive && r.error) setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [needSwitch, onScreen, error, attempt, account, switchTo]);

  if (error) {
    return (
      <Screen>
        <ErrorState
          title="We couldn't open this app"
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
        <View testID="app-exit" style={{ alignSelf: 'flex-start' }}>
          <TextLink onPress={() => router.replace('/')}>‹ All apps</TextLink>
        </View>
      </Screen>
    );
  }
  if (switching || needSwitch || s.status === 'loading') return <BlankField />;
  if (!s.profile) return <SessionErrorScreen />;
  return <>{children}</>;
}
