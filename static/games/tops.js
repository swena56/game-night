// Spin Tops: the server owns the bowl; this module draws it in 3D (three.js) or flat 2D, glides the tops between
// updates using their velocity, and sends the stick and the button. Controls: drag anywhere for a virtual stick
// (a quick tap dashes), the 🚀/💨 button, or WASD/arrows + Space.
// Each round: a launch (a swinging power meter; tap to let go), then the fight; the last top spinning wins.
// The server sends launches, hits, dashes, outs, sparks and round ends as numbered events ("ev").
UI.tops = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null;
  let keyDown = null, keyUp = null, drag = null, stick = [0, 0], sentAt = 0, keys = new Set();
  let lastSeq = -1, flash = null, lastCd = 0, sideAt = 0, outSeen = [];
  const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const STICK_PX = 60;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; drag = null; stick = [0, 0]; keys = new Set(); lastSeq = -1; flash = null; disp.length = 0; outSeen = [];
    main.innerHTML = `<div class="tp"><div class="tp-stage" id="tpStage">
        <div class="tp-hud"><span id="tpRound"></span><span id="tpClock"></span></div>
        <div class="tp-meter" id="tpMeter" hidden><i></i><b></b></div>
        <div class="lr-banner" id="tpBanner" hidden></div>
        <div class="lr-banner small tp-flash" id="tpFlash" hidden></div>
        <div class="tp-stick" id="tpStick" hidden><span></span></div></div>
      <div class="tp-bar"><span id="tpInfo" class="hint"></span><span class="tp-spin" id="tpSpin"><i></i></span><button id="tpBtn" class="primary">🚀 Launch</button></div></div>`;
    side.innerHTML = `<div class="panel"><div id="tpSeats"></div>
      <p class="hint left">Tap 🚀 when the meter is high. Then drag anywhere to steer and tap to dash. Keyboard: WASD / arrows and Space.</p></div>`;
    main.querySelector('.tp').style.touchAction = 'none';
    const btn = $('tpBtn');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = $('tpStage');
    stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      showStick(e.clientX, e.clientY, 0, 0);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const m = Math.hypot(dx, dy);
      if (m > 10) drag.moved = true;
      if (m > STICK_PX) { dx *= STICK_PX / m; dy *= STICK_PX / m; }
      showStick(drag.x, drag.y, dx, dy);
      setStick(dx / STICK_PX, dy / STICK_PX);
    });
    const up = () => {
      if (!drag) return;
      if (!drag.moved && performance.now() - drag.at < 300) press();
      drag = null; $('tpStick').hidden = true;
      setStick(0, 0, true);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (KEYS[e.code]) { e.preventDefault(); keys.add(e.code); keyStick(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) press(); }
    };
    keyUp = (e) => { if (keys.delete(e.code)) keyStick(); };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const revive = { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } };
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, revive); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect(); clearTimeout(stickT);
    window.Snd?.bed('tops.hum').set(0);
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
  }

  const V = () => S?.tops;
  const me = () => V()?.me;
  const playing = () => me() != null && S.phase === 'playing';
  const colorOf = (i) => ctx.player(V().seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V().seats[i])?.name ?? '?';
  const meterAt = (t) => { const f = ((t / V().meter) % 1 + 1) % 1; return f < 0.5 ? 2 * f : 2 - 2 * f; };

  function showStick(x, y, dx, dy) {
    const st = $('tpStick'), box = $('tpStage').getBoundingClientRect();
    st.hidden = false;
    st.style.left = `${x - box.left}px`; st.style.top = `${y - box.top}px`;
    st.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function keyStick() {
    let x = 0, y = 0;
    for (const k of keys) { x += KEYS[k][0]; y += KEYS[k][1]; }
    setStick(Math.sign(x) / (x && y ? Math.SQRT2 : 1), Math.sign(y) / (x && y ? Math.SQRT2 : 1));
  }
  // the stick goes at most every 40 ms, always ending on the latest (a trailing send)
  let stickT = 0;
  function sendStick() {
    clearTimeout(stickT); stickT = 0;
    if (!playing()) return;
    sentAt = performance.now();
    ctx.input({ sx: +stick[0].toFixed(3), sy: +stick[1].toFixed(3) });
  }
  function setStick(x, y, force = false) {
    stick = [x, y];
    if (!playing()) return;
    const wait = 40 - (performance.now() - sentAt);
    if (force || wait <= 0) sendStick();
    else if (!stickT) stickT = setTimeout(sendStick, wait);
  }
  function press() {
    if (!playing() || !snap) return;
    const t = snap.t[me()];
    if (!t || t[5]) return;
    if (snap.st === 'launch') { if (t[7] < 0) ctx.input({ btn: 'launch' }, true); }
    else if (snap.st === 'spin' && t[6] <= 0) { ctx.input({ btn: 'dash' }, true); ctx.buzz?.(12); }
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    if (lastSeq < 0) lastSeq = s.tops.seq ?? 0;   // don't replay what happened before we arrived
    take(s.tops);
    renderSide();
  }

  function fast(d) {
    if (!V()) return;
    take(d);
    for (const e of d.ev || []) if (e[0] > lastSeq) { lastSeq = e[0]; onEvent(e); }
    const t = performance.now();
    if (t - sideAt > 200) { sideAt = t; renderSide(); }
  }

  function take(d) {
    const was = snap?.st, rd = snap?.rd;
    snap = { st: d.st, rd: d.rd, go: d.go, tl: d.tl, mt: d.mt, t: d.t, sp: d.sp, res: d.res };
    gotAt = performance.now();
    Object.assign(V(), { st: d.st, rd: d.rd, t: d.t, sp: d.sp, res: d.res });
    if (rd !== d.rd) { disp.length = 0; outSeen = []; }
    if (was === 'launch' && d.st === 'spin') ctx?.sfx?.('whoosh');
    d.t.forEach((t, i) => {
      if (t[5] && !outSeen[i]) outSeen[i] = { at: performance.now(), x: t[0], y: t[1], vx: t[2], vy: t[3], how: t[5] };
      else if (!t[5]) outSeen[i] = null;
    });
  }

  // ---------- sound: hard little tops on a hard bowl (the shared Snd kit, static/sfx.js)
  const ROOM = { room: 'room', send: 0.5 };
  function where(x, y) {
    return { pan: Math.max(-0.85, Math.min(0.85, x / (V()?.R || 6))), vol: 1 };
  }
  const snd = (fn, x, y) => window.Snd?.play((t, K) => { const w = x == null ? { pan: 0, vol: 1 } : where(x, y); fn(t, K, K.at({ ...ROOM, pan: w.pan, vol: w.vol })); });
  const SN = {
    // two tops clashing: a bright metallic clack and a ring, louder for harder hits
    clash: (s, x, y, mine) => snd((t, K, d) => {
      const v = Math.min(1.4, 0.4 + s * 0.3) * (mine ? 1.2 : 0.8);
      K.burst(d, t, { type: 'highpass', f: 2500, q: 0.7, vol: 0.18 * v, tau: 0.006 });
      [1870, 2950, 4410].forEach((f, n) => K.mode(d, t, f * K.R(0.97, 1.03), (0.07 - n * 0.015) * v, 0.06 + n * 0.02));
      K.mode(d, t, 420, 0.08 * v, 0.03);
    }, x, y),
    // a dash: a quick rising whirr
    dash: (x, y) => snd((t, K, d) => { K.sweep(d, t, { f0: 220, f1: 700, dur: 0.18, vol: 0.08, type: 'sawtooth', attack: 0.02 }); K.burst(d, t, { type: 'bandpass', f: 900, f1: 2600, q: 1.2, vol: 0.1, tau: 0.04, dur: 0.18 }); }, x, y),
    // the launcher's ripcord
    launch: (mine) => snd((t, K, d) => {
      for (let n = 0; n < 7; n++) K.burst(d, t + n * 0.025, { type: 'bandpass', f: 3000 - n * 120, q: 3, vol: mine ? 0.12 : 0.05, tau: 0.005 });
      K.sweep(d, t + 0.05, { f0: 300, f1: 1200, dur: 0.3, vol: mine ? 0.06 : 0.025, type: 'triangle' });
    }),
    // a top flying over the rim: a falling whine and a clatter far below
    ring: (x, y) => snd((t, K, d) => {
      K.sweep(d, t, { f0: 900, f1: 180, dur: 0.6, vol: 0.07, type: 'triangle' });
      for (let n = 0; n < 4; n++) K.burst(d, t + 0.55 + n * K.R(0.05, 0.1), { type: 'bandpass', f: K.R(1500, 3000), q: 2, vol: 0.08, tau: 0.01 });
    }, x, y),
    // a top running out of spin: the wobbling rattle as it falls over
    topple: (x, y) => snd((t, K, d) => {
      for (let n = 0; n < 9; n++) K.burst(d, t + n * (0.09 - n * 0.006), { type: 'bandpass', f: 1800, q: 2.5, vol: 0.05 + n * 0.008, tau: 0.008 });
      K.mode(d, t + 0.6, 260, 0.1, 0.06);
    }, x, y),
    // a spark ring caught: a bright rising chime
    zap: (mine, x, y) => snd((t, K, d) => { [784, 1175, 1568].forEach((f, n) => K.mode(d, t + n * 0.05, f, mine ? 0.08 : 0.03, 0.15)); }, x, y),
  };
  // my own top's hum while it spins: pitch and level follow the spin
  const humBed = (K, dst) => {
    const A = K.ctx, o = A.createOscillator(), o2 = A.createOscillator(), g = A.createGain(), f = A.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine'; f.type = 'lowpass'; f.frequency.value = 1200; g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g).connect(dst); o.start(); o2.start();
    return {
      set(l, x = 0) {
        const fr = 70 + 200 * x;
        o.frequency.setTargetAtTime(fr, A.currentTime, 0.1); o2.frequency.setTargetAtTime(fr * 2.01, A.currentTime, 0.1);
        g.gain.setTargetAtTime(0.02 * l, A.currentTime, 0.15);
      },
      stop() { try { o.stop(); o2.stop(); } catch {} },
    };
  };

  function showFlash(text, ms = 1400) { flash = { text, until: performance.now() + ms }; }

  function onEvent(e) {
    const [, kind, ...a] = e, i = me();
    const at = (j) => (snap?.t?.[j] ? [snap.t[j][0], snap.t[j][1]] : [0, 0]);
    if (kind === 'hit') {
      const [p, q, x, y, s] = a, mine = p === i || q === i;
      SN.clash(s, x, y, mine);
      (gl || flat)?.sparks(x, y, Math.round(6 + s * 6), [colorOf(p), colorOf(q)]);
      if (mine) { ctx.buzz?.(Math.round(15 + s * 10)); if (s > 1.6) gl?.shake(Math.min(0.4, s * 0.1)); }
    } else if (kind === 'dash') {
      SN.dash(...at(a[0]));
      gl?.dash(a[0]);
    } else if (kind === 'launch') {
      SN.launch(a[0] === i);
      if (a[0] === i) showFlash(a[1] >= 0.85 ? '🔥 Perfect launch!' : a[1] >= 0.6 ? '🚀 Good launch' : '🌀 Weak launch', 1200);
    } else if (kind === 'out') {
      const [j, how, by] = a;
      if (how === 'ring') SN.ring(...at(j)); else SN.topple(...at(j));
      (gl || flat)?.sparks(...at(j), 14, [colorOf(j), '#ffffff']);
      if (j === i) { ctx.buzz?.([60, 40, 120]); showFlash(how === 'ring' ? '💥 Over the rim!' : '😵 Out of spin!', 1800); }
      else if (by === i && how === 'ring') { ctx.sfx?.('good'); showFlash(`💥 You rang out ${nameOf(j)}! +1`, 1800); }
    } else if (kind === 'zap') {
      const [j, x, y] = a;
      SN.zap(j === i, x, y);
      (gl || flat)?.sparks(x, y, 18, ['#ffe066', '#fff3b0', '#7fd0ff']);
      if (j === i) showFlash('⚡ Spin boost!', 900);
    } else if (kind === 'round') {
      const w = a[0];
      if (w === i) { ctx.sfx?.('win'); ctx.buzz?.([40, 40, 80]); }
      else ctx.sfx?.('turn');
    }
  }

  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function renderSide() {
    const v = V(), box = $('tpSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    const order = v.seats.map((_, i) => i).sort((a, b) => snap.t[b][8] - snap.t[a][8]);
    for (const i of order) {
      const p = ctx.player(v.seats[i]), t = snap.t[i];
      const row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const state = t[5] === 1 ? ' 💥' : t[5] === 2 ? ' 😵' : '';
      const bar = ctx.el('span', 'tp-mini'), fill = ctx.el('i'); fill.style.width = `${Math.round(Math.max(0, t[4]) * 100)}%`; fill.style.background = colorOf(i); bar.append(fill);
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === v.me ? ' (you)' : ''}${state}`), bar, ctx.el('b', '', `🌀 ${t[8]}`));
      box.append(row);
    }
    const mine = v.me != null ? snap.t[v.me] : null, b = $('tpBtn');
    b.parentElement.hidden = v.me == null;
    if (!mine) return;
    const out = mine[5] > 0;
    if (snap.st === 'launch') {
      b.textContent = mine[7] < 0 ? '🚀 Launch!' : `🚀 ${Math.round(mine[7] * 100)}%`;
      b.disabled = mine[7] >= 0 || S.phase !== 'playing';
      b.classList.toggle('tp-ready', mine[7] < 0);
    } else {
      b.classList.remove('tp-ready');
      b.textContent = mine[6] > 0 ? `💨 ${mine[6].toFixed(1)}s` : '💨 Dash';
      b.disabled = snap.st !== 'spin' || out || mine[6] > 0 || S.phase !== 'playing';
    }
    $('tpInfo').textContent = out ? (mine[5] === 1 ? '💥 Out: over the rim' : '😵 Out of spin') : '';
  }

  // where top i is now: the server's last word plus its velocity since then is the target; tops glide toward it
  const disp = [];
  let predAt = 0;
  function target(i, now) {
    const k = snap.t[i];
    const t = snap.st === 'spin' && !k[5] ? Math.min(0.12, (now - gotAt) / 1000) : 0;
    return [k[0] + k[2] * t, k[1] + k[3] * t];
  }
  function stepPos(now) {
    const dt = Math.min(0.1, predAt ? (now - predAt) / 1000 : 0); predAt = now;
    snap.t.forEach((k, i) => {
      const [tx, ty] = target(i, now);
      const d = disp[i];
      if (!d) { disp[i] = { x: tx, y: ty }; return; }
      const ex = tx - d.x, ey = ty - d.y;
      if (Math.hypot(ex, ey) > 2.5) { d.x = tx; d.y = ty; } else { const c = Math.min(1, dt * 18); d.x += ex * c; d.y += ey * c; }
    });
  }
  const pos = (i, now) => (disp[i] ? [disp[i].x, disp[i].y] : target(i, now));
  // a top that flew over the rim keeps going and drops out of sight; a toppled one lies where it fell
  function outPose(i, now) {
    const o = outSeen[i]; if (!o) return null;
    const s = (now - o.at) / 1000;
    if (o.how === 1) {
      const m = Math.hypot(o.vx, o.vy) || 1, sp = Math.max(2, m);
      return { x: o.x + (o.vx / m) * sp * s, y: o.y + (o.vy / m) * sp * s, drop: 4.9 * s * s, s, how: 1 };
    }
    return { x: o.x, y: o.y, drop: 0, s, how: o.how };
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !V()) return;
    stepPos(now);
    (gl || flat)?.draw(now);
    const v = V(), mine = v.me != null ? snap.t[v.me] : null;
    window.Snd?.bed('tops.hum', humBed).set(S.phase === 'playing' && !S.paused && snap.st === 'spin' && mine && !mine[5] ? 1 : 0, mine ? mine[4] : 0);
    const cd = snap.st === 'launch' ? snap.go - (now - gotAt) / 1000 : 0;
    let text = '';
    if (S.phase === 'playing' && snap.st === 'launch') text = cd > 0.05 ? String(Math.ceil(cd)) : 'SPIN!';
    else if (S.phase === 'playing' && snap.st === 'between' && snap.res) {
      const w = snap.res[0];
      text = w == null ? 'Nobody left!' : w === v.me ? '🏆 You win the round!' : `🏆 ${nameOf(w)}`;
    }
    const c = S.phase === 'playing' && snap.st === 'launch' ? Math.ceil(cd) : 0;
    if (c !== lastCd) { if (c > 0 && c <= 3) ctx.sfx?.('tick'); lastCd = c; }
    $('tpBanner').hidden = !text; $('tpBanner').textContent = text;
    const small = flash && now < flash.until && snap.st !== 'between' ? flash.text : '';
    $('tpFlash').hidden = !small; $('tpFlash').textContent = small;
    $('tpRound').textContent = `Round ${snap.rd} / ${v.rounds}`;
    const tl = Math.max(0, snap.tl - (snap.st === 'spin' ? (now - gotAt) / 1000 : 0));
    $('tpClock').textContent = snap.st === 'spin' ? `⏱ ${clock(tl)}` : '';
    $('tpClock').classList.toggle('tp-hurry', snap.st === 'spin' && tl <= 10);
    // the launch meter: a needle swinging up and down until you tap
    const mt = $('tpMeter'), showMeter = snap.st === 'launch' && mine && mine[7] < 0 && S.phase === 'playing';
    mt.hidden = !showMeter;
    if (showMeter) {
      const m = meterAt(snap.mt + (now - gotAt) / 1000);
      mt.lastElementChild.style.bottom = `${m * 100}%`;
    }
    const sp = $('tpSpin'); sp.hidden = !mine || snap.st !== 'spin';
    if (mine) { sp.firstElementChild.style.width = `${Math.round(Math.max(0, mine[4]) * 100)}%`; sp.classList.toggle('low', mine[4] < v.wobble); }
  }

  // ---------- three.js bowl
  function canvasTex(T, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) draw(g, w, h);
    return new T.CanvasTexture(c);
  }
  // the bowl's surface height at a distance r from the middle (the dish rises toward the rim, then a lip)
  const DEPTH = 0.9;
  const bowlH = (r, R) => (r <= R ? DEPTH * (r / R) ** 2 : DEPTH + Math.min(0.3, (r - R) * 1.2));

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const v0 = V(), R = v0.R;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.5, 400);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.05, hemi: [0xcfd8ff, 0x2a1d3a, 0.55],
      key: { i: 1.15, color: 0xfff1dc, pos: [-6, 16, 8], area: R + 3, near: 2, far: 50 },
      sky: { top: 0x0b0820, horizon: 0x3a1f5c, bottom: 0x140d24, band: 0.12 },
      env: { accent: 0xff7a3d, walls: 0x1b1430 },
    });
    const low = stg.low;
    // a warm spot over the bowl, and a coloured rim light behind
    const spot = new T.PointLight(0xffd9a8, 0.6, 30); spot.position.set(0, 9, 0); scene.add(spot);
    // the table: dark felt far below the rim
    const felt = canvasTex(T, 256, 256, (g, w, h) => {
      g.fillStyle = '#1d1630'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 2400; k++) { g.fillStyle = Math.random() < 0.5 ? '#251c3d' : '#171126'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    });
    felt.wrapS = felt.wrapT = T.RepeatWrapping; felt.repeat.set(10, 10);
    const table = new T.Mesh(new T.CircleGeometry(60, 48), new T.MeshStandardMaterial({ map: felt, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -2.2; table.receiveShadow = true; scene.add(table);
    // the bowl: a lathe from the middle out to the lip and down the outside, polished wood with painted rings
    const pts = [];
    for (let k = 0; k <= 40; k++) { const r = (k / 40) * R; pts.push(new T.Vector2(Math.max(0.001, r), bowlH(r, R))); }
    pts.push(new T.Vector2(R + 0.25, DEPTH + 0.3), new T.Vector2(R + 0.55, DEPTH + 0.32), new T.Vector2(R + 0.75, DEPTH + 0.1), new T.Vector2(R + 0.6, -2.2));
    const rings = canvasTex(T, 64, 1024, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#3a2a1c'); grd.addColorStop(0.5, '#6b4628'); grd.addColorStop(0.85, '#8a5a32'); grd.addColorStop(1, '#3a2614');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h * 0.85; y += 3 + Math.random() * 6) { g.fillStyle = `rgba(30,15,5,${0.08 + Math.random() * 0.12})`; g.fillRect(0, y, w, 1 + Math.random() * 2); }
      // painted target rings on the dish
      [[0.2, '#ffcf6a'], [0.5, '#e8673a'], [0.76, '#ffcf6a']].forEach(([f, c]) => { g.fillStyle = c; g.fillRect(0, f * h * 0.86, w, 7); });
      g.fillStyle = '#ffcf6a'; g.fillRect(0, h * 0.86 - 2, w, 14);
    });
    const bowlMat = new T.MeshStandardMaterial({ map: rings, roughness: 0.32, metalness: 0.05, side: T.DoubleSide });
    const bowl = new T.Mesh(new T.LatheGeometry(pts, 72), bowlMat);
    bowl.receiveShadow = true; bowl.castShadow = !low; scene.add(bowl);
    // rim lights: little bulbs round the lip, chasing
    const NB = 40, bulbs = new T.InstancedMesh(new T.SphereGeometry(0.08, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }), NB);
    const m4 = new T.Matrix4(), bc = new T.Color();
    for (let k = 0; k < NB; k++) { const a = (k / NB) * Math.PI * 2; m4.makeTranslation(Math.cos(a) * (R + 0.4), DEPTH + 0.36, Math.sin(a) * (R + 0.4)); bulbs.setMatrixAt(k, m4); bulbs.setColorAt(k, bc.set(0xffd27a)); }
    scene.add(bulbs);
    // the tops: a lathe body in the player's colour with stripes (so the spin shows), a metal tip and a stem
    const metal = new T.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.9, roughness: 0.25 });
    const prof = [[0.001, 0], [0.06, 0.05], [0.16, 0.14], [0.42, 0.3], [0.5, 0.38], [0.5, 0.44], [0.4, 0.52], [0.16, 0.58], [0.07, 0.6]].map(([x, y]) => new T.Vector2(x, y));
    const bodyGeo = new T.LatheGeometry(prof, 32), stemGeo = new T.CylinderGeometry(0.06, 0.07, 0.42, 10), tipGeo = new T.ConeGeometry(0.06, 0.12, 10);
    const capGeo = new T.SphereGeometry(0.09, 10, 8);
    const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
    const discGeo = new T.CircleGeometry(1, 24);
    const tops = [];
    function stripes(col) {
      return canvasTex(T, 256, 64, (g, w, h) => {
        const n = 8;
        for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? col : '#ffffff'; g.fillRect((k / n) * w, 0, w / n + 1, h); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h * 0.62, w, h * 0.08);
        g.globalAlpha = 0.5; g.fillStyle = '#ffd23f'; g.fillRect(0, h * 0.4, w, h * 0.06); g.globalAlpha = 1;
      });
    }
    function ensureTops() {
      while (tops.length < snap.t.length) {
        const i = tops.length, col = colorOf(i);
        const g = new T.Group(), tilt = new T.Group(), spin = new T.Group(); g.add(tilt); tilt.add(spin);
        const body = new T.Mesh(bodyGeo, new T.MeshStandardMaterial({ map: stripes(col), roughness: 0.35, metalness: 0.15 }));
        body.castShadow = !low; spin.add(body);
        const stem = new T.Mesh(stemGeo, metal); stem.position.y = 0.78; stem.castShadow = !low; spin.add(stem);
        const cap = new T.Mesh(capGeo, new T.MeshStandardMaterial({ color: col, roughness: 0.3 })); cap.position.y = 1.0; spin.add(cap);
        const tip = new T.Mesh(tipGeo, metal); tip.rotation.x = Math.PI; tip.position.y = 0.02; spin.add(tip);
        const sh = new T.Mesh(discGeo, shadowMat); sh.rotation.x = -Math.PI / 2; sh.scale.setScalar(0.5); scene.add(sh);
        // a blur disc that shows when spinning fast (a smear of the colour round the body)
        const blur = new T.Mesh(new T.CylinderGeometry(0.52, 0.52, 0.06, 32, 1, true), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0, side: T.DoubleSide, depthWrite: false }));
        blur.position.y = 0.41; tilt.add(blur);
        let ring = null, arrow = null;
        if (i === me()) {
          ring = new T.Mesh(new T.RingGeometry(0.62, 0.78, 32), new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; scene.add(ring);
          arrow = new T.Mesh(new T.ConeGeometry(0.16, 0.3, 4), new T.MeshBasicMaterial({ color: 0xffc83d })); arrow.rotation.x = Math.PI; g.add(arrow);
        }
        g.scale.setScalar(1.15);
        scene.add(g);
        tops.push({ g, tilt, spin, blur, sh, ring, arrow, ang: Math.random() * 6, prec: Math.random() * 6, dashAt: 0 });
      }
    }
    // ⚡ spark rings: glowing tori standing on the dish
    const sparkGeo = new T.TorusGeometry(v0.sparkR, 0.07, 8, 32), sparkMat = new T.MeshBasicMaterial({ color: 0xffe066 });
    const sparkObjs = new Map();
    function syncSparks(now) {
      const seen = new Set();
      for (const s of snap.sp) {
        seen.add(s[3]);
        let o = sparkObjs.get(s[3]);
        if (!o) {
          o = new T.Group();
          const t1 = new T.Mesh(sparkGeo, sparkMat), t2 = new T.Mesh(sparkGeo, sparkMat); t2.rotation.y = Math.PI / 2;
          const glow = new T.Mesh(discGeo, new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.25, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.scale.setScalar(v0.sparkR * 1.3);
          o.add(t1, t2); o.userData.glow = glow; o.userData.born = now; scene.add(o, glow); sparkObjs.set(s[3], o);
        }
        const h = bowlH(Math.hypot(s[0], s[1]), R), grow = Math.min(1, (now - o.userData.born) / 300), fade = Math.min(1, s[2] / 1.2);
        o.position.set(s[0], h + 0.55 + Math.sin(now / 250) * 0.08, s[1]); o.rotation.y = now / 400;
        o.scale.setScalar(Math.max(0.01, grow * (0.6 + 0.4 * fade)));
        o.userData.glow.position.set(s[0], h + 0.02, s[1]); o.userData.glow.material.opacity = 0.25 * fade;
      }
      for (const [id, o] of sparkObjs) if (!seen.has(id)) { scene.remove(o, o.userData.glow); o.userData.glow.material.dispose(); sparkObjs.delete(id); }
    }
    // sparks off hits: a shared particle pool
    const NP = 300, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    let pNext = 0;
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const puffs = new T.Points(pGeo, new T.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    puffs.frustumCulled = false; scene.add(puffs);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -999;
    const tmpC = new T.Color();
    function burst(x, y, z, n, colors, speed = 4) {
      if (calm()) n = Math.ceil(n / 3);
      for (let k = 0; k < n; k++) {
        const j = pNext; pNext = (pNext + 1) % NP;
        pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z;
        const a = Math.random() * 6.283, s = speed * (0.4 + Math.random());
        pVel[j * 3] = Math.cos(a) * s; pVel[j * 3 + 1] = (0.4 + Math.random()) * speed * 0.7; pVel[j * 3 + 2] = Math.sin(a) * s;
        tmpC.set(colors[k % colors.length]); pCol[j * 3] = tmpC.r; pCol[j * 3 + 1] = tmpC.g; pCol[j * 3 + 2] = tmpC.b;
        pLife[j] = 0.2 + Math.random() * 0.3;
      }
    }
    function tickPuffs(dt) {
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt;
        if (pLife[j] <= 0) { pPos[j * 3 + 1] = -999; continue; }
        pVel[j * 3 + 1] -= 12 * dt;
        pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }
    // dash streaks: a short-lived trail behind a dashing top
    const trailMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending });

    let aspect = 1, lastDraw = 0;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h;
      camera.updateProjectionMatrix();
    }
    function place() {
      // the whole bowl in view whatever the screen shape
      const r = R + 1.0, tv = Math.tan((camera.fov * Math.PI) / 360);
      const d = Math.max(r / (tv * aspect), (r * 0.95) / tv) * 1.02;
      camera.position.set(0, d * 0.82, d * 0.58); camera.lookAt(0, 0, 0.35);
    }
    const UP = new T.Vector3(0, 1, 0), axis = new T.Vector3();
    function draw(now) {
      ensureTops();
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      place(); GL3.tickShake(camera, dt); stg.follow(camera);
      const v = V();
      // chasing rim lights: brighter during a fight
      const live = snap.st === 'spin';
      for (let k = 0; k < NB; k++) {
        const on = (Math.floor(now / 90) + k) % 6 < (live ? 2 : 3);
        bulbs.setColorAt(k, bc.set(on ? (live ? 0xfff0b0 : 0xffd27a) : 0x5a3a20));
      }
      bulbs.instanceColor.needsUpdate = true;
      snap.t.forEach((k, i) => {
        const o = tops[i]; if (!o) return;
        const p = ctx.player(v.seats[i]), here = !!p && !p.eliminated && k[5] !== 3;
        const op = k[5] ? outPose(i, now) : null;
        const gone = op && op.how === 1 && op.drop > 6;
        o.g.visible = o.sh.visible = here && !gone;
        if (o.ring) o.ring.visible = o.g.visible && !k[5];
        if (!o.g.visible) return;
        const [x, y] = op ? [op.x, op.y] : pos(i, now), r = Math.hypot(x, y);
        const h = op && op.how === 1 ? Math.max(-2.2, bowlH(Math.min(r, R + 0.6), R) - op.drop) : bowlH(Math.min(r, R + 0.6), R);
        o.g.position.set(x, h, y);
        // spin: the body turns with the spin; a blur ring shows when it's fast
        const sp = k[5] ? 0 : Math.max(0, k[4]);
        if (snap.st === 'launch') o.ang += dt * (k[7] >= 0 ? 4 : 0.5);
        else o.ang += dt * (k[5] && op ? Math.max(0, 10 - op.s * 20) : 6 + sp * 34);
        o.spin.rotation.y = o.ang;
        o.blur.material.opacity = calm() ? 0 : Math.max(0, (sp - 0.35) * 0.45);
        // tilt: lean with the dish's slope, wobble (precess) as the spin runs low, lie down when toppled
        const slope = r > 0.01 && r <= R ? Math.atan(2 * DEPTH * r / (R * R)) : 0;
        let lean = slope * 0.7, dir = Math.atan2(y, x);
        if (!k[5] && sp < v.wobble && snap.st === 'spin') { o.prec += dt * (4 + (v.wobble - sp) * 20); lean += (v.wobble - sp) / v.wobble * 0.45; dir = o.prec; }
        if (k[5] === 2 && op) { lean = Math.min(1.3, op.s * 3); dir = o.prec; }
        if (k[5] === 1 && op) { lean = op.s * 4; }
        axis.set(-Math.sin(dir), 0, Math.cos(dir));
        o.tilt.quaternion.setFromAxisAngle(axis, lean);
        o.sh.position.set(x, h + 0.02, y); o.sh.scale.setScalar(0.55 + (k[5] ? 0.15 : 0));
        if (o.ring) { o.ring.position.set(x, h + 0.03, y); o.ring.material.opacity = 0.55 + 0.3 * Math.sin(now / 250); }
        if (o.arrow) { o.arrow.visible = !k[5]; o.arrow.position.y = 1.55 + 0.1 * Math.sin(now / 220); o.arrow.rotation.y += dt * 2; }
        // sparks from the tip as it skates fast
        const spd = Math.hypot(k[2], k[3]);
        if (!k[5] && live && spd > 3.5 && !calm() && Math.random() < dt * spd * 1.5) burst(x, h + 0.03, y, 1, ['#ffd27a', '#ffffff'], 1.2);
        if (o.dashAt && now - o.dashAt < 350) { if (!low && Math.random() < 0.7) burst(x, h + 0.4, y, 2, [colorOf(i), '#ffffff'], 0.8); }
      });
      syncSparks(now);
      tickPuffs(dt);
      renderer.render(scene, camera);
    }
    function sparks(x, y, n, cols) { const h = bowlH(Math.min(Math.hypot(x, y), R), R); burst(x, h + 0.4, y, n, [...cols, '#ffffff', '#ffe9a8'], 4); }
    function dash(i) { if (tops[i]) tops[i].dashAt = performance.now(); }
    const shake = (a) => GL3.shake(camera, a);
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); trailMat.dispose(); }
    resize();
    return { draw, resize, dispose, shake, sparks, dash };
  }

  // ---------- flat fallback (no WebGL): the bowl from above
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    const pops = [];
    let ang = 0, lastT = 0;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), v = V(); if (!v) return;
      const w = stage.clientWidth || 320, h = stage.clientHeight || 240, s = Math.min(w, h);
      canvas.style.width = canvas.style.height = `${s}px`;
      canvas.width = canvas.height = Math.round(s * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      const v = V(), W = canvas.width, k = W / (2 * v.R + 2), X = (x) => W / 2 + x * k, Y = (y) => W / 2 + y * k;
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; ang += dt * 20;
      g.clearRect(0, 0, W, W);
      const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, v.R * k);
      grd.addColorStop(0, '#8a5a32'); grd.addColorStop(1, '#4a2e18');
      g.fillStyle = grd; g.beginPath(); g.arc(W / 2, W / 2, v.R * k, 0, 7); g.fill();
      g.strokeStyle = '#ffcf6a'; g.lineWidth = 0.12 * k; g.stroke();
      [0.45, 0.72].forEach((f) => { g.strokeStyle = 'rgba(255,207,106,0.35)'; g.lineWidth = 0.05 * k; g.beginPath(); g.arc(W / 2, W / 2, v.R * k * f, 0, 7); g.stroke(); });
      for (const s of snap.sp) { g.strokeStyle = '#ffe066'; g.lineWidth = 0.1 * k; g.beginPath(); g.arc(X(s[0]), Y(s[1]), v.sparkR * k, 0, 7); g.stroke(); }
      snap.t.forEach((t, i) => {
        const p = ctx.player(v.seats[i]); if (!p || p.eliminated || t[5] === 3) return;
        const op = t[5] ? outPose(i, now) : null;
        if (op && op.how === 1 && op.s > 0.8) return;
        const [x, y] = op ? [op.x, op.y] : pos(i, now), r = v.body * k;
        g.globalAlpha = t[5] ? 0.4 : 1;
        g.fillStyle = colorOf(i); g.beginPath(); g.arc(X(x), Y(y), r, 0, 7); g.fill();
        g.strokeStyle = i === v.me ? '#ffc83d' : '#0008'; g.lineWidth = r * 0.22; g.stroke();
        // stripes turning with the spin
        if (!t[5]) {
          g.strokeStyle = '#ffffffcc'; g.lineWidth = r * 0.18;
          const a0 = ang * (0.3 + t[4]) + i;
          for (let n = 0; n < 3; n++) { const a = a0 + n * 2.094; g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(x) + Math.cos(a) * r * 0.85, Y(y) + Math.sin(a) * r * 0.85); g.stroke(); }
        }
        g.globalAlpha = 1;
      });
      for (let j = pops.length - 1; j >= 0; j--) {
        const p = pops[j], t = (now - p.at) / 400;
        if (t >= 1) { pops.splice(j, 1); continue; }
        g.globalAlpha = 1 - t; g.strokeStyle = p.col; g.lineWidth = 0.1 * k;
        g.beginPath(); g.arc(X(p.x), Y(p.y), (0.3 + t * 0.9) * k, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    const sparks = (x, y, n, cols) => pops.push({ x, y, col: cols[0] || '#ffe066', at: performance.now() });
    resize();
    return { draw, resize, dispose() { canvas.remove(); }, sparks };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🌀 Spin Tops — round ${s.tops.rd} of ${s.tops.rounds}` : null);
  const myMove = (s) => s.phase === 'playing' && s.tops.me != null && (s.tops.st === 'spin' || (s.tops.st === 'launch' && s.tops.t?.[s.tops.me]?.[7] < 0));

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
