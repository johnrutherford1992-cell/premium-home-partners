import { useState } from 'react';
import { View } from 'react-native';
import { TierPicker } from '../../../components/TierPicker';
import { useTiers, useYearOfCare } from '../../../store/derived';
import { Row, Screen, TextLink } from '../../../ui/controls';
import { Display, LqSectionTitle, Mono, Txt } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';

export default function PlanTab() {
  const { cur } = useTiers();
  const year = useYearOfCare();
  const [edit, setEdit] = useState(false);
  const c = usePalette();
  return (
    <Screen bottomInset={110}>
      <Row style={{ alignItems: 'flex-end' }}>
        <View>
          <Txt size={13} muted>
            Your plan
          </Txt>
          <Display size={30} style={{ lineHeight: 30 }}>
            {cur.name}
          </Display>
        </View>
        <Txt>
          <Display size={30}>{cur.monthlyTxt}</Display>
          <Txt size={12} muted>
            /mo
          </Txt>
        </Txt>
      </Row>
      <TextLink accent onPress={() => setEdit(!edit)}>
        {edit ? 'Done' : 'Change coverage ›'}
      </TextLink>
      {edit ? <TierPicker compact /> : null}
      <LqSectionTitle>Your year of care</LqSectionTitle>
      <View style={{ gap: 8 }}>
        {year.map((v) => (
          <View
            key={v.label}
            style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.rule }}
          >
            <View style={{ width: 52 }}>
              <Display size={22} style={{ lineHeight: 22 }} color={v.first ? c.accent : c.ink}>
                {v.month}
              </Display>
              <Mono size={10} muted>
                {v.label}
              </Mono>
            </View>
            <Txt size={13} style={{ flex: 1, lineHeight: 19 }}>
              {v.items}
            </Txt>
          </View>
        ))}
      </View>
    </Screen>
  );
}
