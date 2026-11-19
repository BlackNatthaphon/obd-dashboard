// รถจำลอง: ตอบคำสั่งเหมือนตัวเสียบ ELM327 จริง ใช้ลองแอพโดยไม่ต้องต่อรถ
import { t as tr } from '../i18n';
import { now, type Transport } from './elm';

const SUPPORTED = ['04', '05', '06', '07', '0A', '0B', '0C', '0D', '0E', '0F', '10', '11', '14', '15', '1F', '2F',
  '31', '33', '3C', '42', '43', '45', '46', '49', '5C'];
const RATIO = [0, 8.2, 13.5, 20, 27, 34, 41];     // km/h ต่อ 1000 rpm แต่ละเกียร์
type Phase = 'idle' | 'launch' | 'cruise' | 'brake' | 'roll';
const PLAN: [Phase, number][] = [['idle', 4], ['launch', 0], ['cruise', 5], ['brake', 0], ['idle', 3], ['roll', 0], ['brake', 0]];

export function createSimTransport(): Transport {
  const s = {speed: 0, rpm: 800, thr: 0, gear: 1, pt: 0, ect: 62, run: 0, last: now()};
  let step = 0;
  let closed = false;

  const next = () => { step = (step + 1) % PLAN.length; s.pt = 0; };
  function tick() {
    const t = now(), dt = Math.min(0.5, (t - s.last) / 1000);
    s.last = t; s.pt += dt; s.run += dt;
    const [ph, dur] = PLAN[step];
    let a = 0;
    if (ph === 'idle') { s.thr = 0; a = -s.speed * 0.5; if (s.pt > dur) next(); }
    else if (ph === 'launch' || ph === 'roll') {
      s.thr = 100;
      a = Math.max(0.5, 4.2 - s.speed / 50) * 3.6;          // km/h ต่อวินาที
      if (s.speed >= (ph === 'launch' ? 150 : 125)) next();
    } else if (ph === 'cruise') { s.thr = 18; a = (95 - s.speed) * 0.3; if (s.pt > dur) next(); }
    else if (ph === 'brake') { s.thr = 0; a = -8.5 * 3.6; if (s.speed <= 0) { s.speed = 0; next(); } }
    s.speed = Math.max(0, s.speed + a * dt);
    if (s.speed < 3) { s.gear = 1; s.rpm += ((s.thr ? 2500 : 780) - s.rpm) * Math.min(1, dt * 4); }
    else {
      let r = (s.speed / RATIO[s.gear]) * 1000;
      if (r > 6400 && s.gear < 6) s.gear++;
      else if (r < 1300 && s.gear > 1) s.gear--;
      r = (s.speed / RATIO[s.gear]) * 1000;
      s.rpm = Math.max(780, r);
    }
    s.ect = Math.min(91, s.ect + dt * 0.4);
  }

  const noise = (k: number) => (Math.random() - 0.5) * k;
  const h = (n: number, len = 1) => Math.max(0, Math.min(len === 2 ? 65535 : 255, Math.round(n)))
    .toString(16).toUpperCase().padStart(len * 2, '0');

  function data(p: string): string | null {
    const load = s.thr ? 30 + s.thr * 0.65 : 22 + noise(3);
    switch (p) {
      case '04': return h(load * 2.55);
      case '05': return h(s.ect + 40);
      case '06': return h(128 + noise(8) * 1.28 * 3);
      case '07': return h(128 + 3.1 * 1.28);
      case '0A': return h(380 / 3);
      case '0B': return h(30 + s.thr * 0.7 + noise(2));
      case '0C': return h((s.rpm + noise(30)) * 4, 2);
      case '0D': return h(s.speed);
      case '0E': return h(((s.thr ? 18 : 10 + noise(2)) + 64) * 2);
      case '0F': return h(36 + 40);
      case '10': return h((s.rpm / 1000) * load * 0.12 * 100, 2);
      case '11': return h((12 + s.thr * 0.85) * 2.55);
      case '14': case '15': return h(20 + Math.random() * 150) + '80';
      case '1F': return h(s.run, 2);
      case '2F': return h(63 * 2.55);
      case '31': return h(1834, 2);
      case '33': return h(101);
      case '3C': return h((520 + s.thr * 2 + 40) * 10, 2);
      case '42': return h((14.1 + noise(0.1)) * 1000, 2);
      case '43': return h(load * 2.55, 2);
      case '45': return h(s.thr * 2.55);
      case '46': return h(33 + 40);
      case '49': return h((15 + s.thr * 0.8) * 2.55);
      case '5C': return h(s.ect * 0.95 + 40);
    }
    return null;
  }

  function bitmap(base: number) {
    const v = [0, 0, 0, 0];
    for (const p of SUPPORTED.concat(['20', '40'])) {
      const i = parseInt(p, 16) - base - 1;
      if (i >= 0 && i < 32) v[i >> 3] |= 0x80 >> (i & 7);
    }
    return v.map(x => h(x)).join('');
  }

  // ตั้งค่าแบบ BMW (ATSH / ATCEA / ATH) — ใช้ตอบความเร็ว 4 ล้อจากกล่อง DSC
  const at = {sh: '7DF', cea: '', h1: false};
  let drop = 0;
  /** ข้อความ UDS (hex) จากกล่อง ecu → เฟรม ISO-TP แบบ extended addressing เหมือนรถจริง */
  function udsFrames(ecu: string, data: string): string {
    const bytes = data.match(/../g)!;
    const len = bytes.length, hdr = at.h1 ? '6' + ecu : '';
    if (len <= 6) return hdr + 'F1' + h(len) + bytes.join('');
    const out = [hdr + 'F110' + h(len) + bytes.slice(0, 5).join('')];
    for (let i = 5, n = 1; i < len; i += 6, n++) out.push(hdr + 'F12' + (n & 15).toString(16).toUpperCase() + bytes.slice(i, i + 6).join('').padEnd(12, '0'));
    return out.join('\n');
  }
  function wheelFrames(): string {
    const v = s.speed;
    // เลี้ยวโค้งเล็กน้อย + ล้อหลังซ้ายเซนเซอร์เสีย: สัญญาณหายเป็นช่วงๆ (ให้เห็นในโหมดจำลอง)
    const turn = Math.sin(s.run / 6) * 0.02;
    if (drop > 0) drop--; else if (v > 10 && Math.random() < 0.02) drop = 3;
    const w = [v * (1 + turn), v * (1 - turn), drop ? 0 : v * (1 + turn * 0.8), v * (1 - turn * 0.8)];
    return udsFrames('29', '62DBE4' + w.map(x => h(Math.max(0, x + noise(0.1)) * 100, 2)).join('') + '0101010101646464640000');
  }

  // รถจำลองเป็น 330e: แบตไฮบริด + แบต 12V + รหัสข้อผิดพลาดบางกล่อง
  const bmwDtc: Record<string, string> = {
    '12': '21A50A2F21A02D2F21A51124', '10': '801C2009', '72': '80489009', '29': '',
  };
  function bmwAnswer(ecu: string, cmd: string): string {
    const cur = -8 + noise(2), soc = 62.4 - s.run / 600;
    const DID: Record<string, () => string> = {
      '07E5CE': () => udsFrames('07', '62E5CE' + h(soc * 100, 2)),
      '07DD68': () => udsFrames('07', '62DD68' + h((352 + cur * 0.1) * 100, 2)),
      '07E561': () => udsFrames('07', '62E561' + '0000' + h((-cur * 100) & 0xffff, 2)),
      '07E5C7': () => udsFrames('07', '62E5C7' + '00000058'),
      '07DDC0': () => udsFrames('07', '62DDC0' + h(2950, 2) + h(3125, 2) + '01FF'),
      // ความจุ ต่ำ/สูง/เฉลี่ย · แรงดันเซลล์ ต่ำ/สูง/เฉลี่ย · อุณหภูมิ ×3 · ความต้านทาน ×3 · SoC เซลล์ ×3 · OCV ×3 · aging
      '07DFA0': () => udsFrames('07', '62DFA0' + h(2290, 2) + h(2410, 2) + h(2340, 2) + h(39250, 2) + h(39410, 2) + h(39330, 2)
        + '0B54'.repeat(3) + '3500'.repeat(3) + h(soc * 100, 2).repeat(3) + '9E84'.repeat(3) + '3A38'),
      '12402B': () => udsFrames('12', '62402B' + '0118' + h((14.05 - 6 + noise(0.02)) * 4000, 2) + h((6 + 200) * 12.5, 2) + '0000'),
      '12F190': () => udsFrames('12', '62F190' + '4D4D4638453134303130414331333936'),
    };
    const k = ecu + cmd.slice(2);
    if (cmd.startsWith('22')) {
      const f = DID[k] ?? (ecu === '29' && cmd === '22DBE4' ? wheelFrames : null);
      return f ? f() : ['07', '12', '29', '1A'].includes(ecu) ? udsFrames(ecu, '7F2231') : 'NO DATA';
    }
    if (cmd === '19020D' && ecu in bmwDtc) return udsFrames(ecu, '5902FF' + bmwDtc[ecu]);
    if (cmd === '14FFFFFF' && ecu in bmwDtc) { bmwDtc[ecu] = ''; return udsFrames(ecu, '54'); }
    return 'NO DATA';
  }

  function answer(cmd: string): string {
    cmd = cmd.trim().toUpperCase();
    if (cmd === 'ATZ') { Object.assign(at, {sh: '7DF', cea: '', h1: false}); return 'ELM327 v1.5'; }
    if (cmd.startsWith('ATSH')) { at.sh = cmd.slice(4); return 'OK'; }
    if (cmd.startsWith('ATCEA')) { at.cea = cmd.slice(5); return 'OK'; }
    if (cmd === 'ATH1' || cmd === 'ATH0') { at.h1 = cmd === 'ATH1'; return 'OK'; }
    if (at.sh === '6F1') return cmd.startsWith('AT') ? 'OK' : bmwAnswer(at.cea, cmd);
    if (cmd === 'ATI') return 'ELM327 v1.5 (sim)';
    if (cmd === 'ATRV') return (14.1 + noise(0.2)).toFixed(1) + 'V';
    if (cmd === 'ATDPN') return 'A6';
    if (cmd.startsWith('AT')) return 'OK';
    if (cmd === '03') return '430201710420';
    if (cmd === '07') return '47010300';
    if (cmd === '0A') return '4A00';
    if (cmd === '04') return '44';
    if (cmd === '0101') return '410182076504';
    if (cmd === '0902') return '014\n0:4902014D5230\n1:42413343463130\n2:30303132333435';
    const m = cmd.match(/^01([0-9A-F]{2})1?$/);
    if (m) {
      const p = m[1];
      if (['00', '20', '40'].includes(p)) return '41' + p + bitmap(parseInt(p, 16));
      const d = SUPPORTED.includes(p) ? data(p) : null;
      return d ? '41' + p + d : 'NO DATA';
    }
    return '?';
  }

  const t: Transport = {
    name: tr('simCar'),
    write(text) {
      if (closed) return;
      const cmd = text.replace(/\r/g, '');
      tick();
      const lat = cmd.startsWith('AT') ? 15 : 35 + Math.random() * 25;
      setTimeout(() => { if (!closed) t.onData?.(answer(cmd) + '\r\r>'); }, lat);
    },
    close() { closed = true; },
  };
  return t;
}
