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
  shift: require('../../assets/sounds/shift.wav'),
  shiftLoop: require('../../assets/sounds/shift-loop.wav'),
};
export type Tone = keyof typeof SOURCES;

const players: Partial<Record<Tone, AudioPlayer>> = {};

function player(tone: Tone): AudioPlayer | null {
  try { return (players[tone] ??= createAudioPlayer(SOURCES[tone])); }
  catch { return null; }
}

/** force = เล่นแม้ปิดเสียงบี๊บทั่วไป (ใช้กับเสียงเตือนเปลี่ยนเกียร์ที่มีสวิตช์ของตัวเอง) */
export function beep(tone: Tone, times = 1, force = false) {
  if (!force && !settings.get().sound) return;
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      const p = player(tone);
      if (!p) return;
      try { p.seekTo(0).catch(() => {}); p.play(); } catch { /* ignore */ }
    }, i * 220);
  }
}

/** เสียงต่อเนื่องค้างไว้จนกว่าจะเรียก toneOff() */
let holding: Tone | null = null;
export function toneOn(tone: Tone) {
  if (holding === tone) return;
  toneOff();
  const p = player(tone);
  if (!p) return;
  holding = tone;
  try { p.loop = true; p.seekTo(0).catch(() => {}); p.play(); } catch { /* ignore */ }
}
export function toneOff() {
  if (!holding) return;
  const p = players[holding];
  holding = null;
  try { p?.pause(); if (p) p.loop = false; } catch { /* ignore */ }
}

export function buzz(pattern: number | number[]) {
  if (!settings.get().vibrate) return;
  try { Vibration.vibrate(Array.isArray(pattern) ? [0, ...pattern] : pattern); } catch { /* ignore */ }
}
