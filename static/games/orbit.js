// Orbit Golf: a space mini-golf course in 3D (three.js) or flat from above. Take turns launching your probe at the cup.
// Drag back from anywhere on the course like a slingshot (the pull sets the direction and power) and let go; or nudge
// with ◀ ▶ − + (arrow keys) and tap 🚀 Launch (Space). The server flies every shot; the page plays it back.
// #172: two fingers pinch to zoom, slide to pan and twist to turn the view (mouse: wheel zooms, right- or shift-drag
// turns, a drag when it isn't your shot pans); 🎥 follows the play again, ⌂ shows the whole course.
// #173: asteroids and comets move with the course clock (the server's, see clock_now in games/orbit.py): it runs
// while a shot plays back and while the course is idle, so the scene here is where the server says it is.
UI.orbit = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null;
  let anim = null, lastShot = null, lastV = null, readyAt = 0, holeKey = '';
  let angle = 0, power = 0.5, drag = null, aimFor = '', popT = 0, lastDraw = 0, magnet = false;
  let clk = { base: 0, wall: 0 };
  // the view, in course units: what it looks at (x, y), how much shows (span), turned (yaw) and tilted (pitch)
  const cam = { x: 0, y: 0, span: 56, yaw: 0, pitch: 0.95, mode: 'auto', glide: 0 };
  const fingers = new Map();
  let two = null, look = null;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nameOf = (i) => ctx?.player(V?.seats[i])?.name ?? '?';
  const colorOf = (i) => ctx?.player(V?.seats[i])?.color ?? '#ccc';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && V && !V.between && V.me != null && !V.done[V.me];
  const canLaunch = () => myTurn() && !S.paused && performance.now() >= readyAt && !anim;
  const PLANET = [['#d0643a', '#8a3a22'], ['#e8c28a', '#b07a3a'], ['#7ac8f0', '#2f6aa8'], ['#8ad07a', '#3a7a3a'], ['#b48cff', '#5a3a9a'], ['#f0e0c0', '#a89878']];

  // the moving bodies, the same sums as games/orbit.py (rock_at, comet_at)
  function rockAt(rk, tau) {
    if (rk.length < 6 || !rk[2]) return [rk[0], rk[1]];
    const [cx, cy, R, ph, w, sy] = rk, a = ph + w * tau;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a) * sy];
  }
  function cometAt(cm, tau) {
    const [sx, sy, vx, vy, P, off] = cm, u = (((tau + off) % P) + P) % P;
    return [sx + vx * u, sy + vy * u];
  }
  // the course clock now: during a shot the shot's own, otherwise the server's clock carried on
  function tauAt(now) {
    if (anim) return anim.shot.tau0 + (now - anim.t0) / 1000 * V.geo.play;
    return now < clk.wall ? clk.base - (clk.wall - now) / 1000 * V.geo.play : clk.base + (now - clk.wall) / 1000;
  }

  function mount(main, side) {
    gl = null; flat = null; anim = null; lastShot = null; lastV = null; readyAt = 0; holeKey = '';
    angle = 0; power = 0.5; drag = null; aimFor = ''; magnet = false; fingers.clear(); two = null; look = null;
    Object.assign(cam, { x: 0, y: 0, span: 56, yaw: 0, pitch: 0.95, mode: 'auto' });
    main.innerHTML = `<div class="og"><div class="og-stage" id="ogStage">
        <div class="og-hud"><span id="ogHole"></span><span id="ogWho"></span></div>
        <div class="og-sub"><span id="ogStroke"></span></div>
        <div class="og-pop" id="ogPop" hidden></div>
        <div class="og-done" id="ogDone" hidden><h3 id="ogDoneTitle"></h3><div id="ogStand"></div></div>
        <div class="og-view" id="ogView" aria-label="View"><button data-v="in" aria-label="Zoom in">＋</button><button data-v="out" aria-label="Zoom out">－</button><button data-v="l" aria-label="Turn left">⟲</button><button data-v="r" aria-label="Turn right">⟳</button><button data-v="auto" aria-label="Follow the play" title="Follow the play">🎥</button><button data-v="home" aria-label="Whole course" title="Whole course">⌂</button></div>
      </div>
      <div class="og-ctl" id="ogCtl">
        <button data-a="-1" aria-label="Aim left">◀</button><button data-a="1" aria-label="Aim right">▶</button>
        <div class="og-meter" title="Power"><i id="ogPow"></i></div>
        <button data-p="-1" aria-label="Less power">−</button><button data-p="1" aria-label="More power">+</button>
        <button class="og-mag" id="ogMag" aria-pressed="false" title="Spend ⭐ stardust: a tractor cup for this stroke">🧲 0</button>
        <button class="og-go" id="ogGo">🚀 Launch</button>
      </div>
      <p id="ogHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>⛳ Scorecard</h3><div id="ogCard" class="og-card"></div></div>';
    $('ogCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'ogGo') return fire();
      if (b.id === 'ogMag') { magnet = !magnet && dust() > 0; ctx.sfx?.('pop'); return controls(); }
      if (b.dataset.a) angle += 1.5 * b.dataset.a;
      if (b.dataset.p) power = clamp(power + 0.02 * b.dataset.p, 0.03, 1);
      controls();
    });
    const stage = $('ogStage');
    stage.style.touchAction = 'none';
    // one finger on your shot: drag back like a slingshot; otherwise it pans. Two fingers: zoom, pan, twist.
    const pair = () => {
      const [[ax, ay], [bx, by]] = [...fingers.values()];
      return { mx: (ax + bx) / 2, my: (ay + by) / 2, d: Math.hypot(bx - ax, by - ay), a: Math.atan2(by - ay, bx - ax) };
    };
    const unAim = () => { if (drag) { angle = drag.a; power = drag.w; drag = null; controls(); } };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .og-done')) return;
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      if (fingers.size >= 2) { unAim(); look = null; two = pair(); return; }
      const turnIt = e.button === 2 || e.shiftKey;
      if (!turnIt && canLaunch()) {
        const p = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!p) return;
        drag = { id: e.pointerId, p0: p, x0: e.clientX, y0: e.clientY, a: angle, w: power, moved: 0 };
      } else look = { id: e.pointerId, x: e.clientX, y: e.clientY, turn: turnIt };
    });
    stage.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (f) { f[0] = e.clientX; f[1] = e.clientY; }
      if (fingers.size >= 2 && two) {
        const p = pair();
        let da = p.a - two.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (p.d > 10 && two.d > 10) zoom(two.d / p.d);
        pan(p.mx - two.mx, p.my - two.my);
        turn(da);     // the course turns with the fingers
        two = p; return;
      }
      if (look && e.pointerId === look.id) {
        const dx = e.clientX - look.x, dy = e.clientY - look.y; look.x = e.clientX; look.y = e.clientY;
        if (look.turn) { turn(dx * 0.008); cam.pitch = clamp(cam.pitch - dy * 0.004, 0.45, 1.45); } else pan(dx, dy);
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const p = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!p) return;
      const dx = drag.p0[0] - p[0], dy = drag.p0[1] - p[1], px = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      drag.moved = Math.max(drag.moved, px);
      // the pull on screen sets the power (whatever the zoom), the pull on the course sets the direction
      if (px > 6 && Math.hypot(dx, dy) > 1e-3) { angle = Math.atan2(dx, dy) * 180 / Math.PI; power = clamp(px / (0.4 * Math.min(stage.clientWidth || 400, stage.clientHeight || 400)), 0.03, 1); }
      controls();
    });
    const up = (e) => {
      fingers.delete(e.pointerId);
      two = fingers.size >= 2 ? pair() : null;
      if (look && e.pointerId === look.id) look = null;
      if (!drag || e.pointerId !== drag.id) return;
      const ok = drag.moved > 14;
      if (!ok) { angle = drag.a; power = drag.w; }
      drag = null; controls();
      if (ok) fire();
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', (e) => { fingers.delete(e.pointerId); two = null; look = null; unAim(); });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.88 : 1.14); }, { passive: false });
    $('ogView').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ({ in: () => zoom(0.75), out: () => zoom(1.33), l: () => turn(-Math.PI / 4, true), r: () => turn(Math.PI / 4, true),
        auto: () => { cam.mode = 'auto'; }, home: () => { cam.mode = 'home'; } })[b.dataset.v]?.();
      viewBtns();
    });
    keyFn = (e) => {
      if (!V || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') angle += (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.25 : 1);
      else if (k === 'ArrowUp' || k === 'ArrowDown') power = clamp(power + (k === 'ArrowDown' ? -0.01 : 0.01) * (e.shiftKey ? 0.5 : 1), 0.03, 1);
      else if ((k === ' ' || k === 'Enter') && !e.target.closest?.('button')) fire();
      else return;
      e.preventDefault(); controls();
    };
    window.addEventListener('keydown', keyFn);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; drag = null;
    if (keyFn) window.removeEventListener('keydown', keyFn); keyFn = null;
    window.Snd?.bed('og.hum').set(0);
  }

  // ---------- sound: synthesised space noises (the shared Snd kit)
  const AT = { room: 'hall', send: 0.4 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    launch: (p) => snd((t, K, d) => { K.sweep(d, t, { f0: 180, f1: 700 + 600 * p, dur: 0.35, vol: 0.12, type: 'sawtooth', attack: 0.01 }); K.burst(d, t, { type: 'bandpass', f: 1800, f1: 600, q: 0.8, vol: 0.12, tau: 0.25, dur: 0.4 }); }),
    bump: (pan) => snd((t, K, d) => { K.mode(d, t, 90, 0.3, 0.12, { f1: 60 }); K.burst(d, t, { type: 'lowpass', f: 600, q: 0.7, vol: 0.2, tau: 0.06, buf: 'brown' }); }, pan),
    rock: (pan) => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 1400, q: 1.4, vol: 0.2, tau: 0.03 }); K.mode(d, t, K.R(380, 520), 0.12, 0.08); }, pan),
    warp: () => snd((t, K, d) => { K.sweep(d, t, { f0: 900, f1: 120, dur: 0.4, vol: 0.1, type: 'sine', attack: 0.01 }); K.sweep(d, t + 0.35, { f0: 120, f1: 1100, dur: 0.4, vol: 0.1, type: 'sine', attack: 0.01 }); }),
    cup: () => snd((t, K, d) => { [784, 988, 1175, 1568].forEach((f, k) => { K.mode(d, t + k * 0.09, f, 0.09, 0.6); K.mode(d, t + k * 0.09, f * 2, 0.03, 0.3); }); }),
    lip: () => snd((t, K, d) => { K.mode(d, t, 2093, 0.08, 0.25); K.mode(d, t + 0.06, 1760, 0.05, 0.2); }),
    black: () => snd((t, K, d) => { K.sweep(d, t, { f0: 400, f1: 35, dur: 1.2, vol: 0.18, type: 'sine', attack: 0.02 }); K.burst(d, t, { type: 'lowpass', f: 300, f1: 60, q: 0.7, vol: 0.2, tau: 0.8, dur: 1.2, buf: 'brown' }); }),
    out: () => snd((t, K, d) => { K.sweep(d, t, { f0: 600, f1: 200, dur: 0.6, vol: 0.06, type: 'triangle', attack: 0.05 }); }),
    star: (pan) => snd((t, K, d) => { [1319, 1760, 2637].forEach((f, k) => K.mode(d, t + k * 0.05, f, 0.07, 0.35)); }, pan),
    comet: (pan) => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 600, f1: 3200, q: 1.2, vol: 0.16, tau: 0.35, dur: 0.6 }); K.sweep(d, t, { f0: 300, f1: 900, dur: 0.4, vol: 0.06, type: 'triangle', attack: 0.02 }); }, pan),
    fence: (pan) => snd((t, K, d) => { K.sweep(d, t, { f0: 140, f1: 90, dur: 0.7, vol: 0.09, type: 'square', attack: 0.04 }); K.sweep(d, t + 0.1, { f0: 220, f1: 150, dur: 0.5, vol: 0.04, type: 'sine', attack: 0.04 }); }, pan),
    magnet: () => snd((t, K, d) => { K.sweep(d, t, { f0: 200, f1: 520, dur: 0.5, vol: 0.08, type: 'sine', attack: 0.03 }); }),
  };
  const humBed = (K, dst) => {
    const A = K.ctx, o = A.createOscillator(), o2 = A.createOscillator(), g = A.createGain(), lp = A.createBiquadFilter();
    o.type = 'sine'; o.frequency.value = 55; o2.type = 'sine'; o2.frequency.value = 82.6; lp.type = 'lowpass'; lp.frequency.value = 300; g.gain.value = 0;
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(dst); o.start(); o2.start();
    return { set(l) { g.gain.setTargetAtTime(0.025 * l, A.currentTime, 1); }, stop() { try { o.stop(); o2.stop(); } catch {} } };
  };

  function fire() {
    if (!canLaunch()) return;
    readyAt = performance.now() + 1500;
    SND.launch(power); ctx.buzz?.(15);
    const a = ((angle + 180) % 360 + 360) % 360 - 180;
    ctx.quiet(ctx.act('launch', { angle: +a.toFixed(2), power: +power.toFixed(3), ...(magnet && dust() > 0 ? { magnet: true } : {}) }));
    magnet = false;
    controls();
  }
  const dust = () => (V && V.me != null ? V.dust?.[V.me] ?? 0 : 0);

  // ---------- the view (#172)
  const stageSize = () => { const st = $('ogStage'); return Math.max(200, Math.min(st?.clientWidth || 400, st?.clientHeight || 400)); };
  function freeView() { if (cam.mode !== 'free') { cam.mode = 'free'; viewBtns(); } }
  function zoom(k) { cam.span = clamp(cam.span * k, 8, 90); freeView(); }
  function pan(dx, dy) {
    if (!V) return;
    const u = cam.span / stageSize(), sp = gl ? Math.max(0.5, Math.sin(cam.pitch)) : 1, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    // right on screen is (cos, sin) on the course, up the screen is (-sin, cos)
    cam.x = clamp(cam.x - c * dx * u - s * dy * u / sp, -V.geo.xMax, V.geo.xMax);
    cam.y = clamp(cam.y - s * dx * u + c * dy * u / sp, -V.geo.yMax, V.geo.yMax);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) freeView();
  }
  function turn(a, smooth) { if (smooth) cam.yawTo = (cam.yawTo ?? cam.yaw) + a; else { cam.yaw += a; cam.yawTo = null; } }
  function viewBtns() {
    const v = $('ogView'); if (!v) return;
    v.querySelector('[data-v="auto"]').classList.toggle('on', cam.mode === 'auto');
    v.querySelector('[data-v="home"]').classList.toggle('on', cam.mode === 'home');
  }
  // 🎥 follow the play: the probe in flight, else the shooter's probe and the cup together; ⌂ the whole course
  function camStep(dt, sc) {
    let to = null;
    const whole = { x: 0, y: (V.tee[1] + V.cup[1]) / 2, span: 2 * V.geo.fenceY + 4 };
    if (cam.mode === 'home') to = whole;
    else if (cam.mode === 'auto') {
      const t = turnIdx();
      if (sc.fly) to = { x: sc.fly.xy[0], y: sc.fly.xy[1], span: 30 };
      else if (V.between || t < 0 || drag) to = drag ? null : whole;
      else {
        const [x, y] = V.pos[t], [cx, cy] = V.cup;
        to = { x: (x + cx) / 2, y: (y + cy) / 2, span: clamp(Math.hypot(cx - x, cy - y) * 1.25 + 10, 22, 2 * V.geo.fenceY + 4) };
      }
    }
    const f = 1 - Math.exp(-dt * 2.6);
    cam.glide = 0;
    if (to) {
      const d = Math.abs(to.x - cam.x) + Math.abs(to.y - cam.y) + Math.abs(to.span - cam.span);
      if (d > 0.02) { cam.x += (to.x - cam.x) * f; cam.y += (to.y - cam.y) * f; cam.span += (to.span - cam.span) * f; cam.glide = 1; }
      if (cam.mode === 'home') { cam.yawTo = Math.round(cam.yaw / (2 * Math.PI)) * 2 * Math.PI; cam.pitch += (0.95 - cam.pitch) * f; }
    }
    if (cam.yawTo != null) {
      cam.yaw += (cam.yawTo - cam.yaw) * Math.min(1, dt * 6);
      if (Math.abs(cam.yawTo - cam.yaw) < 0.002) { cam.yaw = cam.yawTo; cam.yawTo = null; } else cam.glide = 1;
    }
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.orbit;
    const now = performance.now();
    if (V !== lastV) { lastV = V; readyAt = now + V.readyIn * 1000; if (V.clk) clk = { base: V.clk[0], wall: now + V.clk[1] * 1000 }; }
    const hk = `${V.hole}`;
    if (hk !== holeKey) { holeKey = hk; anim = null; lastShot = V.shot?.id ?? null; aimFor = ''; cam.mode = 'auto'; viewBtns(); }
    if (dust() < 1) magnet = false;
    if (V.shot && V.shot.id !== lastShot) {
      lastShot = V.shot.id;
      // only play shots that are still flying (a reload doesn't replay the last one)
      const ago = V.shot.t + 0.9 - V.readyIn;
      if (ago < V.shot.t) anim = { shot: V.shot, t0: now - Math.max(0, ago) * 1000, ev: 0 };
    }
    // aim at the cup when your turn comes round
    const key = `${V.hole}:${V.me != null ? V.strokes[V.me] : ''}`;
    if (myTurn() && aimFor !== key) {
      aimFor = key;
      const [x, y] = V.pos[V.me], [cx, cy] = V.cup;
      angle = Math.atan2(cx - x, cy - y) * 180 / Math.PI;
      power = clamp(0.1 + Math.hypot(cx - x, cy - y) / 40, 0.05, 1);
    }
    hud(); controls(); card(); done(); hint();
  }

  function turnIdx() { return V.seats.indexOf(S.turn); }

  function hud() {
    $('ogHole').textContent = `⛳ ${V.hole}/${V.holes} · ${V.name} · par ${V.par}`;
    const t = turnIdx(), who = $('ogWho');
    if (V.between || t < 0) { who.textContent = ''; }
    else { who.textContent = t === V.me ? '🚀 Your shot' : `${nameOf(t)} is aiming`; who.style.color = t === V.me ? '' : colorOf(t); }
    $('ogStroke').textContent = V.me != null ? (V.done[V.me] ? `✓ ${V.strokes[V.me]} on this hole` : `Stroke ${V.strokes[V.me] + 1}`) + (dust() ? ` · ⭐ ${dust()}` : '') : '';
  }

  function controls() {
    if (!V) return;
    const go = canLaunch();
    $('ogGo').disabled = !go;
    $('ogGo').classList.toggle('og-ready', go);
    $('ogCtl').classList.toggle('og-off', !myTurn());
    const p = $('ogPow'); if (p) p.style.height = `${Math.round(power * 100)}%`;
    const m = $('ogMag');
    if (m) {
      const n = dust(), t = `🧲 ${n}`;
      if (m.textContent !== t) m.textContent = t;
      m.disabled = !myTurn() || n < 1; m.classList.toggle('on', magnet); m.setAttribute('aria-pressed', magnet ? 'true' : 'false');
      m.hidden = V.me == null;
    }
  }

  function card() {
    const box = $('ogCard'); box.innerHTML = '';
    const tbl = ctx.el('table', 'og-tbl'), head = ctx.el('tr');
    head.append(ctx.el('th', '', ''));
    for (let h = 1; h <= V.holes; h++) head.append(ctx.el('th', h === V.hole ? 'now' : '', `${h}`));
    head.append(ctx.el('th', '', 'Σ'));
    const par = ctx.el('tr', 'par'); par.append(ctx.el('td', '', 'par'));
    V.pars.forEach((p) => par.append(ctx.el('td', '', `${p}`)));
    par.append(ctx.el('td', '', `${V.pars.reduce((a, b) => a + b, 0)}`));
    tbl.append(head, par);
    const t = turnIdx();
    const order = V.seats.map((_, i) => i).sort((a, b) => sum(a) - sum(b));
    function sum(i) { return V.cards[i].reduce((a, b) => a + b, 0) + (V.between ? 0 : V.strokes[i]); }
    for (const i of order) {
      const row = ctx.el('tr', (i === t ? 'turn' : '') + (i === V.me ? ' me' : ''));
      const nm = ctx.el('td', 'nm', nameOf(i)); nm.style.color = colorOf(i); row.append(nm);
      for (let h = 0; h < V.holes; h++) {
        const v = h < V.cards[i].length ? V.cards[i][h] : h === V.hole - 1 && !V.between ? V.strokes[i] || '' : '';
        const p = V.pars[h], cell = ctx.el('td', v === '' ? '' : v < p ? 'under' : v > p ? 'over' : '', `${v}`);
        if (h === V.hole - 1 && !V.between && !V.done[i] && v !== '') cell.classList.add('live');
        row.append(cell);
      }
      row.append(ctx.el('td', 'tot', `${sum(i)}`));
      tbl.append(row);
    }
    box.append(tbl);
  }

  function done() {
    const show = V.between && !!V.standings && !anim;
    $('ogDone').hidden = !show;
    if (!show) return;
    $('ogDoneTitle').textContent = `🏁 Hole ${V.hole} done`;
    standingsCard($('ogStand'), V.standings, { title: '⛳ Fewest strokes', note: V.hole < V.holes ? 'Next hole in a moment…' : 'That was the last hole!' });
  }

  function hint() {
    const t = S.phase !== 'playing' ? '' : V.between ? '' : V.me == null ? 'Watch the probes fly.'
      : myTurn() ? (magnet ? '🧲 Tractor cup on: this stroke the cup is bigger and pulls your probe in.' : 'Drag back like a slingshot and let go: the pull sets the direction and power. Two fingers move the view.')
        : V.done[V.me] ? 'In the cup! Watch the others finish the hole.' : 'Furthest from the cup goes next.';
    if ($('ogHint').textContent !== t) $('ogHint').textContent = t;
  }

  function pop(text, color = '#fff') {
    const el = $('ogPop'); if (!el) return;
    el.textContent = text; el.style.color = color;
    el.hidden = false; el.classList.remove('og-pop-in'); void el.offsetWidth; el.classList.add('og-pop-in');
    popT = performance.now() + 1500;
  }

  // where a shot is at `tp` seconds into its own flight: [x, y] (a jump is a teleport, not a slide)
  function at(path, tp) {
    let k = 1;
    while (k < path.length - 1 && path[k][0] < tp) k++;
    const a = path[k - 1], b = path[k];
    if (b[3] && tp < b[0]) return [a[1], a[2]];
    const u = b[0] > a[0] ? clamp((tp - a[0]) / (b[0] - a[0]), 0, 1) : 1;
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // the start of the flight (the server's physics, gravity and drag only): the aim guide
  function preview() {
    if (!myTurn() || V.me == null) return null;
    const G = V.geo, a = angle * Math.PI / 180, out = [];
    let [x, y] = V.pos[V.me], vx = G.vmax * power * Math.sin(a), vy = G.vmax * power * Math.cos(a);
    for (let t = 0; t < 0.75; t += G.dt) {
      let ax = 0, ay = 0;
      for (const [px, py, r] of V.planets) { const dx = px - x, dy = py - y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1e-6, f = G.mass * r * r / Math.max(d2, r * r); ax += f * dx / d; ay += f * dy / d; if (d < r + G.probe) return out; }
      for (const [bx, by] of V.blacks) { const dx = bx - x, dy = by - y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1e-6, f = G.bhMass / Math.max(d2, 0.5); ax += f * dx / d; ay += f * dy / d; }
      const v = Math.hypot(vx, vy);
      if (v > 1e-6) { const k = Math.max(0, v - (G.drag * v + G.friction) * G.dt) / v; vx *= k; vy *= k; }
      vx += ax * G.dt; vy += ay * G.dt; x += vx * G.dt; y += vy * G.dt;
      out.push([x, y]);
    }
    return out.filter((_, k) => k % 5 === 4);
  }

  function scene(now) {
    let fly = null;
    if (anim) {
      const tp = (now - anim.t0) / 1000 * V.geo.play;
      fly = { o: anim.shot.o, tp, xy: at(anim.shot.path, tp), path: anim.shot.path, result: anim.shot.result, end: anim.shot.path[anim.shot.path.length - 1][0] };
    }
    const probes = V.seats.map((_, i) => ({ i, xy: fly && fly.o === i ? fly.xy : (anim && anim.shot.o === i ? anim.shot.from : V.pos[i]), color: colorOf(i), done: V.done[i], me: i === V.me, turn: i === turnIdx() }));
    // stardust still out there (one picked up during the shot on screen stays until the probe gets there)
    const taken = new Set(V.taken || []);
    if (fly) for (const e of anim.shot.events) if (e[1] === 'star' && e[0] > fly.tp) taken.delete(e[4]);
    const tau = tauAt(now);
    const mag = fly ? !!anim.shot.magnet : (magnet && canLaunch());
    return { V, fly, probes, now, tau, taken, mag, rocks: V.rocks.map((rk) => rockAt(rk, tau)), comets: (V.comets || []).map((cm) => ({ xy: cometAt(cm, tau), v: [cm[2], cm[3]] })),
      preview: canLaunch() || drag ? preview() : null, aim: { angle, power }, dragging: !!drag };
  }

  function events(now) {
    if (!anim) return;
    const sh = anim.shot, tp = (now - anim.t0) / 1000 * V.geo.play;
    while (anim.ev < sh.events.length && sh.events[anim.ev][0] <= tp) {
      const [, kind, x] = sh.events[anim.ev++];
      const pan = clamp((x - cam.x) / 20, -1, 1), mine = sh.o === V.me;
      if (kind === 'bump') SND.bump(pan);
      else if (kind === 'rock') SND.rock(pan);
      else if (kind === 'warp') SND.warp();
      else if (kind === 'star') { SND.star(pan); if (mine) pop('⭐ Stardust!', '#ffe27a'); }
      else if (kind === 'comet') { SND.comet(pan); if (mine) pop('🌠 Comet ride!', '#9ad8ff'); ctx.buzz?.(20); }
      else if (kind === 'fence') { SND.fence(pan); if (mine) pop('🧲 Tractor fence', '#7af0ff'); }
      else if (kind === 'magnet') SND.magnet();
      else if (kind === 'lip') { SND.lip(); if (mine) pop('Lipped out!', '#ffb0b0'); }
      else if (kind === 'cup') {
        SND.cup(); if (mine) ctx.buzz?.([30, 40, 60]);
        const s = sh.strokes, p = V.par, word = s === 1 ? '🌟 HOLE IN ONE!' : s <= p - 2 ? '🦅 Eagle!' : s === p - 1 ? '🐦 Birdie!' : s === p ? 'Par' : s === p + 1 ? 'Bogey' : `${s} strokes`;
        if (mine || s < p) pop(`${word}`, s < p ? '#ffd23f' : '#fff');
      } else if (kind === 'black') { SND.black(); if (mine) pop('🕳 Swallowed! +1', '#ff9a9a'); }
      else if (kind === 'out') { SND.out(); if (mine) pop('🛰 Lost in deep space! +1', '#ff9a9a'); }
      (gl || flat)?.burst?.(kind, sh.events[anim.ev - 1], colorOf(sh.o));
    }
  }

  function loop(now) {
    if (!$('ogStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    events(now);
    if (anim && (now - anim.t0) / 1000 * V.geo.play > anim.shot.path[anim.shot.path.length - 1][0] + 0.5) { anim = null; done(); controls(); }
    if (popT && now > popT) { popT = 0; $('ogPop').hidden = true; }
    if ($('ogGo').disabled === canLaunch()) controls();
    window.Snd?.bed('og.hum', humBed).set(S.phase === 'playing' && !S.paused ? 1 : 0);
    const sc = scene(now);
    const dt = Math.min(0.1, lastDraw ? (now - lastDraw) / 1000 : 0.016);
    const idle = !anim && !drag && !cam.glide && !two && !look && !(gl || flat)?.moving?.();
    if (idle && now - lastDraw < 50) return;
    lastDraw = now;
    camStep(dt, sc);
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: the course lies flat; course x is world x, course y runs away from you (world -z)
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(45, 1, 0.5, 600);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.1, hemi: [0x9ab8ff, 0x10081a, 0.45], env: false,
      key: { color: 0xfff0dd, i: 1.4, pos: [-20, 30, 10], area: 30, near: 5, far: 90, map: 1024 },
      sky: { top: 0x02030a, horizon: 0x0c1030, bottom: 0x02030a, radius: 300, band: 0.05, stars: true },
    });
    const low = stg.low;
    const W = (x, y, h = 0) => new T.Vector3(x, h, -y);
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const glowTex = tex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.4)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    const glow = (col, s, op = 0.8) => { const m = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: op })); m.scale.setScalar(s); return m; };
    // a distant nebula behind the course
    const neb = tex(512, 256, (g, w, h) => { for (let k = 0; k < 14; k++) { const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 120, c = ['80,40,160', '30,90,170', '160,40,110'][k % 3]; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${c},.35)`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
    const nebula = new T.Mesh(new T.PlaneGeometry(360, 180), new T.MeshBasicMaterial({ map: neb, transparent: true, depthWrite: false, fog: false }));
    nebula.position.set(0, 20, -200); scene3.add(nebula);

    const course = new T.Group(); scene3.add(course);
    let builtFor = '';
    let fabric = null, planets = [], bh = [], wormMeshes = [], cupG = null, rockMeshes = [], cometGs = [], starMs = [], magRing = null;
    const starTex = tex(64, 64, (g, w) => { g.translate(w / 2, w / 2); g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? w * 0.18 : w * 0.46, a = k * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.shadowColor = '#fff'; g.shadowBlur = 6; g.fill(); });
    // the course: a grid of space-time that dips into every planet's gravity well, then the bodies on top
    function build() {
      const key = `${V.hole}:${JSON.stringify(V.cup)}`; if (key === builtFor) return; builtFor = key;
      course.traverse((m) => { if (m !== course) { m.geometry?.dispose(); if (m.material && !m.material.shared) { m.material.map?.dispose?.(); m.material.dispose?.(); } } });
      while (course.children.length) course.remove(course.children[0]);
      planets = []; bh = []; wormMeshes = []; rockMeshes = []; cometGs = []; starMs = [];
      const G = V.geo, X = G.xMax, Y = G.yMax, sx = low ? 30 : 60, sy = low ? 38 : 76;
      const fg = new T.PlaneGeometry(2 * X, 2 * Y, sx, sy); fg.rotateX(-Math.PI / 2);
      const pos = fg.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = -pos.getZ(k);
        let dip = 0;
        for (const [px, py, r] of V.planets) dip += G.mass * r * r / (Math.hypot(x - px, y - py) + r) * 0.05;
        for (const [bx, by] of V.blacks) dip += G.bhMass / (Math.hypot(x - bx, y - by) + 0.6) * 0.09;
        pos.setY(k, -Math.min(6, dip) - 0.6);
      }
      fabric = new T.LineSegments(new T.WireframeGeometry(fg), new T.LineBasicMaterial({ color: 0x3a6aff, transparent: true, opacity: 0.22, depthWrite: false }));
      fg.dispose();
      course.add(fabric);
      // the edge of deep space (faint red), and the tractor fence (glowing cyan, with beacons) that pulls probes back
      const edge = new T.LineLoop(new T.BufferGeometry().setFromPoints([W(-X, -Y), W(X, -Y), W(X, Y), W(-X, Y)]), new T.LineBasicMaterial({ color: 0xff5a7a, transparent: true, opacity: 0.3 }));
      course.add(edge);
      const FX = G.fenceX, FY = G.fenceY;
      const fence = new T.LineLoop(new T.BufferGeometry().setFromPoints([W(-FX, -FY, 0.05), W(FX, -FY, 0.05), W(FX, FY, 0.05), W(-FX, FY, 0.05)]), new T.LineBasicMaterial({ color: 0x5af0ff, transparent: true, opacity: 0.6 }));
      course.add(fence);
      for (let k = 0; k <= 8; k++) for (const [x, y] of [[-FX + 2 * FX * k / 8, -FY], [-FX + 2 * FX * k / 8, FY], [-FX, -FY + 2 * FY * k / 8], [FX, -FY + 2 * FY * k / 8]]) {
        if (low && k % 2) continue;
        const b = glow(0x5af0ff, 1.1, 0.55); b.position.copy(W(x, y, 0.2)); course.add(b);
      }
      // planets
      V.planets.forEach(([x, y, r, look], k) => {
        const [c1, c2] = PLANET[look % PLANET.length];
        const t = tex(256, 128, (g, w, h) => {
          g.fillStyle = c1; g.fillRect(0, 0, w, h);
          if (look === 1 || look === 4) for (let b = 0; b < 12; b++) { g.fillStyle = b % 2 ? c2 + '99' : c1; g.fillRect(0, b * h / 12 + Math.sin(b) * 3, w, h / 14); }
          else for (let b = 0; b < 40; b++) { g.fillStyle = c2 + (b % 3 ? '66' : 'aa'); g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 14, 0, 7); g.fill(); }
          if (look === 2) { g.fillStyle = '#ffffffaa'; g.fillRect(0, 0, w, h * 0.12); g.fillRect(0, h * 0.88, w, h * 0.12); }
        });
        const m = new T.Mesh(new T.SphereGeometry(r, 32, 20), new T.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 }));
        m.position.copy(W(x, y, 0)); m.castShadow = !low; m.userData.spin = 0.15 + (k % 3) * 0.08;
        course.add(m); planets.push(m);
        const atm = glow(c1, r * 3.2, 0.35); atm.position.copy(m.position); course.add(atm);
        if (look === 1 && !low) {
          const ring = new T.Mesh(new T.RingGeometry(r * 1.35, r * 1.9, 48), new T.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2 + 0.35; ring.position.copy(m.position); course.add(ring);
        }
      });
      // black holes: a dark sphere in a bright accretion disc
      const discTex = tex(256, 256, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, w * 0.12, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(0.18, 'rgba(255,240,200,1)'); r.addColorStop(0.4, 'rgba(255,140,40,.8)'); r.addColorStop(0.7, 'rgba(200,40,120,.3)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
      for (const [x, y] of V.blacks) {
        const core = new T.Mesh(new T.SphereGeometry(G.bhR, 24, 16), new T.MeshBasicMaterial({ color: 0x000000 }));
        core.position.copy(W(x, y, 0)); course.add(core);
        const disc = new T.Mesh(new T.PlaneGeometry(G.bhR * 7, G.bhR * 7), new T.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        disc.rotation.x = -Math.PI / 2 + 0.25; disc.position.copy(core.position); course.add(disc); bh.push(disc);
        const halo = glow(0xff9a4a, G.bhR * 6, 0.5); halo.position.copy(core.position); course.add(halo);
      }
      // asteroid rocks
      const rockG = new T.DodecahedronGeometry(G.rock, 0), rockM = new T.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.95, flatShading: true });
      V.rocks.forEach((rk, k) => { const [x, y] = rockAt(rk, 0); const m = new T.Mesh(rockG, rockM); m.position.copy(W(x, y, 0)); m.rotation.set(k, k * 2, k * 3); m.scale.set(1, 0.8 + (k % 3) * 0.15, 1.1); m.castShadow = !low; course.add(m); planets.push(m); rockMeshes.push(m); m.userData.spin = 0.5 + (k % 4) * 0.2; });
      // comets: a hot head and a long fading tail
      for (const cm of V.comets || []) {
        const g = new T.Group(), n = low ? 6 : 12;
        g.add(new T.Mesh(new T.IcosahedronGeometry(0.32, 1), new T.MeshBasicMaterial({ color: 0xe8f6ff })));
        g.add(glow(0x9ad8ff, 2.6, 0.95));
        for (let k = 1; k <= n; k++) { const sp = glow(k < 3 ? 0xd8f0ff : 0x6ab8ff, 1.9 * (1 - k / (n + 2)), 0.75 * (1 - k / (n + 1))); sp.userData.u = k / n; g.add(sp); }
        g.userData.dir = (() => { const sp = Math.hypot(cm[2], cm[3]) || 1; return [cm[2] / sp, cm[3] / sp]; })();
        course.add(g); cometGs.push(g);
      }
      // stardust: a little gold star that spins over a glow
      for (const [x, y] of V.stars || []) {
        const g = new T.Group(); g.position.copy(W(x, y, 0.45));
        const st = new T.Sprite(new T.SpriteMaterial({ map: starTex, color: 0xffe27a, transparent: true, depthWrite: false })); st.scale.setScalar(1.0); g.add(st);
        g.add(glow(0xffc23a, 2.0, 0.6));
        course.add(g); starMs.push(g);
      }
      // the tractor cup's reach (shown while it's switched on)
      magRing = new T.Mesh(new T.RingGeometry(G.magR - 0.12, G.magR, 64), new T.MeshBasicMaterial({ color: 0xff7ad8, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }));
      magRing.rotation.x = -Math.PI / 2; magRing.position.copy(W(V.cup[0], V.cup[1], 0.06)); magRing.visible = false; course.add(magRing);
      // wormholes: swirling purple discs
      const swirl = tex(128, 128, (g, w) => { g.translate(w / 2, w / 2); for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); const gr = g.createLinearGradient(0, 0, w / 2, 0); gr.addColorStop(0, 'rgba(220,160,255,.9)'); gr.addColorStop(1, 'rgba(120,40,255,0)'); g.strokeStyle = gr; g.lineWidth = 6; g.beginPath(); g.arc(w / 6, 0, w / 3, Math.PI, Math.PI * 1.7); g.stroke(); } });
      for (const [x, y] of V.worms) {
        const m = new T.Mesh(new T.CircleGeometry(G.worm * 1.3, 32), new T.MeshBasicMaterial({ map: swirl, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        m.rotation.x = -Math.PI / 2; m.position.copy(W(x, y, 0.05)); course.add(m); wormMeshes.push(m);
        const h = glow(0xb070ff, G.worm * 4, 0.5); h.position.copy(m.position); course.add(h);
      }
      // the cup: a glowing ring with a beacon
      cupG = new T.Group(); cupG.position.copy(W(V.cup[0], V.cup[1], 0));
      const ring = new T.Mesh(new T.TorusGeometry(G.cupR, 0.08, 10, 40), new T.MeshBasicMaterial({ color: 0x5affb0 })); ring.rotation.x = Math.PI / 2; cupG.add(ring);
      const beam = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 6, 10, 1, true), new T.MeshBasicMaterial({ color: 0x5affb0, transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending })); beam.position.y = 3; cupG.add(beam);
      cupG.add(glow(0x5affb0, 3.4, 0.7));
      course.add(cupG);
      // the tee pad
      const tee = new T.Mesh(new T.CylinderGeometry(0.7, 0.8, 0.12, 24), new T.MeshStandardMaterial({ color: 0x506080, metalness: 0.6, roughness: 0.4 }));
      tee.position.copy(W(V.tee[0], V.tee[1], -0.2)); course.add(tee);
    }

    // probes, their glow, rest markers, the flight trail, the aim guide
    const probeG = new T.SphereGeometry(V.geo.probe * 1.4, 16, 12);
    const probes = [];
    function probeFor(i) {
      if (probes[i]) return probes[i];
      const m = new T.Mesh(probeG, new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.3 }));
      const g = glow(0xffffff, 1.6, 0.8); m.add(g);
      scene3.add(m); return (probes[i] = m);
    }
    const trailMax = 400, trailPos = new Float32Array(trailMax * 3), trailGeo = new T.BufferGeometry();
    trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
    const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); trail.frustumCulled = false; scene3.add(trail);
    const dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const dots = Array.from({ length: 14 }, () => { const m = new T.Mesh(new T.SphereGeometry(0.11, 6, 4), dotMat); m.visible = false; scene3.add(m); return m; });
    const aimLine = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 6), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8 })); aimLine.visible = false; scene3.add(aimLine);
    const streakPos = new Float32Array(6), streakGeo = new T.BufferGeometry();
    streakGeo.setAttribute('position', new T.BufferAttribute(streakPos, 3));
    const streak = new T.Line(streakGeo, new T.LineBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0, depthWrite: false, fog: false })); streak.frustumCulled = false; streak.visible = false; streak.userData = { life: 0 }; scene3.add(streak);
    let nextStreak = performance.now() + 2000;
    const sparks = [];
    function burst(kind, e, col) {
      if (kind === 'fence' || kind === 'magnet') return;
      const p = W(e[2], e[3], 0.3), n = kind === 'cup' ? 50 : kind === 'warp' ? 30 : kind === 'black' ? 24 : kind === 'star' || kind === 'comet' ? 20 : 10;
      const c = kind === 'cup' ? 0x5affb0 : kind === 'warp' ? 0xc08aff : kind === 'black' ? 0xff9a4a : kind === 'star' ? 0xffd23f : kind === 'comet' ? 0x9ad8ff : new T.Color(col).getHex();
      for (let k = 0; k < (low ? n / 2 : n); k++) {
        const m = glow(c, 0.5 + Math.random() * 0.5, 0.9); m.position.copy(p);
        const a = Math.random() * 7, s = (kind === 'cup' ? 4 : 2.5) * (0.4 + Math.random());
        m.userData = { v: new T.Vector3(Math.cos(a) * s, Math.random() * (kind === 'cup' ? 6 : 2), Math.sin(a) * s), life: 0.8 + Math.random() * 0.5, in: kind === 'black' };
        if (kind === 'black') { m.position.add(m.userData.v.clone().multiplyScalar(0.6)); m.userData.v.multiplyScalar(-1.4); }
        scene3.add(m); sparks.push(m);
      }
      if (kind === 'cup' || kind === 'black') GL3.shake(camera, 0.1);
    }

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0, moving = 0;
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();

    function draw(now, sc, idle) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      build();
      for (const m of planets) m.rotation.y += dt * m.userData.spin;
      for (const d of bh) d.rotation.z -= dt * 1.5;
      for (const w of wormMeshes) w.rotation.z += dt * 2;
      if (cupG) cupG.children[1].material.opacity = 0.22 + 0.12 * Math.sin(now / 300);
      rockMeshes.forEach((m, k) => { const p = sc.rocks[k]; if (p) m.position.set(p[0], 0, -p[1]); });
      cometGs.forEach((g, k) => {
        const c = sc.comets[k]; if (!c) return;
        const [x, y] = c.xy, [ux, uy] = g.userData.dir;
        g.visible = Math.abs(x) < V.geo.xMax + 6 && Math.abs(y) < V.geo.yMax + 6;
        g.position.set(x, 0.5, -y);
        g.children.forEach((ch) => { if (ch.userData.u != null) { const u = ch.userData.u * V.geo.tail * 1.25; ch.position.set(-ux * u, 0.05 * Math.sin(now / 90 + u * 3), uy * u); } });
      });
      starMs.forEach((g, k) => { g.visible = !sc.taken.has(k); if (g.visible) { g.children[0].material.rotation = now / 600 + k; g.position.y = 0.45 + 0.12 * Math.sin(now / 400 + k * 2); } });
      if (magRing) { magRing.visible = sc.mag; if (sc.mag) { magRing.material.opacity = 0.35 + 0.25 * Math.sin(now / 180); magRing.rotation.z = now / 900; } }
      // a shooting star across the sky now and then (just for looks)
      if (now > nextStreak) {
        nextStreak = now + 2500 + Math.random() * (low ? 9000 : 5000);
        const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 60, from = new T.Vector3(cam.x + Math.cos(a) * r, 25 + Math.random() * 40, -cam.y + Math.sin(a) * r - 40);
        const dir = new T.Vector3(Math.random() - 0.5, -0.25 - Math.random() * 0.3, Math.random() - 0.5).normalize();
        streak.userData = { p: from, d: dir, life: 0.9, v: 70 + Math.random() * 40 };
      }
      if (streak.userData.life > 0) {
        const u = streak.userData; u.life -= dt; u.p.addScaledVector(u.d, u.v * dt);
        const tail = u.p.clone().addScaledVector(u.d, -9);
        streakPos.set([u.p.x, u.p.y, u.p.z, tail.x, tail.y, tail.z]); streakGeo.attributes.position.needsUpdate = true;
        streak.material.opacity = Math.min(1, u.life * 2); streak.visible = true;
      } else streak.visible = false;
      sc.probes.forEach((p) => {
        const m = probeFor(p.i);
        let h = 0.35, s = 1;
        if (sc.fly && sc.fly.o === p.i) {
          const f = sc.fly, left = f.end - f.tp;
          if (f.result === 'black' && left < 0.4) s = Math.max(0.05, left / 0.4);
          if (f.result === 'out' && left < 0.3) s = Math.max(0.05, left / 0.3);
          if (f.result === 'cup' && left < 0.1) { s = 0.6; h = 0; }
        } else if (p.done) { h = 0; s = 0.6; }
        m.visible = true;
        m.position.copy(W(p.xy[0], p.xy[1], h)); m.scale.setScalar(s * (p.turn && !sc.fly ? 1 + 0.12 * Math.sin(now / 160) : 1));
        m.material.color.set(p.color); m.material.emissive.set(p.color); m.children[0].material.color.set(p.color);
      });
      for (let k = sc.probes.length; k < probes.length; k++) if (probes[k]) probes[k].visible = false;
      // the trail of the shot in flight
      if (sc.fly) {
        let n = 0;
        for (const q of sc.fly.path) { if (q[0] > sc.fly.tp || n >= trailMax - 1) break; if (q[3]) n = 0; trailPos.set([q[1], 0.35, -q[2]], n * 3); n++; }
        trailPos.set([sc.fly.xy[0], 0.35, -sc.fly.xy[1]], n * 3); n++;
        trailGeo.setDrawRange(0, n); trailGeo.attributes.position.needsUpdate = true; trail.visible = true;
        trail.material.color.set(colorOf(sc.fly.o));
      } else trail.visible = false;
      // the aim guide: a dotted start of the flight, and a pull line while dragging
      const pv = sc.preview;
      dots.forEach((d, k) => { d.visible = !!pv && k < pv.length; if (d.visible) d.position.copy(W(pv[k][0], pv[k][1], 0.35)); });
      dotMat.opacity = sc.dragging ? 1 : 0.6;
      aimLine.visible = !!pv && V.me != null;
      if (aimLine.visible) {
        const [x, y] = V.pos[V.me], a = sc.aim.angle * Math.PI / 180, L = 0.6 + sc.aim.power * 3;
        const from = W(x, y, 0.35), dir = new T.Vector3(-Math.sin(a), 0, Math.cos(a));     // the pull: behind the probe
        aimLine.position.copy(from).addScaledVector(dir, L / 2); aimLine.scale.set(1, L, 1);
        aimLine.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
        aimLine.material.color.setHSL(0.33 - 0.33 * sc.aim.power, 1, 0.55);
      }
      for (let k = sparks.length - 1; k >= 0; k--) {
        const m = sparks[k], u = m.userData;
        u.life -= dt; m.position.addScaledVector(u.v, dt); if (!u.in) u.v.y -= 3 * dt; m.material.opacity = Math.max(0, u.life);
        if (u.life <= 0) { scene3.remove(m); m.material.dispose(); sparks.splice(k, 1); }
      }
      // the camera (#172): looks at cam.x, cam.y from cam.yaw / cam.pitch, far enough back for cam.span to show
      const asp = camera.aspect, fovR = 45 * Math.PI / 180;
      const dist = cam.span / 2 / Math.tan(fovR / 2) / Math.min(1, asp) * 0.82, p = cam.pitch;
      camera.position.set(cam.x + Math.sin(cam.yaw) * Math.cos(p) * dist, Math.sin(p) * dist, -cam.y + Math.cos(cam.yaw) * Math.cos(p) * dist);
      if (Math.abs(camera.fov - 45) > 0.01) { camera.fov = 45; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.x, -0.8, -cam.y);
      stg.follow(camera);
      moving = sparks.length || streak.visible ? 1 : 0;
      if (idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize, moving: () => moving, burst,
      pick(cx, cy) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
        return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null;
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        glowTex.dispose(); renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the course from above, through the same view (pan, zoom, turn)
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the course.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [], k = 1, streak = null, nextStreak = performance.now() + 2000;
    const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random(), Math.random()]);
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 7); };
    function draw(now, sc) {
      const G = V.geo;
      k = Math.min(w, h) / cam.span;
      const px = 1 / k;     // one screen pixel in course units
      g.save();
      g.fillStyle = '#05060f'; g.fillRect(0, 0, w, h);
      // the far stars drift a little with the view
      for (const [a, b, c] of stars) { g.fillStyle = `rgba(255,255,255,${0.2 + c * 0.6})`; g.fillRect(((a * w - cam.x * c * 2) % w + w) % w, ((b * h + cam.y * c * 2) % h + h) % h, 1.5, 1.5); }
      if (now > nextStreak) { nextStreak = now + 3000 + Math.random() * 6000; streak = { x: Math.random() * w, y: Math.random() * h * 0.5, a: 0.3 + Math.random() * 0.9, t: now }; }
      if (streak) {
        const u = (now - streak.t) / 700;
        if (u > 1) streak = null;
        else { const x = streak.x + Math.cos(streak.a) * u * 300, y = streak.y + Math.sin(streak.a) * u * 300; const gr = g.createLinearGradient(x, y, x - Math.cos(streak.a) * 60, y - Math.sin(streak.a) * 60); gr.addColorStop(0, `rgba(230,245,255,${1 - u})`); gr.addColorStop(1, 'rgba(230,245,255,0)'); g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(streak.a) * 60, y - Math.sin(streak.a) * 60); g.stroke(); }
      }
      g.translate(w / 2, h / 2); g.rotate(cam.yaw); g.scale(k, -k); g.translate(-cam.x, -cam.y);
      g.strokeStyle = '#ff5a7a55'; g.lineWidth = px; g.strokeRect(-G.xMax, -G.yMax, 2 * G.xMax, 2 * G.yMax);
      g.strokeStyle = '#5af0ffaa'; g.lineWidth = 2 * px; g.setLineDash([6 * px, 5 * px]); g.strokeRect(-G.fenceX, -G.fenceY, 2 * G.fenceX, 2 * G.fenceY); g.setLineDash([]);
      for (const [x, y, r, look] of V.planets) {
        const [c1, c2] = PLANET[look % PLANET.length];
        const gr = g.createRadialGradient(x - r * 0.3, y + r * 0.3, r * 0.1, x, y, r); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        dot(x, y, r); g.fillStyle = gr; g.fill();
      }
      for (const [x, y] of V.blacks) { const R = G.bhR * 3.5, gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, '#000'); gr.addColorStop(0.28, '#000'); gr.addColorStop(0.35, '#ffd0a0'); gr.addColorStop(0.6, '#ff6a2a88'); gr.addColorStop(1, '#ff6a2a00'); g.fillStyle = gr; dot(x, y, R); g.fill(); }
      g.fillStyle = '#8a7a6a'; for (const [x, y] of sc.rocks) { dot(x, y, G.rock); g.fill(); }
      for (const [x, y] of V.worms) { g.save(); g.translate(x, y); g.rotate(now / 400); g.strokeStyle = '#c08aff'; g.lineWidth = 2 * px; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, G.worm * (0.4 + i * 0.3), i, i + 4); g.stroke(); } g.restore(); }
      for (const c of sc.comets) {
        const [x, y] = c.xy, sp = Math.hypot(c.v[0], c.v[1]) || 1, tx = x - c.v[0] / sp * G.tail * 1.3, ty = y - c.v[1] / sp * G.tail * 1.3;
        const gr = g.createLinearGradient(x, y, tx, ty); gr.addColorStop(0, '#e8f6ffee'); gr.addColorStop(1, '#6ab8ff00');
        g.strokeStyle = gr; g.lineWidth = G.cometR * 1.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke(); g.lineCap = 'butt';
        g.fillStyle = '#fff'; dot(x, y, 0.35); g.fill();
      }
      (V.stars || []).forEach(([x, y], i) => {
        if (sc.taken.has(i)) return;
        g.save(); g.translate(x, y); g.rotate(now / 600 + i); g.fillStyle = '#ffe27a'; g.beginPath();
        for (let j = 0; j < 10; j++) { const r = j % 2 ? 0.25 : 0.6, a = j * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.fill(); g.restore();
      });
      dot(V.cup[0], V.cup[1], G.cupR); g.fillStyle = '#5affb033'; g.fill(); g.strokeStyle = '#5affb0'; g.lineWidth = 2 * px; g.stroke();
      if (sc.mag) { dot(V.cup[0], V.cup[1], G.magR); g.strokeStyle = `rgba(255,122,216,${0.4 + 0.3 * Math.sin(now / 180)})`; g.lineWidth = 2 * px; g.stroke(); }
      if (sc.fly) {
        g.strokeStyle = colorOf(sc.fly.o); g.lineWidth = 2 * px; g.beginPath(); let first = true;
        for (const q of sc.fly.path) { if (q[0] > sc.fly.tp) break; if (first || q[3]) { g.moveTo(q[1], q[2]); first = false; } else g.lineTo(q[1], q[2]); }
        g.lineTo(sc.fly.xy[0], sc.fly.xy[1]); g.stroke();
      }
      if (sc.preview) { g.fillStyle = '#fff'; for (const [x, y] of sc.preview) { dot(x, y, 2 * px); g.fill(); } }
      if (sc.preview && V.me != null) {
        const [x, y] = V.pos[V.me], a = sc.aim.angle * Math.PI / 180, L = 0.6 + sc.aim.power * 3;
        g.strokeStyle = `hsl(${120 - 120 * sc.aim.power},100%,55%)`; g.lineWidth = 3 * px; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(a) * L, y - Math.cos(a) * L); g.stroke();
      }
      for (const p of sc.probes) {
        let s = 1; if (sc.fly && sc.fly.o === p.i && (sc.fly.result === 'black' || sc.fly.result === 'out') && sc.fly.end - sc.fly.tp < 0.4) s = Math.max(0.1, (sc.fly.end - sc.fly.tp) / 0.4);
        dot(p.xy[0], p.xy[1], Math.max(3 * px, G.probe * 1.6) * s * (p.turn && !sc.fly ? 1 + 0.15 * Math.sin(now / 160) : 1)); g.fillStyle = p.color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5 * px; g.stroke();
      }
      sparks = sparks.filter((s) => now < s.t + 700);
      for (const s of sparks) { const u = (now - s.t) / 700; dot(s.x, s.y, (5 + u * 40) * px); g.lineWidth = 3 * (1 - u) * px; g.strokeStyle = s.c; g.stroke(); }
      g.restore();
    }
    return {
      draw, resize, moving: () => sparks.length > 0 || !!streak,
      burst(kind, e, col) { if (kind === 'fence' || kind === 'magnet') return; sparks.push({ x: e[2], y: e[3], t: performance.now(), c: kind === 'cup' ? '#5affb0' : kind === 'warp' ? '#c08aff' : kind === 'star' ? '#ffd23f' : kind === 'comet' ? '#9ad8ff' : col }); },
      pick(sx, sy) {
        const r = canvas.getBoundingClientRect(), dx = sx - r.left - w / 2, dy = sy - r.top - h / 2, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
        return [cam.x + (dx * c + dy * s) / k, cam.y + (dx * s - dy * c) / k];
      },
      dispose() { canvas.remove(); },
    };
  }

  const turnText = (s) => (s.phase === 'playing' && s.orbit ? `🪐 Hole ${s.orbit.hole} of ${s.orbit.holes} · par ${s.orbit.par}` : null);
  return { mount, unmount, render, turnText, focus: true };
})();
