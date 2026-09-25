import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

// react-native-web has no native animation module and warns when asked for one.
const nativeDriver = Platform.OS !== 'web';

/** Opacity 1 → .35 → 1 loop, used for live-status dots and "collecting" hints. */
export function Pulse({ children, period = 1400, style }: { children: ReactNode; period?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver }),
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, period]);
  return <Animated.View style={[{ opacity: v }, style]}>{children}</Animated.View>;
}
