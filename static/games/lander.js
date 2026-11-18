// Moon Lander: everyone flies at once. This module flies my lander locally on the same fixed 30 Hz tick as the
// server (games/lander.py: the angle moves in whole steps and the sine/cosine table comes from the server, so both
// sides do exactly the same arithmetic), records the input log, and sends it on touchdown; the server replays it
// and its verdict is final. Rivals are ghost landers: positions arrive ~10 times a second over the fast channel.
// Controls: hold 🔥 (or ↑ / W / Space) to burn, ◀ ▶ (or ← → / A D) to lean.
UI.lander = (() => {
  let S, ctx, V = null, gl = null, flat = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let fl = null, roundKey = '', held = { l: false, r: false, up: false }, keys = new Set(), posAt = 0, sent = false;
  let ghosts = {}, ghostAt = 0, flash = null, lastCd = 0, beeped = 0;
  // drag to look: `look` metres added to the camera's x; it springs back a moment after you let go
  let look = 0, drag = null, lookRel = 0, padHold = null, seenRes = new Set();
  // #161: tap (or drag along) the strip map to look at that spot; it stays a moment after you let go
  let mapLook = null, mapHold = 0;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');

  function mount(main, side) {
    V = null; gl = null; flat = null; fl = null; roundKey = ''; look = 0; drag = null; padHold = null; mapLook = null; mapHold = 0; held = { l: false, r: false, up: false }; keys = new Set(); ghosts = {}; flash = null; sent = false;
    main.innerHTML = `<div class="ml"><div class="ml-stage" id="mlStage">
        <canvas class="ml-map" id="mlMap"></canvas>
        <div class="ml-hud" id="mlHud"><span id="mlAlt"></span><span id="mlVy"></span><span id="mlVx"></span><span id="mlAng"></span></div>
        <div class="ml-fuel"><i id="mlFuel"></i><b id="mlFuelT"></b></div>
        <div class="ml-count" id="mlCount" hidden></div>
        <div class="ml-pop" id="mlPop" hidden></div>
        <div class="ml-arrows ml-left" id="mlPadL"></div><div class="ml-arrows ml-right" id="mlPadR"></div>
        <div class="ml-done" id="mlDone" hidden><h3 id="mlDoneTitle"></h3><div id="mlStand"></div></div>
      </div>
      <div class="ml-ctl" id="mlCtl">
        <button data-k="l" aria-label="Lean left">◀</button>
        <button data-k="up" class="ml-burn" aria-label="Burn">🔥 Burn</button>
        <button data-k="r" aria-label="Lean right">▶</button>
      </div>
      <p id="mlHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🚀 Points</h3><div id="mlRace"></div><p class="hint left">Hold 🔥 to burn, ◀ ▶ to lean. Keyboard: ↑ / W / Space and ← → / A D.</p></div>';
    main.querySelector('.ml').style.touchAction = 'none';
    for (const b of main.querySelectorAll('#mlCtl button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} held[k] = true; b.classList.add('on'); };
      const off = () => { held[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const KEYS = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'up', KeyW: 'up', Space: 'up' };
    keyDown = (e) => { if (e.target?.closest?.('input, textarea, select')) return; if (KEYS[e.code]) { e.preventDefault(); keys.add(KEYS[e.code]); } };
    keyUp = (e) => { if (KEYS[e.code]) keys.delete(KEYS[e.code]); };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp);
    const stage = $('mlStage');
    // drag the sky sideways to look around
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ml-arrows, .ml-done')) return;
      e.preventDefault(); try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { id: e.pointerId, x: e.clientX, look };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const per = ((gl || flat)?.span?.() || 80) / (stage.clientWidth || 320);
      look = Math.max(-V?.geo.w || -160, Math.min(V?.geo.w || 160, drag.look - (e.clientX - drag.x) * per));
    });
    const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; lookRel = performance.now(); } };
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag);
    // tap or drag along the strip map to look there
    const map = $('mlMap');
    const mapX = (e) => { const r = map.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))) * (V?.geo.w || 160); };
    map.addEventListener('pointerdown', (e) => { if (!V) return; e.preventDefault(); e.stopPropagation(); try { map.setPointerCapture(e.pointerId); } catch {} mapLook = { id: e.pointerId, x: mapX(e) }; });
    map.addEventListener('pointermove', (e) => { if (mapLook?.id === e.pointerId) mapLook.x = mapX(e); });
    const mapOff = (e) => { if (mapLook?.id === e.pointerId) { mapLook = null; mapHold = lookRel = performance.now() + 1800; } };
    map.addEventListener('pointerup', mapOff); map.addEventListener('pointercancel', mapOff); map.addEventListener('lostpointercapture', mapOff);
    // hold a pad arrow to swing the view to that pad
    for (const side of ['mlPadL', 'mlPadR']) {
      const box = $(side);
      box.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-pad]'); if (!b) return; e.preventDefault(); e.stopPropagation(); padHold = +b.dataset.pad; });
      const off = () => { if (padHold != null) { padHold = null; lookRel = performance.now(); } };
      box.addEventListener('pointerup', off); box.addEventListener('pointercancel', off); box.addEventListener('pointerleave', off);
    }
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const revive = { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } };
    GL3.load().then(() => { if (stage.isConnected && !gl && V) GL3.revive(stage, revive); else if (stage.isConnected && !V) mount.pend = revive; })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    window.Snd?.bed('lander.engine').set(0);
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
  }

  const me = () => V?.me;
  const mine = () => (V && V.me != null ? V.fliers[V.me] : null);
  const colorOf = (i) => ctx.player(V.seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V.seats[i])?.name ?? '?';
  const G = () => V.geo;
  function groundOf(v, x) {
    const g = v.geo, h = v.h;
    let i = Math.floor(x / g.seg); i = Math.max(0, Math.min(h.length - 2, i));
    const f = x / g.seg - i;
    return h[i] + (h[i + 1] - h[i]) * f;
  }
  const ground = (x) => groundOf(V, x);
  // one tick, exactly as games/lander.py fly() steps (the same operations in the same order)
  function tick(f, g, bits) {
    const thrust = bits & 1, rot = (bits >> 1) - 1;
    f.k = Math.max(-g.kMax, Math.min(g.kMax, f.k + rot));
    const on = !!(thrust && f.fuel > 0);
    if (on) { f.vx += g.sin[f.k + g.kMax] * g.thrust * g.dt; f.vy += g.cos[f.k + g.kMax] * g.thrust * g.dt; f.fuel -= 1; }
    f.vy -= g.g * g.dt;
    f.x += f.vx * g.dt; f.y += f.vy * g.dt;
    if (f.x < 1) { f.x = 1; f.vx = 0; } else if (f.x > g.w - 1) { f.x = g.w - 1; f.vx = 0; }
    if (f.y > g.ceiling) { f.y = g.ceiling; f.vy = Math.min(f.vy, 0); }
    return on;
  }
  // a whole flight from an input log (the rules test checks this against the server's replay)
  function replay(v, log, fuel) {
    const g = v.geo, f = { x: v.start[0], vx: v.start[1], y: g.startY, vy: 0, k: 0, fuel };
    let bits = 2, li = 0;
    for (let t = 0; t < g.maxTicks; t++) {
      while (li < log.length && log[li][0] <= t) bits = log[li++][1];
      tick(f, g, bits);
      if (f.y <= groundOf(v, f.x)) return { ...judgeOf(v, f.x, f.vx, f.vy, f.k), ticks: t + 1, x: f.x, vx: f.vx, vy: f.vy, k: f.k, fuel: f.fuel };
    }
    return { how: 'lost', pad: -1, pts: 0, ticks: g.maxTicks, x: f.x, vx: f.vx, vy: f.vy, k: f.k, fuel: f.fuel };
  }
  // a touchdown's verdict, as the server judges it (games/lander.py judge)
  const judge = (x, vx, vy, k) => judgeOf(V, x, vx, vy, k);
  function judgeOf(V, x, vx, vy, k) {
    const g = V.geo;
    for (let n = 0; n < V.pads.length; n++) {
      const [l, r, , mult] = V.pads[n];
      if (l + g.foot <= x && x <= r - g.foot) {
        const ok = -vy <= g.vyOk && Math.abs(vx) <= g.vxOk && Math.abs(k) * g.rot <= g.angOk;
        if (!ok) return { how: 'crash', pad: n, pts: 0 };
        const soft = Math.max(0, 1 - (-vy) / g.vyOk), half = (r - l) / 2 - g.foot, prec = half > 0 ? Math.max(0, 1 - Math.abs(x - (l + r) / 2) / half) : 1;
        return { how: 'land', pad: n, pts: Math.round(mult * (50 + 30 * soft + 20 * prec)), soft, prec };
      }
    }
    return { how: 'crash', pad: -1, pts: 0 };
  }

  // ---------- my flight: fixed ticks from the round's start, exactly as games/lander.py fly() steps
  function newFlight(startAt) {
    const g = G();
    return { x: V.start[0], vx: V.start[1], y: g.startY, vy: 0, k: 0, fuel: mine().tank, t: 0, at: startAt, bits: null, log: [], on: false, done: null, trail: [] };
  }
  function input() {
    const l = held.l || keys.has('l'), r = held.r || keys.has('r'), up = held.up || keys.has('up');
    return { thrust: up ? 1 : 0, rot: (r ? 1 : 0) - (l ? 1 : 0) };
  }
  function stepFlight(now) {
    if (!fl || fl.done) return;
    const g = G(), want = Math.min(g.maxTicks, Math.floor((now - fl.at) / 1000 / g.dt));
    let n = 0;
    while (fl.t < want && !fl.done && n++ < 12) {
      const { thrust, rot } = input(), bits = thrust + 2 * (rot + 1);
      if (bits !== fl.bits) { fl.log.push([fl.t, bits]); fl.bits = bits; }
      fl.on = tick(fl, g, bits);
      if (fl.t % 6 === 0) { fl.trail.push([fl.x, fl.y]); if (fl.trail.length > 80) fl.trail.shift(); }
      const gy = ground(fl.x);
      fl.t++;
      if (fl.y <= gy) { touchdown(gy); break; }
    }
    if (!fl.done && fl.t >= g.maxTicks) { fl.done = { how: 'lost', pts: 0, pad: -1 }; send(); }
  }
  function touchdown(gy) {
    const v = { vx: fl.vx, vy: fl.vy, k: fl.k };
    fl.done = { ...judge(fl.x, fl.vx, fl.vy, fl.k), ...v };
    fl.y = gy;
    if (fl.done.how === 'land') {
      fl.k = fl.k; fl.vx = fl.vy = 0;
      const mult = V.pads[fl.done.pad][3];
      SN.touch(); setTimeout(() => SN.chime(mult), 250);
      showFlash(`🛬 ×${mult} landing! +${fl.done.pts}`, 2600, 'good');
      ctx.buzz?.([30, 40, 30]);
      (gl || flat)?.dust(fl.x, gy, 30);
    } else {
      SN.crash(); ctx.buzz?.([120, 60, 200]);
      showFlash(fl.done.pad < 0 ? '💥 Crashed: missed the pads' : -fl.vy > G().vyOk ? '💥 Crashed: too fast' : Math.abs(fl.vx) > G().vxOk ? '💥 Crashed: sliding' : '💥 Crashed: tilted', 2600, 'bad');
      (gl || flat)?.boom(fl.x, gy);
      gl?.shake(1.0);
    }
    send();
  }
  function send() {
    if (sent) return;
    sent = true;
    ctx.act('land', { log: fl.log }).catch((e) => ctx.toast?.(e?.message || 'Could not send your landing.'));
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.lander;
    const key = `${V.round}`;
    if (key !== roundKey) { roundKey = key; fl = null; sent = false; ghosts = {}; beeped = 0; (gl || flat)?.rebuild?.(); seenRes = new Set(V.fliers.map((f, i) => (f.res ? i : -1))); }
    // a rival's crash: a smaller boom where their ghost came down
    V.fliers.forEach((f, i) => {
      if (!f.res || seenRes.has(i)) return;
      seenRes.add(i);
      const o = ghosts[i];
      if (f.res.how === 'crash' && o && i !== V.me) { const p = o.cur(performance.now()); (gl || flat)?.boom(p[0], ground(p[0]), { small: true, z: -3 - (i % 3) * 2.2 }); }
    });
    const my = mine();
    if (V.stage === 'count' && my && !fl && !my.out) fl = newFlight(performance.now() + V.startIn * 1000);
    else if (V.stage === 'fly' && my && !fl && my.res == null && !my.out) fl = newFlight(performance.now() - V.flown * 1000);
    if (!gl && !flat && mount.pend) { const p = mount.pend; mount.pend = null; GL3.revive($('mlStage'), p); }
    renderSide();
  }

  function fast(d) {
    if (!V || d.rd !== V.round) return;
    const now = performance.now();
    for (const [k, g] of Object.entries(d.gh || {})) {
      const i = +k; if (i === me()) continue;
      const o = ghosts[i];
      ghosts[i] = { from: o ? o.cur(now) : g, to: g, at: now, cur(t) { const f = Math.min(1, (t - this.at) / 110); return [this.from[0] + (this.to[0] - this.from[0]) * f, this.from[1] + (this.to[1] - this.from[1]) * f, this.to[2], this.to[3]]; } };
    }
    for (const k of Object.keys(ghosts)) if (!(k in (d.gh || {}))) delete ghosts[k];
    ghostAt = now;
  }

  function renderSide() {
    const box = $('mlRace'); if (!box) return;
    box.innerHTML = '';
    const order = V.seats.map((_, i) => i).sort((a, b) => V.fliers[b].points - V.fliers[a].points);
    for (const i of order) {
      const f = V.fliers[i], row = ctx.el('div', 'seat-row lr-row' + (f.out ? ' out' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const r = f.res, what = !r ? (V.stage === 'fly' ? '…flying' : '') : r.how === 'land' ? `×${V.pads[r.pad][3]} +${r.pts}` : r.how === 'crash' ? '💥' : '🛰️';
      row.append(dot, ctx.el('span', 'grow', `${nameOf(i)}${i === V.me ? ' (you)' : ''}`), ctx.el('span', 'ml-what', what), ctx.el('b', '', `${f.points}`));
      box.append(row);
    }
    const show = V.stage === 'between' && !!V.standings;
    $('mlDone').hidden = !show;
    if (show) {
      $('mlDoneTitle').textContent = `🌕 Round ${V.round} done`;
      standingsCard($('mlStand'), V.standings, { title: '🚀 Points', note: V.round < V.rounds ? 'Next moon in a moment…' : 'That was the last round!' });
    }
    $('mlCtl').classList.toggle('ml-off', !(fl && !fl.done && V.stage === 'fly'));
    $('mlCtl').hidden = V.me == null;
  }

  // ---------- sound: a rocket in a vacuum is silent, so this is what you'd hear in the cabin
  const snd = (fn) => window.Snd?.play((t, K) => fn(t, K, K.at({ room: 'room', send: 0.25 })));
  const SN = {
    touch: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 300, q: 0.7, vol: 0.4, tau: 0.05, buf: 'brown' }); K.mode(d, t, 70, 0.2, 0.08); [0, 0.07].forEach((dt) => K.burst(d, t + dt, { type: 'bandpass', f: 1600, q: 2, vol: 0.08, tau: 0.01 })); }),
    chime: (m) => snd((t, K, d) => { [523, 659, 784, 1047].slice(0, m + 1).forEach((f, n) => K.mode(d, t + n * 0.09, f, 0.08, 0.25)); }),
    crash: () => snd((t, K, d) => {
      K.mode(d, t, 48, 0.4, 0.2, { f1: 30 }); K.burst(d, t, { type: 'lowpass', f: 600, f1: 120, q: 0.7, vol: 0.7, tau: 0.25, dur: 1.2, buf: 'brown' });
      for (let n = 0; n < 8; n++) K.burst(d, t + 0.05 + n * K.R(0.04, 0.1), { type: 'bandpass', f: K.R(1500, 4000), q: 2, vol: 0.08, tau: 0.01 });
    }),
    beep: (hi) => snd((t, K, d) => K.sweep(d, t, { f0: hi ? 1320 : 880, f1: hi ? 1320 : 880, dur: 0.09, vol: 0.05, type: 'square', attack: 0.004 })),
  };
  const engineBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lp = A.createBiquadFilter(), g = A.createGain(), hum = A.createOscillator(), hg = A.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 420; g.gain.value = 0; hum.type = 'sawtooth'; hum.frequency.value = 55; hg.gain.value = 0;
    src.connect(lp).connect(g).connect(dst); hum.connect(hg).connect(dst); hum.start();
    return { set(l) { g.gain.setTargetAtTime(0.35 * l, A.currentTime, 0.04); hg.gain.setTargetAtTime(0.012 * l, A.currentTime, 0.05); }, stop() { try { src.stop(); hum.stop(); } catch {} } };
  };

  function showFlash(text, ms = 1500, tone = '') {
    flash = { text, until: performance.now() + ms, tone };
    const el = $('mlPop'); if (!el) return;
    el.textContent = text; el.hidden = false; el.className = `ml-pop ml-pop-in ${tone}`;
    void el.offsetWidth;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!V) return;
    stepFlight(now);
    try { (gl || flat)?.draw(now); } catch (e) { if (!loop.err) { loop.err = 1; console.error(e); } }   // one bad frame mustn't stop the HUD
    const g = G(), playing = S.phase === 'playing' && !S.paused;
    window.Snd?.bed('lander.engine', engineBed).set(playing && fl && !fl.done && fl.on ? 1 : 0);
    // post my position for the others' ghosts (about 7 times a second)
    if (fl && !fl.done && V.stage === 'fly' && now - posAt > 140) { posAt = now; ctx.input({ at: [+fl.x.toFixed(2), +fl.y.toFixed(2), fl.k, fl.on ? 1 : 0] }); }
    // the countdown
    const cd = V.stage === 'count' && fl ? (fl.at - now) / 1000 : 0, c = Math.ceil(cd);
    $('mlCount').hidden = !(V.stage === 'count' && S.phase === 'playing');
    $('mlCount').textContent = cd > 0 ? String(c) : 'GO';
    if (c !== lastCd) { if (c > 0 && c <= 3) ctx.sfx?.('tick'); lastCd = c; }
    if (flash && now > flash.until) { flash = null; $('mlPop').hidden = true; }
    // gauges: green when inside the landing limits
    const hud = $('mlHud');
    if (fl) {
      const alt = Math.max(0, fl.y - ground(fl.x)), vy = -fl.vy, vx = Math.abs(fl.vx), ang = Math.abs(fl.k) * g.rot;
      const set = (id, text, ok) => { const e = $(id); e.textContent = text; e.className = ok ? 'ok' : 'bad'; };
      set('mlAlt', `⬇ ${alt.toFixed(0)} m`, alt > 15 || vy <= g.vyOk);
      set('mlVy', `↓ ${vy.toFixed(1)}`, vy <= g.vyOk);
      set('mlVx', `↔ ${vx.toFixed(1)}`, vx <= g.vxOk);
      set('mlAng', `∠ ${Math.round(ang * 57.3)}°`, ang <= g.angOk);
      hud.hidden = false;
      const fuelS = fl.fuel / 30;
      $('mlFuel').style.width = `${Math.min(100, (fl.fuel / g.tankMax) * 100)}%`;
      $('mlFuel').classList.toggle('low', fuelS < 4);
      $('mlFuelT').textContent = `⛽ ${fuelS.toFixed(1)}s`;
      if (!fl.done && fuelS < 4 && fuelS > 0 && fl.on && now - beeped > 600) { beeped = now; SN.beep(fuelS < 2); }
    } else {
      hud.hidden = true;
      const f = mine();
      $('mlFuelT').textContent = f ? `⛽ ${(f.fuel / 30).toFixed(1)}s` : '';
      $('mlFuel').style.width = f ? `${Math.min(100, (f.fuel / g.tankMax) * 100)}%` : '0';
    }
    // looking around: hold a pad arrow to swing there; let go and the view drifts home (sooner once you fly again)
    const base = fl && V.stage !== 'between' && V.stage !== 'count' ? fl.x : g.w / 2;
    if (mapLook) look += (mapLook.x - base - look) * 0.18;
    else if (padHold != null && fl && V.pads[padHold]) { const [l, r] = V.pads[padHold]; look += ((l + r) / 2 - fl.x - look) * 0.12; }
    else if (!drag && look) {
      const inp = input(), busy = (inp.thrust || inp.rot) && now > mapHold - 1500;
      if (busy || now - lookRel > 1200) { look *= busy ? 0.85 : 0.92; if (Math.abs(look) < 0.05) look = 0; }
    }
    drawArrows();
    drawMap(now);
    const my = mine();
    $('mlHint').textContent = S.phase !== 'playing' ? '' : V.stage === 'count' ? `Round ${V.round} of ${V.rounds}: pick a pad — ×3 is narrow and high.`
      : fl && !fl.done ? (fl.fuel <= 0 ? '⛽ Out of fuel!' : fl.t < 150 ? 'Drag the sky to look around; the arrows point to pads off screen.' : 'Gentle now: green gauges mean a safe touchdown.')
      : my?.res ? 'Watching the others come down…' : V.me == null ? 'Watching.' : '';
    if (now - (loop.side || 0) > 400) { loop.side = now; renderSide(); }
  }

  // arrows on the stage's edges for pads that are off screen (hold one to look that way)
  const PAD_COL = { 1: '#5ce1a0', 2: '#ffd23f', 3: '#ff5d8f' };
  function drawArrows() {
    const L = $('mlPadL'), R = $('mlPadR'); if (!L) return;
    const view = gl || flat, on = !!(fl && !fl.done && V.stage === 'fly' && view?.proj);
    let left = '', right = '';
    if (on) V.pads.forEach(([l, r, y, m], n) => {
      const c = (l + r) / 2, p = view.proj(c, y), d = Math.round(Math.abs(c - fl.x));
      const chip = (arrow) => `<button data-pad="${n}" style="--pc:${PAD_COL[m]}">${arrow === '◀' ? '◀ ' : ''}×${m} · ${d} m${arrow === '▶' ? ' ▶' : ''}</button>`;
      if (p < -0.92) left += chip('◀'); else if (p > 0.92) right += chip('▶');
    });
    if (L.dataset.h !== left) { L.dataset.h = left; L.innerHTML = left; }
    if (R.dataset.h !== right) { R.dataset.h = right; R.innerHTML = right; }
  }

  // a strip map across the top: the whole moon, the pads, me and the ghosts
  function drawMap(now) {
    const c = $('mlMap'); if (!c) return;
    const g = c.getContext?.('2d'); if (!g) return;
    const w = c.clientWidth || 300, h = c.clientHeight || 40, dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const W = c.width, H = c.height, sx = W / G().w, top = G().ceiling * 0.62, sy = H / top;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#9aa3b3'; g.beginPath(); g.moveTo(0, H);
    V.h.forEach((y, i) => g.lineTo(i * G().seg * sx, H - y * sy));
    g.lineTo(W, H); g.fill();
    for (const [l, r, y, m] of V.pads) {
      g.fillStyle = m === 3 ? '#ff5d8f' : m === 2 ? '#ffd23f' : '#5ce1a0'; g.fillRect(l * sx, H - y * sy - 2 * dpr, (r - l) * sx, 3 * dpr);
    }
    // what's on screen: a soft bracket (tap the map to move it)
    const view = gl || flat, sp = view?.span?.(), cx = view?.cx?.();
    if (sp && cx != null && sp < G().w * 1.4) {
      const a = (cx - sp / 2) * sx, b = (cx + sp / 2) * sx;
      g.fillStyle = '#ffffff14'; g.fillRect(a, 0, b - a, H);
      g.strokeStyle = mapLook ? '#ffd23fcc' : '#ffffff55'; g.lineWidth = 1.5 * dpr; g.strokeRect(a, 1, b - a, H - 2);
    }
    const dot = (x, y, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x * sx, Math.max(r, H - Math.min(top, y) * sy), r, 0, 7); g.fill(); };
    for (const [i, o] of Object.entries(ghosts)) { const p = o.cur(now); dot(p[0], p[1], colorOf(+i), 2.5 * dpr); }
    if (fl) dot(fl.x, fl.y, '#ffffff', 3.5 * dpr);
  }

  // ---------- three.js moon
  function canvasTex(T, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) draw(g, w, h);
    return new T.CanvasTexture(c);
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(45, 1, 0.5, 1600);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.0, hemi: [0x8090b0, 0x111118, 0.35],
      key: { i: 1.6, color: 0xfff6e8, pos: [-55, 38, 28], area: 50, near: 5, far: 200, map: 1024 },
      sky: { top: 0x000005, horizon: 0x05060f, bottom: 0x05060f, band: 0.08, stars: 600, radius: 600 },
      env: { accent: 0x445577, walls: 0x05060a, lamp: 0xffffff, glow: 1.2 },
    });
    const low = stg.low;
    // the Earth, hanging in the black
    const earthTex = canvasTex(T, 256, 128, (g, w, h) => {
      g.fillStyle = '#1d4f9c'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 18; k++) { g.fillStyle = '#3f8a4c'; g.beginPath(); g.ellipse(Math.random() * w, h * (0.2 + Math.random() * 0.6), 6 + Math.random() * 22, 4 + Math.random() * 12, Math.random() * 3, 0, 7); g.fill(); }
      for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 8 + Math.random() * 30, 1.5 + Math.random() * 4, 0, 0, 7); g.fill(); }
    });
    const earth = new T.Mesh(new T.SphereGeometry(22, 32, 20), new T.MeshStandardMaterial({ map: earthTex, roughness: 0.8, emissive: 0x112244, emissiveIntensity: 0.35 }));
    earth.position.set(-120, 210, -480); scene.add(earth);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(120,180,255,0.55)'); gr.addColorStop(1, 'rgba(60,120,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    halo.scale.setScalar(64); halo.position.copy(earth.position).add(new T.Vector3(0, 0, -2)); scene.add(halo);
    // gold foil: crinkled patches, so the light breaks up across the descent stage
    const foilTex = canvasTex(T, 256, 256, (g, w, h) => {
      g.fillStyle = '#c99630'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 160; k++) {
        const x = Math.random() * w, y = Math.random() * h, l = 150 + Math.random() * 100 | 0;
        g.fillStyle = `rgba(${l},${l * 0.72 | 0},${l * 0.25 | 0},0.55)`; g.beginPath(); g.moveTo(x, y);
        for (let n = 0; n < 4; n++) g.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
        g.fill();
      }
    });
    // regolith texture
    const rego = canvasTex(T, 512, 512, (g, w, h) => {
      g.fillStyle = '#8b8d94'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 16000; k++) { const v = 110 + Math.random() * 60 | 0; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      for (let k = 0; k < 40; k++) { const x = Math.random() * w, y = Math.random() * h, r = 2 + Math.random() * 10; g.strokeStyle = 'rgba(40,40,46,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.fillStyle = 'rgba(60,60,66,0.25)'; g.beginPath(); g.arc(x + 0.5, y + 0.5, r * 0.8, 0, 7); g.fill(); }
    });
    rego.wrapS = rego.wrapT = T.RepeatWrapping; rego.repeat.set(14, 6); rego.anisotropy = low ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
    // a height map for the grain: little crater rims and pebbles that catch the low sun
    const coarse = matchMedia?.('(pointer: coarse)').matches, BS = coarse ? 256 : 512;   // (#163: phones lost the GPU context; go easier on memory)
    const bump = low ? null : canvasTex(T, BS, BS, (g, w, h) => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 9000 * (w / 512) ** 2; k++) { const v = 90 + Math.random() * 80 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      for (let k = 0; k < 70; k++) {
        const x = Math.random() * w, y = Math.random() * h, r = (3 + Math.random() * 16) * w / 512;
        const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.3); gr.addColorStop(0, 'rgba(40,40,40,0.8)'); gr.addColorStop(0.75, 'rgba(70,70,70,0.4)'); gr.addColorStop(0.85, 'rgba(200,200,200,0.6)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.3, 0, 7); g.fill();
      }
    });
    if (bump) { bump.wrapS = bump.wrapT = T.RepeatWrapping; bump.repeat.copy(rego.repeat); }
    const groundMat = new T.MeshStandardMaterial({ map: rego, roughness: 0.95, color: 0xb8bac2, vertexColors: true, bumpMap: bump, bumpScale: 0.5 });
    const padLegMat = new T.MeshStandardMaterial({ map: rego, roughness: 0.95, color: 0xb8bac2, flatShading: true });
    const world = new T.Group(); scene.add(world);
    const beaconMat = new T.MeshBasicMaterial({ color: 0xff4040 }); beaconMat.shared = true;
    let terrain = null, padObjs = [], extras = new T.Group();
    world.add(extras);
    const disposeTree = (o) => o.traverse((m) => { m.geometry?.dispose(); if (m.material && !m.material.shared) { if (m.material.map !== glowTex) m.material.map?.dispose(); m.material.dispose?.(); } });
    const rockGeo = new T.IcosahedronGeometry(1, 0), rockMat = new T.MeshStandardMaterial({ map: rego, color: 0x9a9ca4, roughness: 1, flatShading: true });
    rockMat.shared = true;
    // the scenery: the flight line in the middle, the moon running on past both ends and away behind, ridges on the horizon
    function build() {
      if (terrain) { world.remove(terrain); terrain.geometry.dispose(); }
      for (const p of padObjs) { world.remove(p); disposeTree(p); }
      padObjs = [];
      for (const c of [...extras.children]) { extras.remove(c); disposeTree(c); }
      wreck.clear(); bits.length = 0; fx.length = 0; holes.length = 0;
      const g = G(), h = V.h, seed = V.round * 977;
      const rnd = (a) => { const s = Math.sin(a * 12.9898 + seed) * 43758.5453; return s - Math.floor(s); };
      // past the ends the moon carries on: blend from the edge height into rolling hills
      const hills = (x) => 18 + 9 * Math.sin(x / 27 + seed) + 5 * Math.sin(x / 11.3 + seed * 1.7) + 14 * Math.max(0, Math.sin(x / 53 + seed * 0.3)) ** 2;
      const lineH = (x) => {
        if (x >= 0 && x <= g.w) return ground(x);
        const e = x < 0 ? h[0] : h[h.length - 1], t = Math.min(1, (x < 0 ? -x : x - g.w) / 36);
        return e + (hills(x) - e) * t * t * (3 - 2 * t);
      };
      const craters = [];
      for (let k = 0; k < 26; k++) craters.push([-140 + rnd(k) * (g.w + 280), -8 - rnd(k + 50) * 120, 3 + rnd(k + 90) * (k < 5 ? 18 : 8)]);
      for (let k = 0; k < 6; k++) craters.push([rnd(k + 300) * g.w, 5 + rnd(k + 310) * 8, 2 + rnd(k + 320) * 3]);   // a few small ones in front
      const heightAt = (x, z) => {
        let y = lineH(x);
        const off = Math.max(0, Math.abs(z) - 3);
        // in front, the flight line's bumps fade into a smoothed profile (else they run on as long ridges)
        if (z > 8) { const sm = (lineH(x - 9) + lineH(x - 4.5) + y + lineH(x + 4.5) + lineH(x + 9)) / 5; y += (sm - y) * Math.min(1, (z - 8) / 30); }
        if (off > 0) {
          // behind the flight line the ground falls away a little (the line you land on stays the skyline); in front it drops
          const back = z < 0 ? -Math.min(16, off * 0.3) + 7 * Math.max(0, Math.sin(x / 21 + seed)) * Math.min(1, off / 40) : -Math.min(off, 11) * 0.4 - Math.min(Math.max(0, off - 11), 34) * 0.6;   // (#162: then levels out, so wide views see ground, not the edge)
          y += back + Math.sin(x * 0.31 + z * 0.17 + seed) * Math.min(2.5, off * 0.2) * Math.max(0, Math.min(1, (60 - z) / 16));
          if (z > 44) y += Math.min(1, (z - 44) / 30) * (4 * Math.sin(x / 37 + z / 41 + seed) + 2.5 * Math.sin(x / 17 - z / 23 + seed * 2));   // the near plain: slow swells (no fine noise the coarse rows would alias)
          for (const [cx, cz, cr] of craters) {
            const d = Math.hypot(x - cx, z - cz);
            if (d < cr * 1.5) y += d < cr ? -Math.cos((d / cr) * Math.PI / 2) * cr * 0.32 : Math.sin(((d - cr) / (cr * 0.5)) * Math.PI) * cr * 0.14;
          }
        }
        return y;
      };
      // x: fine over the flight line, coarser out past the ends; z: fine near the line, coarse far back
      const xs = [];
      for (let x = -160; x < 0; x += 4) xs.push(x);
      for (let i = 0; i < h.length; i++) xs.push(i * g.seg);
      for (let x = g.w + 4; x <= g.w + 160; x += 4) xs.push(x);
      const zs = [];
      for (let z = -150; z <= 440; z += z < -70 ? 10 : z < -20 ? 5 : z < 14 ? 2 : z < 60 ? 6 : 20) zs.push(z);
      const nx = xs.length, pos = [], idx = [], uv = [], cols = [];
      for (const z of zs) for (const x of xs) {
        const y = heightAt(x, z);
        pos.push(x, y, z); uv.push((x + 160) / (g.w + 320) * 2.4, (z + 150) / 164 * 2);   // (v runs past 2 in front: the texture repeats)
        const inside = x >= 0 && x <= g.w;
        let shade = z < -3 ? Math.max(0.2, 1 - (-3 - z) / 65) : z > 3 ? Math.max(0.6, 1 - (z - 3) / 20) : 1;   // the flight line brightest
        if (!inside) shade *= 0.82;
        cols.push(shade, shade, shade * 1.03);
      }
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      terrain = new T.Mesh(geo, groundMat); terrain.receiveShadow = true; world.add(terrain);
      // ridges on the horizon, each further one darker and bluer
      [[-230, 20, 0.13], [-400, 38, 0.085], [-620, 66, 0.055]].forEach(([z, top, lum], n) => {
        const rp = [], rc = [], ri = [], N = 140, x0 = -700, x1 = g.w + 700;
        for (let i = 0; i <= N; i++) {
          const x = x0 + (x1 - x0) * i / N, q = x / (40 + n * 25) + seed * (n + 1);
          const peak = top * (0.45 + 0.35 * Math.sin(q) + 0.2 * Math.sin(q * 2.7 + 1) + 0.25 * Math.max(0, Math.sin(q * 0.4)) ** 3) + rnd(i + n * 100) * top * 0.08;
          rp.push(x, -30, z + 60, x, peak, z, x, -30, z - 50);
          for (let r = 0; r < 3; r++) rc.push(lum * (r === 1 ? 1.15 : 0.8), lum * (r === 1 ? 1.15 : 0.8), lum * (r === 1 ? 1.3 : 1.0));
        }
        for (let i = 0; i < N; i++) { const a = i * 3; ri.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
        const rg = new T.BufferGeometry();
        rg.setAttribute('position', new T.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new T.Float32BufferAttribute(rc, 3));
        rg.setIndex(ri); rg.computeVertexNormals();
        extras.add(new T.Mesh(rg, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0xb8bac2 })));
      });
      // boulders for scale: a scatter behind and in front of the line (never on it)
      const nRocks = low ? 60 : 160, rocks = new T.InstancedMesh(rockGeo, rockMat, nRocks), m4 = new T.Matrix4(), q4 = new T.Quaternion(), e4 = new T.Euler(), s4 = new T.Vector3(), p4 = new T.Vector3();
      for (let k = 0; k < nRocks; k++) {
        const x = -60 + rnd(k + 700) * (g.w + 120), front = k % 4 === 0, z = front ? 4.5 + rnd(k + 800) * 8 : -4.5 - rnd(k + 800) ** 1.6 * 60;
        const r = 0.25 + rnd(k + 900) ** 3 * (front ? 0.9 : 2.6);
        e4.set(rnd(k + 1) * 6, rnd(k + 2) * 6, rnd(k + 3) * 6); q4.setFromEuler(e4);
        s4.set(r * (0.8 + rnd(k + 4) * 0.6), r * (0.5 + rnd(k + 5) * 0.4), r * (0.8 + rnd(k + 6) * 0.6));
        p4.set(x, heightAt(x, z) + s4.y * 0.35, z);
        m4.compose(p4, q4, s4); rocks.setMatrixAt(k, m4);
      }
      rocks.castShadow = !low; rocks.receiveShadow = true; extras.add(rocks);
      // the ends of the flight line: masts with blinking tips (the lander can't fly past them)
      for (const x of [1, g.w - 1]) {
        const y = ground(x), mast = new T.Mesh(new T.CylinderGeometry(0.08, 0.12, 9, 6), new T.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.6, roughness: 0.4 }));
        mast.position.set(x, y + 4.5, -1.5); extras.add(mast);
        const tip = new T.Mesh(new T.SphereGeometry(0.3, 10, 8), beaconMat); tip.position.set(x, y + 9.1, -1.5); extras.add(tip);
      }
      // pads: a slab with blinking edge lights and a big ×n sign
      const padCol = { 1: '#5ce1a0', 2: '#ffd23f', 3: '#ff5d8f' };
      for (const [l, r, y, m] of V.pads) {
        const grp = new T.Group();
        const slab = new T.Mesh(new T.BoxGeometry(r - l, 0.35, 6), new T.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.6, roughness: 0.4 }));
        slab.position.set((l + r) / 2, y - 0.12, 0); slab.receiveShadow = true; slab.castShadow = !low; grp.add(slab);
        if (m === 3) { const leg = new T.Mesh(new T.BoxGeometry(r - l - 0.6, 6, 5), padLegMat); leg.position.set((l + r) / 2, y - 3.3, 0); grp.add(leg); }
        const lightMat = new T.MeshBasicMaterial({ color: padCol[m] });
        for (const x of [l + 0.3, r - 0.3]) for (const z of [-2.8, 2.8]) { const b = new T.Mesh(new T.SphereGeometry(0.18, 8, 6), lightMat); b.position.set(x, y + 0.15, z); grp.add(b); }
        const stripe = new T.Mesh(new T.PlaneGeometry(r - l - 0.4, 0.5), lightMat); stripe.rotation.x = -Math.PI / 2; stripe.position.set((l + r) / 2, y + 0.07, 2.4); grp.add(stripe);
        const sign = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 128, 64, (g, w, hh) => { g.fillStyle = padCol[m]; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#000'; g.shadowBlur = 8; g.fillText(`×${m}`, w / 2, hh / 2); }), depthTest: false, transparent: true }));
        sign.position.set((l + r) / 2, y + 3.2, 0); sign.scale.set(6, 3, 1); sign.userData.m = m; grp.add(sign);
        if (!low) for (const x of [l + 0.3, r - 0.3]) for (const z of [-2.8, 2.8]) {
          const gs = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: padCol[m], transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
          gs.position.set(x, y + 0.2, z); gs.scale.setScalar(1.6); grp.add(gs); (grp.glows ||= []).push(gs);
        }
        grp.userData = { lightMat, m, glows: grp.glows || [], l, r };
        world.add(grp); padObjs.push(grp);
      }
      stg.relight?.();
    }
    // the lander: gold-foil descent stage, a silver cabin, four legs, an engine bell and a flame
    function makeLander(col, ghost) {
      const grp = new T.Group();
      const op = ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {};
      const foil = new T.MeshStandardMaterial({ color: ghost ? col : 0xffffff, map: ghost ? null : foilTex, bumpMap: ghost || low ? null : foilTex, bumpScale: 0.04, metalness: ghost ? 0.1 : 0.85, roughness: 0.32, ...op });
      const silver = new T.MeshStandardMaterial({ color: ghost ? col : 0xdfe3ea, metalness: ghost ? 0.1 : 0.7, roughness: 0.3, ...op });
      const body = new T.Mesh(new T.CylinderGeometry(0.9, 1.0, 0.9, 8), foil); body.position.y = 1.15; grp.add(body);
      const cab = new T.Mesh(new T.CylinderGeometry(0.62, 0.8, 0.8, 6), silver); cab.position.y = 2.0; grp.add(cab);
      const win = new T.Mesh(new T.BoxGeometry(0.4, 0.22, 0.1), new T.MeshBasicMaterial({ color: ghost ? col : 0x1a2a44, ...op })); win.position.set(0, 2.1, 0.62); grp.add(win);
      const band = new T.Mesh(new T.TorusGeometry(0.93, 0.07, 6, 16), new T.MeshStandardMaterial({ color: col, ...op })); band.rotation.x = Math.PI / 2; band.position.y = 1.55; grp.add(band);
      const legMat = silver;
      for (let n = 0; n < 4; n++) {
        const a = n * Math.PI / 2 + Math.PI / 4, lx = Math.cos(a), lz = Math.sin(a);
        const leg = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), legMat);
        leg.position.set(lx * 1.05, 0.6, lz * 1.05); leg.rotation.set(lz * 0.5, 0, -lx * 0.5); grp.add(leg);
        const pad = new T.Mesh(new T.CylinderGeometry(0.22, 0.24, 0.06, 8), legMat); pad.position.set(lx * 1.35, 0.03, lz * 1.35); grp.add(pad);
      }
      const bell = new T.Mesh(new T.CylinderGeometry(0.22, 0.42, 0.45, 10, 1, true), new T.MeshStandardMaterial({ color: 0x555a66, metalness: 0.8, roughness: 0.4, side: T.DoubleSide, ...op })); bell.position.y = 0.55; grp.add(bell);
      const flame = new T.Mesh(new T.ConeGeometry(0.35, 1.8, 12, 1, true), new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: ghost ? 0.5 : 0.9, blending: T.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = Math.PI; flame.position.y = -0.4; flame.visible = false; grp.add(flame);
      const core = new T.Mesh(new T.ConeGeometry(0.16, 1.0, 10, 1, true), new T.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
      core.rotation.x = Math.PI; core.position.y = 0.0; flame.add(core); core.position.y = -0.3;
      grp.traverse((m) => { if (m.isMesh && !ghost && m !== flame && m !== core) m.castShadow = !low; });
      // a ladder down the front leg, an antenna dish, four thruster quads
      const rail = new T.CylinderGeometry(0.025, 0.025, 1.0, 4);
      for (const dx of [-0.13, 0.13]) { const r = new T.Mesh(rail, silver); r.position.set(dx, 0.75, 1.02); r.rotation.x = -0.35; grp.add(r); }
      for (let n = 0; n < 4; n++) { const st = new T.Mesh(new T.BoxGeometry(0.28, 0.03, 0.05), silver); st.position.set(0, 0.42 + n * 0.22, 0.9 + n * 0.08); grp.add(st); }
      const mast = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.6, 4), silver); mast.position.set(0.35, 2.65, -0.2); grp.add(mast);
      const dish = new T.Mesh(new T.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), new T.MeshStandardMaterial({ color: ghost ? col : 0xf2f2f2, metalness: 0.3, roughness: 0.4, side: T.DoubleSide, ...op }));
      dish.position.set(0.35, 2.95, -0.2); dish.rotation.set(-0.6, 0, 0.5); grp.add(dish);
      const rcs = [];
      for (const sx of [-1, 1]) {
        const q = new T.Mesh(new T.BoxGeometry(0.14, 0.2, 0.2), silver); q.position.set(sx * 0.78, 2.0, 0); grp.add(q);
        rcs.push(q);
      }
      grp.userData = { flame, rcs };
      return grp;
    }
    const mine3 = makeLander(0xffc83d, false); world.add(mine3);
    const ring = new T.Mesh(new T.RingGeometry(1.5, 1.75, 32), new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; world.add(ring);
    const ghost3 = {};
    // exhaust and dust: one particle pool
    const NP = 500, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    let pNext = 0;
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const pts = new T.Points(pGeo, new T.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    pts.frustumCulled = false; world.add(pts);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -999;
    const tmpC = new T.Color();
    function emit(x, y, z, vx, vy, vz, col, life, spread = 1) {
      const j = pNext; pNext = (pNext + 1) % NP;
      pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z;
      pVel[j * 3] = vx + (Math.random() - 0.5) * spread; pVel[j * 3 + 1] = vy + (Math.random() - 0.5) * spread; pVel[j * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      tmpC.set(col); pCol[j * 3] = tmpC.r; pCol[j * 3 + 1] = tmpC.g; pCol[j * 3 + 2] = tmpC.b;
      pLife[j] = life;
    }
    function tickParts(dt) {
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt;
        if (pLife[j] <= 0) { pPos[j * 3 + 1] = -999; continue; }
        pVel[j * 3 + 1] -= 1.62 * dt;
        pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
        const gy = ground(Math.max(0, Math.min(G().w, pPos[j * 3])));
        if (pPos[j * 3 + 1] < gy && Math.abs(pPos[j * 3 + 2]) < 3) { pPos[j * 3 + 1] = gy; pVel[j * 3 + 1] *= -0.2; pVel[j * 3] *= 0.6; }
        const f = Math.min(1, pLife[j] * 2); pCol[j * 3] *= 0.985 + 0.015 * f; pCol[j * 3 + 1] *= 0.97; pCol[j * 3 + 2] *= 0.97;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }
    // dust is a second pool with normal blending (grey regolith, not glowing fire)
    const ND = 400, dPos = new Float32Array(ND * 3), dVel = new Float32Array(ND * 3), dLife = new Float32Array(ND), dCol = new Float32Array(ND * 3);
    let dNext = 0;
    const dGeo = new T.BufferGeometry();
    dGeo.setAttribute('position', new T.BufferAttribute(dPos, 3)); dGeo.setAttribute('color', new T.BufferAttribute(dCol, 3));
    const dPts = new T.Points(dGeo, new T.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    dPts.frustumCulled = false; world.add(dPts);
    for (let k = 0; k < ND; k++) dPos[k * 3 + 1] = -999;
    function kick(x, y, z, vx, vy, vz, life, lum = 0.55) {
      const j = dNext; dNext = (dNext + 1) % ND;
      dPos[j * 3] = x; dPos[j * 3 + 1] = y; dPos[j * 3 + 2] = z; dVel[j * 3] = vx; dVel[j * 3 + 1] = vy; dVel[j * 3 + 2] = vz; dLife[j] = life;
      const v = lum * (0.8 + Math.random() * 0.4); dCol[j * 3] = v; dCol[j * 3 + 1] = v; dCol[j * 3 + 2] = v * 1.04;
    }
    function tickDust(dt) {
      for (let j = 0; j < ND; j++) {
        if (dLife[j] <= 0) continue;
        dLife[j] -= dt;
        if (dLife[j] <= 0) { dPos[j * 3 + 1] = -999; continue; }
        dVel[j * 3 + 1] -= 1.62 * dt;   // no air: dust flies in clean arcs and just drops
        dPos[j * 3] += dVel[j * 3] * dt; dPos[j * 3 + 1] += dVel[j * 3 + 1] * dt; dPos[j * 3 + 2] += dVel[j * 3 + 2] * dt;
        const gy = ground(Math.max(0, Math.min(G().w, dPos[j * 3])));
        if (dPos[j * 3 + 1] < gy) { dPos[j * 3 + 1] = gy; dVel[j * 3] = dVel[j * 3 + 1] = dVel[j * 3 + 2] = 0; dLife[j] = Math.min(dLife[j], 0.4); }
        if (dLife[j] < 0.5) { const f = 0.94; dCol[j * 3] *= f; dCol[j * 3 + 1] *= f; dCol[j * 3 + 2] *= f; }
      }
      dGeo.attributes.position.needsUpdate = true; dGeo.attributes.color.needsUpdate = true;
    }
    function dust(x, y, n) { if (calm()) n = Math.ceil(n / 3); for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, s = 2 + Math.random() * 4; kick(x, y + 0.15, (Math.random() - 0.5) * 0.6, Math.cos(a) * s, 0.5 + Math.random() * 2, Math.sin(a) * s * 0.6, 1.2 + Math.random() * 1.2); } }

    // ---------- the crash: fireball, flash, a shockwave across the ground, the lander in pieces, a scorch
    const glowTex = canvasTex(T, 128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,140,0.95)'); gr.addColorStop(0.55, 'rgba(255,120,40,0.5)'); gr.addColorStop(1, 'rgba(120,30,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const scorchTex = canvasTex(T, 128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(8,8,10,0.95)'); gr.addColorStop(0.5, 'rgba(20,18,18,0.7)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 26; k++) { const a = Math.random() * 6.283, r0 = w * 0.18, r1 = w * (0.3 + Math.random() * 0.2); g.strokeStyle = 'rgba(10,10,12,0.5)'; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0); g.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1); g.stroke(); }
    });
    const scorchMat = new T.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const ringMat = () => new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    const ringGeo = new T.RingGeometry(0.85, 1, 48), shardGeo = new T.TetrahedronGeometry(0.28, 0), unit = new T.PlaneGeometry(1, 1);
    // one point light (each one costs every lit pixel): the engine's glow on the ground, or a crash's flash
    const flashLight = low ? null : new T.PointLight(0xffa850, 0, 34, 2);
    if (flashLight) world.add(flashLight);
    let flashing = 0;
    const nozzle = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffc080, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    nozzle.position.set(0, 0.1, 0); nozzle.scale.setScalar(2.4); nozzle.visible = false; mine3.add(nozzle);
    // a soft shadow straight below: the best way to judge height near the ground
    const blob = new T.Mesh(new T.CircleGeometry(1, 28), new T.MeshBasicMaterial({ map: canvasTex(T, 64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    blob.rotation.x = -Math.PI / 2; world.add(blob);
    const trails = {};
    const wreck = new T.Group(); world.add(wreck);
    const fx = [], bits = [];
    const wp = new T.Vector3(), wq = new T.Quaternion();
    function boom(x, y, o = {}) {
      const small = !!o.small, z = o.z || 0, few = calm() || low;
      // fireball: a hot white core inside an orange bloom, both swelling and fading
      for (const [col, size, life] of [[0xffffff, small ? 2.2 : 4, 0.35], [0xffa040, small ? 4 : 8, 0.8]]) {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        sp.position.set(x, y + 1, z); sp.scale.setScalar(0.1); world.add(sp);
        fx.push({ m: sp, t: 0, life, kind: 'ball', size });
      }
      if (!small && flashLight) { flashLight.position.set(x, y + 2.5, z + 1); flashLight.intensity = 7; flashing = 1; }
      // a shockwave ring racing across the ground
      const ring = new T.Mesh(ringGeo, ringMat()); ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.12, z); world.add(ring);
      fx.push({ m: ring, t: 0, life: 0.9, kind: 'ring', size: small ? 7 : 15 });
      // sparks and lingering embers (fire pool), then a ring of regolith thrown out
      const n = (few ? 30 : 90) >> (small ? 1 : 0);
      for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, e = Math.random() * 1.3, s = 3 + Math.random() * 10; emit(x, y + 1, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, k % 3 ? '#ffb347' : '#ffffff', 0.6 + Math.random() * 1.0, 0.5); }
      for (let k = 0; k < (few ? 6 : 18) >> (small ? 1 : 0); k++) emit(x + (Math.random() - 0.5) * 2, y + 0.4, z, (Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, '#ff6a20', 2.5 + Math.random() * 1.5, 0.3);
      const nd = (few ? 50 : 140) >> (small ? 1 : 0);
      for (let k = 0; k < nd; k++) { const a = Math.random() * 6.283, s = 3 + Math.random() * 7; kick(x, y + 0.3, z, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s * 0.7, 2 + Math.random() * 1.5); }
      // #164: off the pads the ground takes a crater, blackened; on a pad, just a scorch. Both stay for the round
      if (!onPad(x)) { crater(x, z, small ? 3 : 5); if (small) return; return breakUp(x, y, z); }
      const sc = new T.Mesh(unit, scorchMat), sl = Math.atan2(ground(x + 1) - ground(x - 1), 2);
      sc.rotation.set(-Math.PI / 2, 0, 0); sc.rotateOnWorldAxis(new T.Vector3(0, 0, 1), sl); sc.position.set(x, ground(x) + 0.06, z); sc.scale.setScalar(small ? 4 : 7); wreck.add(sc);
      if (small) return;
      breakUp(x, y, z);
    }
    const onPad = (x) => V.pads.some(([l, r]) => x > l - 1 && x < r + 1);
    const holes = [];
    // how far a crater has dug the ground down at (x, z) (the rules' ground is untouched: this is only scenery)
    const dent = (x, z) => { let d = 0; for (const [cx, cz, R] of holes) { const r = Math.hypot(x - cx, z - cz); if (r < R) d -= Math.cos((r / R) * Math.PI / 2) * R * 0.32; } return d; };
    function crater(x, z, R) {
      holes.push([x, z, R]);
      const pa = terrain.geometry.attributes.position, ca = terrain.geometry.attributes.color, a = pa.array, c = ca.array;
      for (let i = 0; i < pa.count; i++) {
        const dx = a[i * 3] - x, dz = a[i * 3 + 2] - z;
        if (Math.abs(dx) > R * 1.6 || Math.abs(dz) > R * 1.6) continue;
        const d = Math.hypot(dx, dz);
        if (d < R) a[i * 3 + 1] -= Math.cos((d / R) * Math.PI / 2) * R * 0.32;
        else if (d < R * 1.5) a[i * 3 + 1] += Math.sin(((d - R) / (R * 0.5)) * Math.PI) * R * 0.12;   // a thrown-up rim
        if (d < R * 1.6) { const f = d < R * 0.7 ? 0.35 : 0.35 + 0.65 * Math.min(1, (d - R * 0.7) / (R * 0.9)); c[i * 3] *= f; c[i * 3 + 1] *= f; c[i * 3 + 2] *= f; }
      }
      pa.needsUpdate = ca.needsUpdate = true; terrain.geometry.computeVertexNormals();
    }
    function breakUp(x, y, z) {
      const few = calm() || low;
      // the lander comes apart: its own parts tumble away in slow moon arcs, with foil shards
      mine3.updateMatrixWorld(true);
      const parts = [];
      mine3.traverse((m) => { if (m.isMesh && m !== mine3.userData.flame && m.parent === mine3) parts.push(m); });
      const foil = parts[0]?.material;
      for (let k = 0; k < (few ? 6 : 16); k++) parts.push(Object.assign(new T.Mesh(shardGeo, foil), { shard: true }));
      for (const m of parts) {
        const c = m.shard ? m : m.clone();
        if (m.shard) c.position.set(x + (Math.random() - 0.5) * 1.5, y + 1 + Math.random(), z);
        else { m.getWorldPosition(wp); m.getWorldQuaternion(wq); c.position.copy(wp); c.quaternion.copy(wq); }
        c.castShadow = !low; wreck.add(c);
        const a = Math.random() * 6.283, s = 2 + Math.random() * (m.shard ? 9 : 5);
        bits.push({ m: c, v: [Math.cos(a) * s, 3 + Math.random() * 7, Math.sin(a) * s * 0.5], w: [(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9], rest: false });
      }
    }
    function tickFx(dt) {
      for (let k = fx.length - 1; k >= 0; k--) {
        const f = fx[k]; f.t += dt;
        const u = Math.min(1, f.t / f.life);
        if (f.kind === 'ball') { f.m.scale.setScalar(0.3 + f.size * Math.sqrt(u)); f.m.material.opacity = (1 - u) ** 1.5; }
        else { f.m.scale.setScalar(0.5 + f.size * (1 - (1 - u) ** 2)); f.m.material.opacity = 0.9 * (1 - u); }
        if (u >= 1) { world.remove(f.m); f.m.material.dispose(); fx.splice(k, 1); }
      }
      if (flashing && flashLight) { flashLight.intensity = Math.max(0, flashLight.intensity - dt * 12); if (!flashLight.intensity) flashing = 0; }
      for (const b of bits) {
        if (b.rest) continue;
        const p = b.m.position;
        b.v[1] -= 1.62 * dt;
        p.x += b.v[0] * dt; p.y += b.v[1] * dt; p.z += b.v[2] * dt;
        b.m.rotation.x += b.w[0] * dt; b.m.rotation.y += b.w[1] * dt; b.m.rotation.z += b.w[2] * dt;
        const gy = ground(Math.max(0, Math.min(G().w, p.x))) + dent(p.x, p.z) + 0.15;
        if (p.y < gy) {
          p.y = gy; b.v[1] = -b.v[1] * 0.35; b.v[0] *= 0.6; b.v[2] *= 0.6; for (let i = 0; i < 3; i++) b.w[i] *= 0.6;
          if (Math.abs(b.v[1]) > 1.2 && !calm()) kick(p.x, gy, p.z, b.v[0] * 0.3, 0.8, b.v[2] * 0.3, 0.8);
          if (Math.abs(b.v[1]) < 0.6) b.rest = true;
        }
      }
    }

    let aspect = 1, lastDraw = 0, camX = V ? G().w / 2 : 80, camY = 60, camD = 120;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h; camera.updateProjectionMatrix();
    }
    const tv = () => Math.tan((camera.fov * Math.PI) / 360);
    function draw(now) {
      if (!V) return;
      if (!terrain || build.round !== V.round) { build.round = V.round; build(); }
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      const g = G();
      // camera: the whole moon before the start, then riding with my lander (closer as it gets low)
      let tx, ty, td;
      if (fl && V.stage !== 'between') {
        const alt = Math.max(0, fl.y - ground(fl.x));
        td = Math.max(24, Math.min(76, 22 + alt * 0.55)); tx = fl.x; ty = fl.y - Math.min(alt, td * tv()) * 0.45;
        if (fl.done) { td = 46; ty = fl.y + 6; }   // down (or in pieces): pull back to watch the others come in
        if (V.stage === 'count') { td = Math.max(g.w * 0.5 / (tv() * aspect), 60) ; tx = g.w / 2; ty = 45; }
      } else {
        td = Math.max(g.w * 0.52 / (tv() * aspect), 70); tx = g.w / 2; ty = 40;
      }
      tx = Math.max(-20, Math.min(g.w + 20, tx + look));
      const ease = Math.min(1, dt * (drag || padHold != null ? 10 : V.stage === 'count' ? 1.2 : 3));
      camX += (tx - camX) * ease; camY += (ty - camY) * ease; camD += (td - camD) * Math.min(1, dt * 1.6);
      camera.position.set(camX, camY + camD * 0.17, camD); camera.lookAt(camX, camY, 0);
      GL3.tickShake(camera, dt); stg.follow(camera);
      // the key light's shadow box rides along
      if (stg.key) { stg.key.position.set(camX - 55, 38, 28); stg.key.target.position.set(camX, 20, 0); }
      // my lander
      mine3.visible = !!fl && !(fl.done && fl.done.how === 'crash');
      if (fl) {
        mine3.position.set(fl.x, fl.y, 0); mine3.rotation.z = -fl.k * g.rot;
        const fla = mine3.userData.flame; fla.visible = !fl.done && fl.on;
        if (fla.visible) { fla.scale.set(1, 0.8 + Math.random() * 0.5, 1); if (!calm()) {
          const s = g.sin[fl.k + g.kMax], c = g.cos[fl.k + g.kMax];
          for (let k = 0; k < 3; k++) emit(fl.x - s * 0.8, fl.y + 0.2 - c * 0.8, (Math.random() - 0.5) * 0.4, -s * 14 + fl.vx, -c * 14 + fl.vy, 0, k ? '#ffb347' : '#fff1c1', 0.35 + Math.random() * 0.25, 2);
          const alt = fl.y - ground(fl.x);
          if (alt < 12 && Math.random() < 0.8) dust(fl.x + (Math.random() - 0.5) * 3, ground(fl.x), 2);
        } }
        nozzle.visible = fla.visible; if (nozzle.visible) nozzle.scale.setScalar(2 + Math.random() * 0.8);
        if (flashLight && !flashing) {
          const s0 = g.sin[fl.k + g.kMax], c0 = g.cos[fl.k + g.kMax];
          flashLight.position.set(fl.x - s0 * 1.2, fl.y - c0 * 1.2 + 0.3, 0.4); flashLight.intensity = fla.visible ? 3.5 + Math.random() : 0;
        }
        // thruster puffs when leaning
        const rot = fl.done || fl.bits == null ? 0 : (fl.bits >> 1) - 1;
        if (rot && !calm() && Math.random() < 0.7) {
          const side = rot > 0 ? -1 : 1, c = Math.cos(fl.k * g.rot), s = Math.sin(fl.k * g.rot);
          const lx = side * 0.9, ly = 2.0, wx = fl.x + lx * c + ly * s, wy = fl.y - lx * s + ly * c;
          kick(wx, wy, 0.3, side * 3 * c + fl.vx, -side * 3 * s + fl.vy, (Math.random() - 0.5), 0.25, 0.95);
        }
        const galt = Math.max(0, fl.y - ground(fl.x));
        blob.visible = !(fl.done && fl.done.how === 'crash') && galt < 60;
        blob.position.set(fl.x, ground(fl.x) + 0.06, 0); blob.scale.setScalar(1.5 + galt * 0.05);
        blob.material.opacity = 0.75 * Math.max(0, 1 - galt / 60);
        ring.visible = !fl.done; ring.position.set(fl.x, ground(fl.x) + 0.08, 0);
        ring.material.opacity = 0.35 + 0.35 * Math.max(0, 1 - (fl.y - ground(fl.x)) / 40);
      } else { ring.visible = false; blob.visible = false; nozzle.visible = false; if (flashLight && !flashing) flashLight.intensity = 0; }
      // ghosts: each rival a little behind the flight line so they don't sit on top of me
      for (const [k, o] of Object.entries(ghosts)) {
        const i = +k;
        let gh = ghost3[i];
        if (!gh) { gh = ghost3[i] = makeLander(colorOf(i), true); world.add(gh); }
        const p = o.cur(now);
        gh.visible = true; gh.position.set(p[0], p[1], -3 - (i % 3) * 2.2); gh.rotation.z = -p[2] * g.rot;
        let tr = trails[i];
        if (!tr) {
          const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(new Float32Array(48 * 3), 3)); tg.setDrawRange(0, 0);
          tr = trails[i] = { line: new T.Line(tg, new T.LineBasicMaterial({ color: colorOf(i), transparent: true, opacity: 0.35, depthWrite: false })), pts: [], at: 0 };
          tr.line.frustumCulled = false; world.add(tr.line);
        }
        if (now - tr.at > 150) {
          tr.at = now; tr.pts.push([p[0], p[1] + 1.2, gh.position.z]); if (tr.pts.length > 48) tr.pts.shift();
          const a = tr.line.geometry.attributes.position; tr.pts.forEach((q, n) => a.setXYZ(n, q[0], q[1], q[2])); a.needsUpdate = true; tr.line.geometry.setDrawRange(0, tr.pts.length);
        }
        tr.line.visible = true;
        gh.userData.flame.visible = !!p[3]; if (p[3]) gh.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      }
      for (const [k, gh] of Object.entries(ghost3)) if (!ghosts[k]) gh.visible = false;
      for (const [k, tr] of Object.entries(trails)) if (!ghosts[k] || V.stage !== 'fly') { tr.line.visible = false; tr.pts.length = 0; }
      // pad lights blink
      const blink = Math.floor(now / 500) % 2;
      beaconMat.color.setHex(Math.floor(now / 700) % 2 ? 0xff4040 : 0x401010);
      for (const p of padObjs) {
        const u = p.userData, over = fl && !fl.done && fl.x >= u.l && fl.x <= u.r, lit = blink || over;
        u.lightMat.color.set(lit ? (u.m === 3 ? 0xff5d8f : u.m === 2 ? 0xffd23f : 0x5ce1a0) : 0x333333);
        for (const gs of u.glows) { gs.visible = lit; gs.scale.setScalar(over ? 2.2 + Math.sin(now / 120) * 0.4 : 1.6); }
      }
      earth.rotation.y += dt * 0.02;
      tickParts(dt); tickDust(dt); tickFx(dt);
      renderer.render(scene, camera);
    }
    const shake = (a) => GL3.shake(camera, a);
    const pv = new T.Vector3();
    const proj = (x, y) => pv.set(x, y, 0).project(camera).x;
    const span = () => 2 * tv() * camD * aspect;
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose, shake, dust, boom, proj, span, cx: () => camX, rebuild() { build.round = -1; } };
  }

  // ---------- flat fallback: a side view riding with my lander
  function make2d(stage) {
    const canvas = document.createElement('canvas'); canvas.className = 'ml-flat'; stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    const pops = [], chunks = [], scorches = [];
    let vw = { cx: 80, k: 1, W: 1, span: 160 };
    const stars = Array.from({ length: 90 }, () => [Math.random(), Math.random()]);
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round((stage.clientWidth || 320) * dpr); canvas.height = Math.round((stage.clientHeight || 300) * dpr);
      canvas.style.width = '100%'; canvas.style.height = '100%';
    }
    function draw(now) {
      if (!V) return;
      if (!canvas.width) resize();
      const W = canvas.width, H = canvas.height, gg = G();
      const alt = fl ? Math.max(0, fl.y - ground(fl.x)) : 60;
      const span = fl && V.stage === 'fly' ? Math.max(40, Math.min(110, 40 + alt * 1.1)) : gg.w;
      const k = W / span, cx = Math.max(-20, Math.min(gg.w + 20, (fl && V.stage === 'fly' ? fl.x : gg.w / 2) + look)), cy = fl && V.stage === 'fly' ? fl.y - alt * 0.4 : 40;
      vw = { cx, k, W, span };
      const X = (x) => W / 2 + (x - cx) * k, Y = (y) => H * 0.55 - (y - cy) * k;
      g.fillStyle = '#05060f'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffffffaa'; for (const [a, b] of stars) g.fillRect(a * W, b * H, 1.5, 1.5);
      g.fillStyle = '#8b8d94'; g.beginPath(); g.moveTo(X(-400), H); g.lineTo(X(-400), Y(V.h[0]));   // (#162: the moon runs on past both ends)
      V.h.forEach((y, i) => g.lineTo(X(i * gg.seg), Y(y)));
      g.lineTo(X(gg.w + 400), Y(V.h[V.h.length - 1])); g.lineTo(X(gg.w + 400), H); g.fill();
      for (const [l, r, y, m] of V.pads) {
        g.fillStyle = m === 3 ? '#ff5d8f' : m === 2 ? '#ffd23f' : '#5ce1a0'; g.fillRect(X(l), Y(y) - 3, (r - l) * k, 4);
        g.font = `bold ${Math.max(12, 2.2 * k)}px sans-serif`; g.textAlign = 'center'; g.fillText(`×${m}`, X((l + r) / 2), Y(y) - 8);
      }
      const lander = (x, y, kk, on, col, a) => {
        g.save(); g.globalAlpha = a; g.translate(X(x), Y(y)); g.rotate(kk * gg.rot);
        const s = Math.max(6, k * 1.1);
        g.fillStyle = col; g.fillRect(-s, -s * 1.8, s * 2, s * 1.2);
        g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(-s, -s * 0.6); g.lineTo(-s * 1.4, 0); g.moveTo(s, -s * 0.6); g.lineTo(s * 1.4, 0); g.stroke();
        if (on) { g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-s * 0.4, -s * 0.5); g.lineTo(0, s * (1 + Math.random() * 0.6)); g.lineTo(s * 0.4, -s * 0.5); g.fill(); }
        g.restore();
      };
      for (const [i, o] of Object.entries(ghosts)) { const p = o.cur(now); lander(p[0], p[1], p[2], p[3], colorOf(+i), 0.45); }
      if (fl && !(fl.done && fl.done.how === 'crash')) lander(fl.x, fl.y, fl.k, !fl.done && fl.on, '#d9a63a', 1);
      for (const sc of scorches) {
        if (sc.hole) {   // #164: a crater cut into the ground, with a lip of thrown regolith
          const R = sc.r * k, cx = X(sc.x), cy = Y(sc.y);
          g.fillStyle = '#8b8d94'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * R * 1.15, cy, R * 0.35, R * 0.16, 0, Math.PI, 0); g.fill(); }
          g.fillStyle = '#3a3b40'; g.beginPath(); g.ellipse(cx, cy, R, R * 0.4, 0, 0, Math.PI); g.fill();
          g.fillStyle = '#1b1b1f'; g.beginPath(); g.ellipse(cx, cy + R * 0.05, R * 0.7, R * 0.25, 0, 0, Math.PI); g.fill();
          continue;
        }
        g.fillStyle = '#0b0b0dcc'; g.beginPath(); g.ellipse(X(sc.x), Y(sc.y), sc.r * k, sc.r * k * 0.3, 0, 0, 7); g.fill();
      }
      for (let j = chunks.length - 1; j >= 0; j--) {
        const c = chunks[j], dt = Math.max(0, Math.min(0.05, (now - c.last) / 1000)); c.last = Math.max(c.last, now);
        if (!c.rest) { c.vy -= 1.62 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.w * dt; const gy = ground(Math.max(0, Math.min(gg.w, c.x))); if (c.y < gy) { c.y = gy; c.vy *= -0.35; c.vx *= 0.6; c.w *= 0.6; if (Math.abs(c.vy) < 0.6) c.rest = true; } }
        g.save(); g.translate(X(c.x), Y(c.y)); g.rotate(c.a); g.fillStyle = c.col; g.fillRect(-c.s * k / 2, -c.s * k / 2, c.s * k, c.s * k * 0.6); g.restore();
      }
      for (let j = pops.length - 1; j >= 0; j--) {
        const p = pops[j], t = Math.max(0, (now - p.at) / (p.ball ? 600 : 700));   // (#163: a rAF time can be older than the boom's stamp)
        if (t >= 1) { pops.splice(j, 1); continue; }
        if (p.ball) { const gr = g.createRadialGradient(X(p.x), Y(p.y), 0, X(p.x), Y(p.y), (0.5 + p.size * Math.sqrt(t)) * k); gr.addColorStop(0, `rgba(255,255,230,${1 - t})`); gr.addColorStop(0.5, `rgba(255,150,50,${0.8 * (1 - t)})`); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X(p.x), Y(p.y), (0.5 + p.size * Math.sqrt(t)) * k, 0, 7); g.fill(); continue; }
        g.globalAlpha = 1 - t; g.strokeStyle = p.col; g.lineWidth = 3;
        g.beginPath(); g.arc(X(p.x), Y(p.y), (1 + t * p.size) * k, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    resize();
    return {
      draw, resize, dispose() { canvas.remove(); },
      proj: (x) => ((x - vw.cx) * vw.k) / (vw.W / 2), span: () => vw.span, cx: () => vw.cx,
      dust: (x, y) => pops.push({ x, y, col: '#aaa', size: 3, at: performance.now() }),
      boom: (x, y, o = {}) => {
        const at = performance.now(), small = !!o.small;
        pops.push({ x, y: y + 1, ball: true, size: small ? 3 : 6, at }, { x, y, col: '#ffb347', size: small ? 5 : 10, at });
        scorches.push({ x, y: ground(x), r: small ? 2.5 : 4, hole: !V.pads.some(([l, r]) => x > l - 1 && x < r + 1) });
        if (!small) for (let n = 0; n < 12; n++) { const a = Math.random() * Math.PI; chunks.push({ x, y: y + 1, vx: Math.cos(a) * (2 + Math.random() * 6), vy: 2 + Math.random() * 7, a: 0, w: (Math.random() - 0.5) * 10, s: 0.4 + Math.random() * 0.7, col: n % 3 ? '#d9a63a' : '#dfe3ea', last: at }); }
      },
      rebuild() { chunks.length = 0; scorches.length = 0; },
    };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🚀 Moon Lander — round ${s.lander.round} of ${s.lander.rounds}` : null);
  const myMove = (s) => s.phase === 'playing' && s.lander.stage === 'fly' && s.lander.me != null && !s.lander.fliers[s.lander.me]?.res;

  return { mount, render, unmount, fast, turnText, myMove, focus: true, replay };
})();
