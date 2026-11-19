// หัวใจของแอพ: เชื่อมต่อ, วนอ่านค่า, คำนวณค่าเพิ่ม, ทริป, จับเวลา, บันทึกข้อมูล
import { AppError, msg, type Msg } from '../i18n';
import { SRC, type Source } from '../obd/catalog';
import { Elm, now, type DtcResult, type ElmInfo, type StatusResult, type Transport } from '../obd/elm';
import { openBle, scanDevices, type FoundDevice } from '../obd/ble';
import { createSimTransport } from '../obd/sim';
import { bmwProbe, bmwRead, bmwReq, bmwRestore, bmwSetup, CLEAR_REQ, decodeWheels, DID_WHEELS, DSC, DTC_REQ, ECUS, parseDtc19,
  type BmwDtc, type Method } from '../obd/bmw';
import { beep, buzz, toneOff, toneOn } from './feedback';
import { GearEstimator } from './gear';
import { Race } from './race';
import { curDash, setSettings, settings, type RaceRun, type Trip } from './settings';
import { exportCsv } from './share';
import { createStore } from './store';
import { clearValues, setVal, V, val } from './values';
import { WheelCheck } from './wheels';

export type Page = 'dash' | 'race' | 'live' | 'graph' | 'diag';

export const session = createStore({
  state: 'idle' as 'idle' | 'connecting' | 'connected',
  status: msg('st.idle') as Msg,
  hz: 0,
  info: null as ElmInfo | null,
  picker: null as FoundDevice[] | null,
  recording: false,
});

export const diag = createStore({
  busy: false,
  status: null as StatusResult | null,
  dtc: null as DtcResult | null,
  vin: null as string | null,
  scanned: false,
});

export const elm = new Elm();
let page: Page = 'dash';
let hudOn = false;

// ---------- Log ----------
export const logLines: string[] = [];
export const logStore = createStore({n: 0});
export function log(s: string) {
  logLines.push(new Date().toLocaleTimeString() + ' ' + s);
  if (logLines.length > 400) logLines.shift();
  logStore.set({n: logStore.get().n + 1});
}
elm.onLog = log;
elm.onStatus = m => session.set({status: m});

// ---------- ค่าที่ต้องอ่าน ----------
const supportedPid = (id: string) => session.get().state !== 'connected' || !SRC[id]?.mode1 || elm.info.supported.has(id);
/** 5B ที่รถไม่ส่งแต่อ่านจากกล่องแบต BMW แทนได้ ถือว่ารองรับ */
export const isSupported = (id: string) => supportedPid(id) || (id === '5B' && hv5B());
const fuelSrc = () => (elm.info.supported.has('5E') ? '5E' : '10');

/** รถไม่ส่ง PID 5B (แบตไฮบริด) แต่เป็น BMW ที่ใช้ CAN → อ่านจากกล่องแบตแทน แล้วแสดงในช่อง 5B เดิม */
const hv5B = () => !elm.info.supported.has('5B') && isBmwCan();
const isBmwCan = () => elm.info.proto.endsWith('6');

function expand(id: string, out: Set<string>) {
  const s = SRC[id];
  if (!s) return;
  if (id === '5B' && hv5B()) { out.add('HVSOC'); return; }
  if (!s.calc) { out.add(id); return; }
  for (const n of s.need ?? []) out.add(n === 'FUEL' ? fuelSrc() : n);
}

function wantList(): string[] {
  const out = new Set<string>(['0D', fuelSrc()]);
  const cfg = settings.get();
  if (hudOn || page === 'race' || cfg.shiftBeep) { out.add('0C'); }
  if (page === 'dash') for (const w of curDash(cfg).widgets) expand(w.id, out);
  if (page === 'live') {
    for (const id of elm.info.supported) if (SRC[id]) out.add(id);
    out.add('RV');
    if (isBmwCan()) for (const s of Object.values(SRC)) if (s.bmw) out.add(s.id);
  }
  if (page === 'graph') for (const id of cfg.graph) expand(id, out);
  if (page === 'graph' && hv5B() && out.has('5B')) out.add('HVSOC');
  return [...out].filter(id => SRC[id] && (!SRC[id].mode1 || elm.info.supported.has(id)));
}

