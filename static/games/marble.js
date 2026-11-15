// 🌀 Marble Rush: your marble rolls here, in the browser (fixed 120 Hz physics on the course the server
// sent); the server keeps everyone's position for the ghosts and checks finish times. three.js board
// that tilts with your input (GL3), with a flat top-down canvas when WebGL isn't there.
UI.marble = (() => {
  const $ = (id) => document.getElementById(id);
  const R = 0.22, WALL = 0.06, WALL_H = 0.34, TILT = 0.24;  // marble radius, wall half-thickness/height, max tilt (rad)
  const ACC = 7.5, DRAG = 0.85, BOOST = 10, BOUNCE = 0.3, DT = 1 / 120;
  let S, ctx, gfx = null, raf = 0, last = 0, keys = new Set(), keyDown = null, keyUp = null, resizeObs = null;
  let st = null;            // this board's local race: course, marble, timers
  let input = { x: 0, z: 0 }, drag = null, tilt = null, view = { x: 0, z: 0 };
  let ghosts = {}, ghostPos = {};

  // ---------- course + physics
  function newRace(m) {
    const c = m.course;
    const rects = [], grid = Array.from({ length: c.w * c.h }, () => []);
    const seen = new Set();
    const add = (x0, z0, x1, z1) => {
      const k = `${x0},${z0},${x1},${z1}`; if (seen.has(k)) return; seen.add(k);
      const rc = { x0, z0, x1, z1 }; rects.push(rc);
      for (let r = Math.max(0, Math.floor(z0) - 1); r <= Math.min(c.h - 1, Math.floor(z1) + 1); r++)
        for (let q = Math.max(0, Math.floor(x0) - 1); q <= Math.min(c.w - 1, Math.floor(x1) + 1); q++) grid[r * c.w + q].push(rc);
    };
    for (let r = 0; r < c.h; r++) for (let q = 0; q < c.w; q++) {
      const b = c.walls[r * c.w + q];
      if (b & 1) add(q - WALL, r - WALL, q + 1 + WALL, r + WALL);
      if (b & 4) add(q - WALL, r + 1 - WALL, q + 1 + WALL, r + 1 + WALL);
      if (b & 8) add(q - WALL, r - WALL, q + WALL, r + 1 + WALL);
      if (b & 2) add(q + 1 - WALL, r - WALL, q + 1 + WALL, r + 1 + WALL);
    }
    const sx = c.start[0] + 0.5, sz = c.start[1] + 0.5;
    // #97: gems you carry (carry) only count once banked at a flag or the goal (gems); perks from the last break
    const perks = m.perks || [];
    st = { key: raceKey(m), round: m.round, c, rects, grid, x: sx, z: sz, vx: 0, vz: 0, cp: 0, gems: new Set(), carry: new Set(), falls: 0,
      t0: performance.now() + m.startIn * 1000, done: m.done != null, fall: 0, acc: 0, sent: { at: 0, x: sx, z: sz },
      finishing: false, goSeen: false, trail: [], safe: { x: sx, z: sz },
      turbo: perks.includes('turbo') ? 1 : 0, shield: perks.includes('shield'), magnet: perks.includes('magnet') };
    if (st.done) { st.x = c.goal[0] + 0.5; st.z = c.goal[1] + 0.5; }
    ghostPos = {};
  }
  const raceKey = (m) => `${m.round}:${m.course.walls.join('')}:${m.course.path.length}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function respawn() {
    const c = st.c, f = st.cp ? c.flags[st.cp - 1] : c.start;
    st.x = f[0] + 0.5; st.z = f[1] + 0.5; st.vx = st.vz = 0; st.fall = 0;
  }

  function step() {
    const c = st.c;
    // gravity along the tilt, a shove from any pad under the marble, rolling drag, a top speed
    let ax = input.x * ACC, az = input.z * ACC;
    for (const b of c.boosts) if (Math.abs(st.x - b.x) < 0.42 && Math.abs(st.z - b.z) < 0.42) { ax += b.dx * BOOST; az += b.dz * BOOST; }
    st.vx += ax * DT; st.vz += az * DT;
    const k = 1 - DRAG * DT; st.vx *= k; st.vz *= k;
    const sp = Math.hypot(st.vx, st.vz), max = (S.marble.maxSpeed || 7) - 0.3;
    if (sp > max) { st.vx *= max / sp; st.vz *= max / sp; }
    st.x += st.vx * DT; st.z += st.vz * DT;
    // walls: circle against the boxes in the 3×3 cells round the marble
    const cell = clamp(Math.floor(st.z), 0, c.h - 1) * c.w + clamp(Math.floor(st.x), 0, c.w - 1);
    let hit = 0;
    for (const w of st.grid[cell]) {
      const qx = clamp(st.x, w.x0, w.x1), qz = clamp(st.z, w.z0, w.z1);
      let dx = st.x - qx, dz = st.z - qz, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-6) {  // centre inside the box: push out the short way
        const o = [[w.x0 - st.x, 0], [w.x1 - st.x, 0], [0, w.z0 - st.z], [0, w.z1 - st.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        dx = -Math.sign(o[0]); dz = -Math.sign(o[1]); d = 0;
        st.x += o[0] - dx * R; st.z += o[1] - dz * R;
      } else { dx /= d; dz /= d; st.x = qx + dx * R; st.z = qz + dz * R; }
      const vn = st.vx * dx + st.vz * dz;
      if (vn < 0) { st.vx -= (1 + BOUNCE) * vn * dx; st.vz -= (1 + BOUNCE) * vn * dz; hit = Math.max(hit, -vn); }
    }
    st.x = clamp(st.x, R, c.w - R); st.z = clamp(st.z, R, c.h - R);
    if (hit > 2.2) { sfx('rail'); buzz(15); }
    // holes, flags, gems, goal
    let near = false;
    for (const h of c.holes) {
      const d = Math.hypot(st.x - h.x, st.z - h.z);
      if (d < h.r) return fallIn(h);
      if (d < h.r + 0.45) near = true;
    }
    if (!near) { st.safe.x = st.x; st.safe.z = st.z; }  // where a 🛡️ shield puts you back
    c.flags.forEach((f, i) => {
      if (st.cp <= i && Math.floor(st.x) === f[0] && Math.floor(st.z) === f[1]) {
        st.cp = i + 1; sfx('tag');
        const n = bank();
        toast(n ? `🚩 Flag ${i + 1} · 💎×${n} safe!` : `🚩 Flag ${i + 1}`);
      }
    });
    const reach = st.magnet ? 1.05 : 0.36;
    c.gems.forEach((g, i) => {
      if (!st.gems.has(i) && !st.carry.has(i) && Math.hypot(st.x - g.x, st.z - g.z) < reach) {
        st.carry.add(i); sfx('pickup'); buzz(20); toast(`💎 Carrying ${st.carry.size}: reach a 🚩 or the goal to keep it`);
        updateHud();
      }
    });
    if (Math.hypot(st.x - (c.goal[0] + 0.5), st.z - (c.goal[1] + 0.5)) < 0.3) finish();
  }

  // carried gems become yours at a flag or the goal
  function bank() { const n = st.carry.size; for (const i of st.carry) st.gems.add(i); st.carry.clear(); updateHud(); return n; }

  function fallIn(h) {
    if (st.shield) {  // 🛡️ the first fall: back to the last safe spot, gems and all
      st.shield = false; st.x = st.safe.x; st.z = st.safe.z; st.vx = st.vz = 0;
      sfx('rail'); buzz(30); toast('🛡️ Shield! Saved from the hole'); updateHud();
      return;
    }
    st.fall = performance.now(); st.holeX = h.x; st.holeZ = h.z; st.falls++;
    st.vx = st.vz = 0;
    sfx('drop'); buzz([30, 40, 30]);
    if (gfx) GL3.shake(gfx.camera, 0.25);
    const lost = st.carry.size; st.carry.clear();  // carried gems roll back to their spots
    toast((st.cp ? `🕳️ Back to flag ${st.cp}` : '🕳️ Back to the start') + (lost ? ` · 💎×${lost} dropped` : ''));
    updateHud();
    if (S.marble.playing) ctx.quiet(ctx.act('fall', { r: st.round }));
  }

  // ⚡ turbo: one big shove the way you're tilting (or rolling)
  function useTurbo() {
    if (!st || !st.turbo || st.done || st.fall || !S?.marble?.playing || performance.now() < st.t0) return;
    let dx = input.x, dz = input.z, n = Math.hypot(dx, dz);
    if (n < 0.2) { dx = st.vx; dz = st.vz; n = Math.hypot(dx, dz); }
    if (n < 1e-3) return ctx.toast('Tilt a way first, then ⚡');
    st.turbo--; st.vx += (dx / n) * 5; st.vz += (dz / n) * 5;
    sfx('whoosh'); buzz(40); toast('⚡ Turbo!'); updateHud();
  }

  function finish() {
    if (st.finishing || st.done) return;
    st.finishing = true; st.done = true;
    bank();
    const ms = Math.round(performance.now() - st.t0), gems = st.gems.size;
    st.myMs = Math.max(0, ms - gems * (S.marble.gemBonus || 1000));
    sfx('fanfare'); buzz([40, 30, 80]);
    sendPos(true);
    ctx.act('finish', { r: st.round, ms, gems }).catch((e) => ctx.toast(e?.message || 'Finish not counted.'));
    updateHud();
  }

  function sendPos(force) {
    const now = performance.now();
    if (!S.marble.playing || (!force && now - st.sent.at < 200)) return;
    if (!force && Math.abs(st.x - st.sent.x) + Math.abs(st.z - st.sent.z) < 0.04) return;
    st.sent = { at: now, x: st.x, z: st.z };
    ctx.quiet(ctx.act('pos', { r: st.round, x: +st.x.toFixed(3), z: +st.z.toFixed(3), cp: st.cp }));
  }

  // ---------- input: drag (a virtual stick anywhere on the board), keys, or the phone's own tilt
  function readInput(dt) {
    let tx = 0, tz = 0;
    if (tilt?.on && tilt.have) { tx = tilt.x; tz = tilt.z; }
    if (drag) { tx = drag.x; tz = drag.z; }
    const kx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), kz = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    if (kx || kz) { tx = kx; tz = kz; }
    const n = Math.hypot(tx, tz); if (n > 1) { tx /= n; tz /= n; }
    // a quick ease so keys don't snap the board
    const a = 1 - Math.exp(-dt * 14);
    input.x += (tx - input.x) * a; input.z += (tz - input.z) * a;
  }

  function onOrient(e) {
    if (!tilt?.on || e.beta == null || e.gamma == null) return;
    let b = e.beta, g = e.gamma;
    const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
    if (ang === 90) [b, g] = [-g, b]; else if (ang === -90 || ang === 270) [b, g] = [g, -b]; else if (ang === 180) [b, g] = [-b, -g];
    if (!tilt.base) tilt.base = { b, g };
    const dz = (v) => (Math.abs(v) < 2 ? 0 : v - Math.sign(v) * 2);
    tilt.x = clamp(dz(g - tilt.base.g) / 18, -1, 1); tilt.z = clamp(dz(b - tilt.base.b) / 18, -1, 1); tilt.have = true;
  }
  async function toggleTilt() {
    if (tilt?.on) { tilt.on = false; removeEventListener('deviceorientation', onOrient); setTiltBtn(); return; }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return ctx.toast('Tilt needs motion access — drag instead.');
      }
    } catch { return ctx.toast('Tilt isn\'t available here — drag instead.'); }
    tilt = { on: true, base: null, x: 0, z: 0, have: false };
    addEventListener('deviceorientation', onOrient);
    setTimeout(() => { if (tilt?.on && !tilt.have) ctx?.toast('No tilt sensor found — drag instead.'); }, 1500);
    ctx.toast('📱 Tilt on: hold your phone how it feels level, then tip it.');
    setTiltBtn();
  }
  function setTiltBtn() {
    const b = $('mbTilt'); if (!b) return;
    b.textContent = tilt?.on ? '📱 Tilt on · tap to re-level' : '📱 Use tilt';
    b.classList.toggle('on', !!tilt?.on);
  }

  // ---------- three.js scene
  function initThree() {
    const T = window.THREE, stage = $('mbStage');
    const renderer = GL3.renderer({ antialias: true }, { onLost: () => {
      if (!gfx || gfx.renderer !== renderer) return;
      gfx.stg?.dispose(); renderer.dispose(); renderer.domElement.remove(); gfx = null;
      if (stage.isConnected) { initThree(); build(); resize(); }
    } });
    if (!renderer) return;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.1, 400);
    const stg = GL3.stage(renderer, scene, { exposure: 1.05, hemi: [0xdfe8ff, 0x3a2a1a, 0.7],
      key: { i: 0.95, pos: [-5, 14, 7], area: 9, far: 40, map: 1024 },
      sky: { top: 0x1b2a5c, horizon: 0x6a8fd6, bottom: 0x2c3f78 } });
    const board = new T.Group(); scene.add(board);
    const marbleMat = new T.MeshStandardMaterial({ color: 0xe8eef8, metalness: stg.low ? 0.25 : 0.85, roughness: stg.low ? 0.35 : 0.12 });
    const marble = new T.Mesh(new T.SphereGeometry(R, 32, 24), marbleMat); marble.castShadow = true;
    // a swirl band so you can see it roll
    const band = new T.Mesh(new T.TorusGeometry(R * 0.995, 0.03, 8, 40), new T.MeshStandardMaterial({ color: 0x7c5cff, emissive: 0x2a1477, roughness: 0.3 }));
    marble.add(band);
    board.add(marble);
    gfx = { T, renderer, scene, camera, board, marble, stg, parts: null, ghosts: {}, built: null };
    if (st) build();
    resize();
  }

  function disposeGroup(g) {
    g.traverse((m) => { m.geometry?.dispose(); if (m.material) [].concat(m.material).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
  }

  // the board for the current course: plank, floor, walls, holes, pads, flags, gems, start and goal
  function build() {
    if (!gfx || !st || gfx.built === st.key) return;
    const { T, board } = gfx, c = st.c;
    if (gfx.parts) { board.remove(gfx.parts); disposeGroup(gfx.parts); }
    for (const id in gfx.ghosts) { board.remove(gfx.ghosts[id]); disposeGroup(gfx.ghosts[id]); }
    gfx.ghosts = {};
    const parts = new T.Group(); parts.position.set(-c.w / 2, 0, -c.h / 2); board.add(parts);
    gfx.marble.position.set(st.x - c.w / 2, R, st.z - c.h / 2);
    const wood = woodTexture(T);
    const plank = new T.Mesh(new T.BoxGeometry(c.w + 0.7, 0.5, c.h + 0.7), new T.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.8, map: wood }));
    plank.position.set(c.w / 2, -0.28, c.h / 2); plank.receiveShadow = true; parts.add(plank);
    const floor = new T.Mesh(new T.PlaneGeometry(c.w, c.h), new T.MeshStandardMaterial({ color: 0xf0dcb4, roughness: 0.9, map: floorTexture(T, c) }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(c.w / 2, -0.02, c.h / 2); floor.receiveShadow = true; parts.add(floor);
    const wallGeo = new T.BoxGeometry(1, WALL_H, 1);
    const walls = new T.InstancedMesh(wallGeo, new T.MeshStandardMaterial({ color: 0x9b6a3f, roughness: 0.6, map: wood }), st.rects.length);
    const d = new T.Object3D();
    st.rects.forEach((w, i) => {
      d.position.set((w.x0 + w.x1) / 2, WALL_H / 2 - 0.02, (w.z0 + w.z1) / 2); d.scale.set(w.x1 - w.x0, 1, w.z1 - w.z0); d.updateMatrix();
      walls.setMatrixAt(i, d.matrix);
    });
    walls.castShadow = true; walls.receiveShadow = true; parts.add(walls);
    const flat = (geo, mat, x, z, y = 0) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parts.add(m); return m; };
    const holeMat = new T.MeshBasicMaterial({ color: 0x050308 }), rimMat = new T.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.5 });
    for (const h of c.holes) {
      flat(new T.CircleGeometry(h.r + 0.02, 28), holeMat, h.x, h.z, 0.004);
      flat(new T.RingGeometry(h.r + 0.02, h.r + 0.06, 28), rimMat, h.x, h.z, 0.006);
    }
    const start = flat(new T.CircleGeometry(0.36, 32), new T.MeshStandardMaterial({ color: 0x3ad17a, emissive: 0x0f5c2c, roughness: 0.5 }), c.start[0] + 0.5, c.start[1] + 0.5, 0.004);
    start.receiveShadow = true;
    flat(new T.CircleGeometry(0.3, 32), holeMat, c.goal[0] + 0.5, c.goal[1] + 0.5, 0.004);
    const goalRing = new T.Mesh(new T.TorusGeometry(0.34, 0.05, 10, 40), new T.MeshStandardMaterial({ color: 0xffc94a, emissive: 0x7a4a00, metalness: 0.6, roughness: 0.25 }));
    goalRing.rotation.x = -Math.PI / 2; goalRing.position.set(c.goal[0] + 0.5, 0.05, c.goal[1] + 0.5); parts.add(goalRing);
    const beam = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 2.2, 24, 1, true), new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.16, side: T.DoubleSide, depthWrite: false }));
    beam.position.set(c.goal[0] + 0.5, 1.1, c.goal[1] + 0.5); parts.add(beam);
    const arrowShape = new T.Shape(); arrowShape.moveTo(-0.16, -0.3); arrowShape.lineTo(0.16, -0.3); arrowShape.lineTo(0.16, 0.02); arrowShape.lineTo(0.32, 0.02);
    arrowShape.lineTo(0, 0.34); arrowShape.lineTo(-0.32, 0.02); arrowShape.lineTo(-0.16, 0.02); arrowShape.lineTo(-0.16, -0.3);
    const boostMats = [];
    for (const b of c.boosts) {
      const pad = flat(new T.PlaneGeometry(0.82, 0.82), new T.MeshStandardMaterial({ color: 0x0f6f8f, emissive: 0x0a3f55, roughness: 0.4 }), b.x, b.z, 0.003);
      const mat = new T.MeshBasicMaterial({ color: 0x8ff3ff, transparent: true, opacity: 0.9 }); boostMats.push(mat);
      const arrow = new T.Mesh(new T.ShapeGeometry(arrowShape), mat);
      arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = Math.atan2(-b.dx, -b.dz);  // the arrow points the way the pad shoves
      arrow.position.set(b.x, 0.008, b.z); parts.add(arrow); void pad;
    }
    const flags = c.flags.map((f) => {
      const g = new T.Group(); g.position.set(f[0] + 0.78, 0, f[1] + 0.22);
      const pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.7, 6), new T.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5 }));
      pole.position.y = 0.35; pole.castShadow = true; g.add(pole);
      const cloth = new T.Mesh(new T.PlaneGeometry(0.3, 0.2), new T.MeshStandardMaterial({ color: 0xe5484d, side: T.DoubleSide, emissive: 0x3a0505 }));
      cloth.position.set(0.15, 0.58, 0); g.add(cloth); parts.add(g);
      return cloth;
    });
    const gemGeo = new T.OctahedronGeometry(0.17);
    const gems = c.gems.map((gm) => {
      const m = new T.Mesh(gemGeo, new T.MeshStandardMaterial({ color: 0xff5fb8, emissive: 0x8a1458, metalness: 0.3, roughness: 0.15 }));
      m.position.set(gm.x, 0.3, gm.z); m.castShadow = true; parts.add(m); return m;
    });
    gfx.parts = parts; gfx.flags = flags; gfx.gems = gems; gfx.boostMats = boostMats; gfx.beam = beam; gfx.goalRing = goalRing;
    gfx.built = st.key;
    gfx.stg.relight?.();
    resize();
  }

  function woodTexture(T) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d'); if (!g) return null;
    g.fillStyle = '#c99a66'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${90 + (i * 37) % 40},${50 + (i * 13) % 30},20,${0.08 + ((i * 7) % 10) / 80})`;
      g.lineWidth = 1 + (i % 3); g.beginPath(); const y = (i * 53) % 128;
      g.moveTo(0, y); g.bezierCurveTo(40, y + 6, 80, y - 6, 128, y + 2); g.stroke();
    }
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; return t;
  }
  function floorTexture(T, c) {
    const px = 48, cv = document.createElement('canvas'); cv.width = c.w * px; cv.height = c.h * px;
    const g = cv.getContext('2d'); if (!g) return null;
    for (let r = 0; r < c.h; r++) for (let q = 0; q < c.w; q++) {
      g.fillStyle = (q + r) % 2 ? '#f3e2bf' : '#ead4a8'; g.fillRect(q * px, r * px, px, px);
    }
    // the dotted line of the quick route, faint: a hint, not a map
    g.strokeStyle = 'rgba(160,110,60,0.18)'; g.lineWidth = 3; g.setLineDash([4, 8]); g.beginPath();
    c.path.forEach((p, i) => { const x = (p[0] + 0.5) * px, y = (p[1] + 0.5) * px; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    forkMarks(g, c, px);
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; return t;
  }
  // #97: the 🔥 shortcut tinted warm, the 🌿 way round tinted green, a sign on each where they split
  function forkMarks(g, c, px, ox = 0, oz = 0) {
    const f = c.fork; if (!f) return;
    g.setLineDash([]);
    const tint = (cells, col) => { g.fillStyle = col; for (const [q, r] of cells.slice(1, -1)) g.fillRect(ox + q * px, oz + r * px, px, px); };
    tint(f.short, 'rgba(255,90,40,0.16)'); tint(f.long, 'rgba(60,200,110,0.14)');
    g.font = `${Math.round(px * 0.5)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    const sign = (cell, t) => { if (cell) g.fillText(t, ox + (cell[0] + 0.5) * px, oz + (cell[1] + 0.5) * px); };
    sign(f.short[1], '🔥'); sign(f.long[1], '🌿');
  }

  function ghostMesh(id) {
    const { T, board } = gfx;
    const col = ctx.player(id)?.color ?? '#fff';
    const m = new T.Mesh(new T.SphereGeometry(R * 0.92, 20, 14), new T.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.45, roughness: 0.3, emissive: col, emissiveIntensity: 0.25, depthWrite: false }));
    board.add(m); gfx.ghosts[id] = m; return m;
  }

  function draw3d(now, dt) {
    const { T, renderer, scene, camera, board, marble } = gfx, c = st.c;
    build();
    // the board leans with your input (on top of a gentle settle when it's idle)
    const lean = motionOK() ? 1 : 0.4;
    view.x += (input.x - view.x) * Math.min(1, dt * 10); view.z += (input.z - view.z) * Math.min(1, dt * 10);
    board.rotation.z = -view.x * TILT * lean; board.rotation.x = view.z * TILT * lean;
    let y = R;
    if (st.fall) {  // sinking into the hole
      const k = Math.min(1, (now - st.fall) / 600);
      y = R - k * 0.6; marble.position.x += (st.holeX - c.w / 2 - marble.position.x) * 0.2; marble.position.z += (st.holeZ - c.h / 2 - marble.position.z) * 0.2;
    } else {
      const px = st.x - c.w / 2, pz = st.z - c.h / 2;
      const ddx = px - marble.position.x, ddz = pz - marble.position.z;
      marble.position.set(px, y, pz);
      // roll: rotate about the axis across the direction of travel
      const dist = Math.hypot(ddx, ddz);
      if (dist > 1e-5 && dist < 1) {
        const axis = new T.Vector3(ddz, 0, -ddx).normalize();
        marble.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis, dist / R));
      }
    }
    if (st.fall) marble.position.y = y;
    marble.visible = !spectating();
    // ghosts: ease toward their last reported spot
    for (const [id, gh] of Object.entries(ghosts)) {
      if (id === S.me.id && !spectating()) continue;
      const m = gfx.ghosts[id] || ghostMesh(id);
      const p = ghostPos[id] || (ghostPos[id] = { x: gh.x, z: gh.z });
      const a = 1 - Math.exp(-dt * 6); p.x += (gh.x - p.x) * a; p.z += (gh.z - p.z) * a;
      m.position.set(p.x - c.w / 2, R * 0.92, p.z - c.h / 2); m.visible = !gh.out;
    }
    // little life: spinning gems, waving flags, pulsing pads and the goal beam
    const t = now / 1000;
    gfx.gems?.forEach((m, i) => { m.visible = !st.gems.has(i) && !st.carry.has(i); m.rotation.y = t * 2 + i; m.position.y = 0.3 + Math.sin(t * 3 + i) * 0.05; });
    gfx.flags?.forEach((f, i) => { f.rotation.y = Math.sin(t * 4 + i) * 0.35; f.material.color.setHex(st.cp > i ? 0x3ad17a : 0xe5484d); });
    gfx.boostMats?.forEach((m) => { m.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 5)); });
    if (gfx.beam) gfx.beam.material.opacity = 0.1 + 0.08 * Math.sin(t * 3);
    if (gfx.goalRing) gfx.goalRing.rotation.z = t;
    GL3.tickShake(camera, dt);
    gfx.stg.follow(camera);
    renderer.render(scene, camera);
    if (camera.userData.shake) placeCamera();
  }

  function placeCamera() {
    if (!gfx || !st) return;
    const { camera, renderer } = gfx, c = st.c;
    const el = renderer.domElement, w = el.clientWidth || 1, h = el.clientHeight || 1, asp = w / h;
    camera.aspect = asp;
    // fit the board: far enough back that its width fits the view on a narrow phone
    const span = Math.max(c.w, c.h) + 1.4, vf = (camera.fov * Math.PI) / 180;
    const fitH = span / 2 / Math.tan(vf / 2), fitW = span / 2 / (Math.tan(vf / 2) * asp);
    const dist = Math.max(fitH, fitW) * 1.05;
    camera.position.set(0, dist * 0.95, dist * 0.34);
    camera.lookAt(0, 0, 0.15 * span / 2);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const stage = $('mbStage'); if (!stage) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (gfx && w && h) { gfx.renderer.setSize(w, h, false); placeCamera(); }
    const cv = $('mbFallback');
    if (cv && w && h) { const dpr = Math.min(2, devicePixelRatio || 1); cv.width = w * dpr; cv.height = h * dpr; }
  }

  // ---------- flat top-down fallback
  function draw2d() {
    const cv = $('mbFallback'); const g = cv?.getContext?.('2d'); if (!g || !st) return;
    const c = st.c, W = cv.width, H = cv.height, s = Math.min(W / (c.w + 0.6), H / (c.h + 0.6));
    const ox = (W - c.w * s) / 2, oz = (H - c.h * s) / 2, X = (x) => ox + x * s, Z = (z) => oz + z * s;
    g.fillStyle = '#5a3a20'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f0dcb4'; g.fillRect(X(0), Z(0), c.w * s, c.h * s);
    forkMarks(g, c, s, ox, oz);
    const disc = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Z(z), r * s, 0, 7); g.fill(); };
    disc(c.start[0] + 0.5, c.start[1] + 0.5, 0.36, '#3ad17a');
    disc(c.goal[0] + 0.5, c.goal[1] + 0.5, 0.34, '#ffc94a'); disc(c.goal[0] + 0.5, c.goal[1] + 0.5, 0.26, '#111');
    for (const b of c.boosts) { g.fillStyle = '#0f6f8f'; g.fillRect(X(b.x - 0.4), Z(b.z - 0.4), 0.8 * s, 0.8 * s); g.fillStyle = '#8ff3ff'; g.font = `${0.6 * s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.dx > 0 ? '▶' : b.dx < 0 ? '◀' : b.dz > 0 ? '▼' : '▲', X(b.x), Z(b.z)); }
    for (const h of c.holes) disc(h.x, h.z, h.r + 0.02, '#050308');
    c.flags.forEach((f, i) => { g.font = `${0.5 * s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = st.cp > i ? 0.5 : 1; g.fillText('🚩', X(f[0] + 0.75), Z(f[1] + 0.3)); g.globalAlpha = 1; });
    c.gems.forEach((gm, i) => { if (!st.gems.has(i) && !st.carry.has(i)) disc(gm.x, gm.z, 0.15, '#ff5fb8'); });
    g.fillStyle = '#7a4a26';
    for (const w of st.rects) g.fillRect(X(w.x0), Z(w.z0), (w.x1 - w.x0) * s, (w.z1 - w.z0) * s);
    for (const [id, gh] of Object.entries(ghosts)) {
      if (id === S.me.id && !spectating()) continue;
      const p = ghostPos[id] || (ghostPos[id] = { x: gh.x, z: gh.z }); p.x += (gh.x - p.x) * 0.15; p.z += (gh.z - p.z) * 0.15;
      g.globalAlpha = 0.5; disc(p.x, p.z, R * 0.92, ctx.player(id)?.color ?? '#fff'); g.globalAlpha = 1;
    }
    if (!spectating()) {
      const k = st.fall ? Math.max(0.2, 1 - (performance.now() - st.fall) / 600) : 1;
      disc(st.fall ? st.holeX : st.x, st.fall ? st.holeZ : st.z, R * k, '#dfe6f2');
      g.strokeStyle = '#7c5cff'; g.lineWidth = 2; g.beginPath(); g.arc(X(st.x), Z(st.z), R * k * s * 0.7, 0, 7); g.stroke();
    }
  }

  // ---------- loop
  const spectating = () => !S?.marble || !(S.me.id in (S.marble.totals || {})) || S.me.spectator;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!st || !S?.marble) return;
    const m = S.marble;
    readInput(dt);
    const racing = m.stage === 'race' && m.playing && !st.done && now >= st.t0;
    if (racing && !st.goSeen) {
      st.goSeen = true; sfx('whoosh');
      ctx?.rerender?.();  // the top bar's "Get ready…" becomes "Tilt to the goal!"
      if (tilt?.on) tilt.base = null;  // re-level on the phone's angle right now
    }
    if (st.fall && now - st.fall > 900) { respawn(); }
    if (racing && !st.fall) {
      st.acc += dt;
      while (st.acc >= DT && !st.fall && !st.done) { step(); st.acc -= DT; }
      sendPos(false);
    } else st.acc = 0;
    updateClock(now);
    if (gfx) draw3d(now, dt); else draw2d();
  }

  function updateClock(now) {
    const m = S.marble, cd = $('mbCount'), clock = $('mbClock');
    if (!cd || !clock) return;
    const left = (st.t0 - now) / 1000;
    if (m.stage === 'race' && left > 0) { cd.hidden = false; cd.textContent = left > 3 ? 'Ready…' : String(Math.ceil(left)); }
    else if (m.stage === 'race' && left > -0.7) { cd.hidden = false; cd.textContent = 'GO!'; }
    else cd.hidden = true;
    const ms = st.done && st.myMs != null ? st.myMs : st.done ? m.done : Math.max(0, now - st.t0);
    const lim = m.limit * 1000;
    clock.textContent = m.stage !== 'race' ? '' : st.done && ms != null ? `🏁 ${(ms / 1000).toFixed(2)} s` : `⏱️ ${(Math.min(ms, lim) / 1000).toFixed(1)} s`;
    clock.classList.toggle('late', !st.done && lim - ms < 10000 && m.stage === 'race');
  }

  let toastT = 0;
  function toast(text) {
    const t = $('mbToast'); if (!t) return;
    t.textContent = text; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1300);
  }

  // ---------- DOM
  function mount(main, side) {
    S = null; st = null; ghosts = {}; ghostPos = {}; input = { x: 0, z: 0 }; view = { x: 0, z: 0 }; drag = null; last = 0;
    main.innerHTML = `<div class="mb-wrap">
      <div id="mbStage" class="mb-stage"><canvas id="mbFallback"></canvas>
        <div class="mb-hud"><span id="mbBoard"></span><span id="mbClock" class="mb-clock"></span><span id="mbBits"></span></div>
        <div id="mbCount" class="mb-count" hidden></div><div id="mbToast" class="mb-toast"></div>
        <div id="mbStick" class="mb-stick" hidden><i></i></div>
        <div id="mbBanner" class="mb-banner" hidden></div></div>
      <div class="mb-bar"><button id="mbTurbo" class="mb-turbo primary" type="button" hidden>⚡ Turbo</button><button id="mbTilt" class="mb-tiltbtn" type="button">📱 Use tilt</button>
        <span class="hint mb-hint">Drag anywhere on the board to tilt it · ⌨️ arrows / WASD</span></div></div>`;
    side.innerHTML = `<div class="panel"><h3>🌀 The race</h3><div id="mbRivals" class="mb-rivals"></div>
      <div id="mbStand" class="mb-stand" hidden></div><p id="mbPB" class="hint"></p></div>`;
    const stage = $('mbStage');
    $('mbTilt').onclick = () => { if (tilt?.on && tilt.have) { tilt.base = null; ctx.toast('📱 Re-levelled.'); } else toggleTilt(); };
    $('mbTilt').ondblclick = () => { if (tilt?.on) toggleTilt(); };
    $('mbTurbo').onclick = useTurbo;
    const stick = $('mbStick');
    stage.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      drag = { id: e.pointerId, ax: e.clientX, ay: e.clientY, x: 0, z: 0 };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      const r = stage.getBoundingClientRect();
      stick.hidden = false; stick.style.left = `${e.clientX - r.left}px`; stick.style.top = `${e.clientY - r.top}px`;
      stick.firstElementChild.style.transform = '';
      e.preventDefault();
    };
    stage.onpointermove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.ax, dy = e.clientY - drag.ay, reach = 60;
      drag.x = clamp(dx / reach, -1, 1); drag.z = clamp(dy / reach, -1, 1);
      stick.firstElementChild.style.transform = `translate(${drag.x * 26}px, ${drag.z * 26}px)`;
    };
    stage.onpointerup = stage.onpointercancel = (e) => { if (drag && e.pointerId === drag.id) { drag = null; stick.hidden = true; } };
    const KEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' };
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      const k = KEY[e.key]; if (k) { keys.add(k); e.preventDefault(); }
      if (e.key === ' ' && st?.turbo) { useTurbo(); e.preventDefault(); }
    };
    keyUp = (e) => { const k = KEY[e.key]; if (k) keys.delete(k); };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp);
    addEventListener('blur', clearKeys);
    resizeObs = new ResizeObserver(resize); resizeObs.observe(stage);
    GL3.load().then(() => { initThree(); if (gfx) $('mbFallback').hidden = true; resize(); })
      .catch(() => ctx?.toast('3D engine unavailable — using the flat view.'));
    raf = requestAnimationFrame(tick);
  }
  const clearKeys = () => keys.clear();

  function unmount() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp); removeEventListener('blur', clearKeys);
    removeEventListener('deviceorientation', onOrient);
    resizeObs?.disconnect();
    clearTimeout(toastT);
    if (gfx) { if (gfx.parts) disposeGroup(gfx.parts); gfx.stg?.dispose(); gfx.renderer.dispose(); gfx = null; }
    st = null; tilt = null; keys.clear();
  }

  function render(s, c) {
    S = s; ctx = c;
    const m = S.marble;
    if (!st || st.key !== raceKey(m)) { newRace(m); st.view = m; }
    else if (m !== st.view) {
      // a fresh view from the server: keep the countdown in step (never once this board has started here,
      // and never from a re-render of the same old view, whose startIn is stale)
      st.view = m;
      const now = performance.now();
      if (m.stage === 'race' && m.startIn > 0 && now < st.t0) st.t0 = now + m.startIn * 1000;
    }
    if (m.done != null) st.done = true;
    ghosts = m.ghosts || {};
    $('mbBoard').textContent = `Board ${m.round + 1}/${m.rounds}`;
    updateHud();
    renderSide();
    const ban = $('mbBanner');
    const finishedText = () => `🏁 ${((m.done ?? st.myMs ?? 0) / 1000).toFixed(2)} s — ${Object.values(m.ghosts).some((g) => g.done == null && !g.out) ? 'waiting for the others…' : 'board done!'}`;
    ban.hidden = !(S.phase === 'playing' && (m.stage === 'results' || (st.done && !spectating())));
    ban.textContent = m.stage === 'results' ? `📊 Board ${m.round + 1} done · next in ${Math.ceil(m.nextIn)} s` : finishedText();
    if (m.stage === 'results' && m.picks) perkPicker(ban, m);
    $('mbTilt').hidden = spectating() || !('DeviceOrientationEvent' in window) || !matchMedia('(pointer: coarse)').matches;
  }

  // between boards: pick a perk (two for whoever is last) for the next board
  function perkPicker(ban, m) {
    const box = ctx.el('div', 'mb-perks');
    box.append(ctx.el('div', 'mb-perks-head', m.picks > 1 ? '🎁 Pick 2 perks (you are last: catch up!)' : '🎁 Pick a perk for the next board'));
    const row = ctx.el('div', 'mb-perk-row');
    for (const [k, [icon, name, how]] of Object.entries(m.perkInfo || {})) {
      const b = ctx.el('button', 'mb-perk' + (m.pick.includes(k) ? ' on' : ''));
      b.type = 'button'; b.setAttribute('aria-pressed', m.pick.includes(k));
      b.append(ctx.el('span', 'mb-perk-icon', icon), ctx.el('b', '', name), ctx.el('small', '', how));
      b.onclick = () => ctx.quiet(ctx.act('perk', { r: m.round, perk: k }));
      row.append(b);
    }
    box.append(row);
    ban.append(box);
  }

  function updateHud() {
    const m = S?.marble, b = $('mbBits'); if (!m || !b || !st) return;
    b.textContent = `💎 ${st.gems.size}${st.carry.size ? `+${st.carry.size}` : ''}/${st.c.gems.length}` + (st.c.flags.length ? ` · 🚩 ${st.cp}/${st.c.flags.length}` : '')
      + (st.shield ? ' · 🛡️' : '') + (st.magnet ? ' · 🧲' : '');
    const tb = $('mbTurbo'); if (tb) tb.hidden = !st.turbo || st.done || !m.playing;
  }

  function renderSide() {
    const m = S.marble, box = $('mbRivals'); if (!box) return;
    box.innerHTML = '';
    const ids = Object.keys(m.totals || {}).sort((a, b) => (m.totals[a] - m.totals[b]) || ((m.ghosts[b]?.p ?? 0) - (m.ghosts[a]?.p ?? 0)));
    for (const id of ids) {
      const p = ctx.player(id), g = m.ghosts[id] || {};
      const row = ctx.el('div', 'mb-row' + (id === S.me.id ? ' me' : ''));
      const name = ctx.el('span', 'mb-name', p?.name ?? 'left');
      const dot = ctx.el('span', 'mb-dot'); dot.style.background = p?.color ?? '#888'; name.prepend(dot);
      const bar = ctx.el('div', 'mb-prog'); const fill = ctx.el('i'); fill.style.width = `${Math.round((g.p ?? 0) * 100)}%`;
      fill.style.background = p?.color ?? '#888'; bar.append(fill);
      const time = ctx.el('span', 'mb-time', g.done != null ? `🏁 ${(g.done / 1000).toFixed(2)}` : g.out ? 'left' : m.totals[id] ? `Σ ${(m.totals[id] / 1000).toFixed(1)}` : '');
      row.append(name, bar, time); row.dataset.id = id; box.append(row);
    }
    const stand = $('mbStand');
    if (m.standings) standingsCard(stand, m.standings, { title: `After board ${m.round + 1}`, note: 'Lowest total time wins.', lower: true, fmt: (v) => `${(v / 1000).toFixed(2)} s` });
    else stand.hidden = true;
    const pb = typeof Profile !== 'undefined' ? Profile.best?.('marble') : null;
    $('mbPB').textContent = pb ? `⭐ Your best total: ${(pb / 1000).toFixed(2)} s` : '';
  }

  function fast(data) {
    if (!S?.marble || !data.ghosts || data.r !== S.marble.round) return;
    S.marble.ghosts = { ...S.marble.ghosts, ...data.ghosts };
    ghosts = S.marble.ghosts;
    // just move the bars: no full re-render
    for (const row of document.querySelectorAll('#mbRivals .mb-row')) {
      const g = ghosts[row.dataset.id]; const fill = row.querySelector('.mb-prog i');
      if (g && fill) fill.style.width = `${Math.round(g.p * 100)}%`;
    }
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.marble.stage === 'results' ? '📊 Next board soon…'
    : !s.marble.playing ? (s.marble.done != null ? '🏁 Finished — watch the others' : '🌀 Watching the race')
    : st && performance.now() < st.t0 ? '🌀 Get ready…' : '🌀 Tilt to the goal!';
  const myMove = (s) => s.phase === 'playing' && !!s.marble?.playing;

  // (test hooks: where the marble is, and drop it straight on the goal)
  const testState = () => st && { t: performance.now() - st.t0, x: st.x, z: st.z, done: st.done, cp: st.cp, gems: st.gems.size, racing: performance.now() >= st.t0 };
  const testWarp = (x, z) => { if (st) { st.x = x; st.z = z; st.vx = st.vz = 0; } };
  return { mount, render, unmount, fast, turnText, myMove, focus: true, testState, testWarp };
})();
