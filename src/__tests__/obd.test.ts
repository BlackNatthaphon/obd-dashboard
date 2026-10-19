import { b64ToText, textToB64 } from '../obd/base64';
import { fmtVal, SRC } from '../obd/catalog';
import { Elm, parse01, parseDtc, parseStatus, parseVin } from '../obd/elm';
import { createSimTransport } from '../obd/sim';
import { Race } from '../core/race';

describe('formulas', () => {
  test('rpm, speed, coolant', () => {
    expect(SRC['0C'].f!([0x1a, 0xf8])).toBe(1726);
    expect(SRC['0D'].f!([0x50])).toBe(80);
    expect(SRC['05'].f!([0x7b])).toBe(83);
    expect(SRC['06'].f!([0x80])).toBe(0);
  });
  test('signed evap pressure', () => {
    expect(SRC['32'].f!([0xff, 0xfc])).toBe(-1);
    expect(SRC['32'].f!([0x00, 0x08])).toBe(2);
  });
  test('formatting drops -0', () => {
    expect(fmtVal(SRC['06'], -0.01)).toBe('0.0');
    expect(fmtVal(SRC['0C'], null)).toBe('--');
  });
});

describe('parsers', () => {
  test('mode 01 with and without spaces, extra lines', () => {
    expect(parse01(['41 0C 1A F8'], '0C', 2)).toEqual([0x1a, 0xf8]);
    expect(parse01(['SEARCHING...', '410D50'], '0D', 1)).toEqual([0x50]);
    expect(parse01(['NO DATA'], '0D', 1)).toBeNull();
    expect(parse01(['410C1A'], '0C', 2)).toBeNull();
  });
  test('DTC: CAN single frame', () => {
    expect(parseDtc(['430201710420'], '43', true)).toEqual(['P0171', 'P0420']);
  });
  test('DTC: CAN multi-frame', () => {
    expect(parseDtc(['00A', '0:43040171042003', '1:00C10000000000'], '43', true)).toEqual(['P0171', 'P0420', 'P0300', 'U0100']);
  });
  test('DTC: legacy protocol, two ECUs', () => {
    expect(parseDtc(['43 01 71 00 00 00 00', '43 04 20 00 00 00 00'], '43', false)).toEqual(['P0171', 'P0420']);
  });
  test('DTC: none', () => {
    expect(parseDtc(['NO DATA'], '43', true)).toEqual([]);
  });
  test('VIN multi-frame', () => {
    expect(parseVin(['014', '0:4902014D5230', '1:42413343463130', '2:30303132333435'])).toBe('MR0BA3CF100012345');
  });
  test('status / readiness', () => {
    const s = parseStatus([0x82, 0x07, 0x65, 0x04]);
    expect(s.mil).toBe(true);
    expect(s.count).toBe(2);
    expect(s.mon.find(m => m.key === 'mon.evap')?.ok).toBe(false);
    expect(s.mon.find(m => m.key === 'mon.cat')?.ok).toBe(true);
  });
  test('base64 round trip', () => {
    expect(b64ToText(textToB64('010C1\r'))).toBe('010C1\r');
    expect(textToB64('ATZ\r')).toBe('QVRaDQ==');
  });
});

describe('ELM over simulator', () => {
  test('init, supported PIDs, reads, DTC, VIN', async () => {
    const elm = new Elm();
    const info = await elm.open(createSimTransport(), true);
    expect(info.isCan).toBe(true);
    expect(info.count).toBe(true);
    expect(info.supported.has('0C')).toBe(true);
    expect(info.supported.has('5C')).toBe(true);
    const r = await elm.read(SRC['0C']);
    expect(r && r !== 'NODATA' && r.v).toBeGreaterThan(500);
    expect(await elm.read(SRC['5E'])).toBe('NODATA');
    const rv = await elm.read(SRC.RV);
    expect(rv && rv !== 'NODATA' && rv.v).toBeGreaterThan(13);
    expect((await elm.readDtc()).stored).toEqual(['P0171', 'P0420']);
    expect(await elm.readVin()).toBe('MR0BA3CF100012345');
    elm.close();
    expect(elm.connected).toBe(false);
  });
});

describe('race timer', () => {
  // ป้อนความเร็วทุก 100 ms จากฟังก์ชัน v(t)
  const drive = (race: Race, v: (s: number) => number, secs: number, hz = 10) => {
    for (let i = 0; i <= secs * hz; i++) race.update(Math.round(v(i / hz)), (i * 1000) / hz);
  };

  test('0-100 at constant 4 m/s² ≈ 6.94 s', () => {
    const race = new Race('0-100');
    race.arm();
    drive(race, s => (s < 1 ? 0 : (s - 1) * 14.4), 12);
    expect(race.state).toBe('done');
    expect(race.res!.time).toBeGreaterThan(6.8);
    expect(race.res!.time).toBeLessThan(7.1);
  });

  test('roll-on 60-100 needs to start below 60', () => {
    const race = new Race('60-100');
    race.arm();
    drive(race, s => 40 + s * 10, 8);
    expect(race.state).toBe('done');
    expect(race.res!.time).toBeCloseTo(4, 1);
  });

  test('0-400 m gives trap speed', () => {
    const race = new Race('400m');
    race.arm();
    drive(race, s => (s < 1 ? 0 : Math.min(200, (s - 1) * 14.4)), 30);
    expect(race.state).toBe('done');
    // s = ½at² → t = √(2·402.3/4) ≈ 14.2 s
    expect(race.res!.time).toBeGreaterThan(13.8);
    expect(race.res!.time).toBeLessThan(14.6);
    expect(race.res!.trap).toBeGreaterThan(195);
  });

  test('braking 100-0 at 8 m/s²', () => {
    const race = new Race('b100');
    race.arm();
    drive(race, s => (s < 2 ? 110 : Math.max(0, 110 - (s - 2) * 28.8)), 8);
    expect(race.state).toBe('done');
    // 100 km/h = 27.8 m/s → t ≈ 3.47 s, d ≈ 48 m
    expect(race.res!.time).toBeGreaterThan(3.3);
    expect(race.res!.time).toBeLessThan(3.7);
    expect(race.res!.dist).toBeGreaterThan(44);
    expect(race.res!.dist).toBeLessThan(52);
  });

  test('must be stopped before an accel run', () => {
    const race = new Race('0-100');
    race.arm();
    drive(race, () => 30, 2);
    expect(race.state).toBe('armed');
    expect(race.msg?.k).toBe('race.stopFirst');
  });
});
