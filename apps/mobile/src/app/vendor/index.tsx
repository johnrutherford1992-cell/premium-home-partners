import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { AppExitLink } from '../../components/AppExitLink';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { vendorView } from '../../components/vendorView';
import { useVendorMe, useVendorRequests } from '../../data/vendor';
import { useMode } from '../../lib/mode';
import { Row, Screen } from '../../ui/controls';
import { Display, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

const EMPTY_BODY = {
  demo: "When a homeowner taps an add-on service, the request lands here. Try tapping one in the homeowner app's Services tab.",
  live: 'When a Premium Home client requests an add-on service in your categories, it lands here.',
};

export default function VendorRequests() {
  const { mode } = useMode();
  const me = useVendorMe();
  const reqs = useVendorRequests();
  const c = usePalette();
  const rows = useMemo(() => reqs.data?.map((r) => ({ r, v: vendorView(r, c) })), [reqs.data, c]);
  const company = me.data?.company;
  return (
    <Screen>
      <AppExitLink />
      <View>
        <Mono size={11} medium tracking={0.1} muted>
          {company ? <>{company.toUpperCase()} · PHP PARTNER</> : 'PHP PARTNER'}
        </Mono>
        <Display>Quote requests</Display>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <LqStat style={{ flex: 1 }} label="Open" value={rows ? rows.filter(({ v }) => !v.closed).length : '–'} />
        <LqStat style={{ flex: 1 }} label="Won" value={rows ? rows.filter(({ v }) => v.won).length : '–'} />
      </View>
      {!rows ? (
        reqs.error ? (
          <ErrorState message={reqs.error} onRetry={reqs.refetch} />
        ) : (
          <LoadingState label="Loading requests…" />
        )
      ) : !rows.length ? (
        <EmptyState title="No requests yet" body={EMPTY_BODY[mode]} />
      ) : null}
      {rows?.map(({ r, v }) => (
        <Pressable
          key={r.id}
          testID={`vendor-request-${r.category}`}
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
            {r.area}
          </Txt>
          <Mono size={10.5} muted>
            {v.bidsTxt}
          </Mono>
        </Pressable>
      ))}
    </Screen>
  );
}
