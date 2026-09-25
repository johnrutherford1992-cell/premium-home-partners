// "New customer" sign-up (live demo). The logic is useSignupForm(); the markup
// is the brand's SignupView (components/brand/SignupView.tsx).

import { Redirect, router } from 'expo-router';
import { SignupView } from '../components/brand/SignupView';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_ACCESS, useDemoAccess } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { EMPTY_SIGNUP, signupPayload, validateSignup, type SignupErrors, type SignupField, type SignupValues } from '../lib/signup';

export default function Signup() {
  const { mode } = useMode();
  if (mode === 'demo') return <Redirect href="/" />;
  // Login-gated build (EXPO_PUBLIC_DEMO_ACCESS=0): no sign-up, as before.
  if (!DEMO_ACCESS) return <Redirect href="/login" />;
  return <LiveSignup />;
}

function LiveSignup() {
  const form = useSignupForm();
  return <SignupView {...form} />;
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
