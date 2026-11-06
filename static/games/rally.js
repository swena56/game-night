// Hover Rally: the track in 3D with a chase camera behind your craft (three.js), or top-down 2D.
// Craft are (s, d): distance along the track and sideways offset (left is +d); positions glide
// between server updates using each craft's speed. Hold the left/right half of the screen to steer.
// The server also sends moments (bumps, boost-pad hits, item pickups, launches, drops, shields and hits) that
// become sparks, sounds and camera shake, plus the 🚀 missiles in flight (they glide along the track like the
// craft) and the 💣 mines lying on it. 🚧 Track features come as zones ([kind, from s, to s]: ice, narrow,
// ramp, gap) with the half-width at every sample; a craft in a jump has its height in row [13].
UI.rally = (() => {
  let shownPlace = 0;  // my place at the last look, for the ▲/▼ flash
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let crafts = [], gotAt = 0, steerNow = 0, keys = new Set(), touch = null, countdownAt = 0, trackKey = '';
  // ⏱ lap splits and 👻 a ghost of your best lap so far this race (recorded in the browser)
  let laps = [], lapRun = null, ghost = null, lapFlash = 0, lapMsg = '';
  let prevMine = null, beeped = 0, missiles = [], mines = [], pk = [], warnAt = 0;
  const MISSILE_SPEED = 30;  // as on the server
  const ITEM = ['🎁', '🚀', '💣', '🛡️'];  // craft row [9]: nothing held, or the item
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    gl = null; flat = null; crafts = []; steerNow = 0; keys = new Set(); touch = null; trackKey = '';
    laps = []; lapRun = null; ghost = null; lapFlash = 0; prevMine = null; beeped = 0; missiles = []; mines = []; pk = [];
    main.innerHTML = `<div class="ra"><div class="ra-hud"><span id="raLap"></span><b id="raPlace"></b><span id="raSpeed"></span></div>
      <div class="ra-stage" id="raStage"><div class="lr-banner" id="raBanner" hidden></div>
        <div class="ra-half left">◀</div><div class="ra-half right">▶</div></div>
      <div class="sm-bar"><span class="hint">Hold a side to steer · swipe up to boost, down to use an item</span><button id="raFire" hidden>🎁</button><button id="raBoost" class="primary">⚡ Boost</button></div></div>`;
    side.innerHTML = '<div class="panel"><div id="raOrder"></div><div id="raSplits" class="ra-splits"></div><div id="raDaily" class="ra-splits"></div></div>';
    main.querySelector('.ra').style.touchAction = 'none';
    $('raBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boost(); });
    $('raFire').addEventListener('pointerdown', (e) => { e.preventDefault(); fire(); });
    const stage = $('raStage');
    stage.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      touch = { y: e.clientY, boosted: false, fired: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      steer(analog(e.clientX - r.left, r.width || 320));
    });
    stage.addEventListener('pointermove', (e) => {
      if (!touch) return;
      const r = stage.getBoundingClientRect();
      if (!touch.boosted && touch.y - e.clientY > 50) { touch.boosted = true; boost(); }
      if (!touch.fired && e.clientY - touch.y > 50) { touch.fired = true; fire(); }
      steer(analog(e.clientX - r.left, r.width || 320));
    });
    for (const t of ['pointerup', 'pointercancel']) stage.addEventListener(t, () => { touch = null; steer(0); });
    const KEY = { ArrowLeft: 1, KeyA: 1, ArrowRight: -1, KeyD: -1 };
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (KEY[e.code]) { e.preventDefault(); keys.add(e.code); steer(Math.sign([...keys].reduce((a, k) => a + KEY[k], 0))); }
      else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) boost(); }
      else if (e.code === 'KeyF' || e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); if (!e.repeat) fire(); }
    };
    keyUp = (e) => { if (keys.delete(e.code)) steer(Math.sign([...keys].reduce((a, k) => a + KEY[k], 0))); };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); trackKey = ''; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
    snd.stop();
  }

  // ---------- sound: an engine hum for your craft and short synthesized hits (no files)
  const snd = (() => {
    let a = null, eng = null, scrapeAt = 0;
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
      pad: () => { noise(0.45, 600, 4000, 1.5, 0.5); tone(440, 990, 0.3, 'triangle', 0.07); },
      boost: () => { noise(0.7, 300, 2600, 1.2, 0.6); tone(110, 220, 0.6, 'sawtooth', 0.04); },
      stall: () => [0, 1, 2].forEach((k) => tone(70, 50, 0.12, 'sawtooth', 0.07, k * 0.15)),  // a jumped start sputters
      bump: () => { tone(140, 60, 0.18, 'sine', 0.3); noise(0.08, 900, 500, 1, 0.5); },
      far: () => noise(0.06, 800, 500, 1, 0.12),  // rivals bumping each other
      scrape: () => noise(0.12, 3000, 2200, 4, 0.18),
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
      lap: () => [784, 1047].forEach((f, k) => tone(f, f, 0.14, 'triangle', 0.08, k * 0.08)),
      pick: () => [523, 784, 1047].forEach((f, k) => tone(f, f, 0.09, 'square', 0.04, k * 0.05)),
      fire: () => { noise(0.5, 2500, 500, 1.2, 0.6); tone(900, 200, 0.4, 'sawtooth', 0.05); },
      hit: () => { noise(0.6, 1200, 120, 0.8, 1.1); tone(90, 35, 0.5, 'sine', 0.35); },   // you got hit
      boom: () => { noise(0.35, 900, 200, 0.8, 0.35); tone(110, 50, 0.3, 'sine', 0.12); },  // someone else did
      warn: () => tone(1500, 1500, 0.06, 'square', 0.04),
      drop: () => { tone(220, 110, 0.12, 'square', 0.06); tone(1800, 1800, 0.05, 'sine', 0.05, 0.12); },  // a clunk, then the arming tick
      shield: () => [0, 1, 2, 3].forEach((k) => tone(600 + k * 220, 700 + k * 260, 0.18, 'sine', 0.05, k * 0.04)),
      out: () => tone(400, 200, 0.3, 'triangle', 0.06),   // 💥 someone else is knocked out
      outMe: () => [392, 330, 262, 196].forEach((f, k) => tone(f, f * 0.97, 0.22, 'sawtooth', 0.05, k * 0.16)),
      block: () => { tone(1400, 900, 0.3, 'triangle', 0.12); noise(0.15, 4000, 2000, 2, 0.3); },
      jump: () => { noise(0.4, 400, 1800, 1.4, 0.4); tone(300, 600, 0.3, 'triangle', 0.04); },   // off the ramp
      land: () => { tone(120, 50, 0.2, 'sine', 0.3); noise(0.1, 700, 300, 1, 0.4); },
      fall: () => { tone(700, 90, 0.9, 'triangle', 0.08); noise(0.5, 300, 80, 0.8, 0.5, 0.6); },   // down the gap, then a crunch
    };
    function play(kind, now) {
      if (!on()) return;
      if (kind === 'scrape') { if (now < scrapeAt) return; scrapeAt = now + 110; }
      try { ac(); HITS[kind](); } catch {}
    }
    // the hum: two detuned saws through a low-pass, pitched by speed; silent unless you're racing
    function engine(speed, top, boosting) {
      if (!on() || speed == null) { stop(); return; }
      try {
        if (!eng) {
          ac();
          const g = a.createGain(), fl = a.createBiquadFilter(); g.gain.value = 0; fl.type = 'lowpass'; fl.Q.value = 3;
          const os = [0, 7].map((cents) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.connect(fl); o.start(); return o; });
          fl.connect(g).connect(dest()); eng = { g, fl, os };
        }
        const k = Math.min(1.6, speed / top), t = a.currentTime;
        for (const o of eng.os) o.frequency.setTargetAtTime(48 + 70 * k + (boosting ? 25 : 0), t, 0.08);
        eng.fl.frequency.setTargetAtTime(300 + 900 * k + (boosting ? 800 : 0), t, 0.08);
        eng.g.gain.setTargetAtTime(0.012 + 0.02 * Math.min(1, k), t, 0.1);
      } catch {}
    }
    function stop() {
      if (!eng) return;
      const e = eng; eng = null;
      try { e.g.gain.setTargetAtTime(0, a.currentTime, 0.05); setTimeout(() => e.os.forEach((o) => o.stop()), 300); } catch {}
    }
    return { play, engine, stop };
  })();

  const me = () => S?.rally?.me;
  const racing = () => me() != null && S.phase === 'playing';
  // touch steering is analog: the further from the middle you hold, the harder you turn (in steps of a
  // quarter, so a wobbling thumb doesn't flood the server); a little dead zone in the middle
  function analog(x, w) {
    const v = Math.max(-1, Math.min(1, (w / 2 - x) / (w * 0.35)));
    return Math.abs(v) < 0.08 ? 0 : Math.sign(v) * Math.max(0.25, Math.round(Math.abs(v) * 4) / 4);
  }
  function steer(v) {
    if (v === steerNow) return;
    steerNow = v;
    document.querySelectorAll('.ra-half').forEach((h) => { h.style.color = `rgba(255,255,255,${0.19 + 0.5 * Math.max(0, h.classList.contains('left') ? v : -v)})`; });
    if (racing()) ctx.input({ steer: v }, true);
  }
  function boost() { if (racing()) ctx.input({ boost: true }, true); }
  function fire() { if (racing() && crafts[me()]?.[9]) ctx.input({ fire: true }, true); }
  const colorOf = (i) => ctx.player(S.rally.seats[i])?.color ?? '#fff';

  function render(s, c) {
    S = s; ctx = c;
    take(s.rally.c, s.rally.stage, s.rally.m, s.rally.pk, s.rally.mn);
    countdownAt = performance.now() + s.rally.countdown * 1000;
  }

  function fast(d) {
    if (!S?.rally) return;
    take(d.c, d.st, d.m, d.pk, d.mn);
    const me = S.rally.me;
    // 📳 buzz (the app's helper, off with the Vibrate setting) for what happens to your craft
    const BUZZ = { hit: [60, 40, 140], out: [200, 80, 200], block: 40, bump: 25, pad: 15, pick: 12, launch: 30, land: 30, fall: [120, 60, 120] };
    for (const e of d.e || []) {
      if (BUZZ[e[0]] && (e[1] === me || (e[0] === 'bump' && e[2] === me)) && typeof buzz === 'function') buzz(BUZZ[e[0]]);
      gl?.fx(e);
      if (e[0] === 'pad' && e[1] === me) snd.play('pad');
      else if (e[0] === 'bump') snd.play(e.slice(1).includes(me) ? 'bump' : 'far');
      else if (e[0] === 'pick' && e[1] === me) snd.play('pick');
      else if (e[0] === 'fire') snd.play('fire');
      else if (e[0] === 'hit') snd.play(e[1] === me ? 'hit' : 'boom');
      else if (e[0] === 'drop' && e[1] === me) snd.play('drop');
      else if (e[0] === 'shield' && e[1] === me) snd.play('shield');
      else if (e[0] === 'block') snd.play('block');
      else if (e[0] === 'out') snd.play(e[1] === me ? 'outMe' : 'out');
      else if ((e[0] === 'jump' || e[0] === 'land') && e[1] === me) snd.play(e[0]);
      else if (e[0] === 'fall' && e[1] === me) { snd.play('fall'); lapMsg = '🕳️ Fell short!'; lapFlash = performance.now() + 1500; }
      else if (e[0] === 'launch' && e[1] === me) {
        snd.play(e[2] ? 'boost' : 'stall');
        lapMsg = e[2] ? '🚀 Perfect start!' : '😬 Too early!'; lapFlash = performance.now() + 1500;
      }
    }
  }

  function take(list, stage, m, p, mn) {
    crafts = list.map((x) => x.slice());
    missiles = m || []; pk = p || []; mines = mn || [];
    S.rally.m = missiles; S.rally.pk = pk; S.rally.mn = mines;
    const mine = S.rally.me != null ? crafts[S.rally.me] : null;
    if (mine && prevMine && mine[4] < prevMine[4]) snd.play('boost');  // one of my own boosts fired
    prevMine = mine;
    gotAt = performance.now();
    S.rally.c = list; S.rally.stage = stage;
    side();
  }

  // track geometry: the point and left normal at distance s, and h, the 🏔️ hill height there
  function at(s, d) {
    const r = S.rally, L = r.length, cum = r.cum, pts = r.track, n = pts.length, { h: hl, bank } = hillsNow();
    s = ((s % L) + L) % L;
    let lo = 0, hi = n;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[(lo + 1) % n], seg = (cum[lo + 1] ?? L) - cum[lo] || 1, f = (s - cum[lo]) / seg;
    const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg, m = Math.hypot(tx, ty) || 1;
    const ux = tx / m, uy = ty / m;
    const tilt = bank[lo] + (bank[(lo + 1) % n] - bank[lo]) * f;  // banked bends: the outside edge is higher
    return { x: a[0] + (b[0] - a[0]) * f - uy * d, y: a[1] + (b[1] - a[1]) * f + ux * d, ux, uy,
      h: hl[lo] + (hl[(lo + 1) % n] - hl[lo]) * f - tilt * d, tilt };
  }

  // 🏔️ hills (3D only, the race itself is flat): a few slow waves round the lap, their phases taken from the
  // track's own shape so every phone sees the same ones; flat near the line and over ramps, gaps and narrows.
  // Bends are banked too: bank[k] is the rise per unit toward the right (left bends lift the right edge),
  // from the curvature smoothed over a few units, at most about 16°.
  let hills = null;
  function hillsNow() {
    const r = S.rally, n = r.track.length, L = r.length;
    if (hills?.key === r.length) return hills;
    const h = new Array(n).fill(0), bank = new Array(n).fill(0);
    if (gl) {
      const pts = r.track, dir = pts.map((p, k) => Math.atan2(pts[(k + 1) % n][1] - p[1], pts[(k + 1) % n][0] - p[0]));
      const curv = dir.map((a, k) => {
        const turn = ((a - dir[(k - 1 + n) % n] + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        return turn / Math.max(1e-6, (r.cum[(k + 1) % n] || L) - r.cum[k]);
      });
      const ph = [r.track[0][0], r.track[3][1], r.track[7][0]].map((v) => (v * 12.9898) % (Math.PI * 2));
      const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      const flat = (r.zones || []).filter((z) => z[0] !== 'ice');
      for (let k = 0; k < n; k++) {
        const s = r.cum[k], u = (s / L) * Math.PI * 2;
        let w = smooth((Math.min(s, L - s) - 4) / 11);
        for (const [, a, b] of flat) w = Math.min(w, smooth((Math.max(a - s, s - b, 0) - 2) / 8));
        h[k] = w * Math.max(0, 0.9 + 0.5 * Math.sin(2 * u + ph[0]) + 0.35 * Math.sin(3 * u + ph[1]) + 0.15 * Math.sin(5 * u + ph[2]));
        let c = 0;
        for (let j = -10; j <= 10; j++) c += curv[(k + j + n) % n];
        bank[k] = w * Math.max(-0.3, Math.min(0.3, (c / 21) * 3));
      }
    }
    hills = { key: r.length, h, bank };
    return hills;
  }
  const hillAt = (s) => at(s, 0).h;

  // 🚧 the feature zone at s (any lap), optionally only of the given kinds; the half-width at sample k
  function zoneAt(s, kinds) {
    const r = S.rally, L = r.length;
    return (r.zones || []).find((z) => (!kinds || kinds.includes(z[0])) && ((((s - z[1]) % L) + L) % L) < z[2] - z[1]) || null;
  }
  const hwAt = (k) => S.rally.hw?.[((k % S.rally.track.length) + S.rally.track.length) % S.rally.track.length] ?? S.rally.width;
  const RAMP_TOP = 0.55;  // how high a ramp's lip is (drawing only)
  function rampLift(s) {
    const z = zoneAt(s, ['ramp']), L = S.rally.length;
    return z ? RAMP_TOP * ((((s - z[1]) % L) + L) % L) / (z[2] - z[1]) : 0;
  }

  // flat drawings (2D view and minimap): the zones of each kind as Path2D polylines along the middle,
  // or (filled) as strips the track's width
  const ZONE_INK = { ice: '#bfeaff', ramp: '#ffd166', gap: '#070512', narrow: null };
  function zonePaths(X, Y, filled) {
    const r = S.rally, out = [];
    for (const [kind, a, b] of r.zones || []) {
      if (!ZONE_INK[kind]) continue;
      const path = new Path2D(), steps = Math.max(2, Math.ceil((b - a) / 0.5)), n = r.track.length;
      const w = (s) => hwAt(Math.round(n * (((s % r.length) + r.length) % r.length) / r.length)) + (kind === 'gap' ? 0.4 : 0);
      for (let k = 0; k <= steps; k++) {
        const s = a + (b - a) * k / steps, p = at(s, filled ? w(s) : 0);
        k ? path.lineTo(X(p.x), Y(p.y)) : path.moveTo(X(p.x), Y(p.y));
      }
      if (filled) { for (let k = steps; k >= 0; k--) { const s = a + (b - a) * k / steps, p = at(s, -w(s)); path.lineTo(X(p.x), Y(p.y)); } path.closePath(); }
      out.push([kind, path]);
    }
    return out;
  }

  function sNow(i, now) {
    const c = crafts[i]; if (!c) return 0;
    const dt = S.rally.stage === 'race' ? Math.min(0.15, (now - gotAt) / 1000) : 0;
    return c[0] + c[2] * dt;
  }

  const mNow = (m, now) => m[0] + (S.rally.stage === 'race' ? MISSILE_SPEED * Math.min(0.15, (now - gotAt) / 1000) : 0);
  const incoming = () => S.rally.me != null && missiles.some((m) => m[2] === S.rally.me);

  function order() {
    return crafts.map((c, i) => i).sort((a, b) => (crafts[a][6] || 99) - (crafts[b][6] || 99) || crafts[b][0] - crafts[a][0]);
  }

  function side() {
    const r = S.rally, box = $('raOrder'); if (!box) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', r.elim ? '💥 Elimination: last place is out every lap' : `${r.laps} laps`));
    order().forEach((i, k) => {
      const c = crafts[i], p = ctx.player(r.seats[i]);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      row.append(ctx.el('b', '', `${k + 1}.`), dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}`),
        ctx.el('span', 'hint', c[12] ? '💥 out' : c[6] ? '🏁' : `lap ${r.elim ? c[5] + 1 : Math.min(c[5] + 1, r.laps)}`));
      box.append(row);
    });
    const mine = r.me != null ? crafts[r.me] : null;
    $('raBoost').textContent = mine ? `⚡ ${mine[4]}` : '⚡';
    // during the countdown the button is live for a 🚀 start boost (press it just before GO)
    $('raBoost').disabled = !mine || (r.stage === 'race' ? !mine[4] || !!mine[6] : r.stage !== 'countdown');
    $('raBoost').parentElement.hidden = r.me == null;
    $('raFire').hidden = !r.pickups?.length;
    $('raFire').disabled = !mine?.[9] || r.stage !== 'race' || !!mine?.[6];
    $('raFire').classList.toggle('primary', !!mine?.[9]);
    $('raFire').textContent = ITEM[mine?.[9] || 0];
    if (mine) {
      $('raLap').textContent = mine[12] ? '💥 Out' : mine[6] ? 'Finished!' : r.elim ? `Lap ${mine[5] + 1} · ${crafts.filter((c) => !c[6]).length} left` : `Lap ${Math.min(mine[5] + 1, r.laps)} / ${r.laps}`;
      const place = order().indexOf(r.me) + 1;
      $('raPlace').textContent = `${place}${['st', 'nd', 'rd'][place - 1] || 'th'}`;
      // gaining or losing a place flashes ▲ or ▼ on it
      if (shownPlace && place !== shownPlace && r.stage === 'race' && !mine[6] && S.phase === 'playing') {
        const el = $('raPlace'); el.dataset.move = place < shownPlace ? '▲' : '▼';
        el.classList.remove('up', 'down'); void el.offsetWidth; el.classList.add(place < shownPlace ? 'up' : 'down');
      }
      shownPlace = place;
    } else { $('raLap').textContent = 'Watching'; $('raPlace').textContent = ''; }
    splits();
    daily();
  }

  const secs = (ms) => (ms / 1000).toFixed(1) + 's';
  function splits() {
    const box = $('raSplits'); if (!box) return;
    box.innerHTML = '';
    if (!laps.length) { box.append(ctx.el('div', 'hint left', S.rally.me != null ? '⏱ Lap times show here. Beat your 👻 ghost!' : '')); return; }
    const best = Math.min(...laps);
    laps.forEach((ms, k) => {
      const row = ctx.el('div', 'ra-split' + (ms === best ? ' best' : ''));
      const d = k ? ms - laps[k - 1] : 0;
      row.append(ctx.el('span', '', `Lap ${k + 1}`), ctx.el('b', '', secs(ms)),
        ctx.el('small', d < 0 ? 'faster' : d > 0 ? 'slower' : '', k ? `${d < 0 ? '−' : '+'}${secs(Math.abs(d))}` : ''));
      box.append(row);
    });
  }

  // 📅 today's track: the day's best laps (from every room), yours in bold
  function daily() {
    const box = $('raDaily'), d = S.rally.daily; if (!box) return;
    box.innerHTML = '';
    if (!d) return;
    box.append(ctx.el('div', 'hint left', `📅 Today's best laps (${d.date})`));
    if (!d.board.length) box.append(ctx.el('div', 'hint left', 'No laps yet. Set the first!'));
    const myName = ctx.player(S.me?.id)?.name ?? S.me?.name;
    d.board.forEach((x, k) => {
      const row = ctx.el('div', 'ra-split' + (x.name === myName ? ' mine' : ''));
      row.append(ctx.el('span', '', `${k + 1}. ${x.name}`), ctx.el('b', '', (x.ms / 1000).toFixed(2) + 's'));
      box.append(row);
    });
  }

  // 👻 on today's track your best lap of the day is kept on this device and races beside you next time
  const ghostKey = () => `rally-ghost:${S.rally.daily?.date}`;
  function storedGhost() {
    if (!S.rally.daily) return null;
    try { const g = JSON.parse(localStorage.getItem(ghostKey())); return g?.ms > 0 && Array.isArray(g.pts) ? g : null; } catch { return null; }
  }
  function storeGhost(g) {
    if (!S.rally.daily) return;
    try {
      const old = storedGhost();
      if (old && old.ms <= g.ms) return;
      const r2 = (v) => Math.round(v * 100) / 100;
      localStorage.setItem(ghostKey(), JSON.stringify({ ms: Math.round(g.ms), pts: g.pts.map((q) => q.map(r2)) }));
    } catch {}
  }

  // record my lap: (time into the lap, s, d) every ~50 ms; a finished lap that beats the best becomes the ghost
  function trackLap(now) {
    const r = S.rally, c = r.me != null ? crafts[r.me] : null;
    if (!c) return;
    // (a lap that ends the race is counted even when the race is already over in the same update)
    if (!lapRun && (r.stage !== 'race' || S.phase !== 'playing')) return;
    if (!lapRun) lapRun = { lap: c[5], t0: now, pts: [] };
    if (c[5] !== lapRun.lap) {
      const ms = now - lapRun.t0, best = laps.length ? Math.min(...laps) : Infinity;
      laps.push(ms);
      if (ms < Math.min(best, ghost?.ms ?? Infinity)) { ghost = { ms, pts: lapRun.pts }; storeGhost(ghost); }
      lapMsg = `Lap ${laps.length}: ${secs(ms)}${ms < best && laps.length > 1 ? ' — best! ⭐' : ''}`;
      lapFlash = now + 1800;
      if (ms < best && laps.length > 1) ctx.sfx?.('good'); else if (!c[6]) snd.play('lap');
      lapRun = { lap: c[5], t0: now, pts: [] };
      splits();
      // starting the last lap of a race
      if (!r.elim && !c[6] && c[5] === r.laps - 1) { Kit.callout('🏁 Final lap!', 'gold', { ms: 1400 }); ctx.sfx?.('rise', 6); }
    }
    if (c[6] || r.stage !== 'race' || S.phase !== 'playing') return;
    const last = lapRun.pts.at(-1);
    if (!last || now - lapRun.t0 - last[0] > 50) lapRun.pts.push([now - lapRun.t0, sNow(r.me, now), c[1]]);
  }
  // where the ghost is now: the best lap's sample at the same time into this lap
  function ghostAt(now) {
    if (!ghost || !lapRun || crafts[S.rally.me]?.[6]) return null;
    const t = now - lapRun.t0, p = ghost.pts;
    if (!p.length || t > p.at(-1)[0]) return null;
    let lo = 0, hi = p.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (p[m][0] <= t) lo = m; else hi = m; }
    const a = p[lo], b = p[hi], f = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
    return at(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.rally) return;
    const r = S.rally, key = `${r.length}`, race = `${key} ${r.race}`;
    if (key !== trackKey && (gl || flat)) { trackKey = key; (gl || flat).build(); }
    if (race !== trackLap.key) { trackLap.key = race; laps = []; lapRun = null; ghost = storedGhost(); splits(); }
    trackLap(now);
    (gl || flat)?.draw(now);
    const mine = r.me != null ? crafts[r.me] : null;
    $('raSpeed').textContent = mine ? `${Math.round(mine[2] * 10)} km/h${mine[11] ? ' 🛡️' : ''}${mine[3] ? ' ⚡' : mine[8] ? ' 💨' : ''}` : '';
    const cd = (countdownAt - now) / 1000;
    // 3, 2, 1 beeps and a higher one for GO
    if (mine && S.phase === 'playing' && r.stage === 'countdown') {
      const n = Math.ceil(cd);
      if (n > 0 && n <= 3 && n !== beeped) { beeped = n; snd.play('beep'); }
    } else if (beeped && r.stage === 'race') { beeped = 0; snd.play('go'); }
    if (mine && !mine[6] && S.phase === 'playing' && r.stage === 'race') {
      snd.engine(mine[2], r.top, !!mine[3]);
      if (mine[7]) snd.play('scrape', now);
    } else snd.engine(null);
    const warn = mine && !mine[6] && incoming();
    if (warn && now > warnAt) { warnAt = now + 220; snd.play('warn'); }
    const text = S.phase === 'playing' && r.stage === 'countdown' ? (cd > 0 ? String(Math.ceil(cd)) : 'GO!') : mine?.[6] && S.phase === 'playing' ? (mine[12] ? '💥 Out!' : '🏁 Finished!')
      : mine?.[10] ? '💫 Hit!' : warn ? '⚠️ Missile behind!' : now < lapFlash ? lapMsg : '';
    $('raBanner').hidden = !text; $('raBanner').textContent = text;
    $('raBanner').classList.toggle('small', !!text && (text === lapMsg || text.startsWith('⚠️')));
  }

  // ---------- three.js: course (x, y) → world (x, 0, -y)
  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage); trackKey = '';
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x070512); scene.fog = new T.Fog(0x070512, 40, 140);
    const camera = new T.PerspectiveCamera(65, 1, 0.1, 400);
    scene.add(new T.HemisphereLight(0xbfd9ff, 0x221133, 0.8));
    const sun = new T.DirectionalLight(0xffffff, 0.7); sun.position.set(20, 40, 10); scene.add(sun);  // gives the hulls some shape
    const grid = new T.GridHelper(260, 52, 0x3a2a6a, 0x1c1438); grid.position.y = -0.05; scene.add(grid);
    // the sky: a dome glowing violet at the horizon and black overhead, stars, and a ringed planet; it rides
    // along with the camera so it's always far away, and the fog leaves it alone
    const sky = new T.Group(); scene.add(sky);
    {
      const dome = new T.SphereGeometry(300, 24, 16), cols = [], c = new T.Color(), lo = new T.Color(0x070512), mid = new T.Color(0x2a1450), top = new T.Color(0x020108);
      const pa = dome.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        const y = pa.getY(k) / 300;  // -1 .. 1
        if (y < 0) c.copy(lo); else if (y < 0.15) c.copy(lo).lerp(mid, y / 0.15); else c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.5));
        cols.push(c.r, c.g, c.b);
      }
      dome.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      sky.add(new T.Mesh(dome, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })));
      const stars = [];
      for (let k = 0; k < 700; k++) {
        const a = Math.random() * Math.PI * 2, y = 0.08 + Math.random() * 0.92, rr = Math.sqrt(1 - y * y);
        stars.push(Math.cos(a) * rr * 280, y * 280, Math.sin(a) * rr * 280);
      }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(stars, 3));
      sky.add(new T.Points(sg, new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xdfe6ff, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
      const planet = new T.Mesh(new T.SphereGeometry(26, 24, 16), new T.MeshBasicMaterial({ color: 0x8a5cc8, fog: false }));
      const ring = new T.Mesh(new T.RingGeometry(34, 46, 48), new T.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.45, side: T.DoubleSide, fog: false, depthWrite: false }));
      ring.rotation.x = Math.PI / 2.4; planet.add(ring);
      planet.position.set(-170, 80, -190); sky.add(planet);
      sky.renderOrder = -1;
    }
    let track = new T.Group(); scene.add(track);
    const ships = [];
    const V = (p, h = 0) => new T.Vector3(p.x, h + (p.h || 0), -p.y);  // on the hills when p comes from at()
    const calm = () => document.body.classList.contains('calm');
    // a soft round dot: engine glows, the glow under each craft, particles
    const dot = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, '#fff'); grd.addColorStop(0.35, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    // boost pads: glowing chevrons pointing the way you're going
    const chevron = (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(255,209,102,.35)'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#fff3c4'; g.lineWidth = 14; g.lineJoin = 'round'; g.lineCap = 'round';
      for (const x of [28, 72]) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x + 30, 64); g.lineTo(x, 106); g.stroke(); }
      return new T.CanvasTexture(c);
    })();
    const padMat = new T.MeshBasicMaterial({ map: chevron, color: 0xffd166, transparent: true, opacity: 0.9, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false });
    const pickups = [], pickGeo = new T.OctahedronGeometry(0.42);
    // pickups shift colour: it could be any item
    const pickMat = new T.MeshStandardMaterial({ color: 0xff5d5d, emissive: 0xff2d2d, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.2 });
    const glowMat = (color, opacity = 1) => ({ map: dot, color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
    function build() {
      scene.remove(track); track = new T.Group(); scene.add(track);
      hills = null;  // worked out afresh now that there's a 3D view
      const r = S.rally, n = r.track.length, W = r.width, L = r.length;
      // the surface, with a hole where a gap is; the edge lines break there too
      const pos = [], edges = [[], []], edgeMat = new T.LineBasicMaterial({ color: 0x4cc9f0 });
      const gapAt = (k) => !!zoneAt(((r.cum[k % n] ?? 0) + (r.cum[(k + 1) % n] || L)) / 2, ['gap']);
      const endEdges = () => {
        for (const e of edges) { if (e.length > 1) track.add(new T.Line(new T.BufferGeometry().setFromPoints(e), edgeMat)); e.length = 0; }
      };
      for (let k = 0; k <= n; k++) {
        const s = r.cum[k % n] ?? 0, w = hwAt(k);
        const a = at(s, w), b = at(s, -w);
        pos.push(a.x, a.h, -a.y, b.x, b.h, -b.y);
        edges[0].push(V(a, 0.05)); edges[1].push(V(b, 0.05));
        if (k < n && gapAt(k)) endEdges();
      }
      endEdges();
      const idx = [];
      for (let k = 0; k < n; k++) { if (gapAt(k)) continue; const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      track.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x24203a, roughness: 0.8, side: T.DoubleSide })));
      // embankments: each edge down to the ground, so the hills read as solid ground (none at a gap: the pit has walls)
      const bank = [], bankIdx = [];
      for (let k = 0; k <= n; k++) {
        const q = k * 2;
        bank.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2], pos[q * 3], -0.05, pos[q * 3 + 2]);
        bank.push(pos[q * 3 + 3], pos[q * 3 + 4], pos[q * 3 + 5], pos[q * 3 + 3], -0.05, pos[q * 3 + 5]);
        if (k < n && !gapAt(k)) { const o = k * 4; bankIdx.push(o, o + 1, o + 4, o + 1, o + 5, o + 4, o + 2, o + 3, o + 6, o + 3, o + 7, o + 6); }
      }
      const bg = new T.BufferGeometry();
      bg.setAttribute('position', new T.Float32BufferAttribute(bank, 3)); bg.setIndex(bankIdx); bg.computeVertexNormals();
      track.add(new T.Mesh(bg, new T.MeshStandardMaterial({ color: 0x15112a, roughness: 0.9, side: T.DoubleSide })));
      features();
      scenery();
      const line = new T.Mesh(new T.PlaneGeometry(0.6, W * 2), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
      const p0 = at(0, 0); line.position.copy(V(p0, 0.02)); line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(p0.uy, p0.ux); track.add(line);
      for (const [pi, lat] of r.pads) {  // laid on the surface, so they follow the hills and banking
        const s = r.cum[((pi % n) + n) % n];
        strip(s - 1, s + 1, () => 0.8, () => 0.03, padMat, lat, true);
      }
      pickups.length = 0;
      for (const [pi, lat] of r.pickups || []) {  // 🚀 pickups: spinning crystals hovering over the track
        const s = r.cum[((pi % n) + n) % n], p = at(s, lat), g = new T.Group();
        g.add(new T.Mesh(pickGeo, pickMat), new T.Sprite(new T.SpriteMaterial(glowMat(0xff5d5d, 0.7))));
        g.children[1].scale.set(1.6, 1.6, 1);
        g.position.copy(V(p, 0.7)); g.userData.y = g.position.y; track.add(g); pickups.push(g);
      }
      cam.ready = false;
      for (const g of ships) g.userData.trail.pts.length = 0;
      resize();
    }

    // ---- 🚧 track features: a ribbon between s = a and b, with half-width w(s) and height y(s) over the
    // surface, centred `off` to the left; its texture runs across it, or (along) in the direction of travel
    function strip(a, b, w, y, mat, off = 0, along = false) {
      const pos = [], uv = [], idx = [], steps = Math.max(2, Math.ceil((b - a) / 0.4));
      for (let k = 0; k <= steps; k++) {
        const s = a + (b - a) * k / steps, h = y(s), p = at(s, off + w(s)), q = at(s, off - w(s));
        pos.push(p.x, h + p.h, -p.y, q.x, h + q.h, -q.y);
        if (along) uv.push((s - a) / (b - a), 1, (s - a) / (b - a), 0); else uv.push(0, (s - a) / 2, 1, (s - a) / 2);
        if (k < steps) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new T.Mesh(g, mat); track.add(m); return m;
    }
    const stripes = (() => {  // hazard stripes for ramps
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); g.fillStyle = '#ffd166'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#1a1626';
      for (let x = -64; x < 64; x += 32) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 16, 64); g.lineTo(x + 80, 0); g.lineTo(x + 64, 0); g.fill(); }
      const tx = new T.CanvasTexture(c); tx.wrapS = tx.wrapT = T.RepeatWrapping; return tx;
    })();
    const iceMat = new T.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3a7ca5, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.08,
      transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false });
    const glints = [];
    function features() {
      const r = S.rally, W = r.width, n = r.track.length;
      const wAt = (s) => hwAt(Math.round(n * (((s % r.length) + r.length) % r.length) / r.length));
      glints.length = 0;
      for (const [kind, a, b] of r.zones || []) {
        if (kind === 'ice') {  // a glossy sheet of ice, with glints that twinkle
          strip(a, b, wAt, () => 0.02, iceMat);
          for (let k = 0; k < 6; k++) {
            const sp = new T.Sprite(new T.SpriteMaterial(glowMat(0xffffff, 0))), p = at(a + (b - a) * (k + 0.5) / 6, (k % 3 - 1) * W * 0.55);
            sp.position.copy(V(p, 0.08)); sp.scale.set(0.7, 0.7, 1); track.add(sp); glints.push(sp);
          }
        } else if (kind === 'ramp') {  // a striped wedge up to the lip, with a face dropping off at the take-off
          strip(a, b, () => W, (s) => 0.01 + RAMP_TOP * (s - a) / (b - a), new T.MeshStandardMaterial({ map: stripes, roughness: 0.6, side: T.DoubleSide }));
          const p = at(b, 0), face = new T.Mesh(new T.PlaneGeometry(W * 2, RAMP_TOP), new T.MeshStandardMaterial({ color: 0x2a2440, side: T.DoubleSide }));
          face.position.copy(V(p, RAMP_TOP / 2)); face.rotation.y = Math.atan2(p.uy, p.ux) + Math.PI / 2; track.add(face);
        } else if (kind === 'gap') {  // a pit with a red glow far below
          const p = at((a + b) / 2, 0), len = b - a, depth = 6;
          const pit = new T.Mesh(new T.BoxGeometry(len, depth, W * 2), new T.MeshStandardMaterial({ color: 0x120c22, emissive: 0x3a0610, emissiveIntensity: 0.6, side: T.BackSide }));
          pit.position.copy(V(p, -depth / 2 - 0.01)); pit.rotation.y = Math.atan2(p.uy, p.ux); track.add(pit);
          const glow = new T.Sprite(new T.SpriteMaterial(glowMat(0xff3b3b, 0.5))); glow.position.copy(V(p, -depth + 0.3)); glow.scale.set(len, len, 1); track.add(glow);
        } else if (kind === 'narrow') {  // orange and white bollards where it pinches in and opens out
          for (const s of [a, a + 5, b - 5, b]) for (const side of [1, -1]) {
            const p = at(s, side * (wAt(s) + 0.25)), post = new T.Group();
            const lo = new T.Mesh(bollardGeo, bollardMat[0]), hi = new T.Mesh(bollardGeo, bollardMat[1]);
            lo.position.y = 0.2; hi.position.y = 0.6; post.add(lo, hi); post.position.copy(V(p, 0)); track.add(post);
          }
        }
      }
    }
    // ---- scenery: glowing pylons along both sides (every fourth one coloured by how far round the lap it is),
    // arches over the track with a checkered one at the line, a ring of mountains fading into the fog,
    // crystals on the ground and a grandstand. Instanced meshes take their colour per instance, which only
    // tints the lit colour (not an emissive glow), so the pylons are unlit and pulse through their colour.
    const pylonMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const archMat = new T.MeshStandardMaterial({ color: 0x3a2a6a, emissive: 0x4cc9f0, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.4 });
    const checker = (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 32;
      const g = c.getContext('2d');
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); }
      return new T.CanvasTexture(c);
    })();
    function scenery() {
      const r = S.rally, L = r.length, n = r.track.length, every = 12, count = Math.floor(L / every);
      const wAt = (s) => hwAt(Math.round(n * (((s % L) + L) % L) / L));
      // pylons: one instanced mesh for all of them
      const pylons = new T.InstancedMesh(new T.CylinderGeometry(0.1, 0.14, 1.6, 8), pylonMat, count * 2);
      const m = new T.Matrix4(), col = new T.Color();
      for (let k = 0; k < count; k++) for (const side of [1, -1]) {
        const s = (k + 0.5) * every, p = at(s, side * (wAt(s) + 0.9)), j = k * 2 + (side > 0 ? 0 : 1);
        m.makeTranslation(p.x, at(s, side * wAt(s)).h + 0.8, -p.y); pylons.setMatrixAt(j, m);  // level with the edge
        pylons.setColorAt(j, k % 4 ? col.set(0x4cc9f0) : col.setHSL(s / L, 0.9, 0.6));
      }
      track.add(pylons);
      // arches: at the line (checkered) and five more spread round, nudged off ramps and gaps
      for (let k = 0; k < 6; k++) {
        let s = (k * L) / 6;
        while (k && zoneAt(s, ['ramp', 'gap', 'narrow'])) s += 2;
        const p = at(s, 0), w = wAt(s) + 0.7, a = new T.Group();
        // each post stands on its own edge of a banked bend (local +z is the right-hand side)
        const lift = (z) => (p.tilt || 0) * z, top = 3.4 + Math.abs(lift(w));
        for (const z of [w, -w]) {
          const post = new T.Mesh(new T.BoxGeometry(0.3, top - lift(z), 0.3), archMat); post.position.set(0, (top + lift(z)) / 2, z); a.add(post);
        }
        const bar = new T.Mesh(new T.BoxGeometry(0.3, 0.5, w * 2 + 0.3), k ? archMat : new T.MeshBasicMaterial({ map: checker }));
        bar.position.y = top; a.add(bar);
        a.position.copy(V(p, 0)); a.rotation.y = Math.atan2(p.uy, p.ux); track.add(a);
      }
      // mountains: low-poly cones far out, placed from the track's own numbers so they stay put
      const xs = r.track.map((q) => q[0]), ys = r.track.map((q) => q[1]);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const mtn = new T.MeshStandardMaterial({ color: 0x2a1d4a, emissive: 0x120a26, roughness: 1, flatShading: true });
      for (let k = 0; k < 16; k++) {
        const rnd = (j) => { const v = Math.sin((k + 1) * 78.233 + j * 12.9898 + L) * 43758.5453; return v - Math.floor(v); };
        const a = (k / 16) * Math.PI * 2 + rnd(1) * 0.3, rad = 110 + 20 * rnd(2), hgt = 15 + 20 * rnd(3);
        const c = new T.Mesh(new T.ConeGeometry(10 + 8 * rnd(4), hgt, 5 + Math.floor(rnd(5) * 3)), mtn);
        c.position.set(cx + Math.cos(a) * rad, hgt / 2 - 0.1, -(cy + Math.sin(a) * rad)); c.rotation.y = rnd(6) * 3; track.add(c);
      }
      // crystals: clusters of glowing shards on the ground, kept well clear of the track
      const near = r.track.filter((_, j) => j % 6 === 0), clear = (x, y) => near.every((q) => Math.hypot(q[0] - x, q[1] - y) > r.width + 4);
      const shards = new T.InstancedMesh(new T.ConeGeometry(0.45, 2.4, 5), crystalMat, 90), q = new T.Quaternion(), e = new T.Euler(), sc = new T.Vector3();
      let made = 0;
      for (let k = 0; made < 90 && k < 600; k++) {
        const rnd = (j) => { const v = Math.sin((k + 1) * 91.17 + j * 47.3 + L * 3.1) * 43758.5453; return v - Math.floor(v); };
        const x = cx + (rnd(1) - 0.5) * 190, y = cy + (rnd(2) - 0.5) * 190;
        if (!clear(x, y)) continue;
        for (let j = 0; j < 3 && made < 90; j++, made++) {  // three shards to a cluster, leaning out
          const size = 0.5 + rnd(3 + j) * 1.1;
          e.set((rnd(6 + j) - 0.5) * 0.9, rnd(9 + j) * 6, (rnd(12 + j) - 0.5) * 0.9); q.setFromEuler(e); sc.set(size, size, size);
          m.compose(new T.Vector3(x + (rnd(15 + j) - 0.5) * 1.6, size * 1.1 - 0.3, -(y + (rnd(18 + j) - 0.5) * 1.6)), q, sc);
          shards.setMatrixAt(made, m); shards.setColorAt(made, col.setHSL(rnd(4) < 0.5 ? 0.52 : 0.85, 0.9, 0.55));
        }
      }
      shards.count = made; track.add(shards);
      grandstand();
    }
    const crystalMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1a1030, metalness: 0.2, roughness: 0.15, flatShading: true });
    // ---- the grandstand at the line, on the outside of the track, with a crowd that jumps as craft go by
    const crowd = { mesh: null, base: [], hype: 0 };
    function grandstand() {
      const r = S.rally, W = r.width, p0 = at(0, 0);
      const xs = r.track.map((q) => q[0]), ys = r.track.map((q) => q[1]);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const left = at(0, 5), right = at(0, -5), side = Math.hypot(left.x - cx, left.y - cy) > Math.hypot(right.x - cx, right.y - cy) ? 1 : -1;
      const g = new T.Group(); g.position.copy(V(p0, 0)); g.rotation.y = Math.atan2(p0.uy, p0.ux); track.add(g);
      const z0 = -side * (W + 3.2), out = -side;  // local +z is the right-hand side (d < 0)
      const standMat = new T.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.7 });
      for (let k = 0; k < 3; k++) {
        const step = new T.Mesh(new T.BoxGeometry(14, 0.5 + k * 0.6, 1.1), standMat);
        step.position.set(0, (0.5 + k * 0.6) / 2, z0 + out * k * 1.1); g.add(step);
      }
      const roof = new T.Mesh(new T.BoxGeometry(14.5, 0.15, 3.8), archMat); roof.position.set(0, 4.2, z0 + out * 1.1); g.add(roof);
      const fans = new T.InstancedMesh(new T.BoxGeometry(0.32, 0.55, 0.3), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), 3 * 24);
      const c = new T.Color(), mm = new T.Matrix4();
      crowd.base = [];
      for (let k = 0; k < 3; k++) for (let j = 0; j < 24; j++) {
        const n = k * 24 + j, x = -6.6 + j * 0.575 + (Math.sin(n * 7.1) * 0.08), y = 0.5 + k * 0.6 + 0.28, z = z0 + out * k * 1.1;
        crowd.base.push([x, y, z, Math.sin(n * 12.9898) * 43758.5453 % 1]);
        mm.makeTranslation(x, y, z); fans.setMatrixAt(n, mm); fans.setColorAt(n, c.setHSL(Math.abs(Math.sin(n * 3.7)), 0.7, 0.6));
      }
      crowd.mesh = fans; g.add(fans);
    }
    function cheer(now, dt) {  // the crowd bobs, and jumps when a craft is close to the line
      if (!crowd.mesh || calm()) return;
      const r = S.rally, L = r.length;
      const close = crafts.some((c, i) => { const d = (((sNow(i, now) % L) + L) % L); return Math.min(d, L - d) < 14; });
      crowd.hype += ((close ? 1 : 0.15) - crowd.hype) * (1 - Math.exp(-dt * 4));
      const mm = new T.Matrix4();
      crowd.base.forEach(([x, y, z, ph], n) => {
        mm.makeTranslation(x, y + crowd.hype * 0.3 * Math.max(0, Math.sin(now / 110 + ph * 20)), z); crowd.mesh.setMatrixAt(n, mm);
      });
      crowd.mesh.instanceMatrix.needsUpdate = true;
    }
    const bollardGeo = new T.CylinderGeometry(0.16, 0.18, 0.4, 10);
    const bollardMat = [new T.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.4 }), new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 })];

    // ---- craft: a wedge hull with a cockpit, two engine pods and a tail fin, leaning into its turns.
    // The group faces +x; `tilt` inside it carries the lean (about x) and the nose lift on boost (about z).
    function craft(i) {
      const col = new T.Color(colorOf(i)), g = new T.Group(), tilt = new T.Group(); g.add(tilt);
      const paint = new T.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.35, emissive: col, emissiveIntensity: 0.15 });
      const metal = new T.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.8, roughness: 0.3 });
      const body = new T.Mesh(new T.BoxGeometry(1.3, 0.26, 0.8), paint);
      const noseGeo = new T.ConeGeometry(0.56, 0.9, 4); noseGeo.rotateY(Math.PI / 4); noseGeo.rotateZ(-Math.PI / 2); noseGeo.scale(1, 0.45, 1);
      const nose = new T.Mesh(noseGeo, paint); nose.position.x = 1.1;
      const cockpit = new T.Mesh(new T.SphereGeometry(0.3, 14, 10),
        new T.MeshStandardMaterial({ color: 0x0b1630, metalness: 0.9, roughness: 0.1, emissive: 0x1a3a66, emissiveIntensity: 0.4 }));
      cockpit.scale.set(1.5, 0.6, 0.9); cockpit.position.set(0.25, 0.15, 0);
      const fin = new T.Mesh(new T.BoxGeometry(0.45, 0.35, 0.05), paint); fin.position.set(-0.45, 0.3, 0);
      tilt.add(body, nose, cockpit, fin);
      const flames = [];
      for (const z of [-0.5, 0.5]) {
        const podGeo = new T.CylinderGeometry(0.15, 0.19, 0.9, 10); podGeo.rotateZ(Math.PI / 2);
        const pod = new T.Mesh(podGeo, metal); pod.position.set(-0.25, 0, z);
        const flame = new T.Sprite(new T.SpriteMaterial(glowMat(col.clone().lerp(new T.Color(0xffffff), 0.5))));
        flame.position.set(-0.75, 0, z); tilt.add(pod, flame); flames.push(flame);
      }
      const under = new T.Mesh(new T.PlaneGeometry(2.4, 1.5), new T.MeshBasicMaterial(glowMat(col, 0.55)));
      under.rotation.x = -Math.PI / 2; under.position.y = -0.4; g.add(under);
      if (i !== S.rally.me) {  // a name tag over each rival
        const name = ctx.player(S.rally.seats[i])?.name ?? '', c = document.createElement('canvas'); c.width = 256; c.height = 64;
        const x = c.getContext('2d');
        x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineWidth = 6; x.strokeStyle = '#000a'; x.strokeText(name, 128, 32); x.fillStyle = colorOf(i); x.fillText(name, 128, 32);
        const tag = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
        tag.scale.set(2.6, 0.65, 1); tag.position.y = 1.3; g.add(tag);
      }
      // the item held rides on the roof; a shield is a bubble round the whole craft
      const held = [null, rocket(), mineMesh(), new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.06, 16), shieldMat)];
      held[1].scale.setScalar(0.7); held[2].scale.setScalar(0.6); held[3].rotation.x = Math.PI / 2;
      for (const h of held.slice(1)) { h.position.set(-0.1, 0.42, 0); h.visible = false; tilt.add(h); }
      const bubble = new T.Mesh(bubbleGeo, bubbleMat.clone()); bubble.scale.set(1.5, 0.8, 1.05); bubble.visible = false; g.add(bubble);
      const trail = ribbon(col); scene.add(trail.mesh);
      Object.assign(g.userData, { tilt, paint, flames, under, trail, held, bubble, d: null, vd: 0, lean: 0, lift: 0, flare: 0, spin: 0 });
      return g;
    }
    // ---- missiles: a slim body with a red nose and fins, facing +x
    const rMetal = new T.MeshStandardMaterial({ color: 0xe8ecf4, metalness: 0.6, roughness: 0.3 });
    const rRed = new T.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 0.5 });
    function rocket() {
      const g = new T.Group();
      const bodyGeo = new T.CylinderGeometry(0.11, 0.11, 0.8, 8); bodyGeo.rotateZ(Math.PI / 2);
      const noseGeo = new T.ConeGeometry(0.11, 0.3, 8); noseGeo.rotateZ(-Math.PI / 2);
      const nose = new T.Mesh(noseGeo, rRed); nose.position.x = 0.55;
      const finGeo = new T.BoxGeometry(0.2, 0.36, 0.03);
      const f1 = new T.Mesh(finGeo, rRed), f2 = new T.Mesh(finGeo, rRed);
      f1.position.x = f2.position.x = -0.32; f2.rotation.x = Math.PI / 2;
      g.add(new T.Mesh(bodyGeo, rMetal), nose, f1, f2);
      return g;
    }
    // ---- mines: a dark ball with studs and a light that blinks
    const mineBody = new T.MeshStandardMaterial({ color: 0x2a2a35, metalness: 0.7, roughness: 0.4 });
    const shieldMat = new T.MeshStandardMaterial({ color: 0x7fdcff, emissive: 0x3aa9ff, emissiveIntensity: 0.7 });
    const bubbleGeo = new T.SphereGeometry(1, 20, 14);
    const bubbleMat = new T.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false });
    function mineMesh() {
      const g = new T.Group(), studGeo = new T.ConeGeometry(0.07, 0.18, 6);
      g.add(new T.Mesh(new T.IcosahedronGeometry(0.32, 0), mineBody));
      for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
        const st = new T.Mesh(studGeo, mineBody); st.position.set(x * 0.34, y * 0.34, z * 0.34);
        st.lookAt(x * 2, y * 2, z * 2); st.rotateX(Math.PI / 2); g.add(st);
      }
      const light = new T.Sprite(new T.SpriteMaterial(glowMat(0xff3030))); light.scale.set(0.5, 0.5, 1); light.position.y = 0.3;
      g.add(light); g.userData.light = light;
      return g;
    }
    const laid = [];
    function drawMines(now) {
      while (laid.length < mines.length) { const g = mineMesh(); scene.add(g); laid.push(g); }
      laid.forEach((g, k) => {
        const m = mines[k]; g.visible = !!m; if (!m) return;
        g.position.copy(V(at(m[0], m[1]), 0.35 + 0.05 * Math.sin(now / 300 + k))); g.rotation.y = now / 900 + k;
        g.userData.light.material.opacity = (now / 250 + k) % 2 < 1 ? 1 : 0.15;
      });
    }
    const flying = [];
    function drawMissiles(now) {
      while (flying.length < missiles.length) {
        const g = rocket(), fl = new T.Sprite(new T.SpriteMaterial(glowMat(0xffb347)));
        fl.position.x = -0.6; fl.scale.set(0.9, 0.6, 1); g.add(fl); scene.add(g); flying.push(g);
      }
      flying.forEach((g, k) => {
        const m = missiles[k]; g.visible = !!m; if (!m) return;
        const s = mNow(m, now), p = at(s, m[1]);
        g.position.copy(V(p, 0.6)); g.rotation.y = Math.atan2(p.uy, p.ux); g.rotation.x = now / 60;
        const t = V(at(s - 0.7, m[1]), 0.6);
        spawn(1, t.x, t.y, t.z, 0, 0.4, 0, 0.5, 0xbbbbbb, 0.5);
      });
    }

    function ensureShips() {
      while (ships.length < S.rally.seats.length) { const g = craft(ships.length); scene.add(g); ships.push(g); }
    }

    // ---- trails: a ribbon through each craft's recent path, brightest at the craft and fading to nothing
    const TRAIL = 28;
    function ribbon(color) {
      const geo = new T.BufferGeometry(), idx = [];
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL * 6), 3));
      geo.setAttribute('color', new T.BufferAttribute(new Float32Array(TRAIL * 6), 3));
      for (let k = 0; k < TRAIL - 1; k++) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      geo.setIndex(idx);
      const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      mesh.frustumCulled = false;
      return { mesh, pts: [], color };
    }
    function trailTick(tr, p, boosting, y = 0.42) {  // p: the point behind the craft, from at(); y: its height
      const head = { x: p.x, y, z: -p.y, nx: -p.uy, nz: -p.ux }, pts = tr.pts;
      if (pts[0] && Math.hypot(pts[0].x - head.x, pts[0].z - head.z) > 6) pts.length = 0;  // jumped: a new race
      if (pts.length < 2 || Math.hypot(pts[1].x - head.x, pts[1].z - head.z) > 0.45) pts.unshift(head); else pts[0] = head;
      if (pts.length > TRAIL) pts.length = TRAIL;
      const pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color;
      const w0 = boosting ? 0.42 : 0.26, bright = boosting ? 1.3 : 0.7;
      for (let k = 0; k < TRAIL; k++) {
        const q = pts[Math.min(k, pts.length - 1)], f = 1 - k / (TRAIL - 1), w = w0 * f;
        if (!q) break;
        pos.setXYZ(2 * k, q.x + q.nx * w, q.y, q.z + q.nz * w); pos.setXYZ(2 * k + 1, q.x - q.nx * w, q.y, q.z - q.nz * w);
        const b = f * f * bright;
        col.setXYZ(2 * k, tr.color.r * b, tr.color.g * b, tr.color.b * b); col.setXYZ(2 * k + 1, tr.color.r * b, tr.color.g * b, tr.color.b * b);
      }
      pos.needsUpdate = col.needsUpdate = true;
    }

    // ---- particles: sparks off walls and bumps, boost flames, pad bursts (none with reduced motion)
    const NP = 360, parts = [];
    const pgeo = new T.BufferGeometry();
    pgeo.setAttribute('position', new T.BufferAttribute(new Float32Array(NP * 3), 3));
    pgeo.setAttribute('color', new T.BufferAttribute(new Float32Array(NP * 3), 3));
    const points = new T.Points(pgeo, new T.PointsMaterial({ size: 0.35, map: dot, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    points.frustumCulled = false; scene.add(points);
    function spawn(n, x, y, z, vx, vy, vz, spread, color, life, grav = 0, floor = 0.03) {  // floor: where they bounce
      if (calm()) return;
      const c = new T.Color(color);
      for (let k = 0; k < n; k++) {
        if (parts.length >= NP) parts.shift();
        const l = life * (0.6 + Math.random() * 0.6);
        parts.push({ x, y, z, vx: vx + (Math.random() - 0.5) * spread, vy: vy + Math.random() * spread * 0.6, vz: vz + (Math.random() - 0.5) * spread,
          life: l, max: l, c, grav, floor });
      }
    }
    function tickParts(dt) {
      for (let k = parts.length; k--;) {
        const q = parts[k];
        if ((q.life -= dt) <= 0) { parts.splice(k, 1); continue; }
        q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < q.floor) { q.y = q.floor; q.vy *= -0.4; }
      }
      const pos = pgeo.attributes.position, col = pgeo.attributes.color;
      for (let k = 0; k < NP; k++) {
        const q = parts[k];
        if (!q) { pos.setXYZ(k, 0, -50, 0); col.setXYZ(k, 0, 0, 0); continue; }
        const f = q.life / q.max;
        pos.setXYZ(k, q.x, q.y, q.z); col.setXYZ(k, q.c.r * f, q.c.g * f, q.c.b * f);
      }
      pos.needsUpdate = col.needsUpdate = true;
    }
    // where a craft is, with g the track surface under it (on the hills), so effects start and land there
    const shipAt = (i) => ships[i] && { x: ships[i].position.x, z: ships[i].position.z, g: ships[i].userData.ground ?? 0 };
    function fx(e) {
      if (e[0] === 'pad' && shipAt(e[1])) {
        const p = shipAt(e[1]);
        spawn(26, p.x, p.g + 0.2, p.z, 0, 3, 0, 5, 0xffd166, 0.55, 6, p.g + 0.03);
        ships[e[1]].userData.flare = 1;
      } else if (e[0] === 'hit' && shipAt(e[1])) {  // an explosion: a hot flash, then embers
        const p = shipAt(e[1]);
        spawn(30, p.x, p.g + 0.6, p.z, 0, 3, 0, 9, 0xffb347, 0.6, 8, p.g + 0.03);
        spawn(14, p.x, p.g + 0.6, p.z, 0, 2, 0, 5, 0xff3b3b, 0.9, 4, p.g + 0.03);
        ships[e[1]].userData.flare = 1;
        if (e[1] === S.rally.me) GL3.shake(camera, 0.7);
      } else if (e[0] === 'pick' && shipAt(e[1])) {
        const p = shipAt(e[1]);
        spawn(14, p.x, p.g + 0.7, p.z, 0, 2, 0, 4, [0, 0xff5d5d, 0x8a8aa0, 0x7fdcff][e[2]] || 0xffffff, 0.4, 6, p.g + 0.03);
      } else if ((e[0] === 'shield' || e[0] === 'block') && shipAt(e[1])) {  // the bubble going up, or taking a hit
        const p = shipAt(e[1]);
        spawn(e[0] === 'block' ? 34 : 18, p.x, p.g + 0.6, p.z, 0, 1.5, 0, e[0] === 'block' ? 8 : 4, 0x7fdcff, 0.5, 2, p.g + 0.03);
        ships[e[1]].userData.flare = 1;
        if (e[0] === 'block' && e[1] === S.rally.me) GL3.shake(camera, 0.25);
      } else if (e[0] === 'out' && shipAt(e[1])) {  // 💥 knocked out: a puff of dark smoke
        const p = shipAt(e[1]);
        spawn(30, p.x, p.g + 0.5, p.z, 0, 2.5, 0, 3, 0x6c6c80, 1.2, -0.5, p.g + 0.03);
        if (e[1] === S.rally.me) GL3.shake(camera, 0.5);
      } else if (e[0] === 'fall' && shipAt(e[1])) {  // 🕳️ into the gap: a burst of smoke and sparks from below
        const p = shipAt(e[1]);
        spawn(30, p.x, p.g - 1, p.z, 0, 4, 0, 3, 0x6c6c80, 1.0, 1, p.g - 6);
        spawn(16, p.x, p.g - 1, p.z, 0, 5, 0, 4, 0xff6b3b, 0.6, 8, p.g - 6);
        if (e[1] === S.rally.me) GL3.shake(camera, 0.6);
      } else if (e[0] === 'land' && shipAt(e[1])) {
        const p = shipAt(e[1]);
        spawn(12, p.x, p.g + 0.1, p.z, 0, 1, 0, 4, 0xcfe8ff, 0.35, 6, p.g + 0.03);
        if (e[1] === S.rally.me) GL3.shake(camera, 0.3);
      } else if (e[0] === 'drop' && shipAt(e[1])) {
        const p = shipAt(e[1]);
        spawn(8, p.x, p.g + 0.3, p.z, 0, 1, 0, 2, 0x8a8aa0, 0.4, 6, p.g + 0.03);
      } else if (e[0] === 'bump' && shipAt(e[1]) && shipAt(e[2])) {
        const a = shipAt(e[1]), b = shipAt(e[2]);
        spawn(20, (a.x + b.x) / 2, a.g + 0.5, (a.z + b.z) / 2, 0, 2, 0, 7, 0xcfe8ff, 0.4, 10, a.g + 0.03);
        if (e.slice(1).includes(S.rally.me)) GL3.shake(camera, 0.35);
      }
    }

    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      mini.size();
    }

    // ---- 🗺️ minimap in the top corner: the track outline, every craft (you ringed in white) and missiles in flight
    const mini = (() => {
      const cv = document.createElement('canvas'); cv.className = 'ra-mini'; stage.append(cv);
      const g = cv.getContext('2d');
      let k = 1, ox = 0, oy = 0, path = null, dpr = 1, px = 0, zones = [];
      function size() {
        const css = Math.round(Math.max(84, Math.min(130, (stage.clientWidth || 320) * 0.26)));
        dpr = Math.min(devicePixelRatio || 1, 2); px = Math.round(css * dpr);
        cv.style.width = cv.style.height = `${css}px`; cv.width = cv.height = px;
        const pts = S?.rally?.track; if (!pts) return;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 8;
        k = px / span; ox = (Math.max(...xs) + Math.min(...xs)) / 2; oy = (Math.max(...ys) + Math.min(...ys)) / 2;
        path = new Path2D(); pts.forEach(([x, y], j) => (j ? path.lineTo(X(x), Y(y)) : path.moveTo(X(x), Y(y)))); path.closePath();
        zones = zonePaths(X, Y, false);
      }
      const X = (x) => px / 2 + (x - ox) * k, Y = (y) => px / 2 - (y - oy) * k;
      function draw(now, focus) {
        if (!path) return;
        const r = S.rally;
        g.clearRect(0, 0, px, px);
        g.lineJoin = 'round'; g.strokeStyle = 'rgba(76,201,240,.55)'; g.lineWidth = 5 * dpr; g.stroke(path);
        g.strokeStyle = 'rgba(20,16,40,.9)'; g.lineWidth = 2.5 * dpr; g.stroke(path);
        for (const [kind, zp] of zones) { g.strokeStyle = kind === 'gap' ? '#ff3b3b' : ZONE_INK[kind]; g.lineWidth = (kind === 'gap' ? 3 : 2.5) * dpr; g.stroke(zp); }
        const f = at(0, 0); g.fillStyle = '#fff'; g.fillRect(X(f.x) - 1.5 * dpr, Y(f.y) - 1.5 * dpr, 3 * dpr, 3 * dpr);  // the line
        g.fillStyle = '#ff3030';
        for (const m of mines) { const p = at(m[0], m[1]); g.fillRect(X(p.x) - 1.3 * dpr, Y(p.y) - 1.3 * dpr, 2.6 * dpr, 2.6 * dpr); }
        g.fillStyle = '#ffb347';
        for (const m of missiles) { const p = at(mNow(m, now), m[1]); g.beginPath(); g.arc(X(p.x), Y(p.y), 1.8 * dpr, 0, 7); g.fill(); }
        // rivals first so you're drawn on top
        for (const i of crafts.map((c, i) => i).sort((a, b) => (a === focus) - (b === focus))) {
          const p = at(sNow(i, now), crafts[i][1]), big = i === focus;
          g.fillStyle = colorOf(i); g.beginPath(); g.arc(X(p.x), Y(p.y), (big ? 3.6 : 2.6) * dpr, 0, 7); g.fill();
          if (big) { g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr; g.stroke(); }
        }
      }
      return { size, draw };
    })();
    const ghostShip = new T.Mesh(new T.BoxGeometry(1.4, 0.35, 0.9), new T.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.3, depthWrite: false }));
    ghostShip.visible = false; scene.add(ghostShip);
    // chase camera: eases after the craft, widens its view with speed, drops lower on boost and banks with the lean
    const cam = { ready: false, pos: new T.Vector3(), look: new T.Vector3(), boost: 0 }, want = new T.Vector3();
    let last = 0;
    function draw(now) {
      ensureShips();
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
      const ease = (rate) => 1 - Math.exp(-dt * rate);
      const r = S.rally, gp = ghostAt(now), W = r.width;
      padMat.opacity = 0.65 + 0.35 * Math.sin(now / 140);
      pickMat.color.setHSL((now / 2500) % 1, 0.85, 0.6); pickMat.emissive.setHSL((now / 2500) % 1, 0.9, 0.35);
      pickups.forEach((g, k) => { g.visible = !!pk[k]; g.rotation.y = now / 400; g.position.y = g.userData.y + 0.12 * Math.sin(now / 250 + k); });
      glints.forEach((g, k) => { g.material.opacity = Math.max(0, Math.sin(now / 380 + k * 1.7)) ** 8; });
      pylonMat.color.setScalar(calm() ? 0.9 : 0.75 + 0.25 * Math.sin(now / 300));
      cheer(now, dt);
      drawMissiles(now); drawMines(now);
      ghostShip.visible = !!gp;
      if (gp) { ghostShip.position.copy(V(gp, 0.45)); ghostShip.rotation.y = Math.atan2(gp.uy, gp.ux); ghostShip.material.opacity = 0.22 + 0.08 * Math.sin(now / 150); }
      ships.forEach((g, i) => {
        const c = crafts[i], u = g.userData; if (!c) return;
        // glide sideways toward the server's offset rather than jumping each update; its rate of change is the lean
        if (u.d == null || !dt) u.d = c[1];
        else { const nd = u.d + (c[1] - u.d) * ease(18); u.vd += ((nd - u.d) / dt - u.vd) * ease(8); u.d = nd; }
        const s = sNow(i, now), p = at(s, u.d), boosting = !!c[3];
        u.ground = p.h;
        u.sink = c[12] ? Math.min(1, (u.sink || 0) + dt * 0.8) : 0;  // knocked out: it settles onto the track
        // 🚧 up a ramp, then the jump's arc from the server (eased between updates); after a fall it pops back
        const air = c[13] || 0;
        u.h = u.h == null || !dt || Math.abs(air - u.h) > 2 ? air : u.h + (air - u.h) * ease(20);
        u.ramp = air ? (u.ramp || 0) * Math.exp(-dt * 2.5) : rampLift(s);
        const up = u.h + u.ramp;
        g.position.copy(V(p, 0.45 + up - 0.3 * u.sink + 0.06 * (1 - u.sink) * Math.sin(now / 200 + i)));
        // spinning from a missile hit: whirl round, then settle back facing forward
        if (c[10]) u.spin += dt * 16; else if (u.spin) { const to = Math.round(u.spin / Math.PI / 2) * Math.PI * 2; u.spin += (to - u.spin) * ease(10); if (Math.abs(to - u.spin) < 0.01) u.spin = 0; }
        g.rotation.y = Math.atan2(p.uy, p.ux) + u.spin;
        u.held.forEach((h, k) => h && (h.visible = c[9] === k));
        u.bubble.visible = !!c[11];
        if (c[11]) u.bubble.material.opacity = 0.18 + 0.08 * Math.sin(now / 90 + i);
        // left is +d and leaning left is a negative turn about the forward axis
        const lean = Math.max(-0.5, Math.min(0.5, -(u.vd * 0.07 + (i === r.me ? steerNow * 0.22 : 0))));
        u.lean += (lean - u.lean) * ease(10); u.lift += ((boosting ? 0.08 : 0) - u.lift) * ease(6); u.flare *= Math.exp(-dt * 4);
        const pitch = Math.atan((hillAt(s + 1) - hillAt(s - 1)) / 2);  // nose up the hills, down over the crests
        u.bank = -Math.atan(p.tilt || 0);  // rolled with a banked bend
        u.tilt.rotation.set(u.lean + u.bank, 0, u.lift + pitch + 0.03 * Math.sin(now / 260 + i));
        u.paint.emissiveIntensity = boosting ? 0.8 : 0.15 + 0.6 * u.flare;
        const k = Math.min(1.4, c[2] / r.top), fl = (0.35 + 0.35 * k + (boosting ? 0.5 : 0) * (0.85 + 0.3 * Math.random())) * (1 - u.sink);
        for (const f of u.flames) f.scale.set(fl, fl * 0.8, 1);
        // the glow underneath stays on the ground (fainter the higher you are) and is gone over a gap
        u.under.position.y = -0.4 - Math.max(0, up);
        u.under.material.opacity = zoneAt(s, ['gap']) ? 0 : (0.45 + 0.1 * Math.sin(now / 120 + i) + 0.5 * u.flare) / (1 + Math.max(0, u.h));
        const tp = at(s - 0.85, u.d);
        trailTick(u.trail, tp, boosting, 0.42 + up + tp.h);
        if (!dt || c[6]) return;
        const vx = -p.ux * c[2] * 0.3, vz = p.uy * c[2] * 0.3;
        if (boosting) for (const z of [-0.5, 0.5]) {
          const e = V(at(s - 0.9, u.d - z), 0.45);
          spawn(1, e.x, e.y, e.z, vx * 2, 0.3, vz * 2, 1.2, 0x9be7ff, 0.25);
        }
        if (c[8] && i === r.me && Math.random() < 0.5) {  // in a slipstream: wind streaks rushing past
          const e = V(at(s + 2.5, u.d + (Math.random() - 0.5) * 2.4), 0.3 + Math.random() * 0.8);
          spawn(1, e.x, e.y, e.z, vx * 6, 0, vz * 6, 0.2, 0xdff4ff, 0.3);
        }
        if (c[7]) {  // scraping: sparks off the wall it's touching
          const w = V(at(s, Math.sign(u.d) * W), 0.3);
          spawn(2, w.x, w.y, w.z, vx, 1.5, vz, 3, 0xffa94d, 0.4, 12, w.y - 0.27);
          if (i === r.me) GL3.shake(camera, 0.12);
        }
      });
      // the chase camera follows you, or the leader when you're watching
      const who = r.me ?? (S.phase === 'playing' ? order()[0] : null);
      mini.draw(now, who);
      if (who != null && crafts[who] && ships[who]) {
        const c = crafts[who], u = ships[who].userData, p = at(sNow(who, now), u.d ?? c[1]);
        cam.boost += ((c[3] ? 1 : 0) - cam.boost) * ease(4);
        const back = 7 - 1.3 * cam.boost, k = Math.min(1.4, c[2] / r.top);
        const up = 0.6 * ((u.h || 0) + (u.ramp || 0));  // rise a little with a jump
        want.set(p.x - p.ux * back, 3.6 - 0.7 * cam.boost + up + Math.max(p.h, hillAt(sNow(who, now) - back)), -(p.y - p.uy * back));
        if (!cam.ready) cam.pos.copy(want); else cam.pos.lerp(want, ease(8));
        want.set(p.x + p.ux * 6, 0.5 + up + hillAt(sNow(who, now) + 6), -(p.y + p.uy * 6));
        if (!cam.ready) cam.look.copy(want); else cam.look.lerp(want, ease(10));
        cam.ready = true;
        const fov = 60 + 10 * k + 10 * cam.boost;
        if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
        camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.rotateZ(-u.lean * 0.35 - (u.bank || 0) * 0.6);
      } else {
        camera.position.set(0, 95, 55); camera.lookAt(0, 0, 0);
      }
      sky.position.copy(camera.position);
      GL3.tickShake(camera, dt);
      tickParts(dt);
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); stage.querySelector('.ra-mini')?.remove(); }
    return { build, draw, resize, dispose, fx };
  }

  // ---------- flat top-down fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 3, ox = 0, oy = 0, ring = null, zones = [];
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
      const pts = S?.rally?.track || [[0, 0]];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 10;
      k = canvas.width / span; ox = (Math.max(...xs) + Math.min(...xs)) / 2; oy = (Math.max(...ys) + Math.min(...ys)) / 2;
      ring = null; zones = [];
      const r = S?.rally; if (!r?.cum || typeof Path2D === 'undefined') return;
      // the track as a ring between its two edges (the width varies at narrows), then its features on top
      ring = new Path2D();
      for (const side of [1, -1]) {
        r.track.forEach((_, j) => { const p = at(r.cum[j], side * hwAt(j)); j ? ring.lineTo(X(p.x), Y(p.y)) : ring.moveTo(X(p.x), Y(p.y)); });
        ring.closePath();
      }
      zones = zonePaths(X, Y, true);
    }
    const X = (x) => canvas.width / 2 + (x - ox) * k, Y = (y) => canvas.height / 2 - (y - oy) * k;
    function draw(now) {
      const r = S.rally;
      g.fillStyle = '#070512'; g.fillRect(0, 0, canvas.width, canvas.height);
      if (ring) { g.fillStyle = '#24203a'; g.fill(ring, 'evenodd'); } else {
        g.strokeStyle = '#24203a'; g.lineWidth = r.width * 2 * k; g.lineJoin = 'round';
        g.beginPath(); r.track.forEach(([x, y], j) => (j ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke();
      }
      for (const [kind, zp] of zones) { g.fillStyle = ZONE_INK[kind]; g.globalAlpha = kind === 'ice' ? 0.55 : 1; g.fill(zp); }
      g.globalAlpha = 1;
      g.fillStyle = '#ff5d5d';
      (r.pickups || []).forEach(([pi, lat], j) => {
        if (!pk[j]) return;
        const p = at(r.cum[pi % r.track.length], lat), x = X(p.x), y = Y(p.y), q = Math.max(3, 0.5 * k);
        g.beginPath(); g.moveTo(x, y - q); g.lineTo(x + q, y); g.lineTo(x, y + q); g.lineTo(x - q, y); g.fill();
      });
      g.fillStyle = '#ff3030';
      for (const m of mines) { const p = at(m[0], m[1]), q = Math.max(2, 0.3 * k); g.fillRect(X(p.x) - q, Y(p.y) - q, 2 * q, 2 * q); }
      g.fillStyle = '#ffb347';
      for (const m of missiles) { const p = at(mNow(m, now), m[1]); g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(2, 0.35 * k), 0, 7); g.fill(); }
      const gp = ghostAt(now);
      if (gp) { g.strokeStyle = '#bfe9ffaa'; g.lineWidth = 2; g.beginPath(); g.arc(X(gp.x), Y(gp.y), Math.max(3, 0.8 * k), 0, 7); g.stroke(); }
      crafts.forEach((c, i) => {
        const p = at(sNow(i, now), c[1]);
        g.fillStyle = colorOf(i); g.strokeStyle = i === r.me ? '#fff' : '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(3, 0.8 * k), 0, 7); g.fill(); g.stroke();
        if (c[11]) { g.strokeStyle = '#7fdcff'; g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(5, 1.3 * k), 0, 7); g.stroke(); }  // shielded
      });
    }
    resize();
    return { build: resize, draw, resize };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.rally.elim ? '💥 Elimination' : `🛸 ${s.rally.laps} laps`) : null);
  const myMove = (s) => s.phase === 'playing' && s.rally.stage === 'race' && s.rally.me != null && !s.rally.c[s.rally.me][6];

  return { mount, render, unmount, fast, turnText, myMove, focus: true, ghost: () => (S?.rally ? ghostAt(performance.now()) : null), laps: () => [...laps] };
})();
