// ---------- การเชื่อมต่อ ELM327 (แอพ Android / Web Bluetooth / โหมดจำลอง) ----------
const OBD = (() => {
  const NATIVE = !!window.AndroidBle;
  const SERVICES = [0xfff0, 0xffe0, 0x18f0, 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
  const ev = {status() {}, log() {}, disconnected() {}};
  let link = null;            // {write(text), close()}
  let buf = '', pending = null, chain = Promise.resolve();
  let nativeWait = null;

  const info = {name: '', elm: '', proto: '', isCan: true, count: false, supported: new Set(), sim: false};

  function onText(s) {
    buf += s;
    const i = buf.indexOf('>');
    if (i >= 0 && pending) {
      const out = buf.slice(0, i); buf = buf.slice(i + 1);
      const p = pending; pending = null; clearTimeout(p.t); p.res(out);
    }
  }

  function dropPending() {
    if (pending) { const p = pending; pending = null; clearTimeout(p.t); p.res('DISCONNECTED'); }
  }

  // ส่งคำสั่งทีละคำสั่งตามคิว คืนค่าเป็นบรรทัดคำตอบ (มี t0/t1 = เวลาส่ง/ได้รับ)
  function send(cmd, timeout = 2500) {
    const job = chain.then(() => new Promise(res => {
      if (!link) { const r = ['DISCONNECTED']; r.t0 = r.t1 = performance.now(); return res(r); }
      buf = '';
      const t0 = performance.now();
      pending = {res: out => {
        const r = String(out).replace(/\r/g, '\n').split('\n').map(s => s.trim()).filter(s => s && s !== cmd && !/^SEARCHING/i.test(s));
        r.t0 = t0; r.t1 = performance.now();
        if (OBD.verbose) ev.log('> ' + cmd + '  ' + r.join(' | '));
        res(r);
      }, t: setTimeout(() => { pending = null; buf = ''; const r = ['TIMEOUT']; r.t0 = t0; r.t1 = performance.now(); ev.log('> ' + cmd + '  TIMEOUT'); res(r); }, timeout)};
      try { link.write(cmd + '\r'); } catch (e) { dropPending(); }
    }));
    chain = job.catch(() => {});
    return job;
  }

  // ---------- ตัวเชื่อมแต่ละแบบ ----------
  window.__ble = {
    status(s) { ev.status(s); },
    log(s) { ev.log(s); },
    connected(name) { if (nativeWait) { const w = nativeWait; nativeWait = null; w.res(name); } },
    error(msg) { ev.log('ERR ' + msg); if (nativeWait) { const w = nativeWait; nativeWait = null; w.rej(new Error(msg)); } else ev.status(msg); },
    data(str) { onText(str); },
    disconnected() { lost(); },
  };

  async function openNative() {
    const name = await new Promise((res, rej) => { nativeWait = {res, rej}; AndroidBle.connect(); });
    link = {write: t => AndroidBle.write(t), close: () => AndroidBle.disconnect()};
    return name;
  }

  async function openWeb() {
    if (!navigator.bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth — ใช้แอพ Android หรือ Chrome ผ่าน https');
    ev.status('กำลังค้นหาอุปกรณ์...');
    const device = await navigator.bluetooth.requestDevice({acceptAllDevices: true, optionalServices: SERVICES});
    device.addEventListener('gattserverdisconnected', lost);
    ev.status('กำลังเชื่อมต่อ ' + (device.name || 'OBD') + '...');
    const server = await device.gatt.connect();
    let rx = null, tx = null, noResp = false;
    for (const s of await server.getPrimaryServices()) {
      for (const c of await s.getCharacteristics()) {
        const p = c.properties;
        if (!rx && (p.notify || p.indicate)) rx = c;
        if (!tx && (p.write || p.writeWithoutResponse)) { tx = c; noResp = !p.write; }
      }
      if (rx && tx) break;
    }
    if (!rx || !tx) throw new Error('ไม่พบช่องรับส่งข้อมูลของ OBD ในอุปกรณ์นี้');
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged', e => onText(new TextDecoder().decode(e.target.value)));
    let wq = Promise.resolve();
    link = {
      write: text => {
        const data = new TextEncoder().encode(text);
        for (let i = 0; i < data.length; i += 20) {
          const chunk = data.slice(i, i + 20);
          wq = wq.then(() => noResp ? tx.writeValueWithoutResponse(chunk) : tx.writeValue(chunk)).catch(() => {});
        }
      },
      close: () => device.gatt.disconnect(),
    };
    return device.name || 'OBD';
  }

  function openSim() {
    const sim = Sim();
    link = {write: t => sim.write(t, onText), close() {}};
    return 'รถจำลอง';
  }

  function lost() {
    if (!link) return;
    link = null;
    dropPending();
    ev.disconnected();
  }

  // ---------- ตั้งค่า ELM327 ----------
  function hexOf(lines) {
    return lines.map(l => l.replace(/\s/g, '').toUpperCase());
  }

  // หาไบต์ข้อมูลของ Mode 01 จากคำตอบ (ข้ามบรรทัดอื่นๆ)
  function parse01(lines, p, n) {
    const want = '41' + p;
    for (const h of hexOf(lines)) {
      const i = h.indexOf(want);
      if (i < 0) continue;
      const bytes = [];
      for (let j = i + 4; j + 1 < h.length && bytes.length < n; j += 2) bytes.push(parseInt(h.substr(j, 2), 16));
      if (bytes.length === n && !bytes.some(isNaN)) return bytes;
    }
    return null;
  }

  async function init() {
    ev.status('กำลังตั้งค่า ELM327...');
    await send('ATZ', 6000);
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await send(c);
    const at = await send('ATAT2');
    if (at.join().includes('?')) await send('ATAT1');
    info.elm = (await send('ATI'))[0] || '';
    ev.status('กำลังหาโปรโตคอลรถ (ครั้งแรกอาจใช้ 5-10 วินาที)...');
    let first = await send('0100', 15000);
    if (!parse01(first, '00', 4)) first = await send('0100', 15000);
    const bm = parse01(first, '00', 4);
    if (!bm) throw new Error('ECU ไม่ตอบ — ติดเครื่องหรือเปิดสวิตช์ ON ก่อน (' + first.join(' ') + ')');
    const dp = (await send('ATDPN'))[0] || '';
    const n = parseInt(dp.replace('A', ''), 16);
    info.proto = dp;
    info.isCan = n >= 6 && n <= 9;
    // อ่านรายการค่าที่รถรองรับ (0100, 0120, 0140, ...)
    info.supported = new Set();
    let base = 0, map = bm;
    while (map) {
      const lines = base === 0 ? first : await send('01' + hex2(base), 4000);
      const bytes = base === 0 ? map : parse01(lines, hex2(base), 4);
      if (!bytes) break;
      for (let i = 0; i < 32; i++) if (bytes[i >> 3] & (0x80 >> (i & 7))) info.supported.add(hex2(base + i + 1));
      if (!info.supported.has(hex2(base + 0x20)) || base >= 0xC0) break;
      base += 0x20;
      map = true;
    }
    // ถ้า CAN ลองเติม "1" ท้ายคำสั่งให้ตัวเสียบตอบทันทีไม่ต้องรอ ECU อื่น (เร็วขึ้นมาก)
    info.count = false;
    if (info.isCan && info.supported.has('0D')) {
      const r = await send('010D1');
      info.count = !!parse01(r, '0D', 1);
    }
    ev.log(`ELM ${info.elm} · โปรโตคอล ${dp} · CAN ${info.isCan} · fast ${info.count} · รองรับ ${info.supported.size} ค่า`);
  }

  async function connect(mode) {
    info.sim = mode === 'sim';
    info.name = mode === 'sim' ? openSim() : NATIVE ? await openNative() : await openWeb();
    try { await init(); }
    catch (e) { disconnect(); throw e; }
    return info;
  }

  function disconnect() {
    const l = link;
    if (!l) return;
    link = null;
    dropPending();
    try { l.close(); } catch (e) {}
    ev.disconnected();
  }

  // อ่านค่าหนึ่งตัว คืนค่า {v, t} หรือ null / 'NODATA'
  async function read(src) {
    if (src.mode1) {
      const r = await send(src.cmd + (info.count ? '1' : ''));
      const t = (r.t0 + r.t1) / 2;
      const b = parse01(r, src.id, src.n);
      if (!b) return r.join().match(/NO ?DATA|\?/) ? 'NODATA' : null;
      return {v: src.f(b), t};
    }
    const r = await send(src.cmd);
    const v = src.parse(r);
    return v == null ? null : {v, t: (r.t0 + r.t1) / 2};
  }

  // ---------- รหัสข้อผิดพลาด ----------
  function decodeDtc(a, b) {
    return ('PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16) + (b >> 4).toString(16) + (b & 15).toString(16)).toUpperCase();
  }

  async function readDtcMode(mode, resp) {
    const r = await send(mode, 8000);
    if (r.join().match(/NO ?DATA/)) return [];
    const msgs = [];
    for (let l of hexOf(r)) {
      const cont = /^[1-9A-F]:/.test(l);
      l = l.replace(/^[0-9A-F]:/, '');
      if (/^[0-9A-F]{3}$/.test(l)) continue;                 // บรรทัดบอกความยาว (multi-frame)
      if (!cont && l.startsWith(resp)) msgs.push(l.slice(2 + (info.isCan ? 2 : 0)));
      else if (msgs.length) msgs[msgs.length - 1] += l;
    }
    const codes = [];
    for (const h of msgs)
      for (let j = 0; j + 3 < h.length; j += 4) {
        const a = parseInt(h.substr(j, 2), 16), b = parseInt(h.substr(j + 2, 2), 16);
        if (isNaN(a) || isNaN(b) || (a === 0 && b === 0)) continue;
        codes.push(decodeDtc(a, b));
      }
    return [...new Set(codes)];
  }

  async function readDtc() {
    const stored = await readDtcMode('03', '43');
    const pending = await readDtcMode('07', '47');
    const perm = await readDtcMode('0A', '4A');
    return {stored, pending, perm};
  }

  async function clearDtc() {
    const r = await send('04', 8000);
    return r.join().includes('44');
  }

  // สถานะไฟโชว์และความพร้อมของระบบตรวจสอบ (0101)
  async function readStatus() {
    const r = await send('0101', 4000);
    const b = parse01(r, '01', 4);
    if (!b) return null;
    const [A, B, C, D] = b;
    const mon = [];
    const add = (name, sup, inc) => { if (sup) mon.push({name, ok: !inc}); };
    add('มิสไฟร์', B & 1, B & 16);
    add('ระบบน้ำมัน', B & 2, B & 32);
    add('ชิ้นส่วนต่างๆ', B & 4, B & 64);
    if (!(B & 8)) {
      ['แคตาไลติก', 'แคตแบบอุ่น', 'ระบบไอระเหย', 'อากาศรอง', 'แอร์', 'เซ็นเซอร์ O2', 'ฮีตเตอร์ O2', 'EGR/VVT']
        .forEach((n, i) => add(n, C & (1 << i), D & (1 << i)));
    } else {
      ['แคต NMHC', 'NOx/SCR', '', 'แรงดันบูสต์', '', 'เซ็นเซอร์ไอเสีย', 'PM ฟิลเตอร์', 'EGR/VVT']
        .forEach((n, i) => n && add(n, C & (1 << i), D & (1 << i)));
    }
    return {mil: !!(A & 0x80), count: A & 0x7f, diesel: !!(B & 8), mon};
  }

  async function readVin() {
    const r = await send('0902', 6000);
    let s = '';
    for (let l of hexOf(r)) {
      l = l.replace(/^[0-9A-F]:/, '');
      if (/^[0-9A-F]{3}$/.test(l)) continue;
      const i = l.indexOf('4902');
      s += i >= 0 ? l.slice(i + 6) : l;
    }
    let txt = '';
    for (let j = 0; j + 1 < s.length; j += 2) {
      const c = parseInt(s.substr(j, 2), 16);
      if (c >= 48 && c <= 90) txt += String.fromCharCode(c);
    }
    return txt.length >= 17 ? txt.slice(-17) : (txt || null);
  }

  function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }

  return {NATIVE, ev, info, connect, disconnect, read, send, readDtc, clearDtc, readStatus, readVin,
    get connected() { return !!link; }, verbose: false};
})();

// ---------- รถจำลอง (ลองใช้แอพได้โดยไม่ต้องต่อรถ) ----------
function Sim() {
  const sup = ['04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '10', '11', '1F', '2F', '33', '42', '46', '49', '5C', '0A', '14', '15', '3C', '43', '45', '31'];
  const s = {speed: 0, rpm: 800, thr: 0, gear: 1, phase: 'idle', pt: 0, ect: 62, run: 0, last: performance.now(), dist: 0};
  const ratio = [0, 8.2, 13.5, 20, 27, 34, 41];     // km/h ต่อ 1000 rpm แต่ละเกียร์
  const plan = [['idle', 4], ['launch', 0], ['cruise', 5], ['brake', 0], ['idle', 3], ['roll', 0], ['brake', 0]];
  let step = 0;

  function tick() {
    const now = performance.now(), dt = Math.min(0.5, (now - s.last) / 1000);
    s.last = now; s.pt += dt; s.run += dt;
    const [ph, dur] = plan[step];
    let a = 0;
    if (ph === 'idle') { s.thr = 0; a = -s.speed * 0.5; if (s.pt > dur) next(); }
    else if (ph === 'launch' || ph === 'roll') {
      const top = ph === 'launch' ? 150 : 125;
      s.thr = 100;
      a = Math.max(0.5, 4.2 - s.speed / 50) * 3.6;          // km/h ต่อวินาที
      if (s.speed >= top) next();
    } else if (ph === 'cruise') { s.thr = 18; a = (95 - s.speed) * 0.3; if (s.pt > dur) next(); }
    else if (ph === 'brake') { s.thr = 0; a = -8.5 * 3.6; if (s.speed <= 0) { s.speed = 0; next(); } }
    s.speed = Math.max(0, s.speed + a * dt);
    s.dist += s.speed / 3.6 * dt;
    // เกียร์และรอบ
    if (s.speed < 3) { s.gear = 1; s.rpm += ((s.thr ? 2500 : 780) - s.rpm) * Math.min(1, dt * 4); }
    else {
      let r = s.speed / ratio[s.gear] * 1000;
      if (r > 6400 && s.gear < 6) s.gear++;
      else if (r < 1300 && s.gear > 1) s.gear--;
      r = s.speed / ratio[s.gear] * 1000;
      s.rpm = Math.max(780, r);
    }
    s.ect = Math.min(91, s.ect + dt * 0.4);
  }
  function next() { step = (step + 1) % plan.length; s.pt = 0; }

  const noise = k => (Math.random() - 0.5) * k;
  const h = (n, len = 1) => Math.max(0, Math.min(len === 2 ? 65535 : 255, Math.round(n))).toString(16).toUpperCase().padStart(len * 2, '0');

  function data(p) {
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
      case '10': return h(s.rpm / 1000 * load * 0.12 * 100, 2);
      case '11': return h((12 + s.thr * 0.85) * 2.55);
      case '14': case '15': return h(0.1 + Math.random() * 0.75 * 200) + '80';
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

  function bitmap(base) {
    let v = [0, 0, 0, 0];
    const all = sup.concat(['20', '40']);
    for (const p of all) {
      const i = parseInt(p, 16) - base - 1;
      if (i >= 0 && i < 32) v[i >> 3] |= 0x80 >> (i & 7);
    }
    return v.map(x => h(x)).join('');
  }

  function answer(cmd) {
    cmd = cmd.trim().toUpperCase();
    if (cmd === 'ATZ') return 'ELM327 v1.5';
    if (cmd === 'ATI') return 'ELM327 v1.5 (จำลอง)';
    if (cmd === 'ATRV') return (14.1 + noise(0.2)).toFixed(1) + 'V';
    if (cmd === 'ATDPN') return 'A6';
    if (cmd.startsWith('AT')) return 'OK';
    if (cmd === '03') return '430201710420';
    if (cmd === '07') return '47010300';
    if (cmd === '0A') return '4A00';
    if (cmd === '04') return '44';
    if (cmd === '0101') return '41018207650' + '4';
    if (cmd === '0902') return '014\n0:4902014D5230\n1:42413343463130\n2:30303132333435';
    const m = cmd.match(/^01([0-9A-F]{2})1?$/);
    if (m) {
      const p = m[1];
      if (['00', '20', '40'].includes(p)) return '41' + p + bitmap(parseInt(p, 16));
      const d = sup.includes(p) && data(p);
      return d ? '41' + p + d : 'NO DATA';
    }
    return '?';
  }

  return {
    write(text, cb) {
      const cmd = text.replace(/\r/g, '');
      tick();
      const lat = cmd.startsWith('AT') ? 15 : 35 + Math.random() * 25;
      setTimeout(() => cb(answer(cmd) + '\r\r>'), lat);
    },
  };
}
