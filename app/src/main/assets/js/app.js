// ---------- ตัวช่วย ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const NATIVE = OBD.NATIVE;

// ---------- การตั้งค่า (เก็บในเครื่อง) ----------
const DEF = {
  theme: 'midnight', dash: clone(PRESETS), dashIdx: 0, shiftRpm: 6000, redline: 6500, fuel: 'gas',
  sound: true, vibrate: true, hudMirror: false, raceMode: '0-100', runs: [], graph: ['0C', '0D', '11'], graphWin: 60,
  orient: 'auto', trip: null,
};
let cfg = (() => {
  try { return Object.assign(clone(DEF), JSON.parse(localStorage.getItem('obd2') || '{}')); }
  catch (e) { return clone(DEF); }
})();
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('obd2', JSON.stringify(cfg)); } catch (e) {} }, 300);
}

// ---------- ค่าที่อ่านได้ ----------
const V = {};      // id -> {v, t, min, max, hist: [[t, v]], stale}
const HIST_MS = 310000;
function setVal(id, v, t = now()) {
  if (v == null || !isFinite(v)) return;
  let o = V[id];
  if (!o) o = V[id] = {v, t, min: v, max: v, hist: []};
  o.v = v; o.t = t; o.stale = false;
  if (v < o.min) o.min = v;
  if (v > o.max) o.max = v;
  o.hist.push([t, v]);
  if (o.hist.length > 50 && o.hist[0][0] < t - HIST_MS) o.hist.splice(0, o.hist.findIndex(h => h[0] >= t - HIST_MS));
}
function val(id, maxAge = 5000) {
  const o = V[id];
  return o && !o.stale && now() - o.t < maxAge ? o.v : null;
}
function fmt(src, v) {
  if (v == null) return '--';
  if (src.fmt) return src.fmt(v);
  const s = v.toFixed(src.d);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}
function alarm(src, v) {
  return v != null && ((src.hi != null && v > src.hi) || (src.lo != null && v < src.lo));
}
function supported(id) {
  const s = SRC[id];
  if (!s) return false;
  if (!OBD.connected || !s.mode1) return true;
  return OBD.info.supported.has(id);
}
function fuelSrc() { return supported('5E') && OBD.connected && OBD.info.supported.has('5E') ? '5E' : '10'; }

// ค่าที่ต้องอ่านเพื่อแสดง id นี้
function expand(id, out) {
  const s = SRC[id];
  if (!s) return;
  if (!s.calc) { out.add(id); return; }
  for (const n of s.need) {
    if (n === '5E' || n === '10') { out.add(fuelSrc()); continue; }
    out.add(n);
  }
}

// ---------- การอ่านค่าวนรอบ ----------
const poll = {last: {}, back: {}, n: 0, hz: 0, hzT: now(), list: [], listT: 0};
function wantList() {
  const out = new Set(['0D']);
  const p = page;
  if (hudOn || p === 'race') { out.add('0D'); out.add('0C'); }
  if (p === 'dash') for (const w of curDash().widgets) expand(w.id, out);
  if (p === 'live') { for (const id of OBD.info.supported) if (SRC[id]) out.add(id); out.add('RV'); }
  if (p === 'graph') for (const id of cfg.graph) expand(id, out);
  out.add(fuelSrc());
  return [...out].filter(id => SRC[id] && (!SRC[id].mode1 || OBD.info.supported.has(id)));
}
function period(id) {
  if (page === 'race' || hudOn) return id === '0D' || id === '0C' ? 0 : 3000;
  if (page === 'live') return id === 'RV' ? 2000 : 0;
  const s = SRC[id];
  if (id === 'RV' || id === '33' || s.cat === 'info') return 4000;
  if (id === '0D' || id === '0C' || s.fast) return 0;
  if (s.cat === 'temp' || id === '2F') return 2000;
  return 400;
}
async function pollLoop() {
  while (OBD.connected) {
    const t = now();
    if (t - poll.listT > 500) { poll.list = wantList(); poll.listT = t; }
    let best = null, bs = -Infinity;
    for (const id of poll.list) {
      if ((poll.back[id] || 0) > t) continue;
      const due = t - (poll.last[id] || 0) - period(id);
      if (due > bs) { bs = due; best = id; }
    }
    if (!best || bs < 0) { await sleep(30); continue; }
    poll.last[best] = t;
    const r = await OBD.read(SRC[best]);
    if (r === 'NODATA') { poll.back[best] = now() + 5000; if (V[best]) V[best].stale = true; }
    else if (r) { setVal(best, r.v, r.t); onSample(best, r.v, r.t); }
    poll.n++;
    if (now() - poll.hzT > 1000) { poll.hz = poll.n * 1000 / (now() - poll.hzT); poll.n = 0; poll.hzT = now(); }
  }
}

// ---------- ค่าคำนวณ ----------
const spdWin = [];
const trip = Object.assign({dist: 0, time: 0, fuel: 0, max: 0}, cfg.trip || {});
let lastSpd = null;
function lph() {
  const e = val('5E');
  if (e != null) return e;
  const maf = val('10');
  if (maf == null) return null;
  return cfg.fuel === 'diesel' ? maf * 3600 / (14.5 * 832) : maf * 3600 / (14.7 * 745);
}
function onSample(id, v, t) {
  if (id === '0D') {
    if (lastSpd) {
      const dt = (t - lastSpd.t) / 1000;
      if (dt > 0 && dt < 5) {
        trip.dist += (v + lastSpd.v) / 2 * dt / 3600;
        trip.time += dt;
        const f = lph();
        if (f != null) trip.fuel += f * dt / 3600;
        if (v > trip.max) trip.max = v;
      }
    }
    lastSpd = {v, t};
    spdWin.push([t, v]);
    while (spdWin.length > 2 && spdWin[0][0] < t - 800) spdWin.shift();
    if (spdWin.length >= 2) {
      const [a, b] = [spdWin[0], spdWin[spdWin.length - 1]];
      if (b[0] > a[0]) setVal('ACC', (b[1] - a[1]) / 3.6 / ((b[0] - a[0]) / 1000) / 9.81, t);
    }
    race.update(v, t);
    cfg.trip = trip;
    if (Math.random() < 0.05) save();
  }
  if (id === '0C') rpmUpdate(v);
  // ค่าคำนวณอื่นๆ
  const f = lph();
  if (f != null) setVal('LPH', f, t);
  const sp = val('0D');
  if (f != null && sp != null) {
    setVal('KML', sp < 1 ? 0 : Math.min(99, sp / Math.max(f, 0.05)), t);
    if (sp >= 3) setVal('L100', Math.min(99, f / sp * 100), t);
  }
  const map = val('0B');
  if (map != null) setVal('BOOST', (map - (val('33', 60000) ?? 101.3)) / 100, t);
  const maf = val('10');
  if (maf != null) setVal('POW', maf * 1.32, t);
  if (id === '0D') {
    setVal('TDIST', trip.dist, t); setVal('TTIME', trip.time, t); setVal('TMAX', trip.max, t);
    setVal('TAVG', trip.time > 5 ? trip.dist / (trip.time / 3600) : 0, t);
    setVal('TFUEL', trip.fuel, t);
    if (trip.fuel > 0.01) setVal('TKML', trip.dist / trip.fuel, t);
  }
}

