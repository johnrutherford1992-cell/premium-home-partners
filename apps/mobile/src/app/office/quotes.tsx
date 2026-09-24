import { COORDINATION_FEE, money } from '@php/pricing';
import { View } from 'react-native';
import { Table } from '../../components/Table';
import { useApp } from '../../store/app';
import { useHomeNames } from '../../store/derived';
import { STATUS } from '../../theme/tokens';
import { Display, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function OfficeQuotes() {
  const reqs = useApp((s) => s.reqs);
  const { name } = useHomeNames();
  const c = usePalette();
  const booked = reqs.filter((r) => r.booked != null);
  const fees = booked.reduce((a, r) => a + r.bids[r.booked!].price * COORDINATION_FEE, 0);
  return (
    <>
      <View>
        <Mono size={11} medium tracking={0.08} muted>
          BROKERED WORK · 38 VETTED VENDORS
        </Mono>
        <Display size={32} style={{ lineHeight: 32 }}>
          Add-on quotes
        </Display>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <LqStat style={{ flex: 1, minWidth: 160 }} label="Open requests" value={reqs.length - booked.length} />
        <LqStat style={{ flex: 1, minWidth: 160 }} label="Booked" value={booked.length} />
        <LqStat style={{ flex: 1, minWidth: 160 }} label="Coordination fees" value={money(fees)} />
      </View>
      {!reqs.length ? (
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
          rows={reqs.map((r) => [
            <Txt size={13} weight="700" key="n">
              {r.name}
            </Txt>,
            <Txt size={13} key="c">
              {name}
            </Txt>,
            <Mono size={12} key="b">
              {r.bids.length} / 3 bids
            </Mono>,
            <Mono size={12} key="l">
              low {r.bids.length ? money(Math.min(...r.bids.map((b) => b.price))) : '—'}
            </Mono>,
            <Txt size={13} weight="600" color={r.booked != null ? STATUS.forest : c.accent} key="s">
              {r.booked != null ? 'Booked · ' + r.bids[r.booked].vendor.split(' ')[0] : 'Collecting'}
            </Txt>,
          ])}
        />
      )}
    </>
  );
}
