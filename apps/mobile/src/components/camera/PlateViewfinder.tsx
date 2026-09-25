// Onboarding step 2 viewfinder (native). Active + camera allowed: a live
// preview fills the scan box under the accent bounding box, and
// ref.takePhoto() shoots from it. Otherwise it shows `children` (the sample
// plate card). The web build uses PlateViewfinder.web.tsx.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { FriendlyError } from '../../lib/errors';
import { TextLink } from '../../ui/controls';
import { Txt } from '../../ui/primitives';
import { downscaleNative } from './nativeImage';
import { CAMERA_OFF } from './photoUtils';
import { PlateFrame } from './PlateFrame';
import type { CapturedPhoto, PlateViewfinderProps } from './types';

const SHOT_FAILED = "Couldn't take the photo. Try again.";
const READY_WAIT_MS = 3000;

type State = 'off' | 'checking' | 'asking' | 'granted' | 'denied';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function PlateViewfinder({ active, busy, children, overlay, ref }: PlateViewfinderProps) {
  const [perm, requestPerm, getPerm] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  const camRef = useRef<CameraView>(null);
  const readyRef = useRef(false);

  const state: State =
    !active || mountFailed ? 'off' : !perm ? 'checking' : perm.granted ? 'granted' : !asked && perm.canAskAgain ? 'asking' : 'denied';

  useEffect(() => {
    if (state === 'asking') {
      setAsked(true);
      void requestPerm();
    }
    if (state !== 'granted') readyRef.current = false;
  }, [state, requestPerm]);

  // Coming back from Settings: pick up a newly granted permission.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void getPerm();
    });
    return () => sub.remove();
  }, [active, getPerm]);

  const takePhoto = useCallback(async (): Promise<CapturedPhoto | null> => {
    if (state === 'denied' && perm?.canAskAgain) {
      void requestPerm();
      return null;
    }
    if (state !== 'granted') return null;
    const t0 = Date.now();
    while (!readyRef.current && Date.now() - t0 < READY_WAIT_MS) await sleep(100);
    const cam = camRef.current;
    if (!cam || !readyRef.current) return null;
    try {
      const pic = await cam.takePictureAsync({ quality: 0.85, exif: false });
      if (!pic?.uri) throw new Error('no picture');
      return await downscaleNative(pic.uri, pic.width, pic.height);
    } catch (e) {
      throw e instanceof FriendlyError ? e : new FriendlyError(SHOT_FAILED);
    }
  }, [state, perm, requestPerm]);

  useImperativeHandle(ref, () => ({ takePhoto }), [takePhoto]);

  if (state === 'granted') {
    return (
      <PlateFrame busy={busy} overlay={overlay}>
        <CameraView
          ref={camRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          mute
          onCameraReady={() => {
            readyRef.current = true;
          }}
          onMountError={() => setMountFailed(true)}
        />
      </PlateFrame>
    );
  }

  if (state === 'denied') {
    return (
      <PlateFrame busy={busy} showBox={false} overlay={overlay}>
        <View testID="camera-denied" accessibilityRole="alert" style={{ alignItems: 'center', gap: 10, paddingHorizontal: 32, marginTop: -24 }}>
          <Txt size={13} weight="600" style={{ textAlign: 'center', lineHeight: 19 }}>
            {CAMERA_OFF}
          </Txt>
          <View style={{ alignSelf: 'center' }}>
            <TextLink accent onPress={() => (perm?.canAskAgain ? void requestPerm() : void Linking.openSettings())}>
              {perm?.canAskAgain ? 'Allow camera' : 'Open Settings'}
            </TextLink>
          </View>
        </View>
      </PlateFrame>
    );
  }

  // Inactive (demo), or the camera couldn't start: the sample plate.
  // While permission is being checked or asked, the box stays empty.
  return (
    <PlateFrame busy={busy} overlay={overlay}>
      {state === 'off' ? children : null}
    </PlateFrame>
  );
}
