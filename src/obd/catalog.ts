// ค่าทั้งหมดที่แอพรู้จัก: OBD-II Mode 01, ค่าจากตัวเสียบ และค่าที่คำนวณเอง
import { getLang, t, type Key } from '../i18n';

export type Category = 'eng' | 'fuel' | 'temp' | 'elec' | 'o2' | 'trip' | 'info';

export const CATEGORIES: Category[] = ['eng', 'fuel', 'temp', 'elec', 'o2', 'trip', 'info'];
export const catName = (c: Category) => t(`cat.${c}` as Key);

export interface Source {
  id: string;
  /** ชื่อภาษาไทย */
  name: string;
  /** ชื่อภาษาอังกฤษ (ใช้กับทุกภาษาที่ไม่ใช่ไทย) */
  en: string;
  unit: string;
  min: number;
  max: number;
  /** ทศนิยม */
  d: number;
  cat: Category;
  /** คำสั่งที่ส่งไปตัวเสียบ (ไม่มีสำหรับค่าคำนวณ) */
  cmd?: string;
  /** Mode 01: จำนวนไบต์และสูตร */
  mode1?: boolean;
  n?: number;
  f?: (a: number[]) => number;
  /** คำสั่ง AT ที่คืนค่าเป็นข้อความ */
  parse?: (lines: string[]) => number | null;
  /** ค่าคำนวณ: ค่าที่ต้องอ่านเพื่อใช้คำนวณ */
  calc?: boolean;
  need?: string[];
  /** อ่านถี่ (ทุกรอบ) */
  fast?: boolean;
  hi?: number;
  lo?: number;
  note?: Key;
  fmt?: (v: number) => string;
}

const w = (a: number[]) => a[0] * 256 + a[1];
const pct = (a: number[]) => (a[0] * 100) / 255;
const trim = (a: number[]) => ((a[0] - 128) * 100) / 128;
const temp = (a: number[]) => a[0] - 40;
const lambda = (a: number[]) => (w(a) * 2) / 65536;

export const SRC: Record<string, Source> = {};

const EN: Record<string, string> = {
  '0C': 'Engine RPM', '0D': 'Speed', '04': 'Engine load', '11': 'Throttle', '0E': 'Timing advance',
  '0B': 'Intake manifold pressure (MAP)', '10': 'Mass air flow (MAF)', '43': 'Absolute load', '45': 'Relative throttle',
  '47': 'Throttle B', '48': 'Throttle C', '49': 'Accelerator pedal D', '4A': 'Accelerator pedal E', '4B': 'Accelerator pedal F',
  '4C': 'Commanded throttle', '5A': 'Relative accelerator pedal', '61': 'Driver demand torque', '62': 'Actual torque',
  '63': 'Reference torque', '1F': 'Run time since start',
  '05': 'Coolant temp', '0F': 'Intake air temp', '46': 'Ambient temp', '5C': 'Oil temp',
  '3C': 'Catalyst temp B1S1', '3D': 'Catalyst temp B2S1', '3E': 'Catalyst temp B1S2', '3F': 'Catalyst temp B2S2',
  '06': 'Short fuel trim B1', '07': 'Long fuel trim B1', '08': 'Short fuel trim B2', '09': 'Long fuel trim B2',
  '0A': 'Fuel pressure', '22': 'Fuel rail pressure (relative)', '23': 'Fuel rail pressure', '59': 'Fuel rail pressure (absolute)',
  '2F': 'Fuel level', '52': 'Ethanol content', '5D': 'Injection timing', '5E': 'Fuel rate (ECU)', '44': 'Commanded lambda',
  '33': 'Barometric pressure', '2C': 'Commanded EGR', '2D': 'EGR error', '2E': 'Commanded EVAP purge',
  '32': 'EVAP vapor pressure', '53': 'EVAP pressure (absolute)', '42': 'ECU voltage', '5B': 'Hybrid battery',
  '21': 'Distance with MIL on', '31': 'Distance since codes cleared', '30': 'Warm-ups since codes cleared',
  '4D': 'Time with MIL on', '4E': 'Time since codes cleared', 'A6': 'Odometer',
  RV: 'Battery (at adapter)', LPH: 'Fuel rate', KML: 'Fuel economy (now)', L100: 'Fuel economy (now)', BOOST: 'Boost',
  ACC: 'G-force (accel/brake)', POW: 'Estimated power', TDIST: 'Trip distance', TTIME: 'Trip time',
  TAVG: 'Trip average speed', TMAX: 'Trip max speed', TFUEL: 'Trip fuel used', TKML: 'Trip average economy',
};

