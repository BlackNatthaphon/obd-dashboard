// วิดเจ็ตหนึ่งช่องบนแดชบอร์ด: ตัวเลข / แถบ / เกจ / กราฟ
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtVal, isAlarm, SRC, type Widget } from '../obd/catalog';
import { isSupported, session } from '../core/engine';
import { settings } from '../core/settings';
import { V, val } from '../core/values';
import { Spark } from './Chart';
import { Gauge } from './Gauge';
import { numFont, useTheme } from './theme';

export type WidgetAction = 'left' | 'right' | 'type' | 'size' | 'del';
const TYPE_ICON = {num: 'เลข', bar: 'แถบ', gauge: 'เกจ', graph: 'กราฟ'};

export function WidgetView({w, width, editing, onAction}: {
  w: Widget; width: number; editing: boolean; onAction: (a: WidgetAction) => void;
}) {
  const t = useTheme();
  const src = SRC[w.id];
  if (!src) return null;
  const na = session.get().state === 'connected' && !isSupported(src.id);
  const v = na ? null : val(src.id, src.calc && src.cat === 'trip' ? 1e9 : 5000);
  const alarm = isAlarm(src, v);
  const o = V[src.id];
  const pct = v == null ? 0 : Math.max(0, Math.min(100, ((v - src.min) / (src.max - src.min)) * 100));
  const valColor = na ? t.line : alarm ? t.bad : t.fg;
  const big = w.size === 2 && w.type === 'num';
  const inner = width - 26;

  return (
    <View style={[st.wd, {width, backgroundColor: t.card, borderColor: alarm ? t.bad : t.line}, alarm && {borderWidth: 2}]}>
      <Text numberOfLines={1} style={[st.lbl, {color: t.mut}]}>{src.name}{na ? ' · ไม่รองรับ' : ''}</Text>
      {w.type === 'gauge' ? (
        <View style={{alignItems: 'center', marginBottom: -8}}>
          <Gauge src={src} v={v} width={Math.min(inner, w.size === 2 ? 240 : 200)} labels={w.size === 2}
            red={src.id === '0C' ? settings.get().redline : src.hi} alarm={alarm} />
        </View>
      ) : (
        <>
          {o && !src.fmt && src.cat !== 'trip' && w.type !== 'graph' && (
            <Text style={[st.mm, {color: t.mut}]}>{'▲' + fmtVal(src, o.max) + '\n▼' + fmtVal(src, o.min)}</Text>
          )}
          <Text style={[st.val, {color: valColor, fontFamily: numFont(t)}, big && {fontSize: 64}, w.type === 'graph' && {fontSize: 22}]}>
            {fmtVal(src, v)}<Text style={[st.unit, {color: t.mut}]}> {src.unit}</Text>
          </Text>
          {w.type === 'bar' && (
            <View style={[st.bar, {backgroundColor: t.card2}]}>
              <View style={{width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: alarm ? t.bad : t.acc}} />
            </View>
          )}
          {w.type === 'graph' && <View style={{marginTop: 6}}><Spark id={src.id} width={inner} /></View>}
        </>
      )}
      {editing && (
        <View style={st.tools}>
          {([['left', '◀'], ['right', '▶'], ['type', TYPE_ICON[w.type]], ['size', w.size === 2 ? '½' : '⤢'], ['del', '✕']] as [WidgetAction, string][])
            .map(([a, label]) => (
              <Pressable key={a} onPress={() => onAction(a)} hitSlop={4}
                style={[st.tool, {backgroundColor: t.card2, borderColor: t.line}]}>
                <Text style={{color: a === 'del' ? t.bad : t.fg, fontSize: 13, fontWeight: '600'}}>{label}</Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wd: {borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 13, minHeight: 96, overflow: 'hidden'},
  lbl: {fontSize: 12.5, paddingRight: 34},
  val: {fontSize: 34, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums']},
  unit: {fontSize: 13, fontWeight: '400'},
  mm: {position: 'absolute', top: 11, right: 12, fontSize: 10.5, textAlign: 'right', lineHeight: 14, fontVariant: ['tabular-nums']},
  bar: {height: 8, borderRadius: 4, marginTop: 10, overflow: 'hidden'},
  tools: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8},
  tool: {flexGrow: 1, alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4, minWidth: 28},
});
