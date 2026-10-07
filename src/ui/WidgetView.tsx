// วิดเจ็ตหนึ่งช่องบนแดชบอร์ด: ตัวเลข / แถบ / เกจ / กราฟ
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t as tr } from '../i18n';
import { fmtVal, isAlarm, SRC, srcName, type Widget } from '../obd/catalog';
import { gear, isSupported, session } from '../core/engine';
import { GEAR_EV, GEAR_LEARNING, gearLabel } from '../core/gear';
import { settings } from '../core/settings';
import { V, val } from '../core/values';
import { Spark } from './Chart';
import { Gauge } from './Gauge';
import { ShiftLights, shiftState } from './ShiftLights';
import { numFont, useTheme } from './theme';

export type WidgetAction = 'left' | 'right' | 'type' | 'size' | 'del';

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
  const cfg = settings.get();
  const isRpm = src.id === '0C' && w.type !== 'graph' && !na;
  const shifting = isRpm && shiftState(v, cfg.shiftRpm).shift;
  const border = shifting ? '#4da3ff' : alarm ? t.bad : t.line;

  return (
    <View style={[st.wd, {width, backgroundColor: t.card, borderColor: border}, (alarm || shifting) && {borderWidth: 2}]}>
      <Text numberOfLines={1} style={[st.lbl, {color: t.mut}]}>{srcName(src)}{na ? ' · ' + tr('unsupported') : ''}</Text>
      {(src.id === 'GEAR' || src.id === 'A4') && w.type !== 'graph' ? (
        <GearView v={v} big={w.size === 2} />
      ) : w.type === 'gauge' ? (
        <View style={{alignItems: 'center', marginBottom: -8}}>
          <Gauge src={src} v={v} width={Math.min(inner, w.size === 2 ? 240 : 200)} labels={w.size === 2}
            red={src.id === '0C' ? cfg.redline : src.hi} mark={src.id === '0C' ? cfg.shiftRpm : null} alarm={alarm} />
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
      {isRpm && <View style={{marginTop: w.type === 'gauge' ? 10 : 8}}><ShiftLights rpm={v} shiftRpm={cfg.shiftRpm} height={w.size === 2 ? 12 : 9} label /></View>}
      {editing && (
        <View style={st.tools}>
          {([['left', '◀'], ['right', '▶'], ['type', tr(`w.${w.type}`)], ['size', w.size === 2 ? '½' : '⤢'], ['del', '✕']] as [WidgetAction, string][])
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

/** เกียร์ตัวใหญ่ + แถบ N 1 2 3 … ไฮไลต์เกียร์ปัจจุบัน */
function GearView({v, big}: { v: number | null; big: boolean }) {
  const t = useTheme();
  const n = Math.max(gear.gears.length, v != null && v > 0 ? v : 0, 6);
  const cells = ['N', ...Array.from({length: n}, (_, i) => String(i + 1))];
  const cur = gearLabel(v);
  const col = v === GEAR_EV ? t.ok : t.fg;
  const hint = v === GEAR_LEARNING ? tr('gear.learning') : v === GEAR_EV ? tr('gear.ev')
    : gear.gears.length >= 2 ? tr('gear.learned', {n: gear.gears.length}) : '';
  return (
    <View style={{alignItems: 'center'}}>
      <Text style={{color: col, fontSize: big ? 84 : 56, fontWeight: '800', lineHeight: big ? 92 : 62, fontVariant: ['tabular-nums']}}>{cur}</Text>
      <View style={st.strip}>
        {cells.map(c => {
          const on = c === cur;
          return (
            <View key={c} style={[st.cell, {borderColor: on ? t.acc : t.line, backgroundColor: on ? t.acc : 'transparent'}]}>
              <Text style={{color: on ? '#fff' : t.mut, fontSize: big ? 15 : 12, fontWeight: on ? '800' : '600'}}>{c}</Text>
            </View>
          );
        })}
      </View>
      {!!hint && <Text style={{color: t.mut, fontSize: 11, marginTop: 4}}>{hint}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  strip: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 4},
  cell: {minWidth: 22, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center'},
  wd: {borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 13, minHeight: 96, overflow: 'hidden'},
  lbl: {fontSize: 12.5, paddingRight: 34},
  val: {fontSize: 34, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums']},
  unit: {fontSize: 13, fontWeight: '400'},
  mm: {position: 'absolute', top: 11, right: 12, fontSize: 10.5, textAlign: 'right', lineHeight: 14, fontVariant: ['tabular-nums']},
  bar: {height: 8, borderRadius: 4, marginTop: 10, overflow: 'hidden'},
  tools: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8},
  tool: {flexGrow: 1, alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4, minWidth: 28},
});
