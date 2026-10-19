// ความเร็ว 4 ล้อจากกล่อง DSC (BMW) — ใช้หาเซนเซอร์ ABS ตัวที่เสีย
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { connect, session, startWheels, stopWheels, wheelCheck, wheels } from '../core/engine';
import { useStore } from '../core/store';
import { useFrame } from '../core/values';
import { MIN_SPEED, median4, WHEELS, type WheelState } from '../core/wheels';
import { t as tr, type Key } from '../i18n';
import { now } from '../obd/elm';
import { Btn, Card, H2, Hint } from '../ui/kit';
import { useTheme, type Theme } from '../ui/theme';

const COLORS = ['#4fc3f7', '#ffb74d', '#ba68c8', '#81c784'];
const RANGE = 10;   // แกนกราฟ ±%

export default function Wheels() {
  const t = useTheme();
  const ses = useStore(session);
  const wh = useStore(wheels);
  const [cw, setCw] = useState(0);
  useFrame(200);
  useEffect(() => { startWheels(); return stopWheels; }, []);

  const on = ses.state === 'connected';
  const w = on && wh.state === 'ok' && wheelCheck.last && now() - wheelCheck.lastT < 3000 ? wheelCheck.last : null;
  const m = w ? median4(w) : null;
  const status = !on ? tr('wh.st.idle') : tr(`wh.st.${wh.state === 'idle' ? 'setup' : wh.state}` as Key, {hz: wh.hz.toFixed(1)});
  const stCol = wh.state === 'ok' ? t.ok : wh.state === 'setup' || wh.state === 'idle' ? t.mut : t.warn;

  const tile = (i: number) => <WheelTile key={i} i={i} v={w ? w[i] : null} state={wheelCheck.state(i)} t={t} />;

  return (
    <ScrollView style={{backgroundColor: t.bg}} contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 620, alignSelf: 'center', width: '100%'}}>
      <Card style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <View style={[st.dot, {backgroundColor: stCol}]} />
        <Text style={{color: t.fg, fontSize: 14, flex: 1, lineHeight: 20}}>{status}</Text>
      </Card>
      {!on && (
        <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
          <Btn title={tr('dash.connectCar')} kind="pri" disabled={ses.state === 'connecting'} onPress={() => connect('ble')} />
          <Btn title={tr('dash.trySim')} disabled={ses.state === 'connecting'} onPress={() => connect('sim')} />
        </View>
      )}

      <View style={{marginTop: 12, gap: 10}}>
        <View style={st.row}>{tile(0)}{tile(1)}</View>
        <View style={[st.car, {borderColor: t.line, backgroundColor: t.card2}]}>
          <Text style={{color: t.mut, fontSize: 13}}>{tr('wh.avg')}</Text>
          <Text style={{color: t.fg, fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums']}}>
            {w ? ((w[0] + w[1] + w[2] + w[3]) / 4).toFixed(1) : '--'}<Text style={{fontSize: 14, color: t.mut}}> km/h</Text>
          </Text>
          {m != null && m < MIN_SPEED && <Hint style={{textAlign: 'center'}}>{tr('wh.slow', {v: MIN_SPEED})}</Hint>}
        </View>
        <View style={st.row}>{tile(2)}{tile(3)}</View>
      </View>

      <H2 right={<Btn title={tr('wh.reset')} kind="ghost" onPress={() => wheelCheck.reset()} />}>{tr('wh.chart')}</H2>
      <Card style={{padding: 0, overflow: 'hidden'}}>
        <View onLayout={e => setCw(e.nativeEvent.layout.width)}>
          {cw > 0 && <DevChart width={cw} height={170} t={t} />}
        </View>
      </Card>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6}}>
        {WHEELS.map((k, i) => (
          <Text key={k} style={{color: COLORS[i], fontSize: 12.5}}>● {tr(`wh.${k}` as Key)}</Text>
        ))}
      </View>

      {ses.info?.sim && <Hint style={{marginTop: 10}}>{tr('wh.demo')}</Hint>}
      <Hint style={{marginTop: 6}}>{tr('wh.paused')}</Hint>

      <H2>{tr('wh.how')}</H2>
      <Card style={{gap: 8}}>
        <Text style={[st.p, {color: t.fg}]}>{tr('wh.how1')}</Text>
        <Text style={[st.p, {color: t.fg}]}>{tr('wh.how2')}</Text>
        <Hint>{tr('wh.how3')}</Hint>
      </Card>
      <Hint style={{marginTop: 10, textAlign: 'center'}}>{tr('wh.credit')}</Hint>
    </ScrollView>
  );
}

