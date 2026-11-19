import { bits, bmwRead, bmwReq, bmwSetup, CLEAR_REQ, decodeWheels, DID_WHEELS, DSC, DTC_REQ, hasFirstFrame, isoTp, parseDid, parseDtc19 } from '../obd/bmw';
import { SRC } from '../obd/catalog';
import { Elm } from '../obd/elm';
import { MIN_SPEED, median4, WheelCheck } from '../core/wheels';
import { createSimTransport } from '../obd/sim';

// คำตอบจริงจาก F30 (OBDb test case, ATH1 ATS0)
const REAL = [
  '629F1101662DBE40BAA',
  '629F1210C780BC70C6F',
  '629F1220BC301010101',
  '629F1230164646464FF',
];

const wheelsOf = (lines: string[]) => {
  const r = parseDid(isoTp(lines, DSC), DID_WHEELS);
  return r && 'data' in r ? decodeWheels(r.data) : null;
};

test('decodes wheel speeds from a real F30 multi-frame reply', () => {
  expect(wheelsOf(REAL)).toEqual([29.86, 31.92, 30.15, 31.83]);
  expect(wheelsOf([
    '629F1101662DBE40056', '629F121005500580055', '629F122005802020202', '629F1230264646464FF',
  ])).toEqual([0.86, 0.85, 0.88, 0.85]);
});

test('accepts spaces, echo lines and replies without the tester byte', () => {
  const spaced = REAL.map(l => l.replace(/(...)(..)/, '$1 $2 ').replace(/(..)(?=..)/g, '$1 '));
  expect(wheelsOf(['22DBE4', ...spaced])).toEqual([29.86, 31.92, 30.15, 31.83]);
  expect(wheelsOf(REAL.map(l => l.slice(0, 3) + l.slice(5)))).toEqual([29.86, 31.92, 30.15, 31.83]);
});

test('incomplete or foreign replies give null', () => {
  expect(isoTp(REAL.slice(0, 2), DSC)).toBeNull();
  expect(hasFirstFrame(REAL.slice(0, 1), DSC)).toBe(true);
  expect(isoTp(['NO DATA'], DSC)).toBeNull();
  expect(isoTp(REAL.map(l => '612' + l.slice(3)), DSC)).toBeNull();
});

test('negative responses', () => {
  expect(parseDid(isoTp(['629F1037F2231'], DSC), DID_WHEELS)).toEqual({nrc: 0x31});
  // 0x78 = response pending → wait for the real answer
  expect(parseDid(isoTp(['629F1037F2278', ...REAL], DSC), DID_WHEELS)).toEqual(expect.objectContaining({data: expect.any(Array)}));
});

test('signed values', () => {
  expect(decodeWheels([0xff, 0x9c, 0, 100, 0, 0, 0x80, 0])).toEqual([-1, 1, 0, -327.68]);
});

test('wheel check flags a dropping sensor and ignores slow speeds', () => {
  const c = new WheelCheck();
  let t = 0;
  for (let i = 0; i < 40; i++) c.update([3, 0, 3, 3], (t += 100));
  expect(c.s[1].drops).toBe(0);
  expect(median4([3, 0, 3, 3])).toBeLessThan(MIN_SPEED);
  for (let i = 0; i < 40; i++) c.update([30, 30.2, i % 10 === 5 ? 0 : 29.9, 30.1], (t += 100));
  expect(c.state(0)).toBe('ok');
  expect(c.s[2].drops).toBe(4);
  expect(c.state(2)).toBe('bad');
});

test('wheel check warns on a wheel that is constantly off', () => {
  const c = new WheelCheck();
  for (let i = 0; i < 30; i++) c.update([40, 40, 40, 41.4], i * 100);
  expect(c.state(3)).toBe('warn');
  expect(c.state(0)).toBe('ok');
});

test('simulator answers the DSC wheel request like a real car', async () => {
  const sim = createSimTransport();
  const ask = (c: string) => new Promise<string[]>(res => {
    sim.onData = s => res(s.replace('>', '').split(/[\r\n]+/).filter(Boolean));
    sim.write(c + '\r');
  });
  for (const c of ['ATH1', 'ATSH6F1', 'ATCEA29']) await ask(c);
  const w = wheelsOf(await ask('22DBE4'));
  expect(w).toHaveLength(4);
  expect(await ask('22DC98')).toEqual(['629F1037F2231']);   // กล่องตอบว่าไม่มีค่านี้ (NRC 31)
  sim.close();
});

// ---------- แบตไฮบริด / แบต 12V / รหัสเฉพาะ BMW ----------

