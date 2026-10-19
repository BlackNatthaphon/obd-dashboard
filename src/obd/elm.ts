// โปรโตคอล ELM327: คิวคำสั่ง, ตั้งค่า, อ่านค่า, รหัสข้อผิดพลาด (ไม่ขึ้นกับว่าต่อผ่านอะไร)
import { AppError, msg, type Key, type Msg } from '../i18n';
import type { Source } from './catalog';

export const now = (): number => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/** ช่องทางรับส่งข้อความกับตัวเสียบ (BLE หรือรถจำลอง) */
export interface Transport {
  name: string;
  write(text: string): void;
  close(): void;
  /** ตั้งโดย Elm */
  onData?: (text: string) => void;
  onClose?: () => void;
}

export type Lines = string[] & { t0: number; t1: number };

export interface ElmInfo {
  name: string;
  elm: string;
  proto: string;
  isCan: boolean;
  /** ใช้ "1" ท้ายคำสั่งให้ตอบทันที */
  count: boolean;
  supported: Set<string>;
  sim: boolean;
}

export interface DtcResult { stored: string[]; pending: string[]; perm: string[]; }
export interface Monitor { key: Key; ok: boolean; }
export interface StatusResult { mil: boolean; count: number; diesel: boolean; mon: Monitor[]; }
export type ReadResult = { v: number; t: number } | 'NODATA' | null;

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const hexOf = (lines: string[]) => lines.map(l => l.replace(/\s/g, '').toUpperCase());

/** หาไบต์ข้อมูลของ Mode 01 จากคำตอบ */
export function parse01(lines: string[], pid: string, n: number): number[] | null {
  const want = '41' + pid;
  for (const h of hexOf(lines)) {
    const i = h.indexOf(want);
    if (i < 0) continue;
    const bytes: number[] = [];
    for (let j = i + 4; j + 1 < h.length && bytes.length < n; j += 2) bytes.push(parseInt(h.substr(j, 2), 16));
    if (bytes.length === n && !bytes.some(isNaN)) return bytes;
  }
  return null;
}

