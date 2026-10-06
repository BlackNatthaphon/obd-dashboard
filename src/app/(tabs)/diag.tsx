// ตรวจเช็ค: ไฟเช็คเอนจิ้น, รหัสข้อผิดพลาด, ความพร้อมระบบตรวจสอบ, ข้อมูลรถ
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { dtcText, SRC } from '../../obd/catalog';
import { diag, diagClear, diagScan, elm, session, setPage } from '../../core/engine';
import { useStore } from '../../core/store';
import { Btn, Card, confirm, H2, Hint } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

export default function Diag() {
  const t = useTheme();
  const ses = useStore(session);
  const d = useStore(diag);
  const on = ses.state === 'connected';
  useFocusEffect(useCallback(() => {
    setPage('diag');
    if (session.get().state === 'connected' && !diag.get().scanned) diagScan();
  }, []));

  const n = d.dtc ? d.dtc.stored.length + d.dtc.perm.length : 0;
  const mil = d.status ? d.status.mil : n > 0;
  const milCol = !d.scanned ? t.mut : mil ? t.warn : t.ok;
  const title = d.busy ? 'กำลังสแกน...' : !d.scanned ? 'ยังไม่ได้ตรวจ' : !d.status && !d.dtc ? 'อ่านไม่ได้' : mil ? 'ไฟเช็คเอนจิ้นติดอยู่' : 'ไฟเช็คเอนจิ้นไม่ติด';
  const vinMake = d.vin ? d.vin.slice(0, 3) : 'OBD';

  const rows: [string, string, 'stored' | 'perm' | 'pending'][] = d.dtc ? [
    ...d.dtc.stored.map(c => [c, 'บันทึกแล้ว (ทำให้ไฟโชว์ติด)', 'stored'] as [string, string, 'stored']),
    ...d.dtc.perm.map(c => [c, 'ถาวร — หายเองเมื่อระบบตรวจผ่าน', 'perm'] as [string, string, 'perm']),
    ...d.dtc.pending.map(c => [c, 'รอยืนยัน — เกิดขึ้นแต่ยังไม่ถึงเกณฑ์ไฟโชว์', 'pending'] as [string, string, 'pending']),
  ] : [];

  const info: [string, string][] = on && ses.info ? [
    ['ตัวเสียบ', ses.info.name], ['ELM', ses.info.elm], ['โปรโตคอล', ses.info.proto + (ses.info.isCan ? ' (CAN)' : '')],
    ['โหมดเร็ว', ses.info.count ? 'เปิด' : 'ปิด'], ['ค่าที่รองรับ', [...elm.info.supported].filter(id => SRC[id]).length + ' ค่า'], ['VIN', d.vin || '-'],
  ] : [['สถานะ', 'ยังไม่เชื่อมต่อ']];

  return (
    <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 760, alignSelf: 'center', width: '100%'}}>
      <Card style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
        <Svg width={46} height={46} viewBox="0 0 48 48"><Path fill={milCol} d="M9 18h4v-4h6v-3h10v3h4l4 4h3v-3h3v16h-3v-3h-3v6h-6l-4 4H18l-4-4H9v-5H6v5H3V18h3v5h3z" /></Svg>
        <View style={{flex: 1}}>
          <Text style={{color: t.fg, fontSize: 16, fontWeight: '700'}}>{title}</Text>
          {d.dtc && <Hint>รหัสที่บันทึก {d.dtc.stored.length} · รอยืนยัน {d.dtc.pending.length} · ถาวร {d.dtc.perm.length}</Hint>}
          {!d.scanned && !d.busy && <Hint>กด “สแกน” เพื่ออ่านรหัสและสถานะ</Hint>}
        </View>
        {d.busy && <ActivityIndicator color={t.acc} />}
      </Card>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
        <Btn title="สแกน" kind="pri" disabled={!on || d.busy} onPress={diagScan} />
        <Btn title="ล้างรหัส / ดับไฟโชว์" kind="bad" disabled={!on || d.busy} onPress={async () => {
          if (await confirm('ล้างรหัสข้อผิดพลาด?', 'ควรดับเครื่องแต่เปิดสวิตช์ ON ไว้\nรหัสจะกลับมาถ้ายังไม่ได้แก้ปัญหา และความพร้อมระบบตรวจสอบจะถูกรีเซ็ต (ต้องขับสักพักก่อนไปตรวจสภาพ)', 'ล้างรหัส'))
            await diagClear();
        }} />
      </View>

      <H2>รหัสข้อผิดพลาด</H2>
      <Card style={{paddingVertical: 4}}>
        {!d.dtc ? <Hint style={{paddingVertical: 10}}>ยังไม่ได้อ่าน</Hint>
          : !rows.length ? <Text style={{color: t.ok, paddingVertical: 12}}>✓ ไม่พบรหัสข้อผิดพลาด</Text>
            : rows.map(([c, kind, k]) => {
              const col = k === 'pending' ? t.acc2 : t.warn;
              return (
                <View key={k + c} style={[st.dtc, {borderColor: t.line}]}>
                  <Text style={[st.code, {color: col, borderColor: col}]}>{c}</Text>
                  <View style={{flex: 1}}>
                    <Text style={{color: t.fg, fontSize: 14, lineHeight: 21}}>{dtcText(c)}</Text>
                    <Text style={{color: t.mut, fontSize: 12}}>{kind}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => Linking.openURL('https://www.google.com/search?q=' + encodeURIComponent(c + ' ' + vinMake))}>
                    <Text style={{fontSize: 18}}>🔍</Text>
                  </Pressable>
                </View>
              );
            })}
      </Card>

      <H2>ความพร้อมระบบตรวจสอบ (ก่อนตรวจสภาพ)</H2>
      <Card>
        {!d.status ? <Hint>ยังไม่ได้อ่าน</Hint> : (
          <>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', rowGap: 6}}>
              {d.status.mon.map(m => (
                <Text key={m.name} style={{width: '50%', color: t.fg, fontSize: 13.5}}>
                  <Text style={{color: m.ok ? t.ok : t.warn, fontWeight: '700'}}>{m.ok ? '✓ ' : '… '}</Text>{m.name}
                </Text>
              ))}
            </View>
            <Hint style={{marginTop: 6}}>✓ = ตรวจเสร็จแล้ว · … = ยังตรวจไม่เสร็จ (ขับต่ออีกสักพัก)</Hint>
          </>
        )}
      </Card>

      <H2>ข้อมูลรถ</H2>
      <Card>
        {info.map(([a, b]) => (
          <View key={a} style={{flexDirection: 'row', gap: 14, paddingVertical: 3}}>
            <Text style={{color: t.mut, fontSize: 14, width: 90}}>{a}</Text>
            <Text style={{color: t.fg, fontSize: 14, flex: 1, fontFamily: 'monospace'}}>{b}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  dtc: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1},
  code: {fontFamily: 'monospace', fontSize: 18, fontWeight: '700', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3},
});
