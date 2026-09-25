// React Native primitives in the Premium Home Partners brand (the component
// names are kept from the Liquid Glass era so every screen imports them unchanged):
// LqGlass, LqCard, LqButton, LqBadge, LqStat, LqSectionTitle.

import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { DISPLAY_TRACKING, FONT, RADIUS, alpha, type Tone } from '../theme/tokens';
import { usePalette } from './theme';

type TxtProps = TextProps & {
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  muted?: boolean;
  accent?: boolean;
  style?: StyleProp<TextStyle>;
};

/**
 * Each Source Sans 3 weight is its own registered family, so a weight picks a
 * family instead of setting fontWeight (which would fake-bold the loaded face on web).
 */
function sansFamily(weight: TextStyle['fontWeight']): string | undefined {
  const w = weight == null || weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight);
  if (w >= 700) return FONT.sansBold;
  if (w >= 500) return FONT.sansSemiBold;
  return FONT.sans;
}

/**
 * Source Sans 3 sits smaller than the system sans it replaced (x-height ~0.49
 * vs ~0.52), so body sizes scale up a step to keep every screen's proportions.
 */
const BODY_SCALE = 1.07;
const half = (n: number) => Math.round(n * 2) / 2;

/** Text at an exact size: the shared base of Txt, Display and Mono. */
function BaseText({ size, weight, color, muted, accent, style, ...rest }: TxtProps & { size: number }) {
  const c = usePalette();
  return (
    <Text
      {...rest}
      style={[{ fontSize: size, fontFamily: sansFamily(weight), color: color ?? (accent ? c.accent : muted ? c.muted : c.ink) }, style]}
    />
  );
}

/** Body text in Source Sans 3. */
export function Txt({ size = 14, ...rest }: TxtProps) {
  return <BaseText {...rest} size={half(size * BODY_SCALE)} />;
}

/** Libre Caslon Display 400, sentence case, tracked tight like the site's headings. */
export function Display({ size = 32, style, ...rest }: TxtProps) {
  const lineHeight = Math.round(size * (size >= 48 ? 1.08 : size >= 28 ? 1.14 : 1.22));
  const tracking = size >= 22 ? DISPLAY_TRACKING : -0.02;
  return <BaseText {...rest} size={size} style={[{ fontFamily: FONT.display, letterSpacing: tracking * size, lineHeight }, style]} />;
}

/**
 * Labels and figures. The site has no monospace, so this is Source Sans 3 with
 * tabular figures (SemiBold when `medium`), sized up to match the old mono's
 * x-height. Uppercase + tracking gives the site's nav/eyebrow look.
 */
export function Mono({ size = 11, tracking = 0, medium, upper, weight, style, ...rest }: TxtProps & { tracking?: number; medium?: boolean; upper?: boolean }) {
  const s = half(size * 1.1);
  const face: TextStyle = weight ? {} : { fontFamily: medium ? FONT.monoMedium : FONT.mono };
  return (
    <BaseText
      {...rest}
      weight={weight}
      size={s}
      style={[{ ...face, letterSpacing: tracking * s, textTransform: upper ? 'uppercase' : undefined, fontVariant: ['tabular-nums'] }, style]}
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

/** Flat surface: solid fill, hairline border, square corners. */
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
        },
        style,
      ]}
    >
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
          borderRadius: RADIUS.button,
          paddingHorizontal: 18,
          paddingVertical: 8,
          minHeight: 44,
          backgroundColor: primary ? c.accent : hovered && !disabled ? alpha(c.ink, 0.06) : 'transparent',
          borderWidth: primary ? 0 : 1,
          borderColor: c.line,
          opacity: disabled ? 0.45 : primary && hovered ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
        full && { alignSelf: 'stretch', height: 50 },
        style,
      ]}
    >
      {typeof children === 'string' || Array.isArray(children) ? (
        <Txt size={full ? 15 : 14} weight="600" color={primary ? c.accentInk : c.ink} style={{ letterSpacing: 0.2 }}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </Pressable>
  );
}

/** Small uppercase status tag: square, tinted, tracked like the site's nav labels. */
export function LqBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const c = usePalette();
  const col = tone === 'neutral' ? null : c.status[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: RADIUS.pill,
        borderWidth: 1,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderColor: col ? alpha(col, 0.45) : c.line,
        backgroundColor: col ? alpha(col, 0.1) : 'transparent',
      }}
    >
      <Txt size={10.5} weight="600" color={col ?? c.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}>
        {children}
      </Txt>
    </View>
  );
}

export function LqStat({ label, value, sub, style }: { label: string; value: string | number; sub?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <LqCard style={[{ gap: 6 }, style]}>
      <Eyebrow>{label}</Eyebrow>
      <Display size={30}>{value}</Display>
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
    <Display size={22} style={style} accessibilityRole="header">
      {children}
    </Display>
  );
}
