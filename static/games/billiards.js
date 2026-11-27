// Billiards: a top-down table on a canvas. The server simulates each shot and sends the ball paths
// (30 frames a second), which every phone plays back. The table stands upright on portrait screens.
UI.billiards = (() => {
  let S, ctx, raf = 0, ro = null, roRaf = 0, animEnd = 0, setTip = null;
  let dial = null, aimMode = '', aimModeAt = 0, aimShown = '', aim = 0, aimFor = null, power = 0.55, cuePos = null, drag = null, anim = null, seenShot = 0, lastShot = null;
  let spin = 0, english = 0, elev = 0, called = null, pushing = false;  // elev: the cue's butt raised, in degrees (swerve / massé, #45)
  // where the cue tip strikes: follow (+) / draw (−), right (+) / left (−); the pocket called for the 8
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
  const RAIL = 6;  // the flat view's wooden frame, in table units: thin, so the cloth gets the room

  // ---------- geometry: table units <-> canvas pixels
  function layout() {
    const c = $('blCanvas'), stage = $('blStage');
    if (!c || !S) return;
    const B = S.billiards, dpr = Fx2D.dpr();
    const portrait = stage.clientWidth < (window.visualViewport?.height ?? innerHeight) * 0.8;
    const longSide = B.W + 2 * RAIL, shortSide = B.H + 2 * RAIL;
    // room for the table: the measured stage (below the top bar and chips, above the dock) less the shot
    // controls when they sit under it. The game-info strip goes below and scrolls; the chip on the table
    // says whose turn it is. Held sideways on a phone the controls stand beside the table instead.
    // Focus mode on a wide screen: the table takes all the height and the info card and (when there is no
    // room under the table) the shot controls float over it, so the table is as big as the screen allows.
    const css = getComputedStyle(document.documentElement), controls = stage.nextElementSibling;
    const fill = !portrait && document.body.classList.contains('focus');
    const ctlH = controls?.offsetHeight ?? 60;
    const beside = !fill && controls && controls.offsetTop < stage.offsetTop + stage.offsetHeight;
    const below = fill ? 14 : beside ? 0 : ctlH + 10;
    const stageH = parseFloat(css.getPropertyValue('--stage-h')), arena = $('arena');
    let availH;
    if (stageH && arena) availH = stageH - (stage.getBoundingClientRect().top - arena.getBoundingClientRect().top) - below - 4;
    else {
      const appH = parseFloat(css.getPropertyValue('--app-h')) || innerHeight;
      availH = appH - Math.max(40, stage.getBoundingClientRect().top + scrollY) - below - 12;
    }
    availH = Math.max(200, availH);
    const w = stage.clientWidth || 320;
    const k = portrait ? Math.min(w / shortSide, availH / longSide) : Math.min(w / longSide, availH / shortSide);
    const cw = Math.round((portrait ? shortSide : longSide) * k), ch = Math.round((portrait ? longSide : shortSide) * k);
    const bl = stage.parentElement;
    bl.classList.toggle('bl-fill', fill);
    bl.classList.toggle('bl-over', fill && availH - ch < ctlH + 6);  // no room under the table: the controls float over it
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    geo = { k: k * dpr, css: k, portrait, focus: document.body.classList.contains('focus') };
    if (gl) {
      // #101: on a phone held upright the 3D overview takes the whole stage, not a 2:1 box in the middle of it: a
      // lower camera foreshortens the long table so it fits the height and the near end spans the width
      const tall = portrait && view3d && cam !== 'cue';  // (behind the cue keeps its box: a tall one is mostly backdrop)
      bl.classList.toggle('bl-tall', tall);  // the view buttons move to the far rail's middle, off the corner pocket
      const gw = tall ? w : cw, gh = tall ? Math.round(Math.max(ch, Math.min(availH, w * 1.75))) : ch;
      gl.canvas.style.width = gw + 'px'; gl.canvas.style.height = gh + 'px'; gl.resize(gw, gh, portrait);
    }
  }
  // table (x, y) -> canvas pixels; portrait puts the head (break end) at the bottom
  // (with the two-finger zoom applied: the table is drawn zoomed, not the picture scaled, so it stays sharp)
  function toScreen(x, y) {
    const { k, portrait } = geo, W = S.billiards.W, d = k / geo.css;
    const [px, py] = portrait ? [(RAIL + y) * k, (RAIL + W - x) * k] : [(RAIL + x) * k, (RAIL + y) * k];
    return [px * view.z + view.x * d, py * view.z + view.y * d];
  }
  function toTable(clientX, clientY) {
    if (view3d && gl) return gl.pick(clientX, clientY) || [-1e3, -1e3];
    const c = $('blCanvas'), r = c.getBoundingClientRect(), W = S.billiards.W;
    const k = geo.css * (r.width && parseFloat(c.style.width) ? r.width / parseFloat(c.style.width) : 1);
    const sx = (clientX - r.left - view.x) / view.z / k - RAIL, sy = (clientY - r.top - view.y) / view.z / k - RAIL;  // undo the zoom
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
    const key = [aim, power, spin, english, elev, cue[0], cue[1], b.breaking, b.balls.map((a) => a.join()).join(';')].join('|');
    if (key === predKey) return pred;
    predKey = key;
    const brk = b.breaking && b.breakMaxSpeed, R = b.R, POCK = b.pockets, EDGES = b.edges || [], F = brk ? b.breakFriction : b.friction, NEAR = P.near, W = b.W, H = b.H;
    const balls = new Map();
    for (const [n, x, y] of b.balls) if (n !== 0) balls.set(n, [x, y, 0, 0, 0, 0, 0]);
    // squirt: right english pushes the cue ball a little left of the stick's line
    const launch = aim - (P.squirt || 0) * english;
    // an elevated side hit also rolls the ball sideways while it skids, so it curves (simulate() in games/billiards.py)
    const tilt = (Math.max(0, Math.min(P.maxElev || 0, elev)) * Math.PI) / 180;
    const speed = (b.minSpeed + ((brk ? b.breakMaxSpeed : b.maxSpeed) - b.minSpeed) * power) * (1 - (P.elevLoss || 0) * Math.sin(tilt));
    const ax = Math.cos(launch), ay = Math.sin(launch), top = P.tipK * spin * speed, curve = (P.masseK || 0) * english * speed * Math.sin(tilt);
    const cb = [cue[0], cue[1], ax * speed, ay * speed, ax * top - ay * curve, ay * top + ax * curve, P.sideTip * english * speed * Math.cos(tilt)];
    balls.set(0, cb);
    const cloth = (o, h) => {
      let [, , vx, vy, sx, sy] = o;
      if (o[6]) {  // english wears off steadily (an older server sent an exponential rate, < 5)
        if (P.sideDecay < 5) o[6] = Math.abs(o[6]) < 0.5 ? 0 : o[6] * (1 - P.sideDecay * h);
        else o[6] = Math.abs(o[6]) <= P.sideDecay * h ? 0 : o[6] - Math.sign(o[6]) * P.sideDecay * h;
      }
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
            const mu = P.throw + (P.throwV ? P.throwSlow * Math.exp(-slip / P.throwV) : 0);  // grips more when slipping slowly
            const jt = Math.sign(sh) * Math.min((mu * jj * Math.abs(sh)) / slip, Math.abs(sh) / 7);
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
      anim.sounds = contacts(anim.frames, anim.order); anim.roll = rolling(anim.frames); anim.next = anim.nextFx = 0;
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
      // the full guide runs the shot engine, as the flat view does: where the cue ball really meets the first
      // ball (squirt, spin and all), or stops, or drops, and both balls' paths after the hit
      const p = b.guide === 'full' ? predict(cue) : null, end = p && (p.ghost || p.stop || p.scratch);
      if (end) guide = { mode: b.guide, cue, g: end, ball: p.ball, objPath: p.obj?.pts, cuePath: p.cue?.pts, stop: !!p.stop, scratch: !!p.scratch };
      else {
        const tr = trace(cue);
        guide = { mode: b.guide, cue, g: [tr.gx, tr.gy], ball: tr.ball, deflect: tr.ball && b.guide === 'full' ? deflection(cue, tr.gx, tr.gy, tr.ball) : null };
      }
    }
    // behind-the-cue camera: follows the cue ball and the aim, but holds still while the cue ball is dragged or a shot plays
    const resting = ballMap()[0];
    if (!anim && drag !== 'cue') { const at = cue || resting; if (at) camAt = { x: at[0], y: at[1], aim }; }
    gl.render({
      balls: ballsNow(), animating: !!anim, lucky: b.lucky ?? null,
      stick: cue ? { x: cue[0], y: cue[1], aim, power, spin, english } : strokeNow(),
      guide, ring: shooting && b.inHand && cuePos ? { x: cuePos[0], y: cuePos[1], ok: placeOk(...cuePos) } : null,
      call: anim ? anim.called ?? null : b.calling && shooting ? called : null, callAll: !!(b.calling && shooting),
      cam: camAt, follow: pref('shotcam', '1') === '1',
    });
  }

  // ---------- the flat view
  // The table itself (wood, cushions, cloth, pockets) is painted once into its own canvas for each size, zoom
  // and table, then copied in every frame; only the balls, the cue, the guide and the shot's effects are drawn live.
  const lowGfx = () => typeof gfxLevel === 'function' && gfxLevel() === 'low';
  const calm = () => typeof motionOK === 'function' && !motionOK();
  const LAMPS = [-0.33, 0, 0.33];  // the pool lamp's three shades, along the table's length (× its length), as in 3D
  let tableCache = null, tableKey = '', woodTile = null, fxp = null, fxLast = 0, sinks = [], trails = new Map();
  const fx2d = () => fxp || (fxp = Fx2D.create({ cap: 180 }));
  // canvas pixels <- table units, with the zoom (the transform toScreen uses)
  function tableSpace(g) {
    const { k, portrait } = geo, z = view.z, d = k / geo.css, W = B().W;
    g.setTransform(z, 0, 0, z, view.x * d, view.y * d);
    if (portrait) g.transform(0, -k, k, 0, RAIL * k, (RAIL + W) * k); else g.transform(k, 0, 0, k, RAIL * k, RAIL * k);
  }
  // varnished wood for the rails: grain lines wandering along the board, darker figure and pores (it tiles)
  function woodCanvas() {
    if (woodTile) return woodTile;
    const w = 512, h = 128, c = document.createElement('canvas'), g = c.getContext?.('2d');
    if (!g) return null;
    c.width = w; c.height = h;
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#6a3f1f'); base.addColorStop(0.5, '#7d4b26'); base.addColorStop(1, '#5e3519');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const line = (y0, amp, cyc, ph, col, lw) => {
      g.strokeStyle = col; g.lineWidth = lw;
      for (const oy of [-h, 0, h]) {  // wrapped top to bottom, and whole waves across, so the tile repeats cleanly
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, oy + y0 + Math.sin((x / w) * Math.PI * 2 * cyc + ph) * amp + Math.sin((x / w) * Math.PI * 6 * cyc + ph) * amp * 0.3);
        g.stroke();
      }
    };
    for (let i = 0; i < 8; i++) line(Math.random() * h, 4 + Math.random() * 8, 1, Math.random() * 7, `rgba(${Math.random() < 0.6 ? '45,22,8' : '160,100,55'},${0.07 + Math.random() * 0.08})`, 8 + Math.random() * 14);
    for (let i = 0; i < 70; i++) line(Math.random() * h, 1 + Math.random() * 5, 1 + Math.floor(Math.random() * 2), Math.random() * 7, `rgba(${Math.random() < 0.5 ? '40,20,8' : '150,95,50'},${0.08 + Math.random() * 0.2})`, 0.6 + Math.random() * 2);
    g.lineCap = 'round';
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * w, y = Math.random() * h, len = 3 + Math.random() * 10;
      g.strokeStyle = `rgba(30,14,5,${0.1 + Math.random() * 0.2})`; g.lineWidth = 0.6 + Math.random() * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (Math.random() - 0.5)); g.stroke();
    }
    return (woodTile = c);
  }
  const CUSH2 = 2.2;  // the flat view's cushion: from the cloth's edge this far out, then the wood
  function paintTable(b) {
    const c = $('blCanvas'), z = view.z;
    const key = [c.width, c.height, z, view.x, view.y, geo.portrait, geo.k, b.W, b.H, b.edges?.length, lowGfx()].join();
    if (tableCache && key === tableKey) return tableCache;
    const t = tableCache?.width === c.width && tableCache.height === c.height ? tableCache : Object.assign(document.createElement('canvas'), { width: c.width, height: c.height });
    const g = t.getContext?.('2d');
    if (!g) return null;
    tableKey = key; tableCache = t;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, t.width, t.height);
    tableSpace(g);
    const { W, H } = b, px = 1 / (geo.k * z), fine = !lowGfx();  // px: one canvas pixel, in table units
    // 1. the rails: varnished wood, its grain running along each rail, mitred at the corners
    roundRect(g, -RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 4); g.fillStyle = '#3e2412'; g.fill();
    const wc = fine && woodCanvas(), s = 1 / geo.k;  // a grain texel is about a screen pixel at 1×
    const grain = (across) => {
      const p = wc && g.createPattern(wc, 'repeat');
      if (!p) return '#7a4f2a';
      if (p.setTransform && window.DOMMatrix) p.setTransform(new DOMMatrix(across ? [0, s, -s, 0, 0, 0] : [s, 0, 0, s, 0, 0]));
      return p;
    };
    g.save();
    roundRect(g, -RAIL + 0.3, -RAIL + 0.3, W + 2 * RAIL - 0.6, H + 2 * RAIL - 0.6, 3.7); g.clip();
    g.fillStyle = grain(false); g.fillRect(-RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL);
    for (const [x0, x1] of [[-RAIL, 0], [W + RAIL, W]]) {  // the short rails, their grain turned
      g.save(); g.beginPath(); g.moveTo(x0, -RAIL); g.lineTo(x1, 0); g.lineTo(x1, H); g.lineTo(x0, H + RAIL); g.closePath(); g.clip();
      g.fillStyle = grain(true); g.fillRect(-RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL); g.restore();
    }
    // the varnish catches the lamp over the middle of the table; the ends of the rails fall into shadow
    const sheen = g.createLinearGradient(-RAIL, 0, W + RAIL, 0);
    sheen.addColorStop(0, 'rgba(0,0,0,0.28)'); sheen.addColorStop(0.2, 'rgba(255,225,180,0.06)'); sheen.addColorStop(0.5, 'rgba(255,225,180,0.1)');
    sheen.addColorStop(0.8, 'rgba(255,225,180,0.06)'); sheen.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = sheen; g.fillRect(-RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL);
    g.strokeStyle = 'rgba(25,10,3,0.6)'; g.lineWidth = px * 1.2;  // the mitre joints
    for (const [x0, y0, x1, y1] of [[-RAIL, -RAIL, 0, 0], [W + RAIL, -RAIL, W, 0], [-RAIL, H + RAIL, 0, H], [W + RAIL, H + RAIL, W, H]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.restore();
    // the rounded outer edge: a highlight where it turns over, and a dark line at the very edge
    g.lineWidth = 0.45; g.strokeStyle = 'rgba(255,222,175,0.2)';
    roundRect(g, -RAIL + 0.55, -RAIL + 0.55, W + 2 * RAIL - 1.1, H + 2 * RAIL - 1.1, 3.5); g.stroke();
    g.lineWidth = px * 1.5; g.strokeStyle = 'rgba(0,0,0,0.6)';
    roundRect(g, -RAIL + px, -RAIL + px, W + 2 * RAIL - 2 * px, H + 2 * RAIL - 2 * px, 4); g.stroke();
    // 2. rail sights: mother-of-pearl diamonds set in the middle of the wood
    const mid = (RAIL + CUSH2) / 2;
    for (const d of [0.25, 0.5, 0.75]) {
      for (const [x, y, along] of [[W * d / 2, -mid, 1], [W / 2 + W * d / 2, -mid, 1], [W * d / 2, H + mid, 1], [W / 2 + W * d / 2, H + mid, 1], [-mid, H * d, 0], [W + mid, H * d, 0]]) {
        const a = along ? 0.95 : 0.5, bb = along ? 0.5 : 0.95;
        g.beginPath(); g.moveTo(x - a, y); g.lineTo(x, y - bb); g.lineTo(x + a, y); g.lineTo(x, y + bb); g.closePath();
        const pearl = g.createRadialGradient(x - 0.2, y - 0.2, 0, x, y, 1);
        pearl.addColorStop(0, '#fffaf0'); pearl.addColorStop(0.6, '#eadfc3'); pearl.addColorStop(1, '#b9a57c');
        g.fillStyle = pearl; g.fill();
        g.strokeStyle = 'rgba(30,14,4,0.55)'; g.lineWidth = px; g.stroke();
      }
    }
    // 3. the cushions: green rubber under the cloth, from the wood to the playing edge, with a lit top
    g.fillStyle = '#106236'; g.fillRect(-CUSH2, -CUSH2, W + 2 * CUSH2, H + 2 * CUSH2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = px * 1.5; g.strokeRect(-CUSH2, -CUSH2, W + 2 * CUSH2, H + 2 * CUSH2);
    const clothPath = () => {
      g.beginPath();
      if (b.edges?.length) { for (const [x1, y1, x2, y2] of b.edges) { g.lineTo(x1, y1); g.lineTo(x2, y2); } g.closePath(); } else g.rect(0, 0, W, H);
    };
    g.lineJoin = 'round';
    clothPath(); g.strokeStyle = '#25965a'; g.lineWidth = 1.5; g.stroke();  // the cushion's nose, half of it showing past the cloth
    // 4. pockets: a leather rim round each hole, over the rail
    for (const [x, y, cap] of b.pockets) {
      const rim = g.createRadialGradient(x, y, cap, x, y, cap + 1.6);
      rim.addColorStop(0, '#120a05'); rim.addColorStop(0.4, '#55361f'); rim.addColorStop(0.75, '#3a2414'); rim.addColorStop(1, '#1a0e06');
      g.fillStyle = rim; g.beginPath(); g.arc(x, y, cap + 1.6, 0, 7); g.fill();
    }
    // 5. the cloth: lit by the three shades, falling off toward the rails, a little worn down the long string
    const cloth = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
    cloth.addColorStop(0, '#1b8a4c'); cloth.addColorStop(1, '#0e5a32');
    clothPath(); g.fillStyle = cloth; g.fill();
    g.save(); clothPath(); g.clip();
    for (const f of LAMPS) {
      const cx = W / 2 + f * W, r = H * 0.66, lamp = g.createRadialGradient(cx, H / 2, 0, cx, H / 2, r);
      lamp.addColorStop(0, 'rgba(215,255,205,0.13)'); lamp.addColorStop(0.55, 'rgba(215,255,205,0.05)'); lamp.addColorStop(1, 'rgba(215,255,205,0)');
      g.fillStyle = lamp; g.fillRect(cx - r, H / 2 - r, 2 * r, 2 * r);
    }
    if (fine) {
      g.save(); g.translate(W / 2, H / 2); g.scale(W * 0.42, H * 0.12);  // a pale track worn down the long string
      const wear = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      wear.addColorStop(0, 'rgba(170,220,175,0.07)'); wear.addColorStop(1, 'rgba(170,220,175,0)');
      g.fillStyle = wear; g.beginPath(); g.arc(0, 0, 1, 0, 7); g.fill(); g.restore();
    }
    // the cushions' shadow on the cloth along their noses
    clothPath(); g.strokeStyle = 'rgba(0,22,8,0.22)'; g.lineWidth = 3; g.stroke();
    g.lineWidth = 1.1; g.strokeStyle = 'rgba(0,22,8,0.3)'; g.stroke();
    if (fine) clothGrain(g);
    g.restore();
    g.strokeStyle = '#ffffff30'; g.lineWidth = 0.35;  // head string and foot spot
    g.beginPath(); g.moveTo(b.headX, 0); g.lineTo(b.headX, H); g.stroke();
    g.fillStyle = '#ffffff55'; g.beginPath(); g.arc(W * 0.73, H / 2, 0.7, 0, 7); g.fill();
    // 6. the holes: you look down past the cloth's lip into the dark of the pocket
    for (const [x, y, cap] of b.pockets) {
      const r = cap + 0.6, hole = g.createRadialGradient(x, y, 0, x, y, r);
      hole.addColorStop(0, '#000'); hole.addColorStop(0.6, '#030201'); hole.addColorStop(0.86, '#140c07'); hole.addColorStop(1, '#2c1d12');
      g.fillStyle = hole; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = px * 1.5; g.stroke();
    }
    return t;
  }

  // ---------- the shot's life: a spark where balls meet, a puff of chalk off the tip, dust off the cushions,
  // and a potted ball dropping into its pocket. Played from the same contacts as the sounds, sound on or off.
  function shotFx() {
    if (!anim?.sounds) return;
    const now = shotTime() - anim.lead;
    while (anim.nextFx < anim.sounds.length && anim.sounds[anim.nextFx].t <= now) {
      const e = anim.sounds[anim.nextFx++];
      if (now - e.t < 0.15) hitFx(e);
    }
  }
  const nearestPocket = (p) => B().pockets.reduce((a, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a));
  function hitFx(e) {
    if (view3d && gl) return gl.effect?.(e, anim?.stroke?.[0]);
    if (lowGfx() || !geo || !e.p) return;
    const fx = fx2d(), lw = k1(), rpx = B().R * geo.k * view.z, h = Math.min(1, e.v / 12), [sx, sy] = toScreen(...e.p);
    if (e.kind === 'pocket') {
      const p = nearestPocket(e.p), [qx, qy] = toScreen(p[0], p[1]);
      if (!calm()) sinks.push({ n: e.n, from: e.p, to: p, t0: performance.now() });
      fx.ring(qx, qy, { r0: rpx * 1.1, r1: rpx * 2.6, color: 'rgba(255,209,102,0.75)', width: 2 * lw, life: 0.45 });
    } else if (e.kind === 'ball') {
      if (h > 0.1) fx.spark(sx, sy, 1 + Math.round(h * 4), { color: '#fff4d6', speed: [15 * lw, (30 + 120 * h) * lw], size: [1 * lw, (1.4 + 2.2 * h) * lw], life: [0.12, 0.3] });
      if (h > 0.3) fx.ring(sx, sy, { r0: rpx * 0.4, r1: rpx * (1.1 + h), color: 'rgba(255,255,255,0.45)', width: 1.2 * lw, life: 0.22 });
    } else if (e.kind === 'rail') {
      if (h > 0.25) fx.smoke(sx, sy, 1 + Math.round(h * 2), { color: 'rgba(205,240,215,0.45)', size: [rpx * 0.25, rpx * 0.45], speed: [4 * lw, 18 * lw], life: [0.3, 0.55], rise: 0, grow: 1.2 });
    } else {  // the cue's tip on the cue ball: a puff of blue chalk where they met
      const a = anim?.stroke?.[0], R = B().R, [cx, cy] = a == null ? [sx, sy] : toScreen(e.p[0] - Math.cos(a) * R, e.p[1] - Math.sin(a) * R);
      fx.smoke(cx, cy, 2 + Math.round(h * 3), { color: 'rgba(120,160,225,0.55)', size: [rpx * 0.15, rpx * 0.3], speed: [6 * lw, (14 + 30 * h) * lw], life: [0.35, 0.7], rise: 0, grow: 1.4 });
      if (h > 0.45) fx.spark(cx, cy, 2, { color: '#ffffff', speed: [10 * lw, 40 * lw], size: [1.2 * lw, 2.2 * lw], life: [0.1, 0.2] });
    }
  }
  // a ball just potted: it runs on into the hole, shrinking and darkening as it drops
  function drawSinks(g, rpx, now) {
    for (let i = sinks.length - 1; i >= 0; i--) {
      const s = sinks[i], t = (now - s.t0) / 280;
      if (t >= 1 || !anim) { sinks.splice(i, 1); continue; }
      const e = 1 - (1 - t) ** 2, x = s.from[0] + (s.to[0] - s.from[0]) * e, y = s.from[1] + (s.to[1] - s.from[1]) * e;
      const [sx, sy] = toScreen(x, y), r = rpx * (1 - 0.4 * t);
      g.save(); g.globalAlpha = 1 - t * t;
      drawBall(g, s.n, sx, sy, r, true);
      g.fillStyle = `rgba(0,0,0,${0.75 * t})`; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill();
      g.restore();
    }
  }
  // fast balls leave a short fading streak (the last tenth of a second of their path)
  function drawTrails(g, balls, rpx, now) {
    if (!anim || lowGfx() || calm()) { trails.clear(); return; }
    for (const [n, x, y] of balls) {
      let tr = trails.get(n);
      if (!tr) trails.set(n, (tr = []));
      const l = tr[tr.length - 1];
      if (!l || l[0] !== x || l[1] !== y) tr.push([x, y, now]);
      while (tr.length && tr[0][2] < now - 110) tr.shift();
      if (tr.length < 3) continue;
      const len = Math.hypot(x - tr[0][0], y - tr[0][1]);
      if (len < B().R * 2.5) continue;  // only the quick ones
      const pts = tr.map(([px, py]) => toScreen(px, py)), [cr, cg, cb] = n === 0 ? [255, 255, 255] : rgb(colorOf(n));
      g.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const f = i / pts.length;
        g.strokeStyle = `rgba(${cr},${cg},${cb},${0.22 * f * Math.min(1, len / (B().R * 6))})`; g.lineWidth = rpx * 1.7 * f;
        g.beginPath(); g.moveTo(...pts[i - 1]); g.lineTo(...pts[i]); g.stroke();
      }
    }
    for (const n of trails.keys()) if (!balls.some(([m]) => m === n)) trails.delete(n);
  }
  // each ball's shadow: soft, cast away from the nearest of the lamp's shades (drawn under every ball first)
  function drawShadow(g, x, y, rpx) {
    const b = B(), lx = b.W / 2 + LAMPS.reduce((a, f) => (Math.abs(b.W / 2 + f * b.W - x) < Math.abs(b.W / 2 + a * b.W - x) ? f : a)) * b.W;
    const ox = Math.max(-1, Math.min(1, (x - lx) / 30)) * b.R * 0.45, oy = ((y - b.H / 2) / (b.H / 2)) * b.R * 0.35;
    const [sx, sy] = toScreen(x + ox, y + oy), r = rpx * 1.2, sh = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    sh.addColorStop(0, 'rgba(0,12,4,0.55)'); sh.addColorStop(0.55, 'rgba(0,12,4,0.32)'); sh.addColorStop(1, 'rgba(0,12,4,0)');
    g.fillStyle = sh; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill();
  }

  function draw() {
    if (view3d && gl && geo && S?.billiards) return draw3d();
    const c = $('blCanvas'), g = c?.getContext('2d');
    if (!g || !geo || !S?.billiards) return;
    const b = B(), { k } = geo, R = b.R, now = performance.now(), dt = Math.min(0.05, (now - fxLast) / 1000);
    fxLast = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const tc = paintTable(b);
    if (tc) g.drawImage(tc, 0, 0);
    // the pocket called for the 8: yours while you aim, the shooter's while a shot plays
    tableSpace(g);
    const call = anim ? anim.called : b.calling && canShoot() ? called : null;
    if (call != null && b.pockets[call]) {
      const [px, py, cap] = b.pockets[call];
      g.strokeStyle = '#ffd166'; g.lineWidth = 1.4; g.setLineDash([2, 1.5]);
      g.beginPath(); g.arc(px, py, cap + 3, 0, 7); g.stroke(); g.setLineDash([]);
    } else if (b.calling && canShoot()) {  // nothing called yet: every pocket pulses gently
      g.strokeStyle = `rgba(255, 209, 102, ${0.35 + 0.3 * Math.sin(now / 250)})`; g.lineWidth = 1;
      for (const [px, py, cap] of b.pockets) { g.beginPath(); g.arc(px, py, cap + 2.5, 0, 7); g.stroke(); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    // balls: a playing shot's frame, or the resting table
    const balls = ballsNow();
    const rpx = R * k * view.z;
    drawSinks(g, rpx, now);
    drawTrails(g, balls, rpx, now);
    for (const [, x, y] of balls) drawShadow(g, x, y, rpx);
    if (!anim && canShoot()) drawGuide(g, rpx);
    const sk = strokeNow();
    if (sk) drawStick(g, [sk.x, sk.y], sk.aim, sk.power, sk.english, rpx);
    for (const [n, x, y] of balls) drawBall(g, n, ...toScreen(x, y), rpx);
    if (b.lucky != null) {  // ⭐ the lucky ball wears a pulsing gold ring
      const lb = balls.find(([n]) => n === b.lucky);
      if (lb) { const [sx, sy] = toScreen(lb[1], lb[2]); g.strokeStyle = `rgba(255, 209, 102, ${0.65 + 0.3 * Math.sin(now / 300)})`; g.lineWidth = Math.max(1.5, rpx * 0.22); g.beginPath(); g.arc(sx, sy, rpx * 1.45, 0, 7); g.stroke(); }
    }
    if (!anim && canShoot() && b.inHand && cuePos) {  // ball-in-hand ring
      const [sx, sy] = toScreen(...cuePos);
      g.strokeStyle = placeOk(...cuePos) ? '#ffb703' : '#ef476f'; g.lineWidth = 2 * (k / geo.css); g.setLineDash([4, 3]);
      g.beginPath(); g.arc(sx, sy, rpx * 2.2, 0, 7); g.stroke(); g.setLineDash([]);
    }
    if (fxp) { fxp.step(dt); fxp.draw(g); }
  }

  // the cue stick: a maple shaft on a white ferrule and chalked tip, a joint ring, a dark forearm, a wrap and a
  // brass-ringed butt, lit along one side so it reads round, with a soft shadow on the cloth. Pulled back
  // further with more power.
  function drawStick(g, cue, aim, power, english, rpx) {
    const lw = k1(), [sx, sy] = toScreen(...cue);
    const back = rpx + (6 + power * 46) * lw, len = Math.max(190 * lw, rpx * 34), dx = Math.cos(aim), dy = Math.sin(aim);
    const [ux, uy] = geo.portrait ? [dy, -dx] : [dx, dy];
    const [px, py] = [-uy, ux], tipW = Math.max(3 * lw, rpx * 0.55), buttW = tipW * 2.3;
    const off = english * rpx * 0.55;  // the stick lines up with where the tip will strike (side spin)
    const at = (d, w) => [sx - ux * d + px * (w + off), sy - uy * d + py * (w + off)];
    const wAt = (d) => tipW + (buttW - tipW) * ((d - back) / len);  // its width, d along from the cue ball
    // a band of the stick from d0 to d1, across from w0 to w1 (fractions of its half-width, −1..1)
    const band = (d0, d1, w0 = -1, w1 = 1) => {
      g.beginPath(); g.moveTo(...at(d0, (wAt(d0) / 2) * w1)); g.lineTo(...at(d1, (wAt(d1) / 2) * w1));
      g.lineTo(...at(d1, (wAt(d1) / 2) * w0)); g.lineTo(...at(d0, (wAt(d0) / 2) * w0)); g.closePath();
    };
    const end = back + len;
    g.save();
    if (!lowGfx()) { g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 6 * lw; g.shadowOffsetX = 3 * lw; g.shadowOffsetY = 5 * lw; }
    else { g.save(); g.translate(3 * lw, 3 * lw); g.fillStyle = '#0005'; band(back - 2 * lw, end); g.fill(); g.restore(); }
    const wood = g.createLinearGradient(...at(back, 0), ...at(end, 0));
    wood.addColorStop(0, '#f3dfb4'); wood.addColorStop(0.5, '#dcb47c'); wood.addColorStop(0.585, '#c9975c');
    wood.addColorStop(0.59, '#eee8d8'); wood.addColorStop(0.6, '#eee8d8');  // the joint
    wood.addColorStop(0.601, '#3a2010'); wood.addColorStop(0.72, '#4a2814');
    wood.addColorStop(0.721, '#1c1c22'); wood.addColorStop(0.9, '#1c1c22');  // the wrap
    wood.addColorStop(0.901, '#c9a24a'); wood.addColorStop(0.91, '#c9a24a');  // a brass ring
    wood.addColorStop(0.911, '#3d2414'); wood.addColorStop(0.99, '#2a160b'); wood.addColorStop(0.991, '#0d0d0d'); wood.addColorStop(1, '#0d0d0d');
    g.fillStyle = wood; band(back, end); g.fill();
    g.restore();
    // the wrap's weave
    if (!lowGfx() && rpx > 4) {
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = Math.max(1, lw * 0.8);
      for (let d = back + len * 0.725; d < back + len * 0.895; d += 3 * lw) { g.beginPath(); g.moveTo(...at(d, wAt(d) / 2)); g.lineTo(...at(d + 2 * lw, -wAt(d) / 2)); g.stroke(); }
    }
    // round: a light stripe down the lit side, the far side in shade
    g.fillStyle = 'rgba(255,255,255,0.3)'; band(back + 4 * lw, end - 2 * lw, 0.15, 0.5); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; band(back, end, -1, -0.45); g.fill();
    // the ferrule and the chalked tip
    g.fillStyle = '#f8f6ee'; band(back, back + 4 * lw); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = Math.max(0.5, lw * 0.5); g.beginPath(); g.moveTo(...at(back + 4 * lw, wAt(back) / 2)); g.lineTo(...at(back + 4 * lw, -wAt(back) / 2)); g.stroke();
    g.fillStyle = '#3f6fc4'; band(back - 1.6 * lw, back); g.fill();
    g.fillStyle = 'rgba(160,195,255,0.6)'; band(back - 1.6 * lw, back, 0.1, 0.7); g.fill();
  }

  // the aim guide's lines: a dark edge under each so they read on the cloth, round ends, and (while you aim)
  // dashes that drift slowly toward the target
  function guideLine(g, pts, colour, width, dash, glow) {
    if (pts.length < 2) return;
    const lw = k1(), drift = !lowGfx() && !calm();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = () => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); };
    g.setLineDash(dash ? [dash[0] * lw, dash[1] * lw] : []);
    g.lineDashOffset = dash && drift ? -((performance.now() / 45) % ((dash[0] + dash[1]) * 4)) * lw : 0;
    path(); g.strokeStyle = 'rgba(0,10,4,0.4)'; g.lineWidth = (width + 1.6) * lw; g.stroke();
    if (glow && !lowGfx()) { g.save(); g.shadowColor = colour; g.shadowBlur = 6 * lw; path(); g.strokeStyle = colour; g.lineWidth = width * lw; g.stroke(); g.restore(); }
    else { path(); g.strokeStyle = colour; g.lineWidth = width * lw; g.stroke(); }
    g.setLineDash([]); g.lineDashOffset = 0;
  }
  function arrowHead(g, from, to, colour, size) {
    const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
    g.fillStyle = colour; g.beginPath(); g.moveTo(to[0] + Math.cos(a) * size, to[1] + Math.sin(a) * size);
    g.lineTo(to[0] + Math.cos(a + 2.5) * size, to[1] + Math.sin(a + 2.5) * size); g.lineTo(to[0] + Math.cos(a - 2.5) * size, to[1] + Math.sin(a - 2.5) * size);
    g.closePath(); g.fill();
  }
  // the ghost ball: a see-through ball with a bright rim, where the cue ball will be when it hits
  function ghostBall(g, x, y, r, colour = '255,255,255', dashed = false) {
    const lw = k1(), gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
    gr.addColorStop(0, `rgba(${colour},0.28)`); gr.addColorStop(0.7, `rgba(${colour},0.1)`); gr.addColorStop(1, `rgba(${colour},0.22)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.setLineDash(dashed ? [3 * lw, 3 * lw] : []);
    g.strokeStyle = 'rgba(0,10,4,0.35)'; g.lineWidth = 2.4 * lw; g.stroke();
    g.strokeStyle = `rgba(${colour},0.9)`; g.lineWidth = 1.1 * lw; g.stroke();
    g.setLineDash([]);
  }

  function drawGuide(g, rpx) {
    const cue = cueAt();
    if (!cue) return;
    const guide = B().guide, { gx, gy, ball } = trace(cue), lw = k1();
    const [sx, sy] = toScreen(...cue), [ex, ey] = toScreen(gx, gy);
    drawStick(g, cue, aim, power, english, rpx);
    if (guide === 'off') return;
    const full = guide === 'full', from = (x, y) => { const L = Math.hypot(x - sx, y - sy) || 1; return [sx + ((x - sx) / L) * rpx, sy + ((y - sy) / L) * rpx]; };
    if (guide === 'light') {  // #50: the ghost ball where the cue ball first meets a ball, and a short hint of the angle
      guideLine(g, [from(ex, ey), [ex, ey]], 'rgba(255,255,255,0.75)', 1.2, [5, 4]);
      ghostBall(g, ex, ey, rpx);
      if (ball) {
        const [bx, by] = toScreen(...ball), nx = bx - ex, ny = by - ey, n = Math.hypot(nx, ny) || 1, tip = [bx + (nx / n) * 16 * lw, by + (ny / n) * 16 * lw];
        guideLine(g, [[bx, by], tip], 'rgba(255,209,102,0.85)', 1.4);
        arrowHead(g, [bx, by], tip, 'rgba(255,209,102,0.85)', 4 * lw);
      }
      return;
    }
    if (!full) {  // the short guide: just which way the cue points
      const f = Math.min(1, (40 * lw) / Math.hypot(ex - sx, ey - sy || 1));
      guideLine(g, [from(ex, ey), [sx + (ex - sx) * f, sy + (ey - sy) * f]], 'rgba(255,255,255,0.75)', 1.2, [5, 4]);
      return;
    }
    // the full guide runs the shot engine: the ghost ball sits where the cue ball really meets the first ball
    // (or where it stops short, or the pocket it would drop into), with both balls' real paths after the hit
    const p = predict(cue), end = p?.ghost || p?.stop || p?.scratch || [gx, gy], [hx, hy] = toScreen(...end);
    guideLine(g, [from(hx, hy), [hx, hy]], 'rgba(255,255,255,0.8)', 1.2, [5, 4]);
    ghostBall(g, hx, hy, rpx, p?.scratch ? '239,71,111' : '255,255,255', !!p?.stop);  // dashed: it runs out of pace and stops here
    const line = (path, colour, width, dash, glow) => {
      if (!path || path.pts.length < 2) return;
      const pts = path.pts.map((q) => toScreen(...q));
      guideLine(g, pts, colour, width, dash, glow);
      if (path.sunk) {  // it drops: the pocket lights up
        const [qx, qy] = pts[pts.length - 1], pulse = calm() ? 0.8 : 0.6 + 0.3 * Math.sin(performance.now() / 160);
        g.strokeStyle = colour; g.globalAlpha = pulse; g.lineWidth = 2 * lw;
        g.beginPath(); g.arc(qx, qy, rpx * 1.6, 0, 7); g.stroke(); g.globalAlpha = 1;
      } else if (!dash) arrowHead(g, pts[pts.length - 2], pts[pts.length - 1], colour, 4.5 * lw);
    };
    if (p?.ghost) {
      line(p.obj, '#ffd166', 1.8, null, true);  // where the object ball goes
      line(p.cue, 'rgba(191,233,255,0.85)', 1.4, [4, 3], true);  // and the cue ball, bent by its follow or draw
    } else if (!p && ball) {  // no prediction (an older server): the line of centres
      const [bx, by] = toScreen(...ball), nx = bx - ex, ny = by - ey, n = Math.hypot(nx, ny) || 1, tip = [bx + (nx / n) * 45 * lw, by + (ny / n) * 45 * lw];
      guideLine(g, [[bx, by], tip], '#ffd166', 1.6); arrowHead(g, [bx, by], tip, '#ffd166', 4.5 * lw);
      // and where the cue ball glances off: along the tangent, bent forward by follow or back by draw
      const ax = ex - sx, ay = ey - sy, am = Math.hypot(ax, ay) || 1, along = (ax * nx + ay * ny) / (am * n);
      let tx = ax / am - along * nx / n, ty = ay / am - along * ny / n;
      const tm = Math.hypot(tx, ty);
      if (tm > 0.05) {
        tx /= tm; ty /= tm;
        const bend = spin * along * 0.9;  // a fuller hit passes on more of the spin
        tx += (nx / n) * bend; ty += (ny / n) * bend;
        const m2 = Math.hypot(tx, ty) || 1, L = 70 * lw * Math.min(1, tm + 0.2);
        guideLine(g, [[ex, ey], [ex + (tx / m2) * L, ey + (ty / m2) * L]], 'rgba(191,233,255,0.85)', 1.4, [4, 3]);
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
  const LX = -0.38, LY = -0.48, LZ = 0.79;  // toward the lamp, from a ball (screen x right, y down, z up out of the table)
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
      // lit by the lamp above (a little up and left on screen), with the green of the cloth bounced up
      // into its lower edge
      const dif = Math.max(0, x * LX + y * LY + z * LZ), sh = 0.5 + 0.6 * dif, edge = (1 - z) ** 2, bounce = edge * Math.max(0, 0.35 + x * 0.25 + y * 0.6);
      const k = (j * size + i) * 4;
      px[k] = Math.min(255, c[0] * sh + 10 * bounce); px[k + 1] = Math.min(255, c[1] * sh + 50 * bounce); px[k + 2] = Math.min(255, c[2] * sh + 24 * bounce); px[k + 3] = 255;
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
  // a ball: its shaded picture (shadow drawn separately, under all the balls), then the glaze. The highlights sit
  // up by the top-left edge, toward the lamp and clear of the spot when it faces up, so the number stays readable.
  function drawBall(g, n, x, y, r) {
    const o = rollTo(n, x, y, r);
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
    g.drawImage(ballImage(n, o, r), x - r, y - r, 2 * r, 2 * r);
    const rim = g.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.6, x, y, r);  // the edge turning away
    rim.addColorStop(0, '#00000000'); rim.addColorStop(1, '#00000038');
    g.fillStyle = rim; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    const hx = x - r * 0.46, hy = y - r * 0.5, soft = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);  // the lamp's soft bloom
    soft.addColorStop(0, '#ffffff40'); soft.addColorStop(1, '#ffffff00');
    g.fillStyle = soft; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    const shine = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.2);  // and its sharp reflection in the glaze
    shine.addColorStop(0, '#ffffffee'); shine.addColorStop(0.4, '#ffffff99'); shine.addColorStop(1, '#ffffff00');
    g.fillStyle = shine; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (r > 6) {  // the two other shades of the lamp, smaller, along the table
      const [ux, uy] = geo?.portrait ? [0, -1] : [1, 0];
      for (const sgn of [-1, 1]) {
        const qx = hx + ux * sgn * r * 0.22, qy = hy + uy * sgn * r * 0.22, q = g.createRadialGradient(qx, qy, 0, qx, qy, r * 0.09);
        q.addColorStop(0, '#ffffffaa'); q.addColorStop(1, '#ffffff00');
        g.fillStyle = q; g.fillRect(qx - r * 0.1, qy - r * 0.1, r * 0.2, r * 0.2);
      }
    }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(0.6, r * 0.04); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  }
  // the flat view's baize: a fine grain of light and dark specks at the screen's own pixels, smeared a little
  // along the nap, over the cloth (the caller has clipped to it). The tile is made once.
  let grainTile = null;
  function clothGrain(g) {
    if (!g.createPattern) return;
    if (!grainTile) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const cg = c.getContext?.('2d'), im = cg?.createImageData?.(128, 128);
      if (!im) return;
      const v = Float32Array.from({ length: 128 * 128 }, Math.random);
      for (let i = 0; i < v.length; i++) {
        const x = i % 128, n = (v[i] * 2 + v[(i - x) + ((x + 1) % 128)] + v[(i - x) + ((x + 127) % 128)]) / 4;  // along the nap
        im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = n > 0.5 ? 255 : 0; im.data[i * 4 + 3] = Math.abs(n - 0.5) * 46;
      }
      cg.putImageData(im, 0, 0);
      grainTile = c;
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = g.createPattern(grainTile, 'repeat'); g.fillRect(0, 0, g.canvas.width, g.canvas.height);
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
    // the floating controls and info card fade while balls roll or the cue is being aimed, so they hide nothing that matters
    const busy = !!(anim || drag || touches.size), bl = $('blStage')?.parentElement;
    if (bl && bl.classList.contains('bl-busy') !== busy) bl.classList.toggle('bl-busy', busy);
    shotFx(); draw(); shotSounds(); angleReadout(now);
  }

  // #141: the cue's angle to a tenth of a degree while you aim, and whether that drag is fine or quick
  function angleReadout(now) {
    const el = $('blAngle'); if (!el) return;
    const on = canShoot() && !anim;
    const deg = ((aim * 180 / Math.PI) % 360 + 360) % 360;
    const txt = on ? `${deg.toFixed(1)}°${aimMode && now - aimModeAt < 1500 ? (aimMode === 'fine' ? ' · 🎯 fine' : ' · ⚡ quick') : ''}` : '';
    if (txt !== aimShown) { aimShown = txt; el.textContent = txt; el.hidden = !txt; }
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
    if (p0 && p1) out.push({ t: 0, kind: 'cue', v: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), p: p0 });
    for (let f = 1; f < last; f++) {
      order.forEach((n, j) => {
        const a = at(f - 1, j), c = at(f, j), d = at(f + 1, j);
        if (c && !d) { out.push({ t: f / 30, kind: 'pocket', v: a ? Math.hypot(c[0] - a[0], c[1] - a[1]) : 3, p: c, n }); return; }
        if (!a || !c || !d) return;
        const dv = jolt(f, j);
        if (dv < 0.5 || (quiet.get(n) ?? -9) > f - 3) return;  // friction and spin change it far less than an impact
        quiet.set(n, f);
        // another ball close by at this frame or the next means a ball-on-ball hit, else the cushion
        const reach = 2 * R + Math.hypot(d[0] - c[0], d[1] - c[1]) + 0.6;
        let other = -1, best = Infinity, mid = c;
        order.forEach((m, k) => {
          if (k === j) return;
          for (const g of [f, f + 1]) {
            const p = at(g, k), q = at(g, j);
            if (p && q) { const dist = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dist < best) { best = dist; other = m; mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; } }
          }
        });
        if (best < reach) {
          const key = Math.min(n, other) * 100 + Math.max(n, other);
          if ((pairs.get(key) ?? -9) > f - 3) return;  // both balls feel the same click
          pairs.set(key, f); quiet.set(other, f);
          const k = order.indexOf(other);  // an impact can straddle two frames: hear the whole of it
          out.push({ t: f / 30, kind: 'ball', v: Math.max(dv, jolt(f + 1, j), jolt(f, k), jolt(f + 1, k)), p: mid });  // where they touch
        } else out.push({ t: f / 30, kind: 'rail', v: Math.max(dv, jolt(f + 1, j)), p: c });
      });
    }
    return out.sort((x, y) => x.t - y.t);
  }
  // how fast all the balls on the table are going at each frame, for the rolling rumble on the cloth
  function rolling(frames) {
    const out = new Float32Array(frames.length);
    for (let f = 1; f < frames.length; f++) {
      const a = frames[f - 1], c = frames[f];
      for (let i = 0; i < c.length; i += 2) if (c[i] >= 0 && a[i] >= 0) out[f] += Math.hypot(c[i] - a[i], c[i + 1] - a[i + 1]) / 10;
    }
    return out;
  }

  // The voices are built the way the real sounds are made: a very short burst of noise (the impact itself,
  // brighter and shorter the harder the hit) exciting a few damped resonances (the rail's wood, the cue's
  // shaft, the pocket), never a swept tone. Everything goes through a small room and a gentle compressor so
  // the break's pile of clicks sits together, and each sound is panned to where on the table it happened.
  let actx = null, bus = null, noiseBuf = null, roll = null;
  function audio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return actx; }
    // through the app's output, so the volume setting applies (its own context only if that's missing)
    // (window.out: this module's own panIn used to be called out, which hid the app's and broke every sound, #104)
    const appOut = typeof window.out === 'function' ? window.out : null;
    actx = appOut ? appOut().context : new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const sr = actx.sampleRate, comp = actx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.001; comp.release.value = 0.12;
    comp.connect(appOut ? appOut() : actx.destination);
    noiseBuf = actx.createBuffer(1, sr, sr);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // a games room: a few early reflections off the walls, then a short tail that loses its highs as it dies
    const len = Math.floor(sr * 0.45), ir = actx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const s = i / sr, k = Math.min(0.92, 0.25 + s * 3);  // the one-pole smoothing grows: highs fade first
        lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
        d[i] = s < 0.012 ? 0 : lp * Math.exp(-s / 0.075) * 1.6;
      }
      for (const [ms, a] of [[7, 0.5], [11, 0.35], [17, 0.3], [23, 0.2], [31, 0.15]]) d[Math.floor(sr * (ms + ch * 1.3) / 1000)] += a * (ch ? -1 : 1);
    }
    const rev = actx.createConvolver(), wet = actx.createGain();
    rev.buffer = ir; wet.gain.value = 0.32;
    rev.connect(wet).connect(comp);
    bus = { dry: comp, rev };
    return actx;
  }
  const quietNow = () => (typeof prefs !== 'undefined' && !prefs.sound) || document.hidden;
  // the table's own sounds (balls rolling on the cloth, down the pocket's return) have their own volume, kept
  // under the clicks: 'normal', 'quiet' (the default) or 'off'
  const TABLE_VOL = { normal: 1, quiet: 0.5, off: 0 };
  let tableVol = TABLE_VOL[pref('table', 'quiet')] ?? 0.5;
  // left to right as the table is shown (the flat view turns it on its side in portrait); the 3D camera moves, so it stays centred
  function panAt(p) {
    const b = B();
    if (!p || view3d || !geo || !b) return 0;
    const u = geo.portrait ? p[1] / b.H : p[0] / b.W;
    return Math.max(-0.7, Math.min(0.7, (u - 0.5) * 1.4));
  }
  function panIn(pan, send = 1) {  // a panned input feeding the room
    const g = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
    if (g.pan) g.pan.value = pan;
    g.connect(bus.dry);
    if (send) { const s = actx.createGain(); s.gain.value = send; g.connect(s).connect(bus.rev); }
    return g;
  }
  // a burst of noise through a filter, falling away with time constant tau
  function burst(dst, t, type, freq, q, vol, tau) {
    const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf; fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t, tau);
    s.connect(fl).connect(g).connect(dst);
    s.start(t, Math.random() * 0.8); s.stop(t + tau * 8 + 0.01);
  }
  // one damped resonance: struck, then ringing down with time constant tau
  function mode(dst, t, f, vol, tau) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.04);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.0015); g.gain.setTargetAtTime(0, t + 0.0015, tau);  // a soft onset: no tick
    o.connect(g).connect(dst); o.start(t); o.stop(t + tau * 8 + 0.01);
  }
  // two phenolic balls (#142): the crisp "clack" of a real table. A very short bright impact, a hard ring a few
  // milliseconds long at the balls' own pitches (around 2.6, 3.9 and 5.3 kHz), and a little wooden body under it.
  // A soft kiss keeps mostly the body and the lowest ring; a hard hit adds a dry crack on top.
  function ballClick(dst, t, h) {
    const vol = 0.06 + 0.42 * h ** 0.75, lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200 + 5200 * h; lp.Q.value = 0.4; lp.connect(dst);
    burst(lp, t, 'bandpass', 2400 + 2600 * h, 0.7, vol * 1.25, 0.0007 + 0.0006 * (1 - h));
    const pitch = 0.97 + Math.random() * 0.06;   // no two balls ring quite alike
    for (const [f, a, tau] of [[2600, 0.32, 0.007], [3900, 0.2, 0.0045], [5300, 0.11, 0.003]]) mode(lp, t, f * pitch, vol * a * (f > 3000 ? 0.15 + 0.85 * h : 0.6 + 0.4 * h), tau);
    mode(lp, t, 900, vol * 0.16, 0.007);  // the body of the ball
    if (h > 0.65) burst(dst, t, 'highpass', 6500, 0.7, vol * (h - 0.65) * 1.4, 0.0005);   // a hard hit's crack
  }
  function clack(e, delay = 0) {
    if (quietNow()) return;
    try {
      audio();
      const t = actx.currentTime + delay, h = Math.min(1, e.v / 12);  // 12 units a frame is a hard hit
      if (e.kind === 'ball') ballClick(panIn(panAt(e.p)), t, h);
      else if (e.kind === 'rail') {  // the rubber cushion under the cloth: a muffled thup, and the wooden rail behind it
        const dst = panIn(panAt(e.p), 0.8), vol = 0.05 + 0.4 * h;
        burst(dst, t, 'lowpass', 350 + 1500 * h, 0.7, vol * 1.1, 0.008 + 0.004 * h);
        mode(dst, t, 150, vol * 0.55, 0.045); mode(dst, t, 245, vol * 0.3, 0.03); mode(dst, t, 430, vol * 0.18, 0.018);
        if (h > 0.4) mode(dst, t, 1100, vol * 0.12 * h, 0.005);
      } else if (e.kind === 'pocket') {  // a thock against the pocket's leather, a rattle in the jaws if it came fast, then the roll down the return
        const dst = panIn(panAt(e.p), 0.7), fast = Math.min(1, e.v / 6), vol = 0.12 + 0.25 * fast;
        burst(dst, t, 'lowpass', 600 + 600 * fast, 0.8, vol, 0.012);
        mode(dst, t, 105, vol * 0.7, 0.06); mode(dst, t, 185, vol * 0.4, 0.04); mode(dst, t, 340, vol * 0.2, 0.02);
        if (fast > 0.5) [0.035, 0.07].forEach((dt, i) => { burst(dst, t + dt, 'lowpass', 900, 0.8, vol * (0.45 - i * 0.2), 0.006); mode(dst, t + dt, 240, vol * (0.3 - i * 0.12), 0.02); });
        if (!tableVol) return;
        const t1 = t + 0.18, dur = 0.75, lvl = 0.06 * tableVol, s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
        const lfo = actx.createOscillator(), depth = actx.createGain();  // the joins in the gutter make it bump as it rolls
        s.buffer = noiseBuf; s.loop = true; fl.type = 'lowpass'; fl.frequency.value = 320; fl.Q.value = 1.2;
        lfo.frequency.value = 14 + Math.random() * 6; depth.gain.value = lvl / 2; lfo.connect(depth).connect(g.gain);
        g.gain.setValueAtTime(0, t1); g.gain.linearRampToValueAtTime(lvl, t1 + 0.08); g.gain.setValueAtTime(lvl, t1 + dur - 0.25); g.gain.linearRampToValueAtTime(0, t1 + dur);
        s.connect(fl).connect(g).connect(dst); s.start(t1); s.stop(t1 + dur + 0.05); lfo.start(t1); lfo.stop(t1 + dur + 0.05);
        ballClick(dst, t1 + dur - 0.04, 0.18);  // and it bumps into the balls already down
      } else {  // the leather tip on the cue ball: a rounder tok with the cue's shaft in it, a crack on a hard break
        const dst = panIn(panAt(e.p), 0.8), vol = 0.08 + 0.4 * h;
        burst(dst, t, 'bandpass', 1500 + 1500 * h, 1.1, vol * 1.2, 0.0025);
        mode(dst, t, 820, vol * 0.3, 0.012); mode(dst, t, 1640, vol * 0.18, 0.008); mode(dst, t, 190, vol * 0.25, 0.025);
        if (h > 0.6) burst(dst, t, 'bandpass', 2600, 0.8, vol * (h - 0.6) * 1.2, 0.0008);
      }
    } catch {}
  }
  // the balls rolling on the cloth: a faint low rumble (kept nearly silent, #56) that rises and falls with how much is moving
  function rumbleTo(level) {
    if (!roll && level <= 0) return;
    if (!roll) {
      const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), hiss = actx.createBiquadFilter(), g = actx.createGain(), hg = actx.createGain();
      s.buffer = noiseBuf; s.loop = true;
      fl.type = 'lowpass'; fl.frequency.value = 180; fl.Q.value = 0.6;
      hiss.type = 'bandpass'; hiss.frequency.value = 1200; hiss.Q.value = 0.5; hg.gain.value = 0.01;  // the nap of the cloth, barely there
      g.gain.value = 0;
      s.connect(fl).connect(g); s.connect(hiss).connect(hg).connect(g); g.connect(bus.dry);
      s.start();
      roll = { s, g, off: null };
    }
    clearTimeout(roll.off); roll.off = null;
    roll.g.gain.setTargetAtTime(level, actx.currentTime, 0.05);
    if (level <= 0) {  // let it fade, then stop the source so nothing runs between shots
      const r = roll;
      r.off = setTimeout(() => { try { r.s.stop(); } catch {} if (roll === r) roll = null; }, 400);
    }
  }
  // play each contact once its moment in the shot comes (the draw loop calls this every frame)
  function shotSounds() {
    if (!anim?.sounds || quietNow()) { if (roll && !roll.off) rumbleTo(0); return; }
    const now = shotTime() - anim.lead;
    for (let n = 0; anim.next < anim.sounds.length && anim.sounds[anim.next].t <= now; ) {
      const e = anim.sounds[anim.next++];
      // the break's many clicks spread over a few ms instead of stacking; a late joiner (or a tab back
      // from the background) doesn't get a burst of old clicks
      if (now - e.t < 0.15) clack(e, 0.007 * n++);
    }
    if (actx && anim.roll) {
      const f = Math.floor(now * 30), sp = f >= 0 && f < anim.roll.length ? anim.roll[f] : 0;
      try { rumbleTo(sp > 0.05 && tableVol ? 0.05 * tableVol * Math.min(1, Math.sqrt(sp / 12)) : 0); } catch {}
    }
  }

  // ---------- input
  // the zoom is drawn, not a CSS scale of the picture: the 3D camera crops to the zoomed part, and the flat view
  // draws through it (toScreen), so balls and numbers stay sharp at 3×. view: CSS px, canvas point p shows (p - x) / z.
  function applyView() {
    if (!surf()) return;
    if (gl) gl.setZoom(view.z, view.x, view.y);
    $('blZoom').hidden = view.z === 1 && !(view3d && gl?.yaw?.());  // (tick draws it next frame)
    $('blZoom').textContent = view.z === 1 ? '🔄 Reset' : '🔍 1×';
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
      pinch = { d, mid, view: { ...view }, ang: Math.atan2(by - ay, bx - ax), yaw: gl?.yaw?.() ?? 0, twist: false };
      return;
    }
    // #115: two fingers twisting turn the 3D overview round the table (past a small dead zone, so a pinch doesn't)
    if (view3d && gl && cam !== 'cue') {
      let da = Math.atan2(by - ay, bx - ax) - pinch.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (!pinch.twist && Math.abs(da) > 0.2) pinch.twist = true;
      if (pinch.twist) { gl.setYaw(pinch.yaw - da); applyView(); return; }
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
      // #139: grab the stick itself (behind the ball, along the cue) for slow, fine turning; anywhere else turns
      // faster than the finger sweeps round the ball
      if (drag === 'aim' && cue) {
        const R = B().R, dx = x - cue[0], dy = y - cue[1], along = -(dx * Math.cos(aim) + dy * Math.sin(aim)), across = Math.abs(-dx * Math.sin(aim) + dy * Math.cos(aim));
        const onStick = along > R * 1.2 && along < R * 34 && across < Math.max(R * 2.4, 22 / (geo?.k || 1));
        dial = behind() ? { x0: e.clientX, aim0: aim, fine: false }
          : onStick ? { fine: true, sx: x, sy: y, aim0: aim, lever: Math.max(along, R * 8) }
            : { from: Math.atan2(dy, dx), aim0: aim, fine: false };
        aimMode = dial.fine ? 'fine' : 'quick'; aimModeAt = performance.now();
      }
      try { surf().setPointerCapture(e.pointerId); } catch {}
    }
    if (!drag) return;
    if (drag === 'cue') {
      const b = B();
      cuePos = [Math.max(b.R, Math.min(b.W - b.R, x)), Math.max(b.R, Math.min(b.H - b.R, y))];
    } else {
      const cue = cueAt();
      if (dial && dial.x0 != null) aim = dial.aim0 + (e.clientX - dial.x0) * 0.0035;  // behind the cue: drag sideways to turn
      else if (dial?.fine) {
        // moving the butt sideways turns the cue a quarter as much as it would at that distance: a long, slow lever
        const mx = x - dial.sx, my = y - dial.sy, side = -mx * Math.sin(dial.aim0) + my * Math.cos(dial.aim0);
        aim = dial.aim0 - side / (dial.lever * 4);
      } else if (cue && dial && Math.hypot(x - cue[0], y - cue[1]) > 3) {
        const turn = Math.atan2(y - cue[1], x - cue[0]) - dial.from;
        aim = dial.aim0 + 1.5 * Math.atan2(Math.sin(turn), Math.cos(turn));
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
    if (gl) gl.setZoom(1, 0, 0);
    $('blZoom').hidden = true;
    $('blCanvas').hidden = view3d;
    if (gl) gl.canvas.hidden = !view3d;
    $('blView').hidden = gl === false;
    $('blView').textContent = view3d ? '▦ Flat' : '🧊 3D';
    $('blCam').hidden = !view3d;
    $('blCam').textContent = cam === 'cue' ? '🗺️ Whole table' : '🎥 Behind cue';
    $('blTurn').hidden = !view3d || cam === 'cue';
    if (gl && !view3d) gl.setYaw?.(0);
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
    if (elev) extra.elev = elev;
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

  function setElev(d) {  // the cue elevation control (#45)
    elev = Math.max(0, Math.min(60, Math.round(d / 5) * 5));
    const el = $('blElev');
    if (!el) return;
    el.value = elev;
    $('blElevVal').textContent = elev ? `${elev}°` : 'level';
  }

  // ---------- mount / render
  function mount(main, side) {
    view = { z: 1, x: 0, y: 0 }; pinch = null; touches.clear(); rolls = new Map(); spin = english = elev = 0;
    dial = null; aim = 0; aimFor = null; power = 0.55; cuePos = null; drag = null; anim = null; seenShot = 0; lastShot = null; geo = null;
    gl = null; view3d = false; camAt = null; fxp = null; sinks = []; trails = new Map(); tableCache = null; tableKey = '';
    main.innerHTML = `<div class="bl"><div id="blStage" class="bl-stage"><canvas id="blCanvas"></canvas><div id="blAngle" class="bl-angle" hidden></div>
        <button id="blZoom" class="bl-zoom" hidden aria-label="Show the whole table">🔍 1×</button>
        <div class="bl-views"><button id="blView" hidden>🧊 3D</button><button id="blCam" hidden>🎥 Behind cue</button><button id="blTurn" hidden aria-label="Turn the table a quarter turn" title="Turn the table (or twist two fingers on it)">🔄</button>
          <button id="blPush" hidden aria-pressed="false" title="9-ball: the first shot after the break may be a push-out. It needn't hit anything; your rival then shoots from there or hands it back.">🔀 Push out</button>
          <button id="blReplay" hidden title="Watch the last shot again, slowed down">⏪ Replay</button>
          <button id="blPass" hidden title="Make your rival shoot from where their push-out left the balls">↩️ Hand it back</button></div>
        <div id="blChip" class="bl-chip" hidden aria-live="polite"></div>
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
          <small id="blSpinVal">centre</small>
          <label class="bl-elev" title="Raise the butt of the cue: with side spin the cue ball curves toward the side you hit (a swerve; steep, a massé)">⤴
            <input id="blElev" type="range" min="0" max="60" step="5" value="0" aria-label="Cue elevation"><span id="blElevVal">level</span></label></div>
        <button id="blShoot" class="primary">🎱 Shoot</button>
      </div></div>`;
    side.innerHTML = `<div class="panel bl-side">
      <div id="blStatus" class="seat-row"></div>
      <div id="blRacks" class="bl-racks"></div>
      <button id="blGear" class="bl-gear" type="button" title="Table sound and camera" aria-label="Table sound and camera" aria-expanded="false">⚙</button>
      <p class="hint left" id="blHint">Drag the cue stick for slow, fine aim, or anywhere else on the table to turn it quickly. ◀ ▶ fine-tune (hold to speed up). Pull the power bar back and let go to shoot. ✋ With ball in hand, drag the cue ball to move it.</p>
      <label class="bl-tablevol" title="The balls rolling on the cloth and down the pocket's return. The clicks and thumps are always on (with sound on).">🔈 Table sound
        <select id="blTableVol"><option value="normal">Normal</option><option value="quiet">Quiet</option><option value="off">Off</option></select></label>
      <label class="bl-tablevol" title="In the behind-the-cue view, rise up over the table while the balls run, then drop back behind the cue.">🎥 Follow the shot
        <input type="checkbox" id="blShotCam"></label>
      <p class="hint left bl-keys">Keys: ← → turn the cue (hold to turn faster, Shift for fine aim) · ↑ ↓ or 1–9, 0 power · Space shoots · W A S D move the cue ball in hand · C switches the 3D camera.</p></div>`;
    const c = $('blCanvas');
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => pointer(e, 'down'));
    c.addEventListener('pointermove', (e) => pointer(e, 'move'));
    c.addEventListener('pointerup', (e) => pointer(e, 'up'));
    c.addEventListener('pointercancel', () => { drag = null; });
    const stage = $('blStage');
    stage.addEventListener('pointerdown', (e) => onTouch(e, 'down'), true);
    // phones only let sound start from a touch: wake the table's audio on the first one, not mid-shot
    stage.addEventListener('pointerdown', () => { if (!quietNow()) try { audio(); } catch {} }, { capture: true, passive: true });
    stage.addEventListener('pointermove', (e) => onTouch(e, 'move'), true);
    for (const t of ['pointerup', 'pointercancel']) stage.addEventListener(t, (e) => onTouch(e, 'up'), true);
    $('blTableVol').value = pref('table', 'quiet');
    $('blShotCam').checked = pref('shotcam', '1') === '1';
    $('blShotCam').onchange = (e) => setPref('shotcam', e.target.checked ? '1' : '0');
    $('blTableVol').onchange = (e) => { setPref('table', e.target.value); tableVol = TABLE_VOL[e.target.value] ?? 0.5; if (!tableVol && roll) try { rumbleTo(0); } catch {} };
    $('blZoom').onclick = () => { view = { z: 1, x: 0, y: 0 }; gl?.setYaw?.(0); applyView(); };
    // a quarter turn, snapped to the nearest quarter (after a twist)
    $('blTurn').onclick = () => { if (!gl) return; gl.setYaw(Math.round(gl.yaw() / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 2); applyView(); };
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
    $('blElev').oninput = () => setElev(+$('blElev').value);
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
    // #141: a tap turns the aim by about 0.09°; held, it starts slow (fine) and speeds up
    for (const [id, dir] of [['blLeft', -1], ['blRight', 1]]) {
      let hold = null, t0 = 0;
      const nudge = () => { const t = (performance.now() - t0) / 1000; aim += dir * (t < 0.6 ? 0.0015 : Math.min(0.02, 0.0015 + 0.006 * (t - 0.6) ** 2)); };
      $(id).onpointerdown = (e) => { e.preventDefault(); t0 = performance.now(); nudge(); aimMode = 'fine'; aimModeAt = t0; clearInterval(hold); hold = setTimeout(() => { hold = setInterval(nudge, 50); }, 350); };
      $(id).onpointerup = $(id).onpointerleave = $(id).onpointercancel = () => { clearTimeout(hold); clearInterval(hold); };
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
    ro?.observe($('blStage')); ro?.observe($('blStage').nextElementSibling);  // the controls wrapping to two rows shrinks the table
    ro?.observe(side.firstElementChild);  // so does the info strip above it growing a row
    $('blGear').onclick = () => $('blGear').setAttribute('aria-expanded', side.firstElementChild.classList.toggle('open'));
    raf = requestAnimationFrame(tick);
  }

  function unmount() {
    cancelAnimationFrame(raf); cancelAnimationFrame(roRaf); clearTimeout(animEnd); try { if (roll) rumbleTo(0); } catch {} ro?.disconnect(); setTip = null;
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
      setElev(0);
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
    $('blElev').disabled = !canShoot();
    // a match: racks won, and between racks a card with the score
    $('blRackDone').hidden = !b.between;
    if (b.between) {
      $('blRackTitle').textContent = `🏁 Rack ${b.rackNo} to ${ctx.player(b.rackWinner)?.name ?? '?'}`;
      standingsCard($('blStand'), b.standings, { title: `Race to ${b.race}`, note: 'The next rack is coming up. The break alternates.' });
    }
    // each player's remaining balls
    const onTable = new Set(b.balls.map(([n]) => n));
    const dots = (row, nums, next) => {
      for (const n of nums) {
        const dot = ctx.el('span', 'bl-dot' + (onTable.has(n) ? '' : ' gone') + (n > 8 ? ' stripe' : '') + (n === next ? ' next' : ''), String(n));
        dot.style.setProperty('--c', colorOf(n));
        row.append(dot);
      }
    };
    const groupBalls = (g) => (g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]);
    // the chip on the table: whose shot, and what they're on, so the strip below can scroll out of sight
    const chip = $('blChip'), shooter = ctx.player(S.turn);
    chip.hidden = S.phase !== 'playing' || !!b.between || !shooter;
    if (!chip.hidden) {
      chip.innerHTML = '';
      const name = ctx.el('b', '', shooter.name + (S.turn === me ? ' (you)' : '')); name.style.color = shooter.color;
      chip.append(name);
      const g = b.groups[S.turn], up = b.balls.map(([n]) => n);
      if (b.rules === '9') dots(chip, [b.targets[0]], b.targets[0]);
      else if (b.targets.length === 1 && b.targets[0] === 8 && g) dots(chip, [8], 8);
      else if (g) dots(chip, groupBalls(g).filter((n) => up.includes(n)));
      if (b.lucky != null && b.rules !== '9') chip.append(ctx.el('span', '', `⭐ ${b.lucky}`));
      else chip.append(ctx.el('span', '', b.breaking ? 'to break' : 'open table'));
      const tag = b.inHand && S.turn === me ? '✋ ball in hand' : b.calling && S.turn === me ? (called == null ? '📣 call the 8' : '📣 8 called')
        : b.pushChoice === S.turn ? '🔀 push-out' : pushing ? '🔀 pushing' : '';
      if (tag) chip.append(ctx.el('em', '', tag));
    }
    const racks = $('blRacks'); racks.innerHTML = '';
    if (b.race > 1) {
      const seats = Object.keys(b.racks || {}), row = ctx.el('div', 'bl-rack bl-match');
      row.append(ctx.el('b', '', `🏁 Race to ${b.race} · rack ${b.rackNo}`));
      row.append(ctx.el('span', '', seats.map((i) => `${ctx.player(i)?.name ?? '?'} ${b.racks[i]}`).join(' – ')));
      racks.append(row);
    }
    if (b.rules === '9') {  // nine-ball: no groups, just the balls still up, lowest (the one to hit) first
      const row = ctx.el('div', 'bl-rack');
      row.append(ctx.el('b', '', 'Up next'));
      dots(row, [1, 2, 3, 4, 5, 6, 7, 8, 9], b.targets[0]);
      racks.append(row);
    }
    for (const pid of b.rules === '9' ? [] : Object.keys(b.groups).length ? Object.keys(b.groups) : S.players.filter((p) => !p.spectator).map((p) => p.id)) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'bl-rack' + (pid === S.turn ? ' now' : ''));
      const name = ctx.el('b', '', p.name + (pid === me ? ' (you)' : '')); name.style.color = p.color;
      row.append(name);
      const g = b.groups[pid];
      if (!g) row.append(ctx.el('span', 'hint', ' open table'));
      else dots(row, groupBalls(g));
      racks.append(row);
    }
    if (mine) $('blHint').textContent = `You have ${mine === 'solids' ? '🔵 solids (1–7)' : '🟠 stripes (9–15)'}. Drag to turn the cue, ◀ ▶ fine-tune.`;
  }

  const turnText = (s) => s.phase !== 'playing' ? null : s.billiards.between ? '🏁 Next rack…' : s.billiards.inHand && s.turn === s.me.id ? '✋ Ball in hand' : null;
  return { mount, render, unmount, turnText, focus: true };
})();
