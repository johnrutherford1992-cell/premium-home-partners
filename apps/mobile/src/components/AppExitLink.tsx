import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../lib/auth';
import { useMode } from '../lib/mode';
import { TextLink } from '../ui/controls';

/**
 * The "‹ All apps" link. In offline demo it returns to the launcher, as
 * before; in live mode the same link reads "Sign out" and signs out.
 * Pass `label` where a screen used different demo text (e.g. "All apps").
 */
export function AppExitLink({ label = '‹ All apps' }: { label?: string }) {
  const { mode } = useMode();
  const { signOut } = useSession();
  const live = mode === 'live';
  return (
    <View testID="app-exit" style={{ alignSelf: 'flex-start' }}>
      <TextLink
        onPress={() => {
          if (!live) {
            router.replace('/');
            return;
          }
          // signOut flips the session to signed-out synchronously, so /login renders the form.
          void signOut();
          router.replace('/login');
        }}
      >
        {live ? 'Sign out' : label}
      </TextLink>
    </View>
  );
}
