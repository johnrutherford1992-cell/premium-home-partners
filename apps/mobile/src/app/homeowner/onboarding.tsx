import { TASKS, money } from '@php/pricing';
import { router } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import { APPLIANCES, TECH, WATER_OPTIONS } from '../../data/seed';
import { useApp } from '../../store/app';
import { useTiers } from '../../store/derived';
import { MapPreview, PhotoBox, Row, Screen, Segmented, StepperTile, TextLink, Toggle } from '../../ui/controls';
import { Display, Eyebrow, LqBadge, LqButton, LqCard, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { STATUS } from '../../theme/tokens';
import { TierPicker } from '../../components/TierPicker';

export default function Onboarding() {
  const step = useApp((s) => s.step);
  const goStep = useApp((s) => s.goStep);
  const c = usePalette();

  return (
    <Screen>
      {step === 0 ? (
        <Welcome />
      ) : (
        <>
          <Row>
            <TextLink onPress={() => goStep(Math.max(0, step - 1))}>‹ Back</TextLink>
            <Mono size={13} muted>
              {step} / 5
            </Mono>
          </Row>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.accent : c.rule }} />
            ))}
          </View>
          {step === 1 && <Address />}
          {step === 2 && <Scan />}
          {step === 3 && <Details />}
          {step === 4 && <Research />}
          {step === 5 && <Tiers />}
        </>
      )}
    </Screen>
  );
}

function Welcome() {
  const goStep = useApp((s) => s.goStep);
  return (
    <View style={{ flex: 1, justifyContent: 'space-between', minHeight: 640 }}>
      <View style={{ marginTop: 18, gap: 12 }}>
        <TextLink onPress={() => router.replace('/')}>‹ All apps</TextLink>
        <Mono size={12} medium tracking={0.14} accent>
          PREMIUM HOME PARTNERS
        </Mono>
      </View>
      <View>
        <Display size={64}>{'Your home,\nlooked after.'}</Display>
        <Txt size={16} muted style={{ lineHeight: 24, marginTop: 14 }}>
          Scan your appliances once. We build the manufacturer's maintenance schedule, price it, and handle every visit.
        </Txt>
      </View>
      <View style={{ gap: 10 }}>
        <LqButton full onPress={() => goStep(1)}>
          Set up my home
        </LqButton>
        <Txt size={13} muted style={{ textAlign: 'center' }}>
          About 5 minutes · no account needed yet
        </Txt>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  const c = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={{ padding: 14, borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule, fontSize: 16, color: c.ink }}
      />
    </View>
  );
}

function Address() {
  const { name, addr, set, goStep } = useApp();
  return (
    <>
      <Display>Where's home?</Display>
      <Field label="YOUR NAME" value={name} onChangeText={(v) => set({ name: v })} />
      <Field label="SERVICE ADDRESS" value={addr} onChangeText={(v) => set({ addr: v })} />
      <MapPreview />
      <Txt size={13} muted>
        Inside our service area. Your technician is {TECH.name}.
      </Txt>
      <LqButton full onPress={() => goStep(2)} disabled={!name.trim() || !addr.trim()}>
        Continue
      </LqButton>
    </>
  );
}

