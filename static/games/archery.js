// Wind Archery: a 3D range (three.js) or a flat target face. On your turn: drag to move the sight over the
// target (it moves like a trackpad, so your finger never hides the gold), hold to draw, and let go to loose;
// or nudge with ◀ ▲ ▼ ▶ and tap 🏹 Loose. The server says where the arrow lands; every screen plays the flight.
UI.archery = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, queue = [], seen = 0, primed = false, lastDraw = 0, shotAt = 0, endSeen = 0;
  let aim = { x: 0, y: 0 }, breath = false, hold = null, popT = 0;
  const $ = (id) => document.getElementById(id);
  const HIT = 1.3;       // seconds on the hit close-up
  const V = () => S.archery;
  const colorOf = (i) => ctx?.player(V().seats[i])?.color ?? '#ccc';
  const nameOf = (i) => ctx?.player(V().seats[i])?.name ?? '?';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !V().between;
  const busy = () => !!(anim || queue.length);
  const canShoot = () => myTurn() && !busy();
  const clamp = (v, a) => Math.max(-a, Math.min(a, v));
  // how much of the target plane the aiming view shows (half its short side, in metres): further looks smaller
  const span = (dist) => 0.75 + dist / 100;

  function mount(main, side) {
    gl = null; flat = null; anim = null; queue = []; seen = 0; primed = false; hold = null; breath = false; endSeen = 0;
    aim = { x: 0, y: 0 };
    main.innerHTML = `<div class="ar"><div class="ar-stage" id="arStage">
        <div class="ar-hud"><span id="arEnd"></span><span id="arTurn"></span></div>
        <div class="ar-wind" id="arWind" title="The wind on the flag"><i id="arWindArrow">➤</i><b id="arWindKmh"></b><small>km/h</small></div>
        <div class="ar-pop" id="arPop" hidden></div>
        <div class="ar-done" id="arDone" hidden><h3 id="arDoneTitle"></h3><div id="arStand"></div></div>
      </div>
      <div class="ar-ctl" id="arCtl">
        <div class="ar-pad" role="group" aria-label="Move the sight">
          <button data-n="-1,0" aria-label="Sight left">◀</button><button data-n="0,1" aria-label="Sight up">▲</button>
          <button data-n="0,-1" aria-label="Sight down">▼</button><button data-n="1,0" aria-label="Sight right">▶</button>
        </div>
        <button class="ar-breath" id="arBreath" title="Once a game: no sway and no gust on this arrow">🧘 Steady</button>
        <button class="ar-loose" id="arLoose">🏹 Loose</button>
      </div>
      <p id="arHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scoreboard</h3><div id="arCard" class="ar-card"></div></div>';
    const stage = $('arStage');
    $('arCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.n) {
        if (!myTurn()) return;
        const [dx, dy] = b.dataset.n.split(',').map(Number), step = V().range.ring / 2;
        setAim(aim.x + dx * step, aim.y + dy * step);
      } else if (b.id === 'arBreath') {
        if (myTurn() && V().breath[V().me]) breath = !breath;
      } else if (b.id === 'arLoose') return loose();
      controls();
    });
    // drag anywhere on the range: the sight follows the finger's movement; holding draws the bow, letting go looses
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canShoot() || e.target.closest('button, .ar-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const r = stage.getBoundingClientRect(), k = (2 * span(V().dist)) / Math.max(120, Math.min(r.width, r.height));
      const dx = e.clientX - hold.x, dy = e.clientY - hold.y;
      hold.x = e.clientX; hold.y = e.clientY; hold.moved += Math.abs(dx) + Math.abs(dy);
      setAim(aim.x + dx * k, aim.y - dy * k);
    });
    stage.addEventListener('pointerup', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const drawn = performance.now() - hold.t0 > 350;   // a quick tap doesn't shoot
      if (drawn) loose(); else hold = null;
    });
    stage.addEventListener('pointercancel', () => { hold = null; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; hold = null;
  }

  function setAim(x, y) {
    const a = S?.archery?.range?.aim ?? 1.2;
    aim.x = clamp(x, a); aim.y = clamp(y, a);
  }

  // the sight never sits still: a little when the bow is just up, less at the start of a draw, more the longer it's held
  function sway(now) {
    if (breath || (window.motionOK && !motionOK() && !hold)) return { x: 0, y: 0 };
    const held = hold ? (now - hold.t0) / 1000 : -1;
    const A = held < 0 ? 0.03 : 0.012 + 0.058 * Math.max(0, Math.min(1, (held - 2.5) / 5.5));
    const t = now / 1000;
    return { x: A * (Math.sin(t * 1.7) + 0.5 * Math.sin(t * 3.1 + 1)) / 1.5, y: A * (Math.cos(t * 1.3) + 0.5 * Math.sin(t * 2.7)) / 1.5 };
  }

  function loose() {
    if (!canShoot()) { hold = null; return; }
    const now = performance.now(), s = sway(now), a = V().range.aim;
    hold = null; shotAt = now;
    ctx.sfx?.('whoosh'); ctx.buzz?.(15);
    const useBreath = breath && V().breath[V().me];
    breath = false;
    ctx.quiet(ctx.act('shoot', { ax: +clamp(aim.x + s.x, a).toFixed(3), ay: +clamp(aim.y + s.y, a).toFixed(3), breath: useBreath }));
    controls();
  }

  function controls() {
    if (!S?.archery) return;
    const v = V(), go = canShoot(), mine = myTurn();
    $('arLoose').disabled = !go;
    $('arLoose').classList.toggle('ar-ready', go);
    $('arCtl').classList.toggle('ar-off', !mine);
    const left = v.me != null && v.breath[v.me];
    if (!left) breath = false;
    $('arBreath').disabled = !mine || !left;
    $('arBreath').classList.toggle('on', breath);
    $('arBreath').textContent = left ? (breath ? '🧘 Steady: on' : '🧘 Steady') : '🧘 used';
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = V();
    if (!primed) { primed = true; seen = v.shot?.id ?? 0; endSeen = v.end; }  // a shot from before you opened the page isn't replayed
    if (v.shot && v.shot.id !== seen) { seen = v.shot.id; queue.push({ ...v.shot, dist: v.dist }); }
    if (v.end !== endSeen) { endSeen = v.end; aim = { x: 0, y: 0 }; }       // a new distance: the sight starts on the gold
    $('arEnd').textContent = `🎯 End ${v.end} of ${v.ends} · ${v.dist} m`;
    const who = v.next != null ? (v.next === v.me ? 'Your arrow' : `${nameOf(v.next)}'s arrow`) : '';
    $('arTurn').textContent = v.between ? `End ${v.end} done` : v.next != null ? `${who} · ${v.done + 1} of ${v.order.length}` : '';
    $('arWindKmh').textContent = String(v.kmh);
    $('arWindArrow').style.transform = `rotate(${(-Math.atan2(v.wind[1], v.wind[0]) * 180 / Math.PI).toFixed(0)}deg)`;
    $('arWind').classList.toggle('ar-strong', v.kmh >= 18);
    controls(); renderCard(); renderDone(); hint();
  }

  function hint() {
    const v = V();
    const t = S.phase !== 'playing' ? '' : v.between ? 'Next end in a moment…'
      : !myTurn() ? (busy() ? '' : `Watch where ${v.next != null ? nameOf(v.next) : 'the next archer'} aims and where the arrow lands: it tells you the wind.`)
        : `Drag to move the sight, hold to draw, let go to loose. The wind blows ${v.wind[0] > 0 ? 'to the right →, so aim left' : 'to the left ←, so aim right'}.`;
    if ($('arHint').textContent !== t) $('arHint').textContent = t;
  }

  function renderCard() {
    const v = V(), box = $('arCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores ar-scores');
    const head = ctx.el('tr');
    const cols = v.between ? v.endsLog : [...v.endsLog, v.endPts];
    head.append(ctx.el('th', '', ''), ...cols.map((_, k) => ctx.el('th', '', String(k + 1))), ctx.el('th', '', 'Σ'), ctx.el('th', '', '✖'), ctx.el('th', '', '🏹'));
    t.append(head);
    v.seats.forEach((pid, i) => {
      const row = ctx.el('tr', v.next === i ? 'now' : '');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ...cols.map((r) => ctx.el('td', '', String(r[i] ?? 0))));
      const tot = ctx.el('td', ''); tot.append(ctx.el('b', '', String(v.points[i]))); row.append(tot);
      row.append(ctx.el('td', 'ar-x', v.xs[i] ? String(v.xs[i]) : '·'));
      let left = 0;
      if (!v.between) for (let k = v.done; k < v.order.length; k++) if (v.order[k] === i) left++;
      row.append(ctx.el('td', 'ar-left', (left ? '●'.repeat(left) : '–') + (v.breath[i] ? ' 🧘' : '')));
      t.append(row);
    });
    box.append(t);
    box.append(ctx.el('p', 'hint left', v.apple ? '🍎 The apple is still up: first arrow through it scores +5.' : '🍎 The apple is gone this end.'));
  }

  function renderDone() {
    const v = V();
    if (!v.between) { $('arDone').hidden = true; return; }
    $('arDoneTitle').textContent = `🏁 End ${v.end} · ${v.dist} m`;
    standingsCard($('arStand'), v.standings, { title: 'Points', note: 'Most points wins; ties go to the most ✖.' });
  }

  function pop(shot) {
    const el = $('arPop'); if (!el) return;
    el.textContent = (shot.x10 ? '✖ 10' : shot.ring ? String(shot.ring) : 'Miss') + (shot.apple ? '  🍎 +5' : '') + (shot.split ? '  🏹 split!' : '');
    el.style.color = shot.ring >= 9 ? '#ffd23f' : shot.ring ? '#fff' : '#ff9a9a';
    el.hidden = false; el.classList.remove('ar-pop-in'); void el.offsetWidth; el.classList.add('ar-pop-in');
    popT = performance.now() + 1500;
  }

  // where the flying arrow is at u (0 at the bow, 1 in the target), in range coordinates: x, y on the target
  // plane's axes and d metres down the range. The wind's push grows with the square of the time in the air.
  function arrowAt(shot, u) {
    const x0 = 0.18, y0 = 0.25;   // the bow hand, a little right of and below the eye line (target-centre relative)
    return {
      x: x0 + (shot.ax - x0) * u + (shot.x - shot.ax) * u * u,
      y: y0 + (shot.ay - y0) * u + (shot.y - shot.ay) * u * u + shot.dist * 0.03 * 4 * u * (1 - u),
      d: shot.dist * u,
    };
  }

  // everything a view needs to draw this instant
  function scene(now) {
    const v = V();
    const sh = anim?.shot || queue[0] || null;
    const u = anim ? Math.min(1, (now - anim.t0) / 1000 / anim.shot.t) : 0;
    const landed = anim && u >= 1;
    const pending = sh && !landed ? sh.id : 0;          // this arrow isn't in the target yet
    const arrows = v.arrows.filter((a) => a.id !== pending && !(queue.length && queue.some((q) => q.id === a.id)));
    const apple = v.apple || (sh && sh.apple && !landed ? sh.apple : null);
    const mode = anim ? (landed ? 'hit' : 'flight') : myTurn() ? 'aim' : 'watch';
    const sw = mode === 'aim' ? sway(now) : { x: 0, y: 0 };
    const shooter = sh ? sh.o : v.next;
    return {
      mode, dist: sh?.dist ?? v.dist, wind: v.wind, arrows, apple, shooter,
      sight: mode === 'aim' ? { x: aim.x + sw.x, y: aim.y + sw.y, drawn: !!hold, calm: breath } : null,
      fly: anim && !landed ? { ...arrowAt(anim.shot, u), u, o: anim.shot.o, next: arrowAt(anim.shot, Math.min(1, u + 0.02)) } : null,
      shot: anim?.shot || null, last: !anim && !queue.length ? v.shot : anim?.shot,
      span: span(sh?.dist ?? v.dist),
    };
  }

  function loop(now) {
    if (!$('arStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.archery) return;
    if (!anim && queue.length) {
      anim = { shot: queue.shift(), t0: now, hit: false };
      if (!(anim.shot.o === V().me && now - shotAt < 3000)) ctx.sfx?.('whoosh');
    }
    if (anim) {
      const t = (now - anim.t0) / 1000;
      if (!anim.hit && t >= anim.shot.t) {
        anim.hit = true;
        const sh = anim.shot;
        ctx.sfx?.(sh.ring ? 'thud' : 'drop');
        if (sh.apple) ctx.sfx?.('crack');
        if (sh.o === V().me) ctx.buzz?.(sh.ring >= 9 ? 40 : 20);
        pop(sh); (gl || flat)?.impact?.(sh);
      }
      if (t >= anim.shot.t + HIT) { anim = null; controls(); hint(); }
    }
    if (popT && now > popT) { popT = 0; $('arPop').hidden = true; }
    $('arDone').hidden = !V().between || busy();
    const sc = scene(now);
    // on-demand drawing: every frame while aiming or flying, otherwise ~15 fps for the flag
    const idle = sc.mode === 'watch' && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- the target face, painted once for both views
  const RINGS = ['#f4f4f4', '#f4f4f4', '#22252b', '#22252b', '#3aa0e8', '#3aa0e8', '#e8483f', '#e8483f', '#ffd23f', '#ffd23f'];
  function paintFace(g, cx, cy, R) {
    for (let k = 0; k < 10; k++) {
      g.beginPath(); g.arc(cx, cy, R * (10 - k) / 10, 0, Math.PI * 2);
      g.fillStyle = RINGS[k]; g.fill();
      g.lineWidth = Math.max(1, R / 220); g.strokeStyle = k === 2 || k === 3 ? '#f4f4f4' : '#22252b88'; g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, R / 20, 0, Math.PI * 2); g.strokeStyle = '#22252b88'; g.stroke();   // the ✖ ring
  }

  // ---------- three.js range: world x = target x, world y = up, the target stands at z = -dist; face centre at y = CY
  const CY = 1.3;
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => { gl?.dispose(); gl = make3d(stage); } });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.1, 600);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.0, hemi: [0xdff1ff, 0x5c7a3a, 0.85], env: false,
      key: { color: 0xfff2d6, i: 1.05, pos: [-6, 12, 8], area: 5, near: 1, far: 40, map: 1024 },
      sky: { top: 0x2f7fd6, horizon: 0xbfe6ff, bottom: 0xcfe9d2, radius: 500, band: 0.12 }, fog: [0xcfe9d2, 90, 420],
    });
    const low = stg.low;
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });

    // the field: mown stripes down the range, darker rough either side
    const grass = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#4f9a3c'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#5aa845' : '#4a9238'; g.fillRect(0, k * h / 8, w, h / 8); }
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${20 + Math.random() * 40},${70 + Math.random() * 60},20,.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    grass.wrapS = grass.wrapT = T.RepeatWrapping; grass.repeat.set(40, 40);
    const ground = new T.Mesh(new T.PlaneGeometry(800, 800), std(0xffffff, { map: grass }));
    ground.rotation.x = -Math.PI / 2; ground.position.z = -150; ground.receiveShadow = true; scene3.add(ground);
    const line = new T.Mesh(new T.PlaneGeometry(8, 0.12), new T.MeshBasicMaterial({ color: 0xffffff }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, -0.6); scene3.add(line);
    // a line of trees and soft hills far behind the targets
    const trees = new T.Group();
    const cone = new T.ConeGeometry(1, 1, 7), leaf = [std(0x2f6b2c), std(0x3c7d33), std(0x285a2a)];
    for (let k = 0; k < (low ? 22 : 46); k++) {
      const h = 7 + Math.random() * 8, m = new T.Mesh(cone, leaf[k % 3]);
      m.scale.set(h * 0.32, h, h * 0.32);
      m.position.set(-90 + k * (180 / (low ? 22 : 46)) + Math.random() * 3, h / 2 + 0.5, -100 - Math.random() * 30);
      trees.add(m);
    }
    for (let k = 0; k < 5; k++) {
      const hill = new T.Mesh(new T.SphereGeometry(60, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std([0x6fae5a, 0x7dba66, 0x64a352][k % 3]));
      hill.scale.y = 0.18 + Math.random() * 0.12; hill.position.set(-180 + k * 90, 0, -210 - Math.random() * 40); trees.add(hill);
    }
    scene3.add(trees);

    // the boss: a straw round on a wooden easel, the face on its front, a flag pole behind
    const boss = new T.Group(); scene3.add(boss);
    const straw = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#d2a85a'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(120,80,30,${0.15 + Math.random() * 0.2})`; g.beginPath(); g.arc(w / 2, h / 2, k * 2.2, 0, 7); g.stroke(); }
    });
    const round = new T.Mesh(new T.CylinderGeometry(0.72, 0.72, 0.22, 40), [std(0xc79a4c), std(0xffffff, { map: straw }), std(0xb88a40)]);
    round.rotation.x = Math.PI / 2; round.position.set(0, CY, -0.12); round.castShadow = true; round.receiveShadow = true; boss.add(round);
    const faceTex = tex(1024, 1024, (g, w) => { g.clearRect(0, 0, w, w); paintFace(g, w / 2, w / 2, w / 2 - 2); });
    const face = new T.Mesh(new T.CircleGeometry(0.61, 64), std(0xffffff, { map: faceTex, roughness: 0.8, transparent: true }));
    face.position.set(0, CY, 0.002); face.receiveShadow = true; boss.add(face);
    const wood = std(0x7a5230);
    for (const [x, rz] of [[-0.5, 0.16], [0.5, -0.16]]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.07, 2.2, 0.07), wood); leg.position.set(x, 1.05, -0.26); leg.rotation.z = rz; leg.castShadow = true; boss.add(leg);
    }
    const back = new T.Mesh(new T.BoxGeometry(0.07, 2.3, 0.07), wood); back.position.set(0, 1.0, -0.75); back.rotation.x = -0.42; boss.add(back);
    const pole = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 3.3, 8), std(0xe8e8e8, { roughness: 0.5 })); pole.position.set(0, 1.65, -0.5); boss.add(pole);
    const FW = 0.9, FH = 0.5, FN = 10;
    const flagGeo = new T.PlaneGeometry(FW, FH, FN, 3);
    const flag = new T.Mesh(flagGeo, new T.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.8, side: T.DoubleSide }));
    flag.position.set(0, 3.0, -0.5); boss.add(flag);
    const flagBase = Float32Array.from(flagGeo.attributes.position.array);
    function wave(now, wind) {
      const sp = Math.hypot(wind[0], wind[1]), dir = wind[0] >= 0 ? 1 : -1, lift = Math.min(1, sp / 5), pa = flagGeo.attributes.position, t = now / 1000;
      for (let k = 0; k < pa.count; k++) {
        const u = (flagBase[k * 3] + FW / 2) / FW, v0 = flagBase[k * 3 + 1];   // u: 0 at the pole, 1 at the fly end
        const droop = (1 - lift) * u * u * 0.55, flap = Math.sin(t * (3 + sp * 1.2) - u * 7) * 0.05 * u * (0.4 + lift);
        pa.setXYZ(k, dir * u * FW * (0.45 + 0.55 * lift), v0 - droop + wind[1] * 0.03 * u + flap * 0.5, flap);
      }
      pa.needsUpdate = true; flagGeo.computeVertexNormals();
    }
    // the apple
    const apple = new T.Group();
    const fruit = new T.Mesh(new T.SphereGeometry(0.055, 16, 12), std(0xe02a2a, { roughness: 0.35 })); fruit.scale.y = 0.92; fruit.castShadow = true;
    const stem = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, 0.035, 5), std(0x5a3a1a)); stem.position.y = 0.06;
    const lf = new T.Mesh(new T.SphereGeometry(0.018, 6, 4), std(0x4caf50)); lf.scale.set(1.4, 0.3, 0.8); lf.position.set(0.02, 0.065, 0);
    apple.add(fruit, stem, lf); boss.add(apple);

    // arrows: a shaft, a point and three vanes in the archer's colour; +z is the nock end
    const shaftGeo = new T.CylinderGeometry(0.008, 0.008, 0.72, 6); shaftGeo.rotateX(Math.PI / 2); shaftGeo.translate(0, 0, 0.36);
    const vaneGeo = new T.PlaneGeometry(0.045, 0.14); vaneGeo.translate(0.03, 0, 0); vaneGeo.rotateX(Math.PI / 2); vaneGeo.translate(0, 0, 0.62);
    const nockGeo = new T.SphereGeometry(0.012, 6, 4); nockGeo.translate(0, 0, 0.72);
    const shaftMat = std(0x2b2b2b, { roughness: 0.5 });
    const vaneMats = new Map();
    const vaneMat = (col) => { if (!vaneMats.has(col)) vaneMats.set(col, new T.MeshStandardMaterial({ color: col, roughness: 0.7, side: T.DoubleSide, emissive: col, emissiveIntensity: 0.25 })); return vaneMats.get(col); };
    function makeArrow() {
      const g = new T.Group(), sh = new T.Mesh(shaftGeo, shaftMat); sh.castShadow = true; g.add(sh);
      g.vanes = [0, 1, 2].map((k) => { const m = new T.Mesh(vaneGeo, shaftMat); m.rotation.z = k * 2.094; g.add(m); return m; });
      g.nock = new T.Mesh(nockGeo, shaftMat); g.add(g.nock);
      g.paint = (col) => { const m = vaneMat(col); for (const v of g.vanes) v.material = m; g.nock.material = m; };
      return g;
    }
    const stuck = []; const stuckGroup = new T.Group(); boss.add(stuckGroup);
    const flying = makeArrow(); flying.visible = false; scene3.add(flying);
    // the sight: a ring and a cross on the target plane, and a small ring where the last arrow was aimed
    const basic = (color, o = {}) => new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, fog: false, ...o });
    const sight = new T.Group(); sight.renderOrder = 10;
    const sightMat = basic(0xffffff, { opacity: 0.95 });
    sight.add(new T.Mesh(new T.RingGeometry(0.075, 0.088, 40), sightMat));
    sight.add(new T.Mesh(new T.CircleGeometry(0.008, 12), basic(0xff3355)));
    for (let k = 0; k < 4; k++) { const tick = new T.Mesh(new T.PlaneGeometry(0.05, 0.008), sightMat); tick.position.set(Math.cos(k * Math.PI / 2) * 0.12, Math.sin(k * Math.PI / 2) * 0.12, 0); tick.rotation.z = k * Math.PI / 2; sight.add(tick); }
    sight.traverse((m) => { m.renderOrder = 10; }); boss.add(sight);
    const ghostMat = basic(0xffffff, { opacity: 0.8 });
    const ghost = new T.Mesh(new T.RingGeometry(0.03, 0.04, 24), ghostMat); ghost.renderOrder = 9; boss.add(ghost);
    // the archer on the line (seen as the arrow leaves): a simple figure in the shooter's colour with a bow
    const archer = new T.Group();
    const bodyMat = std(0x8888ff, { roughness: 0.6 });
    const body = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.95, 12), bodyMat); body.position.y = 0.95; body.castShadow = true;
    const legs = new T.Mesh(new T.CylinderGeometry(0.16, 0.13, 0.5, 10), std(0x333a4a)); legs.position.y = 0.25;
    const head = new T.Mesh(new T.SphereGeometry(0.14, 14, 10), std(0xf0c9a0, { roughness: 0.7 })); head.position.y = 1.6; head.castShadow = true;
    const bow = new T.Mesh(new T.TorusGeometry(0.62, 0.016, 6, 24, Math.PI * 0.9), std(0x5a3418, { roughness: 0.5 }));
    bow.rotation.set(0, Math.PI / 2, -Math.PI * 0.45); bow.position.set(-0.3, 1.3, -0.45);
    const arm = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.6, 6), bodyMat); arm.rotation.x = Math.PI / 2; arm.position.set(-0.22, 1.32, -0.3);
    archer.add(body, legs, head, bow, arm); archer.position.set(0.6, 0, 0.1); scene3.add(archer);
    // bits of straw and apple that fly on a hit
    const bits = []; const bitGeo = new T.BoxGeometry(0.02, 0.02, 0.02);
    function burst(x, y, color, n) {
      if (low) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(bitGeo, new T.MeshBasicMaterial({ color }));
        m.position.set(x, CY + y, 0.03);
        m.userData = { vx: (Math.random() - 0.5) * 1.6, vy: Math.random() * 1.8, vz: 0.4 + Math.random() * 1.4, life: 0.7 + Math.random() * 0.4 };
        boss.add(m); bits.push(m);
      }
    }

    const cam = { pos: new T.Vector3(0.6, 1.9, 3.2), look: new T.Vector3(0, CY, -30), fov: 40, init: false };
    const want = { pos: new T.Vector3(), look: new T.Vector3(), fov: 40 };
    let lastT = 0, moving = 0, distNow = 0, lastMode = '';
    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();

    function draw(now, sc, idle) {
      const dt = Math.min(0.2, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const d = sc.dist;
      if (d !== distNow) { distNow = d; boss.position.z = -d; stg.key.position.set(-6, 12, -d + 8); stg.key.target.position.set(0, 1, -d); }
      wave(now, sc.wind);
      // arrows in the boss
      while (stuck.length < sc.arrows.length) { const a = makeArrow(); stuckGroup.add(a); stuck.push(a); }
      stuck.forEach((a, k) => {
        const s = sc.arrows[k];
        a.visible = !!s; if (!s) return;
        a.position.set(s.x, CY + s.y, s.ring ? -0.1 : -0.1);
        if (!s.ring) a.position.set(s.x, Math.max(0.05, Math.min(CY + s.y, 0.2)), 0.6 + (s.id % 5) * 0.25);   // a miss lies in the grass in front
        a.rotation.set(s.ring ? ((s.id * 37) % 10 - 5) * 0.012 - 0.05 : -0.5, ((s.id * 53) % 10 - 5) * 0.012, 0);
        a.paint(colorOf(s.o));
      });
      apple.visible = !!sc.apple;
      if (sc.apple) apple.position.set(sc.apple.x, CY + sc.apple.y, 0.05);
      // the flying arrow
      flying.visible = !!sc.fly;
      if (sc.fly) {
        const f = sc.fly, n = f.next;
        flying.position.set(f.x, CY + f.y, -f.d);
        flying.lookAt(2 * f.x - n.x, CY + 2 * f.y - n.y, -(2 * f.d - n.d));   // +z (the nock) points back along the flight
        flying.paint(colorOf(f.o));
      }
      sight.visible = !!sc.sight;
      if (sc.sight) {
        sight.position.set(sc.sight.x, CY + sc.sight.y, 0.06);
        const k = sc.span / 1.05 * (sc.sight.drawn ? 0.85 : 1); sight.scale.set(k, k, 1);
        sightMat.color.set(sc.sight.calm ? 0x7dffb0 : sc.sight.drawn ? 0xffe066 : 0xffffff);
      }
      const last = sc.mode !== 'flight' ? sc.last : null;
      ghost.visible = !!last && sc.arrows.some((a) => a.id === last.id);
      if (ghost.visible) { ghost.position.set(last.ax, CY + last.ay, 0.055); ghostMat.color.set(colorOf(last.o)); }
      archer.visible = sc.mode === 'flight' && sc.shooter != null;
      if (archer.visible) bodyMat.color.set(colorOf(sc.shooter));
      for (let k = bits.length - 1; k >= 0; k--) {
        const m = bits[k], u = m.userData;
        u.life -= dt; u.vy -= 6 * dt;
        m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt; m.rotation.x += 9 * dt; m.rotation.y += 7 * dt;
        if (u.life <= 0) { boss.remove(m); m.material.dispose(); bits.splice(k, 1); }
      }
      // camera
      const asp = camera.aspect;
      if (sc.mode === 'aim') {
        want.pos.set(0, 1.62, 0.2); want.look.set(0, CY, -d);
        want.fov = 2 * Math.atan(sc.span / d / Math.min(1, asp)) * 180 / Math.PI;
      } else if (sc.mode === 'flight') {
        const f = sc.fly, back = 2.2 + 3.5 * (1 - f.u);
        want.pos.set(f.x * 0.6 - 0.35, CY + f.y + 0.55, -f.d + back); want.look.set(f.x * 0.5, CY + f.y * 0.6, -d);
        want.fov = 46;
      } else if (sc.mode === 'hit') {
        const s = sc.shot; want.pos.set(s.x * 0.5 + 0.7, CY + Math.max(-0.6, s.y) * 0.5 + 0.25, -d + 2.6 / Math.min(1, asp * 1.1));
        want.look.set(s.x * 0.6, CY + Math.max(-0.8, s.y) * 0.6, -d); want.fov = 38;
      } else {
        // waiting: the target close enough to study the arrows in it, from a step to the side
        want.pos.set(1.4, 1.75, 0.4); want.look.set(0, CY + 0.15, -d);
        want.fov = 2 * Math.atan(sc.span * 1.35 / d / Math.min(1, asp)) * 180 / Math.PI;
      }
      const snap = !cam.init || (sc.mode === 'flight' && lastMode !== 'flight');
      const k = snap ? 1 : 1 - Math.exp(-dt * (sc.mode === 'flight' ? 9 : 4.5));
      cam.init = true; lastMode = sc.mode;
      const gap = cam.pos.distanceTo(want.pos) + Math.abs(cam.fov - want.fov) * 0.1;
      moving = gap > 0.01 || bits.length ? 1 : 0;
      cam.pos.lerp(want.pos, k); cam.look.lerp(want.look, k); cam.fov += (want.fov - cam.fov) * k;
      camera.position.copy(cam.pos); camera.fov = cam.fov; camera.updateProjectionMatrix();
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      if (idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize, moving: () => moving,
      impact(sh) {
        if (sh.ring) { burst(sh.x, sh.y, 0xe8c878, 10); GL3.shake(camera, sh.ring >= 9 ? 0.22 : 0.14); }
        if (sh.apple) burst(sh.apple.x, sh.apple.y, 0xe02a2a, 16);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the target face straight on
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the range.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    function draw(now, sc) {
      const k = Math.min(w, h) / 2 / sc.span, cx = w / 2, cy = h / 2 + 6;
      const X = (x) => cx + x * k, Y = (y) => cy - y * k;
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#5aa2e6'); sky.addColorStop(0.62, '#cfe9f5'); sky.addColorStop(0.62, '#5aa845'); sky.addColorStop(1, '#3f8a34');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7a5230'; g.fillRect(X(-0.5) - 3, cy, 6, h); g.fillRect(X(0.5) - 3, cy, 6, h);
      g.beginPath(); g.arc(cx, cy, 0.72 * k, 0, 7); g.fillStyle = '#c79a4c'; g.fill();
      paintFace(g, cx, cy, 0.61 * k);
      // the flag, leaning with the wind
      const sp = Math.hypot(sc.wind[0], sc.wind[1]), dir = sc.wind[0] >= 0 ? 1 : -1, fl = Math.min(1, sp / 5), py = Y(0.72) - 0.55 * k;
      g.strokeStyle = '#eee'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, Y(0.7)); g.lineTo(cx, py); g.stroke();
      g.fillStyle = '#ff5a3c'; g.beginPath(); g.moveTo(cx, py);
      const wob = Math.sin(now / 1000 * (3 + sp)) * 0.03 * k;
      g.lineTo(cx + dir * 0.5 * k * (0.4 + 0.6 * fl), py + 0.25 * k * (1 - fl) + wob); g.lineTo(cx + dir * 0.1 * k, py + 0.24 * k); g.lineTo(cx, py + 0.22 * k); g.fill();
      if (sc.apple) {
        g.beginPath(); g.arc(X(sc.apple.x), Y(sc.apple.y), Math.max(4, 0.055 * k), 0, 7); g.fillStyle = '#e02a2a'; g.fill();
        g.fillStyle = '#4caf50'; g.fillRect(X(sc.apple.x), Y(sc.apple.y) - 0.075 * k, 0.03 * k, 0.02 * k);
      }
      for (const a of sc.arrows) {
        const px = X(a.x), py2 = a.ring ? Y(a.y) : Math.min(h - 8, Math.max(Y(a.y), cy + 0.8 * k));
        g.beginPath(); g.arc(px, py2, Math.max(3.5, 0.02 * k), 0, 7); g.fillStyle = colorOf(a.o); g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#111'; g.stroke();
      }
      const last = sc.mode !== 'flight' ? sc.last : null;
      if (last && sc.arrows.some((a) => a.id === last.id)) { g.beginPath(); g.arc(X(last.ax), Y(last.ay), Math.max(5, 0.035 * k), 0, 7); g.lineWidth = 2; g.strokeStyle = colorOf(last.o); g.stroke(); }
      if (sc.fly) {
        const f = sc.fly, r = 14 * (1 - f.u) + 3;
        g.beginPath(); g.arc(X(f.x), Y(f.y) + (1 - f.u) * h * 0.3, r, 0, 7); g.fillStyle = colorOf(f.o); g.fill(); g.strokeStyle = '#111'; g.stroke();
      }
      if (sc.sight) {
        const sx = X(sc.sight.x), sy = Y(sc.sight.y), r = 0.085 * k * (sc.sight.drawn ? 0.85 : 1);
        g.lineWidth = 2.5; g.strokeStyle = sc.sight.calm ? '#7dffb0' : sc.sight.drawn ? '#ffe066' : '#fff';
        g.beginPath(); g.arc(sx, sy, r, 0, 7); g.stroke();
        g.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(sx + dx * r * 1.15, sy + dy * r * 1.15); g.lineTo(sx + dx * r * 1.7, sy + dy * r * 1.7); } g.stroke();
        g.beginPath(); g.arc(sx, sy, 2.5, 0, 7); g.fillStyle = '#ff3355'; g.fill();
      }
      sparks = sparks.filter((s) => now < s.t + 500);
      for (const s of sparks) {
        const u = (now - s.t) / 500;
        g.beginPath(); g.arc(X(s.x), Y(s.y), 6 + u * 0.2 * k, 0, 7); g.lineWidth = 3 * (1 - u); g.strokeStyle = s.c; g.stroke();
      }
    }
    return {
      draw, resize, moving: () => sparks.length > 0,
      impact(sh) { if (sh.ring) sparks.push({ x: sh.x, y: sh.y, t: performance.now(), c: '#fff' }); if (sh.apple) sparks.push({ x: sh.apple.x, y: sh.apple.y, t: performance.now(), c: '#e02a2a' }); },
      dispose() { canvas.remove(); },
    };
  }

  return { mount, unmount, render };
})();
