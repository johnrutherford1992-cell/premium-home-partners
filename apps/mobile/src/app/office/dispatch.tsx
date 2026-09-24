import { View } from 'react-native';
import { Table } from '../../components/Table';
import { TECH_STATUS } from '../../components/techStatus';
import { TECH } from '../../data/seed';
import { useApp } from '../../store/app';
import { useHomeNames, useTiers, useVisit } from '../../store/derived';
import { STATUS } from '../../theme/tokens';
import { Row } from '../../ui/controls';
import { Display, LqButton, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function OfficeDispatch() {
  const { step, tech, confirmed, reminders, set } = useApp();
  const { cur } = useTiers();
  const visit = useVisit();
  const { name, street } = useHomeNames();
  const c = usePalette();
  const main = step >= 6;
  const n48 = reminders ? '✓' : 'Queued';
  const n48c = reminders ? STATUS.forest : c.muted;

  const rows = [
    {
      when: `${visit.day} ${visit.time.split(' – ')[0]}`,
      client: name,
      addr: street,
      tech: TECH.name,
      tier: main ? cur.name : 'Onboarding',
      n48,
      n48c,
      status: main ? TECH_STATUS[tech].label + (confirmed && tech === 'scheduled' ? ' · conf.' : '') : 'Pending',
      sc: tech === 'done' ? STATUS.forest : tech === 'scheduled' ? c.ink : c.accent,
    },
    { when: 'Tue · Oct 14 12:00 PM', client: 'David Okafor', addr: '4410 Bryn Mawr', tech: TECH.name, tier: 'Medium', n48, n48c, status: 'Confirmed', sc: c.ink },
    { when: 'Tue · Oct 14 3:00 PM', client: 'The Whitfields', addr: '88 Beverly Dr', tech: TECH.name, tier: 'High', n48, n48c, status: 'Confirmed', sc: c.ink },
    { when: 'Wed · Oct 15 9:00 AM', client: 'Priya Shah', addr: '17 Stonebridge', tech: 'Dana Liu', tier: 'PHP Recommended', n48: '—', n48c: c.muted, status: 'Awaiting', sc: STATUS.ochre },
    { when: 'Thu · Oct 16 10:00 AM', client: 'Mark & Jo Bell', addr: '203 Lakewood', tech: 'Dana Liu', tier: 'Low', n48: '—', n48c: c.muted, status: 'Confirmed', sc: c.ink },
  ];

  return (
    <>
      <Row style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <View>
          <Mono size={11} medium tracking={0.08} muted>
            WEEK OF OCT 13
          </Mono>
          <Display size={32} style={{ lineHeight: 32 }}>
            Dispatch
          </Display>
        </View>
        <LqButton onPress={() => set({ reminders: true })} disabled={reminders}>
          {reminders ? '48-hr reminders sent ✓' : 'Send 48-hr reminders'}
        </LqButton>
      </Row>
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
        rows={rows.map((d) => [
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
          <Txt size={13} color={STATUS.forest} key="7">
            ✓
          </Txt>,
          <Txt size={13} color={d.n48c} key="48">
            {d.n48}
          </Txt>,
          <Txt size={13} weight="600" color={d.sc} key="s">
            {d.status}
          </Txt>,
        ])}
      />
      <Txt size={12} muted style={{ lineHeight: 18 }}>
        Notices go out automatically at 7 days (full service list) and 48 hours (reminder with prep notes). The day-of "on the way"
        text fires when the tech taps Start driving.
      </Txt>
    </>
  );
}
