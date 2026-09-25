import { COORDINATION_FEE, money } from '@php/pricing';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { ErrorState, LoadingState } from '../../components/States';
import { vendorView } from '../../components/vendorView';
import { usePricingInputs } from '../../data/pricing';
import { useBidDraft, useVendorRequest, type VendorRequestVM } from '../../data/vendor';
import { useMode } from '../../lib/mode';
import { STATUS } from '../../theme/tokens';
import { PhotoBox, Row, RoundBtn, Screen, TextLink } from '../../ui/controls';
import { Display, Eyebrow, LqButton, LqCard, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

const back = () => (router.canGoBack() ? router.back() : router.replace('/vendor'));

function Frame({ children }: { children?: ReactNode }) {
  return (
    <Screen>
      <TextLink onPress={back}>‹ Requests</TextLink>
      {children}
    </Screen>
  );
}

export default function VendorRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { mode } = useMode();
  const c = usePalette();
  const q = useVendorRequest(typeof id === 'string' ? id : undefined);

  if (q.data === undefined) {
    return <Frame>{q.error ? <ErrorState message={q.error} onRetry={q.refetch} /> : <LoadingState />}</Frame>;
  }
  const r = q.data;
  const v = r ? vendorView(r, c) : null;
  // Live: a request booked or withdrawn before this vendor quoted is gone for them.
  if (!r || !v || (mode === 'live' && v.closed && !v.hasMine)) {
    return (
      <Frame>
        <Txt muted>This request is no longer available.</Txt>
      </Frame>
    );
  }
  return <RequestDetail key={r.id} r={r} v={v} />;
}

function RequestDetail({ r, v }: { r: VendorRequestVM; v: ReturnType<typeof vendorView> }) {
  const c = usePalette();
  const draft = useBidDraft(r);
  const fee = usePricingInputs().data?.coordinationFee ?? COORDINATION_FEE;
  const { price, step } = draft;

  return (
    <Frame>
      <View>
        <Mono size={11} medium accent>
          REQUEST · VIA PREMIUM HOME
        </Mono>
        <Display size={32} style={{ lineHeight: 32 }}>
          {r.name}
        </Display>
        <Txt size={13} muted style={{ marginTop: 4 }}>
          {r.sqft != null ? (
            <>
              {r.street} · {r.sqft.toLocaleString('en-US')} sq ft lot + home
            </>
          ) : (
            r.street
          )}
        </Txt>
      </View>
      <LqCard>
        <Eyebrow>SCOPE</Eyebrow>
        <Txt style={{ marginTop: 4, lineHeight: 20 }}>
          {r.sub}. Photos of the exterior from intake are attached. PHP coordinates access and scheduling.
        </Txt>
      </LqCard>
      <PhotoBox height={120} radius={16}>
        <Mono size={10} muted style={{ position: 'absolute', left: 10, bottom: 8 }}>
          exterior photo from intake
        </Mono>
      </PhotoBox>
      {!v.hasMine && !v.closed ? (
        <>
          <Row style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
            <Mono size={10} medium muted>
              YOUR PRICE
            </Mono>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <RoundBtn label="-" size={30} onPress={() => draft.setPrice(price - step)} />
              <Display size={30} style={{ textTransform: 'none' }}>
                {money(price)}
              </Display>
              <RoundBtn label="+" size={30} accent onPress={() => draft.setPrice(price + step)} />
            </View>
          </Row>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {draft.dates.map((d, i) => {
              const on = draft.when === i;
              return (
                <Pressable
                  key={d}
                  onPress={() => draft.setWhen(i)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  aria-checked={on}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.rule, backgroundColor: on ? c.glassStrong : 'transparent' }}
                >
                  <Txt size={12} weight="600">
                    {d}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <Txt size={12} muted>
            PHP coordination fee {Math.round(fee * 100)}% · you receive {money(price * (1 - fee))}
          </Txt>
          <View testID="vendor-submit">
            <LqButton full disabled={draft.submitting} onPress={draft.submit}>
              {draft.submitting ? 'Submitting…' : 'Submit quote'}
            </LqButton>
          </View>
          {draft.error ? (
            <Txt testID="vendor-submit-error" accessibilityRole="alert" size={13} color={STATUS.brick} style={{ lineHeight: 19 }}>
              {draft.error}
            </Txt>
          ) : null}
        </>
      ) : (
        <LqCard>
          <Row>
            <Txt weight="600">{v.status}</Txt>
            <Display size={24} style={{ textTransform: 'none' }}>
              {v.myPrice}
            </Display>
          </Row>
          <Txt size={12} muted style={{ marginTop: 4 }}>
            {v.bidsTxt}
          </Txt>
        </LqCard>
      )}
    </Frame>
  );
}
