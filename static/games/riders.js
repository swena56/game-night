// Light Riders: the server simulates the grid; this module keeps a local copy of every trail (full
// views replace it, fast updates append recent cells), draws it in 3D (three.js) or 2D, and sends
// turns. Bikes glide between server ticks so motion looks smooth at any tick rate.
// The arena fills the room; scores and the boost button float on top of it. Swipe anywhere (or, in
// tap mode, tap the left/right half to turn relative to your bike); your bike turns on screen at
// once, before the server confirms. Crashes cost a life: the wreck clears and you respawn.
UI.riders = (() => {
  let S, ctx, trails = [], live = [], lastTick = 0, tickAt = 0, round = 0, ring = 0;  // ring: 🧱 closed bands
  let gl = null, flat = null, raf = 0, ro = null, keyHandler = null, swipe = null, root = null;
  let pred = null, tapTurn = false, lastCount = '';
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; trails = []; live = []; round = 0; gl = null; flat = null; pred = null; lastCount = '';
    tapTurn = !!load('riders.tapTurn');
    main.innerHTML = `<div class="lr" id="lrRoot"><div class="lr-stage" id="lrStage">
        <div class="lr-hud" id="lrHud"></div>
        <div class="lr-banner" id="lrBanner" hidden></div>
        <div class="lr-pad" id="lrPad">
          <span></span><button data-d="0" aria-label="Up">▲</button><span></span>
          <button data-d="3" aria-label="Left">◀</button><span></span><button data-d="1" aria-label="Right">▶</button>
          <span></span><button data-d="2" aria-label="Down">▼</button><span></span></div>
        <button id="lrBoost" class="lr-boost" aria-label="Boost">⚡</button>
      </div></div>`;
    side.innerHTML = `<div class="panel"><div id="lrRiders"></div>
      <label class="check"><input type="checkbox" id="lrTap"> Tap left / right side to turn</label>
      <p class="hint left" id="lrHow"></p></div>`;
    const how = () => {
      $('lrHow').textContent = tapTurn
        ? 'Tap the left or right half of the screen to turn left or right from where your bike is heading. Keys: arrows / WASD, Q/E turn, Space boosts.'
        : 'Swipe anywhere to steer, or use the keyboard (arrows / WASD, Q/E turn, Space boosts). Ride beside a trail to grind a boost back.';
    };
    $('lrTap').checked = tapTurn;
    $('lrTap').addEventListener('change', (e) => { tapTurn = e.target.checked; store('riders.tapTurn', tapTurn || null); how(); });
    how();
    for (const b of $('lrPad').querySelectorAll('button[data-d]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); steer(+b.dataset.d); });
    $('lrBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); boost(); });
    root = $('lrRoot');
    const stage = $('lrStage');
    // The whole game area ignores browser panning, so a swipe can't scroll the page; the pointer is
    // captured so the swipe keeps steering wherever the finger goes.
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, label')) return;
      if (tapTurn) {  // turn on touch-down: no waiting to tell a tap from a swipe
        const r = root.getBoundingClientRect();
        turn(e.clientX < r.left + r.width / 2 ? 3 : 1);
        return;
      }
      swipe = { x: e.clientX, y: e.clientY };
      try { root.setPointerCapture(e.pointerId); } catch {}
    });
    root.addEventListener('pointermove', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      // about 6% of the arena's width: small enough for a phone, not twitchy on a tablet
      if (Math.hypot(dx, dy) < Math.max(18, Math.min(48, root.clientWidth * 0.06))) return;
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe = { x: e.clientX, y: e.clientY };  // keep swiping in the same gesture
    });
    for (const t of ['pointerup', 'pointercancel']) root.addEventListener(t, () => { swipe = null; });
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select') && e.target.type !== 'checkbox') return;
      const k = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[e.code];
      const rel = { KeyQ: 3, Comma: 3, KeyE: 1, Period: 1 }[e.code];
      if (k != null) { e.preventDefault(); steer(k); }
      else if (rel != null) { e.preventDefault(); turn(rel); }
      else if (['Space', 'ShiftLeft', 'ShiftRight', 'Enter'].includes(e.code)) { e.preventDefault(); boost(); }
    };
    addEventListener('keydown', keyHandler);
    ro = window.ResizeObserver ? new ResizeObserver(() => { gl?.resize(); flat?.resize(); }) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if (S) (gl || flat)?.reset(); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect(); removeEventListener('keydown', keyHandler);
    gl?.dispose(); gl = null; flat = null; root = null;
    snd.stop();
  }

  const mine = () => S?.riders?.me;
  const canSteer = () => mine() != null && S.phase === 'playing' && S.riders.stage !== 'over' && live[mine()]?.alive;
  // the way my bike is heading on screen: the last turn I sent, until the server confirms or drops it
  const myDir = () => pred?.dir ?? live[mine()]?.dir ?? 0;
  function steer(d) {
    if (!canSteer()) return;
    const cur = myDir();
    if (d === cur || d === (cur + 2) % 4) return;  // the server ignores these too (no U-turns)
    pred = { dir: d, k: lastTick };
    buzz(10); snd.play('turn');
    ctx.input({ dir: d }, true);
  }
  const turn = (side) => steer((myDir() + side) % 4);  // 1 = right, 3 = left, relative to the bike
  function boost() {
    const L = live[mine()];
    if (!canSteer() || S.riders.stage !== 'ride' || !L.boosts || L.boosting) return;
    snd.play('boost');
    ctx.input({ boost: true }, true);
  }
  const colorOf = (i) => ctx.player(S.riders.seats[i])?.color ?? '#888';

  // ---------- state: full views replace the trails, fast updates append the newest cells
  // what changed for rider i between two states: crash, respawn, a boost earned by grinding
  function events(i, was, now) {
    if (!was) return;
    const me = i === mine();
    if (was.alive && !now.alive) {
      (gl || flat)?.crash?.(i);
      snd.play(me ? 'crashMe' : 'crash');
      if (me) { buzz([80, 50, 160]); pred = null; }
    } else if (!was.alive && now.alive && S.riders.stage === 'ride') {
      (gl || flat)?.pulse?.(i);
      if (me) { snd.play('respawn'); buzz(20); pred = null; }
    }
    if (now.alive && now.grind > was.grind) (gl || flat)?.grind?.(i);
    if (me && now.alive && was.alive && now.boosts > was.boosts && !now.boosting) { snd.play('earn'); (gl || flat)?.grind?.(i); }
  }

  function render(s, c) {
    S = s; ctx = c;
    const r = s.riders;
    const fresh = r.round !== round;
    ring = r.ring || 0;  // a full view carries the closed band (a new round opens it again)
    round = r.round;
    trails = r.trails.map((t) => [...t]);
    const old = live;
    live = r.alive.map((a, i) => ({ alive: a, dir: r.dirs[i], boosts: r.boosts[i], boosting: false,
      lives: r.lives?.[i] ?? 1, grind: r.grind?.[i] ?? 0, respawnAt: r.respawning?.[i] != null ? performance.now() + r.respawning[i] * 1000 : null }));
    if (!fresh) live.forEach((L, i) => { events(i, old[i], L); if (old[i]?.boosting) L.boosting = true; });
    else pred = null;
    lastTick = r.tick; tickAt = performance.now();
    if (fresh) (gl || flat)?.reset(); else (gl || flat)?.sync();
    S.countdownAt = performance.now() + r.countdown * 1000;
    if (fresh) S.roundAt = performance.now();
    renderSide();
  }

  function fast(data) {
    if (!S || data.k < lastTick) return;  // a new round starts with a full view
    data.p.forEach(([len, alive, dir, boosts, boosting, lives, grind, ...tail], i) => {
      const t = trails[i]; if (!t) return;
      if (len < t.length) t.length = 0;  // the trail was wiped (a crash with lives left, or a respawn)
      for (let idx = Math.max(t.length, len - tail.length); idx < len; idx++) t.push(tail[idx - (len - tail.length)]);
      const was = live[i];
      live[i] = { alive: !!alive, dir, boosts, boosting: !!boosting, lives, grind, respawnAt: was?.respawnAt ?? null };
      if (alive) live[i].respawnAt = null;
      events(i, was, live[i]);
    });
    if (data.k !== lastTick) { lastTick = data.k; tickAt = performance.now(); }
    if ((data.w || 0) > ring) { if (!ring) { Kit.callout('🧱 The walls are closing in!', 'bad', { ms: 1500 }); ctx.sfx('alarm'); } ring = data.w; }
    const L = live[mine()];
    if (pred && L && (L.dir === pred.dir || lastTick > pred.k + 3)) pred = null;
    S.riders.stage = data.st;
    (gl || flat)?.sync();
    renderSide();
  }

  let sideKey = '';
  function renderSide() {
    const r = S.riders, box = $('lrRiders'); if (!box) return;
    const me = r.me != null ? live[r.me] : null;
    const b = $('lrBoost');
    b.textContent = me ? `⚡${me.boosts}` : '⚡';
    b.style.setProperty('--g', me ? Math.min(1, me.grind / (r.grindFull || 25)) : 0);
    b.disabled = !me || !me.alive || !me.boosts || r.stage !== 'ride';
    b.hidden = r.me == null;
    $('lrPad').hidden = r.me == null;
    // fast updates arrive every tick: only rebuild the panels when something on them changed (#32)
    const key = JSON.stringify([r.round, r.stage, r.wins, r.seats, r.me, live.map((L) => [L?.alive, L?.lives, L?.respawnAt != null])]);
    if (key === sideKey && box.childElementCount) return;
    sideKey = key;
    const lifeText = (i) => (r.maxLives > 1 ? ' ' + '♥'.repeat(Math.max(0, live[i]?.lives ?? 0)) : '');
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}${r.maxLives > 1 ? ` · ${r.maxLives} lives` : ''}`));
    const hud = $('lrHud'); hud.innerHTML = '';
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), L = live[i];
      const out = !L?.alive && L?.respawnAt == null;
      const row = ctx.el('div', 'seat-row lr-row' + (L?.alive ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i); dot.style.boxShadow = `0 0 8px ${colorOf(i)}`;
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${L?.alive ? '' : out ? ' 💥' : ' ⟳'}${lifeText(i)}`),
        ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
      const chip = ctx.el('span', 'lr-chip' + (i === r.me ? ' me' : '') + (out ? ' out' : ''));
      const c = ctx.el('i'); c.style.background = colorOf(i); c.style.boxShadow = `0 0 6px ${colorOf(i)}`;
      chip.append(c, ctx.el('span', '', `${i === r.me ? 'You' : (p?.name ?? '—').slice(0, 8)} ${'★'.repeat(r.wins[i])}${lifeText(i)}${L?.alive ? '' : out ? ' 💥' : ' ⟳'}`));
      hud.append(chip);
    });
  }

  // where a rider's bike is drawn: past its last cell by the fraction of a tick that has elapsed
  function headPos(i, now) {
    const t = trails[i]; if (!t?.length) return null;
    const n = S.riders.n, c = t[t.length - 1], x = c % n, y = Math.floor(c / n);
    const L = live[i];
    if (!L?.alive || S.riders.stage !== 'ride') return [x, y];
    const per = 1000 / S.riders.speed;
    const f = Math.min(0.85, ((now - tickAt) / per) * (L.boosting ? 2 : 1));
    const [dx, dy] = DIRS[headDir(i)];
    return [x + dx * f, y + dy * f];
  }
  const headDir = (i) => (i === mine() ? myDir() : live[i]?.dir ?? 0);

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.riders) return;
    (gl || flat)?.draw(now);
    const r = S.riders, banner = $('lrBanner'), me = r.me != null ? live[r.me] : null;
    const left = ((S.countdownAt ?? 0) - now) / 1000;
    let text = '', small = false;
    if (S.phase === 'playing' && r.stage === 'countdown') text = left > 0 ? String(Math.ceil(left)) : 'GO!';
    else if (S.phase === 'playing' && r.stage === 'over') text = 'Round over';
    else if (S.phase === 'playing' && me && !me.alive) {
      small = true;
      text = me.respawnAt != null ? `💥 Respawning in ${Math.max(0, (me.respawnAt - now) / 1000).toFixed(1)}` : '💥 Out — watching';
    }
    banner.hidden = !text; banner.textContent = text; banner.classList.toggle('small', small);
    // countdown beeps and the GO, once each
    const count = S.phase !== 'playing' ? '' : r.stage === 'countdown' && left > 0 ? String(Math.ceil(left)) : r.stage === 'ride' ? 'GO' : '';
    if (count !== lastCount) {
      if (me && count && (count !== 'GO' || lastCount)) snd.play(count === 'GO' ? 'go' : 'beep');  // no GO when joining mid-ride
      lastCount = count;
    }
    snd.engine(S.phase === 'playing' && r.stage === 'ride' && me?.alive ? (me.boosting ? 2 : 1) : null);
  }

  // ---------- sound: an engine hum while you ride and short synthesized hits (no files)
  const snd = (() => {
    let a = null, eng = null;
    const on = () => (typeof prefs === 'undefined' || prefs.sound) && !document.hidden;
    // through the app's output, so the volume setting applies (its own context only if that's missing)
    const shared = () => typeof out === 'function';
    function ac() { a ||= shared() ? out().context : new (window.AudioContext || window.webkitAudioContext)(); if (a.state === 'suspended') a.resume(); return a; }
    const dest = () => (shared() ? out() : a.destination);
    function tone(f0, f1, dur, type, vol, at = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest()); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, f0, f1, q, vol, at = 0) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
      src.buffer = buf; fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.value = vol; src.connect(fl).connect(g).connect(dest()); src.start(t);
    }
    const HITS = {
      turn: () => tone(900, 700, 0.05, 'square', 0.025),
      boost: () => { noise(0.6, 300, 2600, 1.2, 0.5); tone(110, 330, 0.5, 'sawtooth', 0.04); },
      crash: () => { noise(0.35, 900, 200, 0.8, 0.3); tone(110, 50, 0.3, 'sine', 0.1); },
      crashMe: () => { noise(0.7, 1400, 100, 0.7, 1); tone(90, 30, 0.6, 'sine', 0.35); },
      respawn: () => [0, 1, 2, 3].forEach((k) => tone(330 + k * 165, 360 + k * 180, 0.16, 'triangle', 0.06, k * 0.06)),
      earn: () => [880, 1320].forEach((f, k) => tone(f, f, 0.09, 'triangle', 0.08, k * 0.06)),
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
    };
    function play(kind) { if (on()) try { ac(); HITS[kind](); } catch {} }
    // the hum: two detuned saws through a low-pass, higher while boosting; silent unless you're riding
    function engine(level) {
      if (!on() || level == null) { stop(); return; }
      try {
        if (!eng) {
          ac();
          const g = a.createGain(), fl = a.createBiquadFilter(); g.gain.value = 0; fl.type = 'lowpass'; fl.Q.value = 4;
          const os = [0, 9].map((cents) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.connect(fl); o.start(); return o; });
          fl.connect(g).connect(dest()); eng = { g, fl, os, level: 0 };
        }
        if (eng.level === level) return;
        eng.level = level;
        const t = a.currentTime;
        for (const o of eng.os) o.frequency.setTargetAtTime(level > 1 ? 120 : 70, t, 0.1);
        eng.fl.frequency.setTargetAtTime(level > 1 ? 1600 : 650, t, 0.1);
        eng.g.gain.setTargetAtTime(level > 1 ? 0.035 : 0.02, t, 0.15);
      } catch {}
    }
    function stop() {
      if (!eng) return;
      const e = eng; eng = null;
      try { e.g.gain.setTargetAtTime(0, a.currentTime, 0.05); setTimeout(() => e.os.forEach((o) => o.stop()), 300); } catch {}
    }
    return { play, engine, stop };
  })();

  // ---------- three.js arena
  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage); if (S) (gl || flat)?.reset();
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x05060f); scene.fog = new T.Fog(0x05060f, 80, 220);
    const camera = new T.PerspectiveCamera(38, 1, 0.5, 500);
    scene.add(new T.AmbientLight(0xffffff, 0.35));
    const sun = new T.DirectionalLight(0xffffff, 0.5); sun.position.set(-20, 60, 30); scene.add(sun);
    let n = 0, world = null, ribbons = [], bikes = [], tips = [], drawn = [], pend = [], you = null, arrow = null, sparks = null, walls = [];
    const segGeo = new T.BoxGeometry(1, 1, 1);

    function build() {
      if (world) scene.remove(world);
      world = new T.Group(); scene.add(world);
      n = S.riders.n;
      const half = n / 2;
      // floor with a glowing grid texture
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      let mat = new T.MeshStandardMaterial({ color: 0x0a1030, roughness: 0.9 });
      if (g) {
        g.fillStyle = '#070b22'; g.fillRect(0, 0, 512, 512);
        g.strokeStyle = '#1f6fff55'; g.lineWidth = 2;
        for (let k = 0; k <= 8; k++) { const p = (k * 512) / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
        const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(n / 8, n / 8);
        mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0x0b1a55, emissiveIntensity: 0.25 });
      }
      const floor = new T.Mesh(new T.PlaneGeometry(n, n), mat); floor.rotation.x = -Math.PI / 2; world.add(floor);
      const wallMat = new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x8ecae6, emissiveIntensity: 0.9 });
      walls = [];
      for (const [w, d, x, z] of [[n + 1, 0.5, 0, -half - 0.25], [n + 1, 0.5, 0, half + 0.25], [0.5, n + 1, -half - 0.25, 0], [0.5, n + 1, half + 0.25, 0]]) {
        const m = new T.Mesh(new T.BoxGeometry(w, 1.2, d), wallMat); m.position.set(x, 0.6, z); world.add(m); walls.push(m);
      }
      ribbons = []; bikes = []; tips = []; drawn = []; pend = [];
      S.riders.seats.forEach((_, i) => {
        const color = new T.Color(colorOf(i));
        const rm = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85, transparent: true, opacity: 0.9 });
        const inst = new T.InstancedMesh(segGeo, rm, n * n); inst.count = 0; world.add(inst); ribbons.push(inst);
        const tip = new T.Mesh(segGeo, rm); world.add(tip); tips.push(tip);
        const bike = new T.Group();
        const body = new T.Mesh(new T.BoxGeometry(0.7, 0.55, 1.5), new T.MeshStandardMaterial({ color: 0x111122, emissive: color, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 }));
        body.position.y = 0.45; bike.add(body);
        const stripe = new T.Mesh(new T.BoxGeometry(0.74, 0.12, 1.55), new T.MeshBasicMaterial({ color })); stripe.position.y = 0.45; bike.add(stripe);
        for (const z of [-0.55, 0.55]) {
          const wheel = new T.Mesh(new T.TorusGeometry(0.28, 0.08, 8, 18), new T.MeshBasicMaterial({ color }));
          wheel.rotation.y = Math.PI / 2; wheel.position.set(0, 0.3, z); bike.add(wheel);
        }
        bike.scale.setScalar(1.35);  // readable from the steep, phone-shaped view
        world.add(bike); bikes.push(bike); drawn.push(0);
      });
      // you: a pulsing ring under your bike, and a big arrow showing your heading during the countdown
      you = new T.Mesh(new T.RingGeometry(0.95, 1.25, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }));
      you.rotation.x = -Math.PI / 2; world.add(you);
      const sh = new T.Shape();
      [[-0.45, 0], [0.45, 0], [0.45, 1.4], [1.1, 1.4], [0, 2.7], [-1.1, 1.4], [-0.45, 1.4]].forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      const am = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      am.rotation.x = Math.PI / 2; am.position.set(0, 0.12, 1.3);
      arrow = new T.Group(); arrow.add(am); world.add(arrow);
      // grind sparks: one recycled pool of points
      const SP = 160, sp = new Float32Array(SP * 3).fill(-999), col = new Float32Array(SP * 3);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(sp, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      sparks = { pts: new T.Points(geo, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })), vel: Array.from({ length: SP }, () => [0, 0, 0, 0]), next: 0 };
      sparks.pts.frustumCulled = false; world.add(sparks.pts);
      resize();
    }
    const at = (c) => [(c % n) - n / 2 + 0.5, Math.floor(c / n) - n / 2 + 0.5];
    const mtx = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
    function segment(a, b, setMatrix) {  // a thin glowing wall from point a to point b (x, z)
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) + 0.3;
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      v.set((a[0] + b[0]) / 2, 0.45, (a[1] + b[1]) / 2); sc.set(0.3, 0.9, len);
      mtx.compose(v, q, sc);
      setMatrix(mtx);
    }
    function sync() {
      if (!world || S.riders.n !== n || ribbons.length !== trails.length) return build();
      trails.forEach((t, i) => {
        const inst = ribbons[i];
        inst.material.opacity = live[i]?.alive ? 0.9 : 0.3;
        if (t.length < drawn[i]) { drawn[i] = 0; inst.count = 0; }
        if (t.length === drawn[i]) return;
        const from = Math.max(1, drawn[i]);
        for (let k = from; k < t.length; k++) segment(at(t[k - 1]), at(t[k]), (m) => inst.setMatrixAt(k - 1, m));
        inst.count = Math.max(0, t.length - 1);
        // upload only the new segments, not the whole n×n buffer (#32)
        const attr = inst.instanceMatrix;
        pend[i] = Math.min(pend[i] ?? Infinity, from - 1);  // two updates between frames: upload both
        if (attr.updateRange) { attr.updateRange.offset = pend[i] * 16; attr.updateRange.count = Math.max(0, t.length - 1 - pend[i]) * 16; }
        attr.needsUpdate = true;
        drawn[i] = t.length;
      });
    }
    function reset() { build(); drawn = drawn.map(() => 0); sync(); }
    // Fit the whole arena. A tall (portrait) box looks almost straight down so the square fills its
    // width; a wide box keeps a lower, more dramatic angle. Then back off until all four corners fit.
    const base = new T.Vector3(), target = new T.Vector3();
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const half = (n || 40) / 2 + 1;
      const k = Math.min(1, Math.max(0, (camera.aspect - 0.7) / 0.8));   // 0 portrait … 1 wide
      const back = 0.12 + 0.34 * k;                                       // ~83° down on a phone, ~63° wide
      target.set(0, 0, half * 0.05 * k);
      let dist = half * 1.2;
      for (let j = 0; j < 90; j++) {
        camera.position.set(0, dist * 0.9, dist * back); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const fits = [[-half, -half], [half, -half], [-half, half], [half, half]].every(([x, z]) => {
          const p = new T.Vector3(x, 0, z).project(camera); return Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.96;
        });
        if (fits) break;
        dist *= 1.025;
      }
      base.copy(camera.position);
    }
    // 💥 a crash: sparks in the rider's colour, a shockwave ring, and a shake when it's you
    const booms = [];
    let lastDraw = 0;
    function ring(x, z, color, grow) {
      const m = new T.Mesh(new T.RingGeometry(0.6, 0.9, 40), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.userData.grow = grow;
      world.add(m); return m;
    }
    function crash(i) {
      const bike = bikes[i]; if (!bike || !world) return;
      const color = new T.Color(colorOf(i)), N = 70, pos = new Float32Array(N * 3), vel = [];
      for (let k = 0; k < N; k++) {
        pos.set([bike.position.x, 0.5, bike.position.z], k * 3);
        const a = Math.random() * 6.283, up = 2 + Math.random() * 6, sp = 3 + Math.random() * 9;
        vel.push([Math.cos(a) * sp, up, Math.sin(a) * sp]);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color, size: 0.45, transparent: true }));
      world.add(pts);
      booms.push({ pts, ring: ring(bike.position.x, bike.position.z, color, 9), vel, t: 0 });
      if (i === S.riders.me) GL3.shake(camera, 1.1);
    }
    // ⟳ a respawn: a ring that closes in on the new spot
    function pulse(i) {
      const t = trails[i]; if (!world || !t?.length) return;
      const [x, z] = at(t[t.length - 1]);
      booms.push({ pts: null, ring: ring(x, z, new T.Color(colorOf(i)), -0.6), vel: [], t: 0 });
      booms.at(-1).ring.scale.setScalar(6);
    }
    function grind(i) {
      const bike = bikes[i]; if (!sparks || !bike?.visible) return;
      const a = sparks.pts.geometry.attributes, color = new T.Color(colorOf(i)).lerp(new T.Color(0xffffff), 0.5);
      for (let k = 0; k < 6; k++) {
        const j = sparks.next; sparks.next = (j + 1) % sparks.vel.length;
        a.position.array.set([bike.position.x + (Math.random() - 0.5) * 0.6, 0.3, bike.position.z + (Math.random() - 0.5) * 0.6], j * 3);
        a.color.array.set([color.r, color.g, color.b], j * 3);
        const ang = Math.random() * 6.283, sp = 1 + Math.random() * 3;
        sparks.vel[j] = [Math.cos(ang) * sp, 2 + Math.random() * 3, Math.sin(ang) * sp, 0.5];
      }
    }
    function tickSparks(dt) {
      if (!sparks) return;
      const p = sparks.pts.geometry.attributes.position;
      let any = false;
      sparks.vel.forEach((v, j) => {
        if (v[3] <= 0) return;
        any = true; v[3] -= dt; v[1] -= 14 * dt;
        p.array[j * 3] += v[0] * dt; p.array[j * 3 + 1] = Math.max(0.05, p.array[j * 3 + 1] + v[1] * dt); p.array[j * 3 + 2] += v[2] * dt;
        if (v[3] <= 0) p.array[j * 3 + 1] = -999;
      });
      if (any) p.needsUpdate = true;
    }
    function tickBooms(dt) {
      for (const b of booms) {
        b.t += dt;
        if (b.pts) {
          const a = b.pts.geometry.attributes.position;
          for (let k = 0; k < b.vel.length; k++) {
            const v = b.vel[k]; v[1] -= 18 * dt;
            a.array[k * 3] += v[0] * dt; a.array[k * 3 + 1] = Math.max(0.05, a.array[k * 3 + 1] + v[1] * dt); a.array[k * 3 + 2] += v[2] * dt;
            if (a.array[k * 3 + 1] <= 0.05) { v[0] *= 0.8; v[2] *= 0.8; v[1] = Math.abs(v[1]) * 0.3; }
          }
          a.needsUpdate = true;
          b.pts.material.opacity = Math.max(0, 1 - b.t / 1.4);
        }
        const g = b.ring.userData.grow;
        b.ring.scale.setScalar(g > 0 ? 1 + b.t * g : Math.max(0.3, 6 * (1 - b.t / 0.6)));
        b.ring.material.opacity = Math.max(0, 0.9 - b.t * 1.5);
      }
      while (booms.length && booms[0].t > 1.4) {
        const b = booms.shift();
        if (b.pts) { world?.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); }
        world?.remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose();
      }
    }
    const close = new T.Vector3(), look = new T.Vector3();
    function draw(now) {
      if (!world) return;
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      // 🧱 the walls move in, ring by ring
      if (walls.length === 4 && walls.ring !== ring) {
        walls.ring = ring;
        const h = n / 2 - ring, span = (n - 2 * ring + 1) / (n + 1);
        walls[0].position.z = -h - 0.25; walls[1].position.z = h + 0.25; walls[2].position.x = -h - 0.25; walls[3].position.x = h + 0.25;
        walls.forEach((m) => { m.scale.set(m.geometry.parameters.width > 1 ? span : 1, 1, m.geometry.parameters.depth > 1 ? span : 1); m.material.color.setHex(ring ? 0xff6b6b : 0x8ecae6); m.material.emissive.setHex(ring ? 0xff6b6b : 0x8ecae6); });
      }
      tickBooms(dt); tickSparks(dt);
      const me = S.riders.me;
      trails.forEach((t, i) => {
        const pos = headPos(i, now), bike = bikes[i], tip = tips[i];
        if (!pos) { bike.visible = tip.visible = false; return; }
        const p = [pos[0] - n / 2 + 0.5, pos[1] - n / 2 + 0.5];
        bike.visible = !!live[i]?.alive;
        bike.position.set(p[0], 0, p[1]);
        const [dx, dy] = DIRS[headDir(i)];
        bike.rotation.y = Math.atan2(dx, dy);
        tip.visible = bike.visible && t.length > 0;
        if (tip.visible) segment(at(t[t.length - 1]), p, (m) => { tip.matrixAutoUpdate = false; tip.matrix.copy(m); });
      });
      const myBike = me != null ? bikes[me] : null, counting = S.riders.stage === 'countdown';
      you.visible = !!myBike?.visible;
      if (you.visible) {
        you.position.set(myBike.position.x, 0.06, myBike.position.z);
        you.scale.setScalar((counting ? 1.6 : 1) + 0.15 * Math.sin(now / 160));
      }
      arrow.visible = !!myBike?.visible && counting;
      if (arrow.visible) {
        arrow.position.copy(myBike.position); arrow.rotation.y = myBike.rotation.y;
        arrow.children[0].position.z = 1.3 + 0.35 * Math.abs(Math.sin(now / 220));
      }
      // the first moments of a round: start close over your bike, then pull back to the whole arena
      camera.position.copy(base); look.copy(target);
      const since = (now - (S.roundAt ?? -1e9)) / 1000;
      if (counting && myBike?.visible && since < 2.4) {
        const e = Math.min(1, Math.max(0, (since - 0.5) / 1.6)), s = e * e * (3 - 2 * e);
        close.set(myBike.position.x, 14, myBike.position.z + 6);
        camera.position.lerpVectors(close, base, s);
        look.lerpVectors(myBike.position, target, s);
      }
      camera.lookAt(look);
      GL3.tickShake(camera, dt);
      renderer.render(scene, camera);
      pend = [];
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    if (S) build();
    return { sync, reset, resize, draw, dispose, crash, pulse, grind };
  }

  // ---------- flat fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let cell = 8;
    const glints = [];  // grind sparks: [x, y, born]
    function resize() {
      const n = S?.riders?.n || 40, dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.min(stage.clientWidth || 320, stage.clientHeight || 320);
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
      cell = canvas.width / n;
    }
    function draw(now) {
      const n = S.riders.n;
      if (!canvas.width) resize();
      g.fillStyle = '#05060f'; g.fillRect(0, 0, canvas.width, canvas.height);
      if (ring) {  // 🧱 the closed band round the edge
        g.fillStyle = '#ff6b6b33';
        g.fillRect(0, 0, canvas.width, ring * cell); g.fillRect(0, canvas.height - ring * cell, canvas.width, ring * cell);
        g.fillRect(0, 0, ring * cell, canvas.height); g.fillRect(canvas.width - ring * cell, 0, ring * cell, canvas.height);
        g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.strokeRect(ring * cell, ring * cell, canvas.width - 2 * ring * cell, canvas.height - 2 * ring * cell);
      }
      g.strokeStyle = '#1f6fff22'; g.lineWidth = 1;
      for (let k = 0; k <= n; k += 4) { g.beginPath(); g.moveTo(k * cell, 0); g.lineTo(k * cell, canvas.height); g.moveTo(0, k * cell); g.lineTo(canvas.width, k * cell); g.stroke(); }
      trails.forEach((t, i) => {
        if (!t.length) return;
        const color = colorOf(i), alive = live[i]?.alive;
        g.save(); g.strokeStyle = color; g.globalAlpha = alive ? 1 : 0.35; g.lineWidth = cell * 0.45; g.lineJoin = g.lineCap = 'round';
        g.shadowColor = color; g.shadowBlur = cell * 1.5;
        g.beginPath();
        t.forEach((c, k) => { const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell; k ? g.lineTo(x, y) : g.moveTo(x, y); });
        const pos = headPos(i, now);
        if (pos && alive) g.lineTo((pos[0] + 0.5) * cell, (pos[1] + 0.5) * cell);
        g.stroke();
        if (pos && alive) { g.fillStyle = '#fff'; g.fillRect((pos[0] + 0.15) * cell, (pos[1] + 0.15) * cell, cell * 0.7, cell * 0.7); }
        g.restore();
        if (pos && alive && i === S.riders.me) {  // you: a pulsing ring, and an arrow during the countdown
          const cx = (pos[0] + 0.5) * cell, cy = (pos[1] + 0.5) * cell, counting = S.riders.stage === 'countdown';
          g.save(); g.strokeStyle = '#fff'; g.globalAlpha = 0.85; g.lineWidth = Math.max(2, cell * 0.2);
          g.beginPath(); g.arc(cx, cy, cell * ((counting ? 2.2 : 1.4) + 0.2 * Math.sin(now / 160)), 0, 6.283); g.stroke();
          if (counting) {
            const [dx, dy] = DIRS[headDir(i)], L = cell * (3 + 0.6 * Math.abs(Math.sin(now / 220)));
            g.lineWidth = cell * 0.5; g.lineCap = 'round';
            g.beginPath(); g.moveTo(cx + dx * cell * 1.5, cy + dy * cell * 1.5); g.lineTo(cx + dx * L, cy + dy * L);
            g.moveTo(cx + dx * L - dy * cell - dx * cell, cy + dy * L + dx * cell - dy * cell); g.lineTo(cx + dx * L, cy + dy * L);
            g.lineTo(cx + dx * L + dy * cell - dx * cell, cy + dy * L - dx * cell - dy * cell); g.stroke();
          }
          g.restore();
        }
      });
      for (let k = glints.length - 1; k >= 0; k--) {
        const [x, y, born] = glints[k], age = (now - born) / 400;
        if (age > 1) { glints.splice(k, 1); continue; }
        g.fillStyle = `rgba(255,255,255,${1 - age})`; g.beginPath(); g.arc(x, y, cell * 0.25 * (1 + age), 0, 6.283); g.fill();
      }
      g.strokeStyle = '#8ecae6'; g.lineWidth = 3; g.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }
    function grind(i) {
      const pos = headPos(i, performance.now()); if (!pos) return;
      for (let k = 0; k < 3; k++) glints.push([(pos[0] + 0.5 + (Math.random() - 0.5)) * cell, (pos[1] + 0.5 + (Math.random() - 0.5)) * cell, performance.now()]);
    }
    resize();
    return { sync() {}, reset: resize, resize, draw, grind };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🏍️ Round ${s.riders.round} — first to ${s.riders.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.riders.stage === 'ride' && s.riders.me != null && s.riders.alive[s.riders.me];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
