import { money } from '@php/pricing';
import { Pressable, View } from 'react-native';
import { ADD_ONS } from '../../../data/seed';
import { useApp } from '../../../store/app';
import { STATUS } from '../../../theme/tokens';
import { Pill, Row, Screen } from '../../../ui/controls';
import { Display, LqCard, Mono, Txt } from '../../../ui/primitives';
import { Pulse } from '../../../ui/Pulse';
import { usePalette } from '../../../ui/theme';

export default function ServicesTab() {
  const { reqs, requestQuote, book } = useApp();
  const c = usePalette();
  return (
    <Screen bottomInset={110}>
      <View>
        <Display>Add-on services</Display>
        <Txt size={14} muted style={{ marginTop: 6, lineHeight: 20 }}>
          One tap. We gather quotes from vetted pros and coordinate the work.
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {ADD_ONS.map((a) => {
          const r = reqs.find((x) => x.id === a.id);
          const n = r?.bids.length ?? 0;
          const booked = r?.booked != null;
          const label = !r ? 'Get quotes' : booked ? 'Booked ✓' : n ? `${n} quote${n > 1 ? 's' : ''}` : 'Finding pros…';
          const bg = !r ? c.accent : booked ? STATUS.forest : n ? STATUS.slate : c.rule;
          const ink = !r ? c.accentInk : n || booked ? '#fff' : c.muted;
          return (
            <Pressable
              key={a.id}
              onPress={() => requestQuote(a.id)}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}: ${label}`}
              style={{ width: '47%', flexGrow: 1, gap: 8, padding: 12, borderRadius: 18, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}
            >
              <Txt weight="600">{a.name}</Txt>
              <Txt size={11} muted style={{ lineHeight: 14 }}>
                {a.sub}
              </Txt>
              <Pill label={label} bg={bg} ink={ink} />
            </Pressable>
          );
        })}
      </View>
      {[...reqs].reverse().map((r) => {
        const collecting = r.bids.length < 3 && r.booked == null;
        return (
          <LqCard key={r.id}>
            <Row>
              <Txt weight="600">{r.name}</Txt>
              <Mono size={10} medium muted>
                {r.booked != null ? 'BOOKED' : `${r.bids.length} OF 3 QUOTES`}
              </Mono>
            </Row>
            {r.bids.map((b, j) => {
              const bk = r.booked === j;
              const other = r.booked != null && !bk;
              return (
                <View key={b.vendor} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: c.rule, marginTop: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={13} weight="600">
                      {b.vendor}
                    </Txt>
                    <Txt size={11} muted>
                      ★ {b.rating} · {b.when}
                    </Txt>
                  </View>
                  <Txt weight="600">{money(b.price)}</Txt>
                  <Pill
                    label={bk ? 'Booked ✓' : other ? '—' : 'Book'}
                    bg={bk ? STATUS.forest : other ? c.rule : c.accent}
                    ink={bk ? '#fff' : other ? c.muted : c.accentInk}
                    onPress={r.booked == null ? () => book(r.id, j) : undefined}
                  />
                </View>
              );
            })}
            {collecting ? (
              <Pulse period={1600}>
                <Txt size={12} muted style={{ marginTop: 8 }}>
                  Asking vetted pros near you…
                </Txt>
              </Pulse>
            ) : null}
          </LqCard>
        );
      })}
    </Screen>
  );
}
