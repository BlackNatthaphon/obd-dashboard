// เชื่อมตัวเสียบ ELM327 แบบ Bluetooth LE ผ่าน react-native-ble-plx
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ConnectionPriority, type Characteristic, type Subscription } from 'react-native-ble-plx';
import { b64ToText, textToB64 } from './base64';
import type { Transport } from './elm';

export interface FoundDevice { id: string; name: string; rssi: number; obd: boolean; }

export const BLE_AVAILABLE = true;

let manager: BleManager | null = null;
const mgr = () => (manager ??= new BleManager());

const looksObd = (n: string | null) => !!n && /OBD|LINK|ELM|VGATE|ICAR|KONNWEI|CAR|V-LINK|VEEPEAK/i.test(n);

async function ensureReady() {
  if (Platform.OS === 'android') {
    const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    const perms = v >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const res = await PermissionsAndroid.requestMultiple(perms);
    if (perms.some(p => res[p] !== PermissionsAndroid.RESULTS.GRANTED))
      throw new Error('ต้องอนุญาตสิทธิ์ Bluetooth (อุปกรณ์ใกล้เคียง) ก่อนใช้งาน');
  }
  let state = await mgr().state();
  if (state === 'Unknown' || state === 'Resetting') {
    await new Promise(r => setTimeout(r, 800));
    state = await mgr().state();
  }
  if (state !== 'PoweredOn') throw new Error('กรุณาเปิด Bluetooth');
}

/** สแกนหาอุปกรณ์ BLE รอบๆ ตัว — ชื่อที่ดูเหมือน OBD ขึ้นก่อน */
export async function scanDevices(ms = 5000): Promise<FoundDevice[]> {
  await ensureReady();
  const found = new Map<string, FoundDevice>();
  let err: Error | null = null;
  await mgr().startDeviceScan(null, {allowDuplicates: false}, async (e, d) => {
    if (e) { err = new Error('สแกนไม่สำเร็จ: ' + e.message); return; }
    if (d) found.set(d.id, {id: d.id, name: d.name || d.localName || '', rssi: d.rssi ?? -100, obd: looksObd(d.name || d.localName)});
  });
  await new Promise(r => setTimeout(r, ms));
  await mgr().stopDeviceScan();
  if (err && !found.size) throw err;
  const rank = (d: FoundDevice) => (d.obd ? 0 : d.name ? 1 : 2);
  return [...found.values()].sort((a, b) => rank(a) - rank(b) || b.rssi - a.rssi);
}

const SKIP = /^0000180[01a]-/i;    // service มาตรฐานของระบบ

/** ต่ออุปกรณ์แล้วหาช่องที่มีทั้ง notify และ write */
export async function openBle(id: string, name: string, timeoutMs = 10000): Promise<Transport> {
  await ensureReady();
  const m = mgr();
  const dev = await m.connectToDevice(id, {timeout: timeoutMs});
  if (Platform.OS === 'android') await m.requestConnectionPriorityForDevice(id, ConnectionPriority.High).catch(() => {});
  await dev.discoverAllServicesAndCharacteristics();
  let rx: Characteristic | null = null, tx: Characteristic | null = null;
  for (const s of await dev.services()) {
    if (SKIP.test(s.uuid)) continue;
    let r: Characteristic | null = null, t: Characteristic | null = null;
    for (const c of await s.characteristics()) {
      if (!r && (c.isNotifiable || c.isIndicatable)) r = c;
      if (!t && (c.isWritableWithResponse || c.isWritableWithoutResponse)) t = c;
    }
    if (r && t) { rx = r; tx = t; break; }
  }
  if (!rx || !tx) {
    await m.cancelDeviceConnection(id).catch(() => {});
    throw new Error('อุปกรณ์นี้ไม่ใช่ตัวเสียบ OBD แบบ BLE (ไม่พบช่องรับส่งข้อมูล)');
  }
  const writer = tx;
  const withResp = writer.isWritableWithResponse;
  let closed = false;
  let wq: Promise<unknown> = Promise.resolve();
  const subs: Subscription[] = [];

  const t: Transport = {
    name: name || dev.name || id,
    write(text) {
      for (let i = 0; i < text.length; i += 20) {
        const chunk = textToB64(text.slice(i, i + 20));
        wq = wq.then(() => (withResp ? writer.writeWithResponse(chunk) : writer.writeWithoutResponse(chunk))).catch(() => {});
      }
    },
    close() {
      if (closed) return;
      closed = true;
      subs.forEach(s => s.remove());
      m.cancelDeviceConnection(id).catch(() => {});
    },
  };
  subs.push(rx.monitor((e, c) => { if (!e && c?.value) t.onData?.(b64ToText(c.value)); }));
  subs.push(m.onDeviceDisconnected(id, () => {
    if (closed) return;
    closed = true;
    subs.forEach(s => s.remove());
    t.onClose?.();
  }));
  return t;
}
