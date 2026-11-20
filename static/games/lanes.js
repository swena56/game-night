// Lane Night: your own lane in 3D (three.js), with your rivals bowling on the lanes either side, or a flat
// top-down lane. Set where you stand and the hook, then drag back anywhere on the lane and let go: the drag
// sets the line (sideways) and the speed (how far back). The server rolls the ball; this plays it back.
UI.lanes = (() => {
  let still = false;
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, seen = 0, primed = false, drag = null, rolledAt = 0, lastDraw = 0, holdUntil = 0, settleAt = 0, settled = true;
  let start = 0.2, spin = 0.5, saver = false;
  const $ = (id) => document.getElementById(id);
  const FPS = 30;
  const MAXA = 0.12;
  const colorOf = (id) => ctx?.player(id)?.color ?? '#ccc';
  const L = () => S.lanes;
  const myRow = () => L().rows.find((r) => r.id === S.me?.id);
  // the server works out "wait" when it sends the view; the pins settling needs no new message (#105/#108),
  // so that one wait clears here once its time is up
  const SETTLE = 'Wait for the pins to settle.';
  const waiting = () => { const w = L().wait; return w && !(w === SETTLE && performance.now() >= settleAt) ? w : null; };
  const canBowl = () => S?.phase === 'playing' && L().me != null && !waiting() && !anim && performance.now() > holdUntil;
  // after the roll (in frames at FPS, from the shot's last frame): the pinsetter lifts any pins left standing, the
  // sweep bar drops, sweeps the fallen pins into the pit and lifts, then a fresh rack is lowered or the spare leave
  // set back down (#118). It all fits inside the server's 1.2 s settle.
  const POST = 34, BAR = { drop: [0, 6], sweep: [6, 16], lift: [16, 22] }, SET = [19, 31];
  const RETURN_MS = 2300;  // the ball's ride back from the pit to the hood
  let ret = null;  // my ball on the ball return: { t0 } while it rolls back, { rest: true } once it sits on the hood

  // ---------- sound (#116 #133): built on the shared Snd kit (static/sfx.js) in a bowling-alley hall. The
  // ball's roll is a deep rumble bed that follows its speed (hollow in the gutter), each pin is a maple
  // "tock" with real wooden resonances panned to where it stands, the rack crash is layered by how many go
  // down, then the pit, the pinsetter and the ball return. (Never name a helper out, sfx, tone or noise.)
  const sndOn = () => !!window.Snd?.on();
  const snd = (fn, delay) => window.Snd?.play(fn, delay);
  const panX = (x) => Math.max(-0.8, Math.min(0.8, (x || 0) / 0.55));
  const HALL = { room: 'hall', send: 0.75 };
  const rollBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lpf = A.createBiquadFilter(), g = A.createGain(), o = A.createOscillator(), og = A.createGain();
    const ticks = K.loopSrc('white'), bp = A.createBiquadFilter(), tg = A.createGain(), lfo = A.createOscillator(), lg = A.createGain();
    lpf.type = 'lowpass'; lpf.frequency.value = 300; lpf.Q.value = 1.1;
    o.type = 'sine'; o.frequency.value = 50; og.gain.value = 0.35; g.gain.value = 0;
    // the boards' seams: a faint ticking whose rate follows the ball
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2; tg.gain.value = 0;
    lfo.frequency.value = 18; lg.gain.value = 0.006; lfo.connect(lg).connect(tg.gain);
    src.connect(lpf).connect(g); o.connect(og).connect(g); ticks.connect(bp).connect(tg).connect(g);
    const room = K.at({ ...HALL, send: 0.35 });
    g.connect(room); o.start(); lfo.start();
    return {
      set(level, hollow) {
        const t = A.currentTime, on = level > 0;
        g.gain.setTargetAtTime(on ? 0.07 + 0.17 * level : 0, t, on ? 0.05 : 0.15);
        lpf.frequency.setTargetAtTime(hollow ? 150 : 220 + 320 * level, t, 0.08);
        o.frequency.setTargetAtTime(hollow ? 34 : 42 + 18 * level, t, 0.1);
        lfo.frequency.setTargetAtTime(8 + 22 * level, t, 0.1);
        tg.gain.setTargetAtTime(on && !hollow ? 0.012 : 0, t, 0.1);
      },
      stop() { try { src.stop(); o.stop(); ticks.stop(); lfo.stop(); } catch {} },
    };
  };
  let hum = null;
  function rumble(level, hollow) {  // level 0..1 is the ball's speed; hollow: it's in the gutter
    if (!(level > 0.02) && !hum) return;
    hum = level > 0.02;
    window.Snd?.bed('lanes.roll', rollBed).set(level > 0.02 ? level : 0, hollow);
  }
  // one pin: a hollow maple tock, its pitch set by the pin (each one a little different), panned to its spot
  const PIN_F = [610, 680, 560, 720, 640, 590, 750, 700, 620, 660];
  const tock = (v = 1, at = 0, k = -1, x = 0) => snd((t, K) => {
    const dst = K.at({ ...HALL, pan: panX(x), vol: 0.6 + 0.4 * v }), f = K.vary(k >= 0 ? PIN_F[k] : K.R(560, 760), 0.05);
    K.burst(dst, t, { type: 'bandpass', f: K.R(2400, 3600), q: 1.1, vol: 0.32 * v, tau: 0.004 });
    K.mode(dst, t, f, 0.13 * v, 0.03); K.mode(dst, t, f * 2.41, 0.06 * v, 0.016); K.mode(dst, t, f * 4.1, 0.025 * v, 0.008);
    K.mode(dst, t, f * 0.5, 0.05 * v, 0.05);
  }, at);
  // the ball reaching the rack: a heavy thump of the ball into the head pin, and for a big hit a clatter of
  // pins on the deck and against the kickbacks that grows with how many go
  const crash = (n, x = 0) => snd((t, K) => {
    const dst = K.at({ ...HALL, pan: panX(x) });
    K.mode(dst, t, 90, 0.32, 0.07, { f1: 60 }); K.burst(dst, t, { type: 'lowpass', f: 900, q: 0.7, vol: 0.5, tau: 0.03 });
    K.burst(dst, t, { type: 'bandpass', f: 2600, q: 0.9, vol: 0.28, tau: 0.006 });
    if (n >= 4) {
      for (let i = 0; i < n + 4; i++) {
        const dt = 0.03 + i * K.R(0.018, 0.04), d2 = K.at({ ...HALL, pan: K.R(-0.6, 0.6), vol: 0.5 });
        K.burst(d2, t + dt, { type: 'bandpass', f: K.R(1800, 3800), q: 1.3, vol: K.R(0.08, 0.2), tau: 0.004 });
        K.mode(d2, t + dt, K.R(520, 800), K.R(0.03, 0.07), 0.025);
      }
      K.burst(dst, t + 0.05, { type: 'bandpass', f: 1500, f1: 700, q: 0.4, vol: 0.03 * n, tau: 0.12, dur: 0.4 + n * 0.03 });
      K.burst(dst, t + 0.15, { type: 'lowpass', f: 300, q: 0.6, vol: 0.02 * n, tau: 0.08, buf: 'brown' });  // pins hitting the pit cushion
    }
  });
  const SND = {
    // the ball leaving the hand and landing on the boards past the foul line
    release: () => snd((t, K) => {
      const d = K.at(HALL);
      K.burst(d, t, { type: 'bandpass', f: 600, f1: 300, q: 0.5, vol: 0.12, tau: 0.04, dur: 0.18, attack: 0.04 });
      K.mode(d, t + 0.14, 85, 0.3, 0.06, { f1: 55 }); K.burst(d, t + 0.14, { type: 'lowpass', f: 700, q: 0.7, vol: 0.4, tau: 0.02 });
      K.mode(d, t + 0.14, 230, 0.06, 0.03);
    }),
    gutter: () => snd((t, K) => { const d = K.at(HALL); K.mode(d, t, 170, 0.18, 0.04, { f1: 120 }); K.burst(d, t, { type: 'bandpass', f: 450, q: 0.9, vol: 0.3, tau: 0.02 }); K.mode(d, t, 420, 0.05, 0.02); }),
    // the ball dropping off the deck into the pit: a padded thump and the curtain swaying
    pit: (hit) => snd((t, K) => {
      const d = K.at(HALL);
      K.mode(d, t + 0.05, 75, 0.3, 0.08, { f1: 45 }); K.burst(d, t + 0.05, { type: 'lowpass', f: 380, q: 0.7, vol: hit ? 0.25 : 0.45, tau: 0.04, buf: 'brown' });
      if (!hit) K.burst(d, t + 0.1, { type: 'bandpass', f: 600, f1: 250, q: 0.5, vol: 0.12, tau: 0.08, dur: 0.35 });
    }),
    // the sweep bar dropping and raking the deck
    sweep: () => snd((t, K) => {
      const d = K.at({ ...HALL, send: 0.6 });
      K.mode(d, t, 140, 0.08, 0.04); K.burst(d, t, { type: 'bandpass', f: 1800, q: 1.5, vol: 0.08, tau: 0.01 });
      K.burst(d, t + 0.2, { type: 'bandpass', f: 800, f1: 450, q: 0.6, vol: 0.12, tau: 0.06, dur: 0.4, attack: 0.05 });
      K.sweep(d, t + 0.15, { f0: 95, f1: 120, dur: 0.6, vol: 0.03, type: 'triangle', attack: 0.1 });  // the motor
    }),
    // the rack lowered: a motor whine, then ten pins set on the deck in a quick ripple of wooden clicks
    setter: () => snd((t, K) => {
      const d = K.at({ ...HALL, send: 0.6 });
      K.sweep(d, t, { f0: 160, f1: 230, dur: 0.38, vol: 0.025, type: 'triangle', attack: 0.08 });
      for (let i = 0; i < 10; i++) {
        const dt = 0.36 + i * K.R(0.008, 0.016), d2 = K.at({ ...HALL, pan: K.R(-0.5, 0.5), vol: 0.45 });
        K.burst(d2, t + dt, { type: 'bandpass', f: K.R(2200, 3200), q: 1.6, vol: 0.1, tau: 0.003 });
        K.mode(d2, t + dt, K.vary(PIN_F[i], 0.04), 0.03, 0.02);
      }
    }),
    // the ball's ride back under the lanes: a long low whirr and rumble
    whirr: () => snd((t, K) => {
      const d = K.at({ ...HALL, send: 0.4 });
      K.sweep(d, t, { f0: 80, f1: 140, dur: 1.7, vol: 0.02, type: 'triangle', attack: 0.4 });
      K.burst(d, t, { type: 'lowpass', f: 260, f1: 420, q: 0.8, vol: 0.18, tau: 0.25, dur: 1.7, attack: 0.5, buf: 'brown' });
    }),
    // and up the hood: a knock as it meets the balls already there
    clunk: () => snd((t, K) => {
      const d = K.at({ ...HALL, pan: 0.5 });
      K.mode(d, t, 210, 0.2, 0.035); K.mode(d, t, 610, 0.06, 0.015); K.burst(d, t, { type: 'bandpass', f: 1600, q: 1.2, vol: 0.22, tau: 0.006 });
      K.mode(d, t + 0.11, 180, 0.09, 0.03); K.burst(d, t + 0.11, { type: 'bandpass', f: 1800, q: 1.2, vol: 0.1, tau: 0.005 });
    }),
    // a rival's lane: the same crash, far off to the side and mostly room
    far: (n) => snd((t, K) => {
      const d = K.at({ room: 'hall', send: 1.4, pan: K.R(-0.9, 0.9), vol: 0.22 });
      K.mode(d, t, 85, 0.2, 0.06);
      for (let i = 0; i < Math.min(n, 7); i++) { const dt = 0.03 + i * K.R(0.02, 0.045); K.burst(d, t + dt, { type: 'bandpass', f: K.R(1800, 3400), q: 1.3, vol: 0.14, tau: 0.004 }); K.mode(d, t + dt, K.R(560, 760), 0.05, 0.025); }
    }),
  };
  // where the timeline of a phase is: 0 before, 1 after, smoothly between
  const ph = (u, [a, b]) => { const t = Math.min(1, Math.max(0, (u - a) / (b - a))); return t * t * (3 - 2 * t); };
  const powerCss = (t, a = 1) => `hsla(${((1 - Math.min(1, Math.max(0, t))) * 120).toFixed(0)}, 90%, 55%, ${a})`;

  function mount(main, side) {
    gl = null; flat = null; anim = null; seen = 0; primed = false; drag = null; holdUntil = 0; saver = false;
    main.innerHTML = `<div class="ln"><div class="ln-hud"><span id="lnFrame"></span><span id="lnTotal"></span></div>
      <div class="ln-rivals" id="lnRivals"></div>
      <div class="ln-stage" id="lnStage"><div class="ln-word" id="lnWord" hidden></div><div class="ln-speed" id="lnSpeed" hidden></div><div class="ln-power" id="lnPower" hidden><span></span></div></div>
      <div class="ln-ctl">
        <div class="ln-row"><span class="ln-lbl">🧍 Stand</span>
          <div class="ln-dial"><button data-st="-1" aria-label="Stand further left">◀</button><b id="lnStart"></b><button data-st="1" aria-label="Stand further right">▶</button></div>
          <button class="ln-saver ghost-btn" id="lnSaver" hidden title="If this ball leaves exactly one pin, it falls too (once a game)">🎯 Spare saver</button>
        </div>
        <div class="ln-row"><span class="ln-lbl">🌀 Hook</span><span class="ln-end">⟲</span>
          <input type="range" id="lnSpin" min="-100" max="100" step="5" aria-label="Hook: left to right"><span class="ln-end">⟳</span><b id="lnSpinV" class="ln-spinv"></b></div>
      </div>
      <p id="lnHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scoresheet</h3><div id="lnSheet" class="ln-sheet"></div></div>';
    $('lnSpin').value = Math.round(-spin * 100);
    main.querySelector('.ln-ctl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.st) start = Math.max(-0.4, Math.min(0.4, Math.round((start + +b.dataset.st * 0.04) * 100) / 100));
      else if (b.id === 'lnSaver') saver = !saver;
      controls();
    });
    $('lnSpin').addEventListener('input', (e) => { spin = -e.target.value / 100; controls(); });
    const stage = $('lnStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canBowl()) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointermove', (e) => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; } });
    stage.addEventListener('pointerup', () => {
      const r = aimed(); drag = null; $('lnPower').hidden = true;
      if (r && r.speed > 0.08 && canBowl()) bowl(r);
    });
    stage.addEventListener('pointercancel', () => { drag = null; $('lnPower').hidden = true; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); raf = 0; rumble(0); hum = null; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; ret = null; }

  // the drag: back = faster, sideways = the line (slingshot: drag left to send it right)
  function aimed() {
    if (!drag) return null;
    const st = $('lnStage'), h = st.clientHeight || 400, w = st.clientWidth || 300;
    const pull = drag.y - drag.y0, side = drag.x0 - drag.x;
    if (pull < 8) return null;
    return { speed: Math.min(1, pull / Math.max(90, h * 0.38)), angle: Math.max(-MAXA, Math.min(MAXA, (side / Math.max(120, w * 0.6)) * MAXA)) };
  }

  // #131 the ball speed, as the alley's screen would show it
  const KMH = (sp) => (5.5 + 4 * sp) * 3.6;
  function showSpeed(kmh, top) {
    const el = $('lnSpeed'); if (!el || !kmh) return;
    el.innerHTML = `<b>${Math.round(kmh / 1.609)}</b> mph <i>${Math.round(kmh)} km/h</i>${top ? ' <em>⭐ top</em>' : ''}`;
    el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  function bowl(r) {
    rolledAt = performance.now();
    showSpeed(KMH(r.speed), KMH(r.speed) > (myRow()?.top || 0) + 0.05 && (myRow()?.top || 0) > 0);
    SND.release(); ctx.buzz?.(18);
    ret = null;  // picked up off the return
    const arm = saver && L().spare && L().saver;
    saver = false;
    ctx.quiet(ctx.act('bowl', { start: +start.toFixed(3), angle: +r.angle.toFixed(4), speed: +r.speed.toFixed(3), spin: +spin.toFixed(2), saver: !!arm }));
  }

  function controls() {
    $('lnStart').textContent = start === 0 ? 'centre' : `${start < 0 ? '◀' : '▶'} ${Math.round(Math.abs(start) * 100)}`;
    $('lnSpinV').textContent = Math.abs(spin) < 0.05 ? 'straight' : `${Math.round(Math.abs(spin) * 100)}% ${spin > 0 ? '⟲' : '⟳'}`;
    const sv = $('lnSaver');
    sv.hidden = !(L().spare && L().saver && L().me != null);
    sv.classList.toggle('on', saver);
  }

  // a frame's boxes on the scoresheet: X for a strike, / for a spare, - for a miss
  function marks(fr, last) {
    const out = [];
    let pinsUp = 10, fresh = true;  // (a gutter first ball leaves ten up, but the next ball is still ball 2)
    fr.forEach((n) => {
      if (fresh && n === 10) { out.push('X'); pinsUp = 10; fresh = true; }
      else if (!fresh && n === pinsUp) { out.push('/'); pinsUp = 10; fresh = true; }
      else { out.push(n === 0 ? '-' : String(n)); pinsUp = fresh ? 10 - n : 10; fresh = !fresh; }
    });
    return out;
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = L();
    settleAt = performance.now() + (v.busyIn || 0) * 1000; settled = !v.wait;
    if (!primed) { primed = true; seen = v.shot?.id ?? 0; }
    if (v.shot && v.shot.id !== seen) {
      seen = v.shot.id;
      // after the roll: a fresh rack if the frame is over (and I'm still bowling), else the leave set back down
      const done = myRow()?.done;
      ret = null;  // (an automatic roll never went through bowl())
      anim = { shot: v.shot, t0: performance.now(), hi: 0, said: false, hits: 0, gut: false, pit: false, post: 0,
        reset: !done && v.standing.length === 10, keep: done || v.standing.length === 10 ? new Set() : new Set(v.standing) };
    }
    const me = myRow();
    if (me) {
      const done = me.done, f = Math.min(me.frame, v.nframes - 1);
      $('lnFrame').textContent = done ? '🏁 All frames bowled' : `🎳 Frame ${f + 1} of ${v.nframes} · ball ${me.ball + 1}${f === v.cosmic ? ' · 🌟 COSMIC' : ''}`;
      $('lnFrame').classList.toggle('ln-cosmic', f === v.cosmic && !done);
      $('lnTotal').textContent = `Score ${me.total}`;
    } else { $('lnFrame').textContent = '👀 Watching'; $('lnTotal').textContent = ''; }
    renderRivals(); renderSheet(); controls(); hint();
  }

  function hint() {
    const v = L();
    let t = '';
    if (S.phase === 'playing' && v.me != null) {
      if (v.wait && v.wait !== SETTLE) t = v.wait;
      else if (canBowl()) t = gl || flat ? 'Drag back from anywhere on the lane and let go. Sideways sets the line; further back is faster.' : '';
    }
    if ($('lnHint').textContent !== t) $('lnHint').textContent = t;
  }

  function renderRivals() {
    const v = L(), box = $('lnRivals'); box.innerHTML = '';
    for (const r of v.rows) {
      if (r.id === S.me?.id) continue;
      const chip = ctx.el('span', 'ln-rival');
      chip.style.setProperty('--c', colorOf(r.id));
      chip.append(ctx.el('b', '', ctx.player(r.id)?.name ?? '?'), ctx.el('span', '', r.done ? `🏁 ${r.total}` : `F${r.frame + 1} · ${r.total}`));
      if (r.last && Date.now() / 1000 - r.last.at < 4) chip.append(ctx.el('em', 'ln-pop', r.last.word === 'strike' ? 'X' : r.last.word === 'spare' ? '/' : String(r.last.n)));
      box.append(chip);
    }
  }

  function renderSheet() {
    const v = L(), box = $('lnSheet'); box.innerHTML = '';
    const t = ctx.el('table', 'ln-tab');
    const head = ctx.el('tr'); head.append(ctx.el('th', '', ''));
    for (let f = 0; f < v.nframes; f++) head.append(ctx.el('th', f === v.cosmic ? 'ln-cos' : '', f === v.cosmic ? `🌟${f + 1}` : String(f + 1)));
    head.append(ctx.el('th', '', 'Σ'));
    t.append(head);
    for (const r of v.rows) {
      const tr = ctx.el('tr', r.id === S.me?.id ? 'me' : '');
      const nm = ctx.el('td', 'ln-nm', ctx.player(r.id)?.name ?? '?'); nm.style.color = colorOf(r.id);
      tr.append(nm);
      for (let f = 0; f < v.nframes; f++) {
        const td = ctx.el('td', 'ln-f' + (f === r.frame && !r.done ? ' now' : ''));
        const fr = r.frames[f];
        const m = fr ? marks(fr, f === v.nframes - 1) : [];
        const balls = ctx.el('div', 'ln-balls');
        (m.length ? m : [' ']).forEach((x) => balls.append(ctx.el('span', x === 'X' ? 'ln-x' : x === '/' ? 'ln-sp' : x === '-' ? 'ln-miss' : '', x)));
        td.append(balls, ctx.el('div', 'ln-cum', r.cum[f] != null ? String(r.cum[f]) : ' '));
        tr.append(td);
      }
      tr.append(ctx.el('td', 'ln-tot', String(r.total)));
      if (r.top) tr.title = `Top ball speed ${Math.round(r.top / 1.609)} mph`;
      t.append(tr);
    }
    box.append(t);
    box.append(ctx.el('p', 'hint left', `🌟 Frame ${v.cosmic + 1} is cosmic: a strike or spare in it scores +10 more.`));
    const me = myRow();
    if (me?.top) box.append(ctx.el('p', 'hint left', `🚀 Your fastest ball: ${Math.round(me.top / 1.609)} mph (${Math.round(me.top)} km/h).`));
    box.append(ctx.el('p', 'hint left', `🛢️ The faint sheen down the middle is the oil: the ball skids on it and only hooks once it reaches the dry boards. Your lane's oil is ${v.oil} m long` + (v.oil0 - v.oil >= 0.05 ? ` (📉 down from ${v.oil0}: it breaks down as you bowl, so the hook starts earlier — ease the spin or aim a little right of where you did).` : '.')));
  }

  // where the ball, my pins, the sweep bar and the pinsetter are right now
  function scene(now) {
    const v = L();
    if (!anim) {
      return { ball: null, pins: v.standing.map((k) => ({ k, x: v.lane.spots[k][0], y: v.lane.spots[k][1], fall: 0 })), bar: null, setter: null };
    }
    const st = rolling(now, v), sh = anim.shot, u = ((now - anim.t0) / 1000) * FPS - sh.frames;
    if (u < 0) return { ...st, bar: null, setter: null };
    // the sweep bar: down in front of the head pin, back to the pit, up again
    const front = v.lane.head - 0.32, back = v.lane.pit + 0.12;
    const bar = { h: 0.95 - 0.85 * ph(u, BAR.drop) + 0.85 * ph(u, BAR.lift), y: front + (back - front) * ph(u, BAR.sweep) };
    const lift = 0.5 * ph(u, BAR.drop) - 0.5 * ph(u, [BAR.lift[0], BAR.lift[1] + 4]);  // the setter holding the spare leave up
    const pins = [];
    for (const p of st.pins) {
      if (anim.keep.has(p.k) && !p.gone && p.fall < 0.5) { pins.push({ ...p, fall: 0, dx: 0, dy: 1, lift }); continue; }
      if (p.gone) continue;
      if (u > BAR.drop[1]) p.y = Math.max(p.y, bar.y + 0.08);  // pushed along in front of the bar
      if (p.y < v.lane.pit + 0.05) pins.push(p);
    }
    // a fresh rack comes down from the masking unit
    let setter = null;
    if (anim.reset && u >= SET[0]) {
      const drop = 0.75 * (1 - ph(u, SET));
      setter = { h: drop + 0.4 + 0.45 * ph(u, [SET[1], POST]) };
      pins.length = 0;  // (the old rack is all in the pit by now: the bar reached the back at BAR.sweep's end)
      for (let k = 0; k < 10; k++) pins.push({ k, x: v.lane.spots[k][0], y: v.lane.spots[k][1], fall: 0, lift: drop });
    }
    return { ball: st.ball, pins, bar: bar.h < 0.94 ? bar : null, setter };
  }

  // the roll itself, played back from the server's tracks
  function rolling(now, v) {
    const sh = anim.shot, f = ((now - anim.t0) / 1000) * FPS;
    const bf = sh.tracks.ball, bi = Math.min(bf.length - 1, Math.max(0, Math.floor(f)));
    const ball = f < bf.length + 2 ? { x: bf[bi][0], y: bf[bi][1], f } : null;
    const tr = new Map(sh.tracks.pins.map((t) => [t.k, t]));
    const pins = sh.before.map((k) => {
      const t = tr.get(k);
      const p = { k, x: v.lane.spots[k][0], y: v.lane.spots[k][1], fall: 0, dx: 0, dy: 1 };
      if (t) {
        const i = Math.floor(f - t.s);
        if (i >= 0) {
          const a = t.f[Math.min(t.f.length - 1, i)], b = t.f[Math.min(t.f.length - 1, i + 3)];
          p.x = a[0]; p.y = a[1]; p.dx = b[0] - t.f[0][0]; p.dy = b[1] - t.f[0][1];
          p.fall = Math.min(1, (i + 1) / 7);
          if (t.out && i >= t.f.length - 1) p.gone = true;
        }
      }
      if (sh.saved === k && f > sh.frames - 6) { p.fall = Math.min(1, (f - sh.frames + 6) / 7); p.dx = 0.3; p.dy = 0.5; }
      return p;
    });
    return { ball, pins };
  }

  function loop(now) {
    if (!$('lnStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.lanes) return;
    if (anim) {
      const f = ((now - anim.t0) / 1000) * FPS, sh = anim.shot, ln = L().lane, bf = sh.tracks.ball;
      // the ball's rumble follows its speed down the lane, hollow in the gutter, and stops in the pit
      const bi = Math.floor(f);
      if (bi >= 1 && bi < bf.length) {
        const [x0, y0] = bf[bi - 1], [x1, y1] = bf[bi], inGut = Math.abs(x1) > ln.w / 2;
        if (inGut && !anim.gut) { anim.gut = true; SND.gutter(); }
        rumble(y1 < ln.pit ? Math.min(1, Math.hypot(x1 - x0, y1 - y0) / 0.3) : 0, inGut);
      } else rumble(0);
      if (!anim.pit && bi >= bf.length - 1) { anim.pit = true; SND.pit(sh.knocked.length > 0); }
      // each pin tocks as it's hit, after a thump for the ball meeting the rack
      const hits = sh.tracks.pins.map((t) => t.s).sort((a, b) => a - b);
      if (anim.hi === 0 && hits.length && f >= hits[0]) { anim.hi = 1; crash(sh.knocked.length, bf[Math.min(bf.length - 1, bi)]?.[0]); if (sh.knocked.length >= 7) gl?.shake(); }
      if (!anim.order) anim.order = sh.tracks.pins.slice().sort((a, b) => a.s - b.s);
      while (anim.hits < hits.length && f >= hits[anim.hits]) {
        const pt = anim.order[anim.hits], px = pt?.f?.[0]?.[0] ?? 0;
        tock(Math.max(0.35, 1 - anim.hits * 0.06), 0, pt?.k ?? -1, px);
        if (anim.hits % 3 === 1) tock(0.4, 0.03 + Math.random() * 0.05, -1, px);
        anim.hits++;
      }
      if (!anim.said && f >= sh.frames) {
        anim.said = true;
        const w = sh.word === 'strike' ? 'STRIKE!' : sh.word === 'spare' ? 'SPARE!' : sh.gutter && !sh.knocked.length ? 'Gutter…' : `${sh.knocked.length}`;
        word(w, sh.word);
        const mine = myRow();
        if (mine?.done) setTimeout(() => { if ($('lnWord')) word(`🏁 ${mine.total}`, 'final', 2600); }, 1300);  // the final score, before the game ends (#130)
        if (sh.word === 'strike') { ctx.sfx?.('fanfare'); ctx.confetti?.(); } else if (sh.word === 'spare') ctx.sfx?.('good');
      }
      // the pinsetter, then the ball coming back up the return
      const u = f - sh.frames;
      if (anim.post === 0 && u >= BAR.drop[0]) { anim.post = 1; SND.sweep(); }
      if (anim.post === 1 && anim.reset && u >= SET[0]) { anim.post = 2; SND.setter(); }
      if (!ret && u >= 4 && gl) { ret = { t0: now }; SND.whirr(); }
      if (u >= POST) { anim = null; holdUntil = now + 250; controls(); hint(); }
    }
    if (ret?.t0 && now - ret.t0 > RETURN_MS) { ret = { rest: true }; SND.clunk(); }
    if (!settled && !anim && now >= settleAt && now > holdUntil) { settled = true; controls(); hint(); }
    const r = aimed(), bar = $('lnPower');
    bar.hidden = !r;
    if (r) { const fill = bar.firstElementChild; fill.style.height = `${r.speed * 100}%`; fill.style.background = powerCss(r.speed); }
    const idle = !anim && !drag && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    still = idle;  // idle redraws are drawn sharp and kept out of the frame-rate watch (#107/#109)
    (gl || flat)?.draw(now, scene(now), r);
  }

  function word(text, kind, ms = 1500) {
    const w = $('lnWord'); if (!w) return;
    w.textContent = text; w.className = `ln-word ${kind || ''}`; w.hidden = false;
    w.style.animationDuration = `${ms}ms`;
    clearTimeout(word.t); word.t = setTimeout(() => { w.hidden = true; }, ms);
  }

  // ---------- three.js: world x = lane x, world z = -lane y, y up. My lane at x = 0, rivals either side.
  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) paint(g, w, h);
    const t = new T.CanvasTexture(c); t.anisotropy = 8; return t;
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const v0 = L(), ln = v0.lane, W = ln.w, HEAD = ln.head, PIT = ln.pit, PITCH = W + 0.75, R = ln.ballR;
    const scene = new T.Scene(); scene.background = new T.Color(0x0e0a1c);
    const camera = new T.PerspectiveCamera(30, 1, 0.05, 120);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.05, hemi: [0xfff1e0, 0x24163a, 0.75],
      key: { i: 0.75, pos: [1.5, 8, -HEAD + 3], area: 2.2, near: 1, far: 20 },
      env: { walls: 0x1a1030, lamp: 0xfff4e6, accent: 0xffd9b0, floor: 0x3a2412 },  // (a pink accent read as a pink patch in the oil, #132)
      sky: { top: 0x07040f, horizon: 0x2b1650, bottom: 0x0e0a1c, band: 0.1 },
    });
    stg.key.target.position.set(0, 0, -HEAD);
    const low = stg.low;
    const len = PIT + 3, zMid = -(len / 2 - 1.5);
    const disposables = [];
    // #117 the lane: maple boards at the front and on the pin deck, pine down the middle, each board its own
    // shade with a fine grain; the arrows, dots, range finders and pin spots; a clear coat that's glossy where it's
    // oiled (the front two thirds) and duller on the dry back end
    const TW = low ? 128 : 256, TH = low ? 2048 : 4096;
    // #137 the oil pattern for this game's Oil setting: heaviest down the middle boards, tapering to the edges
    // and ending earlier out there (a "Christmas tree"), out to the setting's oil length. 0..1 by board and
    // distance from the foul line. The clear coat is glossy where it's oiled, duller on the dry back end.
    const OILL = v0.oil0 || v0.oil || 12;
    const oilAt = (b, d) => {
      const c = 1 - Math.min(1, Math.abs(b - 19) / 19.5), end = OILL * (0.55 + 0.45 * c);
      if (d < 0 || d > end + 0.8) return 0;
      return (0.35 + 0.65 * c) * (d < end ? 1 : 1 - (d - end) / 0.8);
    };
    const wood = canvasTex(T, TW, TH, (g, w, h) => {
      const boards = 39, bw = w / boards, Y = (y) => h - ((y + 1.5) / len) * h;
      const pine = [Y(HEAD - 0.6), Y(4.6)];  // (canvas y runs the other way)
      for (let b = 0; b < boards; b++) {
        const tone = Math.random() * 8;
        g.fillStyle = `hsl(33, 52%, ${64 + tone}%)`; g.fillRect(b * bw, 0, bw, h);
        g.fillStyle = `hsl(27, 50%, ${55 + tone}%)`; g.fillRect(b * bw, pine[0], bw, pine[1] - pine[0]);
        g.fillStyle = 'rgba(80,45,15,.22)'; g.fillRect(b * bw, 0, Math.max(0.6, bw * 0.08), h);
        for (let i = 0; i < (low ? 40 : 110); i++) {
          g.fillStyle = `rgba(${110 + Math.random() * 30},${60 + Math.random() * 20},25,${0.04 + Math.random() * 0.1})`;
          g.fillRect(b * bw + Math.random() * bw, Math.random() * h, 0.5 + Math.random() * 0.6, 30 + Math.random() * 120);
        }
        // the joins where the boards are butted end to end
        for (let j = 0; j < 3; j++) { g.fillStyle = 'rgba(70,40,15,.25)'; g.fillRect(b * bw, Math.random() * h, bw, 1); }
      }
      g.fillStyle = 'rgba(70,35,10,.35)'; g.fillRect(0, pine[0] - 1, w, 2); g.fillRect(0, pine[1] - 1, w, 2);
      g.fillStyle = '#3a1d0e';
      const sc = w / 128;
      for (const bd of [5, 10, 15, 20, 25, 30, 35]) {  // the arrows, about 4.5 m out
        const x = (bd / boards) * w, y = Y(4.5 + Math.abs(bd - 20) * 0.08);
        g.beginPath(); g.moveTo(x, y - 14 * sc); g.lineTo(x - 2.4 * sc, y + 4 * sc); g.lineTo(x + 2.4 * sc, y + 4 * sc); g.closePath(); g.fill();
      }
      for (const bd of [3, 5, 8, 11, 14, 25, 28, 31, 34, 36]) { g.beginPath(); g.arc((bd / boards) * w, Y(2.1), 1.4 * sc, 0, 7); g.fill(); }
      for (const bd of [10, 30]) g.fillRect((bd / boards) * w - sc, Y(12.2), 2 * sc, 18 * sc);  // range finders
      g.fillStyle = '#b3121c'; g.fillRect(0, Y(0) - 5 * sc, w, 10 * sc);  // the foul line (#134), and a mesh strip over it
      // the oil: a faint cool sheen you can just make out, strongest down the middle (#137)
      for (let b = 0; b < boards; b++) for (let d = 0; d < OILL + 1; d += 0.25) {
        const o = oilAt(b + 0.5, d); if (o <= 0) continue;
        g.fillStyle = `rgba(235,245,255,${(0.07 * o).toFixed(3)})`; g.fillRect(b * bw, Y(d + 0.25), bw, Y(d) - Y(d + 0.25) + 0.5);
      }
      g.fillStyle = 'rgba(60,30,10,.35)'; for (const [sx, sy] of ln.spots) { g.beginPath(); g.arc(w / 2 + (sx / W) * w, Y(sy), 3 * sc, 0, 7); g.fill(); }
    });
    const laneMat = new T.MeshStandardMaterial({ map: wood, roughness: low ? 0.2 : 1, metalness: 0, emissive: 0x000000, envMapIntensity: 0.9 });
    if (!low) {
      laneMat.roughnessMap = canvasTex(T, 39, 256, (g, w, h) => {
        for (let y = 0; y < h; y++) {
          const d = (1 - y / h) * len - 1.5;  // distance from the foul line
          for (let b = 0; b < w; b++) {
            const r = d < 0 ? 0.4 : 0.3 - 0.24 * oilAt(b + 0.5, d);
            g.fillStyle = `rgb(0,${Math.round(r * 255)},0)`; g.fillRect(b, y, 1, 1);
          }
        }
      });
    }
    const gutterMat = new T.MeshStandardMaterial({ color: 0x2a2733, roughness: 0.35, metalness: 0.55, side: T.DoubleSide });
    const capMat = new T.MeshStandardMaterial({ color: 0x23212b, roughness: 0.4, metalness: 0.2 });  // (was purple: with its pink edge it read as part of the lane, #132)
    const glowMats = [0x9b6bff, 0x4cc9f0].map((c) => new T.MeshBasicMaterial({ color: c, toneMapped: false }));
    // #136 a tenpin's turned profile (radius, height in m): the base, the belly at 11 cm, the neck at 25 cm, the head
    const PH = 0.381;
    const pinGeo = (() => {
      const pr = [[0, 0], [0.025, 0], [0.033, 0.004], [0.044, 0.022], [0.054, 0.05], [0.0595, 0.085], [0.0605, 0.114], [0.0585, 0.145],
        [0.051, 0.178], [0.04, 0.207], [0.03, 0.23], [0.0235, 0.25], [0.0228, 0.265], [0.025, 0.285], [0.029, 0.31], [0.0318, 0.333],
        [0.0315, 0.35], [0.0275, 0.366], [0.019, 0.376], [0.008, 0.3805], [0, PH]];
      const geo = new T.LatheGeometry(pr.map(([x, y]) => new T.Vector2(x, y)), low ? 16 : 32);
      // (a lathe's v runs by profile point, not height: the stripes used to land on the head. Map v to height.)
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / PH);
      return geo;
    })();
    const pinTex = canvasTex(T, 64, 256, (g, w, h) => {
      const at = (y) => h * (1 - y / PH);  // canvas y for a height on the pin (the texture's flipped: top is the head)
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fffefb'); gr.addColorStop(1, '#f1ede4');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c0262d'; g.fillRect(0, at(0.262), w, at(0.252) - at(0.262)); g.fillRect(0, at(0.245), w, at(0.235) - at(0.245));
      g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, at(0.006), w, h - at(0.006));  // the scuffed base
    });
    const pinMat = new T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ map: pinTex, roughness: 0.3, clearcoat: low ? 0 : 0.8, clearcoatRoughness: 0.12, metalness: 0, emissive: 0x000000 })
      : new T.MeshStandardMaterial({ map: pinTex, roughness: 0.22, metalness: 0, emissive: 0x000000 });
    // shared pieces of every lane
    const deckGeo = new T.PlaneGeometry(W, len);
    const gutGeo = new T.CylinderGeometry(0.12, 0.12, len, 12, 1, true, 0, Math.PI);
    const divW = PITCH - W - 0.48, divGeo = new T.BoxGeometry(divW, 0.07, len);
    const edgeGeo = new T.BoxGeometry(0.012, 0.006, len);
    const pitGeo = new T.BoxGeometry(PITCH, 0.9, 0.2), pitMat = new T.MeshStandardMaterial({ color: 0x0d0816, roughness: 0.95 });
    const maskGeo = new T.BoxGeometry(PITCH, 0.62, 1.2), maskMat = new T.MeshStandardMaterial({ color: 0x23163d, roughness: 0.5 });
    const faceGeo = new T.PlaneGeometry(PITCH - 0.02, 0.6);
    const stripGeo = new T.BoxGeometry(PITCH - 0.12, 0.025, 0.025), stripMat = new T.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false });
    const barGeo = new T.BoxGeometry(W + 0.36, 0.17, 0.05), barMat = new T.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4,
      map: canvasTex(T, 256, 32, (g, w, h) => {  // brushed steel with a black-and-amber band along the bottom
        g.fillStyle = '#9b9ca6'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(0, Math.random() * h, w, 1); }
        for (let x = -h; x < w; x += 16) { g.fillStyle = '#f2b705'; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 8, h); g.lineTo(x + 8 + 10, h * 0.55); g.lineTo(x + 10, h * 0.55); g.fill(); }
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h * 0.55, w, 1);
      }) });
    const setGeo = new T.BoxGeometry(W + 0.1, 0.05, 1.05), setMat = new T.MeshStandardMaterial({ color: 0x55525e, roughness: 0.5, metalness: 0.5 });
    const deckZ = -(ln.spots.reduce((a, s) => a + s[1], 0) / ln.spots.length);
    // #145 the pinsetter in more detail. The sweep bar: the steel beam with a black rubber pad along its face, carried on
    // two arms that rise to pivots in the masking unit. The spotting table: a plate with ten pin cups under it in the
    // rack's triangle, a frame round its edge and four guide rods it rides down on.
    const armMat = new T.MeshStandardMaterial({ color: 0x3a3b44, roughness: 0.45, metalness: 0.6 });
    const padMat = new T.MeshStandardMaterial({ color: 0x111114, roughness: 0.9 });
    const padGeo = new T.BoxGeometry(W + 0.3, 0.08, 0.025), armGeo = new T.BoxGeometry(0.05, 1.0, 0.05), pivotGeo = new T.CylinderGeometry(0.045, 0.045, 0.09, 12);
    pivotGeo.rotateZ(Math.PI / 2);
    function makeBar() {
      const g = new T.Group(), beam = new T.Mesh(barGeo, barMat); beam.castShadow = !low; g.add(beam);
      const pad = new T.Mesh(padGeo, padMat); pad.position.set(0, -0.045, 0.035); g.add(pad);
      for (const sx of [-1, 1]) {
        const arm = new T.Mesh(armGeo, armMat); arm.position.set(sx * (W / 2 + 0.2), 0.5, -0.01); g.add(arm);
        const piv = new T.Mesh(pivotGeo, armMat); piv.position.set(sx * (W / 2 + 0.2), 0.98, -0.01); g.add(piv);
        const brace = new T.Mesh(new T.BoxGeometry(0.03, 0.03, 0.22), armMat); brace.position.set(sx * (W / 2 + 0.2), 0.12, -0.12); brace.rotation.x = 0.5; g.add(brace);
      }
      return g;
    }
    const cupGeo = new T.CylinderGeometry(0.07, 0.06, 0.07, low ? 8 : 16, 1, true), cupMat = new T.MeshStandardMaterial({ color: 0x8a8c96, roughness: 0.35, metalness: 0.7, side: T.DoubleSide });
    const rodGeo = new T.CylinderGeometry(0.016, 0.016, 1.2, 8), rimGeo = new T.BoxGeometry(W + 0.14, 0.035, 0.035), rimGeo2 = new T.BoxGeometry(0.035, 0.035, 1.07);
    function makeSetter() {
      const g = new T.Group(), plate = new T.Mesh(setGeo, setMat); plate.castShadow = !low; g.add(plate);
      for (const [px, py] of ln.spots) { const c = new T.Mesh(cupGeo, cupMat); c.position.set(px, -0.06, -py - deckZ); g.add(c); }
      for (const sz of [-1, 1]) { const r = new T.Mesh(rimGeo, armMat); r.position.set(0, 0.03, sz * 0.52); g.add(r); }
      for (const sx of [-1, 1]) { const r = new T.Mesh(rimGeo2, armMat); r.position.set(sx * (W / 2 + 0.05), 0.03, 0); g.add(r); }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const rod = new T.Mesh(rodGeo, armMat); rod.position.set(sx * (W / 2 - 0.05), 0.62, sz * 0.45); g.add(rod); }
      return g;
    }
    // the fascia on the masking unit: a glowing lane number and a starfield (#117)
    const fascia = (num) => {
      const t = canvasTex(T, 512, 160, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a0f4a'); gr.addColorStop(1, '#10061f');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
        g.strokeStyle = '#4cc9f0'; g.lineWidth = 3; g.shadowColor = '#4cc9f0'; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(0, h - 8); g.lineTo(w, h - 8); g.stroke();
        g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.shadowColor = '#ff4fa3'; g.shadowBlur = 18; g.fillStyle = '#ffd6ee';
        g.fillText(String(num), w / 2, 112);
        g.font = 'bold 26px sans-serif'; g.shadowBlur = 8; g.fillStyle = '#ffe9a8';
        g.fillText('★', w * 0.18, 92); g.fillText('★', w * 0.82, 92);
      });
      disposables.push(t);
      return new T.MeshBasicMaterial({ map: t, color: 0xdddddd });
    };
    const lanes = [];  // [{x, grp, pins: [mesh x10], bar, setter, id}]
    function buildLane(x, empty) {
      const grp = new T.Group(); grp.position.x = x;
      const deck = new T.Mesh(deckGeo, laneMat); deck.rotation.x = -Math.PI / 2; deck.position.z = zMid; deck.receiveShadow = true; grp.add(deck);
      for (const sx of [-1, 1]) {
        const gut = new T.Mesh(gutGeo, gutterMat);
        gut.rotation.set(Math.PI / 2, 0, -Math.PI / 2, 'ZYX');  // a half pipe along the lane, open side up
        gut.position.set(sx * (W / 2 + 0.12), 0, zMid); grp.add(gut);
      }
      // the capping between this lane and the next on the right (and on my lane's left too), with neon edges
      for (const dx of x === 0 ? [-1, 1] : [1]) {
        const div = new T.Mesh(divGeo, capMat); div.position.set(dx * PITCH / 2, 0.035, zMid); grp.add(div);
        if (!low) for (const sx of [-1, 1]) { const e = new T.Mesh(edgeGeo, glowMats[(Math.round(x / PITCH) + 9 + (dx < 0 ? 1 : 0)) % 2]); e.position.set(dx * PITCH / 2 + sx * (divW / 2 - 0.01), 0.072, zMid); grp.add(e); }
      }
      const pit = new T.Mesh(pitGeo, pitMat); pit.position.set(0, 0.45, -PIT - 0.4); grp.add(pit);
      // the masking unit over the pins, its fascia facing the bowler, and the pin-deck light under it
      const mask = new T.Mesh(maskGeo, maskMat); mask.position.set(0, 1.05, -PIT + 0.2); grp.add(mask);
      if (!low) { const f = new T.Mesh(faceGeo, fascia(12 + Math.round(x / PITCH))); f.position.set(0, 1.05, -PIT + 0.805); grp.add(f); }
      const strip = new T.Mesh(stripGeo, stripMat); strip.position.set(0, 0.73, -PIT + 0.8); grp.add(strip);
      let pins;
      if (empty) {  // a lane nobody's on: a still rack, one draw call
        const im = new T.InstancedMesh(pinGeo, pinMat, 10), m4 = new T.Matrix4(); im.castShadow = false;
        ln.spots.forEach(([px, py], k) => im.setMatrixAt(k, m4.makeTranslation(px, 0, -py)));
        grp.add(im); pins = [];
      } else {
        pins = ln.spots.map(([px, py]) => { const m = new T.Mesh(pinGeo, pinMat); m.position.set(px, 0, -py); m.castShadow = !low; m.receiveShadow = !low; grp.add(m); return m; });
      }
      const bar = empty ? null : makeBar(), setter = empty ? null : makeSetter();
      if (bar) { bar.visible = false; grp.add(bar); }
      if (setter) { setter.visible = false; setter.position.z = deckZ; grp.add(setter); }
      scene.add(grp);
      return { x, grp, pins, bar, setter, empty, ev: null };
    }
    lanes.push(buildLane(0));
    // #134 the foul line: a red strip right across the lane and gutters, lit a touch so it reads from the
    // approach, and the foul-light posts on the cappings either side
    {
      const fl = new T.Mesh(new T.BoxGeometry(W + 0.5, 0.004, 0.04), new T.MeshStandardMaterial({ color: 0xc8141f, emissive: 0x6a0610, roughness: 0.45 }));
      fl.position.set(0, 0.002, 0); scene.add(fl);
      const postMat = new T.MeshStandardMaterial({ color: 0x1b1426, roughness: 0.4, metalness: 0.4 }), eye = new T.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
      for (const sx of [-1, 1]) {
        const post = new T.Mesh(new T.BoxGeometry(0.05, 0.09, 0.05), postMat); post.position.set(sx * PITCH / 2, 0.115, 0); scene.add(post);
        const e = new T.Mesh(new T.BoxGeometry(0.052, 0.014, 0.02), eye); e.position.set(sx * PITCH / 2, 0.14, 0.016); scene.add(e);
      }
    }
    // soft contact shadows under my standing pins (all the shadow there is on Low graphics)
    const blobTex = canvasTex(T, 64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: low ? 1 : 0.6 });
    const blobs = ln.spots.map(([px, py]) => { const b = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), blobMat); b.rotation.x = -Math.PI / 2; b.position.set(px, 0.003, -py); scene.add(b); return b; });
    // #137 reflections (fine graphics): a mirrored copy of my pins and ball, drawn faintly only where the lane's
    // finish shows (a stencil: the lane deck marks its pixels, the pins and ball unmark theirs)
    let mirror = null;
    const stencil = (m, ref, func, op) => Object.assign(m, { stencilWrite: true, stencilRef: ref, stencilFunc: func, stencilZPass: op, stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp });
    if (!low) {
      stencil(laneMat, 1, T.AlwaysStencilFunc, T.ReplaceStencilOp);
      stencil(pinMat, 0, T.AlwaysStencilFunc, T.ReplaceStencilOp);
      const grp = new T.Group(); grp.scale.y = -1; scene.add(grp);
      const ghost = (map, color) => stencil(new T.MeshBasicMaterial({ map, color, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false }), 1, T.EqualStencilFunc, T.KeepStencilOp);
      const mMat = ghost(pinTex, 0xffffff);
      const pins = ln.spots.map(() => { const m = new T.Mesh(pinGeo, mMat); m.renderOrder = 2; grp.add(m); return m; });
      mirror = { grp, pins, ball: null, ghost };
    }
    // my lane's pin deck gets its own light, so the rack pops against the dark pit
    if (!low) { const dl = new T.PointLight(0xfff0d8, 1.1, 3.2, 2); dl.position.set(0, 0.72, -HEAD + 0.25); scene.add(dl); }
    // the room: dark carpet, a glowing approach, a back wall over the masking units with the sign, a ceiling of
    // can lights over the cappings, and neon stripes down the side walls
    const SPAN = PITCH * 5.5;
    const floor = new T.Mesh(new T.PlaneGeometry(SPAN * 2, len + 20), new T.MeshStandardMaterial({ color: 0x140e22, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.01, -(len / 2)); scene.add(floor);
    const approach = new T.Mesh(new T.PlaneGeometry(SPAN * 2, 4.5), new T.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.45 }));
    approach.rotation.x = -Math.PI / 2; approach.position.set(0, 0.001, 2.2); scene.add(approach);
    const wallMat = new T.MeshStandardMaterial({ color: 0x150b28, roughness: 0.85 });
    const back = new T.Mesh(new T.PlaneGeometry(SPAN * 2, 6), wallMat); back.position.set(0, 3, -PIT - 0.62); scene.add(back);
    const neonTex = canvasTex(T, 512, 64, (g, w, h) => {
      g.fillStyle = '#100820'; g.fillRect(0, 0, w, h);
      g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.shadowColor = '#ff4fa3'; g.shadowBlur = 16; g.fillStyle = '#ffd6ee';
      g.fillText('★ LANE NIGHT ★', w / 2, 46);
    });
    const neon = new T.Mesh(new T.PlaneGeometry(6, 0.75), new T.MeshBasicMaterial({ map: neonTex }));
    neon.position.set(0, 2.1, -PIT - 0.6); scene.add(neon);
    if (!low) {
      const ceil = new T.Mesh(new T.PlaneGeometry(SPAN * 2, len + 6), wallMat); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.2, -(len / 2)); scene.add(ceil);
      const nCan = 11 * 7, cans = new T.InstancedMesh(new T.CylinderGeometry(0.11, 0.11, 0.03, 16), new T.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false }), nCan), m4 = new T.Matrix4();
      let c = 0;
      for (let i = -5; i <= 5; i++) for (let j = 0; j < 7; j++) cans.setMatrixAt(c++, m4.makeTranslation(i * PITCH + PITCH / 2, 3.18, 1 - j * 3.2));
      scene.add(cans);
      for (const sx of [-1, 1]) {
        const wall = new T.Mesh(new T.PlaneGeometry(len + 6, 3.2), wallMat); wall.rotation.y = -sx * Math.PI / 2; wall.position.set(sx * SPAN, 1.6, -(len / 2)); scene.add(wall);
        [0.55, 2.4].forEach((y, i) => { const s = new T.Mesh(new T.BoxGeometry(0.04, 0.05, len + 6), glowMats[i]); s.position.set(sx * (SPAN - 0.03), y, -(len / 2)); scene.add(s); });
      }
      // blacklight specks on the back wall
      const n = 160, sp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { sp[i * 3] = (Math.random() * 2 - 1) * SPAN; sp[i * 3 + 1] = 1.5 + Math.random() * 1.6; sp[i * 3 + 2] = -PIT - 0.6; }
      const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(sp, 3));
      scene.add(new T.Points(pg, new T.PointsMaterial({ color: 0xb8a6ff, size: 0.03, toneMapped: false })));
    }
    // the ball, and the ball return on the capping to my right: a hood the ball rolls up into (#118)
    const ballTex = canvasTex(T, 256, 128, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`; g.lineWidth = 6 + Math.random() * 10; g.beginPath(); g.moveTo(Math.random() * w, 0); g.bezierCurveTo(Math.random() * w, h / 3, Math.random() * w, h * 2 / 3, Math.random() * w, h); g.stroke(); }
      g.fillStyle = '#111'; for (const [x, y] of [[0.5, 0.42], [0.46, 0.55], [0.54, 0.55]]) { g.beginPath(); g.arc(x * w, y * h, 6, 0, 7); g.fill(); }
    });
    const ballMat = new T.MeshStandardMaterial({ map: ballTex, color: new T.Color(colorOf(S.me?.id)), roughness: 0.12, metalness: 0.1 });
    const ballGeo = new T.SphereGeometry(R, 28, 18);
    const ball = new T.Mesh(ballGeo, ballMat); ball.castShadow = !low; scene.add(ball);
    const retBall = new T.Mesh(ballGeo, ballMat); retBall.visible = false; scene.add(retBall);
    if (mirror) {
      stencil(ballMat, 0, T.AlwaysStencilFunc, T.ReplaceStencilOp);
      mirror.ball = new T.Mesh(ballGeo, mirror.ghost(ballTex, ballMat.color)); mirror.ball.renderOrder = 2; mirror.grp.add(mirror.ball);
    }
    // (the ball rides the capping back, goes in under the hood and comes out onto the rack in front of it)
    const HX = PITCH / 2, HZ = 0.2, RACK = 0.22, RACKZ = HZ + 0.42;
    const hood = new T.Group(); hood.position.set(HX, 0, HZ); scene.add(hood);
    {
      const body = new T.Mesh(new T.BoxGeometry(0.42, 0.26, 0.6), capMat); body.position.y = 0.13; hood.add(body);
      const dome = new T.Mesh(new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: 0x4a2f7a, roughness: 0.3, metalness: 0.2 }));
      dome.scale.set(0.21, 0.14, 0.3); dome.position.y = 0.26; hood.add(dome);
      const rails = new T.Mesh(new T.BoxGeometry(0.24, RACK, 0.3), new T.MeshStandardMaterial({ color: 0xc8c8d0, roughness: 0.25, metalness: 0.9 }));
      rails.position.set(0, RACK / 2, 0.42); hood.add(rails);
      if (!low) { const g = new T.Mesh(new T.BoxGeometry(0.43, 0.02, 0.61), glowMats[1]); g.position.y = 0.04; hood.add(g); }
    }
    // the aim: a glowing strip along the line, as long as the roll is fast
    const stripeTex = canvasTex(T, 8, 64, (g, w, h) => { g.fillStyle = '#fff'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 9); });
    stripeTex.wrapT = T.RepeatWrapping;
    const aimGeo = new T.PlaneGeometry(0.05, 1); aimGeo.translate(0, 0.5, 0);
    const aimLine = new T.Mesh(aimGeo, new T.MeshBasicMaterial({ map: stripeTex, transparent: true, opacity: 0.9, depthWrite: false }));
    aimLine.rotation.order = 'YXZ';
    scene.add(aimLine);

    // rivals on the lanes either side, then (fine graphics) a couple of empty lanes beyond them, so the alley
    // feels like a big room
    let rivalKey = '';
    function syncRivals() {
      const others = L().rows.filter((r) => r.id !== S.me?.id);
      const key = others.map((r) => r.id).join(',');
      if (key === rivalKey) return;
      rivalKey = key;
      while (lanes.length > 1) { const l = lanes.pop(); scene.remove(l.grp); l.grp.traverse((o) => { if (o.material?.map && o.material.map !== wood && o.material.map !== pinTex) { o.material.map.dispose(); o.material.dispose(); } }); }
      const used = new Set([0]);
      others.forEach((r, i) => { const side = i % 2 ? 1 : -1, n = Math.floor(i / 2) + 1; const l = buildLane(side * n * PITCH); l.id = r.id; lanes.push(l); used.add(side * n); });
      if (!low) for (let n = -4; n <= 4; n++) if (!used.has(n) && Math.abs(n) <= Math.min(3, Math.max(...[...used].map(Math.abs)) + 2)) lanes.push(buildLane(n * PITCH, true));
    }
    // a rival lane: when their pins change, the ones that went down tip over, the sweep bar clears them and, if the
    // frame is over, a fresh rack is lowered (#118)
    function drawRival(l, now) {
      const r = L().rows.find((x) => x.id === l.id);
      if (!r) return;
      const up = new Set(r.standing), at = r.last?.at ?? 0;
      if (l.at === undefined) { l.at = at; l.up = up; }
      if (at !== l.at) {
        const reset = up.size === 10 && !r.done;
        const down = [...l.up].filter((k) => reset || r.done || !up.has(k));
        l.ev = { t: now, down: new Set(down), reset, dir: down.map(() => Math.random() * Math.PI * 2) };
        l.at = at; l.up = up;
        if (down.length) SND.far(down.length);
      }
      const ev = l.ev, e = ev ? (now - ev.t) / 1000 : 9;
      if (ev && e > 1.7) l.ev = null;
      const u = e * FPS - 14;  // the bar's timeline starts once the pins have tipped
      const front = HEAD - 0.32, back = PIT + 0.12;
      const barY = front + (back - front) * ph(u, BAR.sweep), barH = 0.95 - 0.85 * ph(u, BAR.drop) + 0.85 * ph(u, BAR.lift);
      l.bar.visible = !!ev && u > 0 && barH < 0.94;
      l.bar.position.set(0, barH, -barY);
      const drop = ev?.reset ? 0.75 * (1 - ph(u, SET)) : 0;
      l.setter.visible = !!ev?.reset && u >= SET[0] && u < POST;
      l.setter.position.y = drop + 0.4 + 0.45 * ph(u, [SET[1], POST]);
      let di = 0;
      l.pins.forEach((m, k) => {
        const [px, py] = ln.spots[k];
        m.position.set(px, 0, -py); m.rotation.set(0, 0, 0);
        if (ev && ev.down.has(k) && !(ev.reset && u >= SET[0])) {
          const p = Math.min(1, e / 0.5), a = ev.dir[di++] ?? 0;
          m.rotation.set(Math.cos(a) * p * 1.5, 0, Math.sin(a) * p * 1.5);
          const y = u > BAR.drop[1] ? Math.max(py, barY + 0.08) : py;
          m.position.z = -y; m.visible = y < PIT + 0.05; return;
        }
        if (ev?.reset) { m.visible = u >= SET[0]; m.position.y = drop; return; }
        m.visible = up.has(k);
      });
    }

    const cam = { pos: new T.Vector3(0, 1.4, 2.4), look: new T.Vector3(0, 0, -HEAD), tp: new T.Vector3(), tl: new T.Vector3(), fov: 24, tf: 24, moving: true };
    let cosmicK = 0, lastT = 0, spinA = 0, retSpin = 0;
    function draw(now, st, r) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      syncRivals();
      const v = L(), me = myRow(), tall = camera.aspect < 0.8;
      // 🌟 cosmic frame: black light
      const cosmic = me && !me.done && Math.min(me.frame, v.nframes - 1) === v.cosmic;
      cosmicK += ((cosmic ? 1 : 0) - cosmicK) * Math.min(1, dt * 2);
      stg.hemi.intensity = 0.75 - 0.45 * cosmicK; stg.key.intensity = 0.75 - 0.45 * cosmicK;
      laneMat.emissive.setRGB(0.12 * cosmicK, 0.02 * cosmicK, 0.3 * cosmicK);
      pinMat.emissive.setRGB(0.25 * cosmicK, 0.1 * cosmicK, 0.45 * cosmicK);
      // my pins, the sweep bar and the pinsetter
      const lane = lanes[0];
      const byK = new Map(st.pins.map((p) => [p.k, p]));
      lane.pins.forEach((m, k) => {
        const p = byK.get(k);
        if (!p || p.gone) { m.visible = false; return; }
        m.visible = true;
        m.position.set(p.x, 0, -p.y);
        const a = Math.atan2(p.dx || 0, p.dy || 1);
        m.rotation.set(-Math.cos(a) * p.fall * 1.45, 0, Math.sin(a) * p.fall * 1.45);
        m.position.y = p.lift ?? p.fall * 0.04;
      });
      blobs.forEach((b, k) => { const p = byK.get(k); b.visible = !!p && !p.gone && p.fall < 0.3 && !p.lift; });
      if (mirror) lane.pins.forEach((m, k) => { const c = mirror.pins[k]; c.visible = m.visible; c.position.copy(m.position); c.rotation.copy(m.rotation); });
      lane.bar.visible = !!st.bar;
      if (st.bar) lane.bar.position.set(0, st.bar.h, -st.bar.y);
      lane.setter.visible = !!st.setter;
      if (st.setter) lane.setter.position.y = st.setter.h;
      for (let i = 1; i < lanes.length; i++) if (!lanes[i].empty) drawRival(lanes[i], now);
      // the ball: rolling along its track while it plays; on the foul line when you can bowl; otherwise it rides the
      // return back to the hood and waits there
      const ready = canBowl();
      if (st.ball) {
        ball.visible = st.ball.y < PIT;
        const prev = ball.position.clone();
        ball.position.set(st.ball.x, R, -st.ball.y);
        spinA += prev.distanceTo(ball.position) / R;
        ball.rotation.set(-spinA, 0, 0);
      } else {
        ball.visible = !!me && !me.done && (ready || !ret);
        ball.position.set(start, R, 0.16);  // (on the approach, behind the foul line)
      }
      if (mirror) { mirror.ball.visible = ball.visible; mirror.ball.position.copy(ball.position); mirror.ball.rotation.copy(ball.rotation); }
      retBall.visible = !!ret && !(ret.rest && ready) && !st.ball;
      if (ret?.t0) {
        const t = Math.min(1, (now - ret.t0) / RETURN_MS), e = t * t * (3 - 2 * t), zFrom = -PIT, zTo = RACKZ;
        const z = zFrom + (zTo - zFrom) * e, up = Math.max(0, (t - 0.85) / 0.15);
        const prev = retBall.position.z;
        retBall.position.set(HX, 0.07 + R + (RACK - 0.07) * up, z);
        retSpin += Math.abs(z - prev) / R; retBall.rotation.set(retSpin, 0, 0);
      } else if (ret?.rest) retBall.position.set(HX, RACK + R, RACKZ);
      aimLine.visible = !!r;
      if (r) {
        const reach = 4 + r.speed * 12;
        aimLine.position.set(start, 0.012, -0.3);
        aimLine.rotation.set(-Math.PI / 2, -r.angle, 0);
        aimLine.scale.set(1, reach, 1);
        stripeTex.repeat.set(1, reach / 0.5); stripeTex.offset.y = -now / 900;
        aimLine.material.color.setStyle(powerCss(r.speed));
      }
      // camera: behind the foul line, then riding the ball, then looking at the pins (and the pinsetter)
      if (st.ball && st.ball.y < HEAD - 5.5) { cam.tp.set(st.ball.x * 0.5, 0.75, -st.ball.y + 2.2); cam.tl.set(st.ball.x * 0.5, 0.1, -st.ball.y - 6); cam.tf = 34; }
      else if (anim) { cam.tp.set(0, 1.05, -HEAD + 3.6); cam.tl.set(0, 0.2, -HEAD - 0.35); cam.tf = tall ? 34 : 28; }
      else { cam.tp.set(start * 0.7, 1.25, 3.4); cam.tl.set(start * 0.2, 0, -6.5); cam.tf = tall ? 38 : 30; }  // (the foul line and approach in view, #134)
      const k = 1 - Math.exp(-dt * (anim ? 5 : 3));
      cam.pos.lerp(cam.tp, k); cam.look.lerp(cam.tl, k); cam.fov += (cam.tf - cam.fov) * k;
      cam.moving = cam.pos.distanceTo(cam.tp) > 0.01 || cam.look.distanceTo(cam.tl) > 0.01 || cosmicK % 1 > 0.01 && cosmicK < 0.99;
      if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      (still && renderer.renderStill ? renderer.renderStill : renderer.render)(scene, camera);
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 400;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      const seen = new Set();
      scene.traverse((o) => {
        for (const x of [o.geometry, ...[].concat(o.material || [])]) if (x && !seen.has(x)) { seen.add(x); x.map?.dispose?.(); x.roughnessMap?.dispose?.(); x.dispose?.(); }
      });
      disposables.forEach((t) => t.dispose());
    }
    // (rival lanes animate on their own clock, and my ball rides the return: both need frames even when I'm idle)
    const moving = () => cam.moving || !!ret?.t0 || lanes.some((l) => l.ev);
    return { draw, resize, dispose, shake: () => { if (!low) GL3.shake(camera, 0.12); }, moving };
  }

  // ---------- flat fallback: the lane from above, foul line at the bottom, pins at the top
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 20;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth || 320, h = stage.clientHeight || 400;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      k = canvas.height / (L().lane.pit + 1.5);
    }
    function draw(now, st, r) {
      const ln = L().lane, X = (x) => canvas.width / 2 + x * k * 2.2, Y = (y) => canvas.height - (y + 0.8) * k;
      g.fillStyle = '#140e22'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#d7a86e'; g.fillRect(X(-ln.w / 2), Y(ln.pit), ln.w * k * 2.2, Y(-0.8) - Y(ln.pit));
      g.fillStyle = '#c8141f'; g.fillRect(X(-ln.w / 2) - 6, Y(0) - 2, ln.w * k * 2.2 + 12, 4);
      for (const p of st.pins) {
        if (p.gone) continue;
        g.globalAlpha = 1 - p.fall * 0.6;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(3, ln.pinR * k * 2.2), 0, 7); g.fill();
        g.fillStyle = '#c0262d'; g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(1.5, ln.pinR * k), 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      const b = st.ball || { x: start, y: 0 };
      g.fillStyle = colorOf(S.me?.id); g.beginPath(); g.arc(X(b.x), Y(b.y), Math.max(4, ln.ballR * k * 2.2), 0, 7); g.fill();
      if (r) {
        g.strokeStyle = powerCss(r.speed); g.lineWidth = 3; g.setLineDash([6, 6]);
        g.beginPath(); g.moveTo(X(start), Y(0)); g.lineTo(X(start + Math.sin(r.angle) * 16), Y(Math.cos(r.angle) * 16)); g.stroke(); g.setLineDash([]);
      }
    }
    resize();
    return { draw, resize };
  }

  const turnText = (s) => {
    const me = s.lanes?.rows.find((r) => r.id === s.me?.id);
    return s.phase === 'playing' && me ? (me.done ? '🎳 Waiting for the others' : `🎳 Frame ${Math.min(me.frame, s.lanes.nframes - 1) + 1}`) : null;
  };
  const myMove = (s) => s.phase === 'playing' && s.lanes?.me != null && !s.lanes.wait;

  return { mount, render, unmount, turnText, myMove, focus: true };
})();