function WheelTile({i, v, state, t}: { i: number; v: number | null; state: WheelState; t: Theme }) {
  const s = wheelCheck.s[i];
  const col = state === 'bad' ? t.bad : state === 'warn' ? t.warn : state === 'ok' ? t.ok : t.line;
  const notes: string[] = [];
  if (s.drops) notes.push(tr('wh.drops', {n: s.drops}));
  if (s.glitches) notes.push(tr('wh.glitch', {n: s.glitches}));
  if (s.n >= 20) notes.push(tr('wh.mean', {v: (s.mean >= 0 ? '+' : '') + s.mean.toFixed(1)}));
  const label = {wait: 'wh.wait', ok: 'wh.ok', warn: 'wh.warn', bad: 'wh.bad'}[state] as Key;
  return (
    <View style={[st.tile, {borderColor: col, backgroundColor: t.card}]}>
      <Text style={{color: COLORS[i], fontSize: 13, fontWeight: '700'}}>{tr(`wh.${WHEELS[i]}` as Key)}</Text>
      <Text style={{color: v != null && v < 0.5 && s.dropping ? t.bad : t.fg, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums']}}>
        {v == null ? '--' : v.toFixed(1)}
      </Text>
      <Text style={{color: state === 'wait' ? t.mut : col, fontSize: 13, fontWeight: '700'}}>{tr(label)}</Text>
      {notes.length > 0 && <Text style={{color: t.mut, fontSize: 12, marginTop: 2}}>{notes.join(' · ')}</Text>}
    </View>
  );
}

function DevChart({width, height, t}: { width: number; height: number; t: Theme }) {
  const t1 = now(), win = 60000, t0 = t1 - win;
  const y = (d: number) => height / 2 - (Math.max(-RANGE, Math.min(RANGE, d)) / RANGE) * (height / 2 - 6);
  const x = (tt: number) => ((tt - t0) / win) * width;
  const paths = WHEELS.map((_, i) => {
    let d = '', pen = false;
    for (const [tt, devs] of wheelCheck.hist) {
      if (tt < t0 || !devs) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + x(tt).toFixed(1) + ' ' + y(devs[i]).toFixed(1);
      pen = true;
    }
    return d;
  });
  return (
    <Svg width={width} height={height}>
      {[-RANGE, -5, 0, 5, RANGE].map(v => (
        <Line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={t.line} strokeDasharray={v ? '4 4' : undefined} />
      ))}
      {[RANGE, 5, -5, -RANGE].map(v => (
        <SvgText key={'l' + v} x={4} y={y(v) + (v > 0 ? 12 : -3)} fill={t.mut} fontSize={10}>{(v > 0 ? '+' : '') + v + '%'}</SvgText>
      ))}
      {paths.map((d, i) => d && <Path key={i} d={d} stroke={COLORS[i]} strokeWidth={2} fill="none" strokeLinejoin="round" />)}
    </Svg>
  );
}

const st = StyleSheet.create({
  dot: {width: 10, height: 10, borderRadius: 5},
  row: {flexDirection: 'row', gap: 10},
  tile: {flex: 1, borderWidth: 2, borderRadius: 14, padding: 12, minHeight: 118},
  car: {borderWidth: 1, borderRadius: 40, paddingVertical: 14, alignItems: 'center', marginHorizontal: '18%'},
  p: {fontSize: 14, lineHeight: 21},
});