const decode = (id: string, data: number[], alt = 0) => SRC[id].bmw![alt].f(data);
const payload = (lines: string[], ecu: number, did: string) => {
  const r = parseDid(isoTp(lines, ecu), did);
  return r && 'data' in r ? r.data : [];
};

test('bit reader', () => {
  expect(bits([0x12, 0x34], 0, 16)).toBe(0x1234);
  expect(bits([0x12, 0x34], 4, 8)).toBe(0x23);
  expect(bits([0xff, 0xfe], 0, 16, true)).toBe(-2);
  expect(bits([0x12], 0, 16)).toBeNull();
});

test('decodes a real 2017 F30 hybrid battery cell report (OBDb DFA0)', () => {
  const d = payload([
    '607F1104162DFA0097E', '607F12109A909969AC1', '607F1229B129AEC0854', '607F12308C40892317D',
    '607F1243853349B1DE7', '607F1251E691E269E70', '607F1269EA29E843A38', '607F12770BD6BD56A5A',
    '607F128597600140320', '607F129005800000000', '607F12A00000001BF48',
  ], 0x07, 'DFA0');
  expect(decode('HVCAP', d)).toBeCloseTo(24.54);
  expect(decode('HVCMIN', d)).toBeCloseTo(3.9617);
  expect(decode('HVCMAX', d)).toBeCloseTo(3.9698);
  expect(decode('HVCDIF', d)).toBeCloseTo(8.1);
  expect(decode('HVSOC', d, 2)).toBeCloseTo(77.18);
});

test('decodes hybrid cell temperatures (OBDb DDC0, 2016)', () => {
  const d = payload(['607F1100A62DDC008F5', '607F1210A21097401FF'], 0x07, 'DDC0');
  expect(decode('HVTMIN', d)).toBeCloseTo(22.93);
  expect(decode('HVTMAX', d)).toBeCloseTo(25.93);
});

test('decodes the 12V battery sensor (OBDb 402B)', () => {
  const d = payload(['612F1101F62402B00F0', '612F12169B00A360000', '612F122100000000002', '612F123000000000000',
    '612F1240000B4C20000', '612F1250000FFFFFFFF'], 0x12, '402B');
  expect(decode('B12V', d)).toBeCloseTo(12.764);
  expect(decode('B12A', d)).toBeCloseTo(9.12);
  expect(decode('B12T', d)).toBeCloseTo(24);
});

test('parses UDS fault code reports', () => {
  // 59 02 FF + 3 รหัส (รหัสสุดท้ายสถานะ 0x20 = เก่า ไม่เอา)
  expect(parseDtc19([0x59, 0x02, 0xff, 0x21, 0xa5, 0x0a, 0x2f, 0x80, 0x1c, 0x20, 0x09, 0xd7, 0x8c, 0x00, 0x20]))
    .toEqual([{code: '21A50A', status: 0x2f}, {code: '801C20', status: 0x09}]);
  expect(parseDtc19([0x59, 0x02, 0xff])).toEqual([]);
  expect(parseDtc19([0x7f, 0x19, 0x11])).toBeNull();
  expect(parseDtc19(null)).toBeNull();
});

test('simulated 330e: battery values and fault codes over a real ELM session', async () => {
  const elm = new Elm();
  await elm.open(createSimTransport(), true);
  expect(await bmwSetup(elm, 'auto', 0x07)).toBe(true);
  const soc = await bmwRead(elm, 'auto', 0x07, 'E5CE');
  expect(soc && 'data' in soc && decode('HVSOC', soc.data)).toBeGreaterThan(50);
  const cells = await bmwRead(elm, 'auto', 0x07, 'DFA0');
  expect(cells && 'data' in cells && decode('HVCDIF', cells.data)).toBeCloseTo(16);
  expect(await bmwRead(elm, 'auto', 0x07, '6335')).toEqual({nrc: 0x31});
  await bmwSetup(elm, 'auto', 0x12);
  const v = await bmwRead(elm, 'auto', 0x12, '402B');
  expect(v && 'data' in v && decode('B12V', v.data)).toBeCloseTo(14.05, 1);
  expect(parseDtc19(await bmwReq(elm, 'auto', 0x12, DTC_REQ))!.map(c => c.code)).toEqual(['21A50A', '21A02D', '21A511']);
  expect(await bmwReq(elm, 'auto', 0x12, CLEAR_REQ)).toEqual([0x54]);
  expect(parseDtc19(await bmwReq(elm, 'auto', 0x12, DTC_REQ))).toEqual([]);
  await bmwSetup(elm, 'auto', 0x40);
  expect(await bmwReq(elm, 'auto', 0x40, DTC_REQ)).toBeNull();
  elm.close(false);
});
