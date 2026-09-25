// Native downscale + JPEG re-encode with expo-image-manipulator's contextual
// API (ImageManipulator.manipulate → resize → renderAsync → saveAsync).
// Imported only by the native camera components, never on web.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FriendlyError } from '../../lib/errors';
import { JPEG_QUALITY, MAX_EDGE, fitWithin, stripDataUrl } from './photoUtils';
import type { CapturedPhoto } from './types';

export const PHOTO_FAILED = "Couldn't save that photo. Try again.";

async function render(uri: string, target: { width: number } | { height: number } | null) {
  const ctx = ImageManipulator.manipulate(uri);
  try {
    if (target) ctx.resize(target);
    const img = await ctx.renderAsync();
    try {
      return await img.saveAsync({ base64: true, compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    } finally {
      img.release();
    }
  } finally {
    ctx.release();
  }
}

/**
 * Downscale a local image so its long edge is at most MAX_EDGE and re-encode
 * it as JPEG (quality JPEG_QUALITY), with base64. `width`/`height` are the
 * source size as reported by the camera.
 */
export async function downscaleNative(uri: string, width: number, height: number): Promise<CapturedPhoto> {
  try {
    // Resize by the long edge only, so the aspect ratio is always preserved.
    const t = fitWithin(width, height, MAX_EDGE);
    let out = await render(uri, t.scale < 1 ? (width >= height ? { width: t.width } : { height: t.height }) : null);
    // The camera's reported size can disagree with the decoded orientation;
    // if the result is still too big, scale the result once more.
    if (Math.max(out.width, out.height) > MAX_EDGE + 1) {
      const again = fitWithin(out.width, out.height, MAX_EDGE);
      out = await render(out.uri, out.width >= out.height ? { width: again.width } : { height: again.height });
    }
    if (!out.base64) throw new Error('no base64');
    return { uri: out.uri, mimeType: 'image/jpeg', width: out.width, height: out.height, base64: stripDataUrl(out.base64) };
  } catch (e) {
    if (e instanceof FriendlyError) throw e;
    throw new FriendlyError(PHOTO_FAILED);
  }
}
