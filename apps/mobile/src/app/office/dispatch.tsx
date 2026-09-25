import { View } from 'react-native';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Table } from '../../components/Table';
import { useDispatch, useSendReminders, type DispatchTone } from '../../data/office';
import { STATUS } from '../../theme/tokens';
import { Row } from '../../ui/controls';
import { Display, LqButton, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function OfficeDispatch() {
  const q = useDispatch();
  const send = useSendReminders();
  const c = usePalette();
  const data = q.data;
  const tone = (t: DispatchTone) => (t === 'forest' || t === 'ochre' ? STATUS[t] : c[t]);
  const allSent = !!data?.allSent;

  return (
    <>
      <Row style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <View>
          <Mono size={11} medium tracking={0.08} muted>
            {data?.weekLabel ?? ' '}
          </Mono>
          <Display size={32} style={{ lineHeight: 32 }}>
            Dispatch
          </Display>
        </View>
        <LqButton onPress={send.run} disabled={!data || allSent || send.pending}>
          {allSent ? '48-hr reminders sent ✓' : send.pending ? 'Sending…' : 'Send 48-hr reminders'}
        </LqButton>
      </Row>
      {!data ? (
        q.error ? (
          <ErrorState message={q.error} onRetry={q.refetch} />
        ) : (
          <LoadingState label="Loading this week…" />
        )
      ) : !data.rows.length ? (
        <EmptyState title="No visits this week" body="Visits booked for this week show up here with their notices and status." />
      ) : (
        <Table
          rowPad={11}
          cols={[
            { label: 'WINDOW', width: 170 },
            { label: 'CLIENT', flex: 1, minWidth: 180 },
            { label: 'TECH', width: 130 },
            { label: 'PLAN', width: 140 },
            { label: '7-DAY', width: 70 },
            { label: '48-HR', width: 80 },
            { label: 'STATUS', width: 110 },
          ]}
          rows={data.rows.map((d) => [
            <Mono size={12} key="w">
              {d.when}
            </Mono>,
            <Txt size={13} key="c">
              <Txt size={13} weight="700">
                {d.client}
              </Txt>
              <Txt size={13} muted>
                {' · ' + d.addr}
              </Txt>
            </Txt>,
            <Txt size={13} key="t">
              {d.tech}
            </Txt>,
            <Txt size={13} key="p">
              {d.tier}
            </Txt>,
            <Txt size={13} color={tone(d.d7Tone)} key="7">
              {d.d7}
            </Txt>,
            <Txt size={13} color={tone(d.n48Tone)} key="48">
              {d.n48}
            </Txt>,
            <Txt size={13} weight="600" color={tone(d.statusTone)} key="s">
              {d.status}
            </Txt>,
          ])}
        />
      )}
      <Txt size={12} muted style={{ lineHeight: 18 }}>
        Notices go out automatically at 7 days (full service list) and 48 hours (reminder with prep notes). The day-of "on the way"
        text fires when the tech taps Start driving.
      </Txt>
    </>
  );
}
