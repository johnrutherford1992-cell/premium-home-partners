import { TASKS, money, type Water } from '@php/pricing';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { AppExitLink } from '../../components/AppExitLink';
import { Logo } from '../../components/brand/Logo';
import { usePhotoCapture } from '../../components/camera';
import { BlankField } from '../../components/RoleGate';
import { ErrorState, LoadingState } from '../../components/States';
import { TierPicker } from '../../components/TierPicker';
import {
  buildPlan,
  clearOnboardingDraft,
  lookupTypedAppliance,
  nextSampleIndex,
  readPlatePhoto,
  readSamplePlate,
  ensureHome,
  saveHomeAndBuild,
  startPlan,
  useDraftTiers,
  useOnboardingDraft,
  usePlanBuild,
  type ApplianceBadge,
  type DraftNumKey,
} from '../../data/homeowner';
import { usePricingInputs, type TierView } from '../../data/pricing';
import { APPLIANCES, TECH, WATER_OPTIONS, type Appliance } from '../../data/seed';
import { useSession } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';
import { useMode } from '../../lib/mode';
import { toast } from '../../lib/toast';
import { useApp } from '../../store/app';
import { useTiers } from '../../store/derived';
import { STATUS } from '../../theme/tokens';
import { MapPreview, Pill, PhotoBox, Row, Screen, Segmented, StepperTile, TextLink, Toggle } from '../../ui/controls';
import { Display, Eyebrow, LqBadge, LqButton, LqCard, LqStat, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function Onboarding() {
  const { mode } = useMode();
  return mode === 'live' ? <LiveOnboarding /> : <DemoOnboarding />;
}

// ===========================================================================
// Shared views (the markup both modes render)
// ===========================================================================

function Steps({ step, onBack, children }: { step: number; onBack: () => void; children: ReactNode }) {
  const c = usePalette();
  return (
    <>
      <Row>
        <TextLink onPress={onBack}>‹ Back</TextLink>
        <Mono size={13} muted>
          {step} / 5
        </Mono>
      </Row>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.accent : c.rule }} />
        ))}
      </View>
      {children}
    </>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const { mode } = useMode();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between', minHeight: 640 }}>
      <View style={{ marginTop: 18, gap: 12 }}>
        <AppExitLink />
        <Logo width={176} style={{ marginTop: 6 }} />
      </View>
      <View>
        <Display size={64}>{'Your home,\nlooked after.'}</Display>
        <Txt size={16} muted style={{ lineHeight: 24, marginTop: 14 }}>
          Complete care for your home, without the mental load. Scan your appliances once; we build the maintenance plan, price it, and
          handle every visit.
        </Txt>
      </View>
      <View style={{ gap: 10 }}>
        <LqButton full onPress={onStart}>
          Set up my home
        </LqButton>
        <Txt size={13} muted style={{ textAlign: 'center' }}>
          {mode === 'live' ? 'About 5 minutes' : 'About 5 minutes · no account needed yet'}
        </Txt>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, ...input }: { label: string; value: string; onChangeText: (v: string) => void } & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const c = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={{ padding: 14, borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule, fontSize: 16, color: c.ink }}
      />
    </View>
  );
}

function AddressView({
  name,
  addr,
  onName,
  onAddr,
  onContinue,
  addrPlaceholder,
}: {
  name: string;
  addr: string;
  onName: (v: string) => void;
  onAddr: (v: string) => void;
  onContinue: () => void;
  addrPlaceholder?: string;
}) {
  return (
    <>
      <Display>Where's home?</Display>
      <Field label="YOUR NAME" value={name} onChangeText={onName} />
      <Field label="SERVICE ADDRESS" value={addr} onChangeText={onAddr} placeholder={addrPlaceholder} />
      <MapPreview />
      <Txt size={13} muted>
        Inside our service area. Your technician is {TECH.name}.
      </Txt>
      <LqButton full onPress={onContinue} disabled={!name.trim() || !addr.trim()}>
        Continue
      </LqButton>
    </>
  );
}

function ScanIntro() {
  return (
    <View>
      <Display>Scan serial plates</Display>
      <Txt size={14} muted style={{ marginTop: 6, lineHeight: 20 }}>
        Tap the shutter to capture each label. We'll find the manual, parts and schedule.
      </Txt>
    </View>
  );
}

