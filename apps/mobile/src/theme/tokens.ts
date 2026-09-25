// Premium Home Partners brand tokens, taken from premiumhomepartners.com
// (docs/brand/capture): navy #0D1E30 bands, soft gray #DCDCDC, off-white
// #FAFAFA, Libre Caslon Display headings, Source Sans body, square corners and
// hairline rules. The Palette keeps the old Liquid Glass keys so every screen
// still reads the same fields; glass is now solid and the bloom is off.

export type StatusKey = 'forest' | 'ochre' | 'brick' | 'slate';

export interface Palette {
  dark: boolean;
  /** Page background. */
  field: string;
  /** Raised surface (cards, sheets). */
  paper: string;
  ink: string;
  muted: string;
  /** Card surface. Solid now; the name is kept from the glass era. */
  glass: string;
  /** Field, tile and bar surface. Solid now. */
  glassStrong: string;
  /** Hairline between rows and around cards. */
  rule: string;
  accent: string;
  accentInk: string;
  sh: string;
  /** Radial bloom strength over the field (0–1). 0: the brand is flat. */
  bloom: number;
  blur: number;
  /** Placeholder photo/map gradient stops. */
  photo2: [string, string, string];
  /** Stronger hairline for form fields and outline buttons (the site's 1px field border). */
  line: string;
  /** The site's navy band (hero, promise, footer). A deeper navy in dark mode. */
  band: string;
  bandInk: string;
  bandMuted: string;
  /** The site's soft gray section; a lifted navy in dark mode. */
  soft: string;
  /** Status colors as text on this theme's surfaces (STATUS is for fills). */
  status: Record<StatusKey, string>;
}

const NAVY = '#0D1E30';
const SOFT_GRAY = '#DCDCDC';
const OFF_WHITE = '#FAFAFA';

export const BRAND = { navy: NAVY, softGray: SOFT_GRAY, offWhite: OFF_WHITE, white: '#FFFFFF' } as const;

export const LIGHT: Palette = {
  dark: false,
  field: OFF_WHITE,
  paper: '#FFFFFF',
  ink: NAVY,
  muted: '#56616E',
  glass: '#FFFFFF',
  glassStrong: '#FFFFFF',
  rule: 'rgba(13,30,48,0.14)',
  accent: NAVY,
  accentInk: '#FFFFFF',
  sh: 'rgba(13,30,48,0.18)',
  bloom: 0,
  blur: 0,
  photo2: ['#C9CED4', '#E4E6E9', '#D2D6DB'],
  line: 'rgba(13,30,48,0.38)',
  band: NAVY,
  bandInk: OFF_WHITE,
  bandMuted: '#B4BDC8',
  soft: SOFT_GRAY,
  status: { forest: '#2F7A55', ochre: '#8F6216', brick: '#B8453B', slate: '#4F6E90' },
};

export const DARK: Palette = {
  dark: true,
  field: NAVY,
  paper: '#13273D',
  ink: OFF_WHITE,
  muted: '#A3AFBD',
  glass: '#13273D',
  glassStrong: '#172D45',
  rule: 'rgba(250,250,250,0.14)',
  accent: SOFT_GRAY,
  accentInk: NAVY,
  sh: 'rgba(0,0,0,0.45)',
  bloom: 0,
  blur: 0,
  photo2: ['#1F3550', '#132538', '#27405C'],
  line: 'rgba(250,250,250,0.34)',
  band: '#081523',
  bandInk: OFF_WHITE,
  bandMuted: '#A3AFBD',
  soft: '#172D45',
  status: { forest: '#74C495', ochre: '#E2B461', brick: '#F2877B', slate: '#A9C0DB' },
};

/**
 * Status fills: semantic and never re-themed. Each carries white text
 * (STATUS_INK) at 4.5:1 or better except ochre, which is only used as a tint.
 * For status-colored text use `palette.status`, which is tuned per theme.
 */
export const STATUS = {
  forest: '#2F7A55',
  ochre: '#A87522',
  brick: '#B8453B',
  slate: '#4F6E90',
} as const satisfies Record<StatusKey, string>;

/** Text or icon color on a STATUS fill. */
export const STATUS_INK = '#FFFFFF';

export type Tone = StatusKey | 'neutral';

// Font families registered by the root layout (useFonts). On web each gets a
// fallback stack, so text still reads well if a font file never arrives.
// EXPO_OS is inlined at build time, so this file stays free of react-native imports.
const IS_WEB = process.env.EXPO_OS === 'web';
const webStack = (family: string, fallback: string) => (IS_WEB ? `${family}, ${fallback}` : family);
const SANS_FALLBACK = '"Source Sans 3", "Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF_FALLBACK = '"Libre Caslon Display", "Libre Caslon Text", Georgia, "Times New Roman", serif';

export const FONT = {
  /** Libre Caslon Display 400: every heading, sentence case, tight tracking. */
  display: webStack('LibreCaslonDisplay_400Regular', SERIF_FALLBACK),
  /** Source Sans 3 SemiBold: labels and figures (the old mono slot). */
  mono: webStack('SourceSans3_400Regular', SANS_FALLBACK),
  monoMedium: webStack('SourceSans3_600SemiBold', SANS_FALLBACK),
  /** Source Sans 3, the successor of the site's Source Sans Pro. */
  sans: webStack('SourceSans3_400Regular', SANS_FALLBACK) as string | undefined,
  sansSemiBold: webStack('SourceSans3_600SemiBold', SANS_FALLBACK),
  sansBold: webStack('SourceSans3_700Bold', SANS_FALLBACK),
};

/** Display letter-spacing in em: the site sets its Caslon headings at -0.04em. */
export const DISPLAY_TRACKING = -0.04;

/**
 * Square, site-like corners that still read as touchable.
 * glass: cards · field: inputs and tiles · pill: badges and small pills ·
 * button: buttons · tabBar: the homeowner tab bar.
 */
export const RADIUS = { glass: 4, card: 4, field: 2, pill: 2, button: 2, tabBar: 4 };
export const SPACE = { screen: 22, stack: 14, card: 16 };

/** Mix a hex color with transparency, e.g. accent at 16%. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
