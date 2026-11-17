// Tide Castles: everyone builds on their own beach at once, then the same waves roll up every beach.
// While building you tap a tool (🧱 wall, 🗼 tower, 🕳️ moat, 🐚 shell, 🏰 move the keep) and then squares of your
// beach (tap something you built this tide to take it back). Rivals' beaches show what stood after the last tide.
// When the tide comes in, the server has already rolled the waves (games/tide.py run_tide); this module plays them
// back from each beach as it stood before (`before`): water racing in square by square, walls wearing down, moats
// filling, shells washed off, keeps falling.
UI.tide = (() => {
  let S, ctx, V = null, gl = null, flat = null, raf = 0, ro = null, tool = 'wall', gotAt = 0, all = false;
  let disp = [], dispKey = '', flash = null, test = false, cursor = null;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');
  const TOOLS = [['wall', '🧱', 'Wall'], ['tower', '🗼', 'Tower'], ['moat', '🕳️', 'Moat'], ['shell', '🐚', 'Shell'], ['keep', '🏰', 'Keep']];

  function mount(main, side) {
    V = null; gl = null; flat = null; tool = 'wall'; all = false; disp = []; dispKey = ''; flash = null; test = false; cursor = null;
    main.innerHTML = `<div class="tc"><div class="tc-stage" id="tcStage">
        <div class="tc-hud"><span id="tcTide"></span><span id="tcClock"></span></div>
        <div class="tc-fore" id="tcFore"></div>
        <div class="tc-pop" id="tcPop" hidden></div>
        <button class="tc-all" id="tcAll" title="See every beach">👀 All</button>
      </div>
      <div class="tc-tools" id="tcTools">${TOOLS.map(([k, ic, nm]) => `<button data-t="${k}" title="${nm}"><b>${ic}</b><small>${nm}${k !== 'keep' ? ` ${'•'.repeat(k === 'tower' ? 2 : 1)}${k === 'tower' ? '+' : ''}` : ''}</small></button>`).join('')}
        <span class="tc-sand" id="tcSand"></span><button class="tc-test" id="tcTest" title="Show where the biggest wave would reach">🔍 Test</button><button class="primary tc-ready" id="tcReady">✅ Ready</button></div>
      <p id="tcHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🏖️ Beaches</h3><div id="tcRace"></div><p class="hint left">Tap a tool, then squares of your beach. 🗼 on a wall or tower piles it higher (up to 4). Tap something you built this tide to take it back. 🔍 Test shows where the biggest wave would reach. Each wave your keep stands scores 6, its strength left scores too, each shell 3.</p></div>';
    $('tcTools').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'tcReady') return ctx.act('done').catch((er) => ctx.toast?.(er?.message || 'Not now.'));
      if (b.id === 'tcTest') { test = !test; renderSide(); return; }
      tool = b.dataset.t; renderSide();
    });
    $('tcAll').addEventListener('click', () => { all = !all; $('tcAll').classList.toggle('on', all); });
    const stage = $('tcStage');
    stage.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const hit = (gl || flat)?.pick(e.clientX, e.clientY);
      if (hit) tap(hit[0], hit[1]);
    });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl && V) GL3.revive(stage, revive(stage)); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }
  const revive = (stage) => ({ build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } });

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); gl?.dispose(); gl = null; flat = null; window.Snd?.bed('tide.surf').set(0); }

  const G = () => V.geo;
  const me = () => V?.me;
  const colorOf = (i) => ctx.player(V.seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V.seats[i])?.name ?? '?';
  const building = () => S?.phase === 'playing' && V?.stage === 'build' && V.me != null;

  function tap(r, c) {
    if (!building()) return;
    const mine = V.plots[V.me]; if (!mine) return;
    const cell = mine.g[r][c], placed = V.placed.some(([pr, pc]) => pr === r && pc === c);
    const pile = tool === 'tower' && cell && (cell[0] === 'wall' || cell[0] === 'tower') && cell[1] < (G().maxH || 2);
    let p;
    cursor = { r, c, at: performance.now() };
    if (tool === 'keep') p = ctx.act('keep', { r, c });
    else if (cell && placed && !pile) p = ctx.act('clear', { r, c });
    else p = ctx.act('build', { r, c, item: tool });
    p.then(() => { SN.pat(); ctx.buzz?.(8); }).catch((e) => { ctx.toast?.(e?.message || 'Not there.'); });
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.tide; gotAt = performance.now();
    if (!gl && !flat && window.THREE && $('tcStage')) GL3.revive($('tcStage'), revive($('tcStage')));
    renderSide();
  }
  // the tide's clock: seconds since the waves started rolling
  const tideT = (now) => (V.stage === 'tide' ? V.since + (now - gotAt) / 1000 : V.stage === 'between' ? 1e9 : -1);
  // each beach as shown: during a tide, the beach before it with the waves so far applied
  function shownPlots(now) {
    const t = tideT(now), wt = G().waveT;
    if ((V.stage !== 'tide' && V.stage !== 'between') || !V.before) { const k = `v${V.tide}${V.stage}${JSON.stringify(V.plots)}`; if (k !== dispKey) { dispKey = k; disp = V.plots.map((p) => p && clone(p)); } return disp; }
    const upto = Math.min(G().waves, Math.floor((t - wt * 0.55) / wt) + 1);   // waves whose wear has happened
    const k = `t${V.tide}:${upto}`;
    if (k !== dispKey) {
      dispKey = k;
      disp = V.before.map((p, i) => {
        if (!p) return null;
        const q = clone(p), res = V.result?.[i];
        q.filled = new Set(); q.fallen = false; q.hp = G().keepHp ?? 10; q.wet = new Set();
        for (let w = 0; w < upto && res; w++) {
          const wave = res.waves[w];
          for (const [r, c, , worn] of wave.hit) if (worn) { const cell = q.g[r][c]; if (cell) { cell[1] -= worn; if (cell[1] <= 0) q.g[r][c] = null; else cell[0] = cell[1] >= 2 ? 'tower' : 'wall'; } }
          for (const [r, c] of wave.wet) { q.wet.add(`${r},${c}`); if (q.g[r][c]?.[0] === 'shell') q.g[r][c] = null; }
          for (const [r, c] of wave.soak) q.filled.add(`${r},${c}`);
          if (wave.hp != null) q.hp = wave.hp;
          if (wave.hp != null ? wave.hp <= 0 : wave.keep) q.fallen = true;
        }
        return q;
      });
    }
    return disp;
  }
  const clone = (p) => ({ g: p.g.map((row) => row.map((c) => (c ? [c[0], c[1]] : null))), keep: p.keep, filled: new Set(), fallen: false, hp: V?.geo?.keepHp ?? 10, wet: new Set() });

  // #157 🔍 Test: the biggest wave of the forecast rolled up my beach as it stands now (games/tide.py run_tide, one
  // wave, nothing worn): the squares it reaches with their force, what it would wear and what the keep would lose
  function testWave(p) {
    const g0 = G(), C = g0.cols, R = g0.rows, F = Math.max(...V.waves), best = new Map(), wet = [], hits = [];
    let front = [], keepF = 0;
    for (let c = 0; c < C; c++) front.push([0, c, F]);
    // force only falls by 1 a square, so a breadth-first sweep from the strongest is enough
    while (front.length) {
      front.sort((a, b) => b[2] - a[2]);
      const [r, c, f] = front.shift(), k = `${r},${c}`;
      if ((best.get(k) ?? 0) >= f) continue;
      best.set(k, f);
      if (r === g0.keepRow && c === p.keep) { keepF = Math.max(keepF, f); continue; }
      const cell = p.g[r][c];
      if (cell && (cell[0] === 'wall' || cell[0] === 'tower') && cell[1] > 0) { hits.push([r, c, f, wearOf(f, cell[1])]); continue; }
      if (cell && cell[0] === 'moat') continue;
      wet.push([r, c, f]);
      if (f - 1 >= 1) for (const [dr, dc] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < R && cc >= 0 && cc < C && (best.get(`${rr},${cc}`) ?? 0) < f - 1) front.push([rr, cc, f - 1]); }
    }
    return { F, wet, hits, keepF, dmg: Math.floor((keepF + 1) / 3) };
  }
  const wearOf = (f, h) => { const over = f - h - (G().wear ?? 2); return over < 0 ? 0 : Math.min(h, 1 + Math.floor(over / 3)); };

  function renderSide() {
    const box = $('tcRace'); if (!box || !V) return;
    box.innerHTML = '';
    const order = V.seats.map((_, i) => i).sort((a, b) => V.points[b] - V.points[a]);
    for (const i of order) {
      const p = ctx.player(V.seats[i]), row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const res = V.result?.[i], st = V.stage === 'build' ? (V.ready[i] ? '✅' : '🛠️') : res ? `🏰 ${res.survived}/${G().waves}${res.hp != null ? ` ❤${res.hp}` : ''}` : '';
      row.append(dot, ctx.el('span', 'grow', `${nameOf(i)}${i === V.me ? ' (you)' : ''}`), ctx.el('span', 'tc-st', st), ctx.el('b', '', `${V.points[i]}`));
      box.append(row);
    }
    const b = building();
    $('tcTools').hidden = V.me == null;
    $('tcTools').classList.toggle('tc-off', !b);
    for (const el of $('tcTools').querySelectorAll('[data-t]')) {
      el.classList.toggle('on', el.dataset.t === tool);
      const k = el.dataset.t;
      el.disabled = !b || (k !== 'keep' && V.left[V.me] < (G().cost[k] ?? 9) && !(k === 'tower' && V.left[V.me] >= 1));
    }
    $('tcSand').textContent = V.me != null ? `🪣 ${V.left[V.me]}/${V.sand}` : '';
    $('tcReady').disabled = !b || V.ready[V.me];
    $('tcTest').disabled = !b; $('tcTest').classList.toggle('on', b && test);
    $('tcReady').textContent = V.me != null && V.ready[V.me] ? '✅ Ready!' : '✅ Ready';
    $('tcTide').textContent = `🌊 Tide ${V.tide} / ${V.tides}`;
    const fore = $('tcFore'); fore.innerHTML = '';
    // the forecast as waves sized by their force
    const lo = Math.min(...V.waves), hi = Math.max(...V.waves);
    V.waves.forEach((w, k) => { const s = ctx.el('span', 'tc-w' + (k === V.waves.length - 1 ? ' big' : '')); s.textContent = `${w}`; s.style.setProperty('--wz', (0.8 + 0.5 * (w - lo) / Math.max(1, hi - lo)).toFixed(2)); s.dataset.k = k; fore.append(s); });
    $('tcHint').textContent = !b ? (V.stage === 'tide' ? 'Here come the waves…' : V.stage === 'between' ? 'The tide goes out…' : '')
      : tool === 'keep' ? (V.moved[V.me] ? 'You moved your keep this tide (you can move it back).' : 'Tap a back-row square to move your keep (once a tide).')
      : test && V.plots[V.me] ? (() => { const tw = testWave(V.plots[V.me]), worn = tw.hits.filter((h) => h[3]).length; return `🔍 The ${tw.F} wave: ${tw.keepF ? (tw.dmg ? `your keep loses ${tw.dmg} of ${G().keepHp}` : 'a trickle reaches your keep (no harm)') : 'your keep stays dry'}${worn ? `, ${worn} piece${worn > 1 ? 's' : ''} worn` : ''}.`; })()
      : `Waves lose 1 force a square and wear a piece only when they hit 2 harder than it's tall. Pile 🗼 towers up to 4.`;
  }

  function pop(text, ms = 1600) {
    const el = $('tcPop'); if (!el) return;
    el.textContent = text; el.hidden = false; el.className = 'tc-pop tc-pop-in'; void el.offsetWidth;
    clearTimeout(pop.t); pop.t = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- sound: the sea
  const snd = (fn) => window.Snd?.play((t, K) => fn(t, K, K.at({ room: 'outdoor', send: 0.4 })));
  const SN = {
    pat: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 700, q: 0.7, vol: 0.18, tau: 0.03, buf: 'brown' }); }),
    wave: (big) => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 300, f1: 1400, q: 0.5, vol: big ? 0.5 : 0.32, tau: 0.35, dur: 1.5, attack: 0.5, buf: 'brown' }); K.burst(d, t + 0.6, { type: 'highpass', f: 2500, q: 0.5, vol: 0.06, tau: 0.3, dur: 1.0 }); }),
    crumble: () => snd((t, K, d) => { for (let n = 0; n < 6; n++) K.burst(d, t + n * K.R(0.03, 0.06), { type: 'lowpass', f: K.R(400, 900), q: 0.8, vol: 0.12, tau: 0.03, buf: 'brown' }); }),
    keep: () => snd((t, K, d) => { K.mode(d, t, 70, 0.25, 0.12, { f1: 45 }); K.burst(d, t, { type: 'lowpass', f: 500, f1: 150, q: 0.7, vol: 0.45, tau: 0.2, dur: 0.8, buf: 'brown' }); }),
  };
  const surfBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lp = A.createBiquadFilter(), g = A.createGain(), lfo = A.createOscillator(), lg = A.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 500; g.gain.value = 0; lfo.frequency.value = 0.12; lg.gain.value = 0.02; lfo.connect(lg).connect(g.gain); lfo.start();
    src.connect(lp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.03 * l, A.currentTime, 0.8); }, stop() { try { src.stop(); lfo.stop(); } catch {} } };
  };

  let lastWave = -1, lastClock = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const plots = shownPlots(now);
    (gl || flat)?.draw(now, plots);
    window.Snd?.bed('tide.surf', surfBed).set(S.phase === 'playing' ? 1 : 0);
    // a wave's moments: its roar as it starts, crumbles and keeps falling as it wears things down
    const t = tideT(now), wt = G().waveT;
    const w = V.stage === 'tide' ? Math.floor(t / wt) : -1;
    if (w !== lastWave) {
      if (w >= 0 && w < G().waves) {
        SN.wave(w === G().waves - 1);
        const mine = V.result?.[V.me]?.waves?.[w];
        setTimeout(() => {
          if (!mine || V.stage !== 'tide') return;
          if (mine.hit.some((h) => h[3])) SN.crumble();
          const prev = w ? V.result[V.me].waves[w - 1].hp : G().keepHp;
          if (prev > 0 && mine.hp <= 0) { SN.keep(); ctx.buzz?.([80, 40, 120]); pop('💥 Your keep is washed away!', 2000); gl?.shake(0.25); }
          else if (mine.hp > 0 && mine.dmg > 0) { SN.crumble(); ctx.buzz?.(40); pop(`🏰 −${mine.dmg} strength · still standing +${G().wavePts}`, 1400); }
          else if (mine.hp > 0) pop(`🏰 Standing! +${G().wavePts}`, 1100);
        }, wt * 550);
      }
      lastWave = w;
      for (const el of document.querySelectorAll('#tcFore .tc-w')) el.classList.toggle('now', +el.dataset.k === w);
    }
    const left = Math.max(0, V.timeLeft - (now - gotAt) / 1000);
    $('tcClock').textContent = V.stage === 'build' && S.phase === 'playing' ? `⏱ ${Math.ceil(left)}s` : '';
    $('tcClock').classList.toggle('tc-hurry', V.stage === 'build' && left <= 10);
    const c = Math.ceil(left);
    if (V.stage === 'build' && c !== lastClock && c <= 5 && c > 0) ctx.sfx?.('tick');
    lastClock = c;
    $('tcAll').hidden = V.seats.length < 2;
  }

  // ---------- three.js beaches
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
    const g0 = G(), C = g0.cols, R = g0.rows, n = V.seats.length, GAP = 1.6, PW = C + GAP;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.3, 300);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.05, hemi: [0xdff3ff, 0xc9a873, 0.75],
      key: { i: 1.2, color: 0xfff1d6, pos: [-6, 14, 10], area: Math.max(8, n * PW * 0.6), near: 2, far: 60 },
      sky: { top: 0x3f8fe0, horizon: 0xcfeaff, bottom: 0xf0e2c0, band: 0.1 },
      fog: [0xcfeaff, 40, 120],
    });
    const low = stg.low;
    // plot k's origin: plots side by side along x; row 0 (the sea side) is furthest from the camera (−z)
    const ox = (i) => (i - (n - 1) / 2) * PW - C / 2 + 0.5;
    const oz = -R / 2 + 0.5;
    const cellPos = (i, r, c) => [ox(i) + c, oz + r];
    // sand
    const sandTex = canvasTex(T, 128, 128, (g, w, h) => {
      g.fillStyle = '#e8cf9a'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 2200; k++) { const v = Math.random(); g.fillStyle = v < 0.33 ? '#dcc086' : v < 0.66 ? '#f2dcae' : '#cfae72'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    });
    sandTex.wrapS = sandTex.wrapT = T.RepeatWrapping; sandTex.repeat.set(20, 8);
    const sandMat = new T.MeshStandardMaterial({ map: sandTex, roughness: 0.95, color: 0xe6d2a6 });
    // each beach: smoothed sand with faint raked squares, so you can see where to build
    const gridTex = canvasTex(T, C * 32, R * 32, (g, w, h) => {
      g.fillStyle = '#f6e6bf'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { g.fillStyle = Math.random() < 0.5 ? '#ecd8a8' : '#fbefd2'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      g.strokeStyle = 'rgba(150,115,60,0.35)'; g.lineWidth = 1.5;
      for (let c = 1; c < C; c++) { g.beginPath(); g.moveTo(c * 32, 0); g.lineTo(c * 32, h); g.stroke(); }
      for (let r = 1; r < R; r++) { g.beginPath(); g.moveTo(0, r * 32); g.lineTo(w, r * 32); g.stroke(); }
      g.fillStyle = 'rgba(200,140,60,0.18)'; g.fillRect(0, (R - 1) * 32, w, 32);   // the back row, where the keep stands
    });
    const beach = new T.Mesh(new T.PlaneGeometry(n * PW + 60, 50), sandMat); beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0, oz - 0.5 + 25); beach.receiveShadow = true; scene.add(beach);
    // plot outlines: a raked edge in each player's colour
    for (let i = 0; i < n; i++) {
      const ring = new T.Mesh(new T.PlaneGeometry(C + 0.3, R + 0.3), new T.MeshBasicMaterial({ color: colorOf(i), transparent: true, opacity: 0.35, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(ox(i) + C / 2 - 0.5, 0.004, oz + R / 2 - 0.5); scene.add(ring);
      const inner = new T.Mesh(new T.PlaneGeometry(C, R), new T.MeshStandardMaterial({ map: gridTex, roughness: 0.9, color: 0xffffff }));
      inner.rotation.x = -Math.PI / 2; inner.position.set(ox(i) + C / 2 - 0.5, 0.006, oz + R / 2 - 0.5); inner.receiveShadow = true; scene.add(inner);
      const label = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 256, 64, (g, w, h) => { g.fillStyle = colorOf(i); g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#fff'; g.shadowBlur = 6; g.fillText(`${i === me() ? '★ ' : ''}${nameOf(i)}`.slice(0, 16), w / 2, h / 2); }), transparent: true, depthWrite: false }));
      label.position.set(ox(i) + C / 2 - 0.5, 0.3, oz + R + 0.4); label.scale.set(3.2, 0.8, 1); scene.add(label);
    }
    // the sea: a rippling sheet beyond row 0, and a wet-sand band at the waterline
    const SW = n * PW + 60, seaGeo = new T.PlaneGeometry(SW, 40, 60, 16);
    const seaMat = new T.MeshStandardMaterial({ color: 0x2a9bd8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 });
    const sea = new T.Mesh(seaGeo, seaMat); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.05, oz - 0.5 - 20); scene.add(sea);
    const sp = seaGeo.attributes.position, base = Float32Array.from(sp.array);
    const foam = new T.Mesh(new T.PlaneGeometry(SW, 0.5), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.02, oz - 0.6); scene.add(foam);
    // the pieces: one group per plot, rebuilt when that plot changes
    const wallMat = new T.MeshStandardMaterial({ map: sandTex, color: 0xd8b77a, roughness: 0.9 });
    const towerMat = new T.MeshStandardMaterial({ map: sandTex, color: 0xcfa968, roughness: 0.9 });
    const moatMat = new T.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1 });
    const waterMat = new T.MeshStandardMaterial({ color: 0x3aa8e8, roughness: 0.15, transparent: true, opacity: 0.85 });
    const shellMat = new T.MeshStandardMaterial({ color: 0xffb3c1, roughness: 0.5 });
    const wallGeo = new T.BoxGeometry(0.9, 0.45, 0.9), crenGeo = new T.BoxGeometry(0.2, 0.16, 0.2);
    const towerGeo = new T.CylinderGeometry(0.36, 0.44, 0.95, 14), towerTop = new T.CylinderGeometry(0.4, 0.36, 0.14, 14);
    const shellGeo = new T.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const bandGeo = new T.CylinderGeometry(0.41, 0.41, 0.05, 14), bandMat = new T.MeshStandardMaterial({ color: 0xa8844c, roughness: 0.95 });
    const shared = new Set([wallGeo, crenGeo, towerGeo, towerTop, shellGeo, bandGeo, wallMat, towerMat, moatMat, waterMat, shellMat, bandMat]);
    const plots3 = [];
    for (let i = 0; i < n; i++) { const grp = new T.Group(); scene.add(grp); plots3.push({ grp, key: '' }); }
    function keepModel(col, fallen) {
      const k = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.42, 0.48, 0.8, 16), towerMat); body.position.y = 0.4; body.castShadow = !low; k.add(body);
      for (let t = 0; t < 4; t++) { const a = t * Math.PI / 2 + Math.PI / 4, tw = new T.Mesh(new T.CylinderGeometry(0.13, 0.15, 1.15, 10), towerMat); tw.position.set(Math.cos(a) * 0.38, 0.57, Math.sin(a) * 0.38); tw.castShadow = !low; k.add(tw); }
      const pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.7, 6), new T.MeshStandardMaterial({ color: 0x8a6a3a })); pole.position.y = 1.15; k.add(pole);
      const flag = new T.Mesh(new T.PlaneGeometry(0.4, 0.24), new T.MeshStandardMaterial({ color: col, side: T.DoubleSide })); flag.position.set(0.2, 1.38, 0); k.add(flag);
      if (fallen) { k.rotation.z = 1.2; k.position.y = -0.1; k.scale.set(1, 0.5, 1); }
      k.userData.flag = flag;
      return k;
    }
    function rebuild(i, p) {
      const o = plots3[i];
      const key = p ? JSON.stringify([p.g, p.keep, [...(p.filled || [])], p.fallen, p.hp]) : 'none';
      if (key === o.key) return;
      o.key = key;
      for (const ch of [...o.grp.children]) {
        o.grp.remove(ch);
        ch.traverse((m) => { if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose(); if (m.material && !shared.has(m.material)) { m.material.map?.dispose(); m.material.dispose(); } });
      }
      if (!p) {   // a beach still being built: a tarp over it
        const tarp = new T.Mesh(new T.BoxGeometry(C - 0.2, 0.25, R - 0.2), new T.MeshStandardMaterial({ color: 0x5b6b8a, roughness: 0.8 }));
        tarp.position.set(ox(i) + C / 2 - 0.5, 0.13, oz + R / 2 - 0.5); o.grp.add(tarp);
        return;
      }
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const cell = p.g[r][c], [x, z] = cellPos(i, r, c);
        if (!cell) continue;
        const [kind, h] = cell;
        if (kind === 'wall' || (kind === 'tower' && h === 1)) {
          const m = new T.Mesh(wallGeo, wallMat); m.position.set(x, 0.225, z); m.castShadow = !low; m.receiveShadow = true; o.grp.add(m);
          for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const cr = new T.Mesh(crenGeo, wallMat); cr.position.set(x + dx, 0.53, z + dz); o.grp.add(cr); }
        } else if (kind === 'tower') {
          // a tower 2–4 high: the same turret stretched, a band of darker sand at each level
          const m = new T.Mesh(towerGeo, towerMat); m.scale.y = h / 2; m.position.set(x, 0.2375 * h, z); m.castShadow = !low; o.grp.add(m);
          const tp = new T.Mesh(towerTop, towerMat); tp.position.set(x, 0.475 * h + 0.05, z); o.grp.add(tp);
          for (let lv = 1; lv < h; lv++) { const band = new T.Mesh(bandGeo, bandMat); band.position.set(x, 0.475 * lv, z); o.grp.add(band); }
        } else if (kind === 'moat') {
          const full = p.filled?.has(`${r},${c}`);
          const m = new T.Mesh(new T.BoxGeometry(0.86, 0.04, 0.86), full ? waterMat : moatMat); m.position.set(x, 0.012, z); o.grp.add(m);
        } else if (kind === 'shell') {
          const m = new T.Mesh(shellGeo, shellMat); m.scale.set(1, 0.6, 1.1); m.position.set(x, 0.01, z); m.rotation.y = (r * 7 + c) % 6; o.grp.add(m);
        }
      }
      const [kx, kz] = cellPos(i, g0.keepRow, p.keep);
      // the keep falls over (animated in draw) the first time it goes; its strength as a bar over it
      if (p.fallen && !o.fallen) o.fallAt = performance.now();
      o.fallen = p.fallen;
      const kp = keepModel(colorOf(i), false); kp.position.x += kx; kp.position.z += kz; o.grp.add(kp); o.keep = kp;
      const hpMax = g0.keepHp ?? 10, hp = p.hp ?? hpMax;
      if (hp < hpMax && !p.fallen) {
        const bar = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 128, 24, (g, w, h) => { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, w, h); g.fillStyle = hp > hpMax / 2 ? '#5fd35f' : hp > hpMax / 4 ? '#ffc23d' : '#ff5a4a'; g.fillRect(3, 3, (w - 6) * hp / hpMax, h - 6); }), transparent: true, depthWrite: false }));
        bar.position.set(kx, 1.9, kz); bar.scale.set(0.9, 0.17, 1); o.grp.add(bar);
      }
    }
    // water: one translucent tile per wet square, fading in as the wave reaches it and out as it drains
    const wetMat = new T.MeshBasicMaterial({ color: 0x5ec4f2, transparent: true, opacity: 0.6, depthWrite: false });
    const NW = n * C * R, wetMesh = new T.InstancedMesh(new T.BoxGeometry(1, 0.08, 1), wetMat, NW); wetMesh.frustumCulled = false; scene.add(wetMesh);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
    // splashes
    const NP = 300, pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    const pGeo = new T.BufferGeometry(); pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    const parts = new T.Points(pGeo, new T.PointsMaterial({ size: 0.12, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    parts.frustumCulled = false; scene.add(parts);
    for (let k = 0; k < NP; k++) pPos[k * 3 + 1] = -99;
    let pNext = 0;
    function splash(x, z, nn) { if (calm()) nn = Math.ceil(nn / 3); for (let k = 0; k < nn; k++) { const j = pNext; pNext = (pNext + 1) % NP; pPos[j * 3] = x; pPos[j * 3 + 1] = 0.4; pPos[j * 3 + 2] = z; const a = Math.random() * 6.283; pVel[j * 3] = Math.cos(a) * 1.5; pVel[j * 3 + 1] = 2 + Math.random() * 2; pVel[j * 3 + 2] = Math.sin(a) * 1.5 - 1; pLife[j] = 0.5 + Math.random() * 0.4; } }
    const splashed = new Set();
    // #157: the wave's crest rolling up each beach, sand darkened where the water has been, sand flying off what
    // the waves wear down, the build cursor, and the 🔍 test wave's reach
    const crestMat = new T.MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.3, transparent: true, opacity: 0.9, emissive: 0x6ab8e8, emissiveIntensity: 0.25 });
    const crests = []; for (let i = 0; i < n; i++) { const m = new T.Mesh(new T.CylinderGeometry(0.22, 0.32, C, 10, 1), crestMat); m.rotation.z = Math.PI / 2; m.visible = false; scene.add(m); crests.push(m); }
    const dampMat = new T.MeshBasicMaterial({ color: 0x8a6a3a, transparent: true, opacity: 0.14, depthWrite: false });
    const damp = new T.InstancedMesh(new T.PlaneGeometry(1, 1), dampMat, NW); damp.frustumCulled = false; scene.add(damp);
    const flatQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    const SP2 = 200, sPos = new Float32Array(SP2 * 3), sVel = new Float32Array(SP2 * 3), sLife = new Float32Array(SP2);
    const sGeo = new T.BufferGeometry(); sGeo.setAttribute('position', new T.BufferAttribute(sPos, 3));
    const sand = new T.Points(sGeo, new T.PointsMaterial({ size: 0.1, color: 0xcfa968, transparent: true, depthWrite: false })); sand.frustumCulled = false; scene.add(sand);
    for (let j = 0; j < SP2; j++) sPos[j * 3 + 1] = -99;
    let sNext = 0;
    function crumble(x, z, nn) { if (calm()) nn = Math.ceil(nn / 3); for (let k = 0; k < nn; k++) { const j = sNext; sNext = (sNext + 1) % SP2; sPos[j * 3] = x + (Math.random() - 0.5) * 0.6; sPos[j * 3 + 1] = 0.2 + Math.random() * 0.6; sPos[j * 3 + 2] = z + (Math.random() - 0.5) * 0.6; const a = Math.random() * 6.283; sVel[j * 3] = Math.cos(a) * 0.9; sVel[j * 3 + 1] = 0.5 + Math.random() * 1.5; sVel[j * 3 + 2] = Math.sin(a) * 0.9 + 0.5; sLife[j] = 0.6 + Math.random() * 0.4; } }
    const crumbled = new Set();
    const curMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const cur = new T.Mesh(new T.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4), curMat); cur.rotation.x = -Math.PI / 2; cur.visible = false; scene.add(cur);
    const testMat = new T.MeshBasicMaterial({ color: 0x2a9bd8, transparent: true, opacity: 0.4, depthWrite: false });
    const testMesh = new T.InstancedMesh(new T.PlaneGeometry(0.92, 0.92), testMat, C * R); testMesh.frustumCulled = false; scene.add(testMesh);
    const testKeep = new T.Mesh(new T.RingGeometry(0.5, 0.62, 32), new T.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.85, depthWrite: false })); testKeep.rotation.x = -Math.PI / 2; testKeep.visible = false; scene.add(testKeep);
    // the build cursor: a glowing square under the pointer's last tap (and a ghost of the tool)
    const raycaster = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), v2 = new T.Vector2(), hitP = new T.Vector3();

    let aspect = 1, camX = 0, camD = 14, lastDraw = 0;
    function resize() { const w = stage.clientWidth || 320, h = stage.clientHeight || 300; renderer.setSize(w, h); camera.aspect = aspect = w / h; camera.updateProjectionMatrix(); }
    function draw(now, plots) {
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      // camera: my beach (or all of them), from behind the keeps looking out to sea
      const mi = me() ?? 0, wide = all || me() == null, tv = Math.tan((camera.fov * Math.PI) / 360);
      const halfW = wide ? (n * PW) / 2 + 0.5 : C / 2 + 1.1;
      const tx = wide ? 0 : ox(mi) + C / 2 - 0.5;
      const td = Math.max(halfW / (tv * aspect), (R * 0.9) / tv);
      camX += (tx - camX) * Math.min(1, dt * 4); camD += (td - camD) * Math.min(1, dt * 4);
      camera.position.set(camX, camD * 0.8, camD * 0.62 + 1.5); camera.lookAt(camX, 0, 0.2);
      GL3.tickShake(camera, dt); stg.follow(camera);
      for (let i = 0; i < n; i++) {
        rebuild(i, plots[i]);
        // a keep going over: it tips, slumps and sinks a little
        const o = plots3[i];
        if (o.keep) {
          const u = o.fallen ? Math.min(1, (now - (o.fallAt || 0)) / 700) : 0, e = u * u * (3 - 2 * u);
          o.keep.rotation.z = 1.2 * e; o.keep.scale.set(1, 1 - 0.5 * e, 1); o.keep.position.y = -0.1 * e;
          if (o.fallen && u < 1 && u > 0.3 && !o.dusted) { o.dusted = true; crumble(o.keep.position.x, o.keep.position.z, 26); }
          if (!o.fallen) o.dusted = false;
        }
      }
      // the sea swells (bigger while a wave is coming in)
      const t = tideT(now), wt = g0.waveT, w = V.stage === 'tide' ? Math.floor(t / wt) : -1, f = w >= 0 && w < g0.waves ? (t - w * wt) / wt : 0;
      const surge = w >= 0 && w < g0.waves ? Math.sin(Math.min(1, f * 1.6) * Math.PI) : 0;
      for (let k = 0; k < sp.count; k++) {
        const x = base[k * 3], y = base[k * 3 + 1];
        sp.setZ(k, Math.sin(x * 0.6 + now / 600) * 0.06 + Math.sin(y * 0.9 + now / 800) * 0.05 + (y > 15 ? surge * 0.15 : 0));
      }
      sp.needsUpdate = true; seaGeo.computeVertexNormals();
      foam.position.z = oz - 0.6 + Math.sin(now / 1300) * 0.15 + surge * 0.5; foam.material.opacity = 0.5 + 0.3 * surge;
      // wet squares of the current wave
      let k = 0;
      if (w >= 0 && w < g0.waves && V.result) {
        const F = V.waves[w];
        for (let i = 0; i < n; i++) {
          const res = V.result[i]; if (!res) continue;
          const wave = res.waves[w];
          for (const [r, c, fo] of wave.wet) {
            const arrive = (F - fo) * 0.09, life = f * wt - arrive;
            if (life < 0) continue;
            const a = Math.min(1, life / 0.2) * Math.max(0, 1 - Math.max(0, f * wt - 1.3) / 0.7);
            if (a <= 0.01) continue;
            const [x, z] = cellPos(i, r, c);
            ps.set(x, 0.03, z); sc.set(1, 1, 1); wetMesh.setMatrixAt(k++, m4.compose(ps, q, sc.set(a, 1, a)));
          }
          for (const [r, c, fo] of wave.hit) {
            const key = `${V.tide}:${w}:${i}:${r}:${c}`;
            if (f * wt >= (F - fo) * 0.09 && !splashed.has(key)) { splashed.add(key); const [x, z] = cellPos(i, r, c); splash(x, z - 0.4, 8); }
          }
        }
      }
      wetMesh.count = k; wetMesh.instanceMatrix.needsUpdate = true;
      // the crests and the worn pieces' sand
      for (let i = 0; i < n; i++) {
        const res = V.result?.[i], wave = w >= 0 && w < g0.waves ? res?.waves?.[w] : null, cm = crests[i];
        if (!wave) { cm.visible = false; continue; }
        const reach = wave.wet.reduce((m, q) => Math.max(m, q[0]), 0);
        // the crest runs in at the water's pace (a square every 0.09 s) and breaks where the water stops
        const el = f * wt, row = Math.min(reach, el / 0.09 - 0.5), stopAt = (reach + 0.5) * 0.09, fade = Math.max(0, 1 - Math.max(0, el - stopAt) / 0.35);
        cm.visible = fade > 0.02; cm.position.set(ox(i) + C / 2 - 0.5, 0.12 * fade + 0.06 * Math.sin(el * 6), oz + row - 0.2);
        cm.scale.set(fade, 1, 0.6 + 0.4 * fade); crestMat.opacity = 0.9 * fade;
        for (const [r, c, fo, worn] of wave.hit) {
          const key = `${V.tide}:${w}:${i}:${r}:${c}`;
          if (worn && f >= 0.55 && !crumbled.has(key)) { crumbled.add(key); const [x, z] = cellPos(i, r, c); crumble(x, z, 8 + 6 * worn); }
        }
      }
      // damp sand where the tide has been (until the next build)
      let nd = 0;
      if (V.stage === 'tide' || V.stage === 'between') for (let i = 0; i < n; i++) for (const key of plots[i]?.wet || []) { const [r, c] = key.split(',').map(Number), [x, z] = cellPos(i, r, c); ps.set(x, 0.008, z); damp.setMatrixAt(nd++, m4.compose(ps, flatQ, sc.set(1, 1, 1))); }
      damp.count = nd; damp.instanceMatrix.needsUpdate = true;
      for (let j = 0; j < SP2; j++) {
        if (sLife[j] <= 0) continue;
        sLife[j] -= dt; if (sLife[j] <= 0 || sPos[j * 3 + 1] < 0) { sLife[j] = 0; sPos[j * 3 + 1] = -99; continue; }
        sVel[j * 3 + 1] -= 8 * dt; sPos[j * 3] += sVel[j * 3] * dt; sPos[j * 3 + 1] += sVel[j * 3 + 1] * dt; sPos[j * 3 + 2] += sVel[j * 3 + 2] * dt;
      }
      sGeo.attributes.position.needsUpdate = true;
      // the cursor (the square you last tapped) and the test wave
      const mineI = me(), bld = building();
      cur.visible = bld && !!cursor && now - cursor.at < 1500;
      if (cur.visible) { const [x, z] = cellPos(mineI, cursor.r, cursor.c); cur.position.set(x, 0.02, z); curMat.opacity = 0.9 * (1 - (now - cursor.at) / 1500); }
      let nt = 0;
      testKeep.visible = false;
      if (bld && test && plots[mineI]) {
        const tw = testWave(plots[mineI]);
        for (const [r, c, fo] of tw.wet) { const [x, z] = cellPos(mineI, r, c); ps.set(x, 0.015, z); testMesh.setMatrixAt(nt++, m4.compose(ps, flatQ, sc.set(1, 1, 1))); }
        testMat.opacity = 0.32 + 0.12 * Math.sin(now / 300);
        if (tw.dmg > 0) { const [x, z] = cellPos(mineI, g0.keepRow, plots[mineI].keep); testKeep.position.set(x, 0.02, z); testKeep.visible = true; }
      }
      testMesh.count = nt; testMesh.instanceMatrix.needsUpdate = true;
      for (let j = 0; j < NP; j++) {
        if (pLife[j] <= 0) continue;
        pLife[j] -= dt; if (pLife[j] <= 0) { pPos[j * 3 + 1] = -99; continue; }
        pVel[j * 3 + 1] -= 9 * dt; pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      }
      pGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    }
    function pick(cx, cy) {
      if (me() == null) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      v2.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(v2, camera);
      if (!raycaster.ray.intersectPlane(ground, hitP)) return null;
      const c = Math.round(hitP.x - ox(me())), r = Math.round(hitP.z - oz);
      return r >= 0 && r < R && c >= 0 && c < C ? [r, c] : null;
    }
    const shake = (a) => GL3.shake(camera, a);
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose, pick, shake };
  }

  // ---------- flat fallback: my beach (or all of them) from above, the sea at the top
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let lay = null;
    function resize() { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round((stage.clientWidth || 320) * dpr); canvas.height = Math.round((stage.clientHeight || 300) * dpr); canvas.style.width = '100%'; canvas.style.height = '100%'; }
    const ICON = { wall: '🧱', tower: '🗼', moat: '🕳️', shell: '🐚' };
    function draw(now, plots) {
      if (!canvas.width) resize();
      const g0 = G(), W = canvas.width, H = canvas.height, n = V.seats.length, wide = all || me() == null;
      const list = wide ? V.seats.map((_, i) => i) : [me()];
      const cols = list.length * (g0.cols + 1) - 1, k = Math.min(W / (cols + 0.4), (H - 40) / (g0.rows + 1.6));
      const x0 = (W - cols * k) / 2, y0 = 1.4 * k;
      lay = { k, x0, y0, list };
      g.fillStyle = '#f0e2c0'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#2a9bd8'; g.fillRect(0, 0, W, y0 - 0.15 * k);
      const t = tideT(now), wt = g0.waveT, w = V.stage === 'tide' ? Math.floor(t / wt) : -1, f = w >= 0 && w < g0.waves ? (t - w * wt) / wt : 0;
      list.forEach((i, li) => {
        const px = x0 + li * (g0.cols + 1) * k, p = plots[i];
        g.strokeStyle = colorOf(i); g.lineWidth = 3; g.strokeRect(px - 2, y0 - 2, g0.cols * k + 4, g0.rows * k + 4);
        if (!p) { g.fillStyle = '#5b6b8a88'; g.fillRect(px, y0, g0.cols * k, g0.rows * k); return; }
        g.font = `${Math.round(k * 0.6)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let r = 0; r < g0.rows; r++) for (let c = 0; c < g0.cols; c++) {
          const cell = p.g[r][c], cx = px + (c + 0.5) * k, cy = y0 + (r + 0.5) * k;
          if (p.wet?.has(`${r},${c}`)) { g.fillStyle = 'rgba(107,78,37,0.18)'; g.fillRect(cx - k / 2, cy - k / 2, k, k); }
          if (cell) {
            if (cell[0] === 'moat' && p.filled?.has(`${r},${c}`)) { g.fillStyle = '#3aa8e8'; g.fillRect(cx - k * 0.45, cy - k * 0.45, k * 0.9, k * 0.9); }
            else g.fillText(cell[0] === 'tower' && cell[1] === 1 ? '🧱' : ICON[cell[0]], cx, cy);
            if (cell[0] === 'tower' && cell[1] > 1) { g.save(); g.font = `800 ${Math.round(k * 0.32)}px sans-serif`; g.fillStyle = '#fff'; g.strokeStyle = '#000a'; g.lineWidth = 3; g.strokeText(cell[1], cx + k * 0.3, cy + k * 0.3); g.fillText(cell[1], cx + k * 0.3, cy + k * 0.3); g.restore(); }
          }
          if (r === g0.keepRow && c === p.keep) {
            g.fillText(p.fallen ? '💥' : '🏰', cx, cy);
            const hm = g0.keepHp ?? 10, hp = p.hp ?? hm;
            if (!p.fallen && hp < hm) { g.fillStyle = '#0008'; g.fillRect(cx - k * 0.4, cy - k * 0.55, k * 0.8, k * 0.1); g.fillStyle = hp > hm / 2 ? '#5fd35f' : '#ff5a4a'; g.fillRect(cx - k * 0.4, cy - k * 0.55, k * 0.8 * hp / hm, k * 0.1); }
          }
        }
        if (i === me() && building() && test) { const tw = testWave(p); g.fillStyle = 'rgba(42,155,216,0.35)'; for (const [r, c] of tw.wet) g.fillRect(px + c * k, y0 + r * k, k, k); }
        if (w >= 0 && w < g0.waves && V.result?.[i]) {
          const F = V.waves[w];
          for (const [r, c, fo] of V.result[i].waves[w].wet) {
            const life = f * wt - (F - fo) * 0.09; if (life < 0 || f * wt > 2) continue;
            g.fillStyle = 'rgba(94,196,242,0.55)'; g.fillRect(px + c * k, y0 + r * k, k, k);
          }
        }
      });
    }
    function pick(cx, cy) {
      if (!lay || me() == null) return null;
      const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, x = (cx - rect.left) * sx, y = (cy - rect.top) * sx;
      const li = lay.list.indexOf(me()); if (li < 0) return null;
      const px = lay.x0 + li * (G().cols + 1) * lay.k, c = Math.floor((x - px) / lay.k), r = Math.floor((y - lay.y0) / lay.k);
      return r >= 0 && r < G().rows && c >= 0 && c < G().cols ? [r, c] : null;
    }
    resize();
    return { draw, resize, dispose() { canvas.remove(); }, pick };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.tide.stage === 'build' ? `🏖️ Build! Tide ${s.tide.tide} of ${s.tide.tides}` : `🌊 Tide ${s.tide.tide} of ${s.tide.tides}`) : null);
  const myMove = (s) => s.phase === 'playing' && s.tide.stage === 'build' && s.tide.me != null && !s.tide.ready[s.tide.me];

  return { mount, render, unmount, turnText, myMove, focus: true };
})();
