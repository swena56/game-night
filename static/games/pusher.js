// Coin Cascade: one shared coin-pusher machine. The server simulates each drop (games/pusher.py) and sends its motion
// once over the fast channel (`frames`: coin positions 10 times a second); this module plays it back (the shelf, the
// handful falling from the chute, the pile shoving, coins tipping over the edge into the trays) and then settles on
// the view's pile. Between turns the shelf keeps stroking (it never reaches past the pile: each drop ends with it all
// the way out). On your turn: drag on the machine (or the slider) to move the chute, and drop on the shelf's beat.
UI.pusher = (() => {
  let S, ctx, V = null, gl = null, flat = null, raf = 0, ro = null, keyDown = null;
  let disp = new Map(), anim = null, lastShot = 0, framesBy = {}, pend = null, idle = { phase: 0.5, at: 0 }, aim = 0, dragX = null;
  let shown = [], fallers = [], pops = [];
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');
  const TAU = Math.PI * 2;

  function mount(main, side) {
    V = null; gl = null; flat = null; disp = new Map(); anim = null; lastShot = 0; framesBy = {}; pend = null; idle = { phase: 0.5, at: performance.now() }; aim = 0; shown = []; fallers = []; pops = [];
    main.innerHTML = `<div class="cc"><div class="cc-stage" id="ccStage">
        <div class="cc-hud"><span id="ccTurn"></span><span id="ccLeft"></span></div>
        <div class="cc-pop" id="ccPop" hidden></div>
      </div>
      <div class="cc-ctl" id="ccCtl">
        <input type="range" id="ccAim" min="-100" max="100" value="0" aria-label="Chute">
        <button id="ccDrop" class="primary">🪙 Drop</button>
      </div>
      <p id="ccHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🪙 Trays</h3><div id="ccRace"></div><p class="hint left">Drag across the machine (or the slider, or ← →) to move the chute; tap 🪙 Drop (or Space). Coins dropped while the shelf is back get the full shove.</p></div>';
    const stage = $('ccStage');
    stage.style.touchAction = 'none';
    $('ccAim').addEventListener('input', (e) => { aim = e.target.value / 100; });
    $('ccDrop').addEventListener('click', drop);
    // #154: the chute goes where your finger is on the machine (the view maps the screen onto the playfield)
    const aimAt = (e) => {
      const x = (gl || flat)?.pick?.(e.clientX, e.clientY);
      if (x == null) return;
      aim = Math.max(-1, Math.min(1, x / aimLim())); $('ccAim').value = Math.round(aim * 100);
    };
    stage.addEventListener('pointerdown', (e) => { if (!canDrop()) return; dragX = true; aimAt(e); try { stage.setPointerCapture(e.pointerId); } catch {} });
    stage.addEventListener('pointermove', (e) => { if (dragX) aimAt(e); });
    const up = () => { dragX = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { aim = Math.max(-1, aim - 0.05); $('ccAim').value = Math.round(aim * 100); e.preventDefault(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { aim = Math.min(1, aim + 0.05); $('ccAim').value = Math.round(aim * 100); e.preventDefault(); }
      else if (e.code === 'Space' && !e.repeat) { e.preventDefault(); drop(); }
    };
    addEventListener('keydown', keyDown);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const revive = { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } };
    GL3.load().then(() => { if (stage.isConnected && !gl && V) GL3.revive(stage, revive); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown);
    window.Snd?.bed('cc.motor').set(0);
    gl?.dispose(); gl = null; flat = null;
  }

  const G = () => V.geo;
  const me = () => V?.me;
  const colorOf = (i) => ctx.player(V.seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V.seats[i])?.name ?? '?';
  const faceAt = (ph) => G().face[0] + (G().face[1] - G().face[0]) * (0.5 - 0.5 * Math.cos(TAU * ph));
  const ownerOf = (x) => Math.max(0, Math.min(V.seats.length - 1, Math.floor((x + G().hw) / (2 * G().hw / V.seats.length))));
  const myTurn = () => S?.phase === 'playing' && V?.me != null && S.turn === V.seats[V.me];
  const canDrop = () => myTurn() && !anim && !pend && V.left[V.me] > 0;
  // the handful the server will drop for this aim (games/pusher.py handful()): centre, then either side
  const spreadMax = () => Math.max(...(G().spread || [0, -0.22, 0.22]));
  const aimLim = () => G().hw - G().r - spreadMax();
  function handfulAt(a, ph) {
    const g = G(), mid = a * aimLim(), mega = V.me != null && V.mega[V.me];
    return (g.spread || [0, -0.22, 0.22]).map((sp, k) => {
      const r = k === 0 && mega ? g.rMega : g.r, x = Math.max(-(g.hw - r), Math.min(g.hw - r, mid + sp)), t = (g.gapT ?? 0.3) * k;
      const y = faceAt((((ph + t / g.period) % 1) + 1) % 1) + r + 0.02;
      return { x, y, r, bell: g.bells.some(([bx, by]) => Math.hypot(x - bx, y - by) < g.bellR + r * 0.5) };
    });
  }
  function shelfPhase(now) {
    if (anim) {
      // #154: ease from where the idle shelf was over to the drop's own stroke, instead of jumping
      const t = Math.min(anim.dur, (now - anim.t0) / 1000), u = Math.min(1, t / 0.45);
      return anim.phase + t / G().period + anim.ofs * (1 - u * u * (3 - 2 * u));
    }
    return idle.phase + (now - idle.at) / 1000 / G().period;
  }

  function drop() {
    if (!canDrop()) return;
    const ph = ((shelfPhase(performance.now()) % 1) + 1) % 1;
    ctx.act('drop', { x: +aim.toFixed(3), phase: +ph.toFixed(4) }).catch((e) => ctx.toast?.(e?.message || 'Could not drop.'));
    ctx.buzz?.(15);
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    const first = !V;
    V = s.pusher;
    if (first) { snap(); lastShot = V.shot?.no ?? 0; shown = V.points.slice(); }
    const no = V.shot?.no ?? 0;
    if (no > lastShot && !anim) { lastShot = no; pend = { no, at: performance.now(), shot: V.shot, coins: V.coins, points: V.points.slice() }; }
    if (!anim && !pend) { snap(); shown = V.points.slice(); }
    if (!gl && !flat && $('ccStage') && window.THREE) GL3.revive($('ccStage'), { build: () => (gl = make3d($('ccStage'))), flat: () => { flat ||= make2d($('ccStage')); }, unflat: () => { flat?.dispose?.(); flat = null; } });
    renderSide();
  }
  function fast(d) { if (d.shot) { framesBy = { [d.shot]: d.frames }; } }
  function snap(coins = V.coins) {
    disp = new Map(coins.map(([id, x, y, r, k]) => [id, { x, y, r, k, tx: x, ty: y, h: 0 }]));
  }
  // start playing a drop back once its frames are here (or settle straight away if they never came)
  function startAnim(now) {
    if (!pend) return;
    const fr = framesBy[pend.no];
    if (!fr && now - pend.at < 700) return;
    const sh = pend.shot;
    if (!fr) { snap(pend.coins); shown = pend.points; pend = null; idle = { phase: 0.5, at: now }; return; }
    const was = shelfPhase(now), ofs = ((((was - sh.phase) % 1) + 1.5) % 1) - 0.5;
    anim = { no: pend.no, t0: now, dur: sh.dur, phase: sh.phase, ofs, tracks: tracksOf(fr, sh), adds: sh.adds.map((a) => ({ t: a[0], x: a[1], r: a[2], k: a[3], id: a[4], on: false })),
      falls: sh.falls.map((f) => ({ id: f[0], k: f[1], x: f[2], own: f[3], t: f[4], done: false })), end: { coins: pend.coins, points: pend.points }, by: sh.by, bonus: sh.bonus, gain: sh.gain };
    shown = pend.points.map((p, i) => p - (sh.gain[i] || 0));
    pend = null;
    if (sh.bonus) setTimeout(() => { SN.bell(); popText(`🔔 ${({ guard: '🧱 Side guards!', shake: '🫨 Shake!', mega: '🪙 Mega coin next turn!' })[sh.bonus]}`); }, 500);
  }
  // #154: each coin's path through the drop as keyframes [t, x, y], played back by time (the old chase lagged behind
  // the shelf by about a coin, so the shelf's face cut into the coins it pushed). Frames only list coins that moved, so
  // a coin that sat still and then moves gets a hold key one frame before.
  function tracksOf(frames, sh) {
    const tr = new Map(), step = frames.length > 1 ? frames[1][0] - frames[0][0] : 0.1;
    for (const [id, c] of disp) tr.set(id, [[0, c.x, c.y]]);
    for (const [t, moved] of frames) {
      for (const [id, x, y] of moved) {
        let k = tr.get(id);
        if (!k) { const a = sh.adds.find((q) => q[4] === id); k = [[a ? a[0] : t, x, y]]; tr.set(id, k); }
        const last = k[k.length - 1];
        if (t - last[0] > step * 1.5) k.push([t - step, last[1], last[2]]);
        k.push([t, x, y]);
      }
    }
    return tr;
  }
  function sample(c, k, t) {
    let j = c.ti || 0;
    while (j + 1 < k.length && k[j + 1][0] <= t) j++;
    c.ti = j;
    const a = k[j], b = k[j + 1];
    if (!b || t <= a[0]) { c.x = a[1]; c.y = a[2]; return; }
    const u = (t - a[0]) / (b[0] - a[0]);
    c.x = a[1] + (b[1] - a[1]) * u; c.y = a[2] + (b[2] - a[2]) * u;
  }
  function stepAnim(now, dt) {
    if (!anim) return;
    const t = (now - anim.t0) / 1000, g = G();
    for (const a of anim.adds) {
      if (!a.on && t >= a.t - 0.35) {
        a.on = true;
        const k = anim.tracks.get(a.id), y = k ? k[0][2] : faceAt(anim.phase + a.t / g.period) + a.r + 0.02;
        disp.set(a.id, { x: k ? k[0][1] : a.x, y, r: a.r, k: a.k, h: 3, drop: a.t, spin: Math.random() * TAU });
      }
    }
    for (const f of anim.falls) {
      if (!f.done && t >= f.t) {
        f.done = true;
        const c = disp.get(f.id);
        disp.delete(f.id);
        fallers.push({ x: c ? c.x : f.x, y: c ? c.y : g.edge, r: c ? c.r : g.r, k: f.k, own: f.own, at: now, id: f.id });
        const pan = (c ? c.x : f.x) / g.hw;
        if (f.own >= 0) {
          shown[f.own] = (shown[f.own] || 0) + (f.k === 1 ? 3 : 1);
          SN.tray(f.k === 1, pan, f.own === me() ? 1 : 0.55);
          if (f.k === 1) popText(`⭐ +3 ${f.own === me() ? 'for you!' : nameOf(f.own)}`);
        } else SN.gutter(pan);
      }
    }
    for (const [id, c] of disp) {
      if (c.h > 0) {
        // falling from the chute: gravity, not a straight line
        const left = Math.max(0, (c.drop ?? 0) - t);
        c.h = Math.min(3, 24 * left * left);
        if (c.h === 0 && c.drop != null) { c.drop = null; c.landAt = now; SN.land(c.x / g.hw, c.k === 2); (gl || flat)?.sparkle(c.x, c.y); }
      }
      const k = anim.tracks.get(id);
      if (k) sample(c, k, t);
    }
    if (t >= anim.dur + 0.5) {
      const g2 = anim.gain || [];
      if (g2[me()] >= 5) { ctx.sfx?.('win'); popText(`🎰 +${g2[me()]}!`); }
      snap(anim.end.coins); shown = anim.end.points; anim = null; idle = { phase: 0.5, at: now };
      renderSide();
    }
  }

  function renderSide() {
    const box = $('ccRace'); if (!box || !V) return;
    box.innerHTML = '';
    const order = V.seats.map((_, i) => i).sort((a, b) => (shown[b] ?? 0) - (shown[a] ?? 0));
    for (const i of order) {
      const p = ctx.player(V.seats[i]), row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out') + (S.turn === V.seats[i] ? ' cc-now' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const extra = `${V.guard[i] > 0 ? ` 🧱${V.guard[i]}` : ''}${V.mega[i] ? ' 🪙' : ''}${V.stars[i] ? ` ⭐${V.stars[i]}` : ''}`;
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === V.me ? ' (you)' : ''}${extra}`), ctx.el('span', 'cc-left', `${V.left[i]} left`), ctx.el('b', '', `${shown[i] ?? 0}`));
      box.append(row);
    }
    const t = V.seats.indexOf(S.turn);
    $('ccTurn').textContent = S.phase !== 'playing' ? '' : t < 0 ? '🪙 Settling…' : t === V.me ? '🪙 Your drop!' : `🪙 ${nameOf(t)}'s drop`;
    $('ccLeft').textContent = V.me != null ? `${V.left[V.me]} handful${V.left[V.me] === 1 ? '' : 's'} left` : '';
    $('ccCtl').hidden = V.me == null;
    $('ccDrop').disabled = !canDrop();
    $('ccDrop').classList.toggle('cc-ready', canDrop());
    $('ccHint').textContent = !myTurn() ? '' : V.mega[V.me] ? 'Your handful has a 🪙 mega coin in it!' : V.guard[V.me] ? `🧱 Side guards up (${V.guard[V.me]} drops).` : 'Drop while the shelf is back for the big shove. 🔔 bells give bonuses.';
  }

  function popText(text) {
    const el = $('ccPop'); if (!el) return;
    el.textContent = text; el.hidden = false; el.className = 'cc-pop cc-pop-in'; void el.offsetWidth;
    clearTimeout(popText.t); popText.t = setTimeout(() => { el.hidden = true; }, 1700);
  }

  // ---------- sound: coins on metal, in a small arcade (#155: struck metal, not beeps)
  // A coin strike: a very short bright tick, a few inharmonic rings that die in tens of milliseconds (a coin's own
  // partials sit high and aren't in tune), and for a coin landing flat a dull thud of the plate under it.
  // Cascades are spread over their real times and a few voices at most sound at once.
  let voices = [];
  const snd = (fn, pan = 0, delay = 0) => {
    const now = performance.now();
    voices = voices.filter((v) => now - v < 60);
    if (voices.length >= 4) return;
    voices.push(now);
    window.Snd?.play((t, K) => fn(t + delay, K, K.at({ room: 'room', send: 0.35, pan: Math.max(-0.8, Math.min(0.8, pan)) })));
  };
  const strike = (K, d, t, h, pitch = 1) => {
    K.burst(d, t, { type: 'bandpass', f: 3500 + 3500 * h, q: 0.8, vol: 0.05 + 0.1 * h, tau: 0.0012 });
    [[4180, 0.05, 0.03], [6230, 0.035, 0.02], [8770, 0.022, 0.012], [11400, 0.012, 0.008]].forEach(([f, v, tau]) => K.mode(d, t, f * pitch * K.R(0.985, 1.015), v * (0.35 + 0.65 * h), tau));
  };
  const SN = {
    land: (pan, mega) => snd((t, K, d) => {
      strike(K, d, t, 0.45, mega ? 0.72 : K.R(0.96, 1.04));
      K.burst(d, t, { type: 'lowpass', f: 700, q: 0.7, vol: mega ? 0.16 : 0.09, tau: 0.012, buf: 'brown' });
      K.mode(d, t, mega ? 190 : 260, mega ? 0.06 : 0.035, 0.03);
      strike(K, d, t + K.R(0.04, 0.07), 0.15, K.R(0.95, 1.05));     // a little bounce
    }, pan),
    tray: (star, pan, v) => snd((t, K, d) => {
      const n = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) strike(K, d, t + k * K.R(0.03, 0.06), (0.8 - k * 0.25) * v, K.R(0.94, 1.06));
      K.mode(d, t, 520, 0.035 * v, 0.07); K.mode(d, t, 830, 0.018 * v, 0.05);   // the tray's own tin ring
      if (star) [784, 1047, 1319].forEach((f, k) => K.mode(d, t + 0.1 + k * 0.07, f, 0.06, 0.2));
    }, pan, Math.random() * 0.05),
    gutter: (pan) => snd((t, K, d) => {
      for (let k = 0; k < 4; k++) strike(K, d, t + k * K.R(0.05, 0.09), 0.25 - k * 0.05, K.R(0.8, 0.9));
      K.burst(d, t, { type: 'lowpass', f: 900, f1: 300, q: 0.9, vol: 0.05, tau: 0.12, dur: 0.35, buf: 'brown' });
      K.mode(d, t + 0.3, 140, 0.05, 0.05);
    }, pan),
    bell: () => snd((t, K, d) => { [1175, 2350, 3520].forEach((f, n) => K.mode(d, t, f, 0.08 - n * 0.02, 0.5)); }),
  };
  // the machine's motor, and the shelf scraping coins as it pushes
  const motorBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lp = A.createBiquadFilter(), g = A.createGain(), hum = A.createOscillator(), hg = A.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 260; g.gain.value = 0; hum.type = 'triangle'; hum.frequency.value = 58; hg.gain.value = 0;
    src.connect(lp).connect(g).connect(dst); hum.connect(hg).connect(dst); hum.start();
    return { set(l, x = 0) { g.gain.setTargetAtTime(0.02 * l * (0.5 + x), A.currentTime, 0.15); hg.gain.setTargetAtTime(0.006 * l, A.currentTime, 0.3); lp.frequency.setTargetAtTime(220 + 260 * x, A.currentTime, 0.15); }, stop() { try { src.stop(); hum.stop(); } catch {} } };
  };

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const dt = Math.min(0.1, (now - (loop.last || now)) / 1000); loop.last = now;
    startAnim(now);
    stepAnim(now, dt);
    const sp = Math.abs(Math.sin(TAU * shelfPhase(now)));     // the stroke's speed, 0..1
    window.Snd?.bed('cc.motor', motorBed).set(S?.phase === 'playing' && !S.paused ? 1 : 0, anim ? sp : sp * 0.4);
    (gl || flat)?.draw(now, dt);
    if (now - (loop.side || 0) > 300) { loop.side = now; renderSide(); }
  }

  // ---------- three.js machine
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
    const g0 = G(), HW = g0.hw, EDGE = g0.edge;
    const scene = new T.Scene();
    scene.background = new T.Color(0x150a22);
    const camera = new T.PerspectiveCamera(42, 1, 0.3, 120);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.1, hemi: [0xffe9d0, 0x2a1030, 0.6],
      key: { i: 1.0, color: 0xfff1dc, pos: [3, 12, 9], area: 7, near: 2, far: 30 },
      env: { accent: 0xff4fa0, walls: 0x2a1030, lamp: 0xfff4e6, glow: 2.8 },
    });
    const low = stg.low;
    const glow = new T.PointLight(0xffb86b, 0.3, 18); glow.position.set(0, 6, 2); scene.add(glow);
    // the cabinet
    const red = new T.MeshStandardMaterial({ color: 0x8c1d40, roughness: 0.45, metalness: 0.2 });
    const chrome = new T.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.18 });
    const base = new T.Mesh(new T.BoxGeometry(2 * HW + 1.6, 3, EDGE + 4), red); base.position.set(0, -1.5 - 0.02, EDGE / 2 - 1.5); base.receiveShadow = true; scene.add(base);
    // the playfield: brushed metal with a few painted lane stripes, the bells marked on it
    const field = canvasTex(T, 256, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#5a5f6b'); grd.addColorStop(1, '#8a909c'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(0, y, w, 1); }
    });
    const play = new T.Mesh(new T.PlaneGeometry(2 * HW, EDGE + 1.5), new T.MeshStandardMaterial({ map: field, metalness: 0.6, roughness: 0.4 }));
    play.rotation.x = -Math.PI / 2; play.position.set(0, 0, (EDGE - 1.5) / 2); play.receiveShadow = true; scene.add(play);
    // the front edge: a chrome lip, and the trays below in each player's colour
    const lip = new T.Mesh(new T.BoxGeometry(2 * HW + 0.2, 0.08, 0.12), chrome); lip.position.set(0, -0.02, EDGE + 0.04); scene.add(lip);
    const n = V.seats.length, trays = [];
    for (let i = 0; i < n; i++) {
      const w = (2 * HW) / n, x = -HW + w * (i + 0.5);
      const tray = new T.Mesh(new T.BoxGeometry(w - 0.08, 0.5, 1.0), new T.MeshStandardMaterial({ color: colorOf(i), roughness: 0.5, emissive: colorOf(i), emissiveIntensity: 0.15 }));
      tray.position.set(x, -1.0, EDGE + 0.55); scene.add(tray);
      const tex = canvasTex(T, 256, 96, () => {});
      const label = new T.Mesh(new T.PlaneGeometry(w - 0.1, (w - 0.1) * 0.375), new T.MeshBasicMaterial({ map: tex, transparent: true }));
      label.position.set(x, -0.6, EDGE + 1.07); scene.add(label);
      trays.push({ tray, tex, label, last: null });
    }
    function paintLabel(i) {
      const tr = trays[i], txt = `${i === me() ? '★ ' : ''}${nameOf(i)} · ${shown[i] ?? 0}`;
      if (tr.last === txt) return;
      tr.last = txt;
      const c = tr.tex.image, g = c.getContext('2d'); if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect?.(4, 8, c.width - 8, c.height - 16, 22); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let s = txt; while (g.measureText(s).width > c.width - 24 && s.length > 4) s = s.slice(0, -2) + '…';
      g.fillText(s, c.width / 2, c.height / 2 + 2); tr.tex.needsUpdate = true;
    }
    // glass side walls at the back, open near the front (the gutters), with chrome rails
    const glass = new T.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
    for (const s of [-1, 1]) {
      const wall = new T.Mesh(new T.BoxGeometry(0.06, 1.4, g0.gapY + 1.5), glass); wall.position.set(s * (HW + 0.03), 0.7, (g0.gapY - 1.5) / 2); scene.add(wall);
      const rail = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, g0.gapY + 1.5, 8), chrome); rail.rotation.x = Math.PI / 2; rail.position.set(s * (HW + 0.03), 1.42, (g0.gapY - 1.5) / 2); scene.add(rail);
      const gut = new T.Mesh(new T.BoxGeometry(0.5, 0.3, EDGE - g0.gapY), new T.MeshStandardMaterial({ color: 0x1a0a12, roughness: 0.9 })); gut.position.set(s * (HW + 0.3), -0.2, (EDGE + g0.gapY) / 2); scene.add(gut);
    }
    // guards (shown while the player whose drop it is has them up)
    const guards = [-1, 1].map((s) => { const m = new T.Mesh(new T.BoxGeometry(0.08, 0.5, EDGE - g0.gapY), new T.MeshStandardMaterial({ color: 0x7fd0ff, emissive: 0x3a86ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 })); m.position.set(s * (HW + 0.04), 0.25, (EDGE + g0.gapY) / 2); m.visible = false; scene.add(m); return m; });
    // the back wall: a marquee sign ringed with chasing bulbs
    const signTex = canvasTex(T, 512, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#ff4fa0'); grd.addColorStop(0.5, '#ffd23f'); grd.addColorStop(1, '#ff4fa0');
      g.fillStyle = '#2a0f30'; g.fillRect(0, 0, w, h); g.fillStyle = grd; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 60px sans-serif'; g.shadowColor = '#ff4fa0'; g.shadowBlur = 18; g.fillText('COIN CASCADE', w / 2, h / 2 + 4);
    });
    const back = new T.Mesh(new T.BoxGeometry(2 * HW + 1.6, 4.2, 0.3), red); back.position.set(0, 2.1, -2.0); scene.add(back);
    const sign = new T.Mesh(new T.PlaneGeometry(2 * HW, 1.6), new T.MeshBasicMaterial({ map: signTex })); sign.position.set(0, 3.0, -1.84); scene.add(sign);
    const NB = 44, bulbs = new T.InstancedMesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }), NB), m4 = new T.Matrix4(), bc = new T.Color();
    for (let k = 0; k < NB; k++) {
      const f = k / NB, per = 2 * (2 * HW) + 2 * 1.6; let d = f * per, x, y;
      if (d < 2 * HW) { x = -HW + d; y = 3.85; } else if ((d -= 2 * HW) < 1.6) { x = HW; y = 3.85 - d; } else if ((d -= 1.6) < 2 * HW) { x = HW - d; y = 2.25; } else { d -= 2 * HW; x = -HW; y = 2.25 + d; }
      m4.makeTranslation(x, y, -1.8); bulbs.setMatrixAt(k, m4); bulbs.setColorAt(k, bc.set(0xffd23f));
    }
    scene.add(bulbs);
    // the shelf: a chrome-edged block sliding in and out, its top heaped with coins for show
    const shelf = new T.Group(); scene.add(shelf);
    const shelfTop = new T.Mesh(new T.BoxGeometry(2 * HW - 0.02, 0.5, 3.2), new T.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.5, roughness: 0.4 }));
    shelfTop.position.set(0, 0.25, -1.6); shelfTop.castShadow = !low; shelfTop.receiveShadow = true; shelf.add(shelfTop);
    const faceBar = new T.Mesh(new T.BoxGeometry(2 * HW, 0.5, 0.08), chrome); faceBar.position.set(0, 0.25, -0.04); shelf.add(faceBar);
    // coins (#156): a turned profile (a raised rim, a sunken field, a bevelled edge) mapped from above, so one face
    // texture embosses both sides and its outer ring reeds the edge; three batches: plain, mega and ⭐ prize coins
    const prof = [[0, 0.03], [0.74, 0.03], [0.79, 0.044], [0.9, 0.05], [0.97, 0.046], [1, 0.034], [1, -0.034], [0.97, -0.046], [0.9, -0.05], [0.79, -0.044], [0.74, -0.03], [0, -0.03]];
    const coinGeo = new T.LatheGeometry(prof.slice().reverse().map(([r, y]) => new T.Vector2(r, y)), low ? 24 : 40);
    { const pa = coinGeo.attributes.position, uv = coinGeo.attributes.uv; for (let n = 0; n < pa.count; n++) uv.setXY(n, 0.5 + pa.getX(n) * 0.5, 0.5 - pa.getZ(n) * 0.5); }
    const faceTex = (paint, size = low ? 256 : 512) => {
      const t = canvasTex(T, size, size, (g, w) => {
        const c = w / 2;
        g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, w);
        // reeding round the very edge
        g.save(); g.translate(c, c); for (let k = 0; k < 120; k++) { g.rotate(TAU / 120); g.fillStyle = k % 2 ? '#3a3a3a' : '#d8d8d8'; g.fillRect(c * 0.955, -c * 0.03, c * 0.05, c * 0.06); } g.restore();
        // the rim (bright, raised) and a ring of dots inside it
        g.strokeStyle = '#e0e0e0'; g.lineWidth = c * 0.12; g.beginPath(); g.arc(c, c, c * 0.86, 0, TAU); g.stroke();
        g.fillStyle = '#c8c8c8'; for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; g.beginPath(); g.arc(c + Math.cos(a) * c * 0.68, c + Math.sin(a) * c * 0.68, c * 0.025, 0, TAU); g.fill(); }
        paint(g, c);
      });
      t.anisotropy = 4; return t;
    };
    const plainFace = faceTex((g, c) => {
      // a sunburst round a raised disc with a big "1"
      g.strokeStyle = '#9a9a9a'; g.lineWidth = c * 0.02; for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.36, c + Math.sin(a) * c * 0.36); g.lineTo(c + Math.cos(a) * c * 0.6, c + Math.sin(a) * c * 0.6); g.stroke(); }
      g.fillStyle = '#b8b8b8'; g.beginPath(); g.arc(c, c, c * 0.34, 0, TAU); g.fill();
      g.fillStyle = '#f0f0f0'; g.font = `900 ${Math.round(c * 0.5)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1', c, c * 1.04);
    });
    const megaFace = faceTex((g, c) => {
      g.fillStyle = '#b8b8b8'; g.beginPath(); g.arc(c, c, c * 0.56, 0, TAU); g.fill();
      g.fillStyle = '#f0f0f0'; g.font = `900 ${Math.round(c * 0.62)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', c, c * 1.05);
    });
    const starFace = faceTex((g, c) => {
      g.fillStyle = '#f0f0f0'; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? c * 0.26 : c * 0.6; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
      g.fill();
    });
    // the colour: gold metal, a touch darker in the sunken parts (the same picture, as a tint)
    const metal = (color, face, o = {}) => (low
      ? new T.MeshStandardMaterial({ color, map: face, bumpMap: face, bumpScale: 1.2, metalness: 0.6, roughness: 0.35, emissive: color, emissiveIntensity: 0.18, ...o })
      : new T.MeshPhysicalMaterial({ color, map: face, bumpMap: face, bumpScale: 1.6, metalness: 1, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.25, emissive: color, emissiveIntensity: 0.06, ...o }));
    for (const t of [plainFace, megaFace, starFace]) t.colorSpace = T.SRGBColorSpace;
    const gold = metal(0xffd36a, plainFace), megaMat = metal(0xffb84a, megaFace), starMat = metal(0xd9c8ff, starFace, { emissive: 0xff4fa0, emissiveIntensity: low ? 0.25 : 0.12 });
    const MAXC = 220, coins = new T.InstancedMesh(coinGeo, gold, MAXC); coins.castShadow = !low; coins.receiveShadow = true; coins.frustumCulled = false; scene.add(coins);
    const megas = new T.InstancedMesh(coinGeo, megaMat, 12); megas.castShadow = !low; megas.frustumCulled = false; scene.add(megas);
    const stars = new T.InstancedMesh(coinGeo, starMat, 24); stars.castShadow = !low; stars.frustumCulled = false; scene.add(stars);
    const decor = new T.InstancedMesh(coinGeo, gold, 26);
    for (let k = 0; k < 26; k++) { m4.compose(new T.Vector3((Math.random() - 0.5) * (2 * HW - 0.8), 0.54 + (k % 3) * 0.07, -0.4 - Math.random() * 2.6), new T.Quaternion().setFromEuler(new T.Euler((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)), new T.Vector3(0.3, 1, 0.3)); decor.setMatrixAt(k, m4); }
    shelf.add(decor);
    // the bells
    for (const [bx, by] of g0.bells) {
      const ring = new T.Mesh(new T.RingGeometry(g0.bellR * 0.75, g0.bellR, 32), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(bx, 0.006, by); scene.add(ring);
      const bell = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 64, 64, (g) => { g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔔', 32, 36); }), transparent: true, depthWrite: false }));
      bell.position.set(bx, 0.02, by); bell.scale.set(0.5, 0.5, 1); bell.center.set(0.5, 0); scene.add(bell);
    }
    // the chute: a carriage at the back that slides with your aim
    const chute = new T.Group(); scene.add(chute);
    const carriage = new T.Mesh(new T.BoxGeometry(0.9, 0.35, 0.5), chrome); carriage.position.y = 2.0; chute.add(carriage);
    const slot = new T.Mesh(new T.BoxGeometry(0.66, 0.06, 0.12), new T.MeshBasicMaterial({ color: 0x111111 })); slot.position.set(0, 2.18, 0); chute.add(slot);
    const guide = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 2, 6), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6 })); guide.position.y = 1.0; chute.add(guide);
    const rail = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 2 * HW, 8), chrome); rail.rotation.z = Math.PI / 2; rail.position.set(0, 2.2, 0.3); scene.add(rail);
    // #154: where the handful lands: a ring per coin, green over a bell, and a faint strip across the reachable width
    const aimDots = [0, 1, 2].map(() => { const m = new T.Mesh(new T.RingGeometry(0.8, 1, 32), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; scene.add(m); return m; });
    const strip = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, depthWrite: false })); strip.rotation.x = -Math.PI / 2; scene.add(strip);
    // sparkles: one additive particle pool
    const NP = 220, pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    const pGeo = new T.BufferGeometry(); pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    const parts = new T.Points(pGeo, new T.PointsMaterial({ size: 0.07, color: 0xfff1b0, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    parts.frustumCulled = false; scene.add(parts);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -99;
    let pNext = 0;
    function sparkle(x, y, nn = 6) {
      if (calm()) nn = 2;
      for (let k = 0; k < nn; k++) { const j = pNext; pNext = (pNext + 1) % NP; pPos[j * 3] = x; pPos[j * 3 + 1] = 0.1; pPos[j * 3 + 2] = y; const a = Math.random() * TAU; pVel[j * 3] = Math.cos(a) * 1.2; pVel[j * 3 + 1] = 1 + Math.random() * 1.5; pVel[j * 3 + 2] = Math.sin(a) * 1.2; pLife[j] = 0.4 + Math.random() * 0.3; }
    }

    let aspect = 1;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h; camera.updateProjectionMatrix();
    }
    function place() {
      // standing at the machine: the whole playfield and the trays in view whatever the screen shape
      const tv = Math.tan((camera.fov * Math.PI) / 360), hw = HW + 0.9;
      const d = Math.max(hw / (tv * aspect), 5.2 / tv) * 1.0;
      camera.position.set(0, d * 0.78, EDGE * 0.5 + d * 0.66); camera.lookAt(0, -0.2, EDGE * 0.42);
    }
    const q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), tilt = new T.Euler(), UPV = new T.Vector3(0, 1, 0), spinQ = new T.Quaternion();
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
    const nk = [0, 0, 0], batch = [coins, megas, stars], cap = [MAXC, 12, 24];
    const put = (kind) => { const b = kind === 2 ? 1 : kind === 1 ? 2 : 0; if (nk[b] >= cap[b]) return; batch[b].setMatrixAt(nk[b]++, m4.compose(ps, q, sc)); };
    const HALF = 0.05;   // half the coin's thickness at scale 1
    function draw(now, dt) {
      place();
      const ph = shelfPhase(now), gp = g0.gapY;
      shelf.position.z = faceAt(ph);
      nk[0] = nk[1] = nk[2] = 0;
      for (const [id, c] of disp) {
        const th = c.k === 2 ? 1.5 : 1;
        // teetering: a coin hanging over the lip (or a side gap) tips toward the drop
        const over = Math.max(0, c.y - (EDGE - c.r)) / c.r, side = c.y >= gp ? Math.max(0, Math.abs(c.x) - (HW - c.r)) / c.r : 0;
        const landed = c.landAt ? Math.min(1, (now - c.landAt) / 250) : 1;
        ps.set(c.x, HALF * th + c.h - (over + side) * c.r * 0.25, c.y);
        sc.set(c.r, th, c.r);
        tilt.set((c.h > 0 ? 0.55 * c.h / 3 : 0.12 * (1 - landed) * Math.sin(landed * 9)) + over * 0.35, 0, -Math.sign(c.x) * side * 0.35);
        q.setFromEuler(tilt).multiply(spinQ.setFromAxisAngle(UPV, c.spin ?? (id * 2.39996) % TAU));
        put(c.k);
      }
      // coins going over: they tip off the lip, fall with gravity and land in the tray (or bounce down the gutter)
      for (let j = fallers.length - 1; j >= 0; j--) {
        const f = fallers[j], t = (now - f.at) / 1000;
        if (t > 1.6) { fallers.splice(j, 1); continue; }
        const gut = f.own < 0, sgn = Math.sign(f.x) || 1, floor = gut ? -0.05 : -0.72;
        const fall = Math.min(t, 0.55), y = HALF - 0.5 * 9.8 * fall * fall * 0.9;
        const shrink = t > 1.1 ? Math.max(0, 1 - (t - 1.1) / 0.5) : 1;
        if (gut) ps.set(f.x + sgn * Math.min(t, 0.35) * 1.4, Math.max(floor, y), f.y + Math.max(0, t - 0.3) * 1.2);
        else ps.set(f.x, Math.max(floor, y), f.y + Math.min(t, 0.4) * 1.1 + 0.05);
        const flat = y <= floor;
        sc.set(f.r * shrink, f.k === 2 ? 1.5 : 1, f.r * shrink);
        q.setFromEuler(tilt.set(flat ? 0.15 : Math.min(1.2, t * 5), (f.id * 2.39996) % TAU, gut ? -sgn * Math.min(1.2, t * 4) * (flat ? 0.2 : 1) : 0));
        put(f.k);
        if (t < 0.05 && !gut) sparkle(f.x, EDGE, 4);
      }
      for (let b = 0; b < 3; b++) { batch[b].count = nk[b]; batch[b].instanceMatrix.needsUpdate = true; }
      // chute: on my turn it follows my aim; on someone else's turn it rides over to where they dropped
      const tx = anim ? (anim.adds[0]?.x ?? 0) : myTurn() ? aim * (HW - g0.r) : (chute.position.x * 0.98);
      chute.position.x += (tx - chute.position.x) * Math.min(1, dt * 10);
      const showAim = myTurn() && !anim && !pend;
      const hf = showAim ? handfulAt(aim, ((ph % 1) + 1) % 1) : [];
      aimDots.forEach((m, n) => { const a = hf[n]; m.visible = !!a; if (!a) return; m.position.set(a.x, 0.012, a.y); m.scale.setScalar(a.r); m.material.color.set(a.bell ? 0x7dffb2 : 0xffd23f); m.material.opacity = n ? 0.6 : 0.9; });
      strip.visible = showAim;
      if (showAim) { const lim = HW; strip.scale.set(2 * lim, 0.62, 1); strip.position.set(0, 0.008, faceAt(((ph % 1) + 1) % 1) + g0.r + 0.02); }
      guide.material.opacity = myTurn() ? 0.6 : 0;
      const by = anim ? anim.by : V.seats.indexOf(S.turn);
      guards.forEach((m) => { m.visible = by >= 0 && V.guard[by] > 0; });
      // chasing marquee
      for (let j = 0; j < NB; j++) bulbs.setColorAt(j, bc.set((Math.floor(now / 110) + j) % 5 < 2 ? 0xfff1b0 : 0x8a4a10));
      bulbs.instanceColor.needsUpdate = true;
      for (let i = 0; i < trays.length; i++) {
        paintLabel(i);
        trays[i].tray.material.emissiveIntensity = S.turn === V.seats[i] ? 0.45 + 0.2 * Math.sin(now / 200) : 0.15;
      }
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt; if (pLife[j] <= 0) { pPos[j * 3 + 1] = -99; continue; }
        pVel[j * 3 + 1] -= 6 * dt; pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    }
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    // the playfield x under a point on the screen (for aiming with a finger)
    function pick(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
      return ray.ray.intersectPlane(plane, hit) ? hit.x : null;
    }
    return { draw, resize, dispose, sparkle, pick };
  }

  // ---------- flat fallback: the playfield from above (the edge at the bottom)
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), gg = V ? G() : { hw: 3.6, edge: 6 };
      const w = stage.clientWidth || 320, h = stage.clientHeight || 300, k = Math.min(w / (2 * gg.hw + 1), h / (gg.edge + 2.2));
      canvas.style.width = `${k * (2 * gg.hw + 1)}px`; canvas.style.height = `${k * (gg.edge + 2.2)}px`;
      canvas.width = Math.round(k * (2 * gg.hw + 1) * dpr); canvas.height = Math.round(k * (gg.edge + 2.2) * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      const gg = G(), W = canvas.width, H = canvas.height, k = W / (2 * gg.hw + 1), X = (x) => W / 2 + x * k, Y = (y) => (y + 0.6) * k;
      g.fillStyle = '#2a0f30'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#6b707c'; g.fillRect(X(-gg.hw), Y(-0.6), 2 * gg.hw * k, (gg.edge + 0.6) * k);
      const n = V.seats.length;
      for (let i = 0; i < n; i++) { const w = 2 * gg.hw / n; g.fillStyle = colorOf(i); g.fillRect(X(-gg.hw + w * i) + 2, Y(gg.edge) + 4, w * k - 4, 0.9 * k); g.fillStyle = '#fff'; g.font = `bold ${Math.round(0.42 * k)}px sans-serif`; g.textAlign = 'center'; g.fillText(`${shown[i] ?? 0}`, X(-gg.hw + w * (i + 0.5)), Y(gg.edge) + 0.65 * k); }
      for (const [bx, by] of gg.bells) { g.strokeStyle = '#ffd23f'; g.lineWidth = 0.06 * k; g.beginPath(); g.arc(X(bx), Y(by), gg.bellR * k, 0, 7); g.stroke(); }
      const face = faceAt(shelfPhase(now));
      g.fillStyle = '#2a2f3a'; g.fillRect(X(-gg.hw), Y(-0.6), 2 * gg.hw * k, (face + 0.6) * k);
      g.fillStyle = '#e8ecf2'; g.fillRect(X(-gg.hw), Y(face) - 2, 2 * gg.hw * k, 3);
      for (const c of disp.values()) {
        // #156: a rim, an inner ring and the coin's mark
        const cx = X(c.x), cy = Y(c.y), R = c.r * k * (1 + c.h * 0.12);
        g.globalAlpha = c.h > 0 ? 0.6 : 1;
        g.fillStyle = c.k === 1 ? '#d9c8ff' : c.k === 2 ? '#f0a83a' : '#f2c14e'; g.strokeStyle = c.k === 1 ? '#ff4fa0' : '#8a6410'; g.lineWidth = Math.max(1, R * 0.14);
        g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.stroke();
        g.strokeStyle = c.k === 1 ? '#ff4fa088' : '#a07a1a99'; g.lineWidth = Math.max(1, R * 0.07); g.beginPath(); g.arc(cx, cy, R * 0.66, 0, 7); g.stroke();
        if (R > 6) { g.fillStyle = c.k === 1 ? '#ff4fa0' : '#8a6410'; g.font = `900 ${Math.round(R * 0.9)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.k === 1 ? '★' : c.k === 2 ? 'M' : '1', cx, cy + R * 0.05); }
      }
      g.globalAlpha = 1;
      if (myTurn() && !anim && !pend) {
        const ph = ((shelfPhase(now) % 1) + 1) % 1;
        g.fillStyle = '#ffd23f22'; g.fillRect(X(-gg.hw), Y(faceAt(ph)), 2 * gg.hw * k, 2 * gg.r * k + 2);
        handfulAt(aim, ph).forEach((a, n) => { g.strokeStyle = a.bell ? '#7dffb2' : '#ffd23f'; g.globalAlpha = n ? 0.65 : 1; g.lineWidth = 2; g.beginPath(); g.arc(X(a.x), Y(a.y), a.r * k, 0, 7); g.stroke(); });
        g.globalAlpha = 1;
      }
    }
    resize();
    function pick(px) {
      const r = canvas.getBoundingClientRect(), gg = G(), k = r.width / (2 * gg.hw + 1);
      return (px - r.left - r.width / 2) / k;
    }
    return { draw, resize, dispose() { canvas.remove(); }, sparkle() {}, pick };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.turn && s.pusher.me != null && s.turn === s.pusher.seats[s.pusher.me] ? '🪙 Your drop!' : '🪙 Coin Cascade') : null);

  return { mount, render, unmount, fast, turnText, focus: true };
})();
