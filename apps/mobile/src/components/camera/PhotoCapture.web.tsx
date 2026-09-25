// Web photo capture: capture() opens a hidden file input (the camera on
// phones, a file picker on desktop). Same API as PhotoCapture.tsx.

import { useMemo } from 'react';
import { capturePhotoWeb } from './webCapture';
import type { CaptureOptions, CapturedPhoto, PhotoCaptureApi } from './types';

/**
 * Open the file picker; resolves with the downscaled photo, or null when it's
 * dismissed. Call it straight from a press handler (no await before it), so
 * the browser treats it as part of the tap.
 */
export function capturePhoto(opts: CaptureOptions = {}): Promise<CapturedPhoto | null> {
  return capturePhotoWeb(opts);
}

export function usePhotoCapture(): PhotoCaptureApi {
  return useMemo(() => ({ capture: capturePhoto }), []);
}

/** Nothing to host on web: the browser provides the camera UI. */
export function PhotoCaptureHost() {
  return null;
}
