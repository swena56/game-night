// Wobble Tower: one shared tower of odd blocks in 3D (three.js), or a flat top-down plan without WebGL. On your
// turn a see-through ghost of your block hangs over the tower: drag it (or nudge ◀ ▶ ▲ ▼, relative to the
// camera), ⟳ turn it, and 🧱 Place. The 📏 wobble meter runs the same statics as the server (games/wobble.py) on
// the tower you can see, so it shows how close the tower would be to going over. Then 🎁 pick the next player's
// block. A topple comes from the server as `last.fall` (the tower, the block that gave, the edge it tipped over)
// and plays back here: everything above that block swings over the edge, then tumbles off the table.
// 🪵 Pull & Stack (mode "pull"): the tower starts built from planks. On your turn tap a plank (it jiggles: loose ones
// more) and drag it out along its length (or 🪵 Pull); the tower leans and shakes as it slides, more for a tight one.
// Then tap a glowing spot on top (or Edge / Middle / Edge) to set it. The server sends each plank's grip and risk,
// so the browser runs no statics in this mode; the tower is drawn tilted by its lean.
UI.wobble = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, primed = false, seen = 0, lastDraw = 0;
  let gx = 0, gz = 0, grot = 0, yaw = 0;    // the ghost (position, eighth turns) and where the camera stands round the tower (#124)
  let fall = null;                           // the topple being played: {f, t0}
  let ghostFor = '';
  // 🪵 Pull & Stack: the plank picked, how far it's slid out (0..1, and the drawn value easing after it), which
  // way (±1 along its length), a drag in progress, and the last poke (a jiggle when you tap one)
  let sel = null, prog = 0, progV = 0, pside = 1, pdrag = null, poke = null, sentAt = 0;
  const $ = (id) => document.getElementById(id);
  const FALL_MS = 2900;

  const V = () => S.wobble;
  const colorOf = (i) => ctx?.player(V().seats[i])?.color ?? '#ccc';
  const nameOf = (i) => ctx?.player(V().seats[i])?.name ?? '?';
  const placing = () => S?.phase === 'playing' && ctx?.myTurn && V().phase === 'place';
  const gifting = () => S?.phase === 'playing' && ctx?.myTurn && V().phase === 'gift' && V().placer === V().me;
  const busy = () => !!fall;
  const pullMode = () => V()?.mode === 'pull';
  const pulling = () => S?.phase === 'playing' && ctx?.myTurn && pullMode() && V().phase === 'pull' && !fall;
  const stacking = () => S?.phase === 'playing' && ctx?.myTurn && pullMode() && V().phase === 'stack' && !fall;
  const blockOf = (id) => V().tower.find((b) => b.id === id);
  const axisOf = (b) => (b.r % 4 === 0 ? [1, 0] : [0, 1]);
  const riskOf = (id, sd = pside) => { const i = V().blocks?.[id]; return !i ? 0 : i.m < 0 ? 1 : i.rk[sd < 0 ? 0 : 1]; };
  const feelOf = (g) => (g >= V().k.tight ? ['🔴', 'Tight'] : g < V().k.loose ? ['🟢', 'Loose'] : ['🟡', 'Snug']);
  const riskColor = (r) => (r >= 0.5 ? '#ef476f' : r >= 0.2 ? '#ff8c42' : r >= 0.05 ? '#ffd23f' : '#3ddc97');

  // ---------- statics: the same model as games/wobble.py
  const EPS = 1e-6, C45 = Math.SQRT1_2;
  // (#125) a turn r counts eighths: r >> 1 quarter turns of the parts, then 45° more for an odd r. Footprints are
  // convex counter-clockwise polygons; rects() are the parts square to the block (for drawing it).
  function rects(shape, r) {
    return V().shapes[shape].parts.map(([cx, cz, w, d]) => {
      for (let k = 0; k < ((r >> 1) % 4); k++) [cx, cz, w, d] = [-cz, cx, d, w];
      return [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2];
    });
  }
  function poly([x0, z0, x1, z1], x, z, r) {
    let pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    if (r % 2) pts = pts.map(([px, pz]) => [px * C45 - pz * C45, px * C45 + pz * C45]);
    return pts.map(([px, pz]) => [x + px, z + pz]);
  }
  const parts = (shape, x, z, r) => rects(shape, r).map((rc) => poly(rc, x, z, r));
  const area = (pg) => pg.reduce((a, p, k) => { const q = pg[(k + 1) % pg.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const squared = (pg) => Math.abs(pg[0][1] - pg[1][1]) < 1e-9 && Math.abs(pg[1][0] - pg[2][0]) < 1e-9 && Math.abs(pg[2][1] - pg[3][1]) < 1e-9 && pg[0][0] < pg[1][0] && pg[1][1] < pg[2][1];
  function inter(subj, clip) {
    const bx = (pg, i, f) => f(...pg.map((p) => p[i]));
    if (bx(subj, 0, Math.max) <= bx(clip, 0, Math.min) + EPS || bx(clip, 0, Math.max) <= bx(subj, 0, Math.min) + EPS
      || bx(subj, 1, Math.max) <= bx(clip, 1, Math.min) + EPS || bx(clip, 1, Math.max) <= bx(subj, 1, Math.min) + EPS) return null;
    if (subj.length === 4 && clip.length === 4 && squared(subj) && squared(clip)) {
      const x0 = Math.max(subj[0][0], clip[0][0]), z0 = Math.max(subj[0][1], clip[0][1]), x1 = Math.min(subj[2][0], clip[2][0]), z1 = Math.min(subj[2][1], clip[2][1]);
      return x1 - x0 > EPS && z1 - z0 > EPS ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] : null;
    }
    let out = subj.slice();
    for (let k = 0; k < clip.length && out.length; k++) {
      const [ax, az] = clip[k], [bx2, bz] = clip[(k + 1) % clip.length];
      const side = (p) => (bx2 - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
      const inp = out; out = [];
      let prev = inp[inp.length - 1], sp = side(prev);
      for (const cur of inp) {
        const sc = side(cur);
        if ((sc >= -EPS) !== (sp >= -EPS)) { const t = sp / (sp - sc); out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]); }
        if (sc >= -EPS) out.push(cur);
        prev = cur; sp = sc;
      }
    }
    return out.length >= 3 && area(out) > 1e-5 ? out : null;
  }
  // a support patch: a polygon (or a rectangle, from a tower set before 45° turns)
  const asPoly = (p) => (typeof p[0] === 'number' ? [[p[0], p[1]], [p[2], p[1]], [p[2], p[3]], [p[0], p[3]]] : p);
  function tops(b) {
    const sh = V().shapes[b.s], top = b.y + sh.h, R = V().k.ridge;
    return rects(b.s, b.r).map((rc) => {
      const pg = poly(rc, b.x, b.z, b.r);
      if (!sh.roof) return [pg, top, pg];
      const [x0, z0, x1, z1] = rc, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      return [pg, top, poly(x1 - x0 >= z1 - z0 ? [x0, cz - R / 2, x1, cz + R / 2] : [cx - R / 2, z0, cx + R / 2, z1], b.x, b.z, b.r)];
    });
  }
  function land(tower, shape, x, z, r) {
    const mine = parts(shape, x, z, r), P = V().k.plinth, pl = [[-P, -P], [P, -P], [P, P], [-P, P]];
    const surf = [[-1, pl, 0, pl]];
    tower.forEach((b, k) => { for (const [rc, top, carry] of tops(b)) surf.push([k, rc, top, carry]); });
    let y = null;
    for (const [, rc, top] of surf) if (mine.some((m) => inter(m, rc))) y = y == null ? top : Math.max(y, top);
    if (y == null) return null;
    const sup = [];
    for (const [k, rc, top, carry] of surf) {
      if (Math.abs(top - y) >= EPS) continue;
      for (const m of mine) if (inter(m, rc)) { const p = inter(m, carry); if (p) sup.push([k, p]); }
    }
    return { y, sup };
  }
  function pcent(pg) {
    let a = 0, cx = 0, cz = 0;
    pg.forEach(([x0, z0], k) => { const [x1, z1] = pg[(k + 1) % pg.length], c = x0 * z1 - x1 * z0; a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; });
    if (Math.abs(a) < 1e-12) return [0, pg.reduce((s, p) => s + p[0], 0) / pg.length, pg.reduce((s, p) => s + p[1], 0) / pg.length];
    return [Math.abs(a) / 2, cx / (3 * a), cz / (3 * a)];
  }
  function centroid(b) {
    let m = 0, cx = 0, cz = 0;
    for (const pg of parts(b.s, b.x, b.z, b.r)) { const [a, px, pz] = pcent(pg); m += a; cx += a * px; cz += a * pz; }
    const sh = V().shapes[b.s];
    return [m * sh.h * (sh.roof ? 0.5 : 1), cx / m, cz / m];
  }
  function nearestIn(pg, X, Z) {
    const n = pg.length;
    if (pg.every((p, k) => { const q = pg[(k + 1) % n]; return (q[0] - p[0]) * (Z - p[1]) - (q[1] - p[1]) * (X - p[0]) >= -EPS; })) return [X, Z];
    let best = 1e18, bp = [X, Z];
    pg.forEach(([ax, az], k) => {
      const [bx2, bz] = pg[(k + 1) % n], ex = bx2 - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((X - ax) * ex + (Z - az) * ez) / l2)), px = ax + t * ex, pz = az + t * ez, d = (px - X) ** 2 + (pz - Z) ** 2;
      if (d < best) { best = d; bp = [px, pz]; }
    });
    return bp;
  }
  function hull(pts) {
    pts = [...new Map(pts.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  function margin(tower, gust = [0, 0]) {
    const n = tower.length, loads = tower.map(() => []), K = V().k.gustK;
    let worst = 1e9;
    for (let i = n - 1; i >= 0; i--) {
      const b = tower[i];
      let [m, cx, cz] = centroid(b);
      const ymid = b.y + V().shapes[b.s].h / 2;
      cx += gust[0] * K * ymid; cz += gust[1] * K * ymid;
      let M = m, X = m * cx, Z = m * cz;
      for (const [lm, lx, lz] of loads[i]) { M += lm; X += lm * lx; Z += lm * lz; }
      X /= M; Z /= M;
      const patches = b.sup.map(([k, p]) => [k, asPoly(p)]), poly = hull(patches.flatMap(([, pg]) => pg));
      let d = -1;
      if (poly.length >= 3) {
        d = 1e9;
        for (let k = 0; k < poly.length; k++) {
          const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], ex = bx - ax, ez = bz - az, ln = Math.hypot(ex, ez) || 1;
          d = Math.min(d, (-ez * (X - ax) + ex * (Z - az)) / ln);
        }
      }
      worst = Math.min(worst, d);
      const sup = patches;
      if (!sup.length) continue;
      const cents = sup.map(([, pg]) => pcent(pg).slice(1));
      let ws;
      if (sup.length === 1) ws = [1];
      else if (sup.length === 2) {
        const [[ax, az], [bx, bz]] = cents, ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
        const t = l2 < EPS ? 0.5 : Math.min(1, Math.max(0, ((X - ax) * ex + (Z - az) * ez) / l2));
        ws = [1 - t, t];
      } else {
        const inv = cents.map(([px, pz]) => 1 / (Math.hypot(X - px, Z - pz) + 0.05)), s = inv.reduce((a, b) => a + b, 0);
        ws = inv.map((v) => v / s);
      }
      sup.forEach(([k, pg], j) => { if (k >= 0 && ws[j] > 0) loads[k].push([M * ws[j], ...nearestIn(pg, X, Z)]); });
    }
    return worst === 1e9 ? 1 : worst;
  }
  const gustNow = () => (V().gust && V().gust.in === 0 ? V().gust.dir : [0, 0]);
  // what placing the ghost here would do: {y, sup, m} (m < 0: it would topple), or null when nothing is under it
  let prevKey = '', prevRes = null;
  function preview() {
    const v = V(), key = `${v.places}|${v.current}|${gx}|${gz}|${grot}`;
    if (key === prevKey) return prevRes;
    prevKey = key;
    const got = land(v.tower, v.current, gx, gz, grot);
    prevRes = got && { ...got, m: margin([...v.tower, { s: v.current, x: gx, z: gz, y: got.y, r: grot, sup: got.sup }], gustNow()) };
    return prevRes;
  }
  const safety = (m) => Math.max(0, Math.min(1, m / 0.5));
  const meterColor = (m) => (m < 0 ? '#ef476f' : m < 0.08 ? '#ff8c42' : m < 0.2 ? '#ffd23f' : '#3ddc97');

  // ---------- the screen
  function mount(main, side) {
    gl = null; flat = null; fall = null; primed = false; seen = 0; yaw = 0; ghostFor = '';
    main.innerHTML = `<div class="wb"><div class="wb-hud"><span id="wbTower"></span><span id="wbGust"></span></div>
      <div class="wb-stage" id="wbStage">
        <div class="wb-meter" id="wbMeter" title="Wobble meter: how close the tower is to going over"><i id="wbFill"></i><b>📏</b></div>
        <div class="wb-block" id="wbBlock"></div>
        <div class="wb-view" id="wbView"><button class="ghost-btn" data-yaw="1" title="Walk round the tower to the left" aria-label="Turn the view left">⟲</button><button class="ghost-btn" data-yaw="-1" title="Walk round the tower to the right" aria-label="Turn the view right">⟳</button></div>
        <div class="wb-gift" id="wbGift" hidden><h3>🎁 Pick <span id="wbGiftTo"></span>'s block</h3><div class="wb-picks" id="wbPicks"></div></div>
      </div>
      <div class="wb-ctl" id="wbCtl">
        <div class="wb-pad" role="group" aria-label="Move the block">
          <button data-m="0,-1" aria-label="Away">▲</button>
          <button data-m="-1,0" aria-label="Left">◀</button><button data-m="1,0" aria-label="Right">▶</button>
          <button data-m="0,1" aria-label="Towards you">▼</button>
        </div>
        <button class="wb-rot" id="wbRot" title="Turn the block 45°">⟳ Turn</button>
        <button class="wb-place" id="wbPlace">🧱 Place</button>
      </div>
      <div class="wb-ctl wb-pctl" id="wbPCtl" hidden>
        <button id="wbPrev" aria-label="The plank before">◀</button>
        <div class="wb-feel" id="wbFeel"></div>
        <button id="wbNextP" aria-label="The next plank">▶</button>
        <button class="wb-place" id="wbPull">🪵 Pull</button>
      </div>
      <div class="wb-ctl wb-pctl" id="wbSCtl" hidden>
        <span class="wb-slotq">Set it on top:</span>
        <button class="wb-slot" data-slot="0">Edge</button><button class="wb-slot" data-slot="1">Middle</button><button class="wb-slot" data-slot="2">Edge</button>
      </div>
      <p id="wbHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Builders</h3><div id="wbCard"></div><h3 class="wb-h">Coming up</h3><div class="wb-next" id="wbNext"></div></div>';
    const stage = $('wbStage');
    $('wbCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !placing() || busy()) return;
      if (b.dataset.m) { const [dx, dz] = b.dataset.m.split(',').map(Number); nudge(dx, dz); }
      else if (b.id === 'wbRot') { grot = (grot + 1) % (V().current === 'ell' ? 8 : 4); ctx.sfx?.('tick'); }
      else if (b.id === 'wbPlace') return placeNow();
      controls();
    });
    $('wbPCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !pulling()) return;
      if (b.id === 'wbPull') return pullNow(sel && riskOf(sel, -1) < riskOf(sel, 1) ? -1 : 1);
      // ◀ ▶ step through the planks you may pull, from the top down
      const ids = Object.keys(V().blocks || {}).map(Number).sort((a, c) => { const A = blockOf(a), C = blockOf(c); return C.L - A.L || A.slot - C.slot; });
      if (!ids.length) return;
      const k = ids.indexOf(sel);
      choose(ids[(k < 0 ? 0 : k + (b.id === 'wbPrev' ? -1 : 1) + ids.length) % ids.length]);
    });
    $('wbSCtl').addEventListener('click', (e) => { const b = e.target.closest('button[data-slot]'); if (b && !b.disabled) stackNow(+b.dataset.slot); });
    $('wbView').onclick = (e) => { const b = e.target.closest('button[data-yaw]'); if (b) { yaw = Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4) + +b.dataset.yaw * Math.PI / 4; controls(); } };
    $('wbPicks').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b || !gifting()) return;
      ctx.sfx?.('pop');
      ctx.quiet(ctx.act('gift', { pick: +b.dataset.k }));
    });
    // drag (or tap) on the stage to move the ghost there
    stage.style.touchAction = 'none';
    let dragging = false;
    const fingers = new Map();
    let twist = null;  // two fingers: {a: their angle, yaw: the view's yaw then}
    const fAngle = () => { const [p, q] = [...fingers.values()]; return Math.atan2(q[1] - p[1], q[0] - p[0]); };
    const move = (e) => {
      const at = (gl || flat)?.pick?.(e.clientX, e.clientY);
      if (!at) return;
      const R = V().k.reach, sn = V().k.snap;
      const nx = +Math.max(-R, Math.min(R, Math.round(at[0] / sn) * sn)).toFixed(2), nz = +Math.max(-R, Math.min(R, Math.round(at[1] / sn) * sn)).toFixed(2);
      if (nx !== gx || nz !== gz) { gx = nx; gz = nz; controls(); }
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .wb-gift')) return;
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      if (fingers.size === 2 && gl) { dragging = false; pdrag = null; if (prog < 1) prog = 0; twist = { a: fAngle(), yaw }; return; }
      if (pullMode()) {
        const r3 = gl || flat;
        if (pulling()) {
          const id = r3?.pickBlock?.(e.clientX, e.clientY);
          if (id == null) return;
          if (!V().blocks?.[id]) { ctx.toast?.('Not from the top layers: pull one from lower down.'); return; }
          if (sel !== id) choose(id);
          else poke = { id, t0: performance.now() };
          pdrag = { id, x0: e.clientX, y0: e.clientY };
        } else if (stacking()) {
          const sl = r3?.pickSlot?.(e.clientX, e.clientY);
          if (sl != null) stackNow(sl);
        }
        return;
      }
      if (!placing() || busy()) return;
      dragging = true; move(e);
    });
    stage.addEventListener('pointermove', (e) => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
      if (twist && fingers.size === 2) { let d = fAngle() - twist.a; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw = twist.yaw + d; return; }
      if (pdrag && pulling() && sel === pdrag.id) {
        // slide the plank along its length: the drag measured along the plank as it looks on screen
        const u = (gl || flat)?.axis2d?.(pdrag.id) || [1, 0];
        const along = (e.clientX - pdrag.x0) * u[0] + (e.clientY - pdrag.y0) * u[1];
        if (Math.abs(along) > 6) pside = along < 0 ? -1 : 1;
        const was = prog;
        prog = Math.min(1, Math.abs(along) / 120);
        if (Math.floor(prog * 5) !== Math.floor(was * 5) && prog < 1) { ctx.sfx?.('tick'); if (riskOf(sel) > 0.2) ctx.buzz?.(8); }
        if (prog >= 1) { pdrag = null; pullNow(pside); }
        else controls();
        return;
      }
      if (dragging) move(e);
    });
    const stop = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) twist = null; dragging = false; if (pdrag) { pdrag = null; if (prog < 1) { prog = 0; controls(); } } };
    stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if ($('wbView')) { $('wbView').hidden = !gl; if (!gl) yaw = 0; } });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; }

  // ◀ ▶ ▲ ▼ move relative to where the camera stands (diagonally on the grid when it stands at a slant)
  function nudge(dx, dz) {
    const sn = V().k.snap, R = V().k.reach, c = Math.cos(yaw), s2 = Math.sin(yaw);
    const rx = dx * c - dz * s2, rz = dx * s2 + dz * c;  // (as a quarter turn of the view used to turn [dx, dz] → [-dz, dx])
    const mx = Math.abs(rx) > 0.38 ? Math.sign(rx) : 0, mz = Math.abs(rz) > 0.38 ? Math.sign(rz) : 0;
    gx = +Math.max(-R, Math.min(R, gx + mx * sn)).toFixed(2);
    gz = +Math.max(-R, Math.min(R, gz + mz * sn)).toFixed(2);
    ctx.sfx?.('tick');
  }

  // 🪵 pick a plank: it jiggles (a loose one more) and the chip says how it feels
  function choose(id) {
    sel = id; prog = 0; poke = { id, t0: performance.now() };
    const i = V().blocks?.[id];
    ctx.sfx?.('tick');
    if (i && i.g >= V().k.tight) ctx.buzz?.(14);
    controls();
  }
  function pullNow(sd) {
    if (!pulling() || sel == null || !V().blocks?.[sel] || performance.now() - sentAt < 600) return;
    pside = sd; prog = 1; sentAt = performance.now();
    const id = sel;
    ctx.sfx?.('whoosh'); ctx.buzz?.(18);
    ctx.quiet(ctx.act('pull', { id, side: sd }));
    setTimeout(() => { if (sel === id && V().tower.some((b) => b.id === id)) { prog = 0; controls(); } }, 1600);
    controls();
  }
  function stackNow(sl) {
    if (!stacking() || !V().open.includes(sl) || performance.now() - sentAt < 400) return;
    sentAt = performance.now();
    ctx.buzz?.(12);
    ctx.quiet(ctx.act('stack', { slot: sl }));
  }

  function placeNow() {
    if (!placing() || busy()) return;
    if (!preview()) { ctx.toast?.('Set it over the plinth or the tower.'); return; }
    ctx.buzz?.(12);
    ctx.quiet(ctx.act('place', { x: gx, z: gz, rot: grot }));
  }

  // a fresh block (or a fresh turn): start the ghost over the middle of the tower's top
  function resetGhost() {
    const v = V(), key = `${v.places}|${v.current}`;
    if (key === ghostFor) return;
    ghostFor = key;
    grot = 0;
    const top = v.tower.reduce((a, b) => (!a || b.y + v.shapes[b.s].h > a.y + v.shapes[a.s].h ? b : a), null);
    const sn = v.k.snap;
    gx = top ? +(Math.round(top.x / sn) * sn).toFixed(2) : 0; gz = top ? +(Math.round(top.z / sn) * sn).toFixed(2) : 0;
  }

  // 🪵 the controls in Pull & Stack: the plank's feel and risk, the meter, the slot buttons
  function pullControls() {
    const v = V(), on = pulling(), st = stacking();
    $('wbCtl').hidden = true;
    $('wbPCtl').hidden = v.phase === 'stack' && S.phase === 'playing';
    $('wbSCtl').hidden = !(v.phase === 'stack' && S.phase === 'playing');
    $('wbPCtl').classList.toggle('wb-off', !on);
    $('wbSCtl').classList.toggle('wb-off', !st);
    if (sel != null && !v.blocks?.[sel]) { sel = null; prog = 0; }
    for (const b of $('wbPCtl').querySelectorAll('button')) b.disabled = !on || (b.id === 'wbPull' && sel == null);
    $('wbPull').classList.toggle('wb-ready', on && sel != null);
    const info = sel != null ? v.blocks[sel] : null, feel = $('wbFeel');
    feel.innerHTML = '';
    if (info) {
      const [dot, word] = feelOf(info.g), b = blockOf(sel), r = riskOf(sel);
      feel.append(ctx.el('b', '', `${dot} ${word}`), ctx.el('span', '', ` · layer ${b.L + 1}`),
        ctx.el('i', info.m < 0 ? 'wb-warn' : '', info.m < 0 ? ' · 💥 it holds the tower up!' : ` · ${r < 0.01 ? 'safe' : `${Math.round(r * 100)}% risk`}`));
    } else feel.textContent = on ? 'Tap a plank' : '';
    for (const b of $('wbSCtl').querySelectorAll('button[data-slot]')) {
      const sl = +b.dataset.slot, open = v.open.includes(sl), m = v.slots?.[sl];
      b.disabled = !st || !open;
      b.style.borderColor = open && m != null ? meterColor(m) : '';
    }
    // the meter: the picked plank's risk the way you're sliding it, else how steady the tower is
    const risk = info ? riskOf(sel) : null, m = v.margin;
    $('wbFill').style.height = `${Math.round((risk != null ? risk : 1 - safety(m)) * 100)}%`;
    $('wbFill').style.background = risk != null ? riskColor(risk) : meterColor(m);
    $('wbMeter').classList.toggle('wb-danger', risk != null ? risk >= 0.3 : m < 0.08);
    $('wbMeter').title = risk != null ? `Chance the tower goes over: ${Math.round(risk * 100)}%` : 'Wobble meter';
    const L = Math.hypot(v.lean[0], v.lean[1]);
    $('wbBlock').innerHTML = '';
    if (S.phase === 'playing') {
      $('wbBlock').append(ctx.el('span', '', v.phase === 'stack' ? `🪵 ${S.turn === v.seats[v.me] ? 'Your' : `${ctx.player(S.turn)?.name ?? '?'}'s`} plank goes on layer ${v.layer + 1}` : `🪵 Lean ${(Math.atan(L) * 180 / Math.PI).toFixed(1)}° ${L > 0.004 ? arrow([v.lean[0] / L, v.lean[1] / L]) : ''}`));
    }
  }

  function controls() {
    if (pullMode()) return pullControls();
    $('wbCtl').hidden = false; $('wbPCtl').hidden = true; $('wbSCtl').hidden = true;
    const v = V(), on = placing() && !busy();
    for (const b of $('wbCtl').querySelectorAll('button')) b.disabled = !on;
    $('wbCtl').classList.toggle('wb-off', !on);
    const p = on ? preview() : null;
    $('wbPlace').classList.toggle('wb-ready', !!(on && p));
    $('wbPlace').disabled = !(on && p);
    // the meter: the predicted margin while you aim, else the tower's own
    const m = p ? p.m : v.tower.length ? v.margin : 1;
    $('wbFill').style.height = `${Math.round((p && p.m < 0 ? 1 : 1 - safety(m)) * 100)}%`;
    $('wbFill').style.background = meterColor(m);
    $('wbMeter').classList.toggle('wb-danger', m < 0.08);
    $('wbMeter').title = p ? (p.m < 0 ? 'Placed here, the tower goes over!' : `Wobble if placed here: ${Math.round((1 - safety(p.m)) * 100)}%`) : 'Wobble meter';
    const sh = v.shapes[v.current];
    $('wbBlock').innerHTML = '';
    if (S.phase === 'playing' && v.phase === 'place') {
      $('wbBlock').append(icon(v.current, 28), ctx.el('span', '', `${v.seats[v.me] === S.turn ? 'Your' : `${ctx.player(S.turn)?.name ?? '?'}'s`} block: ${sh.name}`));
      if (p && on && p.m < 0) $('wbBlock').append(ctx.el('b', 'wb-warn', '⚠️ it would fall'));
      else if (on && !p) $('wbBlock').append(ctx.el('b', 'wb-warn', '⬇ nothing under it'));
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = V();
    if (!primed) { primed = true; seen = v.last?.id ?? 0; }   // a topple from before you opened the page isn't replayed
    if (v.last && v.last.id !== seen) {
      seen = v.last.id;
      if (v.last.fall) { fall = { f: v.last.fall, t0: performance.now(), by: v.last.by }; ctx.sfx?.('crack'); gl?.topple(); }
      else if (v.last.kind === 'pull') { ctx.sfx?.(v.last.g >= v.k.tight ? 'pop' : 'whoosh'); gl?.pulled?.(v.last); flat?.pulled?.(v.last); }
      else ctx.sfx?.('place');
      sel = null; prog = 0; progV = 0; pdrag = null;
    }
    if (placing()) resetGhost();
    $('wbTower').textContent = pullMode()
      ? `🪵 Tower ${v.towers} · ${v.layer + (v.open.length === 3 ? 0 : 1)} layers · ${v.tower.length} planks`
      : `🧱 Tower ${v.towers} · ${v.tower.length} block${v.tower.length === 1 ? '' : 's'} · ${v.height.toFixed(1)} high`;
    const g = v.gust;
    $('wbGust').textContent = !g ? '' : g.in === 0 ? `🌬 GUST now ${arrow(g.dir)}` : g.in === 1 ? `🌬 Gust next turn ${arrow(g.dir)}` : `🌬 Gust in ${g.in} turns`;
    $('wbGust').classList.toggle('wb-gusting', !!g && g.in === 0);
    renderGift();
    renderCard();
    controls();
    hint();
  }

  // the camera looks at the tower from +z when yaw = 0, so +x is right and -z is away
  function arrow(d) {
    let [x, z] = d;
    const c = Math.cos(yaw), s2 = Math.sin(yaw);
    [x, z] = [x * c + z * s2, -x * s2 + z * c];
    const a = Math.round(Math.atan2(z, x) / (Math.PI / 4));
    return ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][(a + 8) % 8];
  }

  function hint() {
    const v = V();
    const t = S.phase !== 'playing' ? '' : busy() ? '💥 Down it comes…'
      : pullMode() ? (pulling() ? (sel == null ? 'Tap a plank to feel it (not from the top layers), then drag it out along its length. 🟢 loose ones are safest.'
        : 'Drag the plank out along its length (either end), or 🪵 Pull. A tight one drags the tower over with it!')
        : stacking() ? 'Tap a glowing spot on top (or Edge / Middle / Edge) to set your plank there.'
          : v.phase === 'stack' ? `${ctx.player(S.turn)?.name ?? '?'} is setting the plank on top…` : `Watch ${ctx.player(S.turn)?.name ?? '?'} pull a plank.`)
      : gifting() ? `Pick the block ${nameOf(nextSeat())} has to set next.`
        : placing() ? (V().gust?.in === 0 ? '🌬 A gust leans on the tower this turn: build against it! ' : '')
          + 'Drag the ghost block (or ◀ ▶ ▲ ▼), ⟳ turn it, then 🧱 Place. The 📏 meter shows the wobble.'
          : v.phase === 'gift' ? `${nameOf(v.placer)} is picking the next block…` : `Watch ${ctx.player(S.turn)?.name ?? '?'} build.`;
    if ($('wbHint').textContent !== t) $('wbHint').textContent = t;
  }

  function nextSeat() {
    const v = V(), n = v.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (v.placer + k) % n;
      if (v.lives[i] > 0 && ctx.player(v.seats[i])) return i;
    }
    return v.placer;
  }

  function renderGift() {
    const v = V(), box = $('wbGift');
    box.hidden = !gifting() || busy();
    if (box.hidden) return;
    $('wbGiftTo').textContent = nameOf(nextSeat());
    const picks = $('wbPicks');
    const key = v.next3.join(',');
    if (picks.dataset.key === key) return;
    picks.dataset.key = key; picks.innerHTML = '';
    v.next3.forEach((s, k) => {
      const b = ctx.el('button', 'wb-pick'); b.dataset.k = k;
      b.append(icon(s, 44), ctx.el('span', '', v.shapes[s].name));
      picks.append(b);
    });
  }

  function renderCard() {
    const v = V(), box = $('wbCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores wb-scores');
    v.seats.forEach((pid, i) => {
      const row = ctx.el('tr', S.turn === pid ? 'now' : v.lives[i] <= 0 ? 'wb-out' : '');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ctx.el('td', 'wb-lives', v.lives[i] > 0 ? '❤️'.repeat(v.lives[i]) + '🤍'.repeat(Math.max(0, v.maxLives - v.lives[i])) : '💀'),
        ctx.el('td', '', `⭐${v.stars[i]}`));
      t.append(row);
    });
    box.append(t);
    const nx = $('wbNext'); nx.innerHTML = '';
    nx.previousElementSibling.hidden = pullMode();
    for (const s of v.next3) { const d = ctx.el('div', 'wb-chip'); d.append(icon(s, 26), ctx.el('span', '', v.shapes[s].name)); nx.append(d); }
  }

  // a small isometric drawing of a block (SVG)
  function icon(shape, px) {
    const v = V(), sh = v.shapes[shape];
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    const iso = (x, y, z) => [(x - z) * 0.8, (x + z) * 0.42 - y * 0.9];
    // fit the drawing: small blocks are drawn as big as long ones (the name says which is which)
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [a, c, e, f] of rects(shape, 0)) {
      for (const [x, z] of [[a, c], [e, c], [e, f], [a, f]]) for (const y of [0, Math.min(sh.h, 2)]) {
        const [u, w] = iso(x, y, z); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, w); y1 = Math.max(y1, w);
      }
    }
    const span = Math.max(x1 - x0, (y1 - y0) * 1.1) + 0.3, cxv = (x0 + x1) / 2, cyv = (y0 + y1) / 2;
    svg.setAttribute('viewBox', `${cxv - span / 2} ${cyv - span / 2.2} ${span} ${span / 1.1}`);
    svg.setAttribute('width', px); svg.setAttribute('height', Math.round(px / 1.1)); svg.classList.add('wb-ico');
    const poly = (pts, fill) => { const p = document.createElementNS(NS, 'polygon'); p.setAttribute('points', pts.map((q) => iso(...q).join(',')).join(' ')); p.setAttribute('fill', fill); p.setAttribute('stroke', '#3b2414'); p.setAttribute('stroke-width', '0.06'); p.setAttribute('stroke-linejoin', 'round'); svg.append(p); };
    const h = Math.min(sh.h, 2) * 1.0;
    const ps = rects(shape, 0).sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [x0, z0, x1, z1] of ps) {
      if (sh.roof) {
        const cz = (z0 + z1) / 2;
        poly([[x0, 0, z1], [x1, 0, z1], [x1, h, cz], [x0, h, cz]], '#e8b878');
        poly([[x1, 0, z0], [x1, 0, z1], [x1, h, cz]], '#b07a42');
        continue;
      }
      poly([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], '#d59a5a');
      poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], '#a8703a');
      poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], '#f0c98e');
    }
    return svg;
  }

  // ---------- the tower to draw right now: [{b, pos [x,y,z], q [x,y,z,w] | null, gone}]
  function loop(now) {
    if (!$('wbStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.wobble) return;
    if (fall && now - fall.t0 > FALL_MS) { fall = null; controls(); hint(); renderGift(); }
    const moving = fall || placing() || gl?.moving?.() || V().tower.length;
    if (!moving && now - lastDraw < 66) return;
    const sliding = prog > 0 || progV > 0.002 || (poke && now - poke.t0 < 600) || stacking();
    if (!fall && !placing() && !sliding && now - lastDraw < 33) return;   // the sway is slow: ~30 fps is plenty
    progV += (prog - progV) * Math.min(1, (now - lastDraw) / 90);
    lastDraw = now;
    (gl || flat)?.draw(now);
  }

  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) paint(g, w, h);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  // ---------- three.js: world x = tower x, world z = tower z, y up; the plinth's top is y = 0
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x140d18);
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 400);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.1, hemi: [0xffe8cc, 0x2a1a2e, 0.8],
      key: { i: 0.95, color: 0xfff0dc, pos: [7, 18, 9], area: 9, near: 2, far: 50, map: 1024 },
      env: { walls: 0x2a1c22, floor: 0x3a2618, lamp: 0xfff0d8, accent: 0xd96b3a },
      sky: { top: 0x0d0a1e, horizon: 0x5a2f4e, bottom: 0x1a1016, band: 0.12, stars: 140 },
    });
    const low = stg.low;
    // a lamp hanging over the table, for warmth (the key light does the shadows)
    const lamp = new T.PointLight(0xffc98a, 0.5, 40); lamp.position.set(-4, 12, -3); scene.add(lamp);
    // the table: a big dark wooden top the plinth stands on
    const tableTex = canvasTex(T, 512, 512, (g, w, h) => {
      g.fillStyle = '#4a2d1a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = `rgba(${30 + Math.random() * 40},${15 + Math.random() * 20},8,${0.25 + Math.random() * 0.3})`;
        g.lineWidth = 1 + Math.random() * 3; g.beginPath();
        const y = Math.random() * h; g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 6);
        g.stroke();
      }
    });
    tableTex.wrapS = tableTex.wrapT = T.RepeatWrapping; tableTex.repeat.set(3, 3);
    const table = new T.Mesh(new T.CylinderGeometry(14, 14, 0.6, 48), new T.MeshStandardMaterial({ map: tableTex, roughness: 0.55, metalness: 0.05 }));
    table.position.y = -0.9; table.receiveShadow = true; scene.add(table);
    const TABLE = -0.6;
    // the plinth: a stone block with the snap grid scored into its top
    const P = V().k.plinth;
    const plinthTex = canvasTex(T, 256, 256, (g, w) => {
      g.fillStyle = '#b9b0a4'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 2500; i++) { const c = 140 + Math.random() * 80; g.fillStyle = `rgba(${c},${c - 6},${c - 14},.5)`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
      g.strokeStyle = 'rgba(70,55,45,.55)'; g.lineWidth = 2;
      for (let k = 1; k < 2 * P; k++) { const p = (k / (2 * P)) * w; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
      g.strokeStyle = 'rgba(60,40,30,.9)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, w - 6);
    });
    const side = new T.MeshStandardMaterial({ color: 0x9a8f84, roughness: 0.8 });
    const plinth = new T.Mesh(new T.BoxGeometry(2 * P, -TABLE, 2 * P), [side, side, new T.MeshStandardMaterial({ map: plinthTex, roughness: 0.75 }), side, side, side]);
    plinth.position.y = TABLE / 2; plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);

    // block parts: wood grain (light, so the owner's colour tints it) and a roof prism
    const woodTex = canvasTex(T, 256, 128, (g, w, h) => {
      g.fillStyle = '#efe4d2'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(120,80,40,${0.08 + Math.random() * 0.14})`; g.lineWidth = 1 + Math.random() * 2;
        g.beginPath(); const y = Math.random() * h; g.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i * 1.7) * 3);
        g.stroke();
      }
      g.strokeStyle = 'rgba(70,40,20,.35)'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
    });
    const mats = new Map();
    const matFor = (o) => {
      if (!mats.has(o)) {
        const c = o < 0 ? new T.Color(0xe9c690) : new T.Color(colorOf(o)).lerp(new T.Color(0xf3e3c8), 0.25);   // (🪵 the tower's own planks: plain wood)
        mats.set(o, new T.MeshStandardMaterial({ map: woodTex, color: c, roughness: 0.62, metalness: 0.02 }));
      }
      return mats.get(o);
    };
    const geos = new Map();
    function partGeo(w, d, h, roof) {
      const key = `${w}|${d}|${h}|${roof ? 1 : 0}`;
      if (geos.has(key)) return geos.get(key);
      let g;
      if (!roof) g = new T.BoxGeometry(w - 0.02, h - 0.01, d - 0.02);
      else {
        const along = w >= d, cs = along ? d : w, ln = along ? w : d;
        const s = new T.Shape(); s.moveTo(-cs / 2 + 0.01, -h / 2); s.lineTo(cs / 2 - 0.01, -h / 2); s.lineTo(0, h / 2); s.closePath();
        g = new T.ExtrudeGeometry(s, { depth: ln - 0.02, bevelEnabled: false });
        g.translate(0, 0, -(ln - 0.02) / 2);
        if (along) g.rotateY(Math.PI / 2);
      }
      geos.set(key, g);
      return g;
    }
    // one group per block, its origin at the block's centroid footprint centre and its bottom
    function blockMesh(b, mat) {
      const grp = new T.Group(), inner = new T.Group(), sh = V().shapes[b.s];
      inner.rotation.y = b.r % 2 ? -Math.PI / 4 : 0;  // (#125) an odd turn is 45° more
      grp.add(inner);
      for (const [x0, z0, x1, z1] of rects(b.s, b.r)) {
        const m = new T.Mesh(partGeo(x1 - x0, z1 - z0, sh.h, sh.roof), mat || matFor(b.o));
        m.position.set((x0 + x1) / 2, sh.h / 2, (z0 + z1) / 2);
        m.castShadow = !mat; m.receiveShadow = !mat;
        inner.add(m);
      }
      return grp;
    }
    const towerGrp = new T.Group(); scene.add(towerGrp);
    const meshes = new Map();   // block id → group (the standing tower)
    function syncTower(list) {
      const ids = new Set(list.map((b) => b.id));
      for (const [id, m] of meshes) if (!ids.has(id)) { towerGrp.remove(m); meshes.delete(id); }
      for (const b of list) {
        let m = meshes.get(b.id);
        if (!m) {
          m = blockMesh(b); meshes.set(b.id, m); towerGrp.add(m);
          m.userData.drop = (b.id === V().last?.block?.id) ? 1 : 0;   // the newest block drops into place
          m.userData.id = b.id;
        }
        m.userData.b = b;
        m.position.set(b.x, b.y, b.z);
      }
    }
    // the ghost: see-through, tinted by what placing it would do, with a ring for how far hands may slip
    const ghostMat = new T.MeshStandardMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.45, roughness: 0.4, depthWrite: false, emissive: 0x113322 });
    let ghost = null, ghostKey = '';
    const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    const foot = new T.Group(); scene.add(foot);
    const slip = new T.Mesh(new T.RingGeometry(0.9, 1, 40), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false }));
    slip.rotation.x = -Math.PI / 2; scene.add(slip);
    const drop = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.12, transparent: true, opacity: 0.6 }));
    scene.add(drop);
    // 🪵 the picked plank glows; open spots on top show as ghost planks; a pulled plank slides on out and away
    const selMat = new T.MeshStandardMaterial({ map: woodTex, color: 0xffe2a8, emissive: 0x9a6418, roughness: 0.5 });
    let selShown = null;
    const slotGrp = new T.Group(); towerGrp.add(slotGrp);
    const slotMats = [0, 1, 2].map(() => new T.MeshStandardMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.4, depthWrite: false, emissive: 0x113322 }));
    let slotKey = '';
    let outGo = null;   // {m, a: [ax, az], side, t0}
    function setMat(grp, mat) { grp.traverse((o) => { if (o.isMesh) o.material = mat; }); }
    function pulled(last) {
      if (outGo) { towerGrp.remove(outGo.m); outGo = null; }
      const m = blockMesh(last.block); m.position.set(last.block.x, last.block.y, last.block.z);
      towerGrp.add(m);
      const [ax, az] = axisOf(last.block);
      outGo = { m, a: [ax, az], side: last.side || 1, t0: performance.now() };
    }
    // gust: streaks of wind across the scene on a gust turn
    const NW = 40, wp = new Float32Array(NW * 6), wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.BufferAttribute(wp, 3));
    const wind = new T.LineSegments(wg, new T.LineBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.35 }));
    wind.frustumCulled = false; scene.add(wind);
    const wseed = Array.from({ length: NW }, () => [Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1, Math.random()]);
    // dust when the tower comes down
    const ND = 60, dp = new Float32Array(ND * 3), dv = [], dg = new T.BufferGeometry();
    dg.setAttribute('position', new T.BufferAttribute(dp, 3));
    const dust = new T.Points(dg, new T.PointsMaterial({ color: 0xd8c4a8, size: 0.18, transparent: true, opacity: 0, depthWrite: false }));
    dust.frustumCulled = false; scene.add(dust);
    let dustT = 0;
    // the falling blocks
    const fallGrp = new T.Group(); scene.add(fallGrp);
    let fallKey = null, fallParts = [];

    function buildFall(f) {
      fallGrp.clear(); fallParts = [];
      const falls = new Set(f.falls), base = f.tower[f.i];
      const up = new T.Vector3(0, 1, 0), dir = new T.Vector3(f.dir[0], 0, f.dir[1]).normalize();
      const axis = new T.Vector3().crossVectors(up, dir).normalize();
      const pv = new T.Vector3((f.pivot[0][0] + f.pivot[1][0]) / 2, base.y, (f.pivot[0][1] + f.pivot[1][1]) / 2);
      f.tower.forEach((b, i) => {
        const m = blockMesh(b); fallGrp.add(m);
        const p0 = new T.Vector3(b.x, b.y, b.z);
        fallParts.push({ m, p0, falls: falls.has(i),
          spin: new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), sp: 2 + Math.random() * 3,
          kick: new T.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5) });
      });
      fallKey = { f, axis, pv, dir };
    }
    const q = new T.Quaternion(), q2 = new T.Quaternion(), tmp = new T.Vector3();
    // 0–0.9 s: everything above the block that gave swings over the edge; then it tumbles off and lands
    function drawFall(t) {
      const { axis, pv, dir } = fallKey, T1 = 0.9;
      const th = Math.min(t, T1) / T1;
      const ang = th * th * 1.15;
      for (const fp of fallParts) {
        const m = fp.m;
        if (!fp.falls) { m.position.copy(fp.p0); m.quaternion.identity(); if (t > 0.9) m.position.x += Math.sin(t * 40) * 0.01 * Math.max(0, 1.6 - t); continue; }
        q.setFromAxisAngle(axis, ang);
        tmp.copy(fp.p0).sub(pv).applyQuaternion(q).add(pv);
        if (t <= T1) { m.position.copy(tmp); m.quaternion.copy(q); continue; }
        // free fall from where the swing left it, with the swing's speed carried on
        const s = t - T1, r = fp.p0.clone().sub(pv), lev = Math.max(0.6, r.length());
        const v = dir.clone().multiplyScalar(lev * 1.25).add(fp.kick);
        const x = tmp.x + v.x * s, z = tmp.z + v.z * s;
        let y = tmp.y + 0.6 * s - 4.9 * s * s;
        const off = Math.max(Math.abs(x), Math.abs(z)) > P + 0.3;
        const floor = off ? TABLE : 0;
        if (y < floor) y = floor + Math.abs(Math.sin(s * 6)) * 0.12 * Math.exp(-s * 3);
        m.position.set(x, y, z);
        q2.setFromAxisAngle(fp.spin, fp.sp * Math.min(s, 0.9));
        m.quaternion.copy(q).premultiply(q2);
      }
    }
    function topple() {
      for (let k = 0; k < ND; k++) {
        dp[k * 3] = (Math.random() - 0.5) * 3; dp[k * 3 + 1] = 0.1; dp[k * 3 + 2] = (Math.random() - 0.5) * 3;
        dv[k] = [(Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 2];
      }
      dustT = -0.9;   // the dust waits for the blocks to land
    }

    // camera: in front of the tower (view picks the side), raised to look at its top half
    const cam = { pos: new T.Vector3(0, 6, 14), look: new T.Vector3(0, 1, 0), tp: new T.Vector3(), tl: new T.Vector3(), moving: true, yaw: 0 };
    let lastT = 0, clatter = 0;
    function draw(now) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const v = V();
      const showFall = fall && fallKey?.f !== fall.f ? (buildFall(fall.f), true) : !!fall;
      fallGrp.visible = showFall; towerGrp.visible = !showFall;
      if (!showFall && fallGrp.children.length) { fallGrp.clear(); fallKey = null; }
      let H = v.height;
      if (showFall) {
        const t0 = (now - fall.t0) / 1000;
        // 🪵 a pulled tower comes down in slow motion for its first second and a half, then at full speed
        const t = pullMode() ? (t0 < 1.5 ? t0 * 0.5 : 0.75 + (t0 - 1.5) * 1.1) : t0;
        drawFall(t);
        H = Math.max(...fall.f.tower.map((b) => b.y + v.shapes[b.s].h));
        if (t > 1.2 && !clatter) { clatter = 1; ctx.sfx?.('thud'); if (!low) GL3.shake(camera, 0.35); }
      } else {
        clatter = 0;
        syncTower(v.tower);
        // the sway: bigger the closer the tower is to going over
        const m = v.tower.length ? Math.max(0, v.margin) : 1;
        const calm = window.motionOK && !motionOK() ? 0.3 : 1;
        const amp = v.tower.length ? Math.min(0.035, 0.0025 / (m + 0.04)) * calm : 0;
        towerGrp.rotation.x = Math.sin(now / 820) * amp; towerGrp.rotation.z = Math.sin(now / 1130 + 1) * amp * 0.8;
        for (const m2 of meshes.values()) {
          if (m2.userData.drop > 0) { m2.userData.drop = Math.max(0, m2.userData.drop - dt * 4); m2.position.y += m2.userData.drop * m2.userData.drop * 1.2; }
        }
        if (pullMode()) pullScene(now, calm);
      }
      // the ghost
      const aiming = placing() && !busy();
      const p = aiming ? preview() : null;
      if (ghost && (!aiming || ghostKey !== `${v.current}|${grot}`)) { scene.remove(ghost); ghost = null; foot.clear(); }
      if (aiming && !ghost) {
        ghostKey = `${v.current}|${grot}`;
        ghost = blockMesh({ s: v.current, r: grot, o: 0 }, ghostMat); scene.add(ghost);
        foot.rotation.y = grot % 2 ? -Math.PI / 4 : 0;
        for (const [x0, z0, x1, z1] of rects(v.current, grot)) {
          const s = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), shadowMat); s.rotation.x = -Math.PI / 2;
          s.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); foot.add(s);
        }
      }
      foot.visible = slip.visible = drop.visible = !!(aiming && p);
      if (ghost) {
        const y = p ? p.y : H;
        const hover = 0.9 + Math.sin(now / 300) * 0.08;
        ghost.position.set(gx, y + hover, gz);
        ghostMat.color.set(p ? meterColor(p.m) : '#9aa3b5');
        ghostMat.opacity = p ? 0.5 : 0.25;
        if (p) {
          foot.position.set(gx, p.y + 0.012, gz);
          const r = Math.max(0.05, v.k.shake * p.y * 2);
          slip.scale.setScalar(r); slip.position.set(gx, p.y + 0.02, gz);
          slip.visible = r > 0.06;
          drop.geometry.setFromPoints([new T.Vector3(gx, y + hover, gz), new T.Vector3(gx, y + 0.02, gz)]);
          drop.computeLineDistances();
        }
      }
      // gust streaks
      const gu = v.gust && v.gust.in === 0 && S.phase === 'playing' ? v.gust.dir : null;
      wind.visible = !!gu && !low;
      if (wind.visible) {
        for (let k = 0; k < NW; k++) {
          const s = wseed[k], ph = ((now / 1000) * (0.5 + s[3]) + s[3]) % 1;
          const along = (ph - 0.5) * 18, cx = gu[0] * along + -gu[1] * s[0] * 6, cz = gu[1] * along + gu[0] * s[0] * 6, y = 0.5 + s[1] * Math.max(4, H + 1);
          wp.set([cx, y, cz, cx + gu[0] * 1.2, y, cz + gu[1] * 1.2], k * 6);
        }
        wg.attributes.position.needsUpdate = true;
      }
      // dust
      if (dustT < 1.2 && fall) {
        dustT += dt;
        if (dustT > 0) {
          for (let k = 0; k < ND; k++) { dp[k * 3] += dv[k][0] * dt; dp[k * 3 + 1] += dv[k][1] * dt; dp[k * 3 + 2] += dv[k][2] * dt; dv[k][1] -= 0.8 * dt; }
          dg.attributes.position.needsUpdate = true;
          dust.material.opacity = Math.max(0, 0.6 * (1 - dustT / 1.2));
        }
      }
      dust.visible = !!fall && dustT > 0 && dustT < 1.2;
      // camera
      const tall = camera.aspect < 0.8;
      const top = Math.max(H, (p?.y ?? 0) + 1.5, 2);
      const dist = (tall ? 12 : 9) + top * (tall ? 1.15 : 0.8);
      const want = yaw + (placing() || pulling() || stacking() ? 0 : Math.sin(now / 9000) * 0.35);
      let dy = want - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const k = 1 - Math.exp(-dt * 3);
      cam.yaw += dy * k;
      cam.tp.set(Math.sin(cam.yaw) * dist, top * 0.75 + 4, Math.cos(cam.yaw) * dist);
      cam.tl.set(0, top * 0.45, 0);
      cam.pos.lerp(cam.tp, k); cam.look.lerp(cam.tl, k);
      cam.moving = cam.pos.distanceTo(cam.tp) > 0.02 || Math.abs(dy) > 0.002;
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      renderer.render(scene, camera);
    }
    // the point under the finger, on a level plane at the height the ghost would land (else the tower's top)
    const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
    function pick(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -(preview()?.y ?? V().height);
      return ray.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
    }
    // 🪵 the tower leans (its lean is a slope: x and z moved per unit of height); the picked plank slides out
    // along its length, dragging the tower with it, more the tighter it's held; spots on top glow when it's set
    function pullScene(now, calm) {
      const v = V(), lean = v.lean || [0, 0];
      let tx = lean[0], tz = lean[1];
      const sb = sel != null && pulling() ? meshes.get(sel) : null;
      if (sb) {
        const b = sb.userData.b, [ax, az] = axisOf(b), g = v.blocks?.[sel]?.g ?? 0, r = riskOf(sel);
        const out = progV * 1.75 * pside;
        sb.position.x += ax * out; sb.position.z += az * out;
        // the drag: the tower leans the way you pull and shudders as the plank scrapes past
        const tug = progV * (0.01 + 0.05 * g * g) * pside, shud = progV * (0.004 + 0.03 * r) * calm;
        tx += ax * tug + Math.sin(now / 37) * shud; tz += az * tug + Math.sin(now / 43 + 1) * shud;
      }
      if (poke && now - poke.t0 < 600) {
        const pm = meshes.get(poke.id), pb = pm?.userData.b;
        if (pb) {
          const [ax, az] = axisOf(pb), g = v.blocks?.[poke.id]?.g ?? v.grip?.[poke.id] ?? 0.5;
          const j = Math.sin((now - poke.t0) / 28) * (1 - (now - poke.t0) / 600) * (0.02 + 0.12 * (1 - g));
          pm.position.x += ax * j; pm.position.z += az * j;
        }
      }
      towerGrp.rotation.z += -Math.atan(tx); towerGrp.rotation.x += Math.atan(tz);
      if (selShown !== (sb ? sel : null)) {
        const old = selShown != null ? meshes.get(selShown) : null;
        if (old) setMat(old, matFor(old.userData.b.o));
        if (sb) setMat(sb, selMat);
        selShown = sb ? sel : null;
      }
      selMat.emissiveIntensity = 0.6 + 0.4 * Math.sin(now / 200);
      // the spots on top
      const st = stacking(), key = st ? `${v.layer}|${v.open.join(',')}|${v.tower.length}` : '';
      if (key !== slotKey) {
        slotKey = key; slotGrp.clear();
        if (st) {
          for (const sl of v.open) {
            const r = v.layer % 2 === 0 ? 0 : 2, x = v.layer % 2 === 0 ? 0 : sl - 1, z = v.layer % 2 === 0 ? sl - 1 : 0;
            const g2 = blockMesh({ s: 'plank', r, o: 0 }, slotMats[sl]);
            g2.position.set(x, v.layer * v.k.layerH, z); g2.userData.slot = sl;
            slotMats[sl].color.set(meterColor(v.slots?.[sl] ?? 0.5));
            slotGrp.add(g2);
          }
        }
      }
      for (const g2 of slotGrp.children) g2.position.y = v.layer * v.k.layerH + 0.25 + Math.sin(now / 260 + g2.userData.slot) * 0.08;
      for (const mt of slotMats) mt.opacity = 0.32 + 0.18 * Math.sin(now / 220);
      // the plank just pulled slides on out and drops away
      if (outGo) {
        const t = (now - outGo.t0) / 1000;
        if (t > 1.1) { towerGrp.remove(outGo.m); outGo = null; }
        else {
          const b = outGo.m.userData.b0 || (outGo.m.userData.b0 = { x: outGo.m.position.x, y: outGo.m.position.y, z: outGo.m.position.z });
          const d = 1.75 + t * 5;
          outGo.m.position.set(b.x + outGo.a[0] * d * outGo.side, b.y - Math.max(0, t - 0.35) ** 2 * 6, b.z + outGo.a[1] * d * outGo.side);
        }
      }
    }
    function pickBlock(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const h of ray.intersectObjects([...meshes.values()], true)) {
        let o = h.object;
        while (o && o.userData.id == null) o = o.parent;
        if (o) return o.userData.id;
      }
      return null;
    }
    function pickSlot(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(slotGrp.children, true)[0];
      let o = h?.object;
      while (o && o.userData.slot == null) o = o.parent;
      if (o) return o.userData.slot;
      // else the open spot nearest where the finger meets the top of the tower
      const v = V();
      plane.constant = -(v.layer * v.k.layerH + 0.25);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      const u = v.layer % 2 === 0 ? hit.z : hit.x;
      if (Math.abs(v.layer % 2 === 0 ? hit.x : hit.z) > 2.2 || Math.abs(u) > 2.2) return null;
      return v.open.reduce((a, sl) => (a == null || Math.abs(sl - 1 - u) < Math.abs(a - 1 - u) ? sl : a), null);
    }
    // which way a plank runs on screen (a unit vector in CSS pixels)
    function axis2d(id) {
      const m = meshes.get(id), b = m?.userData.b;
      if (!b) return [1, 0];
      const [ax, az] = axisOf(b), r = renderer.domElement.getBoundingClientRect();
      const p = new T.Vector3(b.x, b.y + 0.25, b.z).applyMatrix4(towerGrp.matrixWorld).project(camera);
      const q = new T.Vector3(b.x + ax, b.y + 0.25, b.z + az).applyMatrix4(towerGrp.matrixWorld).project(camera);
      const dx = (q.x - p.x) * r.width / 2, dy = -(q.y - p.y) * r.height / 2, l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      scene.traverse((o) => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material?.dispose?.(); });
      for (const g of geos.values()) g.dispose();
      woodTex.dispose(); tableTex.dispose(); plinthTex.dispose(); selMat.dispose(); slotMats.forEach((m) => m.dispose());
    }
    return { draw, resize, dispose, pick, topple, pulled, pickBlock, pickSlot, axis2d, moving: () => cam.moving };
  }

  // ---------- flat fallback: the tower from above, higher blocks lighter, the ghost outlined
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 40;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      k = Math.min(canvas.width, canvas.height) / (2 * (V().k.reach + 1.2));
    }
    const X = (x) => canvas.width / 2 + x * k, Z = (z) => canvas.height / 2 + z * k;
    // 🪵 Pull & Stack is drawn from the side at a slant (an isometric view), since from above you'd only see the top
    let iso = null, faces = [], slotFaces = [], out = null;
    const isoP = (x, y, z) => [iso.cx + (x - z) * 0.8 * iso.k, iso.cy + ((x + z) * 0.42 - y * 0.9) * iso.k];
    function box(x0, y0, z0, x1, y1, z1) {   // the three faces you can see: front (+z), side (+x), top
      return [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
        [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]].map((f) => f.map((q) => isoP(...q)));
    }
    function plankBox(b, dx = 0, dz = 0, dy = 0) {
      const [x0, z0, x1, z1] = rects(b.s, b.r)[0], h = V().shapes[b.s].h;
      return box(b.x + x0 + dx, b.y + dy, b.z + z0 + dz, b.x + x1 + dx, b.y + h + dy, b.z + z1 + dz);
    }
    function paint(fs, fill, alpha = 1, stroke = '#2a1a10', dash = false) {
      g.globalAlpha = alpha;
      const shades = [0.82, 0.62, 1.05];
      fs.forEach((f, j) => {
        g.beginPath(); f.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        if (fill) { g.fillStyle = fill; g.fill(); g.fillStyle = shades[j] < 1 ? `rgba(0,0,0,${1 - shades[j]})` : 'rgba(255,255,255,.18)'; g.fill(); }
        if (dash) g.setLineDash([5, 4]);
        g.strokeStyle = stroke; g.lineWidth = dash ? 2.5 : 1.2; g.stroke(); g.setLineDash([]);
      });
      g.globalAlpha = 1;
    }
    function drawPull(now) {
      const v = V(), P = v.k.plinth, lean = v.lean || [0, 0];
      let list = v.tower, gone = new Set(), t = 0;
      if (fall) { list = fall.f.tower; t = (now - fall.t0) / 1000; gone = new Set(fall.f.falls); }
      const H = Math.max(3, ...list.map((b) => b.y + 0.5)) + (stacking() ? 1 : 0.4);
      // fit: x - z spans ±2P, the height H plus the plinth's depth
      const kw = canvas.width / (4 * P * 0.8 + 1.2), kh = canvas.height / (H * 0.9 + 2 * P * 0.42 * 2 + 1);
      iso = { k: Math.min(kw, kh), cx: canvas.width / 2, cy: 0 };
      iso.cy = canvas.height - (2 * P * 0.42 + 0.5) * iso.k;
      g.fillStyle = '#1d1420'; g.fillRect(0, 0, canvas.width, canvas.height);
      paint(box(-P, -0.6, -P, P, 0, P), '#b9b0a4');
      faces = [];
      let sx = 0, sz = 0;
      const sb = sel != null && pulling() ? sel : null;
      if (sb != null) { const b = blockOf(sb), r = riskOf(sb); const tug = progV * (0.01 + 0.05 * (v.blocks?.[sb]?.g ?? 0) ** 2) * pside; const [ax, az] = axisOf(b); sx = ax * tug + Math.sin(now / 37) * progV * 0.03 * r; sz = az * tug; }
      const order = list.map((b, i) => [b, i]).sort(([a], [c]) => a.y - c.y || (a.x + a.z) - (c.x + c.z));
      for (const [b, i] of order) {
        const lx = fall ? 0 : (lean[0] + sx) * b.y, lz = fall ? 0 : (lean[1] + sz) * b.y;
        let dx = lx, dz = lz, dy = 0, alpha = 1;
        if (gone.has(i)) { const f = Math.min(1, Math.max(0, (t - 0.2) / 1.2)); dx += fall.f.dir[0] * f * 3; dz += fall.f.dir[1] * f * 3; dy = -f * f * 2; alpha = 1 - f; }
        if (b.id === sb) { const [ax, az] = axisOf(b); dx += ax * progV * 1.75 * pside; dz += az * progV * 1.75 * pside; }
        if (poke && poke.id === b.id && now - poke.t0 < 600) { const [ax, az] = axisOf(b), j = Math.sin((now - poke.t0) / 28) * (1 - (now - poke.t0) / 600) * 0.1; dx += ax * j; dz += az * j; }
        const fs = plankBox(b, dx, dz, dy);
        const pickable = pulling() && v.blocks?.[b.id];
        paint(fs, b.id === sb ? '#ffd98a' : b.o < 0 ? '#d9b07a' : colorOf(b.o), alpha, b.id === sb ? '#fff' : '#2a1a10');
        if (!fall) faces.push([b.id, fs, pickable]);
      }
      if (out) {
        const tt = (now - out.t0) / 1000;
        if (tt > 0.9) out = null;
        else { const [ax, az] = axisOf(out.b), d = (1.75 + tt * 5) * out.side; paint(plankBox(out.b, ax * d, az * d, -(Math.max(0, tt - 0.3) ** 2) * 6), '#d9b07a', 1 - tt); }
      }
      slotFaces = [];
      if (stacking()) {
        for (const sl of v.open) {
          const L = v.layer, b = { s: 'plank', r: L % 2 === 0 ? 0 : 2, x: L % 2 === 0 ? 0 : sl - 1, z: L % 2 === 0 ? sl - 1 : 0, y: L * v.k.layerH };
          const fs = plankBox(b, lean[0] * b.y, lean[1] * b.y, 0.3 + Math.sin(now / 260 + sl) * 0.08);
          paint(fs, meterColor(v.slots?.[sl] ?? 0.5), 0.45 + 0.15 * Math.sin(now / 220), '#fff', true);
          slotFaces.push([sl, fs]);
        }
      }
    }
    const inPoly = (pg, x, y) => { let c = false; for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) { const [xi, yi] = pg[i], [xj, yj] = pg[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const toCanvas = (cx, cy) => { const r = canvas.getBoundingClientRect(), s2 = canvas.width / r.width; return [(cx - r.left) * s2, (cy - r.top) * s2]; };
    function pickBlock(cx, cy) {
      const [x, y] = toCanvas(cx, cy);
      for (let i = faces.length - 1; i >= 0; i--) if (faces[i][1].some((f) => inPoly(f, x, y))) return faces[i][0];
      return null;
    }
    function pickSlot(cx, cy) {
      const [x, y] = toCanvas(cx, cy);
      for (let i = slotFaces.length - 1; i >= 0; i--) if (slotFaces[i][1].some((f) => inPoly(f, x, y))) return slotFaces[i][0];
      return null;
    }
    const axis2d = (id) => { const b = blockOf(id); return b && axisOf(b)[1] ? [-0.885, 0.465] : [0.885, 0.465]; };
    const pulled = (last) => { out = { b: last.block, side: last.side || 1, t0: performance.now() }; };
    function draw(now) {
      if (pullMode()) return drawPull(now);
      const v = V(), P = v.k.plinth;
      g.fillStyle = '#3a2416'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#b9b0a4'; g.fillRect(X(-P), Z(-P), 2 * P * k, 2 * P * k);
      g.strokeStyle = 'rgba(70,55,45,.4)'; g.lineWidth = 1;
      for (let t = -P + 1; t < P; t++) { g.beginPath(); g.moveTo(X(t), Z(-P)); g.lineTo(X(t), Z(P)); g.moveTo(X(-P), Z(t)); g.lineTo(X(P), Z(t)); g.stroke(); }
      let list = v.tower, gone = new Set(), t = 0;
      if (fall) { list = fall.f.tower; t = (now - fall.t0) / 1000; gone = new Set(fall.f.falls); }
      const H = Math.max(1, ...list.map((b) => b.y + v.shapes[b.s].h));
      list.forEach((b, i) => {
        const fade = gone.has(i) ? Math.min(1, Math.max(0, (t - 0.3) / 1.2)) : 0;
        const sl = gone.has(i) ? fade * 2.5 : 0;
        g.globalAlpha = 1 - fade;
        const c = colorOf(b.o), lift = (b.y + v.shapes[b.s].h) / H;
        const ox = fall ? fall.f.dir[0] * sl : 0, oz = fall ? fall.f.dir[1] * sl : 0;
        for (const [rc, , carry] of tops({ ...b, x: b.x + ox, z: b.z + oz })) {
          const path = () => { g.beginPath(); rc.forEach(([x, z], j) => (j ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath(); };
          path(); g.fillStyle = c; g.fill();
          g.fillStyle = `rgba(255,255,255,${0.35 * lift})`; g.fill();
          g.strokeStyle = '#2a1a10'; g.lineWidth = 2; g.stroke();
          if (v.shapes[b.s].roof) { g.fillStyle = '#fff8'; g.beginPath(); carry.forEach(([x, z], j) => (j ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath(); g.fill(); }
        }
        g.globalAlpha = 1;
      });
      if (placing() && !busy()) {
        const p = preview();
        g.setLineDash([6, 4]); g.lineWidth = 3; g.strokeStyle = p ? meterColor(p.m) : '#9aa3b5';
        for (const pg of parts(v.current, gx, gz, grot)) { g.beginPath(); pg.forEach(([x, z], j) => (j ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath(); g.stroke(); }
        g.setLineDash([]);
      }
    }
    function pick(cx, cy) {
      const r = canvas.getBoundingClientRect(), s = canvas.width / r.width;
      return [((cx - r.left) * s - canvas.width / 2) / k, ((cy - r.top) * s - canvas.height / 2) / k];
    }
    resize();
    return { draw, resize, pick, pickBlock, pickSlot, axis2d, pulled };
  }

  const turnText = (s) => (s.phase === 'playing' ? `${s.wobble.mode === 'pull' ? '🪵' : '🧱'} Tower ${s.wobble.towers}` : null);

  return { mount, render, unmount, turnText, focus: true, testMargin: (t, g) => margin(t, g), testLand: (...a) => land(...a) };
})();