function period(id: string): number {
  if (page === 'race' || hudOn) return id === '0D' || id === '0C' ? 0 : 3000;
  // เสียงเตือนเปลี่ยนเกียร์ต้องรู้รอบเร็วๆ ทุกหน้า → ให้รอบได้คิวก่อน (ค่าติดลบ = ถึงคิวเร็วกว่าตัวอื่น)
  // ยิ่งใกล้จุดเปลี่ยนเกียร์ยิ่งอ่านถี่ (เกือบทุกจังหวะ) ตอนรอบต่ำไม่ต้องแย่งคิวค่าอื่นมาก
  if (id === '0C' && settings.get().shiftBeep) return (V['0C']?.v ?? 0) > settings.get().shiftRpm - 1500 ? -5000 : -400;
  if (page === 'live') return id === 'RV' ? 2000 : 0;
  const s = SRC[id];
  if (id === 'RV' || id === '33' || s.cat === 'info') return 4000;
  if (s.fast) return 0;
  if (s.cat === 'temp' || id === '2F') return 2000;
  return 400;
}

export function setPage(p: Page) { page = p; poll.listT = 0; }
export function setHud(on: boolean) { hudOn = on; poll.listT = 0; }

// ---------- วนอ่านค่า ----------
const poll = {last: {} as Record<string, number>, back: {} as Record<string, number>, n: 0, hzT: 0, list: [] as string[], listT: 0};

async function pollLoop() {
  poll.hzT = now();
  while (elm.connected) {
    const job = jobs.shift();
    if (job) { await job(); bmw.method = null; continue; }
    if (wheels.get().on || bmw.active) { await wheelStep(); continue; }
    const t = now();
    if (t - poll.listT > 500) { poll.list = wantList(); poll.listT = t; }
    const bmwIds = poll.list.filter(id => SRC[id].bmw);
    if (bmwIds.length && t - hv.lastT > HV_PERIOD) { hv.lastT = t; await hvCycle(bmwIds); continue; }
    let best: string | null = null, bs = -Infinity;
    for (const id of poll.list) {
      if (SRC[id].bmw) continue;
      if ((poll.back[id] || 0) > t) continue;
      const due = t - (poll.last[id] || 0) - period(id);
      if (due > bs) { bs = due; best = id; }
    }
    if (!best || bs < 0) { await new Promise(r => setTimeout(r, 30)); continue; }
    poll.last[best] = t;
    const r = await elm.read(SRC[best] as Source);
    if (r === 'NODATA') { poll.back[best] = now() + 5000; if (V[best]) V[best].stale = true; }
    else if (r) { setVal(best, r.v, r.t); onSample(best, r.v, r.t); }
    poll.n++;
    const el = now() - poll.hzT;
    if (el > 1000) { session.set({hz: (poll.n * 1000) / el}); poll.n = 0; poll.hzT = now(); }
  }
}

// ---------- ค่าคำนวณ / ทริป ----------
const spdWin: [number, number][] = [];
let lastSpd: { v: number; t: number } | null = null;
let tripSaveT = 0, tripLoaded = false;
export const trip: Trip = {...settings.get().trip};
settings.subscribe(() => {
  // ค่าทริปที่เก็บไว้โหลดเสร็จหลังเริ่มแอพ
  const s = settings.get();
  if (s.loaded && !tripLoaded) { tripLoaded = true; Object.assign(trip, s.trip); }
});

export function lph(): number | null {
  const e = val('5E');
  if (e != null) return e;
  const maf = val('10');
  if (maf == null) return null;
  return settings.get().fuel === 'diesel' ? (maf * 3600) / (14.5 * 832) : (maf * 3600) / (14.7 * 745);
}

