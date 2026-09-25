import { Pressable, View } from 'react-native';
import { usePalette } from '../../ui/theme';

/** The onboarding shutter: a 64pt accent ring around a 50pt accent disc that dims while busy. */
export function Shutter({
  onPress,
  busy,
  disabled,
  label = 'Take photo',
  testID = 'camera-shutter',
}: {
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  testID?: string;
}) {
  const c = usePalette();
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      testID={testID}
      style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: disabled && !busy ? 0.5 : 1 }}
    >
      <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: c.accent, opacity: busy ? 0.4 : 1 }} />
    </Pressable>
  );
}
