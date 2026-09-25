import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../lib/auth';
import { DEMO_ACCESS } from '../lib/demoAccess';
import { useMode } from '../lib/mode';
import { TextLink } from '../ui/controls';

/**
 * The "‹ All apps" link. In offline demo it returns to the launcher, as
 * before. Live with demo access (the default) it does the same: back to the
 * launcher at /, still signed in, so switching sides is free. Live and
 * login-gated (EXPO_PUBLIC_DEMO_ACCESS=0) it reads "Sign out" and signs out.
 * Pass `label` where a screen uses different text (e.g. "All apps").
 */
export function AppExitLink({ label = '‹ All apps' }: { label?: string }) {
  const { mode } = useMode();
  const { signOut } = useSession();
  const signsOut = mode === 'live' && !DEMO_ACCESS;
  return (
    <View testID="app-exit" style={{ alignSelf: 'flex-start' }}>
      <TextLink
        onPress={() => {
          if (!signsOut) {
            router.replace('/');
            return;
          }
          // signOut flips the session to signed-out synchronously, so /login renders the form.
          void signOut();
          router.replace('/login');
        }}
      >
        {signsOut ? 'Sign out' : label}
      </TextLink>
    </View>
  );
}
