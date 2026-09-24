// Liquid Glass tokens, ported from the @php/ui design system (_ds_bundle.css).

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
}

export const LIGHT: Palette = {
  dark: false,
  field: '#f4f7fb',
  paper: '#ffffff',
  ink: '#1b2430',
  muted: '#6b7888',
  glass: 'rgba(255,255,255,0.46)',
  glassStrong: 'rgba(255,255,255,0.60)',
  rule: 'rgba(27,36,48,0.09)',
  accent: '#5b86b3',
  accentInk: '#ffffff',
  sh: 'rgba(40,56,80,0.28)',
  bloom: 0.14,
  blur: 30,
  photo2: ['#b7c8dc', '#dce6f1', '#c3d1e1'],
};

export const DARK: Palette = {
  dark: true,
  field: '#06080e',
  paper: '#0c1322',
  ink: '#eaf1ff',
  muted: '#8c9bbd',
  glass: 'rgba(20,28,50,0.42)',
  glassStrong: 'rgba(18,26,48,0.60)',
  rule: 'rgba(120,160,255,0.20)',
  accent: '#4ea8ff',
  accentInk: '#03101f',
  sh: 'rgba(0,4,20,0.7)',
  bloom: 0.3,
  blur: 26,
  photo2: ['#1b3a78', '#0e1c3c', '#243f86'],
};

/** Status colors are semantic and never re-themed. */
export const STATUS = {
  forest: '#5d9069',
  ochre: '#d99a3f',
  brick: '#d05757',
  slate: '#7a93b0',
} as const;

export type Tone = keyof typeof STATUS | 'neutral';

export const FONT = {
  display: 'BarlowCondensed_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  // Avenir ships on iOS; elsewhere fall back to the platform sans.
  sans: undefined as string | undefined,
};

export const RADIUS = { glass: 18, field: 14, pill: 20, tabBar: 31 };
export const SPACE = { screen: 22, stack: 14, card: 16 };

/** Mix a hex color with transparency, e.g. accent at 16%. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