/** The 220pt viewfinder with the sample plate card, the accent bounding box and the hint pill. */
function PlateBox({ plate, busy, hint }: { plate: Appliance; busy: boolean; hint: string }) {
  const c = usePalette();
  return (
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
        style={{ position: 'absolute', left: 60, right: 60, top: 52, bottom: 52, borderWidth: 2.5, borderColor: c.accent, borderRadius: 14, opacity: busy ? 1 : 0.35 }}
      />
      <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: c.glassStrong, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 }}>
        <Mono size={11} medium>
          {hint}
        </Mono>
      </View>
    </PhotoBox>
  );
}

/** The 64pt shutter. Live dims it once every sample plate is in (demo keeps its original look). */
function ShutterButton({ onPress, busy, disabled, dimmed }: { onPress: () => void; busy: boolean; disabled?: boolean; dimmed?: boolean }) {
  const c = usePalette();
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel="Capture serial plate"
        accessibilityState={disabled ? { disabled: true, busy } : undefined}
        style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: dimmed ? 0.5 : 1 }}
      >
        <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: c.accent, opacity: busy ? 0.4 : 1 }} />
      </Pressable>
    </View>
  );
}

const BADGE: Record<ApplianceBadge, { label: string; tone: 'forest' | 'slate' | 'ochre' }> = {
  matched: { label: 'Matched', tone: 'forest' },
  ai: { label: 'Read by AI', tone: 'slate' },
  unverified: { label: 'Unverified', tone: 'ochre' },
};

function ApplianceList({ items }: { items: { key: string; name: string; model: string; note: string; badge: ApplianceBadge }[] }) {
  const c = usePalette();
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.rule }}>
      {items.map((ap) => (
        <Row key={ap.key} style={{ paddingVertical: 9, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: c.rule, gap: 10 }}>
          <View style={{ flexShrink: 1 }}>
            <Txt size={13} weight="600">
              {ap.name}
            </Txt>
            <Mono size={11} muted>
              {ap.note ? `${ap.model} · ${ap.note}` : ap.model}
            </Mono>
          </View>
          <LqBadge tone={BADGE[ap.badge].tone}>{BADGE[ap.badge].label}</LqBadge>
        </Row>
      ))}
    </View>
  );
}

type Tile = { k: DraftNumKey; label: string; d: number; min: number; max: number; f?: (x: number) => string | number };

interface DetailsValues {
  sqft: number;
  year: number;
  beds: number;
  baths: number;
  floors: number;
  zones: number;
  pets: boolean;
  water: Water;
}

function DetailsView({
  v,
  onBump,
  onPets,
  onWater,
  onBuild,
  building,
  error,
}: {
  v: DetailsValues;
  onBump: (k: DraftNumKey, d: number, min: number, max: number) => void;
  onPets: () => void;
  onWater: (w: Water) => void;
  onBuild: () => void;
  building?: boolean;
  error?: string | null;
}) {
  const c = usePalette();
  const tile = ({ k, label, d, min, max, f = (x) => x }: Tile) => (
    <StepperTile key={k} label={label} value={f(v[k])} onDec={() => onBump(k, -d, min, max)} onInc={() => onBump(k, d, min, max)} />
  );
  const insight =
    (v.pets ? 'Pets → HVAC filters every 60 days instead of 90. ' : '') +
    (v.water === 'city_hard'
      ? 'Hard water → heater flush twice a year.'
      : v.water === 'well'
        ? 'Well water → sediment check added to each flush.'
        : 'Softened water → standard flush interval.') +
    (new Date().getFullYear() - v.year > 15 ? " Older home: we'll add a baseline inspection." : '');
  return (
    <>
      <Display>About the home</Display>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile({ k: 'sqft', label: 'Sq ft', d: 100, min: 600, max: 12000, f: (x) => x.toLocaleString('en-US') })}
          {tile({ k: 'year', label: 'Year built', d: 1, min: 1900, max: new Date().getFullYear() })}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile({ k: 'beds', label: 'Bedrooms', d: 1, min: 1, max: 12 })}
          {tile({ k: 'baths', label: 'Bathrooms', d: 0.5, min: 1, max: 10 })}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tile({ k: 'floors', label: 'Floors', d: 1, min: 1, max: 4 })}
          {tile({ k: 'zones', label: 'HVAC zones', d: 1, min: 1, max: 6 })}
        </View>
      </View>
      <View style={{ borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
        <Pressable onPress={onPets} accessibilityRole="switch" accessibilityState={{ checked: v.pets }}>
          <Row style={{ paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: c.rule }}>
            <Txt>Pets in home</Txt>
            <Toggle on={v.pets} />
          </Row>
        </Pressable>
        <Row style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
          <Txt>Water</Txt>
          <Segmented options={WATER_OPTIONS} value={v.water} onChange={onWater} />
        </Row>
      </View>
      <Txt size={12} muted style={{ lineHeight: 17 }}>
        {insight}
      </Txt>
      <LqButton full onPress={onBuild} disabled={building}>
        {building ? 'Building…' : 'Build my plan'}
      </LqButton>
      {error ? <InlineError message={error} /> : null}
    </>
  );
}

