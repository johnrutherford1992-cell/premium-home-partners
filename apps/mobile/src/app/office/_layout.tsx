import { Slot, router, usePathname } from 'expo-router';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppExitLink } from '../../components/AppExitLink';
import { RoleGate } from '../../components/RoleGate';
import { useResetDemo } from '../../data/office';
import { Stage } from '../../ui/controls';
import { Display, LqButton, LqGlass, Mono, Txt } from '../../ui/primitives';
import { RADIUS } from '../../theme/tokens';
import { usePalette } from '../../ui/theme';

const TABS = [
  { href: '/office/pricing', label: 'Pricing' },
  { href: '/office/dispatch', label: 'Dispatch' },
  { href: '/office/quotes', label: 'Add-on quotes' },
] as const;

export default function OfficeLayout() {
  return (
    <RoleGate role="office">
      <OfficeConsole />
    </RoleGate>
  );
}

/** "Reset demo data": full-width ghost at the foot of the sidebar, or the last item of the phone tab row. */
function ResetDemo({ wide }: { wide: boolean }) {
  const reset = useResetDemo();
  return (
    <LqButton
      variant="ghost"
      disabled={reset.pending}
      onPress={reset.run}
      style={wide ? { alignSelf: 'stretch' } : { minHeight: 0, paddingVertical: 9, paddingHorizontal: 12 }}
    >
      <Txt testID="office-reset" size={wide ? 14 : 13} weight="500">
        {reset.pending ? 'Resetting…' : 'Reset demo data'}
      </Txt>
    </LqButton>
  );
}

/** Office console: 200pt sidebar + content on tablet/desktop, top tabs on phones. */
function OfficeConsole() {
  const c = usePalette();
  const path = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 820;

  const nav = TABS.map((t) => {
    const on = path.startsWith(t.href);
    return (
      <Pressable
        key={t.href}
        onPress={() => router.replace(t.href)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: RADIUS.button, backgroundColor: on ? c.accent : 'transparent' }}
      >
        <Txt weight="600" color={on ? c.accentInk : c.ink}>
          {t.label}
        </Txt>
      </Pressable>
    );
  });

  return (
    <Stage>
      <ScrollView contentContainerStyle={{ padding: wide ? 32 : 16, paddingTop: insets.top + (wide ? 28 : 12), paddingBottom: insets.bottom + 60, gap: 12 }}>
        <View style={{ width: '100%', maxWidth: 1320, alignSelf: 'center', gap: 12 }}>
          <AppExitLink />
          <LqGlass style={{ flexDirection: wide ? 'row' : 'column', minHeight: 720 }}>
            {wide ? (
              <View style={{ width: 200, borderRightWidth: 1, borderColor: c.rule, paddingVertical: 22, paddingHorizontal: 14, gap: 4 }}>
                <Display size={20} style={{ paddingHorizontal: 10, paddingBottom: 16 }}>
                  PHP Office
                </Display>
                {nav}
                <View style={{ flex: 1, minHeight: 16 }} />
                <ResetDemo wide />
              </View>
            ) : (
              <View style={{ padding: 14, borderBottomWidth: 1, borderColor: c.rule, gap: 8 }}>
                <Mono size={11} medium tracking={0.1} muted>
                  PHP OFFICE
                </Mono>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  {nav}
                  <ResetDemo wide={false} />
                </View>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 24, paddingHorizontal: wide ? 28 : 16, gap: 18 }}>
              <Slot />
            </View>
          </LqGlass>
        </View>
      </ScrollView>
    </Stage>
  );
}
