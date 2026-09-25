import { Stack } from 'expo-router';
import { RoleGate } from '../../components/RoleGate';
import { usePalette } from '../../ui/theme';

export default function TechLayout() {
  const c = usePalette();
  return (
    <RoleGate role="tech">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.field } }} />
    </RoleGate>
  );
}
