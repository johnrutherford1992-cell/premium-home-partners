import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlankField } from '../../../components/RoleGate';
import { ErrorState } from '../../../components/States';
import { useMyHome } from '../../../data/homeowner';
import { useMode } from '../../../lib/mode';
import { useApp } from '../../../store/app';
import { RADIUS } from '../../../theme/tokens';
import { Screen } from '../../../ui/controls';
import { Txt } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';

const LABELS: Record<string, string> = { home: 'Home', plan: 'Plan', reports: 'Reports', services: 'Services' };

/**
 * Floating tab bar in the site's navy band: 62pt tall, 16pt inset, 24pt from the
 * bottom. Labels are tracked uppercase like the site's nav; the current tab is underlined.
 */
function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(24, insets.bottom + 8), alignItems: 'center' }}>
      <View
        style={{
          width: '100%',
          maxWidth: 408,
          paddingHorizontal: 16,
        }}
      >
        <View
          style={{
            height: 62,
            borderRadius: RADIUS.tabBar,
            overflow: 'hidden',
            backgroundColor: c.band,
            borderWidth: c.dark ? 1 : 0,
            borderColor: c.rule,
            boxShadow: `0 10px 24px -14px ${c.sh}`,
            flexDirection: 'row',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}
        >
          {state.routes.map((r, i) => {
            const on = state.index === i;
            return (
              <Pressable
                key={r.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
                  if (!on && !e.defaultPrevented) navigation.navigate(r.name, r.params);
                }}
                style={{ alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 44, paddingTop: 7, paddingHorizontal: 10 }}
              >
                <Txt size={11} weight="600" color={on ? c.bandInk : c.bandMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                  {LABELS[r.name] ?? r.name}
                </Txt>
                <View style={{ width: 18, height: 2, backgroundColor: on ? c.bandInk : 'transparent' }} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function HomeownerTabs() {
  const { mode } = useMode();
  return mode === 'live' ? <LiveGuard /> : <DemoGuard />;
}

function DemoGuard() {
  const onboarded = useApp((s) => s.step >= 6);
  if (!onboarded) return <Redirect href="/homeowner/onboarding" />;
  return <HomeownerTabBar />;
}

/** Live: the tabs need a home with an active plan. */
function LiveGuard() {
  const my = useMyHome();
  if (my.data) return my.data.onboarded ? <HomeownerTabBar /> : <Redirect href="/homeowner/onboarding" />;
  if (my.error) {
    return (
      <Screen>
        <ErrorState title="We couldn't load your home" message={my.error} onRetry={my.refetch} />
      </Screen>
    );
  }
  return <BlankField />;
}

function HomeownerTabBar() {
  const c = usePalette();
  return (
    <Tabs
      tabBar={(p) => <GlassTabBar {...p} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.field } }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="plan" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="services" />
    </Tabs>
  );
}
