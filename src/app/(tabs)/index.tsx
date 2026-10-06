// แดชบอร์ดที่ปรับเองได้
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { defaultType, PRESETS, SRC, type WidgetType } from '../../obd/catalog';
import { connect, session, setPage } from '../../core/engine';
import { curDash, setSettings, settings, updateDash, useSettings } from '../../core/settings';
import { useStore } from '../../core/store';
import { useFrame } from '../../core/values';
import { Btn, Card, Chip, Chips, confirm, Hint } from '../../ui/kit';
import { SourcePicker, TextPrompt } from '../../ui/Sheets';
import { useTheme } from '../../ui/theme';
import { WidgetView, type WidgetAction } from '../../ui/WidgetView';

const TYPES: WidgetType[] = ['num', 'bar', 'gauge', 'graph'];
const GAP = 10, PAD = 12;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export default function Dashboard() {
  const t = useTheme();
  const cfg = useSettings();
  const ses = useStore(session);
  const {width} = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState<null | 'new' | 'rename'>(null);
  useFrame(100, ses.state === 'connected');

  useFocusEffect(useCallback(() => {
    setPage('dash');
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!editing) return false;
      setEditing(false);
      return true;
    });
    return () => sub.remove();
  }, [editing]));

  const dash = curDash(cfg);
  const cols = width >= 1000 ? 6 : width >= 640 ? 4 : 2;
  const unit = (Math.min(width, 1200) - PAD * 2 - GAP * (cols - 1)) / cols;

  const act = (i: number, a: WidgetAction) => updateDash(d => {
    const ws = d.widgets, w = ws[i];
    if (a === 'left' && i > 0) [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]];
    if (a === 'right' && i < ws.length - 1) [ws[i + 1], ws[i]] = [ws[i], ws[i + 1]];
    if (a === 'type') w.type = TYPES[(TYPES.indexOf(w.type) + 1) % TYPES.length];
    if (a === 'size') w.size = w.size === 2 ? 1 : 2;
    if (a === 'del') ws.splice(i, 1);
    return d;
  });

  const onPrompt = (v: string | null) => {
    const kind = prompt;
    setPrompt(null);
    if (!v) return;
    if (kind === 'new') { setSettings(s => ({dash: [...s.dash, {name: v, widgets: []}], dashIdx: s.dash.length})); setEditing(true); }
    else updateDash(d => ({...d, name: v}));
  };

  return (
    <ScrollView contentContainerStyle={{padding: PAD, paddingBottom: 30, maxWidth: 1200, alignSelf: 'center', width: '100%'}}>
      {ses.state === 'idle' && (
        <Card style={{alignItems: 'center', paddingVertical: 24, marginBottom: 12}}>
          <Svg width={54} height={54} viewBox="0 0 108 108" fill="none">
            <Path d="M24 76a34 34 0 1 1 60 0" stroke={t.line} strokeWidth={8} strokeLinecap="round" />
            <Path d="M24 76a34 34 0 0 1 49-45" stroke={t.acc} strokeWidth={8} strokeLinecap="round" />
            <Path d="M54 74l16-20" stroke={t.fg} strokeWidth={5} strokeLinecap="round" />
            <Circle cx={54} cy={74} r={6} fill={t.fg} />
          </Svg>
          <Text style={{color: t.fg, fontSize: 18, fontWeight: '700', marginVertical: 6}}>ยังไม่ได้เชื่อมต่อ</Text>
          <Hint style={{textAlign: 'center'}}>ติดเครื่องรถ ปิดแอพ OBD ตัวอื่น แล้วกด “เชื่อมต่อ”{'\n'}หรือลองเล่นทุกฟังก์ชันด้วยรถจำลองก่อนก็ได้</Hint>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 14}}>
            <Btn title="เชื่อมต่อรถ" kind="pri" onPress={() => connect('ble')} />
            <Btn title="ลองโหมดจำลอง" onPress={() => connect('sim')} />
          </View>
        </Card>
      )}

      <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
        <View style={{flex: 1}}>
          <Chips>
            {cfg.dash.map((d, i) => <Chip key={i} title={d.name} on={i === cfg.dashIdx} onPress={() => setSettings({dashIdx: i})} />)}
            <Chip title="+ หน้าใหม่" onPress={() => setPrompt('new')} />
          </Chips>
        </View>
        <Btn title={editing ? '✓ เสร็จ' : '✎ แก้ไข'} kind={editing ? 'pri' : 'sec'} onPress={() => setEditing(!editing)} />
      </View>
      {editing && (
        <View style={{flexDirection: 'row', gap: 8, marginBottom: 10}}>
          <Btn title="เปลี่ยนชื่อ" onPress={() => setPrompt('rename')} />
          <Btn title="ค่าเริ่มต้น" onPress={() => updateDash(d => ({...d, widgets: clone((PRESETS.find(p => p.name === d.name) ?? PRESETS[0]).widgets)}))} />
          <Btn title="ลบหน้านี้" kind="bad" disabled={cfg.dash.length < 2} onPress={async () => {
            if (await confirm('ลบหน้านี้?', `ลบหน้า "${dash.name}"`, 'ลบ'))
              setSettings(s => ({dash: s.dash.filter((_, i) => i !== s.dashIdx), dashIdx: 0}));
          }} />
        </View>
      )}

      <View style={st.grid}>
        {dash.widgets.map((w, i) => (
          <WidgetView key={i + w.id + w.type + w.size} w={w} editing={editing}
            width={w.size === 2 ? unit * 2 + GAP : unit} onAction={a => act(i, a)} />
        ))}
        {editing && (
          <Pressable onPress={() => setAdding(true)} style={[st.add, {width: unit, borderColor: t.line}]}>
            <Text style={{color: t.mut, fontWeight: '600'}}>+ เพิ่มวิดเจ็ต</Text>
          </Pressable>
        )}
      </View>
      {!dash.widgets.length && !editing && <Hint style={{textAlign: 'center', marginTop: 20}}>หน้านี้ยังว่าง กด “✎ แก้ไข” เพื่อเพิ่มวิดเจ็ต</Hint>}

      <SourcePicker visible={adding} title="เพิ่มวิดเจ็ต" onClose={() => setAdding(false)}
        onPick={id => updateDash(d => ({...d, widgets: [...d.widgets, {id, type: defaultType(SRC[id]), size: 1}]}))} />
      {prompt && <TextPrompt visible title={prompt === 'new' ? 'ชื่อหน้าใหม่' : 'เปลี่ยนชื่อหน้า'}
        initial={prompt === 'new' ? 'หน้า ' + (settings.get().dash.length + 1) : dash.name} onDone={onPrompt} />}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: GAP},
  add: {borderWidth: 2, borderStyle: 'dashed', borderRadius: 14, minHeight: 96, alignItems: 'center', justifyContent: 'center'},
});
