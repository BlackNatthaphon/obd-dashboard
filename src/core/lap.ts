// นาฬิกาจับเวลารอบสนาม (กดเอง ไม่ต้องต่อรถ)
import { now } from '../obd/elm';
import { beep, buzz } from './feedback';
import { createStore } from './store';

export const lap = createStore({on: false, t0: 0, lapT0: 0, acc: 0, pausedLap: 0, laps: [] as number[]});

export function lapGo() {
  const s = lap.get(), t = now();
  if (!s.on) {
    lap.set({on: true, t0: t - s.acc, lapT0: s.acc ? t - s.pausedLap : t});
    beep(1200);
  } else {
    lap.set({on: false, acc: t - s.t0, pausedLap: t - s.lapT0});
  }
}

export function lapLap() {
  const s = lap.get();
  if (!s.on) return;
  const t = now(), l = t - s.lapT0;
  const laps = [...s.laps, l];
  const best = Math.min(...laps) === l;
  lap.set({laps, lapT0: t});
  beep(best ? 1600 : 990, best ? 2 : 1);
  buzz(60);
}

export function lapReset() { lap.set({on: false, t0: 0, lapT0: 0, acc: 0, pausedLap: 0, laps: []}); }

export function lapTime(ms: number) {
  const s = ms / 1000, m = Math.floor(s / 60);
  return m + ':' + (s % 60).toFixed(2).padStart(5, '0');
}
