// The sign-up screen: Liquid Glass in the Premium Home Partners colors, with
// the voice of premiumhomepartners.com. Presentational only: app/signup.tsx
// owns the values, validation and submit.
//
// Phone (one column): kitchen hero with the logo and headline, the concierge
// promise on a navy band, then the form and "What happens next" as glass cards
// over the bloom field, and the footer. From 900pt wide: two columns, the
// photo, promise and steps on the left and the form card on the right, each
// scrolling on its own.

import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, type ReactNode, type Ref } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, RADIUS, alpha } from '../../theme/tokens';
import { Stage } from '../../ui/controls';
import { Display, Eyebrow, LqButton, LqCard, Mono, Txt } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { Logo } from './Logo';

export type SignupField = 'firstName' | 'lastName' | 'email' | 'phone';
export type SignupValues = Record<SignupField, string>;
export type SignupErrors = Partial<Record<SignupField | 'form', string>>;

export interface SignupViewProps {
  values: SignupValues;
  /** A message per field (shown under it) and `form` for the whole form (shown under the button). */
  errors: SignupErrors;
  busy: boolean;
  onChange: (field: SignupField, value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

const KITCHEN = require('../../../assets/brand/kitchen.jpg');
/** The photo overlay is the site's navy in both themes. */
const NAVY = BRAND.navy;

/** The site's headline, set as two balanced lines. */
const HEADLINE = 'Enjoy your home,\nnot the hassle.';
/** The site's promise, word for word. */
const PROMISE =
  'Premium Home Partners serves as your private home concierge, handling maintenance, coordination, and ongoing care so your home runs smoothly in the background of your life.';
/** The same promise, shortened for the phone band so the form starts near the fold. */
const PROMISE_SHORT =
  'Your private home concierge, handling maintenance, coordination, and ongoing care so your home runs smoothly in the background of your life.';

const STEPS = [
  {
    title: 'Property assessment',
    body: "Scan your home's systems and appliances. We find every manual and service interval, so nothing important is overlooked.",
  },
  {
    title: 'Customized care plan',
    body: 'A tailored plan of routine, seasonal and preventive care, priced for your home. Not a generic checklist.',
  },
  {
    title: 'Ongoing management',
    body: 'One trusted point of contact handles scheduling, vetted service partners and quality oversight, with a photo report after every visit.',
  },
] as const;

const TRUST = ['Vetted service partners', 'One point of contact', 'Discretion, always'] as const;

export function SignupView(props: SignupViewProps) {
  const { width } = useWindowDimensions();
  return width >= 900 ? <WideLayout {...props} /> : <NarrowLayout {...props} pairNames={width >= 560} />;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function NarrowLayout(props: SignupViewProps & { pairNames: boolean }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Stage>
      <StatusBar style="light" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <PhotoPanel style={{ minHeight: 300 + insets.top, paddingTop: insets.top + 14, paddingBottom: 28, paddingHorizontal: 22 }} strength="hero">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Logo tone="white" width={150} />
            <BackLink onBack={props.onBack} onBand />
          </View>
          <View style={{ flex: 1, minHeight: 40 }} />
          <Eyebrow style={{ color: c.bandMuted, marginBottom: 10 }}>Welcome home</Eyebrow>
          <Display size={40} color={c.bandInk} accessibilityRole="header">
            {HEADLINE}
          </Display>
        </PhotoPanel>

        <View style={{ backgroundColor: c.band, paddingVertical: 26, paddingHorizontal: 26 }}>
          <Txt size={16} color={c.bandInk} style={{ textAlign: 'center', lineHeight: 24, maxWidth: 520, alignSelf: 'center' }}>
            {PROMISE_SHORT}
          </Txt>
        </View>

        <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 30, gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <LqCard strong style={{ padding: 20 }}>
            <SignupForm {...props} />
          </LqCard>
          <LqCard style={{ padding: 20 }}>
            <NextSteps />
          </LqCard>
        </View>

        <Footer style={{ paddingBottom: insets.bottom + 28 }} />
      </ScrollView>
    </Stage>
  );
}

function WideLayout(props: SignupViewProps) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.field }}>
      <PhotoPanel style={{ flex: 1.15 }} strength="panel">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 36, paddingHorizontal: 56 }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 620, gap: 30 }}>
            <Logo tone="white" width={196} />
            <View style={{ flex: 1, minHeight: 24 }} />
            <Display size={60} color={c.bandInk} accessibilityRole="header">
              {HEADLINE}
            </Display>
            <Txt size={18} color={c.bandInk} style={{ lineHeight: 28, opacity: 0.94 }}>
              {PROMISE}
            </Txt>
            <View style={{ height: 1, backgroundColor: alpha(c.bandInk, 0.24) }} />
            <NextSteps onBand />
            <Footer onPhoto />
          </View>
        </ScrollView>
      </PhotoPanel>

      <Stage style={{ flex: 0, width: '42%', maxWidth: 600, minWidth: 440 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: insets.top + 36, paddingBottom: insets.bottom + 36, paddingHorizontal: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', gap: 14 }}>
            <BackLink onBack={props.onBack} />
            <LqCard strong style={{ padding: 24 }}>
              <SignupForm {...props} pairNames />
            </LqCard>
          </View>
        </ScrollView>
      </Stage>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The site's kitchen photo under a navy overlay, darker where text sits. */
function PhotoPanel({ children, style, strength }: { children: ReactNode; style?: StyleProp<ViewStyle>; strength: 'hero' | 'panel' }) {
  const stops = strength === 'hero' ? ([0.62, 0.42, 0.9] as const) : ([0.66, 0.78, 0.94] as const);
  return (
    <View style={[{ backgroundColor: NAVY, overflow: 'hidden' }, style]}>
      <Image
        source={KITCHEN}
        resizeMode="cover"
        // Sized explicitly: on web the asset's intrinsic 1400x933 would win over absoluteFill.
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        accessible={false}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        accessibilityIgnoresInvertColors
      />
      <LinearGradient
        colors={[alpha(NAVY, stops[0]), alpha(NAVY, stops[1]), alpha(NAVY, stops[2])]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

function BackLink({ onBack, onBand }: { onBack: () => void; onBand?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      testID="signup-back"
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
    >
      <Txt size={14} weight="600" color={onBand ? c.bandInk : c.muted} style={{ letterSpacing: 0.3 }}>
        ‹ Back
      </Txt>
    </Pressable>
  );
}

function SignupForm({ values, errors, busy, onChange, onSubmit, pairNames }: SignupViewProps & { pairNames: boolean }) {
  const c = usePalette();
  const last = useRef<TextInput>(null);
  const email = useRef<TextInput>(null);
  const phone = useRef<TextInput>(null);
  const submit = () => {
    if (!busy) onSubmit();
  };

  const first = (
    <Field
      label="First name"
      testID="signup-first-name"
      value={values.firstName}
      error={errors.firstName}
      onChangeText={(v) => onChange('firstName', v)}
      editable={!busy}
      autoCapitalize="words"
      autoCorrect={false}
      autoComplete="given-name"
      textContentType="givenName"
      returnKeyType="next"
      submitBehavior="submit"
      onSubmitEditing={() => last.current?.focus()}
    />
  );
  const lastName = (
    <Field
      label="Last name"
      testID="signup-last-name"
      inputRef={last}
      value={values.lastName}
      error={errors.lastName}
      onChangeText={(v) => onChange('lastName', v)}
      editable={!busy}
      autoCapitalize="words"
      autoCorrect={false}
      autoComplete="family-name"
      textContentType="familyName"
      returnKeyType="next"
      submitBehavior="submit"
      onSubmitEditing={() => email.current?.focus()}
    />
  );

  return (
    <View style={{ gap: 26 }}>
      <View style={{ gap: 10 }}>
        <Eyebrow>New clients</Eyebrow>
        <Display size={34} accessibilityRole="header">
          Create your account
        </Display>
        <Txt size={15} muted style={{ lineHeight: 23 }}>
          Complete care for your home, without the mental load. Start with a few details and we'll take it from there.
        </Txt>
      </View>

      <View style={{ gap: 18 }}>
        {pairNames ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>{first}</View>
            <View style={{ flex: 1 }}>{lastName}</View>
          </View>
        ) : (
          <>
            {first}
            {lastName}
          </>
        )}
        <Field
          label="Email"
          testID="signup-email"
          inputRef={email}
          value={values.email}
          error={errors.email}
          onChangeText={(v) => onChange('email', v)}
          editable={!busy}
          keyboardType="email-address"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => phone.current?.focus()}
        />
        <Field
          label="Mobile phone"
          optional
          testID="signup-phone"
          inputRef={phone}
          value={values.phone}
          error={errors.phone}
          helper="We'll text when your technician is on the way."
          onChangeText={(v) => onChange('phone', v)}
          editable={!busy}
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </View>

      <View style={{ gap: 12 }}>
        <View testID="signup-submit">
          <LqButton full onPress={submit} disabled={busy}>
            {busy ? 'Creating your account…' : 'Create my account'}
          </LqButton>
        </View>
        {errors.form ? (
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: alpha(c.status.brick, 0.4),
              backgroundColor: alpha(c.status.brick, 0.08),
            }}
          >
            <Txt testID="signup-error" accessibilityRole="alert" size={14} color={c.status.brick} style={{ lineHeight: 20 }}>
              {errors.form}
            </Txt>
          </View>
        ) : null}
        <Txt size={12} muted style={{ lineHeight: 18 }}>
          By creating an account you agree to the Premium Home Partners terms of service and privacy policy.
        </Txt>
      </View>

      <TrustLine />
    </View>
  );
}

function Field({
  label,
  optional,
  error,
  helper,
  inputRef,
  testID,
  ...input
}: TextInputProps & { label: string; optional?: boolean; error?: string; helper?: string; inputRef?: Ref<TextInput>; testID: string }) {
  const c = usePalette();
  const note = error ?? helper;
  return (
    <View style={{ gap: 7 }}>
      <Txt size={14} weight="600">
        {label}
        {optional ? (
          <Txt size={13} muted>
            {'  Optional'}
          </Txt>
        ) : null}
      </Txt>
      <TextInput
        ref={inputRef}
        testID={testID}
        accessibilityLabel={optional ? `${label} (optional)` : label}
        placeholderTextColor={c.muted}
        {...input}
        style={{
          minHeight: 50,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: RADIUS.field,
          backgroundColor: c.glassStrong,
          borderWidth: error ? 1.5 : 1,
          borderColor: error ? c.status.brick : c.rule,
          fontSize: 17,
          color: c.ink,
          opacity: input.editable === false ? 0.7 : 1,
        }}
      />
      {note ? (
        <Txt
          testID={error ? `${testID}-error` : undefined}
          size={13}
          color={error ? c.status.brick : c.muted}
          accessibilityLiveRegion={error ? 'polite' : undefined}
          style={{ lineHeight: 18 }}
        >
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

/** The quiet promise under the form: vetted partners, one point of contact, discretion. */
function TrustLine() {
  const c = usePalette();
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 14 }}>
      {TRUST.map((t) => (
        <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.muted }} />
          <Mono size={10} medium upper tracking={0.06} muted>
            {t}
          </Mono>
        </View>
      ))}
    </View>
  );
}

