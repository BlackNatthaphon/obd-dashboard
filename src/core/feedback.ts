// เสียงบี๊บและการสั่น
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
import { settings } from './settings';

const SOURCES = {
  660: require('../../assets/sounds/beep660.wav'),
  990: require('../../assets/sounds/beep990.wav'),
  1200: require('../../assets/sounds/beep1200.wav'),
  1400: require('../../assets/sounds/beep1400.wav'),
  1600: require('../../assets/sounds/beep1600.wav'),
};
export type Tone = keyof typeof SOURCES;

const players: Partial<Record<Tone, AudioPlayer>> = {};

function player(tone: Tone): AudioPlayer | null {
  try { return (players[tone] ??= createAudioPlayer(SOURCES[tone])); }
  catch { return null; }
}

export function beep(tone: Tone, times = 1) {
  if (!settings.get().sound) return;
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      const p = player(tone);
      if (!p) return;
      try { p.seekTo(0).catch(() => {}); p.play(); } catch { /* ignore */ }
    }, i * 220);
  }
}

export function buzz(pattern: number | number[]) {
  if (!settings.get().vibrate) return;
  try { Vibration.vibrate(Array.isArray(pattern) ? [0, ...pattern] : pattern); } catch { /* ignore */ }
}