// ---------- เกียร์ ----------
export const gear = new GearEstimator(settings.get().gearHist);
let gearLoaded = false, gearSaveT = 0;
settings.subscribe(() => {
  const s = settings.get();
  if (s.loaded && !gearLoaded) { gearLoaded = true; if (s.gearHist) { gear.hist = s.gearHist.slice(); gear.findGears(); } }
});
function gearSample(t: number) {
  const a4 = val('A4', 1500);
  if (a4 != null && a4 >= 0) { setVal('GEAR', a4, t); return; }
  // รอบกับความเร็วอ่านคนละจังหวะ → ประมาณทั้งสองค่า ณ เวลาเดียวกันจาก 2 ค่าล่าสุด
  const rpm = valueAt('0C', t), sp = valueAt('0D', t);
  if (rpm == null || sp == null) return;
  setVal('GEAR', gear.update(rpm, Math.max(0, sp)), t);
  if (t - gearSaveT > 30000) { gearSaveT = t; gear.findGears(); setSettings({gearHist: gear.hist.slice()}); }
}
function valueAt(id: string, t: number): number | null {
  const h = V[id]?.hist;
  const b = h?.[h.length - 1];
  if (!b || t - b[0] > 1500) return null;
  const a = h![h!.length - 2];
  if (!a || b[0] - a[0] > 1500 || b[0] <= a[0]) return b[1];
  return b[1] + ((b[1] - a[1]) * (t - b[0])) / (b[0] - a[0]);
}
export function resetGear() { gear.reset(); setSettings({gearHist: null}); }

export function resetTrip() {
  Object.assign(trip, {dist: 0, time: 0, fuel: 0, max: 0});
  setSettings({trip: {...trip}});
}

function onSample(id: string, v: number, t: number) {
  if (id === '0D') {
    if (lastSpd) {
      const dt = (t - lastSpd.t) / 1000;
      if (dt > 0 && dt < 5) {
        trip.dist += (((v + lastSpd.v) / 2) * dt) / 3600;
        trip.time += dt;
        const f = lph();
        if (f != null) trip.fuel += (f * dt) / 3600;
        if (v > trip.max) trip.max = v;
      }
    }
    lastSpd = {v, t};
    spdWin.push([t, v]);
    while (spdWin.length > 2 && spdWin[0][0] < t - 800) spdWin.shift();
    if (spdWin.length >= 2) {
      const a = spdWin[0], b = spdWin[spdWin.length - 1];
      if (b[0] > a[0]) setVal('ACC', (b[1] - a[1]) / 3.6 / ((b[0] - a[0]) / 1000) / 9.81, t);
    }
    race.update(v, t, {rpm: val('0C', 1500), acc: val('ACC', 1500)});
    if (t - tripSaveT > 10000) { tripSaveT = t; setSettings({trip: {...trip}}); }
    setVal('TDIST', trip.dist, t); setVal('TTIME', trip.time, t); setVal('TMAX', trip.max, t);
    setVal('TAVG', trip.time > 5 ? trip.dist / (trip.time / 3600) : 0, t);
    setVal('TFUEL', trip.fuel, t);
    if (trip.fuel > 0.01) setVal('TKML', trip.dist / trip.fuel, t);
  }
  if (id === '0C') shiftCheck(v);
  if (id === '0C' || id === '0D' || id === 'A4') gearSample(t);
  const f = lph();
  if (f != null) setVal('LPH', f, t);
  const sp = val('0D');
  if (f != null && sp != null) {
    setVal('KML', sp < 1 ? 0 : Math.min(99, sp / Math.max(f, 0.05)), t);
    if (sp >= 3) setVal('L100', Math.min(99, (f / sp) * 100), t);
  }
  const map = val('0B');
  if (map != null) setVal('BOOST', (map - (val('33', 60000) ?? 101.3)) / 100, t);
  const maf = val('10');
  if (maf != null) setVal('POW', maf * 1.32, t);
}

// เสียงเตือนเปลี่ยนเกียร์: ตี๊ดดดค้างไว้ตลอดที่รอบยังเกินจุดเปลี่ยนเกียร์ เงียบทันทีที่เปลี่ยนเกียร์ (รอบตก)
// ถ้าค่ารอบไม่เข้ามาเกิน 2 วิ (หลุดการเชื่อมต่อ) ให้หยุดเอง จะได้ไม่ค้าง
let shiftStopT: ReturnType<typeof setTimeout> | undefined;
let aboveShift = false;
export function stopShiftTone() { clearTimeout(shiftStopT); aboveShift = false; toneOff(); }
function shiftCheck(rpm: number) {
  const s = settings.get();
  if (!s.shiftBeep || rpm < s.shiftRpm - 100) { if (aboveShift) stopShiftTone(); return; }
  if (rpm < s.shiftRpm && !aboveShift) return;
  if (!aboveShift) { aboveShift = true; buzz(120); toneOn('shiftLoop'); }
  clearTimeout(shiftStopT);
  shiftStopT = setTimeout(stopShiftTone, 2000);
}

