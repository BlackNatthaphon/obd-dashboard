import { GEAR_EV, GEAR_LEARNING, GEAR_N, GEAR_UNKNOWN, GearEstimator, gearLabel, parseA4 } from '../core/gear';

// rpm ต่อ km/h ของเกียร์ 8 สปีดแบบ ZF 8HP (ใกล้เคียง 330e)
const RATIOS = [118, 72, 47, 36, 28, 22, 18, 15];

/** ขับแต่ละเกียร์ที่ความเร็วหลายค่า โดยความเร็วถูกปัดเป็นจำนวนเต็มเหมือน OBD และรอบมี noise */
function drive(est: GearEstimator, rounds = 3) {
  for (let k = 0; k < rounds; k++)
    RATIOS.forEach(r => {
      for (let v = Math.ceil(1200 / r); v * r < 5500; v += 2) {
        const rpm = v * r + (Math.random() - 0.5) * 40;
        for (let i = 0; i < 4; i++) est.update(rpm, Math.round(v + (Math.random() - 0.5) * 0.8));
      }
    });
  est.findGears();
}

test('learns 8 gears and identifies each', () => {
  const est = new GearEstimator();
  expect(est.update(2000, 40)).toBe(GEAR_LEARNING);
  drive(est);
  expect(est.gears.length).toBe(8);
  RATIOS.forEach((r, i) => {
    const v = Math.round(2500 / r);
    expect(est.match(2500 / v)).toBe(i + 1);
  });
});

test('N when stopped, EV when engine off while moving, unknown mid-shift', () => {
  const est = new GearEstimator();
  drive(est);
  expect(est.update(800, 0)).toBe(GEAR_N);
  expect(est.update(0, 45)).toBe(GEAR_EV);
  // ระหว่างเกียร์ 2 (72) กับ 3 (47) → ไม่ตรงเกียร์ไหน
  expect(est.update(58 * 40, 40)).toBe(GEAR_UNKNOWN);
});

test('learned data survives save/restore', () => {
  const a = new GearEstimator();
  drive(a);
  const b = new GearEstimator(a.hist.slice());
  expect(b.gears.length).toBe(8);
});

test('labels and PID A4', () => {
  expect(gearLabel(GEAR_N)).toBe('N');
  expect(gearLabel(GEAR_EV)).toBe('EV');
  expect(gearLabel(3)).toBe('3');
  expect(parseA4([0x02, 0x40, 0x0b, 0xb8])).toBe(4);
  expect(parseA4([0x02, 0x00, 0, 0])).toBe(GEAR_N);
  expect(parseA4([0x00, 0x40, 0, 0])).toBe(GEAR_UNKNOWN);
});
