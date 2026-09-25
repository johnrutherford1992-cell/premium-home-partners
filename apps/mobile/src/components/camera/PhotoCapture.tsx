// Native photo capture: usePhotoCapture().capture() opens a full-screen
// camera hosted by <PhotoCaptureHost />, mounted once at the app root.
// The web build uses PhotoCapture.web.tsx (file input) instead.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FriendlyError } from '../../lib/errors';
import { STATUS } from '../../theme/tokens';
import { PhotoBox, Row, Stage, TextLink } from '../../ui/controls';
import { Eyebrow, LqButton, Txt } from '../../ui/primitives';
import { downscaleNative } from './nativeImage';
import { CAMERA_OFF } from './photoUtils';
import { Shutter } from './Shutter';
import type { CaptureOptions, CapturedPhoto, PhotoCaptureApi } from './types';

const SHOT_FAILED = "Couldn't take the photo. Try again.";

interface CaptureRequest {
  id: number;
  facing: 'back' | 'front';
  title?: string;
  resolve: (photo: CapturedPhoto | null) => void;
}

// One pending request at a time, shared by every caller and the host.
let seq = 0;
let current: CaptureRequest | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot() {
  return current;
}

function settle(id: number, photo: CapturedPhoto | null) {
  if (!current || current.id !== id) return;
  const req = current;
  current = null;
  emit();
  req.resolve(photo);
}

/** Open the camera; resolves with the downscaled photo, or null on Cancel. */
export function capturePhoto(opts: CaptureOptions = {}): Promise<CapturedPhoto | null> {
  if (hosts === 0) {
    if (__DEV__) console.warn('capturePhoto(): mount <PhotoCaptureHost /> once in the root layout.');
    return Promise.resolve(null);
  }
  if (current) settle(current.id, null);
  return new Promise((resolve) => {
    current = { id: ++seq, facing: opts.facing ?? 'back', title: opts.title, resolve };
    emit();
  });
}

export function usePhotoCapture(): PhotoCaptureApi {
  return useMemo(() => ({ capture: capturePhoto }), []);
}

/** Native full-screen camera modal. Mount once at the app root (inside SafeAreaProvider). */
export function PhotoCaptureHost() {
  const req = useSyncExternalStore(subscribe, snapshot, snapshot);
  // Keep the last sheet rendered while the modal slides away.
  const [shown, setShown] = useState<CaptureRequest | null>(req);
  if (req && req !== shown) setShown(req);

  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      if (hosts === 0 && current) settle(current.id, null);
    };
  }, []);

  const cancel = useCallback(() => {
    if (current) settle(current.id, null);
  }, []);

  return (
    <Modal
      visible={req !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {shown ? <CameraSheet key={shown.id} req={shown} open={req === shown} onCancel={cancel} /> : null}
    </Modal>
  );
}

type PermState = 'checking' | 'asking' | 'granted' | 'denied';

function CameraSheet({ req, open, onCancel }: { req: CaptureRequest; open: boolean; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const [perm, requestPerm, getPerm] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const camRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameH, setFrameH] = useState(0);

  const state: PermState = !perm ? 'checking' : perm.granted ? 'granted' : !asked && perm.canAskAgain ? 'asking' : 'denied';

  // Ask once, as soon as the sheet opens.
  useEffect(() => {
    if (open && state === 'asking') {
      setAsked(true);
      void requestPerm();
    }
  }, [open, state, requestPerm]);

  // Coming back from Settings: pick up a newly granted permission.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void getPerm();
    });
    return () => sub.remove();
  }, [getPerm]);

  const shoot = async () => {
    const cam = camRef.current;
    if (!cam || !ready || busy || !open) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await cam.takePictureAsync({ quality: 0.85, exif: false });
      if (!pic?.uri) throw new Error('no picture');
      const photo = await downscaleNative(pic.uri, pic.width, pic.height);
      settle(req.id, photo);
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : SHOT_FAILED);
      setBusy(false);
    }
  };

  const fixAccess = () => {
    if (perm?.canAskAgain) void requestPerm();
    else void Linking.openSettings();
  };

  return (
    <Stage>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 440,
          alignSelf: 'center',
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 22,
          gap: 14,
        }}
      >
        <Row>
          <TextLink onPress={onCancel}>Cancel</TextLink>
          <Eyebrow accent>{req.title ?? 'Photo'}</Eyebrow>
        </Row>
        <View style={{ flex: 1 }} onLayout={(e) => setFrameH(Math.round(e.nativeEvent.layout.height))}>
          {frameH > 0 ? (
            <PhotoBox height={frameH} radius={22} style={{ alignItems: 'center', justifyContent: 'center' }}>
              {state === 'granted' ? (
                <CameraView
                  ref={camRef}
                  style={StyleSheet.absoluteFill}
                  facing={req.facing}
                  mode="picture"
                  active={open}
                  mute
                  onCameraReady={() => setReady(true)}
                  onMountError={() => setError(SHOT_FAILED)}
                />
              ) : null}
              {state === 'denied' ? (
                <View testID="camera-denied" accessibilityRole="alert" style={{ alignItems: 'center', gap: 12, paddingHorizontal: 28 }}>
                  <Txt weight="600" style={{ textAlign: 'center', lineHeight: 21 }}>
                    {CAMERA_OFF}
                  </Txt>
                  <LqButton variant="ghost" onPress={fixAccess}>
                    {perm?.canAskAgain ? 'Allow camera' : 'Open Settings'}
                  </LqButton>
                </View>
              ) : null}
            </PhotoBox>
          ) : null}
        </View>
        {error ? (
          <Txt size={13} color={STATUS.brick} accessibilityRole="alert" style={{ textAlign: 'center' }}>
            {error}
          </Txt>
        ) : null}
        <View style={{ alignItems: 'center' }}>
          <Shutter onPress={() => void shoot()} busy={busy} disabled={state !== 'granted' || !ready} />
        </View>
      </View>
    </Stage>
  );
}