function InlineError({ message }: { message: string }) {
  const c = usePalette();
  return (
    <Txt testID="onboarding-error" size={13} color={c.status.brick} accessibilityRole="alert" style={{ lineHeight: 19 }}>
      {message}
    </Txt>
  );
}

function ResearchView({
  progress,
  lines,
  parts,
  onNext,
}: {
  progress: number;
  lines: { t: string; at: number }[];
  parts: { id: string; part: string; cost: number }[] | null;
  onNext: () => void;
}) {
  const c = usePalette();
  return (
    <>
      <Display>Researching your home</Display>
      <View testID="research-progress">
        <LqStat label="Plan build" value={progress + '%'} sub={progress < 100 ? 'Reading manuals and pricing parts…' : 'Ready: 4 plan options'} />
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.rule, overflow: 'hidden' }}>
        <View style={{ width: `${progress}%`, height: '100%', backgroundColor: c.accent }} />
      </View>
      <View style={{ borderTopWidth: 1, borderColor: c.rule }}>
        {lines.map((l) => {
          const d = progress >= l.at;
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
          <Row key={p.id} style={{ paddingTop: 6, gap: 10 }}>
            <Txt size={13} style={{ flexShrink: 1 }}>
              {p.part}
            </Txt>
            <Mono size={13}>{p.cost >= 0 ? money(p.cost) : ''}</Mono>
          </Row>
        ))}
      </LqCard>
      <LqButton full onPress={onNext} disabled={progress < 100}>
        See my plan options
      </LqButton>
    </>
  );
}

function TiersView({
  count,
  tiers,
  selected,
  onSelect,
  onStart,
  starting,
  error,
}: {
  count: number;
  tiers: TierView[];
  selected: number;
  onSelect: (i: number) => void;
  onStart: () => void;
  starting?: boolean;
  error?: string | null;
}) {
  const cur = tiers[selected] ?? tiers[1];
  return (
    <>
      <View>
        <Display>Choose your coverage</Display>
        <Txt size={14} muted style={{ marginTop: 6 }}>
          {Math.max(count, 1)} appliances · {TASKS.length} manufacturer tasks · parts and labor included
        </Txt>
      </View>
      <TierPicker tiers={tiers} selected={selected} onSelect={onSelect} disabled={starting} />
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
      <View testID="onboarding-start">
        <LqButton full onPress={onStart} disabled={starting}>
          {starting ? 'Starting…' : `Start ${cur.name}`}
        </LqButton>
      </View>
      {error ? <InlineError message={error} /> : null}
    </>
  );
}

// ===========================================================================
// Offline demo: the shared store, exactly as before
// ===========================================================================

function DemoOnboarding() {
  const step = useApp((s) => s.step);
  const goStep = useApp((s) => s.goStep);
  return (
    <Screen>
      {step === 0 ? (
        <Welcome onStart={() => goStep(1)} />
      ) : (
        <Steps step={step} onBack={() => goStep(Math.max(0, step - 1))}>
          {step === 1 && <DemoAddress />}
          {step === 2 && <DemoScan />}
          {step === 3 && <DemoDetails />}
          {step === 4 && <DemoResearch />}
          {step === 5 && <DemoTiers />}
        </Steps>
      )}
    </Screen>
  );
}

function DemoAddress() {
  const { name, addr, set, goStep } = useApp();
  return <AddressView name={name} addr={addr} onName={(v) => set({ name: v })} onAddr={(v) => set({ addr: v })} onContinue={() => goStep(2)} />;
}

