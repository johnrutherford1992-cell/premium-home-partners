import { Redirect, router } from 'expo-router';
import { useRef, useState, type Ref } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { ROLE_HOME, useSession } from '../lib/auth';
import { DEMO_ACCESS } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { useApp } from '../store/app';
import { BrandHeader } from '../components/brand/BrandHeader';
import { FONT, RADIUS } from '../theme/tokens';
import { Row, Screen, Toggle } from '../ui/controls';
import { Eyebrow, LqButton, LqCard, Mono, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

const DEMO_PASSWORD = 'phpdemo2026';

/** Seeded demo logins (docs/LIVE_ARCHITECTURE.md §6). */
const DEMO_ACCOUNTS = [
  { key: 'homeowner', label: 'Homeowner · Elena Alvarez', email: 'homeowner@php.test' },
  { key: 'newhome', label: 'New homeowner · Jordan Lee', email: 'newhome@php.test' },
  { key: 'tech', label: 'Technician · Marcus Reyes', email: 'tech@php.test' },
  { key: 'vendor', label: 'Vendor · Sam Ortiz', email: 'vendor@php.test' },
  { key: 'office', label: 'Office · Avery Brooks', email: 'office@php.test' },
] as const;

const SHOW_DEMO_ACCOUNTS = process.env.EXPO_PUBLIC_SHOW_DEMO_ACCOUNTS !== '0';

export default function Login() {
  const { mode } = useMode();
  if (mode === 'demo') return <Redirect href="/" />;
  return <SignIn />;
}

/** Styled exactly like the onboarding Field. */
const Field = ({ label, inputRef, ...input }: TextInputProps & { label: string; inputRef?: Ref<TextInput> }) => {
  const c = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...input}
        style={{ padding: 14, borderRadius: RADIUS.field, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.line, fontSize: 16, fontFamily: FONT.sans, color: c.ink }}
      />
    </View>
  );
};

function SignIn() {
  const session = useSession();
  const { setMode } = useMode();
  const { dark, set } = useApp(useShallow((s) => ({ dark: s.dark, set: s.set })));
  const c = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Signed in (or a stored session was restored): '/' routes by role. With
  // demo access, '/' is the launcher: the form stays usable while another
  // demo account is open, and a sign-in from it goes straight to that role.
  if (session.status === 'signedIn' && (!DEMO_ACCESS || submitted)) {
    return <Redirect href={DEMO_ACCESS && session.profile ? ROLE_HOME[session.profile.role] : '/'} />;
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await session.signIn(email, password);
    // On success stay busy: the session update redirects away from this screen.
    if (r.error) {
      setError(r.error);
      setBusy(false);
    } else setSubmitted(true);
  };

  const fill = (addr: string) => {
    setEmail(addr);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  return (
    <Screen>
      <BrandHeader
        eyebrow="Client sign in"
        title="Enjoy your home, not the hassle."
        titleSize={36}
        sub="Sign in to your private home concierge: upcoming visits, photo reports and your care plan, in one place."
      />

      <Field
        label="EMAIL"
        testID="login-email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        editable={!busy}
      />
      <Field
        label="PASSWORD"
        testID="login-password"
        inputRef={passwordRef}
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (error) setError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
      />

      <View testID="login-submit">
        <LqButton full onPress={() => void submit()} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </LqButton>
      </View>

      {error ? (
        <Txt testID="login-error" accessibilityRole="alert" size={13} color={c.status.brick} style={{ lineHeight: 19 }}>
          {error}
        </Txt>
      ) : null}

      {SHOW_DEMO_ACCOUNTS ? (
        <LqCard style={{ gap: 4 }}>
          <Txt weight="600">Demo accounts</Txt>
          <Txt size={13} muted style={{ lineHeight: 19, marginBottom: 4 }}>
            Tap one to fill in the sign-in form.
          </Txt>
          {DEMO_ACCOUNTS.map((a, i) => (
            <Pressable
              key={a.key}
              testID={`demo-account-${a.key}`}
              accessibilityRole="button"
              accessibilityLabel={`Use ${a.label}`}
              onPress={() => fill(a.email)}
              style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: c.rule }}
            >
              <Row>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={14} weight="500">
                    {a.label}
                  </Txt>
                  <Mono size={11} muted>
                    {a.email}
                  </Mono>
                </View>
                <Txt accent size={16}>
                  ›
                </Txt>
              </Row>
            </Pressable>
          ))}
        </LqCard>
      ) : null}

      <View style={{ borderRadius: RADIUS.card, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
        <Pressable
          testID="demo-mode-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: false }}
          accessibilityLabel="Offline demo mode"
          onPress={() => {
            setMode('demo');
            router.replace('/');
          }}
        >
          <Row style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt>Offline demo mode</Txt>
              <Txt size={12} muted style={{ lineHeight: 17 }}>
                All four apps on this device, no account or connection needed.
              </Txt>
            </View>
            <Toggle on={false} />
          </Row>
        </Pressable>
      </View>

      <Row style={{ justifyContent: 'flex-start' }}>
        <LqButton variant="ghost" onPress={() => set({ dark: !dark })}>
          {dark ? 'Light mode' : 'Dark mode'}
        </LqButton>
      </Row>
    </Screen>
  );
}
