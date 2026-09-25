import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FONT, RADIUS, STATUS, STATUS_INK, alpha } from '../theme/tokens';
import { Mono, Txt } from './primitives';
import { usePalette } from './theme';

/** The page field: the brand is flat, so no bloom (kept only if a palette asks for one). */
export function Stage({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <View style={[{ flex: 1, backgroundColor: c.field }, style]}>
      {c.bloom > 0 ? (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient id="bloom" cx="82%" cy="-6%" rx="80%" ry="60%" fx="82%" fy="-6%" gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={c.accent} stopOpacity={c.bloom} />
              <Stop offset="1" stopColor={c.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloom)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

/**
 * Scrollable phone screen: 22pt gutters, 14pt stack gap. On wide web viewports
 * the column is capped at phone width so the mobile apps keep their layout.
 */
export function Screen({ children, bottomInset = 40, footer }: { children: ReactNode; bottomInset?: number; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Stage>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + bottomInset,
          paddingHorizontal: 22,
          gap: 14,
          width: '100%',
          maxWidth: 440,
          alignSelf: 'center',
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer}
    </Stage>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, style]}>{children}</View>;
}

export function TextLink({ children, onPress, accent }: { children: ReactNode; onPress: () => void; accent?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ alignSelf: 'flex-start' }}>
      <Txt size={14} muted={!accent} accent={accent} weight={accent ? '600' : undefined} style={{ letterSpacing: 0.2 }}>
        {children}
      </Txt>
    </Pressable>
  );
}

export function RoundBtn({ label, onPress, size = 26, accent }: { label: string; onPress: () => void; size?: number; accent?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
      style={{ width: size, height: size, borderRadius: RADIUS.button, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt size={size > 27 ? 16 : 14} color={accent ? c.accent : c.muted}>
        {label === '-' ? '−' : label}
      </Txt>
    </Pressable>
  );
}

/** Label + − value + tile, used by home details and office inputs. */
export function StepperTile({ label, value, onDec, onInc, big }: { label: string; value: string | number; onDec: () => void; onInc: () => void; big?: boolean }) {
  const c = usePalette();
  return (
    <View style={{ flex: 1, paddingVertical: big ? 12 : 10, paddingHorizontal: big ? 14 : 12, borderRadius: RADIUS.field, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}>
      <Mono size={10} medium upper tracking={0.06} muted>
        {label}
      </Mono>
      <Row style={{ marginTop: big ? 6 : 4 }}>
        <RoundBtn label="-" onPress={onDec} size={big ? 28 : 26} />
        <Txt size={big ? 22 : 19} weight="600">
          {value}
        </Txt>
        <RoundBtn label="+" onPress={onInc} size={big ? 28 : 26} accent />
      </Row>
    </View>
  );
}

export function Toggle({ on }: { on: boolean }) {
  const c = usePalette();
  return (
    <View style={{ width: 44, height: 26, borderRadius: RADIUS.button + 1, backgroundColor: on ? STATUS.forest : c.line }}>
      <View style={{ position: 'absolute', left: on ? 21 : 3, top: 3, width: 20, height: 20, borderRadius: RADIUS.button, backgroundColor: STATUS_INK }} />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', padding: 2, borderRadius: RADIUS.button, backgroundColor: c.rule }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: RADIUS.button, backgroundColor: on ? c.accent : 'transparent' }}
          >
            <Txt size={12} weight={on ? '600' : '400'} color={on ? c.accentInk : c.ink}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small filled tag button (Get quotes / Book / + Photo). */
export function Pill({ label, bg, ink, onPress, border }: { label: string; bg: string; ink: string; onPress?: () => void; border?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: bg, borderWidth: border ? 1 : 0, borderColor: border }}
    >
      <Txt size={12} weight="600" color={ink} style={{ letterSpacing: 0.2 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Placeholder for a photo/map; swapped for real images once Storage is wired. */
export function PhotoBox({ height, colors, radius = RADIUS.card, children, style }: { height: number; colors?: readonly [string, string, ...string[]]; radius?: number; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <LinearGradient
      colors={colors ?? c.photo2}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ height, borderRadius: radius, overflow: 'hidden', position: 'relative' }, style]}
    >
      {children}
    </LinearGradient>
  );
}

export function MapPreview() {
  const c = usePalette();
  const lines = Array.from({ length: 16 });
  return (
    <PhotoBox height={170}>
      {lines.map((_, i) => (
        <View key={'h' + i} style={{ position: 'absolute', left: 0, right: 0, top: i * 26, height: 1, backgroundColor: c.rule }} />
      ))}
      {lines.map((_, i) => (
        <View key={'v' + i} style={{ position: 'absolute', top: 0, bottom: 0, left: i * 26, width: 1, backgroundColor: c.rule }} />
      ))}
      <View style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -17, marginTop: -17, width: 34, height: 34, borderRadius: 17, backgroundColor: alpha(c.accent, 0.25), alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.accent }} />
      </View>
      <Mono size={10} muted style={{ position: 'absolute', left: 10, bottom: 8 }}>
        map preview
      </Mono>
    </PhotoBox>
  );
}

export function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  const c = usePalette();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={14} weight="600" color={c.accentInk}>
        {initials}
      </Txt>
    </View>
  );
}

export function Divided({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return <View style={[{ borderTopWidth: 1, borderColor: c.rule }, style]}>{children}</View>;
}

export function ListRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: c.rule }, style]}>{children}</View>;
}

export const monoFont = FONT.mono;
