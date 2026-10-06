// ตั้งค่า
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { connect, disconnect, forgetDevice, session } from '../core/engine';
import { DEFAULTS, setSettings, useSettings, type Orientation, type ThemeName } from '../core/settings';
import { Btn, Chip, confirm, Hint, Stepper, Toggle } from '../ui/kit';
import { THEMES, useTheme } from '../ui/theme';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function Section({title, children}: { title?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[st.set, {borderColor: t.line}]}>
      {title && <Text style={{color: t.fg, fontSize: 14, fontWeight: '700', marginBottom: 8}}>{title}</Text>}
      {children}
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const cfg = useSettings();
  return (
    <ScrollView style={{backgroundColor: t.bg}} contentContainerStyle={{padding: 16, paddingBottom: 40, maxWidth: 760, alignSelf: 'center', width: '100%'}}>
      <Section title="ธีม">
        <View style={{flexDirection: 'row', gap: 8}}>
          {(Object.keys(THEMES) as ThemeName[]).map(k => (
            <Pressable key={k} onPress={() => setSettings({theme: k})}
              style={[st.sw, {backgroundColor: THEMES[k].card, borderColor: cfg.theme === k ? t.acc : THEMES[k].line}]}>
              <View style={{width: 18, height: 18, borderRadius: 9, backgroundColor: THEMES[k].acc, marginBottom: 6}} />
              <Text style={{color: THEMES[k].fg, fontSize: 12, fontWeight: '600'}}>{THEMES[k].name}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="จับเวลา / รอบเครื่อง">
        <Stepper label="ไฟเตือนเปลี่ยนเกียร์" value={cfg.shiftRpm} step={100} min={2500} max={9000} unit="rpm" onChange={v => setSettings({shiftRpm: v})} />
        <Stepper label="เรดไลน์ (เกจรอบ)" value={cfg.redline} step={100} min={3000} max={9500} unit="rpm" onChange={v => setSettings({redline: v})} />
      </Section>
      <Section title="น้ำมัน (ใช้คำนวณอัตราสิ้นเปลือง)">
        <View style={{flexDirection: 'row', gap: 8}}>
          <Chip title="เบนซิน/แก๊สโซฮอล์" on={cfg.fuel === 'gas'} onPress={() => setSettings({fuel: 'gas'})} />
          <Chip title="ดีเซล" on={cfg.fuel === 'diesel'} onPress={() => setSettings({fuel: 'diesel'})} />
        </View>
        <Hint style={{marginTop: 6}}>ถ้ารถไม่ส่งอัตรากินน้ำมันมาเอง แอพจะประมาณจาก MAF (ดีเซลคลาดเคลื่อนได้มาก)</Hint>
      </Section>
      <Section>
        <Toggle label="เสียงบี๊บ (จับเวลา / ไฟเปลี่ยนเกียร์)" value={cfg.sound} onChange={v => setSettings({sound: v})} />
        <Toggle label="สั่น" value={cfg.vibrate} onChange={v => setSettings({vibrate: v})} />
        <Toggle label="HUD กลับด้าน (สะท้อนกระจกหน้า)" value={cfg.hudMirror} onChange={v => setSettings({hudMirror: v})} />
      </Section>
      {Platform.OS !== 'web' && (
        <Section title="การหมุนจอ">
          <View style={{flexDirection: 'row', gap: 8}}>
            {([['auto', 'อัตโนมัติ'], ['landscape', 'แนวนอน'], ['portrait', 'แนวตั้ง']] as [Orientation, string][])
              .map(([k, n]) => <Chip key={k} title={n} on={cfg.orient === k} onPress={() => setSettings({orient: k})} />)}
          </View>
        </Section>
      )}
      <Section title="การเชื่อมต่อ">
        {cfg.device && <Hint style={{marginBottom: 8}}>ตัวเสียบที่จำไว้: {cfg.device.name}</Hint>}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          {cfg.device && <Btn title="เปลี่ยนตัวเสียบ" onPress={() => { forgetDevice(); router.back(); }} />}
          <Btn title="โหมดจำลอง" onPress={() => { if (session.get().state === 'connected') disconnect(); router.back(); setTimeout(() => connect('sim'), 50); }} />
          <Btn title="ดู Log" onPress={() => router.push('/log')} />
        </View>
      </Section>
      <Section title="ข้อมูล">
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Btn title="รีเซ็ตแดชบอร์ดทั้งหมด" onPress={async () => {
            if (await confirm('รีเซ็ตแดชบอร์ด?', 'แดชบอร์ดทุกหน้าจะกลับเป็นค่าเริ่มต้น', 'รีเซ็ต')) setSettings({dash: clone(DEFAULTS.dash), dashIdx: 0});
          }} />
          <Btn title="ล้างผลจับเวลา" onPress={async () => {
            if (await confirm('ล้างผลจับเวลา?', 'ผลจับเวลาทั้งหมดจะถูกลบ', 'ล้าง')) setSettings({runs: []});
          }} />
        </View>
      </Section>
      <Hint style={{marginTop: 12}}>OBD Dashboard {Constants.expoConfig?.version ?? ''} · React Native</Hint>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  set: {paddingVertical: 14, borderBottomWidth: 1},
  sw: {flex: 1, borderWidth: 2, borderRadius: 12, paddingVertical: 10, alignItems: 'center'},
});