/** ชื่อค่าตามภาษาปัจจุบัน */
export const srcName = (s: Source) => (getLang() === 'th' ? s.name : s.en);

function pid(id: string, name: string, unit: string, min: number, max: number, d: number, n: number,
  f: (a: number[]) => number, cat: Category, extra?: Partial<Source>) {
  SRC[id] = {id, name, en: EN[id] ?? name, unit, min, max, d, n, f, cat, cmd: '01' + id, mode1: true, ...extra};
}

pid('0C', 'รอบเครื่อง', 'rpm', 0, 8000, 0, 2, a => w(a) / 4, 'eng', {fast: true});
pid('0D', 'ความเร็ว', 'km/h', 0, 240, 0, 1, a => a[0], 'eng', {fast: true});
pid('04', 'โหลดเครื่อง', '%', 0, 100, 0, 1, pct, 'eng', {fast: true});
pid('11', 'ลิ้นปีกผีเสื้อ', '%', 0, 100, 0, 1, pct, 'eng', {fast: true});
pid('0E', 'องศาไฟจุดระเบิด', '°', -20, 50, 1, 1, a => a[0] / 2 - 64, 'eng', {fast: true});
pid('0B', 'แรงดันท่อร่วมไอดี (MAP)', 'kPa', 0, 255, 0, 1, a => a[0], 'eng', {fast: true});
pid('10', 'อัตราไหลอากาศ (MAF)', 'g/s', 0, 250, 1, 2, a => w(a) / 100, 'fuel', {fast: true});
pid('43', 'โหลดสัมบูรณ์', '%', 0, 200, 0, 2, a => (w(a) * 100) / 255, 'eng');
pid('45', 'ลิ้นปีกผีเสื้อ (สัมพัทธ์)', '%', 0, 100, 0, 1, pct, 'eng');
pid('47', 'ลิ้นปีกผีเสื้อ B', '%', 0, 100, 0, 1, pct, 'eng');
pid('48', 'ลิ้นปีกผีเสื้อ C', '%', 0, 100, 0, 1, pct, 'eng');
pid('49', 'คันเร่ง D', '%', 0, 100, 0, 1, pct, 'eng', {fast: true});
pid('4A', 'คันเร่ง E', '%', 0, 100, 0, 1, pct, 'eng');
pid('4B', 'คันเร่ง F', '%', 0, 100, 0, 1, pct, 'eng');
pid('4C', 'สั่งเปิดลิ้นปีกผีเสื้อ', '%', 0, 100, 0, 1, pct, 'eng');
pid('5A', 'คันเร่ง (สัมพัทธ์)', '%', 0, 100, 0, 1, pct, 'eng');
pid('61', 'แรงบิดที่ต้องการ', '%', -125, 130, 0, 1, a => a[0] - 125, 'eng');
pid('62', 'แรงบิดจริง', '%', -125, 130, 0, 1, a => a[0] - 125, 'eng');
pid('63', 'แรงบิดอ้างอิง', 'Nm', 0, 1000, 0, 2, w, 'eng');
pid('1F', 'เวลาตั้งแต่ติดเครื่อง', 's', 0, 7200, 0, 2, w, 'eng');

