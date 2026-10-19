import { decodeWheels, DID_WHEELS, DSC, hasFirstFrame, isoTp, parseDid } from '../obd/bmw';
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
  expect(await ask('22DC98')).toEqual(['NO DATA']);
  sim.close();
});
