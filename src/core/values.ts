// ค่าที่อ่านได้ล่าสุด + ประวัติย้อนหลัง (เก็บนอก React เพื่อไม่ให้ re-render ทุกครั้งที่อ่านได้)
import { useEffect, useState } from 'react';
import { now } from '../obd/elm';

export interface Val { v: number; t: number; min: number; max: number; hist: [number, number][]; stale?: boolean; }

export const V: Record<string, Val> = {};
const HIST_MS = 310000;

export function setVal(id: string, v: number | null | undefined, t = now()) {
  if (v == null || !isFinite(v)) return;
  let o = V[id];
  if (!o) o = V[id] = {v, t, min: v, max: v, hist: []};
  o.v = v; o.t = t; o.stale = false;
  if (v < o.min) o.min = v;
  if (v > o.max) o.max = v;
  o.hist.push([t, v]);
  if (o.hist.length > 50 && o.hist[0][0] < t - HIST_MS) {
    const i = o.hist.findIndex(h => h[0] >= t - HIST_MS);
    if (i > 0) o.hist.splice(0, i);
  }
}

/** ค่าล่าสุด หรือ null ถ้าเก่าเกิน maxAge มิลลิวินาที */
export function val(id: string, maxAge = 5000): number | null {
  const o = V[id];
  return o && !o.stale && now() - o.t < maxAge ? o.v : null;
}

export function clearValues() { for (const k of Object.keys(V)) delete V[k]; }

/** re-render คอมโพเนนต์ทุก ms มิลลิวินาที (ใช้กับหน้าที่แสดงค่าสด) */
export function useFrame(ms = 100, on = true): number {
  const [n, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set(x => (x + 1) % 1e9), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return n;
}
