import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { OTHER_JOBS, TECH } from '../../data/seed';
import { useApp } from '../../store/app';
import { useHomeNames, useTiers, useVisit } from '../../store/derived';
import { Row, Screen, TextLink } from '../../ui/controls';
import { Display, LqBadge, LqCard, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { TECH_STATUS } from '../../components/techStatus';

export default function TechRoute() {
  const tech = useApp((s) => s.tech);
  const visit = useVisit();
  const { cur } = useTiers();
  const { name, street } = useHomeNames();
  const c = usePalette();
  const st = TECH_STATUS[tech];
  return (
    <Screen>
      <TextLink onPress={() => router.replace('/')}>‹ All apps</TextLink>
      <View>
        <Mono size={11} medium tracking={0.1} muted>
          {TECH.name.toUpperCase()} · VAN 214
        </Mono>
        <Display>Today's route</Display>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <LqStat style={{ flex: 1 }} label="Stops" value="3" />
        <LqStat style={{ flex: 1 }} label="Tasks" value={visit.tasks.length} />
        <LqStat style={{ flex: 1 }} label="Miles" value="38" />
      </View>
      <Pressable onPress={() => router.push('/tech/job')} accessibilityRole="button">
        <LqCard>
          <Row>
            <Mono size={11} medium accent>
              {visit.time}
            </Mono>
            <LqBadge tone={st.tone}>{st.label}</LqBadge>
          </Row>
          <Txt size={16} weight="600" style={{ marginTop: 6 }}>
            {name}
          </Txt>
          <Txt size={13} muted>
            {street} · {cur.name}
          </Txt>
          <Txt size={12} muted style={{ marginTop: 6 }}>
            {visit.tasks.length} tasks · {visit.duration} · tap to open ›
          </Txt>
        </LqCard>
      </Pressable>
      {OTHER_JOBS.map((j) => (
        <View key={j.name} style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.rule, opacity: 0.7 }}>
          <Row>
            <Mono size={11} medium muted>
              {j.time}
            </Mono>
            <Mono size={11} medium muted>
              {j.tier}
            </Mono>
          </Row>
          <Txt size={15} weight="600" style={{ marginTop: 4 }}>
            {j.name}
          </Txt>
          <Txt size={12} muted>
            {j.addr}
          </Txt>
        </View>
      ))}
    </Screen>
  );
}
