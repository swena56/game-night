// Hover Rally: the track in 3D with a chase camera behind your craft (three.js), or top-down 2D.
// Craft are (s, d): distance along the track and sideways offset (left is +d); positions glide
// between server updates using each craft's speed. Hold the left/right half of the screen to steer.
UI.rally = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let crafts = [], gotAt = 0, steerNow = 0, keys = new Set(), touch = null, countdownAt = 0, trackKey = '';
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    gl = null; flat = null; crafts = []; steerNow = 0; keys = new Set(); touch = null; trackKey = '';
    main.innerHTML = `<div class="ra"><div class="ra-hud"><span id="raLap"></span><b id="raPlace"></b><span id="raSpeed"></span></div>
      <div class="ra-stage" id="raStage"><div class="lr-banner" id="raBanner" hidden></div>
        <div class="ra-half left">◀</div><div class="ra-half right">▶</div></div>
      <div class="sm-bar"><span class="hint">Hold a side to steer · swipe up to boost</span><button id="raBoost" class="primary">⚡ Boost</button></div></div>`;
    side.innerHTML = '<div class="panel"><div id="raOrder"></div></div>';
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
    const ready = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    });
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); trackKey = ''; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
  }

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

  function fast(d) { if (S?.rally) take(d.c, d.st); }

  function take(list, stage) {
    crafts = list.map((x) => x.slice());
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
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.rally) return;
    const r = S.rally, key = `${r.length}`;
    if (key !== trackKey && (gl || flat)) { trackKey = key; (gl || flat).build(); }
    (gl || flat)?.draw(now);
    const mine = r.me != null ? crafts[r.me] : null;
    $('raSpeed').textContent = mine ? `${Math.round(mine[2] * 10)} km/h${mine[3] ? ' ⚡' : ''}` : '';
    const cd = (countdownAt - now) / 1000;
    const text = S.phase === 'playing' && r.stage === 'countdown' ? (cd > 0 ? String(Math.ceil(cd)) : 'GO!') : mine?.[6] && S.phase === 'playing' ? '🏁 Finished!' : '';
    $('raBanner').hidden = !text; $('raBanner').textContent = text;
  }

  // ---------- three.js: course (x, y) → world (x, 0, -y)
  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); } catch { return null; }
    if (!renderer.getContext()) { renderer.dispose(); return null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x070512); scene.fog = new T.Fog(0x070512, 40, 140);
    const camera = new T.PerspectiveCamera(65, 1, 0.1, 400);
    scene.add(new T.HemisphereLight(0xbfd9ff, 0x221133, 0.8));
    const grid = new T.GridHelper(260, 52, 0x3a2a6a, 0x1c1438); grid.position.y = -0.05; scene.add(grid);
    let track = new T.Group(); scene.add(track);
    const ships = [];
    const V = (p, h = 0) => new T.Vector3(p.x, h, -p.y);
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
        const pad = new T.Mesh(new T.PlaneGeometry(2, 1.6), new T.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, side: T.DoubleSide }));
        pad.position.copy(V(p, 0.03)); pad.rotation.x = -Math.PI / 2; pad.rotation.z = Math.atan2(p.uy, p.ux); track.add(pad);
      }
      resize();
    }
    function ensureShips() {
      while (ships.length < S.rally.seats.length) {
        const i = ships.length, g = new T.Group();
        const body = new T.Mesh(new T.BoxGeometry(1.4, 0.35, 0.9), new T.MeshStandardMaterial({ color: new T.Color(colorOf(i)), metalness: 0.4, roughness: 0.4, emissive: new T.Color(colorOf(i)), emissiveIntensity: 0.15 }));
        const fin = new T.Mesh(new T.ConeGeometry(0.3, 0.6, 4), new T.MeshStandardMaterial({ color: 0xffffff }));
        fin.rotation.z = -Math.PI / 2; fin.position.x = 0.8;
        g.add(body, fin); g.userData.body = body;
        scene.add(g); ships.push(g);
      }
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    function draw(now) {
      ensureShips();
      const r = S.rally;
      ships.forEach((g, i) => {
        const c = crafts[i]; if (!c) return;
        const p = at(sNow(i, now), c[1]);
        g.position.copy(V(p, 0.45 + 0.06 * Math.sin(now / 200 + i)));
        g.rotation.y = Math.atan2(p.uy, p.ux);
        g.userData.body.material.emissiveIntensity = c[3] ? 0.9 : 0.15;
      });
      if (r.me != null && crafts[r.me]) {  // chase camera
        const p = at(sNow(r.me, now), crafts[r.me][1]);
        camera.position.set(p.x - p.ux * 7, 3.6, -(p.y - p.uy * 7));
        camera.lookAt(p.x + p.ux * 6, 0.5, -(p.y + p.uy * 6));
      } else {
        camera.position.set(0, 95, 55); camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    return { build, draw, resize, dispose };
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

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
