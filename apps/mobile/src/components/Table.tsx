import { useState, type ReactNode } from 'react';
import { ScrollView, View, type DimensionValue } from 'react-native';
import { Mono } from '../ui/primitives';
import { usePalette } from '../ui/theme';

export interface Col {
  label: string;
  /** Fixed width, or flex weight when `flex` is set. */
  width?: number;
  flex?: number;
  minWidth?: number;
  align?: 'left' | 'center';
  color?: string;
}

/** Office data table: ink rule under the header, hairlines between rows, horizontal scroll under 760pt. */
export function Table({ cols, rows, minWidth = 760, rowPad = 8 }: { cols: Col[]; rows: ReactNode[][]; minWidth?: number; rowPad?: number }) {
  const c = usePalette();
  // Pin the table to the visible width (or minWidth, whichever is larger) so long
  // cell text wraps inside its flex column instead of widening the scroll content.
  const [viewW, setViewW] = useState(0);
  const tableW = viewW > 0 ? Math.max(minWidth, viewW) : undefined;
  const cell = (col: Col, child: ReactNode, key: string | number) => (
    <View
      key={key}
      style={{
        width: col.width as DimensionValue | undefined,
        flex: col.flex,
        minWidth: col.minWidth,
        alignItems: col.align === 'center' ? 'center' : 'flex-start',
        justifyContent: 'center',
      }}
    >
      {child}
    </View>
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
      onLayout={(e) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        if (w !== viewW) setViewW(w);
      }}
    >
      <View style={tableW ? { width: tableW } : { minWidth, flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: c.ink }}>
          {cols.map((col, i) =>
            cell(
              col,
              <Mono size={10} medium tracking={0.06} color={col.color ?? c.muted}>
                {col.label}
              </Mono>,
              i,
            ),
          )}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: rowPad, borderBottomWidth: 1, borderColor: c.rule }}>
            {r.map((child, i) => cell(cols[i], child, i))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
