// Light Riders: the server simulates the grid; this module keeps a local copy of every trail (full
// views replace it, fast updates append recent cells), draws it in 3D (three.js) or 2D, and sends
// turns. Bikes glide between server ticks so motion looks smooth at any tick rate.
UI.riders = (() => {
  let S, ctx, trails = [], live = [], heads = [], lastTick = 0, tickAt = 0, round = 0;
  let gl = null, flat = null, raf = 0, ro = null, keyHandler = null, swipe = null;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; trails = []; live = []; heads = []; round = 0; gl = null; flat = null;
    main.innerHTML = `<div class="lr"><div class="lr-stage" id="lrStage"><div class="lr-banner" id="lrBanner" hidden></div></div>
      <div class="lr-pad" id="lrPad">
        <span></span><button data-d="0">▲</button><span></span>
        <button data-d="3">◀</button><button id="lrBoost" class="primary">⚡</button><button data-d="1">▶</button>
        <span></span><button data-d="2">▼</button><span></span></div></div>`;
    side.innerHTML = `<div class="panel"><div id="lrRiders"></div>
      <p class="hint left">Swipe on the arena, use the arrows, or the keyboard (arrows / WASD, Space to boost).</p></div>`;
    for (const b of $('lrPad').querySelectorAll('button[data-d]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); steer(+b.dataset.d); });
    $('lrBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boost(); });
    const stage = $('lrStage');
    // The whole game area ignores browser panning, so a swipe that strays off the arena can't scroll
    // the page; the pointer is captured so the swipe keeps steering wherever the finger goes.
    main.querySelector('.lr').style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      swipe = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      // about 6% of the arena's width: small enough for a phone, not twitchy on a tablet
      if (Math.hypot(dx, dy) < Math.max(18, Math.min(48, stage.clientWidth * 0.06))) return;
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe = { x: e.clientX, y: e.clientY };  // keep swiping in the same gesture
    });
    for (const t of ['pointerup', 'pointercancel']) stage.addEventListener(t, () => { swipe = null; });
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      const k = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[e.code];
      if (k != null) { e.preventDefault(); steer(k); } else if (e.code === 'Space') { e.preventDefault(); boost(); }
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
    gl?.dispose(); gl = null; flat = null;
  }

  const mine = () => S?.riders?.me;
  function steer(d) { if (mine() != null && S.phase === 'playing') { buzz(10); ctx.input({ dir: d }, true); } }
  function boost() { if (mine() != null && S.phase === 'playing') ctx.input({ boost: true }, true); }
  const colorOf = (i) => ctx.player(S.riders.seats[i])?.color ?? '#888';

  // ---------- state: full views replace the trails, fast updates append the newest cells
  function render(s, c) {
    S = s; ctx = c;
    const r = s.riders;
    const fresh = r.round !== round;
    round = r.round;
    trails = r.trails.map((t) => [...t]);
    live = r.alive.map((a, i) => ({ alive: a, dir: r.dirs[i], boosts: r.boosts[i], boosting: false }));
    lastTick = r.tick; tickAt = performance.now();
    if (fresh) (gl || flat)?.reset(); else (gl || flat)?.sync();
    S.countdownAt = performance.now() + r.countdown * 1000;
    renderSide();
  }

  function fast(data) {
    if (!S || data.k < lastTick) return;  // a new round starts with a full view
    data.p.forEach(([len, alive, dir, boosts, boosting, ...tail], i) => {
      const t = trails[i]; if (!t) return;
      for (let idx = Math.max(t.length, len - tail.length); idx < len; idx++) t.push(tail[idx - (len - tail.length)]);
      const wasAlive = live[i]?.alive;
      live[i] = { alive: !!alive, dir, boosts, boosting: !!boosting };
      if (wasAlive && !alive) { (gl || flat)?.crash?.(i); if (i === mine()) buzz([80, 50, 160]); }
    });
    if (data.k !== lastTick) { lastTick = data.k; tickAt = performance.now(); }
    S.riders.stage = data.st;
    (gl || flat)?.sync();
    renderSide();
  }

  function renderSide() {
    const r = S.riders, box = $('lrRiders'); if (!box) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}`));
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row lr-row' + (live[i]?.alive ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i); dot.style.boxShadow = `0 0 8px ${colorOf(i)}`;
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${live[i]?.alive ? '' : ' 💥'}`),
        ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
    });
    const b = $('lrBoost');
    const me = r.me != null ? live[r.me] : null;
    b.textContent = me ? `⚡${me.boosts}` : '⚡';
    b.disabled = !me || !me.alive || !me.boosts || r.stage !== 'ride';
    $('lrPad').hidden = r.me == null;
  }

  // where a rider's bike is drawn: past its last cell by the fraction of a tick that has elapsed
  function headPos(i, now) {
    const t = trails[i]; if (!t?.length) return null;
    const n = S.riders.n, c = t[t.length - 1], x = c % n, y = Math.floor(c / n);
    const L = live[i];
    if (!L?.alive || S.riders.stage !== 'ride') return [x, y];
    const per = 1000 / S.riders.speed;
    const f = Math.min(0.85, ((now - tickAt) / per) * (L.boosting ? 2 : 1));
    const [dx, dy] = DIRS[L.dir];
    return [x + dx * f, y + dy * f];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.riders) return;
    (gl || flat)?.draw(now);
    const r = S.riders, banner = $('lrBanner');
    const left = ((S.countdownAt ?? 0) - now) / 1000;
    let text = '';
    if (S.phase === 'playing' && r.stage === 'countdown') text = left > 0 ? String(Math.ceil(left)) : 'GO!';
    else if (S.phase === 'playing' && r.stage === 'over') text = 'Round over';
    else if (S.phase === 'playing' && r.me != null && live[r.me] && !live[r.me].alive) text = '💥 Crashed — watching';
    banner.hidden = !text; banner.textContent = text;
  }

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
    const scene = new T.Scene(); scene.background = new T.Color(0x05060f); scene.fog = new T.Fog(0x05060f, 60, 160);
    const camera = new T.PerspectiveCamera(45, 1, 0.5, 400);
    scene.add(new T.AmbientLight(0xffffff, 0.35));
    const sun = new T.DirectionalLight(0xffffff, 0.5); sun.position.set(-20, 60, 30); scene.add(sun);
    let n = 0, world = null, ribbons = [], bikes = [], tips = [], drawn = [];
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
      for (const [w, d, x, z] of [[n + 1, 0.5, 0, -half - 0.25], [n + 1, 0.5, 0, half + 0.25], [0.5, n + 1, -half - 0.25, 0], [0.5, n + 1, half + 0.25, 0]]) {
        const m = new T.Mesh(new T.BoxGeometry(w, 1.2, d), wallMat); m.position.set(x, 0.6, z); world.add(m);
      }
      ribbons = []; bikes = []; tips = []; drawn = [];
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
        world.add(bike); bikes.push(bike); drawn.push(0);
      });
      resize();
    }
    const at = (c) => [(c % n) - n / 2 + 0.5, Math.floor(c / n) - n / 2 + 0.5];
    const mtx = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
    function segment(a, b, setMatrix) {  // a thin glowing wall from point a to point b (x, z)
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) + 0.18;
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      v.set((a[0] + b[0]) / 2, 0.45, (a[1] + b[1]) / 2); sc.set(0.18, 0.9, len);
      mtx.compose(v, q, sc);
      setMatrix(mtx);
    }
    function sync() {
      if (!world || S.riders.n !== n || ribbons.length !== trails.length) return build();
      trails.forEach((t, i) => {
        const inst = ribbons[i];
        if (t.length < drawn[i]) drawn[i] = 0;
        for (let k = Math.max(1, drawn[i]); k < t.length; k++) segment(at(t[k - 1]), at(t[k]), (m) => inst.setMatrixAt(k - 1, m));
        inst.count = Math.max(0, t.length - 1);
        inst.instanceMatrix.needsUpdate = true;
        inst.material.opacity = live[i]?.alive ? 0.9 : 0.3;
        drawn[i] = t.length;
      });
    }
    function reset() { build(); drawn = drawn.map(() => 0); sync(); }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // fit the whole arena: move the camera back until all four corners are on screen
      const half = (n || 40) / 2 + 1;
      let dist = half * 1.6;
      for (let k = 0; k < 30; k++) {
        camera.position.set(0, dist * 0.82, dist * 0.62); camera.lookAt(0, 0, half * 0.08); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const fits = [[-half, -half], [half, -half], [-half, half], [half, half]].every(([x, z]) => {
          const p = new T.Vector3(x, 0, z).project(camera); return Math.abs(p.x) < 0.96 && Math.abs(p.y) < 0.94;
        });
        if (fits) break;
        dist *= 1.08;
      }
      base.copy(camera.position);
    }
    // 💥 a crash: sparks in the rider's colour, a shockwave ring, and a shake when it's you
    const base = new T.Vector3(), booms = [];
    let lastDraw = 0;
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
      const ring = new T.Mesh(new T.RingGeometry(0.6, 0.9, 40), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(bike.position.x, 0.05, bike.position.z);
      world.add(pts, ring);
      booms.push({ pts, ring, vel, t: 0 });
      if (i === S.riders.me) GL3.shake(camera, 1.1);
    }
    function tickBooms(dt) {
      for (const b of booms) {
        b.t += dt;
        const a = b.pts.geometry.attributes.position;
        for (let k = 0; k < b.vel.length; k++) {
          const v = b.vel[k]; v[1] -= 18 * dt;
          a.array[k * 3] += v[0] * dt; a.array[k * 3 + 1] = Math.max(0.05, a.array[k * 3 + 1] + v[1] * dt); a.array[k * 3 + 2] += v[2] * dt;
          if (a.array[k * 3 + 1] <= 0.05) { v[0] *= 0.8; v[2] *= 0.8; v[1] = Math.abs(v[1]) * 0.3; }
        }
        a.needsUpdate = true;
        b.pts.material.opacity = Math.max(0, 1 - b.t / 1.4);
        b.ring.scale.setScalar(1 + b.t * 9); b.ring.material.opacity = Math.max(0, 0.9 - b.t * 1.5);
      }
      while (booms.length && booms[0].t > 1.4) {
        const b = booms.shift(); world?.remove(b.pts, b.ring);
        b.pts.geometry.dispose(); b.pts.material.dispose(); b.ring.geometry.dispose(); b.ring.material.dispose();
      }
    }
    function draw(now) {
      if (!world) return;
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      tickBooms(dt);
      camera.position.copy(base); GL3.tickShake(camera, dt);
      trails.forEach((t, i) => {
        const pos = headPos(i, now), bike = bikes[i], tip = tips[i];
        if (!pos) { bike.visible = tip.visible = false; return; }
        const p = [pos[0] - n / 2 + 0.5, pos[1] - n / 2 + 0.5];
        bike.visible = !!live[i]?.alive;
        bike.position.set(p[0], 0, p[1]);
        const [dx, dy] = DIRS[live[i]?.dir ?? 0];
        bike.rotation.y = Math.atan2(dx, dy);
        tip.visible = bike.visible && t.length > 0;
        if (tip.visible) segment(at(t[t.length - 1]), p, (m) => { tip.matrixAutoUpdate = false; tip.matrix.copy(m); });
      });
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    if (S) build();
    return { sync, reset, resize, draw, dispose, crash };
  }

  // ---------- flat fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let cell = 8;
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
      });
      g.strokeStyle = '#8ecae6'; g.lineWidth = 3; g.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }
    resize();
    return { sync() {}, reset: resize, resize, draw };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🏍️ Round ${s.riders.round} — first to ${s.riders.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.riders.stage === 'ride' && s.riders.me != null && s.riders.alive[s.riders.me];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
