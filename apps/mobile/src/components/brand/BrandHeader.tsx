import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Display, Eyebrow, Txt } from '../../ui/primitives';
import { Logo, type LogoTone, type LogoVariant } from './Logo';

/**
 * The brand block for the top of a screen (launcher, sign in): the logo with an
 * optional slot on its right (a badge, a link), then an eyebrow, a Caslon title
 * and an optional line of body copy.
 */
export function BrandHeader({
  title,
  eyebrow,
  sub,
  right,
  logo = 'horizontal',
  logoTone = 'auto',
  titleSize = 38,
  style,
}: {
  title: string;
  eyebrow?: string;
  sub?: ReactNode;
  /** Shown level with the logo, on the right: e.g. an OFFLINE DEMO badge. */
  right?: ReactNode;
  logo?: LogoVariant;
  logoTone?: LogoTone;
  titleSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 22, marginTop: 8 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
        <Logo variant={logo} tone={logoTone} width={logo === 'horizontal' ? 168 : 34} />
        {right}
      </View>
      <View style={{ gap: 8 }}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Display size={titleSize} accessibilityRole="header">
          {title}
        </Display>
        {sub ? (
          <Txt size={15} muted style={{ lineHeight: 23 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
