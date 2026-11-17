// Coin Cascade: one shared coin-pusher machine. The server simulates each drop (games/pusher.py) and sends its motion
// once over the fast channel (`frames`: coin positions 10 times a second); this module plays it back (the shelf, the
// handful falling from the chute, the pile shoving, coins tipping over the edge into the trays) and then settles on
// the view's pile. Between turns the shelf keeps stroking (it never reaches past the pile: each drop ends with it all
// the way out). On your turn: drag on the machine (or the slider) to move the chute, and drop on the shelf's beat.
UI.pusher = (() => {
  let S, ctx, V = null, gl = null, flat = null, raf = 0, ro = null, keyDown = null;
  let disp = new Map(), anim = null, lastShot = 0, framesBy = {}, pend = null, idle = { phase: 0.5, at: 0 }, aim = 0, dragX = null;
  let shown = [], fallers = [], pops = [];
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');
  const TAU = Math.PI * 2;

  function mount(main, side) {
    V = null; gl = null; flat = null; disp = new Map(); anim = null; lastShot = 0; framesBy = {}; pend = null; idle = { phase: 0.5, at: performance.now() }; aim = 0; shown = []; fallers = []; pops = [];
    main.innerHTML = `<div class="cc"><div class="cc-stage" id="ccStage">
        <div class="cc-hud"><span id="ccTurn"></span><span id="ccLeft"></span></div>
        <div class="cc-pop" id="ccPop" hidden></div>
      </div>
      <div class="cc-ctl" id="ccCtl">
        <input type="range" id="ccAim" min="-100" max="100" value="0" aria-label="Chute">
        <button id="ccDrop" class="primary">🪙 Drop</button>
      </div>
      <p id="ccHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🪙 Trays</h3><div id="ccRace"></div><p class="hint left">Drag across the machine (or the slider, or ← →) to move the chute; tap 🪙 Drop (or Space). Coins dropped while the shelf is back get the full shove.</p></div>';
    const stage = $('ccStage');
    stage.style.touchAction = 'none';
    $('ccAim').addEventListener('input', (e) => { aim = e.target.value / 100; });
    $('ccDrop').addEventListener('click', drop);
    stage.addEventListener('pointerdown', (e) => { if (!canDrop()) return; dragX = { x: e.clientX, a: aim, w: stage.clientWidth }; try { stage.setPointerCapture(e.pointerId); } catch {} });
    stage.addEventListener('pointermove', (e) => { if (!dragX) return; aim = Math.max(-1, Math.min(1, dragX.a + (e.clientX - dragX.x) / (dragX.w * 0.4))); $('ccAim').value = Math.round(aim * 100); });
    const up = () => { dragX = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { aim = Math.max(-1, aim - 0.05); $('ccAim').value = Math.round(aim * 100); e.preventDefault(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { aim = Math.min(1, aim + 0.05); $('ccAim').value = Math.round(aim * 100); e.preventDefault(); }
      else if (e.code === 'Space' && !e.repeat) { e.preventDefault(); drop(); }
    };
    addEventListener('keydown', keyDown);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const revive = { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } };
    GL3.load().then(() => { if (stage.isConnected && !gl && V) GL3.revive(stage, revive); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown);
    gl?.dispose(); gl = null; flat = null;
  }

  const G = () => V.geo;
  const me = () => V?.me;
  const colorOf = (i) => ctx.player(V.seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V.seats[i])?.name ?? '?';
  const faceAt = (ph) => G().face[0] + (G().face[1] - G().face[0]) * (0.5 - 0.5 * Math.cos(TAU * ph));
  const ownerOf = (x) => Math.max(0, Math.min(V.seats.length - 1, Math.floor((x + G().hw) / (2 * G().hw / V.seats.length))));
  const myTurn = () => S?.phase === 'playing' && V?.me != null && S.turn === V.seats[V.me];
  const canDrop = () => myTurn() && !anim && !pend && V.left[V.me] > 0;
  function shelfPhase(now) {
    if (anim) return anim.phase + Math.min(anim.dur, (now - anim.t0) / 1000) / G().period;
    return idle.phase + (now - idle.at) / 1000 / G().period;
  }

  function drop() {
    if (!canDrop()) return;
    const ph = ((shelfPhase(performance.now()) % 1) + 1) % 1;
    ctx.act('drop', { x: +aim.toFixed(3), phase: +ph.toFixed(4) }).catch((e) => ctx.toast?.(e?.message || 'Could not drop.'));
    ctx.buzz?.(15);
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c;
    const first = !V;
    V = s.pusher;
    if (first) { snap(); lastShot = V.shot?.no ?? 0; shown = V.points.slice(); }
    const no = V.shot?.no ?? 0;
    if (no > lastShot && !anim) { lastShot = no; pend = { no, at: performance.now(), shot: V.shot, coins: V.coins, points: V.points.slice() }; }
    if (!anim && !pend) { snap(); shown = V.points.slice(); }
    if (!gl && !flat && $('ccStage') && window.THREE) GL3.revive($('ccStage'), { build: () => (gl = make3d($('ccStage'))), flat: () => { flat ||= make2d($('ccStage')); }, unflat: () => { flat?.dispose?.(); flat = null; } });
    renderSide();
  }
  function fast(d) { if (d.shot) { framesBy = { [d.shot]: d.frames }; } }
  function snap(coins = V.coins) {
    disp = new Map(coins.map(([id, x, y, r, k]) => [id, { x, y, r, k, tx: x, ty: y, h: 0 }]));
  }
  // start playing a drop back once its frames are here (or settle straight away if they never came)
  function startAnim(now) {
    if (!pend) return;
    const fr = framesBy[pend.no];
    if (!fr && now - pend.at < 700) return;
    const sh = pend.shot;
    if (!fr) { snap(pend.coins); shown = pend.points; pend = null; idle = { phase: 0.5, at: now }; return; }
    anim = { no: pend.no, t0: now, dur: sh.dur, phase: sh.phase, frames: fr, fi: 0, adds: sh.adds.map((a) => ({ t: a[0], x: a[1], r: a[2], k: a[3], id: a[4], on: false })),
      falls: sh.falls.map((f) => ({ id: f[0], k: f[1], x: f[2], own: f[3], t: f[4], done: false })), end: { coins: pend.coins, points: pend.points }, by: sh.by, bonus: sh.bonus, gain: sh.gain };
    shown = pend.points.map((p, i) => p - (sh.gain[i] || 0));
    pend = null;
    if (sh.bonus) setTimeout(() => { SN.bell(); popText(`🔔 ${({ guard: '🧱 Side guards!', shake: '🫨 Shake!', mega: '🪙 Mega coin next turn!' })[sh.bonus]}`); }, 500);
  }
  function stepAnim(now, dt) {
    if (!anim) return;
    const t = (now - anim.t0) / 1000, g = G();
    for (const a of anim.adds) {
      if (!a.on && t >= a.t - 0.35) {
        a.on = true;
        const y = faceAt(anim.phase + a.t / g.period) + a.r + 0.02;
        disp.set(a.id, { x: a.x, y, r: a.r, k: a.k, tx: a.x, ty: y, h: 3, drop: a.t });
      }
    }
    while (anim.fi < anim.frames.length && anim.frames[anim.fi][0] <= t) {
      for (const [id, x, y] of anim.frames[anim.fi][1]) { const c = disp.get(id); if (c) { c.tx = x; c.ty = y; } }
      anim.fi++;
    }
    for (const f of anim.falls) {
      if (!f.done && t >= f.t) {
        f.done = true;
        const c = disp.get(f.id);
        disp.delete(f.id);
        fallers.push({ x: c ? c.x : f.x, y: c ? c.y : g.edge, r: c ? c.r : g.r, k: f.k, own: f.own, at: now });
        if (f.own >= 0) {
          shown[f.own] = (shown[f.own] || 0) + (f.k === 1 ? 3 : 1);
          if (f.own === me()) SN.tray(f.k === 1); else SN.clink(0.4);
          if (f.k === 1) popText(`⭐ +3 ${f.own === me() ? 'for you!' : nameOf(f.own)}`);
        } else SN.gutter();
      }
    }
    for (const c of disp.values()) {
      if (c.h > 0) {
        const left = (c.drop ?? 0) - t;
        c.h = Math.max(0, Math.min(3, left * 8.5));
        if (c.h === 0 && c.drop != null) { c.drop = null; SN.clink(1); (gl || flat)?.sparkle(c.x, c.y); }
      }
      const e = Math.min(1, dt * 14);
      c.x += (c.tx - c.x) * e; c.y += (c.ty - c.y) * e;
    }
    if (t >= anim.dur + 0.5) {
      const g2 = anim.gain || [];
      if (g2[me()] >= 5) { ctx.sfx?.('win'); popText(`🎰 +${g2[me()]}!`); }
      snap(anim.end.coins); shown = anim.end.points; anim = null; idle = { phase: 0.5, at: now };
      renderSide();
    }
  }

  function renderSide() {
    const box = $('ccRace'); if (!box || !V) return;
    box.innerHTML = '';
    const order = V.seats.map((_, i) => i).sort((a, b) => (shown[b] ?? 0) - (shown[a] ?? 0));
    for (const i of order) {
      const p = ctx.player(V.seats[i]), row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out') + (S.turn === V.seats[i] ? ' cc-now' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const extra = `${V.guard[i] > 0 ? ` 🧱${V.guard[i]}` : ''}${V.mega[i] ? ' 🪙' : ''}${V.stars[i] ? ` ⭐${V.stars[i]}` : ''}`;
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === V.me ? ' (you)' : ''}${extra}`), ctx.el('span', 'cc-left', `${V.left[i]} left`), ctx.el('b', '', `${shown[i] ?? 0}`));
      box.append(row);
    }
    const t = V.seats.indexOf(S.turn);
    $('ccTurn').textContent = S.phase !== 'playing' ? '' : t < 0 ? '🪙 Settling…' : t === V.me ? '🪙 Your drop!' : `🪙 ${nameOf(t)}'s drop`;
    $('ccLeft').textContent = V.me != null ? `${V.left[V.me]} handful${V.left[V.me] === 1 ? '' : 's'} left` : '';
    $('ccCtl').hidden = V.me == null;
    $('ccDrop').disabled = !canDrop();
    $('ccDrop').classList.toggle('cc-ready', canDrop());
    $('ccHint').textContent = !myTurn() ? '' : V.mega[V.me] ? 'Your handful has a 🪙 mega coin in it!' : V.guard[V.me] ? `🧱 Side guards up (${V.guard[V.me]} drops).` : 'Drop while the shelf is back for the big shove. 🔔 bells give bonuses.';
  }

  function popText(text) {
    const el = $('ccPop'); if (!el) return;
    el.textContent = text; el.hidden = false; el.className = 'cc-pop cc-pop-in'; void el.offsetWidth;
    clearTimeout(popText.t); popText.t = setTimeout(() => { el.hidden = true; }, 1700);
  }

  // ---------- sound: coins on metal, in a small arcade
  const snd = (fn) => window.Snd?.play((t, K) => fn(t, K, K.at({ room: 'room', send: 0.6 })));
  const SN = {
    clink: (v = 1) => snd((t, K, d) => { [3100, 4700, 6900].forEach((f, n) => K.mode(d, t, f * K.R(0.97, 1.03), (0.05 - n * 0.012) * v, 0.04 + n * 0.01)); K.burst(d, t, { type: 'highpass', f: 5000, q: 0.7, vol: 0.05 * v, tau: 0.004 }); }),
    tray: (star) => snd((t, K, d) => {
      for (let n = 0; n < 3; n++) [2600, 3900, 5600].forEach((f, m) => K.mode(d, t + n * 0.05, f * K.R(0.95, 1.05), 0.05 - m * 0.012, 0.05));
      if (star) [784, 1047, 1319].forEach((f, n) => K.mode(d, t + 0.1 + n * 0.07, f, 0.07, 0.2));
    }),
    gutter: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 1500, f1: 400, q: 1, vol: 0.06, tau: 0.08, dur: 0.3 }); }),
    bell: () => snd((t, K, d) => { [1175, 2350, 3520].forEach((f, n) => K.mode(d, t, f, 0.1 - n * 0.025, 0.5)); }),
  };

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const dt = Math.min(0.1, (now - (loop.last || now)) / 1000); loop.last = now;
    startAnim(now);
    stepAnim(now, dt);
    (gl || flat)?.draw(now, dt);
    if (now - (loop.side || 0) > 300) { loop.side = now; renderSide(); }
  }

  // ---------- three.js machine
  function canvasTex(T, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) draw(g, w, h);
    return new T.CanvasTexture(c);
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const g0 = G(), HW = g0.hw, EDGE = g0.edge;
    const scene = new T.Scene();
    scene.background = new T.Color(0x150a22);
    const camera = new T.PerspectiveCamera(42, 1, 0.3, 120);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.1, hemi: [0xffe9d0, 0x2a1030, 0.6],
      key: { i: 1.0, color: 0xfff1dc, pos: [3, 12, 9], area: 7, near: 2, far: 30 },
      env: { accent: 0xff4fa0, walls: 0x2a1030, lamp: 0xfff4e6, glow: 2.8 },
    });
    const low = stg.low;
    const glow = new T.PointLight(0xffb86b, 0.3, 18); glow.position.set(0, 6, 2); scene.add(glow);
    // the cabinet
    const red = new T.MeshStandardMaterial({ color: 0x8c1d40, roughness: 0.45, metalness: 0.2 });
    const chrome = new T.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.18 });
    const base = new T.Mesh(new T.BoxGeometry(2 * HW + 1.6, 3, EDGE + 4), red); base.position.set(0, -1.5 - 0.02, EDGE / 2 - 1.5); base.receiveShadow = true; scene.add(base);
    // the playfield: brushed metal with a few painted lane stripes, the bells marked on it
    const field = canvasTex(T, 256, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#5a5f6b'); grd.addColorStop(1, '#8a909c'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(0, y, w, 1); }
    });
    const play = new T.Mesh(new T.PlaneGeometry(2 * HW, EDGE + 1.5), new T.MeshStandardMaterial({ map: field, metalness: 0.6, roughness: 0.4 }));
    play.rotation.x = -Math.PI / 2; play.position.set(0, 0, (EDGE - 1.5) / 2); play.receiveShadow = true; scene.add(play);
    // the front edge: a chrome lip, and the trays below in each player's colour
    const lip = new T.Mesh(new T.BoxGeometry(2 * HW + 0.2, 0.08, 0.12), chrome); lip.position.set(0, -0.02, EDGE + 0.04); scene.add(lip);
    const n = V.seats.length, trays = [];
    for (let i = 0; i < n; i++) {
      const w = (2 * HW) / n, x = -HW + w * (i + 0.5);
      const tray = new T.Mesh(new T.BoxGeometry(w - 0.08, 0.5, 1.0), new T.MeshStandardMaterial({ color: colorOf(i), roughness: 0.5, emissive: colorOf(i), emissiveIntensity: 0.15 }));
      tray.position.set(x, -1.0, EDGE + 0.55); scene.add(tray);
      const tex = canvasTex(T, 256, 96, () => {});
      const label = new T.Mesh(new T.PlaneGeometry(w - 0.1, (w - 0.1) * 0.375), new T.MeshBasicMaterial({ map: tex, transparent: true }));
      label.position.set(x, -0.6, EDGE + 1.07); scene.add(label);
      trays.push({ tray, tex, label, last: null });
    }
    function paintLabel(i) {
      const tr = trays[i], txt = `${i === me() ? '★ ' : ''}${nameOf(i)} · ${shown[i] ?? 0}`;
      if (tr.last === txt) return;
      tr.last = txt;
      const c = tr.tex.image, g = c.getContext('2d'); if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect?.(4, 8, c.width - 8, c.height - 16, 22); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let s = txt; while (g.measureText(s).width > c.width - 24 && s.length > 4) s = s.slice(0, -2) + '…';
      g.fillText(s, c.width / 2, c.height / 2 + 2); tr.tex.needsUpdate = true;
    }
    // glass side walls at the back, open near the front (the gutters), with chrome rails
    const glass = new T.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
    for (const s of [-1, 1]) {
      const wall = new T.Mesh(new T.BoxGeometry(0.06, 1.4, g0.gapY + 1.5), glass); wall.position.set(s * (HW + 0.03), 0.7, (g0.gapY - 1.5) / 2); scene.add(wall);
      const rail = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, g0.gapY + 1.5, 8), chrome); rail.rotation.x = Math.PI / 2; rail.position.set(s * (HW + 0.03), 1.42, (g0.gapY - 1.5) / 2); scene.add(rail);
      const gut = new T.Mesh(new T.BoxGeometry(0.5, 0.3, EDGE - g0.gapY), new T.MeshStandardMaterial({ color: 0x1a0a12, roughness: 0.9 })); gut.position.set(s * (HW + 0.3), -0.2, (EDGE + g0.gapY) / 2); scene.add(gut);
    }
    // guards (shown while the player whose drop it is has them up)
    const guards = [-1, 1].map((s) => { const m = new T.Mesh(new T.BoxGeometry(0.08, 0.5, EDGE - g0.gapY), new T.MeshStandardMaterial({ color: 0x7fd0ff, emissive: 0x3a86ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 })); m.position.set(s * (HW + 0.04), 0.25, (EDGE + g0.gapY) / 2); m.visible = false; scene.add(m); return m; });
    // the back wall: a marquee sign ringed with chasing bulbs
    const signTex = canvasTex(T, 512, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#ff4fa0'); grd.addColorStop(0.5, '#ffd23f'); grd.addColorStop(1, '#ff4fa0');
      g.fillStyle = '#2a0f30'; g.fillRect(0, 0, w, h); g.fillStyle = grd; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 60px sans-serif'; g.shadowColor = '#ff4fa0'; g.shadowBlur = 18; g.fillText('COIN CASCADE', w / 2, h / 2 + 4);
    });
    const back = new T.Mesh(new T.BoxGeometry(2 * HW + 1.6, 4.2, 0.3), red); back.position.set(0, 2.1, -2.0); scene.add(back);
    const sign = new T.Mesh(new T.PlaneGeometry(2 * HW, 1.6), new T.MeshBasicMaterial({ map: signTex })); sign.position.set(0, 3.0, -1.84); scene.add(sign);
    const NB = 44, bulbs = new T.InstancedMesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }), NB), m4 = new T.Matrix4(), bc = new T.Color();
    for (let k = 0; k < NB; k++) {
      const f = k / NB, per = 2 * (2 * HW) + 2 * 1.6; let d = f * per, x, y;
      if (d < 2 * HW) { x = -HW + d; y = 3.85; } else if ((d -= 2 * HW) < 1.6) { x = HW; y = 3.85 - d; } else if ((d -= 1.6) < 2 * HW) { x = HW - d; y = 2.25; } else { d -= 2 * HW; x = -HW; y = 2.25 + d; }
      m4.makeTranslation(x, y, -1.8); bulbs.setMatrixAt(k, m4); bulbs.setColorAt(k, bc.set(0xffd23f));
    }
    scene.add(bulbs);
    // the shelf: a chrome-edged block sliding in and out, its top heaped with coins for show
    const shelf = new T.Group(); scene.add(shelf);
    const shelfTop = new T.Mesh(new T.BoxGeometry(2 * HW - 0.02, 0.5, 3.2), new T.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.5, roughness: 0.4 }));
    shelfTop.position.set(0, 0.25, -1.6); shelfTop.castShadow = !low; shelfTop.receiveShadow = true; shelf.add(shelfTop);
    const faceBar = new T.Mesh(new T.BoxGeometry(2 * HW, 0.5, 0.08), chrome); faceBar.position.set(0, 0.25, -0.04); shelf.add(faceBar);
    // coins
    const coinGeo = new T.CylinderGeometry(1, 1, 0.07, 28);
    const gold = new T.MeshStandardMaterial({ color: 0xffcf5a, metalness: 0.7, roughness: 0.32, emissive: 0x3a2400, emissiveIntensity: 0.6 });
    const MAXC = 220, coins = new T.InstancedMesh(coinGeo, gold, MAXC); coins.castShadow = !low; coins.receiveShadow = true; coins.frustumCulled = false; scene.add(coins);
    const starTop = canvasTex(T, 128, 128, (g, w) => {
      g.fillStyle = '#e8e0ff'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill();
      g.fillStyle = '#ff4fa0'; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? w * 0.18 : w * 0.42; g.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r); }
      g.fill();
    });
    const starMats = [new T.MeshStandardMaterial({ color: 0xd9d2ff, metalness: 0.9, roughness: 0.25 }), new T.MeshStandardMaterial({ map: starTop, metalness: 0.4, roughness: 0.3 }), new T.MeshStandardMaterial({ color: 0xd9d2ff, metalness: 0.9, roughness: 0.25 })];
    const starMeshes = new Map();
    const decor = new T.InstancedMesh(coinGeo, gold, 26);
    for (let k = 0; k < 26; k++) { m4.compose(new T.Vector3((Math.random() - 0.5) * (2 * HW - 0.8), 0.54 + (k % 3) * 0.07, -0.4 - Math.random() * 2.6), new T.Quaternion().setFromEuler(new T.Euler((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)), new T.Vector3(0.3, 1, 0.3)); decor.setMatrixAt(k, m4); }
    shelf.add(decor);
    // the bells
    for (const [bx, by] of g0.bells) {
      const ring = new T.Mesh(new T.RingGeometry(g0.bellR * 0.75, g0.bellR, 32), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(bx, 0.006, by); scene.add(ring);
      const bell = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 64, 64, (g) => { g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔔', 32, 36); }), transparent: true, depthWrite: false }));
      bell.position.set(bx, 0.02, by); bell.scale.set(0.5, 0.5, 1); bell.center.set(0.5, 0); scene.add(bell);
    }
    // the chute: a carriage at the back that slides with your aim
    const chute = new T.Group(); scene.add(chute);
    const carriage = new T.Mesh(new T.BoxGeometry(0.9, 0.35, 0.5), chrome); carriage.position.y = 2.0; chute.add(carriage);
    const slot = new T.Mesh(new T.BoxGeometry(0.66, 0.06, 0.12), new T.MeshBasicMaterial({ color: 0x111111 })); slot.position.set(0, 2.18, 0); chute.add(slot);
    const guide = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 2, 6), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6 })); guide.position.y = 1.0; chute.add(guide);
    const rail = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 2 * HW, 8), chrome); rail.rotation.z = Math.PI / 2; rail.position.set(0, 2.2, 0.3); scene.add(rail);
    const aimDot = new T.Mesh(new T.RingGeometry(0.22, 0.3, 24), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false })); aimDot.rotation.x = -Math.PI / 2; scene.add(aimDot);
    // sparkles: one additive particle pool
    const NP = 220, pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    const pGeo = new T.BufferGeometry(); pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    const parts = new T.Points(pGeo, new T.PointsMaterial({ size: 0.07, color: 0xfff1b0, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    parts.frustumCulled = false; scene.add(parts);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -99;
    let pNext = 0;
    function sparkle(x, y, nn = 6) {
      if (calm()) nn = 2;
      for (let k = 0; k < nn; k++) { const j = pNext; pNext = (pNext + 1) % NP; pPos[j * 3] = x; pPos[j * 3 + 1] = 0.1; pPos[j * 3 + 2] = y; const a = Math.random() * TAU; pVel[j * 3] = Math.cos(a) * 1.2; pVel[j * 3 + 1] = 1 + Math.random() * 1.5; pVel[j * 3 + 2] = Math.sin(a) * 1.2; pLife[j] = 0.4 + Math.random() * 0.3; }
    }

    let aspect = 1;
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = aspect = w / h; camera.updateProjectionMatrix();
    }
    function place() {
      // standing at the machine: the whole playfield and the trays in view whatever the screen shape
      const tv = Math.tan((camera.fov * Math.PI) / 360), hw = HW + 0.9;
      const d = Math.max(hw / (tv * aspect), 5.2 / tv) * 1.0;
      camera.position.set(0, d * 0.78, EDGE * 0.5 + d * 0.66); camera.lookAt(0, -0.2, EDGE * 0.42);
    }
    const q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), tilt = new T.Euler();
    function draw(now, dt) {
      place();
      const ph = shelfPhase(now);
      shelf.position.z = faceAt(ph);
      // coins
      let k = 0;
      const seenStars = new Set();
      for (const [id, c] of disp) {
        if (c.k === 1) {
          let m = starMeshes.get(id);
          if (!m) { m = new T.Mesh(coinGeo, starMats); m.castShadow = !low; scene.add(m); starMeshes.set(id, m); }
          m.scale.set(c.r, 1, c.r); m.position.set(c.x, 0.035 + c.h, c.y); seenStars.add(id);
          continue;
        }
        if (k >= MAXC) continue;
        ps.set(c.x, 0.035 + c.h + (c.k === 2 ? 0.02 : 0), c.y); sc.set(c.r, c.k === 2 ? 1.6 : 1, c.r);
        tilt.set(c.h > 0 ? 0.6 : 0, (id * 1.7) % TAU, 0); q.setFromEuler(tilt);
        coins.setMatrixAt(k++, m4.compose(ps, q, sc));
      }
      // coins tipping over the edge into a tray (or off a side into the gutter)
      for (let j = fallers.length - 1; j >= 0; j--) {
        const f = fallers[j], t = (now - f.at) / 1000;
        if (t > 0.7) { fallers.splice(j, 1); continue; }
        const side = f.own < 0 ? Math.sign(f.x) : 0;
        ps.set(f.x + side * t * 2, 0.035 - 4.9 * t * t * 1.6, f.own < 0 ? f.y : f.y + 0.6 * t + 0.1);
        sc.set(f.r, 1, f.r); tilt.set(t * 6, 0, side * t * 4); q.setFromEuler(tilt);
        if (k < MAXC) coins.setMatrixAt(k++, m4.compose(ps, q, sc));
        if (t < 0.05 && f.own >= 0) sparkle(f.x, EDGE, 4);
      }
      coins.count = k; coins.instanceMatrix.needsUpdate = true;
      for (const [id, m] of starMeshes) if (!seenStars.has(id)) { scene.remove(m); starMeshes.delete(id); }
      // chute: on my turn it follows my aim; on someone else's turn it rides over to where they dropped
      const tx = anim ? (anim.adds[0]?.x ?? 0) : myTurn() ? aim * (HW - g0.r) : (chute.position.x * 0.98);
      chute.position.x += (tx - chute.position.x) * Math.min(1, dt * 10);
      aimDot.visible = myTurn() && !anim;
      aimDot.position.set(aim * (HW - g0.r), 0.01, faceAt(((ph % 1) + 1) % 1) + g0.r + 0.02);
      aimDot.material.color.set(g0.bells.some(([bx, by]) => Math.hypot(aimDot.position.x - bx, aimDot.position.z - by) < g0.bellR + g0.r * 0.5) ? 0x7dffb2 : 0xffd23f);
      guide.material.opacity = myTurn() ? 0.6 : 0;
      const by = anim ? anim.by : V.seats.indexOf(S.turn);
      guards.forEach((m) => { m.visible = by >= 0 && V.guard[by] > 0; });
      // chasing marquee
      for (let j = 0; j < NB; j++) bulbs.setColorAt(j, bc.set((Math.floor(now / 110) + j) % 5 < 2 ? 0xfff1b0 : 0x8a4a10));
      bulbs.instanceColor.needsUpdate = true;
      for (let i = 0; i < trays.length; i++) {
        paintLabel(i);
        trays[i].tray.material.emissiveIntensity = S.turn === V.seats[i] ? 0.45 + 0.2 * Math.sin(now / 200) : 0.15;
      }
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt; if (pLife[j] <= 0) { pPos[j * 3 + 1] = -99; continue; }
        pVel[j * 3 + 1] -= 6 * dt; pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    }
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose, sparkle };
  }

  // ---------- flat fallback: the playfield from above (the edge at the bottom)
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), gg = V ? G() : { hw: 3.6, edge: 6 };
      const w = stage.clientWidth || 320, h = stage.clientHeight || 300, k = Math.min(w / (2 * gg.hw + 1), h / (gg.edge + 2.2));
      canvas.style.width = `${k * (2 * gg.hw + 1)}px`; canvas.style.height = `${k * (gg.edge + 2.2)}px`;
      canvas.width = Math.round(k * (2 * gg.hw + 1) * dpr); canvas.height = Math.round(k * (gg.edge + 2.2) * dpr);
    }
    function draw(now) {
      if (!canvas.width) resize();
      const gg = G(), W = canvas.width, H = canvas.height, k = W / (2 * gg.hw + 1), X = (x) => W / 2 + x * k, Y = (y) => (y + 0.6) * k;
      g.fillStyle = '#2a0f30'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#6b707c'; g.fillRect(X(-gg.hw), Y(-0.6), 2 * gg.hw * k, (gg.edge + 0.6) * k);
      const n = V.seats.length;
      for (let i = 0; i < n; i++) { const w = 2 * gg.hw / n; g.fillStyle = colorOf(i); g.fillRect(X(-gg.hw + w * i) + 2, Y(gg.edge) + 4, w * k - 4, 0.9 * k); g.fillStyle = '#fff'; g.font = `bold ${Math.round(0.42 * k)}px sans-serif`; g.textAlign = 'center'; g.fillText(`${shown[i] ?? 0}`, X(-gg.hw + w * (i + 0.5)), Y(gg.edge) + 0.65 * k); }
      for (const [bx, by] of gg.bells) { g.strokeStyle = '#ffd23f'; g.lineWidth = 0.06 * k; g.beginPath(); g.arc(X(bx), Y(by), gg.bellR * k, 0, 7); g.stroke(); }
      const face = faceAt(shelfPhase(now));
      g.fillStyle = '#2a2f3a'; g.fillRect(X(-gg.hw), Y(-0.6), 2 * gg.hw * k, (face + 0.6) * k);
      g.fillStyle = '#e8ecf2'; g.fillRect(X(-gg.hw), Y(face) - 2, 2 * gg.hw * k, 3);
      for (const c of disp.values()) {
        g.fillStyle = c.k === 1 ? '#d9d2ff' : '#f2c14e'; g.strokeStyle = c.k === 1 ? '#ff4fa0' : '#a07a1a'; g.lineWidth = 1.5;
        g.globalAlpha = c.h > 0 ? 0.5 : 1;
        g.beginPath(); g.arc(X(c.x), Y(c.y), c.r * k, 0, 7); g.fill(); g.stroke();
      }
      g.globalAlpha = 1;
      if (myTurn() && !anim) { g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath(); g.arc(X(aim * (gg.hw - gg.r)), Y(faceAt(shelfPhase(now)) + gg.r), gg.r * k, 0, 7); g.stroke(); }
    }
    resize();
    return { draw, resize, dispose() { canvas.remove(); }, sparkle() {} };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.turn && s.pusher.me != null && s.turn === s.pusher.seats[s.pusher.me] ? '🪙 Your drop!' : '🪙 Coin Cascade') : null);

  return { mount, render, unmount, fast, turnText, focus: true };
})();
