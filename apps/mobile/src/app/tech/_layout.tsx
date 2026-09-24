import { Stack } from 'expo-router';
import { usePalette } from '../../ui/theme';

export default function TechLayout() {
  const c = usePalette();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.field } }} />;
}
