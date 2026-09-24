// React Native port of the Liquid Glass primitives (@php/ui):
// LqGlass, LqCard, LqButton, LqBadge, LqStat, LqSectionTitle.

import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { FONT, RADIUS, STATUS, alpha, type Tone } from '../theme/tokens';
import { usePalette } from './theme';

type TxtProps = TextProps & {
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  muted?: boolean;
  accent?: boolean;
  style?: StyleProp<TextStyle>;
};

/** Body text in the sans stack. */
export function Txt({ size = 14, weight, color, muted, accent, style, ...rest }: TxtProps) {
  const c = usePalette();
  return (
    <Text
      {...rest}
      style={[
        { fontSize: size, fontWeight: weight, fontFamily: FONT.sans, color: color ?? (accent ? c.accent : muted ? c.muted : c.ink) },
        style,
      ]}
    />
  );
}

/** Barlow Condensed 600, uppercase. */
export function Display({ size = 34, style, ...rest }: TxtProps) {
  return (
    <Txt
      {...rest}
      size={size}
      style={[{ fontFamily: FONT.display, textTransform: 'uppercase', lineHeight: Math.round(size * (size >= 60 ? 0.92 : 1.02)) }, style]}
    />
  );
}

/** JetBrains Mono, used for eyebrows and figures. */
export function Mono({ size = 11, tracking = 0, medium, upper, style, ...rest }: TxtProps & { tracking?: number; medium?: boolean; upper?: boolean }) {
  return (
    <Txt
      {...rest}
      size={size}
      style={[
        {
          fontFamily: medium ? FONT.monoMedium : FONT.mono,
          letterSpacing: tracking * size,
          textTransform: upper ? 'uppercase' : undefined,
        },
        style,
      ]}
    />
  );
}

export function Eyebrow({ children, accent, style }: { children: ReactNode; accent?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <Mono size={10} medium tracking={0.08} upper muted={!accent} accent={accent} style={style}>
      {children}
    </Mono>
  );
}

/** Raw frosted surface: blur + hairline + soft shadow. */
export function LqGlass({ style, children, strong }: { style?: StyleProp<ViewStyle>; children?: ReactNode; strong?: boolean }) {
  const c = usePalette();
  return (
    <View
      style={[
        {
          borderRadius: RADIUS.glass,
          borderWidth: 1,
          borderColor: c.rule,
          backgroundColor: strong ? c.glassStrong : c.glass,
          overflow: 'hidden',
          boxShadow: `0 1px 2px 0 ${alpha('#000000', 0.05)}`,
        },
        style,
      ]}
    >
      {Platform.OS !== 'android' ? (
        <BlurView intensity={40} tint={c.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      ) : null}
      {children}
    </View>
  );
}

export function LqCard({ style, children, strong }: { style?: StyleProp<ViewStyle>; children?: ReactNode; strong?: boolean }) {
  return (
    <LqGlass strong={strong} style={[{ padding: 16 }, style]}>
      {children}
    </LqGlass>
  );
}

export function LqButton({
  children,
  onPress,
  variant = 'primary',
  disabled,
  full,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  /** Full-width 50pt CTA used across the mobile apps. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = usePalette();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderRadius: RADIUS.glass,
          paddingHorizontal: 16,
          paddingVertical: 8,
          minHeight: 40,
          backgroundColor: primary ? c.accent : hovered ? c.glass : 'transparent',
          borderWidth: primary ? 0 : 1,
          borderColor: c.rule,
          opacity: disabled ? 0.5 : primary && hovered ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        full && { alignSelf: 'stretch', height: 50 },
        style,
      ]}
    >
      {typeof children === 'string' || Array.isArray(children) ? (
        <Txt size={full ? 15 : 14} weight="500" color={primary ? c.paper : c.ink}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </Pressable>
  );
}

export function LqBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const c = usePalette();
  const col = tone === 'neutral' ? null : STATUS[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderColor: col ? alpha(col, 0.4) : c.rule,
        backgroundColor: col ? alpha(col, 0.1) : c.glass,
      }}
    >
      <Txt size={12} weight="500" color={col ?? c.muted}>
        {children}
      </Txt>
    </View>
  );
}

export function LqStat({ label, value, sub, style }: { label: string; value: string | number; sub?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <LqCard style={[{ gap: 4 }, style]}>
      <Txt size={12} muted style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </Txt>
      <Display size={30} style={{ lineHeight: 30, textTransform: 'none' }}>
        {value}
      </Display>
      {sub ? (
        <Txt size={12} muted>
          {sub}
        </Txt>
      ) : null}
    </LqCard>
  );
}

export function LqSectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Display size={18} style={[{ letterSpacing: 0.45, lineHeight: 24 }, style]} accessibilityRole="header">
      {children}
    </Display>
  );
}
