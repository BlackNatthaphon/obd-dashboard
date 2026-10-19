// คุยกับกล่องของ BMW (F/G-series) ผ่าน ELM327: ส่งแค่ UDS ReadDataByIdentifier (0x22) — อ่านอย่างเดียว ไม่เขียนอะไรลงรถ
// ตัวทดสอบอยู่ที่ 0x6F1 ใส่ที่อยู่กล่องเป็นไบต์แรก (extended addressing) กล่องตอบกลับที่ 0x600 + ที่อยู่ ไบต์แรกเป็น F1
// ที่อยู่กล่องและรหัสข้อมูลอ้างอิงจาก OBDb (github.com/OBDb/BMW-3-Series, CC BY-SA 4.0)
import type { Elm } from './elm';

export const TESTER = 0xf1;
/** กล่อง DSC (ABS) */
export const DSC = 0x29;
/** ความเร็ว 4 ล้อ: FL FR RL RR แบบ int16 ÷ 100 = km/h */
export const DID_WHEELS = 'DBE4';

/**
 * วิธีส่ง flow control ของข้อความหลายเฟรม (ตัวเสียบแต่ละยี่ห้อทำได้ไม่เหมือนกัน จึงลองทีละแบบ)
 * auto  = ให้ ELM ตอบเอง · fcExt/fc = กำหนดเฟรมเอง (มี/ไม่มีที่อยู่กล่องนำหน้า) · raw = ปิด auto format แล้วประกอบเฟรมเอง (สำหรับตัวที่ไม่มี ATCEA)
 */
export type Method = 'auto' | 'fcExt' | 'fc' | 'raw';
export const METHODS: Method[] = ['auto', 'fcExt', 'fc', 'raw'];

const hx = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

type Frame = { pci: number; b: number[] };

function frames(lines: string[], ecu: number): Frame[] {
  const rx = (0x600 + ecu).toString(16).toUpperCase();
  const out: Frame[] = [];
  for (const raw of lines) {
    const h = raw.replace(/\s/g, '').toUpperCase();
    if (!h.startsWith(rx) || !/^[0-9A-F]+$/.test(h)) continue;
    const b: number[] = [];
    for (let i = rx.length; i + 1 < h.length; i += 2) b.push(parseInt(h.substr(i, 2), 16));
    if (b[0] === TESTER) b.shift();                       // ไบต์ที่อยู่ (PCI ไม่มีทางเป็น F1 จึงแยกได้ชัด)
    if (b.length) out.push({pci: b[0] >> 4, b});
  }
  return out;
}

/** มีเฟรมแรกของข้อความหลายเฟรม (กล่องรอ flow control อยู่) */
export const hasFirstFrame = (lines: string[], ecu: number) => frames(lines, ecu).some(f => f.pci === 1);

/** รวมเฟรม ISO-TP (บรรทัดแบบเปิด header: "629F1101662DBE4...") เป็นข้อความ UDS เดียว */
export function isoTp(lines: string[], ecu: number): number[] | null {
  let msg: number[] | null = null, len = 0;
  for (const {pci, b} of frames(lines, ecu)) {
    if (pci === 0) {
      const p = b.slice(1, 1 + (b[0] & 15));
      if (p[0] === 0x7f && p[2] === 0x78) continue;         // "รอสักครู่" ข้อความจริงตามมา
      if (p.length === (b[0] & 15)) return p;
    } else if (pci === 1) { len = ((b[0] & 15) << 8) | b[1]; msg = b.slice(2); }
    else if (pci === 2 && msg) msg.push(...b.slice(1));
    if (msg && len && msg.length >= len) return msg.slice(0, len);
  }
  return null;
}

export type DidResult = { data: number[] } | { nrc: number } | null;

/** แยกคำตอบของ 0x22: ข้อมูล, รหัสปฏิเสธ (NRC) หรือ null ถ้าไม่ตอบ */
export function parseDid(msg: number[] | null, did: string): DidResult {
  if (!msg) return null;
  if (msg[0] === 0x62 && hx(msg[1]) + hx(msg[2]) === did) return {data: msg.slice(3)};
  if (msg[0] === 0x7f && msg[1] === 0x22) return {nrc: msg[2]};
  return null;
}