function DemoScan() {
  const { scanned, scanning, shutter, goStep } = useApp();
  const plate = APPLIANCES[Math.min(scanned, APPLIANCES.length - 1)];
  const all = scanned >= APPLIANCES.length;
  const hint = scanning ? 'Reading plate…' : all ? 'All 5 appliances found' : `Tap shutter · ${scanned} of 5 captured`;
  const cta = scanned === 0 ? 'Capture at least one' : !all ? `Continue with ${scanned} appliance${scanned > 1 ? 's' : ''}` : 'Continue';
  const items = APPLIANCES.slice(0, scanned)
    .reverse()
    .map((ap) => ({ key: ap.model, name: ap.name, model: ap.model, note: ap.note, badge: 'matched' as const }));
  return (
    <>
      <ScanIntro />
      <PlateBox plate={plate} busy={scanning} hint={hint} />
      <ShutterButton onPress={shutter} busy={scanning} />
      <ApplianceList items={items} />
      <LqButton full onPress={() => goStep(3)} disabled={scanned === 0}>
        {cta}
      </LqButton>
    </>
  );
}

function DemoDetails() {
  const s = useApp();
  return <DetailsView v={s} onBump={s.bump} onPets={() => s.set({ pets: !s.pets })} onWater={(w) => s.set({ water: w })} onBuild={() => s.goStep(4)} />;
}

function DemoResearch() {
  const { research, scanned, pets, water, goStep } = useApp();
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
  return <ResearchView progress={research} lines={lines} parts={parts} onNext={() => goStep(5)} />;
}

function DemoTiers() {
  const { tiers } = useTiers();
  const scanned = useApp((s) => s.scanned);
  const tier = useApp((s) => s.tier);
  const set = useApp((s) => s.set);
  return (
    <TiersView
      count={scanned}
      tiers={tiers}
      selected={tier}
      onSelect={(i) => set({ tier: i })}
      onStart={() => {
        set({ step: 6 });
        router.replace('/homeowner/home');
      }}
    />
  );
}

// ===========================================================================
// Live: a per-user draft, real lookups, the plan build and start_plan
// ===========================================================================

type Draft = ReturnType<typeof useOnboardingDraft>['draft'];

function LiveOnboarding() {
  const { draft, hydrated } = useOnboardingDraft();
  usePricingInputs(); // warm the pricing cache for the plan options on step 5
  if (!hydrated) return <BlankField />;
  const step = Math.max(0, Math.min(5, draft.step));
  const goStep = (n: number) => draft.set({ step: n });
  return (
    <Screen>
      {step === 0 ? (
        <Welcome onStart={() => goStep(1)} />
      ) : (
        <Steps step={step} onBack={() => goStep(Math.max(0, step - 1))}>
          {step === 1 && (
            <AddressView
              name={draft.name}
              addr={draft.addr}
              onName={(v) => draft.set({ name: v })}
              onAddr={(v) => draft.set({ addr: v })}
              onContinue={() => goStep(2)}
              addrPlaceholder="Street, city, ZIP"
            />
          )}
          {step === 2 && <LiveScan draft={draft} />}
          {step === 3 && <LiveDetails draft={draft} />}
          {step === 4 && <LiveResearch key={draft.buildId ?? 'none'} draft={draft} />}
          {step === 5 && <LiveTiers draft={draft} />}
        </Steps>
      )}
    </Screen>
  );
}

