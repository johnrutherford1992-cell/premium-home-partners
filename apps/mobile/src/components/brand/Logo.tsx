import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { usePalette } from '../../ui/theme';

// Trimmed from the site's PHP_Logo_HorizontalWhite.png (docs/brand/capture);
// the navy versions are the same pixels recolored. See assets/brand/.
const SOURCES = {
  horizontal: {
    white: require('../../../assets/brand/logo-horizontal-white.png'),
    navy: require('../../../assets/brand/logo-horizontal-navy.png'),
    ratio: 1350 / 316,
  },
  mark: {
    white: require('../../../assets/brand/mark-white.png'),
    navy: require('../../../assets/brand/mark-navy.png'),
    ratio: 548 / 632,
  },
} as const;

export type LogoVariant = keyof typeof SOURCES;
/** auto: navy on the light theme, white on the dark theme. Use white on navy bands and photos. */
export type LogoTone = 'auto' | 'navy' | 'white';

/** The Premium Home Partners logo: the horizontal lockup or the house mark alone, sized by width. */
export function Logo({
  variant = 'horizontal',
  tone = 'auto',
  width = variant === 'horizontal' ? 200 : 36,
  style,
  testID,
}: {
  variant?: LogoVariant;
  tone?: LogoTone;
  width?: number;
  style?: StyleProp<ImageStyle>;
  testID?: string;
}) {
  const c = usePalette();
  const src = SOURCES[variant];
  const ink = tone === 'auto' ? (c.dark ? 'white' : 'navy') : tone;
  return (
    <Image
      testID={testID}
      source={src[ink]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Premium Home Partners"
      accessibilityIgnoresInvertColors
      style={[{ width, height: Math.round(width / src.ratio) }, style]}
    />
  );
}
