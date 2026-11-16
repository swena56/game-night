// Snowball Scramble: the server owns the field; this module draws it in 3D (three.js) or 2D, glides the kids
// between updates using their velocity, flies the snowballs along their arcs, and sends the stick and the
// throw button. Controls: drag anywhere for a virtual stick (a quick tap throws), the ❄️ button (hold it to
// pack a big one), or WASD/arrows + Space.
// The server sends throws, hits, splats, fort damage, snow-ins and giant knockdowns as numbered events ("ev").
// On a portrait screen the field is turned a quarter so its long side runs up the screen (the stick turns too).
UI.snowball = (() => {
  let S, ctx, snap = null, gotAt = 0, gl = null, flat = null, raf = 0, ro = null, rot = false;
  let keyDown = null, keyUp = null, drag = null, stick = [0, 0], sentAt = 0, keys = new Set();
  let lastSeq = -1, flash = null, packAt = 0, lastCd = 0, sideAt = 0;
  const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const STICK_PX = 60;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');

  function mount(main, side) {
    S = null; snap = null; gl = null; flat = null; drag = null; stick = [0, 0]; keys = new Set(); lastSeq = -1; flash = null; packAt = 0; rot = false;
    main.innerHTML = `<div class="sw"><div class="sw-stage" id="swStage">
        <div class="sw-hud"><span id="swClock">2:00</span><span id="swPips"></span></div>
        <div class="lr-banner" id="swBanner" hidden></div>
        <div class="lr-banner small sw-flash" id="swFlash" hidden></div>
        <div class="sw-stick" id="swStick" hidden><span></span></div></div>
      <div class="sw-bar"><span id="swInfo" class="hint"></span><button id="swThrow" class="primary">❄️ Throw</button></div></div>`;
    side.innerHTML = `<div class="panel"><div id="swSeats"></div>
      <p class="hint left">Drag anywhere to run, tap to throw. Hold ❄️ to pack a big one. Keyboard: WASD / arrows and Space.</p></div>`;
    main.querySelector('.sw').style.touchAction = 'none';
    const btn = $('swThrow');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch {} press(); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); release(); });
    btn.addEventListener('pointercancel', () => release());
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = $('swStage');
    stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
      showStick(e.clientX, e.clientY, 0, 0);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const m = Math.hypot(dx, dy);
      if (m > 10) drag.moved = true;
      if (m > STICK_PX) { dx *= STICK_PX / m; dy *= STICK_PX / m; }
      showStick(drag.x, drag.y, dx, dy);
      setStick(dx / STICK_PX, dy / STICK_PX);
    });
    const up = () => {
      if (!drag) return;
      if (!drag.moved && performance.now() - drag.at < 300) tap();
      drag = null; $('swStick').hidden = true;
      setStick(0, 0, true);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (KEYS[e.code]) { e.preventDefault(); keys.add(e.code); keyStick(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) press(); }
    };
    keyUp = (e) => {
      if (keys.delete(e.code)) keyStick();
      else if (e.code === 'Space') release();
    };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
    gl?.dispose(); gl = null; flat = null;
  }

  const V = () => S?.snowball;
  const me = () => V()?.me;
  const playing = () => me() != null && S.phase === 'playing';
  const colorOf = (i) => ctx.player(V().seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V().seats[i])?.name ?? '?';

  function showStick(x, y, dx, dy) {
    const st = $('swStick'), box = $('swStage').getBoundingClientRect();
    st.hidden = false;
    st.style.left = `${x - box.left}px`; st.style.top = `${y - box.top}px`;
    st.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function keyStick() {
    let x = 0, y = 0;
    for (const k of keys) { x += KEYS[k][0]; y += KEYS[k][1]; }
    setStick(Math.sign(x), Math.sign(y), true);
  }

  // the stick is in screen terms; on a turned field, screen-down is the field's +y… turned a quarter
  function setStick(x, y, force = false) {
    stick = rot ? [-y, x] : [x, y];
    if (!playing()) return;
    const now = performance.now();
    if (!force && now - sentAt < 50) return;
    sentAt = now;
    ctx.input({ sx: +stick[0].toFixed(3), sy: +stick[1].toFixed(3) }, force);
  }
  function press() { if (!playing() || packAt) return; packAt = performance.now(); ctx.input({ throw: 'down' }, true); renderSide(); }
  function release() { if (!packAt) return; packAt = 0; if (playing()) ctx.input({ throw: 'up' }, true); renderSide(); }
  function tap() { if (playing()) ctx.input({ throw: 'tap' }, true); }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    if (lastSeq < 0) lastSeq = s.snowball.seq ?? 0;   // don't replay what happened before we arrived
    take(s.snowball);
    renderSide();
  }

  function fast(d) {
    if (!V()) return;
    take(d);
    for (const e of d.ev || []) if (e[0] > lastSeq) { lastSeq = e[0]; onEvent(e); }
    const t = performance.now();
    if (t - sideAt > 200) { sideAt = t; renderSide(); }
  }

  function take(d) {
    const was = snap?.st;
    snap = { st: d.st, tl: d.tl, go: d.go, k: d.k, b: d.b, f: d.f, p: d.p };
    gotAt = performance.now();
    Object.assign(V(), { st: d.st, k: d.k, f: d.f, p: d.p });
    if (was === 'countdown' && d.st === 'play') ctx?.sfx?.('whoosh');
    if (d.st !== 'play' && packAt) packAt = 0;
  }

  function showFlash(text, ms = 1400) { flash = { text, until: performance.now() + ms }; }

  function onEvent(e) {
    const [, kind, ...a] = e, i = me();
    if (kind === 'throw') {
      if (a[0] === i) { ctx.sfx?.('whoosh'); ctx.buzz?.(10); }
      gl?.windup(a[0]);
    } else if (kind === 'hit') {
      const [j, by, x, y, big] = a;
      ctx.sfx?.('thud');
      (gl || flat)?.puff(x, y, big ? 30 : 18, colorOf(j));
      if (j === i) { ctx.buzz?.(big ? [40, 30, 60] : 35); gl?.shake(big ? 0.45 : 0.25); }
      else if (by === i) showFlash(big ? '💥 Big hit!' : '🎯 Hit!', 900);
    } else if (kind === 'splat') {
      (gl || flat)?.puff(a[0], a[1], a[2] ? 16 : 9);
    } else if (kind === 'fort') {
      ctx.sfx?.('thud'); (gl || flat)?.puff(a[1], a[2], a[3] ? 20 : 12);
    } else if (kind === 'crumble') {
      ctx.sfx?.('crack'); gl?.crumble(a[0]); flat?.puff(V().forts[a[0]][0], V().forts[a[0]][1], 30);
    } else if (kind === 'regrow') {
      gl?.sparkle(a[0]);
    } else if (kind === 'frozen') {
      const [j, by] = a;
      gl?.freeze(j); flat?.puff(snap.k[j][0], snap.k[j][1], 30, '#bfeaff');
      if (j === i) { ctx.sfx?.('bad'); ctx.buzz?.([80, 50, 160]); showFlash('🧊 Snowed in!', 2000); }
      else if (by === i) { ctx.sfx?.('good'); showFlash(`❄️ You snowed in ${nameOf(j)}! +1`, 1800); }
      else ctx.sfx?.('crack');
    } else if (kind === 'giant') {
      if (a[0] === i) { ctx.sfx?.('pickup'); showFlash('⛄ Giant ready — run into someone!', 1800); }
    } else if (kind === 'flat') {
      const [j, by, x, y] = a;
      ctx.sfx?.('boom'); (gl || flat)?.puff(x, y, 45); gl?.shake(j === i ? 0.7 : 0.35);
      if (j === i) ctx.buzz?.([120, 40, 120]);
      if (by === i) showFlash(`🏔️ Flattened ${nameOf(j)}!`, 1800);
      else if (j === i) showFlash('🏔️ Flattened!', 1500);
    }
  }

  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const timeLeft = (now) => Math.max(0, snap.tl - (snap.st === 'play' ? (now - gotAt) / 1000 : 0));

  function renderSide() {
    const v = V(), box = $('swSeats'); if (!box || !snap) return;
    box.innerHTML = '';
    const order = v.seats.map((_, i) => i).sort((a, b) => snap.k[b][12] - snap.k[a][12]);
    for (const i of order) {
      const p = ctx.player(v.seats[i]), k = snap.k[i];
      const row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const state = k[8] > 0 ? ' 🧊' : k[9] > 0 ? ' 💫' : k[11] >= 0.99 ? ' ⛄' : '';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === v.me ? ' (you)' : ''}${state}`),
        ctx.el('span', 'sw-pipline', '●'.repeat(k[7]) + '○'.repeat(Math.max(0, v.pips - k[7]))), ctx.el('b', '', `❄️ ${k[12]}`));
      box.append(row);
    }
    const mine = v.me != null ? snap.k[v.me] : null, b = $('swThrow');
    b.parentElement.hidden = v.me == null;
    if (!mine) return;
    const stuck = mine[8] > 0 || mine[9] > 0;
    b.disabled = snap.st !== 'play' || stuck || S.phase !== 'playing';
    const held = packAt ? (performance.now() - packAt) / 1000 : 0;
    b.classList.toggle('sw-big', held >= v.bigHold);
    b.classList.toggle('sw-packing', !!packAt);
    b.textContent = packAt ? (held >= v.bigHold ? '⛄ Big one!' : '❄️ Packing…') : `❄️ Throw ${'●'.repeat(mine[6])}${'○'.repeat(Math.max(0, v.ammoMax - mine[6]))}`;
    $('swInfo').textContent = mine[8] > 0 ? `🧊 Snowed in ${mine[8].toFixed(1)}s` : mine[9] > 0 ? '💫 Knocked flat' : mine[11] > 0.05 && mine[11] < 0.99 ? `⛄ ${Math.round(mine[11] * 100)}%` : '';
  }

  // where kid i is now: the last known position plus its velocity since then (capped)
  function pos(i, now) {
    const k = snap.k[i];
    const t = snap.st === 'play' ? Math.min(0.12, (now - gotAt) / 1000) : 0;
    return [k[0] + k[2] * t, k[1] + k[3] * t];
  }
  // a snowball in flight: its point along the arc (x, y on the field, h above it) and how far along it is
  function ballAt(b, now) {
    const left = b[4] - (now - gotAt) / 1000, f = Math.max(0, Math.min(1, 1 - left / (b[5] || 1)));
    const d = Math.hypot(b[2] - b[0], b[3] - b[1]), top = 0.8 + d * 0.18;
    return { x: b[0] + (b[2] - b[0]) * f, y: b[1] + (b[3] - b[1]) * f, h: 1.0 * (1 - f) + 4 * top * f * (1 - f), f };
  }
  const nearMe = (b, now) => {
    const i = me(); if (i == null || b[7] === i) return false;
    const [x, y] = pos(i, now);
    return Math.hypot(b[2] - x, b[3] - y) < V().splash[b[6] ? 1 : 0] + V().body * 0.5;
  };

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !V()) return;
    (gl || flat)?.draw(now);
    const v = V(), cd = snap.st === 'countdown' ? snap.go - (now - gotAt) / 1000 : 0;
    let text = '';
    if (S.phase === 'playing' && snap.st === 'countdown') text = cd > 0 ? String(Math.ceil(cd)) : 'GO!';
    const c = S.phase === 'playing' && snap.st === 'countdown' ? Math.ceil(cd) : 0;
    if (c !== lastCd) { if (c > 0 && c <= 3) ctx.sfx?.('tick'); lastCd = c; }
    $('swBanner').hidden = !text; $('swBanner').textContent = text;
    const mine = v.me != null ? snap.k[v.me] : null;
    let small = flash && now < flash.until ? flash.text : '';
    if (!small && mine && snap.st === 'play' && mine[8] > 0) small = `🧊 ${Math.ceil(mine[8] - (now - gotAt) / 1000)}`;
    $('swFlash').hidden = !small; $('swFlash').textContent = small;
    const tl = timeLeft(now);
    $('swClock').textContent = `⏱ ${clock(tl)}`;
    $('swClock').classList.toggle('sw-hurry', snap.st === 'play' && tl <= 10);
    $('swPips').textContent = mine ? '💙'.repeat(Math.max(0, v.pips - mine[7])) + '🤍'.repeat(mine[7]) : '';
    if (packAt && Math.floor(now / 100) % 2 === 0) renderSide();
  }

  // ---------- three.js snowfield
  function canvasTex(T, size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); if (g) draw(g, size);
    return new T.CanvasTexture(c);
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => { if (!stage.isConnected) return; gl?.dispose(); gl = make3d(stage); if (!gl) flat ||= make2d(stage); } });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const v0 = V(), AW = v0.aw, AH = v0.ah;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.5, 300);
    const stg = GL3.stage(renderer, scene, {
      exposure: 0.95, hemi: [0xeef5ff, 0x5a6f90, 0.8],
      key: { i: 1.05, color: 0xfff4e0, pos: [-9, 18, 7], area: AW + 3, near: 2, far: 60 },
      sky: { top: 0x6f9fd8, horizon: 0xe8f2ff, bottom: 0xdfe9f5, band: 0.1 },
      fog: [0xe8f2ff, 40, 110],
    });
    const low = stg.low;
    const field = new T.Group(); scene.add(field);   // everything in field coordinates: x → x, y → z
    // the snow: a soft speckled white, a touch bluer outside the walls
    const snowTex = canvasTex(T, 128, (g, n) => {
      g.fillStyle = '#f4f8ff'; g.fillRect(0, 0, n, n);
      for (let k = 0; k < 500; k++) { g.fillStyle = Math.random() < 0.5 ? '#e3ecf8' : '#ffffff'; g.fillRect(Math.random() * n, Math.random() * n, 2, 2); }
    });
    snowTex.wrapS = snowTex.wrapT = T.RepeatWrapping; snowTex.repeat.set(16, 16);
    const snowMat = new T.MeshStandardMaterial({ map: snowTex, roughness: 0.9, color: 0xdfe8f4 });
    const ground = new T.Mesh(new T.PlaneGeometry(140, 140), snowMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; field.add(ground);
    const lineMat = new T.MeshBasicMaterial({ color: 0xc6d6ea, transparent: true, opacity: 0.6 });
    const mid = new T.Mesh(new T.PlaneGeometry(0.08, AH * 2), lineMat); mid.rotation.x = -Math.PI / 2; mid.position.y = 0.01; field.add(mid);
    // snowbanks around the field (instanced lumps), pines beyond
    const lumpMat = new T.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.85 });
    const spots = [];
    for (let x = -AW - 0.5; x <= AW + 0.5; x += 1.3) spots.push([x, -AH - 0.7], [x, AH + 0.7]);
    for (let y = -AH + 0.6; y <= AH - 0.6; y += 1.3) spots.push([-AW - 0.7, y], [AW + 0.7, y]);
    const lumps = new T.InstancedMesh(new T.SphereGeometry(1, 10, 6), lumpMat, spots.length), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
    spots.forEach(([x, y], k) => {
      ps.set(x, 0, y); sc.set(0.9 + Math.random() * 0.4, 0.45 + Math.random() * 0.25, 0.9 + Math.random() * 0.4);
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.random() * 6); lumps.setMatrixAt(k, m4.compose(ps, q, sc));
    });
    lumps.castShadow = !low; lumps.receiveShadow = true; field.add(lumps);
    {
      const n = low ? 24 : 48, pine = new T.InstancedMesh(new T.ConeGeometry(1, 2.6, 7), new T.MeshStandardMaterial({ color: 0x2f5d48, roughness: 0.8 }), n);
      const caps = new T.InstancedMesh(new T.ConeGeometry(0.62, 1.2, 7), lumpMat, n);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.283 + Math.random() * 0.1, r = 1 + Math.random() * 0.35;
        const x = Math.cos(a) * (AW + 4) * r, y = Math.sin(a) * (AH + 4) * r, s = 0.8 + Math.random() * 0.8;
        ps.set(x, 1.3 * s, y); sc.set(s, s, s); q.identity(); pine.setMatrixAt(k, m4.compose(ps, q, sc));
        ps.set(x, 2.35 * s, y); caps.setMatrixAt(k, m4.compose(ps, q, sc));
      }
      pine.castShadow = !low; field.add(pine, caps);
    }
    // forts: a wall of snow bricks with a crenellated top; they shrink as they take hits
    const fortMat = new T.MeshStandardMaterial({ color: 0xeef5ff, roughness: 0.75 });
    const forts = v0.forts.map(([x, y, horiz]) => {
      const g = new T.Group(); g.position.set(x, 0, y); g.rotation.y = horiz ? 0 : Math.PI / 2;
      const wall = new T.Mesh(new T.BoxGeometry(v0.fortLen, 1, v0.fortThick), fortMat);
      wall.position.y = 0.5; wall.castShadow = !low; wall.receiveShadow = true; g.add(wall);
      for (let k = 0; k < 4; k++) {
        const c = new T.Mesh(new T.BoxGeometry(0.34, 0.26, v0.fortThick * 1.05), fortMat);
        c.position.set(-v0.fortLen / 2 + 0.25 + k * (v0.fortLen - 0.5) / 3, 1.13, 0); c.castShadow = !low; g.add(c);
      }
      const rubble = new T.Mesh(new T.SphereGeometry(1, 10, 6), lumpMat);
      rubble.scale.set(v0.fortLen / 2, 0.22, v0.fortThick); rubble.visible = false; g.add(rubble);
      field.add(g);
      return { g, rubble, h: 1 };
    });
    // fresh-snow patches: sparkly mounds that shrink as giants are rolled from them
    const patchMat = new T.MeshStandardMaterial({ color: 0xf7fcff, emissive: 0x7fc4ff, emissiveIntensity: 0.35, roughness: 0.3 });
    const patchEdge = new T.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.7, depthWrite: false });
    const patches = v0.patches.map(([x, y]) => {
      const m = new T.Mesh(new T.SphereGeometry(v0.patchR, 20, 8, 0, 6.283, 0, Math.PI / 2), patchMat);
      m.position.set(x, 0, y); m.receiveShadow = true; m.visible = v0.giants; field.add(m);
      const edge = new T.Mesh(new T.RingGeometry(0.9, 1, 40), patchEdge); edge.rotation.x = -Math.PI / 2; edge.position.set(x, 0.02, y);
      edge.scale.setScalar(v0.patchR); edge.visible = v0.giants; field.add(edge);
      m.userData.edge = edge;
      return m;
    });
    // the kids: a coat in the player's colour, a head, a white bobble hat and scarf, a ring under your own
    const skin = new T.MeshStandardMaterial({ color: 0xf1c7a3, roughness: 0.7 });
    const white = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const iceMat = new T.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.1, emissive: 0x245a7a, emissiveIntensity: 0.3 });
    const pipOn = new T.MeshBasicMaterial({ color: 0x3a8dff }), pipOff = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const shadowMat = new T.MeshBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.22, depthWrite: false });
    const discGeo = new T.CircleGeometry(1, 24), KID = 1.25;   // drawn a bit bigger than the body, to read on a phone
    const kids = [];
    function ensureKids() {
      while (kids.length < snap.k.length) {
        const i = kids.length, col = colorOf(i);
        const g = new T.Group(), body = new T.Group(); g.add(body);
        const coat = new T.MeshStandardMaterial({ color: col, roughness: 0.6 });
        const torso = new T.Mesh(new T.CylinderGeometry(0.26, 0.36, 0.7, 14), coat); torso.position.y = 0.55; torso.castShadow = !low;
        const legs = new T.Mesh(new T.CylinderGeometry(0.22, 0.24, 0.25, 12), new T.MeshStandardMaterial({ color: 0x2a3550 })); legs.position.y = 0.13;
        const head = new T.Mesh(new T.SphereGeometry(0.24, 16, 12), skin); head.position.y = 1.08; head.castShadow = !low;
        const hat = new T.Mesh(new T.SphereGeometry(0.25, 14, 8, 0, 6.283, 0, Math.PI / 2), coat); hat.position.y = 1.13;
        const bob = new T.Mesh(new T.SphereGeometry(0.09, 10, 8), white); bob.position.y = 1.4;
        const scarf = new T.Mesh(new T.TorusGeometry(0.22, 0.06, 6, 16), white); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.88;
        const eyes = new T.Group();
        for (const s of [-1, 1]) { const e = new T.Mesh(new T.SphereGeometry(0.035, 6, 6), new T.MeshBasicMaterial({ color: 0x1a1a2a })); e.position.set(s * 0.08, 1.1, 0.21); eyes.add(e); }
        const arm = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.5, 8), coat); arm.position.set(0.3, 0.75, 0.12); arm.rotation.x = 0.9;
        const ball = new T.Mesh(new T.SphereGeometry(0.13, 10, 8), white); ball.position.set(0.3, 0.95, 0.35); ball.visible = false;
        body.add(torso, legs, head, hat, bob, scarf, eyes, arm, ball);
        const giant = new T.Mesh(new T.SphereGeometry(1, 16, 12), snowMat); giant.castShadow = !low; giant.visible = false; g.add(giant);
        const ice = new T.Mesh(new T.BoxGeometry(0.95, 1.6, 0.95), iceMat); ice.position.y = 0.8; ice.visible = false; g.add(ice);
        const pips = [];
        for (let k = 0; k < v0.pips; k++) { const p = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), pipOff); p.position.set((k - (v0.pips - 1) / 2) * 0.24, 2.1, 0); pips.push(p); }
        const pipBox = new T.Group(); pips.forEach((p) => pipBox.add(p)); field.add(pipBox);
        const shadow = new T.Mesh(discGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.scale.setScalar(0.42); field.add(shadow);
        let ring = null, arrow = null;
        if (i === me()) {   // you: a gold ring underfoot and an arrow bobbing over your head
          ring = new T.Mesh(new T.RingGeometry(0.62, 0.8, 32), new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; field.add(ring);
          arrow = new T.Mesh(new T.ConeGeometry(0.18, 0.34, 4), new T.MeshBasicMaterial({ color: 0xffc83d }));
          arrow.rotation.x = Math.PI; g.add(arrow);
        }
        field.add(g);
        g.scale.setScalar(KID); shadow.scale.setScalar(0.42 * KID);
        kids.push({ g, body, arm, ball, giant, ice, pips, pipBox, shadow, ring, arrow, col, last: null, roll: 0, step: 0, throwAt: 0 });
      }
    }
    // snowballs in flight, each with the shadow of where it will land (red when it's coming for you)
    const ballGeo = new T.SphereGeometry(1, 12, 8), balls = new Map();
    const landMat = new T.MeshBasicMaterial({ color: 0x223355, transparent: true, opacity: 0.3, depthWrite: false });
    const dangerMat = new T.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.4, depthWrite: false });
    function syncBalls(now) {
      const seen = new Set();
      for (const b of snap.b) {
        seen.add(b[8]);
        let o = balls.get(b[8]);
        if (!o) {
          const m = new T.Mesh(ballGeo, white); m.scale.setScalar(b[6] ? 0.22 : 0.13); m.castShadow = !low;
          const sh = new T.Mesh(discGeo, landMat); sh.rotation.x = -Math.PI / 2; sh.position.set(b[2], 0.02, b[3]);
          field.add(m, sh); o = { m, sh }; balls.set(b[8], o);
        }
        const p = ballAt(b, now), r = V().splash[b[6] ? 1 : 0];
        o.m.position.set(p.x, p.h, p.y);
        o.sh.material = nearMe(b, now) ? dangerMat : landMat;
        o.sh.scale.setScalar(r * (0.35 + 0.65 * p.f));
      }
      for (const [id, o] of balls) if (!seen.has(id)) { field.remove(o.m, o.sh); balls.delete(id); }
    }
    // puffs of snow: one shared particle pool
    const NP = 360, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    let pNext = 0;
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const puffs = new T.Points(pGeo, new T.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    puffs.frustumCulled = false; field.add(puffs);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -999;
    const tmpC = new T.Color();
    function burst(x, y, z, n, colors, speed = 3) {
      if (calm()) n = Math.ceil(n / 3);
      for (let k = 0; k < n; k++) {
        const j = pNext; pNext = (pNext + 1) % NP;
        pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z;
        const a = Math.random() * 6.283, s = speed * (0.3 + Math.random());
        pVel[j * 3] = Math.cos(a) * s; pVel[j * 3 + 1] = (0.5 + Math.random()) * speed; pVel[j * 3 + 2] = Math.sin(a) * s;
        tmpC.set(colors[k % colors.length]); pCol[j * 3] = tmpC.r; pCol[j * 3 + 1] = tmpC.g; pCol[j * 3 + 2] = tmpC.b;
        pLife[j] = 0.5 + Math.random() * 0.5;
      }
    }
    function tickPuffs(dt) {
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt;
        if (pLife[j] <= 0 || pPos[j * 3 + 1] < 0) { pLife[j] = 0; pPos[j * 3 + 1] = -999; continue; }
        pVel[j * 3 + 1] -= 9 * dt;
        pVel[j * 3] *= 0.96; pVel[j * 3 + 2] *= 0.96;
        pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }
    // falling snow, and footprints (not on 🎨 Low)
    let flakes = null, fGeo = null;
    if (!low) {
      const n = 380, fp = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { fp[k * 3] = (Math.random() - 0.5) * (AW * 2 + 8); fp[k * 3 + 1] = Math.random() * 14; fp[k * 3 + 2] = (Math.random() - 0.5) * (AH * 2 + 8); }
      fGeo = new T.BufferGeometry(); fGeo.setAttribute('position', new T.BufferAttribute(fp, 3));
      flakes = new T.Points(fGeo, new T.PointsMaterial({ size: 0.09, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
      flakes.frustumCulled = false; field.add(flakes);
    }
    const NF = low ? 0 : 180;
    const prints = NF ? new T.InstancedMesh(new T.CircleGeometry(0.09, 8), new T.MeshBasicMaterial({ color: 0xaebfd6, transparent: true, opacity: 0.7, depthWrite: false }), NF) : null;
    const printAge = new Float32Array(NF), printAt = [];
    let printNext = 0;
    if (prints) {
      for (let k = 0; k < NF; k++) { printAge[k] = 99; printAt.push([0, 0, 0]); prints.setMatrixAt(k, m4.makeScale(0, 0, 0)); }
      prints.frustumCulled = false; field.add(prints);
    }
    const flatQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    function footprint(x, y, fx, fy, side) {
      if (!prints) return;
      const k = printNext; printNext = (printNext + 1) % NF;
      printAt[k] = [x - fy * 0.12 * side, y + fx * 0.12 * side, Math.atan2(fx, fy)]; printAge[k] = 0;
    }
    function tickPrints(dt) {
      if (!prints) return;
      for (let k = 0; k < NF; k++) {
        if (printAge[k] > 8) continue;
        printAge[k] += dt;
        const s = Math.max(0, 1 - printAge[k] / 8);
        ps.set(printAt[k][0], 0.012, printAt[k][1]); sc.set(s, s * 1.5, s);
        q.setFromAxisAngle(new T.Vector3(0, 1, 0), printAt[k][2]).multiply(flatQ);
        prints.setMatrixAt(k, m4.compose(ps, q, sc));
      }
      prints.instanceMatrix.needsUpdate = true;
    }

    let aspect = 1, lastDraw = 0;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h;
      camera.updateProjectionMatrix();
      rot = aspect < 0.95;
      field.rotation.y = rot ? Math.PI / 2 : 0;
    }
    function place() {
      // the whole field in view whatever the screen shape (turned a quarter on a portrait screen): every rival stays on screen
      const hw = (rot ? AH : AW) + 1.6, hd = (rot ? AW : AH) + 1.6, tv = Math.tan((camera.fov * Math.PI) / 360);
      const d = Math.max(hw / (tv * aspect), (hd * 1.1) / tv);
      camera.position.set(0, d * 0.86, d * 0.52); camera.lookAt(0, 0, 0.4);
    }
    function draw(now) {
      ensureKids();
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      place(); GL3.tickShake(camera, dt);
      const v = V(), st = snap.st;
      // forts and patches
      snap.f.forEach((hp, fi) => {
        const f = forts[fi], want = hp > 0 ? 0.35 + 0.65 * hp / v.fortHp : 0;
        f.h += (want - f.h) * Math.min(1, dt * 8);
        f.g.children.forEach((c) => { if (c !== f.rubble) c.visible = f.h > 0.05; });
        f.g.scale.y = Math.max(0.05, f.h); f.rubble.visible = hp <= 0; f.rubble.scale.y = 0.22 / Math.max(0.05, f.h);
      });
      snap.p.forEach((pv, pi) => { patches[pi].scale.set(0.4 + 0.6 * pv, 0.04 + 0.12 * pv, 0.4 + 0.6 * pv); patches[pi].userData.edge.scale.setScalar(v.patchR * (0.4 + 0.6 * pv)); });
      patchMat.emissiveIntensity = 0.3 + 0.15 * Math.sin(now / 300); patchEdge.opacity = 0.45 + 0.3 * Math.sin(now / 300);
      snap.k.forEach((k, i) => {
        const o = kids[i]; if (!o) return;
        const p = ctx.player(v.seats[i]), here = !!p && !p.eliminated;
        o.g.visible = o.pipBox.visible = o.shadow.visible = here;
        if (o.ring) o.ring.visible = here;
        if (!here) return;
        const [x, y] = pos(i, now), frozen = k[8] > 0, knocked = k[9] > 0, packing = k[10] || (i === me() && packAt);
        o.g.position.set(x, 0, y);
        const face = Math.atan2(k[4], k[5]);
        let dr = face - o.g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        o.g.rotation.y += dr * Math.min(1, dt * 14);
        const speed = Math.hypot(k[2], k[3]);
        // a waddle while running, flat on the back when knocked, crouched while packing
        o.step += dt * speed * 3.2;
        o.body.rotation.z = knocked ? 0 : Math.sin(o.step) * Math.min(0.15, speed * 0.04);
        o.body.rotation.x += ((knocked ? -1.45 : packing ? 0.35 : 0) - o.body.rotation.x) * Math.min(1, dt * 12);
        o.body.position.y = knocked ? 0.3 : Math.abs(Math.sin(o.step)) * Math.min(0.08, speed * 0.02);
        o.ball.visible = !!packing;
        if (packing) o.ball.scale.setScalar(i === me() && packAt ? 1 + Math.min(1, (now - packAt) / 1000 / v.bigHold) * 0.7 : 1.3);
        o.arm.rotation.x = now - o.throwAt < 220 ? -1.6 + (now - o.throwAt) / 220 * 2.5 : 0.9;
        o.ice.visible = frozen;
        if (frozen) o.ice.rotation.y = Math.sin(now / 900 + i) * 0.1;
        // ⛄ the giant rolls ahead of you
        o.giant.visible = k[11] > 0.04;
        if (o.giant.visible) {
          const r = v.giantR * k[11];
          o.giant.scale.setScalar(r / KID); o.giant.position.set(0, r / KID, (v.body + r) / KID);   // the kid is drawn KID× bigger
          o.roll += dt * speed / Math.max(0.1, r); o.giant.rotation.x = o.roll;
        }
        o.pipBox.position.set(x, 0, y);
        o.pipBox.quaternion.copy(camera.quaternion).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -field.rotation.y));
        o.pipBox.position.y = knocked ? -0.9 : 0;
        o.pips.forEach((m, n) => { m.material = n < k[7] ? pipOn : pipOff; });
        o.pipBox.visible = !frozen;
        o.shadow.position.set(x, 0.015, y);
        if (o.ring) { o.ring.position.set(x, 0.02, y); o.ring.material.opacity = 0.55 + 0.3 * Math.sin(now / 250); }
        if (o.arrow) { o.arrow.visible = !knocked; o.arrow.position.y = 2.15 + 0.12 * Math.sin(now / 220); o.arrow.rotation.y += dt * 2; }
        // footprints every half step
        if (st === 'play' && speed > 0.8 && o.last && Math.hypot(x - o.last[0], y - o.last[1]) > 0.42) {
          o.side = -(o.side || 1); footprint(x, y, k[4], k[5], o.side); o.last = [x, y];
        } else if (!o.last) o.last = [x, y];
        if (st === 'play' && speed > 2 && !calm() && Math.random() < dt * 6) burst(x, 0.05, y, 1, ['#ffffff'], 0.8);
      });
      syncBalls(now);
      if (flakes) {
        const a = fGeo.attributes.position.array;
        for (let k = 0; k < a.length; k += 3) {
          a[k + 1] -= dt * (0.7 + (k % 7) * 0.08); a[k] += Math.sin(now / 1500 + k) * dt * 0.2;
          if (a[k + 1] < 0) a[k + 1] += 14;
        }
        fGeo.attributes.position.needsUpdate = true;
      }
      tickPuffs(dt); tickPrints(dt);
      renderer.render(scene, camera);
    }
    function puff(x, y, n, col) { burst(x, 0.25, y, n, col ? ['#ffffff', '#e8f1ff', col] : ['#ffffff', '#e8f1ff'], 2.6); }
    function crumble(fi) {
      const [x, y, horiz] = V().forts[fi], L = V().fortLen;
      for (let k = 0; k < 5; k++) { const t = (k / 4 - 0.5) * L; burst(x + (horiz ? t : 0), 0.6, y + (horiz ? 0 : t), 10, ['#ffffff', '#dfe9f5'], 3.5); }
      shake(0.2);
    }
    function sparkle(fi) { const [x, y] = V().forts[fi]; burst(x, 1.2, y, 14, ['#bfeaff', '#ffffff'], 1.5); }
    function freeze(j) { const [x, y] = pos(j, performance.now()); burst(x, 1, y, 28, ['#bfeaff', '#ffffff', '#7fd0ff'], 3); }
    function windup(i) { if (kids[i]) kids[i].throwAt = performance.now(); }
    const shake = (a) => GL3.shake(camera, a);
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose, shake, puff, crumble, sparkle, freeze, windup };
  }

  // ---------- flat fallback (no WebGL): a top-down field
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    rot = false;
    const puffs = [];
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), v = V(); if (!v) return;
      const w = stage.clientWidth || 320, h = stage.clientHeight || 240, k = Math.min(w / (2 * v.aw + 1), h / (2 * v.ah + 1));
      canvas.style.width = `${k * (2 * v.aw + 1)}px`; canvas.style.height = `${k * (2 * v.ah + 1)}px`;
      canvas.width = Math.round(k * (2 * v.aw + 1) * dpr); canvas.height = Math.round(k * (2 * v.ah + 1) * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      const v = V(), W = canvas.width, H = canvas.height, k = W / (2 * v.aw + 1), X = (x) => W / 2 + x * k, Y = (y) => H / 2 + y * k;
      g.fillStyle = '#f2f7ff'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#c6d6ea'; g.lineWidth = 0.1 * k; g.strokeRect(X(-v.aw), Y(-v.ah), 2 * v.aw * k, 2 * v.ah * k);
      if (v.giants) snap.p.forEach((pv, pi) => {
        g.fillStyle = `rgba(150,205,255,${0.15 + 0.35 * pv})`; g.beginPath(); g.arc(X(v.patches[pi][0]), Y(v.patches[pi][1]), v.patchR * k * (0.4 + 0.6 * pv), 0, 7); g.fill();
      });
      v.forts.forEach(([x, y, horiz], fi) => {
        const hp = snap.f[fi], w = (horiz ? v.fortLen : v.fortThick) * k, h = (horiz ? v.fortThick : v.fortLen) * k;
        g.fillStyle = hp > 0 ? `rgba(120,150,190,${0.35 + 0.65 * hp / v.fortHp})` : 'rgba(120,150,190,0.15)';
        g.fillRect(X(x) - w / 2, Y(y) - h / 2, w, h);
      });
      for (const b of snap.b) {
        const p = ballAt(b, now);
        g.fillStyle = nearMe(b, now) ? 'rgba(255,50,80,0.35)' : 'rgba(30,50,90,0.2)';
        g.beginPath(); g.arc(X(b[2]), Y(b[3]), v.splash[b[6] ? 1 : 0] * k * (0.35 + 0.65 * p.f), 0, 7); g.fill();
        g.fillStyle = '#fff'; g.strokeStyle = '#7890b0'; g.lineWidth = 0.04 * k;
        g.beginPath(); g.arc(X(p.x), Y(p.y) - p.h * k * 0.5, (b[6] ? 0.22 : 0.13) * k * (1 + p.h * 0.15), 0, 7); g.fill(); g.stroke();
      }
      snap.k.forEach((s, i) => {
        const p = ctx.player(v.seats[i]); if (!p || p.eliminated) return;
        const [x, y] = pos(i, now), r = v.body * k;
        if (s[11] > 0.04) { g.fillStyle = '#fff'; g.strokeStyle = '#9ab'; g.beginPath(); g.arc(X(x + s[4] * (v.body + v.giantR * s[11])), Y(y + s[5] * (v.body + v.giantR * s[11])), v.giantR * s[11] * k, 0, 7); g.fill(); g.stroke(); }
        g.fillStyle = colorOf(i); g.strokeStyle = i === v.me ? '#000' : '#0006'; g.lineWidth = r * 0.25;
        g.beginPath(); g.arc(X(x), Y(y), r, 0, 7); g.fill(); g.stroke();
        g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(x + s[4] * v.body), Y(y + s[5] * v.body)); g.stroke();
        if (s[8] > 0) { g.fillStyle = 'rgba(160,220,255,0.6)'; g.fillRect(X(x) - r * 1.2, Y(y) - r * 1.2, r * 2.4, r * 2.4); }
        g.fillStyle = '#3a8dff';
        for (let n = 0; n < s[7]; n++) { g.beginPath(); g.arc(X(x) + (n - 1) * r * 0.6, Y(y) - r * 1.6, r * 0.2, 0, 7); g.fill(); }
      });
      for (let j = puffs.length - 1; j >= 0; j--) {
        const p = puffs[j], t = (now - p.at) / 500;
        if (t >= 1) { puffs.splice(j, 1); continue; }
        g.globalAlpha = 1 - t; g.strokeStyle = p.col; g.lineWidth = 0.12 * k;
        g.beginPath(); g.arc(X(p.x), Y(p.y), p.size * k * Math.sqrt(t) + 1, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    const puff = (x, y, n, col) => puffs.push({ x, y, size: 0.4 + n * 0.03, col: col || '#8aa4c8', at: performance.now() });
    resize();
    return { draw, resize, dispose() {}, puff };
  }

  const turnText = (s) => (s.phase === 'playing' ? '❄️ Snowball fight — most snow-ins wins' : null);
  const myMove = (s) => s.phase === 'playing' && s.snowball.st === 'play' && s.snowball.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
