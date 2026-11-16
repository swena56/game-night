// Lane Night: your own lane in 3D (three.js), with your rivals bowling on the lanes either side, or a flat
// top-down lane. Set where you stand and the hook, then drag back anywhere on the lane and let go: the drag
// sets the line (sideways) and the speed (how far back). The server rolls the ball; this plays it back.
UI.lanes = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, seen = 0, primed = false, drag = null, rolledAt = 0, lastDraw = 0, holdUntil = 0;
  let start = 0.2, spin = 0.5, saver = false;
  const $ = (id) => document.getElementById(id);
  const FPS = 30;
  const MAXA = 0.12;
  const colorOf = (id) => ctx?.player(id)?.color ?? '#ccc';
  const L = () => S.lanes;
  const myRow = () => L().rows.find((r) => r.id === S.me?.id);
  const canBowl = () => S?.phase === 'playing' && L().me != null && !L().wait && !anim && performance.now() > holdUntil;
  const powerCss = (t, a = 1) => `hsla(${((1 - Math.min(1, Math.max(0, t))) * 120).toFixed(0)}, 90%, 55%, ${a})`;

  function mount(main, side) {
    gl = null; flat = null; anim = null; seen = 0; primed = false; drag = null; holdUntil = 0; saver = false;
    main.innerHTML = `<div class="ln"><div class="ln-hud"><span id="lnFrame"></span><span id="lnTotal"></span></div>
      <div class="ln-rivals" id="lnRivals"></div>
      <div class="ln-stage" id="lnStage"><div class="ln-word" id="lnWord" hidden></div><div class="ln-power" id="lnPower" hidden><span></span></div></div>
      <div class="ln-ctl">
        <div class="ln-row"><span class="ln-lbl">🧍 Stand</span>
          <div class="ln-dial"><button data-st="-1" aria-label="Stand further left">◀</button><b id="lnStart"></b><button data-st="1" aria-label="Stand further right">▶</button></div>
          <button class="ln-saver ghost-btn" id="lnSaver" hidden title="If this ball leaves exactly one pin, it falls too (once a game)">🎯 Spare saver</button>
        </div>
        <div class="ln-row"><span class="ln-lbl">🌀 Hook</span><span class="ln-end">⟲</span>
          <input type="range" id="lnSpin" min="-100" max="100" step="5" aria-label="Hook: left to right"><span class="ln-end">⟳</span><b id="lnSpinV" class="ln-spinv"></b></div>
      </div>
      <p id="lnHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scoresheet</h3><div id="lnSheet" class="ln-sheet"></div></div>';
    $('lnSpin').value = Math.round(-spin * 100);
    main.querySelector('.ln-ctl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.st) start = Math.max(-0.4, Math.min(0.4, Math.round((start + +b.dataset.st * 0.04) * 100) / 100));
      else if (b.id === 'lnSaver') saver = !saver;
      controls();
    });
    $('lnSpin').addEventListener('input', (e) => { spin = -e.target.value / 100; controls(); });
    const stage = $('lnStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canBowl()) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointermove', (e) => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; } });
    stage.addEventListener('pointerup', () => {
      const r = aimed(); drag = null; $('lnPower').hidden = true;
      if (r && r.speed > 0.08 && canBowl()) bowl(r);
    });
    stage.addEventListener('pointercancel', () => { drag = null; $('lnPower').hidden = true; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; }

  // the drag: back = faster, sideways = the line (slingshot: drag left to send it right)
  function aimed() {
    if (!drag) return null;
    const st = $('lnStage'), h = st.clientHeight || 400, w = st.clientWidth || 300;
    const pull = drag.y - drag.y0, side = drag.x0 - drag.x;
    if (pull < 8) return null;
    return { speed: Math.min(1, pull / Math.max(90, h * 0.38)), angle: Math.max(-MAXA, Math.min(MAXA, (side / Math.max(120, w * 0.6)) * MAXA)) };
  }

  function bowl(r) {
    rolledAt = performance.now();
    ctx.sfx?.('whoosh'); ctx.buzz?.(18);
    const arm = saver && L().spare && L().saver;
    saver = false;
    ctx.quiet(ctx.act('bowl', { start: +start.toFixed(3), angle: +r.angle.toFixed(4), speed: +r.speed.toFixed(3), spin: +spin.toFixed(2), saver: !!arm }));
  }

  function controls() {
    $('lnStart').textContent = start === 0 ? 'centre' : `${start < 0 ? '◀' : '▶'} ${Math.round(Math.abs(start) * 100)}`;
    $('lnSpinV').textContent = Math.abs(spin) < 0.05 ? 'straight' : `${Math.round(Math.abs(spin) * 100)}% ${spin > 0 ? '⟲' : '⟳'}`;
    const sv = $('lnSaver');
    sv.hidden = !(L().spare && L().saver && L().me != null);
    sv.classList.toggle('on', saver);
  }

  // a frame's boxes on the scoresheet: X for a strike, / for a spare, - for a miss
  function marks(fr, last) {
    const out = [];
    let pinsUp = 10;
    fr.forEach((n, k) => {
      const fresh = pinsUp === 10;
      if (fresh && n === 10) { out.push('X'); pinsUp = last ? 10 : 0; }
      else if (!fresh && n === pinsUp) { out.push('/'); pinsUp = 10; }
      else { out.push(n === 0 ? '-' : String(n)); pinsUp = fresh ? 10 - n : 10; }
    });
    return out;
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = L();
    if (!primed) { primed = true; seen = v.shot?.id ?? 0; }
    if (v.shot && v.shot.id !== seen) {
      seen = v.shot.id;
      anim = { shot: v.shot, t0: performance.now(), hi: 0, said: false };
    }
    const me = myRow();
    if (me) {
      const done = me.done, f = Math.min(me.frame, v.nframes - 1);
      $('lnFrame').textContent = done ? '🏁 All frames bowled' : `🎳 Frame ${f + 1} of ${v.nframes} · ball ${me.ball + 1}${f === v.cosmic ? ' · 🌟 COSMIC' : ''}`;
      $('lnFrame').classList.toggle('ln-cosmic', f === v.cosmic && !done);
      $('lnTotal').textContent = `Score ${me.total}`;
    } else { $('lnFrame').textContent = '👀 Watching'; $('lnTotal').textContent = ''; }
    renderRivals(); renderSheet(); controls(); hint();
  }

  function hint() {
    const v = L();
    let t = '';
    if (S.phase === 'playing' && v.me != null) {
      if (v.wait && v.wait !== 'Wait for the pins to settle.') t = v.wait;
      else if (canBowl()) t = gl || flat ? 'Drag back from anywhere on the lane and let go. Sideways sets the line; further back is faster.' : '';
    }
    if ($('lnHint').textContent !== t) $('lnHint').textContent = t;
  }

  function renderRivals() {
    const v = L(), box = $('lnRivals'); box.innerHTML = '';
    for (const r of v.rows) {
      if (r.id === S.me?.id) continue;
      const chip = ctx.el('span', 'ln-rival');
      chip.style.setProperty('--c', colorOf(r.id));
      chip.append(ctx.el('b', '', ctx.player(r.id)?.name ?? '?'), ctx.el('span', '', r.done ? `🏁 ${r.total}` : `F${r.frame + 1} · ${r.total}`));
      if (r.last && Date.now() / 1000 - r.last.at < 4) chip.append(ctx.el('em', 'ln-pop', r.last.word === 'strike' ? 'X' : r.last.word === 'spare' ? '/' : String(r.last.n)));
      box.append(chip);
    }
  }

  function renderSheet() {
    const v = L(), box = $('lnSheet'); box.innerHTML = '';
    const t = ctx.el('table', 'ln-tab');
    const head = ctx.el('tr'); head.append(ctx.el('th', '', ''));
    for (let f = 0; f < v.nframes; f++) head.append(ctx.el('th', f === v.cosmic ? 'ln-cos' : '', f === v.cosmic ? `🌟${f + 1}` : String(f + 1)));
    head.append(ctx.el('th', '', 'Σ'));
    t.append(head);
    for (const r of v.rows) {
      const tr = ctx.el('tr', r.id === S.me?.id ? 'me' : '');
      const nm = ctx.el('td', 'ln-nm', ctx.player(r.id)?.name ?? '?'); nm.style.color = colorOf(r.id);
      tr.append(nm);
      for (let f = 0; f < v.nframes; f++) {
        const td = ctx.el('td', 'ln-f' + (f === r.frame && !r.done ? ' now' : ''));
        const fr = r.frames[f];
        const m = fr ? marks(fr, f === v.nframes - 1) : [];
        td.append(ctx.el('div', 'ln-balls', m.join(' ') || ' '), ctx.el('div', 'ln-cum', r.cum[f] != null ? String(r.cum[f]) : ' '));
        tr.append(td);
      }
      tr.append(ctx.el('td', 'ln-tot', String(r.total)));
      t.append(tr);
    }
    box.append(t);
    box.append(ctx.el('p', 'hint left', `🌟 Frame ${v.cosmic + 1} is cosmic: a strike or spare in it scores +10 more.`));
  }

  // where the ball and my pins are right now
  function scene(now) {
    const v = L();
    if (!anim) {
      return { ball: null, pins: v.standing.map((k) => ({ k, x: v.lane.spots[k][0], y: v.lane.spots[k][1], fall: 0 })) };
    }
    const sh = anim.shot, f = ((now - anim.t0) / 1000) * FPS;
    const bf = sh.tracks.ball, bi = Math.min(bf.length - 1, Math.max(0, Math.floor(f)));
    const ball = f < bf.length + 2 ? { x: bf[bi][0], y: bf[bi][1], f } : null;
    const tr = new Map(sh.tracks.pins.map((t) => [t.k, t]));
    const pins = sh.before.map((k) => {
      const t = tr.get(k);
      const p = { k, x: v.lane.spots[k][0], y: v.lane.spots[k][1], fall: 0, dx: 0, dy: 1 };
      if (t) {
        const i = Math.floor(f - t.s);
        if (i >= 0) {
          const a = t.f[Math.min(t.f.length - 1, i)], b = t.f[Math.min(t.f.length - 1, i + 3)];
          p.x = a[0]; p.y = a[1]; p.dx = b[0] - t.f[0][0]; p.dy = b[1] - t.f[0][1];
          p.fall = Math.min(1, (i + 1) / 7);
          if (t.out && i >= t.f.length - 1) p.gone = true;
        }
      }
      if (sh.saved === k && f > sh.frames - 6) { p.fall = Math.min(1, (f - sh.frames + 6) / 7); p.dx = 0.3; p.dy = 0.5; }
      return p;
    });
    return { ball, pins };
  }

  function loop(now) {
    if (!$('lnStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.lanes) return;
    if (anim) {
      const f = ((now - anim.t0) / 1000) * FPS, sh = anim.shot;
      const firstHit = Math.min(...sh.tracks.pins.map((t) => t.s), Infinity);
      if (anim.hi === 0 && f >= firstHit) { anim.hi = 1; ctx.sfx?.('crack'); if (sh.knocked.length >= 7) gl?.shake(); }
      if (!anim.said && f >= sh.frames) {
        anim.said = true;
        const w = sh.word === 'strike' ? 'STRIKE!' : sh.word === 'spare' ? 'SPARE!' : sh.gutter && !sh.knocked.length ? 'Gutter…' : `${sh.knocked.length}`;
        word(w, sh.word);
        if (sh.word === 'strike') { ctx.sfx?.('fanfare'); ctx.confetti?.(); } else if (sh.word === 'spare') ctx.sfx?.('good');
      }
      if (f >= sh.frames + 22) { anim = null; holdUntil = now + 250; controls(); hint(); }
    }
    const r = aimed(), bar = $('lnPower');
    bar.hidden = !r;
    if (r) { const fill = bar.firstElementChild; fill.style.height = `${r.speed * 100}%`; fill.style.background = powerCss(r.speed); }
    const idle = !anim && !drag && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, scene(now), r);
  }

  function word(text, kind) {
    const w = $('lnWord'); if (!w) return;
    w.textContent = text; w.className = `ln-word ${kind || ''}`; w.hidden = false;
    clearTimeout(word.t); word.t = setTimeout(() => { w.hidden = true; }, 1500);
  }

  // ---------- three.js: world x = lane x, world z = -lane y, y up. My lane at x = 0, rivals either side.
  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) paint(g, w, h);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => { gl?.dispose(); gl = make3d(stage); } });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const ln = L().lane, W = ln.w, HEAD = ln.head, PIT = ln.pit, PITCH = W + 0.75;
    const scene = new T.Scene(); scene.background = new T.Color(0x0e0a1c);
    const camera = new T.PerspectiveCamera(30, 1, 0.05, 120);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.05, hemi: [0xfff1e0, 0x24163a, 0.8],
      key: { i: 0.75, pos: [1.5, 8, -HEAD + 3], area: 2.2, near: 1, far: 20 },
      env: { walls: 0x1a1030, lamp: 0xfff4e6, accent: 0xff4fa3, floor: 0x3a2412 },
      sky: { top: 0x07040f, horizon: 0x2b1650, bottom: 0x0e0a1c, band: 0.1 },
    });
    stg.key.target.position.set(0, 0, -HEAD);
    const low = stg.low;
    const len = PIT + 3;
    // maple and pine boards, the arrows and dots, a foul line
    const wood = canvasTex(T, 128, 2048, (g, w, h) => {
      const boards = 39, bw = w / boards;
      for (let b = 0; b < boards; b++) {
        const l = 62 + Math.random() * 10;
        g.fillStyle = `hsl(32, 55%, ${l}%)`; g.fillRect(b * bw, 0, bw, h);
        g.fillStyle = 'rgba(90,50,20,.18)'; g.fillRect(b * bw, 0, 0.6, h);
        for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,70,30,${Math.random() * 0.1})`; g.fillRect(b * bw + Math.random() * bw, Math.random() * h, 0.7, 20 + Math.random() * 60); }
      }
      const Y = (y) => h - ((y + 1.5) / len) * h;
      g.fillStyle = '#3a1d0e';
      for (const bd of [5, 10, 15, 20, 25, 30, 35]) {  // the arrows, about 4.5 m out
        const x = (bd / boards) * w, y = Y(4.5 + Math.abs(bd - 20) * 0.08);
        g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x - 2.4, y + 4); g.lineTo(x + 2.4, y + 4); g.closePath(); g.fill();
      }
      for (const bd of [3, 5, 8, 11, 14, 25, 28, 31, 34, 36]) { g.beginPath(); g.arc((bd / boards) * w, Y(2.1), 1.4, 0, 7); g.fill(); }
      g.fillStyle = '#c0262d'; g.fillRect(0, Y(0) - 2, w, 4);
      g.fillStyle = 'rgba(255,255,255,.18)'; for (const [k] of ln.spots.map((s, k) => [k])) { const [sx, sy] = ln.spots[k]; g.beginPath(); g.arc(w / 2 + (sx / W) * w, Y(sy), 3, 0, 7); g.fill(); }
    });
    const laneMat = new T.MeshStandardMaterial({ map: wood, roughness: 0.18, metalness: 0, emissive: 0x000000 });
    const gutterMat = new T.MeshStandardMaterial({ color: 0x23202b, roughness: 0.5, metalness: 0.3 });
    const capMat = new T.MeshStandardMaterial({ color: 0x3d2a5c, roughness: 0.6 });
    const pinGeo = (() => {
      const pr = [[0, 0], [0.026, 0], [0.05, 0.05], [0.06, 0.11], [0.05, 0.19], [0.022, 0.25], [0.02, 0.28], [0.03, 0.33], [0.024, 0.37], [0, 0.38]];
      return new T.LatheGeometry(pr.map(([x, y]) => new T.Vector2(x, y)), 16);
    })();
    const pinTex = canvasTex(T, 64, 128, (g, w, h) => {
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c0262d'; g.fillRect(0, h * 0.22, w, h * 0.04); g.fillRect(0, h * 0.29, w, h * 0.04);
    });
    const pinMat = new T.MeshStandardMaterial({ map: pinTex, roughness: 0.25, metalness: 0, emissive: 0x000000 });
    const lanes = [];  // [{x, pins: [mesh x10], id}]
    function buildLane(x) {
      const grp = new T.Group(); grp.position.x = x;
      const deck = new T.Mesh(new T.PlaneGeometry(W, len), laneMat); deck.rotation.x = -Math.PI / 2; deck.position.z = -(len / 2 - 1.5); deck.receiveShadow = true; grp.add(deck);
      for (const sx of [-1, 1]) {
        const gut = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, len, 12, 1, true, 0, Math.PI), gutterMat);
        gut.rotation.set(Math.PI / 2, 0, -Math.PI / 2, 'ZYX');  // a half pipe along the lane, open side up
        gut.position.set(sx * (W / 2 + 0.12), 0, -(len / 2 - 1.5)); gut.material.side = T.DoubleSide; grp.add(gut);
        const cap = new T.Mesh(new T.BoxGeometry(0.12, 0.06, len), capMat); cap.position.set(sx * (W / 2 + 0.3), 0.03, -(len / 2 - 1.5)); grp.add(cap);
      }
      const pit = new T.Mesh(new T.BoxGeometry(W + 0.6, 0.9, 0.2), new T.MeshStandardMaterial({ color: 0x120c1e, roughness: 0.9 }));
      pit.position.set(0, 0.45, -PIT - 0.4); grp.add(pit);
      const hood = new T.Mesh(new T.BoxGeometry(W + 0.6, 0.35, 1.2), new T.MeshStandardMaterial({ color: 0x2a1a48, roughness: 0.5, emissive: 0x2a0f50, emissiveIntensity: 0.4 }));
      hood.position.set(0, 1.0, -PIT + 0.2); grp.add(hood);
      const pins = ln.spots.map(([px, py]) => {
        const m = new T.Mesh(pinGeo, pinMat); m.position.set(px, 0, -py); m.castShadow = !low; grp.add(m); return m;
      });
      scene.add(grp);
      return { x, grp, pins, shown: null, fall: new Map() };
    }
    lanes.push(buildLane(0));
    // the room: dark floor, glowing approach, a neon strip over the pins
    const floor = new T.Mesh(new T.PlaneGeometry(40, len + 20), new T.MeshStandardMaterial({ color: 0x140e22, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.01, -(len / 2)); scene.add(floor);
    const approach = new T.Mesh(new T.PlaneGeometry(30, 4.5), new T.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.3 }));
    approach.rotation.x = -Math.PI / 2; approach.position.set(0, 0.001, 2.2); scene.add(approach);
    const neonTex = canvasTex(T, 512, 64, (g, w, h) => {
      g.fillStyle = '#100820'; g.fillRect(0, 0, w, h);
      g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.shadowColor = '#ff4fa3'; g.shadowBlur = 16; g.fillStyle = '#ffd6ee';
      g.fillText('★ LANE NIGHT ★', w / 2, 46);
    });
    const neon = new T.Mesh(new T.PlaneGeometry(6, 0.75), new T.MeshBasicMaterial({ map: neonTex }));
    neon.position.set(0, 2.1, -PIT - 0.6); scene.add(neon);
    // the ball
    const ballTex = canvasTex(T, 256, 128, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`; g.lineWidth = 6 + Math.random() * 10; g.beginPath(); g.moveTo(Math.random() * w, 0); g.bezierCurveTo(Math.random() * w, h / 3, Math.random() * w, h * 2 / 3, Math.random() * w, h); g.stroke(); }
      g.fillStyle = '#111'; for (const [x, y] of [[0.5, 0.42], [0.46, 0.55], [0.54, 0.55]]) { g.beginPath(); g.arc(x * w, y * h, 6, 0, 7); g.fill(); }
    });
    const ball = new T.Mesh(new T.SphereGeometry(ln.ballR, 28, 18), new T.MeshStandardMaterial({ map: ballTex, color: new T.Color(colorOf(S.me?.id)), roughness: 0.12, metalness: 0.1 }));
    ball.castShadow = !low; scene.add(ball);
    // the aim: a glowing strip along the line, as long as the roll is fast
    const stripeTex = canvasTex(T, 8, 64, (g, w, h) => { g.fillStyle = '#fff'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 9); });
    stripeTex.wrapT = T.RepeatWrapping;
    const aimGeo = new T.PlaneGeometry(0.05, 1); aimGeo.translate(0, 0.5, 0);
    const aimLine = new T.Mesh(aimGeo, new T.MeshBasicMaterial({ map: stripeTex, transparent: true, opacity: 0.9, depthWrite: false }));
    aimLine.rotation.order = 'YXZ';
    scene.add(aimLine);

    let rivalKey = '';
    function syncRivals() {
      const others = L().rows.filter((r) => r.id !== S.me?.id);
      const key = others.map((r) => r.id).join(',');
      if (key !== rivalKey) {
        rivalKey = key;
        while (lanes.length > 1) { const l = lanes.pop(); scene.remove(l.grp); }
        others.forEach((r, i) => { const side = i % 2 ? 1 : -1, n = Math.floor(i / 2) + 1; const l = buildLane(side * n * PITCH); l.id = r.id; lanes.push(l); });
      }
    }
    // a rival lane's pins follow that bowler's standing pins; ones that go down tip over
    function drawRival(l, now) {
      const r = L().rows.find((x) => x.id === l.id);
      if (!r) return;
      const up = new Set(r.standing);
      l.pins.forEach((m, k) => {
        const was = l.shown ? l.shown.has(k) : up.has(k);
        if (was && !up.has(k) && !l.fall.has(k)) l.fall.set(k, { t: now, dir: Math.random() * Math.PI * 2 });
        if (up.has(k)) { l.fall.delete(k); m.visible = true; m.rotation.set(0, 0, 0); m.position.y = 0; return; }
        const fl = l.fall.get(k);
        if (!fl) { m.visible = false; return; }
        const p = Math.min(1, (now - fl.t) / 500);
        m.rotation.set(Math.cos(fl.dir) * p * 1.5, 0, Math.sin(fl.dir) * p * 1.5);
        m.visible = now - fl.t < 1400;
      });
      l.shown = up;
    }

    const cam = { pos: new T.Vector3(0, 1.4, 2.4), look: new T.Vector3(0, 0, -HEAD), tp: new T.Vector3(), tl: new T.Vector3(), fov: 24, tf: 24, moving: true };
    let cosmicK = 0, lastT = 0, spinA = 0;
    function draw(now, st, r) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      syncRivals();
      const v = L(), me = myRow(), tall = camera.aspect < 0.8;
      // 🌟 cosmic frame: black light
      const cosmic = me && !me.done && Math.min(me.frame, v.nframes - 1) === v.cosmic;
      cosmicK += ((cosmic ? 1 : 0) - cosmicK) * Math.min(1, dt * 2);
      stg.hemi.intensity = 0.8 - 0.5 * cosmicK; stg.key.intensity = 0.75 - 0.45 * cosmicK;
      laneMat.emissive.setRGB(0.12 * cosmicK, 0.02 * cosmicK, 0.3 * cosmicK);
      pinMat.emissive.setRGB(0.25 * cosmicK, 0.1 * cosmicK, 0.45 * cosmicK);
      // my pins
      const lane = lanes[0];
      const byK = new Map(st.pins.map((p) => [p.k, p]));
      lane.pins.forEach((m, k) => {
        const p = byK.get(k);
        if (!p || p.gone) { m.visible = false; return; }
        m.visible = true;
        m.position.set(p.x, 0, -p.y);
        const a = Math.atan2(p.dx || 0, p.dy || 1);
        m.rotation.set(-Math.cos(a) * p.fall * 1.45, 0, Math.sin(a) * p.fall * 1.45);
        m.position.y = p.fall * 0.04;
      });
      for (let i = 1; i < lanes.length; i++) drawRival(lanes[i], now);
      // the ball: on the foul line while you aim, rolling along its track while it plays
      if (st.ball) {
        ball.visible = st.ball.y < PIT;
        const prev = ball.position.clone();
        ball.position.set(st.ball.x, ln.ballR, -st.ball.y);
        spinA += prev.distanceTo(ball.position) / ln.ballR;
        ball.rotation.set(-spinA, 0, 0);
      } else {
        ball.visible = !!me && !me.done;
        ball.position.set(start, ln.ballR, -0.3);
      }
      aimLine.visible = !!r;
      if (r) {
        const reach = 4 + r.speed * 12;
        aimLine.position.set(start, 0.012, -0.3);
        aimLine.rotation.set(-Math.PI / 2, -r.angle, 0);
        aimLine.scale.set(1, reach, 1);
        stripeTex.repeat.set(1, reach / 0.5); stripeTex.offset.y = -now / 900;
        aimLine.material.color.setStyle(powerCss(r.speed));
      }
      // camera: behind the foul line, then riding the ball, then looking at the pins
      if (st.ball && st.ball.y < HEAD - 5.5) { cam.tp.set(st.ball.x * 0.5, 0.75, -st.ball.y + 2.2); cam.tl.set(st.ball.x * 0.5, 0.1, -st.ball.y - 6); cam.tf = 34; }
      else if (anim) { cam.tp.set(0, 1.05, -HEAD + 3.6); cam.tl.set(0, 0.12, -HEAD - 0.35); cam.tf = tall ? 34 : 28; }
      else { cam.tp.set(start * 0.7, 0.9, 1.6); cam.tl.set(start * 0.2, 0, -8); cam.tf = tall ? 38 : 28; }
      const k = 1 - Math.exp(-dt * (anim ? 5 : 3));
      cam.pos.lerp(cam.tp, k); cam.look.lerp(cam.tl, k); cam.fov += (cam.tf - cam.fov) * k;
      cam.moving = cam.pos.distanceTo(cam.tp) > 0.01 || cam.look.distanceTo(cam.tl) > 0.01 || cosmicK % 1 > 0.01 && cosmicK < 0.99;
      if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      renderer.render(scene, camera);
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 400;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    }
    return { draw, resize, dispose, shake: () => { if (!low) GL3.shake(camera, 0.12); }, moving: () => cam.moving };
  }

  // ---------- flat fallback: the lane from above, foul line at the bottom, pins at the top
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 20;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth || 320, h = stage.clientHeight || 400;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      k = canvas.height / (L().lane.pit + 1.5);
    }
    function draw(now, st, r) {
      const ln = L().lane, X = (x) => canvas.width / 2 + x * k * 2.2, Y = (y) => canvas.height - (y + 0.8) * k;
      g.fillStyle = '#140e22'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#d7a86e'; g.fillRect(X(-ln.w / 2), Y(ln.pit), ln.w * k * 2.2, Y(-0.8) - Y(ln.pit));
      g.fillStyle = '#c0262d'; g.fillRect(X(-ln.w / 2), Y(0) - 1, ln.w * k * 2.2, 2);
      for (const p of st.pins) {
        if (p.gone) continue;
        g.globalAlpha = 1 - p.fall * 0.6;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(3, ln.pinR * k * 2.2), 0, 7); g.fill();
        g.fillStyle = '#c0262d'; g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(1.5, ln.pinR * k), 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      const b = st.ball || { x: start, y: 0 };
      g.fillStyle = colorOf(S.me?.id); g.beginPath(); g.arc(X(b.x), Y(b.y), Math.max(4, ln.ballR * k * 2.2), 0, 7); g.fill();
      if (r) {
        g.strokeStyle = powerCss(r.speed); g.lineWidth = 3; g.setLineDash([6, 6]);
        g.beginPath(); g.moveTo(X(start), Y(0)); g.lineTo(X(start + Math.sin(r.angle) * 16), Y(Math.cos(r.angle) * 16)); g.stroke(); g.setLineDash([]);
      }
    }
    resize();
    return { draw, resize };
  }

  const turnText = (s) => {
    const me = s.lanes?.rows.find((r) => r.id === s.me?.id);
    return s.phase === 'playing' && me ? (me.done ? '🎳 Waiting for the others' : `🎳 Frame ${Math.min(me.frame, s.lanes.nframes - 1) + 1}`) : null;
  };
  const myMove = (s) => s.phase === 'playing' && s.lanes?.me != null && !s.lanes.wait;

  return { mount, render, unmount, turnText, myMove, focus: true };
})();