// ---------- เสียง / สั่น ----------
let actx = null;
function beep(f = 880, ms = 120, n = 1) {
  if (!cfg.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * (ms + 80) / 1000;
      o.frequency.value = f; o.type = 'square';
      g.gain.setValueAtTime(0.18, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + ms / 1000 + 0.02);
    }
  } catch (e) {}
}
function buzz(p) { if (cfg.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

// ---------- ไฟเตือนเปลี่ยนเกียร์ ----------
const LEDS = 10;
let shiftBeepT = 0;
function rpmUpdate(rpm) {
  if (rpm >= cfg.shiftRpm && now() - shiftBeepT > 700 && (page === 'race' || hudOn)) { shiftBeepT = now(); beep(1400, 60); }
}
function renderShift() {
  const rpm = val('0C', 2000) || 0;
  const box = $('#shift');
  const start = cfg.shiftRpm - 2500;
  const lit = clamp(Math.ceil((rpm - start) / 2500 * LEDS), 0, LEDS);
  box.classList.toggle('flash', rpm >= cfg.shiftRpm);
  [...box.children].forEach((e, i) => { e.className = i < lit ? (i < 4 ? 'g' : i < 7 ? 'y' : 'r') : ''; });
}

// ---------- จับเวลาแบบรถแข่ง ----------
const race = {
  state: 'idle', mode: null, t0: 0, dist: 0, prev: null, g: 0, rpm: 0, res: null, msg: '',
  get m() { return RACE_MODES.find(x => x.id === cfg.raceMode) || RACE_MODES[0]; },
  arm() {
    if (!OBD.connected) { toast('เชื่อมต่อรถก่อน (หรือใช้โหมดจำลอง)'); return; }
    this.state = 'armed'; this.res = null; this.dist = 0; this.g = 0; this.rpm = 0; this.prev = null;
    this.msg = 'กำลังรอ...'; beep(660, 80);
  },
  cancel() { this.state = 'idle'; this.msg = 'ยกเลิกแล้ว'; },
  start(t0, msg) {
    this.state = 'running'; this.t0 = t0; this.dist = 0; this.g = 0; this.rpm = 0; this.msg = msg || 'ไป! ไป! ไป!';
    beep(1200, 150); buzz(80);
  },
  finish(tc, extra) {
    const time = (tc - this.t0) / 1000;
    const m = this.m;
    const r = Object.assign({mode: m.id, time, dist: this.dist, g: this.g, rpm: this.rpm, at: Date.now(), sim: OBD.info.sim}, extra || {});
    const best = bestRun(m.id);
    r.best = !best || time < best.time;
    cfg.runs.unshift(r);
    cfg.runs = cfg.runs.slice(0, 200);
    save();
    this.res = r; this.state = 'done';
    this.msg = r.best ? '🏆 สถิติใหม่!' : 'เสร็จแล้ว';
    beep(1600, 120, r.best ? 3 : 2); buzz([100, 60, 100]);
    renderRuns();
  },
  update(v, t) {
    const p = this.prev;
    this.prev = {v, t};
    if (this.state === 'idle' || this.state === 'done' || !p) return;
    const m = this.m, dt = (t - p.t) / 1000;
    if (dt <= 0) return;
    const seg = (p.v + v) / 2 / 3.6 * dt;
    const cross = (x) => p.t + (x - p.v) / (v - p.v) * (t - p.t);      // เวลาที่ความเร็วผ่านค่า x
    if (this.state === 'running') {
      this.dist += seg;
      const vr = val('0C', 1500);
      if (vr != null && vr > this.rpm) this.rpm = vr;
      const a = val('ACC', 1500);
      if (a != null && Math.abs(a) > Math.abs(this.g)) this.g = a;
      if ((t - this.t0) > 90000) { this.state = 'armed'; this.msg = 'นานเกินไป เริ่มใหม่'; return; }
    }
    if (m.type === 'accel' || m.type === 'dist') {
      if (this.state === 'armed') {
        if (v === 0) { this.state = 'ready'; this.msg = 'พร้อม! ออกตัวได้เลย'; beep(990, 80); }
        else this.msg = 'หยุดรถให้สนิทก่อน';
      } else if (this.state === 'ready') {
        // ประมาณเวลาที่ล้อเริ่มหมุน (อัตราเร่งออกตัวราว 4 m/s²)
        if (v > 0) {
          const t0 = clamp(t - v / 14.4 * 1000, p.t, t);
          this.start(t0);
          this.dist = v / 2 / 3.6 * (t - t0) / 1000;
        }
      } else if (this.state === 'running') {
        if (m.type === 'accel' && v >= m.to) this.finish(cross(m.to));
        else if (m.type === 'dist' && this.dist >= m.dist) {
          const frac = seg > 0 ? clamp(1 - (this.dist - m.dist) / seg, 0, 1) : 1;
          this.dist = m.dist;
          this.finish(p.t + frac * (t - p.t), {trap: p.v + frac * (v - p.v)});
        } else if (v === 0 && t - this.t0 > 1500) { this.state = 'ready'; this.msg = 'รถหยุด — ออกตัวใหม่ได้เลย'; }
      }
    } else if (m.type === 'roll') {
      if (this.state === 'armed') {
        if (v < m.from) { this.state = 'ready'; this.msg = `เร่งผ่าน ${m.from} ได้เลย`; beep(990, 80); }
        else this.msg = `ลดความเร็วให้ต่ำกว่า ${m.from} ก่อน`;
      } else if (this.state === 'ready') {
        if (v >= m.from && p.v < m.from) this.start(cross(m.from), 'เร่ง!');
      } else if (this.state === 'running') {
        if (v >= m.to) this.finish(cross(m.to));
        else if (v < m.from - 3) { this.state = 'ready'; this.msg = `ยกเลิก — เร่งผ่าน ${m.from} ใหม่`; }
      }
    } else if (m.type === 'brake') {
      if (this.state === 'armed') {
        if (v >= m.from) { this.state = 'ready'; this.msg = 'เบรกได้เลยเมื่อพร้อม'; beep(990, 80); }
        else this.msg = `เร่งให้เกิน ${m.from} ก่อน`;
      } else if (this.state === 'ready') {
        if (v < m.from && p.v >= m.from) this.start(cross(m.from), 'เบรก!');
      } else if (this.state === 'running') {
        if (v === 0) {
          // ประมาณจุดหยุดจริงจากอัตราหน่วงที่ผ่านมา
          const el = (p.t - this.t0) / 1000;
          const dec = el > 0.2 ? (m.from - p.v) / el : 30;
          const tz = Math.min(t, p.t + p.v / Math.max(dec, 5) * 1000);
          this.dist += -seg + p.v / 2 / 3.6 * (tz - p.t) / 1000;
          this.finish(tz);
        } else if (v > m.from + 5) { this.state = 'ready'; this.msg = 'ยกเลิก — เบรกใหม่'; }
      }
    }
  },
};
function bestRun(mode) {
  let b = null;
  for (const r of cfg.runs) if (r.mode === mode && !r.sim && (!b || r.time < b.time)) b = r;
  return b;
}

// ---------- จับเวลารอบ (Lap) ----------
const lap = {on: false, t0: 0, lapT0: 0, acc: 0, laps: []};
function lapTime(ms) {
  const s = ms / 1000, m = Math.floor(s / 60);
  return m + ':' + (s % 60).toFixed(2).padStart(5, '0');
}
function lapGo() {
  if (!lap.on) { const t = now(); lap.on = true; lap.t0 = t - lap.acc; lap.lapT0 = lap.lapT0 ? t - (lap.pausedLap || 0) : t; beep(1200, 100); }
  else { lap.on = false; lap.acc = now() - lap.t0; lap.pausedLap = now() - lap.lapT0; }
  renderLapBtns();
}
function lapLap() {
  if (!lap.on) return;
  const t = now();
  lap.laps.push(t - lap.lapT0);
  lap.lapT0 = t;
  const best = Math.min(...lap.laps);
  const last = lap.laps[lap.laps.length - 1];
  beep(last === best ? 1600 : 1000, 100, last === best ? 2 : 1); buzz(60);
  renderLaps();
}
function lapReset() {
  Object.assign(lap, {on: false, t0: 0, lapT0: 0, acc: 0, laps: [], pausedLap: 0});
  $('#lapTmr').textContent = $('#lapTot').textContent = '0:00.00';
  renderLapBtns(); renderLaps();
}
function renderLapBtns() {
  $('#lapGo').textContent = lap.on ? 'หยุด' : lap.acc ? 'ต่อ' : 'เริ่ม';
  $('#lapGo').className = 'big-btn ' + (lap.on ? 'bad' : 'pri');
  $('#lapLap').disabled = !lap.on;
}
function renderLaps() {
  const best = lap.laps.length ? Math.min(...lap.laps) : 0;
  $('#lapBest').textContent = best ? lapTime(best) : '--';
  $('#lapN').textContent = lap.laps.length + (lap.on || lap.acc ? 1 : 0);
  $('#laps').innerHTML = lap.laps.map((l, i) => ({l, i})).reverse().map(({l, i}) =>
    `<div class="r ${l === best ? 'best' : ''}"><span class="t">${lapTime(l)}</span><span class="m">รอบ ${i + 1}${l === best ? ' · ดีที่สุด' : ' · +' + ((l - best) / 1000).toFixed(2) + ' วิ'}</span></div>`).join('');
}

// ---------- หน้า / แท็บ ----------
let page = 'dash';
const TITLES = {dash: 'แดชบอร์ด', race: 'จับเวลา', live: 'ค่าทั้งหมด', graph: 'กราฟ', diag: 'ตรวจเช็ค'};
function show(p) {
  page = p;
  poll.listT = 0;
  $$('.page').forEach(e => e.classList.toggle('on', e.id === 'p-' + p));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.page === p));
  $('#title').textContent = TITLES[p];
  if (p !== 'dash') setEditing(false);
  if (p === 'live') buildLive();
  if (p === 'graph') buildGraph();
  if (p === 'race') { buildRace(); renderRuns(); }
  if (p === 'diag') { renderCarInfo(); if (OBD.connected && !diagDone) { diagDone = true; diagScan(); } }
  window.scrollTo(0, 0);
}

