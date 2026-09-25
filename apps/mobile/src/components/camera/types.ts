// Shared camera/photo types. Pure (no React Native imports).

/** A photo ready to upload: JPEG, long edge at most MAX_EDGE px. */
export interface CapturedPhoto {
  /** Native: a file:// URI in the cache directory. Web: a data: URI. Usable as an <Image> source. */
  uri: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  /** JPEG bytes as base64, without a `data:` prefix. */
  base64: string;
  /** Web only: the JPEG as a Blob (uploads send this instead of decoding base64). */
  blob?: Blob;
}

export interface CaptureOptions {
  /** Which camera to open. Defaults to the back camera. */
  facing?: 'back' | 'front';
  /** Native only: the eyebrow shown above the viewfinder, e.g. "Replace HVAC filter". */
  title?: string;
}

export interface PhotoCaptureApi {
  /**
   * Native: opens the full-screen camera. Web: opens the file picker (camera on
   * phones). Resolves null when the person cancels. Throws a FriendlyError when
   * the picked file can't be read.
   */
  capture(opts?: CaptureOptions): Promise<CapturedPhoto | null>;
}

/** Imperative handle for <PlateViewfinder ref={…}>. */
export interface PlateViewfinderHandle {
  /**
   * Native + active + camera allowed: takes a photo from the live preview.
   * Web + active: opens the file picker (call it straight from the press handler).
   * Resolves null when inactive, cancelled, or the camera is off.
   */
  takePhoto(): Promise<CapturedPhoto | null>;
}

export interface PlateViewfinderProps {
  /** Live mode: use the camera (native) or the file picker (web). False shows `children` only. */
  active: boolean;
  /** Reading a plate: the accent bounding box goes from 35% to full opacity. */
  busy: boolean;
  /** The sample plate card, shown on web and whenever the camera isn't live. */
  children?: import('react').ReactNode;
  /** Drawn on top in every state, e.g. the "Tap shutter · 0 of 5 captured" pill. */
  overlay?: import('react').ReactNode;
  ref?: import('react').Ref<PlateViewfinderHandle>;
}