// ---------- ความเร็ว 4 ล้อ (กล่อง DSC ของ BMW) ----------
// ระหว่างเปิดหน้านี้ตัวเสียบถูกตั้งให้คุยกับกล่อง DSC → หยุดอ่านค่า OBD ปกติไว้ก่อน แล้วคืนค่าเมื่อออก
export const wheels = createStore({
  on: false,
  state: 'idle' as 'idle' | 'setup' | 'ok' | 'noreply' | 'nodid' | 'notcan',
  method: null as Method | null,
  hz: 0,
});
export const wheelCheck = new WheelCheck();
const bmw = {active: false, method: null as Method | null, retryT: 0, fails: 0, n: 0, hzT: 0};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function startWheels() {
  wheelCheck.reset(); wheelCheck.last = null;
  Object.assign(bmw, {retryT: 0, fails: 0});
  stopShiftTone();
  wheels.set({on: true, state: session.get().state === 'connected' ? 'setup' : 'idle', hz: 0});
}
export function stopWheels() { wheels.set({on: false}); }

async function wheelStep() {
  if (!wheels.get().on) {
    if (bmw.active) { await bmwRestore(elm); log('BMW mode off'); }
    Object.assign(bmw, {active: false, method: null});
    wheels.set({state: 'idle', method: null, hz: 0});
    poll.listT = 0;
    return;
  }
  if (!bmw.method) {
    // F/G-series ใช้ CAN 11 bit 500k (โปรโตคอล 6)
    if (!elm.info.proto.endsWith('6')) { wheels.set({state: 'notcan'}); await sleep(500); return; }
    if (bmw.retryT > now()) { await sleep(200); return; }
    bmw.active = true;
    wheels.set({state: 'setup'});
    const r = await bmwProbe(elm, DSC, DID_WHEELS, log);
    if (r && 'data' in r) {
      Object.assign(bmw, {method: r.method, fails: 0, n: 0, hzT: now()});
      wheels.set({state: 'ok', method: r.method});
      gotWheels(r.data);
    } else {
      // กล่องไม่ตอบ (สวิตช์ยังไม่ ON / ตัวเสียบไม่รองรับ) → ลองใหม่ทุก 5 วิ · กล่องตอบว่าไม่มีค่านี้ → ไม่ต้องลองซ้ำ
      wheels.set({state: r ? 'nodid' : 'noreply'});
      bmw.retryT = now() + (r ? 1e12 : 5000);
    }
    return;
  }
  const r = await bmwRead(elm, bmw.method, DSC, DID_WHEELS);
  if (r && 'data' in r) { bmw.fails = 0; gotWheels(r.data); }
  else if (++bmw.fails >= 5) { bmw.method = null; log('BMW DSC: lost, probing again'); }
  const el = now() - bmw.hzT;
  if (el > 1000) { wheels.set({hz: (bmw.n * 1000) / el}); bmw.n = 0; bmw.hzT = now(); }
}

function gotWheels(d: number[]) {
  const w = decodeWheels(d);
  if (!w) return;
  bmw.n++;
  wheelCheck.update(w, now());
}

// ---------- ค่าเฉพาะ BMW (แบตไฮบริด / แบต 12V) ----------
// ทุก HV_PERIOD: ตั้งตัวเสียบคุยกับกล่องทีละกล่อง อ่านทุกค่าที่ต้องการของกล่องนั้น แล้วคืนค่าเป็น OBD-II ปกติ
const HV_PERIOD = 2000;
export const hvState = createStore({state: 'idle' as 'idle' | 'ok' | 'noreply' | 'notcan'});
const hv = {
  lastT: 0, probeT: 0,
  /** วิธีคุยกับกล่องที่ตัวเสียบนี้ใช้ได้ (หาครั้งแรกแล้วจำไว้) */
  method: null as Method | null,
  /** ที่มาที่กำลังใช้ของแต่ละค่า (index ใน SRC[id].bmw) */
  alt: {} as Record<string, number>,
  /** "ecu:did" ที่ไม่ต้องอ่าน: เวลาที่จะลองใหม่ */
  skip: {} as Record<string, number>,
};
function hvReset() { Object.assign(hv, {lastT: 0, probeT: 0, method: null, alt: {}, skip: {}}); hvState.set({state: 'idle'}); }