pid('05', 'อุณหภูมิน้ำ', '°C', -40, 130, 0, 1, temp, 'temp', {hi: 105});
pid('0F', 'อุณหภูมิอากาศเข้า', '°C', -40, 80, 0, 1, temp, 'temp', {hi: 60});
pid('46', 'อุณหภูมิภายนอก', '°C', -40, 60, 0, 1, temp, 'temp');
pid('5C', 'อุณหภูมิน้ำมันเครื่อง', '°C', -40, 150, 0, 1, temp, 'temp', {hi: 130});
pid('3C', 'อุณหภูมิแคต B1S1', '°C', 0, 1000, 0, 2, a => w(a) / 10 - 40, 'temp', {hi: 900});
pid('3D', 'อุณหภูมิแคต B2S1', '°C', 0, 1000, 0, 2, a => w(a) / 10 - 40, 'temp', {hi: 900});
pid('3E', 'อุณหภูมิแคต B1S2', '°C', 0, 1000, 0, 2, a => w(a) / 10 - 40, 'temp');
pid('3F', 'อุณหภูมิแคต B2S2', '°C', 0, 1000, 0, 2, a => w(a) / 10 - 40, 'temp');

pid('06', 'Fuel trim สั้น B1', '%', -25, 25, 1, 1, trim, 'fuel', {lo: -20, hi: 20});
pid('07', 'Fuel trim ยาว B1', '%', -25, 25, 1, 1, trim, 'fuel', {lo: -15, hi: 15});
pid('08', 'Fuel trim สั้น B2', '%', -25, 25, 1, 1, trim, 'fuel', {lo: -20, hi: 20});
pid('09', 'Fuel trim ยาว B2', '%', -25, 25, 1, 1, trim, 'fuel', {lo: -15, hi: 15});
pid('0A', 'แรงดันน้ำมัน', 'kPa', 0, 765, 0, 1, a => a[0] * 3, 'fuel');
pid('22', 'แรงดันรางหัวฉีด (สัมพัทธ์)', 'kPa', 0, 5000, 0, 2, a => w(a) * 0.079, 'fuel');
pid('23', 'แรงดันรางหัวฉีด', 'kPa', 0, 655350, 0, 2, a => w(a) * 10, 'fuel');
pid('59', 'แรงดันรางหัวฉีด (สัมบูรณ์)', 'kPa', 0, 655350, 0, 2, a => w(a) * 10, 'fuel');
pid('2F', 'น้ำมันเหลือ', '%', 0, 100, 0, 1, pct, 'fuel', {lo: 10});
pid('52', 'เอทานอลในน้ำมัน', '%', 0, 100, 0, 1, pct, 'fuel');
pid('5D', 'จังหวะฉีดน้ำมัน', '°', -210, 302, 1, 2, a => w(a) / 128 - 210, 'fuel');
pid('5E', 'อัตรากินน้ำมัน (ECU)', 'L/h', 0, 50, 1, 2, a => w(a) / 20, 'fuel');
pid('44', 'สั่งส่วนผสม (แลมบ์ดา)', 'λ', 0, 2, 3, 2, lambda, 'fuel');
pid('33', 'ความกดอากาศ', 'kPa', 0, 255, 0, 1, a => a[0], 'fuel');
pid('2C', 'สั่งเปิด EGR', '%', 0, 100, 0, 1, pct, 'o2');
pid('2D', 'EGR คลาดเคลื่อน', '%', -100, 100, 0, 1, a => (a[0] * 100) / 128 - 100, 'o2');
pid('2E', 'สั่งไล่ไอระเหยน้ำมัน', '%', 0, 100, 0, 1, pct, 'o2');
pid('32', 'แรงดันไอระเหยน้ำมัน', 'Pa', -8192, 8192, 0, 2, a => ((((a[0] << 24) >> 16) | a[1]) / 4), 'o2');
pid('53', 'แรงดันไอระเหย (สัมบูรณ์)', 'kPa', 0, 330, 1, 2, a => w(a) / 200, 'o2');

