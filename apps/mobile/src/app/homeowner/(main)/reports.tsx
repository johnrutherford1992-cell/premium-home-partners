import { TASKS } from '@php/pricing';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { RemotePhoto } from '../../../components/camera/RemotePhoto';
import { ErrorState, LoadingState } from '../../../components/States';
import { useCurrentVisit, useReports, type ReportVM } from '../../../data/homeowner';
import { PHOTO_GRADIENTS, TECH } from '../../../data/seed';
import { useMode } from '../../../lib/mode';
import { Row, Screen, TextLink } from '../../../ui/controls';
import { Display, LqBadge, LqCard, LqStat, Txt } from '../../../ui/primitives';
import { RADIUS } from '../../../theme/tokens';
import { usePalette } from '../../../ui/theme';

export default function ReportsTab() {
  const reports = useReports();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!reports.data) {
    return (
      <Screen bottomInset={110}>
        <Display>Reports</Display>
        {reports.error ? <ErrorState message={reports.error} onRetry={reports.refetch} /> : <LoadingState />}
      </Screen>
    );
  }

  if (!reports.data.length) return <NoReports />;

  const open = openId ? reports.data.find((r) => r.id === openId) : undefined;
  if (!open) {
    return (
      <Screen bottomInset={110}>
        <Display>Reports</Display>
        {reports.data.map((r, i) => (
          <Pressable key={r.id} testID="report-card" onPress={() => setOpenId(r.id)} accessibilityRole="button">
            <LqCard>
              <Row>
                <View>
                  <Txt size={15} weight="600">
                    {r.day} visit
                  </Txt>
                  <Txt size={12} muted>
                    {r.techShort} · {r.photos.length} photos · {r.doneCount} tasks
                  </Txt>
                </View>
                {i === 0 ? <LqBadge tone="forest">New</LqBadge> : null}
              </Row>
            </LqCard>
          </Pressable>
        ))}
      </Screen>
    );
  }

  return <ReportDetail report={open} onBack={() => setOpenId(null)} />;
}

/** Before the first visit is done. */
function NoReports() {
  const { mode } = useMode();
  const live = mode === 'live';
  const current = useCurrentVisit();
  const first = live ? (current.data?.tech?.firstName ?? 'Your technician') : TECH.name.split(' ')[0];
  return (
    <Screen bottomInset={110}>
      <Display>Reports</Display>
      <LqCard>
        <Txt weight="600">Your first report arrives after the visit</Txt>
        <Txt size={13} muted style={{ marginTop: 6, lineHeight: 19 }}>
          {live ? (
            <>{first} photographs every filter, drain and part so you can see the difference.</>
          ) : (
            <>
              {first} photographs every filter, drain and part so you can see the difference. Try it: open the Technician app, start the
              visit and complete the checklist.
            </>
          )}
        </Txt>
      </LqCard>
    </Screen>
  );
}

function ReportDetail({ report, onBack }: { report: ReportVM; onBack: () => void }) {
  const c = usePalette();
  return (
    <Screen bottomInset={110}>
      <TextLink onPress={onBack}>‹ Reports</TextLink>
      <Row style={{ alignItems: 'flex-end' }}>
        <View>
          <Txt size={13} muted>
            {report.day} · {report.techShort}
          </Txt>
          <Display>Visit report</Display>
        </View>
        <LqBadge tone="forest">{`${report.doneCount} done`}</LqBadge>
      </Row>
      <LqStat label="Home health" value={String(report.health)} sub="▲ 4 since your intake" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {report.photos.length ? (
          report.photos.map((p) => {
            const task = TASKS.find((t) => t.id === p.taskKey);
            return (
              <View key={p.key} style={{ width: '47%', flexGrow: 1, gap: 5 }}>
                <RemotePhoto path={p.path} height={124} radius={RADIUS.card} tag={p.tag} colors={task ? PHOTO_GRADIENTS[task.photo] : undefined} testID="report-photo" />
                <Txt size={12}>{p.taskShort}</Txt>
              </View>
            );
          })
        ) : (
          <View style={{ width: '47%', flexGrow: 1, gap: 5 }}>
            <RemotePhoto path={null} height={124} radius={RADIUS.card} tag="—" colors={[c.rule, c.rule]} />
            <Txt size={12}>No photos captured</Txt>
          </View>
        )}
      </View>
      {report.findings.map((f) => (
        <Row key={f.text}>
          <Txt size={13}>{f.text}</Txt>
          {f.badge ? <LqBadge tone={f.tone}>{f.badge}</LqBadge> : null}
        </Row>
      ))}
    </Screen>
  );
}
