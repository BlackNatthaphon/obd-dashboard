// ไฟเตือนเปลี่ยนเกียร์ 10 ดวง: เขียว → เหลือง → แดง แล้วกะพริบฟ้าเมื่อถึงรอบเปลี่ยนเกียร์
import { StyleSheet, Text, View } from 'react-native';
import { t as tr } from '../i18n';
import { now } from '../obd/elm';
import { useTheme } from './theme';

const LEDS = 10;
const SPAN = 2500;   // ไฟเริ่มติดก่อนถึงรอบเปลี่ยนเกียร์ 2500 rpm

export function shiftState(rpm: number | null, shiftRpm: number) {
  const r = rpm ?? 0;
  const lit = Math.max(0, Math.min(LEDS, Math.ceil(((r - (shiftRpm - SPAN)) / SPAN) * LEDS)));
  return {lit, shift: r >= shiftRpm};
}

export function ShiftLights({rpm, shiftRpm, height = 14, label = false}: {
  rpm: number | null; shiftRpm: number; height?: number; label?: boolean;
}) {
  const t = useTheme();
  const {lit, shift} = shiftState(rpm, shiftRpm);
  const blink = shift && Math.floor(now() / 150) % 2 === 0;
  return (
    <View style={{alignSelf: 'stretch'}}>
      <View style={st.row}>
        {Array.from({length: LEDS}, (_, i) => {
          const c = blink ? '#4da3ff' : i < lit ? (i < 4 ? t.ok : i < 7 ? t.warn : t.bad) : t.card2;
          return <View key={i} style={[st.led, {height, borderRadius: height / 2, backgroundColor: c, borderColor: t.line}]} />;
        })}
      </View>
      {label && (
        <Text style={[st.lbl, {color: shift ? '#4da3ff' : t.mut, fontWeight: shift ? '800' : '500'}]}>
          {shift ? tr('shift.now') : tr('shift.at', {rpm: shiftRpm})}
        </Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  row: {flexDirection: 'row', gap: 4, justifyContent: 'center'},
  led: {flex: 1, maxWidth: 34, borderWidth: 1},
  lbl: {fontSize: 11, textAlign: 'center', marginTop: 4},
});