const normModel = (m: string) => m.toUpperCase().replace(/\s+/g, '');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function LiveScan({ draft }: { draft: Draft }) {
  const c = usePalette();
  const camera = usePhotoCapture();
  const [busy, setBusy] = useState<null | 'sample' | 'photo'>(null);
  const [manual, setManual] = useState(false);

  const idx = nextSampleIndex(draft.appliances);
  const have = new Set(draft.appliances.map((a) => normModel(a.model)));
  const samples = APPLIANCES.filter((a) => have.has(normModel(a.model))).length;
  const plate = APPLIANCES[idx ?? APPLIANCES.length - 1];
  const count = draft.appliances.length;
  const hint = busy ? 'Reading plate…' : idx === null ? 'All 5 appliances found' : `Tap shutter · ${samples} of 5 captured`;
  const cta = count === 0 ? 'Capture at least one' : idx !== null ? `Continue with ${count} appliance${count > 1 ? 's' : ''}` : 'Continue';

  const onShutter = () => {
    if (busy || idx === null) return;
    setBusy('sample');
    const started = Date.now();
    void readSamplePlate(idx).then(async (a) => {
      const wait = 1100 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      draft.addAppliance(a);
      setBusy(null);
    });
  };

  const onRealPlate = () => {
    if (busy) return;
    let pick: Promise<{ base64: string } | null>;
    try {
      // Straight from the tap: on web this opens the file picker (the camera on phones).
      pick = camera.capture({ title: 'Serial plate' });
    } catch (e) {
      toast(friendlyError(e), 'brick');
      return;
    }
    pick.then(
      async (photo) => {
        if (!photo) return;
        setBusy('photo');
        try {
          draft.addAppliance(await readPlatePhoto(photo.base64));
        } catch (e) {
          toast(friendlyError(e), 'brick');
          setManual(true);
        } finally {
          setBusy(null);
        }
      },
      (e) => toast(friendlyError(e), 'brick'),
    );
  };

  const items = [...draft.appliances].reverse();
  return (
    <>
      <ScanIntro />
      <PlateBox plate={plate} busy={!!busy} hint={hint} />
      <ShutterButton onPress={onShutter} busy={busy === 'sample'} disabled={!!busy || idx === null} dimmed={idx === null && !busy} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, opacity: busy ? 0.5 : 1 }}>
        <View testID="scan-real-plate">
          <Pill label="Photo of a real plate" bg="transparent" ink={c.ink} border={c.rule} onPress={busy ? undefined : onRealPlate} />
        </View>
        <View testID="scan-manual">
          <Pill label="Enter manually" bg={manual ? c.glassStrong : 'transparent'} ink={c.ink} border={c.rule} onPress={busy ? undefined : () => setManual((m) => !m)} />
        </View>
      </View>
      {manual ? <ManualEntry onAdd={(a) => draft.addAppliance(a)} onClose={() => setManual(false)} /> : null}
      <ApplianceList items={items} />
      <LqButton full onPress={() => draft.set({ step: 3 })} disabled={count === 0 || !!busy}>
        {cta}
      </LqButton>
    </>
  );
}

function ManualEntry({ onAdd, onClose }: { onAdd: (a: Awaited<ReturnType<typeof lookupTypedAppliance>>) => void; onClose: () => void }) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [adding, setAdding] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const add = async () => {
    if (adding || !model.trim()) return;
    setAdding(true);
    // Never blocks: an unknown model is added as "Unverified".
    const a = await lookupTypedAppliance({ brand, model, serial });
    onAdd(a);
    if (!alive.current) return;
    setAdding(false);
    setBrand('');
    setModel('');
    setSerial('');
    onClose();
  };
  return (
    <LqCard style={{ gap: 12 }}>
      <View testID="manual-entry" style={{ gap: 12 }}>
        <Field label="BRAND" value={brand} onChangeText={setBrand} placeholder="e.g. Carrier" autoCapitalize="characters" />
        <Field label="MODEL" value={model} onChangeText={setModel} placeholder="e.g. 59TN6B100V21" autoCapitalize="characters" autoCorrect={false} />
        <Field label="SERIAL" value={serial} onChangeText={setSerial} placeholder="Optional" autoCapitalize="characters" autoCorrect={false} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <LqButton style={{ flex: 1 }} onPress={() => void add()} disabled={adding || !model.trim()}>
          {adding ? 'Adding…' : 'Add appliance'}
        </LqButton>
        <LqButton variant="ghost" onPress={onClose} disabled={adding}>
          Cancel
        </LqButton>
      </View>
    </LqCard>
  );
}

function LiveDetails({ draft }: { draft: Draft }) {
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onBuild = async () => {
    if (building) return;
    setBuilding(true);
    setError(null);
    try {
      const { homeId, buildId } = await saveHomeAndBuild(draft);
      draft.set({ homeId, buildId, step: 4, standardPricing: false });
    } catch (e) {
      setError(friendlyError(e));
      setBuilding(false);
    }
  };
  return (
    <DetailsView
      v={draft}
      onBump={draft.bump}
      onPets={() => draft.set({ pets: !draft.pets })}
      onWater={(w) => draft.set({ water: w })}
      onBuild={() => void onBuild()}
      building={building}
      error={error}
    />
  );
}

