import { Pressable, View } from 'react-native';
import type { TierView } from '../data/pricing';
import { Display, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

/**
 * The four coverage tiers. Full rows on onboarding, compact rows on the Plan tab.
 * Props-driven so it works in both modes: onboarding passes a local selection
 * (live) or the demo store's tier; Plan passes the plan's tier and setTier.
 */
export function TierPicker({
  compact,
  tiers,
  selected,
  onSelect,
  disabled,
}: {
  compact?: boolean;
  tiers: TierView[];
  selected: number;
  onSelect: (index: number) => void;
  /** While a tier change is saving: rows don't respond and dim slightly. */
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={{ gap: compact ? 8 : 14, opacity: disabled ? 0.6 : 1 }}>
      {tiers.map((t, i) => {
        const on = selected === i;
        return (
          <Pressable
            key={t.name}
            testID={`tier-${i}`}
            onPress={() => onSelect(i)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: compact ? 11 : 14,
              paddingHorizontal: compact ? 14 : 16,
              borderRadius: compact ? 14 : 18,
              borderWidth: on ? 2 : 1,
              borderColor: on ? c.accent : c.rule,
              backgroundColor: on ? c.glassStrong : c.glass,
            }}
          >
            {compact ? null : (
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 6 : 1.5, borderColor: on ? c.accent : c.muted }} />
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <Txt size={compact ? 14 : 15} weight="600">
                {t.name}
                {compact ? (
                  <Txt size={12} muted>
                    {'  · ' + t.visitsTxt}
                  </Txt>
                ) : null}
              </Txt>
              {compact ? null : (
                <Txt size={12} muted>
                  {t.visitsTxt} · {t.tier.tag}
                </Txt>
              )}
            </View>
            {compact ? (
              <Txt weight="600" testID={`tier-monthly-${i}`}>
                {t.monthlyTxt}
              </Txt>
            ) : (
              <Txt testID={`tier-monthly-${i}`}>
                <Display size={26} style={{ lineHeight: 28 }}>
                  {t.monthlyTxt}
                </Display>
                <Txt size={11} muted>
                  /mo
                </Txt>
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