/** How it works, from the site: assessment → care plan → ongoing management. */
function NextSteps({ onBand }: { onBand?: boolean }) {
  const c = usePalette();
  const ink = onBand ? c.bandInk : c.ink;
  const muted = onBand ? c.bandMuted : c.muted;
  const rule = onBand ? alpha(c.bandInk, 0.2) : c.rule;
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 8 }}>
        <Eyebrow style={{ color: muted }}>How it works</Eyebrow>
        <Display size={30} color={ink} accessibilityRole="header">
          What happens next
        </Display>
      </View>
      <View>
        {STEPS.map((s, i) => (
          <View key={s.title} style={{ flexDirection: 'row', gap: 16, paddingVertical: 14, borderTopWidth: 1, borderColor: rule }}>
            <Mono size={12} medium color={muted} style={{ width: 24, paddingTop: 5 }}>
              {String(i + 1).padStart(2, '0')}
            </Mono>
            <View style={{ flex: 1, gap: 4 }}>
              <Display size={22} color={ink}>
                {s.title}
              </Display>
              <Txt size={14} color={muted} style={{ lineHeight: 21 }}>
                {s.body}
              </Txt>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The site's footer: the name in Caslon and the Birmingham address. */
function Footer({ onPhoto, style }: { onPhoto?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <View style={[onPhoto ? { gap: 6 } : { backgroundColor: c.band, paddingTop: 30, paddingHorizontal: 22, gap: 8 }, style]}>
      <Display size={onPhoto ? 20 : 24} color={c.bandInk}>
        Premium Home Partners
      </Display>
      <Txt size={13} color={c.bandMuted} style={{ lineHeight: 19 }}>
        2601 Highland Park Avenue South | Birmingham, Alabama 35205
      </Txt>
    </View>
  );
}
