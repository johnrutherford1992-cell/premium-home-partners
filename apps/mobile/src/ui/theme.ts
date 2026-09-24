import { DARK, LIGHT, type Palette } from '../theme/tokens';
import { useApp } from '../store/app';

export function usePalette(): Palette {
  return useApp((s) => (s.dark ? DARK : LIGHT));
}
