// Orbit Golf: a space mini-golf course in 3D (three.js) or flat from above. Take turns launching your probe at the cup.
// Drag back from anywhere on the course like a slingshot (the pull sets the direction and power) and let go; or nudge
// with ◀ ▶ − + (arrow keys) and tap 🚀 Launch (Space). The server flies every shot; the page plays it back.
UI.orbit = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null;
  let anim = null, lastShot = null, lastV = null, readyAt = 0, holeKey = '';
  let angle = 0, power = 0.5, drag = null, aimFor = '', popT = 0, lastDraw = 0;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nameOf = (i) => ctx?.player(V?.seats[i])?.name ?? '?';
  const colorOf = (i) => ctx?.player(V?.seats[i])?.color ?? '#ccc';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && V && !V.between && V.me != null && !V.done[V.me];
  const canLaunch = () => myTurn() && !S.paused && performance.now() >= readyAt && !anim;
  const PLANET = [['#d0643a', '#8a3a22'], ['#e8c28a', '#b07a3a'], ['#7ac8f0', '#2f6aa8'], ['#8ad07a', '#3a7a3a'], ['#b48cff', '#5a3a9a'], ['#f0e0c0', '#a89878']];

  function mount(main, side) {
    gl = null; flat = null; anim = null; lastShot = null; lastV = null; readyAt = 0; holeKey = '';
    angle = 0; power = 0.5; drag = null; aimFor = '';
    main.innerHTML = `<div class="og"><div class="og-stage" id="ogStage">
        <div class="og-hud"><span id="ogHole"></span><span id="ogWho"></span></div>
        <div class="og-sub"><span id="ogStroke"></span></div>
        <div class="og-pop" id="ogPop" hidden></div>
        <div class="og-done" id="ogDone" hidden><h3 id="ogDoneTitle"></h3><div id="ogStand"></div></div>
      </div>
      <div class="og-ctl" id="ogCtl">
        <button data-a="-1" aria-label="Aim left">◀</button><button data-a="1" aria-label="Aim right">▶</button>
        <div class="og-meter" title="Power"><i id="ogPow"></i></div>
        <button data-p="-1" aria-label="Less power">−</button><button data-p="1" aria-label="More power">+</button>
        <button class="og-go" id="ogGo">🚀 Launch</button>
      </div>
      <p id="ogHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>⛳ Scorecard</h3><div id="ogCard" class="og-card"></div></div>';
    $('ogCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'ogGo') return fire();
      if (b.dataset.a) angle += 1.5 * b.dataset.a;
      if (b.dataset.p) power = clamp(power + 0.02 * b.dataset.p, 0.03, 1);
      controls();
    });
    const stage = $('ogStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canLaunch() || e.target.closest('button, .og-done')) return;
      const p = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!p) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { id: e.pointerId, p0: p, a: angle, w: power, moved: 0 };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!p) return;
      const dx = drag.p0[0] - p[0], dy = drag.p0[1] - p[1], d = Math.hypot(dx, dy);
      drag.moved = Math.max(drag.moved, d);
      if (d > 0.4) { angle = Math.atan2(dx, dy) * 180 / Math.PI; power = clamp(d / 12, 0.03, 1); }
      controls();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const ok = drag.moved > 0.8;
      if (!ok) { angle = drag.a; power = drag.w; }
      drag = null; controls();
      if (ok) fire();
    });
    stage.addEventListener('pointercancel', () => { if (drag) { angle = drag.a; power = drag.w; } drag = null; });
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
    ctx.quiet(ctx.act('launch', { angle: +a.toFixed(2), power: +power.toFixed(3) }));
    controls();
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.orbit;
    const now = performance.now();
    if (V !== lastV) { lastV = V; readyAt = now + V.readyIn * 1000; }
    const hk = `${V.hole}`;
    if (hk !== holeKey) { holeKey = hk; anim = null; lastShot = V.shot?.id ?? null; aimFor = ''; }
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
      power = clamp(0.12 + Math.hypot(cx - x, cy - y) / 34, 0.05, 1);
    }
    hud(); controls(); card(); done(); hint();
  }

  function turnIdx() { return V.seats.indexOf(S.turn); }

  function hud() {
    $('ogHole').textContent = `⛳ ${V.hole}/${V.holes} · ${V.name} · par ${V.par}`;
    const t = turnIdx(), who = $('ogWho');
    if (V.between || t < 0) { who.textContent = ''; }
    else { who.textContent = t === V.me ? '🚀 Your shot' : `${nameOf(t)} is aiming`; who.style.color = t === V.me ? '' : colorOf(t); }
    $('ogStroke').textContent = V.me != null ? (V.done[V.me] ? `✓ ${V.strokes[V.me]} on this hole` : `Stroke ${V.strokes[V.me] + 1}`) : '';
  }

  function controls() {
    if (!V) return;
    const go = canLaunch();
    $('ogGo').disabled = !go;
    $('ogGo').classList.toggle('og-ready', go);
    $('ogCtl').classList.toggle('og-off', !myTurn());
    const p = $('ogPow'); if (p) p.style.height = `${Math.round(power * 100)}%`;
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
      : myTurn() ? 'Drag back like a slingshot and let go: the pull sets the direction and power. Planets will bend it.'
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
    return { V, fly, probes, now, preview: canLaunch() || drag ? preview() : null, aim: { angle, power }, dragging: !!drag };
  }

  function events(now) {
    if (!anim) return;
    const sh = anim.shot, tp = (now - anim.t0) / 1000 * V.geo.play;
    while (anim.ev < sh.events.length && sh.events[anim.ev][0] <= tp) {
      const [, kind, x] = sh.events[anim.ev++];
      const pan = clamp(x / 13, -1, 1), mine = sh.o === V.me;
      if (kind === 'bump') SND.bump(pan);
      else if (kind === 'rock') SND.rock(pan);
      else if (kind === 'warp') SND.warp();
      else if (kind === 'lip') { SND.lip(); if (mine) pop('Lipped out!', '#ffb0b0'); }
      else if (kind === 'cup') {
        SND.cup(); if (mine) ctx.buzz?.([30, 40, 60]);
        const s = sh.strokes, p = V.par, word = s === 1 ? '🌟 HOLE IN ONE!' : s <= p - 2 ? '🦅 Eagle!' : s === p - 1 ? '🐦 Birdie!' : s === p ? 'Par' : s === p + 1 ? 'Bogey' : `${s} strokes`;
        if (mine || s < p) pop(`${word}`, s < p ? '#ffd23f' : '#fff');
      } else if (kind === 'black') { SND.black(); if (mine) pop('🕳 Swallowed! +1', '#ff9a9a'); }
      else if (kind === 'out') { SND.out(); if (mine) pop('🛰 Lost in space! +1', '#ff9a9a'); }
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
    const idle = !anim && !drag && !(gl || flat)?.moving?.();
    if (idle && now - lastDraw < 50) return;
    lastDraw = now;
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
    let fabric = null, planets = [], bh = [], wormMeshes = [], cupG = null;
    // the course: a grid of space-time that dips into every planet's gravity well, then the bodies on top
    function build() {
      const key = `${V.hole}:${JSON.stringify(V.cup)}`; if (key === builtFor) return; builtFor = key;
      course.traverse((m) => { if (m !== course) { m.geometry?.dispose(); if (m.material && !m.material.shared) { m.material.map?.dispose?.(); m.material.dispose?.(); } } });
      while (course.children.length) course.remove(course.children[0]);
      planets = []; bh = []; wormMeshes = [];
      const G = V.geo, X = G.xMax, Y = G.yMax, sx = low ? 26 : 52, sy = low ? 38 : 76;
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
      // the course edge
      const edge = new T.LineLoop(new T.BufferGeometry().setFromPoints([W(-X, -Y), W(X, -Y), W(X, Y), W(-X, Y)]), new T.LineBasicMaterial({ color: 0x6a8aff, transparent: true, opacity: 0.5 }));
      course.add(edge);
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
      V.rocks.forEach(([x, y], k) => { const m = new T.Mesh(rockG, rockM); m.position.copy(W(x, y, 0)); m.rotation.set(k, k * 2, k * 3); m.scale.set(1, 0.8 + (k % 3) * 0.15, 1.1); m.castShadow = !low; course.add(m); planets.push(m); m.userData.spin = 0.5; });
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
    const sparks = [];
    function burst(kind, e, col) {
      const p = W(e[2], e[3], 0.3), n = kind === 'cup' ? 50 : kind === 'warp' ? 30 : kind === 'black' ? 24 : 10, c = kind === 'cup' ? 0x5affb0 : kind === 'warp' ? 0xc08aff : kind === 'black' ? 0xff9a4a : new T.Color(col).getHex();
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
      // the camera: up behind the tee, fitted so the whole course shows on a narrow phone or a wide screen
      const G = V.geo, asp = camera.aspect, fovR = 45 * Math.PI / 180;
      const needH = (2 * G.yMax + 4) * 0.7, needW = 2 * G.xMax + 4;
      const dist = Math.max(needH / 2 / Math.tan(fovR / 2), needW / 2 / Math.tan(fovR / 2) / asp) * 1.05;
      const tilt = 0.95;      // radians from the horizon
      camera.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist - 1);
      if (Math.abs(camera.fov - 45) > 0.01) { camera.fov = 45; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(0, -1.5, 0.5);
      stg.follow(camera);
      moving = sparks.length ? 1 : 0;
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

  // ---------- flat fallback: the course from above
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the course.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [], k = 1, cx = 0, cy = 0;
    const stars = Array.from({ length: 120 }, () => [Math.random(), Math.random(), Math.random()]);
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    function draw(now, sc) {
      const G = V.geo;
      k = Math.min((w - 12) / (2 * G.xMax), (h - 70) / (2 * G.yMax)); cx = w / 2; cy = h / 2 + 22;
      g.fillStyle = '#05060f'; g.fillRect(0, 0, w, h);
      for (const [a, b, c] of stars) { g.fillStyle = `rgba(255,255,255,${0.2 + c * 0.6})`; g.fillRect(a * w, b * h, 1.5, 1.5); }
      g.strokeStyle = '#3a6aff66'; g.lineWidth = 1; g.strokeRect(X(-G.xMax), Y(G.yMax), 2 * G.xMax * k, 2 * G.yMax * k);
      for (const [x, y, r, look] of V.planets) {
        const [c1, c2] = PLANET[look % PLANET.length];
        const gr = g.createRadialGradient(X(x - r * 0.3), Y(y + r * 0.3), r * k * 0.1, X(x), Y(y), r * k); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.beginPath(); g.arc(X(x), Y(y), r * k, 0, 7); g.fillStyle = gr; g.fill();
      }
      for (const [x, y] of V.blacks) { const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), G.bhR * 3.5 * k); gr.addColorStop(0, '#000'); gr.addColorStop(0.28, '#000'); gr.addColorStop(0.35, '#ffd0a0'); gr.addColorStop(0.6, '#ff6a2a88'); gr.addColorStop(1, '#ff6a2a00'); g.fillStyle = gr; g.beginPath(); g.arc(X(x), Y(y), G.bhR * 3.5 * k, 0, 7); g.fill(); }
      g.fillStyle = '#8a7a6a'; for (const [x, y] of V.rocks) { g.beginPath(); g.arc(X(x), Y(y), G.rock * k, 0, 7); g.fill(); }
      for (const [x, y] of V.worms) { g.save(); g.translate(X(x), Y(y)); g.rotate(now / 400); g.strokeStyle = '#c08aff'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, G.worm * k * (0.4 + i * 0.3), i, i + 4); g.stroke(); } g.restore(); }
      g.beginPath(); g.arc(X(V.cup[0]), Y(V.cup[1]), G.cupR * k, 0, 7); g.fillStyle = '#5affb033'; g.fill(); g.strokeStyle = '#5affb0'; g.lineWidth = 2; g.stroke();
      if (sc.fly) {
        g.strokeStyle = colorOf(sc.fly.o); g.lineWidth = 2; g.beginPath(); let first = true;
        for (const q of sc.fly.path) { if (q[0] > sc.fly.tp) break; if (first || q[3]) { g.moveTo(X(q[1]), Y(q[2])); first = false; } else g.lineTo(X(q[1]), Y(q[2])); }
        g.lineTo(X(sc.fly.xy[0]), Y(sc.fly.xy[1])); g.stroke();
      }
      if (sc.preview) { g.fillStyle = '#fff'; for (const [x, y] of sc.preview) { g.beginPath(); g.arc(X(x), Y(y), 2, 0, 7); g.fill(); } }
      if (sc.preview && V.me != null) {
        const [x, y] = V.pos[V.me], a = sc.aim.angle * Math.PI / 180, L = 0.6 + sc.aim.power * 3;
        g.strokeStyle = `hsl(${120 - 120 * sc.aim.power},100%,55%)`; g.lineWidth = 3; g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(x - Math.sin(a) * L), Y(y - Math.cos(a) * L)); g.stroke();
      }
      for (const p of sc.probes) {
        let s = 1; if (sc.fly && sc.fly.o === p.i && (sc.fly.result === 'black' || sc.fly.result === 'out') && sc.fly.end - sc.fly.tp < 0.4) s = Math.max(0.1, (sc.fly.end - sc.fly.tp) / 0.4);
        g.beginPath(); g.arc(X(p.xy[0]), Y(p.xy[1]), Math.max(3, G.probe * 1.6 * k) * s * (p.turn && !sc.fly ? 1 + 0.15 * Math.sin(now / 160) : 1), 0, 7); g.fillStyle = p.color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      }
      sparks = sparks.filter((s) => now < s.t + 700);
      for (const s of sparks) { const u = (now - s.t) / 700; g.beginPath(); g.arc(X(s.x), Y(s.y), 5 + u * 40, 0, 7); g.lineWidth = 3 * (1 - u); g.strokeStyle = s.c; g.stroke(); }
    }
    return {
      draw, resize, moving: () => sparks.length > 0,
      burst(kind, e, col) { sparks.push({ x: e[2], y: e[3], t: performance.now(), c: kind === 'cup' ? '#5affb0' : kind === 'warp' ? '#c08aff' : col }); },
      pick(px, py) { const r = canvas.getBoundingClientRect(); return [(px - r.left - cx) / k, -(py - r.top - cy) / k]; },
      dispose() { canvas.remove(); },
    };
  }

  const turnText = (s) => (s.phase === 'playing' && s.orbit ? `🪐 Hole ${s.orbit.hole} of ${s.orbit.holes} · par ${s.orbit.par}` : null);
  return { mount, unmount, render, turnText, focus: true };
})();
