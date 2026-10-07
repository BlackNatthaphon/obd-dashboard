// เดาเกียร์จากอัตราส่วน รอบเครื่อง ÷ ความเร็ว (rpm ต่อ km/h)
// แต่ละเกียร์มีอัตราส่วนคงที่ → เก็บสถิติตอนขับนิ่งๆ แล้วหายอดของฮิสโตแกรม = เกียร์แต่ละตัว

/** ค่าพิเศษของเกียร์ (ค่าบวก = เลขเกียร์) */
export const GEAR_N = 0;        // จอด / ว่าง
export const GEAR_UNKNOWN = -1; // กำลังเปลี่ยนเกียร์ / คลัตช์ลื่น / ปล่อยไหล
export const GEAR_EV = -2;      // เครื่องยนต์ดับแต่รถวิ่ง (ไฮบริดวิ่งไฟฟ้า)
export const GEAR_LEARNING = -3;

const R_MIN = 8, R_MAX = 220;             // rpm ต่อ km/h ที่เป็นไปได้
const BIN = 0.02;                          // ความกว้างช่อง ~2% (สเกล log)
const NBINS = Math.ceil(Math.log(R_MAX / R_MIN) / BIN);
const MATCH = 0.07;                        // ห่างจากยอดไม่เกิน 7% ถือว่าเป็นเกียร์นั้น

export function gearLabel(v: number | null | undefined): string {
  if (v == null) return '--';
  if (v === GEAR_N) return 'N';
  if (v === GEAR_EV) return 'EV';
  if (v === GEAR_LEARNING) return '?';
  if (v < 0) return '–';
  return String(v);
}

export class GearEstimator {
  hist: number[];
  private recent: number[] = [];
  private n = 0;
  /** อัตราส่วนของแต่ละเกียร์ เรียงจากเกียร์ 1 (มากสุด) */
  gears: number[] = [];

  constructor(saved?: number[] | null) {
    this.hist = saved && saved.length === NBINS ? saved.slice() : new Array(NBINS).fill(0);
    this.findGears();
  }

  reset() { this.hist.fill(0); this.recent = []; this.gears = []; }

  private bin(r: number) { return Math.floor(Math.log(r / R_MIN) / BIN); }
  private center(i: number) { return R_MIN * Math.exp((i + 0.5) * BIN); }

  /** ป้อนค่ารอบ+ความเร็วที่อ่านพร้อมกัน คืนเกียร์ปัจจุบัน */
  update(rpm: number, speed: number): number {
    if (speed < 3) { this.recent = []; return GEAR_N; }
    if (rpm < 300) { this.recent = []; return GEAR_EV; }
    const r = rpm / speed;
    if (r < R_MIN || r > R_MAX) return GEAR_UNKNOWN;
    // เก็บสถิติเฉพาะตอนอัตราส่วนนิ่ง (ไม่ได้กำลังเปลี่ยนเกียร์) และเร็วพอให้ความเร็วจำนวนเต็มไม่คลาดมาก
    this.recent.push(r);
    if (this.recent.length > 3) this.recent.shift();
    // ความเร็วจาก OBD เป็นจำนวนเต็ม → ที่ความเร็วต่ำยอมให้คลาดได้มากขึ้น
    const steady = this.recent.length === 3 && Math.max(...this.recent) / Math.min(...this.recent) < 1.03 + 1 / speed;
    if (steady && speed >= 8 && rpm >= 700) {
      this.hist[this.bin(r)] += 1;
      if (++this.n % 20 === 0) this.findGears();
    }
    return this.match(r);
  }

  match(r: number): number {
    if (this.gears.length < 2) return GEAR_LEARNING;
    let best = -1, bd = Infinity;
    this.gears.forEach((g, i) => { const d = Math.abs(Math.log(r / g)); if (d < bd) { bd = d; best = i; } });
    return bd <= MATCH ? best + 1 : GEAR_UNKNOWN;
  }

  /** หายอดของฮิสโตแกรม (เกลี่ย 3 ช่อง) */
  findGears() {
    const h = this.hist, total = h.reduce((a, b) => a + b, 0);
    if (total < 40) { this.gears = []; return; }
    const s = h.map((_, i) => (h[i - 1] ?? 0) + 2 * h[i] + (h[i + 1] ?? 0));
    const min = Math.max(8, total * 0.012);
    const peaks: { i: number; v: number }[] = [];
    for (let i = 0; i < s.length; i++)
      if (s[i] >= min && s[i] >= (s[i - 1] ?? 0) && s[i] > (s[i + 1] ?? 0)) peaks.push({i, v: s[i]});
    // ยอดที่อยู่ใกล้กันเกิน ~8% เป็นเกียร์เดียวกัน เก็บอันที่สูงกว่า
    peaks.sort((a, b) => b.v - a.v);
    const kept: number[] = [];
    for (const p of peaks) if (kept.every(k => Math.abs(k - p.i) > 4)) kept.push(p.i);
    this.gears = kept.map(i => this.center(i)).sort((a, b) => b - a);
  }
}

/** อ่านค่าเกียร์จาก PID A4 (ถ้ารถรองรับ): A bit1 = รองรับ, B บิต 7-4 = เกียร์ */
export function parseA4(a: number[]): number {
  if (!(a[0] & 0x02)) return GEAR_UNKNOWN;
  const g = a[1] >> 4;
  return g === 0 ? GEAR_N : g;
}
