import { TASKS, TIERS, money } from '@php/pricing';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Table } from '../../components/Table';
import { useApp } from '../../store/app';
import { useHomeNames, useTiers } from '../../store/derived';
import { STATUS, alpha } from '../../theme/tokens';
import { Row, StepperTile } from '../../ui/controls';
import { Display, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

function Tick({ label, onPress, accent }: { label: string; onPress: () => void; accent?: boolean }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ paddingHorizontal: 4 }} accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}>
      <Txt color={accent ? c.accent : c.muted}>{label === '-' ? '−' : label}</Txt>
    </Pressable>
  );
}

export default function OfficePricing() {
  const s = useApp();
  const { tiers } = useTiers();
  const { street } = useHomeNames();
  const c = usePalette();
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 4 : 2;
  const inputs = [
    { k: 'rate', label: 'Labor rate $/hr', d: 2, min: 40, max: 250, f: (x: number) => '$' + x },
    { k: 'trip', label: 'Trip fee / visit', d: 5, min: 0, max: 150, f: (x: number) => '$' + x },
    { k: 'markup', label: 'Parts markup', d: 5, min: 0, max: 100, f: (x: number) => x + '%' },
    { k: 'techCost', label: 'Tech cost $/hr', d: 2, min: 15, max: 120, f: (x: number) => '$' + x },
  ] as const;
  const tileW = `${100 / cols - 2}%` as const;

  return (
    <>
      <Row style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <View>
          <Mono size={11} medium tracking={0.08} muted>
            PRICING CALCULATOR · {street.toUpperCase()}
          </Mono>
          <Display size={32} style={{ lineHeight: 32 }}>
            Tier pricing
          </Display>
        </View>
        <Txt size={12} muted style={{ maxWidth: 360 }}>
          AI-researched parts × frequency × markup, plus labor minutes × rate and a per-visit trip fee. Changes go live in the
          homeowner app.
        </Txt>
      </Row>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {inputs.map((m) => (
          <View key={m.k} style={{ width: tileW, flexGrow: 1 }}>
            <StepperTile big label={m.label} value={m.f(s[m.k])} onDec={() => s.bump(m.k, -m.d, m.min, m.max)} onInc={() => s.bump(m.k, m.d, m.min, m.max)} />
          </View>
        ))}
      </View>

      <Table
        cols={[
          { label: 'TASK', flex: 1.6, minWidth: 200 },
          { label: 'PART (AI)', width: 150 },
          { label: 'COST', width: 80 },
          { label: 'LABOR MIN', width: 90 },
          ...TIERS.map((t, i) => ({ label: `${t.short} /YR`, width: 84, align: 'center' as const, color: i === s.tier ? c.accent : c.muted })),
        ]}
        rows={TASKS.map((t) => [
          <Txt size={13} weight="600" key="n">
            {t.name}
          </Txt>,
          <Mono size={11} muted key="p">
            {t.part}
          </Mono>,
          <Mono size={12} key="c">
            {money(t.cost)}
          </Mono>,
          <View key="m" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Tick label="-" onPress={() => s.setMinutes(t.id, -5)} />
            <Mono size={13}>{s.mins[t.id]}</Mono>
            <Tick label="+" accent onPress={() => s.setMinutes(t.id, 5)} />
          </View>,
          ...s.freq[t.id].map((f, i) => (
            <Row
              key={'f' + i}
              style={{ width: 84, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, backgroundColor: i === s.tier ? alpha(c.accent, 0.16) : c.glass }}
            >
              <Tick label="-" onPress={() => s.setFreq(t.id, i, -1)} />
              <Mono size={13} medium>
                {f}
              </Mono>
              <Tick label="+" accent onPress={() => s.setFreq(t.id, i, 1)} />
            </Row>
          )),
        ])}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {tiers.map((t, i) => {
          const mc = t.margin >= 0.35 ? STATUS.forest : t.margin >= 0.2 ? STATUS.ochre : STATUS.brick;
          return (
            <Pressable
              key={t.name}
              onPress={() => s.set({ tier: i })}
              style={{ width: tileW, flexGrow: 1, padding: 16, borderRadius: 18, backgroundColor: c.glassStrong, borderWidth: i === s.tier ? 2 : 1, borderColor: i === s.tier ? c.accent : c.rule, gap: 6 }}
            >
              <Row>
                <Txt weight="600">{t.name}</Txt>
                <Mono size={10} medium muted>
                  {t.visitsTxt}
                </Mono>
              </Row>
              <Txt>
                <Display size={36} style={{ textTransform: 'none' }}>
                  {t.monthlyTxt}
                </Display>
                <Txt size={12} muted>
                  /mo
                </Txt>
              </Txt>
              <Row>
                <Txt size={12} muted>
                  Materials
                </Txt>
                <Txt size={12} muted>
                  {t.matTxt}
                </Txt>
              </Row>
              <Row>
                <Txt size={12} muted>
                  Labor · {t.hoursTxt}
                </Txt>
                <Txt size={12} muted>
                  {t.labTxt}
                </Txt>
              </Row>
              <Row style={{ paddingTop: 6, borderTopWidth: 1, borderColor: c.rule }}>
                <Txt size={13} weight="600">
                  Annual
                </Txt>
                <Txt size={13} weight="600">
                  {t.annualTxt}
                </Txt>
              </Row>
              <Row>
                <Txt size={12} muted>
                  Gross margin
                </Txt>
                <Txt size={12} weight="600" color={mc}>
                  {t.marginTxt}
                </Txt>
              </Row>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
