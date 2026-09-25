// toast(message, tone?) shows a glass pill at the bottom for 3 s.
// <ToastHost /> is mounted once by the root layout.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADIUS, STATUS } from '../theme/tokens';
import { LqGlass, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

export type ToastTone = 'neutral' | 'forest' | 'brick';

interface ToastMsg {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION = 3000;
let seq = 0;
let current: ToastMsg | null = null;
const listeners = new Set<(t: ToastMsg | null) => void>();

/** Show a short message: mutation errors (brick), confirmations (forest) or neutral notes. */
export function toast(message: string, tone: ToastTone = 'neutral') {
  current = { id: ++seq, message, tone };
  listeners.forEach((l) => l(current));
}

const useNative = Platform.OS !== 'web';

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(current);
  const v = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const c = usePalette();

  useEffect(() => {
    const l = (t: ToastMsg | null) => setMsg(t);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: useNative }).start();
    const hide = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: useNative }).start(({ finished }) => {
        if (finished) setMsg((m) => (m && m.id === msg.id ? null : m));
      });
    }, DURATION);
    return () => clearTimeout(hide);
  }, [msg, v]);

  if (!msg) return null;
  const dot = msg.tone === 'neutral' ? c.accent : STATUS[msg.tone];
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 96, alignItems: 'center', paddingHorizontal: 22 }}
    >
      <Animated.View
        style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], maxWidth: 400 }}
      >
        <LqGlass strong style={{ borderRadius: RADIUS.card, boxShadow: `0 8px 24px -10px ${c.sh}` }}>
          <View
            testID="toast"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 16 }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
            <Txt size={13} weight="500" style={{ flexShrink: 1 }}>
              {msg.message}
            </Txt>
          </View>
        </LqGlass>
      </Animated.View>
    </View>
  );
}
