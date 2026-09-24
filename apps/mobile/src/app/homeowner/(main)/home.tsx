import { router } from 'expo-router';
import { View } from 'react-native';
import { SLOTS, TECH } from '../../../data/seed';
import { useApp } from '../../../store/app';
import { useHomeNames, useVisit } from '../../../store/derived';
import { STATUS } from '../../../theme/tokens';
import { Avatar, Row, Screen, TextLink } from '../../../ui/controls';
import { Display, Eyebrow, LqBadge, LqButton, LqCard, Mono, Txt } from '../../../ui/primitives';
import { Pulse } from '../../../ui/Pulse';
import { usePalette } from '../../../ui/theme';

export default function HomeTab() {
  const { tech, confirmed, reminders, slot, set } = useApp();
  const { firstName, street } = useHomeNames();
  const visit = useVisit();
  const c = usePalette();

  const banner =
    tech === 'enroute'
      ? { title: `${TECH.name.split(' ')[0]} is on the way · 12 min`, sub: TECH.van }
      : tech === 'onsite'
        ? { title: `${TECH.name.split(' ')[0]} is on site`, sub: `${visit.doneCount} of ${visit.tasks.length} tasks done` }
        : tech === 'done'
          ? { title: 'Visit complete · report ready', sub: 'See photos in Reports' }
          : null;

  const notices = [
    { t: '7 days · list sent', on: true },
    { t: '48 hrs · reminder', on: reminders },
    { t: 'Day of · on the way', on: tech !== 'scheduled' },
  ];

  return (
    <Screen bottomInset={110}>
      <View>
        <Row>
          <Txt size={14} muted>
            Good morning, {firstName}
          </Txt>
          <TextLink onPress={() => router.replace('/')}>All apps</TextLink>
        </Row>
        <Display size={30} style={{ lineHeight: 32 }}>
          {street}
        </Display>
      </View>

      {banner ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.accent }}>
          <Pulse>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentInk }} />
          </Pulse>
          <View>
            <Txt size={13} weight="700" color={c.accentInk}>
              {banner.title}
            </Txt>
            <Txt size={13} color={c.accentInk} style={{ opacity: 0.85 }}>
              {banner.sub}
            </Txt>
          </View>
        </View>
      ) : null}

      <LqCard>
        <Row>
          <Eyebrow>NEXT VISIT</Eyebrow>
          <LqBadge tone={tech === 'done' || confirmed ? 'forest' : 'slate'}>{tech === 'done' ? 'Completed' : confirmed ? 'Confirmed' : 'Notice sent'}</LqBadge>
        </Row>
        <Display size={34} style={{ marginTop: 8 }}>
          {visit.day}
        </Display>
        <Txt size={14} muted style={{ marginTop: 4 }}>
          {visit.time} · about {visit.duration}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: c.rule }}>
          <Avatar initials={TECH.initials} />
          <View>
            <Txt weight="600">{TECH.name}</Txt>
            <Txt size={12} muted>
              {TECH.title}
            </Txt>
          </View>
        </View>
        <View style={{ marginTop: 10 }}>
          {visit.tasks.map((t) => (
            <Row key={t.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: c.rule }}>
              <Txt size={13}>{t.name}</Txt>
              <Mono size={11} muted>
                {t.min} min
              </Mono>
            </Row>
          ))}
        </View>
      </LqCard>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {notices.map((n) => (
          <View key={n.t} style={{ flex: 1 }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: n.on ? STATUS.forest : c.rule, marginBottom: 6 }} />
            <Txt size={11} muted>
              {n.t}
            </Txt>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <LqButton full style={{ flex: 1 }} onPress={() => set({ confirmed: true })}>
          {confirmed ? 'Confirmed ✓' : 'Confirm'}
        </LqButton>
        <LqButton full variant="ghost" style={{ flex: 1 }} onPress={() => set({ slot: (slot + 1) % SLOTS.length, confirmed: false })} disabled={tech !== 'scheduled'}>
          Reschedule
        </LqButton>
      </View>
    </Screen>
  );
}