async function hvCycle(ids: string[]) {
  if (!isBmwCan()) { hvState.set({state: 'notcan'}); return; }
  const t = now();
  // กล่อง → did → ค่าที่ได้จาก did นั้น
  const plan = new Map<number, Map<string, string[]>>();
  for (const id of ids) {
    const alts = SRC[id].bmw!;
    const a = alts[hv.alt[id] ?? 0];
    if ((hv.skip[a.ecu + ':' + a.did] ?? 0) > t) continue;
    if (!plan.has(a.ecu)) plan.set(a.ecu, new Map());
    const m = plan.get(a.ecu)!;
    m.set(a.did, [...(m.get(a.did) ?? []), id]);
  }
  if (!plan.size) return;
  if (!hv.method) {
    if (hv.probeT > t) return;
    const [ecu, dids] = plan.entries().next().value!;
    const did = dids.keys().next().value!;
    const r = await bmwProbe(elm, ecu, did, log);
    if (!r) { await bmwRestore(elm); hv.probeT = now() + 10000; hvState.set({state: 'noreply'}); return; }
    hv.method = r.method;
  }
  const m = hv.method;
  let any = false;
  for (const [ecu, dids] of plan) {
    if (!elm.connected) return;
    if (!(await bmwSetup(elm, m, ecu))) { hv.method = null; break; }
    for (const [did, wants] of dids) {
      const r = await bmwRead(elm, m, ecu, did);
      const key = ecu + ':' + did;
      if (r && 'data' in r) {
        any = true;
        const tt = now();
        for (const id of wants) {
          const v = SRC[id].bmw![hv.alt[id] ?? 0].f(r.data);
          if (v == null) continue;
          setVal(id, v, tt);
          if (id === 'HVSOC' && hv5B()) setVal('5B', v, tt);
        }
      } else {
        // NRC = กล่องไม่มีค่านี้ → ไม่ต้องถามอีก และเปลี่ยนไปใช้ที่มาถัดไป · ไม่ตอบ = กล่องหลับ/ไม่มีกล่องนี้ → ลองใหม่ทีหลัง
        hv.skip[key] = now() + (r ? 1e12 : 15000);
        for (const id of wants) {
          const n = SRC[id].bmw!.length;
          if (n > 1) hv.alt[id] = ((hv.alt[id] ?? 0) + 1) % n;
          if (V[id]) V[id].stale = true;
        }
        log(`BMW ${ecu.toString(16)} ${did}: ${r ? 'not supported' : 'no reply'}`);
      }
    }
  }
  await bmwRestore(elm);
  if (any) hvState.set({state: 'ok'});
}

// ---------- งานที่ต้องหยุดอ่านค่าปกติชั่วคราว (รันในลูปอ่านค่า จะได้ไม่ส่งคำสั่งแทรกกัน) ----------
const jobs: (() => Promise<void>)[] = [];
function runJob<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((res, rej) => { jobs.push(() => fn().then(res, rej)); });
}

// ---------- รหัสข้อผิดพลาดเฉพาะ BMW (ทุกกล่อง) ----------
export interface EcuDtc { ecu: number; name: string | null; codes: BmwDtc[]; }
export const bmwDiag = createStore({
  busy: false,
  scanned: false,
  /** กล่องที่สแกนอยู่ (แสดงความคืบหน้า) */
  at: '' as string,
  ecus: [] as EcuDtc[],
  err: null as 'notcan' | 'noreply' | null,
  cleared: null as number | null,
});

async function ensureMethod(): Promise<Method | null> {
  if (hv.method) return hv.method;
  // ถามรหัส VIN จากกล่องเครื่องยนต์ — ทุกกล่อง UDS ต้องมี
  const r = await bmwProbe(elm, 0x12, 'F190', log);
  if (r) hv.method = r.method;
  return hv.method;
}