function Scan() {
  const { scanned, scanning, shutter, goStep } = useApp();
  const c = usePalette();
  const plate = APPLIANCES[Math.min(scanned, APPLIANCES.length - 1)];
  const all = scanned >= APPLIANCES.length;
  const hint = scanning ? 'Reading plate…' : all ? 'All 5 appliances found' : `Tap shutter · ${scanned} of 5 captured`;
  const cta = scanned === 0 ? 'Capture at least one' : !all ? `Continue with ${scanned} appliance${scanned > 1 ? 's' : ''}` : 'Continue';
  return (
    <>
      <View>
        <Display>Scan serial plates</Display>
        <Txt size={14} muted style={{ marginTop: 6, lineHeight: 20 }}>
          Tap the shutter to capture each label. We'll find the manual, parts and schedule.
        </Txt>
      </View>
      <PhotoBox height={220} radius={22} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 220,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 8,
            backgroundColor: c.paper,
            transform: [{ rotate: '-3deg' }],
            boxShadow: `0 8px 20px -8px ${c.sh}`,
          }}
        >
          <Mono size={10} medium style={{ lineHeight: 17 }}>
            {plate.brand}
          </Mono>
          <Mono size={10} style={{ lineHeight: 17 }}>
            MODEL <Mono size={10} weight="700">{plate.model}</Mono>
          </Mono>
          <Mono size={10} style={{ lineHeight: 17 }}>
            SERIAL <Mono size={10} weight="700">{plate.serial}</Mono>
          </Mono>
        </View>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 60, right: 60, top: 52, bottom: 52, borderWidth: 2.5, borderColor: c.accent, borderRadius: 14, opacity: scanning ? 1 : 0.35 }}
        />
        <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: c.glassStrong, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 }}>
          <Mono size={11} medium>
            {hint}
          </Mono>
        </View>
      </PhotoBox>
      <View style={{ alignItems: 'center' }}>
        <Pressable
          onPress={shutter}
          accessibilityLabel="Capture serial plate"
          style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: c.accent, opacity: scanning ? 0.4 : 1 }} />
        </Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderColor: c.rule }}>
        {APPLIANCES.slice(0, scanned)
          .reverse()
          .map((ap) => (
            <Row key={ap.model} style={{ paddingVertical: 9, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: c.rule }}>
              <View>
                <Txt size={13} weight="600">
                  {ap.name}
                </Txt>
                <Mono size={11} muted>
                  {ap.model} · {ap.note}
                </Mono>
              </View>
              <LqBadge tone="forest">Matched</LqBadge>
            </Row>
          ))}
      </View>
      <LqButton full onPress={() => goStep(3)} disabled={scanned === 0}>
        {cta}
      </LqButton>
    </>
  );
}

function Details() {
  const s = useApp();
  const c = usePalette();
  const tile = (k: 'sqft' | 'year' | 'beds' | 'baths' | 'floors' | 'zones', label: string, d: number, min: number, max: number, f: (x: number) => string | number = (x) => x) => (
    <StepperTile key={k} label={label} value={f(s[k])} onDec={() => s.bump(k, -d, min, max)} onInc={() => s.bump(k, d, min, max)} />
  );
  const insight =
    (s.pets ? 'Pets → HVAC filters every 60 days instead of 90. ' : '') +
    (s.water === 'city_hard'
      ? 'Hard water → heater flush twice a year.'
      : s.water === 'well'
        ? 'Well water → sediment check added to each flush.'
        : 'Softened water → standard flush interval.') +
    (new Date().getFullYear() - s.year > 15 ? " Older home: we'll add a baseline inspection." : '');
  return (
    <>
      <Display>About the home</Display>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile('sqft', 'Sq ft', 100, 600, 12000, (x) => x.toLocaleString('en-US'))}
          {tile('year', 'Year built', 1, 1900, new Date().getFullYear())}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile('beds', 'Bedrooms', 1, 1, 12)}
          {tile('baths', 'Bathrooms', 0.5, 1, 10)}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile('floors', 'Floors', 1, 1, 4)}
          {tile('zones', 'HVAC zones', 1, 1, 6)}
        </View>
      </View>
      <View style={{ borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
        <Pressable onPress={() => s.set({ pets: !s.pets })} accessibilityRole="switch" accessibilityState={{ checked: s.pets }}>
          <Row style={{ paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: c.rule }}>
            <Txt>Pets in home</Txt>
            <Toggle on={s.pets} />
          </Row>
        </Pressable>
        <Row style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
          <Txt>Water</Txt>
          <Segmented options={WATER_OPTIONS} value={s.water} onChange={(w) => s.set({ water: w })} />
        </Row>
      </View>
      <Txt size={12} muted style={{ lineHeight: 17 }}>
        {insight}
      </Txt>
      <LqButton full onPress={() => s.goStep(4)}>
        Build my plan
      </LqButton>
    </>
  );
}

