import { money } from '@php/pricing';
import { View } from 'react-native';
import { ErrorState, LoadingState } from '../../components/States';
import { Table } from '../../components/Table';
import { useOfficeQuotes } from '../../data/office';
import { Display, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function OfficeQuotes() {
  const q = useOfficeQuotes();
  const c = usePalette();
  const data = q.data;
  return (
    <>
      <View>
        <Mono size={11} medium tracking={0.08} muted>
          BROKERED WORK · {data ? data.vettedVendors : '—'} VETTED VENDORS
        </Mono>
        <Display size={32} style={{ lineHeight: 32 }}>
          Add-on quotes
        </Display>
      </View>
      {!data ? (
        q.error ? (
          <ErrorState message={q.error} onRetry={q.refetch} />
        ) : (
          <LoadingState label="Loading requests…" />
        )
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {/* Equal wrappers keep the three stats the same width (office-fees needs a testID). */}
            <View testID="office-open" style={{ flex: 1, minWidth: 160 }}>
              <LqStat label="Open requests" value={data.open} />
            </View>
            <View testID="office-booked" style={{ flex: 1, minWidth: 160 }}>
              <LqStat label="Booked" value={data.booked} />
            </View>
            <View testID="office-fees" style={{ flex: 1, minWidth: 160 }}>
              <LqStat label="Coordination fees" value={money(data.fees)} />
            </View>
          </View>
          {!data.rows.length ? (
            <Txt size={13} muted>
              No requests yet. Tap a service in the homeowner app.
            </Txt>
          ) : (
            <Table
              minWidth={680}
              rowPad={11}
              cols={[
                { label: 'SERVICE', flex: 1, minWidth: 160 },
                { label: 'CLIENT', width: 160 },
                { label: 'BIDS', width: 120 },
                { label: 'LOWEST', width: 120 },
                { label: 'STATUS', width: 120 },
              ]}
              rows={data.rows.map((r) => [
                <Txt size={13} weight="700" key="n">
                  {r.name}
                </Txt>,
                <Txt size={13} key="c">
                  {r.client}
                </Txt>,
                <Mono size={12} key="b">
                  {r.bidCount} / 3 bids
                </Mono>,
                <Mono size={12} key="l">
                  low {r.lowest != null ? money(r.lowest) : '—'}
                </Mono>,
                <Txt size={13} weight="600" color={r.booked ? c.status.forest : c.accent} key="s">
                  {r.booked ? (r.bookedVendor ? 'Booked · ' + r.bookedVendor.split(' ')[0] : 'Booked') : 'Collecting'}
                </Txt>,
              ])}
            />
          )}
        </>
      )}
    </>
  );
}
