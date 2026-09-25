import { BarlowCondensed_500Medium, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PhotoCaptureHost } from '../components/camera';
import { SessionProvider } from '../lib/auth';
import { useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { RealtimeBridge } from '../lib/realtime';
import { ToastHost } from '../lib/toast';
import { usePalette } from '../ui/theme';

/** Show the app with system fonts if the brand fonts haven't loaded or failed by then. */
const FONT_WAIT_MS = 6000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  // A font that fails or hangs (blocked CDN, flaky wifi) must never leave the
  // screen blank: render on error, or after FONT_WAIT_MS regardless. Text falls
  // back to system fonts and picks the brand fonts up if they arrive later.
  const fontsSettled = fontsLoaded || fontError != null;
  const [fontWaitOver, setFontWaitOver] = useState(false);
  useEffect(() => {
    if (fontsSettled) return;
    const t = setTimeout(() => setFontWaitOver(true), FONT_WAIT_MS);
    return () => clearTimeout(t);
  }, [fontsSettled]);
  const fontsReady = fontsSettled || fontWaitOver;
  const c = usePalette();
  const { mode, hydrated } = useMode();
  if (!fontsReady || !hydrated) return <View style={{ flex: 1, backgroundColor: c.field }} />;
  const stack = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.field }, animation: 'fade' }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <QueryClientProvider client={queryClient}>
        {/* Switching modes remounts everything, so data hooks pick live or demo once per mount. */}
        <Fragment key={mode}>
          {mode === 'live' ? (
            <SessionProvider>
              <RealtimeBridge />
              {stack}
            </SessionProvider>
          ) : (
            stack
          )}
        </Fragment>
        <ToastHost />
        <PhotoCaptureHost />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
