// HUD: ความเร็วตัวใหญ่เต็มจอ (กลับด้านได้ไว้สะท้อนกระจกหน้า)
import { router, useFocusEffect } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { setHud } from '../core/engine';
import { setSettings, useSettings } from '../core/settings';
import { useFrame, val } from '../core/values';
import { Btn } from '../ui/kit';
import { t as tr } from '../i18n';

export default function Hud() {
  const cfg = useSettings();
  const {width, height} = useWindowDimensions();
  useFrame(80);
  useFocusEffect(useCallback(() => { setHud(true); return () => setHud(false); }, []));
  const v = val('0D', 2000), r = val('0C', 2000);
  const shift = r != null && r >= cfg.shiftRpm;
  const size = Math.min(width * 0.44, height * 0.62);
  return (
    <View style={st.root}>
      <StatusBar hidden />
      {Platform.OS === 'android' && <NavigationBar hidden />}
      <View style={[st.in, cfg.hudMirror && {transform: [{scaleX: -1}]}]}>
        <Text style={[st.s, {fontSize: size, lineHeight: size * 1.05, color: shift ? '#ff2d2d' : '#3dff8a'}]}>{v == null ? '--' : v.toFixed(0)}</Text>
        <Text style={[st.u, {fontSize: height * 0.05}]}>km/h</Text>
        <View style={[st.rb, {height: height * 0.03}]}>
          <View style={{height: '100%', width: `${Math.min(100, ((r ?? 0) / cfg.redline) * 100)}%`, backgroundColor: shift ? '#ff2d2d' : (r ?? 0) > cfg.shiftRpm - 1500 ? '#ffd000' : '#3dff8a'}} />
        </View>
        <Text style={[st.r, {fontSize: height * 0.07}]}>{r == null ? '--' : r.toFixed(0)} rpm</Text>
      </View>
      <View style={st.x}>
        <Btn title={tr('hud.mirror')} onPress={() => setSettings({hudMirror: !cfg.hudMirror})} style={st.xb} textStyle={{color: '#ccc'}} />
        <Btn title="✕" onPress={() => router.back()} style={st.xb} textStyle={{color: '#ccc'}} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  in: {alignItems: 'center', width: '100%'},
  s: {fontWeight: '800', fontVariant: ['tabular-nums']},
  u: {color: '#888'},
  rb: {width: '80%', backgroundColor: '#111', borderRadius: 20, overflow: 'hidden', marginTop: 16},
  r: {color: '#aaa', fontVariant: ['tabular-nums'], marginTop: 6},
  x: {position: 'absolute', top: 24, right: 14, flexDirection: 'row', gap: 8},
  xb: {backgroundColor: '#111', borderColor: '#333'},
});
