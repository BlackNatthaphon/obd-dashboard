// วิเคราะห์ความเร็ว 4 ล้อ (FL FR RL RR) หาเซนเซอร์ ABS ที่ผิดปกติ
// เทียบแต่ละล้อกับค่ากลาง (median) ของ 4 ล้อ: ล้อที่เสียจะเป็น 0, กระตุก หรือต่างจากล้ออื่นตลอด

export const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;
export type WheelState = 'wait' | 'ok' | 'warn' | 'bad';

/** ต่ำกว่านี้ไม่วิเคราะห์ (ความเร็วต่ำ % คลาดเคลื่อนมาก และตอนหมุนล้อเล่นด้วยมือล้ออื่นเป็น 0 อยู่แล้ว) */
export const MIN_SPEED = 8;
const DROP = 0.5;        // km/h ถือว่าสัญญาณหาย
const GLITCH = 15;       // % ต่างจากล้ออื่นทันที (เลี้ยวโค้งปกติไม่ถึง)
const HIST_MS = 60000;

export interface WheelStat {
  /** % ต่างจากค่ากลาง (เฉลี่ยเคลื่อนที่ ไว้แสดงผล) */
  dev: number;
  /** % ต่างจากค่ากลางเฉลี่ยทั้งหมดที่วิเคราะห์ */
  mean: number;
  n: number;
  drops: number;
  glitches: number;
  dropping: boolean;
  glitching: boolean;
}

const fresh = (): WheelStat => ({dev: 0, mean: 0, n: 0, drops: 0, glitches: 0, dropping: false, glitching: false});

export function median4(w: number[]): number {
  const s = [...w].sort((a, b) => a - b);
  return (s[1] + s[2]) / 2;
}

export class WheelCheck {
  s: WheelStat[] = WHEELS.map(fresh);
  /** [เวลา, % ต่างของแต่ละล้อ] null = ช้าเกินวิเคราะห์ */
  hist: [number, number[] | null][] = [];
  last: number[] | null = null;
  lastT = 0;

  reset() { this.s = WHEELS.map(fresh); this.hist = []; }

  update(w: number[], t: number) {
    this.last = w; this.lastT = t;
    const m = median4(w);
    let devs: number[] | null = null;
    if (m >= MIN_SPEED) {
      devs = w.map((v, i) => {
        const s = this.s[i], d = ((v - m) / m) * 100;
        if (v < DROP) {
          if (!s.dropping) s.drops++;
          s.dropping = true; s.glitching = false;
          return -100;
        }
        s.dropping = false;
        if (Math.abs(d) > GLITCH) {
          if (!s.glitching) s.glitches++;
          s.glitching = true;
        } else {
          s.glitching = false;
          s.n++;
          s.mean += (d - s.mean) / s.n;
        }
        s.dev += (d - s.dev) * 0.3;
        return d;
      });
    } else for (const s of this.s) { s.dropping = false; s.glitching = false; }
    this.hist.push([t, devs]);
    while (this.hist.length > 2 && this.hist[0][0] < t - HIST_MS) this.hist.shift();
  }

  state(i: number): WheelState {
    const s = this.s[i];
    if (s.drops || s.glitches >= 3 || (s.n >= 20 && Math.abs(s.mean) >= 5)) return 'bad';
    if (s.glitches || (s.n >= 20 && Math.abs(s.mean) >= 2.5)) return 'warn';
    return s.n < 20 ? 'wait' : 'ok';
  }
}
