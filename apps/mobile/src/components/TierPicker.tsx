import { Pressable, View } from 'react-native';
import { useApp } from '../store/app';
import { useTiers } from '../store/derived';
import { Display, Txt } from '../ui/primitives';
import { usePalette } from '../ui/theme';

/** The four coverage tiers. Full rows on onboarding, compact rows on the Plan tab. */
export function TierPicker({ compact }: { compact?: boolean }) {
  const { tiers } = useTiers();
  const tier = useApp((s) => s.tier);
  const set = useApp((s) => s.set);
  const c = usePalette();
  return (
    <View style={{ gap: compact ? 8 : 14 }}>
      {tiers.map((t, i) => {
        const on = tier === i;
        return (
          <Pressable
            key={t.name}
            onPress={() => set({ tier: i })}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
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
              <Txt weight="600">{t.monthlyTxt}</Txt>
            ) : (
              <Txt>
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
