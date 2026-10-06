// แถบบน: ชื่อหน้า, สถานะ, บันทึก, HUD, เชื่อมต่อ, ตั้งค่า
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { t as t2, tm } from '../i18n';
import { fmtDur } from '../obd/catalog';
import { now } from '../obd/elm';
import { connect, recStart, session, startRec, stopRec } from '../core/engine';
import { useStore } from '../core/store';
import { useFrame } from '../core/values';
import { Btn } from './kit';
import { useTheme } from './theme';

export function TopBar({title}: { title: string }) {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const s = useStore(session);
  useFrame(1000, s.recording);
  const on = s.state === 'connected', busy = s.state === 'connecting';
  const dot = busy ? t.warn : on ? t.ok : t.mut;
  return (
    <View style={{backgroundColor: t.bg, paddingTop: ins.top, borderBottomWidth: 1, borderColor: t.line}}>
      <View style={st.row}>
        <View style={[st.dot, {backgroundColor: dot}]} />
        <Text numberOfLines={1} style={[st.title, {color: t.fg}]}>{title}</Text>
        <Btn title={s.recording ? '■ ' + fmtDur((now() - recStart()) / 1000) : '●'} kind={s.recording ? 'bad' : 'sec'}
          textStyle={!s.recording && {color: t.bad}} style={st.small}
          onPress={() => (s.recording ? stopRec() : on ? startRec() : undefined)} disabled={!on && !s.recording} />
        <Btn title="HUD" style={st.small} onPress={() => router.push('/hud')} />
        <Btn title={busy ? t2('conn.connecting') : on ? t2('conn.stop') : t2('conn.connect')} kind={on ? 'sec' : 'pri'} disabled={busy}
          style={st.small} onPress={() => connect('ble')} />
        <Pressable onPress={() => router.push('/settings')} hitSlop={8} style={{padding: 6}} accessibilityLabel={t2('settings')}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={t.fg} strokeWidth={2}>
            <Circle cx={12} cy={12} r={3} />
            <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </Svg>
        </Pressable>
      </View>
      <View style={st.status}>
        <Text numberOfLines={1} style={{color: t.mut, fontSize: 12, flex: 1}}>{tm(s.status)}</Text>
        {on && <Text style={{color: t.mut, fontSize: 12, fontVariant: ['tabular-nums']}}>{s.hz.toFixed(1)} {t2('perSec')}</Text>}
      </View>
    </View>
  );
}

const ICONS: Record<string, string> = {
  index: 'M4 17a8 8 0 1 1 16 0M12 17l4-5',
  race: 'M12 14V10M9 3h6M12 3v4M19 14a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  live: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  graph: 'M3 20h18M4 16l5-6 4 4 7-9',
  diag: 'M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 6.3-6.3a4 4 0 0 1-5-5L13 5zM3 21l6-6',
};
export function TabIcon({name, color}: { name: string; color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Path d={ICONS[name]} />
    </Svg>
  );
}

const st = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 8, paddingVertical: 8},
  dot: {width: 9, height: 9, borderRadius: 5},
  title: {flex: 1, fontSize: 17, fontWeight: '700'},
  small: {paddingVertical: 7, paddingHorizontal: 11},
  status: {flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingBottom: 6},
});
