// Spire Siege: the tower runs here, in the browser. The server only routes attacks
// (S.spire.events) and shows everyone's boards. Rendering uses three.js (loaded on demand
// from /vendor), with a flat 2D fallback if WebGL isn't available.
UI.spire = (() => {
  const SHAPES = {
    a: [[0, 0], [1, 0]], b: [[0, 0], [1, 0], [2, 0]], c: [[0, 0], [1, 0], [0, 1]],
    d: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], e: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    f: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]], g: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
    // the 4-block set
    h: [[0, 0], [1, 0], [2, 0], [3, 0]], i: [[0, 0], [1, 0], [0, 1], [1, 1]], k: [[0, 0], [1, 0], [2, 0], [1, 1]],
    l: [[0, 0], [1, 0], [1, 1], [2, 1]], m: [[1, 0], [2, 0], [0, 1], [1, 1]], n: [[0, 0], [1, 0], [2, 0], [0, 1]],
    o: [[0, 0], [1, 0], [2, 0], [2, 1]],
  };
  const COLORS = { a: '#ff6b6b', b: '#4dabf7', c: '#51cf66', d: '#fcc419', e: '#cc5de8', f: '#ff922b', g: '#20c997',
    h: '#4dd4f7', i: '#ffd43b', k: '#b197fc', l: '#69db7c', m: '#ff6b6b', n: '#5c7cfa', o: '#ffa94d',
    j: '#5c6170', 1: '#fff3a0', 2: '#a5f3ff', 3: '#ff5c8a' };
  const POWER = { 1: 'surge', 2: 'shield', 3: 'blast' };
  const POWER_ICON = { surge: '⚡', shield: '🛡️', blast: '💣' };
  const $ = (id) => document.getElementById(id);

  let S, ctx, st = null, gfx = null, raf = 0, keyHandler = null, resizeObs = null, repeat = null;
  let W = 12, H = 18, BUF = 5;

  // ---------- rules (mirrors games/spire.py)
  const mod = (a, n) => ((a % n) + n) % n;
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const emptyRow = () => Array(W).fill(null);
  const flat = () => !!S?.spire?.flat;  // a flat well has side walls instead of wrapping around
  function fits(cells, x, y) {
    return cells.every(([dx, dy]) => {
      const yy = y + dy;
      if (flat() && (x + dx < 0 || x + dx >= W)) return false;
      return yy >= 0 && yy < H + BUF && !st.grid[yy][mod(x + dx, W)];
    });
  }
  function norm(cells) {
    const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - mx, y - my]);
  }
  function drawKind() {
    if (!st.bag.length) {
      st.bag = [...(S.spire.pieces || 'abcdefg')];
      for (let i = st.bag.length - 1; i > 0; i--) { const j = Math.floor(st.rng() * (i + 1)); [st.bag[i], st.bag[j]] = [st.bag[j], st.bag[i]]; }
    }
    const kind = st.bag.pop();
    const power = S.spire.powers && st.rng() < 1 / 8
      ? { at: Math.floor(st.rng() * SHAPES[kind].length), ch: String(1 + Math.floor(st.rng() * 3)) } : null;
    return { kind, power };
  }

  function newState(sp) {
    W = sp.W; H = sp.H; BUF = sp.buffer;
    const grid = Array.from({ length: H + BUF }, emptyRow);
    const mine = sp.boards[S.me.id];
    if (mine) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = mine.rows[y * W + x]; grid[y][x] = ch === '.' ? null : ch;
    }
    const key = `spire.applied.${S.code}.${sp.seed}`;
    let applied = 0;
    try { applied = +sessionStorage.getItem(key) || 0; } catch {}
    st = {
      grid, rng: mulberry32(sp.seed + (mine ? mine.rings * 7919 : 0)), bag: [], piece: null, next: null, held: null, canHold: true,
      x: 0, y: 0, cells: null, fallAt: 0, lockAt: null, combo: 0, shield: mine?.shield || 0, surgeUntil: 0,
      applied, appliedKey: key, dead: !sp.playing, lastPush: 0, pushed: mine?.rows ?? '', angle: 0,
      start: performance.now() + sp.startIn * 1000 - sp.elapsed * 1000, shake: 0, dirty: true,
    };
    st.next = drawKind();
    if (!st.dead) spawn();
  }

  function spawn(from = null) {
    const { kind, power } = from || st.next;
    if (!from) { st.next = drawKind(); st.canHold = true; }
    st.piece = { kind, power };
    st.cells = SHAPES[kind].map((c) => [...c]);
    st.y = H;
    if (flat()) st.x = Math.floor((W - 1 - Math.max(...st.cells.map((c) => c[0]))) / 2);
    if (!fits(st.cells, st.x, st.y)) return die();
    st.fallAt = performance.now() + interval();
    st.lockAt = null;
    renderNext();
  }

  // Hold parks the falling piece (power cell and all) and brings back the held one, or the next piece.
  // Once per piece, so it can't be used to stall.
  function hold() {
    if (!active() || !st.canHold) return;
    const parked = st.piece, back = st.held;
    st.held = parked;
    if (back) spawn(back); else spawn();
    st.canHold = false;
  }

  function level() { return Math.max(0, Math.floor((performance.now() - st.start) / 30000)); }
  function interval() {
    let ms = S.spire.speed * 1000 * 0.85 ** level();
    if (performance.now() < st.surgeUntil) ms *= 0.5;
    return Math.max(60, ms);
  }

  function move(dx) {
    if (!active()) return;
    if (fits(st.cells, st.x + dx, st.y)) { st.x = mod(st.x + dx, W); groundedReset(); }
  }
  function rotate(dir) {
    if (!active()) return;
    const turned = norm(st.cells.map(([x, y]) => (dir > 0 ? [y, -x] : [-y, x])));
    for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [0, 1], [-2, 0], [2, 0]]) {
      if (fits(turned, st.x + kx, st.y + ky)) { st.cells = turned; st.x = mod(st.x + kx, W); st.y += ky; groundedReset(); return; }
    }
  }
  function groundedReset() { if (st.lockAt) st.lockAt = performance.now() + 450; }
  function soft() { if (active() && fits(st.cells, st.x, st.y - 1)) { st.y--; st.fallAt = performance.now() + interval(); } }
  function hard() {
    if (!active()) return;
    while (fits(st.cells, st.x, st.y - 1)) st.y--;
    lock();
  }
  const active = () => st && !st.dead && st.piece && performance.now() >= st.start && S.phase === 'playing';

  function lock() {
    const { kind, power } = st.piece;
    st.cells.forEach(([dx, dy], i) => { st.grid[st.y + dy][mod(st.x + dx, W)] = power && power.at === i ? power.ch : kind; });
    st.piece = null;
    const full = [];
    for (let y = 0; y < H + BUF; y++) if (st.grid[y].every(Boolean)) full.push(y);
    const powers = full.flatMap((y) => st.grid[y].filter((c) => POWER[c]).map((c) => POWER[c]));
    for (const y of full.reverse()) { st.grid.splice(y, 1); st.grid.push(emptyRow()); }
    st.combo = full.length ? st.combo + 1 : 0;
    if (powers.includes('shield')) st.shield++;
    if (powers.includes('blast')) { st.grid.splice(0, 2); st.grid.push(emptyRow(), emptyRow()); }
    if (full.length) {
      flash(full.length >= 3 ? 'big' : 'small', full.length, st.combo);
      if (powers.length) ctx.toast(powers.map((p) => `${POWER_ICON[p]} ${p}!`).join(' '));
      ctx.quiet(ctx.act('clear', { rings: full.length, combo: st.combo, powers }));
    }
    st.dirty = true;
    if (st.grid.slice(H).some((row) => row.some(Boolean))) return die();
    push(true);
    spawn();
  }

  function addJunk(n) {
    const gap = Math.floor(Math.random() * W);
    for (let i = 0; i < n; i++) {
      st.grid.unshift(Array.from({ length: W }, (_, x) => (x === gap ? null : 'j')));
      if (st.grid.pop().some(Boolean)) return die();
    }
    if (st.piece) { st.y += n; while (!fits(st.cells, st.x, st.y) && st.y < H + BUF) st.y++; }
    st.shake = performance.now() + 350;
    st.dirty = true;
    push(true);
  }

  function die() {
    if (st.dead) return;
    st.dead = true; st.piece = null;
    push(true);
    ctx.quiet(ctx.act('topout'));
  }

  function rowsString() {
    let s = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += st.grid[y][x] || '.';
    return s;
  }
  function push(force) {
    const now = performance.now();
    if (!force && now - st.lastPush < 350) return;
    const rows = rowsString();
    if (rows === st.pushed && !force) return;
    st.lastPush = now; st.pushed = rows;
    ctx.quiet(ctx.act('board', { rows, shield: st.shield }));
  }

  function applyEvents(events) {
    for (const ev of events) {
      if (ev.id <= st.applied) continue;
      st.applied = ev.id;
      if (ev.kind === 'junk') {
        if (st.shield > 0) { st.shield--; ctx.toast(`🛡️ Shield blocked ${ev.n} junk from ${ev.from}!`); push(true); }
        else { addJunk(ev.n); ctx.toast(`🧱 ${ev.from} sent you ${ev.n} junk!`); }
      } else if (ev.kind === 'surge') {
        st.surgeUntil = performance.now() + ev.secs * 1000;
        ctx.toast(`⚡ ${ev.from}'s surge — you're falling faster!`);
      }
    }
    try { sessionStorage.setItem(st.appliedKey, st.applied); } catch {}
  }

  // ---------- loop
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!st) return;
    const count = $('spCount');
    const left = st.start - now;
    count.textContent = S.phase === 'playing' && left > 0 ? Math.ceil(left / 1000) : left > -700 && S.phase === 'playing' ? 'GO!' : '';
    if (active()) {
      if (now >= st.fallAt) {
        if (fits(st.cells, st.x, st.y - 1)) { st.y--; st.lockAt = null; }
        else if (!st.lockAt) st.lockAt = now + 450;
        st.fallAt = now + interval();
      }
      if (st.lockAt && now >= st.lockAt) {
        if (fits(st.cells, st.x, st.y - 1)) st.lockAt = null; else lock();
      }
      push(false);
    }
    gfx ? draw3d(now) : draw2d();
  }

  // ---------- three.js scene
  function initThree() {
    const T = window.THREE;
    const stage = $('spStage');
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    stage.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.1, 200);
    scene.add(new T.AmbientLight(0xffffff, 0.55));
    const sun = new T.DirectionalLight(0xffffff, 0.85); sun.position.set(6, 30, 20); scene.add(sun);
    const rim = new T.PointLight(0x8e7dff, 0.8, 80); rim.position.set(-12, 10, -10); scene.add(rim);
    const R = W / (2 * Math.PI) + 0.45, arc = (2 * Math.PI * R) / W;
    const tower = new T.Group(); scene.add(tower);
    const core = new T.Mesh(new T.CylinderGeometry(R - 0.5, R - 0.5, H + 0.2, 48, 1, true),
      new T.MeshStandardMaterial({ color: 0x1b1530, emissive: 0x120c26, side: T.DoubleSide, roughness: 0.9 }));
    core.position.y = H / 2; tower.add(core);
    const base = new T.Mesh(new T.CylinderGeometry(R + 0.8, R + 1.2, 0.5, 48), new T.MeshStandardMaterial({ color: 0x2c2540 }));
    base.position.y = -0.25; tower.add(base);
    const danger = new T.Mesh(new T.TorusGeometry(R + 0.55, 0.05, 8, 64), new T.MeshBasicMaterial({ color: 0xef476f }));
    danger.rotation.x = Math.PI / 2; danger.position.y = H; tower.add(danger);
    const geo = new T.BoxGeometry(arc * 0.92, 0.92, 0.9);
    const make = (n, mat) => { const m = new T.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(T.DynamicDrawUsage); tower.add(m); return m; };
    const settled = make(W * (H + BUF), new T.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }));
    const piece = make(5, new T.MeshStandardMaterial({ roughness: 0.25, emissive: 0x222222 }));
    const ghost = make(5, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    // Create the per-instance colour buffers before the first frame so the shaders include them.
    for (const m of [settled, piece]) { m.setColorAt(0, new T.Color(0xffffff)); m.count = 0; }
    const stars = new T.Points(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(
      Array.from({ length: 900 }, () => (Math.random() - 0.5) * 160), 3)), new T.PointsMaterial({ color: 0x9a8fd8, size: 0.25 }));
    scene.add(stars);
    gfx = { T, renderer, scene, camera, tower, settled, piece, ghost, R, dummy: new T.Object3D(), color: new T.Color(), stars };
    resize();
  }

  function place(mesh, i, x, y, colorHex) {
    const { dummy, R, color } = gfx;
    const a = (x / W) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * R, y + 0.5, Math.cos(a) * R);
    dummy.rotation.set(0, a, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (colorHex) mesh.setColorAt(i, color.set(colorHex));
  }

  function draw3d(now) {
    const g = gfx;
    if (st.dirty) {
      let i = 0;
      for (let y = 0; y < H + BUF; y++) for (let x = 0; x < W; x++) {
        const c = st.grid[y][x];
        if (c) place(g.settled, i++, x, y, COLORS[c]);
      }
      g.settled.count = i;
      g.settled.instanceMatrix.needsUpdate = true;
      if (g.settled.instanceColor) g.settled.instanceColor.needsUpdate = true;
      st.dirty = false;
    }
    if (st.piece) {
      const gy = landing();
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      st.cells.forEach(([dx, dy], i) => {
        const power = st.piece.power && st.piece.power.at === i;
        place(g.piece, i, st.x + dx, st.y + dy, power ? (pulse > 0.5 ? '#ffffff' : COLORS[st.piece.power.ch]) : COLORS[st.piece.kind]);
        place(g.ghost, i, st.x + dx, gy + dy);
      });
      g.piece.count = g.ghost.count = st.cells.length;
      g.piece.instanceMatrix.needsUpdate = g.ghost.instanceMatrix.needsUpdate = true;
      if (g.piece.instanceColor) g.piece.instanceColor.needsUpdate = true;
      const cx = st.x + (Math.max(...st.cells.map((c) => c[0])) / 2);
      const target = -(cx / W) * Math.PI * 2;
      let diff = mod(target - g.tower.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
      g.tower.rotation.y += diff * 0.2;
    } else {
      g.piece.count = g.ghost.count = 0;
      if (st.dead) g.tower.rotation.y += 0.004;
    }
    const shake = now < st.shake ? (Math.random() - 0.5) * 0.5 : 0;
    g.camera.position.set(shake, H * 0.72, g.R + 19.5);
    g.camera.lookAt(0, H * 0.46, 0);
    g.stars.rotation.y += 0.0004;
    g.renderer.render(g.scene, g.camera);
  }

  function resize() {
    const stage = $('spStage');
    if (!stage) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (gfx) { gfx.renderer.setSize(w, h); gfx.camera.aspect = w / h; gfx.camera.updateProjectionMatrix(); }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const c = $('spFallback'); if (c) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  }

  // ---------- 2D fallback (and the flat well): the ring unrolled around the active piece. Two rows of
  // the spawn zone show above the top line, and an outline marks where the piece will land.
  function landing() {
    let gy = st.y;
    while (fits(st.cells, st.x, gy - 1)) gy--;
    return gy;
  }
  function draw2d() {
    const c = $('spFallback');
    const g = c?.getContext('2d');
    if (!g) return;
    const rows = H + 2, dpr = c.width / Math.max(1, c.clientWidth || c.width);
    const size = Math.floor(Math.min((c.width - 16 * dpr) / W, (c.height - 14 * dpr) / rows));
    const ox = Math.round((c.width - size * W) / 2), floor = c.height - 8 * dpr;
    const centre = st.piece && !flat() ? st.x : Math.floor(W / 2);
    const sx = (x) => ox + mod(x - centre + Math.floor(W / 2), W) * size, sy = (y) => floor - (y + 1) * size;
    const cellAt = (x, y, col) => { g.fillStyle = col; g.fillRect(sx(x) + 1, sy(y) + 1, size - 2, size - 2); };
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff08'; g.fillRect(ox, sy(H - 1), W * size, H * size);  // the well
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cellAt(x, y, st.grid[y][x] ? COLORS[st.grid[y][x]] : '#ffffff0a');
    g.fillStyle = '#8ecae677';  // the floor, and walls on a flat well
    g.fillRect(ox - 3 * dpr, floor, W * size + 6 * dpr, 3 * dpr);
    if (flat()) { g.fillRect(ox - 3 * dpr, sy(H - 1), 3 * dpr, H * size); g.fillRect(ox + W * size, sy(H - 1), 3 * dpr, H * size); }
    g.strokeStyle = '#ff6b6b88'; g.lineWidth = Math.max(1, dpr); g.setLineDash([6 * dpr, 5 * dpr]);  // the top: lock above it and you topple
    g.beginPath(); g.moveTo(ox, sy(H - 1)); g.lineTo(ox + W * size, sy(H - 1)); g.stroke(); g.setLineDash([]);
    if (!st.piece) return;
    const col = COLORS[st.piece.kind], gy = landing();
    if (gy !== st.y) {
      g.strokeStyle = col; g.lineWidth = Math.max(2, 2 * dpr); g.globalAlpha = 0.85;
      st.cells.forEach(([dx, dy]) => gy + dy < rows && g.strokeRect(sx(st.x + dx) + 2.5, sy(gy + dy) + 2.5, size - 5, size - 5));
      g.globalAlpha = 1;
    }
    st.cells.forEach(([dx, dy], i) => {
      if (st.y + dy >= rows) return;
      const power = st.piece.power && st.piece.power.at === i;
      cellAt(st.x + dx, st.y + dy, power ? COLORS[st.piece.power.ch] : col);
      if (power) {
        g.font = `${Math.round(size * 0.6)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(POWER_ICON[POWER[st.piece.power.ch]], sx(st.x + dx) + size / 2, sy(st.y + dy) + size / 2 + 1);
      }
    });
  }

  // ---------- side panel: next and held pieces + rivals' mini towers
  function drawMini(c, p, dim) {
    const g = c?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!p) return;
    const cells = SHAPES[p.kind], s = Math.min(14, (c.width - 12) / (1 + Math.max(...cells.flat())));
    g.globalAlpha = dim ? 0.35 : 1;
    cells.forEach(([x, y], i) => {
      g.fillStyle = p.power && p.power.at === i ? COLORS[p.power.ch] : COLORS[p.kind];
      g.fillRect(6 + x * s, c.height - 6 - (y + 1) * s, s - 2, s - 2);
    });
    g.globalAlpha = 1;
  }
  function renderNext() {
    if (!st) return;
    drawMini($('spNext'), st.next);
    drawMini($('spHold'), st.held, !st.canHold);
  }
  function renderRivals() {
    const box = $('spRivals'); box.innerHTML = '';
    for (const [pid, b] of Object.entries(S.spire.boards)) {
      const p = ctx.player(pid);
      const card = ctx.el('div', 'rival' + (b.alive ? '' : ' down') + (pid === S.me.id ? ' me' : ''));
      const cv = document.createElement('canvas'); cv.width = W * 5; cv.height = H * 5;
      const g = cv.getContext('2d');
      if (g) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = b.rows[y * W + x];
        if (ch !== '.') { g.fillStyle = COLORS[ch] || '#888'; g.fillRect(x * 5, (H - 1 - y) * 5, 4, 4); }
      }
      const label = ctx.el('div', '', `${p?.name ?? '?'}${b.alive ? '' : ' 💥'}`);
      label.style.color = p?.color ?? '';
      card.append(cv, label, ctx.el('small', '', `${b.rings} rings · ${b.sent} sent${b.shield ? ' · 🛡️' + b.shield : ''}`));
      box.append(card);
    }
  }

  // a ring clear: a flash, a named callout (bigger for more rings and for combos), a buzz, and a
  // shake of the stage for three rings or more
  function flash(kind, rings = 1, combo = 1) {
    const f = $('spFlash'); if (!f) return;
    f.className = 'sp-flash ' + kind;
    void f.offsetWidth; f.classList.add('on');
    const call = $('spCall');
    if (call) {
      call.textContent = (['', 'RING!', 'DOUBLE!', 'TRIPLE!', 'SPIRE!'][Math.min(rings, 4)] || 'SPIRE!') + (combo > 1 ? ` ×${combo}` : '');
      call.className = 'sp-call r' + Math.min(rings, 4);
      void call.offsetWidth; call.classList.add('on');
    }
    if (rings >= 3) { const stage = f.parentElement; stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
    buzz(rings >= 3 ? [40, 30, 80] : 25);
  }

  // ---------- input
  function input(k) {
    ({ left: () => move(-1), right: () => move(1), rot: () => rotate(1), rotl: () => rotate(-1), soft, drop: hard, hold })[k]?.();
  }

  function mount(main, side) {
    S = null;
    main.innerHTML = `<div class="spire-wrap">
      <div id="spStage" class="spire-stage"><canvas id="spFallback"></canvas>
        <div id="spCount" class="sp-count"></div><div id="spFlash" class="sp-flash"></div><div id="spCall" class="sp-call"></div><div id="spBanner" class="sp-banner" hidden></div></div>
      <div class="sp-pad"><button data-k="rotl">⟲</button><button data-k="left">◀</button><button data-k="drop">⤓</button>
        <button data-k="right">▶</button><button data-k="rot">⟳</button><button data-k="soft">▼</button><button data-k="hold" title="Hold">⇄</button></div></div>`;
    side.innerHTML = `<div class="panel">
      <div id="spStatus" class="seat-row"></div>
      <div class="sp-nextbox"><span class="hint">Next</span><canvas id="spNext" width="64" height="64"></canvas>
        <span class="hint">Hold</span><canvas id="spHold" width="64" height="64"></canvas></div>
      <div id="spRivals" class="sp-rivals"></div>
      <p class="hint left" id="spHint">⌨️ ← → move around the tower · ↑/X rotate · Z rotate back · ↓ soft drop · Space drop.<br>
      C / Shift hold.<br>📱 Swipe sideways to move, tap to rotate, swipe down to drop, swipe up to hold.</p></div>`;
    for (const b of main.querySelectorAll('.sp-pad button')) {
      const k = b.dataset.k;
      b.onpointerdown = (e) => {
        e.preventDefault(); input(k);
        clearInterval(repeat);
        if (['left', 'right', 'soft'].includes(k)) repeat = setInterval(() => input(k), 110);
      };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearInterval(repeat);
    }
    const stage = $('spStage');
    let start = null;
    stage.onpointerdown = (e) => { start = { x: e.clientX, y: e.clientY, moved: 0 }; };
    stage.onpointermove = (e) => {
      if (!start) return;
      const steps = Math.trunc((e.clientX - start.x) / 32) - start.moved;
      if (steps) { for (let i = 0; i < Math.abs(steps); i++) move(Math.sign(steps)); start.moved += steps; }
    };
    stage.onpointerup = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (dy > 60) hard(); else if (dy < -60 && !start.moved) hold(); else if (!start.moved && Math.abs(dy) < 15) rotate(1);
      start = null;
    };
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      const k = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rot', x: 'rot', X: 'rot', z: 'rotl', Z: 'rotl', ArrowDown: 'soft', ' ': 'drop', c: 'hold', C: 'hold', Shift: 'hold' }[e.key];
      if (k) { e.preventDefault(); input(k); }
    };
    addEventListener('keydown', keyHandler);
    resizeObs = new ResizeObserver(resize); resizeObs.observe(stage);
    const load = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = '/vendor/three.min.js'; s.onload = res; s.onerror = rej; document.head.append(s);
    });
    // render() runs before this promise settles, so S is current here; a flat well stays 2D
    load.then(() => { if (S?.spire?.flat) return resize(); initThree(); if (gfx) $('spFallback').hidden = true; resize(); })
      .catch(() => ctx?.toast('3D engine unavailable — using the flat view.'));
    raf = requestAnimationFrame(tick);
  }

  function unmount() {
    cancelAnimationFrame(raf);
    clearInterval(repeat);
    if (keyHandler) removeEventListener('keydown', keyHandler);
    resizeObs?.disconnect();
    if (gfx) { gfx.renderer.dispose(); gfx = null; }
    st = null;
  }

  function render(s, c) {
    S = s; ctx = c;
    const sp = S.spire;
    if (sp.flat) $('spHint').textContent = '⌨️ ← → move · ↑/X rotate · Z rotate back · ↓ soft drop · Space drop · C/Shift hold. 📱 Swipe sideways to move, tap to rotate, swipe down to drop, swipe up to hold.';
    if (!st || st.seed !== sp.seed) { newState(sp); st.seed = sp.seed; st.dirty = true; }
    if (sp.playing && !st.dead) applyEvents(sp.events);
    if (!sp.playing && !st.dead) st.dead = true;
    const lvl = level();
    const me = sp.boards[S.me.id];
    $('spStatus').textContent = me
      ? `Level ${lvl + 1} · ${me.rings} rings · 🛡️ ${st.shield}${performance.now() < st.surgeUntil ? ' · ⚡ surge!' : ''}`
      : '👁 Watching the battle';
    const banner = $('spBanner');
    banner.hidden = !(st.dead && me) && S.phase === 'playing';
    banner.textContent = S.phase === 'over' ? (S.winner === S.me.id ? '🏆 Last spire standing!' : '🏁 Battle over') : '💥 Your spire fell';
    renderRivals();
    renderNext();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : !s.spire.playing ? '🗼 Watching the battle'
    : s.spire.startIn > 0 ? '🗼 Get ready…' : '🗼 Build fast, clear rings!';

  return { mount, render, unmount, turnText, focus: true };
})();
