import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/** Opacity 1 → .35 → 1 loop, used for live-status dots and "collecting" hints. */
export function Pulse({ children, period = 1400, style }: { children: ReactNode; period?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, period]);
  return <Animated.View style={[{ opacity: v }, style]}>{children}</Animated.View>;
}