function Research() {
  const { research, scanned, pets, water, goStep } = useApp();
  const c = usePalette();
  const n = Math.max(scanned, 1);
  const adj = [pets && 'pets', water === 'city_hard' && 'hard water', water === 'well' && 'well water'].filter(Boolean).join(' + ') || 'your home';
  const lines = [
    { t: `Reading ${n} serial plates`, at: 8 },
    { t: `Found ${n} manufacturer manuals`, at: 28 },
    { t: `Mapped ${TASKS.length} maintenance tasks`, at: 50 },
    { t: 'Priced 9 parts at 5 suppliers', at: 74 },
    { t: `Adjusted for ${adj}`, at: 94 },
  ];
  const parts = research >= 74 ? TASKS.filter((t) => t.cost > 5).slice(0, 4) : null;
  return (
    <>
      <Display>Researching your home</Display>
      <LqStat label="Plan build" value={research + '%'} sub={research < 100 ? 'Reading manuals and pricing parts…' : 'Ready: 4 plan options'} />
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.rule, overflow: 'hidden' }}>
        <View style={{ width: `${research}%`, height: '100%', backgroundColor: c.accent }} />
      </View>
      <View style={{ borderTopWidth: 1, borderColor: c.rule }}>
        {lines.map((l) => {
          const d = research >= l.at;
          return (
            <View key={l.at} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: c.rule, opacity: d ? 1 : 0.4 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: d ? STATUS.forest : c.rule, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={11} color="#fff">
                  {d ? '✓' : ''}
                </Txt>
              </View>
              <Txt>{l.t}</Txt>
            </View>
          );
        })}
      </View>
      <LqCard>
        <Eyebrow>PARTS PRICED</Eyebrow>
        {(parts ?? [{ id: 'x', part: 'Searching suppliers…', cost: -1 }]).map((p) => (
          <Row key={p.id} style={{ paddingTop: 6 }}>
            <Txt size={13}>{p.part}</Txt>
            <Mono size={13}>{p.cost >= 0 ? money(p.cost) : ''}</Mono>
          </Row>
        ))}
      </LqCard>
      <LqButton full onPress={() => goStep(5)} disabled={research < 100}>
        See my plan options
      </LqButton>
    </>
  );
}

function Tiers() {
  const { cur } = useTiers();
  const scanned = useApp((s) => s.scanned);
  const set = useApp((s) => s.set);
  return (
    <>
      <View>
        <Display>Choose your coverage</Display>
        <Txt size={14} muted style={{ marginTop: 6 }}>
          {Math.max(scanned, 1)} appliances · {TASKS.length} manufacturer tasks · parts and labor included
        </Txt>
      </View>
      <TierPicker />
      <LqCard>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            ['MATERIALS', cur.matTxt, false],
            ['LABOR', cur.labTxt, false],
            ['PER YEAR', cur.annualTxt, true],
          ].map(([k, v, acc]) => (
            <View key={k as string} style={{ flex: 1 }}>
              <Eyebrow>{k}</Eyebrow>
              <Txt size={17} weight="600" accent={acc as boolean} style={{ marginTop: 2 }}>
                {v}
              </Txt>
            </View>
          ))}
        </View>
        <Txt size={12} muted style={{ marginTop: 10, lineHeight: 17 }}>
          Covers {cur.covTxt} of the manufacturer-recommended service for your appliances.
        </Txt>
      </LqCard>
      <LqButton
        full
        onPress={() => {
          set({ step: 6 });
          router.replace('/homeowner/home');
        }}
      >
        {`Start ${cur.name}`}
      </LqButton>
    </>
  );
}
