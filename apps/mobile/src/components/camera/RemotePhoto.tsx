import { useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { PhotoBox } from '../../ui/controls';
import { Mono } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useSignedPhotoUrl } from './signedUrls';

/**
 * A stored visit photo in the report-tile frame: PhotoBox (124pt, radius 14 by
 * default), tag chip top-left, "tech photo" caption bottom-left. The gradient
 * shows while the image loads, and stays if it can't be loaded.
 */
export function RemotePhoto({
  path,
  height = 124,
  radius = 14,
  tag,
  caption = 'tech photo',
  colors,
  style,
  testID,
}: {
  /** Storage path in `visit-photos`, e.g. from TaskVM.photos[i].path. Null shows the placeholder. */
  path: string | null | undefined;
  height?: number;
  radius?: number;
  /** Chip text, e.g. 'after' (shown uppercase). */
  tag?: string;
  caption?: string | null;
  /** Placeholder gradient, e.g. PHOTO_GRADIENTS[task.photo]. Defaults to the palette's photo gradient. */
  colors?: readonly [string, string, ...string[]];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = usePalette();
  const url = useSignedPhotoUrl(path);
  const [failed, setFailed] = useState<string | null>(null);
  const show = url !== null && failed !== url;
  return (
    <PhotoBox height={height} radius={radius} colors={colors} style={style}>
      {show ? (
        <Image
          testID={testID}
          source={{ uri: url }}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(url)}
          accessibilityLabel={tag ? `${tag} photo` : 'Photo'}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {tag ? (
        <View style={{ position: 'absolute', left: 8, top: 8, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, backgroundColor: c.glassStrong }}>
          <Mono size={9} medium>
            {tag.toUpperCase()}
          </Mono>
        </View>
      ) : null}
      {caption ? (
        <Mono size={10} color="#fff" style={{ position: 'absolute', left: 8, bottom: 8, opacity: 0.85 }}>
          {caption}
        </Mono>
      ) : null}
    </PhotoBox>
  );
}
