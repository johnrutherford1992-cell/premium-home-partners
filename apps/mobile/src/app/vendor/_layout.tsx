import { Stack } from 'expo-router';
import { RoleGate } from '../../components/RoleGate';
import { usePalette } from '../../ui/theme';

export default function VendorLayout() {
  const c = usePalette();
  return (
    <RoleGate role="vendor">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.field } }} />
    </RoleGate>
  );
}
