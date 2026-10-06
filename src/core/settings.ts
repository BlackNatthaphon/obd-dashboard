// การตั้งค่าที่เก็บไว้ในเครื่อง
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PRESETS, type Dash } from '../obd/catalog';
import { createStore, useStore } from './store';

export type ThemeName = 'midnight' | 'racing' | 'neon' | 'amber' | 'day';
export type Orientation = 'auto' | 'landscape' | 'portrait';

export interface RaceRun {
  mode: string; time: number; dist: number; g: number; rpm: number; at: number; sim: boolean; trap?: number;
}
export interface Trip { dist: number; time: number; fuel: number; max: number; }

export interface Settings {
  theme: ThemeName;
  dash: Dash[];
  dashIdx: number;
  shiftRpm: number;
  redline: number;
  fuel: 'gas' | 'diesel';
  sound: boolean;
  vibrate: boolean;
  hudMirror: boolean;
  raceMode: string;
  runs: RaceRun[];
  graph: string[];
  graphWin: number;
  orient: Orientation;
  trip: Trip;
  device: { id: string; name: string } | null;
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export const DEFAULTS: Settings = {
  theme: 'midnight', dash: clone(PRESETS), dashIdx: 0, shiftRpm: 6000, redline: 6500, fuel: 'gas',
  sound: true, vibrate: true, hudMirror: false, raceMode: '0-100', runs: [], graph: ['0C', '0D', '11'], graphWin: 60,
  orient: 'auto', trip: {dist: 0, time: 0, fuel: 0, max: 0}, device: null,
};

const KEY = 'obd-dashboard/settings';
export const settings = createStore<Settings & { loaded: boolean }>({...clone(DEFAULTS), loaded: false});

let saveT: ReturnType<typeof setTimeout> | undefined;
settings.subscribe(() => {
  if (!settings.get().loaded) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const {loaded, ...s} = settings.get();
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  }, 400);
});

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    settings.set({...clone(DEFAULTS), ...saved, loaded: true});
  } catch {
    settings.set({loaded: true});
  }
}

export const useSettings = () => useStore(settings);
export const setSettings = settings.set;
export const curDash = (s: Settings = settings.get()) => s.dash[s.dashIdx] ?? s.dash[0];

/** แก้แดชบอร์ดหน้าปัจจุบัน */
export function updateDash(fn: (d: Dash) => Dash) {
  settings.set(s => {
    const dash = s.dash.slice();
    const i = Math.min(s.dashIdx, dash.length - 1);
    dash[i] = fn(clone(dash[i]));
    return {dash};
  });
}
