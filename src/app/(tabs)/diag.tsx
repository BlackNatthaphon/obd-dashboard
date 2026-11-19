// ตรวจเช็ค: ไฟเช็คเอนจิ้น, รหัสข้อผิดพลาด, ความพร้อมระบบตรวจสอบ, ข้อมูลรถ
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { t as tr, type Key } from '../../i18n';
import { bmwDtcText, dtcText, SRC } from '../../obd/catalog';
import { ecuHex } from '../../obd/bmw';
import { bmwDiag, bmwDtcClear, bmwDtcScan, diag, diagClear, diagScan, elm, session, setPage, type EcuDtc } from '../../core/engine';
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
  const title = tr(d.busy ? 'diag.scanning' : !d.scanned ? 'diag.notScanned' : !d.status && !d.dtc ? 'diag.unreadable' : mil ? 'diag.milOn' : 'diag.milOff');
  const vinMake = d.vin ? d.vin.slice(0, 3) : 'OBD';

  type Kind = 'stored' | 'perm' | 'pending';
  const rows: [string, Kind][] = d.dtc ? (['stored', 'perm', 'pending'] as Kind[]).flatMap(k => d.dtc![k].map(c => [c, k] as [string, Kind])) : [];

  const info: [string, string][] = on && ses.info ? [
    [tr('diag.adapter'), ses.info.name], ['ELM', ses.info.elm], [tr('diag.protocol'), ses.info.proto + (ses.info.isCan ? ' (CAN)' : '')],
    [tr('diag.fastMode'), tr(ses.info.count ? 'diag.on' : 'diag.off')],
    [tr('diag.supported'), tr('diag.nValues', {n: [...elm.info.supported].filter(id => SRC[id]).length})], ['VIN', d.vin || '-'],
  ] : [[tr('diag.status'), tr('st.idle')]];

  return (
    <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 30, maxWidth: 760, alignSelf: 'center', width: '100%'}}>
      <Card style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
        <Svg width={46} height={46} viewBox="0 0 48 48"><Path fill={milCol} d="M9 18h4v-4h6v-3h10v3h4l4 4h3v-3h3v16h-3v-3h-3v6h-6l-4 4H18l-4-4H9v-5H6v5H3V18h3v5h3z" /></Svg>
        <View style={{flex: 1}}>
          <Text style={{color: t.fg, fontSize: 16, fontWeight: '700'}}>{title}</Text>
          {d.dtc && <Hint>{tr('diag.counts', {s: d.dtc.stored.length, p: d.dtc.pending.length, m: d.dtc.perm.length})}</Hint>}
          {!d.scanned && !d.busy && <Hint>{tr('diag.pressScan')}</Hint>}
        </View>
        {d.busy && <ActivityIndicator color={t.acc} />}
      </Card>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
        <Btn title={tr('diag.scan')} kind="pri" disabled={!on || d.busy} onPress={diagScan} />
        <Btn title={tr('diag.clear')} kind="bad" disabled={!on || d.busy} onPress={async () => {
          if (await confirm(tr('diag.clearQ'), tr('diag.clearMsg'), tr('diag.clearOk')))
            await diagClear();
        }} />
      </View>

      <Pressable onPress={() => router.push('/wheels')}>
        <Card style={{marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10}}>
          <View style={{flex: 1}}>
            <Text style={{color: t.fg, fontSize: 15, fontWeight: '700'}}>{tr('wh.open')}</Text>
            <Hint>{tr('wh.openHint')}</Hint>
          </View>
          <Text style={{color: t.mut, fontSize: 22}}>›</Text>
        </Card>
      </Pressable>

      <BmwCodes on={on} />

      <H2>{tr('diag.codes')}</H2>
      <Card style={{paddingVertical: 4}}>
        {!d.dtc ? <Hint style={{paddingVertical: 10}}>{tr('diag.notRead')}</Hint>
          : !rows.length ? <Text style={{color: t.ok, paddingVertical: 12}}>{tr('diag.noCodes')}</Text>
            : rows.map(([c, k]) => {
              const col = k === 'pending' ? t.acc2 : t.warn;
              return (
                <View key={k + c} style={[st.dtc, {borderColor: t.line}]}>
                  <Text style={[st.code, {color: col, borderColor: col}]}>{c}</Text>
                  <View style={{flex: 1}}>
                    <Text style={{color: t.fg, fontSize: 14, lineHeight: 21}}>{dtcText(c)}</Text>
                    <Text style={{color: t.mut, fontSize: 12}}>{tr(`diag.${k}` as Key)}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => Linking.openURL('https://www.google.com/search?q=' + encodeURIComponent(c + ' ' + vinMake))}>
                    <Text style={{fontSize: 18}}>🔍</Text>
                  </Pressable>
                </View>
              );
            })}
      </Card>

      <H2>{tr('diag.readiness')}</H2>
      <Card>
        {!d.status ? <Hint>{tr('diag.notRead')}</Hint> : (
          <>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', rowGap: 6}}>
              {d.status.mon.map(m => (
                <Text key={m.key} style={{width: '50%', color: t.fg, fontSize: 13.5}}>
                  <Text style={{color: m.ok ? t.ok : t.warn, fontWeight: '700'}}>{m.ok ? '✓ ' : '… '}</Text>{tr(m.key)}
                </Text>
              ))}
            </View>
            <Hint style={{marginTop: 6}}>{tr('diag.readinessHint')}</Hint>
          </>
        )}
      </Card>

      <H2>{tr('diag.car')}</H2>
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

