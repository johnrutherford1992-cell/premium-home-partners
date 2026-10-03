import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useMode } from '../../lib/mode';
import { ChromeMark } from '../../ui/chrome';
import { LqBadge } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { RoleGate } from '../auth/RoleGate';

export default function HomeownerLayout() {
  const c = usePalette();
  const { mode } = useMode();
  const mark =
    mode === 'demo' ? (
      <View pointerEvents="none" style={{ alignItems: 'center' }}>
        <LqBadge tone="slate">Sample data</LqBadge>
      </View>
    ) : null;
  return (
    <RoleGate role="homeowner">
      <ChromeMark mark={mark}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.field }, animation: 'fade' }}>
          {/* Show us / Request an assessment, opened from the Services tab (docs/SERVICES_V2.md). */}
          <Stack.Screen name="request" />
        </Stack>
      </ChromeMark>
    </RoleGate>
  );
}
