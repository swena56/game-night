// Sky Drift: the map in 3D (three.js) with wind arrows streaming through four layers of sky, or a flat map.
// Pick ⬆ / ⏸ / ⬇ (and 🔥) — the dotted line shows where that would carry you — then ✅ Lock in. When
// everyone has, every balloon changes height and drifts at once, and this plays the turn back.
UI.drift = (() => {
  let still = false;
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let pick = 'hold', burn = false, seenTurn = 0, primed = false, play = null, lastDraw = 0;
  const $ = (id) => document.getElementById(id);
  const ARROW = { '1,0': '→', '1,1': '↘', '0,1': '↓', '-1,1': '↙', '-1,0': '←', '-1,-1': '↖', '0,-1': '↑', '1,-1': '↗' };
  const LAYER_COL = ['#4cc9f0', '#80ed99', '#ffd166', '#ff8fab'];
  const LAYER_NAME = ['Low', 'Mid', 'High', 'Top'];
  const PLAY = 2.6;
  const D = () => S.drift;
  const colorOf = (id) => ctx?.player(id)?.color ?? '#ccc';
  const arrow = (w) => ARROW[D().dirs[w[0]].join(',')];
  const amIn = () => S?.phase === 'playing' && D().options && Object.keys(D().options).length > 0;
  const locked = () => !!D().mine;
  const canPick = () => amIn() && !locked() && !play;

  function mount(main, side) {
    gl = null; flat = null; play = null; seenTurn = 0; primed = false; pick = 'hold'; burn = false;
    main.innerHTML = `<div class="sk"><div class="sk-hud"><span id="skTurn"></span><span id="skMe"></span></div>
      <div class="sk-stage" id="skStage"><div class="sk-gauge" id="skGauge"></div><div class="sk-pop" id="skPop" hidden></div>
        <div class="sk-view" aria-label="View"><button data-v="in" aria-label="Zoom in">＋</button><button data-v="out" aria-label="Zoom out">－</button><button data-v="l" aria-label="Turn left">⟲</button><button data-v="r" aria-label="Turn right">⟳</button><button data-v="me" aria-label="Find my balloon">🎯</button><button data-v="home" aria-label="Whole map">⌂</button></div></div>
      <div class="sk-ctl" id="skCtl">
        <div class="sk-picks" id="skPicks">
          <button data-p="up"><b>⬆ Climb</b><small></small></button>
          <button data-p="hold"><b>⏸ Hold</b><small></small></button>
          <button data-p="down"><b>⬇ Descend</b><small></small></button>
        </div>
        <div class="sk-row"><button class="sk-burn ghost-btn" id="skBurn">🔥 Burner</button><button class="sk-go" id="skGo">✅ Lock in</button></div>
      </div>
      <p id="skHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Pennants</h3><div id="skBoard" class="sk-board"></div></div>';
    $('skCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !canPick()) return;
      if (b.dataset.p) pick = b.dataset.p;
      else if (b.id === 'skBurn') burn = !burn && (D().fuel[S.me.id] > 0);
      else if (b.id === 'skGo') { ctx.sfx?.('pop'); ctx.quiet(ctx.act('fly', { choice: pick, burn })); }
      controls();
    });
    const stage = $('skStage');
    stage.style.touchAction = 'none';
    // #111: one finger orbits; two fingers pinch to zoom, slide to pan and twist to turn; a double tap finds my
    // balloon. (Mouse: drag orbits, right- or shift-drag pans, the wheel zooms.)
    const fingers = new Map();
    let two = null, lastTap = 0;
    const pair = () => {
      const [[ax, ay], [bx, by]] = [...fingers.values()];
      return { mx: (ax + bx) / 2, my: (ay + by) / 2, d: Math.hypot(bx - ax, by - ay), a: Math.atan2(by - ay, bx - ax) };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sk-view')) return;
      fingers.set(e.pointerId, [e.clientX, e.clientY, e.button === 2 || e.shiftKey]);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      if (fingers.size === 2) two = pair();
      else if (fingers.size === 1) {
        const now = performance.now();
        if (now - lastTap < 320) { gl?.findMe(); lastTap = 0; } else lastTap = now;
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f || !gl) return;
      const dx = e.clientX - f[0], dy = e.clientY - f[1];
      f[0] = e.clientX; f[1] = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) lastTap = 0;
      if (fingers.size >= 2 && two) {
        const p = pair();
        let da = p.a - two.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (p.d > 10 && two.d > 10) gl.zoom(two.d / p.d);
        gl.pan(p.mx - two.mx, p.my - two.my);
        gl.turn(-da);
        two = p;
      } else if (f[2]) gl.pan(dx, dy);
      else gl.orbit(dx * 0.008, dy * 0.005);
    });
    const up = (e) => { fingers.delete(e.pointerId); two = fingers.size === 2 ? pair() : null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.querySelector('.sk-view').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !gl) return;
      ({ in: () => gl.zoom(0.8), out: () => gl.zoom(1.25), l: () => gl.turn(-Math.PI / 4), r: () => gl.turn(Math.PI / 4), me: () => gl.findMe(), home: () => gl.home() })[b.dataset.v]?.();
    });
    stage.addEventListener('wheel', (e) => { if (!gl) return; e.preventDefault(); gl.zoom(e.deltaY < 0 ? 0.9 : 1.1); }, { passive: false });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); const vw = stage.querySelector('.sk-view'); if (vw) vw.hidden = !gl; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; }

  const optKey = () => pick + (burn ? '+' : '');

  function controls() {
    const v = D(), me = S.me?.id, pos = v.pos[me];
    const btns = $('skPicks').children;
    for (const b of btns) {
      const ch = b.dataset.p, z = pos ? Math.max(0, Math.min(v.layers - 1, pos[2] + (ch === 'up' ? 1 : ch === 'down' ? -1 : 0))) : 0;
      const w = v.winds[z];
      b.querySelector('small').textContent = pos ? `${LAYER_NAME[z]} · ${arrow(w)} ${w[1]}` : '';
      b.classList.toggle('on', ch === pick);
      b.disabled = !canPick() || (pos && ((ch === 'up' && pos[2] === v.layers - 1) || (ch === 'down' && pos[2] === 0)));
      b.style.setProperty('--lc', LAYER_COL[z]);
    }
    const fuel = me ? v.fuel[me] ?? 0 : 0;
    if (!fuel) burn = false;
    $('skBurn').textContent = `🔥 Burner ×${fuel}`;
    $('skBurn').classList.toggle('on', burn);
    $('skBurn').disabled = !canPick() || !fuel;
    $('skGo').disabled = !canPick();
    $('skGo').classList.toggle('sk-ready', canPick());
    $('skGo').textContent = locked() ? `✅ Locked: ${v.mine[0] === 'up' ? '⬆' : v.mine[0] === 'down' ? '⬇' : '⏸'}${v.mine[1] ? ' 🔥' : ''}` : '✅ Lock in';
    $('skCtl').classList.toggle('sk-off', !amIn());
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = D();
    if (!primed) { primed = true; seenTurn = v.last?.id ?? 0; }
    if (v.last && v.last.id !== seenTurn) {
      seenTurn = v.last.id;
      play = { last: v.last, t0: performance.now(), said: 0 };
      // the next turn starts from the hold position: keep the player's habit of a choice, but not the burn
      burn = false;
    }
    $('skTurn').textContent = `🎈 Turn ${v.turn} of ${v.turns}${v.next ? ' · 🌬️ winds shift next turn' : ''}`;
    const me = S.me?.id;
    $('skMe').textContent = v.score[me] != null ? `🚩 ${v.score[me]}` : '';
    gauge(); board(); controls(); hint();
    (gl || flat)?.sync?.();
  }

  function hint() {
    const v = D();
    let t = '';
    if (S.phase === 'playing') {
      if (!amIn()) t = 'Watching the race.';
      else if (play) t = '';
      else if (locked()) t = `Waiting for ${S.players.filter((p) => v.seats.includes(p.id) && !v.locked.includes(p.id) && !p.eliminated).map((p) => p.name).join(', ') || 'the wind'}…`;
      else t = 'Pick a height: the dotted line shows where its wind carries you. Pass next to a 🚩 to take it.';
    }
    if ($('skHint').textContent !== t) $('skHint').textContent = t;
  }

  // the four layers' winds, the forecast beside them, and your balloon's layer
  function gauge() {
    const v = D(), g = $('skGauge'), me = S.me?.id, z = v.pos[me]?.[2];
    g.innerHTML = '';
    for (let k = v.layers - 1; k >= 0; k--) {
      const row = ctx.el('div', 'sk-layer' + (k === z ? ' me' : ''));
      row.style.setProperty('--lc', LAYER_COL[k]);
      row.append(ctx.el('span', 'sk-ln', LAYER_NAME[k]), ctx.el('b', '', `${arrow(v.winds[k])} ${v.winds[k][1]}`));
      if (v.next) row.append(ctx.el('em', '', `→ ${arrow(v.next[k])} ${v.next[k][1]}`));
      g.append(row);
    }
  }

  function board() {
    const v = D(), box = $('skBoard'); box.innerHTML = '';
    const rows = [...v.seats].sort((a, b) => v.score[b] - v.score[a]);
    for (const id of rows) {
      const p = ctx.player(id);
      const r = ctx.el('div', 'sk-brow' + (id === S.me?.id ? ' me' : ''));
      const nm = ctx.el('span', 'sk-bname', p?.name ?? '?'); nm.style.color = colorOf(id);
      const z = v.pos[id]?.[2];
      r.append(nm, ctx.el('span', 'sk-bl', z != null ? LAYER_NAME[z] : ''), ctx.el('span', '', `🔥${v.fuel[id]}`), ctx.el('b', '', `🚩 ${v.score[id]}`),
        ctx.el('span', 'sk-lock', v.locked.includes(id) && S.phase === 'playing' ? '✅' : ''));
      box.append(r);
    }
  }

  // where each balloon is drawn now: along last turn's path while it plays, else where the server says
  function balloonAt(id, now) {
    const v = D();
    const end = v.pos[id];
    if (!play) return end ? { x: end[0], y: end[1], z: end[2] } : null;
    const L = play.last, path = L.paths[id];
    if (!path) return end ? { x: end[0], y: end[1], z: end[2] } : null;
    const t = (now - play.t0) / 1000, steps = Math.max(1, L.steps - 1);
    const climb = 0.45, move = PLAY - 0.9;
    const start = path[0], from = { x: start[0], y: start[1], z: start[2] };
    // first the height change (from the layer before the turn: path[0] holds the new layer, so look it up)
    const was = L.from?.[id];
    if (t < climb) {
      const z0 = was ? was[2] : start[2];
      return { x: from.x, y: from.y, z: z0 + (start[2] - z0) * ease(t / climb) };
    }
    const u = Math.min(1, (t - climb) / move) * steps;
    const i = Math.min(path.length - 1, Math.floor(u)), j = Math.min(path.length - 1, i + 1), f = u - Math.floor(u);
    const a = path[i], b = path[j];
    let p = { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] };
    const fl = L.flung?.[id];
    if (fl && t > climb + move) {  // the storm's throw
      const k = Math.min(1, (t - climb - move) / 0.4), e = path[path.length - 1];
      p = { x: e[0] + (fl[0] - e[0]) * k, y: e[1] + (fl[1] - e[1]) * k + Math.sin(k * Math.PI) * 0.0, z: e[2] + (fl[2] - e[2]) * k, spin: k };
    }
    return p;
  }
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function loop(now) {
    if (!$('skStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.drift) return;
    if (play) {
      const t = (now - play.t0) / 1000, L = play.last, steps = Math.max(1, L.steps - 1);
      for (const ev of L.events) {
        const at = ev.kind === 'storm' ? 0.45 + PLAY - 0.9 : 0.45 + ((ev.k) / steps) * (PLAY - 0.9);
        if (!ev.shown && t >= at) {
          ev.shown = true;
          if (ev.kind === 'pennant') {
            const mine = ev.by.includes(S.me?.id);
            ctx.sfx?.(mine ? 'good' : 'pop');
            if (mine) pop('🚩 +1');
            gl?.burst(ev.at, colorOf(ev.by[0]));
          } else { ctx.sfx?.('crack'); if (ev.by.includes(S.me?.id)) pop('🌩 Thrown!'); gl?.flash(); }
        }
      }
      if (t > PLAY + 0.3) { play = null; controls(); hint(); }
    }
    const idle = !play && !gl?.busy?.();
    if (idle && now - lastDraw < (gl?.low ? 66 : 33)) return;
    lastDraw = now;
    still = idle;  // idle redraws are drawn sharp and kept out of the frame-rate watch (#107/#109)
    (gl || flat)?.draw(now);
  }

  function pop(text) {
    const p = $('skPop'); if (!p) return;
    p.textContent = text; p.hidden = false; p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
    clearTimeout(pop.t); pop.t = setTimeout(() => { p.hidden = true; }, 1400);
  }

  // ---------- three.js: map x → world x, map y → world z, layer → height
  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) paint(g, w, h);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  const alt = (z) => 1.6 + z * 1.15;

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const v0 = D(), W = v0.w, H = v0.h;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.1, 400);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.1, hemi: [0xdcefff, 0x4a5a2a, 0.85],
      key: { i: 0.9, color: 0xfff1d6, pos: [-6, 14, 8], area: 10, near: 1, far: 50 },
      sky: { top: 0x3f7fd0, horizon: 0xbfe3ff, bottom: 0xa9cfe8, band: 0.12 },
      fog: [0xbfe3ff, 24 + Math.max(W, H) * 1.4, 60 + Math.max(W, H) * 3],  // clear over the map, hazy over the far country
    });
    stg.key.target.position.set(0, 0, 0);
    const low = stg.low;
    const cx = (x) => x - (W - 1) / 2, cz = (y) => y - (H - 1) / 2;
    // the land: per-cell heights (shared by every phone) smoothed into hills, painted fields, faint cell lines
    const hAt = (x, y) => {
      const t = v0.terrain, xi = Math.max(0, Math.min(W - 1, x)), yi = Math.max(0, Math.min(H - 1, y));
      const x0 = Math.floor(xi), y0 = Math.floor(yi), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = xi - x0, fy = yi - y0;
      const a = t[y0][x0] * (1 - fx) + t[y0][x1] * fx, b = t[y1][x0] * (1 - fx) + t[y1][x1] * fx;
      return (a * (1 - fy) + b * fy);
    };
    const fields = canvasTex(T, W * 32, H * 32, (g, w, h) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = v0.terrain[y][x];
        g.fillStyle = t < 0.12 ? '#4a9fd8' : t < 0.45 ? ['#8fc561', '#a7cf6b', '#c9d77a'][(x * 7 + y * 3) % 3] : t < 0.75 ? '#6fae4f' : '#4f8a3c';
        g.fillRect(x * 32, y * 32, 32, 32);
        if (t >= 0.12 && t < 0.45 && (x + y) % 2) { g.fillStyle = 'rgba(80,60,20,.12)'; for (let k = 0; k < 6; k++) g.fillRect(x * 32, y * 32 + k * 5 + 2, 32, 1.5); }
      }
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
      for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * 32, 0); g.lineTo(x * 32, h); g.stroke(); }
      for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * 32); g.lineTo(w, y * 32); g.stroke(); }
    });
    const land = new T.PlaneGeometry(W, H, W * 3, H * 3);
    const lp = land.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i) + (W - 1) / 2, y = -lp.getY(i) + (H - 1) / 2, t = hAt(x, y);
      lp.setZ(i, t < 0.12 ? -0.05 : (t - 0.12) * 0.7);
    }
    land.computeVertexNormals();
    const ground = new T.Mesh(land, new T.MeshStandardMaterial({ map: fields, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const skirt = new T.Mesh(new T.PlaneGeometry(260, 260), new T.MeshStandardMaterial({ color: 0x7fae58, roughness: 1 }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.08; scene.add(skirt);
    // trees on the high ground, cottages on the fields
    const treeGeo = new T.ConeGeometry(0.16, 0.45, 6), treeMat = new T.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.9 });
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (v0.terrain[y][x] > 0.68) cells.push([x, y]);
    const trees = new T.InstancedMesh(treeGeo, treeMat, cells.length * 3);
    const m4 = new T.Matrix4();
    let n = 0;
    cells.forEach(([x, y], i) => {
      for (let k = 0; k < 3; k++) {
        const ox = ((i * 37 + k * 13) % 10) / 10 - 0.45, oy = ((i * 53 + k * 29) % 10) / 10 - 0.45;
        const h = (hAt(x + ox, y + oy) - 0.12) * 0.7;
        m4.makeTranslation(cx(x + ox), h + 0.22, cz(y + oy)); trees.setMatrixAt(n++, m4);
      }
    });
    trees.castShadow = !low; scene.add(trees);
    const houseGeo = new T.BoxGeometry(0.22, 0.16, 0.18), roofGeo = new T.ConeGeometry(0.19, 0.14, 4);
    const houseMat = new T.MeshStandardMaterial({ color: 0xf1e3c8 }), roofMat = new T.MeshStandardMaterial({ color: 0xb5523b });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = v0.terrain[y][x];
      if (t > 0.3 && t < 0.34) {
        const h = (t - 0.12) * 0.7, hs = new T.Mesh(houseGeo, houseMat), rf = new T.Mesh(roofGeo, roofMat);
        hs.position.set(cx(x), h + 0.08, cz(y)); rf.position.set(cx(x), h + 0.23, cz(y)); rf.rotation.y = Math.PI / 4;
        hs.castShadow = !low; scene.add(hs, rf);
      }
    }

    countryside();
    // #107: the world runs on past the map: fields and woods all round, a lake, a ring of far hills, and clouds
    // drifting overhead, so the map reads as a patch of a bigger country rather than a board on a green table
    function countryside() {
      const rnd = ((seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(Math.round(v0.terrain[0][0] * 1e4) + 7);
      const outside = (x, z, m) => Math.abs(x) > W / 2 + m || Math.abs(z) > H / 2 + m;
      const R = Math.max(W, H);
      // patchwork fields
      const fieldCols = [0x9ccc65, 0xb5d47a, 0x8bbf56, 0xd6cf7a, 0x6fae4f, 0xa3c26a];
      const patchGeo = new T.PlaneGeometry(1, 1);
      for (let i = 0; i < (low ? 40 : 90); i++) {
        const a = rnd() * 6.283, d = R * 0.6 + rnd() * R * 2.2, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!outside(x, z, 1.5)) continue;
        const m = new T.Mesh(patchGeo, new T.MeshStandardMaterial({ color: fieldCols[i % fieldCols.length], roughness: 1 }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * 0.6 - 0.3; m.scale.set(2 + rnd() * 4, 1.5 + rnd() * 3, 1);
        m.position.set(x, -0.07 + i * 0.0001, z); scene.add(m);
      }
      // a lake off one side
      const la = rnd() * 6.283, ld = R * 1.1;
      const lake = new T.Mesh(new T.CircleGeometry(1, 28), new T.MeshStandardMaterial({ color: 0x4a9fd8, roughness: 0.25, metalness: 0.1 }));
      lake.rotation.x = -Math.PI / 2; lake.scale.set(R * 0.45, R * 0.28, 1); lake.position.set(Math.cos(la) * ld, -0.06, Math.sin(la) * ld);
      if (outside(lake.position.x, lake.position.z, R * 0.5)) scene.add(lake);
      // woods: clumps of trees in the countryside
      const spots = [];
      for (let i = 0; spots.length < (low ? 120 : 320) && i < 4000; i++) {
        const a = rnd() * 6.283, d = R * 0.6 + rnd() * R * 2.4, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!outside(x, z, 1) || Math.hypot((x - lake.position.x) / (R * 0.5), (z - lake.position.z) / (R * 0.32)) < 1) continue;
        const n = 2 + Math.floor(rnd() * 5);
        for (let k = 0; k < n; k++) spots.push([x + (rnd() - 0.5) * 1.6, z + (rnd() - 0.5) * 1.6, 0.8 + rnd() * 0.8]);
      }
      const woods = new T.InstancedMesh(treeGeo, treeMat, spots.length);
      spots.forEach(([x, z, k], i) => { m4.makeScale(k, k, k).setPosition(x, 0.18 * k - 0.05, z); woods.setMatrixAt(i, m4); });
      scene.add(woods);
      // far hills: a ring of soft, low domes fading into the haze
      const hillMat = new T.MeshStandardMaterial({ color: 0x6f9a5a, roughness: 1, flatShading: true });
      const hillGeo = new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      for (let i = 0; i < (low ? 14 : 26); i++) {
        const a = (i / (low ? 14 : 26)) * 6.283 + rnd() * 0.2, d = R * 3 + rnd() * R * 1.5;
        const hl = new T.Mesh(hillGeo, hillMat);
        hl.scale.set(R * (0.5 + rnd() * 0.6), R * (0.15 + rnd() * 0.25), R * (0.4 + rnd() * 0.4));
        hl.position.set(Math.cos(a) * d, -0.1, Math.sin(a) * d); hl.rotation.y = rnd() * 3; scene.add(hl);
      }
    }
    // fair-weather clouds in a slow ring round the horizon, past the map's edge (never between you and the map)
    const puffs = new T.Group();
    {
      const puffMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, depthWrite: false });
      const puffGeo = new T.SphereGeometry(1, 10, 8), R = Math.max(W, H);
      for (let i = 0, n = low ? 7 : 14; i < n; i++) {
        const c = new T.Group(), a = (i / n) * 6.283 + (i % 3) * 0.3, d = R * (1.5 + (i % 4) * 0.35);
        for (let k = 0; k < 4; k++) { const b = new T.Mesh(puffGeo, puffMat); b.scale.setScalar(0.8 + ((i + k) % 3) * 0.4); b.position.set(k * 1.0 - 1.5, (k % 2) * 0.4, ((k * 7) % 3) * 0.3); c.add(b); }
        c.position.set(Math.cos(a) * d, alt(3) + 1.5 + (i % 3) * 1.2, Math.sin(a) * d); c.rotation.y = -a;
        puffs.add(c);
      }
      scene.add(puffs);
    }

    // wind: arrows streaming through each layer
    const arrowGeo = new T.ConeGeometry(0.1, 0.42, 5); arrowGeo.rotateZ(-Math.PI / 2);
    const flows = [];
    for (let z = 0; z < v0.layers; z++) {
      const count = low ? 18 : 34;
      const mat = new T.MeshBasicMaterial({ color: LAYER_COL[z], transparent: true, opacity: 0.7, depthWrite: false });
      const im = new T.InstancedMesh(arrowGeo, mat, count);
      const seeds = Array.from({ length: count }, (_, i) => [((i * 0.6180339) % 1) * W, ((i * 0.4142135 + z * 0.37) % 1) * H, (i * 0.17) % 1]);
      im.frustumCulled = false;
      scene.add(im); flows.push({ im, seeds, mat });
    }
    // balloons
    const env = (() => {
      const pts = [];
      for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push(new T.Vector2(Math.sin(a) * 0.36 * (1 - 0.35 * (i / 16) ** 3), -Math.cos(a) * 0.4 + 0.1 * Math.sin(a))); }
      pts[0].x = 0.08; pts.unshift(new T.Vector2(0.06, -0.48));
      return new T.LatheGeometry(pts, 24);
    })();
    const stripes = (col) => canvasTex(T, 128, 32, (g, w, h) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fffaf0' : col; g.fillRect((i * w) / 8, 0, w / 8 + 1, h); }
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, h - 4, w, 4);
    });
    const basketGeo = new T.CylinderGeometry(0.09, 0.07, 0.12, 8), basketMat = new T.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const flameTex = canvasTex(T, 32, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h * 0.7, 0, w / 2, h * 0.7, h * 0.6);
      gr.addColorStop(0, 'rgba(255,255,200,1)'); gr.addColorStop(0.4, 'rgba(255,150,40,.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const youTex = canvasTex(T, 128, 64, (g, w, h) => {
      g.fillStyle = '#ffe066'; g.beginPath(); g.roundRect?.(8, 4, w - 16, 38, 12); if (!g.roundRect) g.rect(8, 4, w - 16, 38); g.fill();
      g.beginPath(); g.moveTo(w / 2 - 10, 42); g.lineTo(w / 2 + 10, 42); g.lineTo(w / 2, 58); g.fill();
      g.fillStyle = '#1a1a1a'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText('YOU', w / 2, 34);
    });
    const balloons = new Map();
    function balloon(id) {
      const grp = new T.Group();
      const e = new T.Mesh(env, new T.MeshStandardMaterial({ map: stripes(colorOf(id)), roughness: 0.55 }));
      e.position.y = 0.55; e.castShadow = !low; grp.add(e);
      const b = new T.Mesh(basketGeo, basketMat); b.castShadow = !low; grp.add(b);
      const ropes = new T.LineSegments(new T.BufferGeometry().setFromPoints([[-0.07, 0.06, 0], [-0.1, 0.18, 0], [0.07, 0.06, 0], [0.1, 0.18, 0], [0, 0.06, -0.07], [0, 0.18, -0.1], [0, 0.06, 0.07], [0, 0.18, 0.1]].map((a) => new T.Vector3(...a))), new T.LineBasicMaterial({ color: 0x3b2a1a }));
      grp.add(ropes);
      const fl = new T.Sprite(new T.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      fl.scale.set(0.12, 0.24, 1); fl.position.y = 0.16; fl.visible = false; grp.add(fl);
      const shadow = new T.Mesh(new T.CircleGeometry(0.22, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
      // "you": a bobbing marker over your own balloon
      const ring = new T.Sprite(new T.SpriteMaterial({ map: youTex, transparent: true, depthTest: false }));
      ring.scale.set(0.55, 0.3, 1); ring.position.y = 1.25; ring.visible = false; grp.add(ring);
      scene.add(grp);
      return { grp, fl, shadow, ring };
    }
    // pennants: a pole, a flag, a beam of light, and the square they can be taken from
    const poleGeo = new T.CylinderGeometry(0.02, 0.02, 1.2, 6), poleMat = new T.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.4, roughness: 0.4 });
    const flagGeo = new T.PlaneGeometry(0.36, 0.22); flagGeo.translate(0.18, 0, 0);
    const flagMat = new T.MeshStandardMaterial({ color: 0xe63946, side: T.DoubleSide, emissive: 0x551010 });
    const beamMat = new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending });
    const beamGeo = new T.CylinderGeometry(0.1, 0.14, alt(3) + 1, 10, 1, true);
    const zoneGeo = new T.PlaneGeometry(2.96, 2.96), zoneMat = new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.12, depthWrite: false });
    let flags = [];
    function syncFlags() {
      const ps = D().pennants;
      const key = JSON.stringify(ps);
      if (key === syncFlags.key) return;
      syncFlags.key = key;
      for (const f of flags) scene.remove(f);
      flags = ps.map(([x, y]) => {
        const g = new T.Group(), h = Math.max(0, (hAt(x, y) - 0.12) * 0.7);
        const pole = new T.Mesh(poleGeo, poleMat); pole.position.y = 0.6; g.add(pole);
        const flag = new T.Mesh(flagGeo, flagMat); flag.position.y = 1.08; flag.name = 'flag'; g.add(flag);
        const beam = new T.Mesh(beamGeo, beamMat); beam.position.y = (alt(3) + 1) / 2; g.add(beam);
        const zone = new T.Mesh(zoneGeo, zoneMat); zone.rotation.x = -Math.PI / 2; zone.position.y = 0.04; g.add(zone);
        g.position.set(cx(x), h, cz(y)); scene.add(g); return g;
      });
    }
    // the storm: a dark cloud bank with flickers
    const storm = new T.Group();
    const cloudMat = new T.MeshStandardMaterial({ color: 0x555b6e, roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
    for (let k = 0; k < 9; k++) {
      const c = new T.Mesh(new T.SphereGeometry(0.3 + (k % 3) * 0.1, 10, 8), cloudMat);
      c.position.set(Math.cos(k * 2.4) * 0.75, (k % 2) * 0.22, Math.sin(k * 2.4) * 0.75); storm.add(c);
    }
    const bolt = new T.PointLight(0xbfd7ff, 0, 8); bolt.position.y = -0.5; storm.add(bolt);
    const rain = new T.Mesh(new T.CylinderGeometry(1.3, 1.5, alt(3), 12, 1, true), new T.MeshBasicMaterial({ color: 0x6d7a99, transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide }));
    rain.position.y = -alt(3) / 2; storm.add(rain);
    scene.add(storm);
    // my preview: dots along the chosen path, and a ghost ring where it ends
    const dotGeo = new T.SphereGeometry(0.085, 10, 8), dots = [];
    for (let i = 0; i < 6; i++) { const d = new T.Mesh(dotGeo, new T.MeshBasicMaterial({ color: 0xffe066 })); d.visible = false; scene.add(d); dots.push(d); }
    const ghost = new T.Mesh(new T.TorusGeometry(0.32, 0.03, 6, 28), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    ghost.rotation.x = Math.PI / 2; ghost.visible = false; scene.add(ghost);
    // bursts when a pennant is taken
    const NB = 60, bp = new Float32Array(NB * 3), bv = [];
    const bGeo = new T.BufferGeometry(); bGeo.setAttribute('position', new T.BufferAttribute(bp, 3));
    const bMat = new T.PointsMaterial({ size: 0.09, color: 0xffd23f, transparent: true, depthWrite: false });
    const burstPts = new T.Points(bGeo, bMat); burstPts.frustumCulled = false; burstPts.visible = false; scene.add(burstPts);
    let burstT = 0, flashT = 0;
    function burst(at, col) {
      const [x, y] = at;
      for (let k = 0; k < NB; k++) {
        bp[k * 3] = cx(x); bp[k * 3 + 1] = 1.1; bp[k * 3 + 2] = cz(y);
        const a = Math.random() * 6.283, s = 0.8 + Math.random() * 1.8;
        bv[k] = [Math.cos(a) * s, 1 + Math.random() * 2.5, Math.sin(a) * s];
      }
      bMat.color.setStyle(col); burstT = 1;
    }

    // camera: orbit round the map
    const SC = Math.max(1, Math.max(W, H) / 12);  // bigger skies: the camera starts further out (#107)
    // #111: and pan over it (view.tx/tz: the point looked at), zoom and turn with two fingers or the buttons
    const HOME = { yaw: 0, pitch: 1.0, dist: 14.5 * SC, tx: 0, tz: 0 };
    const view = { ...HOME };
    function place() {
      const d = view.dist * Math.max(1, 1.3 / camera.aspect), p = view.pitch + (camera.aspect < 1 ? 0.1 : 0);
      camera.position.set(view.tx + Math.sin(view.yaw) * Math.cos(p) * d, Math.sin(p) * d + 1, view.tz + Math.cos(view.yaw) * Math.cos(p) * d);
      camera.lookAt(view.tx, 1.2, view.tz + 0.4);
    }
    let moved = true, glide = null;
    function orbit(dy, dp) { view.yaw -= dy; view.pitch = Math.max(0.35, Math.min(1.35, view.pitch + dp)); moved = true; glide = null; }
    function zoom(k) { view.dist = Math.max(4, Math.min(30 * SC, view.dist * k)); moved = true; glide = null; }
    function turn(a) { view.yaw -= a; moved = true; glide = null; }
    // a drag in screen pixels slides the map under the finger
    function pan(dx, dy) {
      const k = (view.dist / Math.max(200, renderer.domElement.clientHeight || 400)) * 1.15, c = Math.cos(view.yaw), s = Math.sin(view.yaw);
      view.tx = Math.max(-W / 2 - 2, Math.min(W / 2 + 2, view.tx - (c * dx + s * dy) * k));
      view.tz = Math.max(-H / 2 - 2, Math.min(H / 2 + 2, view.tz - (-s * dx + c * dy) * k));
      moved = true; glide = null;
    }
    // ease to a view: 🎯 my balloon, ⌂ the whole map
    function goTo(to) { glide = { from: { ...view }, to: { ...view, ...to }, t: 0 }; }
    function home() { goTo({ ...HOME, yaw: Math.round(view.yaw / (2 * Math.PI)) * 2 * Math.PI }); }
    function findMe() {
      const p = D().pos[S.me?.id];
      if (p) goTo({ tx: cx(p[0]), tz: cz(p[1]), dist: Math.min(view.dist, 9 * Math.max(1, SC * 0.8)) });
    }

    let lastT = 0;
    function draw(now) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const v = D();
      syncFlags();
      // wind arrows drift with their layer, wrapping round the map
      flows.forEach((fw, z) => {
        const [d, sp] = v.winds[z], [dx, dy] = v.dirs[d], ang = Math.atan2(-dy, dx);
        const myZ = v.pos[S.me?.id]?.[2];
        fw.mat.opacity = myZ == null || Math.abs(myZ - z) <= 1 ? 0.8 : 0.2;
        const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), ang);
        fw.seeds.forEach((s, i) => {
          const t = now / 1000 * (0.35 + sp * 0.3);
          const x = ((s[0] + dx * t) % W + W) % W, y = ((s[1] + dy * t) % H + H) % H;
          m4.compose(new T.Vector3(cx(x - 0.5), alt(z) + 0.1 * Math.sin(s[2] * 9 + now / 600), cz(y - 0.5)), q, new T.Vector3(1, 1, 1));
          fw.im.setMatrixAt(i, m4);
        });
        fw.im.instanceMatrix.needsUpdate = true;
      });
      // balloons
      for (const id of v.seats) {
        let b = balloons.get(id);
        if (!b) { b = balloon(id); balloons.set(id, b); }
        const p = balloonAt(id, now), gone = ctx.player(id)?.eliminated;
        b.grp.visible = b.shadow.visible = !!p && !gone;
        if (!p) continue;
        const bob = Math.sin(now / 700 + id.length) * 0.05;
        b.grp.position.set(cx(p.x), alt(p.z) + bob, cz(p.y));
        b.grp.rotation.y = p.spin ? p.spin * 6 : 0;
        b.shadow.position.set(cx(p.x), Math.max(0, (hAt(p.x, p.y) - 0.12) * 0.7) + 0.03, cz(p.y));
        b.fl.visible = !!(play && play.last.choices[id]?.[1]) || (id === S.me?.id && burn && canPick());
        if (b.fl.visible) b.fl.scale.set(0.12, 0.2 + Math.random() * 0.08, 1);
        b.ring.visible = id === S.me?.id;
      }
      // pennants wave
      for (const f of flags) { const fl = f.getObjectByName('flag'); fl.rotation.y = Math.sin(now / 300 + f.position.x) * 0.35; }
      puffs.rotation.y += dt * 0.006;  // the clouds wheel slowly round the horizon
      // the storm
      storm.visible = !!v.storm;
      if (v.storm) {
        const tx = cx(v.storm.x), tz = cz(v.storm.y);
        storm.position.x += (tx - storm.position.x) * Math.min(1, dt * 1.5);
        storm.position.z += (tz - storm.position.z) * Math.min(1, dt * 1.5);
        storm.position.y = alt(3) + 0.75;
        storm.rotation.y += dt * 0.15;
        bolt.intensity = flashT > 0 ? 3 : Math.random() < 0.01 ? 2.5 : bolt.intensity * 0.85;
      }
      if (flashT > 0) flashT -= dt;
      // my preview path
      const opt = canPick() ? v.options[optKey()] : null;
      dots.forEach((d, i) => { const c = opt?.[i + 1]; d.visible = !!c; if (c) d.position.set(cx(c[0]), alt(c[2]), cz(c[1])); });
      ghost.visible = !!opt;
      if (opt) { const e = opt[opt.length - 1]; ghost.position.set(cx(e[0]), alt(e[2]) - 0.02, cz(e[1])); ghost.material.color.setStyle(LAYER_COL[e[2]]); }
      if (burstT > 0) {
        burstT -= dt;
        for (let k = 0; k < NB; k++) { bp[k * 3] += bv[k][0] * dt; bp[k * 3 + 1] += bv[k][1] * dt; bv[k][1] -= 3 * dt; bp[k * 3 + 2] += bv[k][2] * dt; }
        bGeo.attributes.position.needsUpdate = true; bMat.opacity = Math.max(0, burstT);
      }
      burstPts.visible = burstT > 0;
      if (glide) {
        glide.t = Math.min(1, glide.t + dt / 0.5);
        const e = glide.t * glide.t * (3 - 2 * glide.t);
        for (const k of Object.keys(HOME)) view[k] = glide.from[k] + (glide.to[k] - glide.from[k]) * e;
        moved = true;
        if (glide.t >= 1) glide = null;
      }
      if (moved) { place(); moved = false; }
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      (still && renderer.renderStill ? renderer.renderStill : renderer.render)(scene, camera);
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 360;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); moved = true;
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    }
    return { draw, resize, dispose, orbit, zoom, turn, pan, home, findMe, gliding: () => !!glide, burst, flash: () => { flashT = 0.3; if (!low) GL3.shake(camera, 0.2); }, busy: () => burstT > 0 || !!glide, low };
  }

  // ---------- flat fallback: the map from above
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 24, ox = 0, oy = 0;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth || 320, h = stage.clientHeight || 360;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      const v = D(); k = Math.min(canvas.width / v.w, canvas.height / v.h); ox = (canvas.width - k * v.w) / 2; oy = (canvas.height - k * v.h) / 2;
    }
    function draw(now) {
      const v = D();
      g.fillStyle = '#9cc3e0'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) {
        const t = v.terrain[y][x];
        g.fillStyle = t < 0.12 ? '#4a9fd8' : t < 0.45 ? '#a7cf6b' : t < 0.75 ? '#6fae4f' : '#4f8a3c';
        g.fillRect(ox + x * k, oy + y * k, k - 1, k - 1);
      }
      const C = (x, y) => [ox + (x + 0.5) * k, oy + (y + 0.5) * k];
      for (const [x, y] of v.pennants) {
        g.fillStyle = 'rgba(255,224,102,.25)'; g.fillRect(ox + (x - 1) * k, oy + (y - 1) * k, 3 * k, 3 * k);
        g.font = `${k * 0.7}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚩', ...C(x, y));
      }
      if (v.storm) { g.fillStyle = 'rgba(60,64,80,.55)'; g.beginPath(); g.arc(...C(v.storm.x, v.storm.y), k * 1.5, 0, 7); g.fill(); }
      const opt = canPick() ? v.options[optKey()] : null;
      if (opt) {
        g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(...C(opt[0][0], opt[0][1]));
        for (const c of opt) g.lineTo(...C(c[0], c[1])); g.stroke(); g.setLineDash([]);
      }
      for (const id of v.seats) {
        const p = balloonAt(id, now); if (!p) continue;
        const [x, y] = C(p.x, p.y);
        g.fillStyle = colorOf(id); g.beginPath(); g.arc(x, y, k * 0.36, 0, 7); g.fill();
        g.strokeStyle = LAYER_COL[Math.round(p.z)]; g.lineWidth = 3; g.stroke();
        g.fillStyle = '#000'; g.font = `bold ${k * 0.34}px sans-serif`; g.fillText(String(Math.round(p.z) + 1), x, y);
      }
    }
    resize();
    return { draw, resize };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🎈 Turn ${s.drift.turn} of ${s.drift.turns}` : null);
  const myMove = (s) => s.phase === 'playing' && !!s.drift?.options && Object.keys(s.drift.options).length > 0 && !s.drift.mine;

  return { mount, render, unmount, turnText, myMove, focus: true };
})();
