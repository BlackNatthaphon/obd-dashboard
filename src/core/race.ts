// จับเวลาแบบรถแข่งจากค่าความเร็ว (ประมาณจุดเริ่ม/จบระหว่างจังหวะอ่าน)
import { msg, type Key, type Msg, type Vars } from '../i18n';
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
  msg: Msg | null = null;
  res: RaceResult | null = null;
  private prev: { v: number; t: number } | null = null;

  constructor(public modeId: string, private ev: RaceEvents = {}) {}

  get mode(): RaceMode { return RACE_MODES.find(m => m.id === this.modeId) ?? RACE_MODES[0]; }

  setMode(id: string) { this.modeId = id; this.reset(); }
  reset() { this.state = 'idle'; this.msg = null; this.res = null; this.prev = null; this.dist = 0; this.g = 0; this.rpm = 0; }
  arm() { this.reset(); this.state = 'armed'; this.say('race.waiting'); }
  cancel() { this.state = 'idle'; this.say('race.cancelled'); }
  private say(k: Key, v?: Vars) { this.msg = msg(k, v); }
  elapsed(nowT: number) {
    return this.state === 'running' ? (nowT - this.t0) / 1000 : this.state === 'done' && this.res ? this.res.time : 0;
  }

  private ready(k: Key, v?: Vars) { this.state = 'ready'; this.say(k, v); this.ev.onReady?.(); }
  private start(t0: number, k: Key = 'race.go') {
    this.state = 'running'; this.t0 = t0; this.dist = 0; this.g = 0; this.rpm = 0; this.say(k);
    this.ev.onStart?.();
  }
  private finish(tc: number, extra: Partial<RaceResult> = {}) {
    this.res = {mode: this.mode.id, time: (tc - this.t0) / 1000, dist: this.dist, g: this.g, rpm: this.rpm, ...extra};
    this.state = 'done';
    this.say('race.finished');
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
      if (t - this.t0 > 90000) { this.state = 'armed'; this.say('race.tooLong'); return; }
    }
    if (m.type === 'accel' || m.type === 'dist') {
      if (this.state === 'armed') {
        if (v === 0) this.ready('race.launchReady');
        else this.say('race.stopFirst');
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
        } else if (v === 0 && t - this.t0 > 1500) { this.state = 'ready'; this.say('race.stoppedRelaunch'); }
      }
    } else if (m.type === 'roll') {
      if (this.state === 'armed') {
        if (v < m.from!) this.ready('race.accelThrough', {v: m.from!});
        else this.say('race.slowBelow', {v: m.from!});
      } else if (this.state === 'ready') {
        if (v >= m.from! && p.v < m.from!) this.start(cross(m.from!), 'race.accel');
      } else if (this.state === 'running') {
        if (v >= m.to!) this.finish(cross(m.to!));
        else if (v < m.from! - 3) { this.state = 'ready'; this.say('race.rollAbort', {v: m.from!}); }
      }
    } else if (m.type === 'brake') {
      if (this.state === 'armed') {
        if (v >= m.from!) this.ready('race.brakeReady');
        else this.say('race.speedAbove', {v: m.from!});
      } else if (this.state === 'ready') {
        if (v < m.from! && p.v >= m.from!) this.start(cross(m.from!), 'race.brake');
      } else if (this.state === 'running') {
        if (v === 0) {
          // ประมาณจุดหยุดจริงจากอัตราหน่วงที่ผ่านมา
          const el = (p.t - this.t0) / 1000;
          const dec = el > 0.2 ? (m.from! - p.v) / el : 30;
          const tz = Math.min(t, p.t + (p.v / Math.max(dec, 5)) * 1000);
          this.dist += -seg + ((p.v / 2 / 3.6) * (tz - p.t)) / 1000;
          this.finish(tz);
        } else if (v > m.from! + 5) { this.state = 'ready'; this.say('race.brakeAbort'); }
      }
    }
  }
}