const ecuName = (e: EcuDtc) => (e.name ? tr(`ecu.${e.name}` as Key) : tr('ecu.other', {a: ecuHex(e.ecu)}));

function statusText(st: number) {
  const out: string[] = [];
  if (st & 0x01) out.push(tr('bd.st.now'));
  if (st & 0x08) out.push(tr('bd.st.confirmed'));
  else if (st & 0x04) out.push(tr('bd.st.pending'));
  return out.join(' · ');
}

function BmwCodes({on}: { on: boolean }) {
  const t = useTheme();
  const b = useStore(bmwDiag);
  const n = b.ecus.reduce((k, e) => k + e.codes.length, 0);
  return (
    <>
      <H2>{tr('bd.title')}</H2>
      <Card style={{gap: 8}}>
        <Hint>{tr('bd.hint')}</Hint>
        <View style={{flexDirection: 'row', gap: 8}}>
          <Btn title={tr('bd.scan')} kind="pri" disabled={!on || b.busy} onPress={bmwDtcScan} />
          <Btn title={tr('bd.clear')} kind="bad" disabled={!on || b.busy || !n} onPress={async () => {
            if (await confirm(tr('bd.clearQ'), tr('bd.clearMsg'), tr('bd.clearOk'))) await bmwDtcClear();
          }} />
        </View>
        {b.busy && (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <ActivityIndicator color={t.acc} />
            <Text style={{color: t.mut}}>{tr('bd.scanning', {ecu: b.at})}</Text>
          </View>
        )}
        {!b.busy && b.err && <Text style={{color: t.warn, lineHeight: 20}}>{tr(`bd.${b.err}`)}</Text>}
        {!b.busy && !b.err && !b.scanned && <Hint>{tr('bd.notScanned')}</Hint>}
        {b.cleared != null && <Text style={{color: t.ok}}>{tr('bd.cleared', {n: b.cleared})}</Text>}
        {b.scanned && !b.err && <Text style={{color: n ? t.warn : t.ok, fontWeight: '700'}}>{tr('bd.summary', {m: b.ecus.length, n})}</Text>}
      </Card>
      {b.scanned && b.ecus.map(e => (
        <Card key={e.ecu} style={{marginTop: 8, paddingVertical: 6}}>
          <Text style={{color: t.fg, fontSize: 15, fontWeight: '700', paddingVertical: 4}}>
            {ecuName(e)} <Text style={{color: t.mut, fontSize: 12, fontWeight: '400'}}>{ecuHex(e.ecu)}</Text>
          </Text>
          {!e.codes.length ? <Text style={{color: t.ok, paddingBottom: 4}}>{tr('bd.none')}</Text> : e.codes.map(c => {
            const col = c.status & 0x08 ? t.warn : t.acc2;
            const txt = bmwDtcText(c.code);
            return (
              <View key={c.code} style={[st.dtc, {borderColor: t.line}]}>
                <Text style={[st.code, {color: col, borderColor: col, fontSize: 16}]}>{c.code}</Text>
                <View style={{flex: 1}}>
                  <Text style={{color: txt ? t.fg : t.mut, fontSize: 14, lineHeight: 21}}>{txt ?? tr('bd.unknown')}</Text>
                  <Text style={{color: t.mut, fontSize: 12}}>{statusText(c.status)}</Text>
                </View>
                <Pressable hitSlop={8} onPress={() => Linking.openURL('https://www.google.com/search?q=' + encodeURIComponent('BMW ' + c.code))}>
                  <Text style={{fontSize: 18}}>🔍</Text>
                </Pressable>
              </View>
            );
          })}
        </Card>
      ))}
    </>
  );
}

const st = StyleSheet.create({
  dtc: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1},
  code: {fontFamily: 'monospace', fontSize: 18, fontWeight: '700', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3},
});
