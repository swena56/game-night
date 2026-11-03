// Billiards: a top-down table on a canvas. The server simulates each shot and sends the ball paths
// (30 frames a second), which every phone plays back. The table stands upright on portrait screens.
UI.billiards = (() => {
  let S, ctx, raf = 0, ro = null, roRaf = 0, animEnd = 0, setTip = null;
  let dial = null, aim = 0, aimFor = null, power = 0.55, cuePos = null, drag = null, anim = null, seenShot = 0, lastShot = null;
  let spin = 0, english = 0, called = null, pushing = false;  // where the cue tip strikes: follow (+) / draw (−), right (+) / left (−); the pocket called for the 8
  let rolls = new Map();  // each ball's orientation, so it turns as it rolls (#33)
  let view = { z: 1, x: 0, y: 0 }, pinch = null, aimBefore = 0;  // two-finger zoom of the table (#28)
  const touches = new Map();
  let held = { dir: 0, since: 0, fine: false, last: 0 }, onKey = null, onKeyUp = null;  // ← → held to turn the cue
  // the 3D table (static/games/billiards3d.js): null until loaded, false without WebGL. The flat canvas stays as a fallback.
  let gl = null, view3d = false, camAt = null;
  const pref = (k, d) => { try { return localStorage.getItem('billiards.' + k) || d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('billiards.' + k, v); } catch {} };
  let cam = pref('cam', 'table');  // 3D camera: 'table' (the whole table, tilted) or 'cue' (behind the cue ball)
  const surf = () => (view3d && gl ? gl.canvas : $('blCanvas'));  // the canvas being shown
  let geo = null;  // canvas geometry: scale, rail width, portrait or not
  const $ = (id) => document.getElementById(id);
  const COLORS = ['#ffffff', '#f5c518', '#1f5fd1', '#d62828', '#6a2c91', '#f77f00', '#138a36', '#7a1f1f', '#111111'];
  const colorOf = (n) => COLORS[n > 8 ? n - 8 : n];
  const RAIL = 9;

  // ---------- geometry: table units <-> canvas pixels
  function layout() {
    const c = $('blCanvas'), stage = $('blStage');
    if (!c || !S) return;
    const B = S.billiards, dpr = Math.min(devicePixelRatio || 1, 2);
    const portrait = stage.clientWidth < (window.visualViewport?.height ?? innerHeight) * 0.8;
    const longSide = B.W + 2 * RAIL, shortSide = B.H + 2 * RAIL;
    // room for the table: the visible height less what sits above it (top bar, chips) and below it
    // (the shot controls and the game-info strip), so all of it is on screen without scrolling
    const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || innerHeight;
    const above = stage.getBoundingClientRect().top + scrollY, info = $('sideGame');
    const below = (stage.nextElementSibling?.offsetHeight ?? 60) + (info?.offsetParent ? info.offsetHeight + 10 : 0) + 30;
    const availH = Math.max(200, appH - Math.max(40, above) - below);
    const w = stage.clientWidth || 320;
    const k = portrait ? Math.min(w / shortSide, availH / longSide) : Math.min(w / longSide, availH / shortSide);
    const cw = Math.round((portrait ? shortSide : longSide) * k), ch = Math.round((portrait ? longSide : shortSide) * k);
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    geo = { k: k * dpr, css: k, portrait, focus: document.body.classList.contains('focus') };
    if (gl) { gl.canvas.style.width = cw + 'px'; gl.canvas.style.height = ch + 'px'; gl.resize(cw, ch, portrait); }
  }
  // table (x, y) -> canvas pixels; portrait puts the head (break end) at the bottom
  function toScreen(x, y) {
    const { k, portrait } = geo, W = S.billiards.W;
    return portrait ? [(RAIL + y) * k, (RAIL + W - x) * k] : [(RAIL + x) * k, (RAIL + y) * k];
  }
  function toTable(clientX, clientY) {
    if (view3d && gl) return gl.pick(clientX, clientY) || [-1e3, -1e3];
    const c = $('blCanvas'), r = c.getBoundingClientRect(), W = S.billiards.W;
    const k = geo.css * (r.width && parseFloat(c.style.width) ? r.width / parseFloat(c.style.width) : 1);  // allow for the zoom
    const sx = (clientX - r.left) / k - RAIL, sy = (clientY - r.top) / k - RAIL;
    return geo.portrait ? [W - sy, sx] : [sx, sy];
  }

  // ---------- state helpers
  const B = () => S.billiards;
  const ballMap = () => Object.fromEntries(B().balls.map(([n, x, y]) => [n, [x, y]]));
  const canShoot = () => ctx?.myTurn && S.phase === 'playing' && !anim;
  function cueAt() {
    if (B().inHand && cuePos) return cuePos;
    return ballMap()[0] || null;
  }
  function placeOk(x, y) {
    const b = B(), R = b.R;
    if (x < R || x > b.W - R || y < R || y > b.H - R) return false;
    if (b.inHand === 'kitchen' && x > b.headX) return false;
    return b.balls.every(([n, bx, by]) => n === 0 || Math.hypot(x - bx, y - by) >= 2 * R + 0.05);
  }
  function defaultCue() {
    const b = B(), own = ballMap()[0];
    if (own && placeOk(...own)) return own;
    for (let d = 0; d < 60; d += 1) for (const y of [b.H / 2 + d, b.H / 2 - d]) if (placeOk(b.headX, y)) return [b.headX, y];
    return [b.headX / 2, b.H / 2];
  }
  // Point at the nearest ball you're allowed to hit, so a fresh turn starts with a sensible aim.
  function defaultAim() {
    const cue = cueAt(), m = ballMap();
    if (!cue) return 0;
    const ts = B().targets.filter((n) => m[n]);
    if (!ts.length) return 0;
    const t = ts.reduce((a, n) => (Math.hypot(m[n][0] - cue[0], m[n][1] - cue[1]) < Math.hypot(m[a][0] - cue[0], m[a][1] - cue[1]) ? n : a));
    return Math.atan2(m[t][1] - cue[1], m[t][0] - cue[0]);
  }

  // ---------- aim guide: first ball or cushion along the aim line
  function trace(cue) {
    const b = B(), R = b.R, dx = Math.cos(aim), dy = Math.sin(aim);
    let best = { t: Infinity, ball: null };
    for (const [n, x, y] of b.balls) {
      if (n === 0) continue;
      const fx = x - cue[0], fy = y - cue[1], along = fx * dx + fy * dy;
      if (along <= 0) continue;
      const off2 = fx * fx + fy * fy - along * along, hit = 4 * R * R - off2;
      if (hit < 0) continue;
      const t = along - Math.sqrt(hit);
      if (t < best.t) best = { t, ball: [x, y] };
    }
    for (const [lo, hi, p, d] of [[R, b.W - R, cue[0], dx], [R, b.H - R, cue[1], dy]]) {
      if (d) { const t = ((d > 0 ? hi : lo) - p) / d; if (t > 0 && t < best.t) best = { t, ball: null }; }
    }
    return { gx: cue[0] + dx * best.t, gy: cue[1] + dy * best.t, ball: best.ball };
  }

  // ---------- aim guide prediction: the server's shot engine (simulate() in games/billiards.py, constants from
  // the view), run here so the guide shows where the balls really go. The cue ball skids then rolls, so after
  // the hit the cloth bends it forward (follow, or plain rolling) or back (draw) off the 90° tangent line, and
  // how far it bends depends on power. Runs only until the first hit's paths are long enough to draw.
  const OBJ_LEN = 55, CUE_LEN = 40;  // how much of each path to show, in table units
  let predKey = '', pred = null;
  function predict(cue) {
    const b = B(), P = b.phys;
    if (!P) return null;
    const key = [aim, power, spin, english, cue[0], cue[1], b.breaking, b.balls.map((a) => a.join()).join(';')].join('|');
    if (key === predKey) return pred;
    predKey = key;
    const brk = b.breaking && b.breakMaxSpeed, R = b.R, POCK = b.pockets, EDGES = b.edges || [], F = brk ? b.breakFriction : b.friction, NEAR = P.near, W = b.W, H = b.H;
    const balls = new Map();
    for (const [n, x, y] of b.balls) if (n !== 0) balls.set(n, [x, y, 0, 0, 0, 0, 0]);
    const speed = b.minSpeed + ((brk ? b.breakMaxSpeed : b.maxSpeed) - b.minSpeed) * power, ax = Math.cos(aim), ay = Math.sin(aim), top = P.tipK * spin * speed;
    const cb = [cue[0], cue[1], ax * speed, ay * speed, ax * top, ay * top, P.sideTip * english * speed];
    balls.set(0, cb);
    const cloth = (o, h) => {
      let [, , vx, vy, sx, sy] = o;
      if (o[6]) o[6] = Math.abs(o[6]) < 0.5 ? 0 : o[6] * (1 - P.sideDecay * h);
      let ux = vx - sx, uy = vy - sy;
      const u = Math.hypot(ux, uy);
      if (u > 0.5) {
        const a = Math.min(P.slide * h, u / 3.5);
        ux = (ux / u) * a; uy = (uy / u) * a;
        vx -= ux; vy -= uy; sx += 2.5 * ux; sy += 2.5 * uy;
        o[2] = vx; o[3] = vy; o[4] = sx; o[5] = sy; o[0] += vx * h; o[1] += vy * h;
        return true;
      }
      const v = Math.hypot(vx, vy), nv = v - F * h;
      if (nv < P.stop) { o[2] = o[3] = o[4] = o[5] = 0; return false; }
      o[2] = o[4] = (vx * nv) / v; o[3] = o[5] = (vy * nv) / v;
      o[0] += o[2] * h; o[1] += o[3] * h;
      return true;
    };
    const rail = (o, nx, ny) => {  // rail() in games/billiards.py: (nx, ny) points from the ball to the cushion
      const vn = o[2] * nx + o[3] * ny;
      if (vn <= 0) return;
      const e = P.cushionSoft - (P.cushionSoft - P.cushionHard) * Math.min(1, vn / P.cushionV);
      const jn = vn * (1 + e), tx = -ny, ty = nx, slip = o[2] * tx + o[3] * ty + o[6];
      const jt = Math.max(-P.railGrip * jn, Math.min(P.railGrip * jn, slip / 3.5));
      const jx = -jn * nx - jt * tx, jy = -jn * ny - jt * ty;
      o[2] += jx; o[3] += jy; o[4] += jx; o[5] += jy; o[6] -= 2.5 * jt;
    };
    const edges = (o) => {  // edges(): cushions, jaw points and facings; true if it touched one
      let x = o[0], y = o[1], hit = false;
      if (NEAR < x && x < W - NEAR && NEAR < y && y < H - NEAR) return false;
      for (const [x1, y1, x2, y2] of EDGES) {
        const dx = x2 - x1, dy = y2 - y1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
        const qx = x1 + t * dx - x, qy = y1 + t * dy - y, d = Math.hypot(qx, qy);
        if (d >= R || d === 0) continue;
        const nx = qx / d, ny = qy / d;
        x -= nx * (R - d); y -= ny * (R - d); o[0] = x; o[1] = y;
        rail(o, nx, ny); hit = true;
      }
      return hit;
    };
    let first = null, hit = null;  // the first ball the cue ball touches, and where both balls were at that moment
    const collide = (h) => {
      const live = [...balls];
      for (let i = 0; i < live.length; i++) {
        const [n1, b1] = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const [n2, b2] = live[j];
          if (!(b1[2] || b1[3] || b2[2] || b2[3])) continue;
          let dx = b2[0] - b1[0], dy = b2[1] - b1[1];
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          let d = Math.sqrt(d2), nx = dx / d, ny = dy / d, rel = (b1[2] - b2[2]) * nx + (b1[3] - b2[3]) * ny;
          if (rel <= 0) {
            const push = (2 * R - d) / 2;
            b1[0] -= nx * push; b1[1] -= ny * push; b2[0] += nx * push; b2[1] += ny * push;
            continue;
          }
          const wx = b2[2] - b1[2], wy = b2[3] - b1[3], w2 = wx * wx + wy * wy, dw = dx * wx + dy * wy;
          const back = w2 ? Math.min(h, (dw + Math.sqrt(Math.max(0, dw * dw - w2 * (d2 - 4 * R * R)))) / w2) : 0;
          for (const o of [b1, b2]) { o[0] -= o[2] * back; o[1] -= o[3] * back; }
          dx = b2[0] - b1[0]; dy = b2[1] - b1[1]; d = Math.hypot(dx, dy) || 2 * R; nx = dx / d; ny = dy / d;
          rel = (b1[2] - b2[2]) * nx + (b1[3] - b2[3]) * ny;
          const jj = (Math.max(0, rel) * (1 + P.bounce)) / 2;
          b1[2] -= jj * nx; b1[3] -= jj * ny; b2[2] += jj * nx; b2[3] += jj * ny;
          // throw: friction between the balls (collide() in games/billiards.py)
          const tx = -ny, ty = nx, sh = (b1[2] - b2[2]) * tx + (b1[3] - b2[3]) * ty + b1[6] + b2[6];
          const slip = Math.hypot(sh, (b1[4] + b2[4]) * nx + (b1[5] + b2[5]) * ny);
          if (jj && slip > 1e-9 && P.throw) {
            const jt = Math.sign(sh) * Math.min((P.throw * jj * Math.abs(sh)) / slip, Math.abs(sh) / 7);
            b1[2] -= jt * tx; b1[3] -= jt * ty; b2[2] += jt * tx; b2[3] += jt * ty;
            b1[6] -= 2.5 * jt; b2[6] -= 2.5 * jt;
          }
          if (first == null && (n1 === 0 || n2 === 0)) {
            first = n1 === 0 ? n2 : n1;
            const ob = n1 === 0 ? b2 : b1;
            hit = { cue: [cb[0], cb[1]], ball: [ob[0], ob[1]] };
          }
          for (const o of [b1, b2]) { o[0] += o[2] * back; o[1] += o[3] * back; }
        }
      }
    };
    // after the hit, follow both balls until each has gone its length, stopped, dropped or reached a cushion
    const paths = new Map(), done = new Set();
    const track = (n, o, wall) => {
      if (done.has(n)) return;
      const p = paths.get(n), [lx, ly] = p.pts[p.pts.length - 1];
      p.len += Math.hypot(o[0] - lx, o[1] - ly);
      p.pts.push([o[0], o[1]]);
      if (wall || p.len >= (n === 0 ? CUE_LEN : OBJ_LEN) || !(o[2] || o[3])) done.add(n);
    };
    let stopAt = null;
    for (let step = 0; step < 120 * 14; step++) {
      const fastest = Math.max(...[...balls.values()].map((o) => Math.abs(o[2]) + Math.abs(o[3])));
      const subs = Math.max(1, Math.ceil((fastest * P.dt) / R)), h = P.dt / subs;
      let moving = false;
      for (let s = 0; s < subs; s++) {
        moving = false;
        for (const o of balls.values()) if ((o[2] || o[3] || o[4] || o[5]) && cloth(o, h)) moving = true;
        if (!moving) break;
        const had = first;
        collide(h);
        if (had == null && first != null) {
          paths.set(0, { pts: [hit.cue], len: 0 }); paths.set(first, { pts: [hit.ball], len: 0 });
        }
        for (const [n, o] of [...balls]) {
          const inPocket = POCK.some(([px, py, cap]) => Math.hypot(o[0] - px, o[1] - py) < cap);
          if (inPocket) {
            if (paths.has(n) && !done.has(n)) { paths.get(n).pts.push([o[0], o[1]]); paths.get(n).sunk = true; done.add(n); }
            balls.delete(n);
            if (n === 0 && first == null) return (pred = { scratch: [o[0], o[1]] });
            continue;
          }
          const wall = edges(o);
          if (n === 0 && first == null && wall) return (pred = null);  // a cushion first: the plain aim line says it all
          if (paths.has(n) && wall) track(n, o, true);
        }
      }
      if (first == null && !(cb[2] || cb[3])) { stopAt = [cb[0], cb[1]]; break; }  // runs out before reaching anything
      for (const [n, p] of paths) if (!done.has(n)) { const o = balls.get(n); if (o) track(n, o, false); else done.add(n); }
      if (!moving || (paths.size && paths.size === done.size)) break;
    }
    if (stopAt) return (pred = { stop: stopAt });
    if (first == null) return (pred = null);
    return (pred = { ghost: hit.cue, ball: hit.ball, obj: paths.get(first), cue: paths.get(0) });
  }

  // ---------- drawing
  // ---------- shot playback: the cue's stroke (anim.lead seconds), then the balls; a replay runs slower
  const shotTime = () => (anim ? ((performance.now() - anim.start) / 1000) * anim.slow : 0);  // seconds into the shot
  function play(shot, age, slow = 1, replay = false) {
    const lead = shot.stroke ? B().lead || 0 : 0, dur = lead + shot.frames.length / 30;
    clearTimeout(animEnd);
    anim = age < dur ? { frames: shot.frames, order: shot.order, start: performance.now() - (age * 1000) / slow, lead, slow, replay,
      stroke: shot.stroke, called: shot.called } : null;
    if (anim) {
      anim.sounds = contacts(anim.frames, anim.order); anim.next = 0;
      // a timer (not the draw loop) ends the playback, so controls come back even where nothing draws
      animEnd = setTimeout(() => { anim = null; ctx?.rerender?.(); }, ((dur - age) * 1000) / slow);
    }
    if (replay) ctx?.rerender?.();  // (a live shot arrives inside render already)
  }
  function stopReplay() {
    if (!anim?.replay) return;
    clearTimeout(animEnd); anim = null; ctx?.rerender?.();
  }
  // the shooter's cue during the stroke: pulled back a little further, then driven through to the ball
  function strokeNow() {
    const st = anim?.stroke, t = shotTime(), L = anim?.lead;
    if (!st || !L || t > L + 0.12) return null;
    const u = Math.min(1, t / L), pull = st[1] * 1.25;
    const back = u < 0.35 ? st[1] + (pull - st[1]) * (u / 0.35) : pull * (1 - ((u - 0.35) / 0.65) ** 2);
    return { x: st[4], y: st[5], aim: st[0], power: Math.max(0, back), spin: st[2], english: st[3] };
  }

  // where the balls are now: a playing shot's frame (eased between the 30-a-second frames), or the resting table
  function ballsNow() {
    const b = B();
    let balls = b.balls.map(([n, x, y]) => [n, x, y]);
    if (anim) {
      const t = Math.max(0, (shotTime() - anim.lead) * 30), last = anim.frames.length - 1;
      const i = Math.min(last, Math.floor(t)), f = i < last ? t - i : 0, f0 = anim.frames[i], f1 = anim.frames[Math.min(last, i + 1)];
      balls = [];
      anim.order.forEach((n, j) => {
        const x0 = f0[2 * j], y0 = f0[2 * j + 1], x1 = f1[2 * j], y1 = f1[2 * j + 1];
        if (x0 < 0) return;
        balls.push(x1 < 0 ? [n, x0 / 10, y0 / 10] : [n, (x0 + (x1 - x0) * f) / 10, (y0 + (y1 - y0) * f) / 10]);
      });
      const st = anim.stroke, cue = st && shotTime() < anim.lead && balls.find(([n]) => n === 0);
      if (cue) { cue[1] = st[4]; cue[2] = st[5]; }  // still on its spot while the cue strokes
    } else if (b.inHand && canShoot()) {
      balls = balls.filter(([n]) => n !== 0);
      if (cuePos) balls.push([0, ...cuePos]);
    }
    return balls;
  }
  // where the cue ball heads after hitting the first ball: along the tangent, bent by follow or draw (table units)
  function deflection(cue, gx, gy, ball) {
    const ax = gx - cue[0], ay = gy - cue[1], am = Math.hypot(ax, ay) || 1, nx = ball[0] - gx, ny = ball[1] - gy, n = Math.hypot(nx, ny) || 1;
    const along = (ax * nx + ay * ny) / (am * n);
    let tx = ax / am - (along * nx) / n, ty = ay / am - (along * ny) / n;
    const tm = Math.hypot(tx, ty);
    if (tm < 0.05) return null;
    tx = tx / tm + (nx / n) * spin * along * 0.9; ty = ty / tm + (ny / n) * spin * along * 0.9;
    const m = Math.hypot(tx, ty) || 1, L = 44 * Math.min(1, tm + 0.2);
    return [(tx / m) * L, (ty / m) * L];
  }
  function draw3d() {
    const b = B(), shooting = !anim && canShoot(), cue = shooting ? cueAt() : null;
    let guide = null;
    if (cue) {
      const tr = trace(cue);
      guide = { mode: b.guide, cue, g: [tr.gx, tr.gy], ball: tr.ball, deflect: tr.ball && b.guide === 'full' ? deflection(cue, tr.gx, tr.gy, tr.ball) : null };
    }
    // behind-the-cue camera: follows the cue ball and the aim, but holds still while the cue ball is dragged or a shot plays
    const resting = ballMap()[0];
    if (!anim && drag !== 'cue') { const at = cue || resting; if (at) camAt = { x: at[0], y: at[1], aim }; }
    gl.render({
      balls: ballsNow(), animating: !!anim,
      stick: cue ? { x: cue[0], y: cue[1], aim, power, spin, english } : strokeNow(),
      guide, ring: shooting && b.inHand && cuePos ? { x: cuePos[0], y: cuePos[1], ok: placeOk(...cuePos) } : null,
      call: anim ? anim.called ?? null : b.calling && shooting ? called : null, callAll: !!(b.calling && shooting),
      cam: camAt,
    });
  }

  function draw() {
    if (view3d && gl && geo && S?.billiards) return draw3d();
    const c = $('blCanvas'), g = c?.getContext('2d');
    if (!g || !geo || !S?.billiards) return;
    const b = B(), { k } = geo, R = b.R;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    // rails, cloth, head line, pockets (drawn in table space)
    if (geo.portrait) g.setTransform(0, -k, k, 0, RAIL * k, (RAIL + b.W) * k); else g.setTransform(k, 0, 0, k, RAIL * k, RAIL * k);
    g.fillStyle = '#5b3a1e'; roundRect(g, -RAIL, -RAIL, b.W + 2 * RAIL, b.H + 2 * RAIL, 6); g.fill();
    g.fillStyle = '#7a4f2a'; roundRect(g, -RAIL + 1.5, -RAIL + 1.5, b.W + 2 * RAIL - 3, b.H + 2 * RAIL - 3, 5); g.fill();
    const cloth = g.createRadialGradient(b.W / 2, b.H / 2, 10, b.W / 2, b.H / 2, b.W * 0.6);
    cloth.addColorStop(0, '#1d8a4e'); cloth.addColorStop(1, '#0f5c33');
    g.fillStyle = cloth;
    if (b.edges?.length) {  // the cushion line, with each pocket's jaws angling in to the hole
      g.beginPath();
      for (const [x1, y1, x2, y2] of b.edges) { g.lineTo(x1, y1); g.lineTo(x2, y2); }
      g.closePath(); g.fill();
      g.strokeStyle = '#0b4a28'; g.lineWidth = 0.8; g.lineJoin = 'round';
      for (const [x1, y1, x2, y2] of b.edges) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    } else g.fillRect(0, 0, b.W, b.H);
    g.strokeStyle = '#ffffff33'; g.lineWidth = 0.4;
    g.beginPath(); g.moveTo(b.headX, 0); g.lineTo(b.headX, b.H); g.stroke();
    g.fillStyle = '#ffffff55'; g.beginPath(); g.arc(b.W * 0.73, b.H / 2, 0.7, 0, 7); g.fill();
    for (const [px, py, cap] of b.pockets) { g.fillStyle = '#050505'; g.beginPath(); g.arc(px, py, cap + 0.6, 0, 7); g.fill(); }
    // the pocket called for the 8: yours while you aim, the shooter's while a shot plays
    const call = anim ? anim.called : b.calling && canShoot() ? called : null;
    if (call != null && b.pockets[call]) {
      const [px, py, cap] = b.pockets[call];
      g.strokeStyle = '#ffd166'; g.lineWidth = 1.4; g.setLineDash([2, 1.5]);
      g.beginPath(); g.arc(px, py, cap + 3, 0, 7); g.stroke(); g.setLineDash([]);
    } else if (b.calling && canShoot()) {  // nothing called yet: every pocket pulses gently
      g.strokeStyle = `rgba(255, 209, 102, ${0.35 + 0.3 * Math.sin(performance.now() / 250)})`; g.lineWidth = 1;
      for (const [px, py, cap] of b.pockets) { g.beginPath(); g.arc(px, py, cap + 2.5, 0, 7); g.stroke(); }
    }
    for (const d of [0.25, 0.5, 0.75]) {  // rail diamonds
      g.fillStyle = '#e9d8a6';
      for (const [x, y] of [[b.W * d / 2, -RAIL / 2], [b.W / 2 + b.W * d / 2, -RAIL / 2], [b.W * d / 2, b.H + RAIL / 2], [b.W / 2 + b.W * d / 2, b.H + RAIL / 2], [-RAIL / 2, b.H * d], [b.W + RAIL / 2, b.H * d]]) {
        g.beginPath(); g.arc(x, y, 0.8, 0, 7); g.fill();
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    // balls: a playing shot's frame, or the resting table
    const balls = ballsNow();
    const rpx = R * k;
    if (!anim && canShoot()) drawGuide(g, rpx);
    const sk = strokeNow();
    if (sk) drawStick(g, [sk.x, sk.y], sk.aim, sk.power, sk.english, rpx);
    for (const [n, x, y] of balls) drawBall(g, n, ...toScreen(x, y), rpx);
    if (!anim && canShoot() && b.inHand && cuePos) {  // ball-in-hand ring
      const [sx, sy] = toScreen(...cuePos);
      g.strokeStyle = placeOk(...cuePos) ? '#ffb703' : '#ef476f'; g.lineWidth = 2 * (k / geo.css); g.setLineDash([4, 3]);
      g.beginPath(); g.arc(sx, sy, rpx * 2.2, 0, 7); g.stroke(); g.setLineDash([]);
    }
  }

  // the cue stick: a tapered wooden cue with a white ferrule and blue tip, pulled back further with more power
  function drawStick(g, cue, aim, power, english, rpx) {
    const lw = k1(), [sx, sy] = toScreen(...cue);
    const back = rpx + (6 + power * 46) * lw, len = Math.max(190 * lw, rpx * 34), dx = Math.cos(aim), dy = Math.sin(aim);
    const [ux, uy] = geo.portrait ? [dy, -dx] : [dx, dy];
    const [px, py] = [-uy, ux], tipW = Math.max(3 * lw, rpx * 0.55), buttW = tipW * 2.3;
    const off = english * rpx * 0.55;  // the stick lines up with where the tip will strike (side spin)
    const at = (d, w) => [sx - ux * d + px * (w + off), sy - uy * d + py * (w + off)];
    const wood = g.createLinearGradient(...at(back, 0), ...at(back + len, 0));
    wood.addColorStop(0, '#f1d9a8'); wood.addColorStop(0.62, '#c8925a'); wood.addColorStop(0.64, '#2b1a10'); wood.addColorStop(1, '#3d2414');
    g.fillStyle = '#0005';  // shadow
    g.beginPath(); g.moveTo(...at(back - 2 * lw, tipW / 2 + 3 * lw)); g.lineTo(...at(back + len, buttW / 2 + 3 * lw));
    g.lineTo(...at(back + len, -buttW / 2 + 3 * lw)); g.lineTo(...at(back - 2 * lw, -tipW / 2 + 3 * lw)); g.fill();
    g.fillStyle = wood;
    g.beginPath(); g.moveTo(...at(back, tipW / 2)); g.lineTo(...at(back + len, buttW / 2));
    g.lineTo(...at(back + len, -buttW / 2)); g.lineTo(...at(back, -tipW / 2)); g.closePath(); g.fill();
    g.fillStyle = '#f8f8f8'; g.beginPath(); g.moveTo(...at(back, tipW / 2)); g.lineTo(...at(back + 4 * lw, tipW / 2));
    g.lineTo(...at(back + 4 * lw, -tipW / 2)); g.lineTo(...at(back, -tipW / 2)); g.fill();
    g.fillStyle = '#3a86ff'; g.beginPath(); g.moveTo(...at(back - 1.5 * lw, tipW / 2)); g.lineTo(...at(back, tipW / 2));
    g.lineTo(...at(back, -tipW / 2)); g.lineTo(...at(back - 1.5 * lw, -tipW / 2)); g.fill();
  }

  function drawGuide(g, rpx) {
    const cue = cueAt();
    if (!cue) return;
    const guide = B().guide, { gx, gy, ball } = trace(cue), lw = k1();
    const [sx, sy] = toScreen(...cue), [ex, ey] = toScreen(gx, gy);
    drawStick(g, cue, aim, power, english, rpx);
    if (guide === 'off') return;
    const full = guide === 'full';
    if (!full) {  // the short guide: just which way the cue points
      const f = Math.min(1, (40 * lw) / Math.hypot(ex - sx, ey - sy || 1));
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.2 * lw; g.setLineDash([5 * lw, 4 * lw]);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (ex - sx) * f, sy + (ey - sy) * f); g.stroke(); g.setLineDash([]);
      return;
    }
    // the full guide runs the shot engine: the ghost ball sits where the cue ball really meets the first ball
    // (or where it stops short, or the pocket it would drop into), with both balls' real paths after the hit
    const p = predict(cue), end = p?.ghost || p?.stop || p?.scratch || [gx, gy], [hx, hy] = toScreen(...end);
    g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.2 * lw; g.setLineDash([5 * lw, 4 * lw]);
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke();
    g.strokeStyle = p?.scratch ? '#ef476f' : '#ffffffcc'; g.lineWidth = 1 * lw;
    if (!p?.stop) g.setLineDash([]);  // a dashed ghost: the cue ball runs out of pace and stops here
    g.beginPath(); g.arc(hx, hy, rpx, 0, 7); g.stroke(); g.setLineDash([]);
    const line = (path, colour, width, dash) => {
      if (!path || path.pts.length < 2) return;
      g.strokeStyle = colour; g.lineWidth = width * lw; g.setLineDash(dash ? [4 * lw, 3 * lw] : []);
      g.beginPath(); g.moveTo(...toScreen(...path.pts[0]));
      for (const pt of path.pts.slice(1)) g.lineTo(...toScreen(...pt));
      g.stroke(); g.setLineDash([]);
      if (path.sunk) { const [qx, qy] = toScreen(...path.pts[path.pts.length - 1]); g.beginPath(); g.arc(qx, qy, rpx * 0.7, 0, 7); g.stroke(); }
    };
    if (p?.ghost) {
      line(p.obj, '#ffd166', 1.6, false);  // where the object ball goes
      line(p.cue, '#bfe9ffcc', 1.4, true);  // and the cue ball, bent by its follow or draw
    } else if (!p && ball) {  // no prediction (an older server): the line of centres
      const [bx, by] = toScreen(...ball), nx = bx - ex, ny = by - ey, n = Math.hypot(nx, ny) || 1;
      g.strokeStyle = '#ffd166'; g.lineWidth = 1.6 * lw;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (nx / n) * 45 * lw, by + (ny / n) * 45 * lw); g.stroke();
      // and where the cue ball glances off: along the tangent, bent forward by follow or back by draw
      const ax = ex - sx, ay = ey - sy, am = Math.hypot(ax, ay) || 1, along = (ax * nx + ay * ny) / (am * n);
      let tx = ax / am - along * nx / n, ty = ay / am - along * ny / n;
      const tm = Math.hypot(tx, ty);
      if (tm > 0.05) {
        tx /= tm; ty /= tm;
        const bend = spin * along * 0.9;  // a fuller hit passes on more of the spin
        tx += (nx / n) * bend; ty += (ny / n) * bend;
        const m2 = Math.hypot(tx, ty) || 1, L = 70 * lw * Math.min(1, tm + 0.2);
        g.strokeStyle = '#bfe9ffcc'; g.lineWidth = 1.4 * lw; g.setLineDash([4 * lw, 3 * lw]);
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + (tx / m2) * L, ey + (ty / m2) * L); g.stroke(); g.setLineDash([]);
      }
    }
  }
  const k1 = () => geo.k / geo.css;  // device pixels per CSS pixel

  // ---------- rolling balls (#33): each ball keeps an orientation in screen space: p, the centre of its number
  // spot, and a, the axis its stripe runs round (also "up" for the printed number). Moving d pixels rolls it
  // d / r radians about the axis at right angles to the motion. Balls are shaded pixel by pixel on a small
  // canvas, redrawn only when they turn.
  const rot = (v, k, c, sn) => {  // Rodrigues: v turned about unit axis k
    const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const cx = k[1] * v[2] - k[2] * v[1], cy = k[2] * v[0] - k[0] * v[2], cz = k[0] * v[1] - k[1] * v[0];
    return [v[0] * c + cx * sn + k[0] * d * (1 - c), v[1] * c + cy * sn + k[1] * d * (1 - c), v[2] * c + cz * sn + k[2] * d * (1 - c)];
  };
  function rollTo(n, x, y, r) {
    let o = rolls.get(n);
    if (!o) { o = { p: [0, 0, 1], a: [0, -1, 0], x, y, ver: 1, img: null }; rolls.set(n, o); return o; }
    const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
    o.x = x; o.y = y;
    if (d < 0.01 || d > r * 12) return o;  // still, or put back on the table: no roll
    const k = [-dy / d, dx / d, 0], ang = d / r, c = Math.cos(ang), sn = Math.sin(ang);
    o.p = rot(o.p, k, c, sn); o.a = rot(o.a, k, c, sn);
    const m = Math.hypot(...o.p); o.p = o.p.map((v) => v / m);
    const dot = o.a[0] * o.p[0] + o.a[1] * o.p[1] + o.a[2] * o.p[2];  // keep a at right angles to p
    o.a = o.a.map((v, i) => v - dot * o.p[i]); const ma = Math.hypot(...o.a); o.a = o.a.map((v) => v / ma);
    o.ver++;
    return o;
  }
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  function ballImage(n, o, r) {
    const size = Math.max(4, Math.ceil(r * 2 * 2));  // drawn at twice the size, then scaled down: smooth edges
    if (o.img && o.imgVer === o.ver && o.img.width === size) return o.img;
    const cv = o.img?.width === size ? o.img : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const g = cv.getContext('2d'), im = g.createImageData(size, size), px = im.data, h = size / 2;
    const col = rgb(colorOf(n)), ivory = [251, 251, 242], red = [193, 18, 31], [p0, p1, p2] = o.p, [a0, a1, a2] = o.a;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - h) / h, y = (j + 0.5 - h) / h, z2 = 1 - x * x - y * y;
      if (z2 <= 0) continue;
      const z = Math.sqrt(z2), sp = x * p0 + y * p1 + z * p2;
      let c;
      if (n === 0) c = Math.abs(sp) > 0.975 ? red : ivory;  // the cue ball's two red dots show it turning
      else if (sp > 0.87) c = ivory;  // the number spot
      else if (n > 8) c = Math.abs(x * a0 + y * a1 + z * a2) < 0.5 ? col : ivory;
      else c = col;
      const k = (j * size + i) * 4;
      px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    // the number, printed on the spot: it leans with the ball and flattens as it rolls toward the edge
    if (n && p2 > 0.2) {
      const len = Math.hypot(p0, p1) || 1, ux = p0 / len, uy = p1 / len, f = p2;
      // flatten along the direction to the spot's centre (u), then turn the text so its top follows a
      const up = [a0 - (a0 * p0 + a1 * p1 + a2 * p2) * p0, a1 - (a0 * p0 + a1 * p1 + a2 * p2) * p1];
      const th = Math.atan2(up[0], -up[1]);
      g.save();
      g.translate(h + p0 * h, h + p1 * h);
      g.transform(1 - (1 - f) * ux * ux, -(1 - f) * ux * uy, -(1 - f) * ux * uy, 1 - (1 - f) * uy * uy, 0, 0);
      g.rotate(th);
      g.fillStyle = '#111'; g.font = `bold ${Math.round(h * 0.62)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, h * 0.04);
      g.restore();
    }
    o.img = cv; o.imgVer = o.ver;
    return cv;
  }
  function drawBall(g, n, x, y, r) {
    const o = rollTo(n, x, y, r);
    g.fillStyle = '#0006'; g.beginPath(); g.arc(x + r * 0.18, y + r * 0.22, r, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
    g.drawImage(ballImage(n, o, r), x - r, y - r, 2 * r, 2 * r);
    // shading in two parts so the glare never washes out the number: the rim darkens for roundness, and a
    // small tight highlight sits up by the top-left edge, clear of the spot when it faces up
    const rim = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    rim.addColorStop(0, '#00000000'); rim.addColorStop(1, '#00000048');
    g.fillStyle = rim; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    const hx = x - r * 0.5, hy = y - r * 0.5, shine = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.3);
    shine.addColorStop(0, '#ffffffb0'); shine.addColorStop(0.45, '#ffffff38'); shine.addColorStop(1, '#ffffff00');
    g.fillStyle = shine; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (held.dir && canShoot()) {  // a held arrow turns the cue, slowly at first, then faster (Shift: fine)
      const dt = Math.min(0.05, (now - held.last) / 1000), t = (now - held.since) / 1000;
      const rate = held.fine ? 0.04 : Math.min(1.6, 0.12 + 0.12 * t + 0.6 * t * t);  // radians a second
      if (t > 0.18) aim += held.dir * rate * dt;
    }
    held.last = now;
    draw(); shotSounds();
  }

  // ---------- keyboard: ← → turn the cue, ↑ ↓ power, Space shoots, W A S D move the cue ball in hand
  function setPower(p) {
    power = Math.max(0.05, Math.min(1, Math.round(p * 100) / 100));
    const el = $('blPower'); if (el) el.value = Math.round(power * 100);
    if ($('blPowerVal')) $('blPowerVal').textContent = Math.round(power * 100) + '%';
    if ($('blStroke')) $('blStroke').style.setProperty('--p', power);
  }
  function keyDown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, k = e.key;
    if (t?.isContentEditable || (t?.closest?.('input, textarea, select') && t.id !== 'blPower')) return;
    if (!$('blCanvas') || $('modal')?.hidden === false) return;  // not while a dialog is open
    if ((k === 'c' || k === 'C') && view3d && !t?.closest?.('button')) { setCam(cam === 'cue' ? 'table' : 'cue'); e.preventDefault(); return; }
    if (!canShoot()) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      if (!e.repeat || held.dir !== dir) {
        aim += dir * (e.shiftKey ? 0.0015 : 0.0045);  // one tap: about a quarter of a degree
        held = { dir, since: performance.now(), fine: e.shiftKey, last: performance.now() };
      }
      held.fine = e.shiftKey;
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      setPower(power + (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.01 : 0.05));
    } else if (k.length === 1 && k >= '0' && k <= '9' && !t?.closest?.('[role="slider"]')) {
      setPower(k === '0' ? 1 : +k / 10);  // number keys (#53): 1 = 10% … 9 = 90%, 0 = full power
    } else if ((k === ' ' || k === 'Enter') && !t?.closest?.('button, [role="slider"]')) {
      if (!e.repeat) shoot();
    } else if ((k === 'c' || k === 'C') && view3d) {
      setCam(cam === 'cue' ? 'table' : 'cue');
    } else if (B().inHand && k.length === 1 && 'wasd'.includes(k.toLowerCase())) {
      // nudge the cue ball in screen directions (the table stands upright on portrait screens)
      const key = k.toLowerCase(), step = e.shiftKey ? 0.5 : 2;
      let [sx, sy] = [key === 'a' ? -1 : key === 'd' ? 1 : 0, key === 'w' ? -1 : key === 's' ? 1 : 0];
      if (geo?.portrait) [sx, sy] = [-sy, sx];
      const b = B(), cur = cuePos || defaultCue();
      cuePos = [Math.max(b.R, Math.min(b.W - b.R, cur[0] + sx * step)), Math.max(b.R, Math.min(b.H - b.R, cur[1] + sy * step))];
    } else return;
    e.preventDefault();
  }
  function keyUp(e) {
    if ((e.key === 'ArrowLeft' && held.dir === -1) || (e.key === 'ArrowRight' && held.dir === 1)) held.dir = 0;
    if (e.key === 'Shift') held.fine = false;
  }

  // ---------- sound: the cue's tock, ball-on-ball clicks, cushion thumps and pocket drops
  // Found in the shot's frames, not sent by the server: a ball whose velocity jumps between frames hit
  // something, and a ball that vanishes went down. Loudness follows how hard the hit was.
  function contacts(frames, order) {
    const b = B(), R = b.R, out = [], at = (f, j) => (frames[f][2 * j] < 0 ? null : [frames[f][2 * j] / 10, frames[f][2 * j + 1] / 10]);
    const last = frames.length - 1, quiet = new Map(), pairs = new Map();
    const jolt = (f, j) => {  // how much ball j's velocity changed at frame f, in units a frame
      const a = f > 0 && f < last && at(f - 1, j), c = a && at(f, j), d = c && at(f + 1, j);
      return d ? Math.hypot(d[0] - 2 * c[0] + a[0], d[1] - 2 * c[1] + a[1]) : 0;
    };
    if (last < 1) return out;
    const p0 = at(0, order.indexOf(0)), p1 = at(1, order.indexOf(0));
    if (p0 && p1) out.push({ t: 0, kind: 'cue', v: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) });
    for (let f = 1; f < last; f++) {
      order.forEach((n, j) => {
        const a = at(f - 1, j), c = at(f, j), d = at(f + 1, j);
        if (c && !d) { out.push({ t: f / 30, kind: 'pocket', v: a ? Math.hypot(c[0] - a[0], c[1] - a[1]) : 3 }); return; }
        if (!a || !c || !d) return;
        const dv = jolt(f, j);
        if (dv < 0.5 || (quiet.get(n) ?? -9) > f - 3) return;  // friction and spin change it far less than an impact
        quiet.set(n, f);
        // another ball close by at this frame or the next means a ball-on-ball hit, else the cushion
        const reach = 2 * R + Math.hypot(d[0] - c[0], d[1] - c[1]) + 0.6;
        let other = -1, best = Infinity;
        order.forEach((m, k) => {
          if (k === j) return;
          for (const g of [f, f + 1]) {
            const p = at(g, k), q = at(g, j);
            if (p && q) { const dist = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dist < best) { best = dist; other = m; } }
          }
        });
        if (best < reach) {
          const key = Math.min(n, other) * 100 + Math.max(n, other);
          if ((pairs.get(key) ?? -9) > f - 3) return;  // both balls feel the same click
          pairs.set(key, f); quiet.set(other, f);
          const k = order.indexOf(other);  // an impact can straddle two frames: hear the whole of it
          out.push({ t: f / 30, kind: 'ball', v: Math.max(dv, jolt(f + 1, j), jolt(f, k), jolt(f + 1, k)) });
        } else out.push({ t: f / 30, kind: 'rail', v: Math.max(dv, jolt(f + 1, j)) });
      });
    }
    return out.sort((x, y) => x.t - y.t);
  }
  let actx = null;
  function voice(type, f0, f1, dur, vol, t) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, q, vol, t) {
    const len = Math.max(1, Math.floor(actx.sampleRate * dur)), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = buf; fl.type = 'bandpass'; fl.frequency.value = freq; fl.Q.value = q; g.gain.value = vol;
    s.connect(fl).connect(g).connect(actx.destination); s.start(t);
  }
  function clack(e, delay = 0) {
    if ((typeof prefs !== 'undefined' && !prefs.sound) || document.hidden) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + delay, h = Math.min(1, e.v / 12);  // 12 units a frame is a hard hit
      if (e.kind === 'ball') {  // a bright, hard click with a little ring
        const vol = 0.04 + 0.32 * h, p = 1 + (Math.random() - 0.5) * 0.08;
        voice('sine', 2600 * p, 2200 * p, 0.05, vol, t); voice('triangle', 4100 * p, 3600 * p, 0.025, vol * 0.5, t);
        noise(0.012, 5000, 1.5, vol * 1.6, t);
      } else if (e.kind === 'rail') {  // a dull rubber thump
        const vol = 0.04 + 0.28 * h;
        voice('sine', 170, 95, 0.09, vol, t); noise(0.03, 700, 1, vol * 0.9, t);
      } else if (e.kind === 'pocket') {  // a knock into the pocket, then a short rattle
        const vol = 0.12 + 0.18 * Math.min(1, e.v / 6);
        voice('triangle', 260, 140, 0.12, vol, t); noise(0.05, 900, 2, vol, t);
        [0.07, 0.12, 0.16].forEach((dt, i) => voice('sine', 1500 - i * 200, 1300 - i * 200, 0.03, vol * (0.35 - i * 0.08), t + dt));
      } else {  // the cue tip on the cue ball: a woody tock
        const vol = 0.06 + 0.24 * h;
        voice('triangle', 950, 620, 0.06, vol, t); noise(0.02, 2400, 2, vol * 1.2, t);
      }
    } catch {}
  }
  // play each contact once its moment in the shot comes (the draw loop calls this every frame)
  function shotSounds() {
    if (!anim?.sounds) return;
    const now = shotTime() - anim.lead;
    for (let n = 0; anim.next < anim.sounds.length && anim.sounds[anim.next].t <= now; ) {
      const e = anim.sounds[anim.next++];
      if (now - e.t < 0.15) clack(e, 0.007 * n++);  // the break's many clicks spread over a few ms instead of stacking  // a late joiner (or a tab back from the background) doesn't get a burst of old clicks
    }
  }

  // ---------- input
  function applyView() {
    const c = surf();
    if (!c) return;
    c.style.transform = view.z === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    $('blZoom').hidden = view.z === 1;
  }
  // two fingers on the table zoom (1–3×) and pan; the zoom centres on the fingers
  function onTouch(e, phase) {
    if (phase === 'down') touches.set(e.pointerId, [e.clientX, e.clientY]);
    else if (touches.has(e.pointerId) && phase === 'move') touches.set(e.pointerId, [e.clientX, e.clientY]);
    else if (phase === 'up') { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; return; }
    if (touches.size !== 2) return;
    const [[ax, ay], [bx, by]] = [...touches.values()], mid = [(ax + bx) / 2, (ay + by) / 2], d = Math.hypot(ax - bx, ay - by);
    if (!pinch) {  // a second finger: this is a pinch, not an aim
      if (drag === 'aim') aim = aimBefore;
      drag = dial = null;
      pinch = { d, mid, view: { ...view } };
      return;
    }
    const z = Math.min(3, Math.max(1, pinch.view.z * d / Math.max(10, pinch.d)));
    // the canvas's own top left, before the zoom (offsets ignore transforms)
    const c = surf(), box = c.parentElement.getBoundingClientRect(), left = box.left + c.offsetLeft, top = box.top + c.offsetTop;
    // keep the table point under the fingers' first midpoint under their current midpoint
    const ox = pinch.mid[0] - left - pinch.view.x, oy = pinch.mid[1] - top - pinch.view.y;
    view = { z, x: mid[0] - left - ox * (z / pinch.view.z), y: mid[1] - top - oy * (z / pinch.view.z) };
    if (z === 1) view = { z: 1, x: 0, y: 0 };
    applyView();
  }

  function pointer(e, phase) {
    if (phase === 'down' && anim?.replay) return stopReplay();  // a tap on the table ends a replay
    if (touches.size > 1 || pinch) return;
    if (!canShoot() || !geo) return;
    const [x, y] = toTable(e.clientX, e.clientY);
    if (phase === 'down' && B().calling) {  // on the 8: a tap on a pocket calls it
      const hit = B().pockets.findIndex(([px, py, cap]) => Math.hypot(x - px, y - py) < cap + 6);
      if (hit >= 0) { called = hit; ctx.rerender(); return; }
    }
    if (phase === 'down') {
      aimBefore = aim;
      const cue = cueAt();
      drag = B().inHand && cue && Math.hypot(x - cue[0], y - cue[1]) < B().R * 4 ? 'cue' : 'aim';
      // Aiming turns the cue like a dial: the drag rotates the current aim around the cue ball, so a
      // touch on the stick (behind the ball) or anywhere else never swings it round.
      if (drag === 'aim' && cue) dial = behind() ? { x0: e.clientX, aim0: aim } : { from: Math.atan2(y - cue[1], x - cue[0]), aim0: aim };
      try { surf().setPointerCapture(e.pointerId); } catch {}
    }
    if (!drag) return;
    if (drag === 'cue') {
      const b = B();
      cuePos = [Math.max(b.R, Math.min(b.W - b.R, x)), Math.max(b.R, Math.min(b.H - b.R, y))];
    } else {
      const cue = cueAt();
      if (dial && dial.x0 != null) aim = dial.aim0 + (e.clientX - dial.x0) * 0.0035;  // behind the cue: drag sideways to turn
      else if (cue && dial && Math.hypot(x - cue[0], y - cue[1]) > 3) {
        const turn = Math.atan2(y - cue[1], x - cue[0]) - dial.from;
        aim = dial.aim0 + Math.atan2(Math.sin(turn), Math.cos(turn));
      }
    }
    if (phase === 'up') drag = dial = null;
  }

  const behind = () => view3d && gl && cam === 'cue';

  // ---------- 3D table
  function load3d() {
    if (gl !== null || !S?.billiards) return;
    gl = undefined;  // loading
    GL3.load().then(() => {
      const stage = $('blStage');
      if (!stage || gl) return;
      gl = Billiards3D.create(stage, B(), { onLost: () => {  // the GPU context was lost (phone app switch): build a new table
        if (!gl) return;
        gl.dispose(); gl = null;
        if (view3d) { view3d = false; load3d(); }
      } }) || false;
      if (gl) {
        stage.insertBefore(gl.canvas, $('blZoom'));
        const c = gl.canvas;
        c.style.touchAction = 'none';
        c.addEventListener('pointerdown', (e) => pointer(e, 'down'));
        c.addEventListener('pointermove', (e) => pointer(e, 'move'));
        c.addEventListener('pointerup', (e) => pointer(e, 'up'));
        c.addEventListener('pointercancel', () => { drag = null; });
        gl.setMode(cam);
      }
      setView(!!gl);
    }).catch(() => { gl = false; setView(false); });
  }
  function setView(on) {
    if (on && gl === null) return load3d();
    if (gl === undefined) return;  // still loading
    view3d = on && !!gl;
    view = { z: 1, x: 0, y: 0 };
    for (const c of [$('blCanvas'), gl && gl.canvas]) if (c) c.style.transform = '';
    $('blZoom').hidden = true;
    $('blCanvas').hidden = view3d;
    if (gl) gl.canvas.hidden = !view3d;
    $('blView').hidden = gl === false;
    $('blView').textContent = view3d ? '▦ Flat' : '🧊 3D';
    $('blCam').hidden = !view3d;
    $('blCam').textContent = cam === 'cue' ? '🗺️ Whole table' : '🎥 Behind cue';
    layout();
  }
  function setCam(m) {
    cam = m; setPref('cam', m);
    gl?.setMode?.(m);
    setView(view3d);
  }

  function shoot() {
    if (!canShoot()) return;
    const extra = { angle: aim, power, spin, side: english };
    if (pushing && B().pushOk) extra.push = true;
    if (B().calling) {
      if (called == null) return ctx.toast('📣 Tap the pocket you\'re aiming the 8 at first.');
      extra.pocket = called;
    }
    if (B().inHand) {
      if (!cuePos || !placeOk(...cuePos)) { ctx.toast(B().inHand === 'kitchen' ? 'Put the cue ball behind the line first.' : 'The cue ball overlaps another ball.'); return; }
      extra.cue = cuePos;
    }
    ctx.quiet(ctx.act('shoot', extra));
  }

  // ---------- mount / render
  function mount(main, side) {
    view = { z: 1, x: 0, y: 0 }; pinch = null; touches.clear(); rolls = new Map(); spin = english = 0;
    dial = null; aim = 0; aimFor = null; power = 0.55; cuePos = null; drag = null; anim = null; seenShot = 0; lastShot = null; geo = null;
    gl = null; view3d = false; camAt = null;
    main.innerHTML = `<div class="bl"><div id="blStage" class="bl-stage"><canvas id="blCanvas"></canvas>
        <button id="blZoom" class="bl-zoom" hidden aria-label="Show the whole table">🔍 1×</button>
        <div class="bl-views"><button id="blView" hidden>🧊 3D</button><button id="blCam" hidden>🎥 Behind cue</button>
          <button id="blPush" hidden aria-pressed="false" title="9-ball: the first shot after the break may be a push-out. It needn't hit anything; your rival then shoots from there or hands it back.">🔀 Push out</button>
          <button id="blReplay" hidden title="Watch the last shot again, slowed down">⏪ Replay</button>
          <button id="blPass" hidden title="Make your rival shoot from where their push-out left the balls">↩️ Hand it back</button></div>
        <div class="bl-rackdone" id="blRackDone" hidden><h3 id="blRackTitle"></h3><div id="blStand"></div></div></div>
      <div class="bl-controls">
        <button id="blLeft" aria-label="Aim left">◀</button>
        <div class="bl-power"><div id="blStroke" class="bl-stroke" title="Pull the cue back: drag left from anywhere on the bar and let go to shoot. Tap to just set the power. Drag off the bar to cancel.">
            <i id="blFill"></i><span class="bl-cuestick"></span><span class="bl-marks"><em>break</em><em>hard</em><em>medium</em><em>soft</em></span>
            <input id="blPower" type="range" min="5" max="100" value="55" aria-label="Power"></div>
          <b id="blPowerVal">55%</b></div>
        <button id="blRight" aria-label="Aim right">▶</button>
        <div class="bl-spin"><div id="blSpin" class="bl-cueball" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100"
          aria-label="Where the cue strikes the cue ball (arrow keys move it, 0 centres it)"
          title="Tap where the cue hits the cue ball: high = follow, low = draw (back spin), left or right = side spin off the cushions. Double-tap to centre."><i id="blTip"></i></div>
          <small id="blSpinVal">centre</small></div>
        <button id="blShoot" class="primary">🎱 Shoot</button>
      </div></div>`;
    side.innerHTML = `<div class="panel bl-side">
      <div id="blStatus" class="seat-row"></div>
      <div id="blRacks" class="bl-racks"></div>
      <p class="hint left" id="blHint">Drag anywhere on the table to turn the cue around the ball. ◀ ▶ fine-tune. Pull the power bar back and let go to shoot. ✋ With ball in hand, drag the cue ball to move it.</p>
      <p class="hint left bl-keys">Keys: ← → turn the cue (hold to turn faster, Shift for fine aim) · ↑ ↓ or 1–9, 0 power · Space shoots · W A S D move the cue ball in hand · C switches the 3D camera.</p></div>`;
    const c = $('blCanvas');
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => pointer(e, 'down'));
    c.addEventListener('pointermove', (e) => pointer(e, 'move'));
    c.addEventListener('pointerup', (e) => pointer(e, 'up'));
    c.addEventListener('pointercancel', () => { drag = null; });
    const stage = $('blStage');
    stage.addEventListener('pointerdown', (e) => onTouch(e, 'down'), true);
    stage.addEventListener('pointermove', (e) => onTouch(e, 'move'), true);
    for (const t of ['pointerup', 'pointercancel']) stage.addEventListener(t, (e) => onTouch(e, 'up'), true);
    $('blZoom').onclick = () => { view = { z: 1, x: 0, y: 0 }; applyView(); };
    $('blView').onclick = () => { setPref('view', view3d ? '2d' : '3d'); setView(!view3d); };
    $('blCam').onclick = () => setCam(cam === 'cue' ? 'table' : 'cue');
    $('blReplay').onclick = () => (anim?.replay ? stopReplay() : !anim && lastShot && play(lastShot, 0, 0.6, true));
    $('blPush').onclick = () => { pushing = !pushing; ctx?.rerender?.(); };
    $('blPass').onclick = () => { if (canShoot()) ctx.quiet(ctx.act('pass')); };
    // the cue-ball pad (#34): where the tip strikes. Up/down is follow/draw, left/right is side spin.
    const pad = $('blSpin');
    setTip = (fx, fy) => {
      const m = Math.hypot(fx, fy);
      if (m > 1) { fx /= m; fy /= m; }  // stay on the ball
      english = Math.round(fx * 10) / 10 || 0; spin = Math.round(-fy * 10) / 10 || 0;  // || 0: no −0
      $('blTip').style.left = `${50 + english * 36}%`; $('blTip').style.top = `${50 - spin * 36}%`;
      const parts = [spin ? `${spin > 0 ? 'follow' : 'draw'} ${Math.abs(spin * 100)}%` : '', english ? `${english > 0 ? 'right' : 'left'} ${Math.abs(english * 100)}%` : ''].filter(Boolean);
      $('blSpinVal').textContent = parts.join(' · ') || 'centre';
      pad.setAttribute('aria-valuetext', $('blSpinVal').textContent);
    };
    let padDrag = false;
    const padAt = (e) => { const r = pad.getBoundingClientRect(); setTip(((e.clientX - r.left) / r.width - 0.5) / 0.36, ((e.clientY - r.top) / r.height - 0.5) / 0.36); };
    pad.onpointerdown = (e) => { if (!canShoot()) return; e.preventDefault(); padDrag = true; try { pad.setPointerCapture(e.pointerId); } catch {} padAt(e); };
    pad.onpointermove = (e) => padDrag && padAt(e);
    pad.onpointerup = pad.onpointercancel = () => { padDrag = false; };
    pad.ondblclick = () => canShoot() && setTip(0, 0);
    pad.onkeydown = (e) => {
      if (!canShoot()) return;
      const step = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.2], ArrowDown: [0, 0.2] }[e.key];
      if (step) { e.preventDefault(); setTip(english + step[0], -spin + step[1]); } else if (e.key === '0' || e.key === 'Home') setTip(0, 0);
    };
    setTip(0, 0);
    $('blPower').oninput = () => setPower($('blPower').value / 100);
    // the stroke bar (#48): a cue lying along the bar, its tip at the right. Press anywhere and drag left to
    // pull it back (power grows with the pull, the stick and guide follow live), let go to strike. A tap with
    // no pull just sets the power; dragging well off the bar cancels and puts the power back.
    const bar = $('blStroke');
    let stroke = null;
    const barPower = (e) => { const r = bar.getBoundingClientRect(); return r.width ? (r.right - e.clientX) / r.width : power; };
    bar.onpointerdown = (e) => {
      if (!canShoot()) return;
      e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch {}
      stroke = { x0: e.clientX, p0: power, pulled: false, off: false };
      bar.classList.add('pulling');
    };
    bar.onpointermove = (e) => {
      if (!stroke) return;
      const r = bar.getBoundingClientRect();
      stroke.off = e.clientY < r.top - 50 || e.clientY > r.bottom + 50;
      bar.classList.toggle('cancel', stroke.off);
      if (stroke.off) return setPower(stroke.p0);
      const pull = stroke.x0 - e.clientX;  // how far back from where the press started
      if (pull > 8) stroke.pulled = true;
      if (stroke.pulled) setPower(Math.max(0.05, pull / (r.width || 1)));
    };
    bar.onpointerup = (e) => {
      if (!stroke) return;
      const st = stroke; stroke = null;
      bar.classList.remove('pulling', 'cancel');
      if (st.off) return setPower(st.p0);
      if (st.pulled) shoot();
      else setPower(barPower(e));  // a tap: put the power where the tap was
    };
    bar.onpointercancel = () => { if (stroke) setPower(stroke.p0); stroke = null; bar.classList.remove('pulling', 'cancel'); };
    setPower(power);
    // turn the aim by about 0.25° per tap, faster while held
    for (const [id, dir] of [['blLeft', -1], ['blRight', 1]]) {
      let hold = null;
      const nudge = () => { aim += dir * 0.0045; };
      $(id).onpointerdown = (e) => { e.preventDefault(); nudge(); clearInterval(hold); hold = setInterval(nudge, 60); };
      $(id).onpointerup = $(id).onpointerleave = $(id).onpointercancel = () => clearInterval(hold);
    }
    $('blShoot').onclick = shoot;
    held = { dir: 0, since: 0, fine: false, last: 0 };
    onKey = keyDown; onKeyUp = keyUp;
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onKeyUp);
    // laid out on the next frame: resizing the canvas inside the callback re-triggers the observer and
    // the browser reports "ResizeObserver loop completed with undelivered notifications"
    ro = window.ResizeObserver ? new ResizeObserver(() => { cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(layout); }) : null;
    ro?.observe($('blStage')); ro?.observe(side);  // the info strip growing a line shrinks the table to match
    raf = requestAnimationFrame(tick);
  }

  function unmount() {
    cancelAnimationFrame(raf); cancelAnimationFrame(roRaf); clearTimeout(animEnd); ro?.disconnect(); setTip = null;
    if (onKey) { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onKeyUp); }
    onKey = onKeyUp = null; held.dir = 0;
    if (gl) gl.dispose();
    gl = null; view3d = false;
  }

  function render(s, c) {
    S = s; ctx = c;
    const b = B();
    if (!geo || geo.focus !== document.body.classList.contains('focus')) layout();
    if (gl === null && pref('view', '3d') === '3d') load3d();
    else if (gl === null) $('blView').hidden = false;
    // play a new shot from where it is now (late joiners skip ahead; old shots just show the result)
    if (b.shot && b.shot.id !== seenShot) {
      seenShot = b.shot.id;
      lastShot = b.shot;
      play(b.shot, b.shot.age);
    }
    // a fresh turn for me: aim at something sensible and put a placeable cue ball down
    const turnKey = `${S.turn}:${b.shot?.id ?? 0}`;
    if (ctx.myTurn && aimFor !== turnKey) {
      aimFor = turnKey; called = null; pushing = false;
      setTip?.(0, 0);  // each shot starts from a centre hit (#52), like the aim and the power do afresh
      cuePos = b.inHand ? defaultCue() : null;
      aim = defaultAim();
    }
    const me = S.me.id, mine = b.groups[me], turnName = ctx.player(S.turn)?.name ?? '';
    const pushText = pushing ? '🔀 Push out: no need to hit anything (a scratch is still a foul). Your rival then shoots from there or hands it back.'
      : b.pushOk ? '🔀 You may push out (button on the table), or play a normal shot. ' : '';
    const foulWarn = b.rules === '9' && (b.fouls?.[me] ?? 0) === 2 ? '⚠️ Two fouls in a row: one more loses. ' : '';
    const pushedBy = b.pushChoice === me ? ctx.player(Object.keys(b.fouls || {}).find((i) => i !== me))?.name ?? 'Your rival' : '';
    const callText = called == null ? '📣 On the 8: tap the pocket you\'re calling.' : '🎱 Sink the 8 in the called pocket to win!';
    $('blStatus').textContent = S.phase !== 'playing' ? (b.last || 'Game over')
      : ctx.myTurn ? (b.inHand ? (b.inHand === 'kitchen' ? '✋ Place the cue ball behind the line, then break.' : '✋ Ball in hand: drag the cue ball anywhere.')
          + (b.calling ? ` ${callText}` : '')
        : b.calling ? callText
        : b.breaking ? 'Your break!'
        : pushedBy ? `🔀 ${pushedBy} pushed out. Shoot from here (hit the ${b.targets[0]} first), or ↩️ hand it back.`
        : pushing ? pushText
        : b.rules === '9' ? foulWarn + pushText + (b.targets[0] === 9 ? '9️⃣ Only the 9 left: sink it to win!' : `Hit the ${b.targets[0]} first. Sink the 9 to win.`)
        : b.targets.length === 1 && b.targets[0] === 8 ? '🎱 Sink the 8 to win!' : 'Your shot.')
      : b.between ? `🏁 Rack ${b.rackNo} to ${ctx.player(b.rackWinner)?.name ?? '?'}. The next rack is coming up…`
      : S.turn ? (b.pushChoice === S.turn ? `🔀 ${turnName} decides: shoot from here or hand it back…` : `${turnName} is shooting…`) : '🎱 …';
    $('blPush').hidden = !(canShoot() && b.pushOk);
    $('blPush').classList.toggle('on', pushing);
    $('blPush').setAttribute('aria-pressed', String(pushing));
    $('blPass').hidden = !(canShoot() && b.pushChoice === me);
    $('blReplay').hidden = !lastShot || (anim && !anim.replay);
    $('blReplay').textContent = anim?.replay ? '⏹ Stop' : '⏪ Replay';
    $('blShoot').disabled = !canShoot();
    for (const id of ['blLeft', 'blRight', 'blPower']) $(id).disabled = !canShoot();
    $('blStroke').classList.toggle('off', !canShoot());
    $('blSpin').classList.toggle('off', !canShoot());
    // a match: racks won, and between racks a card with the score
    $('blRackDone').hidden = !b.between;
    if (b.between) {
      $('blRackTitle').textContent = `🏁 Rack ${b.rackNo} to ${ctx.player(b.rackWinner)?.name ?? '?'}`;
      standingsCard($('blStand'), b.standings, { title: `Race to ${b.race}`, note: 'The next rack is coming up. The break alternates.' });
    }
    // each player's remaining balls
    const racks = $('blRacks'); racks.innerHTML = '';
    if (b.race > 1) {
      const seats = Object.keys(b.racks || {}), row = ctx.el('div', 'bl-rack bl-match');
      row.append(ctx.el('b', '', `🏁 Race to ${b.race} · rack ${b.rackNo}`));
      row.append(ctx.el('span', '', seats.map((i) => `${ctx.player(i)?.name ?? '?'} ${b.racks[i]}`).join(' – ')));
      racks.append(row);
    }
    const onTable = new Set(b.balls.map(([n]) => n));
    if (b.rules === '9') {  // nine-ball: no groups, just the balls still up, lowest (the one to hit) first
      const row = ctx.el('div', 'bl-rack');
      row.append(ctx.el('b', '', 'Up next'));
      for (let n = 1; n <= 9; n++) {
        const dot = ctx.el('span', 'bl-dot' + (onTable.has(n) ? '' : ' gone') + (n === 9 ? ' stripe' : '') + (n === b.targets[0] ? ' next' : ''), String(n));
        dot.style.setProperty('--c', colorOf(n));
        row.append(dot);
      }
      racks.append(row);
    }
    for (const pid of b.rules === '9' ? [] : Object.keys(b.groups).length ? Object.keys(b.groups) : S.players.filter((p) => !p.spectator).map((p) => p.id)) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'bl-rack' + (pid === S.turn ? ' now' : ''));
      const name = ctx.el('b', '', p.name + (pid === me ? ' (you)' : '')); name.style.color = p.color;
      row.append(name);
      const g = b.groups[pid];
      if (!g) row.append(ctx.el('span', 'hint', ' open table'));
      else for (const n of g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]) {
        const dot = ctx.el('span', 'bl-dot' + (onTable.has(n) ? '' : ' gone') + (n > 8 ? ' stripe' : ''), String(n));
        dot.style.setProperty('--c', colorOf(n));
        row.append(dot);
      }
      racks.append(row);
    }
    if (mine) $('blHint').textContent = `You have ${mine === 'solids' ? '🔵 solids (1–7)' : '🟠 stripes (9–15)'}. Drag to turn the cue, ◀ ▶ fine-tune.`;
  }

  const turnText = (s) => s.phase !== 'playing' ? null : s.billiards.between ? '🏁 Next rack…' : s.billiards.inHand && s.turn === s.me.id ? '✋ Ball in hand' : null;
  return { mount, render, unmount, turnText, focus: true };
})();
