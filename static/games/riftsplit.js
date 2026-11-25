// Rift Split: grow walls to seal off bouncing orbs. three.js field (flat canvas fallback); the server owns the physics.
(() => {
  const MSG = {
    seal: 'Sealed!', big: 'Huge seal!', hit: 'Wall shattered · life lost', shield: 'Shield absorbed it',
    'shield+': 'Shield ready', slow: 'Orbs slowed', clear: 'Level clear!', over: 'Out of lives',
  };
  const SND = { seal: 'lock', big: 'cheer', hit: 'wrong', shield: 'lock', 'shield+': 'pop', slow: 'pop', clear: 'cheer', over: 'groan' };
  const COLORS = ['#3cf5e0', '#ff6fb5', '#ffd166', '#9d8bff', '#7dff8a', '#ff9a4d'];
  const bestKey = 'riftsplit.best';
  let g;

  const store = {
    get() { try { const v = Number(localStorage.getItem(bestKey)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; } },
    set(v) { try { localStorage.setItem(bestKey, String(v)); } catch { /* private mode */ } },
  };

  // ---------- shared geometry ----------
  // A wall: [vertical, cx, cy, len0, room0, st0, len1, room1, st1]. Returns board-space rects [x0, x1, y0, y1, state].
  function wallRects(w) {
    if (!w || !w.length) return [];
    const v = w[0], cx = w[1], cy = w[2], c = v ? cy : cx, out = [];
    for (let i = 0; i < 2; i++) {
      const len = w[3 + i * 3], st = w[5 + i * 3];
      if (!len || st === 'd') continue;
      const lo = i === 0 ? c + 1 - len : c + 1, hi = i === 0 ? c + 1 : c + 1 + len;
      out.push(v ? [cx, cx + 1, lo, hi, st] : [lo, hi, cy, cy + 1, st]);
    }
    return out;
  }
  const cellFree = (grid, x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H && grid[y * g.W + x] === '0';

  // ---------- flat renderer ----------
  function flatRenderer(stage) {
    const canvas = document.createElement('canvas');
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) { canvas.remove(); return null; }
    let size = [0, 0];
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        return { x: Math.floor((e.clientX - r.left) / r.width * g.W), y: Math.floor((e.clientY - r.top) / r.height * g.H) };
      },
      draw(s, now) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (size[0] !== w || size[1] !== h) { canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio; size = [w, h]; }
        const k = canvas.width / g.W;
        c.setTransform(k, 0, 0, k, 0, 0);
        c.fillStyle = '#080d22'; c.fillRect(0, 0, g.W, g.H);
        c.strokeStyle = '#1b2a55'; c.lineWidth = 0.03;
        for (let x = 0; x <= g.W; x++) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, g.H); c.stroke(); }
        for (let y = 0; y <= g.H; y++) { c.beginPath(); c.moveTo(0, y); c.lineTo(g.W, y); c.stroke(); }
        c.fillStyle = s.color;
        for (let i = 0; i < s.grid.length; i++) if (s.grid[i] === '1') c.fillRect(i % g.W + 0.04, Math.floor(i / g.W) + 0.04, 0.92, 0.92);
        for (const p of s.p) { c.font = '1px sans-serif'; c.fillText(p[2] === 'shield' ? '🛡️' : '⏳', p[0], p[1] + 0.85); }
        for (const [x0, x1, y0, y1, st] of wallRects(s.w)) { c.fillStyle = st === 'g' ? '#fff' : s.color; c.fillRect(x0, y0, x1 - x0, y1 - y0); }
        if (s.ghost) { c.fillStyle = '#ffffff30'; c.fillRect(...s.ghost); }
        c.fillStyle = '#fff';
        for (const b of s.b) { c.beginPath(); c.arc(b[0], b[1], 0.42, 0, 7); c.fill(); }
      },
      dispose() { canvas.remove(); },
    };
  }

  // ---------- three.js renderer ----------
  function threeRenderer(T, stage, onLost) {
    const renderer = GL3.renderer({}, { onLost });
    if (!renderer) return null;
    renderer.setClearColor(0x060a1c, 1);
    const canvas = renderer.domElement;
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(34, 1, 1, 200);
    const gx = (x) => x - g.W / 2, gy = (y) => g.H / 2 - y;
    scene.add(new T.AmbientLight(0x8899cc, 0.8));
    const sun = new T.DirectionalLight(0xffffff, 0.9); sun.position.set(-10, 14, 24); scene.add(sun);

    // Floor with a grid.
    const tex = document.createElement('canvas'); tex.width = 1024; tex.height = 614;
    const t = tex.getContext('2d');
    t.fillStyle = '#0a1230'; t.fillRect(0, 0, 1024, 614);
    t.strokeStyle = '#26407f'; t.lineWidth = 1.5;
    for (let i = 0; i <= g.W; i++) { t.beginPath(); t.moveTo(i * 1024 / g.W, 0); t.lineTo(i * 1024 / g.W, 614); t.stroke(); }
    for (let i = 0; i <= g.H; i++) { t.beginPath(); t.moveTo(0, i * 614 / g.H); t.lineTo(1024, i * 614 / g.H); t.stroke(); }
    const floor = new T.Mesh(new T.PlaneGeometry(g.W, g.H), new T.MeshBasicMaterial({ map: new T.CanvasTexture(tex) }));
    scene.add(floor);
    const frame = new T.Mesh(new T.BoxGeometry(g.W + 1, g.H + 1, 0.5), new T.MeshStandardMaterial({ color: 0x1a2650, roughness: 0.6 }));
    frame.position.z = -0.4; scene.add(frame);

    // Sealed cells: one instanced mesh; new cells rise up.
    const blocks = new T.InstancedMesh(new T.BoxGeometry(0.94, 0.94, 1), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2 }), g.W * g.H);
    blocks.count = 0; scene.add(blocks);
    const born = new Float32Array(g.W * g.H);
    let lastGrid = '0'.repeat(g.W * g.H), animUntil = 0;
    const dummy = new T.Object3D();

    const mats = {
      ball: new T.MeshBasicMaterial({ color: 0xffffff }),
      wall: new T.MeshBasicMaterial({ color: 0xffffff }),
      ghost: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
    };
    const balls = [];
    const halves = [0, 1].map(() => { const m = new T.Mesh(new T.BoxGeometry(1, 1, 0.9), mats.wall); m.visible = false; scene.add(m); return m; });
    const ghost = new T.Mesh(new T.BoxGeometry(1, 1, 0.3), mats.ghost); ghost.visible = false; scene.add(ghost);
    const pickMeshes = [];
    const sphere = new T.SphereGeometry(0.42, 20, 14), halo = new T.SphereGeometry(0.7, 12, 8);
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 0, 1), 0), hit = new T.Vector3();
    let w = 0, h = 0;

    function resize() {
      const cw = stage.clientWidth, ch = stage.clientHeight;
      if (cw === w && ch === h) return;
      w = cw; h = ch; renderer.setSize(w, h, false);
      cam.aspect = w / h;
      const need = Math.max((g.H / 2 + 1.2) / Math.tan(cam.fov * Math.PI / 360), (g.W / 2 + 1.2) / (Math.tan(cam.fov * Math.PI / 360) * cam.aspect));
      cam.position.set(0, -need * 0.22, need * 0.97); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
    }
    const box = (m, x0, x1, y0, y1, z) => {
      m.visible = true; m.scale.set(x1 - x0, y1 - y0, 0.9);
      m.position.set(gx((x0 + x1) / 2), gy((y0 + y1) / 2), z);
    };
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)), cam);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return { x: Math.floor(hit.x + g.W / 2), y: Math.floor(g.H / 2 - hit.y) };
      },
      draw(s, now) {
        resize();
        const col = new T.Color(s.color);
        mats.wall.color.copy(col); mats.ghost.color.copy(col);
        if (s.grid !== lastGrid) {
          for (let i = 0; i < s.grid.length; i++) if (s.grid[i] === '1' && lastGrid[i] !== '1') born[i] = now;
          lastGrid = s.grid; animUntil = now + 450;
        }
        if (now < animUntil + 60 || blocks.userData.col !== s.color) {
          let n = 0;
          for (let i = 0; i < s.grid.length; i++) {
            if (s.grid[i] !== '1') continue;
            const k = Math.min(1, (now - born[i]) / 350), z = 0.2 + 0.8 * (1 - (1 - k) ** 3);
            dummy.position.set(gx(i % g.W + 0.5), gy(Math.floor(i / g.W) + 0.5), z / 2 - 0.05);
            dummy.scale.set(1, 1, z); dummy.updateMatrix();
            blocks.setMatrixAt(n++, dummy.matrix);
          }
          blocks.count = n; blocks.instanceMatrix.needsUpdate = true;
          blocks.material.color.copy(col); blocks.userData.col = s.color;
        }
        while (balls.length < s.b.length) {
          const m = new T.Mesh(sphere, mats.ball), a = new T.Mesh(halo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
          m.add(a); scene.add(m); balls.push(m);
        }
        balls.forEach((m, i) => {
          m.visible = i < s.b.length;
          if (m.visible) m.position.set(gx(s.b[i][0]), gy(s.b[i][1]), 0.5);
        });
        const rects = wallRects(s.w);
        halves.forEach((m, i) => { m.visible = false; const r = rects[i]; if (r) box(m, r[0], r[1], r[2], r[3], 0.45); });
        if (s.ghost) box(ghost, s.ghost[0], s.ghost[0] + s.ghost[2], s.ghost[1], s.ghost[1] + s.ghost[3], 0.2); else ghost.visible = false;
        while (pickMeshes.length) { const m = pickMeshes.pop(); scene.remove(m); m.material.dispose(); }
        for (const p of s.p) {
          const m = new T.Mesh(new T.OctahedronGeometry(0.55), new T.MeshBasicMaterial({ color: p[2] === 'shield' ? 0x59ff9a : 0xffd84a }));
          m.position.set(gx(p[0] + 0.5), gy(p[1] + 0.5), 0.6); m.rotation.z = now / 400; m.rotation.x = 1;
          scene.add(m); pickMeshes.push(m);
        }
        renderer.render(scene, cam);
      },
      dispose() { renderer.dispose(); canvas.remove(); },
    };
  }

  // ---------- state ----------
  function receive(data) {
    if (!g || !data?.boards) return;
    if (data.tick < g.tick && data.rift === g.run) return;
    g.tick = data.tick; g.receivedAt = performance.now();
    Object.entries(data.boards).forEach(([pid, b], i) => {
      const prev = g.boards[pid] || (g.boards[pid] = { grid: '0'.repeat(g.W * g.H), color: COLORS[g.order.indexOf(pid) % 6] || COLORS[i % 6], b: [], bs: [], evSeen: b.ev[0], lv: b.lv });
      if (b.g) prev.grid = b.g;
      else if (b.rev !== prev.rev) prev.stale = true;
      prev.rev = b.rev;
      Object.assign(prev, { w: b.w, p: b.p, lives: b.lives, score: b.score, pct: b.pct, st: b.st, lv: b.lv, sh: b.sh, slow: b.slow, b: b.b });
      if (!prev.bs || prev.bs.length !== b.b.length) prev.bs = b.b.map((q) => q.slice());
      if (b.ev[0] !== prev.evSeen) {
        prev.evSeen = b.ev[0];
        if (pid === g.me && g.ctx && !g.ctx.readOnly) { g.ctx.sfx(SND[b.ev[1]] || 'pop'); g.msg(MSG[b.ev[1]] || ''); }
      }
    });
    paint();
  }

  function mine() { return g.boards[g.me] || g.boards[g.watch]; }

  function paint() {
    const s = mine();
    if (!s) return;
    g.find('score').textContent = s.score.toLocaleString();
    g.find('level').textContent = s.lv;
    g.find('lives').textContent = '❤️'.repeat(Math.max(0, s.lives)) + (s.sh ? '🛡️' : '');
    g.find('pct').textContent = Math.floor(s.pct * 100) + '%';
    g.find('fill').style.width = Math.min(100, s.pct * 100) + '%';
    g.find('slow').hidden = !(s.slow > 0);
    if (s.slow > 0) g.find('slow').textContent = '⏳ ' + Math.ceil(s.slow);
    if (g.me && s.score > g.best && g.solo) { g.best = s.score; store.set(g.best); }
    g.find('best').textContent = g.best ? g.best.toLocaleString() : '—';
    const list = g.find('standings');
    list.hidden = Object.keys(g.boards).length < 2;
    if (!list.hidden) {
      list.replaceChildren(...Object.entries(g.boards).sort((a, b) => b[1].score - a[1].score).map(([pid, b]) => {
        const li = document.createElement('li');
        li.style.setProperty('--rs-c', b.color);
        li.textContent = `${g.ctx.player(pid)?.name || '?'} · Lv ${b.lv} · ${Math.floor(b.pct * 100)}% · ${b.score.toLocaleString()}${b.st === 'over' ? ' ✖' : ''}`;
        if (pid === g.me) li.className = 'rs-me';
        return li;
      }));
    }
  }

  function place(cell, vertical) {
    const s = g.boards[g.me];
    if (!cell || !s || !g.enabled || s.st !== 'play' || s.w.length) return;
    if (!cellFree(s.grid, cell.x, cell.y)) return;
    g.ctx.input({ x: cell.x, y: cell.y, v: vertical });
    g.ctx.sfx('pop');
  }

  function ghostFor(cell) {
    const s = mine();
    if (!cell || !s || s.st !== 'play' || s.w.length || !g.enabled || !cellFree(s.grid, cell.x, cell.y)) return null;
    // Preview the whole line until it meets a sealed cell or the edge.
    let a = cell.x, b = cell.x, c = cell.y, d = cell.y;
    if (g.vertical) { while (cellFree(s.grid, cell.x, c - 1)) c--; while (cellFree(s.grid, cell.x, d + 1)) d++; return [cell.x, c, 1, d - c + 1]; }
    while (cellFree(s.grid, a - 1, cell.y)) a--; while (cellFree(s.grid, b + 1, cell.y)) b++;
    return [a, cell.y, b - a + 1, 1];
  }

  function toggle() {
    g.vertical = !g.vertical;
    g.find('dir').textContent = g.vertical ? '↕ Vertical' : '↔ Horizontal';
  }

  function loop(now) {
    g.raf = requestAnimationFrame(loop);
    const s = mine();
    const r = g.three || g.flat;
    if (!s || !r) return;
    const k = 1 - Math.exp(-Math.min(60, now - (g.drawn ?? now)) / 38);
    g.drawn = now;
    s.bs.forEach((q, i) => { const t = s.b[i] || q; q[0] += (t[0] - q[0]) * k; q[1] += (t[1] - q[1]) * k; });
    r.draw({ ...s, b: s.bs, ghost: g.hover && !g.touching ? ghostFor(g.hover) : null }, now);
  }

  function mount(arena) {
    arena.innerHTML = `
      <section class="rs-cabinet" aria-label="Rift Split">
        <div class="rs-hud">
          <div><span class="rs-cap">Score</span><strong class="rs-score">0</strong></div>
          <div><span class="rs-cap">Level</span><strong class="rs-level">1</strong></div>
          <div><span class="rs-cap">Lives</span><strong class="rs-lives"></strong></div>
          <div class="rs-best-tile"><span class="rs-cap">Best</span><strong class="rs-best">—</strong></div>
        </div>
        <div class="rs-bar" role="meter" aria-label="Field sealed" aria-valuemin="0" aria-valuemax="100"><div class="rs-fill"></div><div class="rs-goal" title="75% to clear"></div><span class="rs-pct">0%</span><span class="rs-slow" hidden></span></div>
        <div class="rs-stage" aria-label="Rift Split field"><span class="rs-msg" role="status"></span></div>
        <div class="rs-controls"><button type="button" class="rs-dir">↔ Horizontal</button><span class="rs-tip">Tap to grow a wall · Space / right-click turns it</span></div>
        <ol class="rs-standings" aria-label="Scores" hidden></ol>
      </section>`;
    const root = arena.querySelector('.rs-cabinet');
    const stage = root.querySelector('.rs-stage');
    const listeners = new AbortController();
    const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: listeners.signal });
    g = {
      root, stage, listeners, W: 40, H: 24, boards: {}, order: [], tick: -1, vertical: false, best: store.get(), msgTimer: 0,
      find: (c) => root.querySelector('.rs-' + c),
      msg(text) {
        const el = stage.querySelector('.rs-msg');
        el.textContent = text; el.classList.toggle('on', !!text);
        clearTimeout(g.msgTimer); g.msgTimer = setTimeout(() => el.classList.remove('on'), 1600);
      },
    };
    on(g.find('dir'), 'click', toggle);
    let down = null;
    on(stage, 'pointerdown', (e) => {
      if (e.button === 2) return;
      e.preventDefault();
      stage.setPointerCapture?.(e.pointerId);
      g.touching = e.pointerType !== 'mouse';
      down = { x: e.clientX, y: e.clientY, cell: (g.three || g.flat)?.pick(e), done: false };
    });
    on(stage, 'pointermove', (e) => {
      const r = g.three || g.flat;
      if (!r) return;
      if (e.pointerType === 'mouse' || !down) g.hover = r.pick(e);
      if (down && !down.done && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 16) {
        down.done = true;
        place(down.cell, Math.abs(e.clientY - down.y) > Math.abs(e.clientX - down.x));
      }
    });
    on(stage, 'pointerup', (e) => {
      if (down && !down.done) place((g.three || g.flat)?.pick(e) || down.cell, g.vertical);
      down = null;
    });
    on(stage, 'pointercancel', () => { down = null; });
    on(stage, 'pointerleave', () => { g.hover = null; });
    on(stage, 'contextmenu', (e) => { e.preventDefault(); toggle(); });
    on(window, 'keydown', (e) => {
      if (e.code !== 'Space' || e.target.closest?.('input, textarea, select, button, [contenteditable], dialog[open]')) return;
      e.preventDefault();
      toggle();
    });
    g.flat = flatRenderer(stage);
    GL3.load().then((T) => {
      const me = g;
      if (g !== me) return;
      const build = () => {
        if (g !== me) return false;
        me.three = threeRenderer(T, stage, () => { me.three?.dispose(); me.three = null; GL3.revive(stage, { build, flat, unflat }); });
        return me.three;
      };
      const flat = () => { me.flat ||= flatRenderer(stage); };
      const unflat = () => { me.flat?.dispose(); me.flat = null; };
      try { if (build()) { unflat(); return; } } catch (err) { console.warn('Rift Split could not start 3D', err); }
      unflat(); flat();
      GL3.revive(stage, { build, flat, unflat });
    }).catch(() => {});
    g.raf = requestAnimationFrame(loop);
  }

  UI.riftsplit = {
    focus: true,
    mount,
    turnText: (view) => view.phase === 'over' ? 'Rift Split results' : 'Seal 75% of the field',
    render(view, ctx) {
      const d = view.riftsplit;
      if (!g || !d) return;
      g.ctx = ctx;
      if (g.run !== d.rift) {
        g.run = d.rift; g.tick = -1; g.W = d.layout.w; g.H = d.layout.h; g.solo = d.solo; g.boards = {};
        g.order = Object.keys(d.boards);
      }
      g.me = d.me;
      g.watch = g.watch || Object.keys(d.boards)[0];
      g.enabled = view.phase === 'playing' && !view.paused && !ctx.readOnly && !view.me?.eliminated && !!d.me;
      receive(d);
    },
    fast(data) { receive(data); },
    testPlace(x, y, v) { place({ x, y }, v); },
    disconnect() { if (g) g.enabled = false; },
    unmount() {
      if (!g) return;
      g.listeners.abort();
      cancelAnimationFrame(g.raf);
      clearTimeout(g.msgTimer);
      g.three?.dispose(); g.flat?.dispose();
      g.root.remove();
      g = null;
    },
  };
})();