// ---------- แดชบอร์ด ----------
const curDash = () => cfg.dash[cfg.dashIdx] || cfg.dash[0];
let editing = false;
const TYPES = ['num', 'bar', 'gauge', 'graph'];
const TYPE_NAME = {num: 'ตัวเลข', bar: 'แถบ', gauge: 'เกจ', graph: 'กราฟ'};

function buildDashChips() {
  if (!cfg.dash.length) cfg.dash = clone(PRESETS);
  cfg.dashIdx = clamp(cfg.dashIdx, 0, cfg.dash.length - 1);
  $('#dashChips').innerHTML = cfg.dash.map((d, i) => `<button class="chip ${i === cfg.dashIdx ? 'on' : ''}" data-dash="${i}">${esc(d.name)}</button>`).join('') +
    `<button class="chip" data-act="dash-add">+ หน้าใหม่</button>`;
}
function gaugeSvg(src, size) {
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = (135 + i * 27) * Math.PI / 180, r1 = i % 2 ? 72 : 68, r2 = 78;
    ticks.push(`<line class="g-tick" x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke-width="${i % 2 ? 1 : 2}"/>`);
    if (i % 2 === 0 && i > 0 && i < 10 && size === 2) {
      let lv = src.min + (src.max - src.min) * i / 10;
      lv = src.max >= 1000 ? +(lv / 1000).toFixed(1) : Math.round(lv * 10) / 10;
      ticks.push(`<text class="g-tl" x="${100 + 58 * Math.cos(a)}" y="${103 + 58 * Math.sin(a)}" text-anchor="middle">${lv}</text>`);
    }
  }
  const red = src.id === '0C' ? cfg.redline : src.hi;
  const rp = red != null ? clamp((red - src.min) / (src.max - src.min) * 100, 0, 100) : null;
  const arc = 'M43.43 156.57A80 80 0 1 1 156.57 156.57';
  return `<svg viewBox="0 0 200 172">
    <path class="g-bg" d="${arc}" pathLength="100" fill="none" stroke-width="12" stroke-linecap="round"/>
    ${rp != null && rp < 100 ? `<path class="g-red" d="${arc}" pathLength="100" fill="none" stroke-width="12" stroke-dasharray="0 ${rp} ${100 - rp} 100"/>` : ''}
    <path class="g-fg" d="${arc}" pathLength="100" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="0 100"/>
    ${ticks.join('')}
    <line class="g-needle" x1="100" y1="100" x2="152" y2="100" transform="rotate(135 100 100)"/>
    <circle cx="100" cy="100" r="6" fill="var(--fg)"/>
    <text class="g-val" x="100" y="146" text-anchor="middle">--</text>
    <text class="g-unit" x="100" y="164" text-anchor="middle">${esc(src.unit)}</text>
  </svg>`;
}
function buildDash() {
  buildDashChips();
  const g = $('#grid');
  g.classList.toggle('editing', editing);
  g.innerHTML = '';
  curDash().widgets.forEach((w, i) => {
    const src = SRC[w.id];
    if (!src) return;
    const e = document.createElement('div');
    e.className = `wd ${w.type} s${w.size}`;
    e.dataset.i = i;
    let inner = `<div class="lbl">${esc(src.name)}</div>`;
    if (w.type === 'gauge') inner += gaugeSvg(src, w.size);
    else inner += `<div class="val"><span class="v">--</span><span class="unit">${esc(src.unit)}</span></div><div class="mm"></div>`;
    if (w.type === 'bar') inner += '<div class="bar"><i></i></div>';
    if (w.type === 'graph') inner += '<canvas></canvas>';
    inner += `<div class="edit-tools"><button data-w="left">◀</button><button data-w="right">▶</button><button data-w="type">${TYPE_NAME[w.type]}</button><button data-w="size">${w.size === 2 ? '½' : '⤢'}</button><button class="x" data-w="del">✕</button></div>`;
    e.innerHTML = inner;
    e._w = w; e._src = src;
    e._v = e.querySelector('.v'); e._mm = e.querySelector('.mm'); e._bar = e.querySelector('.bar i');
    e._gfg = e.querySelector('.g-fg'); e._gval = e.querySelector('.g-val'); e._needle = e.querySelector('.g-needle');
    e._cv = e.querySelector('canvas');
    g.appendChild(e);
  });
  const add = document.createElement('button');
  add.className = 'addw'; add.dataset.act = 'w-add'; add.textContent = '+ เพิ่มวิดเจ็ต';
  g.appendChild(add);
}
function renderDash() {
  for (const e of $('#grid').children) {
    if (!e._src) continue;
    const src = e._src, w = e._w;
    const na = !!(OBD.connected && src.mode1 && !OBD.info.supported.has(src.id));
    const v = na ? null : val(src.id, src.calc && src.cat === 'trip' ? 1e9 : 5000);
    e.classList.toggle('na', na);
    e.classList.toggle('alarm', alarm(src, v));
    const txt = fmt(src, v);
    const pctv = v == null ? 0 : clamp((v - src.min) / (src.max - src.min) * 100, 0, 100);
    if (w.type === 'gauge') {
      if (e._gval.textContent !== txt) e._gval.textContent = txt;
      e._gfg.setAttribute('stroke-dasharray', `${pctv} 100`);
      e._needle.setAttribute('transform', `rotate(${135 + pctv * 2.7} 100 100)`);
    } else {
      if (e._v.textContent !== txt) e._v.textContent = txt;
      const o = V[src.id];
      if (e._mm && o && !src.fmt && src.cat !== 'trip') e._mm.innerHTML = `▲${fmt(src, o.max)}<br>▼${fmt(src, o.min)}`;
      if (e._bar) e._bar.style.width = pctv + '%';
      if (e._cv) drawSpark(e._cv, src, 60000);
    }
  }
}
function drawSpark(cv, src, win) {
  const o = V[src.id], dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  if (!o || o.hist.length < 2) return;
  const t1 = now(), t0 = t1 - win;
  const pts = o.hist.filter(h => h[0] >= t0);
  if (pts.length < 2) return;
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const css = getComputedStyle(document.documentElement);
  const acc = css.getPropertyValue('--acc').trim();
  c.beginPath();
  pts.forEach((p, i) => {
    const x = (p[0] - t0) / win * W, y = H - 3 - (p[1] - lo) / (hi - lo) * (H - 6);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.strokeStyle = acc; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  c.lineTo((pts[pts.length - 1][0] - t0) / win * W, H); c.lineTo((pts[0][0] - t0) / win * W, H); c.closePath();
  c.globalAlpha = 0.15; c.fillStyle = acc; c.fill(); c.globalAlpha = 1;
}
function setEditing(on) {
  editing = on;
  $('#editBtn').textContent = on ? '✓ เสร็จ' : '✎ แก้ไข';
  $('#editBtn').classList.toggle('pri', on);
  $('#editBar').style.display = on ? 'flex' : 'none';
  $('#grid').classList.toggle('editing', on);
  if (!on) save();
}
function widgetAction(i, act) {
  const ws = curDash().widgets, w = ws[i];
  if (!w) return;
  if (act === 'left' && i > 0) [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]];
  if (act === 'right' && i < ws.length - 1) [ws[i + 1], ws[i]] = [ws[i], ws[i + 1]];
  if (act === 'type') w.type = TYPES[(TYPES.indexOf(w.type) + 1) % TYPES.length];
  if (act === 'size') w.size = w.size === 2 ? 1 : 2;
  if (act === 'del') ws.splice(i, 1);
  save(); buildDash();
}
function defaultType(src) { return src.id === '0C' || src.id === 'BOOST' ? 'gauge' : src.unit === '%' ? 'bar' : 'num'; }

// ---------- ตัวเลือกค่า ----------
function pickSource(title, cb) {
  const ids = Object.keys(SRC);
  const draw = q => {
    q = (q || '').toLowerCase();
    let html = '';
    for (const cat of Object.keys(CAT)) {
      const items = ids.filter(id => SRC[id].cat === cat && (!q || (SRC[id].name + ' ' + SRC[id].unit + ' ' + id).toLowerCase().includes(q)));
      if (!items.length) continue;
      html += `<div class="cat">${CAT[cat]}</div>`;
      html += items.map(id => {
        const s = SRC[id], ok = supported(id);
        return `<div class="it ${ok ? '' : 'na'}" data-pick="${id}"><div class="n"><div>${esc(s.name)}</div><small>${esc(s.unit || '')}${s.mode1 ? ' · PID ' + id : ''}${ok ? '' : ' · รถคันนี้ไม่รองรับ'}${s.note ? ' · ' + esc(s.note) : ''}</small></div><div class="v">+</div></div>`;
      }).join('');
    }
    $('#pickList').innerHTML = html || '<div class="hint">ไม่พบ</div>';
  };
  openSheet(title, `<input class="search" id="pickQ" placeholder="ค้นหา"><div class="list" id="pickList"></div>`);
  draw('');
  $('#pickQ').oninput = e => draw(e.target.value);
  $('#pickList').onclick = e => { const it = e.target.closest('[data-pick]'); if (it) { closeSheet(); cb(it.dataset.pick); } };
}

// ---------- หน้าค่าทั้งหมด ----------
function buildLive() {
  const q = ($('#liveSearch').value || '').toLowerCase();
  const ids = Object.keys(SRC).filter(id => !SRC[id].calc && (!OBD.connected || supported(id)) &&
    (!q || (SRC[id].name + ' ' + SRC[id].unit + ' ' + id).toLowerCase().includes(q)));
  let html = '';
  for (const cat of Object.keys(CAT)) {
    const items = ids.filter(id => SRC[id].cat === cat);
    if (!items.length) continue;
    html += `<div class="cat">${CAT[cat]}</div>` + items.map(id =>
      `<div class="it" data-live="${id}"><div class="n"><div>${esc(SRC[id].name)}</div><small></small></div><div class="v"><span>--</span><small>${esc(SRC[id].unit)}</small></div><button class="ico ghost" data-star="${id}">☆</button></div>`).join('');
  }
  $('#liveList').innerHTML = html;
  $('#liveCount').textContent = OBD.connected ? `รถรองรับ ${ids.length} ค่า` : 'เชื่อมต่อเพื่อดูค่าที่รถรองรับ';
  $$('#liveList [data-live]').forEach(e => { e._src = SRC[e.dataset.live]; e._v = e.querySelector('.v span'); e._s = e.querySelector('small'); });
}
function renderLive() {
  for (const e of $$('#liveList [data-live]')) {
    const src = e._src, v = val(src.id, 15000), o = V[src.id];
    const t = fmt(src, v);
    if (e._v.textContent !== t) e._v.textContent = t;
    e.classList.toggle('alarm', alarm(src, v));
    if (o) e._s.textContent = `ต่ำสุด ${fmt(src, o.min)} · สูงสุด ${fmt(src, o.max)}`;
  }
  const f = lph();
  const items = [
    ['ระยะทาง', trip.dist.toFixed(2) + ' km'], ['เวลาขับ', fmtDur(trip.time)],
    ['เฉลี่ย', (trip.time > 5 ? trip.dist / (trip.time / 3600) : 0).toFixed(0) + ' km/h'],
    ['สูงสุด', trip.max.toFixed(0) + ' km/h'], ['น้ำมันที่ใช้', trip.fuel.toFixed(2) + ' L'],
    ['เฉลี่ย', trip.fuel > 0.01 ? (trip.dist / trip.fuel).toFixed(1) + ' km/L' : '--'],
  ];
  $('#trip').innerHTML = items.map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('') +
    `<div style="grid-column:1/-1">ตอนนี้<b style="font-size:15px">${f != null ? f.toFixed(1) + ' L/h' : '--'} · ${val('KML') != null ? val('KML').toFixed(1) + ' km/L' : '--'}</b></div>`;
}

// ---------- กราฟ ----------
const GCOL = ['#2f81f7', '#f0883e', '#3fb950', '#db61a2'];
let gPaused = false, gFrozenT = 0;
function buildGraph() {
  $('#gWin').innerHTML = [[30, '30 วิ'], [60, '1 นาที'], [120, '2 นาที'], [300, '5 นาที']]
    .map(([s, n]) => `<button class="chip ${cfg.graphWin === s ? 'on' : ''}" data-gwin="${s}">${n}</button>`).join('');
  $('#legend').innerHTML = cfg.graph.map((id, i) => SRC[id] ? `<span><i style="background:${GCOL[i]}"></i>${esc(SRC[id].name)} <b data-gv="${id}">--</b> ${esc(SRC[id].unit)} <button class="ico ghost" data-gdel="${i}" style="padding:2px 6px">✕</button></span>` : '').join('');
}
function renderGraph() {
  const cv = $('#chart'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--line').trim(), mut = css.getPropertyValue('--mut').trim();
  const win = cfg.graphWin * 1000, t1 = gPaused ? gFrozenT : now(), t0 = t1 - win;
  c.strokeStyle = line; c.lineWidth = 1; c.fillStyle = mut; c.font = '11px system-ui';
  for (let i = 1; i < 4; i++) { const y = H * i / 4; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  for (let i = 0; i <= 5; i++) {
    const x = W * i / 5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
    if (i < 5) c.fillText('-' + Math.round(cfg.graphWin * (1 - i / 5)) + 's', x + 4, H - 6);
  }
  cfg.graph.forEach((id, i) => {
    const o = V[id], src = SRC[id];
    const gv = $(`[data-gv="${id}"]`);
    if (gv) gv.textContent = fmt(src, val(id));
    if (!o) return;
    const pts = o.hist.filter(h => h[0] >= t0 && h[0] <= t1);
    if (pts.length < 2) return;
    let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    c.beginPath();
    pts.forEach((p, j) => { const x = (p[0] - t0) / win * W, y = H - (p[1] - lo) / (hi - lo) * H; j ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = GCOL[i]; c.lineWidth = 2.2; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = GCOL[i]; c.fillText(fmt(src, hi - pad) + ' ' + src.unit, 6, 14 + i * 14);
  });
}

// ---------- หน้าจับเวลา ----------
function buildRace() {
  $('#raceChips').innerHTML = RACE_MODES.map(m => `<button class="chip ${cfg.raceMode === m.id ? 'on' : ''}" data-race="${m.id}">${m.name}</button>`).join('');
  if (!$('#shift').children.length) $('#shift').innerHTML = '<i></i>'.repeat(LEDS);
}
function renderRace() {
  const v = val('0D', 2000), rpm = val('0C', 2000);
  $('#rSpd').textContent = v == null ? '--' : v.toFixed(0);
  $('#rRpm').textContent = rpm == null ? '--' : rpm.toFixed(0);
  $('#rRpmBar').style.width = clamp((rpm || 0) / cfg.redline * 100, 0, 100) + '%';
  renderShift();
  const st = race.state;
  $('#racebox').className = 'card racebox ' + st;
  let t = 0;
  if (st === 'running') t = (now() - race.t0) / 1000;
  else if (st === 'done' && race.res) t = race.res.time;
  $('#rTmr').textContent = t.toFixed(2);
  $('#rDist').textContent = (st === 'done' && race.res ? race.res.dist : race.dist).toFixed(0) + ' ม.';
  $('#rG').textContent = Math.abs(race.g).toFixed(2);
  let msg = race.msg;
  if (st === 'idle') msg = msg || 'เลือกโหมดแล้วกด "พร้อม"';
  if (st === 'done' && race.res && race.res.trap) msg += ` · ความเร็วปลาย ${race.res.trap.toFixed(0)} km/h`;
  $('#rMsg').textContent = msg;
  const btn = $('#armBtn');
  const label = st === 'idle' || st === 'done' ? (st === 'done' ? 'อีกครั้ง' : 'พร้อม') : 'ยกเลิก';
  if (btn.textContent !== label) { btn.textContent = label; btn.className = 'big-btn ' + (label === 'ยกเลิก' ? 'bad' : 'pri'); }
  // นาฬิกา lap
  if (lap.on || lap.acc) {
    const tn = now();
    $('#lapTmr').textContent = lapTime(lap.on ? tn - lap.lapT0 : lap.pausedLap || 0);
    $('#lapTot').textContent = lapTime(lap.on ? tn - lap.t0 : lap.acc);
  }
}
function renderRuns() {
  const m = race.m;
  const runs = cfg.runs.filter(r => r.mode === m.id);
  const best = bestRun(m.id);
  $('#runs').innerHTML = runs.length ? runs.slice(0, 30).map(r => {
    const d = new Date(r.at);
    const extra = [r.trap ? `ปลาย ${r.trap.toFixed(0)} km/h` : '', m.type === 'brake' || m.type === 'dist' ? `${r.dist.toFixed(1)} ม.` : '',
      r.g ? `${Math.abs(r.g).toFixed(2)} g` : '', r.sim ? 'จำลอง' : ''].filter(Boolean).join(' · ');
    return `<div class="r ${best && r.at === best.at ? 'best' : ''}"><span class="t">${r.time.toFixed(2)}s</span><span class="m">${d.toLocaleDateString('th-TH', {day: 'numeric', month: 'short'})} ${d.toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'})}${extra ? ' · ' + extra : ''}</span>${best && r.at === best.at ? '🏆' : ''}</div>`;
  }).join('') : `<div class="hint" style="padding:12px 0">ยังไม่มีผลของโหมด ${m.name}</div>`;
}

// ---------- ตรวจเช็ค ----------
let diagDone = false, diag = {status: null, dtc: null, vin: null};
async function diagScan() {
  if (!OBD.connected) { toast('เชื่อมต่อรถก่อน'); return; }
  $('#milTxt').textContent = 'กำลังสแกน...';
  $('#milSub').textContent = '';
  diag.status = await OBD.readStatus();
  diag.dtc = await OBD.readDtc();
  if (!diag.vin) diag.vin = await OBD.readVin();
  renderDiag(); renderCarInfo();
}
function renderDiag() {
  const s = diag.status, d = diag.dtc;
  const n = d ? d.stored.length + d.perm.length : 0;
  const mil = s ? s.mil : n > 0;
  $('#mil').className = 'card mil ' + (mil ? 'on' : 'off');
  $('#milTxt').textContent = !s && !d ? 'อ่านไม่ได้' : mil ? 'ไฟเช็คเอนจิ้นติดอยู่' : 'ไฟเช็คเอนจิ้นไม่ติด';
  $('#milSub').textContent = d ? `รหัสที่บันทึก ${d.stored.length} · รอยืนยัน ${d.pending.length} · ถาวร ${d.perm.length}` : '';
  if (d) {
    const rows = [];
    const add = (list, kind, cls) => list.forEach(c => rows.push(`<div class="dtc ${cls}"><span class="c">${c}</span><div class="d">${esc(dtcText(c))}<small>${kind}</small></div><button class="ico ghost" data-q="${c}">🔍</button></div>`));
    add(d.stored, 'บันทึกแล้ว (ทำให้ไฟโชว์ติด)', '');
    add(d.perm, 'ถาวร — หายเองเมื่อระบบตรวจผ่าน', '');
    add(d.pending, 'รอยืนยัน — เกิดขึ้นแต่ยังไม่ถึงเกณฑ์ไฟโชว์', 'pend');
    $('#dtcs').innerHTML = rows.join('') || '<div class="hint" style="padding:12px 0;color:var(--ok)">✓ ไม่พบรหัสข้อผิดพลาด</div>';
  }
  if (s) $('#mon').innerHTML = s.mon.map(m => `<span class="${m.ok ? '' : 'no'}">${m.name}</span>`).join('') +
    `<div class="hint" style="grid-column:1/-1">✓ = ตรวจเสร็จแล้ว · … = ยังตรวจไม่เสร็จ (ขับต่ออีกสักพัก)</div>`;
}
function renderCarInfo() {
  const i = OBD.info;
  const rows = OBD.connected ? [['ตัวเสียบ', i.name], ['ELM', i.elm], ['โปรโตคอล', i.proto + (i.isCan ? ' (CAN)' : '')],
    ['โหมดเร็ว', i.count ? 'เปิด' : 'ปิด'], ['ค่าที่รองรับ', [...i.supported].filter(id => SRC[id]).length + ' ค่า'], ['VIN', diag.vin || '-']] : [['สถานะ', 'ยังไม่เชื่อมต่อ']];
  $('#carinfo').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('');
}
async function diagClear() {
  if (!OBD.connected) { toast('เชื่อมต่อรถก่อน'); return; }
  if (!await ask('ล้างรหัสข้อผิดพลาด?', 'ควรดับเครื่องแต่เปิดสวิตช์ ON ไว้<br>รหัสจะกลับมาถ้ายังไม่ได้แก้ปัญหา และความพร้อมระบบตรวจสอบจะถูกรีเซ็ต (ต้องขับสักพักก่อนไปตรวจสภาพ)', 'ล้างรหัส', true)) return;
  const ok = await OBD.clearDtc();
  toast(ok ? 'ล้างรหัสแล้ว' : 'ล้างไม่สำเร็จ');
  await sleep(500);
  diagScan();
}
function openUrl(u) { if (NATIVE && AndroidBle.openUrl) AndroidBle.openUrl(u); else window.open(u, '_blank'); }

// ---------- แผ่นเลื่อน / ถามยืนยัน / แจ้งเตือน ----------
let sheetClose = null;
function openSheet(title, html, onClose) {
  $('#shT').textContent = title; $('#shB').innerHTML = html;
  $('#sheet').classList.add('on'); sheetClose = onClose || null;
}
function closeSheet() { $('#sheet').classList.remove('on'); const f = sheetClose; sheetClose = null; if (f) f(); }
function ask(title, msg, ok = 'ตกลง', danger = false) {
  return new Promise(res => {
    openSheet(title, `<p class="hint" style="font-size:14px">${msg}</p><div class="row"><button class="${danger ? 'bad' : 'pri'}" id="askOk" style="flex:1">${esc(ok)}</button><button id="askNo" style="flex:1">ยกเลิก</button></div>`, () => res(false));
    $('#askOk').onclick = () => { sheetClose = null; closeSheet(); res(true); };
    $('#askNo').onclick = () => closeSheet();
  });
}
function askText(title, value) {
  return new Promise(res => {
    openSheet(title, `<input id="askIn" style="width:100%" maxlength="20" value="${esc(value)}"><div class="row" style="margin-top:12px"><button class="pri" id="askOk" style="flex:1">ตกลง</button></div>`, () => res(null));
    $('#askOk').onclick = () => { const v = $('#askIn').value.trim(); sheetClose = null; closeSheet(); res(v || null); };
    setTimeout(() => $('#askIn').focus(), 50);
  });
}
let toastT = 0;
function toast(s) { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

// ---------- ตั้งค่า ----------
function openSettings() {
  const tog = (k, label) => `<label class="tog">${label}<input type="checkbox" data-cfg="${k}" ${cfg[k] ? 'checked' : ''}></label>`;
  openSheet('ตั้งค่า', `
    <div class="set"><div class="t">ธีม</div><div class="swatch">${Object.entries(THEMES).map(([k, t]) =>
      `<button data-theme-pick="${k}" class="${cfg.theme === k ? 'on' : ''}">${t.name}</button>`).join('')}</div></div>
    <div class="set"><label>ไฟเตือนเปลี่ยนเกียร์ที่ <b id="sShiftV">${cfg.shiftRpm}</b> rpm</label><input type="range" min="2500" max="9000" step="100" value="${cfg.shiftRpm}" data-num="shiftRpm"></div>
    <div class="set"><label>เรดไลน์ (เกจรอบ) <b id="sRedV">${cfg.redline}</b> rpm</label><input type="range" min="3000" max="9500" step="100" value="${cfg.redline}" data-num="redline"></div>
    <div class="set"><div class="t">น้ำมัน (ใช้คำนวณอัตราสิ้นเปลือง)</div><div class="row">
      <button class="chip ${cfg.fuel === 'gas' ? 'on' : ''}" data-fuel="gas">เบนซิน/แก๊สโซฮอล์</button><button class="chip ${cfg.fuel === 'diesel' ? 'on' : ''}" data-fuel="diesel">ดีเซล</button></div>
      <div class="hint" style="margin-top:6px">ถ้ารถไม่ส่งอัตรากินน้ำมันมาเอง แอพจะประมาณจาก MAF (ดีเซลคลาดเคลื่อนได้มาก)</div></div>
    <div class="set">${tog('sound', 'เสียงบี๊บ (จับเวลา / ไฟเปลี่ยนเกียร์)')}${tog('vibrate', 'สั่น')}${tog('hudMirror', 'HUD กลับด้าน (สะท้อนกระจกหน้า)')}</div>
    ${NATIVE ? `<div class="set"><div class="t">การหมุนจอ</div><div class="row">${[['auto', 'อัตโนมัติ'], ['landscape', 'แนวนอน'], ['portrait', 'แนวตั้ง']]
      .map(([k, n]) => `<button class="chip ${cfg.orient === k ? 'on' : ''}" data-orient="${k}">${n}</button>`).join('')}</div></div>` : ''}
    <div class="set"><div class="t">การเชื่อมต่อ</div><div class="row">
      ${NATIVE ? '<button data-act="forget">เปลี่ยนตัวเสียบ</button>' : ''}<button data-act="sim">โหมดจำลอง</button><button data-act="log">ดู Log</button></div></div>
    <div class="set"><div class="t">ข้อมูล</div><div class="row">
      <button data-act="dash-reset-all">รีเซ็ตแดชบอร์ดทั้งหมด</button><button data-act="runs-clear">ล้างผลจับเวลา</button></div></div>
    <p class="hint">OBD Dashboard 2.0</p>`);
}
function applyTheme() {
  document.documentElement.dataset.theme = cfg.theme;
  const bar = (THEMES[cfg.theme] || THEMES.midnight).bar;
  $('meta[name=theme-color]').content = bar;
  if (NATIVE && AndroidBle.setBarColor) AndroidBle.setBarColor(bar);
}
function applyOrient() { if (NATIVE && AndroidBle.setOrientation) AndroidBle.setOrientation(cfg.orient); }

// ---------- Log ----------
const logLines = [];
function log(s) { logLines.push(new Date().toLocaleTimeString() + ' ' + s); if (logLines.length > 400) logLines.shift(); const l = $('#log'); if (l) { l.textContent = logLines.join('\n'); l.scrollTop = l.scrollHeight; } }
function openLog() {
  openSheet('Log', `<label class="tog">บันทึกทุกคำสั่ง (ละเอียด)<input type="checkbox" id="verb" ${OBD.verbose ? 'checked' : ''}></label><div id="log"></div>`);
  $('#verb').onchange = e => { OBD.verbose = e.target.checked; };
  log('---');
}

// ---------- บันทึกข้อมูล (CSV) ----------
let rec = null;
function toggleRec() {
  if (!rec) {
    if (!OBD.connected) { toast('เชื่อมต่อรถก่อน'); return; }
    rec = {t0: now(), start: new Date(), rows: [], cols: new Set()};
    rec.timer = setInterval(() => {
      const row = {t: ((now() - rec.t0) / 1000).toFixed(2)};
      for (const id in V) { const v = val(id, 2000); if (v != null) { row[id] = v; rec.cols.add(id); } }
      rec.rows.push(row);
      if (rec.rows.length > 72000) toggleRec();
    }, 250);
    $('#rec').classList.add('on'); $('#rec').textContent = '■ 0:00';
    toast('เริ่มบันทึกข้อมูล');
  } else {
    clearInterval(rec.timer);
    const cols = [...rec.cols];
    const csv = ['time_s,' + cols.map(id => `"${SRC[id].name} (${SRC[id].unit})"`).join(',')]
      .concat(rec.rows.map(r => r.t + ',' + cols.map(id => r[id] == null ? '' : +r[id].toFixed(4)).join(','))).join('\n');
    const d = rec.start;
    const name = `obd-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.csv`;
    rec = null;
    $('#rec').classList.remove('on'); $('#rec').textContent = '●';
    if (NATIVE && AndroidBle.saveFile) AndroidBle.saveFile(name, '﻿' + csv);
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv'})); a.download = name; a.click(); }
  }
}

// ---------- HUD ----------
let hudOn = false;
function hud(on) {
  hudOn = on; poll.listT = 0;
  $('#hud').classList.toggle('on', on);
  $('#hud').classList.toggle('mirror', cfg.hudMirror);
  if (NATIVE && AndroidBle.setFullscreen) AndroidBle.setFullscreen(on);
}
function renderHud() {
  const v = val('0D', 2000), r = val('0C', 2000);
  $('#hudS').textContent = v == null ? '--' : v.toFixed(0);
  $('#hudRpm').textContent = (r == null ? '--' : r.toFixed(0)) + ' rpm';
  $('#hudR').style.width = clamp((r || 0) / cfg.redline * 100, 0, 100) + '%';
  $('#hudS').style.color = r != null && r >= cfg.shiftRpm ? '#ff2d2d' : '';
}

// ---------- เชื่อมต่อ ----------
let connecting = false;
function setStatus(s) { $('#status').textContent = s; }
function setConnUi() {
  const on = OBD.connected;
  $('#dot').className = 'dot ' + (connecting ? 'busy' : on ? 'on' : '');
  $('#conn').textContent = connecting ? 'กำลังต่อ...' : on ? 'หยุด' : 'เชื่อมต่อ';
  $('#conn').className = on ? '' : 'pri';
  $('#conn').disabled = connecting;
  $('#hero').style.display = on || connecting ? 'none' : '';
}
async function connect(mode) {
  if (connecting) return;
  if (OBD.connected) { OBD.disconnect(); return; }
  connecting = true; setConnUi();
  try {
    if (mode !== 'sim' && !NATIVE) try { window.__wake = await navigator.wakeLock?.request('screen'); } catch (e) {}
    const i = await OBD.connect(mode);
    connecting = false;
    for (const k in V) delete V[k];
    poll.last = {}; poll.back = {}; lastSpd = null; diagDone = false; diag = {status: null, dtc: null, vin: null};
    setStatus(`เชื่อมต่อแล้ว: ${i.name}${i.sim ? '' : ' · ' + i.elm}`);
    setConnUi(); buildDash(); show(page);
    pollLoop();
  } catch (e) {
    connecting = false;
    setStatus('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    log('ERR ' + e.message);
    setConnUi();
  }
}
OBD.ev.status = s => setStatus(s);
OBD.ev.log = log;
OBD.ev.disconnected = () => {
  if (connecting) return;
  setStatus('ตัดการเชื่อมต่อแล้ว');
  if (rec) toggleRec();
  race.state = 'idle'; race.msg = '';
  setConnUi(); buildDash();
  if (page === 'live') buildLive();
};

// ---------- ปุ่มต่างๆ ----------
document.addEventListener('click', async e => {
  const b = e.target.closest('button, [data-pick], [data-live]');
  if (!b) { if (e.target.classList.contains('bk')) closeSheet(); return; }
  const d = b.dataset;
  if (d.page) return show(d.page);
  if (d.dash != null) { cfg.dashIdx = +d.dash; save(); buildDash(); poll.listT = 0; return; }
  if (d.w) return widgetAction(+b.closest('.wd').dataset.i, d.w);
  if (d.race) { if (race.state === 'running') return; cfg.raceMode = d.race; race.state = 'idle'; race.msg = ''; race.res = null; save(); buildRace(); renderRuns(); return; }
  if (d.star) { curDash().widgets.push({id: d.star, type: defaultType(SRC[d.star]), size: 1}); save(); buildDash(); toast(`เพิ่ม "${SRC[d.star].name}" ในแดช ${curDash().name}`); return; }
  if (d.gwin) { cfg.graphWin = +d.gwin; save(); buildGraph(); return; }
  if (d.gdel != null) { cfg.graph.splice(+d.gdel, 1); save(); buildGraph(); poll.listT = 0; return; }
  if (d.q) return openUrl('https://www.google.com/search?q=' + encodeURIComponent(d.q + ' ' + (diag.vin ? diag.vin.slice(0, 3) : 'OBD')));
  if (d.themePick) { cfg.theme = d.themePick; save(); applyTheme(); $$('[data-theme-pick]').forEach(x => x.classList.toggle('on', x === b)); return; }
  if (d.fuel) { cfg.fuel = d.fuel; save(); $$('[data-fuel]').forEach(x => x.classList.toggle('on', x === b)); return; }
  if (d.orient) { cfg.orient = d.orient; save(); applyOrient(); $$('[data-orient]').forEach(x => x.classList.toggle('on', x === b)); return; }
  switch (d.act) {
    case 'connect': return connect();
    case 'sim': closeSheet(); if (OBD.connected) OBD.disconnect(); return connect('sim');
    case 'sheet-close': return closeSheet();
    case 'log': return openLog();
    case 'forget': if (NATIVE) AndroidBle.forget(); closeSheet(); toast('ลืมตัวเสียบแล้ว กด "เชื่อมต่อ" เพื่อสแกนใหม่'); return;
    case 'w-add': return pickSource('เพิ่มวิดเจ็ต', id => { curDash().widgets.push({id, type: defaultType(SRC[id]), size: 1}); save(); buildDash(); });
    case 'dash-add': { const n = await askText('ชื่อหน้าใหม่', 'หน้า ' + (cfg.dash.length + 1)); if (!n) return; cfg.dash.push({name: n, widgets: []}); cfg.dashIdx = cfg.dash.length - 1; save(); buildDash(); setEditing(true); return; }
    case 'dash-rename': { const n = await askText('เปลี่ยนชื่อหน้า', curDash().name); if (n) { curDash().name = n; save(); buildDashChips(); } return; }
    case 'dash-reset': { const p = PRESETS.find(x => x.name === curDash().name) || PRESETS[0]; curDash().widgets = clone(p.widgets); save(); buildDash(); return; }
    case 'dash-del': if (cfg.dash.length > 1 && await ask('ลบหน้านี้?', `ลบหน้า "${esc(curDash().name)}"`, 'ลบ', true)) { cfg.dash.splice(cfg.dashIdx, 1); cfg.dashIdx = 0; save(); buildDash(); } return;
    case 'dash-reset-all': if (await ask('รีเซ็ตแดชบอร์ด?', 'แดชบอร์ดทุกหน้าจะกลับเป็นค่าเริ่มต้น', 'รีเซ็ต', true)) { cfg.dash = clone(PRESETS); cfg.dashIdx = 0; save(); buildDash(); } return;
    case 'runs-clear': if (await ask('ล้างผลจับเวลา?', 'ผลจับเวลาทั้งหมดจะถูกลบ', 'ล้าง', true)) { cfg.runs = []; save(); renderRuns(); } return;
    case 'trip-reset': Object.assign(trip, {dist: 0, time: 0, fuel: 0, max: 0}); cfg.trip = trip; save(); toast('เริ่มทริปใหม่'); return;
    case 'g-add': if (cfg.graph.length >= 4) return toast('ได้สูงสุด 4 เส้น'); return pickSource('เพิ่มเส้นกราฟ', id => { if (!cfg.graph.includes(id)) cfg.graph.push(id); save(); buildGraph(); poll.listT = 0; });
    case 'diag-scan': return diagScan();
    case 'diag-clear': return diagClear();
    case 'hud-close': return hud(false);
    case 'hud-mirror': cfg.hudMirror = !cfg.hudMirror; save(); $('#hud').classList.toggle('mirror', cfg.hudMirror); return;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.cfg) { cfg[t.dataset.cfg] = t.checked; save(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.num) {
    cfg[t.dataset.num] = +t.value; save();
    if (t.dataset.num === 'shiftRpm') $('#sShiftV').textContent = t.value;
    if (t.dataset.num === 'redline') { $('#sRedV').textContent = t.value; buildDash(); }
  }
});
$('#conn').onclick = () => connect();
$('#setBtn').onclick = openSettings;
$('#editBtn').onclick = () => setEditing(!editing);
$('#rec').onclick = toggleRec;
$('#hudBtn').onclick = () => hud(true);
$('#armBtn').onclick = () => { if (race.state === 'idle' || race.state === 'done') race.arm(); else race.cancel(); };
$('#lapGo').onclick = lapGo;
$('#lapLap').onclick = lapLap;
$('#lapReset').onclick = lapReset;
$('#gPause').onclick = () => { gPaused = !gPaused; gFrozenT = now(); $('#gPause').textContent = gPaused ? '▶' : '❚❚'; };
$('#liveSearch').oninput = buildLive;

// ปุ่มย้อนกลับของ Android
window.__back = () => {
  if ($('#sheet').classList.contains('on')) { closeSheet(); return true; }
  if (hudOn) { hud(false); return true; }
  if (editing) { setEditing(false); return true; }
  if (page !== 'dash') { show('dash'); return true; }
  return false;
};
window.__saved = name => toast('บันทึกไฟล์แล้ว: ' + name);

// ---------- วาดหน้าจอ ----------
let lastFrame = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (t - lastFrame < 50) return;
  lastFrame = t;
  if (hudOn) renderHud();
  if (page === 'dash') renderDash();
  else if (page === 'race') renderRace();
  else if (page === 'live') renderLive();
  else if (page === 'graph' && !gPaused) renderGraph();
  if (OBD.connected) $('#hz').textContent = poll.hz.toFixed(1) + ' ค่า/วิ';
  else $('#hz').textContent = '';
  if (rec) { const s = Math.floor((now() - rec.t0) / 1000); $('#rec').textContent = '■ ' + fmtDur(s); }
}

// ---------- เริ่ม ----------
applyTheme();
applyOrient();
buildDash();
setConnUi();
renderLapBtns();
if (NATIVE) { const n = AndroidBle.savedName(); setStatus(n ? 'กด "เชื่อมต่อ" เพื่อต่อกับ ' + n : 'ติดเครื่องรถ ปิดแอพ OBD อื่น แล้วกด "เชื่อมต่อ"'); }
requestAnimationFrame(frame);
