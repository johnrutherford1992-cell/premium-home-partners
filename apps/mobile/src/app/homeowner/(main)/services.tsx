import { money } from '@php/pricing';
import { Pressable, View } from 'react-native';
import { ErrorState, LoadingState } from '../../../components/States';
import { useBookBid, useQuoteRequests, useRequestQuote } from '../../../data/homeowner';
import { ADD_ONS } from '../../../data/seed';
import { STATUS } from '../../../theme/tokens';
import { Pill, Row, Screen } from '../../../ui/controls';
import { Display, LqCard, Mono, Txt } from '../../../ui/primitives';
import { Pulse } from '../../../ui/Pulse';
import { usePalette } from '../../../ui/theme';

export default function ServicesTab() {
  const reqs = useQuoteRequests();
  const requestQuote = useRequestQuote();
  const book = useBookBid();
  const c = usePalette();

  const intro = (
    <View>
      <Display>Add-on services</Display>
      <Txt size={14} muted style={{ marginTop: 6, lineHeight: 20 }}>
        One tap. We gather quotes from vetted service partners and coordinate the work, so you don't have to.
      </Txt>
    </View>
  );

  if (!reqs.data) {
    return (
      <Screen bottomInset={110}>
        {intro}
        {reqs.error ? <ErrorState message={reqs.error} onRetry={reqs.refetch} /> : <LoadingState />}
      </Screen>
    );
  }
  const list = reqs.data;

  return (
    <Screen bottomInset={110}>
      {intro}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {ADD_ONS.map((a) => {
          const r = list.find((x) => x.category === a.id);
          const asking = !r && requestQuote.isPending && requestQuote.variables === a.id;
          const n = r?.bids.length ?? 0;
          const booked = !!r?.booked;
          const label = asking ? 'Finding pros…' : !r ? 'Get quotes' : booked ? 'Booked ✓' : n ? `${n} quote${n > 1 ? 's' : ''}` : 'Finding pros…';
          const bg = asking ? c.rule : !r ? c.accent : booked ? STATUS.forest : n ? STATUS.slate : c.rule;
          const ink = asking ? c.muted : !r ? c.accentInk : n || booked ? '#fff' : c.muted;
          return (
            <Pressable
              key={a.id}
              testID={`addon-${a.id}`}
              onPress={() => {
                if (!r) requestQuote.mutate(a.id);
              }}
              disabled={asking}
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
      {list.map((r) => {
        const collecting = r.bids.length < 3 && !r.booked;
        return (
          <LqCard key={r.id}>
            <Row>
              <Txt weight="600">{r.name}</Txt>
              <Mono size={10} medium muted>
                {r.booked ? 'BOOKED' : `${r.bids.length} OF 3 QUOTES`}
              </Mono>
            </Row>
            {r.bids.map((b) => {
              const bk = r.bookedBidId === b.id;
              const other = r.booked && !bk;
              const booking = book.isPending && book.variables === b.id;
              // While any booking is in flight, every Book pill waits.
              const locked = book.isPending;
              return (
                <View
                  key={b.id}
                  testID={`bid-${b.vendor}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: c.rule, marginTop: 6 }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt size={13} weight="600">
                      {b.vendor}
                    </Txt>
                    <Txt size={11} muted>
                      ★ {b.rating} · {b.when}
                    </Txt>
                  </View>
                  <Txt weight="600">{money(b.price)}</Txt>
                  <View style={{ alignSelf: 'flex-start', opacity: locked && !bk && !other ? 0.5 : 1 }} accessibilityState={{ disabled: locked || !!r.booked }}>
                    <Pill
                      label={bk ? 'Booked ✓' : other ? '—' : booking ? 'Booking…' : 'Book'}
                      bg={bk ? STATUS.forest : other ? c.rule : c.accent}
                      ink={bk ? '#fff' : other ? c.muted : c.accentInk}
                      onPress={!r.booked && !locked ? () => book.mutate(b.id) : undefined}
                    />
                  </View>
                </View>
              );
            })}
            {collecting ? (
              <Pulse period={1600}>
                <Txt size={12} muted style={{ marginTop: 8 }}>
                  Asking vetted service partners near you…
                </Txt>
              </Pulse>
            ) : null}
          </LqCard>
        );
      })}
    </Screen>
  );
}
