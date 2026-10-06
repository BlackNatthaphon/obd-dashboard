import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSettings, useSettings } from '../core/settings';
import { DevicePicker } from '../ui/Sheets';
import { useTheme } from '../ui/theme';

export default function Root() {
  useKeepAwake();
  const s = useSettings();
  const t = useTheme();

  useEffect(() => { loadSettings(); }, []);
  useEffect(() => { SystemUI.setBackgroundColorAsync(t.bg).catch(() => {}); }, [t.bg]);
  useEffect(() => {
    if (Platform.OS === 'web' || !s.loaded) return;
    const L = ScreenOrientation.OrientationLock;
    (s.orient === 'landscape' ? ScreenOrientation.lockAsync(L.LANDSCAPE)
      : s.orient === 'portrait' ? ScreenOrientation.lockAsync(L.PORTRAIT_UP)
        : ScreenOrientation.unlockAsync()).catch(() => {});
  }, [s.orient, s.loaded]);

  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {...base, colors: {...base.colors, background: t.bg, card: t.card, text: t.fg, border: t.line, primary: t.acc}};

  if (!s.loaded) return <View style={{flex: 1, backgroundColor: t.bg}} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack screenOptions={{headerShown: false, contentStyle: {backgroundColor: t.bg}}}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{presentation: 'modal', headerShown: true, title: 'ตั้งค่า',
            headerStyle: {backgroundColor: t.bg}, headerTintColor: t.fg}} />
          <Stack.Screen name="log" options={{presentation: 'modal', headerShown: true, title: 'Log',
            headerStyle: {backgroundColor: t.bg}, headerTintColor: t.fg}} />
          <Stack.Screen name="hud" options={{presentation: 'fullScreenModal', animation: 'fade'}} />
        </Stack>
        <DevicePicker />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
