// Web photo capture: a hidden <input type="file" capture> the browser turns
// into the camera on phones and a file picker on desktop, then a canvas
// downscale to JPEG. DOM only (no React Native imports), so it can also be
// bundled on its own for browser tests.

import { FriendlyError } from '../../lib/errors';
import { JPEG_QUALITY, MAX_EDGE, fitWithin, stripDataUrl } from './photoUtils';
import type { CaptureOptions, CapturedPhoto } from './types';

export const UNREADABLE_PHOTO = "We couldn't read that photo. Try another one.";

/**
 * Older browsers never fire `cancel` on file inputs. When the window regains
 * focus and no file has arrived after this long, treat the picker as
 * dismissed. Phones get longer: coming back from the camera app, the file can
 * take a moment to land.
 */
function focusCancelMs(): number {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 8000 : 2500;
}

let pendingCancel: (() => void) | null = null;

/**
 * Open the camera / file picker and resolve with the chosen file, or null
 * when it's dismissed. Must be called synchronously from a user gesture
 * (a press handler): the input is clicked before this function first awaits.
 */
export function pickImageFile(opts: CaptureOptions = {}): Promise<File | null> {
  // Only one picker at a time: a new request dismisses the previous one.
  pendingCancel?.();

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', opts.facing === 'front' ? 'user' : 'environment');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.dataset.photoCapture = '1';
  // Visually hidden but still in the document: iOS Safari won't open a
  // detached input, and Playwright's `filechooser` event needs it attached.
  Object.assign(input.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(input);

  return new Promise<File | null>((resolve) => {
    let settled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      if (focusTimer) clearTimeout(focusTimer);
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onFocus);
      if (pendingCancel === cancelThis) pendingCancel = null;
      input.remove();
      resolve(file);
    };
    const cancelThis = () => finish(null);
    const onChange = () => finish(input.files?.[0] ?? null);
    const onCancel = () => finish(null);
    const onFocus = () => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, focusCancelMs());
    };

    pendingCancel = cancelThis;
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    // The window only regains focus when the picker closes (it blurs on open).
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new FriendlyError(UNREADABLE_PHOTO));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new FriendlyError(UNREADABLE_PHOTO))), 'image/jpeg', quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new FriendlyError(UNREADABLE_PHOTO));
    r.readAsDataURL(blob);
  });
}

/**
 * Decode an image file (EXIF orientation applied by the browser), downscale
 * it to a long edge of at most `maxEdge`, and re-encode it as JPEG.
 */
export async function downscaleImageFile(file: Blob, maxEdge: number = MAX_EDGE, quality: number = JPEG_QUALITY): Promise<CapturedPhoto> {
  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new FriendlyError(UNREADABLE_PHOTO);
  const { width, height } = fitWithin(srcW, srcH, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FriendlyError(UNREADABLE_PHOTO);
  // JPEG has no alpha: flatten transparent PNGs onto white instead of black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await canvasToJpeg(canvas, quality);
  const dataUrl = await blobToDataUrl(blob);
  return { uri: dataUrl, mimeType: 'image/jpeg', width, height, base64: stripDataUrl(dataUrl), blob };
}

/** Pick (or shoot) a photo and return it downscaled, or null when cancelled. */
export function capturePhotoWeb(opts: CaptureOptions = {}): Promise<CapturedPhoto | null> {
  // No await before the picker opens, so the click stays inside the user gesture.
  return pickImageFile(opts).then((file) => (file ? downscaleImageFile(file) : null));
}
