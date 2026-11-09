// Flip Cup: phone-only flick game. Two modes:
//  cup    - a red cup sits on the table edge; flick the phone to flip it rim-down. 6 cups, race the clock.
//  bottle - a water bottle sits in your palm; pancake-toss it so it lands on its base on the table.
// Physics runs in meters (y up). The flick strength comes from the phone's gyroscope peak rotation rate.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cvs = $('game'), ctx = cvs.getContext('2d');
  const params = new URLSearchParams(location.search);
  const DESK = params.has('desk');               // debug: allow desktop + swipe
  const G = 9.8;
  const TAU = Math.PI * 2;
  const CUPS_PER_ROUND = 6;

  // ---------- geometry ----------
  const CUP = { H: 0.12, bw: 0.056, rw: 0.088 };
  const BOT = { H: 0.21, W: 0.066 };
  const TABLE_LEFT_BOTTLE = 0.26;               // table starts here in bottle mode (palm is at x=0)
  const PALM_Y = 0.24;

  function shapePts(mode) {
    if (mode === 'cup') {
      const h = CUP.H / 2;
      return [[-CUP.bw / 2, -h], [CUP.bw / 2, -h], [CUP.rw / 2, h], [-CUP.rw / 2, h]];
    }
    const h = BOT.H / 2, w = BOT.W / 2;
    return [[-w, -h], [w, -h], [w, h * 0.55], [w * 0.45, h], [-w * 0.45, h], [-w, h * 0.55]];
  }
  function lowest(b, pts) {
    const c = Math.cos(b.th), s = Math.sin(b.th);
    let my = Infinity, mx = 0;
    for (const [px, py] of pts) {
      const y = b.y + px * s + py * c, x = b.x + px * c - py * s;
      if (y < my) { my = y; mx = x; }
    }
    return { y: my, x: mx };
  }
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nearest = (th, base, step) => base + Math.round((th - base) / step) * step;

  // ---------- body / launch ----------
  function restBody(mode) {
    if (mode === 'cup') return { x: 0.035, y: CUP.H / 2, vx: 0, vy: 0, th: 0, w: 0, rot: 0 };
    return { x: 0.0, y: PALM_Y + BOT.H / 2, vx: 0, vy: 0, th: 0, w: 0, rot: 0 };
  }
  function launch(mode, p) {
    const b = restBody(mode);
    if (mode === 'cup') {
      b.vx = 0.22; b.vy = 1.15 + 1.6 * p; b.w = -(560 * (0.35 + 0.65 * p)) * Math.PI / 180;
    } else {
      b.vx = 0.6; b.vy = 2.2 + 1.2 * p; b.w = -(1575 * (0.5 + 0.5 * p)) * Math.PI / 180;
    }
    return b;
  }
  // Advance one step. Returns null while flying, or an outcome object on landing.
  function step(mode, b, dt) {
    b.vy -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (mode === 'bottle') b.w *= Math.exp(-3.0 * dt);   // sloshing water bleeds off spin
    else b.w *= Math.exp(-0.15 * dt);
    b.th += b.w * dt; b.rot += Math.abs(b.w * dt);
    if (b.vy > 0) return null;
    const lo = lowest(b, shapePts(mode));
    if (mode === 'bottle') {
      if (lo.x < TABLE_LEFT_BOTTLE - 0.01) {
        if (b.y < -0.9) return { kind: 'miss' };
        return null;
      }
    }
    if (lo.y > 0) return null;
    return judge(mode, b);
  }
  function judge(mode, b) {
    const a = wrap(b.th), wDeg = Math.abs(b.w) * 180 / Math.PI;
    if (mode === 'cup') {
      const tol = 0.42;
      if (Math.abs(Math.abs(a) - Math.PI) < tol) return { kind: 'win', target: nearest(b.th, Math.PI, TAU) };
      if (Math.abs(a) < tol) return { kind: b.rot < 1 ? 'soft' : 'over', target: nearest(b.th, 0, TAU) };
      return { kind: b.rot < Math.PI ? 'soft' : 'hard', target: nearest(b.th, Math.PI / 2, Math.PI) };
    }
    const tol = 0.42;
    if (Math.abs(a) < tol && wDeg < 560) {
      if (b.rot < 4.2) return { kind: 'soft', target: nearest(b.th, 0, TAU), upright: true };
      return { kind: b.rot > 10.5 ? 'double' : 'win', target: nearest(b.th, 0, TAU) };
    }
    if (Math.abs(Math.abs(a) - Math.PI) < 0.22 && wDeg < 360) return { kind: 'cap', target: nearest(b.th, Math.PI, TAU) };
    return { kind: b.rot < TAU ? 'soft' : 'hard', target: nearest(b.th, Math.PI / 2, Math.PI) };
  }
  function simulate(mode, p) {
    const b = launch(mode, p);
    for (let i = 0; i < 4000; i++) { const r = step(mode, b, 1 / 240); if (r) return r.kind; }
    return 'miss';
  }
  // Sweet-spot zone per mode (used for the power meter).
  const P_MAX = 1.2;
  const ZONES = {};
  for (const m of ['cup', 'bottle']) {
    let lo = null, hi = null;
    for (let p = 0; p <= P_MAX; p += 0.004) {
      const k = simulate(m, p);
      if (k === 'win' || k === 'double') { if (lo === null) lo = p; hi = p; }
      else if (lo !== null && m === 'cup') break;
      else if (lo !== null && m === 'bottle' && k !== 'win') break;
    }
    ZONES[m] = { lo: lo ?? 0.5, hi: hi ?? 0.6 };
  }

  // ---------- state ----------
  const S = {
    mode: null, body: null, phase: 'idle', // idle | flying | settle | result
    settle: null, outcome: null, resultT: 0,
    flat: false, flatSince: 0, armed: false, tiltX: 0, tiltY: 0,
    sensor: false, fallback: DESK, gotMotion: false,
    capture: null, lastP: null,
    cupsDone: 0, tStart: 0, tEnd: 0, running: false,
    streak: 0, total: 0,
    particles: [], shake: 0, slosh: 0,
  };
  const best = {
    get cup() { return parseFloat(localStorage.getItem('flipcup.bestCup')) || null; },
    set cup(v) { localStorage.setItem('flipcup.bestCup', String(v)); },
    get streak() { return parseInt(localStorage.getItem('flipcup.bestStreak') || '0', 10); },
    set streak(v) { localStorage.setItem('flipcup.bestStreak', String(v)); },
  };

  // ---------- UI ----------
  const isPhone = DESK || (matchMedia('(pointer:coarse)').matches && ('ontouchstart' in window) && Math.min(screen.width, screen.height) < 820);
  function show(id, on = true) { $(id).classList.toggle('show', on); }
  function hud(on) { $('hud').classList.toggle('hidden', !on); $('status').classList.toggle('hidden', !on); }
  let toastTimer = 0;
  function toast(html, cls = '', ms = 1200) {
    const t = $('toast'); t.innerHTML = html; t.className = 'toast show ' + cls;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast ' + cls; }, ms);
  }
  function setMeter(p) {
    const m = $('meter'); m.classList.remove('hidden');
    const z = ZONES[S.mode];
    $('zone').style.left = (z.lo / P_MAX * 100) + '%';
    $('zone').style.width = ((z.hi - z.lo) / P_MAX * 100) + '%';
    $('needle').style.left = (clamp(p, 0, P_MAX) / P_MAX * 100) + '%';
  }
  function updateHud() {
    if (S.mode === 'cup') {
      $('l1').textContent = 'Cups'; $('v1').textContent = `${S.cupsDone}/${CUPS_PER_ROUND}`;
      $('l2').textContent = 'Time';
      const t = S.running ? (performance.now() - S.tStart) / 1000 : (S.tEnd ? (S.tEnd - S.tStart) / 1000 : 0);
      $('v2').textContent = t.toFixed(1);
      $('l3').textContent = 'Best'; $('v3').textContent = best.cup ? best.cup.toFixed(1) : '--';
    } else {
      $('l1').textContent = 'Streak'; $('v1').textContent = S.streak;
      $('l2').textContent = 'Landed'; $('v2').textContent = S.total;
      $('l3').textContent = 'Best'; $('v3').textContent = best.streak;
    }
  }
  function setStatus() {
    const st = $('status'), tx = $('statusText');
    let ready = false, msg;
    if (S.phase !== 'idle') msg = S.phase === 'flying' ? 'Flipping...' : '...';
    else if (S.fallback && !S.sensor) { msg = 'Swipe up fast to flick'; ready = true; }
    else if (!S.flat) msg = 'Lay your phone flat, face up';
    else if (!S.armed) msg = 'Hold it flat...';
    else { msg = S.mode === 'cup' ? 'Ready. Flick it!' : 'Ready. Toss it!'; ready = true; }
    tx.textContent = msg; st.classList.toggle('ready', ready);
    $('bubble').style.transform = `translate(${clamp(S.tiltX, -1, 1) * 10}px, ${clamp(S.tiltY, -1, 1) * 10}px)`;
  }

  const HOW = {
    cup: ['Hold your phone flat in your palm, screen up, like the cup is sitting on it.',
      'When the pill turns green, flick your wrist up, like flicking the cup off the table edge.',
      'Soft flick = it won\'t turn over. Too hard = it over-rotates. Find the green zone on the meter.',
      'Flip all 6 cups as fast as you can.'],
    bottle: ['Hold your phone flat, screen up, like a pan with a pancake on it.',
      'When it turns green, toss with a quick wrist flip, same motion as flipping a pancake.',
      'The bottle has to do a full flip and land on its base. The water slows its spin, so commit to it.',
      'Land on the cap for a legendary flip.'],
  };

  // ---------- sensors ----------
  async function requestMotion() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') { S.fallback = true; return false; }
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) { /* optional */ }
      }
    } catch (e) { S.fallback = true; return false; }
    window.addEventListener('devicemotion', onMotion);
    setTimeout(() => { if (!S.gotMotion) { S.fallback = true; toast('No motion sensor<small>Swipe up to flick instead</small>', 'bad', 2200); } }, 1800);
    return true;
  }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity, r = e.rotationRate;
    if (!g || g.z == null) return;
    if (!S.gotMotion && r && (r.alpha != null || r.beta != null)) { S.gotMotion = true; S.sensor = true; }
    const now = performance.now();
    const gz = Math.abs(g.z), gxy = Math.hypot(g.x || 0, g.y || 0);
    S.tiltX = (g.x || 0) / 4; S.tiltY = -(g.y || 0) / 4;
    const flat = gz > 8.2 && gxy < 3.4;
    if (flat && !S.flat) S.flatSince = now;
    S.flat = flat;
    if (S.phase === 'idle' && !S.armed && S.flat && now - S.flatSince > 350) { S.armed = true; Sfx.arm(); }
    if (!r) return;
    const rate = Math.hypot(r.beta || 0, r.gamma || 0);           // deg/s, pitch + roll
    const lin = e.acceleration ? Math.abs(e.acceleration.z || 0) : 0;
    if (S.capture) {
      S.capture.peak = Math.max(S.capture.peak, rate);
      S.capture.lin = Math.max(S.capture.lin, lin);
      if (now - S.capture.t0 > 170) finishCapture();
      return;
    }
    if (S.phase === 'idle' && S.armed && rate > 230) {
      S.capture = { t0: now, peak: rate, lin };
    }
  }
  function finishCapture() {
    const c = S.capture; S.capture = null;
    // ~150 deg/s is a twitch; ~1250 deg/s is a hard snap. Linear accel adds a little.
    const p = clamp((c.peak - 150) / 1100 + Math.min(c.lin, 25) / 250, 0, P_MAX);
    doFlick(p);
  }
  // Swipe fallback (no gyro / ?desk)
  let sw = null;
  cvs.addEventListener('pointerdown', (e) => { sw = { y: e.clientY, t: performance.now() }; });
  cvs.addEventListener('pointerup', (e) => {
    if (!sw || !S.fallback || S.phase !== 'idle') { sw = null; return; }
    const dy = sw.y - e.clientY, dt = Math.max(16, performance.now() - sw.t); sw = null;
    if (dy < 30) return;
    const v = dy / dt; // px per ms
    doFlick(clamp((v - 0.25) / 2.6, 0, P_MAX));
  });

  // ---------- game flow ----------
  function doFlick(p) {
    if (S.phase !== 'idle' || !S.mode) return;
    S.lastP = p; S.armed = false;
    S.body = launch(S.mode, p); S.phase = 'flying';
    if (S.mode === 'cup' && !S.running && S.cupsDone === 0) { S.running = true; S.tStart = performance.now(); S.tEnd = 0; }
    Sfx.whoosh(p);
    if (navigator.vibrate) navigator.vibrate(12);
    setMeter(p);
  }
  function startMode(mode) {
    S.mode = mode; S.body = restBody(mode); S.phase = 'idle'; S.armed = false;
    S.cupsDone = 0; S.running = false; S.tEnd = 0; S.streak = 0; S.total = 0; S.particles = [];
    $('meter').classList.add('hidden');
    hud(true); updateHud();
  }
  function onLand(out) {
    const b = S.body;
    S.outcome = out; S.phase = out.kind === 'miss' ? 'result' : 'settle';
    S.settle = { from: b.th, to: out.target ?? b.th, t: 0, x0: b.x, vx: b.vx * 0.25 };
    S.resultT = 0;
    const good = out.kind === 'win' || out.kind === 'double' || out.kind === 'cap';
    if (out.kind !== 'miss') { good ? Sfx.clack() : Sfx.thud(); S.shake = good ? 0.12 : 0.2; }
    const z = ZONES[S.mode], p = S.lastP;
    const hint = p < z.lo ? 'Flick harder' : p > z.hi ? 'Ease up a little' : 'So close';
    if (S.mode === 'cup') {
      if (good) {
        S.cupsDone++; burst(b.x, 0.02, 18); Sfx.win();
        toast(S.cupsDone >= CUPS_PER_ROUND ? 'DONE!' : 'FLIPPED!', 'good', 900);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      } else if (out.kind === 'soft') toast(`Too soft<small>${hint}</small>`, 'bad');
      else toast(`Over-flipped<small>${hint}</small>`, 'bad');
    } else {
      if (good) {
        S.streak++; S.total++;
        if (S.streak > best.streak) best.streak = S.streak;
        burst(b.x, 0.02, out.kind === 'win' ? 20 : 45);
        if (out.kind === 'cap') { toast('CAP FLIP!!<small>Legendary</small>', 'good', 1600); Sfx.bigwin(); S.total += 2; }
        else if (out.kind === 'double') { toast('DOUBLE FLIP!', 'good', 1300); Sfx.bigwin(); }
        else { toast(S.streak > 2 ? `STUCK IT! x${S.streak}` : 'STUCK IT!', 'good', 1000); Sfx.win(); }
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      } else {
        S.streak = 0;
        if (out.kind === 'miss') { toast('Missed the table', 'bad'); Sfx.fail(); }
        else if (out.kind === 'soft') toast(`Not enough flip<small>${hint}</small>`, 'bad');
        else toast(`Bonk<small>${hint}</small>`, 'bad');
      }
    }
    updateHud();
  }
  function afterResult() {
    const o = S.outcome; const good = o && (o.kind === 'win' || o.kind === 'double' || o.kind === 'cap');
    if (S.mode === 'cup' && good && S.cupsDone >= CUPS_PER_ROUND) {
      S.running = false; S.tEnd = performance.now();
      const t = (S.tEnd - S.tStart) / 1000, prev = best.cup, isBest = !prev || t < prev;
      if (isBest) best.cup = t;
      $('finTitle').textContent = isBest ? 'New best! 🏆' : 'All 6 flipped!';
      $('finText').textContent = `${t.toFixed(1)} seconds` + (prev && !isBest ? ` · best ${prev.toFixed(1)}` : '');
      Sfx.bigwin(); updateHud(); show('finish');
      S.phase = 'done'; return;
    }
    S.body = restBody(S.mode); S.phase = 'idle'; S.outcome = null; S.armed = false;
    if (S.flat) S.flatSince = performance.now();
    S.slideIn = 1;
  }

  // ---------- particles ----------
  function burst(x, y, n) {
    const cols = ['#ffcf5a', '#e3262f', '#ffffff', '#5ad1ff', '#7dff9c'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI, sp = 0.6 + Math.random() * 1.6;
      S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.6, life: 1, c: cols[i % cols.length], r: Math.random() * TAU });
    }
  }

  // ---------- render ----------
  let W = 0, H = 0, DPR = 1, SC = 1, OX = 0, OY = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = innerWidth; H = innerHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener('resize', resize); resize();
  function camera() {
    if (S.mode === 'bottle') {
      SC = Math.min(W / 0.78, H / 1.05); OX = W * 0.5 - 0.22 * SC; OY = H * 0.68;
    } else {
      SC = Math.min(W / 0.66, H / 0.75); OX = W * 0.5 - 0.27 * SC; OY = H * 0.62;
    }
  }
  const sx = (x) => OX + x * SC, sy = (y) => OY - y * SC;

  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b1c14'); g.addColorStop(0.55, '#3d281c'); g.addColorStop(1, '#1d120c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // string lights
    ctx.save();
    const ly = H * 0.16;
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 8) ctx.lineTo(x, ly + Math.sin(x / W * Math.PI * 3) * 14);
    ctx.stroke();
    const t = performance.now() / 1000;
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * W / 9, y = ly + Math.sin(x / W * Math.PI * 3) * 14 + 7;
      const tw = 0.75 + 0.25 * Math.sin(t * 2 + i * 1.7);
      const c = ['#ffcf5a', '#ff7a59', '#7dd3ff'][i % 3];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 26);
      rg.addColorStop(0, c); rg.addColorStop(0.25, c + '88'); rg.addColorStop(1, 'transparent');
      ctx.globalAlpha = tw; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawTable(x0, x1) {
    const top = sy(0), th = 0.035 * SC;
    // top
    const g = ctx.createLinearGradient(0, top - 2, 0, top + th);
    g.addColorStop(0, '#c98a4f'); g.addColorStop(0.3, '#a8693a'); g.addColorStop(1, '#6b3e1f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx(x0), top, sx(x1) - sx(x0), th, [6, 6, 0, 0]) : ctx.rect(sx(x0), top, sx(x1) - sx(x0), th); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,190,.35)'; ctx.fillRect(sx(x0) + 3, top, sx(x1) - sx(x0) - 6, 2);
    // front face fading down
    const g2 = ctx.createLinearGradient(0, top + th, 0, H);
    g2.addColorStop(0, '#5a321a'); g2.addColorStop(1, '#2a160b');
    ctx.fillStyle = g2; ctx.fillRect(sx(x0) + 0.02 * SC, top + th, sx(x1) - sx(x0) - 0.02 * SC, H);
    // wood grain lines
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = top + th + 14 + i * 22; ctx.beginPath(); ctx.moveTo(sx(x0) + 0.03 * SC, y); ctx.bezierCurveTo(W * 0.4, y + 6, W * 0.7, y - 6, sx(x1), y + 2); ctx.stroke();
    }
  }
  function shadow(b) {
    const h = Math.max(0, b.y);
    const a = clamp(0.35 - h * 0.6, 0.06, 0.35), r = (0.05 + h * 0.08) * SC;
    if (S.mode === 'bottle' && b.x < TABLE_LEFT_BOTTLE) return;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath(); ctx.ellipse(sx(b.x), sy(0) + 2, r, r * 0.18, 0, 0, TAU); ctx.fill();
  }
  function withBody(b, fn) {
    const k = b.k || 1;
    ctx.save(); ctx.translate(sx(b.x), sy(b.y)); ctx.scale(SC * k, -SC * k); ctx.rotate(b.th); fn(); ctx.restore();
  }
  function drawCup(b, glow) {
    withBody(b, () => {
      const h = CUP.H / 2, bw = CUP.bw / 2, rw = CUP.rw / 2;
      if (glow) { ctx.shadowColor = 'rgba(125,255,156,.9)'; ctx.shadowBlur = 18 * DPR; }
      const g = ctx.createLinearGradient(-rw, 0, rw, 0);
      g.addColorStop(0, '#a3121a'); g.addColorStop(0.35, '#ef3a41'); g.addColorStop(0.55, '#ff6066'); g.addColorStop(1, '#9c1118');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-bw, -h); ctx.lineTo(bw, -h); ctx.lineTo(rw, h); ctx.lineTo(-rw, h); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // ridges
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 0.0025;
      for (const f of [-0.45, -0.1, 0.25]) {
        const y = f * h, w = bw + (rw - bw) * ((y + h) / (2 * h));
        ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // white rim band
      ctx.fillStyle = '#f7f3ee';
      ctx.beginPath(); ctx.moveTo(-rw * 0.97, h * 0.78); ctx.lineTo(rw * 0.97, h * 0.78); ctx.lineTo(rw * 1.04, h); ctx.lineTo(-rw * 1.04, h); ctx.closePath(); ctx.fill();
      // base
      ctx.fillStyle = '#7d0d13'; ctx.fillRect(-bw, -h, bw * 2, 0.004);
    });
  }
  function bottlePath(h, w) {
    ctx.beginPath();
    ctx.moveTo(-w, -h + 0.008);
    ctx.quadraticCurveTo(-w, -h, -w + 0.008, -h);
    ctx.lineTo(w - 0.008, -h); ctx.quadraticCurveTo(w, -h, w, -h + 0.008);
    ctx.lineTo(w, h * 0.45);
    ctx.bezierCurveTo(w, h * 0.72, w * 0.42, h * 0.7, w * 0.42, h * 0.84);
    ctx.lineTo(w * 0.42, h * 0.9); ctx.lineTo(-w * 0.42, h * 0.9); ctx.lineTo(-w * 0.42, h * 0.84);
    ctx.bezierCurveTo(-w * 0.42, h * 0.7, -w, h * 0.72, -w, h * 0.45);
    ctx.closePath();
  }
  function drawBottle(b, glow) {
    withBody(b, () => {
      const h = BOT.H / 2, w = BOT.W / 2;
      if (glow) { ctx.shadowColor = 'rgba(125,255,156,.9)'; ctx.shadowBlur = 18 * DPR; }
      bottlePath(h, w);
      ctx.fillStyle = 'rgba(200,235,255,.22)'; ctx.fill();
      ctx.shadowBlur = 0;
      // water: clip to bottle, draw a level surface in world orientation
      ctx.save(); bottlePath(h, w); ctx.clip();
      ctx.rotate(-b.th);
      const c = Math.abs(Math.cos(b.th)), s = Math.abs(Math.sin(b.th));
      const level = -(0.16 * BOT.H * c + 0.12 * BOT.W * s + 0.02 * (1 - c));
      ctx.rotate(clamp(S.slosh, -0.6, 0.6));
      const wg = ctx.createLinearGradient(0, level, 0, level - 0.2);
      wg.addColorStop(0, 'rgba(90,190,255,.85)'); wg.addColorStop(1, 'rgba(30,110,220,.9)');
      ctx.fillStyle = wg; ctx.fillRect(-0.3, level - 0.4, 0.6, 0.4);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-0.3, level - 0.003, 0.6, 0.004);
      ctx.restore();
      // label
      ctx.fillStyle = '#1f6fd1'; ctx.fillRect(-w, -h * 0.25, w * 2, h * 0.42);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-w, -h * 0.03, w * 2, h * 0.05);
      // outline + shine
      bottlePath(h, w); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.0022; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-w * 0.72, -h * 0.85, w * 0.16, h * 1.2);
      // cap
      ctx.fillStyle = '#1b56b8';
      ctx.fillRect(-w * 0.5, h * 0.9, w, h * 0.1);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-w * 0.5, h * 0.95, w, h * 0.012);
    });
  }
  function drawHand() {
    // flat open palm, side view, at the left
    const y = sy(PALM_Y), x = sx(0);
    const L = 0.2 * SC, T = 0.03 * SC;
    ctx.save();
    // forearm
    ctx.fillStyle = '#b97b52';
    ctx.beginPath(); ctx.moveTo(x - L * 0.55, y + T * 0.2); ctx.lineTo(x - L * 1.8, y + T * 3.8); ctx.lineTo(x - L * 1.8, y + T * 6.5); ctx.lineTo(x - L * 0.5, y + T * 1.6); ctx.closePath(); ctx.fill();
    // palm
    const g = ctx.createLinearGradient(0, y, 0, y + T * 1.6);
    g.addColorStop(0, '#e2a679'); g.addColorStop(1, '#b97b52');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - L * 0.6, y);
    ctx.lineTo(x + L * 0.42, y);
    ctx.quadraticCurveTo(x + L * 0.62, y + T * 0.15, x + L * 0.5, y + T * 0.7);
    ctx.lineTo(x - L * 0.55, y + T * 1.6);
    ctx.closePath(); ctx.fill();
    // thumb
    ctx.fillStyle = '#d49568';
    ctx.beginPath(); ctx.ellipse(x - L * 0.12, y - T * 0.15, L * 0.16, T * 0.32, -0.15, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawDoneCups() {
    // completed cups lined up (rim-down) further down the table
    for (let i = 0; i < CUPS_PER_ROUND; i++) {
      const done = i < S.cupsDone;
      const x = 0.31 + i * 0.056, k = 0.62;
      ctx.globalAlpha = done ? 1 : 0.18;
      drawCup({ x, y: CUP.H / 2 * k, th: Math.PI, k }, false);
    }
    ctx.globalAlpha = 1;
  }
  function drawParticles(dt) {
    for (const p of S.particles) {
      p.vy -= 3.2 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.8; p.r += dt * 8;
      ctx.save(); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.translate(sx(p.x), sy(p.y)); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-4, -2, 8, 4); ctx.restore();
    }
    S.particles = S.particles.filter((p) => p.life > 0 && p.y > -0.5);
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.mode && S.phase === 'flying') {
      const n = Math.ceil(dt * 240);
      for (let i = 0; i < n; i++) {
        const out = step(S.mode, S.body, dt / n);
        if (out) { onLand(out); break; }
      }
      S.slosh += (S.body.w * 0.04 - S.slosh) * Math.min(1, dt * 8);
    } else S.slosh *= Math.exp(-dt * 4);
    if (S.phase === 'settle') {
      const st = S.settle, b = S.body; st.t = Math.min(1, st.t + dt / 0.32);
      const e = 1 - Math.pow(1 - st.t, 3);
      b.th = st.from + (st.to - st.from) * e;
      b.x += st.vx * dt * (1 - e);
      const lo = lowest(b, shapePts(S.mode)); b.y -= lo.y;
      if (st.t >= 1) { S.phase = 'result'; S.resultT = 0; }
    }
    if (S.phase === 'result') {
      if (S.outcome && S.outcome.kind === 'miss') { const b = S.body; b.vy -= G * dt; b.y += b.vy * dt; b.x += b.vx * dt; b.th += b.w * dt; }
      S.resultT += dt; if (S.resultT > 1.05) afterResult();
    }
    render(dt);
    if (S.mode && (S.running || S.phase !== 'done')) updateHud();
    if (S.mode) setStatus();
    requestAnimationFrame(frame);
  }
  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackdrop();
    if (!S.mode) { S.mode = null; return; }
    camera();
    let shx = 0, shy = 0;
    if (S.shake > 0) { S.shake -= dt; shx = (Math.random() - 0.5) * 6 * S.shake * 8; shy = (Math.random() - 0.5) * 6 * S.shake * 8; }
    ctx.save(); ctx.translate(shx, shy);
    const ready = S.phase === 'idle' && (S.armed || (S.fallback && !S.sensor));
    if (S.mode === 'cup') {
      drawTable(0.02, 2);
      drawDoneCups();
      shadow(S.body);
      drawCup(S.body, ready);
    } else {
      drawTable(TABLE_LEFT_BOTTLE, 2);
      // target marker
      ctx.strokeStyle = 'rgba(255,207,90,.35)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx(0.43), sy(0) + 2, 0.08 * SC, 0.014 * SC, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      shadow(S.body);
      drawHand();
      drawBottle(S.body, ready);
    }
    drawParticles(dt);
    ctx.restore();
  }

  // ---------- wiring ----------
  document.querySelectorAll('.mode').forEach((btn) => btn.addEventListener('click', async () => {
    Sfx.unlock();
    const mode = btn.dataset.mode;
    if (!S.sensor && !DESK) await requestMotion();
    show('title', false);
    $('howTitle').textContent = mode === 'cup' ? 'Flip Cup' : 'Bottle Flip';
    $('howList').innerHTML = HOW[mode].map((s) => `<li>${s}</li>`).join('');
    show('howto');
    $('goBtn').onclick = () => { show('howto', false); startMode(mode); };
  }));
  $('backBtn').onclick = () => { S.mode = null; hud(false); $('meter').classList.add('hidden'); show('finish', false); show('title'); };
  $('againBtn').onclick = () => { show('finish', false); startMode(S.mode); };
  $('menuBtn2').onclick = () => { show('finish', false); $('backBtn').onclick(); };
  const muteIcons = () => { $('icoSound').classList.toggle('hidden', Sfx.muted); $('icoMute').classList.toggle('hidden', !Sfx.muted); };
  $('muteBtn').onclick = () => { Sfx.toggle(); muteIcons(); }; muteIcons();

  if (!isPhone) show('gate'); else show('title');
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') $('permNote').classList.add('hidden');
  requestAnimationFrame(frame);

  // test hook
  window.__flipcup = { S, ZONES, simulate, flick: doFlick, startMode, launch };
})();
