import { Redirect, router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { BlankField, SessionErrorScreen } from '../components/RoleGate';
import { ROLE_HOME, useSession } from '../lib/auth';
import { useMode } from '../lib/mode';
import { isSupabaseConfigured } from '../lib/supabase';
import { useApp } from '../store/app';
import { useHomeNames, useTiers } from '../store/derived';
import { Row, Screen } from '../ui/controls';
import { Display, LqBadge, LqButton, LqCard, Mono, Txt } from '../ui/primitives';

const ROLES = [
  { href: '/homeowner', title: 'Homeowner app', sub: 'Onboard a home, choose coverage, track visits, request add-on quotes.' },
  { href: '/tech', title: 'Technician app', sub: "Today's route, start driving, photo checklist, send the report." },
  { href: '/vendor', title: 'Vendor quote portal', sub: 'Bid on add-on requests from Premium Home clients.' },
  { href: '/office', title: 'Office console', sub: 'Tier pricing calculator, dispatch and brokered quotes.' },
] as const;

export default function Index() {
  const { mode } = useMode();
  return mode === 'live' ? <LiveHome /> : <Launcher />;
}

/** Live mode: route by session and role. */
function LiveHome() {
  const s = useSession();
  if (s.status === 'loading') return <BlankField />;
  if (s.status === 'signedOut') return <Redirect href="/login" />;
  if (!s.profile) return <SessionErrorScreen />;
  return <Redirect href={ROLE_HOME[s.profile.role]} />;
}

/** Offline demo: the four apps on one device, sharing the local store. */
function Launcher() {
  const { dark, set, reset, step, tech, reqs } = useApp();
  const { setMode, forced } = useMode();
  const { cur } = useTiers();
  const { street } = useHomeNames();
  const status: Record<string, string> = {
    '/homeowner': step >= 6 ? `${street} · ${cur.name}` : step > 0 ? `Onboarding · step ${step} of 5` : 'Not set up',
    '/tech': { scheduled: 'Visit scheduled', enroute: 'En route', onsite: 'On site', done: 'Visit complete' }[tech],
    '/vendor': `${reqs.filter((r) => r.booked == null).length} open requests`,
    '/office': `${cur.name} ${cur.monthlyTxt}/mo`,
  };
  return (
    <Screen>
      <View style={{ gap: 6, marginTop: 8 }}>
        <Row>
          <Mono size={11} medium tracking={0.12} muted>
            PREMIUM HOME PARTNERS
          </Mono>
          <LqBadge tone="ochre">OFFLINE DEMO</LqBadge>
        </Row>
        <Display size={40}>One home, four apps</Display>
        <Txt size={14} muted style={{ lineHeight: 21 }}>
          What you do in one app shows up in the others. Onboard a home, start a visit from the Technician app, bid from the Vendor
          app, and change labor rates in the Office. Prices update everywhere.
        </Txt>
      </View>
      <Row style={{ gap: 10, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <LqButton variant="ghost" onPress={() => set({ dark: !dark })}>
          {dark ? 'Light mode' : 'Dark mode'}
        </LqButton>
        <LqButton variant="ghost" onPress={reset}>
          Reset demo
        </LqButton>
        {/* Only when live mode is possible: a forced demo (no project, or EXPO_PUBLIC_DEMO_MODE=1) has nowhere to exit to. */}
        {isSupabaseConfigured && !forced ? (
          <LqButton
            variant="ghost"
            onPress={() => {
              setMode('live');
              router.replace('/login');
            }}
          >
            Exit offline demo
          </LqButton>
        ) : null}
      </Row>
      {ROLES.map((r) => (
        <Pressable key={r.href} testID={`launch-${r.href.slice(1)}`} onPress={() => router.push(r.href)} accessibilityRole="link">
          <LqCard style={{ gap: 6 }}>
            <Row>
              <Txt size={16} weight="600">
                {r.title}
              </Txt>
              <Txt accent size={16}>
                ›
              </Txt>
            </Row>
            <Txt size={13} muted style={{ lineHeight: 19 }}>
              {r.sub}
            </Txt>
            <LqBadge tone="slate">{status[r.href]}</LqBadge>
          </LqCard>
        </Pressable>
      ))}
      <Txt size={12} muted style={{ lineHeight: 18 }}>
        Demo mode: all four roles share this device's state. Prices, suppliers and research are sample data.
      </Txt>
    </Screen>
  );
}