export function bmwDtcScan(): Promise<void> {
  if (!elm.connected || bmwDiag.get().busy) return Promise.resolve();
  bmwDiag.set({busy: true, err: null, at: '', cleared: null});
  return runJob(async () => {
    try {
      if (!isBmwCan()) { bmwDiag.set({err: 'notcan'}); return; }
      const m = await ensureMethod();
      if (!m) { bmwDiag.set({err: 'noreply'}); return; }
      const found: EcuDtc[] = [];
      for (const e of ECUS) {
        if (!elm.connected) break;
        bmwDiag.set({at: e.name ?? '0x' + e.ecu.toString(16).toUpperCase().padStart(2, '0')});
        if (!(await bmwSetup(elm, m, e.ecu))) continue;
        const codes = parseDtc19(await bmwReq(elm, m, e.ecu, DTC_REQ, 5000));
        if (codes) found.push({...e, codes});
      }
      found.sort((a, b) => b.codes.length - a.codes.length);
      bmwDiag.set({ecus: found, scanned: true, err: found.length ? null : 'noreply'});
      log(`BMW DTC scan: ${found.length} modules, ${found.reduce((n, e) => n + e.codes.length, 0)} codes`);
    } finally {
      await bmwRestore(elm);
      bmwDiag.set({busy: false, at: ''});
    }
  });
}

/** ล้างรหัสในทุกกล่องที่ตอบตอนสแกน (UDS 14 FFFFFF) แล้วสแกนใหม่ · คืนจำนวนกล่องที่ล้างสำเร็จ */
export async function bmwDtcClear(): Promise<number> {
  if (!elm.connected || bmwDiag.get().busy) return 0;
  const targets = bmwDiag.get().ecus.filter(e => e.codes.length);
  bmwDiag.set({busy: true});
  const n = await runJob(async () => {
    let ok = 0;
    try {
      const m = await ensureMethod();
      if (!m) return 0;
      for (const e of targets) {
        bmwDiag.set({at: e.name ?? '0x' + e.ecu.toString(16).toUpperCase()});
        if (!(await bmwSetup(elm, m, e.ecu))) continue;
        const r = await bmwReq(elm, m, e.ecu, CLEAR_REQ, 6000);
        if (r && r[0] === 0x54) ok++;
      }
    } finally { await bmwRestore(elm); bmwDiag.set({busy: false, at: ''}); }
    return ok;
  });
  await new Promise(r => setTimeout(r, 800));
  await bmwDtcScan();
  bmwDiag.set({cleared: n});
  return n;
}

// ---------- จับเวลา ----------
export const race = new Race(settings.get().raceMode, {
  onReady: () => beep(990),
  onStart: () => { beep(1200); buzz(80); },
  onFinish: r => {
    const s = settings.get();
    const sim = !!session.get().info?.sim;
    const prevBest = bestRun(r.mode);
    const best = !sim && (!prevBest || r.time < prevBest.time);
    if (best) race.msg = msg('race.record');
    setSettings({runs: [{...r, at: Date.now(), sim}, ...s.runs].slice(0, 200)});
    beep(1600, best ? 3 : 2);
    buzz([100, 60, 100]);
  },
});
export function bestRun(mode: string) {
  let b: RaceRun | null = null;
  for (const r of settings.get().runs) if (r.mode === mode && !r.sim && (!b || r.time < b.time)) b = r;
  return b;
}

// ---------- เชื่อมต่อ ----------
let pickResolve: ((d: FoundDevice | null) => void) | null = null;
export function pickDevice(d: FoundDevice | null) {
  session.set({picker: null});
  const r = pickResolve; pickResolve = null; r?.(d);
}

async function openTransport(mode: 'ble' | 'sim'): Promise<Transport> {
  if (mode === 'sim') return createSimTransport();
  const saved = settings.get().device;
  if (saved) {
    session.set({status: msg('st.connectingTo', {name: saved.name})});
    try { return await openBle(saved.id, saved.name, 10000); }
    catch (e) { log('saved adapter failed: ' + (e as Error).message); }
    session.set({status: msg('st.savedFailed')});
  }
  session.set({status: msg('st.scanning')});
  const list = await scanDevices(5000);
  if (!list.length) throw new AppError('err.noDevice');
  const d = await new Promise<FoundDevice | null>(res => { pickResolve = res; session.set({picker: list, status: msg('st.pick')}); });
  if (!d) throw new AppError('err.cancelled');
  session.set({status: msg('st.connectingTo', {name: d.name || d.id})});
  const t = await openBle(d.id, d.name, 12000);
  setSettings({device: {id: d.id, name: d.name || d.id}});
  return t;
}

