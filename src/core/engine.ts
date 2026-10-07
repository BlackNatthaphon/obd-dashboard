// หัวใจของแอพ: เชื่อมต่อ, วนอ่านค่า, คำนวณค่าเพิ่ม, ทริป, จับเวลา, บันทึกข้อมูล
import { AppError, msg, type Msg } from '../i18n';
import { SRC, type Source } from '../obd/catalog';
import { Elm, now, type DtcResult, type ElmInfo, type StatusResult, type Transport } from '../obd/elm';
import { openBle, scanDevices, type FoundDevice } from '../obd/ble';
import { createSimTransport } from '../obd/sim';
import { beep, buzz, toneOff, toneOn } from './feedback';
import { GearEstimator } from './gear';
import { Race } from './race';
import { curDash, setSettings, settings, type RaceRun, type Trip } from './settings';
import { exportCsv } from './share';
import { createStore } from './store';
import { clearValues, setVal, V, val } from './values';

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
export const isSupported = supportedPid;
const fuelSrc = () => (elm.info.supported.has('5E') ? '5E' : '10');

function expand(id: string, out: Set<string>) {
  const s = SRC[id];
  if (!s) return;
  if (!s.calc) { out.add(id); return; }
  for (const n of s.need ?? []) out.add(n === 'FUEL' ? fuelSrc() : n);
}

function wantList(): string[] {
  const out = new Set<string>(['0D', fuelSrc()]);
  const cfg = settings.get();
  if (hudOn || page === 'race' || cfg.shiftBeep) { out.add('0C'); }
  if (page === 'dash') for (const w of curDash(cfg).widgets) expand(w.id, out);
  if (page === 'live') { for (const id of elm.info.supported) if (SRC[id]) out.add(id); out.add('RV'); }
  if (page === 'graph') for (const id of cfg.graph) expand(id, out);
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
    const t = now();
    if (t - poll.listT > 500) { poll.list = wantList(); poll.listT = t; }
    let best: string | null = null, bs = -Infinity;
    for (const id of poll.list) {
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
    session.set({state: 'connected', info, status: msg('st.connected', {name: info.name + (info.sim ? '' : ' · ' + info.elm)})});
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
