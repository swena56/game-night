// Putt Party: the hole in 3D (three.js) or top-down 2D. Every putt's path comes from the server and is
// played back on every phone, one after another. To putt, put your finger on your ball and drag back
// (slingshot): direction and power follow the drag, an aim line shows both, and letting go putts.
// A drag that starts anywhere else moves the view; two fingers pan, pinch to zoom and twist to turn.
// After each of your putts the camera swings round behind your ball, looking down the fairway.
UI.putt = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, holeKey = '', aim = null;
  // shots play back in order: `anim` is the one rolling now, `queue` the ones still to come
  let anim = null, queue = [], seenShot = 0, primed = false;
  let pts = new Map(), gest = null, behindFor = '';
  const COLORS = { fair: ['#2f9e44', '#37b24d'], sand: '#e9c46a', water: '#3a86ff', slope: '#74c69d' };
  const $ = (id) => document.getElementById(id);
  const GRAB = 56;  // px: how near your ball a drag has to start to be a putt

  function mount(main, side) {
    gl = null; flat = null; holeKey = ''; aim = null;
    anim = null; queue = []; seenShot = 0; primed = false;
    pts = new Map(); gest = null; behindFor = '';
    main.innerHTML = `<div class="pp"><div class="pp-hud"><span id="ppHole"></span><span id="ppTurn"></span></div>
      <div class="pp-stage" id="ppStage"><div class="pp-power" id="ppPower" hidden><span></span></div>
        <div class="pp-cam" id="ppCam" hidden>
          <button data-c="left" title="Turn anticlockwise" aria-label="Turn the course anticlockwise">⟲</button>
          <button data-c="right" title="Turn clockwise" aria-label="Turn the course clockwise">⟳</button>
          <button data-c="in" title="Zoom in" aria-label="Zoom in">＋</button>
          <button data-c="out" title="Zoom out" aria-label="Zoom out">－</button>
          <button data-c="ball" title="Look from behind your ball" aria-label="Look from behind your ball">🎯</button>
          <button data-c="fit" title="Show the whole hole" aria-label="Show the whole hole">⛳</button>
        </div>
        <div class="pp-done" id="ppDone" hidden><h3 id="ppDoneTitle"></h3><div id="ppDoneRows"></div><div id="ppStand" hidden></div></div>
      </div>
      <p id="ppHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scorecard</h3><div id="ppCard" class="pp-card"></div></div>';
    const stage = $('ppStage');
    main.querySelector('.pp').style.touchAction = 'none';
    $('ppCam').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('ppCam').addEventListener('click', (e) => {
      const c = e.target.closest('button')?.dataset.c, v = gl?.view;
      if (!c || !v) return;
      if (c === 'left') v.rotate(Math.PI / 4);    // the course turns anticlockwise: the camera swings right
      else if (c === 'right') v.rotate(-Math.PI / 4);
      else if (c === 'in') v.zoom(1.3);
      else if (c === 'out') v.zoom(1 / 1.3);
      else if (c === 'ball') v.behind();
      else if (c === 'fit') v.fit();
    });
    const two = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && gl) { aim = null; $('ppPower').hidden = true; gest = { ...two(), kind: 'two' }; return; }
      if (pts.size > 1) return;
      // a putt starts on your ball (anywhere in the flat view, which has no camera to move)
      const onBall = !gl || gl.nearBall(e.clientX, e.clientY, GRAB);
      if (e.button === 0 && onBall && myTurn()) {
        skipAhead();  // putting now: any putt still rolling jumps to where it stopped
        aim = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
        return;
      }
      if (gl) gest = { x: e.clientX, y: e.clientY, kind: e.button === 2 ? 'turn' : 'pan' };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = gl?.view;
      if (gest?.kind === 'two' && pts.size === 2 && v) {
        const g = two();
        v.pan(gest.x, gest.y, g.x, g.y);
        if (gest.d > 20 && g.d > 20) v.zoom(g.d / gest.d, true);
        v.rotate(gest.ang - g.ang, true);
        gest = { ...g, kind: 'two' };
      } else if (gest?.kind === 'pan' && v) {
        v.pan(gest.x, gest.y, e.clientX, e.clientY);
        gest = { x: e.clientX, y: e.clientY, kind: 'pan' };
      } else if (gest?.kind === 'turn' && v) {  // right-drag with a mouse turns the view
        v.rotate((e.clientX - gest.x) * 0.008, true);
        gest = { x: e.clientX, y: e.clientY, kind: 'turn' };
      } else if (aim) { aim.x = e.clientX; aim.y = e.clientY; }
    });
    const release = (e) => {
      pts.delete(e.pointerId);
      if (gest) { if (!pts.size || gest.kind === 'two') gest = null; return; }
      if (!aim) return;
      const shot = aimShot();
      aim = null;
      $('ppPower').hidden = true;
      if (shot && shot.power > 0.03 && myTurn()) ctx.quiet(ctx.act('putt', { angle: +shot.angle.toFixed(4), power: +shot.power.toFixed(3) }));
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gest = null; aim = null; $('ppPower').hidden = true; });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('wheel', (e) => { if (!gl) return; e.preventDefault(); gl.view.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, true); }, { passive: false });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const ready = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    });
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => {
        if (stage.isConnected && !gl && !flat) flat = make2d(stage);
        holeKey = '';
        if ($('ppCam')) $('ppCam').hidden = !gl;  // the flat view always shows the whole hole
      });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); gl?.dispose(); gl = null; flat = null; }

  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.putt.between;
  const rolling = () => !!(anim || queue.length);
  const skipAhead = () => { anim = null; queue = []; };
  const colorOf = (i) => ctx.player(S.putt.seats[i])?.color ?? '#fff';

  // the drag, turned into a course direction (server x/y) and a power 0..1
  function aimShot() {
    if (!aim) return null;
    const stage = $('ppStage'), size = Math.min(stage.clientWidth || 320, stage.clientHeight || 320);
    const sx = aim.x0 - aim.x, sy = aim.y0 - aim.y;  // slingshot: the ball goes opposite to the drag
    const len = Math.hypot(sx, sy);
    if (len < 6) return null;
    const dir = (gl || flat)?.screenDir?.(aim, sx, sy) ?? [sx, -sy];
    return { angle: Math.atan2(dir[1], dir[0]), power: Math.min(1, len / (size * 0.42)) };
  }

  function render(s, c) {
    S = s; ctx = c;
    const p = S.putt;
    if (!primed) { primed = true; seenShot = p.shot?.id ?? 0; }  // a putt from before you opened the page isn't replayed
    if (p.shot && p.shot.id !== seenShot) {
      seenShot = p.shot.id;
      if (p.shot.frames?.length && p.shot.by < p.balls.length) queue.push({ by: p.shot.by, frames: p.shot.frames, from: p.shot.from, result: p.shot.result, hole: p.hole });
    }
    $('ppHole').textContent = `⛳ Hole ${p.hole} of ${p.holes}`;
    const turn = p.seats.indexOf(S.turn);
    $('ppTurn').textContent = p.between ? `Hole ${p.hole} done` : turn >= 0 ? `${turn === p.me ? 'Your' : (ctx.player(S.turn)?.name ?? '?') + "'s"} putt · stroke ${p.strokes[turn] + 1}` : '';
    hint();
    renderCard();
    renderDone();
  }

  function hint() {
    const p = S.putt, cam = gl ? ' Drag anywhere else to move the view; two fingers zoom and turn.' : '';
    const t = S.phase !== 'playing' ? '' : p.between ? 'Next hole in a moment…'
      : !myTurn() ? (gl ? 'Drag to move the view; two fingers zoom and turn.' : '')
        : gl ? 'Put your finger on your ball (the ringed one), drag back and let go.' + cam : 'Drag back and let go to putt.';
    const h = $('ppHint');
    if (h && h.textContent !== t) h.textContent = t;
  }

  function renderCard() {
    const p = S.putt, box = $('ppCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores');
    const head = ctx.el('tr');
    const live = !p.between;  // between holes, the hole just played is already on the card
    head.append(ctx.el('th', '', ''), ...p.cards[0].map((_, k) => ctx.el('th', '', String(k + 1))));
    if (live) head.append(ctx.el('th', '', String(p.hole)));
    head.append(ctx.el('th', '', 'Σ'));
    t.append(head);
    p.seats.forEach((pid, i) => {
      const row = ctx.el('tr');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ...p.cards[i].map((v) => ctx.el('td', '', String(v))));
      if (live) row.append(ctx.el('td', '', p.holed[i] ? `${p.strokes[i]}✓` : String(p.strokes[i])));
      const tot = ctx.el('td');
      tot.append(ctx.el('b', '', String(p.cards[i].reduce((a, b) => a + b, 0) + (live ? p.strokes[i] : 0))));
      row.append(tot);
      t.append(row);
    });
    box.append(t);
  }

  // between holes: this hole's strokes and the standings, once the last putt has rolled in (see loop)
  function renderDone() {
    const p = S.putt;
    if (!p.between) { $('ppDone').hidden = true; return; }
    $('ppDoneTitle').textContent = `🏁 Hole ${p.hole} of ${p.holes}`;
    const rows = $('ppDoneRows'); rows.innerHTML = '';
    p.seats.forEach((pid, i) => {
      const s = p.cards[i][p.cards[i].length - 1];
      const r = ctx.el('div', 'pp-done-row');
      const nm = ctx.el('span', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      r.append(nm, ctx.el('b', '', p.holed[i] ? (s === 1 ? '🎯 Hole in one!' : `${s} strokes`) : `${s} (picked up)`));
      rows.append(r);
    });
    standingsCard($('ppStand'), p.standings, { title: 'Total so far', note: 'Fewest strokes wins.', lower: true });
  }

  // where each ball is drawn: on its putt's path while that plays, at the start of a putt still waiting
  // to play, else where the server says it is
  function ballPos(i, now) {
    const p = S.putt;
    if (anim && anim.by === i) {
      const k = Math.max(0, Math.floor(((now - anim.t0) / 1000) * 30));
      return anim.frames[Math.min(k, anim.frames.length - 1)];
    }
    const waiting = queue.find((q) => q.by === i);
    return waiting ? waiting.from : p.balls[i];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.putt) return;
    const p = S.putt, key = `${p.hole}:${JSON.stringify(p.cells)}`;
    if (key !== holeKey && (gl || flat)) {
      holeKey = key; behindFor = '';
      queue = queue.filter((q) => q.hole === p.hole); if (anim && anim.hole !== p.hole) anim = null;
      (gl || flat).build();
    }
    // play the putts one after another
    if (anim && (now - anim.t0) / 1000 * 30 >= anim.frames.length + 8) anim = null;  // a short rest at the end
    if (!anim && queue.length) anim = { ...queue.shift(), t0: now };
    // after each of your putts, as soon as your ball stops, the camera swings round behind it
    // (other players' putts can still be rolling: that doesn't hold it up)
    const me = p.me, mineRolling = me != null && ((anim && anim.by === me) || queue.some((q) => q.by === me));
    if (gl && me != null && S.phase === 'playing' && !p.between && !p.holed[me] && p.strokes[me] > 0 && !mineRolling) {
      const k = `${p.hole}:${p.strokes[me]}`;
      if (k !== behindFor) { behindFor = k; gl.view.behind(); }
    }
    $('ppDone').hidden = !p.between || rolling();
    const shot = aimShot();
    const bar = $('ppPower');
    bar.hidden = !shot;
    if (shot) bar.firstElementChild.style.width = `${shot.power * 100}%`;
    (gl || flat)?.draw(now, shot);
    hint();  // the putts finish rolling here, not in render
  }

  // ---------- three.js course: world x = course x, world z = -course y
  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); } catch { return null; }
    if (!renderer.getContext()) { renderer.dispose(); return null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x0c1a2b);
    const camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
    scene.add(new T.HemisphereLight(0xdff3ff, 0x1d3b1d, 0.8));
    const sun = new T.DirectionalLight(0xffffff, 0.7); sun.position.set(-3, 8, 4); scene.add(sun);
    let course = new T.Group(); scene.add(course);
    const balls = [], ballGeo = new T.SphereGeometry(1, 16, 12);
    let aimLine = null;
    // a ring on the ground under your own ball, so you can find it (every ball starts on the same tee)
    const ring = new T.Mesh(new T.RingGeometry(0.1, 0.14, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    const W = (x, y) => new T.Vector3(x, 0, -y);
    function build() {
      scene.remove(course); course = new T.Group(); scene.add(course);
      const p = S.putt, open = new Set(p.cells.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of p.cells) {
        const kind = p.kinds[`${x},${y}`];
        const color = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        const tile = new T.Mesh(new T.BoxGeometry(1, 0.2, 1), new T.MeshStandardMaterial({ color, roughness: 0.9 }));
        tile.position.set(x + 0.5, kind === 'water' ? -0.16 : -0.1, -(y + 0.5)); course.add(tile);
        if (kind === 'slope' && p.slope) {
          const arrow = new T.Mesh(new T.ConeGeometry(0.12, 0.3, 12), new T.MeshBasicMaterial({ color: 0xffffff }));
          arrow.position.set(x + 0.5, 0.02, -(y + 0.5));
          arrow.lookAt(x + 0.5 + p.slope[0], 0.02, -(y + 0.5 + p.slope[1]));  // +Z toward the downhill side
          arrow.rotateX(Math.PI / 2);  // the cone's tip (+Y) now points along +Z
          course.add(arrow);
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (open.has(`${x + dx},${y + dy}`)) continue;
          const wall = new T.Mesh(new T.BoxGeometry(dx ? 0.06 : 1.06, 0.16, dy ? 0.06 : 1.06), new T.MeshStandardMaterial({ color: 0x8d5a2b }));
          wall.position.set(x + 0.5 + dx * 0.5, 0.05, -(y + 0.5 + dy * 0.5)); course.add(wall);
        }
      }
      for (const [bx, by, br] of p.bumpers) {
        const b = new T.Mesh(new T.CylinderGeometry(br, br, 0.14, 24), new T.MeshStandardMaterial({ color: 0xff70a6, emissive: 0x551133 }));
        b.position.copy(W(bx, by)).setY(0.05); course.add(b);
      }
      const cup = new T.Mesh(new T.CylinderGeometry(p.cupR, p.cupR, 0.02, 24), new T.MeshBasicMaterial({ color: 0x111111 }));
      cup.position.copy(W(...p.cup)).setY(0.005); course.add(cup);
      const pole = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.7, 6), new T.MeshStandardMaterial({ color: 0xeeeeee }));
      pole.position.copy(W(...p.cup)).setY(0.35); course.add(pole);
      const flagM = new T.Mesh(new T.PlaneGeometry(0.25, 0.15), new T.MeshBasicMaterial({ color: 0xef476f, side: T.DoubleSide }));
      flagM.position.copy(W(...p.cup)).add(new T.Vector3(0.125, 0.62, 0)); course.add(flagM);
      const tee = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.01, 16), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
      tee.position.copy(W(...p.tee)).setY(0.003); course.add(tee);
      // a new hole starts on the whole-hole view, at once
      Object.assign(goal, HOME); Object.assign(view, HOME);
      resize();
    }
    function ensureBalls() {
      while (balls.length > S.putt.seats.length) scene.remove(balls.pop());  // a rematch with fewer players (#53)
      while (balls.length < S.putt.seats.length) {
        const i = balls.length;
        const m = new T.Mesh(ballGeo, new T.MeshStandardMaterial({ color: new T.Color(colorOf(i)), roughness: 0.3 }));
        m.scale.setScalar(S.putt.ball * 1.3);
        scene.add(m); balls.push(m);
      }
    }

    // The view: turned by yaw (0 = looking up the course from behind the tee), zoomed in from the fit that
    // shows the whole hole, and panned (world x/z). `goal` is where the camera is heading; `view` follows it
    // smoothly, except for finger gestures, which move both at once.
    const HOME = { yaw: 0, zoom: 1, px: 0, pz: 0 };
    const view = { ...HOME }, goal = { ...HOME };
    let box = null, fitD = 10, fitYaw = null, last = 0;
    const TILT = 1.05;  // radians below the horizon: steep enough to read the fairway, shallow enough to feel 3D
    const forward = (yaw) => new T.Vector3(Math.sin(yaw) * Math.cos(TILT), -Math.sin(TILT), -Math.cos(yaw) * Math.cos(TILT));
    function bounds() {
      const p = S.putt;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of p.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
      if (!isFinite(x0)) { x0 = 0; x1 = p.cols; y0 = 0; y1 = p.rows; }
      return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cz: -(y0 + y1) / 2 };
    }
    function aimAt(target, d, yaw) {
      camera.position.copy(target).addScaledVector(forward(yaw), -d);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    }
    // the distance at which the whole hole (every corner, and the flag on top) fits, at this yaw
    function fitFor(yaw) {
      const p = S.putt, target = new T.Vector3(box.cx, 0, box.cz), corners = [];
      for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const h of [0, 0.15]) corners.push(new T.Vector3(x, h, -y));
      corners.push(W(...p.cup).setY(0.75));
      const fits = (d) => { aimAt(target, d, yaw); return corners.every((c) => { const v = c.clone().project(camera); return Math.abs(v.x) <= 0.94 && Math.abs(v.y) <= 0.94 && v.z < 1; }); };
      let lo = 0.5, hi = 60;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      return hi;
    }
    function clamp(v) {
      v.zoom = Math.min(6, Math.max(0.6, v.zoom));
      // keep the point you look at over the course, give or take a tile
      v.px = Math.min(box.x1 + 1 - box.cx, Math.max(box.x0 - 1 - box.cx, v.px));
      v.pz = Math.min(-box.y0 + 1 - box.cz, Math.max(-box.y1 - 1 - box.cz, v.pz));
    }
    function place() {
      if (!box) return;
      clamp(view); clamp(goal);
      if (fitYaw === null || Math.abs(fitYaw - view.yaw) > 0.01) { fitD = fitFor(view.yaw); fitYaw = view.yaw; }
      aimAt(new T.Vector3(box.cx + view.px, 0, box.cz + view.pz), fitD / view.zoom, view.yaw);
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!S?.putt) return;
      box = bounds(); fitYaw = null;
      place();
    }
    // ease the camera toward its goal
    function glide(now) {
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
      const k = 1 - Math.exp(-dt * 5);
      let moved = false;
      for (const key of ['yaw', 'zoom', 'px', 'pz']) {
        const d = goal[key] - view[key];
        if (Math.abs(d) > 1e-3) { view[key] += d * k; moved = true; } else view[key] = goal[key];
      }
      if (moved) place();
    }
    function toGround(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
      const out = new T.Vector3();
      return ray.ray.intersectPlane(ground, out) ? out : null;
    }
    const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
    function screenDir(a) {
      const p0 = toGround(a.x0, a.y0), p1 = toGround(a.x, a.y);
      if (!p0 || !p1) return null;
      return [p0.x - p1.x, -(p0.z - p1.z)];
    }
    // where your ball lies on the screen (client px)
    function ballOnScreen() {
      const p = S?.putt;
      if (!p || p.me == null) return null;
      const v = W(...p.balls[p.me]).project(camera), rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    }
    // is the screen point (x, y) within r px of your ball?
    function nearBall(x, y, r) {
      const b = ballOnScreen();
      return !!b && Math.hypot(x - b.x, y - b.y) <= r;
    }
    // which way the fairway goes from (x, y): toward the next cell of the tee-to-cup path, or the cup
    function downFairway(x, y) {
      const p = S.putt, path = p.path || [];
      if (!path.length) return [p.cup[0] - x, p.cup[1] - y];
      let k = path.findIndex(([cx, cy]) => cx === Math.floor(x) && cy === Math.floor(y));
      if (k < 0) k = path.reduce((best, c, j) => (Math.hypot(c[0] + 0.5 - x, c[1] + 0.5 - y) < Math.hypot(path[best][0] + 0.5 - x, path[best][1] + 0.5 - y) ? j : best), 0);
      const [tx, ty] = k >= path.length - 1 ? p.cup : [path[k + 1][0] + 0.5, path[k + 1][1] + 0.5];
      return [tx - x, ty - y];
    }
    const viewApi = {
      fit() { Object.assign(goal, HOME); },
      rotate(da, now) { goal.yaw += da; if (now) { view.yaw = goal.yaw; place(); } },
      zoom(f, now) { goal.zoom *= f; if (now) { view.zoom = goal.zoom; place(); } },
      // drag the ground under the finger from screen point (x0, y0) to (x1, y1)
      pan(x0, y0, x1, y1) {
        const a = toGround(x0, y0), b = toGround(x1, y1);
        if (!a || !b) return;
        for (const v of [view, goal]) { v.px -= b.x - a.x; v.pz -= b.z - a.z; }
        place();
      },
      // stand behind your ball looking down the fairway, close in, with the ball low in the picture
      behind() {
        const p = S.putt;
        if (p.me == null || !box) return;
        const [bx, by] = p.balls[p.me], [dx, dy] = downFairway(bx, by), len = Math.hypot(dx, dy) || 1;
        let yaw = Math.atan2(dx, dy);
        while (yaw - view.yaw > Math.PI) yaw -= 2 * Math.PI;   // turn the short way round
        while (yaw - view.yaw < -Math.PI) yaw += 2 * Math.PI;
        const d = fitFor(yaw);
        fitYaw = null;
        // close enough to see the ball clearly, far enough to show about three tiles across (a tall phone
        // sees much less side to side than up and down, so the distance follows the screen's shape)
        const across = 1.6 / (camera.aspect * Math.tan((camera.fov / 2) * Math.PI / 180));
        const dist = Math.max(3.6, across), ahead = Math.min(1.4, dist * 0.25);
        Object.assign(goal, { yaw, zoom: d / dist, px: bx + (dx / len) * ahead - box.cx, pz: -(by + (dy / len) * ahead) - box.cz });
        place();  // fitFor() moved the camera while measuring: put it back where the view is now
      },
    };
    function draw(now, shot) {
      ensureBalls();
      glide(now);
      const p = S.putt;
      balls.forEach((m, i) => {
        const at = ballPos(i, now);
        const playing = (anim && anim.by === i) || queue.some((q) => q.by === i);
        const sunk = p.holed[i] && !playing;
        m.visible = !sunk || i === p.me;
        m.position.copy(W(at[0], at[1])).setY(sunk ? -0.05 : p.ball * 1.3);
      });
      if (aimLine) { scene.remove(aimLine); aimLine = null; }
      const me = p.me;
      ring.visible = me != null && !(p.holed[me] && !rolling());
      if (ring.visible) {
        const at = ballPos(me, now);
        ring.position.copy(W(at[0], at[1])).setY(0.006);
        ring.scale.setScalar(myTurn() ? 1 + 0.15 * Math.sin(now / 250) : 1);  // pulses on your turn
      }
      if (shot && me != null) {
        const [bx, by] = p.balls[me], len = 0.4 + shot.power * 2.2;
        const g = new T.BufferGeometry().setFromPoints([W(bx, by).setY(0.04), W(bx + Math.cos(shot.angle) * len, by + Math.sin(shot.angle) * len).setY(0.04)]);
        aimLine = new T.Line(g, new T.LineBasicMaterial({ color: 0xffffff }));
        scene.add(aimLine);
      }
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    return { build, draw, resize, dispose, screenDir, nearBall, ballOnScreen, view: viewApi };
  }

  // ---------- flat top-down fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 30;
    function resize() {
      const p = S?.putt, dpr = Math.min(devicePixelRatio || 1, 2);
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      const cols = p?.cols || 6, rows = p?.rows || 9;
      const unit = Math.min(w / cols, h / rows);
      canvas.style.width = `${unit * cols}px`; canvas.style.height = `${unit * rows}px`;
      canvas.width = Math.round(unit * cols * dpr); canvas.height = Math.round(unit * rows * dpr);
      k = canvas.width / cols;
    }
    const X = (x) => x * k, Y = (y) => canvas.height - y * k;
    function draw(now, shot) {
      const p = S.putt;
      if (!canvas.width) resize();
      g.fillStyle = '#0c1a2b'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (const [x, y] of p.cells) {
        const kind = p.kinds[`${x},${y}`];
        g.fillStyle = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        g.fillRect(X(x), Y(y + 1), k, k);
      }
      for (const [bx, by, br] of p.bumpers) { g.fillStyle = '#ff70a6'; g.beginPath(); g.arc(X(bx), Y(by), br * k, 0, 7); g.fill(); }
      g.fillStyle = '#111'; g.beginPath(); g.arc(X(p.cup[0]), Y(p.cup[1]), p.cupR * k, 0, 7); g.fill();
      p.seats.forEach((_, i) => {
        const at = ballPos(i, now);
        g.fillStyle = colorOf(i); g.strokeStyle = i === p.me ? '#fff' : '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(at[0]), Y(at[1]), Math.max(4, p.ball * k * 1.3), 0, 7); g.fill(); g.stroke();
      });
      if (shot && p.me != null) {
        const [bx, by] = p.balls[p.me], len = 0.4 + shot.power * 2.2;
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(bx), Y(by));
        g.lineTo(X(bx + Math.cos(shot.angle) * len), Y(by + Math.sin(shot.angle) * len)); g.stroke();
      }
    }
    resize();
    return { build: resize, draw, resize, screenDir: (a, sx, sy) => [sx, -sy] };
  }

  const turnText = (s) => (s.phase === 'playing' ? `⛳ Hole ${s.putt.hole} of ${s.putt.holes}` : null);

  // ballOnScreen: where to start a putt, for the browser tests (null in the flat view, where any drag putts)
  return { mount, render, unmount, turnText, focus: true, ballOnScreen: () => gl?.ballOnScreen() ?? null };
})();
