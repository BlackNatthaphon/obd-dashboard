// เว็บไม่มี react-native-ble-plx — ใช้ได้แค่โหมดจำลอง
import type { Transport } from './elm';

export interface FoundDevice { id: string; name: string; rssi: number; obd: boolean; }

export const BLE_AVAILABLE = false;

export async function scanDevices(): Promise<FoundDevice[]> {
  throw new Error('เวอร์ชันเว็บต่อ Bluetooth ไม่ได้ — ใช้แอพบนมือถือ หรือลองโหมดจำลอง');
}

export async function openBle(): Promise<Transport> {
  throw new Error('เวอร์ชันเว็บต่อ Bluetooth ไม่ได้');
}
