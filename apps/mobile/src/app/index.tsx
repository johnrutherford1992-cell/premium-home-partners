import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
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

export default function Launcher() {
  const { dark, set, reset, step, tech, reqs } = useApp();
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
        <Mono size={11} medium tracking={0.12} muted>
          PREMIUM HOME PARTNERS
        </Mono>
        <Display size={40}>One home, four apps</Display>
        <Txt size={14} muted style={{ lineHeight: 21 }}>
          What you do in one app shows up in the others. Onboard a home, start a visit from the Technician app, bid from the Vendor
          app, and change labor rates in the Office. Prices update everywhere.
        </Txt>
      </View>
      <Row style={{ gap: 10, justifyContent: 'flex-start' }}>
        <LqButton variant="ghost" onPress={() => set({ dark: !dark })}>
          {dark ? 'Light mode' : 'Dark mode'}
        </LqButton>
        <LqButton variant="ghost" onPress={reset}>
          Reset demo
        </LqButton>
      </Row>
      {ROLES.map((r) => (
        <Pressable key={r.href} onPress={() => router.push(r.href)} accessibilityRole="link">
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
