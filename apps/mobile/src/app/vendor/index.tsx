import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { vendorView } from '../../components/vendorView';
import { MY_VENDOR } from '../../data/seed';
import { useApp } from '../../store/app';
import { useHomeNames } from '../../store/derived';
import { Row, Screen, TextLink } from '../../ui/controls';
import { Display, LqCard, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function VendorRequests() {
  const reqs = useApp((s) => s.reqs);
  const { street } = useHomeNames();
  const c = usePalette();
  const rows = reqs.map((r) => ({ r, v: vendorView(r, c) }));
  return (
    <Screen>
      <TextLink onPress={() => router.replace('/')}>‹ All apps</TextLink>
      <View>
        <Mono size={11} medium tracking={0.1} muted>
          {MY_VENDOR.vendor.toUpperCase()} · PHP PARTNER
        </Mono>
        <Display>Quote requests</Display>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <LqStat style={{ flex: 1 }} label="Open" value={rows.filter(({ v }) => !v.closed).length} />
        <LqStat style={{ flex: 1 }} label="Won" value={rows.filter(({ v }) => v.won).length} />
      </View>
      {!reqs.length ? (
        <LqCard>
          <Txt weight="600">No requests yet</Txt>
          <Txt size={13} muted style={{ marginTop: 6, lineHeight: 19 }}>
            When a homeowner taps an add-on service, the request lands here. Try tapping one in the homeowner app's Services tab.
          </Txt>
        </LqCard>
      ) : null}
      {rows.map(({ r, v }) => (
        <Pressable
          key={r.id}
          onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: r.id } })}
          accessibilityRole="button"
          style={{ gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}
        >
          <Row>
            <Txt size={15} weight="600">
              {r.name}
            </Txt>
            <Txt size={11} weight="600" color={v.color}>
              {v.status}
            </Txt>
          </Row>
          <Txt size={12} muted>
            {street} · Dallas 75205
          </Txt>
          <Mono size={10.5} muted>
            {v.bidsTxt}
          </Mono>
        </Pressable>
      ))}
    </Screen>
  );
}