/** km/h ของ FL FR RL RR */
export function decodeWheels(d: number[]): number[] | null {
  if (d.length < 8) return null;
  const out: number[] = [];
  for (let i = 0; i < 8; i += 2) { const v = (d[i] << 8) | d[i + 1]; out.push((v >= 0x8000 ? v - 0x10000 : v) / 100); }
  return out;
}

const ok = (r: string[]) => !r.join().match(/\?|ERROR/);

/** ตั้ง ELM ให้คุยกับกล่อง ecu ด้วยวิธี m (false = ตัวเสียบไม่รู้จักคำสั่ง) */
export async function bmwSetup(elm: Elm, m: Method, ecu: number): Promise<boolean> {
  const e = hx(ecu), rx = (0x600 + ecu).toString(16).toUpperCase();
  const cmds = ['ATH1', 'ATSH6F1', 'ATCRA' + rx];
  if (m === 'raw') cmds.push('ATCEA', 'ATFCSM0', 'ATCAF0');
  else {
    cmds.push('ATCAF1', 'ATCEA' + e);
    if (m === 'auto') cmds.push('ATFCSM0');
    else cmds.push('ATFCSH6F1', 'ATFCSD' + (m === 'fcExt' ? e : '') + '300000', 'ATFCSM1');
  }
  for (const c of cmds) {
    const r = await elm.send(c);
    // ปิด CEA ในโหมด raw: ตัวเสียบที่ไม่มีคำสั่งนี้ตอบ ? ได้ ไม่เป็นไร
    if (!ok(r) && c !== 'ATCEA') return false;
  }
  return true;
}

/** อ่านค่า did จากกล่อง ecu (ต้อง bmwSetup ด้วยวิธีเดียวกันก่อน) */
export async function bmwRead(elm: Elm, m: Method, ecu: number, did: string): Promise<DidResult> {
  if (m !== 'raw') return parseDid(isoTp(await elm.send('22' + did, 3000), ecu), did);
  const e = hx(ecu), pad = (s: string) => s.padEnd(16, '0');
  const lines = [...await elm.send(pad(e + '0322' + did), 3000)];
  let msg = isoTp(lines, ecu);
  // ได้แค่เฟรมแรก → ส่ง flow control เอง แล้วรับเฟรมที่เหลือ
  if (!msg && hasFirstFrame(lines, ecu)) {
    lines.push(...await elm.send(pad(e + '300000'), 3000));
    msg = isoTp(lines, ecu);
  }
  return parseDid(msg, did);
}

/** คืนค่าตัวเสียบกลับเป็นแบบ OBD-II ปกติ */
export async function bmwRestore(elm: Elm) {
  for (const c of ['ATCAF1', 'ATFCSM0', 'ATCEA', 'ATCRA', 'ATSH7DF', 'ATH0']) await elm.send(c);
}

/** ลองทุกวิธีจนอ่านค่าได้ · คืน method ที่ใช้ได้ หรือ nrc ถ้ากล่องตอบว่าไม่มีค่านี้ */
export async function bmwProbe(elm: Elm, ecu: number, did: string, log: (s: string) => void):
  Promise<{ method: Method; data: number[] } | { nrc: number } | null> {
  for (const m of METHODS) {
    if (!elm.connected) return null;
    if (!(await bmwSetup(elm, m, ecu))) { log(`BMW ${hx(ecu)} ${m}: adapter refused setup`); continue; }
    const r = await bmwRead(elm, m, ecu, did);
    if (r && 'data' in r) { log(`BMW ${hx(ecu)} ${did}: OK (${m})`); return {method: m, ...r}; }
    if (r) { log(`BMW ${hx(ecu)} ${did}: NRC ${hx(r.nrc)}`); return r; }
    log(`BMW ${hx(ecu)} ${did}: no reply (${m})`);
  }
  return null;
}