export async function connect(mode: 'ble' | 'sim' = 'ble') {
  const st = session.get().state;
  if (st === 'connecting') return;
  if (st === 'connected') { elm.close(); return; }
  session.set({state: 'connecting'});
  try {
    const t = await openTransport(mode);
    const info = await elm.open(t, mode === 'sim');
    clearValues();
    Object.assign(poll, {last: {}, back: {}, listT: 0});
    lastSpd = null;
    race.reset();
    diag.set({status: null, dtc: null, vin: null, scanned: false});
    bmwDiag.set({ecus: [], scanned: false, err: null, cleared: null});
    hvReset();
    jobs.length = 0;
    session.set({state: 'connected', info, status: msg('st.connected', {name: info.name + (info.sim ? '' : ' · ' + info.elm)})});
    if (wheels.get().on) startWheels();
    pollLoop();
  } catch (e) {
    session.set({state: 'idle', status: msg('st.failed', {err: (e as Error).message})});
    log('ERR ' + (e as Error).message);
  }
}

export function disconnect() { elm.close(); }

elm.onLost = () => {
  if (session.get().state === 'connecting') return;
  if (rec) stopRec();
  stopShiftTone();
  race.reset();
  Object.assign(bmw, {active: false, method: null});
  hvReset();
  // งานที่ค้างอยู่ (สแกนรหัส BMW) ให้จบไปเลย ไม่ต้องรอ
  for (const j of jobs.splice(0)) j();
  if (wheels.get().on) wheels.set({state: 'idle', method: null, hz: 0});
  setSettings({trip: {...trip}, gearHist: gear.hist.slice()});
  session.set({state: 'idle', hz: 0, status: msg('st.disconnected')});
};

export function forgetDevice() { setSettings({device: null}); }

// ---------- ตรวจเช็ค ----------
export async function diagScan() {
  if (!elm.connected || diag.get().busy) return;
  diag.set({busy: true});
  try {
    const status = await elm.readStatus();
    const dtc = await elm.readDtc();
    const vin = diag.get().vin ?? (await elm.readVin());
    diag.set({status, dtc, vin, scanned: true});
  } finally { diag.set({busy: false}); }
}
export async function diagClear(): Promise<boolean> {
  const ok = await elm.clearDtc();
  await new Promise(r => setTimeout(r, 500));
  await diagScan();
  return ok;
}

// ---------- บันทึกข้อมูล (CSV) ----------
let rec: { t0: number; start: Date; rows: Record<string, number>[]; cols: Set<string>; timer: ReturnType<typeof setInterval> } | null = null;
export const recStart = () => rec?.t0 ?? 0;

export function startRec() {
  if (!elm.connected || rec) return;
  const r = {t0: now(), start: new Date(), rows: [] as Record<string, number>[], cols: new Set<string>(),
    timer: setInterval(() => {
      const row: Record<string, number> = {t: (now() - r.t0) / 1000};
      for (const id in V) { const v = val(id, 2000); if (v != null) { row[id] = v; r.cols.add(id); } }
      r.rows.push(row);
      if (r.rows.length > 72000) stopRec();
    }, 250)};
  rec = r;
  session.set({recording: true});
}

export async function stopRec() {
  const r = rec;
  if (!r) return;
  rec = null;
  clearInterval(r.timer);
  session.set({recording: false});
  const cols = [...r.cols];
  const csv = ['time_s,' + cols.map(id => `"${SRC[id].name} (${SRC[id].unit})"`).join(',')]
    .concat(r.rows.map(row => row.t.toFixed(2) + ',' + cols.map(id => (row[id] == null ? '' : +row[id].toFixed(4))).join(',')))
    .join('\n');
  const d = r.start, p = (n: number) => String(n).padStart(2, '0');
  const name = `obd-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  try { await exportCsv(name, '﻿' + csv); }
  catch (e) { log('ERR save file: ' + (e as Error).message); }
}
