// แปลงข้อความ ASCII/Latin-1 <-> base64 (BLE ใน react-native-ble-plx ใช้ base64)
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < A.length; i++) LOOKUP[A[i]] = i;

export function bytesToB64(b: number[] | Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '=') + (i + 2 < b.length ? A[n & 63] : '=');
  }
  return out;
}

export function b64ToBytes(s: string): number[] {
  s = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const n = (LOOKUP[s[i]] << 18) | (LOOKUP[s[i + 1]] << 12) | ((LOOKUP[s[i + 2]] ?? 0) << 6) | (LOOKUP[s[i + 3]] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < s.length) out.push((n >> 8) & 255);
    if (i + 3 < s.length) out.push(n & 255);
  }
  return out;
}

export const textToB64 = (t: string) => bytesToB64([...t].map(c => c.charCodeAt(0) & 255));
export const b64ToText = (s: string) => String.fromCharCode(...b64ToBytes(s));
