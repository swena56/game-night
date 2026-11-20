// Paper Boat Rapids: the server owns the river; this module draws it in 3D (three.js) or as a flat top-down strip,
// glides the boats between updates using their speed, and sends steering, paddles and the brace.
// Controls: drag sideways anywhere to steer (a quick tap paddles), the 🛶 button (tap: paddle, hold: brace),
// or ←/→ / A/D to steer, Space to paddle, ↓ / S / Shift to brace.
// The course arrives once in the view in river coordinates (s downstream, x across); the bends, the water level
// at each waterfall and the widths are worked out here the same way for drawing.
// The server sends paddles, rock hits, waterfalls, bumps, sinks, refolds, pickups and finishes as numbered events ("ev").
UI.rapids = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null, C = null, courseSeed = null;
  let keyDown = null, keyUp = null, drag = null, steer = 0, sentAt = 0, keys = new Set(), braceKey = false;
  let three = 'loading', lastSeq = -1, flash = null, holdT = 0, holdAt = 0, braced = false, lastCd = 0, sideAt = 0, shown = [];
  const STICK_PX = 70, HOLD_MS = 260;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; drag = null; steer = 0; keys = new Set(); lastSeq = -1; flash = null;
    holdAt = 0; braced = false; braceKey = false; C = null; courseSeed = null; shown = [];
    main.innerHTML = `<div class="rp"><div class="rp-stage" id="rpStage">
        <div class="rp-hud"><span id="rpPlace"></span><span id="rpClock"></span></div>
        <div class="rp-prog" id="rpProg"></div>
        <div class="rp-sog" id="rpSog" hidden><i></i><b></b></div>
        <div class="lr-banner" id="rpBanner" hidden></div>
        <div class="lr-banner small rp-flash" id="rpFlash" hidden></div>
        <div class="rp-res" id="rpRes" hidden></div>
        <div class="rp-stick" id="rpStick" hidden><span></span></div></div>
      <div class="rp-bar"><span id="rpInfo" class="hint"></span><button id="rpPaddle" class="primary">🛶 Paddle</button></div></div>`;
    side.innerHTML = `<div class="panel"><div id="rpSeats"></div>
      <p class="hint left">Drag sideways to steer, tap to paddle. Hold 🛶 to brace in white water. Keyboard: ←/→, Space, ↓.</p></div>`;
    main.querySelector('.rp').style.touchAction = 'none';
    const btn = $('rpPaddle');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch {} press(); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); release(); });
    btn.addEventListener('pointercancel', () => release(true));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = $('rpStage');
    stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      showStick(e.clientX, e.clientY, 0);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = e.clientX - drag.x;
      if (Math.abs(dx) > 8 || Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
      dx = Math.max(-STICK_PX, Math.min(STICK_PX, dx));
      showStick(drag.x, drag.y, dx);
      setSteer(dx / STICK_PX);
    });
    const up = () => {
      if (!drag) return;
      if (!drag.moved && performance.now() - drag.at < 300) paddle();
      drag = null; $('rpStick').hidden = true;
      setSteer(0, true);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) { e.preventDefault(); keys.add(e.code); keySteer(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) paddle(); }
      else if (['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'].includes(e.code)) { e.preventDefault(); if (!braceKey) { braceKey = true; setBrace(true); } }
    };
    keyUp = (e) => {
      if (keys.delete(e.code)) keySteer();
      else if (['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'].includes(e.code) && braceKey) { braceKey = false; setBrace(false); }
    };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    three = 'loading';
    GL3.load().then(() => { three = 'ok'; }).catch(() => { three = 'no'; }).finally(() => { if (stage.isConnected) ensureView(); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect(); clearTimeout(holdT);
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null; bedOn = false; window.Snd?.stopAll();
  }

  const V = () => S?.rapids;
  const me = () => V()?.me;
  const playing = () => me() != null && S.phase === 'playing';
  const colorOf = (i) => ctx.player(V().seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V().seats[i])?.name ?? '?';
  const ord = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

  function showStick(x, y, dx) {
    const st = $('rpStick'), box = $('rpStage').getBoundingClientRect();
    st.hidden = false;
    st.style.left = `${x - box.left}px`; st.style.top = `${y - box.top}px`;
    st.firstElementChild.style.transform = `translateX(${dx}px)`;
  }
  function keySteer() {
    let x = 0;
    for (const k of keys) x += k === 'ArrowLeft' || k === 'KeyA' ? -1 : 1;
    setSteer(Math.sign(x), true);
  }
  // screen-right is the river's +x (the camera always looks downstream)
  function setSteer(x, force = false) {
    steer = x;
    if (!playing()) return;
    const now = performance.now();
    if (!force && now - sentAt < 50) return;
    sentAt = now;
    ctx.input({ sx: +x.toFixed(3) }, force);
  }
  function paddle() { if (playing()) ctx.input({ paddle: true }, true); }
  function setBrace(on) { braced = on; if (playing()) ctx.input({ brace: on }, true); renderSide(); }
  function press() {
    if (!playing() || holdAt) return;
    holdAt = performance.now();
    holdT = setTimeout(() => { if (holdAt) setBrace(true); }, HOLD_MS);
  }
  function release(cancel = false) {
    if (!holdAt) return;
    clearTimeout(holdT);
    const quick = performance.now() - holdAt < HOLD_MS;
    holdAt = 0;
    if (braced && !braceKey) setBrace(false);
    else if (quick && !cancel) paddle();
  }

  // ---------- the course (river coordinates → the world)
  const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const gauss = (v, c, w) => Math.exp(-(((v - c) / w) ** 2));
  function buildCourse(c) {
    const SEG = c.seg, segs = c.segs, n = segs.length, ledges = segs.filter((g) => g.ledge != null).map((g) => g.ledge);
    const idx = (s) => Math.max(0, Math.min(n - 1, Math.floor(s / SEG)));
    const width = (s) => {
      const t = s / SEG - 0.5, i = Math.floor(t);
      const a = segs[Math.max(0, Math.min(n - 1, i))].w, b = segs[Math.max(0, Math.min(n - 1, i + 1))].w;
      return a + (b - a) * smooth(t - i);
    };
    const current = (s, x) => {
      const k = idx(s), g = segs[k];
      let u;
      if (g.t === 'rapids') {
        const s0 = k * SEG, inside = smooth(Math.min(x - g.band[0], g.band[1] - x) / 0.8 + 0.5) * smooth(Math.min(s - s0 - 1, s0 + SEG - 1 - s) / 2);
        u = 3.6 + 2 * inside;
      } else u = { rocks: 3.6, whirl: 3.4, drop: 3.8 }[g.t] ?? 3.2;
      if (g.t !== 'rapids') u += (g.t === 'calm' || g.t === 'sun' ? 1.3 : g.t === 'whirl' ? 1.0 : 0.8) * gauss(x, g.lane, 1.6);
      return u * (0.7 + 0.3 * Math.max(0, Math.min(1, (width(s) / 2 - Math.abs(x)) / 1.5)));
    };
    const white = (s, x) => {
      const k = idx(s), g = segs[k];
      return g.t === 'rapids' && x >= g.band[0] && x <= g.band[1] && s >= k * SEG + 1.5 && s <= k * SEG + SEG - 1.5;
    };
    const bend = (s) => c.bend.reduce((a, [amp, f, p]) => a + amp * Math.sin(f * s + p), 0);
    const slope = (s) => c.bend.reduce((a, [amp, f, p]) => a + amp * f * Math.cos(f * s + p), 0);
    const level = (s) => -ledges.reduce((a, l) => a + V().dropH * smooth((s - l) / 1.4), 0);
    // a point on the river: (s, x) → world [X, Y, Z]; downstream is −Z, +x is to the right looking downstream
    const at = (s, x, y = 0) => {
      const d = slope(s), m = Math.hypot(1, d);
      return [bend(s) + x / m, level(s) + y, -s + (x * d) / m];
    };
    const heading = (s) => Math.atan2(-slope(s), 1);   // the river's turn at s (yaw, radians)
    return { ...c, SEG, segs, n, idx, width, current, white, at, heading, level, ledges };
  }

  // the 3D view once three.js is in and the course is known; the flat strip if 3D can't run
  function ensureView() {
    const stage = $('rpStage');
    if (!stage || !C || gl || three === 'loading') return;
    if (three === 'ok' && !flat) gl = make3d(stage);
    if (!gl && !flat) flat = make2d(stage);
    flat?.resize();
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    const v = s.rapids;
    if (lastSeq < 0) lastSeq = v.seq ?? 0;   // don't replay what happened before we arrived
    if (courseSeed !== v.seed) {   // a new river (a new race): rebuild the scene
      courseSeed = v.seed; C = buildCourse(v.course); shown = [];
      if (gl) { gl.dispose(); gl = null; }
      ensureView();
    }
    take(v);
    renderSide();
  }

  function fast(d) {
    if (!V()) return;
    take(d);
    for (const e of d.ev || []) if (e[0] > lastSeq) { lastSeq = e[0]; onEvent(e); }
    const t = performance.now();
    if (t - sideAt > 250) { sideAt = t; renderSide(); }
  }


  // ---------- sound (#220): the shared Snd kit in an outdoor space. A river bed that follows the current and
  // white water (louder, hissier), a paddle dip, a hull thud on rocks, splashes sized by the drop, a gurgle
  // as a boat sinks, and a roar under each waterfall. (Never name a helper out, sfx, tone or noise.)
  const snd = (fn, delay) => window.Snd?.play(fn, delay);
  const OUT = { room: 'outdoor', send: 0.4 };
  const pan = (x) => Math.max(-0.8, Math.min(0.8, (x || 0) / 6));
  const riverBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lpf = A.createBiquadFilter(), g = A.createGain();
    const hiss = K.loopSrc('white'), hp = A.createBiquadFilter(), hg = A.createGain();
    lpf.type = 'lowpass'; lpf.frequency.value = 380; g.gain.value = 0;
    hp.type = 'highpass'; hp.frequency.value = 2400; hg.gain.value = 0;
    src.connect(lpf).connect(g); hiss.connect(hp).connect(hg).connect(g);
    g.connect(K.at({ ...OUT, send: 0.2 }));
    return {
      set(level, white) {
        const t = A.currentTime;
        g.gain.setTargetAtTime(level > 0 ? 0.05 + 0.1 * level : 0, t, 0.2);
        lpf.frequency.setTargetAtTime(300 + 500 * level, t, 0.2);
        hg.gain.setTargetAtTime(white ? 0.07 : 0.012, t, 0.25);
      },
      stop() { try { src.stop(); hiss.stop(); } catch {} },
    };
  };
  let bedOn = false;
  function river(level) {
    if (!(level > 0) && !bedOn) return;
    bedOn = level > 0;
    const b = window.Snd?.bed('rapids.river', riverBed);
    if (b) b.set(level, level > 0 && snap && me() != null && (snap.b[me()]?.[6] & 4));
  }
  const dip = (x) => snd((t, K) => {
    const d = K.at({ ...OUT, pan: pan(x), vol: 0.7 });
    K.burst(d, t, { type: 'bandpass', f: K.R(900, 1300), f1: 400, q: 0.9, vol: 0.22, tau: 0.09, dur: 0.25 });
    K.mode(d, t + 0.02, K.vary(190, 0.08), 0.1, 0.05);
  });
  const thud = (x, v = 1) => snd((t, K) => {
    const d = K.at({ ...OUT, pan: pan(x), vol: 0.8 * v });
    K.mode(d, t, K.vary(95, 0.06), 0.4, 0.06); K.mode(d, t, K.vary(230, 0.06), 0.12, 0.03);
    K.burst(d, t, { type: 'lowpass', f: 700, q: 0.7, vol: 0.3, tau: 0.04 });
  });
  const plash = (x, big) => snd((t, K) => {
    const d = K.at({ ...OUT, pan: pan(x), vol: big ? 1 : 0.7 });
    K.burst(d, t, { type: 'bandpass', f: K.R(1500, 2200), f1: 700, q: 0.8, vol: big ? 0.45 : 0.3, tau: big ? 0.35 : 0.18, dur: big ? 1 : 0.5 });
    K.burst(d, t + 0.03, { type: 'lowpass', f: 500, q: 0.7, vol: big ? 0.35 : 0.15, tau: big ? 0.3 : 0.1 });
  });
  const gurgle = (x) => snd((t, K) => {
    const d = K.at({ ...OUT, pan: pan(x) });
    for (let k = 0; k < 5; k++) K.sweep(d, t + k * 0.12, { f0: K.R(180, 260), f1: K.R(380, 520), dur: 0.12, vol: 0.12, type: 'sine', attack: 0.01 });
  });

  function take(d) {
    const was = snap?.st;
    snap = { st: d.st, race: d.race, go: d.go, rt: d.rt, gr: d.gr, nx: d.nx, b: d.b, pk: d.pk };
    gotAt = performance.now();
    Object.assign(V(), { st: d.st, b: d.b, pk: d.pk });
    if (was === 'countdown' && d.st === 'race') { ctx?.sfx?.('whoosh'); if (steer && playing()) ctx.input({ sx: steer }, true); }
    { const m = me(), b = m != null ? d.b[m] : null; river(d.st === 'race' && b && !b[9] ? Math.min(1, 0.3 + (b[2] || 0) / 9) : 0); }
    if (d.st !== 'race' && braced) { braced = false; holdAt = 0; }
  }

  function showFlash(text, ms = 1400) { flash = { text, until: performance.now() + ms }; }

  function onEvent(e) {
    const [, kind, ...a] = e, i = me();
    if (kind === 'paddle') {
      if (a[0] === i) { dip(0); ctx.buzz?.(8); }
      gl?.paddleFx(a[0]);
    } else if (kind === 'rock' || kind === 'ledge') {
      const [j, s, x] = a;
      if (j === i) { thud(x); ctx.buzz?.(40); gl?.shake(0.3); showFlash(kind === 'rock' ? '🪨 Rock! Soaked' : '🧱 Find a gap!', 900); }
      (gl || flat)?.splash(s, x, 16);
    } else if (kind === 'falls') {
      const [j, edge, s, x] = a;
      (gl || flat)?.splash(s, x, edge ? 34 : 14, edge);
      plash(x, edge);
      if (j === i) { if (edge) { ctx.buzz?.([30, 20, 50]); gl?.shake(0.35); showFlash('🌊 Shot the edge! Drenched', 1100); } }
    } else if (kind === 'bump') {
      const [j, k, s, x] = a;
      (gl || flat)?.splash(s, x, 10);
      if (j === i || k === i) { thud(x, 0.6); ctx.buzz?.(20); }
    } else if (kind === 'sink') {
      const [j, s, x] = a;
      (gl || flat)?.splash(s, x, 30);
      gurgle(x);
      if (j === i) { ctx.sfx?.('bad'); ctx.buzz?.([80, 40, 140]); showFlash('🧻 Soggy! Your boat sank', 2200); }
    } else if (kind === 'refold') {
      if (a[0] === i) { ctx.sfx?.('pop'); showFlash('📄 Refolded — off you go!', 1100); }
    } else if (kind === 'pick') {
      const [j, , kind2] = a;
      if (j === i) { ctx.sfx?.('pickup'); showFlash(kind2 === 'leaf' ? '🍃 Leaf sail!' : '☀️ Dry fold!', 900); }
    } else if (kind === 'spit') {
      if (a[0] === i) { ctx.sfx?.('whoosh'); showFlash('🌀 Spat out!', 900); }
    } else if (kind === 'finish') {
      const [j, place, t] = a;
      if (j === i) { ctx.sfx?.(place === 1 ? 'fanfare' : 'good'); ctx.buzz?.([40, 30, 40]); showFlash(`🏁 ${ord(place)}! ${t.toFixed(1)} s`, 2600); }
      else if (place === 1) ctx.sfx?.('cheer');
      gl?.confetti(j);
    }
  }

  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  // the current order: finished boats by place, then the rest by distance
  function order() {
    const v = V(), live = v.seats.map((_, i) => i).filter((i) => { const p = ctx.player(v.seats[i]); return p && !p.eliminated; });
    return live.sort((a, b) => (snap.b[a][9] || 99) - (snap.b[b][9] || 99) || snap.b[b][0] - snap.b[a][0]);
  }

  function renderSide() {
    const v = V(), box = $('rpSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    const ranked = order(), all = [...ranked, ...v.seats.map((_, i) => i).filter((i) => !ranked.includes(i))];
    for (const i of all) {
      const p = ctx.player(v.seats[i]), b = snap.b[i];
      const row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const tag = b[5] > 0 ? ' 🧻' : b[9] ? ` 🏁${ord(b[9])}` : b[6] & 8 ? ' 🌀' : '';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === v.me ? ' (you)' : ''}${tag}`),
        ctx.el('span', 'rp-soglet', `💧${Math.round(b[4])}%`));
      if (v.races > 1) row.append(ctx.el('b', '', `${b[10]}`));
      box.append(row);
    }
    const mine = v.me != null ? snap.b[v.me] : null, btn = $('rpPaddle');
    btn.parentElement.hidden = v.me == null;
    if (!mine) return;
    btn.disabled = snap.st !== 'race' || mine[5] > 0 || !!mine[9] || S.phase !== 'playing';
    btn.classList.toggle('rp-brace', braced);
    btn.textContent = braced ? '🛡️ Bracing' : `🛶 Paddle ${'●'.repeat(mine[7])}${'○'.repeat(Math.max(0, v.paddleMax - mine[7]))}`;
    $('rpInfo').textContent = mine[5] > 0 ? '🧻 Refolding…' : mine[6] & 8 ? '🌀 Whirlpool — paddle out!' : mine[6] & 4 ? (braced ? '🌊 White water (braced)' : '🌊 White water — hold to brace') : mine[6] & 16 ? '☀️ Drying in the sun' : mine[11] > 0 ? '🍃 Leaf sail!' : mine[6] & 32 ? '💨 Slipstream: you are riding their wake!' : '';
  }

  // where boat i is now: the last known position plus its speed since then (capped)
  function pos(i, now) {
    const b = snap.b[i];
    const t = snap.st === 'race' && !b[5] ? Math.min(0.15, (now - gotAt) / 1000) : 0;
    return [b[0] + b[2] * t, b[1] + b[3] * t];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !V() || !C) return;
    (gl || flat)?.draw(now);
    const v = V(), el = (now - gotAt) / 1000;
    const cd = snap.st === 'countdown' ? snap.go - el : 0;
    let text = '';
    if (S.phase === 'playing' && snap.st === 'countdown') text = cd > 0 ? String(Math.ceil(cd)) : 'GO!';
    const c = S.phase === 'playing' && snap.st === 'countdown' ? Math.ceil(cd) : 0;
    if (c !== lastCd) { if (c > 0 && c <= 3) ctx.sfx?.('tick'); lastCd = c; }
    $('rpBanner').hidden = !text; $('rpBanner').textContent = text;
    const mine = v.me != null ? snap.b[v.me] : null;
    let small = flash && now < flash.until ? flash.text : '';
    if (!small && mine && snap.st === 'race' && mine[5] > 0) small = `🧻 Refolding ${Math.max(0, mine[5] - el).toFixed(1)}`;
    if (!small && snap.st === 'race' && snap.gr >= 0 && mine && !mine[9]) small = `⏳ ${Math.ceil(Math.max(0, snap.gr - el))} s to finish`;
    $('rpFlash').hidden = !small; $('rpFlash').textContent = small;
    const rt = snap.st === 'race' ? snap.rt + el : snap.st === 'countdown' ? 0 : snap.rt;
    $('rpClock').textContent = `${v.races > 1 ? `Race ${snap.race}/${v.races} · ` : ''}⏱ ${clock(rt)}`;
    const ranked = order();
    $('rpPlace').textContent = mine ? `${ord(mine[9] || ranked.indexOf(v.me) + 1)} / ${ranked.length}` : '👀 Watching';
    // the sog meter
    const sog = $('rpSog');
    sog.hidden = !mine;
    if (mine) {
      sog.firstElementChild.style.height = `${mine[4]}%`;
      sog.lastElementChild.textContent = `${Math.round(mine[4])}%`;
      sog.classList.toggle('rp-wet', mine[4] >= 70);
    }
    // the progress strip: every boat's dot along the river
    const prog = $('rpProg');
    if (prog.childElementCount !== snap.b.length) {
      prog.innerHTML = '<span class="rp-flag">🏁</span>' + snap.b.map(() => '<i></i>').join('');
      [...prog.querySelectorAll('i')].forEach((d, i) => { d.style.background = colorOf(i); d.classList.toggle('rp-me', i === v.me); });
    }
    [...prog.querySelectorAll('i')].forEach((d, i) => {
      const p = ctx.player(v.seats[i]);
      d.hidden = !p || p.eliminated;
      d.style.left = `${Math.max(0, Math.min(100, (pos(i, now)[0] / C.len) * 100))}%`;
    });
    // between races: the results card
    const res = $('rpRes');
    const showRes = snap.st === 'results' && v.results?.length;
    res.hidden = !showRes;
    if (showRes) {
      const last = v.results[v.results.length - 1], key = `${v.results.length}`;
      if (res.dataset.k !== key) {
        res.dataset.k = key;
        res.innerHTML = '';
        res.append(ctx.el('h3', '', `🏁 Race ${v.results.length} of ${v.races}`));
        last.forEach(([j, t], n) => {
          const row = ctx.el('div', ''), dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(j);
          row.append(dot, ctx.el('span', 'grow', `${ord(n + 1)} ${nameOf(j)}`), ctx.el('em', '', t != null ? `${t.toFixed(1)} s` : 'DNF'), ctx.el('b', '', `${snap.b[j][10]}`));
          res.append(row);
        });
        const nx = ctx.el('p', 'hint'); nx.id = 'rpNext'; res.append(nx);
      }
      const nx = $('rpNext'); if (nx) nx.textContent = `Next river in ${Math.ceil(Math.max(0, snap.nx - el))}…`;
    }
  }

  // ---------- three.js river
  function canvasTex(T, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) draw(g, w, h);
    return new T.CanvasTexture(c);
  }
  // a small seeded random, so the scenery is the same for everyone in the room
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function make3d(stage) {
    const T = window.THREE;
    if (!C) return null;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const v0 = V(), L = C.len, rnd = rand(v0.seed || 1);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(55, 1, 0.3, 160);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.0, hemi: [0xe6f2ff, 0x4a6a3a, 0.85],
      key: { i: 1.1, color: 0xfff1d6, pos: [-10, 22, 6], area: 16, near: 2, far: 70 },
      sky: { top: 0x5e9be0, horizon: 0xdff0ff, bottom: 0xa8c89a, band: 0.12 },
      fog: [0xdcefff, 35, 95],
    });
    const low = stg.low;
    // the key light (and its shadow box) follows the camera down the river
    const key = stg.key;
    const W = (s, x, y) => new T.Vector3(...C.at(s, x, y));

    // -- water: a ribbon down the river, tinted by the current (fast lanes lighter), white where it's white water
    const flowTex = canvasTex(T, 64, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 70; k++) {
        const x = Math.random() * w, y = Math.random() * h, l = 10 + Math.random() * 30;
        g.strokeStyle = `rgba(150,190,230,${0.25 + Math.random() * 0.35})`; g.lineWidth = 1 + Math.random() * 1.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + l); g.stroke();
      }
    });
    flowTex.wrapS = flowTex.wrapT = T.RepeatWrapping;
    const DS = 0.5, S0 = -12, S1 = L + 18;
    function ribbon(x0f, x1f, cols, yOff, colorAt) {
      const rows = Math.ceil((S1 - S0) / DS) + 1, pos = [], col = [], uv = [], idx = [];
      const cc = new T.Color();
      for (let r = 0; r < rows; r++) {
        const s = S0 + r * DS, w = C.width(Math.max(0, Math.min(L, s)));
        for (let c = 0; c <= cols; c++) {
          const f = c / cols, x = x0f(w) + (x1f(w) - x0f(w)) * f, p = C.at(s, x, typeof yOff === 'function' ? yOff(s, x, f) : yOff);
          pos.push(...p); uv.push(x / 4, s / 6);
          colorAt(cc, s, x, f); col.push(cc.r, cc.g, cc.b);
        }
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c, b = a + cols + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    }
    const deep = new T.Color('#2f7fb8'), fastC = new T.Color('#5fb6e6'), foamC = new T.Color('#eaf6ff'), edgeC = new T.Color('#3f8f9a');
    const waterGeo = ribbon((w) => -w / 2 - 0.4, (w) => w / 2 + 0.4, low ? 10 : 16, 0, (cc, s, x) => {
      const sc = Math.max(0, Math.min(L, s)), u = C.current(sc, x), w = C.width(sc);
      cc.copy(deep).lerp(fastC, Math.max(0, Math.min(1, (u - 3.2) / 1.6)));
      if (C.white(sc, x)) cc.lerp(foamC, 0.55);
      cc.lerp(edgeC, smooth((Math.abs(x) - w / 2 + 0.8) / 1.0) * 0.6);
    });
    const waterMat = new T.MeshStandardMaterial({ map: flowTex, vertexColors: true, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.94 });
    const water = new T.Mesh(waterGeo, waterMat); water.receiveShadow = true; scene.add(water);
    // #221 the surface moves: small travelling swells, bigger in white water, lifted only on the rows near the boats
    const wPos = waterGeo.attributes.position, wCols = (low ? 10 : 16) + 1, wBase = Float32Array.from(wPos.array), wRows = wPos.count / wCols;
    const wAmp = new Float32Array(wPos.count);
    for (let r = 0; r < wRows; r++) for (let c = 0; c < wCols; c++) { const s0 = Math.max(0, Math.min(L, S0 + r * DS)); wAmp[r * wCols + c] = C.white(s0, (c / (wCols - 1) - 0.5) * C.width(s0)) ? 0.11 : 0.04; }
    let waveAt = 0;
    function waves(now, s) {
      if (calm() || now - waveAt < 50) return; waveAt = now;
      const r0 = Math.max(0, Math.floor((s - 8 - S0) / DS)), r1 = Math.min(wRows - 1, Math.ceil((s + 22 - S0) / DS)), t = now / 1000, a = wPos.array;
      for (let r = r0; r <= r1; r++) for (let c = 0; c < wCols; c++) {
        const k = r * wCols + c, sw = Math.sin(r * 0.55 - t * 2.4 + c * 0.7) + 0.6 * Math.sin(r * 0.23 - t * 1.6 - c * 1.3);
        a[k * 3 + 1] = wBase[k * 3 + 1] + sw * wAmp[k];
      }
      wPos.needsUpdate = true;
    }
    // white water: a foam layer on each rapids band that runs faster than the river
    const foamTex = canvasTex(T, 128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let k = 0; k < 160; k++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
        g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3, 0, 0, 7); g.fill();
      }
    });
    foamTex.wrapS = foamTex.wrapT = T.RepeatWrapping;
    const foamMat = new T.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.65, depthWrite: false });
    const foams = [];
    C.segs.forEach((g, k) => {
      if (!g.band) return;
      const s0 = k * C.SEG + 1.5, s1 = s0 + C.SEG - 3, rows = Math.ceil((s1 - s0) / DS), pos = [], uv = [], idx = [];
      for (let r = 0; r <= rows; r++) {
        const s = s0 + (s1 - s0) * (r / rows);
        for (let c = 0; c <= 4; c++) { const x = g.band[0] + (g.band[1] - g.band[0]) * (c / 4); pos.push(...C.at(s, x, 0.03)); uv.push(x / 3, s / 4); }
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) { const a = r * 5 + c, b = a + 5; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
      const m = new T.Mesh(geo, foamMat); scene.add(m); foams.push(m);
    });
    // banks: a muddy lip and grass rising away from the water, then a wide meadow underneath it all
    const grassTex = canvasTex(T, 128, 128, (g, w, h) => {
      g.fillStyle = '#6aa84f'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { g.fillStyle = ['#5c9a43', '#79b85a', '#4f8a3b', '#86c266'][k % 4]; g.fillRect(Math.random() * w, Math.random() * h, 2, 3); }
    });
    grassTex.wrapS = grassTex.wrapT = T.RepeatWrapping;
    const grassMat = new T.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.95 });
    const mud = new T.Color('#8a6f4e'), grass = new T.Color('#ffffff');
    for (const side of [-1, 1]) {
      const geo = ribbon((w) => (side < 0 ? -w / 2 - 7 : w / 2 - 0.2), (w) => (side < 0 ? -w / 2 + 0.2 : w / 2 + 7), low ? 4 : 6,
        (s, x, f) => { const d = side < 0 ? 1 - f : f; return -0.25 + 1.1 * smooth(d * 2.2) + 0.5 * d; },
        (cc, s, x, f) => { const d = side < 0 ? 1 - f : f; cc.copy(mud).lerp(grass, smooth(d * 5)); });
      const bank = new T.Mesh(geo, grassMat); bank.receiveShadow = true; scene.add(bank);
    }
    const meadow = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: 0x5f9a48, roughness: 1 }));
    meadow.rotation.x = -Math.PI / 2; meadow.position.set(C.at(L / 2, 0)[0], -C.ledges.length * V().dropH - 1.2, -L / 2); scene.add(meadow);
    // trees and reeds along both banks (instanced)
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    {
      const n = low ? 70 : 150;
      const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.18, 1.2, 6), new T.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }), n);
      const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.85, flatShading: true }), n);
      const tint = new T.Color();
      for (let k = 0; k < n; k++) {
        const s = -10 + rnd() * (L + 26), side = rnd() < 0.5 ? -1 : 1, w = C.width(Math.max(0, Math.min(L, s)));
        const d = 1.5 + rnd() * 5, x = side * (w / 2 + d), [X, Y, Z] = C.at(s, x), k2 = 0.8 + rnd() * 0.9, base = Y - 0.25 + 1.1 * smooth((d + 0.2) / 7 * 2.2) + 0.5 * (d + 0.2) / 7;
        ps.set(X, base + 0.6 * k2 - 0.3, Z); sc.set(k2, k2, k2); q.identity(); trunk.setMatrixAt(k, m4.compose(ps, q, sc));
        ps.set(X, base + 1.6 * k2, Z); q.setFromAxisAngle(up, rnd() * 6); sc.set(k2 * 1.1, k2 * 1.3, k2 * 1.1); crown.setMatrixAt(k, m4.compose(ps, q, sc));
        crown.setColorAt(k, tint.setHSL(0.27 + rnd() * 0.08, 0.45, 0.32 + rnd() * 0.12));
      }
      trunk.castShadow = crown.castShadow = !low;
      scene.add(trunk, crown);
      const nr = low ? 0 : 220;
      if (nr) {
        const reeds = new T.InstancedMesh(new T.ConeGeometry(0.06, 0.9, 4), new T.MeshStandardMaterial({ color: 0x7a9a3a, roughness: 0.9 }), nr);
        for (let k = 0; k < nr; k++) {
          const s = rnd() * L, side = rnd() < 0.5 ? -1 : 1, w = C.width(s), x = side * (w / 2 + 0.2 + rnd() * 0.6), [X, Y, Z] = C.at(s, x);
          ps.set(X, Y + 0.35, Z); q.setFromAxisAngle(new T.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(), rnd() * 0.3); sc.setScalar(0.7 + rnd() * 0.7);
          reeds.setMatrixAt(k, m4.compose(ps, q, sc));
        }
        scene.add(reeds);
      }
    }
    // rocks: chunky grey stones with a ring of foam
    const rockList = C.segs.flatMap((g) => g.rocks || []);
    const ledgeStones = [];
    C.segs.forEach((g) => {   // the waterfall lip: stones between the gaps
      if (g.ledge == null) return;
      const w = C.width(g.ledge), gaps = g.gaps;
      for (let x = -w / 2 - 0.3; x <= w / 2 + 0.3; x += 0.55) {
        if (gaps.some(([gx, half]) => Math.abs(x - gx) < half + 0.1)) continue;
        ledgeStones.push([g.ledge - 0.15, x, 0.38]);
      }
    });
    const allRocks = [...rockList, ...ledgeStones];
    if (allRocks.length) {
      const rockMesh = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85, flatShading: true }), allRocks.length);
      const ringMesh = new T.InstancedMesh(new T.RingGeometry(1, 1.35, 20), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), allRocks.length);
      const flatQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2), tint = new T.Color();
      allRocks.forEach(([s, x, r], k) => {
        const [X, Y, Z] = C.at(s, x);
        ps.set(X, Y + r * 0.25, Z); q.setFromEuler(new T.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); sc.set(r, r * 0.8, r);
        rockMesh.setMatrixAt(k, m4.compose(ps, q, sc)); rockMesh.setColorAt(k, tint.setHSL(0.58, 0.05, 0.42 + rnd() * 0.15));
        ps.set(X, Y + 0.04, Z); sc.setScalar(r); ringMesh.setMatrixAt(k, m4.compose(ps, flatQ, sc));
      });
      rockMesh.castShadow = !low; rockMesh.receiveShadow = true;
      scene.add(rockMesh, ringMesh);
    }
    // waterfalls: a foam curtain down each gap, and a churn of foam at the bottom
    const falls = [];
    C.segs.forEach((g) => {
      if (g.ledge == null) return;
      for (const [gx, half, edge] of g.gaps) {
        const a = W(g.ledge - 0.1, gx - half, 0.02), b = W(g.ledge - 0.1, gx + half, 0.02);
        const m = new T.Mesh(new T.PlaneGeometry(half * 2, V().dropH + 0.1), new T.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: edge ? 0.95 : 0.7, depthWrite: false, side: T.DoubleSide }));
        m.position.copy(a.clone().add(b).multiplyScalar(0.5)); m.position.y -= V().dropH / 2;
        m.position.add(W(g.ledge + 0.6, gx).sub(W(g.ledge - 0.1, gx)).multiplyScalar(0.3));
        m.rotation.set(-0.35, C.heading(g.ledge), 0, 'YXZ');
        scene.add(m); falls.push(m);
        if (edge) {   // the edge gaps get a tall spray marker so you can see they're the wet ones
          const sp = new T.Mesh(new T.ConeGeometry(0.35, 0.8, 8, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
          sp.position.copy(W(g.ledge + 0.9, gx, -V().dropH + 0.3)); scene.add(sp); falls.push(sp);
        }
      }
    });
    // whirlpools: a turning spiral, a little sunken
    const spiralTex = canvasTex(T, 256, 256, (g, w) => {
      const c = w / 2;
      const grd = g.createRadialGradient(c, c, 4, c, c, c); grd.addColorStop(0, 'rgba(10,40,70,0.85)'); grd.addColorStop(0.6, 'rgba(40,110,160,0.35)'); grd.addColorStop(1, 'rgba(60,140,190,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
      g.strokeStyle = 'rgba(235,248,255,0.75)'; g.lineWidth = 3;
      for (let arm = 0; arm < 4; arm++) {
        g.beginPath();
        for (let t = 0; t < 1; t += 0.01) { const a = arm * Math.PI / 2 + t * 7, r = 6 + t * (c - 10); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
        g.stroke();
      }
    });
    const whirls = C.segs.filter((g) => g.whirl).map((g) => {
      const [s, x, R] = g.whirl, m = new T.Mesh(new T.CircleGeometry(R * 1.05, 40), new T.MeshBasicMaterial({ map: spiralTex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(W(s, x, 0.05)); scene.add(m);
      return m;
    });
    // sun patches: a warm glow on the water and a few sparkles over it
    const suns = C.segs.filter((g) => g.sun).map((g) => {
      const [s, x, R] = g.sun;
      const glowTex = canvasTex(T, 128, 128, (gg, w) => {
        const grd = gg.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2); grd.addColorStop(0, 'rgba(255,236,150,0.9)'); grd.addColorStop(1, 'rgba(255,210,90,0)');
        gg.fillStyle = grd; gg.fillRect(0, 0, w, w);
      });
      const m = new T.Mesh(new T.CircleGeometry(R * 1.1, 32), new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.copy(W(s, x, 0.06)); scene.add(m);
      const beam = new T.Mesh(new T.CylinderGeometry(R * 0.5, R * 0.95, 3, 20, 1, true), new T.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.06, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }));
      beam.position.copy(W(s, x, 1.5)); scene.add(beam);
      return m;
    });
    // pickups: an emoji sprite bobbing over the water
    const emojiTex = (e) => canvasTex(T, 128, 128, (g, w) => { g.font = '96px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, w / 2, w / 2 + 6); });
    const leafTex = emojiTex('🍃'), dryTex = emojiTex('☀️');
    const picks = C.picks.map(([s, x, kind]) => {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: kind === 'leaf' ? leafTex : dryTex, transparent: true, depthWrite: false }));
      sp.scale.setScalar(0.9); sp.position.copy(W(s, x, 0.55)); scene.add(sp);
      return sp;
    });
    // start and finish: two posts and a banner over the river
    function arch(s, finish) {
      const w = C.width(s) + 1.2, g = new T.Group(), post = new T.MeshStandardMaterial({ color: 0x7b5a3a, roughness: 0.8 });
      for (const side of [-1, 1]) { const p = new T.Mesh(new T.CylinderGeometry(0.12, 0.14, 3.2, 8), post); p.position.set(side * w / 2, 1.6, 0); p.castShadow = !low; g.add(p); }
      const tex = canvasTex(T, 256, 32, (gg, tw, th) => {
        if (finish) { for (let k = 0; k < 32; k++) for (let r = 0; r < 4; r++) { gg.fillStyle = (k + r) % 2 ? '#111' : '#fff'; gg.fillRect(k * 8, r * 8, 8, 8); } }
        else { gg.fillStyle = '#ffcf3d'; gg.fillRect(0, 0, tw, th); gg.fillStyle = '#7a4b00'; gg.font = 'bold 22px sans-serif'; gg.textAlign = 'center'; gg.fillText('🚣 START', tw / 2, 24); }
      });
      const band = new T.Mesh(new T.PlaneGeometry(w, 0.5), new T.MeshStandardMaterial({ map: tex, side: T.DoubleSide, roughness: 0.7 }));
      band.position.y = 2.9; g.add(band);
      g.position.copy(W(s, 0)); g.rotation.y = C.heading(s);
      scene.add(g);
    }
    arch(0.4, false); arch(L, true);
    // checkpoint buoys at the start of each stretch
    {
      const buoyMat = new T.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.5 });
      for (let k = 1; k < C.n; k++) for (const side of [-1, 1]) {
        const s = k * C.SEG, m = new T.Mesh(new T.SphereGeometry(0.18, 10, 8), buoyMat);
        m.position.copy(W(s, side * (C.width(s) / 2 - 0.1), 0.08)); scene.add(m);
      }
    }

    // -- boats: a folded-paper hull and the tall centre fold, in the player's colour (paler, like paper)
    function boatGeo() {
      const g = new T.BufferGeometry(), P = [];
      const bl = 0.42, bw = 0.17, tl = 0.72, tw = 0.27, th = 0.24, sh = 0.62, sl = 0.38;
      const tri = (a, b, c) => P.push(...a, ...b, ...c);
      const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
      const B = (x, z) => [x, 0, z], Tp = (x, z) => [x, th, z];
      quad(B(-bw, -bl), B(bw, -bl), B(bw, bl), B(-bw, bl));                    // bottom
      quad(B(-bw, -bl), B(-bw, bl), Tp(-tw, bl), Tp(-tw, -bl));                // sides
      quad(B(bw, bl), B(bw, -bl), Tp(tw, -bl), Tp(tw, bl));
      tri(B(-bw, -bl), Tp(-tw, -bl), [0, th, -tl]); tri(B(bw, -bl), [0, th, -tl], Tp(tw, -bl)); tri(B(-bw, -bl), [0, th, -tl], B(bw, -bl));   // bow
      tri(B(-bw, bl), [0, th, tl], Tp(-tw, bl)); tri(B(bw, bl), Tp(tw, bl), [0, th, tl]); tri(B(-bw, bl), B(bw, bl), [0, th, tl]);           // stern
      tri([0, th, -sl], [0, sh, 0], [0, th, sl]);                              // the centre fold (double-sided)
      tri([-0.03, th, -sl], [0, sh, 0], [0.03, th, sl]);
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
      g.computeVertexNormals();
      return g;
    }
    const BG = boatGeo(), BOAT = 1.5;   // drawn a bit bigger than the body, to read on a phone
    const shadowMat = new T.MeshBasicMaterial({ color: 0x0b2a44, transparent: true, opacity: 0.25, depthWrite: false });
    const boats = [];
    const paper = new T.Color('#fbf7ec'), wet = new T.Color('#7d8fa3');
    function ensureBoats() {
      while (boats.length < snap.b.length) {
        const i = boats.length, base = new T.Color(colorOf(i)).lerp(paper, 0.35);
        const mat = new T.MeshStandardMaterial({ color: base.clone(), roughness: 0.75, flatShading: true, side: T.DoubleSide });
        const g = new T.Group(), hull = new T.Mesh(BG, mat); hull.castShadow = !low; g.add(hull);
        g.scale.setScalar(BOAT);
        const sh = new T.Mesh(new T.CircleGeometry(0.45, 18), shadowMat); sh.rotation.x = -Math.PI / 2; sh.scale.set(0.7, 1.2, 1); g.add(sh); sh.position.y = 0.01;
        let ring = null, arrow = null;
        if (i === me()) {
          ring = new T.Mesh(new T.RingGeometry(0.62, 0.72, 32), new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
          arrow = new T.Mesh(new T.ConeGeometry(0.12, 0.24, 4), new T.MeshBasicMaterial({ color: 0xffc83d })); arrow.rotation.x = Math.PI; g.add(arrow);
        }
        // a name tag over rivals' boats
        let tag = null;
        if (i !== me()) {
          const t = canvasTex(T, 256, 64, (gg, w, h) => {
            gg.font = 'bold 34px sans-serif'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
            gg.lineWidth = 6; gg.strokeStyle = 'rgba(0,0,0,0.55)'; gg.strokeText(nameOf(i).slice(0, 12), w / 2, h / 2);
            gg.fillStyle = colorOf(i); gg.fillText(nameOf(i).slice(0, 12), w / 2, h / 2);
          });
          tag = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); tag.scale.set(1.6, 0.4, 1); tag.position.y = 1.05; g.add(tag);
        }
        scene.add(g);
        boats.push({ g, hull, mat, base, ring, arrow, tag, disp: null, yaw: 0, sinkT: 0, wakeAt: 0 });
      }
    }

    // -- spray: one shared particle pool
    const NP = low ? 220 : 480, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP), pFloor = new Float32Array(NP);
    let pNext = 0;
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const spray = new T.Points(pGeo, new T.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    spray.frustumCulled = false; scene.add(spray);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -999;
    const tmpC = new T.Color();
    function burst(p, n, colors, speed = 2.5, up = 1) {
      if (calm()) n = Math.ceil(n / 3);
      for (let k = 0; k < n; k++) {
        const j = pNext; pNext = (pNext + 1) % NP;
        pPos[j * 3] = p.x; pPos[j * 3 + 1] = p.y; pPos[j * 3 + 2] = p.z; pFloor[j] = p.y - 0.4;
        const a = Math.random() * 6.283, s = speed * (0.3 + Math.random());
        pVel[j * 3] = Math.cos(a) * s; pVel[j * 3 + 1] = (0.6 + Math.random()) * speed * up; pVel[j * 3 + 2] = Math.sin(a) * s;
        tmpC.set(colors[k % colors.length]); pCol[j * 3] = tmpC.r; pCol[j * 3 + 1] = tmpC.g; pCol[j * 3 + 2] = tmpC.b;
        pLife[j] = 0.5 + Math.random() * 0.6;
      }
    }
    function tickSpray(dt) {
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt;
        if (pLife[j] <= 0 || pPos[j * 3 + 1] < pFloor[j]) { pLife[j] = 0; pPos[j * 3 + 1] = -999; continue; }
        pVel[j * 3 + 1] -= 9 * dt;
        pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }

    let aspect = 1, lastDraw = 0, camPos = null, camLook = null;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h;
      camera.fov = aspect < 0.95 ? 66 : 55;
      camera.updateProjectionMatrix();
    }
    // who the camera follows: you, else the leader
    function followed() {
      const i = me(), p = i != null ? ctx.player(V().seats[i]) : null;
      if (i != null && p && !p.eliminated) return i;
      return order()[0] ?? 0;
    }
    function place(dt, now) {
      const i = followed(), o = boats[i];
      const [s, x] = o?.disp || pos(i, now), portrait = aspect < 0.95;
      const back = portrait ? 6.5 : 6, high = portrait ? 6.2 : 4.0, ahead = portrait ? 7 : 8;
      const want = W(s - back, x * 0.6, high), look = W(s + ahead, x * 0.5, 0);
      if (!camPos) { camPos = want.clone(); camLook = look.clone(); }
      const k = Math.min(1, dt * 4);
      camPos.lerp(want, k); camLook.lerp(look, k);
      camera.position.copy(camPos); camera.lookAt(camLook);
      stg.follow(camera); waves(now, s);
      if (key) { const c = W(s + 4, 0); key.position.set(c.x - 10, c.y + 22, c.z + 6); key.target.position.copy(c); }
    }
    function draw(now) {
      ensureBoats();
      const dt = Math.min(0.1, (now - lastDraw) / 1000 || 0); lastDraw = now;
      const v = V();
      // the water flows: the stripes run downstream, the foam faster
      flowTex.offset.y -= dt * 0.75; foamTex.offset.y -= dt * 1.3; foamTex.offset.x = Math.sin(now / 700) * 0.05; foamMat.opacity = 0.55 + 0.12 * Math.sin(now / 180);
      whirls.forEach((m, k) => { m.rotation.z += dt * (2.2 + k * 0.1); });
      suns.forEach((m) => { m.material.opacity = 0.75 + 0.2 * Math.sin(now / 400); });
      picks.forEach((sp, k) => {
        sp.visible = !!snap.pk[k];
        const [s, x] = C.picks[k]; sp.position.copy(W(s, x, 0.55 + Math.sin(now / 300 + k) * 0.12));
      });
      snap.b.forEach((b, i) => {
        const o = boats[i]; if (!o) return;
        const p = ctx.player(v.seats[i]), here = !!p && !p.eliminated;
        o.g.visible = here;
        if (!here) return;
        const [ps0, px0] = pos(i, now);
        // glide toward where the server says the boat is (snaps on big jumps: a refold, a new race)
        if (!o.disp || Math.hypot(ps0 - o.disp[0], px0 - o.disp[1]) > 4) o.disp = [ps0, px0];
        else { const k = Math.min(1, dt * 12); o.disp[0] += (ps0 - o.disp[0]) * k; o.disp[1] += (px0 - o.disp[1]) * k; }
        const [s, x] = o.disp, sunk = b[5] > 0, soggy = b[4] / 100;
        const P = W(s, x, 0);
        // sinking: tip over and slip under; otherwise ride low as it soaks
        o.sinkT += ((sunk ? 1 : 0) - o.sinkT) * Math.min(1, dt * (sunk ? 1.6 : 8));
        P.y += Math.sin(now / 320 + i * 1.7) * 0.03 - 0.1 * soggy - 0.7 * o.sinkT;
        o.g.position.copy(P);
        const want = C.heading(s) - Math.atan2(b[3], Math.max(2, b[2])) * 0.8 + b[8];
        let dr = want - o.yaw; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        o.yaw += dr * Math.min(1, dt * 8);
        o.g.rotation.set(-0.06 * soggy + Math.sin(now / 410 + i) * 0.03 + o.sinkT * 0.9, o.yaw, Math.sin(now / 370 + i) * 0.05 - b[3] * 0.04 + o.sinkT * 0.5, 'YXZ');
        o.mat.color.copy(o.base).lerp(wet, soggy * 0.7);
        if (o.ring) { o.ring.visible = !sunk; o.ring.material.opacity = 0.5 + 0.3 * Math.sin(now / 250); }
        if (o.arrow) { o.arrow.visible = !sunk; o.arrow.position.y = 1.0 + 0.08 * Math.sin(now / 220); o.arrow.rotation.y += dt * 2; }
        if (o.tag) o.tag.visible = !sunk;
        // a wake behind a moving boat, more in white water
        if (snap.st === 'race' && !sunk && !b[9] && now - o.wakeAt > (b[6] & 4 ? 60 : 140) && !calm()) {
          o.wakeAt = now;
          burst(W(s - 0.6, x, 0.05), b[6] & 4 ? 3 : 1, ['#ffffff', '#d8efff'], 0.7, 0.6);
        }
      });
      place(dt, now); GL3.tickShake(camera, dt);
      tickSpray(dt);
      renderer.render(scene, camera);
    }
    function splash(s, x, n, big) { burst(W(s, x, 0.15), n, ['#ffffff', '#cfeaff', '#9fd4ff'], big ? 3.2 : 2.2, big ? 1.4 : 1); }
    function paddleFx(i) { const o = boats[i]; if (o?.disp) burst(W(o.disp[0] - 0.2, o.disp[1], 0.1), 6, ['#ffffff', '#cfeaff'], 1.4); }
    function confetti(i) {
      const o = boats[i]; if (!o?.disp) return;
      burst(W(o.disp[0], o.disp[1], 1.2), 40, ['#ffcf3d', '#ef476f', '#06d6a0', '#118ab2', '#ffffff'], 3, 1.2);
    }
    const shake = (a) => GL3.shake(camera, a);
    function dispose() {
      stg.dispose();
      scene.traverse((m) => { m.geometry?.dispose?.(); const mm = m.material; (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
      renderer.dispose(); renderer.domElement.remove();
    }
    resize();
    return { draw, resize, dispose, shake, splash, paddleFx, confetti };
  }

  // ---------- flat fallback (no WebGL): a top-down strip of river that scrolls with your boat
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    const drops = [];
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth || 320, h = stage.clientHeight || 240;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      if (!C) return;
      const v = V(), Wd = canvas.width, H = canvas.height, k = Wd / 16;   // 16 units across the screen
      const i = me() != null ? me() : order()[0] ?? 0, [cs] = pos(i, now);
      const sAt = (y) => cs + (H * 0.72 - y) / k, X = (x) => Wd / 2 + x * k, Y = (s) => H * 0.72 - (s - cs) * k;
      g.fillStyle = '#6aa84f'; g.fillRect(0, 0, Wd, H);
      for (let y = 0; y < H; y += 4) {   // the water, a row at a time
        const s = sAt(y);
        if (s < -6 || s > C.len + 8) continue;
        const w = C.width(Math.max(0, Math.min(C.len, s))), u = C.current(Math.max(0, Math.min(C.len, s)), 0);
        g.fillStyle = `rgb(${40 + u * 6},${120 + u * 10},${180 + u * 6})`;
        g.fillRect(X(-w / 2), y, w * k, 4);
        const seg = C.segs[C.idx(s)];
        if (seg.band && C.white(s, (seg.band[0] + seg.band[1]) / 2)) { g.fillStyle = 'rgba(240,250,255,0.55)'; g.fillRect(X(seg.band[0]), y, (seg.band[1] - seg.band[0]) * k, 4); }
      }
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2;
      for (let n = 0; n < 24; n++) {   // flow streaks
        const s = Math.floor(cs / 3) * 3 + ((n * 7) % 30) - 8 + ((now / 1000) * 3.5 % 3), x = ((n * 37) % 13) - 6.5;
        g.beginPath(); g.moveTo(X(x), Y(s)); g.lineTo(X(x), Y(s + 0.8)); g.stroke();
      }
      for (const seg of C.segs) {
        if (seg.sun) { g.fillStyle = 'rgba(255,225,120,0.45)'; g.beginPath(); g.arc(X(seg.sun[1]), Y(seg.sun[0]), seg.sun[2] * k, 0, 7); g.fill(); }
        if (seg.whirl) {
          const [s, x, R] = seg.whirl; g.strokeStyle = 'rgba(10,40,80,0.6)'; g.lineWidth = 3;
          g.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = t * 12 + now / 300, r = t * R * k; g.lineTo(X(x) + Math.cos(a) * r, Y(s) + Math.sin(a) * r); } g.stroke();
        }
        for (const [s, x, r] of seg.rocks || []) { g.fillStyle = '#7d828a'; g.beginPath(); g.arc(X(x), Y(s), r * k, 0, 7); g.fill(); }
        if (seg.ledge != null) {
          const w = C.width(seg.ledge); g.fillStyle = '#6b6f75'; g.fillRect(X(-w / 2), Y(seg.ledge) - 4, w * k, 8);
          for (const [gx, half, edge] of seg.gaps) { g.fillStyle = edge ? '#e9f6ff' : '#9fd4ff'; g.fillRect(X(gx - half), Y(seg.ledge) - 5, half * 2 * k, 10); }
        }
      }
      g.fillStyle = '#111'; g.fillRect(X(-C.width(C.len) / 2), Y(C.len) - 3, C.width(C.len) * k, 6);
      C.picks.forEach(([s, x, kind], n) => {
        if (!snap.pk[n]) return;
        g.font = `${k * 0.9}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(kind === 'leaf' ? '🍃' : '☀️', X(x), Y(s));
      });
      snap.b.forEach((b, j) => {
        const p = ctx.player(v.seats[j]); if (!p || p.eliminated) return;
        const [s, x] = pos(j, now);
        g.save(); g.translate(X(x), Y(s)); g.rotate(Math.atan2(b[3], Math.max(0.5, b[2])) + b[8]);
        g.globalAlpha = b[5] > 0 ? 0.35 : 1;
        g.fillStyle = colorOf(j); g.strokeStyle = j === v.me ? '#ffc83d' : '#fff'; g.lineWidth = j === v.me ? 4 : 2;
        g.beginPath(); g.moveTo(0, -0.6 * k); g.lineTo(0.3 * k, 0.4 * k); g.lineTo(-0.3 * k, 0.4 * k); g.closePath(); g.fill(); g.stroke();
        g.restore();
      });
      for (let n = drops.length - 1; n >= 0; n--) {
        const d = drops[n], t = (now - d.at) / 500;
        if (t >= 1) { drops.splice(n, 1); continue; }
        g.globalAlpha = 1 - t; g.strokeStyle = '#fff'; g.lineWidth = 3;
        g.beginPath(); g.arc(X(d.x), Y(d.s), (0.3 + d.n * 0.03) * k * Math.sqrt(t) + 2, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    const splash = (s, x, n) => drops.push({ s, x, n, at: performance.now() });
    resize();
    return { draw, resize, dispose() { canvas.remove(); }, splash };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.rapids.races > 1 ? `🚣 Race ${s.rapids.race} of ${s.rapids.races}` : '🚣 River race — first to the finish') : null);
  const myMove = (s) => s.phase === 'playing' && s.rapids.st === 'race' && s.rapids.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
