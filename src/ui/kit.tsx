// ปุ่ม การ์ด ชิป และของใช้ร่วมกันทุกหน้า
import type { ReactNode } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { t as tr } from '../i18n';
import { useTheme } from './theme';

type Kind = 'pri' | 'bad' | 'sec' | 'ghost';

export function Btn({title, onPress, kind = 'sec', disabled, style, textStyle, big}: {
  title: string; onPress?: () => void; kind?: Kind; disabled?: boolean; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>; big?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'pri' ? t.acc : kind === 'bad' ? t.bad : kind === 'ghost' ? 'transparent' : t.card2;
  const bd = kind === 'pri' ? t.acc : kind === 'bad' ? t.bad : kind === 'ghost' ? 'transparent' : t.line;
  const fg = kind === 'pri' || kind === 'bad' ? '#fff' : t.fg;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({pressed}) => [s.btn, big && s.big, {backgroundColor: bg, borderColor: bd, opacity: disabled ? 0.4 : pressed ? 0.75 : 1}, style]}>
      <Text style={[s.btnT, big && {fontSize: 18}, {color: fg}, textStyle]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({title, on, onPress}: { title: string; on?: boolean; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[s.chip, {backgroundColor: on ? t.acc : t.card2, borderColor: on ? t.acc : t.line}]}>
      <Text style={{color: on ? '#fff' : t.fg, fontWeight: '600', fontSize: 13}}>{title}</Text>
    </Pressable>
  );
}

export function Chips({children}: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6, paddingVertical: 8}}>{children}</ScrollView>;
}

export function Card({children, style}: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[s.card, {backgroundColor: t.card, borderColor: t.line}, style]}>{children}</View>;
}

export function H2({children, right}: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={s.h2}>
      <Text style={{color: t.fg, fontSize: 15, fontWeight: '700', flex: 1}}>{children}</Text>
      {right}
    </View>
  );
}

export function Hint({children, style}: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{color: t.mut, fontSize: 13, lineHeight: 20}, style]}>{children}</Text>;
}

export function Toggle({label, value, onChange}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={s.tog}>
      <Text style={{color: t.fg, fontSize: 14, flex: 1}}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{true: t.acc, false: t.line}} thumbColor="#fff" />
    </View>
  );
}

export function Stepper({label, value, step, min, max, onChange, unit}: {
  label: string; value: number; step: number; min: number; max: number; unit?: string; onChange: (v: number) => void;
}) {
  const t = useTheme();
  return (
    <View style={s.tog}>
      <Text style={{color: t.fg, fontSize: 14, flex: 1}}>{label}</Text>
      <Btn title="−" onPress={() => onChange(Math.max(min, value - step))} style={s.step} />
      <Text style={{color: t.fg, fontSize: 16, fontWeight: '700', minWidth: 82, textAlign: 'center', fontVariant: ['tabular-nums']}}>
        {value}{unit ? ' ' + unit : ''}
      </Text>
      <Btn title="+" onPress={() => onChange(Math.min(max, value + step))} style={s.step} />
    </View>
  );
}

/** ถามยืนยันก่อนทำสิ่งที่ย้อนไม่ได้ */
export function confirm(title: string, msg: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(title + '\n\n' + msg));
  return new Promise(res => Alert.alert(title, msg, [
    {text: tr('cancel'), style: 'cancel', onPress: () => res(false)},
    {text: ok, style: 'destructive', onPress: () => res(true)},
  ], {cancelable: true, onDismiss: () => res(false)}));
}

const s = StyleSheet.create({
  btn: {borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  big: {paddingVertical: 15, borderRadius: 14},
  btnT: {fontWeight: '600', fontSize: 14},
  chip: {borderWidth: 1, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 13},
  card: {borderWidth: 1, borderRadius: 14, padding: 14},
  h2: {flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10, marginHorizontal: 2, gap: 8},
  tog: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6},
  step: {paddingVertical: 6, paddingHorizontal: 14},
});
