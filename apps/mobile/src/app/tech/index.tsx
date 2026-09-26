import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { AppExitLink } from '../../components/AppExitLink';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { TECH_STATUS } from '../../components/techStatus';
import { stopWhen, useTechRoute } from '../../data/tech';
import type { VisitVM } from '../../data/visits';
import { todayChicago } from '../../lib/dates';
import { Row, Screen } from '../../ui/controls';
import { Display, LqBadge, LqCard, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function TechRoute() {
  const route = useTechRoute();
  const c = usePalette();
  const r = route.data;
  const today = todayChicago();
  // Demo keeps the prototype's plain push; live opens the tapped visit.
  const open = (v: VisitVM) => (route.live ? router.push({ pathname: '/tech/job', params: { id: v.id } }) : router.push('/tech/job'));

  return (
    <Screen>
      <AppExitLink />
      <View>
        <Mono size={11} medium tracking={0.1} muted>
          {route.techName}
          {route.van ? ` · ${route.van}` : ''}
        </Mono>
        <Display>Today's route</Display>
      </View>
      {r ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <LqStat style={{ flex: 1 }} label="Stops" value={r.stats.stops} />
            <LqStat style={{ flex: 1 }} label="Tasks" value={r.stats.tasks} />
            <LqStat style={{ flex: 1 }} label="Miles" value={r.stats.miles} />
          </View>
          {r.visits.length === 0 ? (
            <EmptyState title="No visits on your route" body="New visits show up here as soon as the office books them." />
          ) : null}
          {r.visits.map((v) => {
            const when = stopWhen(v, today);
            if (v.id === r.active?.id) {
              const st = TECH_STATUS[v.status];
              return (
                <Pressable key={v.id} onPress={() => open(v)} accessibilityRole="button">
                  <LqCard>
                    <Row>
                      <Mono size={11} medium accent>
                        {when}
                      </Mono>
                      <LqBadge tone={st.tone}>{st.label}</LqBadge>
                    </Row>
                    <Txt size={16} weight="600" style={{ marginTop: 6 }}>
                      {v.client.name}
                    </Txt>
                    <Txt size={13} muted>
                      {v.client.street} · {v.tierName}
                    </Txt>
                    <Txt size={12} muted style={{ marginTop: 6 }}>
                      {v.tasks.length} tasks · {v.duration} · tap to open ›
                    </Txt>
                  </LqCard>
                </Pressable>
              );
            }
            const done = v.status === 'done';
            const card = (key?: string) => (
              <View key={key} style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.rule, opacity: 0.7 }}>
                <Row>
                  <Mono size={11} medium muted>
                    {when}
                  </Mono>
                  <Mono size={11} medium muted>
                    {v.tierName}
                  </Mono>
                </Row>
                {done ? (
                  <Row style={{ marginTop: 4, gap: 8 }}>
                    <Txt size={15} weight="600" style={{ flexShrink: 1 }}>
                      {v.client.name}
                    </Txt>
                    <LqBadge tone="forest">{TECH_STATUS.done.label}</LqBadge>
                  </Row>
                ) : (
                  <Txt size={15} weight="600" style={{ marginTop: 4 }}>
                    {v.client.name}
                  </Txt>
                )}
                <Txt size={12} muted>
                  {v.client.street}
                </Txt>
              </View>
            );
            return route.live ? (
              <Pressable key={v.id} onPress={() => open(v)} accessibilityRole="button">
                {card()}
              </Pressable>
            ) : (
              card(v.id)
            );
          })}
        </>
      ) : route.error ? (
        <ErrorState message={route.error} onRetry={route.refetch} />
      ) : (
        <LoadingState label="Loading your route…" />
      )}
    </Screen>
  );
}
