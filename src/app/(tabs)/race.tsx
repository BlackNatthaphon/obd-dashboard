// จับเวลาแบบรถแข่ง + ไฟเปลี่ยนเกียร์ + นาฬิกาจับรอบ
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RACE_MODES } from '../../obd/catalog';
import { now } from '../../obd/elm';
import { bestRun, race, session, setPage } from '../../core/engine';
import { lap, lapGo, lapLap, lapReset, lapTime } from '../../core/lap';
import { setSettings, useSettings } from '../../core/settings';
import { useStore } from '../../core/store';
import { useFrame, val } from '../../core/values';
import { Btn, Card, Chip, Chips, confirm, H2, Hint } from '../../ui/kit';
import { numFont, useTheme } from '../../ui/theme';

const LEDS = 10;

export default function RaceScreen() {
  const t = useTheme();
  const cfg = useSettings();
  const ses = useStore(session);
  const lp = useStore(lap);
  useFrame(50);
  useFocusEffect(useCallback(() => { setPage('race'); }, []));

  if (race.modeId !== cfg.raceMode) race.setMode(cfg.raceMode);
  const m = race.mode;
  const v = val('0D', 2000), rpm = val('0C', 2000);
  const st = race.state;
  const start = cfg.shiftRpm - 2500;
  const lit = Math.max(0, Math.min(LEDS, Math.ceil((((rpm ?? 0) - start) / 2500) * LEDS)));
  const flash = (rpm ?? 0) >= cfg.shiftRpm && Math.floor(now() / 150) % 2 === 0;
  const timerCol = st === 'done' ? t.ok : st === 'running' ? t.fg : t.acc;
  let msg = race.msg || (st === 'idle' ? 'เลือกโหมดแล้วกด “พร้อม”' : '');
  if (st === 'done' && race.res?.trap) msg += ` · ความเร็วปลาย ${race.res.trap.toFixed(0)} km/h`;
  const runs = cfg.runs.filter(r => r.mode === m.id);
  const best = bestRun(m.id);
  const lapBest = lp.laps.length ? Math.min(...lp.laps) : 0;
  const tn = now();

  const arm = () => {
    if (st === 'idle' || st === 'done') {
      if (ses.state !== 'connected') return;
      race.arm();
    } else race.cancel();
  };

  return (
    <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 760, alignSelf: 'center', width: '100%'}}>
      <Chips>
        {RACE_MODES.map(x => <Chip key={x.id} title={x.name} on={cfg.raceMode === x.id}
          onPress={() => { if (st !== 'running') setSettings({raceMode: x.id}); }} />)}
      </Chips>

      <Card style={{alignItems: 'center', paddingVertical: 16}}>
        <View style={s.leds}>
          {Array.from({length: LEDS}, (_, i) => {
            const c = flash ? '#4da3ff' : i < lit ? (i < 4 ? t.ok : i < 7 ? t.warn : t.bad) : t.card2;
            return <View key={i} style={[s.led, {backgroundColor: c, borderColor: t.line}]} />;
          })}
        </View>
        <Text style={[s.spd, {color: t.fg, fontFamily: numFont(t)}]}>
          {v == null ? '--' : v.toFixed(0)}<Text style={{fontSize: 18, color: t.mut, fontWeight: '500'}}> km/h</Text>
        </Text>
        <View style={[s.rpmbar, {backgroundColor: t.card2}]}>
          <View style={{height: '100%', width: `${Math.min(100, ((rpm ?? 0) / cfg.redline) * 100)}%`,
            backgroundColor: (rpm ?? 0) >= cfg.shiftRpm ? t.bad : (rpm ?? 0) >= start + 1000 ? t.warn : t.ok}} />
        </View>
        <Text style={[s.tmr, {color: timerCol, fontFamily: numFont(t)}]}>{race.elapsed(tn).toFixed(2)}</Text>
        <Text style={{color: st === 'armed' || st === 'ready' ? t.warn : t.fg, fontSize: 15, fontWeight: '600', marginTop: 6, textAlign: 'center'}}>
          {ses.state !== 'connected' && st === 'idle' ? 'เชื่อมต่อรถก่อน (หรือใช้โหมดจำลอง)' : msg}
        </Text>
        <View style={s.sub}>
          {[['ระยะทาง', (st === 'done' && race.res ? race.res.dist : race.dist).toFixed(0) + ' ม.'],
            ['แรง G สูงสุด', Math.abs(race.g).toFixed(2)], ['รอบ', rpm == null ? '--' : rpm.toFixed(0)]].map(([a, b]) => (
            <View key={a} style={{alignItems: 'center'}}>
              <Text style={{color: t.mut, fontSize: 13}}>{a}</Text>
              <Text style={{color: t.fg, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums']}}>{b}</Text>
            </View>
          ))}
        </View>
        <Btn big title={st === 'idle' ? 'พร้อม' : st === 'done' ? 'อีกครั้ง' : 'ยกเลิก'}
          kind={st === 'idle' || st === 'done' ? 'pri' : 'bad'} disabled={ses.state !== 'connected' && (st === 'idle' || st === 'done')}
          onPress={arm} style={{alignSelf: 'stretch', marginTop: 12}} />
      </Card>

      <H2 right={<Btn title="ล้างประวัติ" kind="ghost" textStyle={{color: t.mut, fontSize: 13}} onPress={async () => {
        if (await confirm('ล้างผลจับเวลา?', 'ผลจับเวลาทั้งหมดจะถูกลบ', 'ล้าง')) setSettings({runs: []});
      }} />}>ผลจับเวลา</H2>
      <Card style={{paddingVertical: 4}}>
        {runs.length ? runs.slice(0, 30).map(r => {
          const d = new Date(r.at), isBest = best && r.at === best.at;
          const extra = [r.trap ? `ปลาย ${r.trap.toFixed(0)} km/h` : '', m.type === 'brake' || m.type === 'dist' ? `${r.dist.toFixed(1)} ม.` : '',
            r.g ? `${Math.abs(r.g).toFixed(2)} g` : '', r.sim ? 'จำลอง' : ''].filter(Boolean).join(' · ');
          return (
            <View key={r.at} style={[s.run, {borderColor: t.line}]}>
              <Text style={[s.runT, {color: isBest ? t.warn : t.fg}]}>{r.time.toFixed(2)}s</Text>
              <Text style={{color: t.mut, fontSize: 12.5, flex: 1}}>
                {d.toLocaleDateString('th-TH', {day: 'numeric', month: 'short'})} {d.toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'})}{extra ? ' · ' + extra : ''}
              </Text>
              {isBest && <Text>🏆</Text>}
            </View>
          );
        }) : <Hint style={{paddingVertical: 12}}>ยังไม่มีผลของโหมด {m.name}</Hint>}
      </Card>

      <H2>จับเวลารอบสนาม (Lap)</H2>
      <Card style={{alignItems: 'center'}}>
        <Text style={[s.tmr, {color: t.acc, fontSize: 52, fontFamily: numFont(t)}]}>
          {lapTime(lp.on ? tn - lp.lapT0 : lp.pausedLap)}
        </Text>
        <View style={s.sub}>
          {[['รวม', lapTime(lp.on ? tn - lp.t0 : lp.acc)], ['ดีที่สุด', lapBest ? lapTime(lapBest) : '--'],
            ['รอบที่', String(lp.laps.length + (lp.on || lp.acc ? 1 : 0))]].map(([a, b]) => (
            <View key={a} style={{alignItems: 'center'}}>
              <Text style={{color: t.mut, fontSize: 13}}>{a}</Text>
              <Text style={{color: t.fg, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums']}}>{b}</Text>
            </View>
          ))}
        </View>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch'}}>
          <Btn big title={lp.on ? 'หยุด' : lp.acc ? 'ต่อ' : 'เริ่ม'} kind={lp.on ? 'bad' : 'pri'} onPress={lapGo} style={{flex: 1}} />
          <Btn big title="รอบ" disabled={!lp.on} onPress={lapLap} style={{flex: 1}} />
          <Btn big title="รีเซ็ต" onPress={lapReset} style={{flex: 0.7}} />
        </View>
        <View style={{alignSelf: 'stretch'}}>
          {lp.laps.map((l, i) => ({l, i})).reverse().map(({l, i}) => (
            <View key={i} style={[s.run, {borderColor: t.line}]}>
              <Text style={[s.runT, {color: l === lapBest ? t.warn : t.fg}]}>{lapTime(l)}</Text>
              <Text style={{color: t.mut, fontSize: 12.5}}>รอบ {i + 1}{l === lapBest ? ' · ดีที่สุด' : ` · +${((l - lapBest) / 1000).toFixed(2)} วิ`}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Hint style={{marginTop: 12}}>
        ความแม่นยำขึ้นกับความเร็วในการอ่านของตัวเสียบ (ดูตัวเลข “ค่า/วิ” มุมขวาบน) ยิ่งสูงยิ่งแม่น แอพจะประมาณจุดเริ่ม/จบระหว่างจังหวะอ่านให้อัตโนมัติ · ใช้ในสนามหรือพื้นที่ปิดเท่านั้น
      </Hint>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  leds: {flexDirection: 'row', gap: 5, marginBottom: 8, alignSelf: 'stretch', justifyContent: 'center'},
  led: {flex: 1, maxWidth: 34, height: 14, borderRadius: 7, borderWidth: 1},
  spd: {fontSize: 96, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 104},
  rpmbar: {height: 10, borderRadius: 5, overflow: 'hidden', alignSelf: 'stretch', marginTop: 8},
  tmr: {fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 8},
  sub: {flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 10},
  run: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1},
  runT: {fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 80},
});
