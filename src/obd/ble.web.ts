// เว็บไม่มี react-native-ble-plx — ใช้ได้แค่โหมดจำลอง
import { AppError } from '../i18n';
import type { Transport } from './elm';

export interface FoundDevice { id: string; name: string; rssi: number; obd: boolean; }

export const BLE_AVAILABLE = false;

export async function scanDevices(): Promise<FoundDevice[]> {
  throw new AppError('err.web');
}

export async function openBle(): Promise<Transport> {
  throw new AppError('err.web');
}