/** Progress shown per build, so stepping back to the research screen doesn't replay it. */
const shownProgress = new Map<string, number>();
const STALL_MS = 20_000;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function LiveResearch({ draft }: { draft: Draft }) {
  const buildId = draft.buildId;
  const build = usePlanBuild(buildId);
  const server = build.data?.progress ?? 0;
  const [shown, setShown] = useState(() => (buildId ? (shownProgress.get(buildId) ?? 0) : 0));
  const [stalled, setStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Glide toward the server's progress, at most 3% per 90 ms tick.
  useEffect(() => {
    if (shown >= server) return;
    const t = setTimeout(() => setShown((s) => Math.min(server, s + 3)), 90);
    return () => clearTimeout(t);
  }, [shown, server]);
  useEffect(() => {
    if (buildId) shownProgress.set(buildId, shown);
  }, [buildId, shown]);

  // No progress for 20 s counts as a failed build.
  useEffect(() => {
    setStalled(false);
    if (!buildId || server >= 100) return;
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [buildId, server]);

  const failed = !buildId || build.data?.step === 'error' || stalled || (!!build.error && !build.data);
  const message =
    retryError ??
    build.data?.error ??
    build.error ??
    (stalled ? 'Building your plan is taking longer than it should. Try again.' : "We couldn't finish building your plan. Try again.");

  const retry = async () => {
    if (retrying) return;
    if (!draft.name.trim() || !draft.addr.trim()) {
      draft.set({ step: 1 });
      return;
    }
    setRetrying(true);
    setRetryError(null);
    try {
      // Re-save first: a demo reset may have deleted the home this draft points at.
      const homeId = await ensureHome(draft);
      const id = await buildPlan(homeId);
      draft.set({ homeId, buildId: id }); // remounts this screen for the new build
    } catch (e) {
      setRetryError(friendlyError(e));
      setRetrying(false);
    }
  };

  if (failed && server < 100) {
    return (
      <>
        <Display>Researching your home</Display>
        <ErrorState title="We couldn't finish your plan" message={message} onRetry={retrying ? undefined : () => void retry()} />
        {retrying ? <LoadingState label="Starting over…" /> : null}
        <LqButton full variant="ghost" onPress={() => draft.set({ step: 5, standardPricing: true })} disabled={retrying}>
          Use standard pricing
        </LqButton>
      </>
    );
  }

  const s = build.data?.summary ?? null;
  const n = Math.max(draft.appliances.length, 1);
  const adj = [draft.pets && 'pets', draft.water === 'city_hard' && 'hard water', draft.water === 'well' && 'well water'].filter(Boolean).join(' + ') || 'your home';
  const plates = server >= 8 && s?.appliances ? s.appliances : n;
  const manuals = server >= 28 && s ? s.manuals : n;
  const priced = server >= 74 && s && s.parts.length ? `Priced ${plural(s.parts.length, 'part', 'parts')} at ${plural(s.suppliers, 'supplier', 'suppliers')}` : 'Priced 9 parts at 5 suppliers';
  const lines = [
    { t: `Reading ${plural(plates, 'serial plate', 'serial plates')}`, at: 8 },
    { t: `Found ${plural(manuals, 'manufacturer manual', 'manufacturer manuals')}`, at: 28 },
    { t: `Mapped ${TASKS.length} maintenance tasks`, at: 50 },
    { t: priced, at: 74 },
    { t: `Adjusted for ${adj}`, at: 94 },
  ];
  const parts = shown >= 74 && s && s.parts.length ? s.parts.map((p, i) => ({ id: `${i}`, part: p.name, cost: p.price })) : null;
  return <ResearchView progress={shown} lines={lines} parts={parts} onNext={() => draft.set({ step: 5, standardPricing: false })} />;
}

function LiveTiers({ draft }: { draft: Draft }) {
  const { userId } = useSession();
  const home = useMemo(() => ({ pets: draft.pets, water: draft.water }), [draft.pets, draft.water]);
  const { tiers, inputs } = useDraftTiers(home);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!tiers || !inputs) return <LoadingState label="Pricing your plan options…" />;
  const selected = tiers[draft.tier] ? draft.tier : 1;

  const onStart = async () => {
    if (starting) return;
    if (!draft.name.trim() || !draft.addr.trim()) {
      setError('Your home details are missing. Go back to the start and add your address.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // Re-save first: a demo reset may have deleted the home this draft points at.
      const homeId = await ensureHome(draft);
      draft.set({ homeId });
      await startPlan({ userId, homeId, tierIndex: selected, tier: tiers[selected], inputs, home });
      router.replace('/homeowner/home');
      clearOnboardingDraft(userId);
    } catch (e) {
      setError(friendlyError(e));
      setStarting(false);
    }
  };

  return (
    <TiersView
      count={draft.appliances.length}
      tiers={tiers}
      selected={selected}
      onSelect={(i) => draft.set({ tier: i })}
      onStart={() => void onStart()}
      starting={starting}
      error={error}
    />
  );
}

