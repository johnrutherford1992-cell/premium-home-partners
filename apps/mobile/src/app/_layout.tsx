// Per-weight imports: the package roots would bundle every weight and italic.
import { LibreCaslonDisplay_400Regular } from '@expo-google-fonts/libre-caslon-display/400Regular';
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { SourceSans3_700Bold } from '@expo-google-fonts/source-sans-3/700Bold';
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
    LibreCaslonDisplay_400Regular,
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
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
