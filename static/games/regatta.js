// Regatta: a sailing race in 3D (three.js) or flat from above. The server sails the lake 30 times a second and streams
// it (fast()); the page carries each boat on along its heading between packets. Steer by dragging sideways on the
// lake (or ← → / A D, or hold ◀ ▶); ⟲ Tack (Space / T) turns you through the wind.
UI.regatta = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null, keyFn = null, keyUp = null;
  let steer = 0, drag = null, keys = new Set(), lastSent = 0, sentSteer = 0, lastSeq = -1, flash = null, sideAt = 0, holdBtn = 0;
  // #150: drag points the boat: goal = the heading you pointed at (shown as a white arrow until the boat gets there)
  let goal = null, goalShow = 0, sentHead = null, headAt = 0;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const V = () => S?.regatta;
  const me = () => V()?.me;
  const nameOf = (i) => ctx?.player(V()?.seats[i])?.name ?? '?';
  const colorOf = (i) => ctx?.player(V()?.seats[i])?.color ?? '#ccc';
  const playing = () => S?.phase === 'playing' && me() != null && snap?.st === 'race' && !snap.b[me()][5];

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; steer = 0; drag = null; keys = new Set(); lastSeq = -1; flash = null; holdBtn = 0; goal = null; sentHead = null;
    main.innerHTML = `<div class="rg"><div class="rg-stage" id="rgStage">
        <div class="rg-hud"><span id="rgPos"></span><span id="rgClock" class="rg-clock"></span></div>
        <div class="rg-sub"><span id="rgNext"></span><span id="rgSpd"></span></div>
        <canvas class="rg-map" id="rgMap" width="120" height="120"></canvas>
        <div class="rg-warn" id="rgWarn" hidden></div>
        <div class="rg-count" id="rgCount" hidden></div>
        <div class="rg-flash" id="rgFlash" hidden></div>
        <div class="rg-done" id="rgDone" hidden><h3 id="rgDoneTitle"></h3><div id="rgStand"></div></div>
      </div>
      <div class="rg-ctl"><button id="rgL" aria-label="Steer left">◀</button><button class="rg-tack" id="rgTack">⟲ Tack</button><button id="rgR" aria-label="Steer right">▶</button></div>
      <p id="rgHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>⛵ Fleet</h3><div id="rgSeats" class="rg-seats"></div></div>';
    const hold = (el, dir) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); holdBtn = dir; update(true); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { if (holdBtn === dir) { holdBtn = 0; update(true); } });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold($('rgL'), 1); hold($('rgR'), -1);
    $('rgTack').addEventListener('click', tack);
    const stage = $('rgStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .rg-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      const m = myBoat();
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
    if (s) { goal = null; sentHead = null; }   // ◀ ▶ and the keys steer by rate, as before
    if (!playing()) return;
    const now = performance.now();
    if (force || (Math.abs(steer - sentSteer) > 0.06 && now - lastSent > 60)) {
      sentSteer = steer; lastSent = now;
      ctx.input({ steer: +steer.toFixed(3) }, force);
    }
  }
  function tack() {
    if (!playing()) return;
    goal = null; sentHead = null; if (drag) drag.dead = true;   // a tack takes the helm; lift your finger to point again
    ctx.input({ tack: true }, true); SND.luff(); ctx.buzz?.(10);
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
    snap = { st: d.st, race: d.race, go: d.go, rt: d.rt, gr: d.gr, nx: d.nx, w: d.w, g: d.g, b: d.b };
    gotAt = performance.now();
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
  }

  // where each boat is now: the last packet carried on along its heading
  function boats(now) {
    if (!snap) return [];
    const dt = snap.st === 'race' ? Math.min(0.15, (now - gotAt) / 1000) : 0;
    return snap.b.map((b, i) => ({ i, x: b[0] + Math.cos(b[2]) * b[3] * dt, y: b[1] + Math.sin(b[2]) * b[3] * dt, h: b[2], v: b[3], mark: b[4], place: b[5], irons: !!b[6], shadow: !!b[7], gust: !!b[8], pts: b[9], steer: b[10], color: colorOf(i) }));
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
    const warn = $('rgWarn'), w = m && !m.place && snap.st === 'race' ? (m.irons ? '⚠ In irons! Turn away from the wind' : m.shadow ? '🌫 In a rival\'s wind shadow' : '') : '';
    warn.hidden = !w; if (w && warn.textContent !== w) warn.textContent = w;
    const cnt = $('rgCount');
    if (S.phase === 'playing' && snap.st === 'countdown') { const c = Math.ceil(snap.go - el); const txt = c > 0 ? String(c) : 'GO!'; if (cnt.textContent !== txt) { cnt.textContent = txt; if (c > 0) ctx.sfx?.('tick'); } cnt.hidden = false; }
    else cnt.hidden = true;
    const fl = $('rgFlash');
    if (flash && now < flash.until) { if (fl.textContent !== flash.text) { fl.textContent = flash.text; fl.classList.remove('rg-in'); void fl.offsetWidth; fl.classList.add('rg-in'); } fl.hidden = false; } else fl.hidden = true;
    $('rgTack').disabled = !playing();
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
    if (goal != null && m && !drag && Math.abs(wrap(goal - m.h)) < 0.04 && now - goalShow > 800) goal = null;   // got there: hide the arrow (the boat holds the heading)
    (gl || flat)?.draw(now, { bs, m, snap, V: V(), nav: m && !m.place && snap.st !== 'results' ? navOf(m) : null, goal, dragging: !!drag });
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
    const low = stg.low;
    scene3.fog = new T.Fog(0xcfe6fa, 120, 520);
    const W = (x, y, h = 0) => new T.Vector3(x, h, -y);
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
    // the lake: blue water with little wave crests that drift with the wind
    const waveTex = tex(256, 256, (g, w) => {
      g.fillStyle = '#2a6aa8'; g.fillRect(0, 0, w, w);
      for (let k = 0; k < 220; k++) { const x = Math.random() * w, y = Math.random() * w, l = 6 + Math.random() * 14; g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.18})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2, x + l, y); g.stroke(); }
      for (let k = 0; k < 24; k++) { g.fillStyle = `rgba(10,40,80,${Math.random() * 0.06})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * w, 10 + Math.random() * 30, 0, 7); g.fill(); }
    });
    waveTex.wrapS = waveTex.wrapT = T.RepeatWrapping; waveTex.repeat.set(60, 60);
    const water = new T.Mesh(new T.PlaneGeometry(1400, 1400), std(0xffffff, { map: waveTex, roughness: 0.18, metalness: 0.15 }));
    water.rotation.x = -Math.PI / 2; water.position.z = -60; water.receiveShadow = true; scene3.add(water);
    // shores far off: green hills round the lake
    const hillMat = std(0x4a7a3a, { roughness: 0.95 }), hillG = new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let k = 0; k < (low ? 14 : 26); k++) { const a = k / (low ? 14 : 26) * Math.PI * 2, d = 330 + (k % 3) * 40, m = new T.Mesh(hillG, hillMat); m.scale.set(60 + (k % 4) * 20, 20 + (k % 5) * 9, 50); m.position.set(Math.cos(a) * d, -2, -60 + Math.sin(a) * d); scene3.add(m); }
    // gust patches: dark ruffled water
    const gustMat = new T.MeshBasicMaterial({ color: 0x0a2a50, transparent: true, opacity: 0.28, depthWrite: false });
    const gustMs = [];
    // buoys, the next one with a beacon
    const buoyG = new T.Group(); scene3.add(buoyG);
    const orange = std(0xff7a1a, { roughness: 0.4 }), gold = std(0xffd23f, { roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.4 });
    const buoys = [];
    const beacon = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 30, 10, 1, true), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, depthWrite: false, blending: T.AdditiveBlending }));
    beacon.position.y = 15; scene3.add(beacon);
    const zone = new T.Mesh(new T.RingGeometry(V().markR - 0.4, V().markR, 48), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.4, depthWrite: false }));
    zone.rotation.x = -Math.PI / 2; zone.position.y = 0.05; scene3.add(zone);
    const label = (text) => { const t = tex(64, 64, (g, w) => { g.font = '800 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.strokeStyle = '#0008'; g.lineWidth = 6; g.strokeText(text, w / 2, w / 2); g.fillText(text, w / 2, w / 2); }); const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(3, 3, 1); return s; };
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
        buoyG.add(g); buoys.push({ g, body, top });
      });
      // the finish line: two flag poles and a dotted line between them
      const [[x0, y0], [x1]] = v.course.finish;
      for (const x of [x0, x1]) {
        const pole = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 6, 6), std(0xeeeeee)); pole.position.copy(W(x, y0, 3)); lineG.add(pole);
        const flag = new T.Mesh(new T.PlaneGeometry(1.6, 1.0), new T.MeshBasicMaterial({ map: tex(64, 40, (g, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); } }), side: T.DoubleSide }));
        flag.position.copy(W(x + (x < 0 ? 0.8 : -0.8), y0, 5.4)); lineG.add(flag);
      }
      for (let x = x0 + 2; x < x1 - 1; x += 3) { const d = new T.Mesh(new T.SphereGeometry(0.25, 6, 4), std(0xffffff)); d.position.copy(W(x, y0, 0.2)); lineG.add(d); }
    }
    // boats: a hull with a pointed bow, a mast, a mainsail in the sailor's colour and a white jib
    const hullShape = new T.Shape(); hullShape.moveTo(-2.4, -0.9); hullShape.lineTo(1.2, -0.9); hullShape.quadraticCurveTo(2.6, -0.4, 2.9, 0); hullShape.quadraticCurveTo(2.6, 0.4, 1.2, 0.9); hullShape.lineTo(-2.4, 0.9); hullShape.closePath();
    const hullGeo = new T.ExtrudeGeometry(hullShape, { depth: 0.7, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    hullGeo.rotateX(Math.PI / 2); hullGeo.translate(0, 0.45, 0);
    const deckMat = std(0xf4f4f0, { roughness: 0.35 });
    function sailGeo(foot, luff, back = 0) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, -foot, 0, 0, -back, luff, 0], 3)); g.computeVertexNormals(); return g; }
    const boatMs = [];
    function boatFor(i, color) {
      if (boatMs[i]) return boatMs[i];
      const g = new T.Group();
      const roll = new T.Group(); g.add(roll);
      const hull = new T.Mesh(hullGeo, std(new T.Color(color), { roughness: 0.4 })); hull.castShadow = true; roll.add(hull);
      const deck = new T.Mesh(new T.BoxGeometry(3.6, 0.08, 1.5), deckMat); deck.position.set(-0.3, 0.6, 0); roll.add(deck);
      const mast = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 7.5, 6), std(0xdddddd, { metalness: 0.5, roughness: 0.3 })); mast.position.set(0.6, 4.3, 0); roll.add(mast);
      const boomPivot = new T.Group(); boomPivot.position.set(0.6, 1.2, 0); roll.add(boomPivot);
      const boom = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 3.2, 5), std(0xbbbbbb)); boom.rotation.z = Math.PI / 2; boom.position.x = -1.6; boomPivot.add(boom);
      const main = new T.Mesh(sailGeo(3.1, 6.6, 0.15), new T.MeshStandardMaterial({ color: new T.Color(color).lerp(new T.Color(0xffffff), 0.35), roughness: 0.8, side: T.DoubleSide })); main.castShadow = !low; boomPivot.add(main);
      const jibPivot = new T.Group(); jibPivot.position.set(2.5, 0.8, 0); roll.add(jibPivot);
      const jib = new T.Mesh(sailGeo(1.9, 5.6, 1.9), new T.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.8, side: T.DoubleSide })); jibPivot.add(jib);
      const wake = new T.Mesh(new T.PlaneGeometry(10, 2.4), new T.MeshBasicMaterial({ map: tex(128, 32, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.7)'); c.fillStyle = gr; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h * 0.35); c.lineTo(w, h * 0.65); c.lineTo(0, h); c.fill(); }), transparent: true, depthWrite: false }));
      wake.rotation.x = -Math.PI / 2; wake.position.set(-7, 0.06, 0); g.add(wake);
      const tag = label('▼'); tag.scale.set(2.2, 2.2, 1); tag.position.y = 9.2; tag.material.color.set(color); g.add(tag);
      scene3.add(g);
      return (boatMs[i] = { g, roll, boomPivot, jibPivot, wake, tag });
    }

    // #150 guides round your own boat: the no-go wedge (red, into the wind) with a wind chevron, a gold arrow to the
    // next buoy and a white arrow for the heading you pointed at. All lie flat on the water; course angle = rotation.y.
    const flatMesh = (geo, mat) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; return m; };
    const arrowGeo = (len, wid, head) => { const sh = new T.Shape(); sh.moveTo(0, -wid / 2); sh.lineTo(len - head, -wid / 2); sh.lineTo(len - head, -wid * 1.6); sh.lineTo(len, 0); sh.lineTo(len - head, wid * 1.6); sh.lineTo(len - head, wid / 2); sh.lineTo(0, wid / 2); sh.closePath(); return new T.ShapeGeometry(sh); };
    const NOGO = (V().nogo || 38) * Math.PI / 180;
    const wedge = new T.Group(); wedge.position.y = 0.07; scene3.add(wedge);
    const wedgeMat = new T.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, fog: false });
    wedge.add(flatMesh(new T.CircleGeometry(13, 24, -NOGO, 2 * NOGO), wedgeMat));
    const windMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, fog: false });
    for (const r of [8.5, 11.5]) { const ch = flatMesh(arrowGeo(2.2, 0.35, 1.0), windMat); ch.position.x = r; ch.rotation.z = Math.PI; wedge.add(ch); }   // chevrons blowing toward you
    const toMark = new T.Group(); scene3.add(toMark);
    const markArrowMat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false });
    const markArrow = flatMesh(arrowGeo(4.2, 0.7, 1.7), markArrowMat); markArrow.position.set(4.5, 0, 0); toMark.add(markArrow);
    markArrow.renderOrder = 3;
    toMark.position.y = 0.1;
    const aim = new T.Group(); aim.position.y = 0.12; scene3.add(aim);
    const aimMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false });
    const aimArrow = flatMesh(arrowGeo(9.5, 0.3, 1.6), aimMat); aimArrow.position.x = 3.2; aimArrow.renderOrder = 4; aim.add(aimArrow);

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0;
    const cam = { yaw: Math.PI / 2, pos: new T.Vector3(0, 40, 60), look: new T.Vector3(), init: false };

    function draw(now, sc) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const v = sc.V; course(v);
      const wdir = sc.snap.w[0], to = wdir + Math.PI;
      // waves drift downwind
      waveTex.offset.x += Math.cos(to) * dt * 0.012; waveTex.offset.y += Math.sin(to) * dt * 0.012;
      while (gustMs.length < sc.snap.g.length) { const m = new T.Mesh(new T.CircleGeometry(1, 40), gustMat); m.rotation.x = -Math.PI / 2; scene3.add(m); gustMs.push(m); }
      gustMs.forEach((m, k) => { const gg = sc.snap.g[k]; m.visible = !!gg; if (gg) { m.position.copy(W(gg[0], gg[1], 0.04)); m.scale.setScalar(gg[2]); } });
      const myMark = sc.m ? sc.m.mark : 0;
      buoys.forEach((b, n) => { const next = n === myMark; b.body.material = next ? gold : orange; b.top.material = next ? gold : orange; });
      const nm = v.course.marks[myMark];
      beacon.visible = zone.visible = !!nm && !!sc.m && !sc.m.place;
      if (nm) { beacon.position.copy(W(nm[0], nm[1], 15)); zone.position.copy(W(nm[0], nm[1], 0.05)); beacon.material.opacity = 0.18 + 0.1 * Math.sin(now / 300); }
      for (const b of sc.bs) {
        const m = boatFor(b.i, b.color);
        m.g.position.copy(W(b.x, b.y, 0)); m.g.rotation.y = b.h;
        const off = wrap(b.h - wdir), twa = Math.abs(off);
        // the sails swing out to the side away from the wind, further the more the wind is behind
        const ang = clamp(twa / 2, 0.12, 1.4) * (off > 0 ? -1 : 1);
        const flap = b.irons ? Math.sin(now / 60 + b.i) * 0.35 : 0;
        m.boomPivot.rotation.y = ang + flap; m.jibPivot.rotation.y = ang * 0.8 + flap;
        // heel: lean away from the wind, most on a close reach at speed
        m.roll.rotation.x = -(off > 0 ? 1 : -1) * clamp(b.v / 7, 0, 1) * Math.sin(Math.min(twa, 2.4)) * 0.28 + Math.sin(now / 700 + b.i) * 0.03;
        m.roll.position.y = Math.sin(now / 500 + b.i * 2) * 0.08;
        m.wake.material.opacity = clamp(b.v / 8, 0, 0.4); m.wake.scale.x = 0.4 + b.v / 10;
        m.tag.visible = b.i !== me();
      }
      const mine = sc.m && !sc.m.place && sc.snap.st !== 'results';
      wedge.visible = toMark.visible = !!mine;
      aim.visible = !!mine && sc.goal != null;
      if (mine) {
        const pos = W(sc.m.x, sc.m.y);
        wedge.position.set(pos.x, 0.07, pos.z); wedge.rotation.y = wdir;
        const twa = Math.abs(wrap(sc.m.h - wdir));
        const near = sc.m.irons ? 1 : clamp((NOGO + 0.2 - twa) / 0.2, 0, 1);
        wedgeMat.color.setHex(sc.m.irons ? 0xff2a2a : near > 0 ? 0xffa030 : 0xff3a3a);
        wedgeMat.opacity = 0.28 + 0.2 * near * (0.6 + 0.4 * Math.sin(now / 120));
        windMat.opacity = 0.6 + 0.25 * Math.sin(now / 400);
        if (sc.nav) { toMark.position.set(pos.x, 0.1, pos.z); toMark.rotation.y = sc.nav.bt; markArrowMat.opacity = 0.8 + 0.2 * Math.sin(now / 250); }
        toMark.visible = !!sc.nav;
        if (sc.goal != null) { aim.position.set(pos.x, 0.12, pos.z); aim.rotation.y = sc.goal; }
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
      stg.follow(camera);
      renderer.render(scene3, camera);
    }
    return {
      draw, resize,
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the whole course from above, north up
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the lake.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    function draw(now, sc) {
      const v = sc.V, M = v.course.marks;
      const xs = [...M.map((m) => m[0]), -35, 35], ys = [...M.map((m) => m[1]), -24];
      const x0 = Math.min(...xs) - 15, x1 = Math.max(...xs) + 15, y0 = Math.min(...ys) - 10, y1 = Math.max(...ys) + 15;
      const k = Math.min(w / (x1 - x0), (h - 70) / (y1 - y0)), ox = (w - (x1 - x0) * k) / 2, oy = 62;
      const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y1 - y) * k;
      g.fillStyle = '#2a6aa8'; g.fillRect(0, 0, w, h);
      for (const [gx, gy, gr] of sc.snap.g) { g.beginPath(); g.arc(X(gx), Y(gy), gr * k, 0, 7); g.fillStyle = '#0a2a5044'; g.fill(); }
      const my = sc.m ? sc.m.mark : 0;
      M.forEach(([x, y], n) => { if (n === my) { g.beginPath(); g.arc(X(x), Y(y), v.markR * k, 0, 7); g.strokeStyle = '#ffd23f88'; g.lineWidth = 2; g.stroke(); } g.beginPath(); g.arc(X(x), Y(y), Math.max(4, 1.2 * k), 0, 7); g.fillStyle = n === my ? '#ffd23f' : '#ff7a1a'; g.fill(); g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(String(n + 1), X(x) + 7, Y(y) + 4); });
      const [[fx0, fy], [fx1]] = v.course.finish; g.setLineDash([4, 4]); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(fx0), Y(fy)); g.lineTo(X(fx1), Y(fy)); g.stroke(); g.setLineDash([]);
      if (sc.m && !sc.m.place && sc.snap.st !== 'results') {
        const bx = X(sc.m.x), by = Y(sc.m.y), from = sc.snap.w[0], ng = (v.nogo || 38) * Math.PI / 180, R = Math.max(30, 11 * k);
        g.fillStyle = sc.m.irons ? '#ff2a2a55' : '#ff3a3a33'; g.beginPath(); g.moveTo(bx, by); g.arc(bx, by, R, -from - ng, -from + ng); g.closePath(); g.fill();
        if (sc.nav) { g.strokeStyle = '#ffd23fcc'; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(bx, by); g.lineTo(X(sc.nav.tx), Y(sc.nav.ty)); g.stroke(); g.setLineDash([]); }
        if (sc.goal != null) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(sc.goal) * R * 1.1, by - Math.sin(sc.goal) * R * 1.1); g.stroke(); }
      }
      for (const b of sc.bs) {
        const s = Math.max(6, 3 * k);
        g.save(); g.translate(X(b.x), Y(b.y)); g.rotate(-b.h);
        g.fillStyle = b.color; g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.8, s * 0.45); g.lineTo(-s * 0.8, -s * 0.45); g.closePath(); g.fill();
        const off = wrap(b.h - sc.snap.w[0]), ang = clamp(Math.abs(off) / 2, 0.12, 1.4) * (off > 0 ? -1 : 1);
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(s * 0.2, 0); g.lineTo(s * 0.2 - Math.cos(ang) * s, Math.sin(ang) * s); g.stroke();
        if (b.i === me()) { g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, s * 1.3, 0, 7); g.stroke(); }
        g.restore();
      }
    }
    return { draw, resize, dispose() { canvas.remove(); } };
  }

  const turnText = (s) => (s.phase === 'playing' && s.regatta ? `⛵ Race ${s.regatta.race} of ${s.regatta.races}` : null);
  const myMove = (s) => s.phase === 'playing' && s.regatta?.me != null && s.regatta.st === 'race';
  return { mount, unmount, render, fast, turnText, myMove, focus: true };
})();
