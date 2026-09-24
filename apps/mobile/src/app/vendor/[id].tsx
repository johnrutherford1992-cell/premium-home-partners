import { COORDINATION_FEE, money } from '@php/pricing';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { vendorView } from '../../components/vendorView';
import { VENDOR_DATES } from '../../data/seed';
import { useApp } from '../../store/app';
import { useHomeNames } from '../../store/derived';
import { PhotoBox, Row, RoundBtn, Screen, TextLink } from '../../ui/controls';
import { Display, Eyebrow, LqButton, LqCard, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function VendorRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reqs, vPrice, vWhen, sqft, set, submitBid } = useApp();
  const { street } = useHomeNames();
  const c = usePalette();
  const r = reqs.find((x) => x.id === id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/vendor'));

  if (!r) {
    return (
      <Screen>
        <TextLink onPress={back}>‹ Requests</TextLink>
        <Txt muted>This request is no longer available.</Txt>
      </Screen>
    );
  }

  const v = vendorView(r, c);
  const price = vPrice[r.id] ?? r.base;
  const step = r.base > 500 ? 50 : 5;
  const setPrice = (p: number) => set({ vPrice: { ...vPrice, [r.id]: Math.max(step, p) } });

  return (
    <Screen>
      <TextLink onPress={back}>‹ Requests</TextLink>
      <View>
        <Mono size={11} medium accent>
          REQUEST · VIA PREMIUM HOME
        </Mono>
        <Display size={32} style={{ lineHeight: 32 }}>
          {r.name}
        </Display>
        <Txt size={13} muted style={{ marginTop: 4 }}>
          {street} · {sqft.toLocaleString('en-US')} sq ft lot + home
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
              <RoundBtn label="-" size={30} onPress={() => setPrice(price - step)} />
              <Display size={30} style={{ textTransform: 'none' }}>
                {money(price)}
              </Display>
              <RoundBtn label="+" size={30} accent onPress={() => setPrice(price + step)} />
            </View>
          </Row>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {VENDOR_DATES.map((d, i) => {
              const on = vWhen === i;
              return (
                <Pressable
                  key={d}
                  onPress={() => set({ vWhen: i })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
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
            PHP coordination fee {Math.round(COORDINATION_FEE * 100)}% · you receive {money(price * (1 - COORDINATION_FEE))}
          </Txt>
          <LqButton full onPress={() => submitBid(r.id, price, VENDOR_DATES[vWhen])}>
            Submit quote
          </LqButton>
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
    </Screen>
  );
}