['14', '15', '16', '17', '18', '19', '1A', '1B'].forEach((p, i) =>
  pid(p, `O2 B${(i >> 2) + 1}S${(i & 3) + 1} แรงดัน`, 'V', 0, 1.275, 3, 2, a => a[0] / 200, 'o2',
    {en: `O2 B${(i >> 2) + 1}S${(i & 3) + 1} voltage`}));
['24', '25', '26', '27', '28', '29', '2A', '2B'].forEach((p, i) =>
  pid(p, `O2 ไวด์แบนด์ S${i + 1} (λ)`, 'λ', 0, 2, 3, 4, lambda, 'o2', {en: `Wideband O2 S${i + 1} (λ)`}));
['34', '35', '36', '37', '38', '39', '3A', '3B'].forEach((p, i) =>
  pid(p, `O2 ไวด์แบนด์ S${i + 1} กระแส`, 'mA', -128, 128, 2, 4, a => (a[2] * 256 + a[3]) / 256 - 128, 'o2',
    {en: `Wideband O2 S${i + 1} current`}));

pid('42', 'แรงดันไฟ ECU', 'V', 0, 16, 2, 2, a => w(a) / 1000, 'elec', {lo: 11.8, hi: 15.2});
pid('5B', 'แบตไฮบริดเหลือ', '%', 0, 100, 0, 1, pct, 'elec');
pid('21', 'ระยะทางตั้งแต่ไฟโชว์ติด', 'km', 0, 65535, 0, 2, w, 'info');
pid('31', 'ระยะทางตั้งแต่ล้างรหัส', 'km', 0, 65535, 0, 2, w, 'info');
pid('30', 'จำนวนรอบอุ่นเครื่องตั้งแต่ล้างรหัส', '', 0, 255, 0, 1, a => a[0], 'info');
pid('4D', 'เวลาตั้งแต่ไฟโชว์ติด', 'min', 0, 65535, 0, 2, w, 'info');
pid('4E', 'เวลาตั้งแต่ล้างรหัส', 'min', 0, 65535, 0, 2, w, 'info');
pid('A6', 'เลขไมล์', 'km', 0, 999999, 1, 4, a => (a[0] * 16777216 + (a[1] << 16) + (a[2] << 8) + a[3]) / 10, 'info');

SRC.RV = {
  id: 'RV', name: 'แบตเตอรี่ (วัดที่ตัวเสียบ)', en: EN.RV, unit: 'V', min: 9, max: 16, d: 1, cat: 'elec', cmd: 'ATRV', lo: 11.8, hi: 15.2,
  parse: lines => { const m = (lines[0] || '').match(/(\d+(\.\d+)?)/); return m ? +m[1] : null; },
};

export function fmtDur(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}

function calc(id: string, name: string, unit: string, min: number, max: number, d: number, need: string[], extra?: Partial<Source>) {
  SRC[id] = {id, name, en: EN[id] ?? name, unit, min, max, d, cat: 'trip', calc: true, need, ...extra};
}
calc('LPH', 'อัตรากินน้ำมัน', 'L/h', 0, 30, 1, ['FUEL']);
calc('KML', 'อัตราสิ้นเปลือง (ขณะนี้)', 'km/L', 0, 40, 1, ['0D', 'FUEL']);
calc('L100', 'อัตราสิ้นเปลือง (ขณะนี้)', 'L/100km', 0, 30, 1, ['0D', 'FUEL']);
calc('BOOST', 'บูสต์', 'bar', -1, 2, 2, ['0B', '33']);
calc('ACC', 'แรง G (เร่ง/เบรก)', 'g', -1, 1, 2, ['0D']);
calc('POW', 'กำลังโดยประมาณ', 'hp', 0, 400, 0, ['10'], {note: 'note.maf'});
calc('TDIST', 'ระยะทางทริป', 'km', 0, 1000, 2, ['0D']);
calc('TTIME', 'เวลาทริป', '', 0, 1, 0, [], {fmt: fmtDur});
calc('TAVG', 'ความเร็วเฉลี่ยทริป', 'km/h', 0, 200, 0, ['0D']);
calc('TMAX', 'ความเร็วสูงสุดทริป', 'km/h', 0, 240, 0, ['0D']);
calc('TFUEL', 'น้ำมันที่ใช้ในทริป', 'L', 0, 100, 2, ['FUEL']);
calc('TKML', 'อัตราสิ้นเปลืองเฉลี่ยทริป', 'km/L', 0, 40, 1, ['0D', 'FUEL']);

