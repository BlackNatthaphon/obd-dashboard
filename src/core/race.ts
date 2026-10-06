// จับเวลาแบบรถแข่งจากค่าความเร็ว (ประมาณจุดเริ่ม/จบระหว่างจังหวะอ่าน)
import { RACE_MODES, type RaceMode } from '../obd/catalog';

export type RaceState = 'idle' | 'armed' | 'ready' | 'running' | 'done';
export interface RaceResult { mode: string; time: number; dist: number; g: number; rpm: number; trap?: number; }

export interface RaceEvents {
  onReady?: () => void;
  onStart?: () => void;
  onFinish?: (r: RaceResult) => void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Race {
  state: RaceState = 'idle';
  t0 = 0;
  dist = 0;
  g = 0;
  rpm = 0;
  msg = '';
  res: RaceResult | null = null;
  private prev: { v: number; t: number } | null = null;

  constructor(public modeId: string, private ev: RaceEvents = {}) {}

  get mode(): RaceMode { return RACE_MODES.find(m => m.id === this.modeId) ?? RACE_MODES[0]; }

  setMode(id: string) { this.modeId = id; this.reset(); }
  reset() { this.state = 'idle'; this.msg = ''; this.res = null; this.prev = null; this.dist = 0; this.g = 0; this.rpm = 0; }
  arm() { this.reset(); this.state = 'armed'; this.msg = 'กำลังรอ...'; }
  cancel() { this.state = 'idle'; this.msg = 'ยกเลิกแล้ว'; }
  elapsed(nowT: number) {
    return this.state === 'running' ? (nowT - this.t0) / 1000 : this.state === 'done' && this.res ? this.res.time : 0;
  }

  private ready(msg: string) { this.state = 'ready'; this.msg = msg; this.ev.onReady?.(); }
  private start(t0: number, msg = 'ไป! ไป! ไป!') {
    this.state = 'running'; this.t0 = t0; this.dist = 0; this.g = 0; this.rpm = 0; this.msg = msg;
    this.ev.onStart?.();
  }
  private finish(tc: number, extra: Partial<RaceResult> = {}) {
    this.res = {mode: this.mode.id, time: (tc - this.t0) / 1000, dist: this.dist, g: this.g, rpm: this.rpm, ...extra};
    this.state = 'done';
    this.msg = 'เสร็จแล้ว';
    this.ev.onFinish?.(this.res);
  }

  /** ป้อนค่าความเร็ว (km/h) พร้อมเวลา (ms) และค่าประกอบล่าสุด */
  update(v: number, t: number, extra: { rpm?: number | null; acc?: number | null } = {}) {
    const p = this.prev;
    this.prev = {v, t};
    if (this.state === 'idle' || this.state === 'done' || !p) return;
    const m = this.mode, dt = (t - p.t) / 1000;
    if (dt <= 0) return;
    const seg = ((p.v + v) / 2 / 3.6) * dt;
    const cross = (x: number) => p.t + ((x - p.v) / (v - p.v)) * (t - p.t);   // เวลาที่ความเร็วผ่านค่า x
    if (this.state === 'running') {
      this.dist += seg;
      if (extra.rpm != null && extra.rpm > this.rpm) this.rpm = extra.rpm;
      if (extra.acc != null && Math.abs(extra.acc) > Math.abs(this.g)) this.g = extra.acc;
      if (t - this.t0 > 90000) { this.state = 'armed'; this.msg = 'นานเกินไป เริ่มใหม่'; return; }
    }
    if (m.type === 'accel' || m.type === 'dist') {
      if (this.state === 'armed') {
        if (v === 0) this.ready('พร้อม! ออกตัวได้เลย');
        else this.msg = 'หยุดรถให้สนิทก่อน';
      } else if (this.state === 'ready') {
        if (v > 0) {
          // ประมาณเวลาที่ล้อเริ่มหมุน (อัตราเร่งออกตัวราว 4 m/s²)
          const t0 = clamp(t - (v / 14.4) * 1000, p.t, t);
          this.start(t0);
          this.dist = ((v / 2 / 3.6) * (t - t0)) / 1000;
        }
      } else if (this.state === 'running') {
        if (m.type === 'accel' && v >= m.to!) this.finish(cross(m.to!));
        else if (m.type === 'dist' && this.dist >= m.dist!) {
          const frac = seg > 0 ? clamp(1 - (this.dist - m.dist!) / seg, 0, 1) : 1;
          this.dist = m.dist!;
          this.finish(p.t + frac * (t - p.t), {trap: p.v + frac * (v - p.v)});
        } else if (v === 0 && t - this.t0 > 1500) { this.state = 'ready'; this.msg = 'รถหยุด — ออกตัวใหม่ได้เลย'; }
      }
    } else if (m.type === 'roll') {
      if (this.state === 'armed') {
        if (v < m.from!) this.ready(`เร่งผ่าน ${m.from} ได้เลย`);
        else this.msg = `ลดความเร็วให้ต่ำกว่า ${m.from} ก่อน`;
      } else if (this.state === 'ready') {
        if (v >= m.from! && p.v < m.from!) this.start(cross(m.from!), 'เร่ง!');
      } else if (this.state === 'running') {
        if (v >= m.to!) this.finish(cross(m.to!));
        else if (v < m.from! - 3) { this.state = 'ready'; this.msg = `ยกเลิก — เร่งผ่าน ${m.from} ใหม่`; }
      }
    } else if (m.type === 'brake') {
      if (this.state === 'armed') {
        if (v >= m.from!) this.ready('เบรกได้เลยเมื่อพร้อม');
        else this.msg = `เร่งให้เกิน ${m.from} ก่อน`;
      } else if (this.state === 'ready') {
        if (v < m.from! && p.v >= m.from!) this.start(cross(m.from!), 'เบรก!');
      } else if (this.state === 'running') {
        if (v === 0) {
          // ประมาณจุดหยุดจริงจากอัตราหน่วงที่ผ่านมา
          const el = (p.t - this.t0) / 1000;
          const dec = el > 0.2 ? (m.from! - p.v) / el : 30;
          const tz = Math.min(t, p.t + (p.v / Math.max(dec, 5)) * 1000);
          this.dist += -seg + ((p.v / 2 / 3.6) * (tz - p.t)) / 1000;
          this.finish(tz);
        } else if (v > m.from! + 5) { this.state = 'ready'; this.msg = 'ยกเลิก — เบรกใหม่'; }
      }
    }
  }
}
