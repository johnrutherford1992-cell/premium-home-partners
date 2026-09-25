import { BarlowCondensed_500Medium, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fragment } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PhotoCaptureHost } from '../components/camera';
import { SessionProvider } from '../lib/auth';
import { useMode } from '../lib/mode';
import { queryClient } from '../lib/queryClient';
import { RealtimeBridge } from '../lib/realtime';
import { ToastHost } from '../lib/toast';
import { usePalette } from '../ui/theme';

export default function RootLayout() {
  const [loaded] = useFonts({
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const c = usePalette();
  const { mode, hydrated } = useMode();
  if (!loaded || !hydrated) return <View style={{ flex: 1, backgroundColor: c.field }} />;
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
