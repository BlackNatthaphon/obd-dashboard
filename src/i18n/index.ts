// แปลภาษา: t('key', {var}) — ไม่ขึ้นกับ React Native จึงใช้ได้ทั้งใน core และ test
// เพิ่มภาษาใหม่: สร้างไฟล์แบบ en.ts แล้วเพิ่มใน DICTS และ LANGS
import en from './en';
import th from './th';

export type Key = keyof typeof th;
export type Dict = Record<Key, string>;
export type Lang = 'th' | 'en';
export type Vars = Record<string, string | number>;
/** ข้อความที่แปลทีหลังได้ (เก็บใน state แล้วแปลตอนแสดงผล) */
export interface Msg { k: Key; v?: Vars }

const DICTS: Record<Lang, Dict> = {th, en};
export const LANGS: { id: Lang; name: string }[] = [{id: 'th', name: 'ไทย'}, {id: 'en', name: 'English'}];

let cur: Lang = 'th';
export const getLang = () => cur;
export function setLang(l: Lang) { cur = DICTS[l] ? l : 'en'; }
/** ภาษาที่ใช้จริงจากรหัสภาษาของเครื่อง */
export const pickLang = (code: string | null | undefined): Lang => (code && code in DICTS ? (code as Lang) : 'en');

export function t(key: Key, vars?: Vars): string {
  let s: string = DICTS[cur][key] ?? th[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}
export const tm = (m: Msg | null | undefined) => (m ? t(m.k, m.v) : '');
export const msg = (k: Key, v?: Vars): Msg => ({k, v});

export const locale = () => (cur === 'th' ? 'th-TH' : 'en-US');

/** ข้อผิดพลาดที่แปลตามภาษาปัจจุบัน */
export class AppError extends Error {
  constructor(key: Key, vars?: Vars) { super(t(key, vars)); }
}
