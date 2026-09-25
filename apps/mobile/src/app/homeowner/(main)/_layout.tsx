import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlankField } from '../../../components/RoleGate';
import { ErrorState } from '../../../components/States';
import { useMyHome } from '../../../data/homeowner';
import { useMode } from '../../../lib/mode';
import { useApp } from '../../../store/app';
import { Screen } from '../../../ui/controls';
import { Txt } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';

const LABELS: Record<string, string> = { home: 'Home', plan: 'Plan', reports: 'Reports', services: 'Services' };

/** Floating glass tab bar: 62pt tall, radius 31, 16pt inset, 24pt from the bottom. */
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
            borderRadius: 31,
            overflow: 'hidden',
            backgroundColor: c.glassStrong,
            borderWidth: 1,
            borderColor: c.rule,
            flexDirection: 'row',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}
        >
          {Platform.OS !== 'android' ? <BlurView intensity={60} tint={c.dark ? 'dark' : 'light'} style={{ position: 'absolute', inset: 0 }} /> : null}
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
                style={{ alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10 }}
              >
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: on ? c.accent : 'transparent' }} />
                <Txt size={11} weight="600" color={on ? c.accent : c.muted}>
                  {LABELS[r.name] ?? r.name}
                </Txt>
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
