// Onboarding step 2 viewfinder (web): always the sample plate card under the
// accent bounding box. When active, ref.takePhoto() opens the file picker
// (the camera on phones), so call it straight from the shutter's press handler.

import { useImperativeHandle } from 'react';
import { PlateFrame } from './PlateFrame';
import { capturePhotoWeb } from './webCapture';
import type { PlateViewfinderProps } from './types';

export function PlateViewfinder({ active, busy, children, overlay, ref }: PlateViewfinderProps) {
  useImperativeHandle(
    ref,
    () => ({
      // No await before the picker opens, so the click stays inside the tap.
      takePhoto: () => (active ? capturePhotoWeb({ facing: 'back' }) : Promise.resolve(null)),
    }),
    [active],
  );
  return (
    <PlateFrame busy={busy} overlay={overlay}>
      {children}
    </PlateFrame>
  );
}
