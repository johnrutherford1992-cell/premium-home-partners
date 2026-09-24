import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useApp } from '../../store/app';
import { useHomeNames, useTiers, useVisit } from '../../store/derived';
import { STATUS } from '../../theme/tokens';
import { Pill, Row, Screen, TextLink } from '../../ui/controls';
import { Display, Eyebrow, LqButton, LqCard, LqSectionTitle, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

const ADVANCE_LABEL = {
  scheduled: 'Start driving · notify client',
  enroute: 'Mark arrived on site',
  onsite: 'On site · work the checklist',
  done: 'Visit complete',
} as const;

export default function TechJob() {
  const { tech, done, shots, pets, techAdvance, toggleTask, togglePhoto, completeVisit } = useApp();
  const visit = useVisit();
  const { cur } = useTiers();
  const { name, addr } = useHomeNames();
  const c = usePalette();
  const onsite = tech === 'onsite';
  const active = onsite || tech === 'done';
  const allDone = visit.doneCount === visit.tasks.length;

  return (
    <Screen>
      <TextLink onPress={() => (router.canGoBack() ? router.back() : router.replace('/tech'))}>‹ Route</TextLink>
      <View>
        <Mono size={11} medium accent>
          {visit.time} · {cur.name}
        </Mono>
        <Display size={30} style={{ lineHeight: 30 }}>
          {name}
        </Display>
        <Txt size={13} muted>
          {addr}
        </Txt>
      </View>
      <LqCard>
        <Eyebrow>NOTES FROM CLIENT</Eyebrow>
        <Txt size={13} style={{ marginTop: 4 }}>
          {pets ? '2 friendly dogs — please close the side gate. ' : ''}Gate code 4471. Heater in garage, back left.
        </Txt>
      </LqCard>
      <LqButton full onPress={techAdvance} disabled={tech === 'onsite' || tech === 'done'}>
        {ADVANCE_LABEL[tech]}
      </LqButton>
      <Row>
        <LqSectionTitle>Checklist</LqSectionTitle>
        <Mono size={12} medium muted>
          {visit.doneCount} / {visit.tasks.length}
        </Mono>
      </Row>
      {!active ? (
        <Txt size={12} muted>
          Checklist unlocks when you mark yourself on site.
        </Txt>
      ) : null}
      <View style={{ gap: 8 }}>
        {visit.tasks.map((t) => {
          const d = !!done[t.id];
          const p = !!shots[t.id];
          return (
            <View
              key={t.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 16,
                backgroundColor: c.glassStrong,
                borderWidth: 1,
                borderColor: c.rule,
                opacity: active ? 1 : 0.5,
              }}
            >
              <Pressable
                onPress={() => toggleTask(t.id)}
                disabled={!onsite}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: d, disabled: !onsite }}
                accessibilityLabel={t.name}
                style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: d ? STATUS.forest : c.muted, backgroundColor: d ? STATUS.forest : 'transparent', alignItems: 'center', justifyContent: 'center' }}
              >
                <Txt size={14} color="#fff">
                  {d ? '✓' : ''}
                </Txt>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Txt size={13} weight="600">
                  {t.name}
                </Txt>
                <Mono size={10.5} muted>
                  {t.part} · {t.min} min
                </Mono>
              </View>
              <Pill
                label={p ? '✓ Photo' : '+ Photo'}
                bg={p ? STATUS.forest : 'transparent'}
                ink={p ? '#fff' : c.accent}
                border={c.rule}
                onPress={onsite ? () => togglePhoto(t.id) : undefined}
              />
            </View>
          );
        })}
      </View>
      <LqButton full onPress={completeVisit} disabled={!(onsite && allDone)}>
        {tech === 'done' ? 'Report sent ✓' : onsite && allDone ? 'Complete & send report' : 'Complete all tasks to finish'}
      </LqButton>
    </Screen>
  );
}
