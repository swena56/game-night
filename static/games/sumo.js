// Sumo Saucers: the server owns the physics; this module draws the platform in 3D (three.js) or 2D,
// glides saucers between updates using their velocity, and sends the stick and dashes.
// Controls: drag anywhere for a virtual stick (a tap dashes), the 💨 button, or WASD/arrows + Space.
// Once you're knocked out the same controls steer your 👻 ghost and drop ☄️ meteors.
// The server sends hits, shatters, falls and pickups as numbered events ("ev"): they drive the sparks,
// shock rings, falling debris and the synthesized sounds.
UI.sumo = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null;
  let keyDown = null, keyUp = null, drag = null, stick = [0, 0], sentAt = 0, keys = new Set(), countdownAt = 0;
  let hist = [], replay = null, live = null;  // recent frames; a slow-motion replay of the knock-off; the real state meanwhile
  let lastSeq = -1, flash = null, falls = [], lastCount = 0, sideAt = 0;
  const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const STICK_PX = 60;
  const POWER = { heavy: ['🪨', 'Heavy!', 0x9a8c7a], shock: ['⚡', 'Shockwave!', 0xffd23f], turbo: ['🔁', 'Turbo dash!', 0x3fe0ff], shield: ['🛡️', 'Shield!', 0x7dffb0] };
  const PW_ICONS = [[1, '🪨'], [2, '🔁'], [4, '🛡️']];
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; drag = null; stick = [0, 0]; keys = new Set(); hist = []; replay = null; live = null;
    lastSeq = -1; flash = null; falls = []; lastCount = 0;
    main.innerHTML = `<div class="sm"><div class="sm-stage" id="smStage">
        <div class="lr-banner" id="smBanner" hidden></div>
        <div class="lr-banner small sm-flash" id="smFlash" hidden></div>
        <div class="sm-stick" id="smStick" hidden><span></span></div></div>
      <div class="sm-bar"><span id="smInfo" class="hint"></span><button id="smDash" class="primary">💨 Dash</button></div></div>`;
    side.innerHTML = `<div class="panel"><div id="smSeats"></div>
      <p class="hint left">Drag anywhere to steer, tap to dash. Keyboard: WASD / arrows and Space.</p></div>`;
    main.querySelector('.sm').style.touchAction = 'none';
    $('smDash').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(); });
    const stage = $('smStage');
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
    const release = () => {
      if (!drag) return;
      if (!drag.moved && performance.now() - drag.at < 300) dash();
      drag = null; $('smStick').hidden = true;
      setStick(0, 0, true);
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (KEYS[e.code]) { e.preventDefault(); keys.add(e.code); keyStick(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) dash(); }
    };
    keyUp = (e) => { if (keys.delete(e.code)) keyStick(); };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
  }

  const me = () => S?.sumo?.me;
  const playing = () => me() != null && S.phase === 'playing';
  const colorOf = (i) => ctx.player(S.sumo.seats[i])?.color ?? '#888';

  function showStick(x, y, dx, dy) {
    const st = $('smStick'), box = $('smStage').getBoundingClientRect();
    st.hidden = false;
    st.style.left = `${x - box.left}px`; st.style.top = `${y - box.top}px`;
    st.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function keyStick() {
    let x = 0, y = 0;
    for (const k of keys) { x += KEYS[k][0]; y += KEYS[k][1]; }
    setStick(Math.sign(x), Math.sign(y), true);
  }

  // the stick is sent about 20 times a second while it moves; a release is always delivered
  function setStick(x, y, force = false) {
    stick = [x, y];
    if (!playing()) return;
    const now = performance.now();
    if (!force && now - sentAt < 50) return;
    sentAt = now;
    ctx.input({ sx: +x.toFixed(3), sy: +y.toFixed(3) }, force);
  }
  function dash() { if (playing()) ctx.input({ dash: true, sx: +stick[0].toFixed(3), sy: +stick[1].toFixed(3) }, true); }

  // ---------- sound: short synthesized hits (no files), in the style of Hover Rally's kit
  const snd = (() => {
    let a = null, warnAt = 0, bumpAt = 0;
    const on = () => (typeof prefs === 'undefined' || prefs.sound) && !document.hidden;
    function ac() { a ||= new (window.AudioContext || window.webkitAudioContext)(); if (a.state === 'suspended') a.resume(); return a; }
    function tone(f0, f1, dur, type, vol, at = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, f0, f1, q, vol, at = 0) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
      src.buffer = buf; fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.value = vol; src.connect(fl).connect(g).connect(a.destination); src.start(t);
    }
    const HITS = {
      bump: (k = 1) => { tone(150, 60, 0.18, 'sine', 0.12 + 0.2 * k); noise(0.08, 1100, 500, 1, 0.2 + 0.4 * k); },  // k: 0..1 by impulse
      dash: (k = 1) => noise(0.3, 500, 2600, 1.3, 0.25 * k),
      shatter: () => { for (let n = 0; n < 4; n++) noise(0.12, 5000 - n * 700, 2500, 6, 0.25, n * 0.03); tone(2200, 1400, 0.2, 'triangle', 0.04); },
      fall: () => { tone(700, 90, 0.9, 'triangle', 0.07); noise(0.5, 300, 80, 0.8, 0.4, 0.7); },
      fallMe: () => { [392, 330, 262, 196].forEach((f, k) => tone(f, f * 0.97, 0.22, 'sawtooth', 0.05, k * 0.16)); noise(0.5, 300, 80, 0.8, 0.4, 0.7); },
      pick: () => [523, 784, 1047].forEach((f, k) => tone(f, f, 0.09, 'square', 0.04, k * 0.05)),
      shield: () => [0, 1, 2, 3].forEach((k) => tone(600 + k * 220, 700 + k * 260, 0.18, 'sine', 0.05, k * 0.04)),
      shock: () => { noise(0.6, 1500, 120, 0.8, 0.9); tone(220, 40, 0.5, 'sawtooth', 0.08); },
      meteor: () => { noise(0.5, 900, 120, 0.7, 0.8); tone(90, 30, 0.5, 'sine', 0.3); },
      drop: () => tone(1800, 600, 0.5, 'sine', 0.035),   // a meteor on its way
      warn: () => [0, 1, 2].forEach((k) => tone(1500, 1500, 0.06, 'square', 0.035, k * 0.18)),
      rumble: () => { noise(0.9, 200, 60, 0.7, 0.8); tone(55, 40, 0.8, 'sine', 0.2); },
      doom: () => [262, 247, 233, 220].forEach((f, k) => tone(f, f, 0.3, 'sawtooth', 0.05, k * 0.2)),   // 💀 sudden death
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
      win: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, f, 0.18, 'triangle', 0.08, k * 0.1)),
      end: () => [523, 392].forEach((f, k) => tone(f, f, 0.18, 'triangle', 0.06, k * 0.12)),
    };
    function play(kind, arg) {
      if (!on()) return;
      const now = performance.now();
      if (kind === 'bump') { if (now < bumpAt) return; bumpAt = now + 60; }
      if (kind === 'warn') { if (now < warnAt) return; warnAt = now + 800; }
      try { ac(); HITS[kind](arg); } catch {}
    }
    return { play };
  })();

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    if (lastSeq < 0) lastSeq = s.sumo.seq ?? 0;  // don't replay what happened before we arrived
    take(s.sumo);
    countdownAt = performance.now() + s.sumo.countdown * 1000;
    renderSide();
  }

  function fast(d) {
    if (!S?.sumo || d.rd !== S.sumo.round) return;  // a new round arrives with a full view
    take(d);
    for (const e of d.ev || []) if (e[0] > lastSeq) { lastSeq = e[0]; onEvent(e); }
    const t = performance.now();
    if (t - sideAt > 150) { sideAt = t; renderSide(); }
  }

  function take(d) {
    const i = me(), was = snap?.s?.[i], now = d.s?.[i];
    if (i != null && was && now && !now[6]) {
      const kick = Math.hypot(now[2] - was[2], now[3] - was[3]);
      if (kick > 1.2 && !now[4]) { buzz(35); gl?.shake?.(Math.min(0.9, 0.25 + kick * 0.06)); }  // shoved (not my own dash)
    }
    const st = d.st ?? d.stage;
    const next = { R: d.R, bm: d.bm, s: d.s, st, o: d.o || [], mt: d.mt || [], sk: d.sk ?? -1, sd: d.sd || 0 }, t = performance.now();
    // the round just ended: replay its last 1.2 s at half speed (inside the 3 s pause before the next round)
    if (next.st === 'over' && (replay ? live : snap)?.st === 'play' && hist.length > 4 && motionOK()) {
      replay = { frames: hist.filter((x) => x.t >= t - 1200), start: t };
      live = next;
    }
    if ((replay ? live : snap)?.st === 'play' && next.st !== 'play') roundEnd(next);
    if (next.st === 'play') {
      hist.push({ t, snap: next }); while (hist[0].t < t - 1500) hist.shift();
      const count = next.s.filter((x) => !x[6]).length;
      if (count === 2 && lastCount > 2 && S.sumo.seats.length > 2) showFlash('⚔️ Last two!');
      lastCount = count;
    } else hist = [];
    if (replay) live = next; else { snap = next; gotAt = t; }
    Object.assign(S.sumo, { R: d.R, bm: d.bm, s: d.s, stage: next.st, ko: d.ko ?? S.sumo.ko });
  }

  function roundEnd(next) {
    const i = me();
    if (i == null) return;
    snd.play(next.s[i] && !next.s[i][6] ? 'win' : 'end');
  }

  function showFlash(text, ms = 1400) { flash = { text, until: performance.now() + ms }; }

  function onEvent(e) {
    const [, kind, ...a] = e, i = me(), now = performance.now();
    if (kind === 'h') {
      const [x, y, imp, p, q] = a, k = Math.min(1, imp / 18);
      snd.play('bump', p === i || q === i ? k : k * 0.4);
      (gl || flat)?.hit(x, y, imp, colorOf(p), colorOf(q));
    } else if (kind === 'd') {
      if (a[0] === i) snd.play('dash', 1);
    } else if (kind === 'b') {
      snd.play('shatter'); gl?.shatter(a[0]);
    } else if (kind === 'f') {
      snd.play(a[0] === i ? 'fallMe' : 'fall');
      if (a[0] === i) buzz([80, 50, 160]);
      gl?.fall(a[0]);
      falls = falls.filter((t) => now - t < 1200); falls.push(now);
      if (falls.length >= 2) showFlash(falls.length >= 3 ? '💥 Triple knockout!' : '💥 Double knockout!', 1800);
    } else if (kind === 'p') {
      const [who, what] = a;
      snd.play(what === 'shield' ? 'shield' : 'pick');
      if (who === i) { showFlash(`${POWER[what][0]} ${POWER[what][1]}`); buzz(25); }
      gl?.pick(who, what);
    } else if (kind === 's') {
      snd.play('shield'); gl?.pop(a[0]);
      if (a[0] === i) showFlash('🛡️ Saved!');
    } else if (kind === 'w') {
      snd.play('shock'); (gl || flat)?.ring(a[0], a[1], 4, POWER.shock[2]);
      gl?.shake(0.4);
    } else if (kind === 'm') {
      snd.play('meteor'); (gl || flat)?.ring(a[0], a[1], 3, 0xff6a3d); gl?.burst(a[0], 0.3, a[1], 24, ['#ffb347', '#ff5f3d'], 6);
      gl?.shake(0.25);
    } else if (kind === 'k') {
      snd.play('warn');
    } else if (kind === 'r') {
      snd.play('rumble'); gl?.crumble(); gl?.shake(0.2);
    } else if (kind === 'x') {
      snd.play('doom'); showFlash('💀 Sudden death!', 2200);
    }
  }

  // during a replay the drawing code reads `snap`, so it is pointed at the recorded frames
  function replayFrame(now) {
    const f = replay.frames, t = f[0].t + (now - replay.start) * 0.5;
    if (t > f.at(-1).t + 300 || S.phase !== 'playing' && t > f.at(-1).t) { snap = live; gotAt = now; replay = null; return; }
    snap = (f.findLast((x) => x.t <= t) || f[0]).snap;
    gotAt = now;
  }

  function renderSide() {
    const r = S.sumo, box = $('smSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}`));
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), s = snap.s[i], out = s?.[6];
      const row = ctx.el('div', 'seat-row lr-row' + (out ? ' out' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const pw = PW_ICONS.filter(([b]) => (s?.[7] ?? 0) & b).map(([, ic]) => ic).join('');
      const ko = r.ko?.[i] ? ctx.el('span', 'sm-ko', `💥${r.ko[i]}`) : '';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${out ? (r.ghosts && p ? ' 👻' : ' 🕳️') : ''} ${pw}`),
        ko, ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
    });
    const mine = r.me != null ? snap.s[r.me] : null;
    const cool = mine ? mine[5] - (performance.now() - gotAt) / 1000 : 0;
    const ghost = mine && mine[6] === 2 && r.ghosts;
    const b = $('smDash');
    b.disabled = !mine || mine[6] === 1 || (mine[6] === 2 && !ghost) || snap.st !== 'play';
    const icon = ghost ? '☄️' : '💨';
    b.textContent = cool > 0.05 ? `${icon} ${cool.toFixed(1)}s` : ghost ? '☄️ Meteor' : '💨 Dash';
    b.parentElement.hidden = r.me == null;
    const left = snap.bm.split('').filter((x) => x === '1').length;
    $('smInfo').textContent = snap.sd ? '💀 Sudden death' : snap.sk >= 0 && snap.sk <= 5 ? `🌑 Shrinks in ${Math.ceil(snap.sk)}…` : `${left} bumpers left`;
  }

  // where saucer i is now: last known position plus its velocity since then (capped)
  function pos(i, now) {
    const s = snap.s[i];
    const t = snap.st === 'play' ? Math.min(0.12, (now - gotAt) / 1000) : 0;
    return [s[0] + s[2] * t, s[1] + s[3] * t];
  }
  // the rim glows red when a shrink is near: 0 (calm) .. 1 (about to go)
  const warnLevel = () => (snap.sk >= 0 && snap.sk <= 3 ? 1 - snap.sk / 3 : 0);

  let lastCd = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !S?.sumo) return;
    if (replay) replayFrame(now);
    (gl || flat)?.draw(now);
    const r = S.sumo, cd = (countdownAt - now) / 1000, mine = r.me != null ? snap.s[r.me] : null;
    let text = '';
    if (replay) text = '⏪ Slow-mo';
    else if (S.phase === 'playing' && snap.st === 'countdown') text = cd > 0 ? String(Math.ceil(cd)) : 'GO!';
    else if (S.phase === 'playing' && snap.st === 'over') text = 'Round over';
    // countdown beeps, and GO
    const c = S.phase === 'playing' && snap.st === 'countdown' ? Math.ceil(cd) : 0;
    if (c !== lastCd) { if (c > 0 && c <= 3) snd.play('beep'); else if (c <= 0 && lastCd === 1) snd.play('go'); lastCd = c; }
    $('smBanner').hidden = !text; $('smBanner').textContent = text;
    let small = flash && now < flash.until ? flash.text : '';
    if (!small && !text && S.phase === 'playing' && snap.st === 'play' && mine?.[6]) {
      small = mine[6] === 2 && r.ghosts ? '👻 Drag to aim · tap to drop ☄️' : '🕳️ Off the edge — watching';
    }
    $('smFlash').hidden = !small; $('smFlash').textContent = small;
    $('smFlash').classList.toggle('dim', !(flash && now < flash.until));
    if (mine && mine[5] > 0 && Math.floor(now / 100) % 2 === 0) renderSide();  // tick the cooldown
  }

  // ---------- three.js arena
  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage);
  }

  // a small canvas texture: draw(g, size) paints it
  function canvasTex(T, size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); if (g) draw(g, size);
    return new T.CanvasTexture(c);
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x05040d);
    const camera = new T.PerspectiveCamera(42, 1, 0.5, 600);
    scene.add(new T.HemisphereLight(0xbfd9ff, 0x221133, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 0.8); sun.position.set(-8, 20, 10); scene.add(sun);
    // the sky: a nebula dome, slowly turning stars and a ringed planet far below the platform
    const sky = new T.Group(); scene.add(sky);
    {
      const dome = new T.SphereGeometry(300, 24, 16), cols = [], c = new T.Color(), deep = new T.Color(0x02010a), neb = new T.Color(0x2b1257), teal = new T.Color(0x0d3a4a);
      const pa = dome.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        const x = pa.getX(k) / 300, y = pa.getY(k) / 300, z = pa.getZ(k) / 300;
        // two soft clouds of colour, one violet and one teal, on black
        const v = Math.max(0, 1 - Math.hypot(x + 0.5, y + 0.3, z + 0.6) / 1.1), t = Math.max(0, 1 - Math.hypot(x - 0.6, y + 0.5, z - 0.2) / 0.9);
        c.copy(deep).lerp(neb, v * v).lerp(teal, t * t * 0.8);
        cols.push(c.r, c.g, c.b);
      }
      dome.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      sky.add(new T.Mesh(dome, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, depthWrite: false })));
      const pts = [];
      for (let k = 0; k < 800; k++) {
        const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), d = 200 + Math.random() * 80;
        pts.push(d * Math.sin(b) * Math.cos(a), d * Math.cos(b), d * Math.sin(b) * Math.sin(a));
      }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      sky.add(new T.Points(sg, new T.PointsMaterial({ size: 1.5, sizeAttenuation: false, color: 0xdfe6ff, transparent: true, opacity: 0.85, depthWrite: false })));
      const planet = new T.Mesh(new T.SphereGeometry(30, 32, 16), new T.MeshStandardMaterial({ color: 0x3d6fb8, emissive: 0x0b1a3a, roughness: 0.8 }));
      const pring = new T.Mesh(new T.RingGeometry(40, 54, 64), new T.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false }));
      pring.rotation.x = Math.PI / 2.3; planet.add(pring);
      planet.position.set(60, -140, -120); sky.add(planet);
    }
    const R0 = S?.sumo?.R0 ?? 10;
    const platform = new T.Group(); scene.add(platform);
    // the deck: glowing panel lines on a dark metal plate (a tiling canvas texture, no image files)
    const deckTex = canvasTex(T, 128, (g, n) => {
      g.fillStyle = '#3a3358'; g.fillRect(0, 0, n, n);
      g.fillStyle = '#433b66'; g.fillRect(4, 4, n / 2 - 8, n / 2 - 8); g.fillRect(n / 2 + 4, n / 2 + 4, n / 2 - 8, n / 2 - 8);
      g.strokeStyle = '#6b5f9a'; g.lineWidth = 3; g.strokeRect(0, 0, n, n); g.beginPath(); g.moveTo(n / 2, 0); g.lineTo(n / 2, n); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.stroke();
      g.fillStyle = '#8ecae6'; for (const [x, y] of [[0, 0], [n / 2, n / 2], [0, n / 2], [n / 2, 0]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    });
    deckTex.wrapS = deckTex.wrapT = T.RepeatWrapping;
    const sideMat = new T.MeshStandardMaterial({ color: 0x2a2442, metalness: 0.5, roughness: 0.5, emissive: 0x0a0618 });
    const topMat = new T.MeshStandardMaterial({ map: deckTex, metalness: 0.4, roughness: 0.55 });
    const discTex = deckTex.clone(); discTex.needsUpdate = true; discTex.repeat.set(R0 / 2, R0 / 2);
    const discTop = topMat.clone(); discTop.map = discTex;
    const disc = new T.Mesh(new T.CylinderGeometry(R0, R0 * 0.8, 1.2, 64), [sideMat, discTop, sideMat]);
    disc.position.y = -0.6; platform.add(disc);
    // underside glow, so the platform reads as hovering
    const under = new T.Mesh(new T.CircleGeometry(R0 * 0.75, 48), new T.MeshBasicMaterial({ color: 0x5a3cff, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false }));
    under.rotation.x = Math.PI / 2; under.position.y = -1.25; platform.add(under);
    const marks = [];
    for (const f of [0.33, 0.66]) {
      const ring = new T.Mesh(new T.RingGeometry(R0 * f - 0.05, R0 * f + 0.05, 64), new T.MeshBasicMaterial({ color: 0x8a7fc0, side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; platform.add(ring); marks.push(ring);
    }
    // the rim strip: cyan, pulsing red before a shrink
    const rimMat = new T.MeshBasicMaterial({ color: 0x2a9df4 });
    const rim = new T.Mesh(new T.TorusGeometry(R0, 0.07, 6, 96), rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; platform.add(rim);
    // 🍩 the ring arena: the platform is rebuilt with a hole when it shrinks (the pit itself never does)
    let pitKey = '', ringMesh = null;
    const pitGlow = new T.Mesh(new T.TorusGeometry(1, 0.06, 8, 64), new T.MeshBasicMaterial({ color: 0xff5fa2 }));
    pitGlow.rotation.x = Math.PI / 2; pitGlow.position.y = 0.03; pitGlow.visible = false; scene.add(pitGlow);
    const ringTop = topMat.clone(); ringTop.map = deckTex.clone(); ringTop.map.needsUpdate = true; ringTop.map.repeat.set(0.25, 0.25);
    function ensurePit() {
      const pit = S.sumo.pit || 0, key = pit ? `${pit}:${snap.R.toFixed(2)}` : '';
      if (key === pitKey) return;
      pitKey = key;
      if (ringMesh) { scene.remove(ringMesh); ringMesh.geometry.dispose(); ringMesh = null; }
      disc.visible = !pit; under.visible = !pit; marks.forEach((m) => (m.visible = !pit)); pitGlow.visible = !!pit;
      if (!pit) return;
      pitGlow.scale.set(pit, pit, 1);
      const shape = new T.Shape(); shape.absarc(0, 0, snap.R, 0, Math.PI * 2, false);
      const hole = new T.Path(); hole.absarc(0, 0, pit, 0, Math.PI * 2, true); shape.holes.push(hole);
      ringMesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 64 }), [ringTop, sideMat]);
      ringMesh.rotation.x = Math.PI / 2;
      scene.add(ringMesh);
    }
    const nb = S?.sumo?.nb ?? 16, bumpers = [];
    const bumperMat = new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x2a9df4, emissiveIntensity: 0.9 });
    for (let k = 0; k < nb; k++) {
      const a = ((k + 0.5) / nb) * 6.283;
      const m = new T.Mesh(new T.BoxGeometry(0.35, 0.5, (6.283 * R0) / nb * 0.82), bumperMat);
      m.position.set(Math.cos(a) * R0, 0.25, Math.sin(a) * R0);
      m.rotation.y = -a;
      platform.add(m); bumpers.push(m);
    }

    // ----- effects: one shared spark pool, flat shock rings, and tumbling debris
    const NP = 260, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    let pNext = 0;
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const sparks = new T.Points(pGeo, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; scene.add(sparks);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -999;
    const tmpC = new T.Color();
    function burst(x, y, z, n, colors, speed = 5) {
      if (calm()) n = Math.ceil(n / 3);
      for (let k = 0; k < n; k++) {
        const j = pNext; pNext = (pNext + 1) % NP;
        pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z;
        const a = Math.random() * 6.283, up = Math.random();
        pVel[j * 3] = Math.cos(a) * speed * (0.4 + Math.random()); pVel[j * 3 + 1] = up * speed * 0.8; pVel[j * 3 + 2] = Math.sin(a) * speed * (0.4 + Math.random());
        tmpC.set(colors[k % colors.length]); pCol[j * 3] = tmpC.r; pCol[j * 3 + 1] = tmpC.g; pCol[j * 3 + 2] = tmpC.b;
        pLife[j] = 0.4 + Math.random() * 0.5;
      }
    }
    function tickSparks(dt) {
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt;
        if (pLife[j] <= 0) { pPos[j * 3 + 1] = -999; continue; }
        pVel[j * 3 + 1] -= 9 * dt;
        pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
        const f = Math.min(1, pLife[j] * 2.5);
        pCol[j * 3] *= 0.97 + 0.03 * f; pCol[j * 3 + 1] *= 0.97 + 0.03 * f; pCol[j * 3 + 2] *= 0.97 + 0.03 * f;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }
    const ringGeoFx = new T.RingGeometry(0.85, 1, 48), rings = [];
    function ring(x, z, size, color, y = 0.06) {
      if (calm() && rings.length > 2) return;
      const m = new T.Mesh(ringGeoFx, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.setScalar(0.2);
      scene.add(m); rings.push({ m, t: 0, size });
    }
    function tickRings(dt) {
      for (let k = rings.length - 1; k >= 0; k--) {
        const r = rings[k]; r.t += dt * 2.2;
        r.m.scale.setScalar(0.2 + r.size * Math.sqrt(r.t)); r.m.material.opacity = Math.max(0, 0.9 * (1 - r.t));
        if (r.t >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(k, 1); }
      }
    }
    const chunkGeo = new T.BoxGeometry(1, 1, 1), bits = [];
    function debris(x, y, z, n, mat, size, out) {
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(chunkGeo, mat); m.scale.set(size * (0.5 + Math.random()), size * (0.4 + Math.random() * 0.6), size * (0.5 + Math.random()));
        m.position.set(x + (Math.random() - 0.5) * size, y, z + (Math.random() - 0.5) * size);
        const [ox, oz] = out;
        scene.add(m); bits.push({ m, v: [ox * (1 + Math.random() * 2) + (Math.random() - 0.5), 1 + Math.random() * 2, oz * (1 + Math.random() * 2) + (Math.random() - 0.5)], s: [Math.random() * 6, Math.random() * 6], t: 0 });
      }
    }
    function tickBits(dt) {
      for (let k = bits.length - 1; k >= 0; k--) {
        const b = bits[k]; b.t += dt;
        b.v[1] -= 12 * dt;
        b.m.position.x += b.v[0] * dt; b.m.position.y += b.v[1] * dt; b.m.position.z += b.v[2] * dt;
        b.m.rotation.x += b.s[0] * dt; b.m.rotation.z += b.s[1] * dt;
        if (b.t > 2.5) { scene.remove(b.m); bits.splice(k, 1); }
      }
    }

    // ----- saucers
    const saucers = [];
    const body = new T.SphereGeometry(1, 28, 14), dome = new T.SphereGeometry(0.5, 20, 10, 0, 6.283, 0, Math.PI / 2);
    const ringGeo = new T.TorusGeometry(1.15, 0.08, 8, 32), lightGeo = new T.SphereGeometry(0.09, 8, 6);
    const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
    const shadowGeo = new T.CircleGeometry(1, 24), bubbleGeo = new T.SphereGeometry(1.35, 24, 12);
    const COOL_SEGS = 40, coolGeo = new T.RingGeometry(1.55, 1.75, COOL_SEGS, 1, Math.PI / 2, -Math.PI * 2);
    function ensureSaucers() {
      while (saucers.length && saucers.length > S.sumo.seats.length) { const g = saucers.pop(), u = g.userData; scene.remove(g, u.shadow, u.ghost, u.aim); if (u.cool) scene.remove(u.cool); }
      while (saucers.length < S.sumo.seats.length) {
        const i = saucers.length, g = new T.Group(), r = S.sumo.saucer, col = new T.Color(colorOf(i));
        const hullMat = new T.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.35, emissive: 0x000000 });
        const hull = new T.Mesh(body, hullMat);
        hull.scale.set(r, r * 0.32, r);
        const top = new T.Mesh(dome, new T.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.75, roughness: 0.1 }));
        top.scale.setScalar(r * 1.1); top.position.y = r * 0.15;
        const glow = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffffff }));
        glow.rotation.x = Math.PI / 2; glow.scale.setScalar(r); glow.visible = false;
        // a ring of little underglow lights that spins with the hull
        const lights = new T.Group(), lightMat = new T.MeshBasicMaterial({ color: col.clone().lerp(new T.Color(0xffffff), 0.5) });
        for (let k = 0; k < 8; k++) { const l = new T.Mesh(lightGeo, lightMat); l.position.set(Math.cos(k * 0.785) * r * 0.82, -r * 0.12, Math.sin(k * 0.785) * r * 0.82); lights.add(l); }
        const bubble = new T.Mesh(bubbleGeo, new T.MeshStandardMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.22, emissive: 0x1d6b44, depthWrite: false }));
        bubble.scale.setScalar(r); bubble.visible = false;
        g.add(hull, top, glow, lights, bubble);
        const shadow = new T.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.scale.setScalar(r * 1.05); scene.add(shadow);
        // 👻 its ghost: a see-through copy that floats above the arena, and an aiming ring on the deck
        const ghost = new T.Group();
        const gh = new T.Mesh(body, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })); gh.scale.set(r, r * 0.32, r);
        const gd = new T.Mesh(dome, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false })); gd.scale.setScalar(r * 1.1); gd.position.y = r * 0.15;
        ghost.add(gh, gd); ghost.visible = false; scene.add(ghost);
        const aim = new T.Mesh(new T.RingGeometry(0.75, 0.95, 32), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: i === S.sumo.me ? 0.9 : 0.35, side: T.DoubleSide, depthWrite: false }));
        aim.rotation.x = -Math.PI / 2; aim.visible = false; scene.add(aim);
        g.userData = { glow, hull, hullMat, bubble, lights, shadow, ghost, aim, gpos: null, col: '#' + col.getHexString() };
        if (i === S.sumo.me) {
          const mark = new T.Mesh(new T.RingGeometry(r * 1.25, r * 1.45, 32), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
          mark.rotation.x = -Math.PI / 2; mark.position.y = -r * 0.3; g.add(mark);
          // the dash recharging: an arc on the deck that fills round your saucer (not in the group, so it doesn't spin)
          const cool = new T.Mesh(coolGeo, new T.MeshBasicMaterial({ color: 0x8ecae6, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
          cool.rotation.x = -Math.PI / 2; cool.scale.setScalar(r); scene.add(cool);
          g.userData.cool = cool;
        }
        scene.add(g); saucers.push(g);
      }
    }

    // ----- power-up orbs and meteors
    const orbGeo = new T.IcosahedronGeometry(0.45, 0), orbs = [], orbMats = {}, orbTex = {};
    for (const [k, [ic, , col]] of Object.entries(POWER)) {
      orbMats[k] = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.3, flatShading: true });
      orbTex[k] = new T.SpriteMaterial({ map: canvasTex(T, 64, (g, n) => { g.font = `${n * 0.7}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ic, n / 2, n / 2 + 2); }), transparent: true, depthWrite: false });
    }
    function drawOrbs(now) {
      const list = snap.o || [];
      while (orbs.length < list.length) {
        const g = new T.Group(), m = new T.Mesh(orbGeo, orbMats.heavy), sp = new T.Sprite(orbTex.heavy);
        sp.position.y = 0.95; sp.scale.setScalar(0.8); g.add(m, sp); g.userData = { m, sp }; scene.add(g); orbs.push(g);
      }
      orbs.forEach((g, k) => {
        const o = list[k]; g.visible = !!o; if (!o) return;
        g.userData.m.material = orbMats[o[2]]; g.userData.sp.material = orbTex[o[2]];
        g.position.set(o[0], 0.55 + 0.12 * Math.sin(now / 260 + k), o[1]);
        g.userData.m.rotation.y = now / 500; g.userData.m.rotation.x = now / 900;
      });
    }
    const meteors = [], rockGeo = new T.DodecahedronGeometry(0.55, 0), rockMat = new T.MeshBasicMaterial({ color: 0xffa040 });
    const warnGeo = new T.CircleGeometry(1, 40);
    function drawMeteors() {
      const list = snap.mt || [], delay = 1.0, t = Math.min(0.12, (performance.now() - gotAt) / 1000);
      while (meteors.length < list.length) {
        const shadow = new T.Mesh(warnGeo, new T.MeshBasicMaterial({ color: 0xff3d3d, transparent: true, opacity: 0.3, depthWrite: false })); shadow.rotation.x = -Math.PI / 2;
        const rock = new T.Mesh(rockGeo, rockMat);
        scene.add(shadow, rock); meteors.push({ shadow, rock, known: -1 });
      }
      meteors.forEach((mt, k) => {
        const m = list[k]; mt.shadow.visible = mt.rock.visible = !!m; if (!m) return;
        if (m[0] * 1000 + m[1] !== mt.known) { mt.known = m[0] * 1000 + m[1]; snd.play('drop'); }
        const left = Math.max(0, m[2] - t), f = 1 - left / delay;
        mt.shadow.position.set(m[0], 0.05, m[1]); mt.shadow.scale.setScalar(3 * (0.3 + 0.7 * f)); mt.shadow.material.opacity = 0.15 + 0.35 * f;
        mt.rock.position.set(m[0] + left * 4, 0.4 + left * 22, m[1] - left * 3); mt.rock.rotation.x += 0.2; mt.rock.rotation.y += 0.13;
        if (Math.random() < 0.6) burst(mt.rock.position.x, mt.rock.position.y + 0.3, mt.rock.position.z, 1, ['#ffb347', '#ff6a3d'], 0.8);
      });
    }

    let fitR = R0 * 1.25, aspect = 1;
    let lastDraw = 0;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h;
      camera.updateProjectionMatrix();
    }
    function place(dt) {
      // keep the whole platform in view whatever the screen shape, closing in as it shrinks
      fitR += (Math.max(6.5, (snap.R + 2.2)) - fitR) * Math.min(1, dt * 1.5);
      const fit = fitR / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, aspect);
      camera.position.set(0, fit * 0.85, fit * 0.6); camera.lookAt(0, -1, 0.6);
    }
    function draw(now) {
      ensureSaucers(); ensurePit();
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      place(dt); GL3.tickShake(camera, dt);
      sky.rotation.y += dt * 0.004;
      pitGlow.material.color.setHSL(0.92, 1, 0.55 + 0.15 * Math.sin(now / 250));
      const k = snap.R / R0;
      platform.scale.set(k, 1, k);
      // the rim: cyan, flashing red as a shrink comes, dark red in sudden death
      const w = warnLevel();
      if (w > 0) rimMat.color.setRGB(1, 0.25 + 0.25 * Math.sin(now / 60), 0.2);
      else if (snap.sd) rimMat.color.setRGB(0.6 + 0.2 * Math.sin(now / 300), 0.05, 0.1);
      else rimMat.color.setHex(0x2a9df4);
      rim.scale.set(1, 1, 1 + w * 2 * (0.5 + 0.5 * Math.sin(now / 60)));
      bumpers.forEach((m, j) => { m.visible = snap.bm[j] === '1'; });
      bumperMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(now / 400);
      const myIdx = S.sumo.me;
      snap.s.forEach((s, i) => {
        const g = saucers[i]; if (!g) return;
        const u = g.userData;
        const [x, y] = pos(i, now);
        const out = s[6] === 2, falling = s[6] === 1, pw = s[7] || 0;
        g.visible = !out;
        g.position.set(x, falling ? Math.max(-30, g.position.y - 0.35) : 0.35 + 0.08 * Math.sin(now / 300 + i), y);
        g.rotation.y += pw & 2 ? 0.06 : 0.02;
        g.rotation.z = falling ? g.rotation.z + 0.05 : Math.max(-0.35, Math.min(0.35, -s[2] * 0.04));
        g.rotation.x = falling ? g.rotation.x : Math.max(-0.35, Math.min(0.35, s[3] * 0.04));
        u.glow.visible = !!s[4] || !!(pw & 2);
        u.glow.material.color.setHex(s[4] ? 0xffffff : 0x3fe0ff);
        // 🪨 heavy: bigger and darker, glowing like hot iron; 🛡️ a bubble
        const big = pw & 1 ? 1.18 : 1;
        u.hull.scale.set(S.sumo.saucer * big, S.sumo.saucer * 0.32 * big, S.sumo.saucer * big);
        u.hullMat.emissive.setHex(pw & 1 ? 0x552200 : 0x000000);
        u.bubble.visible = !!(pw & 4);
        u.bubble.scale.setScalar(S.sumo.saucer * (1 + 0.04 * Math.sin(now / 150)));
        u.lights.rotation.y -= 0.08;
        // a blob shadow on the deck while it's over the platform
        const d = Math.hypot(x, y), over = !out && !falling && d < snap.R && d > (S.sumo.pit || 0);
        u.shadow.visible = over; u.shadow.position.set(x, 0.015, y);
        // dashing: a spray of sparks in its colour behind it
        if (s[4] && !calm()) burst(x, 0.3, y, 2, [u.col, '#ffffff'], 1.2);
        if (u.cool) {
          const cool = Math.max(0, s[5] - (now - gotAt) / 1000), full = (s[7] & 2 ? 0.6 : S.sumo.dashCool) || 2;
          const f = cool > 0.02 ? 1 - Math.min(1, cool / full) : 1;
          u.cool.visible = !out && !falling;
          u.cool.position.set(x, 0.05, y);
          u.cool.geometry.setDrawRange(0, Math.round(COOL_SEGS * f) * 6);
          u.cool.material.color.setHex(f >= 1 ? 0x8ecae6 : 0xffffff);
          u.cool.material.opacity = f >= 1 ? 0.25 : 0.85;
        }
        // 👻 the ghost and its aim, while the round is on
        const ghost = out && S.sumo.ghosts && snap.st === 'play' && !!ctx.player(S.sumo.seats[i]);
        u.ghost.visible = u.aim.visible = ghost;
        if (ghost) {
          const gx = s[8], gy = s[9];
          u.gpos ||= [gx, gy];
          u.gpos[0] += (gx - u.gpos[0]) * 0.3; u.gpos[1] += (gy - u.gpos[1]) * 0.3;
          u.ghost.position.set(u.gpos[0], 3 + 0.3 * Math.sin(now / 400 + i), u.gpos[1]);
          u.ghost.rotation.y += 0.03;
          u.aim.position.set(u.gpos[0], 0.04, u.gpos[1]);
          const ready = s[5] - (now - gotAt) / 1000 <= 0;
          u.aim.material.opacity = (i === myIdx ? 0.9 : 0.3) * (ready ? 1 : 0.4);
        } else u.gpos = null;
      });
      drawOrbs(now); drawMeteors();
      tickSparks(dt); tickRings(dt); tickBits(dt);
      renderer.render(scene, camera);
    }
    function hit(x, y, imp, c1, c2) {
      burst(x, 0.4, y, Math.min(40, 6 + Math.round(imp * 1.5)), [c1, c2, '#ffffff'], 3 + imp * 0.3);
      if (imp > 8) ring(x, y, 1.2 + imp * 0.06, 0xffffff);
    }
    function shatter(seg) {
      const a = ((seg + 0.5) / nb) * 6.283, R = snap.R;
      debris(Math.cos(a) * R, 0.3, Math.sin(a) * R, calm() ? 2 : 6, bumperMat, 0.3, [Math.cos(a) * 2, Math.sin(a) * 2]);
      burst(Math.cos(a) * R, 0.3, Math.sin(a) * R, 14, ['#8ecae6', '#ffffff'], 4);
    }
    function crumble() {
      // the rim breaks off in chunks as the platform shrinks
      const R = snap.R, n = calm() ? 5 : 14;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * 6.283, r = R - 0.2;
        if (S.sumo.pit && Math.random() < 0.3) continue;
        debris(Math.cos(a) * r, -0.3, Math.sin(a) * r, 1, sideMat, 0.7, [Math.cos(a), Math.sin(a)]);
      }
    }
    function fall(i) {
      const s = snap.s[i]; if (!s) return;
      const [x, y] = pos(i, performance.now());
      burst(x, 0.2, y, 30, [saucers[i]?.userData.col ?? '#fff', '#ffffff', '#ff5fa2'], 5);
      ring(x, y, 2.5, 0xff5fa2);
    }
    function pick(i, what) {
      const s = snap.s[i]; if (!s) return;
      const [x, y] = pos(i, performance.now());
      burst(x, 0.6, y, 18, ['#' + new T.Color(POWER[what][2]).getHexString(), '#ffffff'], 3);
    }
    function pop(i) {
      const s = snap.s[i]; if (!s) return;
      const [x, y] = pos(i, performance.now());
      ring(x, y, 2, 0x7dffb0, 0.4); burst(x, 0.5, y, 16, ['#7dffb0', '#ffffff'], 4);
    }
    function dispose() {
      for (const r of rings) r.m.material.dispose();
      renderer.dispose(); renderer.domElement.remove();
    }
    resize();
    return { draw, resize, dispose, shake: (a) => GL3.shake(camera, a), hit, ring, burst, shatter, crumble, fall, pick, pop };
  }

  // ---------- flat fallback (no WebGL)
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    const rings = [];
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
    }
    const hex = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
    function draw(now) {
      if (!canvas.width) resize();
      const W = canvas.width, R0 = S.sumo.R0, k = W / (2.3 * R0), c = W / 2;
      g.fillStyle = '#05040d'; g.fillRect(0, 0, W, W);
      g.fillStyle = '#3a3358'; g.beginPath(); g.arc(c, c, snap.R * k, 0, 7); g.fill();
      const w = warnLevel();
      g.lineWidth = 0.12 * k; g.strokeStyle = w > 0 && Math.floor(now / 120) % 2 ? '#ff4040' : snap.sd ? '#a01020' : '#2a9df4';
      g.beginPath(); g.arc(c, c, snap.R * k, 0, 7); g.stroke();
      if (S.sumo.pit) {
        g.fillStyle = '#05040d'; g.strokeStyle = '#ff5fa2'; g.lineWidth = 0.12 * k;
        g.beginPath(); g.arc(c, c, S.sumo.pit * k, 0, 7); g.fill(); g.stroke();
      }
      const nb = snap.bm.length;
      g.lineWidth = 0.4 * k; g.strokeStyle = '#8ecae6';
      for (let j = 0; j < nb; j++) {
        if (snap.bm[j] !== '1') continue;
        g.beginPath(); g.arc(c, c, snap.R * k, (j / nb) * 6.283 + 0.03, ((j + 1) / nb) * 6.283 - 0.03); g.stroke();
      }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${0.9 * k}px serif`;
      for (const o of snap.o || []) g.fillText(POWER[o[2]]?.[0] ?? '?', c + o[0] * k, c + o[1] * k);
      for (const m of snap.mt || []) {
        const f = 1 - Math.min(1, m[2]);
        g.fillStyle = `rgba(255,60,60,${0.15 + 0.35 * f})`; g.beginPath(); g.arc(c + m[0] * k, c + m[1] * k, 3 * k * (0.3 + 0.7 * f), 0, 7); g.fill();
      }
      snap.s.forEach((s, i) => {
        if (s[6] === 2) {
          if (S.sumo.ghosts && snap.st === 'play' && ctx.player(S.sumo.seats[i])) {
            g.globalAlpha = i === S.sumo.me ? 0.6 : 0.3; g.strokeStyle = colorOf(i); g.lineWidth = 0.15 * k;
            g.beginPath(); g.arc(c + s[8] * k, c + s[9] * k, 0.85 * k, 0, 7); g.stroke(); g.globalAlpha = 1;
          }
          return;
        }
        const [x, y] = pos(i, now), r = S.sumo.saucer * k * (s[6] === 1 ? 0.6 : 1) * (s[7] & 1 ? 1.18 : 1);
        g.fillStyle = colorOf(i); g.strokeStyle = i === S.sumo.me ? '#fff' : '#000a'; g.lineWidth = r * 0.2;
        g.beginPath(); g.arc(c + x * k, c + y * k, r, 0, 7); g.fill(); g.stroke();
        if (s[4]) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(c + x * k, c + y * k, r * 1.35, 0, 7); g.stroke(); }
        if (s[7] & 4) { g.strokeStyle = '#7dffb0'; g.lineWidth = r * 0.12; g.beginPath(); g.arc(c + x * k, c + y * k, r * 1.55, 0, 7); g.stroke(); }
      });
      for (let j = rings.length - 1; j >= 0; j--) {
        const r = rings[j], t = (now - r.at) / 450;
        if (t >= 1) { rings.splice(j, 1); continue; }
        g.globalAlpha = 1 - t; g.strokeStyle = r.color; g.lineWidth = 0.15 * k;
        g.beginPath(); g.arc(c + r.x * k, c + r.y * k, r.size * k * Math.sqrt(t) + 1, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    const ring = (x, y, size, color) => rings.push({ x, y, size, color: hex(color), at: performance.now() });
    const hit = (x, y, imp) => { if (imp > 6) ring(x, y, 1 + imp * 0.05, '#ffffff'); };
    resize();
    return { draw, resize, dispose() {}, hit, ring };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🪐 Round ${s.sumo.round} — first to ${s.sumo.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.sumo.stage === 'play' && s.sumo.me != null && !s.sumo.s[s.sumo.me][6];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