export function fmtVal(src: Source, v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '--';
  if (src.fmt) return src.fmt(v);
  const s = v.toFixed(src.d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

export function isAlarm(src: Source, v: number | null | undefined): boolean {
  return v != null && ((src.hi != null && v > src.hi) || (src.lo != null && v < src.lo));
}

// ---------- แดชบอร์ดตั้งต้น ----------
export type WidgetType = 'num' | 'bar' | 'gauge' | 'graph';
export interface Widget { id: string; type: WidgetType; size: 1 | 2; }
export type PresetId = 'main' | 'sport' | 'eco';
/** name ว่าง = ใช้ชื่อตั้งต้นตามภาษา */
export interface Dash { name: string; preset?: PresetId; widgets: Widget[]; }
export const dashName = (d: Dash) => d.name || (d.preset ? t(`preset.${d.preset}`) : '');

export const PRESETS: Dash[] = [
  {name: '', preset: 'main', widgets: [
    {id: '0C', type: 'gauge', size: 2}, {id: '0D', type: 'gauge', size: 2},
    {id: '05', type: 'num', size: 1}, {id: '04', type: 'num', size: 1},
    {id: '11', type: 'bar', size: 1}, {id: 'RV', type: 'num', size: 1},
    {id: 'KML', type: 'num', size: 1}, {id: 'LPH', type: 'num', size: 1},
    {id: '2F', type: 'bar', size: 1}, {id: '0F', type: 'num', size: 1},
    {id: '06', type: 'graph', size: 2},
  ]},
  {name: '', preset: 'sport', widgets: [
    {id: '0C', type: 'gauge', size: 2}, {id: '0D', type: 'num', size: 2},
    {id: 'BOOST', type: 'gauge', size: 1}, {id: '11', type: 'gauge', size: 1},
    {id: 'ACC', type: 'num', size: 1}, {id: '0E', type: 'num', size: 1},
    {id: '05', type: 'bar', size: 1}, {id: '0F', type: 'bar', size: 1},
    {id: '0C', type: 'graph', size: 2},
  ]},
  {name: '', preset: 'eco', widgets: [
    {id: 'KML', type: 'num', size: 2}, {id: 'L100', type: 'num', size: 1},
    {id: 'LPH', type: 'num', size: 1}, {id: 'TKML', type: 'num', size: 1},
    {id: 'TFUEL', type: 'num', size: 1}, {id: 'TDIST', type: 'num', size: 1},
    {id: 'TAVG', type: 'num', size: 1}, {id: '2F', type: 'bar', size: 2},
    {id: 'KML', type: 'graph', size: 2},
  ]},
];

export function defaultType(src: Source): WidgetType {
  return src.id === '0C' || src.id === 'BOOST' ? 'gauge' : src.unit === '%' ? 'bar' : 'num';
}

// ---------- โหมดจับเวลา ----------
export type RaceType = 'accel' | 'dist' | 'roll' | 'brake';
export interface RaceMode { id: string; type: RaceType; from?: number; to?: number; dist?: number; label?: string; }

export const RACE_MODES: RaceMode[] = [
  {id: '0-100', type: 'accel', to: 100},
  {id: '0-60', type: 'accel', to: 60},
  {id: '400m', type: 'dist', dist: 402.3, label: '0-400'},
  {id: '201m', type: 'dist', dist: 201.2, label: '0-201'},
  {id: '60-100', type: 'roll', from: 60, to: 100},
  {id: '80-120', type: 'roll', from: 80, to: 120},
  {id: '100-200', type: 'roll', from: 100, to: 200},
  {id: 'b100', type: 'brake', from: 100},
  {id: 'b60', type: 'brake', from: 60},
];

export function raceName(m: RaceMode): string {
  if (m.type === 'dist') return t('race.m', {v: m.label!});
  if (m.type === 'brake') return t('mode.brake', {v: m.from!});
  return m.id;
}

// ---------- ความหมายรหัสข้อผิดพลาดที่เจอบ่อย ----------
const DTC_TH: Record<string, string> = {
  P0011: 'ไทม์มิ่งแคมไอดีล้ำหน้าเกิน (B1)', P0014: 'ไทม์มิ่งแคมไอเสียล้ำหน้าเกิน (B1)',
  P0016: 'สัญญาณข้อเหวี่ยงกับแคมไม่ตรงกัน (B1)', P0087: 'แรงดันรางหัวฉีดต่ำเกิน',
  P0100: 'วงจรเซ็นเซอร์ MAF ผิดปกติ', P0101: 'เซ็นเซอร์ MAF ค่าผิดช่วง', P0102: 'เซ็นเซอร์ MAF สัญญาณต่ำ',
  P0103: 'เซ็นเซอร์ MAF สัญญาณสูง', P0106: 'เซ็นเซอร์ MAP ค่าผิดช่วง', P0107: 'เซ็นเซอร์ MAP สัญญาณต่ำ',
  P0110: 'วงจรเซ็นเซอร์อุณหภูมิอากาศเข้าผิดปกติ', P0112: 'เซ็นเซอร์อุณหภูมิอากาศเข้าสัญญาณต่ำ',
  P0113: 'เซ็นเซอร์อุณหภูมิอากาศเข้าสัญญาณสูง', P0115: 'วงจรเซ็นเซอร์อุณหภูมิน้ำผิดปกติ',
  P0116: 'เซ็นเซอร์อุณหภูมิน้ำค่าผิดช่วง', P0117: 'เซ็นเซอร์อุณหภูมิน้ำสัญญาณต่ำ',
  P0118: 'เซ็นเซอร์อุณหภูมิน้ำสัญญาณสูง', P0121: 'เซ็นเซอร์ลิ้นปีกผีเสื้อค่าผิดช่วง',
  P0122: 'เซ็นเซอร์ลิ้นปีกผีเสื้อสัญญาณต่ำ', P0123: 'เซ็นเซอร์ลิ้นปีกผีเสื้อสัญญาณสูง',
  P0125: 'อุณหภูมิน้ำขึ้นช้า ยังไม่ถึงค่าทำงาน', P0128: 'วาล์วน้ำ (เทอร์โมสตัท) เปิดค้าง/น้ำร้อนช้า',
  P0130: 'เซ็นเซอร์ O2 B1S1 วงจรผิดปกติ', P0131: 'เซ็นเซอร์ O2 B1S1 แรงดันต่ำ', P0132: 'เซ็นเซอร์ O2 B1S1 แรงดันสูง',
  P0133: 'เซ็นเซอร์ O2 B1S1 ตอบสนองช้า', P0134: 'เซ็นเซอร์ O2 B1S1 ไม่มีสัญญาณ', P0135: 'ฮีตเตอร์ O2 B1S1 ผิดปกติ',
  P0136: 'เซ็นเซอร์ O2 B1S2 วงจรผิดปกติ', P0137: 'เซ็นเซอร์ O2 B1S2 แรงดันต่ำ', P0138: 'เซ็นเซอร์ O2 B1S2 แรงดันสูง',
  P0141: 'ฮีตเตอร์ O2 B1S2 ผิดปกติ', P0151: 'เซ็นเซอร์ O2 B2S1 แรงดันต่ำ', P0155: 'ฮีตเตอร์ O2 B2S1 ผิดปกติ',
  P0171: 'ส่วนผสมบางเกิน (B1) — มักเกิดจากลมรั่ว/MAF สกปรก/ปั๊มติ๊กอ่อน', P0172: 'ส่วนผสมหนาเกิน (B1)',
  P0174: 'ส่วนผสมบางเกิน (B2)', P0175: 'ส่วนผสมหนาเกิน (B2)', P0200: 'วงจรหัวฉีดผิดปกติ',
  P0217: 'เครื่องร้อนเกิน', P0219: 'รอบเครื่องเกินกำหนด', P0234: 'บูสต์เกิน (โอเวอร์บูสต์)',
  P0299: 'บูสต์ต่ำ/เทอร์โบแรงดันไม่พอ', P0300: 'จุดระเบิดผิดพลาดหลายสูบ (เครื่องสะดุด)',
  P0325: 'วงจรเซ็นเซอร์น็อกผิดปกติ', P0327: 'เซ็นเซอร์น็อกสัญญาณต่ำ', P0335: 'วงจรเซ็นเซอร์ข้อเหวี่ยงผิดปกติ',
  P0340: 'วงจรเซ็นเซอร์แคมผิดปกติ', P0400: 'ระบบ EGR ไหลผิดปกติ', P0401: 'EGR ไหลน้อยเกิน', P0402: 'EGR ไหลมากเกิน',
  P0420: 'แคตาไลติกประสิทธิภาพต่ำ (B1)', P0430: 'แคตาไลติกประสิทธิภาพต่ำ (B2)',
  P0440: 'ระบบไอระเหยน้ำมันผิดปกติ', P0441: 'ระบบไล่ไอระเหยไหลผิดปกติ', P0442: 'ระบบไอระเหยรั่วเล็กน้อย',
  P0446: 'วาล์วระบายระบบไอระเหยผิดปกติ', P0455: 'ระบบไอระเหยรั่วมาก (ฝาถังน้ำมันปิดไม่สนิท?)',
  P0456: 'ระบบไอระเหยรั่วเล็กมาก', P0500: 'เซ็นเซอร์ความเร็วรถผิดปกติ', P0505: 'ระบบควบคุมรอบเดินเบาผิดปกติ',
  P0506: 'รอบเดินเบาต่ำกว่ากำหนด', P0507: 'รอบเดินเบาสูงกว่ากำหนด', P0562: 'ไฟระบบต่ำ (แบต/ไดชาร์จ)',
  P0563: 'ไฟระบบสูงเกิน', P0600: 'ลิงก์สื่อสาร ECU ผิดปกติ', P0606: 'หน่วยประมวลผล ECU ผิดปกติ',
  P0700: 'ระบบเกียร์ผิดปกติ (ดูรหัสใน TCM)', P0715: 'เซ็นเซอร์ความเร็วเพลาเข้าเกียร์ผิดปกติ',
  P0740: 'ระบบล็อกอัพทอร์คคอนเวอร์เตอร์ผิดปกติ', P0A80: 'แบตเตอรี่ไฮบริดเสื่อม ควรเปลี่ยน',
  P0A7F: 'แบตเตอรี่ไฮบริดเสื่อมสภาพ', P0AA6: 'ไฟรั่วในระบบแรงดันสูงไฮบริด',
  U0100: 'ขาดการสื่อสารกับ ECM/PCM', U0101: 'ขาดการสื่อสารกับกล่องเกียร์ (TCM)',
  U0121: 'ขาดการสื่อสารกับ ABS', U0140: 'ขาดการสื่อสารกับ BCM',
};
const DTC_EN: Record<string, string> = {
  P0011: 'Intake cam timing over-advanced (B1)', P0014: 'Exhaust cam timing over-advanced (B1)',
  P0016: 'Crankshaft/camshaft correlation (B1)', P0087: 'Fuel rail pressure too low',
  P0100: 'MAF circuit malfunction', P0101: 'MAF sensor range/performance', P0102: 'MAF sensor low input',
  P0103: 'MAF sensor high input', P0106: 'MAP sensor range/performance', P0107: 'MAP sensor low input',
  P0110: 'Intake air temp circuit malfunction', P0112: 'Intake air temp sensor low input',
  P0113: 'Intake air temp sensor high input', P0115: 'Coolant temp circuit malfunction',
  P0116: 'Coolant temp sensor range/performance', P0117: 'Coolant temp sensor low input',
  P0118: 'Coolant temp sensor high input', P0121: 'Throttle position sensor range/performance',
  P0122: 'Throttle position sensor low input', P0123: 'Throttle position sensor high input',
  P0125: 'Coolant temp too low for closed loop', P0128: 'Thermostat stuck open (coolant warms slowly)',
  P0130: 'O2 sensor B1S1 circuit', P0131: 'O2 sensor B1S1 low voltage', P0132: 'O2 sensor B1S1 high voltage',
  P0133: 'O2 sensor B1S1 slow response', P0134: 'O2 sensor B1S1 no activity', P0135: 'O2 heater B1S1 circuit',
  P0136: 'O2 sensor B1S2 circuit', P0137: 'O2 sensor B1S2 low voltage', P0138: 'O2 sensor B1S2 high voltage',
  P0141: 'O2 heater B1S2 circuit', P0151: 'O2 sensor B2S1 low voltage', P0155: 'O2 heater B2S1 circuit',
  P0171: 'System too lean (B1) — often a vacuum leak, dirty MAF or weak fuel pump', P0172: 'System too rich (B1)',
  P0174: 'System too lean (B2)', P0175: 'System too rich (B2)', P0200: 'Injector circuit malfunction',
  P0217: 'Engine overheating', P0219: 'Engine overspeed', P0234: 'Turbo overboost',
  P0299: 'Turbo underboost', P0300: 'Random/multiple cylinder misfire',
  P0325: 'Knock sensor circuit', P0327: 'Knock sensor low input', P0335: 'Crankshaft position sensor circuit',
  P0340: 'Camshaft position sensor circuit', P0400: 'EGR flow malfunction', P0401: 'EGR flow insufficient', P0402: 'EGR flow excessive',
  P0420: 'Catalyst efficiency below threshold (B1)', P0430: 'Catalyst efficiency below threshold (B2)',
  P0440: 'EVAP system malfunction', P0441: 'EVAP purge flow incorrect', P0442: 'EVAP small leak',
  P0446: 'EVAP vent control circuit', P0455: 'EVAP large leak (fuel cap loose?)',
  P0456: 'EVAP very small leak', P0500: 'Vehicle speed sensor', P0505: 'Idle air control system',
  P0506: 'Idle speed lower than expected', P0507: 'Idle speed higher than expected', P0562: 'System voltage low (battery/alternator)',
  P0563: 'System voltage high', P0600: 'ECU serial communication link', P0606: 'ECU processor fault',
  P0700: 'Transmission control system (check TCM codes)', P0715: 'Transmission input speed sensor',
  P0740: 'Torque converter clutch circuit', P0A80: 'Replace hybrid battery pack',
  P0A7F: 'Hybrid battery pack deterioration', P0AA6: 'Hybrid high-voltage isolation fault',
  U0100: 'Lost communication with ECM/PCM', U0101: 'Lost communication with TCM',
  U0121: 'Lost communication with ABS', U0140: 'Lost communication with BCM',
};

export function dtcText(code: string): string {
  const own = getLang() === 'th' ? DTC_TH[code] : DTC_EN[code];
  if (own) return own;
  if (/^P030[1-9]$|^P031[0-2]$/.test(code)) return t('dtc.misfireN', {n: parseInt(code.slice(3), 10)});
  const sys = t(`dtc.sys${code[0]}` as Key);
  const kind = t(code[1] === '1' || code[1] === '3' ? 'dtc.mfr' : 'dtc.generic');
  const d = code[2] === '8' ? '7' : code[2];
  const sub = code[0] === 'P' && /[0-7A]/.test(d) ? t(`dtc.p${d}` as Key) : '';
  return `${sys} · ${kind}${sub ? ' · ' + sub : ''}`;
}
