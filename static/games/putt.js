// Putt Party: the hole in 3D (three.js) or top-down 2D. Every putt's path comes from the server and is
// played back on every phone. Aim by dragging back from anywhere (slingshot): direction and power follow
// the drag, an aim line shows both, and letting go putts.
UI.putt = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, holeKey = '', anim = null, seenShot = 0, aim = null;
  const COLORS = { fair: ['#2f9e44', '#37b24d'], sand: '#e9c46a', water: '#3a86ff', slope: '#74c69d' };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    gl = null; flat = null; holeKey = ''; anim = null; seenShot = 0; aim = null;
    main.innerHTML = `<div class="pp"><div class="pp-hud"><span id="ppHole"></span><span id="ppTurn"></span></div>
      <div class="pp-stage" id="ppStage"><div class="pp-power" id="ppPower" hidden><span></span></div></div>
      <p id="ppHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scorecard</h3><div id="ppCard" class="pp-card"></div></div>';
    const stage = $('ppStage');
    main.querySelector('.pp').style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canAim()) return;
      aim = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener('pointermove', (e) => { if (aim) { aim.x = e.clientX; aim.y = e.clientY; } });
    const release = () => {
      if (!aim) return;
      const shot = aimShot();
      aim = null;
      $('ppPower').hidden = true;
      if (shot && shot.power > 0.03 && canAim()) ctx.quiet(ctx.act('putt', { angle: +shot.angle.toFixed(4), power: +shot.power.toFixed(3) }));
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', () => { aim = null; $('ppPower').hidden = true; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const ready = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    });
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); holeKey = ''; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); gl?.dispose(); gl = null; flat = null; }

  const canAim = () => S?.phase === 'playing' && ctx?.myTurn && !anim;
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
    if (p.shot && p.shot.id !== seenShot) {
      if (seenShot) anim = { by: p.shot.by, frames: p.shot.frames, t0: performance.now(), result: p.shot.result };
      seenShot = p.shot.id;
    }
    $('ppHole').textContent = `⛳ Hole ${p.hole} of ${p.holes}`;
    const turn = p.seats.indexOf(S.turn);
    $('ppTurn').textContent = turn >= 0 ? `${turn === p.me ? 'Your' : (ctx.player(S.turn)?.name ?? '?') + "'s"} putt · stroke ${p.strokes[turn] + 1}` : '';
    $('ppHint').textContent = S.phase === 'playing' && ctx.myTurn ? 'Drag back from anywhere and let go to putt.' : '';
    renderCard();
  }

  function renderCard() {
    const p = S.putt, box = $('ppCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores');
    const head = ctx.el('tr');
    head.append(ctx.el('th', '', ''), ...p.cards[0].map((_, k) => ctx.el('th', '', String(k + 1))), ctx.el('th', '', String(p.hole)), ctx.el('th', '', 'Σ'));
    t.append(head);
    p.seats.forEach((pid, i) => {
      const row = ctx.el('tr');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ...p.cards[i].map((v) => ctx.el('td', '', String(v))),
        ctx.el('td', '', p.holed[i] ? `${p.strokes[i]}✓` : String(p.strokes[i])),
        ctx.el('b', '', String(p.cards[i].reduce((a, b) => a + b, 0) + p.strokes[i])));
      t.append(row);
    });
    box.append(t);
  }

  // where each ball is drawn: on its shot path while that animates, else where the server says
  function ballPos(i, now) {
    const p = S.putt;
    if (anim && anim.by === i) {
      const k = Math.floor(((now - anim.t0) / 1000) * 30);
      if (k < anim.frames.length) return anim.frames[k];
      anim = null;
    }
    return p.balls[i];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.putt) return;
    const p = S.putt, key = `${p.hole}:${JSON.stringify(p.cells)}`;
    if (key !== holeKey && (gl || flat)) { holeKey = key; (gl || flat).build(); }
    const shot = aimShot();
    const bar = $('ppPower');
    bar.hidden = !shot;
    if (shot) bar.firstElementChild.style.width = `${shot.power * 100}%`;
    (gl || flat)?.draw(now, shot);
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
      resize();
    }
    function ensureBalls() {
      while (balls.length < S.putt.seats.length) {
        const i = balls.length;
        const m = new T.Mesh(ballGeo, new T.MeshStandardMaterial({ color: new T.Color(colorOf(i)), roughness: 0.3 }));
        m.scale.setScalar(S.putt.ball * 1.3);
        scene.add(m); balls.push(m);
      }
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h;
      const p = S?.putt; if (!p) return;
      const cx = p.cols / 2, cy = p.rows / 2;
      const fit = Math.max(p.rows * 0.62, (p.cols * 0.75) / Math.min(1, camera.aspect));
      camera.position.set(cx, fit * 1.15, -cy + fit * 0.75);
      camera.lookAt(cx, 0, -cy - 0.4);
      camera.updateProjectionMatrix();
    }
    const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
    function toGround(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
      const out = new T.Vector3();
      return ray.ray.intersectPlane(ground, out) ? out : null;
    }
    function screenDir(a) {
      const p0 = toGround(a.x0, a.y0), p1 = toGround(a.x, a.y);
      if (!p0 || !p1) return null;
      return [p0.x - p1.x, -(p0.z - p1.z)];
    }
    function draw(now, shot) {
      ensureBalls();
      const p = S.putt;
      balls.forEach((m, i) => {
        const at = ballPos(i, now);
        const sunk = p.holed[i] && !(anim && anim.by === i);
        m.visible = !sunk || i === p.me;
        m.position.copy(W(at[0], at[1])).setY(sunk ? -0.05 : p.ball * 1.3);
      });
      if (aimLine) { scene.remove(aimLine); aimLine = null; }
      const me = p.me;
      if (shot && me != null) {
        const [bx, by] = p.balls[me], len = 0.4 + shot.power * 2.2;
        const g = new T.BufferGeometry().setFromPoints([W(bx, by).setY(0.04), W(bx + Math.cos(shot.angle) * len, by + Math.sin(shot.angle) * len).setY(0.04)]);
        aimLine = new T.Line(g, new T.LineBasicMaterial({ color: 0xffffff }));
        scene.add(aimLine);
      }
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    return { build, draw, resize, dispose, screenDir };
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

  return { mount, render, unmount, turnText, focus: true };
})();
