// "New customer" sign-up (live demo). The logic is useSignupForm(); the markup
// is a plain temporary view that takes exactly the props of the brand's
// SignupView (components/brand/SignupView.tsx), so swapping it in is a
// one-line change in LiveSignup.

import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { DEMO_ACCESS, useDemoAccess } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { EMPTY_SIGNUP, signupPayload, validateSignup, type SignupErrors, type SignupField, type SignupValues } from '../lib/signup';
import { STATUS } from '../theme/tokens';
import { Screen, TextLink } from '../ui/controls';
import { Display, Eyebrow, LqButton, Mono, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

export default function Signup() {
  const { mode } = useMode();
  if (mode === 'demo') return <Redirect href="/" />;
  // Login-gated build (EXPO_PUBLIC_DEMO_ACCESS=0): no sign-up, as before.
  if (!DEMO_ACCESS) return <Redirect href="/login" />;
  return <LiveSignup />;
}

function LiveSignup() {
  const form = useSignupForm();
  return <SignupForm {...form} />;
}

interface SignupFormProps {
  values: SignupValues;
  errors: SignupErrors;
  busy: boolean;
  onChange(field: SignupField, value: string): void;
  onSubmit(): void;
  onBack(): void;
}

/**
 * The sign-up form's state: values, per-field errors (shown after a submit,
 * cleared as the field is edited), and submit → startNewCustomer (switches to
 * the onboarding account, resets it under this name) → /homeowner, which
 * opens onboarding on step 1 with the name filled in.
 */
function useSignupForm(): SignupFormProps {
  const { startNewCustomer } = useDemoAccess();
  const [values, setValues] = useState<SignupValues>(EMPTY_SIGNUP);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const onChange = useCallback((field: SignupField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (!e[field] && !e.form) return e;
      const { [field]: _field, form: _form, ...rest } = e;
      return rest;
    });
  }, []);

  const onSubmit = useCallback(() => {
    if (busyRef.current) return;
    const found = validateSignup(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    void startNewCustomer(signupPayload(values)).then((r) => {
      if (!alive.current) return;
      if (r.error || r.superseded) {
        busyRef.current = false;
        setBusy(false);
        if (r.error) setErrors({ form: r.error });
        return;
      }
      // Stay busy: this screen is replaced by onboarding.
      router.replace('/homeowner');
    });
  }, [values, startNewCustomer]);

  const onBack = useCallback(() => router.replace('/'), []);

  return { values, errors, busy, onChange, onSubmit, onBack };
}

// ---------------------------------------------------------------------------
// Temporary view (replaced by the brand's SignupView)
// ---------------------------------------------------------------------------

function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...input}
        style={{ padding: 14, borderRadius: 14, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: error ? STATUS.brick : c.rule, fontSize: 16, color: c.ink }}
      />
      {error ? (
        <Txt size={13} color={STATUS.brick} style={{ lineHeight: 19 }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

function SignupForm({ values, errors, busy, onChange, onSubmit, onBack }: SignupFormProps) {
  return (
    <Screen>
      <View testID="signup-back" style={{ alignSelf: 'flex-start' }}>
        <TextLink onPress={onBack}>‹ All apps</TextLink>
      </View>
      <View style={{ gap: 6 }}>
        <Mono size={12} medium tracking={0.14} accent>
          PREMIUM HOME PARTNERS
        </Mono>
        <Display size={40}>Create your account.</Display>
        <Txt size={14} muted style={{ lineHeight: 21 }}>
          Then set up your home: address, appliances and a maintenance plan.
        </Txt>
      </View>

      <Field
        label="FIRST NAME"
        testID="signup-first-name"
        value={values.firstName}
        onChangeText={(v) => onChange('firstName', v)}
        error={errors.firstName}
        autoComplete="given-name"
        textContentType="givenName"
        autoCapitalize="words"
        returnKeyType="next"
        editable={!busy}
      />
      <Field
        label="LAST NAME"
        testID="signup-last-name"
        value={values.lastName}
        onChangeText={(v) => onChange('lastName', v)}
        error={errors.lastName}
        autoComplete="family-name"
        textContentType="familyName"
        autoCapitalize="words"
        returnKeyType="next"
        editable={!busy}
      />
      <Field
        label="EMAIL"
        testID="signup-email"
        value={values.email}
        onChangeText={(v) => onChange('email', v)}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        editable={!busy}
      />
      <Field
        label="PHONE (OPTIONAL)"
        testID="signup-phone"
        value={values.phone}
        onChangeText={(v) => onChange('phone', v)}
        error={errors.phone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        editable={!busy}
      />

      <View testID="signup-submit">
        <LqButton full onPress={onSubmit} disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </LqButton>
      </View>

      {errors.form ? (
        <Txt testID="signup-error" accessibilityRole="alert" size={13} color={STATUS.brick} style={{ lineHeight: 19 }}>
          {errors.form}
        </Txt>
      ) : null}
    </Screen>
  );
}
