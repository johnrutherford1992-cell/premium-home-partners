import { TASKS } from '@php/pricing';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { PHOTO_GRADIENTS, TECH } from '../../../data/seed';
import { useApp } from '../../../store/app';
import { useVisit } from '../../../store/derived';
import { PhotoBox, Row, Screen, TextLink } from '../../../ui/controls';
import { Display, LqBadge, LqCard, LqStat, Mono, Txt } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';

const techShort = TECH.name.split(' ')[0] + ' ' + TECH.name.split(' ')[1][0] + '.';

export default function ReportsTab() {
  const { report, shots } = useApp();
  const visit = useVisit();
  const [open, setOpen] = useState(false);
  const c = usePalette();
  const photos = TASKS.filter((t) => shots[t.id]);

  if (!report) {
    return (
      <Screen bottomInset={110}>
        <Display>Reports</Display>
        <LqCard>
          <Txt weight="600">Your first report arrives after the visit</Txt>
          <Txt size={13} muted style={{ marginTop: 6, lineHeight: 19 }}>
            {TECH.name.split(' ')[0]} photographs every filter, drain and part so you can see the difference. Try it: open the
            Technician app, start the visit and complete the checklist.
          </Txt>
        </LqCard>
      </Screen>
    );
  }

  if (!open) {
    return (
      <Screen bottomInset={110}>
        <Display>Reports</Display>
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
          <LqCard>
            <Row>
              <View>
                <Txt size={15} weight="600">
                  {visit.day} visit
                </Txt>
                <Txt size={12} muted>
                  {techShort} · {photos.length} photos · {visit.doneCount} tasks
                </Txt>
              </View>
              <LqBadge tone="forest">New</LqBadge>
            </Row>
          </LqCard>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen bottomInset={110}>
      <TextLink onPress={() => setOpen(false)}>‹ Reports</TextLink>
      <Row style={{ alignItems: 'flex-end' }}>
        <View>
          <Txt size={13} muted>
            {visit.day} · {techShort}
          </Txt>
          <Display>Visit report</Display>
        </View>
        <LqBadge tone="forest">{`${visit.doneCount} done`}</LqBadge>
      </Row>
      <LqStat label="Home health" value="86" sub="▲ 4 since your intake" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {(photos.length ? photos : [null]).map((t) => (
          <View key={t?.id ?? 'none'} style={{ width: '47%', flexGrow: 1, gap: 5 }}>
            <PhotoBox height={124} radius={14} colors={t ? PHOTO_GRADIENTS[t.photo] : [c.rule, c.rule]}>
              <View style={{ position: 'absolute', left: 8, top: 8, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, backgroundColor: c.glassStrong }}>
                <Mono size={9} medium>
                  {!t ? '—' : t.photo === 'clean' ? 'AFTER' : t.photo === 'drain' ? 'DRAIN' : 'BEFORE'}
                </Mono>
              </View>
              <Mono size={10} color="#fff" style={{ position: 'absolute', left: 8, bottom: 8, opacity: 0.85 }}>
                tech photo
              </Mono>
            </PhotoBox>
            <Txt size={12}>{t ? t.short : 'No photos captured'}</Txt>
          </View>
        ))}
      </View>
      <Row>
        <Txt size={13}>Anode rod 70% depleted</Txt>
        <LqBadge tone="ochre">Quote $185</LqBadge>
      </Row>
      <Row>
        <Txt size={13}>Dryer vent airflow normal</Txt>
        <LqBadge tone="forest">Good</LqBadge>
      </Row>
    </Screen>
  );
}
