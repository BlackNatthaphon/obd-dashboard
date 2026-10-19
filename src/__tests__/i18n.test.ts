import { pickLang, setLang, t } from '../i18n';
import en from '../i18n/en';
import th from '../i18n/th';
import { dashName, dtcText, PRESETS, RACE_MODES, raceName, SRC, srcName } from '../obd/catalog';
import { Race } from '../core/race';

afterEach(() => setLang('th'));

test('every key has an English translation and the same placeholders', () => {
  for (const k of Object.keys(th) as (keyof typeof th)[]) {
    expect(en[k]).toBeTruthy();
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    expect(vars(en[k])).toBe(vars(th[k]));
  }
});

test('switches language and fills variables', () => {
  setLang('en');
  expect(t('st.connected', {name: 'OBDII'})).toBe('Connected: OBDII');
  setLang('th');
  expect(t('st.connected', {name: 'OBDII'})).toBe('เชื่อมต่อแล้ว: OBDII');
});

test('phone language picks a supported language, else English', () => {
  expect(pickLang('th')).toBe('th');
  expect(pickLang('ja')).toBe('en');
  expect(pickLang(null)).toBe('en');
});

test('catalog names, DTCs, race modes and presets follow the language', () => {
  setLang('en');
  expect(srcName(SRC['05'])).toBe('Coolant temp');
  expect(Object.values(SRC).every(s => s.en && !/[฀-๿]/.test(s.en))).toBe(true);
  expect(dtcText('P0420')).toContain('Catalyst');
  expect(dtcText('P0304')).toBe('Cylinder 4 misfire');
  expect(dtcText('P1234')).toBe('Powertrain · manufacturer-specific · fuel & injectors');
  expect(raceName(RACE_MODES.find(m => m.id === '400m')!)).toBe('0-400 m');
  expect(raceName(RACE_MODES.find(m => m.id === 'b100')!)).toBe('Brake 100-0');
  expect(dashName(PRESETS[1])).toBe('Sport');
  setLang('th');
  expect(srcName(SRC['05'])).toBe('อุณหภูมิน้ำ');
  expect(dtcText('P0304')).toBe('สูบ 4 จุดระเบิดผิดพลาด (มิสไฟร์)');
  expect(raceName(RACE_MODES.find(m => m.id === '400m')!)).toBe('0-400 ม.');
  expect(dashName(PRESETS[1])).toBe('สปอร์ต');
});

test('race messages are keys, so they render in whichever language is active', () => {
  const race = new Race('60-100');
  race.arm();
  race.update(80, 0);
  race.update(80, 100);
  setLang('en');
  expect(t(race.msg!.k, race.msg!.v)).toBe('Slow down below 60 first');
  setLang('th');
  expect(t(race.msg!.k, race.msg!.v)).toBe('ลดความเร็วให้ต่ำกว่า 60 ก่อน');
});
