// หน้าต่างเลื่อนขึ้น: เลือกค่า, ใส่ชื่อ, เลือกตัวเสียบ
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t as tr } from '../i18n';
import { CATEGORIES, catName, SRC, srcName } from '../obd/catalog';
import { isSupported, pickDevice, session } from '../core/engine';
import { useStore } from '../core/store';
import { Btn } from './kit';
import { useTheme } from './theme';

export function Sheet({visible, title, onClose, children}: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex: 1}}>
        <Pressable style={st.bk} onPress={onClose} />
        <View style={[st.pan, {backgroundColor: t.bg, borderColor: t.line, paddingBottom: ins.bottom + 16}]}>
          <View style={st.hd}>
            <Text style={{color: t.fg, fontSize: 17, fontWeight: '700', flex: 1}}>{title}</Text>
            <Btn title="✕" kind="ghost" onPress={onClose} />
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** เลือกค่าที่จะแสดง (จัดกลุ่มตามหมวด + ค้นหา) */
export function SourcePicker({visible, title, onPick, onClose}: { visible: boolean; title: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const ql = q.toLowerCase();
    return CATEGORIES.map(cat => ({
      title: catName(cat),
      data: Object.values(SRC).filter(s => s.cat === cat && (!ql || `${s.name} ${s.en} ${s.unit} ${s.id}`.toLowerCase().includes(ql))),
    })).filter(s => s.data.length);
  }, [q]);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <TextInput value={q} onChangeText={setQ} placeholder={tr('search')} placeholderTextColor={t.mut}
        style={[st.input, {color: t.fg, backgroundColor: t.card2, borderColor: t.line}]} />
      <SectionList sections={sections} keyExtractor={s => s.id} style={{maxHeight: 520}} keyboardShouldPersistTaps="handled"
        renderSectionHeader={({section}) => <Text style={[st.cat, {color: t.acc, backgroundColor: t.bg}]}>{section.title}</Text>}
        renderItem={({item: s}) => {
          const ok = isSupported(s.id);
          return (
            <Pressable onPress={() => { onPick(s.id); onClose(); }} style={[st.it, {borderColor: t.line, opacity: ok ? 1 : 0.45}]}>
              <View style={{flex: 1}}>
                <Text style={{color: t.fg, fontSize: 14}}>{srcName(s)}</Text>
                <Text style={{color: t.mut, fontSize: 11}}>
                  {[s.unit, s.mode1 ? 'PID ' + s.id : '', ok ? '' : tr('pick.unsupported'), s.note ? tr(s.note) : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={{color: t.acc, fontSize: 22, fontWeight: '700'}}>+</Text>
            </Pressable>
          );
        }} />
    </Sheet>
  );
}

export function TextPrompt({visible, title, initial, onDone}: { visible: boolean; title: string; initial: string; onDone: (v: string | null) => void }) {
  const t = useTheme();
  const [v, setV] = useState(initial);
  return (
    <Sheet visible={visible} title={title} onClose={() => onDone(null)}>
      <TextInput value={v} onChangeText={setV} autoFocus maxLength={20} onSubmitEditing={() => onDone(v.trim() || null)}
        style={[st.input, {color: t.fg, backgroundColor: t.card2, borderColor: t.line}]} />
      <Btn title={tr('ok')} kind="pri" onPress={() => onDone(v.trim() || null)} style={{marginTop: 12}} />
    </Sheet>
  );
}

/** แสดงรายชื่ออุปกรณ์ที่สแกนเจอ ให้ผู้ใช้เลือก */
export function DevicePicker() {
  const t = useTheme();
  const {picker} = useStore(session);
  return (
    <Sheet visible={!!picker} title={tr('picker.title')} onClose={() => pickDevice(null)}>
      {(picker ?? []).map(d => (
        <Pressable key={d.id} onPress={() => pickDevice(d)} style={[st.it, {borderColor: t.line}]}>
          <View style={{flex: 1}}>
            <Text style={{color: d.obd ? t.fg : t.mut, fontSize: 15, fontWeight: d.obd ? '700' : '400'}}>{d.name || tr('noName')}</Text>
            <Text style={{color: t.mut, fontSize: 11}}>{d.id} · {d.rssi} dBm</Text>
          </View>
          {d.obd && <Text style={{color: t.ok, fontSize: 12, fontWeight: '700'}}>{tr('picker.likely')}</Text>}
        </Pressable>
      ))}
    </Sheet>
  );
}

const st = StyleSheet.create({
  bk: {flex: 1, backgroundColor: 'rgba(0,0,0,.55)'},
  pan: {borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '88%'},
  hd: {flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 8},
  input: {borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 6},
  cat: {fontSize: 12, fontWeight: '700', paddingTop: 14, paddingBottom: 4, letterSpacing: 0.5},
  it: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1},
});
