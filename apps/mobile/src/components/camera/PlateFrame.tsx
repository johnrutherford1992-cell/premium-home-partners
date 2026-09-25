import type { ReactNode } from 'react';
import { View } from 'react-native';
import { PhotoBox } from '../../ui/controls';
import { usePalette } from '../../ui/theme';

/**
 * The onboarding scan box: the 220pt, radius-22 PhotoBox with the accent
 * bounding box (35% idle, 100% while busy) and an optional overlay on top.
 */
export function PlateFrame({ busy, showBox = true, overlay, children }: { busy: boolean; showBox?: boolean; overlay?: ReactNode; children?: ReactNode }) {
  const c = usePalette();
  return (
    <PhotoBox height={220} radius={22} style={{ alignItems: 'center', justifyContent: 'center' }}>
      {children}
      {showBox ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 60, right: 60, top: 52, bottom: 52, borderWidth: 2.5, borderColor: c.accent, borderRadius: 14, opacity: busy ? 1 : 0.35 }}
        />
      ) : null}
      {overlay}
    </PhotoBox>
  );
}
