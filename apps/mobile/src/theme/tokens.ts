// Liquid Glass tokens, ported from the @php/ui design system (_ds_bundle.css),
// in the Premium Home Partners colors (premiumhomepartners.com: navy #0D1E30,
// soft gray #DCDCDC, off-white #FAFAFA; docs/brand/capture).

export type StatusKey = 'forest' | 'ochre' | 'brick' | 'slate';

export interface Palette {
  dark: boolean;
  field: string;
  paper: string;
  ink: string;
  muted: string;
  glass: string;
  glassStrong: string;
  rule: string;
  accent: string;
  accentInk: string;
  sh: string;
  /** Radial bloom strength over the field (0–1). */
  bloom: number;
  blur: number;
  /** Placeholder photo/map gradient stops. */
  photo2: [string, string, string];
  /** Stronger hairline for form fields and outline buttons. */
  line: string;
  /** The brand's navy band (sign-up hero and promise). */
  band: string;
  bandInk: string;
  bandMuted: string;
  /** The brand's soft gray. */
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
  field: '#F4F5F7',
  paper: '#ffffff',
  ink: NAVY,
  muted: '#56616E',
  glass: 'rgba(255,255,255,0.46)',
  glassStrong: 'rgba(255,255,255,0.60)',
  rule: 'rgba(13,30,48,0.09)',
  accent: NAVY,
  accentInk: '#ffffff',
  sh: 'rgba(13,30,48,0.28)',
  bloom: 0.14,
  blur: 30,
  photo2: ['#C9CED4', '#E4E6E9', '#D2D6DB'],
  line: 'rgba(13,30,48,0.16)',
  band: NAVY,
  bandInk: OFF_WHITE,
  bandMuted: '#B4BDC8',
  soft: SOFT_GRAY,
  status: { forest: '#2F7A55', ochre: '#8F6216', brick: '#B8453B', slate: '#4F6E90' },
};

export const DARK: Palette = {
  dark: true,
  field: '#07111D',
  paper: '#13273D',
  ink: OFF_WHITE,
  muted: '#A3AFBD',
  glass: 'rgba(24,46,72,0.42)',
  glassStrong: 'rgba(22,42,66,0.60)',
  rule: 'rgba(220,220,220,0.16)',
  accent: SOFT_GRAY,
  accentInk: NAVY,
  sh: 'rgba(0,4,12,0.7)',
  bloom: 0.18,
  blur: 26,
  photo2: ['#1F3550', '#132538', '#27405C'],
  line: 'rgba(220,220,220,0.26)',
  band: '#081523',
  bandInk: OFF_WHITE,
  bandMuted: '#A3AFBD',
  soft: '#172D45',
  status: { forest: '#74C495', ochre: '#E2B461', brick: '#F2877B', slate: '#A9C0DB' },
};

/**
 * Status fills are semantic and never re-themed; each carries white text
 * (STATUS_INK). For status-colored text use `palette.status`, tuned per theme.
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

export const FONT = {
  display: 'BarlowCondensed_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  // Avenir ships on iOS; elsewhere fall back to the platform sans.
  sans: undefined as string | undefined,
};

/**
 * glass: cards · field: inputs and tiles · pill: badges and small pills ·
 * tabBar: the homeowner tab bar · card, button: aliases used by the brand screens.
 */
export const RADIUS = { glass: 18, card: 18, field: 14, pill: 20, button: 14, tabBar: 31 };
export const SPACE = { screen: 22, stack: 14, card: 16 };

/** Mix a hex color with transparency, e.g. accent at 16%. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
