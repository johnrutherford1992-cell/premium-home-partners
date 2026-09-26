import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { BrandHeader } from '../components/brand/BrandHeader';
import { BlankField, SessionErrorScreen } from '../components/RoleGate';
import { ErrorState } from '../components/States';
import { ROLE_HOME, useSession } from '../lib/auth';
import { DEMO_ACCESS, DEMO_ACCOUNTS, useDemoAccess, type DemoAccount } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { isSupabaseConfigured } from '../lib/supabase';
import { useApp } from '../store/app';
import { useHomeNames, useTiers } from '../store/derived';
import { Row, Screen, TextLink, Toggle } from '../ui/controls';
import { LqBadge, LqButton, LqCard, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

const ROLES = [
  { href: '/homeowner', title: 'Homeowner app', sub: 'Onboard a home, choose coverage, track visits, request add-on quotes.' },
  { href: '/tech', title: 'Technician app', sub: "Today's route, start driving, photo checklist, send the report." },
  { href: '/vendor', title: 'Vendor quote portal', sub: 'Bid on add-on requests from Premium Home clients.' },
  { href: '/office', title: 'Office console', sub: 'Tier pricing calculator, dispatch and brokered quotes.' },
] as const;

export default function Index() {
  const { mode } = useMode();
  if (mode !== 'live') return <Launcher />;
  return DEMO_ACCESS ? <LiveLauncher /> : <LiveHome />;
}

/** Live and login-gated (EXPO_PUBLIC_DEMO_ACCESS=0): route by session and role. */
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
      <BrandHeader
        eyebrow="Your private home concierge"
        title="One home, four apps"
        titleSize={34}
        right={<LqBadge tone="ochre">OFFLINE DEMO</LqBadge>}
        sub="What you do in one app shows up in the others. Onboard a home, start a visit from the Technician app, bid from the Vendor app, and change labor rates in the Office. Prices update everywhere."
      />
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
              // With demo access the live launcher needs no login.
              router.replace(DEMO_ACCESS ? '/' : '/login');
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

// ---------------------------------------------------------------------------
// Live launcher (demo access): every side opens without a password
// ---------------------------------------------------------------------------

interface LiveCard {
  /** testID `launch-<key>`. */
  key: DemoAccount | 'signup';
  title: string;
  sub: string;
  who: string;
}

const LIVE_CARDS: readonly LiveCard[] = [
  { key: 'homeowner', title: 'Homeowner app', sub: 'Track visits, choose coverage, request add-on quotes.', who: 'Elena Alvarez · 12 Linden Court' },
  { key: 'signup', title: 'New customer', sub: 'Sign up and set up a home: address, appliances, a plan.', who: 'Starts a new sign-up' },
  { key: 'tech', title: 'Technician app', sub: "Today's route, start driving, photo checklist, send the report.", who: 'Marcus Reyes' },
  { key: 'vendor', title: 'Vendor quote portal', sub: 'Bid on add-on requests from Premium Home clients.', who: 'Evergreen Outdoor Co.' },
  { key: 'office', title: 'Office console', sub: 'Tier pricing calculator, dispatch and brokered quotes.', who: 'Avery Brooks' },
];

/**
 * Live mode's launcher: the same layout as the offline one, on live data.
 * Tapping a side switches this tab to its demo account (see lib/demoAccess)
 * and opens it; "‹ All apps" in any app comes back here.
 */
function LiveLauncher() {
  const { switchTo } = useDemoAccess();
  const { setMode } = useMode();
  const { dark, set } = useApp(useShallow((s) => ({ dark: s.dark, set: s.set })));
  const c = usePalette();
  const [opening, setOpening] = useState<DemoAccount | null>(null);
  const [failed, setFailed] = useState<{ key: DemoAccount; message: string } | null>(null);
  // The latest tap wins: an earlier tap's switch that finishes late never navigates.
  const lastTap = useRef<LiveCard['key'] | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const open = (key: LiveCard['key']) => {
    lastTap.current = key;
    setFailed(null);
    if (key === 'signup') {
      setOpening(null);
      router.push('/signup');
      return;
    }
    setOpening(key);
    void switchTo(key).then((r) => {
      if (!alive.current || lastTap.current !== key || r.superseded) return;
      setOpening(null);
      if (r.error) {
        setFailed({ key, message: r.error });
        return;
      }
      router.replace(ROLE_HOME[DEMO_ACCOUNTS[key].role]);
    });
  };

  return (
    <Screen>
      <BrandHeader
        eyebrow="Your private home concierge"
        title="One home, four apps"
        titleSize={34}
        right={<LqBadge tone="forest">LIVE</LqBadge>}
        sub="Every app runs on live data. What you do in one shows up in the others within seconds, on this device or any other."
      />
      <Row style={{ gap: 10, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <LqButton variant="ghost" onPress={() => set({ dark: !dark })}>
          {dark ? 'Light mode' : 'Dark mode'}
        </LqButton>
      </Row>
      {LIVE_CARDS.map((card) => {
        const busy = card.key !== 'signup' && opening === card.key;
        const err = failed && failed.key === card.key ? failed : null;
        return (
          <View key={card.key} style={{ gap: 10 }}>
            <Pressable
              testID={`launch-${card.key}`}
              onPress={() => open(card.key)}
              accessibilityRole="link"
              accessibilityState={{ busy }}
              accessibilityLabel={`${card.title}: ${busy ? 'Opening…' : card.who}`}
            >
              <LqCard style={{ gap: 6 }}>
                <Row>
                  <Txt size={16} weight="600">
                    {card.title}
                  </Txt>
                  <Txt accent size={16}>
                    ›
                  </Txt>
                </Row>
                <Txt size={13} muted style={{ lineHeight: 19 }}>
                  {card.sub}
                </Txt>
                <LqBadge tone={busy ? 'ochre' : 'slate'}>{busy ? 'Opening…' : card.who}</LqBadge>
              </LqCard>
            </Pressable>
            {err ? (
              <View testID="launch-error" style={{ gap: 8 }}>
                <ErrorState title={`We couldn't open the ${card.title}`} message={err.message} onRetry={() => open(err.key)} />
                <Txt size={12} muted style={{ lineHeight: 18 }}>
                  No connection? Turn on Offline demo mode below to run all four apps on this device.
                </Txt>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
        <Pressable
          testID="demo-mode-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: false }}
          accessibilityLabel="Offline demo mode"
          onPress={() => {
            setMode('demo');
            router.replace('/');
          }}
        >
          <Row style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt>Offline demo mode</Txt>
              <Txt size={12} muted style={{ lineHeight: 17 }}>
                All four apps on this device, no account or connection needed.
              </Txt>
            </View>
            <Toggle on={false} />
          </Row>
        </Pressable>
      </View>
      <Txt size={12} muted style={{ lineHeight: 18 }}>
        Each app signs in to its demo account for you. Use ‹ All apps inside any app to come back here.
      </Txt>
      <TextLink onPress={() => router.push('/login')}>Sign in with email</TextLink>
    </Screen>
  );
}
