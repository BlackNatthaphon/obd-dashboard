// ค่าทั้งหมดที่รถรองรับ + สรุปทริป
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { CATEGORIES, defaultType, fmtDur, fmtVal, isAlarm, SRC, type Category } from '../../obd/catalog';
import { lph, resetTrip, session, setPage, trip } from '../../core/engine';
import { curDash, updateDash } from '../../core/settings';
import { useStore } from '../../core/store';
import { useFrame, V, val } from '../../core/values';
import { Btn, Card, H2, Hint } from '../../ui/kit';
import { numFont, useTheme } from '../../ui/theme';

export default function Live() {
  const t = useTheme();
  const ses = useStore(session);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState('');
  const tick = useFrame(250);
  useFocusEffect(useCallback(() => { setPage('live'); }, []));

  const on = ses.state === 'connected';
  const sections = useMemo(() => {
    const ql = q.toLowerCase(), sup = ses.info?.supported;
    return (Object.keys(CATEGORIES) as Category[]).map(cat => ({
      title: CATEGORIES[cat],
      data: Object.values(SRC).filter(s => !s.calc && s.cat === cat && (!on || !s.mode1 || !!sup?.has(s.id)) &&
        (!ql || `${s.name} ${s.unit} ${s.id}`.toLowerCase().includes(ql))),
    })).filter(s => s.data.length);
  }, [q, on, ses.info]);
  const count = sections.reduce((n, s) => n + s.data.length, 0);

  const f = lph(), kml = val('KML');
  const tripItems = [
    ['ระยะทาง', trip.dist.toFixed(2) + ' km'], ['เวลาขับ', fmtDur(trip.time)],
    ['เฉลี่ย', (trip.time > 5 ? trip.dist / (trip.time / 3600) : 0).toFixed(0) + ' km/h'],
    ['สูงสุด', trip.max.toFixed(0) + ' km/h'], ['น้ำมันที่ใช้', trip.fuel.toFixed(2) + ' L'],
    ['เฉลี่ย', trip.fuel > 0.01 ? (trip.dist / trip.fuel).toFixed(1) + ' km/L' : '--'],
  ];

  const header = (
    <View>
      <H2 right={<Btn title="เริ่มทริปใหม่" kind="ghost" textStyle={{color: t.mut, fontSize: 13}} onPress={resetTrip} />}>ทริปนี้</H2>
      <Card style={{flexDirection: 'row', flexWrap: 'wrap', rowGap: 10}}>
        {tripItems.map(([a, b], i) => (
          <View key={i} style={{width: '33.3%'}}>
            <Text style={{color: t.mut, fontSize: 11.5}}>{a}</Text>
            <Text style={{color: t.fg, fontSize: 18, fontWeight: '700', fontFamily: numFont(t), fontVariant: ['tabular-nums']}}>{b}</Text>
          </View>
        ))}
        <View style={{width: '100%'}}>
          <Text style={{color: t.mut, fontSize: 11.5}}>ตอนนี้</Text>
          <Text style={{color: t.fg, fontSize: 15, fontWeight: '700'}}>{f != null ? f.toFixed(1) + ' L/h' : '--'} · {kml != null ? kml.toFixed(1) + ' km/L' : '--'}</Text>
        </View>
      </Card>
      <H2 right={<Hint>{on ? `รถรองรับ ${count} ค่า` : 'เชื่อมต่อเพื่อดูค่าที่รถรองรับ'}</Hint>}>ค่าทั้งหมด</H2>
      <TextInput value={q} onChangeText={setQ} placeholder="ค้นหา เช่น อุณหภูมิ, O2, rpm" placeholderTextColor={t.mut}
        style={[st.input, {color: t.fg, backgroundColor: t.card2, borderColor: t.line}]} />
      {!!toast && <Text style={{color: t.ok, marginVertical: 4}}>{toast}</Text>}
    </View>
  );

  return (
    <SectionList sections={sections} keyExtractor={s => s.id} ListHeaderComponent={header} stickySectionHeadersEnabled={false}
      extraData={tick} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 900, alignSelf: 'center', width: '100%'}}
      renderSectionHeader={({section}) => <Text style={[st.cat, {color: t.acc}]}>{section.title}</Text>}
      renderItem={({item: s}) => {
        const v = val(s.id, 15000), o = V[s.id], al = isAlarm(s, v);
        return (
          <View style={[st.it, {borderColor: t.line}]}>
            <View style={{flex: 1}}>
              <Text numberOfLines={1} style={{color: t.fg, fontSize: 14}}>{s.name}</Text>
              {o && <Text style={{color: t.mut, fontSize: 11, fontVariant: ['tabular-nums']}}>ต่ำสุด {fmtVal(s, o.min)} · สูงสุด {fmtVal(s, o.max)}</Text>}
            </View>
            <Text style={{color: al ? t.bad : t.fg, fontSize: 20, fontWeight: '700', fontFamily: numFont(t), fontVariant: ['tabular-nums']}}>
              {fmtVal(s, v)}<Text style={{color: t.mut, fontSize: 11, fontWeight: '400'}}> {s.unit}</Text>
            </Text>
            <Pressable hitSlop={8} accessibilityLabel="เพิ่มในแดช" onPress={() => {
              updateDash(d => ({...d, widgets: [...d.widgets, {id: s.id, type: defaultType(s), size: 1}]}));
              setToast(`เพิ่ม "${s.name}" ในแดช ${curDash().name} แล้ว`);
              setTimeout(() => setToast(''), 2000);
            }} style={{paddingHorizontal: 8}}>
              <Text style={{color: t.mut, fontSize: 20}}>☆</Text>
            </Pressable>
          </View>
        );
      }} />
  );
}

const st = StyleSheet.create({
  input: {borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15},
  cat: {fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 2, marginHorizontal: 4, letterSpacing: 0.5},
  it: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1},
});
