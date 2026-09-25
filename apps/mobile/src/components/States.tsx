// Loading, error and empty states for every data screen, built from the
// existing primitives so they sit in the Concierge Mist layout unchanged.

import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Pulse } from '../ui/Pulse';
import { LqButton, LqCard, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

/** An LqCard with a pulsing muted line. */
export function LoadingState({ label = 'Loading…', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <LqCard style={[{ gap: 10 }, style]}>
      <View testID="state-loading" accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: 10 }}>
        <Pulse>
          <Txt size={13} muted>
            {label}
          </Txt>
        </Pulse>
        <Pulse period={1600}>
          <View style={{ height: 8, width: '62%', borderRadius: 4, backgroundColor: c.rule }} />
        </Pulse>
      </View>
    </LqCard>
  );
}

/** An LqCard with a 600-weight title, a muted message and a ghost "Try again". */
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  style,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LqCard style={[{ gap: 6 }, style]}>
      <View testID="state-error" accessibilityRole="alert" style={{ gap: 6 }}>
        <Txt weight="600">{title}</Txt>
        <Txt size={13} muted style={{ lineHeight: 19 }}>
          {message}
        </Txt>
      </View>
      {onRetry ? (
        <LqButton variant="ghost" onPress={onRetry} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
          Try again
        </LqButton>
      ) : null}
    </LqCard>
  );
}

/** The same shape as the vendor's "No requests yet" card. */
export function EmptyState({ title, body, style }: { title: string; body?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <LqCard style={style}>
      <View testID="state-empty">
        <Txt weight="600">{title}</Txt>
        {body ? (
          <Txt size={13} muted style={{ marginTop: 6, lineHeight: 19 }}>
            {body}
          </Txt>
        ) : null}
      </View>
    </LqCard>
  );
}
