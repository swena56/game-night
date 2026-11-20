// Regatta: a sailing race in 3D (three.js) or flat from above. The server sails the lake 30 times a second and streams
// it (fast()); the page carries each boat on along its heading between packets. Steer by dragging sideways on the
// lake (or ← → / A D, or hold ◀ ▶); ⟲ Tack (Space / T) turns you through the wind.
// #176: realistic water (a wave shader: swell that the boats ride, fresnel sky, sun glint, crest foam, gust cat's paws,
// foam wakes) and 🏴‍☠️ pirate sloops: 💥 Fire (F) shoots a broadside at the nearest rival abeam; the server picks the
// target, flies the ball and says where it lands (fire / hit / splash events + the balls in flight in every packet).
UI.regatta = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null, keyFn = null, keyUp = null;
  let auto = false, autoTackAt = 0, steer = 0, drag = null, keys = new Set(), lastSent = 0, sentSteer = 0, lastSeq = -1, flash = null, sideAt = 0, holdBtn = 0;
  // #150: drag points the boat: goal = the heading you pointed at (shown as a white arrow until the boat gets there)
  let goal = null, goalShow = 0, sentHead = null, headAt = 0;
  // 🏴‍☠️ balls in flight (id → flight), effects to show (fire smoke, splashes, hits), foam trails behind each boat
  let balls = new Map(), fxq = [], fxSeq = 0, trails = [], trailRace = 0;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const V = () => S?.regatta;
  const me = () => V()?.me;
  const nameOf = (i) => ctx?.player(V()?.seats[i])?.name ?? '?';
  const colorOf = (i) => ctx?.player(V()?.seats[i])?.color ?? '#ccc';
  const playing = () => S?.phase === 'playing' && me() != null && snap?.st === 'race' && !snap.b[me()][5];

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; auto = false; steer = 0; drag = null; keys = new Set(); lastSeq = -1; flash = null; holdBtn = 0; goal = null; sentHead = null;
    balls = new Map(); fxq = []; trails = [];
    main.innerHTML = `<div class="rg"><div class="rg-stage" id="rgStage">
        <div class="rg-hud"><span id="rgPos"></span><span id="rgClock" class="rg-clock"></span></div>
        <div class="rg-sub"><span id="rgNext"></span><span id="rgSpd"></span></div>
        <canvas class="rg-map" id="rgMap" width="120" height="120"></canvas>
        <div class="rg-warn" id="rgWarn" hidden></div>
        <div class="rg-count" id="rgCount" hidden></div>
        <div class="rg-flash" id="rgFlash" hidden></div>
        <div class="rg-done" id="rgDone" hidden><h3 id="rgDoneTitle"></h3><div id="rgStand"></div></div>
      </div>
      <div class="rg-ctl"><button id="rgL" aria-label="Steer left">◀</button><button class="rg-tack" id="rgTack">⟲ Tack</button><button class="rg-auto" id="rgAuto" aria-pressed="false" title="Sail to the next buoy for me: tacks upwind by itself. Steering takes over.">🧭 Auto</button><button class="rg-fire" id="rgFire" hidden aria-label="Fire a broadside"><span>💥 Fire</span><small id="rgAmmo"></small></button><button id="rgR" aria-label="Steer right">▶</button></div>
      <p id="rgHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>⛵ Fleet</h3><div id="rgSeats" class="rg-seats"></div></div>';
    const hold = (el, dir) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); holdBtn = dir; update(true); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { if (holdBtn === dir) { holdBtn = 0; update(true); } });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold($('rgL'), 1); hold($('rgR'), -1);
    $('rgTack').addEventListener('click', tack);
    $('rgAuto').addEventListener('click', () => { auto = !auto; autoTackAt = 0; setAuto(); if (!auto) { goal = null; sentHead = null; } });
    $('rgFire').addEventListener('click', fire);
    const stage = $('rgStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .rg-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      const m = myBoat();
      auto = false; setAuto();
      drag = { id: e.pointerId, x: e.clientX, h0: goal ?? m?.h ?? 0 };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId || drag.dead) return;
      const w = stage.clientWidth || 300;
      // drag right: point to the right (a smaller heading); half the stage's width turns you about 100°
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) < 4 && goal == null) return;
      goal = wrap(drag.h0 - clamp(dx / (w * 0.5), -1.6, 1.6) * 1.75);
      goalShow = performance.now();
      sendHead();
    });
    const end = (e) => { if (drag && (!e || drag.id === e.pointerId)) { drag = null; sendHead(true); } };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    keyFn = (e) => {
      if (!V() || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'a', 'd'].includes(k)) { keys.add(k); update(true); e.preventDefault(); }
      else if ((k === ' ' || k === 't') && !e.repeat) { e.preventDefault(); tack(); }
      else if ((k === 'f' || k === 'enter') && !e.repeat && V()?.guns) { e.preventDefault(); fire(); }
    };
    keyUp = (e) => { const k = e.key.toLowerCase(); if (keys.delete(k)) update(true); };
    window.addEventListener('keydown', keyFn); window.addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
    if (keyFn) window.removeEventListener('keydown', keyFn); if (keyUp) window.removeEventListener('keyup', keyUp); keyFn = keyUp = null;
    window.Snd?.bed('rg.water').set(0); window.Snd?.bed('rg.wind').set(0);
  }

  // ---------- steering
  function myBoat() { return me() != null && snap ? boats(performance.now())[me()] : null; }
  function sendHead(force) {
    if (goal == null || !playing()) return;
    const now = performance.now();
    if (sentHead != null && Math.abs(wrap(goal - sentHead)) < 0.02) return;
    if (!force && now - headAt < 60) return;
    sentHead = goal; headAt = now;
    ctx.input({ head: +goal.toFixed(3) }, force);
  }
  function update(force) {
    let s = 0;
    if (keys.has('arrowleft') || keys.has('a')) s = 1;
    if (keys.has('arrowright') || keys.has('d')) s = -1;
    if (holdBtn) s = holdBtn;
    steer = s;
    if (s) { goal = null; sentHead = null; if (auto) { auto = false; setAuto(); } }   // ◀ ▶ and the keys steer by rate, as before
    if (!playing()) return;
    const now = performance.now();
    if (force || (Math.abs(steer - sentSteer) > 0.06 && now - lastSent > 60)) {
      sentSteer = steer; lastSent = now;
      ctx.input({ steer: +steer.toFixed(3) }, force);
    }
  }
  function setAuto() { const b = $('rgAuto'); if (b) { b.classList.toggle('on', auto); b.setAttribute('aria-pressed', auto ? 'true' : 'false'); } }
  // 🧭 autopilot: head for the next buoy, or sail close-hauled on the current tack and tack when that points closer
  function autopilot(m, now) {
    const nav = navOf(m), from = snap.w[0], nogo = (V().nogo || 38) * Math.PI / 180;
    let h = nav.bt;
    if (nav.upwind) {
      const side = Math.sign(wrap(m.h - from)) || 1;
      h = wrap(from + side * (nogo + 0.14));
      if (nav.tackNow && now - autoTackAt > 3000) { autoTackAt = now; ctx.input({ tack: true }, true); SND.luff(); goal = null; sentHead = null; return; }
    }
    goal = h; goalShow = now; sendHead();
  }
  function tack() {
    if (!playing()) return;
    if (auto) { auto = false; setAuto(); }
    goal = null; sentHead = null; if (drag) drag.dead = true;   // a tack takes the helm; lift your finger to point again
    ctx.input({ tack: true }, true); SND.luff(); ctx.buzz?.(10);
  }
  // 💥 the server aims (the nearest rival abeam); the page only checks there's a ball and someone to shoot
  function fire() {
    if (!playing() || !V().guns) return;
    const m = myBoat(); if (!m) return;
    if (m.ammo <= 0) { showFlash('⏳ Reloading…', 900); return; }
    if (!aimOf(m, boats(performance.now()))) { showFlash('🎯 Nobody abeam in range', 1100); return; }
    ctx.input({ fire: true }, true); ctx.buzz?.(25);
  }
  // mirrors Regatta.aim: the nearest rival (or the pirate ship) within the range and within the arc off either beam
  function aimOf(m, bs) {
    const v = V(), [RANGE, ARCd] = v.cannon || [32, 50], ARC = ARCd * Math.PI / 180;
    const cands = bs.filter((o) => o.i !== m.i && !o.place && !(o.guard > 0) && o.on).map((o) => [o.i, o.x, o.y]);
    if (snap.np && !(snap.np[3] > 0)) cands.push([-1, snap.np[0], snap.np[1]]);
    let best = null;
    for (const [j, x, y] of cands) {
      const d = Math.hypot(x - m.x, y - m.y); if (d < 4 || d > RANGE) continue;
      const rel = wrap(Math.atan2(y - m.y, x - m.x) - m.h), off = Math.abs(Math.abs(rel) - Math.PI / 2);
      if (off > ARC) continue;
      const sc = d + off * 12;
      if (!best || sc < best.sc) best = { sc, j, d, side: rel > 0 ? 1 : -1, x, y };
    }
    return best;
  }

  // ---------- sound: out on the water
  const AT = { room: 'outdoor', send: 0.25 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    luff: () => snd((t, K, d) => { for (let k = 0; k < 6; k++) K.burst(d, t + k * 0.07, { type: 'bandpass', f: K.R(500, 900), q: 1.2, vol: 0.09, tau: 0.05 }); }),
    mark: () => snd((t, K, d) => { K.mode(d, t, 880, 0.12, 0.8); K.mode(d, t, 1320, 0.05, 0.5); }),
    gun: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 900, q: 0.7, vol: 0.5, tau: 0.25, buf: 'brown' }); K.mode(d, t, 70, 0.3, 0.3); }),
    horn: () => snd((t, K, d) => { K.sweep(d, t, { f0: 330, f1: 335, dur: 0.6, vol: 0.12, type: 'sawtooth', attack: 0.03 }); }),
    bump: () => snd((t, K, d) => { K.mode(d, t, 120, 0.25, 0.12, { f1: 80 }); K.burst(d, t, { type: 'lowpass', f: 700, q: 0.7, vol: 0.2, tau: 0.08, buf: 'brown' }); }),
    // 🏴‍☠️ a cannon: the crack, then the deep boom rolling over the water
    boom: (pan, vol) => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 2200, q: 0.7, vol: 0.18, tau: 0.03 }); K.burst(d, t, { type: 'lowpass', f: 520, f1: 160, q: 0.7, vol: 0.7, tau: 0.45, buf: 'brown' }); K.mode(d, t, 52, 0.45, 0.5, { f1: 34 }); }, pan, vol),
    splash: (pan, vol) => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 1400, f1: 500, q: 0.6, vol: 0.28, tau: 0.3 }); K.burst(d, t + 0.05, { type: 'lowpass', f: 400, q: 0.6, vol: 0.2, tau: 0.2, buf: 'brown' }); }, pan, vol),
    crunch: (pan, vol) => snd((t, K, d) => { K.mode(d, t, 140, 0.4, 0.18, { f1: 70 }); for (let k = 0; k < 5; k++) K.burst(d, t + k * 0.025, { type: 'bandpass', f: K.R(900, 2600), q: 1.5, vol: 0.12, tau: 0.04 }); K.burst(d, t, { type: 'lowpass', f: 600, q: 0.7, vol: 0.4, tau: 0.3, buf: 'brown' }); }, pan, vol),
    keg: () => snd((t, K, d) => { K.mode(d, t, 180, 0.3, 0.15, { f1: 150 }); K.mode(d, t + 0.08, 990, 0.08, 0.4); K.mode(d, t + 0.16, 1320, 0.07, 0.5); }),
  };
  // where a sound sits for my ears: panned by its bearing off my bow, quieter far off
  const earOf = (x, y) => {
    const m = myBoat() || boats(performance.now())[0]; if (!m) return [0, 0.6];
    const rel = wrap(Math.atan2(y - m.y, x - m.x) - m.h), d = Math.hypot(x - m.x, y - m.y);
    return [clamp(-Math.sin(rel), -0.9, 0.9), clamp(1.15 - d / 70, 0.15, 1)];
  };
  const waterBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), bp = A.createBiquadFilter(), g = A.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7; g.gain.value = 0;
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.06 * l, A.currentTime, 0.4); bp.frequency.setTargetAtTime(500 + 500 * l, A.currentTime, 0.4); }, stop() { try { src.stop(); } catch {} } };
  };
  const windBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('pink'), bp = A.createBiquadFilter(), g = A.createGain();
    bp.type = 'highpass'; bp.frequency.value = 1500; g.gain.value = 0;
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.02 * l, A.currentTime, 0.6); }, stop() { try { src.stop(); } catch {} } };
  };

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    const v = V();
    if (!snap || v.race !== snap.race || v.st !== snap.st) take(v);
    renderSide(); done(); hint();
  }

  function fast(d) {
    if (!V()) return;
    take(d);
    for (const e of d.ev || []) if (e[0] > lastSeq) { lastSeq = e[0]; onEvent(e); }
    const t = performance.now();
    if (t - sideAt > 300) { sideAt = t; renderSide(); }
  }

  function take(d) {
    const was = snap?.st;
    snap = { st: d.st, race: d.race, go: d.go, rt: d.rt, gr: d.gr, nx: d.nx, w: d.w, g: d.g, b: d.b, np: d.np, kg: d.kg || [] };
    gotAt = performance.now();
    if (d.race !== trailRace) { trails = []; balls.clear(); trailRace = d.race; }
    // balls in flight: keep each one's own clock (the packet says how long it has flown)
    for (const [id, x0, y0, x1, y1, age, T, src] of d.bl || []) if (!balls.has(id)) balls.set(id, { x0, y0, x1, y1, T, src, t0: gotAt - age * 1000 });
    Object.assign(V(), { st: d.st, b: d.b, w: d.w, g: d.g });
    if (was === 'countdown' && d.st === 'race') { SND.gun(); if (steer) update(true); else if (goal != null) { sentHead = null; sendHead(true); } }
    if (d.st !== 'race' && was === 'race') { goal = null; sentHead = null; }
  }

  function showFlash(text, ms = 1600) { flash = { text, until: performance.now() + ms }; }

  function onEvent(e) {
    const [, kind, ...a] = e, i = me();
    if (kind === 'mark' && a[0] === i) { SND.mark(); ctx.buzz?.(15); showFlash(a[1] < V().course.marks.length ? `🟠 Buoy ${a[1]} rounded!` : '🏁 Now the finish line!'); }
    else if (kind === 'finish') { if (a[0] === i) { SND.horn(); showFlash(a[1] === 1 ? '🏆 You win the race!' : `🏁 You finish ${a[1]}${['st', 'nd', 'rd'][a[1] - 1] || 'th'}!`, 2500); } else if (a[1] === 1) SND.horn(); }
    else if (kind === 'bump' && (a[0] === i || a[1] === i)) { SND.bump(); ctx.buzz?.(30); }
    else if (kind === 'shift' && Math.abs(a[0]) >= 6) showFlash(`🌬 The wind shifts ${Math.abs(a[0])}°`, 1800);
    else if (kind === 'tack' && a[0] !== i) { /* rivals' tacks: just the sail in the scene */ }
    // 🏴‍☠️ cannons: [src, side, sx, sy, px, py, T] / [src, target, x, y] / [x, y, near] / [i] / [src, x, y]
    else if (kind === 'fire') { const [src, side, sx, sy] = a, [pan, vol] = earOf(sx, sy); SND.boom(pan, vol); fx('fire', sx, sy, { src, side }); if (src === i) { shk(0.12); } }
    else if (kind === 'hit') {
      const [src, j, x, y] = a, [pan, vol] = earOf(x, y); SND.crunch(pan, vol); fx('hit', x, y, { j });
      if (j === i) { showFlash(src < 0 ? '🏴‍☠️ Black Jack holed you!' : `💥 ${nameOf(src)} hit you!`, 1600); ctx.buzz?.([60, 40, 80]); shk(0.5); }
      else if (src === i) { showFlash(`🎯 Hit ${nameOf(j)}!`, 1300); ctx.buzz?.(30); }
    }
    else if (kind === 'splash') { const [x, y, near] = a, [pan, vol] = earOf(x, y); SND.splash(pan, vol * 0.8); fx('splash', x, y); if (near === i && i != null) showFlash('😅 Near miss!', 900); }
    else if (kind === 'keg' && a[0] === i) { SND.keg(); showFlash('🛢 +1 cannonball', 1100); }
    else if (kind === 'sink') { const [src, x, y] = a, [pan, vol] = earOf(x, y); SND.crunch(pan, vol); fx('hit', x, y, { j: -1 }); if (src === i) showFlash('🏳 Black Jack silenced! +1 ball', 1600); }
  }
  const shk = (k) => { if (gl?.camera) GL3.shake(gl.camera, k); };
  function fx(kind, x, y, o = {}) { fxq.push({ id: ++fxSeq, kind, x, y, t0: performance.now(), ...o }); if (fxq.length > 40) fxq.shift(); }

  // where each boat is now: the last packet carried on along its heading
  function boats(now) {
    if (!snap) return [];
    const dt = snap.st === 'race' ? Math.min(0.15, (now - gotAt) / 1000) : 0;
    return snap.b.map((b, i) => ({ i, x: b[0] + Math.cos(b[2]) * b[3] * dt, y: b[1] + Math.sin(b[2]) * b[3] * dt, h: b[2], v: b[3], mark: b[4], place: b[5], irons: !!b[6], shadow: !!b[7], gust: !!b[8], pts: b[9], steer: b[10], color: colorOf(i),
      ammo: b[11] ?? 0, rl: b[12] ?? 0, stun: b[13] ?? 0, guard: b[14] ?? 0, on: !ctx?.player(V()?.seats[i])?.eliminated }));
  }
  function standingsNow() {
    if (!snap) return [];
    const v = V(), M = v.course.marks;
    const left = (b) => { const pts = [[b[0], b[1]], ...M.slice(b[4]), [0, v.course.finish[0][1]]]; let s = 0; for (let k = 0; k + 1 < pts.length; k++) s += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); return s; };
    return v.seats.map((_, i) => i).sort((a, b) => (snap.b[a][5] || 99) - (snap.b[b][5] || 99) || left(snap.b[a]) - left(snap.b[b]));
  }

  function renderSide() {
    const v = V(), box = $('rgSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    const order = standingsNow();
    order.forEach((i, n) => {
      const b = snap.b[i], row = ctx.el('div', 'rg-row' + (i === me() ? ' on' : ''));
      const nm = ctx.el('span', 'rg-nm', `${b[5] ? `🏁${b[5]}` : `${n + 1}.`} ${nameOf(i)}`); nm.style.color = colorOf(i);
      const info = ctx.el('small', '', b[5] ? 'finished' : `buoy ${Math.min(b[4] + 1, v.course.marks.length)}/${v.course.marks.length}${b[4] >= v.course.marks.length ? ' → finish' : ''}${b[6] ? ' · in irons' : ''}`);
      row.append(nm, ctx.el('b', '', v.races > 1 ? `${b[9]} pts` : ''), info);
      box.append(row);
    });
  }

  function done() {
    const v = V(), show = snap?.st === 'results' && v.results?.length && S.phase === 'playing';
    $('rgDone').hidden = !show;
    if (!show) return;
    $('rgDoneTitle').textContent = `🏁 Race ${v.race} of ${v.races}`;
    const box = $('rgStand'); box.innerHTML = '';
    for (const [n, [i, t]] of v.results[v.results.length - 1].entries()) {
      const row = ctx.el('div', 'rg-res'); const nm = ctx.el('b', '', `${n + 1}. ${nameOf(i)}`); nm.style.color = colorOf(i);
      row.append(nm, ctx.el('span', '', t ? `${t.toFixed(1)} s` : 'still sailing'), ctx.el('span', '', `${snap.b[i][9]} pts`)); box.append(row);
    }
  }

  function hint() {
    const t = S.phase !== 'playing' ? '' : me() == null ? 'Watch the fleet.' : snap?.st === 'countdown' ? 'Get ready: the first buoy is upwind, so you will need to zig-zag.'
      : V()?.guns ? 'Drag sideways to steer; ⟲ Tack to zig-zag upwind (keep out of the red wedge). 💥 Fire (F) when a rival sits in your side arcs (red ring); grab 🛢 kegs, dodge Black Jack.'
      : 'Drag sideways to point the boat (white arrow). Follow the gold arrow to the buoy; keep out of the red wedge (the wind) and ⟲ Tack to zig-zag upwind.';
    if ($('rgHint').textContent !== t) $('rgHint').textContent = t;
  }

  // the little north-up map in the corner
  function miniMap(bs) {
    const c = $('rgMap'), g = c?.getContext?.('2d'); if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (c.width !== Math.round(120 * dpr)) { c.width = c.height = Math.round(120 * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = V(), M = v.course.marks, w = 120;
    const xs = [...M.map((m) => m[0]), -30, 30], ys = [...M.map((m) => m[1]), -20];
    const x0 = Math.min(...xs) - 12, x1 = Math.max(...xs) + 12, y0 = Math.min(...ys) - 8, y1 = Math.max(...ys) + 12;
    const k = (w - 10) / Math.max(x1 - x0, y1 - y0), ox = (w - (x1 - x0) * k) / 2, oy = (w - (y1 - y0) * k) / 2;
    const X = (x) => ox + (x - x0) * k, Y = (y) => w - oy - (y - y0) * k;
    g.clearRect(0, 0, w, w); g.fillStyle = '#0b2a4acc'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, w, 10) : g.rect(0, 0, w, w); g.fill();
    const my = bs[me()]?.mark ?? 0;
    M.forEach(([x, y], n) => { g.beginPath(); g.arc(X(x), Y(y), n === my ? 4.5 : 3, 0, 7); g.fillStyle = n === my ? '#ffd23f' : '#ff8a3a'; g.fill(); g.fillStyle = '#fff'; g.font = '9px system-ui'; g.fillText(String(n + 1), X(x) + 5, Y(y) + 3); });
    const [[fx0, fy], [fx1]] = v.course.finish; g.strokeStyle = my >= M.length ? '#ffd23f' : '#fff8'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(fx0), Y(fy)); g.lineTo(X(fx1), Y(fy)); g.stroke();
    for (const [x, y, on] of snap.kg) if (on) { g.fillStyle = '#c08040'; g.fillRect(X(x) - 2, Y(y) - 2, 4, 4); }
    if (snap.np) { g.beginPath(); g.arc(X(snap.np[0]), Y(snap.np[1]), 4, 0, 7); g.fillStyle = snap.np[3] > 0 ? '#888' : '#111'; g.fill(); g.strokeStyle = '#ff4a4a'; g.lineWidth = 1.5; g.stroke(); }
    for (const b of bs) { g.save(); g.translate(X(b.x), Y(b.y)); g.rotate(-b.h); g.fillStyle = b.color; g.beginPath(); g.moveTo(5, 0); g.lineTo(-3.5, 3); g.lineTo(-3.5, -3); g.closePath(); g.fill(); if (b.i === me()) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); } g.restore(); }
    // the wind: an arrow along the way it blows
    const to = snap.w[0] + Math.PI, cx = w - 14, cy = 14;
    g.strokeStyle = '#cfe8ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - Math.cos(to) * 8, cy + Math.sin(to) * 8); g.lineTo(cx + Math.cos(to) * 8, cy - Math.sin(to) * 8); g.stroke();
    g.beginPath(); g.arc(cx + Math.cos(to) * 8, cy - Math.sin(to) * 8, 2.5, 0, 7); g.fillStyle = '#cfe8ff'; g.fill();
  }

  function hud(now, bs) {
    const v = V(), m = me() != null ? bs[me()] : null, el = (now - gotAt) / 1000;
    const order = standingsNow();
    $('rgPos').textContent = m ? (m.place ? `🏁 ${m.place}${['st', 'nd', 'rd'][m.place - 1] || 'th'}` : `⛵ ${order.indexOf(me()) + 1} of ${v.seats.length}`) : `⛵ Race ${snap.race}/${v.races}`;
    const rt = snap.st === 'race' ? snap.rt + el : 0;
    const ck = snap.st === 'race' ? (snap.gr >= 0 ? `⏱ ${Math.max(0, Math.ceil(snap.gr - el))} s left` : `⏱ ${Math.floor(rt / 60)}:${String(Math.floor(rt % 60)).padStart(2, '0')}`) : '';
    if ($('rgClock').textContent !== ck) $('rgClock').textContent = ck;
    const nav = m && !m.place ? navOf(m) : null;
    $('rgNext').textContent = nav ? `${m.mark < v.course.marks.length ? `🟠 Buoy ${m.mark + 1}` : '🏁 Finish'} · ${Math.round(nav.dist)} m ${ARROWS[Math.round(wrap(nav.rel) / (Math.PI / 4) + 8) % 8]}${nav.upwind ? ' · upwind, zig-zag' : ''}` : '';
    $('rgTack').classList.toggle('rg-pulse', !!nav?.tackNow && snap.st === 'race');
    $('rgSpd').textContent = m ? `${(m.v * 1.94).toFixed(1)} kn${m.gust ? ' 💨' : ''}${m.shadow ? ' 🌫' : ''}` : '';
    const warn = $('rgWarn'), w = m && !m.place && snap.st === 'race' ? (m.stun > 0 ? '💥 Hit! Sails knocked flat' : m.irons ? '⚠ In irons! Turn away from the wind' : m.shadow ? '🌫 In a rival\'s wind shadow' : '') : '';
    warn.hidden = !w; if (w && warn.textContent !== w) warn.textContent = w;
    const cnt = $('rgCount');
    if (S.phase === 'playing' && snap.st === 'countdown') { const c = Math.ceil(snap.go - el); const txt = c > 0 ? String(c) : 'GO!'; if (cnt.textContent !== txt) { cnt.textContent = txt; if (c > 0) ctx.sfx?.('tick'); } cnt.hidden = false; }
    else cnt.hidden = true;
    const fl = $('rgFlash');
    if (flash && now < flash.until) { if (fl.textContent !== flash.text) { fl.textContent = flash.text; fl.classList.remove('rg-in'); void fl.offsetWidth; fl.classList.add('rg-in'); } fl.hidden = false; } else fl.hidden = true;
    $('rgTack').disabled = !playing();
    const fb = $('rgFire'), guns = !!v.guns && me() != null;
    fb.hidden = !guns;
    if (guns && m) {
      const [, , MAX = 3] = v.cannon || [];
      const tgt = playing() ? aimOf(m, bs) : null, armed = !!tgt && m.ammo > 0;
      fb.disabled = !playing();
      fb.classList.toggle('rg-armed', armed);
      fb.style.setProperty('--rl', m.ammo >= MAX ? 1 : m.rl);
      const pips = '●'.repeat(m.ammo) + '○'.repeat(Math.max(0, MAX - m.ammo));
      const txt = `${pips}${armed ? ` → ${tgt.j < 0 ? '🏴‍☠️' : nameOf(tgt.j)}` : ''}`;
      if ($('rgAmmo').textContent !== txt) $('rgAmmo').textContent = txt;
    }
  }

  // where to go next, seen from your boat: distance, bearing relative to your bow, and whether a tack points closer
  const ARROWS = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
  function navOf(m) {
    const v = V(), M = v.course.marks;
    const [tx, ty] = m.mark < M.length ? M[m.mark] : [0, v.course.finish[0][1]];
    const bt = Math.atan2(ty - m.y, tx - m.x), from = snap.w[0], nogo = (v.nogo || 38) * Math.PI / 180;
    const upwind = Math.abs(wrap(bt - from)) < nogo + 0.08;
    const mirror = wrap(2 * (from + Math.PI) - m.h);
    const tackNow = upwind && Math.abs(wrap(m.h - from)) < nogo + 0.5 && Math.abs(wrap(bt - mirror)) + 0.15 < Math.abs(wrap(bt - m.h));
    return { dist: Math.hypot(tx - m.x, ty - m.y), bt, rel: bt - m.h, upwind, tackNow, tx, ty };
  }

  function loop(now) {
    if (!$('rgStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V() || !snap) return;
    const bs = boats(now);
    hud(now, bs);
    if (now - (loop.mapAt || 0) > 120) { loop.mapAt = now; miniMap(bs); }
    const m = me() != null ? bs[me()] : null;
    const on = S.phase === 'playing' && !S.paused;
    window.Snd?.bed('rg.water', waterBed).set(on && m ? clamp(m.v / 6, 0.15, 1) : on ? 0.3 : 0);
    window.Snd?.bed('rg.wind', windBed).set(on ? clamp(snap.w[1] / 8, 0.3, 1.2) : 0);
    if (auto && m && playing() && !drag && !steer && snap.st === 'race' && !m.irons && now - autoTackAt > 900) autopilot(m, now);
    else if (auto && m && playing() && snap.st === 'race' && m.irons) { goal = null; }
    if (!auto && goal != null && m && !drag && Math.abs(wrap(goal - m.h)) < 0.04 && now - goalShow > 800) goal = null;   // got there: hide the arrow (the boat holds the heading)
    // foam trails: a point off each stern every ~0.1 s, kept for 3.5 s
    for (const b of bs) {
      const tr = (trails[b.i] ||= []), sx = b.x - Math.cos(b.h) * 2.3, sy = b.y - Math.sin(b.h) * 2.3, last = tr[tr.length - 1];
      if (last && Math.hypot(last.x - sx, last.y - sy) > 10) tr.length = 0;
      if (!last || now - last.t > 100) tr.push({ x: sx, y: sy, t: now, v: b.v });
      while (tr.length && now - tr[0].t > 3500) tr.shift();
    }
    if (snap.np) { const tr = (trails.npc ||= []), np = snap.np, last = tr[tr.length - 1]; if (!last || now - last.t > 100) tr.push({ x: np[0] - Math.cos(np[2]) * 3.4, y: np[1] - Math.sin(np[2]) * 3.4, t: now, v: 3 }); while (tr.length && now - tr[0].t > 3500) tr.shift(); }
    for (const [id, f] of balls) if (now > f.t0 + f.T * 1000 + 50) balls.delete(id);
    const aim = m && V().guns && playing() ? aimOf(m, bs) : null;
    (gl || flat)?.draw(now, { bs, m, snap, V: V(), nav: m && !m.place && snap.st !== 'results' ? navOf(m) : null, goal, dragging: !!drag, aim, balls, fxq, trails });
  }

  // ---------- the water (#176): a sum of wind-driven waves, shared by the shader and the page (boats ride it).
  // Each wave: [angle off the downwind direction, wavelength m, height m]; the first DISP also move the mesh (High).
  const WAVES = [[0, 26, 0.3], [0.55, 17, 0.18], [-0.7, 9.5, 0.07], [1.3, 6, 0.04], [-0.25, 3.6, 0.02]];
  function waveSet(windTo, n) {
    return WAVES.slice(0, n).map(([off, L, A], k) => {
      const a = windTo + off, kk = 2 * Math.PI / L;
      // course y is world -z: a wave travelling along course angle a moves along world (cos a, -sin a)
      return { dx: Math.cos(a), dz: -Math.sin(a), k: kk, A, w: Math.sqrt(9.8 * kk), ph: k * 1.7 };
    });
  }
  // height and slope (world x, z) at a world point
  function waveAt(ws, x, z, t) {
    let h = 0, gx = 0, gz = 0;
    for (const w of ws) { const th = w.k * (w.dx * x + w.dz * z) - w.w * t + w.ph, c = Math.cos(th); h += w.A * Math.sin(th); gx += w.A * w.k * w.dx * c; gz += w.A * w.k * w.dz * c; }
    return { h, gx, gz };
  }
  function waterMaterial(T, o) {
    const NW = o.nw, DISP = o.disp;
    const u = {
      uT: { value: 0 }, uW: { value: [] }, uW2: { value: [] },
      uSun: { value: new T.Vector3(-0.35, 0.5, -0.79).normalize() }, uSunC: { value: new T.Color(0xfff1d6) },
      uSkyTop: { value: new T.Color(0x3a8ae0) }, uSkyHor: { value: new T.Color(0xcfe6fa) },
      uDeep: { value: new T.Color(0x082a4a) }, uShal: { value: new T.Color(0x16607a) },
      uFogC: { value: new T.Color(0xcfe6fa) }, uFog: { value: new T.Vector2(140, 520) },
      uGust: { value: Array.from({ length: 6 }, () => new T.Vector3()) },
    };
    for (let k = 0; k < NW; k++) { u.uW.value.push(new T.Vector4()); u.uW2.value.push(new T.Vector3()); }
    const wave = `uniform float uT; uniform vec4 uW[${NW}]; uniform vec3 uW2[${NW}];`;
    const mat = new T.ShaderMaterial({
      uniforms: u, defines: { NW, DISP },
      vertexShader: `${wave}
        varying vec3 vWorld; varying vec2 vXZ; varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 p = wp.xz; vec3 d = vec3(0.0);
          #if DISP > 0
          for (int i = 0; i < DISP; i++) {
            vec4 w = uW[i]; float th = w.z * dot(w.xy, p) - uW2[i].x * uT + uW2[i].z;
            d.xz += uW2[i].y * w.w * w.xy * cos(th); d.y += w.w * sin(th);
          }
          #endif
          vXZ = p; vH = d.y; wp.xyz += d; vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `${wave}
        uniform vec3 uSun, uSunC, uSkyTop, uSkyHor, uDeep, uShal, uFogC; uniform vec2 uFog; uniform vec3 uGust[6];
        varying vec3 vWorld; varying vec2 vXZ; varying float vH;
        void main() {
          vec2 p = vXZ, g = vec2(0.0); float h = 0.0;
          for (int i = 0; i < NW; i++) {
            vec4 w = uW[i]; float th = w.z * dot(w.xy, p) - uW2[i].x * uT + uW2[i].z;
            g += w.w * w.z * w.xy * cos(th); h += w.w * sin(th);
          }
          // gusts: cat's paws, darker water with a fine fast ripple
          float gu = 0.0;
          for (int i = 0; i < 6; i++) { vec3 G = uGust[i]; if (G.z > 0.0) gu = max(gu, 1.0 - smoothstep(G.z * 0.6, G.z, distance(p, G.xy))); }
          if (gu > 0.0) g += gu * 0.14 * vec2(cos(2.3 * p.x + 1.1 * p.y - 6.0 * uT), sin(2.7 * p.y - 0.8 * p.x - 7.0 * uT));
          vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(60.0, 380.0, dist) * 0.75));   // calm far off (no sparkle)
          float ndv = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
          float crest = clamp((h + vH) * 1.4 + 0.45, 0.0, 1.0);
          vec3 water = mix(uDeep, uShal, crest * 0.6) * (1.0 - 0.3 * gu);
          water *= 0.55 + 0.6 * max(dot(N, uSun), 0.0);
          vec3 col = mix(water, sky, F * 0.9);
          float rs = max(dot(R, uSun), 0.0);
          col += uSunC * (pow(rs, ${o.spec}.0) * 5.0 + pow(rs, 24.0) * 0.08);
          float foam = smoothstep(0.4, 0.56, h) * clamp(0.5 + 0.5 * sin(p.x * 2.3 + uT * 1.3) * sin(p.y * 1.9 - uT) + 0.3 * sin(p.x * 5.1 - p.y * 4.3), 0.0, 1.0);
          col = mix(col, vec3(0.86, 0.92, 0.95), foam * 0.4 * (1.0 - smoothstep(60.0, 220.0, dist)));
          col = mix(col, uFogC, smoothstep(uFog.x, uFog.y, dist));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    mat.setWaves = (ws) => ws.forEach((w, k) => { u.uW.value[k].set(w.dx, w.dz, w.k, w.A); u.uW2.value[k].set(w.w, k < DISP ? 0.35 / (w.k * w.A) / DISP : 0, w.ph); });
    return mat;
  }

  // ---------- three.js: course x is world x, course y is world -z (north is away from the start)
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(55, 1, 0.5, 900);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.0, hemi: [0xdff0ff, 0x1a3a5a, 0.7], env: true,
      key: { color: 0xfff2dc, i: 1.3, pos: [20, 40, 10], area: 40, near: 5, far: 120, map: 1024 },
      sky: { top: 0x3a8ae0, horizon: 0xcfe6fa, bottom: 0x2a5a8a, radius: 600, band: 0.06 },
    });
    const low = stg.low, guns = !!V().guns;
    scene3.fog = new T.Fog(0xcfe6fa, 140, 520);
    const W = (x, y, h = 0) => new T.Vector3(x, h, -y);
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
    // the lake: a wave mesh that follows the camera (snapped to its grid so the waves stay put); Low: flat, 3 waves, normals only
    const SIZE = 900, SEG = low ? 1 : 150, CELL = SIZE / SEG;
    const waterGeo = new T.PlaneGeometry(SIZE, SIZE, SEG, SEG); waterGeo.rotateX(-Math.PI / 2);
    const waterMat = waterMaterial(T, { nw: low ? 3 : 5, disp: low ? 0 : 2, spec: low ? 260 : 700 });
    const water = new T.Mesh(waterGeo, waterMat); water.frustumCulled = false; water.renderOrder = -0.5; scene3.add(water);
    let ws = null, wsRace = -1;
    const lift = low ? 0.07 : 0.62;     // flat guides float above the swell
    const sea = (x, y, t) => (ws ? waveAt(ws, x, -y, t) : { h: 0, gx: 0, gz: 0 });
    // shores far off: green hills round the lake
    const hillMat = std(0x4a7a3a, { roughness: 0.95 }), hillG = new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let k = 0; k < (low ? 14 : 26); k++) { const a = k / (low ? 14 : 26) * Math.PI * 2, d = 330 + (k % 3) * 40, m = new T.Mesh(hillG, hillMat); m.scale.set(60 + (k % 4) * 20, 20 + (k % 5) * 9, 50); m.position.set(Math.cos(a) * d, -2, -60 + Math.sin(a) * d); scene3.add(m); }
    // foam: a soft speckled texture for wakes, rings round buoys and splashes
    const foamTex = tex(128, 64, (g, w, h) => {
      for (let k = 0; k < 900; k++) {
        const u = Math.random(), v = Math.random(), edge = Math.pow(Math.abs(v - 0.5) * 2, 2), a = Math.pow(1 - u, 1.6) * (0.12 + 0.88 * edge);
        g.fillStyle = `rgba(255,255,255,${(a * (0.3 + Math.random() * 0.6)).toFixed(3)})`; g.beginPath(); g.arc(u * w, v * h, 0.6 + Math.random() * 1.4, 0, 7); g.fill();
      }
    });
    const ringTex = tex(64, 64, (g, w) => { for (let k = 0; k < 160; k++) { const a = Math.random() * 7, r = w / 2 * (0.62 + Math.random() * 0.34); g.fillStyle = `rgba(255,255,255,${(0.2 + Math.random() * 0.5).toFixed(2)})`; g.beginPath(); g.arc(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, 1 + Math.random() * 2, 0, 7); g.fill(); } });
    const puffTex = tex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    // buoys, the next one with a beacon; each sits in a ring of foam and rides the swell
    const buoyG = new T.Group(); scene3.add(buoyG);
    const orange = std(0xff7a1a, { roughness: 0.4 }), gold = std(0xffd23f, { roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.4 });
    const buoys = [];
    const beacon = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 30, 10, 1, true), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, depthWrite: false, blending: T.AdditiveBlending }));
    beacon.position.y = 15; scene3.add(beacon);
    const zone = new T.Mesh(new T.RingGeometry(V().markR - 0.4, V().markR, 48), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.4, depthWrite: false }));
    zone.rotation.x = -Math.PI / 2; zone.position.y = lift; scene3.add(zone);
    const label = (text) => { const t = tex(64, 64, (g, w) => { g.font = '800 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.strokeStyle = '#0008'; g.lineWidth = 6; g.strokeText(text, w / 2, w / 2); g.fillText(text, w / 2, w / 2); }); const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(3, 3, 1); return s; };
    const ringMat = new T.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0.8 });
    let builtCourse = '';
    const lineG = new T.Group(); scene3.add(lineG);
    function course(v) {
      const key = JSON.stringify(v.course); if (key === builtCourse) return; builtCourse = key;
      while (buoyG.children.length) buoyG.remove(buoyG.children[0]);
      while (lineG.children.length) lineG.remove(lineG.children[0]);
      buoys.length = 0;
      v.course.marks.forEach(([x, y], n) => {
        const g = new T.Group(); g.position.copy(W(x, y));
        const body = new T.Mesh(new T.CylinderGeometry(0.9, 1.1, 2.4, 16), orange); body.position.y = 0.9; body.castShadow = true; g.add(body);
        const top = new T.Mesh(new T.ConeGeometry(0.9, 1.2, 16), orange); top.position.y = 2.7; g.add(top);
        const lb = label(String(n + 1)); lb.position.y = 4.6; g.add(lb);
        const foam = new T.Mesh(new T.PlaneGeometry(4.4, 4.4), ringMat); foam.rotation.x = -Math.PI / 2; foam.position.y = 0.05; g.add(foam);
        buoyG.add(g); buoys.push({ g, body, top, foam, x, y });
      });
      // the finish line: two flag poles and a dotted line between them
      const [[x0, y0], [x1]] = v.course.finish;
      for (const x of [x0, x1]) {
        const pole = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 6, 6), std(0xeeeeee)); pole.position.copy(W(x, y0, 3)); lineG.add(pole);
        const flag = new T.Mesh(new T.PlaneGeometry(1.6, 1.0), new T.MeshBasicMaterial({ map: tex(64, 40, (g) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); } }), side: T.DoubleSide }));
        flag.position.copy(W(x + (x < 0 ? 0.8 : -0.8), y0, 5.4)); lineG.add(flag);
      }
      for (let x = x0 + 2; x < x1 - 1; x += 3) { const d = new T.Mesh(new T.SphereGeometry(0.25, 6, 4), std(0xffffff)); d.position.copy(W(x, y0, lift)); lineG.add(d); }
    }
    // boats: a hull with a pointed bow, a mast, a mainsail and a jib. 🏴‍☠️ Pirate sloops: a tarred wooden hull with a
    // stripe in the sailor's colour, canvas sails, a skull flag at the masthead and a gun port each side.
    const hullShape = new T.Shape(); hullShape.moveTo(-2.4, -0.9); hullShape.lineTo(1.2, -0.9); hullShape.quadraticCurveTo(2.6, -0.4, 2.9, 0); hullShape.quadraticCurveTo(2.6, 0.4, 1.2, 0.9); hullShape.lineTo(-2.4, 0.9); hullShape.closePath();
    const hullGeo = new T.ExtrudeGeometry(hullShape, { depth: 0.7, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    hullGeo.rotateX(Math.PI / 2); hullGeo.translate(0, 0.45, 0);
    const deckMat = std(guns ? 0xb08a5a : 0xf4f4f0, { roughness: guns ? 0.8 : 0.35 });
    const woodTex = guns ? tex(128, 32, (g, w, h) => { g.fillStyle = '#5a3a22'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.12})`; g.fillRect(0, y, w, 1); } for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,220,170,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 20, 1); } }) : null;
    const flagTex = (bg, fg) => tex(64, 40, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.beginPath(); g.arc(w / 2, h * 0.42, 8, 0, 7); g.fill(); g.fillRect(w / 2 - 5, h * 0.5, 10, 6); g.fillStyle = bg; g.fillRect(w / 2 - 4, h * 0.36, 3, 3); g.fillRect(w / 2 + 1, h * 0.36, 3, 3); g.strokeStyle = fg; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2 - 14, h * 0.7); g.lineTo(w / 2 + 14, h * 0.92); g.moveTo(w / 2 + 14, h * 0.7); g.lineTo(w / 2 - 14, h * 0.92); g.stroke(); });
    const skull = guns ? flagTex('#111', '#f4f0e6') : null, whiteFlag = guns ? tex(8, 8, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); }) : null;
    const gunMat = std(0x1a1a1a, { metalness: 0.6, roughness: 0.4 }), gunGeo = new T.CylinderGeometry(0.16, 0.2, 1.0, 8);
    // ⛵ a sail is a cambered triangle (tack, clew, head) cut in cloth panels: a belly that fills with wind, with a slightly
    // darker seam between panels. The belly is on +z; the boat flips it to the lee side as the sail swings (see the sails' scale.z)
    function sailGeo(foot, luff, back = 0, belly = 0.32) {
      const g = new T.BufferGeometry(), NU = 8, NV = 10, pos = [], col = [], idx = [];
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const v = j / NV, u = i / NU;
        const x = -(1 - v) * u * foot - v * back, y = v * luff;
        pos.push(x, y, belly * Math.sin(Math.PI * u) * (1 - v) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, v * 1.4))));
        const c = 0.9 + 0.1 * (j % 2) + 0.05 * Math.sin(Math.PI * u); col.push(c, c, c);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    const wakeGeo = (n) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 6), 3)); const uv = new Float32Array(n * 4), idx = []; for (let k = 0; k < n; k++) { uv.set([k / (n - 1), 0, k / (n - 1), 1], k * 4); if (k) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k); } g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(idx); return g; };
    const WAKE_N = low ? 14 : 24;
    const boatMs = [];
    function build(color, o = {}) {
      const g = new T.Group();
      const roll = new T.Group(); g.add(roll);
      const hull = new T.Mesh(hullGeo, guns ? std(0xffffff, { map: woodTex, roughness: 0.75, color: o.hull ?? 0xffffff }) : std(new T.Color(color), { roughness: 0.4 })); hull.castShadow = true; roll.add(hull);
      const deck = new T.Mesh(new T.BoxGeometry(3.6, 0.08, 1.5), deckMat); deck.position.set(-0.3, 0.6, 0); roll.add(deck);
      if (guns) {
        for (const z of [-1, 1]) {
          const stripe = new T.Mesh(new T.BoxGeometry(3.7, 0.16, 0.05), std(new T.Color(o.stripe ?? color), { roughness: 0.5 })); stripe.position.set(-0.4, 0.5, z * 1.03); roll.add(stripe);
          const gun = new T.Mesh(gunGeo, gunMat); gun.rotation.x = Math.PI / 2; gun.position.set(-0.3, 0.75, z * 0.95); roll.add(gun);
        }
      }
      const mast = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 7.5, 6), guns ? std(0x6b4a2a, { roughness: 0.8 }) : std(0xdddddd, { metalness: 0.5, roughness: 0.3 })); mast.position.set(0.6, 4.3, 0); roll.add(mast);
      const boomPivot = new T.Group(); boomPivot.position.set(0.6, 1.2, 0); roll.add(boomPivot);
      const boom = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 3.2, 5), guns ? std(0x6b4a2a) : std(0xbbbbbb)); boom.rotation.z = Math.PI / 2; boom.position.x = -1.6; boomPivot.add(boom);
      const sailC = o.sail != null ? new T.Color(o.sail) : guns ? new T.Color(0xf0e2c0).lerp(new T.Color(color), 0.28) : new T.Color(color).lerp(new T.Color(0xffffff), 0.35);
      const main = new T.Mesh(sailGeo(3.1, 6.6, 0.15), new T.MeshStandardMaterial({ color: sailC, roughness: 0.85, side: T.DoubleSide, vertexColors: true })); main.castShadow = !low; boomPivot.add(main);
      const jibPivot = new T.Group(); jibPivot.position.set(2.5, 0.8, 0); roll.add(jibPivot);
      const jib = new T.Mesh(sailGeo(1.9, 5.6, 1.9), new T.MeshStandardMaterial({ color: o.sail != null ? sailC : guns ? 0xf0e4c8 : 0xf8f8f8, roughness: 0.85, side: T.DoubleSide, vertexColors: true })); jibPivot.add(jib);
      let flag = null;
      if (guns) { flag = new T.Mesh(new T.PlaneGeometry(1.3, 0.8), new T.MeshBasicMaterial({ map: o.flag ?? skull, side: T.DoubleSide })); flag.position.set(-0.05, 7.6, 0); roll.add(flag); }
      const wake = new T.Mesh(wakeGeo(WAKE_N), new T.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.8 })); wake.frustumCulled = false; scene3.add(wake);
      scene3.add(g);
      return { g, roll, boomPivot, jibPivot, wake, flag, main, jib };
    }
    function boatFor(i, color) {
      if (boatMs[i]) return boatMs[i];
      const b = build(color);
      const tag = label('▼'); tag.scale.set(2.2, 2.2, 1); tag.position.y = 9.6; tag.material.color.set(color); b.g.add(tag); b.tag = tag;
      return (boatMs[i] = b);
    }
    // a wake: the stern's trail as a foam ribbon that spreads and fades
    function wake(m, tr, b, now, t) {
      const pos = m.wake.geometry.attributes.position, A = pos.array, n = WAKE_N;
      const pts = [{ x: b.x - Math.cos(b.h) * 2.3, y: b.y - Math.sin(b.h) * 2.3, t: now }];
      for (let k = (tr?.length || 0) - 1; k >= 0 && pts.length < n; k--) pts.push(tr[k]);
      while (pts.length < n) pts.push(pts[pts.length - 1]);
      for (let k = 0; k < n; k++) {
        const p = pts[k], q = pts[Math.min(n - 1, k + 1)], r = pts[Math.max(0, k - 1)];
        let dx = r.x - q.x, dy = r.y - q.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const age = clamp((now - p.t) / 3500, 0, 1), half = 0.7 + age * 4.2, y = low ? 0.06 : sea(p.x, p.y, t).h + 0.14;
        A.set([p.x - dy * half, y, -(p.y + dx * half), p.x + dy * half, y, -(p.y - dx * half)], k * 6);
      }
      pos.needsUpdate = true;
      m.wake.material.opacity = clamp(b.v / 7, 0, 0.7);
    }

    // 🏴‍☠️ Black Jack: a bigger black ship with black sails; it flies the white flag while silenced
    let npc = null;
    if (guns) {
      npc = build('#000', { hull: 0x3a3a3a, stripe: 0xb01818, sail: 0x222428, flag: flagTex('#b01818', '#111') });
      npc.g.scale.setScalar(1.45);
      const nl = label('🏴‍☠️'); nl.scale.set(3.4, 3.4, 1); nl.position.y = 10; npc.g.add(nl);
      npc.reach = new T.Mesh(new T.RingGeometry((V().cannon?.[6] || 28) - 0.6, V().cannon?.[6] || 28, 72), new T.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, fog: false }));
      npc.reach.rotation.x = -Math.PI / 2; scene3.add(npc.reach);
      npc.redFlag = npc.flag.material.map;
    }
    // powder kegs: a barrel on its side in a gold ring
    const kegMs = [], kegMat = std(0x8a5a2a, { roughness: 0.7 }), bandMat = std(0x333333, { metalness: 0.6 });
    const kegRing = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    function kegFor(k) {
      if (kegMs[k]) return kegMs[k];
      const g = new T.Group(), b = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 1.2, 12), kegMat); b.rotation.z = Math.PI / 2; b.position.y = 0.35; b.castShadow = !low; g.add(b);
      for (const x of [-0.4, 0.4]) { const r = new T.Mesh(new T.TorusGeometry(0.56, 0.05, 4, 14), bandMat); r.rotation.y = Math.PI / 2; r.position.set(x, 0.35, 0); g.add(r); }
      const ring = new T.Mesh(new T.RingGeometry(1.5, 1.8, 28), kegRing); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; g.add(ring);
      scene3.add(g); return (kegMs[k] = g);
    }
    // cannonballs
    const ballGeo = new T.SphereGeometry(0.32, 10, 8), ballMat = std(0x111111, { metalness: 0.7, roughness: 0.35 }), ballMs = new Map();
    // effects: a pool of sprites (smoke, flashes, spray), splinters and foam rings, each with its own life
    const parts = [], MAXP = low ? 24 : 60;
    const sprite = (color, add) => { const s = new T.Sprite(new T.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false, blending: add ? T.AdditiveBlending : T.NormalBlending })); s.visible = false; scene3.add(s); return s; };
    const splGeo = new T.BoxGeometry(0.5, 0.12, 0.12), splMat = std(0x6b4423);
    function part(kind, p, o) {
      if (parts.length >= MAXP) { const old = parts.shift(); scene3.remove(old.o); if (old.kind !== 'splinter') old.o.material.dispose(); if (old.kind === 'ring') old.o.geometry.dispose(); }
      const obj = kind === 'splinter' ? new T.Mesh(splGeo, splMat) : kind === 'ring' ? new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false })) : sprite(o.color ?? 0xffffff, o.add);
      if (kind === 'ring') obj.rotation.x = -Math.PI / 2;
      obj.position.copy(p); obj.visible = true; scene3.add(obj);
      parts.push({ o: obj, kind, t0: performance.now(), life: o.life ?? 1, v: o.v ?? new T.Vector3(), s0: o.s0 ?? 1, s1: o.s1 ?? 2, a0: o.a0 ?? 1, grav: o.grav ?? 0, spin: o.spin ?? 0 });
    }
    let fxDone = 0;
    function spawnFx(e, bs, now) {
      const t = now / 1000, base = (low ? 0 : sea(e.x, e.y, t).h);
      const at = (dx = 0, dy = 0, h = 0) => W(e.x + dx, e.y + dy, base + h);
      const R = () => Math.random() - 0.5;
      if (e.kind === 'fire') {
        const h = e.src >= 0 ? bs[e.src]?.h ?? 0 : snap.np?.[2] ?? 0, a = h + (e.side || 1) * Math.PI / 2, ox = Math.cos(a), oy = Math.sin(a);
        part('flash', at(ox * 1.2, oy * 1.2, 1.1), { color: 0xffb040, add: true, life: 0.18, s0: 2.6, s1: 4, a0: 1 });
        for (let k = 0; k < (low ? 3 : 7); k++) part('smoke', at(ox * (1.6 + k * 0.5), oy * (1.6 + k * 0.5), 1.2), { color: 0xa8a8a8, life: 1.6 + Math.random(), s0: 1.2, s1: 3.6 + Math.random() * 1.6, a0: 0.55, v: new T.Vector3(ox * 2.2 + R(), 0.7 + Math.random() * 0.5, -oy * 2.2 + R()) });
      } else if (e.kind === 'splash') {
        for (let k = 0; k < (low ? 4 : 9); k++) part('spray', at(R(), R(), 0.3), { color: 0xffffff, life: 0.9 + Math.random() * 0.4, s0: 0.8, s1: 2.2, a0: 0.9, v: new T.Vector3(R() * 3, 5 + Math.random() * 4, R() * 3), grav: 12 });
        part('ring', at(0, 0, 0.08), { life: 1.4, s0: 1.5, s1: 7, a0: 0.9 });
      } else if (e.kind === 'hit') {
        part('flash', at(0, 0, 1.4), { color: 0xff8a30, add: true, life: 0.25, s0: 3.2, s1: 5 });
        for (let k = 0; k < (low ? 5 : 12); k++) part('splinter', at(R(), R(), 1.2), { life: 1.2, v: new T.Vector3(R() * 7, 4 + Math.random() * 4, R() * 7), grav: 12, spin: 10 });
        for (let k = 0; k < (low ? 2 : 5); k++) part('smoke', at(R() * 2, R() * 2, 1.5), { color: 0x555555, life: 2.2, s0: 1.5, s1: 5, a0: 0.7, v: new T.Vector3(R(), 1.2, R()) });
        part('ring', at(0, 0, 0.08), { life: 1.2, s0: 2, s1: 8, a0: 0.8 });
      }
    }
    function tickParts(now, dt) {
      for (let k = parts.length - 1; k >= 0; k--) {
        const p = parts[k], u = (now - p.t0) / 1000 / p.life;
        if (u >= 1) { scene3.remove(p.o); if (p.kind !== 'splinter') p.o.material.dispose(); if (p.kind === 'ring') p.o.geometry.dispose(); parts.splice(k, 1); continue; }
        p.v.y -= p.grav * dt; p.o.position.addScaledVector(p.v, dt);
        if (p.kind === 'splinter') { p.o.rotation.x += p.spin * dt; p.o.rotation.z += p.spin * 0.7 * dt; if (p.o.position.y < 0) { p.v.set(p.v.x * 0.3, 0, p.v.z * 0.3); p.grav = 0; } continue; }
        const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - u) * (1 - u));
        p.o.scale.set(s, s, s);
        if (p.kind === 'smoke') p.v.multiplyScalar(1 - 1.5 * dt);
        p.o.material.opacity = p.a0 * (p.kind === 'flash' ? 1 - u : 1 - u * u);
      }
    }

    // #150 guides round your own boat: the no-go wedge (red, into the wind) with a wind chevron, a gold arrow to the
    // next buoy and a white arrow for the heading you pointed at. All lie flat over the water; course angle = rotation.y.
    const flatMesh = (geo, mat) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; return m; };
    const arrowGeo = (len, wid, head) => { const sh = new T.Shape(); sh.moveTo(0, -wid / 2); sh.lineTo(len - head, -wid / 2); sh.lineTo(len - head, -wid * 1.6); sh.lineTo(len, 0); sh.lineTo(len - head, wid * 1.6); sh.lineTo(len - head, wid / 2); sh.lineTo(0, wid / 2); sh.closePath(); return new T.ShapeGeometry(sh); };
    const NOGO = (V().nogo || 38) * Math.PI / 180;
    const wedge = new T.Group(); scene3.add(wedge);
    const wedgeMat = new T.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, fog: false });
    wedge.add(flatMesh(new T.CircleGeometry(13, 24, -NOGO, 2 * NOGO), wedgeMat));
    const windMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, fog: false });
    for (const r of [8.5, 11.5]) { const ch = flatMesh(arrowGeo(2.2, 0.35, 1.0), windMat); ch.position.x = r; ch.rotation.z = Math.PI; wedge.add(ch); }   // chevrons blowing toward you
    const toMark = new T.Group(); scene3.add(toMark);
    const markArrowMat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false });
    const markArrow = flatMesh(arrowGeo(4.2, 0.7, 1.7), markArrowMat); markArrow.position.set(4.5, 0, 0); toMark.add(markArrow);
    markArrow.renderOrder = 3;
    const aim = new T.Group(); scene3.add(aim);
    const aimMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false });
    const aimArrow = flatMesh(arrowGeo(9.5, 0.3, 1.6), aimMat); aimArrow.position.x = 3.2; aimArrow.renderOrder = 4; aim.add(aimArrow);
    // 🏴‍☠️ the broadside arcs (where your guns reach, either side) and a red ring on the boat they'd hit
    const [RANGE = 32, ARCd = 50] = V().cannon || [];
    const arcs = new T.Group(); scene3.add(arcs);
    const arcMats = [-1, 1].map((side) => { const mt = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, toneMapped: false, fog: false }); arcs.add(flatMesh(new T.RingGeometry(4, RANGE, 28, 1, side * Math.PI / 2 - ARCd * Math.PI / 180, 2 * ARCd * Math.PI / 180), mt)); return mt; });
    const reticle = new T.Group(); scene3.add(reticle);
    const retMat = new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false, side: T.DoubleSide });
    reticle.add(flatMesh(new T.RingGeometry(3.2, 3.8, 32), retMat));
    for (let k = 0; k < 4; k++) { const tick = flatMesh(new T.PlaneGeometry(1.6, 0.45), retMat); const a = k * Math.PI / 2; tick.position.set(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6); tick.rotation.z = a; reticle.add(tick); }
    arcs.visible = reticle.visible = false;

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0;
    const cam = { yaw: Math.PI / 2, pos: new T.Vector3(0, 40, 60), look: new T.Vector3(), init: false };
    const gustV = waterMat.uniforms.uGust.value;

    function draw(now, sc) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const t = now / 1000, v = sc.V; course(v);
      const wdir = sc.snap.w[0], to = wdir + Math.PI;
      // the sea keeps the wind direction it had when the race began (turning it with every shift would swirl it)
      if (!ws || wsRace !== sc.snap.race) { ws = waveSet(to, low ? 3 : 5); wsRace = sc.snap.race; waterMat.setWaves(ws); }
      waterMat.uniforms.uT.value = t;
      for (let k = 0; k < 6; k++) { const gg = sc.snap.g[k]; if (gg) gustV[k].set(gg[0], -gg[1], gg[2]); else gustV[k].set(0, 0, 0); }
      const myMark = sc.m ? sc.m.mark : 0;
      buoys.forEach((b, n) => {
        const next = n === myMark; b.body.material = next ? gold : orange; b.top.material = next ? gold : orange;
        const s = sea(b.x, b.y, t); b.g.position.y = s.h * 0.9; b.g.rotation.x = -s.gz * 0.6; b.g.rotation.z = s.gx * 0.6;
        b.foam.rotation.z = t * 0.2; b.foam.material.opacity = 0.6 + 0.2 * Math.sin(t * 2 + n);
      });
      const nm = v.course.marks[myMark];
      beacon.visible = zone.visible = !!nm && !!sc.m && !sc.m.place;
      if (nm) { beacon.position.copy(W(nm[0], nm[1], 15)); zone.position.copy(W(nm[0], nm[1], lift)); beacon.material.opacity = 0.18 + 0.1 * Math.sin(now / 300); }
      for (const b of sc.bs) {
        const m = boatFor(b.i, b.color);
        const s = sea(b.x, b.y, t);
        m.g.position.copy(W(b.x, b.y, s.h * 0.85)); m.g.rotation.y = b.h;
        const off = wrap(b.h - wdir), twa = Math.abs(off);
        // the sails swing out to the side away from the wind, further the more the wind is behind; torn sails luff
        const ang = clamp(twa / 2, 0.12, 1.4) * (off > 0 ? -1 : 1);
        const flap = b.irons || b.stun > 0 ? Math.sin(now / 60 + b.i) * 0.35 : 0;
        m.boomPivot.rotation.y = ang + flap; m.jibPivot.rotation.y = ang * 0.8 + flap;
        const bz = ang >= 0 ? 1 : -1, fl = b.irons || b.stun > 0 ? 0.25 : 1;   // the belly fills on the lee side; a luffing sail goes slack
        m.main.scale.z = bz * fl; m.jib.scale.z = bz * fl;
        // heel: lean away from the wind, most on a close reach at speed; and ride the swell (slope along / across the hull)
        const ch = Math.cos(b.h), sh = Math.sin(b.h), along = s.gx * ch - s.gz * sh, across = s.gx * sh + s.gz * ch;
        m.roll.rotation.x = -(off > 0 ? 1 : -1) * clamp(b.v / 7, 0, 1) * Math.sin(Math.min(twa, 2.4)) * 0.28 - across * 0.8 + Math.sin(now / 700 + b.i) * 0.02;
        m.roll.rotation.z = along * 0.8 + (b.stun > 0 ? Math.sin(now / 90) * 0.06 : 0);
        m.roll.position.y = 0;
        if (m.flag) m.flag.rotation.y = -ang * 0.5 + Math.sin(now / 140 + b.i) * 0.25;
        wake(m, sc.trails[b.i], b, now, t);
        m.tag.visible = b.i !== me();
        m.g.visible = m.wake.visible = b.on;
      }
      // 🏴‍☠️ Black Jack, kegs, balls and the effects
      if (npc) {
        const np = sc.snap.np; npc.g.visible = npc.wake.visible = !!np; npc.reach.visible = false;
        if (np) {
          const s = sea(np[0], np[1], t), quiet = np[3] > 0;
          npc.g.position.copy(W(np[0], np[1], s.h * 0.8)); npc.g.rotation.y = np[2];
          npc.boomPivot.rotation.y = 0.9 + (quiet ? Math.sin(now / 70) * 0.35 : 0); npc.jibPivot.rotation.y = 0.7;
          npc.roll.rotation.x = -s.gz * 0.5 + 0.06; npc.roll.rotation.z = s.gx * 0.5;
          npc.flag.material.map = quiet ? whiteFlag : npc.redFlag; npc.flag.rotation.y = Math.sin(now / 160) * 0.3;
          wake(npc, sc.trails.npc, { x: np[0], y: np[1], h: np[2], v: 3 }, now, t);
          if (sc.m && !quiet) { const d = Math.hypot(sc.m.x - np[0], sc.m.y - np[1]); npc.reach.visible = d < (v.cannon?.[6] || 28) + 30; npc.reach.position.copy(W(np[0], np[1], lift)); npc.reach.material.opacity = 0.14 + 0.08 * Math.sin(now / 250); }
          if (quiet && Math.random() < dt * 3) part('smoke', W(np[0], np[1], 3), { color: 0x444444, life: 2, s0: 1.5, s1: 5, a0: 0.5, v: new T.Vector3(0, 1.4, 0) });
        }
      }
      sc.snap.kg.forEach(([x, y, on], k) => { const g = kegFor(k); g.visible = !!on; if (on) { const s = sea(x, y, t); g.position.copy(W(x, y, s.h)); g.rotation.y = t * 0.3 + k; g.rotation.x = Math.sin(t * 1.3 + k) * 0.15; } });
      for (const [id, f] of sc.balls) {
        let o = ballMs.get(id); if (!o) { o = new T.Mesh(ballGeo, ballMat); o.castShadow = !low; scene3.add(o); ballMs.set(id, o); }
        const u = clamp((now - f.t0) / (f.T * 1000), 0, 1), apex = 1.6 + 3 * f.T;
        o.position.copy(W(f.x0 + (f.x1 - f.x0) * u, f.y0 + (f.y1 - f.y0) * u, 1.3 * (1 - u) + apex * 4 * u * (1 - u)));
      }
      for (const [id, o] of ballMs) if (!sc.balls.has(id)) { scene3.remove(o); ballMs.delete(id); }
      for (const e of sc.fxq) if (e.id > fxDone) { fxDone = e.id; if (now - e.t0 < 800) spawnFx(e, sc.bs, now); }
      tickParts(now, dt);
      const mine = sc.m && !sc.m.place && sc.snap.st !== 'results';
      wedge.visible = toMark.visible = !!mine;
      aim.visible = !!mine && sc.goal != null;
      arcs.visible = !!mine && guns && sc.snap.st === 'race';
      reticle.visible = !!sc.aim;
      if (mine) {
        const pos = W(sc.m.x, sc.m.y);
        wedge.position.set(pos.x, lift, pos.z); wedge.rotation.y = wdir;
        const twa = Math.abs(wrap(sc.m.h - wdir));
        const near = sc.m.irons ? 1 : clamp((NOGO + 0.2 - twa) / 0.2, 0, 1);
        wedgeMat.color.setHex(sc.m.irons ? 0xff2a2a : near > 0 ? 0xffa030 : 0xff3a3a);
        wedgeMat.opacity = 0.28 + 0.2 * near * (0.6 + 0.4 * Math.sin(now / 120));
        windMat.opacity = 0.6 + 0.25 * Math.sin(now / 400);
        if (sc.nav) { toMark.position.set(pos.x, lift + 0.03, pos.z); toMark.rotation.y = sc.nav.bt; markArrowMat.opacity = 0.8 + 0.2 * Math.sin(now / 250); }
        toMark.visible = !!sc.nav;
        if (sc.goal != null) { aim.position.set(pos.x, lift + 0.05, pos.z); aim.rotation.y = sc.goal; }
        if (arcs.visible) {
          arcs.position.set(pos.x, lift - 0.02, pos.z); arcs.rotation.y = sc.m.h;
          const ready = sc.m.ammo > 0;
          arcMats.forEach((mt, k) => { const hot = sc.aim && sc.aim.side === (k ? 1 : -1); mt.color.setHex(hot && ready ? 0xffa020 : 0xffffff); mt.opacity = hot ? (ready ? 0.16 + 0.05 * Math.sin(now / 150) : 0.09) : ready ? 0.06 : 0.03; });
        }
      }
      if (sc.aim) {
        reticle.position.copy(W(sc.aim.x, sc.aim.y, lift + 0.08)); reticle.rotation.y = now / 600;
        retMat.color.setHex(sc.m?.ammo > 0 ? 0xff3030 : 0xaaaaaa); retMat.opacity = 0.7 + 0.25 * Math.sin(now / 120);
      }
      // the camera: behind your boat (a little to windward), turning with it; a high view for watchers
      const focus = sc.m ?? sc.bs[0];
      if (focus) {
        const k = cam.init ? 1 - Math.exp(-dt * (sc.dragging ? 0.9 : 1.8)) : 1;
        cam.yaw += wrap(focus.h - cam.yaw) * k;
        const back = 24, up = 12, f = W(focus.x, focus.y);
        const want = f.clone().add(new T.Vector3(-Math.cos(cam.yaw) * back, up, Math.sin(cam.yaw) * back));
        const look = f.clone().add(new T.Vector3(Math.cos(cam.yaw) * 14, 0, -Math.sin(cam.yaw) * 14));
        cam.pos.lerp(want, cam.init ? 1 - Math.exp(-dt * 4) : 1); cam.look.lerp(look, cam.init ? 1 - Math.exp(-dt * 4) : 1); cam.init = true;
      }
      const fov = camera.aspect < 0.8 ? 68 : 55;
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      camera.position.copy(cam.pos);
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      if (low) water.position.set(camera.position.x, 0, camera.position.z); else water.position.set(Math.round(camera.position.x / CELL) * CELL, 0, Math.round(camera.position.z / CELL) * CELL);
      stg.follow(camera);
      renderer.render(scene3, camera);
    }
    return {
      draw, resize, camera,
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the whole course from above, north up, on drifting ripples
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the lake.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, pat = null, pat2 = null;
    // a tile of little wave crests (and a finer, fainter one) that drift downwind at different speeds
    const tile = (n, a, lw) => { const c = document.createElement('canvas'); c.width = c.height = 160; const t = c.getContext('2d'); if (!t) return null; for (let k = 0; k < n; k++) { const x = Math.random() * 160, y = Math.random() * 160, l = 8 + Math.random() * 18; t.strokeStyle = `rgba(255,255,255,${(a * (0.4 + Math.random() * 0.6)).toFixed(3)})`; t.lineWidth = lw; t.beginPath(); for (const dx of [0, -160, 160]) for (const dy of [0, -160, 160]) { t.moveTo(x + dx, y + dy); t.quadraticCurveTo(x + dx + l / 2, y + dy - 3, x + dx + l, y + dy); } t.stroke(); } return g.createPattern(c, 'repeat'); };
    pat = tile(70, 0.32, 1.5); pat2 = tile(110, 0.16, 1);
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ship = (x, y, hd, s, hull, sail, flag, sailAng) => {
      g.save(); g.translate(x, y); g.rotate(-hd);
      g.fillStyle = hull; g.beginPath(); g.moveTo(s, 0); g.quadraticCurveTo(s * 0.4, s * 0.5, -s * 0.8, s * 0.42); g.lineTo(-s * 0.8, -s * 0.42); g.quadraticCurveTo(s * 0.4, -s * 0.5, s, 0); g.fill();
      g.strokeStyle = '#0006'; g.lineWidth = 1; g.stroke();
      g.strokeStyle = sail; g.lineWidth = Math.max(2, s * 0.22); g.lineCap = 'round'; g.beginPath(); g.moveTo(s * 0.2, 0); g.lineTo(s * 0.2 - Math.cos(sailAng) * s, Math.sin(sailAng) * s); g.stroke();
      if (flag) { g.fillStyle = flag; g.fillRect(s * 0.1, -s * 0.12, s * 0.28, s * 0.24); }
      g.restore();
    };
    function draw(now, sc) {
      const v = sc.V, M = v.course.marks, t = now / 1000;
      const xs = [...M.map((m) => m[0]), -35, 35], ys = [...M.map((m) => m[1]), -24];
      const x0 = Math.min(...xs) - 15, x1 = Math.max(...xs) + 15, y0 = Math.min(...ys) - 10, y1 = Math.max(...ys) + 15;
      const k = Math.min(w / (x1 - x0), (h - 70) / (y1 - y0)), ox = (w - (x1 - x0) * k) / 2, oy = 62;
      const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y1 - y) * k;
      // the water: deep blue, lighter toward the bottom, ripples drifting downwind, a sun glint in the north-west
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1d5a8e'); bg.addColorStop(1, '#2f7fb0'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const to = sc.snap.w[0] + Math.PI, dx = Math.cos(to), dy = -Math.sin(to);
      for (const [p, sp, a] of [[pat2, 3, 1], [pat, 7, 1]]) {
        if (!p) continue;
        const sx = ((dx * t * sp * k * 0.4) % 160 + 160) % 160, sy = ((dy * t * sp * k * 0.4) % 160 + 160) % 160;
        g.save(); g.globalAlpha = a; g.translate(sx - 160, sy - 160); g.fillStyle = p; g.fillRect(0, 0, w + 320, h + 320); g.restore();
      }
      const glint = g.createRadialGradient(w * 0.25, h * 0.15, 0, w * 0.25, h * 0.15, Math.max(w, h) * 0.45); glint.addColorStop(0, 'rgba(255,248,220,.22)'); glint.addColorStop(1, 'rgba(255,248,220,0)'); g.fillStyle = glint; g.fillRect(0, 0, w, h);
      for (const [gx, gy, gr] of sc.snap.g) { g.beginPath(); g.arc(X(gx), Y(gy), gr * k, 0, 7); g.fillStyle = '#0a2a5044'; g.fill(); }
      // foam wakes
      g.lineCap = 'round';
      for (const b of sc.bs) {
        const tr = sc.trails[b.i]; if (!tr || tr.length < 2 || !b.on) continue;
        for (let n = 1; n < tr.length; n++) { const a = 1 - (now - tr[n].t) / 3500; if (a <= 0) continue; g.strokeStyle = `rgba(255,255,255,${(a * 0.55 * clamp(tr[n].v / 5, 0.2, 1)).toFixed(3)})`; g.lineWidth = Math.max(1.5, (1 + (1 - a) * 3) * k * 0.9); g.beginPath(); g.moveTo(X(tr[n - 1].x), Y(tr[n - 1].y)); g.lineTo(X(tr[n].x), Y(tr[n].y)); g.stroke(); }
      }
      const my = sc.m ? sc.m.mark : 0;
      M.forEach(([x, y], n) => { g.beginPath(); g.arc(X(x), Y(y), Math.max(7, 2.2 * k) + Math.sin(t * 2 + n), 0, 7); g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 2; g.stroke(); if (n === my) { g.beginPath(); g.arc(X(x), Y(y), v.markR * k, 0, 7); g.strokeStyle = '#ffd23f88'; g.lineWidth = 2; g.stroke(); } g.beginPath(); g.arc(X(x), Y(y), Math.max(4, 1.2 * k), 0, 7); g.fillStyle = n === my ? '#ffd23f' : '#ff7a1a'; g.fill(); g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(String(n + 1), X(x) + 7, Y(y) + 4); });
      const [[fx0, fy], [fx1]] = v.course.finish; g.setLineDash([4, 4]); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(fx0), Y(fy)); g.lineTo(X(fx1), Y(fy)); g.stroke(); g.setLineDash([]);
      for (const [x, y, on] of sc.snap.kg) if (on) { const s = Math.max(5, 1.3 * k); g.beginPath(); g.arc(X(x), Y(y), s * 1.6, 0, 7); g.strokeStyle = '#ffd23f99'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#8a5a2a'; g.fillRect(X(x) - s, Y(y) - s * 0.6, s * 2, s * 1.2); g.fillStyle = '#333'; g.fillRect(X(x) - s * 0.5, Y(y) - s * 0.6, 2, s * 1.2); g.fillRect(X(x) + s * 0.5 - 2, Y(y) - s * 0.6, 2, s * 1.2); }
      const [RANGE = 32, ARCd = 50, , , , , NPCR = 28] = v.cannon || [];
      if (sc.m && !sc.m.place && sc.snap.st !== 'results') {
        const bx = X(sc.m.x), by = Y(sc.m.y), from = sc.snap.w[0], ng = (v.nogo || 38) * Math.PI / 180, R = Math.max(30, 11 * k);
        g.fillStyle = sc.m.irons ? '#ff2a2a55' : '#ff3a3a33'; g.beginPath(); g.moveTo(bx, by); g.arc(bx, by, R, -from - ng, -from + ng); g.closePath(); g.fill();
        if (v.guns && sc.snap.st === 'race') for (const side of [-1, 1]) {
          const c = -(sc.m.h + side * Math.PI / 2), A = ARCd * Math.PI / 180, hot = sc.aim?.side === side && sc.m.ammo > 0;
          g.fillStyle = hot ? 'rgba(255,160,40,.24)' : 'rgba(255,255,255,.07)'; g.beginPath(); g.arc(bx, by, RANGE * k, c - A, c + A); g.arc(bx, by, 4 * k, c + A, c - A, true); g.closePath(); g.fill();
        }
        if (sc.nav) { g.strokeStyle = '#ffd23fcc'; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(bx, by); g.lineTo(X(sc.nav.tx), Y(sc.nav.ty)); g.stroke(); g.setLineDash([]); }
        if (sc.goal != null) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(sc.goal) * R * 1.1, by - Math.sin(sc.goal) * R * 1.1); g.stroke(); }
      }
      const np = sc.snap.np;
      if (np) {
        const quiet = np[3] > 0;
        if (!quiet) { g.beginPath(); g.arc(X(np[0]), Y(np[1]), NPCR * k, 0, 7); g.strokeStyle = 'rgba(255,60,60,.35)'; g.setLineDash([5, 6]); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); }
        ship(X(np[0]), Y(np[1]), np[2], Math.max(9, 4.6 * k), '#2a2a2a', quiet ? '#ddd' : '#111', quiet ? '#fff' : '#b01818', 0.9);
        g.font = `${Math.round(Math.max(12, 3 * k))}px system-ui`; g.textAlign = 'center'; g.fillText('🏴‍☠️', X(np[0]), Y(np[1]) - Math.max(10, 4 * k)); g.textAlign = 'start';
      }
      for (const b of sc.bs) {
        if (!b.on) continue;
        const s = Math.max(7, 3.2 * k), off = wrap(b.h - sc.snap.w[0]), ang = clamp(Math.abs(off) / 2, 0.12, 1.4) * (off > 0 ? -1 : 1) + (b.stun > 0 ? Math.sin(now / 60) * 0.4 : 0);
        ship(X(b.x), Y(b.y), b.h, s, v.guns ? '#6b4423' : b.color, v.guns ? b.color : '#fff', v.guns ? '#111' : null, ang);
        if (v.guns) { g.save(); g.translate(X(b.x), Y(b.y)); g.rotate(-b.h); g.strokeStyle = b.color; g.lineWidth = 2; g.beginPath(); g.moveTo(-s * 0.7, s * 0.38); g.lineTo(s * 0.4, s * 0.38); g.moveTo(-s * 0.7, -s * 0.38); g.lineTo(s * 0.4, -s * 0.38); g.stroke(); g.restore(); }
        if (b.i === me()) { g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(b.x), Y(b.y), s * 1.35, 0, 7); g.stroke(); }
      }
      if (sc.aim) { const r = Math.max(9, 3.6 * k), rx = X(sc.aim.x), ry = Y(sc.aim.y); g.strokeStyle = sc.m?.ammo > 0 ? '#ff3030' : '#aaa'; g.lineWidth = 2.5; g.beginPath(); g.arc(rx, ry, r, 0, 7); g.stroke(); for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + t; g.beginPath(); g.moveTo(rx + Math.cos(a) * r, ry + Math.sin(a) * r); g.lineTo(rx + Math.cos(a) * (r + 6), ry + Math.sin(a) * (r + 6)); g.stroke(); } }
      // balls (a shadow on the water and the ball above it) and the effects
      for (const f of sc.balls.values()) {
        const u = clamp((now - f.t0) / (f.T * 1000), 0, 1), x = X(f.x0 + (f.x1 - f.x0) * u), y = Y(f.y0 + (f.y1 - f.y0) * u), up = (1.6 + 3 * f.T) * 4 * u * (1 - u);
        g.fillStyle = '#0005'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.arc(x, y - up * k * 0.6, 3 + up * 0.25, 0, 7); g.fill();
      }
      for (const e of sc.fxq) {
        const u = (now - e.t0) / (e.kind === 'fire' ? 1400 : 1100); if (u < 0 || u > 1) continue;
        const x = X(e.x), y = Y(e.y);
        if (e.kind === 'fire') { g.fillStyle = `rgba(220,220,220,${(0.7 * (1 - u)).toFixed(3)})`; for (let q = 0; q < 3; q++) { g.beginPath(); g.arc(x + (q - 1) * 3, y - q * 2 - u * 8, 3 + u * 9, 0, 7); g.fill(); } if (u < 0.12) { g.fillStyle = '#ffb040'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } }
        else { g.strokeStyle = e.kind === 'hit' ? `rgba(255,140,60,${(1 - u).toFixed(3)})` : `rgba(255,255,255,${(1 - u).toFixed(3)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 3 + u * 6 * k, 0, 7); g.stroke(); if (u < 0.4) { g.fillStyle = e.kind === 'hit' ? '#ffb04099' : '#ffffffaa'; g.beginPath(); g.arc(x, y, 4 + u * 10, 0, 7); g.fill(); } }
      }
    }
    return { draw, resize, dispose() { canvas.remove(); } };
  }

  const turnText = (s) => (s.phase === 'playing' && s.regatta ? `⛵ Race ${s.regatta.race} of ${s.regatta.races}` : null);
  const myMove = (s) => s.phase === 'playing' && s.regatta?.me != null && s.regatta.st === 'race';
  return { mount, unmount, render, fast, turnText, myMove, focus: true };
})();
