// กราฟสดหลายเส้น
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { fmtVal, SRC } from '../../obd/catalog';
import { now } from '../../obd/elm';
import { setPage } from '../../core/engine';
import { setSettings, useSettings } from '../../core/settings';
import { useFrame, val } from '../../core/values';
import { MultiChart } from '../../ui/Chart';
import { Btn, Card, Chip, Chips, Hint } from '../../ui/kit';
import { SourcePicker } from '../../ui/Sheets';
import { GRAPH_COLORS, useTheme } from '../../ui/theme';

const WINDOWS: [number, string][] = [[30, '30 วิ'], [60, '1 นาที'], [120, '2 นาที'], [300, '5 นาที']];

export default function Graph() {
  const t = useTheme();
  const cfg = useSettings();
  const [frozen, setFrozen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [w, setW] = useState(0);
  useFrame(200, frozen == null);
  useFocusEffect(useCallback(() => { setPage('graph'); }, []));

  return (
    <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 1000, alignSelf: 'center', width: '100%'}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
        <View style={{flex: 1}}>
          <Chips>{WINDOWS.map(([s, n]) => <Chip key={s} title={n} on={cfg.graphWin === s} onPress={() => setSettings({graphWin: s})} />)}</Chips>
        </View>
        <Btn title={frozen == null ? '❚❚' : '▶'} onPress={() => setFrozen(frozen == null ? now() : null)} />
      </View>
      <Card style={{padding: 0, overflow: 'hidden'}}>
        <View onLayout={e => setW(e.nativeEvent.layout.width)}>
          {w > 0 && <MultiChart ids={cfg.graph} colors={GRAPH_COLORS} width={w} height={300} winSec={cfg.graphWin} frozenAt={frozen} />}
        </View>
      </Card>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14, marginVertical: 10}}>
        {cfg.graph.map((id, i) => SRC[id] && (
          <View key={id} style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
            <View style={{width: 12, height: 4, borderRadius: 2, backgroundColor: GRAPH_COLORS[i]}} />
            <Text style={{color: t.fg, fontSize: 13}}>{SRC[id].name} <Text style={{fontWeight: '700'}}>{fmtVal(SRC[id], val(id))}</Text> {SRC[id].unit}</Text>
            <Pressable hitSlop={8} onPress={() => setSettings(s => ({graph: s.graph.filter(x => x !== id)}))}>
              <Text style={{color: t.mut, fontSize: 15, paddingHorizontal: 4}}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <Btn title="+ เพิ่มเส้นกราฟ" disabled={cfg.graph.length >= 4} onPress={() => setAdding(true)} />
        <Hint>สูงสุด 4 เส้น · แต่ละเส้นปรับสเกลอัตโนมัติ</Hint>
      </View>
      <SourcePicker visible={adding} title="เพิ่มเส้นกราฟ" onClose={() => setAdding(false)}
        onPick={id => setSettings(s => ({graph: s.graph.includes(id) ? s.graph : [...s.graph, id].slice(0, 4)}))} />
    </ScrollView>
  );
}
