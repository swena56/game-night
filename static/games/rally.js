// Hover Rally: the track in 3D with a chase camera behind your craft (three.js), or top-down 2D.
// Craft are (s, d): distance along the track and sideways offset (left is +d); positions glide
// between server updates using each craft's speed. Hold the left/right half of the screen to steer.
// The server also sends moments (bumps, boost-pad hits) that become sparks, sounds and camera shake.
UI.rally = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let crafts = [], gotAt = 0, steerNow = 0, keys = new Set(), touch = null, countdownAt = 0, trackKey = '';
  // ⏱ lap splits and 👻 a ghost of your best lap so far this race (recorded in the browser)
  let laps = [], lapRun = null, ghost = null, lapFlash = 0, lapMsg = '';
  let prevMine = null, beeped = 0;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    gl = null; flat = null; crafts = []; steerNow = 0; keys = new Set(); touch = null; trackKey = '';
    laps = []; lapRun = null; ghost = null; lapFlash = 0; prevMine = null; beeped = 0;
    main.innerHTML = `<div class="ra"><div class="ra-hud"><span id="raLap"></span><b id="raPlace"></b><span id="raSpeed"></span></div>
      <div class="ra-stage" id="raStage"><div class="lr-banner" id="raBanner" hidden></div>
        <div class="ra-half left">◀</div><div class="ra-half right">▶</div></div>
      <div class="sm-bar"><span class="hint">Hold a side to steer · swipe up to boost</span><button id="raBoost" class="primary">⚡ Boost</button></div></div>`;
    side.innerHTML = '<div class="panel"><div id="raOrder"></div><div id="raSplits" class="ra-splits"></div></div>';
    main.querySelector('.ra').style.touchAction = 'none';
    $('raBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boost(); });
    const stage = $('raStage');
    stage.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      touch = { y: e.clientY, boosted: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      steer(e.clientX - r.left < (r.width || 320) / 2 ? 1 : -1);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!touch) return;
      const r = stage.getBoundingClientRect();
      if (!touch.boosted && touch.y - e.clientY > 50) { touch.boosted = true; boost(); }
      steer(e.clientX - r.left < (r.width || 320) / 2 ? 1 : -1);
    });
    for (const t of ['pointerup', 'pointercancel']) stage.addEventListener(t, () => { touch = null; steer(0); });
    const KEY = { ArrowLeft: 1, KeyA: 1, ArrowRight: -1, KeyD: -1 };
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (KEY[e.code]) { e.preventDefault(); keys.add(e.code); steer(Math.sign([...keys].reduce((a, k) => a + KEY[k], 0))); }
      else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) boost(); }
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
    function ac() { a ||= new (window.AudioContext || window.webkitAudioContext)(); if (a.state === 'suspended') a.resume(); return a; }
    function tone(f0, f1, dur, type, vol, at = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, f0, f1, q, vol) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
      src.buffer = buf; fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.value = vol; src.connect(fl).connect(g).connect(a.destination); src.start(t);
    }
    const HITS = {
      pad: () => { noise(0.45, 600, 4000, 1.5, 0.5); tone(440, 990, 0.3, 'triangle', 0.07); },
      boost: () => { noise(0.7, 300, 2600, 1.2, 0.6); tone(110, 220, 0.6, 'sawtooth', 0.04); },
      bump: () => { tone(140, 60, 0.18, 'sine', 0.3); noise(0.08, 900, 500, 1, 0.5); },
      far: () => noise(0.06, 800, 500, 1, 0.12),  // rivals bumping each other
      scrape: () => noise(0.12, 3000, 2200, 4, 0.18),
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
      lap: () => [784, 1047].forEach((f, k) => tone(f, f, 0.14, 'triangle', 0.08, k * 0.08)),
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
          fl.connect(g).connect(a.destination); eng = { g, fl, os };
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
  function steer(v) { if (v === steerNow) return; steerNow = v; if (racing()) ctx.input({ steer: v }, true); }
  function boost() { if (racing()) ctx.input({ boost: true }, true); }
  const colorOf = (i) => ctx.player(S.rally.seats[i])?.color ?? '#fff';

  function render(s, c) {
    S = s; ctx = c;
    take(s.rally.c, s.rally.stage);
    countdownAt = performance.now() + s.rally.countdown * 1000;
  }

  function fast(d) {
    if (!S?.rally) return;
    take(d.c, d.st);
    const me = S.rally.me;
    for (const e of d.e || []) {
      gl?.fx(e);
      if (e[0] === 'pad' && e[1] === me) snd.play('pad');
      else if (e[0] === 'bump') snd.play(e.slice(1).includes(me) ? 'bump' : 'far');
    }
  }

  function take(list, stage) {
    crafts = list.map((x) => x.slice());
    const mine = S.rally.me != null ? crafts[S.rally.me] : null;
    if (mine && prevMine && mine[4] < prevMine[4]) snd.play('boost');  // one of my own boosts fired
    prevMine = mine;
    gotAt = performance.now();
    S.rally.c = list; S.rally.stage = stage;
    side();
  }

  // track geometry: the point and left normal at distance s
  function at(s, d) {
    const r = S.rally, L = r.length, cum = r.cum, pts = r.track, n = pts.length;
    s = ((s % L) + L) % L;
    let lo = 0, hi = n;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[(lo + 1) % n], seg = (cum[lo + 1] ?? L) - cum[lo] || 1, f = (s - cum[lo]) / seg;
    const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg, m = Math.hypot(tx, ty) || 1;
    const ux = tx / m, uy = ty / m;
    return { x: a[0] + (b[0] - a[0]) * f - uy * d, y: a[1] + (b[1] - a[1]) * f + ux * d, ux, uy };
  }

  function sNow(i, now) {
    const c = crafts[i]; if (!c) return 0;
    const dt = S.rally.stage === 'race' ? Math.min(0.15, (now - gotAt) / 1000) : 0;
    return c[0] + c[2] * dt;
  }

  function order() {
    return crafts.map((c, i) => i).sort((a, b) => (crafts[a][6] || 99) - (crafts[b][6] || 99) || crafts[b][0] - crafts[a][0]);
  }

  function side() {
    const r = S.rally, box = $('raOrder'); if (!box) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `${r.laps} laps`));
    order().forEach((i, k) => {
      const c = crafts[i], p = ctx.player(r.seats[i]);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      row.append(ctx.el('b', '', `${k + 1}.`), dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}`),
        ctx.el('span', 'hint', c[6] ? '🏁' : `lap ${Math.min(c[5] + 1, r.laps)}`));
      box.append(row);
    });
    const mine = r.me != null ? crafts[r.me] : null;
    $('raBoost').textContent = mine ? `⚡ ${mine[4]}` : '⚡';
    $('raBoost').disabled = !mine || !mine[4] || r.stage !== 'race' || !!mine[6];
    $('raBoost').parentElement.hidden = r.me == null;
    if (mine) {
      $('raLap').textContent = mine[6] ? 'Finished!' : `Lap ${Math.min(mine[5] + 1, r.laps)} / ${r.laps}`;
      const place = order().indexOf(r.me) + 1;
      $('raPlace').textContent = `${place}${['st', 'nd', 'rd'][place - 1] || 'th'}`;
    } else { $('raLap').textContent = 'Watching'; $('raPlace').textContent = ''; }
    splits();
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
      if (ms < best) ghost = { ms, pts: lapRun.pts };
      lapMsg = `Lap ${laps.length}: ${secs(ms)}${ms < best && laps.length > 1 ? ' — best! ⭐' : ''}`;
      lapFlash = now + 1800;
      if (ms < best && laps.length > 1) ctx.sfx?.('good'); else if (!c[6]) snd.play('lap');
      lapRun = { lap: c[5], t0: now, pts: [] };
      splits();
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
    const r = S.rally, key = `${r.length}`;
    if (key !== trackKey && (gl || flat)) { trackKey = key; (gl || flat).build(); }
    if (key !== trackLap.key) { trackLap.key = key; laps = []; lapRun = null; ghost = null; splits(); }
    trackLap(now);
    (gl || flat)?.draw(now);
    const mine = r.me != null ? crafts[r.me] : null;
    $('raSpeed').textContent = mine ? `${Math.round(mine[2] * 10)} km/h${mine[3] ? ' ⚡' : mine[8] ? ' 💨' : ''}` : '';
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
    const text = S.phase === 'playing' && r.stage === 'countdown' ? (cd > 0 ? String(Math.ceil(cd)) : 'GO!') : mine?.[6] && S.phase === 'playing' ? '🏁 Finished!'
      : now < lapFlash ? lapMsg : '';
    $('raBanner').hidden = !text; $('raBanner').textContent = text;
    $('raBanner').classList.toggle('small', !!text && text === lapMsg);
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
    let track = new T.Group(); scene.add(track);
    const ships = [];
    const V = (p, h = 0) => new T.Vector3(p.x, h, -p.y);
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
    const glowMat = (color, opacity = 1) => ({ map: dot, color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
    function build() {
      scene.remove(track); track = new T.Group(); scene.add(track);
      const r = S.rally, n = r.track.length, W = r.width;
      const pos = [], left = [], right = [];
      for (let k = 0; k <= n; k++) {
        const s = r.cum[k % n] ?? 0;
        const a = at(s, W), b = at(s, -W);
        pos.push(a.x, 0, -a.y, b.x, 0, -b.y);
        left.push(V(a, 0.05)); right.push(V(b, 0.05));
      }
      const idx = [];
      for (let k = 0; k < n; k++) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      track.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x24203a, roughness: 0.8, side: T.DoubleSide })));
      for (const edge of [left, right]) track.add(new T.Line(new T.BufferGeometry().setFromPoints(edge), new T.LineBasicMaterial({ color: 0x4cc9f0 })));
      const line = new T.Mesh(new T.PlaneGeometry(0.6, W * 2), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
      const p0 = at(0, 0); line.position.copy(V(p0, 0.02)); line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(p0.uy, p0.ux); track.add(line);
      for (const [pi, lat] of r.pads) {
        const s = r.cum[((pi % n) + n) % n], p = at(s, lat);
        const pad = new T.Mesh(new T.PlaneGeometry(2, 1.6), padMat);
        pad.position.copy(V(p, 0.03)); pad.rotation.x = -Math.PI / 2; pad.rotation.z = Math.atan2(p.uy, p.ux); track.add(pad);
      }
      cam.ready = false;
      for (const g of ships) g.userData.trail.pts.length = 0;
      resize();
    }

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
      const trail = ribbon(col); scene.add(trail.mesh);
      Object.assign(g.userData, { tilt, paint, flames, under, trail, d: null, vd: 0, lean: 0, lift: 0, flare: 0 });
      return g;
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
    function trailTick(tr, p, boosting) {  // p: the point behind the craft, from at()
      const head = { x: p.x, y: 0.42, z: -p.y, nx: -p.uy, nz: -p.ux }, pts = tr.pts;
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
    function spawn(n, x, y, z, vx, vy, vz, spread, color, life, grav = 0) {
      if (calm()) return;
      const c = new T.Color(color);
      for (let k = 0; k < n; k++) {
        if (parts.length >= NP) parts.shift();
        const l = life * (0.6 + Math.random() * 0.6);
        parts.push({ x, y, z, vx: vx + (Math.random() - 0.5) * spread, vy: vy + Math.random() * spread * 0.6, vz: vz + (Math.random() - 0.5) * spread,
          life: l, max: l, c, grav });
      }
    }
    function tickParts(dt) {
      for (let k = parts.length; k--;) {
        const q = parts[k];
        if ((q.life -= dt) <= 0) { parts.splice(k, 1); continue; }
        q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < 0.03) { q.y = 0.03; q.vy *= -0.4; }
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
    const shipAt = (i) => ships[i]?.position;
    function fx(e) {
      if (e[0] === 'pad' && shipAt(e[1])) {
        const p = shipAt(e[1]);
        spawn(26, p.x, 0.2, p.z, 0, 3, 0, 5, 0xffd166, 0.55, 6);
        ships[e[1]].userData.flare = 1;
      } else if (e[0] === 'bump' && shipAt(e[1]) && shipAt(e[2])) {
        const a = shipAt(e[1]), b = shipAt(e[2]);
        spawn(20, (a.x + b.x) / 2, 0.5, (a.z + b.z) / 2, 0, 2, 0, 7, 0xcfe8ff, 0.4, 10);
        if (e.slice(1).includes(S.rally.me)) GL3.shake(camera, 0.35);
      }
    }

    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
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
      ghostShip.visible = !!gp;
      if (gp) { ghostShip.position.copy(V(gp, 0.45)); ghostShip.rotation.y = Math.atan2(gp.uy, gp.ux); ghostShip.material.opacity = 0.22 + 0.08 * Math.sin(now / 150); }
      ships.forEach((g, i) => {
        const c = crafts[i], u = g.userData; if (!c) return;
        // glide sideways toward the server's offset rather than jumping each update; its rate of change is the lean
        if (u.d == null || !dt) u.d = c[1];
        else { const nd = u.d + (c[1] - u.d) * ease(18); u.vd += ((nd - u.d) / dt - u.vd) * ease(8); u.d = nd; }
        const s = sNow(i, now), p = at(s, u.d), boosting = !!c[3];
        g.position.copy(V(p, 0.45 + 0.06 * Math.sin(now / 200 + i)));
        g.rotation.y = Math.atan2(p.uy, p.ux);
        // left is +d and leaning left is a negative turn about the forward axis
        const lean = Math.max(-0.5, Math.min(0.5, -(u.vd * 0.07 + (i === r.me ? steerNow * 0.22 : 0))));
        u.lean += (lean - u.lean) * ease(10); u.lift += ((boosting ? 0.08 : 0) - u.lift) * ease(6); u.flare *= Math.exp(-dt * 4);
        u.tilt.rotation.set(u.lean, 0, u.lift + 0.03 * Math.sin(now / 260 + i));
        u.paint.emissiveIntensity = boosting ? 0.8 : 0.15 + 0.6 * u.flare;
        const k = Math.min(1.4, c[2] / r.top), fl = 0.35 + 0.35 * k + (boosting ? 0.5 : 0) * (0.85 + 0.3 * Math.random());
        for (const f of u.flames) f.scale.set(fl, fl * 0.8, 1);
        u.under.material.opacity = 0.45 + 0.1 * Math.sin(now / 120 + i) + 0.5 * u.flare;
        trailTick(u.trail, at(s - 0.85, u.d), boosting);
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
          spawn(2, w.x, w.y, w.z, vx, 1.5, vz, 3, 0xffa94d, 0.4, 12);
          if (i === r.me) GL3.shake(camera, 0.12);
        }
      });
      if (r.me != null && crafts[r.me] && ships[r.me]) {
        const c = crafts[r.me], u = ships[r.me].userData, p = at(sNow(r.me, now), u.d ?? c[1]);
        cam.boost += ((c[3] ? 1 : 0) - cam.boost) * ease(4);
        const back = 7 - 1.3 * cam.boost, k = Math.min(1.4, c[2] / r.top);
        want.set(p.x - p.ux * back, 3.6 - 0.7 * cam.boost, -(p.y - p.uy * back));
        if (!cam.ready) cam.pos.copy(want); else cam.pos.lerp(want, ease(8));
        want.set(p.x + p.ux * 6, 0.5, -(p.y + p.uy * 6));
        if (!cam.ready) cam.look.copy(want); else cam.look.lerp(want, ease(10));
        cam.ready = true;
        const fov = 60 + 10 * k + 10 * cam.boost;
        if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
        camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.rotateZ(-u.lean * 0.35);
      } else {
        camera.position.set(0, 95, 55); camera.lookAt(0, 0, 0);
      }
      GL3.tickShake(camera, dt);
      tickParts(dt);
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    return { build, draw, resize, dispose, fx };
  }

  // ---------- flat top-down fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 3, ox = 0, oy = 0;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
      const pts = S?.rally?.track || [[0, 0]];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 10;
      k = canvas.width / span; ox = (Math.max(...xs) + Math.min(...xs)) / 2; oy = (Math.max(...ys) + Math.min(...ys)) / 2;
    }
    const X = (x) => canvas.width / 2 + (x - ox) * k, Y = (y) => canvas.height / 2 - (y - oy) * k;
    function draw(now) {
      const r = S.rally;
      g.fillStyle = '#070512'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = '#24203a'; g.lineWidth = r.width * 2 * k; g.lineJoin = 'round';
      g.beginPath(); r.track.forEach(([x, y], j) => (j ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke();
      const gp = ghostAt(now);
      if (gp) { g.strokeStyle = '#bfe9ffaa'; g.lineWidth = 2; g.beginPath(); g.arc(X(gp.x), Y(gp.y), Math.max(3, 0.8 * k), 0, 7); g.stroke(); }
      crafts.forEach((c, i) => {
        const p = at(sNow(i, now), c[1]);
        g.fillStyle = colorOf(i); g.strokeStyle = i === r.me ? '#fff' : '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(3, 0.8 * k), 0, 7); g.fill(); g.stroke();
      });
    }
    resize();
    return { build: resize, draw, resize };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🛸 ${s.rally.laps} laps` : null);
  const myMove = (s) => s.phase === 'playing' && s.rally.stage === 'race' && s.rally.me != null && !s.rally.c[s.rally.me][6];

  return { mount, render, unmount, fast, turnText, myMove, focus: true, ghost: () => (S?.rally ? ghostAt(performance.now()) : null), laps: () => [...laps] };
})();