export function decodeDtc(a: number, b: number): string {
  return ('PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16) + (b >> 4).toString(16) + (b & 15).toString(16)).toUpperCase();
}

/** แยกรหัสจากคำตอบ Mode 03/07/0A (รองรับ CAN หลายเฟรมและหลาย ECU) */
export function parseDtc(lines: string[], resp: string, isCan: boolean): string[] {
  if (lines.join().match(/NO ?DATA/)) return [];
  const msgs: string[] = [];
  for (let l of hexOf(lines)) {
    const cont = /^[1-9A-F]:/.test(l);
    l = l.replace(/^[0-9A-F]:/, '');
    if (/^[0-9A-F]{3}$/.test(l)) continue;                 // บรรทัดบอกความยาว (multi-frame)
    if (!cont && l.startsWith(resp)) msgs.push(l.slice(2 + (isCan ? 2 : 0)));
    else if (msgs.length) msgs[msgs.length - 1] += l;
  }
  const codes: string[] = [];
  for (const h of msgs)
    for (let j = 0; j + 3 < h.length; j += 4) {
      const a = parseInt(h.substr(j, 2), 16), b = parseInt(h.substr(j + 2, 2), 16);
      if (isNaN(a) || isNaN(b) || (a === 0 && b === 0)) continue;
      codes.push(decodeDtc(a, b));
    }
  return [...new Set(codes)];
}

export function parseVin(lines: string[]): string | null {
  let s = '';
  for (let l of hexOf(lines)) {
    l = l.replace(/^[0-9A-F]:/, '');
    if (/^[0-9A-F]{3}$/.test(l)) continue;
    const i = l.indexOf('4902');
    s += i >= 0 ? l.slice(i + 6) : l;
  }
  let txt = '';
  for (let j = 0; j + 1 < s.length; j += 2) {
    const c = parseInt(s.substr(j, 2), 16);
    if (c >= 48 && c <= 90) txt += String.fromCharCode(c);
  }
  return txt.length >= 17 ? txt.slice(-17) : txt || null;
}

export function parseStatus(b: number[]): StatusResult {
  const [A, B, C, D] = b;
  const mon: Monitor[] = [];
  const add = (key: Key, sup: number, inc: number) => { if (sup) mon.push({key, ok: !inc}); };
  add('mon.misfire', B & 1, B & 16);
  add('mon.fuel', B & 2, B & 32);
  add('mon.components', B & 4, B & 64);
  const keys: (Key | '')[] = !(B & 8)
    ? ['mon.cat', 'mon.heatedCat', 'mon.evap', 'mon.air', 'mon.ac', 'mon.o2', 'mon.o2heater', 'mon.egr']
    : ['mon.nmhc', 'mon.nox', '', 'mon.boost', '', 'mon.exhaust', 'mon.pm', 'mon.egr'];
  keys.forEach((k, i) => k && add(k, C & (1 << i), D & (1 << i)));
  return {mil: !!(A & 0x80), count: A & 0x7f, diesel: !!(B & 8), mon};
}

export class Elm {
  private link: Transport | null = null;
  private buf = '';
  private pending: { res: (out: string) => void; t: ReturnType<typeof setTimeout> } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  info: ElmInfo = {name: '', elm: '', proto: '', isCan: true, count: false, supported: new Set(), sim: false};
  verbose = false;
  onLog: (s: string) => void = () => {};
  onStatus: (m: Msg) => void = () => {};
  onLost: () => void = () => {};

  get connected() { return !!this.link; }

  private onText(s: string) {
    this.buf += s;
    const i = this.buf.indexOf('>');
    if (i >= 0 && this.pending) {
      const out = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const p = this.pending; this.pending = null; clearTimeout(p.t); p.res(out);
    }
  }

  private dropPending() {
    if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.t); p.res('DISCONNECTED'); }
  }

  /** ส่งคำสั่งทีละคำสั่งตามคิว คืนบรรทัดคำตอบพร้อมเวลาส่ง/รับ */
  send(cmd: string, timeout = 2500): Promise<Lines> {
    const mk = (r: string[], t0: number) => Object.assign(r, {t0, t1: now()}) as Lines;
    const job = this.chain.then(() => new Promise<Lines>(res => {
      const t0 = now();
      if (!this.link) return res(mk(['DISCONNECTED'], t0));
      this.buf = '';
      this.pending = {
        res: out => {
          const r = String(out).replace(/\r/g, '\n').split('\n').map(s => s.trim())
            .filter(s => s && s !== cmd && !/^SEARCHING/i.test(s));
          if (this.verbose) this.onLog('> ' + cmd + '  ' + r.join(' | '));
          res(mk(r, t0));
        },
        t: setTimeout(() => {
          this.pending = null; this.buf = '';
          this.onLog('> ' + cmd + '  TIMEOUT');
          res(mk(['TIMEOUT'], t0));
        }, timeout),
      };
      try { this.link.write(cmd + '\r'); } catch { this.dropPending(); }
    }));
    this.chain = job.catch(() => {});
    return job;
  }

  /** ต่อกับ transport แล้วตั้งค่า ELM และอ่านรายการค่าที่รถรองรับ */
  async open(t: Transport, sim = false): Promise<ElmInfo> {
    this.link = t;
    this.buf = '';
    t.onData = s => this.onText(s);
    t.onClose = () => this.lost();
    this.info = {name: t.name, elm: '', proto: '', isCan: true, count: false, supported: new Set(), sim};
    try { await this.init(); }
    catch (e) { this.close(false); throw e; }
    return this.info;
  }

  private lost() {
    if (!this.link) return;
    this.link = null;
    this.dropPending();
    this.onLost();
  }

  close(notify = true) {
    const l = this.link;
    if (!l) return;
    this.link = null;
    this.dropPending();
    try { l.close(); } catch { /* ignore */ }
    if (notify) this.onLost();
  }

  private async init() {
    const info = this.info;
    this.onStatus(msg('st.elmSetup'));
    await this.send('ATZ', 6000);
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await this.send(c);
    const at = await this.send('ATAT2');
    if (at.join().includes('?')) await this.send('ATAT1');
    info.elm = (await this.send('ATI'))[0] || '';
    this.onStatus(msg('st.protocol'));
    let first = await this.send('0100', 15000);
    if (!parse01(first, '00', 4)) first = await this.send('0100', 15000);
    const bm = parse01(first, '00', 4);
    if (!bm) throw new AppError('err.noEcu', {resp: first.join(' ')});
    const dp = (await this.send('ATDPN'))[0] || '';
    const n = parseInt(dp.replace('A', ''), 16);
    info.proto = dp;
    info.isCan = n >= 6 && n <= 9;
    // รายการค่าที่รองรับ (0100, 0120, 0140, ...)
    let base = 0, bytes: number[] | null = bm;
    while (bytes) {
      for (let i = 0; i < 32; i++) if (bytes[i >> 3] & (0x80 >> (i & 7))) info.supported.add(hex2(base + i + 1));
      if (!info.supported.has(hex2(base + 0x20)) || base >= 0xc0) break;
      base += 0x20;
      bytes = parse01(await this.send('01' + hex2(base), 4000), hex2(base), 4);
    }
    // CAN: เติม "1" ท้ายคำสั่งให้ตอบทันทีไม่ต้องรอ ECU อื่น (เร็วขึ้นมาก)
    if (info.isCan && info.supported.has('0D')) info.count = !!parse01(await this.send('010D1'), '0D', 1);
    this.onLog(`ELM ${info.elm} · protocol ${dp} · CAN ${info.isCan} · fast ${info.count} · ${info.supported.size} PIDs`);
  }

  async read(src: Source): Promise<ReadResult> {
    if (src.mode1 && src.cmd && src.f && src.n) {
      const r = await this.send(src.cmd + (this.info.count ? '1' : ''));
      const b = parse01(r, src.id, src.n);
      if (!b) return r.join().match(/NO ?DATA|\?/) ? 'NODATA' : null;
      return {v: src.f(b), t: (r.t0 + r.t1) / 2};
    }
    if (!src.cmd || !src.parse) return null;
    const r = await this.send(src.cmd);
    const v = src.parse(r);
    return v == null ? null : {v, t: (r.t0 + r.t1) / 2};
  }

  async readDtc(): Promise<DtcResult> {
    const c = this.info.isCan;
    return {
      stored: parseDtc(await this.send('03', 8000), '43', c),
      pending: parseDtc(await this.send('07', 8000), '47', c),
      perm: parseDtc(await this.send('0A', 8000), '4A', c),
    };
  }

  async clearDtc(): Promise<boolean> {
    return (await this.send('04', 8000)).join().includes('44');
  }

  async readStatus(): Promise<StatusResult | null> {
    const b = parse01(await this.send('0101', 4000), '01', 4);
    return b ? parseStatus(b) : null;
  }

  async readVin(): Promise<string | null> {
    return parseVin(await this.send('0902', 6000));
  }
}
