// Sumo Saucers: the server owns the physics; this module draws the platform in 3D (three.js) or 2D,
// glides saucers between updates using their velocity, and sends the stick and dashes.
// Controls: drag anywhere for a virtual stick (a tap dashes), the 💨 button, or WASD/arrows + Space.
UI.sumo = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null;
  let keyDown = null, keyUp = null, drag = null, stick = [0, 0], sentAt = 0, keys = new Set(), countdownAt = 0;
  const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const STICK_PX = 60;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; drag = null; stick = [0, 0]; keys = new Set();
    main.innerHTML = `<div class="sm"><div class="sm-stage" id="smStage">
        <div class="lr-banner" id="smBanner" hidden></div>
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
    const ready = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    });
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

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    take(s.sumo);
    countdownAt = performance.now() + s.sumo.countdown * 1000;
    renderSide();
  }

  function fast(d) {
    if (!S?.sumo || d.rd !== S.sumo.round) return;  // a new round arrives with a full view
    take(d);
    renderSide();
  }

  function take(d) {
    const i = me(), was = snap?.s?.[i], now = d.s?.[i];
    if (i != null && was && now) {
      const kick = Math.hypot(now[2] - was[2], now[3] - was[3]);
      if (now[6] && !was[6]) buzz([80, 50, 160]);       // over the edge
      else if (kick > 1.2 && !now[4]) buzz(35);          // shoved (not my own dash)
    }
    snap = { R: d.R, bm: d.bm, s: d.s, st: d.st ?? d.stage };
    gotAt = performance.now();
    Object.assign(S.sumo, { R: d.R, bm: d.bm, s: d.s, stage: snap.st });
  }

  function renderSide() {
    const r = S.sumo, box = $('smSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}`));
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), out = snap.s[i]?.[6];
      const row = ctx.el('div', 'seat-row lr-row' + (out ? ' out' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${out ? ' 🕳️' : ''}`),
        ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
    });
    const mine = r.me != null ? snap.s[r.me] : null;
    const cool = mine ? mine[5] - (performance.now() - gotAt) / 1000 : 0;
    const b = $('smDash');
    b.disabled = !mine || !!mine[6] || snap.st !== 'play';
    b.textContent = cool > 0.05 ? `💨 ${cool.toFixed(1)}s` : '💨 Dash';
    b.parentElement.hidden = r.me == null;
    $('smInfo').textContent = `${snap.bm.split('').filter((x) => x === '1').length} bumpers left`;
  }

  // where saucer i is now: last known position plus its velocity since then (capped)
  function pos(i, now) {
    const s = snap.s[i];
    const t = snap.st === 'play' ? Math.min(0.12, (now - gotAt) / 1000) : 0;
    return [s[0] + s[2] * t, s[1] + s[3] * t];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !S?.sumo) return;
    (gl || flat)?.draw(now);
    const r = S.sumo, cd = (countdownAt - now) / 1000, mine = r.me != null ? snap.s[r.me] : null;
    let text = '';
    if (S.phase === 'playing' && snap.st === 'countdown') text = cd > 0 ? String(Math.ceil(cd)) : 'GO!';
    else if (S.phase === 'playing' && snap.st === 'over') text = 'Round over';
    else if (S.phase === 'playing' && mine?.[6]) text = '🕳️ Off the edge — watching';
    $('smBanner').hidden = !text; $('smBanner').textContent = text;
    if (mine && mine[5] > 0 && Math.floor(now / 100) % 2 === 0) renderSide();  // tick the dash cooldown
  }

  // ---------- three.js arena
  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); } catch { return null; }
    if (!renderer.getContext()) { renderer.dispose(); return null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x05040d);
    const camera = new T.PerspectiveCamera(42, 1, 0.5, 300);
    scene.add(new T.HemisphereLight(0xbfd9ff, 0x221133, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 0.8); sun.position.set(-8, 20, 10); scene.add(sun);
    // stars
    const starGeo = new T.BufferGeometry(), pts = [];
    for (let k = 0; k < 600; k++) {
      const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), d = 90 + Math.random() * 60;
      pts.push(d * Math.sin(b) * Math.cos(a), d * Math.cos(b) - 20, d * Math.sin(b) * Math.sin(a));
    }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    scene.add(new T.Points(starGeo, new T.PointsMaterial({ color: 0xffffff, size: 0.6 })));
    const R0 = S?.sumo?.R0 ?? 10;
    const platform = new T.Group(); scene.add(platform);
    const disc = new T.Mesh(new T.CylinderGeometry(R0, R0 * 0.8, 1.2, 64), new T.MeshStandardMaterial({ color: 0x3a3358, metalness: 0.4, roughness: 0.5 }));
    disc.position.y = -0.6; platform.add(disc);
    for (const f of [0.33, 0.66]) {
      const ring = new T.Mesh(new T.RingGeometry(R0 * f - 0.05, R0 * f + 0.05, 64), new T.MeshBasicMaterial({ color: 0x6b5f9a, side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; platform.add(ring);
    }
    const nb = S?.sumo?.nb ?? 16, bumpers = [];
    for (let k = 0; k < nb; k++) {
      const a = ((k + 0.5) / nb) * 6.283;
      const m = new T.Mesh(new T.BoxGeometry(0.35, 0.5, (6.283 * R0) / nb * 0.82), new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x2a9df4, emissiveIntensity: 0.9 }));
      m.position.set(Math.cos(a) * R0, 0.25, Math.sin(a) * R0);
      m.rotation.y = -a;
      platform.add(m); bumpers.push(m);
    }
    const saucers = [];
    const body = new T.SphereGeometry(1, 28, 14), dome = new T.SphereGeometry(0.5, 20, 10, 0, 6.283, 0, Math.PI / 2);
    const ringGeo = new T.TorusGeometry(1.15, 0.08, 8, 32);
    function ensureSaucers() {
      while (saucers.length && saucers.length > S.sumo.seats.length) scene.remove(saucers.pop());
      while (saucers.length < S.sumo.seats.length) {
        const i = saucers.length, g = new T.Group(), r = S.sumo.saucer;
        const hull = new T.Mesh(body, new T.MeshStandardMaterial({ color: new T.Color(colorOf(i)), metalness: 0.5, roughness: 0.35 }));
        hull.scale.set(r, r * 0.32, r);
        const top = new T.Mesh(dome, new T.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.75, roughness: 0.1 }));
        top.scale.setScalar(r * 1.1); top.position.y = r * 0.15;
        const glow = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffffff }));
        glow.rotation.x = Math.PI / 2; glow.scale.setScalar(r); glow.visible = false;
        g.add(hull, top, glow);
        g.userData = { glow, mine: null };
        if (i === S.sumo.me) {
          const mark = new T.Mesh(new T.RingGeometry(r * 1.25, r * 1.45, 32), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
          mark.rotation.x = -Math.PI / 2; mark.position.y = -r * 0.3; g.add(mark);
        }
        scene.add(g); saucers.push(g);
      }
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h;
      // keep the whole platform in view whatever the screen shape
      const fit = R0 * 1.25 / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect);
      camera.position.set(0, fit * 0.85, fit * 0.6); camera.lookAt(0, -1, 0.6);
      camera.updateProjectionMatrix();
    }
    function draw(now) {
      ensureSaucers();
      const k = snap.R / R0;
      platform.scale.set(k, 1, k);
      bumpers.forEach((m, j) => { m.visible = snap.bm[j] === '1'; });
      snap.s.forEach((s, i) => {
        const g = saucers[i]; if (!g) return;
        const [x, y] = pos(i, now);
        const out = s[6] === 2, falling = s[6] === 1;
        g.visible = !out;
        g.position.set(x, falling ? Math.max(-30, g.position.y - 0.35) : 0.35 + 0.08 * Math.sin(now / 300 + i), y);
        g.rotation.y += 0.02;
        g.rotation.z = falling ? g.rotation.z + 0.05 : Math.max(-0.35, Math.min(0.35, -s[2] * 0.04));
        g.rotation.x = falling ? g.rotation.x : Math.max(-0.35, Math.min(0.35, s[3] * 0.04));
        g.userData.glow.visible = !!s[4];
      });
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose };
  }

  // ---------- flat fallback (no WebGL)
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      const W = canvas.width, R0 = S.sumo.R0, k = W / (2.3 * R0), c = W / 2;
      g.fillStyle = '#05040d'; g.fillRect(0, 0, W, W);
      g.fillStyle = '#3a3358'; g.beginPath(); g.arc(c, c, snap.R * k, 0, 7); g.fill();
      const nb = snap.bm.length;
      g.lineWidth = 0.4 * k; g.strokeStyle = '#8ecae6';
      for (let j = 0; j < nb; j++) {
        if (snap.bm[j] !== '1') continue;
        g.beginPath(); g.arc(c, c, snap.R * k, (j / nb) * 6.283 + 0.03, ((j + 1) / nb) * 6.283 - 0.03); g.stroke();
      }
      snap.s.forEach((s, i) => {
        if (s[6] === 2) return;
        const [x, y] = pos(i, now), r = S.sumo.saucer * k * (s[6] === 1 ? 0.6 : 1);
        g.fillStyle = colorOf(i); g.strokeStyle = i === S.sumo.me ? '#fff' : '#000a'; g.lineWidth = r * 0.2;
        g.beginPath(); g.arc(c + x * k, c + y * k, r, 0, 7); g.fill(); g.stroke();
        if (s[4]) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(c + x * k, c + y * k, r * 1.35, 0, 7); g.stroke(); }
      });
    }
    resize();
    return { draw, resize, dispose() {} };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🪐 Round ${s.sumo.round} — first to ${s.sumo.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.sumo.stage === 'play' && s.sumo.me != null && !s.sumo.s[s.sumo.me][6];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
